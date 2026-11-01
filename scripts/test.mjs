// Quick checks without a browser: the source scripts parse, the checkout logic gives the standard routes,
// bots finish every game under its options, every game scores by its rules, and every language has every
// string. Run: npm test
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const blocks = await Promise.all(['i18n', 'engine', 'games', 'room', 'app'].map(f => readFile(new URL(`../src/${f}.js`, import.meta.url), 'utf8')));
for (const b of blocks) new Function(b); // throws on a syntax error

const store = new Map();
const localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
const { E, GAMES, MENU, STRINGS, makeRoomCode, formatRoomCode, parseRoomCode, versionOk, canAct, canUndo, claimSeats, recheckSeats } = new Function('localStorage', `${blocks[0]}\n${blocks[1]}\nlet buffer = ''; const isBotTurn = () => false;\n${blocks[2]}\n${blocks[3]}\nreturn { E, GAMES, MENU, STRINGS, makeRoomCode, formatRoomCode, parseRoomCode, versionOk, canAct, canUndo, claimSeats, recheckSeats };`)(localStorage);

// Checkout routes
const route = (r, out = 'double') => (E.bestRoute(r, 3, out) || []).map(E.label).join(' ');
assert.equal(route(170), 'T20 T20 Bull');
assert.equal(route(100), 'T20 D20');
assert.equal(route(32), 'D16');
assert.equal(route(180, 'master'), 'T20 T20 T20');
for (const bogey of [169, 168, 166, 165, 163, 162, 159]) assert.equal(E.minDarts(bogey, 'double'), Infinity, `${bogey} is no checkout`);

// The bot hits its set average in X01
for (const avg of [40, 80]) {
  const prof = E.profileFor(avg);
  let score = 0, darts = 0;
  for (let i = 0; i < 400; i++) {
    const ctx = E.makePersona(avg);
    let rem = 501;
    while (rem > 0) { const v = E.simulateVisit(rem, 'double', prof, ctx); rem -= v.score; score += v.score; darts += v.dartsUsed; }
  }
  const got = score / darts * 3;
  assert.ok(Math.abs(got - avg) < 4, `bot set to ${avg} averaged ${got.toFixed(1)}`);
}

// Bots finish every game, with and without options
const cases = [
  ['cricket', {}, 2], ['killer', {}, 4], ['shanghai', {}, 3], ['shanghai', { rounds: 20, variant: 'treble' }, 2],
  ['halveit', {}, 3], ['halveit', { targets: 'classic' }, 2], ['atc', {}, 3], ['atc', { segments: 'doubles', skip: 'on' }, 2],
  ['bobs27', {}, 2], ['bobs27', { mode: 'easy' }, 2],
];
for (const [mode, opts, n] of cases) {
  const st = { mode, opts: { [mode]: opts }, players: Array.from({ length: n }, (_, i) => ({ name: 'B' + i, type: 'bot', avg: 40 + 20 * i })) };
  const G = GAMES[mode];
  for (let k = 0; k < 30; k++) {
    const personas = {};
    const ctxFor = p => personas[p] || (personas[p] = E.makePersona(st.players[p].avg));
    const g = G.init(st);
    let guard = 0;
    while (!G.done(g)) { assert.ok(++guard < 5000, `${mode} did not finish`); G.botVisit(g, st, ctxFor); }
    G.hud(g, st); G.log(g, st); G.board(g, st); G.result(g, st);
  }
}
// Around the Clock skip-ahead: a skip stops on the last target unless the setting lets it carry past the end
const atcFrom19 = (skip, mult) => {
  const st = { mode: 'atc', opts: { atc: { skip } }, players: [{ name: 'You', type: 'human' }] };
  const g = GAMES.atc.init(st);
  g.pl[0].i = 18; // on 19
  GAMES.atc.act(g, 'dart', mult);
  return g;
};
assert.equal(atcFrom19('on', 3).pl[0].i, 20, 'T19 skips to the bull, not past it');
assert.equal(atcFrom19('on', 3).winner, null, 'the bull still has to be hit');
assert.equal(atcFrom19('past', 3).winner, 0, 'with skip past the end, T19 finishes');
const lastNotBull = { mode: 'atc', opts: { atc: { skip: 'on', order: 'desc' } }, players: [{ name: 'You', type: 'human' }] };
const gl = GAMES.atc.init(lastNotBull);
gl.pl[0].i = 20; // high to low ends on 1
GAMES.atc.act(gl, 'dart', 2);
assert.equal(gl.winner, 0, 'hitting the last target finishes, skip or not');

