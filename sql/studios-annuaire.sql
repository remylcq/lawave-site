-- Annuaire des studios : logo, photos, tarifs multiples, promotions, page modifiable par son gérant, carte. (Passé en production le 2026-11-16.)
--
-- com_studios : + logo_url, photos (text[], 8 au plus), gerant (uuid), adresse, pays (FR par défaut), latitude / longitude (au niveau de la ville),
--   promo_pct (1-90), promo_texte, promo_debut, promo_fin, maj_le.
-- com_studios_tarifs : un tarif par ligne (intitulé, prix de la séance, durée minimale en heures, avec ou sans ingénieur du son, précision).
--   Le « dès X €/h » affiché est le prix le plus bas par heure (prix / durée) ; la promotion en cours se retire au prix.
-- Fonctions (security definer, voir la base pour le texte) :
--   com_studio_promo_active(studio), com_studio_url_ok(url) (images du stockage public « Covers », fichiers studio-…),
--   com_studio_tarif_heure(studio), com_studios_liste (studios en promotion d'abord), com_studio (fiche : photos, tarifs, droit de modifier),
--   com_studios_mes (studios que je gère), com_studio_modifier (gérant, proposeur ou équipe : tout en un appel, tarifs remplacés),
--   com_studio_gerant_definir (équipe : confier un studio à un membre par son pseudo), studios_carte (publics, avec coordonnées),
--   studios_geocoder (tâche studios-geocoder, toutes les 5 minutes, coordonnées de la ville via villes_geo comme pour les concerts).
-- Le gérant d'un studio proposé est son auteur (com_studio_proposer renseigne gerant).
-- RETRAIT : désactiver la tâche studios-geocoder, retirer les fonctions ci-dessus et la table com_studios_tarifs ; les anciennes
--   versions de com_studios_liste / com_studio sont à remettre depuis l'historique du dépôt.

alter table public.com_studios
  add column if not exists logo_url text,
  add column if not exists photos text[] not null default '{}',
  add column if not exists gerant uuid,
  add column if not exists adresse text,
  add column if not exists pays text not null default 'FR',
  add column if not exists latitude double precision,
  add column if not exists longitude double precision,
  add column if not exists promo_pct smallint,
  add column if not exists promo_texte text,
  add column if not exists promo_debut timestamptz,
  add column if not exists promo_fin timestamptz,
  add column if not exists maj_le timestamptz;

create table if not exists public.com_studios_tarifs (
  id        uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.com_studios(id) on delete cascade,
  libelle   text not null,
  prix      integer not null check (prix >= 0 and prix <= 5000),
  duree_h   integer not null default 1 check (duree_h between 1 and 12),
  ingenieur boolean not null default true,
  note      text,
  ordre     integer not null default 0
);
alter table public.com_studios_tarifs enable row level security;
revoke all on public.com_studios_tarifs from public, anon, authenticated;
