// ===== Multi-device rooms =====
// Rules first: pure functions, no DOM, so npm test can run them. Sessions and screens come below.
// Room codes skip 0, O, 1 and I so they are easy to read out loud
const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const makeRoomCode = (rand = Math.random) => Array.from({ length: 6 }, () => ROOM_ALPHABET[Math.floor(rand() * ROOM_ALPHABET.length)]).join('');
const formatRoomCode = code => code.slice(0, 3) + '-' + code.slice(3);
const parseRoomCode = text => {
  const code = String(text).toUpperCase().replace(/[-\s]/g, '');
  return code.length === 6 && [...code].every(c => ROOM_ALPHABET.includes(c)) ? code : null;
};
// The room protocol: the messages and the match state they carry. It goes up only when either changes, so
// phones on different app versions play together while it matches. let: the browser test stands in another one.
let ROOM_PROTOCOL = 1;
const protocolOk = msg => !!msg && msg.proto === ROOM_PROTOCOL;
// When the host refuses a phone's protocol, the phone on the older one is the one to update
const whoUpdates = hostProto => (hostProto || 0) > ROOM_PROTOCOL ? 'guest' : 'host';

// The acts after the last one by `seat` (all of them if the seat has none)
const actsSince = (log, seat) => log.slice(log.findLastIndex(a => a.seat === seat) + 1);

// Can this sender enter this input? null = yes, else why not. The host may always enter.
const canAct = ({ from, input, room, turn, ver }) => {
  if (from === 'host') return null;
  if (room.seats[input.seat] !== from) return 'seat';
  if (input.ver !== ver) return 'stale';
  return input.seat === turn ? null : 'turn';
};

// A guest may undo its own last act while nobody has finished a visit after it
const canUndo = ({ from, seat, room, acts }) => {
  if (from === 'host') return null;
  if (room.seats[seat] !== from) return 'seat';
  const mine = acts.findLastIndex(a => a.seat === seat);
  if (mine < 0) return 'undo';
  const next = acts[mine].turnAfter, later = actsSince(acts, seat);
  // Later acts are fine only while they are one unfinished visit by the next player
  return !later.length || (later.every(a => a.seat === next) && later.at(-1).turnAfter === next) ? null : 'undo';
};

// Give a guest the seats it asks for. Seat 0 is the host's, bots play themselves, and a seat has one owner.
const claimSeats = ({ room, peer, seats, players }) => {
  const ok = [], refused = [];
  for (const s of seats) {
    const p = players[s], taken = room.seats[s];
    if (s > 0 && p && p.type !== 'bot' && (!taken || taken === peer)) { room.seats[s] = peer; ok.push(s); } else refused.push(s);
  }
  return { ok, refused };
};
// A new match in the same room: each phone keeps the seats it can still have with the new players
const recheckSeats = (room, players) => {
  const old = { ...room.seats };
  for (const s in room.seats) delete room.seats[s];
  for (const s in old) claimSeats({ room, peer: old[s], seats: [+s], players });
  return room;
};

// ---------- transports ----------
// A transport: join(code, { onMessage(msg, from), onPeer(peerId, online) }) → Promise, send(msg, to?), leave().
// Peer ids last one page load; a phone's lasting id (phoneId) travels inside the messages.
// Local: other tabs of this browser, over a BroadcastChannel. Used by the browser test and with ?transport=local.
function localTransport() {
  const selfId = Math.random().toString(36).slice(2, 10);
  let ch = null;
  const post = m => ch?.postMessage({ from: selfId, ...m });
  // A closing tab says goodbye, as a dropped WebRTC link would
  const bye = () => post({ bye: true });
  return {
    join(code, { onMessage, onPeer }) {
      ch = new BroadcastChannel('dartboss-' + code);
      addEventListener('pagehide', bye);
      ch.onmessage = ({ data: d }) => {
        if (d.to && d.to !== selfId) return;
        // Say hello back to a newcomer, so both sides know the other is here
        if (d.hi) { onPeer(d.from, true); if (!d.back) post({ hi: true, back: true, to: d.from }); }
        else if (d.bye) onPeer(d.from, false);
        else onMessage(d.msg, d.from);
      };
      post({ hi: true });
      return Promise.resolve();
    },
    send(msg, to) { post({ msg, to }); },
    leave() { removeEventListener('pagehide', bye); bye(); ch?.close(); ch = null; },
  };
}
// Phones on different networks: a WebRTC data channel, found through public Nostr relays with the signalling
// encrypted by the room code. The module loads only when a room opens, so single-phone play stays offline.
function p2pTransport() {
  let room = null, action = null, sent = Promise.resolve();
  return {
    async join(code, { onMessage, onPeer }) {
      const { joinRoom } = await import('./vendor/trystero-nostr.mjs');
      room = joinRoom({ appId: 'dartboss', password: code }, code);
      action = room.makeAction('msg', { onMessage: (msg, { peerId }) => onMessage(msg, peerId) });
      room.onPeerJoin = id => onPeer(id, true);
      room.onPeerLeave = id => onPeer(id, false);
    },
    send(msg, to) {
      if (action) sent = action.send(msg, to ? { target: to } : undefined).catch(() => {});
    },
    leave() {
      const r = room;
      room = action = null;
      // Let the last message (end, leave) go out first, but don't wait long for it
      if (r) Promise.race([sent, new Promise(ok => setTimeout(ok, 1000))]).then(() => r.leave()).catch(() => {});
    },
  };
}
const pickTransport = () => new URLSearchParams(location.search).get('transport') === 'local' ? localTransport() : p2pTransport();

