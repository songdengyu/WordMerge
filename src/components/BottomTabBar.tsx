import { useGameStore } from '../store/useGameStore'
import { ArtIcon } from './ArtIcon'
import styles from './BottomTabBar.module.css'

const TABS = [
  { id: 'equipment' as const, label: '装备' },
  { id: 'skills' as const, label: '技能' },
  { id: 'heroes' as const, label: '英雄' },
]

export function BottomTabBar() {
  const { state, hasUpgradeableSkill, setActiveTab, openMergeView } = useGameStore()

  return (
    <div className={styles.bar}>
      <div className={styles.tabs}>
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`${styles.tab} ${state.tabPanelOpen && state.activeTab === tab.id ? styles.active : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.id === 'skills' && hasUpgradeableSkill && <i className={styles.redDot} />}
            <ArtIcon sheet="ui" name={tab.id} className={styles.tabIcon} />
            <span className={styles.tabLabel}>{tab.label}</span>
          </button>
        ))}
      </div>
      <button
        type="button"
        className={styles.craftBtn}
        onClick={openMergeView}
        aria-label="合成"
      >
        <ArtIcon sheet="ui" name="craft" className={styles.craftIcon} />
        <span className={styles.craftLabel}>合成</span>
      </button>
    </div>
  )
}
