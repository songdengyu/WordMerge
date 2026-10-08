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
async function writeSave(page: Page, save: any) {
  await page.goto('/?game=legacy')
  await page.evaluate(async value => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('wordmerge-survival', 1); r.onsuccess = () => resolve(r.result) })
    const tx = db.transaction('snapshots', 'readwrite'), store = tx.objectStore('snapshots')
    store.put(value, 'current'); store.put(value.revision, 'revision'); store.delete('backup')
    await new Promise<void>(resolve => { tx.oncomplete = () => resolve() }); db.close()
  }, save)
  await page.goto('/'); await ready(page)
}
async function tapObject(page: Page, cell: { x: number; y: number }, height: number) {
  const scene = page.getByTestId('camp-scene'), [x, y, zoom] = (await scene.getAttribute('data-camera'))!.split(',').map(Number)
  const box = (await scene.boundingBox())!
  await page.touchscreen.tap(box.x + x + (cell.x - cell.y) * 32 * zoom, box.y + y + ((cell.x + cell.y) * 16 - height) * zoom)
}
async function merge(page: Page, from: number, to: number, expected: number) {
  const a = (await page.getByTestId(`board-cell-${from}`).boundingBox())!, b = (await page.getByTestId(`board-cell-${to}`).boundingBox())!
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page.mouse.down()
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 10 }); await page.mouse.up()
  await expect(page.getByTestId(`board-cell-${to}`)).toHaveAttribute('data-item-id', String(expected))
}

test('old grove gains its floor and statue; actual higher-tool merges dismantle the statue and show diamonds once', async ({ page }) => {
  test.setTimeout(60_000)
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto('/'); await ready(page)
  const old = JSON.parse(readFileSync('tests/fixtures/pre-grove-tools.json', 'utf8'))
  const data = old.data
  data.cell = { x: 24, y: 8 }; data.motion = { version: 1, position: { ...data.cell } }
  data.progression.unlockedRegions = ['grove']; data.progression.regionContent.initialized = ['grove']
  data.construction = { unlockedBlueprints: ['cabin'], nextId: 3, xp: 70, orders: [], jobs: [], buildings: [
    { id: 'b1', blueprintId: 'cabin', origin: { x: 7, y: 10 }, rotation: 0,
      parts: Object.fromEntries(Object.entries({ foundation: 100, walls: 20, door: 100, roof: 120, bed: 80 }).map(([id, hp]) => [id, { built: true, hp, xpGranted: true }])) },
    { id: 'b2', blueprintId: 'lodge', origin: { x: 25, y: 3 }, rotation: 0,
      parts: Object.fromEntries(['foundation', 'walls', 'door', 'roof', 'bed'].map(id => [id, { built: false, hp: 0, xpGranted: false }])) },
  ] }
  for (const index of [7, 8, 9, 10]) data.production.inventory.items[data.production.inventory.board[index].instanceId].itemId = 262
  await writeSave(page, old)
  const upgraded = await readSave(page), statue = upgraded.data.progression.regionContent.statue
  expect(upgraded.data.construction.xp).toBe(90)
  expect(upgraded.data.construction.buildings[1].parts.foundation.built).toBe(true)
  await expect(page.getByTestId('build-bubble-b2:foundation')).toHaveCount(0)
  await expect(page.getByTestId('build-bubble-b2:walls')).toHaveCount(1)
  await page.screenshot({ path: 'test-results/grove-statue-foundation.png' })
  await tapObject(page, statue, 40)
  const bubble = page.getByTestId('resource-bubble-grove-statue')
  await expect(bubble).toHaveAttribute('data-ready', 'false')
  await expect(bubble).toHaveAccessibleName(/精工石镐/)
  await tapSceneControl(page, bubble)
  await expect(page.getByTestId('resource-order-grove-statue')).toHaveAttribute('data-current', 'true')
  await merge(page, 7, 8, 263); await merge(page, 9, 10, 263); await merge(page, 8, 10, 264)
  await page.screenshot({ path: 'test-results/grove-tool-merge.png' })
  await page.getByRole('button', { name: '返回营地', exact: true }).click()
  await tapObject(page, statue, 40)
  await expect(bubble).toHaveAttribute('data-ready', 'true')
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-activity', 'idle')
  await page.clock.install(); await page.clock.pauseAt(await page.evaluate(() => Date.now() + 100))
  await tapSceneControl(page, bubble); await page.clock.runFor(150)
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-activity', 'clearing')
  await page.clock.runFor(1500)
  await expect(page.getByTestId('resource-drops')).toBeEmpty()
  await page.clock.runFor(1000)
  await expect(page.getByTestId('resource-drops')).toHaveText('钻石 +30')
  await expect(bubble).toHaveCount(0)
  await page.screenshot({ path: 'test-results/statue-diamond-drops.png' })
  await ready(page)
  const finished = await readSave(page)
  expect(finished.data.production.inventory.gems).toBe(130)
  expect(finished.data.economy.removedObjects).toContain('grove-statue')
  await page.clock.runFor(3000); await expect(page.getByTestId('resource-drops')).toBeEmpty()
  await page.reload(); await ready(page)
  expect((await readSave(page)).data.production.inventory.gems).toBe(130)
  await expect(page.getByTestId('resource-drops')).toBeEmpty()
  expect(errors).toEqual([])
})
