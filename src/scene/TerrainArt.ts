import { Graphics } from 'pixi.js'
import type { Cell, WorldMap } from '../game/world'
import { gridToWorld } from './camera'

const noise = (x: number, y: number) => Math.abs(Math.imul(x + 713, 7919) ^ Math.imul(y + 431, 104729)) >>> 0
export function terrainColor(world: WorldMap, cell: Cell, unlocked: boolean) {
  if (!unlocked) return 0x728777
  return { grass: 0xa7b68a, path: 0xcdbd98, water: 0x82aaa5, rock: 0x9ca598 }[world.terrainAt(cell) ?? 'grass']
}

/** A second pass after base tiles: shared edges are never overwritten by the next tile. */
export function terrainDetail(g: Graphics, world: WorldMap, cell: Cell) {
  const p = gridToWorld(cell), terrain = world.terrainAt(cell), seed = noise(cell.x, cell.y)
  if (terrain === 'grass') {
    if (seed % 3 === 0) g.ellipse(p.x + seed % 13 - 6, p.y, 20, 7).fill({ color: 0xc8cba0, alpha: .13 })
    if (seed % 4 === 0) {
      const x = p.x + seed % 17 - 8, y = p.y + seed % 7 - 3
      g.moveTo(x - 5, y).quadraticCurveTo(x - 5, y - 5, x - 9, y - 6)
        .moveTo(x - 5, y).quadraticCurveTo(x - 3, y - 5, x + 1, y - 5).stroke({ width: 1.2, color: 0x708b60, alpha: .6 })
      if (seed % 12 === 0) for (const dx of [-4, 3]) {
        g.circle(x + dx, y - 4, 2).fill(seed % 24 ? 0xe5c0b2 : 0xddd8ae)
        g.circle(x + dx, y - 4, .6).fill(0xb99660)
      }
    }
  } else if (terrain === 'water') {
    if (seed % 3 === 0) g.moveTo(p.x - 11, p.y).quadraticCurveTo(p.x - 2, p.y + 3, p.x + 9, p.y)
      .stroke({ color: 0xd4e1cb, alpha: .38, width: 1.2 })
  } else if (seed % 4 === 0) {
    g.ellipse(p.x - 8, p.y + 1, 2.6, 1.3).fill({ color: 0x9a957e, alpha: .4 })
    g.ellipse(p.x + 7, p.y - 2, 1.5, .8).fill({ color: 0xeee0ba, alpha: .65 })
  }
  if (terrain !== 'water' && terrain !== 'path' && terrain !== 'rock') return
  for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
    const neighbor = { x: cell.x + dx, y: cell.y + dy }
    if (!world.chunkAt(neighbor)?.unlocked || world.terrainAt(neighbor) === terrain) continue
    // Path borders are drawn only towards grass; water/rock own their blocking boundaries.
    if (terrain === 'path' && world.terrainAt(neighbor) !== 'grass') continue
    const a = gridToWorld({ x: cell.x + dx * .5 - dy * .5, y: cell.y + dy * .5 + dx * .5 })
    const b = gridToWorld({ x: cell.x + dx * .5 + dy * .5, y: cell.y + dy * .5 - dx * .5 })
    const color = terrain === 'water' ? 0xd4cfaa : terrain === 'rock' ? 0x7e9472 : 0xb4b18a
    g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ color, width: terrain === 'water' ? 3 : 2, alpha: .65 })
    if (terrain === 'water') {
      const inward = { x: (p.x - (a.x + b.x) / 2) * .10, y: (p.y - (a.y + b.y) / 2) * .10 }
      g.moveTo(a.x + inward.x, a.y + inward.y).quadraticCurveTo((a.x + b.x) / 2 + inward.x * 2,
        (a.y + b.y) / 2 + inward.y * 2, b.x + inward.x, b.y + inward.y).stroke({ color: 0xd3e2c8, alpha: .48, width: 1 })
    }
  }
}
