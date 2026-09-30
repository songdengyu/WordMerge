import { BLUEPRINTS, blueprintById, type Blueprint, type BuildingPartConfig } from './buildingConfig'
import { matchRequirements, type InventoryState, type ProductionState } from './inventory'
import { PathSearch, type NavigationGrid } from './navigation'
import { edgeKey, sameCell, type Cell, type WorldMap } from './world'

export type Rotation = 0 | 1 | 2 | 3
export interface BuildingPart { hp: number; built: boolean; xpGranted: boolean }
export interface Building { id: string; blueprintId: string; origin: Cell; rotation: Rotation; parts: Record<string, BuildingPart> }
export interface BuildingOrder { id: string; buildingId: string; partId: string; mode: 'build' | 'repair' }
export interface ConstructionJob {
  orderId: string
  phase: 'queued' | 'travel' | 'building'
  reservedIds: string[]
  workCell: Cell | null
  remaining: number
}
export interface ConstructionState {
  unlockedBlueprints: string[]
  buildings: Building[]
  orders: BuildingOrder[]
  jobs: ConstructionJob[]
  nextId: number
  xp: number
}
export type ConstructionCommand =
  | { type: 'building-place'; blueprintId: string; origin: Cell; rotation: Rotation }
  | { type: 'building-remove'; buildingId: string }
  | { type: 'building-order'; buildingId: string; partId: string }
  | { type: 'building-interact'; buildingId: string; partId: string }
  | { type: 'building-claim'; orderId: string }
  | { type: 'building-cancel'; orderId: string }

export const createConstruction = (): ConstructionState => ({ unlockedBlueprints: ['cabin'], buildings: [], orders: [], jobs: [], nextId: 1, xp: 0 })
export function localToWorld(building: Pick<Building, 'origin' | 'rotation'>, cell: Cell): Cell {
  const { x, y } = cell
  const rotated = [{ x, y }, { x: -y, y: x }, { x: -x, y: -y }, { x: y, y: -x }][building.rotation]
  return { x: building.origin.x + rotated.x, y: building.origin.y + rotated.y }
}
export function footprint(building: Pick<Building, 'origin' | 'rotation'>, blueprint: Blueprint) {
  return Array.from({ length: blueprint.width * blueprint.height }, (_, i) => localToWorld(building, { x: i % blueprint.width, y: Math.floor(i / blueprint.width) }))
}
export function buildingAt(state: ConstructionState, cell: Cell) {
  return state.buildings.find(building => footprint(building, blueprintById(building.blueprintId)!).some(other => sameCell(other, cell)))
}
export function getOrderTarget(state: ConstructionState, order: BuildingOrder) {
  const building = state.buildings.find(building => building.id === order.buildingId)!
  const config = blueprintById(building.blueprintId)!.parts.find(part => part.id === order.partId)!
  return { building, config, part: building.parts[order.partId] }
}
export const orderMaterials = (state: ConstructionState, order: BuildingOrder) => {
  const { config } = getOrderTarget(state, order)
  return order.mode === 'repair' ? config.repairMaterials : config.materials
}
export const orderSeconds = (config: BuildingPartConfig, order: BuildingOrder) => order.mode === 'repair' ? config.repairSeconds : config.seconds

