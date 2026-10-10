import type { Blueprint } from '../game/buildingConfig'
import { buildingSegments, segmentHp } from '../game/buildingSegments'
import { localToWorld, type Building } from '../game/construction'
import { roofHeight } from './ShapedRoof'
import { DOOR_HEIGHT_PX, WALL_HEIGHT_PX } from './buildingDimensions'
import { houseStyle } from './houseStyle'

/** XYZ mesh, in tile units. Z is height; game collision remains on the XY grid. */
export type Vertex3 = { x: number; y: number; z: number }
export type ModelFace = { vertices: Vertex3[]; color: number; partId: string; segmentId: string }
export type BuildingMesh = ModelFace[]
export const WALL_HEIGHT = WALL_HEIGHT_PX / 32
export const WALL_THICKNESS = .13

export function normal3(vertices: Vertex3[]): Vertex3 {
  const [a, b, c] = vertices
  const u = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z }, v = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z }
  const n = { x: u.y * v.z - u.z * v.y, y: u.z * v.x - u.x * v.z, z: u.x * v.y - u.y * v.x }
  const length = Math.hypot(n.x, n.y, n.z) || 1
  return { x: n.x / length, y: n.y / length, z: n.z / length }
}

/** CCW top ring, closed sides/bottom. Variable top heights make solid roof wedges. */
export function solid(top: Vertex3[], bottomZ: number, color: number, partId = '', segmentId = ''): BuildingMesh {
  const base = top.map(p => ({ ...p, z: bottomZ }))
  const rings = [top, [...base].reverse(), ...top.map((p, i) => {
    const j = (i + 1) % top.length
    return [base[i], base[j], top[j], p]
  })]
  return rings.filter(v => Math.hypot(normal3(v).x, normal3(v).y, normal3(v).z) > .1)
    .map(vertices => ({ vertices, color, partId, segmentId }))
}
export function beam(a: { x: number; y: number }, b: { x: number; y: number }, width: number, height: number,
  color: number, partId = '', segmentId = '') {
  const length = Math.hypot(b.x - a.x, b.y - a.y), nx = -(b.y - a.y) / length * width / 2, ny = (b.x - a.x) / length * width / 2
  return solid([{ x: a.x - nx, y: a.y - ny, z: height }, { x: b.x - nx, y: b.y - ny, z: height },
    { x: b.x + nx, y: b.y + ny, z: height }, { x: a.x + nx, y: a.y + ny, z: height }], 0, color, partId, segmentId)
}
export function worldMesh(mesh: BuildingMesh, building: Pick<Building, 'origin' | 'rotation'>): BuildingMesh {
  return mesh.map(face => ({ ...face, vertices: face.vertices.map(p => ({ ...localToWorld(building, p), z: p.z })) }))
}
export const project3 = (p: Vertex3) => ({ x: (p.x - p.y) * 32, y: (p.x + p.y) * 16 - p.z * 32 })

export function visibleModelFaces(mesh: BuildingMesh) {
  return mesh.map(face => ({ face, normal: normal3(face.vertices), depth: face.vertices.reduce((s, p) => s + p.x + p.y + p.z, 0) / face.vertices.length }))
    .filter(({ normal: n }) => n.x + n.y + n.z > .00001).sort((a, b) => a.depth - b.depth)
    .map(({ face, normal: n }) => {
      const light = .68 + .34 * Math.max(0, -.35 * n.x - .25 * n.y + .9 * n.z)
      const channel = (shift: number) => Math.min(255, Math.round(((face.color >> shift) & 255) * light))
      return { ...face, color: (channel(16) << 16) | (channel(8) << 8) | channel(0), points: face.vertices.map(project3) }
    })
}
export function completeModelBuilding(blueprint: Blueprint): Building {
  return { id: 'preview', blueprintId: blueprint.id, origin: { x: 0, y: 0 }, rotation: 0,
    parts: Object.fromEntries(blueprint.parts.map(p => [p.id, { built: true, hp: p.hp, xpGranted: true }])) }
}

