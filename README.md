# Oche Scorer

A darts scorer and trainer that runs as a website (installable, works offline) and as an iOS app, from one source file.

- **`oche.html`** is the whole game. It also opens directly in a browser, and it is the version published as a Claude artifact.
- **`npm run build`** wraps it into `dist/`: a full web app with manifest, icons, bundled fonts and an offline cache.
- **Capacitor** puts `dist/` into the native iOS project in `ios/`, with haptics and native storage.

## Games

**Matches**, against bots or friends on the same device:

- **X01** (1–4 players):
  - Start score 301, 501, 701 or any custom score.
  - Straight, double or master in, and straight, double or master out. Master means a double or treble.
  - Legs or sets, played first to or best of, with an optional two-clear rule.
  - Player 1 or a random player throws first.
  - Shows a checkout route for every finishable score.
- **Cricket** (2 players): 15–20 and the bull, with marks per round.
- **Killer** (2–6 players): random numbers and 3 lives. Hit your own double to become a killer.
- **Shanghai** (1–6 players):
  - Numbers 1–7 or 1–20. A single, double and treble in one visit wins outright.
  - Optional "require number" (miss the number and your score halves) or "require treble" (no treble and your score resets).
- **Halve It** (1–6 players):
  - The standard 12 rounds: numbers, any double, any treble, different colours, same colour, an exact total, and the bull. Or the classic 9-round version, or random order.
  - Miss a target and your score halves.

**Practice**, with personal bests per setting:

- **121 Checkout:**
  - Start target, darts per attempt (3–15), how much the target goes up, and 10, 25 or unlimited rounds.
  - Safehouse rule: what score a miss sends you back to.
- **Around the Clock** (1–4 players, bots allowed):
  - Which segments count, hits needed per target, and which bull counts.
  - Doubles and trebles can skip ahead.
  - Low to high, high to low, or random order.
- **Bob's 27** (1–4 players, bots allowed): hard mode (out below zero) or easy mode (play on).
- **Doubles Training:**
  - Stay on each double until you hit it, or throw three darts at each.
  - With or without the bull, in any order.
- **Singles Training:** any order.
- **Score Training:** 10, 20 or 33 visits, or unlimited.

## The bot

You set each bot to a target 3-dart average from 20 to 120. Every dart is thrown at a regulation-size board, and the bot is meant to play like a real person.

**How it throws**

- Darts scatter mostly up and down. Sideways misses happen too, and get rarer with skill.
- Most darts are tight, but about one in seven comes out loose.
- The three darts of a visit share part of their error, so they group together. Good visits are tight and bad ones are all off.
- Form carries over from visit to visit, so bots have hot and cold patches.
- Darts already in the board can deflect or knock out a new dart, and a dart that lands on a wire can bounce out.
- Darts at a finishing double get extra scatter. That penalty is large for weak players and small for strong ones, and it grows under pressure: when the opponent is on a finish, or on a match dart.

**How it thinks**

- Each bot has its own habits for the match: a favourite double (usually 16 or 20) and a scoring bed (a few are 19 shooters).
- Weaker bots avoid bull finishes, and prefer a big single over a treble when setting up.
- Bots never leave a bogey number, and set up their favourite double with their last dart.
- When two darts already crowd the treble, better bots sometimes switch to another bed.
- Players are sharpest on their own scoring bed. Other numbers and the bull get extra scatter: a lot for club players, little for pros.
- Outside X01, bots aim by expected value. They sample their own scatter and pick the target that pays best for the game and the moment. So in Halve It and Shanghai, weak bots go for the big single and strong ones go for the treble. In Halve It, bots protect against being halved before chasing points.
- In Cricket, beginners (under a 45 average) close the numbers in order. Better bots cover numbers you're scoring on, score while behind, and close out once a lead is safe.
- Pressure applies in every game: X01 match darts, the end of a Cricket game, Killer on your last life, the final rounds of Shanghai and Halve It.

**Calibration**

The scatter values were fitted by simulating full 501 legs, so each average comes with a realistic checkout % (about 4% at a 20 average, about 48% at 120). Per leg, the results look like this:

| Average | 180s | 140+ visits | 100+ visits | Checkout % |
|---|---|---|---|---|
| 60 | 0.02 | 0.32 | 1.45 | 20% |
| 100 | 0.22 | 1.01 | 1.59 | 44% |

Bounce-outs happen on about 0.2–0.8% of darts. Per dart, a 100-average bot hits T20 about 48% of the time and its doubles about 45%.

Other games use the same throwing, so a bot's average carries over:

| Average | Cricket marks per round | Shanghai score | Halve It score |
|---|---|---|---|
| 45 | 1.8 | 52 | 187 |
| 60 | 2.4 | 65 | 319 |
| 90 | 4.7 | 78 | 757 |

Cricket matches league figures for club players. Above about a 75 average it follows the bot's treble accuracy, which comes out above the rough league reference I used.

In X01 the bot throws dart by dart at a natural pace, pausing before a double.

## Project layout

| Path | What it is |
|---|---|
| `oche.html` | The game: engine, bots, games and interface in one file |
| `web/` | Files for the standalone app: `native.js` (iOS bridge, offline cache), `sw.js`, `manifest.webmanifest`, `privacy.html`, icons, bundled fonts |
| `scripts/build.mjs` | Builds `dist/` from `oche.html` and `web/` |
| `scripts/test.mjs` | Checks without a browser: scripts parse, checkout routes, bot averages, every game finishes |
| `scripts/screenshots.mjs` | App Store screenshots of `dist/` in Chrome at Apple's sizes |
| `scripts/make-icons.swift` | Draws the app icon, maskable icon and launch image |
| `scripts/fetch-fonts.mjs` | Downloads the Google Fonts into `web/fonts` (Open Font License) |
| `capacitor.config.json` | App ID, name and web directory for the iOS app |
| `ios/` | The Xcode project (Capacitor 8, Swift Package Manager) |
| `store/` | App Store listing text, screenshots and launch image |
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

