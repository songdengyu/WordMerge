import { Container, Graphics, Text } from 'pixi.js'
import type { ProgressionState } from '../game/progression'
import { DECORATIONS, REGIONS, type DecorId } from '../game/progressionConfig'
import { gridToWorld } from './camera'

export function drawDecoration(g: Graphics, kind: DecorId, x: number, y: number, alpha = 1) {
  if (kind === 'rug') {
    g.poly([x, y - 11, x + 23, y, x, y + 11, x - 23, y]).fill({ color: 0xc29080, alpha }).stroke({ color: 0xf4e2b7, width: 2, alpha })
    g.poly([x, y - 5, x + 10, y, x, y + 5, x - 10, y]).fill({ color: 0xf4ddb0, alpha })
  } else if (kind === 'planter') {
    g.poly([x - 8, y - 9, x + 8, y - 9, x + 5, y + 1, x - 5, y + 1]).fill({ color: 0xba8d6e, alpha })
    g.moveTo(x, y - 7).lineTo(x, y - 25).stroke({ color: 0x6e955c, width: 3, alpha })
    g.ellipse(x - 4, y - 16, 5, 3).fill({ color: 0x86a868, alpha })
    for (const [dx, dy] of [[0, -25], [-5, -23], [5, -23], [-3, -28], [3, -28]]) g.circle(x + dx, y + dy, 3).fill({ color: 0xeac7b0, alpha })
    g.circle(x, y - 25, 2).fill({ color: 0xe1b55a, alpha })
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
  draw(progress: ProgressionState) {
    const signature = JSON.stringify([progress.decorations, progress.unlockedRegions, progress.discoveries, progress.completed.includes('visitor')])
    if (signature === this.signature) return
    this.signature = signature
    this.view.removeChildren().forEach(child => child.destroy({ children: true }))
    const g = new Graphics(); this.view.addChild(g)
    for (const decor of progress.decorations) {
      const p = gridToWorld(decor.cell); drawDecoration(g, decor.kind, p.x, p.y)
    }
    for (const region of REGIONS.filter(r => progress.unlockedRegions.includes(r.id))) {
      const p = gridToWorld(region.point), found = progress.discoveries.includes(region.id)
      g.ellipse(p.x, p.y, 20, 10).fill({ color: 0xffedb6, alpha: .35 }).stroke({ color: 0xf9f1d1, width: 1 })
      g.roundRect(p.x - 9, p.y - 18, 18, 14, 3).fill(0xb58c63).stroke({ color: 0xf7e9c7, width: 1.5 })
      g.moveTo(p.x - 9, p.y - 13).lineTo(p.x + 9, p.y - 13).stroke({ color: 0xe7d0a3, width: 2 })
      const text = new Text({ text: `${found ? '✓ ' : '✧ '}${region.landmark}`, style: { fontFamily: 'sans-serif', fontSize: 11, fill: 0xfff6dc, stroke: { color: 0x49644c, width: 3 } } })
      text.anchor.set(.5, 1); text.position.set(p.x, p.y - 24); this.view.addChild(text)
    }
  }
}
export const decorName = (kind: DecorId) => DECORATIONS.find(d => d.id === kind)!.name
