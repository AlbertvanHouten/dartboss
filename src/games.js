// ===== Cricket and training games =====
// Each game: init(settings), act(g, action, value, settings), done(g), plus render hooks hud/pad/board/log/result.
// Titles, rules, hints and option labels stay English here and go through t() where they are shown.
// shortcut: dart labels are stored as thrown, so a visit keeps the language it was played in
const T21 = Array.from({ length: 20 }, (_, i) => i + 1).concat(25);
const tName = n => n === 25 ? 'Bull' : String(n);
const dName = n => n === 25 ? 'Bull' : 'D' + n;
const keysFor = (n, rings = ['S', 'D', 'T']) => n === 25 ? (rings.length === 1 ? [rings[0] === 'D' ? 'BULL' : '25'] : ['25', 'BULL']) : rings.map(r => r + n);
const andList = a => a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + t(' and ') + a.at(-1);
const sumOf = a => a.reduce((x, y) => x + y, 0);
const pctOf = (a, b) => b ? Math.round(a / b * 100) + '%' : '–';
const htmlEsc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Bot strength is a target 3-dart average; older saves stored a 1-10 level
const botAvg = p => p.avg ?? [0, 25, 35, 45, 55, 62, 70, 78, 86, 94, 102][p.level || 5];

// ---- Cricket rules ----
const CR = [20, 19, 18, 17, 16, 15, 25];
const CR_ROUNDS = 20;
function crLabel(d) {
  if (d.bounce) return t('Bounce-out');
  if (d.k) return E.label(E.BY[d.k]);
  if (!d.n) return t('Miss');
  if (d.n === 25) return d.mult === 2 ? 'Bull' : '25';
  return ['', 'S', 'D', 'T'][d.mult] + d.n;
}
function crDart(g, n, mult, extra = {}) {
  const me = g.pl[g.turn];
  me.darts++;
  g.cur.push({ n, mult, ...extra });
  if (n) {
    const close = Math.min(mult, 3 - me.m[n]), over = mult - close;
    me.m[n] += close;
    const scoring = over > 0 && g.pl.some((o, i) => i !== g.turn && o.m[n] < 3);
    if (scoring) me.pts += over * n;
    me.marks += close + (scoring ? over : 0);
  }
  const allClosed = CR.every(x => me.m[x] >= 3);
  if (allClosed && g.pl.every((o, i) => i === g.turn || me.pts >= o.pts)) g.winner = g.turn;
  if (g.winner != null || g.cur.length === 3) crEndVisit(g);
}
function crEndVisit(g) {
  g.log.push({ p: g.turn, round: g.round, darts: g.cur });
  g.cur = [];
  if (g.winner != null) return;
  g.turn = (g.turn + 1) % g.pl.length;
  if (g.turn === 0) g.round++;
  if (g.round > CR_ROUNDS) {
    // Round limit: most points wins, then most marks; level on both is a tie
    settleByScore(g, p => p.pts * 1000 + p.marks);
    g.capped = true; g.round = CR_ROUNDS;
  }
}
// Bot strategy: cover numbers the opponent can score on, score while behind, otherwise close the highest open number
function crTarget(g, avg = 60) {
  const me = g.pl[g.turn], op = g.pl[(g.turn + 1) % g.pl.length];
  const mine = CR.filter(n => me.m[n] < 3);
  // Beginners close the numbers in order from 20 down and only score when everything is shut
  if (avg < 45) return mine[0] ?? CR.find(n => op.m[n] < 3) ?? 20;
  // Far enough ahead that one visit can't catch up: stop scoring and close
  if (mine.length && me.pts - op.pts > 60) return mine[0];
  const threat = CR.filter(n => op.m[n] >= 3 && me.m[n] < 3);
  if (threat.length && op.pts >= me.pts) return threat[0];
  const scoreOn = CR.filter(n => me.m[n] >= 3 && op.m[n] < 3);
  if (me.pts <= op.pts && scoreOn.length) return scoreOn[0];
  if (mine.length) return mine[0];
  return scoreOn[0] ?? 20;
}
// What a dart is worth in Cricket: marks that close, plus marks that score while the opponent is open
function crValue(g, n) {
  const me = g.pl[g.turn], open = g.pl.some((o, i) => i !== g.turn && o.m[n] < 3);
  return h => {
    if (h.n !== n) return 0;
    const mult = { S: 1, D: 2, T: 3, SB: 1, DB: 2 }[h.ring] || 0;
    const close = Math.min(mult, 3 - me.m[n]);
    return close + (open ? (mult - close) * 0.8 : 0);
  };
}
function crBotVisit(g, st, ctxFor) {
  const prof = E.profileFor(botAvg(st.players[g.turn]));
  const p = g.turn, thr = E.startVisit(prof, ctxFor(p));
  while (g.winner == null && g.turn === p) {
    const n = crTarget(g, prof.avg);
    const aim = n === 25 ? E.BY.BULL : E.bestAim([E.BY['T' + n], E.BY['S' + n]], crValue(g, n), prof, ctxFor(p));
    const r = thr(aim);
    const h = r.h;
    const mult = CR.includes(h.n) ? { S: 1, D: 2, T: 3, SB: 1, DB: 2 }[h.ring] : 0;
    crDart(g, mult ? h.n : 0, mult, { k: h.k, x: r.x, y: r.y, bounce: !!r.bounce });
  }
}
const markSVG = m => m <= 0 ? '' : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" role="img" aria-label="${t(m > 1 ? '{n} marks' : '{n} mark', { n: m })}"><path d="M6 18L18 6"/>${m >= 2 ? '<path d="M6 6l12 12"/>' : ''}${m >= 3 ? '<circle cx="12" cy="12" r="10.4" stroke-width="2"/>' : ''}</svg>`;

// ---- shared render helpers ----
function hudHTML({ eyebrow, target, sub, stats }) {
  return `<section class="panel ghud"><div class="label">${eyebrow}</div>
    <div class="gtarget num">${target}</div>${sub ? `<div class="gsub">${sub}</div>` : ''}
    <div class="gstats">${stats.map(([l, v]) => `<div><span class="label">${l}</span><b class="num">${v}</b></div>`).join('')}</div></section>`;
}
const cellsHTML = (items, cur) => `<div class="cells">${items.map((it, i) =>
  `<div class="cell${i === cur ? ' now' : ''}${it.cls ? ' ' + it.cls : ''}"><span>${it.h}</span><b class="num">${it.v}</b></div>`).join('')}</div>`;
const gb = (ga, label, { v = '', hot = '', cls = '', dis = false, small = '' } = {}) =>
  `<button type="button" class="gbtn ${cls}" data-ga="${ga}" data-v="${v}"${hot ? ` data-hot="${hot}"` : ''}${dis ? ' disabled' : ''}>${label}${small ? `<small>${small}</small>` : ''}${hot ? `<kbd>${hot.toUpperCase()}</kbd>` : ''}</button>`;
const hitsPad = () => `<div class="label">${t('Doubles hit this round')}</div><div class="gpad">${[0, 1, 2, 3].map(h => gb('hits', h, { v: h, hot: String(h), cls: h ? 'good' : '' })).join('')}</div>`;
const getBest = m => { try { return (JSON.parse(localStorage.getItem('oche-bests')) || {})[m] ?? null; } catch (e) { return null; } };
function recordBest(m, v, better) {
  let b = {};
  try { b = JSON.parse(localStorage.getItem('oche-bests')) || {}; } catch (e) {}
  const old = b[m];
  if (old != null && (better === 'min' ? v >= old : v <= old)) return null;
  b[m] = v;
  try { localStorage.setItem('oche-bests', JSON.stringify(b)); } catch (e) {}
  window.ocheNative?.persist('oche-bests', JSON.stringify(b));
  return { kind: old == null ? 'first' : 'beaten', old };
}

