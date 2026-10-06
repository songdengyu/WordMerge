import { describe, expect, it } from 'vitest'
import { GameRuntime, type GameCommand } from './GameRuntime'
import { createEconomy, spendMovementNeeds } from './economy'
import { RESOURCE_RULES } from './economyConfig'
import { exchangeItems } from './inventory'
import { validateSave } from './saveData'
import { dataFixture, envelopeFixture, productionFixture, testNow, worldFixture } from './testFixtures'
import { BLUEPRINTS } from './buildingConfig'
import { actorPosition } from './survival'
import { REGION_BOARS } from './regionContentConfig'
import { pointDistance } from './smoothNavigation'

const world = worldFixture(), catalog = productionFixture()
function harness(data = dataFixture()) {
  const runtime = new GameRuntime(world, { catalog, saved: envelopeFixture(data), now: () => testNow })
  let time = 0; runtime.advanceFrame(0)
  const pump = (seconds: number) => { for (let i = 0; i < Math.round(seconds * 20); i++) runtime.advanceFrame(time += 50) }
  const send = async (command: GameCommand) => { const pending = runtime.dispatch(command); pump(.05); return pending }
  const valid = () => validateSave(JSON.parse(runtime.exportSave()), world, catalog).data
  return { runtime, pump, send, valid }
}
function treeReady() {
  const data = dataFixture(); data.cell = { x: 5, y: 6 }
  expect(exchangeItems(data.production.inventory, catalog, [], [252])).toBe(true)
  return data
}
function fullHouse(data: ReturnType<typeof dataFixture>) {
  const blueprint = BLUEPRINTS[0]
  data.construction.buildings = [{ id: 'b1', blueprintId: 'cabin', origin: { x: 7, y: 10 }, rotation: 0,
    parts: Object.fromEntries(blueprint.parts.map(p => [p.id, { built: true, hp: p.hp, xpGranted: true }])) }]
  data.construction.nextId = 2; data.construction.xp = 70
}

