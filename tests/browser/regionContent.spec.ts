import { test, expect, type Page } from '@playwright/test'
import { tapSceneControl } from './sceneControls'

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
  await page.goto('/?game=survival'); await ready(page)
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide'))); await ready(page)
  const save = await readSave(page); await page.goto('/')
  save.data.construction = { unlockedBlueprints: ['cabin'], nextId: 2, xp: 70, orders: [], jobs: [], buildings: [{ id: 'b1', blueprintId: 'cabin', origin: { x: 7, y: 10 }, rotation: 0,
    parts: Object.fromEntries(Object.entries({ foundation: 100, walls: 20, door: 100, roof: 120, bed: 80 }).map(([id, hp]) => [id, { built: true, hp, xpGranted: true }])) }] }
  save.data.progression.unlockedRegions = ['brook', 'grove']
  delete save.data.progression.regionContent
  edit(save); save.data.motion = { version: 1, position: { ...save.data.cell } }
  await page.evaluate(async value => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('wordmerge-survival', 1); r.onsuccess = () => resolve(r.result) })
    const tx = db.transaction('snapshots', 'readwrite'); tx.objectStore('snapshots').put(value, 'current'); tx.objectStore('snapshots').put(value.revision, 'revision')
    await new Promise<void>(resolve => { tx.oncomplete = () => resolve() }); db.close()
  }, save)
  await page.goto('/?game=survival'); await ready(page)
}

test('three regional boars appear in old unlocked saves, attack nearby in daylight and persist on refresh', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await seed(page, save => { save.data.cell = { x: 7, y: -9 } })
  await expect(page.getByTestId('camp-scene')).toHaveAttribute('data-resident-boars', '3')
  const hp = (await readSave(page)).data.production.vitals.hp
  await expect.poll(async () => (await readSave(page)).data.production.vitals.hp, { timeout: 6000 }).toBeLessThan(hp)
  await page.screenshot({ path: 'test-results/brook-resident-boars.png' })
  const before = (await readSave(page)).data.survival.enemies.map((e: any) => e.residentId)
  await page.reload(); await ready(page)
  await expect(page.getByTestId('camp-scene')).toHaveAttribute('data-resident-boars', '3')
  expect((await readSave(page)).data.survival.enemies.map((e: any) => e.residentId)).toEqual(before)
  expect(errors).toEqual([])
})

test('a large fixed foundation appears in the grove, builds through its material bubble and survives refresh', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await seed(page, save => {
    save.data.cell = { x: 27, y: 5 }
    const inv = save.data.production.inventory
    for (let i = 0; i < 2; i++) {
      const index = inv.board.findIndex((s: any) => s.lock === 0 && !s.instanceId), id = `i${inv.nextId++}`
      inv.items[id] = { id, itemId: 203, reservedBy: null, location: { kind: 'board', index } }; inv.board[index].instanceId = id
    }
  })
  const bubble = page.getByTestId('build-bubble-b2:foundation')
  await expect(bubble).toHaveAccessibleName(/大屋地基/)
  await expect(bubble).toHaveAttribute('data-ready', 'true')
  await expect(page.getByTestId('remove-b2')).toHaveCount(0)
  await page.screenshot({ path: 'test-results/grove-large-foundation.png' })
  await tapSceneControl(page, bubble)
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-activity', 'building')
  await expect(page.getByTestId('build-bubble-b2:walls')).toBeVisible()
  await ready(page)
  const saved = await readSave(page), lodge = saved.data.construction.buildings.find((b: any) => b.blueprintId === 'lodge')
  expect(lodge.parts.foundation.built).toBe(true)
  expect(saved.data.construction.xp).toBe(90)
  await page.reload(); await ready(page)
  expect((await readSave(page)).data.construction.buildings.filter((b: any) => b.blueprintId === 'lodge')).toHaveLength(1)
  await page.screenshot({ path: 'test-results/grove-large-floor-built.png' })
  await tapSceneControl(page, page.getByTestId('build-bubble-b2:walls'))
  await expect(page.getByTestId('production-screen')).toBeVisible()
  await expect(page.getByTestId('production-screen')).toContainText('大屋围墙')
  expect(errors).toEqual([])
})
