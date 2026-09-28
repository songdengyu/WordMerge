import { forwardRef, useEffect } from 'react'
import { MONSTER_DEATH_ANIM_MS, MONSTER_SPAWN_ANIM_MS } from '../data/combat'
import type { MonsterPhase } from '../store/useGameStore'
import { ArtIcon } from './ArtIcon'
import styles from './MonsterSprite.module.css'

interface MonsterSpriteProps {
  name: string
  isBoss: boolean
  hit: boolean
  phase: MonsterPhase
  onDeathComplete?: () => void
  onSpawnComplete?: () => void
}

export const MonsterSprite = forwardRef<HTMLDivElement, MonsterSpriteProps>(
  function MonsterSprite({ name, isBoss, hit, phase, onDeathComplete, onSpawnComplete }, ref) {
    useEffect(() => {
      if (phase !== 'dying' || !onDeathComplete) return
      const timer = setTimeout(onDeathComplete, MONSTER_DEATH_ANIM_MS)
      return () => clearTimeout(timer)
    }, [phase, onDeathComplete])

    useEffect(() => {
      if (phase !== 'spawning' || !onSpawnComplete) return
      const timer = setTimeout(onSpawnComplete, MONSTER_SPAWN_ANIM_MS)
      return () => clearTimeout(timer)
    }, [phase, onSpawnComplete])

    const phaseClass =
      phase === 'dying' ? styles.dying : phase === 'spawning' ? styles.spawning : ''

    return (
      <div
        ref={ref}
        className={`${styles.monster} ${hit && phase === 'fighting' ? styles.hit : ''} ${isBoss ? styles.boss : ''} ${phaseClass}`}
        aria-label={name}
      >
        <ArtIcon
          sheet="monsters"
          name={MONSTER_ART[name] ?? (isBoss ? 'abyss-king' : 'imp')}
          viewBox={isBoss ? '0 0 140 240' : '0 0 120 120'}
          className={styles.svg}
        />
        <span className={styles.shadow} />
      </div>
    )
  },
)

const MONSTER_ART: Record<string, string> = {
  史莱姆: 'slime', 哥布林: 'goblin', 蝙蝠: 'bat', 骷髅兵: 'skeleton', 野狼: 'wolf',
  蜘蛛: 'spider', 食人花: 'plant', 石怪: 'golem', 幽灵: 'ghost', 小恶魔: 'imp',
  巨型章鱼: 'octopus', 暗影领主: 'shadow-lord', 熔岩巨兽: 'lava-beast',
  冰霜龙王: 'frost-dragon', 深渊魔王: 'abyss-king',
}
