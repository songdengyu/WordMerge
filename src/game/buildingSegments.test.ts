import { describe, expect, it } from 'vitest'
import { GameRuntime, type GameCommand } from './GameRuntime'
import { BLUEPRINTS } from './buildingConfig'
import { buildingSegments, segmentHp } from './buildingSegments'
import { constructionDamage, constructionNavigation, localToWorld, upgradeConstruction, type Rotation } from './construction'
import { dataFixture, envelopeFixture, productionFixture, testNow, worldFixture } from './testFixtures'
import { validateSave, type RuntimeData } from './saveData'
import { createSurvival } from './survival'

const world = worldFixture(), catalog = productionFixture(), blueprint = BLUEPRINTS[0]
function home(complete = true) {
  const data = dataFixture()
  data.cell = { x: 8, y: 11 }
  data.construction.buildings = [{ id: 'b1', blueprintId: 'cabin', origin: { x: 7, y: 10 }, rotation: 0,
    parts: Object.fromEntries(blueprint.parts.map(config => [config.id, { built: complete, xpGranted: complete, hp: complete ? config.hp : 0 }])) }]
  data.construction.nextId = 2; data.construction.xp = complete ? 70 : 0
  return data
}
function add(data: RuntimeData, ...materials: number[]) {
  for (const itemId of materials) {
    const inv = data.production.inventory, index = inv.board.findIndex(slot => !slot.instanceId && slot.lock === 0), id = `i${inv.nextId++}`
    inv.board[index].instanceId = id; inv.items[id] = { id, itemId, location: { kind: 'board', index }, reservedBy: null }
  }
}
function run(data: RuntimeData) {
  const runtime = new GameRuntime(world, { catalog, saved: envelopeFixture(data), now: () => testNow })
  let frame = 0; runtime.advanceFrame(0)
  const pump = (seconds: number) => { for (let i = 0; i < Math.round(seconds * 20); i++) runtime.advanceFrame(frame += 50) }
  const send = async (command: GameCommand) => { const pending = runtime.dispatch(command); pump(.05); return pending }
  const saved = () => validateSave(JSON.parse(runtime.exportSave()), world, catalog).data
  return { runtime, pump, send, saved }
}

