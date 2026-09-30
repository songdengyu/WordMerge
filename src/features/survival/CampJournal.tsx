import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { GameCommand, GameRuntime } from '../../game/GameRuntime'
import { currentChapter, chapterReady } from '../../game/progression'
import { CHAPTERS, DECORATIONS, OUTFITS, type DecorId, type StoryChapter } from '../../game/progressionConfig'
import { availableItems } from '../../game/inventory'
import { MergePiece } from '../../components/MergePiece'
import styles from './CampJournal.module.css'

export function CampJournal({ runtime, close, navigate, decorate }: { runtime: GameRuntime; close: () => void;
  navigate: (action: StoryChapter['action']) => void; decorate: (kind: DecorId) => void }) {
  const state = useSyncExternalStore(runtime.subscribeUi, runtime.getUiSnapshot), progress = state.progression
  const dialog = useRef<HTMLDialogElement>(null)
  const [tab, setTab] = useState<'story' | 'dress' | 'memories'>('story'), [notice, setNotice] = useState('')
  useEffect(() => { dialog.current?.showModal() }, [])
  const chapter = currentChapter(progress), catalog = runtime.catalog!
  const ready = chapter && chapterReady(chapter, progress, state.construction, state.survival, state.production!)
  const send = async (command: GameCommand) => { const result = await runtime.dispatch(command); setNotice(result.accepted ? result.message ?? '已保存' : result.reason) }
  return <dialog ref={dialog} className={styles.journal} onCancel={close} aria-labelledby="journal-title" onClick={e => { if (e.target === e.currentTarget) close() }}>
    <header><div><small>第一章 · 有人等你回来</small><h2 id="journal-title">营地手记</h2></div><button className={styles.close} onClick={close} aria-label="关闭手记">×</button></header>
    <nav aria-label="手记分页">{([['story', '今日目标'], ['dress', '装扮'], ['memories', '回忆']] as const).map(([id, name]) =>
      <button key={id} aria-pressed={tab === id} onClick={() => { setTab(id); setNotice('') }}>{name}</button>)}</nav>
    {tab === 'story' && <>
      <div className={styles.chapter} data-testid="chapter-card"><small>{progress.completed.length} / {CHAPTERS.length} 段回忆</small>
        <h3>{chapter?.title ?? '这里，也是你的家'}</h3><p>{chapter?.goal ?? '首章试玩已完成。继续建设和照护，等待新的来信。'}</p>
        {chapter && <><p className={styles.muted}>{chapter.hint}</p>
          {!!chapter.requirements.length && <div className={styles.supplies}>{chapter.requirements.map((id, i) => <span key={i}>
            <MergePiece item={catalog.itemById.get(id)!} compact /><small>{catalog.itemById.get(id)!.name} {availableItems(state.production!.inventory).filter(item => item.itemId === id).length}/1</small>
          </span>)}</div>}
          <p className={styles.reward}>留下的心意：{[chapter.decor && DECORATIONS.find(d => d.id === chapter.decor)?.name, chapter.outfit && OUTFITS.find(o => o.id === chapter.outfit)?.name,
            ...chapter.rewardItems.map(id => catalog.itemById.get(id)!.name)].filter(Boolean).join(' · ') || '一段营地往事'}</p>
          <button className={styles.primary} disabled={!ready || !!state.pauseReasons.length} onClick={() => void send({ type: 'story-open', chapterId: chapter.id })}>继续故事</button>
          {!ready && <button className={styles.secondary} onClick={() => chapter.action === 'dress' ? setTab('dress') : navigate(chapter.action)}>前往完成目标</button>}
        </>}
      </div>
      {chapter?.requirements.length ? <p className={styles.muted}>在最后回应时交付物资。工作台奖励需要棋盘空格；满仓时可稍后再读，奖励不会丢失。</p> : null}
      <p className={styles.muted}>手记与装扮不暂停世界；进入剧情对话后暂停，离开对话继续。</p>
    </>}
    {tab === 'dress' && <>
      <h3 className={styles.sectionTitle}>衣裳</h3><div className={styles.outfits}>{OUTFITS.map(outfit => <button key={outfit.id} disabled={!progress.ownedOutfits.includes(outfit.id) || !!state.pauseReasons.length}
        aria-pressed={progress.outfit === outfit.id} onClick={() => void send({ type: 'outfit-equip', outfitId: outfit.id })}>
        <svg viewBox="0 0 50 55" aria-hidden="true"><path d="M15 4 4 14l6 12 7-3-5 27h26l-5-27 7 3 6-12L35 4q-10 10-20 0" fill={`#${outfit.color.toString(16)}`} /><path d="M17 22h16M20 10l12 33" stroke="#f4e2bd" fill="none" /></svg>
        <span>{outfit.name}</span><small>{progress.outfit === outfit.id ? '穿着中' : progress.ownedOutfits.includes(outfit.id) ? '换上' : '随故事获得'}</small>
      </button>)}</div>
      <h3 className={styles.sectionTitle}>给家添一点喜欢</h3>{DECORATIONS.map(decor => <div key={decor.id} className={styles.decor}>
        <span style={{ color: decor.color }}>{decor.symbol}</span><div><strong>{decor.name}</strong><small>{progress.ownedDecor.includes(decor.id) ? progress.decorations.some(d => d.kind === decor.id) ? '已在营地摆放' : '收藏中 · 1 件' : '随故事获得'}</small></div>
        <button disabled={!progress.ownedDecor.includes(decor.id) || !!state.pauseReasons.length} onClick={() => decorate(decor.id)}>{progress.decorations.some(d => d.kind === decor.id) ? '移动' : '摆放'}</button>
        {progress.decorations.some(d => d.kind === decor.id) && <button onClick={() => void send({ type: 'decor-remove', kind: decor.id })}>收回</button>}
      </div>)}<p className={styles.muted}>衣裳与摆件仅改变外观，不增加温度或战力，也不会堵住通路。收回后仍在收藏中。</p>
    </>}
    {tab === 'memories' && <>
      {progress.completed.includes('visitor') && <div className={styles.resident}><b>林岚 · 暂住营地</b><p>{progress.choices.visitor === 'welcome' ? '她愿意慢慢说起那些旧事，也开始把这里当作歇脚的家。' : '她答应陪你寻找寄信的人。你们都还保留着一些疑问。'}</p></div>}
      {!progress.completed.length && <p className={styles.muted}>读完第一封信，就会留下第一段回忆。</p>}
      {progress.completed.map(id => { const chapter = CHAPTERS.find(c => c.id === id)!, choice = chapter.choices.find(c => c.id === progress.choices[id])!
        return <article className={styles.memory} key={id}><h3>{chapter.title}</h3><p>你说：“{choice.text}”</p><p className={styles.muted}>{choice.reply}</p></article> })}
    </>}
    <p role="status" className={styles.notice}>{notice}</p>
  </dialog>
}

