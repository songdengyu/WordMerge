import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { GameRuntime } from '../../game/GameRuntime'
import { attachBrowserLoop } from '../../game/browserLoop'
import { downloadJson, loadGameSession, recoverFromFile } from '../../game/session'
import { SaveError } from '../../game/saveData'
import { clearGameData } from '../../game/persistence'
import { CampScene } from '../../scene/CampScene'
import { ProductionScreen } from './ProductionScreen'
import { SaveControls } from './SaveControls'
import { BuildingPanel } from './BuildingPanel'
import { BuildingBubbles } from './BuildingBubbles'
import { BLUEPRINTS } from '../../game/buildingConfig'
import type { Rotation } from '../../game/construction'
import type { Cell } from '../../game/world'
import styles from './SurvivalApp.module.css'

function Icon({ kind }: { kind: 'leaf' | 'sun' | 'moon' | 'map' | 'compass' | 'book' | 'close' }) {
  const paths = {
    leaf: 'M5 20C2 10 8 3 20 4c1 12-5 17-12 13M5 20 15 9M10 14v-4m0 4h4',
    sun: 'M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
    moon: 'M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11Z',
    map: 'm3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2Zm6-2v16m6-14v16',
    compass: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-6-3-2 4-4 2 2-4Z',
    book: 'M4 4h12a3 3 0 0 1 3 3v14H6a3 3 0 0 1-3-3V5a1 1 0 0 1 1-1Zm-1 14a3 3 0 0 1 3-3h13M8 8h7m-7 3h5',
    close: 'm6 6 12 12M6 18 18 6',
  }
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[kind]} /></svg>
}

function Sheet({ kind, close, goHome, runtime }: { kind: 'map' | 'help'; close: () => void; goHome: () => void; runtime: GameRuntime }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { ref.current?.showModal() }, [])
  return <dialog className={styles.sheet} ref={ref} onCancel={close} aria-labelledby="sheet-title"
    onClick={event => { if (event.target === event.currentTarget) close() }}>
    <div className={styles.sheetBody}>
      <div className={styles.sheetHeader}>
        <div><span className={styles.eyebrow}>{kind === 'map' ? '一步一步，走向未知' : '给初来者的小纸条'}</span>
          <h2 id="sheet-title">{kind === 'map' ? '营地地图' : '探索指引'}</h2></div>
        <button className={styles.iconButton} onClick={close} aria-label="关闭"><Icon kind="close" /></button>
      </div>
      {kind === 'map' ? <>
        <div className={styles.region}><span className={styles.regionIcon}><Icon kind="leaf" /></span>
          <div><h3>林间营地</h3><p>旧营火、小径与一片安静的水塘。</p></div><span className={styles.badge}>已发现</span></div>
        <div className={`${styles.region} ${styles.locked}`}><span className={styles.regionIcon}>01</span><div><h3>溪谷深处</h3><p>水声从远处传来。</p></div><span>未开放</span></div>
        <div className={`${styles.region} ${styles.locked}`}><span className={styles.regionIcon}>02</span><div><h3>静谧林地</h3><p>树影后，还有未走过的路。</p></div><span>未开放</span></div>
        <button className={styles.primaryButton} onClick={goHome}><Icon kind="compass" />走回营火旁</button>
      </> : <>
        <ol className={styles.instructions}>
          <li><strong>轻点空地</strong><p>主角会沿可行的小径走过去，绕开树木、岩石和水面。</p></li>
          <li><strong>拖动与缩放</strong><p>单指拖动查看周围，双指捏合调整远近；电脑也可使用滚轮。</p></li>
          <li><strong>找到自己</strong><p>点击右侧罗盘，将视线移回主角。点选营火和路标，看看留下的痕迹。</p></li>
        </ol>
        <div className={styles.note}>阅读这张纸条时，营地时间仍在流逝。切到后台后，营地会暂停。</div>
        <p className={styles.prototypeNote}>体力每现实 10 秒恢复 1 点，离线也恢复；道具补给可超过 100。</p>
        <SaveControls runtime={runtime} />
      </>}
    </div>
  </dialog>
}

