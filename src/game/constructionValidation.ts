import { BLUEPRINTS, blueprintById } from './buildingConfig'
import { buildingOrderId, constructionNavigation, createConstruction, footprint, getOrderTarget, localToWorld, orderError, orderMaterials, orderSeconds, placementError, type ConstructionState } from './construction'
import { buildingSegments } from './buildingSegments'
import type { RuntimeData } from './saveData'
import { sameCell, type WorldMap } from './world'
import { canWalkLine } from './smoothNavigation'
import { SHOP_PRODUCTS } from './economyConfig'

type Check = (condition: unknown, message: string) => asserts condition
const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const integer = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0

export function validateConstruction(raw: unknown, data: RuntimeData, world: WorldMap, check: Check,
  duration = orderSeconds, materials = orderMaterials): asserts raw is ConstructionState {
  const blueprints = [BLUEPRINTS[0].id, ...SHOP_PRODUCTS.filter(p => p.category === 'blueprint' && data.economy?.purchases.includes(p.id)).map(p => p.reward)]
  check(record(raw) && Array.isArray(raw.unlockedBlueprints), '蓝图来源')
  const unlocked = raw.unlockedBlueprints
  check(unlocked.length === blueprints.length && new Set(unlocked).size === blueprints.length && blueprints.every(id => unlocked.includes(id)), '蓝图来源')
  check(Array.isArray(raw.buildings) && raw.buildings.length <= 16 + BLUEPRINTS.filter(b => b.fixedRegion).length && Array.isArray(raw.orders) && Array.isArray(raw.jobs), '建筑或工程列表')
  check(integer(raw.nextId) && raw.nextId > 0 && integer(raw.xp), '建筑序号或经验')
  const ids = new Set<string>(), prior = createConstruction()
  prior.unlockedBlueprints = [...blueprints]
  let xp = 0
  for (const entry of raw.buildings) {
    check(record(entry) && typeof entry.id === 'string' && /^b[1-9]\d*$/.test(entry.id) && !ids.has(entry.id) && Number(entry.id.slice(1)) < raw.nextId, '建筑 ID')
    ids.add(entry.id)
    check(typeof entry.blueprintId === 'string' && record(entry.origin) && Number.isSafeInteger(entry.origin.x) && Number.isSafeInteger(entry.origin.y)
      && [0, 1, 2, 3].includes(Number(entry.rotation)) && typeof entry.rotation === 'number', '图纸位置或朝向')
    const blueprint = blueprintById(entry.blueprintId)
    check(blueprint && record(entry.parts) && Object.keys(entry.parts).length === blueprint.parts.length, '建筑部件配置')
    for (const config of blueprint.parts) {
      const part = entry.parts[config.id]
      check(record(part) && typeof part.built === 'boolean' && typeof part.xpGranted === 'boolean'
        && part.built === part.xpGranted && finite(part.hp) && part.hp <= config.hp && (part.built || part.hp === 0), '部件耐久或经验标记')
      if (part.segments !== undefined) {
        const segments = buildingSegments(blueprint, config), hp = part.segments
        check(segments.length > 1 && record(hp) && Object.keys(hp).length === segments.length
          && segments.every(segment => finite(hp[segment.id]) && Number(hp[segment.id]) <= config.hp && (part.built || hp[segment.id] === 0)), '独立部件耐久')
        check(part.hp === Math.min(...Object.values(hp) as number[]), '部件汇总耐久')
      }
      if (part.built) {
        xp += config.xp
        check(config.requires.every(id => record((entry.parts as Record<string, unknown>)[id]) && ((entry.parts as Record<string, Record<string, unknown>>)[id]).built === true), '建筑前置部件')
      }
    }
    const building = entry as unknown as ConstructionState['buildings'][number]
    if (blueprint.fixedRegion) check(footprint(building, blueprint).every(cell => world.chunkAt(cell)?.id === blueprint.fixedRegion), '区域建筑占地')
    check(!placementError(world, prior, building.blueprintId, building.origin, building.rotation, world.config.spawn), '建筑重叠、地形或工作位不可达')
    prior.buildings.push(building)
  }
  check(raw.xp === xp, '建设经验不一致')
  const state = raw as unknown as ConstructionState
  const orderIds = new Set<string>()
  for (const entry of raw.orders) {
    check(record(entry) && typeof entry.buildingId === 'string' && ids.has(entry.buildingId) && typeof entry.partId === 'string'
      && (entry.segmentId === undefined || typeof entry.segmentId === 'string' && entry.segmentId.length > 0)
      && typeof entry.id === 'string' && entry.id === buildingOrderId(entry as unknown as ConstructionState['orders'][number]) && !orderIds.has(entry.id)
      && ['build', 'repair'].includes(String(entry.mode)), '工程订单归属')
    const building = state.buildings.find(building => building.id === entry.buildingId)!
    check(Object.prototype.hasOwnProperty.call(building.parts, entry.partId), '工程部件缺失')
    check(entry.mode !== 'repair' || !building.parts[entry.partId].segments || typeof entry.segmentId === 'string', '修复必须指定独立部件')
    check(!orderError(state, entry as unknown as ConstructionState['orders'][number]), '工程目标已完成或前置未满足')
    orderIds.add(entry.id)
  }
  const jobs = new Set<string>(), reserved = new Set<string>()
  for (const [index, entry] of raw.jobs.entries()) {
    check(record(entry) && typeof entry.orderId === 'string' && orderIds.has(entry.orderId) && !jobs.has(entry.orderId)
      && ['queued', 'travel', 'building'].includes(String(entry.phase)) && Array.isArray(entry.reservedIds)
      && finite(entry.remaining), '工程队列')
    check(index === 0 || entry.phase === 'queued', '同一时刻只能执行一项工程')
    jobs.add(entry.orderId)
    const order = state.orders.find(order => order.id === entry.orderId)!
    const { building, config } = getOrderTarget(state, order)
    if (entry.phase === 'queued') check(entry.workCell === null && entry.remaining === 0, '等待工程不得提前施工')
    else {
      check(record(entry.workCell) && config.work.some(cell => sameCell(localToWorld(building, cell), entry.workCell as { x: number; y: number })), '施工工作位')
      if (entry.phase === 'travel') check(entry.remaining === 0 && data.destination && sameCell(data.destination, entry.workCell as { x: number; y: number }), '前往工作位的目标')
      else check(sameCell(data.cell, entry.workCell as { x: number; y: number }) && !data.route.length && data.progress === 0
        && (!data.motion || sameCell(data.motion.position, data.cell))
        && !data.searching && data.destination === null && entry.remaining > 0 && entry.remaining <= duration(config, order) && !entry.reservedIds.length, '开工位置、计时或扣料异常')
    }
    if (entry.phase !== 'building') {
      const requirements = materials(state, order)
      check(entry.reservedIds.length === requirements.length, '预留数量')
      entry.reservedIds.forEach((id, i) => {
        check(typeof id === 'string' && !reserved.has(id), '重复预留')
        const item = data.production.inventory.items[id]
        check(item && item.reservedBy === entry.orderId && item.itemId === requirements[i]
          && (item.location.kind === 'warehouse' || data.production.inventory.board[item.location.index].lock === 0), '预留实例或原格无效')
        reserved.add(id)
      })
    }
  }
  const grid = constructionNavigation(world, state)
  let from = data.motion?.position ?? data.cell
  if (data.motion) check(canWalkLine(grid, from, from), '角色位置与建筑木墙重叠')
  for (const next of data.route) { check(data.motion ? canWalkLine(grid, from, next) : grid.canStep(from, next), '路径穿过建筑木墙'); from = next }
  // Geometry is kept in tile coordinates, never inferred from rendering positions.
  check(state.buildings.every(building => footprint(building, blueprintById(building.blueprintId)!).every(cell => world.isWalkable(cell))), '建筑占地')
}
