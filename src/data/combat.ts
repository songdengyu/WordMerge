export const MONSTER_DEATH_ANIM_MS = 650
export const MONSTER_SPAWN_ANIM_MS = 400
/** 出场动画结束后，等待首波攻击再开始结算伤害 */
export const COMBAT_RESUME_GRACE_SEC = 0.2

/** 主角挥砍预设角度（度） */
export const MAIN_SLASH_ANGLES = [-58, 42, -10] as const

export function pickMainSlashAngle(): number {
  return MAIN_SLASH_ANGLES[Math.floor(Math.random() * MAIN_SLASH_ANGLES.length)]
}
