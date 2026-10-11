"""Le squelette du jeu (mêmes noms et mêmes articulations que la classe Humain de waveurs.js),
la pose en A du modèle, et le calcul des poids par capsules."""
import math
import numpy as np
import formes as F

X = F.HUMAIN


def rot_z(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, -s], [s, c]])


def points_bras(s, tilt=F.TILT):
    """Épaule, coude, poignet, bout des doigts d'un bras en pose en A. s = -1 (droite, x<0) ou +1 (gauche)."""
    R = rot_z(s * tilt)
    ep = np.array([s * X['epaule'], F.Y_EPAULE])
    co = ep + R @ np.array([0, -X['bras']])
    po = co + R @ np.array([0, -X['avantBras']])
    ba = po + R @ np.array([0, -0.18])
    f = lambda p: np.array([p[0], p[1], 0.0])
    return f(ep), f(co), f(po), f(ba)


def os_(s):
    return 'd' if s < 0 else 'g'


def definition(tilt=F.TILT):
    """Liste (nom, parent, tête, queue) en repère du jeu, pose en A."""
    L = []
    L.append(('bassin', None, (0, F.Y_BASSIN, 0), (0, F.Y_TAILLE, 0)))
    L.append(('taille', 'bassin', (0, F.Y_TAILLE, 0), (0, F.Y_COU, 0)))
    L.append(('tete', 'taille', (0, F.Y_COU, 0), (0, F.Y_COU + 0.29, 0)))
    for s in (-1, 1):
        ep, co, po, ba = points_bras(s, tilt)
        n = os_(s)
        L.append(('epaule_' + n, 'taille', tuple(ep), tuple(co)))
        L.append(('coude_' + n, 'epaule_' + n, tuple(co), tuple(po)))
        L.append(('poignet_' + n, 'coude_' + n, tuple(po), tuple(ba)))
        x = s * X['hanche']
        L.append(('hanche_' + n, 'bassin', (x, F.Y_HANCHE, 0), (x, F.Y_GENOU, 0)))
        L.append(('genou_' + n, 'hanche_' + n, (x, F.Y_GENOU, 0), (x, F.Y_CHEVILLE, 0)))
        L.append(('cheville_' + n, 'genou_' + n, (x, F.Y_CHEVILLE, 0), (x, 0.03, 0.15)))
    return L


# capsules d'influence : nom -> (A, B, rayon, sigma)
def capsules(tilt=F.TILT):
    C = {}
    for nom, parent, a, b in definition(tilt):
        C[nom] = [np.array(a, float), np.array(b, float)]
    R = {
        'bassin': (0.17, 0.045), 'taille': (0.19, 0.055), 'tete': (0.10, 0.035),
        'epaule': (0.050, 0.040), 'coude': (0.040, 0.036), 'poignet': (0.040, 0.028),
        'hanche': (0.085, 0.045), 'genou': (0.058, 0.040), 'cheville': (0.052, 0.026),
    }
    out = {}
    for nom, (a, b) in C.items():
        r, sg = R[nom.split('_')[0]]
        out[nom] = (a, b, r, sg)
    # le bassin couvre aussi le haut des hanches
    out['bassin'] = (np.array([0, F.Y_BASSIN - 0.06, 0.0]), np.array([0, F.Y_TAILLE, 0.0]), 0.17, 0.045)
    # la tête commence au cou
    out['tete'] = (np.array([0, F.Y_COU + 0.01, 0.0]), np.array([0, F.Y_COU + 0.29, 0.0]), 0.10, 0.035)
    return out


def dist_segment(P, A, B):
    AB = B - A
    t = np.clip(((P - A) @ AB) / max(AB @ AB, 1e-9), 0, 1)
    proj = A + t[:, None] * AB
    return np.linalg.norm(P - proj, axis=1)


def poids(P, tilt=F.TILT, max_infl=4):
    """P : (n,3) sommets en repère du jeu. Retourne (noms, W) avec W (n, nb) normalisé, au plus 4 non nuls par sommet."""
    C = capsules(tilt)
    noms = list(C.keys())
    W = np.zeros((len(P), len(noms)))
    for j, nom in enumerate(noms):
        a, b, r, sg = C[nom]
        d = np.maximum(0, dist_segment(P, a, b) - r)
        W[:, j] = np.exp(-(d / sg) ** 2)
    # on garde les max_infl plus forts
    idx = np.argsort(-W, 1)[:, max_infl:]
    for k in range(idx.shape[1]):
        W[np.arange(len(P)), idx[:, k]] = 0
    s = W.sum(1, keepdims=True)
    s[s < 1e-9] = 1
    return noms, W / s
