import { test, expect, type Page } from '@playwright/test'

async function enter(page: Page) {
  await page.goto('/?game=survival')
  await expect(page.getByTestId('camp-scene')).toHaveAttribute('data-ready', 'true')
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-save-state', 'saved')
}
async function tapPoint(page: Page, x: number, y: number) {
  const camera = (await page.getByTestId('camp-scene').getAttribute('data-camera'))!.split(',').map(Number)
  const bounds = (await page.getByTestId('camp-canvas').boundingBox())!
  await page.touchscreen.tap(bounds.x + camera[0] + (x - y) * 32 * camera[2], bounds.y + camera[1] + (x + y) * 16 * camera[2])
}
async function position(page: Page) {
  const [x, y] = (await page.getByTestId('camp-scene').getAttribute('data-position'))!.split(',').map(Number)
  return { x, y }
}

test('touch movement reaches the exact point inside a cell, pauses and reloads at the same position', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await enter(page)
  await tapPoint(page, 9.25, 10.2)
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-destination', '9.25,10.2')
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-activity', 'idle')
  await expect.poll(() => position(page)).toEqual({ x: 9.25, y: 10.2 })
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')))
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-save-state', 'saved')
  await page.reload()
  await expect(page.getByTestId('camp-scene')).toHaveAttribute('data-ready', 'true')
  await expect.poll(() => position(page)).toEqual({ x: 9.25, y: 10.2 })
  await page.screenshot({ path: 'test-results/movement-precise-target.png' })
  expect(errors).toEqual([])
})

test('a new tap redirects immediately and diagonal interpolation changes both coordinates', async ({ page }) => {
  await enter(page)
  await page.clock.install()
  await tapPoint(page, 9.3, 10.3)
  await page.clock.runFor(150)
  const before = await position(page)
  expect(before.x).toBeGreaterThan(7); expect(before.y).toBeGreaterThan(9)
  await tapPoint(page, 6.7, 11.2)
  await page.clock.runFor(150)
  const after = await position(page)
  expect(after.x).toBeLessThan(before.x)
  expect(after.y).toBeGreaterThan(before.y)
  expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeLessThan(.65)
  await page.screenshot({ path: 'test-results/movement-retarget.png' })
  await page.clock.runFor(1500)
  await expect.poll(() => position(page)).toEqual({ x: 6.7, y: 11.2 })
})

test('a saved move continues after reload without snapping to a cell or simulating background travel', async ({ page }) => {
  await enter(page)
  await page.clock.install()
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 50))
  await tapPoint(page, 9.2, 10.2)
  await page.clock.runFor(200)
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')))
  await page.clock.runFor(50)
  const paused = await position(page)
  expect(Number.isInteger(paused.x)).toBe(false)
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-save-state', 'saved')
  await page.clock.runFor(5000)
  expect(await position(page)).toEqual(paused)
  await page.reload()
  await expect(page.getByTestId('camp-scene')).toHaveAttribute('data-ready', 'true')
  // Keep the clock frozen through reload, then render one paused frame at the restored position.
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')))
  await page.clock.runFor(50)
  const restored = await position(page)
  expect(restored).toEqual(paused)
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow')))
  await page.clock.runFor(2000)
  await expect.poll(() => position(page)).toEqual({ x: 9.2, y: 10.2 })
})
