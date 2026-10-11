"""Peinture des vêtements : gilet, chemise, pantalon, chaussures, accessoires."""
import math
import numpy as np
import formes as F
import squelette as SQ
from peinture import hexrgb, melange, sm, gauss
from visage import _courbe_cr, distance_polyligne


def trait(pt, dist, largeur, couleur, alpha, masque=None):
    a = alpha * sm(largeur, largeur * 0.35, dist)
    if masque is not None:
        a = a * masque
    pt.ajouter(a, couleur)


def repere_bras(pt, s):
    """Abscisse le long du bras (depuis l'épaule) et angle autour de lui, pour chaque texel."""
    ep, co, po, ba = SQ.points_bras(s)
    axe = (po - ep) / np.linalg.norm(po - ep)
    e1 = np.array([0, 0, 1.0])
    e2 = np.cross(axe, e1)
    q = pt.P - ep
    al = q @ axe
    qp = q - al[:, :, None] * axe
    ang = np.arctan2(qp @ e2, qp @ e1)
    # distance à l'axe, pour ne retenir que les texels du bras
    ray = np.linalg.norm(qp, axis=2)
    return al, ang, ray


def grain_tissu(pt, nom, force, freq=300):
    mk = pt.m(nom)
    n = pt.bruit(pt.x, pt.y, pt.z, freq) - 0.5
    pt.alb = pt.alb * (1 + force * n * mk)[:, :, None]


def gilet(pt, spec):
    x, y, z = pt.x, pt.y, pt.z
    veste = hexrgb(spec['veste'])
    chemise = hexrgb(spec['chemise'])
    mt = np.clip(pt.m('torse'), 0, 1)
    avant = (z > 0.0).astype(np.float32)
    grain_tissu(pt, 'torse', 0.06, 380)

    # le passepoil satiné le long du V, et des emmanchures
    clair = melange(veste, hexrgb('#ffffff'), 0.20)
    for s in (-1, 1):
        c = _courbe_cr([(0.0, 1.27), (s * 0.044, 1.355), (s * 0.088, 1.44), (s * 0.090, 1.47)], 60)
        zone = (mt > 0.3) & (z > 0.02)
        d, t = distance_polyligne(x, y, c, zone)
        trait(pt, d, 0.0030, clair, 0.55, mt * avant)
    fa = np.abs(np.arctan2(x, z))
    arc = np.abs(fa - 0.857) * 0.17
    trait(pt, arc, 0.0028, clair, 0.50, mt * ((y > 1.27) & (y < 1.47)).astype(np.float32) * avant)

    # les piqûres de pinces et les poches
    sombre = melange(veste, hexrgb('#000000'), 0.6)
    for s in (-1, 1):
        d = np.abs(x - s * 0.078)
        trait(pt, d, 0.0007, sombre, 0.45, mt * avant * ((y > 0.99) & (y < 1.27)).astype(np.float32))
        # la poche passepoilée
        yp = 1.11 + 0.0 * x
        dp = np.abs(y - (1.12 - 0.05 * s * (x - s * 0.08)))
        zone = mt * avant * ((np.abs(x - s * 0.085) < 0.032)).astype(np.float32)
        trait(pt, dp, 0.0012, sombre, 0.55, zone)
        trait(pt, np.abs(dp - 0.0028), 0.0008, clair, 0.18, zone)

    # le plastron de chemise : boutons (sur la patte)
    for yb in (1.305, 1.365, 1.425):
        d = np.hypot(x, y - yb)
        pt.ajouter(0.9 * sm(0.0034, 0.0026, d) * avant * ((y < 1.48)).astype(np.float32) * (np.abs(x) < 0.01), melange(chemise, hexrgb('#9aa0ab'), 0.5))
    trait(pt, np.abs(x), 0.0006, melange(chemise, hexrgb('#8a909b'), 0.5), 0.5, avant * ((y > 1.27) & (y < 1.47)).astype(np.float32) * (pt.m('torse') > 0.5))
    # un grain de chemise plus fin, et quelques plis cuits en teinte
    pli = pt.bruit(x * 9, y * 22, z * 9, 1.0) - 0.5
    pt.alb = pt.alb * (1 + 0.035 * pli * mt)[:, :, None]


