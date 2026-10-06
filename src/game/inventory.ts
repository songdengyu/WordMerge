import type { CellLock } from '../data/mergeConfig'
import { adjacentIndexes, highestGenerator, weightedDrop, WAREHOUSE_EXPANSION_COSTS } from '../data/mergeRules'
import type { ProductionCatalog, ProductionOrder } from './productionConfig'
import { addStamina, spendStamina, syncStamina, type StaminaClock } from './stamina'

export type ItemLocation = { kind: 'board' | 'warehouse'; index: number }
export interface ItemInstance { id: string; itemId: number; location: ItemLocation; reservedBy: string | null }
export type SupplyStat = 'hp' | 'hunger' | 'water'
export interface SupplyOrder { stat: SupplyStat; itemId: number }
export interface InventoryState {
  board: { instanceId: string | null; lock: CellLock; rewardClaimed: boolean }[]
  warehouse: (string | null)[]
  items: Record<string, ItemInstance>
  nextId: number
  randomState: number
  gold: number
  gems: number
  completedOrders: number[]
}
export interface ProductionState {
  inventory: InventoryState
  stamina: StaminaClock
  vitals: { hp: number; hunger: number; water: number; temperature: number }
  supplyOrders: SupplyOrder[]
}
export type InventoryCommand =
  | { type: 'item-move'; instanceId: string; targetIndex: number; expectedTarget: string | null }
  | { type: 'item-use'; instanceId: string }
  | { type: 'item-store'; instanceId: string }
  | { type: 'item-take'; instanceId: string; targetIndex: number }
  | { type: 'item-discard'; instanceId: string }
  | { type: 'warehouse-expand'; expectedCapacity: number }
  | { type: 'order-complete'; orderId: number }
export type ProductionResult = { accepted: true; state: ProductionState; message: string }
  | { accepted: false; reason: string }
const reject = (reason: string): ProductionResult => ({ accepted: false, reason })

