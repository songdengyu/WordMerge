import type { RuntimeData } from './saveData'
import { createEconomy, resourceOrderId, type EconomyState } from './economy'
import { CLEAR_SECONDS, ECONOMY_VERSION, PRE_SHAPES_ECONOMY_VERSION, PRE_SHAPES_PRODUCTS, RESOURCE_RULES, SHOP_PRODUCTS, toolMeets } from './economyConfig'
import { sameCell, type Cell, type WorldMap } from './world'
import { PRE_CONTENT_ECONOMY_VERSION, PRE_CONTENT_PRODUCTS } from './migrations/contentExpansion'
import { PRE_TOOLS_ECONOMY_VERSION } from './migrations/groveTools'
import { PRE_REPAIR_ECONOMY_VERSION } from './migrations/wallRepairCost'

type Check = (condition: unknown, name: string) => asserts condition
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const list = (v: unknown, ids: readonly string[]): v is string[] => Array.isArray(v) && v.every(id => typeof id === 'string' && ids.includes(id)) && new Set(v).size === v.length
export function economyForWorld(raw: unknown, world: WorldMap, check: Check): EconomyState {
  if (raw === undefined) return createEconomy()
  const objects = world.allConfiguredObjects().filter(object => world.chunkAt(object)?.unlocked).map(object => object.id)
  const legacy = record(raw) && raw.version === PRE_CONTENT_ECONOMY_VERSION
  const oldTools = record(raw) && raw.version === PRE_TOOLS_ECONOMY_VERSION
  const oldShapes = record(raw) && raw.version === PRE_SHAPES_ECONOMY_VERSION
  const oldRepairCost = record(raw) && raw.version === PRE_REPAIR_ECONOMY_VERSION
  check(record(raw) && (raw.version === ECONOMY_VERSION || legacy || oldTools || oldShapes || oldRepairCost) && list(raw.removedObjects, objects), '经济版本或清理记录')
  const removed = raw.removedObjects
  check(list(raw.clearingOrders, objects.filter(id => !removed.includes(id)))
    && list(raw.pendingLoot, raw.removedObjects) && list(raw.purchases, legacy ? PRE_CONTENT_PRODUCTS : (oldShapes || oldTools ? PRE_SHAPES_PRODUCTS : SHOP_PRODUCTS).map(p => p.id)), '清理订单、待领物资或购买记录')
  check(typeof raw.distanceRemainder === 'number' && Number.isFinite(raw.distanceRemainder) && raw.distanceRemainder >= 0 && raw.distanceRemainder < 10, '移动消耗累计距离')
  return (legacy || oldTools || oldShapes || oldRepairCost ? { ...raw, version: ECONOMY_VERSION } : raw) as unknown as EconomyState
}
export function validateEconomy(state: EconomyState, data: RuntimeData, world: WorldMap, check: Check) {
  for (const id of state.purchases) {
    const product = SHOP_PRODUCTS.find(p => p.id === id)!
    check(product.category === 'tools' ? Object.values(data.production.inventory.items).some(i => i.itemId === Number(product.reward))
      : product.category === 'blueprint' ? data.construction.unlockedBlueprints.includes(product.reward)
      : product.category === 'decor' ? data.progression.ownedDecor.includes(product.reward)
      : data.progression.ownedOutfits.includes(product.reward), '购买物品归属')
  }
  if (state.clearing === null) return
  const job: unknown = state.clearing
  check(record(job) && typeof job.objectId === 'string' && state.clearingOrders.includes(job.objectId)
    && (job.phase === 'travel' || job.phase === 'clearing') && record(job.workCell)
    && Number.isSafeInteger(job.workCell.x) && Number.isSafeInteger(job.workCell.y)
    && Array.isArray(job.reservedIds) && typeof job.remaining === 'number' && Number.isFinite(job.remaining), '清理作业')
  const object = world.allObjects().find(o => o.id === job.objectId), work = job.workCell as unknown as Cell
  check(object && world.isWalkable(work) && Math.abs(work.x - object.x) + Math.abs(work.y - object.y) === 1
    && !data.construction.jobs.length && !data.survival.taming.job && !data.progression.regionUnlock
    && !data.survival.failure && !data.survival.resting, '清理位置或作业冲突')
  if (job.phase === 'travel') {
    check(job.remaining === 0 && job.reservedIds.length === 1 && typeof job.reservedIds[0] === 'string'
      && data.destination && sameCell(data.destination, work), '清理前往状态')
    const item = data.production.inventory.items[job.reservedIds[0]]
    check(item && toolMeets(item.itemId, RESOURCE_RULES[object.kind].tool) && item.reservedBy === resourceOrderId(object.id)
      && (item.location.kind === 'warehouse' || data.production.inventory.board[item.location.index].lock === 0), '清理工具预留')
  } else check(job.remaining > 0 && job.remaining <= CLEAR_SECONDS && !job.reservedIds.length
    && sameCell(data.motion?.position ?? data.cell, work) && !data.route.length && !data.searching && data.destination === null, '清理计时或扣料')
}
