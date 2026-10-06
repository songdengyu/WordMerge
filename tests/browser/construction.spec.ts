import { test, expect, type Page } from '@playwright/test'
import { tapSceneControl } from './sceneControls'

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
async function tapGround(page: Page, x: number, y: number) {
  const [cx, cy, zoom] = (await page.getByTestId('camp-scene').getAttribute('data-camera'))!.split(',').map(Number)
  const box = (await page.getByTestId('camp-canvas').boundingBox())!
  await page.touchscreen.tap(box.x + cx + (x - y) * 32 * zoom, box.y + cy + (x + y) * 16 * zoom)
}
async function place(page: Page) {
  await page.getByRole('button', { name: '建造', exact: true }).click()
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
  const normalColor = await bubble.getAttribute('data-color')
  await page.screenshot({ path: 'test-results/build-bubble-missing.png' })
  await tapSceneControl(page, bubble)
  const order = page.getByTestId('building-order-b1:foundation')
  await expect(order).toContainText('0/1')
  await drag(page, 7, 8)
  await expect(order).toContainText('领取工程')
  await page.getByRole('button', { name: '存入仓库', exact: true }).click()
  await expect(order).toContainText('1/1')
  await page.getByRole('button', { name: '返回营地', exact: true }).click()
  await expect(bubble).toHaveAttribute('data-ready', 'true')
  expect(await bubble.getAttribute('data-color')).not.toBe(normalColor)
  await page.screenshot({ path: 'test-results/build-bubble-ready.png' })
  await tapSceneControl(page, bubble)
  await expect(page.getByTestId('production-screen')).toHaveCount(0)
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-activity', 'building')
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-protected', 'true')
  await page.clock.install()
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000))
  await page.getByRole('button', { name: '合成物资' }).click()
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-protected', 'true')
  await page.getByTestId('board-cell-0').click()
  await page.clock.runFor(100)
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
  await page.clock.runFor(2500)
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
  await page.getByRole('button', { name: '建造', exact: true }).click()
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
  expect(before.width).toBeCloseTo(30 * cameraBefore[2], 1)
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
  await expect.poll(async () => (await bubble.boundingBox())!.width / before.width).toBeCloseTo(zoomed[2] / cameraBefore[2], 2)
  await expect.poll(async () => (await bubble.boundingBox())!.height / before.height).toBeCloseTo(zoomed[2] / cameraBefore[2], 2)
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
  expect(migrated.schemaVersion).toBe(4)
  expect(migrated.data.production.inventory).toEqual(legacy.data.production.inventory)
  expect(migrated.data.elapsedSeconds).toBeGreaterThanOrEqual(123)
  expect(migrated.data.construction.unlockedBlueprints).toEqual(['cabin'])
  await page.reload(); await expect(page.getByTestId('camp-scene')).toHaveAttribute('data-ready', 'true')
  expect((await readSave(page)).data.construction.xp).toBe(0)
})

test('an existing completed M3 building upgrades to the new timing without losing construction progress', async ({ page }) => {
  await enter(page); await place(page)
  await tapSceneControl(page, page.getByTestId('build-bubble-b1:foundation'))
  await drag(page, 7, 8)
  await page.getByTestId('building-order-b1:foundation').click()
  await expect(page.getByTestId('building-xp')).toHaveText('10')
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-save-state', 'saved')
  await page.goto('/')
  const previous = await readSave(page)
  previous.schemaVersion = 2; delete previous.data.survival
  previous.configVersion = ['m3', ...previous.configVersion.split('-').slice(1, 3), '6f54c437'].join('-')
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
    await tapSceneControl(page, bubble)
    await expect(page.getByTestId('survival-game')).toHaveAttribute('data-activity', 'building')
    await expect(page.getByTestId('survival-game')).toHaveAttribute('data-activity', 'idle', { timeout: 4000 })
    await expect(page.getByTestId('building-panel')).toHaveCount(0)
  }
  await expect(page.getByTestId('building-complete-b1')).toHaveCount(0)
  await tapGround(page, 8.2, 10.2)
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-player', '8,10')
  await expect(page.getByTestId('building-xp')).toHaveText('70')
  await page.screenshot({ path: 'test-results/m3-cabin-complete.png' })
})

test('scene bubbles scale at both zoom limits and drag, pinch and cancel do not activate them', async ({ page, context }) => {
  await enter(page); await place(page)
  const bubble = page.getByTestId('build-bubble-b1:foundation')
  await expect(bubble).toHaveAttribute('data-renderer', 'pixi')
  // There is no DOM artwork or pointer-catching overlay: the scene draws and handles the bubble.
  expect(await bubble.evaluate(el => getComputedStyle(el).pointerEvents)).toBe('none')
  expect(await bubble.locator('svg, img').count()).toBe(0)
  let bounds = (await bubble.boundingBox())!
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  await page.mouse.down(); await page.mouse.move(bounds.x + bounds.width / 2 + 30, bounds.y + bounds.height / 2 + 20, { steps: 6 }); await page.mouse.up()
  await expect(page.getByTestId('production-screen')).toHaveCount(0)
  const cdp = await context.newCDPSession(page)
  bounds = (await bubble.boundingBox())!
  const x = bounds.x + bounds.width / 2, y = bounds.y + bounds.height / 2
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, x: x - 12, y }, { id: 2, x: x + 12, y }] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ id: 1, x: x - 25, y }, { id: 2, x: x + 25, y }] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await expect.poll(async () => (await bubble.boundingBox())!.width).toBeCloseTo(48, 1)
  await page.screenshot({ path: 'test-results/build-scene-zoom-in.png' })
  bounds = (await bubble.boundingBox())!
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
  for (let i = 0; i < 6; i++) await page.getByRole('button', { name: '缩小地图' }).click()
  await expect.poll(async () => (await bubble.boundingBox())!.width).toBeCloseTo(19.5, 1)
  await page.screenshot({ path: 'test-results/build-scene-zoom-out.png' })
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-destination', '')
  expect((await readSave(page)).data.construction.orders).toHaveLength(0)
  await tapSceneControl(page, bubble)
  await expect(page.getByTestId('building-order-b1:foundation')).toBeVisible()
  await page.getByRole('button', { name: '返回营地', exact: true }).click()
  await tapSceneControl(page, page.getByRole('button', { name: '收回图纸 b1' }))
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-building-count', '0')
})

