"""Dream Reel desk fountain pen — modelled and rendered headless.

    blender -b -P assets/blender/pen.py -- public/images/desk-pen.png

Top-down orthographic render on a transparent background. The pen lies at its final on-screen
angle (nib down-left, posted cap up-right); the sun comes from the upper right like the window
in the page, so its shadow, caught on the desk, agrees with the book's.
"""
import math
import sys

import bpy
from mathutils import Euler, Vector

OUT = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else "/tmp/desk-pen.png"
ANGLE = math.radians(72)

# metres; a typical fountain pen is ~14 cm capped, ~15.5 cm posted
NIB = 0.020
SECTION = 0.019
BARREL = 0.090
CAP = 0.058
CAP_OVERLAP = 0.040   # how far the posted cap slides over the end of the barrel
R_BARREL = 0.0062
R_CAP = 0.0070
R_SECTION = 0.0050

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def material(name, color, rough, metallic=0.0, coat=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metallic
    if "Coat Weight" in bsdf.inputs:
        bsdf.inputs["Coat Weight"].default_value = coat
    return m


resin = material("navy resin", (0.012, 0.02, 0.048), 0.12, coat=1.0)
gold = material("gold", (0.86, 0.66, 0.33), 0.22, metallic=1.0)
section_black = material("section", (0.01, 0.01, 0.012), 0.18, coat=0.6)
nib_gold = material("nib", (0.9, 0.72, 0.4), 0.16, metallic=1.0)
slit_dark = material("slit", (0.02, 0.015, 0.01), 0.5)

parts = []


def add(obj, mat, smooth=True):
    obj.data.materials.append(mat)
    if smooth:
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.shade_smooth()
    parts.append(obj)
    return obj


def along_x(obj, x):
    """Primitives are built along Z; lay them along +X at position x (their centre)."""
    obj.location = (x, 0, 0)
    obj.rotation_euler = (0, math.pi / 2, 0)
    return obj


def bevelled(obj, width, segments=4):
    b = obj.modifiers.new("soft", "BEVEL")
    b.width = width
    b.segments = segments
    return obj


# x runs from the nib tip (most negative) to the end of the posted cap
total = NIB + SECTION + BARREL + (CAP - CAP_OVERLAP)
x0 = -total / 2

# nib: a flattened, tapering cone with a dark slit down the middle
bpy.ops.mesh.primitive_cone_add(vertices=48, radius1=0.00025, radius2=R_SECTION * 0.92, depth=NIB)
nib = along_x(bpy.context.object, x0 + NIB / 2)
nib.scale = (0.38, 1, 1)   # flatten across the nib's thickness (local X becomes height once laid down)
add(nib, nib_gold)
bpy.ops.mesh.primitive_cube_add(size=1)
slit = along_x(bpy.context.object, x0 + NIB * 0.42)
slit.scale = (0.0009, 0.00022, NIB * 0.78)
slit.location.z = R_SECTION * 0.92 * 0.38 * 0.55
add(slit, slit_dark, smooth=False)
# breather hole at the end of the slit
bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=0.00045, depth=0.002)
hole = bpy.context.object
hole.location = (x0 + NIB * 0.82, 0, R_SECTION * 0.92 * 0.38 * 0.6)
add(hole, slit_dark)

# grip section: tapering black
sx = x0 + NIB
bpy.ops.mesh.primitive_cone_add(vertices=64, radius1=R_SECTION * 0.92, radius2=R_SECTION, depth=SECTION)
add(bevelled(along_x(bpy.context.object, sx + SECTION / 2), 0.0004), section_black)

# gold ring where the section meets the barrel
bx = sx + SECTION
bpy.ops.mesh.primitive_cylinder_add(vertices=64, radius=R_BARREL * 1.01, depth=0.0016)
add(along_x(bpy.context.object, bx + 0.0008), gold)

# barrel
bpy.ops.mesh.primitive_cylinder_add(vertices=64, radius=R_BARREL, depth=BARREL)
add(bevelled(along_x(bpy.context.object, bx + 0.0016 + BARREL / 2), 0.0008), resin)

# posted cap over the end of the barrel, with a gold lip band, a gold end and a clip
cx = bx + 0.0016 + BARREL - CAP_OVERLAP
bpy.ops.mesh.primitive_cylinder_add(vertices=64, radius=R_CAP, depth=CAP)
add(bevelled(along_x(bpy.context.object, cx + CAP / 2), 0.0014), resin)
bpy.ops.mesh.primitive_cylinder_add(vertices=64, radius=R_CAP * 1.012, depth=0.0035)
add(along_x(bpy.context.object, cx + 0.0022), gold)
bpy.ops.mesh.primitive_uv_sphere_add(segments=48, ring_count=24, radius=R_CAP * 0.62)
end = bpy.context.object
end.location = (cx + CAP - 0.0006, 0, 0)
end.scale = (0.35, 1, 1)
add(end, gold)
# clip: a slim gold bar lying on top of the cap, with a rounded ball at its tip
bpy.ops.mesh.primitive_cube_add(size=1)
clip = bpy.context.object
clip.scale = (CAP * 0.62, 0.0026, 0.0011)
clip.location = (cx + CAP * 0.62, 0, R_CAP + 0.0006)
add(bevelled(clip, 0.0004), gold)
bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, radius=0.0016)
ball = bpy.context.object
ball.location = (cx + CAP * 0.31, 0, R_CAP + 0.0008)
add(ball, gold)

# group, lift so the cap rests on the desk, rotate to the on-screen angle
pivot = bpy.data.objects.new("pen", None)
scene.collection.objects.link(pivot)
for p in parts:
    p.parent = pivot
pivot.location = (0, 0, R_CAP)
pivot.rotation_euler = Euler((0, 0, ANGLE))

bpy.ops.mesh.primitive_plane_add(size=1)
bpy.context.object.is_shadow_catcher = True

bpy.ops.object.light_add(type="SUN")
sun = bpy.context.object
sun.data.energy = 4.0
sun.data.angle = math.radians(9)
sun.rotation_euler = Vector((-0.42, -0.52, -0.74)).to_track_quat("-Z", "Y").to_euler()
world = bpy.data.worlds.new("room")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (1.0, 0.94, 0.86, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.45
scene.world = world

w = total * math.cos(ANGLE) + 0.028
h = total * math.sin(ANGLE) + 0.02
bpy.ops.object.camera_add(location=(-0.002, -0.003, 1), rotation=(0, 0, 0))
cam = bpy.context.object
cam.data.type = "ORTHO"
cam.data.ortho_scale = max(w, h)
scene.camera = cam

PX_PER_M = 600 / 0.19  # ~2x the on-screen size (116 x 252 CSS px)
scene.render.resolution_x = int(w * PX_PER_M)
scene.render.resolution_y = int(h * PX_PER_M)
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = 160
scene.cycles.use_denoising = True
scene.render.film_transparent = True
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"
scene.view_settings.view_transform = "Standard"
scene.render.filepath = OUT
bpy.ops.render.render(write_still=True)
print("rendered", OUT, scene.render.resolution_x, scene.render.resolution_y)
