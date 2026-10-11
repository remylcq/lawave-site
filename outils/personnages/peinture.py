"""Peinture des textures en numpy, à partir de la carte des positions (repère du jeu), des masques de
classes, de la carte d'occlusion. Tout est fonction de la position 3D : aucune couture visible."""
import math
import numpy as np
import formes as F

K = F.TETE['k']
CL = F.CL
TAU = math.pi * 2


def hexrgb(h):
    h = h.lstrip('#')
    return np.array([int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)], np.float32)


def melange(a, b, t):
    return np.asarray(a, np.float32) * (1 - t) + np.asarray(b, np.float32) * t


def sm(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def gauss(x, y, cx, cy, sx, sy):
    return np.exp(-(((x - cx) / sx) ** 2 + ((y - cy) / sy) ** 2))


class Bruit:
    """Un bruit de valeurs en 3D, trilinéaire, sur un réseau aléatoire."""

    def __init__(self, graine=1, n=64):
        rng = np.random.default_rng(graine)
        self.t = rng.random((n, n, n), dtype=np.float32)
        self.n = n

    def __call__(self, x, y, z, freq=1.0):
        n = self.n
        x, y, z = x * freq, y * freq, z * freq
        x0, y0, z0 = np.floor(x), np.floor(y), np.floor(z)
        fx, fy, fz = x - x0, y - y0, z - z0
        fx, fy, fz = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy), fz * fz * (3 - 2 * fz)
        i0, j0, k0 = (x0.astype(int) % n), (y0.astype(int) % n), (z0.astype(int) % n)
        i1, j1, k1 = (i0 + 1) % n, (j0 + 1) % n, (k0 + 1) % n
        t = self.t
        c000, c100 = t[i0, j0, k0], t[i1, j0, k0]
        c010, c110 = t[i0, j1, k0], t[i1, j1, k0]
        c001, c101 = t[i0, j0, k1], t[i1, j0, k1]
        c011, c111 = t[i0, j1, k1], t[i1, j1, k1]
        a = c000 + (c100 - c000) * fx
        b = c010 + (c110 - c010) * fx
        c = c001 + (c101 - c001) * fx
        d = c011 + (c111 - c011) * fx
        e = a + (b - a) * fy
        f = c + (d - c) * fy
        return e + (f - e) * fz


class Peintre:
    def __init__(self, P, masques, couverture, spec, ao=None):
        h, w = P.shape[:2]
        self.h, self.w = h, w
        self.P = P
        self.x, self.y, self.z = P[:, :, 0], P[:, :, 1], P[:, :, 2]
        self.M = masques                    # classe -> (h, w)
        self.cov = couverture
        self.spec = spec
        self.ao = ao if ao is not None else np.ones((h, w), np.float32)
        self.bruit = Bruit(7)
        # repère de la tête (sans l'échelle K)
        self.hx = self.x / K
        self.hy = (self.y - F.Y_TETE) / K
        self.hz = self.z / K
        self.alb = np.zeros((h, w, 3), np.float32)
        self.rug = np.full((h, w), 0.8, np.float32)
        self.met = np.zeros((h, w), np.float32)
        self.m_peau = np.zeros((h, w), np.float32)
        self.m_cheveux = np.zeros((h, w), np.float32)
        self.m_brillant = np.zeros((h, w), np.float32)

    # --------------------------------------------------------------- outils
    def m(self, nom):
        return self.M[CL[nom]]

    def ajouter(self, alpha, couleur):
        """Peint `couleur` (3,) ou (h,w,3) avec l'opacité `alpha` (h,w)."""
        a = np.clip(alpha, 0, 1)[:, :, None]
        c = np.asarray(couleur, np.float32)
        self.alb = self.alb * (1 - a) + c * a

    # --------------------------------------------------------------- bases par classe
    def base(self):
        sp = self.spec
        total = np.zeros((self.h, self.w), np.float32) + 1e-6
        acc = np.zeros((self.h, self.w, 3), np.float32)
        for nom, fn in self.couleurs().items():
            mk = self.m(nom)
            acc += mk[:, :, None] * fn
            total += mk
        self.alb = acc / total[:, :, None]
        # la rugosité par classe (le tissu est mat, le cuir brille)
        rug_classe = {'peau': 0.55, 'main': 0.55, 'cheveux': 0.46, 'sourcil': 0.5, 'torse': 0.78, 'manche': 0.88,
                      'col': 0.88, 'pantalon': 0.90, 'chaussure': 0.28, 'noeud': 0.35, 'ceinture': 0.40,
                      'bouton': 0.30, 'accessoire': 0.80, 'bonnet': 0.80}
        r = np.zeros((self.h, self.w), np.float32)
        for nom, v in rug_classe.items():
            r += self.m(nom) * v
        self.rug = r / total

    def couleurs(self):
        sp = self.spec
        peau = hexrgb(sp['peau'])
        cheveux = hexrgb(sp['cheveux'])
        chemise = hexrgb(sp['chemise'])
        veste = hexrgb(sp['veste'])
        pantalon = hexrgb(sp['pantalon'])
        out = {}
        out['peau'] = np.broadcast_to(peau, (self.h, self.w, 3)).copy()
        out['main'] = out['peau']
        out['cheveux'] = np.broadcast_to(cheveux, (self.h, self.w, 3)).copy()
        out['sourcil'] = out['cheveux']
        out['torse'] = self.couleur_torse(veste, chemise, pantalon)
        out['manche'] = np.broadcast_to(chemise, (self.h, self.w, 3)).copy()
        out['col'] = np.broadcast_to(chemise, (self.h, self.w, 3)).copy()
        out['pantalon'] = np.broadcast_to(pantalon, (self.h, self.w, 3)).copy()
        out['chaussure'] = np.broadcast_to(hexrgb(sp['chaussures']), (self.h, self.w, 3)).copy()
        out['noeud'] = np.broadcast_to(hexrgb(sp.get('noeud', '#0d0e12')), (self.h, self.w, 3)).copy()
        out['ceinture'] = np.broadcast_to(hexrgb('#16120e'), (self.h, self.w, 3)).copy()
        out['bouton'] = np.broadcast_to(hexrgb(sp.get('boutons', '#2d3038')), (self.h, self.w, 3)).copy()
        out['accessoire'] = np.broadcast_to(hexrgb(sp.get('brassard', '#7a1526')), (self.h, self.w, 3)).copy()
        out['bonnet'] = out['accessoire']
        return out

    def couleur_torse(self, veste, chemise, pantalon):
        x, y, z = self.x, self.y, self.z
        c = np.zeros((self.h, self.w, 3), np.float32)
        tenue = self.spec.get('tenue', 'gilet')
        fa = np.abs(np.arctan2(x, z))                       # 0 devant, pi derrière
        if tenue == 'gilet':
            # chemise au-dessus de 1,47 ; sous 0,95 le pantalon ; entre : le gilet, ouvert en V devant
            vest = np.where(z >= 0, (y < 1.27) | (fa < 0.857), (y < 1.41) | (fa > 2.57))
            vest = vest.astype(np.float32)
            plastron = np.where(z >= 0, (np.abs(x) < 0.088 * np.clip((y - 1.27) / 0.17, 0, 1)) & (y > 1.27) & (y < 1.52), False)
            vest = vest * (1 - plastron) * (y < 1.47)
            vest = np.maximum(vest, 0)
            vest = sm(0.0, 1.0, vest)
            c = veste * vest[:, :, None] + chemise * (1 - vest)[:, :, None]
            c = np.where((y < 0.95)[:, :, None], pantalon, c)
        else:
            c[:] = veste
        return c.astype(np.float32)
