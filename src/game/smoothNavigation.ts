import { PathSearch, type NavigationGrid, type SearchResult } from './navigation'
import { cellKey, sameCell, type Cell } from './world'

export const PLAYER_RADIUS = .15
export const PLAYER_SPEED = 2.5
const EPSILON = 1e-7
export const pointCell = (point: Cell): Cell => ({ x: Math.round(point.x), y: Math.round(point.y) })
export const pointDistance = (a: Cell, b: Cell) => Math.hypot(a.x - b.x, a.y - b.y)
export const finitePoint = (point: Cell) => Number.isFinite(point.x) && Number.isFinite(point.y)

/** Keep the tapped point, pulling it inside its tile only when clearance requires it. */
export function moveTarget(grid: NavigationGrid, target: Cell): Cell | null {
  if (!target || !finitePoint(target) || !grid.isWalkable(pointCell(target))) return null
  if (canWalkLine(grid, target, target)) return { ...target }
  const cell = pointCell(target)
  const safe = { x: cell.x + Math.max(-.34, Math.min(.34, target.x - cell.x)),
    y: cell.y + Math.max(-.34, Math.min(.34, target.y - cell.y)) }
  return canWalkLine(grid, safe, safe) ? safe : null
}

/** Segment versus an expanded solid rectangle; touching the clearance boundary is allowed. */
function hitsBox(from: Cell, to: Cell, left: number, top: number, right: number, bottom: number) {
  let near = 0, far = 1
  for (const [origin, delta, min, max] of [[from.x, to.x - from.x, left + EPSILON, right - EPSILON],
    [from.y, to.y - from.y, top + EPSILON, bottom - EPSILON]]) {
    if (Math.abs(delta) < EPSILON) { if (origin < min || origin > max) return false }
    else {
      const a = (min - origin) / delta, b = (max - origin) / delta
      near = Math.max(near, Math.min(a, b)); far = Math.min(far, Math.max(a, b))
      if (near > far) return false
    }
  }
  return true
}

/** Sweep a small square footprint along the line, checking terrain AND wall edges.
 * DDA visits the corridor only, avoiding scans of the entire diagonal bounding box. */
export function canWalkLine(grid: NavigationGrid, from: Cell, to: Cell) {
  if (!finitePoint(from) || !finitePoint(to) || !grid.isWalkable(pointCell(from)) || !grid.isWalkable(pointCell(to))) return false
  const start = pointCell(from), end = pointCell(to), candidates = new Map<string, Cell>()
  const dx = to.x - from.x, dy = to.y - from.y, sx = Math.sign(dx), sy = Math.sign(dy)
  let x = start.x, y = start.y
  let tx = sx ? (x + sx * .5 - from.x) / dx : Infinity
  let ty = sy ? (y + sy * .5 - from.y) / dy : Infinity
  const limit = Math.abs(end.x - x) + Math.abs(end.y - y) + 2
  for (let i = 0; i < limit; i++) {
    for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
      const cell = { x: x + ox, y: y + oy }; candidates.set(cellKey(cell), cell)
    }
    if (x === end.x && y === end.y) break
    const crossX = tx <= ty, crossY = ty <= tx
    if (crossX) { x += sx; tx += 1 / Math.abs(dx) }
    if (crossY) { y += sy; ty += 1 / Math.abs(dy) }
  }
  const r = PLAYER_RADIUS
  for (const cell of candidates.values()) {
    const { x, y } = cell
    if (!grid.isWalkable(cell)) {
      if (hitsBox(from, to, x - .5 - r, y - .5 - r, x + .5 + r, y + .5 + r)) return false
      continue
    }
    const right = { x: x + 1, y }, down = { x, y: y + 1 }
    if (grid.isWalkable(right) && !grid.canStep(cell, right)
      && hitsBox(from, to, x + .5 - r, y - .5 - r, x + .5 + r, y + .5 + r)) return false
    if (grid.isWalkable(down) && !grid.canStep(cell, down)
      && hitsBox(from, to, x - .5 - r, y + .5 - r, x + .5 + r, y + .5 + r)) return false
  }
  return true
}

