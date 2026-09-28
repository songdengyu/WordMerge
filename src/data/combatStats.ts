import type { EquipmentConfig } from './equipmentConfig'
import { getSkillValue, type SkillConfig } from './skillConfig'

export interface CombatStats {
  attack: number
  attackBonus: number
  critRate: number
  critDamage: number
  damageBonus: number
  normalAttackDamage: number
  skillDamage: number
}

export const EMPTY_COMBAT_STATS: CombatStats = {
  attack: 0,
  attackBonus: 0,
  critRate: 0,
  critDamage: 0,
  damageBonus: 0,
  normalAttackDamage: 0,
  skillDamage: 0,
}

export function sumEquipmentStats(items: EquipmentConfig[]): CombatStats {
  return items.reduce<CombatStats>((stats, item) => ({
    attack: stats.attack + (item.attack ?? 0),
    attackBonus: stats.attackBonus + (item.attackBonus ?? 0),
    critRate: stats.critRate + (item.critRate ?? 0),
    critDamage: stats.critDamage + (item.critDamage ?? 0),
    damageBonus: stats.damageBonus + (item.damageBonus ?? 0),
    normalAttackDamage: stats.normalAttackDamage + (item.normalAttackDamage ?? 0),
    skillDamage: stats.skillDamage + (item.skillDamage ?? 0),
  }), EMPTY_COMBAT_STATS)
}

export function applyPassiveSkills(
  base: CombatStats,
  skills: { skill: SkillConfig; level: number }[],
): CombatStats {
  return skills.reduce<CombatStats>((stats, entry) => {
    if (entry.skill.type !== 3 || entry.level <= 0) return stats
    const value = getSkillValue(entry.skill, entry.level)
    switch (entry.skill.effectStat) {
      case 'attack': return { ...stats, attack: stats.attack + value }
      case 'attack_bonus': return { ...stats, attackBonus: stats.attackBonus + value }
      case 'crit_rate': return { ...stats, critRate: stats.critRate + value }
      case 'crit_damage': return { ...stats, critDamage: stats.critDamage + value }
      case 'damage_bonus': return { ...stats, damageBonus: stats.damageBonus + value }
      case 'normal_attack_damage': return { ...stats, normalAttackDamage: stats.normalAttackDamage + value }
      case 'skill_damage': return { ...stats, skillDamage: stats.skillDamage + value }
      default: return stats
    }
  }, { ...base })
}

export function calculateBaseDamage(stats: CombatStats, skillMultiplier: number): number {
  return stats.attack
    * (1 + stats.attackBonus)
    * (1 + stats.damageBonus)
    * skillMultiplier
}

export function calculateDamage(
  stats: CombatStats,
  skillMultiplier: number,
  isSkill: boolean,
  critical: boolean,
): number {
  const typeBonus = isSkill ? stats.skillDamage : stats.normalAttackDamage
  const damage = calculateBaseDamage(stats, skillMultiplier) * (1 + typeBonus)
  return damage * (critical ? 2 + stats.critDamage : 1)
}

export function calculateExpectedDamage(
  stats: CombatStats,
  skillMultiplier = 1,
  isSkill = false,
): number {
  const damage = calculateDamage(stats, skillMultiplier, isSkill, false)
  const critRate = Math.max(0, Math.min(1, stats.critRate))
  return damage * (1 + critRate * (1 + stats.critDamage))
}

export function rollDamage(stats: CombatStats, skillMultiplier: number, isSkill: boolean) {
  const critical = Math.random() < Math.max(0, Math.min(1, stats.critRate))
  return {
    damage: calculateDamage(stats, skillMultiplier, isSkill, critical),
    critical,
  }
}
