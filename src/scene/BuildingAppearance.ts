import { Container, Graphics } from 'pixi.js'
import type { SceneSnapshot } from '../game/GameRuntime'
import { blueprintById } from '../game/buildingConfig'
import { buildingSegments, segmentHp } from '../game/buildingSegments'
import { footprint, localToWorld } from '../game/construction'
import type { Cell } from '../game/world'
import { gridToWorld } from './camera'
import { houseStyle } from './houseStyle'
import { drawShapedRoof } from './ShapedRoof'
import { texturedSurface } from './SceneArt'

type RoofView = { view: Container; art: Graphics; signature: string }
type DoorView = RoofView & { amount: number; holdUntil: number }

/** Scene-only visibility and hinges; never changes enclosure, durability, or navigation. */
export class BuildingAppearance {
  private readonly roofs = new Map<string, RoofView>()
  private readonly doors = new Map<string, DoorView>()
  private readonly ownedViews = new Set<Container>()
  private previousTime: number | undefined
  constructor(private readonly actors: Container) {}

  owns(view: Container) { return this.ownedViews.has(view) }

  private create(): RoofView {
    const view = new Container(), art = new Graphics()
    view.eventMode = 'none'; view.addChild(art); this.actors.addChild(view)
    this.ownedViews.add(view)
    return { view, art, signature: '' }
  }

