// ===== App =====
const $ = id => document.getElementById(id);
// APP_STORE_ID is filled in once the app exists in App Store Connect (it turns on the rate button)
// let: the browser test stands in an older version on one phone
let APP_VERSION = '__APP_VERSION__';
const APP_STORE_ID = '';
// The website: join links from the iOS and Android apps point here, so a guest's camera opens them in the browser
const SITE_URL = 'https://albertvanhouten.github.io/dartboss/';
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
  const m = { settings: s, legs: [{ starter: first, visits: [], winner: null }], id: Date.now(), matchWinner: null, hist: [], acts: [], screen: 'play', bots: {}, firstThrower: first };
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
// Whose turn it is now; -1 once the match or game is over
const currentTurn = () => isGame() ? (GAMES[S.settings.mode].done(S.game) ? -1 : S.game.turn) : S.matchWinner != null ? -1 : turnOf(curLeg());
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
function standings(m = S) {
  const st = m.settings, N = st.players.length;
  const sets = Array(N).fill(0), total = Array(N).fill(0);
  let setLegs = Array(N).fill(0), setsDone = 0;
  for (const leg of m.legs) {
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
  const sets = st.unit === 'sets', one = st.count === 1;
  const head = st.kind === 'bestOf' ? t(sets ? 'Best of {n} sets' : 'Best of {n} legs', { n: st.count })
    : t(sets ? (one ? 'First to {n} set' : 'First to {n} sets') : one ? 'First to {n} leg' : 'First to {n} legs', { n: st.count });
  return head + (sets ? ' ' + t(st.setLegs > 1 ? '(first to {n} legs)' : '(first to {n} leg)', { n: st.setLegs }) : '') + (st.twoClear ? t(', two clear') : '');
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
  // A guest shows the host's match and keeps its own saved game untouched; the host sends each change to the room
  if (ROOM?.role === 'guest') return;
  if (ROOM?.role === 'host' && S.room) broadcastState();
  // Undo snapshots stay in memory; saving all of them outgrows the browser's storage on long games
  const json = JSON.stringify({ ...S, hist: (S.hist || []).slice(-10), acts: isGame() ? (S.acts || []).slice(-10) : S.acts });
  try { localStorage.setItem(STORE_KEY, json); } catch (e) { toast(t('Could not save: device storage is full')); }
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
const SETTINGS_DEFAULT = { theme: 'system', lang: 'system', haptics: true, awake: true, caller: true };
let SETTINGS = { ...SETTINGS_DEFAULT };
function setSetting(key, value) { SETTINGS[key] = value; writeJSON(SETTINGS_KEY, SETTINGS); applySettings(); }
function applySettings() {
  if (SETTINGS.theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = SETTINGS.theme;
  const sys = (navigator.language || 'en').slice(0, 2).toLowerCase();
  LANG = SETTINGS.lang in LANGS ? SETTINGS.lang : sys in LANGS ? sys : 'en';
  document.documentElement.lang = LANG;
  localizeStatic();
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
function matchHeadline(m = S) {
  const st = m.settings, sd = standings(m), tally = st.unit === 'sets' ? sd.sets : sd.total, w = m.matchWinner;
  const rest = Math.max(0, ...st.players.map((_, p) => p).filter(p => p !== w).map(q => tally[q]));
  return t(st.unit === 'sets' ? 'Match to {name}, {score} in sets' : 'Match to {name}, {score}', { name: st.players[w].name, score: `${tally[w]}–${rest}` });
}
// History words results in the current language, from the saved game; the stored text is the fallback
function entryResult(e) {
  try { return e.mode === 'x01' ? { headline: matchHeadline({ settings: e.settings, legs: e.legs, matchWinner: e.winner }) } : GAMES[e.mode].result(e.game, e.settings); }
  catch (err) { return e; }
}
// Static markup in body.html: data-t marks text, data-ta an attribute; the English original is the key
function localizeStatic() {
  for (const el of document.querySelectorAll('[data-t]')) el.innerHTML = t(el.dataset.t ||= el.innerHTML);
  for (const el of document.querySelectorAll('[data-ta]')) el.setAttribute(el.dataset.ta, t(el.dataset.tk ||= el.getAttribute(el.dataset.ta)));
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
      ? `<circle cx="${d.x}" cy="${-d.y}" r="7" fill="none" stroke="#ffffff" stroke-width="2" stroke-dasharray="3 2"/><title>${t('Bounce-out')}</title>`
      : `<circle cx="${d.x}" cy="${-d.y}" r="7" fill="#ffffff" stroke="#111" stroke-width="2"/><text x="${d.x}" y="${-d.y}" font-size="9" font-weight="700" text-anchor="middle" dominant-baseline="central" fill="#111" font-family="Barlow, sans-serif">${i + 1}</text>`;
    g.appendChild(grp);
  });
  drawnDarts = darts.slice();
}
const dartLabel = d => d.bounce ? t('Bounce-out') : E.label(E.BY[d.k]);
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
  join: ['Join a game', () => renderJoin()],
};
function render() {
  const scr = S.screen, menu = scr === 'menu', page = PAGES[scr];
  $('menu').hidden = !menu;
  $('page').hidden = !page;
  $('play').hidden = scr !== 'play';
  $('tabs').hidden = scr === 'play';
  for (const b of $('tabs').querySelectorAll('[data-nav]')) b.setAttribute('aria-current', b.dataset.nav === scr ? 'page' : 'false');
  $('menuBtn').hidden = scr !== 'play';
  // A guest plays the host's match: only the host restarts it
  $('rematchBtn').hidden = scr !== 'play' || isGuest();
  window.ocheNative?.keepAwake?.(scr === 'play' && SETTINGS.awake);
  if (menu) { $('meta').textContent = t('Pick a game'); return renderMenu(); }
  if (page) { $('meta').textContent = t(page[0]); return page[1](); }
  const game = isGame();
  $('x01Left').hidden = $('x01Right').hidden = game;
  $('gameLeft').hidden = $('gameRight').hidden = !game;
  renderRoomBar();
  if (game) return renderGame();
  const st = S.settings, leg = curLeg(), turn = S.matchWinner == null ? turnOf(leg) : -1;
  const sd = standings();
  const where = S.matchWinner != null ? t('Match over') : st.unit === 'sets' ? t('Set {s}, leg {l}', { s: sd.setsDone + 1, l: sd.legsInSet + 1 }) : t('Leg {n}', { n: S.legs.length });
  $('meta').textContent = `${st.start} · ${st.inRule !== 'straight' ? t('{rule} in', { rule: RULE_NAME[st.inRule] }) + ' · ' : ''}${t('{rule} out', { rule: RULE_NAME[st.out === 'single' ? 'straight' : st.out] })} · ${formatText(st)} · ${where}`;
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
    const pips = (st.unit === 'sets' ? `<span class="setnum" title="${t('Sets won')}">${sd.sets[p]}</span>` : '') +
      (legNeed <= 9 ? Array.from({ length: legNeed }, (_, i) => `<span class="pip${i < sd.legs[p] ? ' on' : ''}"></span>`).join('') : `<span class="setnum" title="${t('Legs won')}">${sd.legs[p]}</span>`);
    const tag = pl.type === 'bot' ? ` <span class="label" title="${t('Favourite double {d}', { d: 'D' + botCtx(p).fav })}">${t('{avg} avg', { avg: botAvg(pl) })} · D${botCtx(p).fav}</span>` : '';
    const status = p === turn && pl.type === 'bot' ? `<span class="thinking">${t('Throwing')}</span>` : '';
    // Only a seat a phone has claimed has a dot: the others are scored on the host
    const dot = ROOM?.role === 'host' && roomOf().seats[p] ? connDot(p) : '';
    return `<article class="player${p === turn ? ' active' : ''}" aria-current="${p === turn}">
      <div class="head"><span class="name">${dot}${esc(pl.name)}${tag}</span><span class="pips" title="${st.unit === 'sets' ? t('Sets {s}, legs this set {l}', { s: sd.sets[p], l: sd.legs[p] }) : t('Legs won: {n}', { n: sd.legs[p] })}">${pips}</span></div>
      <div class="rem num">${esc(rem)}</div>
      <div class="route">${route ? routeChips(route) : !opened(leg, p) ? t(st.inRule === 'master' ? 'Open on a double or treble' : 'Open on a double') : status}</div>
      <div class="sub"><span>${t('Avg')} <b>${fmt(stats[p].avg)}</b></span><span>${t('Last')} <b>${last ? (last.bust ? t('Bust') : esc(last.score)) : '–'}</b></span><span>${t('Darts')} <b>${esc(legDarts)}</b></span></div>
    </article>`;
  }).join('');

  // winner
  const wp = $('winnerPanel');
  if (S.matchWinner != null) {
    const w = stats[S.matchWinner];
    wp.hidden = false;
    wp.className = 'panel winner';
    wp.innerHTML = `<h2>${esc(matchHeadline())}</h2>
      <p style="margin:0 0 12px;color:var(--muted)">${t('Match average {avg}, highest finish {hf}.', { avg: fmt(w.avg), hf: w.highFinish || '–' })}</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap">${endButtons()}</div>`;
  } else wp.hidden = true;

  // entry
  // A guest phone enters only its own players' visits; the others show who it is waiting for
  const human = turn >= 0 && players()[turn].type === 'human', waiting = human && !myTurn(), can = human && !waiting;
  const rem = turn >= 0 ? remaining(leg, turn) : 0;
  const ro = $('readout');
  const live = botReveal && botReveal.p === turn ? botReveal : null;
  const liveScore = live ? live.darts.reduce((a, d) => a + d.v, 0) : 0;
  ro.textContent = buffer || (live && live.darts.length ? String(liveScore) : (waiting ? t('Waiting for {name}…', { name: players()[turn].name }) : t(human ? 'Enter score' : S.matchWinner != null ? 'Match over' : 'Bot throwing…')));
  ro.closest('.entry').classList.toggle('waiting', waiting);
  ro.classList.toggle('empty', !buffer && !(live && live.darts.length));
  const canCO = can && E.minDarts(rem, st.out) <= 3 && (opened(leg, turn) || OPEN_SETS[st.inRule]?.has(rem));
  // With a finish on, the readout offers a one-tap checkout instead of showing who is throwing
  $('who').innerHTML = canCO && !buffer ? `<button class="chip co rco" type="button" data-score="${rem}">${t('Checkout {n}', { n: rem })}</button>`
    : turn >= 0 ? `<span class="label">${t('To throw')}</span><br><b>${esc(players()[turn].name)}</b> · ${t('{n} left', { n: rem })}` : '';
  const quick = [26, 41, 45, 60, 81, 85, 100, 140, 180];
  $('quick').innerHTML =
    `<button class="chip zero" type="button" data-score="0" ${can ? '' : 'disabled'}>${t('No score')}</button>` +
    quick.map(q => `<button class="chip" type="button" data-score="${q}" ${can ? '' : 'disabled'}>${q}</button>`).join('');
  $('keys').innerHTML = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'ok'].map(k =>
    `<button class="key ${k === 'ok' ? 'ok' : k === 'del' ? 'fn' : ''}" type="button" data-key="${k}" ${can ? '' : 'disabled'} aria-label="${k === 'del' ? t('Delete digit') : k === 'ok' ? t('Submit score') : k}">${k === 'del' ? '⌫' : k === 'ok' ? t('Score') : k}</button>`).join('');
  $('undoBtn').disabled = isGuest() ? !guestCanUndo() : !hasHumanVisit() || botBusy;

  // board: current thrower's route, plus the last bot visit's darts
  const botTurn = turn >= 0 && players()[turn].type === 'bot';
  const bc = botTurn ? botCtx(turn) : null;
  const liveRem = rem - liveScore;
  const route = turn >= 0 && liveRem > 1 ? E.bestRoute(live ? liveRem : rem, live ? 3 - live.darts.length : 3, st.out, bc ? { fav: bc.fav, bullShy: bc.bullShy } : null) : null;
  highlight(route);
  const lastVisit = live ? { p: live.p, darts: live.darts, score: liveScore, bust: false, live: true } : lastVisitAnywhere();
  const showDarts = lastVisit && lastVisit.darts && lastVisit.darts.length;
  drawDarts(showDarts ? lastVisit.darts : []);
  $('boardLabel').textContent = route ? t('{name} checkout', { name: players()[turn].name }) : turn >= 0 ? `${players()[turn].name} · ${t('{n} left', { n: rem })}` : t('Final visit');
  $('boardRoute').innerHTML = route ? routeChips(route) : turn >= 0 ? t(!opened(leg, turn) ? (st.inRule === 'master' ? 'Open on a double or treble' : 'Open on a double') : rem > (st.out === 'double' ? 170 : 180) ? 'Scoring – aim T20' : 'No 3-dart finish') : '';
  $('legend').innerHTML = showDarts
    ? `<span>${t(lastVisit.live ? '{name} is throwing:' : "{name}'s last visit:", { name: esc(players()[lastVisit.p].name) })}</span> ${lastVisit.darts.map((d, i) => `<span>${i + 1}. <b>${esc(dartLabel(d))}</b></span>`).join('')} <span>= <b>${lastVisit.bust ? t('Bust') : esc(lastVisit.score)}</b></span>`
    : `<span>${t('Highlighted segments show the suggested finish.')}</span>`;

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
  $('sheetTitle').textContent = S.settings.unit === 'sets' ? t('Leg {n} · set {s}', { n: idx, s: (leg.set ?? 0) + 1 }) : t('Leg {n}', { n: idx });
  if (leg.winner != null) {
    const d = leg.visits.filter(v => v.p === leg.winner).reduce((a, v) => a + v.dartsUsed, 0);
    $('sheetNote').textContent = t('{name} won in {n} darts', { name: pl[leg.winner].name, n: d });
  } else $('sheetNote').textContent = t('{name} threw first', { name: pl[leg.starter].name });
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
      const title = v.darts ? ` title="${esc(v.darts.map(dartLabel).join(', '))}"` : '';
      return `<td class="sc sep${cls}"${title}>${v.bust ? t('Bust') : esc(v.score)}</td><td class="lf${cls}">${v.checkout ? '✓' : esc(left[p])}</td>`;
    }).join('');
    rows.push(`<tr><td class="rnd">${(r + 1) * 3}</td>${cells}</tr>`);
  }
  return `<thead><tr><th>${t('Darts')}</th>${order.map(p => `<th class="sep">${esc(pl[p].name)}</th><th>${t('Left')}</th>`).join('')}</tr></thead>
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
      return `<tr><td>${t(name)}</td>${vals.map((v, i) => `<td class="${best != null && v === best ? 'best' : ''}"><span>${show(v, stats[i])}</span></td>`).join('')}</tr>`;
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

// ---------- caller ----------
// Pre-recorded X01 calls in caller/ (a designed voice, see docs/caller.md). Web Audio, unlocked by the
// first tap or key, so bot visits that land later are called too. Missing files (the artifact preview) stay quiet.
const caller = (() => {
  let ctx = null, chain = Promise.resolve(), at = 0;
  const bufs = {};
  const load = name => bufs[name] || (bufs[name] = fetch(`caller/${name}.mp3`)
    .then(r => r.ok ? r.arrayBuffer() : Promise.reject(r.status)).then(b => ctx.decodeAudioData(b))
    .catch(e => { delete bufs[name]; throw e; }));
  return {
    unlock() {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!ctx && AC) ctx = new AC();
      if (ctx?.state === 'suspended') ctx.resume();
    },
    say(...names) {
      if (!SETTINGS.caller || !ctx) return;
      const loads = names.map(load);
      // One after another, in order, even when a later file loads first
      chain = chain.then(async () => {
        for (const p of loads) {
          try {
            const buf = await p, src = ctx.createBufferSource();
            src.buffer = buf; src.connect(ctx.destination);
            const t = Math.max(ctx.currentTime, at);
            src.start(t); at = t + buf.duration + 0.15;
          } catch (e) {}
        }
      });
    },
  };
})();
// What the caller says after a visit: the score (or bust, or game shot), then what the next player needs
function callVisit(v) {
  if (v.checkout) return caller.say('gameshot');
  const said = v.bust ? 'bust' : v.score === 0 ? 'noscore' : String(v.score);
  const leg = curLeg(), next = turnOf(leg), rem = remaining(leg, next), out = S.settings.out;
  // Requirement calls exist for every double-out finish from 2 to 170
  const onFinish = opened(leg, next) && rem >= 2 && rem <= 170 && E.minDarts(rem, 'double') <= 3 && E.minDarts(rem, out) <= 3;
  caller.say(...(onFinish ? [said, `req-${rem}`] : [said]));
}
['click', 'keydown'].forEach(t => document.addEventListener(t, () => caller.unlock(), true));

// ---------- game flow ----------
// ver: the room version the visit was started on (a guest sends it with the visit); remote: a guest's visit, on the host
function commitVisit(v, ver, remote = false) {
  if (ROOM?.role === 'guest') { buffer = ''; return guestInput({ type: 'visit', seat: v.p, visit: v }, ver); }
  const leg = curLeg();
  leg.visits.push(v);
  if (remote) remoteDone(v.p);
  else { buffer = ''; $('msg').textContent = ''; }
  if (v.checkout || v.score === 180) window.ocheNative?.celebrate();
  if (v.checkout) {
    leg.winner = v.p;
    const darts = leg.visits.filter(x => x.p === v.p).reduce((a, x) => a + x.dartsUsed, 0);
    const sd = standings();
    if (sd.matchWinner >= 0) {
      S.matchWinner = sd.matchWinner;
      recordHistory();
      toast(t('Game shot and the match! {n} checkout for {name}.', { n: v.score, name: players()[v.p].name }));
    } else {
      const setWon = S.settings.unit === 'sets' && sd.legsInSet === 0;
      S.legs.push({ starter: nextStarter(), visits: [], winner: null, set: sd.setsDone });
      toast(setWon ? t('Game shot and the set! Set to {name}, {score} in sets.', { name: players()[v.p].name, score: `${sd.sets[v.p]}–${Math.max(...sd.sets.filter((_, q) => q !== v.p))}` }) : t('Game shot! Leg to {name} in {n} darts.', { name: players()[v.p].name, n: darts }));
    }
  } else if (v.bust) {
    toast(t('{name}: bust', { name: players()[v.p].name }));
  } else if (v.score === 180) {
    toast(t('One hundred and eighty!'));
  }
  S.acts.push({ seat: v.p, turnAfter: currentTurn() });
  callVisit(v);
  save(); render(); maybeBot();
}
function maybeBot() {
  cancelBot();
  // Bots play on the host
  if (ROOM?.role === 'guest') { botBusy = false; return; }
  // While a room is open bots throw on any screen of the host, so the guests aren't kept waiting
  if (S.screen !== 'play' && ROOM?.role !== 'host') { botBusy = false; return; }
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
  if (S.screen === 'play') render();
  let t = 700 + Math.random() * 300, left = rem;
  r.darts.forEach(d => {
    if (out !== 'single' && E.BY[d.aim] && E.isFinisher(E.BY[d.aim], out) && E.BY[d.aim].v === left) t += 400 + Math.random() * 400;
    setTimeout(() => { if (token !== botToken) return; botReveal.darts.push(d); if (S.screen === 'play') render(); }, t);
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
// A guest's input leaves what the host is typing alone, unless the turn it was typed for has passed. Then it goes,
// the host is told why, and an empty Score pressed straight after does nothing, so it can't land on the next player.
let lostAt = 0;
function remoteDone(seat) {
  if (currentTurn() === seat) return;
  if (buffer) { toast(t('{name} scored on their phone', { name: players()[seat].name })); lostAt = Date.now(); }
  buffer = ''; $('msg').textContent = '';
}
function hasHumanVisit() { return S.legs.some(l => l.visits.some(v => players()[v.p].type === 'human')); }
function popOne() {
  let leg = curLeg();
  if (!leg.visits.length) { if (S.legs.length === 1) return null; S.legs.pop(); leg = curLeg(); }
  const v = leg.visits.pop();
  if (v) {
    S.acts.pop();
    if (S.matchWinner != null) forgetHistory(S.id);
    leg.winner = null; S.matchWinner = null;
  }
  return v;
}
function undo() {
  if (ROOM?.role === 'guest') return guestUndo();
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
  save(); render(); toast(t('Undone: {what}', { what: v ? (v.bust ? t('bust') : v.score) : t('visit') }));
  maybeBot();
}

function submit(score) {
  if (isBotTurn() || S.matchWinner != null || !myTurn()) return;
  const st = S.settings, leg = curLeg(), p = turnOf(leg), rem = remaining(leg, p), out = st.out, dbl = out !== 'single';
  const mst = out === 'master', atLabel = t(mst ? 'Darts at a double or treble' : 'Darts at double');
  if (!Number.isInteger(score)) return err(t('Type a score first.'));
  if (!E.validVisit(score)) return err(score > 180 ? t('The most three darts can score is 180.') : t("{n} can't be scored with three darts.", { n: score }));
  if (!opened(leg, p) && !OPEN_SETS[st.inRule].has(score)) return err(t(st.inRule === 'master' ? "{n} isn't possible when the visit has to open on a double or treble." : "{n} isn't possible when the visit has to open on a double.", { n: score }));
  const base = { p, before: rem };
  // A question can stay open while another phone changes the match: the visit only goes in if nothing has
  const id = S.id, legs = S.legs.length, visits = leg.visits.length, ver = ROOM?.ver;
  const commit = v => S.id === id && S.legs.length === legs && curLeg().visits.length === visits && S.matchWinner == null
    ? commitVisit(v, ver) : toast(t('Already scored'));
  const canAimDouble = dbl && opened(leg, p) && rem <= (out === 'master' ? 60 : 50) && E.minDarts(rem, out) <= 3;
  if (score > rem || (dbl && rem - score === 1)) {
    const finish = atDouble => commit({ ...base, score: 0, dartsUsed: 3, dartsAtDouble: atDouble, bust: true, checkout: false });
    return canAimDouble ? ask(t('Bust'), t(mst ? 'How many darts went at a double or treble?' : 'How many darts went at a double?'), [{ key: 'd', label: atLabel, options: [0, 1, 2, 3], def: 1 }], a => finish(a.d)) : finish(0);
  }
  if (score === rem) {
    const md = E.minDarts(rem, out);
    if (md > 3) return err(t(!dbl ? "{n} can't be checked out in three darts." : mst ? "{n} can't be checked out on a double or treble in three darts." : "{n} can't be checked out on a double in three darts.", { n: rem }));
    const finish = (used, at) => commit({ ...base, score, dartsUsed: used, dartsAtDouble: dbl ? at : 0, bust: false, checkout: true });
    if (md === 3) return finish(3, 1);
    const qs = [{ key: 'used', label: t('Darts used'), options: range(md, 3), def: md }];
    if (dbl) qs.push({ key: 'at', label: atLabel, options: a => range(1, a.used - md + 1), def: 1 });
    return ask(t('Checkout {n}', { n: rem }), t('How did the finish go?'), qs, a => finish(a.used, a.at || 1));
  }
  if (canAimDouble) return ask(t('{n} scored', { n: score }), t(mst ? '{n} was on. How many darts went at a double or treble?' : '{n} was on. How many darts went at a double?', { n: rem }), [{ key: 'd', label: atLabel, options: [0, 1, 2, 3], def: 0 }],
    a => commit({ ...base, score, dartsUsed: 3, dartsAtDouble: a.d, bust: false, checkout: false }));
  commit({ ...base, score, dartsUsed: 3, dartsAtDouble: 0, bust: false, checkout: false });
}
const range = (a, b) => Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => a + i);
// A guest's visit for seat p, built again on the host by the rules submit() follows: null if no phone could
// have entered it. The host's own count goes in as `before`, and darts (never sent by submit) are dropped.
function guestVisit(raw, p) {
  if (!raw || typeof raw !== 'object' || raw.p !== p) return null;
  const st = S.settings, leg = curLeg(), rem = remaining(leg, p), out = st.out, dbl = out !== 'single';
  const { score, dartsUsed: used, dartsAtDouble: at, bust, checkout } = raw;
  const int = (x, lo, hi) => Number.isInteger(x) && x >= lo && x <= hi;
  const opens = s => opened(leg, p) || OPEN_SETS[st.inRule].has(s);
  const canAimDouble = dbl && opened(leg, p) && rem <= (out === 'master' ? 60 : 50) && E.minDarts(rem, out) <= 3;
  const busts = s => s > rem || (dbl && rem - s === 1);
  let ok;
  if (bust === true) ok = checkout === false && score === 0 && used === 3 && int(at, 0, canAimDouble ? 3 : 0)
    && range(0, 180).some(s => E.validVisit(s) && opens(s) && busts(s));
  else if (bust !== false) ok = false;
  else if (checkout === true) {
    const md = E.minDarts(rem, out);
    ok = score === rem && E.validVisit(score) && opens(score) && md <= 3 && int(used, md, 3) && (dbl ? int(at, 1, used - md + 1) : at === 0);
  } else ok = checkout === false && E.validVisit(score) && opens(score) && !busts(score) && score !== rem && used === 3 && int(at, 0, canAimDouble ? 3 : 0);
  return ok ? { p, before: rem, score, dartsUsed: used, dartsAtDouble: at, bust, checkout } : null;
}

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
      <div class="actions"><button type="button" class="btn" data-act="cancel">${t('Cancel')}</button><button type="button" class="btn primary" data-act="ok">${t('Confirm')}</button></div></div>`;
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
  const changed = (G.options || []).filter(d => g.o && g.o[d.key] !== d.def).map(d => d.choices.find(c => String(c[0]) === String(g.o[d.key]))?.[1]).filter(Boolean).map(l => t(l));
  $('meta').textContent = [t(G.title), ...changed, st.players.map(p => p.name).join(' vs ')].join(' · ');
  let res = '';
  if (done) {
    const r = G.result(g, st);
    res = `<section class="panel winner"><h2>${esc(r.headline)}</h2><p style="margin:0 0 12px;color:var(--muted)">${esc(r.detail)}</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap">${endButtons()}</div></section>`;
  }
  // A guest has no undo snapshots: its Undo lights when the host would take it
  const undoOk = isGuest() ? guestCanUndo() : S.hist.length > 0 && !botBusy;
  const turn = currentTurn(), waiting = !done && turn >= 0 && players()[turn].type === 'human' && !myTurn();
  const wait = waiting ? `<div class="waitnote" role="status">${t('Waiting for {name}…', { name: esc(players()[turn].name) })}</div>` : '';
  $('gameLeft').innerHTML = G.hud(g, st) + res +
    `<section class="panel gpadwrap${waiting ? ' waiting' : ''}">${done ? '' : wait + G.pad(g, st)}<div class="msg" id="gMsg" role="status" aria-live="polite"></div>
      <div class="row-actions"><button class="btn" type="button" data-act="undo"${undoOk ? '' : ' disabled'}>${t('Undo')}</button><span class="hint">${t(G.hint)} <span class="kb">${t(G.keys)}</span></span></div></section>`;
  if (waiting) $('gameLeft').querySelectorAll('.gpadwrap button:not([data-act])').forEach(b => { b.disabled = true; });
  $('gameRight').innerHTML = G.log(g, st) + `<section class="panel"><h2>${t('How to play')}</h2><p class="rules">${t(G.rules)}</p></section>`;
  const b = G.board(g, st);
  highlight(b.keys.map(k => ({ k })));
  drawDarts(b.darts || []);
  $('boardLabel').textContent = b.label;
  $('boardRoute').textContent = b.text;
  $('legend').innerHTML = b.legend || (b.keys.length ? `<span>${t('Highlighted segments show what to aim at.')}</span>` : '');
}
function gameErr(text) {
  const m = $('gMsg'); if (!m) return;
  m.textContent = text;
  clearTimeout(msgTimer); msgTimer = setTimeout(() => { m.textContent = ''; }, 4000);
}
function gameAct(a, v, remote = false) {
  const G = GAMES[S.settings.mode];
  if (G.done(S.game) || isBotTurn() || !myTurn()) return;
  if (a === 'score') {
    if (v === '' || v == null) return gameErr(t('Type a score first.'));
    const s = +v;
    const problem = G.validate ? G.validate(S.game, s) : (!E.validVisit(s) ? (s > 180 ? t('The most three darts can score is 180.') : t("{n} can't be scored with three darts.", { n: s })) : null);
    if (problem) { buffer = ''; render(); return gameErr(problem); }
  }
  if (ROOM?.role === 'guest') { buffer = ''; render(); return guestInput({ type: 'act', seat: S.game.turn, a, v }); }
  S.hist.push(JSON.stringify(S.game));
  if (S.hist.length > 400) { S.hist.shift(); S.acts.shift(); }
  const seat = S.game.turn;
  G.act(S.game, a, v, S.settings);
  S.acts.push({ seat, turnAfter: currentTurn() });
  if (remote) remoteDone(seat); else buffer = '';
  afterGameChange();
}
// Is this a move the game's pad offers right now (or, on a keypad, a score it takes)? The host checks a guest's act by it.
function padOffers(a, v) {
  const G = GAMES[S.settings.mode];
  if (a === 'score' && G.keypad && /^\d{1,3}$/.test(String(v))) return !(G.validate ? G.validate(S.game, +v) : !E.validVisit(+v));
  // A template's content is inert: nothing in it loads or runs
  const pad = document.createElement('template');
  pad.innerHTML = G.pad(S.game, S.settings);
  return [...pad.content.querySelectorAll('[data-ga]:not([disabled])')].some(b => b.dataset.ga === a && b.dataset.v === String(v));
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
    toast(rec?.kind === 'beaten' ? t('New personal best: {n}', { n: r.best }) : rec?.kind === 'first' ? t('Saved as your personal best: {n}', { n: r.best }) : r.headline);
  }
  save(); render(); maybeBot();
}
function gameUndo() {
  if (ROOM?.role === 'guest') return guestUndo();
  if (!S.hist.length || botBusy) return;
  cancelBot();
  const before = S.game;
  do { S.game = JSON.parse(S.hist.pop()); S.acts.pop(); } while (S.hist.length && isBotTurn());
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
  if (S.screen === 'play') render();
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
    S.acts.push({ seat: p, turnAfter: currentTurn() });
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
const isMatch = () => S.settings.mode === 'x01';
function confirmRestart() {
  if (!inProgress()) return startMatch(S.settings);
  confirmDialog({
    title: t(isMatch() ? 'Restart this match?' : 'Restart this game?'),
    text: t(isMatch() ? 'The scores so far will be lost. A new match starts with the same players and settings.' : 'The scores so far will be lost. A new game starts with the same players and settings.'),
    keep: t('Keep playing'), go: t('Restart'), onGo: () => startMatch(S.settings), focusBack: () => $('rematchBtn'),
  });
}
// Discard from the menu: the settings are kept for next time, the scores go
function confirmDiscard() {
  if (isGuest()) return confirmLeave();
  confirmDialog({
    title: t(isMatch() ? 'Discard this match?' : 'Discard this game?'),
    text: t('The game in progress and its scores will be deleted. Personal bests already set are kept.'),
    keep: t('Keep it'), go: t('Discard'), focusBack: () => $('menu').querySelector('[data-act="continue"]'),
    // Discarding the match ends its room
    onGo: () => { endRoom(); cancelBot(); botBusy = false; buffer = ''; S = freshMatch(S.settings); S.screen = 'menu'; save(); render(); },
  });
}
// A guest's menu works on its own game: starting one, joining another room or Leave first leaves the room
function confirmLeave(then) {
  confirmDialog({
    title: t('Leave the room?'), text: t('This phone stops playing in the shared game. The host keeps the match.'),
    keep: t('Stay'), go: t('Leave'), focusBack: () => $('menu').querySelector('[data-act="continue"]'),
    onGo: () => { leaveRoom(); goMenu(); then?.(); },
  });
}
function modeTitle(mode) { return mode === 'x01' ? `${S.settings.start || 501}` : t(GAMES[mode].title); }
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
  join: ['felt', '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="2" width="11" height="20" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="18.2" r="1.3" fill="currentColor"/></svg>'],
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
  // A guest's menu always leads back to the shared game, and offers Leave where the host has Discard
  const resume = isGuest() || inProgress()
    ? `<section class="panel resume"><div><span class="label">${t('Game in progress')}</span><b>${esc(modeTitle(S.settings.mode))} · ${esc(players().map(p => p.name).join(' vs '))}</b></div><div class="resume-btns"><button class="btn ghost" type="button" data-act="discard">${t(isGuest() ? 'Leave' : 'Discard')}</button><button class="btn primary" type="button" data-act="continue">${t('Continue')}</button></div></section>`
    : '';
  const hero = `<section class="menu-hero"><h2 class="num">${t('Step up to the oche')}<span>.</span></h2><p>${t('Play friends on this device, or bots set to any average from 20 to 120.')}</p></section>`;
  // Joining another phone's game sits with the matches
  const join = `<button class="gcard" type="button" data-menu="join">${gameTile('join')}<span class="gname">${t('Join a game')}</span><span class="gdesc">${t('Score on your own phone in a game another phone is hosting.')}</span><span class="gmeta"><span>${t('Room code or QR code')}</span></span></button>`;
  $('menu').innerHTML = hero + resume + MENU.map(([group, items], gi) => `<section class="menu-sec"><h2>${t(group)}</h2><div class="cards">${items.map(([mode, title, desc]) => {
    const [lo, hi] = limitsFor(mode), best = getBest(mode);
    const who = hi === 1 ? t('Solo') : t('{n} players', { n: lo === hi ? lo : `${lo}–${hi}` });
    const bots = PLAYER_LIMITS[mode] ? ' · ' + t('bots') : '';
    return `<button class="gcard" type="button" data-menu="${mode}">${gameTile(mode)}<span class="gname">${t(title)}</span><span class="gdesc">${t(desc)}</span><span class="gmeta"><span>${who}${bots}</span>${best != null ? `<span class="pb">${t('Best {n}', { n: best })}</span>` : ''}</span></button>`;
  }).join('')}${gi === 0 ? join : ''}</div></section>`).join('');
}
function goScreen(name) {
  if (ROOM?.role !== 'host') { cancelBot(); botBusy = false; }
  S.screen = name; buffer = ''; histOpen = null;
  save(); render();
  window.scrollTo(0, 0);
}
const goMenu = () => goScreen('menu');
// Placeholder until the screen is built
// ---------- history, stats and sharing ----------
let histOpen = null, statsWho = null; // histOpen: id of the history entry shown in detail
const entryTitle = e => e.mode === 'x01' ? `${e.settings.start || 501}` : GAMES[e.mode] ? t(GAMES[e.mode].title) : e.mode;
const playersLine = e => e.settings.players.map(p => esc(p.name) + (p.type === 'bot' ? ` (${t('{avg} avg', { avg: botAvg(p) })})` : '')).join(' vs ');
function shareIt(text) {
  window.ocheNative?.share({ title: 'Dartboss', text }).then(r => { if (r === 'copied') toast(t('Copied')); });
}
const shareText = (title, headline, extra) => ['Dartboss', title, headline, extra].filter(Boolean).join(' · ');
const x01Extra = s => `${t('Avg')} ${fmt(s.avg)}${s.highFinish ? ` · ${t('High finish')} ${s.highFinish}` : ''}`;
// X01 quotes the winner's numbers (first player in a tie), other games their result sentence
function entryShare(e) {
  const r = entryResult(e);
  if (e.mode !== 'x01') return shareText(entryTitle(e), r.headline, r.detail);
  return shareText(entryTitle(e), r.headline, x01Extra(E.stats(e.legs, e.settings.players.length)[Math.max(0, e.winner ?? 0)]));
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
      title: t('Reset all data?'), text: t("This deletes your match history, player stats, personal bests, settings and any game in progress. It can't be undone."),
      keep: t('Cancel'), go: t('Reset'), focusBack: () => document.querySelector('[data-pg="reset"]'),
      onGo: () => {
        if (isGuest()) leaveRoom(); else endRoom();
        for (const k of [STORE_KEY, HISTORY_KEY, SETTINGS_KEY, 'oche-bests', ROOM_KEY]) { try { localStorage.removeItem(k); } catch (e) {} window.ocheNative?.remove(k); }
        SETTINGS = { ...SETTINGS_DEFAULT }; applySettings();
        S = freshMatch(DEFAULT_SETTINGS); S.screen = 'menu'; save(); render(); toast(t('All data reset'));
      },
    });
  }
  else if (act === 'del') {
    const id = histOpen;
    return confirmDialog({
      title: t('Delete this match?'), text: t('It is removed from your history and lifetime stats. Personal bests are kept.'),
      keep: t('Keep it'), go: t('Delete'), focusBack: () => document.querySelector('[data-pg="del"]'),
      onGo: () => { forgetHistory(+id); histOpen = null; renderHistory(); },
    });
  }
  render();
  if (act in SETTINGS_DEFAULT) document.querySelector(`[data-pg="${act}"]${typeof SETTINGS_DEFAULT[act] === 'string' ? `[data-v="${v}"]` : ''}`)?.focus();
  if (act === 'open' || act === 'back') window.scrollTo(0, 0);
}
function dayLabel(d) {
  const days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 864e5);
  return days === 0 ? t('Today') : days === 1 ? t('Yesterday') : d.toLocaleDateString(LANG, { day: 'numeric', month: 'short', ...(days > 300 ? { year: 'numeric' } : {}) });
}
const timeLabel = d => d.toLocaleTimeString(LANG, { hour: '2-digit', minute: '2-digit' });
const emptyPage = (title, text) => `<section class="panel"><h2>${title}</h2><p style="margin:0 0 12px;color:var(--muted)">${text}</p><button class="btn primary" type="button" data-nav="menu">${t('Start a game')}</button></section>`;
function renderHistory() {
  const all = historyAll(), open = all.find(e => String(e.id) === histOpen);
  if (!all.length) { $('page').innerHTML = emptyPage(t('Match history'), t('Finished matches and games show up here.')); return; }
  if (!open) {
    let day = '';
    $('page').innerHTML = all.map(e => {
      const d = new Date(e.at), lab = dayLabel(d);
      const head = lab !== day ? `<h2 class="hday label">${lab}</h2>` : '';
      day = lab;
      const hl = entryResult(e).headline;
      return `${head}<button class="hrow" type="button" data-pg="open" data-v="${esc(e.id)}">${gameTile(e.mode, e.mode === 'x01' ? esc(entryTitle(e)) : undefined)}<span><b>${hl.startsWith(entryTitle(e)) ? '' : esc(entryTitle(e)) + ' · '}${esc(hl)}</b><span class="hsub">${playersLine(e)}</span></span><span class="when">${timeLabel(d)}</span></button>`;
    }).join('');
    return;
  }
  const d = new Date(open.at), pl = open.settings.players, res = entryResult(open);
  let body = '';
  if (open.mode === 'x01') {
    body = open.legs.map((l, i) => `<section class="panel"><h2>${t('Leg {n}', { n: i + 1 })}${l.winner != null ? ` · ${esc(pl[l.winner].name)}` : ''}</h2><div class="sheet-wrap"><table class="sheet">${sheetHTML(l, pl, open.settings.start)}</table></div></section>`).join('')
      + `<section class="panel"><h2>${t('Match stats')}</h2><div class="sheet-wrap"><table class="stats">${statsHTML(E.stats(open.legs, pl.length), pl)}</table></div></section>`;
  } else body = `<section class="panel"><p style="margin:0">${esc(res.detail || '')}</p></section>`;
  $('page').innerHTML = `<section class="panel"><span class="label">${esc(entryTitle(open))} · ${dayLabel(d)}, ${timeLabel(d)}</span><h2>${esc(res.headline)}</h2><p style="margin:0 0 12px;color:var(--muted)">${playersLine(open)}</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" type="button" data-pg="back">${t('Back')}</button><button class="btn primary" type="button" data-pg="share">${t('Share')}</button><button class="btn" type="button" data-pg="del">${t('Delete')}</button></div></section>` + body;
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
  const v = opts.join(':').split(',').filter(Boolean).map(kv => { const [k, val] = kv.split('='), d = (G.options || []).find(o => o.key === k); const l = d?.choices.find(c => String(c[0]) === val)?.[1]; return l ? t(l) : val; });
  return [t(G.title), ...v].join(' · ');
}
function renderStatsPage() {
  const all = historyAll(), count = {};
  for (const e of all) new Set(e.settings.players.filter(p => p.type === 'human').map(p => p.name.trim())).forEach(n => count[n] = (count[n] || 0) + 1);
  const names = Object.keys(count).sort((a, b) => count[b] - count[a]);
  if (!names.length) { $('page').innerHTML = emptyPage(t('Player stats'), t('Play a match and your lifetime stats show up here.')); return; }
  if (!names.includes(statsWho)) statsWho = names[0];
  const { t: tot, trend, games } = lifetime(statsWho, all);
  const row = (a, b) => `<tr><td>${a}</td><td>${b}</td></tr>`, avg = (a, d) => d ? fmt(a / d * 3) : '–';
  const x01 = tot.m ? `<section class="panel"><h2>X01</h2><div class="sheet-wrap"><table class="stats"><tbody>` + [
    ['Matches played', tot.m], ['Matches won', `${tot.w} (${fmt(tot.w / tot.m * 100, 0)}%)`], ['3-dart average', avg(tot.score, tot.darts)], ['First 9 average', avg(tot.f9score, tot.f9darts)],
    ['Checkout %', tot.atDouble ? fmt(tot.checkouts / tot.atDouble * 100) + '%' : '–'], ['Highest finish', tot.highFinish || '–'], ['Best leg (darts)', tot.bestLeg ?? '–'],
    ['100–139', tot.t100], ['140–179', tot.t140], ['180s', tot.t180], ['Darts thrown', tot.darts],
  ].map(([a, b]) => row(t(a), b)).join('') + `</tbody></table></div></section>` : '';
  const hi = Math.max(...trend, 1), lo = Math.max(0, Math.min(...trend) - 10);
  const tr = trend.length > 1 ? `<section class="panel"><span class="label">${t('3-dart average, last {n} matches', { n: trend.length })}</span><div class="trend" role="img" aria-label="${t('Averages from {a} to {b}', { a: fmt(trend[0]), b: fmt(trend.at(-1)) })}">${trend.map(v => `<i style="height:${(v - lo) / (hi - lo || 1) * 90 + 10}%" title="${fmt(v)}"></i>`).join('')}</div><div class="row-actions" style="margin-top:6px"><span class="label">${fmt(trend[0])}</span><span class="label">${fmt(trend.at(-1))}</span></div></section>` : '';
  const gl = Object.entries(games).map(([m, g]) => row(esc(GAMES[m] ? t(GAMES[m].title) : m), g.multi ? t('{n} played · {w} won', { n: g.n, w: g.w }) : t('{n} played', { n: g.n }))).join('');
  const bests = Object.entries(readJSON('oche-bests', {})).map(([k, v]) => [bestLabel(k), v]).filter(([l]) => l).map(([l, v]) => row(esc(l), v)).join('');
  $('page').innerHTML = `<section class="panel"><span class="label">${t('Player')}</span><div class="chips" style="margin-top:6px">${names.map(n => `<button class="chip" type="button" data-pg="who" data-v="${esc(n)}" aria-pressed="${n === statsWho}">${esc(n)}</button>`).join('')}</div></section>`
    + x01 + tr
    + (gl ? `<section class="panel"><h2>${t('Other games')}</h2><div class="sheet-wrap"><table class="stats"><tbody>${gl}</tbody></table></div></section>` : '')
    + (bests ? `<section class="panel"><h2>${t('Personal bests on this device')}</h2><div class="sheet-wrap"><table class="stats"><tbody>${bests}</tbody></table></div></section>` : '');
}
function renderSettings() {
  const native = !!window.ocheNative?.isNative;
  const row = (label, hint, inner) => `<div class="srow"><div><span class="slabel">${label}</span>${hint ? `<div class="hint">${hint}</div>` : ''}</div><div class="sctl">${inner}</div></div>`;
  const sw = (key, label) => `<button type="button" class="switch" role="switch" aria-checked="${SETTINGS[key]}" aria-label="${label}" data-pg="${key}" data-v="${!SETTINGS[key]}"><span></span></button>`;
  const seg = (key, label, choices) => `<div class="seg" role="group" aria-label="${label}">${choices.map(([v, l]) => `<button type="button" class="segb" data-pg="${key}" data-v="${v}" aria-pressed="${SETTINGS[key] === v}">${l}</button>`).join('')}</div>`;
  // Both pages ship next to the app, on the web and in the iOS app, and link back to it
  const links = `<a href="privacy.html">${t('Privacy policy')}</a> · <a href="support.html">${t('Support')}</a>`;
  const bests = Object.keys(readJSON('oche-bests', {})).length, games = historyAll().length;
  $('page').innerHTML = `<section class="panel"><h2>${t('Settings')}</h2><div class="srows">`
    + row(t('Appearance'), '', seg('theme', t('Appearance'), [['system', t('System')], ['light', t('Light')], ['dark', t('Dark')]]))
    // A dropdown, not a segmented control: four or more language names don't fit beside each other on a phone
    + row(t('Language'), '', `<select data-pg="lang" aria-label="${t('Language')}">${[['system', t('System')], ...Object.entries(LANGS)].map(([v, l]) => `<option value="${v}"${SETTINGS.lang === v ? ' selected' : ''}>${l}</option>`).join('')}</select>`)
    + (native ? row(t('Haptics'), t('A light tap on every button'), sw('haptics', t('Haptics'))) : '')
    + row(t('Caller'), t('Calls out scores and finishes in X01'), sw('caller', t('Caller')))
    + row(t('Keep screen awake during play'), t('Stops the screen locking between visits'), sw('awake', t('Keep screen awake during play')))
    + `</div></section>
    <section class="panel"><h2>${t('Your data')}</h2><p style="margin:0 0 12px;color:var(--muted)">${t('Everything is stored only on this device.')} ${t(games === 1 ? '{n} match in history' : '{n} matches in history', { n: games })}, ${t(bests === 1 ? '{n} personal best' : '{n} personal bests', { n: bests })}.</p>
      <button class="btn danger" type="button" data-pg="reset">${t('Reset all data')}</button></section>
    <section class="panel"><h2>${t('About')}</h2><p style="margin:0 0 4px"><b>Dartboss</b> <span class="hint">${t('version {v}', { v: APP_VERSION.startsWith('__') ? t('development') : esc(APP_VERSION) })}</span></p>
      <p style="margin:0 0 12px;color:var(--muted)">${t('Darts scoring and training, kept on your device.')}</p>
      ${links ? `<p style="margin:0 0 12px">${links}</p>` : ''}
      ${APP_STORE_ID ? `<a class="btn" href="https://apps.apple.com/app/id${APP_STORE_ID}?action=write-review" target="_blank" rel="noopener">${t('Rate Dartboss')}</a>` : ''}</section>`;
}

