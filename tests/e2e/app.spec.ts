import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'

test.setTimeout(120_000)
const LONG = { timeout: 60_000 }

test('loads, baseline is legal with a score and a results table', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto('./')
  await expect(page).toHaveTitle(/beat the hotspot/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('ChipletChill: beat the hotspot')
  await expect(page.getByTestId('legal')).toHaveText('LEGAL')
  await expect(page.getByTestId('score')).toHaveText(/^\d+\.\d{3}$/, LONG)
  await expect(page.getByTestId('gpu')).toHaveText(/^\d+\.\d$/)
  await expect(page.getByTestId('hbm')).toHaveText(/^\d+\.\d$/)
  await expect(page.getByTestId('budget')).toContainText('/ 13500')
  await expect(page.getByTestId('results')).toContainText('Seeded random baseline')
  await expect(page.getByTestId('heatmap')).toBeVisible()
  expect(errors).toEqual([])
})

test('preset and workload change keep the app consistent', async ({ page }) => {
  await page.goto('./')
  await expect(page.getByTestId('score')).toHaveText(/^\d/, LONG)
  await page.getByTestId('workload').selectOption('memory_stream')
  await expect(page.getByTestId('legal')).toHaveText('LEGAL')
  await page.getByTestId('preset').click()
  await expect(page.getByTestId('legal')).toHaveText('LEGAL')
  await expect(page.getByTestId('score')).toHaveText(/^\d+\.\d{3}$/, LONG)
})

test('dragging a die onto another is illegal with a reason', async ({ page }) => {
  await page.goto('./')
  await expect(page.getByTestId('score')).toHaveText(/^\d/, LONG)
  const box = (await page.getByTestId('heatmap').boundingBox())!
  const px = (mmX: number, mmY: number) => ({ x: box.x + (mmX / 52) * box.width, y: box.y + (1 - mmY / 42) * box.height })
  // baseline G0 centre (13.3, 8.5) mm, H0 centre (26.2, 8.7) mm
  const from = px(13.3, 8.5)
  const to = px(26.2, 8.7)
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 })
  await page.mouse.move(to.x, to.y, { steps: 4 })
  await page.mouse.up()
  await expect(page.getByTestId('legal')).toContainText('ILLEGAL: ')
  await expect(page.getByTestId('legal')).toContainText('G0 and H0 violate 1.0 mm clearance')
  await expect(page.getByTestId('download')).toBeDisabled()
})

test('download produces a submission the app parser accepts', async ({ page }) => {
  await page.goto('./')
  await expect(page.getByTestId('score')).toHaveText(/^\d/, LONG)
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('download').click()])
  expect(dl.suggestedFilename()).toBe('submission.json')
  const path = (await dl.path())!
  const raw = JSON.parse(readFileSync(path, 'utf8'))
  // the app's own parseSubmission + validateLayout (the official ports) must accept the file
  await page.getByTestId('preset').click()
  await page.getByTestId('upload').setInputFiles(path)
  await expect(page.locator('#msg')).toHaveText(/^Loaded /)
  await expect(page.getByTestId('legal')).toHaveText('LEGAL')
  expect(Object.keys(raw.placements_mm).sort()).toEqual(['G0', 'G1', 'G2', 'G3', 'H0', 'H1', 'H2', 'H3'])
  for (const v of Object.values(raw.placements_mm) as number[][]) for (const n of v) expect(Math.round(n * 1000) / 1000).toBe(n)
  expect(Object.keys(raw)).toEqual(['placements_mm'])
})

test('upload accepts a valid submission and rejects a bad one', async ({ page }) => {
  await page.goto('./')
  const good = { placements_mm: { G0: [7, 3], H0: [20.2, 3], G1: [32.4, 3], H1: [33.4, 15.2], G2: [32.4, 27.5], H2: [20.2, 27.8], G3: [7, 27.5], H3: [7.5, 15.2] } }
  await page.getByTestId('upload').setInputFiles({ name: 'submission.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(good)) })
  await expect(page.locator('#msg')).toContainText('Loaded submission.json')
  await expect(page.getByTestId('legal')).toHaveText('LEGAL')
  await page.getByTestId('upload').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"nope":1}') })
  await expect(page.locator('#msg')).toContainText('Upload rejected')
})

test('no horizontal scroll at 375 px', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 })
  await page.goto('./')
  await expect(page.getByTestId('score')).toHaveText(/^\d/, LONG)
  const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }))
  expect(m.sw).toBeLessThanOrEqual(m.iw)
})
