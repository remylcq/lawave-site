"""L'Olympia de Paris en pixel art, de jour, décor des combats de Wave Cards : la façade (calquée sur des photos du boulevard des Capucines),
les immeubles haussmanniens voisins, la colonne Morris, l'abribus, les platanes ; et ses textures (trottoir, asphalte).

    python outils/combat/olympia.py

Écrit img/combat/olympia.png (480 × 270, le sol est à la ligne 215), img/combat/trottoir.png et img/combat/asphalte.png.
Tout est dessiné pixel par pixel (aucune image externe) : palette limitée, dégradés tramés.
Affichés agrandis sans lissage (NearestFilter dans la scène 3D, image-rendering: pixelated en 2D).
Sous l'enseigne, la devanture de l'Olympia affiche « LA WAVE » à la place des spectacles.
"""
import os
import random

from PIL import Image, ImageDraw

W, H = 480, 270
SOL = 215
SORTIE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'img', 'combat')
BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]


def hexa(c):
    c = c.lstrip('#')
    return tuple(int(c[i:i + 2], 16) for i in (0, 2, 4))


def mix(a, b, t):
    t = max(0.0, min(1.0, t))
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


def tramer(img, x, y, a, b, t):
    if 0 <= x < img.width and 0 <= y < img.height:
        img.putpixel((x, y), b if (BAYER[y % 4][x % 4] + .5) / 16 < t else a)


def rect(d, x0, y0, x1, y1, c):
    d.rectangle([x0, y0, x1, y1], fill=c)


def px(img, x, y, c):
    if 0 <= x < img.width and 0 <= y < img.height:
        img.putpixel((x, y), c)


C = {k: hexa(v) for k, v in {
    'pierre': '#dccfb4', 'pierre_cl': '#efe6d2', 'pierre_om': '#b9ab91', 'pierre_fo': '#8f836d',
    'fer': '#23252b', 'verre': '#9cb6b0', 'verre_cl': '#c9dfd8', 'verre_fo': '#5f7a78',
    'ardoise': '#474d5b', 'ardoise2': '#5a6272', 'rouge': '#c4262e', 'rouge_cl': '#e24b4b', 'rouge_fo': '#8f1a22',
    'bois': '#bb7a2c', 'bois_fo': '#7d4d18', 'bois_cl': '#d9954a',
    'vert': '#5f8f35', 'vert_cl': '#92bd4f', 'vert_fo': '#3f6a28', 'jaune': '#c9d86a',
    'tronc': '#8a7f6e', 'tronc_cl': '#bdb59f', 'blanc': '#f3eee0',
}.items()}

POLICE = {
    'O': ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
    'L': ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
    'Y': ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
    'M': ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
    'P': ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
    'I': ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
    'A': ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
    'W': ['10001', '10001', '10001', '10101', '10101', '11011', '10001'],
    'V': ['10001', '10001', '10001', '10001', '01010', '01010', '00100'],
    'E': ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
}


def texte(d, x, y, mot, k, c, espace=2):
    for car in mot:
        if car == ' ':
            x += 3 * k + espace
            continue
        for j, ligne in enumerate(POLICE[car]):
            for i, v in enumerate(ligne):
                if v == '1':
                    d.rectangle([x + i * k, y + j * k, x + i * k + k - 1, y + j * k + k - 1], fill=c)
        x += 5 * k + espace
    return x


def largeur(mot, k, espace=2):
    return sum((3 * k + espace) if car == ' ' else (5 * k + espace) for car in mot) - espace


