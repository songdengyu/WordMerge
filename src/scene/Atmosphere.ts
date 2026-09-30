import { Container, Graphics } from 'pixi.js'
import type { SceneSnapshot } from '../game/GameRuntime'
import { environmentLight } from '../game/environment'

/** Screen-space presentation; motion follows the world's pausable simulation clock. */
export class Atmosphere {
  readonly view = new Container()
  private readonly shade = new Graphics()
  private readonly air = new Graphics()
  private readonly glow = new Graphics()
  constructor() {
    this.view.eventMode = 'none'
    this.glow.blendMode = 'add'
    this.view.addChild(this.shade, this.air, this.glow)
  }
  draw(snapshot: SceneSnapshot, width: number, height: number, lights: { x: number; y: number }[]) {
    const light = environmentLight(snapshot.gameMinutes, snapshot.survival.weather), time = snapshot.elapsedSeconds
    const shade = this.shade.clear(), air = this.air.clear(), glow = this.glow.clear()
    shade.rect(0, 0, width, height).fill({ color: 0x0c1738, alpha: light.darkness })
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
    // Warm pools around the campfire and placed lanterns keep home readable at night.
    for (const point of lights) for (let layer = 6; layer >= 1; layer--) {
      glow.ellipse(point.x, point.y, 12 + layer * 9, 8 + layer * 6).fill({ color: 0xf8b75e, alpha: light.darkness * .045 * (1 + Math.sin(time * 2.5) * .06) })
    }
    return light
  }
}
