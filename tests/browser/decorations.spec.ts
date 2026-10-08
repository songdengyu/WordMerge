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
async function seed(page: Page, edit?: (save: any) => void) {
  await page.goto('/'); await ready(page)
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide'))); await ready(page)
  const save = await readSave(page); await page.goto('/?game=legacy')
  save.data.production.inventory.gold = 300
  save.data.construction = { unlockedBlueprints: ['cabin'], nextId: 2, xp: 70, orders: [], jobs: [], buildings: [{ id: 'b1', blueprintId: 'cabin', origin: { x: 7, y: 10 }, rotation: 0,
    parts: Object.fromEntries(Object.entries({ foundation: 100, walls: 20, door: 100, roof: 120, bed: 80 }).map(([id, hp]) => [id, { built: true, hp, xpGranted: true }])) }] }
  edit?.(save)
  await page.evaluate(async value => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('wordmerge-survival', 1); r.onsuccess = () => resolve(r.result) })
    const tx = db.transaction('snapshots', 'readwrite'); tx.objectStore('snapshots').put(value, 'current'); tx.objectStore('snapshots').put(value.revision, 'revision')
    await new Promise<void>(resolve => { tx.oncomplete = () => resolve() }); db.close()
  }, save)
  await page.goto('/'); await ready(page)
}

test('new decoration focuses and defaults to the nearest house instead of the first built house', async ({ page }) => {
  await seed(page, save => {
    save.data.construction.buildings.push({ ...structuredClone(save.data.construction.buildings[0]), id: 'b2', origin: { x: 7, y: 4 } })
    save.data.construction.nextId = 3
    save.data.construction.xp = 140
    save.data.cell = { x: 10, y: 4 }
    save.data.motion = { version: 1, position: { x: 10, y: 4 } }
  })
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-building-count', '2')
  await page.getByRole('button', { name: '商店', exact: true }).click()
  await page.getByTestId('shop').getByRole('button', { name: '装饰', exact: true }).click()
  await page.getByTestId('buy-rug').click()
  await page.getByRole('button', { name: '打开装饰收藏' }).click()
  await page.getByTestId('decor-stock-rug').getByRole('button', { name: '摆放' }).click()
  await expect(page.getByTestId('decoration-placement')).toBeVisible()
  await expect(page.getByTestId('camp-scene')).toHaveAttribute('data-visible-roofs', '')
  const centered = await page.getByTestId('camp-scene').evaluate(element => {
    const [x, y, zoom] = (element as HTMLElement).dataset.camera!.split(',').map(Number)
    return { x: x + (8 - 4.5) * 32 * zoom - element.clientWidth / 2,
      y: y + (8 + 4.5) * 16 * zoom - element.clientHeight / 2 - Math.min(40, element.clientHeight * .06) }
  })
  expect(Math.abs(centered.x)).toBeLessThan(2)
  expect(Math.abs(centered.y)).toBeLessThan(2)
  await page.getByRole('button', { name: '确认摆放', exact: true }).click()
  await expect(page.getByTestId('camp-scene')).toHaveAttribute('data-decorations', '1')
  await ready(page)
  expect((await readSave(page)).data.progression.decorations[0].buildingId).toBe('b2')
  await expect(page.getByTestId('camp-scene')).toHaveAttribute('data-visible-roofs', 'b1,b2')
})

for (const rotation of [0, 1]) test(`roof hides indoors and door swings both ways with rotation ${rotation}`, async ({ page }) => {
  const inside = rotation === 0 ? { x: 8, y: 10 } : { x: 7, y: 12 }
  const outside = rotation === 0 ? { x: 8, y: 13 } : { x: 4, y: 10 }
  await seed(page, save => {
    save.data.construction.buildings[0].rotation = rotation
    save.data.cell = outside
    save.data.motion = { version: 1, position: outside }
  })
  const scene = page.getByTestId('camp-scene'), game = page.getByTestId('survival-game')
  const doorAmount = async () => JSON.parse((await scene.getAttribute('data-door-amounts')) ?? '{}')['b1:door:whole']
  const walkTo = async (cell: { x: number; y: number }) => {
    const [x, y, zoom] = (await scene.getAttribute('data-camera'))!.split(',').map(Number)
    const box = (await scene.boundingBox())!
    await page.touchscreen.tap(box.x + x + (cell.x - cell.y) * 32 * zoom, box.y + y + (cell.x + cell.y) * 16 * zoom)
  }
  await expect(scene).toHaveAttribute('data-visible-roofs', 'b1')
  await expect.poll(doorAmount).toBe(0)
  await page.screenshot({ path: `test-results/roof-outside-${rotation}.png` })
  await walkTo(inside)
  await expect.poll(doorAmount, { intervals: [50, 100] }).toBeGreaterThan(0)
  await expect(game).toHaveAttribute('data-player', `${inside.x},${inside.y}`)
  await expect(game).toHaveAttribute('data-activity', 'idle')
  await expect(scene).toHaveAttribute('data-visible-roofs', '')
  await expect.poll(doorAmount).toBe(0)
  await page.screenshot({ path: `test-results/roof-inside-${rotation}.png` })
  await walkTo(outside)
  await expect.poll(doorAmount, { intervals: [50, 100] }).toBeGreaterThan(0)
  await expect(game).toHaveAttribute('data-player', `${outside.x},${outside.y}`)
  await expect(game).toHaveAttribute('data-activity', 'idle')
  await expect(scene).toHaveAttribute('data-visible-roofs', 'b1')
  await expect.poll(doorAmount).toBe(0)
})