function CampGame({ runtime, notice, reset }: { runtime: GameRuntime; notice: string | null; reset: () => void }) {
  const world = runtime.world
  const state = useSyncExternalStore(runtime.subscribeUi, runtime.getUiSnapshot)
  const host = useRef<HTMLDivElement>(null)
  const scene = useRef<CampScene | null>(null)
  const bubbleLayer = useRef<HTMLDivElement>(null)
  const [toast, setToast] = useState<{ text: string; id: number } | null>(null)
  const [sheet, setSheet] = useState<'map' | 'help' | null>(null)
  const [mergeOpen, setMergeOpen] = useState(false)
  const [buildingOpen, setBuildingOpen] = useState(false)
  const [placement, setPlacement] = useState<{ blueprintId: string; origin: Cell; rotation: Rotation } | null>(null)
  const selectBuilding = useCallback((id: string) => { setBuildingOpen(false); scene.current?.centerBuilding(id) }, [])
  const chooseOrigin = useCallback((origin: Cell) => setPlacement(previous => previous ? { ...previous, origin } : null), [])
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const message = useCallback((text: string) => setToast({ text, id: performance.now() }), [])
  useEffect(() => attachBrowserLoop(runtime), [runtime])
  useEffect(() => { void runtime.checkpoint() }, [runtime])
  useEffect(() => { if (notice) message(notice) }, [notice, message])
  useEffect(() => {
    runtime.setPauseReason('renderer-loading', true)
    setError(null)
    const renderer = new CampScene(host.current!, runtime, message, setError, selectBuilding, chooseOrigin, bubbleLayer.current!)
    scene.current = renderer
    void renderer.init()
    return () => { renderer.dispose(); scene.current = null }
  }, [runtime, message, attempt, selectBuilding, chooseOrigin])
  useEffect(() => { scene.current?.setPlacement(placement) }, [placement, attempt])
  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(timer)
  }, [toast])
  useEffect(() => {
    const previous = document.title
    document.title = '林间营地 · WordMerge'
    return () => { document.title = previous }
  }, [])
  const time = `${String(state.hour).padStart(2, '0')}:${String(state.minute).padStart(2, '0')}`
  const paused = state.pauseReasons.length > 0
  const loading = state.pauseReasons.includes('renderer-loading')
  const saveFailed = state.saveStatus.state === 'error' || state.saveStatus.state === 'conflict'
  const closeMerge = useCallback(() => setMergeOpen(false), [])
  const place = (blueprintId: string) => {
    setBuildingOpen(false)
    setPlacement({ blueprintId, origin: { x: 7, y: 10 }, rotation: 0 })
  }
  const placementError = placement && runtime.placementError(placement.blueprintId, placement.origin, placement.rotation)
  const goHome = () => {
    setSheet(null)
    void runtime.dispatch({ type: 'move', target: world.config.spawn }).then(result => {
      if (!result.accepted) message(result.reason)
      else scene.current?.centerPlayer()
    })
  }

  return <main className={styles.shell} data-testid="survival-game" data-player={`${state.player.x},${state.player.y}`}
    data-activity={state.activity} data-destination={state.destination ? `${state.destination.x},${state.destination.y}` : ''}
    data-paused={String(paused)} data-save-state={state.saveStatus.state} data-save-revision={state.saveStatus.revision}
    data-protected={String(state.protected)} data-building-count={state.construction.buildings.length}>
    <div ref={host} className={styles.map} data-testid="camp-scene" />
    <BuildingBubbles runtime={runtime} layer={bubbleLayer} hidden={!!placement || mergeOpen || buildingOpen || !!sheet || paused}
      openMerge={() => setMergeOpen(true)} message={message} />
    <div className={styles.topVeil} />
    <header className={styles.header}>
      <div className={styles.brand}><span className={styles.brandIcon}><Icon kind="leaf" /></span>
        <div><span className={styles.eyebrow}>一段新的生活</span><h1>林间营地</h1></div></div>
      <div className={styles.clock} aria-label={`第 ${state.day} 天 ${time} ${state.isDay ? '白天' : '夜晚'}`}>
        <span>第 {state.day} 天</span><strong data-testid="game-clock">{time}</strong>
        <span><Icon kind={state.isDay ? 'sun' : 'moon'} />{state.isDay ? '白天' : '夜晚'}</span>
      </div>
    </header>
    <div className={styles.chapter}><span className={styles.chapterDot} /><span>安放一个家</span><span className={styles.chapterLine} />从第一块木地基开始</div>
    <div className={styles.supplyBadge}>⚡ <strong data-testid="map-stamina">{state.production?.stamina.value ?? 100}</strong><span>体力</span></div>
    {!placement && <button className={styles.buildButton} onClick={() => setBuildingOpen(true)}>⌂ 营地建设</button>}
    {!saveFailed && !placement && <button className={`${styles.dangerButton} ${styles.resetButton}`} title="清除所有数据" onClick={reset}>删</button>}
    <div className={styles.cameraControls}>
      <button aria-label="定位主角" className={styles.iconButton} onClick={() => scene.current?.centerPlayer()}><Icon kind="compass" /></button>
      <div className={styles.zoomButtons}>
        <button aria-label="放大地图" onClick={() => scene.current?.zoomBy(1.2)}>+</button>
        <span />
        <button aria-label="缩小地图" onClick={() => scene.current?.zoomBy(1 / 1.2)}>−</button>
      </div>
    </div>
    {toast && <div className={styles.toast} role="status">{toast.text}</div>}
    {placement ? <section className={styles.placement} data-testid="placement-panel">
      <strong>{BLUEPRINTS.find(blueprint => blueprint.id === placement.blueprintId)?.name} · 选择位置</strong>
      <p>轻点地图选址，拖动查看周围 · 朝向 {placement.rotation * 90}°</p>
      <p data-testid="placement-status">{placementError ?? '这片空地可以安家，木门已留出通道'}</p>
      <div><button onClick={() => setPlacement(null)}>取消</button><button onClick={() => setPlacement({ ...placement, rotation: ((placement.rotation + 1) % 4) as Rotation })}>旋转图纸</button>
        <button disabled={!!placementError || paused} onClick={async () => {
          const result = await runtime.dispatch({ type: 'building-place', ...placement })
          if (!result.accepted) { message(result.reason); return }
          setPlacement(null); const buildings = runtime.getUiSnapshot().construction.buildings
          selectBuilding(buildings[buildings.length - 1].id)
        }}>确认放置</button></div>
    </section> : <footer className={styles.footer}>
      <div className={styles.activity} data-testid="activity"><span className={styles.activityDot} data-moving={state.activity !== 'idle'} />
        <span>{paused ? '营地已暂停' : state.activity === 'building' ? `施工中 · 保护生效 · ${Math.ceil(state.construction.jobs[0].remaining)} 秒` : state.activity === 'walking' ? '沿着小径前行' : state.activity === 'searching' ? '正在寻找小径' : '在林间停留片刻'}</span>
        <span className={styles.coordinates}>建设经验 <span data-testid="building-xp">{state.construction.xp}</span> · {state.saveStatus.state === 'saved' ? '已保存' : state.saveStatus.state === 'saving' ? '保存中…' : '待保存'}</span></div>
      <div className={styles.footerCard}>
        <div className={styles.hint}><span className={styles.hintIcon}><Icon kind="leaf" /></span>
          <div><strong>这里，可以成为你的家</strong><p>{state.feedback}</p></div></div>
        <div className={styles.footerActions}>
          <button onClick={() => setSheet('map')}><Icon kind="map" />营地地图</button>
          <button className={styles.craftButton} onClick={() => setMergeOpen(true)}>✧ 合成物资</button>
          <button onClick={() => setSheet('help')}><Icon kind="book" />探索指引</button>
        </div>
      </div>
    </footer>}
    {(loading || error) && <div className={styles.loading} role={error ? 'alert' : 'status'}>
      <Icon kind="leaf" /><h2>{error ? '暂时无法进入营地' : '穿过林间小径…'}</h2>
      {error && <><p>{error}</p><button className={styles.primaryButton} onClick={() => setAttempt(value => value + 1)}>重新载入地图</button></>}
    </div>}
    {mergeOpen && <ProductionScreen runtime={runtime} close={closeMerge} message={message} />}
    {buildingOpen && !mergeOpen && <BuildingPanel runtime={runtime} select={selectBuilding} close={() => setBuildingOpen(false)} place={place} />}
    {saveFailed && <section className={styles.saveError} role="alert"><h2>先保管好营地进度</h2><SaveControls runtime={runtime} />
      <button className={styles.dangerButton} title="清除所有数据" onClick={reset}>删</button></section>}
    {sheet && <Sheet kind={sheet} close={() => setSheet(null)} goHome={goHome} runtime={runtime} />}
  </main>
}

