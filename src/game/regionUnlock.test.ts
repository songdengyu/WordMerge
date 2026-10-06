import { describe, expect, it } from 'vitest'
import { BLUEPRINTS } from './buildingConfig'
import { GameRuntime, type GameCommand } from './GameRuntime'
import { regionGates, reachableRegionGate } from './regionUnlock'
import { MAP_TAB_PROGRESSION_VERSION } from './progressionConfig'
import { m4ConfigVersion, validateSave } from './saveData'
import { dataFixture, tamingDataFixture, envelopeFixture, productionFixture, testNow, worldFixture } from './testFixtures'

const world = worldFixture(), catalog = productionFixture()
function prepared() {
  const data = tamingDataFixture()
  data.construction.buildings = [{ id: 'b1', blueprintId: 'cabin', origin: { x: 7, y: 10 }, rotation: 0,
    parts: Object.fromEntries(BLUEPRINTS[0].parts.map(p => [p.id, { built: true, hp: p.hp, xpGranted: true }])) }]
  data.construction.xp = 70; data.construction.nextId = 2
  return data
}
function harness(data = prepared()) {
  const runtime = new GameRuntime(world, { catalog, saved: envelopeFixture(data), now: () => testNow })
  let frame = 0; runtime.advanceFrame(frame)
  const pump = (seconds: number) => { for (let i = 0; i < Math.round(seconds * 20); i++) { frame += 50; runtime.advanceFrame(frame) } }
  const send = async (command: GameCommand) => { const pending = runtime.dispatch(command); pump(.05); return pending }
  const valid = () => validateSave(JSON.parse(runtime.exportSave()), world, catalog).data
  const arrive = () => {
    for (let i = 0; i < 400 && runtime.getSaveData().progression.regionUnlock?.phase === 'travel'; i++) pump(.05)
    expect(valid().progression.regionUnlock).toMatchObject({ phase: 'unlocking', remaining: 2 })
  }
  return { runtime, pump, send, valid, arrive }
}

