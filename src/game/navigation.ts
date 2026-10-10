import { cellKey, sameCell, type Cell, type WorldMap } from './world'

export type NavigationGrid = Pick<WorldMap, 'isWalkable' | 'canStep'> & { connected?: (from: Cell, to: Cell) => boolean | undefined }

interface Node { cell: Cell; cost: number; score: number; parent?: Node }
export type SearchResult = { status: 'pending' } | { status: 'found'; path: Cell[] } | { status: 'unreachable' }
const distance = (a: Cell, b: Cell, diagonal: boolean) => {
  const x = Math.abs(a.x - b.x), y = Math.abs(a.y - b.y)
  return diagonal ? Math.max(x, y) + (Math.SQRT2 - 1) * Math.min(x, y) : x + y
}

/** Budgeted A*. A spent budget is pending, never an unreachable destination. */
export class PathSearch {
  private readonly open: Node[] = []
  private readonly costs = new Map<string, number>()
  private readonly closed = new Set<string>()
  private result: SearchResult = { status: 'pending' }

  constructor(private readonly world: NavigationGrid, from: Cell, private readonly goal: Cell, private readonly diagonal = false) {
    if (!world.isWalkable(from) || !world.isWalkable(goal) || world.connected?.(from, goal) === false) {
      this.result = { status: 'unreachable' }
    } else {
      this.open.push({ cell: from, cost: 0, score: distance(from, goal, diagonal) })
      this.costs.set(cellKey(from), 0)
    }
  }

  advance(budget = 96): SearchResult {
    if (this.result.status !== 'pending') return this.result
    for (let count = 0; count < budget && this.open.length; count++) {
      let best = 0
      for (let i = 1; i < this.open.length; i++) if (this.open[i].score < this.open[best].score) best = i
      const node = this.open.splice(best, 1)[0]
      const key = cellKey(node.cell)
      if (this.closed.has(key)) continue
      if (sameCell(node.cell, this.goal)) {
        const path: Cell[] = []
        let current = node
        while (current.parent) { path.push(current.cell); current = current.parent }
        return this.result = { status: 'found', path: path.reverse() }
      }
      this.closed.add(key)
      const directions = this.diagonal ? [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [-1, -1], [1, -1]] : [[1, 0], [0, 1], [-1, 0], [0, -1]]
      for (const [dx, dy] of directions) {
        const next = { x: node.cell.x + dx, y: node.cell.y + dy }
        const nextKey = cellKey(next)
        const horizontal = { x: next.x, y: node.cell.y }, vertical = { x: node.cell.x, y: next.y }
        const passable = dx && dy ? this.world.canStep(node.cell, horizontal) && this.world.canStep(node.cell, vertical)
          && this.world.canStep(horizontal, next) && this.world.canStep(vertical, next) : this.world.canStep(node.cell, next)
        if (!passable || this.closed.has(nextKey)) continue
        const cost = node.cost + (dx && dy ? Math.SQRT2 : 1)
        if (cost >= (this.costs.get(nextKey) ?? Infinity)) continue
        this.costs.set(nextKey, cost)
        this.open.push({ cell: next, cost, score: cost + distance(next, this.goal, this.diagonal), parent: node })
      }
    }
    if (!this.open.length) this.result = { status: 'unreachable' }
    return this.result
  }
}
