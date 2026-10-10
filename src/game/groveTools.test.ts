import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { GameRuntime, type GameCommand } from './GameRuntime'
import { blueprintById } from './buildingConfig'
import { createBuildingParts, setSegmentHp } from './buildingSegments'
import { applyInventoryCommand, exchangeItems } from './inventory'
import { resourceTool } from './economy'
import { toolMeets } from './economyConfig'
import { TOOL_CATALOG_VERSIONS, PRE_TOOLS_REGION_VERSION } from './migrations/groveTools'
import { GROVE_STATUE_ID, REGION_CONTENT_VERSION } from './regionContentConfig'
import { validateSave, type SaveEnvelope } from './saveData'
import { dataFixture, envelopeFixture, productionFixture, testNow, worldFixture } from './testFixtures'

const world = worldFixture(), catalog = productionFixture()
const oldSave = () => JSON.parse(readFileSync('tests/fixtures/pre-grove-tools.json', 'utf8')) as SaveEnvelope
function groveSave(old = false) {
  const save = old ? oldSave() : envelopeFixture(), data = save.data
  const cabin = blueprintById('cabin')!, lodge = blueprintById('lodge')!
  data.construction.buildings = [
    { id: 'b1', blueprintId: 'cabin', origin: { x: 7, y: 10 }, rotation: 0,
      parts: Object.fromEntries(cabin.parts.map(p => [p.id, { built: true, hp: old && p.kind === 'wall' ? p.hp / 2 : p.hp, xpGranted: true }])) },
    ...(old ? [{ id: 'b2', blueprintId: 'lodge', origin: { x: 25, y: 3 }, rotation: 0 as const, parts: createBuildingParts(lodge) }] : []),
  ]
  data.construction.xp = 70; data.construction.nextId = old ? 3 : 2
  data.progression.unlockedRegions = ['grove']
  if (old) data.progression.regionContent = { version: PRE_TOOLS_REGION_VERSION, initialized: ['grove'] }
  return save
}
function harness(save = envelopeFixture()) {
  const runtime = new GameRuntime(world, { catalog, saved: validateSave(save, world, catalog), now: () => testNow })
  let time = 0; runtime.advanceFrame(0)
  const pump = (seconds: number) => { for (let i = 0; i < Math.round(seconds * 20); i++) runtime.advanceFrame(time += 50) }
  const send = async (command: GameCommand) => { const pending = runtime.dispatch(command); pump(.05); return pending }
  const valid = () => validateSave(JSON.parse(runtime.exportSave()), world, catalog)
  return { runtime, send, pump, valid }
}

