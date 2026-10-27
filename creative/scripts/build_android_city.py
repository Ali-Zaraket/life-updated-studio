# LU-TECH-003, Android section: a night aerial of a real street grid (OpenStreetMap buildings and streets, extruded),
# quiet at first ("off until you turn it on"); then one day's route draws itself through the streets and each visit
# lights up as it is reached. Owner notes 2026-10-27: the overhead phone shot looked glitchy, and Android should not
# be another phone-on-a-surface shot.
# Run: blender -b --factory-startup --python build_android_city.py -- <repo root> [frames=280]
# Writes storage/creative/scene5-android-city.blend and android-city-events.json (when each visit lights up, for the score).
import bpy, bmesh, heapq, json, math, os, random, sys
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
root = argv[0]
FRAMES = int(argv[1]) if len(argv) > 1 else 280
FPS = 30
S = os.path.join(root, 'storage', 'creative')
osm = json.load(open(os.path.join(S, 'assets', 'osm', 'city-aerial.json'), encoding='utf-8'))
lat0, lon0 = osm['center']
HALF = osm['half']
ROUTE_ON = 100                                          # frame the timeline "turns on" (just before "Then it saves...")
ROUTE_DONE = 238                                        # last visit reached; the camera keeps rising to the reveal
rnd = random.Random(7)

def xy(p):
    return ((p['lon'] - lon0) * 111320 * math.cos(math.radians(lat0)), (p['lat'] - lat0) * 110540)

for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)
sc = bpy.context.scene
col = sc.collection

def link(name, data):
    o = bpy.data.objects.new(name, data); col.objects.link(o); return o

def mesh_from_bm(name, bm):
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free(); return link(name, me)

# ---------------------------------------------------------------- materials
def nodes_of(mat):
    mat.use_nodes = True; nt = mat.node_tree; nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial'); return nt, out

def math_node(nt, op, a, b=None, clamp=False):
    n = nt.nodes.new('ShaderNodeMath'); n.operation = op; n.use_clamp = clamp
    for i, v in enumerate((a, b)):
        if v is None:
            continue
        if isinstance(v, (int, float)):
            n.inputs[i].default_value = v
        else:
            nt.links.new(v, n.inputs[i])
    return n.outputs[0]

