# Cuts LU-TECH-003 together in Blender's sequencer: rendered scenes laid to the recorded narration, reviewed on-screen
# text (exactly as in script.json), sentence captions, scene sound ducked under the voice.
# Run: blender -b --factory-startup --python assemble_lu_tech_003.py -- <repo root> <out.mp4> [scale]
#   scale 0.5 = 540x960 preview from the half-size renders; 1.0 needs full-size renders.
import bpy, json, os, sys

#   --picture-only        cut only the picture (no text, no sound), for the film finish (finish.sh)
#   --base <finished.mp4> use that finished picture instead of the rendered frames, then add text and sound on top,
#                         so the grain and vignette never touch the reviewed on-screen text or the labels
args = sys.argv[sys.argv.index('--') + 1:]
root, out = args[:2]
PICTURE_ONLY = '--picture-only' in args
BASE = args[args.index('--base') + 1] if '--base' in args else None
S = os.path.join(root, 'storage', 'creative')
FPS = 30
script = json.load(open(os.path.join(root, 'content', 'pilots', 'LU-TECH-003', 'script.json'), encoding='utf-8'))
timing = json.load(open(os.path.join(S, 'narration-timing.json'), encoding='utf-8'))
def latest_narration(root):
    """The narration recorded for the newest script version (storage/episodes/LU-TECH-003/v<n>/narration/*.wav)."""
    base = os.path.join(root, 'storage', 'episodes', 'LU-TECH-003')
    versions = sorted((int(d[1:]), d) for d in os.listdir(base) if d.startswith('v') and d[1:].isdigit() and os.path.isdir(os.path.join(base, d, 'narration')))
    folder = os.path.join(base, versions[-1][1], 'narration')
    return os.path.join(folder, next(f for f in sorted(os.listdir(folder)) if f.endswith('.wav')))
narration = latest_narration(root)
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

def text(name, body, t0, t1, channel, y, size, x=0.5, anchor_x='CENTER', box=False, color=(1, 1, 1, 1), bold=False):
    st = effect(name, 'TEXT', channel, fr(t0), fr(t1))
    st.text = body; st.font = font; st.font_size = size * k
    if bold:
        st.use_bold = True
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
b1, b2, b3, b4 = (starts[i] for i in range(1, 5))       # hook | iPhone | Android | stakes | where it lives | twist
never = next(s['start'] for s in timing if s['text'].startswith('Or never'))
right_now = next(s['end'] for s in timing if s['text'].startswith("If it's on"))
end_C = right_now + 0.12                                # screen dies just after "...right now."
end_A = starts[5]                                       # the ending starts with the twist; its build is fitted so the
                                                        # dead stop (clip 6.0 s) lands on "Or never"
total = end_C + 110 / FPS

# ---- picture (channel 1); each section opens on a different kind of shot (owner note 2) ----
if BASE:                                                # the finished picture, frame for frame
    se.strips.new_movie('picture', BASE, 1, 1)
else:
    frames_strip('hook', 'shot01v3_frames', range(1, int(round(b1 * FPS)) + 1), 1, 1)
    wide = min(110, fr(b2) - fr(b1) - 90)                   # wide moonlit bedroom, then the macro of the place list
    frames_strip('iphone_wide', 'scene2a_frames', range(1, wide + 1), fr(b1), 1)
    n = fr(b2) - fr(b1) - wide; frames_strip('iphone', 'scene2_frames', range(300 - n + 1, 301), fr(b1) + wide, 1)
    n = fr(b3) - fr(b2); frames_strip('android', 'scene5_frames', range(1, n + 1), fr(b2), 1)   # night aerial, 1:1 so the
                                                                                             # route starts just before "Then it saves..."
    n = fr(b4) - fr(b3); frames_strip('stakes', 'scene4_frames', stretch(1, 252, n), fr(b3), 1)
    plate = se.strips.new_image('where', os.path.join(S, 'shot01v3_frames', 'f_0150.png'), 1, fr(b4))   # dimmed nightstand under the paths
    plate.frame_final_duration = fr(end_A) - fr(b4)
    plate.color_multiply = 0.38
    for v, f_ in ((1.0, fr(b4)), (1.06, fr(end_A))):
        plate.transform.scale_x = plate.transform.scale_y = v
        plate.transform.keyframe_insert('scale_x', frame=f_); plate.transform.keyframe_insert('scale_y', frame=f_)
    frames_strip('end_A', 'ending_frames', stretch(1, 180, fr(never) - fr(end_A)), fr(end_A), 1)
    frames_strip('end_B', 'ending_frames', stretch(181, 330, fr(end_C) - fr(never)), fr(never), 1)
    frames_strip('end_C', 'ending_frames', range(331, 441), fr(end_C), 1)

