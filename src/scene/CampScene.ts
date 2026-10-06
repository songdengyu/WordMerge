import { Application, Container, Graphics, Text } from 'pixi.js'
import { CHUNK_SIZE, type Cell, type WorldObject } from '../game/world'
import type { GameRuntime, SceneSnapshot } from '../game/GameRuntime'
import { Camera, gridToWorld, worldToPosition } from './camera'
import { attachMapInput } from './mapInput'
import { footprint, localToWorld, type Rotation } from '../game/construction'
import { buildingSegments, segmentHp } from '../game/buildingSegments'
import { blueprintById } from '../game/buildingConfig'
import { actorPosition, distance } from '../game/survival'
import { SurvivalActors } from './SurvivalActors'
import { decorError } from '../game/progression'
import { OUTFITS, REGIONS, type DecorId } from '../game/progressionConfig'
import { drawDecoration, ProgressionViews } from './ProgressionViews'
import { Atmosphere } from './Atmosphere'
import { BuildingBubbles } from './BuildingBubbles'

const RESIDENT_CELL: Cell = { x: 11, y: 8 }

const diamond = (graphics: Graphics, x: number, y: number, color: number, alpha = 1) =>
  graphics.poly([x, y - 16, x + 32, y, x, y + 16, x - 32, y]).fill({ color, alpha })
const noise = (x: number, y: number) => Math.abs((x * 7919 + y * 104729) % 17)

function makeObject(object: WorldObject): Container {
  const root = new Container()
  const g = new Graphics()
  g.ellipse(4, 2, 21, 9).fill({ color: 0x19382e, alpha: 0.18 })
  if (object.kind === 'tree') {
    g.roundRect(-4, -34, 8, 34, 3).fill(0x79614a)
    g.poly([-30, -25, 0, -71, 30, -25]).fill(0x345c46)
    g.poly([-25, -43, 0, -90, 25, -43]).fill(0x447455)
    g.poly([-18, -62, 0, -102, 18, -62]).fill(0x5c8d65)
    g.poly([-18, -62, 0, -102, -1, -65]).fill({ color: 0x99b77b, alpha: 0.32 })
  } else if (object.kind === 'boulder') {
    g.poly([-22, -3, -18, -22, 1, -32, 19, -20, 23, 0, 4, 7]).fill(0x8b9991)
    g.poly([-18, -22, 1, -32, 19, -20, -1, -11]).fill(0xb6c1ac)
    g.poly([-22, -3, -18, -22, -1, -11, 4, 7]).fill(0x9eada0)
  } else if (object.kind === 'campfire') {
    g.ellipse(0, 0, 23, 12).fill(0xa5977a)
    g.ellipse(0, 0, 17, 8).fill(0x645749)
    g.moveTo(-13, -4).lineTo(13, 5).stroke({ color: 0x755740, width: 6 })
    g.moveTo(13, -4).lineTo(-13, 5).stroke({ color: 0x8b6544, width: 6 })
    // An unlit old firepit: no survival or warmth effect in this milestone.
    for (const [x, y] of [[-21, 0], [-12, -8], [10, -8], [21, 0], [10, 9], [-11, 9]]) {
      g.ellipse(x, y, 5, 3).fill(0xc4c4af)
    }
  } else {
    g.roundRect(-3, -36, 6, 37, 2).fill(0x7e6448)
    g.poly([-18, -40, 14, -40, 23, -32, 14, -24, -18, -24]).fill(0xc5ac7b)
    g.moveTo(-11, -32).lineTo(11, -32).stroke({ color: 0x806647, width: 2 })
  }
  root.addChild(g)
  const p = gridToWorld(object)
  root.position.set(p.x, p.y)
  root.zIndex = p.y
  return root
}