def chemise_et_manches(pt, spec):
    chemise = hexrgb(spec['chemise'])
    for nom in ('manche', 'col'):
        grain_tissu(pt, nom, 0.035, 340)
    ombre = melange(chemise, hexrgb('#6a7080'), 0.55)
    for s in (-1, 1):
        al, ang, ray = repere_bras(pt, s)
        mm = pt.m('manche') * (ray < 0.07)
        # manchette : au bout de la manche
        for a in (0.5155, 0.5535):
            trait(pt, np.abs(al - a), 0.0008, ombre, 0.55, mm)
        # bouton de manchette
        d = np.hypot((np.abs(ang - 0.0)) * 0.034, al - 0.534)
        pt.ajouter(0.8 * sm(0.0030, 0.0022, d) * mm, melange(chemise, hexrgb('#a8aeb8'), 0.6))
        # couture sous le bras
        trait(pt, np.abs(np.abs(ang) - math.pi) * 0.04, 0.0006, ombre, 0.35, mm * ((al > 0.03) & (al < 0.5)).astype(np.float32))
        # le brassard
        ma = pt.m('accessoire') * (ray < 0.07)
        trait(pt, np.abs(al - 0.1005), 0.0009, melange(hexrgb(spec.get('brassard', '#7a1526')), hexrgb('#000000'), 0.5), 0.6, ma)
        trait(pt, np.abs(al - 0.1385), 0.0009, melange(hexrgb(spec.get('brassard', '#7a1526')), hexrgb('#000000'), 0.5), 0.6, ma)
    # le col : bord supérieur et pointes
    mc = pt.m('col')
    trait(pt, np.abs(pt.y - 1.5545), 0.0009, ombre, 0.5, mc)
    trait(pt, np.abs(pt.y - 1.4775), 0.0010, ombre, 0.35, mc)


def pantalon_et_chaussures(pt, spec):
    x, y, z = pt.x, pt.y, pt.z
    pant = hexrgb(spec['pantalon'])
    mp = pt.m('pantalon')
    grain_tissu(pt, 'pantalon', 0.07, 300)
    clair = melange(pant, hexrgb('#ffffff'), 0.16)
    sombre = melange(pant, hexrgb('#000000'), 0.5)
    for s in (-1, 1):
        xc = s * F.HUMAIN['hanche']
        avant = ((z > 0.0) & (np.abs(x - xc) < 0.07)).astype(np.float32)
        # le pli du pantalon, sur le devant de chaque jambe
        trait(pt, np.abs(x - xc), 0.0009, clair, 0.30, mp * avant * ((y > 0.11) & (y < 0.86)).astype(np.float32))
        # l'ourlet
        trait(pt, np.abs(y - 0.092), 0.0014, sombre, 0.45, mp * (np.abs(x - xc) < 0.07).astype(np.float32))
    # la ceinture et sa boucle
    mc = pt.m('ceinture')
    cuir = hexrgb('#1a140f')
    trait(pt, np.abs(y - 0.9475), 0.0011, melange(cuir, hexrgb('#ffffff'), 0.10), 0.35, mc)
    boucle = ((np.abs(x) < 0.0225) & (y > 0.9335) & (y < 0.9625) & (z > 0.04)).astype(np.float32)
    boucle = sm(0.0, 1.0, boucle) * mc
    pt.ajouter(boucle, hexrgb('#b9bac2'))
    fente = ((np.abs(x) < 0.0125) & (np.abs(y - 0.948) < 0.0048) & (z > 0.04)).astype(np.float32) * mc
    pt.ajouter(0.95 * fente, cuir)
    pt.met = np.maximum(pt.met, boucle * (1 - 0.95 * fente))
    pt.rug = np.where(boucle > 0.5, 0.26, pt.rug)
    # les souliers : bout rapporté, semelle
    ms = pt.m('chaussure')
    noir = hexrgb(spec['chaussures'])
    for s in (-1, 1):
        xc = s * F.HUMAIN['hanche']
        loc = (np.abs(x - xc) < 0.07).astype(np.float32)
        trait(pt, np.abs(z - 0.108), 0.0010, melange(noir, hexrgb('#ffffff'), 0.22), 0.45, ms * loc * (y > 0.02).astype(np.float32))
        sem = sm(0.016, 0.011, y) * ms * loc
        pt.ajouter(sem, melange(noir, hexrgb('#3a2c22'), 0.5))
        pt.rug = np.where(sem > 0.5, 0.85, pt.rug)
    # le noeud papillon : un pli au milieu des ailes
    mn = pt.m('noeud')
    trait(pt, np.abs(y - (F.Y_TAILLE + 0.515)), 0.0014, hexrgb('#34363e'), 0.32, mn * (np.abs(x) > 0.012).astype(np.float32))
    # les boutons du gilet : du métal
    mb = pt.m('bouton')
    pt.met = np.maximum(pt.met, mb)
    pt.rug = np.where(mb > 0.5, 0.30, pt.rug)
    pt.ajouter(0.45 * mb, melange(hexrgb(spec.get('boutons', '#2d3038')), hexrgb('#ffffff'), 0.25))


def tout(pt, spec):
    if spec.get('tenue') == 'gilet':
        gilet(pt, spec)
    chemise_et_manches(pt, spec)
    pantalon_et_chaussures(pt, spec)
