// Takes store screenshots of the built app (dist/) in local Chrome, in English, Dutch and German, at
//   Apple's iPhone 6.9" 1320×2868 (440×956 @3x) and iPad 13" 2064×2752 (1032×1376 @2x),
//   and a Google Play phone at 1080×1920 (432×768 @2.5x).
//   npm run build && node scripts/screenshots.mjs
// Output: store/screenshots/<lang>/<device>/<n>-<name>.png
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
  'play-phone': { width: 432, height: 768, deviceScaleFactor: 2.5, isMobile: true, hasTouch: true },
};
const LANGS = ['en', 'nl', 'de'];
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

async function shoot(lang, device, viewport) {
  const dir = new URL(`${lang}/${device}/`, OUT);
  await mkdir(dir, { recursive: true });
  const page = await browser.newPage();
  await page.setViewport(viewport);
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
  await page.goto(url, { waitUntil: 'networkidle0' });
  await page.evaluate(() => { localStorage.clear(); });
  await page.reload({ waitUntil: 'networkidle0' });
  await page.evaluate(l => { setSetting('lang', l); render(); return document.fonts.ready; }, lang);
  let n = 0;
  const snap = async name => {
    await sleep(600);
    await page.evaluate(() => { document.getElementById('toast').hidden = true; document.activeElement?.blur(); window.scrollTo(0, 0); });
    await page.screenshot({ path: fileURLToPath(new URL(`${++n}-${name}.png`, dir)) });
  };
  const click = sel => page.evaluate(s => document.querySelector(s).click(), sel);
  // Starts the game set up in the overlay, replacing the one still in progress
  const start = () => page.evaluate(() => { document.querySelector('#setupForm [type=submit]').click(); document.querySelector('#overlay [data-act="go"]')?.click(); });
  const keys = async text => { for (const k of text) await page.keyboard.press(k === '\n' ? 'Enter' : k); };

  // Seed history by playing real matches through the app's own functions (bot and player visits come
  // from its engine, committed instantly), then back-date them so the list spans a week.
  await page.evaluate(() => {
    const x01 = (start, count, you, bot) => {
      startMatch({ ...DEFAULT_SETTINGS, start, count, players: [{ name: t('You'), type: 'human' }, { name: 'Bot', type: 'bot', avg: bot }] });
      S.screen = 'menu'; cancelBot(); // keeps the bot's timers out of it
      const avgs = [you, bot], ctx = avgs.map(a => E.makePersona(a));
      for (let i = 0; i < 600 && S.matchWinner == null; i++) {
        const leg = curLeg(), p = turnOf(leg), before = remaining(leg, p);
        const r = E.simulateVisit(before, S.settings.out, E.profileFor(avgs[p]), ctx[p], { inRule: 'straight', opened: true });
        commitVisit({ p, score: r.score, dartsUsed: r.dartsUsed, dartsAtDouble: r.dartsAtDouble, bust: r.bust, checkout: r.checkout, before, darts: r.darts });
      }
    };
    const solo = (mode, act, pattern) => {
      startMatch({ ...DEFAULT_SETTINGS, mode, players: [{ name: t('You'), type: 'human' }] });
      S.screen = 'menu';
      for (let i = 0; i < 200 && !GAMES[mode].done(S.game); i++) gameAct(act, pattern[i % pattern.length]);
    };
    // oldest first; the You averages rise and dip like a real month of practice
    x01(301, 2, 41, 40); x01(301, 2, 47, 45);
    solo('singles', 'dart', [1, 0, 2, 1, 3, 1, 0, 1]);
    x01(301, 2, 44, 50); x01(301, 2, 52, 45);
    solo('bobs27', 'hits', [1, 1, 0, 2, 1, 1, 0, 1, 2, 1]);
    x01(301, 2, 58, 55); x01(301, 2, 51, 50); x01(301, 2, 61, 60);
    const ago = [150, 126, 101, 78, 53, 30, 27, 5.5, 2.5]; // hours before now, oldest first
    const all = historyAll().reverse().map((e, i) => ({ ...e, at: new Date(Date.now() - ago[i] * 36e5).toISOString() }));
    writeJSON(HISTORY_KEY, all.reverse());
    goMenu();
  });

  // 1. X01 against a bot, with a checkout route on
  await click('[data-menu="x01"]');
  await page.evaluate(() => {
    const r = document.querySelector('#pa1'); r.value = 75; r.dispatchEvent(new Event('input', { bubbles: true }));
  });
  // A fixed seed makes the bot throw the same darts every run, so both devices show the same scene
  await page.evaluate(() => { let x = 42; Math.random = () => (x = (x * 16807) % 2147483647) / 2147483647; });
  await click('#setupForm [type=submit]');
  for (const v of ['100', '85', '55']) {
    await keys(v + '\n');
    await page.waitForFunction(() => !botBusy && !isBotTurn(), { timeout: 15000 });
  }
  await snap('x01-match');

  // 2. The menu
  await page.evaluate(() => goMenu());
  await snap('menu');

  // 3. History
  await page.evaluate(() => goScreen('history'));
  await snap('history');

  // 4. Player stats
  await page.evaluate(() => goScreen('stats'));
  await snap('stats');

  // 5. Cricket against a bot
  await page.evaluate(() => goMenu());
  await click('[data-menu="cricket"]');
  await start();
  const darts = async list => { for (const v of list) { await click(`#gameLeft [data-v="${v}"]`); await sleep(120); } await sleep(300); await page.waitForFunction(() => !botBusy && !isBotTurn(), { timeout: 15000 }); };
  await darts(['20:3', '20:1', '19:3']);
  await darts(['18:3', '18:3', '17:1']);
  await snap('cricket');

  // 6. Match settings
  await page.evaluate(() => goMenu());
  await click('[data-menu="x01"]');
  await page.evaluate(() => {
    document.querySelector('select[data-key="unit"]').value = 'sets';
    document.querySelector('select[data-key="unit"]').dispatchEvent(new Event('change', { bubbles: true }));
  });
  await snap('match-settings');
  await click('[data-act="cancel"]');

  // 7. Killer with four players
  await page.evaluate(() => goMenu());
  await click('[data-menu="killer"]');
  for (let i = 0; i < 2; i++) await click('[data-set="padd"][data-v="bot"]');
  await start();
  await click('#gameLeft [data-v="0"]'); await click('#gameLeft [data-v="0"]'); await click('#gameLeft [data-v="0"]');
  await sleep(4000);
  await snap('killer');

  // 8. Settings, with the caller and language options
  await page.evaluate(() => goScreen('settings'));
  await snap('settings');
  await page.close();
  console.log(`${lang}/${device}: ${n} screenshots`);
}

for (const lang of LANGS) for (const [device, viewport] of Object.entries(DEVICES)) await shoot(lang, device, viewport);
await browser.close();
server.close();