function makePlayer(color = 0xc77b64) {
  const root = new Container()
  const g = new Graphics()
  g.ellipse(0, 1, 11, 5).fill({ color: 0x254035, alpha: 0.25 })
  g.roundRect(-6, -9, 5, 10, 2).fill(0x5a4b40)
  g.roundRect(2, -9, 5, 10, 2).fill(0x5a4b40)
  g.poly([-7, -28, 7, -28, 10, -10, -10, -10]).fill(color)
  g.roundRect(-10, -27, 5, 15, 2).fill(0xe7be94)
  g.roundRect(6, -27, 5, 15, 2).fill(0xe7be94)
  g.ellipse(0, -35, 10, 12).fill(0x634f42)
  g.ellipse(1, -33, 7, 8).fill(0xf0cba2)
  g.poly([-9, -36, -4, -47, 7, -43, 10, -36, 1, -40, -5, -34]).fill(0x644e41)
  g.circle(4, -33, 1).fill(0x584638)
  g.moveTo(-5, -27).lineTo(6, -13).stroke({ width: 3, color: 0xe9d7ac })
  g.roundRect(3, -19, 8, 8, 2).fill(0x866b48)
  root.addChild(g)
  return root
}

export class CampScene {
  private readonly app = new Application()
  private readonly root = new Container()
  private readonly ground = new Container()
  private readonly actors = new Container()
  private readonly route = new Graphics()
  private readonly buildings = new Graphics()
  private readonly preview = new Graphics()
  private readonly protection = new Graphics()
  private readonly progressionViews = new ProgressionViews()
  private readonly decorPreview = new Graphics()
  private decorationPlacement: { kind: DecorId; cell: Cell } | null = null
  private regionSignature = ''
  private outfit = 'clay'
  private resident: Container | null = null
  private placement: { blueprintId: string; origin: Cell; rotation: Rotation } | null = null
  private buildingSignature = ''
  private previewSignature = ''
  private player = makePlayer()
  private readonly atmosphere = new Atmosphere()
  private readonly survivalActors = new SurvivalActors(this.actors)
  private readonly chunks: { view: Container; left: number; right: number; top: number; bottom: number }[] = []
  private readonly objectViews = new Map<string, Container>()
  private readonly camera: Camera
  private detachInput?: () => void
  private resizeObserver?: ResizeObserver
  private initialized = false
  private disposed = false
  private lastSnapshot?: SceneSnapshot
  private lastWidth = 0
  private lastHeight = 0
  private contextLost = false
  private readonly buildingBubbles: BuildingBubbles
  private bubblesHidden = false
  private companionControl = false
  private readonly assetAbort = new AbortController()

  constructor(private readonly host: HTMLDivElement, private readonly runtime: GameRuntime,
    private readonly onMessage: (message: string) => void, private readonly onError: (message: string) => void,
    private readonly onOrigin: (cell: Cell) => void,
    private readonly openMerge: () => void, private readonly onCompanion: () => void, private readonly onJournal: () => void) {
    this.buildingBubbles = new BuildingBubbles(runtime, host, onMessage, openMerge)
    const corners = runtime.world.config.chunks.flatMap(chunk => [
      gridToWorld({ x: chunk.x * CHUNK_SIZE - 0.5, y: chunk.y * CHUNK_SIZE - 0.5 }),
      gridToWorld({ x: (chunk.x + 1) * CHUNK_SIZE - 0.5, y: chunk.y * CHUNK_SIZE - 0.5 }),
      gridToWorld({ x: chunk.x * CHUNK_SIZE - 0.5, y: (chunk.y + 1) * CHUNK_SIZE - 0.5 }),
      gridToWorld({ x: (chunk.x + 1) * CHUNK_SIZE - 0.5, y: (chunk.y + 1) * CHUNK_SIZE - 0.5 }),
    ])
    this.camera = new Camera({ left: Math.min(...corners.map(p => p.x)), right: Math.max(...corners.map(p => p.x)),
      top: Math.min(...corners.map(p => p.y)), bottom: Math.max(...corners.map(p => p.y)) })
  }

