import { parseCsv } from './csv'

export const MAIN_HERO_SKILL_OWNER_ID = 100000001

export type SkillType = 1 | 2 | 3
export type SkillEffectStat =
  | 'none'
  | 'attack'
  | 'attack_bonus'
  | 'crit_rate'
  | 'crit_damage'
  | 'damage_bonus'
  | 'normal_attack_damage'
  | 'skill_damage'
export type SkillEffectShape = 'slash' | 'fireball' | 'lightning' | 'frost' | 'meteor' | 'void'

export interface SkillConfig {
  id: number
  ownerId: number
  name: string
  type: SkillType
  description: string
  coefficient: number
  cooldownSeconds: number
  unlockLevel: number
  upgradeCost: number
  perLevelIncrease: number
  effectStat: SkillEffectStat
  shape: SkillEffectShape
  color: string
  accent: string
}

const EFFECT_STATS = new Set<SkillEffectStat>([
  'none',
  'attack',
  'attack_bonus',
  'crit_rate',
  'crit_damage',
  'damage_bonus',
  'normal_attack_damage',
  'skill_damage',
])
const SHAPES = new Set<SkillEffectShape>(['slash', 'fireball', 'lightning', 'frost', 'meteor', 'void'])
const DEFAULT_COLORS: Record<SkillEffectShape, [string, string]> = {
  slash: ['#ffe08a', '#ffffff'],
  fireball: ['#ff5a36', '#ffd166'],
  lightning: ['#54d8ff', '#ffffff'],
  frost: ['#8de7ff', '#dffbff'],
  meteor: ['#ff713d', '#fff09a'],
  void: ['#c05cff', '#ff8ee7'],
}

function required(row: Record<string, string>, key: string): string {
  if (!row[key]) throw new Error(`skills.csv 缺少字段 ${key}`)
  return row[key]
}

function integer(value: string, label: string): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed)) throw new Error(`${label} 不是整数: ${value}`)
  return parsed
}

function number(value: string, label: string): number {
  const trimmed = value.trim()
  const parsed = trimmed.endsWith('%') ? Number(trimmed.slice(0, -1)) / 100 : Number(trimmed)
  if (!Number.isFinite(parsed)) throw new Error(`${label} 不是有效数值: ${value}`)
  return parsed
}

export function parseSkillConfig(text: string): SkillConfig[] {
  const skills = parseCsv(text).map((row) => {
    const id = integer(required(row, 'skill_id'), 'skill_id')
    const type = integer(required(row, 'skill_type'), `技能 ${id} skill_type`) as SkillType
    if (![1, 2, 3].includes(type)) throw new Error(`技能 ${id} 类型无效: ${type}`)
    const effectStat = (row.effect_stat || 'none') as SkillEffectStat
    if (!EFFECT_STATS.has(effectStat)) throw new Error(`技能 ${id} effect_stat 无效: ${effectStat}`)
    const shape = (row.shape || 'slash') as SkillEffectShape
    if (!SHAPES.has(shape)) throw new Error(`技能 ${id} shape 无效: ${shape}`)
    const colors = DEFAULT_COLORS[shape]
    const skill: SkillConfig = {
      id,
      ownerId: integer(required(row, 'owner_id'), `技能 ${id} owner_id`),
      name: required(row, 'name'),
      type,
      description: required(row, 'description'),
      coefficient: number(required(row, 'coefficient'), `技能 ${id} coefficient`),
      cooldownSeconds: number(required(row, 'cooldown_seconds'), `技能 ${id} cooldown_seconds`),
      unlockLevel: integer(required(row, 'unlock_level'), `技能 ${id} unlock_level`),
      upgradeCost: integer(required(row, 'upgrade_cost'), `技能 ${id} upgrade_cost`),
      perLevelIncrease: number(required(row, 'per_level_increase'), `技能 ${id} per_level_increase`),
      effectStat,
      shape,
      color: row.color || colors[0],
      accent: row.accent || colors[1],
    }
    if (skill.cooldownSeconds < 0 || skill.unlockLevel < 1 || skill.upgradeCost < 0) {
      throw new Error(`技能 ${id} 的 CD、解锁等级或升级消耗无效`)
    }
    if (type === 3 && effectStat === 'none') throw new Error(`被动技能 ${id} 缺少 effect_stat`)
    return skill
  })
  const ids = new Set<number>()
  skills.forEach((skill) => {
    if (ids.has(skill.id)) throw new Error(`重复 skill_id: ${skill.id}`)
    ids.add(skill.id)
  })
  return skills
}

export async function loadSkillConfig(): Promise<SkillConfig[]> {
  const response = await fetch(`${import.meta.env.BASE_URL}config/skills.csv`)
  if (!response.ok) throw new Error(`无法加载 skills.csv (${response.status})`)
  return parseSkillConfig(await response.text())
}

export function isMainHeroBasicSkill(skill: SkillConfig): boolean {
  return skill.ownerId === MAIN_HERO_SKILL_OWNER_ID && skill.type === 1
}

/** 普攻默认可用，技能书只负责升级，不再挡住点击出手。 */
export function getMainSkillLevel(skill: SkillConfig, levels: Record<number, number>): number {
  const level = levels[skill.id] ?? 0
  return isMainHeroBasicSkill(skill) ? Math.max(1, level) : level
}

export function unlockBasicSkills(
  skills: SkillConfig[],
  levels: Record<number, number>,
  heroLevel: number,
): Record<number, number> {
  const next = { ...levels }
  for (const skill of skills) {
    if (isMainHeroBasicSkill(skill) && skill.unlockLevel <= heroLevel && (next[skill.id] ?? 0) <= 0) {
      next[skill.id] = 1
    }
  }
  return next
}

export function getSkillValue(skill: SkillConfig, level: number): number {
  return skill.coefficient + Math.max(0, level - 1) * skill.perLevelIncrease
}

export function formatSkillValue(skill: SkillConfig, level: number): string {
  const value = getSkillValue(skill, level)
  if (skill.effectStat === 'attack' && skill.type === 3) return String(Math.round(value))
  return `${Math.round(value * 1000) / 10}%`
}

export function formatSkillDescription(skill: SkillConfig, level: number): string {
  return skill.description.replace(/\[1\]/g, formatSkillValue(skill, level))
}
