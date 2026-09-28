import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  useRef,
  useEffect,
  type ReactNode,
} from 'react'
import {
  getEquipmentConfigPower,
  getEquipmentDismantleGold,
  loadEquipmentConfig,
  type EquipmentConfig,
} from '../data/equipmentConfig'
import { HERO_ATTACK_INTERVAL_SCALE, INITIAL_HEROES, getHeroSkillBookCost, type Hero } from '../data/heroes'
import {
  createEmptyDeployedSlots,
  findFirstEmptySlot,
  getDeployedHeroIds,
  isHeroDeployed,
} from '../utils/platformLayout'
import { INITIAL_MAIN_HERO, type MainHero } from '../data/mainHero'
import { applyPassiveSkills, calculateExpectedDamage, rollDamage, sumEquipmentStats, type CombatStats } from '../data/combatStats'
import { createMonster } from '../data/monsters'
import { loadMonsterConfig, type MonsterConfig } from '../data/monsterConfig'
import { COMBAT_RESUME_GRACE_SEC } from '../data/combat'
import type { MergeGameState } from '../data/mergeGame'
import {
  MAIN_HERO_SKILL_OWNER_ID,
  getMainSkillLevel,
  getSkillValue,
  loadSkillConfig,
  unlockBasicSkills,
  type SkillConfig,
} from '../data/skillConfig'
import {
  EQUIPPED_WEAPON_DEFAULT,
  INITIAL_EQUIPPED_WEAPON_ID,
  INITIAL_WEAPON_INVENTORY,
  getWeaponUpgradeCost,
  getWeaponPower,
  WEAPON_CATALOG,
  type Weapon,
} from '../data/weapons'

export type ActiveTab = 'equipment' | 'skills' | 'heroes'
export type SecondaryView = null | 'weapon' | 'equipment' | 'merge'

export interface MonsterState {
  id: number
  name: string
  maxHp: number
  currentHp: number
  goldReward: number
  hasTimeLimit: boolean
  timeLimit: number | null
}

export type MonsterPhase = 'fighting' | 'dying' | 'spawning'

const MONSTER_HIT_EFFECT_INTERVAL_SEC = 0.35

export interface PendingMonsterTransition {
  stage: number
  killCount: number
  isBoss: boolean
  bossFailed: boolean
  bossTimer: number
  monster: MonsterState
  toast: string | null
}

export interface GameState {
  stage: number
  killCount: number
  isBoss: boolean
  bossTimer: number
  bossFailed: boolean
  monster: MonsterState
  monsterPhase: MonsterPhase
  pendingTransition: PendingMonsterTransition | null
  combatGraceRemaining: number
  gold: number
  diamonds: number
  equipmentCatalog: EquipmentConfig[]
  equipmentConfigError: string | null
  monsterCatalog: MonsterConfig[]
  monsterConfigError: string | null
  skillCatalog: SkillConfig[]
  skillConfigError: string | null
  ownedEquipment: Record<number, number>
  equippedEquipment: Record<number, number | null>
  newEquipmentIds: number[]
  mainHero: MainHero
  heroes: Hero[]
  deployedSlots: (string | null)[]
  toast: string | null
  showBossFailModal: boolean
  goldFlash: boolean
  goldDropId: number
  goldDropAmount: number
  skillLevels: Record<number, number>
  monsterHit: boolean
  monsterHitCooldown: number
  autoBattle: boolean
  activeTab: ActiveTab
  tabPanelOpen: boolean
  secondaryView: SecondaryView
  showHeroOverlay: boolean
  equippedWeaponId: string
  equippedWeapon: Weapon
  weaponInventory: Weapon[]
  selectedWeaponId: string | null
  equipmentPickerType: number | null
  selectedEquipmentId: number | null
  dialog: DialogConfig | null
  mergeSnapshot: MergeGameState | null
}

export interface DialogConfig {
  title: string
  message: string
  confirmText?: string
  cancelText?: string | null
}

type GameAction =
  | { type: 'TICK'; deltaSeconds: number }
  | { type: 'DEPLOY_HERO'; heroId: string }
  | { type: 'WITHDRAW_HERO'; heroId: string }
  | { type: 'CHALLENGE_BOSS' }
  | { type: 'RETREAT_BOSS' }
  | { type: 'DISMISS_BOSS_FAIL' }
  | { type: 'CLEAR_TOAST' }
  | { type: 'CLEAR_HIT' }
  | { type: 'CLEAR_GOLD_FLASH' }
  | { type: 'TOGGLE_AUTO_BATTLE' }
  | { type: 'MAIN_HERO_ATTACK'; damage: number }
  | { type: 'UPGRADE_SKILL'; skillId: number }
  | { type: 'UPGRADE_HERO'; heroId: string }
  | { type: 'UPGRADE_WEAPON'; weaponId: string }
  | { type: 'EXCHANGE_SKILL_BOOKS'; diamondCost: number; quantity: number }
  | { type: 'ADD_TEST_RESOURCE'; resource: 'gold' | 'diamonds' | 'skillBooks' }
  | { type: 'SET_ACTIVE_TAB'; tab: ActiveTab }
  | { type: 'CLOSE_TAB_PANEL' }
  | { type: 'OPEN_WEAPON_PICKER' }
  | { type: 'OPEN_MERGE_VIEW' }
  | { type: 'OPEN_EQUIPMENT_PICKER'; equipmentType: number }
  | { type: 'CLOSE_SECONDARY_VIEW' }
  | { type: 'OPEN_HERO_OVERLAY' }
  | { type: 'CLOSE_HERO_OVERLAY' }
  | { type: 'SELECT_WEAPON'; weaponId: string }
  | { type: 'EQUIP_WEAPON'; weaponId: string }
  | { type: 'SHOW_TOAST'; message: string }
  | { type: 'SHOW_DIALOG'; dialog: DialogConfig }
  | { type: 'MONSTER_DEATH_COMPLETE' }
  | { type: 'MONSTER_SPAWN_COMPLETE' }
  | { type: 'HIDE_DIALOG' }
  | { type: 'LOAD_EQUIPMENT'; equipment: EquipmentConfig[] }
  | { type: 'EQUIPMENT_CONFIG_ERROR'; message: string }
  | { type: 'LOAD_MONSTERS'; monsters: MonsterConfig[] }
  | { type: 'MONSTER_CONFIG_ERROR'; message: string }
  | { type: 'LOAD_SKILLS'; skills: SkillConfig[] }
  | { type: 'SKILL_CONFIG_ERROR'; message: string }
  | { type: 'SYNC_MERGE_RESOURCES'; gold: number; diamonds: number }
  | { type: 'GRANT_EQUIPMENT'; item: EquipmentConfig; quantity: number }
  | { type: 'BUY_EQUIPMENT'; item: EquipmentConfig }
  | { type: 'SELECT_EQUIPMENT'; equipmentId: number }
  | { type: 'EQUIP_EQUIPMENT'; equipmentId: number; dismantlePrevious?: boolean; dismantleGold?: number }
  | { type: 'DISMANTLE_EQUIPMENT'; equipmentId: number; gold: number }
  | { type: 'SAVE_MERGE_SNAPSHOT'; snapshot: MergeGameState }

