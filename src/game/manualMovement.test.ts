import { describe, expect, it } from 'vitest'
import { GameRuntime, type GameCommand } from './GameRuntime'
import { constructionNavigation } from './construction'
import { canWalkLine, manualMovePath, pointDistance, walkPath } from './smoothNavigation'
import { actorPosition } from './survival'
import { parseWorld, type Cell, type WorldConfig } from './world'
import { validateSave } from './saveData'
import { dataFixture, envelopeFixture, productionFixture, testNow, worldFixture } from './testFixtures'

function worldConfig(patches: WorldConfig['chunks'][number]['patches'] = []): { -readonly [K in keyof WorldConfig]: WorldConfig[K] } {
  return { version: 1, dayDurationSeconds: 600, initialHour: 12, spawn: { x: 7, y: 9 },
    chunks: [{ id: 'camp', name: 'camp', x: 0, y: 0, unlocked: true, patches },
      { id: 'locked', name: 'locked', x: 1, y: 0, unlocked: false, patches: [] }], objects: [], blockedEdges: [] }
}
function checkedPath(world: ReturnType<typeof parseWorld>, from: Cell, target: Cell) {
  const result = manualMovePath(world, from, target, 512)!
  expect(result).toBeTruthy()
  let point = from
  for (const next of result.path) { expect(canWalkLine(world, point, next)).toBe(true); point = next }
  expect(walkPath(from, result.path, 1000).position).toEqual(result.destination)
  expect(canWalkLine(world, result.destination, result.destination)).toBe(true)
  return result
}
describe('manual movement towards unreachable clicks', () => {
  it('stops safely at water, rock, locked land and the outside edge', () => {
    const config = worldConfig([{ x: 10, y: 5, width: 2, height: 7, terrain: 'water' }])
    config.objects = [{ id: 'rock', kind: 'boulder', x: 6, y: 9 }]
    const world = parseWorld(config), start = config.spawn
    const water = checkedPath(world, start, { x: 10.15, y: 9 })
    expect(water.destination).toEqual({ x: 9.349, y: 9 })
    expect(checkedPath(world, start, { x: 6, y: 9 }).destination).toEqual({ x: 6.651, y: 9 })
    expect(checkedPath(world, start, { x: 21, y: 9 }).destination).toEqual({ x: 15.349, y: 9 })
    expect(checkedPath(world, start, { x: -100, y: 9 }).destination).toEqual({ x: -.349, y: 9 })
  })
  it('finds a reachable shore instead of picking a closer but disconnected cell', () => {
    const config = worldConfig([{ x: 10, y: 0, width: 1, height: 16, terrain: 'water' }])
    const world = parseWorld(config), result = checkedPath(world, config.spawn, { x: 13.2, y: 7.1 })
    expect(result.destination).toEqual({ x: 9.349, y: 7.1 })
  })
  it('retains exact reachable clicks, but approaches an enclosed wall without crossing it', () => {
    const config = worldConfig(), goal = { x: 5, y: 5 }
    config.blockedEdges = [[4, 5], [6, 5], [5, 4], [5, 6]].map(([x, y]) => ({ from: goal, to: { x, y } }))
    const world = parseWorld(config)
    expect(checkedPath(world, config.spawn, { x: 9.23, y: 8.14 }).destination).toEqual({ x: 9.23, y: 8.14 })
    const nearWall = checkedPath(world, config.spawn, goal)
    expect(pointDistance(nearWall.destination, goal)).toBeCloseTo(.651)
    expect(canWalkLine(world, nearWall.destination, goal)).toBe(false)
  })
  it('does not oscillate or walk backward when already at the nearest edge', () => {
    const world = parseWorld(worldConfig()), from = { x: 15.349, y: 6.2 }, target = { x: 19, y: 6.2 }
    expect(checkedPath(world, from, target)).toEqual({ destination: from, path: [] })
    expect(manualMovePath(world, from, { x: NaN, y: 0 }, 512)).toBeNull()
  })
  it('replaces a mid-walk target, saves only a valid stopping point and resumes safely after reload', async () => {
    const world = worldFixture(), catalog = productionFixture()
    const runtime = new GameRuntime(world, { catalog, now: () => testNow }); let frame = 0; runtime.advanceFrame(0)
    const send = async (command: GameCommand) => { const promise = runtime.dispatch(command); runtime.advanceFrame(frame += 50); return promise }
    await send({ type: 'move', target: { x: 9, y: 9 } })
    expect(await send({ type: 'move', target: { x: 3, y: 3 } })).toMatchObject({ accepted: true })
    const save = validateSave(JSON.parse(runtime.exportSave()), world, catalog)
    expect(world.isWalkable({ x: Math.round(save.data.destination!.x), y: Math.round(save.data.destination!.y) }, true)).toBe(true)
    expect(save.data.destination).toEqual({ x: 3, y: 3 })
    const playerGrid = constructionNavigation(world, save.data.construction, 'player')
    const loaded = new GameRuntime(world, { catalog, saved: save, now: () => testNow }); loaded.advanceFrame(0)
    let from = loaded.getSceneSnapshot().position
    for (let time = 50; time <= 10000; time += 50) {
      loaded.advanceFrame(time); const point = loaded.getSceneSnapshot().position
      expect(canWalkLine(playerGrid, from, point)).toBe(true); from = point
    }
    expect(from).toEqual(save.data.destination)
    expect(loaded.getUiSnapshot().activity).toBe('idle')
    validateSave(JSON.parse(loaded.exportSave()), world, catalog)
  })
  it('applies the same reachable stopping point to manually controlled companions', async () => {
    const world = worldFixture(), catalog = productionFixture(), data = dataFixture()
    data.survival.companion.status = 'active'; data.survival.companion.cell = { x: 7, y: 9 }; data.survival.companion.guard = { x: 7, y: 9 }
    const runtime = new GameRuntime(world, { catalog, saved: envelopeFixture(data), now: () => testNow }); runtime.advanceFrame(0)
    const promise = runtime.dispatch({ type: 'companion-move', target: { x: 20, y: 8 } }); runtime.advanceFrame(50)
    expect(await promise).toMatchObject({ accepted: true })
    const goal = runtime.getSceneSnapshot().survival.companion.guard
    expect(goal).toEqual(manualMovePath(world, data.survival.companion.cell, { x: 20, y: 8 }, 768)!.destination)
    for (let time = 100; time <= 10000; time += 50) runtime.advanceFrame(time)
    expect(actorPosition(runtime.getSceneSnapshot().survival.companion)).toEqual(goal)
    expect(runtime.getSceneSnapshot().position).toEqual(data.cell)
    validateSave(JSON.parse(runtime.exportSave()), world, catalog)
  })
})