def building_material():
    """Concrete walls with a window grid: about a quarter of the windows lit warm, a few blue (TV), the rest dark glass.
    Wall direction comes from the normal, so windows follow every wall; ground floors of some buildings are shopfronts."""
    mat = bpy.data.materials.new('building'); nt, out = nodes_of(mat)
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled'); nt.links.new(bsdf.outputs[0], out.inputs[0])
    geo = nt.nodes.new('ShaderNodeNewGeometry')
    P = nt.nodes.new('ShaderNodeSeparateXYZ'); nt.links.new(geo.outputs['Position'], P.inputs[0])
    N = nt.nodes.new('ShaderNodeSeparateXYZ'); nt.links.new(geo.outputs['Normal'], N.inputs[0])
    bid = nt.nodes.new('ShaderNodeAttribute'); bid.attribute_name = 'bid'
    ax, ay, az = (math_node(nt, 'ABSOLUTE', N.outputs[i]) for i in range(3))
    u = math_node(nt, 'ADD', math_node(nt, 'MULTIPLY', P.outputs[0], ay), math_node(nt, 'MULTIPLY', P.outputs[1], ax))
    us = math_node(nt, 'DIVIDE', u, 3.4); vs = math_node(nt, 'DIVIDE', P.outputs[2], 3.1)
    fu = math_node(nt, 'FRACT', us); fv = math_node(nt, 'FRACT', vs)
    win = math_node(nt, 'MULTIPLY',
                    math_node(nt, 'MULTIPLY', math_node(nt, 'GREATER_THAN', fu, 0.2), math_node(nt, 'LESS_THAN', fu, 0.8)),
                    math_node(nt, 'MULTIPLY', math_node(nt, 'GREATER_THAN', fv, 0.32), math_node(nt, 'LESS_THAN', fv, 0.86)))
    wall = math_node(nt, 'LESS_THAN', az, 0.5)
    above_ground = math_node(nt, 'GREATER_THAN', P.outputs[2], 3.4)
    win = math_node(nt, 'MULTIPLY', math_node(nt, 'MULTIPLY', win, wall), above_ground)
    cell = nt.nodes.new('ShaderNodeCombineXYZ')
    nt.links.new(math_node(nt, 'FLOOR', us), cell.inputs[0]); nt.links.new(math_node(nt, 'FLOOR', vs), cell.inputs[1])
    nt.links.new(math_node(nt, 'MULTIPLY', bid.outputs['Fac'], 997.0), cell.inputs[2])
    wn = nt.nodes.new('ShaderNodeTexWhiteNoise'); wn.noise_dimensions = '3D'; nt.links.new(cell.outputs[0], wn.inputs['Vector'])
    lit = math_node(nt, 'MULTIPLY', math_node(nt, 'MULTIPLY', win, math_node(nt, 'LESS_THAN', wn.outputs['Value'], 0.13)),
                math_node(nt, 'GREATER_THAN', bid.outputs['Fac'], 0.1))                         # ~10% of buildings fully dark
    hue = nt.nodes.new('ShaderNodeSeparateColor'); nt.links.new(wn.outputs['Color'], hue.inputs[0])
    ramp = nt.nodes.new('ShaderNodeValToRGB'); nt.links.new(hue.outputs[1], ramp.inputs[0])
    cr = ramp.color_ramp; cr.interpolation = 'CONSTANT'
    cr.elements[0].position = 0.0; cr.elements[0].color = (1.0, 0.55, 0.22, 1)          # warm tungsten
    cr.elements[1].position = 0.55; cr.elements[1].color = (1.0, 0.78, 0.5, 1)         # warm white
    e = cr.elements.new(0.85); e.color = (0.85, 0.9, 1.0, 1)                            # cool LED
    e = cr.elements.new(0.95); e.color = (0.35, 0.5, 1.0, 1)                            # TV blue
    # shopfronts: ground floor of ~35% of buildings, one warm band
    shop = math_node(nt, 'MULTIPLY', math_node(nt, 'MULTIPLY', wall, math_node(nt, 'LESS_THAN', P.outputs[2], 3.0)),
                     math_node(nt, 'MULTIPLY', math_node(nt, 'GREATER_THAN', P.outputs[2], 0.6), math_node(nt, 'GREATER_THAN', bid.outputs['Fac'], 0.86)))
    bright = math_node(nt, 'ADD', 1.5, math_node(nt, 'MULTIPLY', hue.outputs[2], 40.0))           # 1.5..5.5 (blue channel of the noise)
    bright = math_node(nt, 'MINIMUM', bright, 5.5)
    glow = math_node(nt, 'ADD', math_node(nt, 'MULTIPLY', lit, bright), math_node(nt, 'MULTIPLY', shop, 2.5))
    nt.links.new(ramp.outputs[0], bsdf.inputs['Emission Color']); nt.links.new(glow, bsdf.inputs['Emission Strength'])
    # wall colour: weathered concrete / beige plaster varying per building, dirt noise; windows are dark glossy glass
    tone = nt.nodes.new('ShaderNodeValToRGB'); nt.links.new(bid.outputs['Fac'], tone.inputs[0])
    tone.color_ramp.elements[0].color = (0.16, 0.15, 0.14, 1); tone.color_ramp.elements[1].color = (0.32, 0.29, 0.24, 1)
    dirt = nt.nodes.new('ShaderNodeTexNoise'); dirt.inputs['Scale'].default_value = 0.35; dirt.inputs['Detail'].default_value = 8
    mixd = nt.nodes.new('ShaderNodeMix'); mixd.data_type = 'RGBA'; mixd.blend_type = 'MULTIPLY'; mixd.inputs['Factor'].default_value = 0.6
    nt.links.new(tone.outputs[0], mixd.inputs['A']); nt.links.new(dirt.outputs['Color'], mixd.inputs['B'])
    mixw = nt.nodes.new('ShaderNodeMix'); mixw.data_type = 'RGBA'
    nt.links.new(win, mixw.inputs['Factor']); nt.links.new(mixd.outputs['Result'], mixw.inputs['A']); mixw.inputs['B'].default_value = (0.015, 0.018, 0.024, 1)
    mixr = nt.nodes.new('ShaderNodeMix'); mixr.data_type = 'RGBA'
    nt.links.new(math_node(nt, 'GREATER_THAN', az, 0.5), mixr.inputs['Factor']); nt.links.new(mixw.outputs['Result'], mixr.inputs['A'])
    nt.links.new(dirt.outputs['Fac'], mixr.inputs['B'])   # replaced below by a roof tone
    rt = nt.nodes.new('ShaderNodeMix'); rt.data_type = 'RGBA'; nt.links.new(dirt.outputs['Fac'], rt.inputs['Factor'])
    rt.inputs['A'].default_value = (0.09, 0.095, 0.1, 1); rt.inputs['B'].default_value = (0.2, 0.2, 0.19, 1)
    nt.links.new(rt.outputs['Result'], mixr.inputs['B'])
    nt.links.new(mixr.outputs['Result'], bsdf.inputs['Base Color'])
    rough = math_node(nt, 'SUBTRACT', 0.85, math_node(nt, 'MULTIPLY', win, 0.75))
    nt.links.new(rough, bsdf.inputs['Roughness'])
    return mat

def flat_material(name, color, rough=0.8, emit=None, strength=0.0):
    mat = bpy.data.materials.new(name); nt, out = nodes_of(mat)
    b = nt.nodes.new('ShaderNodeBsdfPrincipled'); nt.links.new(b.outputs[0], out.inputs[0])
    b.inputs['Base Color'].default_value = (*color, 1); b.inputs['Roughness'].default_value = rough
    if emit:
        b.inputs['Emission Color'].default_value = (*emit, 1); b.inputs['Emission Strength'].default_value = strength
    return mat

