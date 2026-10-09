import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { GameRuntime, type GameCommand, type PauseReason } from './GameRuntime'
import { availableItems, exchangeItems } from './inventory'
import { burnTorch, LIGHTING, lightTorch } from './lighting'
import { environmentLight } from './environment'
import { validateSave, type SaveEnvelope } from './saveData'
import { dataFixture, envelopeFixture, productionFixture, testNow, worldFixture } from './testFixtures'

const world = worldFixture(), catalog = productionFixture()
function harness(save = envelopeFixture(), now = testNow) {
  const runtime = new GameRuntime(world, { catalog, saved: validateSave(save, world, catalog), now: () => now })
  let time = 0; runtime.advanceFrame(0)
  const pump = (seconds: number) => { for (let i = 0; i < Math.round(seconds * 20); i++) runtime.advanceFrame(time += 50) }
  const send = async (command: GameCommand) => { const result = runtime.dispatch(command); pump(.05); return result }
  const saved = () => validateSave(JSON.parse(runtime.exportSave()), world, catalog)
  return { runtime, pump, send, saved, remaining: () => runtime.getSceneSnapshot().survival.torchRemaining ?? 0 }
}
describe('portable torch and deep-night illumination', () => {
  it('consumes exactly two available branches across board and warehouse without other costs', () => {
    const data = dataFixture(), inv = data.production.inventory
    const stored = inv.items[inv.board[8].instanceId!]
    inv.board[8].instanceId = null; inv.warehouse[0] = stored.id; stored.location = { kind: 'warehouse', index: 0 }
    const before = structuredClone(data.production), result = lightTorch(data.production, 0, catalog)
    if (!result.accepted) throw new Error(result.reason)
    expect(data.production).toEqual(before)
    expect(result.remaining).toBe(60)
    expect(result.production.inventory.warehouse[0]).toBeNull(); expect(result.production.inventory.board[7].instanceId).toBeNull()
    expect(result.production.stamina).toEqual(before.stamina); expect(result.production.vitals).toEqual(before.vitals)
    expect(result.production.inventory.gold).toBe(before.inventory.gold); expect(result.production.inventory.gems).toBe(before.inventory.gems)
  })

  it('rejects insufficient or reserved wood atomically and never substitutes higher materials', () => {
    const data = dataFixture(), inv = data.production.inventory
    inv.items[inv.board[7].instanceId!].reservedBy = 'b1:foundation'
    const before = structuredClone(data.production)
    expect(lightTorch(data.production, 0, catalog).accepted).toBe(false)
    expect(data.production).toEqual(before)
    inv.items[inv.board[7].instanceId!].reservedBy = null
    inv.items[inv.board[7].instanceId!].itemId = 202
    expect(lightTorch(data.production, 0, catalog).accepted).toBe(false)
    // Numerous locked level-one branches are present, but remain unavailable.
    expect(availableItems(inv).filter(i => i.itemId === 201)).toHaveLength(1)
  })

  it('serializes repeated ignition commands, expires after 60 active seconds, and permits another paid ignition', async () => {
    const h = harness(), first = h.runtime.dispatch({ type: 'torch-light' }), second = h.runtime.dispatch({ type: 'torch-light' })
    h.pump(.05)
    expect(await first).toMatchObject({ accepted: true }); expect(await second).toMatchObject({ accepted: false })
    expect(h.remaining()).toBe(60)
    h.pump(59.95); expect(h.remaining()).toBeCloseTo(.05)
    h.pump(.05); expect(h.remaining()).toBe(0)
    expect(h.saved().data.survival.torchRemaining).toBe(0)
    expect(await h.send({ type: 'torch-light' })).toMatchObject({ accepted: false })
    const supplied = h.saved(); exchangeItems(supplied.data.production.inventory, catalog, [], [201, 201])
    const next = harness(supplied); expect(await next.send({ type: 'torch-light' })).toMatchObject({ accepted: true })
    expect(next.remaining()).toBe(60)
  })

  it('pauses fuel with the world and preserves remaining time across long offline reloads', async () => {
    const h = harness(); await h.send({ type: 'torch-light' }); h.pump(4)
    for (const reason of ['background', 'page-hidden', 'story', 'save-error', 'renderer-lost'] as PauseReason[]) {
      const before = h.remaining(); h.runtime.setPauseReason(reason, true); h.pump(30)
      expect(h.remaining()).toBe(before)
      expect(await h.runtime.dispatch({ type: 'torch-light' })).toMatchObject({ accepted: false })
      h.runtime.setPauseReason(reason, false); h.pump(.05)
    }
    const save = h.saved(), loaded = harness(save, testNow + 24 * 60 * 60 * 1000)
    expect(loaded.remaining()).toBe(h.remaining())
    expect(loaded.saved().data.production.inventory).toEqual(save.data.production.inventory)
    loaded.pump(1); expect(loaded.remaining()).toBeCloseTo(h.remaining() - 1)
  })

  it('keeps burning during ordinary play and calendar test jumps do not spend skipped fuel', async () => {
    const h = harness(); await h.send({ type: 'torch-light' })
    await h.send({ type: 'move', target: { x: 9, y: 8 } }); h.pump(1)
    expect(h.remaining()).toBeCloseTo(58.95)
    await h.send({ type: 'test-time', preset: 'midnight' })
    expect(h.remaining()).toBeCloseTo(58.9)
    await h.send({ type: 'test-time', preset: 'noon' })
    expect(h.remaining()).toBeCloseTo(58.85)
    const data = dataFixture(); exchangeItems(data.production.inventory, catalog, [], [202]); data.cell = { x: 8, y: 11 }
    const building = harness(envelopeFixture(data))
    await building.send({ type: 'building-place', blueprintId: 'cabin', origin: { x: 7, y: 10 }, rotation: 0 })
    await building.send({ type: 'building-interact', buildingId: 'b1', partId: 'foundation' })
    expect(building.saved().data.construction.jobs[0].phase).toBe('building')
    expect(await building.send({ type: 'torch-light' })).toMatchObject({ accepted: true })
    building.pump(2)
    expect(building.saved().data.construction.buildings[0].parts.foundation.built).toBe(true)
    expect(building.remaining()).toBeCloseTo(58)
  })

  it('accepts old saves as unlit and rejects malformed torch durations', () => {
    const old = JSON.parse(readFileSync('tests/fixtures/pre-grove-tools.json', 'utf8')) as SaveEnvelope
    const migrated = validateSave(old, world, catalog)
    expect(migrated.data.survival.torchRemaining ?? 0).toBe(0)
    expect(migrated.data.production.inventory).toEqual(old.data.production.inventory)
    for (const value of [-1, NaN, Infinity, LIGHTING.torch.seconds + 1, '60', null]) {
      const save = envelopeFixture(); (save.data.survival as any).torchRemaining = value
      expect(() => validateSave(save, world, catalog)).toThrow('火把燃烧时间')
    }
    expect(burnTorch(.05, .05)).toBe(0)
  })

  it('keeps noon/twilight values, darkens smoothly to full darkness and brightens at dawn', () => {
    expect(environmentLight(12 * 60, 'sunny').darkness).toBe(0)
    expect(environmentLight(18 * 60, 'sunny')).toMatchObject({ darkness: .14, warmth: .32 })
    const values = [19, 20.5, 22, 23, 24].map(hour => environmentLight(hour * 60, 'sunny').darkness)
    expect(values).toEqual([...values].sort((a, b) => a - b)); expect(values[values.length - 1]).toBe(1)
    expect(environmentLight(0, 'rain').darkness).toBe(1)
    expect(environmentLight(4.5 * 60, 'sunny').darkness).toBe(1)
    expect(environmentLight(6 * 60, 'sunny').darkness).toBe(.24)
    for (const hour of [0, 4.5, 5, 6, 19, 20.5, 22, 23, 24]) {
      expect(Math.abs(environmentLight(hour * 60 - .001, 'sunny').darkness - environmentLight(hour * 60 + .001, 'sunny').darkness)).toBeLessThan(.001)
    }
  })
})
