# Oche Scorer

A darts scoring app in a single HTML file. It needs no build step and no server: open `oche.html` in a browser.

## Games

**Matches**, against bots or friends on the same device:

- **X01**: 301, 501 or 701, double or single out, first to 1–7 legs, 1–4 players. Shows a checkout route for every finishable score.
- **Cricket**: 15–20 and the bull, with marks per round. 2 players.
- **Killer**: random numbers and 3 lives. Hit your own double to become a killer. 2–6 players.
- **Shanghai**: rounds 1–7, and a single, double and treble in one visit wins. 1–6 players.
- **Halve It**: 15, 16, any double, 17, 18, any treble, 19, 20, bull. Miss the target and your score halves. 1–6 players.

**Practice**, solo with personal bests:

- 121 Checkout
- Around the Clock
- Bob's 27
- Doubles Training
- Singles Training
- Score Training (99 darts)

## The bot

You set each bot to a target 3-dart average from 20 to 120. Every dart is thrown at a regulation-size board:

- Darts scatter around the aim point, mostly up and down. Occasional sideways misses get rarer with skill.
- Form varies from visit to visit.
- Darts at a finishing double get extra scatter.

The scatter values were fitted by simulating full 501 legs, so that each average also gives a realistic checkout %. That runs from about 4% at a 20 average to about 44% at 120. Weaker bots score their way down quickly and then struggle on the double, as real players do.

## Notes

- Scores, the match in progress and personal bests are saved in your browser's local storage. Nothing leaves your device.
- The file contains the page content only, without its own `<html>`/`<head>` wrapper, because it was written for Claude's artifact hosting. Browsers still open it fine.
