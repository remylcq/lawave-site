-- Pourquoi bannir ou refuser un artiste expirait (« canceling statement due to statement timeout ») : deux tâches planifiées
-- (langue-titres chaque minute, jeu-fans toutes les 3 minutes) font des appels à Deezer en boucle, pendant jusqu'à 60-70 s,
-- DANS UNE SEULE TRANSACTION, et modifient les profils au fil de l'eau. Les verrous sur les lignes modifiées (profils, et
-- les sorties de l'artiste via le déclencheur artists_langue_propager) restaient donc tenus jusqu'à la fin de la tâche : une
-- action de l'équipe sur le même artiste attendait jusqu'à 110 s et dépassait la limite de 8 s.
-- Correctif : les deux tâches lisent d'abord tout chez Deezer en gardant les résultats de côté, puis écrivent d'un seul coup
-- à la fin (verrous tenus une fraction de seconde). Comportement et règles inchangés. (Passé en production le 2026-11-12.)
-- RETRAIT : remettre les versions de sql/langue-titres.sql (langue_verifier_titres) et l'ancienne jeu_fans_importer (boucle
--   avec mise à jour à chaque artiste).

create or replace function public.langue_verifier_titres(p_lot integer default 30)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_debut timestamptz := clock_timestamp();
  a       record;
  v_rep   http_response;
  v_titres text[];
  v_n     integer;
  v_pt    integer;
  v_faits integer := 0;
  v_bresil integer := 0;
begin
  if not pg_try_advisory_xact_lock(hashtext('langue_verifier_titres')) then
    return jsonb_build_object('ignore', true);
  end if;

  begin perform http_set_curlopt('CURLOPT_TIMEOUT', '10'); exception when others then null; end;

  create temp table if not exists tmp_langue_res (id uuid, bresil boolean) on commit drop;
  truncate tmp_langue_res;

  for a in
    select id, deezer_artist_id, langue_source
      from public.artists
     where francophone is true and langue_titres_le is null and deezer_artist_id is not null
       and coalesce(banni, false) = false and langue_source in ('collaborations', 'tri-auto')
     order by (langue_source = 'collaborations') desc, id
     limit greatest(least(p_lot, 60), 1)
  loop
    exit when clock_timestamp() - v_debut > interval '60 seconds';

    v_titres := null;
    begin
      v_rep := http_get('https://api.deezer.com/artist/' || a.deezer_artist_id || '/albums?limit=30');
      if v_rep.status = 200 and (v_rep.content::jsonb -> 'error') is null then
        v_titres := array(select btrim(t ->> 'title') from jsonb_array_elements(coalesce(v_rep.content::jsonb -> 'data', '[]'::jsonb)) t);
      end if;
    exception when others then
      v_titres := null;
    end;
    perform pg_sleep(0.2);

    -- Pas de réponse : on réessaiera au prochain passage.
    continue when v_titres is null;

    v_n  := coalesce(cardinality(v_titres), 0);
    v_pt := (select count(*) from unnest(v_titres) t where public.titre_portugais_large(t));

    insert into tmp_langue_res values (a.id, (v_n >= 3 and v_pt >= 2 and v_pt::float / v_n >= 0.25));
  end loop;

  -- Écriture d'un coup, à la fin : les verrous ne durent plus.
  update public.artists ar
     set francophone = false, deezer_suivi = false, langue_source = 'titres', langue_titres_le = now(), langue_le = now()
    from tmp_langue_res r where ar.id = r.id and r.bresil;
  get diagnostics v_bresil = row_count;

  update public.artists ar
     set langue_titres_le = now(), deezer_suivi = true
    from tmp_langue_res r where ar.id = r.id and not r.bresil;

  select count(*) into v_faits from tmp_langue_res;

  return jsonb_build_object('verifies', v_faits, 'non_francophones', v_bresil,
    'restants', (select count(*) from public.artists where francophone is true and langue_titres_le is null
                   and deezer_artist_id is not null and coalesce(banni, false) = false and langue_source in ('collaborations', 'tri-auto')));
end $$;
revoke all on function public.langue_verifier_titres(integer) from public, anon, authenticated;


create or replace function public.jeu_fans_importer(p_lot integer default 200)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_debut timestamptz := clock_timestamp();
  a record; v_rep http_response; v_json jsonb;
  v_n integer := 0; v_err integer := 0; v_stop boolean := false;