def asphalt_material():
    mat = bpy.data.materials.new('asphalt'); nt, out = nodes_of(mat)
    b = nt.nodes.new('ShaderNodeBsdfPrincipled'); nt.links.new(b.outputs[0], out.inputs[0])
    n = nt.nodes.new('ShaderNodeTexNoise'); n.inputs['Scale'].default_value = 0.8; n.inputs['Detail'].default_value = 10
    r = nt.nodes.new('ShaderNodeMapRange'); nt.links.new(n.outputs['Fac'], r.inputs[0])
    r.inputs[3].default_value = 0.22; r.inputs[4].default_value = 0.55                      # damp patches reflect more
    nt.links.new(r.outputs[0], b.inputs['Roughness'])
    b.inputs['Base Color'].default_value = (0.035, 0.035, 0.038, 1)
    return mat

def glow_material(name, color, strength, fade_up=False):
    """Emission (optionally fading out towards the top of the object) mixed with transparency; the fade is keyed via
    the 'level' value node."""
    mat = bpy.data.materials.new(name); nt, out = nodes_of(mat)
    em = nt.nodes.new('ShaderNodeEmission'); em.inputs['Color'].default_value = (*color, 1); em.inputs['Strength'].default_value = strength
    tr = nt.nodes.new('ShaderNodeBsdfTransparent'); mix = nt.nodes.new('ShaderNodeMixShader')
    level = nt.nodes.new('ShaderNodeValue'); level.name = 'level'; level.outputs[0].default_value = 1.0
    fac = level.outputs[0]
    if fade_up:
        tc = nt.nodes.new('ShaderNodeTexCoord'); sep = nt.nodes.new('ShaderNodeSeparateXYZ'); nt.links.new(tc.outputs['Generated'], sep.inputs[0])
        fac = math_node(nt, 'MULTIPLY', fac, math_node(nt, 'POWER', math_node(nt, 'SUBTRACT', 1.0, sep.outputs[2], clamp=True), 2.2))
    nt.links.new(tr.outputs[0], mix.inputs[1]); nt.links.new(em.outputs[0], mix.inputs[2]); nt.links.new(fac, mix.inputs[0])
    nt.links.new(mix.outputs[0], out.inputs[0])
    return mat

M_BUILD = building_material()
M_ROOF_BITS = flat_material('roof_bits', (0.22, 0.22, 0.21), 0.6)
M_TANK = flat_material('tank', (0.55, 0.55, 0.52), 0.4)
M_ASPHALT = asphalt_material()
M_GROUND = flat_material('ground', (0.022, 0.022, 0.024), 0.9)
M_ROUTE = flat_material('route', (0.2, 0.02, 0.01), 0.5, (1.0, 0.16, 0.06), 40.0)
M_CAR_HEAD = flat_material('car_head', (1, 1, 1), 0.5, (1.0, 0.92, 0.8), 60.0)
M_CAR_TAIL = flat_material('car_tail', (0.5, 0, 0), 0.5, (1.0, 0.05, 0.02), 30.0)
M_CAR_BODY = flat_material('car_body', (0.05, 0.05, 0.06), 0.3)
M_LAMP = flat_material('lamp', (1, 1, 1), 0.5, (1.0, 0.7, 0.4), 80.0)

# ---------------------------------------------------------------- buildings from OSM footprints, plus roof clutter
def ccw(pts):
    a = sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1] for i in range(len(pts)))
    return pts if a > 0 else pts[::-1]

def inside(p, poly):
    c = False; j = len(poly) - 1
    for i in range(len(poly)):
        (xi, yi), (xj, yj) = poly[i], poly[j]
        if (yi > p[1]) != (yj > p[1]) and p[0] < (xj - xi) * (p[1] - yi) / (yj - yi + 1e-12) + xi:
            c = not c
        j = i
    return c

