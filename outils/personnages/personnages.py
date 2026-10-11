"""Les personnages : leurs fiches (couleurs, coiffure, tenue) et leur peinture."""
import math
import numpy as np
import formes as F
import peinture as PT
from peinture import hexrgb, melange, sm, gauss

SPECS = {
    'croupier': dict(
        femme=False, peau='#dba883', cheveux='#4b3523', yeux='#4a3a2a', barbe=1, coiffure='rejete',
        tenue='gilet', chemise='#eef1f6', veste='#15171d', pantalon='#101116', chaussures='#060606',
        noeud='#0d0e12', manches=True, brassard='#7a1526', boutons='#2d3038', sourire=0.85),
}


def peindre(pt, spec):
    """Retourne (albédo sRGB, ORM, masque) ; trois tableaux (h, w, 3)."""
    import visage, habits
    pt.base()
    visage.tout(pt, spec)
    habits.tout(pt, spec)
    h, w = pt.h, pt.w
    ao = np.clip(pt.ao, 0, 1)
    alb = pt.alb * (0.80 + 0.20 * ao)[:, :, None]
    orm = np.zeros((h, w, 3), np.float32)
    orm[:, :, 0] = ao
    orm[:, :, 1] = np.clip(pt.rug, 0.05, 1)
    orm[:, :, 2] = np.clip(pt.met, 0, 1)
    msk = np.zeros((h, w, 3), np.float32)
    msk[:, :, 0] = np.clip(pt.m('peau') + pt.m('main') - pt.m_cheveux, 0, 1)
    msk[:, :, 1] = np.clip(pt.m_cheveux, 0, 1)
    msk[:, :, 2] = np.clip(pt.m('chaussure') + pt.m('ceinture') + pt.m('noeud') + pt.m_brillant, 0, 1)
    return np.clip(alb, 0, 1), np.clip(orm, 0, 1), np.clip(msk, 0, 1)