  update(snapshot: SceneSnapshot, player: Cell, placing: boolean) {
    const time = snapshot.elapsedSeconds
    const dt = this.previousTime === undefined ? 0 : Math.min(.05, Math.max(0, time - this.previousTime))
    this.previousTime = time
    const roofIds = new Set<string>(), doorIds = new Set<string>()
    const visibleRoofs: string[] = [], doorAmounts: Record<string, number> = {}
    for (const building of snapshot.construction.buildings) {
      const blueprint = blueprintById(building.blueprintId)!, cells = footprint(building, blueprint)
      const style = houseStyle(building.blueprintId)
      const inside = cells.some(cell => Math.abs(cell.x - player.x) < .5 && Math.abs(cell.y - player.y) < .5)
      const roofConfig = blueprint.parts.find(part => part.kind === 'roof')!
      const roof = building.parts[roofConfig.id]
      const roofSegments = buildingSegments(blueprint, roofConfig).filter(segment => roof.built && segmentHp(roof, segment.id) > 0)
      if (roofSegments.length) {
        roofIds.add(building.id)
        let entry = this.roofs.get(building.id)
        if (!entry) { entry = this.create(); this.roofs.set(building.id, entry) }
        const anchor = gridToWorld(localToWorld(building, { x: (blueprint.width - 1) / 2, y: (blueprint.height - 1) / 2 }))
        entry.view.position.set(anchor.x, anchor.y)
        entry.view.zIndex = Math.max(...cells.map(cell => gridToWorld(cell).y)) + 16
        entry.art.visible = !inside && !placing
        if (entry.art.visible) visibleRoofs.push(building.id)
        const signature = JSON.stringify([building.origin, building.rotation, roof])
        if (entry.signature !== signature) {
          entry.signature = signature
          const g = entry.art.clear()
          if (blueprint.cells) drawShapedRoof(g, building, blueprint, style, anchor)
          else {
          const ridge = (blueprint.height - 1) / 2
          const project = (x: number, y: number, level?: number) => {
            const p = gridToWorld(localToWorld(building, { x, y }))
            const rise = level ?? 29 + style.rise * (1 - Math.abs(y - ridge) / (blueprint.height / 2))
            return { x: p.x - anchor.x, y: p.y - anchor.y - rise }
          }
          // Close the gable ends between the flat wall top and pitched roof.
          // Each strip belongs to its existing roof tile, so damaged tiles keep their gaps.
          for (const segment of roofSegments) {
            if (segment.cell.x !== 0 && segment.cell.x !== blueprint.width - 1) continue
            const x = segment.cell.x === 0 ? -.5 : blueprint.width - .5
            const low = segment.cell.y - .5, high = segment.cell.y + .5
            const outline = [project(x, low, 28), project(x, high, 28), project(x, high)]
            if (low < ridge && ridge < high) outline.push(project(x, ridge))
            outline.push(project(x, low))
            g.poly(outline.flatMap(p => [p.x, p.y])).fill(style.wall).stroke({ width: 1, color: style.trim })
          }
          for (const segment of roofSegments) {
            const x0 = segment.cell.x - .5, x1 = segment.cell.x + .5, y0 = segment.cell.y - .5, y1 = segment.cell.y + .5
            const cuts = y0 < ridge && ridge < y1 ? [y0, ridge, y1] : [y0, y1]
            for (let i = 1; i < cuts.length; i++) {
              const low = cuts[i - 1], high = cuts[i], corners = [project(x0, low), project(x1, low), project(x1, high), project(x0, high)]
              g.poly(corners.flatMap(p => [p.x, p.y])).fill(segmentHp(roof, segment.id) < roofConfig.hp ? 0x96694f : style.roof)
              const materialRoof = building.blueprintId === 'cabin' && texturedSurface(g, 'roof', corners,
                project(-.5, ridge), project(blueprint.width - .5, ridge), project(-.5, (low + high) / 2 < ridge ? -.5 : blueprint.height - .5),
                segmentHp(roof, segment.id) < roofConfig.hp ? 0xb8a28b : (low + high) / 2 < ridge ? 0xffffff : 0xd2dfda)
              if ((low + high) / 2 < ridge) g.poly(corners.flatMap(p => [p.x, p.y])).fill({ color: 0xffffff, alpha: .08 })
              for (const [a, b, exposed] of [[corners[0], corners[1], low === -.5], [corners[1], corners[2], x1 === blueprint.width - .5],
                [corners[2], corners[3], high === blueprint.height - .5], [corners[3], corners[0], x0 === -.5]] as const) {
                if (exposed) g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ color: style.trim, width: style.roofType === 'thatch' ? 3.5 : 2 })
              }
              if (style.roofType === 'thatch') {
                for (const t of [.2, .4, .6, .8]) {
                  const a = project(x0 + t, low), b = project(x0 + t, high)
                  g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 1, color: style.trim, alpha: .6 })
                }
              } else if (!materialRoof) {
                const a = project(x0, (low + high) / 2), b = project(x1, (low + high) / 2)
                g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: .8, color: style.trim, alpha: .32 })
              }
            }
          }
          }
        }
      }
      for (const config of blueprint.parts.filter(part => part.kind === 'door')) {
        const part = building.parts[config.id]
        for (const segment of buildingSegments(blueprint, config)) {
          const hp = segmentHp(part, segment.id)
          if (!part.built || hp <= 0 || !segment.edge) continue
          const id = `${building.id}:${config.id}:${segment.id}`
          doorIds.add(id)
          const from = localToWorld(building, segment.edge.from), to = localToWorld(building, segment.edge.to)
          const normal = { x: to.x - from.x, y: to.y - from.y }
          const tangent = { x: -normal.y, y: normal.x }
          const middle = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }
          const near = Math.abs((player.x - middle.x) * tangent.x + (player.y - middle.y) * tangent.y) < .7
            && Math.abs((player.x - middle.x) * normal.x + (player.y - middle.y) * normal.y) < 1
          let entry = this.doors.get(id)
          if (!entry) {
            entry = { ...this.create(), amount: near ? 1 : 0, holdUntil: -Infinity }
            this.doors.set(id, entry)
          }
          if (near) entry.holdUntil = time + .25
          const opening = near || time < entry.holdUntil
          entry.amount = opening ? Math.min(1, entry.amount + dt / .22) : Math.max(0, entry.amount - dt / .32)
          doorAmounts[id] = Number(entry.amount.toFixed(3))
          const anchor = gridToWorld(middle)
          entry.view.position.set(anchor.x, anchor.y); entry.view.zIndex = anchor.y + .05
          const signature = `${middle.x},${middle.y},${building.rotation},${hp},${entry.amount}`
          if (entry.signature === signature) continue
          entry.signature = signature
          const hinge = { x: middle.x + tangent.x / 2, y: middle.y + tangent.y / 2 }
          const angle = entry.amount * Math.PI / 2
          const end = { x: hinge.x - tangent.x * Math.cos(angle) - normal.x * Math.sin(angle),
            y: hinge.y - tangent.y * Math.cos(angle) - normal.y * Math.sin(angle) }
          const a = gridToWorld(hinge), b = gridToWorld(end)
          const opposite = gridToWorld({ x: middle.x - tangent.x / 2, y: middle.y - tangent.y / 2 })
          for (const p of [a, b, opposite]) { p.x -= anchor.x; p.y -= anchor.y }
          const g = entry.art.clear(), h = 24
          for (const p of [a, opposite]) g.moveTo(p.x, p.y).lineTo(p.x, p.y - h - 2).stroke({ width: 3, color: 0x806247 })
          g.poly([a.x, a.y, b.x, b.y, b.x, b.y - h, a.x, a.y - h]).fill(0xb6814e).stroke({ width: 1.5, color: style.trim })
          if (building.blueprintId === 'cabin') {
            const topA = { x: a.x, y: a.y - h }, topB = { x: b.x, y: b.y - h }
            texturedSurface(g, 'wall', [a, b, topB, topA], topA, topB, a, hp < config.hp ? 0xc1ab8f : 0xe4cbb0)
          }
          g.circle(a.x + (b.x - a.x) * .82, a.y + (b.y - a.y) * .82 - h / 2, 2).fill(0xf1d59a)
          if (hp < config.hp) g.moveTo((a.x + b.x) / 2, (a.y + b.y) / 2 - h)
            .lineTo((a.x + b.x) / 2 - 3, (a.y + b.y) / 2 - h / 2).stroke({ width: 2, color: 0x4e3c30 })
        }
      }
    }
    for (const [entries, ids] of [[this.roofs, roofIds], [this.doors, doorIds]] as const) {
      for (const [id, entry] of entries) if (!ids.has(id)) {
        this.ownedViews.delete(entry.view); entry.view.destroy({ children: true }); entries.delete(id)
      }
    }
    return { visibleRoofs, doorAmounts }
  }
}
