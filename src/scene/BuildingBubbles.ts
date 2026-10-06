import { Container, Graphics, Text } from 'pixi.js'
import type { GameCommand, GameRuntime, UiSnapshot } from '../game/GameRuntime'
import { BLUEPRINTS, blueprintById } from '../game/buildingConfig'
import { buildingOrderId, buildingSummary, localToWorld } from '../game/construction'
import { buildingSegments, segmentHp } from '../game/buildingSegments'
import { availableItems, matchRequirements } from '../game/inventory'
import { actorPosition } from '../game/survival'
import { SURVIVAL_RULES } from '../game/survivalConfig'
import { TAMING_SECONDS } from '../game/taming'
import { REGIONS } from '../game/progressionConfig'
import { REGION_UNLOCK_SECONDS, regionGates } from '../game/regionUnlock'
import { gridToWorld, type Camera, type Point } from './camera'
import { CLEAR_SECONDS, RESOURCE_RULES } from '../game/economyConfig'

type Material = { id: number; owned: number; needed: number }
type Bubble = Point & {
  id: string; label: string; command: GameCommand; width: number; height: number
  kind: 'materials' | 'close' | 'sign'; materials: Material[]; signText?: string
  ready: boolean; phase: string; progress: number; disabled: boolean
}
type Entry = { model: Bubble; view: Container; ring: Graphics; focus: Graphics; button: HTMLButtonElement }
const SIZE = 30, RADIUS = SIZE / 2, ICON_SIZE = 30, MATERIAL_HEIGHT = SIZE + 18, MATERIAL_GAP = 8, PART_GAP = 12

/** World-space visuals and hit areas. Runtime remains the only owner of orders and materials. */
export class BuildingBubbles {
  readonly view = new Container()
  private readonly accessibility = document.createElement('div')
  private readonly icons = new Map<number, { svg: string; size: number }>()
  private readonly entries = new Map<string, Entry>()
  private snapshot?: UiSnapshot
  private signature = ''
  private disposed = false
  private selectedResource: string | null = null

  selectResource(id: string | null) { this.selectedResource = id; this.snapshot = undefined }

  constructor(private readonly runtime: GameRuntime, host: HTMLDivElement,
    private readonly message: (text: string) => void, private readonly openMerge: () => void) {
    // Invisible semantic mirrors support keyboard/screen readers and read-only geometry diagnostics.
    // Pointer input passes straight through to the canvas, including drags beginning on a bubble.
    this.accessibility.setAttribute('aria-label', '地图交互气泡')
    this.accessibility.style.cssText = 'position:absolute;inset:0;overflow:hidden;pointer-events:none'
    host.appendChild(this.accessibility)
    this.view.eventMode = 'none'
  }

  async load(signal: AbortSignal) {
    const ids = new Set<number>()
    // Read the same configured SVG symbols as the merge board, without a separate art catalog.
    BLUEPRINTS.forEach(b => b.parts.forEach(p => [...p.materials, ...p.repairMaterials].forEach(id => ids.add(id))))
    SURVIVAL_RULES.companion.rescueItems.forEach(id => ids.add(id))
    Object.values(RESOURCE_RULES).forEach(rule => ids.add(rule.tool))
    const sheets = new Map<string, Document>()
    for (const id of ids) {
      const item = this.runtime.catalog!.itemById.get(id)!
      const sheet = item.icon.replace(/\.svg$/, '')
      const url = `${import.meta.env.BASE_URL}assets/${sheet === 'survival' ? 'survival/items' : `fantasy-pack/${sheet}`}.svg`
      if (!sheets.has(url)) {
        const response = await fetch(url, { signal })
        if (!response.ok) throw new Error(`建筑材料图标载入失败：${item.name}`)
        sheets.set(url, new DOMParser().parseFromString(await response.text(), 'image/svg+xml'))
      }
      const symbol = sheets.get(url)!.getElementById(item.iconName)
      if (!symbol) throw new Error(`建筑材料图标不存在：${item.iconName}`)
      const size = Number(symbol.getAttribute('viewBox')?.split(/\s+/)[2] ?? 96)
      this.icons.set(id, { svg: `<svg xmlns="http://www.w3.org/2000/svg">${symbol.innerHTML}</svg>`, size })
    }
  }

