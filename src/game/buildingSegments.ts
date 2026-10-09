import { blueprintCells, type Blueprint, type BuildingPartConfig } from './buildingConfig'
import type { BuildingPart } from './construction'
import type { Cell } from './world'

export interface BuildingSegment {
  id: string
  name: string
  cell: Cell
  edge?: BuildingPartConfig['edges'][number]
}

/** Stable local IDs: build groups stay unchanged; only damage/repair use these units. */
export function buildingSegments(blueprint: Blueprint, config: BuildingPartConfig): BuildingSegment[] {
  if (config.kind === 'wall') return config.edges.map((edge, index) => ({
    id: `edge${index}`, name: `${config.name} ${index + 1}`, cell: edge.from, edge,
  }))
  if (config.kind === 'foundation' || config.kind === 'roof') return blueprintCells(blueprint).map(cell => {
    return { id: `tile${cell.x}-${cell.y}`, name: `${config.name} ${cell.x + 1},${cell.y + 1}`, cell }
  })
  return [{ id: 'whole', name: config.name, cell: config.work[0], edge: config.edges[0] }]
}

export function segmentHp(part: BuildingPart, id: string) { return part.segments ? part.segments[id] ?? 0 : part.hp }
export function ensureSegments(part: BuildingPart, segments: BuildingSegment[]) {
  if (segments.length > 1 && !part.segments) part.segments = Object.fromEntries(segments.map(segment => [segment.id, part.hp]))
}
export function createBuildingParts(blueprint: Blueprint): Record<string, BuildingPart> {
  return Object.fromEntries(blueprint.parts.map(config => {
    const part: BuildingPart = { hp: 0, built: false, xpGranted: false }
    ensureSegments(part, buildingSegments(blueprint, config))
    return [config.id, part]
  }))
}
export function setSegmentHp(part: BuildingPart, id: string, hp: number) {
  if (part.segments) {
    part.segments[id] = hp
    // Compatibility summary for enclosure/story/UI; never used as the target's own HP.
    part.hp = Math.min(...Object.values(part.segments))
  } else part.hp = hp
}
