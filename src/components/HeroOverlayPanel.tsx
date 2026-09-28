import { useGameStore } from '../store/useGameStore'
import { HeroPanel } from './HeroPanel'
import styles from './HeroOverlayPanel.module.css'

export function HeroOverlayPanel() {
  const { closeTabPanel } = useGameStore()

  return (
    <div className={styles.overlay}>
      <div className={styles.panel}>
        <div className={styles.header}>
          <h2 className={styles.title}>英雄管理</h2>
          <button type="button" className={styles.closeBtn} onClick={closeTabPanel} aria-label="关闭英雄分页">
            ✕
          </button>
        </div>
        <HeroPanel />
      </div>
    </div>
  )
}
