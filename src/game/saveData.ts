import type { ProductionState } from './inventory'
import { fingerprint, type ProductionCatalog } from './productionConfig'
import { STAMINA_INTERVAL_MS } from './stamina'
import { cellKey, sameCell, type Cell, type WorldMap } from './world'
import { createConstruction, getOrderTarget, orderSeconds, type ConstructionState } from './construction'
import { BUILDING_VERSION } from './buildingConfig'
import { validateConstruction } from './constructionValidation'
import { initialConstructionSeconds, M3_INITIAL_BUILDING_VERSION } from './migrations/constructionTiming'

export interface RuntimeData {
  elapsedSeconds: number
  cell: Cell
  progress: number
  route: Cell[]
  destination: Cell | null
  searching: boolean
  production: ProductionState
  construction: ConstructionState
}
export interface SaveEnvelope {
  schemaVersion: 2
  configVersion: string
  revision: number
  savedAt: number
  data: RuntimeData
}
export class SaveError extends Error {
  constructor(message: string, readonly kind: 'invalid' | 'incompatible' | 'conflict' | 'storage' = 'invalid', readonly raw?: unknown) { super(message) }
}
export const legacyConfigVersion = (world: WorldMap, catalog: ProductionCatalog) => `m2-${fingerprint(JSON.stringify(world.config))}-${catalog.fingerprint}`
export const configVersion = (world: WorldMap, catalog: ProductionCatalog) => `m3-${fingerprint(JSON.stringify(world.config))}-${catalog.fingerprint}-${BUILDING_VERSION}`
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0
const cell = (value: unknown): value is Cell => record(value) && Number.isSafeInteger(value.x) && Number.isSafeInteger(value.y)
function check(condition: unknown, name: string): asserts condition {
  if (!condition) throw new SaveError(`存档校验失败：${name}`)
}

export function validateSave(raw: unknown, world: WorldMap, catalog: ProductionCatalog): SaveEnvelope {
  check(record(raw), '文件格式')
  check(integer(raw.schemaVersion) && typeof raw.configVersion === 'string', '版本信息缺失或无效')
  if (raw.schemaVersion !== 1 && raw.schemaVersion !== 2) throw new SaveError('存档版本不兼容，原文件已保留；请使用相应版本的游戏。', 'incompatible')
  const legacy = raw.schemaVersion === 1
  const oldTiming = !legacy && raw.configVersion === `m3-${fingerprint(JSON.stringify(world.config))}-${catalog.fingerprint}-${M3_INITIAL_BUILDING_VERSION}`
  if (!oldTiming && raw.configVersion !== (legacy ? legacyConfigVersion(world, catalog) : configVersion(world, catalog))) throw new SaveError('存档与当前地图 / 物品 / 建筑配置不匹配，未覆盖原存档。', 'incompatible')
  check(integer(raw.revision) && integer(raw.savedAt), '版本序号或保存时间')
  const data = raw.data
  check(record(data) && finite(data.elapsedSeconds) && cell(data.cell) && world.isWalkable(data.cell), '世界时间或角色位置')
  check(finite(data.progress) && data.progress < 1 && typeof data.searching === 'boolean', '移动进度')
  check(Array.isArray(data.route) && data.route.length <= world.config.chunks.length * 256, '路径长度')
  let from = data.cell
  const seenCells = new Set<string>()
  for (const next of data.route) {
    check(cell(next) && world.canStep(from, next) && !seenCells.has(cellKey(next)), '路径不可达或重复')
    seenCells.add(cellKey(next)); from = next
  }
  check(data.route.length > 0 || data.progress === 0, '空路径不能含移动进度')
  check(data.destination === null || (cell(data.destination) && world.isWalkable(data.destination)), '目的地')
  check(!data.searching || data.destination !== null, '待寻路目标缺失')
  check(data.searching || data.destination === null || sameCell(from, data.destination as Cell), '路径终点')
  const production = data.production
  check(record(production) && record(production.stamina) && record(production.vitals) && record(production.inventory), '物品或角色数据')
  const stamina = production.stamina
  check(integer(stamina.value) && integer(stamina.anchorMs) && finite(stamina.remainderMs)
    && stamina.remainderMs < STAMINA_INTERVAL_MS && (stamina.value < 100 || stamina.remainderMs === 0), '体力计时')
  for (const stat of ['hp', 'hunger', 'water', 'temperature']) check(finite(production.vitals[stat]) && production.vitals[stat] <= 100, `属性 ${stat}`)
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
  if (legacy) {
    migrated.schemaVersion = 2
    migrated.configVersion = configVersion(world, catalog)
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
  return migrated
}

export function parseSaveFile(text: string, world: WorldMap, catalog: ProductionCatalog) {
  if (text.length > 2_000_000) throw new SaveError('存档文件过大')
  let value: unknown
  try { value = JSON.parse(text) } catch { throw new SaveError('无法读取 JSON 存档，请选择导出的备份文件') }
  return validateSave(value, world, catalog)
}
