import { describe, expect, it } from 'vitest'
import { BLUEPRINTS } from './buildingConfig'
import { GameRuntime, type GameCommand } from './GameRuntime'
import { advanceSurvival, createSurvival, type Enemy } from './survival'
import { m3ConfigVersion, validateSave, type RuntimeData } from './saveData'
import { dataFixture, tamingDataFixture, envelopeFixture, productionFixture, testNow, worldFixture } from './testFixtures'

const world = worldFixture(), catalog = productionFixture()
function harness(data = dataFixture()) {
  const runtime = new GameRuntime(world, { catalog, saved: envelopeFixture(data), now: () => testNow })
  let frame = 0; runtime.advanceFrame(frame)
  const pump = (seconds: number) => { for (let i = 0; i < Math.round(seconds * 20); i++) { frame += 50; runtime.advanceFrame(frame) } }
  const send = async (command: GameCommand) => { const pending = runtime.dispatch(command); pump(.05); return pending }
  return { runtime, pump, send }
}
function supply(data: RuntimeData, itemId: number) {
  const inventory = data.production.inventory, index = inventory.board.findIndex(slot => !slot.instanceId && slot.lock === 0), id = `i${inventory.nextId++}`
  inventory.board[index].instanceId = id; inventory.items[id] = { id, itemId, reservedBy: null, location: { kind: 'board', index } }
  return id
}
function cabin(data: RuntimeData) {
  const blueprint = BLUEPRINTS[0]
  data.construction.buildings.push({ id: 'b1', blueprintId: 'cabin', origin: { x: 7, y: 10 }, rotation: 0,
    parts: Object.fromEntries(blueprint.parts.map(config => [config.id, { hp: config.hp, built: true, xpGranted: true }])) })
  data.construction.nextId = 2; data.construction.xp = 70
  return data.construction.buildings[0]
}
function night(data = dataFixture()) {
  data.elapsedSeconds = 650; data.survival = createSurvival(world, data.elapsedSeconds)
  return data
}
function enemy(data: RuntimeData, cell = data.cell, hp = 32): Enemy {
  const result: Enemy = { id: `e${data.survival.nextEnemyId++}`, kind: 'prowler', hp, cell: { ...cell }, route: [], progress: 0, target: null, cooldown: 0 }
  data.survival.enemies.push(result); return result
}

describe('M4 survival and shelter', () => {
  it('drains configured daily needs, pauses the whole world offline, and preserves temperature continuity', () => {
    const data = dataFixture(); data.survival.weather = 'rain'
    const { runtime, pump } = harness(data)
    pump(10)
    expect(runtime.getSaveData().production.vitals.hunger).toBeCloseTo(59.5)
    expect(runtime.getSaveData().production.vitals.water).toBeCloseTo(60 - 80 / 120)
    expect(runtime.getSaveData().production.vitals.temperature).toBeCloseTo(48.8)
    runtime.setPauseReason('background', true)
    const before = runtime.getSaveData(); pump(120)
    expect(runtime.getSaveData()).toEqual(before)
    validateSave(JSON.parse(runtime.exportSave()), world, catalog)
  })
  it('uses only one environmental damage tier when all three needs are dangerous', () => {
    const data = dataFixture(); data.production.vitals = { hp: 100, hunger: 0, water: 0, temperature: 0 }
    const { runtime, pump } = harness(data); pump(5.1)
    expect(runtime.getSaveData().production.vitals.hp).toBe(99)
  })
  it('an intact roof and enclosure stabilize a rainy night; broken walls expose the player gradually', () => {
    const data = night(); const building = cabin(data); data.cell = { x: 8, y: 11 }; data.survival.weather = 'rain'
    const sheltered = harness(data); sheltered.pump(10)
    expect(sheltered.runtime.getSaveData().production.vitals.temperature).toBe(50)
    building.parts.walls.hp = 0
    const exposed = harness(data); exposed.pump(10)
    expect(exposed.runtime.getSaveData().production.vitals.temperature).toBeCloseTo(48.8)
    expect(exposed.runtime.getUiSnapshot().survival.failure).toBeNull()
  })
  it('a real night attack hurts travel but not construction, and needs still drain under protection', async () => {
    const data = night(); supply(data, 202); enemy(data)
    const { runtime, send, pump } = harness(data)
    await send({ type: 'building-place', blueprintId: 'cabin', origin: { x: 7, y: 10 }, rotation: 0 })
    await send({ type: 'building-interact', buildingId: 'b1', partId: 'foundation' })
    for (let i = 0; i < 100 && runtime.getUiSnapshot().activity !== 'building'; i++) pump(.05)
    expect(runtime.getUiSnapshot().protected).toBe(true)
    const before = runtime.getSaveData().production.vitals
    expect(before.hp).toBeLessThan(100)
    pump(1.5)
    expect(runtime.getSaveData().production.vitals.hp).toBe(before.hp)
    expect(runtime.getSaveData().production.vitals.hunger).toBeLessThan(before.hunger)
    expect(runtime.getSaveData().survival.failure).toBeNull()
    validateSave(JSON.parse(runtime.exportSave()), world, catalog)
  })
})

