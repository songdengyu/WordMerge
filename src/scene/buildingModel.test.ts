import { describe, expect, it } from 'vitest'
import { BLUEPRINTS, blueprintCells } from '../game/buildingConfig'
import { buildingModel, completeModelBuilding, modelToObj, normal3, project3, visibleModelFaces } from './buildingModel'
import { createBuildingParts, setSegmentHp } from '../game/buildingSegments'
import { localToWorld, type Rotation } from '../game/construction'
import { gridToWorld } from './camera'

describe('XYZ building meshes', () => {
  for (const rotation of [0, 1, 2, 3] as Rotation[]) it(`projects solid walls/floors/roofs consistently at rotation ${rotation}`, () => {
    for (const blueprint of BLUEPRINTS) {
      const building = { ...completeModelBuilding(blueprint), rotation }, mesh = buildingModel(building, blueprint)
      expect(mesh.length).toBeGreaterThan(0)
      expect(visibleModelFaces(mesh).length).toBeGreaterThan(0)
      expect(mesh.flatMap(f => f.vertices).every(v => Object.values(v).every(Number.isFinite))).toBe(true)
      for (const face of mesh) expect(Math.hypot(...Object.values(normal3(face.vertices)))).toBeCloseTo(1)
      for (const cell of blueprintCells(blueprint)) expect(project3({ ...localToWorld(building, cell), z: 0 })).toEqual(gridToWorld(localToWorld(building, cell)))
      expect(mesh.filter(f => f.partId === 'walls').some(f => normal3(f.vertices).z > .9)).toBe(true)
      expect(mesh.filter(f => f.partId === 'foundation').flatMap(f => f.vertices).some(v => v.z < 0)).toBe(true)
    }
  })
  it('preserves concave cutouts and excludes destroyed segments without changing neighboring geometry', () => {
    for (const blueprint of BLUEPRINTS.filter(b => b.cells)) {
      const building = completeModelBuilding(blueprint)
      const allowed = new Set(blueprintCells(blueprint).map(c => `tile${c.x}-${c.y}`))
      const full = buildingModel(building, blueprint)
      expect(full.filter(f => ['foundation', 'roof'].includes(f.partId)).every(f => allowed.has(f.segmentId))).toBe(true)
      building.parts = createBuildingParts(blueprint)
      for (const part of blueprint.parts) {
        const p = building.parts[part.id]; p.built = true; p.hp = part.hp
        if (p.segments) for (const id of Object.keys(p.segments)) p.segments[id] = part.hp
      }
      setSegmentHp(building.parts.roof, 'tile0-0', 0)
      setSegmentHp(building.parts.walls, 'edge0', 0)
      const damaged = buildingModel(building, blueprint)
      expect(damaged.filter(f => f.partId === 'roof' && f.segmentId === 'tile0-0')).toEqual([])
      expect(damaged.filter(f => f.partId === 'walls' && f.segmentId === 'edge0')).toEqual([])
      const neighborTop = (mesh: typeof full) => mesh.filter(f => f.partId === 'roof' && f.segmentId === 'tile1-0' && normal3(f.vertices).z > .1)
      expect(neighborTop(damaged)).toEqual(neighborTop(full))
    }
  })
  it('exports actual XYZ faces with a material library', () => {
    const mesh = buildingModel(completeModelBuilding(BLUEPRINTS[0]), BLUEPRINTS[0]), obj = modelToObj(mesh)
    expect(obj).toContain('mtllib materials.mtl')
    expect(obj.split('\n').filter(l => l.startsWith('f '))).toHaveLength(mesh.length)
    expect(new Set(mesh.flatMap(f => f.vertices.map(v => v.z))).size).toBeGreaterThan(3)
  })
})
