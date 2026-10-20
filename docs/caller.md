# The caller

In X01 a caller announces each visit, the way a referee does on stage: the score (or "No score", "Bust"),
"Game shot!" on a checkout, and "You require …" when the next player is on a finish. It is on by default
and can be turned off in Settings.

## How a call sounds

- Standard scores are quick and plain. Only 140 and up get a shout, and 180 is the big one.
- Every clip goes through a PA and hall sound: low rumble cut, a presence lift, compression and a short echo.
- The voice is designed from a text description with [VoxCPM2](https://github.com/OpenBMB/VoxCPM)
  (Apache-2.0, commercial use allowed). It is not a copy of any real person's voice.

## Files

| | |
|---|---|
| `web/caller/` | The clips the app plays: `0`–`179` (scores three darts can make, `noscore` for 0), `180`, `bust`, `gameshot`, `req-2`–`req-170` (every double-out finish) |
| `scripts/caller/anchor.wav` | The designed voice; every clip clones it so the speaker stays the same |
| `scripts/caller/140.wav`, `180.wav` | The hand-picked takes for those two calls |
| `scripts/caller/generate.py` | Regenerates every clip, keeping only takes speech recognition hears correctly |

The app plays them with Web Audio, unlocked by the first tap, so bot visits are called too. The web
version caches each clip the first time it plays.

## Regenerating

Needs Apple Silicon, Python 3.12, `uv` and `ffmpeg`. Delete `scripts/caller/raw/` to start over; otherwise
only missing clips are made.

```bash
uv venv --python 3.12 && uv pip install voxcpm soundfile mlx-whisper
.venv/bin/python scripts/caller/generate.py
```
