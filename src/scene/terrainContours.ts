import { sameCell, type Cell, type Terrain, type WorldMap } from '../game/world'

export const terrainSeed = (x: number, y: number) => Math.abs(Math.imul(x + 713, 7919) ^ Math.imul(y + 431, 104729)) >>> 0
const priority: Record<Terrain, number> = { grass: 0, path: 1, rock: 2, water: 3 }
export interface TerrainCorner {
  vertex: Cell
  start: Cell
  end: Cell
  cell: Cell
  inside: Terrain
  outside: Terrain
  bevel: boolean
}
export interface TerrainCurve { control1: Cell; control2: Cell; end: Cell }
export interface TerrainEdge {
  start: Cell; end: Cell; cell: Cell; neighbor: Cell; inside: Terrain; outside: Terrain
  offset: number
  curves: TerrainCurve[]
}

/** Visual geometry only. Never feeds back into WorldMap or navigation. */
export function cornersAt(world: WorldMap, vertex: Cell): TerrainCorner[] {
  const cells = [[-.5, -.5], [.5, -.5], [.5, .5], [-.5, .5]]
    .map(([dx, dy]) => ({ x: vertex.x + dx, y: vertex.y + dy }))
  // Keep fog/map boundaries exact; do not sample undiscovered terrain for the silhouette.
  if (cells.some(cell => !world.chunkAt(cell)?.unlocked)) return []
  const terrains = cells.map(cell => world.terrainAt(cell)!)
  const indices = terrains.map((terrain, i) => {
    const adjacent = terrains[(i + 1) % 4], other = terrains[(i + 3) % 4]
    if (terrain === adjacent || adjacent !== other) return -1
    // Two different diagonal tips may round into the same surrounding material.
    // For checkerboards only the higher-priority material retreats; never cross the two curves.
    if (terrains[(i + 2) % 4] === terrain && priority[terrain] < priority[adjacent]) return -1
    return i
  }).filter(i => i >= 0)
  return indices.map(i => {
    const cell = cells[i], inside = terrains[i], outside = terrains[(i + 1) % 4]
    // Nearly meet the neighboring fillet at the edge midpoint without overlapping it.
    // Keep variation on the connecting edges, instead of leaving some corners noticeably sharper.
    const bevel = false
    const radius = .495
    return { vertex, cell, inside, outside, bevel,
      start: { x: vertex.x + Math.sign(cell.x - vertex.x) * radius, y: vertex.y },
      end: { x: vertex.x, y: vertex.y + Math.sign(cell.y - vertex.y) * radius } }
  })
}

export function terrainCorners(world: WorldMap, cell: Cell) {
  return [[-.5, -.5], [.5, -.5], [.5, .5], [-.5, .5]].flatMap(([dx, dy]) =>
    cornersAt(world, { x: cell.x + dx, y: cell.y + dy }).filter(corner => sameCell(corner.cell, cell)))
}

function trimmed(world: WorldMap, vertex: Cell, toward: Cell): Cell {
  for (const corner of cornersAt(world, vertex)) for (const point of [corner.start, corner.end]) {
    const dx = point.x - vertex.x, dy = point.y - vertex.y
    const tx = toward.x - vertex.x, ty = toward.y - vertex.y
    if (Math.abs(dx * ty - dy * tx) < 1e-8 && dx * tx + dy * ty > 0) return point
  }
  return vertex
}

/** East/south ownership draws each shared boundary exactly once, even across chunks. */
export function terrainEdges(world: WorldMap, cell: Cell): TerrainEdge[] {
  if (!world.chunkAt(cell)?.unlocked) return []
  const inside = world.terrainAt(cell)!
  return [[1, 0], [0, 1]].flatMap(([dx, dy]) => {
    const neighbor = { x: cell.x + dx, y: cell.y + dy }, outside = world.terrainAt(neighbor)
    if (!world.chunkAt(neighbor)?.unlocked || !outside || inside === outside) return []
    const a = { x: cell.x + dx * .5 - dy * .5, y: cell.y + dy * .5 - dx * .5 }
    const b = { x: cell.x + dx * .5 + dy * .5, y: cell.y + dy * .5 + dx * .5 }
    const start = trimmed(world, a, b), end = trimmed(world, b, a)
    const length = Math.hypot(end.x - start.x, end.y - start.y)
    // Mix low bits too: edge coordinates have fixed parity, which must not determine bulge direction.
    let seed = terrainSeed(cell.x * 2 + dx, cell.y * 2 + dy)
    seed = Math.imul(seed ^ (seed >>> 16), 0x45d9f3b) >>> 0
    seed = (seed ^ (seed >>> 16)) >>> 0
    // Fixed world-coordinate variation, with flat tangents at tile joins and corner cut points.
    // Short stretches between large rounded corners receive proportionally smaller ripples.
    const material = boundaryTerrain(inside, outside)
    const amplitude = material === 'water' ? .14 : material === 'rock' ? .08 : .11
    const offset = (seed % 2 ? -1 : 1) * amplitude * (.45 + (seed >>> 4) % 101 / 100 * .55) * length
    const peak = .36 + (seed >>> 12) % 29 / 100
    const at = (t: number, displacement: number): Cell => ({
      x: start.x + (end.x - start.x) * t + dx * displacement,
      y: start.y + (end.y - start.y) * t + dy * displacement,
    })
    const curves = [
      { control1: at(peak / 3, 0), control2: at(peak * 2 / 3, offset), end: at(peak, offset) },
      { control1: at(peak + (1 - peak) / 3, offset), control2: at(1 - (1 - peak) / 3, 0), end },
    ]
    return [{ start, end, cell, neighbor, inside, outside, offset, curves }]
  })
}

export function boundaryTerrain(a: Terrain, b: Terrain): Terrain { return priority[a] > priority[b] ? a : b }
