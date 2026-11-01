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

// ---------- transports ----------
// A transport: join(code, { onMessage(msg, from), onPeer(peerId, online) }) → Promise, send(msg, to?), leave(), selfId.
// Local: other tabs of this browser, over a BroadcastChannel. Used by the browser test and with ?transport=local.
function localTransport() {
  const selfId = Math.random().toString(36).slice(2, 10);
  let ch = null;
  const post = m => ch?.postMessage({ from: selfId, ...m });
  return {
    selfId,
    join(code, { onMessage, onPeer }) {
      ch = new BroadcastChannel('dartboss-' + code);
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
    leave() { post({ bye: true }); ch?.close(); ch = null; },
  };
}
// Phones on different networks: built later
function p2pTransport() { throw new Error('p2p transport not built yet'); }
const pickTransport = () => new URLSearchParams(location.search).get('transport') === 'local' ? localTransport() : p2pTransport();

// ---------- sessions ----------
// The host holds the real match and sends it to every guest after each change; guests send inputs.
// ROOM is null when this phone is in no room. A guest's own game waits in localS until it leaves.
let ROOM = null, localS = null;
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

async function hostRoom(code = makeRoomCode()) {
  if (ROOM) leaveRoom();
  const transport = pickTransport();
  lastSent = null;
  S.room = { code, ver: 0, seats: {}, online: {} };
  ROOM = { role: 'host', code, transport, seats: S.room.seats, online: S.room.online, mine: [0] };
  await transport.join(code, {
    onMessage: hostMessage,
    onPeer(peer, online) {
      if (online) S.room.online[peer] = true; else delete S.room.online[peer];
      sendState(); if (S.screen === 'play') render();
    },
  });
}
function hostMessage(msg, from) {
  // A guest on another version is not answered; its phone tells the player to update
  if (!versionOk(msg, APP_VERSION) || !S.room) return;
  const reject = reason => ROOM.transport.send({ type: 'reject', app: APP_VERSION, reason }, from);
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

async function joinRoomAsGuest(code) {
  if (ROOM) leaveRoom();
  const transport = pickTransport();
  cancelBot(); botBusy = false; buffer = '';
  localS = S;
  ROOM = { role: 'guest', code, transport, seats: {}, online: {}, mine: [], ver: null };
  await transport.join(code, { onMessage: guestMessage, onPeer() {} });
}
function guestMessage(msg) {
  if (!versionOk(msg, APP_VERSION)) return;
  if (msg.type === 'state') {
    S = { ...msg.state, hist: [], screen: 'play' };
    ROOM.ver = msg.ver;
    ROOM.seats = S.room.seats; ROOM.online = S.room.online;
    ROOM.mine = Object.keys(S.room.seats).filter(s => S.room.seats[s] === ROOM.transport.selfId).map(Number);
    render();
    if (msg.note) toast(t('{name} took back their visit', { name: players()[msg.note.tookBack].name }));
  } else if (msg.type === 'reject') {
    // turn and seat only happen through a race or a bug: the next state puts the phone right
    if (msg.reason === 'stale') toast(t('Already scored'));
    if (msg.reason === 'undo') toast(t('Too late to undo here: ask the host'));
  }
}
const guestSend = (input, ver = ROOM.ver) => ROOM.transport.send({ ...input, ver, app: APP_VERSION });
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
  return seat != null && !canUndo({ from: ROOM.transport.selfId, seat, room: S.room, acts: S.acts });
}
function leaveRoom() {
  if (!ROOM) return;
  const role = ROOM.role;
  ROOM.transport.leave();
  ROOM = null;
  if (role === 'guest') { if (localS) S = localS; localS = null; buffer = ''; render(); maybeBot(); }
  else { delete S.room; save(); }
}
