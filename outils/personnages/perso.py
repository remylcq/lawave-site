"""Assemblage d'un personnage : formes -> maillage haute définition -> basse définition -> cuissons."""
import math, os, time
import numpy as np
import bpy
import formes as F
import bl
import uvs

CL = F.CL
K = F.TETE['k']


def hex_rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4))


# ------------------------------------------------------------------------------------------
# les pièces

def tete(spec):
    """Crâne, cou, oreilles, nez, lèvres, cheveux. Repère du jeu, tête centrée en (0, Y_TETE, 0)."""
    m = spec.get('menton', 1.0)
    parts = []
    cr = F.crane(spec)
    parts.append(cr)

    def sv(x, y):
        return F.surface_visage(x, y, m)

    # le nez : l'arête, le bout, les ailes
    zn = lambda y: sv(0, y)
    parts.append(F.ellipsoide(0.0034, 0.0125, 0.0040, (0, -0.0050, zn(-0.0050) + 0.0004), n=14, m=10, classe=CL['peau']))
    parts.append(F.ellipsoide(0.0080, 0.0072, 0.0085, (0, -0.0170, zn(-0.0170) + 0.0034), n=18, m=12, classe=CL['peau']))
    for s in (-1, 1):
        parts.append(F.ellipsoide(0.0046, 0.0056, 0.0050, (s * 0.0076, -0.0204, zn(-0.0204) + 0.0008), n=14, m=10, classe=CL['peau']))
        # les oreilles
        parts.append(F.ellipsoide(0.0120, 0.0215, 0.0150, (s * 0.0795, -0.006, -0.004), n=18, m=12, classe=CL['peau']))

    # les lèvres : deux lobes en haut, une lèvre pleine en bas
    yb = -0.0522
    sourire = spec.get('sourire', 0.85)
    courbe = lambda x: sourire * 0.0036 * (abs(x) / 0.0185) ** 2
    for s in (-1, 1):
        x = s * 0.0085
        parts.append(F.ellipsoide(0.0095, 0.0036, 0.0054, (x, yb + 0.0040 + courbe(x), sv(x, yb + 0.0040) + 0.0006), n=14, m=8, classe=CL['peau']))
    parts.append(F.ellipsoide(0.0170, 0.0056, 0.0062, (0, yb - 0.0058 + courbe(0.006), sv(0, yb - 0.0058) + 0.0008), n=16, m=10, classe=CL['peau']))

    for p in parts:
        p.v = p.v * K
        p.decaler(0, F.Y_TETE, 0)

    # le cou, plus large vers le bas (les trapèzes)
    cou = F.membre(0.14, [(0, 0.052), (0.5, 0.054), (1, 0.066)], n=64, classe=CL['peau']).decaler(0, F.Y_COU + 0.07, 0)
    parts.append(cou)
    parts += coiffure(spec)
    return parts


def coiffure(spec):
    c = spec.get('coiffure')
    parts = []
    if c == 'rejete':
        h = F.calotte(0.088, 0.117, 0.103, 0.300, 0.50, 0.74, dz=-0.003)
        hou = F.ellipsoide(0.068, 0.031, 0.080, (0, 0, 0), n=32, m=16, classe=CL['cheveux'])
        # relevée sur le front
        a = 0.30
        y, z = hou.v[:, 1].copy(), hou.v[:, 2].copy()
        hou.v[:, 1] = y * math.cos(a) - z * math.sin(a)
        hou.v[:, 2] = y * math.sin(a) + z * math.cos(a)
        hou.decaler(0, 0.088, 0.040)
        parts += [h, hou]
        for s in (-1, 1):
            parts.append(F.ellipsoide(0.0068, 0.030, 0.019, (s * 0.0770, -0.002, 0.010), n=12, m=8, classe=CL['cheveux']))
    elif c == 'court':
        h = F.calotte(0.087, 0.114, 0.100, 0.335, 0.52, 0.68, dz=-0.002)
        parts.append(h)
        tp = F.ellipsoide(0.066, 0.020, 0.080, (0, 0, 0), n=24, m=12, classe=CL['cheveux'])
        a = -0.18
        y, z = tp.v[:, 1].copy(), tp.v[:, 2].copy()
        tp.v[:, 1] = y * math.cos(a) - z * math.sin(a)
        tp.v[:, 2] = y * math.sin(a) + z * math.cos(a)
        tp.decaler(0, 0.100, 0.008)
        parts.append(tp)
        for s in (-1, 1):
            parts.append(F.ellipsoide(0.0064, 0.026, 0.017, (s * 0.0770, 0.0, 0.010), n=12, m=8, classe=CL['cheveux']))
    for p in parts:
        p.v = p.v * K
        p.decaler(0, F.Y_TETE, 0)
    return parts