bm = bmesh.new(); bid_layer = bm.faces.layers.float.new('bid')
clutter = bmesh.new()
footprints = []
for el in osm['elements']:
    if not el.get('tags', {}).get('building') or len(el.get('geometry', [])) < 4:
        continue
    pts = [xy(p) for p in el['geometry']]
    if pts[0] == pts[-1]:
        pts = pts[:-1]
    if len(pts) < 3:
        continue
    pts = ccw(pts)
    r = random.Random(el['id'])
    tags = el['tags']
    try:
        levels = float(tags.get('building:levels')) if tags.get('building:levels') else None
    except ValueError:
        levels = None
    if levels is None:
        levels = r.choice([3, 4, 5, 6, 6, 7, 8, 8, 9, 10, 11, 12, 14])
    h = float(tags['height']) if tags.get('height', '').replace('.', '', 1).isdigit() else levels * 3.1 + 0.6
    b = r.random()
    verts = [bm.verts.new((x, y, 0.0)) for x, y in pts]
    try:
        face = bm.faces.new(verts)
    except ValueError:
        continue
    face[bid_layer] = b
    res = bmesh.ops.extrude_face_region(bm, geom=[face])
    top = [v for v in res['geom'] if isinstance(v, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, verts=top, vec=(0, 0, h))
    top_face = [g for g in res['geom'] if isinstance(g, bmesh.types.BMFace) and all(v in top for v in g.verts)]
    if top_face and h > 6:
        ins = bmesh.ops.inset_region(bm, faces=top_face, thickness=0.35, depth=0.0)
        bmesh.ops.translate(bm, verts=list(top_face[0].verts), vec=(0, 0, -1.0))
        for f in ins['faces']:
            f[bid_layer] = b
    for f in [g for g in res['geom'] if isinstance(g, bmesh.types.BMFace)]:
        f[bid_layer] = b
    footprints.append((pts, h))
    # roof clutter: water tanks, a stair house, AC boxes (typical flat roofs)
    cx = sum(p[0] for p in pts) / len(pts); cy = sum(p[1] for p in pts) / len(pts)
    span = max(3.0, min(max(p[0] for p in pts) - min(p[0] for p in pts), max(p[1] for p in pts) - min(p[1] for p in pts)) * 0.35)
    for k in range(r.randint(1, 5)):
        p = (cx + r.uniform(-span, span), cy + r.uniform(-span, span))
        if not inside(p, pts):
            continue
        kind = r.random()
        if kind < 0.45:
            m = bmesh.ops.create_cone(clutter, cap_ends=True, segments=12, radius1=0.7, radius2=0.7, depth=1.3)
            bmesh.ops.translate(clutter, verts=m['verts'], vec=(p[0], p[1], h + 0.65 + 0.4))
        elif kind < 0.6 and k == 0:
            m = bmesh.ops.create_cube(clutter, size=1.0)
            bmesh.ops.scale(clutter, verts=m['verts'], vec=(3.2, 3.0, 2.6))
            bmesh.ops.translate(clutter, verts=m['verts'], vec=(p[0], p[1], h + 1.3))
        else:
            m = bmesh.ops.create_cube(clutter, size=1.0)
            bmesh.ops.scale(clutter, verts=m['verts'], vec=(0.9, 0.7, 0.6))
            bmesh.ops.translate(clutter, verts=m['verts'], vec=(p[0], p[1], h + 0.3))
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
buildings = mesh_from_bm('buildings', bm); buildings.data.materials.append(M_BUILD)
roofbits = mesh_from_bm('roof_clutter', clutter); roofbits.data.materials.append(M_TANK)

# filler city beyond the data box, so the haze has something to swallow instead of an edge
fill = bmesh.new(); fl = fill.faces.layers.float.new('bid')
for gx in range(-30, 31):
    for gy in range(-30, 31):
        x, y = gx * 42.0 + rnd.uniform(-6, 6), gy * 42.0 + rnd.uniform(-6, 6)
        if max(abs(x), abs(y)) < HALF + 10 or math.hypot(x, y) > 2400:
            continue
        for q in range(rnd.randint(1, 3)):
            m = bmesh.ops.create_cube(fill, size=1.0)
            w, d, h = rnd.uniform(12, 26), rnd.uniform(10, 22), rnd.choice([9, 12, 15, 18, 21, 25, 28, 34])
            bmesh.ops.scale(fill, verts=m['verts'], vec=(w, d, h))
            bmesh.ops.translate(fill, verts=m['verts'], vec=(x + rnd.uniform(-8, 8), y + rnd.uniform(-8, 8), h / 2))
            b = rnd.random()
            for f in {f for v in m['verts'] for f in v.link_faces}:
                f[fl] = b
filler = mesh_from_bm('filler_city', fill); filler.data.materials.append(M_BUILD)

# ---------------------------------------------------------------- streets: asphalt ribbons, street lamps, the route graph
WIDTH = {'trunk': 16, 'primary': 13, 'secondary': 11, 'tertiary': 9, 'residential': 7, 'unclassified': 7, 'living_street': 5, 'service': 4.5}
roads = bmesh.new()
graph = {}
def key(p):
    return (round(p['lat'], 7), round(p['lon'], 7))
pos = {}
lamp_spots = []
main_ways = []
for el in osm['elements']:
    hw = el.get('tags', {}).get('highway')
    if not hw or len(el.get('geometry', [])) < 2:
        continue
    pts = [xy(p) for p in el['geometry']]
    w = WIDTH.get(hw, 6) / 2
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        dx, dy = x1 - x0, y1 - y0; L = math.hypot(dx, dy)
        if L < 0.01:
            continue
        nx, ny = -dy / L * w, dx / L * w
        z = 0.03 + rnd.random() * 0.05                  # overlapping pieces must not be coplanar (they shadow each other black)
        vs = [roads.verts.new((x0 + nx, y0 + ny, z)), roads.verts.new((x0 - nx, y0 - ny, z)),
              roads.verts.new((x1 - nx, y1 - ny, z)), roads.verts.new((x1 + nx, y1 + ny, z))]
        roads.faces.new(vs)
        disc = bmesh.ops.create_circle(roads, cap_ends=True, segments=16, radius=w)      # round joints
        bmesh.ops.translate(roads, verts=disc['verts'], vec=(x1, y1, 0.03 + rnd.random() * 0.05))
    # lamps every ~34 m along lit streets, alternating sides
    if hw != 'service':
        acc, side = 0.0, 1
        for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
            L = math.hypot(x1 - x0, y1 - y0)
            while acc < L:
                t = acc / L; px, py = x0 + (x1 - x0) * t, y0 + (y1 - y0) * t
                nx, ny = -(y1 - y0) / L, (x1 - x0) / L
                lamp_spots.append((px + nx * (w + 0.5) * side, py + ny * (w + 0.5) * side, hw))
                side = -side; acc += 34.0
            acc -= L
    if hw in ('trunk', 'primary', 'secondary', 'tertiary') and sum(math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(pts, pts[1:])) > 140:
        main_ways.append(pts)
    if hw != 'service':
        ks = [key(p) for p in el['geometry']]
        for k, p in zip(ks, pts):
            pos[k] = p
        for a, b in zip(ks, ks[1:]):
            d = math.dist(pos[a], pos[b])
            graph.setdefault(a, []).append((b, d)); graph.setdefault(b, []).append((a, d))
road_obj = mesh_from_bm('streets', roads); road_obj.data.materials.append(M_ASPHALT)

lamp_data = bpy.data.lights.new('street_lamp_sodium', 'POINT'); lamp_data.energy = 110; lamp_data.color = (1.0, 0.62, 0.3); lamp_data.shadow_soft_size = 0.4
lamp_led = bpy.data.lights.new('street_lamp_led', 'POINT'); lamp_led.energy = 70; lamp_led.color = (0.92, 0.9, 0.85); lamp_led.shadow_soft_size = 0.4
for i, (x, y, hw) in enumerate(lamp_spots):
    if max(abs(x), abs(y)) > HALF:
        continue
    o = link(f'lamp_{i}', lamp_data if (hw in ('trunk', 'primary', 'secondary') or rnd.random() < 0.55) else lamp_led)
    o.location = (x, y, 7.5); o.visible_camera = False; o.visible_glossy = False

ground = bpy.data.meshes.new('ground')
gbm = bmesh.new(); bmesh.ops.create_grid(gbm, x_segments=1, y_segments=1, size=2600); gbm.to_mesh(ground); gbm.free()
link('ground', ground).data.materials.append(M_GROUND)

# ---------------------------------------------------------------- cars: headlights and tail lights moving along main streets
def path_curve(name, pts, z):
    cu = bpy.data.curves.new(name, 'CURVE'); cu.dimensions = '3D'
    sp = cu.splines.new('POLY'); sp.points.add(len(pts) - 1)
    for p, (x, y) in zip(sp.points, pts):
        p.co = (x, y, z, 1)
    return link(name, cu)

car_mesh = bpy.data.meshes.new('car'); cbm = bmesh.new()
body = bmesh.ops.create_cube(cbm, size=1.0); bmesh.ops.scale(cbm, verts=body['verts'], vec=(4.2, 1.8, 1.3)); bmesh.ops.translate(cbm, verts=body['verts'], vec=(0, 0, 0.75))
for x, kind in ((2.12, 1), (-2.12, 2)):
    for y in (-0.6, 0.6):
        m = bmesh.ops.create_cube(cbm, size=1.0); bmesh.ops.scale(cbm, verts=m['verts'], vec=(0.08, 0.35, 0.18)); bmesh.ops.translate(cbm, verts=m['verts'], vec=(x, y, 0.8))
        for f in {f for v in m['verts'] for f in v.link_faces}:
            f.material_index = kind
cbm.to_mesh(car_mesh); cbm.free()
for m in (M_CAR_BODY, M_CAR_HEAD, M_CAR_TAIL):
    car_mesh.materials.append(m)
for i, pts in enumerate(main_ways):
    for direction in (1, -1):
        lane = pts if direction == 1 else pts[::-1]
        L = sum(math.dist(a, b) for a, b in zip(lane, lane[1:]))
        off = [(-(b[1] - a[1]), b[0] - a[0]) for a, b in zip(lane, lane[1:])] + [(0, 0)]
        shifted = []
        for p, (nx, ny) in zip(lane, off[:-1] + [off[-2]]):
            n = math.hypot(nx, ny) or 1
            shifted.append((p[0] - nx / n * 2.2, p[1] - ny / n * 2.2))        # drive on the right
        path = path_curve(f'lane_{i}_{direction}', shifted, 0.0)
        path.data.path_duration = FRAMES
        for c in range(max(1, int(L / 120))):
            car = link(f'car_{i}_{direction}_{c}', car_mesh)
            con = car.constraints.new('FOLLOW_PATH'); con.target = path; con.use_curve_follow = True; con.forward_axis = 'FORWARD_X'
            speed = rnd.uniform(7, 13) / L                                     # fraction of the street per second
            start = rnd.random()
            con.offset_factor = start % 1.0; con.keyframe_insert('offset_factor', frame=1)
            end_val = start + speed * FRAMES / FPS
            if end_val < 1.0:
                con.offset_factor = end_val; con.keyframe_insert('offset_factor', frame=FRAMES)
            else:                                                              # leaves the street end: park it there
                f_end = 1 + int((1.0 - start) / speed * FPS)
                con.offset_factor = 0.999; con.keyframe_insert('offset_factor', frame=max(2, f_end))

# ---------------------------------------------------------------- the day's route: Dijkstra between visits along real streets
comp_start = max(graph, key=lambda k: len(graph[k]))
seen, stack = {comp_start}, [comp_start]
while stack:
    k = stack.pop()
    for n, _ in graph[k]:
        if n not in seen:
            seen.add(n); stack.append(n)
def nearest(x, y):
    return min(seen, key=lambda k: (pos[k][0] - x) ** 2 + (pos[k][1] - y) ** 2)
def shortest(a, b):
    dist, prev, q = {a: 0.0}, {}, [(0.0, a)]
    while q:
        d, k = heapq.heappop(q)
        if k == b:
            break
        if d > dist[k]:
            continue
        for n, w in graph[k]:
            nd = d + w
            if nd < dist.get(n, 1e18):
                dist[n] = nd; prev[n] = k; heapq.heappush(q, (nd, n))
    path = [b]
    while path[-1] != a:
        path.append(prev[path[-1]])
    return path[::-1]
STOPS = [(-170, -190), (-95, -60), (140, 40), (60, 200), (150, 60), (-210, 140), (-170, -190)]   # home, bakery, work, lunch, work, gym, home
stop_keys = [nearest(x, y) for x, y in STOPS]
route_keys = [stop_keys[0]]
stop_index = [0]
for a, b in zip(stop_keys, stop_keys[1:]):
    route_keys += shortest(a, b)[1:]
    stop_index.append(len(route_keys) - 1)
route = [pos[k] for k in route_keys]
cum = [0.0]
for a, b in zip(route, route[1:]):
    cum.append(cum[-1] + math.dist(a, b))
total = cum[-1]
stop_frac = [cum[i] / total for i in stop_index]

# timing: the trail runs between visits at a steady speed and pauses briefly at each visit
HOLD = 6
travel = ROUTE_DONE - ROUTE_ON - HOLD * (len(STOPS) - 1)
keys = [(ROUTE_ON, 0.0)]
f = ROUTE_ON
for i in range(1, len(STOPS)):
    f += travel * (stop_frac[i] - stop_frac[i - 1])
    keys.append((f, stop_frac[i]))
    if i < len(STOPS) - 1:
        f += HOLD; keys.append((f, stop_frac[i]))

trail = path_curve('route', route, 1.2)
trail.data.bevel_depth = 1.1; trail.data.bevel_resolution = 2; trail.data.use_fill_caps = True
trail.data.bevel_factor_mapping_end = 'SPLINE'
trail.data.materials.append(M_ROUTE)
trail.hide_render = True; trail.keyframe_insert('hide_render', frame=ROUTE_ON - 1)   # no stub of the trail before it starts
trail.hide_render = False; trail.keyframe_insert('hide_render', frame=ROUTE_ON)
trail.data.path_duration = FRAMES
for fr_, v in [(1, 0.0)] + keys:
    trail.data.bevel_factor_end = max(v, 0.0005); trail.data.keyframe_insert('bevel_factor_end', frame=int(round(fr_)))
head = link('route_head', bpy.data.lights.new('route_head', 'POINT'))
head.data.energy = 9000; head.data.color = (1.0, 0.2, 0.08); head.data.shadow_soft_size = 2.0
con = head.constraints.new('FOLLOW_PATH'); con.target = trail
for fr_, v in [(1, 0.0)] + keys:
    con.offset_factor = v; con.keyframe_insert('offset_factor', frame=int(round(fr_)))
head.location = (0, 0, 10); head.visible_camera = False
head.data.energy = 0; head.data.keyframe_insert('energy', frame=ROUTE_ON - 1)
head.data.energy = 9000; head.data.keyframe_insert('energy', frame=ROUTE_ON + 2)

def linear(obj_or_data):
    ad = obj_or_data.animation_data
    if ad and ad.action:
        for layer in getattr(ad.action, 'layers', []):
            for strip in layer.strips:
                for bag in strip.channelbags:
                    for fc in bag.fcurves:
                        for kp in fc.keyframe_points:
                            kp.interpolation = 'LINEAR'
        for fc in getattr(ad.action, 'fcurves', []):
            for kp in fc.keyframe_points:
                kp.interpolation = 'LINEAR'
for o in [trail.data, head] + [o for o in col.objects if o.name.startswith('car_')]:
    linear(o)

# visits: a light pillar rises and a ring pulses out on the street when the trail reaches each place
pillar_mesh = bpy.data.meshes.new('pillar'); pbm = bmesh.new()
bmesh.ops.create_cone(pbm, cap_ends=False, segments=24, radius1=2.2, radius2=2.2, depth=70); bmesh.ops.translate(pbm, verts=list(pbm.verts), vec=(0, 0, 35))
pbm.to_mesh(pillar_mesh); pbm.free()
ring_mesh = bpy.data.meshes.new('ring'); rbm = bmesh.new()
bmesh.ops.create_circle(rbm, segments=48, radius=1.0); rbm.verts.ensure_lookup_table()
outer = [v.co.copy() for v in rbm.verts]
for v in rbm.verts:
    v.co *= 0.86
ov = [rbm.verts.new(c) for c in outer]; inner = list(rbm.verts)[:48]
for i in range(48):
    rbm.faces.new((inner[i], inner[(i + 1) % 48], ov[(i + 1) % 48], ov[i]))
rbm.to_mesh(ring_mesh); rbm.free()
def pillar(i, x, y, fr_):
    mp = glow_material(f'pillar_{i}', (1.0, 0.3, 0.15), 6.0, fade_up=True)
    p = link(f'visit_pillar_{i}', pillar_mesh.copy()); p.data.materials.append(mp); p.location = (x, y, 0)
    p.scale = (0.001, 0.001, 0.001); p.keyframe_insert('scale', frame=fr_ - 1)      # not there before the visit
    p.scale = (1, 1, 0.001); p.keyframe_insert('scale', frame=fr_)
    p.scale = (1, 1, 1); p.keyframe_insert('scale', frame=fr_ + 8)
    lv = mp.node_tree.nodes['level'].outputs[0]
    lv.default_value = 1.0; lv.keyframe_insert('default_value', frame=fr_ + 8)
    lv.default_value = 0.45; lv.keyframe_insert('default_value', frame=fr_ + 40)

events = []
seen_stop = set()
for i, (k, fr_) in enumerate(zip(stop_keys, [ROUTE_ON] + [k_[0] for k_ in keys[1::2]])):
    fr_ = int(round(fr_))
    x, y = pos[k]
    revisit = k in seen_stop; seen_stop.add(k)
    if not revisit:                                     # going back to work or home re-pulses the ring only
        pillar(i, x, y, fr_)
    mr = glow_material(f'ring_{i}', (1.0, 0.35, 0.2), 10.0)
    r = link(f'visit_ring_{i}', ring_mesh); r.data = ring_mesh.copy(); r.data.materials.append(mr); r.location = (x, y, 0.6)
    r.scale = (0.001, 0.001, 1); r.keyframe_insert('scale', frame=fr_ - 1)
    r.scale = (1, 1, 1); r.keyframe_insert('scale', frame=fr_)
    r.scale = (28, 28, 1); r.keyframe_insert('scale', frame=fr_ + 22)
    lv = mr.node_tree.nodes['level'].outputs[0]
    lv.default_value = 0.0; lv.keyframe_insert('default_value', frame=fr_ - 1)
    lv.default_value = 1.0; lv.keyframe_insert('default_value', frame=fr_)
    lv.default_value = 0.0; lv.keyframe_insert('default_value', frame=fr_ + 22)
    events.append({'frame': fr_, 'kind': 'revisit' if revisit else 'visit', 'index': i})
json.dump({'fps': FPS, 'frames': FRAMES, 'routeOn': ROUTE_ON, 'routeDone': ROUTE_DONE, 'routeLengthM': round(total), 'events': events},
          open(os.path.join(S, 'android-city-events.json'), 'w'), indent=1)

# ---------------------------------------------------------------- camera: slow descent over the sleeping city, then it
# follows the trail head while rising, ending almost straight down over the whole day's route
cam = link('camera', bpy.data.cameras.new('camera')); sc.camera = cam
cam.data.lens = 28; cam.data.clip_end = 6000; cam.data.sensor_fit = 'AUTO'
aim = link('aim', None)
tc = cam.constraints.new('TRACK_TO'); tc.target = aim; tc.track_axis = 'TRACK_NEGATIVE_Z'; tc.up_axis = 'UP_Y'
def route_point(frac):
    d = frac * total
    i = max(0, min(len(cum) - 2, next((j for j in range(len(cum) - 1) if cum[j + 1] >= d), len(cum) - 2)))
    t = (d - cum[i]) / max(1e-6, cum[i + 1] - cum[i])
    return Vector((route[i][0] + (route[i + 1][0] - route[i][0]) * t, route[i][1] + (route[i + 1][1] - route[i][1]) * t, 0))
def frac_at(frame):
    if frame <= keys[0][0]:
        return 0.0
    for (f0, v0), (f1, v1) in zip(keys, keys[1:]):
        if frame <= f1:
            return v0 + (v1 - v0) * (frame - f0) / max(1e-6, f1 - f0)
    return 1.0
centre = sum((Vector((p[0], p[1], 0)) for p in route), Vector()) / len(route)
home = Vector((*pos[stop_keys[0]], 0))
def ease(x):
    x = max(0.0, min(1.0, x)); return x * x * (3 - 2 * x)
# the whole route must fit the narrow (horizontal) field of view at the end
reach = max((Vector((p[0], p[1], 0)) - centre).length for p in route)
END_LENS = 19                                           # the lens widens during the reveal so the camera can stay low
final_alt = reach * 1.08 / (18 * 9 / 16 / END_LENS)
# the aim chases the trail head like a damped spring, so the frame never jumps when the head turns a corner
aim_pos, aim_vel = home.copy(), Vector()
for f_ in range(1, FRAMES + 1):
    if f_ <= ROUTE_ON:
        a = ease(f_ / ROUTE_ON)
        goal = home
        alt, back, yaw = 430 - 200 * a, 380 - 170 * a, math.radians(188 + 24 * a)
    else:
        a = ease((f_ - ROUTE_ON) / (ROUTE_DONE - ROUTE_ON))
        reveal = ease((f_ - (ROUTE_DONE - 40)) / (FRAMES - ROUTE_DONE + 40))
        goal = route_point(frac_at(f_)).lerp(centre, reveal)
        alt = (230 + 130 * a) * (1 - reveal) + final_alt * reveal
        back, yaw = (210 - 30 * a) * (1 - reveal) + 40 * reveal, math.radians(212 + 30 * a + 8 * reveal)
    aim_vel = aim_vel * 0.86 + (goal - aim_pos) * 0.018
    aim_pos = aim_pos + aim_vel
    target = aim_pos
    aim.location = target; aim.keyframe_insert('location', frame=f_)
    if f_ > ROUTE_ON:
        cam.data.lens = 28 + (END_LENS - 28) * reveal; cam.data.keyframe_insert('lens', frame=f_)
    cam.location = target + Vector((math.sin(yaw) * back, math.cos(yaw) * back, alt)); cam.keyframe_insert('location', frame=f_)

# ---------------------------------------------------------------- world, moonlight, render, haze and glow
world = bpy.data.worlds.new('night'); sc.world = world; world.use_nodes = True
wn = world.node_tree.nodes; wl = world.node_tree.links
bg = wn['Background']
hdr = os.path.join(S, 'assets', 'polyhaven', 'satara_night')
hdr_file = next((os.path.join(hdr, f) for f in os.listdir(hdr) if f.endswith(('.hdr', '.exr'))), None) if os.path.isdir(hdr) else None
if hdr_file:
    env = wn.new('ShaderNodeTexEnvironment'); env.image = bpy.data.images.load(hdr_file); wl.new(env.outputs[0], bg.inputs[0])
bg.inputs['Strength'].default_value = 0.6
moon = link('moon', bpy.data.lights.new('moon', 'SUN')); moon.data.energy = 0.35; moon.data.color = (0.62, 0.72, 1.0)
moon.data.angle = math.radians(0.6); moon.rotation_euler = (math.radians(52), 0, math.radians(35))

sc.render.engine = 'CYCLES'
sc.cycles.samples = 128; sc.cycles.use_denoising = True; sc.cycles.denoiser = 'OPENIMAGEDENOISE'
sc.cycles.max_bounces = 6; sc.cycles.transparent_max_bounces = 12
sc.cycles.use_light_tree = True
sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = 1080, 1920, 50
sc.render.fps = FPS; sc.frame_start, sc.frame_end = 1, FRAMES
sc.render.use_motion_blur = True; sc.render.motion_blur_shutter = 0.18   # the camera chases the trail fast; a long shutter smears the windows
sc.view_settings.view_transform = 'AgX'
try:
    sc.view_settings.look = 'AgX - Medium High Contrast'
except TypeError:
    pass
sc.view_settings.exposure = 0.0
vl = sc.view_layers[0]; vl.use_pass_mist = True
world.mist_settings.start = 380; world.mist_settings.depth = 1500; world.mist_settings.falloff = 'QUADRATIC'
ng = bpy.data.node_groups.new('comp', 'CompositorNodeTree'); sc.compositing_node_group = ng
ng.interface.new_socket('Image', in_out='OUTPUT', socket_type='NodeSocketColor')
rl = ng.nodes.new('CompositorNodeRLayers')
haze = ng.nodes.new('ShaderNodeMix'); haze.data_type = 'RGBA'
haze_amt = ng.nodes.new('ShaderNodeMath'); haze_amt.operation = 'MULTIPLY'; haze_amt.inputs[1].default_value = 0.85
ng.links.new(rl.outputs['Mist'], haze_amt.inputs[0]); ng.links.new(haze_amt.outputs[0], haze.inputs['Factor'])
ng.links.new(rl.outputs['Image'], haze.inputs['A']); haze.inputs['B'].default_value = (0.05, 0.06, 0.095, 1)
def set_menu(sock, names):
    for n in names:
        try:
            sock.default_value = n; return
        except (TypeError, ValueError):
            pass
glare = ng.nodes.new('CompositorNodeGlare'); ng.links.new(haze.outputs['Result'], glare.inputs['Image'])
set_menu(glare.inputs['Type'], ('Fog Glow', 'FOG_GLOW')); glare.inputs['Threshold'].default_value = 1.2
glare.inputs['Strength'].default_value = 0.45; glare.inputs['Size'].default_value = 0.5
out = ng.nodes.new('NodeGroupOutput'); ng.links.new(glare.outputs['Image'], out.inputs[0])
sc.render.image_settings.file_format = 'PNG'
sc.render.filepath = os.path.join(S, 'scene5_frames', 'f_')
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(S, 'scene5-android-city.blend'))
print(f'built: {len(footprints)} buildings, {len(lamp_spots)} lamp spots, {len(main_ways)} car streets, route {total:.0f} m, visits at frames {[e["frame"] for e in events]}')
