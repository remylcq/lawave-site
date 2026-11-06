-- ============================================================
-- Page artiste : galerie de photos, artistes similaires, suivre un artiste.
--
-- Retours des testeurs :
--   * « une catégorie Galerie sur la page artiste : l'artiste ajoute des photos, les admins aussi, avec le crédit du photographe ;
--     l'onglet n'est pas affiché s'il n'y a pas de photos »
--   * « une recommandation d'artistes similaires en bas de page, assez discrète »
--   * « pouvoir suivre des artistes et recevoir une notification quand il y a une actu à leur sujet »
--
-- 1. artiste_photos      les photos de la galerie (fichiers dans le bucket public « Covers », dossier galerie-…)
--    artiste_galerie(handle)                    -> { photos: [...], peut_gerer: bool }
--    artiste_photo_ajouter(handle, url, credit) -> l'équipe, ou l'artiste dont la page est vérifiée à son compte
--    artiste_photo_supprimer(id)                -> idem, ou la personne qui a ajouté la photo
-- 2. artiste_suivis      qui suit quel artiste
--    artiste_suivi(handle)                      -> { suit, nb }
--    artiste_suivre(handle, suivre)             -> { suit, nb }
--    engagement_sorties() prévient aussi ceux qui suivent l'artiste d'une sortie (en tête d'affiche ou en featuring),
--    sans compter dans la limite de 3 annonces par jour.
-- 3. artistes_similaires(handle, limite)        -> les artistes qui ont collaboré avec lui, puis ceux de sa ville, puis de son style.
--
-- Peut être rejoué sans risque.
--
-- RETRAIT : drop function if exists public.artiste_galerie(text), public.artiste_photo_ajouter(text, text, text),
--   public.artiste_photo_supprimer(uuid), public.artiste_suivi(text), public.artiste_suivre(text, boolean),
--   public.artistes_similaires(text, integer); drop table if exists public.artiste_photos, public.artiste_suivis;
--   (et remettre engagement_sorties() tel que dans sql/engagement.sql)
-- ============================================================


-- ---------------------------------------------------------------------
-- 1. La galerie
-- ---------------------------------------------------------------------

create table if not exists public.artiste_photos (
  id            uuid primary key default gen_random_uuid(),
  artist_handle text not null check (artist_handle = lower(btrim(artist_handle)) and char_length(artist_handle) between 1 and 80),
  url           text not null check (char_length(url) <= 400
                  and url like 'https://bqataeghgjyiqrnnesqq.supabase.co/storage/v1/object/public/Covers/galerie-%'),
  credit        text check (credit is null or char_length(credit) <= 120),
  ajoute_par    uuid references public.profiles(id) on delete set null,
  cree_le       timestamptz not null default now()
);

create index if not exists artiste_photos_artiste_idx on public.artiste_photos (artist_handle, cree_le desc);

alter table public.artiste_photos enable row level security;
revoke all on table public.artiste_photos from anon, authenticated;

-- Qui peut gérer la galerie d'un artiste : l'équipe, et l'artiste dont la page est vérifiée à son compte.
create or replace function public.artiste_galerie_gerer(p_handle text) returns boolean
language sql stable security definer set search_path to 'public' as $$
  select auth.uid() is not null and (
    public.est_equipe()
    or exists (select 1 from public.artists a where lower(a.instagram_handle) = lower(btrim(p_handle)) and a.verifie_par = auth.uid())
  )
$$;

create or replace function public.artiste_galerie(p_handle text) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare v_h text := lower(btrim(coalesce(p_handle, '')));
begin
  return jsonb_build_object(
    'peut_gerer', public.artiste_galerie_gerer(v_h),
    'photos', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'url', f.url, 'credit', f.credit, 'cree_le', f.cree_le,
                          'peut_supprimer', public.artiste_galerie_gerer(v_h) or f.ajoute_par = auth.uid())
                        order by f.cree_le desc)
                          from public.artiste_photos f where f.artist_handle = v_h), '[]'::jsonb));
end $$;

