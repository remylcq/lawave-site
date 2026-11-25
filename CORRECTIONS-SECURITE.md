# Corrections de sécurité — 2026-11-25

Suite à l'audit de sécurité offensif du 2026-11-25 (`RAPPORT-SECURITE.md`, worktree `agent-a4cbbfac532ac104f`). Branche `securite-audit-2026-11-25`, partie de `main` @ `ddcbcce`.

Pour chaque point : ce qui a été corrigé, ce qui a été volontairement laissé de côté (et pourquoi), ce qui reste à faire par Rémy.

---

## 1. [HAUTE] Fonctions sociales lisibles par n'importe qui sans compte

**Corrigé.**

Vérification avec `get_advisors(type=security)` (75 fonctions `SECURITY DEFINER` exécutables par `anon`) puis lecture de `pg_get_functiondef` pour chacune des six citées dans le rapport, plus la même famille (`com_chercher`, `com_profil`, `com_post`, `com_nb_posts`).

Résultat de la lecture :

- **Exposent vraiment du contenu social réel sans aucun garde-fou interne** (pas de `if auth.uid() is null then ...`) : `com_fil` (fil), `com_membres` (annuaire : pseudo, bio, ville, rôles...), `com_tendances` (hashtags/sujets actifs), `com_suggestions` (profils suggérés avec bio), `com_chercher` (recherche membres + posts), `com_profil` (fiche complète d'un membre : bio, réseaux, statut vérifié...), `com_post` (contenu d'un message + ses commentaires), `com_nb_posts` (compteur par auteur).
- **`com_compteurs`** : ne fuit rien en pratique pour un visiteur anonyme (`auth.uid()` vaut `null`, la requête ne retourne jamais de ligne), mais n'a aucune utilité légitime hors connexion — révoquée par cohérence.
- **`com_referentiel`** : catégories de sujets/métiers (configuration, zéro donnée personnelle) — **laissée accessible à `anon`**, ce n'est pas un bug.
- **Fonctions volontairement publiques, non touchées** : `artiste_vue`, `artiste_stats`, `artistes_similaires`, `catalogue_pistes`, `concerts_carte`, `concerts_a_venir`, `studios_carte`, `com_studios_liste`, `idees_liste`, `lancement_page` — catalogue musical, carte, sorties du moment, idées publiques : le produit les veut accessibles sans compte.

SQL testé en transaction annulée puis appliqué en production (`apply_migration` `anon_social_retrait`) :
```sql
revoke execute on function public.com_fil(...)         from anon;
revoke execute on function public.com_membres(...)     from anon;
revoke execute on function public.com_tendances()      from anon;
revoke execute on function public.com_suggestions(...) from anon;
revoke execute on function public.com_chercher(...)    from anon;
revoke execute on function public.com_profil(...)      from anon;
revoke execute on function public.com_post(...)        from anon;
revoke execute on function public.com_nb_posts(...)    from anon;
revoke execute on function public.com_compteurs()      from anon;
```
`authenticated` garde l'exécution de toutes ces fonctions (aucun changement pour un membre connecté).

**Côté JavaScript** (`communaute.js`, fonction `ouvrirReel()`) : la page Communauté affichait le fil à n'importe qui, connecté ou non (seul le bouton de publication était remplacé par une invitation). Comme le produit n'a plus de raison de le permettre après la correction SQL ci-dessus, un visiteur non connecté voit maintenant un message clair (« Connecte-toi pour découvrir la Communauté ») avec les boutons Se connecter / Créer un compte, **avant** tout appel aux fonctions `com_*` — vérifié en direct (volet navigateur, serveur Python local) : aucune requête `rpc/com_*` n'est envoyée tant qu'on n'est pas connecté, et le bouton « Se connecter » ouvre bien la modale.

`communaute.js` passé de `?v=4` à `?v=5` dans `index.html` (changement de fichier).

---

## 2. [MOYENNE] Clé API YouTube exposée côté client

**Non modifié — recommandation seulement**, avec une vérification en direct qui change l'évaluation du risque.

