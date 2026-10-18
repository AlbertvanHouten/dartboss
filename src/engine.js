// ===== Darts engine: board geometry, checkout routes, bot throwing, stats =====
const E = (() => {
  const ORDER = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];
  const SEGS = [], BY = {};
  for (let n = 1; n <= 20; n++) {
    for (const [ring, m] of [['S', 1], ['D', 2], ['T', 3]]) {
      const s = { k: ring + n, n, ring, v: n * m, dbl: ring === 'D' };
      SEGS.push(s); BY[s.k] = s;
    }
  }
  BY['25'] = { k: '25', n: 25, ring: 'SB', v: 25, dbl: false };
  BY.BULL = { k: 'BULL', n: 25, ring: 'DB', v: 50, dbl: true };
  SEGS.push(BY['25'], BY.BULL);
  const MISS = { k: 'MISS', n: 0, ring: 'X', v: 0, dbl: false };
  BY.MISS = MISS;

  // Board dimensions in mm (regulation board)
  const R = { bull: 6.35, outerBull: 15.9, trebleIn: 99, trebleOut: 107, doubleIn: 162, doubleOut: 170 };

  const IMPOSSIBLE = new Set([163, 166, 169, 172, 173, 175, 176, 178, 179]);
  const validVisit = s => Number.isInteger(s) && s >= 0 && s <= 180 && !IMPOSSIBLE.has(s);
  const label = s => s.k === 'BULL' ? 'Bull' : s.k === 'MISS' ? 'Miss' : s.k;

  // Route preferences: favourite doubles first, big trebles for set-up, singles are big targets
  const DBL_COST = { 16: 0, 20: 0.05, 8: 0.2, 18: 0.3, 12: 0.35, 10: 0.45, 14: 0.5, 4: 0.55, 6: 0.6, 2: 0.7, 1: 1.3 };
  const TRE_COST = { 20: 0, 19: 0.1, 18: 0.2, 17: 0.3, 16: 0.35 };
  // Which darts can finish a leg: anything (single out), a double (double out), or a double or treble (master out)
  const isFinisher = (s, out) => out === 'single' || s.dbl || (out === 'master' && s.ring === 'T');
  function finishCost(s, out, style) {
    if (out !== 'single') {
      if (!isFinisher(s, out)) return null;
      if (style && s.k === 'BULL' && style.bullShy) return 2.5;
      if (style && s.n === style.fav && s.ring === 'D') return -0.1;
      if (s.ring === 'T') return 0.15 + (TRE_COST[s.n] ?? 0.6);
      return s.k === 'BULL' ? 1.0 : (DBL_COST[s.n] ?? 0.8);
    }
    return s.ring === 'S' ? 0 : s.ring === 'T' ? 0.3 : s.ring === 'D' ? 0.5 : s.k === 'BULL' ? 0.9 : 0.6;
  }
  function setupCost(s, style) {
    if (style && style.bullShy && (s.k === '25' || s.k === 'BULL')) return 1.6;
    if (s.ring === 'T') return TRE_COST[s.n] ?? 0.6;
    if (s.ring === 'S') return 0.15 + (s.n < 5 ? 0.05 : 0);
    if (s.k === '25') return 0.5;
    if (s.k === 'BULL') return 0.9;
    return 1.5;
  }

  const memo = new Map();
  function exactRoute(r, n, out, style) {
    let best = null, bc = Infinity;
    const rec = (rem, left, path, cost) => {
      if (cost >= bc) return;
      if (left === 1) {
        for (const s of SEGS) if (s.v === rem) {
          const fc = finishCost(s, out, style);
          if (fc != null && cost + fc < bc) { bc = cost + fc; best = [...path, s]; }
        }
        return;
      }
      for (const s of SEGS) {
        if (s.v >= rem) continue;
        const nx = rem - s.v;
        if (out !== 'single' && nx < 2) continue;
        rec(nx, left - 1, [...path, s], cost + setupCost(s, style));
      }
    };
    rec(r, n, [], 0);
    return best;
  }
  // Fewest darts first, then the most comfortable route
  // style (optional): a player's habits, { fav: favourite double, bullShy: avoids the bull }
  function bestRoute(r, darts = 3, out = 'double', style = null, minLen = 1) {
    if (r <= 0 || r > 180) return null;
    if (out === 'double' && r > 170) return null;
    const key = r + '|' + darts + '|' + out + '|' + (style ? style.fav + (style.bullShy ? 'b' : '') : '') + '|' + minLen;
    if (memo.has(key)) return memo.get(key);
    let res = null;
    for (let n = minLen; n <= darts && !res; n++) res = exactRoute(r, n, out, style);
    if (res && res.length > 2) res = [...res.slice(0, -1).sort((a, b) => setupCost(a, style) - setupCost(b, style)), res[res.length - 1]];
    memo.set(key, res);
    return res;
  }
  const minDarts = (r, out, style = null) => { const rt = bestRoute(r, 3, out, style); return rt ? rt.length : Infinity; };

  // ---- Bot ----
  function aimPoint(s) {
    if (s.k === 'BULL') return [0, 0];
    if (s.k === '25') return [0, 11];
    const t = ORDER.indexOf(s.n) * 18 * Math.PI / 180;
    const r = { T: 103, D: 166, S: 134 }[s.ring];
    return [r * Math.sin(t), r * Math.cos(t)];
  }
  function hitAt(x, y) {
    const r = Math.hypot(x, y);
    if (r <= R.bull) return BY.BULL;
    if (r <= R.outerBull) return BY['25'];
    if (r > R.doubleOut) return MISS;
    const deg = (Math.atan2(x, y) * 180 / Math.PI + 369) % 360;
    const n = ORDER[Math.floor(deg / 18) % 20];
    const ring = r >= R.doubleIn ? 'D' : (r >= R.trebleIn && r <= R.trebleOut) ? 'T' : 'S';
    return BY[ring + n];
  }
  const BOGEY = new Set([169, 168, 166, 165, 163, 162, 159]);
  const GOOD_LEAVES = [32, 40, 36, 16, 24, 20, 8, 12, 28, 18, 10, 4];
  const SETUP_CANDIDATES = [...Array.from({ length: 20 }, (_, i) => BY['S' + (i + 1)]), BY['25'], BY.T20, BY.T19, BY.T18, BY.T17, BY.T16];
  function gauss() {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  // ---- How the bot thinks ----
  // Every bot gets habits for the match, as real players have: a favourite double (most go for
  // 16 or 20), a scoring bed (a few are "19 shooters"), and weaker players shy away from the bull.
  // "form" carries over from visit to visit, so bots have hot and cold patches.
  function makePersona(avg) {
    const r = Math.random();
    const fav = r < 0.4 ? 16 : r < 0.75 ? 20 : r < 0.85 ? 8 : r < 0.93 ? 18 : 12;
    return { avg, fav, bed: Math.random() < 0.12 ? 19 : 20, bullShy: avg < 70, form: 0, pressure: 1 };
  }
  const styleOf = ctx => ctx ? { fav: ctx.fav, bullShy: ctx.bullShy } : null;

  // With no finish on, pick the dart that leaves the best next visit: fewest darts to finish, then a
  // favourite leave. Trebles count against weaker players, who prefer the big single.
  function setupDart(rem, out, ctx) {
    const fav = ctx?.fav ?? 16, avg = ctx?.avg ?? 70, style = styleOf(ctx);
    const leaves = [2 * fav, ...GOOD_LEAVES.filter(l => l !== 2 * fav)];
    const trebleCost = avg >= 80 ? 1 : avg >= 55 ? 5 : 20;
    let best = BY.T20, bs = Infinity;
    for (const s of SETUP_CANDIDATES) {
      const leave = rem - s.v;
      if (leave < 2) continue;
      const md = minDarts(leave, out, style);
      const rank = leaves.indexOf(leave);
      const sc = (md === Infinity ? 40 + leave / 10 : md * 10) + (rank >= 0 ? rank : 12)
        + (s.ring === 'T' ? trebleCost : s.k === '25' ? (ctx?.bullShy ? 8 : 3) : (20 - s.n) * 0.01);
      if (sc < bs) { bs = sc; best = s; }
    }
    return best;
  }
  // blocked(seg) says whether darts already in the board cover that target.
  function chooseTarget(rem, dartsLeft, out, ctx = null, blocked = () => false) {
    const style = styleOf(ctx);
    let route = bestRoute(rem, dartsLeft, out, style);
    // A bull-shy player with two or three darts on 50 plays S10 D20 rather than the bull
    if (route && style?.bullShy && route.length === 1 && route[0].k === 'BULL') route = dartsLeft > 1 ? bestRoute(rem, dartsLeft, out, style, 2) : null;
    if (route) return route[0];
    if (out === 'single') return rem >= 60 ? BY.T20 : (SEGS.filter(s => s.ring === 'S' && s.v <= rem).pop() || BY.S1);
    if (rem > 130) {
      // Scoring: own bed, avoid leaving a bogey number, switch beds when the treble is blocked
      const bed = ctx?.bed ?? 20, alt = bed === 20 ? 19 : 20;
      let t = BY['T' + bed];
      if (BOGEY.has(rem - t.v) && !BOGEY.has(rem - 57)) t = BY.T19;
      // Better players sometimes switch when two darts crowd the treble; weaker ones keep throwing at it
      if (blocked(t) && (ctx?.avg ?? 70) >= 60 && Math.random() < 0.5) t = blocked(BY['T' + alt]) ? BY.T18 : BY['T' + alt];
      return t;
    }
    return setupDart(rem, out, ctx);
  }

  // ---- How the bot throws ----
  // Each dart lands with Gaussian scatter around the aim point, much more up-and-down (release
  // timing) than side-to-side (alignment), so darts at T20 stay in the 20, 1 and 5 beds; now and
  // then a dart drifts wide, less often with skill. Part of the scatter is shared by the three darts of
  // a visit (stance and rhythm), so darts group: good visits are tighter and bad ones are all off.
  // Most darts are tight, but about one in seven comes out loose with double the scatter.
  // Darts already in the board can deflect a dart or knock it out, and a dart that lands on a wire
  // can bounce out. Darts at a finishing double get extra scatter (the "dbl" factor), large for weak
  // players and nearly gone for strong ones, raised a little more under pressure.
  // CAL maps a target 3-dart average to [scatter mm, double factor], fitted by simulating full 501
  // double-out legs so each average comes with a realistic checkout %.
  const CAL = [[20,31.08,1.722], [25,25.25,1.863], [30,22.2,1.747], [35,19.92,1.76], [40,18.58,1.644], [45,16.73,1.554], [50,14.94,1.502], [55,13.2,1.612], [60,12.03,1.49], [65,10.09,1.676], [70,8.95,1.747], [75,7.6,1.941], [80,6.95,1.838], [85,6.14,1.967], [90,5.76,1.812], [95,5.14,1.928], [100,4.67,1.883], [105,4.05,2.334], [110,3.52,2.572], [115,3.07,2.908], [120,2.76,3.159]];
  const GROUP = 0.62;
  const AVG_MIN = CAL[0][0], AVG_MAX = CAL[CAL.length - 1][0];
  // Typical checkout % (doubles hit / darts at double) by 3-dart average, from amateur to pro
  const CO_CURVE = [[20, 3.8], [30, 6.5], [40, 10], [50, 14], [60, 18.5], [70, 23.5], [80, 29.5], [90, 37], [100, 43], [110, 46], [120, 48]];
  const lerpCurve = (curve, x) => {
    if (x <= curve[0][0]) return curve[0][1];
    for (let i = 1; i < curve.length; i++) if (x <= curve[i][0]) {
      const [x0, y0] = curve[i - 1], [x1, y1] = curve[i];
      return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
    }
    return curve[curve.length - 1][1];
  };
  // Share of darts that drift sideways badly, falling with skill
  const wideFor = avg => 0.12 - 0.11 * (Math.max(20, Math.min(120, avg)) - 20) / 100;
  // Extra double scatter when the opponent is on a finish or it's a match dart; weak players feel it most
  const pressureFor = avg => 1 + 0.15 * Math.max(0, Math.min(1, (75 - avg) / 55));
  // Players are sharpest on their own scoring bed (most practise T20 for hours). Other numbers and
  // the bull get this extra scatter: a lot for club players, little for pros. Set so Cricket marks
  // per round match league players of each average (about 1.6 MPR at 40, 2.3 at 60, 3.0 at 80).
  const OFF = [[20, 1.85], [40, 1.8], [60, 1.85], [75, 1.8], [90, 1.45], [100, 1.3], [120, 1.15]];
  function profileFor(avg) {
    const a = Math.max(AVG_MIN, Math.min(AVG_MAX, +avg || 50));
    let i = 0;
    while (i < CAL.length - 2 && CAL[i + 1][0] < a) i++;
    const [a0, s0, k0] = CAL[i], [a1, s1, k1] = CAL[i + 1], t = (a - a0) / (a1 - a0);
    return { avg: a, sigma: Math.exp(Math.log(s0) + t * (Math.log(s1) - Math.log(s0))), dbl: k0 + t * (k1 - k0), wide: wideFor(a), off: lerpCurve(OFF, a), co: lerpCurve(CO_CURVE, a) };
  }

  const WIRE_RADII = [R.bull, R.outerBull, R.trebleIn, R.trebleOut, R.doubleIn, R.doubleOut];
  function nearWire(x, y) {
    const r = Math.hypot(x, y);
    if (WIRE_RADII.some(w => Math.abs(r - w) < 0.6)) return true;
    if (r < R.outerBull || r > R.doubleOut) return false;
    const off = ((Math.atan2(x, y) * 180 / Math.PI + 369) % 360) % 18;
    return r * Math.sin(Math.min(off, 18 - off) * Math.PI / 180) < 0.6;
  }
  // Start a visit: returns throwDart(target, atDouble) plus blocked(target) for aiming decisions
  // Scatter multiplier for one dart: doubles have their own nerves; other numbers are off the bed;
  // pressure tightens the arm a little on every dart and more on doubles.
  function aimFactor(t, prof, ctx, atDouble) {
    const pr = ctx?.pressure || 1;
    if (atDouble) return (prof.dbl || 1) * pr;
    const onBed = t.n === (ctx?.bed ?? 20) || t.k === 'MISS';
    return (onBed ? 1 : (prof.off || 1)) * (1 + (pr - 1) * 0.5);
  }
  function startVisit(prof, ctx = {}) {
    ctx.form = 0.85 * (ctx.form || 0) + gauss() * 0.06;
    const s = prof.sigma * Math.exp(ctx.form);
    const ox = gauss() * s * GROUP * 0.6, oy = gauss() * s * GROUP * 1.35;
    const own = Math.sqrt(1 - GROUP * GROUP);
    const landed = [];
    const throwDart = (t, atDouble = false) => {
      const k = aimFactor(t, prof, ctx, atDouble);
      const [ax, ay] = aimPoint(t);
      const side = Math.random() < (prof.wide || 0) ? 1.4 : 0.6;
      // Most darts are tight; now and then one comes out loose
      const loose = Math.random() < 0.15 ? 2 : 0.82;
      let x = ax + ox + gauss() * s * own * k * side * loose, y = ay + oy + gauss() * s * own * k * 1.35 * loose;
      let event = null;
      for (const d of landed) {
        if (Math.hypot(x - d.x, y - d.y) < 2) {
          const u = Math.random();
          if (u < 0.08) event = 'bounce';
          else if (u < 0.45) { const a = Math.random() * 2 * Math.PI, m = 3 + Math.random() * 4; x += Math.cos(a) * m; y += Math.sin(a) * m; event = 'deflect'; }
          break;
        }
      }
      if (!event && nearWire(x, y) && Math.random() < 0.025) event = 'bounce';
      const rx = Math.round(x * 10) / 10, ry = Math.round(y * 10) / 10;
      if (event === 'bounce') return { h: MISS, x: rx, y: ry, bounce: true };
      landed.push({ x, y });
      return { h: hitAt(x, y), x: rx, y: ry, deflected: event === 'deflect' };
    };
    // The bed counts as blocked when two darts already crowd the aim point
    throwDart.blocked = seg => { const [ax, ay] = aimPoint(seg); return landed.filter(d => Math.hypot(d.x - ax, d.y - ay) < 4).length >= 2; };
    return throwDart;
  }
  // Expected-value aiming: sample the bot's own scatter once, score every candidate aim point with
  // the same samples, and pick the best. Weak players end up aiming at big singles and strong ones at
  // trebles, as real players do. value(hitSegment) returns what a dart landing there is worth.
  function bestAim(candidates, value, prof, ctx, n = 160) {
    const smp = [];
    for (let i = 0; i < n; i++) smp.push([gauss(), gauss(), Math.random() < (prof.wide || 0) ? 1.4 : 0.6, Math.random() < 0.15 ? 2 : 0.82]);
    const s0 = prof.sigma * Math.exp(ctx?.form || 0);
    let best = candidates[0], bv = -Infinity;
    for (const c of candidates) {
      const s = s0 * aimFactor(c, prof, ctx, c.ring === 'D');
      const [ax, ay] = aimPoint(c);
      let tot = 0;
      for (const [gx, gy, side, loose] of smp) tot += value(hitAt(ax + gx * s * side * loose, ay + gy * s * 1.35 * loose));
      if (tot > bv) { bv = tot; best = c; }
    }
    return best;
  }

  // opts.inRule: 'straight', 'double' or 'master' in; opts.opened: whether this player has already opened the leg
  function simulateVisit(rem, out, prof, ctx = null, opts = {}) {
    ctx = ctx || makePersona(prof.avg ?? 60);
    const throwDart = startVisit(prof, ctx);
    const inRule = opts.inRule || 'straight';
    let opened = inRule === 'straight' || opts.opened !== false;
    const darts = [];
    let cur = rem, atDouble = 0;
    for (let i = 0; i < 3; i++) {
      let t, finishing = false;
      if (!opened) {
        // Double/master in: go for the opener (a big double, or the treble 20 when trebles open too)
        t = inRule === 'master' ? BY.T20 : BY.D20;
      } else {
        t = chooseTarget(cur, 3 - i, out, ctx, throwDart.blocked);
        finishing = t.v === cur && isFinisher(t, out);
        if (out !== 'single' && finishing) atDouble++;
      }
      const r = throwDart(t, finishing && out !== 'single' || (!opened && t.ring === 'D'));
      const h = r.h;
      const counts = opened || h.dbl || (inRule === 'master' && h.ring === 'T');
      darts.push({ aim: t.k, k: h.k, v: counts ? h.v : 0, x: r.x, y: r.y, bounce: !!r.bounce });
      if (!counts) continue;
      opened = true;
      const nr = cur - h.v;
      if (nr === 0 && isFinisher(h, out)) return { score: rem, dartsUsed: i + 1, dartsAtDouble: atDouble, checkout: true, bust: false, darts, opened };
      if (nr < 0 || (out !== 'single' && nr <= 1)) return { score: 0, dartsUsed: 3, dartsAtDouble: atDouble, checkout: false, bust: true, darts, opened };
      cur = nr;
    }
    return { score: rem - cur, dartsUsed: 3, dartsAtDouble: atDouble, checkout: false, bust: false, darts, opened };
  }

  // ---- Stats from the visit log ----
  function stats(legs, nPlayers) {
    const out = [];
    for (let p = 0; p < nPlayers; p++) {
      const s = { score: 0, darts: 0, f9score: 0, f9darts: 0, atDouble: 0, checkouts: 0, highFinish: 0, bestLeg: null, t100: 0, t140: 0, t180: 0, legsWon: 0, highVisit: 0 };
      for (const leg of legs) {
        const mine = leg.visits.filter(v => v.p === p);
        let legDarts = 0;
        mine.forEach((v, i) => {
          s.score += v.score; s.darts += v.dartsUsed; legDarts += v.dartsUsed;
          if (i < 3) { s.f9score += v.score; s.f9darts += v.dartsUsed; }
          s.atDouble += v.dartsAtDouble || 0;
          if (v.score >= 180) s.t180++; else if (v.score >= 140) s.t140++; else if (v.score >= 100) s.t100++;
          if (v.score > s.highVisit) s.highVisit = v.score;
          if (v.checkout) { s.checkouts++; s.highFinish = Math.max(s.highFinish, v.score); }
        });
        if (leg.winner === p) { s.legsWon++; s.bestLeg = s.bestLeg == null ? legDarts : Math.min(s.bestLeg, legDarts); }
      }
      s.avg = s.darts ? s.score / s.darts * 3 : null;
      s.f9 = s.f9darts ? s.f9score / s.f9darts * 3 : null;
      s.coPct = s.atDouble ? s.checkouts / s.atDouble * 100 : null;
      out.push(s);
    }
    return out;
  }

  return { ORDER, SEGS, BY, R, validVisit, isFinisher, label, bestRoute, minDarts, simulateVisit, startVisit, bestAim, makePersona, pressureFor, profileFor, AVG_MIN, AVG_MAX, stats };
})();
