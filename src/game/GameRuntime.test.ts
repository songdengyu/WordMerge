import { describe, expect, it } from 'vitest'
import { GameRuntime } from './GameRuntime'
import { PathSearch } from './navigation'
import { parseWorld, type WorldConfig } from './world'

const config = (): WorldConfig => ({
  version: 1, dayDurationSeconds: 1200, initialHour: 6, spawn: { x: 1, y: 1 },
  chunks: [{ id: 'camp', name: 'Camp', x: 0, y: 0, unlocked: true, patches: [] },
    { id: 'locked', name: 'Locked', x: 1, y: 0, unlocked: false, patches: [] }],
  objects: [], blockedEdges: [],
})
const clock = (runtime: GameRuntime) => {
  let now = 0
  return (ms: number) => {
    runtime.advanceFrame(now)
    for (let elapsed = 0; elapsed < ms; elapsed += 50) { now += 50; runtime.advanceFrame(now) }
  }
}

describe('world catalog validation', () => {
  it('rejects duplicate chunks and an obstructed spawn with field-specific errors', () => {
    const original = config()
    expect(() => parseWorld({ ...original, chunks: [original.chunks[0], original.chunks[0]] })).toThrow('chunks[1].id')
    expect(() => parseWorld({ ...original, objects: [{ id: 'tree', kind: 'tree', x: 1, y: 1 }] })).toThrow('出生点')
  })
  it('rejects out-of-chunk terrain and invalid edge endpoints', () => {
    expect(() => parseWorld({ ...config(), chunks: [{ ...config().chunks[0],
      patches: [{ x: 15, y: 0, width: 2, height: 1, terrain: 'water' }] }] })).toThrow('超出区域边界')
    expect(() => parseWorld({ ...config(), blockedEdges: [{ from: { x: 0, y: 0 }, to: { x: 1, y: 1 } }] })).toThrow('相邻格')
  })
  it('does not walk outside loaded, unlocked integer cells', () => {
    const world = parseWorld(config())
    for (const cell of [{ x: -1, y: 0 }, { x: 16, y: 0 }, { x: 1.5, y: 1 }, { x: NaN, y: 1 }]) {
      expect(world.isWalkable(cell)).toBe(false)
    }
  })
  it('indexes negative-coordinate chunks correctly', () => {
    const world = parseWorld({ ...config(), chunks: [...config().chunks,
      { id: 'north', name: 'North', x: 0, y: -1, unlocked: true, patches: [] }] })
    expect(world.chunkAt({ x: 1, y: -1 })?.id).toBe('north')
    expect(world.isWalkable({ x: 1, y: -16 })).toBe(true)
    expect(world.isWalkable({ x: 1, y: -17 })).toBe(false)
  })
})

describe('budgeted four-direction navigation', () => {
  it('routes around water without diagonal shortcuts; exhausted work budget stays pending', () => {
    const world = parseWorld({ ...config(), chunks: [{ ...config().chunks[0],
      patches: [{ x: 2, y: 0, width: 1, height: 3, terrain: 'water' }] }] })
    const search = new PathSearch(world, { x: 1, y: 1 }, { x: 3, y: 1 })
    expect(search.advance(1).status).toBe('pending')
    const result = search.advance(256)
    expect(result.status).toBe('found')
    if (result.status !== 'found') throw new Error('Expected a route')
    expect(result.path).toHaveLength(6)
    let from = { x: 1, y: 1 }
    for (const cell of result.path) { expect(world.canStep(from, cell)).toBe(true); from = cell }
    expect(from).toEqual({ x: 3, y: 1 })
  })
  it('respects blocked edges in both directions', () => {
    const world = parseWorld({ ...config(), blockedEdges: [{ from: { x: 1, y: 1 }, to: { x: 2, y: 1 } }] })
    expect(world.canStep({ x: 1, y: 1 }, { x: 2, y: 1 })).toBe(false)
    expect(world.canStep({ x: 2, y: 1 }, { x: 1, y: 1 })).toBe(false)
    const result = new PathSearch(world, { x: 1, y: 1 }, { x: 2, y: 1 }).advance(256)
    expect(result.status === 'found' && result.path.length).toBe(3)
  })
  it('only reports unreachable after exhausting the connected area', () => {
    const goal = { x: 4, y: 4 }
    const world = parseWorld({ ...config(), blockedEdges: [
      { from: goal, to: { x: 3, y: 4 } }, { from: goal, to: { x: 5, y: 4 } },
      { from: goal, to: { x: 4, y: 3 } }, { from: goal, to: { x: 4, y: 5 } },
    ] })
    const search = new PathSearch(world, config().spawn, goal)
    expect(search.advance(2).status).toBe('pending')
    expect(search.advance(1024).status).toBe('unreachable')
  })
})

