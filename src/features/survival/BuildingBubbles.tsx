import { useSyncExternalStore, type RefObject } from 'react'
import { MergePiece } from '../../components/MergePiece'
import type { GameRuntime, GameCommand } from '../../game/GameRuntime'
import { blueprintById } from '../../game/buildingConfig'
import { buildingSummary, localToWorld } from '../../game/construction'
import { availableItems, matchRequirements } from '../../game/inventory'
import styles from './BuildingBubbles.module.css'

export function BuildingBubbles({ runtime, layer, hidden, openMerge, message }: {
  runtime: GameRuntime; layer: RefObject<HTMLDivElement>; hidden: boolean; openMerge: () => void; message: (text: string) => void
}) {
  const state = useSyncExternalStore(runtime.subscribeUi, runtime.getUiSnapshot)
  const inventory = state.production!.inventory
  const available = availableItems(inventory)
  const send = async (command: GameCommand) => {
    const result = await runtime.dispatch(command)
    if (!result.accepted) message(result.reason)
    else if (result.openProduction) openMerge()
    else if (result.message) message(result.message)
  }
  return <div ref={layer} className={styles.layer} hidden={hidden} aria-label="地图建造气泡">
    {state.construction.buildings.map(building => {
      const blueprint = blueprintById(building.blueprintId)!
      const summary = buildingSummary(building)
      const parts = blueprint.parts.filter(config => {
        const part = building.parts[config.id]
        return (!part.built || part.hp < config.hp) && config.requires.every(id => building.parts[id].built)
      })
      const anchor = localToWorld(building, { x: (blueprint.width - 1) / 2, y: (blueprint.height - 1) / 2 })
      const canRemove = !summary.builtCount && !state.construction.jobs.some(job => state.construction.orders.find(order => order.id === job.orderId)?.buildingId === building.id)
      return <div key={building.id} className={styles.anchor} data-map-x={anchor.x} data-map-y={anchor.y}
        data-map-rise={building.parts.roof.built ? 54 : building.parts.walls.built ? 40 : 14} data-testid={`building-anchor-${building.id}`}>
        <div className={styles.group}>
          {canRemove && <button className={styles.remove} aria-label={`收回图纸 ${building.id}`} disabled={!!state.pauseReasons.length}
            onClick={() => void send({ type: 'building-remove', buildingId: building.id })}>×</button>}
          <div className={styles.parts}>
            {parts.map(config => {
              const part = building.parts[config.id]
              const orderId = `${building.id}:${config.id}`
              const job = state.construction.jobs.find(job => job.orderId === orderId)
              const materials = part.built ? config.repairMaterials : config.materials
              const ready = !job && matchRequirements(inventory, materials) !== null
              const counts = new Map<number, number>()
              materials.forEach(id => counts.set(id, (counts.get(id) ?? 0) + 1))
              const supplies = [...counts].map(([id, needed]) => ({
                item: runtime.catalog!.itemById.get(id)!, needed,
                owned: job ? needed : available.filter(item => item.itemId === id).length,
              }))
              const action = job ? job.phase === 'building' ? '施工中，保护生效' : job.phase === 'travel' ? '正在前往' : '已排队'
                : ready ? `点击${part.built ? '修复' : '建造'}` : '缺少材料，点击去合成'
              return <div className={styles.part} key={config.id}>
                <button className={styles.bubble} data-testid={`build-bubble-${orderId}`} data-ready={String(ready)} data-phase={job?.phase ?? 'materials'}
                  aria-label={`${part.built ? '修复' : '建造'}${config.name}，${supplies.map(({ item, owned, needed }) => `${item.name} ${owned}/${needed}`).join('，')}，${action}`}
                  disabled={!!job || !!state.pauseReasons.length} onClick={() => void send({ type: 'building-interact', buildingId: building.id, partId: config.id })}>
                  {supplies.map(({ item, owned, needed }) => <span className={styles.material} key={item.id} data-material-id={item.id}>
                    <span className={styles.icon} aria-hidden="true"><MergePiece item={item} compact /></span>
                    <span className={styles.quantity}>{owned}/{needed}</span>
                    {job?.phase === 'building' && <svg className={styles.progress} viewBox="0 0 60 60" aria-hidden="true">
                      <circle cx="30" cy="30" r="27" pathLength="1" strokeDasharray="1"
                        strokeDashoffset={Math.max(0, Math.min(1, job.remaining / (part.built ? config.repairSeconds : config.seconds)))} />
                    </svg>}
                  </span>)}
                </button>
                {job && job.phase !== 'building' && <button className={styles.cancel} disabled={!!state.pauseReasons.length}
                  aria-label={`取消工程 ${config.name} ${building.id}`} onClick={() => void send({ type: 'building-cancel', orderId })}>×</button>}
              </div>
            })}
            {!parts.length && <button className={`${styles.bubble} ${styles.complete}`} data-testid={`building-complete-${building.id}`}
              aria-label={`木屋已建成，${summary.enclosed ? '围护封闭' : '围护有缺口'}，点击进入`}
              disabled={!!state.pauseReasons.length} onClick={() => void send({ type: 'move', target: localToWorld(building, { x: 1, y: 1 }) })}>
              <span className={styles.material}><svg className={styles.house} viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m4 14 12-10 12 10M7 12v16h18V12M13 28v-9h6v9" />
              </svg></span>
            </button>}
          </div>
        </div>
      </div>
    })}
  </div>
}
