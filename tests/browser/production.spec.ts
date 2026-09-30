import { test, expect, type Page } from '@playwright/test'

async function enter(page: Page) {
  await page.goto('/?game=survival')
  await expect(page.getByTestId('camp-scene')).toHaveAttribute('data-ready', 'true')
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-save-state', 'saved')
}
async function openMerge(page: Page) {
  await page.getByRole('button', { name: '合成物资' }).click()
  await expect(page.getByTestId('production-screen')).toBeVisible()
}
async function drag(page: Page, from: number, to: number) {
  const start = (await page.getByTestId(`board-cell-${from}`).boundingBox())!
  const end = (await page.getByTestId(`board-cell-${to}`).boundingBox())!
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2)
  await page.mouse.down()
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 10 })
  await page.mouse.up()
}
async function readSave(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('wordmerge-survival', 1)
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error)
    })
    try {
      return await new Promise<any>((resolve, reject) => {
        const request = db.transaction('snapshots').objectStore('snapshots').get('current')
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error)
      })
    } finally { db.close() }
  })
}

test('generation costs stamina, merging uses unique items, warehouse use survives reload', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await enter(page); await openMerge(page)
  await expect(page.getByTestId('stamina-value')).toHaveText('100')
  await page.getByTestId('board-cell-0').click()
  await expect(page.getByTestId('stamina-value')).toHaveText('99')
  await drag(page, 7, 8)
  await expect(page.getByTestId('board-cell-8')).toHaveAttribute('data-item-id', '202')
  const plank = await page.getByTestId('board-cell-8').getAttribute('data-instance-id')
  await page.getByRole('button', { name: '存入仓库', exact: true }).click()
  await expect(page.getByTestId('board-cell-8')).toHaveAttribute('data-instance-id', '')
  await page.getByRole('button', { name: /▦ 仓库/ }).click()
  await expect(page.getByTestId('warehouse-cell-0')).toHaveAttribute('data-instance-id', plank!)
  await page.getByRole('button', { name: '关闭仓库' }).click()
  await page.getByTestId('board-cell-5').click()
  await page.getByRole('button', { name: '存入仓库', exact: true }).click()
  await page.getByRole('button', { name: /▦ 仓库/ }).click()
  await page.getByTestId('warehouse-cell-1').click()
  await page.getByRole('dialog', { name: '营地仓库' }).getByRole('button', { name: '使用', exact: true }).click()
  await expect(page.getByTestId('stamina-value')).toHaveText(/149|150/)
  await expect(page.getByTestId('warehouse-cell-1')).toHaveAttribute('data-instance-id', '')
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-save-state', 'saved')
  const before = await readSave(page)
  await page.reload(); await expect(page.getByTestId('camp-scene')).toHaveAttribute('data-ready', 'true')
  await openMerge(page)
  await expect(page.getByTestId('stamina-value')).toHaveText(String(before.data.production.stamina.value))
  await page.getByRole('button', { name: /▦ 仓库/ }).click()
  await expect(page.getByTestId('warehouse-cell-0')).toHaveAttribute('data-instance-id', plank!)
  await page.getByRole('button', { name: '关闭仓库' }).click()
  const boardBounds = (await page.getByTestId('board-scroll').boundingBox())!
  const lastCell = (await page.getByTestId('board-cell-62').boundingBox())!
  expect(lastCell.y + lastCell.height).toBeLessThanOrEqual(boardBounds.y + boardBounds.height + 1)
  await page.screenshot({ path: 'test-results/m2-workshop.png' })
  expect(errors).toEqual([])
})

