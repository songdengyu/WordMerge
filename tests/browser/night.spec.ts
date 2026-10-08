import { test, expect, type Page } from '@playwright/test'

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
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')))
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-save-state', 'saved')
  const save = await readSave(page)
  await page.goto('/?game=legacy'); edit(save)
  save.data.motion = { version: 1, position: { ...save.data.cell } }
  await page.evaluate(async value => {
    const db = await new Promise<IDBDatabase>(resolve => { const req = indexedDB.open('wordmerge-survival', 1); req.onsuccess = () => resolve(req.result) })
    const tx = db.transaction('snapshots', 'readwrite'); tx.objectStore('snapshots').put(value, 'current')
    tx.objectStore('snapshots').put(value.revision, 'revision')
    await new Promise<void>(resolve => { tx.oncomplete = () => resolve() }); db.close()
  }, save)
  await page.goto('/?game=survival'); await ready(page)
}
function cabin(save: any) {
  save.data.construction = { unlockedBlueprints: ['cabin'], nextId: 2, xp: 70, orders: [], jobs: [], buildings: [{
    id: 'b1', blueprintId: 'cabin', origin: { x: 7, y: 10 }, rotation: 0,
    parts: Object.fromEntries(Object.entries({ foundation: 100, walls: 20, door: 100, roof: 120, bed: 80 }).map(([id, hp]) => [id, { built: true, hp, xpGranted: true }])),
  }] }
  save.data.cell = { x: 8, y: 11 }
}

test('a food rescue recruits a real companion, commands and supply consumption survive reload', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await seed(page, save => {
    const inventory = save.data.production.inventory
    inventory.items[inventory.board[9].instanceId].itemId = 213
  })
  await page.getByRole('button', { name: '伙伴与生存' }).click()
  await expect(page.getByTestId('companion-state')).toHaveText('待救助')
  await page.getByRole('button', { name: '前往驯服' }).click()
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-companion', 'active')
  await page.getByRole('button', { name: '伙伴与生存' }).click()
  await expect(page.getByTestId('companion-state')).toHaveText('健康')
  await page.getByRole('button', { name: '跟随我', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('跟随')
  await page.screenshot({ path: 'test-results/m4-companion.png' })
  await page.getByRole('button', { name: '驻守此处' }).click()
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-save-state', 'saved')
  const saved = await readSave(page)
  expect(saved.data.production.inventory.board[9].instanceId).toBeNull()
  expect(saved.data.survival.companion.mode).toBe('guard')
  await page.reload(); await ready(page)
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-companion', 'active')
  await page.getByRole('button', { name: '伙伴与生存' }).click()
  await expect(page.getByRole('button', { name: '前往驯服' })).toHaveCount(0)
  expect(errors).toEqual([])
})

test('night attacks and companion defense continue behind merge, pause in background and persist damage', async ({ page }) => {
  test.setTimeout(60_000)
  await seed(page, save => {
    cabin(save); save.data.elapsedSeconds = 325; save.data.survival.raidNight = 1
    const state = save.data.survival
    Object.assign(state.companion, { status: 'active', cell: { x: 8, y: 11 }, guard: { x: 8, y: 11 } })
    state.enemies = [{ id: 'e1', kind: 'boar', hp: 70, cell: { x: 8, y: 12 }, route: [], progress: 0, target: null, cooldown: 0 }]
    state.nextEnemyId = 2; state.spawnRemaining = 80
  })
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-enemies', '1')
  await page.screenshot({ path: 'test-results/m4-night-map.png' })
  await page.getByRole('button', { name: '合成物资' }).click()
  const workshop = page.getByTestId('production-screen')
  await expect(workshop.getByTestId('camp-threat')).toHaveCount(0)
  await expect.poll(async () => (await readSave(page)).data.construction.buildings[0].parts.door.hp).toBeLessThan(100)
  await page.screenshot({ path: 'test-results/m4-night-workshop.png' })
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')))
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-save-state', 'saved')
  const paused = await readSave(page)
  await page.clock.install(); await page.clock.runFor(1000)
  expect((await readSave(page)).data.survival).toEqual(paused.data.survival)
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow')))
  await page.clock.runFor(12_000)
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-enemies', '0')
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-save-state', 'saved')
  const saved = await readSave(page)
  expect(saved.data.production.inventory.gold).toBe(4)
  expect(saved.data.construction.buildings[0].parts.door.hp).toBeLessThan(100)
  expect(saved.data.survival.companion.hp).toBeLessThan(180)
  await page.reload(); await ready(page)
  expect((await readSave(page)).data.production.inventory.gold).toBe(4)
})

test('player defeat closes merge, survives reload and rescue settles the same loss once', async ({ page }) => {
  await seed(page, save => {
    save.data.production.vitals = { hp: 1, hunger: 0, water: 0, temperature: 10 }
    save.data.survival.environmentRemaining = 2
  })
  await page.getByRole('button', { name: '合成物资' }).click()
  await expect(page.getByTestId('failure-panel')).toBeVisible()
  await expect(page.getByTestId('production-screen')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '接受救援' })).toBeEnabled()
  const failed = await readSave(page)
  expect(failed.data.survival.failure.losses).toHaveLength(2)
  await page.screenshot({ path: 'test-results/m4-failure.png' })
  await page.reload(); await ready(page)
  await expect(page.getByTestId('failure-panel')).toBeVisible()
  expect((await readSave(page)).data.survival.failure).toEqual(failed.data.survival.failure)
  await page.getByRole('button', { name: '接受救援' }).click()
  await expect(page.getByTestId('failure-panel')).toHaveCount(0)
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-paused', 'false')
  await expect(page.getByTestId('vital-hp')).toHaveAttribute('data-value', '70')
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-save-state', 'saved')
  const rescued = await readSave(page)
  expect(rescued.data.survival.rescuedCount).toBe(1)
  expect(Object.keys(rescued.data.production.inventory.items).length).toBe(Object.keys(failed.data.production.inventory.items).length - 2)
  await page.reload(); await ready(page)
  expect((await readSave(page)).data.production.inventory).toEqual(rescued.data.production.inventory)
  await expect(page.getByTestId('failure-panel')).toHaveCount(0)
})

test('rain protection, forecast and bed recovery are usable on a small phone', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 })
  await seed(page, save => {
    cabin(save); save.data.production.vitals.hp = 70; save.data.production.vitals.temperature = 40
    save.data.survival.weather = 'rain'
  })
  await expect(page.getByTestId('camp-scene')).toHaveAttribute('data-weather', 'rain')
  await page.getByRole('button', { name: '伙伴与生存' }).click()
  await expect(page.getByRole('dialog')).toContainText('今日雨 · 明日预计多云')
  await page.getByRole('button', { name: '床边休养' }).click()
  await expect(page.getByRole('button', { name: '结束休养' })).toBeVisible()
  await expect.poll(async () => (await readSave(page)).data.production.vitals.hp).toBeGreaterThan(70)
  await page.screenshot({ path: 'test-results/m4-care-small.png' })
  await page.getByRole('button', { name: '关闭照护' }).click()
  await page.screenshot({ path: 'test-results/m4-rain-small.png' })
})
