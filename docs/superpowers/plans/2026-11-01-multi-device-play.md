# Multi-device Play Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Players in one room each score on their own phone in one shared live match, with the host phone holding the real state.

**Architecture:** A new `src/room.js` holds pure rules (codes, `canAct`, `canUndo`, seat claims), two transports behind one interface (`local` BroadcastChannel for tests, `p2p` Trystero/WebRTC), and the host and guest session logic. `src/app.js` routes guest inputs to the host at its existing chokepoints (`commitVisit`, `gameAct`, `undo`, `gameUndo`) and broadcasts state from `save()`. Guests render the broadcast state and never save it over their own local game.

**Tech Stack:** Plain JS (no framework, no bundler for app code), Trystero 0.26.0 Nostr strategy bundled with esbuild into `web/vendor/`, qrcode-generator 2.0.4, puppeteer-core for e2e.

**Spec:** `docs/superpowers/specs/2026-11-01-multi-device-play-design.md`

## Global Constraints

- Nothing loads from a CDN or third-party host at page load. Vendored files live in `web/vendor/` and are cached by `web/sw.js`.
- Network use starts only when someone starts or joins a shared game. Solo and single-phone play make no network requests.
- Every user-facing string goes through `t()` and gets Dutch and German entries in `src/i18n.js`; `npm test` fails on a missing translation.
- Room code: 6 characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, shown as `XXX-XXX`, join link `<site>/?join=XXXXXX` (no dash).
- Trystero `appId`: `'dartboss'`. Room id: the 6-character code. Password: the code.
- Seat 0 is the host's own seat and can't be claimed by a guest. Bot seats can't be claimed. One phone may claim several seats.
- Every message carries `app: APP_VERSION`. A guest whose version differs from the host's does not join and sees "Update Dartboss on this phone to join".
- Timeouts: no room connection within 15 s → "Couldn't reach the room. Check the code, and that both phones are online" + Retry. Host unreachable for 10 s → "Host disconnected" + Leave.
- Guest storage key: `oche-room` (room code + claimed seats). The host's code is stored on `S.room.code` in the saved match.
- Match code style: comments in the same voice as the surrounding code (short, plain English), 2-space indent, no semicolon-free style changes, no framework.

## Review Focus

1. **A guest and the host enter the same visit at the same moment.** Expected: exactly one visit lands; the guest sees "Already scored". Test: Task 4, `stale input is rejected`.
2. **A guest's own local game in progress when they join someone's room.** Expected: after leaving the room their own game is still there, untouched. Test: Task 4, `guest keeps its own saved game`.
3. **The host taps Restart, Main menu or Discard while guests are connected.** Expected: guests see "The host ended the game" and return to their menu; no guest keeps sending inputs into a dead room. Test: Task 6, `host ending the room releases guests`.
4. **A guest opens a join link while their app version differs from the host's.** Expected: a clear "Update Dartboss on this phone to join", never a scoreboard that silently disagrees. Test: Task 2, `versionOk`; Task 6, `version mismatch refuses to join`.
5. **A bot's visit lands right after a guest's visit, then the guest presses Undo.** Expected: refused ("Too late to undo here: ask the host"), because the bot's turn is complete. Test: Task 2, `canUndo refuses after a bot visit`.

---

### Task 1: Vendor Trystero and the QR code generator

**Files:**
- Create: `scripts/vendor.mjs`, `web/vendor/trystero-nostr.mjs` (generated, committed), `web/vendor/qrcode.js` (copied, committed)
- Modify: `package.json` (devDependencies `esbuild@0.28.2`, `trystero@0.26.0`, `qrcode-generator@2.0.4`; script `"vendor": "node scripts/vendor.mjs"`), `web/sw.js:5-9` (add both files to `SHELL`), `.github/workflows/ci.yml` ("Check the build" file list), `docs/development.md` (layout table row and command)

**Interfaces:**
- Produces: `web/vendor/trystero-nostr.mjs`, an ES module exporting `joinRoom`, `selfId`. `web/vendor/qrcode.js`, a classic script defining global `qrcode(typeNumber, errorLevel)`.

