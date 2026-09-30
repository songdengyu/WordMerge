import { cellKey, sameCell, type Cell, type WorldMap } from './world'

export type NavigationGrid = Pick<WorldMap, 'isWalkable' | 'canStep'>

interface Node { cell: Cell; cost: number; score: number; parent?: Node }
export type SearchResult = { status: 'pending' } | { status: 'found'; path: Cell[] } | { status: 'unreachable' }
const distance = (a: Cell, b: Cell) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y)

/** Budgeted A*. A spent budget is pending, never an unreachable destination. */
export class PathSearch {
  private readonly open: Node[] = []
  private readonly costs = new Map<string, number>()
  private readonly closed = new Set<string>()
  private result: SearchResult = { status: 'pending' }

  constructor(private readonly world: NavigationGrid, from: Cell, private readonly goal: Cell) {
    if (!world.isWalkable(from) || !world.isWalkable(goal)) {
      this.result = { status: 'unreachable' }
    } else {
      this.open.push({ cell: from, cost: 0, score: distance(from, goal) })
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
      for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
        const next = { x: node.cell.x + dx, y: node.cell.y + dy }
        const nextKey = cellKey(next)
        if (!this.world.canStep(node.cell, next) || this.closed.has(nextKey)) continue
        const cost = node.cost + 1
        if (cost >= (this.costs.get(nextKey) ?? Infinity)) continue
        this.costs.set(nextKey, cost)
        this.open.push({ cell: next, cost, score: cost + distance(next, this.goal), parent: node })
      }
    }
    if (!this.open.length) this.result = { status: 'unreachable' }
    return this.result
  }
}
