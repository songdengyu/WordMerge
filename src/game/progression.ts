import { buildingAt, buildingSummary, localToWorld, type ConstructionState } from './construction'
import { exchangeItems, matchRequirements, type ProductionState } from './inventory'
import type { ProductionCatalog } from './productionConfig'
import { CHAPTERS, DECORATIONS, OUTFITS, REGIONS, REGION_EXTENSIONS, type DecorId, type StoryChapter } from './progressionConfig'
import { distance, type SurvivalState } from './survival'
import { sameCell, type Cell, WorldMap } from './world'

export interface Decoration { kind: DecorId; buildingId: string; cell: Cell }
export interface ProgressionState {
  completed: string[]; choices: Record<string, string>; dialogue: { chapterId: string; line: number } | null
  unlockedRegions: string[]; discoveries: string[]; witnessedDawn: boolean
  ownedDecor: string[]; decorations: Decoration[]; ownedOutfits: string[]; outfit: string
}
export type StoryCommand = { type: 'story-open'; chapterId: string } | { type: 'story-next'; chapterId: string; line: number }
  | { type: 'story-choice'; chapterId: string; choiceId: string } | { type: 'story-close' }
export type ProgressionCommand = { type: 'region-unlock'; regionId: string } | { type: 'outfit-equip'; outfitId: string }
  | { type: 'decor-place'; kind: DecorId; cell: Cell } | { type: 'decor-remove'; kind: DecorId }
export const createProgression = (): ProgressionState => ({ completed: [], choices: {}, dialogue: null, unlockedRegions: [], discoveries: [],
  witnessedDawn: false, ownedDecor: [], decorations: [], ownedOutfits: ['clay'], outfit: 'clay' })
