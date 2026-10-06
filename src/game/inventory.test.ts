import { describe, expect, it } from 'vitest'
import { addStamina, spendStamina, syncStamina } from './stamina'
import { activeOrders, applyInventoryCommand, createProduction, matchRequirements, type InventoryCommand, type ProductionState } from './inventory'
import { dataFixture, envelopeFixture, productionFixture, testNow, worldFixture } from './testFixtures'
import { parseSaveFile, validateSave } from './saveData'

const catalog = productionFixture()
function apply(state: ProductionState, command: InventoryCommand, now = testNow) {
  const result = applyInventoryCommand(state, catalog, command, now)
  if (!result.accepted) throw new Error(result.reason)
  return result.state
}
function id(state: ProductionState, index: number) { return state.inventory.board[index].instanceId! }

describe('real stamina clock', () => {
  it('90 + 50 is 140, offline overflow remains 140 without accumulating recovery', () => {
    const stamina = addStamina({ value: 90, anchorMs: testNow, remainderMs: 0 }, 50, testNow)
    expect(stamina.value).toBe(140)
    expect(syncStamina(stamina, testNow + 3_600_000)).toEqual({ value: 140, anchorMs: testNow + 3_600_000, remainderMs: 0 })
  })
  it('restarts recovery only after spending below 100 and cannot bank overflow time', () => {
    const stamina = { value: 140, anchorMs: testNow, remainderMs: 0 }
    const spent = spendStamina(stamina, 41, testNow + 3_600_000)!
    expect(spent).toEqual({ value: 99, anchorMs: testNow + 3_600_000, remainderMs: 0 })
    expect(syncStamina(spent, testNow + 3_609_999).value).toBe(99)
    expect(syncStamina(spent, testNow + 3_610_000).value).toBe(100)
  })
  it('preserves partial recovery through spending, clamps natural recovery and handles a clock rollback', () => {
    const clock = { value: 90, anchorMs: testNow, remainderMs: 3000 }
    const spent = spendStamina(clock, 1, testNow + 3000)!
    expect(syncStamina(spent, testNow + 7000).value).toBe(90)
    expect(syncStamina(clock, testNow + 1_000_000)).toEqual({ value: 100, anchorMs: testNow + 1_000_000, remainderMs: 0 })
    expect(syncStamina(clock, testNow - 5000)).toEqual({ value: 90, anchorMs: testNow - 5000, remainderMs: 0 })
    expect(spendStamina({ ...clock, value: 0 }, 1, testNow)).toBeNull()
  })
})

