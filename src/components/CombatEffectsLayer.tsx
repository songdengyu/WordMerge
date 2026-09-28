import { useEffect, type CSSProperties } from 'react'

import type { Bullet, DamagePopup, SkillEffect } from '../hooks/useCombatEffects'

import styles from './CombatEffectsLayer.module.css'



interface CombatEffectsLayerProps {

  bullets: Bullet[]

  popups: DamagePopup[]
  skillEffects: SkillEffect[]

  onBulletEnd: (id: number) => void

  onPopupEnd: (id: number) => void
  onSkillEffectEnd: (id: number) => void

}



export function CombatEffectsLayer({

  bullets,

  popups,
  skillEffects,

  onBulletEnd,

  onPopupEnd,
  onSkillEffectEnd,

}: CombatEffectsLayerProps) {

  return (

    <div className={styles.layer}>

      {bullets.map((bullet) => (

        <BulletProjectile key={bullet.id} bullet={bullet} onEnd={onBulletEnd} />

      ))}

      {popups.map((popup) => (

        <DamageFloater key={popup.id} popup={popup} onEnd={onPopupEnd} />

      ))}
      {skillEffects.map((effect) => (
        <SkillBurst key={effect.id} effect={effect} onEnd={onSkillEffectEnd} />
      ))}

    </div>

  )

}

function SkillBurst({ effect, onEnd }: { effect: SkillEffect; onEnd: (id: number) => void }) {
  useEffect(() => {
    const timer = setTimeout(() => onEnd(effect.id), 900)
    return () => clearTimeout(timer)
  }, [effect.id, onEnd])

  return (
    <span
      className={`${styles.skillEffect} ${styles[`skill_${effect.shape}`]}`}
      style={{
        left: effect.x,
        top: effect.y,
        '--skill-color': effect.color,
        '--skill-accent': effect.accent,
      } as CSSProperties}
    >
      <span className={styles.skillCore} />
      <span className={styles.skillRing} />
    </span>
  )
}



function BulletProjectile({

  bullet,

  onEnd,

}: {

  bullet: Bullet

  onEnd: (id: number) => void

}) {

  const dx = bullet.toX - bullet.fromX

  const dy = bullet.toY - bullet.fromY

  const isMainSlash = bullet.style === 'mainSlash'

  const isHero = bullet.style === 'hero'

  const isSlash = bullet.style === 'slash' || (isHero && bullet.heroShape === 'slash')



  useEffect(() => {

    const duration = isMainSlash ? 220 : 280

    const timer = setTimeout(() => onEnd(bullet.id), duration)

    return () => clearTimeout(timer)

  }, [bullet.id, onEnd, isMainSlash])



  if (isMainSlash) {

    return (

      <span

        className={styles.mainSlash}

        style={{
          left: bullet.toX,
          top: bullet.toY,
          '--color': bullet.color,
          '--slash-angle': `${bullet.slashAngle ?? -42}`,
        } as CSSProperties}

      />

    )

  }



  const styleClass = isHero

    ? styles[`hero_${bullet.heroShape ?? 'round'}`]

    : styles[`bullet_${bullet.style}`]



  const inlineStyle = {

    left: bullet.fromX,

    top: bullet.fromY,

    '--dx': `${dx}px`,

    '--dy': `${dy}px`,

    '--color': bullet.color,

    ...(isHero

      ? {

          width: bullet.heroWidth ?? 10,

          height: bullet.heroHeight ?? 10,

          ...(bullet.heroShape === 'round'

            ? {

                backgroundColor: bullet.color,

                boxShadow: `0 0 6px ${bullet.color}`,

              }

            : {}),

        }

      : {}),

  } as CSSProperties



  return (

    <span

      className={`${styles.bullet} ${styleClass ?? ''} ${isSlash ? styles.bulletSlashFly : ''}`}

      style={inlineStyle}

    />

  )

}



function DamageFloater({

  popup,

  onEnd,

}: {

  popup: DamagePopup

  onEnd: (id: number) => void

}) {

  useEffect(() => {

    const timer = setTimeout(() => onEnd(popup.id), 800)

    return () => clearTimeout(timer)

  }, [popup.id, onEnd])



  return (

    <span

      className={`${styles.damage} ${popup.isTap ? styles.damageTap : styles.damageAuto}`}

      style={{ left: popup.x, top: popup.y }}

    >

      -{popup.amount}

    </span>

  )

}


