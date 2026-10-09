import type { WorldObject } from '../game/world'
import { spriteMetrics } from './sceneArtCatalog'

export function objectAppearance(object: WorldObject) {
  let seed = 2166136261
  for (const char of object.id) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619) >>> 0
  const natural = ['tree', 'fruit-tree', 'shrub', 'boulder'].includes(object.kind)
  const scaleX = natural ? .90 + (seed % 5) * .045 : 1
  const scaleY = natural ? .92 + (seed % 7) * .025 : 1
  const metrics = spriteMetrics(object.kind), scale = (scaleX + scaleY) / 2
  return { seed, variant: seed % 3, scaleX: scale, scaleY: scale, width: metrics.width * scale / 2,
    height: -metrics.top * scale, bottom: metrics.bottom * scale, bubbleHeight: metrics.bubbleHeight * scale }
}
