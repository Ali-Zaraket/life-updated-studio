# blender -b --factory-startup --python encode_av.py -- <frames_dir> <sound.wav> <out.mp4>
import bpy, os, sys
frames_dir, sound, out = sys.argv[sys.argv.index('--') + 1:][:3]
files = sorted(f for f in os.listdir(frames_dir) if f.endswith('.png'))
sc = bpy.context.scene
se = sc.sequence_editor_create()
strip = se.strips.new_image('frames', os.path.join(frames_dir, files[0]), 1, 1)
for f in files[1:]:
    strip.elements.append(f)
se.strips.new_sound('sound', sound, 2, 1)
img = bpy.data.images.load(os.path.join(frames_dir, files[0]))
sc.render.resolution_x, sc.render.resolution_y = img.size
sc.render.resolution_percentage = 100
sc.render.fps = 30
sc.frame_start, sc.frame_end = 1, len(files)
sc.render.image_settings.media_type = 'VIDEO'
sc.render.image_settings.file_format = 'FFMPEG'
sc.render.ffmpeg.format = 'MPEG4'
sc.render.ffmpeg.codec = 'H264'
sc.render.ffmpeg.constant_rate_factor = 'HIGH'
sc.render.ffmpeg.audio_codec = 'AAC'
sc.render.ffmpeg.audio_bitrate = 192
sc.render.ffmpeg.audio_mixrate = 48000
sc.render.ffmpeg.audio_channels = 'STEREO'
sc.render.filepath = out
bpy.ops.render.render(animation=True)