function spawn(inventory: InventoryState, itemId: number, location: ItemLocation) {
  const id = `i${inventory.nextId++}`
  inventory.items[id] = { id, itemId, location, reservedBy: null }
  setSlot(inventory, location, id)
  return id
}
function setSlot(inventory: InventoryState, location: ItemLocation, id: string | null) {
  if (location.kind === 'board') inventory.board[location.index].instanceId = id
  else inventory.warehouse[location.index] = id
}
function remove(inventory: InventoryState, item: ItemInstance) {
  setSlot(inventory, item.location, null)
  delete inventory.items[item.id]
}
function relocate(inventory: InventoryState, item: ItemInstance, location: ItemLocation) {
  item.location = location
  setSlot(inventory, location, item.id)
}
function random(inventory: InventoryState) {
  let value = inventory.randomState
  value ^= value << 13; value ^= value >>> 17; value ^= value << 5
  inventory.randomState = value >>> 0
  return inventory.randomState / 4294967296
}
function emptyLocation(inventory: InventoryState, randomized = false): ItemLocation | null {
  const empty = inventory.board.flatMap((cell, index) => cell.lock === 0 && cell.instanceId === null ? [index] : [])
  if (empty.length) return { kind: 'board', index: empty[randomized ? Math.floor(random(inventory) * empty.length) : 0] }
  const index = inventory.warehouse.indexOf(null)
  return index < 0 ? null : { kind: 'warehouse', index }
}
function reveal(inventory: InventoryState, index: number) {
  for (const neighbor of adjacentIndexes(index)) {
    const cell = inventory.board[neighbor]
    if (cell.lock !== 2) continue
    cell.lock = 1
    if (!cell.rewardClaimed) { cell.rewardClaimed = true; inventory.gold += 100 }
  }
}
export function createProduction(catalog: ProductionCatalog, now: number, seed = 0x51a7e) : ProductionState {
  const inventory: InventoryState = { board: catalog.initialBoard.map(cell => ({ instanceId: null, lock: cell.lock, rewardClaimed: false })),
    warehouse: Array<string | null>(6).fill(null), items: {}, nextId: 1, randomState: seed >>> 0 || 1,
    gold: 0, gems: 100, completedOrders: [] }
  catalog.initialBoard.forEach((cell, index) => { if (cell.itemId !== null) spawn(inventory, cell.itemId, { kind: 'board', index }) })
  return { inventory, stamina: { value: 100, anchorMs: now, remainderMs: 0 }, vitals: { hp: 100, hunger: 60, water: 60, temperature: 50 }, supplyOrders: [] }
}
export function availableItems(inventory: InventoryState) {
  return Object.values(inventory.items).filter(item => !item.reservedBy && (item.location.kind === 'warehouse'
    || inventory.board[item.location.index].lock === 0))
}
export function matchRequirements(inventory: InventoryState, requirements: readonly number[]): string[] | null {
  const available = availableItems(inventory)
  const picked: string[] = []
  for (const itemId of requirements) {
    const found = available.find(item => item.itemId === itemId && !picked.includes(item.id))
    if (!found) return null
    picked.push(found.id)
  }
  return picked
}
/** Transactional story exchange; generators always require an unlocked board slot. */
export function exchangeItems(inventory: InventoryState, catalog: ProductionCatalog, requirements: readonly number[], rewards: readonly number[]) {
  const draft = structuredClone(inventory), picked = matchRequirements(draft, requirements)
  if (!picked) return false
  picked.forEach(id => remove(draft, draft.items[id]))
  for (const itemId of rewards) {
    const config = catalog.itemById.get(itemId)
    if (!config) return false
    const index = draft.board.findIndex(slot => slot.lock === 0 && slot.instanceId === null)
    const location: ItemLocation | null = config.itemType === 'generator' ? index < 0 ? null : { kind: 'board', index } : emptyLocation(draft)
    if (!location) return false
    spawn(draft, itemId, location)
  }
  Object.assign(inventory, draft)
  return true
}
export function activeOrders(inventory: InventoryState, catalog: ProductionCatalog): readonly ProductionOrder[] {
  return catalog.orders.filter(order => !inventory.completedOrders.includes(order.id)).slice(0, 3)
}
export function isActiveGenerator(inventory: InventoryState, catalog: ProductionCatalog, instanceId: string) {
  const item = inventory.items[instanceId]
  return Boolean(item && item.location.kind === 'board' && inventory.board[item.location.index].lock === 0
    && highestGenerator(catalog.itemById.get(item.itemId)!, availableItems(inventory).map(other => catalog.itemById.get(other.itemId)!)))
}

