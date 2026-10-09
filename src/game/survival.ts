import { ENCOUNTERS, encounterCells, reachableEncounter, type SpawnVisibility } from './encounters'
import { releaseTaming, type TamingState } from './taming'
import { blueprintById } from './buildingConfig'
import { buildingAt, buildingSummary, constructionDamage, constructionNavigation, localToWorld, protectedBuildingTarget, releaseJob, type BuildingTarget, type ConstructionState } from './construction'
import { buildingSegments, segmentHp } from './buildingSegments'
import { availableItems, matchRequirements, type ProductionState } from './inventory'
import type { NavigationGrid } from './navigation'
import type { ProductionCatalog } from './productionConfig'
import { ENEMIES, SURVIVAL_RULES as RULES, WEATHER, type EnemyKind, type WeatherId } from './survivalConfig'
import { sameCell, type Cell, type WorldMap } from './world'
import { BOAR_AGGRO_RANGE, REGION_BOARS } from './regionContentConfig'
import { combatResult, COMBAT_SECONDS, COMBAT_RESULT_SECONDS, type CompanionCombat } from './companionCombat'
import { canWalkLine, manualMovePath, moveTarget, pointCell, pointDistance, smoothPath, SmoothPathSearch, walkPath } from './smoothNavigation'

export type ActorTarget = { kind: 'player' } | { kind: 'companion'; id?: string } | { kind: 'enemy'; id: string }
  | ({ kind: 'part'; stand: Cell } & BuildingTarget) | { kind: 'point'; cell: Cell }
export interface Actor {
  cell: Cell; route: Cell[]; progress: number; target: ActorTarget | null; cooldown: number
  /** Continuous world position; absent on legacy cell/progress saves. */
  motion?: { version: 1; position: Cell }
}
export interface Enemy extends Actor { id: string; kind: EnemyKind; hp: number; residentId?: string; roaming?: boolean; tameable?: boolean; alertSeconds?: number; patrol?: { index: number; remaining: number } }
export interface Companion extends Actor {
  id?: string; kind?: EnemyKind
  status: 'wild' | 'active' | 'injured' | 'recovering'
  hp: number; mode: 'guard' | 'follow' | 'move'; guard: Cell; orderedEnemy: string | null; recoveryRemaining: number
}
export interface Failure {
  id: number; day: number; cause: 'enemy' | 'environment'; losses: { id: string; itemId: number }[]
}
export interface SurvivalState {
  /** Missing in older schema 4 saves means unlit. */
  torchRemaining?: number
  weather: WeatherId; forecast: WeatherId; weatherDay: number; randomState: number
  environmentRemaining: number; decisionRemaining: number; spawnRemaining: number; raidNight: number
  nextEnemyId: number; enemies: Enemy[]; companion: Companion; recruits?: Companion[]; taming: TamingState
  duel: CompanionCombat | null
  failure: Failure | null; failureCount: number; rescuedCount: number; resting: boolean
}
export type SurvivalCommand = ({ type: 'companion-treat' } | { type: 'player-rest' }
  | { type: 'companion-mode'; mode: 'guard' | 'follow'; guard?: Cell }
  | { type: 'companion-move'; target: Cell }
  | { type: 'companion-attack'; enemyId: string }
  | { type: 'rescue' }) & { companionId?: string }
