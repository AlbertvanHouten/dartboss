# Multi-device play

Players in the same room each score on their own phone, in one shared live match, instead of passing one device around.

## Goal and scope

- One shared live match: one phone (the host) sets it up, the others join, everyone sees the same live scoreboard, and each player enters their own visits on their own phone.
- Every multiplayer game: X01, Cricket, Killer, Shanghai, Halve It, Around the Clock and Bob's 27. Solo practice games are unchanged.
- No server to run or pay for: phones connect peer to peer.
- The game never gets stuck: the host can always score for any player.
- Not in scope: playing between rooms or cities as a product goal (it may work, but isn't designed for), spectator-only devices, accounts, a relay (TURN) server.

## Architecture

### Host-authoritative state

- The host phone holds the real match state (`S`), runs the bots and the caller, and saves the match as it does today.
- Guests send inputs, not state. Every input is a small message: `{ type, seat, ver, ...args }`, where `type` is `submit` (X01 visit score), `act` (game dart or button, with the game's `a` and `v`), or `undo`; `seat` is the player index the guest acts as; `ver` is the state version the guest saw.
- The host checks each input (see *Rules*) and applies it through the same functions a local tap uses: `submit()`, `undo()`, `gameAct()`, `gameUndo()`.
- After every change, at the existing `save()` hook, the host broadcasts `{ type: 'state', ver, state }` with the full match state (`S`) to every guest. Guests replace their copy and re-render. A match is a few kilobytes, so the full state is sent each time; a guest that missed a message is correct again on the next one.
- `ver` is a counter the host increments on every change. It is part of the broadcast state.

### Rules (pure functions, unit tested)

- `canAct(input, sender, state)`: the host itself may act for any seat at any time, including any undo. A guest may act only for a seat it has claimed, only when that seat is the one to throw, and only if `input.ver` equals the host's current `ver`.
- `canUndo(sender, state)`: a guest may undo its own seat's last visit only while the next player's turn is not yet complete. Once the next player has finished their visit, only the host can undo. In X01 a visit is entered in one go, so this means: until the next player's visit is entered. In the dart-by-dart games, the next player may already have entered some darts of their unfinished visit; the guest's undo then takes those darts back first, then the guest's own visit, and the next player's phone shows "<name> took back their visit".
- A rejected input gets `{ type: 'reject', reason }` back to that guest: `stale` (shows "Already scored"), `undo` (shows "Too late to undo here: ask the host"), `turn` or `seat` (ignored silently; can only happen through a race or a bug).
- Seat claims: a guest sends `{ type: 'claim', seats: [...] }`. A seat can be claimed by one phone at a time, never a bot seat, and never the host's own seat (seat 0, the first player, as the setup screen already makes the first player the person holding the device). One phone may claim several seats. Claims are kept in the broadcast state as `room.seats: { [seat]: peerId }` with a `room.online: { [peerId]: true }` presence map.

### Transport

- A transport is an object with `join(roomCode, onMessage, onPeer)`, `send(msg, toPeerId?)`, `leave()`. Two implementations:
  - `p2p`: [Trystero](https://github.com/dmotz/trystero) 0.26.0 (MIT), Nostr strategy, bundled into `web/vendor/` so nothing loads from a CDN. Phones find each other through several public Nostr relays at once, with the signalling encrypted by the room code, then talk over a direct WebRTC data channel. STUN: Trystero's defaults (Google's public STUN servers). No TURN server.
  - `local`: `BroadcastChannel`, same browser only, used by the browser test and selectable in development with `?transport=local`.
- Every message carries the app version (`APP_VERSION`). A guest whose version differs from the host's sees "Update Dartboss on this phone to join" and does not join.

### Where the code lives

- `src/room.js` (new): the rules above, the host and guest message handlers, the transport interface and both transports, reconnect logic. The build joins it after `games.js` and before `app.js`.
- `src/app.js`: setup switch, lobby panel, "Join a game" tile and screen, the guest's waiting state, connection dots, and hooks in `submit()`, `undo()`, `gameAct()`, `gameUndo()` and `save()` that route through the room when one is open.
- `web/vendor/trystero-nostr.mjs` and a small QR code generator (`qrcode-generator` 2.0.4, MIT), both bundled. `scripts/build.mjs` copies them, and `web/sw.js` caches them for offline use like the other assets.

## User flow

### Hosting

- The setup screen gets a switch, "Players on their own phones", shown for any game set up with 2 or more players.
- After Start, a lobby panel above the scoreboard shows a 6-letter room code (letters and digits without look-alikes, shown as `K7Q-M2P`), a QR code, and the join link `<site>/?join=K7QM2P`. It lists each seat and whether a phone has claimed it. The host can start throwing straight away; the panel folds into a small "Room K7Q-M2P · 2 phones" bar once the first visit is entered, and tapping it opens the panel again.

### Joining

- The main menu gets a "Join a game" tile: a code field and Join. Opening a join link, by scanning the QR code or tapping the link, opens the app on this screen with the code filled in and joins straight away.
- Once connected, the guest sees the seat list and taps the name or names they are playing as. Bot seats and seats another phone has claimed are greyed out.

### During the match

- Every phone shows the same live scoreboard.
- On a seat's turn, the phone that claimed it shows the keypad or game pad; other guest phones show "Waiting for <name>…" in place of the keypad.
- Players without a phone are normal: any seat no phone has claimed is played on the host, exactly as today. The host doesn't need every seat claimed to start or to continue, and a match can mix phone players, host-scored players and bots.
- The host's keypad is always active, so the host can score for any player: those without a phone, and those whose phone has a flat battery or a dropped connection.
- Undo: a guest can undo its own last visit only while the next player's turn is not yet complete (see `canUndo`). After that, the guest's Undo button is disabled and only the host can undo. The host can always undo anything.
- On the host's scoreboard, each claimed seat shows a connection dot: green when its phone is connected, grey when not.

### Dropouts and reconnecting

- A guest stores its room code and claimed seats (in `localStorage`, key `oche-room`). After a reload, app switch or network drop, it rejoins on its own, re-claims its seats, and the host sends it the current state.
- The host stores its room code with the saved match. If the host's app reloads, it reopens the same room and guests reconnect on their own.
- If the host has been unreachable for 10 seconds, guests show "Host disconnected" with Leave. The match lives on the host, so nothing is lost; play continues when the host is back.
- Leaving: a guest's Leave, or the host's Restart, Main menu or Discard, ends that phone's part in the room. When the host ends the room, guests see "The host ended the game".

### End of the match

- Every phone shows the result screen.
- Each guest also records the match in its own history, so its stats count it.
- Play again on the host starts a rematch in the same room; guests keep their seats.

## Privacy

- In this mode, player names and scores go only to the phones in the room, over an encrypted WebRTC link.
- To connect, phones exchange connection details, including IP addresses, through public Nostr relays (encrypted with the room code) and Google's public STUN servers. Neither the developer nor any server of the developer's receives or stores anything.
- The app connects only when someone starts or joins a shared game. Solo and single-phone play stay fully offline.
- `web/privacy.html` and `web/support.html` are updated to say this, in place of "never leaves your device". `store/app-store.md` keeps "Data not collected": the developer still collects nothing, and data shared directly between the users' own devices at their request is not collection.

## Native apps

- WebRTC works in the iOS (WKWebView, iOS 14.3 and later) and Android app views, so the same code runs in both apps. No new permissions.
- QR codes encode the website's join link. The phone's camera opens it in the browser, which runs the full app, so a guest doesn't need the app installed. Opening join links in the installed apps (universal links and app links) is not in scope.

## Errors

- No connection to the room within 15 seconds: "Couldn't reach the room. Check the code, and that both phones are online", with Retry.
- Some guest Wi-Fi and mobile networks block direct links, and there is no relay server by design. The support page says so and suggests the host's hotspot, or the host scoring for that player.
- Version mismatch: see *Transport*.
- Inputs from an unclaimed seat, out of turn, or against an old version: see *Rules*.

## Testing

- `scripts/test.mjs`: `canAct` for every case (host, own seat, other seat, wrong turn, stale version), `canUndo` (own visit before the next turn is complete, in X01 and in a dart-by-dart game with darts of the next visit entered; refused once the next visit is complete; the host always allowed), seat claims (bot, taken, host seat, several seats), version check, and `ver` increasing on every change.
- `scripts/e2e.mjs`: a host page and a guest page over the `local` transport. They play a full X01 match and a full Killer match with a mix of a phone player, a host-scored player and a bot, including a guest undo while the next turn is in progress, a guest undo refused after the next turn is complete, a guest reload that rejoins mid-match, and a stale input that is rejected. Both pages must end on the same result.
- Manual: a two-browser smoke test of the `p2p` transport through the public relays, and the owner's two-phone test on separate networks before release.