describe('night pressure and companion commands', () => {
  it('plays a complete prepared day, sustains repeated raids and reaches dawn alive', () => {
    const data = dataFixture(); cabin(data); data.cell = { x: 8, y: 11 }
    data.production.vitals.hunger = 100; data.production.vitals.water = 100
    data.survival.companion.status = 'active'; data.survival.companion.guard = { x: 8, y: 11 }
    const { runtime, pump } = harness(data); pump(1200.05)
    const saved = runtime.getSaveData()
    expect(saved.survival.failure).toBeNull()
    expect(saved.production.vitals.hp).toBeGreaterThan(0)
    expect(saved.survival.nextEnemyId).toBeGreaterThan(4)
    expect(saved.survival.enemies).toHaveLength(0)
    expect(runtime.getUiSnapshot()).toMatchObject({ day: 2, hour: 6 })
    validateSave(JSON.parse(runtime.exportSave()), world, catalog)
  })
  it('rescues with an actual food instance once, follows, guards and treats injury with a timed recovery', async () => {
    const { runtime, send, pump } = harness(tamingDataFixture())
    expect(await send({ type: 'companion-rescue' })).toMatchObject({ accepted: true })
    expect(runtime.getSaveData().production.inventory.board[9].instanceId).toBeNull()
    pump(2)
    expect(await send({ type: 'companion-rescue' })).toMatchObject({ accepted: false })
    expect(await send({ type: 'companion-mode', mode: 'follow' })).toMatchObject({ accepted: true })
    expect(await send({ type: 'companion-mode', mode: 'guard', guard: { x: 8, y: 9 } })).toMatchObject({ accepted: true })
    const injured = runtime.getSaveData(); supply(injured, 232)
    injured.survival.companion.status = 'injured'; injured.survival.companion.hp = 0
    const recovery = harness(injured)
    expect(await recovery.send({ type: 'companion-treat' })).toMatchObject({ accepted: true })
    expect(await recovery.send({ type: 'companion-treat' })).toMatchObject({ accepted: false })
    expect(await recovery.send({ type: 'companion-mode', mode: 'guard' })).toMatchObject({ accepted: false })
    recovery.pump(60)
    expect(recovery.runtime.getUiSnapshot().survival.companion).toMatchObject({ status: 'active', mode: 'rest' })
    expect(recovery.runtime.getUiSnapshot().survival.companion.hp).toBeGreaterThanOrEqual(90)
    validateSave(JSON.parse(recovery.runtime.exportSave()), world, catalog)
  })
  it('applies same-beat damage together and grants defeat gold only once', () => {
    const data = night(); data.survival.companion.status = 'active'; data.survival.companion.hp = 2
    enemy(data, { x: 6, y: 8 }, 14)
    const { runtime, pump } = harness(data); pump(.05)
    expect(runtime.getSaveData().survival.companion.status).toBe('injured')
    expect(runtime.getSaveData().survival.enemies).toHaveLength(0)
    expect(runtime.getSaveData().production.inventory.gold).toBe(2)
    pump(1); expect(runtime.getSaveData().production.inventory.gold).toBe(2)
  })
  it('a door attacker engages an approaching defender instead of taking unanswered damage', () => {
    const data = night(); const building = cabin(data); data.cell = { x: 8, y: 11 }
    const opponent = enemy(data, { x: 8, y: 12 })
    opponent.target = { kind: 'part', buildingId: building.id, partId: 'door', stand: { x: 8, y: 12 } }
    data.survival.companion.status = 'active'; data.survival.companion.cell = { x: 8, y: 13 }
    data.survival.companion.guard = { x: 8, y: 13 }
    const { runtime, pump } = harness(data); pump(.05)
    const saved = runtime.getSaveData()
    expect(saved.survival.enemies[0].target).toEqual({ kind: 'companion' })
    expect(saved.survival.companion.hp).toBe(178)
    expect(saved.construction.buildings[0].parts.door.hp).toBe(100)
    expect(saved.survival.enemies[0].hp).toBe(18)
  })
  it('daybreak removes attackers before an otherwise lethal strike and awards no retreat loot', () => {
    const data = night(); data.production.vitals.hp = 1; enemy(data)
    const result = advanceSurvival(data.survival, data.production, data.construction, world, data.cell, 1800, .05)
    expect(result.state.enemies).toHaveLength(0)
    expect(result.production.vitals.hp).toBe(1)
    expect(result.production.inventory.gold).toBe(0)
    expect(result.state.weather).toBe('cloudy')
  })
  it('caps nightly population and discards missed spawns instead of building a backlog', () => {
    const data = night(); enemy(data); enemy(data); enemy(data)
    data.survival.spawnRemaining = .01
    const capped = advanceSurvival(data.survival, data.production, data.construction, world, data.cell, 1150, .05)
    expect(capped.state.enemies).toHaveLength(3)
    expect(capped.state.spawnRemaining).toBe(80)
    capped.state.enemies = []
    const next = advanceSurvival(capped.state, capped.production, capped.construction, world, data.cell, 1151, .05)
    expect(next.state.enemies).toHaveLength(0)
    next.state.spawnRemaining = .01
    expect(advanceSurvival(next.state, next.production, next.construction, world, data.cell, 1152, .05).state.enemies).toHaveLength(1)
  })
  it('breaks a closed enclosure instead of attacking through it, and a breach alone is not failure', () => {
    const data = night(); const building = cabin(data); data.cell = { x: 8, y: 11 }
    for (const part of Object.values(building.parts)) part.hp = 1
    enemy(data, { x: 8, y: 12 })
    const { runtime, pump } = harness(data); pump(.05)
    expect(runtime.getSaveData().production.vitals.hp).toBe(100)
    expect(Object.values(runtime.getSaveData().construction.buildings[0].parts).some(part => part.hp === 0)).toBe(true)
    expect(runtime.getSaveData().survival.failure).toBeNull()
    pump(3)
    expect(runtime.getSaveData().production.vitals.hp).toBeLessThan(100)
    validateSave(JSON.parse(runtime.exportSave()), world, catalog)
  })
  it('never attacks through a closed wall during a manual companion engagement', async () => {
    const data = night(); cabin(data)
    data.survival.companion.status = 'active'; data.survival.companion.cell = { x: 7, y: 10 }
    const opponent = enemy(data, { x: 6, y: 10 })
    const { runtime, send } = harness(data)
    expect(await send({ type: 'companion-attack', enemyId: opponent.id })).toMatchObject({ accepted: true })
    expect(runtime.getSaveData().survival.enemies[0].hp).toBe(32)
  })
})

