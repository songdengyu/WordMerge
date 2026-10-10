import { PLAYER_SPEED, pointCell, pointDistance } from './smoothNavigation'
import type { Cell, WorldMap } from './world'

export const WATER_MOVEMENT = { speedMultiplier: .5 } as const
export const isInWater = (world: WorldMap, position: Cell) => world.terrainAt(pointCell(position)) === 'water'

/** Spend simulation time per terrain interval, including partial steps across a shore.
 * Navigation still validates the entire swept path; this function only advances it. */
export function walkPlayerPath(world: WorldMap, start: Cell, path: readonly Cell[], seconds: number) {
  let position = { ...start }, index = 0, distance = 0, throughWater = isInWater(world, start)
  const epsilon = 1e-8
  while (index < path.length && seconds > epsilon) {
    const target = path[index], length = pointDistance(position, target)
    if (length < epsilon) { position = { ...target }; index++; continue }
    const dx = (target.x - position.x) / length, dy = (target.y - position.y) / length
    // At an exact boundary, probe in the travel direction to choose the entering tile.
    const probe = { x: position.x + dx * epsilon, y: position.y + dy * epsilon }, cell = pointCell(probe)
    const water = isInWater(world, probe), speed = PLAYER_SPEED * (water ? WATER_MOVEMENT.speedMultiplier : 1)
    const bx = Math.abs(dx) > epsilon ? (cell.x + Math.sign(dx) * .5 - position.x) / dx : Infinity
    const by = Math.abs(dy) > epsilon ? (cell.y + Math.sign(dy) * .5 - position.y) / dy : Infinity
    const travel = Math.min(length, seconds * speed, bx, by)
    position = { x: position.x + dx * travel, y: position.y + dy * travel }
    seconds -= travel / speed; distance += travel
    throughWater ||= water && travel > 0
    if (length - travel < epsilon) { position = { ...target }; index++ }
  }
  return { position, route: path.slice(index), distance, throughWater: throughWater || isInWater(world, position) }
}
