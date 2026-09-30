import { expect, type Locator, type Page } from '@playwright/test'

/** Semantic mirrors expose geometry only; actual pointer input must reach the Pixi canvas. */
export async function tapSceneControl(page: Page, control: Locator) {
  await expect(control).toBeVisible()
  await expect(control).toBeEnabled()
  const box = (await control.boundingBox())!
  await page.touchscreen.tap(box.x + Math.min(box.width, box.height) / 2, box.y + box.height / 2)
}