test('warehouse pointer cancellation and invalid drops retain items; valid drag preserves identity', async ({ page, context }) => {
  await enter(page); await openMerge(page)
  await page.getByTestId('board-cell-7').click()
  const item = await page.getByTestId('board-cell-7').getAttribute('data-instance-id')
  await page.getByRole('button', { name: '存入仓库', exact: true }).click()
  await page.getByRole('button', { name: /▦ 仓库/ }).click()
  const source = (await page.getByTestId('warehouse-cell-0').boundingBox())!
  const cdp = await context.newCDPSession(page)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, x: source.x + source.width / 2, y: source.y + source.height / 2 }] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ id: 1, x: source.x + source.width / 2, y: source.y - 70 }] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
  await expect(page.getByTestId('warehouse-cell-0')).toHaveAttribute('data-instance-id', item!)
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2); await page.mouse.down()
  await page.mouse.move(30, 50, { steps: 10 }); await page.mouse.up()
  await expect(page.getByTestId('warehouse-cell-0')).toHaveAttribute('data-instance-id', item!)
  const dest = (await page.getByTestId('board-cell-7').boundingBox())!
  const currentSource = (await page.getByTestId('warehouse-cell-0').boundingBox())!
  await page.mouse.move(currentSource.x + currentSource.width / 2, currentSource.y + currentSource.height / 2); await page.mouse.down()
  await page.mouse.move(dest.x + dest.width / 2, dest.y + dest.height / 2, { steps: 10 }); await page.mouse.up()
  await expect(page.getByTestId('warehouse-cell-0')).toHaveAttribute('data-instance-id', '')
  await expect(page.getByTestId('board-cell-7')).toHaveAttribute('data-instance-id', item!)
})

test('the world continues behind merge; page suspension stops it while real stamina recovers', async ({ page }) => {
  await enter(page)
  const camera = (await page.getByTestId('camp-scene').getAttribute('data-camera'))!.split(',').map(Number)
  const box = (await page.getByTestId('camp-canvas').boundingBox())!
  await page.touchscreen.tap(box.x + camera[0] + (7 - 12) * 32 * camera[2], box.y + camera[1] + 19 * 16 * camera[2])
  await openMerge(page)
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-player', '7,12')
  await page.getByTestId('board-cell-0').click()
  await expect(page.getByTestId('stamina-value')).toHaveText('99')
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')))
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-paused', 'true')
  const time = await page.getByTestId('merge-clock').getAttribute('data-minute')
  // Wall time can advance without advancing RAF world simulation (simulates time spent away).
  await page.clock.setFixedTime(new Date(Date.now() + 30_000))
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow')))
  await expect(page.getByTestId('stamina-value')).toHaveText('100')
  expect(await page.getByTestId('merge-clock').getAttribute('data-minute')).toBe(time)
})

test('export/import restores a reviewed backup, invalid imports never replace current progress', async ({ page }) => {
  await enter(page); await openMerge(page)
  await page.getByTestId('board-cell-5').dblclick()
  await expect(page.getByTestId('stamina-value')).toHaveText('150')
  await page.getByRole('button', { name: '返回营地', exact: true }).click()
  await page.getByRole('button', { name: '设置', exact: true }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出备份', exact: true }).click()
  const file = await download
  const path = (await file.path())!
  await page.getByRole('button', { name: '关闭', exact: true }).click()
  await openMerge(page)
  await page.getByTestId('board-cell-0').click()
  await expect(page.getByTestId('stamina-value')).toHaveText('149')
  await page.getByRole('button', { name: '返回营地', exact: true }).click()
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.getByLabel('选择存档备份').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{') })
  await expect(page.getByRole('dialog')).toContainText('无法读取 JSON')
  await expect(page.getByTestId('map-stamina')).toHaveText('149')
  page.once('dialog', dialog => dialog.accept())
  await page.getByLabel('选择存档备份').setInputFiles(path)
  await expect(page.getByRole('dialog')).toContainText('备份已导入')
  await expect(page.getByTestId('map-stamina')).toHaveText('150')
  await page.reload()
  await expect(page.getByTestId('map-stamina')).toHaveText('150')
})

test('a competing tab is paused instead of overwriting the newer save', async ({ page, context }) => {
  await enter(page)
  // Keep this tab idle at a fixed paused world time, allowing the new tab to become the writer.
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')))
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-save-state', 'saved')
  const second = await context.newPage()
  await enter(second); await openMerge(second)
  await second.getByTestId('board-cell-5').dblclick()
  await expect(second.getByTestId('stamina-value')).toHaveText('150')
  await expect(second.getByTestId('survival-game')).toHaveAttribute('data-save-state', 'saved')
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow')))
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-save-state', 'conflict', { timeout: 6000 })
  await expect(page.getByRole('alert')).toContainText('另一页面')
  expect((await readSave(second)).data.production.stamina.value).toBe(150)
  await second.close()
})

test('a damaged current snapshot falls back to backup and preserves the recovery notice', async ({ page }) => {
  await enter(page); await openMerge(page)
  await page.getByTestId('board-cell-5').dblclick()
  await expect(page.getByTestId('stamina-value')).toHaveText('150')
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-save-state', 'saved')
  await page.getByTestId('board-cell-0').click()
  await expect(page.getByTestId('stamina-value')).toHaveText('149')
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-save-state', 'saved')
  await page.goto('/')
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('wordmerge-survival', 1); request.onsuccess = () => resolve(request.result) })
    const tx = db.transaction('snapshots', 'readwrite'), store = tx.objectStore('snapshots')
    const request = store.get('current')
    request.onsuccess = () => { const save = request.result; save.data.production.inventory.warehouse = ['missing']; store.put(save, 'current') }
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error) })
    db.close()
  })
  await enter(page)
  await expect(page.getByRole('status')).toContainText('已恢复上一份有效备份')
  await expect(page.getByTestId('map-stamina')).toHaveText(/149|150/)
})

