// ===== App =====
const $ = id => document.getElementById(id);
// APP_STORE_ID is filled in once the app exists in App Store Connect (it turns on the rate button)
const APP_VERSION = '__APP_VERSION__', APP_STORE_ID = '';
const STORE_KEY = 'oche-match-v1';
const DEFAULT_SETTINGS = {
  mode: 'x01', start: 501, inRule: 'straight', out: 'double',
  unit: 'legs', kind: 'firstTo', count: 3, setLegs: 3, twoClear: false, first: 'p1',
  players: [{ name: 'You', type: 'human' }, { name: 'Bot', type: 'bot', avg: 50 }],
};
// Fill in X01 options missing from older saves
function normX01(st) {
  if (st.count == null) st.count = st.legs || 3;
  delete st.legs;
  for (const k of ['start', 'inRule', 'out', 'unit', 'kind', 'setLegs', 'twoClear', 'first']) if (st[k] == null) st[k] = DEFAULT_SETTINGS[k];
  return st;
}
const RULE_NAME = { straight: 'Straight', double: 'Double', master: 'Master' };
// Visit totals a player can score on the visit they open with double/master in
const OPEN_SETS = (() => {
  const any = [0, ...E.SEGS.map(x => x.v)];
  const make = rule => {
    const openers = E.SEGS.filter(x => x.dbl || (rule === 'master' && x.ring === 'T')).map(x => x.v);
    const set = new Set([0]);
    for (const o of openers) for (const a of any) for (const b of any) set.add(o + a + b);
    return set;
  };
  return { double: make('double'), master: make('master') };
})();
let S;
let buffer = '';
let botTimer = null;
let botBusy = false;
let botToken = 0;      // bumped to cancel a bot visit in progress
let botReveal = null;  // darts of the X01 bot visit being thrown right now

const clone = o => JSON.parse(JSON.stringify(o));
function freshMatch(settings) {
  const s = clone(settings);
  s.mode = s.mode || 'x01';
  if (s.mode === 'x01') normX01(s);
  const first = s.first === 'random' ? Math.floor(Math.random() * s.players.length) : 0;
  const m = { settings: s, legs: [{ starter: first, visits: [], winner: null }], id: Date.now(), matchWinner: null, hist: [], screen: 'play', bots: {}, firstThrower: first };
  if (s.mode !== 'x01') { m.game = GAMES[s.mode].init(s); m.game.bk = bestKey(s); }
  return m;
}
const isGame = () => S.settings.mode !== 'x01';
// Each bot's habits and running form for this match (favourite double, scoring bed, …)
function botCtx(p) {
  S.bots = S.bots || {};
  if (!S.bots[p]) S.bots[p] = E.makePersona(botAvg(players()[p]));
  return S.bots[p];
}
function cancelBot() { clearTimeout(botTimer); botToken++; botReveal = null; }
const players = () => S.settings.players;
const n = () => players().length;
const curLeg = () => S.legs[S.legs.length - 1];
const turnOf = leg => (leg.starter + leg.visits.length) % n();
const remaining = (leg, p) => S.settings.start - leg.visits.filter(v => v.p === p).reduce((a, v) => a + v.score, 0);
const legsWon = p => S.legs.filter(l => l.winner === p).length;
// Has this player opened the leg yet (always true with straight in)? A visit with points means they have.
const opened = (leg, p) => (S.settings.inRule || 'straight') === 'straight' || leg.visits.some(v => v.p === p && v.score > 0);
const needOf = (count, kind) => kind === 'bestOf' ? Math.floor(count / 2) + 1 : count;
// Winner of a race to `need` (with an optional two-clear rule), or -1
function raceWinner(counts, need, twoClear) {
  for (let p = 0; p < counts.length; p++) {
    const best = Math.max(0, ...counts.filter((_, q) => q !== p));
    if (counts[p] >= need && (!twoClear || counts[p] - best >= 2)) return p;
  }
  return -1;
}
// Sets and legs so far, worked out from the finished legs
function standings() {
  const st = S.settings, N = n();
  const sets = Array(N).fill(0), total = Array(N).fill(0);
  let setLegs = Array(N).fill(0), setsDone = 0;
  for (const leg of S.legs) {
    if (leg.winner == null) continue;
    total[leg.winner]++;
    if (st.unit === 'sets') {
      setLegs[leg.winner]++;
      const w = raceWinner(setLegs, st.setLegs, st.twoClear);
      if (w >= 0) { sets[w]++; setsDone++; setLegs = Array(N).fill(0); }
    }
  }
  const legs = st.unit === 'sets' ? setLegs : total;
  const matchWinner = st.unit === 'sets' ? raceWinner(sets, needOf(st.count, st.kind), false) : raceWinner(total, needOf(st.count, st.kind), st.twoClear);
  return { sets, legs, total, setsDone, legsInSet: setLegs.reduce((a, b) => a + b, 0), matchWinner };
}
// Would winning the current leg win the match for player p?
function legWinsMatch(p) {
  const leg = curLeg(), w = leg.winner;
  leg.winner = p;
  const r = standings().matchWinner === p;
  leg.winner = w;
  return r;
}
// Who throws first in the next leg: the set's starter alternates, and legs alternate within a set
function nextStarter() {
  const st = S.settings, s = standings(), first = S.firstThrower || 0;
  const k = st.unit === 'sets' ? s.setsDone + s.legsInSet : s.total.reduce((a, b) => a + b, 0);
  return (first + k) % n();
}
function formatText(st) {
  const unit = st.unit === 'sets' ? 'set' : 'leg';
  const head = st.kind === 'bestOf' ? `Best of ${st.count} ${unit}s` : `First to ${st.count} ${unit}${st.count > 1 ? 's' : ''}`;
  return head + (st.unit === 'sets' ? ` (first to ${st.setLegs} leg${st.setLegs > 1 ? 's' : ''})` : '') + (st.twoClear ? ', two clear' : '');
}
function isBotTurn() {
  if (isGame()) {
    const G = GAMES[S.settings.mode];
    return !!G.botVisit && !G.done(S.game) && players()[S.game.turn]?.type === 'bot';
  }
  return S.matchWinner == null && players()[turnOf(curLeg())].type === 'bot';
}
const fmt = (x, d = 1) => x == null ? '–' : x.toFixed(d);

// Saved in the browser; inside the iOS app also mirrored to native storage (see native.js)
function save() {
  // Undo snapshots stay in memory; saving all of them outgrows the browser's storage on long games
  const json = JSON.stringify({ ...S, hist: (S.hist || []).slice(-10) });
  try { localStorage.setItem(STORE_KEY, json); } catch (e) { toast('Could not save: device storage is full'); }
  window.ocheNative?.persist(STORE_KEY, json);
}
// ---------- history and app settings ----------
const HISTORY_KEY = 'oche-history-v1', SETTINGS_KEY = 'oche-settings-v1';
function readJSON(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch (e) { return fallback; } }
function writeJSON(key, value) {
  const json = JSON.stringify(value);
  try { localStorage.setItem(key, json); } catch (e) {}
  window.ocheNative?.persist(key, json);
}
const SETTINGS_DEFAULT = { theme: 'system', haptics: true, awake: true };
let SETTINGS = { ...SETTINGS_DEFAULT };
function setSetting(key, value) { SETTINGS[key] = value; writeJSON(SETTINGS_KEY, SETTINGS); applySettings(); }
function applySettings() {
  if (SETTINGS.theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = SETTINGS.theme;
  if (window.ocheNative) window.ocheNative.haptics = SETTINGS.haptics;
}
// Finished matches and games, newest first. X01 entries keep the legs (for the sheet and lifetime
// stats), other games keep their final state and result. shortcut: keeps the last 300, add paging if players want more
const HISTORY_MAX = 300;
const historyAll = () => readJSON(HISTORY_KEY, []);
function recordHistory() {
  const st = S.settings, entry = { id: S.id, at: new Date().toISOString(), mode: st.mode, settings: clone(st) };
  if (isGame()) {
    const r = GAMES[st.mode].result(S.game, st);
    Object.assign(entry, { game: S.game, headline: r.headline, detail: r.detail, winner: S.game.winner ?? null });
  } else {
    // The darts' board positions are only for drawing during play
    Object.assign(entry, { legs: S.legs.map(l => ({ ...l, visits: l.visits.map(({ darts, ...v }) => v) })), headline: matchHeadline(), winner: S.matchWinner });
  }
  writeJSON(HISTORY_KEY, [entry, ...historyAll().filter(e => e.id !== S.id)].slice(0, HISTORY_MAX));
}
const forgetHistory = id => writeJSON(HISTORY_KEY, historyAll().filter(e => e.id !== id));
function matchHeadline() {
  const st = S.settings, sd = standings(), tally = st.unit === 'sets' ? sd.sets : sd.total, w = S.matchWinner;
  const rest = Math.max(0, ...players().map((_, p) => p).filter(p => p !== w).map(q => tally[q]));
  return `Match to ${players()[w].name}, ${tally[w]}–${rest}${st.unit === 'sets' ? ' in sets' : ''}`;
}

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) { const s = JSON.parse(raw); if (s && s.settings && Array.isArray(s.legs) && s.legs.length) return s; }
  } catch (e) {}
  return null;
}

