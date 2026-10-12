"""Fabrique un personnage du jeu depuis un corps MakeHuman (MPFB) :

    blender -b -P outils/personnages/mpfb/fabriquer.py -- croupier

Sortie : <DEST>/<nom>.glb (un seul fichier : un squelette de 15 os aux noms du jeu, un maillage par pièce :
corps, vêtements, chaussures, cheveux, yeux, sourcils, cils) et des aperçus PNG dans <SORTIE>.

Variables : SORTIE (aperçus), DEST (dossier du .glb, défaut = SORTIE), TEX (taille des textures, 1024),
APERCUS (1/0), TRIS (nombre de triangles visé pour le corps, 0 = tel quel).
"""
import json
import math
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import numpy as np
import bpy
import bmesh
from mathutils import Vector, Quaternion, Matrix

import mh
import specs
import accessoires as ACC

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
NOM = args[0] if args else 'croupier'
SORTIE = os.environ.get('SORTIE', os.path.dirname(os.path.abspath(__file__)))
DEST = os.environ.get('DEST', SORTIE)
TEX = int(os.environ.get('TEX', '1024'))
APERCUS = os.environ.get('APERCUS', '1') == '1'
TRIS = int(os.environ.get('TRIS', '0'))
spec = specs.SPECS[NOM]

HumanService = mh.activer()
mh.TMP = os.path.join(SORTIE, '_tex', NOM)
from bl_ext.user_default.mpfb.entities.objectproperties import GeneralObjectProperties

t0 = time.time()


def chrono(msg):
    global t0
    print('[%5.1f s] %s' % (time.time() - t0, msg))
    t0 = time.time()


# ------------------------------------------------------------------ 1. le corps MakeHuman

def creer_humain():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    homme = spec['genre'] == 'homme'
    info = HumanService._create_default_human_info_dict()
    info['name'] = NOM
    info['phenotype'] = {
        'gender': 1.0 if homme else 0.0, 'age': spec.get('age', 0.5), 'muscle': spec.get('muscle', 0.5),
        'weight': spec.get('poids', 0.5), 'proportions': spec.get('proportions', 0.5),
        'height': spec.get('taille', 0.5), 'cupsize': 0.5, 'firmness': 0.5, 'race': spec['race']}
    info['rig'] = 'game_engine'
    info['eyes'] = 'low-poly/low-poly.mhclo'
    info['eyebrows'] = '%s/%s.mhclo' % (spec['sourcils'], spec['sourcils'])
    info['eyelashes'] = '%s/%s.mhclo' % (spec['cils'], spec['cils'])
    info['hair'] = '%s/%s.mhclo' % (spec['cheveux'], spec['cheveux']) if spec.get('cheveux') else ''
    info['clothes'] = ['%s/%s.mhclo' % (v['nom'], v['nom']) for v in spec['vetements']]
    if spec.get('chaussures'):
        info['clothes'].append('%s/%s.mhclo' % (spec['chaussures'], spec['chaussures']))
    info['skin_mhmat'] = '%s/%s.mhmat' % (spec['peau'], spec['peau'])
    info['skin_material_type'] = 'GAMEENGINE'
    reg = HumanService.get_default_deserialization_settings()
    reg['subdiv_levels'] = 0
    base = HumanService.deserialize_from_dict(info, reg)
    return base


def pieces(base):
    """{type: objet} : le corps, puis chaque pièce selon son type MPFB."""
    out = {'corps': base, 'vetements': []}
    for o in bpy.data.objects:
        if o.type != 'MESH' or o is base:
            continue
        t = (GeneralObjectProperties.get_value('object_type', entity_reference=o) or '').lower()
        if t == 'eyes':
            out['yeux'] = o
        elif t == 'eyebrows':
            out['sourcils'] = o
        elif t == 'eyelashes':
            out['cils'] = o
        elif t == 'hair':
            out['cheveux'] = o
        elif t == 'clothes':
            out['vetements'].append(o)
        elif t in ('teeth', 'tongue'):
            out.setdefault('bouche', []).append(o)
    return out