export const companions = (state: SurvivalState) => [state.companion, ...(state.recruits ?? [])]
export const companionId = (buddy: Companion) => buddy.id ?? 'companion'
export const companionById = (state: SurvivalState, id = 'companion') => companions(state).find(b => companionId(b) === id)
export const companionRules = (buddy: Pick<Companion, 'kind'>) => buddy.kind ? { ...RULES.companion, ...ENEMIES[buddy.kind] } : RULES.companion
export const companionName = (buddy: Pick<Companion, 'kind'>) => buddy.kind ? ENEMIES[buddy.kind].name : RULES.companion.name
export const companionLocked = (state: SurvivalState, buddy: Companion) => !!state.duel && (state.duel.companionId ?? 'companion') === companionId(buddy)
export const distance = (a: Cell, b: Cell) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
export const nearbyThreats = (state: SurvivalState, player: Cell) => state.enemies.filter(enemy => !enemy.tameable && (!enemy.residentId || distance(enemy.cell, player) <= BOAR_AGGRO_RANGE + 1))
export const dayTime = (minutes: number) => minutes % 1440 >= 360 && minutes % 1440 < 1140
export const worldMinutes = (world: WorldMap, elapsed: number) => Math.round((world.config.initialHour * 60 + elapsed * 1440 / world.config.dayDurationSeconds) * 1e6) / 1e6
const weatherDay = (minutes: number) => Math.floor((minutes - 360) / 1440)
const nightKey = (minutes: number) => Math.floor((minutes - 1140) / 1440) + 1
const blankActor = (cell: Cell): Actor => ({ cell: { ...cell }, route: [], progress: 0, target: null, cooldown: 0 })
export function createSurvival(world: WorldMap, elapsed = 0): SurvivalState {
  const home = world.config.spawn
  const cell = [{ x: home.x - 1, y: home.y }, { x: home.x + 1, y: home.y }, home].find(cell => world.isWalkable(cell))!
  return { weather: 'sunny', forecast: 'cloudy', weatherDay: weatherDay(worldMinutes(world, elapsed)), randomState: 0x74f18,
    environmentRemaining: RULES.environmentInterval, decisionRemaining: 0, spawnRemaining: RULES.firstSpawnDelay,
    raidNight: dayTime(worldMinutes(world, elapsed)) ? 0 : nightKey(worldMinutes(world, elapsed)), nextEnemyId: 1, enemies: [],
    companion: { ...blankActor(cell), status: 'wild', hp: RULES.companion.hp, mode: 'guard', guard: { ...home }, orderedEnemy: null, recoveryRemaining: 0 },
    recruits: [], failure: null, failureCount: 0, rescuedCount: 0, resting: false, taming: { ordered: false, job: null }, duel: null }
}
function random(state: SurvivalState) {
  let x = state.randomState; x ^= x << 13; x ^= x >>> 17; x ^= x << 5
  state.randomState = x >>> 0; return state.randomState / 4294967296
}
export function shelterAt(construction: ConstructionState, cell: Cell) {
  const building = buildingAt(construction, cell)
  return building ? { ...buildingSummary(building), buildingId: building.id } : { rainproof: false, enclosed: false, rest: false, complete: false, builtCount: 0, buildingId: null }
}
export function actorPosition(actor: Actor): Cell {
  if (actor.motion) return actor.motion.position
  const next = actor.route[0]
  return next ? { x: actor.cell.x + (next.x - actor.cell.x) * actor.progress, y: actor.cell.y + (next.y - actor.cell.y) * actor.progress } : actor.cell
}
function path(grid: NavigationGrid, from: Cell, to: Cell, world: WorldMap): Cell[] | null {
  const result = new SmoothPathSearch(grid, from, to).advance(world.config.chunks.length * 256 + 1)
  return result.status === 'found' ? result.path : null
}
function touching(grid: NavigationGrid, a: Cell, b: Cell) {
  return pointDistance(a, b) <= 1 + 1e-8 && canWalkLine(grid, a, b)
}
function stop(actor: Actor) {
  const position = { ...actorPosition(actor) }
  actor.motion = { version: 1, position }; actor.cell = pointCell(position)
  actor.route = []; actor.progress = 0; actor.target = null
}
function stopCompanion(buddy: Companion) {
  const position = { ...actorPosition(buddy) }
  // Wild animals stay in their original cells for the taming work-position rules.
  if (buddy.status !== 'wild') buddy.motion = { version: 1, position }
  buddy.cell = pointCell(position); buddy.route = []; buddy.progress = 0; buddy.target = null
}
function routeClear(grid: NavigationGrid, position: Cell, route: readonly Cell[]) {
  let from = position
  for (const next of route) { if (!canWalkLine(grid, from, next)) return false; from = next }
  return true
}
function setRoute(actor: Actor, target: ActorTarget, destination: Cell, grid: NavigationGrid, world: WorldMap) {
  const position = actorPosition(actor)
  const last = actor.route[actor.route.length - 1] ?? position
  if (actor.motion && sameCell(last, destination) && routeClear(grid, position, actor.route)) {
    actor.target = target; return true
  }
  const route = path(grid, position, destination, world)
  if (!route) return false
  actor.motion = { version: 1, position: { ...position } }; actor.cell = pointCell(position)
  actor.route = route; actor.progress = 0; actor.target = target
  return true
}
function prepareMotion(actor: Actor, grid: NavigationGrid) {
  const position = actorPosition(actor)
  const safe = sameCell(position, actor.cell) ? position : moveTarget(grid, position)
  // A newly repaired edge may overlap the footprint. Keep the actor on its current side.
  if (safe && !sameCell(safe, position)) {
    actor.motion = { version: 1, position: safe }; actor.cell = pointCell(safe); actor.progress = 0
  }
  if (!actor.motion) {
    actor.route = smoothPath(grid, position, actor.route) ?? []
    actor.motion = { version: 1, position: { ...position } }; actor.cell = pointCell(position); actor.progress = 0
  }
}
function moveActor(actor: Actor, grid: NavigationGrid, world: WorldMap, speed: number, dt: number) {
  if (!actor.route.length) return
  // Check the entire remaining route, including short waypoints crossed in the same step.
  if (!routeClear(grid, actorPosition(actor), actor.route)) {
    const destination = actor.route[actor.route.length - 1], target = actor.target
    if (!target || !setRoute(actor, target, destination, grid, world)) { stop(actor); return }
  }
  const moved = walkPath(actorPosition(actor), actor.route, speed * dt)
  actor.motion!.position = moved.position; actor.cell = pointCell(moved.position); actor.route = moved.route
}
/** The same territory restriction is used for search, swept movement and save validation. */
export function enemyNavigation(world: WorldMap, grid: NavigationGrid, residentId?: string): NavigationGrid {
  const spawn = REGION_BOARS.find(s => s.id === residentId)
  if (!spawn) return grid
  const inside = (cell: Cell) => world.chunkAt(cell)?.id === spawn.regionId
  return { isWalkable: cell => inside(cell) && grid.isWalkable(cell),
    canStep: (a, b) => inside(a) && inside(b) && grid.canStep(a, b) }
}
function targetCell(target: ActorTarget | null, state: SurvivalState, player: Cell, construction: ConstructionState, extraProtection = false): Cell | null {
  if (!target) return null
  if (target.kind === 'player') return extraProtection || construction.jobs[0]?.phase === 'building' || state.taming.job?.phase === 'taming' ? null : player
  if (target.kind === 'companion') {
    const buddy = companionById(state, target.id)
    return buddy && !companionLocked(state, buddy) && buddy.status === 'active' ? actorPosition(buddy) : null
  }
  if (target.kind === 'enemy') {
    const enemy = state.enemies.find(enemy => enemy.id === target.id && enemy.hp > 0)
    return enemy && state.duel?.enemy.id !== target.id ? actorPosition(enemy) : null
  }
  if (target.kind === 'point') return target.cell
  const building = construction.buildings.find(building => building.id === target.buildingId)
  const part = building?.parts[target.partId]
  if (!building || !part?.built) return null
  if (!target.segmentId) {
    const blueprint = blueprintById(building.blueprintId)!, config = blueprint.parts.find(part => part.id === target.partId)!
    // Legacy attackers already have a stand position: bind them to the segment beside it.
    const segments = buildingSegments(blueprint, config)
    segments.sort((a, b) => Math.min(...[a.cell, ...(a.edge ? [a.edge.to] : [])].map(cell => distance(localToWorld(building, cell), target.stand)))
      - Math.min(...[b.cell, ...(b.edge ? [b.edge.to] : [])].map(cell => distance(localToWorld(building, cell), target.stand))))
    target.segmentId = segments[0].id
  }
  return segmentHp(part, target.segmentId) > 0 && !protectedBuildingTarget(construction, target) ? target.stand : null
}
function planEnemy(enemy: Enemy, state: SurvivalState, player: Cell, construction: ConstructionState, world: WorldMap, grid: NavigationGrid, extraProtection: boolean) {
  if (state.taming.targetId === enemy.id && state.taming.job) { stop(enemy); return }
  if (enemy.tameable) {
    if (pointDistance(actorPosition(enemy), player) <= 2.5) { stop(enemy); return }
    const destination = moveTarget(grid, player)
    if (!destination || !setRoute(enemy, { kind: 'point', cell: destination }, destination, grid, world)) stop(enemy)
    return
  }
  if (enemy.residentId) {
    const spawn = REGION_BOARS.find(s => s.id === enemy.residentId)!
    const targets: { target: ActorTarget; cell: Cell }[] = []
    if (!extraProtection && construction.jobs[0]?.phase !== 'building' && state.taming.job?.phase !== 'taming') targets.push({ target: { kind: 'player' }, cell: player })
    for (const buddy of companions(state)) if (!companionLocked(state, buddy) && buddy.status === 'active') targets.push({ target: { kind: 'companion', id: companionId(buddy) }, cell: actorPosition(buddy) })
    for (const candidate of targets) {
      const destination = moveTarget(grid, candidate.cell)
      if (destination && distance(enemy.cell, pointCell(candidate.cell)) <= BOAR_AGGRO_RANGE
        && setRoute(enemy, candidate.target, destination, grid, world)) return
    }
    enemy.patrol ??= { index: 0, remaining: 0 }
    if (enemy.patrol.remaining > 0) { stop(enemy); return }
    if (enemy.target?.kind === 'point' && sameCell(actorPosition(enemy), enemy.target.cell)) {
      enemy.patrol.index = (enemy.patrol.index + 1) % 4; enemy.patrol.remaining = 2
      stop(enemy); return
    }
    // Patrol within two cells of the home point; pursuit still uses the existing regional aggro rules.
    const offsets = [[2, 0], [0, 2], [-2, 0], [0, -2]]
    const nearHome = (cell: Cell) => Math.max(Math.abs(cell.x - spawn.cell.x), Math.abs(cell.y - spawn.cell.y)) <= 2
    const patrolGrid: NavigationGrid = { isWalkable: cell => nearHome(cell) && grid.isWalkable(cell),
      canStep: (a, b) => nearHome(a) && nearHome(b) && grid.canStep(a, b) }
    if (!nearHome(enemy.cell)) {
      if (!setRoute(enemy, { kind: 'point', cell: spawn.cell }, spawn.cell, grid, world)) stop(enemy)
      return
    }
    for (let i = 0; i < offsets.length; i++) {
      const index = (enemy.patrol.index + i) % offsets.length, [x, y] = offsets[index]
      const destination = { x: spawn.cell.x + x, y: spawn.cell.y + y }
      if (setRoute(enemy, { kind: 'point', cell: destination }, destination, patrolGrid, world)) { enemy.patrol.index = index; return }
    }
    if (!setRoute(enemy, { kind: 'point', cell: spawn.cell }, spawn.cell, grid, world)) stop(enemy)
    return
  }
  // Keep actor engagements, but reconsider structures when a defender comes within reach.
  const current = targetCell(enemy.target, state, player, construction, extraProtection)
  if (current && (enemy.target?.kind === 'player' || enemy.target?.kind === 'companion') && touching(grid, actorPosition(enemy), current)) return
  const targets: { target: ActorTarget; cell: Cell }[] = []
  for (const buddy of companions(state)) if (!companionLocked(state, buddy) && buddy.status === 'active' && distance(enemy.cell, buddy.cell) <= ENEMIES[enemy.kind].sight) targets.push({ target: { kind: 'companion', id: companionId(buddy) }, cell: actorPosition(buddy) })
  if (!extraProtection && construction.jobs[0]?.phase !== 'building' && state.taming.job?.phase !== 'taming' && (enemy.roaming || distance(enemy.cell, pointCell(player)) <= ENEMIES[enemy.kind].sight)) targets.push({ target: { kind: 'player' }, cell: player })
  for (const candidate of targets) {
    const destination = moveTarget(grid, candidate.cell)
    if (destination && setRoute(enemy, candidate.target, destination, grid, world)) return
  }
  const home = buildingAt(construction, pointCell(player)) ?? construction.buildings.find(building => building.parts.foundation.built)
  const goal = enemy.roaming ? player : home ? localToWorld(home, { x: 1, y: 1 }) : world.config.spawn
  // Use an existing opening before breaking additional walls.
  if (distance(enemy.cell, goal) > 1 && setRoute(enemy, { kind: 'point', cell: goal }, goal, grid, world)) return
  // At an intact segment the route cost is already zero; retain it after reconsidering nearby actors/openings.
  if (current && enemy.target?.kind === 'part' && sameCell(actorPosition(enemy), current)) return
  const candidates: { target: Extract<ActorTarget, { kind: 'part' }>; cost: number }[] = []
  for (const building of home ? [home] : []) for (const config of blueprintById(building.blueprintId)!.parts) {
    const part = building.parts[config.id]
    if (!part.built) continue
    for (const segment of buildingSegments(blueprintById(building.blueprintId)!, config)) {
      const target = { kind: 'part' as const, buildingId: building.id, partId: config.id, segmentId: segment.id }
      if (segmentHp(part, segment.id) <= 0 || protectedBuildingTarget(construction, target)) continue
      const stands = segment.edge ? [segment.edge.from, segment.edge.to] : [segment.cell]
      for (const cell of stands) {
        const stand = localToWorld(building, cell)
        const position = actorPosition(enemy), route = path(grid, position, stand, world)
        if (route) candidates.push({ target: { ...target, stand },
          cost: route.reduce((sum, point, index) => sum + pointDistance(index ? route[index - 1] : position, point), 0) })
      }
    }
  }
  candidates.sort((a, b) => a.cost - b.cost)
  if (candidates[0]) { setRoute(enemy, candidates[0].target, candidates[0].target.stand, grid, world); return }
  if (!setRoute(enemy, { kind: 'point', cell: goal }, goal, grid, world)) stop(enemy)
}
function planCompanion(state: SurvivalState, buddy: Companion, player: Cell, world: WorldMap, grid: NavigationGrid) {
  if (buddy.status !== 'active') { stopCompanion(buddy); return }
  if (buddy.mode === 'move') {
    if (sameCell(actorPosition(buddy), buddy.guard)) buddy.mode = 'guard'
    else if (setRoute(buddy, { kind: 'point', cell: buddy.guard }, buddy.guard, grid, world)) return
    else { buddy.mode = 'guard'; buddy.guard = { ...actorPosition(buddy) }; stopCompanion(buddy); return }
  }
  const anchor = buddy.mode === 'follow' ? player : buddy.guard
  const manual = state.enemies.find(enemy => enemy.id === buddy.orderedEnemy && !enemy.tameable && enemy.id !== state.duel?.enemy.id)
  if (!manual) buddy.orderedEnemy = null
  const choices = manual ? [manual] : state.enemies.filter(enemy => !enemy.tameable && enemy.id !== state.duel?.enemy.id && distance(anchor, enemy.cell) <= RULES.companion.radius)
    .sort((a, b) => Number(b.id === (buddy.target?.kind === 'enemy' ? buddy.target.id : '')) - Number(a.id === (buddy.target?.kind === 'enemy' ? buddy.target.id : '')) || distance(buddy.cell, a.cell) - distance(buddy.cell, b.cell))
  for (const enemy of choices) {
    const destination = moveTarget(grid, actorPosition(enemy))
    if (destination && setRoute(buddy, { kind: 'enemy', id: enemy.id }, destination, grid, world)) return
  }
  const destination = moveTarget(grid, anchor)
  if (!destination || !setRoute(buddy, { kind: 'point', cell: destination }, destination, grid, world)) stopCompanion(buddy)
}