export default function SurvivalApp() {
  const [session, setSession] = useState<Awaited<ReturnType<typeof loadGameSession>> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [raw, setRaw] = useState<unknown>(null)
  const [recovering, setRecovering] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [resetStatus, setResetStatus] = useState<'busy' | 'error' | null>(null)
  const resetLock = useRef(false)
  const reset = async () => {
    if (resetLock.current || recovering) return
    if (!window.confirm('清除本机此游戏的所有进度？\n包括合成棋盘、仓库、体力、货币、建筑、经验、委托及自动备份。清除后将从头开始，无法撤销。')) return
    resetLock.current = true
    setResetStatus('busy')
    try {
      // Stop commands and drain queued checkpoints before erasing their records.
      await session?.runtime.dispose()
      await clearGameData()
      window.location.reload()
    } catch {
      setResetStatus('error')
    } finally { resetLock.current = false }
  }
  useEffect(() => {
    const controller = new AbortController()
    let loaded: Awaited<ReturnType<typeof loadGameSession>> | null = null
    setError(null)
    setRaw(null)
    void loadGameSession(controller.signal).then(value => {
      if (controller.signal.aborted) { void value.runtime.dispose(); return }
      loaded = value; setSession(value)
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) {
        setError(error instanceof Error ? error.message : '营地配置或本机存档加载失败')
        if (error instanceof SaveError) setRaw(error.raw ?? null)
      }
    })
    return () => { controller.abort(); if (loaded) void loaded.runtime.dispose() }
  }, [attempt])
  if (resetStatus) return <div className={styles.viewport}><main className={styles.boot} role={resetStatus === 'error' ? 'alert' : 'status'}>
    <Icon kind="leaf" /><h1>{resetStatus === 'busy' ? '正在清除游戏数据…' : '清除失败'}</h1>
    {resetStatus === 'error' && <><p>本机存储暂时无法清除。可以重试，或重新载入已有进度。</p>
      <button className={styles.dangerButton} onClick={() => void reset()}>重试清除</button>
      <button className={styles.primaryButton} onClick={() => window.location.reload()}>重新载入</button></>}
  </main></div>
  return <div className={styles.viewport}>{session ? <CampGame {...session} reset={() => void reset()} /> :
    <main className={styles.boot} role={error ? 'alert' : 'status'}><Icon kind="leaf" />
      <h1>{error ? '营地暂时无法打开' : '寻找林间营地…'}</h1>
      {error && <><p>{error}</p><button className={styles.primaryButton} disabled={recovering} onClick={() => setAttempt(value => value + 1)}>重试</button>
        {raw !== null && <button className={styles.primaryButton} onClick={() => downloadJson(JSON.stringify(raw, null, 2), 'wordmerge-recovery-data')}>导出故障数据</button>}
        <label className={styles.importLabel}>导入已有备份<input type="file" accept="application/json,.json" disabled={recovering} aria-label="恢复存档备份" onChange={async event => {
          const file = event.target.files?.[0]; event.target.value = ''
          if (!file) return
          if (file.size > 2_000_000) { setError('存档文件过大'); return }
          if (!window.confirm('导入备份将替换本机营地记录。确定继续吗？')) return
          setRecovering(true)
          try { await recoverFromFile(await file.text()); setAttempt(value => value + 1) }
          catch (error) { setError(error instanceof Error ? error.message : '备份恢复失败') }
          finally { setRecovering(false) }
        }} /></label>
        <button className={styles.dangerButton} title="清除所有数据" disabled={recovering} onClick={() => void reset()}>删</button></>}
    </main>}</div>
}