# ------------------------------------------------------------------ 2. figer les formes

def figer(obj, nom):
    """Un objet avec tous ses modificateurs appliqués (masques compris), dans l'espace du monde."""
    dep = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(dep)
    me = bpy.data.meshes.new_from_object(ev)
    me.transform(obj.matrix_world)
    nouveau = bpy.data.objects.new(nom, me)
    bpy.context.collection.objects.link(nouveau)
    for g in obj.vertex_groups:
        nouveau.vertex_groups.new(name=g.name)
    for mat in list(me.materials):
        pass
    return nouveau


def retirer_formes(obj):
    """Cuit les curseurs (formes clés) dans le maillage."""
    if obj.data.shape_keys:
        bpy.context.view_layer.objects.active = obj
        for o in bpy.context.selected_objects:
            o.select_set(False)
        obj.select_set(True)
        bpy.ops.object.shape_key_remove(all=True, apply_mix=True)


# ------------------------------------------------------------------ 3. les os du jeu

OS_JEU = ['bassin', 'taille', 'tete', 'epaule_d', 'epaule_g', 'coude_d', 'coude_g', 'poignet_d', 'poignet_g',
          'hanche_d', 'hanche_g', 'genou_d', 'genou_g', 'cheville_d', 'cheville_g']
PARENT_JEU = {'bassin': None, 'taille': 'bassin', 'tete': 'taille', 'epaule_d': 'taille', 'epaule_g': 'taille',
              'coude_d': 'epaule_d', 'coude_g': 'epaule_g', 'poignet_d': 'coude_d', 'poignet_g': 'coude_g',
              'hanche_d': 'bassin', 'hanche_g': 'bassin', 'genou_d': 'hanche_d', 'genou_g': 'hanche_g',
              'cheville_d': 'genou_d', 'cheville_g': 'genou_g'}


def mappage():
    m = {'pelvis': 'bassin', 'spine_01': 'taille', 'spine_02': 'taille', 'spine_03': 'taille',
         'clavicle_l': 'taille', 'clavicle_r': 'taille', 'neck_01': 'tete', 'head': 'tete'}
    for cote, s in (('l', 'g'), ('r', 'd')):
        m['upperarm_' + cote] = 'epaule_' + s
        m['lowerarm_' + cote] = 'coude_' + s
        m['hand_' + cote] = 'poignet_' + s
        for doigt in ('index', 'middle', 'ring', 'pinky', 'thumb'):
            for k in (1, 2, 3):
                m['%s_0%d_%s' % (doigt, k, cote)] = 'poignet_' + s
        m['thigh_' + cote] = 'hanche_' + s
        m['calf_' + cote] = 'genou_' + s
        m['foot_' + cote] = 'cheville_' + s
        m['ball_' + cote] = 'cheville_' + s
    return m


def poser_poids_jeu(obj):
    """Regroupe les poids du squelette MakeHuman sur les 15 os du jeu (4 influences au plus)."""
    mp = mappage()
    noms = {g.index: g.name for g in obj.vertex_groups}
    nouveaux = {}
    for v in obj.data.vertices:
        acc = {}
        for g in v.groups:
            n = mp.get(noms[g.group])
            if n and g.weight > 1e-4:
                acc[n] = acc.get(n, 0.0) + g.weight
        if not acc:
            continue
        top = sorted(acc.items(), key=lambda t: -t[1])[:4]
        tot = sum(w for _, w in top)
        nouveaux[v.index] = [(n, w / tot) for n, w in top if w / tot > 0.01]
    for g in list(obj.vertex_groups):
        obj.vertex_groups.remove(g)
    vgs = {n: obj.vertex_groups.new(name=n) for n in OS_JEU}
    for i, lst in nouveaux.items():
        for n, w in lst:
            vgs[n].add([i], w, 'REPLACE')
    manquants = len(obj.data.vertices) - len(nouveaux)
    if manquants:
        print('   ATTENTION', obj.name, ':', manquants, 'sommets sans poids')


