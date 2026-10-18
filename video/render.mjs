// Renders video/index.html frame by frame (window.seek) and pipes PNGs into ffmpeg.
// Usage: node video/render.mjs   (reads video/data.json, writes public/media/*)
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const data = JSON.parse(readFileSync(path.join(here, 'data.json'), 'utf8'));
const FPS = 30;
const OUT_1080 = path.join(repo, 'public', 'media', 'chipletchill.mp4');
const POSTER = path.join(repo, 'public', 'media', 'poster.png');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.addInitScript(d => { window.DATA = d; }, data);
await page.goto(pathToFileURL(path.join(here, 'index.html')).href);
await page.waitForFunction(() => typeof window.seek === 'function');
const duration = await page.evaluate(() => window.DURATION || 44);
const frames = Math.round(duration * FPS);

const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-',
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-preset', 'medium', '-movflags', '+faststart', OUT_1080],
  { stdio: ['pipe', 'inherit', 'inherit'] });

for (let i = 0; i < frames; i++) {
  await page.evaluate(t => window.seek(t), i / FPS);
  const png = await page.screenshot({ type: 'png' });
  if (!ff.stdin.write(png)) await new Promise(r => ff.stdin.once('drain', r));
  if (i === Math.round(frames * 0.93)) await page.screenshot({ path: POSTER });
  if (i % 150 === 0) console.log(`frame ${i}/${frames}`);
}
ff.stdin.end();
await new Promise(r => ff.on('close', r));
await browser.close();
console.log('wrote', OUT_1080, POSTER);
