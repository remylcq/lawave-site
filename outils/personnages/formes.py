"""
Formes du corps, en numpy pur (sans Blender) : tout est exprimé dans le repère du jeu
(x vers la gauche du personnage, y vers le haut, z vers l'avant ; origine entre les pieds).
Chaque forme est un solide fermé : (sommets, faces, classe de matière).
"""
import math
import numpy as np

TAU = math.pi * 2

# --- les mêmes mesures que le jeu (waveurs.js : HUMAIN, TETE) ---
HUMAIN = dict(cuisse=0.43, tibia=0.40, bras=0.29, avantBras=0.26, hanche=0.093, epaule=0.196,
              pivot=0.04, hEpaule=0.47, hCou=0.54, bassinDebout=0.93)
TETE = dict(k=1.15, haut=0.158)
Y_BASSIN = HUMAIN['bassinDebout']                    # 0.93
Y_TAILLE = Y_BASSIN + HUMAIN['pivot']                # 0.97
Y_EPAULE = Y_TAILLE + HUMAIN['hEpaule']              # 1.44
Y_COU = Y_TAILLE + HUMAIN['hCou']                    # 1.51
Y_TETE = Y_COU + TETE['haut']                        # 1.668
Y_HANCHE = Y_BASSIN - 0.03                           # 0.90
Y_GENOU = Y_HANCHE - HUMAIN['cuisse']                # 0.47
Y_CHEVILLE = Y_GENOU - HUMAIN['tibia']               # 0.07
TILT = 0.42                                          # les bras du modèle sont écartés (pose en A)

# classes de matière (peinture : voir peinture.py)
CLASSES = ['peau', 'cheveux', 'torse', 'manche', 'pantalon', 'chaussure', 'col', 'noeud',
           'ceinture', 'bouton', 'main', 'sourcil', 'accessoire', 'bonnet']
CL = {n: i for i, n in enumerate(CLASSES)}


