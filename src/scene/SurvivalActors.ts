import { Container, Graphics, Text } from 'pixi.js'
import type { SceneSnapshot } from '../game/GameRuntime'
import { actorPosition, companions, companionId, companionName, companionRules, type Actor } from '../game/survival'
import { ENEMIES, SURVIVAL_RULES } from '../game/survivalConfig'
import { gridToWorld } from './camera'
import { COMBAT_SECONDS, COMBAT_RESULT_SECONDS } from '../game/companionCombat'

function animal(color: number, boar: boolean) {
  const view = new Container(), body = new Graphics(), health = new Graphics(), effect = new Graphics(), anger = new Graphics()
  body.ellipse(0, 1, 15, 6).fill({ color: 0x243b30, alpha: .2 })
  body.roundRect(-11, -8, 5, 10, 2).fill(color).roundRect(6, -8, 5, 10, 2).fill(color)
  body.ellipse(0, -12, boar ? 18 : 14, boar ? 11 : 8).fill(color)
  body.circle(11, -20, boar ? 10 : 8).fill(color)
  body.poly([5, -25, 4, -34, 12, -26]).fill(color).poly([13, -26, 19, -31, 20, -21]).fill(color)
  body.ellipse(17, -17, 6, 4).fill(boar ? 0xb7987b : 0xeee0ba)
  body.circle(20, -18, 2).fill(0x39453b).circle(13, -23, 1.5).fill(0x333a31)
  body.moveTo(-13, -13).lineTo(-21, -20).stroke({ color, width: 5 })
  if (boar) body.moveTo(19, -13).lineTo(23, -18).stroke({ color: 0xf3e9cf, width: 3 })
  const label = new Text({ text: '', style: { fontFamily: 'sans-serif', fontSize: 10, fill: 0xfff5db, stroke: { color: 0x465441, width: 3 } } })
  label.anchor.set(.5, 1); label.position.set(0, -40)
  // Four bent strokes form a comic anger symbol, beside the material bubble.
  for (const [x, y] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    anger.moveTo(x * 3, y * 10).lineTo(x * 3, y * 3).lineTo(x * 10, y * 3)
      .stroke({ color: 0xffe9ce, width: 5, cap: 'round', join: 'round' })
    anger.moveTo(x * 3, y * 10).lineTo(x * 3, y * 3).lineTo(x * 10, y * 3)
      .stroke({ color: 0xe54f42, width: 2.5, cap: 'round', join: 'round' })
  }
  anger.position.set(30, -52); anger.visible = false
  view.addChild(body, health, label, effect, anger)
  return { view, body, health, label, effect, anger }
}
/** Presentation only; actor HP, pathing and attack results come entirely from the runtime. */
export class SurvivalActors {
  private readonly views = new Map<string, ReturnType<typeof animal>>()
  private readonly dust = new Graphics()
  readonly guard = new Graphics()
  constructor(private readonly parent: Container) { parent.addChild(this.dust) }
  displayedPosition(id: string, requireVisible = true) {
    const view = this.views.get(id)?.view
    return view && (!requireVisible || view.visible) && view.renderable ? { x: view.x, y: view.y } : null
  }
  draw(snapshot: SceneSnapshot, interpolation = 1) {
    const state = snapshot.survival, buddy = state.companion, duel = state.duel
    const enemies = [...state.enemies]
    if (duel?.phase === 'result' && duel.result.enemyHp === 0) enemies.push({ ...duel.enemy, hp: 0 })
    const units: { id: string; actor: Actor; hp: number; max: number; color: number; boar: boolean; label: string; injured: boolean }[] = [
      { id: 'companion', actor: buddy, hp: buddy.hp, max: SURVIVAL_RULES.companion.hp, color: 0xb5905d, boar: false,
        label: buddy.status === 'wild' ? '♡ 栗栗' : buddy.status === 'injured' || buddy.status === 'recovering' ? '栗栗 · 休养' : '栗栗', injured: buddy.status === 'injured' || buddy.status === 'recovering' },
      ...enemies.map(enemy => ({ id: enemy.id, actor: enemy, hp: enemy.hp, max: ENEMIES[enemy.kind].hp,
        color: enemy.kind === 'boar' ? 0x846653 : 0x78817a, boar: enemy.kind === 'boar', label: ENEMIES[enemy.kind].name, injured: false })),
    ]
    units.push(...(state.recruits ?? []).map(buddy => ({ id: companionId(buddy), actor: buddy, hp: buddy.hp,
      max: companionRules(buddy).hp, color: buddy.kind === 'boar' ? 0x846653 : 0x78817a, boar: buddy.kind === 'boar',
      label: companionName(buddy), injured: buddy.status === 'injured' || buddy.status === 'recovering' })))
    const friendly = new Set(companions(state).map(companionId))
    const duelBuddy = duel?.companionId ?? 'companion'
    const alive = new Set(units.map(unit => unit.id))
    for (const [id, item] of this.views) if (!alive.has(id)) { item.view.destroy({ children: true }); this.views.delete(id) }
    for (const unit of units) {
      let item = this.views.get(unit.id)
      if (!item) { item = animal(unit.color, unit.boar); this.views.set(unit.id, item); this.parent.addChild(item.view) }
      const participant = !!duel && (unit.id === duelBuddy || unit.id === duel.enemy.id)
      const alert = state.enemies.find(enemy => enemy.id === unit.id)
      item.anger.visible = !!alert?.tameable && (alert.alertSeconds ?? 0) > 0 && !participant
      item.anger.scale.set(.65 * (1 + .08 * Math.sin(snapshot.elapsedSeconds * 7)))
      const position = actorPosition(unit.actor)
      const previous = unit.id === 'companion' ? snapshot.previousCompanionPosition : snapshot.previousEnemyPositions[unit.id] ?? position
      const p = gridToWorld(!participant ? {
        x: previous.x + (position.x - previous.x) * interpolation, y: previous.y + (position.y - previous.y) * interpolation,
      } : position)
      const posing = participant && duel.phase === 'result'
      // CampScene culls with visible; renderable independently hides the whole model during smoke.
      item.view.renderable = !(participant && duel.phase === 'fighting')
      item.view.position.set(p.x, p.y); item.view.zIndex = p.y + .2
      item.view.alpha = 1; item.body.position.set(0, unit.injured ? 5 : 0); item.body.scale.set(1)
      item.body.rotation = unit.injured ? -1.25 : 0; item.body.alpha = unit.injured ? .65 : 1
      item.label.visible = !posing || unit.hp > 0; item.health.visible = !posing || unit.hp > 0
      if (item.label.text !== unit.label) item.label.text = unit.label
      item.health.clear().roundRect(-16, -38, 32, 4, 2).fill(0x4a5042)
      if (unit.hp > 0) item.health.roundRect(-16, -38, Math.max(1, 32 * unit.hp / unit.max), 4, 2).fill(friendly.has(unit.id) ? 0xb3ce82 : 0xcb8b70)
      item.effect.clear()
      if (posing) {
        const t = 1 - duel.remaining / COMBAT_RESULT_SECONDS
        const ease = Math.min(1, t / .35), direction = unit.id === duelBuddy ? -1 : 1
        item.view.x += direction * 12 * Math.sin(t * Math.PI)
        if (unit.hp > 0) {
          const hop = Math.abs(Math.sin(t * Math.PI * 2)) * (1 - t)
          item.body.y = -18 * hop; item.body.rotation = direction * .15 * Math.sin(t * Math.PI * 2)
          item.body.scale.set(1 + .06 * hop, 1 - .04 * hop)
          for (let i = 0; i < 3; i++) {
            const x = (i - 1) * 18, y = -45 - 12 * Math.sin(t * Math.PI) - (i === 1 ? 8 : 0)
            item.effect.star(x, y, 4, 5, 2).fill({ color: 0xffdc75, alpha: Math.sin(t * Math.PI) })
          }
        } else {
          item.body.rotation = -1.25 * ease; item.body.y = 5 * ease
          item.body.alpha = friendly.has(unit.id) ? 1 - .35 * ease : 1
          if (unit.id !== 'companion') item.view.alpha = Math.min(1, (1 - t) / .4)
        }
      } else if (!participant && unit.actor.target && unit.actor.target.kind !== 'point' && unit.actor.cooldown > 1.8) {
        const pulse = .5 + .5 * Math.sin(snapshot.elapsedSeconds * 30)
        item.effect.circle(14, -20, 12 + 3 * pulse).stroke({ color: 0xffe7aa, alpha: .65, width: 2 })
        item.effect.moveTo(5, -30).lineTo(22, -12).moveTo(5, -12).lineTo(22, -30).stroke({ color: 0xfff5cb, width: 2 })
      }
    }
    this.dust.clear(); this.dust.renderable = duel?.phase === 'fighting'
    if (duel?.phase === 'fighting') {
      const a = gridToWorld(actorPosition(duel.companion)), b = gridToWorld(actorPosition(duel.enemy))
      const time = COMBAT_SECONDS - duel.remaining
      this.dust.position.set((a.x + b.x) / 2, (a.y + b.y) / 2)
      this.dust.zIndex = Math.max(a.y, b.y) + .4
      this.dust.alpha = Math.min(1, .5 + time * 5, .4 + duel.remaining * 5)
      this.dust.ellipse(0, 2, 44, 13).fill({ color: 0x443d2d, alpha: .18 })
      for (let i = 0; i < 9; i++) {
        const angle = i * Math.PI * 2 / 9 + time * (i % 2 ? 4 : -3)
        const x = Math.cos(angle) * 23, y = -22 + Math.sin(angle) * 13
        const radius = 15 + 4 * Math.sin(time * 18 + i)
        this.dust.circle(x, y, radius).fill(i % 3 === 0 ? 0xd4bb94 : i % 3 === 1 ? 0xe9d9b8 : 0xf4e5c9)
      }
      for (let i = 0; i < 7; i++) {
        const t = (time * 2 + i / 7) % 1, angle = i * 2.4 + Math.floor(time * 2) * .7
        const x = Math.cos(angle) * (32 + t * 26), y = -20 + Math.sin(angle) * (23 + t * 15)
        this.dust.circle(x, y, 3 * (1 - t) + 1).fill({ color: 0xe4cda3, alpha: 1 - t })
      }
      for (let i = 0; i < 3; i++) {
        const angle = time * 7 + i * Math.PI * 2 / 3, x = Math.cos(angle) * 27, y = -22 + Math.sin(angle) * 17
        this.dust.moveTo(x - 5, y - 6).lineTo(x + 4, y + 5).moveTo(x - 5, y + 5).lineTo(x + 4, y - 6)
          .stroke({ color: 0xfff8df, width: 3, alpha: .9 })
      }
    }
    this.guard.clear()
    if (!duel && buddy.status === 'active' && buddy.mode === 'guard') {
      const p = gridToWorld(buddy.guard), radius = SURVIVAL_RULES.companion.radius
      this.guard.poly([p.x, p.y - 16 * radius, p.x + 32 * radius, p.y, p.x, p.y + 16 * radius, p.x - 32 * radius, p.y])
        .fill({ color: 0xb7d698, alpha: .035 }).stroke({ color: 0xc3e4a4, alpha: .32, width: 1 })
    }
  }
}
