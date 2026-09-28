import { parseCsv } from './csv'
import { parseEquipmentConfig, type EquipmentConfig } from './equipmentConfig'

export type { EquipmentConfig } from './equipmentConfig'

export type MergeItemType = 'generator' | 'normal' | 'special'
export type CellLock = 0 | 1 | 2

export interface MergeItemConfig {
  id: number
  itemType: MergeItemType
  chain: number
  level: number
  nextId: number | null
  name: string
  openCost: number | null
  drops: { itemId: number; weight: number }[]
  icon: string
  iconName: string
  description: string
}

export interface MergeOrderConfig {
  id: number
  maxConcurrent: number
  requirements: number[]
  equipmentId: number
  quantity: number
}

export interface InitialMergeCell {
  itemId: number | null
  lock: CellLock
}

export interface MergeConfig {
  items: MergeItemConfig[]
  itemById: Map<number, MergeItemConfig>
  orders: MergeOrderConfig[]
  equipment: Map<number, EquipmentConfig>
  initialBoard: InitialMergeCell[]
  initialGold: number
  initialGems: number
}

const CONFIG_ROOT = `${import.meta.env.BASE_URL}config/merge`

function required(row: Record<string, string>, key: string, source: string): string {
  const value = row[key]
  if (!value) throw new Error(`${source} 缺少字段 ${key}`)
  return value
}

function integer(value: string, label: string): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed)) throw new Error(`${label} 不是整数: ${value}`)
  return parsed
}

function optionalInteger(value: string, label: string): number | null {
  return value ? integer(value, label) : null
}

function parseDrops(value: string, itemId: number) {
  if (!value) return []
  return value.split('|').map((entry) => {
    const [dropId, weight] = entry.split(';')
    const parsedWeight = integer(weight, `棋子 ${itemId} 生成权重`)
    if (parsedWeight <= 0) throw new Error(`棋子 ${itemId} 生成权重必须大于 0`)
    return { itemId: integer(dropId, `棋子 ${itemId} 生成ID`), weight: parsedWeight }
  })
}

function parseItems(text: string): MergeItemConfig[] {
  return parseCsv(text).map((row) => {
    const id = integer(required(row, 'item_id', '棋子配置'), 'item_id')
    const itemType = required(row, 'item_type', `棋子 ${id}`) as MergeItemType
    if (!['generator', 'normal', 'special'].includes(itemType)) {
      throw new Error(`棋子 ${id} 类型无效: ${itemType}`)
    }
    return {
      id,
      itemType,
      chain: integer(required(row, 'chain_type', `棋子 ${id}`), `棋子 ${id} 合成链`),
      level: integer(required(row, 'level', `棋子 ${id}`), `棋子 ${id} 等级`),
      nextId: optionalInteger(row.next_id, `棋子 ${id} 合成后id`),
      name: required(row, 'name', `棋子 ${id}`),
      openCost: optionalInteger(row.open_cost, `棋子 ${id} 开启金币`),
      drops: parseDrops(row.drop_pool, id),
      icon: required(row, 'icon', `棋子 ${id}`),
      iconName: required(row, 'iconName', `棋子 ${id}`),
      description: row.description || '',
    }
  })
}

function validateItems(items: MergeItemConfig[]) {
  const itemById = new Map<number, MergeItemConfig>()
  items.forEach((item) => {
    if (itemById.has(item.id)) throw new Error(`重复棋子 ID: ${item.id}`)
    itemById.set(item.id, item)
  })
  items.forEach((item) => {
    if (item.nextId && !itemById.has(item.nextId)) throw new Error(`棋子 ${item.id} 合成后棋子不存在`)
    item.drops.forEach((drop) => {
      if (!itemById.has(drop.itemId)) throw new Error(`棋子 ${item.id} 生成结果 ${drop.itemId} 不存在`)
    })
    if (item.itemType !== 'generator' && (item.openCost !== null || item.drops.length > 0)) {
      throw new Error(`非生成器 ${item.id} 不能配置开启消耗或掉落`)
    }
    if (item.itemType === 'generator' && item.nextId === null && (item.openCost === null || item.drops.length === 0)) {
      throw new Error(`最高级生成器 ${item.id} 缺少开启配置`)
    }
  })
  return itemById
}

function parseOrders(text: string, itemById: Map<number, MergeItemConfig>): MergeOrderConfig[] {
  const orders = parseCsv(text).map((row) => {
    const id = integer(required(row, 'order_id', '订单配置'), 'order_id')
    const requirements = required(row, 'requirements', `订单 ${id}`)
      .split(/[；|]/)
      .filter(Boolean)
      .map((value) => integer(value, `订单 ${id} 需求`))
    requirements.forEach((itemId) => {
      if (!itemById.has(itemId)) throw new Error(`订单 ${id} 引用了未知棋子 ${itemId}`)
    })
    return {
      id,
      maxConcurrent: Math.min(3, integer(required(row, 'max_concurrent', `订单 ${id}`), `订单 ${id} 并存数`)),
      requirements,
      equipmentId: integer(required(row, 'equipment_id', `订单 ${id}`), `订单 ${id} 装备ID`),
      quantity: integer(required(row, 'quantity', `订单 ${id}`), `订单 ${id} 数量`),
    }
  })
  orders.forEach((order, index) => {
    if (order.id !== index + 1) throw new Error(`订单 ID 必须连续，期望 ${index + 1}，实际 ${order.id}`)
  })
  return orders
}

function parseBoard(text: string, itemById: Map<number, MergeItemConfig>) {
  const rows = parseCsv(text)
  if (rows.length !== 63) throw new Error(`初始棋盘必须有 63 格，实际 ${rows.length}`)
  const seen = new Set<number>()
  const board = Array<InitialMergeCell>(63)
  rows.forEach((row) => {
    const index = integer(required(row, 'cell_index', '初始棋盘'), '棋盘格子')
    if (index < 0 || index >= 63 || seen.has(index)) throw new Error(`初始棋盘格子无效: ${index}`)
    seen.add(index)
    const itemId = optionalInteger(row.item_id, `棋盘格 ${index} item_id`)
    const lock = integer(required(row, 'lock_state', `棋盘格 ${index}`), `棋盘格 ${index} 状态`) as CellLock
    if (![0, 1, 2].includes(lock)) throw new Error(`棋盘格 ${index} 状态无效`)
    if (itemId && !itemById.has(itemId)) throw new Error(`棋盘格 ${index} 引用了未知棋子 ${itemId}`)
    board[index] = { itemId, lock }
  })
  return board
}

export async function loadMergeConfig(): Promise<MergeConfig> {
  const names = ['items.csv', 'orders.csv', 'equipment.csv', 'initial-board.csv']
  const responses = await Promise.all(names.map((name) => fetch(`${CONFIG_ROOT}/${name}`)))
  responses.forEach((response, index) => {
    if (!response.ok) throw new Error(`无法加载 ${names[index]} (${response.status})`)
  })
  const [itemsText, ordersText, equipmentText, boardText] = await Promise.all(responses.map((response) => response.text()))
  const items = parseItems(itemsText)
  const itemById = validateItems(items)
  const orders = parseOrders(ordersText, itemById)
  const equipment = new Map(parseEquipmentConfig(equipmentText).map((item) => [item.id, item]))
  orders.forEach((order) => {
    if (!equipment.has(order.equipmentId)) throw new Error(`订单 ${order.id} 装备 ${order.equipmentId} 未配置`)
  })
  return {
    items,
    itemById,
    orders,
    equipment,
    initialBoard: parseBoard(boardText, itemById),
    initialGold: 2000,
    initialGems: 5000,
  }
}
