# Cuts LU-TECH-003 together in Blender's sequencer: rendered scenes laid to the recorded narration, reviewed on-screen
# text (exactly as in script.json), sentence captions, scene sound ducked under the voice.
# Run: blender -b --factory-startup --python assemble_lu_tech_003.py -- <repo root> <out.mp4> [scale]
#   scale 0.5 = 540x960 preview from the half-size renders; 1.0 needs full-size renders.
import bpy, json, os, sys

root, out = sys.argv[sys.argv.index('--') + 1:][:2]
S = os.path.join(root, 'storage', 'creative')
FPS = 30
script = json.load(open(os.path.join(root, 'content', 'pilots', 'LU-TECH-003', 'script.json'), encoding='utf-8'))
timing = json.load(open(os.path.join(S, 'narration-timing.json'), encoding='utf-8'))
narration = os.path.join(root, 'storage', 'episodes', 'LU-TECH-003', 'v2', 'narration', 'audition-elevenlabs-eleven-chris_v1792795415.wav')
on_screen = {i: b.get('onScreenText', []) for i, b in enumerate(script['beats'])}

sc = bpy.context.scene
se = sc.sequence_editor_create()
first_img = os.path.join(S, 'shot01v3_frames', 'f_0001.png')
img = bpy.data.images.load(first_img)
sc.render.resolution_x, sc.render.resolution_y = img.size
sc.render.resolution_percentage = 100
sc.render.fps = FPS
k = img.size[0] / 1080.0                               # text scales with the output width
fr = lambda t: int(round(t * FPS)) + 1                  # seconds -> sequencer frame

def frames_strip(name, folder, src_frames, start, channel):
    """Image strip from an explicit list of rendered frames (allows trimming and retiming)."""
    files = [f'f_{n:04d}.png' for n in src_frames]
    st = se.strips.new_image(name, os.path.join(S, folder, files[0]), channel, start)
    for f in files[1:]:
        st.elements.append(f)
    return st

def stretch(a, b, n):
    """n frame numbers spread evenly over source frames a..b inclusive."""
    return [a + round(i * (b - a) / max(1, n - 1)) for i in range(n)]

def effect(name, kind, channel, start, end):
    try:
        return se.strips.new_effect(name, kind, channel, start, length=end - start)
    except TypeError:
        return se.strips.new_effect(name, kind, channel, start, frame_end=end)

font = bpy.data.fonts.load(os.path.join(os.path.dirname(bpy.app.binary_path), '5.2', 'datafiles', 'fonts', 'Inter.woff2'), check_existing=True)

def text(name, body, t0, t1, channel, y, size, x=0.5, anchor_x='CENTER', box=False, color=(1, 1, 1, 1)):
    st = effect(name, 'TEXT', channel, fr(t0), fr(t1))
    st.text = body; st.font = font; st.font_size = size * k
    st.location = (x, y); st.anchor_x = anchor_x; st.anchor_y = 'CENTER'; st.alignment_x = anchor_x
    st.color = color; st.wrap_width = 0.88
    st.use_shadow = True; st.shadow_color = (0, 0, 0, 0.85)
    if box:
        st.use_box = True; st.box_color = (0.02, 0.03, 0.06, 0.78); st.box_margin = 0.012
    return st

def sound(name, path, t0, channel, volume, src_from=0.0, src_to=None):
    st = se.strips.new_sound(name, path, channel, fr(t0))
    st.volume = volume
    if src_from:
        st.frame_offset_start = int(round(src_from * FPS))
    if src_to is not None:
        st.frame_final_duration = int(round((src_to - src_from) * FPS))
    st.frame_start = fr(t0) - st.frame_offset_start
    return st

# ---- beat boundaries from the narration (seconds) ----
starts = {}
for s in timing:
    starts.setdefault(s['beat'], s['start'])
b1, b2, b3, b4, b5 = (starts[i] for i in range(1, 6))
never = next(s['start'] for s in timing if s['text'].startswith('Or never'))
end_C = never + 6.10                                    # screen dies just after "...right now."
end_A = never - 6.0                                     # ending clip's dead stop (its 6.0 s) lands on "Or never"
total = end_C + 110 / FPS

# ---- picture (channel 1) ----
frames_strip('hook', 'shot01v3_frames', range(1, int(round(b1 * FPS)) + 1), 1, 1)
n = fr(b2) - fr(b1); frames_strip('iphone', 'scene2_frames', range(16, 16 + n), fr(b1), 1)
n = fr(b3) - fr(b2); frames_strip('android', 'scene3_frames', range(19, 19 + n), fr(b2), 1)
n = fr(b4) - fr(b3); frames_strip('stakes', 'scene4_frames', stretch(31, 252, n), fr(b3), 1)
plate = se.strips.new_image('steps', os.path.join(S, 'shot01v3_frames', 'f_0150.png'), 1, fr(b4))
plate.frame_final_duration = fr(end_A) - fr(b4)
plate.color_multiply = 0.38
plate.transform.scale_x = plate.transform.scale_y = 1.0
plate.transform.keyframe_insert('scale_x', frame=fr(b4)); plate.transform.keyframe_insert('scale_y', frame=fr(b4))
plate.transform.scale_x = plate.transform.scale_y = 1.08
plate.transform.keyframe_insert('scale_x', frame=fr(end_A)); plate.transform.keyframe_insert('scale_y', frame=fr(end_A))
frames_strip('end_A', 'ending_frames', range(1, 181), fr(end_A), 1)
frames_strip('end_B', 'ending_frames', stretch(181, 330, fr(end_C) - fr(never)), fr(never), 1)
frames_strip('end_C', 'ending_frames', range(331, 441), fr(end_C), 1)

