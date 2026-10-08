import { constructionNavigation, reachable, type ConstructionState } from './construction'
import { matchRequirements, type ProductionState } from './inventory'
import { actorPosition, companionName, companions, type SurvivalState } from './survival'
import { ENCOUNTERS } from './encounters'
import { SURVIVAL_RULES } from './survivalConfig'
import { pointCell, pointDistance } from './smoothNavigation'
import type { Cell, WorldMap } from './world'

// Additive to existing saves; does not change the survival content fingerprint.
export const TAMING_SECONDS = 2
export const TAMING_ORDER = 'taming:companion'
export interface TamingJob {
  phase: 'travel' | 'taming'; workCell: Cell; reservedIds: string[]; remaining: number
}
export interface TamingState { ordered: boolean; job: TamingJob | null; targetId?: string }
export type TamingCommand = { type: 'companion-rescue' } | { type: 'taming-interact'; targetId?: string } | { type: 'taming-cancel' }
export function tamingAnimal(state: SurvivalState, id = state.taming.targetId) {
  return id && id !== 'companion' ? state.enemies.find(e => e.id === id && e.tameable) : state.companion.status === 'wild' ? state.companion : undefined
}
export function tamingName(state: SurvivalState) { const animal = tamingAnimal(state); return animal ? companionName(animal) : '动物' }

/** Mutates only the caller's private clone. Reserved pieces stay in their original slots. */
export function releaseTaming(state: SurvivalState, production: ProductionState, keepOrder = true) {
  for (const id of state.taming.job?.reservedIds ?? []) {
    const item = production.inventory.items[id]
    if (item?.reservedBy === TAMING_ORDER) item.reservedBy = null
  }
  state.taming = { ordered: keepOrder && !!tamingAnimal(state), job: null, ...(keepOrder && state.taming.targetId ? { targetId: state.taming.targetId } : {}) }
}

export function requestTaming(original: SurvivalState, source: ProductionState, construction: ConstructionState,
  world: WorldMap, player: Cell, isDay: boolean, command: TamingCommand) {
  const reject = (reason: string) => ({ accepted: false as const, reason })
  if (original.taming.job?.phase === 'taming') return reject('正在驯服，完成后才能进行其他行动')
  const state = structuredClone(original), production = structuredClone(source)
  const accept = (message: string, openProduction = false) => ({ accepted: true as const, state, production, message, openProduction })
  if (command.type === 'taming-cancel') {
    releaseTaming(state, production, false)
    return accept('已取消驯服，预留物资已释放')
  }
  if (state.taming.job) return reject('已经在前往动物身边')
  const requestedId = command.type === 'taming-interact' ? command.targetId : undefined
  const targetId = requestedId === 'companion' ? undefined : requestedId
  const animal = tamingAnimal(state, targetId ?? 'companion')
  if (!animal || targetId && state.duel?.enemy.id === targetId) return reject('这只动物现在无法驯服')
  if (companions(state).filter(b => b.status !== 'wild').length >= ENCOUNTERS.companionLimit) return reject(`伙伴已达到 ${ENCOUNTERS.companionLimit} 只上限`)
  if (!targetId && !isDay) return reject('等白天再接近受惊的小犬')
  if (construction.jobs.length) return reject('请先完成或取消已安排的工程')
  state.taming = { ordered: true, job: null, ...(targetId ? { targetId } : {}) }
  const ids = matchRequirements(production.inventory, SURVIVAL_RULES.companion.rescueItems)
  if (!ids) return accept('已添加驯服订单，去合成所需物资吧', true)
  const grid = constructionNavigation(world, construction), at = pointCell(actorPosition(animal))
  const work = [{ x: at.x - 1, y: at.y }, { x: at.x + 1, y: at.y },
    { x: at.x, y: at.y - 1 }, { x: at.x, y: at.y + 1 }]
    .filter(cell => grid.canStep(cell, at))
    .sort((a, b) => pointDistance(a, player) - pointDistance(b, player))
    .concat([{ ...at }])
    .find(cell => reachable(grid, pointCell(player), cell, world))
  if (!work) return reject('暂时无法走到动物身边')
  animal.route = []; animal.progress = 0; animal.target = null
  // Keep the actual animal position while the player walks to its adjacent work cell.
  if (animal.motion) animal.motion.position = { ...actorPosition(animal) }
  for (const id of ids) production.inventory.items[id].reservedBy = TAMING_ORDER
  state.taming.job = { phase: 'travel', workCell: work, reservedIds: ids, remaining: 0 }
  state.resting = false
  return accept(`正在前往${companionName(animal)}身边，物资尚未扣除`)
}
