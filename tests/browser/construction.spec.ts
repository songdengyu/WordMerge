import { test, expect, type Page } from '@playwright/test'

async function enter(page: Page) {
  await page.goto('/?game=survival')
  await expect(page.getByTestId('camp-scene')).toHaveAttribute('data-ready', 'true')
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-save-state', 'saved')
}
async function drag(page: Page, from: number, to: number) {
  const a = (await page.getByTestId(`board-cell-${from}`).boundingBox())!
  const b = (await page.getByTestId(`board-cell-${to}`).boundingBox())!
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page.mouse.down()
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 }); await page.mouse.up()
}
async function readSave(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('wordmerge-survival', 1); request.onsuccess = () => resolve(request.result) })
    try { return await new Promise<any>(resolve => { const request = db.transaction('snapshots').objectStore('snapshots').get('current'); request.onsuccess = () => resolve(request.result) }) }
    finally { db.close() }
  })
}
async function place(page: Page) {
  await page.getByRole('button', { name: '⌂ 营地建设', exact: true }).click()
  await page.getByRole('button', { name: '放置图纸', exact: true }).click()
  await expect(page.getByTestId('placement-status')).toContainText('可以安家')
  await page.getByRole('button', { name: '确认放置', exact: true }).click()
  await expect(page.getByTestId('build-bubble-b1:foundation')).toBeVisible()
  await expect(page.getByTestId('building-panel')).toHaveCount(0)
}

test('missing materials lead to merge, warehouse delivery, travel, protected construction and reload', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await enter(page); await place(page)
  const bubble = page.getByTestId('build-bubble-b1:foundation')
  await expect(bubble).toHaveAttribute('data-ready', 'false')
  const normalColor = await bubble.locator('[data-material-id]').evaluate(element => getComputedStyle(element).backgroundColor)
  await page.screenshot({ path: 'test-results/build-bubble-missing.png' })
  await bubble.click()
  const order = page.getByTestId('building-order-b1:foundation')
  await expect(order).toContainText('0/1')
  await drag(page, 7, 8)
  await expect(order).toContainText('领取工程')
  await page.getByRole('button', { name: '存入仓库', exact: true }).click()
  await expect(order).toContainText('1/1')
  await page.getByRole('button', { name: '返回营地', exact: true }).click()
  await expect(bubble).toHaveAttribute('data-ready', 'true')
  expect(await bubble.locator('[data-material-id]').evaluate(element => getComputedStyle(element).backgroundColor)).not.toBe(normalColor)
  await page.screenshot({ path: 'test-results/build-bubble-ready.png' })
  await bubble.click()
  await expect(page.getByTestId('production-screen')).toHaveCount(0)
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-activity', 'building')
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-protected', 'true')
  await page.getByRole('button', { name: '合成物资' }).click()
  await expect(page.getByTestId('production-screen')).toContainText('施工保护中')
  await page.getByTestId('board-cell-0').click()
  await expect(page.getByTestId('stamina-value')).toHaveText('99')
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')))
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-save-state', 'saved')
  const before = await readSave(page)
  expect(before.data.construction.jobs[0].phase).toBe('building')
  expect(before.data.construction.jobs[0].remaining).toBeLessThanOrEqual(2)
  expect(before.data.production.inventory.warehouse[0]).toBeNull()
  await page.reload()
  await expect(page.getByTestId('camp-scene')).toHaveAttribute('data-ready', 'true')
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-protected', 'true')
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-activity', 'idle', { timeout: 10_000 })
  await expect(bubble).toHaveCount(0)
  await expect(page.getByTestId('build-bubble-b1:walls')).toBeVisible()
  await expect(page.getByTestId('building-xp')).toHaveText('10')
  await page.screenshot({ path: 'test-results/m3-foundation.png' })
  await page.reload(); await expect(page.getByTestId('camp-scene')).toHaveAttribute('data-ready', 'true')
  await expect(page.getByTestId('building-xp')).toHaveText('10')
  expect(errors).toEqual([])
})