  private models(state: UiSnapshot): Bubble[] {
    const inventory = state.production!.inventory, available = availableItems(inventory), result: Bubble[] = []
    const resourceIds = new Set([this.selectedResource, state.economy.clearing?.objectId, ...state.economy.clearingOrders])
    for (const object of this.runtime.world.allObjects().filter(o => resourceIds.has(o.id) && this.runtime.world.chunkAt(o)?.unlocked)) {
      const rule = RESOURCE_RULES[object.kind], job = state.economy.clearing?.objectId === object.id ? state.economy.clearing : null
      const owned = job ? 1 : available.filter(i => i.itemId === rule.tool).length, ready = !job && owned > 0
      const anchor = gridToWorld(object), x = anchor.x - RADIUS, y = anchor.y - (object.kind === 'tree' ? 112 : 48) - MATERIAL_HEIGHT
      result.push({ id: `resource-bubble-${object.id}`, x, y, width: SIZE, height: MATERIAL_HEIGHT, kind: 'materials',
        materials: [{ id: rule.tool, owned, needed: 1 }], ready, phase: job?.phase ?? 'materials', disabled: !!job,
        progress: job?.phase === 'clearing' ? 1 - job.remaining / CLEAR_SECONDS : 0,
        label: `清理${rule.name}，${this.runtime.catalog!.itemById.get(rule.tool)!.name} ${owned}/1，${job ? job.phase === 'clearing' ? '清理中' : '正在前往' : ready ? '点击清理' : '缺少工具，点击去合成'}`,
        command: { type: 'resource-interact', objectId: object.id } })
      if (job?.phase === 'travel' || !job && state.economy.clearingOrders.includes(object.id)) result.push(this.closeBubble(`cancel-resource-${object.id}`, '取消清理订单', x + SIZE - 6, y - 14, { type: 'resource-cancel', objectId: object.id }))
    }
    for (const building of state.construction.buildings) {
      const blueprint = blueprintById(building.blueprintId)!, summary = buildingSummary(building)
      const anchor = gridToWorld(localToWorld(building, { x: (blueprint.width - 1) / 2, y: (blueprint.height - 1) / 2 }))
      const rise = building.parts.roof.built ? 54 : building.parts.walls.built ? 40 : 14
      const parts = blueprint.parts.flatMap(config => {
        const part = building.parts[config.id]
        if (!config.requires.every(id => building.parts[id].built)) return []
        if (!part.built) return [{ config, segment: undefined }]
        const segments = buildingSegments(blueprint, config)
        return segments.filter(segment => segmentHp(part, segment.id) < config.hp)
          .map(segment => ({ config, segment: segments.length > 1 ? segment : undefined }))
      })
      const row: Bubble[] = parts.map(({ config, segment }) => {
        const part = building.parts[config.id], target = { buildingId: building.id, partId: config.id, ...(segment ? { segmentId: segment.id } : {}) }
        const orderId = buildingOrderId(target)
        const job = state.construction.jobs.find(job => job.orderId === orderId)
        const requirements = part.built ? config.repairMaterials : config.materials
        const ready = !job && matchRequirements(inventory, requirements) !== null
        const counts = new Map<number, number>()
        requirements.forEach(id => counts.set(id, (counts.get(id) ?? 0) + 1))
        const materials = [...counts].map(([id, needed]) => ({ id, needed, owned: job ? needed : available.filter(item => item.itemId === id).length }))
        const action = job ? job.phase === 'building' ? '施工中，保护生效' : job.phase === 'travel' ? '正在前往' : '已排队'
          : ready ? `点击${part.built ? '修复' : '建造'}` : '缺少材料，点击去合成'
        // Single-piece doors/beds also have a scene location, even without a segmented repair ID.
        const visualSegment = segment ?? (part.built ? buildingSegments(blueprint, config)[0] : undefined)
        const point = visualSegment ? gridToWorld(localToWorld(building, visualSegment.edge
          ? { x: (visualSegment.edge.from.x + visualSegment.edge.to.x) / 2, y: (visualSegment.edge.from.y + visualSegment.edge.to.y) / 2 } : visualSegment.cell)) : anchor
        const height = visualSegment ? { foundation: 4, wall: 28, door: 18, roof: 54, bed: 16 }[config.kind] : rise
        return { id: `build-bubble-${orderId}`, x: point.x - (materials.length * (SIZE + MATERIAL_GAP) - MATERIAL_GAP) / 2, y: point.y - height - MATERIAL_HEIGHT - 5,
          width: materials.length * (SIZE + MATERIAL_GAP) - MATERIAL_GAP, height: MATERIAL_HEIGHT, kind: 'materials', materials,
          ready, phase: job?.phase ?? 'materials', disabled: !!job,
          progress: job?.phase === 'building' ? 1 - job.remaining / (part.built ? config.repairSeconds : config.seconds) : 0,
          label: `${part.built ? '修复' : '建造'}${segment?.name ?? config.name}，${materials.map(m => `${this.runtime.catalog!.itemById.get(m.id)!.name} ${m.owned}/${m.needed}`).join('，')}，${action}`,
          command: { type: 'building-interact', ...target } }
      })
      const grouped = row.filter(bubble => bubble.command.type === 'building-interact' && !building.parts[bubble.command.partId].built)
      const width = grouped.reduce((sum, b) => sum + b.width, 0) + (grouped.length - 1) * PART_GAP
      let x = anchor.x - width / 2
      for (const bubble of row) {
        if (grouped.includes(bubble)) { bubble.x = x; x += bubble.width + PART_GAP }
        // Repair bubbles stay anchored to their own parts; neighboring bubbles must not displace them.
        result.push(bubble)
        if (bubble.phase === 'travel' || bubble.phase === 'queued') {
          const orderId = bubble.id.slice('build-bubble-'.length)
          const config = blueprint.parts.find(part => bubble.command.type === 'building-interact' && part.id === bubble.command.partId)!
          result.push(this.closeBubble(`cancel-${orderId}`, `取消工程 ${config.name} ${building.id}`,
            bubble.x + bubble.width - 6, bubble.y - 14, { type: 'building-cancel', orderId }))
        }
      }
      const canRemove = !blueprint.fixedRegion && !summary.builtCount && !state.construction.jobs.some(job => state.construction.orders.find(order => order.id === job.orderId)?.buildingId === building.id)
      if (canRemove) result.push(this.closeBubble(`remove-${building.id}`, `收回图纸 ${building.id}`,
        anchor.x + width / 2 - 6, row[0].y - 14, { type: 'building-remove', buildingId: building.id }))
    }
    const buddy = state.survival.companion, job = state.survival.taming.job
    if (buddy.status === 'wild' && (state.isDay || job)) {
      const anchor = gridToWorld(actorPosition(buddy)), counts = new Map<number, number>()
      SURVIVAL_RULES.companion.rescueItems.forEach(id => counts.set(id, (counts.get(id) ?? 0) + 1))
      const materials = [...counts].map(([id, needed]) => ({ id, needed, owned: job ? needed : available.filter(item => item.itemId === id).length }))
      const width = materials.length * (SIZE + MATERIAL_GAP) - MATERIAL_GAP
      const ready = !job && matchRequirements(inventory, SURVIVAL_RULES.companion.rescueItems) !== null
      const x = anchor.x - width / 2, y = anchor.y - 58 - MATERIAL_HEIGHT
      result.push({ id: 'taming-bubble', x, y, width, height: MATERIAL_HEIGHT, kind: 'materials', materials,
        ready, phase: job?.phase ?? 'materials', disabled: !!job, progress: job?.phase === 'taming' ? 1 - job.remaining / TAMING_SECONDS : 0,
        label: `驯服${SURVIVAL_RULES.companion.name}，${materials.map(m => `${this.runtime.catalog!.itemById.get(m.id)!.name} ${m.owned}/${m.needed}`).join('，')}，${job ? job.phase === 'taming' ? '驯服中' : '正在前往' : ready ? '点击驯服' : '缺少材料，点击去合成'}`,
        command: { type: 'taming-interact' } })
      if (job?.phase === 'travel') result.push(this.closeBubble('cancel-taming', '取消前往驯服', x + width - 6, y - 14, { type: 'taming-cancel' }))
    }
    for (const region of REGIONS.filter(r => !state.progression.unlockedRegions.includes(r.id))) {
      const unlock = state.progression.regionUnlock?.regionId === region.id ? state.progression.regionUnlock : null
      for (const gate of regionGates(this.runtime.world, region.id)) {
        if (!this.runtime.world.chunkAt(gate.workCell)?.unlocked) continue
        const p = gridToWorld(gate.anchor), selected = unlock?.side === gate.side
        const ready = !unlock && state.construction.xp >= region.xp && this.runtime.world.isWalkable(gate.workCell)
        const x = p.x - 28, y = p.y - 49
        result.push({ id: `region-sign-${region.id}-${gate.side}`, x, y, width: 56, height: 49, kind: 'sign', materials: [],
          ready, phase: selected ? unlock.phase : 'sign', disabled: !!unlock, progress: selected && unlock.phase === 'unlocking' ? 1 - unlock.remaining / REGION_UNLOCK_SECONDS : 0,
          signText: `${state.construction.xp}/${region.xp}`,
          label: `${region.name}指示牌，建筑经验 ${state.construction.xp}/${region.xp}，${selected ? unlock.phase === 'unlocking' ? '正在开放' : '正在前往' : '点击开放区域'}`,
          command: { type: 'region-unlock', regionId: region.id, side: gate.side } })
        if (selected && unlock.phase === 'travel') result.push(this.closeBubble(`cancel-region-${region.id}`, '取消前往指示牌', x + 44, y - 14, { type: 'region-unlock-cancel' }))
      }
    }
    return result
  }

