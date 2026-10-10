import { fingerprint, type ProductionCatalog } from './productionConfig'
import type { Cell } from './world'

export interface BuildingPartConfig {
  id: string
  name: string
  kind: 'foundation' | 'wall' | 'door' | 'roof' | 'bed'
  requires: string[]
  materials: number[]
  repairMaterials: number[]
  seconds: number
  repairSeconds: number
  hp: number
  xp: number
  work: Cell[]
  edges: { from: Cell; to: Cell }[]
}
export interface Blueprint { id: string; name: string; width: number; height: number; cells?: readonly Cell[]; parts: BuildingPartConfig[]; fixedRegion?: string }

export const blueprintCells = (blueprint: Blueprint): readonly Cell[] => blueprint.cells ?? Array.from(
  { length: blueprint.width * blueprint.height }, (_, i) => ({ x: i % blueprint.width, y: Math.floor(i / blueprint.width) }))

export function validateBlueprintShape(blueprint: Blueprint) {
  const cells = blueprintCells(blueprint), keys = new Set(cells.map(c => `${c.x},${c.y}`))
  if (!cells.length || keys.size !== cells.length || cells.some(c => !Number.isInteger(c.x) || !Number.isInteger(c.y)
    || c.x < 0 || c.y < 0 || c.x >= blueprint.width || c.y >= blueprint.height)) throw new Error('建筑配置：占格无效')
  const visited = new Set<string>(), queue = [cells[0]]
  for (let i = 0; i < queue.length; i++) {
    const cell = queue[i], key = `${cell.x},${cell.y}`
    if (visited.has(key)) continue
    visited.add(key)
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const next = { x: cell.x + dx, y: cell.y + dy }, id = `${next.x},${next.y}`
      if (keys.has(id) && !visited.has(id)) queue.push(next)
    }
  }
  if (visited.size !== cells.length) throw new Error('建筑配置：占格必须连通')
  if (blueprint.cells) for (const part of blueprint.parts) {
    if (part.work.some(c => !keys.has(`${c.x},${c.y}`))) throw new Error('建筑配置：工作位不在占格内')
    if (part.edges.some(e => !keys.has(`${e.from.x},${e.from.y}`) || keys.has(`${e.to.x},${e.to.y}`))) throw new Error('建筑配置：墙门必须位于外围')
  }
}

