# Development

The game is plain HTML, CSS and JavaScript with no framework or bundler. The build joins the source files into one page and wraps it as a web app; Capacitor puts that into the iOS project.

## Project layout

| Path | What it is |
|---|---|
| `src/` | The game: `head.html`, `style.css`, `body.html`, `engine.js`, `games.js`, `app.js` (the build joins them into one page) |
| `web/` | Files for the standalone app: `native.js` (iOS bridge, offline cache), `sw.js`, `manifest.webmanifest`, `privacy.html`, `support.html`, icons, bundled fonts |
| `scripts/build.mjs` | Builds `dist/` from `src/` and `web/`, plus `dist/oche.html` for the Claude artifact preview |
| `scripts/test.mjs` | Checks without a browser: scripts parse, checkout routes, bot averages, every game finishes |
| `scripts/screenshots.mjs` | App Store screenshots of `dist/` in Chrome at Apple's sizes |
| `scripts/make-icons.swift` | Draws the app icon, maskable icon and launch image |
| `scripts/fetch-fonts.mjs` | Downloads the Google Fonts into `web/fonts` (Open Font License) |
| `capacitor.config.json` | App ID, name and web directory for the iOS app |
| `ios/` | The Xcode project (Capacitor 8, Swift Package Manager) |
| `store/` | App Store listing text, screenshots and launch image |
| `docs/` | These documentation pages |
| `netlify.toml` | Web hosting config |

## Commands

```bash
npm install            # once
npm test               # quick checks
npm run test:e2e       # plays a match in headless Chrome (run npm run build first)
npm run serve          # build and serve dist/ at http://127.0.0.1:8765
npm run ios:sync       # build and copy into the iOS project
npm run ios:open       # open the project in Xcode
npm run screenshots    # regenerate App Store screenshots
npm run icons          # redraw icons and launch image
```

After changing `src/` or anything in `web/`, run `npm run ios:sync` before building in Xcode.

## How the code fits together

- **`src/engine.js`** (`E`): the board, checkout routes, visit validation, the bot model and X01 stats.
- **`src/games.js`** (`GAMES`): one object per game besides X01, all with the same functions (`init`, `act`, `done`, `result`, `botVisit`, `hud`, `pad`, `board`, `log`), so the app handles every game the same way.
- **`src/app.js`**: the state `S` (the match in progress), the screens (menu, play, history, stats, settings), X01 scoring, undo, history, stats and settings.
- The three scripts are classic scripts that share globals, in that order.
- **`web/native.js`** connects the game to the platform through `window.ocheNative`: native storage, haptics, keep-awake and share in the iOS app, and the offline cache on the web.

## Data

Everything is stored on the device, in `localStorage` (mirrored to native storage in the iOS app):

| Key | What |
|---|---|
| `oche-match-v1` | the match in progress |
| `oche-history-v1` | finished matches and games (the last 300) |
| `oche-bests` | personal bests |
| `oche-settings-v1` | theme, haptics, keep-awake |

Lifetime stats are worked out from the history when the Stats screen opens.

## Notes

- Scores, the match in progress, history, settings and personal bests are saved on the device: in browser storage on the web, and also in native storage in the iOS app. Nothing leaves the device.
- `dist/oche.html` contains the page content only, without its own `<html>`/`<head>` wrapper, because it is written for Claude's artifact hosting. Browsers still open it fine; `dist/index.html` is the full document.
