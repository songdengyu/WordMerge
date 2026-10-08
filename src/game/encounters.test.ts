import { describe, expect, it } from 'vitest'
import { ENCOUNTERS, encounterCells } from './encounters'
import { GameRuntime, type GameCommand } from './GameRuntime'
import { actorPosition, advanceSurvival, type Enemy, type Companion } from './survival'
import { dataFixture, envelopeFixture, productionFixture, tamingDataFixture, testNow, worldFixture } from './testFixtures'
import { validateSave, type RuntimeData } from './saveData'
import { pointDistance } from './smoothNavigation'

const world = worldFixture(), catalog = productionFixture()
function enemy(data: RuntimeData, cell = { x: 8, y: 9 }, tameable = true): Enemy {
  const animal: Enemy = { id: `e${data.survival.nextEnemyId++}`, kind: 'boar', hp: 70, cell, route: [], progress: 0,
    target: null, cooldown: 0, roaming: true, tameable }
  data.survival.enemies.push(animal); return animal
}
function harness(data = dataFixture()) {
  const runtime = new GameRuntime(world, { catalog, saved: envelopeFixture(data), now: () => testNow })
  let time = 0; runtime.advanceFrame(time)
  const pump = (seconds: number) => { for (let i = 0; i < Math.round(seconds * 20); i++) runtime.advanceFrame(time += 50) }
  const send = async (command: GameCommand) => { const result = runtime.dispatch(command); pump(.05); return result }
  const valid = () => validateSave(JSON.parse(runtime.exportSave()), world, catalog).data
  return { runtime, pump, send, valid }
}

