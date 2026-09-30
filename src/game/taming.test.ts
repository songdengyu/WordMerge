import { describe, expect, it } from 'vitest'
import { GameRuntime, type GameCommand } from './GameRuntime'
import { validateSave } from './saveData'
import { dataFixture, envelopeFixture, productionFixture, testNow, worldFixture } from './testFixtures'
import { TAMING_ORDER } from './taming'

const world = worldFixture(), catalog = productionFixture()
function harness(data = dataFixture()) {
  const runtime = new GameRuntime(world, { catalog, saved: envelopeFixture(data), now: () => testNow })
  let frame = 0; runtime.advanceFrame(frame)
  const pump = (seconds: number) => { for (let i = 0; i < Math.round(seconds * 20); i++) { frame += 50; runtime.advanceFrame(frame) } }
  const send = async (command: GameCommand) => { const pending = runtime.dispatch(command); pump(.05); return pending }
  const valid = () => validateSave(JSON.parse(runtime.exportSave()), world, catalog).data
  return { runtime, pump, send, valid }
}
function distant() { const data = dataFixture(); data.cell = { x: 9, y: 9 }; return data }
function berryId(data: ReturnType<typeof dataFixture>) {
  return Object.values(data.production.inventory.items).find(item => item.itemId === 211 && item.location.kind === 'board' && data.production.inventory.board[item.location.index].lock === 0)!.id
}

