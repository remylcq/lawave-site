"""Accessoires modelés par le code : casquette, lunettes, nœud papillon, gilet, brassards.

Tout est en repère Blender (x, y, z), Z en haut, le visage vers -Y. Chaque accessoire est un objet à part,
pesé sur un seul os du jeu (ou copié des poids d'un vêtement pour le gilet).
"""
import math

import bmesh
import bpy
from mathutils import Matrix, Vector

import mh


def _objet(nom, bm, couleur, os_jeu=None, rugosite=0.6, metal=0.0, double_face=False):
    me = bpy.data.meshes.new(nom)
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    o = bpy.data.objects.new(nom, me)
    bpy.context.collection.objects.link(o)
    m = bpy.data.materials.new(nom)
    m.use_nodes = True
    b = m.node_tree.nodes.get('Principled BSDF')
    b.inputs['Base Color'].default_value = (*mh.srgb_vers_lin_couleur(couleur), 1.0)
    b.inputs['Roughness'].default_value = rugosite
    b.inputs['Metallic'].default_value = metal
    m.use_backface_culling = not double_face
    o.data.materials.append(m)
    if os_jeu:
        g = o.vertex_groups.new(name=os_jeu)
        g.add(list(range(len(me.vertices))), 1.0, 'REPLACE')
    return o


def _peser(o, os_jeu):
    g = o.vertex_groups.new(name=os_jeu)
    g.add(list(range(len(o.data.vertices))), 1.0, 'REPLACE')


def _tore(bm, centre, rayon, tube, segments=28, cotes=8, echelle=(1, 1, 1), plan='y'):
    """Un anneau dans le plan x-z (axe Y), pour les verres de lunettes."""
    verts = []
    for i in range(segments):
        a = 2 * math.pi * i / segments
        ligne = []
        for j in range(cotes):
            b = 2 * math.pi * j / cotes
            r = rayon + tube * math.cos(b)
            x = r * math.cos(a) * echelle[0]
            z = r * math.sin(a) * echelle[2]
            y = tube * math.sin(b)
            ligne.append(bm.verts.new(Vector(centre) + Vector((x, y, z))))
        verts.append(ligne)
    for i in range(segments):
        for j in range(cotes):
            try:
                bm.faces.new((verts[i][j], verts[(i + 1) % segments][j], verts[(i + 1) % segments][(j + 1) % cotes], verts[i][(j + 1) % cotes]))
            except ValueError:
                pass


def _barre(bm, a, b, rayon, cotes=6):
    """Un cylindre fin entre deux points."""
    a, b = Vector(a), Vector(b)
    d = b - a
    res = bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=cotes, radius1=rayon, radius2=rayon, depth=d.length)
    rot = Vector((0, 0, 1)).rotation_difference(d.normalized()).to_matrix().to_4x4()
    bmesh.ops.transform(bm, matrix=Matrix.Translation((a + b) / 2) @ rot, verts=res['verts'])


# ------------------------------------------------------------------ casquette

def casquette(couleur, cheveux_obj, z_yeux, os_jeu='tete'):
    xs = [v.co.x for v in cheveux_obj.data.vertices]
    ys = [v.co.y for v in cheveux_obj.data.vertices]
    zs = [v.co.z for v in cheveux_obj.data.vertices]
    cx, cy = (max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2
    rx, ry = (max(xs) - min(xs)) / 2 + 0.010, (max(ys) - min(ys)) / 2 + 0.010
    haut = max(zs) + 0.014
    base = z_yeux + 0.060
    bm = bmesh.new()
    # le dôme : une demi-sphère aplatie
    res = bmesh.ops.create_uvsphere(bm, u_segments=28, v_segments=14, radius=1.0)
    bmesh.ops.transform(bm, matrix=Matrix.Translation((cx, cy, base)) @ Matrix.Diagonal((rx, ry, haut - base, 1)), verts=res['verts'])
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < base - 0.002], context='VERTS')
    # la visière : une demi-ellipse devant, un peu rabattue ; un seul polygone, vu des deux côtés
    arc = []
    n = 14
    for i in range(n + 1):
        t = math.pi * i / n                       # de la droite à la gauche en passant devant
        x = cx + math.cos(t) * rx * 0.97
        y = cy - ry * 0.35 - math.sin(t) * (ry * 1.55)
        z = base - 0.004 - 0.020 * math.sin(t) ** 2
        arc.append(bm.verts.new(Vector((x, y, z))))
    bm.faces.new(arc)
    bm.normal_update()
    return _objet('casquette', bm, couleur, os_jeu, rugosite=0.75, double_face=True)


# ------------------------------------------------------------------ lunettes

def lunettes(centre_oeil_g, centre_oeil_d, os_jeu='tete', couleur='#1c1c1e'):
    """Des lunettes rondes : deux anneaux devant les yeux, un pont, deux branches vers les oreilles."""
    bm = bmesh.new()
    y = centre_oeil_g.y - 0.036
    for c in (centre_oeil_g, centre_oeil_d):
        _tore(bm, (c.x, y, c.z), 0.0225, 0.0017, echelle=(1.18, 1, 0.92))
    xg, xd = centre_oeil_g.x, centre_oeil_d.x
    haut = centre_oeil_g.z + 0.006
    _barre(bm, (xd + 0.027, y, haut), (xg - 0.027, y, haut), 0.0016)
    for s, c in ((1, centre_oeil_g), (-1, centre_oeil_d)):
        _barre(bm, (c.x + s * 0.0265, y, c.z + 0.002), (c.x + s * 0.0265 + s * 0.012, y + 0.05, c.z + 0.004), 0.0014)
        _barre(bm, (c.x + s * 0.0385, y + 0.05, c.z + 0.004), (c.x + s * 0.0385 + s * 0.012, y + 0.14, c.z - 0.004), 0.0014)
    return _objet('lunettes', bm, couleur, os_jeu, rugosite=0.35, metal=0.4)


