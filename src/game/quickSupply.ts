import { applyInventoryCommand, availableItems, type ProductionState, type SupplyStat } from './inventory'
import type { ProductionCatalog } from './productionConfig'

export const SUPPLY_NAMES = { hp: '生命', hunger: '饱食', water: '水分' } as const
export type QuickSupplyCommand =
  | { type: 'quick-supply'; stat: SupplyStat; requestOnMissing: boolean }
  | { type: 'supply-order-use'; stat: SupplyStat }
  | { type: 'supply-order-cancel'; stat: SupplyStat }
type Result = { accepted: true; state: ProductionState; message: string; openProduction?: boolean }
  | { accepted: false; reason: string }

export function supplyDanger(stat: SupplyStat, value: number) { return stat === 'hp' ? value <= 30 : value <= 20 }

/** Prefer the lowest-strength usable supply; never touch locked or reserved inventory. */
export function supplyFor(state: ProductionState, catalog: ProductionCatalog, stat: SupplyStat) {
  const available = availableItems(state.inventory)
  const candidates = [...catalog.effects].filter(([, effect]) => effect.stat === stat)
    .sort(([a, x], [b, y]) => x.amount - y.amount || a - b)
  const stocked = candidates.find(([id]) => available.some(item => item.itemId === id))
  const itemId = (stocked ?? candidates[0])?.[0]
  if (itemId === undefined) return null
  const items = available.filter(item => item.itemId === itemId)
  return { itemId, instanceId: items[0]?.id ?? null, owned: items.length, amount: catalog.effects.get(itemId)!.amount }
}

/** One atomic runtime action: consume one existing item or record one deduplicated supply order. */
export function applyQuickSupply(original: ProductionState, catalog: ProductionCatalog, command: QuickSupplyCommand, now: number): Result {
  if (!Object.prototype.hasOwnProperty.call(SUPPLY_NAMES, command.stat)) return { accepted: false, reason: '未知补给状态' }
  if (command.type === 'supply-order-cancel') {
    if (!original.supplyOrders.some(order => order.stat === command.stat)) return { accepted: false, reason: '这张补给订单已结束' }
    return { accepted: true, state: { ...original, supplyOrders: original.supplyOrders.filter(order => order.stat !== command.stat) }, message: '已取消补给订单' }
  }
  if (original.vitals[command.stat] >= 100) return { accepted: false, reason: `${SUPPLY_NAMES[command.stat]}已充足，补给已保留` }
  if (command.type === 'supply-order-use') {
    const order = original.supplyOrders.find(order => order.stat === command.stat)
    if (!order) return { accepted: false, reason: '这张补给订单已结束' }
    const item = availableItems(original.inventory).find(item => item.itemId === order.itemId)
    if (!item) return { accepted: false, reason: `还缺${catalog.itemById.get(order.itemId)!.name} ×1` }
    return applyInventoryCommand(original, catalog, { type: 'item-use', instanceId: item.id }, now)
  }
  const supply = supplyFor(original, catalog, command.stat)
  if (!supply) return { accepted: false, reason: '暂时没有对应补给' }
  if (supply.instanceId) return applyInventoryCommand(original, catalog, { type: 'item-use', instanceId: supply.instanceId }, now)
  const name = catalog.itemById.get(supply.itemId)!.name
  if (!command.requestOnMissing) return { accepted: false, reason: `没有可用的${name}，请先合成补给` }
  const orders = original.supplyOrders.some(order => order.stat === command.stat) ? original.supplyOrders
    : [...original.supplyOrders, { stat: command.stat, itemId: supply.itemId }]
  return { accepted: true, state: { ...original, supplyOrders: orders }, openProduction: true, message: `已添加${SUPPLY_NAMES[command.stat]}补给：${name} ×1` }
}
