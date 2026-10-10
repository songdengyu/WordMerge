import { constructionNavigation, type ConstructionState } from './construction'
import { availableItems, exchangeItems, type ProductionState } from './inventory'
import type { ProductionCatalog } from './productionConfig'
import { grantDecoration, type ProgressionState } from './progression'
import { CLEAR_SECONDS, ECONOMY_VERSION, RESOURCE_RULES, SHOP_PRODUCTS, toolMeets, type ShopProduct } from './economyConfig'
import { pointDistance, SmoothPathSearch } from './smoothNavigation'
import type { Cell, WorldMap } from './world'

export interface ClearingJob { objectId: string; phase: 'travel' | 'clearing'; workCell: Cell; remaining: number; reservedIds: string[] }
export interface EconomyState {
  version: string; removedObjects: string[]; clearingOrders: string[]; clearing: ClearingJob | null
  purchases: string[]; pendingLoot: string[]; distanceRemainder: number
}
export type EconomyCommand = { type: 'resource-interact'; objectId: string } | { type: 'resource-cancel'; objectId: string }
  | { type: 'shop-buy'; productId: string } | { type: 'loot-claim'; objectId: string }
export const createEconomy = (): EconomyState => ({ version: ECONOMY_VERSION, removedObjects: [], clearingOrders: [], clearing: null,
  purchases: [], pendingLoot: [], distanceRemainder: 0 })
export const resourceOrderId = (id: string) => `resource:${id}`
export const resourceTool = (production: ProductionState, required: number) => availableItems(production.inventory)
  .filter(item => toolMeets(item.itemId, required)).sort((a, b) => a.itemId - b.itemId)[0]
/** A resource itself blocks movement; approach a reachable neighboring cell without starting work. */
export function resourceApproach(world: WorldMap, construction: ConstructionState, player: Cell, object: Cell) {
  const grid = constructionNavigation(world, construction, 'player')
  return [[-1, 0], [1, 0], [0, -1], [0, 1]].map(([x, y]) => ({ x: object.x + x, y: object.y + y }))
    .sort((a, b) => pointDistance(a, player) - pointDistance(b, player))
    .find(point => world.isWalkable(point) && new SmoothPathSearch(grid, player, point).advance(world.config.chunks.length * 256 + 1).status === 'found')
}
export function spendActionNeeds(production: ProductionState, amount = 1) {
  production.vitals = { ...production.vitals, hunger: Math.max(0, production.vitals.hunger - amount), water: Math.max(0, production.vitals.water - amount) }
}
export function spendMovementNeeds(economy: EconomyState, production: ProductionState, distance: number) {
  const total = economy.distanceRemainder + distance, count = Math.floor((total + 1e-8) / 10)
  economy.distanceRemainder = Math.max(0, total - count * 10)
  if (count) spendActionNeeds(production, count)
}
export function releaseClearing(economy: EconomyState, production: ProductionState, keepOrder = true) {
  const job = economy.clearing
  if (!job || job.phase === 'clearing') return
  for (const id of job.reservedIds) {
    const item = production.inventory.items[id]
    if (item?.reservedBy === resourceOrderId(job.objectId)) item.reservedBy = null
  }
  if (!keepOrder) economy.clearingOrders = economy.clearingOrders.filter(id => id !== job.objectId)
  economy.clearing = null
}
export function ownsProduct(product: ShopProduct, economy: EconomyState, construction: ConstructionState, progress: ProgressionState) {
  return economy.purchases.includes(product.id) || (product.category === 'blueprint' ? construction.unlockedBlueprints.includes(product.reward)
    : product.category === 'decor' ? progress.ownedDecor.includes(product.reward) : product.category === 'outfit' ? progress.ownedOutfits.includes(product.reward) : false)
}
export function applyEconomyCommand(original: EconomyState, source: ProductionState, buildings: ConstructionState,
  progress: ProgressionState, world: WorldMap, player: Cell, catalog: ProductionCatalog, busy: boolean, command: EconomyCommand) {
  const state = structuredClone(original), production = structuredClone(source), construction = structuredClone(buildings), progression = structuredClone(progress)
  const reject = (reason: string) => ({ accepted: false as const, reason })
  const accept = (message: string, openProduction = false) => ({ accepted: true as const, state, production, construction, progression, message, openProduction })
  if (command.type === 'shop-buy') {
    const product = SHOP_PRODUCTS.find(p => p.id === command.productId)
    if (!product) return reject('商品不存在')
    if (product.category !== 'decor' && ownsProduct(product, state, construction, progression)) return reject('已经拥有，无需重复购买')
    if (production.inventory[product.currency] < product.price) return reject(`${product.currency === 'gold' ? '金币' : '钻石'}不足`)
    if (product.category === 'tools' && !exchangeItems(production.inventory, catalog, [], [Number(product.reward)])) return reject('请先在棋盘留出一个空格领取工具箱')
    if (product.category === 'blueprint') construction.unlockedBlueprints.push(product.reward)
    if (product.category === 'decor') grantDecoration(progression, product.reward)
    if (product.category === 'outfit') progression.ownedOutfits.push(product.reward)
    production.inventory[product.currency] -= product.price
    if (!state.purchases.includes(product.id)) state.purchases.push(product.id)
    return accept(`已获得${product.name}`)
  }
  if (command.type === 'loot-claim') {
    const object = world.allConfiguredObjects().find(o => o.id === command.objectId)
    if (!object || !state.pendingLoot.includes(object.id)) return reject('没有待领取的物资')
    if (!exchangeItems(production.inventory, catalog, [], RESOURCE_RULES[object.kind].items)) return reject('棋盘和仓库空间不足，请先整理')
    state.pendingLoot = state.pendingLoot.filter(id => id !== object.id)
    return accept('清理物资已放入棋盘或仓库')
  }
  if (state.clearing?.phase === 'clearing') return reject('正在清理，完成后才能进行其他行动')
  if (command.type === 'resource-cancel') {
    if (state.clearing?.objectId === command.objectId) releaseClearing(state, production, false)
    state.clearingOrders = state.clearingOrders.filter(id => id !== command.objectId)
    return accept('已取消清理，预留工具已释放')
  }
  if (busy || state.clearing) return reject('请先完成或取消当前任务')
  const object = world.allObjects().find(o => o.id === command.objectId)
  if (!object || !world.chunkAt(object)?.unlocked) return reject('这个物体已被清理或尚未开放')
  const rule = RESOURCE_RULES[object.kind]
  const tool = resourceTool(production, rule.tool), picked = tool ? [tool.id] : null
  if (!state.clearingOrders.includes(object.id)) state.clearingOrders.push(object.id)
  if (!picked) return accept(`需要${catalog.itemById.get(rule.tool)!.name}，在工具箱中生产零件并合成`, true)
  const work = resourceApproach(world, construction, player, object)
  if (!work) return reject('暂时无法走到物体旁边，请先清理通路')
  picked.forEach(id => { production.inventory.items[id].reservedBy = resourceOrderId(object.id) })
  state.clearing = { objectId: object.id, phase: 'travel', workCell: work, remaining: 0, reservedIds: picked }
  return accept(`正在前往清理${rule.name}`)
}

export function clearingReady(state: EconomyState, production: ProductionState, objectId: string, world: WorldMap) {
  const object = world.allObjects().find(o => o.id === objectId)
  return !!object && !state.clearing && !!resourceTool(production, RESOURCE_RULES[object.kind].tool)
}
export { CLEAR_SECONDS }
