import { useGameStore } from '../store/useGameStore'
import { EquipmentTab } from './EquipmentTab'
import { HeroPanel } from './HeroPanel'
import { SkillsTab } from './SkillsTab'
import styles from './MainPanel.module.css'

export function MainPanel() {
  const { state, closeTabPanel } = useGameStore()

  return (
    <div className={styles.panel}>
      <button type="button" className={styles.closeBtn} onClick={closeTabPanel} aria-label="关闭分页">
        ✕
      </button>
      <div className={styles.content}>
        {state.activeTab === 'equipment' && <EquipmentTab />}
        {state.activeTab === 'skills' && <SkillsTab />}
        {state.activeTab === 'heroes' && (
          <div className={styles.heroTab}>
            <div className={styles.heroTitle}>英雄管理</div>
            <HeroPanel />
          </div>
        )}
      </div>
    </div>
  )
}
