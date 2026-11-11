-- Concerts sur la carte : coordonnées des villes de concert, disparition le lendemain (date de Paris), import des sorties
-- toutes les 5 minutes. (Passé en production le 2026-11-12.)
-- RETRAIT : drop function public.concerts_carte(integer), public.geocoder_concerts(integer), public.aujourdhui_paris();
--   drop table public.villes_geo; alter table public.artiste_concerts drop column lat, drop column lon;
--   (remettre concerts-deezer à « select public.synchroniser_concerts_deezer(30); » et deezer-import-sorties à */20)

alter table public.artiste_concerts add column if not exists lat double precision;
alter table public.artiste_concerts add column if not exists lon double precision;

-- Un concert reste affiché toute la journée, il disparaît le lendemain (minuit à Paris, pas minuit UTC).
create or replace function public.aujourdhui_paris() returns date
language sql stable as $$ select (now() at time zone 'Europe/Paris')::date $$;

create table if not exists public.villes_geo (
  cle      text primary key,           -- ville en minuscules | pays
  lat      double precision,
  lon      double precision,
  essai_le timestamptz not null default now()
);
alter table public.villes_geo enable row level security;
revoke all on table public.villes_geo from anon, authenticated;

-- Positionne les concerts à venir dont la ville n'a pas encore de coordonnées (service open-meteo, sans clé).
create or replace function public.geocoder_concerts(p_max integer default 20)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_v   record;
  v_cle text;
  v_rep http_response;
  v_r   jsonb;
  v_lat double precision;
  v_lon double precision;
  v_n   integer := 0;
begin
  if not pg_try_advisory_xact_lock(hashtext('geocoder_concerts')) then return jsonb_build_object('ignore', true); end if;

  begin perform http_set_curlopt('CURLOPT_TIMEOUT', '8'); exception when others then null; end;

  update public.artiste_concerts c set lat = g.lat, lon = g.lon
    from public.villes_geo g
   where c.lat is null and g.lat is not null
     and g.cle = lower(btrim(c.ville)) || '|' || coalesce(c.pays, '');

  for v_v in
    select distinct lower(btrim(c.ville)) as ville, btrim(c.ville) as nom, coalesce(c.pays, '') as pays
      from public.artiste_concerts c
     where c.lat is null and c.date_concert >= public.aujourdhui_paris()
       and not exists (select 1 from public.villes_geo g
                        where g.cle = lower(btrim(c.ville)) || '|' || coalesce(c.pays, '')
                          and (g.lat is not null or g.essai_le > now() - interval '7 days'))
     limit greatest(least(p_max, 40), 1)
  loop
    v_cle := v_v.ville || '|' || v_v.pays;
    v_lat := null; v_lon := null;
    begin
      v_rep := http_get('https://geocoding-api.open-meteo.com/v1/search?count=1&language=fr&format=json&name='
                        || replace(urlencode(v_v.nom), '+', '%20')
                        || case when v_v.pays <> '' then '&countryCode=' || v_v.pays else '' end);
      if v_rep.status = 200 then
        v_r := v_rep.content::jsonb->'results'->0;
        v_lat := (v_r->>'latitude')::double precision;
        v_lon := (v_r->>'longitude')::double precision;
      end if;
    exception when others then
      v_lat := null; v_lon := null;
    end;
    insert into public.villes_geo (cle, lat, lon, essai_le) values (v_cle, v_lat, v_lon, now())
    on conflict (cle) do update set lat = excluded.lat, lon = excluded.lon, essai_le = now();
    v_n := v_n + 1;
    perform pg_sleep(0.15);
  end loop;

  update public.artiste_concerts c set lat = g.lat, lon = g.lon
    from public.villes_geo g
   where c.lat is null and g.lat is not null
     and g.cle = lower(btrim(c.ville)) || '|' || coalesce(c.pays, '');

  return jsonb_build_object('villes', v_n);
end $$;
revoke all on function public.geocoder_concerts(integer) from public, anon, authenticated;

-- Tous les concerts des p_jours prochains jours, avec leur position (la carte y place les artistes).
create or replace function public.concerts_carte(p_jours integer default 30) returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select coalesce(jsonb_agg(jsonb_build_object('handle', c.artist_handle, 'date', c.date_concert, 'ville', c.ville,
                                               'salle', c.salle, 'pays', c.pays, 'lat', c.lat, 'lon', c.lon, 'lien', c.lien)
                            order by c.date_concert), '[]'::jsonb)
    from public.artiste_concerts c
   where c.lat is not null and c.lon is not null
     and c.date_concert >= public.aujourdhui_paris()
     and c.date_concert <= public.aujourdhui_paris() + greatest(least(coalesce(p_jours, 30), 365), 1);
$$;
grant execute on function public.concerts_carte(integer) to anon, authenticated;

-- Les concerts de la page artiste et le raccourci de la carte suivent la date de Paris.
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
       where c.artist_handle = v_h and c.date_concert >= public.aujourdhui_paris()), '[]'::jsonb));
end $$;

create or replace function public.concerts_a_venir(p_jours integer default 30) returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select coalesce(jsonb_agg(jsonb_build_object('handle', x.artist_handle, 'date', x.date_concert, 'ville', x.ville, 'salle', x.salle,
                                               'lien', x.lien, 'nb', x.nb) order by x.date_concert), '[]'::jsonb)
    from (
      select distinct on (c.artist_handle) c.artist_handle, c.date_concert, c.ville, c.salle, c.lien,
             count(*) over (partition by c.artist_handle) as nb
        from public.artiste_concerts c
       where c.date_concert >= public.aujourdhui_paris()
         and c.date_concert <= public.aujourdhui_paris() + greatest(least(coalesce(p_jours, 30), 365), 1)
       order by c.artist_handle, c.date_concert
    ) x;
$$;
