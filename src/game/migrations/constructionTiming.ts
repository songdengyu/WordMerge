import type { BuildingPartConfig } from '../buildingConfig'
import type { BuildingOrder } from '../construction'

// Exact fingerprint of the delivered M3 catalog (before the two-second timing update).
// Never derive historical fingerprints from the current, editable catalog.
export const M3_INITIAL_BUILDING_VERSION = '6f54c437'
const durations: Record<string, readonly [number, number]> = {
  foundation: [6, 4], walls: [10, 5], door: [6, 4], roof: [12, 6], bed: [8, 4],
}
export const initialConstructionSeconds = (config: BuildingPartConfig, order: BuildingOrder) =>
  durations[config.id][order.mode === 'repair' ? 1 : 0]
