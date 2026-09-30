import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from 'react'
import { MergePiece } from '../../components/MergePiece'
import { WAREHOUSE_EXPANSION_COSTS } from '../../data/mergeRules'
import type { GameRuntime } from '../../game/GameRuntime'
import { activeOrders, availableItems, isActiveGenerator, matchRequirements, type InventoryCommand } from '../../game/inventory'
import { getOrderTarget, orderMaterials } from '../../game/construction'
import styles from './ProductionScreen.module.css'

type Gesture = { id: string; pointerId: number; originX: number; originY: number; startX: number; startY: number; fromWarehouse: boolean; dragging: boolean }
type Ghost = { itemId: number; id: string; x: number; y: number; returning: boolean }

export function ProductionScreen({ runtime, close, message }: { runtime: GameRuntime; close: () => void; message: (text: string) => void }) {
  const state = useSyncExternalStore(runtime.subscribeUi, runtime.getUiSnapshot)
  const catalog = runtime.catalog!
  const production = state.production!
  const inventory = production.inventory
  const root = useRef<HTMLDivElement>(null)
  const boardArea = useRef<HTMLDivElement>(null)
  const [boardWidth, setBoardWidth] = useState(238)
  const gesture = useRef<Gesture | null>(null)
  const lastTap = useRef({ id: '', time: 0 })
  const [selected, setSelected] = useState<string | null>(null)
  const [warehouseOpen, setWarehouseOpen] = useState(false)
  const [ghost, setGhost] = useState<Ghost | null>(null)
  const [target, setTarget] = useState<number | null>(null)
  const [notice, setNotice] = useState('单击生成器生产，拖动相同物品合成')
  const item = selected ? inventory.items[selected] : null
  const config = item ? catalog.itemById.get(item.itemId) : null
  const selectedLocked = item?.location.kind === 'board' && inventory.board[item.location.index].lock !== 0
  const send = useCallback(async (command: InventoryCommand) => {
    const result = await runtime.dispatch(command)
    const text = result.accepted ? `${result.message ?? '操作完成'}${result.persisted === false ? '（尚未保存）' : ''}` : result.reason
    setNotice(text)
    message(text)
    if (result.accepted && command.type === 'item-move') {
      setSelected(runtime.getUiSnapshot().production!.inventory.board[command.targetIndex].instanceId)
    }
    return result
  }, [runtime, message])
  const tap = useCallback((id: string) => {
    const current = runtime.getUiSnapshot().production!.inventory
    const item = current.items[id]
    if (!item) return
    if (item.location.kind === 'board' && current.board[item.location.index].lock === 2) {
      setNotice('先合成邻近的半锁物品，探索这片区域'); return
    }
    setSelected(id)
    const config = runtime.catalog!.itemById.get(item.itemId)!
    const locked = item.location.kind === 'board' && current.board[item.location.index].lock !== 0
    if (!locked && config.itemType === 'generator') void send({ type: 'item-use', instanceId: id })
    if (!locked && config.itemType === 'special' && lastTap.current.id === id && performance.now() - lastTap.current.time < 350) {
      void send({ type: 'item-use', instanceId: id })
      lastTap.current = { id: '', time: 0 }
    } else lastTap.current = { id, time: performance.now() }
  }, [runtime, send])

  useEffect(() => {
    const area = boardArea.current!
    const resize = () => {
      // Fit all nine rows when space permits, retain usable cells and scrolling on small screens.
      const cellSize = Math.max(27, Math.min((area.clientWidth - 32) / 7, (area.clientHeight - 38) / 9))
      setBoardWidth(Math.floor(cellSize * 7 + 32))
    }
    const observer = new ResizeObserver(resize)
    observer.observe(area); resize()
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const targetAt = (event: PointerEvent) => {
      const element = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-board-cell]')
      return element && root.current?.contains(element) ? Number(element.dataset.boardCell) : null
    }
    const move = (event: PointerEvent) => {
      const drag = gesture.current
      if (!drag || event.pointerId !== drag.pointerId) return
      event.preventDefault()
      if (!drag.dragging && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 8) {
        drag.dragging = true
        if (drag.fromWarehouse) setWarehouseOpen(false)
      }
      if (drag.dragging) {
        const item = runtime.getUiSnapshot().production!.inventory.items[drag.id]
        if (item) setGhost({ itemId: item.itemId, id: drag.id, x: event.clientX, y: event.clientY, returning: false })
        setTarget(targetAt(event))
      }
    }
    const finish = (event: PointerEvent) => {
      const drag = gesture.current
      if (!drag || drag.pointerId !== event.pointerId) return
      gesture.current = null
      setTarget(null)
      const cancelled = event.type === 'pointercancel'
      if (!cancelled && !drag.dragging) tap(drag.id)
      else if (drag.dragging) {
        const index = cancelled ? null : targetAt(event)
        if (index !== null) {
          const current = runtime.getUiSnapshot().production!.inventory
          void send(drag.fromWarehouse ? { type: 'item-take', instanceId: drag.id, targetIndex: index }
            : { type: 'item-move', instanceId: drag.id, targetIndex: index, expectedTarget: current.board[index].instanceId })
          setGhost(null)
        } else setGhost(previous => previous ? { ...previous, x: drag.originX, y: drag.originY, returning: true } : null)
      }
      if (drag.fromWarehouse) setWarehouseOpen(true)
      if (root.current?.hasPointerCapture(event.pointerId)) root.current.releasePointerCapture(event.pointerId)
    }
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { if (warehouseOpen) setWarehouseOpen(false); else close() } }
    window.addEventListener('pointermove', move, { passive: false })
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish); window.removeEventListener('keydown', key)
    }
  }, [runtime, tap, send, close, warehouseOpen])
  useEffect(() => {
    if (!ghost?.returning) return
    const timer = window.setTimeout(() => setGhost(null), 160)
    return () => clearTimeout(timer)
  }, [ghost?.returning])
  useEffect(() => {
    if (!state.pauseReasons.length) return
    gesture.current = null; setGhost(null); setTarget(null)
  }, [state.pauseReasons.length])

  function down(event: ReactPointerEvent<HTMLButtonElement>, id: string, fromWarehouse: boolean) {
    if (event.button !== 0 || gesture.current) return
    const item = inventory.items[id]
    if (!item) return
    if (item.reservedBy) { setSelected(id); setNotice('工程已预留，开工前可以在营地建设中取消安排'); return }
    if (!fromWarehouse && inventory.board[item.location.index].lock === 2) {
      setNotice('先合成邻近的半锁物品，探索这片区域'); return
    }
    if (!fromWarehouse && inventory.board[item.location.index].lock !== 0) { setSelected(id); return }
    event.preventDefault()
    const rect = event.currentTarget.getBoundingClientRect()
    gesture.current = { id, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
      originX: rect.x + rect.width / 2, originY: rect.y + rect.height / 2, fromWarehouse, dragging: false }
    root.current?.setPointerCapture(event.pointerId)
  }
  const expansionCost = WAREHOUSE_EXPANSION_COSTS[(inventory.warehouse.length - 6) / 3]
  const usedWarehouse = inventory.warehouse.filter(Boolean).length
  const canUse = config && (config.itemType === 'generator' || catalog.effects.has(config.id)) && !selectedLocked
  const selectedActions = item && config && !selectedLocked && !item.reservedBy && <div className={styles.itemActions}>
    {canUse && <button onClick={() => void send({ type: 'item-use', instanceId: item.id })}>使用</button>}
    {item.location.kind === 'board' && config.itemType !== 'generator' && <button onClick={() => void send({ type: 'item-store', instanceId: item.id })}>存入仓库</button>}
    {item.location.kind === 'warehouse' && <button onClick={() => {
      const index = inventory.board.findIndex(slot => slot.lock === 0 && slot.instanceId === null)
      if (index < 0) setNotice('棋盘没有空格，请先整理')
      else void send({ type: 'item-take', instanceId: item.id, targetIndex: index })
    }}>取回棋盘</button>}
    {config.itemType === 'normal' && <button className={styles.discard} onClick={() => {
      if (window.confirm(`确定丢弃「${config.name}」吗？`)) void send({ type: 'item-discard', instanceId: item.id })
    }}>丢弃</button>}
  </div>

  return <div ref={root} className={styles.screen} data-testid="production-screen">
    <header className={styles.header}><div><small>把日子，一点点拼起来</small><h2>林间工坊</h2></div>
      <button className={styles.close} aria-label="关闭合成" onClick={close}>×</button></header>
    <div className={styles.worldStatus}><span data-testid="merge-clock">第 {state.day} 天 · {String(state.hour).padStart(2, '0')}:{String(state.minute).padStart(2, '0')}</span>
      <span>{state.pauseReasons.length ? '营地暂停中' : state.activity === 'building' ? `施工保护中 · ${Math.ceil(state.construction.jobs[0].remaining)} 秒` : state.activity === 'walking' ? '主角正在前行' : '主角在营地停留'}</span></div>
    <div className={styles.resources}><span>⚡ <strong data-testid="stamina-value">{production.stamina.value}</strong><small> / 100</small></span>
      <span>◇ {inventory.gems}</span><span>● {inventory.gold}</span>
      <small>{production.stamina.value >= 100 ? '自然恢复已满' : `每 10 秒恢复 1 点`}</small></div>
    <div className={styles.vitals}>生命 {production.vitals.hp} · 饱食 {production.vitals.hunger} · 水分 {production.vitals.water}</div>
    <section className={`${styles.orders} ${state.construction.orders.length ? styles.withBuildingOrders : ''}`} aria-label="营地委托">
      {state.construction.orders.map(order => {
        const materials = orderMaterials(state.construction, order)
        const job = state.construction.jobs.find(job => job.orderId === order.id)
        const ready = !job && matchRequirements(inventory, materials) !== null
        const { config } = getOrderTarget(state.construction, order)
        const counts = new Map<number, number>()
        materials.forEach(id => counts.set(id, (counts.get(id) ?? 0) + 1))
        return <button key={order.id} className={`${styles.order} ${ready ? styles.ready : ''}`} data-testid={`building-order-${order.id}`} disabled={!!job} onClick={async () => {
          const result = await runtime.dispatch({ type: 'building-claim', orderId: order.id })
          const text = result.accepted ? result.message ?? '已安排工程' : result.reason
          setNotice(text); message(text)
          if (result.accepted) close()
        }}><strong>⌂ {config.name}</strong><div className={styles.requirements}>{materials.map((id, index) => <span key={index} className={ready ? styles.owned : ''}><MergePiece item={catalog.itemById.get(id)!} compact /></span>)}</div>
          <small>{[...counts].map(([id, needed]) => `${catalog.itemById.get(id)!.name} ${availableItems(inventory).filter(item => item.itemId === id).length}/${needed}`).join(' · ')}</small>
          <small>{job ? job.phase === 'building' ? '施工中 · 保护生效' : '已预留 · 可在建设页取消' : ready ? '领取工程 · 自动前往' : '合成备料 · 棋盘与仓库'}</small></button>
      })}
      {activeOrders(inventory, catalog).map(order => {
        const ready = matchRequirements(inventory, order.requirements) !== null
        const counts = new Map<number, number>()
        availableItems(inventory).forEach(item => counts.set(item.itemId, (counts.get(item.itemId) ?? 0) + 1))
        return <button key={order.id} className={`${styles.order} ${ready ? styles.ready : ''}`} data-testid={`order-${order.id}`} onClick={() => void send({ type: 'order-complete', orderId: order.id })}>
          <strong>{order.name}</strong><div className={styles.requirements}>{order.requirements.map((id, index) => {
            const count = counts.get(id) ?? 0
            counts.set(id, Math.max(0, count - 1))
            return <span key={index} className={count ? styles.owned : ''}><MergePiece item={catalog.itemById.get(id)!} compact />{count > 0 && <i>✓</i>}</span>
          })}</div><small>{ready ? '交付领取' : '收集物资'} · ⚡{catalog.effects.get(order.rewardItemId)?.amount ?? 0} / ◇{order.gems}</small></button>
      })}
      {!activeOrders(inventory, catalog).length && <p>这批营地委托已全部完成，继续储备物资吧。</p>}
    </section>
    <div ref={boardArea} className={styles.boardArea} data-testid="board-scroll"><div className={styles.board}
      style={{ width: boardWidth, height: (boardWidth - 32) * 9 / 7 + 38 }}>
      {inventory.board.map((slot, index) => {
        const item = slot.instanceId ? inventory.items[slot.instanceId] : null
        const config = item ? catalog.itemById.get(item.itemId)! : null
        const generator = item && isActiveGenerator(inventory, catalog, item.id)
        return <button key={index} data-board-cell={index} data-testid={`board-cell-${index}`} data-instance-id={slot.instanceId ?? ''}
          data-item-id={item?.itemId ?? ''} data-lock={slot.lock} data-reserved={item?.reservedBy ?? ''}
          className={`${styles.cell} ${styles[`lock${slot.lock}`]} ${!item ? styles.empty : ''} ${selected === slot.instanceId && slot.instanceId ? styles.selected : ''} ${target === index ? styles.target : ''}`}
          aria-label={slot.lock === 2 ? `未探索格 ${index + 1}` : config ? `${config.name} 等级 ${config.level} 棋盘格 ${index + 1}` : `空格 ${index + 1}`}
          onPointerDown={event => item && down(event, item.id, false)}
          onClick={event => { if (event.detail === 0 && item) tap(item.id) }}>
          {slot.lock === 2 ? <span className={styles.fog}>✧</span> : config && <span className={ghost?.id === item?.id ? styles.hidden : ''}><MergePiece item={config} selected={selected === item?.id} /></span>}
          {slot.lock === 1 && <span className={styles.lockMark}>⌁</span>}
          {item?.reservedBy && <small className={styles.reserved}>预留</small>}
          {generator && config?.openCost !== null && <small className={styles.cost}>⚡{config?.openCost}</small>}
          {slot.lock !== 2 && config && <small className={styles.level}>{config.level}</small>}
        </button>
      })}
    </div></div>
    <section className={styles.info}><div><strong>{config ? `${config.name} · Lv.${config.level}` : '准备好下一份物资'}</strong>
      <p>{item?.reservedBy ? '已为工程预留。开工时消耗，开工前取消会在原格释放。' : config?.description ?? '拖动相同物品合成；小屏时可在空格或棋盘两侧上下滑动。'}</p></div>{selectedActions}</section>
    <p className={styles.notice} role="status">{notice}</p>
    <nav className={styles.footer}><button onClick={() => setWarehouseOpen(true)}>▦ 仓库 {usedWarehouse}/{inventory.warehouse.length}</button>
      <button onClick={close}>返回营地</button></nav>
    {warehouseOpen && <div className={styles.warehouseBackdrop} onClick={() => setWarehouseOpen(false)}>
      <section className={styles.warehouse} role="dialog" aria-modal="true" aria-label="营地仓库" onClick={event => event.stopPropagation()}>
        <header><div><h3>营地仓库</h3><small>选择后直接使用，或拖到棋盘空格取回</small></div><button aria-label="关闭仓库" onClick={() => setWarehouseOpen(false)}>×</button></header>
        <div className={styles.warehouseGrid}>{inventory.warehouse.map((id, index) => {
          const item = id ? inventory.items[id] : null
          return <button key={index} data-testid={`warehouse-cell-${index}`} data-instance-id={id ?? ''} data-reserved={item?.reservedBy ?? ''}
            aria-label={item ? `${catalog.itemById.get(item.itemId)!.name} 仓位 ${index + 1}` : `空仓位 ${index + 1}`}
            className={selected === id && id ? styles.selected : ''}
            onPointerDown={event => id && down(event, id, true)} onClick={event => { if (event.detail === 0 && id) tap(id) }}>
            {item && <MergePiece item={catalog.itemById.get(item.itemId)!} compact />}{item?.reservedBy && <small className={styles.reserved}>预留</small>}</button>
        })}</div>
        {item?.location.kind === 'warehouse' && <div className={styles.warehouseInfo}><strong>{config?.name}</strong><p>{config?.description}</p>{selectedActions}</div>}
        <p className={styles.notice}>{notice}</p>
        <button className={styles.expand} disabled={expansionCost === undefined} onClick={() => void send({ type: 'warehouse-expand', expectedCapacity: inventory.warehouse.length })}>
          {expansionCost === undefined ? '已达最大容量' : `扩充 3 格 · ◇ ${expansionCost}`}</button>
      </section>
    </div>}
    {ghost && <div className={`${styles.ghost} ${ghost.returning ? styles.returning : ''}`} style={{ left: ghost.x, top: ghost.y }}><MergePiece item={catalog.itemById.get(ghost.itemId)!} /></div>}
  </div>
}
