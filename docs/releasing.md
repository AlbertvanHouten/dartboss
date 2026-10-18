# Releasing

How the web version is hosted, what the GitHub Actions workflows do, and how the iOS app gets to the App Store.

## Before the first submission

- Replace `SUPPORT_EMAIL` in `web/support.html` and `web/privacy.html`.
- Once the app exists in App Store Connect, set `APP_STORE_ID` in `src/app.js` to turn on the rate button.

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
- Keep Awake (`@capacitor-community/keep-awake`) and Share (`@capacitor/share`) plugins, used through `window.ocheNative` (neither needs privacy manifest or Info.plist entries)
- App icon (1024 px, no transparency) and a dark launch screen
- `PrivacyInfo.xcprivacy`: no tracking, no data collected, UserDefaults access declared (reason CA92.1)
- `ITSAppUsesNonExemptEncryption = NO`, so there's no export-compliance question on upload
- Bundle ID `com.albertvanhouten.oche`, version 1.0.0 (1), iPhone and iPad, iOS 15+
- Builds and runs in the Simulator: saving to native storage and haptics checked
- Store listing text in `store/app-store.md`, screenshots in `store/screenshots/`

### Your steps (signing onwards)

1. Join the Apple Developer Program at developer.apple.com ($99 a year).
2. In App Store Connect, under *Apps → +*, create the app: name, primary language, bundle ID `com.albertvanhouten.oche` (register it first under *Certificates, IDs & Profiles → Identifiers* if it isn't listed), and SKU `oche-scorer-ios`.
3. Run `npm run ios:sync`, then `npm run ios:open`.
4. In Xcode, select the **App** target → *Signing & Capabilities* → tick *Automatically manage signing* and choose your **Team**.
5. Optional: try it on your own iPhone. Connect it, pick it as the run destination, and press Run.
6. Set the destination to *Any iOS Device (arm64)*, then choose *Product → Archive*. In the Organizer, *Distribute App → App Store Connect → Upload*.
7. In App Store Connect, fill in the listing from `store/app-store.md`, upload the screenshots, set App Privacy to *Data Not Collected*, add the privacy policy URL (`https://<your-site>/privacy.html`) and support URL (`https://<your-site>/support.html`), pick the build, and *Submit for Review*.
8. Optional: test with friends first through TestFlight, using the same uploaded build.

### Releasing an update

With the CI secrets set, push a tag such as `v1.1` (see CI/CD). By hand: bump `MARKETING_VERSION` (for example 1.1) and `CURRENT_PROJECT_VERSION` (+1 each upload) in Xcode under the target's *General* tab, then `npm run ios:sync`, archive and upload again.
