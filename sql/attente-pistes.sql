-- Espace équipe / soumissions : écouter un extrait d'une sortie encore en attente.
-- catalogue_pistes ne répond que pour les sorties validées ; celle-ci est réservée à l'équipe et marche pour toutes.
-- Les adresses d'extrait de Deezer expirent au bout d'un quart d'heure : l'appelant les relit s'il le faut.
-- (Passé en production le 2026-11-12.)
-- RETRAIT : drop function public.attente_pistes(uuid);

create or replace function public.attente_pistes(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_album bigint;
  v_rep   http_response;
  v_json  jsonb;
begin
  if auth.uid() is null or not public.est_equipe() then
    raise exception 'Réservé à l''équipe.';
  end if;

  select s.deezer_album_id into v_album from public.submissions s where s.id = p_id;
  if v_album is null then return '[]'::jsonb; end if;

  begin
    perform http_set_curlopt('CURLOPT_TIMEOUT', '8');
  exception when others then null;
  end;

  begin
    v_rep := http_get('https://api.deezer.com/album/' || v_album::text || '/tracks?limit=100');
  exception when others then
    return '[]'::jsonb;
  end;
  if v_rep.status <> 200 then return '[]'::jsonb; end if;

  v_json := v_rep.content::jsonb;
  if (v_json -> 'error') is not null then return '[]'::jsonb; end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'n',       q.rang,
             'titre',   q.titre,
             'artiste', q.artiste,
             'duree',   q.duree,
             'apercu',  q.apercu) order by q.rang)
      from (
        select row_number() over (order by coalesce((e.value ->> 'disk_number')::integer, 1),
                                           coalesce((e.value ->> 'track_position')::integer, 0), e.ordinality) as rang,
               btrim(e.value ->> 'title') as titre,
               nullif(btrim(coalesce(e.value -> 'artist' ->> 'name', '')), '') as artiste,
               coalesce((e.value ->> 'duration')::integer, 0) as duree,
               nullif(e.value ->> 'preview', '') as apercu
          from jsonb_array_elements(coalesce(v_json -> 'data', '[]'::jsonb)) with ordinality as e(value, ordinality)
         where btrim(coalesce(e.value ->> 'title', '')) <> ''
      ) q), '[]'::jsonb);
end $$;

revoke all on function public.attente_pistes(uuid) from public, anon;
grant execute on function public.attente_pistes(uuid) to authenticated;
