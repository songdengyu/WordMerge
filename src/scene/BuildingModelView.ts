import type { Graphics } from 'pixi.js'
import { visibleModelFaces, type BuildingMesh } from './buildingModel'
import type { Point } from './camera'

/** Fixed orthographic view: back-face culling + depth order + diffuse face lighting. */
export function drawBuildingMesh(g: Graphics, mesh: BuildingMesh, origin: Point = { x: 0, y: 0 }) {
  for (const face of visibleModelFaces(mesh)) {
    g.poly(face.points.flatMap(p => [p.x - origin.x, p.y - origin.y])).fill(face.color)
  }
}
