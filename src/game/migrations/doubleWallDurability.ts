import { blueprintById } from '../buildingConfig'
import type { RuntimeData } from '../saveData'
import { PRE_WALL_REGION_VERSION } from './wallDurability'

export const PRE_DOUBLE_BUILDING_VERSION = 'ef8cf350'
export const PRE_DOUBLE_ECONOMY_VERSION = '432066d2'
export const PRE_DOUBLE_REGION_VERSION = 'e4ca7944'
type Check = (condition: unknown, name: string) => asserts condition
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** Scale historical damage, leaving ancient 160/320 walls to their own migration. */
export function doubleSavedWalls(data: RuntimeData, ancientCabin: boolean, check: Check) {
  const ancientLodge = record(data.progression) && record(data.progression.regionContent)
    && data.progression.regionContent.version === PRE_WALL_REGION_VERSION
  if (!record(data.construction) || !Array.isArray(data.construction.buildings)) return
  for (const building of data.construction.buildings) {
    if (!record(building) || typeof building.blueprintId !== 'string' || !record(building.parts)) continue
    if (ancientCabin && building.blueprintId === 'cabin' || ancientLodge && building.blueprintId === 'lodge') continue
    const blueprint = blueprintById(building.blueprintId)
    for (const config of blueprint?.parts.filter(p => p.kind === 'wall') ?? []) {
      const part = building.parts[config.id]
      if (!record(part)) continue
      const scale = (hp: unknown) => {
        check(typeof hp === 'number' && Number.isFinite(hp) && hp >= 0 && hp <= config.hp / 2, '翻倍前墙段耐久')
        return hp * 2
      }
      part.hp = scale(part.hp)
      if (part.segments !== undefined) {
        check(record(part.segments), '翻倍前墙段数据')
        for (const id of Object.keys(part.segments)) part.segments[id] = scale(part.segments[id])
      }
    }
  }
}