// ---------- board ----------
function buildBoard() {
  const svg = $('board');
  const NS = 'http://www.w3.org/2000/svg';
  const pt = (r, a) => { const t = a * Math.PI / 180; return [(r * Math.sin(t)).toFixed(2), (-r * Math.cos(t)).toFixed(2)]; };
  const sector = (r1, r2, a1, a2) => {
    const [x1, y1] = pt(r2, a1), [x2, y2] = pt(r2, a2), [x3, y3] = pt(r1, a2), [x4, y4] = pt(r1, a1);
    return `M${x1} ${y1}A${r2} ${r2} 0 0 1 ${x2} ${y2}L${x3} ${y3}A${r1} ${r1} 0 0 0 ${x4} ${y4}Z`;
  };
  const el = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };
  svg.innerHTML = `<defs><radialGradient id="shade" cx="50%" cy="45%" r="55%"><stop offset="60%" stop-color="#000" stop-opacity="0"/><stop offset="100%" stop-color="#000" stop-opacity=".28"/></radialGradient>
    <radialGradient id="rim" cx="50%" cy="40%" r="60%"><stop offset="80%" stop-color="#2a2d2c"/><stop offset="100%" stop-color="#0d0e0e"/></radialGradient></defs>`;
  svg.appendChild(el('circle', { cx: 0, cy: 0, r: 199, fill: 'url(#rim)' }));
  svg.appendChild(el('circle', { cx: 0, cy: 0, r: 197.5, fill: 'none', stroke: 'rgba(255,255,255,.12)', 'stroke-width': 1.5 }));
  const R = E.R;
  E.ORDER.forEach((num, i) => {
    const a1 = i * 18 - 9, a2 = i * 18 + 9, even = i % 2 === 0;
    const single = even ? 'var(--board-black)' : 'var(--board-cream)';
    const colour = even ? 'var(--board-red)' : 'var(--board-green)';
    [[R.outerBull, R.trebleIn, 'S', single], [R.trebleIn, R.trebleOut, 'T', colour], [R.trebleOut, R.doubleIn, 'S', single], [R.doubleIn, R.doubleOut, 'D', colour]]
      .forEach(([r1, r2, ring, fill]) => svg.appendChild(el('path', { d: sector(r1, r2, a1, a2), fill, class: 'seg', 'data-k': ring + num })));
    const [tx, ty] = pt(185, i * 18);
    const t = el('text', { x: tx, y: ty, class: 'n' }); t.textContent = num; svg.appendChild(t);
  });
  svg.appendChild(el('circle', { cx: 0, cy: 0, r: R.outerBull, fill: 'var(--board-green)', class: 'seg', 'data-k': '25' }));
  svg.appendChild(el('circle', { cx: 0, cy: 0, r: R.bull, fill: 'var(--board-red)', class: 'seg', 'data-k': 'BULL' }));
  svg.appendChild(el('circle', { cx: 0, cy: 0, r: R.doubleOut, fill: 'url(#shade)', 'pointer-events': 'none' }));
  svg.appendChild(el('circle', { cx: 0, cy: 0, r: R.doubleOut + 0.6, fill: 'none', stroke: '#b9bcb8', 'stroke-width': 1.2, opacity: .7 }));
  const g = el('g', { id: 'dartsLayer' });
  svg.appendChild(g);
}
let drawnDarts = [];
function drawDarts(darts) {
  darts = darts || [];
  const key = d => `${d.x},${d.y}`;
  if (darts.length === drawnDarts.length && darts.every((d, i) => key(d) === key(drawnDarts[i]))) return;
  // Darts already on the board stay put; only new ones land (one after another)
  const keep = darts.length >= drawnDarts.length && drawnDarts.every((d, i) => key(d) === key(darts[i])) ? drawnDarts.length : 0;
  const g = $('dartsLayer');
  if (!keep) g.innerHTML = '';
  darts.slice(keep).forEach((d, j) => {
    const i = keep + j;
    const NS = 'http://www.w3.org/2000/svg';
    const grp = document.createElementNS(NS, 'g');
    grp.setAttribute('class', 'dart');
    grp.setAttribute('style', `animation-delay:${j * 0.45}s;transform-origin:${d.x}px ${-d.y}px`);
    grp.innerHTML = d.bounce
      ? `<circle cx="${d.x}" cy="${-d.y}" r="7" fill="none" stroke="#ffffff" stroke-width="2" stroke-dasharray="3 2"/><title>Bounce-out</title>`
      : `<circle cx="${d.x}" cy="${-d.y}" r="7" fill="#ffffff" stroke="#111" stroke-width="2"/><text x="${d.x}" y="${-d.y}" font-size="9" font-weight="700" text-anchor="middle" dominant-baseline="central" fill="#111" font-family="Barlow, sans-serif">${i + 1}</text>`;
    g.appendChild(grp);
  });
  drawnDarts = darts.slice();
}
const dartLabel = d => d.bounce ? 'Bounce-out' : E.label(E.BY[d.k]);
function highlight(route) {
  const svg = $('board');
  svg.querySelectorAll('.seg.hl').forEach(e => e.classList.remove('hl'));
  svg.classList.toggle('focus', !!(route && route.length));
  (route || []).forEach(s => svg.querySelectorAll(`[data-k="${s.k}"]`).forEach(e => e.classList.add('hl')));
}

