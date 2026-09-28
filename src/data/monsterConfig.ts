import { parseCsv } from './csv'

export interface MonsterConfig {
  id: number
  hp: number
  hasTimeLimit: boolean
  timeLimit: number | null
  goldReward: number
}

function required(row: Record<string, string>, key: string): string {
  if (!row[key]) throw new Error(`monsters.csv 缺少字段 ${key}`)
  return row[key]
}

function integer(value: string, key: string): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed)) throw new Error(`${key} 不是整数: ${value}`)
  return parsed
}

export function parseMonsterConfig(text: string): MonsterConfig[] {
  const monsters = parseCsv(text).map((row) => {
    const id = integer(required(row, 'monster_id'), 'monster_id')
    const hp = integer(required(row, 'hp'), `怪物 ${id} hp`)
    const hasTimeLimit = integer(required(row, 'has_time_limit'), `怪物 ${id} has_time_limit`) === 1
    const timeLimit = row.time_limit ? integer(row.time_limit, `怪物 ${id} time_limit`) : null
    const goldReward = integer(required(row, 'gold_reward'), `怪物 ${id} gold_reward`)
    if (hp <= 0) throw new Error(`怪物 ${id} hp 必须大于 0`)
    if (goldReward < 0) throw new Error(`怪物 ${id} gold_reward 不能小于 0`)
    if (id % 10 === 0 && !hasTimeLimit) throw new Error(`Boss ${id} 必须配置时间限制`)
    if (hasTimeLimit && (!timeLimit || timeLimit <= 0)) throw new Error(`怪物 ${id} 缺少有效 time_limit`)
    return { id, hp, hasTimeLimit, timeLimit, goldReward }
  })

  const ids = new Set<number>()
  monsters.forEach((monster, index) => {
    if (ids.has(monster.id)) throw new Error(`重复 monster_id: ${monster.id}`)
    if (monster.id !== index + 1) throw new Error(`monster_id 必须连续，期望 ${index + 1}，实际 ${monster.id}`)
    ids.add(monster.id)
  })
  return monsters
}

export async function loadMonsterConfig(): Promise<MonsterConfig[]> {
  const response = await fetch(`${import.meta.env.BASE_URL}config/monsters.csv`)
  if (!response.ok) throw new Error(`无法加载 monsters.csv (${response.status})`)
  return parseMonsterConfig(await response.text())
}
