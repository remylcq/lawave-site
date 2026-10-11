"""Peinture du visage et des cheveux (fonctions de la position 3D, dans le repère de la tête)."""
import math
import numpy as np
import formes as F
from peinture import hexrgb, melange, sm, gauss


def _courbe_cr(pts, n=60):
    """Une courbe lisse passant par pts (liste de (x, y)) : renvoie (n, 2)."""
    pts = np.asarray(pts, float)
    t = np.linspace(0, 1, len(pts))
    tt = np.linspace(0, 1, n)
    x = F._cr(t, pts[:, 0], tt)
    y = F._cr(t, pts[:, 1], tt)
    return np.stack([x, y], 1)


def distance_polyligne(X, Y, courbe, masque):
    """Distance de chaque point (X, Y) à la polyligne et paramètre (0..1) du point le plus proche (là où masque)."""
    dmin = np.full(X.shape, 1e9, np.float32)
    tmin = np.zeros(X.shape, np.float32)
    idx = np.nonzero(masque)
    Xs, Ys = X[idx], Y[idx]
    dm = np.full(Xs.shape, 1e9, np.float32)
    tm = np.zeros(Xs.shape, np.float32)
    n = len(courbe)
    for i in range(n - 1):
        ax, ay = courbe[i]
        bx, by = courbe[i + 1]
        dx, dy = bx - ax, by - ay
        L2 = dx * dx + dy * dy + 1e-12
        t = np.clip(((Xs - ax) * dx + (Ys - ay) * dy) / L2, 0, 1)
        d = np.hypot(Xs - (ax + t * dx), Ys - (ay + t * dy))
        mieux = d < dm
        dm = np.where(mieux, d, dm)
        tm = np.where(mieux, (i + t) / (n - 1), tm)
    dmin[idx] = dm
    tmin[idx] = tm
    return dmin, tmin


def teint(pt, spec):
    """Les variations de la peau : joues, bout du nez, front, dessous des yeux, cou, oreilles."""
    hx, hy, hz = pt.hx, pt.hy, pt.hz
    peau = hexrgb(spec['peau'])
    mp = np.clip(pt.m('peau') + pt.m('main'), 0, 1)
    face = ((hz > -0.01) & (np.abs(hx) < 0.10) & (hy > -0.12) & (hy < 0.13) & (pt.y > 1.50)).astype(np.float32)
    rose = melange(peau, hexrgb('#e0605a'), 0.55)
    sombre = melange(peau, hexrgb('#5a2a22'), 0.55)
    clair = melange(peau, hexrgb('#ffffff'), 0.5)
    for s in (-1, 1):
        pt.ajouter(0.30 * gauss(hx, hy, s * 0.052, -0.012, 0.021, 0.016) * face * mp, rose)
        pt.ajouter(0.16 * gauss(hx, hy, s * 0.033, 0.0015, 0.016, 0.0055) * face * mp, sombre)
        pt.ajouter(0.12 * gauss(hx, hy, s * 0.026, 0.031, 0.014, 0.006) * face * mp, sombre)
        pt.ajouter(0.10 * gauss(hx, hy, s * 0.020, -0.036, 0.003, 0.012) * face * mp, sombre)
    pt.ajouter(0.30 * gauss(hx, hy, 0, -0.0175, 0.008, 0.007) * face * mp, rose)
    pt.ajouter(0.22 * gauss(hx, hy, 0, 0.066, 0.040, 0.020) * face * mp, clair)
    pt.ajouter(0.10 * gauss(hx, hy, 0, -0.0715, 0.010, 0.0035) * face * mp, sombre)
    n1 = pt.bruit(pt.x, pt.y, pt.z, 22) - 0.5
    n2 = pt.bruit(pt.x, pt.y, pt.z, 320) - 0.5
    pt.alb = pt.alb * (1 + (0.07 * n1 + 0.025 * n2) * mp)[:, :, None]
    cou = np.clip(sm(1.575, 1.50, pt.y) * (pt.y < 1.58), 0, 1) * mp
    pt.alb = pt.alb * (1 - 0.18 * cou)[:, :, None]
    for s in (-1, 1):
        oreille = gauss(hx, hy, s * 0.0795, -0.005, 0.010, 0.016) * (np.abs(hx) > 0.068) * mp
        pt.ajouter(0.45 * oreille, melange(peau, hexrgb('#b8605a'), 0.6))
    return face


