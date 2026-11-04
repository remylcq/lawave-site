"""La façade de l'Olympia de Paris en pixel art, le décor des combats de Wave Cards, et ses textures (pavé, tapis rouge).

    python outils/combat/olympia.py

Écrit img/combat/olympia.png (480 × 270, le sol est à la ligne 215), img/combat/pave.png et img/combat/tapis.png.
Tout est dessiné pixel par pixel (aucune image externe) : palette limitée, dégradés tramés, lumières en demi-teintes.
Affichés agrandis sans lissage (NearestFilter dans la scène 3D, image-rendering: pixelated en 2D).
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
    """Pose un pixel entre a et b, tramé selon t (0 → a, 1 → b)."""
    if 0 <= x < img.width and 0 <= y < img.height:
        img.putpixel((x, y), b if (BAYER[y % 4][x % 4] + .5) / 16 < t else a)


def rect(d, x0, y0, x1, y1, c):
    d.rectangle([x0, y0, x1, y1], fill=c)


def halo(img, cx, cy, r, couleur, force=1.0):
    """Une lumière en demi-teintes autour d'un point."""
    for y in range(cy - r, cy + r + 1):
        for x in range(cx - r, cx + r + 1):
            d = ((x - cx) ** 2 + (y - cy) ** 2) ** .5
            if d <= r and 0 <= x < img.width and 0 <= y < img.height:
                t = (1 - d / r) ** 1.6 * force
                if (BAYER[y % 4][x % 4] + .5) / 16 < t:
                    img.putpixel((x, y), mix(img.getpixel((x, y)), couleur, min(1, t * 1.1)))


POLICE = {
    'O': ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
    'L': ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
    'Y': ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
    'M': ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
    'P': ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
    'I': ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
    'A': ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
}


def lettre(d, x, y, car, k, c):
    for j, ligne in enumerate(POLICE[car]):
        for i, v in enumerate(ligne):
            if v == '1':
                d.rectangle([x + i * k, y + j * k, x + i * k + k - 1, y + j * k + k - 1], fill=c)