test('placement rejects occupied ground, can rotate and cancel, and fits a small portrait screen', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 }); await enter(page)
  await page.getByRole('button', { name: '⌂ 营地建设', exact: true }).click()
  await page.getByRole('button', { name: '放置图纸', exact: true }).click()
  await page.getByRole('button', { name: '旋转图纸' }).click()
  await expect(page.getByTestId('placement-panel')).toContainText('90°')
  // Use a tree away from the camera controls' touch hit area.
  const camera = (await page.getByTestId('camp-scene').getAttribute('data-camera'))!.split(',').map(Number)
  const box = (await page.getByTestId('camp-canvas').boundingBox())!
  await page.touchscreen.tap(box.x + camera[0] - 64 * camera[2], box.y + camera[1] + 10 * 16 * camera[2])
  await expect(page.getByRole('button', { name: '确认放置' })).toBeDisabled()
  await expect(page.getByRole('button', { name: '取消', exact: true })).toBeInViewport()
  await page.screenshot({ path: 'test-results/m3-placement-small.png' })
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-building-count', '0')
  await place(page)
  const bubble = page.getByTestId('build-bubble-b1:foundation')
  await expect(bubble).toBeInViewport()
  const before = (await bubble.boundingBox())!
  const cameraBefore = (await page.getByTestId('camp-scene').getAttribute('data-camera'))!.split(',').map(Number)
  await page.mouse.move(140, 360); await page.mouse.down()
  await page.mouse.move(160, 385, { steps: 8 }); await page.mouse.up()
  const cameraAfter = (await page.getByTestId('camp-scene').getAttribute('data-camera'))!.split(',').map(Number)
  expect(cameraAfter[0] - cameraBefore[0]).toBeGreaterThan(10)
  // Compare against applied camera motion; the tap/drag threshold intentionally ignores the first movement.
  await expect.poll(async () => (await bubble.boundingBox())!.x).toBeCloseTo(before.x + cameraAfter[0] - cameraBefore[0], 0)
  await expect.poll(async () => (await bubble.boundingBox())!.y).toBeCloseTo(before.y + cameraAfter[1] - cameraBefore[1], 0)
  await page.getByRole('button', { name: '放大地图' }).click()
  const zoomed = (await page.getByTestId('camp-scene').getAttribute('data-camera'))!.split(',').map(Number)
  await expect.poll(async () => { const box = (await bubble.boundingBox())!; return box.x + box.width / 2 }).toBeCloseTo(zoomed[0] + (8 - 10.5) * 32 * zoomed[2], 0)
  expect((await readSave(page)).data.construction.jobs).toHaveLength(0)
  await page.screenshot({ path: 'test-results/build-bubble-small.png' })
})

test('an existing M2 save migrates without losing overflow, inventory or progress', async ({ page }) => {
  await enter(page)
  const current = await readSave(page)
  await page.goto('/')
  const legacy = structuredClone(current)
  legacy.schemaVersion = 1
  legacy.configVersion = ['m2', ...current.configVersion.split('-').slice(1, 3)].join('-')
  delete legacy.data.construction
  legacy.data.production.stamina.value = 140
  legacy.data.production.inventory.completedOrders = [1]
  legacy.data.elapsedSeconds = 123
  await page.evaluate(async save => {
    const db = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('wordmerge-survival', 1); request.onsuccess = () => resolve(request.result) })
    const tx = db.transaction('snapshots', 'readwrite')
    tx.objectStore('snapshots').put(save, 'current'); tx.objectStore('snapshots').put(save.revision, 'revision')
    await new Promise<void>(resolve => { tx.oncomplete = () => resolve() }); db.close()
  }, legacy)
  await enter(page)
  await expect(page.getByRole('status')).toContainText('已升级营地存档')
  await expect(page.getByTestId('map-stamina')).toHaveText('140')
  const migrated = await readSave(page)
  expect(migrated.schemaVersion).toBe(2)
  expect(migrated.data.production.inventory).toEqual(legacy.data.production.inventory)
  expect(migrated.data.elapsedSeconds).toBeGreaterThanOrEqual(123)
  expect(migrated.data.construction.unlockedBlueprints).toEqual(['cabin'])
  await page.reload(); await expect(page.getByTestId('camp-scene')).toHaveAttribute('data-ready', 'true')
  expect((await readSave(page)).data.construction.xp).toBe(0)
})

