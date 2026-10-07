import { buildingAt, localToWorld } from './construction'
import { CHAPTERS, DECORATIONS, OUTFITS, REGIONS } from './progressionConfig'
import { upgradeDecorInventory, type ProgressionState } from './progression'
import type { RuntimeData } from './saveData'
import { sameCell, type Cell, type WorldMap } from './world'
import { REGION_UNLOCK_SECONDS, regionGates } from './regionUnlock'
import { REGION_CONTENT_VERSION, REGION_BOARS, REGION_LODGE } from './regionContentConfig'
import { SHOP_PRODUCTS } from './economyConfig'

type Check = (condition: unknown, name: string) => asserts condition
const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const list = (v: unknown, ids: readonly string[]): v is string[] => Array.isArray(v) && v.every(id => typeof id === 'string' && ids.includes(id)) && new Set(v).size === v.length
export function validateProgression(raw: unknown, data: RuntimeData, world: WorldMap, check: Check): asserts raw is ProgressionState {
  check(record(raw) && list(raw.completed, CHAPTERS.map(c => c.id)) && raw.completed.every((id, i) => id === CHAPTERS[i].id), '首章顺序')
  check(record(raw.choices) && Object.keys(raw.choices).length === raw.completed.length, '剧情选择记录')
  for (const id of raw.completed) check(CHAPTERS.find(c => c.id === id)!.choices.some(choice => choice.id === (raw.choices as Record<string, unknown>)[id]), '剧情选项')
  check(list(raw.unlockedRegions, REGIONS.map(r => r.id)) && list(raw.discoveries, raw.unlockedRegions) && typeof raw.witnessedDawn === 'boolean', '区域探索记录')
  check(record(raw.regionContent) && raw.regionContent.version === REGION_CONTENT_VERSION
    && list(raw.regionContent.initialized, raw.unlockedRegions), '区域内容版本或发现记录')
  for (const enemy of data.survival.enemies) if (enemy.residentId) {
    check(raw.regionContent.initialized.includes(REGION_BOARS.find(s => s.id === enemy.residentId)!.regionId), '区域野猪发现记录')
  }
  check(data.construction.buildings.filter(b => b.blueprintId === REGION_LODGE.blueprintId).length
    === (raw.regionContent.initialized.includes(REGION_LODGE.regionId) ? 1 : 0), '区域大屋发现记录')
  for (const id of raw.unlockedRegions) {
    const region = REGIONS.find(r => r.id === id)!
    check(data.construction.xp >= region.xp, '区域解锁条件')
  }
  if (raw.regionUnlock !== null) {
    const job = raw.regionUnlock
    check(record(job) && typeof job.regionId === 'string' && !raw.unlockedRegions.includes(job.regionId)
      && (job.phase === 'travel' || job.phase === 'unlocking') && record(job.workCell)
      && typeof job.remaining === 'number' && Number.isFinite(job.remaining), '区域开放作业')
    const region = REGIONS.find(r => r.id === job.regionId)
    const gate = regionGates(world, job.regionId).find(g => g.side === job.side)
    check(region && gate && sameCell(job.workCell as unknown as Cell, gate.workCell) && world.isWalkable(gate.workCell)
      && data.construction.xp >= region.xp && !data.construction.jobs.length && !data.survival.taming.job
      && !data.survival.resting && !data.survival.failure, '区域开放工作位或条件')
    if (job.phase === 'travel') check(job.remaining === 0 && data.destination && sameCell(data.destination, gate.workCell), '前往指示牌的目标')
    else check(job.remaining > 0 && job.remaining <= REGION_UNLOCK_SECONDS && !data.route.length && !data.searching
      && data.destination === null && data.progress === 0 && sameCell(data.motion?.position ?? data.cell, gate.workCell), '区域开放位置或计时')
  }
  const completed = raw.completed
  const bought = SHOP_PRODUCTS.filter(p => data.economy?.purchases.includes(p.id))
  const expectedDecor = [...new Set([...CHAPTERS.filter(c => completed.includes(c.id)).flatMap(c => c.decor ? [c.decor] : []), ...bought.filter(p => p.category === 'decor').map(p => p.reward)])]
  const expectedOutfits = [...new Set(['clay', ...CHAPTERS.filter(c => completed.includes(c.id)).flatMap(c => c.outfit ? [c.outfit] : []), ...bought.filter(p => p.category === 'outfit').map(p => p.reward)])]
  check(list(raw.ownedDecor, DECORATIONS.map(d => d.id)), '摆件来源')
  const ownedDecor = raw.ownedDecor
  check(ownedDecor.length === expectedDecor.length && expectedDecor.every(id => ownedDecor.includes(id)), '摆件来源')
  check(list(raw.ownedOutfits, OUTFITS.map(o => o.id)), '衣裳来源')
  const ownedOutfits = raw.ownedOutfits
  check(ownedOutfits.length === expectedOutfits.length && expectedOutfits.every(id => ownedOutfits.includes(id))
    && typeof raw.outfit === 'string' && raw.ownedOutfits.includes(raw.outfit), '衣裳来源')
  check(Array.isArray(raw.decorations), '摆件数量')
  const legacyDecor = raw.decorStock === undefined
  if (legacyDecor) check(raw.nextDecorationId === undefined && raw.decorations.length <= ownedDecor.length, '旧摆件数量')
  else check(record(raw.decorStock) && Object.keys(raw.decorStock).length === ownedDecor.length
    && ownedDecor.every(kind => Number.isSafeInteger((raw.decorStock as Record<string, unknown>)[kind]) && Number((raw.decorStock as Record<string, unknown>)[kind]) >= 0)
    && Number.isSafeInteger(raw.nextDecorationId) && Number(raw.nextDecorationId) > 0, '摆件库存')
  const kinds = new Set(), cells = new Set(), ids = new Set()
  for (const decor of raw.decorations) {
    check(record(decor) && typeof decor.kind === 'string' && raw.ownedDecor.includes(decor.kind)
      && (legacyDecor ? !kinds.has(decor.kind) && decor.id === undefined
        : typeof decor.id === 'string' && /^d[1-9]\d*$/.test(decor.id) && !ids.has(decor.id) && Number(decor.id.slice(1)) < Number(raw.nextDecorationId))
      && record(decor.cell) && Number.isSafeInteger(decor.cell.x) && Number.isSafeInteger(decor.cell.y), '摆件实例')
    const cell = decor.cell as unknown as Cell, building = buildingAt(data.construction, cell), key = `${cell.x},${cell.y}`
    check(world.isWalkable(cell) && building?.id === decor.buildingId && building?.parts.foundation.built
      && !sameCell(cell, localToWorld(building, { x: 0, y: 1 })) && !cells.has(key), '摆件位置')
    kinds.add(decor.kind); cells.add(key); ids.add(decor.id)
  }
  if (legacyDecor) upgradeDecorInventory(raw as unknown as ProgressionState)
  if (raw.dialogue !== null) {
    const chapter = CHAPTERS[raw.completed.length]
    check(record(raw.dialogue) && chapter && raw.dialogue.chapterId === chapter.id && Number.isSafeInteger(raw.dialogue.line)
      && Number(raw.dialogue.line) >= 0 && Number(raw.dialogue.line) < chapter.lines.length && !data.survival.failure, '正在阅读的剧情')
  }
}
