import { describe, expect, it } from 'vitest'
import { GameRuntime, type GameCommand } from './GameRuntime'
import { actorPosition, advanceSurvival, createSurvival, enemyNavigation, type Enemy } from './survival'
import { ENEMIES, type EnemyKind } from './survivalConfig'
import { canWalkLine, pointCell, pointDistance } from './smoothNavigation'
import { constructionNavigation } from './construction'
import { BLUEPRINTS } from './buildingConfig'
import { validateSave, type RuntimeData } from './saveData'
import { dataFixture, envelopeFixture, productionFixture, testNow, worldFixture } from './testFixtures'

const world = worldFixture(), catalog = productionFixture()
function prepared(kind: EnemyKind = 'prowler') {
  const data = dataFixture()
  data.elapsedSeconds = 650; data.survival = createSurvival(world, data.elapsedSeconds)
  data.survival.spawnRemaining = 80
  data.cell = { x: 9, y: 10 }; data.motion = { version: 1, position: { x: 9.25, y: 10.2 } }
  data.survival.enemies = [{ id: 'e1', kind, hp: ENEMIES[kind].hp, cell: { x: 6, y: 9 },
    route: [], progress: 0, target: null, cooldown: 0 }]
  data.survival.nextEnemyId = 2
  return data
}
function harness(data = prepared()) {
  const runtime = new GameRuntime(world, { catalog, saved: envelopeFixture(data), now: () => testNow })
  let frame = 0; runtime.advanceFrame(frame)
  const pump = (seconds: number) => { for (let i = 0; i < Math.round(seconds * 20); i++) runtime.advanceFrame(frame += 50) }
  const send = async (command: GameCommand) => { const pending = runtime.dispatch(command); pump(.05); return pending }
  const valid = () => validateSave(JSON.parse(runtime.exportSave()), world, catalog).data
  const enemy = () => runtime.getSaveData().survival.enemies[0]
  const position = () => actorPosition(enemy())
  return { runtime, pump, send, valid, enemy, position }
}
function cabin(data: RuntimeData) {
  const building = { id: 'b1', blueprintId: 'cabin', origin: { x: 7, y: 10 }, rotation: 0 as const,
    parts: Object.fromEntries(BLUEPRINTS[0].parts.map(part => [part.id, { built: true, hp: part.hp, xpGranted: true }])) }
  data.construction.buildings = [building]; data.construction.nextId = 2; data.construction.xp = 70
  return building
}

