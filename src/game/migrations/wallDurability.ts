import { blueprintById } from '../buildingConfig'
import { REGION_CONTENT_VERSION } from '../regionContentConfig'
import type { RuntimeData } from '../saveData'

// Delivered fingerprints before cabin/lodge walls changed from 160/320 to 20/30.
export const PRE_WALL_BUILDING_VERSION = 'd146dff6'
export const PRE_WALL_REGION_VERSION = 'b3fb1516'
type Check = (condition: unknown, name: string) => asserts condition
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** Operates on the cloned save only; the normal validator then checks geometry, orders and reservations. */
export function migrateWallDurability(data: RuntimeData, oldCabin: boolean, check: Check) {
  const region = record(data.progression) && data.progression.regionContent
  const oldLodge = record(region) && region.version === PRE_WALL_REGION_VERSION
  if (oldLodge) region.version = REGION_CONTENT_VERSION
  if (!record(data.construction) || !Array.isArray(data.construction.buildings)) return
  for (const building of data.construction.buildings) {
    if (!record(building)) continue
    const oldMax = building.blueprintId === 'cabin' && oldCabin ? 160 : building.blueprintId === 'lodge' && oldLodge ? 320 : 0
    if (!oldMax || !record(building.parts) || !record(building.parts.walls)) continue
    const part = building.parts.walls
    const max = blueprintById(String(building.blueprintId))!.parts.find(part => part.id === 'walls')!.hp
    const scale = (hp: unknown) => {
      check(typeof hp === 'number' && Number.isFinite(hp) && hp >= 0 && hp <= oldMax, '旧围墙耐久')
      return hp / oldMax * max
    }
    part.hp = scale(part.hp)
    if (part.segments !== undefined) {
      check(record(part.segments), '旧围墙独立部件')
      for (const id of Object.keys(part.segments)) part.segments[id] = scale(part.segments[id])
    }
  }
}
