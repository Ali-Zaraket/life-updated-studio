# Procedural sound design for shot 01 (5 s @ 30 fps). Run: blender -b --factory-startup --python sound_shot01.py -- <out.wav>
# Timings are tied to the animation's frames: screen on f21, trail f30-f120, pins at 30+90*i/7, last pin f120, halo pulses f121, f135.
import sys, wave
import numpy as np

out = sys.argv[sys.argv.index('--') + 1]
SR, DUR = 48000, 5.0
t = np.arange(int(SR * DUR)) / SR
rng = np.random.default_rng(7)
mix = np.zeros((len(t), 2))
sec = lambda frame: frame / 30.0

def env(start, attack, decay, shape=4.0):
    e = np.zeros_like(t); i0 = int(start * SR)
    a = max(1, int(attack * SR)); d = int(decay * SR)
    seg = np.concatenate([np.linspace(0, 1, a), np.exp(-shape * np.linspace(0, 1, d))])
    seg = seg[: len(t) - i0]; e[i0:i0 + len(seg)] = seg
    return e

def lowpass(x, cutoff):
    # one-pole filter, cutoff may vary over time
    c = np.broadcast_to(np.asarray(cutoff, dtype=float), x.shape)
    a = np.exp(-2 * np.pi * c / SR); y = np.empty_like(x); acc = 0.0
    for i in range(len(x)):
        acc = (1 - a[i]) * x[i] + a[i] * acc; y[i] = acc
    return y

def add(sig, gain, pan=0.0):
    mix[:, 0] += sig * gain * (1 - max(pan, 0)); mix[:, 1] += sig * gain * (1 + min(pan, 0))

# 1. room tone: very quiet filtered noise for the whole shot (silence sounds fake)
add(lowpass(rng.standard_normal(len(t)), 300), 0.02)

# 2. screen on: electrical click + soft thump
on = sec(21)
add(rng.standard_normal(len(t)) * env(on, 0.0005, 0.02, 9), 0.25)
add(np.sin(2 * np.pi * 70 * t) * env(on, 0.003, 0.35, 6), 0.45)

# 3. dark drone rising under the trail (detuned low saws through a slowly opening filter)
start, end = sec(30), sec(120)
ramp = np.clip((t - start) / (end - start), 0, 1)
drone = sum(np.sign(np.sin(2 * np.pi * f * t)) for f in (55.0, 55.4, 82.4))
drone_env = np.clip((t - sec(26)) / 0.6, 0, 1) * np.where(t < end, 1.0, np.exp(-(t - end) * 6))
add(lowpass(drone, 120 + 900 * ramp ** 2) * drone_env * (0.25 + 0.75 * ramp), 0.10)

# 4. riser: noise sweep that climbs to the hit
riser = lowpass(rng.standard_normal(len(t)), 200 + 6000 * ramp ** 3) * (ramp ** 2.5) * (t < end)
add(riser, 0.16)

# 5. heartbeat speeding up (lub-dub), 58 -> 118 bpm across the trail
beat_t = start; bpm0, bpm1 = 58.0, 118.0
while beat_t < end - 0.05:
    k = (beat_t - start) / (end - start)
    for off, amp in ((0.0, 1.0), (0.17 - 0.06 * k, 0.6)):
        add(np.sin(2 * np.pi * 52 * t) * env(beat_t + off, 0.004, 0.16, 7), 0.55 * amp * (0.6 + 0.4 * k))
    beat_t += 60.0 / (bpm0 + (bpm1 - bpm0) * k)

# 6. ticks as each place pops
for i in range(8):
    f = 30 + 90 * i / 7
    if i < 7:
        add(np.sin(2 * np.pi * 2400 * t) * env(sec(f), 0.001, 0.05, 8), 0.07, pan=0.3)

# 7. the hit on the last place: sub drop + noise crack + long tail
hit = sec(120)
sub = np.sin(2 * np.pi * (60 - 25 * np.clip((t - hit) / 1.0, 0, 1)) * t)
add(sub * env(hit, 0.002, 1.0, 3.5), 0.9)
add(lowpass(rng.standard_normal(len(t)), 2500) * env(hit, 0.001, 0.25, 7), 0.5)
tail = lowpass(rng.standard_normal(len(t)), 900) * env(hit + 0.02, 0.05, 0.95, 4)
add(tail, 0.12, pan=-0.2); add(tail[::-1][::-1], 0.12, pan=0.2)
# halo pulses: soft low pings
for f in (121, 135):
    add(np.sin(2 * np.pi * 110 * t) * env(sec(f), 0.005, 0.6, 5), 0.12)

# master: gentle limiter and fade-out, 16-bit stereo
peak = np.max(np.abs(mix)); mix = np.tanh(mix / peak * 1.3) * 0.89
mix *= np.clip((DUR - t) / 0.15, 0, 1)[:, None]
with wave.open(out, 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((mix * 32767).astype('<i2').tobytes())
print('wrote', out)
