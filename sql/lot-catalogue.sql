-- ============================================================
-- Catalogue : « Cette semaine », « Surprends-moi » et « Autres versions ».
--
-- Demandes de Rémy (2026-11-09) :
--   1. une vue « Nouveautés de la semaine » ;
--   7. un bouton « Surprends-moi » : une sortie au hasard parmi celles que l'on n'a pas déjà notées ou gardées ;
--  14. les rééditions et versions deluxe rattachées à l'original, dans la fiche.
--
--   catalogue_liste(... , p_depuis date)  : un filtre de plus, « sorties depuis cette date » (le site envoie il y a 7 jours).
--                                           L'ancienne forme à 9 arguments est remplacée par celle-ci.
--   catalogue_hasard(p_type)              : UNE sortie publiée au hasard (mêmes champs qu'une ligne de catalogue_liste),
--                                           en laissant de côté celles que la personne connectée a déjà notées / gardées.
--   catalogue_versions(p_release)         : les autres versions de la même sortie (même artiste, même titre une fois
--                                           « Deluxe », « Réédition », « Version… » retirés).
--
-- Ouvert à tous (le catalogue est public). Peut être rejoué sans risque.
-- RETRAIT : drop function if exists public.catalogue_hasard(text), public.catalogue_versions(uuid), public.titre_base_sortie(text);
-- ============================================================

-- Le titre « de base » d'une sortie : sans les mentions d'édition entre parenthèses ou après un tiret.
create or replace function public.titre_base_sortie(p_titre text) returns text
language sql immutable set search_path to 'public', 'extensions' as $$
  select btrim(coalesce(public.titre_normalise(
    regexp_replace(
      regexp_replace(lower(coalesce(p_titre, '')),
        '\s*[\(\[][^\)\]]*(deluxe|luxe|r[ée]édition|reedition|[ée]dition|version|expanded|extended|remaster|anniversaire|anniversary|bonus|collector|platinum|gold|complet|complete|reloaded|ultimate|special|spécial)[^\)\]]*[\)\]]', '', 'g'),
      '\s+[-–—:]\s*(deluxe|luxe|r[ée]édition|reedition|[ée]dition|version|expanded|extended|remaster|anniversaire|anniversary|bonus|collector|platinum|gold|complet|complete|reloaded|ultimate|special|spécial).*$', '', 'g')
  ), ''));
$$;

drop function if exists public.catalogue_liste(text, text, text, integer, integer, text, text, integer, integer);

create or replace function public.catalogue_liste(
  p_q        text    default null,
  p_type     text    default null,
  p_style    text    default null,
  p_annee    integer default null,
  p_mois     integer default null,
  p_origine  text    default null,
  p_tri      text    default 'recent',
  p_limite   integer default 60,
  p_decalage integer default 0,
  p_depuis   date    default null
)
returns jsonb
language plpgsql
stable
set search_path to 'public', 'extensions'
as $$
declare
  v_q      text    := btrim(coalesce(public.titre_normalise(p_q), ''));
  v_motif  text;
  v_total  integer;
  v_lignes jsonb;
begin

  if length(v_q) >= 2 then
    v_motif := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  with f as (
    select s.*
      from public.submissions s
     where s.status = 'approved'
       and (s.release_date is null or s.release_date <= current_date)
       and (p_depuis is null or s.release_date >= p_depuis)
       and (v_motif is null or s.recherche_texte like v_motif escape '\')
       and (nullif(p_type, '') is null or s.release_type::text = p_type)
       and (nullif(p_origine, '') is distinct from 'wave' or s.source is null)
       and (coalesce(p_annee, 0) = 0 or extract(year from s.release_date) = p_annee)
       and (coalesce(p_annee, 0) = 0 or coalesce(p_mois, 0) = 0 or extract(month from s.release_date) = p_mois)
       and (
             nullif(p_style, '') is null
          or (p_style = 'rap'     and (s.source is null or s.genre_id = 116))
          or (p_style = 'rnb'     and s.genre_id in (165, 169))
          or (p_style = 'pop'     and s.genre_id = 132)
          or (p_style = 'electro' and s.genre_id in (106, 113))
          or (p_style = 'afro'    and s.genre_id = 2)
          or (p_style = 'reggae'  and s.genre_id = 144)
          or (p_style = 'rock'    and s.genre_id in (152, 464))
          or (p_style = 'autre'   and s.source is not null
                                  and (s.genre_id is null or s.genre_id not in (116, 165, 169, 132, 106, 113, 2, 144, 152, 464)))
           )
  ),
  p as (
    select f.*,
           row_number() over (
             order by
               case when p_tri = 'ancien' then f.release_date end asc nulls last,
               case when p_tri = 'ancien' then f.catalog_number end asc,
               case when p_tri = 'az'     then lower(f.track_title) end asc,
               case when coalesce(p_tri, 'recent') not in ('ancien', 'az') then f.release_date end desc nulls last,
               case when coalesce(p_tri, 'recent') not in ('ancien', 'az') then f.catalog_number end desc,
               f.id
           ) as rang
      from f
  )
  select (select count(*) from f)::integer,
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'id',               p.id,
                    'catalog_number',   p.catalog_number,
                    'track_title',      p.track_title,
                    'artist_name',      p.artist_name,
                    'artist_handle',    p.artist_handle,
                    'instagram_url',    p.instagram_url,
                    'cover_url',        p.cover_url,
                    'listen_url',       p.listen_url,
                    'spotify_url',      p.spotify_url,
                    'deezer_url',       p.deezer_url,
                    'apple_music_url',  p.apple_music_url,
                    'youtube_url',      p.youtube_url,
                    'clip_url',         p.clip_url,
                    'release_date',     p.release_date,
                    'release_type',     p.release_type,
                    'featuring',        p.featuring,
                    'source',           p.source,
                    'validated_at',     p.validated_at,
                    'validated_by',     p.validated_by
                  ) order by p.rang)
             from p
            where p.rang >  greatest(coalesce(p_decalage, 0), 0)
              and p.rang <= greatest(coalesce(p_decalage, 0), 0) + least(greatest(coalesce(p_limite, 60), 1), 120)
         ), '[]'::jsonb)
    into v_total, v_lignes;

  return jsonb_build_object('total', v_total, 'lignes', v_lignes);
