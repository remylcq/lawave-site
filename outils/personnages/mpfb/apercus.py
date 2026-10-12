"""Aperçus des personnages fabriqués : un PNG avec tous les personnages côte à côte.

    SORTIE=<dossier des <nom>_mpfb.blend> NOMS=croupier,barman VUE=corps|dos|tete|buste|profil|tq     SORTIE_PNG=apercu.png blender -b -P outils/personnages/mpfb/apercus.py
"""
import sys, os
import numpy as np
import bpy
from mathutils import Vector


def decor(fond=(0.09, 0.10, 0.12)):
    sc = bpy.context.scene
    w = bpy.data.worlds.new('monde')
    w.use_nodes = True
    bg = w.node_tree.nodes.get('Background')
    bg.inputs[0].default_value = (fond[0], fond[1], fond[2], 1)
    bg.inputs[1].default_value = 0.6
    sc.world = w
    for i, (p, e, c) in enumerate([((2.5, -3.0, 3.0), 280, (1.0, 0.92, 0.82)), ((-3.0, -2.0, 1.6), 90, (0.75, 0.85, 1.0)), ((0.0, 3.0, 3.0), 160, (1.0, 1.0, 1.0))]):
        d = bpy.data.lights.new('l%d' % i, 'AREA')
        d.energy, d.size, d.color = e, 2.0, c
        o = bpy.data.objects.new('l%d' % i, d)
        bpy.context.collection.objects.link(o)
        o.location = p
        o.rotation_euler = (Vector((0, 0, 1.0)) - Vector(p)).to_track_quat('-Z', 'Y').to_euler()


def camera(loc, cible, focale=60):
    d = bpy.data.cameras.new('cam')
    d.lens = focale
    o = bpy.data.objects.new('cam', d)
    bpy.context.collection.objects.link(o)
    o.location = loc
    o.rotation_euler = (Vector(cible) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.camera = o
    return o


def rendre(chemin, res, echantillons=16):
    sc = bpy.context.scene
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.resolution_percentage = 100
    sc.render.filepath = chemin
    sc.render.image_settings.file_format = 'PNG'
    sc.render.engine = 'BLENDER_EEVEE'
    try:
        sc.eevee.taa_render_samples = echantillons
        sc.view_settings.view_transform = 'AgX'
    except Exception:
        pass
    bpy.ops.render.render(write_still=True)


SORTIE = os.environ['SORTIE']
NOMS = os.environ['NOMS'].split(',')
VUE = os.environ.get('VUE', 'corps')
PNG = os.environ['SORTIE_PNG']
H, W = {'corps': (640, 400), 'tete': (420, 420), 'dos': (640, 400), 'buste': (500, 500), 'profil': (420, 420), 'tq': (420, 420)}[VUE]
cams = {
    'corps': ((1.8, -4.4, 1.05), (0, 0, 0.9), 60),
    'dos': ((-1.8, 4.4, 1.05), (0, 0, 0.9), 60),
    'tete': ((0.35, -1.0, 1.68), (0, 0, 1.64), 75),
    'buste': ((0.6, -2.1, 1.3), (0, 0, 1.25), 62),
    'profil': ((1.0, -0.15, 1.66), (0, 0, 1.64), 65),
    'tq': ((0.55, -0.85, 1.7), (0, 0, 1.64), 70),
}
vign = []
for nom in NOMS:
    bpy.ops.wm.open_mainfile(filepath=os.path.join(SORTIE, nom + '_mpfb.blend'))
    # les formes clés (doigts, paupières) sont à 0 : le personnage au repos
    for o in bpy.data.objects:
        if o.type == 'MESH' and o.data.shape_keys:
            for k in o.data.shape_keys.key_blocks:
                if k.name != 'Basis':
                    k.value = 0.0
    for o in bpy.data.objects:
        if o.type == 'ARMATURE':
            o.hide_set(True)
    decor()
    loc, cible, foc = cams[VUE]
    camera(loc, cible, foc)
    tmp = os.path.join(SORTIE, '_v.png')
    rendre(tmp, (W, H))
    im = bpy.data.images.load(tmp)
    vign.append(np.array(im.pixels[:], dtype=np.float32).reshape(H, W, 4))
    bpy.data.images.remove(im)
    print('vu', nom)
pl = np.concatenate(vign, axis=1)
out = bpy.data.images.new('pl', pl.shape[1], pl.shape[0], alpha=True)
out.pixels = pl.ravel().tolist()
out.filepath_raw = PNG
out.file_format = 'PNG'
out.save()
print('PLANCHE', PNG)
