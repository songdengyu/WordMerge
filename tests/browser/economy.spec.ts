import { test, expect, type Page } from '@playwright/test'
import { tapSceneControl } from './sceneControls'

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
async function seed(page: Page, axe: boolean) {
  await page.goto('/?game=survival'); await ready(page)
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide'))); await ready(page)
  const save = await readSave(page)
  await page.goto('/?game=legacy')
  save.data.cell = { x: 5, y: 6 }; save.data.motion = { version: 1, position: { x: 5, y: 6 } }
  save.data.production.inventory.gold = 300
  if (axe) { const inv = save.data.production.inventory; inv.items[inv.board[9].instanceId].itemId = 252 }
  await page.evaluate(async value => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('wordmerge-survival', 1); r.onsuccess = () => resolve(r.result) })
    const tx = db.transaction('snapshots', 'readwrite'); tx.objectStore('snapshots').put(value, 'current'); tx.objectStore('snapshots').put(value.revision, 'revision')
    await new Promise<void>(resolve => { tx.oncomplete = () => resolve() }); db.close()
  }, save)
  await page.goto('/?game=survival'); await ready(page)
}
async function tapTree(page: Page) {
  const point = await page.getByTestId('camp-scene').evaluate(el => {
    const [cx, cy, zoom] = (el as HTMLElement).dataset.camera!.split(',').map(Number), rect = el.getBoundingClientRect()
    return { x: rect.x + cx + (4 - 6) * 32 * zoom, y: rect.y + cy + ((4 + 6) * 16 - 60) * zoom }
  })
  await page.touchscreen.tap(point.x, point.y)
}

test('tree bubble creates a focused tool order, shop grants a real generator once, purchases persist', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message))
  await seed(page, false)
  await tapTree(page)
  const bubble = page.getByTestId('resource-bubble-t08')
  await expect(bubble).toHaveAttribute('data-ready', 'false')
  await tapSceneControl(page, bubble)
  await expect(page.getByTestId('resource-order-t08')).toHaveAttribute('data-current', 'true')
  await page.getByRole('button', { name: '关闭合成' }).click()
  await page.getByRole('button', { name: '商店', exact: true }).click()
  await page.getByTestId('buy-starter-tools').click()
  await expect(page.getByTestId('product-starter-tools')).toHaveAttribute('data-owned', 'true')
  await page.getByTestId('buy-garden-blueprint').click()
  await expect(page.getByTestId('shop-gold')).toHaveText('150')
  await page.getByRole('button', { name: '衣裳', exact: true }).click()
  await page.getByTestId('buy-rose').click()
  await expect(page.getByTestId('shop-gems')).toHaveText('88')
  await page.getByTestId('buy-rose').click()
  await page.getByRole('button', { name: '人物皮肤', exact: true }).click()
  await page.getByRole('button', { name: /蔷薇旧衫/ }).click()
  await expect(page.getByRole('button', { name: /蔷薇旧衫/ })).toHaveAttribute('aria-pressed', 'true')
  await page.screenshot({ path: 'test-results/economy-shop.png' })
  await ready(page); await page.reload(); await ready(page)
  const saved = await readSave(page)
  expect(saved.data.economy.purchases).toEqual(['starter-tools', 'garden-blueprint', 'rose'])
  expect(Object.values(saved.data.production.inventory.items).filter((i: any) => i.itemId === 141)).toHaveLength(1)
  expect(saved.data.progression.outfit).toBe('rose')
  await page.setViewportSize({ width: 320, height: 568 })
  await page.getByRole('button', { name: '商店', exact: true }).click()
  await page.getByTestId('buy-rose').scrollIntoViewIfNeeded()
  await expect(page.getByTestId('buy-rose')).toBeVisible()
  expect(await page.getByTestId('shop').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/economy-shop-small.png' })
  expect(errors).toEqual([])
})

test('tree clears after two protected seconds, consumes its tool once and saves rewards', async ({ page }) => {
  await seed(page, true)
  await page.clock.install(); await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000))
  await tapTree(page)
  await page.clock.runFor(50)
  const bubble = page.getByTestId('resource-bubble-t08'), game = page.getByTestId('survival-game')
  await expect(bubble).toHaveAttribute('data-ready', 'true')
  await page.screenshot({ path: 'test-results/economy-tree.png' })
  await tapSceneControl(page, bubble); await page.clock.runFor(100)
  await expect(game).toHaveAttribute('data-activity', 'clearing')
  await expect(game).toHaveAttribute('data-protected', 'true')
  await page.clock.runFor(1000)
  await expect(bubble).toHaveAttribute('data-phase', 'clearing')
  await page.clock.runFor(1100)
  await expect(bubble).toHaveCount(0)
  await expect(page.getByText(/清理完成：金币/)).toBeVisible()
  await ready(page)
  const saved = await readSave(page)
  expect(saved.data.economy.removedObjects).toEqual(['t08'])
  expect(saved.data.production.inventory.gold).toBe(325)
  expect(saved.data.production.inventory.gems).toBe(101)
  expect(Object.values(saved.data.production.inventory.items).filter((i: any) => i.itemId === 252)).toHaveLength(0)
  await page.reload(); await ready(page)
  expect((await readSave(page)).data.production.inventory).toEqual(saved.data.production.inventory)
  await expect(bubble).toHaveCount(0)
})