# ------------------------------------------------------------------ nœud papillon

def noeud_papillon(devant, couleur, os_jeu='taille'):
    """Posé sur la peau / le col, à `devant` (point Blender, le plus en avant du col)."""
    bm = bmesh.new()
    c = Vector(devant)
    # le nœud
    res = bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.transform(bm, matrix=Matrix.Translation(c + Vector((0, -0.006, 0))) @ Matrix.Diagonal((0.020, 0.016, 0.022, 1)), verts=res['verts'])
    # les deux ailes
    for s in (1, -1):
        vs = [bm.verts.new(c + Vector((s * 0.004, -0.006, 0))),
              bm.verts.new(c + Vector((s * 0.050, -0.002, 0.021))),
              bm.verts.new(c + Vector((s * 0.050, -0.002, -0.021))),
              bm.verts.new(c + Vector((s * 0.050, -0.012, 0.021))),
              bm.verts.new(c + Vector((s * 0.050, -0.012, -0.021)))]
        for f in ((0, 1, 3), (0, 3, 4), (0, 4, 2), (0, 2, 1), (1, 2, 4, 3)):
            try:
                bm.faces.new([vs[i] for i in f])
            except ValueError:
                pass
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return _objet('noeud', bm, couleur, os_jeu, rugosite=0.5, double_face=True)


# ------------------------------------------------------------------ gilet

def gilet(vetement_obj, couleur, z_bas=0.985, os_copie=True):
    """Un gilet sans manches, V devant, fait d'une copie de la chemise gonflée de 5 mm. Les poids sont ceux de la chemise."""
    me = vetement_obj.data.copy()
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.faces.ensure_lookup_table()
    # première passe, large : le torse seulement, puis on subdivise pour des bords moins en escalier
    large = [f for f in bm.faces if 0.90 < f.calc_center_median().z < 1.52 and abs(f.calc_center_median().x) < 0.24]
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f not in set(large)], context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    bmesh.ops.subdivide_edges(bm, edges=list(bm.edges), cuts=2, use_grid_fill=True)
    bm.faces.ensure_lookup_table()
    a_garder = []
    for f in bm.faces:
        c = f.calc_center_median()
        if c.z < z_bas or c.z > 1.455:
            continue
        # entre les épaules et les emmanchures
        limite = 0.178 if c.z < 1.30 else max(0.095, 0.178 - (c.z - 1.30) * 0.55)
        if abs(c.x) > limite:
            continue
        # l'échancrure en V, devant (y négatif)
        if c.y < -0.02 and c.z > 1.12 and abs(c.x) < min((c.z - 1.12) * 0.46, 0.085):
            continue
        # derrière, un peu plus haut
        if c.y > 0.0 and c.z > 1.42:
            continue
        a_garder.append(f)
    sup = [f for f in bm.faces if f not in set(a_garder)]
    bmesh.ops.delete(bm, geom=sup, context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    for v in bm.verts:
        v.co += v.normal * 0.0055
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new('gilet', me)
    bpy.context.collection.objects.link(o)
    for g in vetement_obj.vertex_groups:
        o.vertex_groups.new(name=g.name)
    # on recopie les poids sommet par sommet (même ordre pour les sommets gardés : retrouvés par position)
    return o


def copier_poids_proches(cible, source):
    """Poids de `source` repris sur `cible` : le sommet le plus proche."""
    from mathutils.kdtree import KDTree
    arbre = KDTree(len(source.data.vertices))
    for i, v in enumerate(source.data.vertices):
        arbre.insert(v.co, i)
    arbre.balance()
    noms = {g.index: g.name for g in source.vertex_groups}
    for v in cible.data.vertices:
        _, i, _ = arbre.find(v.co)
        for g in source.data.vertices[i].groups:
            cible.vertex_groups[noms[g.group]].add([v.index], g.weight, 'REPLACE')


def materiau_uni(o, couleur, rugosite=0.5, double_face=False):
    m = bpy.data.materials.new(o.name)
    m.use_nodes = True
    b = m.node_tree.nodes.get('Principled BSDF')
    b.inputs['Base Color'].default_value = (*mh.srgb_vers_lin_couleur(couleur), 1.0)
    b.inputs['Roughness'].default_value = rugosite
    m.use_backface_culling = not double_face
    o.data.materials.clear()
    o.data.materials.append(m)


# ------------------------------------------------------------------ brassards

def brassard(vetement_obj, epaule, coude, couleur, os_jeu, t=0.45, hauteur=0.042):
    """Un anneau autour du bras, à `t` du chemin épaule -> coude, juste au-dessus de la manche."""
    e, c = Vector(epaule), Vector(coude)
    axe = (c - e).normalized()
    centre = e + (c - e) * t
    rmax = 0.0
    for v in vetement_obj.data.vertices:
        d = v.co - centre
        s = d.dot(axe)
        if abs(s) < hauteur * 0.55:
            r = (d - axe * s).length
            if r < 0.068:
                rmax = max(rmax, r)
    rayon = rmax + 0.004 if rmax > 0.03 else 0.058
    bm = bmesh.new()
    res = bmesh.ops.create_cone(bm, cap_ends=False, segments=28, radius1=rayon, radius2=rayon, depth=hauteur)
    rot = Vector((0, 0, 1)).rotation_difference(axe).to_matrix().to_4x4()
    bmesh.ops.transform(bm, matrix=Matrix.Translation(centre) @ rot, verts=res['verts'])
    return _objet('brassard_' + os_jeu, bm, couleur, os_jeu, rugosite=0.65, double_face=True)
