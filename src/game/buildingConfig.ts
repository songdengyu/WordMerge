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
export interface Blueprint { id: string; name: string; width: number; height: number; parts: BuildingPartConfig[]; fixedRegion?: string }

// Versioned with the build, like code: changing this catalog requires an explicit save migration.
const BASE_BLUEPRINTS: readonly Blueprint[] = [{
  id: 'cabin', name: '林间小木屋', width: 3, height: 2,
  parts: [
    { id: 'foundation', name: '木地基', kind: 'foundation', requires: [], materials: [202], repairMaterials: [201], seconds: 2, repairSeconds: 2, hp: 100, xp: 10, work: [{ x: 1, y: 1 }], edges: [] },
    { id: 'walls', name: '围护木墙', kind: 'wall', requires: ['foundation'], materials: [202, 202], repairMaterials: [202], seconds: 2, repairSeconds: 2, hp: 20, xp: 20, work: [{ x: 1, y: 1 }], edges: [
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
    { id: 'walls', name: '大屋围墙', kind: 'wall', requires: ['foundation'], materials: [203, 203, 203], repairMaterials: [203], seconds: 2, repairSeconds: 2, hp: 30, xp: 30, work: [{ x: 2, y: 3 }], edges: [
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
    repairMaterials: [Math.max(201, material - 1)], hp: part.kind === 'wall' ? wallHp : part.hp,
    work: part.kind === 'bed' ? [{ x: 0, y: 1 }] : work,
    edges: part.kind === 'wall' ? walls : part.kind === 'door' ? [{ from: work[0], to: { x: doorX, y: height } }] : [],
  })) }
}
// Shop additions are versioned by economyConfig; preserve the historical building/region fingerprints.
export const BLUEPRINTS: readonly Blueprint[] = [...BASE_BLUEPRINTS,
  ...[{ id: 'garden-cabin', name: '花园木屋' }, { id: 'guest-cabin', name: '林间客舍' }].map(variant => {
    const source = BASE_BLUEPRINTS[variant.id === 'guest-cabin' ? 1 : 0]
    return { ...source, ...variant, fixedRegion: undefined, parts: source.parts.map(part => ({ ...part })) }
  }),
  expandedHouse('meadow-hut', '苔原草顶屋', 3, 2, 203, 20),
  expandedHouse('cedar-home', '暖杉小筑', 4, 3, 204, 40),
  expandedHouse('rose-manor', '蔷薇庄园', 5, 4, 206, 60),
]
export const BUILDING_VERSION = fingerprint(JSON.stringify(BASE_BLUEPRINTS.filter(blueprint => !blueprint.fixedRegion)))
export const blueprintById = (id: string) => BLUEPRINTS.find(blueprint => blueprint.id === id)

export function validateBuildingCatalog(catalog: ProductionCatalog) {
  const ids = new Set<string>()
  for (const blueprint of BLUEPRINTS) {
    if (ids.has(blueprint.id) || blueprint.width < 1 || blueprint.height < 1) throw new Error('建筑配置：蓝图 ID 或尺寸无效')
    ids.add(blueprint.id)
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
