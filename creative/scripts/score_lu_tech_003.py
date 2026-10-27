# One evolving score for LU-TECH-003, from the hook to the start of the ending (the ending keeps its own approved sound).
# Owner notes 2026-10-27: per-scene loops were too repetitive and too loud under the voice. So: the approved hook sound,
# then a pad that changes chord per section with a different lead each time (arpeggio, plucks, tremolo strings), a soft
# whoosh at each section change, and the whole score ducked under the narration.
# Run: blender -b --factory-startup --python score_lu_tech_003.py -- <repo root> <out.wav>
import json, os, sys, wave
import numpy as np

root, out = sys.argv[sys.argv.index('--') + 1:][:2]
S = os.path.join(root, 'storage', 'creative')
timing = json.load(open(os.path.join(S, 'narration-timing.json'), encoding='utf-8'))
_base = os.path.join(root, 'storage', 'episodes', 'LU-TECH-003')
_v = sorted((int(d[1:]), d) for d in os.listdir(_base) if d.startswith('v') and d[1:].isdigit() and os.path.isdir(os.path.join(_base, d, 'narration')))[-1][1]
_folder = os.path.join(_base, _v, 'narration')
voice_path = os.path.join(_folder, next(f for f in sorted(os.listdir(_folder)) if f.endswith('.wav')))   # newest version's narration
SR = 48000
starts = {}
for s in timing:
    starts.setdefault(s['beat'], s['start'])
b1, b2, b3 = starts[1], starts[2], starts[3]
never = next(s['start'] for s in timing if s['text'].startswith('Or never'))
END = starts[5]                                         # the ending clip (and its sound) starts with the twist
t = np.arange(int(SR * END)) / SR
rng = np.random.default_rng(3)
mix = np.zeros((len(t), 2))

def read_wav(path):
    with wave.open(path) as w:
        a = np.frombuffer(w.readframes(w.getnframes()), '<i2').astype(np.float32) / 32768
        return a.reshape(-1, w.getnchannels())

def lowpass(x, cutoff):
    c = np.broadcast_to(np.asarray(cutoff, dtype=float), x.shape)
    a = np.exp(-2 * np.pi * c / SR); y = np.empty_like(x); acc = 0.0
    for i in range(len(x)):
        acc = (1 - a[i]) * x[i] + a[i] * acc; y[i] = acc
    return y

def section(a, b, fade=0.6):
    """1 inside [a, b), with short fades at both ends."""
    return np.clip((t - a) / fade, 0, 1) * np.clip((b - t) / fade, 0, 1)

def add(sig, gain, pan=0.0):
    mix[:, 0] += sig * gain * (1 - max(pan, 0)); mix[:, 1] += sig * gain * (1 + min(pan, 0))

def hz(note):                                           # 'A2' -> Hz
    names = {'C': -9, 'D': -7, 'E': -5, 'F': -4, 'G': -2, 'A': 0, 'B': 2}
    semis = names[note[0]] + (1 if '#' in note else 0) + 12 * (int(note[-1]) - 4)
    return 440.0 * 2 ** (semis / 12)

def reverb(x, seconds=1.4, mix_amt=0.35):
    n = int(seconds * SR); ir = rng.standard_normal(n) * np.exp(-6 * np.arange(n) / n)
    ir /= np.sqrt((ir ** 2).sum()); L = len(x) + n
    wet = np.fft.irfft(np.fft.rfft(x, L) * np.fft.rfft(ir, L), L)[: len(x)]
    return x * (1 - mix_amt) + wet * mix_amt

# 1. hook: the approved opening-shot sound, as is
hook = read_wav(os.path.join(S, 'shot01-sound.wav'))
n = min(len(hook), int(b1 * SR)); fade = np.clip((b1 - t[:n]) / 0.4, 0, 1)[:, None]
mix[:n] += hook[:n] * fade * 1.0

# 2. pad under everything after the hook, one chord per section (A minor -> F -> D minor -> E)
chords = [(b1, b2, ['A2', 'E3', 'C4']), (b2, b3, ['F2', 'C3', 'A3']), (b3, END - 2.0, ['D2', 'A2', 'F3']), (END - 2.0, END, ['E2', 'B2', 'G#3'])]
pad = np.zeros_like(t)
for a, b, notes in chords:
    seg = section(a, b, 0.8)
    for k_, nt in enumerate(notes):
        f = hz(nt)
        for det in (-0.12, 0.12):
            pad += np.sin(2 * np.pi * (f + det) * t + k_) * seg / (len(notes) * 2)
