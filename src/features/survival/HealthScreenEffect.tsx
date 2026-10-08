import { useEffect, useRef, useState } from 'react'
import type { GameRuntime, UiSnapshot } from '../../game/GameRuntime'
import styles from './HealthScreenEffect.module.css'

export function HealthScreenEffect({ state, runtime }: { state: UiSnapshot; runtime: GameRuntime }) {
  const hp = state.production?.vitals.hp ?? 100
  const suppressed = !!state.survival.failure || state.pauseReasons.some(reason =>
    reason === 'importing' || reason === 'renderer-loading' || reason === 'save-error' || reason === 'background' || reason === 'page-hidden')
  const previous = useRef({ runtime, hp, suppressed })
  const lastPulse = useRef(-Infinity)
  const [pulse, setPulse] = useState(0)
  useEffect(() => {
    const before = previous.current
    previous.current = { runtime, hp, suppressed }
    if (before.runtime !== runtime || suppressed || before.suppressed || hp <= 0) {
      setPulse(0); lastPulse.current = -Infinity; return
    }
    // Coalesce frequent damage ticks into one gentle fade, rather than repeated flashing.
    const now = performance.now()
    if (hp < before.hp && now - lastPulse.current >= 1200) {
      lastPulse.current = now
      setPulse(value => value + 1)
    }
  }, [runtime, hp, suppressed])
  useEffect(() => {
    if (!pulse) return
    const timer = window.setTimeout(() => setPulse(0), 900)
    return () => window.clearTimeout(timer)
  }, [pulse])
  if (suppressed || hp <= 0) return null
  return <div className={styles.overlay} aria-hidden="true" data-testid="health-screen-effect">
    {hp < 20 && <div className={styles.lowHealth} data-testid="low-health-screen-effect" />}
    {pulse > 0 && <div key={pulse} className={styles.damage} data-testid="damage-screen-effect" />}
  </div>
}