const GAMES = {
  cricket: {
    title: 'Cricket', opponent: true,
    rules: 'Close 15 to 20 and the bull with three marks each: a single is one mark, a double two, a treble three. Once you have closed a number, extra marks on it score its value until your opponent closes it too. Close everything while level or ahead on points to win. After 20 rounds the most points wins.',
    hint: 'Tap each dart as you throw it.', keys: 'Keys: M miss · Ctrl+Z undo',
    init: st => ({ pl: st.players.map(() => ({ m: { 15: 0, 16: 0, 17: 0, 18: 0, 19: 0, 20: 0, 25: 0 }, pts: 0, marks: 0, darts: 0 })), turn: 0, cur: [], round: 1, winner: null, log: [] }),
    done: g => g.winner != null,
    // Opponent nearly closed out, or the round limit is close
    pressure: (g, p) => g.round >= CR_ROUNDS - 2 || CR.filter(n => g.pl[(p + 1) % g.pl.length].m[n] < 3).length <= 1,
    act(g, a, v) { const [n, m] = String(v).split(':').map(Number); crDart(g, n, m); },
    hud(g, st) {
      const done = g.winner != null;
      const mpr = i => g.pl[i].darts ? (g.pl[i].marks / g.pl[i].darts * 3).toFixed(2) : '–';
      const head = st.players.map((p, i) => `<th class="${!done && i === g.turn ? 'on' : ''}">${htmlEsc(p.name)}${p.type === 'bot' ? ` · ${t('{avg} avg', { avg: botAvg(p) })}` : ''}<b class="num">${g.pl[i].pts}</b><span class="hint">MPR ${mpr(i)}</span></th>`);
      const rows = CR.map(n => `<tr class="${g.pl.every(x => x.m[n] >= 3) ? 'closed' : ''}"><td class="mk">${markSVG(g.pl[0].m[n])}</td><td class="crnum">${n === 25 ? 'Bull' : n}</td><td class="mk">${markSVG(g.pl[1].m[n])}</td></tr>`).join('');
      return `<section class="panel ghud"><div class="label">${t('Round {n} of {of}', { n: g.round, of: CR_ROUNDS })}${!done && isBotTurn() ? ` · <span class="thinking">${t('Bot throwing')}</span>` : ''}</div>
        <table class="crtab"><thead><tr>${head[0]}<th></th>${head[1]}</tr></thead><tbody>${rows}</tbody></table></section>`;
    },
    pad(g, st) {
      const dis = isBotTurn();
      const chips = [0, 1, 2].map(i => g.cur[i] ? `<span class="vchip set">${crLabel(g.cur[i])}</span>` : `<span class="vchip">${t('Dart {n}', { n: i + 1 })}</span>`).join('');
      const rows = CR.map(n => `<span class="crn">${n === 25 ? 'B' : n}</span>` + (n === 25
        ? gb('dart', '25', { v: '25:1', dis }) + gb('dart', 'Bull', { v: '25:2', dis }) + '<span></span>'
        : gb('dart', 'S', { v: `${n}:1`, dis }) + gb('dart', 'D', { v: `${n}:2`, dis }) + gb('dart', 'T', { v: `${n}:3`, dis }))).join('');
      return `<div class="label">${t('{name} to throw', { name: htmlEsc(st.players[g.turn].name) })}</div><div class="visit-chips">${chips}</div>
        <div class="crpad">${rows}</div>${gb('dart', t('Miss'), { v: '0:0', hot: 'm', dis })}`;
    },
    board(g, st) {
      const open = CR.filter(n => g.pl.some(p => p.m[n] < 3));
      const last = g.log[g.log.length - 1];
      const botLast = last && last.darts.length && last.darts[0].x != null ? last : null;
      return {
        label: t('Open numbers'), text: open.map(tName).join(' '), keys: open.flatMap(n => keysFor(n)),
        darts: botLast ? botLast.darts.map(d => ({ k: d.k, x: d.x, y: d.y, bounce: d.bounce })) : [],
        legend: botLast ? `<span>${t("{name}'s last visit:", { name: htmlEsc(st.players[botLast.p].name) })}</span> ${botLast.darts.map((d, i) => `<span>${i + 1}. <b>${crLabel(d)}</b></span>`).join('')}` : null,
      };
    },
    log(g, st) {
      const rows = g.log.slice(-14).reverse().map(v => {
        const marks = v.darts.reduce((a, d) => a + (d.n ? d.mult : 0), 0);
        return `<tr><td>${v.round}</td><td>${htmlEsc(st.players[v.p].name)}</td><td>${v.darts.map(crLabel).join(' · ')}</td><td>${marks}</td></tr>`;
      }).join('') || `<tr><td colspan="4" style="text-align:left;color:var(--muted)">${t('No darts thrown yet.')}</td></tr>`;
      return `<section class="panel"><h2>${t('Visits')}</h2><div class="sheet-wrap"><table class="sheet"><thead><tr><th>${t('Round')}</th><th>${t('Player')}</th><th>${t('Darts')}</th><th>${t('Hit marks')}</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
    },
    result(g, st) {
      if (g.winner === -1) return { headline: t('Tie at the round limit'), detail: t('{pts} points each and level on marks after {n} rounds.', { pts: g.pl[0].pts, n: CR_ROUNDS }), best: null };
      const w = g.winner, o = (w + 1) % 2, mpr = g.pl[w].darts ? g.pl[w].marks / g.pl[w].darts * 3 : 0;
      return { headline: t('Win for {name}', { name: st.players[w].name }), detail: t(g.capped ? '{a} points to {b}, {mpr} marks per round, decided at the 20-round limit.' : '{a} points to {b}, {mpr} marks per round.', { a: g.pl[w].pts, b: g.pl[o].pts, mpr: mpr.toFixed(2) }), best: null };
    },
  },

};
GAMES.cricket.botVisit = crBotVisit;

// ---- helpers for multi-player and keypad games ----
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'ok'];
const keypadHTML = ({ dis = false, chips = [], aim = '', aimLabel = 'Aim' }) =>
  `<div class="readout"><div class="val num${buffer ? '' : ' empty'}">${buffer || t(dis ? 'Bot throwing…' : 'Enter score')}</div><div class="who"><span class="label">${t(aimLabel)}</span><br><b>${aim}</b></div></div>
  <div class="quick">${chips.map(([v, l, cls]) => `<button class="chip ${cls || ''}" type="button" data-ga="score" data-v="${v}"${dis ? ' disabled' : ''}>${l}</button>`).join('')}</div>
  <div class="keys">${KEYS.map(k => `<button class="key ${k === 'ok' ? 'ok' : k === 'del' ? 'fn' : ''}" type="button" data-key="${k}"${dis ? ' disabled' : ''} aria-label="${k === 'del' ? t('Delete digit') : k === 'ok' ? t('Submit score') : k}">${k === 'del' ? '⌫' : k === 'ok' ? t('Score') : k}</button>`).join('')}</div>`;
const visitChips = cur => `<div class="visit-chips">${[0, 1, 2].map(i => cur[i] ? `<span class="vchip set">${cur[i].lab}</span>` : `<span class="vchip">${t('Dart {n}', { n: i + 1 })}</span>`).join('')}</div>`;
function playersHUD({ eyebrow, target, sub, st, g, cells, done }) {
  const botNow = !done && isBotTurn();
  return `<section class="panel ghud"><div class="label">${eyebrow}${botNow ? ` · <span class="thinking">${t('Bot throwing')}</span>` : ''}</div>
    ${target != null ? `<div class="gtarget num${String(target).length > 4 ? ' long' : ''}">${target}</div>` : ''}${sub ? `<div class="gsub">${sub}</div>` : ''}
    <div class="mplayers">${st.players.map((p, i) => `<div class="mp${!done && i === g.turn ? ' on' : ''}${cells[i].out ? ' out' : ''}"><span class="mpn">${htmlEsc(p.name)}${p.type === 'bot' ? ` <span class="label">${t('{avg} avg', { avg: botAvg(p) })}</span>` : ''}</span><b class="num">${cells[i].main}</b><span class="mps">${cells[i].sub || ''}</span></div>`).join('')}</div></section>`;
}
// Next player in seat order (optionally skipping eliminated players); passing seat 0 starts a new round
function nextTurn(g, alive = () => true) {
  const n = g.pl.length;
  for (let k = 1; k <= n; k++) {
    const c = (g.turn + k) % n;
    if (alive(c)) { if (c <= g.turn) g.round++; g.turn = c; return; }
  }
}
function lastBotDarts(g, st) {
  const last = g.log[g.log.length - 1];
  if (!last || !last.darts || !last.darts.length || last.darts[0].x == null) return { darts: [], legend: null };
  return {
    darts: last.darts.map(d => ({ k: d.k, x: d.x, y: d.y, bounce: d.bounce })),
    legend: `<span>${t("{name}'s last visit:", { name: htmlEsc(st.players[last.p].name) })}</span> ${last.darts.map((d, i) => `<span>${i + 1}. <b>${d.lab}</b></span>`).join('')}`,
  };
}
// Highest score wins; equal top scores are a tie
function settleByScore(g, score) {
  const top = Math.max(...g.pl.map(score));
  const w = g.pl.map((_, i) => i).filter(i => score(g.pl[i]) === top);
  if (w.length === 1) g.winner = w[0]; else { g.winner = -1; g.tied = w; }
}
function scoreResult(g, st, score, unit, mode) {
  const names = st.players.map(p => p.name);
  unit = t(unit);
  if (st.players.length === 1) return { headline: `${t(GAMES[mode].title)}: ${score(g.pl[0])} ${unit}`, detail: t('Solo game.'), best: score(g.pl[0]), better: 'max' };
  if (g.winner === -1) return { headline: t('Tie between {names}', { names: andList(g.tied.map(i => names[i])) }), detail: t('{n} {unit} each.', { n: score(g.pl[g.tied[0]]), unit }), best: null };
  const rest = g.pl.map((p, i) => i).filter(i => i !== g.winner).map(i => `${names[i]} ${score(g.pl[i])}`).join(', ');
  return { headline: t('Win for {name} with {n} {unit}', { name: names[g.winner], n: score(g.pl[g.winner]), unit }), detail: t('Others: {rest}.', { rest }), best: null };
}
const visitsTable = (g, st, extraHead = '', extra = () => '') => {
  const rows = g.log.slice(-14).reverse().map(v => `<tr><td>${v.round}</td><td>${htmlEsc(st.players[v.p].name)}</td><td>${(v.darts || []).map(d => d.lab).join(' · ') || '–'}</td>${extraHead ? `<td>${extra(v)}</td>` : ''}</tr>`).join('')
    || `<tr><td colspan="${extraHead ? 4 : 3}" style="text-align:left;color:var(--muted)">${t('No darts thrown yet.')}</td></tr>`;
  return `<section class="panel"><h2>${t('Visits')}</h2><div class="sheet-wrap"><table class="sheet"><thead><tr><th>${t('Round')}</th><th>${t('Player')}</th><th>${t('Darts')}</th>${extraHead ? `<th>${extraHead}</th>` : ''}</tr></thead><tbody>${rows}</tbody></table></div></section>`;
};

// ---- Killer ----
const KI_LIVES = 3, KI_ROUNDS = 30;
function kiDart(g, n, extra = {}) {
  const me = g.pl[g.turn];
  me.darts++;
  const d = { n, lab: n ? 'D' + n : t('Miss'), ...extra };
  if (n) {
    const owner = g.pl.findIndex(p => p.lives > 0 && p.num === n);
    if (owner === g.turn) {
      if (!me.killer) { me.killer = true; d.lab += ' · ' + t('killer'); }
      else { me.lives--; d.lab += ' · ' + t('own life'); }
    } else if (owner >= 0 && me.killer) {
      g.pl[owner].lives--; me.hits++; d.victim = owner; d.lab += ' · ' + t('hit');
    }
  }
  g.cur.push(d);
  const alive = g.pl.map((_, i) => i).filter(i => g.pl[i].lives > 0);
  if (alive.length <= 1) g.winner = alive.length ? alive[0] : g.turn;
  if (g.winner != null || g.cur.length === 3 || me.lives <= 0) kiEnd(g);
}
function kiEnd(g) {
  g.log.push({ p: g.turn, round: g.round, darts: g.cur });
  g.cur = [];
  if (g.winner != null) return;
  nextTurn(g, i => g.pl[i].lives > 0);
  if (g.round > KI_ROUNDS) {
    // Most lives wins, then most lives taken; level on both is a tie
    settleByScore(g, p => p.lives > 0 ? p.lives * 1000 + p.hits : -1);
    g.capped = true; g.round = KI_ROUNDS;
  }
}
// Bot: get its own double first, then go after the most dangerous opponent (killers first, then fewest lives)
function kiTarget(g) {
  const me = g.pl[g.turn];
  if (!me.killer) return me.num;
  const opps = g.pl.map((p, i) => ({ p, i })).filter(x => x.i !== g.turn && x.p.lives > 0)
    .sort((a, b) => (b.p.killer - a.p.killer) || (a.p.lives - b.p.lives));
  return opps[0].p.num;
}
const botLab = r => r.bounce ? t('Bounce-out') : E.label(r.h);
function kiBotVisit(g, st, ctxFor) {
  const prof = E.profileFor(botAvg(st.players[g.turn]));
  const p = g.turn, thr = E.startVisit(prof, ctxFor(p));
  while (g.winner == null && g.turn === p) {
    const r = thr(E.BY['D' + kiTarget(g)], true);
    kiDart(g, r.h.ring === 'D' ? r.h.n : 0, { k: r.h.k, x: r.x, y: r.y, lab: botLab(r), bounce: !!r.bounce });
  }
}

Object.assign(GAMES, {
  killer: {
    title: 'Killer', players: [2, 8],
    rules: `Every player gets a random number. Hit the double of your own number to become a killer. Killers take a life from an opponent each time they hit that opponent's double, but a killer who hits their own double loses a life. Everyone starts with ${KI_LIVES} lives, and the last player standing wins.`,
    hint: 'Tap the double each dart hit. Any other segment counts as a miss.', keys: 'Keys: M miss · Ctrl+Z undo',
    init(st) {
      const nums = Array.from({ length: 20 }, (_, i) => i + 1);
      for (let i = nums.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [nums[i], nums[j]] = [nums[j], nums[i]]; }
      return { pl: st.players.map((_, i) => ({ num: nums[i], lives: KI_LIVES, killer: false, hits: 0, darts: 0 })), turn: 0, cur: [], round: 1, winner: null, log: [] };
    },
    done: g => g.winner != null,
    act(g, a, v) { kiDart(g, +v); },
    botVisit: kiBotVisit,
    pressure: (g, p) => g.pl[p].lives === 1 || g.pl.filter(x => x.lives > 0).length === 2,
    hud(g, st) {
      const me = g.pl[g.turn];
      return playersHUD({
        st, g, done: g.winner != null, eyebrow: t('Killer · round {n}', { n: g.round }),
        sub: g.winner != null ? '' : `${htmlEsc(st.players[g.turn].name)}: ${me.killer ? t("killer, so go for your opponents' doubles") : t('hit {d} to become a killer', { d: 'D' + me.num })}`,
        cells: g.pl.map(p => ({ main: p.lives > 0 ? '♥'.repeat(p.lives) : t('Out'), sub: `D${p.num}${p.killer ? ' · ' + t('killer') : ''}`, out: p.lives <= 0 })),
      });
    },
    pad(g, st) {
      const dis = isBotTurn(), me = g.pl[g.turn];
      const btns = g.pl.map((p, i) => ({ p, i })).filter(x => x.p.lives > 0).map(({ p, i }) =>
        gb('dart', 'D' + p.num, { v: p.num, dis, small: htmlEsc(st.players[i].name), cls: (i === g.turn ? !me.killer : me.killer) ? 'good' : '' }));
      return `<div class="label">${t('{name} to throw', { name: htmlEsc(st.players[g.turn].name) })}</div>${visitChips(g.cur)}
        <div class="gpad" style="--cols:3">${btns.join('')}${gb('dart', t('Miss'), { v: 0, hot: 'm', dis })}</div>`;
    },
    board(g, st) {
      const me = g.pl[g.turn], bot = lastBotDarts(g, st);
      const keys = g.winner != null ? [] : me.killer ? g.pl.filter((p, i) => i !== g.turn && p.lives > 0).map(p => 'D' + p.num) : ['D' + me.num];
      return { label: t(me.killer ? "Opponents' doubles" : 'Your double'), text: keys.join(' '), keys, ...bot };
    },
    log: (g, st) => visitsTable(g, st),
    result(g, st) {
      if (g.winner === -1) return { headline: t('Tie between {names}', { names: andList(g.tied.map(i => st.players[i].name)) }), detail: t('Level on lives and lives taken at the {n}-round limit.', { n: KI_ROUNDS }), best: null };
      const w = g.pl[g.winner], name = st.players[g.winner].name;
      return { headline: g.capped ? t('Round limit: {name} wins', { name }) : t('Last one standing: {name}', { name }), detail: t(w.lives === 1 ? '{n} life left after {r} rounds' : '{n} lives left after {r} rounds', { n: w.lives, r: g.round }) + ', ' + t(w.hits === 1 ? '{n} life taken' : '{n} lives taken', { n: w.hits }) + (g.capped ? t(', decided at the round limit') : '') + '.', best: null };
    },
  },

});

