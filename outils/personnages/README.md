# Personnages de l'espace des waveurs (Blender + MakeHuman)

Les sept personnages de la salle (croupier, barman, cinq habitués) sont de vrais corps humains modelés
par **MakeHuman** (extension **MPFB** pour Blender), habillés avec ses vêtements, cheveux, yeux et peaux,
puis liés au squelette de quinze os du jeu. Un fichier par personnage : `modeles/<nom>.glb`.

Sans fichier (ou si le chargement échoue), le personnage reste celui que dessine le code
(`waveurs.js`, classe `Humain`) : la salle fonctionne toujours.

## Ce qu'il faut (une fois)

| Quoi | D'où | Licence |
|---|---|---|
| Blender 5.2 (`D:\Blender\blender.exe`) | blender.org | GPL |
| Extension **MPFB** 2.0.18 | extensions.blender.org/add-ons/mpfb | code GPLv3 |
| Pack **makehuman_system_assets_cc0.zip** (267 Mo : peaux, yeux, cheveux, vêtements, chaussures) | static.makehumancommunity.org/assets/assetpacks | **CC0** (utilisable dans un jeu commercial, sans mention obligatoire) |

Installation de l'extension : `blender -b --command extension install-file -r user_default -e mpfb.zip`.
Le pack d'assets se dézippe dans
`%APPDATA%\Blender Foundation\Blender\5.2\extensions\.user\user_default\mpfb\data\`
(dossiers `clothes`, `hair`, `skins`, `eyes`, `eyebrows`, `eyelashes`, `teeth`, `proxymeshes`...).
La variable `MPFB_DATA` peut désigner un autre dossier. Rien de tout cela n'est dans le dépôt.

## Fabriquer

    blender -b -P outils/personnages/mpfb/fabriquer.py -- croupier

Variables : `SORTIE` (aperçus et `.blend`), `DEST` (dossier du `.glb`, ex. `modeles`), `TEX` (taille des
textures, 1024), `HD=1` (version haute définition : peaux et vêtements en 2048, fichier `<nom>_h.glb` ; le jeu la
prend sur un ordinateur récent, la légère `<nom>.glb` sinon : voir `qualiteHD` dans `waveurs.js`). Une fiche par personnage dans `specs.py` : curseurs MakeHuman (genre, âge, muscle, poids,
taille), peau, yeux, sourcils, cils, cheveux, vêtements (recolorés par zone : `teinte`, `haut`, `bas`),
chaussures, accessoires. Aperçus : `apercus.py` (voir son en-tête).

## Ce que fait la chaîne

1. `HumanService.deserialize_from_dict` crée le corps et ses pièces (squelette `game_engine` de MPFB).
2. Les doigts se plient un peu (repos) ; une forme clé **par main** (`prise_d`, `prise_g`) les referme sur un verre ;
   une forme clé **`clin`** ferme les paupières (corps et cils).
3. Les pièces sont figées (masques appliqués : la peau sous les habits disparaît), les poids du squelette
   MakeHuman sont regroupés sur les **quinze os du jeu** (`bassin, taille, tete, epaule_d/g, coude_d/g, poignet_d/g,
   hanche_d/g, genou_d/g, cheville_d/g`).
4. Matériaux simples (couleur, normale, rugosité) refaits depuis les images (JPEG, cheveux en PNG à alpha).
5. Accessoires modelés (`accessoires.py`) : casquette, lunettes, nœud papillon, gilet, brassards.
6. Export GLB. Le squelette porte en extras (`meta`) la position et l'orientation de chaque os au repos, et le
   point de la bouche : le jeu s'en sert pour lier la peau et caler les gestes (`dimensionsModele`,
   `Humain.lierPeau` dans `waveurs.js`).

## Dans le jeu

`APPARENCES.<nom>.modele` nomme le fichier. Les mesures du squelette (longueur du bras, de la cuisse...) viennent du
fichier ; toute la logique de gestes (cinématique inverse, regard, verre, cartes) est celle des personnages dessinés.
`Humain.serrer(i, k)` referme la main i (0 droite, 1 gauche) ; le clignement passe par la forme clé `clin`.
