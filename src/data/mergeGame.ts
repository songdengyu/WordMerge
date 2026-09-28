import type { InitialMergeCell, MergeConfig, MergeItemConfig, MergeOrderConfig } from './mergeConfig'
import { getEquipmentDismantleGold } from './equipmentConfig'

export interface MergeCell extends InitialMergeCell {
  rewardClaimed: boolean
}

export interface MergeOrderState {
  configIndex: number
  leaving: boolean
}

export interface MergeEffect {
  id: number
  kind: 'order-reward' | 'order-gold' | 'gold-gain' | 'gold-spend' | 'merge'
  sourceIndex: number
  amount?: number
  equipmentType?: number
  equipmentId?: number
  quantity?: number
}

export interface MergeGameState {
  board: MergeCell[]
  warehouse: number[]
  warehouseCapacity: number
  gold: number
  gems: number
  selectedCell: number | null
  selectedWarehouse: number | null
  activeOrders: MergeOrderState[]
  nextOrderIndex: number
  message: string | null
  animationKey: number
  spawnedCell: number | null
  effects: MergeEffect[]
}

export type MergeGameAction =
  | { type: 'SELECT_CELL'; index: number }
  | { type: 'MOVE_CELL'; from: number; to: number }
  | { type: 'USE_CELL'; index: number }
  | { type: 'COMPLETE_ORDER'; slot: number; alreadyOwned?: boolean }
  | { type: 'FINISH_ORDER_LEAVE'; slot: number }
  | { type: 'STORE_CELL'; index: number }
  | { type: 'SELECT_WAREHOUSE'; index: number }
  | { type: 'PLACE_WAREHOUSE'; warehouseIndex: number; cellIndex: number | null }
  | { type: 'EXPAND_WAREHOUSE' }
  | { type: 'CLEAR_MESSAGE' }
  | { type: 'CLEAR_EFFECT'; id: number }

export const WAREHOUSE_EXPANSION_COSTS = [50, 100, 200, 400, 800, 1600]

function createOrders(config: MergeConfig) {
  const count = Math.min(3, config.orders[0]?.maxConcurrent ?? 0, config.orders.length)
  return {
    activeOrders: Array.from({ length: count }, (_, configIndex) => ({ configIndex, leaving: false })),
    nextOrderIndex: count,
  }
}

export function persistMergeState(state: MergeGameState): MergeGameState {
  return {
    ...state,
    board: state.board.map((cell) => ({ ...cell })),
    warehouse: [...state.warehouse],
    activeOrders: state.activeOrders.map((order) => ({ ...order })),
    selectedCell: null,
    selectedWarehouse: null,
    message: null,
    spawnedCell: null,
    effects: [],
  }
}

export function restoreMergeState(
  snapshot: MergeGameState | null,
  config: MergeConfig,
  gold: number,
  gems: number,
): MergeGameState {
  const matchesBoard = snapshot !== null && snapshot.board.length === config.initialBoard.length
  const base = matchesBoard
    ? persistMergeState(snapshot)
    : createMergeGameState({ ...config, initialGold: gold, initialGems: gems })
  return { ...base, gold, gems }
}

export function createMergeGameState(config: MergeConfig): MergeGameState {
  return {
    board: config.initialBoard.map((cell) => ({ ...cell, rewardClaimed: false })),
    warehouse: [],
    warehouseCapacity: 6,
    gold: config.initialGold,
    gems: config.initialGems,
    selectedCell: null,
    selectedWarehouse: null,
    ...createOrders(config),
    message: null,
    animationKey: 0,
    spawnedCell: null,
    effects: [],
  }
}

function adjacentIndexes(index: number) {
  const row = Math.floor(index / 7)
  const column = index % 7
  const result: number[] = []
  if (row > 0) result.push(index - 7)
  if (row < 8) result.push(index + 7)
  if (column > 0) result.push(index - 1)
  if (column < 6) result.push(index + 1)
  return result
}