- [ ] **Step 1:** Write `scripts/vendor.mjs`: esbuild `bundle: true, format: 'esm', minify: true, platform: 'browser', target: 'es2020'` with entry `trystero/nostr` → `web/vendor/trystero-nostr.mjs`, prefixed by a comment naming the package, version and MIT licence; copy `node_modules/qrcode-generator/dist/qrcode.js` (check the package's actual path) → `web/vendor/qrcode.js` with the same header.
- [ ] **Step 2:** `npm install -D esbuild@0.28.2 trystero@0.26.0 qrcode-generator@2.0.4 && npm run vendor`. Expected: both files exist; `node --input-type=module -e "const m = await import('./web/vendor/trystero-nostr.mjs'); console.log(typeof m.joinRoom)"` prints `function` (if the bundle touches browser globals at import, check with a headless page instead).
- [ ] **Step 3:** Add both to `SHELL` in `web/sw.js` and to the CI "Check the build" list. Run `npm run build && CHROME=/opt/pw-browsers/chromium CI=1 npm run test:e2e`. Expected: passes (the e2e already loads the service worker).
- [ ] **Step 4:** Commit: `Vendor Trystero (Nostr) and qrcode-generator for multi-device play`.

### Task 2: Room rules (pure)

**Files:**
- Create: `src/room.js` (rules section only in this task)
- Modify: `scripts/build.mjs:17-21` (add `<script id="room">` between games and app), `scripts/test.mjs:7-11` (load `room.js` after games and return its exports), `docs/development.md` (layout row)
- Test: `scripts/test.mjs`

**Interfaces:**
- Produces (globals in `room.js`):
  - `ROOM_ALPHABET` (string above), `makeRoomCode(rand = Math.random) → string` (6 chars), `formatRoomCode(code) → 'XXX-XXX'`, `parseRoomCode(text) → string|null` (uppercases, strips dashes and spaces; null unless exactly 6 characters, all from the alphabet).
  - `versionOk(msg, appVersion) → boolean`.
  - `actsSince(log, seat) → entries`: helper over the act log described below.
  - `canAct({ from, input, room, turn, ver }) → null | 'seat' | 'turn' | 'stale'` where `from` is `'host'` or a peer id, `input = { type: 'visit'|'act', seat, ver }`, `room.seats` maps seat → peerId, `turn` is the seat to throw.
  - `canUndo({ from, seat, room, acts, n }) → null | 'seat' | 'undo'` where `acts` is the act log (oldest first, each `{ seat, turnAfter }`), `n` the player count. Rule: the host is always allowed. A guest must have claimed `seat` (else `'seat'`) and have an act by `seat` in `acts` (else `'undo'`). Let `next` be the `turnAfter` of the guest's last act. Allowed when there are no later acts, or when every later act is by `next` and the latest act's `turnAfter` is still `next` (that visit is unfinished). Otherwise `'undo'`.
  - `claimSeats({ room, peer, seats, players }) → { ok: number[], refused: number[] }` and mutates `room.seats`. Refuses seat 0, bot seats, seats held by another peer, out-of-range seats.

- [ ] **Step 1: Write the failing tests** in `scripts/test.mjs` (new section "Multi-device rules"):

```js
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
// canUndo refuses after a bot visit (Review Focus 5): seat 2 is a bot and threw its visit
assert.equal(u('peerA', 1, [{ seat: 1, turnAfter: 2 }, { seat: 2, turnAfter: 3 }]), 'undo');
assert.equal(u('peerA', 2, [{ seat: 1, turnAfter: 2 }]), 'undo', 'nothing of its own to undo');
assert.equal(u('peerB', 1, [{ seat: 1, turnAfter: 2 }]), 'seat');

const players = [{ type: 'human' }, { type: 'human' }, { type: 'bot' }, { type: 'human' }];
const r2 = { seats: { 1: 'peerA' } };
assert.deepEqual(claimSeats({ room: r2, peer: 'peerB', seats: [0, 1, 2, 3, 9], players }), { ok: [3], refused: [0, 1, 2, 9] });
assert.deepEqual(claimSeats({ room: r2, peer: 'peerA', seats: [1, 3], players }), { ok: [1], refused: [3] });
```

- [ ] **Step 2:** `npm test`. Expected: FAIL (`makeRoomCode is not defined`).
- [ ] **Step 3:** Implement the rules in `src/room.js` (top of file, no DOM access at load) and wire `build.mjs` / `test.mjs`.
- [ ] **Step 4:** `npm test`. Expected: `All checks passed`. Then `npm run build && CHROME=/opt/pw-browsers/chromium CI=1 npm run test:e2e`. Expected: passes.
- [ ] **Step 5:** Commit: `Multi-device: room codes, turn and undo rules, seat claims`.

### Task 3: Act log in the app

Every applied input records who acted and whose turn it is afterwards, so `canUndo` has its `acts`.

**Files:**
- Modify: `src/app.js` — `commitVisit` (~l.462), `popOne`/`undo` (~l.530-556), `gameAct` (~l.649), `gameBot` (~l.694), `gameUndo` (~l.678), `freshMatch` (~l.38)
- Test: `scripts/e2e.mjs`

**Interfaces:**
- Produces: `S.acts`, an array kept in step with the visit log (X01) and with `S.hist` (games), entries `{ seat, turnAfter }`. Helper `currentTurn() → seat` (`turnOf(curLeg())` for X01, `S.game.turn` for games; `-1` when finished).

- [ ] **Step 1: Failing e2e test** (`act log follows play and undo`): start a 3-human Killer game, `gameAct('dart', …)` three times for seat 0 and once for seat 1; assert `S.acts.length === 4`, `S.acts[0].seat === 0`, `S.acts[3].seat === 1`; `gameUndo()`; assert `S.acts.length === 3`. Same for X01: two `submit()`s, assert `S.acts.map(a => a.seat)` is `[0, 1]` and `S.acts[1].turnAfter === 2 % n`, `undo()` → length 1.
- [ ] **Step 2:** `npm run build && CHROME=/opt/pw-browsers/chromium CI=1 npm run test:e2e`. Expected: FAIL.
- [ ] **Step 3:** Push `{ seat, turnAfter: currentTurn() }` wherever a visit or act is applied (human and bot); pop it wherever `popOne` pops a visit or `gameUndo` pops a `hist` entry; trim it alongside `S.hist`'s 400 cap; init `[]` in `freshMatch` and default it on load (`S.acts = S.acts || []`).
- [ ] **Step 4:** Run e2e and `npm test`. Expected: both pass.
- [ ] **Step 5:** Commit: `Keep a log of who acted, for undo rules across phones`.

### Task 4: Sessions over the local transport

**Files:**
- Modify: `src/room.js` (transport interface, `local` transport, host and guest session), `src/app.js` (hooks)
- Test: `scripts/e2e.mjs` (new section with two pages: `host` and `guest`, same origin, `?transport=local`)

**Interfaces:**
- Consumes: Task 2 rules, Task 3 `S.acts` and `currentTurn()`.
- Produces:
  - Transport: `{ join(code, { onMessage(msg, from), onPeer(peerId, online) }) → Promise<void>, send(msg, to?), leave(), selfId }`. `localTransport()` uses `BroadcastChannel('dartboss-' + code)` and a random `selfId`; `pickTransport()` returns `localTransport()` when the page URL has `transport=local`, else `p2pTransport()` (Task 6).
  - `ROOM` (global, `null` when no room): `{ role: 'host'|'guest', code, transport, seats: {seat: peerId}, online: {peerId: true}, mine: number[] }`.
  - Host: `hostRoom(code?) → Promise<void>` (makes a code if none, sets `S.room = { code, ver: 0, seats: {}, online: {} }`), `broadcastState()` (called from `save()` when `ROOM?.role === 'host'`; increments `S.room.ver`; sends `{ type: 'state', app, ver, state }` where `state` is `S` without `hist`, `replay`, `gameReplay`, `screen`).
  - Guest: `joinRoomAsGuest(code) → Promise<void>`, `claim(seats)`, `leaveRoom()`; `guestSend(input)` adds `ver: ROOM.ver`, `app`.
  - App hooks: in `commitVisit(v)`, if guest → `guestSend({ type: 'visit', seat: v.p, visit: v })` and return; in `gameAct(a, v)` after validation, if guest → `guestSend({ type: 'act', seat: S.game.turn, a, v })` and return; in `undo()`/`gameUndo()`, if guest → `guestSend({ type: 'undo', seat: <guest's seat with the latest act> })` and return. Host handler applies via `commitVisit`, `gameAct`, `undo`/`gameUndo` after `canAct`/`canUndo`, else sends `{ type: 'reject', reason }` to that peer. A guest `undo` that `canUndo` allows runs the host's undo repeatedly until the guest's last act is popped.
  - Guest on `state`: keeps its own saved match aside (`localS = S` on join, restored by `leaveRoom()`), sets `S = { ...state, hist: [], screen: 'play' }`, never calls `save()`, `maybeBot()` or the caller while in a room, renders.

- [ ] **Step 1: Failing e2e tests** (two pages, `local` transport):
  - `guest joins and sees the host's match`: host `startMatch` X01 with `[You, Ann, Bob]` humans, `hostRoom('K7QM2P')`; guest `joinRoomAsGuest('K7QM2P')`, `claim([1])`; assert guest `S.settings.players.length === 3` and `ROOM.mine` is `[1]`.
  - `guest scores its own visit`: host `submit(60)` (seat 0); guest `submit(100)`; host `remaining(curLeg(), 1) === 401`; guest sees the same.
  - `host scores for a seat without a phone`: host `submit(45)` for seat 2 (Bob, unclaimed); both pages agree.
  - `stale input is rejected` (Review Focus 1): guest captures `ROOM.ver`, host enters seat 1's visit itself, guest sends its visit with the old `ver`; host has exactly one seat-1 visit; guest got a `reject` with `stale` and shows "Already scored".
  - `guest undo while next turn in progress`: Killer with `[You, Ann, Bob]`, guest claims 1; seat 0 finishes, guest throws three darts, seat 2's first dart entered on host; guest `gameUndo()`; host state is back to guest's third dart undone and seat-2's dart undone, and the page showing seat 2's turn shows the toast "Ann took back their visit"; guest `undo` after seat 2 completes their visit is refused with "Too late to undo here: ask the host".
  - `guest keeps its own saved game` (Review Focus 2): guest page starts its own solo Bob's 27 first, then joins; after `leaveRoom()`, guest `S.settings.mode === 'bobs27'` and `localStorage` still holds it.
- [ ] **Step 2:** Run e2e. Expected: FAIL.
- [ ] **Step 3:** Implement transport, sessions and hooks.
- [ ] **Step 4:** Run e2e and `npm test`. Expected: pass.
- [ ] **Step 5:** Commit: `Multi-device: host and guest sessions over a local transport`.

### Task 5: Screens: setup switch, lobby, join, seats, waiting

**Files:**
- Modify: `src/app.js` (`openSetup` draw/submit, `renderMenu`, `render`, `renderGame`, click handler, boot: `?join=`), `src/body.html` (lobby container `#roomBar` above `#play`'s first column), `src/style.css` (lobby, seat list, connection dot, waiting panel), `src/i18n.js` (all new strings in nl and de)
- Test: `scripts/e2e.mjs`

**Interfaces:**
- Consumes: Task 4 `ROOM`, `hostRoom`, `joinRoomAsGuest`, `claim`, `leaveRoom`.
- Produces: `S.settings.shared` (boolean, setup switch "Players on their own phones", shown when the list has 2+ players and the game is not solo). `startMatch` calls `hostRoom()` when it's set. Menu tile `data-menu="join"` → screen `join` (code field `#joinCode`, button `data-act="join"`). Boot: a `join` URL parameter opens screen `join` with the code filled and joins at once, then removes the parameter with `history.replaceState`. `myTurn() → boolean` (true on the host always; on a guest when `ROOM.mine` includes `currentTurn()`).

- [ ] **Step 1: Failing e2e tests:** setup with the switch on shows `#roomBar` with the formatted code and a QR `<svg>` or `<img>`; the bar folds after the first visit and reopens on tap; guest `goto('?join=K7QM2P&transport=local')` lands on the seat list (bot seats and seat 0 disabled); after claiming, when it isn't the guest's turn `#keys` buttons are disabled and the text "Waiting for Bob…" is shown; when it is, they're enabled; the host's scoreboard shows a green dot on seat 1 (`.dot.on`) and grey on an unclaimed seat. `npm test` must still pass the translation check.
- [ ] **Step 2:** Run e2e. Expected: FAIL.
- [ ] **Step 3:** Implement. QR: `qrcode(0, 'M')`, `addData(joinLink)`, `make()`, `createSvgTag({ cellSize: 4, margin: 2 })`. Load `vendor/qrcode.js` on demand (insert a `<script>` the first time a lobby opens) so single-phone play loads nothing new.
- [ ] **Step 4:** Run e2e, `npm test`, and screenshot host lobby and guest waiting state at 390×844 to check layout. Expected: tests pass; nothing overflows at phone width.
- [ ] **Step 5:** Commit: `Multi-device: setup switch, lobby with code and QR, join screen, waiting state`.

### Task 6: Real transport, reconnecting, endings

**Files:**
- Modify: `src/room.js` (`p2pTransport`, timeouts, reconnect, version check), `src/app.js` (restart/menu/discard end the room; boot reopens a saved host room; guest boot rejoins from `oche-room`; history on guest at match end; rematch keeps the room)
- Test: `scripts/e2e.mjs` (local transport), manual p2p smoke

**Interfaces:**
- Produces: `p2pTransport()`: `await import('./vendor/trystero-nostr.mjs')`, `joinRoom({ appId: 'dartboss', password: code }, code)`, one action `makeAction('msg')`, `onPeerJoin`/`onPeerLeave` → `onPeer`. Messages `{ type: 'end' }` (host ends the room) and `{ type: 'hello', app }` (guest on connect; host answers with `state` or `{ type: 'reject', reason: 'version', app }`).

- [ ] **Step 1: Failing e2e tests:**
  - `guest reload rejoins mid-match`: guest claims seat 1, reloads; within 3 s `ROOM.mine` is `[1]` and the scoreboard matches the host.
  - `host reload reopens the room`: host reloads; guest receives a fresh `state`; guest can score.
  - `host ending the room releases guests` (Review Focus 3): host `goMenu()` then Discard (and separately Restart); guest shows "The host ended the game" and `ROOM === null`.
  - `version mismatch refuses to join` (Review Focus 4): stub the guest's `APP_VERSION` before joining; guest shows "Update Dartboss on this phone to join" and is not in `ROOM`.
  - `guest records the finished match`: play a 101 X01 match to the end across both pages; guest `historyAll()[0].id === host S.id`; host `Play again` keeps `ROOM.mine` on the guest.
  - `no network without a room`: in a fresh page, play a single-phone X01 visit; assert no request was made to any origin other than the page's (puppeteer `request` listener).
- [ ] **Step 2:** Run e2e. Expected: FAIL.
- [ ] **Step 3:** Implement. Host-unreachable timer: 10 s with no message from the host after `onPeer(host, false)` → "Host disconnected" + Leave. Connect timeout 15 s → retry message.
- [ ] **Step 4:** Run e2e and `npm test`. Expected: pass. Then the manual p2p smoke: two puppeteer browsers (separate profiles) on `dist/` without `transport=local`, host and guest join `?join=<code>`, guest scores one visit; record whether it connected and how long it took. If the sandbox blocks the relays, say so in the PR rather than skipping silently.
- [ ] **Step 5:** Commit: `Multi-device: WebRTC transport, reconnecting, version check, room endings`.

### Task 7: Privacy, help and docs

**Files:**
- Modify: `web/privacy.html` (new section "Playing on several phones", text from the spec's *Privacy*), `web/support.html` (how to host and join; networks that block direct links → host's hotspot or the host scores for that player), `docs/games.md` (one line per game: "can be played across phones"), `README.md` (feature list), `store/app-store.md` (one feature bullet per language; privacy notes unchanged), `docs/development.md` (room.js and vendor rows if not done)
- Test: `npm test` (strings), CI build check

- [ ] **Step 1:** Write the texts. Privacy wording keeps "Dartboss does not collect…" and replaces "never leaves your device" with the spec's sentence for shared games.
- [ ] **Step 2:** `npm run build && npm test && CHROME=/opt/pw-browsers/chromium CI=1 npm run test:e2e`. Expected: all pass.
- [ ] **Step 3:** Commit: `Multi-device: privacy policy, support page and docs`.
