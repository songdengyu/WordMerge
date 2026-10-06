import { describe, expect, it } from 'vitest'
import { BLUEPRINTS, blueprintById } from './buildingConfig'
import { constructionNavigation, footprint, localToWorld } from './construction'
import { GameRuntime, type GameCommand } from './GameRuntime'
import { exchangeItems } from './inventory'
import { nearbyThreats } from './survival'
import { validateSave } from './saveData'
import { dataFixture, envelopeFixture, productionFixture, testNow, worldFixture } from './testFixtures'

const world = worldFixture(), catalog = productionFixture()
function prepared(regions: string[] = []) {
  const data = dataFixture()
  data.construction.buildings = [{ id: 'b1', blueprintId: 'cabin', origin: { x: 7, y: 10 }, rotation: 0,
    parts: Object.fromEntries(BLUEPRINTS[0].parts.map(p => [p.id, { built: true, hp: p.hp, xpGranted: true }])) }]
  data.construction.xp = 70; data.construction.nextId = 2; data.progression.unlockedRegions = regions
  return data
}
function harness(data = prepared()) {
  const runtime = new GameRuntime(world, { catalog, saved: envelopeFixture(data), now: () => testNow })
  let frame = 0; runtime.advanceFrame(0)
  const pump = (seconds: number) => { for (let i = 0; i < Math.round(seconds * 20); i++) { frame += 50; runtime.advanceFrame(frame) } }
  const send = async (command: GameCommand) => { const pending = runtime.dispatch(command); pump(.05); return pending }
  const valid = () => validateSave(JSON.parse(runtime.exportSave()), world, catalog).data
  return { runtime, pump, send, valid }
}

