// Captures the home screen and an in-match scoring screen of dist/ for the default look and each opt-in
// design (?design=pub|neon|minimal|broadcast), in light and dark, at a phone viewport. Builds nothing itself.
//   npm run build && node scripts/design-previews.mjs [design ...]   (no arguments: every design)
// Browser: $CHROME, else /opt/pw-browsers/chromium. Output: docs/redesigns/<design>-<screen>-<scheme>.png
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium';
const DIST = new URL('../dist/', import.meta.url);
const OUT = new URL('../docs/redesigns/', import.meta.url);
const ALL = ['default', 'pub', 'neon', 'minimal', 'broadcast'];
const DESIGNS = process.argv.length > 2 ? process.argv.slice(2) : ALL;
const SCHEMES = ['light', 'dark'];
const VIEWPORT = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };

const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
  try {
    res.writeHead(200, { 'Content-Type': TYPES[extname(path)] || 'application/octet-stream' }).end(await readFile(new URL(path, DIST)));
  } catch { res.writeHead(404).end(); }
}).listen(0, '127.0.0.1');
await new Promise(r => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}/index.html`;

await mkdir(OUT, { recursive: true });
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--hide-scrollbars'] });
const sleep = ms => new Promise(r => setTimeout(r, ms));

for (const design of DESIGNS) for (const scheme of SCHEMES) {
  const page = await browser.newPage();
  await page.setViewport(VIEWPORT);
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }]);
  const url = design === 'default' ? base : `${base}?design=${design}`;
  await page.goto(url, { waitUntil: 'networkidle0' });
  await page.evaluate(() => localStorage.clear());
  await page.goto(url, { waitUntil: 'networkidle0' });
  await page.evaluate(() => { let x = 7; Math.random = () => (x = (x * 16807) % 2147483647) / 2147483647; return document.fonts.ready; });
  const snap = async screen => {
    await sleep(500);
    await page.evaluate(() => { document.getElementById('toast').hidden = true; document.activeElement?.blur(); window.scrollTo(0, 0); });
    await page.screenshot({ path: fileURLToPath(new URL(`${design}-${screen}-${scheme}.png`, OUT)) });
  };
  const click = sel => page.evaluate(s => document.querySelector(s).click(), sel);

  await snap('home');

  // A 501 match against a 60-average bot, two visits in
  await click('[data-menu="x01"]');
  await click('#setupForm [type=submit]');
  for (const v of ['100', '60', '45']) {
    for (const k of v) await page.keyboard.press(k);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => !botBusy && !isBotTurn(), { timeout: 15000 });
  }
  for (const k of '14') await page.keyboard.press(k);
  await snap('match');
  await page.close();
  console.log(`${design} ${scheme}`);
}
await browser.close();
server.close();