// ---- Game options (settings per game) ----
// Each game lists options as { key, label, choices: [[value, label]], def, best }; best: false means the
// option doesn't change what a score means, so personal bests are shared across it.
function resolveOpts(st) {
  const o = {};
  for (const d of GAMES[st.mode].options || []) o[d.key] = st.opts?.[st.mode]?.[d.key] ?? d.def;
  return o;
}
// Personal bests are kept per game and per set of score-changing options
function bestKey(st) {
  const o = resolveOpts(st);
  const sig = (GAMES[st.mode].options || []).filter(d => d.best !== false && o[d.key] !== d.def).map(d => `${d.key}=${o[d.key]}`).join(',');
  return st.mode + (sig ? ':' + sig : '');
}
const shuffled = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const ordered = (list, order) => order === 'desc' ? list.slice().reverse() : order === 'random' ? shuffled(list) : list.slice();
const ORDER_OPT = { key: 'order', label: 'Order', choices: [['asc', 'Low to high'], ['desc', 'High to low'], ['random', 'Random']], def: 'asc', best: false };
const multOf = h => ({ S: 1, D: 2, T: 3, SB: 1, DB: 2 }[h.ring] || 0);
const ringLab = (n, mult) => !mult ? t('Miss') : n === 25 ? (mult === 2 ? 'Bull' : '25') : ['', 'S', 'D', 'T'][mult] + n;
const endBtn = () => `<div class="row-actions" style="justify-content:flex-start">${gb('end', t('Finish session'), { cls: 'wide' })}</div>`;
// Board colours: singles alternate black and white, doubles and trebles red and green
function colourOf(h) {
  if (h.k === 'MISS') return null;
  if (h.k === 'BULL') return 'red';
  if (h.k === '25') return 'green';
  const even = E.ORDER.indexOf(h.n) % 2 === 0;
  return h.ring === 'S' ? (even ? 'black' : 'white') : (even ? 'red' : 'green');
}
const RING_MULT = { S: 1, D: 2, T: 3 };

// ---- Around the Clock ----
function atcCounts(o, n, mult) {
  if (!mult) return false;
  if (n === 25) return o.bull === 'either' || (o.bull === 'outer' ? mult === 1 : mult === 2);
  return o.segments === 'any' || { singles: 1, doubles: 2, trebles: 3 }[o.segments] === mult;
}
function atcDart(g, mult, extra = {}) {
  const me = g.pl[g.turn], o = g.o, n = g.targets[me.i];
  me.darts++; me.per[me.i]++;
  g.cur.push({ mult, lab: ringLab(n, mult), ...extra });
  if (atcCounts(o, n, mult)) {
    // A skip stops on the last target unless the setting lets it carry past the end
    if (o.skip !== 'off' && n !== 25) { me.i = Math.min(o.skip === 'past' || me.i === 20 ? 21 : 20, me.i + mult); me.hits = 0; }
    else if (++me.hits >= o.hits) { me.i++; me.hits = 0; }
  }
  if (me.i >= 21) g.winner = g.turn;
  if (g.winner != null || g.cur.length === 3) {
    g.log.push({ p: g.turn, round: g.round, darts: g.cur });
    g.cur = [];
    if (g.winner == null) nextTurn(g);
  }
}
function atcBotVisit(g, st, ctxFor) {
  const prof = E.profileFor(botAvg(st.players[g.turn])), p = g.turn, ctx = ctxFor(p), thr = E.startVisit(prof, ctx);
  while (g.winner == null && g.turn === p) {
    const me = g.pl[p], n = g.targets[me.i], o = g.o;
    const cands = n === 25 ? [E.BY.BULL, E.BY['25']] : ['T', 'S', 'D'].map(r => E.BY[r + n]);
    const value = h => h.n === n && atcCounts(o, n, multOf(h)) ? (o.skip !== 'off' && n !== 25 ? multOf(h) : 1) : 0;
    const aim = E.bestAim(cands, value, prof, ctx);
    const r = thr(aim, aim.ring === 'D');
    atcDart(g, r.h.n === n ? multOf(r.h) : 0, { k: r.h.k, x: r.x, y: r.y, lab: botLab(r), bounce: !!r.bounce });
  }
}