function revealNeighbors(board: MergeCell[], unlockedIndex: number) {
  let reward = 0
  const revealedIndexes: number[] = []
  const next = board.map((cell) => ({ ...cell }))
  adjacentIndexes(unlockedIndex).forEach((index) => {
    const cell = next[index]
    if (cell.lock !== 2) return
    cell.lock = 1
    revealedIndexes.push(index)
    if (!cell.rewardClaimed) {
      cell.rewardClaimed = true
      reward += 100
    }
  })
  return { board: next, reward, revealedIndexes }
}

function createCellGoldEffects(state: MergeGameState, indexes: number[], amount: number): MergeEffect[] {
  return indexes.map((sourceIndex, offset) => ({
    id: state.animationKey + offset + 1,
    kind: 'gold-gain',
    sourceIndex,
    amount,
  }))
}

function weightedDrop(item: MergeItemConfig): number | null {
  const total = item.drops.reduce((sum, drop) => sum + drop.weight, 0)
  if (total <= 0) return null
  let roll = Math.random() * total
  for (const drop of item.drops) {
    roll -= drop.weight
    if (roll < 0) return drop.itemId
  }
  return item.drops[item.drops.length - 1]?.itemId ?? null
}

function countBoardItems(board: MergeCell[]) {
  const counts = new Map<number, number>()
  board.forEach((cell) => {
    if (cell.lock === 0 && cell.itemId !== null) counts.set(cell.itemId, (counts.get(cell.itemId) ?? 0) + 1)
  })
  return counts
}

export function canCompleteOrder(state: MergeGameState, order: MergeOrderConfig) {
  const counts = countBoardItems(state.board)
  return order.requirements.every((itemId) => {
    const count = counts.get(itemId) ?? 0
    if (count <= 0) return false
    counts.set(itemId, count - 1)
    return true
  })
}

export function isHighestGeneratorOnBoard(state: MergeGameState, config: MergeConfig, cellIndex: number) {
  const cell = state.board[cellIndex]
  if (!cell || cell.lock !== 0 || cell.itemId === null) return false
  const item = config.itemById.get(cell.itemId)
  if (item?.itemType !== 'generator') return false

  return !state.board.some((otherCell) => {
    if (otherCell.lock !== 0 || otherCell.itemId === null) return false
    const otherItem = config.itemById.get(otherCell.itemId)
    return otherItem?.itemType === 'generator'
      && otherItem.chain === item.chain
      && otherItem.level > item.level
  })
}

function removeRequirements(board: MergeCell[], requirements: number[]) {
  const next = board.map((cell) => ({ ...cell }))
  requirements.forEach((itemId) => {
    const index = next.findIndex((cell) => cell.lock === 0 && cell.itemId === itemId)
    if (index >= 0) next[index].itemId = null
  })
  return next
}

