import 'fake-indexeddb/auto'
import { deleteDB, openDB } from 'idb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearGameData, DATABASE_NAME, SaveRepository } from './persistence'
import { dataFixture, envelopeFixture, productionFixture, testNow, worldFixture } from './testFixtures'
import { GameRuntime } from './GameRuntime'
import { legacyConfigVersion, validateSave } from './saveData'

const world = worldFixture(), catalog = productionFixture()
const repositories: SaveRepository[] = []
async function repository() {
  const repo = await SaveRepository.open(world, catalog)
  repositories.push(repo)
  await repo.load(world, catalog)
  return repo
}
async function readRecord(key: string) {
  const db = await openDB(DATABASE_NAME, 1)
  try { return await db.get('snapshots', key) } finally { db.close() }
}
async function writeRecord(key: string, value: unknown) {
  const db = await openDB(DATABASE_NAME, 1)
  try { await db.put('snapshots', value, key) } finally { db.close() }
}
beforeEach(async () => { await deleteDB(DATABASE_NAME) })
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(repositories.splice(0).map(repo => repo.close())) })

describe('versioned atomic IndexedDB saves', () => {
  it('explicitly clears all progress and backups, including corrupt records', async () => {
    const repo = await repository()
    await repo.save(dataFixture()); await repo.save(dataFixture())
    await writeRecord('current', { broken: true }); await writeRecord('revision', 'broken')
    await clearGameData()
    expect(await readRecord('current')).toBeUndefined()
    expect(await readRecord('previous')).toBeUndefined()
    expect(await readRecord('revision')).toBeUndefined()
    const fresh = await repository()
    expect(await fresh.load(world, catalog)).toEqual({ saved: null, notice: null })
    await fresh.save(dataFixture())
    expect(await readRecord('previous')).toBeUndefined()
  })
  it('rejects old tabs even when their revisions match the new game after reset', async () => {
    const emptyTab = await repository(), oldTab = await repository()
    await oldTab.save(dataFixture())
    await clearGameData()
    await expect(emptyTab.save(dataFixture())).rejects.toMatchObject({ kind: 'conflict' })
    const fresh = await repository()
    await fresh.save(dataFixture())
    await expect(oldTab.save(dataFixture())).rejects.toMatchObject({ kind: 'conflict' })
    oldTab.retry()
    await expect(oldTab.save(dataFixture())).rejects.toMatchObject({ kind: 'conflict' })
    expect(await readRecord('previous')).toBeUndefined()
  })
  it('rolls back the whole reset if the transaction fails after clearing records', async () => {
    const repo = await repository()
    const first = await repo.save(dataFixture()), second = await repo.save(dataFixture())
    vi.spyOn(crypto, 'getRandomValues').mockImplementationOnce(() => { throw new Error('Simulated reset failure') })
    await expect(clearGameData()).rejects.toThrow('Simulated reset failure')
    expect(await readRecord('current')).toEqual(second)
    expect(await readRecord('previous')).toEqual(first)
    expect(await readRecord('revision')).toBe(second.revision)
  })
  it('drains pending saves before reset and prevents disposed runtimes from saving again', async () => {
    const repo = await repository(), runtime = new GameRuntime(world, { catalog, repository: repo, now: () => testNow })
    const pending = [runtime.checkpoint(), runtime.checkpoint()]
    await runtime.dispose()
    expect(await Promise.all(pending)).toEqual([true, true])
    await clearGameData()
    runtime.advanceFrame(0); runtime.advanceFrame(250)
    expect(runtime.getSaveData().elapsedSeconds).toBe(0)
    expect(await runtime.checkpoint()).toBe(false)
    expect(await readRecord('current')).toBeUndefined()
    expect(await readRecord('previous')).toBeUndefined()
  })
  it('serializes concurrent checkpoints and atomically retains the previous valid snapshot', async () => {
    const repo = await repository()
    const first = dataFixture(), next = dataFixture()
    first.production.inventory.gold = 10; next.production.inventory.gold = 20
    const writes = [repo.save(first, testNow), repo.save(next, testNow + 1)]
    first.production.inventory.gold = 999
    expect((await Promise.all(writes)).map(save => save.revision)).toEqual([1, 2])
    const current = validateSave(await readRecord('current'), world, catalog)
    const previous = validateSave(await readRecord('previous'), world, catalog)
    expect(current.data.production.inventory.gold).toBe(20)
    expect(previous.data.production.inventory.gold).toBe(10)
    expect(await readRecord('revision')).toBe(2)
  })
  it('rejects a stale tab instead of silently overwriting the other tab', async () => {
    const first = await repository(), second = await repository()
    await first.save(dataFixture())
    await expect(second.save(dataFixture())).rejects.toMatchObject({ kind: 'conflict' })
    second.retry()
    await expect(second.save(dataFixture())).rejects.toMatchObject({ kind: 'conflict' })
    expect(await readRecord('revision')).toBe(1)
  })
  it('recovers corrupt current data from the previous record and preserves a valid backup on the next save', async () => {
    const repo = await repository()
    await repo.save(dataFixture()); await repo.save(dataFixture())
    await writeRecord('current', { broken: true })
    const recovered = await SaveRepository.open(world, catalog); repositories.push(recovered)
    const loaded = await recovered.load(world, catalog)
    expect(loaded.notice).toContain('有效备份')
    expect(loaded.saved?.revision).toBe(1)
    await recovered.save(loaded.saved!.data)
    expect(validateSave(await readRecord('previous'), world, catalog).revision).toBe(1)
    expect(validateSave(await readRecord('current'), world, catalog).revision).toBe(3)
  })
  it('does not treat a future format or changed configuration as a reason to roll back', async () => {
    const repo = await repository()
    await repo.save(dataFixture()); const current = await repo.save(dataFixture())
    await writeRecord('current', { ...current, schemaVersion: 3 })
    const fresh = await SaveRepository.open(world, catalog); repositories.push(fresh)
    await expect(fresh.load(world, catalog)).rejects.toMatchObject({ kind: 'incompatible' })
    expect((await readRecord('current')).schemaVersion).toBe(3)
  })
  it('does not start a new game when both current and backup are damaged', async () => {
    const repo = await repository()
    await repo.save(dataFixture()); await repo.save(dataFixture())
    const corrupt = { ...envelopeFixture(), data: null }
    await writeRecord('current', corrupt); await writeRecord('previous', corrupt)
    const fresh = await SaveRepository.open(world, catalog); repositories.push(fresh)
    await expect(fresh.load(world, catalog)).rejects.toMatchObject({ kind: 'invalid', raw: expect.any(Object) })
    expect(await readRecord('revision')).toBe(2)
  })
  it('commits a migrated M2 snapshot with a valid previous backup and does not reset it on the next load', async () => {
    const repo = await repository()
    const current = await repo.save(dataFixture())
    const legacy = { ...current, schemaVersion: 1, configVersion: legacyConfigVersion(world, catalog), data: { ...current.data } } as any
    delete legacy.data.construction
    legacy.data.production.stamina.value = 140
    await writeRecord('current', legacy)
    const fresh = await SaveRepository.open(world, catalog); repositories.push(fresh)
    const loaded = await fresh.load(world, catalog)
    expect(loaded.notice).toContain('升级')
    await fresh.save(loaded.saved!.data)
    expect(validateSave(await readRecord('previous'), world, catalog).data.production.stamina.value).toBe(140)
    const again = await SaveRepository.open(world, catalog); repositories.push(again)
    expect((await again.load(world, catalog)).saved!.data).toEqual(loaded.saved!.data)
  })
})