def smooth(a, b, x):
    t = np.clip((np.asarray(x, float) - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def lerp(a, b, t):
    return a + (b - a) * t


class Forme:
    def __init__(self, v, f, classe, nom=''):
        self.v = np.asarray(v, float).reshape(-1, 3)
        self.f = [tuple(int(i) for i in q) for q in f]
        self.classe = classe          # entier, ou tableau d'entiers (un par sommet)
        self.nom = nom

    def classes(self):
        c = np.asarray(self.classe)
        return np.full(len(self.v), int(c), int) if c.ndim == 0 else c.astype(int)

    def transformer(self, M):
        """M : matrice 4x4 (numpy)."""
        h = np.c_[self.v, np.ones(len(self.v))] @ M.T
        self.v = h[:, :3]
        return self

    def decaler(self, dx=0, dy=0, dz=0):
        self.v = self.v + np.array([dx, dy, dz])
        return self

    def tourner_z(self, angle, pivot):
        """Rotation autour de l'axe z (le plan x-y) autour de `pivot` = (x, y)."""
        c, s = math.cos(angle), math.sin(angle)
        p = np.array([pivot[0], pivot[1]])
        d = self.v[:, :2] - p
        self.v[:, 0] = p[0] + d[:, 0] * c - d[:, 1] * s
        self.v[:, 1] = p[1] + d[:, 0] * s + d[:, 1] * c
        return self


def fusionner(formes):
    v, f, c, off = [], [], [], 0
    for fm in formes:
        v.append(fm.v)
        f += [tuple(i + off for i in q) for q in fm.f]
        c.append(fm.classes())
        off += len(fm.v)
    return np.vstack(v), f, np.concatenate(c)


# ---------------------------------------------------------------------------------------
# surfaces de révolution (des anneaux elliptiques superposés), comme `lofter` du jeu

def _cr(xs, vals, x):
    """Interpolation cubique (Catmull-Rom non uniforme) de vals(xs) en x (xs croissants)."""
    xs = np.asarray(xs, float)
    vals = np.asarray(vals, float)
    x = np.asarray(x, float)
    i = np.clip(np.searchsorted(xs, x) - 1, 0, len(xs) - 2)
    x0, x1 = xs[i], xs[i + 1]
    t = (x - x0) / np.maximum(x1 - x0, 1e-9)
    n = len(xs)
    im, ip = np.clip(i - 1, 0, n - 1), np.clip(i + 2, 0, n - 1)
    m0 = (vals[i + 1] - vals[im]) / np.maximum(xs[i + 1] - xs[im], 1e-9) * (x1 - x0)
    m1 = (vals[ip] - vals[i]) / np.maximum(xs[ip] - xs[i], 1e-9) * (x1 - x0)
    t2, t3 = t * t, t * t * t
    return ((2 * t3 - 3 * t2 + 1) * vals[i] + (t3 - 2 * t2 + t) * m0 +
            (-2 * t3 + 3 * t2) * vals[i + 1] + (t3 - t2) * m1)


def lofter(sections, n=40, pas=0.006, classe=0, axe='y'):
    """sections : liste de (y, rx, rz[, cx, cz]). Retourne une Forme fermée (deux bouchons)."""
    S = np.asarray([list(s) + [0.0] * (5 - len(s)) for s in sections], float)
    ys = S[:, 0]
    m = max(2, int(round((ys[-1] - ys[0]) / pas)) + 1)
    yy = np.linspace(ys[0], ys[-1], m)
    rx = np.maximum(_cr(ys, S[:, 1], yy), 1e-4)
    rz = np.maximum(_cr(ys, S[:, 2], yy), 1e-4)
    cx = _cr(ys, S[:, 3], yy)
    cz = _cr(ys, S[:, 4], yy)
    a = np.arange(n) / n * TAU
    X = cx[:, None] + np.sin(a)[None, :] * rx[:, None]
    Z = cz[:, None] + np.cos(a)[None, :] * rz[:, None]
    Y = np.repeat(yy[:, None], n, 1)
    v = np.stack([X, Y, Z], -1).reshape(-1, 3)
    f = []
    for i in range(m - 1):
        for j in range(n):
            a0, a1 = i * n + j, i * n + (j + 1) % n
            b0, b1 = (i + 1) * n + j, (i + 1) * n + (j + 1) % n
            f.append((a0, b0, b1, a1))
    cb = len(v)
    ch = cb + 1
    v = np.vstack([v, [cx[0], yy[0], cz[0]], [cx[-1], yy[-1], cz[-1]]])
    for j in range(n):
        j1 = (j + 1) % n
        f.append((cb, j, j1))
        f.append((ch, (m - 1) * n + j1, (m - 1) * n + j))
    return Forme(v, f, classe)


def ellipsoide(rx, ry, rz, centre=(0, 0, 0), n=24, m=14, classe=0):
    return _ellipsoide_pur(rx, ry, rz, centre, n, m, classe)


def _ellipsoide_pur(rx, ry, rz, centre, n, m, classe):
    v, f = [], []
    # pôle bas
    v.append((centre[0], centre[1] - ry, centre[2]))
    for k in range(1, m):
        ang = -math.pi / 2 + math.pi * k / m
        r = math.cos(ang)
        for j in range(n):
            a = j / n * TAU
            v.append((centre[0] + rx * r * math.sin(a), centre[1] + ry * math.sin(ang), centre[2] + rz * r * math.cos(a)))
    v.append((centre[0], centre[1] + ry, centre[2]))
    haut = len(v) - 1
    for j in range(n):
        f.append((0, 1 + (j + 1) % n, 1 + j))
    for k in range(m - 2):
        for j in range(n):
            a0, a1 = 1 + k * n + j, 1 + k * n + (j + 1) % n
            b0, b1 = 1 + (k + 1) * n + j, 1 + (k + 1) * n + (j + 1) % n
            f.append((a0, a1, b1, b0))
    for j in range(n):
        f.append((haut, 1 + (m - 2) * n + j, 1 + (m - 2) * n + (j + 1) % n))
    return Forme(v, f, classe)


def capsule(p0, p1, r0, r1, n=14, classe=0):
    """Un tube entre p0 et p1 (3D), de rayon r0 à r1, bouts arrondis."""
    p0, p1 = np.asarray(p0, float), np.asarray(p1, float)
    d = p1 - p0
    L = np.linalg.norm(d)
    d = d / L
    t = np.array([0, 0, 1.0]) if abs(d[2]) < 0.9 else np.array([1.0, 0, 0])
    u = np.cross(d, t)
    u /= np.linalg.norm(u)
    w = np.cross(d, u)
    rings = []
    for a in (-90, -60, -30):
        a = math.radians(a)
        rings.append((p0 + d * (r0 * math.sin(a)), max(r0 * math.cos(a), 1e-4)))
    N = 8
    for i in range(N + 1):
        t = i / N
        rings.append((p0 + d * (L * t), lerp(r0, r1, t)))
    for a in (30, 60, 90):
        a = math.radians(a)
        rings.append((p1 + d * (r1 * math.sin(a)), max(r1 * math.cos(a), 1e-4)))
    v, f = [], []
    for c, r in rings:
        for j in range(n):
            a = j / n * TAU
            v.append(c + r * (math.cos(a) * u + math.sin(a) * w))
    m = len(rings)
    for i in range(m - 1):
        for j in range(n):
            a0, a1 = i * n + j, i * n + (j + 1) % n
            b0, b1 = (i + 1) * n + j, (i + 1) * n + (j + 1) % n
            f.append((a0, a1, b1, b0))
    return Forme(v, f, classe)


# ---------------------------------------------------------------------------------------
# le tronc : les anneaux du jeu (geoTorse), à l'échelle réelle

def anneaux_torse(d):
    f = bool(d.get('femme'))
    k = d.get('corps', 1.0)
    v = d.get('ventre', 1.0)
    ll = 0.93 if f else 1.0
    C = [
        (-0.13, 0.150 * k, 0.105 * k),
        (-0.06, (0.182 if f else 0.170) * k, 0.115 * k),
        (0.08, (0.135 if f else 0.152) * k, 0.098 * k * v),
        (0.24, (0.150 if f else 0.175) * k, (0.108 if f else 0.112) * k * math.sqrt(v)),
        (0.38, 0.162 if f else 0.192, 0.128 if f else 0.122),
        (0.46, 0.200 * ll, 0.104),
        (0.52, 0.135 * ll, 0.082),
        (0.56, 0.064, 0.062),
    ]
    return [(Y_TAILLE + y, rx, rz) for (y, rx, rz) in C]


def torse(d, classe=None):
    sec = anneaux_torse(d)
    # un peu plus de corps aux épaules (le deltoïde s'y raccorde), pour que le manchon ne flotte pas
    fm = lofter(sec, n=140, pas=0.005, classe=CL['torse'] if classe is None else classe)
    return fm


# ---------------------------------------------------------------------------------------
# les membres : profils de rayon anatomiques

def membre(L, profil, n=28, classe=0, ellip=None, cap_haut=True):
    """Un membre vertical de y=0 (articulation) à y=-L. profil : liste de (t, rayon) avec t de 0 à 1.
    ellip : liste de (t, facteur z) pour aplatir (mollet, avant-bras)."""
    ts = np.array([p[0] for p in profil])
    rs = np.array([p[1] for p in profil])
    m = max(8, int(L / 0.006))
    tt = np.linspace(0, 1, m)
    rr = _cr(ts, rs, tt)
    ez = np.ones(m) if ellip is None else _cr([e[0] for e in ellip], [e[1] for e in ellip], tt)
    sec = []
    # bouchon haut arrondi
    if cap_haut:
        for a in (-0.0, ):
            pass
    ysec = -L * tt
    out = []
    r0, r1 = rr[0], rr[-1]
    for ang in (60, 30):                                   # arrondi du haut
        a = math.radians(ang)
        out.append((r0 * math.sin(a), r0 * math.cos(a), r0 * math.cos(a)))
    for i in range(m):
        out.append((ysec[i], rr[i], rr[i] * ez[i]))
    for ang in (30, 60):                                   # arrondi du bas
        a = math.radians(ang)
        out.append((-L - r1 * math.sin(a), r1 * math.cos(a), r1 * math.cos(a) * ez[-1]))
    out.sort(key=lambda s: s[0])
    return lofter(out, n=n, pas=0.004, classe=classe)


def bras_haut(d):
    return membre(HUMAIN['bras'], [(0, 0.046), (0.30, 0.045), (0.7, 0.040), (1.0, 0.036)], n=72,
                  classe=CL['manche'] if d.get('manches') else CL['peau'])


def avant_bras(d):
    return membre(HUMAIN['avantBras'], [(0, 0.036), (0.25, 0.037), (0.7, 0.030), (1.0, 0.026)], n=64,
                  classe=CL['manche'] if d.get('manches') else CL['peau'], ellip=[(0, 1.0), (0.4, 0.92), (1, 0.82)])


def cuisse(d):
    return membre(HUMAIN['cuisse'], [(0, 0.092), (0.30, 0.088), (0.75, 0.068), (1.0, 0.060)], n=84,
                  classe=CL['pantalon'])


def tibia(d):
    return membre(HUMAIN['tibia'], [(0, 0.060), (0.22, 0.058), (0.55, 0.045), (0.9, 0.037), (1.0, 0.040)], n=72,
                  classe=CL['pantalon'])


def pied(d):
    """Un soulier : une forme allongée, la semelle un peu plus large. Origine : la cheville."""
    sec = []
    # sections le long de z (avant) : on construit par lofter sur l'axe y puis on tourne : plus simple, deux ellipsoïdes
    corps = _ellipsoide_pur(0.046, 0.042, 0.115, (0, -0.040, 0.045), 22, 12, CL['chaussure'])
    bout = _ellipsoide_pur(0.040, 0.030, 0.060, (0, -0.052, 0.115), 18, 10, CL['chaussure'])
    semelle = _ellipsoide_pur(0.049, 0.012, 0.128, (0, -0.074, 0.050), 22, 8, CL['chaussure'])
    return [corps, bout, semelle]


# ---------------------------------------------------------------------------------------
# la main

def doigt(L, r, sens, courbe, classe=0):
    sec = [
        (0.003, r * 0.85, r * 0.85, 0.0, 0.0),
        (-L * 0.32, r, r * 1.05, sens * courbe * 0.32 ** 2, 0.0),
        (-L * 0.62, r * 0.93, r * 0.98, sens * courbe * 0.62 ** 2, 0.0),
        (-L * 0.92, r * 0.78, r * 0.82, sens * courbe * 0.92 ** 2, 0.0),
        (-L, r * 0.40, r * 0.42, sens * courbe, 0.0),
    ]
    sec.sort(key=lambda s: s[0])
    return lofter(sec, n=12, pas=0.003, classe=classe)


def main(d, cote):
    """Une main au poignet (origine), les doigts vers -y, le pouce vers l'avant (+z). cote = -1 (droite) ou +1 (gauche)."""
    dedans = -cote
    formes = [_ellipsoide_pur(0.0190, 0.052, 0.040, (0, -0.052, 0.002), 18, 12, CL['main'])]
    for z, longueur, ecart in [(0.026, 0.064, 0.05), (0.0095, 0.072, 0.01), (-0.0085, 0.066, -0.03), (-0.025, 0.052, -0.08)]:
        f = doigt(longueur, 0.0088, dedans, 0.024, CL['main'])
        f.v = f.v.copy()
        # rotation autour de x (l'écart), puis translation à la base du doigt
        c, s = math.cos(-ecart), math.sin(-ecart)
        y, zz = f.v[:, 1].copy(), f.v[:, 2].copy()
        f.v[:, 1] = y * c - zz * s
        f.v[:, 2] = y * s + zz * c
        f.decaler(0, -0.094, z)
        formes.append(f)
    p = doigt(0.056, 0.0098, dedans, 0.014, CL['main'])
    c, s = math.cos(-0.72), math.sin(-0.72)
    y, zz = p.v[:, 1].copy(), p.v[:, 2].copy()
    p.v[:, 1] = y * c - zz * s
    p.v[:, 2] = y * s + zz * c
    p.decaler(dedans * 0.006, -0.040, 0.030)
    formes.append(p)
    return formes


# ---------------------------------------------------------------------------------------
# la tête : le crâne et ses reliefs (comme geoTete du jeu, mais dense)

def relief_visage(ux, uy):
    g = lambda x, w: np.exp(-(x * x) / (w * w))
    ax = np.abs(ux)
    return (0.0048 * g(uy - 0.40, 0.15) * g(ux, 0.70)
            - 0.0034 * g(uy - 0.16, 0.14) * g(ax - 0.42, 0.20)
            + 0.0036 * g(uy + 0.06, 0.26) * g(ax - 0.64, 0.20)
            - 0.0022 * g(uy + 0.34, 0.20) * g(ax - 0.52, 0.18)
            + 0.0060 * g(uy + 0.82, 0.13) * g(ux, 0.34))


def point_crane(ux, uy, uz, marge=0.0, menton=1.0):
    bas = np.maximum(0, -uy)
    haut = np.maximum(0, uy)
    sx = (0.078 + marge) * (1 - 0.30 * bas ** 1.6 * menton)
    sy = 0.108 + marge
    sz = (0.092 + marge) * (1 - 0.10 * bas ** 1.3)
    sz = np.where(uz > 0, sz * (1 - 0.05 * haut), sz)
    return ux * sx, uy * sy, uz * sz, sx, sy, sz


def surface_visage(x, y, menton=1.0):
    uy = y / 0.108
    bas = max(0, -uy)
    haut = max(0, uy)
    sx = 0.078 * (1 - 0.30 * bas ** 1.6 * menton)
    ux = x / sx
    t = 1 - ux * ux - uy * uy
    if t <= 0:
        return 0.0
    sz = 0.092 * (1 - 0.10 * bas ** 1.3) * (1 - 0.05 * haut)
    front = math.sqrt(t)
    return front * sz + float(relief_visage(ux, uy)) * float(smooth(0.12, 0.45, front))


def crane(d, n=72, m=48, classe=None):
    """Le crâne (centré sur l'origine, avant = +z), échelle TETE['k'] appliquée plus tard."""
    menton = d.get('menton', 1.0)
    v, f = [], []
    for k in range(m + 1):
        th = math.pi * k / m                                # 0 : sommet
        for j in range(n if 0 < k < m else 1):
            ph = TAU * j / n
            uy = math.cos(th)
            ux = math.sin(th) * math.sin(ph)
            uz = math.sin(th) * math.cos(ph)
            x, y, z, sx, sy, sz = point_crane(ux, uy, uz, 0.0, menton)
            fz = float(smooth(0.12, 0.45, uz))
            z = z + fz * float(relief_visage(ux, uy))
            v.append((float(x), float(y), float(z)))
    # indices : sommet = 0 ; anneaux ; pôle bas
    def idx(k, j):
        if k == 0:
            return 0
        if k == m:
            return len(v) - 1
        return 1 + (k - 1) * n + (j % n)
    for j in range(n):
        f.append((idx(0, 0), idx(1, j + 1), idx(1, j)))
    for k in range(1, m - 1):
        for j in range(n):
            f.append((idx(k, j), idx(k, j + 1), idx(k + 1, j + 1), idx(k + 1, j)))
    for j in range(n):
        f.append((idx(m - 1, j), idx(m - 1, j + 1), idx(m, 0)))
    return Forme(v, f, CL['peau'] if classe is None else classe)


# ---------------------------------------------------------------------------------------
# cheveux, vêtements et détails (solides fermés, comme le reste)

def calotte(rx, ry, rz, front, cote, dos, dy=0.0, dz=0.0, n=64, m=36, classe=None):
    """Une calotte de cheveux : une demi-sphère dont le bord suit la ligne des cheveux
    (haut sur le front, à la hauteur des oreilles sur les côtés, descendant sur la nuque).
    Fermée par un plancher à l'intérieur de la tête."""
    v, f = [], []
    rows = []
    lim_max = 0.0
    for k in range(m + 1):
        th = math.pi * 0.98 * k / m
        row = []
        for j in range(n):
            ph = TAU * j / n
            cs = math.cos(ph)
            lim = lerp(cote, front, float(smooth(0, 1, cs))) if cs >= 0 else lerp(cote, dos, float(smooth(0, 1, -cs)))
            t2 = min(th, lim * math.pi)
            s_ = math.sin(t2)
            row.append((math.sin(ph) * s_ * rx, math.cos(t2) * ry + dy, math.cos(ph) * s_ * rz + dz))
        rows.append(row)
    # on retire les anneaux répétés (collés au bord)
    haut = [rows[0][0]]
    anneaux = []
    for r in rows[1:]:
        if anneaux and np.allclose(np.array(r), np.array(anneaux[-1]), atol=1e-7):
            continue
        anneaux.append(r)
    v = [haut[0]] + [p for r in anneaux for p in r]
    idx = lambda k, j: 1 + k * n + (j % n)
    for j in range(n):
        f.append((0, idx(0, j + 1), idx(0, j)))
    for k in range(len(anneaux) - 1):
        for j in range(n):
            f.append((idx(k, j), idx(k, j + 1), idx(k + 1, j + 1), idx(k + 1, j)))
    # plancher : un point au centre, sous le bord
    c = len(v)
    v.append((0.0, dy * 0.0 + 0.0, dz * 0.5))
    last = len(anneaux) - 1
    for j in range(n):
        f.append((c, idx(last, j), idx(last, j + 1)))
    return Forme(v, f, CL['cheveux'] if classe is None else classe)


def anneau_pointe(R, r, y, n=40, classe=0, cx=0.0, cz=0.0, rz_fact=1.0):
    """Un tore (anneau) autour de l'axe y : rayon R, section r (ceinture, col, brassard)."""
    v, f = [], []
    m = 12
    for i in range(n):
        a = i / n * TAU
        for k in range(m):
            b = k / m * TAU
            rr = R + r * math.cos(b)
            v.append((cx + rr * math.sin(a), y + r * math.sin(b), cz + rr * math.cos(a) * rz_fact))
    for i in range(n):
        for k in range(m):
            a0, a1 = i * m + k, i * m + (k + 1) % m
            b0, b1 = ((i + 1) % n) * m + k, ((i + 1) % n) * m + (k + 1) % m
            f.append((a0, b0, b1, a1))
    return Forme(v, f, classe)
