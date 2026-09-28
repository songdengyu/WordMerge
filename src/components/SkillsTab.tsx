import { useState } from 'react'
import {
  MAIN_HERO_SKILL_OWNER_ID,
  formatSkillDescription,
  formatSkillValue,
  getMainSkillLevel,
  type SkillConfig,
} from '../data/skillConfig'
import { useGameStore } from '../store/useGameStore'
import { SkillBookWallet } from './SkillBookWallet'
import styles from './SkillsTab.module.css'

export function SkillsTab() {
  const { state, skillBookCount, upgradeSkill } = useGameStore()
  const [selected, setSelected] = useState<SkillConfig | null>(null)
  const [fx, setFx] = useState<{ id: number; unlock: boolean; at: number } | null>(null)
  const skills = state.skillCatalog.filter((skill) => skill.ownerId === MAIN_HERO_SKILL_OWNER_ID)
  const selectedLevel = selected ? getMainSkillLevel(selected, state.skillLevels) : 0

  return (
    <div className={styles.tab}>
      <header className={styles.header}>
        <div><span className={styles.eyebrow}>勇者战技</span><h2>技能秘典</h2></div>
        <SkillBookWallet />
      </header>
      <p className={styles.guide}>使用技能书解锁和升级主角技能。普攻按攻击间隔释放，主动技能按各自冷却时间自动释放。</p>
      {state.skillConfigError && <p className={styles.error}>技能配置加载失败：{state.skillConfigError}</p>}
      <div className={`${styles.list} scroll-touch`}>
        {skills.map((skill) => {
          const level = getMainSkillLevel(skill, state.skillLevels)
          const canUpgrade = skill.upgradeCost > 0 && skillBookCount >= skill.upgradeCost
          const displayLevel = Math.max(1, level)
          return (
            <article
              key={skill.id}
              className={`${styles.skillCard} ${level === 0 ? styles.locked : ''} ${canUpgrade ? (level === 0 ? styles.unlockable : styles.affordable) : ''}`}
              onClick={() => setSelected(skill)}
            >
              {fx?.id === skill.id && (
                <span
                  key={fx.at}
                  className={`${fx.unlock ? styles.cardBurst : styles.fxSweep} ${fx.unlock ? styles.fxCyan : styles.fxGold}`}
                  aria-hidden
                />
              )}
              <div className={`${styles.skillIcon} ${styles[`type${skill.type}`]}`}>{skill.type === 1 ? '†' : skill.type === 2 ? '✦' : '◆'}</div>
              <div className={styles.skillInfo}>
                <div className={styles.skillTitle}><strong>{skill.name}</strong><span>{level > 0 ? `Lv.${level}` : '未解锁'}</span></div>
                <p>{formatSkillDescription(skill, displayLevel)}</p>
                <div className={styles.damage}>
                  {skill.type === 1 ? '普攻' : skill.type === 2 ? `主动 · CD ${skill.cooldownSeconds}秒` : '被动'}
                  {level > 0 && skill.perLevelIncrease > 0 && <span>下级 {formatSkillValue(skill, level + 1)}</span>}
                </div>
              </div>
              <button
                type="button"
                className={`${styles.actionBtn} ${level === 0 ? styles.unlock : styles.upgrade} ${canUpgrade ? styles.ready : ''} ${fx?.id === skill.id && fx.unlock ? styles.flashPress : ''}`}
                disabled={!canUpgrade}
                onClick={(event) => {
                  event.stopPropagation()
                  setFx({ id: skill.id, unlock: level === 0, at: Date.now() })
                  upgradeSkill(skill.id)
                }}
              >
                {fx?.id === skill.id && (
                  <span
                    key={fx.at}
                    className={`${fx.unlock ? styles.fxBurst : styles.fxSweep} ${fx.unlock ? styles.fxCyan : styles.fxGold}`}
                    aria-hidden
                  />
                )}
                <span>{level === 0 ? '解锁' : '升级'}</span>
                <strong>▤ {skill.upgradeCost}</strong>
              </button>
            </article>
          )
        })}
      </div>
      {selected && (
        <div className={styles.detailOverlay} onClick={() => setSelected(null)}>
          <section className={styles.detail} onClick={(event) => event.stopPropagation()}>
            <button type="button" className={styles.closeBtn} onClick={() => setSelected(null)}>×</button>
            <div className={`${styles.skillIcon} ${styles.detailIcon}`}>{selected.type === 1 ? '†' : selected.type === 2 ? '✦' : '◆'}</div>
            <h3>{selected.name}</h3>
            <p>{formatSkillDescription(selected, Math.max(1, selectedLevel))}</p>
            <div className={styles.detailStats}>
              <span>类型<b>{selected.type === 1 ? '普攻' : selected.type === 2 ? '主动技能' : '被动技能'}</b></span>
              <span>等级<b>{selectedLevel ? `Lv.${selectedLevel}` : '未解锁'}</b></span>
              <span>冷却<b>{selected.cooldownSeconds > 0 ? `${selected.cooldownSeconds} 秒` : '无'}</b></span>
              <span>升级消耗<b>▤ {selected.upgradeCost}</b></span>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
