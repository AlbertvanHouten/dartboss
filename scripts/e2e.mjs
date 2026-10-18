// Plays the built app (dist/) in headless Chrome and checks the X01 match rules that live in the app:
// busts, checkouts, who starts the next leg, undo, two clear legs, an empty Score, and recovery from a
// broken save. Uses local Chrome, or the path in CHROME.
//   npm run build && npm run test:e2e
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

const CHROME = process.env.CHROME || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome'].find(existsSync);
const DIST = new URL('../dist/', import.meta.url);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };

const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
  try { res.writeHead(200, { 'Content-Type': TYPES[extname(path)] || 'application/octet-stream' }).end(await readFile(new URL(path, DIST))); }
  catch { res.writeHead(404).end(); }
}).listen(0, '127.0.0.1');
await new Promise(r => server.once('listening', r));
const url = `http://127.0.0.1:${server.address().port}/index.html`;

// CI runners don't allow Chrome's sandbox
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: process.env.CI ? ['--no-sandbox'] : [] });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(url, { waitUntil: 'networkidle0' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle0' });

  // The page's own functions and state are globals, so the test drives the match through them
  const run = fn => page.evaluate(fn);
  const humans = "[{ name: 'You', type: 'human' }, { name: 'Ann', type: 'human' }]";
  const left = p => run(`remaining(curLeg(), ${p})`);

  // 301, double out, first to 2 legs
  await run(`startMatch({ ...DEFAULT_SETTINGS, start: 301, count: 2, players: ${humans} })`);
  await run('submit(180)');                     // You: 121 left
  await run('submit(60)');                      // Ann: 241 left
  await run('submit(120)');                     // You would leave 1: bust
  assert.equal(await left(0), 121, 'a bust leaves the score where it was');
  assert.equal(await run('curLeg().visits.at(-1).bust'), true, 'leaving 1 on double out is a bust');
  await run('submit(60)');                      // Ann: 181 left
  await run('submit(121)');                     // You check out 121 (a 3-dart finish needs no questions)
  assert.equal(await run('S.legs[0].winner'), 0, 'the checkout wins the leg');
  assert.equal(await run('S.legs.length'), 2, 'a new leg starts');
  assert.equal(await run('curLeg().starter'), 1, 'the other player throws first in the next leg');
  assert.equal(await run('S.matchWinner'), null, 'one leg of two does not win the match');

  // Undo takes the checkout back
  await run('undo()');
  assert.equal(await run('S.legs.length'), 1, 'undo goes back into the finished leg');
  assert.equal(await run('S.legs[0].winner'), null, 'undo clears the leg winner');
  assert.equal(await left(0), 121, 'undo restores the score before the checkout');

  // Pressing Score with nothing typed records no score
  await run("press('ok')");
  assert.equal(await run('curLeg().visits.at(-1).score'), 0, 'an empty Score counts as 0');
  assert.equal(await left(0), 121);

  // Two clear legs: 2–1 is not enough, 3–1 is
  assert.equal(await run('raceWinner([2, 1], 2, true)'), -1);
  assert.equal(await run('raceWinner([3, 1], 2, true)'), 0);
  assert.equal(await run('raceWinner([2, 1], 2, false)'), 0);

  // A save this version can't show opens the menu with a fresh match, not a blank page
  await run(`localStorage.setItem('oche-match-v1', JSON.stringify({ settings: { mode: 'x01', players: null }, legs: [{}], screen: 'play' }))`);
  errors.length = 0;
  await page.reload({ waitUntil: 'networkidle0' });
  assert.equal(await run('S.screen'), 'menu', 'a broken save falls back to the menu');
  assert.equal(await run("document.getElementById('menu').hidden"), false, 'the menu is shown');
  assert.deepEqual(errors, [], 'no errors on the page');

  console.log('Browser checks passed');
} finally {
  await browser.close();
  server.close();
}
