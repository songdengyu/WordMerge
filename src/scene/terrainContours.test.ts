import { describe, expect, it } from 'vitest'
import { WorldMap, type Terrain, type WorldConfig } from '../game/world'
import { cornersAt, terrainCorners, terrainEdges } from './terrainContours'

function world(tiles: [number, number, Terrain][], extra: WorldConfig['chunks'] = []) {
  return new WorldMap({ version: 1, dayDurationSeconds: 600, initialHour: 12, spawn: { x: 0, y: 0 },
    objects: [], blockedEdges: [], chunks: [{ id: 'camp', name: 'camp', x: 0, y: 0, unlocked: true,
      patches: tiles.map(([x, y, terrain]) => ({ x, y, width: 1, height: 1, terrain })) }, ...extra] })
}

describe('visual terrain contours', () => {
  it('joins every rounded shore endpoint exactly once, including an inner bend and a one-cell inlet', () => {
    const map = world([[5, 5, 'water'], [6, 5, 'water'], [7, 5, 'water'], [5, 6, 'water'], [7, 6, 'water']])
    const degree = new Map<string, number>()
    for (let y = 3; y < 9; y++) for (let x = 3; x < 9; x++) {
      for (const segment of [...terrainCorners(map, { x, y }), ...terrainEdges(map, { x, y })]) {
        for (const p of [segment.start, segment.end]) {
          const key = `${p.x.toFixed(6)},${p.y.toFixed(6)}`
          degree.set(key, (degree.get(key) ?? 0) + 1)
        }
      }
    }
    expect(degree.size).toBeGreaterThan(10)
    expect([...degree.values()].every(count => count === 2)).toBe(true)
    expect(map.isWalkable({ x: 6, y: 6 })).toBe(true)
    expect(map.isWalkable({ x: 5, y: 5 })).toBe(false)
  })

  it('keeps single tiles intact with larger corners that do not meet across an edge', () => {
    for (const terrain of ['path', 'water', 'rock'] as const) {
      const map = world([[5, 5, terrain]]), corners = terrainCorners(map, { x: 5, y: 5 })
      expect(corners).toHaveLength(4)
      for (const corner of corners) {
        expect(corner.bevel).toBe(false)
        for (const p of [corner.start, corner.end]) {
          expect(Math.hypot(p.x - corner.vertex.x, p.y - corner.vertex.y)).toBeLessThan(.5)
          expect(Math.max(Math.abs(p.x - 5), Math.abs(p.y - 5))).toBeLessThanOrEqual(.5)
        }
      }
    }
  })

  it('keeps irregular edges deterministic, within a narrow band, and tangent at both ends', () => {
    const map = world(Array.from({ length: 9 }, (_, i) => [5, i + 3, 'water']))
    const edges = Array.from({ length: 9 }, (_, i) => terrainEdges(map, { x: 5, y: i + 3 })).flat()
    expect(edges).toEqual(Array.from({ length: 9 }, (_, i) => terrainEdges(map, { x: 5, y: i + 3 })).flat())
    expect(new Set(edges.map(e => e.offset.toFixed(5))).size).toBeGreaterThan(3)
    expect(edges.some(edge => edge.offset > 0)).toBe(true)
    expect(edges.some(edge => edge.offset < 0)).toBe(true)
    for (const edge of edges) {
      const horizontal = edge.start.y === edge.end.y
      const normal = horizontal ? 'y' : 'x'
      expect(Math.abs(edge.offset)).toBeLessThanOrEqual(.14)
      expect(edge.curves[0].control1[normal]).toBe(edge.start[normal])
      expect(edge.curves[1].control2[normal]).toBe(edge.end[normal])
      expect(edge.curves[1].end).toEqual(edge.end)
      for (const curve of edge.curves) for (const point of [curve.control1, curve.control2, curve.end]) {
        expect(Math.abs(point[normal] - edge.start[normal])).toBeLessThanOrEqual(.14)
      }
    }
  })

  it('rounds diagonal contacts separately and preserves three-material junctions', () => {
    const map = world([[5, 5, 'water'], [6, 6, 'water']])
    const corners = cornersAt(map, { x: 5.5, y: 5.5 })
    expect(corners).toHaveLength(2)
    expect(corners.map(c => c.cell)).toEqual([{ x: 5, y: 5 }, { x: 6, y: 6 }])
    const three = cornersAt(world([[5, 5, 'water'], [6, 6, 'rock']]), { x: 5.5, y: 5.5 })
    expect(three).toHaveLength(2)
    expect(three.every(c => c.outside === 'grass')).toBe(true)
    expect(cornersAt(world([[5, 5, 'water'], [6, 5, 'rock']]), { x: 5.5, y: 5.5 })).toEqual([])
  })

  it('uses actual neighbors across chunk seams and hides undiscovered contours', () => {
    const extra = { id: 'east', name: 'east', x: 1, y: 0, unlocked: true,
      patches: [{ x: 0, y: 5, width: 1, height: 1, terrain: 'water' as const }] }
    const map = world([[15, 5, 'water']], [extra])
    expect(terrainEdges(map, { x: 15, y: 5 }).some(edge => edge.neighbor.x === 16)).toBe(false)
    expect(cornersAt(map, { x: 15.5, y: 5.5 })).toEqual([])
    expect(terrainCorners(map, { x: 16, y: 5 })).toHaveLength(2)
    const locked = world([[15, 5, 'water']], [{ ...extra, unlocked: false }])
    expect(cornersAt(locked, { x: 15.5, y: 5.5 })).toEqual([])
    expect(terrainEdges(locked, { x: 15, y: 5 }).some(edge => edge.neighbor.x === 16)).toBe(false)
  })
})
