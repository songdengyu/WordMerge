import type { ProductionState } from './inventory'
import { fingerprint, type ProductionCatalog } from './productionConfig'
import { STAMINA_INTERVAL_MS } from './stamina'
import { cellKey, sameCell, type Cell, type WorldMap } from './world'
import { createConstruction, getOrderTarget, orderSeconds, type ConstructionState } from './construction'
import { BUILDING_VERSION } from './buildingConfig'
import { validateConstruction } from './constructionValidation'
import { initialConstructionSeconds, M3_INITIAL_BUILDING_VERSION } from './migrations/constructionTiming'
import { beginFailure, createSurvival, worldMinutes, type SurvivalState } from './survival'
import { SURVIVAL_VERSION } from './survivalConfig'
import { validateSurvival } from './survivalValidation'
import { createProgression, progressedWorld, type ProgressionState } from './progression'
import { PROGRESSION_VERSION, REGIONS } from './progressionConfig'
import { validateProgression } from './progressionValidation'
import { canWalkLine, finitePoint, pointCell } from './smoothNavigation'

export interface RuntimeData {
  elapsedSeconds: number
  cell: Cell
  progress: number
  /** Present for continuous movement; legacy cell/progress saves are still accepted. */
  motion?: { version: 1; position: Cell }
  route: Cell[]
  destination: Cell | null
  searching: boolean
  production: ProductionState
  construction: ConstructionState
  survival: SurvivalState
  progression: ProgressionState
}
export interface SaveEnvelope {
  schemaVersion: 4
  configVersion: string
  revision: number
  savedAt: number
  data: RuntimeData
}
export class SaveError extends Error {
  constructor(message: string, readonly kind: 'invalid' | 'incompatible' | 'conflict' | 'storage' = 'invalid', readonly raw?: unknown) { super(message) }
}
export const legacyConfigVersion = (world: WorldMap, catalog: ProductionCatalog) => `m2-${fingerprint(JSON.stringify(world.config))}-${catalog.fingerprint}`
export const m3ConfigVersion = (world: WorldMap, catalog: ProductionCatalog) => `m3-${fingerprint(JSON.stringify(world.config))}-${catalog.fingerprint}-${BUILDING_VERSION}`
export const m4ConfigVersion = (world: WorldMap, catalog: ProductionCatalog) => `m4-${fingerprint(JSON.stringify(world.config))}-${catalog.fingerprint}-${BUILDING_VERSION}-${SURVIVAL_VERSION}`
export const configVersion = (world: WorldMap, catalog: ProductionCatalog) => `m5-${fingerprint(JSON.stringify(world.config))}-${catalog.fingerprint}-${BUILDING_VERSION}-${SURVIVAL_VERSION}-${PROGRESSION_VERSION}`
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0
const cell = (value: unknown): value is Cell => record(value) && Number.isSafeInteger(value.x) && Number.isSafeInteger(value.y)
const point = (value: unknown): value is Cell => record(value) && typeof value.x === 'number' && typeof value.y === 'number' && finitePoint(value as Cell)
function check(condition: unknown, name: string): asserts condition {
  if (!condition) throw new SaveError(`存档校验失败：${name}`)
}

