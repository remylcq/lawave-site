"""Aides MPFB (MakeHuman pour Blender) : activation, ressources, matériaux, images, maths.

Tout ici tourne dans Blender (bpy). Repère : Blender est (x, y, z) avec Z en haut et le visage vers -Y ;
le jeu est (x, y, z) = (X, Z, -Y), avec le visage vers +z (c'est aussi le repère de l'export glTF).
"""
import math
import os
import sys

import numpy as np
import bpy
from mathutils import Matrix, Quaternion, Vector

MODULE = 'bl_ext.user_default.mpfb'


def activer():
    """Active l'extension MPFB (une fois) et renvoie ses services utiles."""
    if MODULE not in sys.modules:
        bpy.ops.preferences.addon_enable(module=MODULE)
    from bl_ext.user_default.mpfb.services.humanservice import HumanService
    return HumanService


def dossier_donnees():
    """Où MPFB range ses ressources (peaux, vêtements, cheveux...)."""
    d = os.environ.get('MPFB_DATA')
    if d and os.path.isdir(d):
        return d
    base = bpy.utils.user_resource('EXTENSIONS')
    for chemin in (os.path.join(base, '.user', 'user_default', 'mpfb', 'data'),
                   os.path.join(os.path.dirname(base), 'extensions', '.user', 'user_default', 'mpfb', 'data')):
        if os.path.isdir(chemin):
            return chemin
    raise RuntimeError('ressources MPFB introuvables (variable MPFB_DATA)')


def a_jeu(v):
    """Un point Blender -> repère du jeu."""
    return Vector((v[0], v[2], -v[1]))


def lire_mhmat(chemin):
    """Les lignes utiles d'un fichier .mhmat : dict (texture diffuse, normale, transparent...)."""
    d = {}
    base = os.path.dirname(chemin)
    with open(chemin, encoding='utf-8') as f:
        for ligne in f:
            ligne = ligne.strip()
            if not ligne or ligne.startswith(('#', '//')):
                continue
            cle, _, reste = ligne.partition(' ')
            reste = reste.strip()
            if cle in ('diffuseTexture', 'normalmapTexture', 'bumpTexture', 'transparencyMapTexture'):
                d[cle] = os.path.join(base, reste)
            elif cle in ('shininess', 'opacity'):
                d[cle] = float(reste)
            elif cle in ('transparent', 'backfaceCull', 'alphaToCoverage'):
                d[cle] = reste.lower() == 'true'
            elif cle in ('diffuseColor', 'specularColor'):
                d[cle] = tuple(float(x) for x in reste.split())
    return d


# ------------------------------------------------------------------ images

def charger_tableau(chemin, taille=None):
    """Une image -> tableau float32 (h, w, 4) en sRGB (comme dans le fichier), mise à `taille` si on la donne."""
    im = bpy.data.images.load(chemin, check_existing=False)
    try:
        if taille and (im.size[0] != taille or im.size[1] != taille):
            im.scale(taille, taille)
        w, h = im.size
        a = np.empty(w * h * 4, np.float32)
        im.pixels.foreach_get(a)
        a = a.reshape(h, w, 4)
        # Blender relit un PNG sRGB en linéaire pour ses calculs ; les pixels bruts sont déjà ceux du fichier
        # tant que l'image est en espace "sRGB" et non en flottant : ce sont donc les valeurs du fichier.
        if im.colorspace_settings.name == 'sRGB':
            a = lin_vers_srgb(a)
        return a
    finally:
        bpy.data.images.remove(im)


def lin_vers_srgb(a):
    out = a.copy()
    c = np.clip(out[..., :3], 0, 1)
    out[..., :3] = np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)
    return out


def srgb_vers_lin(a):
    out = a.copy()
    c = np.clip(out[..., :3], 0, 1)
    out[..., :3] = np.where(c <= 0.04045, c / 12.92, np.power((c + 0.055) / 1.055, 2.4))
    return out


TMP = os.environ.get('TMP_TEX') or os.path.join(os.environ.get('SORTIE', os.path.dirname(os.path.abspath(__file__))), '_tex')


def image_depuis_tableau(nom, a, couleur=True, jpeg=True, qualite=88):
    """Un tableau sRGB (h, w, 4) -> image Blender relue d'un fichier (JPEG ou PNG), pour que l'export glTF
    reprenne le fichier tel quel (un JPEG de 150 Ko au lieu d'un PNG de 3 Mo)."""
    os.makedirs(TMP, exist_ok=True)
    h, w = a.shape[:2]
    im = bpy.data.images.new(nom + '_src', w, h, alpha=True)
    im.colorspace_settings.name = 'sRGB' if couleur else 'Non-Color'
    buf = a.astype(np.float32)
    if couleur:
        buf = srgb_vers_lin(buf)
    im.pixels.foreach_set(buf.ravel())
    im.update()
    sc = bpy.context.scene
    st = sc.render.image_settings
    st.file_format = 'JPEG' if jpeg else 'PNG'
    st.color_mode = 'RGB' if jpeg else 'RGBA'
    if jpeg:
        st.quality = qualite
    chemin = os.path.join(TMP, nom + ('.jpg' if jpeg else '.png'))
    im.save_render(chemin, scene=sc)
    bpy.data.images.remove(im)
    out = bpy.data.images.load(chemin)
    out.name = nom
    out.colorspace_settings.name = 'sRGB' if couleur else 'Non-Color'
    return out


def luminance(a):
    return 0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]