def immeuble_haussmann(img, d, x0, x1, haut, rnd):
    """Un immeuble haussmannien de nuit : pierre claire, balcons, fenêtres allumées, toit de zinc à lucarnes."""
    pierre = hexa('#7a7188'); clair = hexa('#968da6'); sombre = hexa('#554e66'); zinc = hexa('#3b4560'); zinc2 = hexa('#4c5878')
    vitre = hexa('#161c3a'); lumiere = hexa('#f2c46b'); lumiere2 = hexa('#ffe3a0'); fer = hexa('#25222f')
    rect(d, x0, haut + 24, x1, SOL, pierre)
    for y in range(haut, haut + 24):
        marge = int((haut + 24 - y) * .5)
        rect(d, x0 + marge // 2, y, x1 - marge // 2, y, zinc if (y // 3) % 2 == 0 else zinc2)
    for cx in range(x0 + 16, x1 - 10, 30):
        rect(d, cx, haut + 8, cx + 9, haut + 20, sombre); rect(d, cx + 2, haut + 11, cx + 7, haut + 19, vitre if rnd.random() > .35 else lumiere)
        rect(d, cx - 1, haut + 5, cx + 10, haut + 7, zinc2)
    for cx in (x0 + 12, x1 - 22):
        rect(d, cx, haut - 10, cx + 5, haut + 8, hexa('#2a2f45')); rect(d, cx - 1, haut - 12, cx + 6, haut - 10, hexa('#3b4360'))
    rect(d, x0, haut + 24, x1, haut + 27, clair)
    for etage in range(4):
        y = haut + 32 + etage * 33
        if y + 26 > SOL - 4:
            break
        for cx in range(x0 + 8, x1 - 12, 20):
            rect(d, cx - 1, y - 1, cx + 10, y + 21, sombre)
            allumee = rnd.random() > .55
            rect(d, cx, y, cx + 9, y + 20, lumiere if allumee else vitre)
            if allumee:
                rect(d, cx + 1, y + 1, cx + 8, y + 6, lumiere2)
            rect(d, cx + 4, y, cx + 5, y + 20, sombre); rect(d, cx, y + 9, cx + 9, y + 9, sombre)
        rect(d, x0, y + 21, x1, y + 23, fer if etage % 2 == 0 else sombre)
        if etage % 2 == 0:
            for bx in range(x0 + 2, x1, 5):
                rect(d, bx, y + 24, bx, y + 26, fer)
        rect(d, x0, y + 27, x1, y + 28, clair)
    rect(d, x0, SOL - 26, x1, SOL, hexa('#2c2838'))
    for cx in range(x0 + 6, x1 - 14, 26):
        rect(d, cx, SOL - 22, cx + 17, SOL - 2, hexa('#10131f')); rect(d, cx + 2, SOL - 20, cx + 15, SOL - 4, hexa('#2a3050') if rnd.random() > .4 else lumiere)


def lampadaire(img, d, x):
    fer = hexa('#10131c'); verre = hexa('#ffe9a8')
    rect(d, x, SOL - 78, x + 2, SOL + 6, fer)
    rect(d, x - 1, SOL + 2, x + 3, SOL + 6, fer)
    rect(d, x - 4, SOL - 82, x + 6, SOL - 79, fer)
    rect(d, x - 3, SOL - 92, x + 5, SOL - 83, verre)
    rect(d, x - 1, SOL - 96, x + 3, SOL - 93, fer)
    halo(img, x + 1, SOL - 87, 26, hexa('#ffd98a'), .9)


def foule(d, rnd):
    """Des silhouettes devant les portes, quelques téléphones levés."""
    for _ in range(26):
        x = rnd.randint(150, 330)
        h = rnd.randint(12, 18)
        y = SOL + rnd.randint(-4, 8)
        c = hexa(rnd.choice(['#0a0c16', '#0e1120', '#121528', '#080a12']))
        rect(d, x, y - h + 6, x + 4, y, c)
        rect(d, x + 1, y - h, x + 3, y - h + 3, c)
        if rnd.random() > .8:
            rect(d, x - 2, y - h + 1, x - 1, y - h + 4, c); rect(d, x - 2, y - h - 1, x - 1, y - h, hexa('#fff3b0'))


def facade(img, d, rnd):
    rouge = hexa('#b3202f'); rouge2 = hexa('#8f1a28'); rouge3 = hexa('#5e1019'); pierre = hexa('#8a7580'); pierre2 = hexa('#a48f96'); pierre3 = hexa('#5d4c58')
    vitre = hexa('#161c3a'); lumiere = hexa('#f2c46b'); ampoule = hexa('#fff0b8'); ampoule2 = hexa('#ffc65a')
    x0, x1 = 128, 352
    for y in range(52, 82):
        marge = int((82 - y) * .6)
        rect(d, x0 + 4 + marge // 2, y, x1 - 4 - marge // 2, y, hexa('#34405c') if (y // 3) % 2 == 0 else hexa('#46527a'))
    for cx in range(x0 + 22, x1 - 18, 34):
        rect(d, cx, 62, cx + 11, 78, pierre3); rect(d, cx + 2, 65, cx + 9, 77, lumiere if rnd.random() > .4 else vitre)
        rect(d, cx - 1, 59, cx + 12, 61, hexa('#46527a'))
    rect(d, x0, 82, x1, 86, pierre2)
    rect(d, x0, 87, x1, 120, pierre)
    for cx in range(x0 + 10, x1 - 14, 21):
        rect(d, cx - 1, 91, cx + 12, 117, pierre3)
        allumee = rnd.random() > .3
        rect(d, cx, 92, cx + 11, 116, lumiere if allumee else vitre)
        if allumee:
            rect(d, cx + 1, 93, cx + 10, 100, hexa('#ffe3a0'))
        rect(d, cx + 5, 92, cx + 6, 116, pierre3); rect(d, cx, 104, cx + 11, 104, pierre3)
        rect(d, cx - 2, 90, cx + 13, 91, pierre2)
    for px in (x0, x0 + 64, x1 - 64, x1):
        rect(d, px - 2, 87, px + 2, SOL - 20, pierre2)
    # l'enseigne : le bandeau rouge, ses ampoules, « OLYMPIA » en lettres blanches
    rect(d, x0 - 4, 121, x1 + 4, 158, rouge3)
    for y in range(124, 156):
        t = (y - 124) / 32
        rect(d, x0 - 1, y, x1 + 1, y, mix(hexa('#c72a3a'), rouge2, t))
    for x in range(x0 - 1, x1 + 2, 6):
        for y in (122, 157):
            rect(d, x, y, x + 1, y + 1, ampoule if (x // 6) % 2 == 0 else ampoule2)
    for y in range(125, 156, 6):
        for x in (x0 - 3, x1 + 2):
            rect(d, x, y, x + 1, y + 1, ampoule if (y // 6) % 2 == 0 else ampoule2)
    k = 4
    total = 7 * 5 * k + 6 * 5
    xs = (x0 + x1) // 2 - total // 2
    for i, car in enumerate('OLYMPIA'):
        x = xs + i * (5 * k + 5)
        lettre(d, x + 1, 130, car, k, rouge3)
        lettre(d, x, 128, car, k, hexa('#fff7e0'))
    halo(img, (x0 + x1) // 2, 140, 70, hexa('#ff7a6a'), .35)
    # la corniche sous l'enseigne puis l'auvent rouge et blanc et ses ampoules
    rect(d, x0 - 4, 159, x1 + 4, 163, pierre2)
    rect(d, x0 - 10, 164, x1 + 10, 181, rouge2)
    for x in range(x0 - 10, x1 + 11, 8):
        rect(d, x, 164, x + 3, 181, rouge if (x // 8) % 2 == 0 else hexa('#f0e4d0'))
    rect(d, x0 - 10, 164, x1 + 10, 165, rouge3); rect(d, x0 - 10, 181, x1 + 10, 183, rouge3)
    for x in range(x0 - 8, x1 + 10, 6):
        rect(d, x, 184, x + 1, 185, ampoule)
    halo(img, (x0 + x1) // 2, 188, 90, hexa('#ffc65a'), .22)
    # les portes vitrées éclairées, les vitrines d'affiches
    rect(d, x0, 184, x1, SOL, hexa('#3a2f3c'))
    for cx in range(x0 + 46, x1 - 40, 44):
        rect(d, cx, 188, cx + 36, SOL, hexa('#10101a'))
        for y in range(190, SOL):
            t = (y - 190) / 25
            c = mix(hexa('#ffe8a0'), hexa('#f6b94a'), t)
            rect(d, cx + 2, y, cx + 17, y, c); rect(d, cx + 19, y, cx + 34, y, c)
        rect(d, cx + 17, 190, cx + 18, SOL, hexa('#10101a'))
    for vx in (x0 + 8, x1 - 30):
        rect(d, vx - 1, 188, vx + 21, 214, hexa('#10101a'))
        rect(d, vx, 189, vx + 20, 213, hexa('#241a2c'))
        for j, c in enumerate(['#d93a55', '#3aa0d9', '#f2c46b']):
            rect(d, vx + 2 + j * 6, 191, vx + 6 + j * 6, 211, hexa(c))
            rect(d, vx + 3 + j * 6, 197, vx + 5 + j * 6, 203, hexa('#fff3d0'))
    halo(img, 240, SOL, 70, hexa('#ffc65a'), .3)


def fond():
    rnd = random.Random(7)
    img = Image.new('RGB', (W, H))
    d = ImageDraw.Draw(img)
    # le ciel de nuit parisien, tramé
    ciel = [hexa(c) for c in ['#060a1c', '#0b1230', '#141c44', '#212a5a', '#3a3566', '#5a416b', '#7a4f6c', '#9a5a68']]
    for y in range(0, SOL):
        t = y / (SOL - 1) * (len(ciel) - 1)
        i = int(t)
        for x in range(W):
            tramer(img, x, y, ciel[i], ciel[min(i + 1, len(ciel) - 1)], t - i)
    for _ in range(70):
        x, y = rnd.randint(0, W - 1), rnd.randint(0, 110)
        img.putpixel((x, y), hexa(rnd.choice(['#ffffff', '#cfd8ff', '#9aa6e0'])))
    # la lune
    for dy in range(-7, 8):
        for dx in range(-7, 8):
            if dx * dx + dy * dy <= 49 and not ((dx + 3) ** 2 + (dy - 1) ** 2 <= 36):
                img.putpixel((410 + dx, 38 + dy), hexa('#fdf4d2'))
    halo(img, 410, 38, 26, hexa('#fdf4d2'), .5)
    # les toits lointains
    ciel_loin = hexa('#171c3a')
    x = 0
    while x < W:
        w = rnd.randint(14, 34); h = rnd.randint(95, 150)
        rect(d, x, h, x + w, SOL, ciel_loin)
        for _ in range(rnd.randint(0, 3)):
            wx, wy = rnd.randint(x + 2, x + w - 3), rnd.randint(h + 8, SOL - 30)
            rect(d, wx, wy, wx + 1, wy + 2, hexa('#d9b45a'))
        x += w
    immeuble_haussmann(img, d, 0, 118, 64, rnd)
    immeuble_haussmann(img, d, 362, W - 1, 70, rnd)
    facade(img, d, rnd)
    # le trottoir, la chaussée, le tapis rouge
    rect(d, 0, SOL + 1, W, SOL + 26, hexa('#3d3a4c'))
    for x in range(0, W, 16):
        rect(d, x, SOL + 1, x, SOL + 26, hexa('#312f3f'))
    rect(d, 0, SOL + 1, W, SOL + 2, hexa('#6a6680'))
    for y in range(SOL + 27, H):
        for x in range(W):
            tramer(img, x, y, hexa('#161722'), hexa('#222333'), .25 + (y - SOL - 27) / 90)
    for y in range(SOL + 1, SOL + 14):
        marge = (y - SOL) * 2
        rect(d, 205 - marge, y, 275 + marge, y, hexa('#a3182a') if y % 4 else hexa('#7d1220'))
    foule(d, rnd)
    lampadaire(img, d, 118)
    lampadaire(img, d, 362)
    return img


def pave():
    """Un pavé de Paris 32 × 32 qui se répète : pierres grises aux joints sombres, un peu de bleu de nuit."""
    rnd = random.Random(3)
    img = Image.new('RGB', (32, 32), hexa('#1a1c28'))
    d = ImageDraw.Draw(img)
    for ry in range(0, 32, 8):
        decal = 8 if (ry // 8) % 2 else 0
        for rx in range(-8, 32, 16):
            x = rx + decal
            base = mix(hexa('#555a6e'), hexa('#3e4256'), rnd.random())
            rect(d, x + 1, ry + 1, x + 14, ry + 6, base)
            rect(d, x + 1, ry + 1, x + 14, ry + 1, mix(base, hexa('#8a90a8'), .35))
            for _ in range(5):
                px, py = rnd.randint(x + 2, x + 13), rnd.randint(ry + 2, ry + 6)
                if 0 <= px < 32:
                    img.putpixel((px, py), mix(base, hexa('#2a2d3c'), .5))
    return img


def tapis():
    """Un tapis rouge 32 × 32 (répété en longueur) : bordure dorée, velours sombre."""
    img = Image.new('RGB', (32, 32), hexa('#a3182a'))
    d = ImageDraw.Draw(img)
    for y in range(32):
        rect(d, 4, y, 27, y, hexa('#a3182a') if y % 4 else hexa('#8a1424'))
    rect(d, 0, 0, 3, 31, hexa('#2a0a10')); rect(d, 28, 0, 31, 31, hexa('#2a0a10'))
    rect(d, 3, 0, 3, 31, hexa('#d9a441')); rect(d, 28, 0, 28, 31, hexa('#d9a441'))
    rect(d, 5, 0, 5, 31, hexa('#d9a441')); rect(d, 26, 0, 26, 31, hexa('#d9a441'))
    for y in range(0, 32, 8):
        rect(d, 15, y + 2, 16, y + 3, hexa('#d9a441'))
    return img


if __name__ == '__main__':
    os.makedirs(SORTIE, exist_ok=True)
    fond().save(os.path.join(SORTIE, 'olympia.png'), optimize=True)
    pave().save(os.path.join(SORTIE, 'pave.png'), optimize=True)
    tapis().save(os.path.join(SORTIE, 'tapis.png'), optimize=True)
    print('ok')