def barbe(pt, spec, face):
    if not spec.get('barbe'):
        return
    hx, hy, hz = pt.hx, pt.hy, pt.hz
    mp = np.clip(pt.m('peau'), 0, 1)
    cheveux = hexrgb(spec['cheveux'])
    bas = sm(-0.006, -0.040, hy) * (hz > -0.015) * (np.abs(hx) < 0.072) * (hy > -0.115)
    bouche = gauss(hx, hy, 0, -0.052, 0.024, 0.0105)
    levre_haut = gauss(hx, hy, 0, -0.037, 0.016, 0.006)
    nez = gauss(hx, hy, 0, -0.012, 0.016, 0.014)
    zone = np.clip(bas * (1 - 0.85 * bouche) * (1 - 0.8 * nez) + 0.7 * levre_haut, 0, 1) * mp * face
    grain = (pt.bruit(pt.x, pt.y, pt.z, 520) > 0.50).astype(np.float32)
    gros = pt.bruit(pt.x, pt.y, pt.z, 90)
    pt.ajouter(zone * (0.20 + 0.45 * grain) * (0.7 + 0.3 * gros), melange(cheveux, hexrgb('#000000'), 0.2))


def oeil(pt, spec, s):
    hx, hy = pt.hx, pt.hy
    peau = hexrgb(spec['peau'])
    cx, cy = s * 0.033, 0.016
    u, v = hx - cx, hy - cy
    o = float(s)
    v2 = v - 0.20 * o * u
    rx = 0.0172
    ry = np.where(v2 > 0, 0.0126, 0.0096)
    de = np.sqrt((u / rx) ** 2 + (v2 / ry) ** 2)
    mp = np.clip(pt.m('peau'), 0, 1) * (pt.hz > 0.0)
    dedans = sm(1.03, 0.95, de) * mp
    blanc = np.array([0.94, 0.925, 0.89], np.float32)
    ombre = 1 - 0.30 * sm(0.45, 1.0, de) - 0.20 * sm(0.0, 1.0, np.clip(v2 / 0.0126, 0, 1))
    pt.ajouter(dedans, blanc[None, None, :] * ombre[:, :, None])
    ri = 0.0090
    icx, icy = cx - o * 0.0003, cy - 0.0004
    dr = np.hypot(hx - icx, hy - icy) / ri
    iris = sm(1.03, 0.97, dr) * dedans
    base = hexrgb(spec['yeux'])
    ang = np.arctan2(hy - icy, hx - icx)
    stries = 0.5 + 0.5 * np.sin(ang * 22 + pt.bruit(hx * 400, hy * 400, ang * 3, 1.0) * 5)
    teinte = base[None, None, :] * (0.55 + 0.75 * (1 - np.clip(dr, 0, 1)) ** 0.7)[:, :, None]
    teinte = teinte * (0.88 + 0.24 * stries)[:, :, None]
    teinte = teinte * (1 - 0.55 * sm(0.74, 1.0, dr))[:, :, None]
    clair = melange(base, hexrgb('#e8c890'), 0.5)
    teinte = teinte + clair[None, None, :] * (0.18 * sm(0.55, 0.40, dr) * sm(0.22, 0.34, dr))[:, :, None]
    pt.ajouter(iris, teinte)
    pt.ajouter(sm(0.40, 0.34, dr) * dedans, hexrgb('#060505'))
    for (dx, dy, r, a) in ((-0.0030, 0.0032, 0.0023, 0.95), (0.0033, -0.0031, 0.0011, 0.55)):
        d = np.hypot(hx - (icx + dx), hy - (icy + dy)) / r
        pt.ajouter(sm(1.0, 0.7, d) * a * dedans, hexrgb('#ffffff'))
    d_m = np.abs(de - 1.0) * 0.0125
    ep = 0.0013 + 0.0012 * sm(-0.5, 1.0, o * u / 0.017)
    haut = sm(-0.002, 0.003, v2)
    cils = melange(hexrgb(spec['cheveux']), hexrgb('#000000'), 0.65)
    pt.ajouter(sm(ep, ep * 0.35, d_m) * haut * mp * (de < 1.35), cils)
    pt.ajouter(0.32 * sm(0.0009, 0.0003, d_m) * (1 - haut) * mp, melange(peau, hexrgb('#3a1a14'), 0.6))
    pt.ajouter(0.26 * np.exp(-((de - 1.55) / 0.10) ** 2) * haut * mp, melange(peau, hexrgb('#5a2a22'), 0.65))
    pt.ajouter(0.45 * gauss(hx, hy, cx - o * 0.0168, cy - 0.001, 0.0035, 0.0025) * mp, hexrgb('#c97a72'))
    pt.m_brillant = np.maximum(pt.m_brillant, dedans)
    pt.rug = np.where(dedans > 0.5, 0.10, pt.rug)


