import { getOrderTarget, orderMaterials, releaseJob } from '../construction'
import type { RuntimeData } from '../saveData'

// Exact delivered catalogs before wall repairs were reduced by one merge tier.
export const PRE_REPAIR_BUILDING_VERSION = '84704955'
export const PRE_REPAIR_ECONOMY_VERSION = '652eb241'
export const PRE_REPAIR_REGION_VERSION = '4868ef5b'
const PRE_REPAIR_ITEMS: Readonly<Record<string, number>> = {
  cabin: 202, lodge: 203, 'garden-cabin': 202, 'guest-cabin': 203, 'meadow-hut': 202,
  'cedar-home': 203, 'rose-manor': 205, 'forest-corner': 203, 'flower-court': 205,
}

/** Validate historical reservations BEFORE releasing any of them. */
export const previousRepairMaterials: typeof orderMaterials = (state, order) => {
  const { building, config } = getOrderTarget(state, order)
  return order.mode === 'repair' && config.kind === 'wall'
    ? [PRE_REPAIR_ITEMS[building.blueprintId]] : orderMaterials(state, order)
}

export function migrateWallRepairJobs(data: RuntimeData) {
  const { construction, production } = data
  for (const job of [...construction.jobs]) {
    const order = construction.orders.find(o => o.id === job.orderId)!
    if (job.phase === 'building' || order.mode !== 'repair' || getOrderTarget(construction, order).config.kind !== 'wall') continue
    // Work already paid for continues. Unpaid high-tier materials stay in their
    // original inventory slots; keep the order so it now requests the cheaper item.
    releaseJob(construction, production.inventory, job.orderId)
    if (job.phase === 'travel') {
      data.route = []; data.destination = null; data.searching = false; data.progress = 0
    }
  }
}
