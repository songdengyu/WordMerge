import { requestTaming, releaseTaming, TAMING_ORDER, TAMING_SECONDS, type TamingCommand } from './taming'
import { SURVIVAL_RULES } from './survivalConfig'
import type { NavigationGrid } from './navigation'
import { canWalkLine, finitePoint, PLAYER_SPEED, pointCell, pointDistance, smoothPath, SmoothPathSearch, walkPath } from './smoothNavigation'
import { sameCell, type Cell, type WorldMap } from './world'
import { applyInventoryCommand, createProduction, type InventoryCommand, type ProductionState } from './inventory'
import type { ProductionCatalog } from './productionConfig'
import { syncStamina } from './stamina'
import { configVersion, parseSaveFile, SaveError, type RuntimeData, type SaveEnvelope } from './saveData'
import type { SaveRepository } from './persistence'
import { applyConstructionCommand, constructionDamage, constructionNavigation, createConstruction, getOrderTarget, localToWorld,
  orderError, orderMaterials, orderSeconds, placementError, reachable, releaseJob,
  type ConstructionCommand, type ConstructionState, type Rotation } from './construction'
import { acceptRescue, advanceSurvival, applySurvivalCommand, beginFailure, createSurvival, dayTime, shelterAt, survivalWarning, worldMinutes,
  type Failure, type SurvivalCommand, type SurvivalState } from './survival'
import { applyProgressionCommand, applyStoryCommand, createProgression, discoverRegions, progressedWorld, type ProgressionCommand, type ProgressionState, type StoryCommand } from './progression'
import { testEnvironment, type EnvironmentCommand } from './environment'
import { applyQuickSupply, type QuickSupplyCommand } from './quickSupply'
import { TEST_VITAL_NAMES, type TestVitalCommand } from './testControls'

export const FIXED_STEP_MS = 50
export type PauseReason = 'background' | 'page-hidden' | 'renderer-loading' | 'renderer-lost' | 'story' | 'tutorial' | 'failure' | 'save-error' | 'importing'
export type GameCommand = { type: 'move'; target: Cell } | InventoryCommand | ConstructionCommand | SurvivalCommand | ProgressionCommand | StoryCommand | EnvironmentCommand | QuickSupplyCommand | TestVitalCommand | TamingCommand
export type CommandResult = { accepted: true; persisted?: boolean; message?: string; openProduction?: boolean } | { accepted: false; reason: string }
export interface SaveStatus { state: 'saved' | 'saving' | 'error' | 'conflict'; message: string; revision: number; savedAt: number }
export interface RuntimeOptions { catalog?: ProductionCatalog; saved?: SaveEnvelope | null; repository?: SaveRepository; now?: () => number }
export interface UiSnapshot {
  readonly day: number
  readonly hour: number
  readonly minute: number
  readonly isDay: boolean
  readonly activity: 'idle' | 'searching' | 'walking' | 'building' | 'taming'
  readonly player: Cell
  readonly destination: Cell | null
  readonly feedback: string
  readonly pauseReasons: readonly PauseReason[]
  readonly production: ProductionState | null
  readonly construction: ConstructionState
  readonly protected: boolean
  readonly saveStatus: SaveStatus
  readonly survival: SurvivalState
  readonly shelter: ReturnType<typeof shelterAt>
  readonly warning: string
  readonly progression: ProgressionState
}
export interface SceneSnapshot {
  readonly position: Cell
  readonly previousPosition: Cell
  readonly route: readonly Cell[]
  readonly destination: Cell | null
  readonly elapsedSeconds: number
  readonly gameMinutes: number
  readonly construction: ConstructionState
  readonly survival: SurvivalState
  readonly progression: ProgressionState
}