/** Commit once; the result phase also keeps a render-only snapshot of a defeated enemy. */
function settleCombat(state: SurvivalState, production: ProductionState): ProductionState {
  const duel = state.duel
  if (!duel || duel.phase !== 'fighting') return production
  const buddy = companionById(state, duel.companionId)!, enemy = state.enemies.find(enemy => enemy.id === duel.enemy.id)!
  buddy.hp = duel.result.companionHp; buddy.cooldown = duel.result.companionCooldown
  enemy.hp = duel.result.enemyHp; enemy.cooldown = duel.result.enemyCooldown
  if (enemy.hp === 0) {
    state.enemies = state.enemies.filter(other => other.id !== enemy.id)
    production = { ...production, inventory: { ...production.inventory, gold: production.inventory.gold + ENEMIES[enemy.kind].gold } }
  }
  if (buddy.hp === 0) { buddy.status = 'injured'; buddy.recoveryRemaining = 0 }
  buddy.orderedEnemy = null
  // Keep fractional positions through the poses. Replanning resumes only after the result.
  buddy.target = null; enemy.target = null
  duel.phase = 'result'; duel.remaining = COMBAT_RESULT_SECONDS
  state.decisionRemaining = 0
  return production
}

/** Pure fixed-step simulation. Movement, needs, combat presentation and damage share one clock. */
export function advanceSurvival(original: SurvivalState, source: ProductionState, originalConstruction: ConstructionState,
  world: WorldMap, player: Cell, minutes: number, dt: number, extraProtection = false, playerPosition = player, visible?: SpawnVisibility) {
  const state = structuredClone(original)
  let production = { ...source, vitals: { ...source.vitals } }, construction = originalConstruction
  let critical = false, message: string | undefined, cause: Failure['cause'] = 'environment'
  const day = dayTime(minutes)
  if (weatherDay(minutes) > state.weatherDay) {
    state.weatherDay = weatherDay(minutes); state.weather = state.forecast
    state.forecast = (Object.keys(WEATHER) as WeatherId[])[Math.floor(random(state) * 3)]
    message = `天亮了，今日${WEATHER[state.weather].name}，明日预计${WEATHER[state.forecast].name}`; critical = true
  }
  // Dawn has priority over the attack clock. Retreats give no defeat reward.
  if (day && state.enemies.some(enemy => !enemy.residentId && !enemy.roaming && enemy.id !== state.duel?.enemy.id)) {
    state.enemies = state.enemies.filter(enemy => enemy.residentId || enemy.roaming || enemy.id === state.duel?.enemy.id)
    if (!state.enemies.some(enemy => enemy.id === state.companion.orderedEnemy)) state.companion.orderedEnemy = null
    if (!state.duel) stopCompanion(state.companion)
    critical = true
  }
  if (!day && state.raidNight !== nightKey(minutes)) {
    state.raidNight = nightKey(minutes); state.spawnRemaining = RULES.firstSpawnDelay; critical = true; message = '天黑了，林外传来动静。让伙伴驻守，准备补给。'
  }
  state.spawnRemaining -= dt
  if (state.spawnRemaining <= 0) {
    state.spawnRemaining = day ? ENCOUNTERS.dayInterval : ENCOUNTERS.nightInterval
    if (state.enemies.filter(e => !e.residentId).length < (day ? ENCOUNTERS.dayLimit : ENCOUNTERS.nightLimit)) {
      const entries = encounterCells(world, construction, state, playerPosition, visible)
      let entry: Cell | undefined
      // Try candidates in a deterministic randomized order; never spawn in a disconnected pocket.
      while (entries.length) {
        const candidate = entries.splice(Math.floor(random(state) * entries.length), 1)[0]
        if (reachableEncounter(world, construction, candidate, playerPosition)) { entry = candidate; break }
      }
      if (entry) {
        const kind: EnemyKind = random(state) < .7 ? 'prowler' : 'boar'
        state.enemies.push({ ...blankActor(entry), id: `e${state.nextEnemyId++}`, kind, hp: ENEMIES[kind].hp,
          roaming: true, tameable: random(state) < ENCOUNTERS.tameChance })
        state.decisionRemaining = 0; critical = true
      } else state.spawnRemaining = ENCOUNTERS.retrySeconds
    }
  }
  const shelter = shelterAt(construction, player), vitals = production.vitals
  vitals.hunger = Math.max(0, vitals.hunger - RULES.hungerPerDay * dt / world.config.dayDurationSeconds)
  vitals.water = Math.max(0, vitals.water - RULES.waterPerDay * dt / world.config.dayDurationSeconds)
  const targetTemperature = shelter.enclosed && shelter.rainproof ? 50 : shelter.rainproof ? 35 : WEATHER[state.weather][day ? 'dayTemperature' : 'nightTemperature']
  vitals.temperature += Math.sign(targetTemperature - vitals.temperature) * Math.min(Math.abs(targetTemperature - vitals.temperature), RULES.temperatureRate * dt)
  const protectedPlayer = extraProtection || construction.jobs[0]?.phase === 'building' || state.taming.job?.phase === 'taming'
  const dangerous = vitals.hunger < 20 || vitals.water < 20 || vitals.temperature < 20 || vitals.temperature > 80
  state.environmentRemaining = dangerous ? state.environmentRemaining - dt : RULES.environmentInterval
  if (state.environmentRemaining <= 0) {
    state.environmentRemaining = RULES.environmentInterval
    if (!protectedPlayer) vitals.hp = Math.max(0, vitals.hp - RULES.environmentDamage)
  }
  if (state.resting && (!shelter.rest || !shelter.rainproof || !shelter.enclosed || nearbyThreats(state, player).length || protectedPlayer || dangerous)) state.resting = false
  if (state.resting) vitals.hp = Math.min(100, vitals.hp + dt * .5)
  if (state.duel) {
    state.duel.remaining = Math.max(0, state.duel.remaining - dt)
    if (state.duel.remaining <= 1e-8) {
      if (state.duel.phase === 'fighting') {
        production = settleCombat(state, production)
        if (companionById(state, state.duel!.companionId)!.status === 'injured') message = `${companionName(companionById(state, state.duel!.companionId)!)}受伤倒下了，需要草药绷带和休养。`
      } else { state.duel = null; state.decisionRemaining = 0 }
      critical = true
    }
  }
  for (const buddy of companions(state)) if (buddy.status === 'recovering') {
    buddy.recoveryRemaining = Math.max(0, buddy.recoveryRemaining - dt)
    if (buddy.recoveryRemaining === 0) { buddy.status = 'active'; buddy.hp = companionRules(buddy).hp * .5; buddy.mode = 'guard'; buddy.guard = { ...actorPosition(buddy) }; critical = true; message = `${companionName(buddy)}已经恢复行动，可以继续下达指令。` }
  }
  const friendly = constructionNavigation(world, construction), hostile = constructionNavigation(world, construction, 'enemy')
  for (const enemy of state.enemies) {
    if (!enemy.tameable) continue
    // Started work is guaranteed to finish; merely reserving food does not pause patience.
    if (state.taming.targetId === enemy.id && state.taming.job?.phase === 'taming') { delete enemy.alertSeconds; continue }
    if (pointDistance(actorPosition(enemy), playerPosition) > ENCOUNTERS.alertRange) {
      if (enemy.alertSeconds !== undefined) { delete enemy.alertSeconds; critical = true }
      continue
    }
    const elapsed = enemy.alertSeconds ?? 0
    enemy.alertSeconds = elapsed + dt
    if (elapsed === 0 && dt > 0) critical = true
    if (enemy.alertSeconds < ENCOUNTERS.patienceSeconds - 1e-8) continue
    enemy.tameable = false
    delete enemy.alertSeconds
    stop(enemy)
    if (state.taming.targetId === enemy.id) {
      // releaseTaming mutates inventory reservations, so take ownership of the inventory first.
      production = structuredClone(production)
      releaseTaming(state, production, false)
    }
    state.decisionRemaining = 0
    critical = true; message = `${ENEMIES[enemy.kind].name}被激怒了，已无法驯服！`
  }
  const enemyGrids = new Map(state.enemies.map(enemy => [enemy.id, enemyNavigation(world, hostile, enemy.residentId)]))
  for (const buddy of companions(state)) if (!companionLocked(state, buddy) && buddy.status === 'active') prepareMotion(buddy, friendly)
  for (const enemy of state.enemies) if (enemy.id !== state.duel?.enemy.id) prepareMotion(enemy, enemyGrids.get(enemy.id)!)
  state.decisionRemaining -= dt
  if (state.decisionRemaining <= 0) {
    state.decisionRemaining = RULES.decisionInterval
    for (const buddy of companions(state)) if (!companionLocked(state, buddy)) planCompanion(state, buddy, playerPosition, world, friendly)
    for (const enemy of state.enemies) if (enemy.id !== state.duel?.enemy.id) planEnemy(enemy, state, playerPosition, construction, world, enemyGrids.get(enemy.id)!, extraProtection)
  }
  for (const buddy of companions(state)) if (!companionLocked(state, buddy)) {
    if (buddy.status === 'active') moveActor(buddy, friendly, world, companionRules(buddy).speed, dt)
    buddy.cooldown = Math.max(0, buddy.cooldown - dt)
  }
  for (const enemy of state.enemies) if (enemy.id !== state.duel?.enemy.id) {
    if (enemy.patrol) enemy.patrol.remaining = Math.max(0, enemy.patrol.remaining - dt)
    moveActor(enemy, enemyGrids.get(enemy.id)!, world, ENEMIES[enemy.kind].speed, dt); enemy.cooldown = Math.max(0, enemy.cooldown - dt)
  }
  for (const buddy of companions(state)) if (!state.duel && buddy.status === 'active') {
    const enemy = state.enemies.find(enemy => !enemy.tameable && (buddy.target?.kind === 'enemy' && buddy.target.id === enemy.id || enemy.target?.kind === 'companion' && (enemy.target.id ?? 'companion') === companionId(buddy))
      && touching(hostile, actorPosition(buddy), actorPosition(enemy)))
    if (enemy) {
      state.duel = { companionId: companionId(buddy), phase: 'fighting', remaining: COMBAT_SECONDS, companion: structuredClone(buddy), enemy: structuredClone(enemy), result: combatResult(buddy, enemy) }
      state.decisionRemaining = 0; critical = true
    }
  }
  const hits: { target: ActorTarget; amount: number }[] = []
  const attack = (actor: Actor, amount: number, interval: number) => {
    const cell = targetCell(actor.target, state, playerPosition, construction, extraProtection)
    if (!actor.target || (actor.target.kind !== 'player' && actor.target.kind !== 'part') || !cell || actor.cooldown > .000001) return
    const inRange = actor.target.kind === 'part' ? sameCell(actorPosition(actor), cell) : touching(hostile, actorPosition(actor), cell)
    if (inRange) { actor.cooldown = interval; hits.push({ target: actor.target, amount }) }
  }
  for (const enemy of state.enemies) if (enemy.id !== state.duel?.enemy.id && !enemy.tameable && (!day || enemy.residentId || enemy.roaming)) attack(enemy, ENEMIES[enemy.kind].attack, ENEMIES[enemy.kind].interval)
  // Collect every hit first, then apply: neither side gains an iteration-order advantage.
  for (const hit of hits) {
    if (hit.target.kind === 'player' || hit.target.kind === 'part') {
      const result = constructionDamage(construction, production, hit.target.kind === 'player' ? 'player' : hit.target, hit.amount)
      construction = result.state; production = result.production
      if (hit.target.kind === 'player') { cause = 'enemy'; state.resting = false }
    }
  }
  if (hits.length) critical = true
  return { state, production, construction, critical, message, cause }
}

