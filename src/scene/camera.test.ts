import { describe, expect, it } from 'vitest'
import { Camera, gridToWorld, worldToGrid } from './camera'

describe('isometric camera', () => {
  it('round-trips tile centers including negative chunk coordinates', () => {
    for (const cell of [{ x: 0, y: 0 }, { x: 7, y: 9 }, { x: 15, y: -16 }, { x: -8, y: 12 }]) {
      expect(worldToGrid(gridToWorld(cell))).toEqual(cell)
    }
  })
  it('preserves the world point under a zoom gesture and clamps scale', () => {
    const camera = new Camera({ left: -1000, right: 2000, top: -1000, bottom: 2000 })
    camera.resize(390, 844)
    camera.center({ x: 7, y: 9 })
    const anchor = { x: 180, y: 360 }
    const before = camera.toWorld(anchor)
    camera.zoomAt(1.4, anchor)
    expect(camera.toWorld(anchor).x).toBeCloseTo(before.x)
    expect(camera.toWorld(anchor).y).toBeCloseTo(before.y)
    camera.zoomAt(20, anchor); expect(camera.zoom).toBe(1.6)
    camera.zoomAt(0, anchor); expect(camera.zoom).toBe(0.65)
  })
  it('resize maintains the viewed world center and panning remains bounded', () => {
    const camera = new Camera({ left: -1000, right: 2000, top: -1000, bottom: 2000 })
    camera.resize(390, 844); camera.center({ x: 7, y: 9 })
    const before = camera.toWorld({ x: 195, y: 422 })
    camera.resize(500, 600)
    expect(camera.toWorld({ x: 250, y: 300 })).toEqual(before)
    camera.pan(1e6, 1e6)
    expect(camera.x).toBeLessThan(2000)
    expect(camera.y).toBeLessThan(2000)
  })
})
