import { Assets, Graphics, Matrix, Sprite, type Texture } from 'pixi.js'
import { SCENE_ART, sceneArtUrl, spriteMetrics, type SceneArtId, type SceneSpriteId } from './sceneArtCatalog'
import type { Point } from './camera'

const textures = new Map<SceneArtId, Texture>()
const hitMasks = new Map<SceneSpriteId, { width: number; height: number; rgba: Uint8ClampedArray }>()
let loading: Promise<void> | undefined
/** Shared immutable textures survive scene remounts; loading never touches a scene. */
export function loadSceneArt(): Promise<void> {
  return loading ??= Promise.all((Object.keys(SCENE_ART) as SceneArtId[]).map(async id => {
    try {
      const texture = await Assets.load<Texture>(sceneArtUrl(id))
      textures.set(id, texture)
      if (id !== 'wall' && id !== 'floor' && id !== 'roof') {
        const canvas = document.createElement('canvas')
        canvas.width = texture.width; canvas.height = texture.height
        const context = canvas.getContext('2d', { willReadFrequently: true })!
        context.drawImage(texture.source.resource as CanvasImageSource, 0, 0)
        hitMasks.set(id, { width: canvas.width, height: canvas.height, rgba: context.getImageData(0, 0, canvas.width, canvas.height).data })
      }
    } catch (error) { console.warn(`Scene art ${id} unavailable; using vector fallback.`, error) }
  })).then(() => {})
}
export function loadedSceneArt() { return [...textures.keys()].sort().join(',') }
/** Excludes transparent corners and faint baked shadows from object selection. */
export function sceneSpriteContains(id: SceneSpriteId, x: number, y: number): boolean | null {
  const mask = hitMasks.get(id)
  if (!mask) return null
  const metrics = spriteMetrics(id)
  const px = Math.floor((x / metrics.width + metrics.anchorX) * mask.width)
  const py = Math.floor((y / metrics.height + metrics.anchorY) * mask.height)
  return px >= 0 && py >= 0 && px < mask.width && py < mask.height && mask.rgba[(py * mask.width + px) * 4 + 3] >= 48
}
export function sceneSprite(id: SceneSpriteId): Sprite | null {
  const texture = textures.get(id)
  if (!texture) return null
  const metrics = spriteMetrics(id), sprite = new Sprite(texture)
  sprite.label = `scene-art:${id}`; sprite.eventMode = 'none'
  sprite.anchor.set(metrics.anchorX, metrics.anchorY)
  sprite.width = metrics.width; sprite.height = metrics.height
  return sprite
}

/** Affine texture projection onto a polygon. Graphics tessellates it into a textured mesh.
 * o/u/v are the screen positions of texture coordinates (0,0)/(1,0)/(0,1).
 * Keeping that frame shared across segments prevents seams and stretching on rotation.
 */
export function texturedSurface(g: Graphics, id: 'wall' | 'floor' | 'roof', polygon: Point[],
  o: Point, u: Point, v: Point, color = 0xffffff): boolean {
  const texture = textures.get(id)
  if (!texture) return false
  const matrix = new Matrix((u.x - o.x) / texture.width, (u.y - o.y) / texture.width,
    (v.x - o.x) / texture.height, (v.y - o.y) / texture.height, o.x, o.y)
  if (Math.abs(matrix.a * matrix.d - matrix.b * matrix.c) < 1e-9) return false
  g.poly(polygon.flatMap(p => [p.x, p.y])).fill({ texture, matrix, textureSpace: 'global', color })
  return true
}
