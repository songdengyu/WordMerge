import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useGameStore } from '../store/useGameStore'
import { MAX_DEPLOYED, getHeroSkillBookCost } from '../data/heroes'
import { getDeployedHeroIds, isHeroDeployed } from '../utils/platformLayout'
import { formatSkillDescription } from '../data/skillConfig'
import { EquipmentArt } from './EquipmentArt'
import { SkillBookWallet } from './SkillBookWallet'
import styles from './HeroPanel.module.css'

export function HeroPanel() {
  const { state, totalDps, mainHeroDps, skillBookCount, deployHero, withdrawHero, upgradeHero, buyEquipment } = useGameStore()
  const [detail, setDetail] = useState<{ itemId: number; heroId: string } | null>(null)
  const [justUnlockedLevel, setJustUnlockedLevel] = useState<number | null>(null)
  const [fx, setFx] = useState<{ id: string; type: 'upgrade' | 'deploy'; at: number } | null>(null)
  const deployedIds = getDeployedHeroIds(state.deployedSlots)
  const companions = state.equipmentCatalog.filter((item) => item.type === 9)
  const detailItem = detail ? state.equipmentCatalog.find((item) => item.id === detail.itemId) : null
  const detailHero = detail ? state.heroes.find((hero) => hero.id === detail.heroId) : null
  const detailOwned = detailItem ? (state.ownedEquipment[detailItem.id] ?? 0) > 0 : false
  const detailUpgradeCost = detailHero ? getHeroSkillBookCost(detailHero.level) : 0
  const canUpgradeDetail = Boolean(
    detailOwned && detailHero && skillBookCount >= detailUpgradeCost,
  )

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.dpsLabel}>总 DPS: <strong>{Math.floor(totalDps)}</strong><span className={styles.mainDps}>主角 {Math.floor(mainHeroDps)} + 队友 {Math.floor(totalDps - mainHeroDps)}</span></span>
        <div className={styles.headerTools}>
          <SkillBookWallet />
          <span className={styles.deployCount}>上阵 {deployedIds.length}/{MAX_DEPLOYED}</span>
        </div>
      </div>
      <div className={`${styles.list} scroll-touch`}>
        {companions.map((item, index) => {
          const hero = state.heroes[index]
          if (!hero) return null
          const owned = (state.ownedEquipment[item.id] ?? 0) > 0
          const deployed = isHeroDeployed(state.deployedSlots, hero.id)
          const canBuy = item.diamond !== null && state.diamonds >= item.diamond
          const upgradeCost = getHeroSkillBookCost(hero.level)
          const canUpgrade = owned && skillBookCount >= upgradeCost
          return (
            <article
              key={item.id}
              className={`${styles.companion} ${deployed ? styles.deployed : ''} ${!owned ? (canBuy ? styles.affordable : styles.locked) : ''} ${fx?.id === hero.id && fx.type === 'deploy' ? styles.deployPulse : ''}`}
              onClick={() => {
                setDetail({ itemId: item.id, heroId: hero.id })
                setJustUnlockedLevel(null)
              }}
            >
              {fx?.id === hero.id && (
                <span
                  key={fx.at}
                  className={`${fx.type === 'deploy' ? `${styles.cardBurst} ${styles.fxGreen}` : `${styles.fxSweep} ${styles.fxGold}`}`}
                  aria-hidden
                />
              )}
              <EquipmentArt item={item} size="sm" />
              <div className={styles.companionInfo}>
                <strong>{item.name}</strong><span>{owned ? `Lv.${hero.level}` : '未解锁'}</span>
                <p>{item.description}</p>
              </div>
              <div className={styles.actions}>
                {owned ? (
                  <>
                    <button
                      type="button"
                      className={`${deployed ? styles.withdraw : styles.deploy} ${fx?.id === hero.id && fx.type === 'deploy' ? styles.flashPress : ''}`}
                      onClick={(event) => {
                        event.stopPropagation()
                        if (!deployed) setFx({ id: hero.id, type: 'deploy', at: Date.now() })
                        deployed ? withdrawHero(hero.id) : deployHero(hero.id)
                      }}
                    >
                      {fx?.id === hero.id && fx.type === 'deploy' && (
                        <span key={fx.at} className={`${styles.fxBurst} ${styles.fxGreen}`} aria-hidden />
                      )}
                      {deployed ? '下阵' : '上阵'}
                    </button>
                    <button
                      type="button"
                      className={canUpgrade ? styles.upgrade : ''}
                      disabled={!canUpgrade}
                      onClick={(event) => {
                        event.stopPropagation()
                        setFx({ id: hero.id, type: 'upgrade', at: Date.now() })
                        upgradeHero(hero.id)
                      }}
                    >
                      {fx?.id === hero.id && fx.type === 'upgrade' && (
                        <span key={fx.at} className={`${styles.fxSweep} ${styles.fxGold}`} aria-hidden />
                      )}
                      升级<br /><b>▤ {upgradeCost}</b>
                    </button>
                  </>
                ) : (
                  <button type="button" className={canBuy ? styles.canBuy : ''} disabled={item.diamond === null || !canBuy} onClick={(event) => { event.stopPropagation(); buyEquipment(item.id) }}>
                    {item.diamond === null ? '仅合成产出' : <>钻石购买<br /><b>◆ {item.diamond}</b></>}
                  </button>
                )}
              </div>
            </article>
          )
        })}
      </div>
      {detailItem && detailHero && createPortal(
        <div className={styles.skillOverlay} onClick={() => setDetail(null)}>
          <section className={styles.skillDialog} onClick={(event) => event.stopPropagation()}>
            <button type="button" className={styles.dialogClose} onClick={() => setDetail(null)}>×</button>
            <div className={styles.dialogHero}>
              <EquipmentArt item={detailItem} size="lg" />
              <div><h3>{detailItem.name}</h3><span>Lv.{detailHero.level} · 被动技能</span></div>
            </div>
            <div className={`${styles.skillList} scroll-touch`}>
              {state.skillCatalog
                .filter((skill) => skill.ownerId === detailItem.id)
                .sort((a, b) => a.unlockLevel - b.unlockLevel)
                .map((skill) => {
                  const unlocked = detailHero.level >= skill.unlockLevel
                  return (
                    <article
                      key={skill.id}
                      className={`${styles.passiveSkill} ${unlocked ? '' : styles.passiveLocked} ${skill.unlockLevel === justUnlockedLevel ? styles.justUnlocked : ''}`}
                    >
                      <span className={styles.passiveLevel}>Lv.{skill.unlockLevel}</span>
                      <div><strong>{skill.name}</strong><p>{unlocked ? formatSkillDescription(skill, 1) : `角色达到 Lv.${skill.unlockLevel} 自动解锁`}</p></div>
                      <b>{unlocked ? '已生效' : '未解锁'}</b>
                    </article>
                  )
                })}
            </div>
            <footer className={styles.dialogFooter}>
              <span>持有技能书 <strong>▤ {skillBookCount}</strong></span>
              <button
                type="button"
                disabled={!canUpgradeDetail}
                onClick={() => {
                  setJustUnlockedLevel(detailHero.level + 1)
                  setFx({ id: detailHero.id, type: 'upgrade', at: Date.now() })
                  upgradeHero(detailHero.id)
                }}
              >
                {fx?.id === detailHero.id && fx.type === 'upgrade' && (
                  <span key={fx.at} className={`${styles.fxSweep} ${styles.fxGold}`} aria-hidden />
                )}
                {detailOwned ? <>升级至 Lv.{detailHero.level + 1}<b>▤ {detailUpgradeCost}</b></> : '需先解锁英雄'}
              </button>
            </footer>
          </section>
        </div>,
        document.body,
      )}
    </div>
  )
}
