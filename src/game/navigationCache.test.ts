import { describe, expect, it, vi } from 'vitest'
import { blueprintById } from './buildingConfig'
import { createBuildingParts, setSegmentHp } from './buildingSegments'
import { constructionNavigation, type ConstructionState } from './construction'
import { PathSearch } from './navigation'
import { SmoothPathSearch } from './smoothNavigation'
import { enemyNavigation } from './survival'
import { REGIONS, REGION_EXTENSIONS } from './progressionConfig'
import { WorldMap } from './world'
import { worldFixture } from './testFixtures'

function cabin(): ConstructionState {
  const bp = blueprintById('cabin')!, parts = createBuildingParts(bp)
  for (const p of bp.parts) {
    Object.assign(parts[p.id], { built: true, hp: p.hp, xpGranted: true })
    if (parts[p.id].segments) for (const id in parts[p.id].segments) parts[p.id].segments![id] = p.hp
  }
  return { buildings: [{ id: 'b1', blueprintId: bp.id, origin: { x: 7, y: 10 }, rotation: 0, parts }],
    unlockedBlueprints: ['cabin'], xp: 70, nextId: 2, jobs: [], orders: [] }
}

describe('derived navigation topology cache', () => {
  it('distinguishes enemy closed doors from friendly doors without repeated full-map failed searches', () => {
    const world = worldFixture(), state = cabin(), outside = { x: 8, y: 12 }, inside = { x: 8, y: 11 }
    const hostile = constructionNavigation(world, state, 'enemy'), friendly = constructionNavigation(world, state)
    expect(hostile.connected!(outside, inside)).toBe(false)
    expect(friendly.connected!(outside, inside)).toBe(true)
    const astar = vi.spyOn(PathSearch.prototype, 'advance')
    try {
      for (let i = 0; i < 100; i++) expect(new SmoothPathSearch(hostile, outside, inside).advance()).toEqual({ status: 'unreachable' })
      expect(astar).not.toHaveBeenCalled()
    } finally { astar.mockRestore() }
  })

  it('reuses standing walls across partial damage, but immediately rebuilds on destruction and repair', () => {
    const world = worldFixture(), state = cabin(), wall = state.buildings[0].parts.walls
    const outside = { x: 8, y: 9 }, inside = { x: 8, y: 10 }
    const original = constructionNavigation(world, state, 'enemy')
    expect(original.connected!(outside, inside)).toBe(false)
    setSegmentHp(wall, 'edge0', 3)
    expect(constructionNavigation(world, structuredClone(state), 'enemy')).toBe(original)
    // Opening any intact wall makes the interior reachable, without modifying old derived grids.
    setSegmentHp(wall, 'edge0', 0)
    const opened = constructionNavigation(world, state, 'enemy')
    expect(opened).not.toBe(original)
    expect(opened.connected!(outside, inside)).toBe(true)
    expect(original.connected!(outside, inside)).toBe(false)
    setSegmentHp(wall, 'edge0', 20)
    const repaired = constructionNavigation(world, state, 'enemy')
    expect(repaired.connected!(outside, inside)).toBe(false)
    expect(opened.connected!(outside, inside)).toBe(true)
  })

  it('invalidates removed resources and newly opened land, including negative coordinates', () => {
    const world = worldFixture(), state = cabin(), before = constructionNavigation(world, state)
    expect(before.isWalkable({ x: 6, y: 13 })).toBe(false)
    expect(before.isWalkable({ x: -9, y: 8 })).toBe(false)
    const expanded = new WorldMap(world.config, REGIONS.map(r => r.id), REGION_EXTENSIONS, ['t14'])
    const after = constructionNavigation(expanded, state)
    expect(after.isWalkable({ x: 6, y: 13 })).toBe(true)
    expect(after.connected!({ x: -9, y: 8 }, { x: 7, y: 9 })).toBe(true)
    expect(before.isWalkable({ x: -9, y: 8 })).toBe(false)
  })

  it('keeps resident boars inside their region even when the global component connects outside', () => {
    const base = worldFixture(), world = new WorldMap(base.config, ['brook'], REGION_EXTENSIONS)
    const grid = constructionNavigation(world, cabin(), 'enemy')
    const restricted = enemyNavigation(world, grid, 'brook-boar-1')
    expect(restricted).toBe(enemyNavigation(world, grid, 'brook-boar-1'))
    expect(grid.connected!({ x: 7, y: -2 }, { x: 7, y: 1 })).toBe(true)
    expect(restricted.connected!({ x: 7, y: -2 }, { x: 7, y: 1 })).toBe(false)
  })
})
