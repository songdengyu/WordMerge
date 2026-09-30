import type { RuntimeData } from './saveData'
import type { ProductionCatalog } from './productionConfig'
import { ENEMIES, SURVIVAL_RULES as RULES, WEATHER } from './survivalConfig'
import type { Actor, SurvivalState } from './survival'
import { worldMinutes } from './survival'
import { sameCell, type Cell, type WorldMap } from './world'
import { constructionNavigation } from './construction'
import { TAMING_ORDER, TAMING_SECONDS } from './taming'

type Check = (condition: unknown, name: string) => asserts condition
const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0
const integer = (v: unknown): v is number => finite(v) && Number.isSafeInteger(v)
const has = (object: object, key: string) => Object.prototype.hasOwnProperty.call(object, key)
export function validateSurvival(raw: unknown, data: RuntimeData, world: WorldMap, catalog: ProductionCatalog, check: Check): asserts raw is SurvivalState {
  check(record(raw), '昼夜生存状态缺失')
  check(typeof raw.weather === 'string' && has(WEATHER, raw.weather) && typeof raw.forecast === 'string' && has(WEATHER, raw.forecast), '天气')
  check(Number.isSafeInteger(raw.weatherDay) && Number(raw.weatherDay) >= -1 && Number(raw.weatherDay) <= Math.floor((worldMinutes(world, data.elapsedSeconds) - 360) / 1440), '天气日历')
  check(integer(raw.randomState) && raw.randomState > 0 && raw.randomState <= 0xffffffff, '天气与夜袭随机状态')
  for (const [key, max] of [['environmentRemaining', RULES.environmentInterval], ['decisionRemaining', RULES.decisionInterval], ['spawnRemaining', RULES.spawnInterval]] as const) check(finite(raw[key]) && raw[key] <= max, `生存计时 ${key}`)
  check(integer(raw.raidNight) && integer(raw.nextEnemyId) && raw.nextEnemyId > 0, '夜袭序号')
  check(typeof raw.resting === 'boolean' && integer(raw.failureCount) && integer(raw.rescuedCount) && raw.rescuedCount <= raw.failureCount, '救援计数')
  const cell = (v: unknown): v is Cell => record(v) && Number.isSafeInteger(v.x) && Number.isSafeInteger(v.y) && world.isWalkable(v as unknown as Cell)
  function actor(v: unknown): asserts v is Actor {
    check(record(v) && cell(v.cell) && finite(v.progress) && v.progress < 1 && finite(v.cooldown) && v.cooldown <= 3, '单位位置 / 攻击计时')
    check(Array.isArray(v.route) && v.route.length <= world.config.chunks.length * 256 && (v.route.length > 0 || v.progress === 0), '单位路线')
    let from = v.cell
    for (const next of v.route) { check(cell(next) && world.canStep(from, next), '单位路线不可达'); from = next }
    if (v.target === null) return
    const target = v.target
    check(record(target) && typeof target.kind === 'string', '单位目标')
    if (target.kind === 'player' || target.kind === 'companion') return
    if (target.kind === 'point') { check(cell(target.cell), '驻守目标'); return }
    if (target.kind === 'enemy') { check(typeof target.id === 'string' && /^e[1-9]\d*$/.test(target.id), '敌人目标'); return }
    check(target.kind === 'part' && typeof target.buildingId === 'string' && typeof target.partId === 'string' && cell(target.stand), '建筑目标')
    check(data.construction.buildings.some(building => building.id === target.buildingId && has(building.parts, target.partId as string)), '建筑目标缺失')
  }
  check(Array.isArray(raw.enemies) && raw.enemies.length <= RULES.enemyLimit, '夜袭数量上限')
  const seen = new Set<string>()
  for (const enemy of raw.enemies) {
    check(record(enemy) && typeof enemy.id === 'string' && /^e[1-9]\d*$/.test(enemy.id) && !seen.has(enemy.id) && Number(enemy.id.slice(1)) < raw.nextEnemyId, '敌人实例序号')
    seen.add(enemy.id)
    check(typeof enemy.kind === 'string' && has(ENEMIES, enemy.kind), '敌人种类')
    check(finite(enemy.hp) && enemy.hp > 0 && enemy.hp <= ENEMIES[enemy.kind as keyof typeof ENEMIES].hp, '敌人生命')
    actor(enemy)
  }
  const buddy = raw.companion
  check(record(buddy), '伙伴状态')
  actor(buddy)
  check(['wild', 'active', 'injured', 'recovering'].includes(String(buddy.status)) && ['guard', 'follow', 'rest'].includes(String(buddy.mode)) && cell(buddy.guard), '伙伴指令')
  check(finite(buddy.hp) && buddy.hp <= RULES.companion.hp && ((buddy.status === 'wild' || buddy.status === 'active') ? buddy.hp > 0 : buddy.hp === 0), '伙伴生命')
  check(finite(buddy.recoveryRemaining) && buddy.recoveryRemaining <= RULES.companion.recoverySeconds && (buddy.status === 'recovering' ? buddy.recoveryRemaining > 0 : buddy.recoveryRemaining === 0), '伙伴救治计时')
  check(buddy.orderedEnemy === null || (typeof buddy.orderedEnemy === 'string' && /^e[1-9]\d*$/.test(buddy.orderedEnemy)), '伙伴指定目标')
  const taming = raw.taming
  check(record(taming) && typeof taming.ordered === 'boolean', '驯服订单')
  check(buddy.status === 'wild' || (!taming.ordered && taming.job === null), '已驯服动物不得保留订单')
  if (taming.job !== null) {
    const job = taming.job
    check(record(job) && taming.ordered && buddy.status === 'wild' && !data.construction.jobs.length && !raw.resting
      && raw.failure === null && (job.phase === 'travel' || job.phase === 'taming') && cell(job.workCell)
      && Array.isArray(job.reservedIds) && finite(job.remaining), '驯服作业')
    const grid = constructionNavigation(world, data.construction)
    check(sameCell(job.workCell, buddy.cell) || grid.canStep(job.workCell, buddy.cell), '驯服工作位')
    if (job.phase === 'travel') {
      check(job.remaining === 0 && data.destination && sameCell(data.destination, job.workCell)
        && job.reservedIds.length === RULES.companion.rescueItems.length, '驯服前往目标或预留数量')
      const ids = new Set<string>()
      job.reservedIds.forEach((id, i) => {
        check(typeof id === 'string' && !ids.has(id), '重复驯服预留')
        ids.add(id)
        const item = data.production.inventory.items[id]
        check(item && item.reservedBy === TAMING_ORDER && item.itemId === RULES.companion.rescueItems[i]
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