export function applySurvivalCommand(original: SurvivalState, source: ProductionState, construction: ConstructionState, world: WorldMap,
  player: Cell, _minutes: number, command: Exclude<SurvivalCommand, { type: 'rescue' }>) {
  const state = structuredClone(original), production = structuredClone(source), buddy = companionById(state, command.companionId)
  const reject = (reason: string) => ({ accepted: false as const, reason })
  const accept = (message: string) => ({ accepted: true as const, state, production, message })
  if (!buddy) return reject('伙伴不存在')
  const rules = companionRules(buddy)
  const consume = (requirements: readonly number[]) => {
    const ids = matchRequirements(production.inventory, requirements)
    if (!ids) return false
    for (const id of ids) {
      const item = production.inventory.items[id]
      if (item.location.kind === 'board') production.inventory.board[item.location.index].instanceId = null
      else production.inventory.warehouse[item.location.index] = null
      delete production.inventory.items[id]
    }
    return true
  }
  if (command.type === 'companion-treat') {
    if (companionLocked(state, buddy)) return reject(`${companionName(buddy)}正在战斗，请等战斗结束`)
    if (buddy.status === 'wild' || buddy.status === 'recovering') return reject('现在不需要再次用药')
    if (buddy.status === 'active' && buddy.hp >= rules.hp) return reject(`${companionName(buddy)}状态很好，不需要用药`)
    if (!consume(RULES.companion.medicineItems)) return reject('需要 1 份草药绷带，可在合成工坊准备')
    if (buddy.status === 'injured') { buddy.status = 'recovering'; buddy.recoveryRemaining = RULES.companion.recoverySeconds }
    else buddy.hp = Math.min(rules.hp, buddy.hp + 40)
    return accept(buddy.status === 'recovering' ? `已经包扎，${companionName(buddy)}需要休养 60 秒` : `${companionName(buddy)}恢复了 40 点生命`)
  }
  if (command.type === 'player-rest') {
    if (state.resting) { state.resting = false; return accept('结束休养') }
    const shelter = shelterAt(construction, player)
    if (!shelter.rest || !shelter.enclosed || !shelter.rainproof) return reject('需要进入有床、门墙和屋顶完好的木屋')
    if (nearbyThreats(state, player).length || construction.jobs.length || state.taming.job) return reject('当前不能安心休养，请先处理袭击或工程')
    state.resting = true; return accept('正在床边休养，饥渴仍会消耗')
  }
  if (buddy.status !== 'active') return reject(`${companionName(buddy)}还不能参战，请先救助或治疗`)
  if (companionLocked(state, buddy)) return reject(`${companionName(buddy)}正在战斗，请等战斗结束`)
  if (command.type === 'companion-move') {
    const grid = constructionNavigation(world, construction), position = actorPosition(buddy)
    const route = manualMovePath(grid, position, command.target, world.config.chunks.length * 256)
    if (!route) return reject('伙伴当前位置暂时无法移动')
    buddy.motion = { version: 1, position: { ...position } }; buddy.cell = pointCell(position)
    buddy.route = route.path; buddy.progress = 0; buddy.target = { kind: 'point', cell: { ...route.destination } }
    buddy.mode = 'move'; buddy.guard = { ...route.destination }; buddy.orderedEnemy = null
    state.decisionRemaining = 0
    return accept(`${companionName(buddy)}正在前往指定位置`)
  }
  if (command.type === 'companion-mode') {
    const guard = command.guard ?? player
    const grid = constructionNavigation(world, construction), destination = moveTarget(grid, guard)
    if (!['guard', 'follow'].includes(command.mode) || !destination
      || !setRoute(buddy, { kind: 'point', cell: destination }, destination, grid, world)) return reject('伙伴无法到达该位置')
    buddy.mode = command.mode; buddy.guard = destination; buddy.orderedEnemy = null
    state.decisionRemaining = 0; return accept(command.mode === 'guard' ? `${companionName(buddy)}将在这里驻守` : `${companionName(buddy)}开始跟随`)
  }
  const enemy = state.enemies.find(enemy => enemy.id === command.enemyId)
  const grid = constructionNavigation(world, construction), destination = enemy && moveTarget(grid, actorPosition(enemy))
  if (!enemy || enemy.tameable || enemy.id === state.duel?.enemy.id || !destination || !setRoute(buddy, { kind: 'enemy', id: enemy.id }, destination, grid, world)) return reject('这个目标已离开或无法到达')
  if (buddy.mode === 'move') { buddy.mode = 'guard'; buddy.guard = { ...actorPosition(buddy) } }
  buddy.orderedEnemy = enemy.id; state.decisionRemaining = 0
  return accept(`${companionName(buddy)}正在前往拦截${ENEMIES[enemy.kind].name}`)
}

