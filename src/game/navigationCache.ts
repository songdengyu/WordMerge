import type { NavigationGrid } from './navigation'
import { CHUNK_SIZE, type Cell, WorldMap } from './world'

/** Disposable derived data for ONE immutable terrain/wall topology, never saved. */
export class CachedNavigation implements NavigationGrid {
  private readonly left: number
  private readonly top: number
  private readonly width: number
  private readonly height: number
  private readonly walkable: Uint8Array
  private readonly steps: Uint8Array
  private readonly components: Uint32Array
  private nextComponent = 0

  constructor(private readonly world: WorldMap, private readonly source: NavigationGrid) {
    const chunks = world.config.chunks
    this.left = Math.min(...chunks.map(c => c.x)) * CHUNK_SIZE
    this.top = Math.min(...chunks.map(c => c.y)) * CHUNK_SIZE
    this.width = (Math.max(...chunks.map(c => c.x)) + 1) * CHUNK_SIZE - this.left
    this.height = (Math.max(...chunks.map(c => c.y)) + 1) * CHUNK_SIZE - this.top
    const size = this.width * this.height
    this.walkable = new Uint8Array(size)
    this.steps = new Uint8Array(size)
    this.components = new Uint32Array(size)
  }

  // Custom/live obstacle providers cannot promise an immutable topology. Keep their
  // original immediate revalidation semantics instead of trusting stale cached answers.
  private stable() {
    return this.world.canStep === WorldMap.prototype.canStep && this.world.isWalkable === WorldMap.prototype.isWalkable
      && this.world.terrainAt === WorldMap.prototype.terrainAt && this.world.objectAt === WorldMap.prototype.objectAt
  }

  private index(cell: Cell) {
    const x = cell.x - this.left, y = cell.y - this.top
    return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < this.width && y < this.height
      ? y * this.width + x : -1
  }

  isWalkable = (cell: Cell): boolean => {
    if (!this.stable()) return this.source.isWalkable(cell)
    const index = this.index(cell)
    if (index < 0) return false
    if (!this.walkable[index]) this.walkable[index] = this.source.isWalkable(cell) ? 1 : 2
    return this.walkable[index] === 1
  }

  canStep = (from: Cell, to: Cell): boolean => {
    if (!this.stable()) return this.source.canStep(from, to)
    const dx = to.x - from.x, dy = to.y - from.y
    if (Math.abs(dx) + Math.abs(dy) !== 1 || !this.isWalkable(to)) return false
    const index = this.index(from)
    if (index < 0) return this.source.canStep(from, to)
    const bit = dx === 1 ? 1 : dy === 1 ? 2 : dx === -1 ? 4 : 8
    if (!(this.steps[index] & (bit << 4))) {
      this.steps[index] |= (bit << 4) | (this.source.canStep(from, to) ? bit : 0)
    }
    return !!(this.steps[index] & bit)
  }

  /** Four-way components are also valid for corner-safe eight-way A*: a diagonal needs both cardinal paths. */
  connected = (from: Cell, to: Cell): boolean | undefined => {
    if (!this.stable()) return undefined
    if (!this.isWalkable(from) || !this.isWalkable(to)) return false
    const start = this.index(from), goal = this.index(to)
    if (!this.components[start]) {
      const component = ++this.nextComponent, queue = [start]
      this.components[start] = component
      for (let i = 0; i < queue.length; i++) {
        const index = queue[i], cell = { x: this.left + index % this.width, y: this.top + Math.floor(index / this.width) }
        for (const [dx, dy] of DIRECTIONS) {
          const next = { x: cell.x + dx, y: cell.y + dy }, ni = this.index(next)
          if (ni < 0 || this.components[ni] || !this.canStep(cell, next)) continue
          this.components[ni] = component; queue.push(ni)
        }
      }
    }
    return this.components[start] === this.components[goal]
  }
}

const DIRECTIONS = [[1, 0], [0, 1], [-1, 0], [0, -1]] as const
