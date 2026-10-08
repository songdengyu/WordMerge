import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { GameCommand, GameRuntime } from '../../game/GameRuntime'
import { SHOP_PRODUCTS, RESOURCE_RULES, type ShopProduct } from '../../game/economyConfig'
import { ownsProduct } from '../../game/economy'
import { DECORATIONS, OUTFITS } from '../../game/progressionConfig'
import { decorAvailable } from '../../game/progression'
import { MergePiece } from '../../components/MergePiece'
import { HouseArt, OutfitArt, DecorationArt } from './ContentArt'
import styles from './Shop.module.css'

export function CurrencyIcon({ kind }: { kind: 'gold' | 'gems' }) {
  return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">{kind === 'gold'
    ? <><circle cx="12" cy="12" r="10" fill="#dfb458" stroke="#b98a33" strokeWidth="1.5" /><circle cx="12" cy="12" r="7" fill="none" stroke="#f9dfa0" /><path d="M10 8h4m-2-1v10m-2-1h4" stroke="#986b29" strokeWidth="2" /></>
    : <><path d="m6 4-4 6 10 12 10-12-4-6Z" fill="#8ac7cb" stroke="#4c979f" strokeWidth="1.5" /><path d="M2 10h20M6 4l6 18 6-18M6 4l6 6 6-6" fill="none" stroke="#d9f0e5" strokeWidth="1.2" /></>}</svg>
}

export function Shop({ runtime, close, place, collection, merge }: { runtime: GameRuntime; close: () => void;
  place: (id: string) => void; collection: () => void; merge: () => void }) {
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
    if (product.category === 'outfit') collection()
    else if (product.category === 'blueprint') { close(); place(product.reward) }
    else if (product.category === 'decor') collection()
    else { close(); merge() }
  }
  return <dialog ref={dialog} className={styles.shop} aria-labelledby="shop-title" data-testid="shop" onCancel={close}
    onClick={e => { if (e.target === e.currentTarget) close() }}>
    <header><div><small>林间小铺</small><h2 id="shop-title">把喜欢带回家</h2></div></header>
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
        const repeatable = product.category === 'decor'
        return <article key={product.id} className={styles.product} data-testid={`product-${product.id}`} data-owned={String(owned)}>
          <div className={`${styles.art} ${styles[product.category]}`}>
            {product.category === 'tools' ? <MergePiece item={runtime.catalog!.itemById.get(Number(product.reward))!} />
              : product.category === 'outfit' ? <OutfitArt id={outfit!.id} />
              : product.category === 'decor' ? <DecorationArt kind={decor!.id} />
              : <HouseArt id={product.reward} />}
            {(owned || repeatable) && <small>{repeatable ? `库存 ${decorAvailable(state.progression, product.reward)}` : '已拥有'}</small>}
          </div>
          <h3>{product.name}</h3><p>{product.category === 'outfit' ? '购买后存入装饰系统，可随时换装。' : product.description}</p>
          <button data-testid={`buy-${product.id}`} disabled={busy || !!state.pauseReasons.length || (repeatable || !owned) && !affordable}
            onClick={() => owned && !repeatable ? use(product) : void send({ type: 'shop-buy', productId: product.id })}>
            {owned && !repeatable ? product.category === 'blueprint' ? '放置图纸' : product.category === 'outfit' ? '前往装饰' : '去合成'
              : !affordable ? `${product.currency === 'gold' ? '金币' : '钻石'}不足 · ${product.price}` : product.price === 0 ? '免费领取' : <><CurrencyIcon kind={product.currency} />{product.price} · 购买</>}
          </button>
        </article>
      })}</div>
      <p className={styles.hint}>摆件可重复购买，每次获得 1 件。人物皮肤永久解锁；购买后在装饰系统中管理。</p>
      <button className={styles.collection} onClick={collection}>打开装饰收藏</button>
    </div>
    <footer><p role="status">{notice || '图纸和皮肤永久解锁，摆件按件入库'}</p>
      <button className={styles.returnButton} onClick={close}>回到地图</button></footer>
  </dialog>
}
