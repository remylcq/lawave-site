"""Prépare les meubles du décor (fauteuil, canapé, table, tabouret) : télécharge les modèles Poly Haven (CC0),
les remet à l'échelle et dans le bon sens, allège leur maillage et leurs textures, les exporte en .glb dans decor/.

    blender -b -P outils/decor/preparer_meubles.py

Repère de sortie (celui du jeu) : le meuble est posé sur le sol (y = 0), centré, le dossier du côté -z (on s'y
assoit face à +z), à l'échelle voulue (l'assise ou le plateau à la hauteur des meubles que le jeu dessinait).
Les originaux sont gardés dans CACHE (par défaut un dossier à côté du script).
"""
import glob
import json
import math
import os
import urllib.request

import bpy
from mathutils import Vector

ICI = os.path.dirname(os.path.abspath(__file__))
RACINE = os.path.abspath(os.path.join(ICI, '..', '..'))
SORTIE = os.environ.get('DECOR_SORTIE', os.path.join(RACINE, 'decor'))
CACHE = os.environ.get('CACHE', os.path.join(ICI, '_cache'))
AGENT = {'User-Agent': 'lawave-site (decor)'}

# nom du jeu : identifiant Poly Haven, mesure à caler, hauteur voulue (m), triangles visés, taille des textures
MEUBLES = {
    'fauteuil': dict(ident='modern_arm_chair_01', mesure='assise', cible=0.38, tris=3600, tex=512, dossier=True),
    'canape': dict(ident='sofa_02', mesure='assise', cible=0.39, tris=2800, tex=512, dossier=True),
    'table': dict(ident='round_wooden_table_02', mesure='dessus', cible=0.69, tris=2600, tex=512, dossier=False),
    'tabouret': dict(ident='bar_chair_round_01', mesure='assise', plage=(0.55, 0.9), cible=0.79, tris=3600, tex=512, dossier=True),
}


def telecharger(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=AGENT)) as r:
        return r.read()


def originaux(ident):
    dossier = os.path.join(CACHE, 'modeles', ident)
    if not glob.glob(os.path.join(dossier, '*.gltf')):
        f = json.loads(telecharger('https://api.polyhaven.com/files/' + ident).decode('utf-8'))
        e = f['gltf']['1k']['gltf']
        os.makedirs(dossier, exist_ok=True)
        with open(os.path.join(dossier, os.path.basename(e['url'])), 'wb') as fh:
            fh.write(telecharger(e['url']))
        for rel, info in e.get('include', {}).items():
            chemin = os.path.join(dossier, rel)
            os.makedirs(os.path.dirname(chemin), exist_ok=True)
            with open(chemin, 'wb') as fh:
                fh.write(telecharger(info['url']))
    return glob.glob(os.path.join(dossier, '*.gltf'))[0]


def meshes():
    return [o for o in bpy.context.scene.objects if o.type == 'MESH']