// ---------- sessions ----------
// The host holds the real match and sends it to every guest after each change; guests send inputs.
// ROOM is null when this phone is in no room. A guest's own game waits in localS until it leaves.
let ROOM = null, localS = null;
// connect: how long a guest waits for the host's first state; hostLost: how long the host may be gone before the guest says so
const ROOM_TIMES = { connect: 15000, hostLost: 10000 };
// Each phone keeps one random id, so its seats are still its own after a reload
const PHONE_KEY = 'oche-phone', ROOM_KEY = 'oche-room';
function phoneId() {
  let id = readJSON(PHONE_KEY, null);
  if (!id) { id = makeRoomCode() + makeRoomCode(); writeJSON(PHONE_KEY, id); }
  return id;
}
let roomQuiet = false, roomNote = null; // quiet: hold broadcasts while one guest undo takes several steps
let lastSent = null; // the match as last broadcast, so a save that changed nothing (a screen change) sends nothing

// The state message: the match without undo snapshots, bot replays or the host's screen
function stateMsg() {
  const { hist, replay, gameReplay, screen, ...state } = S;
  return { type: 'state', proto: ROOM_PROTOCOL, app: APP_VERSION, ver: S.room.ver, state, ...(roomNote && { note: roomNote }) };
}
// Called from save(): every change gets a new version, so inputs made against an older one are refused.
// Saves that leave the match as it was (the host opening History, say) send nothing, so they can't make a guest's visit stale.
function broadcastState() {
  if (roomQuiet) return;
  const { hist, replay, gameReplay, screen, room, ...match } = S, json = JSON.stringify(match);
  if (json === lastSent && !roomNote) return;
  lastSent = json;
  S.room.ver++;
  ROOM.transport.send(stateMsg());
  roomNote = null;
}
// Presence and seat claims are not changes to the match: same version, no save
const sendState = to => ROOM.transport.send(stateMsg(), to);

// reopen: the saved match's room after a reload, with its seats and version; guests find it again on their own
async function hostRoom(code = makeRoomCode(), reopen = false) {
  if (ROOM) leaveRoom();
  const transport = pickTransport(), old = reopen && S.room?.code === code ? S.room : null;
  lastSent = null;
  S.room = { code, ver: old?.ver || 0, seats: old?.seats || {}, online: {} };
  // peers: transport peer id → phone id, for presence
  ROOM = { role: 'host', code, transport, self: 'host', seats: S.room.seats, online: S.room.online, mine: [0], peers: {} };
  // A transport that is closing can still deliver a message or two: only the current room's count
  const live = () => ROOM?.transport === transport;
  try {
    await transport.join(code, {
      onMessage: (msg, peer) => live() && hostMessage(msg, peer),
      onPeer(peer, online) {
        if (online || !live()) return; // the guest says hello with its phone id
        const phone = ROOM.peers[peer];
        delete ROOM.peers[peer];
        if (phone && !Object.values(ROOM.peers).includes(phone)) delete S.room.online[phone];
        sendState(); if (S.screen === 'play') render();
      },
    });
  } catch (e) { leaveRoom(); throw e; }
}
// The host ends the room for everyone: guests are told, and go back to their own game
function endRoom() {
  if (ROOM?.role !== 'host') return;
  ROOM.transport.send({ type: 'end', proto: ROOM_PROTOCOL, app: APP_VERSION });
  leaveRoom();
}
// What a guest may send: a small object of a known type, with a phone id like the ones phoneId() makes
// and whole-number seats. Anything else is dropped unanswered.
const GUEST_TYPES = ['hello', 'leave', 'claim', 'visit', 'act', 'undo'];
const guestMsgOk = msg => GUEST_TYPES.includes(msg.type) && typeof msg.phone === 'string' && /^[A-Za-z0-9]{1,32}$/.test(msg.phone)
  && (msg.type !== 'claim' || (Array.isArray(msg.seats) && msg.seats.length <= 8 && msg.seats.every(Number.isInteger)))
  && (!['visit', 'act', 'undo'].includes(msg.type) || Number.isInteger(msg.seat))
  && JSON.stringify(msg).length <= 2000;
