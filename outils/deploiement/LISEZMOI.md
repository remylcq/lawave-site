# Mise en ligne automatique

Chaque fusion sur `main` qui touche un fichier du site (`index.html`, `waveurs.js`, `communaute.js`,
`portail.js`, `modeles/`) l'envoie sur l'hébergement OVH par FTP, puis vérifie que `lawave.fr` sert bien
les fichiers envoyés. Le workflow est `.github/workflows/mise-en-ligne.yml`.

**Jamais envoyés :** `sql/` (à passer dans Supabase), `outils/`, `.github/` et `.htaccess` (qui reste sur le
serveur, à la main). Ce qui est déjà sur le serveur sans être dans le dépôt (par exemple `musique/`) n'est pas touché.

Les adresses des scripts reçoivent l'empreinte du fichier à l'envoi (`waveurs.js?v=1a2b3c4d`) : plus de
numéro `?v=` à augmenter. Dans le dépôt, `index.html` garde son numéro ; sur le site, il porte l'empreinte.

## Les identifiants (une seule fois, par toi, dans ton terminal)

Les mots de passe ne passent jamais par la conversation : chaque commande te les demande, saisie masquée.
Les valeurs sont celles de FileZilla (hôte du type `ftp.cluster021.hosting.ovh.net`, identifiant, mot de passe).

    gh secret set FTP_SERVER --repo remylcq/lawave-site
    gh secret set FTP_USERNAME --repo remylcq/lawave-site
    gh secret set FTP_PASSWORD --repo remylcq/lawave-site

Réglages facultatifs (variables, pas des secrets) : `FTP_PROTOCOL` (`ftps` par défaut ; `ftp` si l'hébergement
refuse le chiffrement), `FTP_DOSSIER` (`www/` par défaut), `SITE_URL` (`https://lawave.fr`).

    gh variable set FTP_PROTOCOL --repo remylcq/lawave-site --body ftp

## Essai à blanc, puis première mise en ligne

    gh workflow run mise-en-ligne.yml --repo remylcq/lawave-site -f essai=true

liste ce qui serait envoyé sans rien envoyer (il vérifie la connexion et les identifiants). Sans `-f essai=true`,
l'envoi est réel. Le suivi se lit dans l'onglet Actions du dépôt.

## Revenir en arrière

Annuler la fusion fautive (`git revert`) : la fusion de l'annulation remet l'ancienne version en ligne.

## Si le vérificateur échoue

« DIFFÉRENT » : le site ne sert pas encore le fichier envoyé (cache de l'hébergement, envoi partiel). Relancer
le workflow ; si cela persiste, regarder les journaux de l'étape « Envoyer par FTP ».
