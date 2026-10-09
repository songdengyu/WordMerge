import { Application, Container, Graphics, Text } from 'pixi.js'
import { CHUNK_SIZE, type Cell, type WorldObject } from '../game/world'
import type { GameRuntime, SceneSnapshot } from '../game/GameRuntime'
import { Camera, gridToWorld, worldToPosition } from './camera'
import { attachMapInput } from './mapInput'
import { footprint, localToWorld, type Rotation } from '../game/construction'
import { buildingSegments, segmentHp } from '../game/buildingSegments'
import { blueprintById, blueprintCells } from '../game/buildingConfig'
import { actorPosition, companions, companionId, companionById, companionLocked, distance } from '../game/survival'
import { SurvivalActors } from './SurvivalActors'
import { decorError } from '../game/progression'
import { OUTFITS, REGIONS, type DecorId } from '../game/progressionConfig'
import { makeDecoration, ProgressionViews } from './ProgressionViews'
import { Atmosphere } from './Atmosphere'
import { BuildingBubbles } from './BuildingBubbles'
import { BuildingAppearance } from './BuildingAppearance'
import { resourceApproach } from '../game/economy'
import { houseStyle } from './houseStyle'
import { objectAppearance } from './worldObjectStyle'
import { ResourceDrops } from './ResourceDrops'
import { LIGHTING } from '../game/lighting'
import { terrainColor, terrainDetail, terrainTransitionFill, terrainTransitionBorder } from './TerrainArt'
import { loadSceneArt, loadedSceneArt, sceneSprite, sceneSpriteContains, texturedSurface } from './SceneArt'
import { buildingModel, completeModelBuilding } from './buildingModel'
import { drawBuildingMesh } from './BuildingModelView'

const RESIDENT_CELL: Cell = { x: 11, y: 8 }

const diamond = (graphics: Graphics, x: number, y: number, color: number, alpha = 1) =>
  graphics.poly([x, y - 16, x + 32, y, x, y + 16, x - 32, y]).fill({ color, alpha })

function flame(g: Graphics, x: number, y: number, size = 1) {
  g.moveTo(x, y).bezierCurveTo(x - 14 * size, y - 8 * size, x - 4 * size, y - 18 * size, x - 1 * size, y - 27 * size)
    .bezierCurveTo(x + 3 * size, y - 22 * size, x + 4 * size, y - 17 * size, x + 3 * size, y - 13 * size)
    .lineTo(x + 8 * size, y - 19 * size).bezierCurveTo(x + 16 * size, y - 7 * size, x + 8 * size, y + 1 * size, x, y).fill(0xed9650)
  g.moveTo(x, y - size).bezierCurveTo(x - 6 * size, y - 5 * size, x + size, y - 9 * size, x + size, y - 15 * size)
    .bezierCurveTo(x + 8 * size, y - 7 * size, x + 5 * size, y, x, y - size).fill(0xffdc87)
}

