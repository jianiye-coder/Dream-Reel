"""Dream Reel desk pencil — modelled and rendered headless.

    blender -b -P assets/blender/pencil.py -- public/images/desk-pencil.png

Top-down orthographic render on a transparent background. The pencil lies at its final
on-screen angle (eraser up-right, tip down-left) and the sun comes from the upper right like
the window in the page, so the shadow caught on the desk agrees with the book's shadow.
"""
import math
import sys

import bpy
from mathutils import Euler, Vector

OUT = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else "/tmp/desk-pencil.png"

# ── units: metres. A real pencil is ~19 cm long and 7.4 mm across the flats.
R = 0.0037            # hexagon circumradius
BODY = 0.150
CONE = 0.021
TIP = 0.005
FERRULE = 0.012
ERASER = 0.0085
ANGLE = math.radians(72)  # from the screen's horizontal

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def material(name, color, rough, metallic=0.0, coat=0.0, noise=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metallic
    if "Coat Weight" in bsdf.inputs:
        bsdf.inputs["Coat Weight"].default_value = coat
    if noise:  # stretched noise reads as wood grain along the pencil
        tex = nt.nodes.new("ShaderNodeTexNoise")
        tex.inputs["Scale"].default_value = noise
        mapping = nt.nodes.new("ShaderNodeMapping")
        mapping.inputs["Scale"].default_value = (1, 40, 40)
        coord = nt.nodes.new("ShaderNodeTexCoord")
        ramp = nt.nodes.new("ShaderNodeValToRGB")
        ramp.color_ramp.elements[0].color = (*[c * 0.82 for c in color], 1)
        ramp.color_ramp.elements[1].color = (*color, 1)
        nt.links.new(coord.outputs["Object"], mapping.inputs["Vector"])
        nt.links.new(mapping.outputs["Vector"], tex.inputs["Vector"])
        nt.links.new(tex.outputs["Fac"], ramp.inputs["Fac"])
        nt.links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    return m


lacquer = material("lacquer", (0.012, 0.02, 0.045), 0.16, coat=1.0)
gold = material("gold", (0.83, 0.62, 0.30), 0.28, metallic=1.0)
wood = material("wood", (0.80, 0.62, 0.42), 0.6, noise=6.0)
graphite = material("graphite", (0.06, 0.06, 0.065), 0.38, metallic=0.6)
brass = material("brass", (0.78, 0.66, 0.42), 0.32, metallic=1.0)
rubber = material("rubber", (0.80, 0.44, 0.42), 0.85)

parts = []


def add(obj, mat):
    obj.data.materials.append(mat)
    parts.append(obj)
    return obj


# Everything is built along +X (tip at -X), centred, then the whole pencil is rotated.
x0 = -(BODY + CONE + TIP + FERRULE + ERASER) / 2

# sharpened cone and graphite
bpy.ops.mesh.primitive_cone_add(vertices=48, radius1=0.00105, radius2=R * 0.98, depth=CONE,
                                location=(x0 + TIP + CONE / 2, 0, 0), rotation=(0, math.pi / 2, 0))
add(bpy.context.object, wood)
bpy.ops.mesh.primitive_cone_add(vertices=32, radius1=0.00012, radius2=0.00105, depth=TIP,
                                location=(x0 + TIP / 2, 0, 0), rotation=(0, math.pi / 2, 0))
add(bpy.context.object, graphite)

# hexagonal lacquered body, edges slightly softened
bx = x0 + TIP + CONE
# turn the hexagon on its own axis first (so a flat faces the desk), bake that in, then lay it along X;
# folding both into one Euler would spin the whole body about the world Z instead
bpy.ops.mesh.primitive_cylinder_add(vertices=6, radius=R, depth=BODY, location=(0, 0, 0), rotation=(0, 0, math.radians(30)))
body = add(bpy.context.object, lacquer)
bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
body.location = (bx + BODY / 2, 0, 0)
body.rotation_euler = (0, math.pi / 2, 0)
bev = body.modifiers.new("soft edges", "BEVEL")
bev.width = 0.00035
bev.segments = 3
bev.limit_method = "ANGLE"

# a fine gold ring near the ferrule
bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=R * 1.005, depth=0.0009,
                                    location=(bx + BODY - 0.006, 0, 0), rotation=(0, math.pi / 2, 0))
add(bpy.context.object, gold)

# ferrule with three crimped ridges
fx = bx + BODY
bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=R * 1.04, depth=FERRULE,
                                    location=(fx + FERRULE / 2, 0, 0), rotation=(0, math.pi / 2, 0))
add(bpy.context.object, brass)
for k in (0.25, 0.5, 0.75):
    bpy.ops.mesh.primitive_torus_add(major_radius=R * 1.04, minor_radius=0.00028, major_segments=48, minor_segments=8,
                                     location=(fx + FERRULE * k, 0, 0), rotation=(0, math.pi / 2, 0))
    add(bpy.context.object, brass)

# eraser, rounded at the end
ex = fx + FERRULE
bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=R * 0.97, depth=ERASER,
                                    location=(ex + ERASER / 2, 0, 0), rotation=(0, math.pi / 2, 0))
eraser = add(bpy.context.object, rubber)
eb = eraser.modifiers.new("round end", "BEVEL")
eb.width = 0.0012
eb.segments = 5

for p in parts:
    bpy.ops.object.select_all(action="DESELECT")
    p.select_set(True)
    bpy.context.view_layer.objects.active = p
    bpy.ops.object.shade_smooth()

# group, lay it on the desk (resting on a flat), rotate to its on-screen angle
pivot = bpy.data.objects.new("pencil", None)
scene.collection.objects.link(pivot)
for p in parts:
    p.parent = pivot
pivot.location = (0, 0, R * math.cos(math.radians(30)))
pivot.rotation_euler = Euler((0, 0, ANGLE))

# desk: catches the shadow only, so the PNG drops onto any page background
bpy.ops.mesh.primitive_plane_add(size=1)
desk = bpy.context.object
desk.is_shadow_catcher = True

# light: a soft sun from the upper right (the window), plus warm room light
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

# camera straight down, orthographic, framed on the rotated pencil plus room for its shadow
total = BODY + CONE + TIP + FERRULE + ERASER
w = total * math.cos(ANGLE) + 0.02
h = total * math.sin(ANGLE) + 0.016
bpy.ops.object.camera_add(location=(-0.002, -0.002, 1), rotation=(0, 0, 0))
cam = bpy.context.object
cam.data.type = "ORTHO"
cam.data.ortho_scale = max(w, h)
scene.camera = cam

PX_PER_M = 600 / 0.19  # ~2x density: about 300 CSS px of pencil
scene.render.resolution_x = int(w * PX_PER_M)
scene.render.resolution_y = int(h * PX_PER_M)
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = 128
scene.cycles.use_denoising = True
scene.render.film_transparent = True
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"
scene.view_settings.view_transform = "Standard"
scene.render.filepath = OUT
bpy.ops.render.render(write_still=True)
print("rendered", OUT, scene.render.resolution_x, scene.render.resolution_y)
