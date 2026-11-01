// Plays the built app (dist/) in headless Chrome and checks the X01 match rules that live in the app:
// busts, checkouts, who starts the next leg, undo, two clear legs, an empty Score, and recovery from a
// broken save, and two phones playing in one room. Uses local Chrome, or the path in CHROME.
//   npm run build && npm run test:e2e
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

const CHROME = process.env.CHROME || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome'].find(existsSync);
const DIST = new URL('../dist/', import.meta.url);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };

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
  // The offline cache holds every clip once installed (checked before anything plays one), so the caller works offline from the first match
  const clips = (await readdir(new URL('../web/caller/', import.meta.url))).map(f => `caller/${f}`).sort();
  const cached = await page.evaluate(`navigator.serviceWorker.ready.then(async () => {
    const cache = await caches.open((await caches.keys()).find(k => k.startsWith('oche-')));
    return (await cache.keys()).map(r => new URL(r.url).pathname.slice(1)).filter(p => p.startsWith('caller/')).sort();
  })`);
  assert.deepEqual(cached, clips, 'the offline cache holds every caller clip');

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

  // The caller: the score, then what the next player needs when they're on a finish; bust; game shot
  await run('window.calls = []; caller.say = (...n) => calls.push(n)');
  // Two legs, so the checkout wins a leg and leaves nothing in History for the checks below
  await run(`startMatch({ ...DEFAULT_SETTINGS, start: 301, count: 2, players: ${humans} })`);
  await run('submit(0)');                       // You: no score; Ann is on 301
  await run('submit(140)');                     // Ann: 161 left; You are on 301
  await run('submit(180)');                     // You: 121 left; Ann's 161 is a finish
  await run('submit(1)');                       // Ann: 160 left; You need 121
  await run('submit(130)');                     // You bust; Ann needs 160
  await run('submit(60)');                      // Ann: 100 left; You need 121
  await run('submit(121)');                     // You check out the leg
  assert.deepEqual(await run('calls'), [['noscore'], ['140'], ['180', 'req-161'], ['1', 'req-121'], ['bust', 'req-160'], ['60', 'req-121'], ['gameshot']]);
  assert.ok(await run("fetch('caller/180.mp3').then(r => r.ok)"), 'the caller files ship with the app');

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
    await run(`(s => { s.value = '${lang}'; s.dispatchEvent(new Event('change', { bubbles: true })); })(document.querySelector('[data-pg="lang"]'))`);
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
  await speak('de', { settings: /Einstellungen[\s\S]*Sprache[\s\S]*Alle Daten zurücksetzen/i, tabs: /Spielen\s*Verlauf/, menu: /Ab ans Oche[\s\S]*Training[\s\S]*Double-Training/i, play: /Score eingeben[\s\S]*Am Wurf[\s\S]*Letzte Aufnahme zurück/i, menuBtn: /Menü/i });
  await run("goScreen('settings')");
  await run(`(s => { s.value = 'system'; s.dispatchEvent(new Event('change', { bubbles: true })); })(document.querySelector('[data-pg="lang"]'))`);
  assert.match(await text('#page'), /Settings[\s\S]*Language/i, 'System goes back to English here');

  // Small phones in every language: nothing scrolls sideways or sticks out of its card, with four long names
  const long = "[{ name: 'Alexandria Whitfield', type: 'human' }, { name: 'Maximilian Schreiber', type: 'human' }, { name: 'Bartholomeus Jansen', type: 'human' }, { name: 'Bot', type: 'bot', avg: 60 }]";
  const outside = () => run(`(() => {
    if (document.documentElement.scrollWidth > innerWidth) return ['page ' + document.documentElement.scrollWidth];
    return [...document.querySelectorAll('.panel *, .player *, .mp *, .gbtn *, .dialog *')].filter(el => {
      const r = el.getBoundingClientRect(), box = el.parentElement.closest('.panel, .player, .mp, .gbtn, .dialog').getBoundingClientRect();
      return r.width && !el.closest('.sheet-wrap, [hidden]') && (r.right > box.right + 1 || r.left < box.left - 1);
    }).map(el => el.className || el.tagName);
  })()`);
  for (const width of [320, 360]) for (const lang of ['en', 'nl', 'de']) {
    await page.setViewport({ width, height: 700, isMobile: true, hasTouch: true });
    await run(`setSetting('lang', '${lang}')`);
    for (const scr of ['menu', 'history', 'stats', 'settings']) {
      await run(`goScreen('${scr}')`);
      assert.deepEqual(await outside(), [], `${scr} fits ${width} px in ${lang}`);
    }
    for (const mode of await run('MENU.flatMap(([, items]) => items.map(([m]) => m))')) {
      await run(`startMatch({ ...DEFAULT_SETTINGS, mode: '${mode}', count: 5, players: ${long}.slice(0, PLAYER_LIMITS['${mode}']?.[1] ?? 1) }); cancelBot(); render()`);
      assert.deepEqual(await outside(), [], `${mode} fits ${width} px in ${lang}`);
      await run(`goMenu(); document.querySelector('[data-menu="${mode}"]').click()`);
      assert.deepEqual(await outside(), [], `${mode} setup fits ${width} px in ${lang}`);
      await run(`document.querySelector('#overlay [data-act="cancel"]').click()`);
    }
  }
  await run("setSetting('lang', 'system')");
  await page.setViewport({ width: 800, height: 600 });

  // The act log follows play and undo
  const three = "[{ name: 'A', type: 'human' }, { name: 'B', type: 'human' }, { name: 'C', type: 'human' }]";
  await run(`startMatch({ ...DEFAULT_SETTINGS, mode: 'killer', players: ${three} })`);
  for (let i = 0; i < 4; i++) await run(`gameAct('dart', S.game.pl[S.game.turn].num)`);
  assert.equal(await run('S.acts.length'), 4, 'one act per dart');
  assert.deepEqual(await run('[S.acts[0].seat, S.acts[3].seat]'), [0, 1], 'acts record who threw');
  await run('gameUndo()');
  assert.equal(await run('S.acts.length'), 3, 'undo takes the act back');
  await run(`startMatch({ ...DEFAULT_SETTINGS, players: ${three} })`);
  await run('submit(60)'); await run('submit(60)');
  assert.deepEqual(await run('S.acts.map(a => a.seat)'), [0, 1], 'x01 acts record who scored');
  assert.equal(await run('S.acts[1].turnAfter'), 2 % 3, 'x01 acts record whose turn is next');
  await run('undo()');
  assert.equal(await run('S.acts.length'), 1, 'x01 undo takes the act back');

  // Long games: only the last 10 undo steps are saved, and full storage says so instead of failing silently
  assert.deepEqual(await run(`(() => { S.hist = Array.from({ length: 50 }, (_, i) => String(i)); save();
    return [S.hist.length, JSON.parse(localStorage.getItem('oche-match-v1')).hist.length]; })()`), [50, 10], 'a save keeps the last 10 undo steps');
  assert.match(await run(`(() => { const set = Storage.prototype.setItem; Storage.prototype.setItem = () => { throw new Error('full'); };
    try { save(); } finally { Storage.prototype.setItem = set; } return document.getElementById('toast').textContent; })()`), /storage is full/, 'full storage shows a message');

  // A save this version can't show opens the menu with a fresh match, not a blank page
  await run(`localStorage.setItem('oche-match-v1', JSON.stringify({ settings: { mode: 'x01', players: null }, legs: [{}], screen: 'play' }))`);
  errors.length = 0;
  await page.reload({ waitUntil: 'networkidle0' });
  assert.equal(await run('S.screen'), 'menu', 'a broken save falls back to the menu');
  assert.equal(await run("document.getElementById('menu').hidden"), false, 'the menu is shown');
  assert.deepEqual(errors, [], 'no errors on the page');

  // Two phones in one room over the local transport (BroadcastChannel): a host page and a guest page.
  // Each page keeps its own storage (its tab's sessionStorage stands in for localStorage), like two phones,
  // and keeps it over a reload.
  const local = url + '?transport=local';
  const hostP = await browser.newPage(), guestP = await browser.newPage();
  for (const p of [hostP, guestP]) {
    p.on('pageerror', e => errors.push(e.message));
    await p.evaluateOnNewDocument(() => Object.defineProperty(window, 'localStorage', { value: sessionStorage, configurable: true }));
    await p.goto(local, { waitUntil: 'networkidle0' });
  }
  for (const p of [hostP, guestP]) await p.evaluate(() => localStorage.clear());
  for (const p of [hostP, guestP]) await p.reload({ waitUntil: 'networkidle0' });
  const H = fn => hostP.evaluate(fn), G = fn => guestP.evaluate(fn);
  const wait = (p, fn, arg) => p.waitForFunction(fn, { timeout: 5000 }, arg);
  // The guest has the host's latest state
  const sync = async () => wait(guestP, v => ROOM?.ver === v, await H('S.room.ver'));
  // Run an input on the guest, then wait for the host to apply it and the guest to see the result
  const viaGuest = async code => {
    const v = await H('S.room.ver');
    await G(code);
    await wait(hostP, v => S.room.ver > v, v);
    await sync();
  };
  const toastOn = (p, text) => wait(p, s => !document.getElementById('toast').hidden && document.getElementById('toast').textContent.includes(s), text);

  // guest joins and sees the host's match
  const ann = "[{ name: 'You', type: 'human' }, { name: 'Ann', type: 'human' }, { name: 'Bob', type: 'human' }]";
  await H(`startMatch({ ...DEFAULT_SETTINGS, players: ${ann} })`);
  await H("hostRoom('K7QM2P')");
  await G("joinRoomAsGuest('K7QM2P')");
  await sync();
  await G('claim([1])');
  await wait(guestP, () => ROOM.mine.length > 0);
  assert.equal(await G('S.settings.players.length'), 3, 'the guest has the host\'s players');
  assert.deepEqual(await G('ROOM.mine'), [1], 'the guest plays seat 1');
  assert.equal(await H('S.room.seats[1]'), await G('ROOM.self'), 'the host gives seat 1 to the guest');

  // guest scores its own visit
  await H('submit(60)');                                  // You (seat 0, on the host)
  await sync();
  await viaGuest('submit(100)');                          // Ann, on her own phone
  assert.equal(await H('remaining(curLeg(), 1)'), 401, 'the host applies the guest\'s visit');
  assert.equal(await G('remaining(curLeg(), 1)'), 401, 'the guest sees its visit');

  // host scores for a seat without a phone
  await H('submit(45)');                                  // Bob has no phone
  await sync();
  assert.equal(await H('remaining(curLeg(), 2)'), 456);
  assert.equal(await G('remaining(curLeg(), 2)'), 456, 'both phones agree');

  // stale input is rejected: the host scores Ann's visit while her phone's visit is on its way
  await H('submit(60)');                                  // You
  await sync();
  await G('window.oldVer = ROOM.ver');
  await H('submit(80)');                                  // the host enters Ann's visit itself
  await sync();
  await G("ROOM.ver = oldVer; guestSend({ type: 'visit', seat: 1, visit: { p: 1, before: 401, score: 100, dartsUsed: 3, dartsAtDouble: 0, bust: false, checkout: false } })");
  await toastOn(guestP, 'Already scored');
  assert.deepEqual(await H('curLeg().visits.filter(v => v.p === 1).map(v => v.score)'), [100, 80], 'only the host\'s visit counts for this round');
  assert.equal(await H('remaining(curLeg(), 1)'), 321);

  // A visit that waits on a question (darts at a double) is checked again when the question is answered:
  // on 40 every visit asks, and anything that lands meanwhile wins
  const ok = "document.querySelector('#overlay [data-act=\"ok\"]').click()";
  const noToast = p => p.evaluate(() => { document.getElementById('toast').hidden = true; });
  await H(`startMatch({ ...DEFAULT_SETTINGS, start: 40, shared: true, players: ${ann} })`);
  await H(`submit(0); ${ok}`);                            // You
  await sync();
  // Host asks about Ann's visit while Ann's phone scores it: Ann's visit counts, the host's is refused
  await H('submit(20)');
  assert.equal(await H("document.getElementById('overlay').hidden"), false, 'the host is asked about darts at double');
  await viaGuest(`submit(10); ${ok}`);
  await noToast(hostP);
  await H(ok);
  await toastOn(hostP, 'Already scored');
  assert.deepEqual(await H('curLeg().visits.map(v => [v.p, v.score])'), [[0, 0], [1, 10]], 'one visit for Ann, from her phone');
  await sync();
  await H(`submit(0); ${ok}`);                            // Bob
  await H(`submit(0); ${ok}`);                            // You
  await sync();
  // Ann's phone asks while the host's state moves on: the visit goes with the version she started from, and is refused
  await G('submit(10)');
  await H(`undo(); submit(0); ${ok}`);                  // the host takes back You's visit and enters it again
  await sync();
  await noToast(guestP);
  await G(ok);
  await toastOn(guestP, 'Already scored');
  assert.equal(await H('curLeg().visits.length'), 4, 'the visit made against an old version is refused');
  // Ann's phone asks while the host scores her visit: her phone sees it and sends nothing
  await G('submit(10)');
  await H(`submit(5); ${ok}`);
  await sync();
  await noToast(guestP);
  const before = await H('S.room.ver');
  await G(ok);
  await toastOn(guestP, 'Already scored');
  assert.equal(await H('S.room.ver'), before, 'nothing reaches the host');
  assert.deepEqual(await H('curLeg().visits.filter(v => v.p === 1).map(v => v.score)'), [10, 5]);

  // guest undo while the next turn is in progress (Killer, a dart at a time)
  await H(`startMatch({ ...DEFAULT_SETTINGS, mode: 'killer', shared: true, players: ${ann} })`);
  await sync();
  assert.deepEqual(await G('ROOM.mine'), [1], 'a rematch keeps the guest\'s seat');
  for (let i = 0; i < 3; i++) await H("gameAct('dart', 0)");   // You: three misses
  await sync();
  for (let i = 0; i < 3; i++) await viaGuest("gameAct('dart', 0)"); // Ann: three misses on her phone
  await H("gameAct('dart', 0)");                                 // Bob's first dart, on the host
  await sync();
  assert.equal(await H('S.acts.length'), 7);
  await viaGuest('gameUndo()');
  assert.deepEqual(await H('[S.game.turn, S.game.cur.length, S.acts.length]'), [1, 2, 5], 'Bob\'s dart and Ann\'s third dart are taken back');
  assert.deepEqual(await G('[S.game.turn, S.game.cur.length]'), [1, 2], 'the guest sees the undo');
  await toastOn(hostP, 'Ann took back their visit');
  await toastOn(guestP, 'Ann took back their visit');
  // Refused once Bob has finished his visit
  await viaGuest("gameAct('dart', 0)");
  for (let i = 0; i < 3; i++) await H("gameAct('dart', 0)");
  await sync();
  await G('gameUndo()');
  await toastOn(guestP, 'Too late to undo here: ask the host');
  assert.equal(await H('S.acts.length'), 9, 'the refused undo changes nothing');

  // guest keeps its own saved game: a solo game on the guest phone survives joining and leaving a room
  await G('leaveRoom()');
  await G("startMatch({ ...DEFAULT_SETTINGS, mode: 'bobs27', players: [{ name: 'You', type: 'human' }] })");
  await G(`window.writes = 0; (set => { Storage.prototype.setItem = function (k, v) { if (k === STORE_KEY) writes++; return set.call(this, k, v); }; })(Storage.prototype.setItem)`);
  await G("joinRoomAsGuest('K7QM2P')");
  await sync();
  assert.equal(await G('S.settings.mode'), 'killer', 'in the room the guest shows the host\'s game');
  await G("goScreen('history'); goScreen('play')");     // screens save as they change, but not on a guest
  await G('leaveRoom()');
  assert.equal(await G('writes'), 0, 'a guest never saves while in a room');
  assert.equal(await G('S.settings.mode'), 'bobs27', 'leaving brings back the guest\'s own game');
  assert.equal(await G("JSON.parse(localStorage.getItem(STORE_KEY)).settings.mode"), 'bobs27', 'the guest\'s saved game is still stored');

  // ---- the screens: setup switch, lobby, join link, seat list, waiting ----
  await H('leaveRoom()');
  const q = (p, sel) => p.evaluate(s => !!document.querySelector(s), sel);
  const disabled = (p, sel) => p.evaluate(s => [...document.querySelectorAll(s)].map(b => b.disabled), sel);
  // Single-phone play loads nothing new. Where the WebRTC module can't load (the single-file oche.html has
  // no vendor folder), opening or joining a room says so.
  assert.equal(await run('!!document.querySelector(\'script[src*="qrcode"]\')'), false, 'single-phone play loads no QR code script');
  // The offline cache would serve the module, so it is bypassed here
  await page.setBypassServiceWorker(true);
  await page.setRequestInterception(true);
  page.on('request', r => /trystero/.test(r.url()) ? r.abort() : r.continue());
  await run(`startMatch({ ...DEFAULT_SETTINGS, shared: true, players: ${humans} })`);
  await wait(page, () => document.getElementById('toast').textContent.includes("Couldn't open the room"));
  assert.equal(await run('ROOM'), null, 'no room without a transport');
  assert.equal(await run("document.getElementById('roomBar').hidden"), true);
  // The join tile opens the join screen with a code field
  await run("goMenu(); document.querySelector('[data-menu=\"join\"]').click()");
  assert.equal(await run('S.screen'), 'join', 'the join tile opens the join screen');
  await run("document.getElementById('joinCode').value = 'k7q-m2p'; document.querySelector('[data-act=\"join\"]').click()");
  await wait(page, () => /Couldn't reach the room/.test(document.getElementById('page').innerText));
  await run("document.getElementById('joinCode').value = 'nope'; document.querySelector('[data-act=\"join\"]').click()");
  assert.match(await text('#page'), /6 letters and digits/, 'a bad code says what a code looks like');
  await run('goMenu()');
  await page.setRequestInterception(false);
  await page.setBypassServiceWorker(false);

  // The switch shows for games with 2 or more players, not for solo games
  const four = "[{ name: 'You', type: 'human' }, { name: 'Ann', type: 'human' }, { name: 'Bob', type: 'human' }, { name: 'Bot', type: 'bot', avg: 50 }]";
  await H(`startMatch({ ...DEFAULT_SETTINGS, players: ${four} }); goMenu()`);
  const shared = '#overlay [data-key="shared"]';
  await H("document.querySelector('[data-menu=\"doubles\"]').click()");
  assert.equal(await q(hostP, shared), false, 'no phones switch for a solo game');
  await H("document.querySelector('#overlay [data-act=\"cancel\"]').click(); document.querySelector('[data-menu=\"x01\"]').click()");
  assert.equal(await q(hostP, shared), true, 'the setup offers players on their own phones');
  await H(`document.querySelector('${shared}').click()`);
  assert.equal(await H(`document.querySelector('${shared}').getAttribute('aria-checked')`), 'true');
  await H("document.querySelector('#overlay [type=submit]').click()");
  await wait(hostP, () => ROOM?.role === 'host');
  const code = await H('ROOM.code');
  assert.equal(await H('S.settings.shared'), true);
  // The lobby: formatted code, QR code (loaded on demand), join link, seats
  assert.equal(await H("document.getElementById('roomBar').hidden"), false, 'the lobby shows');
  assert.match(await H("document.getElementById('roomBar').innerText"), new RegExp(code.slice(0, 3) + '-' + code.slice(3)), 'the lobby shows the formatted code');
  await wait(hostP, () => !!document.querySelector('#roomBar .qr svg, #roomBar .qr img'));
  assert.equal(await q(hostP, 'script[src="vendor/qrcode.js"]'), true, 'the QR script loads once a lobby opens');
  assert.match(await H("document.getElementById('roomBar').innerText"), new RegExp(`\\?join=${code}`), 'the lobby shows the join link');

  // The guest opens the join link: it joins at once and lands on the seat list
  await guestP.goto(`${url}?join=${code}&transport=local`, { waitUntil: 'networkidle0' });
  await wait(guestP, () => !!document.querySelector('#roomBar [data-act="claim"]'));
  assert.equal(await G('location.search'), '?transport=local', 'the join parameter is removed');
  assert.deepEqual(await disabled(guestP, '#roomBar [data-act="claim"]'), [true, false, false, true], 'the host\'s seat and the bot are greyed out');
  await G("document.querySelector('#roomBar [data-act=\"claim\"][data-v=\"1\"]').click()");
  await wait(guestP, () => ROOM.mine.includes(1));
  await wait(hostP, () => !!document.querySelector('#players .player:nth-child(2) .dot.on'));
  assert.equal(await q(hostP, '#players .player:nth-child(3) .dot:not(.on)'), true, 'an unclaimed seat has a grey dot');
  assert.equal(await q(hostP, '#players .player:nth-child(4) .dot'), false, 'a bot has no dot');
  assert.equal(await G("document.getElementById('roomBar').dataset.open"), 'false', 'the seat list folds once a seat is claimed');

  // Waiting: not the guest's turn, so its keypad is off
  assert.ok((await disabled(guestP, '#keys button')).every(Boolean), 'keys are off while You throw');
  await H('submit(60)');                                  // You
  assert.equal(await H("document.getElementById('roomBar').dataset.open"), 'false', 'the lobby folds after the first visit');
  assert.match(await H("document.getElementById('roomBar').innerText"), /1 phone/, 'the folded bar counts the phones');
  await H("document.querySelector('#roomBar [data-act=\"room\"]').click()");
  assert.equal(await H("document.getElementById('roomBar').dataset.open"), 'true', 'tapping the bar opens the lobby again');
  await sync();
  assert.ok((await disabled(guestP, '#keys button')).every(b => !b), 'keys are on for Ann\'s turn');
  assert.equal(await G("document.getElementById('undoBtn').disabled"), true, 'nothing to undo yet');
  // The host browses while Ann's visit is on its way: the visit still counts
  await G('window.v0 = ROOM.ver');
  await H("goScreen('history'); goScreen('play')");
  await sync();
  await viaGuest("guestSend({ type: 'visit', seat: 1, visit: { p: 1, before: 501, score: 100, dartsUsed: 3, dartsAtDouble: 0, bust: false, checkout: false } }, v0)");
  assert.equal(await H('remaining(curLeg(), 1)'), 401, 'browsing on the host does not make a guest\'s visit stale');
  assert.equal(await G("document.getElementById('undoBtn').disabled"), false, 'the guest can undo its visit');
  assert.ok((await disabled(guestP, '#keys button')).every(Boolean), 'keys are off for Bob');
  assert.match(await G("document.getElementById('readout').textContent"), /Waiting for Bob…/);
  await H('submit(45)');                                  // Bob, on the host
  await sync();
  assert.equal(await G("document.getElementById('undoBtn').disabled"), true, 'too late to undo once Bob has scored');
  assert.equal(await G("document.getElementById('undoBtn').hidden"), false, 'the disabled undo still shows');
  // Dart-by-dart games: the pad waits, and undo follows the same rule
  await H(`startMatch({ ...DEFAULT_SETTINGS, mode: 'killer', shared: true, players: ${four} })`);
  await sync();
  assert.ok((await disabled(guestP, '#gameLeft .gpadwrap [data-ga]')).every(Boolean), 'the game pad is off while You throw');
  assert.match(await G("document.getElementById('gameLeft').innerText"), /Waiting for You…/);
  for (let i = 0; i < 3; i++) await H("gameAct('dart', 0)");
  await sync();
  assert.ok((await disabled(guestP, '#gameLeft .gpadwrap [data-ga]')).some(b => !b), 'the game pad is on for Ann');
  assert.deepEqual(await disabled(guestP, '#gameLeft [data-act="undo"]'), [true], 'nothing to undo yet in Killer');
  await viaGuest("gameAct('dart', 0)");
  assert.deepEqual(await disabled(guestP, '#gameLeft [data-act="undo"]'), [false], 'the guest can undo its dart');

  // Layout at phone width: host lobby and guest waiting state
  const shots = new URL('../.superpowers/sdd/2026-11-01-multi-device-play/', import.meta.url);
  if (process.env.SHOTS) {
    // Changing isMobile would reload the pages and drop the room, so only the size changes
    for (const p of [hostP, guestP]) await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
    await H(`startMatch({ ...DEFAULT_SETTINGS, shared: true, players: ${four} })`);
    await sync();
    await wait(hostP, () => !!document.querySelector('#roomBar .qr svg'));
    await hostP.screenshot({ path: new URL('host-lobby.png', shots).pathname, fullPage: true });
    await guestP.screenshot({ path: new URL('guest-waiting.png', shots).pathname, fullPage: true });
    await G("document.querySelector('#roomBar [data-act=\"room\"]').click()");
    await guestP.screenshot({ path: new URL('guest-seats.png', shots).pathname, fullPage: true });
  }
  const wide = p => p.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  for (const p of [hostP, guestP]) await p.setViewport({ width: 320, height: 700 });
  assert.equal(await wide(hostP), false, 'the lobby fits 320 px');
  assert.equal(await wide(guestP), false, 'the guest fits 320 px');
  assert.deepEqual(errors, [], 'no errors on the two phones');
  for (const p of [hostP, guestP]) await p.setViewport({ width: 800, height: 900 });

  // ---- reconnecting and endings ----
  await G('leaveRoom()');
  const two = "[{ name: 'You', type: 'human' }, { name: 'Ann', type: 'human' }]";
  const short = `{ ...DEFAULT_SETTINGS, start: 101, count: 1, shared: true, players: ${two} }`;
  const host2 = async () => {
    await H(`startMatch(${short})`);
    await wait(hostP, () => ROOM?.role === 'host' && !!S.room);
    return H('ROOM.code');
  };
  const join2 = async code => {
    await G(`joinRoomAsGuest('${code}')`);
    await G('claim([1])');
    await wait(guestP, () => ROOM.mine.includes(1));
  };
  const scores = p => p.evaluate(() => [currentTurn(), ...players().map((_, q) => remaining(curLeg(), q))]);
  const ready = p => p.waitForFunction(() => typeof ROOM !== 'undefined' && ROOM?.mine?.includes(1) && S.screen === 'play', { timeout: 3000 });
  let code2 = await host2();
  await join2(code2);
  await H('submit(20)');                                  // You: 81
  await sync();
  await viaGuest('submit(2)');                            // Ann: 99
  // guest reload rejoins mid-match: it keeps its seat and has the host's scoreboard
  await guestP.reload({ waitUntil: 'domcontentloaded' });
  await ready(guestP);
  assert.deepEqual(await G('ROOM.mine'), [1], 'the guest gets its seat back after a reload');
  assert.deepEqual(await scores(guestP), await scores(hostP), 'the guest has the host\'s scoreboard after a reload');
  // host unreachable: the guest says so, and carries on once the host is back
  await G('ROOM_TIMES.hostLost = 300; S.marker = 1');
  await H('ROOM.transport.leave()');
  await wait(guestP, () => /Host disconnected/.test(document.getElementById('roomBar').innerText));
  assert.equal(await q(guestP, '#roomBar [data-act="leave"]'), true, 'the guest can leave while the host is away');
  // host reload reopens the room: same code, seats kept, and the guest gets a fresh state
  await hostP.reload({ waitUntil: 'networkidle0' });
  await wait(hostP, () => ROOM?.role === 'host');
  assert.equal(await H('ROOM.code'), code2, 'the host reopens the same room');
  await wait(guestP, () => !S.marker);
  await wait(guestP, () => !/Host disconnected/.test(document.getElementById('roomBar').innerText));
  assert.equal(await H('S.room.seats[1]'), await G('ROOM.self'), 'the host keeps the guest\'s seat over a reload');
  await H('submit(20)');                                  // You: 61
  await sync();
  await viaGuest('submit(99)');                           // Ann checks out 99 on her phone
  assert.equal(await H('S.matchWinner'), 1, 'the guest can score after the host reloads');
  // guest records the finished match, and the rematch keeps its seat
  assert.equal(await G('historyAll()[0]?.id'), await H('S.id'), 'the guest records the match in its own history');
  assert.equal(await G("!!document.querySelector('#winnerPanel [data-act=\"rematch\"]')"), false, 'only the host offers Play again');
  assert.equal(await q(guestP, '#winnerPanel [data-act="leave"]'), true, 'a guest can leave from the result');
  await H("document.querySelector('#winnerPanel [data-act=\"rematch\"]').click()");
  await sync();
  assert.equal(await G('S.id'), await H('S.id'), 'the guest follows the rematch');
  assert.deepEqual(await G('ROOM.mine'), [1], 'Play again keeps the guest\'s seat');
  // A guest can't pass itself off as the host: You's visit, out of turn for Ann's phone, is ignored
  await G("ROOM.transport.send({ type: 'visit', seat: 0, ver: ROOM.ver, app: APP_VERSION, phone: 'host', visit: { p: 0, before: 101, score: 60, dartsUsed: 3, dartsAtDouble: 0, bust: false, checkout: false } }, ROOM.host)");
  await new Promise(r => setTimeout(r, 300));
  assert.equal(await H('remaining(curLeg(), 0)'), 101, 'a guest calling itself host is ignored');
  // Restart keeps the room too (a rematch); Continue later keeps it; Discard ends it
  await H('submit(20)');
  await H("confirmRestart(); document.querySelector('#overlay [data-act=\"go\"]').click()");
  await sync();
  assert.deepEqual(await G('ROOM.mine'), [1], 'Restart keeps the room and the seat');
  await H('submit(20)');
  await H('goMenu()');
  await sync();
  assert.equal(await H('ROOM?.role'), 'host', 'going to the menu keeps the room');
  await H("document.querySelector('#menu [data-act=\"discard\"]').click(); document.querySelector('#overlay [data-act=\"go\"]').click()");
  await toastOn(guestP, 'The host ended the game');
  assert.equal(await G('ROOM'), null, 'the guest is out of the room');
  assert.equal(await G('S.screen'), 'menu', 'the guest goes to its menu');
  assert.equal(await H('ROOM'), null, 'the host is out of the room');
  assert.equal(await H('S.room'), undefined, 'the host\'s saved match has no room');
  // Reset all data ends the room too
  code2 = await host2();
  await join2(code2);
  await H("pageAct('reset'); document.querySelector('#overlay [data-act=\"go\"]').click()");
  await toastOn(guestP, 'The host ended the game');
  assert.equal(await G('ROOM'), null, 'reset releases the guest');
  // A new match with phones off ends the room
  code2 = await host2();
  await join2(code2);
  await H(`startMatch({ ...${short}, shared: false })`);
  await toastOn(guestP, 'The host ended the game');
  assert.equal(await H('ROOM'), null, 'a match without phones closes the room');
  // version mismatch refuses to join
  code2 = await host2();
  await G("window.realVersion = APP_VERSION; APP_VERSION = '0.0.1-old'");
  await G(`openJoin('${code2}', false); doJoin('${code2}')`);
  await wait(guestP, () => /Update Dartboss on this phone to join/.test(document.getElementById('page').innerText));
  assert.equal(await G('ROOM'), null, 'a guest on another version is not in the room');
  await G('APP_VERSION = realVersion');
  // no host: the join gives up after a while and offers Retry
  await G("ROOM_TIMES.connect = 300; doJoin('ZZZZZZ')");
  await wait(guestP, () => /Couldn't reach the room/.test(document.getElementById('page').innerText));
  assert.equal(await G("document.querySelector('#joinForm [type=submit]').textContent"), 'Retry');
  assert.equal(await G('ROOM'), null, 'a join that timed out leaves no room');
  // A join link opened at boot ends this phone's own hosted room: it doesn't come back after leaving and a reload
  await G(`startMatch(${short})`);
  await wait(guestP, () => ROOM?.role === 'host');
  const codeB = await G('ROOM.code');
  await hostP.goto(`${url}?join=${codeB}&transport=local`, { waitUntil: 'networkidle0' });
  await wait(hostP, () => ROOM?.role === 'guest' && ROOM.ver != null);
  assert.equal(await H('localS.room'), undefined, 'the old room is dropped from this phone\'s own game');
  assert.equal(await H('JSON.parse(localStorage.getItem(STORE_KEY)).room'), undefined, 'and from its saved game');
  await H('leaveRoom()');
  await hostP.reload({ waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 300));
  assert.equal(await H('ROOM'), null, 'the old room does not reopen');
  await G('leaveRoom()');
  assert.deepEqual(errors, [], 'no errors while reconnecting');

  // no network without a room: single-phone play only talks to the page's own origin
  const net = await browser.newPage(), seen = [];
  net.on('request', r => seen.push(r.url()));
  await net.goto(url, { waitUntil: 'networkidle0' });
  await net.evaluate(`startMatch({ ...DEFAULT_SETTINGS, players: ${two} }); submit(60)`);
  await new Promise(r => setTimeout(r, 300));
  const origin = new URL(url).origin;
  assert.deepEqual(seen.filter(u => !/^(data|blob):/.test(u) && new URL(u).origin !== origin), [], 'single-phone play makes no outside requests');
  assert.equal(seen.some(u => /trystero/.test(u)), false, 'single-phone play does not load the WebRTC module');
  await net.close();

  console.log('Browser checks passed');
} finally {
  await browser.close();
  server.close();
}