export function buildingModel(building: Building, blueprint: Blueprint): BuildingMesh {
  const mesh: BuildingMesh = [], style = houseStyle(building.blueprintId)
  for (const config of blueprint.parts) {
    const part = building.parts[config.id]
    if (!part.built || config.kind === 'bed') continue
    for (const segment of buildingSegments(blueprint, config)) {
      const hp = segmentHp(part, segment.id)
      if (hp <= 0) continue
      const color = hp < config.hp ? 0xa88b75 : config.kind === 'roof' ? style.roof : config.kind === 'wall' ? style.wall : config.kind === 'door' ? 0xb6814e : style.floor
      if (segment.edge) {
        const { from, to } = segment.edge, dx = to.x - from.x, dy = to.y - from.y
        const center = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }
        mesh.push(...beam({ x: center.x - dy / 2, y: center.y + dx / 2 }, { x: center.x + dy / 2, y: center.y - dx / 2 },
          config.kind === 'door' ? .09 : WALL_THICKNESS, config.kind === 'door' ? DOOR_HEIGHT_PX / 32 : WALL_HEIGHT, color, config.id, segment.id))
      } else if (config.kind === 'foundation') {
        const { x, y } = segment.cell
        mesh.push(...solid([{ x: x - .5, y: y - .5, z: 0 }, { x: x + .5, y: y - .5, z: 0 },
          { x: x + .5, y: y + .5, z: 0 }, { x: x - .5, y: y + .5, z: 0 }], -.14, color, config.id, segment.id))
      } else if (config.kind === 'roof') {
        const { x, y } = segment.cell
        const height = (x: number, y: number) => (blueprint.cells ? roofHeight(blueprint, x, y, style.rise)
          : WALL_HEIGHT_PX + style.rise * (1 - Math.abs(y - (blueprint.height - 1) / 2) / (blueprint.height / 2))) / 32 + .09
        const center = { x, y, z: height(x, y) }
        const corners = [[x - .5, y - .5], [x + .5, y - .5], [x + .5, y + .5], [x - .5, y + .5]]
          .map(([x, y]) => ({ x, y, z: height(x, y) }))
        if (blueprint.cells) {
          // Four closed wedges per occupied tile: a destroyed tile remains a real hole.
          for (let i = 0; i < 4; i++) mesh.push(...solid([corners[i], corners[(i + 1) % 4], center], WALL_HEIGHT, color, config.id, segment.id))
        } else {
          const ridge = (blueprint.height - 1) / 2
          const cuts = y - .5 < ridge && ridge < y + .5 ? [y - .5, ridge, y + .5] : [y - .5, y + .5]
          for (let i = 1; i < cuts.length; i++) mesh.push(...solid([[x - .5, cuts[i - 1]], [x + .5, cuts[i - 1]],
            [x + .5, cuts[i]], [x - .5, cuts[i]]].map(([x, y]) => ({ x, y, z: height(x, y) })), WALL_HEIGHT, color, config.id, segment.id))
        }
      }
    }
  }
  // Shared solid faces are internal. Remove both copies so painter ordering cannot
  // draw an interior divider over a neighboring roof slope (and damage exposes it again).
  const key = (face: ModelFace) => face.vertices.map(v => [v.x, v.y, v.z].map(n => n.toFixed(8)).join(',')).sort().join(';')
  const counts = new Map<string, number>()
  mesh.forEach(f => counts.set(key(f), (counts.get(key(f)) ?? 0) + 1))
  return worldMesh(mesh.filter(f => counts.get(key(f)) === 1), building)
}

/** Standard model export for inspecting the actual XYZ geometry in a 3D authoring tool. */
export function modelToObj(mesh: BuildingMesh): string {
  let index = 1
  return '# WordMerge generated low-poly building; Z up\nmtllib materials.mtl\n' + mesh.map(face => {
    const lines = [`g ${face.partId}_${face.segmentId}`, `usemtl c_${face.color.toString(16)}`, ...face.vertices.map(v => `v ${v.x} ${v.y} ${v.z}`),
      `f ${face.vertices.map((_, i) => index + i).join(' ')}`]
    index += face.vertices.length
    return lines.join('\n')
  }).join('\n') + '\n'
}