  private closeBubble(id: string, label: string, x: number, y: number, command: GameCommand): Bubble {
    return { id, label, x, y, command, width: 24, height: 24, kind: 'close', materials: [], ready: false, phase: '', progress: 0, disabled: false }
  }

  private color(b: Bubble) { return b.ready ? 0xd6ecc1 : ['building', 'taming', 'clearing'].includes(b.phase) ? 0xfae4b7 : 0xfaf3e4 }

  private create(model: Bubble): Entry {
    const view = new Container(), g = new Graphics(), ring = new Graphics(), focus = new Graphics()
    view.position.set(model.x, model.y); view.addChild(g)
    const color = this.color(model), ink = model.ready ? 0x34592d : 0x806c4c
    const border = model.ready ? 0x93b77c : ['building', 'taming', 'clearing'].includes(model.phase) ? 0xd0b274 : 0xeee1c5
    if (model.kind === 'sign') {
      g.ellipse(28, 47, 15, 4).fill({ color: 0x31432d, alpha: .18 })
      g.roundRect(25, 28, 6, 20, 2).fill(0x92724e)
      g.roundRect(0, 0, 56, 35, 5).fill(model.ready ? 0xd3e5b1 : 0xe7d6ad).stroke({ color: model.ready ? 0x638344 : 0x9f8054, width: 2 })
      const title = new Text({ text: '建筑经验', resolution: 3, style: { fontFamily: 'sans-serif', fontSize: 9, fill: ink } })
      title.anchor.set(.5, 0); title.position.set(28, 4); view.addChild(title)
      const xp = new Text({ text: model.signText, resolution: 3, style: { fontFamily: 'sans-serif', fontSize: 12, fontWeight: '600', fill: ink } })
      xp.anchor.set(.5, 0); xp.position.set(28, 17); view.addChild(xp)
    } else if (model.kind === 'close') {
      g.circle(12, 12, 12).fill(0xf8f0dc).stroke({ color: 0xe6debd, width: 1 })
      g.moveTo(8, 8).lineTo(16, 16).moveTo(16, 8).lineTo(8, 16).stroke({ color: 0x8a7654, width: 1.4 })
    } else {
      for (let i = 0; i < Math.max(1, model.materials.length); i++) {
        const x = i * (SIZE + MATERIAL_GAP)
        g.circle(x + RADIUS, RADIUS + 2, RADIUS).fill({ color: 0x32492d, alpha: .12 })
        g.poly([x + RADIUS - 3, SIZE - 2, x + RADIUS, SIZE + 3, x + RADIUS + 3, SIZE - 2]).fill(color).stroke({ color: border, width: 1 })
        g.circle(x + RADIUS, RADIUS, RADIUS).fill(color).stroke({ color: border, width: 1 })
        if (model.phase === 'travel' || model.phase === 'queued') for (let a = 0; a < Math.PI * 2; a += .3) {
          g.arc(x + RADIUS, RADIUS, RADIUS - 1, a, a + .15).stroke({ color: 0xbda773, width: 1 })
        }
        const material = model.materials[i]
        if (material) {
          const icon = this.icons.get(material.id)!, art = new Graphics().svg(icon.svg)
          art.scale.set(ICON_SIZE / icon.size); art.position.set(x + (SIZE - ICON_SIZE) / 2, (SIZE - ICON_SIZE) / 2); view.addChild(art)
          const count = new Text({ text: `${material.owned}/${material.needed}`, resolution: 3,
            style: { fontFamily: 'sans-serif', fontSize: 11, fontWeight: '600', fill: ink } })
          count.anchor.set(.5, 0); count.position.set(x + RADIUS, SIZE + 5); view.addChild(count)
        }
      }
    }
    view.addChild(ring, focus); this.view.addChild(view)
    const button = document.createElement('button')
    button.type = 'button'; button.setAttribute('aria-label', model.label); button.disabled = model.disabled
    button.dataset.testid = model.id; button.dataset.ready = String(model.ready); button.dataset.phase = model.phase
    button.dataset.color = color.toString(16); button.dataset.renderer = 'pixi'
    button.style.cssText = 'position:absolute;left:0;top:0;margin:0;padding:0;border:0;opacity:0;pointer-events:none;transform-origin:0 0'
    button.addEventListener('click', () => this.activate(model.id))
    button.addEventListener('focus', () => focus.roundRect(-3, -3, model.width + 6, model.height + 6, 12).stroke({ color: 0x426c33, width: 2 }))
    button.addEventListener('blur', () => focus.clear())
    this.accessibility.appendChild(button)
    return { model, view, ring, focus, button }
  }

