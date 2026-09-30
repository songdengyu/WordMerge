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
import { CampCare, FailurePanel, SurvivalHud } from './CampCare'
import { CampJournal, RegionList, StoryDialogue } from './CampJournal'
import { DayCycle } from './DayCycle'
import { TestControls } from './TestControls'
import { CompanionWheel } from './CompanionWheel'
import { currentChapter, decorError } from '../../game/progression'
import { DECORATIONS, REGIONS, type DecorId, type StoryChapter } from '../../game/progressionConfig'
import { localToWorld } from '../../game/construction'
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

function Sheet({ kind, close, goHome, runtime, travel }: { kind: 'map' | 'settings'; close: () => void; goHome: () => void; runtime: GameRuntime; travel: (id: string) => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { ref.current?.showModal() }, [])
  return <dialog className={styles.sheet} ref={ref} onCancel={close} aria-labelledby="sheet-title"
    onClick={event => { if (event.target === event.currentTarget) close() }}>
    <div className={styles.sheetBody}>
      <div className={styles.sheetHeader}>
        <div>{kind === 'map' && <span className={styles.eyebrow}>一步一步，走向未知</span>}
          <h2 id="sheet-title">{kind === 'map' ? '营地地图' : '设置'}</h2></div>
        <button className={styles.iconButton} onClick={close} aria-label="关闭"><Icon kind="close" /></button>
      </div>
      {kind === 'map' ? <>
        <RegionList runtime={runtime} travel={travel} />
        <button className={styles.primaryButton} onClick={goHome}><Icon kind="compass" />走回营火旁</button>
      </> : <SaveControls runtime={runtime} />}
    </div>
  </dialog>
}

