# Scene sound from shot 01's palette (the owner's preferred sound): room tone, low drone, heartbeat, soft ticks, optional riser + impact.
# Run: blender -b --factory-startup --python sound_scene.py -- <out.wav> <frames> [key=value ...]
#   ticks=25,55,85   frames for a soft tick (e.g. when an item appears)
#   bpm=60:80        heartbeat tempo at start:end (0 = no heartbeat)
#   drone=0.10       drone level (0 = none)
#   riser=0          1 = riser building to the hit
#   hit=0            frame of an impact (0 = none)
import sys, wave
import numpy as np

args = sys.argv[sys.argv.index('--') + 1:]
out, frames = args[0], int(args[1])
opt = dict(a.split('=', 1) for a in args[2:])
ticks = [int(x) for x in opt.get('ticks', '').split(',') if x]
bpm0, bpm1 = (float(x) for x in opt.get('bpm', '60:60').split(':'))
drone_lvl, riser_on, hit = float(opt.get('drone', '0.10')), opt.get('riser', '0') == '1', int(opt.get('hit', '0'))

SR, DUR = 48000, frames / 30
t = np.arange(int(SR * DUR)) / SR
rng = np.random.default_rng(7)
mix = np.zeros((len(t), 2))
sec = lambda f: f / 30.0

def env(start, attack, decay, shape=4.0):
    e = np.zeros_like(t); i0 = int(start * SR)
    seg = np.concatenate([np.linspace(0, 1, max(1, int(attack * SR))), np.exp(-shape * np.linspace(0, 1, int(decay * SR)))])
    seg = seg[: max(0, len(t) - i0)]; e[i0:i0 + len(seg)] = seg
    return e

def lowpass(x, cutoff):
    c = np.broadcast_to(np.asarray(cutoff, dtype=float), x.shape)
    a = np.exp(-2 * np.pi * c / SR); y = np.empty_like(x); acc = 0.0
    for i in range(len(x)):
        acc = (1 - a[i]) * x[i] + a[i] * acc; y[i] = acc
    return y

def add(sig, gain, pan=0.0):
    mix[:, 0] += sig * gain * (1 - max(pan, 0)); mix[:, 1] += sig * gain * (1 + min(pan, 0))

end = sec(hit) if hit else DUR
ramp = np.clip(t / end, 0, 1)
add(lowpass(rng.standard_normal(len(t)), 300), 0.02)                                   # room tone
if drone_lvl > 0:
    drone = sum(np.sign(np.sin(2 * np.pi * f * t)) for f in (55.0, 55.4, 82.4))
    add(lowpass(drone, 120 + 900 * ramp ** 2) * (0.4 + 0.6 * ramp) * (t < end + 0.05), drone_lvl)
if riser_on:
    add(lowpass(rng.standard_normal(len(t)), 200 + 6000 * ramp ** 3) * ramp ** 2.5 * (t < end), 0.16)
if bpm0 > 0:
    beat = 0.2
    while beat < end - 0.15:
        k = beat / end
        for off, amp in ((0.0, 1.0), (0.17 - 0.06 * k, 0.6)):
            add(np.sin(2 * np.pi * 52 * t) * env(beat + off, 0.004, 0.16, 7) * (t < end), 0.5 * amp * (0.6 + 0.4 * k))
        beat += 60.0 / (bpm0 + (bpm1 - bpm0) * k)
for f in ticks:
    add(np.sin(2 * np.pi * 2400 * t) * env(sec(f), 0.001, 0.05, 8), 0.07, pan=0.3)
if hit:
    h = sec(hit)
    add(np.sin(2 * np.pi * (60 - 25 * np.clip((t - h) / 1.0, 0, 1)) * t) * env(h, 0.002, 1.0, 3.5), 0.9)
    add(lowpass(rng.standard_normal(len(t)), 2500) * env(h, 0.001, 0.25, 7), 0.5)
    tail = lowpass(rng.standard_normal(len(t)), 900) * env(h + 0.02, 0.05, 0.95, 4)
    add(tail, 0.12, pan=-0.2); add(tail, 0.12, pan=0.2)

peak = np.max(np.abs(mix)); mix = np.tanh(mix / peak * 1.3) * 0.89
mix *= np.clip((DUR - t) / 0.15, 0, 1)[:, None]
with wave.open(out, 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((mix * 32767).astype('<i2').tobytes())
print('wrote', out)
