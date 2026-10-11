"""Aides Blender : construire un maillage depuis des Formes, le fusionner, le rendre."""
import bpy, bmesh, math, os, time
import numpy as np
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree


def B(v):
    """Repère du jeu (x, y haut, z avant) -> Blender (x, -z, y)."""
    v = np.asarray(v, float)
    if v.ndim == 1:
        return (v[0], -v[2], v[1])
    return np.stack([v[:, 0], -v[:, 2], v[:, 1]], 1)


def J(v):
    """Blender -> repère du jeu."""
    v = np.asarray(v, float)
    if v.ndim == 1:
        return (v[0], v[2], -v[1])
    return np.stack([v[:, 0], v[:, 2], -v[:, 1]], 1)


def chrono(nom, t0):
    print('  [%5.1f s] %s' % (time.time() - t0, nom), flush=True)
    return time.time()


def vider():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def mesh_depuis(v, f, nom, classes=None):
    me = bpy.data.meshes.new(nom)
    me.from_pydata([tuple(p) for p in B(np.asarray(v, float))], [], [tuple(q) for q in f])
    me.update()
    if classes is not None:
        a = me.attributes.new('classe', 'INT', 'POINT')
        a.data.foreach_set('value', np.asarray(classes, np.int32))
    o = bpy.data.objects.new(nom, me)
    bpy.context.collection.objects.link(o)
    return o


def activer(o):
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o


def orienter(o):
    """Normales vers l'extérieur (formes fermées)."""
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.00005)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(o.data)
    bm.free()
    o.data.update()


def remesh(o, voxel, lissage=2):
    activer(o)
    m = o.modifiers.new('Remesh', 'REMESH')
    m.mode = 'VOXEL'
    m.voxel_size = voxel
    m.use_smooth_shade = True
    bpy.ops.object.modifier_apply(modifier=m.name)
    if lissage:
        s = o.modifiers.new('Lisse', 'SMOOTH')
        s.factor = 0.5
        s.iterations = lissage
        bpy.ops.object.modifier_apply(modifier=s.name)
    o.data.update()


def lisser_normales(o):
    for p in o.data.polygons:
        p.use_smooth = True


def stats(o):
    return '%d sommets, %d faces' % (len(o.data.vertices), len(o.data.polygons))


# ------------------------------------------------------------------ le rendu d'aperçu

def decor(fond=(0.09, 0.10, 0.12)):
    sc = bpy.context.scene
    w = bpy.data.worlds.new('monde')
    w.use_nodes = True
    nt = w.node_tree
    bg = nt.nodes.get('Background')
    bg.inputs[0].default_value = (fond[0], fond[1], fond[2], 1)
    bg.inputs[1].default_value = 0.6
    sc.world = w
    lampes = [((2.5, -3.0, 3.0), 280, (1.0, 0.92, 0.82)),      # clé chaude, à gauche de la caméra
              ((-3.0, -2.0, 1.6), 90, (0.75, 0.85, 1.0)),      # remplissage froid
              ((0.0, 3.0, 3.0), 160, (1.0, 1.0, 1.0))]         # contre-jour
    for i, (p, e, c) in enumerate(lampes):
        d = bpy.data.lights.new('l%d' % i, 'AREA')
        d.energy = e
        d.size = 2.0
        d.color = c
        o = bpy.data.objects.new('l%d' % i, d)
        bpy.context.collection.objects.link(o)
        o.location = p
        dirv = Vector((0, 0, 1.0)) - Vector(p)
        o.rotation_euler = dirv.to_track_quat('-Z', 'Y').to_euler()