/** Sole owner of world simulation. React/Pixi own no gameplay state or clocks. */
export class GameRuntime {
  private readonly listeners = new Set<() => void>()
  private readonly pauses = new Set<PauseReason>()
  private readonly commands: { command: GameCommand; resolve: (value: CommandResult) => void }[] = []
  private point: Cell
  private get cell() { return pointCell(this.point) }
  private route: Cell[] = []
  private destination: Cell | null = null
  private search: SmoothPathSearch | null = null
  private elapsedSeconds = 0
  private feedback = '轻点空地，沿着小径探索营地'
  private lastFrame: number | undefined
  private accumulator = 0
  private tick = 0
  private uiSnapshot: UiSnapshot
  private sceneSnapshot: SceneSnapshot
  private production: ProductionState | null
  private construction = createConstruction()
  private survival: SurvivalState
  private progression = createProgression()
  private storyBusy = false
  world: WorldMap
  private navigation: NavigationGrid
  private constructionChanged = false
  private readonly now: () => number
  private readonly repository?: SaveRepository
  readonly catalog?: ProductionCatalog
  private saveStatus: SaveStatus = { state: 'saved', message: '进度保存在本机', revision: 0, savedAt: 0 }
  private pendingSaves = 0
  private lastAutomaticSave = 0
  private importing = false
  private closed = false

  constructor(world: WorldMap, options: RuntimeOptions = {}) {
    this.world = progressedWorld(world, this.progression)
    this.now = options.now ?? (() => Date.now())
    this.repository = options.repository
    this.catalog = options.catalog
    this.production = options.catalog ? createProduction(options.catalog, this.now()) : null
    this.survival = createSurvival(world)
    this.navigation = constructionNavigation(world, this.construction)
    this.point = { ...world.config.spawn }
    if (options.saved) {
      this.restore(options.saved.data)
      this.saveStatus = { state: 'saved', message: '已读取本机进度', revision: options.saved.revision, savedAt: options.saved.savedAt }
    }
    this.uiSnapshot = this.makeUiSnapshot()
    this.sceneSnapshot = this.makeSceneSnapshot(this.point)
  }

