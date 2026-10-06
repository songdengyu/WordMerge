import type { Actor, Enemy } from './survival'
import { ENEMIES, SURVIVAL_RULES } from './survivalConfig'

export const COMBAT_SECONDS = 2
export const COMBAT_RESULT_SECONDS = 1
interface Fighter { hp: number; attack: number; interval: number; cooldown: number }
export interface CombatResult {
  companionHp: number; enemyHp: number
  companionCooldown: number; enemyCooldown: number; simulatedSeconds: number
}
export interface CompanionCombat {
  phase: 'fighting' | 'result'; remaining: number
  companion: Actor & { hp: number }; enemy: Enemy
  result: CombatResult
}

/** Virtual attack clock. Same-time strikes land together, including a mutual knockout. */
export function simulateCombat(companion: Fighter, enemy: Fighter): CombatResult {
  if ([companion, enemy].some(unit => !Number.isFinite(unit.hp) || unit.hp <= 0
    || !Number.isFinite(unit.attack) || unit.attack <= 0 || !Number.isFinite(unit.interval) || unit.interval <= 0
    || !Number.isFinite(unit.cooldown) || unit.cooldown < 0)) throw new Error('无效的战斗数值')
  let companionHp = companion.hp, enemyHp = enemy.hp
  let companionNext = companion.cooldown, enemyNext = enemy.cooldown, time = 0
  while (companionHp > 0 && enemyHp > 0) {
    time = Math.min(companionNext, enemyNext)
    const companionHits = companionNext <= time + 1e-8, enemyHits = enemyNext <= time + 1e-8
    if (companionHits) { enemyHp = Math.max(0, enemyHp - companion.attack); companionNext += companion.interval }
    if (enemyHits) { companionHp = Math.max(0, companionHp - enemy.attack); enemyNext += enemy.interval }
  }
  return { companionHp, enemyHp, companionCooldown: Math.max(0, companionNext - time),
    enemyCooldown: Math.max(0, enemyNext - time), simulatedSeconds: time }
}

export function combatResult(companion: { hp: number; cooldown: number }, enemy: Enemy) {
  return simulateCombat({ ...SURVIVAL_RULES.companion, hp: companion.hp, cooldown: companion.cooldown },
    { ...ENEMIES[enemy.kind], hp: enemy.hp, cooldown: enemy.cooldown })
}