create or replace function public.artiste_photo_ajouter(p_handle text, p_url text, p_credit text default null) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_h text := lower(btrim(coalesce(p_handle, ''))); v_credit text := nullif(btrim(coalesce(p_credit, '')), ''); v_id uuid;
begin
  if auth.uid() is null then raise exception 'Connecte-toi pour ajouter une photo.'; end if;
  if not public.artiste_galerie_gerer(v_h) then raise exception 'Seuls l''artiste et l''équipe peuvent ajouter des photos.'; end if;
  if (select count(*) from public.artiste_photos where artist_handle = v_h) >= 40 then
    raise exception 'La galerie est pleine : 40 photos au plus.';
  end if;
  insert into public.artiste_photos (artist_handle, url, credit, ajoute_par) values (v_h, btrim(p_url), v_credit, auth.uid())
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.artiste_photo_supprimer(p_id uuid) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare f record;
begin
  if auth.uid() is null then raise exception 'Connecte-toi.'; end if;
  select * into f from public.artiste_photos where id = p_id;
  if not found then return jsonb_build_object('ok', true); end if;
  if not (public.artiste_galerie_gerer(f.artist_handle) or f.ajoute_par = auth.uid()) then
    raise exception 'Tu ne peux pas retirer cette photo.';
  end if;
  delete from public.artiste_photos where id = p_id;
  return jsonb_build_object('ok', true);
end $$;


-- ---------------------------------------------------------------------
-- 2. Suivre un artiste
-- ---------------------------------------------------------------------

create table if not exists public.artiste_suivis (
  user_id       uuid not null references public.profiles(id) on delete cascade,
  artist_handle text not null check (artist_handle = lower(btrim(artist_handle)) and char_length(artist_handle) between 1 and 80),
  cree_le       timestamptz not null default now(),
  primary key (user_id, artist_handle)
);

create index if not exists artiste_suivis_artiste_idx on public.artiste_suivis (artist_handle);

alter table public.artiste_suivis enable row level security;
revoke all on table public.artiste_suivis from anon, authenticated;

create or replace function public.artiste_suivi(p_handle text) returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'suit', auth.uid() is not null and exists (select 1 from public.artiste_suivis f where f.user_id = auth.uid() and f.artist_handle = lower(btrim(p_handle))),
    'nb',   (select count(*) from public.artiste_suivis f where f.artist_handle = lower(btrim(p_handle))))
$$;

create or replace function public.artiste_suivre(p_handle text, p_suivre boolean) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_h text := lower(btrim(coalesce(p_handle, '')));
begin
  if auth.uid() is null then raise exception 'Connecte-toi pour suivre un artiste.'; end if;
  if v_h = '' then raise exception 'Artiste inconnu.'; end if;
  if coalesce(p_suivre, true) then
    if (select count(*) from public.artiste_suivis where user_id = auth.uid()) >= 300 then
      raise exception 'Tu suis déjà 300 artistes : retire-en quelques-uns.';
    end if;
    insert into public.artiste_suivis (user_id, artist_handle) values (auth.uid(), v_h) on conflict do nothing;
  else
    delete from public.artiste_suivis where user_id = auth.uid() and artist_handle = v_h;
  end if;
  return public.artiste_suivi(v_h);
end $$;

-- Les annonces de sorties : celles de l'artiste (ou où il est invité) arrivent à ceux qui le suivent, sans limite quotidienne.
create or replace function public.engagement_sorties()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record; u record; v_n integer := 0; v_plafond constant integer := 3;
begin
  for r in
    select s.id, s.catalog_number, s.track_title, s.artist_name, s.cover_url, s.release_date, s.artist_norme,
           lower(s.artist_handle) as handle, coalesce(s.featuring, '[]'::jsonb) as featuring
      from public.submissions s
     where s.status = 'approved' and not coalesce(s.banni, false)
       and s.release_date between public.xp_jour() - 2 and public.xp_jour()
       and not exists (select 1 from public.sorties_notifiees x where x.release_id = s.id)
     order by s.release_date desc
     limit 300
  loop
    insert into public.sorties_notifiees (release_id) values (r.id) on conflict do nothing;

    for u in
      select t.user_id, min(t.type) as type, bool_or(t.suivi) as suivi
        from (
          select rr.user_id, 'sortie_a_ecouter' as type, false as suivi
            from public.release_ratings rr
           where rr.release_id = r.id and coalesce(rr.a_ecouter, false)
          union all
          select rr.user_id, 'sortie_artiste', false
            from public.submissions o
            join public.release_ratings rr on rr.release_id = o.id
           where r.artist_norme is not null and r.artist_norme <> ''
             and o.artist_norme = r.artist_norme and o.id <> r.id
             and (coalesce(rr.rating, 0) >= 7 or coalesce(rr.favori, false))
          union all
          select f.user_id, 'sortie_artiste', true
            from public.artiste_suivis f
           where f.artist_handle = r.handle
              or exists (select 1 from jsonb_array_elements(r.featuring) fe where lower(fe ->> 'handle') = f.artist_handle)
        ) t
       group by t.user_id
    loop
      if u.suivi or (select count(*) from public.com_notifications n
           where n.user_id = u.user_id and n.type in ('sortie_artiste', 'sortie_a_ecouter')
             and n.cree_le > now() - interval '1 day') < v_plafond then
        perform public.com_notifier_systeme(u.user_id, u.type, 'sortie:' || r.id::text, jsonb_build_object(
          'release', r.id, 'numero', r.catalog_number, 'titre', r.track_title, 'artiste', r.artist_name,
          'cover', r.cover_url, 'date', r.release_date));
        v_n := v_n + 1;
      end if;
    end loop;
  end loop;

  return v_n;