// Versioned with the build, like code: changing this catalog requires an explicit save migration.
const BASE_BLUEPRINTS: readonly Blueprint[] = [{
  id: 'cabin', name: '林间小木屋', width: 3, height: 2,
  parts: [
    { id: 'foundation', name: '木地基', kind: 'foundation', requires: [], materials: [202], repairMaterials: [201], seconds: 2, repairSeconds: 2, hp: 100, xp: 10, work: [{ x: 1, y: 1 }], edges: [] },
    { id: 'walls', name: '围护木墙', kind: 'wall', requires: ['foundation'], materials: [202, 202], repairMaterials: [201], seconds: 2, repairSeconds: 2, hp: 40, xp: 20, work: [{ x: 1, y: 1 }], edges: [
      { from: { x: 0, y: 0 }, to: { x: 0, y: -1 } }, { from: { x: 1, y: 0 }, to: { x: 1, y: -1 } }, { from: { x: 2, y: 0 }, to: { x: 2, y: -1 } },
      { from: { x: 0, y: 0 }, to: { x: -1, y: 0 } }, { from: { x: 0, y: 1 }, to: { x: -1, y: 1 } },
      { from: { x: 2, y: 0 }, to: { x: 3, y: 0 } }, { from: { x: 2, y: 1 }, to: { x: 3, y: 1 } },
      { from: { x: 0, y: 1 }, to: { x: 0, y: 2 } }, { from: { x: 2, y: 1 }, to: { x: 2, y: 2 } },
    ] },
    { id: 'door', name: '营地木门', kind: 'door', requires: ['walls'], materials: [201, 201], repairMaterials: [201], seconds: 2, repairSeconds: 2, hp: 100, xp: 10, work: [{ x: 1, y: 1 }], edges: [{ from: { x: 1, y: 1 }, to: { x: 1, y: 2 } }] },
    { id: 'roof', name: '遮雨屋顶', kind: 'roof', requires: ['walls'], materials: [203], repairMaterials: [202], seconds: 2, repairSeconds: 2, hp: 120, xp: 20, work: [{ x: 1, y: 1 }], edges: [] },
    { id: 'bed', name: '简易木床', kind: 'bed', requires: ['roof'], materials: [202, 202], repairMaterials: [201], seconds: 2, repairSeconds: 2, hp: 80, xp: 10, work: [{ x: 0, y: 1 }], edges: [] },
  ],
}, {
  id: 'lodge', name: '林地大屋', width: 5, height: 4, fixedRegion: 'grove',
  parts: [
    { id: 'foundation', name: '大屋地基', kind: 'foundation', requires: [], materials: [203, 203], repairMaterials: [202], seconds: 2, repairSeconds: 2, hp: 180, xp: 20, work: [{ x: 2, y: 2 }], edges: [] },
    { id: 'walls', name: '大屋围墙', kind: 'wall', requires: ['foundation'], materials: [203, 203, 203], repairMaterials: [202], seconds: 2, repairSeconds: 2, hp: 60, xp: 30, work: [{ x: 2, y: 3 }], edges: [
      ...Array.from({ length: 5 }, (_, x) => ({ from: { x, y: 0 }, to: { x, y: -1 } })),
      ...Array.from({ length: 4 }, (_, y) => ({ from: { x: 0, y }, to: { x: -1, y } })),
      ...Array.from({ length: 4 }, (_, y) => ({ from: { x: 4, y }, to: { x: 5, y } })),
      ...[0, 1, 3, 4].map(x => ({ from: { x, y: 3 }, to: { x, y: 4 } })),
    ] },
    { id: 'door', name: '大屋木门', kind: 'door', requires: ['walls'], materials: [202, 202], repairMaterials: [202], seconds: 2, repairSeconds: 2, hp: 160, xp: 15, work: [{ x: 2, y: 3 }], edges: [{ from: { x: 2, y: 3 }, to: { x: 2, y: 4 } }] },
    { id: 'roof', name: '大屋屋顶', kind: 'roof', requires: ['walls'], materials: [203, 203], repairMaterials: [203], seconds: 2, repairSeconds: 2, hp: 200, xp: 30, work: [{ x: 2, y: 3 }], edges: [] },
    { id: 'bed', name: '大屋木床', kind: 'bed', requires: ['roof'], materials: [202, 202], repairMaterials: [201], seconds: 2, repairSeconds: 2, hp: 80, xp: 15, work: [{ x: 0, y: 1 }], edges: [] },
  ],
}]
function expandedHouse(id: string, name: string, width: number, height: number, material: number, wallHp: number): Blueprint {
  const doorX = Math.floor(width / 2), work = [{ x: doorX, y: height - 1 }]
  const walls = [
    ...Array.from({ length: width }, (_, x) => ({ from: { x, y: 0 }, to: { x, y: -1 } })),
    ...Array.from({ length: height }, (_, y) => ({ from: { x: 0, y }, to: { x: -1, y } })),
    ...Array.from({ length: height }, (_, y) => ({ from: { x: width - 1, y }, to: { x: width, y } })),
    ...Array.from({ length: width }, (_, x) => x).filter(x => x !== doorX).map(x => ({ from: { x, y: height - 1 }, to: { x, y: height } })),
  ]
  return { id, name, width, height, parts: BASE_BLUEPRINTS[0].parts.map(part => ({ ...part,
    materials: part.kind === 'wall' ? [material, material] : [part.kind === 'door' || part.kind === 'bed' ? Math.max(202, material - 1) : material],
    repairMaterials: [Math.max(201, material - (part.kind === 'wall' ? 2 : 1))], hp: part.kind === 'wall' ? wallHp : part.hp,
    work: part.kind === 'bed' ? [{ x: 0, y: 1 }] : work,
    edges: part.kind === 'wall' ? walls : part.kind === 'door' ? [{ from: work[0], to: { x: doorX, y: height } }] : [],
  })) }
}
function shapedHouse(id: string, name: string, width: number, height: number, material: number, hp: number, cells: Cell[], door: Cell): Blueprint {
  const source = expandedHouse(id, name, width, height, material, hp)
  const has = (x: number, y: number) => cells.some(c => c.x === x && c.y === y)
  const doorEdge = { from: door, to: { x: door.x, y: door.y + 1 } }
  const edges = cells.flatMap(from => [[0, -1], [1, 0], [0, 1], [-1, 0]].flatMap(([dx, dy]) => {
    const to = { x: from.x + dx, y: from.y + dy }
    return has(to.x, to.y) || from.x === door.x && from.y === door.y && dy === 1 ? [] : [{ from, to }]
  }))
  return { ...source, cells, parts: source.parts.map(part => ({ ...part,
    work: part.kind === 'bed' ? [{ x: 0, y: 1 }] : [door],
    edges: part.kind === 'wall' ? edges : part.kind === 'door' ? [doorEdge] : [],
  })) }
}
// Shop additions are versioned by economyConfig; preserve the historical building/region fingerprints.
export const BLUEPRINTS: readonly Blueprint[] = [...BASE_BLUEPRINTS,
  ...[{ id: 'garden-cabin', name: '花园木屋' }, { id: 'guest-cabin', name: '林间客舍' }].map(variant => {
    const source = BASE_BLUEPRINTS[variant.id === 'guest-cabin' ? 1 : 0]
    return { ...source, ...variant, fixedRegion: undefined, parts: source.parts.map(part => ({ ...part })) }
  }),
  expandedHouse('meadow-hut', '苔原草顶屋', 3, 2, 203, 40),
  expandedHouse('cedar-home', '暖杉小筑', 4, 3, 204, 80),
  expandedHouse('rose-manor', '蔷薇庄园', 5, 4, 206, 120),
  shapedHouse('forest-corner', '森语转角屋', 4, 4, 204, 80,
    Array.from({ length: 16 }, (_, i) => ({ x: i % 4, y: Math.floor(i / 4) })).filter(c => c.x < 2 || c.y < 2), { x: 1, y: 3 }),
  shapedHouse('flower-court', '花庭小院', 5, 4, 206, 120,
    Array.from({ length: 20 }, (_, i) => ({ x: i % 5, y: Math.floor(i / 5) })).filter(c => c.x !== 2 || c.y < 2), { x: 2, y: 1 }),
]
export const BUILDING_VERSION = fingerprint(JSON.stringify(BASE_BLUEPRINTS.filter(blueprint => !blueprint.fixedRegion)))
export const blueprintById = (id: string) => BLUEPRINTS.find(blueprint => blueprint.id === id)

