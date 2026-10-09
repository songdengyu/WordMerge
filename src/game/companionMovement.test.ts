import { describe, expect, it } from 'vitest'
import { GameRuntime, type GameCommand } from './GameRuntime'
import { actorPosition } from './survival'
import { SURVIVAL_RULES } from './survivalConfig'
import { canWalkLine, pointCell, pointDistance } from './smoothNavigation'
import { constructionNavigation } from './construction'
import { BLUEPRINTS } from './buildingConfig'
import { validateSave, type RuntimeData } from './saveData'
import { dataFixture, envelopeFixture, productionFixture, testNow, worldFixture } from './testFixtures'

const world = worldFixture(), catalog = productionFixture()
function prepared() {
  const data = dataFixture()
  Object.assign(data.survival.companion, { status: 'active', cell: { x: 6, y: 9 }, guard: { x: 6, y: 9 } })
  return data
}
function harness(data = prepared()) {
  const runtime = new GameRuntime(world, { catalog, saved: envelopeFixture(data), now: () => testNow })
  let time = 0; runtime.advanceFrame(time)
  const pump = (seconds: number) => { for (let i = 0; i < Math.round(seconds * 20); i++) runtime.advanceFrame(time += 50) }
  const send = async (command: GameCommand) => { const pending = runtime.dispatch(command); pump(.05); return pending }
  const valid = () => validateSave(JSON.parse(runtime.exportSave()), world, catalog).data
  const position = () => actorPosition(runtime.getSaveData().survival.companion)
  return { runtime, pump, send, valid, position }
}
function cabin(data: RuntimeData) {
  data.construction.buildings = [{ id: 'b1', blueprintId: 'cabin', origin: { x: 7, y: 10 }, rotation: 0,
    parts: Object.fromEntries(BLUEPRINTS[0].parts.map(part => [part.id, { built: true, hp: part.hp, xpGranted: true }])) }]
  data.construction.nextId = 2; data.construction.xp = 70
}

describe('companion uses shared continuous navigation', () => {
  it('walks straight at distance-based speed to a fractional target without moving the player', async () => {
    const h = harness(), start = h.position(), target = { x: 9.25, y: 10.2 }
    const player = h.runtime.getSaveData().motion
    expect(await h.send({ type: 'companion-move', target })).toMatchObject({ accepted: true })
    expect(pointDistance(start, h.position())).toBeCloseTo(SURVIVAL_RULES.companion.speed * .05)
    expect(h.position().x).toBeGreaterThan(start.x); expect(h.position().y).toBeGreaterThan(start.y)
    expect(h.valid().survival.companion.route).toEqual([target])
    h.pump(3)
    expect(h.position()).toEqual(target)
    expect(h.valid().survival.companion).toMatchObject({ mode: 'guard', guard: target, progress: 0 })
    expect(h.valid().motion).toEqual(player)
  })
  it('retargets immediately mid-step, and an invalid destination preserves the accepted order', async () => {
    const h = harness()
    await h.send({ type: 'companion-move', target: { x: 10.25, y: 10.2 } }); h.pump(.15)
    const before = h.position(), target = { x: 5.8, y: 10.3 }
    await h.send({ type: 'companion-move', target })
    expect(h.position().x).toBeLessThan(before.x)
    expect(h.position().y).toBeGreaterThan(before.y)
    expect(pointDistance(before, h.position())).toBeCloseTo(SURVIVAL_RULES.companion.speed * .05)
    expect(await h.send({ type: 'companion-move', target: { x: NaN, y: 100 } })).toMatchObject({ accepted: false })
    expect(h.valid().survival.companion.guard).toEqual(target)
    h.pump(2); expect(h.position()).toEqual(target)
  })
  it('routes around walls through the friendly door and rejects a forged saved shortcut', async () => {
    const data = prepared(); cabin(data)
    const start = { x: 6, y: 10 }, target = { x: 8.2, y: 11.15 }
    data.survival.companion.cell = start; data.survival.companion.guard = start
    const grid = constructionNavigation(world, data.construction), h = harness(data)
    expect(canWalkLine(grid, start, target)).toBe(false)
    expect(await h.send({ type: 'companion-move', target })).toMatchObject({ accepted: true })
    const forged = envelopeFixture(h.valid()); forged.data.survival.companion.route = [target]
    expect(() => validateSave(forged, world, catalog)).toThrow('伙伴路线')
    let previous = h.position()
    for (let i = 0; i < 200 && pointDistance(previous, target) > 1e-6; i++) {
      h.pump(.05); const current = h.position()
      expect(canWalkLine(grid, previous, current)).toBe(true)
      expect(pointDistance(previous, current)).toBeLessThanOrEqual(SURVIVAL_RULES.companion.speed * .05 + 1e-6)
      previous = current
    }
    expect(h.position()).toEqual(target); h.valid()
  })
  it('pauses and restores exact position/routes, including old mid-cell saves without snapping', async () => {
    const data = prepared()
    Object.assign(data.survival.companion, { mode: 'move', guard: { x: 9, y: 9 }, progress: .4,
      route: [{ x: 7, y: 9 }, { x: 8, y: 9 }, { x: 9, y: 9 }], target: { kind: 'point', cell: { x: 9, y: 9 } } })
    const h = harness(validateSave(envelopeFixture(data), world, catalog).data)
    expect(h.position()).toEqual({ x: 6.4, y: 9 }); h.pump(.05)
    expect(h.position().x).toBeCloseTo(6.5)
    const saved = h.valid(), restored = harness(saved)
    expect(restored.valid().survival.companion).toEqual(saved.survival.companion)
    restored.runtime.setPauseReason('background', true); restored.pump(10)
    expect(restored.position()).toEqual(actorPosition(saved.survival.companion))
    restored.runtime.setPauseReason('background', false); restored.pump(3)
    expect(restored.position()).toEqual({ x: 9, y: 9 })
    expect(restored.valid().survival.companion.cell).toEqual(pointCell(restored.position()))
  })
  it('follows the actual player position, and keeps legacy rest saves compatible without regeneration', async () => {
    const data = prepared(); data.cell = { x: 9, y: 10 }; data.motion = { version: 1, position: { x: 9.25, y: 10.2 } }
    const h = harness(data)
    expect(await h.send({ type: 'companion-mode', mode: 'follow' })).toMatchObject({ accepted: true })
    h.pump(3); expect(h.position()).toEqual(data.motion.position)
    const legacy = envelopeFixture(prepared()) as any
    legacy.data.survival.companion.mode = 'rest'; legacy.data.survival.companion.hp = 100
    const migrated = harness(validateSave(legacy, world, catalog).data); migrated.pump(5)
    expect(migrated.valid().survival.companion).toMatchObject({ hp: 100, mode: 'guard' })
  })
})
