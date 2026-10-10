import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { BLUEPRINTS } from './buildingConfig'
import { createBuildingParts } from './buildingSegments'
import { GameRuntime } from './GameRuntime'
import { progressedWorld, validateProgressionCatalog } from './progression'
import { REGIONS, REGION_EXTENSIONS } from './progressionConfig'
import { EXPANSION_REGIONS } from './mapExpansionConfig'
import { EXPANDED_PROGRESSION_VERSION, EXPANDED_WORLD_VERSION, PRE_EXPANSION_PROGRESSION_VERSION } from './migrations/mapExpansion'
import { regionGates, requestRegionUnlock } from './regionUnlock'
import { configVersion, validateSave, type SaveEnvelope } from './saveData'
import { fingerprint } from './productionConfig'
import { ECONOMY_VERSION } from './economyConfig'
import { REGION_CONTENT_VERSION } from './regionContentConfig'
import { WorldMap } from './world'
import { dataFixture, envelopeFixture, productionFixture, testNow, worldFixture } from './testFixtures'

const world = worldFixture(), catalog = productionFixture()
const prior = () => JSON.parse(readFileSync('tests/fixtures/pre-map-expansion.json', 'utf8')) as SaveEnvelope
function developed() {
  const data = dataFixture(), blueprint = BLUEPRINTS[0]
  data.construction.buildings = [{ x: 7, y: 10 }, { x: 7, y: 3 }, { x: 11, y: 7 }].map((origin, i) => {
    const parts = createBuildingParts(blueprint)
    for (const p of blueprint.parts) {
      parts[p.id] = { ...parts[p.id], built: true, hp: p.hp, xpGranted: true }
      if (parts[p.id].segments) for (const id of Object.keys(parts[p.id].segments!)) parts[p.id].segments![id] = p.hp
    }
    return { id: `b${i + 1}`, blueprintId: 'cabin', origin, rotation: 0 as const, parts }
  })
  data.construction.xp = 210; data.construction.nextId = 4
  return data
}

