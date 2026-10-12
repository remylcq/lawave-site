#!/usr/bin/env bash
# Prépare le dossier à envoyer sur l'hébergement : seulement ce que le site sert,
# jamais sql/, outils/, .github/ ni .htaccess (celui-ci reste sur le serveur, à la main).
#
# Les adresses des scripts (waveurs.js?v=12, communaute.js?v=3, portail.js?v=1) reçoivent
# l'empreinte du fichier : dès qu'un script change, son adresse change, et les navigateurs
# ne gardent plus l'ancienne copie. Plus de numéro à augmenter à la main.
#
# Usage : bash outils/deploiement/preparer.sh [dossier-de-sortie]   (par défaut : _publication)
set -euo pipefail

dest="${1:-_publication}"

rm -rf "$dest"
mkdir -p "$dest"

for f in index.html waveurs.js communaute.js portail.js; do
  [ -f "$f" ] || { echo "Fichier manquant : $f" >&2; exit 1; }
  cp "$f" "$dest/$f"
done

# Les modèles 3D des personnages, s'il y en a.
if [ -d modeles ]; then
  cp -r modeles "$dest/modeles"
fi

for js in waveurs communaute portail; do
  empreinte=$(sha256sum "$dest/$js.js" | cut -c1-8)
  sed -i -E "s/(${js}\.js\?v=)[0-9A-Za-z]+/\1${empreinte}/g" "$dest/index.html"
  if ! grep -q "${js}\.js?v=${empreinte}" "$dest/index.html"; then
    echo "index.html ne référence pas ${js}.js avec un ?v= : l'adresse versionnée n'a pas pu être posée." >&2
    exit 1
  fi
  echo "${js}.js -> ?v=${empreinte}"
done

echo "Dossier prêt : $dest"
find "$dest" -type f | sort | sed 's/^/  /'
