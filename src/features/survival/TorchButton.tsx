import { useRef, useState } from 'react'
import type { GameRuntime, UiSnapshot } from '../../game/GameRuntime'
import { availableItems } from '../../game/inventory'
import { LIGHTING } from '../../game/lighting'
import { isInWater } from '../../game/waterMovement'
import styles from './TorchButton.module.css'

export function TorchButton({ runtime, state, message }: { runtime: GameRuntime; state: UiSnapshot; message: (text: string) => void }) {
  const [busy, setBusy] = useState(false), lock = useRef(false)
  const remaining = state.survival.torchRemaining ?? 0, lit = remaining > 0
  const wet = isInWater(runtime.world, state.player)
  const fuel = state.production ? availableItems(state.production.inventory).filter(item => item.itemId === 201).length : 0
  const light = async () => {
    if (lock.current) return
    lock.current = true; setBusy(true)
    try {
      const result = await runtime.dispatch({ type: 'torch-light' })
      message(result.accepted ? result.message ?? '火把已点亮' : result.reason)
    } finally { lock.current = false; setBusy(false) }
  }
  return <button type="button" className={styles.button} data-testid="torch-button" data-lit={String(lit)}
    data-remaining={remaining.toFixed(2)} data-ready={String(!wet && fuel >= 2)} data-in-water={String(wet)} aria-pressed={lit}
    disabled={busy || state.pauseReasons.length > 0} onClick={() => void light()}
    aria-label={wet ? '水中无法点燃火把，请先上岸' : lit ? `火把燃烧中，剩余 ${Math.ceil(remaining)} 秒` : `点燃火把，需要木枝 2 根，当前 ${fuel} 根`}
    title={wet ? '水中无法点燃火把，请先上岸' : lit ? '火把燃烧中，点击不会重复消耗' : '消耗 2 根木枝点亮火把'}>
    <svg viewBox="0 0 40 40" aria-hidden="true">
      <circle cx="20" cy="20" r="18" fill={lit ? '#f7ca7530' : 'none'} stroke={lit ? '#dfb46855' : '#9b917d66'} strokeWidth="1.5" />
      {lit && <circle cx="20" cy="20" r="18" fill="none" stroke="#f5c367" strokeWidth="2"
        strokeDasharray={Math.PI * 36} strokeDashoffset={Math.PI * 36 * (1 - remaining / LIGHTING.torch.seconds)} transform="rotate(-90 20 20)" strokeLinecap="round" />}
      <path d="m19 22-5 12 4 2 6-13Z" fill="#997047" stroke="#e4c08e" strokeWidth="1" />
      <path d="m17 21 8 3 2-6-8-3Z" fill={lit ? '#dca76a' : '#a6a18f'} />
      <path d="M21 23C10 17 22 13 20 4c4 3 5 7 5 9l3-4c7 10 0 16-7 14Z" fill={lit ? '#f59b45' : '#a1aaa0'} />
      <path d="M22 21c-5-3 0-5 1-10 5 5 5 9-1 10Z" fill={lit ? '#ffe2a0' : '#d2d3bd'} />
    </svg>
    <small>{wet ? '上岸点燃' : lit ? `${Math.ceil(remaining)}s` : '木枝×2'}</small>
  </button>
}
