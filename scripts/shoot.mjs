// Screenshots for the README and the Sundai card. Needs `npm run preview` running.
import { chromium } from '@playwright/test'
const base = process.env.BASE_URL ?? 'http://localhost:4173/sundai-hack-145/'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 })
const errs = []
p.on('console', (m) => m.type() === 'error' && errs.push(m.text()))
await p.goto(base)
await p.screenshot({ path: 'docs/img/app-start.png' })
await p.getByTestId('run').click()
await p.getByTestId('result').waitFor({ timeout: 60000 })
await p.waitForTimeout(500)
await p.screenshot({ path: 'docs/img/app-result.png' })
await p.screenshot({ path: 'docs/img/app-result-full.png', fullPage: true })
const e = await b.newPage({ viewport: { width: 1280, height: 860 } })
e.on('console', (m) => m.type() === 'error' && errs.push('explainer: ' + m.text()))
await e.goto(base + 'explainer.html')
await e.waitForTimeout(4000)
await e.screenshot({ path: 'docs/img/explainer-full.png', fullPage: true })
const m = await b.newPage({ viewport: { width: 375, height: 800 }, deviceScaleFactor: 2 })
await m.goto(base + 'explainer.html')
const over = await m.evaluate(() => document.documentElement.scrollWidth - innerWidth)
console.log('explainer mobile overflow px', over, 'console errors', errs)
await b.close()