  update(state: UiSnapshot, camera: Camera, hidden: boolean) {
    const visible = !hidden && !state.pauseReasons.length
    this.view.visible = visible; this.accessibility.hidden = !visible
    if (state !== this.snapshot) {
      this.snapshot = state
      const models = this.models(state)
      const signature = JSON.stringify(models.map(({ progress: _progress, ...model }) => model))
      if (signature !== this.signature) {
        this.signature = signature
        for (const entry of this.entries.values()) { entry.view.destroy({ children: true }); entry.button.remove() }
        this.entries.clear()
        for (const model of models) this.entries.set(model.id, this.create(model))
      }
      for (const model of models) {
        const entry = this.entries.get(model.id)!
        entry.model = model; entry.ring.clear()
        if (model.kind === 'sign' && model.phase === 'unlocking') {
          entry.ring.roundRect(4, 37, 48, 4, 2).fill({ color: 0x344d2e, alpha: .3 })
          if (model.progress > 0) entry.ring.roundRect(4, 37, Math.max(1, model.progress * 48), 4, 2).fill(0xe2efb3)
        }
        if (['building', 'taming', 'clearing'].includes(model.phase) && model.progress > 0) for (let i = 0; i < model.materials.length; i++) {
          entry.ring.arc(i * (SIZE + MATERIAL_GAP) + RADIUS, RADIUS, RADIUS - 2, -Math.PI / 2, -Math.PI / 2 + Math.min(1, model.progress) * Math.PI * 2)
            .stroke({ color: 0x9c7d3a, width: 2, cap: 'round' })
        }
      }
    }
    for (const entry of this.entries.values()) {
      const b = entry.model, p = entry.view.toGlobal({ x: 0, y: 0 })
      const corner = entry.view.toGlobal({ x: b.width, y: b.height }), width = corner.x - p.x, height = corner.y - p.y
      const inView = p.x + width >= 0 && p.x <= camera.width && p.y + height + 5 * camera.zoom >= 0 && p.y <= camera.height
      entry.view.visible = inView; entry.button.hidden = !inView
      entry.button.style.transform = `translate(${p.x}px, ${p.y}px)`
      entry.button.style.width = `${width}px`; entry.button.style.height = `${height}px`
    }
  }