function makeObject(object: WorldObject): Container {
  const root = new Container()
  const g = new Graphics()
  const appearance = objectAppearance(object)
  const sprite = sceneSprite(object.kind)
  g.scale.set(appearance.scaleX, appearance.scaleY)
  g.ellipse(4, 2, 21, 9).fill({ color: 0x19382e, alpha: 0.18 })
  if (object.kind === 'tree') {
    g.moveTo(-6, 1).bezierCurveTo(-3, -17, -6, -36, -2, -54).lineTo(5, -54)
      .bezierCurveTo(2, -32, 4, -12, 8, 1).fill(0x82634c)
    g.moveTo(0, -11).lineTo(-1, -42).stroke({ width: 1.5, color: 0xb39970, alpha: .7 })
    const greens = [[0x466d56, 0x618569, 0x89a579], [0x506f56, 0x769367, 0xa6b57d], [0x3f6c5b, 0x648b72, 0x93ae83]][appearance.variant]
    for (const [x, y, rx, ry, shade] of [[-11, -44, 22, 22, 0], [14, -47, 20, 23, 0], [-10, -63, 22, 23, 1], [12, -69, 19, 23, 1], [0, -84, 17, 20, 1], [-5, -89, 13, 12, 2], [-20, -60, 10, 13, 2]]) {
      g.ellipse(x, y, rx, ry).fill(greens[shade])
    }
    for (const [x, y] of [[-16, -67], [5, -90], [17, -58], [-5, -43]]) {
      g.moveTo(x - 4, y + 2).quadraticCurveTo(x, y - 3, x + 5, y).stroke({ width: 1.5, color: 0xc7d2a1, alpha: .35 })
    }
    g.ellipse(-7, 1, 6, 2).fill(0x809366)
  } else if (object.kind === 'shrub') {
    for (const [x, y, r] of [[-13, -10, 13], [10, -12, 15], [-3, -22, 14]]) g.circle(x, y, r).fill([0x76915e, 0x819965, 0x6f8f69][appearance.variant])
    g.ellipse(-6, -28, 10, 6).fill(0x9fb578)
    g.ellipse(12, -17, 8, 5).fill({ color: 0xb3bf87, alpha: .45 })
    for (const [x, y] of [[-14, -17], [8, -24], [16, -9], [-1, -12]]) {
      g.circle(x, y, 3).fill(0xb86e7a); g.circle(x - 1, y - 1, .9).fill(0xe5abb3)
    }
  } else if (object.kind === 'fruit-tree') {
    g.roundRect(-4, -45, 8, 46, 3).fill(0x92704b)
    g.moveTo(0, -32).lineTo(-12, -50).moveTo(0, -38).lineTo(14, -54).stroke({ width: 4, color: 0x92704b })
    for (const [x, y, r] of [[-14, -53, 19], [15, -53, 20], [0, -73, 19]]) g.circle(x, y, r).fill([0x769667, 0x819b68, 0x6e926d][appearance.variant])
    g.ellipse(-6, -80, 15, 8).fill(0xa2b980)
    for (const [x, y] of [[-21, -56], [6, -75], [20, -49], [-2, -48]]) {
      g.circle(x, y, 5).fill(0xcf8870); g.circle(x - 1.5, y - 1.5, 1.5).fill(0xf0be91)
      g.moveTo(x, y - 4).lineTo(x + 2, y - 8).stroke({ width: 1.5, color: 0x688050 })
    }
  } else if (object.kind === 'boulder') {
    const tip = appearance.variant * 3
    g.moveTo(-23, -1).bezierCurveTo(-25, -12, -16, -20, -12, -22)
      .bezierCurveTo(-9, -34, 5 + tip, -34, 12, -27).bezierCurveTo(20, -27, 24, -13, 22, -8)
      .bezierCurveTo(29, 2, 14, 9, 2, 7).bezierCurveTo(-10, 10, -24, 7, -23, -1).fill([0x929e94, 0x999e91, 0x8e9d99][appearance.variant])
    g.moveTo(-18, -16).bezierCurveTo(-13, -27, -4, -33, 7, -28)
      .quadraticCurveTo(19, -22, 15, -18).quadraticCurveTo(0, -13, -18, -16).fill(0xbcc7ad)
    g.moveTo(9, -16).quadraticCurveTo(3, -10, 7, -5).stroke({ width: 1, color: 0x6f837b, alpha: .5 })
    g.ellipse(-13, 0, 9, 3).fill(0x82976c)
    g.ellipse(-9, -2, 4, 2).fill(0xa1b382)
    for (const [x, y] of [[-4, -22], [7, -24], [-16, -5]]) g.ellipse(x, y, 1.2, .7).fill({ color: 0xe0dfc4, alpha: .65 })
  } else if (object.kind === 'statue') {
    // A small forest guardian carved from stone, with a diamond in its pedestal.
    g.poly([-21, -7, 0, -17, 21, -7, 21, 0, 0, 10, -21, 0]).fill(0x83978f)
    g.poly([-21, -7, 0, -17, 21, -7, 0, 3]).fill(0xc8d2be)
    g.poly([-13, -9, -11, -30, 11, -30, 13, -9, 0, -3]).fill(0xa6b7a4)
    g.poly([-16, -29, -11, -43, 0, -47, 11, -43, 16, -29, 0, -22]).fill(0xb8c7b1)
    g.ellipse(0, -52, 12, 15).fill(0xc4cfb8)
    g.poly([-11, -59, -12, -72, -2, -63, 5, -65, 13, -72, 11, -57]).fill(0xa1b398)
    g.moveTo(-7, -53).lineTo(-3, -52).moveTo(3, -52).lineTo(7, -53).stroke({ width: 2, color: 0x667e72 })
    g.poly([-3, -47, 3, -47, 0, -44]).fill(0x6e8478)
    g.poly([-5, -19, 0, -23, 5, -19, 0, -12]).fill(0x91d6df).stroke({ width: 1, color: 0xe0f3db })
    g.ellipse(-13, -3, 7, 3).fill(0x819a66)
  } else if (object.kind === 'campfire') {
    g.ellipse(0, 0, 23, 12).fill(0xa5977a)
    g.ellipse(0, 0, 17, 8).fill(0x645749)
    g.moveTo(-13, -4).lineTo(13, 5).stroke({ color: 0x755740, width: 6 })
    g.moveTo(13, -4).lineTo(-13, 5).stroke({ color: 0x8b6544, width: 6 })
    // Existing campfires now provide a steady home light; no temperature/combat bonus.
    for (const [x, y] of [[-21, 0], [-12, -8], [10, -8], [21, 0], [10, 9], [-11, 9]]) {
      g.ellipse(x, y, 5, 3).fill(0xc4c4af)
    }
    flame(g, 0, -5)
  } else {
    g.roundRect(-3, -36, 6, 37, 2).fill(0x7e6448)
    g.poly([-18, -40, 14, -40, 23, -32, 14, -24, -18, -24]).fill(0xc5ac7b)
    g.moveTo(-11, -32).lineTo(11, -32).stroke({ color: 0x806647, width: 2 })
  }
  if (sprite) {
    sprite.scale.set(sprite.scale.x * appearance.scaleX, sprite.scale.y * appearance.scaleY)
    sprite.tint = [0xffffff, 0xf2f6e5, 0xe4eee6][appearance.variant]
    root.addChild(sprite); g.destroy()
    if (object.kind === 'campfire') { const fire = new Graphics(); flame(fire, 0, -9, .8); root.addChild(fire) }
  } else root.addChild(g)
  const p = gridToWorld(object)
  root.position.set(p.x, p.y)
  root.zIndex = p.y
  return root
}

