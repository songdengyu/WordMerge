import { test, expect, type Page } from '@playwright/test'
import { tapSceneControl } from './sceneControls'

async function ready(page: Page) {
  await expect(page.getByTestId('camp-scene')).toHaveAttribute('data-ready', 'true')
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-save-state', 'saved')
}
async function readSave(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const req = indexedDB.open('wordmerge-survival', 1); req.onsuccess = () => resolve(req.result) })
    try { return await new Promise<any>(resolve => { const req = db.transaction('snapshots').objectStore('snapshots').get('current'); req.onsuccess = () => resolve(req.result) }) } finally { db.close() }
  })
}
async function seed(page: Page, edit: (save: any) => void) {
  await page.goto('/?game=survival'); await ready(page)
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')))
  await ready(page); const save = await readSave(page)
  await page.goto('/'); edit(save)
  save.data.motion = { version: 1, position: { ...save.data.cell } }
  await page.evaluate(async value => {
    const db = await new Promise<IDBDatabase>(resolve => { const req = indexedDB.open('wordmerge-survival', 1); req.onsuccess = () => resolve(req.result) })
    const tx = db.transaction('snapshots', 'readwrite'); tx.objectStore('snapshots').put(value, 'current'); tx.objectStore('snapshots').put(value.revision, 'revision')
    await new Promise<void>(resolve => { tx.oncomplete = () => resolve() }); db.close()
  }, save)
  await page.goto('/?game=survival'); await ready(page)
}
function prepared(save: any, count: number) {
  const data = save.data
  data.construction = { unlockedBlueprints: ['cabin'], nextId: 2, xp: 70, orders: [], jobs: [], buildings: [{ id: 'b1', blueprintId: 'cabin', origin: { x: 7, y: 10 }, rotation: 0,
    parts: Object.fromEntries(Object.entries({ foundation: 100, walls: 20, door: 100, roof: 120, bed: 80 }).map(([id, hp]) => [id, { built: true, hp, xpGranted: true }])) }] }
  data.survival.companion.status = 'active'
  const ids = ['letter', 'foundation', 'friend', 'visitor', 'shelter', 'grove'], choices = ['truth', 'keep', 'together', 'welcome', 'light', 'promise']
  const progress = data.progression
  progress.completed = ids.slice(0, count); progress.choices = Object.fromEntries(ids.slice(0, count).map((id, i) => [id, choices[i]]))
  progress.ownedDecor = count > 4 ? ['rug', 'planter', 'lantern'] : count > 3 ? ['rug', 'planter'] : ['rug']
  progress.ownedOutfits = count > 5 ? ['clay', 'sage', 'rose'] : ['clay', 'sage']
  if (count > 3) { progress.unlockedRegions = ['brook']; progress.discoveries = ['brook'] }
  if (count > 5) { progress.unlockedRegions.push('grove'); progress.discoveries.push('grove') }
}
function supply(save: any, itemId: number) {
  const inv = save.data.production.inventory, index = inv.board.findIndex((s: any) => s.lock === 0 && !s.instanceId), id = `i${inv.nextId++}`
  inv.board[index].instanceId = id; inv.items[id] = { id, itemId, location: { kind: 'board', index }, reservedBy: null }
}
async function next(page: Page) {
  const text = await page.getByTestId('story-dialogue').innerText()
  await page.getByRole('button', { name: '继续', exact: true }).click()
  await expect(page.getByTestId('story-dialogue')).not.toHaveText(text)
  await ready(page)
}