def sourcils(pt, spec):
    hx, hy, hz = pt.hx, pt.hy, pt.hz
    femme = bool(spec.get('femme'))
    couleur = melange(hexrgb(spec['cheveux']), hexrgb('#000000'), 0.15)
    zone = ((hz > 0) & (np.abs(hx) < 0.075) & (hy > 0.038) & (hy < 0.072) & (pt.y > 1.50) & (np.clip(pt.m('peau'), 0, 1) > 0.3))
    for s in (-1, 1):
        pts = [(s * 0.0100, 0.0505), (s * 0.0240, 0.0545), (s * 0.0405, 0.0552), (s * 0.0575, 0.0478)]
        c = _courbe_cr(pts, 50)
        d, t = distance_polyligne(hx, hy, c, zone)
        w = (0.0040 * (1 - t) ** 0.8 + 0.0017) * (0.72 if femme else 1.0)
        a = sm(w, w * 0.30, d)
        poils = 0.80 + 0.20 * np.sin(t * 90 + pt.bruit(hx * 300, hy * 300, 0.3, 1.0) * 4)
        a = a * poils * (0.80 + 0.2 * pt.bruit(hx, hy, 0.5, 1500)) * zone
        pt.ajouter(a * 0.92, couleur)


def nez_et_bouche(pt, spec):
    hx, hy, hz = pt.hx, pt.hy, pt.hz
    peau = hexrgb(spec['peau'])
    mp = np.clip(pt.m('peau'), 0, 1) * (hz > 0)
    sombre = hexrgb('#2a1410')
    for s in (-1, 1):
        pt.ajouter(0.80 * gauss(hx, hy, s * 0.0042, -0.0252, 0.0027, 0.0015) * mp, sombre)
        pt.ajouter(0.22 * gauss(hx, hy, s * 0.0098, -0.0212, 0.0016, 0.0040) * mp, melange(peau, sombre, 0.7))
        pt.ajouter(0.08 * gauss(hx, hy, s * 0.0085, -0.006, 0.0025, 0.010) * mp, melange(peau, sombre, 0.6))
    sourire = spec.get('sourire', 0.85)
    yb = -0.0522
    ligne = yb + sourire * 0.0036 * (np.abs(hx) / 0.0185) ** 2
    L = hexrgb('#b23a4a') if spec.get('femme') else melange(peau, hexrgb('#9a3a34'), 0.58)
    dedans_x = np.clip(1 - (hx / 0.0190) ** 2, 0, 1)
    hu = 0.0072 * dedans_x ** 0.55 - 0.0009 * np.exp(-(hx / 0.0022) ** 2)
    hl = 0.0098 * np.clip(1 - (hx / 0.0182) ** 2, 0, 1) ** 0.65
    dy = hy - ligne
    levre_h = sm(-0.0003, 0.0003, dy) * sm(hu, hu - 0.0005, dy) * (dedans_x > 0)
    levre_b = sm(-0.0003, 0.0003, -dy) * sm(hl, hl - 0.0005, -dy) * (dedans_x > 0)
    pt.ajouter((levre_h + levre_b) * mp * 0.95, L)
    pt.ajouter(0.12 * gauss(hx, hy, 0, yb - 0.0050, 0.006, 0.002) * mp, melange(L, hexrgb('#ffffff'), 0.6))
    trait = sm(0.0009, 0.0003, np.abs(dy)) * (np.abs(hx) < 0.0188)
    pt.ajouter(0.85 * trait * mp, melange(L, hexrgb('#1a0a08'), 0.65))
    for s in (-1, 1):
        y = yb + sourire * 0.0036 * (0.0192 / 0.0185) ** 2
        pt.ajouter(0.55 * gauss(hx, hy, s * 0.0192, y, 0.0012, 0.0012) * mp, melange(peau, hexrgb('#3a1a14'), 0.55))
    pt.rug = np.where((levre_h + levre_b) * mp > 0.5, 0.42, pt.rug)


def cheveux(pt, spec):
    hx, hy, hz = pt.hx, pt.hy, pt.hz
    mk = np.clip(pt.m('cheveux'), 0, 1)
    base = hexrgb(spec['cheveux'])
    ang = np.arctan2(hx, hz + 0.01)
    st = 0.5 + 0.5 * np.sin(ang * 70 + hy * 45 + 2.0 * np.sin(hx * 110) + pt.bruit(hx * 60, hy * 60, hz * 60, 1.0) * 3)
    fin = pt.bruit(hx, hy, hz, 700)
    clair = melange(base, hexrgb('#ffffff'), 0.16)
    c = base[None, None, :] * (0.60 + 0.55 * st)[:, :, None] * (0.88 + 0.28 * fin)[:, :, None]
    c = c + clair[None, None, :] * (0.20 * sm(0.07, 0.15, hy) * st)[:, :, None]
    c = c * (1 - 0.25 * sm(0.0, -0.08, hy))[:, :, None]
    pt.ajouter(mk, c)
    pt.rug = np.where(mk > 0.5, 0.46, pt.rug)
    pt.m_cheveux = np.maximum(pt.m_cheveux, mk)


def tout(pt, spec):
    face = teint(pt, spec)
    barbe(pt, spec, face)
    for s in (-1, 1):
        oeil(pt, spec, s)
    sourcils(pt, spec)
    nez_et_bouche(pt, spec)
    cheveux(pt, spec)
