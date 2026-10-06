import { releaseTaming, type TamingState } from './taming'
import { blueprintById } from './buildingConfig'
import { buildingAt, buildingSummary, constructionDamage, constructionNavigation, footprint, localToWorld, protectedBuildingTarget, releaseJob, type BuildingTarget, type ConstructionState } from './construction'
import { buildingSegments, segmentHp } from './buildingSegments'
import { availableItems, matchRequirements, type ProductionState } from './inventory'
import type { NavigationGrid } from './navigation'
import type { ProductionCatalog } from './productionConfig'
import { ENEMIES, SURVIVAL_RULES as RULES, WEATHER, type EnemyKind, type WeatherId } from './survivalConfig'
import { sameCell, type Cell, type WorldMap } from './world'
import { BOAR_AGGRO_RANGE, REGION_BOARS } from './regionContentConfig'
import { combatResult, COMBAT_SECONDS, COMBAT_RESULT_SECONDS, type CompanionCombat } from './companionCombat'
import { canWalkLine, moveTarget, pointCell, pointDistance, smoothPath, SmoothPathSearch, walkPath } from './smoothNavigation'

export type ActorTarget = { kind: 'player' } | { kind: 'companion' } | { kind: 'enemy'; id: string }
  | ({ kind: 'part'; stand: Cell } & BuildingTarget) | { kind: 'point'; cell: Cell }
export interface Actor {
  cell: Cell; route: Cell[]; progress: number; target: ActorTarget | null; cooldown: number
  /** Continuous world position; absent on legacy cell/progress saves. */
  motion?: { version: 1; position: Cell }
}
export interface Enemy extends Actor { id: string; kind: EnemyKind; hp: number; residentId?: string }
export interface Companion extends Actor {
  status: 'wild' | 'active' | 'injured' | 'recovering'
  hp: number; mode: 'guard' | 'follow' | 'move'; guard: Cell; orderedEnemy: string | null; recoveryRemaining: number
}
export interface Failure {
  id: number; day: number; cause: 'enemy' | 'environment'; losses: { id: string; itemId: number }[]
}
export interface SurvivalState {
  weather: WeatherId; forecast: WeatherId; weatherDay: number; randomState: number
  environmentRemaining: number; decisionRemaining: number; spawnRemaining: number; raidNight: number
  nextEnemyId: number; enemies: Enemy[]; companion: Companion; taming: TamingState
  duel: CompanionCombat | null
  failure: Failure | null; failureCount: number; rescuedCount: number; resting: boolean
}
export type SurvivalCommand = { type: 'companion-treat' } | { type: 'player-rest' }
  | { type: 'companion-mode'; mode: 'guard' | 'follow'; guard?: Cell }
  | { type: 'companion-move'; target: Cell }
  | { type: 'companion-attack'; enemyId: string }
  | { type: 'rescue' }