describe('enemies share continuous navigation with player and companion', () => {
  it.each(['prowler', 'boar'] as const)('%s walks diagonally to the exact target at its own configured speed', kind => {
    const data = prepared(kind), h = harness(data), start = h.position()
    h.pump(.05)
    expect(pointDistance(start, h.position())).toBeCloseTo(ENEMIES[kind].speed * .05)
    expect(h.position().x).toBeGreaterThan(start.x); expect(h.position().y).toBeGreaterThan(start.y)
    expect(h.valid().survival.enemies[0]).toMatchObject({ progress: 0, route: [data.motion!.position], target: { kind: 'player' } })
    expect(h.runtime.getSceneSnapshot().previousEnemyPositions.e1).toEqual(start)
    const before = h.position(); h.pump(.05)
    expect(h.runtime.getSceneSnapshot().previousEnemyPositions.e1).toEqual(before)
  })
  it('replans from its current point as the player moves instead of completing the old cell first', async () => {
    const h = harness(); h.pump(.2)
    expect(await h.send({ type: 'move', target: { x: 9.2, y: 7.1 } })).toMatchObject({ accepted: true })
    for (let i = 0; i < 22; i++) {
      const before = h.position(); h.pump(.05)
      expect(pointDistance(before, h.position())).toBeCloseTo(ENEMIES.prowler.speed * .05)
    }
    expect(h.enemy().route[h.enemy().route.length - 1].y).toBeLessThan(9)
    h.valid()
  })
  it('routes around a house without cutting across walls or corners', () => {
    const data = prepared(); cabin(data)
    data.cell = { x: 10, y: 10 }; data.motion = { version: 1, position: data.cell }
    data.survival.enemies[0].cell = { x: 6, y: 10 }
    const grid = constructionNavigation(world, data.construction, 'enemy'), h = harness(data)
    expect(canWalkLine(grid, h.position(), data.cell)).toBe(false)
    h.pump(.05); expect(h.enemy().route.length).toBeGreaterThan(1)
    for (let i = 0; i < 140 && pointDistance(h.position(), data.cell) > 1e-6; i++) {
      const before = h.position(); h.pump(.05)
      expect(canWalkLine(grid, before, h.position())).toBe(true)
      expect(pointDistance(before, h.position())).toBeLessThanOrEqual(ENEMIES.prowler.speed * .05 + 1e-7)
    }
    expect(h.position()).toEqual(data.cell); h.valid()
  })
  it('cannot pass an intact door or damage the player through it, and rejects forged shortcuts', () => {
    const data = prepared(); cabin(data)
    data.cell = { x: 8, y: 11 }; data.motion = { version: 1, position: data.cell }
    data.survival.enemies[0].cell = { x: 8, y: 12 }
    const h = harness(data); h.pump(1)
    expect(h.position()).toEqual({ x: 8, y: 12 })
    expect(h.valid().production.vitals.hp).toBe(data.production.vitals.hp)
    expect(h.valid().construction.buildings[0].parts.door.hp).toBeLessThan(100)
    const forged = envelopeFixture(h.valid()); forged.data.survival.enemies[0].route = [data.cell]
    expect(() => validateSave(forged, world, catalog)).toThrow('敌人路线')
  })
  it('uses actual contact distance for player damage while preserving attack intervals', () => {
    const data = prepared(); data.cell = { x: 7, y: 8 }; data.motion = { version: 1, position: { x: 7.4, y: 8 } }
    data.survival.enemies[0].cell = { x: 6, y: 8 }
    const h = harness(data); h.pump(.05)
    expect(h.valid().production.vitals.hp).toBe(100)
    h.pump(.3); expect(h.valid().production.vitals.hp).toBe(98)
    h.pump(1.9); expect(h.valid().production.vitals.hp).toBe(98)
    h.pump(.15); expect(h.valid().production.vitals.hp).toBe(96)
  })
  it('restores legacy half-step positions, preserves exact new saves and freezes in the background', () => {
    const data = prepared(), enemy = data.survival.enemies[0]
    enemy.progress = .4; enemy.route = [{ x: 7, y: 9 }, { x: 8, y: 9 }]; enemy.target = { kind: 'player' }
    const h = harness(validateSave(envelopeFixture(data), world, catalog).data)
    expect(h.position()).toEqual({ x: 6.4, y: 9 })
    const before = h.position(); h.pump(.05)
    expect(pointDistance(before, h.position())).toBeCloseTo(.06)
    const saved = h.valid(), restored = harness(saved)
    expect(restored.enemy()).toEqual(saved.survival.enemies[0])
    restored.runtime.setPauseReason('background', true); restored.pump(5)
    expect(restored.enemy()).toEqual(saved.survival.enemies[0])
    restored.runtime.setPauseReason('background', false); restored.pump(.1)
    expect(pointDistance(restored.position(), actorPosition(saved.survival.enemies[0]))).toBeGreaterThan(0)
    restored.valid()
  })
  it('rechecks a repaired door and keeps an overlapping enemy on its current side', () => {
    const data = prepared(), building = cabin(data), enemy = data.survival.enemies[0]
    data.cell = { x: 8, y: 11 }; data.motion = { version: 1, position: data.cell }
    building.parts.door.hp = 0
    enemy.cell = { x: 8, y: 12 }; enemy.motion = { version: 1, position: { x: 8, y: 11.6 } }
    enemy.route = [data.cell]; enemy.target = { kind: 'player' }; data.survival.decisionRemaining = .5
    // Repair completes while the enemy is approaching the opening.
    building.parts.door.hp = 100
    const result = advanceSurvival(data.survival, data.production, data.construction, world, data.cell, 1140, .05)
    const moved = result.state.enemies[0], grid = constructionNavigation(world, result.construction, 'enemy')
    expect(pointCell(actorPosition(moved))).toEqual(enemy.cell)
    expect(canWalkLine(grid, actorPosition(moved), actorPosition(moved))).toBe(true)
    expect(moved.route).toEqual([])
    expect(result.production.vitals.hp).toBe(100)
  })
  it('keeps smooth regional pursuit and saved routes inside the brook, including fractional border points', () => {
    const data = dataFixture(); cabin(data); data.progression.unlockedRegions = ['brook']
    const seeded = harness(data).valid(), boar = seeded.survival.enemies[0]
    seeded.cell = { x: 7, y: -1 }; seeded.motion = { version: 1, position: { x: 7.2, y: -.7 } }
    boar.cell = { x: 7, y: -3 }
    const h = harness(seeded)
    const grid = enemyNavigation(h.runtime.world, constructionNavigation(h.runtime.world, seeded.construction, 'enemy'), boar.residentId)
    for (let i = 0; i < 50; i++) {
      const before = h.position(); h.pump(.05)
      expect(canWalkLine(grid, before, h.position())).toBe(true)
      expect(h.runtime.world.chunkAt(pointCell(h.position()))?.id).toBe('brook')
      h.valid()
    }
    const forged = envelopeFixture(h.valid()), enemy = forged.data.survival.enemies[0] as Enemy
    enemy.route = [{ x: 7, y: 0 }]
    expect(() => validateSave(forged, world, catalog)).toThrow('敌人路线')
    const saved = h.valid(); saved.cell = { x: 7, y: 0 }; saved.motion = { version: 1, position: saved.cell }
    const outside = harness(saved); outside.pump(1)
    expect(outside.enemy().target).toMatchObject({ kind: 'point', cell: { x: 4, y: -12 } })
    outside.valid()
  })
})
