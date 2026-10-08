import { afterEach, describe, expect, it } from 'vitest'
import { Camera, gridToWorld, worldToGrid } from './camera'
import { CAMERA_CONFIG } from './cameraConfig'

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

const speed = CAMERA_CONFIG.followReturnSpeed
afterEach(() => { CAMERA_CONFIG.followReturnSpeed = speed })
const player = { x: 7, y: 9 }
function setup() {
  const camera = new Camera({ left: -2000, right: 2000, top: -2000, bottom: 2000 })
  camera.resize(400, 800); camera.center(player)
  camera.pan(200, 100)
  return camera
}
function gap(camera: Camera) {
  const point = camera.toScreen({ x: -64, y: 256 })
  return Math.hypot(point.x - 200, point.y - 400)
}
describe('camera return interpolation', () => {
  it('returns gradually then keeps a moving target exactly centered', () => {
    const camera = setup(), before = gap(camera)
    camera.follow(player, 1 / 60, 'player')
    expect(gap(camera)).toBeGreaterThan(before * .8)
    expect(gap(camera)).toBeLessThan(before)
    for (let i = 0; i < 120; i++) camera.follow(player, 1 / 60, 'player')
    expect(gap(camera)).toBe(0)
    camera.follow({ x: 8, y: 9 }, 1 / 60, 'player')
    expect(camera.toScreen({ x: -32, y: 272 })).toEqual({ x: 200, y: 400 })
  })
  it('converges equally at 30 and 60 fps', () => {
    const slowFrames = setup(), fastFrames = setup()
    for (let i = 0; i < 15; i++) slowFrames.follow(player, 1 / 30, 'player')
    for (let i = 0; i < 30; i++) fastFrames.follow(player, 1 / 60, 'player')
    expect(gap(slowFrames)).toBeCloseTo(gap(fastFrames), 8)
  })
  it('respects configured speed and caps long background frames', () => {
    const slow = setup(), fast = setup(), resumed = setup()
    CAMERA_CONFIG.followReturnSpeed = 3
    for (let i = 0; i < 15; i++) slow.follow(player, 1 / 60, 'player')
    CAMERA_CONFIG.followReturnSpeed = 9
    for (let i = 0; i < 15; i++) fast.follow(player, 1 / 60, 'player')
    expect(gap(fast)).toBeLessThan(gap(slow))
    resumed.follow(player, 60, 'player')
    expect(gap(resumed)).toBeGreaterThan(100)
  })
})