// A tie at the round limit is a tie, not a win for the first seat
const level = (mode, n, miss) => {
  const st = { mode, players: Array.from({ length: n }, (_, i) => ({ name: 'P' + i, type: 'human' })) };
  const g = GAMES[mode].init(st);
  while (!GAMES[mode].done(g)) GAMES[mode].act(g, 'dart', miss);
  return [g, GAMES[mode].result(g, st)];
};
const [cg, cr] = level('cricket', 2, '0:0');
assert.equal(cg.winner, -1, 'Cricket level at the limit is a tie');
assert.match(cr.headline, /Tie/);
const [kg, kr] = level('killer', 3, 0);
assert.equal(kg.winner, -1, 'Killer level at the limit is a tie');
assert.match(kr.headline, /Tie between P0, P1 and P2/);

// Scoring in every game: scripted darts, with the expected scores worked out by hand from the rules
const game = (mode, opts = {}, n = 1) => {
  const st = { mode, opts: { [mode]: opts }, players: Array.from({ length: n }, (_, i) => ({ name: 'P' + i, type: 'human' })) };
  return GAMES[mode].init(st);
};
const throwAll = (mode, g, vals, a = 'dart') => vals.forEach(v => GAMES[mode].act(g, a, v));

// Cricket: three marks close a number, extra marks score while the opponent is open, never once both closed
const crG = game('cricket', {}, 2);
throwAll('cricket', crG, ['20:3', '20:3', '20:1']);           // P0 closes 20, then scores 60 + 20
assert.deepEqual([crG.pl[0].m[20], crG.pl[0].pts, crG.pl[0].marks, crG.turn], [3, 80, 7, 1], 'Cricket: close, then score');
throwAll('cricket', crG, ['20:3', '20:3', '0:0']);            // P1 closes 20; the extra treble scores nothing
assert.deepEqual([crG.pl[1].m[20], crG.pl[1].pts, crG.pl[1].marks], [3, 0, 3], 'Cricket: no points on a number both closed');
const crEnd = (myPts, theirPts) => {
  const g = game('cricket', {}, 2);
  for (const n of [16, 17, 18, 19, 20, 25]) g.pl[0].m[n] = 3;
  g.pl[0].m[15] = 2; g.pl[0].pts = myPts; g.pl[1].pts = theirPts;
  GAMES.cricket.act(g, 'dart', '15:1');
  return g.winner;
};
assert.equal(crEnd(10, 20), null, 'Cricket: closing everything while behind does not win');
assert.equal(crEnd(20, 20), 0, 'Cricket: closing everything while level wins');

// Killer: your own double makes you a killer, then costs you a life; a killer's hit takes an opponent's life
const ki = game('killer', {}, 3);
ki.pl.forEach((p, i) => { p.num = i + 1; });
throwAll('killer', ki, [2, 1, 2]);                            // not a killer yet, own double, then hit P1
assert.deepEqual([ki.pl[0].killer, ki.pl[1].lives, ki.pl[0].hits, ki.turn], [true, 2, 1, 1], 'Killer: becoming a killer, then a hit');
throwAll('killer', ki, [0, 0, 0, 0, 0, 0, 1]);                // P1 and P2 miss; P0 hits their own double as a killer
assert.equal(ki.pl[0].lives, 2, 'Killer: a killer hitting their own double loses a life');
ki.pl[1].lives = 1; ki.pl[2].lives = 1;
throwAll('killer', ki, [2, 3]);                               // P0 takes the last lives of P1 and P2
assert.deepEqual([ki.pl[1].lives, ki.pl[2].lives, ki.winner], [0, 0, 0], 'Killer: the last one standing wins');