describe('scene signpost region unlocking', () => {
  it('places four signs per locked region with exterior work positions and finds an accessible side', () => {
    const data = prepared()
    for (const id of ['brook', 'grove']) {
      const gates = regionGates(world, id)
      expect(gates.map(g => g.side)).toEqual(['north', 'east', 'south', 'west'])
      for (const gate of gates) expect(world.chunkAt(gate.workCell)?.id).not.toBe(id)
    }
    expect(reachableRegionGate(world, data.construction, data.cell, 'brook')).toMatchObject({ side: 'south', workCell: { x: 7, y: 0 } })
    expect(reachableRegionGate(world, data.construction, data.cell, 'grove')).toMatchObject({ side: 'west', workCell: { x: 15, y: 7 } })
  })
  it('rejects insufficient experience and inaccessible sides, while experience alone is enough without story progress', async () => {
    const poor = harness(dataFixture())
    expect(await poor.send({ type: 'region-unlock', regionId: 'brook', side: 'south' })).toMatchObject({ accepted: false, reason: expect.stringContaining('0/30') })
    expect(poor.valid().progression.regionUnlock).toBeNull()
    const h = harness()
    expect(await h.send({ type: 'region-unlock', regionId: 'brook', side: 'north' })).toMatchObject({ accepted: false, reason: expect.stringContaining('不可达') })
    expect(await h.send({ type: 'region-unlock', regionId: 'grove', side: 'west' })).toMatchObject({ accepted: true })
    expect(h.valid().progression.completed).toEqual([])
    expect(h.valid().progression.unlockedRegions).toEqual([])
  })
  it('arrives at the exact work position before starting two protected, uninterruptible seconds; unlocks only once without spending XP', async () => {
    const h = harness()
    await h.send({ type: 'region-unlock', regionId: 'brook', side: 'south' })
    expect(h.valid().progression.regionUnlock?.phase).toBe('travel')
    expect(h.runtime.world.isWalkable({ x: 7, y: -5 })).toBe(false)
    h.arrive()
    expect(h.valid().motion?.position).toEqual({ x: 7, y: 0 })
    const hp = h.valid().production.vitals.hp
    h.runtime.applyDamage('player', 100)
    expect(h.valid().production.vitals.hp).toBe(hp)
    expect(h.runtime.getUiSnapshot().protected).toBe(true)
    expect(await h.send({ type: 'region-unlock-cancel' })).toMatchObject({ accepted: false })
    expect(await h.send({ type: 'move', target: { x: 7, y: 1 } })).toMatchObject({ accepted: false })
    h.pump(1.85)
    expect(h.valid().progression.unlockedRegions).toEqual([])
    h.pump(.05)
    expect(h.valid().progression.unlockedRegions).toEqual(['brook'])
    expect(h.valid().progression.regionUnlock).toBeNull()
    expect(h.valid().construction.xp).toBe(70)
    expect(h.runtime.world.isWalkable({ x: 7, y: -5 })).toBe(true)
    expect(await h.send({ type: 'region-unlock', regionId: 'brook' })).toMatchObject({ accepted: false })
  })
  it('allows travel cancellation and excludes construction, taming and resting while travelling', async () => {
    const h = harness()
    await h.send({ type: 'region-unlock', regionId: 'brook' })
    for (const command of [
      { type: 'taming-interact' }, { type: 'player-rest' },
      { type: 'building-place', blueprintId: 'cabin', origin: { x: 10, y: 10 }, rotation: 0 },
      { type: 'region-unlock', regionId: 'grove' },
    ] as GameCommand[]) expect(await h.send(command)).toMatchObject({ accepted: false })
    expect(await h.send({ type: 'region-unlock-cancel' })).toMatchObject({ accepted: true })
    expect(h.valid().progression.regionUnlock).toBeNull()
    expect(h.valid().destination).toBeNull()
    await h.send({ type: 'taming-interact' })
    expect(await h.send({ type: 'region-unlock', regionId: 'brook' })).toMatchObject({ accepted: false })
  })
  it('resumes travel and unfinished work from saves, and pauses the work timer with the world', async () => {
    const h = harness(); await h.send({ type: 'region-unlock', regionId: 'brook' })
    const travel = harness(h.valid()); travel.arrive(); travel.pump(.65)
    const work = harness(travel.valid()), remaining = work.valid().progression.regionUnlock!.remaining
    for (const reason of ['background', 'story'] as const) {
      work.runtime.setPauseReason(reason, true); work.pump(10)
      expect(work.valid().progression.regionUnlock!.remaining).toBe(remaining)
      work.runtime.setPauseReason(reason, false)
    }
    work.pump(remaining + .05)
    expect(work.valid().progression.unlockedRegions).toEqual(['brook'])
    expect(work.valid().production.inventory).toEqual(h.valid().production.inventory)
  })
  it('clears travel on defeat, allowing rescue without a stuck job', async () => {
    const h = harness(); await h.send({ type: 'region-unlock', regionId: 'brook' })
    h.runtime.applyDamage('player', 100)
    expect(h.valid().survival.failure).not.toBeNull()
    expect(h.valid().progression.regionUnlock).toBeNull()
    await h.runtime.dispatch({ type: 'rescue' })
    expect(h.valid().progression.unlockedRegions).toEqual([])
  })
  it('migrates the previous map-tab save fingerprint without losing progress, inventory or unlocked land', () => {
    const data = prepared(); data.progression.unlockedRegions = ['brook']; data.progression.discoveries = ['brook']
    data.progression.completed = ['letter']; data.progression.choices = { letter: 'truth' }
    const old = envelopeFixture(data) as any
    old.configVersion = `${m4ConfigVersion(world, catalog).replace(/^m4-/, 'm5-')}-${MAP_TAB_PROGRESSION_VERSION}`
    delete old.data.progression.regionUnlock
    const migrated = validateSave(old, world, catalog)
    expect(migrated.configVersion).not.toBe(old.configVersion)
    expect(migrated.data.production).toEqual(data.production)
    expect(migrated.data.construction).toMatchObject(data.construction)
    expect(migrated.data.progression).toMatchObject({ ...data.progression, regionUnlock: null,
      regionContent: { ...data.progression.regionContent, initialized: ['brook'] } })
    expect(migrated.data.survival.enemies.filter(enemy => enemy.residentId)).toHaveLength(3)
  })
  it('rejects forged sign positions, sides and work timers', async () => {
    const h = harness(); await h.send({ type: 'region-unlock', regionId: 'brook' }); h.arrive()
    for (const edit of [
      (job: any) => { job.side = 'north' },
      (job: any) => { job.workCell.y = 1 },
      (job: any) => { job.remaining = 3 },
      (job: any) => { job.remaining = 0 },
    ]) {
      const save = JSON.parse(h.runtime.exportSave()); edit(save.data.progression.regionUnlock)
      expect(() => validateSave(save, world, catalog)).toThrow('存档校验失败')
    }
  })
})