// ---- Bob's 27 ----
const bobDone = p => p.dead || p.r >= 21;
function bobApply(g, h, darts = null) {
  const me = g.pl[g.turn], n = T21[me.r], val = n === 25 ? 50 : 2 * n;
  me.score += h ? h * val : -val;
  me.hits.push(h); me.r++;
  if (me.score < 0 && g.o.mode === 'hard') me.dead = true;
  g.log.push({ p: g.turn, round: me.r, darts, h });
  if (g.pl.every(bobDone)) return settleByScore(g, p => p.dead ? -1e6 + p.r : p.score);
  nextTurn(g, i => !bobDone(g.pl[i]));
}
function bobBotVisit(g, st, ctxFor) {
  const prof = E.profileFor(botAvg(st.players[g.turn])), thr = E.startVisit(prof, ctxFor(g.turn));
  const n = T21[g.pl[g.turn].r], aim = n === 25 ? E.BY.BULL : E.BY['D' + n];
  const darts = [];
  let h = 0;
  for (let i = 0; i < 3; i++) {
    const r = thr(aim, true);
    if (r.h.k === aim.k) h++;
    darts.push({ k: r.h.k, x: r.x, y: r.y, lab: botLab(r), bounce: !!r.bounce });
  }
  bobApply(g, h, darts);
}

// ---- Shanghai ----
function shDart(g, mult, extra = {}) {
  const me = g.pl[g.turn], o = g.o;
  me.darts++;
  me.score += mult * g.round;
  g.cur.push({ mult, lab: ringLab(g.round, mult), ...extra });
  if (g.cur.length === 3) {
    const set = new Set(g.cur.map(d => d.mult));
    if (set.has(1) && set.has(2) && set.has(3)) { g.winner = g.turn; g.shanghai = true; }
    // Variants: no hit on the number halves the score; no treble resets it to zero
    else if (o.variant === 'number' && !g.cur.some(d => d.mult)) { me.score = Math.floor(me.score / 2); me.halves++; }
    else if (o.variant === 'treble' && !set.has(3)) { me.score = 0; me.resets++; }
    me.rounds[g.round - 1] = sumOf(g.cur.map(d => d.mult)) * g.round;
    g.log.push({ p: g.turn, round: g.round, darts: g.cur });
    g.cur = [];
    if (g.winner != null) return;
    nextTurn(g);
    if (g.round > o.rounds) { g.round = o.rounds; settleByScore(g, p => p.score); }
  }
}
function shBotVisit(g, st, ctxFor) {
  const prof = E.profileFor(botAvg(st.players[g.turn]));
  const p = g.turn, r0 = g.round, ctx = ctxFor(p), thr = E.startVisit(prof, ctx);
  while (g.winner == null && g.turn === p && g.round === r0) {
    const n = g.round, me = g.pl[p], have = new Set(g.cur.map(d => d.mult).filter(Boolean)), left = 3 - g.cur.length;
    // On the last dart with two different rings in, the missing ring wins the game
    const missing = g.cur.length === 2 && have.size === 2 ? [1, 2, 3].find(m => !have.has(m)) : null;
    // Variants make a hit (or a treble) worth protecting the score
    const guard = g.o.variant === 'number' && !have.size ? me.score / 2 / left : 0;
    const tguard = g.o.variant === 'treble' && !have.has(3) ? (me.score + 9 * n) / left : 0;
    const value = h => {
      if (h.n !== n) return 0;
      const m = RING_MULT[h.ring];
      return m * n + (missing && m === missing ? 500 : 0) + guard + (m === 3 ? tguard : 0);
    };
    const aim = E.bestAim(['T', 'S', 'D'].map(r => E.BY[r + n]), value, prof, ctx);
    const r = thr(aim, aim.ring === 'D');
    const mult = r.h.n === n ? RING_MULT[r.h.ring] : 0;
    shDart(g, mult, { k: r.h.k, x: r.x, y: r.y, lab: botLab(r), bounce: !!r.bounce });
  }
}

// ---- Halve It ----
const HI_SETS = {
  standard: [20, 'D', 19, 'T', 18, 'DIFF', 17, 'X', 16, 'SAME', 15, 'B'],
  classic: [15, 16, 'D', 17, 18, 'T', 19, 20, 'B'],
};
const isExact = t => typeof t === 'string' && t[0] === 'X';
const hiName = x => x === 'D' ? t('Any double') : x === 'T' ? t('Any treble') : x === 'B' ? 'Bull' : x === 'DIFF' ? t('Different colours') : x === 'SAME' ? t('Same colour') : isExact(x) ? t('Exactly {n}', { n: x.slice(1) }) : String(x);
const hiShort = x => isExact(x) ? '= ' + x.slice(1) : x === 'DIFF' ? t('≠ colours') : x === 'SAME' ? t('= colour') : hiName(x);
const hiDartVals = t => t === 'D' ? Array.from({ length: 20 }, (_, i) => 2 * (i + 1)).concat(50)
  : t === 'T' ? Array.from({ length: 20 }, (_, i) => 3 * (i + 1)) : t === 'B' ? [25, 50] : [t, 2 * t, 3 * t];
const hiMemo = {};
function hiPossible(t) {
  if (hiMemo[t]) return hiMemo[t];
  const v = [0, ...hiDartVals(t)], s = new Set();
  for (const a of v) for (const b of v) for (const c of v) s.add(a + b + c);
  return (hiMemo[t] = s);
}
function hiPoints(t, h) {
  if (t === 'D') return h.dbl ? h.v : 0;
  if (t === 'T') return h.ring === 'T' ? h.v : 0;
  if (t === 'B') return h.n === 25 ? h.v : 0;
  return h.n === t ? h.v : 0;
}
// Points for a whole visit on any target (the colour and exact rounds depend on all three darts)
function hiVisitPoints(t, hs) {
  const total = sumOf(hs.map(h => h.v));
  if (t === 'DIFF') { const c = hs.map(colourOf); return c.every(Boolean) && new Set(c).size === 3 ? total : 0; }
  if (t === 'SAME') { const c = hs.map(colourOf); return c.every(Boolean) && new Set(c).size === 1 ? total : 0; }
  if (isExact(t)) return total === +t.slice(1) ? total : 0;
  return sumOf(hs.map(h => hiPoints(t, h)));
}
const hiKeys = t => t === 'D' ? Array.from({ length: 20 }, (_, i) => 'D' + (i + 1)).concat('BULL')
  : t === 'T' ? Array.from({ length: 20 }, (_, i) => 'T' + (i + 1)) : t === 'B' ? ['25', 'BULL']
  : isExact(t) || t === 'DIFF' || t === 'SAME' ? [] : keysFor(t);
// An "exact" target: a random total from 30 to 130 that three darts can make
const exactTarget = () => { let v; do { v = 30 + Math.floor(Math.random() * 101); } while (!E.validVisit(v)); return 'X' + v; };
function hiApply(g, pts, darts) {
  const me = g.pl[g.turn];
  if (pts === 0) { me.score = Math.floor(me.score / 2); me.halves++; } else me.score += pts;
  me.rounds[g.round - 1] = pts;
  g.log.push({ p: g.turn, round: g.round, pts, darts });
  nextTurn(g);
  if (g.round > g.targets.length) { g.round = g.targets.length; settleByScore(g, p => p.score); }
}
function hiBotVisit(g, st, ctxFor) {
  const prof = E.profileFor(botAvg(st.players[g.turn]));
  const ctx = ctxFor(g.turn), thr = E.startVisit(prof, ctx);
  const tg = g.targets[g.round - 1], me = g.pl[g.turn];
  const hs = [], darts = [];
  for (let i = 0; i < 3; i++) {
    let aim;
    if (isExact(tg)) {
      // Plan the exact total like a checkout that has to use every remaining dart
      const left = +tg.slice(1) - sumOf(hs.map(h => h.v));
      const route = left > 0 ? E.bestRoute(left, 3 - i, 'single', null, 3 - i) : null;
      if (left === 0) { hs.push(E.BY.MISS); darts.push({ k: 'MISS', x: 0, y: 190, lab: t('Off the board (on purpose)') }); continue; }
      aim = route ? route[0] : E.BY.T20;
    } else if (tg === 'DIFF' || tg === 'SAME') {
      const used = hs.map(colourOf);
      const value = h => {
        const c = colourOf(h);
        if (!c) return 0;
        const ok = tg === 'DIFF' ? !used.includes(c) : (!used.length || c === used[0]);
        return ok ? 1 + h.v / 200 : 0;
      };
      const cands = i === 0 ? [E.BY.S20, E.BY.S1, E.BY.T20, E.BY.T1, E.BY.BULL] : E.SEGS;
      aim = E.bestAim(cands, value, prof, ctx, 100);
    } else {
      const cands = tg === 'D' ? Array.from({ length: 20 }, (_, k) => E.BY['D' + (k + 1)]).concat(E.BY.BULL)
        : tg === 'T' ? Array.from({ length: 20 }, (_, k) => E.BY['T' + (k + 1)])
        : tg === 'B' ? [E.BY.BULL, E.BY['25']] : [E.BY['T' + tg], E.BY['S' + tg]];
      // Until something scores, avoiding the halving is worth half the current score
      const got = sumOf(hs.map(h => hiPoints(tg, h)));
      const saved = got > 0 ? 0 : me.score / 2 / (3 - i);
      aim = E.bestAim(cands, h => { const v = hiPoints(tg, h); return v + (v > 0 ? saved : 0); }, prof, ctx);
    }
    const r = thr(aim, aim.ring === 'D');
    hs.push(r.h);
    darts.push({ k: r.h.k, x: r.x, y: r.y, lab: botLab(r), bounce: !!r.bounce });
  }
  hiApply(g, hiVisitPoints(tg, hs), darts);
}

