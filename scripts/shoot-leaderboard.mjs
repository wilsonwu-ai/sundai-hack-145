// Screenshot the public AutoLab leaderboard and save its rows.
//   node scripts/shoot-leaderboard.mjs
// Writes public/media/leaderboard.png and state/official/leaderboard_snapshot.json (the
// rows as text plus the capture time). Fails if the table is not visible (for example,
// if the page needs a login), so a stale image is never silently replaced.
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';

const URL = 'https://app.autolab.ai/hills/czaja107/beat-the-hotspot/leaderboard';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
const table = page.locator('table').first();
await table.waitFor({ state: 'visible', timeout: 30000 });
const text = await table.innerText();
if (!text.includes('wilsonwu-ai')) throw new Error('leaderboard table has no wilsonwu-ai row');
const rows = text.split('\n').filter((l) => /^\d+\t/.test(l)).map((l) => {
  const [rank, climber, score, gpu, hbm, when] = l.split('\t');
  return { rank: +rank, climber, score: +score, gpu: +gpu, hbm: +hbm, when };
});
const captured = new Date();
const et = captured.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false });
writeFileSync('state/official/leaderboard_snapshot.json',
  JSON.stringify({ url: URL, captured_utc: captured.toISOString(), captured_et: et, rows }, null, 1) + '\n');
console.log(text.split('\n').slice(0, 8).join('\n'));
await table.screenshot({ path: 'public/media/leaderboard.png' });
await browser.close();
