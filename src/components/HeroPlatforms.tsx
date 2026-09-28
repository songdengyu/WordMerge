import { useEffect, useRef, useState } from 'react'
import { useGameStore } from '../store/useGameStore'
import type { Hero } from '../data/heroes'
import { buildPlatformRows } from '../utils/platformLayout'
import { CharacterAvatar } from './CharacterAvatar'
import styles from './HeroPlatforms.module.css'

function Platform({
  side,
  slots,
  spawning,
}: {
  side: 'left' | 'right'
  slots: (Hero | null)[]
  spawning: Set<string>
}) {
  const hasHero = slots.some(Boolean)
  if (!hasHero) {
    return <div className={styles.sideEmpty} />
  }

  const ordered =
    side === 'left'
      ? [slots[2], slots[1], slots[0]]
      : [slots[0], slots[1], slots[2]]

  return (
    <div className={side === 'left' ? styles.platformSideLeft : styles.platformSideRight}>
      <div className={styles.platform}>
        <div className={styles.slots}>
          {ordered.map((hero, index) => (
            <div key={index} className={styles.slot}>
              {hero ? (
                <div
                  className={`${styles.avatarWrap} ${spawning.has(hero.id) ? styles.spawnIn : ''}`}
                  data-combat-source={hero.id}
                >
                  <CharacterAvatar role={hero.role} size="sm" />
                </div>
              ) : (
                <div className={styles.slotPlaceholder} />
              )}
            </div>
          ))}
        </div>
        <div className={styles.platformBar}>
          <span className={styles.rune} />
        </div>
      </div>
    </div>
  )
}

export function HeroPlatforms() {
  const { state } = useGameStore()
  const { heroes, deployedSlots } = state
  const prevSlots = useRef<(string | null)[]>(deployedSlots)
  const [spawning, setSpawning] = useState<Set<string>>(new Set())

  useEffect(() => {
    const added = deployedSlots.filter((id): id is string => Boolean(id) && !prevSlots.current.includes(id))
    prevSlots.current = deployedSlots
    if (added.length === 0) return
    setSpawning(new Set(added))
    const timer = setTimeout(() => setSpawning(new Set()), 620)
    return () => clearTimeout(timer)
  }, [deployedSlots])

  const rows = buildPlatformRows(heroes, deployedSlots)
  if (rows.length === 0) return null

  return (
    <div className={styles.wrap} data-no-tap-attack>
      {rows.map((row, rowIndex) => (
        <div key={rowIndex} className={styles.rowPair}>
          <Platform side="left" slots={row.left} spawning={spawning} />
          <div className={styles.centerGap} />
          <Platform side="right" slots={row.right} spawning={spawning} />
        </div>
      ))}
    </div>
  )
}
