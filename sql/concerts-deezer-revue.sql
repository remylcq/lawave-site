-- Concerts importés de Deezer + revue hebdomadaire du vendredi (00 h, heure de Paris).
-- Passé en production le 2026-11-12.
--
-- 1. Concerts : l'API interne de Deezer (pipe.deezer.com, jeton anonyme) donne les concerts et festivals à venir
--    de chaque artiste suivi ; ils alimentent la table artiste_concerts (page artiste, filtre de la carte).
--    Les concerts ajoutés à la main ne sont jamais touchés. Un concert retiré à la main par l'artiste ou l'équipe
--    ne revient pas (table deezer_concerts_ignores). Rafraîchi toutes les 20 h par artiste.
-- 2. Revue du vendredi : à 00 h (Paris), tous les artistes suivis sont remis « à vérifier » : la tâche
--    deezer-import-sorties (nouveaux titres, projets, featurings) et la tâche concerts-deezer repassent sur tous.
--
-- RETRAIT : select cron.unschedule('concerts-deezer'); select cron.unschedule('revue-vendredi');
--   drop function public.synchroniser_concerts_deezer(integer), public.revue_hebdomadaire_deezer(boolean), public.deezer_jeton();
--   drop trigger artiste_concerts_ignorer on public.artiste_concerts; drop function public.artiste_concerts_ignorer();
--   drop table public.deezer_concerts_ignores; alter table public.artists drop column concerts_verifie_le;
--   alter table public.artiste_concerts drop column deezer_event_id, drop column source, drop column pays;

alter table public.artiste_concerts add column if not exists deezer_event_id bigint;
alter table public.artiste_concerts add column if not exists source text not null default 'manuel';
alter table public.artiste_concerts add column if not exists pays text;
create unique index if not exists artiste_concerts_deezer_uniq on public.artiste_concerts (deezer_event_id) where deezer_event_id is not null;

alter table public.artists add column if not exists concerts_verifie_le timestamptz;

create table if not exists public.deezer_concerts_ignores (
  deezer_event_id bigint primary key,
  cree_le timestamptz not null default now()
);
alter table public.deezer_concerts_ignores enable row level security;
revoke all on table public.deezer_concerts_ignores from anon, authenticated;

-- Un concert Deezer retiré à la main ne doit pas revenir à la synchronisation suivante.
create or replace function public.artiste_concerts_ignorer() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  if old.deezer_event_id is not null and coalesce(current_setting('lawave.concerts_sync', true), '') <> '1' then
    insert into public.deezer_concerts_ignores (deezer_event_id) values (old.deezer_event_id) on conflict do nothing;
  end if;
  return old;
end $$;
revoke all on function public.artiste_concerts_ignorer() from public, anon, authenticated;

drop trigger if exists artiste_concerts_ignorer on public.artiste_concerts;
create trigger artiste_concerts_ignorer before delete on public.artiste_concerts
  for each row execute function public.artiste_concerts_ignorer();

-- Jeton anonyme de l'API interne de Deezer (valable environ une heure).
create or replace function public.deezer_jeton() returns text
language plpgsql security definer set search_path = public, extensions as $$
declare v_rep http_response;
begin
  v_rep := http_get('https://auth.deezer.com/login/anonymous?jo=p&rto=c');
  if v_rep.status <> 200 then return null; end if;
  return v_rep.content::jsonb->>'jwt';
exception when others then
  return null;
end $$;
revoke all on function public.deezer_jeton() from public, anon, authenticated;

create or replace function public.synchroniser_concerts_deezer(p_lot integer default 30)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_jeton    text;
  v_lot      record;
  v_hdl      text[] := '{}';
  v_dz       bigint[] := '{}';
  v_corps    text;
  v_rep      http_response;
  v_json     jsonb;
  v_node     jsonb;
  v_ev       jsonb;
  v_i        integer;
  v_id       bigint;
  v_date     date;
  v_ville    text;
  v_salle    text;
  v_nb       integer;
  v_vus      bigint[];
  v_ajoutes  integer := 0;
  v_retires  integer := 0;
  v_artistes integer := 0;
  v_erreur   text;