test('the opening story pauses, resumes its exact page after reload, and records only one choice', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto('/?game=survival'); await ready(page)
  await page.getByRole('button', { name: '营地手记', exact: true }).click()
  await expect(page.getByTestId('chapter-card')).toContainText('一封迟来的信')
  await page.screenshot({ path: 'test-results/m5-journal.png' })
  await page.getByRole('button', { name: '继续故事' }).click()
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-paused', 'true')
  await next(page)
  const time = await page.getByTestId('game-clock').getAttribute('data-minute')
  await page.waitForTimeout(1000)
  expect(await page.getByTestId('game-clock').getAttribute('data-minute')).toBe(time)
  await page.reload(); await ready(page)
  await expect(page.getByTestId('story-dialogue')).toContainText('2/3')
  await page.screenshot({ path: 'test-results/m5-story.png' })
  await next(page)
  await page.getByRole('button', { name: '我要找到寄信的人' }).click()
  await expect(page.getByTestId('story-dialogue')).toHaveCount(0)
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-chapter', 'foundation')
  await page.reload(); await ready(page)
  await page.getByRole('button', { name: '营地手记', exact: true }).click()
  await page.getByRole('button', { name: '回忆', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('我要找到寄信的人')
  expect((await readSave(page)).data.progression.completed).toEqual(['letter'])
  expect(errors).toEqual([])
})

test('experience unlocks a real region, exploration persists outside camp and a visitor consumes supplies once', async ({ page }) => {
  test.setTimeout(60_000)
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await seed(page, save => { prepared(save, 3); supply(save, 212); supply(save, 222) })
  await expect(page.getByRole('button', { name: '营地地图', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '营地手记', exact: true }).click()
  await page.getByRole('button', { name: '前往完成目标' }).click()
  await expect(page.locator('[data-testid^="region-sign-brook-"]')).toHaveCount(1)
  await tapSceneControl(page, page.getByTestId('region-sign-brook-south'))
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-activity', 'unlocking', { timeout: 15000 })
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-protected', 'true')
  await page.screenshot({ path: 'test-results/region-unlocking.png' })
  await expect(page.getByTestId('camp-scene')).toHaveAttribute('data-regions', 'brook')
  await expect(page.locator('[data-testid^="region-sign-brook-"]')).toHaveCount(0)
  await expect(page.locator('[data-testid^="region-sign-grove-"]')).toHaveCount(1)
  await page.screenshot({ path: 'test-results/m5-regions.png' })
  await page.getByRole('button', { name: '营地手记', exact: true }).click()
  await page.getByRole('button', { name: '前往完成目标' }).click()
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-player', '7,-5', { timeout: 15000 })
  await ready(page); await page.screenshot({ path: 'test-results/m5-brook.png' })
  await page.reload(); await ready(page)
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-player', '7,-5')
  await expect(page.getByTestId('camp-scene')).toHaveAttribute('data-regions', 'brook')
  await page.getByRole('button', { name: '营地手记', exact: true }).click()
  await page.getByRole('button', { name: '继续故事' }).click()
  await next(page); await next(page)
  await page.getByRole('button', { name: '你认识母亲，也认识寄信的人？' }).click()
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-chapter', 'shelter'); await ready(page)
  const saved = await readSave(page)
  expect(Object.values<any>(saved.data.production.inventory.items).filter(item => item.itemId === 102)).toHaveLength(1)
  expect(Object.values<any>(saved.data.production.inventory.items).filter(item => [212, 222].includes(item.itemId))).toHaveLength(0)
  expect(saved.data.progression.choices.visitor).toBe('ask')
  await page.reload(); await ready(page)
  expect((await readSave(page)).data.progression.ownedDecor).toContain('planter')
  expect(errors).toEqual([])
})

test('adjacent native signposts scale with the map, show missing XP and keep saves in settings', async ({ page }) => {
  await seed(page, save => { save.data.cell = { x: 7, y: 1 } })
  const signs = page.locator('[data-testid^="region-sign-"]'), sign = page.getByTestId('region-sign-brook-south')
  await expect(signs).toHaveCount(2)
  await expect(sign).toHaveAttribute('data-renderer', 'pixi')
  await expect(sign).toHaveAttribute('data-ready', 'false')
  await expect(sign).toHaveAccessibleName(/建筑经验 0\/30/)
  const before = (await sign.boundingBox())!
  await page.getByRole('button', { name: '放大地图' }).click()
  await expect.poll(async () => (await sign.boundingBox())!.width).toBeGreaterThan(before.width * 1.1)
  await page.screenshot({ path: 'test-results/region-sign-missing-xp.png' })
  await tapSceneControl(page, sign)
  await expect(page.getByRole('status')).toContainText('建筑经验 0/30')
  expect((await readSave(page)).data.progression.unlockedRegions).toEqual([])
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('本机存档')
  await expect(page.getByRole('button', { name: '营地地图', exact: true })).toHaveCount(0)
})

test('sign work pauses in background, resumes after reload and removes the region signs', async ({ page }) => {
  await seed(page, save => { prepared(save, 3); save.data.cell = { x: 7, y: 0 } })
  await page.clock.install(); await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000))
  const sign = page.getByTestId('region-sign-brook-south')
  await expect(sign).toHaveAttribute('data-ready', 'true')
  await tapSceneControl(page, sign); await page.clock.runFor(500)
  await expect(sign).toHaveAttribute('data-phase', 'unlocking')
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide'))); await ready(page)
  const saved = await readSave(page)
  expect(saved.data.progression.regionUnlock.remaining).toBeGreaterThan(0)
  await page.clock.runFor(5000)
  expect((await readSave(page)).data.progression.regionUnlock).toEqual(saved.data.progression.regionUnlock)
  await page.reload(); await ready(page)
  await page.clock.runFor(50)
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-activity', 'unlocking')
  await page.clock.runFor(2100)
  await expect(page.getByTestId('camp-scene')).toHaveAttribute('data-regions', 'brook')
  await expect(page.locator('[data-testid^="region-sign-brook-"]')).toHaveCount(0)
  await expect(page.locator('[data-testid^="region-sign-grove-"]')).toHaveCount(1)
  await ready(page)
  expect((await readSave(page)).data.construction.xp).toBe(70)
})