// ---------- rendering ----------
// Screens besides the menu and play: title and renderer
const PAGES = {
  history: ['Match history', () => renderHistory()],
  stats: ['Player stats', () => renderStatsPage()],
  settings: ['Settings', () => renderSettings()],
};
function render() {
  const scr = S.screen, menu = scr === 'menu', page = PAGES[scr];
  $('menu').hidden = !menu;
  $('page').hidden = !page;
  $('play').hidden = scr !== 'play';
  $('tabs').hidden = scr === 'play';
  for (const b of $('tabs').querySelectorAll('[data-nav]')) b.setAttribute('aria-current', b.dataset.nav === scr ? 'page' : 'false');
  $('menuBtn').hidden = $('rematchBtn').hidden = scr !== 'play';
  window.ocheNative?.keepAwake?.(scr === 'play' && SETTINGS.awake);
  if (menu) { $('meta').textContent = 'Pick a game'; return renderMenu(); }
  if (page) { $('meta').textContent = page[0]; return page[1](); }
  const game = isGame();
  $('x01Left').hidden = $('x01Right').hidden = game;
  $('gameLeft').hidden = $('gameRight').hidden = !game;
  if (game) return renderGame();
  const st = S.settings, leg = curLeg(), turn = S.matchWinner == null ? turnOf(leg) : -1;
  const sd = standings();
  const where = S.matchWinner != null ? 'Match over' : st.unit === 'sets' ? `Set ${sd.setsDone + 1}, leg ${sd.legsInSet + 1}` : `Leg ${S.legs.length}`;
  $('meta').textContent = `${st.start} · ${st.inRule !== 'straight' ? RULE_NAME[st.inRule] + ' in · ' : ''}${RULE_NAME[st.out === 'single' ? 'straight' : st.out]} out · ${formatText(st)} · ${where}`;
  const stats = E.stats(S.legs, n());

  // scoreboard
  const pe = $('players');
  pe.style.setProperty('--n', n());
  pe.innerHTML = players().map((pl, p) => {
    const rem = remaining(leg, p);
    const route = opened(leg, p) ? E.bestRoute(rem, 3, st.out) : null;
    const mine = leg.visits.filter(v => v.p === p);
    const last = mine[mine.length - 1];
    const legDarts = mine.reduce((a, v) => a + v.dartsUsed, 0);
    const legNeed = st.unit === 'sets' ? st.setLegs : needOf(st.count, st.kind);
    const pips = (st.unit === 'sets' ? `<span class="setnum" title="Sets won">${sd.sets[p]}</span>` : '') +
      (legNeed <= 9 ? Array.from({ length: legNeed }, (_, i) => `<span class="pip${i < sd.legs[p] ? ' on' : ''}"></span>`).join('') : `<span class="setnum" title="Legs won">${sd.legs[p]}</span>`);
    const tag = pl.type === 'bot' ? ` <span class="label" title="Favourite double D${botCtx(p).fav}">${botAvg(pl)} avg · D${botCtx(p).fav}</span>` : '';
    const status = p === turn && pl.type === 'bot' ? `<span class="thinking">Throwing</span>` : '';
    return `<article class="player${p === turn ? ' active' : ''}" aria-current="${p === turn}">
      <div class="head"><span class="name">${esc(pl.name)}${tag}</span><span class="pips" title="${st.unit === 'sets' ? `Sets ${sd.sets[p]}, legs this set ${sd.legs[p]}` : `Legs won: ${sd.legs[p]}`}">${pips}</span></div>
      <div class="rem num">${rem}</div>
      <div class="route">${route ? routeChips(route) : !opened(leg, p) ? `Open on a ${st.inRule === 'master' ? 'double or treble' : 'double'}` : status}</div>
      <div class="sub"><span>Avg <b>${fmt(stats[p].avg)}</b></span><span>Last <b>${last ? (last.bust ? 'Bust' : last.score) : '–'}</b></span><span>Darts <b>${legDarts}</b></span></div>
    </article>`;
  }).join('');

  // winner
  const wp = $('winnerPanel');
  if (S.matchWinner != null) {
    const w = stats[S.matchWinner];
    wp.hidden = false;
    wp.className = 'panel winner';
    wp.innerHTML = `<h2>${esc(matchHeadline())}</h2>
      <p style="margin:0 0 12px;color:var(--muted)">Match average ${fmt(w.avg)}, highest finish ${w.highFinish || '–'}.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn primary" type="button" data-act="rematch">Play again</button><button class="btn" type="button" data-pg="share">Share</button><button class="btn" type="button" data-act="new">Main menu</button></div>`;
  } else wp.hidden = true;

  // entry
  const human = turn >= 0 && players()[turn].type === 'human';
  const rem = turn >= 0 ? remaining(leg, turn) : 0;
  const ro = $('readout');
  const live = botReveal && botReveal.p === turn ? botReveal : null;
  const liveScore = live ? live.darts.reduce((a, d) => a + d.v, 0) : 0;
  ro.textContent = buffer || (live && live.darts.length ? String(liveScore) : human ? 'Enter score' : S.matchWinner != null ? 'Match over' : 'Bot throwing…');
  ro.classList.toggle('empty', !buffer && !(live && live.darts.length));
  const canCO = human && E.minDarts(rem, st.out) <= 3 && (opened(leg, turn) || OPEN_SETS[st.inRule]?.has(rem));
  // With a finish on, the readout offers a one-tap checkout instead of showing who is throwing
  $('who').innerHTML = canCO && !buffer ? `<button class="chip co rco" type="button" data-score="${rem}">Checkout ${rem}</button>`
    : turn >= 0 ? `<span class="label">To throw</span><br><b>${esc(players()[turn].name)}</b> · ${rem} left` : '';
  const quick = [26, 41, 45, 60, 81, 85, 100, 140, 180];
  $('quick').innerHTML =
    `<button class="chip zero" type="button" data-score="0" ${human ? '' : 'disabled'}>No score</button>` +
    quick.map(q => `<button class="chip" type="button" data-score="${q}" ${human ? '' : 'disabled'}>${q}</button>`).join('');
  $('keys').innerHTML = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'ok'].map(k =>
    `<button class="key ${k === 'ok' ? 'ok' : k === 'del' ? 'fn' : ''}" type="button" data-key="${k}" ${human ? '' : 'disabled'} aria-label="${k === 'del' ? 'Delete digit' : k === 'ok' ? 'Submit score' : k}">${k === 'del' ? '⌫' : k === 'ok' ? 'Score' : k}</button>`).join('');
  $('undoBtn').disabled = !hasHumanVisit() || botBusy;

  // board: current thrower's route, plus the last bot visit's darts
  const botTurn = turn >= 0 && players()[turn].type === 'bot';
  const bc = botTurn ? botCtx(turn) : null;
  const liveRem = rem - liveScore;
  const route = turn >= 0 && liveRem > 1 ? E.bestRoute(live ? liveRem : rem, live ? 3 - live.darts.length : 3, st.out, bc ? { fav: bc.fav, bullShy: bc.bullShy } : null) : null;
  highlight(route);
  const lastVisit = live ? { p: live.p, darts: live.darts, score: liveScore, bust: false, live: true } : lastVisitAnywhere();
  const showDarts = lastVisit && lastVisit.darts && lastVisit.darts.length;
  drawDarts(showDarts ? lastVisit.darts : []);
  $('boardLabel').textContent = route ? `${players()[turn].name} checkout` : turn >= 0 ? `${players()[turn].name} · ${rem} left` : 'Final visit';
  $('boardRoute').innerHTML = route ? routeChips(route) : turn >= 0 ? (!opened(leg, turn) ? `Open on a ${st.inRule === 'master' ? 'double or treble' : 'double'}` : rem > (st.out === 'double' ? 170 : 180) ? 'Scoring – aim T20' : 'No 3-dart finish') : '';
  $('legend').innerHTML = showDarts
    ? `<span>${esc(players()[lastVisit.p].name)}${lastVisit.live ? ' is throwing' : "'s last visit"}:</span> ${lastVisit.darts.map((d, i) => `<span>${i + 1}. <b>${dartLabel(d)}</b></span>`).join('')} <span>= <b>${lastVisit.bust ? 'Bust' : lastVisit.score}</b></span>`
    : `<span>Highlighted segments show the suggested finish.</span>`;

  renderSheet();
  renderStats(stats);
}
function lastVisitAnywhere() {
  for (let i = S.legs.length - 1; i >= 0; i--) { const v = S.legs[i].visits; if (v.length) return v[v.length - 1]; }
  return null;
}
function renderSheet() {
  // Chalker's sheet: per player "Scored | Left", one row per round
  let leg = curLeg(), idx = S.legs.length;
  if (!leg.visits.length && S.legs.length > 1) { leg = S.legs[S.legs.length - 2]; idx--; }
  const pl = players();
  $('sheetTitle').textContent = S.settings.unit === 'sets' ? `Leg ${idx} · set ${(leg.set ?? 0) + 1}` : `Leg ${idx}`;
  if (leg.winner != null) {
    const d = leg.visits.filter(v => v.p === leg.winner).reduce((a, v) => a + v.dartsUsed, 0);
    $('sheetNote').textContent = `${pl[leg.winner].name} won in ${d} darts`;
  } else $('sheetNote').textContent = `${pl[leg.starter].name} threw first`;
  $('sheet').innerHTML = sheetHTML(leg, pl, S.settings.start);
}
function sheetHTML(leg, pl, start) {
  const order = pl.map((_, i) => (leg.starter + i) % pl.length);
  const left = pl.map(() => start);
  const rows = [];
  for (let r = 0; r * pl.length < leg.visits.length; r++) {
    const cells = order.map(p => {
      const v = leg.visits[r * pl.length + order.indexOf(p)];
      if (!v) return `<td class="sc sep"></td><td class="lf"></td>`;
      left[p] -= v.score;
      const cls = v.bust ? ' bust' : v.checkout ? ' out' : '';
      const title = v.darts ? ` title="${v.darts.map(dartLabel).join(', ')}"` : '';
      return `<td class="sc sep${cls}"${title}>${v.bust ? 'Bust' : v.score}</td><td class="lf${cls}">${v.checkout ? '✓' : left[p]}</td>`;
    }).join('');
    rows.push(`<tr><td class="rnd">${(r + 1) * 3}</td>${cells}</tr>`);
  }
  return `<thead><tr><th>Darts</th>${order.map(p => `<th class="sep">${esc(pl[p].name)}</th><th>Left</th>`).join('')}</tr></thead>
    <tbody><tr><td class="rnd">0</td>${order.map(() => `<td class="sc sep"></td><td class="lf">${start}</td>`).join('')}</tr>${rows.join('')}</tbody>`;
}
function renderStats(stats) { $('stats').innerHTML = statsHTML(stats, players()); }
function statsHTML(stats, pl) {
  const rows = [
    ['3-dart average', s => s.avg, v => fmt(v), 'max'],
    ['First 9 average', s => s.f9, v => fmt(v), 'max'],
    ['Checkout %', s => s.coPct, v => v == null ? '–' : fmt(v, 0) + '%', 'max'],
    ['Checkouts', s => s.atDouble ? s.checkouts : null, (v, s) => v == null ? '–' : `${s.checkouts}/${s.atDouble}`, null],
    ['Highest finish', s => s.highFinish || null, v => v ?? '–', 'max'],
    ['Best leg (darts)', s => s.bestLeg, v => v ?? '–', 'min'],
    ['Highest visit', s => s.highVisit || null, v => v ?? '–', 'max'],
    ['100–139', s => s.t100, v => v, 'max'],
    ['140–179', s => s.t140, v => v, 'max'],
    ['180s', s => s.t180, v => v, 'max'],
    ['Darts thrown', s => s.darts, v => v, null],
  ];
  return `<thead><tr><th></th>${pl.map(p => `<th>${esc(p.name)}</th>`).join('')}</tr></thead><tbody>` +
    rows.map(([name, get, show, better]) => {
      const vals = stats.map(get);
      const known = vals.filter(v => v != null && v !== 0);
      const best = better && pl.length > 1 && known.length > 1 ? (better === 'max' ? Math.max(...known) : Math.min(...known)) : null;
      return `<tr><td>${name}</td>${vals.map((v, i) => `<td class="${best != null && v === best ? 'best' : ''}"><span>${show(v, stats[i])}</span></td>`).join('')}</tr>`;
    }).join('') + '</tbody>';
}
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// ---------- messages ----------
let msgTimer;
function err(text) {
  const m = $('msg'); m.textContent = text;
  const ro = $('readout').parentElement; ro.classList.remove('shake'); void ro.offsetWidth; ro.classList.add('shake');
  clearTimeout(msgTimer); msgTimer = setTimeout(() => { m.textContent = ''; }, 4000);
}
let toastTimer;
function toast(text) {
  const t = $('toast'); t.textContent = text; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

// ---------- game flow ----------
function commitVisit(v) {
  const leg = curLeg();
  leg.visits.push(v);
  buffer = '';
  $('msg').textContent = '';
  if (v.checkout || v.score === 180) window.ocheNative?.celebrate();
  if (v.checkout) {
    leg.winner = v.p;
    const darts = leg.visits.filter(x => x.p === v.p).reduce((a, x) => a + x.dartsUsed, 0);
    const sd = standings();
    if (sd.matchWinner >= 0) {
      S.matchWinner = sd.matchWinner;
      recordHistory();
      toast(`Game shot and the match! ${v.score} checkout for ${players()[v.p].name}.`);
    } else {
      const setWon = S.settings.unit === 'sets' && sd.legsInSet === 0;
      S.legs.push({ starter: nextStarter(), visits: [], winner: null, set: sd.setsDone });
      toast(setWon ? `Game shot and the set! Set to ${players()[v.p].name}, ${sd.sets[v.p]}–${Math.max(...sd.sets.filter((_, q) => q !== v.p))} in sets.` : `Game shot! Leg to ${players()[v.p].name} in ${darts} darts.`);
    }
  } else if (v.bust) {
    toast(`${players()[v.p].name}: bust`);
  } else if (v.score === 180) {
    toast('One hundred and eighty!');
  }
  save(); render(); maybeBot();
}
function maybeBot() {
  cancelBot();
  if (S.screen !== 'play') { botBusy = false; return; }
  if (isGame()) return gameBot();
  if (!isBotTurn()) { botBusy = false; return; }
  botBusy = true;
  const token = botToken;
  const leg = curLeg(), p = turnOf(leg), pl = players()[p], ctx = botCtx(p);
  const rem = remaining(leg, p), out = S.settings.out;
  // After an undo, the bot repeats the visit it already threw from this exact spot
  const kept = (S.replay || [])[0];
  let r;
  if (kept && kept.p === p && kept.leg === S.legs.length - 1 && kept.before === rem) {
    S.replay.shift();
    r = { score: kept.score, dartsUsed: kept.dartsUsed, dartsAtDouble: kept.dartsAtDouble, bust: kept.bust, checkout: kept.checkout, darts: kept.darts || [] };
  } else {
    S.replay = [];
    // Pressure: an opponent is on a finish, or checking out here wins the match
    const oppOn = players().some((_, q) => q !== p && E.minDarts(remaining(leg, q), out) <= 3);
    const matchDart = E.minDarts(rem, out) <= 3 && legWinsMatch(p);
    ctx.pressure = oppOn || matchDart ? E.pressureFor(ctx.avg) : 1;
    r = E.simulateVisit(rem, out, E.profileFor(botAvg(pl)), ctx, { inRule: S.settings.inRule, opened: opened(leg, p) });
  }
  // Throw the darts one at a time, at a real player's pace, with a longer settle before a double
  botReveal = { p, darts: [] };
  render();
  let t = 700 + Math.random() * 300, left = rem;
  r.darts.forEach(d => {
    if (out !== 'single' && E.BY[d.aim] && E.isFinisher(E.BY[d.aim], out) && E.BY[d.aim].v === left) t += 400 + Math.random() * 400;
    setTimeout(() => { if (token !== botToken) return; botReveal.darts.push(d); render(); }, t);
    left -= d.v;
    t += 750 + Math.random() * 450;
  });
  botTimer = setTimeout(() => {
    if (token !== botToken) return;
    botReveal = null; botBusy = false;
    if (!isBotTurn()) return;
    commitVisit({ p, score: r.score, dartsUsed: r.dartsUsed, dartsAtDouble: r.dartsAtDouble, bust: r.bust, checkout: r.checkout, before: rem, darts: r.darts });
  }, t - 300);
}
function hasHumanVisit() { return S.legs.some(l => l.visits.some(v => players()[v.p].type === 'human')); }
function popOne() {
  let leg = curLeg();
  if (!leg.visits.length) { if (S.legs.length === 1) return null; S.legs.pop(); leg = curLeg(); }
  const v = leg.visits.pop();
  if (v) {
    if (S.matchWinner != null) forgetHistory(S.id);
    leg.winner = null; S.matchWinner = null;
  }
  return v;
}
function undo() {
  if (isGame()) return gameUndo();
  if (!hasHumanVisit() || botBusy) return;
  cancelBot();
  // Take back your last visit. Bot visits thrown since are kept (oldest first) and replayed as they
  // were once you've re-entered your score, so undo never makes a bot throw its darts again.
  let v;
  const keep = [];
  do {
    v = popOne();
    if (v && players()[v.p].type === 'bot') keep.unshift({ ...v, leg: S.legs.length - 1 });
  } while (v && players()[v.p].type === 'bot');
  S.replay = keep.concat(S.replay || []);
  buffer = '';
  save(); render(); toast(`Undone: ${v ? (v.bust ? 'bust' : v.score) : 'visit'}`);
  maybeBot();
}

function submit(score) {
  if (isBotTurn() || S.matchWinner != null) return;
  const st = S.settings, leg = curLeg(), p = turnOf(leg), rem = remaining(leg, p), out = st.out, dbl = out !== 'single';
  const finisher = out === 'master' ? 'a double or treble' : 'a double';
  const atLabel = out === 'master' ? 'Darts at a double or treble' : 'Darts at double';
  if (!Number.isInteger(score)) return err('Type a score first.');
  if (!E.validVisit(score)) return err(score > 180 ? 'The most three darts can score is 180.' : `${score} can't be scored with three darts.`);
  if (!opened(leg, p) && !OPEN_SETS[st.inRule].has(score)) return err(`${score} isn't possible when the visit has to open on ${st.inRule === 'master' ? 'a double or treble' : 'a double'}.`);
  const base = { p, before: rem };
  const canAimDouble = dbl && opened(leg, p) && rem <= (out === 'master' ? 60 : 50) && E.minDarts(rem, out) <= 3;
  if (score > rem || (dbl && rem - score === 1)) {
    const finish = atDouble => commitVisit({ ...base, score: 0, dartsUsed: 3, dartsAtDouble: atDouble, bust: true, checkout: false });
    return canAimDouble ? ask('Bust', `How many darts went at ${finisher}?`, [{ key: 'd', label: atLabel, options: [0, 1, 2, 3], def: 1 }], a => finish(a.d)) : finish(0);
  }
  if (score === rem) {
    const md = E.minDarts(rem, out);
    if (md > 3) return err(dbl ? `${rem} can't be checked out on ${finisher} in three darts.` : `${rem} can't be checked out in three darts.`);
    const finish = (used, at) => commitVisit({ ...base, score, dartsUsed: used, dartsAtDouble: dbl ? at : 0, bust: false, checkout: true });
    if (md === 3) return finish(3, 1);
    const qs = [{ key: 'used', label: 'Darts used', options: range(md, 3), def: md }];
    if (dbl) qs.push({ key: 'at', label: atLabel, options: a => range(1, a.used - md + 1), def: 1 });
    return ask(`Checkout ${rem}`, 'How did the finish go?', qs, a => finish(a.used, a.at || 1));
  }
  if (canAimDouble) return ask(`${score} scored`, `${rem} was on. How many darts went at ${finisher}?`, [{ key: 'd', label: atLabel, options: [0, 1, 2, 3], def: 0 }],
    a => commitVisit({ ...base, score, dartsUsed: 3, dartsAtDouble: a.d, bust: false, checkout: false }));
  commitVisit({ ...base, score, dartsUsed: 3, dartsAtDouble: 0, bust: false, checkout: false });
}
const range = (a, b) => Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => a + i);

