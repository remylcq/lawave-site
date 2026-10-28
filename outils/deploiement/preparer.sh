#!/usr/bin/env bash
# Prépare le dossier à envoyer sur l'hébergement : seulement ce que le site sert,
# jamais sql/, outils/, .github/ ni le .htaccess de la racine (celui-ci reste sur le serveur, à la main) ; ceux de modeles/, decor/ et logos/ partent avec leur dossier.
#
# Les adresses des scripts (waveurs.js?v=12, communaute.js?v=3, portail.js?v=1, verification.js?v=1, parcours.js?v=1) reçoivent
# l'empreinte du fichier : dès qu'un script change, son adresse change, et les navigateurs
# ne gardent plus l'ancienne copie. Plus de numéro à augmenter à la main.
#
# Usage : bash outils/deploiement/preparer.sh [dossier-de-sortie]   (par défaut : _publication)
set -euo pipefail

dest="${1:-_publication}"

rm -rf "$dest"
mkdir -p "$dest"

for f in index.html 404.html robots.txt sitemap.xml site.webmanifest waveurs.js communaute.js portail.js sondage.js verification.js parcours.js profil.js xp.js cartes.js accueil.js combat.js combat-pve.js marche.js cartes-equipe.js; do
  [ -f "$f" ] || { echo "Fichier manquant : $f" >&2; exit 1; }
  cp "$f" "$dest/$f"
done

# Les modèles 3D des personnages, s'il y en a.
if [ -d modeles ]; then
  cp -r modeles "$dest/modeles"
fi

# Les matières et les meubles du décor (Poly Haven, ambientCG : CC0), s'il y en a.
if [ -d decor ]; then
  cp -r decor "$dest/decor"
fi

# Les images du site : fond, actualité, icônes, aperçu de partage.
if [ -d img ]; then
  cp -r img "$dest/img"
fi

# Les logos des médias vérifiés posés par l'équipe (voir sql/logo-media.sql), s'il y en a.
if [ -d logos ]; then
  cp -r logos "$dest/logos"
fi

# Three.js et son chargeur glTF, servis avec le site (voir lib/three/LISEZMOI.md).
if [ -d lib ]; then
  cp -r lib "$dest/lib"
fi

for js in waveurs communaute portail sondage verification parcours profil xp cartes accueil combat combat-pve marche cartes-equipe; do
  empreinte=$(sha256sum "$dest/$js.js" | cut -c1-8)
  sed -i -E "s/(${js}\.js\?v=)[0-9A-Za-z]+/\1${empreinte}/g" "$dest/index.html"
  if ! grep -q "${js}\.js?v=${empreinte}" "$dest/index.html"; then
    echo "index.html ne référence pas ${js}.js avec un ?v= : l'adresse versionnée n'a pas pu être posée." >&2
    exit 1
  fi
  echo "${js}.js -> ?v=${empreinte}"
done

# La version du site : une empreinte d'index.html (donc de tous les scripts, dont les adresses portent la leur),
# posée dans sa balise « version-site » et dans version.txt. Le site relit version.txt de temps en temps et propose
# d'actualiser quand elle a changé (voir « MISE À JOUR DISPONIBLE » dans index.html).
version=$(sha256sum "$dest/index.html" | cut -c1-12)
sed -i "s/<meta name=\"version-site\" content=\"dev\">/<meta name=\"version-site\" content=\"${version}\">/" "$dest/index.html"
if ! grep -q "<meta name=\"version-site\" content=\"${version}\">" "$dest/index.html"; then
  echo "index.html n'a pas de balise version-site : la version n'a pas pu être posée." >&2
  exit 1
fi
printf '%s' "$version" > "$dest/version.txt"
echo "version -> ${version}"

echo "Dossier prêt : $dest"
find "$dest" -type f | sort | sed 's/^/  /'
