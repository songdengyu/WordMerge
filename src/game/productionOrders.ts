import { activeOrders, type ProductionState } from './inventory'
import type { ProductionCatalog } from './productionConfig'
import type { ConstructionState } from './construction'
import type { EconomyState } from './economy'
import type { SurvivalState } from './survival'
import { TAMING_ORDER } from './taming'

export type TestProductionOrderCommand = { type: 'test-complete-order'; orderId: string }
export function productionOrderIds(production: ProductionState, construction: ConstructionState,
  survival: SurvivalState, economy: EconomyState, catalog: ProductionCatalog) {
  return [
    ...economy.clearingOrders.map(id => `resource:${id}`),
    ...(survival.taming.ordered ? [TAMING_ORDER] : []),
    ...production.supplyOrders.map(order => `supply:${order.stat}`),
    ...construction.orders.map(order => `building:${order.id}`),
    ...activeOrders(production.inventory, catalog).map(order => `commission:${order.id}`),
  ]
}
