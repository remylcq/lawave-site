# Mise en ligne automatique

Chaque fusion sur `main` qui touche un fichier du site (`index.html`, `waveurs.js`, `communaute.js`,
`portail.js`, `sondage.js`, `verification.js`, `parcours.js`, `profil.js`, `xp.js`, `cartes.js`, `accueil.js`, `combat.js`, `combat-pve.js`, `combat-pvp.js`, `marche.js`, `cartes-equipe.js`, `404.html`, `robots.txt`, `sitemap.xml`, `site.webmanifest`, `img/`, `modeles/`, `decor/`, `lib/`) l'envoie sur l'hébergement OVH par SFTP (SSH, chiffré), puis vérifie que `lawave.fr` sert bien
les fichiers envoyés. Le workflow est `.github/workflows/mise-en-ligne.yml`.

**Jamais envoyés :** `sql/` (à passer dans Supabase), `outils/`, `.github/` et le `.htaccess` de la racine (qui reste sur le
serveur, à la main : après un changement du `.htaccess` du dépôt — page 404, cache, en-têtes de sécurité —, recopier son contenu dans celui de `www/`). Ce qui est déjà sur le serveur sans être dans le dépôt (par exemple `musique/`) n'est pas touché.

Les adresses des scripts reçoivent l'empreinte du fichier à l'envoi (`waveurs.js?v=1a2b3c4d`) : plus de
numéro `?v=` à augmenter. Dans le dépôt, `index.html` garde son numéro ; sur le site, il porte l'empreinte.

## Les identifiants

OVH refuse le FTP chiffré mais accepte le SFTP (port 22) avec le même identifiant et le même mot de passe que
FileZilla. Trois secrets : `FTP_SERVER` (`ftp.cluster021.hosting.ovh.net`), `FTP_USERNAME`, `FTP_PASSWORD`.
Les anciens `FTP_HOST` et `FTP_USER` sont encore acceptés s'ils sont les seuls posés.

### Les poser ou les remplacer (par toi, dans ton terminal)

Les mots de passe ne passent jamais par la conversation : chaque commande pose la question « Paste your secret »,
et c'est **à cet instant** qu'on tape la valeur (saisie masquée). Le dépôt est public, ses journaux aussi : le
script n'affiche jamais ces valeurs.

    gh secret set FTP_SERVER --repo remylcq/lawave-site
    gh secret set FTP_USERNAME --repo remylcq/lawave-site
    gh secret set FTP_PASSWORD --repo remylcq/lawave-site

Le serveur est vérifié contre l'empreinte de `ovh_known_hosts` ; si OVH change un jour de clé, la connexion est
refusée (relever la nouvelle avec `ssh-keyscan ftp.cluster021.hosting.ovh.net`).

Réglages facultatifs (variables, pas des secrets) : `FTP_DOSSIER` (`www/` par défaut), `SITE_URL`
(`https://lawave.fr`), `FTP_PROTOCOL` (`sftp` par défaut ; `ftp` ou `ftps` en secours, mais OVH refuse `ftps` et
`ftp` envoie le mot de passe en clair).

## Essai à blanc, puis première mise en ligne

    gh workflow run mise-en-ligne.yml --repo remylcq/lawave-site -f essai=true

liste ce qui serait envoyé sans rien envoyer (il vérifie la connexion et les identifiants). Sans `-f essai=true`,
l'envoi est réel. Le suivi se lit dans l'onglet Actions du dépôt.

## Revenir en arrière

Annuler la fusion fautive (`git revert`) : la fusion de l'annulation remet l'ancienne version en ligne.

## Si le vérificateur échoue

« DIFFÉRENT » : le site ne sert pas encore le fichier envoyé (cache de l'hébergement, envoi partiel). Relancer
le workflow ; si cela persiste, regarder les journaux de l'étape « Envoyer par SFTP ».

Les dossiers `modeles/` et `decor/` portent leur propre `.htaccess` (type `model/gltf-binary` et compression des `.glb` : environ un quart de moins à télécharger). Il part avec le dossier ; la vérification après envoi ne le demande pas (Apache refuse de servir les `.ht*`).