test('old map-tab saves preserve unlocked land and the west sign opens the other region without story prerequisites', async ({ page }) => {
  await seed(page, save => {
    prepared(save, 4); save.data.cell = { x: 15, y: 7 }
    save.configVersion = save.configVersion.replace(/[^-]+$/, '7a73e35c')
    delete save.data.progression.regionUnlock
  })
  await expect(page.locator('[data-testid^="region-sign-brook-"]')).toHaveCount(0)
  const sign = page.getByTestId('region-sign-grove-west')
  await expect(sign).toHaveAttribute('data-ready', 'true')
  await tapSceneControl(page, sign)
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-activity', 'unlocking')
  await expect(page.getByTestId('camp-scene')).toHaveAttribute('data-regions', 'brook,grove')
  await expect(page.locator('[data-testid^="region-sign-"]')).toHaveCount(0)
  await ready(page); await page.reload(); await ready(page)
  expect((await readSave(page)).data.progression.completed).toEqual(['letter', 'foundation', 'friend', 'visitor'])
  expect((await readSave(page)).data.progression.unlockedRegions).toEqual(['brook', 'grove'])
})

test('small-phone wardrobe and floor decorations visibly persist and the final chapter completes', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 })
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await seed(page, save => { prepared(save, 6); save.data.progression.witnessedDawn = true })
  await page.getByRole('button', { name: '营地手记', exact: true }).click()
  await page.getByRole('button', { name: '装扮', exact: true }).click()
  await page.getByRole('button', { name: /蔷薇旧衫/ }).click()
  await expect(page.getByTestId('camp-scene')).toHaveAttribute('data-outfit', 'rose')
  await page.screenshot({ path: 'test-results/m5-wardrobe-small.png' })
  await page.getByRole('button', { name: '摆放', exact: true }).first().click()
  await expect(page.getByTestId('decoration-placement')).toContainText('这里可以摆放')
  await page.getByRole('button', { name: '确认摆放', exact: true }).click()
  await expect(page.getByTestId('camp-scene')).toHaveAttribute('data-decorations', '1')
  await ready(page); await page.reload(); await ready(page)
  await expect(page.getByTestId('camp-scene')).toHaveAttribute('data-outfit', 'rose')
  await expect(page.getByTestId('camp-scene')).toHaveAttribute('data-decorations', '1')
  await page.screenshot({ path: 'test-results/m5-decor-small.png' })
  await page.getByRole('button', { name: '营地手记', exact: true }).click()
  await page.getByRole('button', { name: '继续故事' }).click()
  await next(page); await next(page)
  await page.getByRole('button', { name: '先好好过今天' }).click()
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-chapter', 'complete')
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320)
  expect(errors).toEqual([])
})

test('M4 saves migrate without resetting simulation and existing buildings can satisfy new story objectives', async ({ page }) => {
  await seed(page, save => {
    prepared(save, 3); delete save.data.progression
    save.schemaVersion = 3; save.configVersion = ['m4', ...save.configVersion.split('-').slice(1, 5)].join('-')
    save.data.production.stamina.value = 140
  })
  await expect(page.getByTestId('map-stamina')).toHaveText('140')
  await expect(page.getByTestId('building-xp')).toHaveText('70')
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-chapter', 'letter')
  expect((await readSave(page)).schemaVersion).toBe(4)
  await page.getByRole('button', { name: '营地手记', exact: true }).click()
  await page.getByRole('button', { name: '继续故事' }).click(); await next(page); await next(page)
  await page.getByRole('button', { name: '先把这里变成家' }).click()
  await expect(page.getByTestId('story-dialogue')).toHaveCount(0)
  await page.getByRole('button', { name: '营地手记', exact: true }).click()
  await expect(page.getByRole('button', { name: '继续故事' })).toBeEnabled()
})