describe('group construction, individual damage and repair', () => {
  it('builds every floor tile and wall segment once with the original group cost, time and XP', async () => {
    const data = home(false); add(data, 202, 202, 202)
    const h = run(data)
    for (const partId of ['foundation', 'walls']) {
      expect(await h.send({ type: 'building-interact', buildingId: 'b1', partId })).toMatchObject({ accepted: true })
      expect(h.saved().construction.jobs[0].remaining).toBe(2)
      h.pump(2)
      const part = h.saved().construction.buildings[0].parts[partId], config = blueprint.parts.find(part => part.id === partId)!
      expect(Object.values(part.segments!)).toEqual(Array(buildingSegments(blueprint, config).length).fill(config.hp))
    }
    expect(h.saved().construction.xp).toBe(30)
    expect(h.saved().construction.orders).toEqual([])
    expect(await h.send({ type: 'building-interact', buildingId: 'b1', partId: 'walls' })).toMatchObject({ accepted: false })
  })

  it('opens only the attacked wall edge in each rotation, and floor/roof damage stays on one tile', () => {
    for (const rotation of [0, 1, 2, 3] as Rotation[]) {
      const data = home(), b = data.construction.buildings[0]; b.rotation = rotation; b.origin = { x: 8, y: 11 }
      const result = constructionDamage(data.construction, data.production, { buildingId: b.id, partId: 'walls', segmentId: 'edge1' }, 999)
      const wall = result.state.buildings[0].parts.walls
      expect(wall.segments!.edge1).toBe(0); expect(wall.segments!.edge0).toBe(40)
      const grid = constructionNavigation(world, result.state, 'enemy')
      expect(grid.canStep(localToWorld(b, { x: 1, y: 0 }), localToWorld(b, { x: 1, y: -1 }))).toBe(true)
      expect(grid.canStep(localToWorld(b, { x: 0, y: 0 }), localToWorld(b, { x: 0, y: -1 }))).toBe(false)
    }
    for (const partId of ['foundation', 'roof']) {
      const data = home(), result = constructionDamage(data.construction, data.production, { buildingId: 'b1', partId, segmentId: 'tile1-0' }, 999)
      const part = result.state.buildings[0].parts[partId], max = blueprint.parts.find(config => config.id === partId)!.hp
      expect(part.segments!['tile1-0']).toBe(0); expect(part.segments!['tile0-0']).toBe(max)
      expect(data.construction.buildings[0].parts[partId].hp).toBe(max)
    }
  })

  it('reserves distinct repairs, protects just the working segment and resumes paid work without healing neighbors', async () => {
    const data = home(); add(data, 202, 202)
    const h = run(data)
    for (const segmentId of ['edge0', 'edge1']) h.runtime.applyDamage({ buildingId: 'b1', partId: 'walls', segmentId }, 8)
    expect(await h.send({ type: 'building-interact', buildingId: 'b1', partId: 'walls', segmentId: 'edge0' })).toMatchObject({ accepted: true })
    expect(h.saved().construction.jobs[0].phase).toBe('building')
    h.runtime.applyDamage({ buildingId: 'b1', partId: 'walls', segmentId: 'edge0' }, 90)
    h.runtime.applyDamage({ buildingId: 'b1', partId: 'walls', segmentId: 'edge1' }, 2)
    const before = h.saved()
    expect(before.construction.buildings[0].parts.walls.segments).toMatchObject({ edge0: 32, edge1: 30 })
    const restored = run(before); restored.pump(2)
    expect(restored.saved().construction.buildings[0].parts.walls.segments).toMatchObject({ edge0: 40, edge1: 30 })
    expect(restored.saved().production.inventory).toEqual(before.production.inventory)
    expect(restored.saved().construction.xp).toBe(70)
    expect(await restored.send({ type: 'building-interact', buildingId: 'b1', partId: 'walls', segmentId: 'edge0' })).toMatchObject({ accepted: false })
    expect(await restored.send({ type: 'building-interact', buildingId: 'b1', partId: 'walls', segmentId: 'edge1' })).toMatchObject({ accepted: true })
    restored.pump(2)
    expect(restored.saved().construction.buildings[0].parts.walls.hp).toBe(40)
  })

  it('migrates old reserved and paid group repairs without losing timing, inventory, position or XP', () => {
    for (const phase of ['queued', 'building'] as const) {
      const data = home(); data.construction.buildings[0].parts.walls.hp = 10
      add(data, 201)
      const item = Object.values(data.production.inventory.items).find(item => item.itemId === 201)!
      data.construction.orders = [{ id: 'b1:walls', buildingId: 'b1', partId: 'walls', mode: 'repair' }]
      if (phase === 'queued') item.reservedBy = 'b1:walls'
      else {
        data.production.inventory.board[item.location.index].instanceId = null
        delete data.production.inventory.items[item.id]
      }
      data.construction.jobs = [{ orderId: 'b1:walls', phase, remaining: phase === 'building' ? .8 : 0,
        workCell: phase === 'building' ? data.cell : null, reservedIds: phase === 'queued' ? [item.id] : [] }]
      const old = envelopeFixture(data), migrated = validateSave(old, world, catalog).data
      expect(old.data.construction.orders[0].id).toBe('b1:walls')
      expect(migrated.construction.orders[0]).toMatchObject({ id: 'b1:walls:edge0', segmentId: 'edge0' })
      expect(migrated.construction.jobs[0]).toMatchObject({ ...data.construction.jobs[0], orderId: 'b1:walls:edge0' })
      if (phase === 'queued') expect(migrated.production.inventory.items[item.id].reservedBy).toBe('b1:walls:edge0')
      else expect(migrated.production.inventory).toEqual(data.production.inventory)
      expect(migrated.construction.xp).toBe(70); expect(migrated.cell).toEqual(data.cell)
      expect(validateSave(envelopeFixture(migrated), world, catalog).data).toEqual(migrated)
    }
  })

  it('rejects corrupt segment maps, summaries and repair targets instead of resetting damage', () => {
    const data = home(); upgradeConstruction(data.construction, data.production.inventory)
    const forged = [
      (d: RuntimeData) => { d.construction.buildings[0].parts.walls.segments!.edge0 = -1 },
      (d: RuntimeData) => { delete d.construction.buildings[0].parts.walls.segments!.edge0 },
      (d: RuntimeData) => { d.construction.buildings[0].parts.walls.hp = 0 },
      (d: RuntimeData) => { d.construction.orders = [{ id: 'b1:walls:nope', buildingId: 'b1', partId: 'walls', mode: 'repair', segmentId: 'nope' }] },
    ]
    for (const mutate of forged) { const copy = structuredClone(data); mutate(copy); expect(() => validateSave(envelopeFixture(copy), world, catalog)).toThrow() }
  })

  it('enemy hits the reachable wall beside its stand, leaving the other segments intact', () => {
    const data = home(); data.elapsedSeconds = (25 - world.config.initialHour) / 24 * world.config.dayDurationSeconds; data.survival = createSurvival(world, data.elapsedSeconds)
    data.survival.enemies = [{ id: 'e1', kind: 'prowler', hp: 32, cell: { x: 9, y: 9 }, route: [], progress: 0, target: null, cooldown: 0 }]
    data.survival.nextEnemyId = 2
    const h = run(data); h.pump(.05)
    const saved = h.saved(), enemy = saved.survival.enemies[0]
    expect(enemy.target).toMatchObject({ kind: 'part', buildingId: 'b1', partId: 'walls', segmentId: 'edge2' })
    expect(segmentHp(saved.construction.buildings[0].parts.walls, 'edge2')).toBeLessThan(40)
    expect(segmentHp(saved.construction.buildings[0].parts.walls, 'edge0')).toBe(40)
  })

  it('accepts precise interior destinations, enters through the door and keeps floor damage walkable', async () => {
    const data = home(); data.cell = { x: 8, y: 13 }
    const h = run(data)
    h.runtime.applyDamage({ buildingId: 'b1', partId: 'foundation', segmentId: 'tile1-0' }, 999)
    const target = { x: 8.2, y: 10.2 }
    expect(await h.send({ type: 'move', target })).toMatchObject({ accepted: true })
    h.pump(3)
    expect(h.saved().motion?.position).toEqual(target)
    expect(h.saved().construction.buildings[0].parts.foundation.segments!['tile1-0']).toBe(0)
  })
})
