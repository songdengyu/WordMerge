import { test, expect, type Page } from '@playwright/test'
import { tapSceneControl } from './sceneControls'

test.use({ baseURL: process.env.WORDMERGE_GAME_URL ?? 'http://127.0.0.1:5178' })

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
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide'))); await ready(page)
  const save = await readSave(page)
  await page.goto('/?game=legacy'); edit(save)
  save.data.motion = { version: 1, position: { ...save.data.cell } }
  await page.evaluate(async value => {
    const db = await new Promise<IDBDatabase>(resolve => { const req = indexedDB.open('wordmerge-survival', 1); req.onsuccess = () => resolve(req.result) })
    const tx = db.transaction('snapshots', 'readwrite'); tx.objectStore('snapshots').put(value, 'current'); tx.objectStore('snapshots').put(value.revision, 'revision')
    await new Promise<void>(resolve => { tx.oncomplete = () => resolve() }); db.close()
  }, save)
  await page.goto('/?game=survival'); await ready(page)
}

test('wild animal bubble creates a targeted order and recruits an additional controllable companion', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await seed(page, save => {
    save.data.survival.companion.status = 'active'
    save.data.survival.spawnRemaining = 160
    save.data.survival.enemies = [{ id: 'e1', kind: 'boar', hp: 70, cell: { x: 8, y: 9 }, route: [], progress: 0,
      target: null, cooldown: 0, roaming: true, tameable: true }]
    save.data.survival.nextEnemyId = 2
  })
  const bubble = page.getByTestId('taming-bubble-e1')
  await expect(bubble).toHaveAttribute('data-ready', 'false')
  await tapSceneControl(page, bubble)
  await expect(page.getByTestId('taming-order')).toContainText('驯服野猪')
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide'))); await ready(page)
  const ordered = await readSave(page)
  expect(ordered.data.survival.taming.targetId).toBe('e1')
  // Supply a real inventory item while the game is unloaded; all recruitment remains real UI input.
  await page.goto('/?game=legacy')
  ordered.data.production.inventory.items[ordered.data.production.inventory.board[9].instanceId].itemId = 213
  await page.evaluate(async value => {
    const db = await new Promise<IDBDatabase>(resolve => { const req = indexedDB.open('wordmerge-survival', 1); req.onsuccess = () => resolve(req.result) })
    const tx = db.transaction('snapshots', 'readwrite'); tx.objectStore('snapshots').put(value, 'current')
    await new Promise<void>(resolve => { tx.oncomplete = () => resolve() }); db.close()
  }, ordered)
  await page.goto('/'); await ready(page)
  await expect(bubble).toHaveAttribute('data-ready', 'true')
  await page.screenshot({ path: 'test-results/wild-taming-bubble.png' })
  await tapSceneControl(page, bubble)
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-activity', 'taming')
  await expect(page.getByTestId('camp-scene')).toHaveAttribute('data-recruits', /e1/)
  await expect(bubble).toHaveCount(0)
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-companion', 'active')
  const target = await page.getByTestId('camp-scene').evaluate(element => {
    const host = element as HTMLElement, [cx, cy, zoom] = host.dataset.camera!.split(',').map(Number)
    const { x, y } = JSON.parse(host.dataset.recruits!)[0], rect = host.getBoundingClientRect()
    return { x: rect.x + cx + (x - y) * 32 * zoom, y: rect.y + cy + ((x + y) * 16 - 18) * zoom }
  })
  await page.touchscreen.tap(target.x, target.y)
  await page.getByRole('combobox', { name: '选择伙伴' }).selectOption('e1')
  const wheel = page.getByRole('dialog', { name: '野猪指令盘' })
  await expect(wheel).toBeVisible()
  await page.screenshot({ path: 'test-results/recruited-boar-wheel.png' })
  await wheel.getByRole('button', { name: '移动', exact: true }).locator('span').click()
  await expect(page.getByTestId('companion-control')).toContainText('正在操控野猪')
  const destination = await page.getByTestId('camp-scene').evaluate(element => {
    const host = element as HTMLElement, [cx, cy, zoom] = host.dataset.camera!.split(',').map(Number), rect = host.getBoundingClientRect()
    return { x: rect.x + cx, y: rect.y + cy + 320 * zoom } // (10,10)
  })
  await page.touchscreen.tap(destination.x, destination.y)
  await expect.poll(async () => JSON.parse((await page.getByTestId('camp-scene').getAttribute('data-recruits'))!)[0]).toMatchObject({ id: 'e1', x: 10, y: 10 })
  await page.getByRole('button', { name: '取消操控' }).click()
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide'))); await ready(page)
  const saved = await readSave(page)
  expect(saved.data.survival.recruits).toHaveLength(1)
  expect(saved.data.survival.companion.status).toBe('active')
  await page.reload(); await ready(page)
  await expect(page.getByTestId('camp-scene')).toHaveAttribute('data-recruits', /e1/)
  expect(errors).toEqual([])
})

