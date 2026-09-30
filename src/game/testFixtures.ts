import { readFileSync } from 'node:fs'
import { parseProductionConfig } from './productionConfig'
import { parseWorld } from './world'
import { configVersion, type RuntimeData, type SaveEnvelope } from './saveData'
import { createProduction } from './inventory'
import { createConstruction } from './construction'
import { createSurvival } from './survival'
import { createProgression } from './progression'

export const testNow = 1_800_000_000_000
export function productionFixture() {
  return parseProductionConfig(['items.csv', 'initial-board.csv', 'effects.csv', 'orders.csv']
    .map(name => readFileSync(`public/config/survival/merge/${name}`, 'utf8')))
}
export function worldFixture() { return parseWorld(JSON.parse(readFileSync('public/config/survival/world.json', 'utf8'))) }
export function dataFixture(): RuntimeData {
  return { elapsedSeconds: 0, cell: { x: 7, y: 9 }, progress: 0, route: [], destination: null, searching: false,
    production: createProduction(productionFixture(), testNow), construction: createConstruction(), survival: createSurvival(worldFixture()), progression: createProgression() }
}
export function envelopeFixture(data = dataFixture()): SaveEnvelope {
  return { schemaVersion: 4, configVersion: configVersion(worldFixture(), productionFixture()), revision: 0, savedAt: testNow, data }
}
export function tamingDataFixture(): RuntimeData {
  const data = dataFixture(), inv = data.production.inventory
  inv.items[inv.board[9].instanceId!].itemId = 213
  return data
}
