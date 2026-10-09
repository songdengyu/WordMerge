/** Presentation-only; deliberately excluded from gameplay/save fingerprints. */
export const SCENE_ART = {
  tree: { file: 'tree.png', pixels: [256, 256], height: 108, anchor: [.50, .91] },
  chair: { file: 'chair.png', pixels: [128, 256], height: 40, anchor: [.50, .88] },
  planter: { file: 'planter.png', pixels: [256, 512], height: 46, anchor: [.50, .92] },
  shrub: { file: 'shrub.png', pixels: [256, 256], height: 43, anchor: [.50, .90] },
  'fruit-tree': { file: 'fruit-tree.png', pixels: [256, 512], height: 105, anchor: [.50, .94] },
  boulder: { file: 'boulder.png', pixels: [512, 256], height: 32, anchor: [.50, .82] },
  campfire: { file: 'campfire.png', pixels: [256, 128], height: 23, anchor: [.50, .78] },
  sign: { file: 'sign.png', pixels: [128, 128], height: 39, anchor: [.50, .90] },
  statue: { file: 'statue.png', pixels: [64, 64], height: 52, anchor: [.50, .88] },
  bed: { file: 'bed.png', pixels: [256, 256], height: 32, anchor: [.50, .80] },
  lantern: { file: 'lantern.png', pixels: [256, 512], height: 55, anchor: [.50, .94] },
  table: { file: 'table.png', pixels: [256, 256], height: 44, anchor: [.50, .88] },
  flowerstand: { file: 'flowerstand.png', pixels: [512, 512], height: 44, anchor: [.50, .88] },
  rug: { file: 'rug.png', pixels: [512, 256], height: 25, anchor: [.50, .50] },
  sofa: { file: 'sofa.png', pixels: [256, 256], height: 44, anchor: [.50, .89] },
  bookshelf: { file: 'bookshelf.png', pixels: [512, 512], height: 42, anchor: [.50, .90] },
  'tea-set': { file: 'tea-set.png', pixels: [256, 256], height: 26, anchor: [.50, .80] },
  wall: { file: 'wall.png', pixels: [96, 256] },
  floor: { file: 'floor.png', pixels: [256, 128] },
  roof: { file: 'roof.png', pixels: [256, 256] },
} as const
export type SceneArtId = keyof typeof SCENE_ART
export type SceneSpriteId = Exclude<SceneArtId, 'wall' | 'floor' | 'roof'>
export const sceneArtUrl = (id: SceneArtId) => `${import.meta.env.BASE_URL}assets/survival/scene/${SCENE_ART[id].file}`
export function spriteMetrics(id: SceneSpriteId) {
  const art = SCENE_ART[id], width = art.height * art.pixels[0] / art.pixels[1]
  return { width, height: art.height, anchorX: art.anchor[0], anchorY: art.anchor[1],
    left: -width * art.anchor[0], top: -art.height * art.anchor[1],
    right: width * (1 - art.anchor[0]), bottom: art.height * (1 - art.anchor[1]),
    bubbleHeight: art.height * art.anchor[1] + 8 }
}
