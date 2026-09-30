import { test, expect, type Page } from '@playwright/test'
import { tapSceneControl } from './sceneControls'

const resetLabel = '删'
async function ready(page: Page) {
  await expect(page.getByTestId('camp-scene')).toHaveAttribute('data-ready', 'true')
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-save-state', 'saved')
}
async function records(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('wordmerge-survival', 1)
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error)
    })
    try {
      const store = db.transaction('snapshots').objectStore('snapshots')
      const read = (key: string) => new Promise<any>((resolve, reject) => {
        const request = store.get(key)
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error)
      })
      const [current, previous, generation] = await Promise.all(['current', 'previous', 'generation'].map(read))
      return { current, previous, generation }
    } finally { db.close() }
  })
}
async function reset(page: Page, label = resetLabel) {
  const loaded = page.waitForEvent('load')
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: label, exact: true }).click()
  await loaded
  await ready(page)
}

test('cancel keeps progress; confirm resets every system and backup, including after reload', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto('/?game=survival'); await ready(page)
  const initial = (await records(page)).current.data
  await page.getByRole('button', { name: '建', exact: true }).click()
  await page.getByRole('button', { name: '放置图纸', exact: true }).click()
  await page.getByRole('button', { name: '确认放置', exact: true }).click()
  await tapSceneControl(page, page.getByTestId('build-bubble-b1:foundation'))
  const a = (await page.getByTestId('board-cell-7').boundingBox())!
  const b = (await page.getByTestId('board-cell-8').boundingBox())!
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page.mouse.down()
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 }); await page.mouse.up()
  await page.getByRole('button', { name: '返回营地', exact: true }).click()
  await tapSceneControl(page, page.getByTestId('build-bubble-b1:foundation'))
  await expect(page.getByTestId('building-xp')).toHaveText('10')
  await page.getByRole('button', { name: '合成物资' }).click()
  await page.getByTestId('board-cell-5').dblclick()
  await page.getByTestId('board-cell-9').click()
  await page.getByRole('button', { name: '存入仓库', exact: true }).click()
  await page.getByRole('button', { name: '返回营地', exact: true }).click()
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-save-state', 'saved')
  const seeded = (await records(page)).current
  seeded.data.elapsedSeconds = 3600
  seeded.data.production.inventory.gold = 987
  seeded.data.production.inventory.gems = 654
  await page.getByRole('button', { name: '设置', exact: true }).click()
  page.once('dialog', dialog => dialog.accept())
  await page.getByLabel('选择存档备份').setInputFiles({ name: 'progress.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(seeded)) })
  await expect(page.getByRole('dialog')).toContainText('备份已导入')
  await page.getByRole('button', { name: '关闭', exact: true }).click()
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')))
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-save-state', 'saved')
  const before = await records(page)
  expect(before.previous).toBeTruthy()
  page.once('dialog', async dialog => {
    expect(dialog.message()).toContain('无法撤销')
    await dialog.dismiss()
  })
  await page.getByRole('button', { name: resetLabel, exact: true }).click()
  expect(await records(page)).toEqual(before)
  await reset(page)
  await page.screenshot({ path: 'test-results/reset-button.png' })
  const cleared = await records(page)
  expect(cleared.current.data.production.inventory).toEqual(initial.production.inventory)
  expect(cleared.current.data.construction).toEqual(initial.construction)
  expect(cleared.current.data.production.stamina.value).toBe(100)
  expect(cleared.current.data.elapsedSeconds).toBeLessThan(10)
  expect(cleared.generation).toEqual(expect.any(String))
  if (cleared.previous) expect(cleared.previous.data.construction).toEqual(initial.construction)
  await page.reload(); await ready(page)
  const reloaded = await records(page)
  expect(reloaded.current.data.production.inventory).toEqual(initial.production.inventory)
  expect(reloaded.current.data.construction).toEqual(initial.construction)
  expect(reloaded.previous.data.production.inventory).toEqual(initial.production.inventory)
  expect(errors).toEqual([])
})

test('another open tab cannot restore old progress after reset', async ({ page, context }) => {
  await page.goto('/?game=survival'); await ready(page)
  await page.getByRole('button', { name: '合成物资' }).click()
  await page.getByTestId('board-cell-5').dblclick()
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')))
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-save-state', 'saved')
  const second = await context.newPage()
  await second.goto('/?game=survival'); await ready(second)
  await reset(second)
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent('pageshow'))
    window.dispatchEvent(new PageTransitionEvent('pagehide'))
  })
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-save-state', 'conflict')
  await expect(second.getByTestId('map-stamina')).toHaveText('100')
  await second.reload(); await ready(second)
  await expect(second.getByTestId('map-stamina')).toHaveText('100')
})

test('reset failure is visible, preserves the save, and can be retried on a small screen', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 })
  await page.goto('/?game=survival'); await ready(page)
  await expect(page.getByRole('button', { name: resetLabel, exact: true })).toBeInViewport()
  await page.screenshot({ path: 'test-results/reset-button-small.png' })
  const before = await records(page)
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.clear
    IDBObjectStore.prototype.clear = function () {
      IDBObjectStore.prototype.clear = original
      throw new DOMException('Simulated storage failure', 'UnknownError')
    }
  })
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: resetLabel, exact: true }).click()
  await expect(page.getByRole('heading', { name: '清除失败', exact: true })).toBeVisible()
  expect((await records(page)).current.data.production.inventory).toEqual(before.current.data.production.inventory)
  await reset(page, '重试清除')
  await expect(page.getByTestId('map-stamina')).toHaveText('100')
})

test('a corrupt save can be explicitly cleared from the boot error screen', async ({ page }) => {
  await page.goto('/?game=survival'); await ready(page)
  await page.evaluate(async () => {
    window.dispatchEvent(new PageTransitionEvent('pagehide'))
    const db = await new Promise<IDBDatabase>(resolve => {
      const request = indexedDB.open('wordmerge-survival', 1); request.onsuccess = () => resolve(request.result)
    })
    try {
      const tx = db.transaction('snapshots', 'readwrite')
      tx.objectStore('snapshots').put({ broken: true }, 'current')
      tx.objectStore('snapshots').put({ broken: true }, 'previous')
      await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error) })
    } finally { db.close() }
  })
  await page.reload()
  await expect(page.getByRole('heading', { name: '营地暂时无法打开', exact: true })).toBeVisible()
  await reset(page)
  await expect(page.getByTestId('map-stamina')).toHaveText('100')
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-building-count', '0')
})
