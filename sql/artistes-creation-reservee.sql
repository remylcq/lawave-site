-- =====================================================================
-- La Wave — créer un artiste n'est plus ouvert à tout le monde
--
-- Le problème : la règle « artistes creation » de la table artists
-- acceptait n'importe quelle insertion, y compris d'un visiteur sans
-- compte : la base d'artistes (catalogue, carte, communauté) pouvait être
-- remplie de lignes à volonté.
--
-- La correction : créer un artiste suit la règle du dépôt d'une sortie
-- (peut_soumettre() : les rôles autorisés, plus l'équipe). Tout ce que le
-- site fait passe déjà par un tel compte ; les imports Deezer (qui
-- s'exécutent dans la base, sans compte connecté) et l'ajout manuel de
-- l'équipe ne changent pas.
--
-- Passé en production le 2026-10-13 (vérifié : un artiste crée, un
-- auditeur est refusé). Sans danger si on le repasse.
-- =====================================================================

drop policy if exists "artistes creation" on public.artists;

create policy "artistes creation"
  on public.artists
  for insert
  to authenticated
  with check (public.peut_soumettre() or public.est_equipe());