export function validateSave(raw: unknown, world: WorldMap, catalog: ProductionCatalog): SaveEnvelope {
  check(record(raw), '文件格式')
  check(integer(raw.schemaVersion) && typeof raw.configVersion === 'string', '版本信息缺失或无效')
  if (![1, 2, 3, 4].includes(raw.schemaVersion)) throw new SaveError('存档版本不兼容，原文件已保留；请使用相应版本的游戏。', 'incompatible')
  const legacy = raw.schemaVersion === 1
  const oldTiming = raw.schemaVersion === 2 && raw.configVersion === `m3-${fingerprint(JSON.stringify(world.config))}-${catalog.fingerprint}-${M3_INITIAL_BUILDING_VERSION}`
  if (!oldTiming && raw.configVersion !== (legacy ? legacyConfigVersion(world, catalog) : raw.schemaVersion === 2 ? m3ConfigVersion(world, catalog) : raw.schemaVersion === 3 ? m4ConfigVersion(world, catalog) : configVersion(world, catalog))) throw new SaveError('存档与当前地图 / 物品 / 建筑 / 生存 / 剧情配置不匹配，未覆盖原存档。', 'incompatible')
  check(integer(raw.revision) && integer(raw.savedAt), '版本序号或保存时间')
  const data = raw.data
  check(record(data), '游戏数据')
  if (raw.schemaVersion === 4) {
    check(record(data.progression) && Array.isArray(data.progression.unlockedRegions) && data.progression.unlockedRegions.every(id => REGIONS.some(r => r.id === id)), '区域数据')
    world = progressedWorld(world, data.progression as unknown as ProgressionState)
  } else world = progressedWorld(world, createProgression())
  check(record(data) && finite(data.elapsedSeconds) && cell(data.cell) && world.isWalkable(data.cell), '世界时间或角色位置')
  check(finite(data.progress) && data.progress < 1 && typeof data.searching === 'boolean', '移动进度')
  const continuous = data.motion !== undefined
  if (continuous) check(record(data.motion) && data.motion.version === 1 && point(data.motion.position)
    && sameCell(pointCell(data.motion.position), data.cell) && canWalkLine(world, data.motion.position, data.motion.position) && data.progress === 0, '连续移动位置')
  check(Array.isArray(data.route) && data.route.length <= world.config.chunks.length * 256 * (continuous ? 8 : 1), '路径长度')
  let from: Cell = continuous ? (data.motion as { position: Cell }).position : data.cell
  const seenCells = new Set<string>()
  for (const next of data.route) {
    check((continuous ? point(next) && canWalkLine(world, from, next) : cell(next) && world.canStep(from, next))
      && !seenCells.has(cellKey(next as Cell)), '路径不可达或重复')
    check(point(next), '路径坐标')
    seenCells.add(cellKey(next)); from = next
  }
  check(data.route.length > 0 || data.progress === 0, '空路径不能含移动进度')
  check(data.destination === null || (continuous ? point(data.destination) && canWalkLine(world, data.destination, data.destination)
    : cell(data.destination) && world.isWalkable(data.destination)), '目的地')
  check(!data.searching || data.destination !== null, '待寻路目标缺失')
  check(data.searching || data.destination === null || sameCell(from, data.destination as Cell), '路径终点')
  const production = data.production
  check(record(production) && record(production.stamina) && record(production.vitals) && record(production.inventory), '物品或角色数据')
  const stamina = production.stamina
  check(integer(stamina.value) && integer(stamina.anchorMs) && finite(stamina.remainderMs)
    && stamina.remainderMs < STAMINA_INTERVAL_MS && (stamina.value < 100 || stamina.remainderMs === 0), '体力计时')
  for (const stat of ['hp', 'hunger', 'water', 'temperature']) check(finite(production.vitals[stat]) && production.vitals[stat] <= 100, `属性 ${stat}`)
  if (production.supplyOrders !== undefined) {
    check(Array.isArray(production.supplyOrders) && production.supplyOrders.length <= 3, '补给订单')
    const stats = new Set<string>()
    for (const order of production.supplyOrders) {
      check(record(order) && typeof order.stat === 'string' && ['hp', 'hunger', 'water'].includes(order.stat)
        && !stats.has(order.stat) && typeof order.itemId === 'number' && catalog.effects.get(order.itemId)?.stat === order.stat, '补给订单内容或重复')
      stats.add(order.stat)
    }
  }
  const inventory = production.inventory
  check(Array.isArray(inventory.board) && inventory.board.length === 63, '棋盘尺寸')
  check(Array.isArray(inventory.warehouse) && inventory.warehouse.length >= 6 && inventory.warehouse.length <= 24
    && (inventory.warehouse.length - 6) % 3 === 0, '仓库容量')
  check(record(inventory.items) && Object.keys(inventory.items).length <= 87, '物品实例表')
  check(integer(inventory.nextId) && inventory.nextId > 0 && integer(inventory.randomState)
    && inventory.randomState > 0 && inventory.randomState <= 0xffffffff, '物品序号或随机状态')
  check(integer(inventory.gold) && integer(inventory.gems), '货币')
  check(Array.isArray(inventory.completedOrders) && new Set(inventory.completedOrders).size === inventory.completedOrders.length
    && inventory.completedOrders.every(id => catalog.orders.some(order => order.id === id)), '委托完成记录')
  const seen = new Set<string>()
  const visit = (id: unknown, kind: 'board' | 'warehouse', index: number) => {
    if (id === null) return
    check(typeof id === 'string' && /^i[1-9]\d*$/.test(id) && !seen.has(id), '物品重复占格或实例 ID 无效')
    const item = (inventory.items as Record<string, unknown>)[id]
    check(record(item) && item.id === id && typeof item.itemId === 'number' && catalog.itemById.has(item.itemId), `实例 ${id} 配置缺失`)
    check(record(item.location) && item.location.kind === kind && item.location.index === index
      && (item.reservedBy === null || (!legacy && typeof item.reservedBy === 'string')), `实例 ${id} 归属或预留异常`)
    check(Number(id.slice(1)) < (inventory.nextId as number), '物品序号倒退')
    if (kind === 'warehouse') check(catalog.itemById.get(item.itemId)?.itemType !== 'generator', '生成器不得入仓')
    seen.add(id)
  }
  inventory.board.forEach((slot, index) => {
    check(record(slot) && [0, 1, 2].includes(Number(slot.lock)) && typeof slot.lock === 'number' && typeof slot.rewardClaimed === 'boolean', `棋盘格 ${index}`)
    check(slot.lock === 0 || slot.instanceId !== null, '锁格缺少可解锁物品')
    visit(slot.instanceId, 'board', index)
  })
  inventory.warehouse.forEach((id, index) => visit(id, 'warehouse', index))
  check(seen.size === Object.keys(inventory.items).length, '物品游离于棋盘和仓库之外')
  const expectedChains = new Set(catalog.initialBoard.flatMap(slot => {
    const item = slot.itemId === null ? null : catalog.itemById.get(slot.itemId)
    return item?.itemType === 'generator' ? [item.chain] : []
  }))
  for (const id of seen) {
    const item = inventory.items[id] as { itemId: number }
    const config = catalog.itemById.get(item.itemId)!
    if (config.itemType === 'generator') expectedChains.delete(config.chain)
  }
  check(expectedChains.size === 0, '关键生成器来源丢失')
  const migrated = structuredClone(raw) as unknown as SaveEnvelope
  // Additive UI-driven orders: older schema 4 saves have none, without changing existing progress.
  migrated.data.production.supplyOrders ??= []
  if (legacy) {
    migrated.data.construction = createConstruction()
  }
  validateConstruction(migrated.data.construction, migrated.data, world, check, oldTiming ? initialConstructionSeconds : orderSeconds)
  if (oldTiming) {
    for (const job of migrated.data.construction.jobs) {
      if (job.phase !== 'building') continue
      const order = migrated.data.construction.orders.find(order => order.id === job.orderId)!
      const { config } = getOrderTarget(migrated.data.construction, order)
      job.remaining = job.remaining / initialConstructionSeconds(config, order) * orderSeconds(config, order)
    }
    migrated.configVersion = configVersion(world, catalog)
    validateConstruction(migrated.data.construction, migrated.data, world, check)
  }
  if (raw.schemaVersion < 3) {
    migrated.data.survival = createSurvival(world, migrated.data.elapsedSeconds)
    if (migrated.data.production.vitals.hp === 0) {
      const result = beginFailure(migrated.data.survival, migrated.data.production, migrated.data.construction, catalog, worldMinutes(world, migrated.data.elapsedSeconds), 'environment')
      migrated.data.survival = result.state; migrated.data.production = result.production; migrated.data.construction = result.construction
    }
  }
  if (record(migrated.data.survival) && migrated.data.survival.taming === undefined) {
    migrated.data.survival.taming = { ordered: false, job: null }
  }
  validateSurvival(migrated.data.survival, migrated.data, world, catalog, check)
  // Both job systems validate exact ownership before the shared orphan check.
  const reserved = new Set([...migrated.data.construction.jobs.flatMap(job => job.reservedIds),
    ...(migrated.data.survival.taming.job?.reservedIds ?? [])])
  for (const item of Object.values(migrated.data.production.inventory.items)) check(item.reservedBy === null || reserved.has(item.id), '孤立的物资预留')
  if (raw.schemaVersion < 4) migrated.data.progression = createProgression()
  validateProgression(migrated.data.progression, migrated.data, world, check)
  migrated.schemaVersion = 4; migrated.configVersion = configVersion(world, catalog)
  return migrated
}

export function parseSaveFile(text: string, world: WorldMap, catalog: ProductionCatalog) {
  if (text.length > 2_000_000) throw new SaveError('存档文件过大')
  let value: unknown
  try { value = JSON.parse(text) } catch { throw new SaveError('无法读取 JSON 存档，请选择导出的备份文件') }
  return validateSave(value, world, catalog)
}
