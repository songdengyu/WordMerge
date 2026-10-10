import type { Graphics } from 'pixi.js'
import { blueprintCells, type Blueprint } from '../game/buildingConfig'
import type { Building } from '../game/construction'
import { localToWorld } from '../game/construction'
import { buildingSegments, segmentHp } from '../game/buildingSegments'
import { gridToWorld, type Point } from './camera'
import type { HouseStyle } from './houseStyle'
import { WALL_HEIGHT_PX } from './buildingDimensions'

/** Shared vertex heights give adjoining wings a continuous hipped roof without covering the courtyard. */
export function roofHeight(blueprint: Blueprint, x: number, y: number, rise: number) {
  const cells = blueprintCells(blueprint), has = (x: number, y: number) => cells.some(c => c.x === x && c.y === y)
  let distance = Infinity
  for (const c of cells) for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
    if (has(c.x + dx, c.y + dy)) continue
    const cx = c.x + dx * .5, cy = c.y + dy * .5
    const px = dx ? cx : Math.max(cx - .5, Math.min(cx + .5, x))
    const py = dy ? cy : Math.max(cy - .5, Math.min(cy + .5, y))
    distance = Math.min(distance, Math.hypot(x - px, y - py))
  }
  return WALL_HEIGHT_PX + rise * Math.min(1, distance)
}

export function drawShapedRoof(g: Graphics, building: Building, blueprint: Blueprint, style: HouseStyle, anchor: Point) {
  const config = blueprint.parts.find(p => p.kind === 'roof')!, part = building.parts[config.id]
  const project = (x: number, y: number) => {
    const p = gridToWorld(localToWorld(building, { x, y }))
    return { x: p.x - anchor.x, y: p.y - anchor.y - roofHeight(blueprint, x, y, style.rise) }
  }
  const cells = blueprintCells(blueprint)
  // Projected depth matters at the inside corner and when a single tile is missing.
  const segments = buildingSegments(blueprint, config).filter(s => segmentHp(part, s.id) > 0)
    .sort((a, b) => gridToWorld(localToWorld(building, a.cell)).y - gridToWorld(localToWorld(building, b.cell)).y)
  for (const segment of segments) {
    const { x, y } = segment.cell, center = project(x, y)
    const corners = [[x - .5, y - .5], [x + .5, y - .5], [x + .5, y + .5], [x - .5, y + .5]]
    for (let i = 0; i < 4; i++) {
      const a = project(...corners[i] as [number, number]), b = project(...corners[(i + 1) % 4] as [number, number])
      const triangle = [a.x, a.y, b.x, b.y, center.x, center.y]
      g.poly(triangle).fill(segmentHp(part, segment.id) < config.hp ? 0x967d72 : style.roof)
      const shade = (a.y + b.y) / 2 < center.y
      g.poly(triangle).fill({ color: shade ? 0xffffff : 0x314a40, alpha: shade ? .045 : .045 })
      const [dx, dy] = [[0, -1], [1, 0], [0, 1], [-1, 0]][i]
      if (!cells.some(c => c.x === x + dx && c.y === y + dy)) g.moveTo(a.x, a.y).lineTo(b.x, b.y)
        .stroke({ color: style.trim, width: 2.5 })
    }
    // Courses continue across adjacent cells; no triangle/cell outlines on the roof.
    for (const offset of [-.25, .25]) {
      const a = project(x - .5, y + offset), m = project(x, y + offset), b = project(x + .5, y + offset)
      g.moveTo(a.x, a.y).lineTo(m.x, m.y).lineTo(b.x, b.y).stroke({ color: style.trim, alpha: .25, width: .8 })
    }
  }
}