function hostMessage(msg, peer) {
  if (!S.room || !msg || typeof msg !== 'object' || Array.isArray(msg)) return;
  const reject = reason => ROOM.transport.send({ type: 'reject', proto: ROOM_PROTOCOL, app: APP_VERSION, reason }, peer);
  // A guest on another protocol is told so when it says hello, and not answered after that.
  // The app version goes with every message too, for information only.
  if (!protocolOk(msg)) return msg.type === 'hello' && reject('version');
  if (!guestMsgOk(msg)) return;
  // 'host' is the host's own name in the rules, so no guest may use it
  const from = msg.phone;
  if (from === 'host') return;
  if (ROOM.peers[peer] !== from) {
    ROOM.peers[peer] = from; S.room.online[from] = true;
    if (msg.type !== 'hello' && msg.type !== 'claim') { sendState(); if (S.screen === 'play') render(); }
  }
  if (msg.type === 'hello') { sendState(); if (S.screen === 'play') render(); return; }
  // Seat changes are saved with the match, so the host still has them after a reload
  if (msg.type === 'leave') {
    for (const s in S.room.seats) if (S.room.seats[s] === from) delete S.room.seats[s];
    delete S.room.online[from];
    save(); sendState(); if (S.screen === 'play') render();
    return;
  }
  if (msg.type === 'claim') {
    const { refused } = claimSeats({ room: S.room, peer: from, seats: msg.seats, players: players() });
    // The lobby and the scoreboard's dots show who has which seat
    save(); sendState(); if (S.screen === 'play') render();
    // A seat another phone took a moment before: the phone is told
    if (refused.some(s => S.room.seats[s] && S.room.seats[s] !== from)) reject('taken');
    return;
  }
  if (msg.type === 'visit' || msg.type === 'act') {
    // X01 takes whole visits, the other games one act at a time
    if ((msg.type === 'visit') === isGame()) return reject('bad');
    const why = canAct({ from, input: msg, room: S.room, turn: currentTurn(), ver: S.room.ver });
    if (why) return reject(why);
    // The host builds the visit again by its own rules, and takes only acts the game's pad offers right now
    if (msg.type === 'act') return padOffers(msg.a, msg.v) ? gameAct(msg.a, msg.v, true) : reject('bad');
    const v = guestVisit(msg.visit, msg.seat);
    return v ? commitVisit(v, null, true) : reject('bad');
  }
  if (msg.type === 'undo') {
    const why = canUndo({ from, seat: msg.seat, room: S.room, acts: S.acts, n: n() });
    return why ? reject(why) : undoFor(msg.seat);
  }
}
// A guest's undo: step back until its last act is gone. In the dart-by-dart games that first takes back
// the darts the next player has thrown so far, and everyone is told.
function undoFor(seat) {
  const mine = S.acts.findLastIndex(a => a.seat === seat), others = S.acts.length - mine - 1;
  const step = isGame() ? gameUndo : undo, typed = buffer, turn = currentTurn();
  roomQuiet = true;
  try {
    while (S.acts.length > mine) {
      const len = S.acts.length;
      cancelBot(); botBusy = false;
      step();
      if (S.acts.length >= len) break;
    }
  } finally { roomQuiet = false; }
  // What the host was typing stays if it is still the same player's turn (as with a guest's visit)
  if (currentTurn() !== turn) { if (typed) lostAt = Date.now(); } else if (typed) { buffer = typed; render(); }
  if (others) { roomNote = { tookBack: seat }; toast(t('{name} took back their visit', { name: players()[seat].name })); }
  save();
}