def teinter(a, couleur, seuil_lum=0.34, seuil_sat=0.30, force=1.0):
    """Recolore ce qui est sombre et peu saturé (étoffe d'un costume) sans toucher au reste (chemise,
    cravate, boutons) : la couleur garde la lumière du tissu d'origine."""
    out = a.copy()
    rgb = a[..., :3]
    mx, mn = rgb.max(axis=2), rgb.min(axis=2)
    sat = (mx - mn) / np.maximum(mx, 1e-4)
    lum = luminance(a)
    masque = np.clip((seuil_lum - lum) / 0.08, 0, 1) * np.clip((seuil_sat - sat) / 0.10, 0, 1) * force
    ref = 0.16
    cible = np.clip(np.array(couleur, np.float32)[None, None, :] * (lum[..., None] / ref), 0, 1)
    out[..., :3] = rgb * (1 - masque[..., None]) + cible * masque[..., None]
    return out


def teinter_tout(a, couleur, force=1.0, ref=None):
    """Recolore toute l'image en gardant la lumière d'origine (cheveux, tissu uni)."""
    out = a.copy()
    lum = luminance(a)
    if ref is None:
        utile = (a[..., 3] > 0.5) & (lum > 0.10)
        ref = float(np.mean(lum[utile])) if utile.any() else 0.5
    cible = np.clip(np.array(couleur, np.float32)[None, None, :] * (lum[..., None] / max(ref, 1e-3)), 0, 1)
    out[..., :3] = a[..., :3] * (1 - force) + cible * force
    return out


def masque_uv(me, indices_faces, taille):
    """Les pixels de la texture (taille x taille) que recouvrent ces faces dans le dépliage UV."""
    uv = me.uv_layers.active.data
    m = np.zeros((taille, taille), bool)
    for fi in indices_faces:
        poly = me.polygons[fi]
        pts = np.array([uv[li].uv[:] for li in range(poly.loop_start, poly.loop_start + poly.loop_total)], np.float64) * taille
        for k in range(1, len(pts) - 1):
            _remplir(m, pts[0], pts[k], pts[k + 1])
    return m


def _remplir(m, a, b, c):
    x0 = int(max(0, math.floor(min(a[0], b[0], c[0]))))
    x1 = int(min(m.shape[1] - 1, math.ceil(max(a[0], b[0], c[0]))))
    y0 = int(max(0, math.floor(min(a[1], b[1], c[1]))))
    y1 = int(min(m.shape[0] - 1, math.ceil(max(a[1], b[1], c[1]))))
    if x1 < x0 or y1 < y0:
        return
    xs, ys = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
    d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
    if abs(d) < 1e-12:
        return
    l1 = ((b[1] - c[1]) * (xs - c[0]) + (c[0] - b[0]) * (ys - c[1])) / d
    l2 = ((c[1] - a[1]) * (xs - c[0]) + (a[0] - c[0]) * (ys - c[1])) / d
    l3 = 1 - l1 - l2
    ok = (l1 >= -0.02) & (l2 >= -0.02) & (l3 >= -0.02)
    m[y0:y1 + 1, x0:x1 + 1] |= ok


def teinter_region(a, masque, couleur, force=1.0):
    """Recolore seulement les pixels du masque, en gardant les lumières et les motifs du tissu :
    la couleur moyenne de la région devient `couleur`."""
    out = a.copy()
    lum = luminance(a)
    zone = masque & (lum > 0.03)
    ref = float(np.mean(lum[zone])) if zone.any() else 0.3
    cible = np.clip(np.array(couleur, np.float32)[None, None, :] * (lum[..., None] / max(ref, 1e-3)), 0, 1)
    k = (masque.astype(np.float32) * force)[..., None]
    out[..., :3] = a[..., :3] * (1 - k) + cible * k
    return out


def hex_rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4))


# ------------------------------------------------------------------ matériaux

def materiau(nom, couleur_img, normale_img=None, rugosite=0.6, metal=0.0, alpha=False, double_face=False,
             seuil=0.5, spec=0.3):
    m = bpy.data.materials.new(nom)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes.get('Principled BSDF')
    bsdf.inputs['Roughness'].default_value = rugosite
    bsdf.inputs['Metallic'].default_value = metal
    try:
        bsdf.inputs['Specular IOR Level'].default_value = spec
    except KeyError:
        pass
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = couleur_img
    nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    if alpha:
        nt.links.new(tex.outputs['Alpha'], bsdf.inputs['Alpha'])
        try:
            m.blend_method = 'CLIP'
            m.alpha_threshold = seuil
        except Exception:
            pass
        try:
            m.surface_render_method = 'DITHERED'
        except Exception:
            pass
    if normale_img is not None:
        nm = nt.nodes.new('ShaderNodeTexImage')
        nm.image = normale_img
        nm.image.colorspace_settings.name = 'Non-Color'
        nn = nt.nodes.new('ShaderNodeNormalMap')
        nt.links.new(nm.outputs['Color'], nn.inputs['Color'])
        nt.links.new(nn.outputs['Normal'], bsdf.inputs['Normal'])
    m.use_backface_culling = not double_face
    return m


# ------------------------------------------------------------------ maths de pose

def lacet(d):
    return d


def rotation_vers(d, de=Vector((0, -1, 0))):
    """La rotation minimale qui amène `de` (par défaut -y, l'axe des membres du jeu) sur la direction d."""
    d = Vector(d).normalized()
    return de.rotation_difference(d)


def quaternion_axes(x, y, z):
    """Un quaternion depuis trois axes (colonnes) orthonormés, dans le repère du jeu."""
    m = Matrix(((x[0], y[0], z[0]), (x[1], y[1], z[1]), (x[2], y[2], z[2])))
    return m.to_quaternion()


def orthonormer(x, y):
    """Trois axes orthonormés droits (x, y, z) à partir de deux directions (y prioritaire)."""
    y = Vector(y).normalized()
    x = (Vector(x) - y * Vector(x).dot(y)).normalized()
    z = x.cross(y).normalized()
    return x, y, z