export const progressedWorld = (world: WorldMap, progress: ProgressionState) => new WorldMap(world.config, progress.unlockedRegions, REGION_EXTENSIONS)
export const currentChapter = (progress: ProgressionState) => CHAPTERS[progress.completed.length] as StoryChapter | undefined
export function chapterReady(chapter: StoryChapter, progress: ProgressionState, construction: ConstructionState, survival: SurvivalState, production: ProductionState) {
  const conditions = { always: true, foundation: construction.buildings.some(b => b.parts.foundation.built), companion: survival.companion.status !== 'wild',
    brook: progress.discoveries.includes('brook'), cabin: construction.buildings.some(b => buildingSummary(b).complete),
    grove: progress.discoveries.includes('grove'), dawn: progress.witnessedDawn && progress.decorations.length > 0 }
  return conditions[chapter.condition] && matchRequirements(production.inventory, chapter.requirements) !== null
}
export function regionError(regionId: string, progress: ProgressionState, construction: ConstructionState): string | null {
  const region = REGIONS.find(r => r.id === regionId)
  if (!region) return '这里暂时没有可探索的路线'
  if (progress.unlockedRegions.includes(regionId)) return '这片区域已经开放'
  if (!progress.completed.includes(region.after)) return `先完成「${CHAPTERS.find(c => c.id === region.after)!.title}」`
  if (construction.xp < region.xp) return `建设经验 ${construction.xp}/${region.xp}，继续完善木屋`
  return null
}
export function decorError(kind: string, cell: Cell, progress: ProgressionState, construction: ConstructionState) {
  if (!DECORATIONS.some(d => d.id === kind) || !progress.ownedDecor.includes(kind)) return '尚未获得这件摆件'
  if (!Number.isSafeInteger(cell.x) || !Number.isSafeInteger(cell.y)) return '请选择木屋地板'
  const building = buildingAt(construction, cell)
  if (!building?.parts.foundation.built) return '请放在已建成的木屋地板上'
  if (sameCell(cell, localToWorld(building, { x: 0, y: 1 }))) return '这里留给床铺，试试旁边的地板'
  if (progress.decorations.some(d => d.kind !== kind && sameCell(d.cell, cell))) return '这块地板已有摆件'
  return null
}
export function discoverRegions(progress: ProgressionState, player: Cell) {
  const found = REGIONS.filter(r => progress.unlockedRegions.includes(r.id) && !progress.discoveries.includes(r.id) && distance(player, r.point) <= 1)
  return found.length ? { ...progress, discoveries: [...progress.discoveries, ...found.map(r => r.id)] } : progress
}
export function applyProgressionCommand(original: ProgressionState, construction: ConstructionState, command: ProgressionCommand) {
  const state = structuredClone(original)
  const reject = (reason: string) => ({ accepted: false as const, reason })
  if (command.type === 'region-unlock') {
    const error = regionError(command.regionId, state, construction)
    if (error) return reject(error)
    state.unlockedRegions.push(command.regionId)
    return { accepted: true as const, state, message: `${REGIONS.find(r => r.id === command.regionId)!.name}已开放，前往寻找线索吧` }
  }
  if (command.type === 'outfit-equip') {
    if (!state.ownedOutfits.includes(command.outfitId)) return reject('尚未获得这套衣裳')
    state.outfit = command.outfitId
  } else if (command.type === 'decor-remove') {
    if (!state.decorations.some(d => d.kind === command.kind)) return reject('这件摆件还在收藏中')
    state.decorations = state.decorations.filter(d => d.kind !== command.kind)
  } else {
    const error = decorError(command.kind, command.cell, state, construction)
    if (error) return reject(error)
    state.decorations = [...state.decorations.filter(d => d.kind !== command.kind), { kind: command.kind, cell: { ...command.cell }, buildingId: buildingAt(construction, command.cell)!.id }]
  }
  return { accepted: true as const, state, message: command.type === 'decor-remove' ? '已收回收藏，可以再次摆放' : '营地有了新的样子' }
}
export function applyStoryCommand(original: ProgressionState, source: ProductionState, construction: ConstructionState, survival: SurvivalState,
  catalog: ProductionCatalog, command: StoryCommand) {
  const state = structuredClone(original), production = structuredClone(source)
  const reject = (reason: string) => ({ accepted: false as const, reason })
  const accept = (message: string) => ({ accepted: true as const, state, production, message })
  if (command.type === 'story-close') { state.dialogue = null; return accept('稍后可从营地手记继续阅读') }
  const chapter = currentChapter(state)
  if (!chapter || command.chapterId !== chapter.id) return reject('这段故事已完成或尚未开放')
  if (command.type === 'story-open') {
    if (state.dialogue) return reject('正在阅读这段故事')
    if (!chapterReady(chapter, state, construction, survival, production)) return reject('先完成手记中的生活目标，再继续故事')
    state.dialogue = { chapterId: chapter.id, line: 0 }; return accept('阅读时营地暂停')
  }
  if (!state.dialogue || state.dialogue.chapterId !== chapter.id) return reject('请先打开这段故事')
  if (command.type === 'story-next') {
    if (command.line !== state.dialogue.line || state.dialogue.line >= chapter.lines.length - 1) return reject('这一页已读完，请选择回应')
    state.dialogue.line++; return accept('继续阅读')
  }
  if (state.dialogue.line !== chapter.lines.length - 1) return reject('请先读完这段对话')
  const choice = chapter.choices.find(c => c.id === command.choiceId)
  if (!choice) return reject('请选择有效的回应')
  if (!chapterReady(chapter, state, construction, survival, production)) return reject('所需物资或目标已变化，请整理后再来')
  if (!exchangeItems(production.inventory, catalog, chapter.requirements, chapter.rewardItems)) return reject('请先在棋盘留出奖励空位，物资尚未扣除；可稍后再读')
  state.completed.push(chapter.id); state.choices[chapter.id] = choice.id; state.dialogue = null
  if (chapter.decor) state.ownedDecor.push(chapter.decor)
  if (chapter.outfit) state.ownedOutfits.push(chapter.outfit)
  return accept(choice.reply)
}

export function validateProgressionCatalog(world: WorldMap, catalog: ProductionCatalog) {
  const reachableItems = new Set(catalog.initialBoard.flatMap(slot => slot.itemId === null ? [] : [slot.itemId]))
  for (let i = 0; i < catalog.items.length; i++) for (const item of catalog.items) if (reachableItems.has(item.id)) {
    if (item.nextId) reachableItems.add(item.nextId)
    item.drops.forEach(drop => reachableItems.add(drop.itemId))
  }
  for (const chapter of CHAPTERS) {
    if (chapter.requirements.some(id => !reachableItems.has(id) || catalog.itemById.get(id)?.itemType === 'generator')
      || chapter.rewardItems.some(id => !catalog.itemById.has(id)) || !chapter.lines.length || !chapter.choices.length) throw new Error(`首章 ${chapter.id} 的物资来源或对话配置无效`)
    if (chapter.decor && !DECORATIONS.some(d => d.id === chapter.decor)) throw new Error('首章摆件配置无效')
    if (chapter.outfit && !OUTFITS.some(o => o.id === chapter.outfit)) throw new Error('首章衣裳配置无效')
  }
  for (const region of REGIONS) {
    const expanded = new WorldMap(world.config, [region.id], REGION_EXTENSIONS)
    if (expanded.chunkAt(region.point)?.id !== region.id || !expanded.isWalkable(region.point) || !CHAPTERS.some(c => c.id === region.after)) throw new Error(`区域 ${region.id} 线索配置无效`)
  }
}