export function StoryDialogue({ runtime }: { runtime: GameRuntime }) {
  const state = useSyncExternalStore(runtime.subscribeUi, runtime.getUiSnapshot), reading = state.progression.dialogue!
  const chapter = CHAPTERS.find(c => c.id === reading.chapterId)!, line = chapter.lines[reading.line]
  const [notice, setNotice] = useState(''), [busy, setBusy] = useState(false)
  const focus = useRef<HTMLButtonElement>(null)
  useEffect(() => { focus.current?.focus() }, [])
  const send = async (command: GameCommand) => { setBusy(true); const result = await runtime.dispatch(command); if (!result.accepted) setNotice(result.reason); setBusy(false) }
  const disabled = busy || state.saveStatus.state !== 'saved' || state.pauseReasons.some(r => r !== 'story')
  return <section className={styles.dialogue} role="dialog" aria-modal="true" aria-labelledby="story-title" data-testid="story-dialogue">
    <header><small>营地暂停 · {reading.line + 1}/{chapter.lines.length}</small><button ref={focus} disabled={disabled} onClick={() => void send({ type: 'story-close' })}>稍后再读</button></header>
    <div className={styles.storyArt} aria-hidden="true">{line.speaker === '林岚' ? '❀' : line.speaker === '你' ? '☘' : '✉'}</div>
    <small>第一章 · 有人等你回来</small><h2 id="story-title">{chapter.title}</h2>
    <div className={styles.line}><strong>{line.speaker}</strong><p>{line.text}</p></div>
    {reading.line < chapter.lines.length - 1 ? <button className={styles.primary} disabled={disabled} onClick={() => void send({ type: 'story-next', chapterId: chapter.id, line: reading.line })}>继续</button>
      : <div className={styles.choices}>{chapter.choices.map(choice => <button key={choice.id} disabled={disabled} onClick={() => void send({ type: 'story-choice', chapterId: chapter.id, choiceId: choice.id })}>{choice.text}</button>)}</div>}
    <p role="status" className={styles.notice}>{notice}</p>
  </section>
}
