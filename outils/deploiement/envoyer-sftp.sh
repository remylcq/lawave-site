#!/usr/bin/env bash
# Envoie le dossier préparé (preparer.sh) dans le dossier du site par SFTP, c'est-à-dire par SSH :
# l'hébergement OVH refuse le FTP chiffré (AUTH TLS), mais accepte le SSH sur le port 22.
#
# Sécurité :
#  - l'empreinte du serveur est vérifiée contre ovh_known_hosts (à côté de ce script) ; si elle ne
#    correspond pas, la connexion est refusée et le mot de passe n'est jamais envoyé ;
#  - le mot de passe passe par l'environnement (sshpass -e), jamais par une ligne de commande ni un fichier ;
#  - le script n'affiche jamais l'identifiant, le mot de passe ni le serveur : le dépôt est public, ses
#    journaux aussi, et GitHub ne masque une valeur secrète que si elle apparaît en entier.
# Rien n'est supprimé sur le serveur : .htaccess, musique/, etc. ne sont pas touchés.
#
# Entrées (variables d'environnement) : FTP_SERVER, FTP_USERNAME, FTP_PASSWORD, FTP_DOSSIER (www/ par
# défaut), ESSAI=true pour vérifier la connexion et lister sans rien envoyer.
# Usage : bash outils/deploiement/envoyer-sftp.sh [dossier-prepare]   (par défaut : _publication)
set -euo pipefail

src="${1:-_publication}"
dossier="${FTP_DOSSIER:-www/}"
: "${FTP_SERVER:?FTP_SERVER manquant}" "${FTP_USERNAME:?FTP_USERNAME manquant}" "${FTP_PASSWORD:?FTP_PASSWORD manquant}"

[ -d "$src" ] || { echo "Dossier à envoyer introuvable : $src" >&2; exit 1; }
case "$dossier" in
  *[!A-Za-z0-9._/-]*) echo "FTP_DOSSIER contient un caractère inattendu." >&2; exit 1 ;;
esac
# Valeurs vérifiées sans être affichées.
case "$FTP_SERVER" in
  ''|*[!A-Za-z0-9.-]*) echo "FTP_SERVER n'a pas la forme d'un nom de serveur (lettres, chiffres, points, tirets)." >&2; exit 1 ;;
esac
case "$FTP_PASSWORD" in
  *[[:space:][:cntrl:]]*) echo "FTP_PASSWORD contient un espace ou un saut de ligne (souvent un reste de copier-coller) : le reposer." >&2; exit 1 ;;
esac
case "$FTP_USERNAME" in
  *[[:space:],\"\'\\]*) echo "FTP_USERNAME contient un espace, une virgule, une apostrophe, un guillemet ou une barre oblique inverse." >&2; exit 1 ;;
esac

ici="$(cd "$(dirname "$0")" && pwd)"
connus="$ici/ovh_known_hosts"
alias_hote="ftp.cluster021.hosting.ovh.net"   # le nom sous lequel ovh_known_hosts a été relevé

lot="$(mktemp)"
trap 'rm -f "$lot"' EXIT

{
  echo "cd $dossier"
  # « - » devant une commande : l'échec est toléré (le dossier existe déjà le plus souvent).
  (cd "$src" && find . -mindepth 1 -type d | sed 's#^\./##' | sort) | while read -r d; do echo "-mkdir $d"; done
  (cd "$src" && find . -type f | sed 's#^\./##' | sort) | while read -r f; do echo "put -p $src/$f $f"; done
} > "$lot"

if [ "${ESSAI:-false}" = "true" ]; then
  echo "Essai à blanc : connexion et liste du dossier, rien n'est envoyé. Il serait envoyé :"
  grep '^put ' "$lot" | sed -E 's#^put -p [^ ]+ #  #'
  printf 'cd %s\nls -l\n' "$dossier" > "$lot"
fi

# sftp -b force BatchMode=yes, qui interdit toute authentification par mot de passe : ssh ne l'essaie même
# pas ("No more authentication methods"). La première valeur donnée gagne, donc BatchMode=no doit précéder -b.
commun=(
  -o BatchMode=no
  -o "User=$FTP_USERNAME"
  -o "UserKnownHostsFile=$connus"
  -o "HostKeyAlias=$alias_hote"
  -o StrictHostKeyChecking=yes
  -o PreferredAuthentications=password
  -o PubkeyAuthentication=no
  -o ConnectTimeout=30
)

if [ "${ESSAI:-false}" = "true" ]; then
  # En essai, le détail de la connexion (-v) est filtré : seules les lignes qui ne portent ni identifiant
  # ni mot de passe sont affichées.
  err="$(mktemp)"
  trap 'rm -f "$lot" "$err"' EXIT
  set +e
  SSHPASS="$FTP_PASSWORD" sshpass -e sftp -v "${commun[@]}" -b "$lot" "$FTP_SERVER" 2> "$err"
  code=$?
  set -e
  # Seulement les méthodes d'authentification annoncées et essayées : aucune ligne ne porte de valeur secrète.
  grep -iE "authentications that can continue|next authentication method|no more authentication methods|keyboard-interactive|Server host key" "$err" | cut -c1-160 || true
  echo "code de sortie : $code"
  exit "$code"
fi

# L'envoi réel : par lots de huit fichiers, chacun repris jusqu'à quatre fois si la connexion se coupe (OVH la
# coupe parfois en plein envoi : « Broken pipe »). Les images, les modèles et les scripts partent d'abord ;
# waveurs.js puis index.html, qui s'en servent, partent en dernier : une coupure ne laisse jamais une page
# qui réclame des fichiers pas encore là.
envoyer_lot(){
  local tentative
  for tentative in 1 2 3 4; do
    if SSHPASS="$FTP_PASSWORD" sshpass -e sftp "${commun[@]}" -o ServerAliveInterval=15 -o ServerAliveCountMax=4 -b "$1" "$FTP_SERVER"; then
      return 0
    fi
    echo "Coupure de la connexion : nouvelle tentative ($tentative/4) dans 8 s." >&2
    sleep 8
  done
  return 1
}

travail="$(mktemp -d)"
trap 'rm -rf "$travail" "$lot"' EXIT

{
  echo "cd $dossier"
  (cd "$src" && find . -mindepth 1 -type d | sed 's#^\./##' | sort) | while read -r d; do echo "-mkdir $d"; done
} > "$travail/dossiers"
envoyer_lot "$travail/dossiers" || { echo "Impossible de créer les dossiers." >&2; exit 1; }

(cd "$src" && find . -type f | sed 's#^\./##' | sort | grep -vE '^(waveurs\.js|index\.html)$' || true
 for f in waveurs.js index.html; do [ -f "$f" ] && echo "$f"; done) > "$travail/liste"

split -l 8 "$travail/liste" "$travail/lot_"
for l in "$travail"/lot_*; do
  {
    echo "cd $dossier"
    while read -r f; do echo "put -p $src/$f $f"; done < "$l"
  } > "$travail/commandes"
  envoyer_lot "$travail/commandes" || { echo "Envoi interrompu : la connexion ne tient pas." >&2; exit 1; }
done
echo "Terminé."