end $$;

grant execute on function public.catalogue_liste(text, text, text, integer, integer, text, text, integer, integer, date)
  to anon, authenticated;


-- 7. Une sortie au hasard

create or replace function public.catalogue_hasard(p_type text default null) returns jsonb
language plpgsql stable set search_path to 'public', 'extensions' as $$
declare
  v_moi uuid := auth.uid();
  p     record;
begin

  select s.* into p
    from public.submissions s
   where s.status = 'approved'
     and not s.banni and not s.hors_langue
     and s.cover_url is not null
     and (s.release_date is null or s.release_date <= current_date)
     and (nullif(p_type, '') is null or s.release_type::text = p_type)
     and (v_moi is null or not exists (
           select 1 from public.release_ratings r
            where r.release_id = s.id and r.user_id = v_moi
              and (r.rating is not null or r.saved or r.favori or r.a_ecouter)))
   order by random()
   limit 1;

  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'id',               p.id,
    'catalog_number',   p.catalog_number,
    'track_title',      p.track_title,
    'artist_name',      p.artist_name,
    'artist_handle',    p.artist_handle,
    'instagram_url',    p.instagram_url,
    'cover_url',        p.cover_url,
    'listen_url',       p.listen_url,
    'spotify_url',      p.spotify_url,
    'deezer_url',       p.deezer_url,
    'apple_music_url',  p.apple_music_url,
    'youtube_url',      p.youtube_url,
    'clip_url',         p.clip_url,
    'release_date',     p.release_date,
    'release_type',     p.release_type,
    'featuring',        p.featuring,
    'source',           p.source,
    'validated_at',     p.validated_at,
    'validated_by',     p.validated_by
  );
end $$;

grant execute on function public.catalogue_hasard(text) to anon, authenticated;


-- 14. Les autres versions d'une sortie

create or replace function public.catalogue_versions(p_release uuid) returns jsonb
language plpgsql stable set search_path to 'public', 'extensions' as $$
declare
  s record;
  v_base text;
begin

  select * into s from public.submissions where id = p_release and status = 'approved';

  if not found then
    return '[]'::jsonb;
  end if;

  v_base := public.titre_base_sortie(s.track_title);

  if v_base = '' then
    return '[]'::jsonb;
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', t.id, 'titre', t.track_title, 'type', t.release_type,
             'date', t.release_date, 'cover', t.cover_url, 'num', t.catalog_number
           ) order by t.release_date nulls last, t.id)
      from public.submissions t
     where t.status = 'approved'
       and not t.banni and not t.hors_langue
       and t.id <> s.id
       and lower(btrim(t.artist_name)) = lower(btrim(s.artist_name))
       and (t.release_date is null or t.release_date <= current_date)
       and public.titre_base_sortie(t.track_title) = v_base
  ), '[]'::jsonb);
end $$;

grant execute on function public.catalogue_versions(uuid) to anon, authenticated;
