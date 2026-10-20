# Generates the X01 caller clips in web/caller/. The voice is designed from a text description (no real
# person's voice) with VoxCPM2 (Apache-2.0); anchor.wav is that voice, and every clip clones it. 180.wav and
# 140.wav are the hand-picked takes. A clip is kept only when speech recognition hears the right words.
# Resumable: raw clips already in scripts/caller/raw/ are skipped. Apple Silicon (mlx-whisper), Python 3.12:
#   uv venv --python 3.12 && uv pip install voxcpm soundfile mlx-whisper && .venv/bin/python scripts/caller/generate.py
import gc, os, re, shutil, subprocess, warnings, torch, soundfile as sf, mlx_whisper
warnings.filterwarnings("ignore")
from voxcpm import VoxCPM
from voxcpm.modules.minicpm4 import MiniCPMModel
# The model reserves memory for 8192 tokens of speech; a call needs a few hundred. On a 16 GB Mac the full
# reservation (float32 on Apple GPUs) swaps and makes every clip take minutes.
_setup = MiniCPMModel.setup_cache
MiniCPMModel.setup_cache = lambda self, b, n, *a, **k: _setup(self, b, min(n, 1024), *a, **k)
HERE = os.path.dirname(os.path.abspath(__file__)); RAW = f"{HERE}/raw"; OUT = f"{HERE}/../../web/caller"
os.makedirs(RAW, exist_ok=True); os.makedirs(OUT, exist_ok=True)
ONES = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split()
TENS = "_ _ twenty thirty forty fifty sixty seventy eighty ninety".split()
def words(n):
  if n < 20: return ONES[n]
  if n < 100: return TENS[n // 10] + ("-" + ONES[n % 10] if n % 10 else "")
  return "one hundred" + (" and " + words(n % 100) if n % 100 else "")
IMPOSSIBLE = {163, 166, 169, 172, 173, 175, 176, 178, 179}          # no three darts make these
NO_CHECKOUT = {159, 162, 163, 165, 166, 168, 169}                  # bogey numbers on a double out
SHOUT = "(shouting with excitement to a big crowd, drawing out the last word)"
def num_re(n): return rf"({words(n).replace('-', ' ')}|{n})"
jobs = {"noscore": ("No score.", r"^no score$"), "bust": ("Bust.", r"^bust$"), "gameshot": ("Game shot!", r"^game ?shot$")}
for n in range(1, 180):
  if n in IMPOSSIBLE: continue
  jobs[str(n)] = ((SHOUT if n >= 140 else "") + words(n).capitalize() + ("!" if n >= 140 else "."), rf"^{num_re(n)}$")
for n in range(2, 171):
  if n not in NO_CHECKOUT: jobs[f"req-{n}"] = (f"You require {words(n)}.", rf"^you require {num_re(n)}$")
norm = lambda s: re.sub(r"[^a-z0-9 ]", "", s.lower().replace("-", " ")).strip()
m = VoxCPM.from_pretrained("openbmb/VoxCPM2", load_denoiser=False); sr = m.tts_model.sample_rate
for k in ("180", "140"): shutil.copy(f"{HERE}/{k}.wav", f"{RAW}/{k}.wav")
print(len(jobs) + 1, "clips", flush=True)
jobs.pop("140")
for k, (text, want) in jobs.items():
  p = f"{RAW}/{k}.wav"
  if os.path.exists(p): continue
  for seed in range(1, 9):
    torch.manual_seed(seed)
    tmp = f"{RAW}/.{k}.wav"; sf.write(tmp, m.generate(text=text, max_len=600, reference_wav_path=f"{HERE}/anchor.wav"), sr)
    h = norm(mlx_whisper.transcribe(tmp, path_or_hf_repo="mlx-community/whisper-small-mlx", language="en")["text"])
    if re.search(want, h): os.rename(tmp, p); print(k, seed, "OK", repr(h), flush=True); gc.collect(); torch.mps.empty_cache(); break
    print(k, seed, "retry", repr(h), flush=True)
    gc.collect(); torch.mps.empty_cache()
  else: print(k, "FAILED", flush=True)

# The PA sound: low rumble cut, presence lift, compression, a short hall; silence trimmed so calls start at once
PA = ("silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse,"
      "highpass=f=90,equalizer=f=250:t=q:w=1:g=-2,equalizer=f=3200:t=q:w=1:g=3,"
      "acompressor=threshold=-20dB:ratio=3:attack=5:release=120,aecho=0.9:0.5:35|70|120:0.18|0.12|0.07,loudnorm=I=-16")
for f in sorted(os.listdir(RAW)):
  if f.endswith(".wav") and not f.startswith("."):
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", f"{RAW}/{f}", "-af", PA, "-ac", "1", "-ar", "24000", "-b:a", "48k", f"{OUT}/{f[:-4]}.mp3"], check=True)