function makePlayer(color = 0xc77b64, outfit = 'clay') {
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
  if (outfit === 'meadow') {
    g.poly([-5, -24, 5, -24, 7, -11, -7, -11]).fill(0xece2b4)
    g.ellipse(0, -44, 16, 4).fill(0xe2c78a)
    g.roundRect(-9, -53, 18, 10, 4).fill(0xd2b575)
    g.moveTo(-9, -44).lineTo(9, -44).stroke({ width: 2, color: 0x859668 })
  } else if (outfit === 'rain') {
    g.poly([-6, -28, 6, -28, 14, -8, 0, -13, -14, -8]).fill(0x82b2c3)
    g.circle(0, -25, 1.5).fill(0xe9d58a)
    g.moveTo(-11, -35).arc(0, -35, 11, Math.PI, Math.PI * 2).stroke({ width: 5, color: 0x659bb4 })
  } else if (outfit === 'starlight') {
    g.poly([-6, -25, 6, -25, 13, -7, -13, -7]).fill(0x9890c1)
    g.moveTo(-11, -9).lineTo(11, -9).stroke({ width: 2, color: 0xe3d2ab })
    g.star(1, -19, 5, 3, 1.5).fill(0xf1db92)
    g.circle(-8, -40, 3).fill(0xeed38c); g.circle(-6.5, -41.5, 2.5).fill(0x634f42)
  }
  root.addChild(g)
  return root
}

export class CampScene {
  private readonly app = new Application()
  private readonly root = new Container()
  private readonly ground = new Container()
  private readonly actors = new Container()
  private readonly buildingAppearance = new BuildingAppearance(this.actors)
  private readonly route = new Graphics()
  private readonly buildings = new Graphics()
  private readonly preview = new Graphics()
  private readonly protection = new Graphics()
  private readonly progressionViews = new ProgressionViews(this.actors)
  private readonly buildingLayers = new Set<Graphics>()
  private readonly decorPreview = new Graphics()
  private decorPreviewArt: Container | null = null
  private decorPreviewSignature = ''
  private decorationPlacement: { kind: DecorId; cell: Cell; decorationId?: string } | null = null
  private regionSignature = ''
  private outfit = 'clay'
  private resident: Container | null = null
  private placement: { blueprintId: string; origin: Cell; rotation: Rotation } | null = null
  private buildingSignature = ''
  private previewSignature = ''
  private player = makePlayer()
  private readonly carriedTorch = new Graphics()
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
  private readonly resourceDrops: ResourceDrops
  private bubblesHidden = false
  private companionControl = false
  private controlledCompanion = 'companion'
  private followTarget: string | null = 'player'
  private followOnWalk = true
  private previousDestination = ''
  private cameraIntent = 0
  private readonly assetAbort = new AbortController()

