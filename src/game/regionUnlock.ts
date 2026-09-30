import { constructionNavigation, reachable, type ConstructionState } from './construction'
import { regionError, type ProgressionState } from './progression'
import { REGIONS } from './progressionConfig'
import { pointCell, pointDistance } from './smoothNavigation'
import { CHUNK_SIZE, type Cell, type WorldMap } from './world'

export const REGION_UNLOCK_SECONDS = 2
export type GateSide = 'north' | 'east' | 'south' | 'west'
export interface RegionGate { side: GateSide; anchor: Cell; workCell: Cell }
export interface RegionUnlockJob { regionId: string; side: GateSide; phase: 'travel' | 'unlocking'; workCell: Cell; remaining: number }
export type RegionUnlockCommand = { type: 'region-unlock'; regionId: string; side?: GateSide } | { type: 'region-unlock-cancel' }

/** Four signs per locked chunk. Work positions always lie OUTSIDE that chunk. */
export function regionGates(world: WorldMap, regionId: string): RegionGate[] {
  const chunk = world.config.chunks.find(c => c.id === regionId)
  if (!chunk) return []
  const x = chunk.x * CHUNK_SIZE, y = chunk.y * CHUNK_SIZE, mid = CHUNK_SIZE / 2 - 1
  return [
    { side: 'north', anchor: { x: x + mid, y: y - .5 }, workCell: { x: x + mid, y: y - 1 } },
    { side: 'east', anchor: { x: x + CHUNK_SIZE - .5, y: y + mid }, workCell: { x: x + CHUNK_SIZE, y: y + mid } },
    { side: 'south', anchor: { x: x + mid, y: y + CHUNK_SIZE - .5 }, workCell: { x: x + mid, y: y + CHUNK_SIZE } },
    { side: 'west', anchor: { x: x - .5, y: y + mid }, workCell: { x: x - 1, y: y + mid } },
  ]
}

export function reachableRegionGate(world: WorldMap, construction: ConstructionState, player: Cell, regionId: string, side?: GateSide) {
  const grid = constructionNavigation(world, construction)
  return regionGates(world, regionId).filter(gate => !side || gate.side === side)
    .sort((a, b) => pointDistance(a.workCell, player) - pointDistance(b.workCell, player))
    .find(gate => world.isWalkable(gate.workCell) && reachable(grid, pointCell(player), gate.workCell, world))
}

export function requestRegionUnlock(progress: ProgressionState, construction: ConstructionState, world: WorldMap,
  player: Cell, otherJob: boolean, command: RegionUnlockCommand) {
  const reject = (reason: string) => ({ accepted: false as const, reason })
  if (progress.regionUnlock?.phase === 'unlocking') return reject('正在开放区域，完成后才能进行其他行动')
  if (command.type === 'region-unlock-cancel') return { accepted: true as const, state: { ...progress, regionUnlock: null }, message: '已取消前往指示牌' }
  if (progress.regionUnlock || otherJob || construction.jobs.length) return reject('请先完成或取消当前任务')
  const error = regionError(command.regionId, progress, construction)
  if (error) return reject(error)
  const region = REGIONS.find(r => r.id === command.regionId)!
  const gate = reachableRegionGate(world, construction, player, region.id, command.side)
  if (!gate) return reject('这一侧尚不可达，请从已开放的相邻地块接近指示牌')
  const job: RegionUnlockJob = { regionId: region.id, side: gate.side, workCell: { ...gate.workCell }, phase: 'travel', remaining: 0 }
  return { accepted: true as const, state: { ...progress, regionUnlock: job }, message: `正在前往${region.name}指示牌` }
}
