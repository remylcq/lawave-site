-- =====================================================================
-- La Wave — noter et commenter un artiste
--
-- Retour d'un utilisateur : « peut-être qu'un texte avec des infos sur les
-- artistes permettrait de mettre une note ou un commentaire, comme sur les
-- fiches de sons ou de projets ».
--
-- Même modèle que release_ratings (la note d'une sortie), pour l'artiste :
-- une seule ligne par membre et par artiste, qui porte la note (en
-- demi-étoiles : 1 = ½ étoile, 10 = cinq étoiles) et/ou un avis écrit.
-- Lecture publique (les moyennes et les avis se voient sans compte) ;
-- chacun n'écrit, ne modifie et ne supprime que sa propre ligne.
--
-- Sans danger à rejouer.
-- =====================================================================

create table if not exists public.artist_ratings (
  user_id       uuid        not null references public.profiles(id) on delete cascade,
  artist_handle text        not null references public.artists(instagram_handle) on update cascade on delete cascade,
  rating        smallint    check (rating >= 1 and rating <= 10),
  avis          text        check (avis is null or char_length(avis) <= 1000),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (user_id, artist_handle),
  -- Une ligne vide n'a pas de raison d'être : il faut une note ou un avis.
  constraint artist_ratings_non_vide check (rating is not null or nullif(btrim(coalesce(avis, '')), '') is not null)
);

create index if not exists artist_ratings_artiste_idx
  on public.artist_ratings (artist_handle, updated_at desc);

alter table public.artist_ratings enable row level security;

drop policy if exists "notes artistes lecture publique" on public.artist_ratings;
drop policy if exists "notes artistes creation"         on public.artist_ratings;
drop policy if exists "notes artistes modification"     on public.artist_ratings;
drop policy if exists "notes artistes suppression"      on public.artist_ratings;

create policy "notes artistes lecture publique"
  on public.artist_ratings for select
  using (true);

create policy "notes artistes creation"
  on public.artist_ratings for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "notes artistes modification"
  on public.artist_ratings for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "notes artistes suppression"
  on public.artist_ratings for delete
  to authenticated
  using (auth.uid() = user_id);

grant select on public.artist_ratings to anon, authenticated;
grant insert, update, delete on public.artist_ratings to authenticated;