// ---------- dialogs ----------
let dialogOpen = false;
function ask(title, text, questions, done) {
  const ov = $('overlay');
  const ans = {};
  questions.forEach(q => { ans[q.key] = q.def; });
  const draw = () => {
    ov.innerHTML = `<div class="dialog" role="dialog" aria-modal="true" aria-label="${esc(title)}"><h3>${esc(title)}</h3><p>${esc(text)}</p>
      ${questions.map(q => {
        const opts = typeof q.options === 'function' ? q.options(ans) : q.options;
        if (!opts.includes(ans[q.key])) ans[q.key] = opts[0];
        return `<div class="field"><span class="label">${q.label}</span><div class="opts">${opts.map(o => `<button type="button" class="opt" data-q="${q.key}" data-v="${o}" aria-pressed="${ans[q.key] === o}">${o}</button>`).join('')}</div></div>`;
      }).join('')}
      <div class="actions"><button type="button" class="btn" data-act="cancel">Cancel</button><button type="button" class="btn primary" data-act="ok">Confirm</button></div></div>`;
  };
  draw();
  ov.hidden = false; dialogOpen = true;
  const close = () => { ov.hidden = true; ov.innerHTML = ''; ov.onclick = null; dialogOpen = false; dialogKey = null; };
  ov.onclick = e => {
    const b = e.target.closest('button');
    if (!b) { if (e.target === ov) close(); return; }
    if (b.dataset.q) { ans[b.dataset.q] = +b.dataset.v; draw(); ov.querySelector(`[data-q="${b.dataset.q}"][data-v="${b.dataset.v}"]`)?.focus(); }
    else if (b.dataset.act === 'cancel') close();
    else if (b.dataset.act === 'ok') { close(); done(ans); }
  };
  dialogKey = e => {
    if (e.key === 'Escape') { close(); return true; }
    if (e.key === 'Enter' && !e.target.closest?.('[data-q], [data-act="cancel"]')) { close(); done(ans); return true; }
    return false;
  };
  ov.querySelector('[data-act="ok"]').focus();
}
let dialogKey = null;

// ---------- training games & cricket ----------
function renderGame() {
  const st = S.settings, G = GAMES[st.mode], g = S.game, done = G.done(g);
  // Header: game, any options changed from the default, players
  const changed = (G.options || []).filter(d => g.o && g.o[d.key] !== d.def).map(d => d.choices.find(c => String(c[0]) === String(g.o[d.key]))?.[1]).filter(Boolean);
  $('meta').textContent = [G.title, ...changed, st.players.map(p => p.name).join(' vs ')].join(' · ');
  let res = '';
  if (done) {
    const r = G.result(g, st);
    res = `<section class="panel winner"><h2>${esc(r.headline)}</h2><p style="margin:0 0 12px;color:var(--muted)">${esc(r.detail)}</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn primary" type="button" data-act="rematch">Play again</button><button class="btn" type="button" data-pg="share">Share</button><button class="btn" type="button" data-act="new">Main menu</button></div></section>`;
  }
  const canUndo = S.hist.length > 0 && !botBusy;
  $('gameLeft').innerHTML = G.hud(g, st) + res +
    `<section class="panel gpadwrap">${done ? '' : G.pad(g, st)}<div class="msg" id="gMsg" role="status" aria-live="polite"></div>
      <div class="row-actions"><button class="btn" type="button" data-act="undo"${canUndo ? '' : ' disabled'}>Undo</button><span class="hint">${G.hint} <span class="kb">${G.keys}</span></span></div></section>`;
  $('gameRight').innerHTML = G.log(g, st) + `<section class="panel"><h2>How to play</h2><p class="rules">${G.rules}</p></section>`;
  const b = G.board(g, st);
  highlight(b.keys.map(k => ({ k })));
  drawDarts(b.darts || []);
  $('boardLabel').textContent = b.label;
  $('boardRoute').textContent = b.text;
  $('legend').innerHTML = b.legend || (b.keys.length ? '<span>Highlighted segments show what to aim at.</span>' : '');
}
function gameErr(text) {
  const m = $('gMsg'); if (!m) return;
  m.textContent = text;
  clearTimeout(msgTimer); msgTimer = setTimeout(() => { m.textContent = ''; }, 4000);
}
function gameAct(a, v) {
  const G = GAMES[S.settings.mode];
  if (G.done(S.game) || isBotTurn()) return;
  if (a === 'score') {
    if (v === '' || v == null) return gameErr('Type a score first.');
    const s = +v;
    const problem = G.validate ? G.validate(S.game, s) : (!E.validVisit(s) ? (s > 180 ? 'The most three darts can score is 180.' : `${s} can't be scored with three darts.`) : null);
    if (problem) { buffer = ''; render(); return gameErr(problem); }
  }
  S.hist.push(JSON.stringify(S.game));
  if (S.hist.length > 400) S.hist.shift();
  G.act(S.game, a, v, S.settings);
  buffer = '';
  afterGameChange();
}
function afterGameChange() {
  const G = GAMES[S.settings.mode], g = S.game;
  if (G.done(g) && !g.recorded) {
    g.recorded = true;
    const r = G.result(g, S.settings);
    // A session with nothing played is not worth a History entry or a personal best
    const empty = g.results ? !g.results.length : g.visits ? !g.visits.length : false;
    const rec = r.best != null && r.best > 0 && !empty ? recordBest(g.bk || S.settings.mode, r.best, r.better) : null;
    if (rec) g.pb = { key: g.bk || S.settings.mode, old: rec.old };
    if (!empty) recordHistory();
    toast(rec?.kind === 'beaten' ? `New personal best: ${r.best}` : rec?.kind === 'first' ? `Saved as your personal best: ${r.best}` : r.headline);
  }
  save(); render(); maybeBot();
}
function gameUndo() {
  if (!S.hist.length || botBusy) return;
  cancelBot();
  const before = S.game;
  do { S.game = JSON.parse(S.hist.pop()); } while (S.hist.length && isBotTurn());
  if (before.recorded && !S.game.recorded) {
    forgetHistory(S.id);
    // Take back the personal best this result set
    if (before.pb) { const b = readJSON('oche-bests', {}); if (before.pb.old == null) delete b[before.pb.key]; else b[before.pb.key] = before.pb.old; writeJSON('oche-bests', b); }
  }
  // Bot visits taken back by this undo are kept and replayed with the same darts
  const undone = (before.log || []).slice((S.game.log || []).length).filter(e => players()[e.p]?.type === 'bot' && e.darts);
  S.gameReplay = undone.map(e => ({ p: e.p, round: e.round, darts: e.darts })).concat(S.gameReplay || []);
  buffer = '';
  save(); render(); maybeBot();
}
function gameBot() {
  if (!isBotTurn()) { botBusy = false; return; }
  botBusy = true;
  render();
  botTimer = setTimeout(() => {
    botBusy = false;
    if (!isBotTurn()) return;
    S.hist.push(JSON.stringify(S.game));
    const G = GAMES[S.settings.mode], g = S.game, p = g.turn, ctx = botCtx(p);
    const kept = (S.gameReplay || [])[0];
    const round = S.settings.mode === 'bobs27' ? g.pl[p].r + 1 : g.round;
    if (kept && kept.p === p && kept.round === round && G.replayVisit) {
      S.gameReplay.shift();
      G.replayVisit(g, S.settings, kept.darts);
    } else {
      S.gameReplay = [];
      ctx.pressure = G.pressure && G.pressure(g, p) ? E.pressureFor(ctx.avg) : 1;
      G.botVisit(g, S.settings, botCtx);
    }
    afterGameChange();
  }, 1000);
}