- `index.html` ligne ~9290 (désormais ~9300 après les ajouts plus haut dans le fichier) : `const YOUTUBE_API_KEY = 'AIza...'`, utilisée pour deux appels fixes (chaîne + dernières vidéos de `@LaWavefr`), mis en cache 6 h côté navigateur. Ce n'est pas une recherche pilotée par l'utilisateur : la forme est simple (deux endpoints, un identifiant fixe).
- **Vérification faite pendant cet audit** : un appel direct à l'API sans en-tête `Referer` renvoie `403 Permission denied` ; le même appel avec `Referer: https://lawave.fr/` fonctionne. **La clé est donc déjà restreinte par référent HTTP** — elle n'est pas exploitable telle quelle par un simple embed sur un autre site (le navigateur enverrait le `Referer` du site tiers, pas celui de La Wave). Le risque réel est plus faible que ce que le rapport laissait supposer, mais pas nul : un script serveur peut forger l'en-tête `Referer`, donc la clé reste utilisable par un acteur motivé qui écrit du code pour ça (pas un simple copier-coller dans une page web).
- Modèle déjà en place dans ce projet pour ne jamais exposer une clé tierce au client : les Edge Functions `envoyer-push` et `envoyer-resume` (secret lu dans une table de configuration côté base, jamais envoyé au navigateur).
- **Décision** : ne pas migrer l'appel YouTube vers une Edge Function dans ce correctif. Les deux appels fixes se prêteraient bien à un simple relais serveur (même modèle que `envoyer-resume`), mais je n'ai pas de clé YouTube de test pour vérifier bout en bout que le relais renvoie exactement la même forme de réponse que le code client attend (vignettes, filtrage des vidéos privées/supprimées...), et casser le carrousel vidéo de la page d'accueil sans pouvoir le re-tester en vrai est un risque que je préfère ne pas prendre seul.

**À faire par Rémy** :
- Dans Google Cloud Console, vérifier/resserrer la restriction (référent **et** API autorisée = YouTube Data API v3 uniquement) — la restriction par référent semble déjà active, mais seul le dashboard confirme la configuration exacte et peut y ajouter la restriction par API.
- Si une vraie clé de test devient disponible un jour, le passage par une Edge Function (relais des deux appels `channels`/`playlistItems`, clé lue depuis une table de config comme pour Resend) est prêt à être fait sur ce modèle.

---

## 3. [BASSE] Content-Security-Policy incomplète

**Corrigé.**

