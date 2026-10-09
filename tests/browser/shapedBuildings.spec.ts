import { test, expect, type Page } from '@playwright/test'
import type { Blueprint } from '../../src/game/buildingConfig'
import type { Building, Rotation } from '../../src/game/construction'
import { tapSceneControl } from './sceneControls'

test.use({ baseURL: process.env.WORDMERGE_GAME_URL ?? 'http://127.0.0.1:5178' })
const localToWorld = (b: Building, c: { x: number; y: number }) => {
  const [x, y] = [[c.x, c.y], [-c.y, c.x], [-c.x, -c.y], [c.y, -c.x]][b.rotation]
  return { x: b.origin.x + x, y: b.origin.y + y }
}
async function catalog(page: Page) {
  await page.goto('/'); await ready(page)
  return page.evaluate(async () => {
    const path = '/src/game/buildingConfig.ts', economyPath = '/src/game/economyConfig.ts'
    const b = await import(path), e = await import(economyPath)
    return { blueprints: b.BLUEPRINTS as Blueprint[], before: e.PRE_SHAPES_ECONOMY_VERSION, after: e.ECONOMY_VERSION }
  })
}
async function ready(page: Page) {
  await expect(page.getByTestId('camp-scene')).toHaveAttribute('data-ready', 'true')
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-save-state', 'saved')
}
async function readSave(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('wordmerge-survival', 1); r.onsuccess = () => resolve(r.result) })
    try { return await new Promise<any>(resolve => { const r = db.transaction('snapshots').objectStore('snapshots').get('current'); r.onsuccess = () => resolve(r.result) }) }
    finally { db.close() }
  })
}
async function seed(page: Page, edit: (save: any) => void) {
  await page.goto('/'); await ready(page)
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide'))); await ready(page)
  const save = await readSave(page); await page.goto('/?game=legacy'); edit(save)
  await page.evaluate(async value => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('wordmerge-survival', 1); r.onsuccess = () => resolve(r.result) })
    const tx = db.transaction('snapshots', 'readwrite'), store = tx.objectStore('snapshots')
    store.put(value, 'current'); store.put(value.revision, 'revision'); store.delete('backup')
    await new Promise<void>(resolve => { tx.oncomplete = () => resolve() }); db.close()
  }, save)
  await page.goto('/'); await ready(page)
  await expect(page.getByTestId('camp-scene')).toHaveAttribute('data-regions', save.data.progression.unlockedRegions.join(','))
}
async function tap(page: Page, cell: { x: number; y: number }) {
  const scene = page.getByTestId('camp-scene'), [x, y, zoom] = (await scene.getAttribute('data-camera'))!.split(',').map(Number)
  const box = (await scene.boundingBox())!
  await page.touchscreen.tap(box.x + x + (cell.x - cell.y) * 32 * zoom, box.y + y + (cell.x + cell.y) * 16 * zoom)
}
function house(bp: Blueprint, rotation: Rotation): Building {
  const parts: Building['parts'] = {}
  for (const config of bp.parts) {
    parts[config.id] = { built: true, hp: config.hp, xpGranted: true }
  }
  // Every rotation occupies the same clear rectangle at x7..11 / y2..6.
  const origin = [{ x: 7, y: 2 }, { x: 10, y: 2 }, { x: 7 + bp.width - 1, y: 5 }, { x: 7, y: 2 + bp.width - 1 }][rotation]
  return { id: 'b1', blueprintId: bp.id, origin, rotation, parts }
}

