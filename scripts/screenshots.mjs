// Takes App Store screenshots of the built app (dist/) in local Chrome at Apple's required sizes:
//   iPhone 6.9" 1320×2868 (440×956 @3x) and iPad 13" 2064×2752 (1032×1376 @2x).
//   npm run build && node scripts/screenshots.mjs
// Output: store/screenshots/<device>/<n>-<name>.png
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DIST = new URL('../dist/', import.meta.url);
const OUT = new URL('../store/screenshots/', import.meta.url);
const DEVICES = {
  'iphone-6.9': { width: 440, height: 956, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  'ipad-13': { width: 1032, height: 1376, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };

// Serve dist/ locally
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
  try {
    const body = await readFile(new URL(path, DIST));
    res.writeHead(200, { 'Content-Type': TYPES[extname(path)] || 'application/octet-stream' }).end(body);
  } catch { res.writeHead(404).end(); }
}).listen(0, '127.0.0.1');
await new Promise(r => server.once('listening', r));
const url = `http://127.0.0.1:${server.address().port}/index.html`;

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--hide-scrollbars'] });
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function shoot(device, viewport) {
  await mkdir(new URL(`${device}/`, OUT), { recursive: true });
  const page = await browser.newPage();
  await page.setViewport(viewport);
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
  await page.goto(url, { waitUntil: 'networkidle0' });
  await page.evaluate(() => { localStorage.clear(); });
  await page.reload({ waitUntil: 'networkidle0' });
  await page.evaluate(() => document.fonts.ready);
  let n = 0;
  const snap = async name => {
    await sleep(600);
    await page.evaluate(() => { document.getElementById('toast').hidden = true; document.activeElement?.blur(); });
    await page.screenshot({ path: fileURLToPath(new URL(`${device}/${++n}-${name}.png`, OUT)) });
  };
  const click = sel => page.evaluate(s => document.querySelector(s).click(), sel);
  const keys = async text => { for (const k of text) await page.keyboard.press(k === '\n' ? 'Enter' : k); };

  // 1. X01 against a bot, with a checkout route on
  await click('[data-menu="x01"]');
  await page.evaluate(() => {
    const r = document.querySelector('#pa1'); r.value = 75; r.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await click('#setupForm [type=submit]');
  for (const v of ['100', '140', '125']) { await keys(v + '\n'); await sleep(4800); }
  await keys('6'); await keys('0');
  await snap('x01-match');

  // 2. The menu
  await page.evaluate(() => goMenu());
  await page.evaluate(() => window.scrollTo(0, 0));
  await snap('menu');

  // 3. Match settings
  await click('[data-menu="x01"]');
  await page.evaluate(() => {
    document.querySelector('select[data-key="unit"]').value = 'sets';
    document.querySelector('select[data-key="unit"]').dispatchEvent(new Event('change', { bubbles: true }));
  });
  await snap('match-settings');
  await click('[data-act="cancel"]');

  // 4. Cricket against a bot
  await click('[data-menu="cricket"]');
  await click('#setupForm [type=submit]');
  const darts = async list => { for (const v of list) { await click(`#gameLeft [data-v="${v}"]`); await sleep(120); } await sleep(1600); };
  await darts(['20:3', '20:1', '19:3']);
  await darts(['18:3', '18:3', '17:1']);
  await page.evaluate(() => window.scrollTo(0, 0));
  await snap('cricket');

  // 5. Killer with four players
  await page.evaluate(() => goMenu());
  await click('[data-menu="killer"]');
  for (let i = 0; i < 2; i++) await click('[data-set="padd"][data-v="bot"]');
  await click('#setupForm [type=submit]');
  await click('#gameLeft [data-v="0"]'); await click('#gameLeft [data-v="0"]'); await click('#gameLeft [data-v="0"]');
  await sleep(4000);
  await page.evaluate(() => window.scrollTo(0, 0));
  await snap('killer');
  await page.close();
  console.log(`${device}: ${n} screenshots`);
}

for (const [device, viewport] of Object.entries(DEVICES)) await shoot(device, viewport);
await browser.close();
server.close();