# ---- reviewed on-screen text, exactly as in script.json ----
ILL = 'Illustration'
def ill(t0, t1): text(f'ill_{t0:.1f}', ILL, t0, t1, 5, 0.955, 26, x=0.06, anchor_x='LEFT', color=(1, 1, 1, 0.75))
def credit(t0, t1): text(f'osm_{t0:.1f}', '© OpenStreetMap contributors', t0, t1, 6, 0.035, 20, x=0.95, anchor_x='RIGHT', color=(1, 1, 1, 0.7))
assert ILL in on_screen[0] and ILL in on_screen[1] and ILL in on_screen[2] and ILL in on_screen[3] and ILL in on_screen[5]
ill(0, b1); ill(b1, b2); ill(b2, b3); ill(b3, b4); ill(end_A, end_C)       # the web stays on screen until it goes dark
credit(0, b1); credit(b3, b4); credit(end_A, end_C)
text('card_iphone', on_screen[1][0], b1 + 0.3, b2, 4, 0.83, 44, box=True)
text('card_android', on_screen[2][0], b2 + 0.3, b3, 4, 0.83, 44, box=True)
steps = on_screen[4]
iphone_t = next(s['start'] for s in timing if s['text'].startswith('On iPhone, you can'))
maps_t = next(s['start'] for s in timing if s['text'].startswith('In Google Maps'))
text('step1', steps[0], iphone_t, end_A, 4, 0.80, 34, box=True)
text('step2', steps[1], iphone_t + 0.4, end_A, 5, 0.75, 34, box=True)
text('step3', steps[2], maps_t, end_A, 6, 0.66, 34, box=True)
text('step4', steps[3], maps_t + 0.4, end_A, 7, 0.61, 34, box=True)
text('step5', steps[4], maps_t + 2.2, end_A, 8, 0.52, 34, box=True)
auto_t = next(s['start'] for s in timing if s['text'].startswith('You can set'))
text('card_auto', on_screen[5][0], auto_t + 1.0, never, 4, 0.83, 44, box=True)
text('card_off', on_screen[5][1], never, end_C, 4, 0.83, 52, box=True)

# ---- captions: each sentence split into short chunks, timed by syllables ----
def syl(w):
    import re
    v = re.findall(r'[aeiouy]+', w.lower()); return max(1, len(v) - (1 if w.lower().endswith('e') and len(w) > 3 else 0))
for i, s in enumerate(timing):
    words = s['text'].split()
    chunks, cur = [], []
    for w in words:
        cur.append(w)
        if len(cur) >= 6 or w.endswith((',', ':', '.')) and len(cur) >= 3:
            chunks.append(cur); cur = []
    if cur:
        chunks.append(cur)
    weights = [sum(syl(w) for w in c) for c in chunks]; total_w = sum(weights)
    t = s['start']
    for j, (c, wgt) in enumerate(zip(chunks, weights)):
        d = (s['end'] - s['start']) * wgt / total_w
        text(f'cap_{i}_{j}', ' '.join(c), t, t + d + (0.15 if j == len(chunks) - 1 else 0), 9, 0.27, 50)
        t += d

# ---- sound: narration on top, scene sound ducked underneath ----
sound('voice', narration, 0, 10, 1.0)
sound('s_hook', os.path.join(S, 'shot01-sound.wav'), 0, 11, 0.42, 0, b1)
sound('s_iphone', os.path.join(S, 'scene2-sound.wav'), b1, 12, 0.30, 0.5, 0.5 + (b2 - b1))
sound('s_android', os.path.join(S, 'scene3-sound.wav'), b2, 13, 0.30, 0.6, 0.6 + (b3 - b2))
sound('s_stakes', os.path.join(S, 'scene4-sound.wav'), b3, 14, 0.32, 1.0, 1.0 + (b4 - b3))
sound('s_steps', os.path.join(S, 'steps-sound.wav'), b4, 15, 0.30, 0, end_A - b4)
end_wav = os.path.join(S, 'ending-sound-v2.wav')
sound('s_end_A', end_wav, end_A, 16, 0.40, 0, 6.0)
sound('s_end_B', end_wav, never, 17, 0.40, 6.0, 11.0)
sound('s_end_C', end_wav, end_C, 18, 0.65, 11.0, 440 / FPS)

sc.frame_start, sc.frame_end = 1, fr(total) - 1
sc.render.image_settings.media_type = 'VIDEO'
sc.render.image_settings.file_format = 'FFMPEG'
sc.render.ffmpeg.format = 'MPEG4'; sc.render.ffmpeg.codec = 'H264'; sc.render.ffmpeg.constant_rate_factor = 'HIGH'
sc.render.ffmpeg.audio_codec = 'AAC'; sc.render.ffmpeg.audio_bitrate = 192; sc.render.ffmpeg.audio_mixrate = 48000
sc.render.ffmpeg.audio_channels = 'STEREO'
sc.render.filepath = out
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(S, 'lu-tech-003-edit.blend'))
print(f'timeline {total:.2f}s: b1 {b1:.2f} b2 {b2:.2f} b3 {b3:.2f} b4 {b4:.2f} endA {end_A:.2f} never {never:.2f} endC {end_C:.2f}')
bpy.ops.render.render(animation=True)
print('wrote', out)
