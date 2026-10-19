// Headless screenshots with the system Chrome/Edge via playwright-core.
// Usage: node scripts/screenshot.mjs <out.png> [seed] [steps-json] [width] [height]
//   steps: [{"key":"1"}, {"keys":["z","z"]}, {"wait":300}, {"eval":"window.undertow..."}, {"click":[x,y]}, {"shot":"name.png"},
//           {"resume":".tmp/tplay/session.json"}]
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const out = process.argv[2] ?? 'shots/shot.png';
const seed = process.argv[3] ?? '12345';
const steps = JSON.parse(process.argv[4] ?? '[]');
const width = Number(process.argv[5] ?? 1440);
const height = Number(process.argv[6] ?? 900);

const candidates = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];
const exe = candidates.find((p) => existsSync(p));
if (!exe) throw new Error('No Chrome/Edge found');

mkdirSync('shots', { recursive: true });
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text()}`);
});
const url = pathToFileURL(resolve('dist/index.html')).href + (seed === 'title' ? '' : `?seed=${seed}`);
await page.goto(url);
await page.waitForTimeout(400);
for (const s of steps) {
  if (s.key) await page.keyboard.press(s.key);
  if (s.keys) for (const k of s.keys) {
    await page.keyboard.press(k);
    await page.waitForTimeout(s.gap ?? 40);
  }
  if (s.wait) await page.waitForTimeout(s.wait);
  if (s.resume) {
    // Load a saved run (a harness session under .tmp/tplay, or a raw save) into the page.
    const raw = readFileSync(s.resume, 'utf8');
    const save = raw.trimStart().startsWith('{"save"') ? JSON.parse(raw).save : raw;
    const ok = await page.evaluate((j) => window.undertow.resume(j), save);
    if (!ok) console.log(`could not resume ${s.resume}`);
  }
  if (s.eval) {
    const r = await page.evaluate(s.eval);
    if (r !== undefined) console.log('eval:', typeof r === 'string' ? r : JSON.stringify(r));
  }
  if (s.click) await page.mouse.click(s.click[0], s.click[1]);
  if (s.move) await page.mouse.move(s.move[0], s.move[1]);
  if (s.shot) await page.screenshot({ path: `shots/${s.shot}` });
}
await page.waitForTimeout(250);
await page.screenshot({ path: out });
await browser.close();
if (errors.length) console.log('ERRORS:\n' + errors.join('\n'));
console.log(`saved ${out}`);
