import { test, expect } from '@playwright/test'

test.use({ isMobile: false, hasTouch: false, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })

test('desktop left mouse drag moves the visible map throughout the gesture and keeps it there', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(process.env.WORDMERGE_CAMERA_URL ?? '/')
  const scene = page.getByTestId('camp-scene')
  await expect(scene).toHaveAttribute('data-ready', 'true')
  const box = (await scene.boundingBox())!
  const before = (await scene.getAttribute('data-camera'))!.split(',').map(Number)
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  await expect(page.getByTestId('camp-canvas')).toBeVisible()
  expect(await page.evaluate(p => document.elementFromPoint(p.x, p.y)?.getAttribute('data-testid'), from)).toBe('camp-canvas')
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(from.x + i * 10, from.y + i * 4)
    await page.waitForTimeout(60)
    const current = (await scene.getAttribute('data-camera'))!.split(',').map(Number)
    expect(current[0] - before[0]).toBeCloseTo(i * 10, 0)
    expect(current[1] - before[1]).toBeCloseTo(i * 4, 0)
    await expect(scene).toHaveAttribute('data-camera-follow', '')
  }
  await page.mouse.up()
  const after = await scene.getAttribute('data-camera')
  await page.waitForTimeout(350)
  expect(await scene.getAttribute('data-camera')).toBe(after)
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-destination', '')
  await page.screenshot({ path: 'test-results/desktop-map-after-drag.png' })
  expect(errors).toEqual([])
})

test('desktop walking returns the camera gradually and another drag interrupts the return', async ({ page }) => {
  await page.goto(process.env.WORDMERGE_CAMERA_URL ?? '/')
  const scene = page.getByTestId('camp-scene')
  await expect(scene).toHaveAttribute('data-ready', 'true')
  await page.clock.install()
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 50))
  const box = (await scene.boundingBox())!, cx = box.x + box.width / 2, cy = box.y + box.height / 2
  const offset = async () => scene.evaluate(element => {
    const host = element as HTMLElement, [cx, cy, zoom] = host.dataset.camera!.split(',').map(Number)
    const [x, y] = host.dataset.position!.split(',').map(Number)
    return Math.hypot(cx + (x - y) * 32 * zoom - host.clientWidth / 2,
      cy + (x + y) * 16 * zoom - host.clientHeight / 2)
  })
  await page.mouse.move(cx, cy); await page.mouse.down()
  await page.mouse.move(cx + 100, cy + 40, { steps: 10 }); await page.mouse.up()
  await page.clock.runFor(50)
  const before = await offset()
  const target = await scene.evaluate(element => {
    const host = element as HTMLElement, [cx, cy, zoom] = host.dataset.camera!.split(',').map(Number)
    const box = host.getBoundingClientRect()
    return { x: box.x + cx + (9.25 - 10.2) * 32 * zoom, y: box.y + cy + (9.25 + 10.2) * 16 * zoom }
  })
  await page.mouse.click(target.x, target.y)
  await page.clock.runFor(100)
  const returning = await offset()
  expect(returning).toBeGreaterThan(before * .3)
  expect(returning).toBeLessThan(before)
  await page.clock.runFor(200)
  expect(await offset()).toBeLessThan(returning)
  await page.mouse.move(cx, cy); await page.mouse.down()
  await page.mouse.move(cx - 40, cy + 25, { steps: 5 }); await page.mouse.up()
  await page.clock.runFor(50)
  const dragged = await scene.getAttribute('data-camera')
  await page.clock.runFor(200)
  await expect(scene).toHaveAttribute('data-camera-follow', '')
  expect(await scene.getAttribute('data-camera')).toBe(dragged)
  await page.getByRole('button', { name: '定位主角' }).click()
  await page.clock.runFor(50)
  expect(await offset()).toBeGreaterThan(1)
  await page.clock.runFor(1500)
  expect(await offset()).toBeLessThan(.1)
})