  async init() {
    try {
      await this.app.init({ preference: 'webgl', backgroundAlpha: 0, antialias: true,
        resolution: Math.min(window.devicePixelRatio || 1, 2), autoDensity: true, autoStart: false })
      this.initialized = true
      if (this.disposed) { this.destroyApplication(); return }
      await this.buildingBubbles.load(this.assetAbort.signal)
      if (this.disposed) return
      const canvas = this.app.canvas
      canvas.setAttribute('aria-label', '林间营地地图，轻点空地移动，拖动查看，双指缩放')
      canvas.setAttribute('role', 'img')
      canvas.dataset.testid = 'camp-canvas'
      this.host.appendChild(canvas)
      canvas.addEventListener('webglcontextlost', this.onContextLost)
      canvas.addEventListener('webglcontextrestored', this.onContextRestored)
      this.root.addChild(this.ground, this.buildings, this.progressionViews.view, this.survivalActors.guard, this.preview, this.decorPreview, this.route, this.protection, this.actors, this.buildingBubbles.view)
      this.actors.sortableChildren = true
      this.actors.addChild(this.player)
      this.app.stage.addChild(this.root, this.atmosphere.view)
      this.buildMap()
      this.resize()
      this.camera.center(this.runtime.getSceneSnapshot().position)
      this.resizeObserver = new ResizeObserver(() => this.resize())
      this.resizeObserver.observe(this.host)
      this.detachInput = attachMapInput(canvas, this.camera, (cell, world) => {
        if (this.companionControl || !this.buildingBubbles.tap(world)) this.tap(cell, worldToPosition(world))
      })
      this.app.ticker.add(this.render)
      this.app.start()
      this.runtime.setPauseReason('renderer-lost', false)
      this.runtime.setPauseReason('renderer-loading', false)
      this.host.dataset.ready = 'true'
    } catch (error) {
      if (!this.disposed) {
        this.runtime.setPauseReason('renderer-loading', true)
        this.onError(`地图未能载入，请重试或使用支持 WebGL 的浏览器。${error instanceof Error ? error.message : ''}`)
      }
    }
  }

  centerPlayer() { this.camera.center(this.runtime.getSceneSnapshot().position) }
  centerCell(cell: Cell) { this.camera.center(cell) }
  setDecorationPlacement(placement: typeof this.decorationPlacement) { this.decorationPlacement = placement }
  centerBuilding(id: string) {
    const building = this.runtime.getUiSnapshot().construction.buildings.find(building => building.id === id)
    if (building) {
        const blueprint = blueprintById(building.blueprintId)!
        this.camera.center(localToWorld(building, { x: (blueprint.width - 1) / 2, y: (blueprint.height - 1) / 2 }))
      this.camera.pan(0, Math.min(40, this.camera.height * .06))
    }
  }
  setPlacement(placement: typeof this.placement) { this.placement = placement }
  setBubblesHidden(hidden: boolean) { this.bubblesHidden = hidden }
  setCompanionControl(active: boolean) { this.companionControl = active }
  zoomBy(factor: number) { this.camera.zoomAt(this.camera.zoom * factor, { x: this.camera.width / 2, y: this.camera.height / 2 }) }

  private tap(cell: Cell, point: Cell) {
    if (this.companionControl) {
      void this.runtime.dispatch({ type: 'companion-move', target: point }).then(result => {
        if (!this.disposed && !result.accepted) this.onMessage(result.reason)
      })
      return
    }
    if (this.placement || this.decorationPlacement) { this.onOrigin(cell); return }
    const progress = this.runtime.getUiSnapshot().progression
    if (progress.completed.includes('visitor') && distance(cell, RESIDENT_CELL) < .8) { this.onJournal(); return }
    const landmark = REGIONS.find(r => progress.unlockedRegions.includes(r.id) && distance(cell, r.point) < .8)
    if (landmark && progress.discoveries.includes(landmark.id)) { this.onJournal(); return }
    const survival = this.runtime.getUiSnapshot().survival
    const animalPoint = gridToWorld(actorPosition(survival.companion)), tapPoint = gridToWorld(point)
    if (!survival.duel && Math.abs(tapPoint.x - animalPoint.x) <= 26 && tapPoint.y >= animalPoint.y - 38 && tapPoint.y <= animalPoint.y + 10) {
      if (survival.companion.status !== 'wild') this.onCompanion()
      else void this.runtime.dispatch({ type: 'taming-interact' }).then(result => {
        if (this.disposed) return
        if (!result.accepted) this.onMessage(result.reason)
        else if (result.openProduction) this.openMerge()
        else if (result.message) this.onMessage(result.message)
      })
      return
    }
    const enemy = survival.enemies.find(enemy => enemy.id !== survival.duel?.enemy.id && distance(actorPosition(enemy), cell) < .8)
    if (enemy) {
      void this.runtime.dispatch({ type: 'companion-attack', enemyId: enemy.id }).then(result => {
        if (!this.disposed) this.onMessage(result.accepted ? result.message ?? '已指派伙伴' : result.reason)
      }); return
    }
    const object = this.runtime.world.objectAt(cell) ?? this.runtime.world.allObjects()
      .filter(o => this.runtime.world.chunkAt(o)?.unlocked).sort((a, b) => gridToWorld(b).y - gridToWorld(a).y).find(o => {
        const p = gridToWorld(o), height = o.kind === 'tree' ? 104 : o.kind === 'sign' ? 40 : o.kind === 'boulder' ? 32 : 12
        return Math.abs(tapPoint.x - p.x) <= (o.kind === 'tree' ? 28 : 22) && tapPoint.y >= p.y - height && tapPoint.y <= p.y + 7
      })
    if (object) {
      this.buildingBubbles.selectResource(object.id)
      return
    }
    this.buildingBubbles.selectResource(null)
    void this.runtime.dispatch({ type: 'move', target: point }).then(result => {
      if (!this.disposed && !result.accepted) this.onMessage(result.reason)
    })
  }

