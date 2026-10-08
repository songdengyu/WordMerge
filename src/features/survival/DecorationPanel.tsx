import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { GameCommand, GameRuntime } from '../../game/GameRuntime'
import { decorAvailable } from '../../game/progression'
import { DECORATIONS, OUTFITS, type DecorId } from '../../game/progressionConfig'
import styles from './CampJournal.module.css'
import decorStyles from './DecorationPanel.module.css'

export function DecorationPanel({ runtime, close, decorate, shop }: { runtime: GameRuntime; close: () => void;
  decorate: (kind: DecorId, decorationId?: string) => void; shop: () => void }) {
  const state = useSyncExternalStore(runtime.subscribeUi, runtime.getUiSnapshot), progress = state.progression
  const dialog = useRef<HTMLDialogElement>(null)
  const [tab, setTab] = useState<'decor' | 'outfits' | 'placed'>('decor'), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false)
  useEffect(() => { dialog.current?.showModal() }, [])
  const disabled = busy || !!state.pauseReasons.length
  const place = (kind: DecorId, id?: string) => {
    if (!state.construction.buildings.some(b => b.parts.foundation.built)) { setNotice('先建好一块木地基，再布置喜欢的摆件'); return }
    decorate(kind, id)
  }
  const send = async (command: GameCommand) => {
    setBusy(true)
    try { const result = await runtime.dispatch(command); setNotice(result.accepted ? result.message ?? '已完成' : result.reason) }
    finally { setBusy(false) }
  }
  return <dialog ref={dialog} className={styles.journal} aria-labelledby="decoration-title" data-testid="decoration-panel"
    onCancel={close} onClick={e => { if (e.target === e.currentTarget) close() }}>
    <header><div><small>收藏喜欢，布置生活</small><h2 id="decoration-title">装饰</h2></div></header>
    <nav aria-label="装饰分类">{([['decor', '摆件'], ['outfits', '人物皮肤'], ['placed', '已摆放']] as const).map(([id, name]) =>
      <button key={id} aria-pressed={tab === id} onClick={() => { setTab(id); setNotice('') }}>{name}</button>)}</nav>
    {tab === 'decor' && <><div className={decorStyles.grid}>{DECORATIONS.filter(d => progress.ownedDecor.includes(d.id)).map(decor => {
      const stock = decorAvailable(progress, decor.id)
      return <article className={decorStyles.card} key={decor.id} data-testid={`decor-stock-${decor.id}`}>
        <span className={decorStyles.art} style={{ color: decor.color }} aria-hidden="true">{decor.symbol}</span>
        <strong>{decor.name}</strong><small>库存 <b data-testid={`decor-count-${decor.id}`}>{stock}</b> · 已摆放 {progress.decorations.filter(d => d.kind === decor.id).length}</small>
        <button disabled={disabled || stock <= 0} onClick={() => place(decor.id)}>{stock > 0 ? '摆放' : '库存不足'}</button>
      </article>
    })}</div>{!progress.ownedDecor.length && <p className={styles.muted}>还没有摆件，可通过商店或故事获得。</p>}
      <p className={styles.muted}>每次确认摆放消耗 1 件，取消不扣库存。相同摆件可重复购买、同时摆放；收回后返还库存。</p></>}
    {tab === 'outfits' && <div className={styles.outfits}>{OUTFITS.filter(outfit => progress.ownedOutfits.includes(outfit.id)).map(outfit =>
      <button key={outfit.id} disabled={disabled} aria-pressed={progress.outfit === outfit.id} onClick={() => void send({ type: 'outfit-equip', outfitId: outfit.id })}>
        <svg viewBox="0 0 50 55" aria-hidden="true"><path d="M15 4 4 14l6 12 7-3-5 27h26l-5-27 7 3 6-12L35 4q-10 10-20 0" fill={`#${outfit.color.toString(16)}`} /><path d="M17 22h16M20 10l12 33" stroke="#f4e2bd" fill="none" /></svg>
        <span>{outfit.name}</span><small>{progress.outfit === outfit.id ? '穿着中' : '换上'}</small>
      </button>)}</div>}
    {tab === 'placed' && <>{progress.decorations.map(placed => {
      const decor = DECORATIONS.find(d => d.id === placed.kind)!
      return <article key={placed.id} className={decorStyles.placed} data-testid={`placed-${placed.id}`}>
        <span style={{ color: decor.color }} aria-hidden="true">{decor.symbol}</span>
        <div><strong>{decor.name}</strong><small>位置 {placed.cell.x}, {placed.cell.y}</small></div>
        <button disabled={disabled} onClick={() => place(placed.kind, placed.id)}>移动</button>
        <button disabled={disabled} onClick={() => void send({ type: 'decor-remove', kind: placed.kind, decorationId: placed.id })}>收回</button>
      </article>
    })}{!progress.decorations.length && <p className={styles.muted}>尚未摆放装饰，先选一件喜欢的摆件吧。</p>}</>}
    <button className={styles.secondary} onClick={shop}>去商店添置</button>
    <p role="status" className={styles.notice}>{notice}</p>
    <footer className={decorStyles.returnBar}><button onClick={close}>回到地图</button></footer>
  </dialog>
}