const initialMonster = createMonster(1, 0, false)

const initialState: GameState = {
  stage: 1,
  killCount: 0,
  isBoss: false,
  bossTimer: 30,
  bossFailed: false,
  monster: initialMonster,
  monsterPhase: 'fighting',
  pendingTransition: null,
  combatGraceRemaining: 0,
  gold: 2000,
  diamonds: 5000,
  equipmentCatalog: [],
  equipmentConfigError: null,
  monsterCatalog: [],
  monsterConfigError: null,
  skillCatalog: [],
  skillConfigError: null,
  ownedEquipment: { 100010001: 1, 100020001: 1 },
  equippedEquipment: { 1: 100010001, 2: null, 3: null, 4: null, 5: null, 6: null, 7: null },
  newEquipmentIds: [],
  mainHero: INITIAL_MAIN_HERO,
  heroes: INITIAL_HEROES.map((hero) => ({ ...hero, level: 0 })),
  deployedSlots: createEmptyDeployedSlots(),
  toast: null,
  showBossFailModal: false,
  goldFlash: false,
  goldDropId: 0,
  goldDropAmount: 0,
  skillLevels: {},
  monsterHit: false,
  monsterHitCooldown: 0,
  autoBattle: false,
  activeTab: 'equipment',
  tabPanelOpen: true,
  secondaryView: null,
  showHeroOverlay: false,
  equippedWeaponId: INITIAL_EQUIPPED_WEAPON_ID,
  equippedWeapon: EQUIPPED_WEAPON_DEFAULT,
  weaponInventory: INITIAL_WEAPON_INVENTORY,
  selectedWeaponId: null,
  equipmentPickerType: null,
  selectedEquipmentId: null,
  dialog: null,
  mergeSnapshot: null,
}

function remapMonsterHp(current: MonsterState, configured: MonsterState): MonsterState {
  if (current.currentHp <= 0) return { ...configured, currentHp: 0 }
  const ratio = current.maxHp > 0 ? current.currentHp / current.maxHp : 1
  return {
    ...configured,
    currentHp: Math.min(configured.maxHp, Math.max(1, Math.round(configured.maxHp * ratio))),
  }
}

function applyMonsterCatalog(state: GameState, catalog: MonsterConfig[]): GameState {
  const pending = state.pendingTransition
  return {
    ...state,
    monsterCatalog: catalog,
    monsterConfigError: null,
    monster: remapMonsterHp(
      state.monster,
      createMonster(state.stage, state.killCount, state.isBoss, catalog),
    ),
    pendingTransition: pending
      ? {
        ...pending,
        monster: remapMonsterHp(
          pending.monster,
          createMonster(pending.stage, pending.killCount, pending.isBoss, catalog),
        ),
      }
      : null,
  }
}

function getEquippedCombatItems(state: GameState): EquipmentConfig[] {
  return Object.values(state.equippedEquipment)
    .map((id) => state.equipmentCatalog.find((item) => item.id === id))
    .filter((item): item is EquipmentConfig => item !== undefined)
}

function getMainHeroStats(state: GameState): CombatStats {
  const passives = state.skillCatalog
    .filter((skill) => skill.ownerId === MAIN_HERO_SKILL_OWNER_ID && skill.type === 3)
    .map((skill) => ({ skill, level: state.skillLevels[skill.id] ?? 0 }))
  return applyPassiveSkills(sumEquipmentStats(getEquippedCombatItems(state)), passives)
}

function getHeroStats(state: GameState, heroIndex: number): CombatStats {
  const item = state.equipmentCatalog.find((entry) => entry.id === 100030001 + heroIndex)
  const hero = state.heroes[heroIndex]
  if (!item || !hero) return sumEquipmentStats([])
  const passives = state.skillCatalog
    .filter((skill) => skill.ownerId === item.id && skill.type === 3 && skill.unlockLevel <= hero.level)
    .map((skill) => ({ skill, level: 1 }))
  return applyPassiveSkills(sumEquipmentStats([item]), passives)
}

function getMainHeroExpectedDamage(state: GameState): number {
  const stats = getMainHeroStats(state)
  return state.skillCatalog
    .filter((skill) => skill.ownerId === MAIN_HERO_SKILL_OWNER_ID && skill.type !== 3)
    .reduce((dps, skill) => {
      const level = getMainSkillLevel(skill, state.skillLevels)
      if (level <= 0 || skill.cooldownSeconds <= 0) return dps
      const interval = skill.type === 1
        ? skill.cooldownSeconds / state.equippedWeapon.attackSpeed
        : skill.cooldownSeconds
      return dps + calculateExpectedDamage(stats, getSkillValue(skill, level), skill.type === 2) / interval
    }, 0)
}

function getHeroDpsForIndex(state: GameState, heroIndex: number): number {
  const hero = state.heroes[heroIndex]
  if (!hero || hero.level <= 0) return 0
  const attackSeconds = Math.max(0.1, hero.attackInterval * HERO_ATTACK_INTERVAL_SCALE / 1000)
  return calculateExpectedDamage(getHeroStats(state, heroIndex), 1, false) / attackSeconds
}

function getDeployedHeroesDps(state: GameState): number {
  return getDeployedHeroIds(state.deployedSlots).reduce((sum, id) => {
    const heroIndex = state.heroes.findIndex((hero) => hero.id === id)
    return sum + (heroIndex >= 0 ? getHeroDpsForIndex(state, heroIndex) : 0)
  }, 0)
}

