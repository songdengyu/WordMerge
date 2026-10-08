import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { GameRuntime, type GameCommand } from './GameRuntime'
import { blueprintById, validateBuildingCatalog } from './buildingConfig'
import { buildingSegments, createBuildingParts } from './buildingSegments'
import { RESOURCE_RULES, ECONOMY_VERSION } from './economyConfig'
import { applyInventoryCommand } from './inventory'
import { CONTENT_CATALOG_VERSIONS } from './migrations/contentExpansion'
import { TOOL_CATALOG_VERSIONS } from './migrations/groveTools'
import { REGION_CONTENT_VERSION } from './regionContentConfig'
import { progressedWorld } from './progression'
import { validateSave, type SaveEnvelope } from './saveData'
import { dataFixture, envelopeFixture, productionFixture, testNow, worldFixture } from './testFixtures'
import { FLORA_KINDS } from './world'

const world = worldFixture(), catalog = productionFixture()
const oldSave = () => JSON.parse(readFileSync('tests/fixtures/pre-content-expansion.json', 'utf8')) as SaveEnvelope
function harness(data = dataFixture()) {
  const runtime = new GameRuntime(world, { catalog, saved: envelopeFixture(data), now: () => testNow })
  let time = 0; runtime.advanceFrame(0)
  const send = async (command: GameCommand) => { const result = runtime.dispatch(command); runtime.advanceFrame(time += 50); return result }
  const saved = () => validateSave(JSON.parse(runtime.exportSave()), world, catalog).data
  return { runtime, send, saved }
}

