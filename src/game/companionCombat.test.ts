import { describe, expect, it } from 'vitest'
import { simulateCombat } from './companionCombat'
import { GameRuntime, type GameCommand } from './GameRuntime'
import { createSurvival, type Enemy } from './survival'
import { validateSave } from './saveData'
import { dataFixture, envelopeFixture, productionFixture, testNow, worldFixture } from './testFixtures'

const world = worldFixture(), catalog = productionFixture()
function encounter(hp = 180, enemyHp = 32) {
  const data = dataFixture()
  data.elapsedSeconds = (25 - world.config.initialHour) / 24 * world.config.dayDurationSeconds; data.survival = createSurvival(world, data.elapsedSeconds)
  data.cell = { x: 10, y: 8 }
  Object.assign(data.survival.companion, { status: 'active', hp, cell: { x: 6, y: 8 }, guard: { x: 6, y: 8 } })
  data.survival.enemies = [{ id: 'e1', kind: 'prowler', hp: enemyHp, cell: { x: 7, y: 8 }, route: [], progress: 0, target: null, cooldown: 0 }]
  data.survival.nextEnemyId = 2; data.survival.spawnRemaining = 80
  return data
}
function harness(data = encounter()) {
  const runtime = new GameRuntime(world, { catalog, saved: envelopeFixture(data), now: () => testNow })
  let time = 0; runtime.advanceFrame(time)
  const pump = (seconds: number) => { for (let i = 0; i < Math.round(seconds * 20); i++) runtime.advanceFrame(time += 50) }
  const valid = () => validateSave(JSON.parse(runtime.exportSave()), world, catalog).data
  const send = async (command: GameCommand) => { const pending = runtime.dispatch(command); pump(.05); return pending }
  return { runtime, pump, valid, send }
}

describe('virtual companion fight', () => {
  it('uses current HP, attack intervals and pending cooldown, without attacks after defeat', () => {
    expect(simulateCombat({ hp: 30, attack: 10, interval: 2, cooldown: 0 }, { hp: 25, attack: 7, interval: 1, cooldown: .5 }))
      .toEqual({ companionHp: 2, enemyHp: 0, companionCooldown: 2, enemyCooldown: .5, simulatedSeconds: 4 })
    expect(simulateCombat({ hp: 3, attack: 99, interval: 2, cooldown: 1 }, { hp: 25, attack: 3, interval: 1, cooldown: 0 }))
      .toMatchObject({ companionHp: 0, enemyHp: 25, simulatedSeconds: 0 })
  })
  it('resolves simultaneous lethal strikes as a mutual knockout', () => {
    expect(simulateCombat({ hp: 2, attack: 14, interval: 2, cooldown: 0 }, { hp: 14, attack: 2, interval: 2, cooldown: 0 }))
      .toMatchObject({ companionHp: 0, enemyHp: 0 })
  })
})

