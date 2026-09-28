import { getHeroDps, getHeroUpgradeCost, type Hero } from '../data/heroes'
import { CharacterAvatar } from './CharacterAvatar'
import styles from './HeroCard.module.css'

interface HeroCardProps {
  hero: Hero
  deployed: boolean
  onDeploy: () => void
  onWithdraw: () => void
  onUpgrade: () => void
  gold: number
}

export function HeroCard({ hero, deployed, onDeploy, onWithdraw, onUpgrade, gold }: HeroCardProps) {
  const dps = getHeroDps(hero)
  const cost = getHeroUpgradeCost(hero)
  const unlocked = hero.level > 0

  return (
    <div className={`${styles.card} ${deployed ? styles.deployed : ''} ${!unlocked ? styles.locked : ''} ${!unlocked && gold >= cost ? styles.affordable : ''}`}>
      <CharacterAvatar role={hero.role} size="md" />
      <div className={styles.info}>
        <div className={styles.name}>{hero.name}</div>
        <div className={styles.stats}>
          <span className={styles.level}>{unlocked ? `Lv.${hero.level}` : '未解锁'}</span>
          <span className={styles.dps}>DPS {unlocked ? dps : hero.baseDps}</span>
        </div>
      </div>
      <div className={styles.actions}>
        {unlocked && (deployed ? (
          <button type="button" className={styles.btnWithdraw} onClick={onWithdraw}>
            下阵
          </button>
        ) : (
          <button type="button" className={styles.btnDeploy} onClick={onDeploy}>
            上阵
          </button>
        ))}
        <button
          type="button"
          className={`${styles.btnUpgrade} ${!unlocked && gold >= cost ? styles.unlockReady : ''}`}
          disabled={gold < cost}
          onClick={onUpgrade}
        >
          <span>{unlocked ? '升级' : '解锁'}</span>
          <strong>● {cost}</strong>
        </button>
      </div>
    </div>
  )
}
