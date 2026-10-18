import { expect, test } from '@playwright/test'

const num = (s: string | null): number => parseFloat((s ?? '').replace(/[^0-9.\-]/g, ''))

test('loads and shows a plausible peak', async ({ page }) => {
  await page.goto('./')
  await expect(page).toHaveTitle('ChipletChill')
  const t = num(await page.getByTestId('tmax').textContent())
  expect(t).toBeGreaterThan(60)
  expect(t).toBeLessThan(100)
})

test('workload change moves the peak', async ({ page }) => {
  await page.goto('./')
  const before = num(await page.getByTestId('tmax').textContent())
  await page.getByTestId('workload').selectOption('decode')
  await expect.poll(async () => num(await page.getByTestId('tmax').textContent())).not.toBe(before)
})

test('optimizer produces a cooler layout', async ({ page }) => {
  const errors: string[] = []
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto('./')
  const start = num(await page.getByTestId('tmax').textContent())
  await page.getByTestId('run').click()
  await expect(page.getByTestId('result')).toBeVisible({ timeout: 60_000 })
  const ai = num(await page.getByTestId('ai-tmax').textContent())
  expect(ai).toBeLessThan(start)
  await expect(page.getByTestId('chart')).toBeVisible()
  expect(errors).toEqual([])
})

test('no horizontal overflow', async ({ page }) => {
  await page.goto('./')
  const ok = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
  expect(ok).toBe(true)
})