  tap(world: Point): boolean {
    if (!this.view.visible || this.disposed) return false
    // Reverse render order so a small cancel/remove button wins over its material circle.
    for (const entry of [...this.entries.values()].reverse()) {
      const b = entry.model, x = world.x - b.x, y = world.y - b.y
      if (!entry.view.visible || x < 0 || x > b.width || y < 0 || y > b.height) continue
      if (b.kind === 'sign') { this.activate(b.id); return true }
      const r = b.kind === 'close' ? 12 : RADIUS
      const localX = b.kind === 'close' ? x : x % (SIZE + MATERIAL_GAP)
      const onQuantity = b.kind === 'materials' && localX <= SIZE && y >= SIZE + 5
      if (!onQuantity && Math.hypot(localX - r, y - r) > r) continue
      this.activate(b.id); return true
    }
    return false
  }

  private activate(id: string) {
    const entry = this.entries.get(id)
    if (!entry || !this.view.visible || entry.model.disabled || this.disposed) return
    void this.runtime.dispatch(entry.model.command).then(result => {
      if (this.disposed) return
      if (!result.accepted) this.message(result.reason)
      else if (result.openProduction) this.openMerge()
      else if (result.message) this.message(result.message)
    })
  }

  dispose() { this.disposed = true; this.accessibility.remove(); this.view.destroy({ children: true }); this.entries.clear() }
}
