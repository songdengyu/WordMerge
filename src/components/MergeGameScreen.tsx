import { useEffect, useMemo, useReducer, useRef, useState, type PointerEvent } from 'react'
import { createMergeReducer, canCompleteOrder, isHighestGeneratorOnBoard, restoreMergeState, persistMergeState, WAREHOUSE_EXPANSION_COSTS, type MergeEffect } from '../data/mergeGame'
import { loadMergeConfig, type MergeConfig } from '../data/mergeConfig'
import { getEquipmentDismantleGold } from '../data/equipmentConfig'
import { useGameStore } from '../store/useGameStore'
import { CharacterAvatar } from './CharacterAvatar'
import { EquipmentArt } from './EquipmentArt'
import { MergePiece } from './MergePiece'
import styles from './MergeGameScreen.module.css'

const ORDER_ROLES = ['archer', 'mage', 'knight', 'rogue', 'priest', 'sword'] as const
const EQUIPMENT_EFFECTS: Record<number, { symbol: string; label: string; className: string }> = {
  1: { symbol: '†', label: '武器', className: 'weaponReward' },
  2: { symbol: '‡', label: '副武器', className: 'offhandReward' },
  3: { symbol: '⌒', label: '头盔', className: 'helmetReward' },
  4: { symbol: '♜', label: '衣服', className: 'armorReward' },
  5: { symbol: '═', label: '腰带', className: 'beltReward' },
  6: { symbol: '⌟', label: '鞋子', className: 'bootsReward' },
  7: { symbol: '✦', label: '神器', className: 'artifactReward' },
  8: { symbol: '▤', label: '技能书', className: 'bookReward' },
  9: { symbol: '♟', label: '队友', className: 'heroReward' },
}

interface DragState {
  source: number
  pointerId: number
  startX: number
  startY: number
  dragging: boolean
}

interface DragVisual {
  source: number
  itemId: number
  x: number
  y: number
  originX: number
  originY: number
  returning: boolean
}

interface WarehouseDragVisual {
  warehouseIndex: number
  itemId: number
  pointerId: number
  x: number
  y: number
}

function GoldEffect({ effect, clear }: { effect: MergeEffect; clear: () => void }) {
  return (
    <span
      className={`${styles.goldEffect} ${effect.kind === 'gold-spend' ? styles.goldSpendEffect : styles.goldGainEffect}`}
      onAnimationEnd={clear}
    >
      <span className={styles.effectCoin}>●</span>
      <strong>{effect.kind === 'gold-spend' ? '-' : '+'}{effect.amount}</strong>
    </span>
  )
}