def tronc(spec):
    parts = []
    t = F.torse(spec)
    parts.append(t)
    # le col de chemise
    col = F.lofter([(F.Y_TAILLE + 0.505, 0.074, 0.070), (F.Y_TAILLE + 0.545, 0.068, 0.064), (F.Y_TAILLE + 0.585, 0.062, 0.058)],
                   n=72, pas=0.004, classe=CL['col'])
    parts.append(col)
    # la ceinture
    C = F.anneaux_torse(spec)
    ys = [F.Y_TAILLE - 0.036, F.Y_TAILLE - 0.010]
    sec = [(y, F._cr([c[0] for c in C], [c[1] for c in C], np.array([y]))[0] * 1.012,
            F._cr([c[0] for c in C], [c[2] for c in C], np.array([y]))[0] * 1.012) for y in ys]
    parts.append(F.lofter(sec, n=120, pas=0.004, classe=CL['ceinture']))
    # le nœud papillon
    z = 0.078
    yn = F.Y_TAILLE + 0.515
    parts.append(F.ellipsoide(0.0135, 0.0150, 0.0130, (0, yn, z), n=14, m=10, classe=CL['noeud']))
    for s in (-1, 1):
        e = F.ellipsoide(0.034, 0.0215, 0.0085, (0, 0, 0), n=16, m=10, classe=CL['noeud'])
        c, sn = math.cos(-s * 0.20), math.sin(-s * 0.20)
        x, y = e.v[:, 0].copy(), e.v[:, 1].copy()
        e.v[:, 0] = x * c - y * sn
        e.v[:, 1] = x * sn + y * c
        e.decaler(s * 0.036, yn, z - 0.003)
        parts.append(e)
    # les boutons du gilet
    for i in range(5):
        y = F.Y_TAILLE + 0.05 + i * 0.062
        rz = float(F._cr([c[0] for c in C], [c[2] for c in C], np.array([y]))[0])
        parts.append(F.ellipsoide(0.0075, 0.0075, 0.0045, (0, y, rz + 0.0010), n=10, m=6, classe=CL['bouton']))
    return parts


def membres(spec):
    parts = []
    d = dict(spec)
    d['manches'] = spec.get('manches', True)
    # jambes
    for s in (-1, 1):
        x = s * F.HUMAIN['hanche']
        parts.append(F.cuisse(d).decaler(x, F.Y_HANCHE, 0))
        parts.append(F.tibia(d).decaler(x, F.Y_GENOU, 0))
        for p in F.pied(d):
            parts.append(p.decaler(x, F.Y_CHEVILLE, 0))
    # bras, pose en A
    for s in (-1, 1):
        sx = s * F.HUMAIN['epaule']
        ha = F.bras_haut(d).decaler(sx, F.Y_EPAULE, 0)
        av = F.avant_bras(d).decaler(sx, F.Y_EPAULE - F.HUMAIN['bras'], 0)
        poignet_y = F.Y_EPAULE - F.HUMAIN['bras'] - F.HUMAIN['avantBras']
        mn = [m.decaler(sx, poignet_y, 0) for m in F.main(d, s)]
        extra = []
        # le poignet de manche
        extra.append(F.lofter([(poignet_y - 0.002, 0.0335, 0.0335), (poignet_y + 0.032, 0.0335, 0.0335)], n=60, pas=0.004,
                              classe=CL['manche']).decaler(sx, 0, 0))
        # le brassard
        if spec.get('brassard'):
            extra.append(F.lofter([(F.Y_EPAULE - 0.138, 0.047, 0.047), (F.Y_EPAULE - 0.100, 0.047, 0.047)], n=64, pas=0.004,
                                  classe=CL['accessoire']).decaler(sx, 0, 0))
        for fm in [ha, av] + mn + extra:
            fm.tourner_z(s * F.TILT, (sx, F.Y_EPAULE))
            parts.append(fm)
    return parts


def assembler(spec):
    return tronc(spec) + membres(spec) + tete(spec)


# ------------------------------------------------------------------------------------------
# des formes au maillage de basse définition

