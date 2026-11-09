-- ============================================================
-- Page artiste : concerts à venir, statistiques privées, texte de présentation.
--
-- Demandes de Rémy (2026-11-09) :
--  21. une section « Concerts à venir » (date, ville, salle, lien de billetterie), gérée par l'artiste et l'équipe ;
--  35. un filtre « Concerts ce mois-ci » sur la carte (concerts_a_venir) ;
--  31. des statistiques privées pour l'artiste : vues de sa page, abonnés, collections, note ;
--  30. l'artiste qui gère sa page la complète lui-même : un texte de présentation (artists.bio).
--
-- Qui gère : l'équipe, et l'artiste dont la page est vérifiée à son compte (public.artiste_galerie_gerer).
-- Peut être rejoué sans risque.
--
-- RETRAIT : drop function if exists public.artiste_concerts(text), public.artiste_concert_ajouter(text, date, text, text, text),
--   public.artiste_concert_supprimer(uuid), public.concerts_a_venir(integer), public.artiste_vue(text), public.artiste_stats(text, integer);
--   drop table if exists public.artiste_concerts, public.artiste_vues; alter table public.artists drop column if exists bio;
-- ============================================================


-- ---------------------------------------------------------------------
-- 1. Les concerts
-- ---------------------------------------------------------------------

create table if not exists public.artiste_concerts (
  id            uuid primary key default gen_random_uuid(),
  artist_handle text not null check (artist_handle = lower(btrim(artist_handle)) and char_length(artist_handle) between 1 and 80),
  date_concert  date not null,
  ville         text not null check (char_length(btrim(ville)) between 1 and 80),
  salle         text check (salle is null or char_length(salle) <= 120),
  lien          text check (lien is null or (char_length(lien) <= 400 and lien ~* '^https://')),
  ajoute_par    uuid references public.profiles(id) on delete set null,
  cree_le       timestamptz not null default now()
);

create index if not exists artiste_concerts_artiste_idx on public.artiste_concerts (artist_handle, date_concert);
create index if not exists artiste_concerts_date_idx    on public.artiste_concerts (date_concert);

alter table public.artiste_concerts enable row level security;
revoke all on table public.artiste_concerts from anon, authenticated;

create or replace function public.artiste_concerts(p_handle text) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare v_h text := lower(btrim(coalesce(p_handle, '')));
begin
  return jsonb_build_object(
    'peut_gerer', public.artiste_galerie_gerer(v_h),
    'concerts', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'date', c.date_concert, 'ville', c.ville, 'salle', c.salle, 'lien', c.lien,
                         'peut_supprimer', public.artiste_galerie_gerer(v_h))
                       order by c.date_concert, c.cree_le)
        from public.artiste_concerts c
       where c.artist_handle = v_h and c.date_concert >= current_date), '[]'::jsonb));
end $$;

grant execute on function public.artiste_concerts(text) to anon, authenticated;

create or replace function public.artiste_concert_ajouter(p_handle text, p_date date, p_ville text, p_salle text default null, p_lien text default null)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_h     text := lower(btrim(coalesce(p_handle, '')));
  v_ville text := btrim(coalesce(p_ville, ''));
  v_salle text := nullif(btrim(coalesce(p_salle, '')), '');
  v_lien  text := nullif(btrim(coalesce(p_lien, '')), '');
  v_id    uuid;
begin
  if auth.uid() is null then raise exception 'Connecte-toi pour ajouter un concert.'; end if;
  if not public.artiste_galerie_gerer(v_h) then raise exception 'Seuls l''artiste et l''équipe peuvent ajouter un concert.'; end if;
  if p_date is null or p_date < current_date then raise exception 'La date du concert doit être aujourd''hui ou plus tard.'; end if;
  if p_date > current_date + 800 then raise exception 'Cette date est trop lointaine.'; end if;
  if char_length(v_ville) < 1 or char_length(v_ville) > 80 then raise exception 'Indique la ville du concert.'; end if;
  if v_lien is not null and v_lien !~* '^https://' then raise exception 'Le lien de billetterie doit commencer par https://'; end if;
  if (select count(*) from public.artiste_concerts where artist_handle = v_h and date_concert >= current_date) >= 40 then
    raise exception 'Déjà 40 concerts à venir : retire-en quelques-uns.';
  end if;
  insert into public.artiste_concerts (artist_handle, date_concert, ville, salle, lien, ajoute_par)
  values (v_h, p_date, v_ville, left(v_salle, 120), left(v_lien, 400), auth.uid())
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

grant execute on function public.artiste_concert_ajouter(text, date, text, text, text) to authenticated;

create or replace function public.artiste_concert_supprimer(p_id uuid) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare c record;
begin
  if auth.uid() is null then raise exception 'Connecte-toi.'; end if;
  select * into c from public.artiste_concerts where id = p_id;
  if not found then return jsonb_build_object('ok', true); end if;
  if not (public.artiste_galerie_gerer(c.artist_handle) or c.ajoute_par = auth.uid()) then
    raise exception 'Tu ne peux pas retirer ce concert.';
  end if;
  delete from public.artiste_concerts where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

