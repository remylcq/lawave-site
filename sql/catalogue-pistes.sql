-- ============================================================
-- Catalogue : les titres d'une sortie (tracklist) et un extrait de 30 secondes par titre.
--
-- Retour des testeurs : « quand on appuie sur un projet, voir les titres, avec les noms des feats » et
-- « sur les singles, pouvoir écouter un petit extrait ».
--
-- catalogue_pistes(p_release) lit l'album sur Deezer (http_get, comme les imports) et renvoie
--   [{ n, titre, artiste, duree, apercu }]
-- où « titre » contient déjà les featurings (« Titre (feat. X) »), « artiste » est l'artiste du titre (il peut différer de
-- celui de la sortie) et « apercu » l'adresse de l'extrait. Les adresses d'extrait de Deezer expirent : le résultat est
-- gardé 3 heures seulement, pour ne pas appeler Deezer à chaque ouverture de fiche.
--
-- Seules les sorties publiées, d'un artiste non banni, sont lues. Ouvert à tous (le catalogue est public).
-- Peut être rejoué sans risque.
--
-- RETRAIT : drop function if exists public.catalogue_pistes(uuid); drop table if exists public.catalogue_pistes_cache;
-- ============================================================

create table if not exists public.catalogue_pistes_cache (
  release_id uuid primary key references public.submissions(id) on delete cascade,
  pistes     jsonb not null default '[]'::jsonb check (jsonb_typeof(pistes) = 'array'),
  maj_le     timestamptz not null default now()
);

alter table public.catalogue_pistes_cache enable row level security;
revoke all on table public.catalogue_pistes_cache from anon, authenticated;

create or replace function public.catalogue_pistes(p_release uuid) returns jsonb
language plpgsql security definer set search_path to 'public', 'extensions' as $$
declare
  s       record;
  v_cache record;
  v_rep   http_response;
  v_json  jsonb;
  v_out   jsonb;
begin
  select * into s from public.submissions where id = p_release and status = 'approved' and not banni and not hors_langue;

  if not found or s.deezer_album_id is null then
    return '[]'::jsonb;
  end if;

  select c.pistes, c.maj_le into v_cache from public.catalogue_pistes_cache c where c.release_id = p_release;
  if found and v_cache.maj_le > now() - interval '3 hours' then
    return v_cache.pistes;
  end if;

  begin
    v_rep := http_get('https://api.deezer.com/album/' || s.deezer_album_id::text || '/tracks?limit=100');
  exception when others then
    return coalesce(v_cache.pistes, '[]'::jsonb);
  end;

  if v_rep.status <> 200 then
    return coalesce(v_cache.pistes, '[]'::jsonb);
  end if;

  v_json := v_rep.content::jsonb;
  if (v_json -> 'error') is not null then
    return coalesce(v_cache.pistes, '[]'::jsonb);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'n',       q.rang,
           'titre',   q.titre,
           'artiste', q.artiste,
           'duree',   q.duree,
           'apercu',  q.apercu) order by q.rang), '[]'::jsonb)
    into v_out
    from (
      select row_number() over (order by coalesce((e.value ->> 'disk_number')::integer, 1),
                                         coalesce((e.value ->> 'track_position')::integer, 0), e.ordinality) as rang,
             btrim(e.value ->> 'title') as titre,
             nullif(btrim(coalesce(e.value -> 'artist' ->> 'name', '')), '') as artiste,
             coalesce((e.value ->> 'duration')::integer, 0) as duree,
             nullif(e.value ->> 'preview', '') as apercu
        from jsonb_array_elements(coalesce(v_json -> 'data', '[]'::jsonb)) with ordinality as e(value, ordinality)
       where btrim(coalesce(e.value ->> 'title', '')) <> ''
    ) q;

  insert into public.catalogue_pistes_cache (release_id, pistes, maj_le) values (p_release, v_out, now())
  on conflict (release_id) do update set pistes = excluded.pistes, maj_le = excluded.maj_le;

  return v_out;
end $$;

revoke all on function public.catalogue_pistes(uuid) from public;
grant execute on function public.catalogue_pistes(uuid) to anon, authenticated;