test('prior save upgrades, shaped blueprints purchase and corner house builds through real bubbles', async ({ page }) => {
  test.setTimeout(90_000)
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message))
  const config = await catalog(page)
  await seed(page, save => {
    save.data.economy.version = config.before
    save.data.survival.spawnRemaining = 160
    const inv = save.data.production.inventory; inv.gold = 1000; inv.gems = 100
    for (const itemId of config.blueprints.find(b => b.id === 'forest-corner')!.parts.flatMap(p => p.materials)) {
      const index = inv.board.findIndex((slot: any) => !slot.instanceId && slot.lock === 0), id = `i${inv.nextId++}`
      inv.items[id] = { id, itemId, location: { kind: 'board', index }, reservedBy: null }; inv.board[index].instanceId = id
    }
  })
  expect((await readSave(page)).data.economy.version).toBe(config.after)
  await page.screenshot({ path: 'test-results/forest-camp-noon.png' })
  await page.getByRole('button', { name: '商店', exact: true }).click()
  await page.getByRole('button', { name: '图纸', exact: true }).click()
  await page.getByTestId('buy-corner-blueprint').click(); await page.getByTestId('buy-court-blueprint').click()
  await page.screenshot({ path: 'test-results/forest-shaped-shop.png' })
  await page.getByTestId('buy-corner-blueprint').click()
  await expect(page.getByTestId('placement-status')).toContainText('可以安家')
  await page.screenshot({ path: 'test-results/forest-corner-preview.png' })
  await page.getByRole('button', { name: '确认放置', exact: true }).click()
  for (const part of ['foundation', 'walls', 'door', 'roof', 'bed']) {
    const bubble = page.getByTestId(`build-bubble-b1:${part}`)
    await expect(bubble).toHaveAttribute('data-ready', 'true')
    await tapSceneControl(page, bubble)
    await expect(page.getByTestId('survival-game')).toHaveAttribute('data-activity', 'building', { timeout: 12_000 })
    await expect(bubble).toHaveCount(0, { timeout: 8000 })
  }
  await ready(page); await page.reload(); await ready(page)
  const saved = (await readSave(page)).data
  expect(saved.construction.xp).toBe(70)
  expect(saved.production.inventory.gold).toBe(680); expect(saved.production.inventory.gems).toBe(55)
  expect(saved.construction.buildings[0].parts.foundation.segments).toHaveProperty('tile1-3')
  expect(saved.construction.buildings[0].parts.foundation.segments).not.toHaveProperty('tile2-3')
  expect(errors).toEqual([])
})

for (const id of ['forest-corner', 'flower-court']) for (const rotation of [0, 1, 2, 3] as Rotation[]) {
  test(`${id} orientation ${rotation} keeps the notch outdoors, opens its door and hides the roof inside`, async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message))
    const config = await catalog(page), bp = config.blueprints.find(b => b.id === id)!, b = house(bp, rotation), door = bp.parts.find(p => p.kind === 'door')!.edges[0]
    const outside = localToWorld(b, { x: door.from.x, y: door.to.y + 1 }), inside = localToWorld(b, door.from)
    await seed(page, save => {
      const d = save.data; d.survival.spawnRemaining = 160
      d.construction.buildings = [b]; d.construction.nextId = 2; d.construction.xp = 70
      d.construction.unlockedBlueprints.push(id); d.economy.purchases.push(id === 'forest-corner' ? 'corner-blueprint' : 'court-blueprint')
      // Remove foreground resource obstacles only in this isolated orientation fixture.
      d.economy.removedObjects = ['fire', 'r01', 'r02', 't04', 't09']
      d.cell = outside; d.motion = { version: 1, position: outside }
      d.economy.purchases.push('rug', 'planter', 'sofa'); d.progression.ownedDecor = ['rug', 'planter', 'sofa']
      d.progression.decorStock = { rug: 0, planter: 0, sofa: 0 }; d.progression.nextDecorationId = 4
      d.progression.decorations = [{ id: 'd1', kind: 'rug', buildingId: 'b1', cell: localToWorld(b, { x: 1, y: 1 }) },
        { id: 'd2', kind: 'planter', buildingId: 'b1', cell: localToWorld(b, { x: 0, y: 0 }) },
        { id: 'd3', kind: 'sofa', buildingId: 'b1', cell: localToWorld(b, { x: 1, y: 0 }) }]
    })
    await page.clock.install(); await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000))
    const scene = page.getByTestId('camp-scene')
    await expect(scene).toHaveAttribute('data-visible-roofs', 'b1')
    await page.screenshot({ path: `test-results/forest-${id}-${rotation}-outside.png` })
    await tap(page, inside); await page.clock.runFor(3000)
    await expect(scene).toHaveAttribute('data-visible-roofs', '')
    await expect(page.getByTestId('survival-game')).toHaveAttribute('data-player', `${inside.x},${inside.y}`)
    expect(JSON.parse((await scene.getAttribute('data-door-amounts'))!)['b1:door:whole']).toBe(1)
    await page.screenshot({ path: `test-results/forest-${id}-${rotation}-inside.png` })
    await tap(page, outside); await page.clock.runFor(3000)
    await expect(scene).toHaveAttribute('data-visible-roofs', 'b1')
    expect(JSON.parse((await scene.getAttribute('data-door-amounts'))!)['b1:door:whole']).toBe(0)
    expect(errors).toEqual([])
  })
}

