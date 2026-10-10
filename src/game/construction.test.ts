import { describe, expect, it, vi } from 'vitest'
import { GameRuntime, type GameCommand } from './GameRuntime'
import { BLUEPRINTS, validateBuildingCatalog } from './buildingConfig'
import { applyConstructionCommand, constructionNavigation, createConstruction, footprint, localToWorld, placementError, type Building, type Rotation } from './construction'
import { applyInventoryCommand, type InventoryCommand } from './inventory'
import { dataFixture, envelopeFixture, productionFixture, testNow, worldFixture } from './testFixtures'
import { legacyConfigVersion, m3ConfigVersion, parseSaveFile, validateSave, type RuntimeData } from './saveData'
import { PathSearch } from './navigation'
import { M3_INITIAL_BUILDING_VERSION } from './migrations/constructionTiming'

const blueprint = BLUEPRINTS[0]
function harness(data = dataFixture()) {
  const world = worldFixture(), catalog = productionFixture()
  const runtime = new GameRuntime(world, { catalog, saved: envelopeFixture(data), now: () => testNow })
  let time = 0
  runtime.advanceFrame(0)
  const pump = (ms: number) => { for (let elapsed = 0; elapsed < ms; elapsed += 50) { time += 50; runtime.advanceFrame(time) } }
  const send = async (command: GameCommand) => { const pending = runtime.dispatch(command); pump(50); return pending }
  return { runtime, world, catalog, pump, send }
}
function supply(data: RuntimeData, ids: number[], warehouse = false) {
  const inventory = data.production.inventory
  return ids.map(itemId => {
    const index = warehouse ? inventory.warehouse.indexOf(null) : inventory.board.findIndex(slot => !slot.instanceId && slot.lock === 0)
    if (index < 0) throw new Error('Fixture has no space')
    const id = `i${inventory.nextId++}`
    inventory.items[id] = { id, itemId, location: { kind: warehouse ? 'warehouse' : 'board', index }, reservedBy: null }
    if (warehouse) inventory.warehouse[index] = id
    else inventory.board[index].instanceId = id
    return id
  })
}
function building(data: RuntimeData, built: string[] = [], origin = { x: 7, y: 10 }) {
  const id = `b${data.construction.nextId++}`
  const entry: Building = { id, blueprintId: 'cabin', origin, rotation: 0, parts: {} }
  for (const config of blueprint.parts) {
    entry.parts[config.id] = { hp: built.includes(config.id) ? config.hp : 0, built: built.includes(config.id), xpGranted: built.includes(config.id) }
    if (built.includes(config.id)) data.construction.xp += config.xp
  }
  data.construction.buildings.push(entry)
  return entry
}

describe('blueprints and edges', () => {
  it('validates catalog references, terrain, locked regions, spacing and all four rotations', () => {
    validateBuildingCatalog(productionFixture())
    const world = worldFixture(), state = createConstruction()
    for (const rotation of [0, 1, 2, 3] as Rotation[]) {
      expect(footprint({ origin: { x: 8, y: 11 }, rotation }, blueprint)).toHaveLength(6)
      expect(localToWorld({ origin: { x: 8, y: 11 }, rotation }, { x: 1, y: 0 })).toEqual([{ x: 9, y: 11 }, { x: 8, y: 12 }, { x: 7, y: 11 }, { x: 8, y: 10 }][rotation])
    }
    expect(placementError(world, state, 'cabin', { x: 7, y: 10 }, 0, world.config.spawn)).toBeNull()
    for (const origin of [{ x: 1, y: 2 }, { x: 15, y: 7 }, { x: 7, y: -2 }, { x: 8, y: 7 }]) {
      expect(placementError(world, state, 'cabin', origin, 0, world.config.spawn)).not.toBeNull()
    }
    const data = dataFixture(); building(data)
    expect(placementError(world, data.construction, 'cabin', { x: 8, y: 10 }, 0, world.config.spawn)).toContain('通道')
    expect(placementError(world, state, 'cabin', { x: 7, y: 14 }, 0, world.config.spawn)).not.toBeNull()
  })
  it('walls block both directions; friendly doors and roofs permit movement, enemy doors block', () => {
    const data = dataFixture(); building(data, blueprint.parts.map(part => part.id))
    const world = worldFixture(), friendly = constructionNavigation(world, data.construction), enemy = constructionNavigation(world, data.construction, 'enemy')
    expect(friendly.canStep({ x: 8, y: 10 }, { x: 8, y: 9 })).toBe(false)
    expect(friendly.canStep({ x: 8, y: 9 }, { x: 8, y: 10 })).toBe(false)
    expect(friendly.canStep({ x: 8, y: 11 }, { x: 8, y: 12 })).toBe(true)
    expect(enemy.canStep({ x: 8, y: 11 }, { x: 8, y: 12 })).toBe(false)
    expect(friendly.canStep({ x: 8, y: 10 }, { x: 8, y: 11 })).toBe(true)
    expect(new PathSearch(friendly, { x: 8, y: 10 }, world.config.spawn).advance(768).status).toBe('found')
  })
})