// ---- 121 Checkout ----
const C121_SAFE = [['start', 'Back to start'], ['3', 'After a 3-dart checkout'], ['6', 'After a 6-dart checkout'], ['row3', 'After 3 checkouts in a row'], ['row5', 'After 5 checkouts in a row'], ['each', 'After every checkout']];

Object.assign(GAMES, {
  shanghai: {
    title: 'Shanghai', players: [1, 8],
    options: [
      { key: 'rounds', label: 'Numbers', choices: [[7, '1 to 7'], [20, '1 to 20']], def: 7 },
      { key: 'variant', label: 'Variant', choices: [['none', 'Standard'], ['number', 'Require number'], ['treble', 'Require treble']], def: 'none' },
    ],
    rules: 'One number per round, from 1 up. Each dart on the number scores the number times the ring: single ×1, double ×2, treble ×3. A single, a double and a treble of the number in one visit, a Shanghai, wins on the spot. Otherwise the highest total wins. Require number: miss the number with all three darts and your score halves. Require treble: no treble of the number and your score resets to zero.',
    hint: '', keys: 'Keys: 0 miss, 1 single, 2 double, 3 treble · Ctrl+Z undo',
    init: st => ({ o: resolveOpts(st), pl: st.players.map(() => ({ score: 0, darts: 0, rounds: [], halves: 0, resets: 0 })), turn: 0, cur: [], round: 1, winner: null, tied: null, shanghai: false, log: [] }),
    done: g => g.winner != null,
    act(g, a, v) { shDart(g, +v); },
    botVisit: shBotVisit,
    pressure: g => g.round === g.o.rounds,
    hud(g, st) {
      const done = g.winner != null;
      const rule = g.o.variant === 'number' ? ' · ' + t('miss the number and your score halves') : g.o.variant === 'treble' ? ' · ' + t('no treble and your score resets') : '';
      return playersHUD({
        st, g, done, eyebrow: t('Shanghai · round {n} of {of}', { n: g.round, of: g.o.rounds }), target: done ? null : g.round,
        sub: done ? '' : t('Single {s} · double {d} · treble {tr}', { s: g.round, d: 2 * g.round, tr: 3 * g.round }) + rule,
        cells: g.pl.map((p, i) => ({ main: p.score, sub: t('Round {n}: {v}', { n: g.round, v: i === g.turn && !done ? sumOf(g.cur.map(d => d.mult)) * g.round : (p.rounds[g.round - 1] ?? '–') }) })),
      });
    },
    pad(g, st) {
      const dis = isBotTurn(), n = g.round;
      return `<div class="label">${t('{name} to throw', { name: htmlEsc(st.players[g.turn].name) })}</div>${visitChips(g.cur)}
        <div class="gpad">${gb('dart', t('Miss'), { v: 0, hot: '0', dis })}${gb('dart', t('Single'), { v: 1, hot: '1', cls: 'good', small: t('{n} pts', { n }), dis })}${gb('dart', t('Double'), { v: 2, hot: '2', cls: 'good', small: t('{n} pts', { n: 2 * n }), dis })}${gb('dart', t('Treble'), { v: 3, hot: '3', cls: 'good', small: t('{n} pts', { n: 3 * n }), dis })}</div>`;
    },
    board: (g, st) => ({ label: t('Target'), text: String(g.round), keys: g.winner != null ? [] : keysFor(g.round), ...lastBotDarts(g, st) }),
    log(g, st) {
      const head = st.players.map(p => `<th>${htmlEsc(p.name)}</th>`).join('');
      const rows = Array.from({ length: g.o.rounds }, (_, r) => `<tr${r + 1 === g.round && g.winner == null ? ' class="nowrow"' : ''}><td>${r + 1}</td>${g.pl.map(p => `<td>${p.rounds[r] ?? ''}</td>`).join('')}</tr>`).join('');
      return `<section class="panel"><h2>${t('Scores by round')}</h2><div class="sheet-wrap"><table class="sheet tally"><thead><tr><th>${t('Target')}</th>${head}</tr></thead><tbody>${rows}<tr class="tot"><td>${t('Total')}</td>${g.pl.map(p => `<td>${p.score}</td>`).join('')}</tr></tbody></table></div></section>` + visitsTable(g, st);
    },
    result(g, st) {
      if (g.shanghai) return { headline: t('Shanghai on the {n}! Win for {name}', { n: g.round, name: st.players[g.winner].name }), detail: t('Single, double and treble in one visit.'), best: st.players.length === 1 ? g.pl[0].score : null, better: 'max' };
      return scoreResult(g, st, p => p.score, 'points', 'shanghai');
    },
  },

  halveit: {
    title: 'Halve It', players: [1, 8], keypad: true,
    options: [
      { key: 'targets', label: 'Targets', choices: [['standard', 'Standard (12 rounds)'], ['classic', 'Classic (9 rounds)'], ['random', 'Random order']], def: 'standard' },
    ],
    rules: 'Everyone starts on 40 points and every round has a target. Numbers, any double, any treble and the bull score the darts that hit them. Different colours: all three darts in different board colours (black, white, red, green) scores the visit. Same colour: all three in one colour. Exactly: the three darts must total that number. Miss a round and your score is cut in half. The highest score at the end wins.',
    hint: 'Enter what the round scored. 0 halves your score.', keys: 'Keys: Enter to score · Ctrl+Z undo',
    init(st) {
      const o = resolveOpts(st);
      const list = (o.targets === 'classic' ? HI_SETS.classic : o.targets === 'random' ? shuffled(HI_SETS.standard) : HI_SETS.standard).map(t => t === 'X' ? exactTarget() : t);
      return { o, targets: list, pl: st.players.map(() => ({ score: 40, halves: 0, rounds: [] })), turn: 0, round: 1, winner: null, tied: null, log: [] };
    },
    done: g => g.winner != null,
    validate(g, v) {
      const tg = g.targets[g.round - 1];
      if (isExact(tg)) return v === 0 || v === +tg.slice(1) ? null : t('Enter {n} if the three darts made it exactly, or 0.', { n: tg.slice(1) });
      if (tg === 'DIFF' || tg === 'SAME') return E.validVisit(v) ? null : t("{n} can't be scored with three darts.", { n: v });
      // German keeps its nouns capitalised mid-sentence
      return hiPossible(tg).has(v) ? null : t("{n} can't be scored on {target} with three darts.", { n: v, target: LANG === 'de' ? hiName(tg) : hiName(tg).toLowerCase() });
    },
    act(g, a, v) { hiApply(g, +v, null); },
    botVisit: hiBotVisit,
    pressure: g => g.round >= g.targets.length - 1,
    hud(g, st) {
      const done = g.winner != null, tg = g.targets[g.round - 1];
      const how = tg === 'DIFF' ? t('Score the visit if all three darts land in different colours')
        : tg === 'SAME' ? t('Score the visit if all three darts land in the same colour')
        : isExact(tg) ? t('The three darts must total {n} exactly', { n: tg.slice(1) }) : t('Miss it with all three and your score halves');
      return playersHUD({
        st, g, done, eyebrow: t('Halve It · round {n} of {of}', { n: g.round, of: g.targets.length }), target: done ? null : hiName(tg),
        sub: done ? '' : how,
        cells: g.pl.map(p => ({ main: p.score, sub: p.halves ? t('Halved {n}×', { n: p.halves }) : t('Never halved') })),
      });
    },
    pad(g) {
      const tg = g.targets[g.round - 1];
      const chips = isExact(tg) ? [[0, t('Missed: halve'), 'zero wide'], [+tg.slice(1), t('Made {n}', { n: tg.slice(1) }), 'co wide']] : [[0, t('Missed: halve'), 'zero wide']];
      return keypadHTML({ dis: isBotTurn(), chips, aim: hiShort(tg), aimLabel: 'Target' });
    },
    board(g, st) {
      const tg = g.targets[g.round - 1];
      return { label: t('Target'), text: g.winner != null ? '' : hiName(tg), keys: g.winner != null ? [] : hiKeys(tg), ...lastBotDarts(g, st) };
    },
    log(g, st) {
      const head = st.players.map(p => `<th>${htmlEsc(p.name)}</th>`).join('');
      const rows = g.targets.map((tg, r) => `<tr${r + 1 === g.round && g.winner == null ? ' class="nowrow"' : ''}><td>${hiName(tg)}</td>${g.pl.map(p => `<td class="${p.rounds[r] === 0 ? 'bust' : ''}">${p.rounds[r] == null ? '' : p.rounds[r] === 0 ? '½' : p.rounds[r]}</td>`).join('')}</tr>`).join('');
      return `<section class="panel"><h2>${t('Points by target')}</h2><div class="sheet-wrap"><table class="sheet tally"><thead><tr><th>${t('Target')}</th>${head}</tr></thead><tbody>${rows}<tr class="tot"><td>${t('Score')}</td>${g.pl.map(p => `<td>${p.score}</td>`).join('')}</tr></tbody></table></div></section>`;
    },
    result: (g, st) => scoreResult(g, st, p => p.score, 'points', 'halveit'),
  },

  c121: {
    title: '121 Checkout', keypad: true,
    options: [
      { key: 'start', label: 'Start target', choices: [[61, '61'], [81, '81'], [101, '101'], [121, '121'], [141, '141']], def: 121 },
      { key: 'darts', label: 'Darts per attempt', choices: [[3, '3'], [6, '6'], [9, '9'], [12, '12'], [15, '15']], def: 9 },
      { key: 'step', label: 'After a checkout', choices: [[1, '+1'], [5, '+5'], [10, '+10']], def: 1 },
      { key: 'safe', label: 'Safehouse', choices: C121_SAFE, def: '3' },
      { key: 'rounds', label: 'Rounds', choices: [[10, '10'], [25, '25'], [0, 'Unlimited']], def: 10 },
    ],
    rules: 'Check out the target on a double within the darts allowed. Make it and the next target goes up. Miss it and you drop back to your safehouse: the last target you protected, or the start. When a score gets protected depends on the safehouse setting; by default, checking out in one visit protects it. Your highest checkout is the score.',
    hint: 'Enter each visit total. A bust counts as no score.', keys: 'Keys: Enter to score · Ctrl+Z undo',
    init(st) {
      const o = resolveOpts(st);
      return { o, target: o.start, rem: o.start, visit: 0, results: [], high: 0, safe: o.start, streak: 0, ended: false };
    },
    done: g => g.ended || (g.o.rounds > 0 && g.results.length >= g.o.rounds),
    validate(g, v) {
      if (!E.validVisit(v)) return v > 180 ? t('The most three darts can score is 180.') : t("{n} can't be scored with three darts.", { n: v });
      if (v === g.rem && E.minDarts(g.rem, 'double') > 3) return t("{n} can't be checked out on a double in three darts.", { n: g.rem });
      return null;
    },
    act(g, a, v) {
      if (a === 'end') { g.ended = true; return; }
      const s = +v, o = g.o, maxVisits = o.darts / 3;
      if (!(s > g.rem || g.rem - s === 1)) g.rem -= s;
      let ok = null;
      const visits = g.visit + 1;
      if (g.rem === 0) ok = true; else if (++g.visit >= maxVisits) ok = false;
      if (ok == null) return;
      g.results.push({ t: g.target, ok, visits: ok ? visits : maxVisits });
      if (ok) {
        g.high = Math.max(g.high, g.target);
        g.streak++;
        const protect = { start: false, 3: visits <= 1, 6: visits <= 2, row3: g.streak >= 3, row5: g.streak >= 5, each: true }[o.safe];
        if (protect) g.safe = g.target;
        g.target += o.step;
      } else {
        g.streak = 0;
        g.target = o.safe === 'start' ? o.start : g.safe;
      }
      g.rem = g.target; g.visit = 0;
    },
    hud(g) {
      const done = GAMES.c121.done(g), ok = g.results.filter(r => r.ok).length, o = g.o;
      return hudHTML({
        eyebrow: t(o.rounds ? '121 Checkout · attempt {n} of {of} · target {tg}' : '121 Checkout · attempt {n} · target {tg}', { n: g.results.length + (done ? 0 : 1), of: o.rounds, tg: g.target }),
        target: done ? (g.high || '–') : g.rem,
        sub: done ? t('Highest checkout') : t('Visit {n} of {of} · {d} darts left · safehouse {s}', { n: g.visit + 1, of: o.darts / 3, d: o.darts - g.visit * 3, s: g.safe }),
        stats: [[t('Checked out'), `${ok}/${g.results.length}`], [t('Highest'), g.high || '–'], [t('Best'), getBest(g.bk) ?? '–']],
      });
    },
    pad(g) {
      const route = E.bestRoute(g.rem, 3, 'double');
      return keypadHTML({ chips: [[0, t('No score'), 'zero'], ...(route ? [[g.rem, t('Checkout {n}', { n: g.rem }), 'co wide']] : [])], aim: route ? route.map(E.label).join(' ') : t('Set up a finish'), aimLabel: 'Route' }) + (g.o.rounds ? '' : endBtn());
    },
    board(g) {
      const route = GAMES.c121.done(g) ? null : E.bestRoute(g.rem, 3, 'double');
      return { label: route ? t('Checkout route') : t('{n} left', { n: g.rem }), text: route ? route.map(E.label).join('  ') : '', keys: route ? route.map(s => s.k) : ['T20'] };
    },
    log: g => {
      const n = g.o.rounds || Math.max(10, g.results.length + 1);
      return `<section class="panel"><h2>${t('Attempts')}</h2>${cellsHTML(Array.from({ length: n }, (_, i) => { const r = g.results[i]; return { h: r ? r.t : i === g.results.length ? g.target : '', v: r ? (r.ok ? '✓' : '✕') : '', cls: r ? (r.ok ? 'ok' : 'bad') : '' }; }), g.results.length)}</section>`;
    },
    result: g => ({ headline: g.high ? t('Highest checkout: {n}', { n: g.high }) : t('No checkouts this time'), detail: t('{n} of {of} attempts checked out.', { n: g.results.filter(r => r.ok).length, of: g.results.length }), best: g.high || null, better: 'max' }),
  },

  atc: {
    title: 'Around the Clock', players: [1, 8],
    options: [
      { key: 'segments', label: 'What counts', choices: [['any', 'Any segment'], ['singles', 'Singles only'], ['doubles', 'Doubles only'], ['trebles', 'Trebles only']], def: 'any' },
      { key: 'hits', label: 'Hits per target', choices: [[1, '1'], [2, '2'], [3, '3']], def: 1 },
      { key: 'bull', label: 'Bull', choices: [['either', 'Either bull'], ['outer', 'Outer bull'], ['bullseye', 'Bullseye']], def: 'either' },
      { key: 'skip', label: 'Doubles and trebles skip ahead', choices: [['off', 'Off'], ['on', 'On, last target must be hit'], ['past', 'On, can skip past the end']], def: 'off' },
      { ...ORDER_OPT, best: true },
    ],
    rules: 'Hit every number from 1 to 20 and then the bull, in the chosen order. The settings decide which segments count, how many hits each target needs, which bull counts, and whether a double or treble moves you two or three targets on. A skip stops on the last target unless the setting lets it carry past the end, so a treble 20 can finish the game. A skip completes the target whatever the hits setting. With other players, the first one round the board wins. Fewer darts is better.',
    hint: '', keys: 'Keys: 0 miss, 1 single, 2 double, 3 treble · Ctrl+Z undo',
    init(st) {
      const o = resolveOpts(st);
      return { o, targets: ordered(T21, o.order), pl: st.players.map(() => ({ i: 0, hits: 0, darts: 0, per: Array(21).fill(0) })), turn: 0, cur: [], round: 1, winner: null, log: [] };
    },
    done: g => g.winner != null,
    act(g, a, v) { atcDart(g, +v); },
    botVisit: atcBotVisit,
    pressure: (g, p) => g.pl.some((x, i) => i !== p && x.i >= 18),
    hud(g, st) {
      const me = g.pl[g.turn], done = g.winner != null, o = g.o;
      const rule = (o.segments === 'any' ? '' : t(o.segments + ' only') + ' · ') + (o.hits > 1 ? t('{a}/{b} hits', { a: me.hits, b: o.hits }) + ' · ' : '');
      return playersHUD({
        st, g, done, eyebrow: t('Around the Clock · target {n} of {of}', { n: Math.min(me.i + 1, 21), of: 21 }),
        target: done ? null : tName(g.targets[me.i]),
        sub: done ? '' : rule + t('Dart {n} of this visit', { n: g.cur.length + 1 }),
        cells: g.pl.map(p => ({ main: p.i >= 21 ? t('Done') : tName(g.targets[p.i]), sub: t('{n} darts · {p} hit', { n: p.darts, p: pctOf(Math.min(p.i, p.darts), p.darts) }) })),
      });
    },
    pad(g, st) {
      const dis = isBotTurn(), n = g.targets[g.pl[g.turn].i], o = g.o;
      const btn = (m, label) => gb('dart', label, { v: m, hot: String(m), dis, cls: atcCounts(o, n, m) ? 'good' : '' });
      const btns = n === 25 ? btn(0, t('Miss')) + btn(1, '25') + btn(2, 'Bull') : btn(0, t('Miss')) + btn(1, t('Single')) + btn(2, t('Double')) + btn(3, t('Treble'));
      return `<div class="label">${t('{name} to throw', { name: htmlEsc(st.players[g.turn].name) })}</div>${visitChips(g.cur)}<div class="gpad" style="--cols:${n === 25 ? 3 : 4}">${btns}</div>`;
    },
    board(g, st) {
      if (g.winner != null) return { label: t('Finished'), text: '', keys: [], ...lastBotDarts(g, st) };
      const n = g.targets[g.pl[g.turn].i], o = g.o;
      const keys = n === 25 ? (o.bull === 'outer' ? ['25'] : o.bull === 'bullseye' ? ['BULL'] : ['25', 'BULL'])
        : o.segments === 'any' ? keysFor(n) : [{ singles: 'S', doubles: 'D', trebles: 'T' }[o.segments] + n];
      return { label: t('Target'), text: tName(n), keys, ...lastBotDarts(g, st) };
    },
    log(g, st) {
      const p = st.players.length > 1 ? g.turn : 0, me = g.pl[p];
      const cells = cellsHTML(g.targets.map((n, i) => ({ h: tName(n), v: i < me.i ? me.per[i] : i === me.i && me.per[i] ? me.per[i] : '', cls: i < me.i ? (me.per[i] === 1 ? 'ok' : '') : '' })), me.i);
      return `<section class="panel"><h2>${t('Darts per target')}${st.players.length > 1 ? ` · ${htmlEsc(st.players[p].name)}` : ''}</h2>${cells}</section>` + (st.players.length > 1 ? visitsTable(g, st) : '');
    },
    result(g, st) {
      const w = g.pl[g.winner], name = st.players[g.winner].name;
      if (st.players.length === 1) return { headline: t('Round the board in {n} darts', { n: w.darts }), detail: t('Hit rate {p}.', { p: pctOf(Math.min(21, w.darts), w.darts) }), best: w.darts, better: 'min' };
      return { headline: t('First round the board: {name}', { name }), detail: t('{n} darts.', { n: w.darts }), best: null };
    },
  },

  bobs27: {
    title: "Bob's 27", players: [1, 8],
    options: [{ key: 'mode', label: 'Below zero', choices: [['hard', 'Game over (hard)'], ['easy', 'Keep playing (easy)']], def: 'hard' }],
    rules: "Start on 27 points. Three darts at each double from D1 to D20, then the bull. Every hit adds the double's value; if all three miss, you lose the double's value instead. In hard mode, dropping below zero ends your game; in easy mode you play on. The maximum is 1437. With other players, the highest score wins.",
    hint: '', keys: 'Keys: 0 to 3 for the doubles hit · Ctrl+Z undo',
    init: st => ({ o: resolveOpts(st), pl: st.players.map(() => ({ r: 0, score: 27, hits: [], dead: false })), turn: 0, round: 1, winner: null, tied: null, log: [] }),
    done: g => g.winner != null,
    act(g, a, v) { bobApply(g, +v); },
    botVisit: bobBotVisit,
    pressure: (g, p) => g.pl[p].score < 2 * (T21[g.pl[p].r] === 25 ? 25 : T21[g.pl[p].r]),
    hud(g, st) {
      const done = g.winner != null, me = g.pl[g.turn], n = T21[Math.min(me.r, 20)], val = n === 25 ? 50 : 2 * n;
      return playersHUD({
        st, g, done, eyebrow: t("Bob's 27 · {d} · round {n} of {of}", { d: dName(n), n: Math.min(me.r + 1, 21), of: 21 }),
        target: done ? null : dName(n), sub: done ? '' : t('Each hit +{v} · three misses −{v}', { v: val }) + (g.o.mode === 'easy' ? ' · ' + t('easy mode') : ''),
        cells: g.pl.map(p => ({ main: p.score, sub: p.dead ? t('Out on {d}', { d: dName(T21[p.r - 1]) }) : p.r >= 21 ? t('Finished') : t('On {d}', { d: dName(T21[p.r]) }), out: p.dead })),
      });
    },
    pad: g => isBotTurn() ? `<div class="label">${t('Bot throwing…')}</div>` : hitsPad(),
    board(g, st) {
      if (g.winner != null) return { label: t('Finished'), text: '', keys: [] };
      const n = T21[g.pl[g.turn].r];
      return { label: t('Target'), text: dName(n), keys: keysFor(n, ['D']), ...lastBotDarts(g, st) };
    },
    log(g, st) {
      const p = st.players.length > 1 ? g.turn : 0, me = g.pl[p];
      return `<section class="panel"><h2>${t('Hits per double')}${st.players.length > 1 ? ` · ${htmlEsc(st.players[p].name)}` : ''}</h2>${cellsHTML(T21.map((n, i) => ({ h: dName(n), v: i < me.hits.length ? me.hits[i] : '', cls: i < me.hits.length ? (me.hits[i] ? 'ok' : 'bad') : '' })), me.dead ? -1 : me.r)}</section>`;
    },
    result(g, st) {
      if (st.players.length > 1) return scoreResult(g, st, p => p.score, 'points', 'bobs27');
      const me = g.pl[0], hits = sumOf(me.hits);
      return me.dead
        ? { headline: t('Out on {d}', { d: dName(T21[me.r - 1]) }), detail: t('Your score dropped to {n}. You hit {h} of {of} doubles.', { n: me.score, h: hits, of: me.hits.length * 3 }), best: null }
        : { headline: t("Bob's 27: {n} points", { n: me.score }), detail: t('You hit {h} of 63 doubles ({p}).', { h: hits, p: pctOf(hits, 63) }), best: me.score, better: 'max' };
    },
  },

  singles: {
    title: 'Singles Training',
    options: [ORDER_OPT],
    rules: 'Three darts at each number from 1 to 20 and the bull, in the chosen order. A single scores 1 point, a double 2 and a treble 3. On the bull, the outer 25 scores 1 and the bullseye 2. The maximum is 186.',
    hint: '', keys: 'Keys: 0 miss, 1 single, 2 double, 3 treble · Ctrl+Z undo',
    init: st => { const o = resolveOpts(st); return { o, targets: ordered(T21, o.order), i: 0, cur: [], rows: [] }; },
    done: g => g.i >= 21,
    act(g, a, v) { g.cur.push(+v); if (g.cur.length === 3) { g.rows.push(g.cur); g.cur = []; g.i++; } },
    hud(g) {
      const pts = sumOf(g.rows.flat()) + sumOf(g.cur), darts = g.rows.length * 3 + g.cur.length;
      const hits = g.rows.flat().concat(g.cur).filter(x => x > 0).length;
      return hudHTML({
        eyebrow: t('Singles Training · number {n} of {of}', { n: Math.min(g.i + 1, 21), of: 21 }), target: g.i >= 21 ? pts : tName(g.targets[g.i]),
        sub: g.i >= 21 ? t('Points scored') : t('Dart {n} of 3', { n: g.cur.length + 1 }) + (g.cur.length ? ' · ' + t('so far {list}', { list: g.cur.join(', ') }) : ''),
        stats: [[t('Points'), pts], [t('Hit rate'), pctOf(hits, darts)], [t('Best'), getBest(g.bk) ?? '–']],
      });
    },
    pad: g => g.targets[g.i] === 25
      ? `<div class="gpad" style="--cols:3">${gb('dart', t('Miss'), { v: 0, hot: '0' })}${gb('dart', '25', { v: 1, hot: '1', cls: 'good', small: t('{n} pt', { n: 1 }) })}${gb('dart', 'Bull', { v: 2, hot: '2', cls: 'good', small: t('{n} pts', { n: 2 }) })}</div>`
      : `<div class="gpad">${gb('dart', t('Miss'), { v: 0, hot: '0' })}${gb('dart', t('Single'), { v: 1, hot: '1', cls: 'good', small: t('{n} pt', { n: 1 }) })}${gb('dart', t('Double'), { v: 2, hot: '2', cls: 'good', small: t('{n} pts', { n: 2 }) })}${gb('dart', t('Treble'), { v: 3, hot: '3', cls: 'good', small: t('{n} pts', { n: 3 }) })}</div>`,
    board: g => g.i >= 21 ? { label: t('Finished'), text: '', keys: [] } : { label: t('Target'), text: tName(g.targets[g.i]), keys: keysFor(g.targets[g.i]) },
    log: g => `<section class="panel"><h2>${t('Points per number')}</h2>${cellsHTML(g.targets.map((n, i) => ({ h: tName(n), v: i < g.rows.length ? sumOf(g.rows[i]) : '', cls: i < g.rows.length ? (sumOf(g.rows[i]) ? 'ok' : 'bad') : '' })), g.i)}</section>`,
    result: g => { const p = sumOf(g.rows.flat()); return { headline: t('Singles Training: {n} points', { n: p }), detail: t('Out of a possible 186.'), best: p, better: 'max' }; },
  },

  doubles: {
    title: 'Doubles Training',
    options: [
      { key: 'mode', label: 'Format', choices: [['hit', 'Until you hit it'], ['three', 'Three darts each']], def: 'hit' },
      { key: 'bull', label: 'Finish on the bull', choices: [['on', 'Yes'], ['off', 'No']], def: 'on' },
      ORDER_OPT,
    ],
    rules: 'Work through the doubles in the chosen order. Until you hit it: stay on each double until you hit it, and finish in as few darts as you can. Three darts each: throw three darts at every double and count the hits, out of 63 (60 without the bull).',
    hint: '', keys: 'Keys: H hit, M miss (0 to 3 hits in three-dart mode) · Ctrl+Z undo',
    init(st) {
      const o = resolveOpts(st);
      const list = ordered(o.bull === 'on' ? T21 : T21.slice(0, 20), o.order);
      return { o, targets: list, i: 0, hits: [], per: Array(list.length).fill(0), darts: 0 };
    },
    done: g => g.i >= g.targets.length,
    act(g, a, v) {
      if (g.o.mode === 'three') { g.hits.push(+v); g.darts += 3; g.i++; return; }
      g.darts++; g.per[g.i]++;
      if (a === 'hit') g.i++;
    },
    hud(g) {
      const N = g.targets.length, done = g.i >= N, three = g.o.mode === 'three';
      const hits = three ? sumOf(g.hits) : g.i;
      return hudHTML({
        eyebrow: t('Doubles Training · double {n} of {of}', { n: Math.min(g.i + 1, N), of: N }), target: done ? (three ? hits : g.darts) : dName(g.targets[g.i]),
        sub: done ? t(three ? 'Doubles hit' : 'Darts used') : three ? t('Throw three darts, then record the hits') : t('{n} darts on this double so far', { n: g.per[g.i] }),
        stats: three ? [[t('Hits'), `${hits}/${g.i * 3}`], [t('Hit rate'), pctOf(hits, g.i * 3)], [t('Best'), getBest(g.bk) ?? '–']]
          : [[t('Darts'), g.darts], [t('Hit rate'), pctOf(g.i, g.darts)], [t('Best'), getBest(g.bk) ?? '–']],
      });
    },
    pad: g => g.o.mode === 'three' ? hitsPad() : `<div class="gpad" style="--cols:2">${gb('hit', t('Hit'), { hot: 'h', cls: 'good' })}${gb('miss', t('Miss'), { hot: 'm' })}</div>`,
    board: g => g.i >= g.targets.length ? { label: t('Finished'), text: '', keys: [] } : { label: t('Target'), text: dName(g.targets[g.i]), keys: keysFor(g.targets[g.i], ['D']) },
    log: g => {
      const three = g.o.mode === 'three';
      return `<section class="panel"><h2>${t(three ? 'Hits per double' : 'Darts per double')}</h2>${cellsHTML(g.targets.map((n, i) => ({ h: dName(n), v: i < g.i ? (three ? g.hits[i] : g.per[i]) : i === g.i && !three && g.per[i] ? g.per[i] : '', cls: i < g.i ? (three ? (g.hits[i] ? 'ok' : 'bad') : g.per[i] === 1 ? 'ok' : '') : '' })), g.i)}</section>`;
    },
    result: g => {
      const N = g.targets.length;
      return g.o.mode === 'three'
        ? { headline: t('{n} of {of} doubles', { n: sumOf(g.hits), of: N * 3 }), detail: t('A hit rate of {p}.', { p: pctOf(sumOf(g.hits), N * 3) }), best: sumOf(g.hits), better: 'max' }
        : { headline: t('All {n} doubles in {d} darts', { n: N, d: g.darts }), detail: t('A hit rate of {p}.', { p: pctOf(N, g.darts) }), best: g.darts, better: 'min' };
    },
  },

  score: {
    title: 'Score Training', keypad: true,
    options: [{ key: 'rounds', label: 'Length', choices: [[10, '10 visits'], [20, '20 visits'], [33, '33 visits (99 darts)'], [0, 'Unlimited']], def: 10 }],
    rules: 'Score as much as you can, three darts a visit. Aim wherever you like; the treble 20 is the usual target. Pick a fixed number of visits to compare sessions, or play unlimited and finish when you want.',
    hint: 'Enter each visit total.', keys: 'Keys: Enter to score · Ctrl+Z undo',
    init: st => ({ o: resolveOpts(st), visits: [], ended: false }),
    done: g => g.ended || (g.o.rounds > 0 && g.visits.length >= g.o.rounds),
    act(g, a, v) { if (a === 'end') g.ended = true; else g.visits.push(+v); },
    hud(g) {
      const tot = sumOf(g.visits), avg = g.visits.length ? tot / g.visits.length : null, R = g.o.rounds;
      const c = t => g.visits.filter(v => v >= t).length;
      return hudHTML({
        eyebrow: GAMES.score.done(g) ? t('Score Training · {n} visits', { n: g.visits.length }) : t(R ? 'Score Training · visit {n} of {of}' : 'Score Training · visit {n}', { n: g.visits.length + 1, of: R }), target: avg == null ? '0.0' : avg.toFixed(1),
        sub: `${t('3-dart average')} · ${R ? t('{n} darts left', { n: (R - g.visits.length) * 3 }) + ' · ' : ''}${t('{n} scored', { n: tot })}`,
        stats: [['100–139', c(100) - c(140)], ['140–179', c(140) - c(180)], [t('180s'), c(180)], [t('Best avg'), getBest(g.bk) ?? '–']],
      });
    },
    pad: g => keypadHTML({ chips: [[0, t('No score'), 'zero'], ...[26, 41, 45, 60, 81, 85, 100, 140, 180].map(q => [q, q])], aim: 'T20' }) + (g.o.rounds ? '' : endBtn()),
    board: () => ({ label: t('Suggested target'), text: 'T20', keys: ['T20'] }),
    log: g => { const R = g.o.rounds || Math.max(10, g.visits.length + 1); return `<section class="panel"><h2>${t('Visits')}</h2>${cellsHTML(Array.from({ length: R }, (_, i) => ({ h: (i + 1) * 3, v: g.visits[i] ?? '', cls: g.visits[i] >= 100 ? 'ok' : '' })), g.visits.length)}</section>`; },
    result: g => {
      const n = g.visits.length;
      if (!n) return { headline: t('No visits thrown'), detail: '', best: null };
      const avg = sumOf(g.visits) / n;
      return { headline: t('Average {n}', { n: avg.toFixed(2) }), detail: t('{p} points from {d} darts. Best visit {b}.', { p: sumOf(g.visits), d: n * 3, b: Math.max(...g.visits) }), best: g.o.rounds ? +avg.toFixed(2) : null, better: 'max' };
    },
  },
});

