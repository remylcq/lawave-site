-- =====================================================================
-- La Wave — catalogue filtrable, en pages numérotées
--
-- Retour d'un utilisateur : « manque de filtre dans la liste, en tant que média
-- rap on s'y perd si sur le site il y a de tout » ; « option de filtrage (date,
-- style, projet ou single…) » ; « remplacer "Afficher plus" par des nombres ».
--
-- Trois choses :
--
--   1. LE STYLE. Deezer donne un genre à chaque album dans la liste d'un artiste
--      (genre_id : 116 = Rap / Hip Hop, 165 = R&B, 132 = Pop…). La colonne
--      submissions.genre_id le garde ; completer_styles_deezer() la remplit pour
--      les sorties déjà importées, puis la tient à jour (une relecture par artiste
--      et par jour, qui rattrape aussi les nouvelles sorties).
--
--   2. LA LISTE. catalogue_liste() rend UNE page du catalogue, selon les filtres
--      (texte, type, style, année, mois, origine) et l'ordre demandés, avec le
--      nombre total de résultats : de quoi dessiner « 1 2 3 … 388 ».
--
--   3. LA TÂCHE. deezer-styles : toutes les 2 minutes, 12 artistes. Elle s'arrête
--      d'elle-même (plus personne à lire) ; une heure environ pour tout rattraper.
--      Voir sql/catalogue-filtres-planification.sql.
--
-- Sans danger à rejouer.
-- =====================================================================

alter table public.submissions
  add column if not exists genre_id integer;

alter table public.artists
  add column if not exists deezer_styles_le timestamptz;


-- 1. Le style, lu chez Deezer

create or replace function public.completer_styles_deezer(p_lot integer default 12)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_debut     timestamptz := clock_timestamp();
  v_artiste   record;
  v_rep       http_response;
  v_json      jsonb;
  v_url       text;
  v_pages     integer;
  v_erreur    text;
  v_arret     boolean := false;
  v_nb        integer := 0;
  v_maj       integer := 0;
  v_n         integer;
begin

  if not pg_try_advisory_xact_lock(hashtext('completer_styles_deezer')) then
    return jsonb_build_object('ignore', 'un autre passage est déjà en cours');
  end if;

  begin
    perform http_set_curlopt('CURLOPT_TIMEOUT', '10');
  exception when others then
    null;
  end;

  for v_artiste in
    select a.id, a.deezer_artist_id
      from public.artists a
     where a.deezer_artist_id is not null
       and a.deezer_suivi
       and (a.deezer_styles_le is null or a.deezer_styles_le < now() - interval '1 day')
     order by a.deezer_styles_le nulls first, a.id
     limit greatest(p_lot, 1)
  loop

    exit when v_arret or clock_timestamp() - v_debut > interval '60 seconds';

    v_nb     := v_nb + 1;
    v_erreur := null;
    v_pages  := 0;
    v_url    := 'https://api.deezer.com/artist/' || v_artiste.deezer_artist_id || '/albums?limit=100';

    while v_url is not null and v_pages < 30 and not v_arret loop

      v_pages := v_pages + 1;
      v_json  := null;

      begin
        v_rep := http_get(v_url);
        if v_rep.status <> 200 then
          raise exception 'Deezer a répondu HTTP %', v_rep.status;
        end if;
        v_json := v_rep.content::jsonb;
      exception when others then
        v_erreur := sqlerrm;
        v_json   := null;
      end;

      perform pg_sleep(0.25);   -- Deezer limite à 50 requêtes toutes les 5 secondes

      exit when v_json is null;

      if (v_json->'error') is not null then
        if (v_json->'error'->>'code') = '4' then
          v_arret := true;
        end if;
        v_erreur := coalesce(v_json->'error'->>'message', 'erreur renvoyée par Deezer');
        exit;
      end if;

      with a as (
        select (e.value->>'id')::bigint as id,
               nullif(e.value->>'genre_id', '')::integer as genre
          from jsonb_array_elements(coalesce(v_json->'data', '[]'::jsonb)) as e
         where e.value->>'id' ~ '^[0-9]+$'
      )
      update public.submissions s
         set genre_id = a.genre
        from a
       where s.deezer_album_id = a.id
         and s.genre_id is distinct from a.genre;

      get diagnostics v_n = row_count;
      v_maj := v_maj + v_n;

      v_url := nullif(v_json->>'next', '');
    end loop;

    -- Un artiste en erreur est retenté dans une heure ; sinon, demain.
    if not v_arret then
      update public.artists
         set deezer_styles_le = case when v_erreur is null then now() else now() - interval '23 hours' end
       where id = v_artiste.id;
    end if;
  end loop;

  return jsonb_build_object('artistes', v_nb, 'sorties_mises_a_jour', v_maj, 'arret', v_arret);
end $$;

revoke all on function public.completer_styles_deezer(integer) from public, anon, authenticated;


-- 2. La liste filtrée, en pages
--
-- p_type     : 'Single', 'Projet' ou vide
-- p_style    : rap, rnb, pop, electro, afro, reggae, rock, autre, ou vide
--              (« rap » comprend aussi les sorties choisies à la main par La Wave)
-- p_annee    : année de sortie (0 ou vide : toutes) ; p_mois : 1 à 12 (avec l'année)
-- p_origine  : 'wave' = seulement les sorties choisies par La Wave
-- p_tri      : 'recent' (par défaut), 'ancien', 'az'

create or replace function public.catalogue_liste(
  p_q        text    default null,
  p_type     text    default null,
  p_style    text    default null,
  p_annee    integer default null,
  p_mois     integer default null,
  p_origine  text    default null,
  p_tri      text    default 'recent',
  p_limite   integer default 60,
  p_decalage integer default 0
)
returns jsonb
language plpgsql
stable
set search_path = public, extensions
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

grant execute on function public.catalogue_liste(text, text, text, integer, integer, text, text, integer, integer)
  to anon, authenticated;
