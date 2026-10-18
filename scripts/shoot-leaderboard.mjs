// Screenshot the public AutoLab leaderboard for the explainer and README.
//   node scripts/shoot-leaderboard.mjs
// Writes public/media/leaderboard.png. Fails if the table is not visible (for example,
// if the page needs a login), so a stale image is never silently replaced.
import { chromium } from '@playwright/test';

const URL = 'https://app.autolab.ai/hills/czaja107/beat-the-hotspot/leaderboard';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
const table = page.locator('table').first();
await table.waitFor({ state: 'visible', timeout: 30000 });
const text = await table.innerText();
if (!text.includes('wilsonwu-ai')) throw new Error('leaderboard table has no wilsonwu-ai row');
console.log(text.split('\n').slice(0, 8).join('\n'));
await table.screenshot({ path: 'public/media/leaderboard.png' });
await browser.close();
