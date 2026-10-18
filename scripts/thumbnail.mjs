// Builds docs/img/thumbnail.png (before/after heat maps) for the Sundai card.
// Needs `npm run preview` running.
import { chromium } from '@playwright/test'
const base = process.env.BASE_URL ?? 'http://localhost:4173/sundai-hack-145/'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2, colorScheme: 'dark' })
await p.goto(base)
const canvas = p.locator('.stage canvas').first()
const before = (await canvas.screenshot()).toString('base64')
await p.getByTestId('run').click()
await p.getByTestId('result').waitFor({ timeout: 60000 })
await p.waitForTimeout(400)
const after = (await canvas.screenshot()).toString('base64')
const ai = (await p.getByTestId('ai-tmax').textContent())?.trim()
await p.screenshot({ path: 'docs/img/app-result-dark.png' })
const t = await b.newPage({ viewport: { width: 1200, height: 675 }, deviceScaleFactor: 1 })
await t.setContent(`<html><body style="margin:0;background:#0b0a0d;color:#f4eee8;font-family:-apple-system,Helvetica,sans-serif">
<div style="padding:34px 44px 0"><div style="font-size:54px;font-weight:800;color:#ff7a2f">ChipletChill</div>
<div style="font-size:26px;margin-top:6px">A 2035 GPU package, ${'14.9 °C'} cooler. Found by a surrogate model in your browser.</div></div>
<div style="display:flex;gap:40px;padding:26px 44px;align-items:flex-start">
${[['Tightly packed', '89.3 °C', before], ['AI layout', ai, after]].map(([l, v, img]) => `<div style="flex:1">
<div style="font-size:22px;opacity:.8">${l} · peak <b style="color:#ffb347">${v}</b></div>
<img src="data:image/png;base64,${img}" style="width:100%;height:410px;object-fit:contain;object-position:left;margin-top:8px;border-radius:10px"></div>`).join('')}
</div></body></html>`)
await t.screenshot({ path: 'docs/img/thumbnail.png' })
console.log('ai', ai)
await b.close()
