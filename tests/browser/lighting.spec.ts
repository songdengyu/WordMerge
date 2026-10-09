import { test, expect, type Page } from '@playwright/test'

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
async function seed(page: Page, edit: (save: any) => void) {
  await page.goto('/'); await ready(page)
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide'))); await ready(page)
  const save = await readSave(page); await page.goto('/?game=legacy')
  save.data.elapsedSeconds = 300; save.data.cell = { x: 10, y: 3 }; save.data.motion = { version: 1, position: { x: 10, y: 3 } }
  save.data.economy.removedObjects = ['fire']; edit(save)
  await page.evaluate(async value => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('wordmerge-survival', 1); r.onsuccess = () => resolve(r.result) })
    const tx = db.transaction('snapshots', 'readwrite'), store = tx.objectStore('snapshots')
    store.put(value, 'current'); store.put(value.revision, 'revision'); store.delete('backup')
    await new Promise<void>(resolve => { tx.oncomplete = () => resolve() }); db.close()
  }, save)
  await page.goto('/'); await ready(page)
}
async function lightLevel(page: Page, path: string) {
  const png = (await page.screenshot({ path })).toString('base64')
  return page.evaluate(async base64 => {
    const img = new Image(); img.src = `data:image/png;base64,${base64}`; await img.decode()
    const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height
    const ctx = canvas.getContext('2d')!; ctx.drawImage(img, 0, 0)
    const rect = document.querySelector('[data-testid="camp-scene"]')!.getBoundingClientRect(), scale = img.width / innerWidth
    const sample = (x: number, y: number) => {
      const pixels = ctx.getImageData(Math.floor(x * scale), Math.floor(y * scale), 12, 12).data
      let total = 0; for (let i = 0; i < pixels.length; i += 4) total += (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3
      return total / (pixels.length / 4)
    }
    return { center: sample(rect.x + rect.width / 2 + 28, rect.y + rect.height / 2 + 10),
      outer: sample(rect.x + 5, rect.y + rect.height * .58) }
  }, png)
}
async function timeWeather(page: Page, label: string) {
  await page.getByRole('button', { name: '测试', exact: true }).click()
  await page.getByRole('button', { name: '时间与天气' }).click()
  await page.getByRole('region', { name: '时间与天气测试' }).getByRole('button', { name: label, exact: true }).click()
  await page.getByRole('button', { name: '关闭天候测试' }).click()
}

test('deep night hides unlit ground, paid torch reveals a moving pool and reload preserves remaining fuel', async ({ page }) => {
  test.setTimeout(60_000)
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await seed(page, () => {})
  const torch = page.getByTestId('torch-button'), scene = page.getByTestId('camp-scene')
  await expect(scene).toHaveAttribute('data-darkness', '1.000')
  const dark = await lightLevel(page, 'test-results/lighting-midnight-unlit.png')
  expect(dark.center).toBeLessThan(12); expect(dark.outer).toBeLessThan(12)
  const before = await readSave(page)
  await torch.click(); await expect(torch).toHaveAttribute('data-lit', 'true'); await ready(page)
  const lit = await lightLevel(page, 'test-results/lighting-midnight-torch.png')
  expect(lit.center).toBeGreaterThan(dark.center + 50); expect(lit.outer).toBeLessThan(15)
  const paid = await readSave(page)
  expect(Object.keys(paid.data.production.inventory.items)).toHaveLength(Object.keys(before.data.production.inventory.items).length - 2)
  const inventory = paid.data.production.inventory
  await torch.click(); await ready(page)
  expect((await readSave(page)).data.production.inventory).toEqual(inventory)
  // Ordinary map walking retains the portable light, and its screen position follows the camera.
  const [cx, cy, zoom] = (await scene.getAttribute('data-camera'))!.split(',').map(Number), rect = (await scene.boundingBox())!
  await page.touchscreen.tap(rect.x + cx + (10 - 4) * 32 * zoom, rect.y + cy + (10 + 4) * 16 * zoom)
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-player', '10,4')
  await expect.poll(async () => {
    const light = JSON.parse((await scene.getAttribute('data-lights'))!)[0]
    return Math.abs(light.x - rect.width / 2)
  }).toBeLessThan(5)
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide'))); await ready(page)
  const remaining = Number(await torch.getAttribute('data-remaining'))
  await page.reload(); await ready(page)
  expect(Number(await torch.getAttribute('data-remaining'))).toBeGreaterThan(remaining - 2)
  expect((await readSave(page)).data.production.inventory).toEqual(inventory)
  expect(errors).toEqual([])
})

test('campfire and placed lanterns reveal the map, rain remains lit, noon and dusk retain their palettes', async ({ page }) => {
  test.setTimeout(60_000)
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await seed(page, save => {
    save.data.economy.removedObjects = []
    save.data.cell = { x: 8, y: 11 }; save.data.motion.position = { ...save.data.cell }
    save.data.construction = { unlockedBlueprints: ['cabin'], nextId: 2, xp: 10, orders: [], jobs: [], buildings: [
      { id: 'b1', blueprintId: 'cabin', origin: { x: 7, y: 10 }, rotation: 0,
        parts: Object.fromEntries(['foundation', 'walls', 'door', 'roof', 'bed'].map(id => [id, { built: id === 'foundation', hp: id === 'foundation' ? 100 : 0, xpGranted: id === 'foundation' }])) },
    ] }
    save.data.economy.purchases = ['lantern']; save.data.progression.ownedDecor = ['lantern']
    save.data.progression.decorStock = { lantern: 0 }; save.data.progression.nextDecorationId = 2
    save.data.progression.decorations = [{ id: 'd1', kind: 'lantern', buildingId: 'b1', cell: { x: 8, y: 11 } }]
  })
  const scene = page.getByTestId('camp-scene')
  expect(JSON.parse((await scene.getAttribute('data-lights'))!)).toHaveLength(2)
  expect((await lightLevel(page, 'test-results/lighting-home-lantern-fire.png')).center).toBeGreaterThan(60)
  await timeWeather(page, '☂ 雨')
  expect((await lightLevel(page, 'test-results/lighting-rain.png')).center).toBeGreaterThan(50)
  await timeWeather(page, '正午'); await expect(scene).toHaveAttribute('data-darkness', '0.000')
  await page.screenshot({ path: 'test-results/lighting-noon.png' })
  await timeWeather(page, '黄昏'); expect(Number(await scene.getAttribute('data-darkness'))).toBeLessThan(.2)
  await page.screenshot({ path: 'test-results/lighting-dusk.png' })
  expect(errors).toEqual([])
})

test('narrow phone button fits beside locate, fuel runs out, merge burns fuel and background pauses it', async ({ page }) => {
  test.setTimeout(60_000)
  await page.setViewportSize({ width: 320, height: 568 })
  await seed(page, save => { save.data.survival.torchRemaining = 3 })
  const torch = page.getByTestId('torch-button'), scene = page.getByTestId('camp-scene')
  const locate = (await page.getByRole('button', { name: '定位主角', exact: true }).boundingBox())!, button = (await torch.boundingBox())!
  const hp = (await page.getByRole('button', { name: /^生命 \d/ }).boundingBox())!
  expect(button.x).toBeGreaterThanOrEqual(locate.x + locate.width)
  expect(button.x + button.width).toBeLessThanOrEqual(hp.x)
  await expect(torch).toBeInViewport()
  await page.clock.install(); await page.clock.pauseAt(await page.evaluate(() => Date.now() + 100))
  await page.clock.runFor(3200)
  await expect(torch).toHaveAttribute('data-lit', 'false'); await expect(scene).toHaveAttribute('data-lights', '[]')
  await torch.click(); await page.clock.runFor(100)
  await expect(torch).toHaveAttribute('data-lit', 'true')
  await page.screenshot({ path: 'test-results/lighting-torch-small.png' })
  await page.getByRole('button', { name: '合成物资' }).click()
  const before = Number(await torch.getAttribute('data-remaining')); await page.clock.runFor(700)
  expect(Number(await torch.getAttribute('data-remaining'))).toBeLessThan(before - .5)
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide'))); await ready(page)
  const paused = Number(await torch.getAttribute('data-remaining')); await page.clock.runFor(1500)
  expect(Number(await torch.getAttribute('data-remaining'))).toBe(paused)
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow'))); await page.clock.runFor(300)
  expect(Number(await torch.getAttribute('data-remaining'))).toBeLessThan(paused)
})
