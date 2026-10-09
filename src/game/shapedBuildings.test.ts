import { describe, expect, it } from 'vitest'
import { blueprintById, blueprintCells, validateBlueprintShape } from './buildingConfig'
import { buildingAt, constructionNavigation, createConstruction, footprint, localToWorld, type Building, type Rotation } from './construction'
import { buildingSegments, createBuildingParts, setSegmentHp } from './buildingSegments'
import { parseWorld } from './world'
import { shelterAt } from './survival'
import { canWalkLine } from './smoothNavigation'
import { decorError } from './progression'
import { dataFixture, envelopeFixture, productionFixture, testNow, worldFixture } from './testFixtures'
import { validateSave } from './saveData'
import { ECONOMY_VERSION, PRE_SHAPES_ECONOMY_VERSION } from './economyConfig'
import { GameRuntime, type GameCommand } from './GameRuntime'
import { roofHeight } from '../scene/ShapedRoof'

const world = worldFixture(), catalog = productionFixture()
const cases = ['forest-corner', 'flower-court']
function completed(id: string, rotation: Rotation = 0): Building {
  const bp = blueprintById(id)!, parts = createBuildingParts(bp)
  for (const config of bp.parts) {
    Object.assign(parts[config.id], { built: true, hp: config.hp, xpGranted: true })
    for (const s of buildingSegments(bp, config)) setSegmentHp(parts[config.id], s.id, config.hp)
  }
  return { id: 'b1', blueprintId: id, origin: { x: 7, y: 7 }, rotation, parts }
}
describe('shaped house geometry and compatibility', () => {
  it.each(cases)('%s has safe walls, a reachable outdoor notch and correct indoor cells in all rotations', id => {
    const empty = parseWorld({ version: 1, dayDurationSeconds: 600, initialHour: 12, spawn: { x: 7, y: 14 },
      chunks: [{ id: 'camp', name: 'camp', x: 0, y: 0, unlocked: true, patches: [] }], objects: [], blockedEdges: [] })
    const bp = blueprintById(id)!, cells = blueprintCells(bp)
    expect(cells).toHaveLength(id === cases[0] ? 12 : 18)
    for (const rotation of [0, 1, 2, 3] as Rotation[]) {
      const building = completed(id, rotation), state = { ...createConstruction(), buildings: [building] }
      const project = (x: number, y: number) => localToWorld(building, { x, y })
      expect(footprint(building, bp)).toHaveLength(cells.length)
      const notch = project(2, 3)
      expect(buildingAt(state, notch)).toBeUndefined(); expect(shelterAt(state, notch).enclosed).toBe(false)
      expect(canWalkLine(constructionNavigation(empty, state), project(2, 4), notch)).toBe(true)
      expect(shelterAt(state, project(0, 1)).enclosed).toBe(true)
      const door = bp.parts.find(p => p.kind === 'door')!.edges[0]
      expect(constructionNavigation(empty, state).canStep(localToWorld(building, door.from), localToWorld(building, door.to))).toBe(true)
      expect(constructionNavigation(empty, state, 'enemy').canStep(localToWorld(building, door.from), localToWorld(building, door.to))).toBe(false)
      const wall = bp.parts.find(p => p.kind === 'wall')!, segments = buildingSegments(bp, wall), edge = segments[0].edge!
      const grid = constructionNavigation(empty, state)
      expect(grid.canStep(localToWorld(building, edge.from), localToWorld(building, edge.to))).toBe(false)
      setSegmentHp(building.parts.walls, segments[0].id, 0)
      expect(constructionNavigation(empty, state).canStep(localToWorld(building, edge.from), localToWorld(building, edge.to))).toBe(true)
      expect(building.parts.walls.segments![segments[1].id]).toBe(wall.hp)
      for (const kind of ['foundation', 'roof']) expect(buildingSegments(bp, bp.parts.find(p => p.kind === kind)!)).toHaveLength(cells.length)
      const progress = dataFixture().progression; progress.ownedDecor = ['rug']; progress.decorStock = { rug: 1 }
      expect(decorError('rug', notch, progress, state)).toBeTruthy()
      expect(decorError('rug', project(0, 0), progress, state)).toBeNull()
    }
    // The inner eaves meet the wall top, never spanning over the notch.
    expect(roofHeight(bp, 1.5, 3, 20)).toBe(29)
  })
  it('rejects disconnected/duplicate occupancy, courtyard work positions and internal doors', () => {
    const bp = blueprintById(cases[0])!
    expect(() => validateBlueprintShape({ ...bp, cells: [{ x: 0, y: 0 }, { x: 3, y: 3 }] })).toThrow('连通')
    expect(() => validateBlueprintShape({ ...bp, cells: [{ x: 0, y: 0 }, { x: 0, y: 0 }] })).toThrow('占格')
    expect(() => validateBlueprintShape({ ...bp, parts: bp.parts.map(p => ({ ...p, work: [{ x: 3, y: 3 }] })) })).toThrow('工作位')
    expect(() => validateBlueprintShape({ ...bp, parts: bp.parts.map(p => p.kind === 'door'
      ? { ...p, edges: [{ from: { x: 0, y: 0 }, to: { x: 1, y: 0 } }] } : p) })).toThrow('外围')
  })
  it.each(cases)('buys, constructs, damages, repairs and saves %s without altering neighboring segments', async id => {
    const data = dataFixture(), inv = data.production.inventory, bp = blueprintById(id)!
    data.survival.spawnRemaining = 160
    inv.gold = 1000; inv.gems = 100
    const materials = [...bp.parts.flatMap(p => p.materials), ...bp.parts.find(p => p.kind === 'wall')!.repairMaterials]
    for (const itemId of materials) {
      const index = inv.board.findIndex(slot => slot.lock === 0 && slot.instanceId === null), key = `i${inv.nextId++}`
      inv.items[key] = { id: key, itemId, location: { kind: 'board', index }, reservedBy: null }; inv.board[index].instanceId = key
    }
    const runtime = new GameRuntime(world, { catalog, saved: envelopeFixture(data), now: () => testNow }); let frame = 0; runtime.advanceFrame(0)
    const pump = (ms: number) => { for (let i = 0; i < ms; i += 50) runtime.advanceFrame(frame += 50) }
    const send = async (cmd: GameCommand) => { const promise = runtime.dispatch(cmd); pump(50); return promise }
    expect(await send({ type: 'shop-buy', productId: id === cases[0] ? 'corner-blueprint' : 'court-blueprint' })).toMatchObject({ accepted: true })
    expect(await send({ type: 'building-place', blueprintId: id, origin: { x: 7, y: 2 }, rotation: 0 })).toMatchObject({ accepted: true })
    for (const config of bp.parts) {
      expect(await send({ type: 'building-interact', buildingId: 'b1', partId: config.id })).toMatchObject({ accepted: true })
      pump(8000)
      expect(runtime.getSaveData().construction.buildings[0].parts[config.id].built).toBe(true)
    }
    const saved = validateSave(JSON.parse(runtime.exportSave()), world, catalog), b = saved.data.construction.buildings[0]
    expect(saved.data.production.inventory.gold).toBe(id === cases[0] ? 680 : 1000)
    expect(saved.data.production.inventory.gems).toBe(id === cases[0] ? 100 : 55)
    const wall = bp.parts.find(p => p.kind === 'wall')!, segments = buildingSegments(bp, wall)
    setSegmentHp(b.parts.walls, segments[0].id, 0)
    const loaded = new GameRuntime(world, { catalog, saved: validateSave(saved, world, catalog), now: () => testNow }); loaded.advanceFrame(0)
    const repairing = loaded.dispatch({ type: 'building-interact', buildingId: 'b1', partId: 'walls', segmentId: segments[0].id }); loaded.advanceFrame(50)
    expect(await repairing).toMatchObject({ accepted: true })
    for (let time = 100; time <= 10000; time += 50) loaded.advanceFrame(time)
    const repaired = validateSave(JSON.parse(loaded.exportSave()), world, catalog)
    expect(repaired.data.construction.buildings[0].parts.walls.segments).toEqual(Object.fromEntries(segments.map(s => [s.id, wall.hp])))
    expect(repaired.data.construction.xp).toBe(saved.data.construction.xp)
  })
  it('upgrades only the prior economy version and refuses forged new purchases in an old version', () => {
    const save = envelopeFixture(); save.data.economy!.version = PRE_SHAPES_ECONOMY_VERSION
    const before = structuredClone(save.data), migrated = validateSave(save, world, catalog)
    expect(migrated.data.economy!.version).toBe(ECONOMY_VERSION)
    expect(migrated.data.production).toEqual(before.production)
    expect(migrated.data.construction).toEqual(before.construction)
    save.data.economy!.purchases.push('corner-blueprint')
    expect(() => validateSave(save, world, catalog)).toThrow()
  })
  it('retains an old rectangular house, damaged neighbor and paid repair across the economy upgrade', async () => {
    const data = dataFixture(), b = completed('cabin'); b.origin = { x: 7, y: 10 }
    data.cell = { x: 8, y: 11 }; data.survival.spawnRemaining = 160
    data.construction.buildings = [b]; data.construction.nextId = 2; data.construction.xp = 70
    setSegmentHp(b.parts.walls, 'edge0', 8); setSegmentHp(b.parts.walls, 'edge1', 3)
    const inv = data.production.inventory, index = inv.board.findIndex(s => !s.instanceId && s.lock === 0), key = `i${inv.nextId++}`
    inv.items[key] = { id: key, itemId: 202, location: { kind: 'board', index }, reservedBy: null }; inv.board[index].instanceId = key
    const runtime = new GameRuntime(world, { catalog, saved: envelopeFixture(data), now: () => testNow }); runtime.advanceFrame(0)
    const promise = runtime.dispatch({ type: 'building-interact', buildingId: 'b1', partId: 'walls', segmentId: 'edge0' }); runtime.advanceFrame(50)
    expect(await promise).toMatchObject({ accepted: true })
    const old = JSON.parse(runtime.exportSave()); old.data.economy.version = PRE_SHAPES_ECONOMY_VERSION
    expect(old.data.construction.jobs[0].phase).toBe('building')
    const upgraded = validateSave(old, world, catalog)
    expect(upgraded.data.construction).toEqual(old.data.construction)
    expect(upgraded.data.production.inventory).toEqual(old.data.production.inventory)
    const loaded = new GameRuntime(world, { catalog, saved: upgraded, now: () => testNow }); loaded.advanceFrame(0)
    for (let t = 50; t <= 2100; t += 50) loaded.advanceFrame(t)
    const after = validateSave(JSON.parse(loaded.exportSave()), world, catalog)
    expect(after.data.construction.buildings[0].parts.walls.segments).toMatchObject({ edge0: 20, edge1: 3 })
    expect(after.data.production.inventory).toEqual(old.data.production.inventory)
    expect(after.data.construction.xp).toBe(70)
  })
})