for (const [region, cell] of [['brook', { x: 7, y: -5 }], ['grove', { x: 24, y: 7 }]] as const) test(`${region} scenery retains day, dusk, deep night and light on narrow screens`, async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 })
  const config = await catalog(page), cabin = house(config.blueprints.find(b => b.id === 'cabin')!, 0)
  await seed(page, save => {
    save.data.construction.buildings = [cabin]; save.data.construction.nextId = 2
    save.data.construction.xp = 70; save.data.progression.unlockedRegions = [region]
    save.data.cell = cell; save.data.motion = { version: 1, position: cell }; save.data.survival.spawnRemaining = 160
  })
  await page.screenshot({ path: `test-results/forest-${region}-noon.png` })
  for (const label of ['黄昏', '深夜']) {
    await page.getByRole('button', { name: '测试', exact: true }).click()
    await page.getByRole('button', { name: '时间与天气' }).click()
    await page.getByRole('region', { name: '时间与天气测试' }).getByRole('button', { name: label, exact: true }).click()
    await page.getByRole('button', { name: '关闭天候测试' }).click()
    await page.screenshot({ path: `test-results/forest-${region}-${label}.png` })
  }
  await page.getByTestId('torch-button').click(); await expect(page.getByTestId('torch-button')).toHaveAttribute('data-lit', 'true')
  await page.screenshot({ path: `test-results/forest-${region}-torch.png` })
})

test('courtyard decoration rejects the notch, hides the roof during placement and preserves a damaged tile across reload', async ({ page }) => {
  const config = await catalog(page), bp = config.blueprints.find(b => b.id === 'flower-court')!, b = house(bp, 0)
  await seed(page, save => {
    const d = save.data; d.survival.spawnRemaining = 160
    d.cell = { x: 9, y: 5 }; d.motion = { version: 1, position: d.cell }
    d.construction.buildings = [b]; d.construction.nextId = 2; d.construction.xp = 70
    d.construction.unlockedBlueprints.push('flower-court'); d.economy.purchases.push('court-blueprint', 'rug')
    d.progression.ownedDecor = ['rug']; d.progression.decorStock = { rug: 1 }
    b.parts.roof.hp = 0; b.parts.roof.segments = Object.fromEntries(bp.cells!.map(c => [`tile${c.x}-${c.y}`, c.x === 1 && c.y === 0 ? 0 : 120]))
  })
  const scene = page.getByTestId('camp-scene')
  await expect(scene).toHaveAttribute('data-visible-roofs', 'b1')
  await page.screenshot({ path: 'test-results/forest-court-damaged-roof.png' })
  await page.getByRole('button', { name: '装饰', exact: true }).click()
  await page.getByTestId('decor-stock-rug').getByRole('button', { name: '摆放', exact: true }).click()
  await expect(scene).toHaveAttribute('data-visible-roofs', '')
  await tap(page, { x: 9, y: 5 })
  await expect(page.getByTestId('decoration-placement')).toContainText('请放在已建成的木屋地板上')
  await expect(page.getByRole('button', { name: '确认摆放', exact: true })).toBeDisabled()
  await tap(page, { x: 8, y: 3 })
  await page.getByRole('button', { name: '确认摆放', exact: true }).click()
  await expect(scene).toHaveAttribute('data-decorations', '1')
  await expect(scene).toHaveAttribute('data-visible-roofs', 'b1')
  await ready(page); await page.reload(); await ready(page)
  const saved = (await readSave(page)).data
  expect(saved.progression.decorStock.rug).toBe(0)
  expect(saved.progression.decorations[0].cell).toEqual({ x: 8, y: 3 })
  expect(saved.construction.buildings[0].parts.roof.segments['tile1-0']).toBe(0)
  expect(saved.construction.buildings[0].parts.roof.segments['tile0-0']).toBe(120)
})
