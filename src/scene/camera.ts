import type { Cell } from '../game/world'
import { CAMERA_CONFIG } from './cameraConfig'

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
/** Continuous grid coordinates for movement; placement and interactions still use worldToGrid. */
export function worldToPosition(point: Point): Cell {
  return { x: Number((point.x / TILE_WIDTH + point.y / TILE_HEIGHT).toFixed(4)),
    y: Number((point.y / TILE_HEIGHT - point.x / TILE_WIDTH).toFixed(4)) }
}

export class Camera {
  x = 0
  y = 0
  zoom = 1
  width = 1
  height = 1
  private followKey: string | null = null
  private followOffset: Point = { x: 0, y: 0 }
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
    this.cancelFollow()
    const point = gridToWorld(cell)
    this.x = this.width / 2 - point.x * this.zoom
    this.y = this.height / 2 - point.y * this.zoom
    this.clamp()
  }
  cancelFollow() { this.followKey = null }
  follow(cell: Cell, deltaSeconds: number, key: string) {
    const point = gridToWorld(cell)
    const target = { x: this.width / 2 - point.x * this.zoom, y: this.height / 2 - point.y * this.zoom }
    if (this.followKey !== key) {
      this.followKey = key
      this.followOffset = { x: this.x - target.x, y: this.y - target.y }
    }
    const dt = Math.max(0, Math.min(deltaSeconds, CAMERA_CONFIG.maxFrameSeconds))
    const decay = Math.exp(-Math.max(0, CAMERA_CONFIG.followReturnSpeed) * dt)
    this.followOffset.x *= decay; this.followOffset.y *= decay
    if (Math.hypot(this.followOffset.x, this.followOffset.y) <= CAMERA_CONFIG.settleDistance) this.followOffset = { x: 0, y: 0 }
    // Decay only the return offset; once centered, ordinary walking remains centered without lag.
    this.x = target.x + this.followOffset.x; this.y = target.y + this.followOffset.y
    this.clamp()
  }
  pan(dx: number, dy: number) { this.cancelFollow(); this.x += dx; this.y += dy; this.clamp() }
  zoomAt(zoom: number, anchor: Point) {
    this.cancelFollow()
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
