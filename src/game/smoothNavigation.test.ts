import { describe, expect, it } from 'vitest'
import { canWalkLine, PLAYER_SPEED, pointCell, pointDistance, SmoothPathSearch, walkPath } from './smoothNavigation'
import { parseWorld, type Cell, type WorldConfig } from './world'
import { constructionNavigation } from './construction'
import { GameRuntime } from './GameRuntime'
import { validateSave } from './saveData'
import { dataFixture, envelopeFixture, productionFixture, testNow, worldFixture } from './testFixtures'
import { BLUEPRINTS } from './buildingConfig'

function config(): { -readonly [Key in keyof WorldConfig]: WorldConfig[Key] } {
  return { version: 1, dayDurationSeconds: 1200, initialHour: 6, spawn: { x: 2, y: 2 },
    chunks: [{ id: 'camp', name: 'Camp', x: 0, y: 0, unlocked: true, patches: [] }], objects: [], blockedEdges: [] }
}
function fullPath(world: Parameters<typeof canWalkLine>[0], from: Cell, to: Cell) {
  const search = new SmoothPathSearch(world, from, to)
  let result = search.advance(1)
  for (let count = 0; count < 2000 && result.status === 'pending'; count++) result = search.advance(16)
  if (result.status !== 'found') throw new Error('Expected a route')
  return result.path
}

describe('continuous path geometry', () => {
  it('walks straight to a fractional target at equal axial and diagonal speed', () => {
    const world = parseWorld(config()), start = { x: 2.1, y: 2.2 }, goal = { x: 8.27, y: 9.12 }
    const route = fullPath(world, start, goal)
    expect(route).toEqual([goal])
    const axial = walkPath(start, [{ x: 8, y: start.y }], PLAYER_SPEED / 20)
    const diagonal = walkPath(start, route, PLAYER_SPEED / 20)
    expect(pointDistance(start, axial.position)).toBeCloseTo(pointDistance(start, diagonal.position))
    expect(diagonal.position.x).toBeGreaterThan(start.x)
    expect(diagonal.position.y).toBeGreaterThan(start.y)
    expect(walkPath(start, route, 100)).toEqual({ position: goal, route: [] })
    expect(fullPath(world, start, start)).toEqual([])
  })

  it('never cuts blocked corners, walls, or brushes a wall while moving parallel to it', () => {
    const source = config()
    source.objects = [{ id: 'rock', kind: 'boulder', x: 3, y: 2 }, { id: 'tree', kind: 'tree', x: 2, y: 3 }]
    let world = parseWorld(source)
    expect(canWalkLine(world, { x: 2, y: 2 }, { x: 3, y: 3 })).toBe(false)
    const route = fullPath(world, source.spawn, { x: 4, y: 4 })
    expect(route.length).toBeGreaterThan(1)
    let from = source.spawn
    for (const next of route) { expect(canWalkLine(world, from, next)).toBe(true); from = next }
    source.objects = []
    source.blockedEdges = [{ from: { x: 3, y: 2 }, to: { x: 4, y: 2 } }]
    world = parseWorld(source)
    expect(canWalkLine(world, { x: 3, y: 2 }, { x: 4, y: 2 })).toBe(false)
    expect(canWalkLine(world, { x: 4, y: 2 }, { x: 3, y: 2 })).toBe(false)
    expect(canWalkLine(world, { x: 3.4, y: 1.9 }, { x: 3.4, y: 2.1 })).toBe(false)
    expect(canWalkLine(world, { x: 3.3, y: 1.9 }, { x: 3.3, y: 2.1 })).toBe(true)
    // Crossing two boundaries at exactly the same instant cannot slip through the wall endpoint.
    expect(canWalkLine(world, { x: 3, y: 2 }, { x: 4, y: 3 })).toBe(false)
  })

  it('rounds safe bends and carries the movement budget across short curve segments', () => {
    const source = config()
    source.chunks = [{ ...source.chunks[0], patches: [{ x: 3, y: 1, width: 1, height: 4, terrain: 'water' }] }]
    const world = parseWorld(source), goal = { x: 5.2, y: 2.15 }
    const route = fullPath(world, source.spawn, goal)
    expect(route.some(point => !Number.isInteger(point.x) || !Number.isInteger(point.y))).toBe(true)
    let position = source.spawn, remaining = route, travelled = 0
    for (let count = 0; count < 300 && remaining.length; count++) {
      const moved = walkPath(position, remaining, .125)
      expect(world.isWalkable(pointCell(moved.position))).toBe(true)
      expect(canWalkLine(world, position, moved.position)).toBe(true)
      expect(pointDistance(position, moved.position)).toBeLessThanOrEqual(.12500001)
      travelled += pointDistance(position, moved.position); position = moved.position; remaining = moved.route
    }
    expect(position).toEqual(goal)
    expect(travelled).toBeGreaterThan(pointDistance(source.spawn, goal))
    const small = [{ x: 1.03, y: 1 }, { x: 1.06, y: 1 }, { x: 1.09, y: 1 }, { x: 2, y: 1 }]
    expect(walkPath({ x: 1, y: 1 }, small, .125).position.x).toBeCloseTo(1.125)
  })

  it('uses door openings to enter a completed house and validates the continuous saved route against walls', () => {
    const data = dataFixture(), world = worldFixture(), catalog = productionFixture(), blueprint = BLUEPRINTS[0]
    data.construction = { unlockedBlueprints: ['cabin'], nextId: 2, xp: blueprint.parts.reduce((sum, part) => sum + part.xp, 0), orders: [], jobs: [],
      buildings: [{ id: 'b1', blueprintId: 'cabin', origin: { x: 7, y: 10 }, rotation: 0,
        parts: Object.fromEntries(blueprint.parts.map(part => [part.id, { built: true, hp: part.hp, xpGranted: true }])) }] }
    const grid = constructionNavigation(world, data.construction), start = { x: 8, y: 9 }, inside = { x: 8, y: 11 }
    expect(canWalkLine(grid, start, inside)).toBe(false)
    const route = fullPath(grid, start, inside)
    let from = start
    for (const next of route) { expect(canWalkLine(grid, from, next)).toBe(true); from = next }
    data.cell = start; data.motion = { version: 1, position: start }; data.route = route; data.destination = inside
    expect(validateSave(envelopeFixture(data), world, catalog).data.route).toEqual(route)
    data.route = [inside]
    expect(() => validateSave(envelopeFixture(data), world, catalog)).toThrow('建筑木墙')
  })

  it('handles negative coordinates, prevents leaving loaded land and reports unreachable only after searching', () => {
    const source = config()
    source.chunks = [...source.chunks, { id: 'west', name: 'West', x: -1, y: 0, unlocked: true, patches: [] }]
    let world = parseWorld(source)
    expect(canWalkLine(world, { x: -2.3, y: 2 }, { x: 2, y: 2.2 })).toBe(true)
    expect(canWalkLine(world, { x: -15.8, y: 2 }, { x: -16.4, y: 2 })).toBe(false)
    const goal = { x: 5, y: 5 }
    source.blockedEdges = [{ from: goal, to: { x: 4, y: 5 } }, { from: goal, to: { x: 6, y: 5 } },
      { from: goal, to: { x: 5, y: 4 } }, { from: goal, to: { x: 5, y: 6 } }]
    world = parseWorld(source)
    const search = new SmoothPathSearch(world, source.spawn, goal)
    expect(search.advance(1).status).toBe('pending')
    expect(search.advance(2000).status).toBe('unreachable')
  })
})

