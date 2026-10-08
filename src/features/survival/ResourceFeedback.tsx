import { useEffect, useRef, useState } from 'react'
import type { GameRuntime, ResourceFeedback as Feedback, UiSnapshot } from '../../game/GameRuntime'
import { MergePiece } from '../../components/MergePiece'
import styles from './ResourceFeedback.module.css'

/** Animations consume presentation receipts only; inventory is owned by Runtime. */
export function ResourceFeedback({ state, runtime, stat, compact = false }: {
  state: UiSnapshot; runtime: GameRuntime; stat: Feedback['stat']; compact?: boolean
}) {
  const seen = useRef({ runtime, id: state.resourceFeedback[state.resourceFeedback.length - 1]?.id ?? 0 })
  const [entries, setEntries] = useState<Feedback[]>([])
  useEffect(() => {
    const latest = state.resourceFeedback[state.resourceFeedback.length - 1]?.id ?? 0
    const previous = seen.current
    seen.current = { runtime, id: latest }
    if (previous.runtime !== runtime || state.pauseReasons.includes('importing')) { setEntries([]); return }
    const added = state.resourceFeedback.filter(entry => entry.id > previous.id && entry.stat === stat)
    if (added.length) setEntries(current => [...current, ...added].slice(-4))
  }, [runtime, state.resourceFeedback, state.pauseReasons, stat])
  useEffect(() => {
    if (!entries.length) return
    const timer = window.setTimeout(() => setEntries([]), 2400)
    return () => window.clearTimeout(timer)
  }, [entries])
  return <>{entries.map((entry, index) => {
    const item = entry.itemId === undefined ? null : runtime.catalog!.itemById.get(entry.itemId)
    return <span key={entry.id} className={`${styles.float} ${item ? styles.supply : styles.spend} ${compact ? styles.compact : ''}`}
      style={{ marginTop: index * 22 }} data-testid={item ? `supply-used-${stat}` : 'stamina-spend-float'}
      data-item-id={entry.itemId} aria-hidden="true"
      onAnimationEnd={() => setEntries(current => current.filter(value => value.id !== entry.id))}>
      {item && <><MergePiece item={item} compact /><span>{item.name} ×1</span></>}
      <b>{entry.amount > 0 ? '+' : '−'}{Math.round(Math.abs(entry.amount) * 10) / 10}</b>
    </span>
  })}</>
}

export function StaminaValue({ state, runtime, testId }: { state: UiSnapshot; runtime: GameRuntime; testId: string }) {
  return <span className={styles.anchor}>⚡ <strong data-testid={testId}>{state.production?.stamina.value ?? 100}</strong>
    <ResourceFeedback state={state} runtime={runtime} stat="stamina" compact />
  </span>
}