begin
  if not pg_try_advisory_xact_lock(hashtext('jeu_fans_importer')) then
    return jsonb_build_object('ignore', true);
  end if;

  begin
    perform http_set_curlopt('CURLOPT_TIMEOUT', '10');
  exception when others then
    null;
  end;

  create temp table if not exists tmp_fans_res (id uuid, fans bigint) on commit drop;
  truncate tmp_fans_res;

  for a in
    select id, deezer_artist_id
      from public.artists
     where deezer_artist_id is not null
       and (deezer_fans_le is null or deezer_fans_le < now() - interval '30 days')
     order by deezer_fans_le nulls first, id
     limit greatest(p_lot, 1)
  loop
    exit when v_stop or clock_timestamp() - v_debut > interval '70 seconds';

    begin
      v_rep := http_get('https://api.deezer.com/artist/' || a.deezer_artist_id);

      if v_rep.status <> 200 then
        v_err := v_err + 1;
      else
        v_json := v_rep.content::jsonb;

        if (v_json -> 'error') is not null then
          if (v_json -> 'error' ->> 'code') = '4' then
            v_stop := true;
          else
            insert into tmp_fans_res values (a.id, 0);
          end if;
        else
          insert into tmp_fans_res values (a.id, coalesce((v_json ->> 'nb_fan')::bigint, 0));
        end if;
      end if;
    exception when others then
      v_err := v_err + 1;
    end;

    perform pg_sleep(0.12);
  end loop;

  -- Écriture d'un coup, à la fin : les verrous sur les profils ne durent plus.
  update public.artists ar set deezer_fans = r.fans, deezer_fans_le = now()
    from tmp_fans_res r where ar.id = r.id;
  select count(*) into v_n from tmp_fans_res;

  return jsonb_build_object(
    'faits', v_n, 'erreurs', v_err, 'quota', v_stop,
    'restants', (select count(*) from public.artists
                  where deezer_artist_id is not null and (deezer_fans_le is null or deezer_fans_le < now() - interval '30 days')));
end $$;