/** Derived navigation only. Buildings and HP remain owned by the runtime. */
export function constructionNavigation(world: WorldMap, state: ConstructionState, actor: 'friendly' | 'enemy' = 'friendly'): NavigationGrid {
  const blocked = new Set<string>()
  for (const building of state.buildings) for (const config of blueprintById(building.blueprintId)!.parts) {
    const part = building.parts[config.id]
    if (!part.built || part.hp <= 0 || (config.kind === 'door' && actor === 'friendly')) continue
    for (const edge of config.edges) blocked.add(edgeKey(localToWorld(building, edge.from), localToWorld(building, edge.to)))
  }
  return { isWalkable: cell => world.isWalkable(cell), canStep: (from, to) => world.canStep(from, to) && !blocked.has(edgeKey(from, to)) }
}
export function reachable(grid: NavigationGrid, from: Cell, to: Cell, world: WorldMap) {
  return new PathSearch(grid, from, to).advance(world.config.chunks.length * 256 + 1).status === 'found'
}
export function placementError(world: WorldMap, state: ConstructionState, blueprintId: string, origin: Cell, rotation: Rotation, player: Cell): string | null {
  const blueprint = blueprintById(blueprintId)
  if (!blueprint || (!state.unlockedBlueprints.includes(blueprintId) && !(blueprint.fixedRegion && world.chunkAt(origin)?.id === blueprint.fixedRegion && world.chunkAt(origin)?.unlocked))) return '尚未获得这张蓝图'
  if (!Number.isSafeInteger(origin.x) || !Number.isSafeInteger(origin.y) || ![0, 1, 2, 3].includes(rotation)) return '请选择有效的地块与朝向'
  if (!blueprint.fixedRegion && state.buildings.filter(b => !blueprintById(b.blueprintId)?.fixedRegion).length >= 16) return '这片营地的建筑已达上限'
  if (blueprint.fixedRegion && state.buildings.some(b => b.blueprintId === blueprintId)) return '这座区域建筑已经存在'
  const candidate: Building = { id: 'preview', blueprintId, origin, rotation,
    parts: Object.fromEntries(blueprint.parts.map(part => [part.id, { hp: part.hp, built: true, xpGranted: false }])) }
  const cells = footprint(candidate, blueprint)
  if (cells.some(cell => !world.isWalkable(cell))) return '请放在已开放的空地上，避开树木、水面和岩石'
  // Keep one clear tile between blueprints, protecting doors and future work access.
  const occupied = state.buildings.flatMap(building => footprint(building, blueprintById(building.blueprintId)!))
  if (cells.some(cell => occupied.some(other => Math.max(Math.abs(other.x - cell.x), Math.abs(other.y - cell.y)) <= 1))) return '建筑之间需要留出一格通道'
  const complete = { ...state, buildings: [...state.buildings.map(building => ({ ...building,
    parts: Object.fromEntries(blueprintById(building.blueprintId)!.parts.map(part => [part.id, { hp: part.hp, built: true, xpGranted: true }])) })), candidate] }
  const grid = constructionNavigation(world, complete)
  for (const building of complete.buildings) for (const part of blueprintById(building.blueprintId)!.parts) {
    if (!part.work.some(cell => reachable(grid, player, localToWorld(building, cell), world))) return '建成后工作位不可达，请为木门留出通往营地的小径'
  }
  if (!reachable(grid, player, world.config.spawn, world)) return '这里会封住回营地的小径'
  return null
}

export function orderError(state: ConstructionState, order: BuildingOrder): string | null {
  const { building, config, part } = getOrderTarget(state, order)
  if (order.mode === 'build' ? part.built : !part.built || part.hp >= config.hp) return '该部件不需要施工或修复'
  if (config.requires.some(id => !building.parts[id].built)) return '请先完成前置部件'
  return null
}
export function releaseJob(state: ConstructionState, inventory: InventoryState, orderId: string) {
  for (const item of Object.values(inventory.items)) if (item.reservedBy === orderId) item.reservedBy = null
  state.jobs = state.jobs.filter(job => job.orderId !== orderId)
}