  private drawBuildings(snapshot: SceneSnapshot) {
    const signature = JSON.stringify(snapshot.construction.buildings)
    if (signature !== this.buildingSignature) {
      this.buildingSignature = signature
      const g = this.buildings.clear()
      for (const building of snapshot.construction.buildings) {
        const blueprint = blueprintById(building.blueprintId)!
        const foundation = building.parts.foundation, floorConfig = blueprint.parts.find(part => part.kind === 'foundation')!
        for (const segment of buildingSegments(blueprint, floorConfig)) {
          const p = gridToWorld(localToWorld(building, segment.cell)), hp = segmentHp(foundation, segment.id)
          diamond(g, p.x, p.y, foundation.built ? hp > 0 ? 0xc3a477 : 0x756951 : 0xeee5be, foundation.built ? hp > 0 ? .95 : .45 : .38)
          g.poly([p.x, p.y - 15, p.x + 31, p.y, p.x, p.y + 15, p.x - 31, p.y]).stroke({ width: 1, color: 0xf9edc7, alpha: 0.65 })
          if (foundation.built && hp < floorConfig.hp) g.moveTo(p.x - 10, p.y - 5).lineTo(p.x, p.y).lineTo(p.x - 3, p.y + 6).lineTo(p.x + 12, p.y + 5).stroke({ width: 2, color: 0x70513d })
        }
        for (const config of blueprint.parts) {
          const part = building.parts[config.id]
          if (!part.built) continue
          for (const segment of buildingSegments(blueprint, config)) {
            const edge = segment.edge, hp = segmentHp(part, segment.id)
            if (!edge || hp <= 0) continue
            const from = localToWorld(building, edge.from), to = localToWorld(building, edge.to)
            const dx = to.x - from.x, dy = to.y - from.y
            const a = gridToWorld({ x: (from.x + to.x) / 2 - dy / 2, y: (from.y + to.y) / 2 + dx / 2 })
            const b = gridToWorld({ x: (from.x + to.x) / 2 + dy / 2, y: (from.y + to.y) / 2 - dx / 2 })
            const h = config.kind === 'door' ? 18 : 28
            g.poly([a.x, a.y, b.x, b.y, b.x, b.y - h, a.x, a.y - h]).fill({ color: config.kind === 'door' ? 0xb6814e : 0x8e775b, alpha: .8 })
              .stroke({ width: 1.5, color: 0xe4c698 })
            if (config.kind === 'door') g.circle((a.x + b.x) / 2 + 4, (a.y + b.y) / 2 - 8, 2).fill(0xf1d59a)
            if (hp < config.hp) g.moveTo((a.x + b.x) / 2, (a.y + b.y) / 2 - h).lineTo((a.x + b.x) / 2 - 4, (a.y + b.y) / 2 - h / 2)
              .lineTo((a.x + b.x) / 2 + 3, (a.y + b.y) / 2 - 4).stroke({ width: 2, color: 0x4e3c30 })
          }
          if (config.kind === 'roof') {
            for (const segment of buildingSegments(blueprint, config)) {
              const hp = segmentHp(part, segment.id)
              if (hp <= 0) continue
              const p = gridToWorld(localToWorld(building, segment.cell))
              diamond(g, p.x, p.y - 38, hp < config.hp ? 0x96694f : 0xb66f59, .24)
              g.poly([p.x, p.y - 54, p.x + 32, p.y - 38, p.x, p.y - 22, p.x - 32, p.y - 38]).stroke({ width: 1, color: 0xe4af86, alpha: .4 })
            }
          }
          if (config.kind === 'bed' && part.hp > 0) {
            const p = gridToWorld(localToWorld(building, { x: 0, y: 1 }))
            g.roundRect(p.x - 13, p.y - 16, 26, 15, 4).fill(0xd9b4a0).stroke({ width: 2, color: 0xffefd2 })
            g.roundRect(p.x - 10, p.y - 14, 8, 10, 3).fill(0xf7e5c9)
          }
        }
      }
    }
    const previewSignature = JSON.stringify([this.placement, signature, this.runtime.getUiSnapshot().player])
    if (previewSignature !== this.previewSignature) {
      this.previewSignature = previewSignature
      this.preview.clear()
      if (this.placement) {
      const valid = !this.runtime.placementError(this.placement.blueprintId, this.placement.origin, this.placement.rotation)
      const blueprint = blueprintById(this.placement.blueprintId)!
      for (const cell of footprint(this.placement, blueprint)) {
        const p = gridToWorld(cell)
        diamond(this.preview, p.x, p.y, valid ? 0xf0edb0 : 0xce7767, .6)
        this.preview.poly([p.x, p.y - 16, p.x + 32, p.y, p.x, p.y + 16, p.x - 32, p.y]).stroke({ color: valid ? 0xfff9ca : 0xefada0, width: 2 })
      }
      const door = gridToWorld(localToWorld(this.placement, { x: 1, y: 1.5 }))
      this.preview.circle(door.x, door.y, 5).fill(0xfff8d2)
      }
    }
    this.protection.clear()
    if (snapshot.construction.jobs[0]?.phase === 'building' || snapshot.survival.taming.job?.phase === 'taming' || snapshot.progression.regionUnlock?.phase === 'unlocking') {
      const p = gridToWorld(snapshot.position)
      this.protection.ellipse(p.x, p.y, 23, 12).fill({ color: 0xfbe2a1, alpha: .3 }).stroke({ color: 0xffecc0, width: 2 })
    }
  }