After changing `oche.html` or anything in `web/`, run `npm run ios:sync` before building in Xcode.

## Web version

Hosting from a private repo, with Netlify:

1. On netlify.com, choose *Add new site → Import an existing project*, and connect GitHub and the `oche-darts` repo.
2. Netlify reads `netlify.toml`: build command `npm run build`, publish directory `dist`. Deploy.
3. Optional: add your own domain under *Domain management*.

Cloudflare Pages works the same way, with build command `npm run build` and output directory `dist`.

Every push to `main` redeploys. You can also deploy from GitHub Actions instead (see CI/CD below). Installed copies pick up a new version on their next launch after it has downloaded.

## CI/CD

GitHub Actions workflows in `.github/workflows/`:

| Workflow | Runs on | What it does |
| --- | --- | --- |
| `ci.yml` | every pull request | `npm test`, builds the web app, checks the build, plays a match in headless Chrome, keeps `dist/` as a downloadable artifact for 7 days |
| `deploy-web.yml` | push to `main`, or by hand | runs CI, then publishes `dist/` to Netlify |
| `ios-release.yml` | a `v*` tag, or by hand | runs CI, then archives the iOS app on a Mac runner and uploads it to TestFlight |

Neither publishing workflow fails while its secrets are missing. The web deploy is skipped with a note, and the iOS release only compiles the app for the Simulator.

Secrets go under *Settings → Secrets and variables → Actions* on GitHub:

| Secret | Where to get it |
| --- | --- |
| `NETLIFY_AUTH_TOKEN` | Netlify: *User settings → Applications → Personal access tokens* |
| `NETLIFY_SITE_ID` | Netlify: *Site configuration → Site details → Site ID* |
| `APPLE_TEAM_ID` | developer.apple.com → *Membership details* |
| `APP_STORE_CONNECT_KEY_ID` | App Store Connect: *Users and Access → Integrations → App Store Connect API*. Make a key with the App Manager role. |
| `APP_STORE_CONNECT_ISSUER_ID` | Shown on that same page |
| `APP_STORE_CONNECT_KEY` | The full text of the downloaded `AuthKey_XXXX.p8` file. Apple lets you download it only once. |

Xcode signs automatically with the API key, so no certificates or profiles need storing.

To release the iOS app:

```bash
git tag v1.1 && git push origin v1.1
```

That ships version 1.1, with the build number taken from the run number. You can also run *iOS release* from the Actions tab: it keeps the project's version, and with *Upload* unticked it produces a signed `.ipa` to download instead of uploading.

The app still has to exist in App Store Connect before the first upload (step 2 below).

Two things to know:
- Mac runner minutes count 10× against the free Actions quota on private repos, so the iOS workflow doesn't run on ordinary pushes.
- If you also connect the repo in Netlify's own UI, turn off Netlify's automatic builds, so each push deploys only once.

## iOS app

### Already done

- Capacitor iOS project with the Haptics and Preferences plugins (Swift Package Manager, no CocoaPods)
- App icon (1024 px, no transparency) and a dark launch screen
- `PrivacyInfo.xcprivacy`: no tracking, no data collected, UserDefaults access declared (reason CA92.1)
- `ITSAppUsesNonExemptEncryption = NO`, so there's no export-compliance question on upload
- Bundle ID `com.albertvanhouten.oche`, version 1.0 (1), iPhone and iPad, iOS 15+
- Builds and runs in the Simulator: saving to native storage and haptics checked
- Store listing text in `store/app-store.md`, screenshots in `store/screenshots/`

### Your steps (signing onwards)

1. Join the Apple Developer Program at developer.apple.com ($99 a year).
2. In App Store Connect, under *Apps → +*, create the app: name, primary language, bundle ID `com.albertvanhouten.oche` (register it first under *Certificates, IDs & Profiles → Identifiers* if it isn't listed), and SKU `oche-scorer-ios`.
3. Run `npm run ios:sync`, then `npm run ios:open`.
4. In Xcode, select the **App** target → *Signing & Capabilities* → tick *Automatically manage signing* and choose your **Team**.
5. Optional: try it on your own iPhone. Connect it, pick it as the run destination, and press Run.
6. Set the destination to *Any iOS Device (arm64)*, then choose *Product → Archive*. In the Organizer, *Distribute App → App Store Connect → Upload*.
7. In App Store Connect, fill in the listing from `store/app-store.md`, upload the screenshots, set App Privacy to *Data Not Collected*, add the privacy policy URL (`https://<your-site>/privacy.html`), pick the build, and *Submit for Review*.
8. Optional: test with friends first through TestFlight, using the same uploaded build.

### Releasing an update

With the CI secrets set, push a tag such as `v1.1` (see CI/CD). By hand: bump `MARKETING_VERSION` (for example 1.1) and `CURRENT_PROJECT_VERSION` (+1 each upload) in Xcode under the target's *General* tab, then `npm run ios:sync`, archive and upload again.

## Notes

- Scores, the match in progress and personal bests are saved on the device: in browser storage on the web, and also in native storage in the iOS app. Nothing leaves the device.
- `oche.html` contains the page content only, without its own `<html>`/`<head>` wrapper, because it was written for Claude's artifact hosting. Browsers still open it fine; `npm run build` adds the full document.
