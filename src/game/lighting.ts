import { exchangeItems, type ProductionState } from './inventory'
import type { ProductionCatalog } from './productionConfig'

/** Durations use active simulation seconds; radii use the map's projected world units. */
export const LIGHTING = {
  torch: { fuel: [201, 201], seconds: 60, radius: 150 },
  lantern: { radius: 180 },
  campfire: { radius: 210 },
} as const
export type LightingCommand = { type: 'torch-light' }

export function lightTorch(production: ProductionState, remaining: number, catalog: ProductionCatalog) {
  if (remaining > 0) return { accepted: false as const, reason: `火把正在燃烧，还剩 ${Math.ceil(remaining)} 秒` }
  const next = structuredClone(production)
  if (!exchangeItems(next.inventory, catalog, LIGHTING.torch.fuel, [])) {
    return { accepted: false as const, reason: '需要 2 根可用木枝点燃火把，请前往合成物资准备' }
  }
  return { accepted: true as const, production: next, remaining: LIGHTING.torch.seconds,
    message: `消耗木枝 ×2，火把已点燃，可照明 ${LIGHTING.torch.seconds} 秒` }
}

export function burnTorch(remaining: number, seconds: number) {
  const next = remaining - seconds
  return next <= 1e-6 ? 0 : next
}
