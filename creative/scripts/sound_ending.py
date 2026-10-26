# Procedural sound for the LU-TECH-003 ending (14.6 s @ 30 fps). Run: blender -b --factory-startup --python sound_ending.py -- <out.wav>
# Tied to ending.blend: web grows f1-f178 while the map zooms out, dead stop at f180 (6 s), screen flares and dies f329-f332 (~11 s), fade f420-f440.
import sys, wave
import numpy as np

out = sys.argv[sys.argv.index('--') + 1]
SR, DUR = 48000, 440 / 30
t = np.arange(int(SR * DUR)) / SR
rng = np.random.default_rng(11)
mix = np.zeros((len(t), 2))
sec = lambda frame: frame / 30.0

def env(start, attack, decay, shape=4.0):
    e = np.zeros_like(t); i0 = int(start * SR)
    seg = np.concatenate([np.linspace(0, 1, max(1, int(attack * SR))), np.exp(-shape * np.linspace(0, 1, int(decay * SR)))])
    seg = seg[: len(t) - i0]; e[i0:i0 + len(seg)] = seg
    return e

def lowpass(x, cutoff):
    c = np.broadcast_to(np.asarray(cutoff, dtype=float), x.shape)
    a = np.exp(-2 * np.pi * c / SR); y = np.empty_like(x); acc = 0.0
    for i in range(len(x)):
        acc = (1 - a[i]) * x[i] + a[i] * acc; y[i] = acc
    return y

def add(sig, gain, pan=0.0):
    mix[:, 0] += sig * gain * (1 - max(pan, 0)); mix[:, 1] += sig * gain * (1 + min(pan, 0))

stop = sec(180)
# room tone throughout (quieter after the stop, so the silence is felt)
add(lowpass(rng.standard_normal(len(t)), 250) * np.where(t < stop, 1.0, 0.6), 0.02)

# heartbeat surging 90 -> 150 bpm while the web spreads, cut dead at the stop
beat = 0.05
while beat < stop - 0.12:
    k = beat / stop
    for off, amp in ((0.0, 1.0), (0.15 - 0.07 * k, 0.6)):
        add(np.sin(2 * np.pi * 50 * t) * env(beat + off, 0.003, 0.14, 7) * (t < stop), 0.5 * amp * (0.7 + 0.3 * k))
    beat += 60.0 / (90 + 60 * k ** 1.5)

# granular crackle: tiny clicks whose rate climbs as routes appear
ramp = np.clip(t / stop, 0, 1) * (t < stop)
clicks = (rng.random(len(t)) < (2 + 900 * ramp ** 2.2) / SR).astype(float)
add(lowpass(clicks * rng.uniform(0.3, 1, len(t)), 5000), 0.35, pan=0.15)
add(lowpass(clicks[::-1].copy() * 0 + np.roll(clicks, 997) * rng.uniform(0.3, 1, len(t)), 5000), 0.35, pan=-0.15)

# rising drone that slams shut at the stop
drone = sum(np.sign(np.sin(2 * np.pi * f * t)) for f in (41.2, 41.5, 61.7))
add(lowpass(drone, 100 + 1400 * ramp ** 2) * (0.2 + 0.8 * ramp) * (t < stop), 0.09)

# screen dies: electrical pop, then one deep hit with a long tail
off = sec(330)
add(rng.standard_normal(len(t)) * env(off, 0.0005, 0.03, 9), 0.22)
add(np.sin(2 * np.pi * (48 - 20 * np.clip((t - off) / 1.6, 0, 1)) * t) * env(off + 0.04, 0.003, 2.4, 2.8), 0.95)
add(lowpass(rng.standard_normal(len(t)), 700) * env(off + 0.05, 0.08, 2.2, 3.5), 0.12)

peak = np.max(np.abs(mix)); mix = np.tanh(mix / peak * 1.3) * 0.89
mix *= np.clip((DUR - t) / 0.6, 0, 1)[:, None]
with wave.open(out, 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((mix * 32767).astype('<i2').tobytes())
print('wrote', out)
