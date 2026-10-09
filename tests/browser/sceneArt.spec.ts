import { test, expect, type Page } from '@playwright/test'
import { tapSceneControl } from './sceneControls'
import { SCENE_ART } from '../../src/scene/sceneArtCatalog'

async function ready(page: Page) {
  await expect(page.getByTestId('camp-scene')).toHaveAttribute('data-ready', 'true')
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-save-state', 'saved')
}
async function saved(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('wordmerge-survival', 1); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error)
    })
    try { return await new Promise<any>(resolve => { const r = db.transaction('snapshots').objectStore('snapshots').get('current'); r.onsuccess = () => resolve(r.result) }) }
    finally { db.close() }
  })
}
async function seed(page: Page, edit?: (data: any) => void) {
  await page.goto('/'); await ready(page)
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide'))); await ready(page)
  const save = await saved(page); await page.goto('/?game=legacy')
  const data = save.data
  data.construction = { unlockedBlueprints: ['cabin'], nextId: 2, xp: 70, orders: [], jobs: [], buildings: [
    { id: 'b1', blueprintId: 'cabin', origin: { x: 7, y: 10 }, rotation: 0,
      parts: Object.fromEntries(Object.entries({ foundation: 100, walls: 20, door: 100, roof: 120, bed: 80 }).map(([id, hp]) => [id, { built: true, hp, xpGranted: true }])) },
  ] }
  data.cell = { x: 8, y: 11 }; data.motion = { version: 1, position: data.cell }
  data.economy.removedObjects = ['t14', 't17']
  data.production.inventory.gold = 1000
  edit?.(data)
  await page.evaluate(async value => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('wordmerge-survival', 1); r.onsuccess = () => resolve(r.result) })
    const tx = db.transaction('snapshots', 'readwrite'), store = tx.objectStore('snapshots')
    store.put(value, 'current'); store.put(value.revision, 'revision'); store.delete('previous')
    await new Promise<void>(resolve => { tx.oncomplete = () => resolve() }); db.close()
  }, save)
  await page.goto('/'); await ready(page)
}
async function walk(page: Page, cell: { x: number; y: number }) {
  const scene = page.getByTestId('camp-scene'), rect = (await scene.boundingBox())!
  const [x, y, z] = (await scene.getAttribute('data-camera'))!.split(',').map(Number)
  await page.touchscreen.tap(rect.x + x + (cell.x - cell.y) * 32 * z, rect.y + y + (cell.x + cell.y) * 16 * z)
}
async function changeTime(page: Page, name: string) {
  await page.getByRole('button', { name: '测试', exact: true }).click()
  await page.getByRole('button', { name: '时间与天气' }).click()
  await page.getByRole('region', { name: '时间与天气测试' }).getByRole('button', { name, exact: true }).click()
  await page.getByRole('button', { name: '关闭天候测试' }).click()
}
async function frameTiming(page: Page) {
  return page.evaluate(() => new Promise<{ averageMs: number; p95Ms: number; frames: number }>(resolve => {
    const values: number[] = []; let previous = performance.now()
    const frame = (time: number) => {
      values.push(time - previous); previous = time
      if (values.length < 180) requestAnimationFrame(frame)
      else { values.shift(); values.sort((a, b) => a - b); resolve({ averageMs: values.reduce((a, b) => a + b) / values.length, p95Ms: values[Math.floor(values.length * .95)], frames: values.length }) }
    }; requestAnimationFrame(frame)
  }))
}

