import { describe, expect, it } from 'vitest'
import { BLUEPRINTS } from './buildingConfig'
import { GameRuntime, type GameCommand } from './GameRuntime'
import { exchangeItems } from './inventory'
import { CHAPTERS } from './progressionConfig'
import { createProgression, validateProgressionCatalog } from './progression'
import { m4ConfigVersion, validateSave, type RuntimeData } from './saveData'
import { dataFixture, envelopeFixture, productionFixture, testNow, worldFixture } from './testFixtures'

const world = worldFixture(), catalog = productionFixture()
function harness(data = dataFixture()) {
  let now = testNow, frame = 0
  const runtime = new GameRuntime(world, { catalog, saved: envelopeFixture(data), now: () => now })
  runtime.advanceFrame(0)
  const pump = (seconds: number) => { for (let i = 0; i < Math.round(seconds * 20); i++) { frame += 50; now += 50; runtime.advanceFrame(frame) } }
  const send = async (command: GameCommand) => { const pending = runtime.dispatch(command); pump(.05); return pending }
  return { runtime, pump, send }
}
function cabin(data: RuntimeData) {
  data.construction.buildings = [{ id: 'b1', blueprintId: 'cabin', origin: { x: 7, y: 10 }, rotation: 0,
    parts: Object.fromEntries(BLUEPRINTS[0].parts.map(p => [p.id, { built: true, hp: p.hp, xpGranted: true }])) }]
  data.construction.xp = 70; data.construction.nextId = 2
}
function completePrefix(data: RuntimeData, count: number) {
  for (const chapter of CHAPTERS.slice(0, count)) {
    data.progression.completed.push(chapter.id); data.progression.choices[chapter.id] = chapter.choices[0].id
    if (chapter.decor) data.progression.ownedDecor.push(chapter.decor)
    if (chapter.outfit) data.progression.ownedOutfits.push(chapter.outfit)
  }
  if (count > 3) { data.progression.unlockedRegions.push('brook'); data.progression.discoveries.push('brook') }
  if (count > 5) { data.progression.unlockedRegions.push('grove'); data.progression.discoveries.push('grove') }
}
async function readChapter(runtime: GameRuntime, id: string, choice = 0) {
  const chapter = CHAPTERS.find(c => c.id === id)!
  expect(await runtime.dispatch({ type: 'story-open', chapterId: id })).toMatchObject({ accepted: true })
  for (let line = 0; line < chapter.lines.length - 1; line++) expect(await runtime.dispatch({ type: 'story-next', chapterId: id, line })).toMatchObject({ accepted: true })
  return runtime.dispatch({ type: 'story-choice', chapterId: id, choiceId: chapter.choices[choice].id })
}

