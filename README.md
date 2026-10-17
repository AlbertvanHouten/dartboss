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

## Notes

- Scores, the match in progress and personal bests are saved in your browser's local storage. Nothing leaves your device.
- The file contains the page content only, without its own `<html>`/`<head>` wrapper, because it was written for Claude's artifact hosting. Browsers still open it fine.
