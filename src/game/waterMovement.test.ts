import { describe, expect, it } from 'vitest'
import { GameRuntime, type GameCommand } from './GameRuntime'
import { constructionNavigation, createConstruction, placementError } from './construction'
import { exchangeItems } from './inventory'
import { validateSave } from './saveData'
import { canWalkLine, pointCell, pointDistance, PLAYER_SPEED } from './smoothNavigation'
import { isInWater, WATER_MOVEMENT, walkPlayerPath } from './waterMovement'
import { dataFixture, envelopeFixture, productionFixture, testNow, worldFixture } from './testFixtures'

const world = worldFixture(), catalog = productionFixture()
function harness(data = dataFixture()) {
  const runtime = new GameRuntime(world, { catalog, saved: envelopeFixture(data), now: () => testNow })
  let frame = 0; runtime.advanceFrame(frame)
  const pump = (seconds: number) => { for (let i = 0; i < Math.round(seconds * 20); i++) runtime.advanceFrame(frame += 50) }
  const send = (command: GameCommand) => { const pending = runtime.dispatch(command); pump(.05); return pending }
  const saved = () => validateSave(JSON.parse(runtime.exportSave()), world, catalog)
  return { runtime, pump, send, saved }
}

describe('player water movement', () => {
  it('opens water only for player navigation and keeps buildings, obstacles and locked regions restricted', () => {
    const state = createConstruction(), player = constructionNavigation(world, state, 'player')
    const friendly = constructionNavigation(world, state), enemy = constructionNavigation(world, state, 'enemy')
    expect(player).not.toBe(friendly)
    expect(player.isWalkable({ x: 3, y: 3 })).toBe(true)
    expect(friendly.isWalkable({ x: 3, y: 3 })).toBe(false)
    expect(enemy.isWalkable({ x: 3, y: 3 })).toBe(false)
    expect(canWalkLine(player, { x: 5, y: 3 }, { x: 3, y: 3 })).toBe(true)
    for (const cell of [{ x: 11, y: 11 }, { x: 6, y: 5 }, { x: -1, y: 2 }]) expect(player.isWalkable(cell)).toBe(false)
    expect(placementError(world, state, 'cabin', { x: 1, y: 2 }, 0, { x: 3, y: 3 })).toContain('水面')
    expect(placementError(world, state, 'cabin', { x: 7, y: 10 }, 0, { x: 3, y: 3 })).toBeNull()
  })

  it('spends time at each shore boundary, and restores land speed immediately after exiting', () => {
    const entering = walkPlayerPath(world, { x: 4.8, y: 3 }, [{ x: 3, y: 3 }], .4)
    expect(entering.position.x).toBeCloseTo(4.15)
    expect(entering.throughWater).toBe(true)
    const leaving = walkPlayerPath(world, { x: 4.2, y: 3 }, [{ x: 5.5, y: 3 }], .4)
    expect(leaving.position.x).toBeCloseTo(4.9)
    expect(leaving.distance).toBeCloseTo(.7)
    const water = walkPlayerPath(world, { x: 3, y: 3 }, [{ x: 4, y: 3 }], .2)
    expect(water.distance).toBeCloseTo(PLAYER_SPEED * WATER_MOVEMENT.speedMultiplier * .2)
    const land = walkPlayerPath(world, { x: 5, y: 3 }, [{ x: 6, y: 3 }], .2)
    expect(land.distance).toBeCloseTo(PLAYER_SPEED * .2)
  })

  it('gives the same distance across waypoints and grid corners with large or small time steps', () => {
    const start = { x: 5.2, y: 3.2 }, route = [{ x: 4.5, y: 2.5 }, { x: 3, y: 3 }, { x: .2, y: 3 }]
    const single = walkPlayerPath(world, start, route, 2)
    let position = start, path = route, distance = 0, wet = false
    for (let i = 0; i < 40; i++) {
      const result = walkPlayerPath(world, position, path, .05)
      position = result.position; path = result.route; distance += result.distance; wet ||= result.throughWater
    }
    expect(pointDistance(single.position, position)).toBeLessThan(1e-7)
    expect(single.distance).toBeCloseTo(distance)
    expect(single.throughWater).toBe(wet)
  })

  it('extinguishes on entry, refuses underwater ignition without charging fuel, persists and allows relighting on shore', async () => {
    const data = dataFixture(); data.cell = { x: 5, y: 3 }; data.motion = { version: 1, position: { x: 4.8, y: 3 } }
    data.survival.torchRemaining = 30
    exchangeItems(data.production.inventory, catalog, [], [201, 201])
    const h = harness(data)
    expect(await h.send({ type: 'move', target: { x: 3, y: 3 } })).toMatchObject({ accepted: true })
    h.pump(.25)
    const entered = h.saved()
    expect(isInWater(world, entered.data.motion!.position)).toBe(true)
    expect(entered.data.survival.torchRemaining).toBe(0)
    expect(entered.data.production.inventory).toEqual(data.production.inventory)
    expect(await h.send({ type: 'torch-light' })).toMatchObject({ accepted: false, reason: expect.stringContaining('水中') })
    expect(h.saved().data.production.inventory).toEqual(data.production.inventory)
    const loaded = harness(entered.data)
    loaded.runtime.setPauseReason('background', true); loaded.pump(2)
    expect(loaded.saved().data.motion).toEqual(entered.data.motion)
    loaded.runtime.setPauseReason('background', false); loaded.pump(3)
    expect(loaded.saved().data.motion!.position).toEqual({ x: 3, y: 3 })
    expect(await loaded.send({ type: 'move', target: { x: 5.2, y: 3 } })).toMatchObject({ accepted: true })
    loaded.pump(3)
    expect(isInWater(world, loaded.saved().data.motion!.position)).toBe(false)
    expect(loaded.saved().data.survival.torchRemaining).toBe(0)
    expect(await loaded.send({ type: 'torch-light' })).toMatchObject({ accepted: true })
    expect(loaded.saved().data.survival.torchRemaining).toBeGreaterThan(59)
  })

  it('keeps water saves valid without admitting rock positions, locked regions or water buildings', () => {
    const data = dataFixture(); data.cell = { x: 3, y: 3 }; data.motion = { version: 1, position: data.cell }
    data.survival.torchRemaining = 10
    const saved = validateSave(envelopeFixture(data), world, catalog)
    expect(saved.data.survival.torchRemaining).toBe(0)
    expect(saved.data.production).toEqual(data.production)
    for (const position of [{ x: 11, y: 11 }, { x: -1, y: 0 }]) {
      const forged = structuredClone(saved); forged.data.cell = pointCell(position); forged.data.motion!.position = position
      expect(() => validateSave(forged, world, catalog)).toThrow('世界时间或角色位置')
    }
  })
})
