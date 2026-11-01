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
// Both devices must run the same app version, or the rules could differ
const versionOk = (msg, appVersion) => !!msg && msg.app === appVersion;

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
  return { type: 'state', app: APP_VERSION, ver: S.room.ver, state, ...(roomNote && { note: roomNote }) };
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
  ROOM.transport.send({ type: 'end', app: APP_VERSION });
  leaveRoom();
}
function hostMessage(msg, peer) {
  if (!S.room) return;
  const reject = reason => ROOM.transport.send({ type: 'reject', app: APP_VERSION, reason }, peer);
  // A guest on another version is told so when it says hello, and not answered after that
  if (!versionOk(msg, APP_VERSION)) return msg.type === 'hello' && reject('version');
  const from = msg.phone;
  if (!from) return;
  if (ROOM.peers[peer] !== from) {
    ROOM.peers[peer] = from; S.room.online[from] = true;
    if (msg.type !== 'hello' && msg.type !== 'claim') { sendState(); if (S.screen === 'play') render(); }
  }
  if (msg.type === 'hello') { sendState(); if (S.screen === 'play') render(); return; }
  if (msg.type === 'leave') {
    for (const s in S.room.seats) if (S.room.seats[s] === from) delete S.room.seats[s];
    delete S.room.online[from];
    sendState(); if (S.screen === 'play') render();
    return;
  }
  if (msg.type === 'claim') {
    claimSeats({ room: S.room, peer: from, seats: msg.seats || [], players: players() });
    // The lobby and the scoreboard's dots show who has which seat
    sendState(); if (S.screen === 'play') render();
    return;
  }
  if (msg.type === 'visit' || msg.type === 'act') {
    if (msg.type === 'visit' && msg.visit?.p !== msg.seat) return reject('seat');
    const why = canAct({ from, input: msg, room: S.room, turn: currentTurn(), ver: S.room.ver });
    if (why) return reject(why);
    return msg.type === 'visit' ? commitVisit(msg.visit) : gameAct(msg.a, msg.v);
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
  const step = isGame() ? gameUndo : undo;
  roomQuiet = true;
  try {
    while (S.acts.length > mine) {
      const len = S.acts.length;
      cancelBot(); botBusy = false;
      step();
      if (S.acts.length >= len) break;
    }
  } finally { roomQuiet = false; }
  if (others) { roomNote = { tookBack: seat }; toast(t('{name} took back their visit', { name: players()[seat].name })); }
  save();
}

// Resolves once the host has sent its match; rejects after ROOM_TIMES.connect without one, or with 'version'
async function joinRoomAsGuest(code) {
  if (ROOM?.role === 'host') endRoom(); else if (ROOM) leaveRoom();
  const transport = pickTransport();
  cancelBot(); botBusy = false; buffer = '';
  localS = S;
  // host: the host's peer id, once it has sent something; want: seats this phone had here before a reload
  const saved = readJSON(ROOM_KEY, null);
  ROOM = { role: 'guest', code, transport, self: phoneId(), seats: {}, online: {}, mine: [], ver: null, host: null, lost: false,
    want: saved?.code === code ? saved.seats || [] : [] };
  const room = ROOM, hello = to => transport.send({ type: 'hello', app: APP_VERSION, phone: room.self }, to);
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
  if (!ROOM) return;
  if (msg.type === 'reject' && msg.reason === 'version') {
    if (ROOM.joined) return ROOM.joined.no(new Error('version'));
    leaveRoom(); goMenu(); return toast(t('Update Dartboss on this phone to join'));
  }
  if (!versionOk(msg, APP_VERSION)) return;
  if (msg.type === 'end') { leaveRoom(); goMenu(); return toast(t('The host ended the game')); }
  if (msg.type === 'state') {
    ROOM.host = peer;
    clearTimeout(ROOM.lostTimer); ROOM.lostTimer = null; ROOM.lost = false;
    S = { ...msg.state, hist: [], screen: 'play' };
    ROOM.ver = msg.ver;
    ROOM.seats = S.room.seats; ROOM.online = S.room.online;
    ROOM.mine = Object.keys(S.room.seats).filter(s => S.room.seats[s] === ROOM.self).map(Number);
    // Kept for a reload: this room and this phone's seats in it
    const rec = JSON.stringify(ROOM.mine);
    if (rec !== ROOM.savedSeats) { ROOM.savedSeats = rec; writeJSON(ROOM_KEY, { code: ROOM.code, seats: ROOM.mine }); }
    guestRecord();
    render();
    if (msg.note) toast(t('{name} took back their visit', { name: players()[msg.note.tookBack].name }));
    if (ROOM.joined) {
      ROOM.joined.ok();
      // Back after a reload: ask again for any seat the host no longer has down for this phone
      const want = ROOM.want.filter(s => !ROOM.mine.includes(s));
      if (want.length) claim(want);
    }
  } else if (msg.type === 'reject') {
    // turn and seat only happen through a race or a bug: the next state puts the phone right
    if (msg.reason === 'stale') toast(t('Already scored'));
    if (msg.reason === 'undo') toast(t('Too late to undo here: ask the host'));
  }
}
// A guest keeps the finished match in its own history, so its stats count it (and drops it if the host takes the finish back)
function guestRecord() {
  const done = isGame() ? GAMES[S.settings.mode].done(S.game) : S.matchWinner != null;
  if (done && ROOM.recorded !== S.id) { recordHistory(); ROOM.recorded = S.id; }
  else if (!done && ROOM.recorded === S.id) { forgetHistory(S.id); ROOM.recorded = null; }
}
const guestSend = (input, ver = ROOM.ver) => ROOM.transport.send({ ...input, ver, app: APP_VERSION, phone: ROOM.self }, ROOM.host);
const claim = seats => guestSend({ type: 'claim', seats });
// Undo the latest act of any seat this phone plays
const guestUndoSeat = () => S.acts?.findLast(a => ROOM.mine.includes(a.seat))?.seat;
function guestUndo() {
  const seat = guestUndoSeat();
  if (seat != null) guestSend({ type: 'undo', seat });
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
  clearTimeout(ROOM.lostTimer); clearTimeout(ROOM.connectTimer);
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