def fenetre(d, x, y, w=9, h=22, allumee=False):
    rect(d, x - 1, y - 1, x + w, y + h, C['pierre_om'])
    rect(d, x, y, x + w - 1, y + h - 1, C['verre'])
    rect(d, x, y, x + w - 1, y + h // 3, C['verre_cl'])
    rect(d, x + w // 2, y, x + w // 2, y + h - 1, C['pierre_om'])
    rect(d, x, y + h // 3, x + w - 1, y + h // 3, C['pierre_om'])
    rect(d, x, y + h - 3, x + w - 1, y + h - 1, C['verre_fo'])
    rect(d, x - 2, y - 2, x + w + 1, y - 2, C['pierre_cl'])


def balcon(d, x0, x1, y):
    """Un balcon filant en fer forgé."""
    rect(d, x0, y, x1, y + 1, C['fer'])
    rect(d, x0, y + 8, x1, y + 9, C['fer'])
    for x in range(x0 + 1, x1, 3):
        rect(d, x, y + 2, x, y + 7, C['fer'])
    for x in range(x0 + 6, x1, 12):
        rect(d, x, y - 1, x + 1, y + 9, C['fer'])
    for x in range(x0 + 3, x1 - 2, 6):
        rect(d, x, y + 4, x + 1, y + 5, C['pierre_om'])


def toit(d, x0, x1, haut, rnd, hauteur=22, lucarnes=True):
    """Un toit en zinc mansardé avec ses lucarnes et ses cheminées."""
    for y in range(haut, haut + hauteur):
        marge = int((haut + hauteur - y) * .45)
        rect(d, x0 + marge // 2, y, x1 - marge // 2, y, C['ardoise'] if (y // 3) % 2 == 0 else C['ardoise2'])
    if lucarnes:
        for cx in range(x0 + 14, x1 - 14, 26):
            rect(d, cx, haut + 7, cx + 10, haut + hauteur - 2, C['pierre_om'])
            rect(d, cx + 2, haut + 10, cx + 8, haut + hauteur - 3, C['verre_fo'])
            rect(d, cx - 1, haut + 4, cx + 11, haut + 6, C['ardoise2'])
    for cx in (x0 + 10, x1 - 18):
        rect(d, cx, haut - 11, cx + 5, haut + 6, C['pierre_om']); rect(d, cx - 1, haut - 13, cx + 6, haut - 11, C['pierre_fo'])
    rect(d, x0, haut + hauteur, x1, haut + hauteur + 3, C['pierre_cl'])
    rect(d, x0, haut + hauteur + 3, x1, haut + hauteur + 3, C['pierre_om'])


def immeuble(d, x0, x1, haut, etages, balcons, rnd):
    toit(d, x0, x1, haut, rnd)
    top = haut + 26
    rect(d, x0, top, x1, SOL, C['pierre'])
    for k in range(etages):
        y = top + 4 + k * 26
        for cx in range(x0 + 8, x1 - 12, 19):
            fenetre(d, cx, y)
        rect(d, x0, y + 21, x1, y + 22, C['pierre_om'])
        if k in balcons:
            balcon(d, x0, x1, y + 17)
        else:
            rect(d, x0, y + 22, x1, y + 23, C['pierre_cl'])
    # les chaînages d'angle en pierre claire et les pilastres
    for cx in range(x0 + 2, x1, 38):
        rect(d, cx, top, cx + 1, SOL, C['pierre_cl'])
        rect(d, cx + 2, top, cx + 2, SOL, C['pierre_om'])
    rect(d, x0, top, x0 + 3, SOL, C['pierre_cl']); rect(d, x1 - 3, top, x1, SOL, C['pierre_om'])


def arbre(img, d, xc, haut_couronne, rnd, rayon=24, tronc_x=None):
    """Un platane : tronc moucheté, couronne de feuilles en amas."""
    tx = tronc_x if tronc_x is not None else xc
    for y in range(haut_couronne + 20, SOL + 4):
        for x in range(tx - 3, tx + 3):
            px(img, x, y, C['tronc'] if (x + y // 3) % 3 else C['tronc_cl'])
    for _ in range(40):
        bx = xc + rnd.randint(-rayon, rayon); by = haut_couronne + rnd.randint(0, 40)
        r = rnd.randint(5, 10)
        for y in range(by - r, by + r + 1):
            for x in range(bx - r, bx + r + 1):
                dd = ((x - bx) ** 2 + (y - by) ** 2) ** .5
                if dd <= r and ((x + y) % 3 or rnd.random() > .5):
                    haut_t = (y - haut_couronne) / 46
                    pal = [C['vert_cl'], C['vert'], C['vert_fo']]
                    c = pal[min(2, max(0, int(haut_t * 2.2 + rnd.random() * .9 - .2)))]
                    if rnd.random() > .93:
                        c = C['jaune']
                    px(img, x, y, c)
    for _ in range(40):  # des trouées de ciel dans le feuillage
        px(img, xc + rnd.randint(-rayon, rayon), haut_couronne + rnd.randint(8, 38), C['verre_cl'])


def devanture_olympia(img, d):
    x0, x1 = 180, 302
    # l'immeuble de l'Olympia derrière l'enseigne : pierre, étage, toit mansardé
    toit(d, 172, 310, 48, random.Random(2), 20, lucarnes=False)
    for cx in (200, 240, 276):
        rect(d, cx, 54, cx + 10, 64, C['pierre_om']); rect(d, cx + 2, 56, cx + 8, 63, C['verre_fo'])
    rect(d, 172, 71, 310, 100, C['pierre'])
    for cx in range(182, 300, 22):
        fenetre(d, cx, 76, 9, 17)
    rect(d, 172, 71, 175, 215, C['pierre_cl']); rect(d, 307, 71, 310, 215, C['pierre_om'])
    # l'enseigne rouge en saillie : bandeau, logo hexagonal, OLYMPIA en blanc, dessous en bois sombre
    rect(d, x0, 99, x1, 125, C['rouge'])
    rect(d, x0, 99, x1, 100, C['rouge_cl']); rect(d, x0, 123, x1, 125, C['rouge_fo'])
    rect(d, x0, 99, x0 + 1, 125, C['rouge_fo']); rect(d, x1 - 1, 99, x1, 125, C['rouge_fo'])
    cx, cy = 198, 112   # le logo : un hexagone blanc ouvert
    for (ax, ay, bx, by) in [(-7, 0, -3, -7), (-3, -7, 4, -7), (4, -7, 8, 0), (8, 0, 4, 7), (4, 7, -3, 7), (-3, 7, -7, 0)]:
        n = max(abs(bx - ax), abs(by - ay))
        for i in range(n + 1):
            xx = cx + ax + (bx - ax) * i // max(n, 1); yy = cy + ay + (by - ay) * i // max(n, 1)
            px(img, xx, yy, C['blanc']); px(img, xx, yy + 1, C['blanc'])
    rect(d, cx - 1, cy - 1, cx + 2, cy + 2, C['rouge'])
    texte(d, 212, 104, 'OLYMPIA', 2, C['blanc'], 2)
    texte(d, 213, 104, 'OLYMPIA', 2, C['blanc'], 2)   # des lettres épaisses comme sur l'enseigne
    for y in range(126, 136):
        rect(d, x0 + 4, y, x1 - 4, y, mix(hexa('#6b5750'), hexa('#3c2f2c'), (y - 126) / 9))
    for x in range(x0 + 6, x1 - 4, 6):
        rect(d, x, 126, x, 135, hexa('#8a746c'))
    # la devanture-fronton : un grillage de barres blanches sur fond sombre, « LA WAVE » en lettres rouges
    fx0, fx1 = 188, 294
    rect(d, fx0 - 3, 136, fx1 + 3, 196, C['pierre_om'])
    rect(d, fx0, 138, fx1, 194, hexa('#3b2c2e'))
    for x in range(fx0, fx1 + 1, 4):
        rect(d, x, 138, x + 1, 194, C['blanc'])
    for y in (138, 156, 177, 193):
        rect(d, fx0 - 2, y, fx1 + 2, y + 1, C['blanc'])
    for (y, h) in ((141, 12), (160, 14), (180, 10)):
        rect(d, fx0 + 3, y, fx1 - 3, y + h, hexa('#3b2c2e'))
    mot = 'LA WAVE'
    k = 2
    xx = (fx0 + fx1) // 2 - largeur(mot, k, 3) // 2
    texte(d, xx + 1, 164, mot, k, C['rouge_fo'], 3)
    texte(d, xx, 163, mot, k, hexa('#e8433f'), 3)
    # le rez-de-chaussée : le rideau de fer, un petit panneau rouge
    rect(d, 186, 196, 296, SOL, hexa('#1e2024'))
    for x in range(188, 296, 3):
        rect(d, x, 198, x, SOL - 1, hexa('#34383e'))
    for y in range(199, SOL, 3):
        rect(d, 187, y, 295, y, hexa('#2a2d33'))
    rect(d, 186, 194, 296, 196, hexa('#2b2224'))
    rect(d, 290, 199, 295, 211, C['rouge_fo']); rect(d, 291, 200, 294, 203, C['rouge_cl'])
    rect(d, 176, 190, 185, SOL, hexa('#2d3034'))


def abribus(d):
    rect(d, 52, 174, 126, 178, hexa('#2f3a37'))
    rect(d, 56, 171, 122, 174, hexa('#3d4a45'))
    rect(d, 54, 178, 124, SOL, hexa('#2b3033'))
    for i, (x, c1, c2) in enumerate(((62, '#4f93d6', '#e9f2fa'), (92, '#7ab4e6', '#f1d27a'))):
        rect(d, x, 182, x + 24, 208, hexa('#1c2023'))
        rect(d, x + 1, 183, x + 23, 207, hexa(c1))
        rect(d, x + 5, 188, x + 18, 197, hexa(c2))
        rect(d, x + 7, 200, x + 16, 203, hexa('#ffffff'))
    rect(d, 120, 182, 124, SOL - 2, hexa('#1c2023'))


def colonne_morris(d):
    x0, x1 = 394, 414
    rect(d, x0 + 2, 134, x1 - 2, 138, hexa('#2c4637'))
    rect(d, x0 + 5, 130, x1 - 5, 134, hexa('#2c4637'))
    rect(d, x0 + 8, 126, x1 - 8, 130, hexa('#2c4637'))
    rect(d, x0, 138, x1, 150, hexa('#34523f'))
    rect(d, x0, 150, x1, SOL - 4, hexa('#23382c'))
    for j, (y, h, c) in enumerate(((152, 20, '#efe7d3'), (174, 16, '#d8c9a6'), (192, 16, '#e4d7b8'))):
        rect(d, x0 + 2, y, x1 - 2, y + h, hexa(c))
        rect(d, x0 + 4, y + 2, x1 - 5, y + 4 + j, hexa('#4a4a52'))
        rect(d, x0 + 4, y + 7, x1 - 8, y + 12, hexa('#a43b3b') if j != 1 else hexa('#3b6aa4'))
    rect(d, x0 + 1, SOL - 4, x1 - 1, SOL, hexa('#1a2a21'))


def porte_bois(d):
    rect(d, 344, 146, 384, SOL, C['pierre_om'])
    rect(d, 346, 148, 382, SOL, C['bois'])
    rect(d, 346, 148, 382, 152, C['bois_fo'])
    rect(d, 347, 154, 363, 165, C['verre_fo']); rect(d, 365, 154, 381, 165, C['verre_fo'])
    for (xa, xb) in ((348, 363), (365, 380)):
        for (ya, yb) in ((168, 188), (191, SOL - 3)):
            rect(d, xa, ya, xb, yb, C['bois_cl']); rect(d, xa + 1, ya + 1, xb - 1, yb - 1, C['bois'])
    rect(d, 363, 148, 364, SOL, C['bois_fo'])
    rect(d, 318, 168, 340, SOL, hexa('#2e3a3d')); rect(d, 320, 170, 338, SOL - 1, hexa('#4a5d62'))
    rect(d, 328, 170, 329, SOL - 1, hexa('#2e3a3d'))


def boutique_droite(d):
    rect(d, 428, 170, 480, SOL, hexa('#2c2a2e'))
    rect(d, 428, 172, 480, 182, hexa('#1d1d21'))
    for x in range(432, 478, 6):
        rect(d, x, 175, x + 3, 179, hexa('#d8d4c4'))
    rect(d, 430, 184, 452, SOL - 2, hexa('#8fb0b5')); rect(d, 455, 184, 478, SOL - 2, hexa('#8fb0b5'))
    for (x, c) in ((434, '#c9a07a'), (459, '#d9b08c')):
        rect(d, x, 188, x + 14, 208, hexa(c)); rect(d, x + 4, 192, x + 10, 200, hexa('#7a5236'))


def lampadaire(img, d, x):
    rect(d, x, SOL - 95, x + 1, SOL + 2, C['fer'])
    rect(d, x - 1, SOL - 4, x + 2, SOL + 2, C['fer'])
    for i in range(7):
        px(img, x + 2 + i, SOL - 99 + i // 3, C['fer'])
    rect(d, x + 7, SOL - 97, x + 15, SOL - 93, hexa('#3a3d44')); rect(d, x + 8, SOL - 93, x + 14, SOL - 92, hexa('#e8e2c8'))


def fond():
    rnd = random.Random(11)
    img = Image.new('RGB', (W, H))
    d = ImageDraw.Draw(img)
    # le ciel : bleu clair qui pâlit vers l'horizon, tramé, avec des nuages
    ciel = [hexa(c) for c in ['#86b6df', '#9bc4e6', '#b4d3ea', '#cbe1ee', '#dfecf1', '#ebf2f3']]
    for y in range(0, SOL):
        t = y / 150 * (len(ciel) - 1)
        i = min(int(t), len(ciel) - 2)
        for x in range(W):
            tramer(img, x, y, ciel[i], ciel[i + 1], min(1, t - i))
    for (cx, cy, rx, ry) in [(70, 28, 38, 8), (110, 34, 28, 6), (340, 22, 46, 9), (400, 30, 30, 6), (230, 14, 26, 5)]:
        for y in range(cy - ry, cy + ry + 1):
            for x in range(cx - rx, cx + rx + 1):
                dd = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2
                if dd <= 1 and ((x + y) % 2 == 0 or dd < .55):
                    px(img, x, y, C['blanc'] if dd < .6 else hexa('#e3edf3'))
    # les immeubles : à gauche (crème, 3 étages), au centre l'Olympia, à droite le grand immeuble à balcons
    immeuble(d, 0, 172, 66, 3, (0, 2), rnd)
    immeuble(d, 310, 480, 30, 5, (0, 3), rnd)
    devanture_olympia(img, d)
    abribus(d)
    porte_bois(d)
    colonne_morris(d)
    boutique_droite(d)
    # les platanes du boulevard, devant les façades
    arbre(img, d, 150, 98, rnd, 22)
    arbre(img, d, 326, 116, rnd, 20)
    arbre(img, d, 20, 70, rnd, 24)
    arbre(img, d, 456, 84, rnd, 24)
    lampadaire(img, d, 306)
    # le trottoir, le caniveau, la chaussée
    rect(d, 0, SOL + 1, W, SOL + 22, hexa('#b9b3a6'))
    for x in range(0, W, 14):
        rect(d, x, SOL + 1, x, SOL + 22, hexa('#a29c90'))
    rect(d, 0, SOL + 12, W, SOL + 12, hexa('#a29c90'))
    rect(d, 0, SOL + 23, W, SOL + 25, hexa('#8d887c'))
    for y in range(SOL + 26, H):
        for x in range(W):
            tramer(img, x, y, hexa('#62656c'), hexa('#74777e'), .3)
    for x in range(10, W, 70):
        rect(d, x, 258, x + 28, 259, hexa('#e9e6dc'))
    return img


def trottoir():
    """Dalles de trottoir parisien 32 × 32 : gris chaud, joints sombres."""
    rnd = random.Random(5)
    img = Image.new('RGB', (32, 32), hexa('#9a9488'))
    d = ImageDraw.Draw(img)
    for ry in (0, 16):
        for rx in (0, 16):
            base = mix(hexa('#bdb7aa'), hexa('#aaa498'), rnd.random())
            rect(d, rx + 1, ry + 1, rx + 15, ry + 15, base)
            rect(d, rx + 1, ry + 1, rx + 15, ry + 1, mix(base, hexa('#dcd7cb'), .5))
            for _ in range(9):
                img.putpixel((rnd.randint(rx + 2, rx + 14), rnd.randint(ry + 2, ry + 14)), mix(base, hexa('#8a857a'), .5))
    return img


def asphalte():
    """Asphalte 32 × 32 : gris moyen, gravillons clairs et sombres."""
    rnd = random.Random(9)
    img = Image.new('RGB', (32, 32), hexa('#62656c'))
    for _ in range(150):
        x, y = rnd.randint(0, 31), rnd.randint(0, 31)
        img.putpixel((x, y), hexa(rnd.choice(['#74777e', '#575a61', '#80838a', '#4e5157'])))
    return img


if __name__ == '__main__':
    os.makedirs(SORTIE, exist_ok=True)
    fond().save(os.path.join(SORTIE, 'olympia.png'), optimize=True)
    trottoir().save(os.path.join(SORTIE, 'trottoir.png'), optimize=True)
    asphalte().save(os.path.join(SORTIE, 'asphalte.png'), optimize=True)
    print('ok')