function CampGame({ runtime, notice, reset }: { runtime: GameRuntime; notice: string | null; reset: () => void }) {
  const world = runtime.world
  const state = useSyncExternalStore(runtime.subscribeUi, runtime.getUiSnapshot)
  const host = useRef<HTMLDivElement>(null)
  const scene = useRef<CampScene | null>(null)
  const [toast, setToast] = useState<{ text: string; id: number } | null>(null)
  const [sheet, setSheet] = useState<'map' | 'settings' | null>(null)
  const [mergeOpen, setMergeOpen] = useState(false)
  const openMerge = useCallback(() => setMergeOpen(true), [])
  const [buildingOpen, setBuildingOpen] = useState(false)
  const [careOpen, setCareOpen] = useState(false)
  const [wheelOpen, setWheelOpen] = useState(false)
  const openWheel = useCallback(() => setWheelOpen(true), [])
  const [journalOpen, setJournalOpen] = useState(false)
  const openJournal = useCallback(() => setJournalOpen(true), [])
  const [decorationPlacement, setDecorationPlacement] = useState<{ kind: DecorId; cell: Cell } | null>(null)
  const openCare = useCallback(() => setCareOpen(true), [])
  const [placement, setPlacement] = useState<{ blueprintId: string; origin: Cell; rotation: Rotation } | null>(null)
  const selectBuilding = useCallback((id: string) => { setBuildingOpen(false); scene.current?.centerBuilding(id) }, [])
  const chooseOrigin = useCallback((origin: Cell) => {
    setPlacement(previous => previous ? { ...previous, origin } : null)
    setDecorationPlacement(previous => previous ? { ...previous, cell: origin } : null)
  }, [])
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const message = useCallback((text: string) => setToast({ text, id: performance.now() }), [])
  useEffect(() => attachBrowserLoop(runtime), [runtime])
  useEffect(() => { void runtime.checkpoint() }, [runtime])
  useEffect(() => { if (notice) message(notice) }, [notice, message])
  useEffect(() => {
    runtime.setPauseReason('renderer-loading', true)
    setError(null)
    const renderer = new CampScene(host.current!, runtime, message, setError, selectBuilding, chooseOrigin, openMerge, openWheel, openJournal)
    scene.current = renderer
    void renderer.init()
    return () => { renderer.dispose(); scene.current = null }
  }, [runtime, message, attempt, selectBuilding, chooseOrigin, openMerge, openWheel, openJournal])
  useEffect(() => {
    if (state.survival.failure || state.progression.dialogue) {
      setWheelOpen(false)
      setSheet(null); setCareOpen(false); setBuildingOpen(false); setMergeOpen(false); setPlacement(null); setJournalOpen(false); setDecorationPlacement(null)
    }
  }, [state.survival.failure, state.progression.dialogue])
  useEffect(() => { scene.current?.setPlacement(placement) }, [placement, attempt])
  useEffect(() => { scene.current?.setDecorationPlacement(decorationPlacement) }, [decorationPlacement, attempt])
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
  const paused = state.pauseReasons.length > 0
  const loading = state.pauseReasons.includes('renderer-loading')
  const saveFailed = state.saveStatus.state === 'error' || state.saveStatus.state === 'conflict'
  const closeMerge = useCallback(() => setMergeOpen(false), [])
  const place = (blueprintId: string) => {
    setBuildingOpen(false)
    setPlacement({ blueprintId, origin: { x: 7, y: 10 }, rotation: 0 })
  }
  const placementError = placement && runtime.placementError(placement.blueprintId, placement.origin, placement.rotation)
  const decorationError = decorationPlacement && decorError(decorationPlacement.kind, decorationPlacement.cell, state.progression, state.construction)
  const placing = !!placement || !!decorationPlacement
  const bubblesHidden = placing || mergeOpen || buildingOpen || careOpen || wheelOpen || journalOpen || !!sheet || paused
  useEffect(() => { scene.current?.setBubblesHidden(bubblesHidden) }, [bubblesHidden, attempt])
  const chapter = currentChapter(state.progression)
  const travel = (id: string) => {
    const region = REGIONS.find(r => r.id === id)!
    setSheet(null)
    void runtime.dispatch({ type: 'move', target: region.point }).then(result => {
      if (!result.accepted) message(result.reason)
      else scene.current?.centerCell(region.point)
    })
  }
  const navigate = (action: StoryChapter['action']) => {
    setJournalOpen(false)
    if (action === 'build') setBuildingOpen(true)
    else if (action === 'care') setCareOpen(true)
    else if (action === 'brook' || action === 'grove') {
      if (state.progression.discoveries.includes(action)) setMergeOpen(true)
      else setSheet('map')
    }
  }
  const decorate = (kind: DecorId) => {
    const building = state.construction.buildings.find(b => b.parts.foundation.built)
    if (!building) { message('先建好一块木地基，再布置喜欢的摆件'); return }
    const existing = state.progression.decorations.find(d => d.kind === kind)
    setJournalOpen(false); setDecorationPlacement({ kind, cell: existing?.cell ?? localToWorld(building, { x: 1, y: 0 }) })
    scene.current?.centerBuilding(existing?.buildingId ?? building.id)
  }
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
    data-protected={String(state.protected)} data-building-count={state.construction.buildings.length}
    data-hp={state.production?.vitals.hp} data-enemies={state.survival.enemies.length} data-companion={state.survival.companion.status} data-chapter={chapter?.id ?? 'complete'} data-daylight={String(state.isDay)}>
    <div ref={host} className={styles.map} data-testid="camp-scene" />
    <div className={styles.topVeil} />
    <header className={styles.header}>
      <div className={styles.brand}><button type="button" className={styles.brandIcon} aria-label="设置" title="设置" onClick={() => setSheet('settings')}><Icon kind="leaf" /></button>
        <div><span className={styles.eyebrow}>一段新的生活</span><h1>林间营地</h1></div></div>
      <DayCycle state={state} />
    </header>
    {placement && <div className={styles.chapter}><span className={styles.chapterDot} /><span>安放一个家</span><span className={styles.chapterLine} />从第一块木地基开始</div>}
    <div className={styles.supplyBadge}>⚡ <strong data-testid="map-stamina">{state.production?.stamina.value ?? 100}</strong><span>体力</span></div>
    {!saveFailed && !placing && !state.survival.failure && !state.progression.dialogue && <TestControls runtime={runtime} state={state} message={message} reset={reset} />}
    {!placing && <SurvivalHud state={state} runtime={runtime} open={openCare} openMerge={openMerge} message={message} />}
    <div className={styles.cameraControls}>
      <button aria-label="定位主角" className={styles.iconButton} onClick={() => scene.current?.centerPlayer()}><Icon kind="compass" /></button>
      <div className={styles.zoomButtons}>
        <button aria-label="放大地图" onClick={() => scene.current?.zoomBy(1.2)}>+</button>
        <span />
        <button aria-label="缩小地图" onClick={() => scene.current?.zoomBy(1 / 1.2)}>−</button>
      </div>
    </div>
    {toast && !wheelOpen && <div className={styles.toast} role="status">{toast.text}</div>}
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
    </section> : decorationPlacement ? <section className={styles.placement} data-testid="decoration-placement">
      <strong>{DECORATIONS.find(d => d.id === decorationPlacement.kind)!.name} · 布置营地</strong>
      <p>轻点已建成的木屋地板选择位置，可随时移动或收回。</p>
      <p>{decorationError ?? '这里可以摆放，不阻挡行走'}</p>
      <div><button onClick={() => setDecorationPlacement(null)}>取消</button><button disabled={!!decorationError || paused} onClick={async () => {
        const result = await runtime.dispatch({ type: 'decor-place', ...decorationPlacement })
        if (!result.accepted) message(result.reason)
        else { setDecorationPlacement(null); message(result.message ?? '已经摆好了') }
      }}>确认摆放</button></div>
    </section> : <footer className={styles.footer}>
      <button className={styles.buildButton} onClick={() => setBuildingOpen(true)}>建</button>
      <div className={styles.activity} data-testid="activity"><span className={styles.activityDot} data-moving={state.activity !== 'idle'} />
        <span>{paused ? '营地已暂停' : state.activity === 'taming' ? `驯服中 · ${Math.ceil(state.survival.taming.job!.remaining)} 秒` : state.activity === 'building' ? `施工中 · 保护生效 · ${Math.ceil(state.construction.jobs[0].remaining)} 秒` : state.activity === 'walking' ? '沿着小径前行' : state.activity === 'searching' ? '正在寻找小径' : '在林间停留片刻'}</span>
        <span className={styles.coordinates}>建设经验 <span data-testid="building-xp">{state.construction.xp}</span> · {state.saveStatus.state === 'saved' ? '已保存' : state.saveStatus.state === 'saving' ? '保存中…' : '待保存'}</span></div>
      <div className={styles.footerCard}>
        <button className={styles.hint} aria-label="营地手记" onClick={openJournal}><span className={styles.hintIcon}><Icon kind="book" /></span>
          <div><strong>{chapter?.title ?? '这里，也是你的家'} <span aria-hidden="true">›</span></strong><p>{chapter?.goal ?? '首章完成 · 继续建设与装扮'}</p></div></button>
        <div className={styles.footerActions}>
          <button onClick={() => setSheet('map')}><Icon kind="map" />营地地图</button>
          <button className={styles.craftButton} onClick={() => setMergeOpen(true)}>✧ 合成物资</button>
        </div>
      </div>
    </footer>}
    {(loading || error) && <div className={styles.loading} role={error ? 'alert' : 'status'}>
      <Icon kind="leaf" /><h2>{error ? '暂时无法进入营地' : '穿过林间小径…'}</h2>
      {error && <><p>{error}</p><button className={styles.primaryButton} onClick={() => setAttempt(value => value + 1)}>重新载入地图</button></>}
    </div>}
    {mergeOpen && <ProductionScreen runtime={runtime} close={closeMerge} message={message} />}
    {buildingOpen && !mergeOpen && <BuildingPanel runtime={runtime} select={selectBuilding} close={() => setBuildingOpen(false)} place={place} />}
    {careOpen && <CampCare runtime={runtime} close={() => setCareOpen(false)} openMerge={() => setMergeOpen(true)} message={message} />}
    {wheelOpen && <CompanionWheel runtime={runtime} close={() => setWheelOpen(false)} message={message} />}
    {journalOpen && <CampJournal runtime={runtime} close={() => setJournalOpen(false)} navigate={navigate} decorate={decorate} />}
    {state.progression.dialogue && <StoryDialogue runtime={runtime} />}
    {state.survival.failure && <FailurePanel runtime={runtime} message={message} />}
    {saveFailed && <section className={styles.saveError} role="alert"><h2>先保管好营地进度</h2><SaveControls runtime={runtime} />
      <button className={styles.dangerButton} title="清除所有数据" onClick={reset}>删</button></section>}
    {sheet && <Sheet kind={sheet} close={() => setSheet(null)} goHome={goHome} runtime={runtime} travel={travel} />}
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
