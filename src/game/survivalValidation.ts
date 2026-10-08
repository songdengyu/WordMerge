import { ENCOUNTERS } from './encounters'
import type { RuntimeData } from './saveData'
import type { ProductionCatalog } from './productionConfig'
import { ENEMIES, SURVIVAL_RULES as RULES, WEATHER } from './survivalConfig'
import type { Actor, SurvivalState, Companion } from './survival'
import { companionRules, enemyNavigation, worldMinutes } from './survival'
import { sameCell, type Cell, type WorldMap } from './world'
import { constructionNavigation } from './construction'
import { blueprintById } from './buildingConfig'
import { buildingSegments } from './buildingSegments'
import { TAMING_ORDER, TAMING_SECONDS } from './taming'
import { REGION_BOARS } from './regionContentConfig'
import { combatResult, COMBAT_SECONDS, COMBAT_RESULT_SECONDS } from './companionCombat'
import type { Enemy } from './survival'
import { canWalkLine, finitePoint, pointCell } from './smoothNavigation'

type Check = (condition: unknown, name: string) => asserts condition
const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0
const integer = (v: unknown): v is number => finite(v) && Number.isSafeInteger(v)
const has = (object: object, key: string) => Object.prototype.hasOwnProperty.call(object, key)
export function validateSurvival(raw: unknown, data: RuntimeData, world: WorldMap, catalog: ProductionCatalog, check: Check,
  rescueItems: readonly number[] = RULES.companion.rescueItems): asserts raw is SurvivalState {
  check(record(raw), '昼夜生存状态缺失')
  const lockedCombat = !!raw.duel
  const duelEnemyId = record(raw.duel) && record(raw.duel.enemy) ? raw.duel.enemy.id : null
  check(typeof raw.weather === 'string' && has(WEATHER, raw.weather) && typeof raw.forecast === 'string' && has(WEATHER, raw.forecast), '天气')
  check(Number.isSafeInteger(raw.weatherDay) && Number(raw.weatherDay) >= -1 && Number(raw.weatherDay) <= Math.floor((worldMinutes(world, data.elapsedSeconds) - 360) / 1440), '天气日历')
  check(integer(raw.randomState) && raw.randomState > 0 && raw.randomState <= 0xffffffff, '天气与夜袭随机状态')
  for (const [key, max] of [['environmentRemaining', RULES.environmentInterval], ['decisionRemaining', RULES.decisionInterval], ['spawnRemaining', ENCOUNTERS.dayInterval]] as const) check(finite(raw[key]) && raw[key] <= max, `生存计时 ${key}`)
  check(integer(raw.raidNight) && integer(raw.nextEnemyId) && raw.nextEnemyId > 0, '夜袭序号')
  check(typeof raw.resting === 'boolean' && integer(raw.failureCount) && integer(raw.rescuedCount) && raw.rescuedCount <= raw.failureCount, '救援计数')
  const cell = (v: unknown): v is Cell => record(v) && Number.isSafeInteger(v.x) && Number.isSafeInteger(v.y) && world.isWalkable(v as unknown as Cell)
  const point = (v: unknown): v is Cell => record(v) && typeof v.x === 'number' && typeof v.y === 'number'
    && finitePoint(v as Cell) && world.isWalkable(pointCell(v as Cell))
  function actor(v: unknown, companion = false): asserts v is Actor {
    check(record(v) && cell(v.cell) && finite(v.progress) && v.progress < 1 && finite(v.cooldown) && v.cooldown <= 3, '单位位置 / 攻击计时')
    const motion = v.motion
    const label = companion ? '伙伴' : '敌人'
    const locked = lockedCombat && (companion ? (v.id ?? 'companion') === (record(raw) && record(raw.duel) ? raw.duel.companionId ?? 'companion' : '') : v.id === duelEnemyId)
    const base = locked ? world : constructionNavigation(world, data.construction, companion ? 'friendly' : 'enemy')
    const grid = companion ? base : enemyNavigation(world, base, typeof v.residentId === 'string' ? v.residentId : undefined)
    check(Array.isArray(v.route) && v.route.length <= world.config.chunks.length * (motion ? 2048 : 256) && (v.route.length > 0 || v.progress === 0), '单位路线')
    if (motion !== undefined) {
      check(record(motion) && motion.version === 1 && point(motion.position) && v.progress === 0
        && sameCell(pointCell(motion.position), v.cell), `${label}连续移动位置`)
      // A locked duel may outlive repairs along its frozen future route; recheck those walls on resuming.
      check(canWalkLine(grid, motion.position, motion.position), `${label}连续移动碰撞`)
      let from = motion.position
      for (const next of v.route) { check(point(next) && canWalkLine(grid, from, next), `${label}路线穿过障碍或建筑木墙`); from = next }
    } else {
      let from = v.cell
      for (const next of v.route) { check(cell(next) && world.canStep(from, next), '单位路线不可达'); from = next }
    }
    if (v.target === null) return
    const target = v.target
    check(record(target) && typeof target.kind === 'string', '单位目标')
    if (target.kind === 'player') return
    if (target.kind === 'companion') { check(target.id === undefined || target.id === 'companion' || typeof target.id === 'string' && /^e[1-9]\d*$/.test(target.id), '伙伴目标'); return }
    if (target.kind === 'point') { check(motion ? point(target.cell) : cell(target.cell), '驻守目标'); return }
    if (target.kind === 'enemy') { check(typeof target.id === 'string' && /^e[1-9]\d*$/.test(target.id), '敌人目标'); return }
    check(target.kind === 'part' && typeof target.buildingId === 'string' && typeof target.partId === 'string' && cell(target.stand), '建筑目标')
    check(data.construction.buildings.some(building => building.id === target.buildingId && has(building.parts, target.partId as string)), '建筑目标缺失')
    if (target.segmentId !== undefined) {
      const building = data.construction.buildings.find(building => building.id === target.buildingId)!
      const blueprint = blueprintById(building.blueprintId)!, config = blueprint.parts.find(part => part.id === target.partId)!
      check(typeof target.segmentId === 'string' && buildingSegments(blueprint, config).some(segment => segment.id === target.segmentId), '独立部件目标')
    }
  }
  check(Array.isArray(raw.enemies) && raw.enemies.length <= ENCOUNTERS.nightLimit + REGION_BOARS.length
    && raw.enemies.filter(enemy => !record(enemy) || !enemy.residentId).length <= ENCOUNTERS.nightLimit, '夜袭数量上限')
  const seen = new Set<string>()
  const residents = new Set<string>()
  for (const enemy of raw.enemies) {
    check(record(enemy) && typeof enemy.id === 'string' && /^e[1-9]\d*$/.test(enemy.id) && !seen.has(enemy.id) && Number(enemy.id.slice(1)) < raw.nextEnemyId, '敌人实例序号')
    seen.add(enemy.id)
    check(typeof enemy.kind === 'string' && has(ENEMIES, enemy.kind), '敌人种类')
    check(finite(enemy.hp) && enemy.hp > 0 && enemy.hp <= ENEMIES[enemy.kind as keyof typeof ENEMIES].hp, '敌人生命')
    actor(enemy)
    check(enemy.roaming === undefined || typeof enemy.roaming === 'boolean', '动态怪物来源')
    check(enemy.tameable === undefined || typeof enemy.tameable === 'boolean', '可驯服状态')
    if (enemy.patrol !== undefined) check(enemy.residentId && record(enemy.patrol)
      && integer(enemy.patrol.index) && enemy.patrol.index < 4 && finite(enemy.patrol.remaining) && enemy.patrol.remaining <= 2, '野生动物巡逻状态')
    if (enemy.residentId !== undefined) {
      const spawn = REGION_BOARS.find(s => s.id === enemy.residentId)
      check(spawn && !residents.has(spawn.id) && enemy.kind === 'boar' && world.chunkAt(enemy.cell as Cell)?.id === spawn.regionId
        && (enemy.route as Cell[]).every(cell => world.chunkAt(pointCell(cell))?.id === spawn.regionId), '区域野猪来源或活动范围')
      residents.add(spawn.id)
    }
  }
  function validateBuddy(buddy: unknown) {
    check(record(buddy), '伙伴状态')
    check(buddy.kind === undefined || typeof buddy.kind === 'string' && has(ENEMIES, buddy.kind), '伙伴种类')
    const rules = companionRules(buddy as unknown as Companion)
    actor(buddy, true)
    check(['wild', 'active', 'injured', 'recovering'].includes(String(buddy.status)) && ['guard', 'follow', 'move'].includes(String(buddy.mode))
      && (buddy.motion ? point(buddy.guard) : cell(buddy.guard)), '伙伴指令')
    check(finite(buddy.hp) && buddy.hp <= rules.hp && ((buddy.status === 'wild' || buddy.status === 'active') ? buddy.hp > 0 : buddy.hp === 0), '伙伴生命')
    check(finite(buddy.recoveryRemaining) && buddy.recoveryRemaining <= RULES.companion.recoverySeconds && (buddy.status === 'recovering' ? buddy.recoveryRemaining > 0 : buddy.recoveryRemaining === 0), '伙伴救治计时')
    check(buddy.orderedEnemy === null || (typeof buddy.orderedEnemy === 'string' && /^e[1-9]\d*$/.test(buddy.orderedEnemy)), '伙伴指定目标')
  }
  validateBuddy(raw.companion)
  check(raw.recruits === undefined || Array.isArray(raw.recruits) && raw.recruits.length <= ENCOUNTERS.companionLimit, '伙伴列表')
  for (const recruit of (raw.recruits ?? []) as unknown[]) {
    check(record(recruit) && typeof recruit.id === 'string' && /^e[1-9]\d*$/.test(recruit.id)
      && !seen.has(recruit.id) && Number(recruit.id.slice(1)) < raw.nextEnemyId && recruit.status !== 'wild'
      && typeof recruit.kind === 'string' && has(ENEMIES, recruit.kind), '招募伙伴来源')
    seen.add(recruit.id); validateBuddy(recruit)
  }
  check(record(raw.companion), '初始伙伴')
  check(raw.companion.id === undefined && raw.companion.kind === undefined, '初始伙伴来源')
  check(((raw.recruits ?? []) as unknown[]).length + (raw.companion.status === 'wild' ? 0 : 1) <= ENCOUNTERS.companionLimit, '伙伴容量')
  const buddy = raw.duel && record(raw.duel) && raw.duel.companionId && raw.duel.companionId !== 'companion'
    ? ((raw.recruits ?? []) as Companion[]).find(b => b.id === (raw.duel as Record<string, unknown>).companionId) : raw.companion
  check(buddy, '交战伙伴不存在')
  if (raw.duel !== null) {
    const duel = raw.duel
    check(record(duel) && (duel.phase === 'fighting' || duel.phase === 'result') && finite(duel.remaining)
      && duel.remaining > 0 && duel.remaining <= (duel.phase === 'fighting' ? COMBAT_SECONDS : COMBAT_RESULT_SECONDS), '伙伴战斗计时')
    const startBuddy = duel.companion, startEnemy = duel.enemy
    check(record(startBuddy) && startBuddy.kind === buddy.kind && (startBuddy.id ?? 'companion') === (duel.companionId ?? 'companion'), '战斗伙伴来源')
    actor(startBuddy, true); actor(startEnemy)
    check(record(startBuddy) && finite(startBuddy.hp) && startBuddy.hp > 0 && startBuddy.hp <= companionRules(startBuddy as unknown as Companion).hp, '战斗初始伙伴生命')
    check(record(startEnemy) && typeof startEnemy.id === 'string' && /^e[1-9]\d*$/.test(startEnemy.id)
      && Number(startEnemy.id.slice(1)) < raw.nextEnemyId && typeof startEnemy.kind === 'string' && has(ENEMIES, startEnemy.kind)
      && finite(startEnemy.hp) && startEnemy.hp > 0 && startEnemy.hp <= ENEMIES[startEnemy.kind as keyof typeof ENEMIES].hp, '战斗初始敌人')
    if (startEnemy.residentId !== undefined) {
      const spawn = REGION_BOARS.find(spawn => spawn.id === startEnemy.residentId)
      check(spawn && startEnemy.kind === 'boar' && world.chunkAt(startEnemy.cell)?.id === spawn.regionId
        && startEnemy.route.every(cell => world.chunkAt(pointCell(cell))?.id === spawn.regionId), '战斗区域动物')
    }
    const expected = combatResult({ hp: startBuddy.hp, cooldown: startBuddy.cooldown, kind: (startBuddy as unknown as Companion).kind }, startEnemy as unknown as Enemy)
    const result = duel.result
    check(record(result) && Object.entries(expected).every(([key, value]) => result[key] === value), '战斗预计算结果')
    const samePosition = (a: Actor, b: Actor) => sameCell(a.cell, b.cell) && a.progress === b.progress
      && JSON.stringify(a.route) === JSON.stringify(b.route) && JSON.stringify(a.motion) === JSON.stringify(b.motion)
    check(samePosition(buddy as unknown as Actor, startBuddy) && buddy.hp === (duel.phase === 'fighting' ? startBuddy.hp : expected.companionHp)
      && buddy.cooldown === (duel.phase === 'fighting' ? startBuddy.cooldown : expected.companionCooldown)
      && buddy.status === (duel.phase === 'result' && expected.companionHp === 0 ? 'injured' : 'active'), '战斗伙伴锁定状态')
    const enemy = (raw.enemies as Enemy[]).find(enemy => enemy.id === startEnemy.id)
    if (duel.phase === 'result' && expected.enemyHp === 0) check(!enemy, '战败敌人已结算')
    else check(enemy && samePosition(enemy, startEnemy) && enemy.kind === startEnemy.kind && enemy.residentId === startEnemy.residentId
      && enemy.hp === (duel.phase === 'fighting' ? startEnemy.hp : expected.enemyHp)
      && enemy.cooldown === (duel.phase === 'fighting' ? startEnemy.cooldown : expected.enemyCooldown), '战斗敌人锁定状态')
  }
  const taming = raw.taming
  check(record(taming) && typeof taming.ordered === 'boolean', '驯服订单')
  const animal = taming.targetId === undefined ? raw.companion : (raw.enemies as Enemy[]).find(e => e.id === taming.targetId && e.tameable)
  check(taming.targetId === undefined || typeof taming.targetId === 'string' && animal, '驯服目标来源')
  check(!taming.ordered || animal && (taming.targetId !== undefined || raw.companion.status === 'wild'), '已驯服动物不得保留订单')
  if (taming.job !== null) {
    const job = taming.job
    check(record(job) && taming.ordered && animal && !data.construction.jobs.length && !raw.resting
      && raw.failure === null && (job.phase === 'travel' || job.phase === 'taming') && cell(job.workCell)
      && Array.isArray(job.reservedIds) && finite(job.remaining), '驯服作业')
    const grid = constructionNavigation(world, data.construction)
    check(sameCell(job.workCell, animal!.cell as Cell) || grid.canStep(job.workCell, animal!.cell as Cell), '驯服工作位')
    if (job.phase === 'travel') {
      check(job.remaining === 0 && data.destination && sameCell(data.destination, job.workCell)
        && job.reservedIds.length === rescueItems.length, '驯服前往目标或预留数量')
      const ids = new Set<string>()
      job.reservedIds.forEach((id, i) => {
        check(typeof id === 'string' && !ids.has(id), '重复驯服预留')
        ids.add(id)
        const item = data.production.inventory.items[id]
        check(item && item.reservedBy === TAMING_ORDER && item.itemId === rescueItems[i]
          && (item.location.kind === 'warehouse' || data.production.inventory.board[item.location.index].lock === 0), '驯服预留实例')
      })
    } else {
      check(sameCell(data.motion?.position ?? data.cell, job.workCell) && !data.route.length && !data.searching
        && data.progress === 0 && data.destination === null && job.remaining > 0 && job.remaining <= TAMING_SECONDS
        && job.reservedIds.length === 0, '驯服位置、计时或扣料异常')
    }
  }
  if (raw.failure === null) { check(data.production.vitals.hp > 0 && raw.rescuedCount === raw.failureCount, '未结算倒下状态'); return }
  const failure = raw.failure
  check(record(failure) && data.production.vitals.hp === 0 && failure.id === raw.failureCount && raw.failureCount === raw.rescuedCount + 1 && integer(failure.day) && failure.day > 0, '失败结算序号')
  check(failure.cause === 'enemy' || failure.cause === 'environment', '失败原因')
  check(!data.construction.jobs.length && Array.isArray(failure.losses) && failure.losses.length <= RULES.lossLimit, '失败作业或损失上限')
  const lossIds = new Set<string>()
  for (const loss of failure.losses) {
    check(record(loss) && typeof loss.id === 'string' && !lossIds.has(loss.id), '重复失败损失')
    lossIds.add(loss.id)
    const item = data.production.inventory.items[loss.id], config = item && catalog.itemById.get(item.itemId)
    check(item && item.itemId === loss.itemId && !item.reservedBy && (item.location.kind === 'warehouse' || data.production.inventory.board[item.location.index].lock === 0)
      && config?.itemType === 'normal' && config.level <= RULES.lossMaxLevel, '失败损失必须是可用低阶普通物资')
  }
}
