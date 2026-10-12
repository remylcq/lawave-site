"""Prépare les matières du décor (parquet, marbres, boiserie) : télécharge les originaux, les réduit, les
range dans decor/ (JPEG). Tout est sous licence CC0 (Poly Haven, ambientCG).

    blender -b -P outils/decor/preparer_decor.py

Chaque matière donne trois fichiers : <nom>_c.jpg (couleur), <nom>_n.jpg (relief, normale OpenGL) et
<nom>_a.jpg (canal vert = rugosité ; le jeu ne lit que celui-là), en deux définitions : la légère
(<nom>_c.jpg...) pour les téléphones et les petites machines, la HD (<nom>_c_h.jpg...) pour les ordinateurs
récents (le jeu choisit, voir qualiteHD dans waveurs.js). Les originaux sont gardés dans CACHE
(variable d'environnement, sinon un dossier à côté du script) pour ne pas être retéléchargés.
"""
import io
import json
import os
import sys
import urllib.request
import zipfile

import numpy as np
import bpy

ICI = os.path.dirname(os.path.abspath(__file__))
RACINE = os.path.abspath(os.path.join(ICI, '..', '..'))
SORTIE = os.environ.get('DECOR_SORTIE', os.path.join(RACINE, 'decor'))
CACHE = os.environ.get('CACHE', os.path.join(ICI, '_cache'))
AGENT = {'User-Agent': 'lawave-site (decor)'}

# nom du jeu : (source, identifiant, (couleur, relief, rugosité) légers, (couleur, relief, rugosité) HD)
MATIERES = {
    'parquet': ('polyhaven', 'herringbone_parquet', (1024, 1024, 512), (2048, 2048, 1024)),
    'boiserie': ('polyhaven', 'rosewood_veneer1', (512, 512, 256), (1024, 1024, 512)),
    'murs': ('ambientcg', 'Marble016', (1024, 1024, 512), (2048, 2048, 1024)),
    'comptoir': ('ambientcg', 'Marble019', (1024, 1024, 512), (2048, 2048, 1024)),
}


def telecharger(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=AGENT)) as r:
        return r.read()


def en_cache(nom, fabrique):
    os.makedirs(CACHE, exist_ok=True)
    chemin = os.path.join(CACHE, nom)
    if not os.path.exists(chemin):
        with open(chemin, 'wb') as f:
            f.write(fabrique())
    return chemin


def originaux_polyhaven(ident, res='1k'):
    infos = json.loads(telecharger('https://api.polyhaven.com/files/' + ident).decode('utf-8'))
    out = {}
    for carte, cle in (('c', 'Diffuse'), ('n', 'nor_gl'), ('a', 'arm')):
        url = infos[cle][res]['jpg']['url']
        out[carte] = en_cache('%s_%s_%s.jpg' % (ident, carte, res) if res != '1k' else '%s_%s.jpg' % (ident, carte),
                              lambda u=url: telecharger(u))
    return out


def originaux_ambientcg(ident, res='1K'):
    zpath = en_cache('%s_%s-JPG.zip' % (ident, res), lambda: telecharger('https://ambientcg.com/get?file=%s_%s-JPG.zip' % (ident, res)))
    out = {}
    with zipfile.ZipFile(zpath) as z:
        for carte, suffixe in (('c', '_Color.jpg'), ('n', '_NormalGL.jpg'), ('a', '_Roughness.jpg')):
            nom = [n for n in z.namelist() if n.endswith(suffixe)][0]
            chemin = os.path.join(CACHE, ident + '_' + res + suffixe)
            if not os.path.exists(chemin):
                with open(chemin, 'wb') as f:
                    f.write(z.read(nom))
            out[carte] = chemin
    return out


def lire(chemin, taille):
    im = bpy.data.images.load(chemin)
    im.colorspace_settings.name = 'Non-Color'          # on garde les valeurs du fichier telles quelles
    if im.size[0] != taille or im.size[1] != taille:
        im.scale(taille, taille)
    a = np.empty(taille * taille * 4, np.float32)
    im.pixels.foreach_get(a)
    bpy.data.images.remove(im)
    return a.reshape(taille, taille, 4)


def ecrire(chemin, a):
    h, w = a.shape[:2]
    im = bpy.data.images.new('sortie', w, h, alpha=False)
    im.colorspace_settings.name = 'Non-Color'
    im.pixels.foreach_set(np.clip(a, 0, 1).astype(np.float32).ravel())
    sc = bpy.context.scene
    sc.render.image_settings.file_format = 'JPEG'
    sc.render.image_settings.color_mode = 'RGB'
    sc.render.image_settings.quality = 82
    im.save_render(chemin, scene=sc)
    bpy.data.images.remove(im)


def fabriquer(nom, source, ident, tailles, suffixe, res_ph, res_acg):
    t_c, t_n, t_a = tailles
    src = originaux_polyhaven(ident, res_ph) if source == 'polyhaven' else originaux_ambientcg(ident, res_acg)
    ecrire(os.path.join(SORTIE, '%s_c%s.jpg' % (nom, suffixe)), lire(src['c'], t_c))
    ecrire(os.path.join(SORTIE, '%s_n%s.jpg' % (nom, suffixe)), lire(src['n'], t_n))
    a = lire(src['a'], t_a)
    if source == 'ambientcg':
        # la rugosité seule : on la range dans le canal vert, comme le fait la carte « arm » de Poly Haven
        g = a[..., 0].copy()
        a[..., 0] = 1.0
        a[..., 1] = g
        a[..., 2] = 0.0
    ecrire(os.path.join(SORTIE, '%s_a%s.jpg' % (nom, suffixe)), a)


def main():
    os.makedirs(SORTIE, exist_ok=True)
    for nom, (source, ident, legeres, hd) in MATIERES.items():
        print('==', nom, source, ident)
        fabriquer(nom, source, ident, legeres, '', '1k', '1K')
        fabriquer(nom, source, ident, hd, '_h', '2k', '2K')
    for f in sorted(os.listdir(SORTIE)):
        print('  ', f, os.path.getsize(os.path.join(SORTIE, f)) // 1024, 'Ko')


main()
