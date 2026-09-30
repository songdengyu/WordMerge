import { describe, expect, it } from 'vitest'
import { applyInventoryCommand, createProduction, type ProductionState } from './inventory'
import { applyQuickSupply, supplyDanger, supplyFor, type QuickSupplyCommand } from './quickSupply'
import { envelopeFixture, productionFixture, testNow, worldFixture } from './testFixtures'
import { validateSave } from './saveData'
import { GameRuntime } from './GameRuntime'

const catalog = productionFixture(), world = worldFixture()
function run(state: ProductionState, command: QuickSupplyCommand) {
  const result = applyQuickSupply(state, catalog, command, testNow)
  if (!result.accepted) throw new Error(result.reason)
  return result.state
}
function stock(state: ProductionState, itemId: number) {
  const inventory = state.inventory, id = `i${inventory.nextId++}`, index = inventory.warehouse.indexOf(null)
  inventory.warehouse[index] = id
  inventory.items[id] = { id, itemId, location: { kind: 'warehouse', index }, reservedBy: null }
  return id
}

describe('quick status supplies', () => {
  it('consumes one actual board or warehouse item and preserves the source snapshot', () => {
    const initial = createProduction(catalog, testNow), original = structuredClone(initial)
    const foodId = initial.inventory.board[9].instanceId!
    let state = run(initial, { type: 'quick-supply', stat: 'hunger', requestOnMissing: false })
    expect(initial).toEqual(original)
    expect(state.vitals.hunger).toBe(70)
    expect(state.inventory.items[foodId]).toBeUndefined()
    expect(state.inventory.board[9].instanceId).toBeNull()
    state.vitals.hp = 45
    const herb = stock(state, 231)
    state = run(state, { type: 'quick-supply', stat: 'hp', requestOnMissing: false })
    expect(state.vitals.hp).toBe(50)
    expect(state.inventory.items[herb]).toBeUndefined()
    expect(state.inventory.warehouse[0]).toBeNull()
  })

  it('skips reserved and locked supplies, prefers lower tier and does not waste full-state items', () => {
    const state = createProduction(catalog, testNow), berry = state.inventory.board[9].instanceId!
    stock(state, 213); stock(state, 212)
    expect(supplyFor(state, catalog, 'hunger')?.itemId).toBe(211)
    state.inventory.items[berry].reservedBy = 'b1:bed'
    expect(supplyFor(state, catalog, 'hunger')?.itemId).toBe(212)
    state.inventory.items[berry].reservedBy = null; state.inventory.board[9].lock = 1
    const healed = run(state, { type: 'quick-supply', stat: 'hunger', requestOnMissing: false })
    expect(healed.vitals.hunger).toBe(85)
    expect(healed.inventory.items[berry]).toBeDefined()
    healed.vitals.hunger = 100
    const before = structuredClone(healed)
    expect(applyQuickSupply(healed, catalog, { type: 'quick-supply', stat: 'hunger', requestOnMissing: true }, testNow).accepted).toBe(false)
    expect(healed).toEqual(before)
  })

  it('plain clicks only warn on missing supplies; assistance creates one persistent order per stat', () => {
    const state = createProduction(catalog, testNow); state.vitals.hp = 12
    const before = structuredClone(state)
    expect(applyQuickSupply(state, catalog, { type: 'quick-supply', stat: 'hp', requestOnMissing: false }, testNow).accepted).toBe(false)
    expect(state).toEqual(before)
    const first = applyQuickSupply(state, catalog, { type: 'quick-supply', stat: 'hp', requestOnMissing: true }, testNow)
    expect(first).toMatchObject({ accepted: true, openProduction: true })
    if (!first.accepted) throw new Error('expected order')
    const second = run(first.state, { type: 'quick-supply', stat: 'hp', requestOnMissing: true })
    expect(second.supplyOrders).toEqual([{ stat: 'hp', itemId: 231 }])
    expect(second.inventory).toEqual(state.inventory)
    const save = envelopeFixture(); save.data.production = second
    expect(validateSave(save, world, catalog).data.production.supplyOrders).toEqual(second.supplyOrders)
  })

  it('order completion heals instead of rewarding currency, and normal item use also finishes the order', () => {
    let state = createProduction(catalog, testNow); state.vitals.hp = 12
    state = run(state, { type: 'quick-supply', stat: 'hp', requestOnMissing: true })
    expect(applyQuickSupply(state, catalog, { type: 'supply-order-use', stat: 'hp' }, testNow).accepted).toBe(false)
    stock(state, 231)
    const money = [state.inventory.gold, state.inventory.gems]
    state = run(state, { type: 'supply-order-use', stat: 'hp' })
    expect(state.vitals.hp).toBe(17)
    expect(state.supplyOrders).toEqual([])
    expect([state.inventory.gold, state.inventory.gems]).toEqual(money)
    expect(applyQuickSupply(state, catalog, { type: 'supply-order-use', stat: 'hp' }, testNow).accepted).toBe(false)
    state = run(state, { type: 'quick-supply', stat: 'hp', requestOnMissing: true })
    const bandage = stock(state, 232)
    const used = applyInventoryCommand(state, catalog, { type: 'item-use', instanceId: bandage }, testNow)
    expect(used).toMatchObject({ accepted: true, state: { supplyOrders: [], vitals: { hp: 37 } } })
  })

  it('cancelling an order leaves inventory intact and old saves gain an empty order list', () => {
    let state = createProduction(catalog, testNow); state.vitals.hp = 12
    state = run(state, { type: 'quick-supply', stat: 'hp', requestOnMissing: true })
    const inventory = structuredClone(state.inventory)
    state = run(state, { type: 'supply-order-cancel', stat: 'hp' })
    expect(state.supplyOrders).toEqual([]); expect(state.inventory).toEqual(inventory)
    const save = JSON.parse(JSON.stringify(envelopeFixture()))
    delete save.data.production.supplyOrders
    const restored = validateSave(save, world, catalog)
    expect(restored.data.production.supplyOrders).toEqual([])
    expect(restored.data.production.inventory).toEqual(save.data.production.inventory)
    save.data.production.supplyOrders = [{ stat: 'hp', itemId: 211 }]
    expect(() => validateSave(save, world, catalog)).toThrow('补给订单')
    save.data.production.supplyOrders = [{ stat: 'hp', itemId: 231 }, { stat: 'hp', itemId: 231 }]
    expect(() => validateSave(save, world, catalog)).toThrow('补给订单')
  })

  it('serial runtime commands cannot use the same supply twice; paused commands do nothing', async () => {
    const runtime = new GameRuntime(world, { catalog, now: () => testNow })
    runtime.advanceFrame(0)
    const first = runtime.dispatch({ type: 'quick-supply', stat: 'hunger', requestOnMissing: false })
    const duplicate = runtime.dispatch({ type: 'quick-supply', stat: 'hunger', requestOnMissing: false })
    runtime.advanceFrame(50)
    expect((await first).accepted).toBe(true); expect((await duplicate).accepted).toBe(false)
    expect(runtime.getUiSnapshot().production!.vitals.hunger).toBeGreaterThan(69)
    expect(runtime.getUiSnapshot().production!.vitals.hunger).toBeLessThanOrEqual(70)
    runtime.setPauseReason('background', true)
    const before = runtime.exportSave()
    expect((await runtime.dispatch({ type: 'quick-supply', stat: 'water', requestOnMissing: false })).accepted).toBe(false)
    expect(runtime.exportSave()).toBe(before)
  })

  it('shows urgent badges at the damage boundary and uses the existing low-health warning', () => {
    expect(supplyDanger('hunger', 20)).toBe(true); expect(supplyDanger('hunger', 20.1)).toBe(false)
    expect(supplyDanger('water', 20)).toBe(true); expect(supplyDanger('water', 20.1)).toBe(false)
    expect(supplyDanger('hp', 30)).toBe(true); expect(supplyDanger('hp', 30.1)).toBe(false)
  })
})
