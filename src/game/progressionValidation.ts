import { buildingAt, localToWorld } from './construction'
import { CHAPTERS, DECORATIONS, OUTFITS, REGIONS } from './progressionConfig'
import type { ProgressionState } from './progression'
import type { RuntimeData } from './saveData'
import { sameCell, type Cell, type WorldMap } from './world'

type Check = (condition: unknown, name: string) => asserts condition
const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const list = (v: unknown, ids: readonly string[]): v is string[] => Array.isArray(v) && v.every(id => typeof id === 'string' && ids.includes(id)) && new Set(v).size === v.length
export function validateProgression(raw: unknown, data: RuntimeData, world: WorldMap, check: Check): asserts raw is ProgressionState {
  check(record(raw) && list(raw.completed, CHAPTERS.map(c => c.id)) && raw.completed.every((id, i) => id === CHAPTERS[i].id), '首章顺序')
  check(record(raw.choices) && Object.keys(raw.choices).length === raw.completed.length, '剧情选择记录')
  for (const id of raw.completed) check(CHAPTERS.find(c => c.id === id)!.choices.some(choice => choice.id === (raw.choices as Record<string, unknown>)[id]), '剧情选项')
  check(list(raw.unlockedRegions, REGIONS.map(r => r.id)) && list(raw.discoveries, raw.unlockedRegions) && typeof raw.witnessedDawn === 'boolean', '区域探索记录')
  for (const id of raw.unlockedRegions) {
    const region = REGIONS.find(r => r.id === id)!
    check(raw.completed.includes(region.after) && data.construction.xp >= region.xp, '区域解锁条件')
  }
  const completed = raw.completed
  const expectedDecor = CHAPTERS.filter(c => completed.includes(c.id)).flatMap(c => c.decor ? [c.decor] : [])
  const expectedOutfits = ['clay', ...CHAPTERS.filter(c => completed.includes(c.id)).flatMap(c => c.outfit ? [c.outfit] : [])]
  check(list(raw.ownedDecor, DECORATIONS.map(d => d.id)), '摆件来源')
  const ownedDecor = raw.ownedDecor
  check(ownedDecor.length === expectedDecor.length && expectedDecor.every(id => ownedDecor.includes(id)), '摆件来源')
  check(list(raw.ownedOutfits, OUTFITS.map(o => o.id)), '衣裳来源')
  const ownedOutfits = raw.ownedOutfits
  check(ownedOutfits.length === expectedOutfits.length && expectedOutfits.every(id => ownedOutfits.includes(id))
    && typeof raw.outfit === 'string' && raw.ownedOutfits.includes(raw.outfit), '衣裳来源')
  check(Array.isArray(raw.decorations) && raw.decorations.length <= raw.ownedDecor.length, '摆件数量')
  const kinds = new Set(), cells = new Set()
  for (const decor of raw.decorations) {
    check(record(decor) && typeof decor.kind === 'string' && raw.ownedDecor.includes(decor.kind) && !kinds.has(decor.kind)
      && record(decor.cell) && Number.isSafeInteger(decor.cell.x) && Number.isSafeInteger(decor.cell.y), '摆件实例')
    const cell = decor.cell as unknown as Cell, building = buildingAt(data.construction, cell), key = `${cell.x},${cell.y}`
    check(world.isWalkable(cell) && building?.id === decor.buildingId && building?.parts.foundation.built
      && !sameCell(cell, localToWorld(building, { x: 0, y: 1 })) && !cells.has(key), '摆件位置')
    kinds.add(decor.kind); cells.add(key)
  }
  if (raw.dialogue !== null) {
    const chapter = CHAPTERS[raw.completed.length]
    check(record(raw.dialogue) && chapter && raw.dialogue.chapterId === chapter.id && Number.isSafeInteger(raw.dialogue.line)
      && Number(raw.dialogue.line) >= 0 && Number(raw.dialogue.line) < chapter.lines.length && !data.survival.failure, '正在阅读的剧情')
  }
}