grant execute on function public.artiste_concert_supprimer(uuid) to authenticated;

-- Les artistes qui jouent dans les p_jours prochains jours : leur prochain concert (pour le filtre de la carte).
create or replace function public.concerts_a_venir(p_jours integer default 30) returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select coalesce(jsonb_agg(jsonb_build_object('handle', x.artist_handle, 'date', x.date_concert, 'ville', x.ville, 'salle', x.salle,
                                               'lien', x.lien, 'nb', x.nb) order by x.date_concert), '[]'::jsonb)
    from (
      select distinct on (c.artist_handle) c.artist_handle, c.date_concert, c.ville, c.salle, c.lien,
             count(*) over (partition by c.artist_handle) as nb
        from public.artiste_concerts c
       where c.date_concert >= current_date and c.date_concert <= current_date + greatest(least(coalesce(p_jours, 30), 365), 1)
       order by c.artist_handle, c.date_concert
    ) x;
$$;

grant execute on function public.concerts_a_venir(integer) to anon, authenticated;


-- ---------------------------------------------------------------------
-- 2. Le texte de présentation de l'artiste
-- ---------------------------------------------------------------------

alter table public.artists
  add column if not exists bio text;

do $$ begin
  alter table public.artists add constraint artists_bio_longueur check (bio is null or char_length(bio) <= 600);
exception when duplicate_object then null; end $$;


-- ---------------------------------------------------------------------
-- 3. Les vues de la page et les statistiques privées
-- ---------------------------------------------------------------------

create table if not exists public.artiste_vues (
  artist_handle text    not null check (artist_handle = lower(btrim(artist_handle)) and char_length(artist_handle) between 1 and 80),
  jour          date    not null default current_date,
  nb            integer not null default 0,
  primary key (artist_handle, jour)
);

alter table public.artiste_vues enable row level security;
revoke all on table public.artiste_vues from anon, authenticated;

-- Une vue de plus pour cette page (le site n'en envoie qu'une par artiste et par visite).
create or replace function public.artiste_vue(p_handle text) returns void
language plpgsql security definer set search_path to 'public' as $$
declare v_h text := lower(btrim(coalesce(p_handle, '')));
begin
  if v_h = '' or char_length(v_h) > 80 then return; end if;
  if not exists (select 1 from public.artists a where lower(a.instagram_handle) = v_h) then return; end if;
  insert into public.artiste_vues (artist_handle, jour, nb) values (v_h, current_date, 1)
  on conflict (artist_handle, jour) do update set nb = public.artiste_vues.nb + 1;
end $$;

grant execute on function public.artiste_vue(text) to anon, authenticated;

create or replace function public.artiste_stats(p_handle text, p_jours integer default 30) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_h     text := lower(btrim(coalesce(p_handle, '')));
  v_jours integer := greatest(least(coalesce(p_jours, 30), 365), 7);
begin
  if not public.artiste_galerie_gerer(v_h) then
    raise exception 'Les statistiques sont réservées à l''artiste et à l''équipe.';
  end if;

  return jsonb_build_object(
    'jours', v_jours,
    'vues_total', coalesce((select sum(nb) from public.artiste_vues where artist_handle = v_h and jour > current_date - v_jours), 0),
    'vues', (select coalesce(jsonb_agg(jsonb_build_object('jour', d.jour, 'nb', coalesce(v.nb, 0)) order by d.jour), '[]'::jsonb)
               from (select (current_date - n)::date as jour from generate_series(0, v_jours - 1) as n) d
               left join public.artiste_vues v on v.artist_handle = v_h and v.jour = d.jour),
    'abonnes', (select count(*) from public.artiste_suivis where artist_handle = v_h),
    'abonnes_nouveaux', (select count(*) from public.artiste_suivis where artist_handle = v_h and cree_le > now() - make_interval(days => v_jours)),
    'sorties', (select count(*) from public.submissions s where s.status = 'approved' and lower(coalesce(s.artist_handle, '')) = v_h),
    'en_collection', (select count(distinct r.user_id) from public.release_ratings r
                        join public.submissions s on s.id = r.release_id
                       where lower(coalesce(s.artist_handle, '')) = v_h and (r.saved or r.favori or r.a_ecouter)),
    'note_moyenne', (select round(avg(rating)::numeric / 2, 1) from public.artist_ratings where artist_handle = v_h and rating is not null),
    'nb_notes', (select count(*) from public.artist_ratings where artist_handle = v_h and rating is not null),
    'top_sorties', (select coalesce(jsonb_agg(to_jsonb(t) order by t.nb desc), '[]'::jsonb) from (
                      select s.id, s.track_title as titre, s.cover_url as cover, count(distinct r.user_id) as nb
                        from public.submissions s
                        join public.release_ratings r on r.release_id = s.id and (r.saved or r.favori or r.a_ecouter or r.rating is not null)
                       where s.status = 'approved' and lower(coalesce(s.artist_handle, '')) = v_h
                       group by s.id, s.track_title, s.cover_url
                       order by count(distinct r.user_id) desc limit 5) t)
  );
end $$;

grant execute on function public.artiste_stats(text, integer) to authenticated;
