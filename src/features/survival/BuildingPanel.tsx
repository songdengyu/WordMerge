import { useSyncExternalStore } from 'react'
import type { GameRuntime } from '../../game/GameRuntime'
import { BLUEPRINTS, blueprintById } from '../../game/buildingConfig'
import { buildingSummary } from '../../game/construction'
import { HouseArt } from './ContentArt'
import { houseStyle } from '../../scene/houseStyle'
import styles from './BuildingPanel.module.css'

/** Blueprint picker only; all material and construction interactions live on the map. */
export function BuildingPanel({ runtime, select, close, place }: {
  runtime: GameRuntime; select: (id: string) => void; close: () => void; place: (id: string) => void
}) {
  const { construction } = useSyncExternalStore(runtime.subscribeUi, runtime.getUiSnapshot)
  return <section className={styles.panel} aria-label="营地建设" data-testid="building-panel">
    <header><div><small>一块木板，一处归宿</small><h2>营地建设</h2></div></header>
    <div className={styles.scroll}>
      {BLUEPRINTS.filter(blueprint => construction.unlockedBlueprints.includes(blueprint.id)).map(blueprint => <div className={styles.blueprint} key={blueprint.id}>
        <div className={styles.house}><HouseArt id={blueprint.id} /></div><div><h3>{blueprint.name}</h3><p>{houseStyle(blueprint.id).tier} · {blueprint.width} × {blueprint.height} 地块</p><p>地基 / 墙 / 门 / 顶 / 床 · 每部分 2 秒</p></div>
        <button onClick={() => place(blueprint.id)}>放置图纸</button></div>)}
      {construction.buildings.map(building => <button className={styles.buildingLink} key={building.id} onClick={() => select(building.id)}>
        {blueprintById(building.blueprintId)!.name} · {building.id.toUpperCase()}<span>{buildingSummary(building).builtCount}/5 · 定位 ›</span></button>)}
      <p className={styles.note}>绿色气泡可以直接建造；材料不足时点击气泡去合成。建筑之间留一格通道。</p>
    </div>
    <footer><button onClick={close}>回到地图</button></footer>
  </section>
}