test('small-screen workshop scrolls without clipping its close and warehouse controls', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 })
  await enter(page); await openMerge(page)
  await expect(page.getByRole('button', { name: '关闭合成' })).toBeInViewport()
  await expect(page.getByRole('button', { name: /▦ 仓库/ })).toBeInViewport()
  await page.screenshot({ path: 'test-results/m2-workshop-small.png' })
})

test('order delivery consumes both board and warehouse, grants once and stays completed after reload', async ({ page }) => {
  await enter(page); await openMerge(page)
  await drag(page, 7, 8)
  await expect(page.getByTestId('board-cell-8')).toHaveAttribute('data-item-id', '202')
  await page.getByTestId('board-cell-0').click(); await page.getByTestId('board-cell-0').click()
  await expect(page.locator('[data-board-cell][data-item-id="201"][data-lock="0"]')).toHaveCount(2)
  const woods = await page.locator('[data-board-cell][data-item-id="201"][data-lock="0"]').evaluateAll(elements => elements.map(element => Number(element.getAttribute('data-board-cell'))))
  await drag(page, woods[0], woods[1])
  await expect(page.getByTestId(`board-cell-${woods[1]}`)).toHaveAttribute('data-item-id', '202')
  await page.getByRole('button', { name: '存入仓库', exact: true }).click()
  await expect(page.getByTestId('order-1')).toContainText('交付领取')
  // Two same-ID requests in one event loop, before any leave animation or rerender.
  await page.getByTestId('order-1').evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click() })
  await expect(page.getByTestId('order-1')).toHaveCount(0)
  await expect(page.getByTestId('order-4')).toBeVisible()
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-save-state', 'saved')
  const saved = await readSave(page)
  expect(saved.data.production.inventory.completedOrders).toEqual([1])
  expect(saved.data.production.inventory.gems).toBe(110)
  expect(Object.values(saved.data.production.inventory.items).filter((item: any) => item.itemId === 241)).toHaveLength(2)
  await page.reload(); await expect(page.getByTestId('camp-scene')).toHaveAttribute('data-ready', 'true')
  await openMerge(page)
  await expect(page.getByTestId('order-1')).toHaveCount(0)
})

test('storage failure pauses further actions and retry preserves one accepted generation', async ({ page }) => {
  await enter(page); await openMerge(page)
  const before = await readSave(page)
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function(value, key) {
      if (key === 'current' && value.data.production.stamina.value === 99) {
        IDBObjectStore.prototype.put = original
        throw new DOMException('Test storage exhausted', 'QuotaExceededError')
      }
      return original.call(this, value, key)
    }
  })
  await page.getByTestId('board-cell-0').click()
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-save-state', 'error')
  await expect(page.getByRole('alert')).toContainText('保存失败')
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-paused', 'true')
  const failed = await readSave(page)
  expect(failed.data.production.stamina.value).toBe(100)
  await page.getByRole('button', { name: '重试保存', exact: true }).click()
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-save-state', 'saved')
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-paused', 'false')
  const after = await readSave(page)
  expect(after.data.production.stamina.value).toBe(99)
  expect(Object.keys(after.data.production.inventory.items).length).toBe(Object.keys(before.data.production.inventory.items).length + 1)
})
