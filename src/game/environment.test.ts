import { describe, expect, it } from 'vitest'
import { dayCycle, environmentLight, testEnvironment } from './environment'
import { GameRuntime, type GameCommand } from './GameRuntime'
import { validateSave } from './saveData'
import { dataFixture, envelopeFixture, productionFixture, testNow, worldFixture } from './testFixtures'

const world = worldFixture(), catalog = productionFixture()
function harness() {
  const runtime = new GameRuntime(world, { catalog, now: () => testNow })
  let frame = 0; runtime.advanceFrame(frame)
  const pump = (seconds: number) => { for (let i = 0; i < Math.round(seconds * 20); i++) { frame += 50; runtime.advanceFrame(frame) } }
  const send = async (command: GameCommand) => { const result = runtime.dispatch(command); pump(.05); return result }
  return { runtime, pump, send }
}
describe('day cycle and environment testing', () => {
  it('matches gameplay day/night boundaries and wraps the night arc over midnight', () => {
    expect(dayCycle(359).isDay).toBe(false)
    expect(dayCycle(360)).toMatchObject({ phase: 'dawn', isDay: true, progress: 0 })
    expect(dayCycle(1139).isDay).toBe(true)
    expect(dayCycle(1140)).toMatchObject({ isDay: false, progress: 0 })
    expect(dayCycle(1440).progress).toBeGreaterThan(dayCycle(1439).progress)
    expect(environmentLight(0, 'sunny')).toEqual(environmentLight(1440, 'sunny'))
  })
  it('keeps natural lighting continuous and distinguishes warm twilight, clear noon and overcast weather', () => {
    for (const minute of [300, 360, 450, 720, 960, 1080, 1140, 1230, 1440]) {
      const a = environmentLight(minute - .001, 'sunny'), b = environmentLight(minute + .001, 'sunny')
      expect(Math.abs(a.darkness - b.darkness)).toBeLessThan(.001)
      expect(Math.abs(a.warmth - b.warmth)).toBeLessThan(.001)
    }
    expect(environmentLight(720, 'sunny').darkness).toBe(0)
    expect(environmentLight(0, 'sunny').darkness).toBeGreaterThan(.5)
    expect(environmentLight(360, 'sunny').warmth).toBeGreaterThan(.2)
    expect(environmentLight(1080, 'sunny').warmth).toBeGreaterThan(.3)
    expect(environmentLight(720, 'rain').overcast).toBeGreaterThan(environmentLight(720, 'cloudy').overcast)
  })
  it('jumps into a real night raid, then retreats at a test dawn without loss, loot or a story dawn award', async () => {
    const { runtime, pump, send } = harness(), before = runtime.getSaveData()
    expect(await send({ type: 'test-time', preset: 'night' })).toMatchObject({ accepted: true })
    expect(runtime.getUiSnapshot()).toMatchObject({ hour: 21, isDay: false })
    expect(runtime.getSaveData().production.vitals.hunger).toBeCloseTo(before.production.vitals.hunger, 2)
    expect(runtime.getSaveData().production.stamina).toEqual(before.production.stamina)
    expect(runtime.getSaveData().survival.enemies).toHaveLength(0)
    pump(15.1)
    expect(runtime.getSaveData().survival.enemies).toHaveLength(1)
    const gold = runtime.getSaveData().production.inventory.gold
    expect(await send({ type: 'test-time', preset: 'dawn' })).toMatchObject({ accepted: true })
    const saved = runtime.getSaveData()
    expect(runtime.getUiSnapshot()).toMatchObject({ day: 2, hour: 6, isDay: true })
    expect(saved.survival.enemies).toHaveLength(0)
    expect(saved.production.inventory.gold).toBe(gold)
    expect(saved.progression.witnessedDawn).toBe(false)
    const restored = validateSave(JSON.parse(runtime.exportSave()), world, catalog)
    expect(new GameRuntime(world, { catalog, saved: restored, now: () => testNow }).getUiSnapshot().hour).toBe(6)
    runtime.setPauseReason('story', true)
    expect(await runtime.dispatch({ type: 'test-weather', weather: 'rain' })).toMatchObject({ accepted: false })
  })
  it('preserves current weather on time jumps, restores it from saves and resumes natural dawn forecast changes', async () => {
    const { runtime, send, pump } = harness()
    await send({ type: 'test-weather', weather: 'rain' })
    expect(runtime.getSaveData().production.vitals.temperature).toBeCloseTo(50, 1)
    await send({ type: 'test-time', preset: 'midnight' })
    expect(runtime.getUiSnapshot().survival.weather).toBe('rain')
    expect(runtime.getUiSnapshot().day).toBe(2)
    const saved = validateSave(JSON.parse(runtime.exportSave()), world, catalog)
    expect(new GameRuntime(world, { catalog, saved, now: () => testNow }).getUiSnapshot().survival.weather).toBe('rain')
    // Start just before dawn with no danger, and let the real simulation cross the boundary.
    const data = runtime.getSaveData(); data.elapsedSeconds = 1199.9
    const natural = new GameRuntime(world, { catalog, saved: envelopeFixture(data), now: () => testNow })
    natural.advanceFrame(0); natural.advanceFrame(200)
    expect(natural.getUiSnapshot().survival.weather).toBe('cloudy')
    expect(natural.getSaveData().progression.witnessedDawn).toBe(true)
    pump(.05)
  })
  it('does not complete active construction when the calendar jumps or accept unknown presets', async () => {
    const { runtime, send, pump } = harness()
    const before = runtime.getSaveData(), id = `i${before.production.inventory.nextId++}`
    before.production.inventory.board[6].instanceId = id
    before.production.inventory.items[id] = { id, itemId: 202, reservedBy: null, location: { kind: 'board', index: 6 } }
    const building = new GameRuntime(world, { catalog, saved: envelopeFixture(before), now: () => testNow })
    let frame = 0; building.advanceFrame(frame)
    const command = async (cmd: GameCommand) => { const pending = building.dispatch(cmd); building.advanceFrame(frame += 50); return pending }
    await command({ type: 'building-place', blueprintId: 'cabin', origin: { x: 7, y: 10 }, rotation: 0 })
    await command({ type: 'building-interact', buildingId: 'b1', partId: 'foundation' })
    for (let i = 0; i < 200 && building.getUiSnapshot().activity !== 'building'; i++) building.advanceFrame(frame += 50)
    const remaining = building.getSaveData().construction.jobs[0].remaining
    await command({ type: 'test-time', preset: 'midnight' })
    expect(building.getSaveData().construction.jobs[0].remaining).toBeCloseTo(remaining - .05)
    expect(building.getUiSnapshot().protected).toBe(true)
    validateSave(JSON.parse(building.exportSave()), world, catalog)
    expect(testEnvironment(dataFixture().survival, world, 360, { type: 'test-time', preset: 'invalid' as never }).accepted).toBe(false)
    expect(await send({ type: 'test-weather', weather: 'invalid' as never })).toMatchObject({ accepted: false })
    pump(.05)
  })
})
