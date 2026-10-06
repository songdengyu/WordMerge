import { test, expect, type Page } from '@playwright/test'

async function ready(page: Page) {
  await expect(page.getByTestId('camp-scene')).toHaveAttribute('data-ready', 'true')
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-save-state', 'saved')
}
async function readSave(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('wordmerge-survival', 1)
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error)
    })
    try { return await new Promise<any>((resolve, reject) => {
      const request = db.transaction('snapshots').objectStore('snapshots').get('current')
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error)
    }) } finally { db.close() }
  })
}
async function seed(page: Page, edit: (save: any) => void) {
  await page.goto('/?game=survival'); await ready(page)
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')))
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-save-state', 'saved')
  const save = await readSave(page)
  await page.goto('/?game=legacy'); edit(save)
  await page.evaluate(async value => {
    const db = await new Promise<IDBDatabase>(resolve => { const req = indexedDB.open('wordmerge-survival', 1); req.onsuccess = () => resolve(req.result) })
    const tx = db.transaction('snapshots', 'readwrite')
    tx.objectStore('snapshots').put(value, 'current'); tx.objectStore('snapshots').put(value.revision, 'revision')
    await new Promise<void>(resolve => { tx.oncomplete = () => resolve() }); db.close()
  }, save)
  await page.goto('/?game=survival'); await ready(page)
}

test('status taps consume board and warehouse supplies once, full and missing states preserve inventory', async ({ page }) => {
  await page.goto('/?game=survival'); await ready(page)
  await page.getByTestId('vital-water').click()
  await expect(page.getByTestId('vital-water')).toHaveAttribute('data-value', '80')
  await page.getByTestId('vital-water').click()
  await expect(page.getByRole('status')).toContainText('没有可用的一杯饮水')
  await expect(page.getByTestId('production-screen')).toHaveCount(0)
  expect((await readSave(page)).data.production.supplyOrders).toEqual([])
  await page.getByRole('button', { name: '合成物资' }).click()
  const workshop = page.getByTestId('production-screen')
  await workshop.getByTestId('board-cell-9').click()
  await workshop.getByRole('button', { name: '存入仓库', exact: true }).click()
  await workshop.getByTestId('board-cell-4').click()
  await page.getByRole('button', { name: '关闭合成' }).click()
  await page.getByTestId('vital-hunger').click()
  await expect(page.getByTestId('vital-hunger')).toHaveAttribute('data-value', /69|70/)
  const before = (await readSave(page)).data.production
  expect(before.inventory.warehouse[0]).toBeNull()
  await page.getByTestId('vital-hp').click()
  await expect(page.getByRole('status')).toContainText('生命已充足')
  expect((await readSave(page)).data.production.inventory.items).toEqual(before.inventory.items)
  await page.reload(); await ready(page)
  const after = (await readSave(page)).data.production
  expect(after.inventory.board[9].instanceId).toBeNull()
  expect(after.inventory.board[10].instanceId).toBeNull()
  expect(after.inventory.warehouse[0]).toBeNull()
})

test('danger badges use stock or create persistent deduplicated orders that consume generated supplies', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await seed(page, save => {
    save.data.production.vitals = { hp: 29, hunger: 18, water: 18, temperature: 50 }
    const inventory = save.data.production.inventory
    delete inventory.items[inventory.board[9].instanceId]; inventory.board[9].instanceId = null
  })
  await expect(page.getByTestId('vital-supply-water')).toHaveAttribute('data-ready', 'true')
  await expect(page.getByTestId('vital-supply-hunger')).toHaveAttribute('data-ready', 'false')
  const filter = await page.getByTestId('vital-supply-hunger').locator('svg').first().evaluate(el => getComputedStyle(el).filter)
  expect(filter).toContain('brightness(0)')
  await page.screenshot({ path: 'test-results/quick-supply-map.png' })
  await page.getByTestId('vital-supply-water').click()
  await expect(page.getByTestId('vital-supply-water')).toHaveCount(0)
  await expect(page.getByTestId('vital-water')).toHaveAttribute('data-value', '38')
  await page.getByTestId('vital-supply-hunger').click()
  const workshop = page.getByTestId('production-screen')
  await expect(workshop).toBeVisible()
  await expect(workshop.getByTestId('supply-order-hunger')).toHaveAttribute('data-ready', 'false')
  await workshop.getByTestId('vital-supply-hunger').click()
  await expect(workshop.getByTestId('supply-order-hunger')).toHaveCount(1)
  await workshop.getByTestId('vital-supply-hp').click()
  await expect(workshop.getByTestId('supply-order-hp')).toBeVisible()
  await workshop.getByRole('button', { name: '取消生命补给订单' }).click()
  await expect(workshop.getByTestId('supply-order-hp')).toHaveCount(0)
  await page.reload(); await ready(page)
  expect((await readSave(page)).data.production.supplyOrders).toEqual([{ stat: 'hunger', itemId: 211 }])
  await page.getByRole('button', { name: '合成物资' }).click()
  const gold = (await readSave(page)).data.production.inventory.gold
  await workshop.getByTestId('board-cell-2').click()
  await expect(workshop.getByTestId('supply-order-hunger')).toHaveAttribute('data-ready', 'true')
  await expect(workshop.getByTestId('vital-supply-hunger')).toHaveAttribute('data-ready', 'true')
  await page.screenshot({ path: 'test-results/quick-supply-order.png' })
  await workshop.getByTestId('supply-order-hunger').click()
  await expect(workshop.getByTestId('supply-order-hunger')).toHaveCount(0)
  await expect(workshop.getByTestId('vital-supply-hunger')).toHaveCount(0)
  await expect(workshop.getByTestId('vital-hunger')).toHaveAttribute('data-value', /27|28/)
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-save-state', 'saved')
  expect((await readSave(page)).data.production.inventory.gold).toBe(gold)
  expect(errors).toEqual([])
})

test('small-screen care badges close the dialog and open the supply order', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 })
  await seed(page, save => { save.data.production.vitals = { hp: 25, hunger: 15, water: 15, temperature: 50 } })
  await page.screenshot({ path: 'test-results/quick-supply-small-map.png' })
  await page.getByRole('button', { name: '伙伴与生存' }).click()
  const care = page.getByRole('dialog')
  await care.getByTestId('vital-supply-hp').click()
  await expect(care).toHaveCount(0)
  const workshop = page.getByTestId('production-screen')
  await expect(workshop.getByTestId('supply-order-hp')).toBeVisible()
  await workshop.getByTestId('vital-supply-hunger').click()
  await expect(workshop.getByTestId('vital-supply-hunger')).toHaveCount(0)
  await page.screenshot({ path: 'test-results/quick-supply-small-workshop.png' })
  const bounds = await workshop.boundingBox()
  const cell = await workshop.getByTestId('board-cell-0').boundingBox()
  expect(bounds!.width).toBe(320)
  // The existing small-screen board retains 27px cells and scrolls all nine rows.
  expect(cell!.width).toBeGreaterThanOrEqual(27)
  await workshop.getByTestId('board-scroll').evaluate(el => { el.scrollTop = el.scrollHeight })
  await expect(workshop.getByTestId('board-cell-62')).toBeInViewport()
  await workshop.getByRole('button', { name: '取消生命补给订单' }).click()
  await expect(workshop.getByTestId('supply-order-hp')).toHaveCount(0)
})