describe('single inventory authority', () => {
  it('merges into a new unique instance, swaps unlike items, and protects stale drag targets', () => {
    let state = createProduction(catalog, testNow)
    const first = id(state, 7), second = id(state, 8)
    state = apply(state, { type: 'item-move', instanceId: first, targetIndex: 8, expectedTarget: second })
    expect(state.inventory.items[first]).toBeUndefined()
    expect(state.inventory.items[second]).toBeUndefined()
    const merged = id(state, 8)
    expect(state.inventory.items[merged].itemId).toBe(202)
    const berry = id(state, 9)
    state = apply(state, { type: 'item-move', instanceId: merged, targetIndex: 9, expectedTarget: berry })
    expect(id(state, 8)).toBe(berry)
    const before = structuredClone(state)
    expect(applyInventoryCommand(state, catalog, { type: 'item-move', instanceId: merged, targetIndex: 8, expectedTarget: null }, testNow).accepted).toBe(false)
    expect(state).toEqual(before)
  })
  it('warehouse storage/retrieval retains instance identity; invalid drops and stale repeated takes do not duplicate', () => {
    let state = createProduction(catalog, testNow)
    const wood = id(state, 7)
    state = apply(state, { type: 'item-store', instanceId: wood })
    expect(state.inventory.warehouse[0]).toBe(wood)
    expect(state.inventory.board[7].instanceId).toBeNull()
    expect(applyInventoryCommand(state, catalog, { type: 'item-take', instanceId: wood, targetIndex: 0 }, testNow).accepted).toBe(false)
    state = apply(state, { type: 'item-take', instanceId: wood, targetIndex: 7 })
    expect(id(state, 7)).toBe(wood)
    expect(state.inventory.warehouse[0]).toBeNull()
    expect(applyInventoryCommand(state, catalog, { type: 'item-take', instanceId: wood, targetIndex: 8 }, testNow).accepted).toBe(false)
  })
  it('uses consumables directly from the warehouse and stale double-use cannot grant twice', () => {
    let state = createProduction(catalog, testNow)
    state.stamina.value = 90
    const supply = id(state, 5)
    state = apply(state, { type: 'item-store', instanceId: supply })
    state = apply(state, { type: 'item-use', instanceId: supply })
    expect(state.stamina.value).toBe(140)
    expect(state.inventory.items[supply]).toBeUndefined()
    expect(state.inventory.warehouse[0]).toBeNull()
    expect(applyInventoryCommand(state, catalog, { type: 'item-use', instanceId: supply }, testNow).accepted).toBe(false)
    expect(state.stamina.value).toBe(140)
  })
  it('protects generators, reserved items and full-state consumables', () => {
    const state = createProduction(catalog, testNow)
    for (const type of ['item-store', 'item-discard'] as const) expect(applyInventoryCommand(state, catalog, { type, instanceId: id(state, 0) }, testNow).accepted).toBe(false)
    const berry = id(state, 9)
    state.vitals.hunger = 100
    expect(applyInventoryCommand(state, catalog, { type: 'item-use', instanceId: berry }, testNow).accepted).toBe(false)
    state.inventory.items[berry].reservedBy = 'future-work'
    expect(matchRequirements(state.inventory, [211])).toBeNull()
    expect(applyInventoryCommand(state, catalog, { type: 'item-store', instanceId: berry }, testNow).accepted).toBe(false)
  })
  it('unlocks half-locked matching pieces and reveals neighbors only once', () => {
    let state = createProduction(catalog, testNow)
    expect(state.inventory.board[35].lock).toBe(1)
    state = apply(state, { type: 'item-move', instanceId: id(state, 7), targetIndex: 35, expectedTarget: id(state, 35) })
    expect(state.inventory.board[35].lock).toBe(0)
    expect(state.inventory.board[42]).toMatchObject({ lock: 1, rewardClaimed: true })
    expect(state.inventory.gold).toBe(100)
    const moved = id(state, 35)
    state = apply(state, { type: 'item-store', instanceId: moved })
    state = apply(state, { type: 'item-take', instanceId: moved, targetIndex: 35 })
    expect(state.inventory.gold).toBe(100)
  })
  it('counts duplicated order requirements across board/warehouse and completes atomically without animation', () => {
    const initialBoard = catalog.initialBoard.map((slot, index) => [7, 8, 9, 10].includes(index) ? { itemId: 201, lock: 0 as const } : slot)
    let state = createProduction({ ...catalog, initialBoard }, testNow)
    state = apply(state, { type: 'item-move', instanceId: id(state, 7), targetIndex: 8, expectedTarget: id(state, 8) })
    state = apply(state, { type: 'item-move', instanceId: id(state, 9), targetIndex: 10, expectedTarget: id(state, 10) })
    const boardPlank = id(state, 8), warehousePlank = id(state, 10)
    state = apply(state, { type: 'item-store', instanceId: warehousePlank })
    expect(matchRequirements(state.inventory, [202, 202])).toHaveLength(2)
    expect(matchRequirements(state.inventory, [202, 202, 202])).toBeNull()
    state = apply(state, { type: 'order-complete', orderId: 1 })
    expect(state.inventory.items[boardPlank]).toBeUndefined()
    expect(state.inventory.items[warehousePlank]).toBeUndefined()
    expect(state.inventory.completedOrders).toEqual([1])
    expect(state.inventory.gems).toBe(110)
    expect(activeOrders(state.inventory, catalog).map(order => order.id)).toEqual([2, 3, 4])
    expect(Object.values(state.inventory.items).filter(item => item.itemId === 241)).toHaveLength(2)
    const completed = structuredClone(state)
    expect(applyInventoryCommand(state, catalog, { type: 'order-complete', orderId: 1 }, testNow).accepted).toBe(false)
    expect(state).toEqual(completed)
  })
  it('rejects full-board/full-warehouse production without spending stamina or advancing RNG', () => {
    const fullCatalog = { ...catalog, initialBoard: Array.from({ length: 63 }, (_, index) => ({ itemId: index ? 201 : 101, lock: 0 as const })) }
    const state = createProduction(fullCatalog, testNow)
    for (let i = 0; i < 6; i++) {
      const instanceId = `i${state.inventory.nextId++}`
      state.inventory.items[instanceId] = { id: instanceId, itemId: 201, location: { kind: 'warehouse', index: i }, reservedBy: null }
      state.inventory.warehouse[i] = instanceId
    }
    const before = structuredClone(state)
    expect(applyInventoryCommand(state, fullCatalog, { type: 'item-use', instanceId: id(state, 0) }, testNow).accepted).toBe(false)
    expect(state).toEqual(before)
  })
  it('falls back to warehouse when board is full, and repeated generation is deterministic from saved RNG', () => {
    const fullCatalog = { ...catalog, initialBoard: Array.from({ length: 63 }, (_, index) => ({ itemId: index ? 201 : 101, lock: 0 as const })) }
    const state = createProduction(fullCatalog, testNow)
    const command = { type: 'item-use' as const, instanceId: id(state, 0) }
    const first = applyInventoryCommand(state, fullCatalog, command, testNow)
    const replay = applyInventoryCommand(structuredClone(state), fullCatalog, command, testNow)
    expect(first).toEqual(replay)
    if (!first.accepted) throw new Error(first.reason)
    expect(first.state.inventory.warehouse.filter(Boolean)).toHaveLength(1)
    expect(first.state.stamina.value).toBe(99)
  })
  it('stale expansion cannot charge twice and a depleted player can still sort items', () => {
    let state = createProduction(catalog, testNow)
    state.stamina.value = 0
    state = apply(state, { type: 'warehouse-expand', expectedCapacity: 6 })
    expect(state.inventory.gems).toBe(50)
    expect(applyInventoryCommand(state, catalog, { type: 'warehouse-expand', expectedCapacity: 6 }, testNow).accepted).toBe(false)
    state = apply(state, { type: 'item-store', instanceId: id(state, 7) })
    expect(state.stamina.value).toBe(0)
  })
})