function getTotalDps(state: GameState): number {
  return getMainHeroExpectedDamage(state) + getDeployedHeroesDps(state)
}

function getSkillBookIds(state: GameState): number[] {
  return state.equipmentCatalog
    .filter((item) => item.type === 8)
    .map((item) => item.id)
    .sort((a, b) => a - b)
}

function getSkillBookCount(state: GameState): number {
  return getSkillBookIds(state).reduce((sum, id) => sum + (state.ownedEquipment[id] ?? 0), 0)
}

function consumeSkillBooks(state: GameState, amount: number): Record<number, number> | null {
  if (getSkillBookCount(state) < amount) return null
  const owned = { ...state.ownedEquipment }
  let remaining = amount
  getSkillBookIds(state).forEach((id) => {
    if (remaining <= 0) return
    const used = Math.min(owned[id] ?? 0, remaining)
    if (used <= 0) return
    const next = owned[id] - used
    if (next > 0) owned[id] = next
    else delete owned[id]
    remaining -= used
  })
  return owned
}

function applyDamage(state: GameState, damage: number): GameState {
  if (state.monsterPhase !== 'fighting' || damage <= 0) return state

  const newHp = Math.max(0, state.monster.currentHp - damage)
  if (newHp > 0) {
    return {
      ...state,
      monster: { ...state.monster, currentHp: newHp },
    }
  }

  return startMonsterTransition({
    ...state,
    monster: { ...state.monster, currentHp: 0 },
  })
}

function computeNextAfterKill(state: GameState): PendingMonsterTransition & { gold: number } {
  const goldGain = state.monster.goldReward
  const gold = state.gold + goldGain

  if (state.isBoss) {
    return {
      gold,
      stage: state.stage + 1,
      killCount: 0,
      isBoss: false,
      bossFailed: false,
      bossTimer: 30,
      monster: createMonster(state.stage + 1, 0, false, state.monsterCatalog),
      toast: `击败 Boss！进入第 ${state.stage + 1} 关`,
    }
  }

  const newKillCount = state.killCount + 1

  if (newKillCount >= 9) {
    const boss = createMonster(state.stage, 9, true, state.monsterCatalog)
    return {
      gold,
      stage: state.stage,
      killCount: 9,
      isBoss: true,
      bossFailed: false,
      bossTimer: boss.timeLimit ?? 30,
      monster: boss,
      toast: boss.hasTimeLimit ? `Boss 出现！${boss.timeLimit ?? 30} 秒内击败它` : 'Boss 出现！',
    }
  }

  return {
    gold,
    stage: state.stage,
    killCount: newKillCount,
    isBoss: false,
    bossFailed: false,
    bossTimer: state.bossTimer,
    monster: createMonster(state.stage, newKillCount, false, state.monsterCatalog),
    toast: null,
  }
}

function startMonsterTransition(state: GameState): GameState {
  const next = computeNextAfterKill(state)
  const { gold, toast, ...pending } = next

  return {
    ...state,
    monsterPhase: 'dying',
    gold,
    goldFlash: true,
    goldDropId: state.goldDropId + 1,
    goldDropAmount: gold - state.gold,
    toast,
    pendingTransition: { ...pending, toast },
  }
}

function handleBossTimeout(state: GameState): GameState {
  return {
    ...state,
    isBoss: false,
    killCount: 0,
    bossFailed: false,
    bossTimer: 30,
    showBossFailModal: true,
    monster: createMonster(state.stage, 0, false, state.monsterCatalog),
    monsterPhase: 'spawning',
    pendingTransition: null,
  }
}

function deployHero(state: GameState, heroId: string): GameState {
  const hero = state.heroes.find((h) => h.id === heroId)
  if (!hero || hero.level <= 0) {
    return state
  }

  if (isHeroDeployed(state.deployedSlots, heroId)) {
    return state
  }

  const emptyIndex = findFirstEmptySlot(state.deployedSlots)
  if (emptyIndex >= 0) {
    const deployedSlots = [...state.deployedSlots]
    deployedSlots[emptyIndex] = heroId
    return {
      ...state,
      deployedSlots,
      toast: `${hero.name} 已上阵`,
    }
  }

  const deployedIds = getDeployedHeroIds(state.deployedSlots)
  const weakestId = deployedIds.reduce((weakest, id) => {
    const currentIndex = state.heroes.findIndex((h) => h.id === id)
    const weakestIndex = state.heroes.findIndex((h) => h.id === weakest)
    return getHeroDpsForIndex(state, currentIndex) < getHeroDpsForIndex(state, weakestIndex) ? id : weakest
  })

  const weakestHero = state.heroes.find((h) => h.id === weakestId)!
  const newDps = getHeroDpsForIndex(state, state.heroes.findIndex((item) => item.id === hero.id))
  const weakestDps = getHeroDpsForIndex(state, state.heroes.findIndex((item) => item.id === weakestHero.id))

  if (newDps <= weakestDps) {
    return { ...state, toast: 'DPS 不足，无法替换当前队员' }
  }

  const weakestIndex = state.deployedSlots.findIndex((id) => id === weakestId)
  const deployedSlots = [...state.deployedSlots]
  deployedSlots[weakestIndex] = heroId

  return {
    ...state,
    deployedSlots,
    toast: `${hero.name} 替换了 ${weakestHero.name}`,
  }
}

function clearNewFlag(inventory: Weapon[], weaponId: string): Weapon[] {
  return inventory.map((w) => (w.id === weaponId ? { ...w, isNew: false } : w))
}

function equipWeapon(state: GameState, weaponId: string): GameState {
  const weapon = state.weaponInventory.find((w) => w.id === weaponId)
  if (!weapon) return state

  const oldWeapon = { ...state.equippedWeapon, isNew: false }
  const newInventory = state.weaponInventory
    .filter((w) => w.id !== weaponId)
    .concat(oldWeapon)

  return {
    ...state,
    equippedWeaponId: weapon.id,
    equippedWeapon: { ...weapon, isNew: false },
    weaponInventory: newInventory,
    selectedWeaponId: null,
    toast: `已装备 ${weapon.name}`,
  }
}

