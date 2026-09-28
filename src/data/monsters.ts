import type { MonsterConfig } from './monsterConfig'

const MONSTER_NAMES = [
  '史莱姆',
  '哥布林',
  '蝙蝠',
  '骷髅兵',
  '野狼',
  '蜘蛛',
  '食人花',
  '石怪',
  '幽灵',
  '小恶魔',
]

const BOSS_NAMES = [
  '巨型章鱼',
  '暗影领主',
  '熔岩巨兽',
  '冰霜龙王',
  '深渊魔王',
]

export interface Monster {
  id: number
  name: string
  maxHp: number
  currentHp: number
  goldReward: number
  hasTimeLimit: boolean
  timeLimit: number | null
}

export function getMonsterId(stage: number, killCount: number, isBoss: boolean): number {
  return (stage - 1) * 10 + (isBoss ? 10 : killCount + 1)
}

export function getMonsterName(stage: number, killCount: number, isBoss: boolean): string {
  if (isBoss) {
    return BOSS_NAMES[(stage - 1) % BOSS_NAMES.length]
  }
  return MONSTER_NAMES[killCount % MONSTER_NAMES.length]
}

export function calcNormalMonsterHp(stage: number, killCount: number): number {
  return Math.floor(100 * stage * (1 + killCount * 0.2))
}

export function calcBossHp(stage: number): number {
  return calcNormalMonsterHp(stage, 9) * 10
}

export function createMonster(
  stage: number,
  killCount: number,
  isBoss: boolean,
  catalog: MonsterConfig[] = [],
): Monster {
  const id = getMonsterId(stage, killCount, isBoss)
  const config = catalog.find((item) => item.id === id)
  const resolvedBoss = id % 10 === 0
  const maxHp = config?.hp ?? (resolvedBoss ? calcBossHp(stage) : calcNormalMonsterHp(stage, killCount))
  return {
    id,
    name: getMonsterName(stage, killCount, resolvedBoss),
    maxHp,
    currentHp: maxHp,
    goldReward: config?.goldReward ?? calcGoldReward(stage, resolvedBoss),
    hasTimeLimit: config?.hasTimeLimit ?? resolvedBoss,
    timeLimit: config?.timeLimit ?? (resolvedBoss ? 30 : null),
  }
}

export function calcGoldReward(stage: number, isBoss: boolean): number {
  return isBoss ? 50 * stage : 5 + stage
}