export function beginFailure(original: SurvivalState, source: ProductionState, originalConstruction: ConstructionState, catalog: ProductionCatalog, minutes: number, cause: Failure['cause']) {
  const state = structuredClone(original), production = structuredClone(source), construction = structuredClone(originalConstruction)
  if (state.failure) return { state, production, construction }
  releaseTaming(state, production, state.taming.ordered)
  for (const job of [...construction.jobs]) if (job.phase !== 'building') releaseJob(construction, production.inventory, job.orderId)
  const losses = availableItems(production.inventory).filter(item => {
    const config = catalog.itemById.get(item.itemId)!
    return config.itemType === 'normal' && config.level <= RULES.lossMaxLevel
  }).sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1))).slice(0, RULES.lossLimit).map(item => ({ id: item.id, itemId: item.itemId }))
  state.failure = { id: ++state.failureCount, day: Math.floor(minutes / 1440) + 1, cause, losses }; state.resting = false
  return { state, production, construction }
}
export function acceptRescue(original: SurvivalState, source: ProductionState, world: WorldMap, elapsedSeconds: number) {
  const state = structuredClone(original), failure = state.failure!
  let production = structuredClone(source)
  // A player defeat cannot reroll a fight or erase its already determined cost/reward.
  production = settleCombat(state, production); state.duel = null
  for (const loss of failure.losses) {
    const item = production.inventory.items[loss.id]
    if (!item || item.itemId !== loss.itemId) continue
    if (item.location.kind === 'board') production.inventory.board[item.location.index].instanceId = null
    else production.inventory.warehouse[item.location.index] = null
    delete production.inventory.items[item.id]
  }
  production.vitals = { hp: RULES.rescueHp, hunger: 60, water: 60, temperature: 50 }
  state.rescuedCount = failure.id; state.failure = null
  if (state.taming.targetId) releaseTaming(state, production, false)
  state.enemies = state.enemies.filter(enemy => enemy.residentId)
  for (const enemy of state.enemies) { stop(enemy); enemy.cooldown = 0 }
  state.resting = false
  state.environmentRemaining = RULES.environmentInterval; state.decisionRemaining = 0
  for (const buddy of companions(state)) {
    buddy.orderedEnemy = null; Object.assign(buddy, blankActor(world.config.spawn), { guard: { ...world.config.spawn } })
    delete buddy.motion
    if (buddy.mode === 'move') buddy.mode = 'guard'
  }
  state.spawnRemaining = ENCOUNTERS.dayInterval
  const dawnMinutes = (weatherDay(worldMinutes(world, elapsedSeconds)) + 1) * 1440 + 360
  state.weather = state.forecast; state.weatherDay = weatherDay(dawnMinutes)
  state.forecast = (Object.keys(WEATHER) as WeatherId[])[Math.floor(random(state) * 3)]
  return { state, production, elapsedSeconds: (dawnMinutes - world.config.initialHour * 60) * world.config.dayDurationSeconds / 1440 }
}