describe('resource clearing, shops and action needs', () => {
  it('creates one tool order without costs and reserves/relinquishes tools during travel', async () => {
    const h = harness(), before = h.valid().production
    expect(await h.send({ type: 'resource-interact', objectId: 't08' })).toMatchObject({ accepted: true, openProduction: true })
    await h.send({ type: 'resource-interact', objectId: 't08' })
    expect(h.valid().economy!.clearingOrders).toEqual(['t08'])
    expect(h.valid().production.inventory).toEqual(before.inventory)
    const data = h.valid(); exchangeItems(data.production.inventory, catalog, [], [252])
    const travel = harness(data), tool = Object.values(data.production.inventory.items).find(i => i.itemId === 252)!
    await travel.send({ type: 'resource-interact', objectId: 't08' })
    expect(travel.valid().economy!.clearing).toMatchObject({ phase: 'travel', reservedIds: [tool.id] })
    expect(await travel.send({ type: 'item-discard', instanceId: tool.id })).toMatchObject({ accepted: false })
    const restored = harness(travel.valid())
    await restored.send({ type: 'resource-cancel', objectId: 't08' })
    expect(restored.valid().production.inventory.items[tool.id].reservedBy).toBeNull()
    expect(restored.valid().economy!.clearing).toBeNull()
  })
  it('charges one tool and one need tier on arrival, protects two seconds, clears collision and rewards exactly once after reload', async () => {
    const data = treeReady(), h = harness(data)
    const tool = Object.values(data.production.inventory.items).find(i => i.itemId === 252)!
    await h.send({ type: 'resource-interact', objectId: 't08' })
    expect(h.valid().economy!.clearing).toMatchObject({ phase: 'clearing', remaining: 2, reservedIds: [] })
    expect(h.valid().production.inventory.items[tool.id]).toBeUndefined()
    expect(h.valid().production.vitals.hunger).toBeCloseTo(59 - .05 * 60 / 1200)
    expect(h.valid().production.vitals.water).toBeCloseTo(59 - .05 * 80 / 1200)
    h.runtime.applyDamage('player', 100); expect(h.valid().production.vitals.hp).toBe(100)
    expect(await h.send({ type: 'resource-cancel', objectId: 't08' })).toMatchObject({ accepted: false })
    expect(await h.send({ type: 'building-place', blueprintId: 'cabin', origin: { x: 7, y: 10 }, rotation: 0 })).toMatchObject({ accepted: false })
    h.pump(.7)
    const saved = h.valid(), restored = harness(saved)
    restored.runtime.setPauseReason('background', true); restored.pump(3)
    expect(restored.valid().economy).toEqual(saved.economy)
    restored.runtime.setPauseReason('background', false); restored.pump(1.1)
    expect(restored.runtime.world.objectAt({ x: 4, y: 6 })?.id).toBe('t08')
    restored.pump(.3)
    const finished = restored.valid()
    expect(finished.economy!.removedObjects).toEqual(['t08'])
    expect(finished.production.inventory.gold).toBe(25); expect(finished.production.inventory.gems).toBe(101)
    expect(Object.values(finished.production.inventory.items).filter(i => i.itemId === 203)).toHaveLength(1)
    expect(restored.runtime.world.isWalkable({ x: 4, y: 6 })).toBe(true)
    const again = harness(finished)
    expect(await again.send({ type: 'resource-interact', objectId: 't08' })).toMatchObject({ accepted: false })
    expect(again.valid().production.inventory).toEqual(finished.production.inventory)
    expect(await again.send({ type: 'move', target: { x: 4, y: 6 } })).toMatchObject({ accepted: true })
    again.pump(.5); expect(again.valid().cell).toEqual({ x: 4, y: 6 })
  })
  it('retains material rewards when inventory fills during work and claims them once', async () => {
    const h = harness(treeReady()); await h.send({ type: 'resource-interact', objectId: 't08' })
    const data = h.valid()
    while (exchangeItems(data.production.inventory, catalog, [], [201])) { /* Fill unlocked board and warehouse. */ }
    const full = harness(data); full.pump(2)
    expect(full.valid().economy!.pendingLoot).toEqual(['t08'])
    const before = full.valid().production.inventory
    expect(await full.send({ type: 'loot-claim', objectId: 't08' })).toMatchObject({ accepted: false })
    expect(full.valid().production.inventory).toEqual(before)
    const branch = Object.values(before.items).find(i => i.itemId === 201 && i.location.kind === 'warehouse')!
    await full.send({ type: 'item-discard', instanceId: branch.id })
    expect(await full.send({ type: 'loot-claim', objectId: 't08' })).toMatchObject({ accepted: true })
    expect(full.valid().economy!.pendingLoot).toEqual([])
    expect(await full.send({ type: 'loot-claim', objectId: 't08' })).toMatchObject({ accepted: false })
    expect(full.valid().production.inventory.gold).toBe(25)
  })
  it('clears stone with a pickaxe and awards configured diamonds and high-level supplies', async () => {
    const data = dataFixture(); data.cell = { x: 5, y: 9 }; exchangeItems(data.production.inventory, catalog, [], [262])
    const h = harness(data); await h.send({ type: 'resource-interact', objectId: 'r03' }); h.pump(2)
    const saved = h.valid()
    expect(saved.economy!.removedObjects).toEqual(['r03'])
    expect(saved.production.inventory.gold).toBe(RESOURCE_RULES.boulder.gold)
    expect(saved.production.inventory.gems).toBe(100 + RESOURCE_RULES.boulder.gems)
    expect(saved.economy!.pendingLoot).toEqual([])
  })
  it('sells permanent blueprints/clothes/decor atomically, rejects insufficient money and duplicate purchases, and persists ownership', async () => {
    const data = dataFixture(); data.production.inventory.gold = 400
    const h = harness(data)
    expect(await h.send({ type: 'shop-buy', productId: 'starter-tools' })).toMatchObject({ accepted: true })
    expect(Object.values(h.valid().production.inventory.items).some(i => i.itemId === 141)).toBe(true)
    expect(await h.send({ type: 'shop-buy', productId: 'starter-tools' })).toMatchObject({ accepted: false })
    for (const productId of ['garden-blueprint', 'guest-blueprint', 'rug', 'rose']) expect(await h.send({ type: 'shop-buy', productId })).toMatchObject({ accepted: true })
    expect(h.valid().production.inventory).toMatchObject({ gold: 190, gems: 68 })
    expect(h.valid().construction.unlockedBlueprints).toEqual(['cabin', 'garden-cabin', 'guest-cabin'])
    expect(h.valid().progression.ownedDecor).toEqual(['rug'])
    await h.send({ type: 'outfit-equip', outfitId: 'rose' })
    expect(h.valid().progression.outfit).toBe('rose')
    expect(await h.send({ type: 'shop-buy', productId: 'garden-blueprint' })).toMatchObject({ accepted: false })
    await h.send({ type: 'shop-buy', productId: 'sage' })
    expect(await h.send({ type: 'shop-buy', productId: 'planter' })).toMatchObject({ accepted: false })
    expect(h.valid().production.inventory.gold).toBe(70)
    const restored = harness(h.valid())
    expect(await restored.send({ type: 'building-place', blueprintId: 'garden-cabin', origin: { x: 7, y: 10 }, rotation: 0 })).toMatchObject({ accepted: true })
    restored.valid()
    const forged = envelopeFixture(restored.valid()); forged.data.economy!.purchases = []
    expect(() => validateSave(forged, world, catalog)).toThrow('蓝图来源')
  })
  it('rejects duplicate same-step purchases and leaves a full-board free generator claim available', async () => {
    const data = dataFixture()
    while (exchangeItems(data.production.inventory, catalog, [], [201])) { /* Full inventory. */ }
    const full = harness(data)
    expect(await full.send({ type: 'shop-buy', productId: 'starter-tools' })).toMatchObject({ accepted: false })
    expect(full.valid().economy!.purchases).toEqual([])
    const h = harness(), first = h.runtime.dispatch({ type: 'shop-buy', productId: 'rose' }), second = h.runtime.dispatch({ type: 'shop-buy', productId: 'rose' })
    h.pump(.05)
    expect(await first).toMatchObject({ accepted: true }); expect(await second).toMatchObject({ accepted: false })
    expect(h.valid().production.inventory.gems).toBe(88)
  })
  it('obtains both tools through the free generator and real two-item merges', async () => {
    const h = harness(); await h.send({ type: 'shop-buy', productId: 'starter-tools' })
    const generator = Object.values(h.valid().production.inventory.items).find(i => i.itemId === 141)!
    for (const [part, tool] of [[251, 252], [261, 262]]) {
      const pieces = () => Object.values(h.valid().production.inventory.items).filter(i => i.itemId === part)
      for (let i = 0; i < 20 && pieces().length < 2; i++) await h.send({ type: 'item-use', instanceId: generator.id })
      const [a, b] = pieces(); expect(a).toBeTruthy(); expect(b.location.kind).toBe('board')
      expect(await h.send({ type: 'item-move', instanceId: a.id, targetIndex: b.location.index, expectedTarget: b.id })).toMatchObject({ accepted: true })
      expect(Object.values(h.valid().production.inventory.items).some(i => i.itemId === tool)).toBe(true)
    }
  })
  it('charges actual accumulated walking distance across save/load, not clicks or idle time', async () => {
    const data = dataFixture(); data.cell = { x: 7, y: 9 }; data.economy!.distanceRemainder = 9.5
    const h = harness(data)
    await h.send({ type: 'move', target: { x: 7.25, y: 9 } }); h.pump(.05)
    expect(h.valid().economy!.distanceRemainder).toBeCloseTo(9.75)
    const restored = harness(h.valid())
    await restored.send({ type: 'move', target: { x: 7.5, y: 9 } }); restored.pump(.05)
    expect(restored.valid().economy!.distanceRemainder).toBeCloseTo(0)
    expect(restored.valid().production.vitals.hunger).toBeCloseTo(59 - .2 * 60 / 1200)
    restored.pump(1); expect(restored.valid().economy!.distanceRemainder).toBeCloseTo(0)
    const economy = createEconomy(), production = dataFixture().production
    spendMovementNeeds(economy, production, 25.2)
    expect(economy.distanceRemainder).toBeCloseTo(5.2); expect(production.vitals).toMatchObject({ hunger: 58, water: 58 })
  })
  it('migrates pre-economy saves without resetting inventory/needs/buildings and rejects forged removal records', () => {
    const old = envelopeFixture(); delete old.data.economy
    old.configVersion = old.configVersion.replace(catalog.fingerprint, 'e98b4c81')
    const migrated = validateSave(old, world, catalog)
    expect(migrated.data.production).toEqual(old.data.production)
    expect(migrated.data.construction).toEqual(old.data.construction)
    expect(migrated.data.economy).toEqual(createEconomy())
    expect(validateSave(migrated, world, catalog)).toEqual(migrated)
    const lfSave = structuredClone(old); lfSave.configVersion = lfSave.configVersion.replace('e98b4c81', '9da8a62d')
    expect(validateSave(lfSave, world, catalog)).toEqual(migrated)
    for (const ids of [['missing'], ['t08', 't08'], ['brook-t1']]) {
      const bad = structuredClone(migrated); bad.data.economy!.removedObjects = ids
      expect(() => validateSave(bad, world, catalog)).toThrow('清理记录')
    }
    const bad = structuredClone(migrated); bad.data.economy!.distanceRemainder = 10
    expect(() => validateSave(bad, world, catalog)).toThrow('累计距离')
  })
  it('charges construction and repair once at start, and charges neither order creation nor cancellation', async () => {
    const data = dataFixture(); data.cell = { x: 8, y: 11 }
    const h = harness(data); await h.send({ type: 'building-place', blueprintId: 'cabin', origin: { x: 7, y: 10 }, rotation: 0 })
    await h.send({ type: 'building-interact', buildingId: 'b1', partId: 'foundation' })
    expect(h.valid().production.vitals.hunger).toBeCloseTo(60 - .1 * 60 / 1200)
    const supplied = h.valid(); exchangeItems(supplied.production.inventory, catalog, [], [202])
    const work = harness(supplied); await work.send({ type: 'building-interact', buildingId: 'b1', partId: 'foundation' })
    const started = work.valid().production.vitals.hunger
    expect(started).toBeCloseTo(59 - .15 * 60 / 1200)
    work.pump(2); expect(work.valid().production.vitals.hunger).toBeCloseTo(started - 2 * 60 / 1200)
    work.runtime.applyDamage({ buildingId: 'b1', partId: 'foundation', segmentId: 'tile1-1' }, 10)
    await work.send({ type: 'building-interact', buildingId: 'b1', partId: 'foundation', segmentId: 'tile1-1' })
    expect(work.valid().production.vitals.hunger).toBeCloseTo(started - 1 - 2.05 * 60 / 1200)
  })
  it('wildlife patrols around its home, pauses between legs and keeps its state after reload', () => {
    const data = dataFixture(); fullHouse(data); data.progression.unlockedRegions = ['brook']
    const h = harness(data), initial = h.valid().survival.enemies.map(actorPosition), visited = new Set<string>()
    let waiting = false
    for (let i = 0; i < 140; i++) {
      h.pump(.1)
      h.runtime.getSaveData().survival.enemies.forEach((enemy, index) => {
        const spawn = REGION_BOARS[index], point = actorPosition(enemy)
        expect(Math.max(Math.abs(point.x - spawn.cell.x), Math.abs(point.y - spawn.cell.y))).toBeLessThanOrEqual(2.0001)
        expect(h.runtime.world.chunkAt(enemy.cell)?.id).toBe('brook')
        if (index === 0) visited.add(`${point.x.toFixed(1)},${point.y.toFixed(1)}`)
        waiting ||= (enemy.patrol?.remaining ?? 0) > 0
      })
    }
    expect(visited.size).toBeGreaterThan(10); expect(waiting).toBe(true)
    expect(h.valid().survival.enemies.some((e, i) => pointDistance(actorPosition(e), initial[i]) > .2)).toBe(true)
    const restored = harness(h.valid()); expect(restored.valid().survival.enemies).toEqual(h.valid().survival.enemies)
  })
})
