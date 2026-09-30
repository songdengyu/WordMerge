import { useRef, useState } from 'react'
import type { GameRuntime, UiSnapshot } from '../../game/GameRuntime'
import { dayCycle, TIME_PRESETS, type EnvironmentCommand } from '../../game/environment'
import { WEATHER, type WeatherId } from '../../game/survivalConfig'
import { TEST_VITAL_NAMES, type TestVital, type TestVitalCommand } from '../../game/testControls'
import styles from './TestControls.module.css'

export function TestControls({ runtime, state, message, reset }: {
  runtime: GameRuntime; state: UiSnapshot; message: (text: string) => void; reset: () => void
}) {
  const [panel, setPanel] = useState<'main' | 'environment' | 'vitals' | null>(null)
  const [busy, setBusy] = useState(false), lock = useRef(false)
  const disabled = busy || state.pauseReasons.length > 0
  const send = async (command: EnvironmentCommand | TestVitalCommand) => {
    if (lock.current) return
    lock.current = true; setBusy(true)
    try { const result = await runtime.dispatch(command); message(result.accepted ? result.message ?? '已调整' : result.reason) }
    finally { lock.current = false; setBusy(false) }
  }
  const title = panel === 'environment' ? '时间与天气' : panel === 'vitals' ? '状态增减' : '测试'
  return <div className={styles.tests}>
    <button type="button" className={styles.toggle} onClick={() => setPanel(panel ? null : 'main')}
      aria-expanded={panel !== null} aria-controls="game-test-panel">测试</button>
    {panel && <section id="game-test-panel" className={styles.panel} aria-label={panel === 'main' ? '测试面板' : panel === 'environment' ? '时间与天气测试' : '状态增减测试'}
      onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setPanel(null) } }}>
      <header>
        {panel !== 'main' && <button type="button" onClick={() => setPanel('main')} aria-label="返回测试面板">‹</button>}
        <strong>{title}</strong>
        <button type="button" onClick={() => setPanel(null)} aria-label={panel === 'environment' ? '关闭天候测试' : '关闭测试面板'}>×</button>
      </header>
      {panel === 'main' ? <div className={styles.menu}>
        <button type="button" onClick={() => setPanel('environment')}>时间与天气 <span aria-hidden="true">›</span></button>
        <button type="button" onClick={() => setPanel('vitals')}>状态增减 <span aria-hidden="true">›</span></button>
        <button type="button" className={styles.danger} title="清除所有数据" onClick={reset}>删</button>
      </div> : panel === 'environment' ? <>
        <small>时段</small><div className={styles.presets}>{TIME_PRESETS.map(preset => <button type="button" key={preset.id} disabled={disabled}
          aria-pressed={dayCycle(state.hour * 60 + state.minute).phase === preset.id} onClick={() => void send({ type: 'test-time', preset: preset.id })}>{preset.label}</button>)}</div>
        <small>天气</small><div className={styles.presets}>{(Object.keys(WEATHER) as WeatherId[]).map(weather => <button type="button" key={weather} disabled={disabled}
          aria-pressed={state.survival.weather === weather} onClick={() => void send({ type: 'test-weather', weather })}>{WEATHER[weather].icon} {WEATHER[weather].name}</button>)}</div>
        <p>切换到下一次该时段并保存，不补算跳过的消耗。天气持续到下次自然黎明。</p>
      </> : <>
        <div className={styles.vitals}>{(Object.keys(TEST_VITAL_NAMES) as TestVital[]).map(stat => <div className={styles.vitalRow} key={stat}>
          <span>{TEST_VITAL_NAMES[stat]} <b>{Math.round(state.production!.vitals[stat])}</b></span>
          <button type="button" disabled={disabled || state.production!.vitals[stat] <= 0} aria-label={`${TEST_VITAL_NAMES[stat]}减10`}
            onClick={() => void send({ type: 'test-vital', stat, delta: -10 })}>−10</button>
          <button type="button" disabled={disabled || state.production!.vitals[stat] >= 100} aria-label={`${TEST_VITAL_NAMES[stat]}加10`}
            onClick={() => void send({ type: 'test-vital', stat, delta: 10 })}>+10</button>
        </div>)}</div>
        <p>每次调整 10 点，范围 0～100，自动保存。生命归零进入救援。</p>
      </>}
    </section>}
  </div>
}
