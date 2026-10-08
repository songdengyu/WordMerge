import { useEffect, useId, useRef, useState } from 'react'
import type { GameRuntime, UiSnapshot } from '../../game/GameRuntime'
import { MergePiece } from '../../components/MergePiece'
import { supplyDanger, supplyFor } from '../../game/quickSupply'
import type { WeatherId } from '../../game/survivalConfig'
import styles from './StatusIcons.module.css'

type Vital = 'hp' | 'hunger' | 'water' | 'temperature'
const SHAPES = {
  hp: 'M16 28S3 20.2 3 11.5C3 4.3 11.3 2.8 16 9c4.7-6.2 13-4.7 13 2.5C29 20.2 16 28 16 28Z',
  hunger: 'M12 3h5v7c0 2 2 2.6 3.2.9 1.4-2 2.1-3.3 4.4-2.9 4.3.8 5.7 6.1 4 11.1-1.7 5.2-6 8.9-11.6 8.9-5 0-6.9-2-9-5.4-1-1.6-2.3-2-5-2V16c3.8 0 6.4 1 8.5 3.9 1.4 1.9 3.6 1.4 3.6-.5 0-2.4-3.1-4.8-3.1-9.4Z',
  water: 'M16 3C13 8 5.5 15.4 5.5 21a10.5 10.5 0 0 0 21 0C26.5 15.4 19 8 16 3Z',
  temperature: 'M13 20.2V6a3 3 0 0 1 6 0v14.2a5.8 5.8 0 1 1-6 0Z',
} as const
const COLORS = { hp: '#d64e58', hunger: '#cf943f', water: '#3e9dcc', temperature: '#7398a3' }
const NAMES = { hp: '生命', hunger: '饱食', water: '水分', temperature: '体感温度' }

function VitalIcon({ kind, value, disabled, onClick }: { kind: Vital; value: number; disabled: boolean; onClick: () => void }) {
  const id = useId(), clip = `${id}-shape`, gradient = `${id}-temperature`
  const amount = Math.max(0, Math.min(100, value)), temperature = kind === 'temperature'
  // Near-empty needs are deliberately outline-only; the exact amount remains accessible.
  const fill = amount <= 5 ? 0 : amount / 100
  const bottom = kind === 'water' ? 31.5 : 28
  const top = temperature ? 22 - amount * .17 : bottom - fill * (bottom - (kind === 'hp' ? 4 : 3))
  const paint = temperature ? `url(#${gradient})` : COLORS[kind]
  const danger = temperature ? amount <= 20 || amount >= 80 : supplyDanger(kind, amount)
  return <button type="button" className={styles.vital} aria-label={`${NAMES[kind]} ${Math.ceil(amount)}/100，${temperature ? '查看保温提示' : '点击补充'}`} disabled={disabled} onClick={onClick}
    title={`${NAMES[kind]} ${Math.ceil(amount)}/100`} data-testid={`vital-${kind}`} data-value={Math.ceil(amount)} data-fill={temperature ? amount / 100 : fill} data-danger={danger}>
    <svg viewBox="0 0 32 34" aria-hidden="true">
      <defs>
        <linearGradient id={gradient} x1="0" y1="29" x2="0" y2="5" gradientUnits="userSpaceOnUse">
          <stop stopColor="#438ed3" /><stop offset=".5" stopColor="#59bc78" /><stop offset="1" stopColor="#d95657" />
        </linearGradient>
        <clipPath id={clip}>{temperature ? <><rect x="14.5" y="5" width="3" height="19" rx="1.5" /><circle cx="16" cy="25.5" r="3.5" /></> : <path d={SHAPES[kind]} />}</clipPath>
      </defs>
      <g clipPath={`url(#${clip})`}>
        <rect className={styles.fill} x="0" y={top} width="32" height={temperature ? 34 - top : bottom - top} fill={paint} />
      </g>
      <path d={SHAPES[kind]} fill="none" stroke={temperature ? '#fff' : paint} strokeWidth={temperature ? 1 : danger ? 2.1 : 1.7} strokeLinejoin="round" />
      {temperature && <path d="M23 7h3m-3 5h2m-2 5h3" fill="none" stroke="#fff" strokeWidth="1" strokeLinecap="round" />}
    </svg>
  </button>
}

