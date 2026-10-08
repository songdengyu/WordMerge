import { Container, Graphics, Text } from 'pixi.js'
import type { GameRuntime, LootFeedback, SceneSnapshot } from '../game/GameRuntime'
import { RESOURCE_RULES } from '../game/economyConfig'
import { gridToWorld } from './camera'

const DURATION = 1.8, SCALE = .75
type Drop = { root: Container; rows: Container[]; sparkle: Graphics }

/** World-space reward receipts. Simulation owns settlement; these animations never grant items. */
export class ResourceDrops {
  readonly view = new Container()
  private readonly icons = new Map<number, { svg: string; size: number }>()
  private readonly drops = new Map<number, Drop>()
  private readonly announcement = document.createElement('div')
  private signature = ''

  constructor(private readonly runtime: GameRuntime, host: HTMLDivElement) {
    this.view.eventMode = 'none'
    this.announcement.setAttribute('role', 'status')
    this.announcement.setAttribute('aria-label', '拆除奖励')
    this.announcement.dataset.testid = 'resource-drops'
    this.announcement.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);pointer-events:none'
    host.appendChild(this.announcement)
  }

  async load(signal: AbortSignal) {
    const response = await fetch(`${import.meta.env.BASE_URL}assets/survival/items.svg`, { signal })
    if (!response.ok) throw new Error('奖励图标载入失败')
    const sheet = new DOMParser().parseFromString(await response.text(), 'image/svg+xml')
    for (const id of new Set(Object.values(RESOURCE_RULES).flatMap(rule => rule.items))) {
      const item = this.runtime.catalog!.itemById.get(id)!, symbol = sheet.getElementById(item.iconName)
      if (!symbol) throw new Error(`奖励图标不存在：${item.iconName}`)
      this.icons.set(id, { svg: `<svg xmlns="http://www.w3.org/2000/svg">${symbol.innerHTML}</svg>`, size: Number(symbol.getAttribute('viewBox')?.split(/\s+/)[2] ?? 96) })
    }
  }

  private entries(event: LootFeedback) {
    const items = new Map<number, number>()
    event.items.forEach(id => items.set(id, (items.get(id) ?? 0) + 1))
    return [
      ...(event.gold ? [{ kind: 'gold' as const, id: 0, label: `金币 +${event.gold}`, color: 0xffdf80 }] : []),
      ...(event.gems ? [{ kind: 'gems' as const, id: 0, label: `钻石 +${event.gems}`, color: 0xabe8ff }] : []),
      ...[...items].map(([id, count]) => ({ kind: 'item' as const, id,
        label: `${this.runtime.catalog!.itemById.get(id)!.name} ${event.pending ? '×' : '+'}${count}${event.pending ? ' · 待领取' : ''}`, color: event.pending ? 0xffdca4 : 0xffffff })),
    ]
  }

  private create(event: LootFeedback): Drop {
    const root = new Container(), sparkle = new Graphics(), anchor = gridToWorld(event.cell)
    root.position.set(anchor.x, anchor.y - 14)
    root.scale.set(SCALE)
    root.addChild(sparkle)
    const rows = this.entries(event).map(entry => {
      const row = new Container(), icon = new Graphics()
      if (entry.kind === 'gold') {
        icon.circle(0, 0, 11).fill(0xf1be50).stroke({ width: 1.5, color: 0xffe8a0 })
        icon.circle(0, 0, 7).stroke({ width: 1, color: 0xb87e29 })
        icon.moveTo(0, -4).lineTo(0, 4).stroke({ width: 2, color: 0xffedb7 })
      } else if (entry.kind === 'gems') {
        icon.poly([-12, -4, -7, -10, 7, -10, 12, -4, 0, 11]).fill(0x85d2ef).stroke({ width: 1.5, color: 0xd4f5ff })
        icon.moveTo(-12, -4).lineTo(12, -4).moveTo(-5, -4).lineTo(0, 11).lineTo(5, -4).stroke({ width: 1, color: 0xd4f5ff })
      } else {
        const art = this.icons.get(entry.id)!
        icon.svg(art.svg); icon.scale.set(28 / art.size); icon.position.set(-14, -14)
      }
      const text = new Text({ text: entry.label, style: { fontFamily: 'sans-serif', fontSize: 14, fontWeight: 'bold',
        fill: entry.color, stroke: { color: 0x354f43, width: 3 }, dropShadow: { color: 0x193f32, alpha: .3, blur: 3, distance: 1 } } })
      text.anchor.set(0, .5); text.position.set(18, 0)
      row.addChild(icon, text); root.addChild(row)
      return row
    })
    this.view.addChild(root)
    return { root, rows, sparkle }
  }

  update(state: SceneSnapshot) {
    const active = state.lootFeedback.filter(event => state.elapsedSeconds - event.at >= 0 && state.elapsedSeconds - event.at < DURATION)
    const ids = new Set(active.map(event => event.id))
    for (const [id, drop] of this.drops) if (!ids.has(id)) { drop.root.destroy({ children: true }); this.drops.delete(id) }
    const signature = active.map(event => event.id).join(',')
    if (signature !== this.signature) {
      this.signature = signature
      this.announcement.textContent = active.flatMap(event => this.entries(event).map(entry => entry.label)).join('，')
      this.announcement.dataset.count = String(active.length)
    }
    for (const event of active) {
      let drop = this.drops.get(event.id)
      if (!drop) { drop = this.create(event); this.drops.set(event.id, drop) }
      const age = state.elapsedSeconds - event.at
      drop.root.alpha = Math.min(1, (DURATION - age) / .45)
      drop.rows.forEach((row, index) => {
        const t = Math.min(1, age / .35), bounce = -Math.sin(t * Math.PI) * 20
        row.position.set(-42 + index * 5 * t, -(drop!.rows.length - 1 - index) * 32 * t + bounce - Math.max(0, age - .35) * 9)
        row.scale.set(.65 + .35 * Math.min(1, age / .18))
      })
      const g = drop.sparkle.clear()
      if (age < .5) for (let i = 0; i < 7; i++) {
        const angle = i * Math.PI * 2 / 7, radius = 12 + age * 54
        g.star(Math.cos(angle) * radius, Math.sin(angle) * radius * .65 - 15, 4, 3, 1).fill({ color: 0xffe4a3, alpha: 1 - age / .5 })
      }
    }
  }

  dispose() { this.announcement.remove() }
}
