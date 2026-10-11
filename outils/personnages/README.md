# Personnages de l'espace des waveurs (Blender)

Fabrique un personnage en ligne de commande (Blender 5.2, `D:\Blender\blender.exe`) :

    blender -b --factory-startup -P outils/personnages/fabriquer.py -- croupier

Variables : `SORTIE` (aperçus PNG), `DEST` (dossier du .glb et des textures, ex. `modeles`), `TEX` (1024), `VOXEL` (0.003), `TRIS` (9000), `APERCUS` (1/0).

Chaîne : formes numpy (repère du jeu) -> remaillage voxel -> décimation -> dépliage maison (uvs.py) -> cuissons (normales, positions, masques, AO) -> peinture numpy (visage.py, habits.py) -> squelette + poids (squelette.py) -> export GLB (sortie.py).
Fiches des personnages : personnages.py (SPECS). Seul `croupier` existe pour l'instant.

Dans le jeu : mettre `modele: 'croupier'` dans `APPARENCES.croupier` (waveurs.js) pour l'activer ; sans cette ligne, le personnage reste celui dessiné par le code.
