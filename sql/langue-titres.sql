-- Pourquoi tant de titres brésiliens dans l'import : un artiste est déclaré francophone « par collaborations » (langue_source =
-- 'collaborations') dès qu'il a plus de collaborateurs francophones que d'autres (un seul feat avec un rappeur français suffit),
-- ou « tri-auto ». Depuis que tous les artistes francophones du site sont suivis sur Deezer (déclencheur artists_suivi_auto),
-- ces DJ et MC de funk brésilien se sont retrouvés suivis, avec toute leur discographie, et chacun a entraîné ses propres
-- collaborateurs dans la même boucle. (Passé en production le 2026-11-12.)
--
-- Correctifs :
--  1. titre_portugais(titre) : le titre contient ã, õ ou un mot typiquement portugais (déjà utilisé pour vider les soumissions
--     et refuser à l'import les titres de ce genre : déclencheur submissions_ecarter_portugais).
--  2. Un artiste classé « par collaborations » n'est plus suivi automatiquement (déclencheur artists_suivi_auto) : il l'est
--     seulement après vérification de ses titres.
--  3. langue_verifier_titres(lot) : lit les titres de ses albums chez Deezer ; si au moins le quart est en portugais
--     (au moins 2), l'artiste passe en « non francophone » (masqué, plus suivi, ses sorties masquées) ; sinon il est
--     confirmé et suivi. Vérifie aussi les artistes « tri-auto ». Tâche planifiée chaque minute (30 artistes).
-- RETRAIT : select cron.unschedule('langue-titres'); drop function public.langue_verifier_titres(integer),
--   public.titre_portugais_large(text), public.titre_portugais(text); alter table public.artists drop column langue_titres_le;
--   drop trigger submissions_ecarter_portugais on public.submissions; drop function public.submissions_ecarter_portugais();

alter table public.artists add column if not exists langue_titres_le timestamptz;

create or replace function public.titre_portugais(p_titre text) returns boolean
language sql immutable as $$
  select coalesce(p_titre ~* '([ãõ]|\m(não|você|vocês|nós|saudade|coração|minha|minhas|meu|meus|obrigado|também|ainda|então|beijo|madrugada|favela|baile|paredão|automotivo|mtg)\M)', false)
$$;

-- Version plus large, pour juger un artiste sur l'ensemble de ses titres (pas pour écarter un titre seul).
create or replace function public.titre_portugais_large(p_titre text) returns boolean
language sql immutable as $$
  select public.titre_portugais(p_titre)
      or coalesce(p_titre ~* '\m(pra|pro|dela|novinha|putaria|puta|putas|montagem|senta|sentar|sentando|bota|botando|quebrada|ritmada|ritmado|sequencia|gostosa|piranha|safada|tá|tô|menor|favelado|bonde|toma)\M', false)
$$;

create or replace function public.submissions_ecarter_portugais() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  if new.source = 'deezer' and new.deezer_album_id is not null and public.titre_portugais(new.track_title) then
    insert into public.deezer_albums_ignores (deezer_album_id, raison) values (new.deezer_album_id, 'portugais') on conflict do nothing;
    return null;
  end if;
  return new;
end $$;
revoke all on function public.submissions_ecarter_portugais() from public, anon, authenticated;

drop trigger if exists submissions_ecarter_portugais on public.submissions;
create trigger submissions_ecarter_portugais before insert on public.submissions
  for each row execute function public.submissions_ecarter_portugais();

-- Pas de suivi automatique pour un artiste classé « par collaborations » : il faut d'abord vérifier ses titres.
create or replace function public.artists_suivi_auto() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  if new.deezer_artist_id is not null
     and coalesce(new.banni, false) = false
     and new.francophone is true
     and coalesce(new.langue_source, '') <> 'collaborations'
     and not coalesce(new.deezer_suivi, false)
     and (tg_op = 'INSERT'
          or new.deezer_artist_id is distinct from old.deezer_artist_id
          or new.francophone      is distinct from old.francophone
          or new.banni            is distinct from old.banni) then
    new.deezer_suivi := true;
  end if;
  return new;
end $$;

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

    if v_n >= 3 and v_pt >= 2 and v_pt::float / v_n >= 0.25 then
      update public.artists
         set francophone = false, deezer_suivi = false, langue_source = 'titres', langue_titres_le = now(), langue_le = now()
       where id = a.id;
      v_bresil := v_bresil + 1;
    else
      update public.artists
         set langue_titres_le = now(),
             deezer_suivi = true
       where id = a.id;
    end if;
    v_faits := v_faits + 1;
  end loop;

  return jsonb_build_object('verifies', v_faits, 'non_francophones', v_bresil,
    'restants', (select count(*) from public.artists where francophone is true and langue_titres_le is null
                   and deezer_artist_id is not null and coalesce(banni, false) = false and langue_source in ('collaborations', 'tri-auto')));
end $$;
revoke all on function public.langue_verifier_titres(integer) from public, anon, authenticated;

-- Les artistes « par collaborations » déjà suivis sont mis en pause jusqu'à la vérification de leurs titres.
update public.artists set deezer_suivi = false
 where deezer_suivi and francophone is true and langue_source = 'collaborations' and langue_titres_le is null;

select cron.schedule('langue-titres', '* * * * *', $$ select public.langue_verifier_titres(30); $$);
