export type HeroRole =
  | 'champion'
  | 'sword'
  | 'archer'
  | 'mage'
  | 'knight'
  | 'rogue'
  | 'priest'

export type HeroBulletShape =
  | 'round'
  | 'slash'
  | 'arrow'
  | 'diamond'
  | 'shard'
  | 'ring'
  | 'comet'
  | 'cross'
  | 'bolt'

export interface HeroBulletProfile {
  color: string
  width: number
  height: number
  shape: HeroBulletShape
}

export interface Hero {
  id: string
  name: string
  level: number
  baseDps: number
  attackInterval: number
  role: HeroRole
  bullet: HeroBulletProfile
  unlockCost: number
}

export const HEROES_PER_PLATFORM = 3
export const MAX_PLATFORM_ROW_PAIRS = 3
export const MAX_DEPLOYED = HEROES_PER_PLATFORM * 2 * MAX_PLATFORM_ROW_PAIRS
export const HERO_ATTACK_INTERVAL_SCALE = 1.6

export const INITIAL_HEROES: Hero[] = [
  { id: 'sword', name: '剑士', level: 1, baseDps: 100, attackInterval: 400, role: 'sword', unlockCost: 0, bullet: { color: '#6eb5ff', width: 10, height: 10, shape: 'bolt' } },
  { id: 'archer', name: '游侠', level: 0, baseDps: 80, attackInterval: 320, role: 'archer', unlockCost: 45, bullet: { color: '#7dce82', width: 18, height: 4, shape: 'arrow' } },
  { id: 'mage', name: '巫师', level: 0, baseDps: 120, attackInterval: 520, role: 'mage', unlockCost: 75, bullet: { color: '#c77dff', width: 14, height: 14, shape: 'ring' } },
  { id: 'knight', name: '圣骑士', level: 0, baseDps: 150, attackInterval: 580, role: 'knight', unlockCost: 110, bullet: { color: '#e8e8f0', width: 12, height: 16, shape: 'diamond' } },
  { id: 'ninja', name: '刺客', level: 0, baseDps: 130, attackInterval: 280, role: 'rogue', unlockCost: 150, bullet: { color: '#9d8ec7', width: 6, height: 18, shape: 'shard' } },
  { id: 'priest', name: '牧师', level: 0, baseDps: 90, attackInterval: 480, role: 'priest', unlockCost: 190, bullet: { color: '#ffe08a', width: 11, height: 11, shape: 'cross' } },
  { id: 'berserker', name: '狂战士', level: 0, baseDps: 140, attackInterval: 360, role: 'sword', unlockCost: 240, bullet: { color: '#ff6b6b', width: 16, height: 8, shape: 'slash' } },
  { id: 'hunter', name: '猎手', level: 0, baseDps: 95, attackInterval: 300, role: 'archer', unlockCost: 300, bullet: { color: '#56cfe1', width: 20, height: 3, shape: 'arrow' } },
  { id: 'warlock', name: '术士', level: 0, baseDps: 125, attackInterval: 540, role: 'mage', unlockCost: 370, bullet: { color: '#ff922b', width: 16, height: 16, shape: 'comet' } },
  { id: 'paladin', name: '守护者', level: 0, baseDps: 110, attackInterval: 500, role: 'knight', unlockCost: 450, bullet: { color: '#a5d8ff', width: 8, height: 8, shape: 'round' } },
  { id: 'assassin', name: '影刃', level: 0, baseDps: 135, attackInterval: 290, role: 'rogue', unlockCost: 540, bullet: { color: '#495057', width: 5, height: 14, shape: 'shard' } },
  { id: 'cleric', name: '神官', level: 0, baseDps: 85, attackInterval: 460, role: 'priest', unlockCost: 640, bullet: { color: '#fff3bf', width: 9, height: 9, shape: 'ring' } },
  { id: 'gladiator', name: '角斗士', level: 0, baseDps: 145, attackInterval: 380, role: 'sword', unlockCost: 760, bullet: { color: '#e03131', width: 14, height: 6, shape: 'slash' } },
  { id: 'ranger', name: '巡林客', level: 0, baseDps: 88, attackInterval: 310, role: 'archer', unlockCost: 900, bullet: { color: '#2f9e44', width: 15, height: 5, shape: 'bolt' } },
  { id: 'elemental', name: '元素师', level: 0, baseDps: 128, attackInterval: 560, role: 'mage', unlockCost: 1060, bullet: { color: '#4dabf7', width: 13, height: 13, shape: 'diamond' } },
  { id: 'crusader', name: '十字军', level: 0, baseDps: 118, attackInterval: 510, role: 'knight', unlockCost: 1240, bullet: { color: '#fcc419', width: 12, height: 12, shape: 'cross' } },
  { id: 'shadow', name: '暗影', level: 0, baseDps: 132, attackInterval: 270, role: 'rogue', unlockCost: 1450, bullet: { color: '#7048e8', width: 10, height: 18, shape: 'comet' } },
  { id: 'oracle', name: '先知', level: 0, baseDps: 92, attackInterval: 440, role: 'priest', unlockCost: 1700, bullet: { color: '#63e6be', width: 7, height: 7, shape: 'round' } },
]

const heroBulletMap = new Map(INITIAL_HEROES.map((h) => [h.id, h.bullet]))
const heroAttackIntervalMap = new Map(INITIAL_HEROES.map((h) => [h.id, h.attackInterval]))

export function getHeroDps(hero: Hero): number {
  return hero.baseDps * hero.level
}

export function getHeroAttackInterval(heroId: string): number {
  return (heroAttackIntervalMap.get(heroId) ?? 420) * HERO_ATTACK_INTERVAL_SCALE
}

export function getHeroUpgradeCost(hero: Hero): number {
  return hero.level === 0 ? hero.unlockCost : Math.ceil(hero.unlockCost * 0.45 + hero.level * hero.level * 18)
}

export function getHeroSkillBookCost(level: number): number {
  return Math.max(10, level * 10)
}

export function getHeroBulletProfile(heroId: string): HeroBulletProfile {
  return heroBulletMap.get(heroId) ?? { color: '#ffffff', width: 10, height: 10, shape: 'round' }
}
