"""La rue de l'Olympia en pixel art, composée à partir de sprites générés avec Sprite Fusion.

    python outils/combat/olympia_sprites.py

Les quatre sprites 128 x 128 de outils/combat/sprites/ (v1 = l'Olympia, v0 / v2 / v3 = ses voisins) sont découpés
et recollés en une bande de rue : des immeubles voisins de chaque côté, l'Olympia au centre.
« LA WAVE » est écrit en pixels sur la marquise blanche (la police 3 x 5 est dessinée ici).

Écrit dans img/combat/ :
  - olympia.png      la bande, fond transparent, agrandie 4 fois sans lissage (la scène 3D la découpe en plans) ;
  - olympia-fond.png la même rue sur un ciel, avec trottoir et chaussée (le repli sans 3D).

Repères utilisés par combat.js (en pixels de la bande avant agrandissement) : largeur 326, hauteur 116, le sol est en bas,
le bloc central va de x = 124 à x = 200, l'enseigne est en (138, 58)-(188, 71), la marquise en (147, 82)-(179, 97),
les piliers en (139, 72)-(146, 116) et (180, 72)-(187, 116).
"""
import os

from PIL import Image, ImageDraw

ICI = os.path.dirname(os.path.abspath(__file__))
SPRITES = os.path.join(ICI, 'sprites')
SORTIE = os.path.join(ICI, '..', '..', 'img', 'combat')
ZOOM = 4

# (sprite, x0, x1, ligne du sol dans le sprite, retourné ?) de gauche à droite : on recolle toujours une coupure sur une coupure
# retournée, ce qui donne un immeuble (ou un arbre) deux fois plus large plutôt qu'un raccord brutal.
PIECES = [
    (0, 8, 35, 115, True),     # voisin de gauche de v0, retourné
    (0, 8, 35, 115, False),    # le même, dans le bon sens
    (3, 28, 98, 117, False),   # l'immeuble de v3
    (1, 26, 102, 112, False),  # l'Olympia
    (3, 28, 98, 117, True),    # l'immeuble de v3, retourné
    (2, 92, 120, 114, False),  # voisin de droite de v2
    (2, 92, 120, 114, True),   # le même, retourné
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


def bande():
    olympia = sprite(1)
    ecrire(olympia, 51, 83, 'LA WAVE', (176, 20, 28, 255))   # la marquise blanche, entre x = 49 et x = 81
    sources = {1: olympia, 0: sprite(0), 2: sprite(2), 3: sprite(3)}
    haut = max(sol - (sources[n].getbbox()[1]) for n, x0, x1, sol, r in PIECES)
    larg = sum(x1 - x0 for n, x0, x1, sol, r in PIECES)
    img = Image.new('RGBA', (larg, haut), (0, 0, 0, 0))
    x = 0
    for n, x0, x1, sol, retourne in PIECES:
        morceau = sources[n].crop((x0, sol - haut, x1, sol))
        if retourne:
            morceau = morceau.transpose(Image.FLIP_LEFT_RIGHT)
        img.paste(morceau, (x, 0), morceau)
        x += x1 - x0
    return img


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


def main():
    img = bande()
    os.makedirs(SORTIE, exist_ok=True)
    img.resize((img.width * ZOOM, img.height * ZOOM), Image.NEAREST).save(os.path.join(SORTIE, 'olympia.png'), optimize=True)
    f = fond(img)
    f.convert('RGB').resize((f.width * ZOOM, f.height * ZOOM), Image.NEAREST).save(os.path.join(SORTIE, 'olympia-fond.png'), optimize=True)
    print('bande', img.size, '-> fond', f.size)


if __name__ == '__main__':
    main()