def detacher_et_appliquer():
    for o in meshes():
        m = o.matrix_world.copy()
        o.parent = None
        o.matrix_world = m
    for o in list(bpy.context.scene.objects):
        if o.type != 'MESH':
            bpy.data.objects.remove(o, do_unlink=True)
    bpy.ops.object.select_all(action='DESELECT')
    for o in meshes():
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes()[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def niveau_dominant(zmin, zmax, bas, haut):
    """La hauteur (depuis le point le plus bas) où se trouve la plus grande surface tournée vers le haut, entre bas et haut."""
    niveaux = {}
    for o in meshes():
        me = o.data
        me.calc_loop_triangles()
        for t in me.loop_triangles:
            if t.normal.z < 0.9:
                continue
            vs = [me.vertices[i].co for i in t.vertices]
            z = sum(v.z for v in vs) / 3 - zmin
            if not (bas <= z <= haut):
                continue
            a = ((vs[1] - vs[0]).cross(vs[2] - vs[0])).length / 2
            cle = round(z / 0.02) * 0.02
            niveaux[cle] = niveaux.get(cle, 0) + a
    return max(niveaux.items(), key=lambda kv: kv[1])[0] if niveaux else None


def bornes():
    mn = Vector((1e9, 1e9, 1e9))
    mx = Vector((-1e9, -1e9, -1e9))
    for o in meshes():
        for v in o.data.vertices:
            mn = Vector((min(mn.x, v.co.x), min(mn.y, v.co.y), min(mn.z, v.co.z)))
            mx = Vector((max(mx.x, v.co.x), max(mx.y, v.co.y), max(mx.z, v.co.z)))
    return mn, mx


def normaliser(def_):
    detacher_et_appliquer()
    mn, mx = bornes()
    # la mesure à caler
    bas, haut = def_.get('plage') or ((0.25, 0.60) if def_['mesure'] == 'assise' else (0.45, 1.20))
    mesure = niveau_dominant(mn.z, mx.z, bas, haut)
    echelle = def_['cible'] / mesure
    for o in meshes():
        for v in o.data.vertices:
            v.co = Vector(((v.co.x) * echelle, (v.co.y) * echelle, (v.co.z - mn.z) * echelle))
    mn, mx = bornes()
    # le sens : le dossier est du côté où se trouve la matière au-dessus de l'assise
    if def_['dossier']:
        cx = cy = n = 0
        bx = by = m = 0
        for o in meshes():
            for v in o.data.vertices:
                if v.co.z > def_['cible'] + 0.18:
                    cx += v.co.x; cy += v.co.y; n += 1
                elif v.co.z < def_['cible']:
                    bx += v.co.x; by += v.co.y; m += 1
        dx, dy = (cx / n - bx / m, cy / n - by / m) if n and m else (0, 1)
        angle = math.atan2(dy, dx)
        rot = math.pi / 2 - angle                     # on amène le dossier sur +Y (Blender), c'est -z dans le jeu
        c, s = math.cos(rot), math.sin(rot)
        for o in meshes():
            for v in o.data.vertices:
                v.co = Vector((v.co.x * c - v.co.y * s, v.co.x * s + v.co.y * c, v.co.z))
    # centré sur son empreinte au sol (la moitié basse)
    mn, mx = bornes()
    cx = (mn.x + mx.x) / 2
    cy = (mn.y + mx.y) / 2
    for o in meshes():
        for v in o.data.vertices:
            v.co = Vector((v.co.x - cx, v.co.y - cy, v.co.z))
    for o in meshes():
        o.data.update()
    return echelle


def alleger(tris_vises, taille_tex, nom):
    total = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in meshes())
    if total > tris_vises:
        ratio = tris_vises / total
        for o in meshes():
            bpy.context.view_layer.objects.active = o
            md = o.modifiers.new('alleger', 'DECIMATE')
            md.ratio = ratio
            bpy.ops.object.modifier_apply(modifier=md.name)
    restants = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in meshes())
    # les textures : réduites, puis enregistrées en JPEG et relues
    os.makedirs(os.path.join(CACHE, 'tmp'), exist_ok=True)
    nouvelles = {}
    for mat in bpy.data.materials:
        if not mat.node_tree:
            continue
        for n in mat.node_tree.nodes:
            if n.type == 'TEX_IMAGE' and n.image:
                src = n.image
                if src.name not in nouvelles:
                    src.scale(taille_tex, taille_tex)
                    chemin = os.path.join(CACHE, 'tmp', '%s_%d.jpg' % (nom, len(nouvelles)))
                    sc = bpy.context.scene
                    sc.render.image_settings.file_format = 'JPEG'
                    sc.render.image_settings.color_mode = 'RGB'
                    sc.render.image_settings.quality = 82
                    src.save_render(chemin, scene=sc)
                    im = bpy.data.images.load(chemin)
                    im.colorspace_settings.name = src.colorspace_settings.name
                    nouvelles[src.name] = im
                n.image = nouvelles[src.name]
    return restants


def exporter(nom):
    os.makedirs(SORTIE, exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT')
    for o in meshes():
        o.select_set(True)
    chemin = os.path.join(SORTIE, nom + '.glb')
    bpy.ops.export_scene.gltf(filepath=chemin, export_format='GLB', use_selection=True, export_yup=True,
                              export_image_format='AUTO', export_apply=False, export_cameras=False, export_lights=False)
    return os.path.getsize(chemin)


def main():
    for nom, d in MEUBLES.items():
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.gltf(filepath=originaux(d['ident']))
        e = normaliser(d)
        tris = alleger(d['tris'], d['tex'], nom)
        taille = exporter(nom)
        mn, mx = bornes()
        print('%-10s %-22s échelle %.3f  %.2f x %.2f x %.2f m  %d triangles  %d Ko' % (
            nom, d['ident'], e, mx.x - mn.x, mx.y - mn.y, mx.z - mn.z, tris, taille // 1024))


main()
