import { useGameStore } from '../store/useGameStore'
import styles from './SkillBookWallet.module.css'

export function SkillBookWallet() {
  const { state, skillBookCount, exchangeSkillBooks, addTestResource } = useGameStore()
  const bookItem = state.equipmentCatalog.find((item) => item.type === 8)
  const exchangeCost = 100
  const exchangeQuantity = 100

  return (
    <div className={styles.wallet}>
      <button
        type="button"
        className={styles.balance}
        title="测试：点击增加 1000 本技能书"
        onClick={(event) => {
          event.stopPropagation()
          addTestResource('skillBooks')
        }}
      >
        <span>▤</span>
        <strong>{skillBookCount}</strong>
      </button>
      {bookItem && (
        <button
          type="button"
          className={styles.exchange}
          disabled={state.diamonds < exchangeCost}
          onClick={(event) => {
            event.stopPropagation()
            exchangeSkillBooks()
          }}
          title={`消耗 ${exchangeCost} 钻石兑换 ${exchangeQuantity} 本技能书`}
        >
          ◆{exchangeCost} → ▤{exchangeQuantity}
        </button>
      )}
    </div>
  )
}
