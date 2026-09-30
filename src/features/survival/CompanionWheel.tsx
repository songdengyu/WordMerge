import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { GameCommand, GameRuntime } from '../../game/GameRuntime'
import { SURVIVAL_RULES } from '../../game/survivalConfig'
import styles from './CompanionWheel.module.css'

const choices = [
  { id: 'rest', name: '休养', path: 'M18 4a8 8 0 1 0 2 14A8 8 0 0 1 18 4Z' },
  { id: 'guard', name: '驻守', path: 'm12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Zm0 5v7m-3-3h6' },
  { id: 'follow', name: '跟随', path: 'm4 12 16-8-8 16-1-7Z' },
  { id: 'treat', name: '治疗', path: 'M9 3h6v6h6v6h-6v6H9v-6H3V9h6Z' },
] as const

export function CompanionWheel({ runtime, close, message }: { runtime: GameRuntime; close: () => void; message: (text: string) => void }) {
  const state = useSyncExternalStore(runtime.subscribeUi, runtime.getUiSnapshot), buddy = state.survival.companion
  const dialog = useRef<HTMLDialogElement>(null)
  const pointerStartedInside = useRef(false)
  const [feedback, setFeedback] = useState(''), [busy, setBusy] = useState(false)
  useEffect(() => { dialog.current?.showModal() }, [])
  const run = async (command: GameCommand) => {
    if (busy) return
    setBusy(true)
    const result = await runtime.dispatch(command)
    const text = result.accepted ? result.message ?? '已下达指令' : result.reason
    message(text)
    if (result.accepted) close()
    else { setFeedback(text); setBusy(false) }
  }
  return <dialog ref={dialog} className={styles.overlay} aria-label={`${SURVIVAL_RULES.companion.name}指令盘`} onCancel={close}
    onPointerDownCapture={() => { pointerStartedInside.current = true }}
    onPointerCancel={() => { pointerStartedInside.current = false }}
    onClickCapture={event => {
      // A map pointerup opens this modal before the browser emits its click. That
      // same click can land on a command or the centre, but is not a new gesture.
      if (!pointerStartedInside.current && event.detail !== 0) { event.preventDefault(); event.stopPropagation() }
      pointerStartedInside.current = false
    }}
    onClick={event => { if (event.target === event.currentTarget) close() }} data-testid="companion-wheel">
    <div className={styles.wheel}>
      {choices.map(choice => {
        const disabled = busy || !!state.pauseReasons.length || (choice.id === 'treat'
          ? buddy.status === 'recovering' || buddy.status === 'wild' || buddy.hp >= SURVIVAL_RULES.companion.hp : buddy.status !== 'active')
        return <button key={choice.id} className={`${styles.wedge} ${styles[choice.id]}`} disabled={disabled}
          aria-label={choice.name} aria-pressed={choice.id === 'treat' ? undefined : buddy.mode === choice.id}
          onClick={() => void run(choice.id === 'treat' ? { type: 'companion-treat' } : { type: 'companion-mode', mode: choice.id })}>
          <span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={choice.path} /></svg>{choice.name}</span>
        </button>
      })}
      <svg className={styles.lines} viewBox="0 0 300 300" aria-hidden="true"><path d="m44 44 68 68m76 76 68 68M44 256l68-68m76-76 68-68" /></svg>
      <button className={styles.center} aria-label="关闭指令盘" onClick={close} autoFocus>
        <strong>{SURVIVAL_RULES.companion.name}</strong>
        <span>{buddy.status === 'recovering' ? `恢复 ${Math.ceil(buddy.recoveryRemaining)}s` : buddy.status === 'injured' ? '受伤' : `${Math.ceil(buddy.hp)} / ${SURVIVAL_RULES.companion.hp}`}</span>
      </button>
    </div>
    <p className={styles.feedback} role="status">{feedback || (buddy.status === 'injured' ? '使用草药绷带治疗伙伴' : buddy.status === 'recovering' ? '伙伴正在恢复，请稍候' : '选择指令 · 点击空白关闭')}</p>
  </dialog>
}
