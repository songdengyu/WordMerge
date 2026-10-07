import { describe, expect, it } from 'vitest'
import { GameRuntime, type GameCommand } from './GameRuntime'
import { BLUEPRINTS } from './buildingConfig'
import { dataFixture, envelopeFixture, productionFixture, testNow, worldFixture } from './testFixtures'
import { validateSave } from './saveData'
import { CHAPTERS } from './progressionConfig'

const world = worldFixture(), catalog = productionFixture()
function harness(data = dataFixture()) {
  const runtime = new GameRuntime(world, { catalog, saved: envelopeFixture(data), now: () => testNow })
  let time = 0; runtime.advanceFrame(0)
  const send = async (command: GameCommand) => { const result = runtime.dispatch(command); runtime.advanceFrame(time += 50); return result }
  const saved = () => validateSave(JSON.parse(runtime.exportSave()), world, catalog).data
  return { runtime, send, saved }
}
function ready() {
  const data = dataFixture(); data.production.inventory.gold = 600
  data.construction.buildings = [{ id: 'b1', blueprintId: 'cabin', origin: { x: 7, y: 10 }, rotation: 0,
    parts: Object.fromEntries(BLUEPRINTS[0].parts.map(p => [p.id, { built: true, hp: p.hp, xpGranted: true }])) }]
  data.construction.nextId = 2; data.construction.xp = 70
  return data
}
describe('decoration stock and individual placements', () => {
  it('buys multiple copies, places two independently, moves without cost and returns exactly one on removal', async () => {
    const h = harness(ready())
    for (let i = 0; i < 3; i++) expect(await h.send({ type: 'shop-buy', productId: 'rug' })).toMatchObject({ accepted: true })
    expect(h.saved().production.inventory.gold).toBe(420)
    expect(h.saved().economy!.purchases).toEqual(['rug'])
    expect(h.saved().progression.decorStock).toEqual({ rug: 3 })
    await h.send({ type: 'decor-place', kind: 'rug', cell: { x: 8, y: 10 } })
    await h.send({ type: 'decor-place', kind: 'rug', cell: { x: 9, y: 10 } })
    expect(h.saved().progression.decorStock).toEqual({ rug: 1 })
    expect(h.saved().progression.decorations.map(d => d.id)).toEqual(['d1', 'd2'])
    expect(await h.send({ type: 'decor-place', kind: 'rug', cell: { x: 8, y: 10 } })).toMatchObject({ accepted: false })
    expect(h.saved().progression.decorStock).toEqual({ rug: 1 })
    await h.send({ type: 'decor-place', kind: 'rug', decorationId: 'd1', cell: { x: 8, y: 11 } })
    expect(h.saved().progression.decorStock).toEqual({ rug: 1 })
    const restored = harness(h.saved())
    expect(await restored.send({ type: 'decor-remove', kind: 'rug', decorationId: 'd1' })).toMatchObject({ accepted: true })
    expect(restored.saved().progression.decorStock).toEqual({ rug: 2 })
    expect(restored.saved().progression.decorations.map(d => d.id)).toEqual(['d2'])
    expect(await restored.send({ type: 'decor-remove', kind: 'rug', decorationId: 'd1' })).toMatchObject({ accepted: false })
    expect(restored.saved().progression.decorStock).toEqual({ rug: 2 })
  })
  it('rejects insufficient stock or currency and keeps skins permanently reusable', async () => {
    const data = ready(); data.production.inventory.gold = 60
    const h = harness(data)
    await h.send({ type: 'shop-buy', productId: 'rug' })
    expect(await h.send({ type: 'shop-buy', productId: 'rug' })).toMatchObject({ accepted: false })
    await h.send({ type: 'decor-place', kind: 'rug', cell: { x: 8, y: 10 } })
    expect(await h.send({ type: 'decor-place', kind: 'rug', cell: { x: 9, y: 10 } })).toMatchObject({ accepted: false })
    expect(h.saved().progression.decorStock).toEqual({ rug: 0 })
    await h.send({ type: 'shop-buy', productId: 'rose' })
    expect(await h.send({ type: 'shop-buy', productId: 'rose' })).toMatchObject({ accepted: false })
    for (const outfitId of ['rose', 'clay', 'rose']) expect(await h.send({ type: 'outfit-equip', outfitId })).toMatchObject({ accepted: true })
    expect(h.saved().production.inventory.gems).toBe(88)
  })
  it('adds a story gift to purchased stock once', async () => {
    const h = harness(ready()); await h.send({ type: 'shop-buy', productId: 'rug' })
    for (const chapter of CHAPTERS.slice(0, 2)) {
      await h.runtime.dispatch({ type: 'story-open', chapterId: chapter.id })
      for (let i = 0; i < chapter.lines.length - 1; i++) await h.runtime.dispatch({ type: 'story-next', chapterId: chapter.id, line: i })
      expect(await h.runtime.dispatch({ type: 'story-choice', chapterId: chapter.id, choiceId: chapter.choices[0].id })).toMatchObject({ accepted: true })
    }
    expect(h.saved().progression.decorStock).toEqual({ rug: 2 })
    expect(await h.runtime.dispatch({ type: 'story-choice', chapterId: 'foundation', choiceId: CHAPTERS[1].choices[0].id })).toMatchObject({ accepted: false })
    expect(h.saved().progression.decorStock).toEqual({ rug: 2 })
  })
  it('migrates old unique decor without duplicating placed stock or removing the old placement', async () => {
    const h = harness(ready()); await h.send({ type: 'shop-buy', productId: 'rug' }); await h.send({ type: 'shop-buy', productId: 'planter' })
    await h.send({ type: 'decor-place', kind: 'rug', cell: { x: 8, y: 10 } })
    const old = envelopeFixture(h.saved())
    delete old.data.progression.decorStock; delete old.data.progression.nextDecorationId
    old.data.progression.decorations.forEach(d => { delete d.id })
    const migrated = validateSave(old, world, catalog)
    expect(migrated.data.progression.decorStock).toEqual({ rug: 0, planter: 1 })
    expect(migrated.data.progression.decorations[0]).toMatchObject({ id: 'd1', cell: { x: 8, y: 10 } })
    expect(validateSave(migrated, world, catalog)).toEqual(migrated)
  })
  it('rejects malformed stock and duplicate placement identities in saved data', async () => {
    const h = harness(ready()); await h.send({ type: 'shop-buy', productId: 'rug' }); await h.send({ type: 'shop-buy', productId: 'rug' })
    await h.send({ type: 'decor-place', kind: 'rug', cell: { x: 8, y: 10 } }); await h.send({ type: 'decor-place', kind: 'rug', cell: { x: 9, y: 10 } })
    for (const value of [-1, 1.5, NaN]) {
      const bad = envelopeFixture(h.saved()); bad.data.progression.decorStock!.rug = value
      expect(() => validateSave(bad, world, catalog)).toThrow('摆件库存')
    }
    const bad = envelopeFixture(h.saved()); bad.data.progression.decorations[1].id = 'd1'
    expect(() => validateSave(bad, world, catalog)).toThrow('摆件实例')
  })
})
