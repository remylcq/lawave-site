"""La rue de l'Olympia en pixel art, composée à partir de sprites générés avec Sprite Fusion, puis prolongée ici sans l'API.

    python outils/combat/olympia_sprites.py

Les quatre sprites 128 x 128 de outils/combat/sprites/ (v1 = l'Olympia, v0 / v2 / v3 = ses voisins) sont découpés
et recollés en une bande de rue : l'Olympia au centre, des immeubles de chaque côté. Les enseignes « L'OLYMPIA » des
autres immeubles sont remplacées par un store bleu, « LA WAVE » est écrit en pixels sur la marquise blanche.

Écrit dans img/combat/ (tout est agrandi 4 fois sans lissage) :
  - olympia.png       la bande de façades, fond transparent ;
  - horizon.png       les toits et les derniers étages de la bande, éclaircis (la brume), pour remplir le ciel derrière ;
  - accessoires.png   arbres, colonne Morris et lampadaire dessinés ici ;
  - olympia-fond.png  la rue sur un ciel avec trottoir et chaussée (le repli sans 3D).

Repères utilisés par combat.js, en pixels avant agrandissement : voir l'affichage de la commande (les bornes des tranches,
le bloc central, l'enseigne, la marquise, les piliers, et la position de chaque accessoire dans accessoires.png).
"""
import math
import os
import random

from PIL import Image, ImageDraw

ICI = os.path.dirname(os.path.abspath(__file__))
SPRITES = os.path.join(ICI, 'sprites')
SORTIE = os.path.join(ICI, '..', '..', 'img', 'combat')
ZOOM = 4

# (sprite, x0, x1, ligne du sol dans le sprite, retourné ?, enseigne à cacher) de gauche à droite : on recolle toujours une coupure
# sur une coupure retournée, ce qui donne un immeuble (ou un arbre) deux fois plus large plutôt qu'un raccord brutal.
STORE_V0 = (36, 62, 93, 74)    # l'enseigne rouge de v0 (x0, y0, x1, y1)
STORE_V2 = (37, 82, 91, 93)
PIECES = [
    (0, 8, 35, 115, True, None),
    (0, 8, 35, 115, False, None),
    (2, 28, 91, 114, False, STORE_V2),
    (3, 28, 98, 117, False, None),
    (1, 26, 102, 112, False, None),     # l'Olympia
    (3, 28, 98, 117, True, None),
    (0, 36, 94, 115, False, STORE_V0),
    (2, 92, 120, 114, False, None),
    (2, 92, 120, 114, True, None),
]

LETTRES = {
    'L': ['100', '100', '100', '100', '111'],
    'A': ['010', '101', '111', '101', '101'],
    'V': ['101', '101', '101', '101', '010'],
    'E': ['111', '100', '110', '100', '111'],
    'W': ['10001', '10001', '10101', '10101', '01010'],
}


def ecrire(img, x, y, mot, couleur):
    for car in mot:
        if car == ' ':
            x += 2
            continue
        glyphe = LETTRES[car]
        for j, ligne in enumerate(glyphe):
            for i, v in enumerate(ligne):
                if v == '1':
                    img.putpixel((x + i, y + j), couleur)
        x += len(glyphe[0]) + 1


def sprite(n):
    return Image.open(os.path.join(SPRITES, 'v%d.png' % n)).convert('RGBA')


def store(img, zone):
    """Remplace une enseigne rouge par un store bleu rayé, sans texte."""
    x0, y0, x1, y1 = zone
    d = ImageDraw.Draw(img)
    d.rectangle([x0, y0, x1, y1], fill=(34, 52, 88, 255))
    for x in range(x0 + 1, x1, 4):
        d.rectangle([x, y0 + 1, x + 1, y1 - 1], fill=(58, 86, 132, 255))
    d.line([x0, y0, x1, y0], fill=(150, 170, 200, 255))
    d.line([x0, y1, x1, y1], fill=(18, 28, 52, 255))


def bande():
    olympia = sprite(1)
    ecrire(olympia, 51, 83, 'LA WAVE', (176, 20, 28, 255))   # la marquise blanche, entre x = 49 et x = 81
    sources = {1: olympia, 0: sprite(0), 2: sprite(2), 3: sprite(3)}
    haut = 115
    larg = sum(x1 - x0 for n, x0, x1, sol, r, c in PIECES)
    img = Image.new('RGBA', (larg, haut), (0, 0, 0, 0))
    x = 0
    bornes = []
    for n, x0, x1, sol, retourne, cache in PIECES:
        src = sources[n].copy()
        if cache:
            store(src, cache)
        morceau = src.crop((x0, sol - haut, x1, sol))
        if retourne:
            morceau = morceau.transpose(Image.FLIP_LEFT_RIGHT)
        img.paste(morceau, (x, 0), morceau)
        bornes.append((x, x + x1 - x0))
        x += x1 - x0
    return img, bornes


def horizon(img):
    """Les toits et les derniers étages, décalés et éclaircis : une ville plus loin, dans la brume."""
    L, H = img.size
    haut = img.crop((0, 0, L, 48))
    decale = Image.new('RGBA', (L, 48), (0, 0, 0, 0))
    k = L // 3
    decale.paste(haut.crop((k, 0, L, 48)), (0, 0)); decale.paste(haut.crop((0, 0, k, 48)), (L - k, 0))
    px = decale.load()
    for y in range(48):
        for x in range(L):
            r, g, b, a = px[x, y]
            if a:
                px[x, y] = (int(r + (196 - r) * .38), int(g + (214 - g) * .38), int(b + (234 - b) * .38), 255)
    return decale