def groupes_classes():
    """Les classes sont cuites trois par trois (R, V, B)."""
    n = len(F.CLASSES)
    return [list(range(i, min(i + 3, n))) for i in range(0, n, 3)]


def classes_vers_haute(orig, haute, classes_orig):
    """Pour chaque sommet de la haute définition, la classe du point le plus proche sur la forme d'origine."""
    from mathutils.bvhtree import BVHTree
    bm = None
    dg = bpy.context.evaluated_depsgraph_get()
    arbre = BVHTree.FromObject(orig, dg)
    me = haute.data
    n = len(me.vertices)
    co = np.empty(n * 3, np.float32)
    me.vertices.foreach_get('co', co)
    co = co.reshape(-1, 3)
    # classes par sommet de l'origine
    cl = classes_orig
    polys = [tuple(p.vertices) for p in orig.data.polygons]
    vo = np.empty(len(orig.data.vertices) * 3, np.float32)
    orig.data.vertices.foreach_get('co', vo)
    vo = vo.reshape(-1, 3)
    out = np.empty(n, np.int32)
    from mathutils import Vector
    for i in range(n):
        loc, nor, idx, dist = arbre.find_nearest(Vector(co[i]))
        if idx is None:
            out[i] = 0
            continue
        vs = polys[idx]
        k = min(vs, key=lambda q: (vo[q][0] - loc[0]) ** 2 + (vo[q][1] - loc[1]) ** 2 + (vo[q][2] - loc[2]) ** 2)
        out[i] = cl[k]
    return out


def poser_masques(haute, classes_h):
    """Trois couleurs par groupe de classes, en attributs de sommet (une classe = un canal à 1)."""
    me = haute.data
    n = len(me.vertices)
    noms = []
    for g, idx in enumerate(groupes_classes()):
        a = np.zeros((n, 4), np.float32)
        a[:, 3] = 1
        for c_i, c in enumerate(idx):
            a[:, c_i] = (classes_h == c)
        at = me.color_attributes.new('m%d' % g, 'FLOAT_COLOR', 'POINT')
        at.data.foreach_set('color', a.reshape(-1))
        noms.append('m%d' % g)
    return noms


def fab_masque(nom_attr):
    def f(nt, em):
        n = nt.nodes.new('ShaderNodeVertexColor')
        n.layer_name = nom_attr
        nt.links.new(n.outputs['Color'], em.inputs['Color'])
    return f


def fab_position(nt, em):
    g = nt.nodes.new('ShaderNodeNewGeometry')
    a = nt.nodes.new('ShaderNodeVectorMath')
    a.operation = 'ADD'
    a.inputs[1].default_value = (2, 2, 2)
    mul = nt.nodes.new('ShaderNodeVectorMath')
    mul.operation = 'SCALE'
    mul.inputs['Scale'].default_value = 0.25
    nt.links.new(g.outputs['Position'], a.inputs[0])
    nt.links.new(a.outputs[0], mul.inputs[0])
    nt.links.new(mul.outputs[0], em.inputs['Color'])


def construire_bas(spec, voxel=0.003, tris=9000, tex=1024, chrono=None):
    t0 = time.time()
    parts = assembler(spec)
    v, f, c = F.fusionner(parts)
    t0 = bl.chrono('formes %d sommets' % len(v), t0)

    orig = bl.mesh_depuis(v, f, 'orig', c)
    bl.orienter(orig)
    cl_orig = np.empty(len(orig.data.vertices), np.int32)
    orig.data.attributes['classe'].data.foreach_get('value', cl_orig)

    haut = bl.dupliquer(orig, 'haut')
    bl.remesh(haut, voxel, lissage=2)
    bl.lisser_normales(haut)
    t0 = bl.chrono('haute définition ' + bl.stats(haut), t0)

    cl_h = classes_vers_haute(orig, haut, cl_orig)
    noms_m = poser_masques(haut, cl_h)
    t0 = bl.chrono('classes transférées', t0)

    bas = bl.dupliquer(haut, 'bas')
    # la basse définition n'a pas besoin des attributs de couleur
    for a in list(bas.data.color_attributes):
        bas.data.color_attributes.remove(a)
    bl.decimer(bas, tris)
    uvs.deplier_maison(bas, tex)
    t0 = bl.chrono('basse définition ' + bl.stats(bas), t0)
    return orig, haut, bas, noms_m
