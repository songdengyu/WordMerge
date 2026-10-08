import { describe, expect, it } from 'vitest'
import { configVersion, validateSave } from './saveData'
import { parseWorld } from './world'
import { createSurvival, worldMinutes } from './survival'
import { dataFixture, envelopeFixture, productionFixture, worldFixture } from './testFixtures'

const world = worldFixture(), catalog = productionFixture()
describe('ten-minute days', () => {
  it('runs a full day in 600 seconds and reaches first night after 175 seconds', () => {
    expect(world.config.dayDurationSeconds).toBe(600)
    expect(worldMinutes(world, 600) - worldMinutes(world, 0)).toBe(1440)
    expect(worldMinutes(world, 175)).toBe(19 * 60)
  })
  it.each([350, 900, 3400])('preserves calendar and state when migrating %s old elapsed seconds', elapsed => {
    const oldWorld = parseWorld({ ...world.config, dayDurationSeconds: 1200 }), data = dataFixture()
    data.elapsedSeconds = elapsed; data.survival = createSurvival(oldWorld, elapsed)
    data.survival.spawnRemaining = 37; data.production.stamina.value = 140
    const old = envelopeFixture(data); old.configVersion = configVersion(oldWorld, catalog)
    const before = structuredClone(old), migrated = validateSave(old, world, catalog)
    expect(worldMinutes(world, migrated.data.elapsedSeconds)).toBe(worldMinutes(oldWorld, elapsed))
    expect(migrated.data).toEqual({ ...data, elapsedSeconds: elapsed / 2 })
    expect(old).toEqual(before)
    expect(validateSave(migrated, world, catalog)).toEqual(migrated)
  })
})