test('expanded furniture uses package art and keeps inventory for every decoration', async ({ page }) => {
  test.setTimeout(120_000)
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message))
  await page.setViewportSize({ width: 320, height: 568 }); await seed(page)
  const kinds = ['rug', 'lantern', 'table', 'sofa', 'bookshelf', 'tea-set', 'flowerstand']
  for (const kind of kinds) {
    await page.getByRole('button', { name: '商店', exact: true }).click()
    await page.getByTestId('shop').getByRole('button', { name: '装饰', exact: true }).click()
    await expect(page.getByTestId(`product-${kind}`).locator('image')).toHaveAttribute('href', new RegExp(`scene/${kind}.png$`))
    if (kind === 'sofa') await expect(page.getByTestId(`product-${kind}`)).toContainText('湖蓝休闲椅')
    if (kind === 'bookshelf') await expect(page.getByTestId(`product-${kind}`)).toContainText('日用置物架')
    await page.getByTestId(`buy-${kind}`).click()
    await page.getByRole('button', { name: '打开装饰收藏' }).click()
    await page.getByTestId(`decor-stock-${kind}`).getByRole('button', { name: '摆放', exact: true }).click()
    await page.getByRole('button', { name: '确认摆放', exact: true }).click(); await ready(page)
    await page.screenshot({ path: `test-results/expanded-art-${kind}.png` })
    await page.reload(); await ready(page)
    const data = (await saved(page)).data, decor = data.progression.decorations.find((d: any) => d.kind === kind)
    expect(decor).toBeTruthy(); expect(data.progression.decorStock[kind]).toBe(0)
    await page.getByRole('button', { name: '装饰', exact: true }).click()
    await page.getByRole('button', { name: '已摆放', exact: true }).click()
    await page.getByTestId(`placed-${decor.id}`).getByRole('button', { name: '收回', exact: true }).click()
    await page.getByRole('button', { name: '回到地图', exact: true }).click(); await ready(page)
    expect((await saved(page)).data.progression.decorStock[kind]).toBe(1)
  }
  expect(errors).toEqual([])
})

test('sample furniture shares shop art, places, moves, returns stock and survives reload on 320px', async ({ page }) => {
  test.setTimeout(60_000)
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message))
  await page.setViewportSize({ width: 320, height: 568 }); await seed(page)
  await expect(page.getByTestId('camp-scene')).toHaveAttribute('data-scene-art', Object.keys(SCENE_ART).sort().join(','))
  await page.getByRole('button', { name: '商店', exact: true }).click()
  await page.getByTestId('shop').getByRole('button', { name: '装饰', exact: true }).click()
  await expect(page.getByTestId('product-chair').locator('image')).toHaveAttribute('href', /scene\/chair.png$/)
  await expect(page.getByTestId('product-planter').locator('image')).toHaveAttribute('href', /scene\/planter.png$/)
  await page.getByTestId('buy-chair').click(); await page.getByTestId('buy-chair').click(); await page.getByTestId('buy-planter').click()
  await page.screenshot({ path: 'test-results/scene-art-shop.png' })
  await page.getByRole('button', { name: '打开装饰收藏' }).click()
  await page.getByTestId('decor-stock-chair').getByRole('button', { name: '摆放' }).click()
  await page.screenshot({ path: 'test-results/scene-art-preview.png' })
  await page.getByRole('button', { name: '确认摆放', exact: true }).click()
  await page.getByRole('button', { name: '装饰', exact: true }).click()
  await expect(page.getByTestId('decor-count-chair')).toHaveText('1')
  await page.getByTestId('decor-stock-planter').getByRole('button', { name: '摆放' }).click()
  await page.getByRole('button', { name: '确认摆放', exact: true }).click()
  await page.screenshot({ path: 'test-results/scene-art-furniture.png' })
  await page.getByRole('button', { name: '装饰', exact: true }).click()
  await page.getByRole('button', { name: '已摆放', exact: true }).click()
  await page.getByTestId('placed-d1').getByRole('button', { name: '移动' }).click()
  await walk(page, { x: 9, y: 11 })
  await page.getByRole('button', { name: '确认摆放', exact: true }).click(); await ready(page)
  expect((await saved(page)).data.progression.decorations.find((d: any) => d.id === 'd1').cell).toEqual({ x: 9, y: 11 })
  await page.getByRole('button', { name: '装饰', exact: true }).click()
  await page.getByRole('button', { name: '已摆放', exact: true }).click()
  await page.getByTestId('placed-d1').getByRole('button', { name: '收回' }).click(); await ready(page)
  await page.reload(); await ready(page)
  const data = (await saved(page)).data
  expect(data.progression.decorStock).toMatchObject({ chair: 2, planter: 0 })
  expect(data.progression.decorations).toHaveLength(1)
  expect(data.production.inventory.gold).toBe(830)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320)
  expect(errors).toEqual([])
})