// Shanghai: number × ring per dart; single, double and treble in one visit wins on the spot
const sh = game('shanghai', {}, 2);
throwAll('shanghai', sh, [1, 1, 0, 3, 0, 0]);                 // round 1: P0 2, P1 3
assert.deepEqual([sh.pl[0].score, sh.pl[1].score, sh.round], [2, 3, 2], 'Shanghai: number times the ring');
throwAll('shanghai', sh, [1, 2, 3]);                          // round 2: P0 hits all three rings
assert.deepEqual([sh.winner, sh.shanghai, sh.pl[0].score], [0, true, 14], 'Shanghai: a Shanghai wins outright');
const shN = game('shanghai', { variant: 'number' });
throwAll('shanghai', shN, [1, 1, 1, 0, 0, 0]);                // 3, then three misses on 2
assert.deepEqual([shN.pl[0].score, shN.pl[0].halves], [1, 1], 'Shanghai: require number halves the score');
const shT = game('shanghai', { variant: 'treble' });
throwAll('shanghai', shT, [1, 2, 0, 3, 0, 0]);                // no treble on 1 resets; a treble on 2 keeps 6
assert.deepEqual([shT.pl[0].score, shT.pl[0].resets], [6, 1], 'Shanghai: require treble resets without a treble');
const shTie = game('shanghai', {}, 2);
throwAll('shanghai', shTie, Array(42).fill(0));               // 7 rounds of misses for both
assert.equal(shTie.winner, -1, 'Shanghai: level after the last round is a tie');

// Halve It: a scoring round adds, a missed round halves (rounding down); only possible totals are accepted
const hi = game('halveit', { targets: 'classic' });          // 15, 16, any double, 17, 18, any treble, 19, 20, bull
assert.equal(hi.pl[0].score, 40, 'Halve It: everyone starts on 40');
GAMES.halveit.act(hi, 'score', 45);                           // three 15s
GAMES.halveit.act(hi, 'score', 0);                            // missed 16: 85 halves to 42
assert.deepEqual([hi.pl[0].score, hi.pl[0].halves], [42, 1], 'Halve It: a miss halves, rounding down');
assert.equal(GAMES.halveit.validate(hi, 40), null, 'Halve It: 40 can be made on any double');
assert.ok(GAMES.halveit.validate(hi, 41), 'Halve It: an odd total is impossible on doubles');
throwAll('halveit', hi, [40, 51, 0, 60, 57, 40, 50], 'score'); // the remaining seven rounds
assert.deepEqual([hi.winner, hi.pl[0].score], [0, 273], 'Halve It: the game ends after the last target');

// 121 Checkout: a checkout raises the target; a miss drops back to the safehouse; busts score nothing
const c = game('c121');                                       // 121, nine darts, +1, safe after a 3-dart checkout
GAMES.c121.act(c, 'score', 121);                              // checked out in one visit: protected
assert.deepEqual([c.target, c.safe, c.high], [122, 121, 121], 'Checkout 121: a one-visit checkout is protected');
throwAll('c121', c, [60, 62], 'score');                       // 122 in two visits: the target goes up, the safehouse doesn't
assert.deepEqual([c.target, c.safe, c.high], [123, 121, 122], 'Checkout 121: a two-visit checkout raises the target but not the safehouse');
throwAll('c121', c, [60, 60, 1], 'score');                    // 123 → 63 → 3 → 2: not out in nine darts
assert.deepEqual([c.target, c.results.map(r => r.ok)], [121, [true, true, false]], 'Checkout 121: a miss drops back to the safehouse');
throwAll('c121', c, [180], 'score');                          // more than 121 left is a bust: the remainder stays
assert.equal(c.rem, 121, 'Checkout 121: a bust leaves the remainder');
assert.ok(GAMES.c121.validate({ rem: 159 }, 159), 'Checkout 121: 159 can be scored but not checked out');
const cStart = game('c121', { safe: 'start', start: 61 });
throwAll('c121', cStart, [61, 0, 0, 0], 'score');
assert.equal(cStart.target, 61, 'Checkout 121: "back to start" ignores earlier checkouts');

// Around the Clock: what counts and how many hits each target needs
const atcH = game('atc', { hits: 2 });
throwAll('atc', atcH, [1, 1]);
assert.equal(atcH.pl[0].i, 1, 'Around the Clock: two hits per target');
const atcD = game('atc', { segments: 'doubles' });
throwAll('atc', atcD, [1, 3, 2]);
assert.deepEqual([atcD.pl[0].i, atcD.pl[0].darts], [1, 3], 'Around the Clock: doubles only');
const atcB = game('atc', { bull: 'bullseye' });
throwAll('atc', atcB, [...Array(20).fill(1), 1, 2]);         // 1 to 20, then an outer bull that doesn't count
assert.deepEqual([atcB.winner, atcB.pl[0].darts], [0, 22], 'Around the Clock: bullseye only');
assert.match(GAMES.atc.result(atcB, { players: [{ name: 'P0' }] }).headline, /22 darts/);