  constructor(private readonly host: HTMLDivElement, private readonly runtime: GameRuntime,
    private readonly onMessage: (message: string) => void, private readonly onError: (message: string) => void,
    private readonly onOrigin: (cell: Cell) => void,
    private readonly openMerge: () => void, private readonly onCompanion: (id?: string) => void, private readonly onJournal: () => void,
    private readonly onCancelCompanionControl: () => void) {
    this.buildingBubbles = new BuildingBubbles(runtime, host, onMessage, openMerge)
    this.resourceDrops = new ResourceDrops(runtime, host)
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
      await loadSceneArt()
      if (this.disposed) return
      this.host.dataset.sceneArt = loadedSceneArt()
      await this.buildingBubbles.load(this.assetAbort.signal)
      await this.resourceDrops.load(this.assetAbort.signal)
      if (this.disposed) return
      const canvas = this.app.canvas
      canvas.setAttribute('aria-label', '林间营地地图，轻点空地移动，拖动查看，双指缩放')
      canvas.setAttribute('role', 'img')
      canvas.dataset.testid = 'camp-canvas'
      this.host.appendChild(canvas)
      canvas.addEventListener('webglcontextlost', this.onContextLost)
      canvas.addEventListener('webglcontextrestored', this.onContextRestored)
      this.root.addChild(this.ground, this.buildings, this.progressionViews.view, this.survivalActors.guard, this.preview, this.decorPreview, this.route, this.protection, this.actors, this.buildingBubbles.view, this.resourceDrops.view)
      this.actors.sortableChildren = true
      this.actors.addChild(this.player, this.carriedTorch)
      this.app.stage.addChild(this.root, this.atmosphere.view)
      this.buildMap()
      this.resize()
      this.camera.center(this.runtime.getSceneSnapshot().position)
      this.resizeObserver = new ResizeObserver(() => this.resize())
      this.resizeObserver.observe(this.host)
      this.detachInput = attachMapInput(canvas, this.camera, (cell, world) => {
        this.followOnWalk = true
        if (this.companionControl || !this.buildingBubbles.tap(world)) this.tap(cell, worldToPosition(world))
      }, () => this.pauseFollowing())
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

  private pauseFollowing() {
    this.cameraIntent++
    this.followTarget = null
    this.camera.cancelFollow()
    this.followOnWalk = false
    const destination = this.runtime.getSceneSnapshot().destination
    this.previousDestination = destination ? `${destination.x},${destination.y}` : ''
  }
  centerPlayer() { this.cameraIntent++; this.followOnWalk = true; this.followTarget = 'player' }
  centerCell(cell: Cell) { this.pauseFollowing(); this.camera.center(cell) }
  setDecorationPlacement(placement: typeof this.decorationPlacement) { this.decorationPlacement = placement }
  centerBuilding(id: string) {
    const building = this.runtime.getUiSnapshot().construction.buildings.find(building => building.id === id)
    if (building) {
        this.pauseFollowing()
        const blueprint = blueprintById(building.blueprintId)!
        this.camera.center(localToWorld(building, { x: (blueprint.width - 1) / 2, y: (blueprint.height - 1) / 2 }))
      this.camera.pan(0, Math.min(40, this.camera.height * .06))
    }
  }
  setPlacement(placement: typeof this.placement) { this.placement = placement }
  setBubblesHidden(hidden: boolean) { this.bubblesHidden = hidden }
  clearResourceSelection() { this.buildingBubbles.selectResource(null) }
  setCompanionControl(active: boolean, id = 'companion') {
    if (active !== this.companionControl || active && id !== this.controlledCompanion) this.cameraIntent++
    if (active && (!this.companionControl || id !== this.controlledCompanion)) { this.followOnWalk = true; this.followTarget = id }
    else if (!active && this.companionControl && this.followTarget === this.controlledCompanion) this.followTarget = 'player'
    this.companionControl = active; this.controlledCompanion = id
  }
  zoomBy(factor: number) { this.camera.zoomAt(this.camera.zoom * factor, { x: this.camera.width / 2, y: this.camera.height / 2 }) }

  private tap(cell: Cell, point: Cell) {
    if (this.companionControl) {
      const survival = this.runtime.getUiSnapshot().survival, tapPoint = gridToWorld(point)
      const controlled = companionById(survival, this.controlledCompanion)
      if (controlled && companionLocked(survival, controlled)) {
        this.setCompanionControl(false)
        this.onCancelCompanionControl()
        this.movePlayerTo(point)
        return
      }
      const targets = [{ id: 'player', position: this.player.position, width: 18, height: 48, center: 24 },
        ...companions(survival).filter(buddy => companionId(buddy) !== this.controlledCompanion
          && buddy.status !== 'wild' && !companionLocked(survival, buddy)).map(buddy => ({
          id: companionId(buddy), position: this.survivalActors.displayedPosition(companionId(buddy)), width: 26, height: 38, center: 18,
        }))]
      const hit = targets.filter(target => target.position && Math.abs(tapPoint.x - target.position.x) <= target.width
        && tapPoint.y >= target.position.y - target.height && tapPoint.y <= target.position.y + 10)
        .sort((a, b) => Math.hypot(tapPoint.x - a.position!.x, tapPoint.y - (a.position!.y - a.center))
          - Math.hypot(tapPoint.x - b.position!.x, tapPoint.y - (b.position!.y - b.center)))[0]
      if (hit) {
        // Only leave the input mode; the runtime keeps the previously issued movement order.
        this.setCompanionControl(false)
        this.onCancelCompanionControl()
        if (hit.id === 'player') this.centerPlayer()
        else this.onCompanion(hit.id)
        return
      }
      const id = this.controlledCompanion
      const intent = ++this.cameraIntent
      void this.runtime.dispatch({ type: 'companion-move', target: point, companionId: id }).then(result => {
        if (this.disposed) return
        if (!result.accepted) this.onMessage(result.reason)
        else if (intent === this.cameraIntent && this.companionControl && this.controlledCompanion === id) this.followTarget = id
      })
      return
    }
    if (this.placement || this.decorationPlacement) { this.onOrigin(cell); return }
    const progress = this.runtime.getUiSnapshot().progression
    if (progress.completed.includes('visitor') && distance(cell, RESIDENT_CELL) < .8) { this.onJournal(); return }
    const landmark = REGIONS.find(r => progress.unlockedRegions.includes(r.id) && distance(cell, r.point) < .8)
    if (landmark && progress.discoveries.includes(landmark.id)) { this.onJournal(); return }
    const survival = this.runtime.getUiSnapshot().survival
    const tapPoint = gridToWorld(point)
    for (const buddy of companions(survival).reverse().sort((a, b) => {
      const pa = gridToWorld(actorPosition(a)), pb = gridToWorld(actorPosition(b))
      return Math.hypot(tapPoint.x - pa.x, tapPoint.y - (pa.y - 18)) - Math.hypot(tapPoint.x - pb.x, tapPoint.y - (pb.y - 18))
    })) {
      const animalPoint = gridToWorld(actorPosition(buddy))
      if (!companionLocked(survival, buddy) && Math.abs(tapPoint.x - animalPoint.x) <= 26 && tapPoint.y >= animalPoint.y - 38 && tapPoint.y <= animalPoint.y + 10) {
        if (buddy.status !== 'wild') this.onCompanion(companionId(buddy))
        else void this.runtime.dispatch({ type: 'taming-interact' }).then(result => {
          if (this.disposed) return
          if (!result.accepted) this.onMessage(result.reason)
          else if (result.openProduction) this.openMerge()
          else if (result.message) this.onMessage(result.message)
        })
        return
      }
    }
    const enemy = survival.enemies.find(enemy => enemy.id !== survival.duel?.enemy.id && distance(actorPosition(enemy), cell) < .8)
    if (enemy) {
      void this.runtime.dispatch(enemy.tameable ? { type: 'taming-interact', targetId: enemy.id } : { type: 'companion-attack', enemyId: enemy.id }).then(result => {
        if (!this.disposed) {
          if (result.accepted && result.openProduction) this.openMerge()
          else this.onMessage(result.accepted ? result.message ?? '已指派伙伴' : result.reason)
        }
      }); return
    }
    const object = this.runtime.world.objectAt(cell) ?? this.runtime.world.allObjects()
      .filter(o => this.runtime.world.chunkAt(o)?.unlocked).sort((a, b) => gridToWorld(b).y - gridToWorld(a).y).find(o => {
        const p = gridToWorld(o), appearance = objectAppearance(o)
        {
          const hit = sceneSpriteContains(o.kind, (tapPoint.x - p.x) / appearance.scaleX, (tapPoint.y - p.y) / appearance.scaleY)
          if (hit !== null) return hit
        }
        return Math.abs(tapPoint.x - p.x) <= appearance.width && tapPoint.y >= p.y - appearance.height && tapPoint.y <= p.y + appearance.bottom
      })
    if (object) {
      this.buildingBubbles.selectResource(object.id)
      const snapshot = this.runtime.getSceneSnapshot()
      const target = resourceApproach(this.runtime.world, snapshot.construction, snapshot.position, object)
      const intent = ++this.cameraIntent
      void this.runtime.dispatch({ type: 'move', target: target ?? point }).then(result => {
        if (this.disposed) return
        if (!result.accepted) this.onMessage(result.reason)
        else if (intent === this.cameraIntent) this.followTarget = 'player'
      })
      return
    }
    this.movePlayerTo(point)
  }

  private movePlayerTo(point: Cell) {
    this.buildingBubbles.selectResource(null)
    this.followOnWalk = true
    const intent = ++this.cameraIntent
    void this.runtime.dispatch({ type: 'move', target: point }).then(result => {
      if (this.disposed) return
      if (!result.accepted) this.onMessage(result.reason)
      else if (intent === this.cameraIntent) this.followTarget = 'player'
    })
  }

  private drawBuildings(snapshot: SceneSnapshot) {
    const signature = JSON.stringify(snapshot.construction.buildings)
    if (signature !== this.buildingSignature) {
      this.buildingSignature = signature
      const g = this.buildings.clear()
      for (const layer of this.buildingLayers) layer.destroy({ children: true })
      this.buildingLayers.clear()
      for (const building of snapshot.construction.buildings) {
        const blueprint = blueprintById(building.blueprintId)!
        const style = houseStyle(building.blueprintId)
        const model = buildingModel(building, blueprint)
        const foundation = building.parts.foundation, floorConfig = blueprint.parts.find(part => part.kind === 'foundation')!
        for (const segment of buildingSegments(blueprint, floorConfig)) {
          const p = gridToWorld(localToWorld(building, segment.cell)), hp = segmentHp(foundation, segment.id)
          if (foundation.built && hp > 0) drawBuildingMesh(g, model.filter(f => f.partId === floorConfig.id && f.segmentId === segment.id))
          else diamond(g, p.x, p.y, foundation.built ? 0x756951 : 0xeee5be, foundation.built ? .45 : .38)
          if (building.blueprintId === 'cabin' && foundation.built && hp > 0) {
            const project = (x: number, y: number) => gridToWorld(localToWorld(building, { x, y }))
            const { x, y } = segment.cell
            texturedSurface(g, 'floor', [project(x - .5, y - .5), project(x + .5, y - .5), project(x + .5, y + .5), project(x - .5, y + .5)],
              project(-.5, -.5), project(2.5, -.5), project(-.5, 1.5), hp < floorConfig.hp ? 0xc4b5a0 : 0xffffff)
          }
          const occupied = blueprintCells(blueprint)
          for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) if (!occupied.some(c => c.x === segment.cell.x + dx && c.y === segment.cell.y + dy)) {
            const a = gridToWorld(localToWorld(building, { x: segment.cell.x + dx / 2 - dy / 2, y: segment.cell.y + dy / 2 + dx / 2 }))
            const b = gridToWorld(localToWorld(building, { x: segment.cell.x + dx / 2 + dy / 2, y: segment.cell.y + dy / 2 - dx / 2 }))
            g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 2, color: style.trim, alpha: .65 })
          }
          if (foundation.built && hp > 0) {
            for (const offset of [-8, 8]) g.moveTo(p.x - 16 + offset, p.y - 8 - offset / 2)
              .lineTo(p.x + 16 + offset, p.y + 8 - offset / 2).stroke({ width: .7, color: 0x866c53, alpha: .22 })
          }
          if (foundation.built && hp < floorConfig.hp) g.moveTo(p.x - 10, p.y - 5).lineTo(p.x, p.y).lineTo(p.x - 3, p.y + 6).lineTo(p.x + 12, p.y + 5).stroke({ width: 2, color: 0x70513d })
        }
        // Draw solid parts from back to front; the bed must not paint over a nearer wall.
        const layers: { depth: number; draw: (g: Graphics) => void }[] = []
        for (const config of blueprint.parts) {
          const part = building.parts[config.id]
          if (!part.built) continue
          for (const segment of buildingSegments(blueprint, config)) {
            const edge = segment.edge, hp = segmentHp(part, segment.id)
            if (!edge || hp <= 0 || config.kind === 'door') continue
            const from = localToWorld(building, edge.from), to = localToWorld(building, edge.to)
            const dx = to.x - from.x, dy = to.y - from.y
            const a = gridToWorld({ x: (from.x + to.x) / 2 - dy / 2, y: (from.y + to.y) / 2 + dx / 2 })
            const b = gridToWorld({ x: (from.x + to.x) / 2 + dy / 2, y: (from.y + to.y) / 2 - dx / 2 })
            const h = 29
            layers.push({ depth: (a.y + b.y) / 2, draw: g => {
            drawBuildingMesh(g, model.filter(f => f.partId === config.id && f.segmentId === segment.id))
            if (building.blueprintId === 'cabin') {
              const topA = { x: a.x, y: a.y - h }, topB = { x: b.x, y: b.y - h }
              texturedSurface(g, 'wall', [a, b, topB, topA], topA, topB, a,
                hp < config.hp ? 0xb9a58d : b.y > a.y ? 0xffffff : 0xdad6c9)
            }
            g.moveTo(a.x, a.y - h).lineTo(b.x, b.y - h).stroke({ width: 2.5, color: style.trim })
            for (const row of [1, 2, 3]) g.moveTo(a.x, a.y - row * 7).lineTo(b.x, b.y - row * 7)
              .stroke({ width: .7, color: 0x806f5d, alpha: .22 })
            if (Number(segment.id.replace('edge', '')) % 3 === 1) {
              const l = { x: a.x + (b.x - a.x) * .3, y: a.y + (b.y - a.y) * .3 }, r = { x: a.x + (b.x - a.x) * .7, y: a.y + (b.y - a.y) * .7 }
              g.moveTo(l.x, l.y - 8).lineTo(r.x, r.y - 8).lineTo(r.x, r.y - 19)
                .quadraticCurveTo((l.x + r.x) / 2, (l.y + r.y) / 2 - 28, l.x, l.y - 19).closePath()
                .fill(style.accent).stroke({ width: 2, color: style.trim })
              g.moveTo((l.x + r.x) / 2, (l.y + r.y) / 2 - 8).lineTo((l.x + r.x) / 2, (l.y + r.y) / 2 - 22).stroke({ width: 1, color: style.trim })
              g.moveTo(l.x - 2, l.y - 7).lineTo(r.x + 2, r.y - 7).stroke({ width: 3, color: 0xa18c69 })
              if (style.tier !== '简朴') for (const t of [.2, .5, .8]) {
                const x = l.x + (r.x - l.x) * t, y = l.y + (r.y - l.y) * t - 8
                g.ellipse(x, y, 3, 2).fill(0x81966c); g.circle(x, y - 2, 1.6).fill(style.tier === '精致' ? 0xd4a3ad : 0xe4d2a0)
              }
            }
            if (hp < config.hp) g.moveTo((a.x + b.x) / 2, (a.y + b.y) / 2 - h).lineTo((a.x + b.x) / 2 - 4, (a.y + b.y) / 2 - h / 2)
              .lineTo((a.x + b.x) / 2 + 3, (a.y + b.y) / 2 - 4).stroke({ width: 2, color: 0x4e3c30 })
            } })
          }
          if (config.kind === 'bed' && part.hp > 0) {
            const p = gridToWorld(localToWorld(building, { x: 0, y: 1 }))
            layers.push({ depth: p.y, draw: g => {
              const bench = sceneSprite('bed')
              if (bench) {
                bench.position.set(p.x, p.y)
                if (building.rotation % 2) bench.scale.x *= -1
                bench.tint = part.hp < config.hp ? 0xc7b8a8 : 0xffffff
                g.addChild(bench); return
              }
              // Project the mattress inside its actual tile, including house rotation.
              const project = (x: number, y: number, height: number) => {
                const point = gridToWorld(localToWorld(building, { x, y: y + 1 }))
                return { x: point.x, y: point.y - height }
              }
              const corners = [[-.3, -.38], [.3, -.38], [.3, .38], [-.3, .38]]
              const top = corners.map(([x, y]) => project(x, y, 5))
              const base = corners.map(([x, y]) => project(x, y, 1))
              for (let i = 0; i < 4; i++) {
                const j = (i + 1) % 4
                g.poly([top[i], top[j], base[j], base[i]].flatMap(point => [point.x, point.y])).fill(0xac876c)
              }
              g.poly(top.flatMap(point => [point.x, point.y])).fill(0xd9b4a0).stroke({ width: 1, color: 0xffefd2 })
              const pillow = [[-.23, -.31], [.23, -.31], [.23, -.08], [-.23, -.08]].map(([x, y]) => project(x, y, 6))
              g.poly(pillow.flatMap(point => [point.x, point.y])).fill(0xf7e5c9)
            } })
          }
        }
        for (const layer of layers) {
          const art = new Graphics(); art.eventMode = 'none'; art.zIndex = layer.depth
          layer.draw(art); this.actors.addChild(art); this.buildingLayers.add(art)
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
      this.preview.alpha = .7
      const ghost = buildingModel({ ...completeModelBuilding(blueprint), ...this.placement }, blueprint)
      drawBuildingMesh(this.preview, valid ? ghost : ghost.map(face => ({ ...face, color: 0xb97062 })))
      for (const cell of footprint(this.placement, blueprint)) {
        const p = gridToWorld(cell)
        this.preview.poly([p.x, p.y - 16, p.x + 32, p.y, p.x, p.y + 16, p.x - 32, p.y]).stroke({ color: valid ? 0xfff9ca : 0xefada0, width: 2 })
      }
      const edge = blueprint.parts.find(part => part.kind === 'door')!.edges[0]
      const door = gridToWorld(localToWorld(this.placement, { x: (edge.from.x + edge.to.x) / 2, y: (edge.from.y + edge.to.y) / 2 }))
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
    this.regionSignature = `${state.progression.unlockedRegions.join(',')}|${state.economy.removedObjects.join(',')}|${JSON.stringify(state.progression.regionContent.statue)}`
    const transitionFills: Container[] = [], transitionBorders: Container[] = []
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
        diamond(g, p.x, p.y, terrainColor(this.runtime.world, cell, chunk.unlocked))
      }
      if (chunk.unlocked) for (let y = 0; y < CHUNK_SIZE; y++) for (let x = 0; x < CHUNK_SIZE; x++)
        terrainDetail(g, this.runtime.world, { x: chunk.x * CHUNK_SIZE + x, y: chunk.y * CHUNK_SIZE + y })
      view.addChild(g)
      if (chunk.unlocked) {
        const fills = new Graphics(), borders = new Graphics()
        for (let y = 0; y < CHUNK_SIZE; y++) for (let x = 0; x < CHUNK_SIZE; x++) {
          const cell = { x: chunk.x * CHUNK_SIZE + x, y: chunk.y * CHUNK_SIZE + y }
          terrainTransitionFill(fills, this.runtime.world, cell)
          terrainTransitionBorder(borders, this.runtime.world, cell)
        }
        transitionFills.push(fills); transitionBorders.push(borders)
        for (const overlay of [fills, borders]) this.chunks.push({ view: overlay,
          left: left - 8, right: right + 8, top: top - 8, bottom: bottom + 8 })
      }
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
    // All base chunks, then all fill corrections, then outlines: no neighboring chunk can erase a seam.
    this.ground.addChild(...transitionFills, ...transitionBorders)
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
    if (this.regionSignature !== `${snapshot.progression.unlockedRegions.join(',')}|${snapshot.economy.removedObjects.join(',')}|${JSON.stringify(snapshot.progression.regionContent.statue)}`) this.buildMap()
    this.progressionViews.draw(snapshot.progression)
    if (snapshot.progression.outfit !== this.outfit) {
      this.outfit = snapshot.progression.outfit; this.player.destroy({ children: true })
      this.player = makePlayer(OUTFITS.find(o => o.id === this.outfit)!.color, this.outfit); this.actors.addChild(this.player)
    }
    if (snapshot.progression.completed.includes('visitor') && !this.resident) {
      this.resident = makePlayer(0x7c92a2)
      const p = gridToWorld(RESIDENT_CELL); this.resident.position.set(p.x, p.y); this.resident.zIndex = p.y + .1
      const label = new Text({ text: '林岚', style: { fontSize: 11, fill: 0xfff4d8, stroke: { color: 0x49624d, width: 3 } } })
      label.anchor.set(.5, 1); label.y = -50; this.resident.addChild(label); this.actors.addChild(this.resident)
    } else if (!snapshot.progression.completed.includes('visitor') && this.resident) { this.resident.destroy({ children: true }); this.resident = null }
    const decorPreviewSignature = JSON.stringify([this.decorationPlacement, snapshot.progression.decorations, snapshot.construction.buildings])
    if (decorPreviewSignature !== this.decorPreviewSignature) {
      this.decorPreviewSignature = decorPreviewSignature
      this.decorPreview.clear()
      this.decorPreviewArt?.destroy({ children: true }); this.decorPreviewArt = null
      if (this.decorationPlacement) {
      const { cell, kind } = this.decorationPlacement, p = gridToWorld(cell)
      const valid = !decorError(kind, cell, snapshot.progression, snapshot.construction, this.decorationPlacement.decorationId)
      diamond(this.decorPreview, p.x, p.y, valid ? 0xf6edb4 : 0xce8878, .65)
      this.decorPreviewArt = makeDecoration(kind, .8)
      this.decorPreviewArt.position.set(p.x, p.y); this.decorPreviewArt.zIndex = p.y + .06
      this.actors.addChild(this.decorPreviewArt)
      }
    }
    this.drawBuildings(snapshot)
    this.survivalActors.draw(snapshot, this.runtime.getInterpolation())
    const alpha = this.runtime.getInterpolation()
    const position = { x: snapshot.previousPosition.x + (snapshot.position.x - snapshot.previousPosition.x) * alpha,
      y: snapshot.previousPosition.y + (snapshot.position.y - snapshot.previousPosition.y) * alpha }
    const foot = gridToWorld(position)
    const appearance = this.buildingAppearance.update(snapshot, position, !!this.placement || !!this.decorationPlacement)
    this.host.dataset.visibleRoofs = appearance.visibleRoofs.join(',')
    this.host.dataset.doorAmounts = JSON.stringify(appearance.doorAmounts)
    this.player.position.set(foot.x, foot.y)
    this.player.zIndex = foot.y + 0.1
    const torchRemaining = snapshot.survival.torchRemaining ?? 0
    this.carriedTorch.clear(); this.carriedTorch.visible = torchRemaining > 0
    if (torchRemaining > 0) {
      this.carriedTorch.position.set(foot.x, foot.y); this.carriedTorch.zIndex = foot.y + .2
      this.carriedTorch.moveTo(8, -12).lineTo(13, -25).stroke({ width: 3, color: 0xa57e4a })
      flame(this.carriedTorch, 13, -24, .58 + Math.sin(snapshot.elapsedSeconds * 8) * .025)
    }
    // A pre-drag command may only appear in a later snapshot. Manual panning stays
    // authoritative until a new tap or locate action explicitly allows following again.
    const destination = snapshot.destination ? `${snapshot.destination.x},${snapshot.destination.y}` : ''
    if (this.followOnWalk && destination && destination !== this.previousDestination && !this.companionControl) this.followTarget = 'player'
    this.previousDestination = destination
    const cameraSeconds = this.app.ticker.deltaMS / 1000
    if (this.followTarget === 'player') this.camera.follow(position, cameraSeconds, 'player')
    else if (this.followTarget) {
      const buddy = this.survivalActors.displayedPosition(this.followTarget, false)
      if (buddy) this.camera.follow(worldToPosition(buddy), cameraSeconds, this.followTarget)
    }
    const lights = [
      ...this.runtime.world.allObjects().filter(o => o.kind === 'campfire' && this.runtime.world.chunkAt(o)?.unlocked)
        .map(cell => ({ cell, lift: 12, radius: LIGHTING.campfire.radius, strength: 1 })),
      ...snapshot.progression.decorations.filter(d => d.kind === 'lantern')
        .map(d => ({ cell: d.cell, lift: 44, radius: LIGHTING.lantern.radius, strength: 1 })),
      ...(torchRemaining > 0 ? [{ cell: position, lift: 28, radius: LIGHTING.torch.radius, strength: Math.min(1, torchRemaining / 2) }] : []),
    ].map(source => {
      const p = gridToWorld(source.cell)
      return { ...this.camera.toScreen({ x: p.x, y: p.y - source.lift }), radius: source.radius * this.camera.zoom, strength: source.strength }
    })
    this.host.dataset.lights = JSON.stringify(lights)
    this.host.dataset.torch = String(torchRemaining > 0)
    const light = this.atmosphere.draw(snapshot, this.lastWidth, this.lastHeight, lights)
    this.runtime.setSpawnVisibility(cell => {
      const p = this.camera.toScreen(gridToWorld(cell)), margin = 120 * this.camera.zoom
      return p.x >= -margin && p.x <= this.camera.width + margin && p.y >= -margin && p.y <= this.camera.height + margin
    })
    this.root.position.set(this.camera.x, this.camera.y)
    this.root.scale.set(this.camera.zoom)
    this.buildingBubbles.update(this.runtime.getUiSnapshot(), this.camera, this.bubblesHidden || this.companionControl)
    this.resourceDrops.update(snapshot)
    if (snapshot !== this.lastSnapshot) {
      this.route.clear()
      if (snapshot.destination) {
        const p = gridToWorld(snapshot.destination)
        this.route.ellipse(p.x, p.y, 15, 7).stroke({ width: 2, color: 0xfff5cf })
      }
      for (const buddy of companions(snapshot.survival)) if (buddy.mode === 'move') {
        const p = gridToWorld(buddy.guard)
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
      if (this.buildingAppearance.owns(actor) || this.buildingLayers.has(actor as Graphics)) continue
      const p = this.camera.toScreen(actor.position)
      actor.visible = p.x > -60 && p.x < this.lastWidth + 60 && p.y > -20 && p.y < this.lastHeight + 130
    }
    // Small, read-only DOM diagnostics also make real pointer workflows reproducible in browser tests.
    this.host.dataset.camera = `${this.camera.x},${this.camera.y},${this.camera.zoom}`
    this.host.dataset.cameraFollow = this.followTarget ?? ''
    this.host.dataset.position = `${position.x.toFixed(4)},${position.y.toFixed(4)}`
    const companionPosition = actorPosition(snapshot.survival.companion)
    this.host.dataset.recruits = JSON.stringify((snapshot.survival.recruits ?? []).map(b => ({ id: b.id, ...actorPosition(b) })))
    this.host.dataset.companionPosition = `${companionPosition.x.toFixed(4)},${companionPosition.y.toFixed(4)}`
    this.host.dataset.duelPhase = snapshot.survival.duel?.phase ?? 'idle'
    this.host.dataset.duelEnemy = snapshot.survival.duel?.enemy.id ?? ''
    this.host.dataset.alertEnemies = snapshot.survival.enemies.filter(e => e.tameable && (e.alertSeconds ?? 0) > 0).map(e => e.id).join(',')
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
    this.runtime.setSpawnVisibility(undefined)
    this.disposed = true
    this.assetAbort.abort()
    this.buildingBubbles.dispose()
    this.resourceDrops.dispose()
    this.atmosphere.dispose()
    this.detachInput?.()
    this.resizeObserver?.disconnect()
    this.destroyApplication()
    delete this.host.dataset.ready
  }
}
