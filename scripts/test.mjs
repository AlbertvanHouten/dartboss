// Quick checks without a browser: the source scripts parse, the checkout logic gives the standard routes,
// bots finish every game under its options, and every language has every string. Run: npm test
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const blocks = await Promise.all(['i18n', 'engine', 'games', 'app'].map(f => readFile(new URL(`../src/${f}.js`, import.meta.url), 'utf8')));
for (const b of blocks) new Function(b); // throws on a syntax error

const store = new Map();
const localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
const { E, GAMES, MENU, STRINGS } = new Function('localStorage', `${blocks[0]}\n${blocks[1]}\nlet buffer = ''; const isBotTurn = () => false;\n${blocks[2]}\nreturn { E, GAMES, MENU, STRINGS };`)(localStorage);

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
assert.match(kr.headline, /Tie between P0 and P1 and P2/);

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

console.log('All checks passed');
