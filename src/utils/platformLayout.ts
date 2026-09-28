import type { Hero } from '../data/heroes'
import { HEROES_PER_PLATFORM, MAX_DEPLOYED, MAX_PLATFORM_ROW_PAIRS } from '../data/heroes'

export interface PlatformRowLayout {
  left: (Hero | null)[]
  right: (Hero | null)[]
}

const HEROES_PER_ROW_PAIR = HEROES_PER_PLATFORM * 2

export function createEmptyDeployedSlots(): (string | null)[] {
  return Array(MAX_DEPLOYED).fill(null)
}

export function getDeployedHeroIds(slots: (string | null)[]): string[] {
  return slots.filter((id): id is string => id !== null)
}

export function isHeroDeployed(slots: (string | null)[], heroId: string): boolean {
  return slots.includes(heroId)
}

export function findFirstEmptySlot(slots: (string | null)[]): number {
  return slots.findIndex((id) => id === null)
}

/** 槽位顺序：每排 左内→右内→左中→右中→左外→右外，排满后上一排 */
export function buildPlatformRows(heroes: Hero[], slots: (string | null)[]): PlatformRowLayout[] {
  let maxRow = -1
  for (let i = 0; i < slots.length; i++) {
    if (slots[i] !== null) {
      maxRow = Math.max(maxRow, Math.floor(i / HEROES_PER_ROW_PAIR))
    }
  }
  if (maxRow < 0) return []

  const heroMap = new Map(heroes.map((h) => [h.id, h]))

  return Array.from({ length: maxRow + 1 }, (_, rowIndex) => {
    const left: (Hero | null)[] = [null, null, null]
    const right: (Hero | null)[] = [null, null, null]
    const base = rowIndex * HEROES_PER_ROW_PAIR

    for (let slotIndex = 0; slotIndex < HEROES_PER_PLATFORM; slotIndex++) {
      const leftId = slots[base + slotIndex * 2]
      const rightId = slots[base + slotIndex * 2 + 1]
      left[slotIndex] = leftId ? heroMap.get(leftId) ?? null : null
      right[slotIndex] = rightId ? heroMap.get(rightId) ?? null : null
    }

    return { left, right }
  })
}

export function getMaxVisibleRowPairs(slots: (string | null)[]): number {
  let maxRow = -1
  for (let i = 0; i < slots.length; i++) {
    if (slots[i] !== null) {
      maxRow = Math.max(maxRow, Math.floor(i / HEROES_PER_ROW_PAIR))
    }
  }
  return Math.min(MAX_PLATFORM_ROW_PAIRS, maxRow + 1)
}