// ---------- main menu ----------
function inProgress() {
  if (!S) return false;
  if (isGame()) return !GAMES[S.settings.mode].done(S.game) && S.hist.length > 0;
  return S.matchWinner == null && S.legs.some(l => l.visits.length);
}
// Asks before throwing away a game in progress
function confirmDialog({ title, text, keep, go, onGo, focusBack }) {
  const ov = $('overlay');
  ov.innerHTML = `<div class="dialog confirm" role="alertdialog" aria-modal="true" aria-labelledby="cfTitle" aria-describedby="cfText">
    <h3 id="cfTitle">${title}</h3>
    <p id="cfText">${text}</p>
    <div class="actions"><button type="button" class="btn" data-act="keep">${keep}</button><button type="button" class="btn danger" data-act="go">${go}</button></div></div>`;
  ov.hidden = false; dialogOpen = true;
  const close = () => { ov.hidden = true; ov.innerHTML = ''; ov.onclick = null; dialogOpen = false; dialogKey = null; focusBack?.()?.focus(); };
  ov.onclick = e => {
    const b = e.target.closest('button');
    if (!b) { if (e.target === ov) close(); return; }
    if (b.dataset.act === 'keep') close();
    if (b.dataset.act === 'go') { close(); onGo(); }
  };
  dialogKey = e => { if (e.key === 'Escape') { close(); return true; } return false; };
  ov.querySelector('[data-act="keep"]').focus();
}
const gameWord = () => S.settings.mode === 'x01' ? 'match' : 'game';
function confirmRestart() {
  if (!inProgress()) return startMatch(S.settings);
  confirmDialog({
    title: `Restart this ${gameWord()}?`,
    text: `The scores so far will be lost. A new ${gameWord()} starts with the same players and settings.`,
    keep: 'Keep playing', go: 'Restart', onGo: () => startMatch(S.settings), focusBack: () => $('rematchBtn'),
  });
}
// Discard from the menu: the settings are kept for next time, the scores go
function confirmDiscard() {
  confirmDialog({
    title: `Discard this ${gameWord()}?`,
    text: 'The game in progress and its scores will be deleted. Personal bests already set are kept.',
    keep: 'Keep it', go: 'Discard', focusBack: () => $('menu').querySelector('[data-act="continue"]'),
    onGo: () => { cancelBot(); botBusy = false; buffer = ''; S = freshMatch(S.settings); S.screen = 'menu'; save(); render(); },
  });
}
function modeTitle(mode) { return mode === 'x01' ? `${S.settings.start || 501}` : GAMES[mode].title; }
// Each game's tile: a glyph that says what the game is about, on a board colour
const HEART = '<svg viewBox="0 0 24 22" aria-hidden="true"><path d="M12 21.2 10.6 20C5.4 15.3 2 12.2 2 8.4 2 5.3 4.4 3 7.5 3c1.7 0 3.4.8 4.5 2.1C13.1 3.8 14.8 3 16.5 3 19.6 3 22 5.3 22 8.4c0 3.8-3.4 6.9-8.6 11.6L12 21.2z" fill="currentColor"/></svg>';
const TILES = {
  x01: ['felt', '501'],
  cricket: ['black', () => markSVG(3)],
  killer: ['red', () => `<span class="hearts">${HEART.repeat(3)}</span>`],
  shanghai: ['black', '<span class="sm">S·D·T</span>'],
  halveit: ['cream', '½'],
  c121: ['green', '121'],
  atc: ['black', '<span class="sm">1→20</span>'],
  bobs27: ['red', '27'],
  doubles: ['green', 'D'],
  singles: ['cream', 'S'],
  score: ['black', '180'],
};
function gameTile(mode, text) {
  const [bg, glyph] = TILES[mode] || ['black', '?'];
  return `<span class="tile tile-${bg}" aria-hidden="true">${text ?? (typeof glyph === 'function' ? glyph() : glyph)}</span>`;
}
// The logo: a small full-colour dartboard
function logoBoard() {
  const R = E.R;
  const pt = (r, a) => { const t = a * Math.PI / 180; return [(r * Math.sin(t)).toFixed(1), (-r * Math.cos(t)).toFixed(1)]; };
  const sector = (r1, r2, a1, a2) => { const [x1, y1] = pt(r2, a1), [x2, y2] = pt(r2, a2), [x3, y3] = pt(r1, a2), [x4, y4] = pt(r1, a1); return `M${x1} ${y1}A${r2} ${r2} 0 0 1 ${x2} ${y2}L${x3} ${y3}A${r1} ${r1} 0 0 0 ${x4} ${y4}Z`; };
  let out = '';
  E.ORDER.forEach((_, i) => {
    const even = i % 2 === 0;
    [[R.outerBull, R.trebleIn, 'S'], [R.trebleIn, R.trebleOut, 'T'], [R.trebleOut, R.doubleIn, 'S'], [R.doubleIn, R.doubleOut, 'D']].forEach(([r1, r2, ring]) => {
      const fill = ring === 'S' ? (even ? '#1b1d1c' : '#e8dcbc') : (even ? '#c6262f' : '#12814a');
      out += `<path d="${sector(r1, r2, i * 18 - 9, i * 18 + 9)}" fill="${fill}"/>`;
    });
  });
  out += `<circle r="${R.outerBull}" fill="#12814a"/><circle r="${R.bull}" fill="#c6262f"/>`;
  return `<svg viewBox="-182 -182 364 364" aria-hidden="true"><circle r="181" fill="#151716"/><circle r="180" fill="none" stroke="rgba(255,255,255,.14)" stroke-width="2"/>${out}</svg>`;
}
const routeChips = route => route.map(s => `<span class="rchip r-${s.ring}">${E.label(s)}</span>`).join('');
function renderMenu() {
  const resume = inProgress()
    ? `<section class="panel resume"><div><span class="label">Game in progress</span><b>${esc(modeTitle(S.settings.mode))} · ${esc(players().map(p => p.name).join(' vs '))}</b></div><div class="resume-btns"><button class="btn ghost" type="button" data-act="discard">Discard</button><button class="btn primary" type="button" data-act="continue">Continue</button></div></section>`
    : '';
  const hero = `<section class="menu-hero"><h2 class="num">Step up to the oche<span>.</span></h2><p>Play friends on this device, or bots set to any average from 20 to 120.</p></section>`;
  $('menu').innerHTML = hero + resume + MENU.map(([group, items]) => `<section class="menu-sec"><h2>${group}</h2><div class="cards">${items.map(([mode, title, desc]) => {
    const [lo, hi] = limitsFor(mode), best = getBest(mode);
    const who = hi === 1 ? 'Solo' : lo === hi ? `${lo} players` : `${lo}–${hi} players`;
    const bots = PLAYER_LIMITS[mode] ? ' · bots' : '';
    return `<button class="gcard" type="button" data-menu="${mode}">${gameTile(mode)}<span class="gname">${title}</span><span class="gdesc">${desc}</span><span class="gmeta"><span>${who}${bots}</span>${best != null ? `<span class="pb">Best ${best}</span>` : ''}</span></button>`;
  }).join('')}</div></section>`).join('');
}
function goScreen(name) {
  cancelBot(); botBusy = false;
  S.screen = name; buffer = ''; histOpen = null;
  save(); render();
  window.scrollTo(0, 0);
}
const goMenu = () => goScreen('menu');
// Placeholder until the screen is built
// ---------- history, stats and sharing ----------
let histOpen = null, statsWho = null; // histOpen: id of the history entry shown in detail
const entryTitle = e => e.mode === 'x01' ? `${e.settings.start || 501}` : GAMES[e.mode]?.title || e.mode;
const playersLine = e => e.settings.players.map(p => esc(p.name) + (p.type === 'bot' ? ` (${botAvg(p)} avg)` : '')).join(' vs ');
function shareIt(text) {
  window.ocheNative?.share({ title: 'Oche Scorer', text }).then(r => { if (r === 'copied') toast('Copied'); });
}
const shareText = (title, headline, extra) => ['Oche', title, headline, extra].filter(Boolean).join(' · ');
const x01Extra = s => `Avg ${fmt(s.avg)}${s.highFinish ? ` · High finish ${s.highFinish}` : ''}`;
// X01 quotes the winner's numbers (first player in a tie), other games their result sentence
function entryShare(e) {
  if (e.mode !== 'x01') return shareText(entryTitle(e), e.headline, e.detail);
  return shareText(entryTitle(e), e.headline, x01Extra(E.stats(e.legs, e.settings.players.length)[Math.max(0, e.winner ?? 0)]));
}
function liveShare() {
  if (isGame()) { const r = GAMES[S.settings.mode].result(S.game, S.settings); return shareText(modeTitle(S.settings.mode), r.headline, r.detail); }
  return shareText(modeTitle('x01'), matchHeadline(), x01Extra(E.stats(S.legs, players().length)[S.matchWinner]));
}
function pageAct(act, v) {
  if (act === 'share') return shareIt(histOpen ? entryShare(historyAll().find(e => String(e.id) === histOpen)) : liveShare());
  if (act === 'open') histOpen = v;
  else if (act === 'back') histOpen = null;
  else if (act === 'who') statsWho = v;
  else if (act in SETTINGS_DEFAULT) setSetting(act, v === 'true' ? true : v === 'false' ? false : v);
  else if (act === 'reset') {
    return confirmDialog({
      title: 'Reset all data?', text: 'This deletes your match history, player stats, personal bests, settings and any game in progress. It can\'t be undone.',
      keep: 'Cancel', go: 'Reset', focusBack: () => document.querySelector('[data-pg="reset"]'),
      onGo: () => {
        for (const k of [STORE_KEY, HISTORY_KEY, SETTINGS_KEY, 'oche-bests']) { try { localStorage.removeItem(k); } catch (e) {} window.ocheNative?.remove(k); }
        SETTINGS = { ...SETTINGS_DEFAULT }; applySettings();
        S = freshMatch(DEFAULT_SETTINGS); S.screen = 'menu'; save(); render(); toast('All data reset');
      },
    });
  }
  else if (act === 'del') {
    const id = histOpen;
    return confirmDialog({
      title: 'Delete this match?', text: 'It is removed from your history and lifetime stats. Personal bests are kept.',
      keep: 'Keep it', go: 'Delete', focusBack: () => document.querySelector('[data-pg="del"]'),
      onGo: () => { forgetHistory(+id); histOpen = null; renderHistory(); },
    });
  }
  render();
  if (act in SETTINGS_DEFAULT) document.querySelector(`[data-pg="${act}"]${act === 'theme' ? `[data-v="${v}"]` : ''}`)?.focus();
  if (act === 'open' || act === 'back') window.scrollTo(0, 0);
}
function dayLabel(d) {
  const days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 864e5);
  return days === 0 ? 'Today' : days === 1 ? 'Yesterday' : d.toLocaleDateString([], { day: 'numeric', month: 'short', ...(days > 300 ? { year: 'numeric' } : {}) });
}
const timeLabel = d => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const emptyPage = (title, text) => `<section class="panel"><h2>${title}</h2><p style="margin:0 0 12px;color:var(--muted)">${text}</p><button class="btn primary" type="button" data-nav="menu">Start a game</button></section>`;
function renderHistory() {
  const all = historyAll(), open = all.find(e => String(e.id) === histOpen);
  if (!all.length) { $('page').innerHTML = emptyPage('Match history', 'Finished matches and games show up here.'); return; }
  if (!open) {
    let day = '';
    $('page').innerHTML = all.map(e => {
      const d = new Date(e.at), lab = dayLabel(d);
      const head = lab !== day ? `<h2 class="hday label">${lab}</h2>` : '';
      day = lab;
      return `${head}<button class="hrow" type="button" data-pg="open" data-v="${esc(e.id)}">${gameTile(e.mode, e.mode === 'x01' ? esc(entryTitle(e)) : undefined)}<span><b>${e.headline.startsWith(entryTitle(e)) ? '' : esc(entryTitle(e)) + ' · '}${esc(e.headline)}</b><span class="hsub">${playersLine(e)}</span></span><span class="when">${timeLabel(d)}</span></button>`;
    }).join('');
    return;
  }
  const d = new Date(open.at), pl = open.settings.players;
  let body = '';
  if (open.mode === 'x01') {
    body = open.legs.map((l, i) => `<section class="panel"><h2>Leg ${i + 1}${l.winner != null ? ` · ${esc(pl[l.winner].name)}` : ''}</h2><div class="sheet-wrap"><table class="sheet">${sheetHTML(l, pl, open.settings.start)}</table></div></section>`).join('')
      + `<section class="panel"><h2>Match stats</h2><div class="sheet-wrap"><table class="stats">${statsHTML(E.stats(open.legs, pl.length), pl)}</table></div></section>`;
  } else body = `<section class="panel"><p style="margin:0">${esc(open.detail || '')}</p></section>`;
  $('page').innerHTML = `<section class="panel"><span class="label">${esc(entryTitle(open))} · ${dayLabel(d)}, ${timeLabel(d)}</span><h2>${esc(open.headline)}</h2><p style="margin:0 0 12px;color:var(--muted)">${playersLine(open)}</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" type="button" data-pg="back">Back</button><button class="btn primary" type="button" data-pg="share">Share</button><button class="btn" type="button" data-pg="del">Delete</button></div></section>` + body;
}
// Lifetime numbers for one human, summed from the raw X01 fields so averages weigh every dart equally
function lifetime(name, all) {
  const t = { m: 0, w: 0, score: 0, darts: 0, f9score: 0, f9darts: 0, atDouble: 0, checkouts: 0, highFinish: 0, bestLeg: null, t100: 0, t140: 0, t180: 0 }, trend = [], games = {};
  for (const e of all.slice().reverse()) {
    const pl = e.settings.players, i = pl.findIndex(p => p.type === 'human' && p.name.trim() === name);
    if (i < 0) continue;
    if (e.mode !== 'x01') { const g = games[e.mode] ||= { n: 0, w: 0, multi: false }; g.n++; if (pl.length > 1) g.multi = true; if (e.winner === i) g.w++; continue; }
    const s = E.stats(e.legs || [], pl.length)[i];
    t.m++; if (e.winner === i) t.w++;
    for (const k of ['score', 'darts', 'f9score', 'f9darts', 'atDouble', 'checkouts', 't100', 't140', 't180']) t[k] += s[k];
    t.highFinish = Math.max(t.highFinish, s.highFinish);
    if (s.bestLeg != null) t.bestLeg = t.bestLeg == null ? s.bestLeg : Math.min(t.bestLeg, s.bestLeg);
    if (s.avg != null) trend.push(s.avg);
  }
  return { t, trend: trend.slice(-10), games };
}
function bestLabel(key) {
  const [mode, ...opts] = key.split(':'), G = GAMES[mode];
  if (!G) return null;
  const v = opts.join(':').split(',').filter(Boolean).map(kv => { const [k, val] = kv.split('='), d = (G.options || []).find(o => o.key === k); return d?.choices.find(c => String(c[0]) === val)?.[1] || val; });
  return [G.title, ...v].join(' · ');
}
function renderStatsPage() {
  const all = historyAll(), count = {};
  for (const e of all) new Set(e.settings.players.filter(p => p.type === 'human').map(p => p.name.trim())).forEach(n => count[n] = (count[n] || 0) + 1);
  const names = Object.keys(count).sort((a, b) => count[b] - count[a]);
  if (!names.length) { $('page').innerHTML = emptyPage('Player stats', 'Play a match and your lifetime stats show up here.'); return; }
  if (!names.includes(statsWho)) statsWho = names[0];
  const { t, trend, games } = lifetime(statsWho, all);
  const row = (a, b) => `<tr><td>${a}</td><td>${b}</td></tr>`, avg = (a, d) => d ? fmt(a / d * 3) : '–';
  const x01 = t.m ? `<section class="panel"><h2>X01</h2><div class="sheet-wrap"><table class="stats"><tbody>` + [
    ['Matches played', t.m], ['Matches won', `${t.w} (${fmt(t.w / t.m * 100, 0)}%)`], ['3-dart average', avg(t.score, t.darts)], ['First 9 average', avg(t.f9score, t.f9darts)],
    ['Checkout %', t.atDouble ? fmt(t.checkouts / t.atDouble * 100) + '%' : '–'], ['Highest finish', t.highFinish || '–'], ['Best leg (darts)', t.bestLeg ?? '–'],
    ['100–139', t.t100], ['140–179', t.t140], ['180s', t.t180], ['Darts thrown', t.darts],
  ].map(([a, b]) => row(a, b)).join('') + `</tbody></table></div></section>` : '';
  const hi = Math.max(...trend, 1), lo = Math.max(0, Math.min(...trend) - 10);
  const tr = trend.length > 1 ? `<section class="panel"><span class="label">3-dart average, last ${trend.length} matches</span><div class="trend" role="img" aria-label="Averages from ${fmt(trend[0])} to ${fmt(trend.at(-1))}">${trend.map(v => `<i style="height:${(v - lo) / (hi - lo || 1) * 90 + 10}%" title="${fmt(v)}"></i>`).join('')}</div><div class="row-actions" style="margin-top:6px"><span class="label">${fmt(trend[0])}</span><span class="label">${fmt(trend.at(-1))}</span></div></section>` : '';
  const gl = Object.entries(games).map(([m, g]) => row(esc(GAMES[m]?.title || m), g.multi ? `${g.n} played · ${g.w} won` : `${g.n} played`)).join('');
  const bests = Object.entries(readJSON('oche-bests', {})).map(([k, v]) => [bestLabel(k), v]).filter(([l]) => l).map(([l, v]) => row(esc(l), v)).join('');
  $('page').innerHTML = `<section class="panel"><span class="label">Player</span><div class="chips" style="margin-top:6px">${names.map(n => `<button class="chip" type="button" data-pg="who" data-v="${esc(n)}" aria-pressed="${n === statsWho}">${esc(n)}</button>`).join('')}</div></section>`
    + x01 + tr
    + (gl ? `<section class="panel"><h2>Other games</h2><div class="sheet-wrap"><table class="stats"><tbody>${gl}</tbody></table></div></section>` : '')
    + (bests ? `<section class="panel"><h2>Personal bests on this device</h2><div class="sheet-wrap"><table class="stats"><tbody>${bests}</tbody></table></div></section>` : '');
}
function renderSettings() {
  const native = !!window.ocheNative?.isNative;
  const row = (label, hint, inner) => `<div class="srow"><div><span class="slabel">${label}</span>${hint ? `<div class="hint">${hint}</div>` : ''}</div><div class="sctl">${inner}</div></div>`;
  const sw = (key, label) => `<button type="button" class="switch" role="switch" aria-checked="${SETTINGS[key]}" aria-label="${label}" data-pg="${key}" data-v="${!SETTINGS[key]}"><span></span></button>`;
  const seg = `<div class="seg" role="group" aria-label="Appearance">${[['system', 'System'], ['light', 'Light'], ['dark', 'Dark']].map(([v, l]) => `<button type="button" class="segb" data-pg="theme" data-v="${v}" aria-pressed="${SETTINGS.theme === v}">${l}</button>`).join('')}</div>`;
  // Both pages ship next to the app, on the web and in the iOS app, and link back to it
  const links = '<a href="privacy.html">Privacy policy</a> · <a href="support.html">Support</a>';
  const bests = Object.keys(readJSON('oche-bests', {})).length, games = historyAll().length;
  $('page').innerHTML = `<section class="panel"><h2>Settings</h2><div class="srows">`
    + row('Appearance', '', seg)
    + (native ? row('Haptics', 'A light tap on every button', sw('haptics', 'Haptics')) : '')
    + row('Keep screen awake during play', 'Stops the screen locking between visits', sw('awake', 'Keep screen awake during play'))
    + `</div></section>
    <section class="panel"><h2>Your data</h2><p style="margin:0 0 12px;color:var(--muted)">Everything is stored only on this device. ${games} ${games === 1 ? 'match' : 'matches'} in history, ${bests} personal ${bests === 1 ? 'best' : 'bests'}.</p>
      <button class="btn danger" type="button" data-pg="reset">Reset all data</button></section>
    <section class="panel"><h2>About</h2><p style="margin:0 0 4px"><b>Oche Scorer</b> <span class="hint">version ${APP_VERSION.startsWith('__') ? 'development' : esc(APP_VERSION)}</span></p>
      <p style="margin:0 0 12px;color:var(--muted)">Darts scoring and training, kept on your device.</p>
      ${links ? `<p style="margin:0 0 12px">${links}</p>` : ''}
      ${APP_STORE_ID ? `<a class="btn" href="https://apps.apple.com/app/id${APP_STORE_ID}?action=write-review" target="_blank" rel="noopener">Rate Oche Scorer</a>` : ''}</section>`;
}

