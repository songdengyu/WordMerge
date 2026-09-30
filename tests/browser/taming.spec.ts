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
  await page.goto('/'); edit(save)
  save.data.motion = { version: 1, position: { ...save.data.cell } }
  await page.evaluate(async value => {
    const db = await new Promise<IDBDatabase>(resolve => { const req = indexedDB.open('wordmerge-survival', 1); req.onsuccess = () => resolve(req.result) })
    const tx = db.transaction('snapshots', 'readwrite'); tx.objectStore('snapshots').put(value, 'current'); tx.objectStore('snapshots').put(value.revision, 'revision')
    await new Promise<void>(resolve => { tx.oncomplete = () => resolve() }); db.close()
  }, save)
  await page.goto('/?game=survival'); await ready(page)
}
async function tapCompanion(page: Page) {
  const target = await page.getByTestId('camp-scene').evaluate(element => {
    const host = element as HTMLElement, [cx, cy, zoom] = host.dataset.camera!.split(',').map(Number)
    const [x, y] = host.dataset.companionPosition!.split(',').map(Number), rect = host.getBoundingClientRect()
    return { x: rect.x + cx + (x - y) * 32 * zoom, y: rect.y + cy + ((x + y) * 16 - 18) * zoom }
  })
  await page.touchscreen.tap(target.x, target.y)
  await expect(page.getByTestId('companion-wheel')).toBeVisible()
}
async function command(page: Page, name: string) {
  // The button is clipped to a wedge; use the visible label, never the wheel's centre.
  await page.getByTestId('companion-wheel').getByRole('button', { name, exact: true }).locator('span').click()
}

