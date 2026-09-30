import { constructionNavigation, reachable, type ConstructionState } from './construction'
import { matchRequirements, type ProductionState } from './inventory'
import type { SurvivalState } from './survival'
import { SURVIVAL_RULES } from './survivalConfig'
import { pointCell, pointDistance } from './smoothNavigation'
import type { Cell, WorldMap } from './world'

// Additive to existing saves; does not change the survival content fingerprint.
export const TAMING_SECONDS = 2
export const TAMING_ORDER = 'taming:companion'
export interface TamingJob {
  phase: 'travel' | 'taming'; workCell: Cell; reservedIds: string[]; remaining: number
}
export interface TamingState { ordered: boolean; job: TamingJob | null }
export type TamingCommand = { type: 'companion-rescue' } | { type: 'taming-interact' } | { type: 'taming-cancel' }

/** Mutates only the caller's private clone. Reserved pieces stay in their original slots. */
export function releaseTaming(state: SurvivalState, production: ProductionState, keepOrder = true) {
  for (const id of state.taming.job?.reservedIds ?? []) {
    const item = production.inventory.items[id]
    if (item?.reservedBy === TAMING_ORDER) item.reservedBy = null
  }
  state.taming = { ordered: keepOrder && state.companion.status === 'wild', job: null }
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
  if (state.companion.status !== 'wild') return reject('栗栗已经加入营地')
  if (state.taming.job) return reject('已经在前往动物身边')
  if (!isDay) return reject('等白天再接近受惊的小犬')
  if (construction.jobs.length) return reject('请先完成或取消已安排的工程')
  state.taming.ordered = true
  const ids = matchRequirements(production.inventory, SURVIVAL_RULES.companion.rescueItems)
  if (!ids) return accept('已添加驯服订单，去合成所需物资吧', true)
  const grid = constructionNavigation(world, construction), animal = state.companion.cell
  const work = [{ x: animal.x - 1, y: animal.y }, { x: animal.x + 1, y: animal.y },
    { x: animal.x, y: animal.y - 1 }, { x: animal.x, y: animal.y + 1 }]
    .filter(cell => grid.canStep(cell, animal))
    .sort((a, b) => pointDistance(a, player) - pointDistance(b, player))
    .concat([{ ...animal }])
    .find(cell => reachable(grid, pointCell(player), cell, world))
  if (!work) return reject('暂时无法走到动物身边')
  for (const id of ids) production.inventory.items[id].reservedBy = TAMING_ORDER
  state.taming.job = { phase: 'travel', workCell: work, reservedIds: ids, remaining: 0 }
  state.resting = false
  return accept('正在前往栗栗身边，物资尚未扣除')
}
