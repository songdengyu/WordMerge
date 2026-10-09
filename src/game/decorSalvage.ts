import { exchangeItems, type ProductionState } from './inventory'
import type { ProductionCatalog } from './productionConfig'
import type { ProgressionState } from './progression'
import type { DecorId } from './progressionConfig'

// Decor is purchased, not crafted yet. Small level-one salvage, independent of shop/save fingerprints.
export const DECOR_SALVAGE: Record<DecorId, readonly number[]> = {
  rug: [201], planter: [261], lantern: [261], chair: [201], table: [201, 201],
  sofa: [201, 201], bookshelf: [201, 201], 'tea-set': [261], flowerstand: [201],
}
export type DecorDismantleCommand = { type: 'decor-dismantle'; decorationId: string }
export function salvageSummary(kind: DecorId, catalog: ProductionCatalog) {
  const counts = new Map<number, number>()
  DECOR_SALVAGE[kind].forEach(id => counts.set(id, (counts.get(id) ?? 0) + 1))
  return [...counts].map(([id, count]) => `${catalog.itemById.get(id)!.name} ×${count}`).join('、')
}
export function dismantleDecoration(progress: ProgressionState, source: ProductionState, catalog: ProductionCatalog, decorationId: string) {
  const decor = progress.decorations.find(d => d.id === decorationId)
  if (!decor) return { accepted: false as const, reason: '这件摆件已经拆除或收回' }
  const rewards = DECOR_SALVAGE[decor.kind]
  const production = structuredClone(source)
  if (!exchangeItems(production.inventory, catalog, [], rewards)) {
    return { accepted: false as const, reason: '请先在棋盘或仓库留出材料空位，摆件尚未拆除' }
  }
  const state = { ...progress, decorations: progress.decorations.filter(d => d.id !== decorationId) }
  const message = `已拆除，获得${salvageSummary(decor.kind, catalog)}`
  return { accepted: true as const, state, production, rewards, cell: decor.cell, message }
}