describe('runtime and durable production', () => {
  it('checkpoints arrival deduction and completion XP immediately, without waiting for the autosave interval', async () => {
    const repo = await repository(), runtime = new GameRuntime(world, { catalog, repository: repo, now: () => testNow })
    let frame = 0; runtime.advanceFrame(frame)
    const step = () => { frame += 50; runtime.advanceFrame(frame) }
    const send = async (command: Parameters<GameRuntime['dispatch']>[0]) => { const pending = runtime.dispatch(command); step(); return pending }
    const inventory = runtime.getUiSnapshot().production!.inventory
    await send({ type: 'item-move', instanceId: inventory.board[7].instanceId!, targetIndex: 8, expectedTarget: inventory.board[8].instanceId })
    await send({ type: 'building-place', blueprintId: 'cabin', origin: { x: 7, y: 10 }, rotation: 0 })
    await send({ type: 'building-order', buildingId: 'b1', partId: 'foundation' })
    await send({ type: 'building-claim', orderId: 'b1:foundation' })
    while (runtime.getUiSnapshot().activity !== 'building') step()
    await vi.waitFor(async () => expect((await readRecord('current')).data.construction.jobs[0].phase).toBe('building'))
    expect((await readRecord('current')).data.production.inventory.board[8].instanceId).toBeNull()
    while (runtime.getSaveData().construction.jobs.length) step()
    await vi.waitFor(async () => expect((await readRecord('current')).data.construction.xp).toBe(10))
    expect(validateSave(await readRecord('current'), world, catalog).data.construction.buildings[0].parts.foundation.built).toBe(true)
  })
  it('acknowledges a command as saved only after committing the same inventory and world snapshot', async () => {
    const repo = await repository()
    const runtime = new GameRuntime(world, { catalog, repository: repo, now: () => testNow })
    runtime.advanceFrame(0)
    const id = runtime.getUiSnapshot().production!.inventory.board[0].instanceId!
    const result = runtime.dispatch({ type: 'item-use', instanceId: id })
    runtime.advanceFrame(50)
    expect(await result).toMatchObject({ accepted: true, persisted: true })
    const saved = validateSave(await readRecord('current'), world, catalog)
    expect(saved.data.production.stamina.value).toBe(99)
    const restored = new GameRuntime(world, { catalog, saved, now: () => testNow + 10_000 })
    expect(restored.getUiSnapshot().production!.stamina.value).toBe(100)
    expect(restored.getSceneSnapshot().elapsedSeconds).toBe(saved.data.elapsedSeconds)
    expect(restored.getUiSnapshot().production!.inventory).toEqual(saved.data.production.inventory)
  })
  it('pauses on storage failure, preserves the accepted item change and retries without generating twice', async () => {
    const repo = await repository()
    vi.spyOn(repo, 'save').mockRejectedValueOnce(new Error('QuotaExceededError'))
    const runtime = new GameRuntime(world, { catalog, repository: repo, now: () => testNow })
    runtime.advanceFrame(0)
    const id = runtime.getUiSnapshot().production!.inventory.board[0].instanceId!
    const before = Object.keys(runtime.getUiSnapshot().production!.inventory.items).length
    const result = runtime.dispatch({ type: 'item-use', instanceId: id })
    runtime.advanceFrame(50)
    expect(await result).toMatchObject({ accepted: true, persisted: false })
    expect(runtime.getUiSnapshot().pauseReasons).toContain('save-error')
    expect(await runtime.dispatch({ type: 'item-use', instanceId: id })).toMatchObject({ accepted: false })
    expect(await runtime.retrySave()).toBe(true)
    expect(runtime.getUiSnapshot().pauseReasons).not.toContain('save-error')
    const saved = validateSave(await readRecord('current'), world, catalog)
    expect(Object.keys(saved.data.production.inventory.items)).toHaveLength(before + 1)
    expect(saved.data.production.stamina.value).toBe(99)
  })
  it('restores partially completed movement without simulating offline world time', async () => {
    const repo = await repository()
    const runtime = new GameRuntime(world, { catalog, repository: repo, now: () => testNow })
    runtime.advanceFrame(0)
    const move = runtime.dispatch({ type: 'move', target: { x: 9, y: 9 } })
    runtime.advanceFrame(50); await move
    runtime.advanceFrame(150); await runtime.checkpoint()
    const saved = validateSave(await readRecord('current'), world, catalog)
    const restored = new GameRuntime(world, { catalog, saved, now: () => testNow + 86_400_000 })
    expect(restored.getSceneSnapshot().position).toEqual(runtime.getSceneSnapshot().position)
    expect(restored.getSceneSnapshot().elapsedSeconds).toBe(runtime.getSceneSnapshot().elapsedSeconds)
    restored.advanceFrame(0)
    for (let time = 50; time <= 1000; time += 50) restored.advanceFrame(time)
    expect(restored.getUiSnapshot().player).toEqual({ x: 9, y: 9 })
  })
  it('validates before import, and commits a valid restore before replacing live state', async () => {
    const repo = await repository()
    const runtime = new GameRuntime(world, { catalog, repository: repo, now: () => testNow })
    await runtime.checkpoint()
    const before = runtime.exportSave()
    await expect(runtime.importSave('{bad-json')).rejects.toThrow('JSON')
    expect(runtime.exportSave()).toBe(before)
    const imported = envelopeFixture()
    imported.data.production.stamina.value = 140
    expect(await runtime.importSave(JSON.stringify(imported))).toBe(true)
    expect(runtime.getUiSnapshot().production!.stamina.value).toBe(140)
    expect(validateSave(await readRecord('current'), world, catalog).data.production.stamina.value).toBe(140)
  })
})
