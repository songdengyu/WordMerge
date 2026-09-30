import { fingerprint } from './productionConfig'

// M4 playtest values, versioned with the build like the building catalog.
export const SURVIVAL_RULES = {
  hungerPerDay: 60, waterPerDay: 80, temperatureRate: .12,
  environmentInterval: 5, environmentDamage: 1,
  spawnInterval: 80, firstSpawnDelay: 15, enemyLimit: 3, decisionInterval: .5,
  lossLimit: 2, lossMaxLevel: 1, rescueHp: 70,
  companion: { name: '栗栗', hp: 180, attack: 14, interval: 2, speed: 2, radius: 5,
    rescueItems: [211], medicineItems: [232], recoverySeconds: 60, restHpPerSecond: 1 },
  entries: [{ x: 7, y: 0 }, { x: 15, y: 7 }, { x: 7, y: 15 }, { x: 0, y: 7 }],
} as const
export const WEATHER = {
  sunny: { name: '晴', icon: '☀', dayTemperature: 50, nightTemperature: 32 },
  cloudy: { name: '多云', icon: '☁', dayTemperature: 44, nightTemperature: 28 },
  rain: { name: '雨', icon: '☂', dayTemperature: 28, nightTemperature: 12 },
} as const
export type WeatherId = keyof typeof WEATHER
export const ENEMIES = {
  prowler: { name: '灰狼', hp: 32, attack: 2, interval: 2, speed: 1.2, sight: 6, gold: 2 },
  boar: { name: '野猪', hp: 70, attack: 4, interval: 2.5, speed: .9, sight: 5, gold: 4 },
} as const
export type EnemyKind = keyof typeof ENEMIES
export const SURVIVAL_VERSION = fingerprint(JSON.stringify([SURVIVAL_RULES, WEATHER, ENEMIES]))