  private resize() {
    const width = Math.max(1, this.host.clientWidth)
    const height = Math.max(1, this.host.clientHeight)
    this.app.renderer.resize(width, height)
    this.camera.resize(width, height)
    this.lastWidth = width; this.lastHeight = height
  }

  private buildMap() {
    this.ground.removeChildren().forEach(child => child.destroy({ children: true }))
    this.chunks.length = 0
    const state = this.runtime.getUiSnapshot()
    this.regionSignature = `${state.progression.unlockedRegions.join(',')}|${state.economy.removedObjects.join(',')}`
    for (const config of this.runtime.world.config.chunks) {
      const chunk = this.runtime.world.chunkAt({ x: config.x * CHUNK_SIZE, y: config.y * CHUNK_SIZE })!
      const view = new Container()
      const g = new Graphics()
      let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity
      for (let y = 0; y < CHUNK_SIZE; y++) for (let x = 0; x < CHUNK_SIZE; x++) {
        const cell = { x: chunk.x * CHUNK_SIZE + x, y: chunk.y * CHUNK_SIZE + y }
        const p = gridToWorld(cell)
        left = Math.min(left, p.x - 32); right = Math.max(right, p.x + 32)
        top = Math.min(top, p.y - 16); bottom = Math.max(bottom, p.y + 16)
        const terrain = this.runtime.world.terrainAt(cell)
        const variation = noise(cell.x, cell.y)
        const color = !chunk.unlocked ? (variation % 2 ? 0x718c7b : 0x748e7e)
          : terrain === 'water' ? (variation % 2 ? 0x7ba9a3 : 0x80aea5)
          : terrain === 'path' ? (variation % 2 ? 0xd0c29a : 0xcbbd95)
          : terrain === 'rock' ? 0x9aa890
          : [0xa6b988, 0xa1b584, 0xa9bb8c, 0x9fb181][variation % 4]
        diamond(g, p.x, p.y, color)
        if (chunk.unlocked && terrain === 'water') {
          g.moveTo(p.x - 9, p.y + 1).lineTo(p.x + 7, p.y + 1).stroke({ color: 0xc7ddd0, alpha: 0.4, width: 1.5 })
        } else if (chunk.unlocked && terrain === 'grass' && variation % 3 === 0) {
          g.moveTo(p.x - 3, p.y + 3).lineTo(p.x - 5, p.y - 1).moveTo(p.x - 3, p.y + 3).lineTo(p.x + 1, p.y - 2)
            .stroke({ color: 0x71895f, alpha: 0.45, width: 1.5 })
          if (variation === 0) g.circle(p.x + 8, p.y, 2).fill(0xf4e4ae)
        }
      }
      view.addChild(g)
      if (!chunk.unlocked) {
        const center = gridToWorld({ x: chunk.x * CHUNK_SIZE + 7.5, y: chunk.y * CHUNK_SIZE + 7.5 })
        const title = new Text({ text: `${chunk.name}\n尚未探索`, style: {
          fontFamily: 'sans-serif', fontSize: 18, lineHeight: 28, fill: 0xdfebd6, align: 'center', letterSpacing: 2,
        } })
        title.anchor.set(0.5); title.position.set(center.x, center.y)
        view.addChild(title)
      }
      this.ground.addChild(view)
      this.chunks.push({ view, left, right, top, bottom })
    }
    const objects = this.runtime.world.allObjects().filter(object => this.runtime.world.chunkAt(object)?.unlocked)
    const visible = new Set(objects.map(object => object.id))
    for (const [id, view] of this.objectViews) if (!visible.has(id)) { view.destroy({ children: true }); this.objectViews.delete(id) }
    for (const object of objects) if (!this.objectViews.has(object.id)) {
      const view = makeObject(object); this.objectViews.set(object.id, view); this.actors.addChild(view)
    }
  }

