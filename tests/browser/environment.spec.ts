import { test, expect, type Page } from '@playwright/test'

async function ready(page: Page) {
  await expect(page.getByTestId('camp-scene')).toHaveAttribute('data-ready', 'true')
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-save-state', 'saved')
}
async function controls(page: Page) {
  await page.getByRole('button', { name: '天气', exact: true }).click()
  return page.getByRole('region', { name: '时间与天气测试' })
}
test('time and weather controls change the actual environment, restore on reload and keep clocks pictorial', async ({ page }) => {
  test.setTimeout(60_000)
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message))
  await page.goto('/?game=survival'); await ready(page)
  const scene = page.getByTestId('camp-scene'), clock = page.getByTestId('game-clock')
  for (const [label, phase, celestial] of [['黎明', 'dawn', 'sun'], ['上午', 'morning', 'sun'], ['正午', 'noon', 'sun'], ['黄昏', 'dusk', 'sun'], ['夜晚', 'night', 'moon'], ['深夜', 'midnight', 'moon']]) {
    const panel = await controls(page)
    await panel.getByRole('button', { name: label, exact: true }).click()
    await expect(scene).toHaveAttribute('data-phase', phase)
    await expect(clock).toHaveAttribute('data-celestial', celestial)
    await expect(clock).not.toHaveText(/\d{2}:\d{2}/)
    await page.getByRole('button', { name: '关闭天候测试' }).click()
    await page.screenshot({ path: `test-results/environment-${phase}.png` })
  }
  expect(Number(await scene.getAttribute('data-darkness'))).toBeGreaterThan(.5)
  let panel = await controls(page)
  await panel.getByRole('button', { name: '正午', exact: true }).click()
  await expect(scene).toHaveAttribute('data-phase', 'noon')
  expect(Number(await scene.getAttribute('data-darkness'))).toBeLessThan(.01)
  await page.getByRole('button', { name: '关闭天候测试' }).click()
  for (const [label, weather] of [['☀ 晴', 'sunny'], ['☁ 多云', 'cloudy'], ['☂ 雨', 'rain']]) {
    panel = await controls(page)
    await panel.getByRole('button', { name: label, exact: true }).click()
    await expect(scene).toHaveAttribute('data-weather', weather)
    await page.getByRole('button', { name: '关闭天候测试' }).click()
    await page.screenshot({ path: `test-results/environment-${weather}.png` })
  }
  await ready(page); await page.reload(); await ready(page)
  await expect(scene).toHaveAttribute('data-weather', 'rain')
  await expect(scene).toHaveAttribute('data-phase', 'noon')
  await page.getByRole('button', { name: '合成物资' }).click()
  await expect(page.getByTestId('merge-clock')).toHaveAttribute('data-celestial', 'sun')
  await expect(page.getByTestId('merge-clock')).not.toHaveText(/\d{2}:\d{2}/)
  expect(errors).toEqual([])
})

test('small phone can switch a rainy night and still use the map, merge board and supplies', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 })
  await page.goto('/?game=survival'); await ready(page)
  const panel = await controls(page)
  await expect(panel.getByRole('button', { name: '深夜', exact: true })).toBeInViewport()
  await expect(panel.getByRole('button', { name: '☂ 雨', exact: true })).toBeInViewport()
  await panel.getByRole('button', { name: '夜晚', exact: true }).click()
  await panel.getByRole('button', { name: '☂ 雨', exact: true }).click()
  await expect(page.getByTestId('game-clock')).toHaveAttribute('data-celestial', 'moon')
  await page.screenshot({ path: 'test-results/environment-controls-small.png' })
  await page.getByRole('button', { name: '关闭天候测试' }).click()
  await page.getByRole('button', { name: '放大地图' }).click()
  await page.screenshot({ path: 'test-results/environment-rainy-night-small.png' })
  await page.getByRole('button', { name: '合成物资' }).click()
  await expect(page.getByTestId('merge-clock')).toHaveAttribute('data-celestial', 'moon')
  const before = await page.getByTestId('board-cell-0').boundingBox()
  await page.getByTestId('board-cell-9').tap()
  expect(await page.getByTestId('board-cell-0').boundingBox()).toEqual(before)
  await page.getByRole('button', { name: '使用', exact: true }).click()
  await expect(page.getByTestId('board-cell-9')).toHaveAttribute('data-instance-id', '')
  await expect(page.getByRole('button', { name: /▦ 仓库/ })).toBeInViewport()
})
