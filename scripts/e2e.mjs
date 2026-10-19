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

  // A finished match shows in History (sheet, delete) and in Stats
  await run(`startMatch({ ...DEFAULT_SETTINGS, start: 121, count: 1, players: ${humans} })`);
  await run('submit(121)');
  assert.equal(await run('S.matchWinner'), 0, 'a 121 checkout wins a one-leg match');
  const text = sel => run(`document.querySelector('${sel}')?.innerText || ''`);
  const click = sel => run(`document.querySelector('${sel}').click()`);
  await run("goScreen('history')");
  assert.match(await text('#page'), /match to you/i, 'History lists the match');
  await click('.hrow');
  assert.ok(await run("document.querySelectorAll('#page table.sheet tbody tr').length > 1"), 'the detail shows the leg sheet');
  assert.match(await text('#page'), /match stats/i, 'the detail shows the match stats');
  await click('[data-pg="del"]');
  assert.equal(await run("document.getElementById('overlay').hidden"), false, 'delete asks first');
  await run("document.querySelector('#overlay [data-act=\"keep\"]').click()");
  assert.equal(await run('historyAll().length'), 1, 'keeping leaves the match in history');
  await click('[data-pg="del"]');
  await run("document.querySelector('#overlay [data-act=\"go\"]').click()");
  assert.equal(await run('historyAll().length'), 0, 'confirming deletes the match');
  assert.match(await text('#page'), /start a game/i, 'an empty History offers a new game');
  await run(`startMatch({ ...DEFAULT_SETTINGS, start: 121, count: 1, players: ${humans} })`);
  await run('submit(121)');
  await run("goScreen('stats')");
  assert.match(await text('#page'), /3-dart average\s*121\.0/, 'Stats shows the average');

  // Android back button (window.ocheBack): a dialog closes first, then the screen goes to the menu
  await run("goScreen('history')");
  await click('.hrow');
  await click('[data-pg="del"]');
  assert.equal(await run('ocheBack()'), true);
  assert.equal(await run("document.getElementById('overlay').hidden"), true, 'back closes the dialog');
  assert.equal(await run('historyAll().length'), 1, 'closing the dialog with back deletes nothing');
  assert.equal(await run('ocheBack()'), true);
  assert.equal(await run('S.screen'), 'menu', 'back from a screen goes to the menu');
  assert.equal(await run('ocheBack()'), false, 'on the menu back is left to the app');

  // Settings: theme sticks across reloads, a switch saves, reset wipes everything
  await run("goScreen('settings')");
  await click('[data-pg="theme"][data-v="dark"]');
  assert.equal(await run('document.documentElement.dataset.theme'), 'dark', 'Dark applies at once');
  await page.reload({ waitUntil: 'networkidle0' });
  assert.equal(await run('document.documentElement.dataset.theme'), 'dark', 'the theme survives a reload');
  await run("goScreen('settings')");
  await run("document.querySelector('[data-pg=\"awake\"]').focus()");
  await click('[data-pg="awake"]');
  assert.equal(await run('document.activeElement.dataset.pg'), 'awake', 'a switch keeps keyboard focus after it re-renders');
  const solo = "{ mode: 'drills', winner: null, settings: { players: [{ name: 'You', type: 'human' }] } }";
  assert.equal(await run(`lifetime('You', [${solo}]).games.drills.multi`), false, 'a solo game is not counted as won or lost');
  assert.equal(await run('SETTINGS.awake'), false, 'the awake switch turns off');
  assert.equal(await run('historyAll().length'), 1, 'one match before the reset');
  await click('[data-pg="reset"]');
  await run("document.querySelector('#overlay [data-act=\"go\"]').click()");
  assert.equal(await run('historyAll().length'), 0, 'reset empties the history');
  assert.equal(await run("document.getElementById('menu').hidden"), false, 'reset shows the menu');
  assert.equal(await run('SETTINGS.awake'), true, 'reset restores the settings');

  // Language: Dutch and German apply at once to the menu, the play screen and Settings, and survive a reload
  const speak = async (lang, words) => {
    await run("goScreen('settings')");
    await click(`[data-pg="lang"][data-v="${lang}"]`);
    assert.equal(await run('document.documentElement.lang'), lang, `${lang} sets <html lang>`);
    assert.match(await text('#page'), words.settings, `Settings in ${lang}`);
    await page.reload({ waitUntil: 'networkidle0' });
    assert.equal(await run('SETTINGS.lang + document.documentElement.lang'), lang + lang, `${lang} survives a reload`);
    assert.match(await text('#tabs'), words.tabs, `the tabs in ${lang}`);
    await run("goScreen('menu')");
    assert.match(await text('#menu'), words.menu, `the menu in ${lang}`);
    await run(`startMatch({ ...DEFAULT_SETTINGS, players: ${humans} })`);
    assert.match(await text('#play'), words.play, `the play screen in ${lang}`);
    assert.match(await text('#menuBtn'), words.menuBtn);
  };
  await speak('nl', { settings: /Instellingen[\s\S]*Taal[\s\S]*Alle gegevens wissen/i, tabs: /Spelen\s*Geschiedenis/i, menu: /Stap naar de oche[\s\S]*Oefenen[\s\S]*Dubbeltraining/i, play: /Voer score in[\s\S]*Aan de beurt[\s\S]*Laatste beurt terug/i, menuBtn: /Menu/i });
  await speak('de', { settings: /Einstellungen[\s\S]*Sprache[\s\S]*Alle Daten zurücksetzen/i, tabs: /Spielen\s*Verlauf/, menu: /Ab an die Oche[\s\S]*Training[\s\S]*Double-Training/i, play: /Score eingeben[\s\S]*Am Wurf[\s\S]*Letzte Aufnahme zurück/i, menuBtn: /Menü/i });
  await run("goScreen('settings')");
  await click('[data-pg="lang"][data-v="system"]');
  assert.match(await text('#page'), /Settings[\s\S]*Language/i, 'System goes back to English here');

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
