import type { HeroRole } from './heroes'

export interface MainHero {
  name: string
  level: number
  baseDps: number
  role: HeroRole
}

export const INITIAL_MAIN_HERO: MainHero = {
  name: '勇者',
  level: 1,
  baseDps: 0,
  role: 'champion',
}

export function getMainHeroBaseDps(hero: MainHero): number {
  return hero.baseDps * hero.level
}