def positions_mpfb(rig):
    """Les articulations du squelette MakeHuman, dans le repère du jeu."""
    def tete(n):
        return mh.a_jeu(rig.matrix_world @ rig.data.bones[n].head_local)
    P = {'bassin': tete('pelvis'), 'taille': tete('spine_01'), 'tete': tete('neck_01')}
    for cote, s in (('l', 'g'), ('r', 'd')):
        P['epaule_' + s] = tete('upperarm_' + cote)
        P['coude_' + s] = tete('lowerarm_' + cote)
        P['poignet_' + s] = tete('hand_' + cote)
        P['hanche_' + s] = tete('thigh_' + cote)
        P['genou_' + s] = tete('calf_' + cote)
        P['cheville_' + s] = tete('foot_' + cote)
        for doigt in ('index', 'middle', 'pinky', 'thumb'):
            P['%s_%s' % (doigt, s)] = tete('%s_01_%s' % (doigt, cote))
        P['bout_%s' % s] = mh.a_jeu(rig.matrix_world @ rig.data.bones['middle_03_' + cote].tail_local)
        P['orteil_' + s] = mh.a_jeu(rig.matrix_world @ rig.data.bones['ball_' + cote].tail_local)
    return P


def preparer_clignement(base):
    """Les deux paupières de MakeHuman (unités de visage « closure »), chargées en formes clés à 0."""
    from bl_ext.user_default.mpfb.services.targetservice import TargetService
    from bl_ext.user_default.mpfb.services.locationservice import LocationService
    dossier = os.path.join(LocationService.get_mpfb_data('targets'), 'expression', 'units', 'caucasian')
    for cote in ('left', 'right'):
        TargetService.load_target(base, os.path.join(dossier, 'eye-%s-closure.target.gz' % cote), weight=0.0, name='clin_' + cote)


def valeur_clignement(base, v):
    for k in base.data.shape_keys.key_blocks:
        if k.name.startswith('clin_'):
            k.value = v


def recoller(piece, base):
    """Refait coller un accessoire (cils) au corps, tel qu'il est maintenant."""
    from bl_ext.user_default.mpfb.services.clothesservice import ClothesService
    ClothesService.fit_clothes_to_human(piece, base, set_parent=False)
    bpy.context.view_layer.update()


REPOS_DOIGTS = 0.30     # les doigts au repos : à peine repliés
PRISE_DOIGTS = 0.78     # la main qui tient un verre


def poser_doigts(rig, cotes_pris=()):
    """Plie les doigts du squelette MakeHuman : au repos partout, serrés pour les côtés de `cotes_pris`."""
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode='POSE')
    for pb in rig.pose.bones:
        n = pb.name
        cote = n[-1] if n[-2:] in ('_l', '_r') else None
        if cote is None:
            continue
        k = PRISE_DOIGTS if cote in cotes_pris else REPOS_DOIGTS
        pb.rotation_mode = 'XYZ'
        if n.startswith(('index', 'middle', 'ring', 'pinky')):
            pb.rotation_euler = (k, 0, 0)
        elif n.startswith('thumb'):
            pb.rotation_euler = (0, 0, k * 0.35)
    bpy.ops.object.mode_set(mode='OBJECT')
    bpy.context.view_layer.update()


def centre_groupe(base, nom):
    gi = base.vertex_groups[nom].index
    pts = [base.matrix_world @ v.co for v in base.data.vertices if any(g.group == gi and g.weight > 0.5 for g in v.groups)]
    return sum(pts, Vector()) / len(pts)


