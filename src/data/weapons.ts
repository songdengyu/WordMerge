export type WeaponQuality = 'common' | 'rare' | 'epic' | 'legendary'
export type BulletStyle = 'slash' | 'bolt' | 'arrow' | 'orb' | 'axe'

export interface Weapon {
  id: string
  name: string
  quality: WeaponQuality
  attack: number
  attackSpeed: number
  bulletStyle: BulletStyle
  level: number
  unlockCost: number
  isNew?: boolean
}

export const QUALITY_COLORS: Record<WeaponQuality, string> = {
  common: '#c8bfb0',
  rare: '#4cc9f0',
  epic: '#c77dff',
  legendary: '#f0c14b',
}

export const QUALITY_LABELS: Record<WeaponQuality, string> = {
  common: '普通',
  rare: '稀有',
  epic: '史诗',
  legendary: '传说',
}

export const INITIAL_EQUIPPED_WEAPON_ID = 'iron_sword'

export const WEAPON_CATALOG: Weapon[] = [
  { id: 'iron_sword', name: '铁剑', quality: 'common', attack: 10, attackSpeed: 1, bulletStyle: 'bolt', level: 1, unlockCost: 0 },
  { id: 'wood_sword', name: '木剑', quality: 'common', attack: 7, attackSpeed: 1.1, bulletStyle: 'slash', level: 0, unlockCost: 30 },
  { id: 'battle_axe', name: '战斧', quality: 'rare', attack: 25, attackSpeed: 0.8, bulletStyle: 'axe', level: 0, unlockCost: 90 },
  { id: 'elf_bow', name: '精灵弓', quality: 'rare', attack: 18, attackSpeed: 1.4, bulletStyle: 'arrow', level: 0, unlockCost: 140 },
  { id: 'magic_staff', name: '魔杖', quality: 'epic', attack: 35, attackSpeed: 1, bulletStyle: 'orb', level: 0, unlockCost: 240 },
  { id: 'flame_blade', name: '烈焰之刃', quality: 'legendary', attack: 50, attackSpeed: 1.2, bulletStyle: 'slash', level: 0, unlockCost: 480 },
]

export const INITIAL_WEAPON_INVENTORY: Weapon[] = []

export const EQUIPPED_WEAPON_DEFAULT: Weapon = {
  id: 'iron_sword',
  name: '铁剑',
  quality: 'common',
  attack: 10,
  attackSpeed: 1.0,
  bulletStyle: 'bolt',
  level: 1,
  unlockCost: 0,
}

export function getWeaponPower(weapon: Weapon): number {
  return getWeaponAttack(weapon) * weapon.attackSpeed
}

export function getWeaponAttack(weapon: Weapon): number {
  return Math.round(weapon.attack * (1 + Math.max(0, weapon.level - 1) * 0.22))
}

export function getWeaponUpgradeCost(weapon: Weapon): number {
  return weapon.level === 0 ? weapon.unlockCost : Math.ceil(weapon.unlockCost * 0.4 + weapon.level * weapon.level * 22)
}

export const BASE_FIRE_INTERVAL = 700

export function getMainFireInterval(attackSpeed: number): number {
  return BASE_FIRE_INTERVAL / attackSpeed
}
