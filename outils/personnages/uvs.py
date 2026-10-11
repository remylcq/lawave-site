"""Dépliage maison : chaque partie du corps a sa projection (cylindre, plan) et sa place dans l'atlas.
La densité de texels est choisie partie par partie (le visage en reçoit beaucoup plus que les jambes)."""
import math
import numpy as np
import bpy
import formes as F
import squelette as SQ
import bl

TAU = math.pi * 2

# partie -> (multiplicateur de densité u, v)
DENSITE = {
    'tete': (1.0, 2.3), 'torse': (0.80, 0.80), 'bras_d': (0.85, 0.85), 'bras_g': (0.85, 0.85),
    'main_d': (1.6, 1.6), 'main_g': (1.6, 1.6), 'jambe_d': (0.60, 0.60), 'jambe_g': (0.60, 0.60),
    'pied_d': (1.1, 1.1), 'pied_g': (1.1, 1.1),
}


def partie_de_bone(nom, y):
    if y > 1.53:
        return 'tete'
    b = nom.split('_')[0]
    s = nom.split('_')[1] if '_' in nom else ''
    if b in ('bassin', 'taille'):
        return 'torse'
    if b == 'tete':
        return 'tete'
    if b in ('epaule', 'coude'):
        return 'bras_' + s
    if b == 'poignet':
        return 'main_' + s
    if b in ('hanche', 'genou'):
        return 'jambe_' + s
    if b == 'cheville':
        return 'pied_' + s
    return 'torse'


def parties_des_sommets(P):
    noms, W = SQ.poids(P)
    arg = np.argmax(W, 1)
    return [partie_de_bone(noms[a], float(P[i, 1])) for i, a in enumerate(arg)]


# les angles de la tête : une table (angle -> u) qui agrandit le visage et tasse le dos de la tête
_K_ANG = np.array([-math.pi, -1.25, -0.62, 0.62, 1.25, math.pi])
_K_U = np.array([0.0, 0.16, 0.30, 0.70, 0.84, 1.0])


def coords_locales(partie, P, normales=None):
    """Retourne (u, v) en mètres « équivalents » pour chaque point P (n,3) de la partie (repère du jeu)."""
    x, y, z = P[:, 0], P[:, 1], P[:, 2]
    if partie == 'tete':
        ang = np.arctan2(x, z + 0.003)
        u = np.interp(ang, _K_ANG, _K_U) * 0.62
        v = y - 1.50
        return u, v, 0.62, 'cyl'
    if partie == 'torse':
        ang = np.arctan2(x, z)
        return ang * 0.17 + math.pi * 0.17, y - 0.80, TAU * 0.17, 'cyl'
    if partie.startswith('bras'):
        s = -1 if partie.endswith('_d') else 1
        ep, co, po, ba = SQ.points_bras(s)
        axe = (po - ep)
        axe = axe / np.linalg.norm(axe)
        e1 = np.array([0, 0, 1.0])
        e2 = np.cross(axe, e1)
        q = P - ep
        al = q @ axe
        qp = q - al[:, None] * axe
        ang = np.arctan2(qp @ e2, qp @ e1)
        return ang * 0.046 + math.pi * 0.046, al, TAU * 0.046, 'cyl'
    if partie.startswith('jambe'):
        s = -1 if partie.endswith('_d') else 1
        xc = s * F.HUMAIN['hanche']
        ang = np.arctan2(x - xc, z)
        return ang * 0.08 + math.pi * 0.08, y, TAU * 0.08, 'cyl'
    if partie.startswith('main'):
        s = -1 if partie.endswith('_d') else 1
        ep, co, po, ba = SQ.points_bras(s)
        axe = (ba - po)
        axe = axe / np.linalg.norm(axe)
        e1 = np.array([0, 0, 1.0])
        e2 = np.cross(axe, e1)
        q = P - po
        al = q @ axe
        lat = q @ e1
        face = q @ e2
        u = lat + 0.07 + (face > 0) * 0.16
        return u, al, 0.30, 'plan'
    if partie.startswith('pied'):
        s = -1 if partie.endswith('_d') else 1
        xc = s * F.HUMAIN['hanche']
        u = z + 0.10 + ((x - xc) * s > 0) * 0.34
        return u, y, 0.62, 'plan'
    return x, y, 1.0, 'plan'


