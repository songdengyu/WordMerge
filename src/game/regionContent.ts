import { blueprintById } from './buildingConfig'
import { createBuildingParts } from './buildingSegments'
import { footprint, placementError, type Building, type ConstructionState } from './construction'
import type { ProgressionState } from './progression'
import { REGION_BOARS, REGION_LODGE } from './regionContentConfig'
import { actorPosition, companions, type SurvivalState } from './survival'
import { ENEMIES } from './survivalConfig'
import { CHUNK_SIZE, type Cell, type WorldMap } from './world'

function regionCells(world: WorldMap, id: string, near: Cell) {
  const chunk = world.config.chunks.find(c => c.id === id)
  if (!chunk) return []
  return Array.from({ length: CHUNK_SIZE ** 2 }, (_, i) => ({ x: chunk.x * CHUNK_SIZE + i % CHUNK_SIZE, y: chunk.y * CHUNK_SIZE + Math.floor(i / CHUNK_SIZE) }))
    .sort((a, b) => Math.abs(a.x - near.x) + Math.abs(a.y - near.y) - Math.abs(b.x - near.x) - Math.abs(b.y - near.y))
}

/** Mutates only runtime-owned or validated cloned data. Each regional discovery is seeded once. */
export function grantLodgeFoundation(construction: ConstructionState, building: Building) {
  const part = building.parts.foundation
  if (part.built) return false
  const config = blueprintById(building.blueprintId)!.parts.find(p => p.id === 'foundation')!
  Object.assign(part, { built: true, hp: config.hp, xpGranted: true })
  if (part.segments) for (const id of Object.keys(part.segments)) part.segments[id] = config.hp
  construction.xp += config.xp
  return true
}

export function populateRegionContent(world: WorldMap, construction: ConstructionState, survival: SurvivalState, progression: ProgressionState, playerPath: readonly Cell[] = []) {
  let changed = false
  const initialized = progression.regionContent.initialized
  if (progression.unlockedRegions.includes('brook') && !initialized.includes('brook')) {
    const occupied = construction.buildings.flatMap(b => footprint(b, blueprintById(b.blueprintId)!))
    for (const spawn of REGION_BOARS) {
      if (survival.enemies.some(e => e.residentId === spawn.id)) continue
      const cell = regionCells(world, spawn.regionId, spawn.cell).find(p => world.isWalkable(p)
        && !occupied.some(c => c.x === p.x && c.y === p.y) && !survival.enemies.some(e => e.cell.x === p.x && e.cell.y === p.y))
      if (!cell) continue
      survival.enemies.push({ id: `e${survival.nextEnemyId++}`, kind: 'boar', residentId: spawn.id, hp: ENEMIES.boar.hp,
        cell, route: [], progress: 0, target: null, cooldown: 0 })
      changed = true
    }
    initialized.push('brook'); changed = true
  }
  if (progression.unlockedRegions.includes(REGION_LODGE.regionId) && !initialized.includes(REGION_LODGE.regionId)) {
    const blueprint = blueprintById(REGION_LODGE.blueprintId)!
    const origin = regionCells(world, REGION_LODGE.regionId, REGION_LODGE.origin).find(p => {
      const cells = footprint({ origin: p, rotation: 0 }, blueprint)
      return cells.every(c => world.chunkAt(c)?.id === REGION_LODGE.regionId && !(c.x === 21 && c.y === 8))
        && !placementError(world, construction, blueprint.id, p, 0, world.config.spawn)
    })
    if (origin) {
      const building = { id: `b${construction.nextId++}`, blueprintId: blueprint.id, origin, rotation: 0 as const, parts: createBuildingParts(blueprint) }
      construction.buildings.push(building)
      grantLodgeFoundation(construction, building)
      initialized.push(REGION_LODGE.regionId); changed = true
    }
  }
  if (initialized.includes('grove') && !progression.regionContent.statue) {
    const lodge = construction.buildings.find(b => b.blueprintId === REGION_LODGE.blueprintId)
    if (!lodge) return changed
    const occupied = construction.buildings.flatMap(b => footprint(b, blueprintById(b.blueprintId)!))
    const paths = [playerPath, ...[...companions(survival), ...survival.enemies].map(actor => [actorPosition(actor), ...actor.route])]
    // Keep a new obstacle clear of all saved continuous routes and active working positions.
    const safe = (p: Cell) => paths.every(path => path.every((b, i) => {
      const a = path[Math.max(0, i - 1)]
      return p.x < Math.min(a.x, b.x) - 1 || p.x > Math.max(a.x, b.x) + 1
        || p.y < Math.min(a.y, b.y) - 1 || p.y > Math.max(a.y, b.y) + 1
    })) && ![...construction.jobs.map(job => job.workCell), survival.taming.job?.workCell, progression.regionUnlock?.workCell]
      .some(cell => cell && Math.abs(cell.x - p.x) <= 1 && Math.abs(cell.y - p.y) <= 1)
    const cell = regionCells(world, 'grove', { x: lodge.origin.x - 2, y: lodge.origin.y + 3 }).find(p => world.isWalkable(p)
      && !(Math.abs(p.x - 21) <= 1 && Math.abs(p.y - 8) <= 1)
      && !occupied.some(c => Math.abs(c.x - p.x) <= 1 && Math.abs(c.y - p.y) <= 1) && safe(p))
    if (cell) { progression.regionContent.statue = cell; changed = true }
  }
  return changed
}