function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case 'TICK': {
      if (state.secondaryView !== null || state.showBossFailModal || state.monsterPhase !== 'fighting') return state

      const hitCooldown = Math.max(0, state.monsterHitCooldown - action.deltaSeconds)

      if (state.combatGraceRemaining > 0) {
        return {
          ...state,
          combatGraceRemaining: Math.max(0, state.combatGraceRemaining - action.deltaSeconds),
          monsterHitCooldown: hitCooldown,
        }
      }

      let next = hitCooldown === state.monsterHitCooldown
        ? state
        : { ...state, monsterHitCooldown: hitCooldown }
      if (next.isBoss && next.monsterPhase === 'fighting') {
        const newTimer = next.bossTimer - action.deltaSeconds
        if (newTimer <= 0) return handleBossTimeout(next)
        next = { ...next, bossTimer: newTimer }
      }
      return next
    }

    case 'MONSTER_DEATH_COMPLETE': {
      if (state.monsterPhase !== 'dying' || !state.pendingTransition) return state
      const pending = state.pendingTransition
      return {
        ...state,
        monsterPhase: 'spawning',
        stage: pending.stage,
        killCount: pending.killCount,
        isBoss: pending.isBoss,
        bossFailed: pending.bossFailed,
        bossTimer: pending.bossTimer,
        monster: pending.monster,
        toast: pending.toast,
      }
    }

    case 'MONSTER_SPAWN_COMPLETE':
      if (state.monsterPhase !== 'spawning') return state
      return {
        ...state,
        monsterPhase: 'fighting',
        pendingTransition: null,
        combatGraceRemaining: COMBAT_RESUME_GRACE_SEC,
      }

    case 'DEPLOY_HERO':
      return deployHero(state, action.heroId)

    case 'WITHDRAW_HERO': {
      const slotIndex = state.deployedSlots.findIndex((id) => id === action.heroId)
      if (slotIndex < 0) return state
      const hero = state.heroes.find((h) => h.id === action.heroId)
      const deployedSlots = [...state.deployedSlots]
      deployedSlots[slotIndex] = null
      return {
        ...state,
        deployedSlots,
        toast: hero ? `${hero.name} 已下阵` : null,
      }
    }

    case 'CHALLENGE_BOSS':
      if (!state.bossFailed) return state
      return {
        ...state,
        isBoss: true,
        bossFailed: false,
        bossTimer: 30,
        monster: createMonster(state.stage, 9, true, state.monsterCatalog),
        monsterPhase: 'spawning',
        pendingTransition: null,
        toast: 'Boss 挑战开始！',
      }

    case 'RETREAT_BOSS':
      if (!state.isBoss) return state
      return {
        ...state,
        isBoss: false,
        killCount: 0,
        bossFailed: true,
        bossTimer: 30,
        monster: createMonster(state.stage, 0, false, state.monsterCatalog),
        monsterPhase: 'spawning',
        pendingTransition: null,
        toast: '已暂时撤退，可刷普通怪物或随时重返 Boss',
      }

    case 'DISMISS_BOSS_FAIL':
      return { ...state, showBossFailModal: false }

    case 'CLEAR_TOAST':
      return { ...state, toast: null }

    case 'CLEAR_HIT':
      return { ...state, monsterHit: false }

    case 'CLEAR_GOLD_FLASH':
      return { ...state, goldFlash: false }

    case 'TOGGLE_AUTO_BATTLE':
      return { ...state, autoBattle: !state.autoBattle }

    case 'MAIN_HERO_ATTACK':
      if (state.combatGraceRemaining > 0) return state
      {
        const next = applyDamage(state, action.damage)
        if (state.monsterHitCooldown > 0 || next.monsterPhase !== 'fighting') return next
        return {
          ...next,
          monsterHit: true,
          monsterHitCooldown: MONSTER_HIT_EFFECT_INTERVAL_SEC,
        }
      }

    case 'UPGRADE_SKILL': {
      const skill = state.skillCatalog.find(
        (item) => item.id === action.skillId && item.ownerId === MAIN_HERO_SKILL_OWNER_ID,
      )
      if (!skill || skill.upgradeCost <= 0) return state
      const level = state.skillLevels[skill.id] ?? 0
      const ownedEquipment = consumeSkillBooks(state, skill.upgradeCost)
      if (!ownedEquipment) return { ...state, toast: '技能书不足' }
      return {
        ...state,
        ownedEquipment,
        skillLevels: { ...state.skillLevels, [skill.id]: level + 1 },
        toast: level === 0 ? `解锁技能：${skill.name}` : `${skill.name} 升至 Lv.${level + 1}`,
      }
    }

    case 'UPGRADE_HERO': {
      const hero = state.heroes.find((item) => item.id === action.heroId)
      if (!hero || hero.level <= 0) return state
      const cost = getHeroSkillBookCost(hero.level)
      const ownedEquipment = consumeSkillBooks(state, cost)
      if (!ownedEquipment) return { ...state, toast: '技能书不足' }
      const heroes = state.heroes.map((item) =>
        item.id === hero.id ? { ...item, level: item.level + 1 } : item,
      )
      return {
        ...state,
        ownedEquipment,
        heroes,
        toast: `${hero.name} 升至 Lv.${hero.level + 1}`,
      }
    }

    case 'EXCHANGE_SKILL_BOOKS': {
      const book = state.equipmentCatalog.find((item) => item.type === 8)
      if (!book) return { ...state, toast: '技能书配置尚未加载' }
      if (state.diamonds < action.diamondCost) return { ...state, toast: '钻石不足' }
      return {
        ...state,
        diamonds: state.diamonds - action.diamondCost,
        ownedEquipment: {
          ...state.ownedEquipment,
          [book.id]: (state.ownedEquipment[book.id] ?? 0) + action.quantity,
        },
        toast: `兑换成功，获得 ${action.quantity} 本技能书`,
      }
    }

    case 'ADD_TEST_RESOURCE': {
      if (action.resource === 'gold') {
        return { ...state, gold: state.gold + 1000, toast: '测试：金币 +1000' }
      }
      if (action.resource === 'diamonds') {
        return { ...state, diamonds: state.diamonds + 1000, toast: '测试：钻石 +1000' }
      }
      const book = state.equipmentCatalog.find((item) => item.type === 8)
      if (!book) return { ...state, toast: '技能书配置尚未加载' }
      return {
        ...state,
        ownedEquipment: {
          ...state.ownedEquipment,
          [book.id]: (state.ownedEquipment[book.id] ?? 0) + 1000,
        },
        toast: '测试：技能书 +1000',
      }
    }

    case 'UPGRADE_WEAPON': {
      const catalogWeapon = WEAPON_CATALOG.find((item) => item.id === action.weaponId)
      if (!catalogWeapon) return state
      const owned = state.equippedWeapon.id === action.weaponId
        ? state.equippedWeapon
        : state.weaponInventory.find((item) => item.id === action.weaponId)
      const weapon = owned ?? catalogWeapon
      const cost = getWeaponUpgradeCost(weapon)
      if (state.gold < cost) return { ...state, toast: '金币不足' }
      const nextWeapon = { ...weapon, level: weapon.level + 1, isNew: owned ? weapon.isNew : true }
      return {
        ...state,
        gold: state.gold - cost,
        equippedWeapon: state.equippedWeapon.id === action.weaponId ? nextWeapon : state.equippedWeapon,
        weaponInventory: state.equippedWeapon.id === action.weaponId
          ? state.weaponInventory
          : owned
            ? state.weaponInventory.map((item) => item.id === action.weaponId ? nextWeapon : item)
            : [...state.weaponInventory, nextWeapon],
        toast: weapon.level === 0 ? `解锁武器：${weapon.name}` : `${weapon.name} 升至 Lv.${weapon.level + 1}`,
      }
    }

    case 'SET_ACTIVE_TAB':
      return {
        ...state,
        activeTab: action.tab,
        tabPanelOpen: true,
        secondaryView: null,
        showHeroOverlay: action.tab === 'heroes',
      }

    case 'CLOSE_TAB_PANEL':
      return {
        ...state,
        tabPanelOpen: false,
        secondaryView: null,
        showHeroOverlay: false,
      }

    case 'OPEN_WEAPON_PICKER':
      return { ...state, secondaryView: 'weapon', selectedWeaponId: null }

    case 'OPEN_MERGE_VIEW':
      return {
        ...state,
        secondaryView: 'merge',
        selectedWeaponId: null,
        showHeroOverlay: false,
        dialog: null,
      }

    case 'OPEN_EQUIPMENT_PICKER':
      {
        const firstOwned = state.equipmentCatalog.find(
          (item) => item.type === action.equipmentType && (state.ownedEquipment[item.id] ?? 0) > 0,
        )
      return {
        ...state,
        secondaryView: 'equipment',
        equipmentPickerType: action.equipmentType,
        selectedEquipmentId: firstOwned?.id ?? null,
        showHeroOverlay: false,
      }
      }

    case 'CLOSE_SECONDARY_VIEW':
      return {
        ...state,
        secondaryView: null,
        selectedWeaponId: null,
        equipmentPickerType: null,
        selectedEquipmentId: null,
        combatGraceRemaining: COMBAT_RESUME_GRACE_SEC,
      }

    case 'SAVE_MERGE_SNAPSHOT':
      return { ...state, mergeSnapshot: action.snapshot }

    case 'OPEN_HERO_OVERLAY':
      return { ...state, showHeroOverlay: true, activeTab: 'heroes' }

    case 'CLOSE_HERO_OVERLAY':
      return { ...state, showHeroOverlay: false }

    case 'SELECT_WEAPON':
      return {
        ...state,
        selectedWeaponId: action.weaponId,
        weaponInventory: clearNewFlag(state.weaponInventory, action.weaponId),
      }

    case 'EQUIP_WEAPON':
      return equipWeapon(state, action.weaponId)

    case 'SHOW_TOAST':
      return { ...state, toast: action.message }

    case 'SHOW_DIALOG':
      return { ...state, dialog: action.dialog }

    case 'HIDE_DIALOG':
      return { ...state, dialog: null }

    case 'LOAD_EQUIPMENT':
      return { ...state, equipmentCatalog: action.equipment, equipmentConfigError: null }

    case 'EQUIPMENT_CONFIG_ERROR':
      return { ...state, equipmentConfigError: action.message }

    case 'LOAD_MONSTERS':
      return applyMonsterCatalog(state, action.monsters)

    case 'MONSTER_CONFIG_ERROR':
      return { ...state, monsterConfigError: action.message }

    case 'LOAD_SKILLS':
      return {
        ...state,
        skillCatalog: action.skills,
        skillConfigError: null,
        skillLevels: unlockBasicSkills(action.skills, state.skillLevels, state.mainHero.level),
      }

    case 'SKILL_CONFIG_ERROR':
      return { ...state, skillConfigError: action.message }

    case 'SYNC_MERGE_RESOURCES':
      return { ...state, gold: action.gold, diamonds: action.diamonds }

    case 'GRANT_EQUIPMENT': {
      const ownedEquipment = {
        ...state.ownedEquipment,
        [action.item.id]: (state.ownedEquipment[action.item.id] ?? 0) + action.quantity,
      }
      const newEquipmentIds = action.item.type <= 7 && !state.ownedEquipment[action.item.id]
        ? [...state.newEquipmentIds, action.item.id]
        : state.newEquipmentIds
      if (action.item.type === 9) {
        const heroIndex = action.item.id - 100030001
        const hero = state.heroes[heroIndex]
        if (!hero) return { ...state, ownedEquipment }
        return {
          ...state,
          ownedEquipment,
          newEquipmentIds,
          heroes: state.heroes.map((entry, index) => index === heroIndex
            ? { ...entry, level: Math.max(1, entry.level) }
            : entry),
        }
      }
      return { ...state, ownedEquipment, newEquipmentIds }
    }

    case 'BUY_EQUIPMENT': {
      const cost = action.item.diamond
      if (cost === null) return { ...state, toast: '该物品不能使用钻石购买' }
      if (state.diamonds < cost) return { ...state, toast: '钻石不足' }
      const granted = gameReducer(state, { type: 'GRANT_EQUIPMENT', item: action.item, quantity: 1 })
      return { ...granted, diamonds: state.diamonds - cost, toast: `获得 ${action.item.name}` }
    }

    case 'SELECT_EQUIPMENT':
      return state.equipmentCatalog.some((item) => item.id === action.equipmentId)
        ? {
          ...state,
          selectedEquipmentId: action.equipmentId,
          newEquipmentIds: state.newEquipmentIds.filter((id) => id !== action.equipmentId),
        }
        : state

    case 'EQUIP_EQUIPMENT': {
      if (!state.ownedEquipment[action.equipmentId]) return state
      const item = state.equipmentCatalog.find((entry) => entry.id === action.equipmentId)
      if (!item || item.type < 1 || item.type > 7) return state
      const previousId = state.equippedEquipment[item.type]
      let ownedEquipment = state.ownedEquipment
      let gold = state.gold
      if (action.dismantlePrevious && previousId && previousId !== item.id) {
        const previousQuantity = ownedEquipment[previousId] ?? 0
        if (previousQuantity > 0) {
          ownedEquipment = { ...ownedEquipment }
          if (previousQuantity === 1) delete ownedEquipment[previousId]
          else ownedEquipment[previousId] = previousQuantity - 1
          gold += action.dismantleGold ?? 0
        }
      }
      return {
        ...state,
        ownedEquipment,
        gold,
        equippedEquipment: { ...state.equippedEquipment, [item.type]: item.id },
        selectedEquipmentId: item.id,
        toast: `已装备 ${item.name}`,
      }
    }

    case 'DISMANTLE_EQUIPMENT': {
      const quantity = state.ownedEquipment[action.equipmentId] ?? 0
      if (quantity <= 0) return state
      if (Object.values(state.equippedEquipment).includes(action.equipmentId)) {
        return { ...state, toast: '当前装备不能分解，请先替换' }
      }
      const ownedEquipment = { ...state.ownedEquipment }
      if (quantity === 1) delete ownedEquipment[action.equipmentId]
      else ownedEquipment[action.equipmentId] = quantity - 1
      return {
        ...state,
        ownedEquipment,
        gold: state.gold + action.gold,
        selectedEquipmentId: quantity === 1 ? null : state.selectedEquipmentId,
        toast: `分解成功，获得 ${action.gold} 金币`,
      }
    }

    default:
      return state
  }
}

