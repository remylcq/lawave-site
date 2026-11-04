"""L'Olympia de Paris en pixel art, tirée de vraies photos du boulevard des Capucines (Street View).

    python outils/combat/olympia_photo.py <dossier des photos>      (le dossier contient 2.webp = vue large, 4.webp = vue rapprochée)

Écrit img/combat/olympia.png (480 × 270, le sol est à la ligne 215), le décor des combats de Wave Cards :
  - la photo rapprochée (façade, immeubles voisins, abribus, porte en bois) est réduite, lissée, ses couleurs sont limitées et ses contours soulignés ;
  - les spectacles de la devanture (« BIG THIEF », « DYLAN MEEK »…) sont effacés et remplacés par « LA WAVE » en lettres rouges ;
  - le trottoir et la chaussée du bas viennent de la vue large.
Les photos ne sont pas dans le dépôt : seul le résultat l'est. Les textures trottoir.png et asphalte.png restent celles de olympia.py.
"""
import os
import sys

from PIL import Image, ImageChops, ImageDraw, ImageEnhance, ImageFilter

W, H, SOL = 480, 270, 215
SORTIE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'img', 'combat')

POLICE = {
    'O': ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
    'Y': ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
    'M': ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
    'P': ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
    'I': ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
    'L': ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
    'A': ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
    'W': ['10001', '10001', '10001', '10101', '10101', '11011', '10001'],
    'V': ['10001', '10001', '10001', '10001', '01010', '01010', '00100'],
    'E': ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
}


def hexa(c):
    c = c.lstrip('#')
    return tuple(int(c[i:i + 2], 16) for i in (0, 2, 4))


def texte(d, x, y, mot, k, c, espace=3):
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


def largeur(mot, k, espace=3):
    return sum((3 * k + espace) if car == ' ' else (5 * k + espace) for car in mot) - espace


def pixeliser(img, couleurs):
    """Lisse, accentue, limite la palette et souligne les contours : le « look » pixel art."""
    img = img.filter(ImageFilter.MedianFilter(3))
    img = ImageEnhance.Color(img).enhance(1.15)
    img = ImageEnhance.Contrast(img).enhance(1.1)
    img = img.filter(ImageFilter.UnsharpMask(1, 70, 2))
    q = img.quantize(colors=couleurs, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).convert('RGB')
    bord = ImageChops.difference(q.filter(ImageFilter.MaxFilter(3)), q.filter(ImageFilter.MinFilter(3))).convert('L').point(lambda v: 255 if v > 95 else 0)
    sombre = ImageEnhance.Brightness(q).enhance(.72)
    return Image.composite(sombre, q, bord)


def haut(photo):
    im = Image.open(photo).convert('RGB')
    cw = int(im.height * W / SOL)
    x0 = (im.width - cw) // 2
    crop = im.crop((x0, 0, x0 + cw, im.height))
    return pixeliser(crop.resize((W, SOL), Image.LANCZOS), 56)


def bas(photo):
    im = Image.open(photo).convert('RGB')
    x0, x1 = 330, 1692
    h = int((x1 - x0) * (H - SOL) / W)
    y1 = 731
    crop = im.crop((x0, y1 - h, x1, y1))
    return pixeliser(crop.resize((W, H - SOL), Image.LANCZOS), 24)


def devanture_la_wave(img):
    """Efface les spectacles de la devanture et affiche « LA WAVE » en rouge (le panneau est fondu dans la photo pour garder la matière)."""
    fond = hexa('#4a3a38'); barre = hexa('#d8d0be'); barre2 = hexa('#8c8478')
    x0, x1, y0, y1 = 225, 317, 70, 158
    panneau = Image.new('RGB', img.size, fond)
    dp = ImageDraw.Draw(panneau)
    for x in range(x0, x1 + 1, 3):
        dp.line([x, y0, x, y1], fill=barre if (x // 3) % 2 == 0 else barre2)
    for y in (y0, y0 + 30, y0 + 58, y1 - 1):
        dp.rectangle([x0, y, x1, y + 1], fill=barre)
    masque = Image.new('L', img.size, 0)
    dm = ImageDraw.Draw(masque)
    dm.rectangle([x0, y0, x1, y1], fill=185)
    dm.rectangle([236, 160, 313, 167], fill=235)
    img.paste(panneau, (0, 0), masque)
    d = ImageDraw.Draw(img)
    mot = 'LA WAVE'
    k = 2
    xx = (x0 + x1) // 2 - largeur(mot, k, 2) // 2
    texte(d, xx + 1, y0 + 40, mot, k, hexa('#6a1818'), 2)
    texte(d, xx, y0 + 39, mot, k, hexa('#e8423d'), 2)
    return img


def enseigne(img):
    """Rend « OLYMPIA » lisible : les arbres cachent des lettres sur la photo, on les redessine sur le bandeau rouge."""
    x0, x1, y0, y1 = 220, 342, 19, 50
    rouge = Image.new('RGB', img.size, hexa('#c8472b'))
    masque = Image.new('L', img.size, 0)
    ImageDraw.Draw(masque).rectangle([x0, y0, x1, y1], fill=225)
    img.paste(rouge, (0, 0), masque)
    d = ImageDraw.Draw(img)
    cx, cy = x0 + 14, (y0 + y1) // 2          # le logo : un hexagone blanc ouvert
    for (ax, ay, bx, by) in [(-7, 0, -3, -7), (-3, -7, 4, -7), (4, -7, 8, 0), (8, 0, 4, 7), (4, 7, -3, 7), (-3, 7, -7, 0)]:
        n = max(abs(bx - ax), abs(by - ay), 1)
        for i in range(n + 1):
            xx = cx + ax + (bx - ax) * i // n
            yy = cy + ay + (by - ay) * i // n
            d.point((xx, yy), fill=hexa('#fff4e6')); d.point((xx, yy + 1), fill=hexa('#fff4e6'))
    xl = x0 + 30
    for dec, c in ((1, hexa('#8a2a1c')), (0, hexa('#fff4e6'))):
        texte(d, xl + 1 - dec, y0 + 8 + 1 - dec, 'OLYMPIA', 2, c, 1)
        texte(d, xl + 2 - dec, y0 + 8 + 1 - dec, 'OLYMPIA', 2, c, 1) if dec == 0 else None
    return img


def main(dossier):
    img = Image.new('RGB', (W, H))
    img.paste(haut(os.path.join(dossier, '4.webp')), (0, 0))
    img.paste(bas(os.path.join(dossier, '2.webp')), (0, SOL))
    enseigne(img)
    devanture_la_wave(img)
    os.makedirs(SORTIE, exist_ok=True)
    img.save(os.path.join(SORTIE, 'olympia.png'), optimize=True)
    print('ok')


if __name__ == '__main__':
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    main(sys.argv[1])
