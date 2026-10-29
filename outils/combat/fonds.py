"""Les fonds pixel-art des combats de Wave Cards : cinq salles de concert et deux plateformes.

    python outils/combat/fonds.py

Écrit img/combat/<décor>.png (480 × 200, affiché agrandi sans lissage) et img/combat/plateforme-*.png.
Tout est dessiné pixel par pixel (aucune image externe) : palette limitée, dégradés tramés, lumières en demi-teintes.
Les décors portent les identifiants de la console (concert, studio, plateau, ruelle, toit).
"""
import math
import os
import random
import sys

from PIL import Image, ImageDraw

W, H = 480, 200
SORTIE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'img', 'combat')
BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]


def hexa(c):
    c = c.lstrip('#')
    return tuple(int(c[i:i + 2], 16) for i in (0, 2, 4))


def mix(a, b, t):
    t = max(0.0, min(1.0, t))
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


class Toile:
    def __init__(self, graine=1):
        self.im = Image.new('RGB', (W, H), (0, 0, 0))
        self.px = self.im.load()
        self.d = ImageDraw.Draw(self.im)
        self.rnd = random.Random(graine)

    # ---- les bases
    def pt(self, x, y, c):
        if 0 <= x < W and 0 <= y < H:
            self.px[x, y] = hexa(c) if isinstance(c, str) else c

    def rect(self, x0, y0, x1, y1, c):
        """Rectangle plein, fin exclue."""
        if x1 <= x0 or y1 <= y0:
            return
        self.d.rectangle([x0, y0, x1 - 1, y1 - 1], fill=hexa(c) if isinstance(c, str) else c)

    def poly(self, pts, c):
        self.d.polygon(pts, fill=hexa(c) if isinstance(c, str) else c)

    def disque(self, cx, cy, r, c):
        for y in range(int(cy - r), int(cy + r) + 1):
            for x in range(int(cx - r), int(cx + r) + 1):
                if (x - cx) ** 2 + (y - cy) ** 2 <= r * r:
                    self.pt(x, y, c)

    def ellipse(self, cx, cy, rx, ry, c, trame=None):
        """Ellipse pleine ; `trame` = opacité (0-1) rendue en demi-teintes."""
        for y in range(int(cy - ry), int(cy + ry) + 1):
            for x in range(int(cx - rx), int(cx + rx) + 1):
                if ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1:
                    if trame is None or trame > (BAYER[y % 4][x % 4] + .5) / 16:
                        self.pt(x, y, c)

    # ---- les dégradés tramés (le dégradé passe par des paliers, la trame lisse la marche)
    def degrade(self, x0, y0, x1, y1, haut, bas, paliers=7):
        h, b = hexa(haut), hexa(bas)
        for y in range(y0, y1):
            t = (y - y0) / max(1, y1 - y0 - 1)
            v = t * (paliers - 1)
            base = int(v)
            frac = v - base
            for x in range(x0, x1):
                k = base + (1 if frac > (BAYER[y % 4][x % 4] + .5) / 16 else 0)
                self.px[x, y] = mix(h, b, k / (paliers - 1))

    def voile(self, masque, c, alpha):
        """Teinte les pixels du masque vers la couleur c : alpha = chance par pixel, en trame régulière."""
        c = hexa(c) if isinstance(c, str) else c
        m = masque.load()
        for y in range(H):
            for x in range(W):
                a = m[x, y] / 255.0 * alpha
                if a > (BAYER[y % 4][x % 4] + .5) / 16:
                    self.px[x, y] = mix(self.px[x, y], c, .62)

    def faisceau(self, x, y, long, ang, ouv, c, alpha=.5):
        """Un faisceau de projecteur (cône) qui s'éteint avec la distance."""
        m = Image.new('L', (W, H), 0)
        dm = ImageDraw.Draw(m)
        pts = [(x, y)]
        for s in (-1, 1):
            pts.append((x + long * math.cos(ang + s * ouv), y + long * math.sin(ang + s * ouv)))
        dm.polygon(pts, fill=255)
        mp = m.load()
        for yy in range(H):
            for xx in range(W):
                if mp[xx, yy]:
                    dist = math.hypot(xx - x, yy - y) / long
                    mp[xx, yy] = int(255 * max(0, 1 - dist) ** .8)
        self.voile(m, c, alpha)

    def halo(self, cx, cy, r, c, alpha=.6):
        m = Image.new('L', (W, H), 0)
        mp = m.load()
        for y in range(max(0, int(cy - r)), min(H, int(cy + r) + 1)):
            for x in range(max(0, int(cx - r)), min(W, int(cx + r) + 1)):
                d = math.hypot(x - cx, y - cy) / r
                if d < 1:
                    mp[x, y] = int(255 * (1 - d) ** 1.6)
        self.voile(m, c, alpha)

    def bande(self, y0, y1, c, alpha):
        """Brume : une bande horizontale en demi-teintes."""
        m = Image.new('L', (W, H), 0)
        mp = m.load()
        for y in range(y0, y1):
            t = 1 - abs((y - (y0 + y1) / 2) / ((y1 - y0) / 2))
            for x in range(W):
                mp[x, y] = int(255 * t)
        self.voile(m, c, alpha)

    def etincelles(self, n, y0, y1, couleurs):
        for _ in range(n):
            x, y = self.rnd.randrange(W), self.rnd.randrange(y0, y1)
            c = self.rnd.choice(couleurs)
            self.pt(x, y, c)
            if self.rnd.random() < .3:
                self.pt(x + 1, y, c)

    # ---- des objets
    def projecteur(self, x, y, c, taille=3):
        self.rect(x - taille, y, x + taille + 1, y + taille + 1, '#15101f')
        self.rect(x - 1, y + taille, x + 2, y + taille + 2, c)

    def truss(self, y, x0=0, x1=W, haut=5):
        self.rect(x0, y, x1, y + 1, '#8d8aa3')
        self.rect(x0, y + haut, x1, y + haut + 1, '#6a6783')
        for x in range(x0, x1, 6):
            for k in range(haut):
                self.pt(x + k if (x // 6) % 2 == 0 else x + haut - k, y + k, '#575470')

    def enceinte(self, x, y, l, h, c1='#17131f', c2='#241d30'):
        self.rect(x, y, x + l, y + h, c1)
        self.rect(x, y, x + l, y + 1, c2)
        self.rect(x, y, x + 1, y + h, c2)
        rows = max(1, h // 14)
        for k in range(rows):
            cy = y + 7 + k * 14
            if cy + 5 <= y + h:
                self.disque(x + l // 2, cy, 5, '#0c0912')
                self.disque(x + l // 2, cy, 2, '#2d2640')

    def sauver(self, nom):
        os.makedirs(SORTIE, exist_ok=True)
        q = self.im.quantize(colors=96, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
        chemin = os.path.join(SORTIE, nom + '.png')
        q.save(chemin, optimize=True)
        print(nom, os.path.getsize(chemin) // 1024, 'Ko')


# ---------------------------------------------------------------------------------------------------------------
# Un texte en pixels (police 5 × 7) pour les néons et les enseignes
# ---------------------------------------------------------------------------------------------------------------
POLICE = {
    'L': ['X....', 'X....', 'X....', 'X....', 'X....', 'X....', 'XXXXX'],
    'I': ['XXXXX', '..X..', '..X..', '..X..', '..X..', '..X..', 'XXXXX'],
    'V': ['X...X', 'X...X', 'X...X', 'X...X', 'X...X', '.X.X.', '..X..'],
    'E': ['XXXXX', 'X....', 'X....', 'XXXX.', 'X....', 'X....', 'XXXXX'],
    'O': ['.XXX.', 'X...X', 'X...X', 'X...X', 'X...X', 'X...X', '.XXX.'],
    'N': ['X...X', 'XX..X', 'X.X.X', 'X..XX', 'X...X', 'X...X', 'X...X'],
    'A': ['.XXX.', 'X...X', 'X...X', 'XXXXX', 'X...X', 'X...X', 'X...X'],
    ' ': ['.....'] * 7,
}


def texte(t, x, y, mot, c, echelle=1, halo=None):
    """Écrit un mot en pixels ; `halo` ajoute une lueur de la même teinte autour des lettres."""
    cx = x
    cases = []
    for ch in mot:
        g = POLICE.get(ch, POLICE[' '])
        for j, ligne in enumerate(g):
            for i, v in enumerate(ligne):
                if v == 'X':
                    cases.append((cx + i * echelle, y + j * echelle))
        cx += 6 * echelle
    if halo:
        m = Image.new('L', (W, H), 0)
        mp = m.load()
        for (px, py) in cases:
            for yy in range(py - 4, py + echelle + 4):
                for xx in range(px - 4, px + echelle + 4):
                    if 0 <= xx < W and 0 <= yy < H:
                        d = max(abs(xx - px - echelle / 2), abs(yy - py - echelle / 2))
                        mp[xx, yy] = max(mp[xx, yy], int(255 * max(0, 1 - d / 6)))
        t.voile(m, halo, .7)
    for (px, py) in cases:
        t.rect(px, py, px + echelle, py + echelle, c)


# ---------------------------------------------------------------------------------------------------------------
# 1. CONCERT : l'arène vue de la scène
# ---------------------------------------------------------------------------------------------------------------
def concert():
    t = Toile(11)
    t.degrade(0, 0, W, 112, '#06030d', '#2b0f3f', 8)
    # les gradins : trois étages en arc, la foule en points
    for y0, col, lum in [(40, '#150a25', '#ffd98a'), (58, '#1c0d30', '#fff3c4'), (78, '#25123d', '#ffd98a')]:
        for x in range(W):
            yy = y0 + int(10 * ((x - W / 2) / (W / 2)) ** 2)
            t.rect(x, yy, x + 1, yy + 17, col)
        for x in range(2, W, 4):
            yy = y0 + int(10 * ((x - W / 2) / (W / 2)) ** 2)
            for r in range(2):
                t.pt(x + t.rnd.randrange(2), yy + 3 + r * 6, mix(hexa(col), hexa('#6a4d9c'), .5 + t.rnd.random() * .4))
            if t.rnd.random() < .12:
                t.pt(x, yy + 1 + t.rnd.randrange(8), lum)
    # les deux grands écrans
    for sx in (22, 378):
        t.rect(sx - 2, 18, sx + 82, 74, '#0b0715')
        t.degrade(sx, 20, sx + 80, 72, '#ff4f9e', '#3a1b9c', 6)
        t.ellipse(sx + 40, 52, 18, 18, '#ffd36b')
        t.rect(sx, 52, sx + 80, 72, '#1b0e4a')
        for i in range(0, 80, 4):
            t.rect(sx + i, 60 + (i * 7 % 6), sx + i + 2, 72, '#7a3bff')
        for y in range(20, 72, 2):
            for x in range(sx, sx + 80):
                if (x + y) % 5 == 0:
                    t.pt(x, y, '#0b0715')
    # la structure
    t.truss(6, 0, W)
    t.truss(26, 110, 370)
    for x in range(20, W, 28):
        t.projecteur(x, 12, '#fff3c4')
    for x in range(120, 370, 24):
        t.projecteur(x, 32, '#9be8ff')
    # les faisceaux, avant le sol
    cols = ['#ff3fa4', '#35e0ff', '#ffb347', '#9b6bff', '#ff3fa4', '#35e0ff', '#ffb347', '#9b6bff']
    for i, x in enumerate(range(34, W, 54)):
        ang = math.pi / 2 + (240 - x) / 520 * 1.1
        t.faisceau(x, 14, 210, ang, .10, cols[i % len(cols)], .5)
    for i, x in enumerate(range(130, 370, 48)):
        t.faisceau(x, 34, 150, math.pi / 2 + (240 - x) / 600, .07, cols[(i + 2) % len(cols)], .4)
    # la régie, au fond
    t.rect(222, 88, 258, 102, '#0f0a1a')
    t.rect(222, 88, 258, 90, '#2a1e44')
    t.rect(228, 82, 236, 88, '#0f0a1a')
    t.rect(244, 84, 252, 88, '#0f0a1a')
    t.rect(226, 92, 254, 94, '#ff9a3c')
    t.halo(240, 94, 24, '#ff9a3c', .35)
    t.bande(88, 118, '#b9a2ff', .38)
    # le plateau de la scène
    t.degrade(0, 112, W, H, '#1d1033', '#0a0612', 7)
    t.rect(0, 110, W, 113, '#ff3fa4')
    t.rect(0, 113, W, 114, '#521248')
    for y in (124, 137, 153, 175):
        t.rect(0, y, W, y + 1, '#2c1a4a')
    for dx in range(-420, 421, 60):
        x0 = 240 + dx * .35
        for y in range(114, H):
            u = (y - 114) / (H - 114)
            xx = int(240 + (x0 - 240) * (1 + u * 3.2))
            if 0 <= xx < W:
                t.pt(xx, y, '#2c1a4a')
    for x, c in ((110, '#ff3fa4'), (210, '#35e0ff'), (330, '#ffb347'), (420, '#9b6bff')):
        t.ellipse(x, 150 + (x % 30), 62, 10, c, .22)
    t.etincelles(70, 20, 110, ['#ffffff', '#ffe9a8', '#ffb3de', '#9be8ff'])
    t.sauver('concert')


# ---------------------------------------------------------------------------------------------------------------
# 2. STUDIO (le club) : briques, néon, guirlandes
# ---------------------------------------------------------------------------------------------------------------
def club():
    t = Toile(23)
    t.rect(0, 0, W, 120, '#2b1217')
    for row in range(0, 120 // 7 + 1):
        y = row * 7
        dec = 0 if row % 2 == 0 else 8
        for x in range(-dec, W, 16):
            ton = mix(hexa('#4a2020'), hexa('#6d3329'), t.rnd.random() * .8)
            t.rect(x + 1, y + 1, x + 15, y + 7, ton)
            t.rect(x + 1, y + 1, x + 15, y + 2, mix(ton, (255, 255, 255), .12))
    m = Image.new('L', (W, H), 0)
    ImageDraw.Draw(m).rectangle([0, 0, W, 120], fill=170)
    t.voile(m, '#12070a', .55)
    # des affiches
    for x, y, w, h, c in ((26, 28, 28, 38, '#e8c24a'), (62, 34, 22, 30, '#4fb4ff'), (396, 26, 30, 40, '#ff5c8a'), (432, 36, 22, 28, '#7be0a6')):
        t.rect(x - 1, y - 1, x + w + 1, y + h + 1, '#120709')
        t.rect(x, y, x + w, y + h, c)
        t.rect(x + 3, y + 4, x + w - 3, y + 9, '#1a0a0e')
        t.rect(x + 3, y + 14, x + w - 6, y + 16, '#1a0a0e')
    # l'enseigne néon
    t.rect(168, 14, 312, 62, '#120709')
    t.rect(170, 16, 310, 60, '#1b0b10')
    texte(t, 188, 24, 'LIVE', '#ffe3f1', 3, '#ff3fa4')
    texte(t, 272, 24, 'ON', '#c9f7ff', 3, '#35e0ff')
    t.rect(176, 52, 304, 54, '#ff3fa4')
    t.halo(240, 38, 90, '#ff3fa4', .28)
    # la guirlande
    for x in range(0, W):
        y = 4 + int(14 * math.sin(math.pi * ((x % 160) / 160)))
        t.pt(x, y, '#3a2a1a')
    for x in range(8, W, 16):
        y = 4 + int(14 * math.sin(math.pi * ((x % 160) / 160)))
        t.rect(x, y + 1, x + 3, y + 5, '#ffd36b')
        t.halo(x + 1, y + 3, 9, '#ffb347', .35)
    # l'estrade et les amplis
    t.rect(0, 100, W, 122, '#1a0d10')
    t.rect(0, 100, W, 102, '#3b2322')
    t.enceinte(40, 74, 40, 28)
    t.enceinte(400, 74, 40, 28)
    t.rect(90, 92, 130, 100, '#101012')
    t.rect(94, 88, 126, 92, '#2a2a30')
    t.rect(350, 92, 390, 100, '#101012')
    # le parquet
    t.degrade(0, 122, W, H, '#6d4326', '#2a170c', 5)
    for y in range(122, H, 14):
        t.rect(0, y, W, y + 1, '#2e1a0f')
    for y in range(122, H):
        for x in range(W):
            if (x + (y // 14) * 37) % 52 == 0:
                t.pt(x, y, '#2e1a0f')
    for x, c in ((150, '#ff3fa4'), (330, '#35e0ff')):
        t.ellipse(x, 150, 70, 12, c, .22)
    t.etincelles(40, 20, 120, ['#ffe9a8', '#ffffff'])
    t.sauver('studio')


# ---------------------------------------------------------------------------------------------------------------
# 3. PLATEAU : le plateau télé, mur d'écrans et sol miroir
# ---------------------------------------------------------------------------------------------------------------
def plateau():
    t = Toile(37)
    t.degrade(0, 0, W, 118, '#04102a', '#0a2c6a', 8)
    # le mur d'écrans
    t.rect(46, 20, 434, 108, '#050b1c')
    for x in range(48, 432, 16):
        t.degrade(x, 22, x + 15, 106, '#35e0ff', '#1a52d8', 6)
        t.rect(x + 15, 22, x + 16, 106, '#06122e')
    for r, c in ((46, '#9be8ff'), (34, '#ffffff'), (22, '#35e0ff')):
        for a in range(0, 360, 2):
            x = int(240 + r * 1.3 * math.cos(math.radians(a)))
            y = int(62 + r * math.sin(math.radians(a)))
            t.pt(x, y, c)
    t.ellipse(240, 62, 10, 8, '#ffffff')
    for y in range(22, 106, 4):
        t.rect(48, y, 432, y + 1, '#06122e')
    # l'enseigne ON AIR
    t.rect(396, 6, 452, 20, '#2b0510')
    t.rect(398, 8, 450, 18, '#ff2f4a')
    texte(t, 402, 9, 'ON', '#ffffff', 1)
    t.halo(424, 13, 40, '#ff2f4a', .35)
    # le bras de caméra
    t.rect(6, 12, 90, 16, '#10131c')
    t.rect(86, 12, 90, 54, '#10131c')
    t.rect(78, 50, 100, 70, '#1a1d29')
    t.rect(82, 54, 96, 66, '#0a0c12')
    t.disque(89, 60, 4, '#3fa7ff')
    # des projecteurs de plateau
    for x in range(30, W, 60):
        t.projecteur(x, 4, '#ffffff', 4)
        t.faisceau(x, 12, 190, math.pi / 2 + (240 - x) / 700, .08, '#9be8ff', .38)
    # le sol miroir
    t.rect(0, 108, W, 112, '#9be8ff')
    t.degrade(0, 112, W, H, '#0f3b9a', '#040c24', 8)
    for dx in range(-480, 481, 80):
        for y in range(114, H):
            u = (y - 114) / (H - 114)
            xx = int(240 + dx * .3 * (1 + u * 3.0))
            if 0 <= xx < W:
                t.pt(xx, y, '#1b4fc0')
    for y in (126, 142, 162, 186):
        t.rect(0, y, W, y + 1, '#1b4fc0')
    for x in (90, 240, 390):
        t.ellipse(x, 146, 70, 10, '#35e0ff', .3)
    t.etincelles(60, 10, 110, ['#ffffff', '#9be8ff'])
    t.sauver('plateau')


# ---------------------------------------------------------------------------------------------------------------
# 4. RUELLE : un concert de rue, la nuit
# ---------------------------------------------------------------------------------------------------------------
def ruelle():
    t = Toile(51)
    t.degrade(0, 0, W, 120, '#04050d', '#171335', 6)
    t.etincelles(60, 0, 44, ['#ffffff', '#c9d6ff'])
    # les immeubles de chaque côté
    for (x0, x1) in ((0, 150), (330, 480)):
        t.rect(x0, 0, x1, 124, '#1d1224')
        for row in range(0, 124 // 7 + 1):
            for x in range(x0 - (0 if row % 2 == 0 else 8), x1, 16):
                ton = mix(hexa('#241628'), hexa('#3a2030'), t.rnd.random())
                t.rect(max(x0, x + 1), row * 7 + 1, min(x1, x + 15), row * 7 + 7, ton)
    # les fenêtres
    for (x0, x1) in ((14, 130), (346, 466)):
        for y in (14, 44, 74):
            for x in range(x0, x1, 28):
                allumee = t.rnd.random() < .55
                t.rect(x, y, x + 14, y + 20, '#0b0710')
                t.rect(x + 1, y + 1, x + 13, y + 19, '#ffcf6a' if allumee else '#241a38')
                if allumee:
                    t.rect(x + 1, y + 10, x + 13, y + 11, '#b0782a')
    # l'escalier de secours
    for y in range(40, 120, 20):
        t.rect(104, y, 150, y + 2, '#0c0810')
        for x in range(104, 150, 6):
            t.rect(x, y, x + 1, y + 20, '#0c0810')
    # graffitis
    for x, y, w, h, c in ((26, 92, 40, 20, '#ff4f9e'), (70, 98, 28, 14, '#35e0ff'), (360, 92, 44, 22, '#7be0a6'), (410, 96, 30, 16, '#ffb347')):
        t.rect(x, y, x + w, y + h, c)
        t.rect(x + 3, y + 3, x + w - 3, y + h - 3, mix(hexa(c), (0, 0, 0), .55))
    # les néons
    t.rect(152, 40, 156, 100, '#ff3fa4')
    t.halo(154, 70, 40, '#ff3fa4', .5)
    t.rect(324, 30, 328, 94, '#7be0a6')
    t.halo(326, 62, 44, '#7be0a6', .5)
    t.rect(188, 28, 292, 56, '#0a0710')
    texte(t, 196, 33, 'LIVE', '#ffe9a8', 3, '#ffb347')
    t.rect(190, 52, 290, 54, '#ffb347')
    t.halo(240, 44, 70, '#ffb347', .3)
    # le câble et la lampe
    for x in range(150, 330):
        t.pt(x, 14 + int(12 * math.sin(math.pi * (x - 150) / 180)), '#1a1224')
    t.rect(238, 26, 243, 32, '#ffe9a8')
    t.faisceau(240, 32, 150, math.pi / 2, .26, '#ffe9a8', .32)
    # la rue mouillée
    t.rect(0, 120, W, 124, '#2a1c3a')
    t.degrade(0, 124, W, H, '#161025', '#07050d', 6)
    for y in (134, 150, 170):
        t.rect(0, y, W, y + 1, '#221838')
    for x, y, rx, c in ((130, 144, 46, '#ff3fa4'), (340, 150, 52, '#7be0a6'), (240, 168, 60, '#ffb347')):
        t.ellipse(x, y, rx, 7, c, .35)
    # une benne et des caisses sur les bords
    t.rect(6, 106, 52, 128, '#14301f')
    t.rect(6, 106, 52, 109, '#1f4a30')
    t.rect(420, 110, 456, 128, '#2a2036')
    t.rect(436, 100, 468, 128, '#241a30')
    t.etincelles(30, 40, 120, ['#ffe9a8', '#ffffff'])
    t.sauver('ruelle')


# ---------------------------------------------------------------------------------------------------------------
# 5. TOIT : un concert au coucher du soleil
# ---------------------------------------------------------------------------------------------------------------
def toit():
    t = Toile(73)
    t.degrade(0, 0, W, 104, '#1c1650', '#ff8a4a', 11)
    t.etincelles(36, 0, 30, ['#ffffff', '#ffd9c2'])
    # le soleil, à moitié couché
    for y in range(58, 108):
        for x in range(240 - 40, 240 + 41):
            if (x - 240) ** 2 + (y - 98) ** 2 <= 38 * 38:
                t.pt(x, y, mix(hexa('#fff0b8'), hexa('#ffb347'), (y - 58) / 50))
    t.halo(240, 98, 90, '#ffd36b', .45)
    for y in range(66, 98, 6):
        t.rect(180, y, 300, y + 1, '#ff8a4a')
    # la ville
    for x, h in [(0, 60), (28, 80), (56, 44), (84, 92), (120, 52), (150, 70), (186, 38)]:
        t.rect(x, 108 - h, x + 28, 112, '#2a1740')
    for i, (x, h) in enumerate([(300, 40), (326, 78), (352, 52), (384, 96), (414, 58), (444, 84)]):
        t.rect(x, 108 - h, x + 28 + (i % 2) * 6, 112, '#2a1740')
    for (x0, x1) in ((0, 214), (300, 480)):
        for y in range(24, 106, 6):
            for x in range(x0 + 4, x1 - 4, 8):
                if t.rnd.random() < .34:
                    t.rect(x, y, x + 2, y + 3, '#ffd36b')
    t.rect(94, 8, 96, 30, '#2a1740')
    t.rect(388, 6, 390, 22, '#2a1740')
    for x, y in ((92, 8), (386, 6)):
        t.pt(x + 1, y - 1, '#ff3f5a')
    # le château d'eau
    t.rect(20, 56, 46, 74, '#3a2152')
    t.poly([(18, 56), (48, 56), (33, 44)], '#3a2152')
    t.rect(24, 74, 26, 88, '#3a2152')
    t.rect(40, 74, 42, 88, '#3a2152')
    # le muret du toit
    t.rect(0, 108, W, 124, '#3a2252')
    t.rect(0, 108, W, 111, '#5a3478')
    for x in range(0, W, 32):
        t.rect(x, 111, x + 1, 124, '#2a1740')
    # la guirlande
    for x in range(0, W):
        t.pt(x, 18 + int(18 * math.sin(math.pi * ((x % 240) / 240))), '#3a2a1a')
    for x in range(10, W, 18):
        y = 18 + int(18 * math.sin(math.pi * ((x % 240) / 240)))
        t.rect(x, y + 1, x + 3, y + 5, '#ffe9a8')
        t.halo(x + 1, y + 3, 10, '#ffd36b', .4)
    # la terrasse
    t.degrade(0, 124, W, H, '#4a2c5e', '#1a0f2c', 7)
    for y in (138, 154, 176):
        t.rect(0, y, W, y + 1, '#3a2250')
    for dx in range(-420, 421, 70):
        for y in range(124, H):
            u = (y - 124) / (H - 124)
            xx = int(240 + dx * .3 * (1 + u * 3.0))
            if 0 <= xx < W:
                t.pt(xx, y, '#3a2250')
    t.rect(396, 128, 430, 140, '#241633')
    t.rect(52, 130, 90, 140, '#241633')
    for x, c in ((120, '#ffb347'), (360, '#ff7a9c')):
        t.ellipse(x, 154, 66, 10, c, .22)
    t.etincelles(40, 20, 110, ['#ffe9a8', '#ffffff'])
    t.sauver('toit')


# ---------------------------------------------------------------------------------------------------------------
# Les plateformes (un disque de scène en pixels : dessus clair, tranche sombre, anneau, liseré)
# ---------------------------------------------------------------------------------------------------------------
def plateforme(nom, haut, milieu, tranche, anneau, lisere):
    lw, lh = 160, 52
    im = Image.new('RGBA', (lw, lh), (0, 0, 0, 0))
    px = im.load()
    cx, cy, rx, ry, ep = lw / 2, 20, 78, 18, 12
    for y in range(lh):
        for x in range(lw):
            dx = (x + .5 - cx) / rx
            dy = (y + .5 - cy) / ry
            if dx * dx + dy * dy <= 1:
                t = (y - (cy - ry)) / (2 * ry)
                ton = mix(hexa(haut), hexa(milieu), t)
                if (x // 6 + y // 3) % 7 == 0:
                    ton = mix(ton, (0, 0, 0), .1)
                px[x, y] = ton + (255,)
            elif y >= ep and ((x + .5 - cx) / rx) ** 2 + ((y - ep + .5 - cy) / ry) ** 2 <= 1:
                px[x, y] = mix(hexa(tranche), (0, 0, 0), (y - cy) / (ry + ep) * .5) + (255,)
    # le liseré (bord du dessus) et l'anneau intérieur
    for a in range(0, 720):
        r = math.radians(a / 2)
        x = int(cx + rx * math.cos(r))
        y = int(cy + ry * math.sin(r))
        if 0 <= x < lw and 0 <= y < lh:
            px[x, y] = hexa(lisere) + (255,)
        x2 = int(cx + (rx - 12) * math.cos(r))
        y2 = int(cy + (ry - 5) * math.sin(r))
        if 0 <= x2 < lw and 0 <= y2 < lh and (a // 12) % 2 == 0:
            px[x2, y2] = hexa(anneau) + (255,)
    chemin = os.path.join(SORTIE, nom + '.png')
    os.makedirs(SORTIE, exist_ok=True)
    im.save(chemin, optimize=True)
    print(nom, os.path.getsize(chemin), 'octets')


if __name__ == '__main__':
    cibles = sys.argv[1:] or ['concert', 'club', 'plateau', 'ruelle', 'toit', 'plateformes']
    if 'concert' in cibles:
        concert()
    if 'club' in cibles:
        club()
    if 'plateau' in cibles:
        plateau()
    if 'ruelle' in cibles:
        ruelle()
    if 'toit' in cibles:
        toit()
    if 'plateformes' in cibles:
        plateforme('plateforme-allie', '#9fb6d8', '#5d7298', '#2c3a58', '#35e0ff', '#e6f1ff')
        plateforme('plateforme-ennemi', '#d8a59a', '#985d58', '#582c34', '#ff6b77', '#ffe6e0')
