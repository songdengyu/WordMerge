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
export interface Blueprint { id: string; name: string; width: number; height: number; parts: BuildingPartConfig[] }

// Versioned with the build, like code: changing this catalog requires an explicit save migration.
export const BLUEPRINTS: readonly Blueprint[] = [{
  id: 'cabin', name: '林间小木屋', width: 3, height: 2,
  parts: [
    { id: 'foundation', name: '木地基', kind: 'foundation', requires: [], materials: [202], repairMaterials: [201], seconds: 2, repairSeconds: 2, hp: 100, xp: 10, work: [{ x: 1, y: 1 }], edges: [] },
    { id: 'walls', name: '围护木墙', kind: 'wall', requires: ['foundation'], materials: [202, 202], repairMaterials: [202], seconds: 2, repairSeconds: 2, hp: 160, xp: 20, work: [{ x: 1, y: 1 }], edges: [
      { from: { x: 0, y: 0 }, to: { x: 0, y: -1 } }, { from: { x: 1, y: 0 }, to: { x: 1, y: -1 } }, { from: { x: 2, y: 0 }, to: { x: 2, y: -1 } },
      { from: { x: 0, y: 0 }, to: { x: -1, y: 0 } }, { from: { x: 0, y: 1 }, to: { x: -1, y: 1 } },
      { from: { x: 2, y: 0 }, to: { x: 3, y: 0 } }, { from: { x: 2, y: 1 }, to: { x: 3, y: 1 } },
      { from: { x: 0, y: 1 }, to: { x: 0, y: 2 } }, { from: { x: 2, y: 1 }, to: { x: 2, y: 2 } },
    ] },
    { id: 'door', name: '营地木门', kind: 'door', requires: ['walls'], materials: [201, 201], repairMaterials: [201], seconds: 2, repairSeconds: 2, hp: 100, xp: 10, work: [{ x: 1, y: 1 }], edges: [{ from: { x: 1, y: 1 }, to: { x: 1, y: 2 } }] },
    { id: 'roof', name: '遮雨屋顶', kind: 'roof', requires: ['walls'], materials: [203], repairMaterials: [202], seconds: 2, repairSeconds: 2, hp: 120, xp: 20, work: [{ x: 1, y: 1 }], edges: [] },
    { id: 'bed', name: '简易木床', kind: 'bed', requires: ['roof'], materials: [202, 202], repairMaterials: [201], seconds: 2, repairSeconds: 2, hp: 80, xp: 10, work: [{ x: 0, y: 1 }], edges: [] },
  ],
}]
export const BUILDING_VERSION = fingerprint(JSON.stringify(BLUEPRINTS))
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