describe('save integrity and compatibility', () => {
  it('round-trips valid production and rejects duplicated item locations, missing sources and incompatible configuration', () => {
    const valid = envelopeFixture()
    expect(parseSaveFile(JSON.stringify(valid), worldFixture(), catalog)).toEqual(valid)
    const duplicate = structuredClone(valid)
    duplicate.data.production.inventory.warehouse[0] = id(duplicate.data.production, 7)
    expect(() => validateSave(duplicate, worldFixture(), catalog)).toThrow('重复占格')
    const version = { ...valid, configVersion: 'future' }
    expect(() => validateSave(version, worldFixture(), catalog)).toThrow('不匹配')
    const source = structuredClone(valid)
    const generator = id(source.data.production, 2)
    source.data.production.inventory.board[2].instanceId = null
    delete source.data.production.inventory.items[generator]
    expect(() => validateSave(source, worldFixture(), catalog)).toThrow('关键生成器')
  })
  it('does not trust a same-sized board, corrupt stamina anchors or impossible routes', () => {
    const data = dataFixture()
    data.production.stamina.remainderMs = 10000
    expect(() => validateSave(envelopeFixture(data), worldFixture(), catalog)).toThrow('精力计时')
    const path = dataFixture()
    path.route = [{ x: 9, y: 9 }]; path.destination = { x: 9, y: 9 }
    expect(() => validateSave(envelopeFixture(path), worldFixture(), catalog)).toThrow('路径')
  })
  it('the active order pool changes as part of the transaction', () => {
    const state = createProduction(catalog, testNow)
    expect(activeOrders(state.inventory, catalog).map(order => order.id)).toEqual([1, 2, 3])
    state.inventory.completedOrders.push(2)
    expect(activeOrders(state.inventory, catalog).map(order => order.id)).toEqual([1, 3, 4])
  })
})