test('sample materials under noon, dusk, midnight torch and max zoom; desktop frame timing recorded', async ({ page }, info) => {
  test.setTimeout(60_000)
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message))
  await page.goto('/'); await ready(page)
  await page.screenshot({ path: 'test-results/scene-art-initial.png' })
  await seed(page, data => {
    data.cell = { x: 8, y: 13 }; data.motion.position = data.cell
    data.economy.purchases = ['chair', 'planter']; data.progression.ownedDecor = ['chair', 'planter']
    data.progression.decorStock = { chair: 0, planter: 0 }; data.progression.nextDecorationId = 3
    data.progression.decorations = [{ id: 'd1', kind: 'chair', buildingId: 'b1', cell: { x: 8, y: 10 } },
      { id: 'd2', kind: 'planter', buildingId: 'b1', cell: { x: 9, y: 10 } }]
  })
  await page.screenshot({ path: 'test-results/scene-art-noon.png' })
  await walk(page, { x: 8, y: 11 })
  await expect(page.getByTestId('camp-scene')).toHaveAttribute('data-visible-roofs', '')
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-activity', 'idle')
  await page.mouse.move(195, 330); await page.mouse.wheel(0, -1000)
  await expect(page.getByTestId('camp-scene')).toHaveAttribute('data-camera', /,1.6$/)
  await page.screenshot({ path: 'test-results/scene-art-interior-max.png' })
  const timing = await frameTiming(page)
  await info.attach('desktop-frame-timing', { body: JSON.stringify(timing), contentType: 'application/json' })
  console.log('Scene sample desktop RAF timing:', timing)
  await changeTime(page, '黄昏'); await page.screenshot({ path: 'test-results/scene-art-dusk.png' })
  await changeTime(page, '深夜'); await page.getByTestId('torch-button').click()
  await expect(page.getByTestId('torch-button')).toHaveAttribute('data-lit', 'true')
  await page.screenshot({ path: 'test-results/scene-art-torch.png' })
  await changeTime(page, '☂ 雨'); await page.screenshot({ path: 'test-results/scene-art-rain.png' })
  expect(errors).toEqual([])
})

test('missing sample textures fall back without blocking saved camp or furniture UI', async ({ page }, info) => {
  test.setTimeout(60_000)
  await page.route('**/assets/survival/scene/*.png', route => route.abort())
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message))
  await seed(page, data => {
    data.economy.purchases = ['chair', 'planter']; data.progression.ownedDecor = ['chair', 'planter']
    data.progression.decorStock = { chair: 0, planter: 0 }; data.progression.nextDecorationId = 3
    data.progression.decorations = [{ id: 'd1', kind: 'chair', buildingId: 'b1', cell: { x: 8, y: 10 } },
      { id: 'd2', kind: 'planter', buildingId: 'b1', cell: { x: 9, y: 10 } }]
  })
  await expect(page.getByTestId('camp-scene')).toHaveAttribute('data-scene-art', '')
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-building-count', '1')
  await page.mouse.move(195, 330); await page.mouse.wheel(0, -1000)
  await expect(page.getByTestId('camp-scene')).toHaveAttribute('data-camera', /,1.6$/)
  const timing = await frameTiming(page)
  console.log('Vector fallback desktop RAF timing:', timing)
  await info.attach('fallback-frame-timing', { body: JSON.stringify(timing), contentType: 'application/json' })
  await page.screenshot({ path: 'test-results/scene-art-fallback-map.png' })
  await page.getByRole('button', { name: '商店', exact: true }).click()
  await page.getByTestId('shop').getByRole('button', { name: '装饰', exact: true }).click()
  await expect(page.getByTestId('product-chair').locator('image')).toHaveCount(0)
  await expect(page.getByTestId('product-chair').locator('svg[viewBox="0 0 80 80"]')).toHaveCount(1)
  await page.screenshot({ path: 'test-results/scene-art-fallback.png' })
  expect(errors).toEqual([])
})

