import { test, expect, type Page } from '@playwright/test'

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

test('five enemies pursue an indoor player while camera input, wall damage and save restore remain functional', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message))
  await page.setViewportSize({ width: 320, height: 640 })
  await page.goto('/'); await ready(page)
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')))
  await ready(page)
  const save = await readSave(page)
  await page.goto('/?game=legacy')
  const data = save.data
  data.cell = { x: 8, y: 11 }; data.motion = { version: 1, position: data.cell }
  data.construction = { unlockedBlueprints: ['cabin'], nextId: 2, xp: 70, orders: [], jobs: [], buildings: [{
    id: 'b1', blueprintId: 'cabin', origin: { x: 7, y: 10 }, rotation: 0,
    parts: Object.fromEntries(Object.entries({ foundation: 100, walls: 20, door: 100, roof: 120, bed: 80 })
      .map(([id, hp]) => [id, { built: true, hp, xpGranted: true }])),
  }] }
  data.survival.spawnRemaining = 80; data.survival.decisionRemaining = 0
  data.survival.enemies = [[7, 5], [12, 8], [4, 8], [12, 14], [6, 11]].map(([x, y], i) => ({
    id: `e${i + 1}`, kind: 'boar', hp: 70, cell: { x, y }, route: [], progress: 0, target: null, cooldown: 0, roaming: true,
  }))
  data.survival.nextEnemyId = 6
  await page.evaluate(async value => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('wordmerge-survival', 1); r.onsuccess = () => resolve(r.result) })
    const tx = db.transaction('snapshots', 'readwrite'), store = tx.objectStore('snapshots')
    store.put(value, 'current'); store.put(value.revision, 'revision'); store.delete('previous')
    await new Promise<void>(resolve => { tx.oncomplete = () => resolve() }); db.close()
  }, save)
  await page.goto('/'); await ready(page)
  const scene = page.getByTestId('camp-scene')
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-enemies', '5')
  const camera = await scene.getAttribute('data-camera'), rect = (await scene.boundingBox())!
  const x = rect.x + rect.width / 2, y = rect.y + rect.height * .45
  await page.mouse.move(x, y); await page.mouse.down()
  await page.mouse.move(x + 60, y + 40, { steps: 8 }); await page.mouse.up()
  await expect(scene).toHaveAttribute('data-camera-follow', '')
  expect(await scene.getAttribute('data-camera')).not.toBe(camera)
  // Report real rAF samples instead of setting a machine-dependent FPS assertion.
  const timing = await page.evaluate(() => new Promise<{ samples: number; p95Ms: number; maxMs: number }>(resolve => {
    const intervals: number[] = []; let start = 0, previous = 0
    const sample = (now: number) => {
      if (!start) start = now
      if (previous) intervals.push(now - previous)
      previous = now
      if (now - start < 6000) requestAnimationFrame(sample)
      else { intervals.sort((a, b) => a - b); resolve({ samples: intervals.length,
        p95Ms: intervals[Math.floor(intervals.length * .95)], maxMs: intervals[intervals.length - 1] }) }
    }
    requestAnimationFrame(sample)
  }))
  await testInfo.attach('desktop-browser-frame-timing', { body: JSON.stringify(timing), contentType: 'application/json' })
  await expect.poll(async () => (await readSave(page)).data.construction.buildings[0].parts.walls.hp, { timeout: 15_000 }).toBeLessThan(20)
  await page.screenshot({ path: 'test-results/enemy-pursuit-320.png' })
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')))
  await ready(page)
  const damaged = await readSave(page)
  expect(damaged.data.survival.enemies).toHaveLength(5)
  // Freeze before reloading so persistence can be compared without extra combat ticks.
  await page.clock.install(); await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000))
  await page.reload(); await ready(page)
  const restored = await readSave(page)
  expect(restored.data.construction).toEqual(damaged.data.construction)
  expect(restored.data.survival.enemies).toEqual(damaged.data.survival.enemies)
  expect(errors).toEqual([])
})