export function survivalWarning(state: SurvivalState, production: ProductionState, construction: ConstructionState, player: Cell, minutes: number) {
  if (state.failure) return '你倒下了，等待营地救援'
  if (production.vitals.hp <= 30) return '生命偏低，尽快使用药品或进入木屋休养'
  if (production.vitals.water < 40) return production.vitals.water < 20 ? '严重缺水，正在失去生命' : '水分不足，准备饮水'
  if (production.vitals.hunger < 40) return production.vitals.hunger < 20 ? '过于饥饿，正在失去生命' : '饱食偏低，准备食物'
  if (production.vitals.temperature < 30) return '天气寒冷，进入有门墙和屋顶的住所保温'
  if (production.vitals.temperature > 70) return '体感过热，寻找遮蔽处降温'
  if (state.companion.status === 'injured') return '伙伴受伤，准备草药绷带救治'
  if (nearbyThreats(state, player).length) return shelterAt(construction, player).enclosed ? '附近有敌人，留意门墙耐久' : '附近有敌人，尽快进入住所或安排伙伴守卫'
  if (!dayTime(minutes)) return '夜间仍会有敌人到来，留好补给'
  if (minutes % 1440 >= 1080) return '即将入夜，检查门墙并安排伙伴驻守'
  return state.companion.status === 'wild' ? '营火旁有一只小犬，带一份 3 级野餐餐盒去看看' : `今日${WEATHER[state.weather].name}，明日预计${WEATHER[state.forecast].name}`
}
