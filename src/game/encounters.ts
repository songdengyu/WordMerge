import { footprint, constructionNavigation, type ConstructionState } from './construction'
import { blueprintById } from './buildingConfig'
import { SmoothPathSearch, pointDistance } from './smoothNavigation'
import { actorPosition, companions, type SurvivalState } from './survival'
import type { Cell, WorldMap } from './world'

// Additive rules: old survival fingerprints remain loadable without resetting the camp.
export const ENCOUNTERS = {
  dayInterval: 160, nightInterval: 65, dayLimit: 2, nightLimit: 5,
  minDistance: 6, maxDistance: 14, retrySeconds: 5, tameChance: .3,
  companionLimit: 6,
  alertRange: 3, patienceSeconds: 5,
} as const

/** Camera reports visibility only. Runtime still chooses/validates all spawn positions. */
export type SpawnVisibility = (cell: Cell) => boolean
export function encounterCells(world: WorldMap, construction: ConstructionState, state: SurvivalState,
  player: Cell, visible?: SpawnVisibility) {
  const grid = constructionNavigation(world, construction, 'enemy')
  const occupied = construction.buildings.flatMap(b => footprint(b, blueprintById(b.blueprintId)!))
  const actors = [...state.enemies, ...companions(state)].map(actorPosition)
  const candidates: Cell[] = []
  const r = ENCOUNTERS.maxDistance
  for (let y = Math.floor(player.y - r); y <= Math.ceil(player.y + r); y++) for (let x = Math.floor(player.x - r); x <= Math.ceil(player.x + r); x++) {
    const cell = { x, y }, distance = pointDistance(cell, player)
    if (distance < ENCOUNTERS.minDistance || distance > r || !grid.isWalkable(cell) || visible?.(cell)
      || occupied.some(p => p.x === x && p.y === y) || actors.some(p => pointDistance(p, cell) < 1.5)) continue
    candidates.push(cell)
  }
  return candidates
}

export function reachableEncounter(world: WorldMap, construction: ConstructionState, from: Cell, player: Cell) {
  // Friendly doors allow proving connectivity even when attackers must break a closed door later.
  return new SmoothPathSearch(constructionNavigation(world, construction), from, player)
    .advance(world.config.chunks.length * 256 + 1).status === 'found'
}
