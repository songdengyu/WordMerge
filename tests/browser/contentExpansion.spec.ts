import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { tapSceneControl } from './sceneControls'

test.use({ baseURL: process.env.WORDMERGE_GAME_URL ?? 'http://127.0.0.1:5178' })
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
async function seed(page: Page, edit: (save: any) => void, old = false) {
  await page.goto('/'); await ready(page)
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide'))); await ready(page)
  const save = old ? JSON.parse(readFileSync('tests/fixtures/pre-content-expansion.json', 'utf8')) : await readSave(page)
  await page.goto('/?game=legacy'); edit(save)
  await page.evaluate(async value => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('wordmerge-survival', 1); r.onsuccess = () => resolve(r.result) })
    const tx = db.transaction('snapshots', 'readwrite'), store = tx.objectStore('snapshots')
    store.put(value, 'current'); store.put(value.revision, 'revision'); store.delete('backup')
    await new Promise<void>(resolve => { tx.oncomplete = () => resolve() }); db.close()
  }, save)
  await page.goto('/'); await ready(page)
}
function house(save: any, id: string, origin = { x: 7, y: 2 }) {
  const wallHp = id === 'rose-manor' ? 60 : id === 'cedar-home' ? 40 : 20
  const parts = Object.fromEntries(Object.entries({ foundation: 100, walls: wallHp, door: 100, roof: 120, bed: 80 })
    .map(([key, hp]) => [key, { built: true, hp, xpGranted: true }]))
  const product = ({ 'meadow-hut': 'meadow-blueprint', 'cedar-home': 'cedar-blueprint', 'rose-manor': 'manor-blueprint' } as Record<string, string>)[id]
  if (product) { save.data.economy.purchases.push(product); save.data.construction.unlockedBlueprints.push(id) }
  save.data.construction.buildings = [{ id: 'b1', blueprintId: id, origin, rotation: 0, parts }]
  save.data.construction.nextId = 2; save.data.construction.xp = 70
}
async function walk(page: Page, cell: { x: number; y: number }) {
  const scene = page.getByTestId('camp-scene'), [x, y, zoom] = (await scene.getAttribute('data-camera'))!.split(',').map(Number)
  const box = (await scene.boundingBox())!
  await page.touchscreen.tap(box.x + x + (cell.x - cell.y) * 32 * zoom, box.y + y + (cell.x + cell.y) * 16 * zoom)
}

test('old save opens, new chain merges and new collections buy, equip, cancel, place and persist on narrow mobile', async ({ page }) => {
  test.setTimeout(60_000)
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message))
  await page.setViewportSize({ width: 320, height: 568 })
  await seed(page, save => {
    save.data.production.inventory.gold = 1500
    const inv = save.data.production.inventory
    for (const n of [7, 8]) inv.items[inv.board[n].instanceId].itemId = 203
    house(save, 'cabin', { x: 7, y: 10 })
  }, true)
  expect((await readSave(page)).data.production.inventory.gold).toBe(1500)
  await page.getByRole('button', { name: '合成物资' }).click()
  const a = (await page.getByTestId('board-cell-7').boundingBox())!, b = (await page.getByTestId('board-cell-8').boundingBox())!
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page.mouse.down()
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 10 }); await page.mouse.up()
  await expect(page.getByTestId('board-cell-8')).toHaveAttribute('data-item-id', '204')
  await page.screenshot({ path: 'test-results/content-merge.png' })
  await page.getByRole('button', { name: '返回营地', exact: true }).click()
  await page.getByRole('button', { name: '商店', exact: true }).click()
  await page.getByRole('button', { name: '图纸', exact: true }).click()
  await page.getByTestId('buy-cedar-blueprint').click()
  await expect(page.getByTestId('product-cedar-blueprint')).toHaveAttribute('data-owned', 'true')
  await page.screenshot({ path: 'test-results/content-blueprints.png' })
  await page.getByTestId('shop').getByRole('button', { name: '装饰', exact: true }).click()
  await page.getByTestId('buy-chair').click(); await page.getByTestId('buy-chair').click()
  await page.getByTestId('buy-flowerstand').click()
  await page.getByTestId('buy-sofa').scrollIntoViewIfNeeded()
  await page.screenshot({ path: 'test-results/content-furniture.png' })
  await page.getByRole('button', { name: '衣裳', exact: true }).click()
  await page.getByTestId('buy-meadow').click(); await page.getByTestId('buy-rain').click(); await page.getByTestId('buy-starlight').click()
  await page.screenshot({ path: 'test-results/content-outfits.png' })
  await page.getByRole('button', { name: '打开装饰收藏' }).click()
  await expect(page.getByTestId('decor-count-chair')).toHaveText('2')
  await page.getByRole('button', { name: '人物皮肤', exact: true }).click()
  for (const [name, id] of [['晴日园丁', 'meadow'], ['雨后漫步', 'rain'], ['星月长裙', 'starlight']]) {
    await page.getByRole('button', { name: new RegExp(name) }).click()
    await expect(page.getByTestId('camp-scene')).toHaveAttribute('data-outfit', id)
  }
  await page.getByRole('button', { name: '摆件', exact: true }).click()
  await page.getByTestId('decor-stock-chair').getByRole('button', { name: '摆放' }).click()
  await page.getByTestId('decoration-placement').getByRole('button', { name: '取消', exact: true }).click()
  await page.getByRole('button', { name: '装饰', exact: true }).click()
  await expect(page.getByTestId('decor-count-chair')).toHaveText('2')
  await page.getByTestId('decor-stock-chair').getByRole('button', { name: '摆放' }).click()
  await page.getByRole('button', { name: '确认摆放', exact: true }).click()
  await expect(page.getByTestId('camp-scene')).toHaveAttribute('data-decorations', '1')
  await ready(page); await page.reload(); await ready(page)
  const saved = (await readSave(page)).data
  expect(saved.progression.decorStock.chair).toBe(1); expect(saved.progression.decorations[0].kind).toBe('chair')
  expect(saved.progression.outfit).toBe('starlight'); expect(saved.construction.unlockedBlueprints).toContain('cedar-home')
  expect(saved.production.inventory.gold).toBe(730); expect(saved.production.inventory.gems).toBe(72)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320)
  expect(errors).toEqual([])
})