export function validateBuildingCatalog(catalog: ProductionCatalog) {
  const ids = new Set<string>()
  for (const blueprint of BLUEPRINTS) {
    if (ids.has(blueprint.id) || blueprint.width < 1 || blueprint.height < 1) throw new Error('建筑配置：蓝图 ID 或尺寸无效')
    ids.add(blueprint.id)
    validateBlueprintShape(blueprint)
    const prior = new Set<string>()
    for (const part of blueprint.parts) {
      if (prior.has(part.id) || part.requires.some(id => !prior.has(id)) || !part.work.length
        || part.seconds <= 0 || part.repairSeconds <= 0 || part.hp <= 0 || part.xp < 0
        || !part.materials.length || !part.repairMaterials.length) throw new Error(`建筑配置：${part.id} 依赖或数值无效`)
      for (const id of [...part.materials, ...part.repairMaterials]) {
        if (catalog.itemById.get(id)?.itemType !== 'normal') throw new Error(`建筑配置：${part.id} 的材料 ${id} 无效`)
      }
      for (const cell of part.work) if (!Number.isInteger(cell.x) || !Number.isInteger(cell.y) || cell.x < 0 || cell.y < 0
        || cell.x >= blueprint.width || cell.y >= blueprint.height) throw new Error(`建筑配置：${part.id} 工作位无效`)
      for (const edge of part.edges) if (Math.abs(edge.from.x - edge.to.x) + Math.abs(edge.from.y - edge.to.y) !== 1) throw new Error(`建筑配置：${part.id} 阻挡边无效`)
      prior.add(part.id)
    }
  }
}