def point_bouche(base):
    """Le milieu des lèvres, dans le repère du jeu."""
    gi = base.vertex_groups['lips'].index
    pts = [base.matrix_world @ v.co for v in base.data.vertices if any(g.group == gi and g.weight > 0.5 for g in v.groups)]
    return mh.a_jeu(sum(pts, Vector()) / len(pts))


def devant_col(objets):
    """Le point le plus en avant du col, sur l'axe du corps (repère Blender)."""
    meilleur = None
    for cle, o in objets.items():
        if not cle.startswith('vet:'):
            continue
        for v in o.data.vertices:
            if abs(v.co.x) < 0.014 and 1.42 < v.co.z < 1.50:
                if meilleur is None or v.co.y < meilleur.y:
                    meilleur = v.co.copy()
    return meilleur if meilleur is not None else Vector((0, -0.075, 1.465))


def reperes_jeu(P):
    """Le repos de chaque os (position, quaternion) tel que le jeu l'attend : l'axe -y d'un membre suit le
    membre, une main à plat a ses doigts sur -y et sa paume sur +x (main droite)."""
    R = {}
    for n in OS_JEU:
        R[n] = (Vector(P[n]), Quaternion((1, 0, 0, 0)))
    # on garde le plan de symétrie : x = 0 pour le bassin, la taille et la tête
    for n in ('bassin', 'taille', 'tete'):
        R[n] = (Vector((0, P[n].y, 0)), Quaternion((1, 0, 0, 0)))
    for s in ('d', 'g'):
        R['epaule_' + s] = (P['epaule_' + s], mh.rotation_vers(P['coude_' + s] - P['epaule_' + s]))
        R['coude_' + s] = (P['coude_' + s], mh.rotation_vers(P['poignet_' + s] - P['coude_' + s]))
        # la main : doigts le long de -y, paume sur +x (droite) ou -x (gauche)
        f = (P['middle_' + s] - P['poignet_' + s]).normalized()
        p = P['pinky_' + s] - P['index_' + s]
        n_paume = p.cross(f) if s == 'd' else f.cross(p)
        x = n_paume if s == 'd' else -n_paume
        x, y, z = mh.orthonormer(x, -f)
        R['poignet_' + s] = (P['poignet_' + s], mh.quaternion_axes(x, y, z))
        R['hanche_' + s] = (P['hanche_' + s], mh.rotation_vers(P['genou_' + s] - P['hanche_' + s]))
        R['genou_' + s] = (P['genou_' + s], mh.rotation_vers(P['cheville_' + s] - P['genou_' + s]))
        R['cheville_' + s] = (P['cheville_' + s], Quaternion((1, 0, 0, 0)))
    return R


def creer_armature(R):
    arm_d = bpy.data.armatures.new('jeu')
    arm = bpy.data.objects.new('jeu', arm_d)
    bpy.context.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='EDIT')
    eb = {}
    for n in OS_JEU:
        b = arm_d.edit_bones.new(n)
        pos, q = R[n]
        # repère Blender : x = jeu.x, y = -jeu.z, z = jeu.y
        hb = Vector((pos.x, -pos.z, pos.y))
        b.head = hb
        axe = (q @ Vector((0, -1, 0)))
        ab = Vector((axe.x, -axe.z, axe.y))
        if n in ('bassin', 'taille', 'tete'):
            ab = Vector((0, 0, 1))
        b.tail = hb + ab.normalized() * 0.06
        eb[n] = b
    for n, p in PARENT_JEU.items():
        if p:
            eb[n].parent = eb[p]
    bpy.ops.object.mode_set(mode='OBJECT')
    return arm


# ------------------------------------------------------------------ 4. les matériaux

def eclaircir_textures():
    pass


def texture_peau():
    mat = mh.lire_mhmat(os.path.join(mh.dossier_donnees(), 'skins', spec['peau'], spec['peau'] + '.mhmat'))
    a = mh.charger_tableau(mat['diffuseTexture'], spec.get('tex_peau', TEX))
    return a