Inventaire réel de tout ce que charge `index.html` (et les scripts qu'il charge) : `<script src>`, feuilles de style, appels `fetch`/Supabase, iframes, images, polices, flux audio — listé en cherchant tous les `https://` dans `index.html` et dans chaque fichier `.js`/`.php` du site.

Nouvelle CSP posée dans `.htaccess` (plus de `Permissions-Policy`, absente aussi) :
```
default-src 'self';
script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com;
style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com;
img-src 'self' data: blob: https://bqataeghgjyiqrnnesqq.supabase.co https://i.ytimg.com https://*.dzcdn.net https://tile.openstreetmap.org;
font-src 'self' data:;
connect-src 'self' https://bqataeghgjyiqrnnesqq.supabase.co wss://bqataeghgjyiqrnnesqq.supabase.co https://www.googleapis.com https://api-adresse.data.gouv.fr https://photon.komoot.io;
media-src 'self' data: https://bqataeghgjyiqrnnesqq.supabase.co https://*.dzcdn.net;
frame-src https://www.youtube-nocookie.com https://widget.deezer.com https://w.soundcloud.com;
worker-src 'self'; object-src 'none'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'
Permissions-Policy: geolocation=(self), camera=(), microphone=(self), payment=()
```

`'unsafe-inline'` est nécessaire sur `script-src`/`style-src` : tout `index.html` est écrit en scripts et attributs `onclick=`/`style=` inline (pas de nonce ni de refonte possible dans le cadre de ce correctif) — sans ça, le site entier cesserait de fonctionner. La CSP reste utile : elle ferme les origines externes (`script-src`/`connect-src`/`img-src`...) à une liste connue, ce qui bloque l'exfiltration ou le chargement de code depuis un domaine tiers même en cas d'injection future.

Microphone et géolocalisation sont bien utilisés (messages vocaux de la Communauté, carte « autour de moi ») — vérifié par recherche de `getUserMedia`/`navigator.geolocation` avant de les autoriser dans `Permissions-Policy`. Caméra et paiement ne sont utilisés nulle part : bloqués.

**Testé en direct** dans le volet navigateur (serveur Python local avec les mêmes en-têtes, `.claude/launch.json` non partagé car hors de portée du worktree — serveur lancé directement) : accueil, catalogue (lecture d'un extrait Deezer), carte (Leaflet via cdnjs, tuiles OpenStreetMap), page Contenu (iframe YouTube), widgets Deezer/SoundCloud, appels `api-adresse.data.gouv.fr`/`photon.komoot.io`/`googleapis.com` — **aucune ressource bloquée**. Un premier essai a révélé `media-src` trop strict (bloquait les extraits audio Deezer et un son de test en `data:`) : corrigé et revérifié avant de committer.

---

## 4. [INFO] Colonnes internes de `public.artists` lisibles publiquement

**Corrigé.**

`demande_par`/`verifie_par` sont lus en direct par `BD.artistes()` (`index.html`) via `.from('artists').select(...)` avec la policy RLS permissive en lecture (`artistes lecture`, `USING true`) : n'importe qui peut les récupérer par `?select=demande_par,verifie_par`. Mais ces deux colonnes ne sont pas que des champs techniques d'équipe : le reste du site compare leur valeur à `currentUser.id` pour savoir si *le visiteur connecté* est celui qui a demandé/obtenu la vérification de la page (`estArtisteVerifie`, panneau « C'est ta page ? »), et leur simple vérité (`!!profil.verifie_par`) sert d'indicateur public de statut vérifié — y compris pour un visiteur non connecté qui regarde une fiche artiste.

Correctif à deux niveaux, testé en transaction annulée puis appliqué (`apply_migration` `artists_colonnes_internes_protegees`) :
- **Colonnes retirées du droit de lecture d'`anon`** sur la table elle-même (`revoke select on public.artists from anon` + `grant select (liste de toutes les colonnes sauf les deux concernées) ... to anon`) : un appel REST direct (`?select=demande_par,verifie_par`) échoue désormais pour `anon` avec *permission denied*. `authenticated` garde l'accès complet, inchangé.
- **Fonction de remplacement `public.artistes_publics()`** (SECURITY DEFINER, mêmes filtres que les policies RESTRICTIVE existantes : bannis et non francophones masqués) qui renvoie les mêmes colonnes que `BD.COLONNES_ARTISTES`, avec `demande_par`/`verifie_par` remplacés par un UUID neutre fixe quand la vraie valeur existe (préserve `!!profil.verifie_par` à l'identique, sans révéler qui a vérifié/demandé).

`BD.artistes()` (`index.html`) choisit maintenant la source selon l'état de connexion : `authenticated` → table réelle comme avant (aucun changement de comportement pour un membre connecté, y compris l'auto-vérification de sa propre page) ; anonyme → `artistes_publics()`.

**Vérifié en direct** (volet navigateur, anonyme) : `BD.artistes()` renvoie les 640 artistes visibles sans erreur ; la fiche d'un artiste réellement vérifié (`edou.tss`) affiche l'UUID neutre à la place du vrai, le reste de la page (réseaux, discographie, invitation « Connecte-toi pour en demander la gestion ») s'affiche normalement, sans erreur console.

---

## 5. [CRITIQUE — préparé, non appliqué] Portail testeurs : inscription publique instantanée

**Non corrigé, comme demandé.** `sql/propositions-fermeture-inscription.sql` (non appliqué, commenté) propose trois options indépendantes :
- **A.** Liste blanche d'e-mails à l'inscription (trigger sur `auth.users` qui vérifie `acces_testeurs`) — ferme vraiment la faille côté serveur, mais il faut d'abord y ajouter les 31 comptes déjà créés.
- **B.** CAPTCHA à l'inscription (réglage du dashboard Supabase Auth, pas du SQL) — stoppe la création automatisée en masse, n'empêche pas une inscription manuelle.
- **C.** Mot de passe HTTP Apache (Basic Auth) en plus du portail JS — le plus simple, un identifiant partagé en plus du compte personnel.

Rien n'a été appliqué, aucun trigger ni réglage Supabase Auth touché : c'est une décision de produit/accès (qui a le droit d'entrer pendant la phase de test), pas un bug technique à corriger seul.

---

## 6. [MOYENNE, hors de portée] Mots de passe compromis

Non fait — réglage du dashboard Supabase (Authentication → Policies → Password Security → « Leaked password protection »), pas accessible par SQL ni par du code. **À faire par Rémy.** Confirmé toujours désactivé via `get_advisors` (`auth_leaked_password_protection`, WARN) — c'est la même recommandation que l'audit du 24 octobre 2026, non encore appliquée.

---

## Résumé pour Rémy

| # | Sujet | État |
|---|---|---|
| 1 | Fonctions sociales publiques | ✅ Corrigé (SQL + JS), testé |
| 2 | Clé YouTube | ⏸ Recommandation seulement (déjà restreinte par référent, à resserrer dans Google Cloud Console) |
| 3 | CSP | ✅ Corrigé, testé sans régression |
| 4 | Colonnes `artists` | ✅ Corrigé, testé |
| 5 | Inscription ouverte | 📋 Propositions prêtes dans `sql/propositions-fermeture-inscription.sql`, décision à prendre |
| 6 | Mots de passe compromis | ⏳ À activer dans le dashboard Supabase |
