import { readFileSync } from 'node:fs'
import { test, expect, type Page } from '@playwright/test'
import { tapSceneControl } from './sceneControls'

async function ready(page: Page) {
  await expect(page.getByTestId('camp-scene')).toHaveAttribute('data-ready', 'true')
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-save-state', 'saved')
}
async function save(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('wordmerge-survival', 1); r.onsuccess = () => resolve(r.result) })
    try { return await new Promise<any>(resolve => { const r = db.transaction('snapshots').objectStore('snapshots').get('current'); r.onsuccess = () => resolve(r.result) }) }
    finally { db.close() }
  })
}
async function focus(page: Page, cell: { x: number; y: number }) {
  const scene = page.getByTestId('camp-scene'), box = (await scene.boundingBox())!
  for (let i = 0; i < 12; i++) {
    const [x, y, z] = (await scene.getAttribute('data-camera'))!.split(',').map(Number)
    const dx = box.width / 2 - (x + (cell.x - cell.y) * 32 * z)
    const dy = box.height * .45 - (y + (cell.x + cell.y) * 16 * z)
    if (Math.hypot(dx, dy) < 20) break
    const px = box.x + box.width / 2, py = box.y + box.height * .45
    await page.mouse.move(px, py); await page.mouse.down()
    await page.mouse.move(px + Math.max(-120, Math.min(120, dx)), py + Math.max(-120, Math.min(120, dy)), { steps: 5 })
    await page.mouse.up(); await page.waitForTimeout(80)
  }
}

test('nine chunks start with eight clouded regions; only the four adjacent signs are shown', async ({ page }) => {
  test.setTimeout(60_000)
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message))
  await page.setViewportSize({ width: 320, height: 640 })
  await page.goto('/'); await ready(page)
  const scene = page.getByTestId('camp-scene')
  expect((await scene.getAttribute('data-fog-regions'))!.split(',')).toHaveLength(8)
  await expect(page.locator('[data-testid^="region-sign-"]')).toHaveCount(4)
  await page.screenshot({ path: 'test-results/map-nine-camp-320.png' })
  await focus(page, { x: -9, y: -8 })
  await page.screenshot({ path: 'test-results/map-nine-clouds-320.png' })
  await expect(page.locator('[data-testid^="region-sign-mist-"]')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('old save upgrades, sign opens new land, clouds clear and the expansion survives reload', async ({ page }) => {
  test.setTimeout(60_000)
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message))
  await page.goto('/'); await ready(page)
  const old = JSON.parse(readFileSync('tests/fixtures/pre-map-expansion.json', 'utf8'))
  const data = old.data
  data.cell = { x: 0, y: 7 }; data.motion = { version: 1, position: data.cell }
  data.construction.buildings = [{ x: 7, y: 10 }, { x: 7, y: 3 }, { x: 11, y: 7 }].map((origin, i) => {
    const parts = Object.fromEntries(Object.entries({ foundation: 100, walls: 20, door: 100, roof: 120, bed: 80 })
      .map(([id, hp]) => [id, { built: true, hp, xpGranted: true }]))
    return { id: `b${i + 1}`, blueprintId: 'cabin', origin, rotation: 0, parts }
  })
  data.construction.xp = 210; data.construction.nextId = 4
  data.production.inventory.gold = 321; data.production.inventory.gems = 123
  await page.goto('/?game=legacy')
  await page.evaluate(async value => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('wordmerge-survival', 1); r.onsuccess = () => resolve(r.result) })
    const tx = db.transaction('snapshots', 'readwrite'), store = tx.objectStore('snapshots')
    store.put(value, 'current'); store.put(value.revision, 'revision'); store.delete('previous')
    await new Promise<void>(resolve => { tx.oncomplete = () => resolve() }); db.close()
  }, old)
  await page.goto('/'); await ready(page)
  const scene = page.getByTestId('camp-scene')
  expect((await save(page)).data.production.inventory).toMatchObject({ gold: 321, gems: 123 })
  await tapSceneControl(page, page.getByTestId('region-sign-meadow-east'))
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-activity', 'unlocking')
  await expect(scene).toHaveAttribute('data-regions', 'meadow')
  await expect(page.locator('[data-testid^="region-sign-meadow-"]')).toHaveCount(0)
  expect((await scene.getAttribute('data-fog-regions'))!.split(',')).not.toContain('meadow')
  await expect(page.getByTestId('region-sign-mist-south')).toHaveCount(1)
  await expect(page.getByTestId('region-sign-flower-north')).toHaveCount(1)
  await focus(page, { x: -9, y: 8 })
  await page.screenshot({ path: 'test-results/map-nine-meadow-open.png' })
  await ready(page); await page.reload(); await ready(page)
  expect((await scene.getAttribute('data-fog-regions'))!.split(',')).toHaveLength(7)
  const restored = (await save(page)).data
  expect(restored.progression.unlockedRegions).toEqual(['meadow'])
  expect(restored.construction.buildings).toHaveLength(3)
  expect(restored.production.inventory).toMatchObject({ gold: 321, gems: 123 })
  expect(errors).toEqual([])
})
