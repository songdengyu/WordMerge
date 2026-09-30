import type { CSSProperties } from 'react'
import type { UiSnapshot } from '../../game/GameRuntime'
import { dayCycle } from '../../game/environment'
import { WEATHER } from '../../game/survivalConfig'
import { WeatherIcon } from './StatusIcons'
import styles from './DayCycle.module.css'

function CelestialIcon({ sun }: { sun: boolean }) {
  return sun ? <g><circle r="7" fill="currentColor" />
    {[0, 45, 90, 135, 180, 225, 270, 315].map(angle => <path key={angle} d="M0-10v-3" transform={`rotate(${angle})`} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />)}</g>
    : <g><path d="M3-10A11 11 0 1 0 10 6 9 9 0 0 1 3-10Z" fill="currentColor" /><path d="m10-10 1 3 3 1-3 1-1 3-1-3-3-1 3-1Z" fill="currentColor" /></g>
}
export function DayCycle({ state, compact = false }: { state: UiSnapshot; compact?: boolean }) {
  const cycle = dayCycle(state.hour * 60 + state.minute)
  const angle = Math.PI * (1 - cycle.progress)
  const marker = { x: 36 + 28 * Math.cos(angle), y: 36 - 28 * Math.sin(angle) }
  return <div className={`${styles.cycle} ${compact ? styles.compact : ''}`} data-testid={compact ? 'merge-clock' : 'game-clock'}
    data-phase={cycle.phase} data-celestial={cycle.isDay ? 'sun' : 'moon'} data-minute={state.hour * 60 + state.minute}
    aria-label={`第 ${state.day} 天，${cycle.label}`} style={{ '--celestial': cycle.isDay ? cycle.phase === 'dusk' ? '#d98951' : '#c79748' : '#d8e9ed' } as CSSProperties}>
    <div className={styles.celestial}><svg viewBox="0 0 72 48" aria-hidden="true">
      <path className={styles.track} d="M8 36a28 28 0 0 1 56 0" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2 4" />
      <path d="M7 39h58" stroke="currentColor" strokeOpacity=".25" />
      <g transform="translate(36 26)"><CelestialIcon sun={cycle.isDay} /></g>
      <circle cx={marker.x} cy={marker.y} r="3" fill="currentColor" />
    </svg><span className={styles.weather} role="img" aria-label={`天气：${WEATHER[state.survival.weather].name}`} title={WEATHER[state.survival.weather].name} data-weather={state.survival.weather}>
      <WeatherIcon weather={state.survival.weather} />
    </span></div>
    <span>第 {state.day} 天 · {cycle.label}</span>
  </div>
}

