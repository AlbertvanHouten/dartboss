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