test('scene repair bubbles keep cancellation, material refunds, keyboard access and direct floor movement', async ({ page }) => {
  await enter(page); await place(page)
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')))
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-save-state', 'saved')
  const save = await readSave(page)
  await page.goto('/')
  const data = save.data
  data.cell = { x: 12, y: 9 }
  data.motion = { version: 1, position: { ...data.cell } }
  const building = data.construction.buildings[0]
  building.parts = Object.fromEntries(Object.entries({ foundation: 100, walls: 20, door: 50, roof: 120, bed: 80 })
    .map(([id, hp]) => [id, { built: true, hp, xpGranted: true }]))
  data.construction.xp = 70
  await page.evaluate(async value => {
    const db = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('wordmerge-survival', 1); request.onsuccess = () => resolve(request.result) })
    const tx = db.transaction('snapshots', 'readwrite'); tx.objectStore('snapshots').put(value, 'current')
    await new Promise<void>(resolve => { tx.oncomplete = () => resolve() }); db.close()
  }, save)
  await enter(page)
  // Locate the house without moving the player, keeping time to cancel the travel phase.
  await expect(page.getByTestId('building-xp')).toHaveText('70')
  await page.getByRole('button', { name: '建造', exact: true }).click()
  await page.getByRole('button', { name: /林间小木屋 · B1/ }).click()
  const repair = page.getByTestId('build-bubble-b1:door')
  await expect(repair).toHaveAccessibleName(/修复营地木门.*点击修复/)
  await repair.focus(); await page.keyboard.press('Enter')
  const cancel = page.getByRole('button', { name: '取消工程 营地木门 b1' })
  await tapSceneControl(page, cancel)
  await expect(repair).toHaveAttribute('data-ready', 'true')
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-save-state', 'saved')
  const cancelled = (await readSave(page)).data
  expect(cancelled.construction.jobs).toHaveLength(0)
  expect(Object.values(cancelled.production.inventory.items).filter((item: any) => item.reservedBy)).toHaveLength(0)
  await tapSceneControl(page, repair)
  await expect(repair).toHaveCount(0, { timeout: 10_000 })
  await expect(page.getByTestId('building-complete-b1')).toHaveCount(0)
  await expect(page.getByTestId('building-xp')).toHaveText('70')
  await tapGround(page, 9, 10)
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-player', '9,10')
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-save-state', 'saved')
  expect((await readSave(page)).data.construction.buildings[0].parts.door.hp).toBe(100)
})

test('separate wall repair bubbles restore one segment and persist the neighboring breach', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await enter(page); await place(page)
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')))
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-save-state', 'saved')
  const save = await readSave(page); await page.goto('/')
  const data = save.data
  data.cell = { x: 8, y: 11 }; data.motion = { version: 1, position: data.cell }
  data.construction.buildings[0].parts = Object.fromEntries(Object.entries({ foundation: 100, walls: 0, door: 100, roof: 120, bed: 80 })
    .map(([id, hp]) => [id, { built: true, hp, xpGranted: true }]))
  data.construction.buildings[0].parts.walls.segments = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`edge${i}`, i === 0 ? 10 : i === 2 ? 0 : 20]))
  data.construction.xp = 70
  const inv = data.production.inventory
  inv.items[inv.board[7].instanceId].itemId = 202
  await page.evaluate(async value => {
    const db = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('wordmerge-survival', 1); request.onsuccess = () => resolve(request.result) })
    const tx = db.transaction('snapshots', 'readwrite'); tx.objectStore('snapshots').put(value, 'current')
    await new Promise<void>(resolve => { tx.oncomplete = () => resolve() }); db.close()
  }, save)
  await enter(page)
  await page.getByRole('button', { name: '建造', exact: true }).click()
  await page.getByRole('button', { name: /林间小木屋 · B1/ }).click()
  const first = page.getByTestId('build-bubble-b1:walls:edge0'), second = page.getByTestId('build-bubble-b1:walls:edge2')
  await expect(first).toBeVisible(); await expect(second).toBeVisible()
  await page.screenshot({ path: 'test-results/building-segment-damage.png' })
  await tapSceneControl(page, first)
  await expect(first).toHaveCount(0, { timeout: 10_000 })
  await expect(second).toBeVisible()
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-save-state', 'saved')
  const after = await readSave(page)
  expect(after.data.construction.buildings[0].parts.walls.segments).toMatchObject({ edge0: 20, edge2: 0 })
  expect(after.data.construction.xp).toBe(70)
  await page.reload(); await expect(page.getByTestId('camp-scene')).toHaveAttribute('data-ready', 'true')
  await expect(first).toHaveCount(0); await expect(second).toBeVisible()
  await tapSceneControl(page, second)
  await expect(page.getByTestId('building-order-b1:walls:edge2')).toHaveAttribute('data-current', 'true')
  expect(errors).toEqual([])
})