interface GameContextValue {
  state: GameState
  totalDps: number
  mainHeroDps: number
  mainFireInterval: number
  skillBookCount: number
  hasUpgradeableSkill: boolean
  equippedWeapon: Weapon
  hasNewWeapons: boolean
  deployHero: (heroId: string) => void
  withdrawHero: (heroId: string) => void
  challengeBoss: () => void
  retreatBoss: () => void
  dismissBossFail: () => void
  clearToast: () => void
  clearHit: () => void
  clearGoldFlash: () => void
  toggleAutoBattle: () => void
  attackWithMainHero: (skillId: number) => { damage: number; critical: boolean }
  attackWithHero: (heroId: string) => { damage: number; critical: boolean }
  upgradeSkill: (skillId: number) => void
  upgradeHero: (heroId: string) => void
  upgradeWeapon: (weaponId: string) => void
  exchangeSkillBooks: () => void
  addTestResource: (resource: 'gold' | 'diamonds' | 'skillBooks') => void
  tick: (deltaSeconds: number) => void
  setActiveTab: (tab: ActiveTab) => void
  closeTabPanel: () => void
  openWeaponPicker: () => void
  openMergeView: () => void
  openEquipmentPicker: (equipmentType: number) => void
  closeSecondaryView: () => void
  closeHeroOverlay: () => void
  selectWeaponInPicker: (weaponId: string) => void
  equipWeaponAction: (weaponId: string) => void
  showToast: (message: string) => void
  tryEquipWeapon: () => void
  showDialog: (dialog: DialogConfig, onConfirm?: () => void, onCancel?: () => void) => void
  showAlert: (title: string, message: string) => void
  confirmDialog: () => void
  cancelDialog: () => void
  completeMonsterDeath: () => void
  completeMonsterSpawn: () => void
  syncMergeResources: (gold: number, diamonds: number) => void
  saveMergeSnapshot: (snapshot: MergeGameState) => void
  grantEquipment: (equipmentId: number, quantity: number) => void
  buyEquipment: (equipmentId: number) => void
  selectEquipment: (equipmentId: number) => void
  equipSelectedEquipment: (dismantlePrevious?: boolean) => void
  dismantleSelectedEquipment: () => void
}