describe('three by three map expansion', () => {
  it('configures exactly nine chunks around the camp, with four initially reachable boundaries', () => {
    expect(world.config.chunks).toHaveLength(9)
    expect(new Set(world.config.chunks.map(c => `${c.x},${c.y}`))).toEqual(new Set([-1, 0, 1].flatMap(y => [-1, 0, 1].map(x => `${x},${y}`))))
    expect(world.config.chunks.filter(c => c.unlocked).map(c => c.id)).toEqual(['camp'])
    expect(REGIONS.filter(r => regionGates(world, r.id).some(g => world.isWalkable(g.workCell))).map(r => r.id)).toEqual(['brook', 'grove', 'meadow', 'fern'])
    expect(fingerprint(JSON.stringify(world.config))).toBe(EXPANDED_WORLD_VERSION)
    expect(configVersion(world, catalog).split('-')[5]).toBe(EXPANDED_PROGRESSION_VERSION)
    validateProgressionCatalog(world, catalog)
  })

  it('leaves each interior gateway reachable and all sixty new resources on land', () => {
    const expanded = new WorldMap(world.config, REGIONS.map(r => r.id), REGION_EXTENSIONS)
    for (const region of EXPANSION_REGIONS) {
      expect(expanded.isWalkable(region.point)).toBe(true)
      const objects = expanded.allObjects().filter(o => expanded.chunkAt(o)?.id === region.id)
      expect(objects).toHaveLength(10)
      for (const object of objects) expect(['grass', 'path']).toContain(expanded.terrainAt(object))
      for (const gate of regionGates(expanded, region.id)) if (expanded.chunkAt(gate.workCell)) expect(expanded.isWalkable(gate.workCell)).toBe(true)
    }
  })

  it('upgrades a real previous save without changing inventory, time, progress or repeatedly awarding anything', () => {
    const old = prior(), before = structuredClone(old)
    const upgraded = validateSave(old, world, catalog)
    const expected = structuredClone(old.data)
    expected.economy!.version = ECONOMY_VERSION
    expected.progression.regionContent.version = REGION_CONTENT_VERSION
    expect(upgraded.data).toEqual(expected)
    expect(upgraded.configVersion).toBe(configVersion(world, catalog))
    expect(validateSave(upgraded, world, catalog)).toEqual(upgraded)
    expect(old).toEqual(before)
    expect(upgraded.data.progression.unlockedRegions).toEqual([])
  })

  it('preserves existing buildings, unlocked land and an in-progress old gateway job', () => {
    const data = developed()
    data.progression.unlockedRegions = ['brook']
    data.cell = { x: 15, y: 7 }; data.motion = { version: 1, position: data.cell }
    data.progression.regionUnlock = { regionId: 'grove', side: 'west', phase: 'unlocking', workCell: data.cell, remaining: 1.1 }
    const old = prior(); old.data = data
    const upgraded = validateSave(old, world, catalog)
    expect(upgraded.data.construction).toEqual(data.construction)
    expect(upgraded.data.progression.regionUnlock).toEqual(data.progression.regionUnlock)
    expect(upgraded.data.progression.unlockedRegions).toEqual(['brook'])
    expect(upgraded.data.production).toEqual(data.production)
    expect(validateSave(upgraded, world, catalog)).toEqual(upgraded)
  })

  it('rejects invented new unlocks under an old version and unknown map versions', () => {
    const forged = prior(); forged.data = developed(); forged.data.progression.unlockedRegions = ['meadow']
    expect(() => validateSave(forged, world, catalog)).toThrow('旧版区域来源')
    const unknown = prior(); unknown.configVersion = unknown.configVersion.replace('cc0401b', 'ffffffff')
    expect(() => validateSave(unknown, world, catalog)).toThrow('不匹配')
    const current = envelopeFixture(developed()); current.data.progression.unlockedRegions = ['meadow']
    current.configVersion = current.configVersion.replace(EXPANDED_PROGRESSION_VERSION, PRE_EXPANSION_PROGRESSION_VERSION)
    expect(() => validateSave(current, world, catalog)).toThrow('旧版区域来源')
  })

  it('unlocks new negative-coordinate land via the existing protected two-second workflow and saves it', async () => {
    const data = developed(); data.cell = { x: 0, y: 7 }; data.motion = { version: 1, position: data.cell }
    const runtime = new GameRuntime(world, { catalog, saved: envelopeFixture(data), now: () => testNow })
    let frame = 0; runtime.advanceFrame(frame)
    const pump = (seconds: number) => { for (let i = 0; i < Math.round(seconds * 20); i++) runtime.advanceFrame(frame += 50) }
    const command = runtime.dispatch({ type: 'region-unlock', regionId: 'meadow', side: 'east' }); pump(.1)
    expect(await command).toMatchObject({ accepted: true })
    expect(runtime.getSaveData().progression.regionUnlock?.phase).toBe('unlocking')
    expect(runtime.getUiSnapshot().protected).toBe(true)
    pump(1); expect(runtime.getSaveData().progression.unlockedRegions).not.toContain('meadow')
    pump(1.1)
    const saved = validateSave(JSON.parse(runtime.exportSave()), world, catalog)
    expect(saved.data.progression.unlockedRegions).toEqual(['meadow'])
    expect(saved.data.construction.xp).toBe(210)
    expect(runtime.world.isWalkable({ x: -1, y: 7 })).toBe(true)
    expect(runtime.world.isWalkable({ x: -9, y: -8 })).toBe(false)
    const map = progressedWorld(world, saved.data.progression)
    expect(requestRegionUnlock(saved.data.progression, saved.data.construction, map, { x: -9, y: 0 }, false,
      { type: 'region-unlock', regionId: 'mist', side: 'south' })).toMatchObject({ accepted: true })
    expect(validateSave(saved, world, catalog)).toEqual(saved)
  })
})
