import { describe, expect, it } from 'vitest'
import { BLUEPRINTS } from './buildingConfig'
import { constructionDamage, upgradeConstruction } from './construction'
import { dataFixture, envelopeFixture, productionFixture, worldFixture } from './testFixtures'
import { m3ConfigVersion, m4ConfigVersion, validateSave } from './saveData'
import { PRE_WALL_BUILDING_VERSION, PRE_WALL_REGION_VERSION } from './migrations/wallDurability'
import { REGION_CONTENT_VERSION } from './regionContentConfig'
import { ENEMIES } from './survivalConfig'

const world = worldFixture(), catalog = productionFixture()
function houses(lodge = false) {
  const data = dataFixture()
  for (const blueprint of BLUEPRINTS.filter(b => b.id === 'cabin' || lodge && b.id === 'lodge')) {
    data.construction.buildings.push({ id: `b${data.construction.nextId++}`, blueprintId: blueprint.id,
      origin: blueprint.id === 'cabin' ? { x: 7, y: 10 } : { x: 25, y: 3 }, rotation: 0,
      parts: Object.fromEntries(blueprint.parts.map(config => [config.id, { hp: config.hp, built: true, xpGranted: true }])) })
    data.construction.xp += blueprint.parts.reduce((sum, config) => sum + config.xp, 0)
  }
  if (lodge) { data.progression.unlockedRegions = ['grove']; data.progression.regionContent.initialized = ['grove'] }
  upgradeConstruction(data.construction, data.production.inventory)
  return data
}
function oldVersion(version: string) {
  const parts = version.split('-'); parts[3] = PRE_WALL_BUILDING_VERSION; return parts.join('-')
}

describe('wall durability rebalance compatibility', () => {
  it('migrates both houses by ratio, preserves breaches/paid repairs and never rescales a second time', () => {
    const old = envelopeFixture(houses(true))
    old.configVersion = oldVersion(old.configVersion)
    old.data.progression.regionContent.version = PRE_WALL_REGION_VERSION
    for (const b of old.data.construction.buildings) {
      const max = b.blueprintId === 'cabin' ? 160 : 320, wall = b.parts.walls
      for (const id of Object.keys(wall.segments!)) wall.segments![id] = id === 'edge0' ? max / 2 : id === 'edge1' ? 0 : max
      wall.hp = 0
    }
    old.data.cell = { x: 8, y: 11 }
    old.data.construction.orders = [{ id: 'b1:walls:edge0', buildingId: 'b1', partId: 'walls', segmentId: 'edge0', mode: 'repair' }]
    old.data.construction.jobs = [{ orderId: 'b1:walls:edge0', phase: 'building', workCell: old.data.cell, remaining: 1.25, reservedIds: [] }]
    const source = structuredClone(old), migrated = validateSave(old, world, catalog)
    expect(old).toEqual(source)
    expect(migrated.data.construction.buildings[0].parts.walls.segments).toMatchObject({ edge0: 10, edge1: 0, edge2: 20 })
    expect(migrated.data.construction.buildings[1].parts.walls.segments).toMatchObject({ edge0: 15, edge1: 0, edge2: 30 })
    expect(migrated.data.progression.regionContent.version).toBe(REGION_CONTENT_VERSION)
    expect(migrated.data.production).toEqual(old.data.production)
    expect(migrated.data.construction.jobs).toEqual(old.data.construction.jobs)
    expect(migrated.data.construction.xp).toBe(old.data.construction.xp)
    expect(validateSave(migrated, world, catalog)).toEqual(migrated)
  })

  it.each([2, 3, 4])('still imports schema %i saves with the old cabin fingerprint and unsplit walls', schema => {
    const old = { ...envelopeFixture(houses()), schemaVersion: schema }
    old.configVersion = oldVersion(schema === 2 ? m3ConfigVersion(world, catalog) : schema === 3 ? m4ConfigVersion(world, catalog) : old.configVersion)
    old.data.construction.buildings[0].parts.walls.hp = 80
    delete old.data.construction.buildings[0].parts.walls.segments
    const migrated = validateSave(old, world, catalog)
    expect(migrated.data.construction.buildings[0].parts.walls.hp).toBe(10)
    expect(Object.values(migrated.data.construction.buildings[0].parts.walls.segments!)).toEqual(Array(9).fill(10))
    expect(migrated.data.production).toEqual(old.data.production)
  })

  it('rejects old HP outside its historical range and unknown fingerprints instead of repairing bad saves', () => {
    const old = envelopeFixture(houses()); old.configVersion = oldVersion(old.configVersion)
    const wall = old.data.construction.buildings[0].parts.walls
    wall.hp = 0; wall.segments!.edge0 = 161
    expect(() => validateSave(old, world, catalog)).toThrow('旧围墙耐久')
    wall.segments!.edge0 = 0
    old.configVersion = old.configVersion.replace(PRE_WALL_BUILDING_VERSION, 'unknown')
    expect(() => validateSave(old, world, catalog)).toThrow('不匹配')
  })

  it('destroys one full cabin/lodge wall on the fifth/eighth boar hit', () => {
    for (const [index, hits] of [[0, 5], [1, 8]]) {
      const data = houses(true), target = { buildingId: data.construction.buildings[index].id, partId: 'walls', segmentId: 'edge0' }
      let construction = data.construction
      for (let hit = 1; hit <= hits; hit++) {
        construction = constructionDamage(construction, data.production, target, ENEMIES.boar.attack).state
        const hp = construction.buildings[index].parts.walls.segments!.edge0
        expect(hit === hits ? hp === 0 : hp > 0).toBe(true)
      }
      expect(construction.buildings[index].parts.walls.segments!.edge1).toBe(index === 0 ? 20 : 30)
    }
  })
})