// ---------- setup ----------
const isDefaultName = name => /^(Bot|Player)( \d+)?$/.test(name);
function openSetup(mode) {
  const G = GAMES[mode];
  const [lo, hi] = limitsFor(mode);
  const st = normX01({ ...clone(DEFAULT_SETTINGS), ...clone(S.settings), mode });
  st.opts = st.opts || {};
  let list = st.players.map(p => ({ name: p.name, type: p.type === 'bot' ? 'bot' : 'human', avg: botAvg(p) }));
  list[0].type = 'human';
  if (list.length > hi) list = list.slice(0, hi);
  while (list.length < lo) list.push({ name: 'Bot', type: 'bot', avg: 50 });
  const ov = $('overlay');
  const title = mode === 'x01' ? 'X01' : G.title;
  const desc = MENU.flatMap(([, items]) => items).find(([m]) => m === mode)?.[2] || '';
  const coText = a => `~${Math.round(E.profileFor(a).co)}% checkout`;
  const renumber = () => {
    // Give duplicate default names a number: Bot, Bot 2, Bot 3…
    const seen = {};
    list.forEach(p => {
      if (!isDefaultName(p.name)) return;
      const base = p.type === 'bot' ? 'Bot' : 'Player';
      seen[base] = (seen[base] || 0) + 1;
      p.name = seen[base] === 1 && base === 'Bot' ? 'Bot' : `${base} ${base === 'Player' ? list.indexOf(p) + 1 : seen[base]}`;
    });
  };

  // ---- controls: one line per setting ----
  // Two on/off choices become a switch; short choice lists a segmented control; long ones a dropdown.
  const attrs = (scope, key) => `data-set="o" data-scope="${scope}" data-key="${key}"`;
  const control = (label, key, choices, cur, scope) => {
    const vals = choices.map(c => String(c[0]));
    if (choices.length === 2 && ((vals.includes('on') && vals.includes('off')) || (vals.includes('true') && vals.includes('false')))) {
      const on = String(cur) === 'on' || String(cur) === 'true';
      const next = vals.includes('on') ? (on ? 'off' : 'on') : String(!on);
      return `<button type="button" class="switch" role="switch" aria-checked="${on}" aria-label="${esc(label)}" ${attrs(scope, key)} data-v="${next}"><span></span></button>`;
    }
    const long = choices.length > 4 || choices.reduce((a, c) => a + String(c[1]).length, 0) > 28;
    if (long) return `<select id="sel-${key}" ${attrs(scope, key)}>${choices.map(([v, l]) => `<option value="${v}" ${String(cur) === String(v) ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
    return `<div class="seg" role="group" aria-label="${esc(label)}">${choices.map(([v, l]) => `<button type="button" class="segb" ${attrs(scope, key)} data-v="${v}" aria-pressed="${String(cur) === String(v)}">${l}</button>`).join('')}</div>`;
  };
  const row = (label, inner, forId = '') => `<div class="srow">${forId ? `<label class="slabel" for="${forId}">${label}</label>` : `<span class="slabel">${label}</span>`}<div class="sctl">${inner}</div></div>`;
  const stepper = (key, value, unit) => `<span class="stepper"><button type="button" data-set="step" data-key="${key}" data-v="-1" aria-label="Fewer">−</button><output class="num" aria-live="polite">${value}</output><button type="button" data-set="step" data-key="${key}" data-v="1" aria-label="More">+</button></span>${unit ? `<span class="unit">${unit}</span>` : ''}`;

  const x01HTML = () => {
    const custom = ![301, 501, 701].includes(st.start);
    const unitWord = (c, u) => `${u}${c > 1 ? 's' : ''}`;
    return row('Start score', control('Start score', 'startPick', [[301, '301'], [501, '501'], [701, '701'], ['custom', 'Custom']], custom ? 'custom' : st.start, 'x01'))
      + (custom ? row('Custom score', `<input type="number" id="startIn" min="2" max="9999" step="1" value="${st.start}">`, 'startIn') : '')
      + row('In', control('In', 'inRule', [['straight', 'Straight'], ['double', 'Double'], ['master', 'Master']], st.inRule, 'x01'))
      + row('Out', control('Out', 'out', [['single', 'Straight'], ['double', 'Double'], ['master', 'Master']], st.out, 'x01'))
      + row('Match', `<span class="sentence"><select ${attrs('x01', 'kind')} aria-label="Match format"><option value="firstTo" ${st.kind === 'firstTo' ? 'selected' : ''}>First to</option><option value="bestOf" ${st.kind === 'bestOf' ? 'selected' : ''}>Best of</option></select>${stepper('count', st.count, '')}<select ${attrs('x01', 'unit')} aria-label="Legs or sets"><option value="legs" ${st.unit === 'legs' ? 'selected' : ''}>${unitWord(st.count, 'leg')}</option><option value="sets" ${st.unit === 'sets' ? 'selected' : ''}>${unitWord(st.count, 'set')}</option></select></span>`)
      + (st.unit === 'sets' ? row('Each set', `<span class="sentence"><span class="unit">first to</span>${stepper('setLegs', st.setLegs, unitWord(st.setLegs, 'leg'))}</span>`) : '')
      + row('Two clear legs', control('Two clear legs', 'twoClear', [[false, 'Off'], [true, 'On']], st.twoClear, 'x01'))
      + row('Throws first', control('Throws first', 'first', [['p1', 'Player 1'], ['random', 'Random']], st.first, 'x01'));
  };
  const gameHTML = () => (G?.options || []).map(d => { const c = control(d.label, d.key, d.choices, st.opts[mode]?.[d.key] ?? d.def, 'game'); return row(d.label, c, c.startsWith('<select') ? `sel-${d.key}` : ''); }).join('');

  const playerHTML = (p, i) => `<div class="prow${p.type === 'bot' ? ' isbot' : ''}">
      <div class="prow-top">
        <input type="text" id="pn${i}" maxlength="16" value="${esc(p.name)}" aria-label="Player ${i + 1} name">
        ${i > 0 ? `<div class="seg small" role="group" aria-label="Player ${i + 1} type">${[['human', 'Human'], ['bot', 'Bot']].map(([v, l]) => `<button type="button" class="segb" data-set="ptype" data-i="${i}" data-v="${v}" aria-pressed="${p.type === v}">${l}</button>`).join('')}</div>` : ''}
        ${i > 0 && list.length > lo ? `<button type="button" class="xbtn" data-set="premove" data-i="${i}" aria-label="Remove ${esc(p.name)}">✕</button>` : ''}
      </div>
      ${p.type === 'bot' ? `<div class="avgrow"><label class="unit" for="pa${i}">Avg</label><input type="range" id="pa${i}" data-i="${i}" min="${E.AVG_MIN}" max="${E.AVG_MAX}" step="1" value="${p.avg}"><b class="num avgval">${p.avg}</b><span class="hint co">${coText(p.avg)}</span></div>` : ''}
    </div>`;

  const draw = () => {
    const x01 = mode === 'x01';
    const rules = x01 ? x01HTML() : gameHTML();
    const howto = !x01 ? `<details class="howto"><summary>How to play</summary><p class="rules">${G.rules}</p></details>` : '';
    ov.innerHTML = `<form class="dialog setup" id="setupForm" novalidate role="dialog" aria-modal="true" aria-label="${esc(title)} setup">
      <header class="setup-head">${gameTile(mode)}<div><h3>${esc(title)}</h3><p>${esc(desc)}</p></div></header>
      <div class="setup-body">
        ${rules || howto ? `<section class="setup-col"><h4 class="label">Rules</h4><div class="srows">${rules}</div>${howto}</section>` : ''}
        <section class="setup-col"><h4 class="label">${hi === 1 ? 'Player' : `Players · ${lo === hi ? lo : `${lo}–${hi}`}`}</h4>
          <div class="plist">${list.map(playerHTML).join('')}</div>
          ${list.length < hi ? `<div class="addrow"><button type="button" class="addb" data-set="padd" data-v="bot">+ Bot</button><button type="button" class="addb" data-set="padd" data-v="human">+ Player</button></div>` : ''}
        </section>
      </div>
      <footer class="setup-foot"><button type="button" class="btn" data-act="cancel">Cancel</button><button type="submit" class="btn primary go">Start ${esc(title)}</button></footer></form>`;
  };
  const sync = () => {
    if (!$('setupForm')) return;
    if ($('startIn')) { const v = Math.round(+$('startIn').value); st.start = Number.isFinite(v) && $('startIn').value !== '' ? Math.min(9999, Math.max(2, v)) : 501; }
    list.forEach((p, i) => {
      const nm = $('pn' + i); if (nm) p.name = nm.value.trim() || (i === 0 ? 'You' : p.type === 'bot' ? 'Bot' : `Player ${i + 1}`);
      const av = $('pa' + i); if (av) p.avg = +av.value;
    });
  };
  const applyOpt = (scope, key, v) => {
    const val = v === 'true' ? true : v === 'false' ? false : /^-?\d+$/.test(v) ? +v : v;
    if (scope === 'game') st.opts[mode] = { ...(st.opts[mode] || {}), [key]: val };
    else if (key === 'startPick') st.start = val === 'custom' ? ([301, 501, 701].includes(st.start) ? 1001 : st.start) : val;
    else if (key === 'kind' && val !== st.kind) { st.count = val === 'bestOf' ? Math.min(21, 2 * st.count - 1) : Math.floor(st.count / 2) + 1; st.kind = val; }
    else st[key] = val;
  };
  const redraw = focusSel => {
    const body = ov.querySelector('.setup-body'), top = body ? body.scrollTop : 0;
    draw();
    const nb = ov.querySelector('.setup-body'); if (nb) nb.scrollTop = top;
    (focusSel && ov.querySelector(focusSel) || ov.querySelector('[type=submit]'))?.focus();
  };
  draw();
  ov.hidden = false; dialogOpen = true;
  const close = () => { ov.hidden = true; ov.innerHTML = ''; ov.onclick = ov.oninput = ov.onsubmit = ov.onchange = null; dialogOpen = false; dialogKey = null; };
  ov.onclick = e => {
    const b = e.target.closest('button');
    if (!b) { if (e.target === ov) close(); return; }
    if (!b.dataset.set) { if (b.dataset.act === 'cancel') close(); return; }
    sync();
    const v = b.dataset.v, i = +b.dataset.i, set = b.dataset.set, key = b.dataset.key;
    if (set === 'o') applyOpt(b.dataset.scope, key, v);
    if (set === 'step') {
      const d = +v;
      if (key === 'count') st.count = st.kind === 'bestOf' ? Math.max(1, Math.min(21, st.count + 2 * d)) : Math.max(1, Math.min(15, st.count + d));
      if (key === 'setLegs') st.setLegs = Math.max(1, Math.min(6, st.setLegs + d));
    }
    if (set === 'ptype') { list[i].type = v; if (isDefaultName(list[i].name)) list[i].name = v === 'bot' ? 'Bot' : 'Player'; renumber(); }
    if (set === 'premove') { list.splice(i, 1); renumber(); }
    if (set === 'padd') { list.push({ name: v === 'bot' ? 'Bot' : 'Player', type: v, avg: 50 }); renumber(); }
    redraw(set === 'o' ? `[data-key="${key}"]${b.classList.contains('switch') ? '' : `[data-v="${v}"]`}` : set === 'step' ? `[data-set="step"][data-key="${key}"][data-v="${v}"]` : set === 'ptype' ? `[data-set="ptype"][data-i="${i}"][data-v="${v}"]` : null);
  };
  ov.onchange = e => {
    const t = e.target;
    if (t.tagName !== 'SELECT' || t.dataset.set !== 'o') return;
    sync();
    applyOpt(t.dataset.scope, t.dataset.key, t.value);
    redraw(`select[data-key="${t.dataset.key}"]`);
  };
  ov.oninput = e => {
    if (!e.target.id.startsWith('pa')) return;
    const i = +e.target.dataset.i, a = +e.target.value;
    list[i].avg = a;
    const r = e.target.closest('.avgrow');
    r.querySelector('.avgval').textContent = a;
    r.querySelector('.co').textContent = coText(a);
  };
  ov.onsubmit = e => {
    e.preventDefault(); sync();
    st.players = list.map(p => p.type === 'bot' ? { name: p.name, type: 'bot', avg: p.avg } : { name: p.name, type: 'human' });
    close();
    if (!inProgress()) return startMatch(st);
    confirmDialog({ title: `Replace the ${gameWord()} in progress?`, text: 'The scores so far will be lost.', keep: 'Keep it', go: 'Start new', onGo: () => startMatch(st) });
  };
  dialogKey = e => { if (e.key === 'Escape') { close(); return true; } return false; };
  ov.querySelector('[type=submit]').focus();
}
function startMatch(settings) {
  cancelBot(); botBusy = false;
  S = freshMatch(settings); buffer = '';
  save(); render(); maybeBot();
}

// ---------- input ----------
function press(k) {
  if (isGame()) {
    const G = GAMES[S.settings.mode];
    if (!G.keypad || G.done(S.game) || isBotTurn()) return;
    // Score with nothing typed counts as no score
    if (k === 'ok') return gameAct('score', buffer === '' ? '0' : buffer);
  } else if (isBotTurn() || S.matchWinner != null) return;
  if (k === 'del') buffer = buffer.slice(0, -1);
  // Score with nothing typed counts as no score
  else if (k === 'ok') return submit(buffer === '' ? 0 : +buffer);
  else if (/^\d$/.test(k)) { if (buffer.length < 3) buffer = (buffer === '0' ? '' : buffer) + k; }
  render();
}
document.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b || b.disabled || b.closest('#overlay')) return;
  if (b.dataset.key) press(b.dataset.key);
  else if (b.dataset.ga) gameAct(b.dataset.ga, b.dataset.v);
  else if (b.dataset.act === 'undo') undo();
  else if (b.dataset.score != null) { buffer = ''; submit(+b.dataset.score); }
  else if (b.dataset.act === 'rematch') startMatch(S.settings);
  else if (b.dataset.act === 'new') goMenu();
  else if (b.dataset.pg) pageAct(b.dataset.pg, b.dataset.v);
  else if (b.dataset.nav) goScreen(b.dataset.nav);
  else if (b.dataset.menu) openSetup(b.dataset.menu);
  else if (b.dataset.act === 'discard') confirmDiscard();
  else if (b.dataset.act === 'continue') { S.screen = 'play'; save(); render(); maybeBot(); }
});
document.addEventListener('keydown', e => {
  if (dialogOpen) { if (dialogKey && dialogKey(e)) e.preventDefault(); return; }
  if (S.screen !== 'play') return;
  if (e.target.matches('input, select, textarea')) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (isGame() && !GAMES[S.settings.mode].keypad) {
    const b = document.querySelector(`#gameLeft [data-hot="${CSS.escape(e.key.toLowerCase())}"]:not(:disabled)`);
    if (b) { b.click(); e.preventDefault(); }
    return;
  }
  if (/^\d$/.test(e.key)) { press(e.key); e.preventDefault(); }
  else if (e.key === 'Backspace') { press('del'); e.preventDefault(); }
  else if (e.key === 'Enter' && !e.target.closest('button')) { press('ok'); e.preventDefault(); }
});
$('undoBtn').addEventListener('click', undo);
$('menuBtn').addEventListener('click', goMenu);
$('brand').addEventListener('click', () => { if (S.screen !== 'menu' && !dialogOpen) goMenu(); });
$('logo').innerHTML = logoBoard();
$('rematchBtn').addEventListener('click', confirmRestart);