begin
  if not pg_try_advisory_xact_lock(hashtext('synchroniser_concerts_deezer')) then
    return jsonb_build_object('ignore', 'un autre passage est déjà en cours');
  end if;

  for v_lot in
    select a.id, lower(a.instagram_handle) as handle, a.deezer_artist_id
      from public.artists a
     where a.deezer_suivi and a.deezer_artist_id is not null
       and (a.concerts_verifie_le is null or a.concerts_verifie_le < now() - interval '20 hours')
     order by a.concerts_verifie_le nulls first, a.id
     limit greatest(least(p_lot, 40), 1)
  loop
    v_hdl := v_hdl || v_lot.handle;
    v_dz  := v_dz  || v_lot.deezer_artist_id;
  end loop;

  if coalesce(array_length(v_dz, 1), 0) = 0 then
    return jsonb_build_object('artistes', 0);
  end if;

  v_jeton := public.deezer_jeton();
  if v_jeton is null then return jsonb_build_object('erreur', 'jeton Deezer indisponible'); end if;

  v_corps := '{"operationName":"LiveEv","query":"query LiveEv { ';
  for v_i in 1..array_length(v_dz, 1) loop
    v_corps := v_corps || 'a' || v_i || ': artist(artistId: \"' || v_dz[v_i] || '\") { id liveEvents(first: 30, types: [CONCERT, FESTIVAL], statuses: [PENDING]) '
            || '{ edges { node { id name startDate cityName countryCode venue } } } } ';
  end loop;
  v_corps := v_corps || '}"}';

  begin
    perform http_set_curlopt('CURLOPT_TIMEOUT', '25');
  exception when others then null;
  end;

  begin
    v_rep := http(('POST', 'https://pipe.deezer.com/api',
                   array[http_header('Authorization', 'Bearer ' || v_jeton)], 'application/json', v_corps)::http_request);
    if v_rep.status <> 200 then raise exception 'Deezer a répondu HTTP %', v_rep.status; end if;
    v_json := v_rep.content::jsonb;
    if v_json->'data' is null then raise exception 'réponse sans données'; end if;
  exception when others then
    return jsonb_build_object('erreur', sqlerrm);
  end;

  perform set_config('lawave.concerts_sync', '1', true);

  for v_i in 1..array_length(v_dz, 1) loop
    v_node := v_json->'data'->('a' || v_i);
    continue when v_node is null or jsonb_typeof(v_node) <> 'object' or v_node->'liveEvents' is null;

    v_nb  := 0;
    v_vus := '{}';

    for v_ev in
      select e.value->'node' from jsonb_array_elements(coalesce(v_node->'liveEvents'->'edges', '[]'::jsonb)) e
    loop
      begin
        v_nb := v_nb + 1;
        v_id := nullif(v_ev->>'id', '')::bigint;
        continue when v_id is null;
        v_vus := v_vus || v_id;

        -- les forfaits et billets ne sont pas des concerts
        continue when coalesce(v_ev->>'name', '') ~* '^(forfait|pass |billet|ticket)';
        continue when exists (select 1 from public.deezer_concerts_ignores i where i.deezer_event_id = v_id);

        v_date  := ((v_ev->>'startDate')::timestamptz at time zone 'Europe/Paris')::date;
        continue when v_date < current_date or v_date > current_date + 800;

        v_ville := btrim(coalesce(v_ev->>'cityName', ''));
        continue when v_ville = '';
        if v_ville = upper(v_ville) then v_ville := initcap(lower(v_ville)); end if;
        v_salle := nullif(btrim(coalesce(v_ev->>'venue', '')), '');

        -- même artiste, même jour, même salle : déjà là (ajouté à la main ou doublon de billetterie)
        continue when exists (
          select 1 from public.artiste_concerts c
           where c.artist_handle = v_hdl[v_i] and c.date_concert = v_date
             and lower(coalesce(c.salle, '')) = lower(coalesce(v_salle, ''))
        );

        insert into public.artiste_concerts (artist_handle, date_concert, ville, salle, deezer_event_id, source, pays)
        values (v_hdl[v_i], v_date, left(v_ville, 80), left(v_salle, 120), v_id, 'deezer', nullif(v_ev->>'countryCode', ''))
        on conflict do nothing;
        if found then v_ajoutes := v_ajoutes + 1; end if;
      exception when others then
        v_erreur := coalesce(v_erreur, sqlerrm);
      end;
    end loop;

    -- Un concert Deezer qui a disparu (annulé) est retiré, sauf si la liste est tronquée.
    if v_nb < 30 then
      delete from public.artiste_concerts c
       where c.artist_handle = v_hdl[v_i] and c.source = 'deezer' and c.date_concert >= current_date
         and not (c.deezer_event_id = any(v_vus));
      get diagnostics v_nb = row_count;
      v_retires := v_retires + v_nb;
    end if;

    update public.artists set concerts_verifie_le = now() where deezer_artist_id = v_dz[v_i];
    v_artistes := v_artistes + 1;
  end loop;

  return jsonb_build_object('artistes', v_artistes, 'ajoutes', v_ajoutes, 'retires', v_retires, 'erreur', v_erreur);
end $$;
revoke all on function public.synchroniser_concerts_deezer(integer) from public, anon, authenticated;

-- Revue du vendredi, 00 h (Paris) : tous les artistes suivis repassent à « à vérifier ».
create or replace function public.revue_hebdomadaire_deezer(p_force boolean default false)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_paris timestamp := now() at time zone 'Europe/Paris';
  v_n     integer;
begin
  if not p_force and not (extract(isodow from v_paris) = 5 and extract(hour from v_paris) = 0) then
    return jsonb_build_object('ignore', 'ce n''est pas vendredi 00 h');
  end if;
  if not p_force and exists (
    select 1 from public.deezer_import_journal j where j.quand > now() - interval '12 hours' and j.detail->>'revue' = 'true'
  ) then
    return jsonb_build_object('ignore', 'la revue de cette semaine est déjà lancée');
  end if;

  update public.artists
     set deezer_verifie_le = null, concerts_verifie_le = null
   where deezer_suivi and deezer_artist_id is not null;
  get diagnostics v_n = row_count;

  insert into public.deezer_import_journal (artistes, ajoutees, erreurs, detail)
  values (v_n, 0, 0, jsonb_build_object('revue', true, 'artistes', v_n, 'lancee_le', now()));

  return jsonb_build_object('revue', true, 'artistes', v_n);
end $$;
revoke all on function public.revue_hebdomadaire_deezer(boolean) from public, anon, authenticated;

-- Planification : concerts toutes les 15 minutes (30 artistes par passage, chacun au plus toutes les 20 h) ;
-- revue : jeudi 22 h et 23 h UTC (= vendredi 00 h à Paris été / hiver), la fonction vérifie l'heure réelle.
select cron.schedule('concerts-deezer', '*/15 * * * *', $$ select public.synchroniser_concerts_deezer(30); $$);
select cron.schedule('revue-vendredi', '0 22,23 * * 4', $$ select public.revue_hebdomadaire_deezer(); $$);
