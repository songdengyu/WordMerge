import { Container, Graphics, Sprite, Texture } from 'pixi.js'
import type { SceneSnapshot } from '../game/GameRuntime'
import { environmentLight } from '../game/environment'

export interface SceneLight { x: number; y: number; radius: number; strength?: number }

/** Screen-space presentation; motion follows the world's pausable simulation clock. */
export class Atmosphere {
  readonly view = new Container()
  private readonly shade = new Graphics()
  private readonly air = new Graphics()
  private readonly glow = new Graphics()
  private readonly darknessCanvas = document.createElement('canvas')
  private readonly darknessTexture = Texture.from(this.darknessCanvas)
  private readonly darkness = new Sprite(this.darknessTexture)
  private lastDraw = -1
  private lastGeometry = ''
  constructor() {
    this.view.eventMode = 'none'
    this.glow.blendMode = 'add'
    this.view.addChild(this.shade, this.air, this.darkness, this.glow)
  }
  draw(snapshot: SceneSnapshot, width: number, height: number, lights: SceneLight[]) {
    const light = environmentLight(snapshot.gameMinutes, snapshot.survival.weather), time = snapshot.elapsedSeconds
    const shade = this.shade.clear(), air = this.air.clear(), glow = this.glow.clear()
    // Keep daylight/twilight tinting, but use actual transparent light pools at night.
    if (light.isDay) shade.rect(0, 0, width, height).fill({ color: 0x0c1738, alpha: light.darkness })
    if (light.warmth > 0) shade.rect(0, 0, width, height).fill({ color: light.color, alpha: light.warmth })
    if (light.overcast > 0) shade.rect(0, 0, width, height).fill({ color: 0x435667, alpha: light.overcast })
    if (snapshot.survival.weather === 'sunny') {
      if (light.isDay) {
        const alpha = (.025 + light.warmth * .1) * (1 - light.darkness)
        for (let i = 0; i < 3; i++) {
          const x = width * (.1 + i * .28) + Math.sin(time * .025 + i) * 14
          air.poly([x - 50, 0, x + 15, 0, x + width * .48, height, x + width * .18, height]).fill({ color: 0xffefb0, alpha })
        }
      }
      for (let i = 0; i < 16; i++) {
        const x = (i * 83 + time * (1 + i % 3)) % (width + 20) - 10
        const y = (i * 137 + Math.sin(time * .18 + i) * 9 + height) % height
        const pulse = .5 + Math.sin(time * .8 + i) * .5
        air.circle(x, y, light.isDay ? 1 : 1.5).fill({ color: light.isDay ? 0xfff2ba : 0xd5edab, alpha: (.08 + pulse * .2) * (light.isDay ? 1 : .7) })
      }
    } else {
      // Soft cloud shadows drift over the terrain even when it is not raining.
      for (let i = 0; i < 5; i++) {
        const x = (i * 173 + time * (snapshot.survival.weather === 'rain' ? 6 : 3)) % (width + 360) - 180
        const y = height * (.18 + i * .18) + Math.sin(time * .03 + i) * 12
        for (let layer = 4; layer >= 1; layer--) {
          air.ellipse(x, y, 75 + layer * 18, 20 + layer * 10).fill({ color: 0x243746, alpha: .014 })
          air.ellipse(x + 75, y + 12, 55 + layer * 15, 15 + layer * 9).fill({ color: 0x243746, alpha: .012 })
        }
      }
    }
    if (snapshot.survival.weather === 'rain') {
      const count = Math.min(90, Math.round(width * height / 4500))
      for (let i = 0; i < count; i++) {
        const x = ((i * 97 - time * 70) % (width + 30) + width + 30) % (width + 30) - 15
        const y = (i * 137 + time * (240 + i % 3 * 25)) % (height + 30) - 15
        air.moveTo(x, y).lineTo(x - 5, y + 17).stroke({ color: 0xd6e6ed, alpha: .22 + i % 3 * .04, width: 1 })
      }
      for (let i = 0; i < 14; i++) {
        const age = (time * .7 + i * .29) % 1
        air.ellipse((i * 137 + 41) % width, (i * 193 + 67) % height, 2 + age * 7, 1 + age * 3).stroke({ color: 0xc5dfe4, alpha: (1 - age) * .15, width: .8 })
      }
    }
    this.darkness.visible = !light.isDay
    const visibleLights = lights.filter(p => p.x + p.radius > 0 && p.x - p.radius < width && p.y + p.radius > 0 && p.y - p.radius < height)
    if (!light.isDay) this.drawDarkness(width, height, light.darkness, visibleLights, time)
    // A little amber at the center, not an opaque additive disk over hidden terrain.
    for (const point of visibleLights) for (let layer = 5; layer >= 1; layer--) {
      glow.circle(point.x, point.y, point.radius * layer / 12).fill({ color: 0xf8b75e,
        alpha: light.darkness * .018 * (point.strength ?? 1) * (1 + Math.sin(time * 2.5) * .06) })
    }
    return light
  }

  private drawDarkness(width: number, height: number, opacity: number, lights: SceneLight[], time: number) {
    // Half-resolution soft mask keeps mobile upload cost small; camera movement updates immediately.
    const geometry = JSON.stringify([width, height, lights.map(p => [p.x, p.y, p.radius, p.strength])])
    if (geometry === this.lastGeometry && time >= this.lastDraw && time - this.lastDraw < 1 / 30) return
    this.lastDraw = time; this.lastGeometry = geometry
    const canvas = this.darknessCanvas, w = Math.max(1, Math.ceil(width / 2)), h = Math.max(1, Math.ceil(height / 2))
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; this.darknessTexture.source.resize(w, h) }
    const ctx = canvas.getContext('2d')!
    ctx.setTransform(w / width, 0, 0, h / height, 0, 0)
    ctx.clearRect(0, 0, width, height)
    ctx.globalCompositeOperation = 'source-over'
    ctx.fillStyle = `rgba(3,7,15,${opacity})`; ctx.fillRect(0, 0, width, height)
    ctx.globalCompositeOperation = 'destination-out'
    for (const [index, point] of lights.entries()) {
      const radius = point.radius * (1 + Math.sin(time * 3.3 + index * 1.7) * .012)
      const strength = .98 * (point.strength ?? 1)
      const gradient = ctx.createRadialGradient(point.x, point.y, 0, point.x, point.y, radius)
      gradient.addColorStop(0, `rgba(0,0,0,${strength})`)
      gradient.addColorStop(.32, `rgba(0,0,0,${strength})`)
      gradient.addColorStop(.62, `rgba(0,0,0,${strength * .8})`)
      gradient.addColorStop(.82, `rgba(0,0,0,${strength * .35})`)
      gradient.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = gradient; ctx.fillRect(point.x - radius, point.y - radius, radius * 2, radius * 2)
    }
    ctx.globalCompositeOperation = 'source-over'
    this.darknessTexture.source.update()
    this.darkness.width = width; this.darkness.height = height
  }

  dispose() { this.darkness.destroy(); this.darknessTexture.destroy(true) }
}
