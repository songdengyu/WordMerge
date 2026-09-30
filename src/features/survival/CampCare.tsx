import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { GameRuntime, GameCommand, UiSnapshot } from '../../game/GameRuntime'
import { BLUEPRINTS } from '../../game/buildingConfig'
import { localToWorld } from '../../game/construction'
import { ENEMIES, SURVIVAL_RULES, WEATHER } from '../../game/survivalConfig'
import { dayCycle } from '../../game/environment'
import { nearbyThreats } from '../../game/survival'
import { PawIcon, VitalIcons } from './StatusIcons'
import styles from './CampCare.module.css'

const buddyStatus = { wild: '待救助', active: '健康', injured: '受伤', recovering: '休养中' }
export const VitalLine = VitalIcons
export function SurvivalHud({ state, runtime, open, openMerge, message }: {
  state: UiSnapshot; runtime: GameRuntime; open: () => void; openMerge: () => void; message: (text: string) => void
}) {
  return <aside className={styles.hud}>
    <VitalLine state={state} runtime={runtime} openMerge={openMerge} message={message} />
    <button className={styles.companion} onClick={open} aria-label="伙伴与生存" title={`栗栗 · ${buddyStatus[state.survival.companion.status]}`} data-state={state.survival.companion.status}>
      <PawIcon /><span aria-hidden="true" />
    </button>
  </aside>
}
export function CampThreat({ state }: { state: UiSnapshot }) {
  const threats = nearbyThreats(state.survival, state.player)
  const damaged = state.construction.buildings.flatMap(building => BLUEPRINTS.find(b => b.id === building.blueprintId)!.parts
    .filter(part => (part.kind === 'wall' || part.kind === 'door') && building.parts[part.id].built && building.parts[part.id].hp < part.hp)
    .map(part => `${part.name} ${Math.ceil(building.parts[part.id].hp)}/${part.hp}`))
  return <div className={styles.threat} data-testid="camp-threat" data-danger={threats.length > 0 || state.production!.vitals.hp <= 30}>
    <div><span>{dayCycle(state.hour * 60 + state.minute).label}
      {' · '}附近敌人 <b data-testid="enemy-count">{threats.length}</b></span>
      <span>伙伴 {state.survival.companion.status === 'active' ? Math.ceil(state.survival.companion.hp) : buddyStatus[state.survival.companion.status]}</span>
      <span>{state.protected ? state.activity === 'unlocking' ? '开放区域保护' : state.activity === 'taming' ? '驯服保护' : '施工保护' : state.shelter.enclosed ? '门墙封闭' : '室外 / 缺口'}</span></div>
    <p>{damaged.length ? damaged.join(' · ') : state.warning}</p>
  </div>
}
export function CampCare({ runtime, close, openMerge, message }: { runtime: GameRuntime; close: () => void; openMerge: () => void; message: (text: string) => void }) {
  const state = useSyncExternalStore(runtime.subscribeUi, runtime.getUiSnapshot), buddy = state.survival.companion
  const dialog = useRef<HTMLDialogElement>(null)
  const [feedback, setFeedback] = useState('')
  const report = (text: string) => { setFeedback(text); message(text) }
  useEffect(() => { dialog.current?.showModal() }, [])
  const send = async (command: GameCommand) => {
    const result = await runtime.dispatch(command)
    report(result.accepted ? result.message ?? '已安排' : result.reason)
    if (result.accepted && command.type === 'taming-interact') { close(); if (result.openProduction) openMerge() }
  }
  return <dialog ref={dialog} className={styles.dialog} onCancel={close} aria-labelledby="care-title"
    onClick={event => { if (event.target === event.currentTarget) close() }}>
    <header><div><small>一起守住这片营地</small><h2 id="care-title">照护与守卫</h2></div><button className={styles.close} onClick={close} aria-label="关闭照护">×</button></header>
    <VitalLine state={state} runtime={runtime} openMerge={() => { close(); openMerge() }} message={report} /><p className={styles.notice} role="status">{feedback || state.warning}</p>
    <div className={styles.weather}>{WEATHER[state.survival.weather].icon} 今日{WEATHER[state.survival.weather].name} · 明日预计{WEATHER[state.survival.forecast].name}
      <small>{state.shelter.rainproof ? '屋顶避雨' : '露天'} · {state.shelter.enclosed ? '门墙保温' : '门墙未封闭'} · {state.shelter.rest ? '有床可休养' : '暂无床铺'}</small></div>
    <section><h3>栗栗 <span data-testid="companion-state">{buddyStatus[buddy.status]}</span></h3>
      {buddy.status === 'wild' ? <><p>白天点击小犬头顶的材料气泡，准备 1 份 3 级野餐餐盒后自动前往，驯服需要 2 秒。</p><div className={styles.buttons}>
        <button disabled={!!state.survival.taming.job} onClick={() => void send({ type: 'taming-interact' })}>前往驯服</button></div></>
        : <><p>生命 <b data-testid="companion-hp">{Math.ceil(buddy.hp)}</b> / {SURVIVAL_RULES.companion.hp}
          {buddy.status === 'recovering' ? ` · 还需 ${Math.ceil(buddy.recoveryRemaining)} 秒` : buddy.status === 'active' ? ` · ${{ guard: '驻守', follow: '跟随', rest: '休养' }[buddy.mode]}` : ' · 草药绷带救治后需休养 60 秒'}</p>
          <div className={styles.buttons}>
            <button disabled={buddy.status !== 'active'} onClick={() => void send({ type: 'companion-mode', mode: 'guard', guard: state.player })}>驻守此处</button>
            <button disabled={buddy.status !== 'active'} onClick={() => void send({ type: 'companion-mode', mode: 'follow' })}>跟随我</button>
            <button disabled={buddy.status !== 'active'} onClick={() => void send({ type: 'companion-mode', mode: 'rest' })}>伙伴休养</button>
            <button disabled={buddy.status === 'recovering' || buddy.hp >= SURVIVAL_RULES.companion.hp} onClick={() => void send({ type: 'companion-treat' })}>用草药绷带治疗</button>
          </div><p className={styles.subtle}>驻守点以主角当前位置为准。伙伴会拦截附近敌人，受伤后保留成长。</p></>}
    </section>
    <section><h3>营地防御 <span>{state.survival.enemies.length} 个敌人</span></h3>
      <CampThreat state={state} />
      {state.survival.enemies.map(enemy => <button className={styles.enemy} key={enemy.id} disabled={buddy.status !== 'active'} onClick={() => void send({ type: 'companion-attack', enemyId: enemy.id })}>
        <span>{ENEMIES[enemy.kind].name} · {Math.ceil(enemy.hp)} / {ENEMIES[enemy.kind].hp}</span><span>让栗栗拦截</span></button>)}
      <div className={styles.buttons}>
        <button onClick={() => { const house = state.construction.buildings.find(building => building.parts.foundation.built)
          if (!house) { report('先放置图纸、建造木屋'); return }
          void send({ type: 'move', target: localToWorld(house, { x: 1, y: 1 }) }); close()
        }}>走进木屋</button><button onClick={() => void send({ type: 'player-rest' })}>{state.survival.resting ? '结束休养' : '床边休养'}</button>
      </div>
    </section>
    <button className={styles.primary} onClick={() => { close(); openMerge() }}>去合成补给</button>
    <p className={styles.subtle}>照护和合成时世界继续；切到后台后暂停。只有主角倒下才会触发救援。</p>
  </dialog>
}
export function FailurePanel({ runtime, message }: { runtime: GameRuntime; message: (text: string) => void }) {
  const state = useSyncExternalStore(runtime.subscribeUi, runtime.getUiSnapshot), failure = state.survival.failure!
  const button = useRef<HTMLButtonElement>(null)
  useEffect(() => { button.current?.focus() }, [])
  return <section className={styles.failure} role="alertdialog" aria-modal="true" aria-labelledby="failure-title" data-testid="failure-panel">
    <span className={styles.rescueIcon}>☀</span><small>第 {failure.day} 天 · {failure.cause === 'enemy' ? '营地遇袭' : '需要照料自己'}</small>
    <h2 id="failure-title">先歇一会儿吧</h2><p>你倒下了。接受救援后，会在下一个清晨回到营地。</p>
    <p>这次散落：{failure.losses.length ? failure.losses.map(item => runtime.catalog!.itemById.get(item.itemId)!.name).join('、') : '没有普通物资损失'}。</p>
    <p>建筑和成长保留，受损部件仍需修复，伙伴仍需照护。</p>
    <button ref={button} className={styles.primary} disabled={state.saveStatus.state !== 'saved' || state.pauseReasons.some(reason => reason !== 'failure')} onClick={async () => {
      const result = await runtime.dispatch({ type: 'rescue' }); message(result.accepted ? result.message ?? '已回到营地' : result.reason)
    }}>接受救援</button>
    <small>{state.saveStatus.state === 'saving' ? '正在保管营地进度…' : '生命恢复至 70，饱食与水分恢复至 60'}</small>
  </section>
}