describe('atomic orders and construction', () => {
  it('map bubble interaction opens merge only when short and otherwise atomically reserves a single job', async () => {
    const data = dataFixture(); building(data)
    const first = harness(data)
    expect(await first.send({ type: 'building-interact', buildingId: 'b1', partId: 'foundation' })).toMatchObject({ accepted: true, openProduction: true })
    await first.send({ type: 'building-interact', buildingId: 'b1', partId: 'foundation' })
    const missing = first.runtime.getSaveData()
    expect(missing.construction.orders).toHaveLength(1)
    expect(missing.production.inventory).toEqual(data.production.inventory)
    supply(missing, [202], true)
    const next = harness(missing)
    const command = { type: 'building-interact' as const, buildingId: 'b1', partId: 'foundation' }
    const a = next.runtime.dispatch(command), b = next.runtime.dispatch(command)
    next.pump(50)
    expect(await a).toMatchObject({ accepted: true, openProduction: false })
    expect(await b).toMatchObject({ accepted: false })
    expect(next.runtime.getSaveData().construction.jobs).toHaveLength(1)
    expect(next.runtime.getSaveData().production.inventory.warehouse[0]).toBe(missing.production.inventory.warehouse[0])
    expect(next.runtime.getSaveData().construction.jobs[0].phase).toBe('travel')
  })
  it('finishes new construction and repairs at exactly two active seconds after arrival', async () => {
    for (const repair of [false, true]) {
      const data = dataFixture(), b = building(data, repair ? ['foundation'] : [])
      if (repair) b.parts.foundation.hp = 50
      data.cell = { x: 8, y: 11 }; supply(data, [repair ? 201 : 202])
      const { runtime, send, pump } = harness(data)
      await send({ type: 'building-interact', buildingId: 'b1', partId: 'foundation' })
      expect(runtime.getSaveData().construction.jobs[0].remaining).toBe(2)
      pump(1950)
      expect(runtime.getUiSnapshot().protected).toBe(true)
      pump(50)
      expect(runtime.getSaveData().construction.jobs).toHaveLength(0)
      const foundation = runtime.getSaveData().construction.buildings[0].parts.foundation
      expect(foundation.segments!['tile0-0']).toBe(100)
      expect(foundation.segments!['tile1-0']).toBe(repair ? 50 : 100)
      expect(runtime.getSaveData().construction.xp).toBe(10)
    }
    expect(blueprint.parts.every(part => part.seconds === 2 && part.repairSeconds === 2)).toBe(true)
  })
  it('opens one stable order and reserves duplicates across board and full warehouse without deducting on travel', async () => {
    const data = dataFixture(); building(data, ['foundation'])
    const boardIds = supply(data, [202]), warehouseIds = supply(data, [202, 211, 211, 211, 211, 211], true)
    const { runtime, send } = harness(data)
    for (let i = 0; i < 2; i++) expect((await send({ type: 'building-order', buildingId: 'b1', partId: 'walls' })).accepted).toBe(true)
    expect(runtime.getUiSnapshot().construction.orders).toHaveLength(1)
    expect((await send({ type: 'building-claim', orderId: 'b1:walls' })).accepted).toBe(true)
    const saved = runtime.getSaveData(), reserved = saved.construction.jobs[0].reservedIds
    expect(reserved).toEqual([boardIds[0], warehouseIds[0]])
    expect(saved.construction.jobs[0].phase).toBe('travel')
    expect(reserved.every(id => saved.production.inventory.items[id].reservedBy === 'b1:walls')).toBe(true)
    expect((await send({ type: 'building-claim', orderId: 'b1:walls' })).accepted).toBe(false)
    expect((await send({ type: 'building-cancel', orderId: 'b1:walls' })).accepted).toBe(true)
    const cancelled = runtime.getSaveData()
    expect(cancelled.construction.jobs).toHaveLength(0)
    expect(cancelled.production.inventory.board).toEqual(data.production.inventory.board)
    expect(cancelled.production.inventory.warehouse).toEqual(data.production.inventory.warehouse)
    expect(Object.values(cancelled.production.inventory.items).every(item => item.reservedBy === null)).toBe(true)
  })
  it('all item mutations and other orders reject a reserved item, including merge targets', () => {
    const data = dataFixture(); building(data, ['foundation'])
    const ids = supply(data, [202, 202, 202])
    const world = worldFixture(), catalog = productionFixture()
    const opened = applyConstructionCommand(data.construction, data.production, world, data.cell, { type: 'building-order', buildingId: 'b1', partId: 'walls' })
    if (!opened.accepted) throw new Error('Expected order')
    const claimed = applyConstructionCommand(opened.state, opened.production, world, data.cell, { type: 'building-claim', orderId: 'b1:walls' })
    if (!claimed.accepted) throw new Error('Expected reservation')
    const targetIndex = claimed.production.inventory.items[ids[0]].location.index
    const commands: InventoryCommand[] = [
      { type: 'item-use', instanceId: ids[0] }, { type: 'item-store', instanceId: ids[0] }, { type: 'item-discard', instanceId: ids[0] },
      { type: 'item-move', instanceId: ids[0], targetIndex: 6, expectedTarget: null }, { type: 'order-complete', orderId: 1 },
      { type: 'item-move', instanceId: ids[2], targetIndex, expectedTarget: ids[0] },
    ]
    for (const command of commands) expect(applyInventoryCommand(claimed.production, catalog, command, testNow).accepted).toBe(false)
  })
  it('releases unreachable travel without consuming or moving reserved instances', async () => {
    const data = dataFixture(); building(data); supply(data, [202])
    const { runtime, send, pump } = harness(data)
    await send({ type: 'building-order', buildingId: 'b1', partId: 'foundation' })
    const blocked = vi.spyOn(runtime.world, 'canStep').mockReturnValue(false)
    await send({ type: 'building-claim', orderId: 'b1:foundation' }); pump(200)
    expect(runtime.getSaveData().construction.jobs).toHaveLength(0)
    expect(runtime.getSaveData().production.inventory).toEqual(data.production.inventory)
    blocked.mockRestore()
  })
  it('deducts on arrival, rejects interrupting work, permits production and consumption, saves progress without offline construction', async () => {
    const data = dataFixture(); building(data); const [plank] = supply(data, [202])
    const { runtime, send, pump, world, catalog } = harness(data)
    await send({ type: 'building-order', buildingId: 'b1', partId: 'foundation' })
    await send({ type: 'building-claim', orderId: 'b1:foundation' })
    expect(runtime.getSaveData().production.inventory.items[plank]).toBeDefined()
    runtime.applyDamage('player', 7)
    expect(runtime.getSaveData().production.vitals.hp).toBe(93)
    const travelSave = validateSave(JSON.parse(runtime.exportSave()), world, catalog)
    expect(travelSave.data.construction.jobs[0].phase).toBe('travel')
    pump(2000)
    expect(runtime.getUiSnapshot().activity).toBe('building')
    expect(runtime.getSaveData().production.inventory.items[plank]).toBeUndefined()
    expect((await send({ type: 'move', target: { x: 7, y: 9 } })).accepted).toBe(false)
    expect((await send({ type: 'building-cancel', orderId: 'b1:foundation' })).accepted).toBe(false)
    expect((await send({ type: 'item-use', instanceId: data.production.inventory.board[9].instanceId! })).accepted).toBe(true)
    expect((await send({ type: 'item-use', instanceId: data.production.inventory.board[0].instanceId! })).accepted).toBe(true)
    runtime.applyDamage('player', 999)
    expect(runtime.getSaveData().production.vitals.hp).toBe(93)
    runtime.setPauseReason('background', true)
    const before = runtime.getSaveData()
    pump(30_000)
    expect(runtime.getSaveData().construction).toEqual(before.construction)
    runtime.setPauseReason('background', false)
    const saved = validateSave(JSON.parse(runtime.exportSave()), world, catalog)
    const restored = new GameRuntime(worldFixture(), { catalog, saved, now: () => testNow + 86_400_000 })
    expect(restored.getSaveData().construction).toEqual(before.construction)
    expect(restored.getUiSnapshot().protected).toBe(true)
    pump(10_000)
    expect(runtime.getSaveData().construction.xp).toBe(10)
    expect(runtime.getSaveData().construction.jobs).toHaveLength(0)
    runtime.applyDamage('player', 1)
    expect(runtime.getSaveData().production.vitals.hp).toBe(92)
    const complete = validateSave(JSON.parse(runtime.exportSave()), world, catalog)
    expect(new GameRuntime(worldFixture(), { catalog, saved: complete }).getSaveData().construction.xp).toBe(10)
    expect((await send({ type: 'building-order', buildingId: 'b1', partId: 'foundation' })).accepted).toBe(false)
  })
  it('queues later work and only protects the current repair, restoring broken blocking at completion without XP farming', async () => {
    const data = dataFixture(); const b = building(data, ['foundation', 'walls', 'door'])
    b.parts.walls.hp = 0; b.parts.door.hp = 20
    data.cell = { x: 8, y: 11 }
    supply(data, [202, 201])
    const { runtime, send, pump, world } = harness(data)
    await send({ type: 'building-order', buildingId: 'b1', partId: 'walls', segmentId: 'edge1' })
    await send({ type: 'building-claim', orderId: 'b1:walls:edge1' })
    expect(runtime.getUiSnapshot().protected).toBe(true)
    await send({ type: 'building-order', buildingId: 'b1', partId: 'door' })
    await send({ type: 'building-claim', orderId: 'b1:door' })
    expect(runtime.getSaveData().construction.jobs.map(job => job.phase)).toEqual(['building', 'queued'])
    runtime.applyDamage({ buildingId: 'b1', partId: 'walls', segmentId: 'edge1' }, 999)
    runtime.applyDamage({ buildingId: 'b1', partId: 'door' }, 5)
    expect(runtime.getSaveData().construction.buildings[0].parts.door.hp).toBe(15)
    expect(constructionNavigation(world, runtime.getSaveData().construction).canStep({ x: 8, y: 10 }, { x: 8, y: 9 })).toBe(true)
    const saved = validateSave(JSON.parse(runtime.exportSave()), world, productionFixture())
    expect(saved.data.construction.jobs).toHaveLength(2)
    await send({ type: 'building-cancel', orderId: 'b1:door' })
    pump(6000)
    expect(constructionNavigation(world, runtime.getSaveData().construction).canStep({ x: 8, y: 10 }, { x: 8, y: 9 })).toBe(false)
    expect(runtime.getSaveData().construction.xp).toBe(40)
    expect(runtime.getSaveData().construction.buildings[0].parts.walls.segments!.edge1).toBe(40)
    expect(runtime.getSaveData().construction.buildings[0].parts.walls.segments!.edge0).toBe(0)
  })
  it('completes a full house in dependency order and retains a usable door and exactly one XP award per part', async () => {
    const data = dataFixture(); building(data); supply(data, [202, 202, 202, 201, 201, 203, 202, 202])
    const { runtime, send, pump, world, catalog } = harness(data)
    for (const config of blueprint.parts) {
      expect((await send({ type: 'building-order', buildingId: 'b1', partId: config.id })).accepted).toBe(true)
      expect((await send({ type: 'building-claim', orderId: `b1:${config.id}` })).accepted).toBe(true)
      pump((config.seconds + 8) * 1000)
      expect(runtime.getSaveData().construction.buildings[0].parts[config.id].built).toBe(true)
      validateSave(JSON.parse(runtime.exportSave()), world, catalog)
    }
    expect(runtime.getSaveData().construction.xp).toBe(70)
    const result = await send({ type: 'move', target: world.config.spawn })
    expect(result.accepted).toBe(true); pump(10_000)
    expect(runtime.getUiSnapshot().player).toEqual(world.config.spawn)
  })
  it('keeps queue reservations after reload, rejects material contention and completes queued jobs in order', async () => {
    const data = dataFixture(); building(data); building(data, [], { x: 11, y: 7 })
    supply(data, [202])
    const { runtime, send, world, catalog } = harness(data)
    for (const id of ['b1', 'b2']) await send({ type: 'building-order', buildingId: id, partId: 'foundation' })
    await send({ type: 'building-claim', orderId: 'b1:foundation' })
    expect((await send({ type: 'building-claim', orderId: 'b2:foundation' })).accepted).toBe(false)
    const pending = runtime.getSaveData(); supply(pending, [202])
    const second = harness(pending)
    await second.send({ type: 'building-claim', orderId: 'b2:foundation' })
    const saved = validateSave(JSON.parse(second.runtime.exportSave()), world, catalog)
    expect(saved.data.construction.jobs.map(job => job.phase)).toEqual(['travel', 'queued'])
    const restored = harness(saved.data)
    restored.pump(30_000)
    expect(restored.runtime.getSaveData().construction.jobs).toHaveLength(0)
    expect(restored.runtime.getSaveData().construction.xp).toBe(20)
    expect(Object.values(restored.runtime.getSaveData().production.inventory.items).every(item => item.reservedBy === null)).toBe(true)
  })
  it('protects a damaged component throughout its repair while other structures can still take damage', async () => {
    const data = dataFixture(); const b = building(data, ['foundation', 'walls', 'door'])
    b.parts.walls.hp = 10; data.cell = { x: 8, y: 11 }; supply(data, [202])
    const { runtime, send, pump } = harness(data)
    await send({ type: 'building-order', buildingId: 'b1', partId: 'walls' })
    await send({ type: 'building-claim', orderId: 'b1:walls:edge0' })
    runtime.applyDamage({ buildingId: 'b1', partId: 'walls', segmentId: 'edge0' }, 99)
    runtime.applyDamage({ buildingId: 'b1', partId: 'door' }, 25)
    expect(runtime.getSaveData().construction.buildings[0].parts.walls.hp).toBe(10)
    expect(runtime.getSaveData().construction.buildings[0].parts.door.hp).toBe(75)
    pump(6000)
    expect(runtime.getSaveData().construction.buildings[0].parts.walls.segments!.edge0).toBe(40)
    expect(runtime.getSaveData().construction.xp).toBe(40)
    runtime.applyDamage({ buildingId: 'b1', partId: 'walls' }, 1)
    expect(runtime.getSaveData().construction.buildings[0].parts.walls.segments!.edge0).toBe(39)
  })
})

