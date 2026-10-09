import { Container, Graphics } from 'pixi.js'
import { CHUNK_SIZE, type WorldChunk, type WorldMap } from '../game/world'
import { gridToWorld } from './camera'
import { terrainSeed } from './terrainContours'

/** Static, opaque exploration fog. World-anchored cloud patterns match across chunk seams. */
export function lockedRegionFog(world: WorldMap, chunk: WorldChunk) {
  const root = new Container(), base = new Graphics(), clouds = new Graphics(), mask = new Graphics(), rim = new Graphics()
  root.eventMode = 'none'
  const x = chunk.x * CHUNK_SIZE - .5, y = chunk.y * CHUNK_SIZE - .5
  const points = [[x, y], [x + CHUNK_SIZE, y], [x + CHUNK_SIZE, y + CHUNK_SIZE], [x, y + CHUNK_SIZE]]
    .map(([x, y]) => gridToWorld({ x, y }))
  const polygon = points.flatMap(p => [p.x, p.y])
  base.poly(polygon).fill(0xd0ddd5)
  mask.poly(polygon).fill(0xffffff)
  clouds.mask = mask
  const left = Math.min(...points.map(p => p.x)), right = Math.max(...points.map(p => p.x))
  const top = Math.min(...points.map(p => p.y)), bottom = Math.max(...points.map(p => p.y))
  for (let row = Math.floor((top - 100) / 76); row <= Math.ceil((bottom + 100) / 76); row++) {
    for (let col = Math.floor((left - 160) / 130); col <= Math.ceil((right + 160) / 130); col++) {
      const seed = terrainSeed(col, row)
      const px = col * 130 + (row % 2) * 53 + seed % 39 - 19, py = row * 76 + (seed >>> 6) % 25 - 12
      const size = .86 + (seed >>> 12) % 30 / 100
      clouds.ellipse(px + 9, py + 15, 94 * size, 45 * size).fill({ color: 0xb3c8bf, alpha: .24 })
      clouds.ellipse(px - 22, py, 78 * size, 43 * size).fill({ color: 0xe4eae0, alpha: .72 })
      clouds.ellipse(px + 40, py - 4, 67 * size, 38 * size).fill({ color: 0xe8ece2, alpha: .65 })
      clouds.ellipse(px - 9, py - 20, 53 * size, 29 * size).fill({ color: 0xf4f1e7, alpha: .38 })
    }
  }
  // A small scalloped fringe softens the mask only along exposed borders. Signs/actors render above it.
  for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
    const neighbor = world.chunkAt({ x: (chunk.x + dx) * CHUNK_SIZE, y: (chunk.y + dy) * CHUNK_SIZE })
    if (neighbor && !neighbor.unlocked) continue
    for (let i = 0; i < CHUNK_SIZE; i++) {
      const cell = { x: x + (dx === 1 ? CHUNK_SIZE : dx === -1 ? 0 : i + .5),
        y: y + (dy === 1 ? CHUNK_SIZE : dy === -1 ? 0 : i + .5) }
      const p = gridToWorld(cell), seed = terrainSeed(cell.x * 2, cell.y * 2)
      const size = .85 + seed % 16 / 100
      rim.ellipse(p.x, p.y, 26 * size, 13 * size).fill({ color: 0xdce6dc, alpha: .22 })
      rim.ellipse(p.x, p.y, 19 * size, 9.5 * size).fill({ color: 0xe2e9df, alpha: .57 })
    }
  }
  root.addChild(base, clouds, mask, rim)
  // Clouds are static. Rasterize once at half resolution instead of blending hundreds of
  // translucent ellipses and stencil masks on every frame (especially costly on mobile).
  root.cacheAsTexture({ resolution: .5, antialias: true })
  return root
}
