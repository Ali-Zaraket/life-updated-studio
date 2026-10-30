# Full-resolution render of one shot (1080x1920) into storage/creative/full/<folder>, leaving the half-size preview
# frames and the shot's own settings untouched (nothing is saved back to the .blend).
# Run: blender -b <shot.blend> --python render_full.py -- <folder> <first> <last> [samples] --cycles-device CUDA
import bpy, os, sys

args = sys.argv[sys.argv.index('--') + 1:]
if '--cycles-device' in args:                           # Blender's own flag (pass CUDA, or it renders on the CPU)
    i = args.index('--cycles-device'); args = args[:i] + args[i + 2:]
folder, first, last = args[:3]
extra = args[3:]
sc = bpy.context.scene
sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = 1080, 1920, 100
if extra:
    sc.cycles.samples = int(extra[0])
out = os.path.join(os.path.dirname(bpy.data.filepath), 'full', folder)
os.makedirs(out, exist_ok=True)
sc.render.filepath = os.path.join(out, 'f_')
sc.frame_start, sc.frame_end = int(first), int(last)
# resume: skip frames already on disk (a long chain can be interrupted)
sc.render.use_overwrite = False; sc.render.use_placeholder = True
sc.render.use_persistent_data = True                    # keep the scene on the GPU between frames
print(f'RENDER_FULL {bpy.path.basename(bpy.data.filepath)} -> full/{folder} frames {first}-{last} samples {sc.cycles.samples}')
bpy.ops.render.render(animation=True)