// Resolves once the host has sent its match; rejects after ROOM_TIMES.connect without one, or with 'version' or 'hostVersion'
async function joinRoomAsGuest(code) {
  if (ROOM?.role === 'host') endRoom(); else if (ROOM) leaveRoom();
  // A hosted room that isn't open right now (a join link at boot comes before it reopens) ends too,
  // so it doesn't come back with this phone's own game
  else if (S?.room) { delete S.room; save(); }
  const transport = pickTransport();
  cancelBot(); botBusy = false; buffer = '';
  localS = S;
  // host: the host's peer id, once it has sent something; want: seats this phone had here before a reload
  const saved = readJSON(ROOM_KEY, null);
  // queue: inputs waiting for the host's answer to the one sent before them (sent while `waiting` holds its version)
  ROOM = { role: 'guest', code, transport, self: phoneId(), seats: {}, online: {}, mine: [], ver: null, host: null, lost: false, queue: [], waiting: null,
    want: saved?.code === code ? saved.seats || [] : [] };
  const room = ROOM, hello = to => transport.send({ type: 'hello', proto: ROOM_PROTOCOL, app: APP_VERSION, phone: room.self }, to);
  const joined = new Promise((ok, no) => {
    room.joined = { ok, no };
    room.connectTimer = setTimeout(() => no(new Error('timeout')), ROOM_TIMES.connect);
  });
  joined.catch(() => {}); // a transport that fails to join throws before anyone waits on this
  await transport.join(code, {
    onMessage: (msg, peer) => ROOM === room && guestMessage(msg, peer),
    onPeer(peer, online) {
      if (ROOM !== room) return;
      if (online) return hello(peer);
      // The host has gone: say so if it stays away
      if (peer === room.host && !room.lostTimer) room.lostTimer = setTimeout(() => { room.lost = true; renderRoomBar(); }, ROOM_TIMES.hostLost);
    },
  });
  hello();
  try { await joined; } finally { clearTimeout(room.connectTimer); room.joined = null; }
}
function guestMessage(msg, peer) {
  if (!ROOM || !msg || typeof msg !== 'object') return;
  if (msg.type === 'reject' && msg.reason === 'version') {
    const why = whoUpdates(msg.proto) === 'guest' ? 'version' : 'hostVersion';
    if (ROOM.joined) return ROOM.joined.no(new Error(why));
    leaveRoom(); goMenu(); return toast(updateText(why));
  }
  if (!protocolOk(msg)) return;
  if (msg.type === 'end') { leaveRoom(); goMenu(); return toast(t('The host ended the game')); }
  if (msg.type === 'state') {
    ROOM.host = peer;
    clearTimeout(ROOM.lostTimer); ROOM.lostTimer = null; ROOM.lost = false;
    // What this phone typed goes once the turn it was typed for has passed (or the match changed)
    // The guest stays on whatever screen it is on; joining opens the shared game
    const turn = ROOM.joined ? null : currentTurn(), id = S.id, screen = ROOM.joined ? 'play' : S.screen;
    S = { ...msg.state, hist: [], screen };
    if (S.id !== id || currentTurn() !== turn) buffer = '';
    // The host's own default name means nothing on another phone
    if (defaultWords('You').includes(S.settings.players[0]?.name)) S.settings.players[0].name = t('Host');
    ROOM.ver = msg.ver;
    ROOM.seats = S.room.seats; ROOM.online = S.room.online;
    ROOM.mine = Object.keys(S.room.seats).filter(s => S.room.seats[s] === ROOM.self).map(Number);
    // Kept for a reload: this room and this phone's seats in it
    const rec = JSON.stringify(ROOM.mine);
    if (rec !== ROOM.savedSeats) { ROOM.savedSeats = rec; writeJSON(ROOM_KEY, { code: ROOM.code, seats: ROOM.mine }); }
    guestRecord();
    if (screen === 'play') render();
    if (msg.note && players()[msg.note.tookBack]) toast(t('{name} took back their visit', { name: players()[msg.note.tookBack].name }));
    // This phone's undo has its answer: say what went, as on one phone
    if (ROOM.undone && msg.ver !== ROOM.undone.ver) {
      const v = ROOM.undone.v;
      if (v && S.acts.length < ROOM.undone.acts) toast(t('Undone: {what}', { what: v.bust ? t('bust') : v.score }));
      ROOM.undone = null;
    }
    if (ROOM.waiting != null && msg.ver !== ROOM.waiting) nextInput();
    if (ROOM.joined) {
      ROOM.joined.ok();
      // Back after a reload: ask again for any seat the host no longer has down for this phone
      const want = ROOM.want.filter(s => !ROOM.mine.includes(s));
      if (want.length) claim(want);
    }
  } else if (msg.type === 'reject') {
    if (msg.reason === 'taken') return toast(t('That seat was just taken'));
    if (ROOM.waiting != null) nextInput();
    if (msg.reason === 'undo') ROOM.undone = null;
    // turn and seat only happen through a race or a bug: the next state puts the phone right
    if (msg.reason === 'stale') toast(t('Already scored'));
    if (msg.reason === 'undo') toast(t('Too late to undo here: ask the host'));
  }
}
// Which phone needs a newer Dartboss: version (this one) or hostVersion
const updateText = why => why === 'version' ? t('Update Dartboss on this phone to join') : t("The host's Dartboss needs updating to play together");
// A guest keeps the finished match in its own history, so its stats count it (and drops it if the host takes the finish back)
function guestRecord() {
  const done = isGame() ? GAMES[S.settings.mode].done(S.game) : S.matchWinner != null;
  if (done && ROOM.recorded !== S.id) { recordHistory(); ROOM.recorded = S.id; }
  else if (!done && ROOM.recorded === S.id) { forgetHistory(S.id); ROOM.recorded = null; }
}
const guestSend = (input, ver = ROOM.ver) => ROOM.transport.send({ ...input, ver, proto: ROOM_PROTOCOL, app: APP_VERSION, phone: ROOM.self }, ROOM.host);
// A guest's inputs go one at a time: each waits for the host's answer to the one before (a new state or a
// refusal), so quick taps aren't refused as made against an old version. The waiting one goes with the newest.
function guestInput(input, ver = ROOM.ver) {
  if (ROOM.waiting != null) return ROOM.queue.push(input);
  ROOM.waiting = ROOM.ver;
  guestSend(input, ver);
  // An answer that never comes holds nothing up for long
  ROOM.waitTimer = setTimeout(nextInput, 3000);
}
function nextInput() {
  clearTimeout(ROOM.waitTimer);
  ROOM.waiting = null;
  if (ROOM.queue.length) guestInput(ROOM.queue.shift());
}
const claim = seats => guestSend({ type: 'claim', seats });
// Undo the latest act of any seat this phone plays
const guestUndoSeat = () => S.acts?.findLast(a => ROOM.mine.includes(a.seat))?.seat;
function guestUndo() {
  const seat = guestUndoSeat();
  if (seat == null) return;
  // In X01 the toast says which visit went, once the host's answer comes
  if (!isGame()) ROOM.undone = { ver: ROOM.ver, acts: S.acts.length, v: S.legs.flatMap(l => l.visits).findLast(v => v.p === seat) };
  guestInput({ type: 'undo', seat });
}
// Would the host take this phone's undo? Lights the Undo button on a guest
function guestCanUndo() {
  const seat = guestUndoSeat();
  return seat != null && !canUndo({ from: ROOM.self, seat, room: S.room, acts: S.acts });
}
// This phone's part in the room ends. A guest gives up its seats and gets its own game back.
function leaveRoom() {
  if (!ROOM) return;
  const { role, transport } = ROOM;
  clearTimeout(ROOM.lostTimer); clearTimeout(ROOM.connectTimer); clearTimeout(ROOM.waitTimer);
  ROOM.joined?.no(new Error('left'));
  if (role === 'guest') {
    if (ROOM.host) guestSend({ type: 'leave' });
    try { localStorage.removeItem(ROOM_KEY); } catch (e) {}
    window.ocheNative?.remove(ROOM_KEY);
  }
  transport.leave();
  ROOM = null;
  if (role === 'guest') { if (localS) S = localS; localS = null; buffer = ''; render(); maybeBot(); }
  else { delete S.room; save(); }
}
