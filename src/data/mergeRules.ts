import type { MergeItemConfig } from './mergeConfig'

export const WAREHOUSE_EXPANSION_COSTS = [50, 100, 200, 400, 800, 1600]

export function adjacentIndexes(index: number) {
  const row = Math.floor(index / 7), column = index % 7
  return [row > 0 ? index - 7 : -1, row < 8 ? index + 7 : -1,
    column > 0 ? index - 1 : -1, column < 6 ? index + 1 : -1].filter(value => value >= 0)
}

export function weightedDrop(item: MergeItemConfig, random: () => number): number | null {
  const total = item.drops.reduce((sum, drop) => sum + drop.weight, 0)
  if (total <= 0) return null
  let roll = random() * total
  for (const drop of item.drops) { roll -= drop.weight; if (roll < 0) return drop.itemId }
  return item.drops[item.drops.length - 1]?.itemId ?? null
}

export function highestGenerator(item: MergeItemConfig, available: readonly MergeItemConfig[]) {
  return item.itemType === 'generator' && !available.some(other => other.itemType === 'generator'
    && other.chain === item.chain && other.level > item.level)
}