describe('M5 persistent first chapter', () => {
  it('validates every production prerequisite against reachable initial sources', () => {
    expect(() => validateProgressionCatalog(world, catalog)).not.toThrow()
    const broken = { ...catalog, initialBoard: catalog.initialBoard.map(slot => ({ ...slot, itemId: null })) }
    expect(() => validateProgressionCatalog(world, broken)).toThrow('来源')
  })
  it('persists the exact dialogue page, pauses the world but recovers stamina, and rejects stale next/choices', async () => {
    const data = dataFixture(); data.production.stamina.value = 90
    const { runtime, pump } = harness(data)
    expect(await runtime.dispatch({ type: 'story-open', chapterId: 'foundation' })).toMatchObject({ accepted: false })
    await runtime.dispatch({ type: 'story-open', chapterId: 'letter' })
    await runtime.dispatch({ type: 'story-next', chapterId: 'letter', line: 0 })
    expect(await runtime.dispatch({ type: 'story-next', chapterId: 'letter', line: 0 })).toMatchObject({ accepted: false })
    const elapsed = runtime.getSceneSnapshot().elapsedSeconds, hunger = runtime.getSaveData().production.vitals.hunger
    pump(20)
    expect(runtime.getSaveData().production.stamina.value).toBe(92)
    expect(runtime.getSceneSnapshot().elapsedSeconds).toBe(elapsed)
    expect(runtime.getSaveData().production.vitals.hunger).toBe(hunger)
    expect(await runtime.dispatch({ type: 'item-use', instanceId: 'i1' })).toMatchObject({ accepted: false })
    const saved = validateSave(JSON.parse(runtime.exportSave()), world, catalog)
    const restored = harness(saved.data).runtime
    expect(restored.getUiSnapshot().pauseReasons).toContain('story')
    expect(restored.getUiSnapshot().progression.dialogue?.line).toBe(1)
    await restored.dispatch({ type: 'story-next', chapterId: 'letter', line: 1 })
    expect(await restored.dispatch({ type: 'story-choice', chapterId: 'letter', choiceId: 'truth' })).toMatchObject({ accepted: true })
    expect(await restored.dispatch({ type: 'story-choice', chapterId: 'letter', choiceId: 'home' })).toMatchObject({ accepted: false })
    expect(restored.getUiSnapshot().progression.choices.letter).toBe('truth')
    expect(restored.getUiSnapshot().pauseReasons).not.toContain('story')
  })
  it('cancels reading without completing or granting, and grants decor only once after the real objective', async () => {
    const { runtime } = harness()
    await runtime.dispatch({ type: 'story-open', chapterId: 'letter' }); await runtime.dispatch({ type: 'story-close' })
    expect(runtime.getUiSnapshot().progression.completed).toEqual([])
    await readChapter(runtime, 'letter')
    expect(await runtime.dispatch({ type: 'story-open', chapterId: 'foundation' })).toMatchObject({ accepted: false })
    const data = runtime.getSaveData(); cabin(data)
    const built = harness(data).runtime
    expect(await readChapter(built, 'foundation')).toMatchObject({ accepted: true })
    expect(built.getSaveData().progression.ownedDecor).toEqual(['rug'])
    expect(await built.dispatch({ type: 'story-open', chapterId: 'foundation' })).toMatchObject({ accepted: false })
    validateSave(JSON.parse(built.exportSave()), world, catalog)
  })
  it('atomically consumes cross-storage supplies and grants a generator to the board; full board leaves everything intact', async () => {
    const data = dataFixture(); cabin(data); completePrefix(data, 3)
    data.progression.unlockedRegions = ['brook']; data.progression.discoveries = ['brook']
    expect(exchangeItems(data.production.inventory, catalog, [], [212, 222])).toBe(true)
    const items = Object.values(data.production.inventory.items).filter(i => [212, 222].includes(i.itemId))
    items.forEach((item, i) => { data.production.inventory.board[item.location.index].instanceId = null; item.location = { kind: 'warehouse', index: i }; data.production.inventory.warehouse[i] = item.id })
    while (data.production.inventory.board.some(s => s.lock === 0 && !s.instanceId)) exchangeItems(data.production.inventory, catalog, [], [201])
    const { runtime } = harness(data)
    const before = runtime.getSaveData().production.inventory
    expect(await readChapter(runtime, 'visitor', 1)).toMatchObject({ accepted: false })
    expect(runtime.getSaveData().production.inventory).toEqual(before)
    await runtime.dispatch({ type: 'story-close' })
    const free = runtime.getSaveData(), id = free.production.inventory.board[7].instanceId!
    free.production.inventory.board[7].instanceId = null; delete free.production.inventory.items[id]
    const resumed = harness(free).runtime
    expect(await readChapter(resumed, 'visitor', 1)).toMatchObject({ accepted: true })
    const saved = resumed.getSaveData()
    expect(saved.production.inventory.warehouse.slice(0, 2)).toEqual([null, null])
    expect(Object.values(saved.production.inventory.items).filter(i => i.itemId === 102)).toHaveLength(1)
    expect(saved.progression.choices.visitor).toBe('ask')
    expect(saved.progression.ownedDecor).toContain('planter')
    validateSave(JSON.parse(resumed.exportSave()), world, catalog)
  })
  it('unlocks navigation without mutating the catalog, discovers the landmark and reloads outside the starting camp', async () => {
    const data = dataFixture(); cabin(data); completePrefix(data, 3)
    const { runtime, pump, send } = harness(data)
    expect(await send({ type: 'region-unlock', regionId: 'grove' })).toMatchObject({ accepted: false })
    expect(await send({ type: 'region-unlock', regionId: 'brook' })).toMatchObject({ accepted: true })
    expect(await send({ type: 'region-unlock', regionId: 'brook' })).toMatchObject({ accepted: false })
    expect(world.isWalkable({ x: 7, y: -5 })).toBe(false)
    expect(runtime.world.isWalkable({ x: 7, y: -5 })).toBe(true)
    await send({ type: 'move', target: { x: 7, y: -5 } }); pump(10)
    expect(runtime.getUiSnapshot().player).toEqual({ x: 7, y: -5 })
    expect(runtime.getSaveData().progression.discoveries).toEqual(['brook'])
    const saved = validateSave(JSON.parse(runtime.exportSave()), world, catalog)
    const restored = harness(saved.data)
    expect(restored.runtime.world.isWalkable(saved.data.cell)).toBe(true)
    expect(await restored.send({ type: 'building-place', blueprintId: 'cabin', origin: { x: 6, y: -8 }, rotation: 0 })).toMatchObject({ accepted: true })
  })
  it('keeps cosmetic ownership separate, validates floor placement, and retains it through defeat and rescue', async () => {
    const data = dataFixture(); cabin(data); completePrefix(data, 3)
    const { runtime, send } = harness(data)
    expect(await send({ type: 'outfit-equip', outfitId: 'rose' })).toMatchObject({ accepted: false })
    expect(await send({ type: 'outfit-equip', outfitId: 'sage' })).toMatchObject({ accepted: true })
    expect(await send({ type: 'decor-place', kind: 'rug', cell: { x: 6, y: 8 } })).toMatchObject({ accepted: false })
    expect(await send({ type: 'decor-place', kind: 'rug', cell: { x: 7, y: 11 } })).toMatchObject({ accepted: false })
    expect(await send({ type: 'decor-place', kind: 'rug', cell: { x: 8, y: 10 } })).toMatchObject({ accepted: true })
    expect(await send({ type: 'decor-place', kind: 'rug', cell: { x: 9, y: 10 } })).toMatchObject({ accepted: true })
    const before = runtime.getSaveData().progression
    expect(before.decorations).toHaveLength(1)
    runtime.applyDamage('player', 100); await runtime.dispatch({ type: 'rescue' })
    expect(runtime.getSaveData().progression).toEqual(before)
    validateSave(JSON.parse(runtime.exportSave()), world, catalog)
    const resumed = harness(runtime.getSaveData())
    expect(await resumed.send({ type: 'decor-remove', kind: 'rug' })).toMatchObject({ accepted: true })
    expect(resumed.runtime.getSaveData().progression.ownedDecor).toEqual(['rug'])
  })
  it('counts natural dawn but not rescue, and migrates exact M4 saves without changing simulation state', async () => {
    const old = envelopeFixture(); old.data.elapsedSeconds = 1199.95
    const legacy = { ...old, schemaVersion: 3, configVersion: m4ConfigVersion(world, catalog), data: { ...old.data } as Partial<RuntimeData> }
    delete legacy.data.progression
    const migrated = validateSave(legacy, world, catalog)
    expect(migrated.schemaVersion).toBe(4)
    expect(migrated.data.survival).toEqual(old.data.survival)
    expect(migrated.data.production).toEqual(old.data.production)
    expect(migrated.data.progression).toEqual(createProgression())
    const { runtime, pump } = harness(migrated.data); pump(.1)
    expect(runtime.getSaveData().progression.witnessedDawn).toBe(true)
    const failed = harness(); failed.runtime.applyDamage('player', 100); await failed.runtime.dispatch({ type: 'rescue' })
    expect(failed.runtime.getSaveData().progression.witnessedDawn).toBe(false)
  })
  it('rejects forged regions, cosmetic ownership, out-of-order chapters and invalid dialogue cursors', () => {
    const save = envelopeFixture()
    for (const edit of [
      (d: RuntimeData) => { d.progression.unlockedRegions = ['grove'] },
      (d: RuntimeData) => { d.progression.ownedDecor = ['rug'] },
      (d: RuntimeData) => { d.progression.completed = ['friend'] },
      (d: RuntimeData) => { d.progression.dialogue = { chapterId: 'letter', line: 999 } },
    ]) { const bad = structuredClone(save); edit(bad.data); expect(() => validateSave(bad, world, catalog)).toThrow('存档校验失败') }
  })
})
