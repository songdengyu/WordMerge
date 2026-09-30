import { dayTime, type SurvivalState } from './survival'
import { SURVIVAL_RULES, WEATHER, type WeatherId } from './survivalConfig'
import type { WorldMap } from './world'

export const TIME_PRESETS = [
  { id: 'dawn', label: '黎明', hour: 6 }, { id: 'morning', label: '上午', hour: 9 },
  { id: 'noon', label: '正午', hour: 12 }, { id: 'dusk', label: '黄昏', hour: 18 },
  { id: 'night', label: '夜晚', hour: 21 }, { id: 'midnight', label: '深夜', hour: 0 },
] as const
export type TimePreset = typeof TIME_PRESETS[number]['id']
export type EnvironmentCommand = { type: 'test-time'; preset: TimePreset } | { type: 'test-weather'; weather: WeatherId }

export function dayCycle(minutes: number) {
  const minute = ((minutes % 1440) + 1440) % 1440, hour = minute / 60, isDay = dayTime(minute)
  const phase: TimePreset = hour >= 6 && hour < 8 ? 'dawn' : hour >= 8 && hour < 11 ? 'morning'
    : hour >= 11 && hour < 16 ? 'noon' : hour >= 16 && hour < 19 ? 'dusk' : hour >= 19 && hour < 23 ? 'night' : 'midnight'
  return { phase, label: TIME_PRESETS.find(p => p.id === phase)!.label, isDay,
    progress: isDay ? (minute - 360) / 780 : ((minute - 1140 + 1440) % 1440) / 660 }
}

// Smooth, periodic art values; these do not change temperature or the saved content catalog.
const LIGHT_KEYS = [
  { hour: 0, dark: .58, warmth: 0, color: 0xffd99a },
  { hour: 5, dark: .56, warmth: .02, color: 0xffd99a },
  { hour: 6, dark: .24, warmth: .22, color: 0xffd38a },
  { hour: 7.5, dark: .03, warmth: .10, color: 0xffe1a0 },
  { hour: 12, dark: 0, warmth: .025, color: 0xffedbc },
  { hour: 16, dark: .02, warmth: .09, color: 0xffd69a },
  { hour: 18, dark: .14, warmth: .32, color: 0xf79a57 },
  { hour: 19, dark: .36, warmth: .16, color: 0xec9064 },
  { hour: 20.5, dark: .54, warmth: 0, color: 0xffd99a },
  { hour: 24, dark: .58, warmth: 0, color: 0xffd99a },
]
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
function mixColor(a: number, b: number, t: number) {
  return [16, 8, 0].reduce((color, shift) => color | Math.round(lerp((a >> shift) & 255, (b >> shift) & 255, t)) << shift, 0)
}
export function environmentLight(minutes: number, weather: WeatherId) {
  const hour = ((minutes % 1440) + 1440) % 1440 / 60
  const index = LIGHT_KEYS.findIndex(key => key.hour > hour), a = LIGHT_KEYS[index - 1], b = LIGHT_KEYS[index]
  const fraction = (hour - a.hour) / (b.hour - a.hour), t = fraction * fraction * (3 - 2 * fraction)
  return { ...dayCycle(minutes), darkness: lerp(a.dark, b.dark, t),
    warmth: lerp(a.warmth, b.warmth, t) * (weather === 'sunny' ? 1 : weather === 'cloudy' ? .5 : .22),
    color: mixColor(a.color, b.color, t), overcast: weather === 'sunny' ? 0 : weather === 'cloudy' ? .16 : .28 }
}

/** Test controls jump the calendar, not the simulation; no skipped damage, work or rewards. */
export function testEnvironment(original: SurvivalState, world: WorldMap, minutes: number, command: EnvironmentCommand) {
  if (command.type === 'test-weather') {
    if (!Object.prototype.hasOwnProperty.call(WEATHER, command.weather)) return { accepted: false as const, reason: '未知的测试天气' }
    return { accepted: true as const, state: { ...original, weather: command.weather, weatherDay: Math.floor((minutes - 360) / 1440) }, minutes,
      message: `天气已切换为${WEATHER[command.weather].name}` }
  }
  const preset = TIME_PRESETS.find(p => p.id === command.preset)
  if (!preset) return { accepted: false as const, reason: '未知的测试时段' }
  // Stay on the same day; an earlier preset means its next occurrence. Never rewind saves.
  let target = Math.floor(minutes / 1440) * 1440 + preset.hour * 60
  if (target < minutes) target += 1440
  target = Math.max(target, world.config.initialHour * 60)
  const state = structuredClone(original)
  state.weatherDay = Math.floor((target - 360) / 1440)
  state.raidNight = dayTime(target) ? 0 : Math.floor((target - 1140) / 1440) + 1
  state.spawnRemaining = SURVIVAL_RULES.firstSpawnDelay
  state.decisionRemaining = 0
  if (dayTime(target)) {
    state.enemies = state.enemies.filter(enemy => enemy.residentId)
    if (!state.enemies.some(enemy => enemy.id === state.companion.orderedEnemy)) state.companion.orderedEnemy = null
    if (state.companion.target?.kind === 'enemy' && !state.enemies.some(enemy => enemy.id === (state.companion.target as { id: string }).id)) {
      state.companion.target = null
      state.companion.route = state.companion.progress > 0 ? state.companion.route.slice(0, 1) : []
    }
  }
  return { accepted: true as const, state, minutes: target, message: `已切换到${preset.label}` }
}
