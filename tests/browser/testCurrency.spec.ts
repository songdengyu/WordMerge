import { test, expect, type Page } from '@playwright/test'

async function ready(page: Page) {
  await expect(page.getByTestId('camp-scene')).toHaveAttribute('data-ready', 'true')
  await expect(page.getByTestId('survival-game')).toHaveAttribute('data-save-state', 'saved')
}
async function inventory(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('wordmerge-survival', 1)
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error)
    })
    try {
      return await new Promise<{ gold: number; gems: number; items: unknown }>((resolve, reject) => {
        const request = db.transaction('snapshots').objectStore('snapshots').get('current')
        request.onsuccess = () => resolve(request.result.data.production.inventory)
        request.onerror = () => reject(request.error)
      })
    } finally { db.close() }
  })
}
async function openPanel(page: Page) {
  await page.getByRole('button', { name: '测试', exact: true }).click()
  await page.getByRole('button', { name: '金币与钻石' }).click()
  return page.getByRole('region', { name: '金币与钻石测试' })
}

test('currency test controls add to existing balances, persist and clamp subtraction without changing items', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 })
  await page.goto('/'); await ready(page)
  const before = await inventory(page)
  let panel = await openPanel(page)
  for (const name of ['金币加10000', '钻石加10000']) {
    await expect(panel.getByRole('button', { name, exact: true })).toBeInViewport()
    await panel.getByRole('button', { name, exact: true }).click(); await ready(page)
  }
  await expect.poll(async () => (await inventory(page)).gold).toBe(before.gold + 10000)
  await expect.poll(async () => (await inventory(page)).gems).toBe(before.gems + 10000)
  await page.reload(); await ready(page)
  const restored = await inventory(page)
  expect(restored.gold).toBe(before.gold + 10000); expect(restored.gems).toBe(before.gems + 10000)
  expect(restored.items).toEqual(before.items)
  panel = await openPanel(page)
  for (const [label, key] of [['金币', 'gold'], ['钻石', 'gems']] as const) {
    const subtract = panel.getByRole('button', { name: `${label}减10000`, exact: true })
    await subtract.click(); await ready(page)
    await expect.poll(async () => (await inventory(page))[key]).toBe(before[key])
    if (before[key] > 0) { await subtract.click(); await ready(page) }
    await expect(subtract).toBeDisabled()
    await expect.poll(async () => (await inventory(page))[key]).toBe(0)
  }
  await page.reload(); await ready(page)
  expect(await inventory(page)).toMatchObject({ gold: 0, gems: 0, items: before.items })
})
