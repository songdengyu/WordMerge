import { blueprintById } from './buildingConfig'
import { footprint, placementError, type ConstructionState } from './construction'
import type { ProgressionState } from './progression'
import { REGION_BOARS, REGION_LODGE } from './regionContentConfig'
import type { SurvivalState } from './survival'
import { ENEMIES } from './survivalConfig'
import { CHUNK_SIZE, type Cell, type WorldMap } from './world'

function regionCells(world: WorldMap, id: string, near: Cell) {
  const chunk = world.config.chunks.find(c => c.id === id)
  if (!chunk) return []
  return Array.from({ length: CHUNK_SIZE ** 2 }, (_, i) => ({ x: chunk.x * CHUNK_SIZE + i % CHUNK_SIZE, y: chunk.y * CHUNK_SIZE + Math.floor(i / CHUNK_SIZE) }))
    .sort((a, b) => Math.abs(a.x - near.x) + Math.abs(a.y - near.y) - Math.abs(b.x - near.x) - Math.abs(b.y - near.y))
}

/** Mutates only runtime-owned or validated cloned data. Each regional discovery is seeded once. */
export function populateRegionContent(world: WorldMap, construction: ConstructionState, survival: SurvivalState, progression: ProgressionState) {
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
      construction.buildings.push({ id: `b${construction.nextId++}`, blueprintId: blueprint.id, origin, rotation: 0,
        parts: Object.fromEntries(blueprint.parts.map(part => [part.id, { hp: 0, built: false, xpGranted: false }])) })
      initialized.push(REGION_LODGE.regionId); changed = true
    }
  }
  return changed
}