describe('independent runtime', () => {
  it('uses a 20-minute game day and keeps stable UI snapshots between publications', () => {
    const runtime = new GameRuntime(parseWorld(config()))
    const snapshot = runtime.getUiSnapshot()
    expect(runtime.getUiSnapshot()).toBe(snapshot)
    runtime.advanceFrame(0); runtime.advanceFrame(49)
    expect(runtime.getUiSnapshot()).toBe(snapshot)
    const pump = clock(runtime)
    pump(10_000)
    expect(runtime.getUiSnapshot()).toMatchObject({ day: 1, hour: 6, minute: 12 })
  })
  it('does not stack simulations when a consumer subscribes twice', () => {
    const runtime = new GameRuntime(parseWorld(config()))
    const unsubscribe = runtime.subscribeUi(() => {})
    const second = runtime.subscribeUi(() => {})
    clock(runtime)(1000)
    expect(runtime.getSceneSnapshot().elapsedSeconds).toBeCloseTo(1)
    unsubscribe(); second()
  })
  it('freezes movement and time for all active pause reasons, discards offline catch-up', async () => {
    const runtime = new GameRuntime(parseWorld(config()))
    const pump = clock(runtime)
    const result = runtime.dispatch({ type: 'move', target: { x: 10, y: 1 } })
    pump(100)
    expect(await result).toEqual({ accepted: true })
    runtime.setPauseReason('background', true)
    const before = runtime.getSceneSnapshot()
    runtime.setPauseReason('story', true)
    pump(60_000)
    runtime.setPauseReason('background', false)
    pump(1000)
    expect(runtime.getSceneSnapshot().position).toEqual(before.position)
    expect(runtime.getSceneSnapshot().elapsedSeconds).toBe(before.elapsedSeconds)
    runtime.setPauseReason('story', false)
    pump(100)
    expect(runtime.getSceneSnapshot().elapsedSeconds).toBeCloseTo(before.elapsedSeconds + 0.1)
  })
  it('drops long stalls and caps short catch-up at 250 ms', () => {
    const runtime = new GameRuntime(parseWorld(config()))
    runtime.advanceFrame(0); runtime.advanceFrame(10_000)
    expect(runtime.getSceneSnapshot().elapsedSeconds).toBe(0)
    runtime.advanceFrame(10_800)
    expect(runtime.getSceneSnapshot().elapsedSeconds).toBeCloseTo(0.25)
  })
  it('copies commands, rejects blocked targets and leaves an accepted route intact', async () => {
    const runtime = new GameRuntime(parseWorld(config()))
    const pump = clock(runtime)
    const target = { x: 4, y: 1 }
    const command = runtime.dispatch({ type: 'move', target })
    target.x = 15
    pump(100)
    expect(await command).toEqual({ accepted: true })
    const invalid = runtime.dispatch({ type: 'move', target: { x: 16, y: 0 } })
    pump(100)
    expect(await invalid).toMatchObject({ accepted: false })
    pump(2000)
    expect(runtime.getUiSnapshot().player).toEqual({ x: 4, y: 1 })
  })
  it('turns from its exact position immediately when a move is replaced mid-step', async () => {
    const runtime = new GameRuntime(parseWorld(config()))
    const pump = clock(runtime)
    const first = runtime.dispatch({ type: 'move', target: { x: 5, y: 1 } })
    pump(100); await first
    const before = runtime.getSceneSnapshot().position
    const next = runtime.dispatch({ type: 'move', target: { x: 1, y: 3 } })
    pump(100); await next
    const after = runtime.getSceneSnapshot().position
    expect(after.x).toBeLessThan(before.x)
    expect(after.y).toBeGreaterThan(before.y)
    expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeCloseTo(.25)
    pump(2000)
    expect(runtime.getUiSnapshot().player).toEqual({ x: 1, y: 3 })
    expect(runtime.getUiSnapshot().activity).toBe('idle')
  })
  it('settles pending promises when pausing and rejects commands while paused', async () => {
    const runtime = new GameRuntime(parseWorld(config()))
    const pending = runtime.dispatch({ type: 'move', target: { x: 2, y: 1 } })
    runtime.setPauseReason('renderer-lost', true)
    expect(await pending).toMatchObject({ accepted: false })
    expect(await runtime.dispatch({ type: 'move', target: { x: 3, y: 1 } })).toMatchObject({ accepted: false })
  })
  it('changes day/night exactly at configured calendar boundaries', () => {
    const runtime = new GameRuntime(parseWorld({ ...config(), initialHour: 18.99, dayDurationSeconds: 60 }))
    const pump = clock(runtime)
    expect(runtime.getUiSnapshot().isDay).toBe(true)
    pump(100)
    expect(runtime.getUiSnapshot().isDay).toBe(false)
    pump(12_500)
    expect(runtime.getUiSnapshot()).toMatchObject({ day: 2, hour: 0, isDay: false })
  })
})
