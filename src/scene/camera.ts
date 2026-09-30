import type { Cell } from '../game/world'

export const TILE_WIDTH = 64
export const TILE_HEIGHT = 32
export const MIN_ZOOM = 0.65
export const MAX_ZOOM = 1.6
export type Point = { x: number; y: number }

export function gridToWorld(cell: Cell): Point {
  return { x: (cell.x - cell.y) * TILE_WIDTH / 2, y: (cell.x + cell.y) * TILE_HEIGHT / 2 }
}
export function worldToGrid(point: Point): Cell {
  return { x: Math.round(point.x / TILE_WIDTH + point.y / TILE_HEIGHT),
    y: Math.round(point.y / TILE_HEIGHT - point.x / TILE_WIDTH) }
}

export class Camera {
  x = 0
  y = 0
  zoom = 1
  width = 1
  height = 1
  constructor(private readonly bounds: { left: number; right: number; top: number; bottom: number }) {}
  toWorld(point: Point): Point { return { x: (point.x - this.x) / this.zoom, y: (point.y - this.y) / this.zoom } }
  toScreen(point: Point): Point { return { x: point.x * this.zoom + this.x, y: point.y * this.zoom + this.y } }
  resize(width: number, height: number) {
    this.x += (width - this.width) / 2
    this.y += (height - this.height) / 2
    this.width = width; this.height = height
    this.clamp()
  }
  center(cell: Cell) {
    const point = gridToWorld(cell)
    this.x = this.width / 2 - point.x * this.zoom
    this.y = this.height * 0.52 - point.y * this.zoom
    this.clamp()
  }
  pan(dx: number, dy: number) { this.x += dx; this.y += dy; this.clamp() }
  zoomAt(zoom: number, anchor: Point) {
    const world = this.toWorld(anchor)
    this.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom))
    this.x = anchor.x - world.x * this.zoom
    this.y = anchor.y - world.y * this.zoom
    this.clamp()
  }
  private clamp() {
    // Keep at least part of the configured world on screen; returning to the player is always available.
    this.x = Math.max(this.width * 0.2 - this.bounds.right * this.zoom,
      Math.min(this.width * 0.8 - this.bounds.left * this.zoom, this.x))
    this.y = Math.max(this.height * 0.2 - this.bounds.bottom * this.zoom,
      Math.min(this.height * 0.8 - this.bounds.top * this.zoom, this.y))
  }
}