describe('M2 migration and M3 validation', () => {
  it('migrates the exact previous M3 catalog, validates old timing, preserves work ratio and never changes inventory or XP', async () => {
    for (const repair of [false, true]) {
      const data = dataFixture(), b = building(data, repair ? ['foundation', 'walls'] : ['foundation'])
      if (repair) b.parts.walls.hp = 10
      data.cell = { x: 8, y: 11 }; supply(data, repair ? [202] : [202, 202])
      const { runtime, send, world, catalog } = harness(data)
      await send({ type: 'building-interact', buildingId: 'b1', partId: 'walls' })
      const old = JSON.parse(runtime.exportSave())
      const currentBuildings = structuredClone(old.data.construction.buildings)
      const walls = old.data.construction.buildings[0].parts.walls
      walls.hp *= 4
      for (const id of Object.keys(walls.segments)) walls.segments[id] *= 4
      old.schemaVersion = 2; delete old.data.survival
      old.configVersion = m3ConfigVersion(world, catalog).replace(/[^-]+$/, M3_INITIAL_BUILDING_VERSION)
      old.data.construction.jobs[0].remaining = repair ? 3 : 8
      const migrated = validateSave(old, world, catalog)
      expect(migrated.data.construction.jobs[0].remaining).toBeCloseTo(repair ? 1.2 : 1.6)
      expect(migrated.data.production).toEqual(old.data.production)
      expect(migrated.data.construction.buildings).toEqual(currentBuildings)
      expect(migrated.data.construction.xp).toBe(old.data.construction.xp)
      expect(validateSave(migrated, world, catalog)).toEqual(migrated)
      expect(old.data.construction.jobs[0].remaining).toBe(repair ? 3 : 8)
      old.data.construction.jobs[0].remaining = 100
      expect(() => validateSave(old, world, catalog)).toThrow('计时')
      expect(() => validateSave({ ...old, configVersion: old.configVersion.replace(/[^-]+$/, 'unknown') }, world, catalog)).toThrow('不匹配')
    }
  })
  it('migrates only compatible schema 1, preserves all previous data, and does not grant blueprints or XP twice', () => {
    const current = envelopeFixture(), world = worldFixture(), catalog = productionFixture()
    current.data.production.stamina.value = 140
    current.data.production.inventory.completedOrders = [1, 2]
    current.data.elapsedSeconds = 431
    const oldData = { ...current.data } as Partial<RuntimeData>; delete oldData.construction
    const old = { ...current, schemaVersion: 1, configVersion: legacyConfigVersion(world, catalog), data: oldData }
    const migrated = parseSaveFile(JSON.stringify(old), world, catalog)
    expect(migrated.schemaVersion).toBe(4)
    expect(migrated.data.production).toEqual(oldData.production)
    expect(migrated.data.elapsedSeconds).toBe(431)
    expect(migrated.data.construction).toEqual(createConstruction())
    expect(validateSave(migrated, world, catalog)).toEqual(migrated)
    expect(old.data.construction).toBeUndefined()
    expect(() => validateSave({ ...old, configVersion: 'wrong' }, world, catalog)).toThrow('不匹配')
  })
  it('rejects orphan reservations, wrong XP, unknown parts, impossible work and routes through completed walls', async () => {
    const data = dataFixture(); building(data, ['foundation']); supply(data, [202, 202])
    const { runtime, send, world, catalog } = harness(data)
    await send({ type: 'building-order', buildingId: 'b1', partId: 'walls' })
    await send({ type: 'building-claim', orderId: 'b1:walls' })
    const save = JSON.parse(runtime.exportSave())
    const mutations = [
      (s: typeof save) => { s.data.construction.jobs = [] },
      (s: typeof save) => { s.data.construction.xp = 999 },
      (s: typeof save) => { s.data.construction.orders[0].partId = 'missing' },
      (s: typeof save) => { s.data.construction.jobs[0].workCell = { x: 0, y: 0 } },
      (s: typeof save) => { s.data.construction.jobs[0].reservedIds[1] = s.data.construction.jobs[0].reservedIds[0] },
    ]
    for (const mutate of mutations) { const invalid = structuredClone(save); mutate(invalid); expect(() => validateSave(invalid, world, catalog)).toThrow() }
    const blocked = dataFixture(); building(blocked, ['foundation', 'walls'])
    blocked.cell = { x: 8, y: 9 }; blocked.route = [{ x: 8, y: 10 }]; blocked.destination = { x: 8, y: 10 }
    expect(() => validateSave(envelopeFixture(blocked), world, catalog)).toThrow('木墙')
  })
})
