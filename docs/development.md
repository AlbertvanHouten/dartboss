# Development

The game is plain HTML, CSS and JavaScript with no framework or bundler. The build joins the source files into one page and wraps it as a web app; Capacitor puts that into the iOS and Android projects.

## Project layout

| Path | What it is |
|---|---|
| `src/` | The game: `head.html`, `style.css`, `body.html`, `i18n.js`, `engine.js`, `games.js`, `app.js` (the build joins them into one page) |
| `web/` | Files for the standalone app: `native.js` (native bridge, offline cache), `sw.js`, `manifest.webmanifest`, `privacy.html`, `support.html`, icons, bundled fonts, `vendor/` (Trystero and the QR generator), `caller/` clips |
| `scripts/build.mjs` | Builds `dist/` from `src/` and `web/`, plus `dist/oche.html` for the Claude artifact preview |
| `scripts/test.mjs` | Checks without a browser: scripts parse, checkout routes, bot averages, every game finishes, every string translated |
| `scripts/screenshots.mjs` | App Store screenshots of `dist/` in Chrome at Apple's sizes |
| `scripts/make-icons.swift` | Draws the app icon, maskable icon and launch image |
| `scripts/android-icons.sh` | Writes the Android launcher icons (legacy and adaptive) from the same artwork |
| `scripts/caller/` | Generates the caller clips (see [the caller](caller.md)) |
| `scripts/fetch-fonts.mjs` | Downloads the Google Fonts into `web/fonts` (Open Font License) |
| `scripts/vendor.mjs` | Bundles Trystero (Nostr) and copies qrcode-generator into `web/vendor` (MIT) |
| `capacitor.config.json` | App ID, name and web directory for the iOS and Android apps |
| `ios/` | The Xcode project (Capacitor 8, Swift Package Manager) |
| `android/` | The Android Studio / Gradle project (Capacitor 8) |
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
npm run android:sync   # build and copy into the Android project
npm run android:open   # open the project in Android Studio
npm run android:build  # sync, then a debug APK in android/app/build/outputs/apk/debug/
npm run screenshots    # regenerate App Store screenshots
npm run vendor         # rebuild web/vendor (Trystero, QR generator) after changing their versions
npm run icons          # redraw icons and launch image
npm run icons:android  # redraw the Android launcher icons (after npm run icons)
```

After changing `src/` or anything in `web/`, run `npm run ios:sync` before building in Xcode, or `npm run android:sync` before building for Android.

### Android

Building for Android needs JDK 21 and the Android SDK (platform 36). The easiest way to get both is Android Studio, which bundles a JDK:

```bash
brew install --cask android-studio
```

Open it once and let the setup wizard install the SDK, then point the command line at both (add these to `~/.zshrc`):

```bash
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
export ANDROID_HOME="$HOME/Library/Android/sdk"
```

Without Android Studio (smaller; no emulator), Homebrew has both pieces:

```bash
brew install openjdk@21 && brew install --cask android-commandlinetools
yes | sdkmanager --sdk_root="$HOME/Library/Android/sdk" --licenses
sdkmanager --sdk_root="$HOME/Library/Android/sdk" "platform-tools" "platforms;android-36" "build-tools;36.0.0"
```

with `JAVA_HOME="/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home"` instead of the path above. Gradle downloads any other SDK pieces it needs on the first build.

Then `cd android && ./gradlew assembleDebug` (or `npm run android:build`) writes `app-debug.apk`. To run it, start an emulator from Android Studio's Device Manager, or plug in a phone with USB debugging on, and press Run in Android Studio.

## How the code fits together

- **`src/i18n.js`**: the translations (`STRINGS`, one table per language) and `t(key, vars)`, see [Translations](#translations).
- **`src/engine.js`** (`E`): the board, checkout routes, visit validation, the bot model and X01 stats.
- **`src/games.js`** (`GAMES`): one object per game besides X01, all with the same functions (`init`, `act`, `done`, `result`, `botVisit`, `hud`, `pad`, `board`, `log`), so the app handles every game the same way.
- **`src/app.js`**: the state `S` (the match in progress), the screens (menu, play, history, stats, settings), X01 scoring, undo, history, stats and settings.
- The four scripts are classic scripts that share globals, in that order.
- **`web/native.js`** connects the game to the platform through `window.ocheNative`: native storage, haptics, keep-awake and share in the iOS and Android apps, and the offline cache on the web. On Android it also routes the hardware back button to `window.ocheBack` in `app.js` (close a dialog, else go to the menu, else leave the app) and keeps the system bar icons in step with the in-app theme.

## Data

Everything is stored on the device, in `localStorage` (mirrored to native storage in the iOS and Android apps):

| Key | What |
|---|---|
| `oche-match-v1` | the match in progress |
| `oche-history-v1` | finished matches and games (the last 300) |
| `oche-bests` | personal bests |
| `oche-settings-v1` | theme, language, haptics, keep-awake |

Lifetime stats are worked out from the history when the Stats screen opens.

## Translations

The app speaks English, Dutch and German. The English text is the key: code calls `t('Undo')` or `t('{n} left', { n: 121 })`, and `t()` looks the text up in `STRINGS[LANG]` in `src/i18n.js`, falling back to the English. Game names, rules and option labels stay English in `src/games.js` and go through `t()` where they are shown; static markup in `src/body.html` is marked with `data-t` (text) or `data-ta="aria-label"` (an attribute). The Language setting (System, English, Nederlands, Deutsch) switches at once and sets `<html lang>`; System follows the browser's language.

To add a language: add it to `LANGS` in `src/i18n.js` and give it a table with the same keys as `nl`. `npm test` fails on a missing key or a placeholder that doesn't match the English.

## Notes

- Scores, the match in progress, history, settings and personal bests are saved on the device: in browser storage on the web, and also in native storage in the iOS and Android apps. Nothing leaves the device.
- `dist/oche.html` contains the page content only, without its own `<html>`/`<head>` wrapper, because it is written for Claude's artifact hosting. Browsers still open it fine; `dist/index.html` is the full document.
