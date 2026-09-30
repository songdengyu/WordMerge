import { test, expect, type Page } from '@playwright/test'

async function enterCamp(page: Page) {
  await page.goto('/?game=survival')
  await expect(page.getByTestId('camp-scene')).toHaveAttribute('data-ready', 'true')
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-paused', 'false')
}
async function screenPoint(page: Page, x: number, y: number) {
  const camera = (await page.getByTestId('camp-scene').getAttribute('data-camera'))!.split(',').map(Number)
  const bounds = (await page.getByTestId('camp-canvas').boundingBox())!
  return { x: bounds.x + camera[0] + (x - y) * 32 * camera[2],
    y: bounds.y + camera[1] + (x + y) * 16 * camera[2] }
}

test('loads one renderer, supports tap movement, and does not fetch legacy data', async ({ page }) => {
  const errors: string[] = []
  const configs: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (request.url().includes('/config/')) configs.push(request.url()) })
  await enterCamp(page)
  await expect(page.getByTestId('camp-canvas')).toHaveCount(1)
  const target = await screenPoint(page, 9, 9)
  await page.touchscreen.tap(target.x, target.y)
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-destination', '9,9')
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-player', '9,9')
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-activity', 'idle')
  expect(configs.every(url => url.includes('/config/survival/'))).toBe(true)
  expect(errors).toEqual([])
  await page.screenshot({ path: 'test-results/camp-portrait.png' })
})

test('dragging pans without issuing a move, zoom controls and recenter work', async ({ page }) => {
  await enterCamp(page)
  const scene = page.getByTestId('camp-scene')
  const original = await scene.getAttribute('data-camera')
  await page.mouse.move(170, 380); await page.mouse.down()
  await page.mouse.move(240, 420, { steps: 8 }); await page.mouse.up()
  await expect.poll(() => scene.getAttribute('data-camera')).not.toBe(original)
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-destination', '')
  await page.getByRole('button', { name: '放大地图' }).click()
  await expect.poll(async () => Number((await scene.getAttribute('data-camera'))!.split(',')[2])).toBeGreaterThan(1)
  await page.getByRole('button', { name: '定位主角' }).click()
  const player = await screenPoint(page, 7, 9)
  expect(player.x).toBeCloseTo(195, 0)
  await page.getByRole('button', { name: '缩小地图' }).click()
  await expect.poll(async () => Number((await scene.getAttribute('data-camera'))!.split(',')[2])).toBeCloseTo(1)
})

test('real multi-touch pinch and cancellation never become accidental movement', async ({ page, context }) => {
  await enterCamp(page)
  const cdp = await context.newCDPSession(page)
  const touch = (id: number, x: number, y: number) => ({ id, x, y })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touch(1, 140, 370), touch(2, 230, 370)] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [touch(1, 110, 360), touch(2, 260, 380)] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [touch(1, 110, 360)] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await expect.poll(async () => Number((await page.getByTestId('camp-scene').getAttribute('data-camera'))!.split(',')[2])).toBeGreaterThan(1)
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-destination', '')
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touch(1, 150, 400)] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-destination', '')
  const target = await screenPoint(page, 8, 9)
  await page.touchscreen.tap(target.x, target.y)
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-player', '8,9')
})

test('ordinary sheets keep the world running, lifecycle suspension freezes it', async ({ page }) => {
  await enterCamp(page)
  // Stay clear of the camera buttons' touch hit area on the right edge.
  const target = await screenPoint(page, 7, 12)
  await page.touchscreen.tap(target.x, target.y)
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-destination', '7,12')
  await page.getByRole('button', { name: '探索指引' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-player', '7,12')
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-paused', 'false')
  await page.getByRole('button', { name: '关闭', exact: true }).click()
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')))
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-paused', 'true')
  const time = await page.getByTestId('game-clock').textContent()
  await page.waitForTimeout(1200)
  expect(await page.getByTestId('game-clock').textContent()).toBe(time)
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow')))
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-paused', 'false')
  await expect.poll(() => page.getByTestId('game-clock').textContent()).not.toBe(time)
})

test('blocked terrain rejects movement and map sheet can send the player home', async ({ page }) => {
  await enterCamp(page)
  const obstacle = await screenPoint(page, 6, 5)
  await page.touchscreen.tap(obstacle.x, obstacle.y)
  await expect(page.getByRole('status')).toContainText('挡住')
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-destination', '')
  const target = await screenPoint(page, 9, 9)
  await page.touchscreen.tap(target.x, target.y)
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-player', '9,9')
  await page.getByRole('button', { name: '营地地图', exact: true }).click()
  await page.getByRole('button', { name: '走回营火旁' }).click()
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-player', '7,9')
})

test('small screens and landscape keep controls within the viewport', async ({ page }) => {
  await enterCamp(page)
  for (const viewport of [{ width: 320, height: 568 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport)
    const button = page.getByRole('button', { name: '探索指引' })
    await expect(button).toBeInViewport()
    const box = (await button.boundingBox())!
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height)
    await button.click()
    await expect(page.getByRole('button', { name: '关闭', exact: true })).toBeInViewport()
    await page.getByRole('button', { name: '关闭', exact: true }).click()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(viewport.width)
  }
})

test('configuration failures explain the problem and retry successfully', async ({ page }) => {
  await page.route('**/config/survival/world.json', route => route.fulfill({ status: 500, body: 'unavailable' }))
  await page.goto('/?game=survival')
  await expect(page.getByRole('alert')).toContainText('world.json')
  await page.unroute('**/config/survival/world.json')
  await page.getByRole('button', { name: '重试', exact: true }).click()
  await expect(page.getByTestId('camp-scene')).toHaveAttribute('data-ready', 'true')
})

test('a real WebGL context loss pauses the world and restoration resumes it', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await enterCamp(page)
  const extension = await page.getByTestId('camp-canvas').evaluateHandle((canvas: HTMLCanvasElement) => {
    const context = canvas.getContext('webgl2') ?? canvas.getContext('webgl')
    return context?.getExtension('WEBGL_lose_context')
  })
  expect(await extension.evaluate(value => Boolean(value))).toBe(true)
  await extension.evaluate(value => value!.loseContext())
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-paused', 'true')
  const time = await page.getByTestId('game-clock').textContent()
  await page.waitForTimeout(1100)
  expect(await page.getByTestId('game-clock').textContent()).toBe(time)
  await extension.evaluate(value => value!.restoreContext())
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-paused', 'false')
  const point = await screenPoint(page, 8, 9)
  await page.touchscreen.tap(point.x, point.y)
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-player', '8,9')
  expect(errors).toEqual([])
})

test('legacy remains the default entry with its merge screen', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  await expect(page.locator('.app')).toBeVisible()
  await expect(page.getByTestId('survival-game')).toHaveCount(0)
  await expect(page.locator('canvas')).toHaveCount(0)
  await page.getByRole('button', { name: '合成', exact: true }).click()
  await expect(page.getByText('秘境合成', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '返回战斗' }).click()
  await expect(page.getByText('秘境合成', { exact: true })).toHaveCount(0)
  expect(errors).toEqual([])
})
