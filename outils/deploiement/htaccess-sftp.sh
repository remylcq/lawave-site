#!/usr/bin/env bash
# Met à jour le .htaccess du serveur (www/.htaccess) sans écraser ce qui s'y trouve déjà.
#
# Le .htaccess du dépôt (page 404, cache, compression, HTTPS, en-têtes de sécurité) est posé dans un bloc délimité par
# deux lignes repères, À LA FIN du .htaccess du serveur. Tout ce qui était là avant (réglages propres à OVH, version de
# PHP...) est gardé tel quel. Rejoué, le script remplace seulement son propre bloc.
#
# Garde-fous :
#  - la toute première fois, l'ancien fichier du serveur est copié en .htaccess.avant-lawave (jamais écrasé ensuite) ;
#  - après l'envoi, la page d'accueil et une adresse inconnue sont testées ; si le site répond par une erreur serveur
#    (5xx) ou ne répond plus, l'ancien fichier est remis aussitôt et le script échoue ;
#  - même sécurité que envoyer-sftp.sh : empreinte du serveur vérifiée, mot de passe par l'environnement, rien
#    d'identifiant dans les journaux (le dépôt est public).
#
# Entrées : FTP_SERVER, FTP_USERNAME, FTP_PASSWORD, FTP_DOSSIER (www/ par défaut), SITE_URL, ESSAI=true (n'envoie rien :
# montre seulement quelles directives le serveur a déjà et ce qui serait ajouté).
set -euo pipefail

dossier="${FTP_DOSSIER:-www/}"
site="${SITE_URL:-https://lawave.fr}"
: "${FTP_SERVER:?FTP_SERVER manquant}" "${FTP_USERNAME:?FTP_USERNAME manquant}" "${FTP_PASSWORD:?FTP_PASSWORD manquant}"

case "$dossier" in *[!A-Za-z0-9._/-]*) echo "FTP_DOSSIER contient un caractère inattendu." >&2; exit 1 ;; esac
case "$FTP_SERVER" in ''|*[!A-Za-z0-9.-]*) echo "FTP_SERVER n'a pas la forme d'un nom de serveur." >&2; exit 1 ;; esac

ici="$(cd "$(dirname "$0")" && pwd)"
depot="$(cd "$ici/../.." && pwd)"
connus="$ici/ovh_known_hosts"
alias_hote="ftp.cluster021.hosting.ovh.net"

[ -f "$depot/.htaccess" ] || { echo ".htaccess du dépôt introuvable." >&2; exit 1; }

commun=(
  -o BatchMode=no
  -o "User=$FTP_USERNAME"
  -o "UserKnownHostsFile=$connus"
  -o "HostKeyAlias=$alias_hote"
  -o StrictHostKeyChecking=yes
  -o PreferredAuthentications=password
  -o PubkeyAuthentication=no
  -o ConnectTimeout=30
  -o ServerAliveInterval=15
  -o ServerAliveCountMax=4
)

sftp_lot(){
  local t
  for t in 1 2 3 4; do
    if SSHPASS="$FTP_PASSWORD" sshpass -e sftp "${commun[@]}" -b "$1" "$FTP_SERVER" > /dev/null 2>&1; then return 0; fi
    sleep 8
  done
  return 1
}

travail="$(mktemp -d)"
trap 'rm -rf "$travail"' EXIT

debut='# >>> LA WAVE : bloc géré par le dépôt (outils/deploiement/htaccess-sftp.sh), ne pas modifier ici >>>'
fin='# <<< LA WAVE : fin du bloc géré par le dépôt <<<'

# 1. Lire le fichier actuel du serveur (il peut ne pas exister).
printf 'cd %s\n-get .htaccess %s/actuel\n' "$dossier" "$travail" > "$travail/lire"
sftp_lot "$travail/lire" || { echo "Connexion au serveur impossible." >&2; exit 1; }
[ -f "$travail/actuel" ] || : > "$travail/actuel"
existait=false; [ -s "$travail/actuel" ] && existait=true

# 2. Le fichier sans notre ancien bloc, puis avec le nouveau.
awk -v d="$debut" -v f="$fin" '$0==d{skip=1} !skip{print} $0==f{skip=0}' "$travail/actuel" > "$travail/sans-bloc"
{
  cat "$travail/sans-bloc"
  [ -s "$travail/sans-bloc" ] && echo
  echo "$debut"
  cat "$depot/.htaccess"
  echo
  echo "$fin"
} > "$travail/nouveau"

if [ "${ESSAI:-false}" = "true" ]; then
  echo "Essai à blanc : rien n'est envoyé."
  echo "Fichier présent sur le serveur : $existait ($(wc -l < "$travail/actuel") lignes)."
  echo "Directives déjà présentes (noms seulement, sans valeurs) :"
  grep -vE '^[[:space:]]*(#|$)' "$travail/sans-bloc" | awk '{print $1}' | sort | uniq -c | sed 's/^/  /'
  echo "Le fichier final ferait $(wc -l < "$travail/nouveau") lignes."
  exit 0
fi

if cmp -s "$travail/actuel" "$travail/nouveau"; then
  echo ".htaccess déjà à jour."
  exit 0
fi

# 3. Sauvegarde de l'ancien fichier, la première fois seulement (tant que notre bloc n'y est pas).
if [ "$existait" = "true" ] && ! grep -qF "$debut" "$travail/actuel"; then
  cp "$travail/actuel" "$travail/.htaccess.avant-lawave"
  printf 'cd %s\nput -p %s/.htaccess.avant-lawave .htaccess.avant-lawave\n' "$dossier" "$travail" > "$travail/sauve"
  sftp_lot "$travail/sauve" || { echo "Sauvegarde impossible : rien n'est modifié." >&2; exit 1; }
  echo "Ancien .htaccess sauvegardé (.htaccess.avant-lawave)."
fi

envoyer(){
  cp "$1" "$travail/.htaccess"
  printf 'cd %s\nput -p %s/.htaccess .htaccess\n' "$dossier" "$travail" > "$travail/envoi"
  sftp_lot "$travail/envoi"
}

envoyer "$travail/nouveau" || { echo "Envoi du .htaccess impossible." >&2; exit 1; }
echo ".htaccess envoyé."

# 4. Vérification : le site répond-il toujours ? Sinon, retour à l'ancien fichier.
sleep 5
bon=true
code=$(curl -s -o /dev/null --max-time 30 -w '%{http_code}' "$site/?verif=$$" || echo 000)
[ "$code" = "200" ] || bon=false
code404=$(curl -s -o /dev/null --max-time 30 -w '%{http_code}' "$site/adresse-inconnue-$$" || echo 000)
case "$code404" in 404|200) ;; *) bon=false ;; esac
echo "Accueil : $code, adresse inconnue : $code404."

if [ "$bon" != "true" ]; then
  echo "Le site ne répond plus comme prévu : retour à l'ancien .htaccess." >&2
  envoyer "$travail/actuel" || echo "ATTENTION : la remise de l'ancien fichier a échoué, voir .htaccess.avant-lawave sur le serveur." >&2
  exit 1
fi

if [ "$code404" = "404" ]; then echo "Une adresse inconnue renvoie bien la page 404."; else echo "Une adresse inconnue renvoie encore l'accueil (le serveur ignore ErrorDocument ?)."; fi
echo "Terminé."
