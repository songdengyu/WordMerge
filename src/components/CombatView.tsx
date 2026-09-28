import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { QUALITY_COLORS } from '../data/weapons'
import { getHeroAttackInterval, HERO_ATTACK_INTERVAL_SCALE } from '../data/heroes'
import { getDeployedHeroIds } from '../utils/platformLayout'
import { MAIN_HERO_SKILL_OWNER_ID, getMainSkillLevel, type SkillConfig } from '../data/skillConfig'
import { useCombatEffects } from '../hooks/useCombatEffects'
import { useGameStore } from '../store/useGameStore'
import { CombatEffectsLayer } from './CombatEffectsLayer'
import { CharacterAvatar } from './CharacterAvatar'
import { HealthBar } from './HealthBar'
import { HeroPlatforms } from './HeroPlatforms'
import { MonsterSprite } from './MonsterSprite'
import { ArtIcon } from './ArtIcon'
import styles from './CombatView.module.css'

interface CoinDrop {
  id: number
  fromX: number
  fromY: number
  toX: number
  toY: number
  delay: number
}

export function CombatView() {
  const {
    state,
    mainHeroDps,
    equippedWeapon,
    mainFireInterval,
    completeMonsterDeath,
    completeMonsterSpawn,
    toggleAutoBattle,
    attackWithMainHero,
    attackWithHero,
    addTestResource,
    challengeBoss,
    retreatBoss,
  } = useGameStore()
  const {
    mainHero,
    monster,
    killCount,
    isBoss,
    bossTimer,
    gold,
    diamonds,
    goldFlash,
    monsterHit,
    deployedSlots,
    monsterPhase,
    combatGraceRemaining,
    heroes,
  } = state

  const combatActive =
    state.secondaryView === null &&
    !state.showBossFailModal &&
    monsterPhase === 'fighting' &&
    combatGraceRemaining <= 0

  const combatRef = useRef<HTMLDivElement>(null)
  const arenaRef = useRef<HTMLDivElement>(null)
  const monsterRef = useRef<HTMLDivElement>(null)
  const mainHeroRef = useRef<HTMLDivElement>(null)
  const goldRef = useRef<HTMLButtonElement>(null)
  const [coinDrops, setCoinDrops] = useState<CoinDrop[]>([])

  const {
    bullets,
    popups,
    fireBullet,
    showDamage,
    skillEffects,
    showSkillEffect,
    removeBullet,
    removePopup,
    removeSkillEffect,
  } = useCombatEffects()

  useEffect(() => {
    if (!state.goldDropId) return
    const combat = combatRef.current
    const monsterEl = monsterRef.current
    const goldEl = goldRef.current
    if (!combat || !monsterEl || !goldEl) return

    const root = combat.getBoundingClientRect()
    const source = monsterEl.getBoundingClientRect()
    const target = goldEl.getBoundingClientRect()
    const fromX = source.left + source.width / 2 - root.left
    const fromY = source.top + source.height / 2 - root.top
    const toX = target.left + target.width / 2 - root.left
    const toY = target.top + target.height / 2 - root.top
    const count = Math.min(6, Math.max(3, Math.ceil(state.goldDropAmount / 10)))

    setCoinDrops(Array.from({ length: count }, (_, index) => ({
      id: state.goldDropId * 10 + index,
      fromX,
      fromY,
      toX,
      toY,
      delay: index * 70,
    })))

    const timer = setTimeout(() => setCoinDrops([]), 1300)
    return () => clearTimeout(timer)
  }, [state.goldDropAmount, state.goldDropId])

  const getSourceEl = useCallback((sourceId: string) => {
    const arena = arenaRef.current
    if (!arena) return null
    if (sourceId === 'main') return mainHeroRef.current
    return arena.querySelector<HTMLElement>(`[data-combat-source="${sourceId}"]`)
  }, [])

  const shootFrom = useCallback(
    (sourceId: string) => {
      if (!combatActive) return
      const arena = arenaRef.current
      const monsterEl = monsterRef.current
      const sourceEl = getSourceEl(sourceId)
      if (!arena || !monsterEl || !sourceEl) return
      const qualityColor = QUALITY_COLORS[equippedWeapon.quality]
      fireBullet(
        arena,
        sourceEl,
        monsterEl,
        sourceId,
        undefined,
        sourceId === 'main' ? qualityColor : undefined,
      )
    },
    [combatActive, fireBullet, getSourceEl, equippedWeapon],
  )

  const showDamageOnMonster = useCallback(
    (amount: number, isMain: boolean) => {
      if (!combatActive) return
      const arena = arenaRef.current
      const monsterEl = monsterRef.current
      if (!arena || !monsterEl || amount <= 0) return
      showDamage(arena, monsterEl, amount, isMain)
    },
    [combatActive, showDamage],
  )

  const fireHeroAttack = useCallback((heroId: string) => {
    if (!combatActive) return
    shootFrom(heroId)
    const result = attackWithHero(heroId)
    showDamageOnMonster(result.damage, false)
  }, [attackWithHero, combatActive, shootFrom, showDamageOnMonster])
  const fireHeroAttackRef = useRef(fireHeroAttack)
  useEffect(() => {
    fireHeroAttackRef.current = fireHeroAttack
  }, [fireHeroAttack])

  const mainSkills = useMemo(
    () => state.skillCatalog.filter((skill) => skill.ownerId === MAIN_HERO_SKILL_OWNER_ID),
    [state.skillCatalog],
  )
  const basicSkill = useMemo(() => mainSkills.find((skill) => skill.type === 1), [mainSkills])
  const activeSkills = useMemo(
    () => mainSkills.filter(
      (skill) => skill.type === 2 && (state.skillLevels[skill.id] ?? 0) > 0 && skill.cooldownSeconds > 0,
    ),
    [mainSkills, state.skillLevels],
  )

  const castSkill = useCallback((skill: SkillConfig) => {
    if (!combatActive) return
    if (getMainSkillLevel(skill, state.skillLevels) <= 0) return
    const arena = arenaRef.current
    const monsterEl = monsterRef.current
    if (!arena || !monsterEl) return

    if (skill.type === 1) shootFrom('main')
    else showSkillEffect(arena, monsterEl, skill)
    const result = attackWithMainHero(skill.id)
    showDamageOnMonster(result.damage, true)
  }, [attackWithMainHero, combatActive, shootFrom, showDamageOnMonster, showSkillEffect, state.skillLevels])
  const castSkillRef = useRef(castSkill)
  useEffect(() => {
    castSkillRef.current = castSkill
  }, [castSkill])

  useEffect(() => {
    if (!combatActive || !state.autoBattle || !basicSkill || getMainSkillLevel(basicSkill, state.skillLevels) <= 0) return
    const interval = setInterval(() => castSkillRef.current(basicSkill), mainFireInterval)
    return () => clearInterval(interval)
  }, [basicSkill, mainFireInterval, combatActive, state.autoBattle, state.skillLevels])

  useEffect(() => {
    if (!state.autoBattle) return
    const intervals = activeSkills.map((skill) => setInterval(
      () => castSkillRef.current(skill),
      skill.cooldownSeconds * 1000,
    ))
    return () => intervals.forEach(clearInterval)
  }, [activeSkills, state.autoBattle])

  const wasCombatActiveRef = useRef(combatActive)
  useEffect(() => {
    if (combatActive && !wasCombatActiveRef.current) {
      if (state.autoBattle && basicSkill) castSkill(basicSkill)
      getDeployedHeroIds(deployedSlots).forEach((id) => fireHeroAttackRef.current(id))
    }
    wasCombatActiveRef.current = combatActive
  }, [basicSkill, castSkill, combatActive, deployedSlots, state.autoBattle])

  useEffect(() => {
    if (!combatActive || !deployedSlots.some(Boolean)) return

    const intervals = getDeployedHeroIds(deployedSlots).map((heroId) => {
      const hero = heroes.find((h) => h.id === heroId)
      const ms = hero
        ? hero.attackInterval * HERO_ATTACK_INTERVAL_SCALE
        : getHeroAttackInterval(heroId)
      return setInterval(() => fireHeroAttackRef.current(heroId), ms)
    })

    return () => intervals.forEach(clearInterval)
  }, [deployedSlots, combatActive, heroes])

  const handleManualAttack = useCallback(() => {
    if (!combatActive || state.autoBattle || !basicSkill) return
    castSkill(basicSkill)
  }, [basicSkill, castSkill, combatActive, state.autoBattle])

  const handleArenaTap = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!combatActive || state.autoBattle) return
      const target = event.target as HTMLElement
      if (target.closest('button')) return
      if (target.closest('[data-no-tap-attack]')) return
      handleManualAttack()
    },
    [combatActive, handleManualAttack, state.autoBattle],
  )


  return (
    <div
      className={`${styles.combat} ${!state.autoBattle && combatActive ? styles.combatTap : ''}`}
      ref={combatRef}
      onClick={handleArenaTap}
    >
      <div className={styles.skyTop} />
      <div className={styles.skyGlow} />
      <div className={styles.mountains} />
      <div className={styles.castle} />
      <div className={styles.ground} />
      <div className={styles.groundTexture} />

      <div className={styles.battleZone}>
        <div className={styles.hud}>
          <HealthBar
            name={monster.name}
            currentHp={monster.currentHp}
            maxHp={monster.maxHp}
            isBoss={isBoss}
            bossTimer={monster.hasTimeLimit ? bossTimer : undefined}
          />
          <div className={styles.statusRow}>
            {isBoss || state.bossFailed ? (
              <button
                type="button"
                className={styles.bossBtn}
                onClick={isBoss ? retreatBoss : challengeBoss}
              >
                {isBoss ? '暂时撤退' : '挑战 Boss'}
              </button>
            ) : (
              <span className={styles.progress}>{killCount}/9</span>
            )}
            <span className={styles.stage}>第 {state.stage} 关</span>
            <span className={styles.currencies}>
              <button
                ref={goldRef}
                type="button"
                className={`${styles.gold} ${goldFlash ? styles.goldFlash : ''}`}
                title="测试：点击增加 1000 金币"
                onClick={() => addTestResource('gold')}
              >
                <ArtIcon sheet="ui" name="coin" className={styles.coinIcon} /> {gold}
              </button>
              <button
                type="button"
                className={styles.diamonds}
                title="测试：点击增加 1000 钻石"
                onClick={() => addTestResource('diamonds')}
              >
                ◆ {diamonds}
              </button>
            </span>
          </div>
        </div>

        <div className={styles.arena} ref={arenaRef}>
          <CombatEffectsLayer
            bullets={bullets}
            popups={popups}
            skillEffects={skillEffects}
            onBulletEnd={removeBullet}
            onPopupEnd={removePopup}
            onSkillEffectEnd={removeSkillEffect}
          />
          <div className={styles.battlefield}>
            <HeroPlatforms />
            <div className={styles.monsterArea}>
              <MonsterSprite
                ref={monsterRef}
                name={monster.name}
                isBoss={isBoss}
                hit={monsterHit}
                phase={monsterPhase}
                onDeathComplete={completeMonsterDeath}
                onSpawnComplete={completeMonsterSpawn}
              />
              <div className={styles.heroRow}>
                <div ref={mainHeroRef} className={styles.heroWrap} data-combat-source="main">
                  <CharacterAvatar role={mainHero.role} size="lg" />
                  <span className={styles.heroDps}>{Math.floor(mainHeroDps)} DPS</span>
                </div>
                <button
                  type="button"
                  className={`${styles.autoBattleBtn} ${state.autoBattle ? styles.autoBattleOn : ''}`}
                  onClick={toggleAutoBattle}
                  aria-pressed={state.autoBattle}
                >
                  <span className={styles.autoBattleDot} />
                  <span>自动战斗</span>
                  <strong>{state.autoBattle ? '开' : '关'}</strong>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className={styles.coinDropLayer}>
        {coinDrops.map((coin) => {
          const dx = coin.toX - coin.fromX
          const dy = coin.toY - coin.fromY
          return (
            <span
              key={coin.id}
              className={styles.coinDrop}
              style={{
                left: coin.fromX,
                top: coin.fromY,
                '--coin-x': `${dx}px`,
                '--coin-y': `${dy}px`,
                '--coin-mid-x': `${dx * 0.55}px`,
                '--coin-mid-y': `${dy * 0.42 - 36}px`,
                animationDelay: `${coin.delay}ms`,
              } as CSSProperties}
            >
              <ArtIcon sheet="ui" name="coin" />
            </span>
          )
        })}
      </div>
    </div>
  )
}