test('destroyed roof and door are not restored by their appearance layer', async ({ page }) => {
  await seed(page, save => {
    save.data.construction.buildings[0].parts.roof.hp = 0
    save.data.construction.buildings[0].parts.door.hp = 0
  })
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-building-count', '1')
  await expect(page.getByTestId('camp-scene')).toHaveAttribute('data-visible-roofs', '')
  await expect(page.getByTestId('camp-scene')).toHaveAttribute('data-door-amounts', '{}')
})

test('decoration collection buys and places multiple copies, returns one, changes skin and survives reload on a small phone', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 })
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message))
  await seed(page)
  await page.getByRole('button', { name: '营地手记', exact: true }).click()
  await expect(page.getByRole('button', { name: '装扮', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '关闭手记' }).click()
  await page.getByRole('button', { name: '装饰', exact: true }).click()
  await expect(page.getByTestId('decoration-panel')).toBeVisible()
  await page.getByRole('button', { name: '去商店添置' }).click()
  await page.getByTestId('shop').getByRole('button', { name: '装饰', exact: true }).click()
  await page.getByTestId('buy-rug').click()
  await expect(page.getByTestId('shop-gold')).toHaveText('240')
  await page.getByTestId('buy-rug').click()
  await expect(page.getByTestId('shop-gold')).toHaveText('180')
  await page.getByRole('button', { name: '衣裳', exact: true }).click()
  await page.getByTestId('buy-rose').click()
  await expect(page.getByTestId('shop-gems')).toHaveText('88')
  await page.getByRole('button', { name: '打开装饰收藏' }).click()
  await expect(page.getByTestId('decor-count-rug')).toHaveText('2')
  await page.getByRole('button', { name: '人物皮肤', exact: true }).click()
  await page.getByRole('button', { name: /蔷薇旧衫/ }).click()
  await expect(page.getByTestId('camp-scene')).toHaveAttribute('data-outfit', 'rose')
  await page.getByRole('button', { name: '摆件', exact: true }).click()
  await page.screenshot({ path: 'test-results/decoration-stock-small.png' })
  await page.getByTestId('decor-stock-rug').getByRole('button', { name: '摆放' }).click()
  await page.getByTestId('decoration-placement').getByRole('button', { name: '取消', exact: true }).click()
  await page.getByRole('button', { name: '装饰', exact: true }).click()
  await expect(page.getByTestId('decor-count-rug')).toHaveText('2')
  for (let n = 1; n <= 2; n++) {
    await page.getByTestId('decor-stock-rug').getByRole('button', { name: '摆放' }).click()
    await page.getByRole('button', { name: '确认摆放', exact: true }).click()
    await expect(page.getByTestId('camp-scene')).toHaveAttribute('data-decorations', String(n))
    await page.getByRole('button', { name: '装饰', exact: true }).click()
    await expect(page.getByTestId('decor-count-rug')).toHaveText(String(2 - n))
  }
  await expect(page.getByTestId('decor-stock-rug').getByRole('button')).toBeDisabled()
  await page.getByRole('button', { name: '已摆放', exact: true }).click()
  await expect(page.getByTestId('placed-d1')).toBeVisible()
  await expect(page.getByTestId('placed-d2')).toBeVisible()
  await page.getByTestId('placed-d1').getByRole('button', { name: '移动' }).click()
  await page.getByRole('button', { name: '确认摆放', exact: true }).click()
  await page.getByRole('button', { name: '装饰', exact: true }).click()
  await expect(page.getByTestId('decor-count-rug')).toHaveText('0')
  await page.getByRole('button', { name: '已摆放', exact: true }).click()
  await page.getByTestId('placed-d1').getByRole('button', { name: '收回' }).click()
  await expect(page.getByTestId('placed-d1')).toHaveCount(0)
  await expect(page.getByTestId('placed-d2')).toBeVisible()
  await page.screenshot({ path: 'test-results/decoration-placed-small.png' })
  await ready(page); await page.reload(); await ready(page)
  await expect(page.getByTestId('camp-scene')).toHaveAttribute('data-decorations', '1')
  await expect(page.getByTestId('camp-scene')).toHaveAttribute('data-outfit', 'rose')
  await page.getByRole('button', { name: '装饰', exact: true }).click()
  await expect(page.getByTestId('decor-count-rug')).toHaveText('1')
  const saved = await readSave(page)
  expect(saved.data.progression.decorations[0].id).toBe('d2')
  expect(saved.data.production.inventory.gold).toBe(180)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320)
  expect(errors).toEqual([])
})
