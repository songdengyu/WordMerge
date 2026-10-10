import { expect, it } from 'vitest'
import { BLUEPRINTS } from './buildingConfig'
import { createBuildingParts } from './buildingSegments'
import { validateSave } from './saveData'
import { doubleSavedWalls, PRE_DOUBLE_BUILDING_VERSION, PRE_DOUBLE_ECONOMY_VERSION, PRE_DOUBLE_REGION_VERSION } from './migrations/doubleWallDurability'
import { dataFixture, envelopeFixture, productionFixture, worldFixture } from './testFixtures'

function oldSave() {
  const data = dataFixture(), bp = BLUEPRINTS[0], parts = createBuildingParts(bp)
  for (const p of bp.parts) {
    const hp = p.kind === 'wall' ? 20 : p.hp
    Object.assign(parts[p.id], { built: true, xpGranted: true, hp })
    for (const id in parts[p.id].segments) parts[p.id].segments![id] = hp
  }
  parts.walls.hp = 0; parts.walls.segments!.edge0 = 0; parts.walls.segments!.edge1 = 7.5
  data.construction.buildings = [{ id: 'b1', blueprintId: bp.id, origin: { x: 7, y: 10 }, rotation: 0, parts }]
  data.construction.nextId = 2; data.construction.xp = 70
  data.cell = { x: 8, y: 11 }
  data.construction.orders = [{ id: 'b1:walls:edge0', buildingId: 'b1', partId: 'walls', segmentId: 'edge0', mode: 'repair' }]
  data.construction.jobs = [{ orderId: 'b1:walls:edge0', phase: 'building', remaining: 1.25, reservedIds: [], workCell: data.cell }]
  data.economy!.version = PRE_DOUBLE_ECONOMY_VERSION
  data.progression.regionContent.version = PRE_DOUBLE_REGION_VERSION
  const save = envelopeFixture(data), version = save.configVersion.split('-')
  version[3] = PRE_DOUBLE_BUILDING_VERSION; save.configVersion = version.join('-')
  return save
}

it('upgrades the delivered save once, preserving breaches, paid repairs, inventory and experience', () => {
  const old = oldSave(), before = structuredClone(old), world = worldFixture(), catalog = productionFixture()
  const result = validateSave(old, world, catalog)
  expect(old).toEqual(before)
  expect(result.data.construction.buildings[0].parts.walls.segments).toMatchObject({ edge0: 0, edge1: 15, edge2: 40 })
  expect(result.data.construction.buildings[0].parts.door).toEqual(old.data.construction.buildings[0].parts.door)
  expect(result.data.construction.jobs).toEqual(old.data.construction.jobs)
  expect(result.data.production).toEqual(old.data.production)
  expect(result.data.construction.xp).toBe(70)
  expect(validateSave(result, world, catalog)).toEqual(result)
})

it('rejects old durability beyond its historical maximum', () => {
  const old = oldSave(); old.data.construction.buildings[0].parts.walls.segments!.edge2 = 21
  expect(() => validateSave(old, worldFixture(), productionFixture())).toThrow('翻倍前墙段耐久')
})

it.each(BLUEPRINTS.map(bp => [bp.id, bp] as const))('preserves the damage ratio of %s', (_id, bp) => {
  const data = dataFixture(), parts = createBuildingParts(bp), config = bp.parts.find(p => p.kind === 'wall')!
  parts.walls.hp = config.hp / 8
  for (const id in parts.walls.segments) parts.walls.segments![id] = config.hp / 8
  data.construction.buildings = [{ id: 'b1', blueprintId: bp.id, origin: { x: 7, y: 10 }, rotation: 0, parts }]
  doubleSavedWalls(data, false, (condition): asserts condition => { if (!condition) throw new Error('invalid') })
  expect(parts.walls.hp).toBe(config.hp / 4)
  expect(Object.values(parts.walls.segments!).every(hp => hp === config.hp / 4)).toBe(true)
})