test('new cedar blueprint completes all five construction groups through scene bubbles', async ({ page }) => {
  test.setTimeout(70_000)
  await seed(page, save => {
    save.data.production.inventory.gold = 400
    const inv = save.data.production.inventory
    for (const itemId of [204, 204, 204, 203, 204, 203]) {
      const index = inv.board.findIndex((slot: any) => !slot.instanceId && slot.lock === 0), id = `i${inv.nextId++}`
      inv.items[id] = { id, itemId, location: { kind: 'board', index }, reservedBy: null }; inv.board[index].instanceId = id
    }
  })
  await page.getByRole('button', { name: '商店', exact: true }).click()
  await page.getByRole('button', { name: '图纸', exact: true }).click()
  await page.getByTestId('buy-cedar-blueprint').click()
  await expect(page.getByTestId('buy-cedar-blueprint')).toHaveText('放置图纸')
  await page.getByTestId('buy-cedar-blueprint').click()
  await expect(page.getByTestId('placement-status')).toContainText('可以安家')
  await page.getByRole('button', { name: '确认放置', exact: true }).click()
  for (const part of ['foundation', 'walls', 'door', 'roof', 'bed']) {
    const bubble = page.getByTestId(`build-bubble-b1:${part}`)
    await expect(bubble).toHaveAttribute('data-ready', 'true')
    await tapSceneControl(page, bubble)
    await expect(page.getByTestId('survival-game')).toHaveAttribute('data-activity', 'building', { timeout: 12_000 })
    await expect(bubble).toHaveCount(0, { timeout: 8000 })
  }
  await ready(page)
  const data = (await readSave(page)).data
  expect(data.construction.xp).toBe(70)
  expect(Object.values(data.construction.buildings[0].parts).every((p: any) => p.built)).toBe(true)
  await page.screenshot({ path: 'test-results/content-cedar-built.png' })
  await page.reload(); await ready(page)
  expect((await readSave(page)).data.construction.xp).toBe(70)
})

for (const id of ['meadow-hut', 'cedar-home', 'rose-manor']) test(`${id} renders opaque pitched roof and hides it on entry`, async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message))
  const [width, height] = id === 'rose-manor' ? [5, 4] : id === 'cedar-home' ? [4, 3] : [3, 2]
  const doorX = 7 + Math.floor(width / 2)
  const outside = { x: doorX, y: 2 + height + 1 }, inside = { x: doorX, y: 2 + height - 1 }
  await seed(page, save => {
    house(save, id); save.data.cell = outside; save.data.motion = { version: 1, position: outside }
    save.data.progression.ownedOutfits.push('meadow'); save.data.progression.outfit = 'meadow'; save.data.economy.purchases.push('meadow')
  })
  const scene = page.getByTestId('camp-scene')
  await expect(scene).toHaveAttribute('data-visible-roofs', 'b1')
  await page.screenshot({ path: `test-results/content-${id}-outside.png` })
  await walk(page, inside)
  await expect(scene).toHaveAttribute('data-visible-roofs', '', { timeout: 10_000 })
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-activity', 'idle')
  await page.screenshot({ path: `test-results/content-${id}-inside.png` })
  expect(errors).toEqual([])
})
