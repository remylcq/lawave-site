#!/usr/bin/env bash
# Envoie le dossier préparé (preparer.sh) dans le dossier du site par SFTP, c'est-à-dire par SSH :
# l'hébergement OVH refuse le FTP chiffré (AUTH TLS), mais accepte le SSH sur le port 22.
#
# Sécurité : l'empreinte du serveur est vérifiée contre ovh_known_hosts (à côté de ce script) ; si elle
# ne correspond pas, la connexion est refusée et le mot de passe n'est jamais envoyé.
# Rien n'est supprimé sur le serveur (pas de --delete) : .htaccess, musique/, etc. ne sont pas touchés.
#
# Entrées (variables d'environnement) : FTP_SERVER, FTP_USERNAME, FTP_PASSWORD, FTP_DOSSIER (www/ par
# défaut), ESSAI=true pour lister sans rien envoyer.
# Usage : bash outils/deploiement/envoyer-sftp.sh [dossier-prepare]   (par défaut : _publication)
set -euo pipefail

src="${1:-_publication}"
dossier="${FTP_DOSSIER:-www/}"
: "${FTP_SERVER:?FTP_SERVER manquant}" "${FTP_USERNAME:?FTP_USERNAME manquant}" "${FTP_PASSWORD:?FTP_PASSWORD manquant}"

[ -d "$src" ] || { echo "Dossier à envoyer introuvable : $src" >&2; exit 1; }
case "$dossier" in
  *[!A-Za-z0-9._/-]*) echo "FTP_DOSSIER contient un caractère inattendu : $dossier" >&2; exit 1 ;;
esac

ici="$(cd "$(dirname "$0")" && pwd)"
connus="$ici/ovh_known_hosts"
alias_hote="ftp.cluster021.hosting.ovh.net"   # le nom sous lequel ovh_known_hosts a été relevé

options=""
if [ "${ESSAI:-false}" = "true" ]; then
  options="--dry-run"
  echo "Essai à blanc : rien ne sera envoyé."
fi

lot="$(mktemp)"
trap 'rm -f "$lot"' EXIT
cat > "$lot" <<EOF
set cmd:fail-exit yes
set net:max-retries 2
set net:timeout 30
set sftp:auto-confirm no
set sftp:connect-program "ssh -a -x -o UserKnownHostsFile=$connus -o HostKeyAlias=$alias_hote -o StrictHostKeyChecking=yes -o PreferredAuthentications=password -o PubkeyAuthentication=no"
open -u "$FTP_USERNAME" "sftp://$FTP_SERVER"
cd "$dossier"
mirror --reverse --verbose --no-perms $options "$src" .
EOF

# Le mot de passe passe par l'environnement, jamais par la ligne de commande ni par un fichier.
LFTP_PASSWORD="$FTP_PASSWORD" lftp -f "$lot"
echo "Envoi terminé."