describe('persistent two-second companion encounters', () => {
  it('freezes both actors, applies no damage before two seconds, commits once and resumes after poses', () => {
    const h = harness(); h.pump(.05)
    const start = h.valid(); expect(start.survival.duel?.remaining).toBe(2)
    h.pump(1.95)
    const before = h.valid()
    expect(before.survival.companion).toEqual(start.survival.companion)
    expect(before.survival.enemies).toEqual(start.survival.enemies)
    expect(before.production.inventory.gold).toBe(0)
    h.pump(.05)
    expect(h.valid().survival.duel?.phase).toBe('result')
    expect(h.valid().survival.companion.hp).toBe(174)
    expect(h.valid().survival.enemies).toHaveLength(0)
    expect(h.valid().production.inventory.gold).toBe(2)
    h.pump(1)
    expect(h.valid().survival.duel).toBeNull()
    h.pump(3); expect(h.valid().production.inventory.gold).toBe(2)
  })
  it('allows an enemy to intercept a moving companion, locks commands and leaves a defeated pet injured', async () => {
    const data = encounter(1); data.survival.companion.mode = 'move'; data.survival.companion.guard = { x: 8, y: 8 }
    const h = harness(data); h.pump(.05)
    expect(h.valid().survival.duel?.phase).toBe('fighting')
    for (const command of [{ type: 'companion-treat' }, { type: 'companion-mode', mode: 'follow' }, { type: 'companion-attack', enemyId: 'e1' }] as GameCommand[])
      expect(await h.send(command)).toMatchObject({ accepted: false })
    h.pump(2)
    expect(h.valid().survival.companion).toMatchObject({ status: 'injured', hp: 0 })
    expect(h.valid().survival.enemies[0].hp).toBe(18)
    expect(h.valid().production.inventory.gold).toBe(0)
    expect(h.valid().survival.failure).toBeNull()
  })
  it('keeps other enemies on normal player damage cadence instead of joining the locked pair', () => {
    const data = encounter()
    const third: Enemy = { ...structuredClone(data.survival.enemies[0]), id: 'e2', cell: { ...data.cell }, target: { kind: 'player' } }
    data.survival.enemies.push(third); data.survival.nextEnemyId = 3
    const h = harness(data); h.pump(.05)
    expect(h.valid().production.vitals.hp).toBe(98)
    h.pump(1.95); expect(h.valid().production.vitals.hp).toBe(98)
    h.pump(.05); expect(h.valid().production.vitals.hp).toBe(96)
    expect(h.valid().survival.companion.hp).toBe(174)
    expect(h.valid().survival.enemies.map(e => e.id)).toEqual(['e2'])
  })
  it('restores smoke and result stages, and pauses the timer offline', () => {
    const h = harness(); h.pump(.55)
    const saved = h.valid(), restored = harness(saved)
    restored.runtime.setPauseReason('background', true); restored.pump(30)
    expect(restored.valid()).toEqual(saved)
    restored.runtime.setPauseReason('background', false); restored.pump(.05) // First frame reanchors the wall clock after resume.
    restored.pump(1.5)
    const result = restored.valid(); expect(result.survival.duel?.phase).toBe('result')
    const pose = harness(result); pose.pump(1)
    expect(pose.valid().survival.duel).toBeNull()
    expect(pose.valid().production.inventory.gold).toBe(2)
  })
  it('keeps an engaged pair across natural dawn and test jumps without skipping the fight timer', async () => {
    const data = encounter(); data.elapsedSeconds = (30 - world.config.initialHour) / 24 * world.config.dayDurationSeconds - .5
    const h = harness(data); h.pump(1)
    expect(h.valid().survival.duel?.phase).toBe('fighting')
    expect(h.valid().survival.enemies).toHaveLength(1)
    const before = h.valid().survival.duel!.remaining
    await h.send({ type: 'test-time', preset: 'noon' })
    expect(h.valid().survival.duel!.remaining).toBeCloseTo(before - .05)
    h.pump(1.1); expect(h.valid().production.inventory.gold).toBe(2)
  })
  it('settles a paused fight once when rescuing the player; a losing enemy never grants twice', async () => {
    const h = harness(); h.pump(.5); h.runtime.applyDamage('player', 100)
    const failed = h.valid(); expect(failed.survival.duel?.phase).toBe('fighting')
    h.pump(10); expect(h.valid()).toEqual(failed)
    const restored = harness(failed)
    expect(await restored.runtime.dispatch({ type: 'rescue' })).toMatchObject({ accepted: true })
    expect(restored.valid().survival.duel).toBeNull()
    expect(restored.valid().survival.companion.hp).toBe(174)
    expect(restored.valid().production.inventory.gold).toBe(2)
    expect(await restored.runtime.dispatch({ type: 'rescue' })).toMatchObject({ accepted: false })
    const again = harness(restored.valid()); again.pump(3)
    expect(again.valid().production.inventory.gold).toBe(2)
  })
  it('migrates absent encounter fields and rejects forged damage, timers and participant HP', () => {
    const legacy = envelopeFixture() as any; delete legacy.data.survival.duel
    expect(validateSave(legacy, world, catalog).data.survival.duel).toBeNull()
    const h = harness(); h.pump(.05)
    const badResult = envelopeFixture(h.valid()); badResult.data.survival.duel!.result.companionHp = 180
    expect(() => validateSave(badResult, world, catalog)).toThrow('战斗预计算结果')
    const badTimer = envelopeFixture(h.valid()); badTimer.data.survival.duel!.remaining = 9
    expect(() => validateSave(badTimer, world, catalog)).toThrow('战斗计时')
    const badHp = envelopeFixture(h.valid()); badHp.data.survival.enemies[0].hp = 1
    expect(() => validateSave(badHp, world, catalog)).toThrow('战斗敌人锁定状态')
  })
})