test('an existing completed M3 building upgrades to the new timing without losing construction progress', async ({ page }) => {
  await enter(page); await place(page)
  await page.getByTestId('build-bubble-b1:foundation').click()
  await drag(page, 7, 8)
  await page.getByTestId('building-order-b1:foundation').click()
  await expect(page.getByTestId('building-xp')).toHaveText('10')
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-save-state', 'saved')
  await page.goto('/')
  const previous = await readSave(page)
  previous.configVersion = previous.configVersion.replace(/[^-]+$/, '6f54c437')
  await page.evaluate(async save => {
    const db = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('wordmerge-survival', 1); request.onsuccess = () => resolve(request.result) })
    const tx = db.transaction('snapshots', 'readwrite')
    tx.objectStore('snapshots').put(save, 'current')
    await new Promise<void>(resolve => { tx.oncomplete = () => resolve() }); db.close()
  }, previous)
  await enter(page)
  await expect(page.getByRole('status')).toContainText('建造时长已更新为 2 秒')
  await expect(page.getByTestId('building-xp')).toHaveText('10')
  await expect(page.getByTestId('build-bubble-b1:foundation')).toHaveCount(0)
  await expect(page.getByTestId('build-bubble-b1:walls')).toBeVisible()
  const migrated = await readSave(page)
  expect(migrated.configVersion).not.toBe(previous.configVersion)
  expect(migrated.data.construction).toEqual(previous.data.construction)
  expect(migrated.data.production.inventory).toEqual(previous.data.production.inventory)
})

test('a complete cabin can be built with generated materials and keeps its doorway passable', async ({ page }) => {
  test.setTimeout(120_000)
  await enter(page); await place(page)
  const available = (id: number) => page.locator(`[data-board-cell][data-item-id="${id}"][data-lock="0"]`)
  const craft = async (id: number, quantity: number) => {
    const ensure = async (itemId: number, count: number) => {
      while (await available(itemId).count() < count) {
        if (itemId === 201) {
          const before = await available(201).count()
          await page.getByTestId('board-cell-0').click()
          await expect(available(201)).toHaveCount(before + 1)
        } else {
          await ensure(itemId - 1, 2)
          const cells = await available(itemId - 1).evaluateAll(elements => elements.map(element => Number(element.getAttribute('data-board-cell'))))
          await drag(page, cells[0], cells[1])
          await expect(page.getByTestId(`board-cell-${cells[1]}`)).toHaveAttribute('data-item-id', String(itemId))
        }
      }
    }
    await ensure(id, quantity)
  }
  const parts = [
    { id: 'foundation', materials: [[202, 1]] }, { id: 'walls', materials: [[202, 2]] },
    { id: 'door', materials: [[201, 2]] }, { id: 'roof', materials: [[203, 1]] },
    { id: 'bed', materials: [[202, 2]] },
  ]
  for (const part of parts) {
    await page.getByRole('button', { name: '合成物资' }).click()
    for (const [id, count] of part.materials) await craft(id, count)
    await page.getByRole('button', { name: '返回营地', exact: true }).click()
    const bubble = page.getByTestId(`build-bubble-b1:${part.id}`)
    await expect(bubble).toHaveAttribute('data-ready', 'true')
    await expect(bubble).toHaveAccessibleName(/点击建造/)
    if (part.id === 'door') await page.screenshot({ path: 'test-results/build-bubbles-parts.png' })
    await bubble.click()
    await expect(page.getByTestId('survival-game')).toHaveAttribute('data-activity', 'building')
    await expect(page.getByTestId('survival-game')).toHaveAttribute('data-activity', 'idle', { timeout: 4000 })
    await expect(page.getByTestId('building-panel')).toHaveCount(0)
  }
  await expect(page.getByTestId('building-complete-b1')).toHaveAccessibleName(/围护封闭/)
  await expect(page.getByTestId('building-xp')).toHaveText('70')
  await page.screenshot({ path: 'test-results/m3-cabin-complete.png' })
  await page.getByRole('button', { name: '营地地图', exact: true }).click()
  await page.getByRole('button', { name: '走回营火旁' }).click()
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-player', '7,9')
  await page.screenshot({ path: 'test-results/m3-camp.png' })
})