export function VitalIcons({ state, runtime, openMerge, message, compact = false }: {
  state: UiSnapshot; runtime: GameRuntime; openMerge: () => void; message: (text: string) => void; compact?: boolean
}) {
  const production = state.production!, vitals = production.vitals
  const lock = useRef(false), [busy, setBusy] = useState(false)
  const previousHp = useRef({ runtime, value: vitals.hp })
  const damageId = useRef(0)
  const [damageFloats, setDamageFloats] = useState<{ id: number; amount: number }[]>([])
  const importing = state.pauseReasons.includes('importing')
  useEffect(() => {
    const previous = previousHp.current
    previousHp.current = { runtime, value: vitals.hp }
    if (previous.runtime !== runtime || importing) { setDamageFloats([]); return }
    const damage = Math.round((previous.value - vitals.hp) * 10) / 10
    if (damage <= 0) return
    const entry = { id: ++damageId.current, amount: damage }
    setDamageFloats(floats => [...floats.slice(-4), entry])
  }, [runtime, vitals.hp, importing])
  const useSupply = async (kind: Vital, requestOnMissing: boolean) => {
    if (lock.current) return
    if (kind === 'temperature') { message('进入有门墙和屋顶的住所保暖，炎热时寻找遮蔽处降温'); return }
    lock.current = true; setBusy(true)
    try {
      const result = await runtime.dispatch({ type: 'quick-supply', stat: kind, requestOnMissing })
      message(result.accepted ? result.message ?? '已补充' : result.reason)
      if (result.accepted && result.openProduction) openMerge()
    } finally { lock.current = false; setBusy(false) }
  }
  const disabled = busy || state.pauseReasons.length > 0
  return <div className={`${styles.line} ${compact ? styles.compact : ''}`} data-testid="survival-vitals">
    {(['hp', 'hunger', 'water', 'temperature'] as const).map(kind => {
      const supply = kind === 'temperature' ? null : supplyFor(production, runtime.catalog!, kind)
      const warning = kind !== 'temperature' && supplyDanger(kind, vitals[kind])
      const item = supply && runtime.catalog!.itemById.get(supply.itemId)!
      return <span className={styles.slot} key={kind}>
        <VitalIcon kind={kind} value={vitals[kind]} disabled={disabled} onClick={() => void useSupply(kind, false)} />
        {kind === 'hp' && damageFloats.map(entry => <span key={entry.id} className={styles.damageFloat}
          data-testid="hp-damage-float" aria-hidden="true"
          onAnimationEnd={() => setDamageFloats(floats => floats.filter(float => float.id !== entry.id))}>−{entry.amount}</span>)}
        {warning && supply && item && <button type="button" className={styles.supply} data-testid={`vital-supply-${kind}`}
          data-ready={String(supply.owned > 0)} data-item-id={supply.itemId} disabled={disabled}
          aria-label={supply.owned ? `使用${item.name}补充${NAMES[kind]}` : `缺少${item.name}，去合成并添加补给订单`}
          onClick={() => void useSupply(kind, true)}><MergePiece item={item} compact /></button>}
      </span>
    })}
  </div>
}

export function WeatherIcon({ weather }: { weather: WeatherId }) {
  return <svg viewBox="0 0 28 28" aria-hidden="true" fill="none" strokeLinecap="round" strokeLinejoin="round">
    {weather !== 'rain' && <g stroke="#c4933f" strokeWidth="1.7">
      <circle cx={weather === 'sunny' ? 14 : 10} cy={weather === 'sunny' ? 14 : 10} r="5" fill="#efd17e" />
      {weather === 'sunny' ? <path d="M14 3v2m0 18v2M3 14h2m18 0h2M6 6l1.5 1.5m13 13L22 22M6 22l1.5-1.5m13-13L22 6" /> : <path d="M10 1v2M1 10h2m.6-6.4L5 5m12-1.4L15.6 5" />}
    </g>}
    {weather !== 'sunny' && <path d="M7 20a4.5 4.5 0 0 1-1-8.9 6.7 6.7 0 0 1 12.9-1.5A5.3 5.3 0 1 1 21 20Z" fill={weather === 'rain' ? '#a2bfcd' : '#ecf0e5'} stroke="#6e8b99" strokeWidth="1.6" />}
    {weather === 'rain' && <path d="m9 23-1 2m7-2-1 2m7-2-1 2" stroke="#64b4e0" strokeWidth="2" />}
  </svg>
}
