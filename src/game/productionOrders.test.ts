import { describe, expect, it } from 'vitest'
import { GameRuntime, type GameCommand } from './GameRuntime'
import { blueprintById } from './buildingConfig'
import { createBuildingParts, setSegmentHp } from './buildingSegments'
import { exchangeItems } from './inventory'
import { RESOURCE_RULES } from './economyConfig'
import { TAMING_ORDER } from './taming'
import { validateSave } from './saveData'
import { dataFixture, envelopeFixture, productionFixture, testNow, worldFixture } from './testFixtures'

const world = worldFixture(), catalog = productionFixture()
function harness(data = dataFixture()) {
  const runtime = new GameRuntime(world, { catalog, saved: envelopeFixture(data), now: () => testNow })
  let frame = 0; runtime.advanceFrame(frame)
  const send = (command: GameCommand) => { const result = runtime.dispatch(command); runtime.advanceFrame(frame += 50); return result }
  const complete = (orderId: string) => { runtime.focusProductionOrder(orderId); return send({ type: 'test-complete-order', orderId }) }
  const saved = () => validateSave(JSON.parse(runtime.exportSave()), world, catalog).data
  return { runtime, send, complete, saved }
}
function home(complete: boolean) {
  const data = dataFixture(), bp = blueprintById('cabin')!, parts = createBuildingParts(bp)
  if (complete) for (const p of bp.parts) {
    Object.assign(parts[p.id], { built: true, hp: p.hp, xpGranted: true })
    if (parts[p.id].segments) for (const id in parts[p.id].segments) parts[p.id].segments![id] = p.hp
  }
  data.construction.buildings = [{ id: 'b1', blueprintId: 'cabin', origin: { x: 7, y: 10 }, rotation: 0, parts }]
  data.construction.nextId = 2; data.construction.xp = complete ? 70 : 0
  return data
}
function fill(data: ReturnType<typeof dataFixture>) {
  while (exchangeItems(data.production.inventory, catalog, [], [201])) { /* occupy all unlocked empty slots */ }
}

describe('test completion of the selected production order', () => {
  it('completes the selected commission once without consuming stock, keeping normal rewards after reload', async () => {
    const h = harness(), before = h.saved().production.inventory, order = catalog.orders[1]
    expect(await h.complete(`commission:${order.id}`)).toMatchObject({ accepted: true })
    expect(await h.send({ type: 'test-complete-order', orderId: `commission:${order.id}` })).toMatchObject({ accepted: false })
    const after = h.saved()
    expect(after.production.inventory.completedOrders).toEqual([order.id])
    expect(after.production.inventory.gems).toBe(before.gems + order.gems)
    for (const item of Object.values(before.items)) expect(after.production.inventory.items[item.id]).toEqual(item)
    expect(Object.keys(after.production.inventory.items)).toHaveLength(Object.keys(before.items).length + order.quantity)
    expect(harness(after).saved().production.inventory).toEqual(after.production.inventory)
  })

  it('rejects a stale selection and leaves a full-inventory commission and its rewards untouched', async () => {
    const data = dataFixture(); fill(data)
    const h = harness(data), before = h.saved().production.inventory
    expect(await h.send({ type: 'test-complete-order', orderId: 'commission:2' })).toMatchObject({ accepted: false })
    expect(await h.complete('commission:1')).toMatchObject({ accepted: false })
    expect(h.saved().production.inventory).toEqual(before)
  })

  it('completes construction immediately without moving the player or consuming materials and grants XP only once', async () => {
    const data = home(false)
    data.construction.orders = [{ id: 'b1:foundation', buildingId: 'b1', partId: 'foundation', mode: 'build' }]
    const h = harness(data)
    expect(await h.complete('building:b1:foundation')).toMatchObject({ accepted: true })
    const after = h.saved()
    expect(after.construction.xp).toBe(10)
    expect(after.construction.buildings[0].parts.foundation.built).toBe(true)
    expect(after.construction.orders).toEqual([])
    expect(after.production.inventory).toEqual(data.production.inventory)
    expect(after.cell).toEqual(data.cell)
    expect(await h.send({ type: 'test-complete-order', orderId: 'building:b1:foundation' })).toMatchObject({ accepted: false })
  })

  it('repairs only the selected segment, releases an unpaid reservation, and does not award construction XP again', async () => {
    const data = home(true), part = data.construction.buildings[0].parts.walls
    setSegmentHp(part, 'edge0', 0); setSegmentHp(part, 'edge1', 3)
    const id = 'b1:walls:edge0', item = Object.values(data.production.inventory.items).find(i => i.itemId === 201)!
    data.construction.orders = [{ id, buildingId: 'b1', partId: 'walls', segmentId: 'edge0', mode: 'repair' }]
    item.reservedBy = id
    data.construction.jobs = [{ orderId: id, phase: 'queued', reservedIds: [item.id], remaining: 0, workCell: null }]
    const h = harness(data)
    expect(await h.complete(`building:${id}`)).toMatchObject({ accepted: true })
    const after = h.saved()
    expect(after.construction.buildings[0].parts.walls.segments).toMatchObject({ edge0: 20, edge1: 3 })
    expect(after.construction.xp).toBe(70)
    expect(after.construction.jobs).toEqual([])
    expect(after.production.inventory.items[item.id]).toEqual({ ...item, reservedBy: null })
  })

  it('settles one supply effect and removes its order without consuming a real piece', async () => {
    const data = dataFixture(), [itemId, effect] = [...catalog.effects].find(([, e]) => e.stat === 'water')!
    data.production.vitals.water = 10; data.production.supplyOrders = [{ stat: 'water', itemId }]
    const h = harness(data)
    expect(await h.complete('supply:water')).toMatchObject({ accepted: true })
    // The ordinary fixed step still applies its tiny continuous thirst drain.
    expect(h.saved().production.vitals.water).toBeCloseTo(Math.min(100, 10 + effect.amount), 1)
    expect(h.saved().production.supplyOrders).toEqual([])
    expect(h.saved().production.inventory).toEqual(data.production.inventory)
  })

  it('recruits a tameable target and clears its order without consuming the meal', async () => {
    const data = dataFixture(); data.survival.taming.ordered = true
    const h = harness(data)
    expect(await h.complete(TAMING_ORDER)).toMatchObject({ accepted: true })
    const after = h.saved()
    expect(after.survival.companion.status).toBe('active')
    expect(after.survival.taming).toEqual({ ordered: false, job: null })
    expect(after.production.inventory).toEqual(data.production.inventory)
    expect(harness(after).saved().survival.companion.status).toBe('active')
  })

  it('clears a resource once and preserves full-inventory rewards for later collection', async () => {
    const data = dataFixture(); fill(data); data.economy!.clearingOrders = ['t01']
    const h = harness(data)
    expect(await h.complete('resource:t01')).toMatchObject({ accepted: true })
    const after = h.saved(), rule = RESOURCE_RULES.tree
    expect(after.economy!.removedObjects).toContain('t01')
    expect(after.economy!.pendingLoot).toContain('t01')
    expect(after.economy!.clearingOrders).toEqual([])
    expect(after.production.inventory.gold).toBe(data.production.inventory.gold + rule.gold)
    expect(after.production.inventory.gems).toBe(data.production.inventory.gems + rule.gems)
    expect(after.production.inventory.items).toEqual(data.production.inventory.items)
    expect(await h.send({ type: 'test-complete-order', orderId: 'resource:t01' })).toMatchObject({ accepted: false })
    expect(harness(after).saved().economy).toEqual(after.economy)
  })
})
