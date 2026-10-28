# Camera and imperfection pass from creative/CINEMATIC.md, applied to an existing shot: handheld life on the camera
# (positional drift plus a little rotational sway on top of its track), a deliberate focus pull to a named subject,
# and fingerprints on the phone glass. The source .blend is never changed; the result is saved under a new name and
# renders into its own frame folder.
# Run: blender -b <shot.blend> --python cine_pass.py -- <preset> <out.blend> <frames dir>
import bpy, math, sys
from mathutils import Vector

preset, out_blend, frames_dir = sys.argv[sys.argv.index('--') + 1:][:3]
sc = bpy.context.scene
cam = sc.camera

# per shot: handheld strength (metres, degrees), how slow the sway is (frames), and the focus move
PRESETS = {
    # wide moonlit bedroom: an operator creeping in; focus starts on the duvet edge nearest us and pulls to the
    # nightstand as the phone glows
    'wide': dict(loc=0.006, rot=0.35, scale=38, aperture=2.0, focus=('near', 'target', 18, 52)),
    # macro on the place list: breathing hand, very thin focus that drifts down the list as places fill in
    'macro': dict(loc=0.0012, rot=0.18, scale=30, aperture=2.0, focus=('list_top', 'list_low', 150, 300)),
    # push-in on the glowing map: handheld, focus stays on the trail
    'pushin': dict(loc=0.0016, rot=0.2, scale=34, aperture=2.4, focus=None),
}
P = PRESETS[preset]

def fcurves_of(id_):
    ad = id_.animation_data
    if not ad or not ad.action:
        return []
    act = ad.action
    out = []
    for layer in getattr(act, 'layers', []):
        for strip in layer.strips:
            for bag in strip.channelbags:
                out += list(bag.fcurves)
    return out or list(getattr(act, 'fcurves', []))

def add_noise(fc, strength, scale, phase):
    m = fc.modifiers.new('NOISE'); m.strength = strength; m.scale = scale; m.phase = phase; m.blend_in = 0; m.blend_out = 0

# 1. handheld: drift on the camera's own location keys, sway from an empty added after the track constraint
if not any(fc.data_path == 'location' for fc in fcurves_of(cam)):
    cam.keyframe_insert('location', frame=sc.frame_start)
for fc in fcurves_of(cam):
    if fc.data_path == 'location':
        add_noise(fc, P['loc'] * 2, P['scale'], 11.0 + 37 * fc.array_index)
sway = bpy.data.objects.new('handheld_sway', None); sc.collection.objects.link(sway)
sway.rotation_euler = (0, 0, 0); sway.keyframe_insert('rotation_euler', frame=sc.frame_start)
for fc in fcurves_of(sway):
    add_noise(fc, math.radians(P['rot']) * 2, P['scale'] * 1.3, 5.0 + 23 * fc.array_index)
cr = cam.constraints.new('COPY_ROTATION'); cr.target = sway; cr.mix_mode = 'AFTER'
cr.owner_space = cr.target_space = 'LOCAL'; cr.name = 'handheld'

# 2. focus: a focus empty keyed from one subject to the other (a rack), or left on the original subject
dof = cam.data.dof; dof.use_dof = True; dof.aperture_fstop = P['aperture']
orig = dof.focus_object
if P['focus']:
    a_name, b_name, f0, f1 = P['focus']
    rig = orig.matrix_world
    pts = {
        'target': rig.translation.copy(),
        # the duvet edge between camera and nightstand, a third of the way from the camera
        'near': None,
        # the phone's list runs along the rig's local Y; top items sit above the centre, later ones below
        'list_top': rig @ Vector((0, 0.035, 0)),
        'list_low': rig @ Vector((0, -0.03, 0)),
    }
    sc.frame_set(sc.frame_start)
    pts['near'] = cam.matrix_world.translation.lerp(pts['target'], 0.33)
    foc = bpy.data.objects.new('focus_pull', None); sc.collection.objects.link(foc)
    foc.location = pts[a_name]; foc.keyframe_insert('location', frame=f0)
    foc.location = pts[b_name]; foc.keyframe_insert('location', frame=f1)
    for fc in fcurves_of(foc):
        for kp in fc.keyframe_points:
            kp.interpolation = 'BEZIER'; kp.easing = 'EASE_IN_OUT'
    dof.focus_object = foc

# 3. fingerprints: a few oval smears of higher roughness on the glass, on top of the existing smudge noise
glass = bpy.data.materials.get('FrontGlass')
if glass and 'fingerprints' not in glass.node_tree.nodes:
    nt = glass.node_tree
    gl = next(n for n in nt.nodes if n.bl_idname == 'ShaderNodeBsdfAnisotropic')
    old = next(l for l in nt.links if l.to_node == gl and l.to_socket.name == 'Roughness')
    tc = next(n for n in nt.nodes if n.bl_idname == 'ShaderNodeTexCoord')
    vor = nt.nodes.new('ShaderNodeTexVoronoi'); vor.name = 'fingerprints'; vor.feature = 'DISTANCE_TO_EDGE'
    vor.inputs['Scale'].default_value = 34.0
    ridges = nt.nodes.new('ShaderNodeMath'); ridges.operation = 'LESS_THAN'; ridges.inputs[1].default_value = 0.06
    blob = nt.nodes.new('ShaderNodeTexNoise'); blob.inputs['Scale'].default_value = 9.0
    mask = nt.nodes.new('ShaderNodeMapRange'); mask.inputs[1].default_value = 0.56; mask.inputs[2].default_value = 0.66
    mul = nt.nodes.new('ShaderNodeMath'); mul.operation = 'MULTIPLY'
    amt = nt.nodes.new('ShaderNodeMath'); amt.operation = 'MULTIPLY'; amt.inputs[1].default_value = 0.16
    add = nt.nodes.new('ShaderNodeMath'); add.operation = 'ADD'; add.use_clamp = True
    nt.links.new(tc.outputs['Object'], vor.inputs['Vector']); nt.links.new(tc.outputs['Object'], blob.inputs['Vector'])
    nt.links.new(vor.outputs['Distance'], ridges.inputs[0]); nt.links.new(blob.outputs['Fac'], mask.inputs[0])
    nt.links.new(ridges.outputs[0], mul.inputs[0]); nt.links.new(mask.outputs[0], mul.inputs[1])
    nt.links.new(mul.outputs[0], amt.inputs[0])
    nt.links.new(old.from_socket, add.inputs[0]); nt.links.new(amt.outputs[0], add.inputs[1])
    nt.links.remove(old); nt.links.new(add.outputs[0], gl.inputs['Roughness'])

sc.render.filepath = frames_dir.rstrip('/\\') + '/f_'
bpy.ops.wm.save_as_mainfile(filepath=out_blend, copy=False)
print('CINE_PASS', preset, '->', out_blend, 'focus', dof.focus_object.name, 'f/', dof.aperture_fstop)