def contour(img, couleur):
    """Un trait sombre autour de la silhouette, comme sur les sprites générés."""
    px = img.load()
    w, h = img.size
    sortie = img.copy()
    po = sortie.load()
    for y in range(h):
        for x in range(w):
            if px[x, y][3] == 0:
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < w and 0 <= ny < h and px[nx, ny][3] > 0:
                        po[x, y] = couleur
                        break
    return sortie


def arbre(graine):
    rnd = random.Random(graine)
    img = Image.new('RGBA', (48, 72), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rectangle([22, 38, 25, 71], fill=(96, 66, 42, 255))
    d.rectangle([22, 38, 22, 71], fill=(120, 86, 56, 255))
    d.rectangle([25, 38, 25, 71], fill=(70, 46, 30, 255))
    d.line([23, 44, 15, 32], fill=(96, 66, 42, 255)); d.line([24, 44, 33, 31], fill=(96, 66, 42, 255))
    blobs = []
    for _ in range(34):
        a = rnd.uniform(0, 6.283)
        r = rnd.uniform(0, 17)
        blobs.append((24 + int(r * 1.2 * math.cos(a)), 22 + int(r * .9 * math.sin(a)), rnd.randint(4, 7)))
    for cx, cy, r in blobs:
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(42, 88, 42, 255))
    for cx, cy, r in blobs:
        d.ellipse([cx - r + 1, cy - r - 1, cx + r - 2, cy + r - 3], fill=(70, 124, 52, 255))
    for cx, cy, r in blobs:
        d.ellipse([cx - r + 2, cy - r, cx + r - 4, cy + r - 5], fill=(108, 164, 68, 255))
    for _ in range(40):
        x, y = rnd.randint(8, 40), rnd.randint(4, 34)
        if img.getpixel((x, y))[3]:
            img.putpixel((x, y), rnd.choice([(150, 200, 92, 255), (92, 146, 60, 255), (50, 98, 46, 255)]))
    return contour(img, (26, 50, 30, 255))


def colonne():
    img = Image.new('RGBA', (20, 48), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rectangle([3, 12, 16, 44], fill=(46, 100, 68, 255))
    d.rectangle([3, 12, 5, 44], fill=(72, 132, 92, 255))
    d.rectangle([14, 12, 16, 44], fill=(30, 70, 48, 255))
    for (x, y, c) in ((6, 16, (232, 226, 200, 255)), (6, 27, (200, 60, 50, 255)), (6, 36, (240, 200, 70, 255)), (11, 20, (70, 120, 190, 255)), (10, 31, (232, 226, 200, 255))):
        d.rectangle([x, y, x + 3, y + 7], fill=c)
    d.rectangle([2, 8, 17, 12], fill=(32, 66, 48, 255))
    d.rectangle([5, 4, 14, 8], fill=(40, 84, 58, 255))
    d.rectangle([8, 1, 11, 4], fill=(32, 66, 48, 255))
    d.rectangle([2, 44, 17, 47], fill=(28, 56, 42, 255))
    return contour(img, (18, 34, 26, 255))


def lampadaire():
    img = Image.new('RGBA', (12, 56), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    fer = (44, 62, 52, 255)
    d.rectangle([5, 12, 6, 54], fill=fer)
    d.rectangle([3, 46, 8, 55], fill=(36, 52, 44, 255))
    d.rectangle([4, 10, 7, 12], fill=fer)
    d.rectangle([2, 2, 9, 9], fill=(255, 228, 150, 255))
    d.rectangle([2, 2, 9, 2], fill=fer); d.rectangle([2, 9, 9, 9], fill=fer); d.rectangle([2, 2, 2, 9], fill=fer); d.rectangle([9, 2, 9, 9], fill=fer)
    d.polygon([(1, 2), (10, 2), (5, 0)], fill=fer)
    return contour(img, (20, 30, 26, 255))


def accessoires():
    atlas = Image.new('RGBA', (48 * 3 + 20 + 12, 72), (0, 0, 0, 0))
    for i in range(3):
        atlas.paste(arbre(11 + i * 7), (i * 48, 0))
    atlas.paste(colonne(), (144, 24))
    atlas.paste(lampadaire(), (164, 16))
    return atlas


def fond(img):
    """Le repli 2D : un ciel, la rue, un trottoir et une chaussée, à la même échelle que la bande."""
    L, H = img.size
    bas = 44
    plein = Image.new('RGBA', (L, H + bas), (0, 0, 0, 255))
    d = ImageDraw.Draw(plein)
    for y in range(H):
        t = y / max(1, H - 1)
        d.line([0, y, L, y], fill=(int(111 + 96 * t), int(166 + 61 * t), int(220 + 21 * t), 255))
    plein.paste(img, (0, 0), img)
    d.rectangle([0, H, L, H + 10], fill=(178, 172, 160, 255))
    d.rectangle([0, H + 11, L, H + bas], fill=(92, 96, 104, 255))
    for x in range(0, L, 22):
        d.rectangle([x, H + 30, x + 10, H + 31], fill=(233, 230, 220, 255))
    return plein


def agrandir(img):
    return img.resize((img.width * ZOOM, img.height * ZOOM), Image.NEAREST)


def main():
    img, bornes = bande()
    os.makedirs(SORTIE, exist_ok=True)
    agrandir(img).save(os.path.join(SORTIE, 'olympia.png'), optimize=True)
    h = horizon(img)
    agrandir(h).save(os.path.join(SORTIE, 'horizon.png'), optimize=True)
    a = accessoires()
    agrandir(a).save(os.path.join(SORTIE, 'accessoires.png'), optimize=True)
    f = fond(img)
    agrandir(f.convert('RGB')).save(os.path.join(SORTIE, 'olympia-fond.png'), optimize=True)
    print('bande', img.size, 'horizon', h.size, 'accessoires', a.size)
    print('tranches', bornes)


if __name__ == '__main__':
    main()