// ---- Replaying a bot visit after an undo: the same darts land again, under the game's rules ----
const segOf = d => d.bounce ? E.BY.MISS : (E.BY[d.k] || E.BY.MISS);
const extraOf = d => ({ k: d.k, x: d.x, y: d.y, lab: d.lab, bounce: d.bounce });
GAMES.cricket.replayVisit = (g, st, darts) => {
  const p = g.turn;
  for (const d of darts) {
    if (g.winner != null || g.turn !== p) break;
    const h = segOf(d), mult = CR.includes(h.n) ? { S: 1, D: 2, T: 3, SB: 1, DB: 2 }[h.ring] : 0;
    crDart(g, mult ? h.n : 0, mult, extraOf(d));
  }
};
GAMES.killer.replayVisit = (g, st, darts) => {
  const p = g.turn;
  for (const d of darts) {
    if (g.winner != null || g.turn !== p) break;
    const h = segOf(d);
    kiDart(g, h.ring === 'D' ? h.n : 0, extraOf(d));
  }
};
GAMES.shanghai.replayVisit = (g, st, darts) => {
  const p = g.turn, r0 = g.round;
  for (const d of darts) {
    if (g.winner != null || g.turn !== p || g.round !== r0) break;
    const h = segOf(d);
    shDart(g, h.n === g.round ? RING_MULT[h.ring] || 0 : 0, extraOf(d));
  }
};
GAMES.halveit.replayVisit = (g, st, darts) => hiApply(g, hiVisitPoints(g.targets[g.round - 1], darts.map(segOf)), darts);
GAMES.atc.replayVisit = (g, st, darts) => {
  const p = g.turn;
  for (const d of darts) {
    if (g.winner != null || g.turn !== p) break;
    const h = segOf(d), n = g.targets[g.pl[p].i];
    atcDart(g, h.n === n ? multOf(h) : 0, extraOf(d));
  }
};
GAMES.bobs27.replayVisit = (g, st, darts) => {
  const n = T21[g.pl[g.turn].r], aim = n === 25 ? 'BULL' : 'D' + n;
  bobApply(g, darts.filter(d => !d.bounce && d.k === aim).length, darts);
};