def deplier_maison(low, tex=1024, marge=10, verbose=True):
    me = low.data
    nv = len(me.vertices)
    co = np.empty(nv * 3, np.float32)
    me.vertices.foreach_get('co', co)
    P = bl.J(co.reshape(-1, 3))
    parties_v = parties_des_sommets(P)

    polys = [tuple(p.vertices) for p in me.polygons]
    loops = [tuple(p.loop_indices) for p in me.polygons]
    par_face = []
    for vs in polys:
        votes = {}
        for i in vs:
            votes[parties_v[i]] = votes.get(parties_v[i], 0) + 1
        par_face.append(max(votes, key=votes.get))

    # coordonnées locales de chaque coin de face
    uv_loc = {}                 # partie -> (indices de boucles, u, v)
    for pt in sorted(set(par_face)):
        faces = [i for i, p in enumerate(par_face) if p == pt]
        lo, vi = [], []
        for fi in faces:
            for k, v in zip(loops[fi], polys[fi]):
                lo.append(k)
                vi.append(v)
        Pv = P[np.array(vi)]
        u, v, larg, genre = coords_locales(pt, Pv)
        # les faces à cheval sur la couture d'un cylindre : on déroule du même côté
        if genre == 'cyl':
            u = u.copy()
            idx = 0
            for fi in faces:
                m = len(polys[fi])
                seg = u[idx:idx + m]
                if seg.max() - seg.min() > larg * 0.5:
                    seg[seg < larg * 0.5] += larg
                    u[idx:idx + m] = seg
                idx += m
        uv_loc[pt] = (np.array(lo), u, v, larg, genre)

    # tailles des rectangles (en mètres équivalents), puis rangement
    rects = {}
    for pt, (lo, u, v, larg, genre) in uv_loc.items():
        du, dv = DENSITE.get(pt, (1, 1))
        rects[pt] = [u.min(), u.max() - u.min(), v.min(), v.max() - v.min(), du, dv]

    def ranger(D):
        items = []
        for pt, (u0, wu, v0, hv, du, dv) in rects.items():
            w = int(math.ceil(wu * D * du)) + 2 * marge
            h = int(math.ceil(hv * D * dv)) + 2 * marge
            items.append((h, w, pt))
        items.sort(reverse=True)
        x = y = ligne = 0
        pos = {}
        for h, w, pt in items:
            if x + w > tex:
                x = 0
                y += ligne
                ligne = 0
            if y + h > tex or w > tex:
                return None
            pos[pt] = (x, y, w, h)
            x += w
            ligne = max(ligne, h)
        return pos

    lo_D, hi_D = 100.0, 3000.0
    best = None
    for _ in range(24):
        mid = 0.5 * (lo_D + hi_D)
        r = ranger(mid)
        if r is not None:
            best, lo_D = (mid, r), mid
        else:
            hi_D = mid
    D, pos = best

    layer = me.uv_layers.active or me.uv_layers.new(name='UVMap')
    arr = np.zeros((len(me.loops), 2), np.float32)
    for pt, (lo, u, v, larg, genre) in uv_loc.items():
        du, dv = DENSITE.get(pt, (1, 1))
        u0, wu, v0, hv, _, _ = rects[pt]
        x, y, w, h = pos[pt]
        arr[lo, 0] = (x + marge + (u - u0) * D * du) / tex
        arr[lo, 1] = (y + marge + (v - v0) * D * dv) / tex
    layer.data.foreach_set('uv', arr.reshape(-1))
    if verbose:
        used = sum(w * h for (x, y, w, h) in pos.values()) / float(tex * tex)
        print('  UV maison : D = %.0f px/m, atlas utilisé à %.0f %%' % (D, 100 * used))
        for pt, (x, y, w, h) in sorted(pos.items()):
            print('    %-8s %4dx%-4d en (%4d,%4d)' % (pt, w, h, x, y))
    return D, pos