export const distance = (a: Cell, b: Cell) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
export const nearbyThreats = (state: SurvivalState, player: Cell) => state.enemies.filter(enemy => !enemy.residentId || distance(enemy.cell, player) <= BOAR_AGGRO_RANGE + 1)
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
    failure: null, failureCount: 0, rescuedCount: 0, resting: false, taming: { ordered: false, job: null }, duel: null }
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
  if (target.kind === 'companion') return !state.duel && state.companion.status === 'active' ? actorPosition(state.companion) : null
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
  if (enemy.residentId) {
    const spawn = REGION_BOARS.find(s => s.id === enemy.residentId)!
    const targets: { target: ActorTarget; cell: Cell }[] = []
    if (!extraProtection && construction.jobs[0]?.phase !== 'building' && state.taming.job?.phase !== 'taming') targets.push({ target: { kind: 'player' }, cell: player })
    if (!state.duel && state.companion.status === 'active') targets.push({ target: { kind: 'companion' }, cell: actorPosition(state.companion) })
    for (const candidate of targets) {
      const destination = moveTarget(grid, candidate.cell)
      if (destination && distance(enemy.cell, pointCell(candidate.cell)) <= BOAR_AGGRO_RANGE
        && setRoute(enemy, candidate.target, destination, grid, world)) return
    }
    if (!setRoute(enemy, { kind: 'point', cell: spawn.cell }, spawn.cell, grid, world)) stop(enemy)
    return
  }
  // Keep actor engagements, but reconsider structures when a defender comes within reach.
  const current = targetCell(enemy.target, state, player, construction, extraProtection)
  if (current && (enemy.target?.kind === 'player' || enemy.target?.kind === 'companion') && touching(grid, actorPosition(enemy), current)) return
  const buddy = state.companion
  const targets: { target: ActorTarget; cell: Cell }[] = []
  if (!state.duel && buddy.status === 'active' && distance(enemy.cell, buddy.cell) <= ENEMIES[enemy.kind].sight) targets.push({ target: { kind: 'companion' }, cell: actorPosition(buddy) })
  if (!extraProtection && construction.jobs[0]?.phase !== 'building' && state.taming.job?.phase !== 'taming' && distance(enemy.cell, pointCell(player)) <= ENEMIES[enemy.kind].sight) targets.push({ target: { kind: 'player' }, cell: player })
  for (const candidate of targets) {
    const destination = moveTarget(grid, candidate.cell)
    if (destination && setRoute(enemy, candidate.target, destination, grid, world)) return
  }
  const home = construction.buildings.find(building => building.parts.foundation.built)
  const goal = home ? localToWorld(home, { x: 1, y: 1 }) : world.config.spawn
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
function planCompanion(state: SurvivalState, player: Cell, world: WorldMap, grid: NavigationGrid) {
  const buddy = state.companion
  if (buddy.status !== 'active') { stopCompanion(buddy); return }
  if (buddy.mode === 'move') {
    if (sameCell(actorPosition(buddy), buddy.guard)) buddy.mode = 'guard'
    else if (setRoute(buddy, { kind: 'point', cell: buddy.guard }, buddy.guard, grid, world)) return
    else { buddy.mode = 'guard'; buddy.guard = { ...actorPosition(buddy) }; stopCompanion(buddy); return }
  }
  const anchor = buddy.mode === 'follow' ? player : buddy.guard
  const manual = state.enemies.find(enemy => enemy.id === buddy.orderedEnemy)
  if (!manual) buddy.orderedEnemy = null
  const choices = manual ? [manual] : state.enemies.filter(enemy => distance(anchor, enemy.cell) <= RULES.companion.radius)
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
  const buddy = state.companion, enemy = state.enemies.find(enemy => enemy.id === duel.enemy.id)!
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
  world: WorldMap, player: Cell, minutes: number, dt: number, extraProtection = false, playerPosition = player) {
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
  if (day && state.enemies.some(enemy => !enemy.residentId && enemy.id !== state.duel?.enemy.id)) {
    state.enemies = state.enemies.filter(enemy => enemy.residentId || enemy.id === state.duel?.enemy.id)
    if (!state.enemies.some(enemy => enemy.id === state.companion.orderedEnemy)) state.companion.orderedEnemy = null
    if (!state.duel) stopCompanion(state.companion)
    critical = true
  }
  if (!day && state.raidNight !== nightKey(minutes)) {
    state.raidNight = nightKey(minutes); state.spawnRemaining = RULES.firstSpawnDelay; critical = true; message = '天黑了，林外传来动静。让伙伴驻守，准备补给。'
  }
  if (!day) {
    state.spawnRemaining -= dt
    if (state.spawnRemaining <= 0) {
      state.spawnRemaining = RULES.spawnInterval // No backlog when the cap is full.
      if (state.enemies.filter(enemy => !enemy.residentId).length < RULES.enemyLimit) {
        const occupied = construction.buildings.flatMap(building => footprint(building, blueprintById(building.blueprintId)!))
        const entries = RULES.entries.filter(cell => world.isWalkable(cell) && !occupied.some(other => sameCell(cell, other)))
        if (entries.length) {
          const entry = entries[Math.floor(random(state) * entries.length)], kind: EnemyKind = random(state) < .7 ? 'prowler' : 'boar'
          state.enemies.push({ ...blankActor(entry), id: `e${state.nextEnemyId++}`, kind, hp: ENEMIES[kind].hp })
          state.decisionRemaining = 0; critical = true
        }
      }
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
  const buddy = state.companion
  if (state.duel) {
    state.duel.remaining = Math.max(0, state.duel.remaining - dt)
    if (state.duel.remaining <= 1e-8) {
      if (state.duel.phase === 'fighting') {
        production = settleCombat(state, production)
        if (buddy.status === 'injured') message = '栗栗受伤倒下了，需要草药绷带和休养。'
      } else { state.duel = null; state.decisionRemaining = 0 }
      critical = true
    }
  }
  if (buddy.status === 'recovering') {
    buddy.recoveryRemaining = Math.max(0, buddy.recoveryRemaining - dt)
    if (buddy.recoveryRemaining === 0) { buddy.status = 'active'; buddy.hp = RULES.companion.hp * .5; buddy.mode = 'guard'; buddy.guard = { ...actorPosition(buddy) }; critical = true; message = '栗栗已经恢复行动，可以继续下达指令。' }
  }
  const friendly = constructionNavigation(world, construction), hostile = constructionNavigation(world, construction, 'enemy')
  const enemyGrids = new Map(state.enemies.map(enemy => [enemy.id, enemyNavigation(world, hostile, enemy.residentId)]))
  if (!state.duel && buddy.status === 'active') prepareMotion(buddy, friendly)
  for (const enemy of state.enemies) if (enemy.id !== state.duel?.enemy.id) prepareMotion(enemy, enemyGrids.get(enemy.id)!)
  state.decisionRemaining -= dt
  if (state.decisionRemaining <= 0) {
    state.decisionRemaining = RULES.decisionInterval
    if (!state.duel) planCompanion(state, playerPosition, world, friendly)
    for (const enemy of state.enemies) if (enemy.id !== state.duel?.enemy.id) planEnemy(enemy, state, playerPosition, construction, world, enemyGrids.get(enemy.id)!, extraProtection)
  }
  if (!state.duel) {
    if (buddy.status === 'active') moveActor(buddy, friendly, world, RULES.companion.speed, dt)
    buddy.cooldown = Math.max(0, buddy.cooldown - dt)
  }
  for (const enemy of state.enemies) if (enemy.id !== state.duel?.enemy.id) {
    moveActor(enemy, enemyGrids.get(enemy.id)!, world, ENEMIES[enemy.kind].speed, dt); enemy.cooldown = Math.max(0, enemy.cooldown - dt)
  }
  if (!state.duel && buddy.status === 'active') {
    const enemy = state.enemies.find(enemy => (buddy.target?.kind === 'enemy' && buddy.target.id === enemy.id || enemy.target?.kind === 'companion')
      && touching(hostile, actorPosition(buddy), actorPosition(enemy)))
    if (enemy) {
      state.duel = { phase: 'fighting', remaining: COMBAT_SECONDS, companion: structuredClone(buddy), enemy: structuredClone(enemy), result: combatResult(buddy, enemy) }
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
  for (const enemy of state.enemies) if (enemy.id !== state.duel?.enemy.id && (!day || enemy.residentId)) attack(enemy, ENEMIES[enemy.kind].attack, ENEMIES[enemy.kind].interval)
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
  const state = structuredClone(original), production = structuredClone(source), buddy = state.companion
  const reject = (reason: string) => ({ accepted: false as const, reason })
  const accept = (message: string) => ({ accepted: true as const, state, production, message })
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
    if (state.duel) return reject('栗栗正在战斗，请等战斗结束')
    if (buddy.status === 'wild' || buddy.status === 'recovering') return reject('现在不需要再次用药')
    if (buddy.status === 'active' && buddy.hp >= RULES.companion.hp) return reject('栗栗状态很好，不需要用药')
    if (!consume(RULES.companion.medicineItems)) return reject('需要 1 份草药绷带，可在合成工坊准备')
    if (buddy.status === 'injured') { buddy.status = 'recovering'; buddy.recoveryRemaining = RULES.companion.recoverySeconds }
    else buddy.hp = Math.min(RULES.companion.hp, buddy.hp + 40)
    return accept(buddy.status === 'recovering' ? '已经包扎，栗栗需要休养 60 秒' : '栗栗恢复了 40 点生命')
  }
  if (command.type === 'player-rest') {
    if (state.resting) { state.resting = false; return accept('结束休养') }
    const shelter = shelterAt(construction, player)
    if (!shelter.rest || !shelter.enclosed || !shelter.rainproof) return reject('需要进入有床、门墙和屋顶完好的木屋')
    if (nearbyThreats(state, player).length || construction.jobs.length || state.taming.job) return reject('当前不能安心休养，请先处理袭击或工程')
    state.resting = true; return accept('正在床边休养，饥渴仍会消耗')
  }
  if (buddy.status !== 'active') return reject('栗栗还不能参战，请先救助或治疗')
  if (state.duel) return reject('栗栗正在战斗，请等战斗结束')
  if (command.type === 'companion-move') {
    const grid = constructionNavigation(world, construction), target = moveTarget(grid, command.target)
    if (!target || !setRoute(buddy, { kind: 'point', cell: { ...target } }, target, grid, world)) return reject('伙伴无法到达该位置')
    buddy.mode = 'move'; buddy.guard = { ...target }; buddy.orderedEnemy = null
    state.decisionRemaining = 0
    return accept('栗栗正在前往指定位置')
  }
  if (command.type === 'companion-mode') {
    const guard = command.guard ?? player
    const grid = constructionNavigation(world, construction), destination = moveTarget(grid, guard)
    if (!['guard', 'follow'].includes(command.mode) || !destination
      || !setRoute(buddy, { kind: 'point', cell: destination }, destination, grid, world)) return reject('伙伴无法到达该位置')
    buddy.mode = command.mode; buddy.guard = destination; buddy.orderedEnemy = null
    state.decisionRemaining = 0; return accept(command.mode === 'guard' ? '栗栗将在这里驻守' : '栗栗开始跟随')
  }
  const enemy = state.enemies.find(enemy => enemy.id === command.enemyId)
  const grid = constructionNavigation(world, construction), destination = enemy && moveTarget(grid, actorPosition(enemy))
  if (!enemy || !destination || !setRoute(buddy, { kind: 'enemy', id: enemy.id }, destination, grid, world)) return reject('这个目标已离开或无法到达')
  if (buddy.mode === 'move') { buddy.mode = 'guard'; buddy.guard = { ...actorPosition(buddy) } }
  buddy.orderedEnemy = enemy.id; state.decisionRemaining = 0
  return accept(`栗栗正在前往拦截${ENEMIES[enemy.kind].name}`)
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
  state.enemies = state.enemies.filter(enemy => enemy.residentId)
  for (const enemy of state.enemies) { stop(enemy); enemy.cooldown = 0 }
  state.resting = false
  state.environmentRemaining = RULES.environmentInterval; state.decisionRemaining = 0
  state.companion.orderedEnemy = null; Object.assign(state.companion, blankActor(world.config.spawn), { guard: { ...world.config.spawn } })
  delete state.companion.motion
  if (state.companion.mode === 'move') state.companion.mode = 'guard'
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
