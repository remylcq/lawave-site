"""Fabrique un personnage : python fabriquer.py -- <nom> (lancé par Blender)."""
import sys, os, time, math, json, importlib
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
import bpy
import formes as F
import bl, sortie as SO, squelette as SQ, perso as PE, peinture as PT, personnages as PERS

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
NOM = args[0] if args else 'croupier'
SORTIE = os.environ.get('SORTIE', os.path.dirname(os.path.abspath(__file__)))
DEST = os.environ.get('DEST', SORTIE)
TEX = int(os.environ.get('TEX', '1024'))
VOXEL = float(os.environ.get('VOXEL', '0.003'))
TRIS = int(os.environ.get('TRIS', '9000'))
APERCUS = os.environ.get('APERCUS', '1') == '1'

spec = PERS.SPECS[NOM]
t0 = time.time()
bl.vider()

orig, haut, bas, noms_m = PE.construire_bas(spec, voxel=VOXEL, tris=TRIS, tex=TEX)
t0 = time.time()

# ------------------------------------------------------------ cuissons
im_n = bl.nouvelle_image('normale', TEX)
bl.cuire(haut, bas, im_n, 'NORMAL')
t0 = bl.chrono('normales', t0)

im_p = bl.nouvelle_image('position', TEX, flottant=True)
bl.cuire(haut, bas, im_p, 'EMIT', materiau_high=bl.mat_emission('pos', PE.fab_position))
t0 = bl.chrono('positions', t0)

masques = {}
for g, idx in enumerate(PE.groupes_classes()):
    im = bl.nouvelle_image('masque%d' % g, TEX)
    bl.cuire(haut, bas, im, 'EMIT', materiau_high=bl.mat_emission('m%d' % g, PE.fab_masque(noms_m[g])), marge=6)
    a = bl.lire_image(im)[:, :, :3]
    for c_i, c in enumerate(idx):
        masques[c] = a[:, :, c_i]
t0 = bl.chrono('masques', t0)

# occlusion ambiante : la haute définition projette son ombre sur la basse
im_ao = bl.nouvelle_image('ao', TEX)
try:
    bpy.context.scene.world = bpy.data.worlds.new('w') if not bpy.context.scene.world else bpy.context.scene.world
    bpy.context.scene.world.light_settings.distance = 0.25
    bl.cuire(haut, bas, im_ao, 'AO', echantillons=96)
    ao = bl.lire_image(im_ao)[:, :, 0]
    # on adoucit le grain de l'échantillonnage
    k = 2
    pad = np.pad(ao, k, mode='edge')
    acc = np.zeros_like(ao)
    for dy in range(-k, k + 1):
        for dx in range(-k, k + 1):
            acc += pad[k + dy:k + dy + ao.shape[0], k + dx:k + dx + ao.shape[1]]
    ao = acc / float((2 * k + 1) ** 2)
except Exception as e:
    print('AO impossible', e)
    ao = np.ones((TEX, TEX), np.float32)
t0 = bl.chrono('occlusion', t0)

Pn = bl.lire_image(im_p)[:, :, :3]
couv = Pn.sum(2) > 1e-6
P = Pn * 4 - 2
Pj = np.stack([P[:, :, 0], P[:, :, 2], -P[:, :, 1]], 2)
nrm = bl.lire_image(im_n)[:, :, :3]
print('texels couverts : %.1f %%' % (100 * couv.mean()))

# ------------------------------------------------------------ peinture
pt = PT.Peintre(Pj, masques, couv, spec, ao)
alb, orm, msk = PERS.peindre(pt, spec)
t0 = bl.chrono('peinture', t0)

os.makedirs(DEST, exist_ok=True)
f_alb = SO.sauver_image(alb, os.path.join(DEST, NOM + '_couleur.jpg'), jpeg=True, qualite=90)
f_nrm = SO.sauver_image(nrm, os.path.join(DEST, NOM + '_normale.jpg'), jpeg=True, qualite=92)
f_orm = SO.sauver_image(orm, os.path.join(DEST, NOM + '_orm.jpg'), jpeg=True, qualite=88)
f_msk = SO.sauver_image(msk, os.path.join(DEST, NOM + '_masque.png'))
t0 = bl.chrono('textures écrites', t0)

m = SO.materiau_final(NOM, f_alb, f_nrm, f_orm, f_msk)
bas.data.materials.clear()
bas.data.materials.append(m)

arm = SO.creer_armature()
SO.poser_poids(bas, arm)
bas.name = NOM
bpy.data.objects.remove(haut, do_unlink=True)
bpy.data.objects.remove(orig, do_unlink=True)

chemin = os.path.join(DEST, NOM + '.glb')
SO.exporter(chemin, [bas, arm])
print('GLB', os.path.getsize(chemin), 'octets')
t0 = bl.chrono('export', t0)

if APERCUS:
    # l'émission du matériau porte le masque de matière (pour le jeu) : pas dans l'aperçu
    for n in m.node_tree.nodes:
        if n.type == 'BSDF_PRINCIPLED':
            n.inputs['Emission Strength'].default_value = 0.0
    bl.decor()
    for nom, loc, cible, focale, res in [
        ('face', (0, -3.6, 1.0), (0, 0, 0.92), 55, (600, 800)),
        ('buste', (0.55, -1.7, 1.55), (0, 0, 1.40), 75, (800, 800)),
        ('tete', (0.30, -1.0, 1.70), (0, 0, 1.68), 90, (800, 800)),
        ('visage', (0.0, -0.9, 1.69), (0, 0, 1.675), 100, (800, 800)),
        ('profil', (0.9, 0.0, 1.69), (0, 0, 1.675), 100, (800, 800)),
        ('dos', (-1.2, 2.0, 1.4), (0, 0, 1.2), 55, (700, 800)),
    ]:
        bl.camera(loc, cible, focale)
        bl.rendre(os.path.join(SORTIE, '%s_%s.png' % (NOM, nom)), res)
    t0 = bl.chrono('aperçus', t0)