// Player counts per game: [min, max]
const PLAYER_LIMITS = { x01: [1, 8], cricket: [2, 2], killer: [2, 8], shanghai: [1, 8], halveit: [1, 8], atc: [1, 8], bobs27: [1, 8] };
const limitsFor = mode => PLAYER_LIMITS[mode] || [1, 1];
const MENU = [
  ['Matches', [
    ['x01', 'X01', '301, 501 or 701 down to zero, finishing on a double. Checkout routes shown for every finish.'],
    ['cricket', 'Cricket', 'Close 15 to 20 and the bull, and score on numbers your opponent has left open.'],
    ['killer', 'Killer', 'Hit your own double to become a killer, then take lives from everyone else.'],
    ['shanghai', 'Shanghai', 'Seven rounds, 1 to 7. A single, double and treble in one visit wins outright.'],
    ['halveit', 'Halve It', 'A new target every round. Miss it with all three darts and your score halves.'],
  ]],
  ['Practice', [
    ['c121', '121 Checkout', 'Nine darts to check out. Make it and the target goes up, miss and it drops.'],
    ['atc', 'Around the Clock', 'Hit 1 to 20 in order, then the bull, in as few darts as you can.'],
    ['bobs27', "Bob's 27", 'Three darts at every double. Hits add points, three misses take them away.'],
    ['doubles', 'Doubles Training', 'Every double from D1 to the bull: stay on each until you hit it, or three darts each.'],
    ['singles', 'Singles Training', 'Three darts at each number, scoring by ring. Out of 186.'],
    ['score', 'Score Training', 'Three darts a visit at the treble 20. Keep your average as high as you can.'],
  ]],
];
