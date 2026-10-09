import { Graphics } from 'pixi.js'
import type { Cell, Terrain, WorldMap } from '../game/world'
import { gridToWorld } from './camera'

import { boundaryTerrain, terrainCorners, terrainEdges, terrainSeed as noise, type TerrainCorner, type TerrainEdge } from './terrainContours'

const COLORS: Record<Terrain, number> = { grass: 0xa7b68a, path: 0xcdbd98, water: 0x82aaa5, rock: 0x9ca598 }
export function terrainColor(world: WorldMap, cell: Cell, unlocked: boolean) {
  // Match the opaque fog base so cached mask antialiasing cannot reveal dark chunk seams.
  if (!unlocked) return 0xd0ddd5
  return COLORS[world.terrainAt(cell) ?? 'grass']
}

/** A second pass after base tiles: shared edges are never overwritten by the next tile. */
export function terrainDetail(g: Graphics, world: WorldMap, cell: Cell) {
  const p = gridToWorld(cell), terrain = world.terrainAt(cell), seed = noise(cell.x, cell.y)
  if (terrain === 'grass') {
    if (seed % 3 === 0) g.ellipse(p.x + seed % 13 - 6, p.y, 20, 7).fill({ color: 0xc8cba0, alpha: .13 })
    if (seed % 4 === 0) {
      const x = p.x + seed % 17 - 8, y = p.y + seed % 7 - 3
      g.moveTo(x - 5, y).quadraticCurveTo(x - 5, y - 5, x - 9, y - 6)
        .moveTo(x - 5, y).quadraticCurveTo(x - 3, y - 5, x + 1, y - 5).stroke({ width: 1.2, color: 0x708b60, alpha: .6 })
      if (seed % 12 === 0) for (const dx of [-4, 3]) {
        g.circle(x + dx, y - 4, 2).fill(seed % 24 ? 0xe5c0b2 : 0xddd8ae)
        g.circle(x + dx, y - 4, .6).fill(0xb99660)
      }
    }
  } else if (terrain === 'water') {
    if (seed % 3 === 0) g.moveTo(p.x - 11, p.y).quadraticCurveTo(p.x - 2, p.y + 3, p.x + 9, p.y)
      .stroke({ color: 0xd4e1cb, alpha: .38, width: 1.2 })
  } else if (seed % 4 === 0) {
    g.ellipse(p.x - 8, p.y + 1, 2.6, 1.3).fill({ color: 0x9a957e, alpha: .4 })
    g.ellipse(p.x + 7, p.y - 2, 1.5, .8).fill({ color: 0xeee0ba, alpha: .65 })
  }
}

const borderStyle = (a: Terrain, b: Terrain) => {
  const terrain = boundaryTerrain(a, b)
  return { color: terrain === 'water' ? 0xd4cfaa : terrain === 'rock' ? 0x7e9472 : 0xb4b18a,
    width: terrain === 'water' ? 2.5 : 1.6, alpha: .65, cap: 'round' as const }
}

function cornerPath(g: Graphics, corner: TerrainCorner) {
  const b = gridToWorld(corner.end), v = gridToWorld(corner.vertex)
  if (corner.bevel) g.lineTo(b.x, b.y)
  else {
    const a = gridToWorld(corner.start)
    // Quarter-circle fillet: flatter near the original corner than the old quadratic,
    // with matching tangents at both ends. The isometric projection preserves smooth joins.
    const k = .5522847498
    g.bezierCurveTo(a.x + (v.x - a.x) * k, a.y + (v.y - a.y) * k,
      b.x + (v.x - b.x) * k, b.y + (v.y - b.y) * k, b.x, b.y)
  }
}

function edgePath(g: Graphics, edge: TerrainEdge) {
  const start = gridToWorld(edge.start)
  g.moveTo(start.x, start.y)
  for (const curve of edge.curves) {
    const a = gridToWorld(curve.control1), b = gridToWorld(curve.control2), end = gridToWorld(curve.end)
    g.bezierCurveTo(a.x, a.y, b.x, b.y, end.x, end.y)
  }
}

/** Cover the sharp fill wedge with its neighbor's material, using the same curve as the border. */
export function terrainTransitionFill(g: Graphics, world: WorldMap, cell: Cell) {
  for (const corner of terrainCorners(world, cell)) {
    const v = gridToWorld(corner.vertex), a = gridToWorld(corner.start)
    g.moveTo(v.x, v.y).lineTo(a.x, a.y)
    cornerPath(g, corner)
    g.closePath().fill(COLORS[corner.outside])
  }
  for (const edge of terrainEdges(world, cell)) {
    edgePath(g, edge)
    // The baseline closes a narrow strip; paint the actual terrain, not just a wavy outline.
    g.closePath().fill(COLORS[edge.offset > 0 ? edge.inside : edge.outside])
  }
}

export function terrainTransitionBorder(g: Graphics, world: WorldMap, cell: Cell) {
  for (const corner of terrainCorners(world, cell)) {
    const a = gridToWorld(corner.start)
    g.moveTo(a.x, a.y); cornerPath(g, corner)
    g.stroke(borderStyle(corner.inside, corner.outside))
  }
  for (const edge of terrainEdges(world, cell)) {
    edgePath(g, edge)
    g.stroke(borderStyle(edge.inside, edge.outside))
    // Sparse, deterministic tufts and pebbles soften long straight runs without obscuring the shore.
    const seed = noise(cell.x * 2 + (edge.neighbor.x - cell.x), cell.y * 2 + (edge.neighbor.y - cell.y))
    if (seed % 4 !== 0 || (edge.inside !== 'grass' && edge.outside !== 'grass')) continue
    const grass = edge.inside === 'grass' ? edge.cell : edge.neighbor
    const center = edge.curves[0].end
    const p = gridToWorld({ x: center.x + (grass.x - center.x) * .24, y: center.y + (grass.y - center.y) * .24 })
    if (boundaryTerrain(edge.inside, edge.outside) === 'rock') {
      g.ellipse(p.x, p.y, 2.6, 1.3).fill({ color: 0x89967e, alpha: .65 })
      g.ellipse(p.x - .6, p.y - .5, 1.3, .5).fill({ color: 0xc8ccb1, alpha: .65 })
    } else {
      g.moveTo(p.x - 2, p.y).quadraticCurveTo(p.x - 3, p.y - 2, p.x - 5, p.y - 3)
        .moveTo(p.x - 2, p.y).quadraticCurveTo(p.x, p.y - 3, p.x + 2, p.y - 3)
        .stroke({ width: 1, color: 0x788e62, alpha: .55 })
    }
  }
}