// Bob's 27: hits add the double's value, three misses take it off; hard mode ends below zero
const bob = game('bobs27');
throwAll('bobs27', bob, [1, 0, 0, 0, 0]);                     // 27 +2 −4 −6 −8 −10 = 1
assert.deepEqual([bob.pl[0].score, bob.pl[0].dead, bob.winner], [1, false, null], "Bob's 27: hits add, misses subtract");
GAMES.bobs27.act(bob, 'hits', 0);                             // −12 drops below zero
assert.deepEqual([bob.pl[0].score, bob.pl[0].dead, bob.winner], [-11, true, 0], "Bob's 27: below zero ends a hard game");
const bobEasy = game('bobs27', { mode: 'easy' });
throwAll('bobs27', bobEasy, [0, 0, 0, 0, 0, 0]);
assert.deepEqual([bobEasy.pl[0].dead, bobEasy.winner], [false, null], "Bob's 27: easy mode plays on");
const bobMax = game('bobs27');
throwAll('bobs27', bobMax, Array(21).fill(3));
assert.equal(bobMax.pl[0].score, 1437, "Bob's 27: the maximum is 1437");

// Singles, Doubles and Score Training
const si = game('singles');
throwAll('singles', si, [...Array(60).fill(3), 2, 2, 2]);
assert.equal(GAMES.singles.result(si).best, 186, 'Singles Training: the maximum is 186');
const dbHit = game('doubles', { bull: 'off' });
GAMES.doubles.act(dbHit, 'miss'); GAMES.doubles.act(dbHit, 'miss'); GAMES.doubles.act(dbHit, 'hit');
assert.deepEqual([dbHit.i, dbHit.darts, dbHit.targets.length], [1, 3, 20], 'Doubles Training: stay on a double until it is hit');
const db3 = game('doubles', { mode: 'three' });
throwAll('doubles', db3, Array(21).fill(2), 'hits');
assert.deepEqual([GAMES.doubles.done(db3), GAMES.doubles.result(db3).best], [true, 42], 'Doubles Training: three darts each');
const sc = game('score');
throwAll('score', sc, [60, 100, 180, 26, 45, 85, 41, 140, 81, 100], 'score');
assert.deepEqual([GAMES.score.done(sc), GAMES.score.result(sc).headline], [true, 'Average 85.80'], 'Score Training: the average of ten visits');

