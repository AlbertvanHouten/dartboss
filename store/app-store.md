# App Store Connect listing

Copy these into App Store Connect. Character limits are Apple's; counts are noted where they matter.
Items marked **(you)** need your decision or details.

## App information

| Field | Value |
|---|---|
| Name (30) | Oche Scorer |
| Subtitle (30) | Darts scorer with real bots |
| Bundle ID | com.albertvanhouten.oche **(you: change in `capacitor.config.json` and Xcode before the first upload if you want another)** |
| SKU | oche-scorer-ios |
| Primary category | Sports |
| Secondary category | Games › Sports |
| Content rights | Contains no third-party content |
| Age rating | 4+ (answer "None" to every question) |
| Price | **(you)** Free is suggested |
| Copyright | 2026 **(you: your full name)** |

## Version information

**Promotional text (170)**

> Score every leg, check out with the right route, track your history and stats, and practise with bots that throw like real players.

**Description (4000)**

> Oche Scorer is a darts scorer and trainer for your board at home or at the club.
>
> MATCHES
> • X01: 301, 501, 701 or any start score. Straight, double or master in and out. Legs or sets, first to or best of, two clear legs.
> • Cricket, Killer, Shanghai and Halve It, for 2 to 6 players.
> • A checkout route for every finishable score, coloured by the ring you aim at.
>
> PRACTICE
> • 121 Checkout with safehouse rules
> • Around the Clock, Bob's 27, Doubles and Singles Training
> • Score Training, from 10 visits to unlimited
> • Personal bests for every game and setting

HISTORY AND STATS
• Match history saved on your device
• Lifetime player stats across all your matches
• Share results with a tap
>
> BOTS THAT PLAY LIKE PEOPLE
> Set a bot to any average from 20 to 120. Every dart is thrown at a regulation board: misses go up and down more than sideways, darts group within a visit, form comes and goes, and weaker bots tighten up on the doubles. Each bot has a favourite double and its own habits.
>
> MADE FOR THE OCHE
> • Big numbers you can read from the throwing line
> • A chalker's score sheet and full match stats: 3-dart average, first 9, checkout %, 100+, 140+ and 180s
> • Keeps the screen awake during a match (you can turn this off)
> • Light and dark mode, iPhone and iPad
> • Works completely offline. No account, no ads, no tracking.

**Keywords (100)** — 93 characters

```
darts,dart,501,x01,cricket,checkout,killer,shanghai,practice,trainer,bot,history,stats,bobs27
```

**What's New (first version)**

> First release.

**Support URL** **(you)**: `https://<your-site>/support.html` (the page ships with the web build; replace `SUPPORT_EMAIL` on it first)

**Marketing URL** (optional): the same

**Privacy Policy URL** **(you)**: `https://<your-site>.netlify.app/privacy.html` (the page ships with the web build)

## App Privacy

Choose **"Data Not Collected"**. The app has no accounts, analytics, ads or network calls; saved games stay
on the device (declared in `ios/App/App/PrivacyInfo.xcprivacy`).

## Screenshots

In `store/screenshots/`, rendered at Apple's required sizes (regenerate with `npm run screenshots`):

- iPhone 6.9" display: `iphone-6.9/` (1320 × 2868)
- iPad 13" display: `ipad-13/` (2064 × 2752)

Order and caption suggestions:

1. `x01-match`: "Score every visit, with checkout routes shown for you"
2. `menu`: "X01, Cricket, Killer and more, against friends or bots"
3. `history`: "Every match saved, with full leg-by-leg detail"
4. `stats`: "Track your average, checkout rate and form over time"
5. `cricket`: "Play Cricket against a bot set to any average"
6. `match-settings`: "Set legs, sets, in and out rules your way"
7. `killer`: "Party games for up to six players on one device"

## App Review notes

> No login is needed. Everything works offline. To try the main flow: tap X01, then Start, and type a visit
> score on the keypad (for example 100, then Score). The bot opponent throws its visit automatically.
> Saved games, match history, player stats
> and personal bests are stored on the device only. All data is local, and Settings has "Reset all data".

## Export compliance

The app uses no non-exempt encryption. `ITSAppUsesNonExemptEncryption` is set to `NO` in Info.plist, so
App Store Connect won't ask on each upload.