test('daytime spawn stays outside the actual camera with the live mobile camera', async ({ page }) => {
  await seed(page, save => { save.data.survival.spawnRemaining = .05 })
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide'))); await ready(page)
  const save = await readSave(page)
  expect(save.data.survival.enemies).toHaveLength(1)
  const animal = save.data.survival.enemies[0]
  const visible = await page.getByTestId('camp-scene').evaluate((element, cell) => {
    const host = element as HTMLElement, [cx, cy, zoom] = host.dataset.camera!.split(',').map(Number)
    const p = { x: cx + (cell.x - cell.y) * 32 * zoom, y: cy + (cell.x + cell.y) * 16 * zoom }
    return p.x >= 0 && p.x <= host.clientWidth && p.y >= 0 && p.y <= host.clientHeight
  }, animal.cell)
  expect(visible).toBe(false)
  expect(animal.roaming).toBe(true)
})

test('a wary animal becomes hostile while merging and permanently loses its taming bubble and order', async ({ page }) => {
  test.setTimeout(60000) // Render the full patience period while the merge board is open.
  await seed(page, save => {
    save.data.survival.spawnRemaining = 160
    save.data.survival.enemies = [{ id: 'e1', kind: 'boar', hp: 70, cell: { x: 8, y: 9 }, route: [], progress: 0,
      target: null, cooldown: 0, roaming: true, tameable: true }]
    save.data.survival.nextEnemyId = 2
  })
  await page.clock.install()
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 50))
  const scene = page.getByTestId('camp-scene'), bubble = page.getByTestId('taming-bubble-e1')
  await expect(scene).toHaveAttribute('data-alert-enemies', 'e1')
  const hp = Number(await page.getByTestId('survival-game').getAttribute('data-hp'))
  await page.screenshot({ path: 'test-results/animal-patience-warning.png' })
  await tapSceneControl(page, bubble)
  await page.clock.runFor(100)
  await expect(page.getByTestId('taming-order')).toContainText('驯服野猪')
  expect(Number(await page.getByTestId('survival-game').getAttribute('data-hp'))).toBe(hp)
  await page.clock.runFor(12000)
  await expect(page.getByTestId('taming-order')).toHaveCount(0)
  await expect(bubble).toHaveCount(0)
  await expect(scene).toHaveAttribute('data-alert-enemies', '')
  expect(Number(await page.getByTestId('survival-game').getAttribute('data-hp'))).toBeLessThan(hp)
  await page.getByRole('button', { name: '返回营地', exact: true }).click()
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')))
  await ready(page)
  expect((await readSave(page)).data.survival.enemies[0].tameable).toBe(false)
  await page.clock.resume()
  await page.reload(); await ready(page)
  await expect(bubble).toHaveCount(0)
  await expect(scene).toHaveAttribute('data-alert-enemies', '')
})