  getUiSnapshot = () => this.uiSnapshot
  getSceneSnapshot = () => this.sceneSnapshot
  getInterpolation = () => this.pauses.size ? 1 : Math.min(1, this.accumulator / FIXED_STEP_MS)
  subscribeUi = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }

  dispatch(command: GameCommand): Promise<CommandResult> {
    if (command.type === 'rescue') return this.rescue()
    if (command.type.startsWith('story-')) return this.story(command as StoryCommand)
    if (this.closed || this.pauses.size) return Promise.resolve({ accepted: false, reason: '营地已暂停，请恢复后再操作' })
    // Copy inputs so callers cannot mutate a command between enqueue and execution.
    const copy = structuredClone(command)
    return new Promise(resolve => this.commands.push({ command: copy, resolve }))
  }

  setPauseReason(reason: PauseReason, paused: boolean) {
    if (this.pauses.has(reason) === paused) return
    if (paused) this.pauses.add(reason)
    else this.pauses.delete(reason)
    this.resetFrameClock()
    if (paused) this.cancelPendingCommands()
    // Stop interpolation at the authoritative position when paused.
    this.sceneSnapshot = this.makeSceneSnapshot(this.position())
    this.publish()
  }

  resetFrameClock() { this.lastFrame = undefined; this.accumulator = 0 }

  cancelPendingCommands() {
    for (const entry of this.commands.splice(0)) entry.resolve({ accepted: false, reason: '操作已取消，请重新点击目标' })
  }

  advanceFrame(timestamp: number) {
    if (this.closed) return
    this.syncRealTime()
    if (!Number.isFinite(timestamp)) return
    const delta = this.lastFrame === undefined ? 0 : timestamp - this.lastFrame
    this.lastFrame = timestamp
    if (this.pauses.size || delta < 0 || delta > 1000) { this.accumulator = 0; return }
    this.accumulator += Math.min(delta, 250)
    while (this.accumulator >= FIXED_STEP_MS) {
      this.accumulator -= FIXED_STEP_MS
      this.step()
    }
  }

  private step() {
    const previous = this.position()
    const priorDay = Math.floor((this.gameMinutes() - 360) / 1440)
    let timeJumped = false
    this.elapsedSeconds += FIXED_STEP_MS / 1000
    const pending = this.commands.splice(0)
    this.constructionChanged = false
    const results = pending.map(({ command }) => {
      if (command.type === 'move') {
        if (this.survival.taming.job) return { accepted: false, reason: '已安排驯服，请先完成或取消前往' } as CommandResult
        if (this.construction.jobs[0]?.phase === 'building') return { accepted: false, reason: '正在施工，完成后才能移动' } as CommandResult
        if (this.construction.jobs.length) return { accepted: false, reason: '已安排工程，请先取消前往或排队中的工程' } as CommandResult
        this.survival = { ...this.survival, resting: false }
        return this.move(command.target)
      }
      if (!this.catalog || !this.production) return { accepted: false, reason: '物品配置尚未就绪' } as CommandResult
      if (command.type === 'test-vital') {
        if (!Object.prototype.hasOwnProperty.call(TEST_VITAL_NAMES, command.stat) || (command.delta !== -10 && command.delta !== 10)) {
          return { accepted: false, reason: '无效的状态测试参数' } as CommandResult
        }
        const value = Math.max(0, Math.min(100, this.production.vitals[command.stat] + command.delta))
        this.production = { ...this.production, vitals: { ...this.production.vitals, [command.stat]: value } }
        // A deliberate zero-health test must still reach the normal defeat flow, even while resting.
        if (command.stat === 'hp' && value === 0) this.survival = { ...this.survival, resting: false }
        this.feedback = `${TEST_VITAL_NAMES[command.stat]}已调整为 ${Math.round(value)}`
        return { accepted: true, message: this.feedback } as CommandResult
      }
      if (command.type === 'quick-supply' || command.type === 'supply-order-use' || command.type === 'supply-order-cancel') {
        const result = applyQuickSupply(this.production, this.catalog, command, this.now())
        if (!result.accepted) return result
        this.production = result.state; this.feedback = result.message
        return { accepted: true, message: result.message, openProduction: result.openProduction } as CommandResult
      }
      if (command.type === 'test-time' || command.type === 'test-weather') {
        const result = testEnvironment(this.survival, this.world, this.gameMinutes(), command)
        if (!result.accepted) return result
        this.survival = result.state; this.feedback = result.message
        if (command.type === 'test-time') {
          this.elapsedSeconds = (result.minutes - this.world.config.initialHour * 60) * this.world.config.dayDurationSeconds / 1440
          timeJumped = true
        }
        return { accepted: true, message: result.message } as CommandResult
      }
      if (command.type === 'region-unlock' || command.type === 'outfit-equip' || command.type === 'decor-place' || command.type === 'decor-remove') {
        const result = applyProgressionCommand(this.progression, this.construction, command)
        if (!result.accepted) return result
        this.progression = result.state; this.feedback = result.message
        if (command.type === 'region-unlock') {
          this.world = progressedWorld(this.world, this.progression)
          this.navigation = constructionNavigation(this.world, this.construction)
          if (this.search && this.destination) this.search = new SmoothPathSearch(this.navigation, this.point, this.destination)
        }
        return { accepted: true, message: result.message } as CommandResult
      }
      if (command.type === 'taming-interact' || command.type === 'taming-cancel' || command.type === 'companion-rescue') {
        const wasTravel = this.survival.taming.job?.phase === 'travel'
        const result = requestTaming(this.survival, this.production, this.construction, this.world, this.point, dayTime(this.gameMinutes()), command)
        if (!result.accepted) return result
        this.survival = result.state; this.production = result.production; this.feedback = result.message
        if (command.type === 'taming-cancel') { if (wasTravel) this.stopMovement() }
        else if (result.state.taming.job) this.move(result.state.taming.job.workCell)
        return { accepted: true, message: result.message, openProduction: result.openProduction } as CommandResult
      }
      if (command.type.startsWith('companion-') || command.type === 'player-rest') {
        const result = applySurvivalCommand(this.survival, this.production, this.construction, this.world, this.cell, this.gameMinutes(), command as Exclude<SurvivalCommand, { type: 'rescue' }>)
        if (!result.accepted) return result
        this.survival = result.state; this.production = result.production; this.feedback = result.message
        if (command.type === 'player-rest' && result.state.resting) this.stopMovement()
        return { accepted: true, message: result.message } as CommandResult
      }
      if (command.type.startsWith('building-')) {
        if (this.survival.taming.job) return { accepted: false, reason: '请先完成或取消驯服' } as CommandResult
        const buildingCommand = command as ConstructionCommand
        const wasTravel = this.construction.jobs[0]?.phase === 'travel' && buildingCommand.type === 'building-cancel'
          && this.construction.jobs[0].orderId === buildingCommand.orderId
        const result = applyConstructionCommand(this.construction, this.production, this.world, this.cell, buildingCommand)
        if (!result.accepted) return result
        this.construction = result.state; this.production = result.production
        this.survival = { ...this.survival, resting: false }
        this.navigation = constructionNavigation(this.world, this.construction)
        if (wasTravel) this.stopMovement()
        this.feedback = result.message
        return { accepted: true, message: result.message, openProduction: result.openProduction } as CommandResult
      }
      const result = applyInventoryCommand(this.production, this.catalog, command as InventoryCommand, this.now())
      if (!result.accepted) return result
      this.production = result.state
      return { accepted: true, message: result.message } as CommandResult
    })
    this.beginNextJob()
    if (this.search) {
      const result = this.search.advance()
      if (result.status !== 'pending') {
        this.search = null
        if (result.status === 'found') {
          this.route = result.path
          this.feedback = this.route.length ? '正在前往目的地' : '已到达目的地'
        } else {
          this.destination = null; this.feedback = '暂时没有通往那里的路'
          if (this.construction.jobs[0]?.phase === 'travel') this.abandonTravel('无法到达工作位，物资已释放')
          if (this.survival.taming.job?.phase === 'travel') this.abandonTaming('无法到达动物身边，物资已释放')
        }
      }
    }
    if (this.route.length && !canWalkLine(this.navigation, this.point, this.route[0])) {
      const target = this.destination
      this.route = []
      if (target) this.search = new SmoothPathSearch(this.navigation, this.point, target)
    }
    if (this.route.length) {
      const moved = walkPath(this.point, this.route, PLAYER_SPEED * FIXED_STEP_MS / 1000)
      this.point = moved.position; this.route = moved.route
      if (!this.route.length && !this.search) this.feedback = '已到达目的地，看看附近吧'
    }
    this.advanceConstruction()
    this.advanceTaming()
    let survivalChanged = false
    if (this.production) {
      const result = advanceSurvival(this.survival, this.production, this.construction, this.world, this.cell, this.gameMinutes(), FIXED_STEP_MS / 1000)
      this.survival = result.state; this.production = result.production; this.construction = result.construction
      survivalChanged = result.critical
      if (result.message) this.feedback = result.message
      if (result.critical) this.navigation = constructionNavigation(this.world, this.construction)
      if (this.production.vitals.hp === 0) { this.enterFailure(result.cause); survivalChanged = true }
    }
    const discoveries = discoverRegions(this.progression, this.cell)
    if (discoveries !== this.progression) { this.progression = discoveries; this.feedback = '发现了新的线索，打开营地手记看看'; survivalChanged = true }
    if (!timeJumped && !this.progression.witnessedDawn && !this.survival.failure && priorDay < Math.floor((this.gameMinutes() - 360) / 1440)) {
      this.progression = { ...this.progression, witnessedDawn: true }; survivalChanged = true
    }
    this.sceneSnapshot = this.makeSceneSnapshot(previous)
    this.tick++
    if (pending.length || survivalChanged || this.constructionChanged || this.tick % 2 === 0) this.publish()
    const critical = this.constructionChanged || survivalChanged || results.some(result => result.accepted)
    if (critical || this.elapsedSeconds - this.lastAutomaticSave >= 2) {
      this.lastAutomaticSave = this.elapsedSeconds
      const saved = this.checkpoint()
      pending.forEach((entry, index) => {
        const result = results[index]
        if (!result.accepted || !this.repository) entry.resolve(result)
        else void saved.then(persisted => entry.resolve({ ...result, persisted }))
      })
    } else pending.forEach((entry, index) => entry.resolve(results[index]))
  }

  private move(target: Cell): CommandResult {
    if (!finitePoint(target)) return { accepted: false, reason: '请选择有效的地图位置' }
    const cell = pointCell(target), chunk = this.world.chunkAt(cell)
    if (!chunk?.unlocked) return { accepted: false, reason: chunk ? '这片区域还未开放' : '这里是营地地图的边界' }
    if (!this.world.isWalkable(cell)) return { accepted: false, reason: '这里不能落脚，试试旁边的空地' }
    // Keep precise taps, but move a tap too close to a solid edge safely inside its tile.
    const destination = canWalkLine(this.navigation, target, target) ? { ...target }
      : { x: cell.x + Math.max(-.34, Math.min(.34, target.x - cell.x)), y: cell.y + Math.max(-.34, Math.min(.34, target.y - cell.y)) }
    this.route = []
    this.destination = destination
    this.search = new SmoothPathSearch(this.navigation, this.point, destination)
    this.feedback = pointDistance(this.point, destination) < .001 ? '就在前方' : '正在寻找小径'
    return { accepted: true }
  }

  placementError(blueprintId: string, origin: Cell, rotation: Rotation) {
    return placementError(this.world, this.construction, blueprintId, origin, rotation, this.cell)
  }

  private stopMovement() {
    this.search = null
    this.route = []
    this.destination = null
  }

  private abandonTravel(message: string) {
    const job = this.construction.jobs[0]
    if (!job || job.phase === 'building' || !this.production) return
    this.construction = structuredClone(this.construction)
    this.production = structuredClone(this.production)
    releaseJob(this.construction, this.production.inventory, job.orderId)
    this.stopMovement()
    this.feedback = message; this.constructionChanged = true
  }

  private beginNextJob() {
    const job = this.construction.jobs[0]
    if (!job || job.phase !== 'queued') return
    const order = this.construction.orders.find(order => order.id === job.orderId)!
    if (orderError(this.construction, order)) { this.abandonTravel('工程状态已变化，物资已释放'); return }
    const { building, config } = getOrderTarget(this.construction, order)
    const work = config.work.map(cell => localToWorld(building, cell))
      .sort((a, b) => Math.abs(a.x - this.cell.x) + Math.abs(a.y - this.cell.y) - Math.abs(b.x - this.cell.x) - Math.abs(b.y - this.cell.y))
      .find(cell => reachable(this.navigation, this.cell, cell, this.world))
    if (!work) { this.abandonTravel('无法到达工作位，物资已在原格释放'); return }
    this.construction = structuredClone(this.construction)
    Object.assign(this.construction.jobs[0], { phase: 'travel', workCell: work })
    this.move(work)
    this.feedback = `正在前往${config.name}，物资尚未扣除`
    this.constructionChanged = true
  }

  private advanceConstruction() {
    const job = this.construction.jobs[0]
    if (!job || !this.production) return
    const order = this.construction.orders.find(order => order.id === job.orderId)!
    if (job.phase === 'travel' && !this.route.length && !this.search) {
      if (!job.workCell || !sameCell(this.point, job.workCell) || orderError(this.construction, order)) {
        this.abandonTravel('工程暂时无法开工，物资已释放'); return
      }
      const requirements = orderMaterials(this.construction, order)
      const inventory = this.production.inventory
      if (requirements.length !== job.reservedIds.length || job.reservedIds.some((id, index) => {
        const item = inventory.items[id]
        return !item || item.reservedBy !== order.id || item.itemId !== requirements[index]
          || (item.location.kind === 'board' && inventory.board[item.location.index].lock !== 0)
      })) { this.abandonTravel('预留物资已变化，请重新安排工程'); return }
      this.production = structuredClone(this.production)
      this.construction = structuredClone(this.construction)
      for (const id of job.reservedIds) {
        const item = this.production.inventory.items[id]
        if (item.location.kind === 'board') this.production.inventory.board[item.location.index].instanceId = null
        else this.production.inventory.warehouse[item.location.index] = null
        delete this.production.inventory.items[id]
      }
      const { config } = getOrderTarget(this.construction, order)
      Object.assign(this.construction.jobs[0], { phase: 'building', reservedIds: [], remaining: orderSeconds(config, order) })
      this.destination = null
      this.feedback = `${config.name}施工中，主角与当前部件受到保护`
      this.constructionChanged = true
    } else if (job.phase === 'building') {
      this.construction = structuredClone(this.construction)
      const current = this.construction.jobs[0]
      current.remaining = Math.max(0, current.remaining - FIXED_STEP_MS / 1000)
      if (current.remaining > 0.000001) return
      const { part, config } = getOrderTarget(this.construction, order)
      part.built = true; part.hp = config.hp
      const xp = part.xpGranted ? 0 : config.xp
      this.construction.xp += xp; part.xpGranted = true
      this.construction.jobs.shift()
      this.construction.orders = this.construction.orders.filter(other => other.id !== order.id)
      this.navigation = constructionNavigation(this.world, this.construction)
      this.feedback = `${config.name}${order.mode === 'repair' ? '修复' : '建造'}完成${xp ? `，经验 +${xp}` : ''}`
      this.constructionChanged = true
    }
  }

  private abandonTaming(message: string) {
    if (!this.production || !this.survival.taming.job) return
    this.survival = structuredClone(this.survival); this.production = structuredClone(this.production)
    releaseTaming(this.survival, this.production)
    this.stopMovement(); this.feedback = message; this.constructionChanged = true
  }

  private advanceTaming() {
    const job = this.survival.taming.job
    if (!job || !this.production) return
    if (job.phase === 'travel') {
      if (!dayTime(this.gameMinutes())) { this.abandonTaming('天黑了，等白天再来驯服，物资已释放'); return }
      if (this.route.length || this.search) return
      const animal = this.survival.companion.cell, inventory = this.production.inventory
      const requirements = SURVIVAL_RULES.companion.rescueItems
      if (!sameCell(this.point, job.workCell) || this.survival.companion.status !== 'wild'
        || !(sameCell(this.cell, animal) || this.navigation.canStep(this.cell, animal))
        || job.reservedIds.length !== requirements.length || job.reservedIds.some((id, index) => {
          const item = inventory.items[id]
          return !item || item.reservedBy !== TAMING_ORDER || item.itemId !== requirements[index]
            || (item.location.kind === 'board' && inventory.board[item.location.index].lock !== 0)
        })) { this.abandonTaming('暂时无法开始驯服，物资已释放'); return }
      this.survival = structuredClone(this.survival); this.production = structuredClone(this.production)
      for (const id of job.reservedIds) {
        const item = this.production.inventory.items[id]
        if (item.location.kind === 'board') this.production.inventory.board[item.location.index].instanceId = null
        else this.production.inventory.warehouse[item.location.index] = null
        delete this.production.inventory.items[id]
      }
      Object.assign(this.survival.taming.job!, { phase: 'taming', remaining: TAMING_SECONDS, reservedIds: [] })
      this.stopMovement(); this.feedback = '正在驯服栗栗，主角受到保护'; this.constructionChanged = true
    } else {
      this.survival = structuredClone(this.survival)
      const current = this.survival.taming.job!
      current.remaining = Math.max(0, current.remaining - FIXED_STEP_MS / 1000)
      if (current.remaining > .000001) return
      Object.assign(this.survival.companion, { status: 'active', guard: { ...this.cell } })
      this.survival.taming = { ordered: false, job: null }; this.survival.decisionRemaining = 0
      this.feedback = '栗栗愿意留下了，点击它可以下达指令'; this.constructionChanged = true
    }
  }

  /** Simulation event entry; there is intentionally no player-facing damage command. */
  applyDamage(target: 'player' | { buildingId: string; partId: string }, amount: number) {
    if (!this.production || this.pauses.size || this.closed) return
    if (target === 'player' && this.survival.taming.job?.phase === 'taming') return
    const result = constructionDamage(this.construction, this.production, target, amount)
    this.construction = result.state; this.production = result.production
    this.navigation = constructionNavigation(this.world, this.construction)
    if (this.search && this.destination) this.search = new SmoothPathSearch(this.navigation, this.point, this.destination)
    if (this.production.vitals.hp === 0) this.enterFailure('enemy')
    this.sceneSnapshot = this.makeSceneSnapshot(this.position()); this.publish(); void this.checkpoint()
  }

  private enterFailure(cause: Failure['cause']) {
    if (!this.production || !this.catalog || this.survival.failure) return
    const result = beginFailure(this.survival, this.production, this.construction, this.catalog, this.gameMinutes(), cause)
    this.survival = result.state; this.production = result.production; this.construction = result.construction
    this.route = []; this.search = null; this.destination = null
    this.feedback = '你倒下了，营地正在等待救援'
    this.setPauseReason('failure', true)
  }

  private async rescue(): Promise<CommandResult> {
    if (this.closed || !this.production || !this.survival.failure || [...this.pauses].some(reason => reason !== 'failure')) return { accepted: false, reason: '请先恢复画面并保管好当前进度，再接受救援' }
    const result = acceptRescue(this.survival, this.production, this.world, this.elapsedSeconds)
    this.survival = result.state; this.production = result.production; this.elapsedSeconds = result.elapsedSeconds
    this.point = { ...this.world.config.spawn }; this.route = []; this.destination = null; this.search = null
    this.lastAutomaticSave = this.elapsedSeconds
    this.feedback = '清晨，你回到了营地。成长和建筑都还在，先补给和修复吧。'
    this.sceneSnapshot = this.makeSceneSnapshot(this.cell); this.publish()
    const persisted = await this.checkpoint()
    this.setPauseReason('failure', false)
    return { accepted: true, persisted: this.repository ? persisted : undefined, message: this.feedback }
  }

  private async story(command: StoryCommand): Promise<CommandResult> {
    if (this.closed || this.storyBusy || !this.catalog || !this.production || [...this.pauses].some(reason => reason !== 'story')) return { accepted: false, reason: '请先恢复营地或等待本次保存完成' }
    const result = applyStoryCommand(this.progression, this.production, this.construction, this.survival, this.catalog, command)
    if (!result.accepted) return result
    this.storyBusy = true
    this.progression = result.state; this.production = result.production; this.feedback = result.message
    this.setPauseReason('story', true)
    this.sceneSnapshot = this.makeSceneSnapshot(this.position()); this.publish()
    try {
      const persisted = await this.checkpoint()
      return { accepted: true, persisted: this.repository ? persisted : undefined, message: result.message }
    } finally { this.storyBusy = false; this.setPauseReason('story', this.progression.dialogue !== null) }
  }

  private position(): Cell {
    return { ...this.point }
  }

  private gameMinutes() { return worldMinutes(this.world, this.elapsedSeconds) }

  private makeUiSnapshot(): UiSnapshot {
    const minutes = Math.floor(this.gameMinutes())
    const hour = Math.floor(minutes / 60) % 24
    return {
      day: Math.floor(minutes / 1440) + 1, hour, minute: minutes % 60, isDay: hour >= 6 && hour < 19,
      player: { ...this.cell }, destination: this.destination ? { ...this.destination } : null,
      activity: this.survival.taming.job?.phase === 'taming' ? 'taming' : this.construction.jobs[0]?.phase === 'building' ? 'building' : this.search ? 'searching' : this.route.length ? 'walking' : 'idle',
      feedback: this.feedback, pauseReasons: [...this.pauses],
      production: this.production, construction: this.construction, protected: this.construction.jobs[0]?.phase === 'building' || this.survival.taming.job?.phase === 'taming', saveStatus: this.saveStatus,
      survival: this.survival, shelter: shelterAt(this.construction, this.cell),
      progression: this.progression,
      warning: this.production ? survivalWarning(this.survival, this.production, this.construction, this.cell, this.gameMinutes()) : '',
    }
  }

  private makeSceneSnapshot(previousPosition: Cell): SceneSnapshot {
    return { position: this.position(), previousPosition, route: this.route.map(cell => ({ ...cell })),
      destination: this.destination ? { ...this.destination } : null,
      elapsedSeconds: this.elapsedSeconds, gameMinutes: this.gameMinutes(), construction: this.construction, survival: this.survival, progression: this.progression }
  }

  private publish() { this.uiSnapshot = this.makeUiSnapshot(); this.listeners.forEach(listener => listener()) }

  syncRealTime() {
    if (!this.production) return
    const previous = this.production.stamina.value
    this.production = { ...this.production, stamina: syncStamina(this.production.stamina, this.now()) }
    if (previous !== this.production.stamina.value) this.publish()
  }

  private restore(data: RuntimeData) {
    const restored = structuredClone(data)
    const next = restored.route[0]
    this.point = restored.motion?.position ?? (next ? {
      x: restored.cell.x + (next.x - restored.cell.x) * restored.progress,
      y: restored.cell.y + (next.y - restored.cell.y) * restored.progress,
    } : restored.cell)
    this.route = restored.route
    this.destination = restored.destination; this.elapsedSeconds = restored.elapsedSeconds
    this.production = restored.production
    this.survival = restored.survival
    this.survival.taming ??= { ordered: false, job: null }
    this.progression = restored.progression
    this.world = progressedWorld(this.world, this.progression)
    if (this.progression.dialogue) this.pauses.add('story')
    else this.pauses.delete('story')
    if (this.production.vitals.hp === 0) this.pauses.add('failure')
    else this.pauses.delete('failure')
    this.construction = restored.construction
    this.navigation = constructionNavigation(this.world, this.construction)
    this.production.stamina = syncStamina(this.production.stamina, this.now())
    this.lastAutomaticSave = this.elapsedSeconds
    this.search = restored.searching && this.destination
      ? new SmoothPathSearch(this.navigation, this.point, this.destination) : null
    if (this.search) this.route = []
    else if (!restored.motion && this.route.length) this.route = smoothPath(this.navigation, this.point, this.route) ?? this.route
    this.feedback = this.construction.jobs[0]?.phase === 'building' ? '继续上次的施工，主角与当前部件受到保护'
      : this.route.length || this.search ? '继续上次的小径' : '欢迎回到林间营地'
  }

  getSaveData(): RuntimeData {
    if (!this.production) throw new Error('物品尚未初始化')
    return structuredClone({ cell: this.cell, progress: 0, motion: { version: 1 as const, position: this.point }, route: this.route, destination: this.destination,
      searching: this.search !== null, elapsedSeconds: this.elapsedSeconds, production: this.production, construction: this.construction, survival: this.survival, progression: this.progression })
  }

  exportSave(): string {
    if (!this.catalog) throw new Error('物品尚未初始化')
    this.syncRealTime()
    const save: SaveEnvelope = { schemaVersion: 4, configVersion: configVersion(this.world, this.catalog),
      revision: this.saveStatus.revision, savedAt: this.now(), data: this.getSaveData() }
    return JSON.stringify(save, null, 2)
  }

  async checkpoint(): Promise<boolean> {
    if (!this.repository) return false
    if (this.closed || this.importing || this.saveStatus.state === 'error' || this.saveStatus.state === 'conflict') return false
    this.syncRealTime()
    this.pendingSaves++
    this.saveStatus = { ...this.saveStatus, state: 'saving', message: '正在保存…' }
    this.publish()
    try {
      const saved = await this.repository.save(this.getSaveData(), this.now())
      this.pendingSaves--
      if (!this.closed) {
        this.saveStatus = { state: this.pendingSaves ? 'saving' : 'saved', message: this.pendingSaves ? '正在保存…' : '已保存到本机', revision: saved.revision, savedAt: saved.savedAt }
        this.publish()
      }
      return true
    } catch (error) {
      this.pendingSaves--
      this.reportSaveError(error)
      return false
    }
  }

  private reportSaveError(error: unknown) {
    if (this.closed) return
    this.saveStatus = { ...this.saveStatus, state: error instanceof SaveError && error.kind === 'conflict' ? 'conflict' : 'error',
      message: error instanceof SaveError ? error.message : '本机保存失败，营地已暂停。请重试，或先导出备份。' }
    this.setPauseReason('save-error', true)
    this.publish()
  }

  async retrySave() {
    if (!this.repository || this.saveStatus.state === 'conflict') return false
    this.repository.retry()
    this.saveStatus = { ...this.saveStatus, state: 'saved' }
    const saved = await this.checkpoint()
    if (saved) this.setPauseReason('save-error', false)
    return saved
  }

  async importSave(text: string): Promise<boolean> {
    if (!this.catalog || !this.repository || this.importing || this.saveStatus.state === 'conflict') return false
    const saved = parseSaveFile(text, this.world, this.catalog)
    saved.data.production.stamina = syncStamina(saved.data.production.stamina, this.now())
    this.importing = true
    this.setPauseReason('importing', true)
    try {
      this.repository.retry()
      const committed = await this.repository.save(saved.data, this.now())
      this.restore(committed.data)
      this.sceneSnapshot = this.makeSceneSnapshot(this.position())
      this.saveStatus = { state: 'saved', message: '已导入并保存备份', revision: committed.revision, savedAt: committed.savedAt }
      this.setPauseReason('save-error', false)
      return true
    } catch (error) { this.reportSaveError(error); return false }
    finally { this.importing = false; this.setPauseReason('importing', false); this.publish() }
  }

  async dispose() { this.closed = true; this.cancelPendingCommands(); await this.repository?.close() }
}
