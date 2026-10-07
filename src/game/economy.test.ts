import { expect, it } from 'vitest'
import { BLUEPRINTS } from './buildingConfig'
import { GameRuntime, type GameCommand } from './GameRuntime'
import { availableItems } from './inventory'
import { CHAPTERS } from './progressionConfig'
import { validateSave } from './saveData'
import { productionFixture, testNow, worldFixture } from './testFixtures'

it('supports three online days from the actual starter inventory with two-minute care intervals and no stamina gifts', async () => {
  const world = worldFixture(), catalog = productionFixture()
  let now = testNow, frame = 0, maintenance = false
  const costs = [0, 0, 0], upkeep = [0, 0, 0]
  const runtime = new GameRuntime(world, { catalog, now: () => now }); runtime.advanceFrame(0)
  const pump = (seconds: number) => { for (let i = 0; i < Math.round(seconds * 20); i++) { frame += 50; now += 50; runtime.advanceFrame(frame) } }
  const send = async (command: GameCommand) => {
    // Smooth pursuit changes contact times; care/orders still wait for the locked combat presentation.
    if (command.type === 'companion-treat' || command.type === 'companion-mode') {
      for (let i = 0; i < 200 && runtime.getSaveData().survival.duel; i++) pump(.05)
    }
    const pending = runtime.dispatch(command); pump(.1)
    const result = await pending
    expect(result, `command ${command.type}`).toMatchObject({ accepted: true })
  }
  const items = (id: number) => availableItems(runtime.getSaveData().production.inventory).filter(i => i.itemId === id)
  const readChapter = async (id: string) => {
    const chapter = CHAPTERS.find(c => c.id === id)!
    expect(await runtime.dispatch({ type: 'story-open', chapterId: id })).toMatchObject({ accepted: true })
    for (let line = 0; line < chapter.lines.length - 1; line++) expect(await runtime.dispatch({ type: 'story-next', chapterId: id, line })).toMatchObject({ accepted: true })
    expect(await runtime.dispatch({ type: 'story-choice', chapterId: id, choiceId: chapter.choices[0].id })).toMatchObject({ accepted: true })
  }
  const ensure = async (itemId: number, count = 1): Promise<void> => {
    for (let tries = 0; items(itemId).length < count; tries++) {
      expect(tries).toBeLessThan(100)
      const previous = catalog.items.find(item => item.nextId === itemId)
      if (previous) {
        await ensure(previous.id, 2)
        const [a, b] = items(previous.id)
        expect(b.location.kind).toBe('board')
        await send({ type: 'item-move', instanceId: a.id, targetIndex: b.location.index, expectedTarget: b.id })
      } else {
        const chain = catalog.itemById.get(itemId)!.chain
        const sourceChain: Record<number, number> = { 5: 1, 6: 2, 7: 3, 8: 4 }
        const generator = availableItems(runtime.getSaveData().production.inventory).filter(i => catalog.itemById.get(i.itemId)?.chain === sourceChain[chain])
          .sort((a, b) => catalog.itemById.get(b.itemId)!.level - catalog.itemById.get(a.itemId)!.level)[0]
        const day = Math.min(2, Math.floor(runtime.getSaveData().elapsedSeconds / 1200)), cost = catalog.itemById.get(generator.itemId)!.openCost!
        costs[day] += cost; if (maintenance) upkeep[day] += cost
        await send({ type: 'item-use', instanceId: generator.id })
      }
    }
  }
  await ensure(213)
  await send({ type: 'companion-rescue' })
  pump(2)
  await send({ type: 'building-place', blueprintId: 'cabin', origin: { x: 7, y: 10 }, rotation: 0 })
  for (const part of BLUEPRINTS[0].parts) {
    for (const id of new Set(part.materials)) await ensure(id, part.materials.filter(other => other === id).length)
    await send({ type: 'building-interact', buildingId: 'b1', partId: part.id })
    for (let i = 0; i < 300 && !runtime.getSaveData().construction.buildings[0].parts[part.id].built; i++) pump(.1)
    expect(runtime.getSaveData().construction.buildings[0].parts[part.id].built).toBe(true)
  }
  for (const id of ['letter', 'foundation', 'friend']) await readChapter(id)
  await send({ type: 'region-unlock', regionId: 'brook' })
  pump(15)
  expect(runtime.getSaveData().progression.regionUnlock).toBeNull()
  await send({ type: 'move', target: { x: 7, y: -5 } }); pump(15)
  await ensure(212); await ensure(222); await readChapter('visitor'); await readChapter('shelter')
  await send({ type: 'region-unlock', regionId: 'grove' })
  pump(20)
  expect(runtime.getSaveData().progression.regionUnlock).toBeNull()
  await send({ type: 'move', target: { x: 21, y: 8 } }); pump(20)
  await readChapter('grove')
  await send({ type: 'decor-place', kind: 'rug', cell: { x: 8, y: 10 } })
  await send({ type: 'outfit-equip', outfitId: 'rose' })
  await send({ type: 'move', target: { x: 8, y: 11 } }); pump(15)
  maintenance = true
  while (runtime.getSaveData().elapsedSeconds < 3600) {
    const state = runtime.getSaveData()
    expect(state.survival.failure, `failed on day ${runtime.getUiSnapshot().day}`).toBeNull()
    for (const [stat, itemId, threshold] of [['hunger', 212, 50], ['water', 222, 50], ['hp', 232, 80]] as const) {
      if (state.production.vitals[stat] < threshold) { await ensure(itemId); await send({ type: 'item-use', instanceId: items(itemId)[0].id }) }
    }
    const buddy = runtime.getSaveData().survival.companion
    if (buddy.status === 'injured' || (buddy.status === 'active' && buddy.hp < 90)) {
      await ensure(232); await send({ type: 'companion-treat' })
    }
    if (buddy.status === 'active') await send({ type: 'companion-mode', mode: 'guard', guard: { x: 8, y: 11 } })
    for (const config of BLUEPRINTS[0].parts) {
      const part = runtime.getSaveData().construction.buildings[0].parts[config.id]
      if (part.hp < config.hp && !runtime.getSaveData().construction.jobs.some(job => job.orderId === `b1:${config.id}`)) {
        for (const id of new Set(config.repairMaterials)) await ensure(id, config.repairMaterials.filter(other => other === id).length)
        await send({ type: 'building-interact', buildingId: 'b1', partId: config.id })
      }
    }
    pump(Math.min(120, 3600.05 - runtime.getSaveData().elapsedSeconds))
  }
  const saved = runtime.getSaveData()
  expect(saved.survival.failure).toBeNull()
  expect(runtime.getUiSnapshot()).toMatchObject({ day: 4, hour: world.config.initialHour })
  expect(saved.survival.nextEnemyId).toBeGreaterThan(15)
  expect(saved.survival.enemies.filter(enemy => !enemy.residentId)).toHaveLength(0)
  expect(saved.survival.enemies.filter(enemy => enemy.residentId)).toHaveLength(3)
  expect(saved.progression.witnessedDawn).toBe(true)
  expect(saved.production.stamina.value).toBeGreaterThan(0)
  expect(Object.values(saved.production.inventory.items).some(item => item.itemId === 241)).toBe(true)
  expect(saved.production.inventory.completedOrders).toEqual([])
  await readChapter('dawn')
  expect(runtime.getSaveData().progression.completed).toEqual(CHAPTERS.map(c => c.id))
  for (const budget of upkeep) expect(budget).toBeLessThanOrEqual(40)
  validateSave(JSON.parse(runtime.exportSave()), world, catalog)
  console.info('Three-day production stamina:', JSON.stringify({ total: costs, maintenance: upkeep, endingHp: saved.production.vitals.hp, companionHp: saved.survival.companion.hp, endingStamina: saved.production.stamina.value }))
// Simulates 72,000 fixed steps with swept collision checks for all actors.
}, 60_000)