describe('higher tools, discovered foundation, statue and settlement receipts', () => {
  it('merges both chains up to level four with configured visible art', () => {
    const svg = readFileSync('public/assets/survival/items.svg', 'utf8')
    for (const [from, to] of [[252, 253], [253, 254], [262, 263], [263, 264]]) {
      const production = dataFixture().production, inv = production.inventory
      const a = inv.board[7].instanceId!, b = inv.board[8].instanceId!
      inv.items[a].itemId = from; inv.items[b].itemId = from
      const result = applyInventoryCommand(production, catalog, { type: 'item-move', instanceId: a, targetIndex: 8, expectedTarget: b }, testNow)
      if (!result.accepted) throw new Error(result.reason)
      expect(result.state.inventory.items[result.state.inventory.board[8].instanceId!].itemId).toBe(to)
      expect(svg).toContain(`id="${catalog.itemById.get(to)!.iconName}"`)
    }
  })

  it('accepts only same-chain substitutes and selects the lowest available unreserved tool', async () => {
    expect(toolMeets(254, 252)).toBe(true); expect(toolMeets(264, 262)).toBe(true)
    expect(toolMeets(253, 254)).toBe(false); expect(toolMeets(254, 264)).toBe(false)
    const data = dataFixture(); exchangeItems(data.production.inventory, catalog, [], [254, 253, 252, 264])
    expect(resourceTool(data.production, 252)?.itemId).toBe(252)
    const low = resourceTool(data.production, 252)!; low.reservedBy = 'test'
    expect(resourceTool(data.production, 252)?.itemId).toBe(253)
    low.reservedBy = null
    const h = harness(envelopeFixture(data))
    await h.send({ type: 'resource-interact', objectId: 't08' })
    expect(h.valid().data.economy!.clearing?.reservedIds).toEqual([low.id])
    expect(await h.send({ type: 'item-discard', instanceId: low.id })).toMatchObject({ accepted: false })
    const highData = dataFixture(); highData.cell = { x: 5, y: 6 }
    exchangeItems(highData.production.inventory, catalog, [], [254])
    const high = harness(envelopeFixture(highData))
    expect(await high.send({ type: 'resource-interact', objectId: 't08' })).toMatchObject({ accepted: true })
    expect(high.valid().data.economy!.clearing?.phase).toBe('clearing')
    high.pump(2); expect(high.valid().data.economy!.removedObjects).toContain('t08')
  })

  it('discovers a complete floor and one reachable statue without consuming materials, once', () => {
    const h = harness(groveSave()), saved = h.valid(), floor = saved.data.construction.buildings[1].parts.foundation
    expect(floor).toMatchObject({ built: true, hp: 180, xpGranted: true })
    expect(Object.values(floor.segments!)).toEqual(Array(20).fill(180))
    expect(saved.data.construction.xp).toBe(90)
    expect(saved.data.production.inventory).toEqual(groveSave().data.production.inventory)
    expect(h.runtime.world.allObjects().filter(o => o.id === GROVE_STATUE_ID)).toHaveLength(1)
    expect(saved.data.progression.regionContent.statue).toEqual({ x: 23, y: 6 })
    expect(harness(saved).valid().data).toEqual(saved.data)
  })

  it('upgrades actual old catalogs and unbuilt regional floors once, including the earlier wall migration', () => {
    for (const preWall of [false, true]) {
      const old = groveSave(true)
      if (preWall) old.data.progression.regionContent.version = 'b3fb1516'
      const before = structuredClone(old), migrated = validateSave(old, world, catalog)
      expect(old).toEqual(before)
      expect(migrated.data.construction.buildings[1].parts.foundation.built).toBe(true)
      expect(migrated.data.construction.xp).toBe(90)
      expect(migrated.data.progression.regionContent.version).toBe(REGION_CONTENT_VERSION)
      expect(migrated.data.production).toEqual(old.data.production)
      expect(validateSave(migrated, world, catalog)).toEqual(migrated)
    }
    expect(TOOL_CATALOG_VERSIONS).toContain(catalog.fingerprint)
    for (const fingerprint of TOOL_CATALOG_VERSIONS) {
      const save = envelopeFixture(); save.configVersion = save.configVersion.replace(catalog.fingerprint, fingerprint)
      expect(validateSave(save, world, catalog).configVersion).toBe(envelopeFixture().configVersion)
    }
  })

  it('preserves an already-built damaged floor and never grants its experience twice', () => {
    const old = groveSave(true), part = old.data.construction.buildings[1].parts.foundation
    Object.assign(part, { built: true, hp: 180, xpGranted: true }); Object.keys(part.segments!).forEach(id => { part.segments![id] = 180 })
    setSegmentHp(part, 'tile0-0', 0); old.data.construction.xp = 90
    const migrated = validateSave(old, world, catalog)
    expect(migrated.data.construction.buildings[1].parts.foundation).toEqual(part)
    expect(migrated.data.construction.xp).toBe(90)
  })

  it('releases unpaid old foundation reservations but lets paid construction finish normally', () => {
    for (const paid of [false, true]) {
      const old = groveSave(true), data = old.data
      data.construction.orders = [{ id: 'b2:foundation', buildingId: 'b2', partId: 'foundation', mode: 'build' }]
      const reservedIds: string[] = []
      if (!paid) {
        exchangeItems(data.production.inventory, catalog, [], [203, 203])
        const tools = Object.values(data.production.inventory.items).filter(i => i.itemId === 203)
        tools.forEach(item => { item.reservedBy = 'b2:foundation'; reservedIds.push(item.id) })
        data.destination = { x: 27, y: 5 }; data.searching = true
      } else data.cell = { x: 27, y: 5 }
      data.construction.jobs = [{ orderId: 'b2:foundation', phase: paid ? 'building' : 'travel', reservedIds, workCell: { x: 27, y: 5 }, remaining: paid ? 1 : 0 }]
      const migrated = validateSave(old, world, catalog), h = harness(migrated)
      expect(migrated.data.construction.xp).toBe(paid ? 70 : 90)
      if (paid) {
        expect(migrated.data.construction.jobs[0].remaining).toBe(1)
        h.pump(1); expect(h.valid().data.construction.xp).toBe(90)
        expect(h.valid().data.production.inventory).toEqual(migrated.data.production.inventory)
      } else {
        expect(migrated.data.construction.jobs).toEqual([]); expect(migrated.data.construction.orders).toEqual([])
        expect(migrated.data.destination).toBeNull(); expect(migrated.data.searching).toBe(false)
        reservedIds.forEach(id => expect(migrated.data.production.inventory.items[id].reservedBy).toBeNull())
      }
    }
  })

  it('keeps a newly placed statue away from existing buildings and saved continuous paths', () => {
    const old = groveSave(true), data = old.data
    const cabin = structuredClone(data.construction.buildings[0]); cabin.id = 'b3'; cabin.origin = { x: 21, y: 5 }
    data.economy!.removedObjects = ['grove-tree']
    data.construction.buildings.push(cabin); data.construction.nextId = 4; data.construction.xp += 70
    const saved = validateSave(old, world, catalog)
    expect(saved.data.progression.regionContent.statue).not.toEqual({ x: 23, y: 6 })
    const moving = groveSave(true)
    moving.data.cell = { x: 23, y: 5 }; moving.data.motion = { version: 1, position: { x: 23, y: 5.2 } }
    moving.data.route = [{ x: 23, y: 8 }]; moving.data.destination = { x: 23, y: 8 }
    const migrated = validateSave(moving, world, catalog)
    expect(migrated.data.route).toEqual(moving.data.route)
    const placed = migrated.data.progression.regionContent.statue!
    expect(Math.abs(placed.x - 23) > 1 || placed.y < 4.2 || placed.y > 9).toBe(true)
  })

  it('requires a level-four pickaxe, protects the two-second job and grants diamonds and a receipt exactly once', async () => {
    const seed = validateSave(groveSave(), world, catalog), statue = seed.data.progression.regionContent.statue!
    seed.data.cell = { x: statue.x - 1, y: statue.y }
    exchangeItems(seed.data.production.inventory, catalog, [], [263, 254])
    let h = harness(seed)
    expect(await h.send({ type: 'resource-interact', objectId: GROVE_STATUE_ID })).toMatchObject({ accepted: true, openProduction: true })
    expect(h.runtime.getSceneSnapshot().lootFeedback).toEqual([])
    const supplied = h.valid(); exchangeItems(supplied.data.production.inventory, catalog, [], [264])
    h = harness(supplied)
    await h.send({ type: 'resource-interact', objectId: GROVE_STATUE_ID })
    expect(h.valid().data.economy!.clearing?.remaining).toBe(2)
    h.runtime.applyDamage('player', 100); expect(h.valid().data.production.vitals.hp).toBe(100)
    h.pump(1.95); expect(h.runtime.getSceneSnapshot().lootFeedback).toEqual([])
    h.pump(.05)
    expect(h.runtime.getSceneSnapshot().lootFeedback).toMatchObject([{ cell: statue, gems: 30, gold: 0, items: [], pending: false }])
    const saved = h.valid(); expect(saved.data.production.inventory.gems).toBe(130)
    expect(saved.data.economy!.removedObjects).toContain(GROVE_STATUE_ID)
    expect(Object.values(saved.data.production.inventory.items).some(i => i.itemId === 264)).toBe(false)
    expect(await h.send({ type: 'resource-interact', objectId: GROVE_STATUE_ID })).toMatchObject({ accepted: false })
    expect(h.runtime.getSceneSnapshot().lootFeedback).toHaveLength(1)
    const restored = harness(saved)
    expect(restored.runtime.getSceneSnapshot().lootFeedback).toEqual([])
    expect(restored.runtime.world.allObjects().some(o => o.id === GROVE_STATUE_ID)).toBe(false)
    expect(restored.valid().data.production.inventory.gems).toBe(130)
  })

  it('marks full-inventory rewards pending, then emits only materials after a successful claim', async () => {
    const data = dataFixture(); data.cell = { x: 5, y: 6 }; exchangeItems(data.production.inventory, catalog, [], [252])
    const h = harness(envelopeFixture(data)); await h.send({ type: 'resource-interact', objectId: 't08' })
    const fullSave = h.valid(); while (exchangeItems(fullSave.data.production.inventory, catalog, [], [201])) { /* Fill during work. */ }
    const full = harness(fullSave); full.pump(2)
    expect(full.runtime.getSceneSnapshot().lootFeedback).toMatchObject([{ gold: 25, gems: 1, items: [203], pending: true }])
    await full.send({ type: 'loot-claim', objectId: 't08' }); expect(full.runtime.getSceneSnapshot().lootFeedback).toHaveLength(1)
    const branch = Object.values(full.valid().data.production.inventory.items).find(i => i.itemId === 201 && i.location.kind === 'warehouse')!
    await full.send({ type: 'item-discard', instanceId: branch.id }); await full.send({ type: 'loot-claim', objectId: 't08' })
    expect(full.runtime.getSceneSnapshot().lootFeedback[1]).toMatchObject({ gold: 0, gems: 0, items: [203], pending: false })
    await full.send({ type: 'loot-claim', objectId: 't08' }); expect(full.runtime.getSceneSnapshot().lootFeedback).toHaveLength(2)
  })

  it('rejects invalid versions, statue positions and new tools forged under old catalog versions', () => {
    const old = oldSave(); old.data.production.inventory.items[old.data.production.inventory.board[7].instanceId!].itemId = 264
    expect(() => validateSave(old, world, catalog)).toThrow('旧版工具来源')
    for (const edit of [
      (save: SaveEnvelope) => { save.data.progression.regionContent.version = 'invalid' },
      (save: SaveEnvelope) => { save.data.progression.regionContent.statue = { x: 5, y: 6 } },
      (save: SaveEnvelope) => { save.data.progression.regionContent.statue = { x: 25, y: 3 } },
      (save: SaveEnvelope) => { save.data.economy!.version = 'invalid' },
    ]) { const save = validateSave(groveSave(), world, catalog); edit(save); expect(() => validateSave(save, world, catalog)).toThrow() }
  })
})