describe('day/night encounters and recruited companions', () => {
  it('warns without damage, resets outside range, and persists permanent hostility after patience expires', () => {
    const data = dataFixture(), animal = enemy(data)
    const h = harness(data); h.pump(3)
    const alert = h.valid()
    expect(alert.survival.enemies[0].tameable).toBe(true)
    expect(alert.survival.enemies[0].alertSeconds).toBeCloseTo(3)
    expect(alert.production.vitals.hp).toBe(data.production.vitals.hp)
    const far = advanceSurvival(alert.survival, alert.production, alert.construction, world, { x: 1, y: 9 }, 720, .05)
    expect(far.state.enemies[0].alertSeconds).toBeUndefined()
    expect(alert.survival.enemies[0].alertSeconds).toBeCloseTo(3)
    const loaded = harness(alert)
    loaded.pump(ENCOUNTERS.patienceSeconds - 3 - .05)
    expect(loaded.valid().survival.enemies[0].tameable).toBe(true)
    loaded.pump(.1)
    const angry = loaded.valid()
    expect(angry.survival.enemies.find(e => e.id === animal.id)).toMatchObject({ tameable: false })
    expect(angry.survival.enemies[0].alertSeconds).toBeUndefined()
    const again = harness(angry); again.pump(2)
    expect(again.valid().production.vitals.hp).toBeLessThan(data.production.vitals.hp)
    expect(again.valid().survival.enemies[0].tameable).toBe(false)
    const away = advanceSurvival(again.valid().survival, angry.production, angry.construction, world, { x: 1, y: 9 }, 1800, .05)
    expect(away.state.enemies[0].tameable).toBe(false)
  })

  it('cancels an expired travel reservation and order without spending or mutating source materials', async () => {
    const data = tamingDataFixture(), animal = enemy(data, { x: 9, y: 9 })
    animal.alertSeconds = ENCOUNTERS.patienceSeconds - .05
    const itemId = data.production.inventory.board[9].instanceId!
    const h = harness(data)
    await h.send({ type: 'taming-interact', targetId: animal.id })
    const expired = h.valid()
    expect(expired.survival.enemies[0].tameable).toBe(false)
    expect(expired.survival.taming).toEqual({ ordered: false, job: null })
    expect(expired.production.inventory.items[itemId]).toMatchObject({ itemId: 213, reservedBy: null })
    expect(expired.destination).toBeNull()
    expect(expired.route).toHaveLength(0)
    expect(await h.send({ type: 'taming-interact', targetId: animal.id })).toMatchObject({ accepted: false })
    expect(data.survival.enemies[0].tameable).toBe(true)
  })

  it('clears a missing-material order on anger, pauses with the world, and lets started taming finish', async () => {
    const data = dataFixture(), animal = enemy(data)
    animal.alertSeconds = ENCOUNTERS.patienceSeconds - .1
    const h = harness(data)
    await h.send({ type: 'taming-interact', targetId: animal.id })
    h.runtime.setPauseReason('background', true); h.pump(30)
    expect(h.valid().survival.enemies[0].tameable).toBe(true)
    h.runtime.setPauseReason('background', false); h.pump(.2)
    expect(h.valid().survival.taming).toEqual({ ordered: false, job: null })
    const prepared = tamingDataFixture(), target = enemy(prepared)
    target.alertSeconds = ENCOUNTERS.patienceSeconds - .05
    const taming = harness(prepared)
    await taming.send({ type: 'taming-interact', targetId: target.id })
    expect(taming.valid().survival.taming.job?.phase).toBe('taming')
    expect(taming.valid().survival.enemies[0].alertSeconds).toBeUndefined()
    const restored = harness(taming.valid()); restored.pump(2)
    expect(restored.valid().survival.recruits).toHaveLength(1)
  })

  it('accepts legacy animals without alert state and rejects invalid or hostile alert timers', () => {
    const data = dataFixture(); enemy(data)
    expect(harness(data).valid().survival.enemies[0].alertSeconds).toBeUndefined()
    for (const value of [-1, NaN, Infinity, 86401]) {
      const bad = structuredClone(data); bad.survival.enemies[0].alertSeconds = value
      expect(() => validateSave(envelopeFixture(bad), world, catalog)).toThrow()
    }
    const bad = structuredClone(data); Object.assign(bad.survival.enemies[0], { tameable: false, alertSeconds: 1 })
    expect(() => validateSave(envelopeFixture(bad), world, catalog)).toThrow()
  })

  it('spawns outside visibility near the current player, retries when all ground is visible, and uses larger night budgets', () => {
    const data = dataFixture(), player = { x: 10, y: 10 }
    const visible = (p: { x: number; y: number }) => p.x >= 5
    const cells = encounterCells(world, data.construction, data.survival, player, visible)
    expect(cells.length).toBeGreaterThan(0)
    expect(cells.every(c => !visible(c) && world.isWalkable(c) && pointDistance(c, player) >= 6 && pointDistance(c, player) <= 14)).toBe(true)
    data.survival.spawnRemaining = 0
    const day = advanceSurvival(data.survival, data.production, data.construction, world, player, 720, 0, false, player, visible)
    expect(day.state.enemies).toHaveLength(1)
    expect(visible(day.state.enemies[0].cell)).toBe(false)
    expect(day.state.enemies[0].roaming).toBe(true)
    expect(day.state.spawnRemaining).toBe(ENCOUNTERS.dayInterval)
    const hidden = advanceSurvival(data.survival, data.production, data.construction, world, player, 720, 0, false, player, () => true)
    expect(hidden.state.enemies).toHaveLength(0)
    expect(hidden.state.spawnRemaining).toBe(ENCOUNTERS.retrySeconds)
    const capped = structuredClone(day.state); enemy({ ...data, survival: capped })
    capped.spawnRemaining = 0
    const full = advanceSurvival(capped, data.production, data.construction, world, player, 720, 0)
    expect(full.state.enemies).toHaveLength(2)
    capped.raidNight = 1
    const night = advanceSurvival(capped, data.production, data.construction, world, player, 1200, 0)
    expect(night.state.enemies).toHaveLength(3)
    expect(night.state.spawnRemaining).toBe(ENCOUNTERS.nightInterval)
  })

  it('pursues and damages the player in daylight; new encounters survive dawn with their tameability unchanged', () => {
    const data = dataFixture(); const animal = enemy(data, { x: 9, y: 9 }, false)
    const h = harness(data); h.pump(4)
    expect(h.valid().production.vitals.hp).toBeLessThan(data.production.vitals.hp)
    expect(pointDistance(actorPosition(h.valid().survival.enemies[0]), data.cell)).toBeLessThan(2)
    const saved = h.valid()
    const dawn = advanceSurvival(saved.survival, saved.production, saved.construction, world, saved.cell, 1800, .05)
    expect(dawn.state.enemies.find(e => e.id === animal.id)?.tameable).toBe(false)
  })

  it('binds missing-material orders to the animal, freezes a reserved target, cancels without cost and restores travel', async () => {
    const data = dataFixture(), animal = enemy(data, { x: 11, y: 9 })
    const h = harness(data)
    expect(await h.send({ type: 'taming-interact', targetId: animal.id })).toMatchObject({ accepted: true, openProduction: true })
    expect(h.valid().survival.taming).toMatchObject({ ordered: true, targetId: animal.id, job: null })
    const withFood = h.valid(), inv = withFood.production.inventory
    inv.items[inv.board[9].instanceId!].itemId = 213
    const prepared = harness(withFood), count = Object.keys(inv.items).length
    expect(await prepared.send({ type: 'taming-interact', targetId: animal.id })).toMatchObject({ accepted: true })
    const travel = prepared.valid(), position = actorPosition(travel.survival.enemies[0])
    expect(travel.survival.taming.job?.phase).toBe('travel')
    const loaded = harness(travel); loaded.pump(.1)
    expect(actorPosition(loaded.valid().survival.enemies[0])).toEqual(position)
    expect(await loaded.send({ type: 'taming-cancel' })).toMatchObject({ accepted: true })
    expect(Object.keys(loaded.valid().production.inventory.items)).toHaveLength(count)
    expect(Object.values(loaded.valid().production.inventory.items).every(i => !i.reservedBy)).toBe(true)
  })

  it('tames at night for two seconds exactly once across reload, keeps Lili, and controls the chosen new companion', async () => {
    const data = tamingDataFixture(), animal = enemy(data)
    data.survival.companion.status = 'active'; data.elapsedSeconds = (25 - world.config.initialHour) / 24 * world.config.dayDurationSeconds
    const h = harness(data), count = Object.keys(data.production.inventory.items).length
    expect(await h.send({ type: 'taming-interact', targetId: animal.id })).toMatchObject({ accepted: true })
    expect(h.valid().survival.taming.job?.phase).toBe('taming')
    h.pump(.8)
    const loaded = harness(h.valid()); loaded.pump(1.1)
    expect(loaded.valid().survival.recruits).toHaveLength(0)
    loaded.pump(.2)
    const saved = loaded.valid()
    expect(saved.survival.recruits).toHaveLength(1)
    expect(saved.survival.companion.status).toBe('active')
    expect(saved.survival.enemies.some(e => e.id === animal.id)).toBe(false)
    expect(Object.keys(saved.production.inventory.items)).toHaveLength(count - 1)
    expect(await loaded.send({ type: 'taming-interact', targetId: animal.id })).toMatchObject({ accepted: false })
    expect(await loaded.send({ type: 'companion-move', companionId: animal.id, target: { x: 10, y: 10 } })).toMatchObject({ accepted: true })
    loaded.pump(5)
    expect(actorPosition(loaded.valid().survival.recruits![0])).toEqual({ x: 10, y: 10 })
    expect(loaded.valid().survival.companion.mode).toBe('guard')
    const restored = harness(loaded.valid())
    expect(await restored.send({ type: 'companion-mode', companionId: animal.id, mode: 'follow' })).toMatchObject({ accepted: true })
    expect(restored.valid().survival.recruits![0].mode).toBe('follow')
  })

  it('fights with the recruited species stats, preserves duel settlement and keeps other companions moving', async () => {
    const data = dataFixture(), animal = enemy(data, { x: 8, y: 9 }, false)
    const recruit: Companion = { id: `e${data.survival.nextEnemyId++}`, kind: 'boar', hp: 70, cell: { x: 8, y: 9 }, route: [], progress: 0,
      target: null, cooldown: 0, status: 'active', mode: 'guard', guard: { x: 8, y: 9 }, orderedEnemy: animal.id, recoveryRemaining: 0 }
    data.survival.recruits = [recruit]; data.survival.companion.status = 'active'
    data.survival.companion.mode = 'move'; data.survival.companion.guard = { x: 4, y: 9 }
    const h = harness(data); h.pump(.05)
    expect(h.valid().survival.duel?.companionId).toBe(recruit.id)
    const oldLili = actorPosition(h.valid().survival.companion)
    const loaded = harness(h.valid()); loaded.pump(1)
    expect(actorPosition(loaded.valid().survival.companion)).not.toEqual(oldLili)
    loaded.pump(1.05)
    const saved = loaded.valid()
    expect(saved.survival.recruits![0].status).toBe('injured') // equal boars strike on the same beat
    expect(saved.survival.enemies).toHaveLength(0)
    expect(saved.production.inventory.gold).toBe(4)
    const again = harness(saved); again.pump(1)
    expect(again.valid().production.inventory.gold).toBe(4)
  })

  it('clears the abandoned wild-animal order on rescue, preserves recruits, and rejects forged recruit identities', async () => {
    const data = dataFixture(), animal = enemy(data)
    const h = harness(data); await h.send({ type: 'taming-interact', targetId: animal.id })
    h.runtime.applyDamage('player', 100)
    expect(await h.runtime.dispatch({ type: 'rescue' })).toMatchObject({ accepted: true })
    expect(h.valid().survival.taming).toEqual({ ordered: false, job: null })
    const bad = envelopeFixture(); bad.data.survival.recruits = [{ ...data.survival.companion, id: 'e99', kind: 'boar', status: 'active' }]
    expect(() => validateSave(bad, world, catalog)).toThrow()
    const legacy = envelopeFixture(); delete legacy.data.survival.recruits
    expect(harness(validateSave(legacy, world, catalog).data).valid().survival.recruits).toEqual([])
  })
})
