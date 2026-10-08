import { test, expect, type Page } from '@playwright/test'
import { tapSceneControl } from './sceneControls'

async function ready(page: Page) {
  await expect(page.getByTestId('camp-scene')).toHaveAttribute('data-ready', 'true')
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-save-state', 'saved')
}
async function readSave(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const req = indexedDB.open('wordmerge-survival', 1); req.onsuccess = () => resolve(req.result) })
    try { return await new Promise<any>(resolve => { const req = db.transaction('snapshots').objectStore('snapshots').get('current'); req.onsuccess = () => resolve(req.result) }) }
    finally { db.close() }
  })
}
async function seed(page: Page, edit: (save: any) => void) {
  await page.goto('/?game=survival'); await ready(page)
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide'))); await ready(page)
  const save = await readSave(page)
  await page.goto('/?game=legacy'); edit(save)
  save.data.motion = { version: 1, position: { ...save.data.cell } }
  await page.evaluate(async value => {
    const db = await new Promise<IDBDatabase>(resolve => { const req = indexedDB.open('wordmerge-survival', 1); req.onsuccess = () => resolve(req.result) })
    const tx = db.transaction('snapshots', 'readwrite'); tx.objectStore('snapshots').put(value, 'current'); tx.objectStore('snapshots').put(value.revision, 'revision')
    await new Promise<void>(resolve => { tx.oncomplete = () => resolve() }); db.close()
  }, save)
  await page.goto('/?game=survival'); await ready(page)
}

test('wild animal bubble creates a targeted order and recruits an additional controllable companion', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await seed(page, save => {
    save.data.survival.companion.status = 'active'
    save.data.survival.spawnRemaining = 160
    save.data.survival.enemies = [{ id: 'e1', kind: 'boar', hp: 70, cell: { x: 8, y: 9 }, route: [], progress: 0,
      target: null, cooldown: 0, roaming: true, tameable: true }]
    save.data.survival.nextEnemyId = 2
  })
  const bubble = page.getByTestId('taming-bubble-e1')
  await expect(bubble).toHaveAttribute('data-ready', 'false')
  await tapSceneControl(page, bubble)
  await expect(page.getByTestId('taming-order')).toContainText('驯服野猪')
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide'))); await ready(page)
  const ordered = await readSave(page)
  expect(ordered.data.survival.taming.targetId).toBe('e1')
  // Supply a real inventory item while the game is unloaded; all recruitment remains real UI input.
  await page.goto('/?game=legacy')
  ordered.data.production.inventory.items[ordered.data.production.inventory.board[9].instanceId].itemId = 213
  await page.evaluate(async value => {
    const db = await new Promise<IDBDatabase>(resolve => { const req = indexedDB.open('wordmerge-survival', 1); req.onsuccess = () => resolve(req.result) })
    const tx = db.transaction('snapshots', 'readwrite'); tx.objectStore('snapshots').put(value, 'current')
    await new Promise<void>(resolve => { tx.oncomplete = () => resolve() }); db.close()
  }, ordered)
  await page.goto('/'); await ready(page)
  await expect(bubble).toHaveAttribute('data-ready', 'true')
  await page.screenshot({ path: 'test-results/wild-taming-bubble.png' })
  await tapSceneControl(page, bubble)
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-activity', 'taming')
  await expect(page.getByTestId('camp-scene')).toHaveAttribute('data-recruits', /e1/)
  await expect(bubble).toHaveCount(0)
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-companion', 'active')
  const target = await page.getByTestId('camp-scene').evaluate(element => {
    const host = element as HTMLElement, [cx, cy, zoom] = host.dataset.camera!.split(',').map(Number)
    const { x, y } = JSON.parse(host.dataset.recruits!)[0], rect = host.getBoundingClientRect()
    return { x: rect.x + cx + (x - y) * 32 * zoom, y: rect.y + cy + ((x + y) * 16 - 18) * zoom }
  })
  await page.touchscreen.tap(target.x, target.y)
  await page.getByRole('combobox', { name: '选择伙伴' }).selectOption('e1')
  const wheel = page.getByRole('dialog', { name: '野猪指令盘' })
  await expect(wheel).toBeVisible()
  await page.screenshot({ path: 'test-results/recruited-boar-wheel.png' })
  await wheel.getByRole('button', { name: '移动', exact: true }).locator('span').click()
  await expect(page.getByTestId('companion-control')).toContainText('正在操控野猪')
  const destination = await page.getByTestId('camp-scene').evaluate(element => {
    const host = element as HTMLElement, [cx, cy, zoom] = host.dataset.camera!.split(',').map(Number), rect = host.getBoundingClientRect()
    return { x: rect.x + cx, y: rect.y + cy + 320 * zoom } // (10,10)
  })
  await page.touchscreen.tap(destination.x, destination.y)
  await expect.poll(async () => JSON.parse((await page.getByTestId('camp-scene').getAttribute('data-recruits'))!)[0]).toMatchObject({ id: 'e1', x: 10, y: 10 })
  await page.getByRole('button', { name: '取消操控' }).click()
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide'))); await ready(page)
  const saved = await readSave(page)
  expect(saved.data.survival.recruits).toHaveLength(1)
  expect(saved.data.survival.companion.status).toBe('active')
  await page.reload(); await ready(page)
  await expect(page.getByTestId('camp-scene')).toHaveAttribute('data-recruits', /e1/)
  expect(errors).toEqual([])
})

test('daytime spawn stays outside the actual camera with the live mobile camera', async ({ page }) => {
  await seed(page, save => { save.data.survival.spawnRemaining = .05 })
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide'))); await ready(page)
  const save = await readSave(page)
  expect(save.data.survival.enemies).toHaveLength(1)
  const animal = save.data.survival.enemies[0]
  const visible = await page.getByTestId('camp-scene').evaluate((element, cell) => {
    const host = element as HTMLElement, [cx, cy, zoom] = host.dataset.camera!.split(',').map(Number)
    const p = { x: cx + (cell.x - cell.y) * 32 * zoom, y: cy + (cell.x + cell.y) * 16 * zoom }
    return p.x >= 0 && p.x <= host.clientWidth && p.y >= 0 && p.y <= host.clientHeight
  }, animal.cell)
  expect(visible).toBe(false)
  expect(animal.roaming).toBe(true)
})