pad = lowpass(pad, 900)
add(reverb(pad, 2.0, 0.4), 0.22)

# 3. iPhone: pulsing arpeggio, 16ths at 100 bpm, through a filter that slowly opens
step = 60 / 100 / 4; arp = np.zeros_like(t); notes = ['A3', 'C4', 'E4', 'C4', 'A3', 'E4', 'G4', 'E4']
i = 0; tt = b1 + 0.4
while tt < b2 - 0.3:
    f = hz(notes[i % len(notes)]); n0 = int(tt * SR); n1 = min(len(t), n0 + int(0.18 * SR))
    seg = t[n0:n1] - tt
    arp[n0:n1] += (2 * ((f * seg) % 1) - 1) * np.exp(-seg * 22)
    i += 1; tt += step
open_ = 500 + 1800 * np.clip((t - b1) / max(0.1, b2 - b1), 0, 1)
arp = lowpass(arp, open_) * section(b1, b2, 0.5)
mix[:, 0] += arp * 0.10; mix[:, 1] += np.roll(arp, int(0.011 * SR)) * 0.10          # a little stereo width

# 4. Android: slow plucked notes (piano-like) with an echo, a different colour from the arpeggio
pluck = np.zeros_like(t); melody = ['F4', 'C4', 'A3', 'C4', 'G4', 'F4', 'C4', 'E4']
tt, i = b2 + 0.5, 0
while tt < b3 - 0.6:
    f = hz(melody[i % len(melody)]); n0 = int(tt * SR); n1 = min(len(t), n0 + int(1.6 * SR)); seg = t[n0:n1] - tt
    tone = sum(np.sin(2 * np.pi * f * h * seg) / h ** 1.6 for h in (1, 2, 3, 4))
    pluck[n0:n1] += tone * np.exp(-seg * 3.2) * (1 - np.exp(-seg * 300))
    i += 1; tt += 60 / 72
echo = np.zeros_like(pluck); d = int(0.42 * SR); echo[d:] = pluck[:-d] * 0.35
add(reverb((pluck + echo) * section(b2, b3, 0.5), 1.6, 0.35), 0.11, pan=-0.1)

# 5. stakes: tremolo strings (detuned saws with fast volume flutter) and a riser into the ending
strings = np.zeros_like(t)
for nt in ('D3', 'F3', 'A3', 'D4'):
    f = hz(nt)
    for det in (-0.25, 0.25):
        strings += 2 * (((f + det) * t) % 1) - 1
trem = 0.6 + 0.4 * np.sin(2 * np.pi * 7.5 * t)
grow = np.clip((t - b3) / max(0.1, END - b3), 0, 1)
strings = lowpass(strings * trem, 600 + 2200 * grow ** 2) * section(b3, END, 0.6) * (0.3 + 0.7 * grow)
add(reverb(strings, 1.8, 0.3), 0.035)
add(lowpass(rng.standard_normal(len(t)), 200 + 5000 * grow ** 3) * grow ** 2.5 * (t >= b3), 0.10)

# 6. a soft whoosh at each section change
for a in (b1, b2, b3):
    w0 = a - 0.45; env = np.exp(-((t - a) / 0.22) ** 2)
    add(lowpass(rng.standard_normal(len(t)), 400 + 3000 * env) * env * (t > w0), 0.10)

# 7. duck the score under the voice (about -15 dB while he speaks, quick attack, slow release)
voice = read_wav(voice_path)[:, 0]
v = np.zeros(len(t)); m = min(len(t), len(voice)); v[:m] = np.abs(voice[:m])
win = int(0.02 * SR); env = np.convolve(v, np.ones(win) / win, mode='same')
speaking = np.clip(env / 0.02, 0, 1)
smooth = np.empty_like(speaking); acc = 0.0
att, rel = np.exp(-1 / (0.03 * SR)), np.exp(-1 / (0.35 * SR))
for i_ in range(len(speaking)):
    c = att if speaking[i_] > acc else rel
    acc = c * acc + (1 - c) * speaking[i_]; smooth[i_] = acc
gain = 1 - 0.82 * smooth
mix *= gain[:, None]

peak = np.max(np.abs(mix)); mix = np.tanh(mix / peak * 1.2) * 0.85
with wave.open(out, 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((mix * 32767).astype('<i2').tobytes())
print(f'wrote {out}: {END:.2f}s (hook 0-{b1:.2f}, iphone -{b2:.2f}, android -{b3:.2f}, stakes -{END:.2f})')
