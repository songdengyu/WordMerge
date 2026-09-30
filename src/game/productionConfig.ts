import { parseBoard, parseItems, validateItems, type InitialMergeCell, type MergeItemConfig } from '../data/mergeConfig'
import { parseCsv } from '../data/csv'

export type UseEffectConfig = { stat: 'stamina' | 'hunger' | 'water' | 'hp'; amount: number }
export interface ProductionOrder { id: number; name: string; requirements: number[]; rewardItemId: number; quantity: number; gems: number }
export interface ProductionCatalog {
  items: readonly MergeItemConfig[]
  itemById: ReadonlyMap<number, MergeItemConfig>
  initialBoard: readonly InitialMergeCell[]
  effects: ReadonlyMap<number, UseEffectConfig>
  orders: readonly ProductionOrder[]
  fingerprint: string
}

/** Detects accidental config mismatch; not an anti-tamper checksum. */
export function fingerprint(text: string) {
  let hash = 2166136261
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619)
  return (hash >>> 0).toString(16)
}
function integer(text: string, label: string, min = 0) {
  const value = Number(text)
  if (!text || !Number.isSafeInteger(value) || value < min) throw new Error(`${label} 必须为至少 ${min} 的整数`)
  return value
}
export function parseProductionConfig(texts: readonly string[]): ProductionCatalog {
  const [itemsText, boardText, effectsText, ordersText] = texts
  const items = parseItems(itemsText)
  if (!items.length) throw new Error('survival/merge/items.csv 不能为空')
  const itemById = validateItems(items)
  for (const item of items) {
    if (item.id <= 0 || item.level < 1 || item.chain < 1 || (item.openCost !== null && item.openCost < 0)) throw new Error(`棋子 ${item.id} 的等级、链或成本无效`)
    if (item.nextId) {
      const next = itemById.get(item.nextId)!
      if (next.chain !== item.chain || next.level !== item.level + 1 || next.itemType !== item.itemType) throw new Error(`棋子 ${item.id} 升级链不连续`)
    }
    for (const drop of item.drops) if (itemById.get(drop.itemId)?.itemType === 'generator') throw new Error(`生成器 ${item.id} 不能随机生成关键来源`)
  }
  const effects = new Map<number, UseEffectConfig>()
  for (const row of parseCsv(effectsText)) {
    const id = integer(row.item_id, 'effects.csv item_id', 1)
    if (!itemById.has(id) || effects.has(id) || itemById.get(id)?.itemType === 'generator') throw new Error(`effects.csv 棋子 ${id} 无效或重复`)
    if (!['stamina', 'hunger', 'water', 'hp'].includes(row.stat)) throw new Error(`effects.csv 棋子 ${id} 效果无效`)
    effects.set(id, { stat: row.stat as UseEffectConfig['stat'], amount: integer(row.amount, `effects.csv 棋子 ${id} amount`, 1) })
  }
  for (const item of items) if (item.itemType === 'special' && !effects.has(item.id)) throw new Error(`特殊棋子 ${item.id} 缺少使用效果`)
  const orders = parseCsv(ordersText).map((row, index): ProductionOrder => {
    const id = integer(row.order_id, `orders.csv 第 ${index + 2} 行 order_id`, 1)
    if (id !== index + 1) throw new Error('orders.csv 订单 ID 必须连续')
    const requirements = row.requirements.split(/[；|]/).filter(Boolean).map(value => integer(value, `订单 ${id} requirements`, 1))
    if (!requirements.length || requirements.some(id => !itemById.has(id) || itemById.get(id)?.itemType === 'generator')) throw new Error(`订单 ${id} 需求无效，不可交付生成器`)
    const rewardItemId = integer(row.reward_item_id, `订单 ${id} reward_item_id`, 1)
    if (!itemById.has(rewardItemId) || itemById.get(rewardItemId)?.itemType === 'generator') throw new Error(`订单 ${id} 奖励无效`)
    return { id, name: row.name || `营地委托 ${id}`, requirements, rewardItemId,
      quantity: integer(row.quantity, `订单 ${id} quantity`, 1), gems: integer(row.reward_gems, `订单 ${id} reward_gems`) }
  })
  return { items, itemById, effects, orders, initialBoard: parseBoard(boardText, itemById), fingerprint: fingerprint(texts.join('\n---\n')) }
}
export async function loadProductionConfig(signal: AbortSignal) {
  const names = ['items.csv', 'initial-board.csv', 'effects.csv', 'orders.csv']
  const texts = await Promise.all(names.map(async name => {
    const response = await fetch(`${import.meta.env.BASE_URL}config/survival/merge/${name}`, { signal })
    if (!response.ok) throw new Error(`survival/merge/${name} 加载失败 (${response.status})`)
    return response.text()
  }))
  return parseProductionConfig(texts)
}