describe('failure recovery and compatible migration', () => {
  it('freezes only on player defeat, releases unstarted reservations, and settles losses just once', async () => {
    const data = night(); const plank = supply(data, 202)
    const { runtime, pump, send } = harness(data)
    await send({ type: 'building-place', blueprintId: 'cabin', origin: { x: 7, y: 10 }, rotation: 0 })
    await send({ type: 'building-interact', buildingId: 'b1', partId: 'foundation' })
    runtime.applyDamage('player', 100)
    const failure = runtime.getSaveData()
    expect(failure.survival.failure?.losses).toHaveLength(2)
    expect(failure.production.inventory.items[plank].reservedBy).toBeNull()
    expect(failure.construction.jobs).toHaveLength(0)
    pump(10); expect(runtime.getSaveData()).toEqual(failure)
    const restored = harness(validateSave(JSON.parse(runtime.exportSave()), world, catalog).data)
    const rescue = await restored.runtime.dispatch({ type: 'rescue' })
    expect(rescue.accepted).toBe(true)
    expect(await restored.runtime.dispatch({ type: 'rescue' })).toMatchObject({ accepted: false })
    const saved = restored.runtime.getSaveData()
    expect(saved.survival.rescuedCount).toBe(1)
    expect(saved.elapsedSeconds).toBe(1200)
    expect(saved.production.inventory.items[plank]).toBeTruthy()
    expect(saved.production.vitals).toEqual({ hp: 70, hunger: 60, water: 60, temperature: 50 })
    expect(Object.keys(saved.production.inventory.items)).toHaveLength(Object.keys(failure.production.inventory.items).length - 2)
    validateSave(JSON.parse(restored.runtime.exportSave()), world, catalog)
  })
  it('migrates M3 without charging offline needs or resetting inventory, buildings, stamina or world time', () => {
    const old = envelopeFixture(); cabin(old.data); old.data.elapsedSeconds = 300; old.data.production.stamina.value = 140
    const legacy = { ...old, schemaVersion: 2, configVersion: m3ConfigVersion(world, catalog), data: { ...old.data } as Partial<RuntimeData> }
    delete legacy.data.survival
    const migrated = validateSave(legacy, world, catalog)
    expect(migrated.schemaVersion).toBe(4)
    expect(migrated.data.production).toEqual(old.data.production)
    expect(migrated.data.construction).toEqual(old.data.construction)
    expect(migrated.data.elapsedSeconds).toBe(300)
    expect(migrated.data.survival.companion.status).toBe('wild')
    expect(validateSave(migrated, world, catalog)).toEqual(migrated)
  })
  it('rejects invalid actors, weather and forged failure loss records', () => {
    const save = envelopeFixture()
    expect(() => validateSave({ ...save, data: { ...save.data, survival: undefined } }, world, catalog)).toThrow('生存')
    const wrongWeather = structuredClone(save) as any; wrongWeather.data.survival.weather = 'blizzard'
    expect(() => validateSave(wrongWeather, world, catalog)).toThrow('天气')
    const wrongEnemy = structuredClone(save); enemy(wrongEnemy.data, { x: -1, y: 2 })
    expect(() => validateSave(wrongEnemy, world, catalog)).toThrow('单位')
    const { runtime } = harness(); runtime.applyDamage('player', 100)
    const failed = JSON.parse(runtime.exportSave()); failed.data.survival.failure.losses[0] = { id: 'i1', itemId: 101 }
    expect(() => validateSave(failed, world, catalog)).toThrow('低阶普通物资')
  })
})