describe('persistent regional animals and lodge foundation', () => {
  it('seeds three boars only after completing the brook unlock and keeps them through dawn, rescue and reload', async () => {
    const h = harness()
    expect(h.valid().survival.enemies).toHaveLength(0)
    await h.send({ type: 'region-unlock', regionId: 'brook' }); h.pump(12)
    expect(h.valid().survival.enemies.filter(e => e.residentId)).toHaveLength(3)
    await h.send({ type: 'test-time', preset: 'night' }); h.pump(16)
    expect(h.valid().survival.enemies.some(e => !e.residentId)).toBe(true)
    await h.send({ type: 'test-time', preset: 'dawn' })
    expect(h.valid().survival.enemies).toHaveLength(3)
    h.runtime.applyDamage('player', 100); await h.runtime.dispatch({ type: 'rescue' })
    expect(h.valid().survival.enemies).toHaveLength(3)
    const restored = harness(h.valid()); restored.pump(.1)
    expect(restored.valid().survival.enemies).toHaveLength(3)
  })
  it('attacks at close range in daylight, stays inside the brook, and leaves distant camp resting available', async () => {
    const data = prepared(['brook']); data.cell = { x: 7, y: -9 }
    const h = harness(data), hp = data.production.vitals.hp
    h.pump(3)
    expect(h.valid().production.vitals.hp).toBeLessThan(hp)
    await h.send({ type: 'move', target: { x: 7, y: 2 } }); h.pump(10)
    expect(h.valid().survival.enemies.every(e => h.runtime.world.chunkAt(e.cell)?.id === 'brook')).toBe(true)
    const home = prepared(['brook']); home.cell = { x: 7, y: 11 }
    const rest = harness(home)
    expect(nearbyThreats(rest.valid().survival, home.cell)).toHaveLength(0)
    expect(await rest.send({ type: 'player-rest' })).toMatchObject({ accepted: true })
    rest.pump(1); expect(rest.valid().survival.resting).toBe(true)
  })
  it('allows a companion to defeat a regional boar in daylight without respawning it on reload', async () => {
    const data = harness(prepared(['brook'])).valid(), boar = data.survival.enemies[0]
    boar.hp = 1; data.survival.companion.status = 'active'
    data.survival.companion.cell = { ...boar.cell }; data.survival.companion.guard = { ...boar.cell }
    const h = harness(data), gold = data.production.inventory.gold
    expect(await h.send({ type: 'companion-attack', enemyId: boar.id })).toMatchObject({ accepted: true })
    h.pump(2)
    expect(h.valid().survival.enemies.some(e => e.residentId === boar.residentId)).toBe(false)
    expect(h.valid().production.inventory.gold).toBe(gold + 4)
    const restored = harness(h.valid()); restored.pump(.5)
    expect(restored.valid().survival.enemies.filter(e => e.residentId)).toHaveLength(2)
    expect(restored.valid().production.inventory.gold).toBe(gold + 4)
  })
  it('migrates old unlocked regions without changing player inventory, experience or existing buildings; avoids occupied ground', () => {
    const data = prepared(['brook', 'grove']), prior = structuredClone(data.construction.buildings[0])
    data.construction.buildings.push({ ...structuredClone(prior), id: 'b2', origin: { x: 26, y: 3 } })
    data.construction.nextId = 3; data.construction.xp = 140
    const old = envelopeFixture(data) as any; delete old.data.progression.regionContent
    const saved = validateSave(old, world, catalog)
    expect(saved.data.production).toEqual(data.production)
    expect(saved.data.construction.xp).toBe(140)
    expect(saved.data.construction.buildings.slice(0, 2)).toMatchObject(data.construction.buildings)
    const lodge = saved.data.construction.buildings.find(b => b.blueprintId === 'lodge')!
    expect(lodge).toBeTruthy(); expect(footprint(lodge, blueprintById('lodge')!)).toHaveLength(20)
    expect(lodge.origin).not.toEqual({ x: 25, y: 3 })
    expect(validateSave(saved, world, catalog).data).toEqual(saved.data)
  })
  it('builds a discovered 5 by 4 house through real material orders and preserves its enclosure and door navigation', async () => {
    let h = harness(prepared(['grove']))
    const lodge = h.valid().construction.buildings.find(b => b.blueprintId === 'lodge')!, blueprint = blueprintById('lodge')!
    expect(lodge.parts.foundation.built).toBe(false)
    expect(await h.send({ type: 'building-remove', buildingId: lodge.id })).toMatchObject({ accepted: false })
    expect(await h.send({ type: 'building-place', blueprintId: 'lodge', origin: { x: 25, y: 3 }, rotation: 0 })).toMatchObject({ accepted: false })
    for (const part of blueprint.parts) {
      const data = h.valid(); data.cell = localToWorld(lodge, part.work[0]); data.motion = { version: 1, position: data.cell }
      expect(exchangeItems(data.production.inventory, catalog, [], part.materials)).toBe(true)
      h = harness(data)
      expect(await h.send({ type: 'building-interact', buildingId: lodge.id, partId: part.id })).toMatchObject({ accepted: true })
      expect(h.valid().construction.jobs[0]).toMatchObject({ phase: 'building', remaining: 2 })
      h.pump(1.95); expect(h.valid().construction.buildings[1].parts[part.id].built).toBe(false)
      h.pump(.05); expect(h.valid().construction.buildings[1].parts[part.id].built).toBe(true)
    }
    const saved = h.valid(), from = localToWorld(lodge, { x: 2, y: 3 }), to = localToWorld(lodge, { x: 2, y: 4 })
    expect(saved.construction.xp).toBe(180)
    expect(constructionNavigation(h.runtime.world, saved.construction).canStep(from, to)).toBe(true)
    expect(constructionNavigation(h.runtime.world, saved.construction, 'enemy').canStep(from, to)).toBe(false)
    expect(h.runtime.getUiSnapshot().shelter.enclosed).toBe(true)
  })
  it('rejects forged regional content versions and invalid wildlife identities', () => {
    const data = harness(prepared(['brook', 'grove'])).valid()
    const old = envelopeFixture(data)
    for (const change of [
      (s: any) => { s.data.progression.regionContent.version = 'invalid' },
      (s: any) => { s.data.survival.enemies[0].residentId = 'unknown' },
      (s: any) => { s.data.survival.enemies[0].cell = { x: 7, y: 9 } },
      (s: any) => { s.data.construction.buildings = s.data.construction.buildings.slice(0, 1) },
    ]) { const forged = structuredClone(old); change(forged); expect(() => validateSave(forged, world, catalog)).toThrow('存档校验失败') }
  })
})
