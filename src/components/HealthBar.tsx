import styles from './HealthBar.module.css'

interface HealthBarProps {
  name: string
  currentHp: number
  maxHp: number
  isBoss: boolean
  bossTimer?: number
}

export function HealthBar({ name, currentHp, maxHp, isBoss, bossTimer }: HealthBarProps) {
  const percent = maxHp > 0 ? (currentHp / maxHp) * 100 : 0

  return (
    <div className={styles.wrapper}>
      {isBoss && bossTimer !== undefined && (
        <div className={styles.bossTimer}>
          <span className={styles.timerIcon}>⏱</span>
          {Math.ceil(bossTimer ?? 0)}s
        </div>
      )}
      <div className={styles.barContainer}>
        <div className={styles.name}>{name}</div>
        <div className={styles.track}>
          <div
            className={`${styles.fill} ${isBoss ? styles.bossFill : ''}`}
            style={{ width: `${percent}%` }}
          />
        </div>
        <div className={styles.hp}>{Math.ceil(currentHp)} / {maxHp}</div>
      </div>
    </div>
  )
}