def fabriquer_materiaux(P, objets, partage):
    mats = {}
    donnees = mh.dossier_donnees()
    # peau
    a = texture_peau()
    a[..., 3] = 1
    if spec.get('peau_teinte'):
        a = mh.teinter_tout(a, mh.hex_rgb(spec['peau_teinte']), force=spec.get('peau_force', 0.5))
    mats['corps'] = mh.materiau(NOM + '_peau', mh.image_depuis_tableau(NOM + '_peau', a), rugosite=0.58, spec=0.35)
    # yeux
    yeux = mh.lire_mhmat(os.path.join(donnees, 'eyes', 'materials', spec['yeux'] + '.mhmat'))
    ay = mh.charger_tableau(yeux['diffuseTexture'], 256)
    mats['yeux'] = mh.materiau(NOM + '_yeux', mh.image_depuis_tableau(NOM + '_yeux', ay), rugosite=0.12, spec=0.9)
    # sourcils, cils
    for cle, dossier in (('sourcils', 'eyebrows'), ('cils', 'eyelashes')):
        nom = spec[cle]
        m = mh.lire_mhmat(os.path.join(donnees, dossier, nom, nom + '.mhmat'))
        t = mh.charger_tableau(m['diffuseTexture'], 512)
        if cle == 'sourcils' and spec.get('cheveux_couleur'):
            t = mh.teinter_tout(t, mh.hex_rgb(spec['cheveux_couleur']), force=0.9)
        mats[cle] = mh.materiau(NOM + '_' + cle, mh.image_depuis_tableau(NOM + '_' + cle, t, jpeg=False), rugosite=0.7,
                                alpha=True, double_face=True)
    # cheveux
    if spec.get('cheveux'):
        nom = spec['cheveux']
        m = mh.lire_mhmat(os.path.join(donnees, 'hair', nom, nom + '.mhmat'))
        t = mh.charger_tableau(m['diffuseTexture'], 512)
        if spec.get('cheveux_couleur'):
            t = mh.teinter_tout(t, mh.hex_rgb(spec['cheveux_couleur']), force=1.0)
        mats['cheveux'] = mh.materiau(NOM + '_cheveux', mh.image_depuis_tableau(NOM + '_cheveux', t, jpeg=False), rugosite=0.5,
                                      alpha=True, double_face=True, seuil=0.45)
    # vêtements et chaussures
    habits = list(spec['vetements'])
    if spec.get('chaussures'):
        habits.append(dict(nom=spec['chaussures'], tout=spec.get('chaussures_couleur')))
    for v in habits:
        nom = v['nom']
        m = mh.lire_mhmat(os.path.join(donnees, 'clothes', nom, nom + '.mhmat'))
        t0 = mh.charger_tableau(m['diffuseTexture'], TEX)
        if v.get('sans_cravate'):
            # la cravate du costume, dans le dépliage de male_elegantsuit01 : on la peint comme la chemise
            t0 = mh.blanchir_rect(t0, 0.344, 0.408, 0.815, 0.93)
        nrm = None
        if 'normalmapTexture' in m and os.path.exists(m['normalmapTexture']):
            nrm = mh.image_depuis_tableau(nom + '_n', mh.charger_tableau(m['normalmapTexture'], TEX), couleur=False)
        liste = []
        variantes = [('haut', v.get('haut')), ('bas', v.get('bas'))] if (v.get('haut') or v.get('bas')) else [('', None)]
        objet = objets.get('vet:' + nom)
        for idx, (suffixe, couleur) in enumerate(variantes):
            t = t0
            if v.get('teinte'):
                t = mh.teinter(t, mh.hex_rgb(v['teinte']), seuil_lum=v.get('seuil', 0.34))
            if v.get('tout'):
                t = mh.teinter_tout(t, mh.hex_rgb(v['tout']), force=v.get('force', 1.0))
            if couleur:
                faces = [i for i, k in enumerate(partage[objet.name]) if k == idx]
                msk = mh.masque_uv(objet.data, faces, TEX)
                print('   REGION', nom, suffixe, 'faces', len(faces), 'pixels', int(msk.sum()), 'lum', float(mh.luminance(t0)[msk].mean()) if msk.any() else None)
                t = mh.teinter_region(t, msk, mh.hex_rgb(couleur), force=v.get('force', 1.0))
            liste.append(mh.materiau('%s_%s%s' % (NOM, nom, suffixe), mh.image_depuis_tableau(nom + '_c' + suffixe, t), nrm,
                                     rugosite=0.75 if nrm is None else 0.55, spec=0.2))
        mats['vet:' + nom] = liste
    return mats