describe('timed taming and orders', () => {
  it('missing food creates one persistent order, which can be cancelled without consuming other pieces', async () => {
    const data = dataFixture(), id = berryId(data), item = data.production.inventory.items[id]
    data.production.inventory.board[item.location.index].instanceId = null; delete data.production.inventory.items[id]
    const { runtime, send, valid } = harness(data)
    for (let i = 0; i < 2; i++) expect(await send({ type: 'taming-interact' })).toMatchObject({ accepted: true, openProduction: true })
    expect(valid().survival.taming).toEqual({ ordered: true, job: null })
    expect(runtime.getSaveData().production.inventory).toEqual(data.production.inventory)
    await send({ type: 'taming-cancel' })
    expect(valid().survival.taming.ordered).toBe(false)
  })
  it('reserves actual warehouse food during travel, blocks reuse and releases it in the original slot on cancel', async () => {
    const data = distant(), id = berryId(data), item = data.production.inventory.items[id]
    data.production.inventory.board[item.location.index].instanceId = null
    item.location = { kind: 'warehouse', index: 0 }; data.production.inventory.warehouse[0] = id
    const { runtime, send, valid } = harness(data)
    expect(await send({ type: 'taming-interact' })).toMatchObject({ accepted: true, openProduction: false })
    expect(valid().survival.taming.job?.phase).toBe('travel')
    expect(runtime.getSaveData().production.inventory.items[id].reservedBy).toBe(TAMING_ORDER)
    expect(await send({ type: 'item-use', instanceId: id })).toMatchObject({ accepted: false })
    expect(await send({ type: 'taming-interact' })).toMatchObject({ accepted: false })
    expect(await send({ type: 'move', target: { x: 9, y: 9 } })).toMatchObject({ accepted: false })
    await send({ type: 'taming-cancel' })
    expect(valid().production.inventory.items[id]).toMatchObject({ reservedBy: null, location: { kind: 'warehouse', index: 0 } })
    expect(runtime.getUiSnapshot().activity).toBe('idle')
  })
  it('consumes only at the exact work position, waits two seconds and keeps started work protected and uninterruptible', async () => {
    const data = distant(), id = berryId(data), h = harness(data)
    await h.send({ type: 'taming-interact' })
    for (let i = 0; i < 100 && h.runtime.getUiSnapshot().activity !== 'taming'; i++) {
      expect(h.runtime.getSaveData().production.inventory.items[id]).toBeTruthy(); h.pump(.05)
    }
    const working = h.valid(), job = working.survival.taming.job!
    expect(working.motion?.position).toEqual(job.workCell)
    expect(working.production.inventory.items[id]).toBeUndefined()
    expect(job.remaining).toBe(2)
    const health = working.production.vitals.hp
    h.runtime.applyDamage('player', 100)
    expect(h.runtime.getSaveData().production.vitals.hp).toBe(health)
    expect(await h.send({ type: 'taming-cancel' })).toMatchObject({ accepted: false })
    expect(await h.send({ type: 'companion-rescue' })).toMatchObject({ accepted: false })
    h.pump(1.85)
    expect(h.runtime.getSaveData().survival.companion.status).toBe('wild')
    h.pump(.05)
    expect(h.valid().survival.companion.status).toBe('active')
    expect(h.runtime.getSaveData().survival.taming).toEqual({ ordered: false, job: null })
    expect(h.runtime.getUiSnapshot().protected).toBe(false)
    expect(await h.send({ type: 'companion-rescue' })).toMatchObject({ accepted: false })
  })
  it('resumes travel and partially finished taming after reload; background and story pause its timer', async () => {
    const h = harness(distant()); await h.send({ type: 'taming-interact' })
    const travel = harness(h.valid()); travel.pump(2)
    expect(travel.runtime.getUiSnapshot().activity).toBe('taming')
    const saved = travel.valid(), remaining = saved.survival.taming.job!.remaining
    const work = harness(saved)
    for (const reason of ['background', 'story'] as const) {
      work.runtime.setPauseReason(reason, true); work.pump(10)
      expect(work.runtime.getSaveData().survival.taming.job!.remaining).toBe(remaining)
      work.runtime.setPauseReason(reason, false)
    }
    work.pump(remaining + .05)
    expect(work.valid().survival.companion.status).toBe('active')
    expect(work.valid().production.inventory).toEqual(saved.production.inventory)
  })
  it('night cancels travel and releases food, but does not interrupt work already started', async () => {
    const h = harness(distant()), id = berryId(h.runtime.getSaveData())
    await h.send({ type: 'taming-interact' }); await h.send({ type: 'test-time', preset: 'night' })
    expect(h.valid().survival.taming).toEqual({ ordered: true, job: null })
    expect(h.runtime.getSaveData().production.inventory.items[id].reservedBy).toBeNull()
    expect(await h.send({ type: 'taming-interact' })).toMatchObject({ accepted: false })
    const work = harness(); await work.send({ type: 'taming-interact' })
    await work.send({ type: 'test-time', preset: 'night' }); work.pump(2)
    expect(work.valid().survival.companion.status).toBe('active')
  })
  it('construction and taming cannot reserve the protagonist at the same time', async () => {
    const h = harness(distant()); await h.send({ type: 'taming-interact' })
    expect(await h.send({ type: 'building-place', blueprintId: 'cabin', origin: { x: 7, y: 10 }, rotation: 0 })).toMatchObject({ accepted: false })
    await h.send({ type: 'taming-cancel' })
    await h.send({ type: 'building-place', blueprintId: 'cabin', origin: { x: 7, y: 10 }, rotation: 0 })
    const data = h.valid(), inv = data.production.inventory, index = inv.board.findIndex(slot => slot.lock === 0 && !slot.instanceId), id = `i${inv.nextId++}`
    inv.board[index].instanceId = id; inv.items[id] = { id, itemId: 202, reservedBy: null, location: { kind: 'board', index } }
    const building = harness(data); await building.send({ type: 'building-interact', buildingId: 'b1', partId: 'foundation' })
    expect(await building.send({ type: 'taming-interact' })).toMatchObject({ accepted: false })
    building.valid()
  })
  it('defeat during travel releases food and clears the job before recording losses', async () => {
    const h = harness(distant()); await h.send({ type: 'taming-interact' })
    h.runtime.applyDamage('player', 100)
    const failed = h.valid()
    expect(failed.survival.failure).not.toBeNull()
    expect(failed.survival.taming.job).toBeNull()
    expect(Object.values(failed.production.inventory.items).every(item => !item.reservedBy)).toBe(true)
    await h.runtime.dispatch({ type: 'rescue' }); h.valid()
  })
  it('migrates old saves and rejects forged timers, reservations and completed-companion orders', async () => {
    const old = envelopeFixture() as any; delete old.data.survival.taming
    expect(validateSave(old, world, catalog).data.survival.taming).toEqual({ ordered: false, job: null })
    const h = harness(distant()); await h.send({ type: 'taming-interact' })
    const save = JSON.parse(h.runtime.exportSave()), id = save.data.survival.taming.job.reservedIds[0]
    const corrupt = structuredClone(save); corrupt.data.production.inventory.items[id].reservedBy = 'another-job'
    expect(() => validateSave(corrupt, world, catalog)).toThrow('驯服预留')
    const orphan = structuredClone(save); orphan.data.survival.taming.job = null
    expect(() => validateSave(orphan, world, catalog)).toThrow('孤立')
    const done = structuredClone(save); done.data.survival.companion.status = 'active'
    expect(() => validateSave(done, world, catalog)).toThrow('已驯服')
    const work = harness(); await work.send({ type: 'taming-interact' })
    const timer = JSON.parse(work.runtime.exportSave()); timer.data.survival.taming.job.remaining = 3
    expect(() => validateSave(timer, world, catalog)).toThrow('计时')
  })
})