// ---------- setup ----------
// Default names in any language, so setup renames them when the language changes
const defaultWords = key => [key, ...Object.values(STRINGS).map(s => s[key])];
const isDefaultName = name => ['Bot', ...defaultWords('Player')].includes(name.replace(/ \d+$/, ''));
function openSetup(mode) {
  const G = GAMES[mode];
  const [lo, hi] = limitsFor(mode);
  const st = normX01({ ...clone(DEFAULT_SETTINGS), ...clone(S.settings), mode });
  st.opts = st.opts || {};
  let list = st.players.map(p => ({ name: p.name, type: p.type === 'bot' ? 'bot' : 'human', avg: botAvg(p) }));
  list[0].type = 'human';
  if (list.length > hi) list = list.slice(0, hi);
  while (list.length < lo) list.push({ name: 'Bot', type: 'bot', avg: 50 });
  if (defaultWords('You').includes(list[0].name)) list[0].name = t('You');
  const ov = $('overlay');
  const title = mode === 'x01' ? 'X01' : t(G.title);
  const desc = t(MENU.flatMap(([, items]) => items).find(([m]) => m === mode)?.[2] || '');
  const coText = a => t('~{n}% checkout', { n: Math.round(E.profileFor(a).co) });
  const renumber = () => {
    // Give duplicate default names a number: Bot, Bot 2, Bot 3…
    const seen = {};
    list.forEach(p => {
      if (!isDefaultName(p.name)) return;
      const base = p.type === 'bot' ? 'Bot' : t('Player');
      seen[base] = (seen[base] || 0) + 1;
      p.name = seen[base] === 1 && base === 'Bot' ? 'Bot' : `${base} ${base !== 'Bot' ? list.indexOf(p) + 1 : seen[base]}`;
    });
  };
  renumber();

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
  const stepper = (key, value, unit) => `<span class="stepper"><button type="button" data-set="step" data-key="${key}" data-v="-1" aria-label="${t('Fewer')}">−</button><output class="num" aria-live="polite">${value}</output><button type="button" data-set="step" data-key="${key}" data-v="1" aria-label="${t('More')}">+</button></span>${unit ? `<span class="unit">${unit}</span>` : ''}`;

  const x01HTML = () => {
    const custom = ![301, 501, 701].includes(st.start);
    const unitWord = (c, u) => t(c > 1 ? u + 's' : u);
    return row(t('Start score'), control(t('Start score'), 'startPick', [[301, '301'], [501, '501'], [701, '701'], ['custom', t('Custom')]], custom ? 'custom' : st.start, 'x01'))
      + (custom ? row(t('Custom score'), `<input type="number" inputmode="numeric" id="startIn" min="2" max="9999" step="1" value="${st.start}">`, 'startIn') : '')
      + row('In', control('In', 'inRule', [['straight', 'Straight'], ['double', 'Double'], ['master', 'Master']], st.inRule, 'x01'))
      + row('Out', control('Out', 'out', [['single', 'Straight'], ['double', 'Double'], ['master', 'Master']], st.out, 'x01'))
      + row(t('Match'), `<span class="sentence"><select ${attrs('x01', 'kind')} aria-label="${t('Match format')}"><option value="firstTo" ${st.kind === 'firstTo' ? 'selected' : ''}>${t('First to')}</option><option value="bestOf" ${st.kind === 'bestOf' ? 'selected' : ''}>${t('Best of')}</option></select>${stepper('count', st.count, '')}<select ${attrs('x01', 'unit')} aria-label="${t('Legs or sets')}"><option value="legs" ${st.unit === 'legs' ? 'selected' : ''}>${unitWord(st.count, 'leg')}</option><option value="sets" ${st.unit === 'sets' ? 'selected' : ''}>${unitWord(st.count, 'set')}</option></select></span>`)
      + (st.unit === 'sets' ? row(t('Each set'), `<span class="sentence"><span class="unit">${t('first to')}</span>${stepper('setLegs', st.setLegs, unitWord(st.setLegs, 'leg'))}</span>`) : '')
      + row(t('Two clear legs'), control(t('Two clear legs'), 'twoClear', [[false, t('Off')], [true, t('On')]], st.twoClear, 'x01'))
      + row(t('Throws first'), control(t('Throws first'), 'first', [['p1', t('Player {n}', { n: 1 })], ['random', t('Random')]], st.first, 'x01'));
  };
  const gameHTML = () => (G?.options || []).map(d => { const c = control(t(d.label), d.key, d.choices.map(([v, l]) => [v, t(l)]), st.opts[mode]?.[d.key] ?? d.def, 'game'); return row(t(d.label), c, c.startsWith('<select') ? `sel-${d.key}` : ''); }).join('');

  const playerHTML = (p, i) => `<div class="prow${p.type === 'bot' ? ' isbot' : ''}">
      <div class="prow-top">
        <input type="text" id="pn${i}" maxlength="16" value="${esc(p.name)}" aria-label="${t('Player {n} name', { n: i + 1 })}">
        ${i > 0 ? `<div class="seg small" role="group" aria-label="${t('Player {n} type', { n: i + 1 })}">${[['human', t('Player')], ['bot', 'Bot']].map(([v, l]) => `<button type="button" class="segb" data-set="ptype" data-i="${i}" data-v="${v}" aria-pressed="${p.type === v}">${l}</button>`).join('')}</div>` : ''}
        ${i > 0 && list.length > lo ? `<button type="button" class="xbtn" data-set="premove" data-i="${i}" aria-label="${t('Remove {name}', { name: esc(p.name) })}">✕</button>` : ''}
      </div>
      ${p.type === 'bot' ? `<div class="avgrow"><label class="unit" for="pa${i}">${t('Avg')}</label><input type="range" id="pa${i}" data-i="${i}" min="${E.AVG_MIN}" max="${E.AVG_MAX}" step="1" value="${p.avg}"><b class="num avgval">${p.avg}</b><span class="hint co">${coText(p.avg)}</span></div>` : ''}
    </div>`;

  // Players on their own phones: for any game set up with 2 or more players
  const canShare = () => hi > 1 && list.length >= 2;
  const roomSwitch = () => canShare() ? `<div class="srows share">${row(t('Players on their own phones'), control(t('Players on their own phones'), 'shared', [[false, t('Off')], [true, t('On')]], !!st.shared, 'room'))}</div>
          <p class="hint">${t('Each player scores on their own phone. Others join with a room code or QR code.')}</p>` : '';
  const draw = () => {
    const x01 = mode === 'x01';
    const rules = x01 ? x01HTML() : gameHTML();
    const howto = !x01 ? `<details class="howto"><summary>${t('How to play')}</summary><p class="rules">${t(G.rules)}</p></details>` : '';
    ov.innerHTML = `<form class="dialog setup" id="setupForm" novalidate role="dialog" aria-modal="true" aria-label="${esc(t('{game} setup', { game: title }))}">
      <header class="setup-head">${gameTile(mode)}<div><h3>${esc(title)}</h3><p>${esc(desc)}</p></div></header>
      <div class="setup-body">
        ${rules || howto ? `<section class="setup-col"><h4 class="label">${t('Rules')}</h4><div class="srows">${rules}</div>${howto}</section>` : ''}
        <section class="setup-col"><h4 class="label">${hi === 1 ? t('Player') : t('Players · {n}', { n: lo === hi ? lo : `${lo}–${hi}` })}</h4>
          <div class="plist">${list.map(playerHTML).join('')}</div>
          ${roomSwitch()}
          ${list.length < hi ? `<div class="addrow"><button type="button" class="addb" data-set="padd" data-v="bot">+ Bot</button><button type="button" class="addb" data-set="padd" data-v="human">+ ${t('Player')}</button></div>` : ''}
        </section>
      </div>
      <footer class="setup-foot"><button type="button" class="btn" data-act="cancel">${t('Cancel')}</button><button type="submit" class="btn primary go">${esc(t('Start {game}', { game: title }))}</button></footer></form>`;
  };
  const sync = () => {
    if (!$('setupForm')) return;
    if ($('startIn')) { const v = Math.round(+$('startIn').value); st.start = Number.isFinite(v) && $('startIn').value !== '' ? Math.min(9999, Math.max(2, v)) : 501; }
    list.forEach((p, i) => {
      const nm = $('pn' + i); if (nm) p.name = nm.value.trim() || (i === 0 ? t('You') : p.type === 'bot' ? 'Bot' : t('Player {n}', { n: i + 1 }));
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
    if (set === 'ptype') { list[i].type = v; if (isDefaultName(list[i].name)) list[i].name = v === 'bot' ? 'Bot' : t('Player'); renumber(); }
    if (set === 'premove') { list.splice(i, 1); renumber(); }
    if (set === 'padd') { list.push({ name: v === 'bot' ? 'Bot' : t('Player'), type: v, avg: 50 }); renumber(); }
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
    st.shared = canShare() && !!st.shared;
    close();
    if (!inProgress()) return startMatch(st);
    confirmDialog({ title: t(isMatch() ? 'Replace the match in progress?' : 'Replace the game in progress?'), text: t('The scores so far will be lost.'), keep: t('Keep it'), go: t('Start new'), onGo: () => startMatch(st) });
  };
  dialogKey = e => { if (e.key === 'Escape') { close(); return true; } return false; };
  ov.querySelector('[type=submit]').focus();
}
// A new match with players on their own phones (a rematch, Restart, or a new setup) stays in the room, and guests
// keep the seats that still fit; one without them ends the room
function startMatch(settings) {
  cancelBot(); botBusy = false;
  const room = S?.room, keep = ROOM?.role === 'host' && room && settings.shared;
  if (ROOM?.role === 'host' && !keep) endRoom();
  S = freshMatch(settings); buffer = '';
  if (keep) S.room = recheckSeats(room, players());
  save(); render(); maybeBot();
  if (settings.shared && !keep && !isGuest()) openRoom();
}
// The result's buttons: only the host starts a rematch, a guest can leave
const endButtons = () => (isGuest() ? `<button class="btn primary" type="button" data-act="leave">${t('Leave')}</button>`
  : `<button class="btn primary" type="button" data-act="rematch">${t('Play again')}</button>`)
  + `<button class="btn" type="button" data-pg="share">${t('Share')}</button>${isGuest() ? '' : `<button class="btn" type="button" data-act="new">${t('Main menu')}</button>`}`;

// ---------- rooms: lobby, seats, join ----------
const isGuest = () => ROOM?.role === 'guest';
// The host scores for anyone; a guest only for the seats it claimed
const myTurn = () => !isGuest() || ROOM.mine.includes(currentTurn());
function openRoom(code, reopen) {
  roomOpen = null;
  hostRoom(code, reopen).then(() => { save(); render(); }, () => toast(t("Couldn't open the room")));
}
// The lobby is open until the first visit (on a guest also while it has no seat). A tap on its bar overrides
// that until play starts or a new match begins.
let roomOpen = null, qrLoad = null;
const roomStage = () => `${S.id}:${S.acts.length > 0}`;
// The QR code generator loads the first time a lobby opens, so single-phone play loads nothing extra
const loadQR = () => qrLoad ||= new Promise((ok, no) => {
  const el = document.createElement('script');
  el.src = 'vendor/qrcode.js'; el.onload = ok; el.onerror = () => { qrLoad = null; no(); };
  document.head.appendChild(el);
});
function qrHTML(link) {
  if (typeof qrcode !== 'function') { loadQR().then(renderRoomBar, () => {}); return ''; }
  const q = qrcode(0, 'M'); q.addData(link); q.make();
  return q.createSvgTag({ cellSize: 4, margin: 2 });
}
// The join link: this page's own address, so a test or development transport carries over. The apps' own
// addresses (capacitor://, or https://localhost on Android) mean nothing on another phone, so they use the website.
function joinLink(code) {
  const app = window.ocheNative?.isNative || !/^https?:$/.test(location.protocol);
  const u = new URL(app ? SITE_URL : location.href), local = u.searchParams.get('transport') === 'local';
  u.search = ''; u.hash = '';
  u.searchParams.set('join', code);
  if (local) u.searchParams.set('transport', 'local');
  return u.href;
}
const roomOf = () => S.room || { seats: {}, online: {} };
const connDot = p => { const r = roomOf(), on = !!(r.seats[p] && r.online[r.seats[p]]); return `<span class="dot${on ? ' on' : ''}" title="${t(on ? 'Connected' : 'Not connected')}"></span>`; };
function renderRoomBar() {
  const bar = $('roomBar');
  bar.hidden = !ROOM;
  if (!ROOM) { bar.innerHTML = ''; return; }
  const host = ROOM.role === 'host', pl = players(), r = roomOf(), self = ROOM.self;
  const open = roomOpen?.stage === roomStage() ? roomOpen.open : !S.acts.length || (!host && !ROOM.mine.length);
  bar.dataset.open = open;
  const phones = Object.keys(r.online).length;
  const sum = host ? t(phones === 1 ? '1 phone' : '{n} phones', { n: phones })
    : ROOM.mine.length ? t('Playing as {names}', { names: ROOM.mine.map(s => pl[s]?.name).join(', ') }) : t('Tap your name');
  // The match lives on the host, so nothing is lost while it is away; the guest may still leave
  const lost = ROOM.lost ? `<div class="room-lost" role="status"><b>${t('Host disconnected')}</b><button class="btn" type="button" data-act="leave">${t('Leave')}</button></div>` : '';
  const head = lost + `<button type="button" class="room-head" data-act="room" aria-expanded="${open}"><span><b>${t('Room {code}', { code: formatRoomCode(ROOM.code) })}</b> · ${esc(sum)}</span><span class="chev" aria-hidden="true"></span></button>`;
  if (!open) { bar.innerHTML = head; return; }
  let body;
  if (host) {
    const link = joinLink(ROOM.code);
    const seats = pl.map((p, i) => {
      const id = r.seats[i], bot = p.type === 'bot';
      const stat = i === 0 ? t('This phone') : bot ? 'Bot' : !id ? t('Scored here') : r.online[id] ? t('Connected') : t('Not connected');
      return `<li class="seat">${id ? connDot(i) : '<span class="dot none"></span>'}<span class="sname">${esc(p.name)}</span><span class="sstat">${stat}</span></li>`;
    }).join('');
    body = `<div class="room-join"><div class="qr">${qrHTML(link)}</div><div class="room-info">
        <span class="label">${t('Room code')}</span><div class="room-code num">${formatRoomCode(ROOM.code)}</div>
        <p class="hint">${t('Players scan the code or open the link on their phone, then tap their name.')}</p>
        <a class="room-link" href="${esc(link)}">${esc(link.replace(/^https?:\/\//, ''))}</a>
        <button class="btn" type="button" data-act="shareLink">${t('Share link')}</button></div></div>
      <ul class="seats">${seats}</ul>`;
  } else {
    // Seat 0 is the host's, bots play on the host, and a seat another phone has is taken
    const seats = pl.map((p, i) => {
      const mine = r.seats[i] === self, taken = r.seats[i] && !mine, bot = p.type === 'bot';
      const stat = i === 0 ? t('Host') : bot ? 'Bot' : mine ? t('This phone') : taken ? t('Taken') : '';
      return `<li><button type="button" class="seat" data-act="claim" data-v="${i}" aria-pressed="${mine}"${i === 0 || bot || taken ? ' disabled' : ''}><span class="sname">${esc(p.name)}</span><span class="sstat">${stat}</span></button></li>`;
    }).join('');
    body = `<p class="hint">${t('Tap the name or names you are playing as.')}</p><ul class="seats">${seats}</ul>
      <div class="row-actions"><button class="btn" type="button" data-act="leave">${t('Leave')}</button></div>`;
  }
  bar.innerHTML = head + `<div class="room-body">${body}</div>`;
}
// The join screen: a code field and Join. A join link fills the code and joins at once.
let joinCode = '', joinMsg = '', joinBusy = false, joinFailed = false;
function openJoin(code = '', nav = true) {
  joinCode = code; joinMsg = ''; joinBusy = false; joinFailed = false;
  if (nav) return goScreen('join');
  S.screen = 'join'; render();
}
function renderJoin() {
  $('page').innerHTML = `<section class="panel join"><h2>${t('Join a game')}</h2>
    <p class="hint">${t("Type the room code from the host's phone, or scan its QR code with the camera.")}</p>
    <form class="joinrow" id="joinForm" novalidate><input type="text" id="joinCode" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="9" placeholder="K7Q-M2P" aria-label="${t('Room code')}" value="${esc(joinCode)}">
      <button class="btn primary" type="submit" data-act="join"${joinBusy ? ' disabled' : ''}>${t(joinBusy ? 'Connecting…' : joinFailed ? 'Retry' : 'Join')}</button></form>
    <div class="msg" role="status" aria-live="polite">${esc(joinMsg)}</div></section>`;
}
async function doJoin(text = $('joinCode')?.value) {
  joinCode = text || '';
  const code = parseRoomCode(joinCode);
  joinMsg = code ? '' : t('A room code is 6 letters and digits, like K7Q-M2P');
  joinBusy = !!code; joinFailed = false; roomOpen = null;
  render();
  if (!code) return;
  try { await joinRoomAsGuest(code); joinBusy = false; }
  catch (e) {
    joinBusy = false;
    if (e?.message === 'left') return; // this phone left while it was still connecting
    joinFailed = !['version', 'hostVersion'].includes(e?.message);
    joinMsg = joinFailed ? t("Couldn't reach the room. Check the code, and that both phones are online.") : updateText(e.message);
    // The join can fail after the room was set up (no host, another protocol): this phone is in no room then
    leaveRoom();
    if (S.screen === 'join') render();
  }
}

// ---------- input ----------
function press(k) {
  if (!myTurn()) return;
  // An empty Score just after a guest's visit cleared what was typed
  if (k === 'ok' && buffer === '' && Date.now() - lostAt < 3000) { lostAt = 0; return; }
  lostAt = 0;
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
  else if (b.dataset.menu === 'join') isGuest() ? confirmLeave(() => openJoin()) : openJoin();
  else if (b.dataset.menu) isGuest() ? confirmLeave(() => openSetup(b.dataset.menu)) : openSetup(b.dataset.menu);
  else if (b.dataset.act === 'room') { roomOpen = { open: $('roomBar').dataset.open !== 'true', stage: roomStage() }; renderRoomBar(); }
  else if (b.dataset.act === 'claim') claim([+b.dataset.v]);
  else if (b.dataset.act === 'leave') { leaveRoom(); goMenu(); }
  else if (b.dataset.act === 'shareLink') shareIt(joinLink(ROOM.code));
  else if (b.dataset.act === 'discard') confirmDiscard();
  else if (b.dataset.act === 'continue') { S.screen = 'play'; save(); render(); if (!botBusy) maybeBot(); }
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
// Android back button (web/native.js): close a dialog, else leave the screen for the menu (a match in progress
// stays resumable there); false on the menu lets the app go to the background
window.ocheBack = () => {
  if (dialogOpen) { dialogKey?.({ key: 'Escape' }); return true; }
  if (S.screen === 'menu') return false;
  goMenu();
  return true;
};
document.addEventListener('submit', e => { if (e.target.id === 'joinForm') { e.preventDefault(); doJoin(); } });
document.addEventListener('change', e => { if (e.target.matches('#page select[data-pg]')) pageAct(e.target.dataset.pg, e.target.value); });
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
    S.acts = S.acts || [];
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
  // A join link (from the host's QR code): open the join screen and join at once, then drop the code from the address
  const params = new URLSearchParams(location.search), code = params.get('join');
  if (code != null) {
    params.delete('join');
    history.replaceState(null, '', location.pathname + (params.toString() ? '?' + params : '') + location.hash);
    openJoin(code, false);
    return doJoin(code);
  }
  // Back after a reload: a host reopens its match's room, a guest rejoins the room it was in
  const rejoin = readJSON(ROOM_KEY, null);
  if (S.room?.code) openRoom(S.room.code, true);
  else if (rejoin?.code) { openJoin(rejoin.code, false); return doJoin(rejoin.code); }
  maybeBot();
}
window.claude?.hot?.snapshot?.(() => ({ S }));
const boot = () => window.claude?.hot?.ready ? window.claude.hot.ready(start) : start(window.claude?.hot?.data ?? {});
// In the iOS app, wait for saved games to come back from native storage first
window.ocheReady ? window.ocheReady.then(boot, boot) : boot();