# ------------------------------------------------------------------ export

def exporter(arm, meshes):
    os.makedirs(DEST, exist_ok=True)
    for o in bpy.context.selected_objects:
        o.select_set(False)
    for o in [arm] + meshes:
        o.select_set(True)
    chemin = os.path.join(DEST, NOM + '.glb')
    bpy.ops.export_scene.gltf(
        filepath=chemin, export_format='GLB', use_selection=True, export_apply=False, export_yup=True,
        export_texcoords=True, export_normals=True, export_tangents=False, export_materials='EXPORT',
        export_image_format='AUTO', export_jpeg_quality=85, export_skins=True, export_def_bones=False,
        export_extras=True, export_cameras=False, export_lights=False, export_animations=False,
        export_morph=True, export_morph_normal=False)
    print('GLB', chemin, '%.0f Ko' % (os.path.getsize(chemin) / 1024))


# ------------------------------------------------------------------ principal

def principal():
    base = creer_humain()
    chrono('humain créé')
    rig = base.parent
    P = positions_mpfb(rig)
    R = reperes_jeu(P)

    ps = pieces(base)
    # les formes clés du corps (curseurs) sont cuites ; le masque cache ce qui est sous les habits
    retirer_formes(base)
    bouche = point_bouche(base)
    yeux = (centre_groupe(base, 'joint-l-eye'), centre_groupe(base, 'joint-r-eye'))
    preparer_clignement(base)
    poser_doigts(rig)
    objets = {}
    objets['corps'] = figer(base, NOM + '_corps')
    for i, o in enumerate(ps['vetements']):
        objets['vet:%s' % o.name.split('.')[-1]] = figer(o, NOM + '_' + o.name.split('.')[-1])
    for cle in ('yeux', 'sourcils', 'cils', 'cheveux'):
        if cle in ps:
            objets[cle] = figer(ps[cle], NOM + '_' + cle)
    # une forme clé par main : les doigts serrés autour d'un verre
    corps = objets['corps']
    corps.shape_key_add(name='Basis')
    for cote, nom in (('l', 'prise_g'), ('r', 'prise_d')):
        poser_doigts(rig, cotes_pris=(cote,))
        tmp = figer(base, 'tmp')
        sk = corps.shape_key_add(name=nom)
        sk.value = 0.0
        for i, v in enumerate(tmp.data.vertices):
            sk.data[i].co = v.co
        bpy.data.objects.remove(tmp, do_unlink=True)
    # le clignement : le corps et les cils, paupières fermées
    poser_doigts(rig)
    valeur_clignement(base, 1.0)
    if 'cils' in ps:
        recoller(ps['cils'], base)
    for cle, src in (('corps', base), ('cils', ps.get('cils'))):
        if src is None:
            continue
        o = objets[cle]
        if not o.data.shape_keys:
            o.shape_key_add(name='Basis')
        tmp = figer(src, 'tmp')
        sk = o.shape_key_add(name='clin')
        ecart = 0.0
        for i, v in enumerate(tmp.data.vertices):
            ecart = max(ecart, (v.co - sk.data[i].co).length)
            sk.data[i].co = v.co
        print('   clignement', cle, 'écart max %.1f mm' % (ecart * 1000))
        for k in o.data.shape_keys.key_blocks:
            if k.name != 'Basis':
                k.value = 0.0
        bpy.data.objects.remove(tmp, do_unlink=True)
    valeur_clignement(base, 0.0)
    chrono('formes figées')

    for k, o in objets.items():
        print('  ', k, len(o.data.vertices), 'sommets', len(o.data.polygons), 'faces')

    # poids sur les os du jeu
    for o in objets.values():
        poser_poids_jeu(o)
    chrono('poids')

    # la nouvelle armature, les anciens objets disparaissent
    arm = creer_armature(R)
    partage = {}
    for v in spec['vetements']:
        if v.get('haut') or v.get('bas'):
            o = objets['vet:' + v['nom']]
            z = v.get('coupe', 0.95)
            partage[o.name] = [0 if sum(o.data.vertices[i].co.z for i in f.vertices) / len(f.vertices) > z else 1
                               for f in o.data.polygons]
    mats = fabriquer_materiaux(P, objets, partage)
    chrono('matériaux')
    coupes = {('vet:' + v['nom']): v.get('coupe', 0.95) for v in spec['vetements']}
    for cle, o in objets.items():
        if cle.startswith('acc'):
            continue
        o.data.materials.clear()
        m = mats[cle]
        for mm in (m if isinstance(m, list) else [m]):
            o.data.materials.append(mm)
        if o.name in partage:
            for f, k in zip(o.data.polygons, partage[o.name]):
                f.material_index = k
        o.parent = arm
        md = o.modifiers.new('Armature', 'ARMATURE')
        md.object = arm
    supplements = []
    for acc in spec.get('accessoires', []):
        t = acc['type']
        if t == 'casquette':
            o = ACC.casquette(acc['couleur'], objets['cheveux'], yeux[0].z)
        elif t == 'lunettes':
            o = ACC.lunettes(yeux[0], yeux[1])
        elif t == 'noeud':
            o = ACC.noeud_papillon(devant_col(objets), acc['couleur'])
        elif t == 'gilet':
            src = objets['vet:' + acc['sur']]
            o = ACC.gilet(src, acc['couleur'])
            ACC.copier_poids_proches(o, src)
            ACC.materiau_uni(o, acc['couleur'], rugosite=0.5)
        elif t == 'brassards':
            src = objets['vet:' + acc['sur']]
            for cote in ('d', 'g'):
                e = mh.a_jeu_inverse(R['epaule_' + cote][0])
                c = mh.a_jeu_inverse(R['coude_' + cote][0])
                b = ACC.brassard(src, e, c, acc['couleur'], 'epaule_' + cote)
                supplements.append(b)
            continue
        else:
            continue
        supplements.append(o)
    for o in supplements:
        o.parent = arm
        md = o.modifiers.new('Armature', 'ARMATURE')
        md.object = arm
    objets.update({'acc%d' % i: o for i, o in enumerate(supplements)})
    for o in [base, rig] + list(ps['vetements']) + [ps[c] for c in ('yeux', 'sourcils', 'cils', 'cheveux', 'bouche') if c in ps and not isinstance(ps[c], list)]:
        pass
    # on supprime tout ce qui vient de MPFB
    for o in list(bpy.data.objects):
        if o not in objets.values() and o is not arm:
            bpy.data.objects.remove(o, do_unlink=True)
    chrono('assemblage')

    meta = dict(os={n: dict(p=[round(c, 5) for c in R[n][0]], q=[round(R[n][1].x, 6), round(R[n][1].y, 6), round(R[n][1].z, 6), round(R[n][1].w, 6)]) for n in OS_JEU})
    meta['bouche'] = [round(c, 5) for c in bouche]
    arm['meta'] = json.dumps(meta)

    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(SORTIE, NOM + '_mpfb.blend'))
    chrono('sauvé')
    exporter(arm, list(objets.values()))
    chrono('exporté')


principal()
