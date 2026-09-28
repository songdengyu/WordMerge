import { useGameStore } from '../store/useGameStore'
import styles from './Toast.module.css'

export function Toast() {
  const { state } = useGameStore()
  if (!state.toast) return null

  return <div className={styles.toast} role="status" aria-live="polite">{state.toast}</div>
}