function MergeGame({ config }: { config: MergeConfig }) {
  const {
    state: gameState,
    closeSecondaryView,
    showToast,
    syncMergeResources,
    saveMergeSnapshot,
    grantEquipment,
  } = useGameStore()
  const reducer = useMemo(() => createMergeReducer(config), [config])
  const [state, dispatch] = useReducer(
    reducer,
    undefined,
    () => restoreMergeState(gameState.mergeSnapshot, config, gameState.gold, gameState.diamonds),
  )
  const [warehouseOpen, setWarehouseOpen] = useState(false)
  const [warehouseDrag, setWarehouseDrag] = useState<WarehouseDragVisual | null>(null)
  const [dragVisual, setDragVisual] = useState<DragVisual | null>(null)
  const [dragTarget, setDragTarget] = useState<number | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const grantedEffectsRef = useRef(new Set<number>())

  useEffect(() => {
    syncMergeResources(state.gold, state.gems)
  }, [state.gold, state.gems, syncMergeResources])

  useEffect(() => {
    saveMergeSnapshot(persistMergeState(state))
  }, [state, saveMergeSnapshot])

  useEffect(() => {
    state.effects.forEach((effect) => {
      if (effect.kind !== 'order-reward' || !effect.equipmentId || grantedEffectsRef.current.has(effect.id)) return
      grantedEffectsRef.current.add(effect.id)
      grantEquipment(effect.equipmentId, effect.quantity ?? 1)
    })
  }, [state.effects, grantEquipment])

  useEffect(() => {
    if (!warehouseDrag) return

    function move(event: globalThis.PointerEvent) {
      if (event.pointerId !== warehouseDrag!.pointerId) return
      event.preventDefault()
      setWarehouseDrag((current) => current ? { ...current, x: event.clientX, y: event.clientY } : current)
    }

    function finish(event: globalThis.PointerEvent) {
      if (event.pointerId !== warehouseDrag!.pointerId) return
      const targetElement = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-cell-index]')
      const parsedIndex = Number(targetElement?.dataset.cellIndex)
      dispatch({
        type: 'PLACE_WAREHOUSE',
        warehouseIndex: warehouseDrag!.warehouseIndex,
        cellIndex: Number.isInteger(parsedIndex) ? parsedIndex : null,
      })
      setWarehouseDrag(null)
      setWarehouseOpen(true)
    }

    window.addEventListener('pointermove', move, { passive: false })
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
    }
  }, [warehouseDrag])

  useEffect(() => {
    if (!state.message) return
    showToast(state.message)
    dispatch({ type: 'CLEAR_MESSAGE' })
  }, [state.message, showToast])

  const selectedItem = state.selectedCell !== null
    ? config.itemById.get(state.board[state.selectedCell]?.itemId ?? -1)
    : state.selectedWarehouse !== null
      ? config.itemById.get(state.warehouse[state.selectedWarehouse] ?? -1)
      : null

  function finishOrder(slot: number) {
    const orderState = state.activeOrders[slot]
    const order = orderState ? config.orders[orderState.configIndex] : null
    const rewardItem = order ? config.equipment.get(order.equipmentId) : null
    dispatch({
      type: 'COMPLETE_ORDER',
      slot,
      alreadyOwned: order
        ? rewardItem?.type !== 8 && (gameState.ownedEquipment[order.equipmentId] ?? 0) > 0
        : false,
    })
  }

  function onPointerDown(event: PointerEvent<HTMLButtonElement>, index: number) {
    const cell = state.board[index]
    if (cell.lock !== 0 || cell.itemId === null || state.selectedWarehouse !== null) return
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { source: index, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, dragging: false }
  }

  function onPointerMove(event: PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    if (!drag.dragging && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 8) {
      const sourceCell = state.board[drag.source]
      const rect = event.currentTarget.getBoundingClientRect()
      drag.dragging = true
      setDragVisual({
        source: drag.source,
        itemId: sourceCell.itemId!,
        x: event.clientX,
        y: event.clientY,
        originX: rect.left + rect.width / 2,
        originY: rect.top + rect.height / 2,
        returning: false,
      })
    } else if (drag.dragging) {
      setDragVisual((current) => current ? { ...current, x: event.clientX, y: event.clientY } : current)
    }

    if (drag.dragging) {
      const targetElement = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-cell-index]')
      const target = Number(targetElement?.dataset.cellIndex)
      setDragTarget(Number.isInteger(target) ? target : null)
    }
  }

  function isValidDrop(sourceIndex: number, targetIndex: number) {
    if (sourceIndex === targetIndex) return false
    const source = state.board[sourceIndex]
    const target = state.board[targetIndex]
    if (!source || !target || source.lock !== 0 || target.lock === 2 || source.itemId === null) return false
    if (target.lock === 0) return true
    const sourceItem = config.itemById.get(source.itemId)
    return target.lock === 1 && target.itemId === source.itemId && sourceItem?.nextId !== null
  }

  function returnDraggedPiece() {
    setDragTarget(null)
    setDragVisual((current) => current ? {
      ...current,
      x: current.originX,
      y: current.originY,
      returning: true,
    } : current)
  }

  function onPointerUp(event: PointerEvent<HTMLButtonElement>, index: number) {
    const drag = dragRef.current
    dragRef.current = null
    if (!drag || drag.pointerId !== event.pointerId) return
    if (!drag.dragging) {
      dispatch({ type: 'SELECT_CELL', index })
      const itemId = state.board[index]?.itemId
      if (itemId !== null && itemId !== undefined && config.itemById.get(itemId)?.itemType === 'generator') {
        dispatch({ type: 'USE_CELL', index })
      }
      return
    }
    const targetElement = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-cell-index]')
    const target = Number(targetElement?.dataset.cellIndex)
    if (Number.isInteger(target) && isValidDrop(drag.source, target)) {
      dispatch({ type: 'MOVE_CELL', from: drag.source, to: target })
      setDragTarget(null)
      setDragVisual(null)
      return
    }
    returnDraggedPiece()
  }

  function onPointerCancel() {
    const wasDragging = dragRef.current?.dragging
    dragRef.current = null
    if (wasDragging) returnDraggedPiece()
  }

  function startWarehouseDrag(event: PointerEvent<HTMLButtonElement>, warehouseIndex: number, itemId: number) {
    event.preventDefault()
    dispatch({ type: 'SELECT_WAREHOUSE', index: warehouseIndex })
    setWarehouseDrag({
      warehouseIndex,
      itemId,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    })
    setWarehouseOpen(false)
  }

  const expansionIndex = (state.warehouseCapacity - 6) / 3
  const expansionCost = WAREHOUSE_EXPANSION_COSTS[expansionIndex]

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <span className={styles.brandMark}>M</span>
          <div><strong>秘境合成</strong><small>MERGE WORKSHOP</small></div>
        </div>
        <div className={styles.currency}><span className={styles.headerCoin}>●</span><strong>{state.gold}</strong></div>
        <div className={`${styles.currency} ${styles.gems}`}><span className={styles.headerGem}>◆</span><strong>{state.gems}</strong></div>
      </header>

      <section className={styles.orders} aria-label="订单">
        {state.activeOrders.map((orderState, slot) => {
          const order = config.orders[orderState.configIndex]
          const ready = canCompleteOrder(state, order)
          const equipment = config.equipment.get(order.equipmentId)
          const alreadyOwned = equipment?.type !== 8 && (gameState.ownedEquipment[order.equipmentId] ?? 0) > 0
          const convertGold = alreadyOwned && equipment
            ? getEquipmentDismantleGold(equipment) * order.quantity
            : 0
          const reward = EQUIPMENT_EFFECTS[equipment?.type ?? 1] ?? EQUIPMENT_EFFECTS[1]
          return (
            <article
              key={order.id}
              className={`${styles.order} ${ready && !orderState.leaving ? styles.orderReady : ''} ${orderState.leaving ? styles.orderLeaving : ready ? '' : styles.orderEntering}`}
              onAnimationEnd={(event) => {
                if (orderState.leaving && event.target === event.currentTarget) {
                  dispatch({ type: 'FINISH_ORDER_LEAVE', slot })
                }
              }}
              role={ready && !orderState.leaving ? 'button' : undefined}
              tabIndex={ready && !orderState.leaving ? 0 : undefined}
              title={ready ? '点击领取奖励' : undefined}
              aria-label={ready ? '订单已完成，点击领取奖励' : undefined}
              onClick={() => {
                if (ready && !orderState.leaving) finishOrder(slot)
              }}
              onKeyDown={(event) => {
                if (!ready || orderState.leaving) return
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  finishOrder(slot)
                }
              }}
            >
              <CharacterAvatar role={ORDER_ROLES[order.id % ORDER_ROLES.length]} size="sm" />
              <div className={styles.orderNeeds}>
                <span className={styles.orderNeedsLabel}>需求：</span>
                {order.requirements.map((itemId, requirementIndex) => (
                  <MergePiece key={`${itemId}-${requirementIndex}`} item={config.itemById.get(itemId)!} compact />
                ))}
              </div>
              <div
                className={`${styles.orderRewardPreview} ${alreadyOwned ? styles.orderGoldReward : styles[reward.className]}`}
                title={alreadyOwned ? `已拥有 ${equipment?.name ?? reward.label}，转化为 ${convertGold} 金币` : `${equipment?.name ?? reward.label} ×${order.quantity}`}
                aria-label={alreadyOwned ? `订单奖励 ${equipment?.name ?? reward.label} 已拥有，转化为 ${convertGold} 金币` : `订单奖励：${equipment?.name ?? reward.label}，数量 ${order.quantity}`}
              >
                <small className={styles.rewardLabel}>{alreadyOwned ? '转化' : '奖励'}</small>
                {alreadyOwned ? <span>●</span> : equipment && <EquipmentArt item={equipment} size="xs" />}
                {!alreadyOwned && order.quantity > 1 && <strong>×{order.quantity}</strong>}
                {alreadyOwned && <strong>{convertGold}</strong>}
              </div>
            </article>
          )
        })}
        {state.effects.filter((effect) => effect.kind === 'order-reward' || effect.kind === 'order-gold').map((effect) => {
          const reward = EQUIPMENT_EFFECTS[effect.equipmentType ?? 1] ?? EQUIPMENT_EFFECTS[1]
          const equipment = effect.equipmentId ? config.equipment.get(effect.equipmentId) : null
          const converted = effect.kind === 'order-gold'
          return (
            <span
              key={effect.id}
              className={`${styles.orderRewardEffect} ${converted ? styles.orderGoldReward : styles[reward.className]}`}
              style={{ '--order-slot': effect.sourceIndex } as React.CSSProperties}
              onAnimationEnd={() => dispatch({ type: 'CLEAR_EFFECT', id: effect.id })}
            >
              <span className={styles.rewardBurst} />
              <span className={styles.rewardIcon}>{converted ? '●' : equipment && <EquipmentArt item={equipment} size="sm" />}</span>
              <strong>{converted ? `+${effect.amount ?? 0} 金币` : equipment?.name ?? reward.label}</strong>
            </span>
          )
        })}
      </section>

      <main className={styles.boardWrap}>
        <div className={styles.board}>
          {state.board.map((cell, index) => {
            const item = cell.itemId !== null ? config.itemById.get(cell.itemId) : null
            const selected = state.selectedCell === index
            const isDragSource = dragVisual?.source === index
            const isDropTarget = dragTarget === index && dragVisual !== null
            const validDropTarget = isDropTarget && isValidDrop(dragVisual.source, index)
            const activeGenerator = item?.itemType === 'generator'
              && isHighestGeneratorOnBoard(state, config, index)
            const goldEffects = state.effects.filter(
              (effect) => (effect.kind === 'gold-gain' || effect.kind === 'gold-spend') && effect.sourceIndex === index,
            )
            const mergeEffects = state.effects.filter(
              (effect) => effect.kind === 'merge' && effect.sourceIndex === index,
            )
            return (
              <button
                key={index}
                type="button"
                data-cell-index={index}
                className={`${styles.cell} ${styles[`lock${cell.lock}`]} ${selected ? styles.cellSelected : ''} ${activeGenerator ? styles.activeGenerator : ''} ${isDropTarget ? (validDropTarget ? styles.validDrop : styles.invalidDrop) : ''}`}
                onDoubleClick={() => item?.itemType === 'special' && dispatch({ type: 'USE_CELL', index })}
                onPointerDown={(event) => onPointerDown(event, index)}
                onPointerMove={onPointerMove}
                onPointerUp={(event) => onPointerUp(event, index)}
                onPointerCancel={onPointerCancel}
                aria-label={item ? `${item.name} 等级 ${item.level}` : '空格'}
              >
                {cell.lock === 2 && <span className={styles.lockMark}>?</span>}
                {cell.lock === 1 && <span className={styles.chainMark}>⌁</span>}
                <span
                  key={state.spawnedCell === index ? `spawn-${state.animationKey}` : `cell-${index}`}
                  className={`${isDragSource ? styles.dragSourceHidden : styles.cellPiece} ${state.spawnedCell === index ? styles.spawnedPiece : ''}`}
                >
                  {item && (
                    <MergePiece
                      item={item}
                      selected={selected}
                      shaking={selected && state.animationKey > 0}
                    />
                  )}
                </span>
                {activeGenerator && item.openCost !== null && (
                  <span className={styles.generatorCost} aria-label={`消耗 ${item.openCost} 金币`}>
                    <span className={styles.costCoin}>●</span>
                    <span>{item.openCost}</span>
                  </span>
                )}
                {goldEffects.map((effect) => (
                  <GoldEffect
                    key={effect.id}
                    effect={effect}
                    clear={() => dispatch({ type: 'CLEAR_EFFECT', id: effect.id })}
                  />
                ))}
                {mergeEffects.map((effect) => (
                  <span
                    key={effect.id}
                    className={styles.mergeEffect}
                    onAnimationEnd={() => dispatch({ type: 'CLEAR_EFFECT', id: effect.id })}
                    aria-hidden
                  >
                    <span className={styles.mergeRing} />
                    <span className={styles.mergeFlash}>✦</span>
                    <span className={`${styles.mergeSpark} ${styles.spark1}`} />
                    <span className={`${styles.mergeSpark} ${styles.spark2}`} />
                    <span className={`${styles.mergeSpark} ${styles.spark3}`} />
                    <span className={`${styles.mergeSpark} ${styles.spark4}`} />
                    <span className={`${styles.mergeSpark} ${styles.spark5}`} />
                    <span className={`${styles.mergeSpark} ${styles.spark6}`} />
                  </span>
                ))}
              </button>
            )
          })}
        </div>
      </main>

      {dragVisual && (
        <div
          className={`${styles.dragPiece} ${dragVisual.returning ? styles.dragReturning : ''}`}
          style={{ left: dragVisual.x, top: dragVisual.y }}
          onTransitionEnd={() => dragVisual.returning && setDragVisual(null)}
        >
          <MergePiece item={config.itemById.get(dragVisual.itemId)!} />
        </div>
      )}

      {warehouseDrag && (
        <div
          className={`${styles.dragPiece} ${styles.warehouseDragPiece}`}
          style={{ left: warehouseDrag.x, top: warehouseDrag.y }}
        >
          <MergePiece item={config.itemById.get(warehouseDrag.itemId)!} />
        </div>
      )}

      <section className={styles.info}>
        <div>
          <span className={styles.infoLabel}>棋子说明</span>
          <strong>{selectedItem ? `${selectedItem.name} · Lv.${selectedItem.level}` : '点击棋子查看说明'}</strong>
          <small>{selectedItem?.description ?? '拖动相同棋子进行合成，半锁棋子需要合成解锁。'}</small>
        </div>
        {state.selectedCell !== null
          && state.board[state.selectedCell]?.lock === 0
          && selectedItem?.itemType !== 'generator' && (
          <button type="button" onClick={() => dispatch({ type: 'STORE_CELL', index: state.selectedCell! })}>存入</button>
        )}
      </section>

      <nav className={styles.footer}>
        <button type="button" onClick={() => setWarehouseOpen(true)}><span>▦</span>仓库 {state.warehouse.length}/{state.warehouseCapacity}</button>
        <button type="button" className={styles.returnBtn} onClick={closeSecondaryView}><span>↩</span>返回战斗</button>
      </nav>

      {warehouseOpen && (
        <div className={styles.warehouseBackdrop} onClick={() => setWarehouseOpen(false)}>
          <section className={styles.warehouse} onClick={(event) => event.stopPropagation()}>
            <header><div><h2>秘境仓库</h2><small>拖动棋子到棋盘已解锁空格取回</small></div><button type="button" onClick={() => setWarehouseOpen(false)}>×</button></header>
            <div className={styles.warehouseGrid}>
              {Array.from({ length: state.warehouseCapacity }, (_, index) => {
                const item = config.itemById.get(state.warehouse[index] ?? -1)
                return (
                  <button
                    key={index}
                    type="button"
                    className={state.selectedWarehouse === index ? styles.warehouseSelected : ''}
                    onPointerDown={(event) => item && startWarehouseDrag(event, index, item.id)}
                  >
                    {item && <MergePiece item={item} compact />}
                  </button>
                )
              })}
            </div>
            <button type="button" className={styles.expandBtn} disabled={expansionCost === undefined} onClick={() => dispatch({ type: 'EXPAND_WAREHOUSE' })}>
              {expansionCost === undefined ? '已达最大容量' : `扩充 3 格 · ◆ ${expansionCost}`}
            </button>
          </section>
        </div>
      )}
    </div>
  )
}

let cachedMergeConfig: MergeConfig | null = null

export function MergeGameScreen() {
  const { closeSecondaryView } = useGameStore()
  const [config, setConfig] = useState<MergeConfig | null>(cachedMergeConfig)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (cachedMergeConfig) return
    let active = true
    loadMergeConfig().then((loaded) => {
      if (!active) return
      cachedMergeConfig = loaded
      setConfig(loaded)
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : '未知配置错误')
    })
    return () => { active = false }
  }, [])

  if (error) {
    return <div className={styles.loading}><h2>合成配置加载失败</h2><p>{error}</p><button type="button" onClick={closeSecondaryView}>返回</button></div>
  }
  if (!config) return <div className={styles.loading}><div className={styles.loader} /><p>正在开启秘境工坊...</p></div>
  return <MergeGame config={config} />
}
