import { Container, Graphics } from 'pixi.js'
import type { SceneSnapshot } from '../game/GameRuntime'
import { blueprintById } from '../game/buildingConfig'
import { buildingSegments, segmentHp } from '../game/buildingSegments'
import { footprint, localToWorld } from '../game/construction'
import type { Cell } from '../game/world'
import { gridToWorld } from './camera'
import { beam, buildingModel } from './buildingModel'
import { DOOR_HEIGHT_PX } from './buildingDimensions'
import { drawBuildingMesh } from './BuildingModelView'
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
          drawBuildingMesh(g, buildingModel(building, blueprint).filter(face => face.partId === roofConfig.id), anchor)
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
          const g = entry.art.clear(), h = DOOR_HEIGHT_PX
          for (const p of [a, opposite]) g.moveTo(p.x, p.y).lineTo(p.x, p.y - h - 2).stroke({ width: 3, color: 0x806247 })
          drawBuildingMesh(g, beam(hinge, end, .09, h / 32, hp < config.hp ? 0x947b63 : 0xb6814e), anchor)
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