describe('continuous movement persistence', () => {
  it('preserves exact position and route on reload and migrates an old mid-edge save without snapping', async () => {
    const world = worldFixture(), catalog = productionFixture(), runtime = new GameRuntime(world, { catalog, now: () => testNow })
    runtime.advanceFrame(0)
    const command = runtime.dispatch({ type: 'move', target: { x: 9.25, y: 9.2 } })
    runtime.advanceFrame(50); await command
    runtime.advanceFrame(150)
    const saved = validateSave(JSON.parse(runtime.exportSave()), world, catalog)
    const restored = new GameRuntime(world, { catalog, saved, now: () => testNow + 100000 })
    expect(restored.getSceneSnapshot().position).toEqual(runtime.getSceneSnapshot().position)
    expect(restored.getSceneSnapshot().route).toEqual(runtime.getSceneSnapshot().route)
    restored.advanceFrame(0)
    for (let time = 50; time <= 1500; time += 50) restored.advanceFrame(time)
    expect(restored.getSceneSnapshot().position).toEqual({ x: 9.25, y: 9.2 })
    const legacy = envelopeFixture()
    legacy.data.progress = .4; legacy.data.route = [{ x: 8, y: 9 }, { x: 9, y: 9 }]; legacy.data.destination = { x: 9, y: 9 }
    const migrated = new GameRuntime(world, { catalog, saved: validateSave(legacy, world, catalog), now: () => testNow })
    expect(migrated.getSceneSnapshot().position).toEqual({ x: 7.4, y: 9 })
    expect(validateSave(JSON.parse(migrated.exportSave()), world, catalog).data.motion?.position).toEqual({ x: 7.4, y: 9 })
    const corrupt = structuredClone(saved); corrupt.data.motion!.position = { x: 3, y: 3 }
    expect(() => validateSave(corrupt, world, catalog)).toThrow('连续移动位置')
  })

  it('replans if a previously clear segment becomes blocked before the next simulation step', async () => {
    const source = config(), runtime = new GameRuntime(parseWorld(source)), world = runtime.world
    let blocked = false
    const step = world.canStep.bind(world)
    world.canStep = (a, b) => !(blocked && a.y === 2 && b.y === 2 && Math.min(a.x, b.x) === 3 && Math.max(a.x, b.x) === 4) && step(a, b)
    runtime.advanceFrame(0)
    const command = runtime.dispatch({ type: 'move', target: { x: 6, y: 2 } })
    runtime.advanceFrame(50); await command
    blocked = true
    let last = runtime.getSceneSnapshot().position
    for (let time = 100; time <= 5000; time += 50) {
      runtime.advanceFrame(time)
      const point = runtime.getSceneSnapshot().position
      expect(canWalkLine(world, last, point)).toBe(true); last = point
    }
    expect(last).toEqual({ x: 6, y: 2 })
  })
})