export function createMergeReducer(config: MergeConfig) {
  return (state: MergeGameState, action: MergeGameAction): MergeGameState => {
    switch (action.type) {
      case 'SELECT_CELL': {
        const cell = state.board[action.index]
        if (!cell || cell.lock === 2 || cell.itemId === null) return state
        return { ...state, selectedCell: action.index, selectedWarehouse: null, animationKey: state.animationKey + 1, spawnedCell: null }
      }
      case 'MOVE_CELL': {
        if (action.from === action.to) return state
        const source = state.board[action.from]
        const target = state.board[action.to]
        if (!source || !target || source.lock !== 0 || target.lock === 2 || source.itemId === null) return state
        const sourceItem = config.itemById.get(source.itemId)
        const board = state.board.map((cell) => ({ ...cell }))
        if (source.itemId === target.itemId && sourceItem?.nextId) {
          board[action.from].itemId = null
          board[action.to].itemId = sourceItem.nextId
          if (target.lock === 1) {
            board[action.to].lock = 0
            const revealed = revealNeighbors(board, action.to)
            return {
              ...state,
              board: revealed.board,
              gold: state.gold + revealed.reward,
              selectedCell: action.to,
              message: revealed.reward ? `合成成功，探索奖励 +${revealed.reward} 金币` : '合成成功',
              animationKey: state.animationKey + 1,
              spawnedCell: null,
              effects: [
                {
                  id: state.animationKey + 1,
                  kind: 'merge',
                  sourceIndex: action.to,
                },
                ...createCellGoldEffects(
                  { ...state, animationKey: state.animationKey + 1 },
                  revealed.revealedIndexes,
                  100,
                ),
              ],
            }
          }
          return {
            ...state,
            board,
            selectedCell: action.to,
            message: '合成成功',
            animationKey: state.animationKey + 1,
            spawnedCell: null,
            effects: [{
              id: state.animationKey + 1,
              kind: 'merge',
              sourceIndex: action.to,
            }],
          }
        }
        if (target.lock !== 0) return { ...state, message: '半锁棋子需要相同棋子合成解锁' }
        board[action.from].itemId = target.itemId
        board[action.to].itemId = source.itemId
        return { ...state, board, selectedCell: action.to, animationKey: state.animationKey + 1, spawnedCell: null }
      }
      case 'USE_CELL': {
        const cell = state.board[action.index]
        if (!cell || cell.lock !== 0 || cell.itemId === null) return state
        const item = config.itemById.get(cell.itemId)
        if (!item) return state
        if (item.itemType === 'special') {
          const board = state.board.map((entry) => ({ ...entry }))
          board[action.index].itemId = null
          const revealed = revealNeighbors(board, action.index)
          return {
            ...state,
            board: revealed.board,
            gold: state.gold + 100 + revealed.reward,
            selectedCell: null,
            message: `领取棋子奖励 +${100 + revealed.reward} 金币`,
            animationKey: state.animationKey + 1,
            spawnedCell: null,
            effects: [
              ...createCellGoldEffects(state, [action.index], 100),
              ...createCellGoldEffects(
                { ...state, animationKey: state.animationKey + 1 },
                revealed.revealedIndexes,
                100,
              ),
            ],
          }
        }
        if (item.itemType !== 'generator') return state
        if (!isHighestGeneratorOnBoard(state, config, action.index)) {
          return { ...state, message: '同一合成链中只有棋盘最高等级生成器可以使用' }
        }
        if (item.openCost === null || item.drops.length === 0) {
          return { ...state, message: '该生成器尚未达到可生成等级' }
        }
        if (state.gold < item.openCost) return { ...state, message: '金币不足' }
        const dropId = weightedDrop(item)
        if (!dropId) return { ...state, message: '生成器配置无有效产物' }
        const emptyCells = state.board.reduce<number[]>((indexes, entry, index) => {
          if (entry.lock === 0 && entry.itemId === null) indexes.push(index)
          return indexes
        }, [])
        if (emptyCells.length === 0 && state.warehouse.length >= state.warehouseCapacity) {
          return { ...state, message: '棋盘和仓库都已满，无法生成棋子' }
        }
        const board = state.board.map((entry) => ({ ...entry }))
        const targetIndex = emptyCells.length > 0
          ? emptyCells[Math.floor(Math.random() * emptyCells.length)]
          : null
        if (targetIndex !== null) board[targetIndex].itemId = dropId
        return {
          ...state,
          board,
          warehouse: targetIndex === null ? [...state.warehouse, dropId] : state.warehouse,
          gold: state.gold - item.openCost,
          selectedCell: targetIndex ?? action.index,
          message: targetIndex === null
            ? `棋盘已满，${config.itemById.get(dropId)?.name ?? '新棋子'} 已放入仓库`
            : `生成了 ${config.itemById.get(dropId)?.name ?? '新棋子'}`,
          animationKey: state.animationKey + 1,
          spawnedCell: targetIndex,
          effects: [{
            id: state.animationKey + 1,
            kind: 'gold-spend',
            sourceIndex: action.index,
            amount: item.openCost,
          }],
        }
      }
      case 'COMPLETE_ORDER': {
        const orderState = state.activeOrders[action.slot]
        if (!orderState || orderState.leaving) return state
        const order = config.orders[orderState.configIndex]
        if (!canCompleteOrder(state, order)) return { ...state, message: '订单所需棋子不足' }
        const equipment = config.equipment.get(order.equipmentId)
        const convertGold = action.alreadyOwned && equipment
          ? getEquipmentDismantleGold(equipment) * order.quantity
          : 0
        const converted = Boolean(action.alreadyOwned && equipment)
        const activeOrders = state.activeOrders.map((entry, index) => index === action.slot ? { ...entry, leaving: true } : entry)
        return {
          ...state,
          board: removeRequirements(state.board, order.requirements),
          gold: state.gold + convertGold,
          activeOrders,
          selectedCell: null,
          message: converted
            ? `订单完成，已拥有 ${equipment?.name ?? order.equipmentId}，转化为 ${convertGold} 金币`
            : `订单完成，获得 ${equipment?.name ?? `装备 ${order.equipmentId}`} ×${order.quantity}`,
          animationKey: state.animationKey + 1,
          spawnedCell: null,
          effects: [{
            id: state.animationKey + 1,
            kind: converted ? 'order-gold' : 'order-reward',
            sourceIndex: action.slot,
            amount: converted ? convertGold : undefined,
            equipmentType: equipment?.type,
            equipmentId: order.equipmentId,
            quantity: order.quantity,
          }],
        }
      }
      case 'FINISH_ORDER_LEAVE': {
        const current = state.activeOrders[action.slot]
        if (!current?.leaving) return state
        const activeOrders = state.activeOrders.filter((_, index) => index !== action.slot)
        let nextOrderIndex = state.nextOrderIndex
        const limitSource = config.orders[Math.min(nextOrderIndex, config.orders.length - 1)]
        const limit = Math.min(3, limitSource?.maxConcurrent ?? 0)
        while (activeOrders.length < limit && nextOrderIndex < config.orders.length) {
          activeOrders.push({ configIndex: nextOrderIndex, leaving: false })
          nextOrderIndex += 1
        }
        return { ...state, activeOrders, nextOrderIndex }
      }
      case 'STORE_CELL': {
        const cell = state.board[action.index]
        if (!cell || cell.lock !== 0 || cell.itemId === null) return state
        if (config.itemById.get(cell.itemId)?.itemType === 'generator') {
          return { ...state, message: '棋子生成器不能放入仓库' }
        }
        if (state.warehouse.length >= state.warehouseCapacity) return { ...state, message: '仓库已满' }
        const board = state.board.map((entry) => ({ ...entry }))
        board[action.index].itemId = null
        return {
          ...state,
          board,
          warehouse: [...state.warehouse, cell.itemId],
          selectedCell: null,
          message: '已放入仓库',
        }
      }
      case 'SELECT_WAREHOUSE':
        if (!state.warehouse[action.index]) return state
        return { ...state, selectedWarehouse: action.index, selectedCell: null }
      case 'PLACE_WAREHOUSE': {
        const itemId = state.warehouse[action.warehouseIndex]
        if (!itemId) return { ...state, selectedWarehouse: null, message: '取回失败：仓库棋子不存在' }
        if (action.cellIndex === null) {
          return { ...state, selectedWarehouse: null, message: '取回失败：请拖到棋盘空格' }
        }
        const cell = state.board[action.cellIndex]
        if (!cell || cell.lock !== 0 || cell.itemId !== null) {
          return { ...state, selectedWarehouse: null, message: '取回失败：目标必须是已解锁空格' }
        }
        const board = state.board.map((entry) => ({ ...entry }))
        board[action.cellIndex].itemId = itemId
        return {
          ...state,
          board,
          warehouse: state.warehouse.filter((_, index) => index !== action.warehouseIndex),
          selectedWarehouse: null,
          selectedCell: action.cellIndex,
          message: `取回成功：${config.itemById.get(itemId)?.name ?? '棋子'} 已放入棋盘`,
          animationKey: state.animationKey + 1,
          spawnedCell: action.cellIndex,
        }
      }
      case 'EXPAND_WAREHOUSE': {
        const expansion = (state.warehouseCapacity - 6) / 3
        const cost = WAREHOUSE_EXPANSION_COSTS[expansion]
        if (cost === undefined) return { ...state, message: '仓库已达到最大容量' }
        if (state.gems < cost) return { ...state, message: '钻石不足' }
        return {
          ...state,
          gems: state.gems - cost,
          warehouseCapacity: state.warehouseCapacity + 3,
          message: '仓库容量 +3',
        }
      }
      case 'CLEAR_MESSAGE':
        return { ...state, message: null }
      case 'CLEAR_EFFECT':
        return { ...state, effects: state.effects.filter((effect) => effect.id !== action.id) }
      default:
        return state
    }
  }
}