const GameContext = createContext<GameContextValue | null>(null)

export function GameProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(gameReducer, initialState)
  const onConfirmRef = useRef<(() => void) | null>(null)
  const onCancelRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    let active = true
    loadEquipmentConfig()
      .then((equipment) => active && dispatch({ type: 'LOAD_EQUIPMENT', equipment }))
      .catch((error: unknown) => active && dispatch({
        type: 'EQUIPMENT_CONFIG_ERROR',
        message: error instanceof Error ? error.message : '装备配置加载失败',
      }))
    return () => { active = false }
  }, [])

  useEffect(() => {
    let active = true
    loadMonsterConfig()
      .then((monsters) => active && dispatch({ type: 'LOAD_MONSTERS', monsters }))
      .catch((error: unknown) => active && dispatch({
        type: 'MONSTER_CONFIG_ERROR',
        message: error instanceof Error ? error.message : '怪物配置加载失败',
      }))
    return () => { active = false }
  }, [])

  useEffect(() => {
    let active = true
    loadSkillConfig()
      .then((skills) => active && dispatch({ type: 'LOAD_SKILLS', skills }))
      .catch((error: unknown) => active && dispatch({
        type: 'SKILL_CONFIG_ERROR',
        message: error instanceof Error ? error.message : '技能配置加载失败',
      }))
    return () => { active = false }
  }, [])

  const equippedWeapon = state.equippedWeapon
  const totalDps = useMemo(() => getTotalDps(state), [state])
  const mainHeroDps = useMemo(() => getMainHeroExpectedDamage(state), [state])
  const skillBookCount = useMemo(() => getSkillBookCount(state), [state])
  const hasUpgradeableSkill = useMemo(
    () => state.skillCatalog.some(
      (skill) => skill.ownerId === MAIN_HERO_SKILL_OWNER_ID
        && skill.upgradeCost > 0
        && skillBookCount >= skill.upgradeCost,
    ),
    [state.skillCatalog, skillBookCount],
  )
  const basicSkill = state.skillCatalog.find(
    (skill) => skill.ownerId === MAIN_HERO_SKILL_OWNER_ID && skill.type === 1,
  )
  const mainFireInterval = useMemo(
    () => (basicSkill?.cooldownSeconds ?? 1) * 1000 / equippedWeapon.attackSpeed,
    [basicSkill?.cooldownSeconds, equippedWeapon.attackSpeed],
  )
  const hasNewWeapons = useMemo(
    () => state.weaponInventory.some((w) => w.isNew),
    [state.weaponInventory],
  )

  const deployHeroAction = useCallback((heroId: string) => dispatch({ type: 'DEPLOY_HERO', heroId }), [])
  const withdrawHero = useCallback((heroId: string) => dispatch({ type: 'WITHDRAW_HERO', heroId }), [])
  const challengeBoss = useCallback(() => dispatch({ type: 'CHALLENGE_BOSS' }), [])
  const retreatBoss = useCallback(() => dispatch({ type: 'RETREAT_BOSS' }), [])
  const dismissBossFail = useCallback(() => dispatch({ type: 'DISMISS_BOSS_FAIL' }), [])
  const clearToast = useCallback(() => dispatch({ type: 'CLEAR_TOAST' }), [])
  const clearHit = useCallback(() => dispatch({ type: 'CLEAR_HIT' }), [])
  const clearGoldFlash = useCallback(() => dispatch({ type: 'CLEAR_GOLD_FLASH' }), [])
  const toggleAutoBattle = useCallback(() => dispatch({ type: 'TOGGLE_AUTO_BATTLE' }), [])
  const attackWithMainHero = useCallback((skillId: number) => {
    const skill = state.skillCatalog.find((item) => item.id === skillId)
    const level = skill ? getMainSkillLevel(skill, state.skillLevels) : 0
    if (!skill || level <= 0 || skill.ownerId !== MAIN_HERO_SKILL_OWNER_ID || skill.type === 3) {
      return { damage: 0, critical: false }
    }
    const result = rollDamage(getMainHeroStats(state), getSkillValue(skill, level), skill.type === 2)
    dispatch({ type: 'MAIN_HERO_ATTACK', damage: result.damage })
    return result
  }, [state])
  const attackWithHero = useCallback((heroId: string) => {
    const heroIndex = state.heroes.findIndex((hero) => hero.id === heroId)
    if (heroIndex < 0 || !isHeroDeployed(state.deployedSlots, heroId)) {
      return { damage: 0, critical: false }
    }
    const result = rollDamage(getHeroStats(state, heroIndex), 1, false)
    dispatch({ type: 'MAIN_HERO_ATTACK', damage: result.damage })
    return result
  }, [state])
  const upgradeSkill = useCallback((skillId: number) => dispatch({ type: 'UPGRADE_SKILL', skillId }), [])
  const upgradeHero = useCallback((heroId: string) => dispatch({ type: 'UPGRADE_HERO', heroId }), [])
  const upgradeWeapon = useCallback((weaponId: string) => dispatch({ type: 'UPGRADE_WEAPON', weaponId }), [])
  const exchangeSkillBooks = useCallback(
    () => dispatch({ type: 'EXCHANGE_SKILL_BOOKS', diamondCost: 100, quantity: 100 }),
    [],
  )
  const addTestResource = useCallback(
    (resource: 'gold' | 'diamonds' | 'skillBooks') => dispatch({ type: 'ADD_TEST_RESOURCE', resource }),
    [],
  )
  const completeMonsterDeath = useCallback(() => dispatch({ type: 'MONSTER_DEATH_COMPLETE' }), [])
  const completeMonsterSpawn = useCallback(() => dispatch({ type: 'MONSTER_SPAWN_COMPLETE' }), [])
  const tick = useCallback((deltaSeconds: number) => dispatch({ type: 'TICK', deltaSeconds }), [])
  const setActiveTab = useCallback((tab: ActiveTab) => dispatch({ type: 'SET_ACTIVE_TAB', tab }), [])
  const closeTabPanel = useCallback(() => dispatch({ type: 'CLOSE_TAB_PANEL' }), [])
  const openWeaponPicker = useCallback(() => dispatch({ type: 'OPEN_WEAPON_PICKER' }), [])
  const openMergeView = useCallback(() => dispatch({ type: 'OPEN_MERGE_VIEW' }), [])
  const openEquipmentPicker = useCallback(
    (equipmentType: number) => dispatch({ type: 'OPEN_EQUIPMENT_PICKER', equipmentType }),
    [],
  )
  const closeSecondaryView = useCallback(() => dispatch({ type: 'CLOSE_SECONDARY_VIEW' }), [])
  const closeHeroOverlay = useCallback(() => dispatch({ type: 'CLOSE_HERO_OVERLAY' }), [])
  const selectWeaponInPicker = useCallback(
    (weaponId: string) => dispatch({ type: 'SELECT_WEAPON', weaponId }),
    [],
  )
  const equipWeaponAction = useCallback(
    (weaponId: string) => dispatch({ type: 'EQUIP_WEAPON', weaponId }),
    [],
  )
  const showToast = useCallback((message: string) => dispatch({ type: 'SHOW_TOAST', message }), [])
  const syncMergeResources = useCallback(
    (gold: number, diamonds: number) => dispatch({ type: 'SYNC_MERGE_RESOURCES', gold, diamonds }),
    [],
  )
  const saveMergeSnapshot = useCallback(
    (snapshot: MergeGameState) => dispatch({ type: 'SAVE_MERGE_SNAPSHOT', snapshot }),
    [],
  )
  const grantEquipment = useCallback((equipmentId: number, quantity: number) => {
    const item = state.equipmentCatalog.find((entry) => entry.id === equipmentId)
    if (item) dispatch({ type: 'GRANT_EQUIPMENT', item, quantity })
  }, [state.equipmentCatalog])
  const buyEquipment = useCallback((equipmentId: number) => {
    const item = state.equipmentCatalog.find((entry) => entry.id === equipmentId)
    if (item) dispatch({ type: 'BUY_EQUIPMENT', item })
  }, [state.equipmentCatalog])
  const selectEquipment = useCallback(
    (equipmentId: number) => dispatch({ type: 'SELECT_EQUIPMENT', equipmentId }),
    [],
  )

  const confirmDialog = useCallback(() => {
    onConfirmRef.current?.()
    onConfirmRef.current = null
    onCancelRef.current = null
    dispatch({ type: 'HIDE_DIALOG' })
  }, [])

  const cancelDialog = useCallback(() => {
    onCancelRef.current?.()
    onConfirmRef.current = null
    onCancelRef.current = null
    dispatch({ type: 'HIDE_DIALOG' })
  }, [])

  const showDialog = useCallback(
    (dialog: DialogConfig, onConfirm?: () => void, onCancel?: () => void) => {
      onConfirmRef.current = onConfirm ?? null
      onCancelRef.current = onCancel ?? null
      dispatch({ type: 'SHOW_DIALOG', dialog })
    },
    [],
  )

  const showAlert = useCallback(
    (title: string, message: string) => {
      showDialog({ title, message, confirmText: '确定', cancelText: null })
    },
    [showDialog],
  )

  const equipSelectedEquipment = useCallback((dismantlePrevious = false) => {
    if (state.selectedEquipmentId === null) return
    const selected = state.equipmentCatalog.find((item) => item.id === state.selectedEquipmentId)
    if (!selected) return
    const currentId = state.equippedEquipment[selected.type]
    const current = state.equipmentCatalog.find((item) => item.id === currentId)
    const selectedPower = getEquipmentConfigPower(selected)
    const currentPower = current ? getEquipmentConfigPower(current) : 0
    const dismantleGold = current ? getEquipmentDismantleGold(current) : 0
    const equip = () => dispatch({
      type: 'EQUIP_EQUIPMENT',
      equipmentId: selected.id,
      dismantlePrevious,
      dismantleGold,
    })
    if (current && selectedPower < currentPower) {
      showDialog(
        {
          title: '确认替换',
          message: '该装备比当前装备战斗力低，是否替换？',
          confirmText: '替换',
          cancelText: '取消',
        },
        equip,
      )
      return
    }
    equip()
  }, [state.selectedEquipmentId, state.equipmentCatalog, state.equippedEquipment, showDialog])
  const dismantleSelectedEquipment = useCallback(() => {
    if (state.selectedEquipmentId === null) return
    const selected = state.equipmentCatalog.find((item) => item.id === state.selectedEquipmentId)
    if (!selected || !(state.ownedEquipment[selected.id] ?? 0)) return
    if (Object.values(state.equippedEquipment).includes(selected.id)) {
      showAlert('无法分解', '当前装备不能分解，请先替换。')
      return
    }
    const gold = getEquipmentDismantleGold(selected)
    const currentId = state.equippedEquipment[selected.type]
    const current = state.equipmentCatalog.find((item) => item.id === currentId)
    const dismantle = () => dispatch({ type: 'DISMANTLE_EQUIPMENT', equipmentId: selected.id, gold })
    if (current && getEquipmentConfigPower(selected) > getEquipmentConfigPower(current)) {
      showDialog(
        {
          title: '确认分解',
          message: '该装备比当前装备战斗力更强，是否分解？',
          confirmText: '分解',
          cancelText: '取消',
        },
        dismantle,
      )
      return
    }
    dismantle()
  }, [state.selectedEquipmentId, state.equipmentCatalog, state.ownedEquipment, state.equippedEquipment, showAlert, showDialog])

  const tryEquipWeapon = useCallback(() => {
    const selectedId = state.selectedWeaponId
    if (!selectedId) return
    const selected = state.weaponInventory.find((w) => w.id === selectedId)
    if (!selected) return

    const currentPower = getWeaponPower(state.equippedWeapon)
    const selectedPower = getWeaponPower(selected)

    if (selectedPower <= currentPower) {
      showDialog(
        {
          title: '确认替换',
          message: '选中的武器不比当前装备更强，确定要替换吗？',
          confirmText: '替换',
          cancelText: '取消',
        },
        () => dispatch({ type: 'EQUIP_WEAPON', weaponId: selectedId }),
      )
      return
    }

    dispatch({ type: 'EQUIP_WEAPON', weaponId: selectedId })
  }, [state.selectedWeaponId, state.weaponInventory, state.equippedWeapon, showDialog])

  const value = useMemo(
    () => ({
      state,
      totalDps,
      mainHeroDps,
      mainFireInterval,
      skillBookCount,
      hasUpgradeableSkill,
      equippedWeapon,
      hasNewWeapons,
      deployHero: deployHeroAction,
      withdrawHero,
      challengeBoss,
      retreatBoss,
      dismissBossFail,
      clearToast,
      clearHit,
      clearGoldFlash,
      toggleAutoBattle,
      attackWithMainHero,
      attackWithHero,
      upgradeSkill,
      upgradeHero,
      upgradeWeapon,
      exchangeSkillBooks,
      addTestResource,
      tick,
      setActiveTab,
      closeTabPanel,
      openWeaponPicker,
      openMergeView,
      openEquipmentPicker,
      closeSecondaryView,
      closeHeroOverlay,
      selectWeaponInPicker,
      equipWeaponAction,
      showToast,
      tryEquipWeapon,
      showDialog,
      showAlert,
      confirmDialog,
      cancelDialog,
      completeMonsterDeath,
      completeMonsterSpawn,
      syncMergeResources,
      saveMergeSnapshot,
      grantEquipment,
      buyEquipment,
      selectEquipment,
      equipSelectedEquipment,
      dismantleSelectedEquipment,
    }),
    [
      state,
      totalDps,
      mainHeroDps,
      mainFireInterval,
      skillBookCount,
      hasUpgradeableSkill,
      equippedWeapon,
      hasNewWeapons,
      deployHeroAction,
      withdrawHero,
      challengeBoss,
      retreatBoss,
      dismissBossFail,
      clearToast,
      clearHit,
      clearGoldFlash,
      toggleAutoBattle,
      attackWithMainHero,
      attackWithHero,
      upgradeSkill,
      upgradeHero,
      upgradeWeapon,
      exchangeSkillBooks,
      addTestResource,
      tick,
      setActiveTab,
      closeTabPanel,
      openWeaponPicker,
      openMergeView,
      openEquipmentPicker,
      closeSecondaryView,
      closeHeroOverlay,
      selectWeaponInPicker,
      equipWeaponAction,
      showToast,
      tryEquipWeapon,
      showDialog,
      showAlert,
      confirmDialog,
      cancelDialog,
      completeMonsterDeath,
      completeMonsterSpawn,
      syncMergeResources,
      saveMergeSnapshot,
      grantEquipment,
      buyEquipment,
      selectEquipment,
      equipSelectedEquipment,
      dismantleSelectedEquipment,
    ],
  )

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>
}

export function useGameStore() {
  const ctx = useContext(GameContext)
  if (!ctx) throw new Error('useGameStore must be used within GameProvider')
  return ctx
}
