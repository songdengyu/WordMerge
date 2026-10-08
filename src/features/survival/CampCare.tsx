import { useEffect, useRef, useSyncExternalStore } from 'react'
import type { GameRuntime, UiSnapshot } from '../../game/GameRuntime'
import { VitalIcons } from './StatusIcons'
import styles from './CampCare.module.css'

export const VitalLine = VitalIcons
export function SurvivalHud({ state, runtime, openMerge, message }: {
  state: UiSnapshot; runtime: GameRuntime; openMerge: () => void; message: (text: string) => void
}) {
  return <aside className={styles.hud}>
    <VitalLine state={state} runtime={runtime} openMerge={openMerge} message={message} />
  </aside>
}
export function FailurePanel({ runtime, message }: { runtime: GameRuntime; message: (text: string) => void }) {
  const state = useSyncExternalStore(runtime.subscribeUi, runtime.getUiSnapshot), failure = state.survival.failure!
  const button = useRef<HTMLButtonElement>(null)
  useEffect(() => { button.current?.focus() }, [])
  return <section className={styles.failure} role="alertdialog" aria-modal="true" aria-labelledby="failure-title" data-testid="failure-panel">
    <span className={styles.rescueIcon}>☀</span><small>第 {failure.day} 天 · {failure.cause === 'enemy' ? '营地遇袭' : '需要照料自己'}</small>
    <h2 id="failure-title">先歇一会儿吧</h2><p>你倒下了。接受救援后，会在下一个清晨回到营地。</p>
    <p>这次散落：{failure.losses.length ? failure.losses.map(item => runtime.catalog!.itemById.get(item.itemId)!.name).join('、') : '没有普通物资损失'}。</p>
    <p>建筑和成长保留，受损部件仍需修复，伙伴仍需照护。</p>
    <button ref={button} className={styles.primary} disabled={state.saveStatus.state !== 'saved' || state.pauseReasons.some(reason => reason !== 'failure')} onClick={async () => {
      const result = await runtime.dispatch({ type: 'rescue' }); message(result.accepted ? result.message ?? '已回到营地' : result.reason)
    }}>接受救援</button>
    <small>{state.saveStatus.state === 'saving' ? '正在保管营地进度…' : '生命恢复至 70，饱食与水分恢复至 60'}</small>
  </section>
}