test('native material bubble scales, tames over two seconds, then companion taps open the radial commands', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto('/?game=survival'); await ready(page)
  const bubble = page.getByTestId('taming-bubble'), game = page.getByTestId('survival-game')
  await expect(bubble).toHaveAttribute('data-ready', 'true')
  await expect(bubble).toHaveAttribute('data-renderer', 'pixi')
  const before = (await bubble.boundingBox())!
  await page.getByRole('button', { name: '放大地图' }).click()
  await expect.poll(async () => (await bubble.boundingBox())!.width).toBeGreaterThan(before.width * 1.1)
  await page.screenshot({ path: 'test-results/taming-bubble.png' })
  await tapSceneControl(page, bubble)
  await expect(game).toHaveAttribute('data-activity', 'taming')
  await expect(game).toHaveAttribute('data-protected', 'true')
  await expect(bubble).toHaveAttribute('data-phase', 'taming')
  await expect(game).toHaveAttribute('data-companion', 'active')
  await expect(bubble).toHaveCount(0)
  await tapCompanion(page)
  await expect(page.getByRole('heading', { name: '照护与守卫' })).toHaveCount(0)
  await expect(page.getByTestId('companion-wheel').getByRole('button', { name: '治疗', exact: true })).toBeDisabled()
  await page.screenshot({ path: 'test-results/companion-wheel.png' })
  for (const [label, mode] of [['跟随', 'follow'], ['休养', 'rest'], ['驻守', 'guard']]) {
    if (!await page.getByTestId('companion-wheel').isVisible()) await tapCompanion(page)
    await command(page, label)
    await expect(page.getByTestId('companion-wheel')).toHaveCount(0)
    await expect.poll(async () => (await readSave(page)).data.survival.companion.mode).toBe(mode)
  }
  await page.reload(); await ready(page)
  await tapCompanion(page)
  await expect(page.getByTestId('companion-wheel').getByRole('button', { name: '驻守', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.touchscreen.tap(20, 300)
  await expect(page.getByTestId('companion-wheel')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('missing food opens one persistent order and the ready warehouse order returns to the map to tame', async ({ page }) => {
  await page.goto('/?game=survival'); await ready(page)
  await page.getByTestId('vital-hunger').click()
  const bubble = page.getByTestId('taming-bubble'), order = page.getByTestId('taming-order')
  await expect(bubble).toHaveAttribute('data-ready', 'false')
  await tapSceneControl(page, bubble)
  await expect(order).toContainText('0/1')
  await page.getByRole('button', { name: '关闭合成' }).click()
  await tapSceneControl(page, bubble)
  await expect(order).toHaveCount(1)
  await ready(page); await page.reload(); await ready(page)
  await page.getByRole('button', { name: '合成物资' }).click()
  await expect(order).toHaveCount(1)
  await page.getByTestId('board-cell-2').click()
  await expect(order).toHaveAttribute('data-ready', 'true')
  await page.locator('[data-item-id="211"][data-lock="0"]').click()
  await page.getByRole('button', { name: '存入仓库' }).click()
  await expect(order).toContainText('1/1')
  await order.click()
  await expect(page.getByTestId('production-screen')).toHaveCount(0)
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-companion', 'active')
  await ready(page)
  const saved = await readSave(page)
  expect(saved.data.production.inventory.warehouse[0]).toBeNull()
  expect(saved.data.survival.taming).toEqual({ ordered: false, job: null })
})

test('partially finished taming pauses in background and survives refresh without another food deduction', async ({ page }) => {
  await page.goto('/?game=survival'); await ready(page)
  await page.clock.install(); await page.clock.pauseAt(await page.evaluate(() => Date.now() + 50))
  await tapSceneControl(page, page.getByTestId('taming-bubble')); await page.clock.runFor(500)
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-activity', 'taming')
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide'))); await ready(page)
  const saved = await readSave(page)
  await page.clock.runFor(5000)
  expect((await readSave(page)).data.survival.taming).toEqual(saved.data.survival.taming)
  await page.reload(); await ready(page)
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide'))); await page.clock.runFor(50)
  expect((await readSave(page)).data.survival.taming).toEqual(saved.data.survival.taming)
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow'))); await page.clock.runFor(2100)
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-companion', 'active')
  await ready(page)
  expect((await readSave(page)).data.production.inventory).toEqual(saved.data.production.inventory)
})

test('injured companion commands are disabled, radial treatment consumes medicine and recovery continues behind it on a small phone', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 })
  await seed(page, save => {
    Object.assign(save.data.survival.companion, { status: 'injured', hp: 0 })
    const id = save.data.production.inventory.board[9].instanceId
    save.data.production.inventory.items[id].itemId = 232
  })
  await tapCompanion(page)
  for (const name of ['休养', '驻守', '跟随']) await expect(page.getByTestId('companion-wheel').getByRole('button', { name, exact: true })).toBeDisabled()
  await page.screenshot({ path: 'test-results/companion-wheel-small.png' })
  await command(page, '治疗')
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-companion', 'recovering')
  await tapCompanion(page)
  await expect(page.getByTestId('companion-wheel').getByRole('button', { name: '治疗', exact: true })).toBeDisabled()
  await ready(page); expect((await readSave(page)).data.production.inventory.board[9].instanceId).toBeNull()
  const remaining = (await readSave(page)).data.survival.companion.recoveryRemaining
  await page.clock.install(); await page.clock.runFor(3000)
  await ready(page)
  expect((await readSave(page)).data.survival.companion.recoveryRemaining).toBeLessThan(remaining - 1)
  await expect(page.getByTestId('companion-wheel').getByRole('button', { name: '休养', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: '关闭指令盘' }).click()
  await page.reload(); await ready(page)
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-companion', 'recovering')
})

test('treatment with missing medicine reports the resource and keeps the wheel open', async ({ page }) => {
  await seed(page, save => Object.assign(save.data.survival.companion, { status: 'active', hp: 100 }))
  await tapCompanion(page); await command(page, '治疗')
  await expect(page.getByTestId('companion-wheel').getByRole('status')).toContainText('草药绷带')
  await expect(page.getByTestId('companion-wheel')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('companion-wheel')).toHaveCount(0)
})
