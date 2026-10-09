import { Container, Graphics, Text } from 'pixi.js'
import type { ProgressionState } from '../game/progression'
import { DECORATIONS, REGIONS, type DecorId } from '../game/progressionConfig'
import { gridToWorld } from './camera'
import { sceneSprite } from './SceneArt'

export function makeDecoration(kind: DecorId, alpha = 1): Container {
  const root = new Container(), sprite = sceneSprite(kind)
  root.eventMode = 'none'; root.alpha = alpha
  if (sprite) root.addChild(sprite)
  else { const g = new Graphics(); drawDecoration(g, kind, 0, 0); root.addChild(g) }
  return root
}

export function drawDecoration(g: Graphics, kind: DecorId, x: number, y: number, alpha = 1) {
  if (kind !== 'rug') g.ellipse(x + 2, y + 2, kind === 'planter' ? 11 : 20, 6).fill({ color: 0x4e624b, alpha: .13 * alpha })
  if (kind === 'rug') {
    g.ellipse(x, y + 1, 25, 12).fill({ color: 0x8e765e, alpha: .15 * alpha })
    g.ellipse(x, y, 24, 11).fill({ color: 0xc69487, alpha }).stroke({ color: 0xf1dfb7, width: 1.5, alpha })
    for (const r of [8, 14, 20]) g.ellipse(x, y, r, r * .43).stroke({ color: r === 14 ? 0xe7cdaa : 0xa7766a, width: 1, alpha: .65 * alpha })
    for (let i = 0; i < 16; i++) {
      const a = i * Math.PI / 8
      g.moveTo(x + Math.cos(a) * 24, y + Math.sin(a) * 11).lineTo(x + Math.cos(a) * 26, y + Math.sin(a) * 12).stroke({ color: 0xf1dfb7, width: 1, alpha })
    }
  } else if (kind === 'planter') {
    g.poly([x - 8, y - 9, x + 8, y - 9, x + 5, y + 1, x - 5, y + 1]).fill({ color: 0xba8d6e, alpha })
    g.moveTo(x, y - 7).lineTo(x, y - 25).stroke({ color: 0x6e955c, width: 3, alpha })
    g.ellipse(x - 4, y - 16, 5, 3).fill({ color: 0x86a868, alpha })
    g.ellipse(x + 5, y - 19, 6, 3).fill({ color: 0x9eb77c, alpha })
    g.moveTo(x - 7, y - 8).quadraticCurveTo(x, y - 5, x + 7, y - 8).stroke({ color: 0xe0bb91, width: 2, alpha })
    for (const [dx, dy] of [[0, -25], [-5, -23], [5, -23], [-3, -28], [3, -28]]) g.circle(x + dx, y + dy, 3).fill({ color: 0xeac7b0, alpha })
    g.circle(x, y - 25, 2).fill({ color: 0xe1b55a, alpha })
  } else if (kind === 'chair') {
    g.roundRect(x - 10, y - 29, 20, 19, 4).fill({ color: 0xc6a772, alpha }).stroke({ color: 0x94704d, width: 2, alpha })
    for (const dx of [-6, 0, 6]) g.moveTo(x + dx, y - 26).lineTo(x + dx, y - 13).stroke({ color: 0xe8d2a0, width: 1, alpha })
    g.ellipse(x, y - 10, 12, 6).fill({ color: 0xe3d4ac, alpha })
    for (const dx of [-8, 8]) g.moveTo(x + dx, y - 8).lineTo(x + dx, y + 3).stroke({ color: 0x94704d, width: 3, alpha })
  } else if (kind === 'table') {
    for (const dx of [-12, 12]) g.moveTo(x + dx, y - 14).lineTo(x + dx, y + 2).stroke({ color: 0x906b4d, width: 4, alpha })
    g.ellipse(x, y - 18, 22, 11).fill({ color: 0xcaa077, alpha }).stroke({ color: 0xf0d8b0, width: 2, alpha })
    g.ellipse(x, y - 18, 16, 7).stroke({ color: 0xe8c695, width: 1, alpha })
    g.ellipse(x, y - 18, 9, 3).stroke({ color: 0x997756, width: .8, alpha: .5 * alpha })
  } else if (kind === 'sofa') {
    g.roundRect(x - 22, y - 30, 44, 23, 6).fill({ color: 0xc9af97, alpha }).stroke({ color: 0xa58b73, width: 1.5, alpha })
    g.roundRect(x - 20, y - 14, 40, 14, 4).fill({ color: 0xe8d9c2, alpha })
    for (const dx of [-11, 4]) g.roundRect(x + dx, y - 25, 10, 13, 3).fill({ color: 0xa6b79b, alpha })
    for (const dx of [-22, 16]) g.roundRect(x + dx, y - 18, 6, 18, 3).fill({ color: 0xd2bba2, alpha })
  } else if (kind === 'bookshelf') {
    g.roundRect(x - 15, y - 44, 30, 44, 2).fill({ color: 0xa4815a, alpha }).stroke({ color: 0x74583e, width: 2, alpha })
    for (const dy of [-23, -4]) {
      for (let i = 0; i < 4; i++) g.rect(x - 11 + i * 6, y + dy - 14, 4, 13).fill({ color: [0x8baba4, 0xc28f83, 0xceb77c, 0x9e95b6][i], alpha })
      g.moveTo(x - 14, y + dy).lineTo(x + 14, y + dy).stroke({ color: 0xe6cda8, width: 2, alpha })
    }
  } else if (kind === 'tea-set') {
    g.ellipse(x, y - 2, 19, 9).fill({ color: 0xb99569, alpha })
    g.roundRect(x - 12, y - 18, 13, 14, 3).fill({ color: 0xcddfd4, alpha }).stroke({ color: 0x7d9b91, width: 1.5, alpha })
    g.moveTo(x + 1, y - 16).lineTo(x + 7, y - 16).lineTo(x + 7, y - 10).lineTo(x + 1, y - 10).stroke({ color: 0x7d9b91, width: 2, alpha })
    g.roundRect(x + 6, y - 10, 9, 7, 2).fill({ color: 0xe9e1c4, alpha })
  } else if (kind === 'flowerstand') {
    for (const dx of [-16, 16]) g.moveTo(x + dx, y).lineTo(x + dx, y - 43).stroke({ color: 0xa88258, width: 3, alpha })
    for (const dy of [-40, -27, -14]) g.moveTo(x - 16, y + dy).lineTo(x + 16, y + dy).stroke({ color: 0xbea277, width: 2, alpha })
    g.poly([x - 20, y - 8, x + 20, y - 8, x + 15, y + 2, x - 15, y + 2]).fill({ color: 0xbc8c70, alpha })
    g.moveTo(x - 8, y - 8).bezierCurveTo(x - 24, y - 40, x + 19, y - 52, x + 8, y - 11).stroke({ color: 0x719764, width: 3, alpha })
    for (const [dx, dy] of [[-12, -25], [4, -40], [14, -27], [0, -17]]) {
      g.circle(x + dx, y + dy, 5).fill({ color: 0xc88c9b, alpha }); g.circle(x + dx, y + dy, 1.8).fill({ color: 0xf0d295, alpha })
    }
  } else {
    g.circle(x, y - 12, 17).fill({ color: 0xffe8a4, alpha: .13 * alpha })
    g.roundRect(x - 6, y - 20, 12, 18, 3).fill({ color: 0xf3d98c, alpha }).stroke({ color: 0x987652, width: 2, alpha })
    // Start the handle at its own arc endpoint instead of connecting the previous graphics path.
    g.moveTo(x - 4, y - 21).arc(x, y - 21, 4, Math.PI, 0).stroke({ color: 0x987652, width: 2, alpha })
  }
}
export class ProgressionViews {
  readonly view = new Container()
  private signature = ''
  private decorViews: Container[] = []
  constructor(private readonly actors: Container) {}
  draw(progress: ProgressionState) {
    const signature = JSON.stringify([progress.decorations, progress.unlockedRegions, progress.discoveries, progress.completed.includes('visitor')])
    if (signature === this.signature) return
    this.signature = signature
    this.view.removeChildren().forEach(child => child.destroy({ children: true }))
    this.decorViews.forEach(view => view.destroy({ children: true })); this.decorViews = []
    const g = new Graphics(); this.view.addChild(g)
    for (const decor of progress.decorations) {
      const p = gridToWorld(decor.cell)
      if (decor.kind === 'rug') {
        const art = makeDecoration(decor.kind); art.position.set(p.x, p.y); this.view.addChild(art)
      }
      else {
        const art = makeDecoration(decor.kind); art.position.set(p.x, p.y); art.zIndex = p.y + .05
        this.actors.addChild(art); this.decorViews.push(art)
      }
    }
    for (const region of REGIONS.filter(r => progress.unlockedRegions.includes(r.id))) {
      const p = gridToWorld(region.point), found = progress.discoveries.includes(region.id)
      g.ellipse(p.x, p.y, 20, 10).fill({ color: 0xffedb6, alpha: .35 }).stroke({ color: 0xf9f1d1, width: 1 })
      g.roundRect(p.x - 9, p.y - 18, 18, 14, 3).fill(0xb58c63).stroke({ color: 0xf7e9c7, width: 1.5 })
      g.moveTo(p.x - 9, p.y - 13).lineTo(p.x + 9, p.y - 13).stroke({ color: 0xe7d0a3, width: 2 })
      const text = new Text({ text: found ? '✓' : '✧', style: { fontFamily: 'sans-serif', fontSize: 11, fill: 0xfff6dc, stroke: { color: 0x49644c, width: 3 } } })
      text.anchor.set(.5, 1); text.position.set(p.x, p.y - 24); this.view.addChild(text)
    }
  }
}
export const decorName = (kind: DecorId) => DECORATIONS.find(d => d.id === kind)!.name