/** Pull visible waypoints together, then round turns only where the full curve is clear. */
export function smoothPath(grid: NavigationGrid, start: Cell, path: readonly Cell[]) {
  const pulled: Cell[] = [start]
  for (let i = 0; i < path.length;) {
    let next = path.length - 1
    while (next > i && !canWalkLine(grid, pulled[pulled.length - 1], path[next])) next--
    if (!canWalkLine(grid, pulled[pulled.length - 1], path[next])) return null
    if (pointDistance(pulled[pulled.length - 1], path[next]) > EPSILON) pulled.push(path[next])
    i = next + 1
  }
  const rounded: Cell[] = [start]
  for (let i = 1; i < pulled.length - 1; i++) {
    const a = pulled[i - 1], b = pulled[i], c = pulled[i + 1]
    const before = pointDistance(a, b), after = pointDistance(b, c), trim = Math.min(.3, before / 4, after / 4)
    const enter = { x: b.x + (a.x - b.x) * trim / before, y: b.y + (a.y - b.y) * trim / before }
    const leave = { x: b.x + (c.x - b.x) * trim / after, y: b.y + (c.y - b.y) * trim / after }
    const curve = [enter]
    for (let j = 1; j <= 5; j++) {
      const t = j / 5, u = 1 - t
      curve.push({ x: u * u * enter.x + 2 * u * t * b.x + t * t * leave.x,
        y: u * u * enter.y + 2 * u * t * b.y + t * t * leave.y })
    }
    const chain = [rounded[rounded.length - 1], ...curve, c]
    if (chain.slice(1).every((point, index) => canWalkLine(grid, chain[index], point))) rounded.push(...curve)
    else rounded.push(b)
  }
  if (pulled.length > 1) rounded.push(pulled[pulled.length - 1])
  return rounded.slice(1)
}

export class SmoothPathSearch {
  private readonly search?: PathSearch
  private result: SearchResult = { status: 'pending' }
  constructor(private readonly grid: NavigationGrid, private readonly from: Cell, private readonly goal: Cell) {
    if (!canWalkLine(grid, from, from) || !canWalkLine(grid, goal, goal)) this.result = { status: 'unreachable' }
    else if (canWalkLine(grid, from, goal)) this.result = { status: 'found', path: sameCell(from, goal) ? [] : [goal] }
    else this.search = new PathSearch(grid, pointCell(from), pointCell(goal), true)
  }
  advance(budget = 96): SearchResult {
    if (this.result.status !== 'pending') return this.result
    const result = this.search!.advance(budget)
    if (result.status !== 'found') return this.result = result
    const path = smoothPath(this.grid, this.from, [pointCell(this.from), ...result.path, this.goal])
    return this.result = path ? { status: 'found', path } : { status: 'unreachable' }
  }
}

/** Manual clicks accept solid/locked/outside goals. Save only the reachable stopping point.
 * Exact work positions and AI searches intentionally keep using SmoothPathSearch. */
export function manualMovePath(grid: NavigationGrid, from: Cell, target: Cell, maxCells: number) {
  if (!target || !finitePoint(target) || !canWalkLine(grid, from, from)) return null
  const exact = moveTarget(grid, target)
  if (exact) {
    const result = new SmoothPathSearch(grid, from, exact).advance(maxCells * 8 + 1)
    if (result.status === 'found') return { destination: exact, path: result.path }
  }
  // Search only the actor's connected component, never a nearby but isolated shore.
  type Node = { cell: Cell; parent?: Node }
  const start: Node = { cell: pointCell(from) }, queue: Node[] = [start], seen = new Set([cellKey(start.cell)])
  let best: Node = start, destination = { ...from }, distance = pointDistance(from, target)
  const clearance = .5 - PLAYER_RADIUS - .001
  for (let index = 0; index < queue.length && index < maxCells; index++) {
    const node = queue[index], cell = node.cell
    const point = { x: Math.max(cell.x - clearance, Math.min(cell.x + clearance, target.x)),
      y: Math.max(cell.y - clearance, Math.min(cell.y + clearance, target.y)) }
    const nextDistance = pointDistance(point, target)
    if (nextDistance < distance - EPSILON && canWalkLine(grid, cell, point)) {
      best = node; destination = point; distance = nextDistance
    }
    for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
      const next = { x: cell.x + dx, y: cell.y + dy }, key = cellKey(next)
      if (seen.has(key) || !grid.isWalkable(next) || !grid.canStep(cell, next)) continue
      seen.add(key); queue.push({ cell: next, parent: node })
    }
  }
  if (sameCell(destination, from)) return { destination, path: [] }
  const route: Cell[] = []
  for (let node: Node | undefined = best; node; node = node.parent) route.push(node.cell)
  const path = smoothPath(grid, from, [...route.reverse(), destination])
  return path ? { destination, path } : { destination: { ...from }, path: [] }
}

/** Consume real distance, carrying unused movement across waypoints instead of stopping at each one. */
export function walkPath(start: Cell, path: readonly Cell[], distance: number) {
  const budget = distance
  let position = start, index = 0
  while (index < path.length && distance > EPSILON) {
    const target = path[index], length = pointDistance(position, target)
    if (length <= distance + EPSILON) { position = target; distance -= length; index++ }
    else {
      const t = distance / length
      position = { x: position.x + (target.x - position.x) * t, y: position.y + (target.y - position.y) * t }; distance = 0
    }
  }
  return { position: { ...position }, route: path.slice(index), distance: Math.max(0, budget - distance) }
}