// Translations: each table has the same keys and placeholders, and covers the strings the code looks up by
// their English text (t('…') literals, game names, rules and options, the menu, the static markup)
const holes = s => (s.match(/\{\w+\}/g) || []).sort().join();
const [nl, de] = [STRINGS.nl, STRINGS.de];
assert.deepEqual(Object.keys(nl).sort(), Object.keys(de).sort(), 'Dutch and German have the same keys');
for (const [lang, tab] of Object.entries(STRINGS)) for (const [k, v] of Object.entries(tab)) assert.equal(holes(v), holes(k), `${lang}: placeholders in "${k}"`);
const used = new Set();
for (const b of blocks.slice(1)) for (const m of b.matchAll(/\bt\((['"])(.*?)\1/g)) used.add(m[2]);
const body = await readFile(new URL('../src/body.html', import.meta.url), 'utf8');
for (const m of body.matchAll(/data-t>(.*?)<\/(button|span|h2)>/g)) used.add(m[1]);
for (const G of Object.values(GAMES)) {
  for (const k of ['title', 'rules', 'hint', 'keys']) if (G[k]) used.add(G[k]);
  for (const o of G.options || []) { used.add(o.label); o.choices.forEach(c => used.add(String(c[1]))); }
}
for (const [group, items] of MENU) { used.add(group); for (const [, title, desc] of items) used.add(title).add(desc); }
for (const k of used) if (/[a-z]/i.test(k)) assert.ok(k in nl, `no translation for "${k}"`);

// The caller has a clip for every call the app can make
const { existsSync } = await import('node:fs');
const clip = name => existsSync(new URL(`../web/caller/${name}.mp3`, import.meta.url));
for (const name of ['noscore', 'bust', 'gameshot']) assert.ok(clip(name), `caller/${name}.mp3`);
for (let s = 1; s <= 180; s++) if (E.validVisit(s)) assert.ok(clip(String(s)), `caller/${s}.mp3`);
for (let r = 2; r <= 170; r++) if (E.minDarts(r, 'double') <= 3) assert.ok(clip(`req-${r}`), `caller/req-${r}.mp3`);

// Multi-device rules
assert.match(makeRoomCode(), /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
assert.equal(formatRoomCode('K7QM2P'), 'K7Q-M2P');
assert.equal(parseRoomCode(' k7q-m2p '), 'K7QM2P');
assert.equal(parseRoomCode('K7QM20'), null);
assert.equal(versionOk({ app: '1.2.0' }, '1.2.0'), true);
assert.equal(versionOk({ app: '1.1.0' }, '1.2.0'), false);

const room = { seats: { 1: 'peerA', 2: 'peerB' } };
assert.equal(canAct({ from: 'host', input: { type: 'visit', seat: 3, ver: 5 }, room, turn: 3, ver: 5 }), null);
assert.equal(canAct({ from: 'peerA', input: { type: 'visit', seat: 1, ver: 5 }, room, turn: 1, ver: 5 }), null);
assert.equal(canAct({ from: 'peerA', input: { type: 'visit', seat: 2, ver: 5 }, room, turn: 2, ver: 5 }), 'seat');
assert.equal(canAct({ from: 'peerA', input: { type: 'visit', seat: 1, ver: 5 }, room, turn: 2, ver: 5 }), 'turn');
assert.equal(canAct({ from: 'peerA', input: { type: 'visit', seat: 1, ver: 4 }, room, turn: 1, ver: 5 }), 'stale');

// X01: one act per visit. Seat 1 threw, turn passed to seat 2.
const u = (from, seat, acts) => canUndo({ from, seat, room, acts, n: 4 });
assert.equal(u('peerA', 1, [{ seat: 1, turnAfter: 2 }]), null, 'next visit not entered yet');
assert.equal(u('peerA', 1, [{ seat: 1, turnAfter: 2 }, { seat: 2, turnAfter: 3 }]), 'undo', 'next visit complete');
assert.equal(u('host', 1, [{ seat: 1, turnAfter: 2 }, { seat: 2, turnAfter: 3 }]), null, 'host may always undo');
// Dart-by-dart: seat 2 has thrown two darts of an unfinished visit
assert.equal(u('peerA', 1, [{ seat: 1, turnAfter: 2 }, { seat: 2, turnAfter: 2 }, { seat: 2, turnAfter: 2 }]), null);
assert.equal(u('peerA', 1, [{ seat: 1, turnAfter: 2 }, { seat: 2, turnAfter: 2 }, { seat: 2, turnAfter: 3 }]), 'undo');
// No undo after a bot visit: seat 2 is a bot and threw its visit
assert.equal(u('peerA', 1, [{ seat: 1, turnAfter: 2 }, { seat: 2, turnAfter: 3 }]), 'undo');
assert.equal(u('peerA', 2, [{ seat: 1, turnAfter: 2 }]), 'seat', 'seat 2 belongs to peerB');
assert.equal(canUndo({ from: 'peerA', seat: 3, room: { seats: { 1: 'peerA', 3: 'peerA' } }, acts: [{ seat: 1, turnAfter: 2 }], n: 4 }), 'undo', 'nothing of its own to undo');
assert.equal(u('peerB', 1, [{ seat: 1, turnAfter: 2 }]), 'seat');

const players = [{ type: 'human' }, { type: 'human' }, { type: 'bot' }, { type: 'human' }];
const r2 = { seats: { 1: 'peerA' } };
assert.deepEqual(claimSeats({ room: r2, peer: 'peerB', seats: [0, 1, 2, 3, 9], players }), { ok: [3], refused: [0, 1, 2, 9] });
assert.deepEqual(claimSeats({ room: r2, peer: 'peerA', seats: [1, 3], players }), { ok: [1], refused: [3] });
// A rematch or new match in the room: seats that are now the host's, a bot's or gone are dropped, the rest kept
const r3 = { seats: { 0: 'peerA', 1: 'peerA', 2: 'peerB', 3: 'peerB', 5: 'peerC' } };
assert.equal(recheckSeats(r3, players), r3, 'the room is changed in place');
assert.deepEqual(r3.seats, { 1: 'peerA', 3: 'peerB' });

console.log('All checks passed');
