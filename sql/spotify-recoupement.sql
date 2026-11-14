-- Recoupement des sorties importées de Deezer avec Spotify (mauvais compte d'artiste). (Passé en production le 2026-11-14.)
-- Prérequis : app Spotify d'un compte Premium, identifiants dans le coffre (vault) : spotify_client_id, spotify_client_secret.
--   (Spotify exige un abonnement Premium actif pour le propriétaire de l'app ; limit des albums = 10 au maximum.)
-- * spotify_jeton() : jeton d'accès (client credentials), lu depuis le coffre, jamais renvoyé au site.
-- * spotify_verifier(lot) : pour chaque artiste ayant des sorties Deezer en attente sans verdict : retrouve son profil Spotify
--   (lien enregistré, sinon recherche par nom, jusqu'à 3 homonymes, on garde celui qui recoupe le plus de titres), compare les
--   titres, et marque chaque sortie : 'trouvee', 'absente' (album absent chez cet artiste sur Spotify : à vérifier) ou 'inconnu'
--   (artiste introuvable ou aucun recoupement : pas de verdict). Écriture d'un coup à la fin (pas de verrous longs).
--   Tâche : spotify-verifier, chaque minute, 8 artistes.
-- * attente_artistes() renvoie en plus 'absentes' (nombre de sorties absentes de Spotify) ; le site affiche un badge par sortie,
--   un filtre « Absentes de Spotify » et le compteur sur la carte de l'artiste. Rien n'est retenu ni refusé automatiquement.
-- RETRAIT : select cron.unschedule('spotify-verifier'); drop function public.spotify_verifier(integer), public.spotify_jeton();
--   alter table public.submissions drop column spotify_statut; alter table public.artists drop column spotify_artist_id, drop column spotify_verifie_le;
-- (Le texte des fonctions est dans la base ; ce fichier en garde le principe.)

alter table public.submissions add column if not exists spotify_statut text check (spotify_statut in ('trouvee', 'absente', 'inconnu'));
alter table public.artists add column if not exists spotify_artist_id text;
alter table public.artists add column if not exists spotify_verifie_le timestamptz;
create index if not exists submissions_spotify_a_verifier_idx on public.submissions (artist_handle)
  where status = 'pending' and source = 'deezer' and spotify_statut is null;
