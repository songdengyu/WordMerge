import { describe, expect, it } from 'vitest'
import { blueprintById } from './buildingConfig'
import { createBuildingParts, setSegmentHp } from './buildingSegments'
import { orderMaterials } from './construction'
import { ECONOMY_VERSION } from './economyConfig'
import { REGION_CONTENT_VERSION } from './regionContentConfig'
import { validateSave } from './saveData'
import { dataFixture, envelopeFixture, productionFixture, worldFixture } from './testFixtures'
import { PRE_REPAIR_BUILDING_VERSION, PRE_REPAIR_ECONOMY_VERSION, PRE_REPAIR_REGION_VERSION } from './migrations/wallRepairCost'

const world = worldFixture(), catalog = productionFixture()
function oldRepair(phase: 'queued' | 'travel' | 'building') {
  const data = dataFixture(), bp = blueprintById('cabin')!, parts = createBuildingParts(bp)
  for (const p of bp.parts) {
    Object.assign(parts[p.id], { built: true, hp: p.hp, xpGranted: true })
    if (parts[p.id].segments) for (const id in parts[p.id].segments) parts[p.id].segments![id] = p.hp
  }
  setSegmentHp(parts.walls, 'edge0', 0); setSegmentHp(parts.walls, 'edge1', 7)
  data.construction.buildings = [{ id: 'b1', blueprintId: 'cabin', origin: { x: 7, y: 10 }, rotation: 0, parts }]
  data.construction.nextId = 2; data.construction.xp = 70
  const orderId = 'b1:walls:edge0'
  data.construction.orders = [{ id: orderId, buildingId: 'b1', partId: 'walls', segmentId: 'edge0', mode: 'repair' }]
  const inv = data.production.inventory, item = Object.values(inv.items).find(i => i.itemId === 201)!
  item.itemId = 202
  if (phase === 'building') { inv.board[item.location.index].instanceId = null; delete inv.items[item.id] }
  else item.reservedBy = orderId
  data.cell = phase === 'building' ? { x: 8, y: 11 } : { x: 8, y: 12 }
  data.motion = { version: 1, position: data.cell }
  if (phase === 'travel') { data.route = [{ x: 8, y: 11 }]; data.destination = { x: 8, y: 11 } }
  data.construction.jobs = [{ orderId, phase, reservedIds: phase === 'building' ? [] : [item.id],
    remaining: phase === 'building' ? .75 : 0, workCell: phase === 'queued' ? null : { x: 8, y: 11 } }]
  const save = envelopeFixture(data), versions = save.configVersion.split('-')
  versions[3] = PRE_REPAIR_BUILDING_VERSION; save.configVersion = versions.join('-')
  data.economy!.version = PRE_REPAIR_ECONOMY_VERSION
  data.progression.regionContent.version = PRE_REPAIR_REGION_VERSION
  return { save, itemId: item.id }
}

describe('cheaper wall repair save upgrade', () => {
  it.each(['queued', 'travel'] as const)('releases an unpaid %s repair without consuming wood, resetting damage or losing its order', phase => {
    const { save, itemId } = oldRepair(phase), before = structuredClone(save)
    const result = validateSave(save, world, catalog), data = result.data
    expect(save).toEqual(before)
    const inventory = structuredClone(before.data.production.inventory)
    inventory.items[itemId].reservedBy = null
    expect(data.production.inventory).toEqual(inventory)
    expect(data.construction.buildings).toEqual(before.data.construction.buildings)
    expect(data.construction.xp).toBe(70)
    expect(data.construction.jobs).toEqual([])
    expect(data.construction.orders).toEqual(before.data.construction.orders)
    expect(orderMaterials(data.construction, data.construction.orders[0])).toEqual([201])
    expect(data.route).toEqual([]); expect(data.destination).toBeNull()
    expect(data.motion).toEqual(before.data.motion)
    expect(data.economy!.version).toBe(ECONOMY_VERSION)
    expect(data.progression.regionContent.version).toBe(REGION_CONTENT_VERSION)
    expect(validateSave(result, world, catalog)).toEqual(result)
  })

  it('retains already paid work and its remaining time without refunds or a second charge', () => {
    const { save } = oldRepair('building'), result = validateSave(save, world, catalog)
    expect(result.data.construction).toEqual(save.data.construction)
    expect(result.data.production).toEqual(save.data.production)
    expect(result.data.construction.jobs[0].remaining).toBe(.75)
    expect(validateSave(result, world, catalog)).toEqual(result)
  })

  it('rejects forged old reservations before migration and requires the new item for new saves', () => {
    const { save, itemId } = oldRepair('queued')
    save.data.production.inventory.items[itemId].itemId = 203
    expect(() => validateSave(save, world, catalog)).toThrow('预留实例')
    save.data.production.inventory.items[itemId].itemId = 202
    const current = envelopeFixture(save.data)
    expect(() => validateSave(current, world, catalog)).toThrow('预留实例')
  })
})
