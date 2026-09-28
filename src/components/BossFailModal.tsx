import { useGameStore } from '../store/useGameStore'
import styles from './BossFailModal.module.css'

export function BossFailModal() {
  const { state, dismissBossFail } = useGameStore()

  if (!state.showBossFailModal) return null

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <div className={styles.icon} />
        <h2 className={styles.title}>挑战失败</h2>
        <p className={styles.desc}>Boss挑战失败，请重新历练</p>
        <button type="button" className={styles.btn} onClick={dismissBossFail}>
          重新挑战本关
        </button>
      </div>
    </div>
  )
}