export function applyConstructionCommand(original: ConstructionState, production: ProductionState, world: WorldMap, player: Cell, command: ConstructionCommand) {
  const state = structuredClone(original), nextProduction = structuredClone(production), inventory = nextProduction.inventory
  const reject = (reason: string) => ({ accepted: false as const, reason })
  const accept = (message: string, openProduction = false) => ({ accepted: true as const, state, production: nextProduction, message, openProduction })
  const claim = (order: BuildingOrder) => {
    if (state.jobs.some(job => job.orderId === order.id)) return reject('该工程已经安排，请勿重复领取')
    const error = orderError(state, order)
    if (error) return reject(error)
    const ids = matchRequirements(inventory, orderMaterials(state, order))
    if (!ids) return reject('可用物资不足，请在棋盘或仓库备齐材料')
    ids.forEach(id => { inventory.items[id].reservedBy = order.id })
    state.jobs.push({ orderId: order.id, phase: 'queued', reservedIds: ids, workCell: null, remaining: 0 })
    return accept(state.jobs.length > 1 ? '材料已预留，工程加入队列' : '材料已预留，正在前往工作位')
  }
  if (command.type === 'building-place') {
    if (blueprintById(command.blueprintId)?.fixedRegion) return reject('这座大屋随区域发现，不能另行放置')
    const error = placementError(world, state, command.blueprintId, command.origin, command.rotation, player)
    if (error) return reject(error)
    const blueprint = blueprintById(command.blueprintId)!
    state.buildings.push({ id: `b${state.nextId++}`, blueprintId: blueprint.id, origin: command.origin, rotation: command.rotation,
      parts: Object.fromEntries(blueprint.parts.map(part => [part.id, { hp: 0, built: false, xpGranted: false }])) })
    return accept('图纸已放好，先为木地基准备材料')
  }
  if (command.type === 'building-remove') {
    const building = state.buildings.find(building => building.id === command.buildingId)
    if (building && blueprintById(building.blueprintId)?.fixedRegion) return reject('这是区域中的固定地基，不能收回')
    if (!building || Object.values(building.parts).some(part => part.built)
      || state.jobs.some(job => state.orders.find(order => order.id === job.orderId)?.buildingId === building.id)) return reject('只能收回未开工、没有预留的图纸')
    state.orders = state.orders.filter(order => order.buildingId !== building.id)
    state.buildings = state.buildings.filter(other => other.id !== building.id)
    return accept('已收回图纸，可重新选址')
  }
  if (command.type === 'building-order' || command.type === 'building-interact') {
    const building = state.buildings.find(building => building.id === command.buildingId)
    if (!building || !Object.prototype.hasOwnProperty.call(building.parts, command.partId)) return reject('找不到这个建筑部件')
    const order: BuildingOrder = { id: `${building.id}:${command.partId}`, buildingId: building.id, partId: command.partId,
      mode: building.parts[command.partId].built ? 'repair' : 'build' }
    const error = orderError(state, order)
    if (error) return reject(error)
    if (!state.orders.some(other => other.id === order.id)) state.orders.push(order)
    if (command.type === 'building-interact') {
      if (state.jobs.some(job => job.orderId === order.id)) return reject('该工程已经安排，请勿重复领取')
      if (matchRequirements(inventory, orderMaterials(state, order))) return claim(order)
      return accept('还缺一些材料，去工坊合成吧', true)
    }
    return accept('工程订单已打开，棋盘与仓库一起备料')
  }
  const order = state.orders.find(order => order.id === command.orderId)
  if (!order) return reject('工程订单已完成或不存在')
  const job = state.jobs.find(job => job.orderId === order.id)
  if (command.type === 'building-cancel') {
    if (job?.phase === 'building') return reject('已经开工，完成前无法中断')
    releaseJob(state, inventory, order.id)
    return accept('已取消安排，预留物资已在原格释放')
  }
  return claim(order)
}

/** Used by simulation damage events, never by a view or an animation callback. No deferred damage. */
export function constructionDamage(state: ConstructionState, production: ProductionState,
  target: 'player' | { buildingId: string; partId: string }, amount: number) {
  const next = structuredClone(state), nextProduction = structuredClone(production)
  const active = next.jobs.find(job => job.phase === 'building')
  const protectedOrder = active && next.orders.find(order => order.id === active.orderId)
  if (!Number.isFinite(amount) || amount <= 0) return { state, production }
  if (target === 'player') {
    if (!active) nextProduction.vitals.hp = Math.max(0, nextProduction.vitals.hp - amount)
  } else {
    const part = next.buildings.find(building => building.id === target.buildingId)?.parts[target.partId]
    if (part?.built && !(protectedOrder?.buildingId === target.buildingId && protectedOrder.partId === target.partId)) part.hp = Math.max(0, part.hp - amount)
  }
  return { state: next, production: nextProduction }
}

export function buildingSummary(building: Building) {
  const config = blueprintById(building.blueprintId)!
  const intact = (kind: BuildingPartConfig['kind']) => config.parts.filter(part => part.kind === kind).every(part => building.parts[part.id].built && building.parts[part.id].hp > 0)
  return { rainproof: intact('roof'), enclosed: intact('wall') && intact('door'), rest: intact('bed'),
    complete: config.parts.every(part => building.parts[part.id].built), builtCount: config.parts.filter(part => building.parts[part.id].built).length }
}

export { BLUEPRINTS }
