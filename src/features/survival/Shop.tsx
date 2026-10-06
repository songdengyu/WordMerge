import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { GameCommand, GameRuntime } from '../../game/GameRuntime'
import { SHOP_PRODUCTS, RESOURCE_RULES, type ShopProduct } from '../../game/economyConfig'
import { ownsProduct } from '../../game/economy'
import { DECORATIONS, OUTFITS, type DecorId } from '../../game/progressionConfig'
import { MergePiece } from '../../components/MergePiece'
import styles from './Shop.module.css'

export function CurrencyIcon({ kind }: { kind: 'gold' | 'gems' }) {
  return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">{kind === 'gold'
    ? <><circle cx="12" cy="12" r="10" fill="#dfb458" stroke="#b98a33" strokeWidth="1.5" /><circle cx="12" cy="12" r="7" fill="none" stroke="#f9dfa0" /><path d="M10 8h4m-2-1v10m-2-1h4" stroke="#986b29" strokeWidth="2" /></>
    : <><path d="m6 4-4 6 10 12 10-12-4-6Z" fill="#8ac7cb" stroke="#4c979f" strokeWidth="1.5" /><path d="M2 10h20M6 4l6 18 6-18M6 4l6 6 6-6" fill="none" stroke="#d9f0e5" strokeWidth="1.2" /></>}</svg>
}

export function Shop({ runtime, close, place, decorate, merge }: { runtime: GameRuntime; close: () => void;
  place: (id: string) => void; decorate: (id: DecorId) => void; merge: () => void }) {
  const state = useSyncExternalStore(runtime.subscribeUi, runtime.getUiSnapshot), inventory = state.production!.inventory
  const dialog = useRef<HTMLDialogElement>(null), [category, setCategory] = useState<'all' | ShopProduct['category']>('all')
  const [notice, setNotice] = useState(''), [busy, setBusy] = useState(false)
  useEffect(() => { dialog.current?.showModal() }, [])
  const send = async (command: GameCommand) => {
    setBusy(true)
    try { const result = await runtime.dispatch(command); setNotice(result.accepted ? result.message ?? '已完成' : result.reason) }
    finally { setBusy(false) }
  }
  const use = (product: ShopProduct) => {
    if (product.category === 'outfit') void send({ type: 'outfit-equip', outfitId: product.reward })
    else if (product.category === 'blueprint') { close(); place(product.reward) }
    else if (product.category === 'decor') { close(); decorate(product.reward as DecorId) }
    else { close(); merge() }
  }
  return <dialog ref={dialog} className={styles.shop} aria-labelledby="shop-title" data-testid="shop" onCancel={close}
    onClick={e => { if (e.target === e.currentTarget) close() }}>
    <header><div><small>林间小铺</small><h2 id="shop-title">把喜欢带回家</h2></div><button onClick={close} aria-label="关闭商店">×</button></header>
    <div className={styles.wallet}><span><CurrencyIcon kind="gold" />金币 <b data-testid="shop-gold">{inventory.gold}</b></span>
      <span><CurrencyIcon kind="gems" />钻石 <b data-testid="shop-gems">{inventory.gems}</b></span></div>
    <nav aria-label="商店分类">{([['all', '全部'], ['tools', '工具'], ['blueprint', '图纸'], ['decor', '装饰'], ['outfit', '衣裳']] as const).map(([id, name]) =>
      <button key={id} aria-pressed={category === id} onClick={() => setCategory(id)}>{name}</button>)}</nav>
    <div className={styles.content}>
      {!!state.economy.pendingLoot.length && <section className={styles.loot}><h3>留给你的物资</h3><p>清理时棋盘和仓库已满，物资保留在这里。</p>
        {state.economy.pendingLoot.map(id => {
          const object = runtime.world.allConfiguredObjects().find(o => o.id === id)!, rule = RESOURCE_RULES[object.kind]
          return <div key={id} className={styles.claim}><span>{rule.items.map(item => runtime.catalog!.itemById.get(item)!.name).join('、')}</span>
            <button disabled={busy || !!state.pauseReasons.length} onClick={() => void send({ type: 'loot-claim', objectId: id })}>领取物资</button></div>
        })}</section>}
      <div className={styles.grid}>{SHOP_PRODUCTS.filter(p => category === 'all' || p.category === category).map(product => {
        const owned = ownsProduct(product, state.economy, state.construction, state.progression), affordable = inventory[product.currency] >= product.price
        const outfit = OUTFITS.find(o => o.id === product.reward), decor = DECORATIONS.find(d => d.id === product.reward)
        const equipped = product.category === 'outfit' && state.progression.outfit === product.reward
        return <article key={product.id} className={styles.product} data-testid={`product-${product.id}`} data-owned={String(owned)}>
          <div className={`${styles.art} ${styles[product.category]}`}>
            {product.category === 'tools' ? <MergePiece item={runtime.catalog!.itemById.get(Number(product.reward))!} />
              : product.category === 'outfit' ? <svg viewBox="0 0 50 55" aria-hidden="true"><path d="M15 4 4 14l6 12 7-3-5 27h26l-5-27 7 3 6-12L35 4q-10 10-20 0" fill={`#${outfit!.color.toString(16)}`} /><path d="M17 22h16M20 10l12 33" stroke="#f4e2bd" fill="none" /></svg>
              : product.category === 'decor' ? <span style={{ color: decor!.color }}>{decor!.symbol}</span>
              : <svg viewBox="0 0 60 60" fill="none" stroke="#68866f" strokeWidth="2" aria-hidden="true"><rect x="6" y="6" width="48" height="48" rx="4" fill="#e0eadc" /><path d="m14 30 16-14 16 14M18 27v20h24V27M26 47V34h8v13M13 51h34" /></svg>}
            {owned && <small>已拥有</small>}
          </div>
          <h3>{product.name}</h3><p>{product.description}</p>
          <button data-testid={`buy-${product.id}`} disabled={busy || !!state.pauseReasons.length || equipped || !owned && !affordable}
            onClick={() => owned ? use(product) : void send({ type: 'shop-buy', productId: product.id })}>
            {owned ? equipped ? '穿着中' : product.category === 'blueprint' ? '放置图纸' : product.category === 'decor' ? '摆放' : product.category === 'outfit' ? '换上' : '去合成'
              : !affordable ? `${product.currency === 'gold' ? '金币' : '钻石'}不足 · ${product.price}` : product.price === 0 ? '免费领取' : <><CurrencyIcon kind={product.currency} />{product.price} · 购买</>}
          </button>
        </article>
      })}</div>
      <p className={styles.hint}>清理树木和石头可获得金币、钻石与合成材料。已拥有的收藏不会重复收费。</p>
    </div>
    <footer role="status">{notice || '图纸、衣裳与装饰购买后永久拥有'}</footer>
  </dialog>
}
