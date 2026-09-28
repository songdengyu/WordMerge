import { useCallback, useState } from 'react'
import { pickMainSlashAngle } from '../data/combat'
import { getHeroBulletProfile, type HeroBulletShape } from '../data/heroes'
import type { BulletStyle } from '../data/weapons'
import type { SkillEffectShape } from '../data/skillConfig'

export interface Bullet {
  id: number
  fromX: number
  fromY: number
  toX: number
  toY: number
  color: string
  style: BulletStyle | 'hero' | 'mainSlash'
  heroShape?: HeroBulletShape
  heroWidth?: number
  heroHeight?: number
  slashAngle?: number
}

export interface DamagePopup {
  id: number
  x: number
  y: number
  amount: number
  isTap: boolean
}

export interface SkillEffect {
  id: number
  x: number
  y: number
  name: string
  color: string
  accent: string
  shape: SkillEffectShape
}

let effectId = 0

function getCenter(el: HTMLElement, arena: HTMLElement) {
  const ar = arena.getBoundingClientRect()
  const er = el.getBoundingClientRect()
  return {
    x: er.left + er.width / 2 - ar.left,
    y: er.top + er.height / 2 - ar.top,
  }
}

export function useCombatEffects() {
  const [bullets, setBullets] = useState<Bullet[]>([])
  const [popups, setPopups] = useState<DamagePopup[]>([])
  const [skillEffects, setSkillEffects] = useState<SkillEffect[]>([])

  const removeBullet = useCallback((id: number) => {
    setBullets((prev) => prev.filter((b) => b.id !== id))
  }, [])

  const removePopup = useCallback((id: number) => {
    setPopups((prev) => prev.filter((p) => p.id !== id))
  }, [])

  const removeSkillEffect = useCallback((id: number) => {
    setSkillEffects((prev) => prev.filter((effect) => effect.id !== id))
  }, [])

  const fireBullet = useCallback(
    (
      arena: HTMLElement,
      sourceEl: HTMLElement,
      targetEl: HTMLElement,
      sourceId: string,
      _mainBulletStyle?: BulletStyle,
      mainQualityColor?: string,
    ) => {
      const from = getCenter(sourceEl, arena)
      const to = getCenter(targetEl, arena)

      let color = '#ffffff'
      let style: Bullet['style'] = 'hero'
      let heroShape: HeroBulletShape | undefined
      let heroWidth: number | undefined
      let heroHeight: number | undefined
      let slashAngle: number | undefined

      if (sourceId === 'main') {
        color = mainQualityColor ?? '#f0c14b'
        style = 'mainSlash'
        slashAngle = pickMainSlashAngle()
      } else {
        const profile = getHeroBulletProfile(sourceId)
        color = profile.color
        heroShape = profile.shape
        heroWidth = profile.width
        heroHeight = profile.height
      }

      const id = ++effectId
      setBullets((prev) => [
        ...prev,
        {
          id,
          fromX: from.x,
          fromY: from.y,
          toX: to.x,
          toY: to.y,
          color,
          style,
          heroShape,
          heroWidth,
          heroHeight,
          slashAngle,
        },
      ])
    },
    [],
  )

  const showDamage = useCallback((arena: HTMLElement, targetEl: HTMLElement, amount: number, isTap: boolean) => {
    const to = getCenter(targetEl, arena)
    const id = ++effectId
    const offsetX = (Math.random() - 0.5) * 40
    setPopups((prev) => [
      ...prev,
      {
        id,
        x: to.x + offsetX,
        y: to.y - 20,
        amount: Math.max(1, Math.floor(amount)),
        isTap,
      },
    ])
  }, [])

  const showSkillEffect = useCallback((
    arena: HTMLElement,
    targetEl: HTMLElement,
    skill: Pick<SkillEffect, 'name' | 'color' | 'accent' | 'shape'>,
  ) => {
    const to = getCenter(targetEl, arena)
    setSkillEffects((prev) => [...prev, { id: ++effectId, x: to.x, y: to.y, ...skill }])
  }, [])

  return {
    bullets,
    popups,
    skillEffects,
    fireBullet,
    showDamage,
    showSkillEffect,
    removeBullet,
    removePopup,
    removeSkillEffect,
  }
}