// ---------- boot ----------
function start(data) {
  SETTINGS = { ...SETTINGS_DEFAULT, ...readJSON(SETTINGS_KEY, {}) };
  applySettings();
  buildBoard();
  const saved = (data && data.S) || load();
  try {
    S = saved || freshMatch(DEFAULT_SETTINGS);
    S.settings.mode = S.settings.mode || 'x01';
    if (S.settings.mode === 'x01') normX01(S.settings);
    S.hist = S.hist || [];
    S.id = S.id || Date.now();
    if (isGame() && (!GAMES[S.settings.mode] || !S.game)) S = freshMatch(DEFAULT_SETTINGS);
    // First visit opens on the menu; a saved game picks up where it was
    S.screen = saved ? (S.screen || 'play') : 'menu';
    render();
  } catch (e) {
    // A save this version can't show (damaged, or from an older format): start clean rather than stay blank
    // The stored game is kept: the fault may be in this version, not the save
    S = freshMatch(DEFAULT_SETTINGS); S.screen = 'menu';
    render();
  }
  maybeBot();
}
window.claude?.hot?.snapshot?.(() => ({ S }));
const boot = () => window.claude?.hot?.ready ? window.claude.hot.ready(start) : start(window.claude?.hot?.data ?? {});
// In the iOS app, wait for saved games to come back from native storage first
window.ocheReady ? window.ocheReady.then(boot, boot) : boot();
