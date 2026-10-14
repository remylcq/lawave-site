"""Les fiches des personnages : corps (curseurs MakeHuman), peau, visage, cheveux, tenue.

Les curseurs vont de 0 à 1 (genre : homme/femme ; age 0,5 = adulte jeune ; muscle, poids, taille,
proportions : 0,5 = moyen). Couleurs : #rrggbb. Pour un vêtement : `teinte` recolore l'étoffe sombre
(costume), `haut` / `bas` recolorent séparément ce qui est au-dessus et au-dessous de `coupe` (hauteur
en mètres, 0,95 par défaut), `tout` recolore tout.
"""

SPECS = {

    # Derrière la table : un costume noir, une chemise blanche, une cravate et des brassards bordeaux.
    'croupier': dict(
        genre='homme', age=0.55, muscle=0.5, poids=0.45, taille=0.55, proportions=0.5,
        race=dict(caucasian=1.0, asian=0.0, african=0.0),
        peau='young_caucasian_male', peau_teinte='#dba883', peau_force=0.18,
        yeux='brown', sourcils='eyebrow004', cils='eyelashes02',
        cheveux='short04', cheveux_couleur='#5a3f2a',
        vetements=[dict(nom='male_elegantsuit01', teinte='#1c1e26', cravate='#8a1a2e')],
        accessoires=[dict(type='brassards', sur='male_elegantsuit01', couleur='#8a1a2e')],
        chaussures='shoes01', chaussures_couleur='#0d0d0f',
    ),

    # Derrière le comptoir : chemise blanche, pantalon noir, la peau mate.
    'barman': dict(
        genre='homme', age=0.6, muscle=0.6, poids=0.5, taille=0.5, proportions=0.5,
        race=dict(caucasian=0.7, asian=0.3, african=0.0),
        peau='young_caucasian_male2', peau_teinte='#b98866', peau_force=0.3,
        yeux='brown', sourcils='eyebrow002', cils='eyelashes01',
        cheveux='short01', cheveux_couleur='#3a281c',
        vetements=[dict(nom='male_casualsuit01', haut='#f1f2f5', bas='#222228', coupe=0.95)],
        accessoires=[dict(type='gilet', sur='male_casualsuit01', couleur='#6a1a2c')],
        chaussures='shoes01', chaussures_couleur='#0d0d0f',
    ),

    # Au bar, de dos : un costume bleu nuit.
    'costume': dict(
        genre='homme', age=0.5, muscle=0.5, poids=0.45, taille=0.5, proportions=0.5,
        race=dict(caucasian=0.8, asian=0.2, african=0.0),
        peau='young_caucasian_male', peau_teinte='#c98f6b', peau_force=0.4,
        yeux='brown', sourcils='eyebrow001', cils='eyelashes03',
        cheveux='short02', cheveux_couleur='#2a1d14',
        vetements=[dict(nom='male_elegantsuit01', teinte='#34487c')],
        chaussures='shoes01', chaussures_couleur='#0d0d0f',
    ),

    # Au bar, à côté : une robe rouge, les cheveux longs.
    'robe': dict(
        genre='femme', age=0.5, muscle=0.35, poids=0.4, taille=0.45, proportions=0.55,
        race=dict(caucasian=0.8, asian=0.2, african=0.0),
        peau='young_caucasian_female', peau_teinte='#e6b899', peau_force=0.25,
        yeux='brown', sourcils='eyebrow006', cils='eyelashes04',
        cheveux='long01', cheveux_couleur='#2a1a14',
        vetements=[dict(nom='female_elegantsuit01', haut='#c41a3a', bas='#b01631', coupe=1.0)],
        chaussures='shoes01', chaussures_couleur='#5a0f1c',
    ),

    # Au blackjack : un sweat gris.
    'sweat': dict(
        genre='homme', age=0.4, muscle=0.5, poids=0.5, taille=0.5, proportions=0.5,
        race=dict(caucasian=0.0, asian=0.0, african=1.0),
        peau='young_african_male', peau_teinte='#a8714f', peau_force=0.3, yeux='brown', sourcils='eyebrow003', cils='eyelashes02',
        cheveux='short01', cheveux_couleur='#0f0b09',
        vetements=[dict(nom='male_casualsuit02', haut='#80858f', bas='#34466a', coupe=0.95)],
        accessoires=[dict(type='casquette', couleur='#2f6a9c')],
        chaussures='shoes01', chaussures_couleur='#e6e6e6',
    ),

    # Au poker : un blazer vert, les cheveux relevés.
    'blazer': dict(
        genre='femme', age=0.5, muscle=0.35, poids=0.45, taille=0.5, proportions=0.5,
        race=dict(caucasian=1.0, asian=0.0, african=0.0),
        peau='young_caucasian_female2', peau_teinte='#f0c7a8', peau_force=0.25,
        yeux='bluegreen', sourcils='eyebrow005', cils='eyelashes01',
        cheveux='ponytail01', cheveux_couleur='#6d3b1f',
        vetements=[dict(nom='female_elegantsuit01', haut='#2f8a68', bas='#2b2b34', coupe=1.0)],
        chaussures='shoes01', chaussures_couleur='#1b1513',
    ),

    # Au salon : un gilet de laine brun, les cheveux gris.
    'cardigan': dict(
        genre='homme', age=0.85, muscle=0.4, poids=0.7, taille=0.5, proportions=0.45,
        race=dict(caucasian=1.0, asian=0.0, african=0.0),
        peau='old_caucasian_male', yeux='brown', sourcils='eyebrow008', cils='eyelashes01',
        cheveux='short02', cheveux_couleur='#b9b6b0',
        vetements=[dict(nom='male_casualsuit05', teinte='#8a6446', seuil=0.5, bas='#4a4b50', coupe=0.95)],
        accessoires=[dict(type='lunettes')],
        chaussures='shoes01', chaussures_couleur='#2a1d14',
    ),
}