test('textured roof keeps a destroyed tile missing and repairs only the selected segment', async ({ page }) => {
  await seed(page, data => {
    data.cell = { x: 8, y: 13 }; data.motion.position = data.cell
    const roof = data.construction.buildings[0].parts.roof
    roof.hp = 0
    roof.segments = Object.fromEntries([0, 1, 2].flatMap(x => [0, 1].map(y => [`tile${x}-${y}`, x === 1 ? 0 : 120])))
    const inv = data.production.inventory; inv.items[inv.board[7].instanceId].itemId = 202
  })
  await expect(page.getByTestId('camp-scene')).toHaveAttribute('data-visible-roofs', 'b1')
  await page.screenshot({ path: 'test-results/scene-art-roof-damaged.png' })
  await page.reload(); await ready(page)
  expect((await saved(page)).data.construction.buildings[0].parts.roof.segments['tile1-0']).toBe(0)
  const bubble = page.getByTestId('build-bubble-b1:roof:tile1-0')
  await tapSceneControl(page, bubble)
  await expect(bubble).toHaveCount(0, { timeout: 15_000 }); await ready(page)
  const data = (await saved(page)).data
  expect(data.construction.buildings[0].parts.roof.segments).toMatchObject({ 'tile1-0': 120, 'tile1-1': 0 })
  expect(data.construction.xp).toBe(70)
})

test('rest bench retains bed repair identity and display name after save reload', async ({ page }) => {
  await seed(page, data => {
    data.construction.buildings[0].parts.bed.hp = 0
    const inv = data.production.inventory; inv.items[inv.board[7].instanceId].itemId = 201
  })
  const bubble = page.getByTestId('build-bubble-b1:bed')
  await expect(bubble).toHaveAttribute('aria-label', /修复休憩长椅/)
  await tapSceneControl(page, bubble)
  await expect(bubble).toHaveCount(0, { timeout: 15_000 }); await ready(page)
  await page.reload(); await ready(page)
  const data = (await saved(page)).data
  expect(data.construction.buildings[0].parts.bed.hp).toBe(80)
  expect(data.construction.xp).toBe(70)
  await page.screenshot({ path: 'test-results/expanded-art-bench-repaired.png' })
})

test('dismantle decoration delivers pieces and preserves other stock across refresh', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 })
  await seed(page, data => {
    data.economy.purchases = ['table']; data.progression.ownedDecor = ['table']
    data.progression.decorStock = { table: 1 }; data.progression.nextDecorationId = 2
    data.progression.decorations = [{ id: 'd1', kind: 'table', buildingId: 'b1', cell: { x: 8, y: 10 } }]
  })
  const before = (await saved(page)).data
  const count = (data: any) => Object.values(data.production.inventory.items).filter((i: any) => i.itemId === 201).length
  await page.getByRole('button', { name: '装饰', exact: true }).click()
  await page.getByRole('button', { name: '已摆放', exact: true }).click()
  await page.screenshot({ path: 'test-results/decor-dismantle-panel.png' })
  await page.getByTestId('placed-d1').getByRole('button', { name: '拆除', exact: true }).click()
  await expect(page.getByTestId('placed-d1')).toHaveCount(0)
  await expect(page.getByTestId('decoration-panel').getByRole('status')).toContainText('木枝 ×2')
  await ready(page); await page.reload(); await ready(page)
  const after = (await saved(page)).data
  expect(after.progression.decorations).toEqual([])
  expect(after.progression.decorStock.table).toBe(1)
  expect(count(after)).toBe(count(before) + 2)
})
