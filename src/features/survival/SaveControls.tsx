import { useRef, useState, useSyncExternalStore } from 'react'
import type { GameRuntime } from '../../game/GameRuntime'
import { parseSaveFile } from '../../game/saveData'
import { downloadJson } from '../../game/session'
import styles from './ProductionScreen.module.css'

export function SaveControls({ runtime }: { runtime: GameRuntime }) {
  const state = useSyncExternalStore(runtime.subscribeUi, runtime.getUiSnapshot)
  const input = useRef<HTMLInputElement>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const loadFile = async (file?: File) => {
    if (!file) return
    setBusy(true)
    try {
      if (file.size > 2_000_000) throw new Error('存档文件过大')
      const text = await file.text()
      parseSaveFile(text, runtime.world, runtime.catalog!)
      if (!window.confirm('导入备份将替换当前本机营地进度。确定继续吗？')) return
      setMessage(await runtime.importSave(text) ? '备份已导入。' : '导入未完成，请查看保存状态。')
    } catch (error) { setMessage(error instanceof Error ? error.message : '导入失败') }
    finally { setBusy(false); if (input.current) input.current.value = '' }
  }
  return <section className={styles.saveControls} aria-label="本机存档">
    <strong>本机存档</strong><p data-testid="save-status" data-state={state.saveStatus.state}>{state.saveStatus.message}</p>
    <div>
      <button onClick={() => downloadJson(runtime.exportSave())}>导出备份</button>
      <button disabled={busy || state.saveStatus.state === 'conflict'} onClick={() => input.current?.click()}>导入备份</button>
      {state.saveStatus.state === 'error' && <button disabled={busy} onClick={async () => {
        setBusy(true); const saved = await runtime.retrySave(); setMessage(saved ? '保存成功' : '仍未保存，请先导出备份'); setBusy(false)
      }}>重试保存</button>}
      {state.saveStatus.state === 'conflict' && <button onClick={() => window.location.reload()}>重新载入</button>}
    </div>
    <input ref={input} type="file" accept="application/json,.json" aria-label="选择存档备份" hidden onChange={event => void loadFile(event.target.files?.[0])} />
    {message && <p role="status">{message}</p>}
    <small>进度存于当前浏览器。清除站点数据前，请先导出备份。</small>
  </section>
}