describe('content pack compatibility and playable catalog', () => {
  it('migrates the actual old catalog without resetting balances, removals, pending loot or owned stock', () => {
    const old = oldSave()
    old.data.production.inventory.gold = 1234
    old.data.production.inventory.gems = 57
    old.data.economy!.removedObjects = ['t02', 't03']
    old.data.economy!.pendingLoot = ['t03']
    old.data.economy!.distanceRemainder = 7.25
    old.data.economy!.purchases = ['rug', 'sage', 'garden-blueprint']
    old.data.progression.ownedDecor = ['rug']; old.data.progression.decorStock = { rug: 3 }
    old.data.progression.ownedOutfits.push('sage'); old.data.progression.outfit = 'sage'
    old.data.construction.unlockedBlueprints.push('garden-cabin')
    const before = structuredClone(old), migrated = validateSave(old, world, catalog)
    expect(old).toEqual(before)
    expect(migrated.data.production).toEqual(old.data.production)
    expect(migrated.data.progression).toEqual({ ...old.data.progression, regionContent: { ...old.data.progression.regionContent, version: REGION_CONTENT_VERSION, statue: null } })
    expect(migrated.data.construction).toEqual(old.data.construction)
    expect(migrated.data.economy).toEqual({ ...old.data.economy, version: ECONOMY_VERSION })
    expect(validateSave(migrated, world, catalog)).toEqual(migrated)
    const map = progressedWorld(world, migrated.data.progression, migrated.data.economy!.removedObjects)
    expect(map.allObjects().some(o => ['t02', 't03'].includes(o.id))).toBe(false)
  })
  it('recognizes deployed newline variants but rejects unknown versions and new content forged under old versions', () => {
    expect(TOOL_CATALOG_VERSIONS).toContain(catalog.fingerprint)
    for (const version of CONTENT_CATALOG_VERSIONS) {
      const save = envelopeFixture(); save.configVersion = save.configVersion.replace(catalog.fingerprint, version)
      expect(validateSave(save, world, catalog).configVersion).toBe(envelopeFixture().configVersion)
    }
    const bad = oldSave(); bad.configVersion = bad.configVersion.replace('6e361e33', 'deadbeef')
    expect(() => validateSave(bad, world, catalog)).toThrow('不匹配')
    const item = oldSave(); item.data.production.inventory.items[item.data.production.inventory.board[7].instanceId!].itemId = 206
    expect(() => validateSave(item, world, catalog)).toThrow('旧版物品来源')
    const purchase = oldSave(); purchase.data.economy!.purchases.push('cedar-blueprint')
    expect(() => validateSave(purchase, world, catalog)).toThrow('购买记录')
    const order = oldSave(); order.data.production.inventory.completedOrders.push(6)
    expect(() => validateSave(order, world, catalog)).toThrow('旧版委托')
  })
  it('extends each old terminal through real merges and consumes high-level supplies with correct caps', () => {
    const chains = [[203, 204, 205, 206], [213, 214, 215], [222, 223, 224], [232, 233, 234], [242, 243]]
    const svg = readFileSync('public/assets/survival/items.svg', 'utf8')
    for (const chain of chains) for (let n = 1; n < chain.length; n++) {
      let state = dataFixture().production
      const first = state.inventory.board[7].instanceId!, second = state.inventory.board[8].instanceId!
      state.inventory.items[first].itemId = chain[n - 1]; state.inventory.items[second].itemId = chain[n - 1]
      const merged = applyInventoryCommand(state, catalog, { type: 'item-move', instanceId: first, targetIndex: 8, expectedTarget: second }, testNow)
      if (!merged.accepted) throw new Error(merged.reason)
      state = merged.state
      const id = state.inventory.board[8].instanceId!
      expect(state.inventory.items[id].itemId).toBe(chain[n])
      expect(svg).toContain(`id="${catalog.itemById.get(chain[n])!.iconName}"`)
      const effect = catalog.effects.get(chain[n])
      if (effect) {
        if (effect.stat === 'stamina') state.stamina.value = 90
        else state.vitals[effect.stat] = 80
        const used = applyInventoryCommand(state, catalog, { type: 'item-use', instanceId: id }, testNow)
        if (!used.accepted) throw new Error(used.reason)
        expect(effect.stat === 'stamina' ? used.state.stamina.value : used.state.vitals[effect.stat]).toBe(effect.stat === 'stamina' ? 90 + effect.amount : 100)
        expect(used.state.inventory.items[id]).toBeUndefined()
        expect(applyInventoryCommand(used.state, catalog, { type: 'item-use', instanceId: id }, testNow).accepted).toBe(false)
      }
    }
  })
  it.each(['meadow-hut', 'cedar-home', 'rose-manor'])('buys and places %s with complete segmented geometry and 2-second jobs', async id => {
    validateBuildingCatalog(catalog)
    const blueprint = blueprintById(id)!, data = dataFixture(); data.production.inventory.gold = 1000
    const h = harness(data), productId = ({ 'meadow-hut': 'meadow-blueprint', 'cedar-home': 'cedar-blueprint', 'rose-manor': 'manor-blueprint' })[id]!
    expect(await h.send({ type: 'shop-buy', productId })).toMatchObject({ accepted: true })
    expect(await h.send({ type: 'building-place', blueprintId: id, origin: { x: 7, y: 2 }, rotation: 0 })).toMatchObject({ accepted: true })
    const building = h.saved().construction.buildings[0]
    expect(building.parts).toEqual(createBuildingParts(blueprint))
    expect(blueprint.parts.every(p => p.seconds === 2 && p.repairSeconds === 2)).toBe(true)
    expect(buildingSegments(blueprint, blueprint.parts.find(p => p.kind === 'wall')!)).toHaveLength(2 * (blueprint.width + blueprint.height) - 1)
    expect(buildingSegments(blueprint, blueprint.parts.find(p => p.kind === 'roof')!)).toHaveLength(blueprint.width * blueprint.height)
  })
  it('buys all furniture and outfits, supports repeated stock and preserves placed furniture after reload', async () => {
    const data = dataFixture(); data.production.inventory.gold = 5000; data.production.inventory.gems = 500
    const blueprint = blueprintById('cabin')!, parts = createBuildingParts(blueprint)
    for (const config of blueprint.parts) {
      Object.assign(parts[config.id], { built: true, hp: config.hp, xpGranted: true })
      if (parts[config.id].segments) for (const key of Object.keys(parts[config.id].segments!)) parts[config.id].segments![key] = config.hp
    }
    data.construction.buildings = [{ id: 'b1', blueprintId: 'cabin', origin: { x: 7, y: 10 }, rotation: 0, parts }]
    data.construction.nextId = 2; data.construction.xp = 70
    const h = harness(data)
    for (const productId of ['chair', 'table', 'sofa', 'bookshelf', 'tea-set', 'flowerstand', 'chair', 'meadow', 'rain', 'starlight']) {
      expect(await h.send({ type: 'shop-buy', productId })).toMatchObject({ accepted: true })
    }
    expect(h.saved().progression.decorStock!.chair).toBe(2)
    expect(await h.send({ type: 'decor-place', kind: 'chair', cell: { x: 8, y: 10 } })).toMatchObject({ accepted: true })
    expect(await h.send({ type: 'outfit-equip', outfitId: 'starlight' })).toMatchObject({ accepted: true })
    const restored = harness(h.saved())
    expect(restored.saved().progression).toMatchObject({ outfit: 'starlight', decorStock: { chair: 1 }, decorations: [{ kind: 'chair' }] })
    expect(await restored.send({ type: 'decor-remove', kind: 'chair', decorationId: 'd1' })).toMatchObject({ accepted: true })
    expect(restored.saved().progression.decorStock!.chair).toBe(2)
  })
  it('varies flora at existing coordinates and preserves resource tools, rewards and blocked footprints', () => {
    const configured = world.config.objects
    for (const object of world.allConfiguredObjects()) {
      const original = configured.find(o => o.id === object.id)!
      expect({ ...object, kind: original.kind }).toEqual(original)
      if (FLORA_KINDS[object.id]) {
        expect(object.kind).toBe(FLORA_KINDS[object.id])
        expect({ ...RESOURCE_RULES[object.kind], name: RESOURCE_RULES.tree.name }).toEqual(RESOURCE_RULES.tree)
        expect(world.isWalkable(object)).toBe(false)
      }
    }
  })
})
