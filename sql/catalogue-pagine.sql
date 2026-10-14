-- =====================================================================
-- La Wave — un catalogue qui peut grossir
--
-- Jusqu'ici le site lisait TOUTES les sorties à chaque visite (1 100 environ).
-- Avec les discographies complètes des artistes (plusieurs dizaines de milliers
-- de sorties), il ne lit plus que les plus récentes, puis va chercher le reste
-- au besoin : la suite d'un « Afficher plus », une recherche, la page d'un
-- artiste, la collection d'un membre.
--
-- Ce que ça ajoute :
--   1. submissions.recherche_texte : titre + artiste + invités, sans accents ni
--      ponctuation, tenu à jour par un déclencheur et indexé (pg_trgm) : la
--      recherche reste instantanée sur cent mille lignes.
--   2. Des index pour l'ordre du catalogue (date de sortie), la page d'un artiste
--      et ses featurings.
--   3. catalogue_chercher(texte, limite, décalage) : les sorties publiées qui
--      correspondent, les plus récentes d'abord (mêmes champs que la lecture
--      publique du site).
--   4. catalogue_comptes_artistes() : combien de sorties publiées pour chaque
--      artiste (titulaire ou invité), pour la carte.
--
-- Rien ne change pour les visiteurs tant que le site n'utilise pas ces fonctions.
-- Sans danger à rejouer.
-- =====================================================================

create extension if not exists pg_trgm with schema extensions;


-- 1. Le texte de recherche

alter table public.submissions
  add column if not exists recherche_texte text;

create or replace function public.submissions_recherche_texte(
  p_titre text, p_artiste text, p_featuring jsonb
)
returns text
language sql
stable
set search_path = public, extensions
as $$
  select btrim(
    coalesce(public.titre_normalise(p_titre), '') || ' ' ||
    coalesce(public.titre_normalise(p_artiste), '') || ' ' ||
    coalesce((
      select string_agg(coalesce(public.titre_normalise(f.value ->> 'nom'), ''), ' ')
        from jsonb_array_elements(
               case when jsonb_typeof(p_featuring) = 'array' then p_featuring else '[]'::jsonb end
             ) as f(value)
    ), '')
  );
$$;

create or replace function public.submissions_recherche_maj()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  new.recherche_texte := public.submissions_recherche_texte(new.track_title, new.artist_name, new.featuring);
  return new;
end $$;

drop trigger if exists submissions_recherche_maj on public.submissions;

create trigger submissions_recherche_maj
  before insert or update of track_title, artist_name, featuring on public.submissions
  for each row
  execute function public.submissions_recherche_maj();

-- Les lignes déjà là (une fois).
update public.submissions
   set recherche_texte = public.submissions_recherche_texte(track_title, artist_name, featuring)
 where recherche_texte is null;


-- 2. Les index

create index if not exists submissions_recherche_trgm_idx
  on public.submissions using gin (recherche_texte extensions.gin_trgm_ops)
  where status = 'approved';

-- L'ordre du catalogue : la plus récente d'abord, puis le numéro de catalogue.
create index if not exists submissions_catalogue_ordre_idx
  on public.submissions (release_date desc nulls last, catalog_number desc)
  where status = 'approved';

create index if not exists submissions_artiste_publiees_idx
  on public.submissions (artist_handle)
  where status = 'approved';

create index if not exists submissions_featuring_publiees_idx
  on public.submissions using gin (featuring jsonb_path_ops)
  where status = 'approved';


-- 3. La recherche

create or replace function public.catalogue_chercher(
  p_q        text,
  p_limite   integer default 60,
  p_decalage integer default 0
)
returns jsonb
language sql
stable
set search_path = public, extensions
as $$
  with q as (
    select btrim(coalesce(public.titre_normalise(p_q), '')) as n
  )
  select coalesce(jsonb_agg(t.j order by t.rd desc nulls last, t.cn desc), '[]'::jsonb)
    from (
      select jsonb_build_object(
               'id',               s.id,
               'catalog_number',   s.catalog_number,
               'track_title',      s.track_title,
               'artist_name',      s.artist_name,
               'artist_handle',    s.artist_handle,
               'instagram_url',    s.instagram_url,
               'cover_url',        s.cover_url,
               'listen_url',       s.listen_url,
               'spotify_url',      s.spotify_url,
               'deezer_url',       s.deezer_url,
               'apple_music_url',  s.apple_music_url,
               'youtube_url',      s.youtube_url,
               'clip_url',         s.clip_url,
               'release_date',     s.release_date,
               'release_type',     s.release_type,
               'featuring',        s.featuring,
               'source',           s.source,
               'validated_at',     s.validated_at,
               'validated_by',     s.validated_by
             ) as j,
             s.release_date as rd,
             s.catalog_number as cn
        from public.submissions s, q
       where s.status = 'approved'
         and (s.release_date is null or s.release_date <= current_date)
         and length(q.n) >= 2
         and s.recherche_texte like '%' || replace(replace(replace(q.n, '\', '\\'), '%', '\%'), '_', '\_') || '%' escape '\'
       order by s.release_date desc nulls last, s.catalog_number desc
       limit least(greatest(coalesce(p_limite, 60), 1), 120)
      offset greatest(coalesce(p_decalage, 0), 0)
    ) t;
$$;


-- 4. Les comptes par artiste

create or replace function public.catalogue_comptes_artistes()
returns jsonb
language sql
stable
set search_path = public, extensions
as $$
  select coalesce(jsonb_object_agg(x.h, x.n), '{}'::jsonb)
    from (
      select u.h, count(*)::integer as n
        from (
          select s.artist_handle as h
            from public.submissions s
           where s.status = 'approved'
             and s.artist_handle is not null
             and (s.release_date is null or s.release_date <= current_date)
          union all
          select f.value ->> 'handle'
            from public.submissions s
           cross join lateral jsonb_array_elements(
                 case when jsonb_typeof(s.featuring) = 'array' then s.featuring else '[]'::jsonb end
               ) as f(value)
           where s.status = 'approved'
             and (s.release_date is null or s.release_date <= current_date)
        ) u
       where u.h is not null and u.h <> ''
       group by u.h
    ) x;
$$;


grant execute on function public.catalogue_chercher(text, integer, integer) to anon, authenticated;
grant execute on function public.catalogue_comptes_artistes()               to anon, authenticated;