-- 2e cause (la vraie pour « Dj Moçin Do SD », 106 s pour une seule sortie) : l'import Deezer (importer_sorties_deezer) travaille
-- dans une transaction de plus d'une minute et garde les sorties de l'artiste verrouillées ; bannir ou décider attendait la
-- fin de l'import. Le bannissement et la décision par artiste passent maintenant les lignes verrouillées (FOR UPDATE SKIP
-- LOCKED) ; le rattrapage de chaque minute (bannissements_appliquer) termine ce qui restait. Mesuré : 106 s -> 0,23 s.
do $$
declare d text; d2 text;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p where p.pronamespace='public'::regnamespace and p.proname='bannir_artiste';
  d2 := replace(d, E'  update public.submissions s
     set banni = true
   where not s.banni
     and (s.artist_handle = any(v_handles)
       or (v_norme is not null and (s.artist_norme = v_norme or s.artist_handle_norme = v_norme)));',
                   E'  update public.submissions s
     set banni = true
   where s.id in (select x.id from public.submissions x
                   where not x.banni
                     and (x.artist_handle = any(v_handles)
                       or (v_norme is not null and (x.artist_norme = v_norme or x.artist_handle_norme = v_norme)))
                     for update skip locked);');
  if d2 = d then raise exception 'motif introuvable'; end if;
  execute d2;
end $$;

create or replace function public.attente_artiste_traiter(p_handle text, p_valider boolean, p_motif text default '')
returns integer
language plpgsql security definer set search_path to 'public' as $$
declare v_n integer;
begin
  if auth.uid() is null or not public.est_equipe() then
    raise exception 'Réservé à l''équipe.';
  end if;
  if nullif(btrim(coalesce(p_handle, '')), '') is null then
    raise exception 'Indique l''artiste.';
  end if;

  if p_valider then
    update public.submissions set status = 'approved', validated_at = now(), validated_by = null
     where id in (select x.id from public.submissions x
                   where x.artist_handle = p_handle and x.status = 'pending' and x.source is not null and not x.banni and not x.hors_langue
                     for update skip locked);
  else
    update public.submissions set status = 'rejected', rejection_reason = coalesce(p_motif, ''), validated_at = now()
     where id in (select x.id from public.submissions x
                   where x.artist_handle = p_handle and x.status = 'pending' and x.source is not null and not x.banni and not x.hors_langue
                     for update skip locked);
  end if;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Pseudo sans profil (profil supprimé, sorties restées) : bannir par pseudo répondait « Profil introuvable » et ne masquait
-- rien. Le site bannit alors par le nom, puis masque les sorties du pseudo avec cette fonction (lignes tenues par l'import
-- laissées, le rattrapage termine). RETRAIT : drop function public.attente_artiste_masquer(text);
create or replace function public.attente_artiste_masquer(p_handle text)
returns integer
language plpgsql security definer set search_path to 'public' as $$
declare v_n integer;
begin
  if auth.uid() is null or not public.est_equipe() then
    raise exception 'Réservé à l''équipe.';
  end if;
  if nullif(btrim(coalesce(p_handle, '')), '') is null then
    raise exception 'Indique l''artiste.';
  end if;

  update public.submissions set banni = true
   where id in (select x.id from public.submissions x where x.artist_handle = p_handle and not x.banni for update skip locked);
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.attente_artiste_masquer(text) from public, anon;
grant execute on function public.attente_artiste_masquer(text) to authenticated;

-- 3e cause (bannissements qui « reviennent », Mc Pikachu) : le rattrapage des bannissements (tâche bannissements-rattrapage,
-- chaque minute) traitait toute la file d'un coup (2 344 bannissements) : il expirait à chaque passage, annulé en entier,
-- sans rien faire avancer, et gardait pendant ce temps les sorties verrouillées. Il traite maintenant la file par tranches de
-- 30 secondes (un bannissement qui échoue est retiré de la file). RETRAIT : remettre la version précédente (boucle sans limite).
create or replace function public.bannissements_rattrapage() returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_ban uuid; v_n integer := 0; v_feats integer := 0; v_abandon integer := 0; v_debut timestamptz := clock_timestamp(); v_restants integer;
begin
  if not pg_try_advisory_xact_lock(hashtext('bannissements_rattrapage')) then
    return jsonb_build_object('ignore', true);
  end if;
  if not exists (select 1 from public.bannissements_a_appliquer) then return jsonb_build_object('rien', true); end if;

  perform set_config('statement_timeout', '60s', true);
  perform public.bannissements_appliquer();

  for v_ban in select q.ban_id from public.bannissements_a_appliquer q order by q.demande_le loop
    exit when clock_timestamp() - v_debut > interval '40 seconds';
    begin
      perform set_config('statement_timeout', '8s', true);
      v_feats := v_feats + public.bannissement_featurings(v_ban);
    exception
      when query_canceled then v_abandon := v_abandon + 1;   -- un bannissement trop lourd (plus de 100 s à lui seul) est abandonné
      when others then v_abandon := v_abandon + 1;
    end;
    delete from public.bannissements_a_appliquer where ban_id = v_ban;
    v_n := v_n + 1;
  end loop;

  perform set_config('statement_timeout', '60s', true);
  select count(*) into v_restants from public.bannissements_a_appliquer;
  return jsonb_build_object('bans', v_n, 'featurings', v_feats, 'abandonnes', v_abandon, 'restants', v_restants);
end $$;

-- Nettoyage du 2026-11-12 : 16 970 artistes à 0 sortie publiée bannis (par pseudo et page Deezer, sans nom normalisé, pour ne
-- pas masquer d'homonymes) puis supprimés, avec les sorties qui restaient. La table des bannis est passée de ~5 800 à ~22 800
-- lignes : artiste_banni (appelée à chaque ajout de sortie ou de profil) devenait trop lente (0,5 s) -> index + réécriture
-- par recherches indexées (6 ms). RETRAIT : drop index artistes_bannis_*_idx ; remettre l'ancienne artiste_banni (via ban_correspond).
create index if not exists artistes_bannis_handle_idx on public.artistes_bannis (instagram_handle) where instagram_handle is not null;
create index if not exists artistes_bannis_deezer_idx on public.artistes_bannis (deezer_artist_id) where deezer_artist_id is not null;
create index if not exists artistes_bannis_deezer_ids_idx on public.artistes_bannis using gin (deezer_ids);
create index if not exists artistes_bannis_norme_idx on public.artistes_bannis (nom_norme) where nom_norme is not null;

create or replace function public.artiste_banni(p_handle text, p_nom text, p_deezer bigint) returns boolean
language sql stable as $$
  select exists (select 1 from public.artistes_bannis b where coalesce(p_handle, '') <> '' and b.instagram_handle = p_handle)
      or exists (select 1 from public.artistes_bannis b where p_deezer is not null and (b.deezer_artist_id = p_deezer or b.deezer_ids @> array[p_deezer]))
      or exists (select 1 from public.artistes_bannis b
                  where b.nom_norme is not null
                    and b.nom_norme in (public.norme_artiste(p_nom), public.norme_artiste(regexp_replace(coalesce(p_handle, ''), '\.[0-9]+$', ''))));
$$;
