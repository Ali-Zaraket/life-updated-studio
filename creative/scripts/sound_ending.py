# Sound for the LU-TECH-003 ending (14.6 s @ 30 fps), built from shot 01's palette (sound_shot01.py), which the owner prefers.
# Run: blender -b --factory-startup --python sound_ending.py -- <out.wav>
# Tied to ending.blend: web grows f1-f178 while the map zooms out, dead stop at f180 (6 s), screen dies f329-f332 (~11 s), fade f420-f440.
import sys, wave
import numpy as np

out = sys.argv[sys.argv.index('--') + 1]
SR, DUR = 48000, 440 / 30
t = np.arange(int(SR * DUR)) / SR
rng = np.random.default_rng(7)
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
ramp = np.clip(t / stop, 0, 1)
before = (t < stop).astype(float)

# 1. room tone: the same quiet bed as shot 01, a touch lower after the stop so the silence is felt
add(lowpass(rng.standard_normal(len(t)), 300) * np.where(t < stop, 1.0, 0.7), 0.02)

# 2. shot 01's dark drone (low detuned saws through a slowly opening filter), cut at the stop
drone = sum(np.sign(np.sin(2 * np.pi * f * t)) for f in (55.0, 55.4, 82.4))
add(lowpass(drone, 120 + 900 * ramp ** 2) * (0.25 + 0.75 * ramp) * before, 0.10)

# 3. shot 01's riser, climbing to the stop
add(lowpass(rng.standard_normal(len(t)), 200 + 6000 * ramp ** 3) * (ramp ** 2.5) * before, 0.16)

# 4. shot 01's heartbeat (lub-dub at 52 Hz), speeding 70 -> 125 bpm while the web spreads
beat = 0.1
while beat < stop - 0.12:
    k = beat / stop
    for off, amp in ((0.0, 1.0), (0.17 - 0.06 * k, 0.6)):
        add(np.sin(2 * np.pi * 52 * t) * env(beat + off, 0.004, 0.16, 7) * before, 0.55 * amp * (0.6 + 0.4 * k))
    beat += 60.0 / (70 + 55 * k)

# 5. screen dies: shot 01's click, then shot 01's impact (sub drop + crack + tail), and one low ping as it fades
off = sec(330)
add(rng.standard_normal(len(t)) * env(off - 0.03, 0.0005, 0.02, 9), 0.25)
sub = np.sin(2 * np.pi * (60 - 25 * np.clip((t - off) / 1.0, 0, 1)) * t)
add(sub * env(off, 0.002, 1.0, 3.5), 0.9)
add(lowpass(rng.standard_normal(len(t)), 2500) * env(off, 0.001, 0.25, 7), 0.5)
tail = lowpass(rng.standard_normal(len(t)), 900) * env(off + 0.02, 0.05, 0.95, 4)
add(tail, 0.12, pan=-0.2); add(tail, 0.12, pan=0.2)
add(np.sin(2 * np.pi * 110 * t) * env(off + 0.5, 0.005, 0.6, 5), 0.12)

peak = np.max(np.abs(mix)); mix = np.tanh(mix / peak * 1.3) * 0.89
mix *= np.clip((DUR - t) / 0.6, 0, 1)[:, None]
with wave.open(out, 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((mix * 32767).astype('<i2').tobytes())
print('wrote', out)