end $$;


-- ---------------------------------------------------------------------
-- 3. Les artistes similaires
-- ---------------------------------------------------------------------

create or replace function public.artistes_similaires(p_handle text, p_limite integer default 8) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare v_h text := lower(btrim(coalesce(p_handle, ''))); v_ville text; v_genre integer;
begin
  select a.ville into v_ville from public.artists a where lower(a.instagram_handle) = v_h;

  select s.genre_id into v_genre
    from public.submissions s
   where lower(s.artist_handle) = v_h and s.status = 'approved' and s.genre_id is not null
   group by s.genre_id order by count(*) desc limit 1;

  return coalesce((
    select jsonb_agg(jsonb_build_object('handle', q.handle, 'nom', q.nom, 'photo', q.photo, 'ville', q.ville) order by q.score desc, q.fans desc nulls last)
    from (
      select lower(a.instagram_handle) as handle, a.display_name as nom, a.photo_url as photo, a.ville, a.deezer_fans as fans,
             (case when c.h is not null then 5 else 0 end)
             + (case when v_ville is not null and a.ville = v_ville then 2 else 0 end)
             + (case when g.h is not null then 1 else 0 end) as score
        from public.artists a
        left join (
          select lower(fe ->> 'handle') as h
            from public.submissions s, jsonb_array_elements(s.featuring) fe
           where lower(s.artist_handle) = v_h and s.status = 'approved'
          union
          select lower(s.artist_handle)
            from public.submissions s
           where s.featuring @> jsonb_build_array(jsonb_build_object('handle', v_h)) and s.status = 'approved'
        ) c on c.h = lower(a.instagram_handle)
        left join (
          select distinct lower(s.artist_handle) as h
            from public.submissions s
           where v_genre is not null and s.genre_id = v_genre and s.status = 'approved'
        ) g on g.h = lower(a.instagram_handle)
       where lower(a.instagram_handle) <> v_h
         and not coalesce(a.banni, false)
         and coalesce(a.francophone, true)
         and (c.h is not null or (v_ville is not null and a.ville = v_ville) or g.h is not null)
         and exists (select 1 from public.submissions s where lower(s.artist_handle) = lower(a.instagram_handle) and s.status = 'approved')
       order by score desc, a.deezer_fans desc nulls last
       limit greatest(1, least(coalesce(p_limite, 8), 12))
    ) q
  ), '[]'::jsonb);
end $$;

revoke all on function public.artiste_galerie_gerer(text), public.artiste_galerie(text), public.artiste_photo_ajouter(text, text, text),
  public.artiste_photo_supprimer(uuid), public.artiste_suivi(text), public.artiste_suivre(text, boolean),
  public.artistes_similaires(text, integer) from public;
grant execute on function public.artiste_galerie(text), public.artiste_suivi(text), public.artistes_similaires(text, integer) to anon, authenticated;
grant execute on function public.artiste_galerie_gerer(text), public.artiste_photo_ajouter(text, text, text),
  public.artiste_photo_supprimer(uuid), public.artiste_suivre(text, boolean) to authenticated;