/** Atomic draft: any rejection discards the entire draft, including RNG, costs, and rewards. */
export function applyInventoryCommand(original: ProductionState, catalog: ProductionCatalog, command: InventoryCommand, now: number): ProductionResult {
  const state = structuredClone(original)
  state.stamina = syncStamina(state.stamina, now)
  const inventory = state.inventory
  const success = (message: string): ProductionResult => ({ accepted: true, state, message })
  if (command.type === 'warehouse-expand') {
    if (inventory.warehouse.length !== command.expectedCapacity) return reject('仓库容量已更新，请重新查看')
    const cost = WAREHOUSE_EXPANSION_COSTS[(inventory.warehouse.length - 6) / 3]
    if (cost === undefined) return reject('仓库已达到最大容量')
    if (inventory.gems < cost) return reject('钻石不足')
    inventory.gems -= cost; inventory.warehouse.push(null, null, null)
    return success('仓库容量 +3')
  }
  if (command.type === 'order-complete') {
    const order = activeOrders(inventory, catalog).find(order => order.id === command.orderId)
    if (!order) return reject('这张委托已交付或尚未开放')
    const picked = matchRequirements(inventory, order.requirements)
    if (!picked) return reject('棋盘与仓库中的可用物资不足')
    picked.forEach(id => remove(inventory, inventory.items[id]))
    for (let i = 0; i < order.quantity; i++) {
      const location = emptyLocation(inventory)
      if (!location) return reject('请先留出奖励空间，物资尚未扣除')
      spawn(inventory, order.rewardItemId, location)
    }
    inventory.gems += order.gems
    inventory.completedOrders.push(order.id)
    return success(`委托完成：${catalog.itemById.get(order.rewardItemId)!.name} ×${order.quantity}`)
  }
  const item = inventory.items[command.instanceId]
  if (!item) return reject('物品已发生变化，请重新选择')
  if (item.reservedBy) return reject('这件物品已被工程预留')
  if (item.location.kind === 'board' && inventory.board[item.location.index].lock !== 0) return reject('锁定物品需要合成解锁')
  const config = catalog.itemById.get(item.itemId)!
  if (command.type === 'item-store') {
    if (item.location.kind !== 'board') return reject('物品已经在仓库中')
    if (config.itemType === 'generator') return reject('生成器不能放入仓库')
    const index = inventory.warehouse.indexOf(null)
    if (index < 0) return reject('仓库已满')
    setSlot(inventory, item.location, null)
    relocate(inventory, item, { kind: 'warehouse', index })
    return success('已存入仓库')
  }
  if (command.type === 'item-take') {
    const target = inventory.board[command.targetIndex]
    if (item.location.kind !== 'warehouse' || !target || target.lock !== 0 || target.instanceId !== null) return reject('请拖到棋盘已解锁的空格')
    setSlot(inventory, item.location, null)
    relocate(inventory, item, { kind: 'board', index: command.targetIndex })
    return success('已取回棋盘')
  }
  if (command.type === 'item-discard') {
    if (config.itemType === 'generator' || config.itemType === 'special') return reject('关键来源和特殊补给不能丢弃')
    remove(inventory, item)
    return success('已丢弃物品')
  }
  if (command.type === 'item-use') {
    if (config.itemType === 'generator') {
      if (!isActiveGenerator(inventory, catalog, item.id)) return reject('只有棋盘同链最高等级生成器可以使用')
      if (config.openCost === null || !config.drops.length) return reject('请先升级生成器')
      if (!emptyLocation(inventory)) return reject('棋盘和仓库都已满，未消耗精力')
      const stamina = spendStamina(state.stamina, config.openCost, now)
      if (!stamina) return reject('精力不足，可先整理物品或使用补给')
      const drop = weightedDrop(config, () => random(inventory))
      if (drop === null) return reject('生成器没有有效产物')
      const location = emptyLocation(inventory, true)!
      state.stamina = stamina
      spawn(inventory, drop, location)
      return success(`获得${catalog.itemById.get(drop)!.name}${location.kind === 'warehouse' ? '，已放入仓库' : ''}`)
    }
    const effect = catalog.effects.get(item.itemId)
    if (!effect) return reject('这是制作材料，可以合成或用于委托')
    if (effect.stat === 'stamina') state.stamina = addStamina(state.stamina, effect.amount, now)
    else {
      if (state.vitals[effect.stat] >= 100) return reject('对应状态已充足，补给已保留')
      state.vitals[effect.stat] = Math.min(100, state.vitals[effect.stat] + effect.amount)
    }
    remove(inventory, item)
    state.supplyOrders = state.supplyOrders.filter(order => order.stat !== effect.stat)
    if (config.itemType === 'special' && item.location.kind === 'board') reveal(inventory, item.location.index)
    return success(`使用了${config.name}`)
  }
  if (command.type === 'item-move') {
    const target = inventory.board[command.targetIndex]
    if (item.location.kind !== 'board' || !target || target.lock === 2 || target.instanceId !== command.expectedTarget) return reject('落点发生变化，物品留在原位')
    if (item.location.index === command.targetIndex) return reject('物品仍在原位')
    const other = target.instanceId ? inventory.items[target.instanceId] : null
    if (other?.reservedBy) return reject('目标物品已被预留')
    if (other?.itemId === item.itemId && config.nextId) {
      const targetIndex = command.targetIndex
      remove(inventory, item); remove(inventory, other)
      spawn(inventory, config.nextId, { kind: 'board', index: targetIndex })
      if (target.lock === 1) { target.lock = 0; reveal(inventory, targetIndex) }
      return success(`合成了${catalog.itemById.get(config.nextId)!.name}`)
    }
    if (target.lock !== 0) return reject('半锁物品需要相同物品合成解锁')
    const sourceLocation = { ...item.location }
    setSlot(inventory, sourceLocation, null)
    relocate(inventory, item, { kind: 'board', index: command.targetIndex })
    if (other) relocate(inventory, other, sourceLocation)
    return success('已整理棋盘')
  }
  return reject('未知物品操作')
}
