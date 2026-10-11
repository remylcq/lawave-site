"""Squelette Blender, poids, matériau et export GLB."""
import bpy, os, math, json, struct
import numpy as np
import bl, squelette as SQ, formes as F


def creer_armature(nom='Armature'):
    data = bpy.data.armatures.new(nom)
    o = bpy.data.objects.new(nom, data)
    bpy.context.collection.objects.link(o)
    bl.activer(o)
    bpy.ops.object.mode_set(mode='EDIT')
    eb = {}
    for n, parent, a, b in SQ.definition():
        e = data.edit_bones.new(n)
        e.head = bl.B(np.array(a))
        e.tail = bl.B(np.array(b))
        eb[n] = e
    for n, parent, a, b in SQ.definition():
        if parent:
            eb[n].parent = eb[parent]
    bpy.ops.object.mode_set(mode='OBJECT')
    return o


def poser_poids(low, arm):
    P = bl.J(np.array([v.co[:] for v in low.data.vertices]))
    noms, W = SQ.poids(P)
    for j, n in enumerate(noms):
        vg = low.vertex_groups.new(name=n)
        idx = np.nonzero(W[:, j] > 0.002)[0]
        for k in idx:
            vg.add([int(k)], float(W[k, j]), 'REPLACE')
    low.parent = arm
    m = low.modifiers.new('Armature', 'ARMATURE')
    m.object = arm
    return noms, W


def sauver_image(tab, chemin, jpeg=False, qualite=90):
    """tab : (h, w, 3|4) flottants 0..1 DÉJÀ encodés comme on veut les voir dans le fichier."""
    h, w = tab.shape[:2]
    im = bpy.data.images.new('tmp_' + os.path.basename(chemin), w, h, alpha=tab.shape[2] == 4, float_buffer=False)
    im.colorspace_settings.name = 'Non-Color'
    t = np.asarray(tab, np.float32)
    if t.shape[2] == 3:
        t = np.concatenate([t, np.ones((h, w, 1), np.float32)], 2)
    im.pixels.foreach_set(np.clip(t, 0, 1).reshape(-1))
    im.file_format = 'JPEG' if jpeg else 'PNG'
    sc = bpy.context.scene
    sc.render.image_settings.file_format = 'JPEG' if jpeg else 'PNG'
    sc.render.image_settings.quality = qualite
    sc.render.image_settings.color_mode = 'RGBA' if tab.shape[2] == 4 and not jpeg else 'RGB'
    im.save_render(chemin, scene=sc)
    bpy.data.images.remove(im)
    return chemin


def groupe_gltf():
    if 'glTF Material Output' in bpy.data.node_groups:
        return bpy.data.node_groups['glTF Material Output']
    g = bpy.data.node_groups.new('glTF Material Output', 'ShaderNodeTree')
    try:
        g.interface.new_socket('Occlusion', in_out='INPUT', socket_type='NodeSocketFloat')
    except Exception:
        g.inputs.new('NodeSocketFloat', 'Occlusion')
    return g


def materiau_final(nom, f_couleur, f_normale, f_orm, f_masque):
    """Un matériau glTF : couleur, normale, occlusion/rugosité/métal (ORM), masque de matière dans l'émission."""
    m = bpy.data.materials.new(nom)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    sortie = nt.nodes.new('ShaderNodeOutputMaterial')
    b = nt.nodes.new('ShaderNodeBsdfPrincipled')
    nt.links.new(b.outputs[0], sortie.inputs[0])

    def image(chemin, srgb):
        n = nt.nodes.new('ShaderNodeTexImage')
        im = bpy.data.images.load(chemin, check_existing=False)
        im.colorspace_settings.name = 'sRGB' if srgb else 'Non-Color'
        n.image = im
        return n

    nc = image(f_couleur, True)
    nt.links.new(nc.outputs['Color'], b.inputs['Base Color'])

    nn = image(f_normale, False)
    nm = nt.nodes.new('ShaderNodeNormalMap')
    nt.links.new(nn.outputs['Color'], nm.inputs['Color'])
    nt.links.new(nm.outputs['Normal'], b.inputs['Normal'])

    no = image(f_orm, False)
    sep = nt.nodes.new('ShaderNodeSeparateColor')
    nt.links.new(no.outputs['Color'], sep.inputs['Color'])
    nt.links.new(sep.outputs['Green'], b.inputs['Roughness'])
    nt.links.new(sep.outputs['Blue'], b.inputs['Metallic'])

    g = nt.nodes.new('ShaderNodeGroup')
    g.node_tree = groupe_gltf()
    nt.links.new(sep.outputs['Red'], g.inputs['Occlusion'])

    nk = image(f_masque, False)
    nt.links.new(nk.outputs['Color'], b.inputs['Emission Color'])
    b.inputs['Emission Strength'].default_value = 1.0
    return m


def exporter(chemin, objets, **extra):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objets:
        o.select_set(True)
    props = set(bpy.ops.export_scene.gltf.get_rna_type().properties.keys())
    kw = dict(filepath=chemin, export_format='GLB', use_selection=True, export_skins=True, export_animations=False,
              export_texcoords=True, export_normals=True, export_materials='EXPORT', export_image_format='AUTO',
              export_yup=True, export_cameras=False, export_lights=False, export_apply=False,
              export_extras=False, export_morph=False)
    kw.update(extra)
    kw = {k: v for k, v in kw.items() if k in props}
    bpy.ops.export_scene.gltf(**kw)


def lire_glb(chemin):
    with open(chemin, 'rb') as f:
        magic, ver, long = struct.unpack('<III', f.read(12))
        n, t = struct.unpack('<II', f.read(8))
        return json.loads(f.read(n))
