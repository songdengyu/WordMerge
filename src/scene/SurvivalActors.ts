import { Container, Graphics, Text } from 'pixi.js'
import type { SceneSnapshot } from '../game/GameRuntime'
import { actorPosition, type Actor } from '../game/survival'
import { ENEMIES, SURVIVAL_RULES } from '../game/survivalConfig'
import { gridToWorld } from './camera'

function animal(color: number, boar: boolean) {
  const view = new Container(), body = new Graphics(), health = new Graphics(), effect = new Graphics()
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
  view.addChild(body, health, label, effect)
  return { view, body, health, label, effect }
}
/** Presentation only; actor HP, pathing and attack results come entirely from the runtime. */
export class SurvivalActors {
  private readonly views = new Map<string, ReturnType<typeof animal>>()
  readonly guard = new Graphics()
  constructor(private readonly parent: Container) {}
  draw(snapshot: SceneSnapshot) {
    const state = snapshot.survival, buddy = state.companion
    const units: { id: string; actor: Actor; hp: number; max: number; color: number; boar: boolean; label: string; injured: boolean }[] = [
      { id: 'companion', actor: buddy, hp: buddy.hp, max: SURVIVAL_RULES.companion.hp, color: 0xb5905d, boar: false,
        label: buddy.status === 'wild' ? '♡ 栗栗' : buddy.status === 'injured' || buddy.status === 'recovering' ? '栗栗 · 休养' : '栗栗', injured: buddy.status === 'injured' || buddy.status === 'recovering' },
      ...state.enemies.map(enemy => ({ id: enemy.id, actor: enemy, hp: enemy.hp, max: ENEMIES[enemy.kind].hp,
        color: enemy.kind === 'boar' ? 0x846653 : 0x78817a, boar: enemy.kind === 'boar', label: ENEMIES[enemy.kind].name, injured: false })),
    ]
    const alive = new Set(units.map(unit => unit.id))
    for (const [id, item] of this.views) if (!alive.has(id)) { item.view.destroy({ children: true }); this.views.delete(id) }
    for (const unit of units) {
      let item = this.views.get(unit.id)
      if (!item) { item = animal(unit.color, unit.boar); this.views.set(unit.id, item); this.parent.addChild(item.view) }
      const p = gridToWorld(actorPosition(unit.actor))
      item.view.position.set(p.x, p.y); item.view.zIndex = p.y + .2
      item.body.rotation = unit.injured ? -.5 : 0; item.body.alpha = unit.injured ? .65 : 1
      if (item.label.text !== unit.label) item.label.text = unit.label
      item.health.clear().roundRect(-16, -38, 32, 4, 2).fill(0x4a5042)
      if (unit.hp > 0) item.health.roundRect(-16, -38, Math.max(1, 32 * unit.hp / unit.max), 4, 2).fill(unit.id === 'companion' ? 0xb3ce82 : 0xcb8b70)
      item.effect.clear()
      if (unit.actor.target && unit.actor.target.kind !== 'point' && unit.actor.cooldown > 1.8) {
        const pulse = .5 + .5 * Math.sin(snapshot.elapsedSeconds * 30)
        item.effect.circle(14, -20, 12 + 3 * pulse).stroke({ color: 0xffe7aa, alpha: .65, width: 2 })
        item.effect.moveTo(5, -30).lineTo(22, -12).moveTo(5, -12).lineTo(22, -30).stroke({ color: 0xfff5cb, width: 2 })
      }
    }
    this.guard.clear()
    if (buddy.status === 'active' && buddy.mode === 'guard') {
      const p = gridToWorld(buddy.guard), radius = SURVIVAL_RULES.companion.radius
      this.guard.poly([p.x, p.y - 16 * radius, p.x + 32 * radius, p.y, p.x, p.y + 16 * radius, p.x - 32 * radius, p.y])
        .fill({ color: 0xb7d698, alpha: .035 }).stroke({ color: 0xc3e4a4, alpha: .32, width: 1 })
    }
  }
}