  private render = () => {
    if (this.disposed || this.contextLost) return
    const snapshot = this.runtime.getSceneSnapshot()
    if (this.regionSignature !== `${snapshot.progression.unlockedRegions.join(',')}|${snapshot.economy.removedObjects.join(',')}`) this.buildMap()
    this.progressionViews.draw(snapshot.progression)
    if (snapshot.progression.outfit !== this.outfit) {
      this.outfit = snapshot.progression.outfit; this.player.destroy({ children: true })
      this.player = makePlayer(OUTFITS.find(o => o.id === this.outfit)!.color); this.actors.addChild(this.player)
    }
    if (snapshot.progression.completed.includes('visitor') && !this.resident) {
      this.resident = makePlayer(0x7c92a2)
      const p = gridToWorld(RESIDENT_CELL); this.resident.position.set(p.x, p.y); this.resident.zIndex = p.y + .1
      const label = new Text({ text: '林岚', style: { fontSize: 11, fill: 0xfff4d8, stroke: { color: 0x49624d, width: 3 } } })
      label.anchor.set(.5, 1); label.y = -50; this.resident.addChild(label); this.actors.addChild(this.resident)
    } else if (!snapshot.progression.completed.includes('visitor') && this.resident) { this.resident.destroy({ children: true }); this.resident = null }
    this.decorPreview.clear()
    if (this.decorationPlacement) {
      const { cell, kind } = this.decorationPlacement, p = gridToWorld(cell)
      const valid = !decorError(kind, cell, snapshot.progression, snapshot.construction)
      diamond(this.decorPreview, p.x, p.y, valid ? 0xf6edb4 : 0xce8878, .65)
      drawDecoration(this.decorPreview, kind, p.x, p.y, .8)
    }
    this.drawBuildings(snapshot)
    this.survivalActors.draw(snapshot, this.runtime.getInterpolation())
    const lights = [
      ...this.runtime.world.allObjects().filter(o => o.kind === 'campfire'),
      ...snapshot.progression.decorations.filter(d => d.kind === 'lantern').map(d => d.cell),
    ].map(cell => this.camera.toScreen(gridToWorld(cell)))
    const light = this.atmosphere.draw(snapshot, this.lastWidth, this.lastHeight, lights)
    const alpha = this.runtime.getInterpolation()
    const position = { x: snapshot.previousPosition.x + (snapshot.position.x - snapshot.previousPosition.x) * alpha,
      y: snapshot.previousPosition.y + (snapshot.position.y - snapshot.previousPosition.y) * alpha }
    const foot = gridToWorld(position)
    this.player.position.set(foot.x, foot.y)
    this.player.zIndex = foot.y + 0.1
    this.root.position.set(this.camera.x, this.camera.y)
    this.root.scale.set(this.camera.zoom)
    this.buildingBubbles.update(this.runtime.getUiSnapshot(), this.camera, this.bubblesHidden || this.companionControl)
    if (snapshot !== this.lastSnapshot) {
      this.route.clear()
      if (snapshot.destination) {
        const p = gridToWorld(snapshot.destination)
        this.route.ellipse(p.x, p.y, 15, 7).stroke({ width: 2, color: 0xfff5cf })
      }
      if (snapshot.survival.companion.mode === 'move') {
        const p = gridToWorld(snapshot.survival.companion.guard)
        this.route.ellipse(p.x, p.y, 15, 7).stroke({ width: 2, color: 0xc4e49b })
      }
      this.lastSnapshot = snapshot
    }
    for (const chunk of this.chunks) {
      const tl = this.camera.toScreen({ x: chunk.left, y: chunk.top })
      const br = this.camera.toScreen({ x: chunk.right, y: chunk.bottom })
      chunk.view.visible = br.x > 0 && tl.x < this.lastWidth && br.y > 0 && tl.y < this.lastHeight
    }
    for (const actor of this.actors.children) {
      const p = this.camera.toScreen(actor.position)
      actor.visible = p.x > -60 && p.x < this.lastWidth + 60 && p.y > -20 && p.y < this.lastHeight + 130
    }
    // Small, read-only DOM diagnostics also make real pointer workflows reproducible in browser tests.
    this.host.dataset.camera = `${this.camera.x},${this.camera.y},${this.camera.zoom}`
    this.host.dataset.position = `${position.x.toFixed(4)},${position.y.toFixed(4)}`
    const companionPosition = actorPosition(snapshot.survival.companion)
    this.host.dataset.companionPosition = `${companionPosition.x.toFixed(4)},${companionPosition.y.toFixed(4)}`
    this.host.dataset.duelPhase = snapshot.survival.duel?.phase ?? 'idle'
    this.host.dataset.duelEnemy = snapshot.survival.duel?.enemy.id ?? ''
    this.host.dataset.weather = snapshot.survival.weather
    this.host.dataset.phase = light.phase
    this.host.dataset.darkness = light.darkness.toFixed(3)
    this.host.dataset.regions = snapshot.progression.unlockedRegions.join(',')
    this.host.dataset.residentBoars = String(snapshot.survival.enemies.filter(enemy => enemy.residentId).length)
    this.host.dataset.outfit = snapshot.progression.outfit
    this.host.dataset.decorations = String(snapshot.progression.decorations.length)
  }

  private onContextLost = (event: Event) => {
    event.preventDefault()
    this.contextLost = true
    this.runtime.setPauseReason('renderer-lost', true)
    this.onMessage('地图画面正在恢复，营地已暂停。')
  }
  private onContextRestored = () => {
    this.contextLost = false
    this.runtime.setPauseReason('renderer-lost', false)
    this.onMessage('地图已恢复，可以继续探索。')
  }

  private destroyApplication() {
    if (!this.initialized) return
    this.app.canvas.removeEventListener('webglcontextlost', this.onContextLost)
    this.app.canvas.removeEventListener('webglcontextrestored', this.onContextRestored)
    this.app.destroy({ removeView: true }, { children: true })
    this.initialized = false
  }
  dispose() {
    this.disposed = true
    this.assetAbort.abort()
    this.buildingBubbles.dispose()
    this.detachInput?.()
    this.resizeObserver?.disconnect()
    this.destroyApplication()
    delete this.host.dataset.ready
  }
}