for (const select of ['companion', 'player'] as const) {
  test(`selecting another ${select} exits companion control and preserves its movement`, async ({ page }) => {
    await seed(page, save => {
      const survival = save.data.survival
      Object.assign(survival.companion, { status: 'active', cell: { x: 6, y: 9 }, guard: { x: 6, y: 9 },
        mode: 'guard', route: [], progress: 0, target: null, motion: { version: 1, position: { x: 6, y: 9 } } })
      survival.recruits = [{ id: 'e1', kind: 'boar', hp: 70, cell: { x: 9, y: 8 }, route: [], progress: 0,
        target: null, cooldown: 0, status: 'active', mode: 'guard', guard: { x: 9, y: 8 }, orderedEnemy: null, recoveryRemaining: 0 }]
      survival.nextEnemyId = 2
      survival.spawnRemaining = 160
      survival.enemies = []
    })
    await page.clock.install()
    await page.clock.pauseAt(Date.now() + 1000)
    const scene = page.getByTestId('camp-scene'), game = page.getByTestId('survival-game')
    const screenPoint = async (x: number, y: number, offset = 0) => scene.evaluate((element, p) => {
      const host = element as HTMLElement, [cx, cy, zoom] = host.dataset.camera!.split(',').map(Number)
      const rect = host.getBoundingClientRect()
      return { x: rect.x + cx + (p.x - p.y) * 32 * zoom, y: rect.y + cy + ((p.x + p.y) * 16 - p.offset) * zoom }
    }, { x, y, offset })
    const tap = async (x: number, y: number, offset = 0) => {
      const p = await screenPoint(x, y, offset)
      await page.touchscreen.tap(p.x, p.y)
    }
    await tap(6, 9, 18)
    await page.getByRole('dialog', { name: '栗栗指令盘' }).getByRole('button', { name: '移动', exact: true }).locator('span').click()
    await expect(game).toHaveAttribute('data-control', 'companion')
    await tap(10, 10)
    await page.clock.runFor(200)
    const inTransit = (await scene.getAttribute('data-companion-position'))!.split(',').map(Number)
    expect(inTransit[0]).toBeGreaterThan(6)
    expect(inTransit[0]).toBeLessThan(10)
    await expect(scene).toHaveAttribute('data-camera-follow', 'companion')
    const buddyOffset = await scene.evaluate(element => {
      const host = element as HTMLElement, [cx, cy, zoom] = host.dataset.camera!.split(',').map(Number)
      const [x, y] = host.dataset.companionPosition!.split(',').map(Number)
      return Math.hypot(cx + (x - y) * 32 * zoom - host.clientWidth / 2,
        cy + (x + y) * 16 * zoom - host.clientHeight / 2)
    })
    // Diagnostics hold the latest simulation step; the camera tracks the interpolated model.
    expect(buddyOffset).toBeLessThan(32)
    if (select === 'companion') {
      await page.mouse.move(170, 380); await page.mouse.down()
      await page.mouse.move(210, 410, { steps: 5 }); await page.mouse.up()
      await page.clock.runFor(100)
      await expect(scene).toHaveAttribute('data-camera-follow', '')
      const panned = await scene.getAttribute('data-camera')
      await page.clock.runFor(100)
      expect(await scene.getAttribute('data-camera')).toBe(panned)
      await tap(10, 10)
      await page.clock.runFor(100)
      await expect(scene).toHaveAttribute('data-camera-follow', 'companion')
    }
    if (select === 'player') {
      // Move the camera first, so clicking the protagonist must actually recenter it.
      const p = await screenPoint(7, 9)
      await page.mouse.move(p.x, p.y); await page.mouse.down()
      await page.mouse.move(p.x + 65, p.y + 40, { steps: 5 }); await page.mouse.up()
      await page.clock.runFor(50)
      const pannedCamera = await scene.getAttribute('data-camera')
      await tap(7, 9, 24)
      await page.clock.runFor(1500)
      expect(await scene.getAttribute('data-camera')).not.toBe(pannedCamera)
      const centered = await scene.evaluate(element => {
        const host = element as HTMLElement, [cx, cy, zoom] = host.dataset.camera!.split(',').map(Number)
        const [x, y] = host.dataset.position!.split(',').map(Number)
        return { dx: cx + (x - y) * 32 * zoom - host.clientWidth / 2,
          dy: cy + (x + y) * 16 * zoom - host.clientHeight / 2 }
      })
      expect(Math.abs(centered.dx)).toBeLessThan(1)
      expect(Math.abs(centered.dy)).toBeLessThan(1)
      await expect(page.getByRole('dialog', { name: /指令盘/ })).toHaveCount(0)
    } else {
      await tap(9, 8, 18)
      await expect(page.getByRole('dialog', { name: '野猪指令盘' })).toBeVisible()
      await expect(page.getByRole('combobox', { name: '选择伙伴' })).toHaveValue('e1')
    }
    await expect(game).toHaveAttribute('data-control', 'player')
    await expect(page.getByTestId('companion-control')).toHaveCount(0)
    await page.clock.runFor(5000)
    const arrived = (await scene.getAttribute('data-companion-position'))!.split(',').map(Number)
    expect(arrived[0]).toBeCloseTo(10, 2)
    expect(arrived[1]).toBeCloseTo(10, 2)
    await expect(game).toHaveAttribute('data-player', '7,9')
  })
}
