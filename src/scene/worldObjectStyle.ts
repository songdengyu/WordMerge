import type { WorldObject } from '../game/world'
export const objectHeight = (kind: WorldObject['kind']) => ({ tree: 104, 'fruit-tree': 92, shrub: 38, sign: 40, boulder: 32, campfire: 12, statue: 72 })[kind]