if not PICTURE_ONLY:
    # ---- reviewed on-screen text, exactly as in script.json ----
    ILL = 'Illustration'
    def ill(t0, t1): text(f'ill_{t0:.1f}', ILL, t0, t1, 5, 0.955, 26, x=0.06, anchor_x='LEFT', color=(1, 1, 1, 0.75))
    def credit(t0, t1): text(f'osm_{t0:.1f}', '© OpenStreetMap contributors', t0, t1, 6, 0.035, 20, x=0.95, anchor_x='RIGHT', color=(1, 1, 1, 0.7))
    assert all(ILL in on_screen[i] for i in (0, 1, 2, 3, 5))
    ill(0, b1); ill(b1, b2); ill(b2, b3); ill(b3, b4); ill(end_A, end_C)       # the web stays on screen until it goes dark
    credit(0, b1); credit(b2, b4); credit(end_A, end_C)
    text('card_iphone', on_screen[1][0], b1 + 0.3, b2, 4, 0.83, 44, box=True)
    text('card_android', on_screen[2][0], b2 + 0.3, b3, 4, 0.83, 38, box=True)   # one line, so the box draws
    b5 = starts[5]
    for j, (line, y) in enumerate(zip(on_screen[4], (0.62, 0.57, 0.47, 0.42))):   # where each setting lives
        # held ~3 s into the twist so the paths can actually be read (independent review, round 6)
        text(f'where_{j}', line, b4 + 0.25 + 0.35 * j, max(end_A, b5 + 3.0), 4 + j, y, 34, box=True)
    auto_t = next(s['start'] for s in timing if s['text'].startswith('You can set'))
    text('card_auto', on_screen[5][0], max(auto_t + 1.0, b5 + 3.0), never, 4, 0.83, 44, box=True)   # after the path cards clear
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
        # one caption at a time: the last chunk may hold into the pause, but never past the next sentence's start
        hold_until = timing[i + 1]['start'] if i + 1 < len(timing) else s['end'] + 0.4
        for j, (c, wgt) in enumerate(zip(chunks, weights)):
            d = (s['end'] - s['start']) * wgt / total_w
            t1 = min(s['end'] + 0.3, hold_until) if j == len(chunks) - 1 else t + d
            if fr(t1) > fr(t):
                text(f'cap_{i}_{j}', ' '.join(c), t, t1, 9, 0.27, 52, bold=True)
            t += d

    # ---- sound: narration on top; one evolving score (already ducked under the voice) up to the ending ----
    sound('voice', narration, 0, 10, 1.0)
    sound('score', os.path.join(S, 'score-lu-tech-003.wav'), 0, 11, 0.9, 0, end_A)
    end_wav = os.path.join(S, 'ending-sound-v2.wav')
    sound('s_end_A', end_wav, end_A, 16, 0.40, max(0.0, 6.0 - (never - end_A)), 6.0)   # the build's last part, ending on the stop
    sound('s_end_B', end_wav, never, 17, 0.40, 6.0, 11.0)
    sound('s_end_C', end_wav, end_C, 18, 0.65, 11.0, 440 / FPS)

sc.frame_start, sc.frame_end = 1, fr(total) - 1
sc.render.image_settings.media_type = 'VIDEO'
sc.render.image_settings.file_format = 'FFMPEG'
sc.render.ffmpeg.format = 'MPEG4'; sc.render.ffmpeg.codec = 'H264'; sc.render.ffmpeg.constant_rate_factor = 'HIGH'
sc.render.ffmpeg.audio_codec = 'AAC'; sc.render.ffmpeg.audio_bitrate = 192; sc.render.ffmpeg.audio_mixrate = 48000
sc.render.ffmpeg.audio_channels = 'STEREO'
if PICTURE_ONLY:                                        # near-lossless intermediate for the finish pass
    sc.render.ffmpeg.audio_codec = 'NONE'; sc.render.ffmpeg.constant_rate_factor = 'PERC_LOSSLESS'
sc.render.filepath = out
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(S, 'lu-tech-003-picture.blend' if PICTURE_ONLY else 'lu-tech-003-edit.blend'))
print(f'timeline {total:.2f}s: b1 {b1:.2f} b2 {b2:.2f} b3 {b3:.2f} endA {end_A:.2f} never {never:.2f} endC {end_C:.2f}')
bpy.ops.render.render(animation=True)
print('wrote', out)
