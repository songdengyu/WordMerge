import type { RegionExtension, WorldObject } from './world'

/** Additive ring around the original camp, brook and grove. No chapter rewards are attached. */
export const EXPANSION_REGIONS = [
  { id: 'meadow', name: '暖风草甸', xp: 50, point: { x: -9, y: 8 }, landmark: '' },
  { id: 'fern', name: '蕨叶坡地', xp: 60, point: { x: 7, y: 24 }, landmark: '' },
  { id: 'mist', name: '晨雾林隙', xp: 90, point: { x: -9, y: -8 }, landmark: '' },
  { id: 'pine', name: '松影高地', xp: 120, point: { x: 23, y: -8 }, landmark: '' },
  { id: 'flower', name: '花溪原野', xp: 150, point: { x: -9, y: 24 }, landmark: '' },
  { id: 'lake', name: '映月湖畔', xp: 180, point: { x: 23, y: 24 }, landmark: '' },
] as const

const resources: readonly [number, number, WorldObject['kind']][] = [
  [1, 1, 'tree'], [5, 3, 'tree'], [12, 2, 'fruit-tree'], [3, 6, 'shrub'], [11, 5, 'tree'],
  [2, 10, 'tree'], [5, 13, 'fruit-tree'], [10, 14, 'tree'], [14, 9, 'shrub'], [12, 13, 'boulder'],
]
export const EXPANSION_EXTENSIONS: readonly RegionExtension[] = EXPANSION_REGIONS.map((region, i) => {
  const x = Math.floor(region.point.x / 16) * 16, y = Math.floor(region.point.y / 16) * 16
  return {
    id: region.id,
    patches: [
      { x: 7, y: 0, width: 2, height: 16, terrain: 'path' },
      { x: 0, y: 7, width: 16, height: 2, terrain: 'path' },
      { x: 2, y: 2, width: 3, height: i === 5 ? 4 : 3, terrain: i === 3 ? 'rock' : 'water' },
      { x: 11, y: 11, width: 3, height: 2, terrain: i === 5 ? 'water' : 'rock' },
    ],
    objects: resources.map(([dx, dy, kind], n) => ({ id: `${region.id}-resource-${n + 1}`, kind, x: x + dx, y: y + dy })),
  }
})