def camera(loc, cible, focale=60):
    d = bpy.data.cameras.new('cam')
    d.lens = focale
    o = bpy.data.objects.new('cam', d)
    bpy.context.collection.objects.link(o)
    o.location = loc
    o.rotation_euler = (Vector(cible) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.camera = o
    return o


def materiau_argile(o, couleur=(0.78, 0.76, 0.72), rug=0.55):
    m = bpy.data.materials.new('argile')
    m.use_nodes = True
    b = m.node_tree.nodes.get('Principled BSDF')
    b.inputs['Base Color'].default_value = (*couleur, 1)
    b.inputs['Roughness'].default_value = rug
    o.data.materials.clear()
    o.data.materials.append(m)


def rendre(chemin, res=(640, 800), moteur='EEVEE', echantillons=24):
    sc = bpy.context.scene
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.resolution_percentage = 100
    sc.render.filepath = chemin
    sc.render.image_settings.file_format = 'PNG'
    if moteur == 'EEVEE':
        sc.render.engine = 'BLENDER_EEVEE'
        try:
            sc.eevee.taa_render_samples = echantillons
        except Exception:
            pass
    else:
        sc.render.engine = 'CYCLES'
        sc.cycles.samples = echantillons
        sc.cycles.device = 'GPU'
        try:
            prefs = bpy.context.preferences.addons['cycles'].preferences
            prefs.compute_device_type = 'OPTIX'
            prefs.get_devices()
            for d in prefs.devices:
                d.use = d.type == 'OPTIX'
        except Exception as e:
            print('GPU:', e)
    # tonalité
    try:
        sc.view_settings.view_transform = 'AgX'
    except Exception:
        pass
    bpy.ops.render.render(write_still=True)


# ------------------------------------------------------------------ chaîne haute définition -> basse définition

def dupliquer(o, nom):
    o2 = o.copy()
    o2.data = o.data.copy()
    o2.name = nom
    bpy.context.collection.objects.link(o2)
    return o2


def nb_tris(o):
    return sum(len(p.vertices) - 2 for p in o.data.polygons)


def decimer(o, cible_tris):
    activer(o)
    t = o.modifiers.new('Tri', 'TRIANGULATE')
    bpy.ops.object.modifier_apply(modifier=t.name)
    n = nb_tris(o)
    m = o.modifiers.new('Dec', 'DECIMATE')
    m.decimate_type = 'COLLAPSE'
    m.ratio = min(1.0, cible_tris / float(n))
    m.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier=m.name)
    lisser_normales(o)
    o.data.update()


def deplier(o, marge=0.004, angle=66):
    activer(o)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    try:
        bpy.ops.uv.smart_project(angle_limit=math.radians(angle), island_margin=marge)
    except TypeError:
        bpy.ops.uv.smart_project(angle_limit=math.radians(angle), margin_method='SCALED', island_margin=marge)
    bpy.ops.object.mode_set(mode='OBJECT')


def nouvelle_image(nom, taille, flottant=False, couleur=(0, 0, 0, 1), non_couleur=True):
    if nom in bpy.data.images:
        bpy.data.images.remove(bpy.data.images[nom])
    im = bpy.data.images.new(nom, taille, taille, alpha=False, float_buffer=flottant)
    im.generated_color = couleur
    if non_couleur:
        im.colorspace_settings.name = 'Non-Color'
    return im


def mat_emission(nom, fabrique):
    """fabrique(nt, sortie_emission) : branche la couleur voulue ; renvoie le matériau."""
    m = bpy.data.materials.new(nom)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    sortie = nt.nodes.new('ShaderNodeOutputMaterial')
    em = nt.nodes.new('ShaderNodeEmission')
    nt.links.new(em.outputs[0], sortie.inputs[0])
    fabrique(nt, em)
    return m


def cible_bake(low, image):
    """Matériau de la basse définition avec le noeud image actif (la cible des cuissons)."""
    if not low.data.materials:
        m = bpy.data.materials.new('cible')
        m.use_nodes = True
        low.data.materials.append(m)
    m = low.data.materials[0]
    m.use_nodes = True
    nt = m.node_tree
    n = nt.nodes.new('ShaderNodeTexImage')
    n.image = image
    nt.nodes.active = n
    return n


def cuire(high, low, image, type_, materiau_high=None, marge=10, extrusion=0.02, distance=0.06, normal='TANGENT', echantillons=8):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.samples = echantillons
    sc.cycles.device = 'GPU'
    try:
        prefs = bpy.context.preferences.addons['cycles'].preferences
        prefs.compute_device_type = 'OPTIX'
        prefs.get_devices()
        for d in prefs.devices:
            d.use = d.type == 'OPTIX'
    except Exception as e:
        print('GPU:', e)
    cible_bake(low, image)
    if materiau_high is not None:
        high.data.materials.clear()
        high.data.materials.append(materiau_high)
    bpy.ops.object.select_all(action='DESELECT')
    high.select_set(True)
    low.select_set(True)
    bpy.context.view_layer.objects.active = low
    kw = dict(type=type_, use_selected_to_active=True, cage_extrusion=extrusion, max_ray_distance=distance,
              margin=marge, margin_type='EXTEND', use_clear=True)
    if type_ == 'NORMAL':
        kw['normal_space'] = normal
    try:
        bpy.ops.object.bake(**kw)
    except TypeError as e:
        print('bake kw', e)
        kw.pop('margin_type', None)
        bpy.ops.object.bake(**kw)


def lire_image(im):
    n = im.size[0] * im.size[1] * im.channels
    a = np.empty(n, np.float32)
    im.pixels.foreach_get(a)
    return a.reshape(im.size[1], im.size[0], im.channels)


def ecrire_image(im, tab):
    h, w = im.size[1], im.size[0]
    t = np.asarray(tab, np.float32)
    if t.shape[2] == 3:
        t = np.concatenate([t, np.ones((h, w, 1), np.float32)], 2)
    im.pixels.foreach_set(t.reshape(-1))
    im.update()
