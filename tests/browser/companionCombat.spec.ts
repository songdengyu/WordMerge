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
async function pauseAndSave(page: Page) {
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')))
  await ready(page); return readSave(page)
}
async function seed(page: Page, hp: number, thirdEnemy = false, approach = false) {
  await page.goto('/?game=survival'); await ready(page)
  const save = await pauseAndSave(page)
  await page.goto('/?game=legacy')
  await page.clock.install(); await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000))
  save.data.elapsedSeconds = 325; save.data.cell = { x: 10, y: 8 }
  save.data.motion = { version: 1, position: { ...save.data.cell } }
  const state = save.data.survival
  state.raidNight = 1; state.spawnRemaining = 80; state.decisionRemaining = 0
  Object.assign(state.companion, { status: 'active', hp, cell: { x: 6, y: 8 }, guard: { x: 6, y: 8 } })
  state.enemies = [{ id: 'e1', kind: 'prowler', hp: 32, cell: { x: 7, y: 8 }, route: [], progress: 0, target: null, cooldown: 0 }]
  if (approach) state.enemies[0].cell = { x: 9, y: 8 }
  if (thirdEnemy) state.enemies.push({ ...state.enemies[0], id: 'e2', cell: { ...save.data.cell }, target: { kind: 'player' } })
  state.nextEnemyId = thirdEnemy ? 3 : 2
  await page.evaluate(async value => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('wordmerge-survival', 1); r.onsuccess = () => resolve(r.result) })
    const tx = db.transaction('snapshots', 'readwrite'); tx.objectStore('snapshots').put(value, 'current'); tx.objectStore('snapshots').put(value.revision, 'revision')
    await new Promise<void>(resolve => { tx.oncomplete = () => resolve() }); db.close()
  }, save)
  await page.goto('/?game=survival'); await ready(page); await page.clock.runFor(600)
}

for (const clickDuringCombat of [false, true]) test(`companion control during battle switches to player only on a map tap: ${clickDuringCombat}`, async ({ page }) => {
  test.setTimeout(60000)
  await seed(page, 180, false, true)
  const scene = page.getByTestId('camp-scene'), game = page.getByTestId('survival-game')
  const tap = async (x: number, y: number, height = 0) => {
    const [cx, cy, zoom] = (await scene.getAttribute('data-camera'))!.split(',').map(Number)
    const rect = (await scene.boundingBox())!
    await page.touchscreen.tap(rect.x + cx + (x - y) * 32 * zoom, rect.y + cy + ((x + y) * 16 - height) * zoom)
  }
  const [x, y] = (await scene.getAttribute('data-companion-position'))!.split(',').map(Number)
  await tap(x, y, 18)
  await page.getByRole('dialog', { name: '栗栗指令盘' }).getByRole('button', { name: '移动', exact: true }).locator('span').click()
  await expect(game).toHaveAttribute('data-control', 'companion')
  await tap(9, 8)
  for (let i = 0; i < 30 && await scene.getAttribute('data-duel-phase') !== 'fighting'; i++) await page.clock.runFor(100)
  await expect(scene).toHaveAttribute('data-duel-phase', 'fighting')
  await expect(game).toHaveAttribute('data-control', 'companion')
  await expect(page.getByTestId('companion-control')).toContainText('点击地图切换为主角移动')
  if (clickDuringCombat) {
    await tap(8, 10)
    await page.clock.runFor(200)
    await expect(game).toHaveAttribute('data-control', 'player')
    await expect(game).toHaveAttribute('data-destination', '8,10')
    await expect(scene).toHaveAttribute('data-camera-follow', 'player')
    await expect(scene).toHaveAttribute('data-duel-phase', 'fighting')
  }
  await page.clock.runFor(4000)
  await expect(scene).toHaveAttribute('data-duel-phase', 'idle')
  await expect(game).toHaveAttribute('data-control', clickDuringCombat ? 'player' : 'companion')
  if (clickDuringCombat) {
    await expect(game).toHaveAttribute('data-player', '8,10')
    await expect(page.getByTestId('companion-control')).toHaveCount(0)
  } else {
    await expect(game).toHaveAttribute('data-player', '10,8')
    await tap(8, 10)
    await page.clock.runFor(3000)
    const arrived = (await scene.getAttribute('data-companion-position'))!.split(',').map(Number)
    expect(arrived[0]).toBeCloseTo(8, 2); expect(arrived[1]).toBeCloseTo(10, 2)
    await expect(game).toHaveAttribute('data-player', '10,8')
  }
})

test('smoke hides both fighters, survives pause and refresh, then shows victory and falling enemy exactly once', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await seed(page, 180, true)
  const scene = page.getByTestId('camp-scene')
  await expect(scene).toHaveAttribute('data-duel-phase', 'fighting')
  await page.screenshot({ path: 'test-results/companion-combat-smoke.png' })
  const fighting = await pauseAndSave(page)
  expect(fighting.data.survival.companion.hp).toBe(180)
  expect(fighting.data.survival.enemies[0].hp).toBe(32)
  expect(fighting.data.production.vitals.hp).toBe(98)
  expect(fighting.data.production.inventory.gold).toBe(0)
  await page.clock.runFor(3000)
  expect((await readSave(page)).data.survival).toEqual(fighting.data.survival)
  await page.reload(); await ready(page); await page.clock.runFor(100)
  await expect(scene).toHaveAttribute('data-duel-phase', 'fighting')
  await page.clock.runFor(Math.ceil(fighting.data.survival.duel.remaining * 1000) + 200)
  await expect(scene).toHaveAttribute('data-duel-phase', 'result')
  await page.screenshot({ path: 'test-results/companion-combat-victory.png' })
  const settled = await pauseAndSave(page)
  expect(settled.data.survival.companion.hp).toBe(174)
  expect(settled.data.survival.enemies.map((e: any) => e.id)).toEqual(['e2'])
  expect(settled.data.production.vitals.hp).toBe(96)
  expect(settled.data.production.inventory.gold).toBe(2)
  await page.reload(); await ready(page); await page.clock.runFor(1100)
  await expect(scene).toHaveAttribute('data-duel-phase', 'idle')
  expect((await readSave(page)).data.production.inventory.gold).toBe(2)
  expect(errors).toEqual([])
})

test('a defeated companion falls, remains injured after the enemy victory pose and reloads without loot', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await seed(page, 1)
  await expect(page.getByTestId('camp-scene')).toHaveAttribute('data-duel-phase', 'fighting')
  await page.clock.runFor(1750)
  await expect(page.getByTestId('camp-scene')).toHaveAttribute('data-duel-phase', 'result')
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-companion', 'injured')
  await page.screenshot({ path: 'test-results/companion-combat-defeat.png' })
  const saved = await pauseAndSave(page)
  expect(saved.data.survival.enemies[0].hp).toBe(18)
  expect(saved.data.production.inventory.gold).toBe(0)
  await page.reload(); await ready(page); await page.clock.runFor(1200)
  await expect(page.getByTestId('camp-scene')).toHaveAttribute('data-duel-phase', 'idle')
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-companion', 'injured')
  await expect(page.getByTestId('failure-panel')).toHaveCount(0)
  await page.screenshot({ path: 'test-results/companion-combat-injured.png' })
  expect(errors).toEqual([])
})
