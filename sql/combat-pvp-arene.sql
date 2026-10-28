-- Wave Cards : l'Arène classée 2v2 et la Saison mensuelle (2026-10-28).
-- Un mode du hub de combat (combat_modes, voir l'en-tête de sql/combat-v2-jeu.sql) : chaque joueur enregistre une équipe de DÉFENSE
-- (jouée par l'ordinateur quand on l'attaque), on attaque des adversaires proches de son classement avec des TICKETS d'attaque
-- (plafond, recharge régulière), les POINTS d'arène suivent un calcul Elo, sept RANGS (Débutant → Légende), une récompense
-- HEBDOMADAIRE le dimanche selon le rang, et une SAISON mensuelle (points de saison, récompenses par tranche, remise à zéro partielle).
-- Tout est calculé ici (aucun calcul de points côté site) ; la RLS est activée sans politique : seules les fonctions
-- SECURITY DEFINER touchent aux tables. Les récompenses sont versées par pvp_cycle(), appelée par pg_cron (toutes les heures) ET
-- paresseusement à chaque ouverture de l'Arène : idempotent (clé unique par joueur / type / référence), donc sans double versement.
-- Les réglages (tickets, K, rangs, saisons, récompenses) sont modifiables par l'équipe (console : WaveCombat.equipe, onglet « Arène classée »).

-- ---------------------------------------------------------------------------------------------------------------------------
-- 1. Les tables
-- ---------------------------------------------------------------------------------------------------------------------------

create table if not exists public.pvp_reglages (
  id smallint primary key default 1 check (id = 1),
  tickets_max integer not null default 5 check (tickets_max between 1 and 20),
  recharge_minutes integer not null default 180 check (recharge_minutes between 10 and 1440),
  facteur_k integer not null default 32 check (facteur_k between 4 and 100),
  points_depart integer not null default 1000 check (points_depart between 0 and 5000),
  conserve_pct integer not null default 50 check (conserve_pct between 0 and 100),
  max_par_adversaire integer not null default 3 check (max_par_adversaire between 1 and 20),
  points_defense integer not null default 3 check (points_defense between 0 and 50)
);
insert into public.pvp_reglages (id) values (1) on conflict do nothing;

create table if not exists public.pvp_rangs (
  id text primary key check (id ~ '^[a-z]{2,20}$'),
  nom text not null,
  ordre integer not null unique,
  minimum integer not null check (minimum >= 0),
  couleur text not null check (couleur ~ '^#[0-9a-fA-F]{6}$'),
  vinyles integer not null default 0 check (vinyles between 0 and 100),
  wc integer not null default 0 check (wc between 0 and 10000)
);
insert into public.pvp_rangs (id, nom, ordre, minimum, couleur, vinyles, wc) values
  ('debutant', 'Débutant', 1, 0,    '#8A94A3', 0, 25),
  ('bronze',   'Bronze',   2, 1100, '#CD7F32', 1, 50),
  ('argent',   'Argent',   3, 1250, '#C0C8D4', 1, 100),
  ('or',       'Or',       4, 1400, '#F2C14E', 2, 150),
  ('platine',  'Platine',  5, 1600, '#5FD1C8', 2, 250),
  ('diamant',  'Diamant',  6, 1800, '#6FB7FF', 3, 400),
  ('legende',  'Légende',  7, 2000, '#FF5CC8', 4, 600)
on conflict (id) do nothing;

-- La défense de chaque joueur : 2 cartes [{booster, artist, holo}], jouées par l'ordinateur quand on l'attaque.
create table if not exists public.pvp_defenses (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  duo jsonb not null,
  maj_le timestamptz not null default now()
);

create table if not exists public.pvp_saisons (
  id text primary key check (id ~ '^[0-9A-Za-z_-]{4,30}$'),
  nom text not null,
  debut date not null,
  fin date not null,
  recompenses jsonb not null,
  clos boolean not null default false,
  clos_le timestamptz,
  check (fin >= debut)
);

create table if not exists public.pvp_joueurs (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  points integer not null default 1000 check (points >= 0),
  saison text,
  points_saison integer not null default 0 check (points_saison >= 0),
  tickets integer not null default 5 check (tickets >= 0),
  tickets_maj timestamptz not null default now(),
  victoires integer not null default 0,
  defaites integer not null default 0,
  defenses_tenues integer not null default 0,
  defenses_perdues integer not null default 0,
  meilleurs_points integer not null default 1000
);
create index if not exists pvp_joueurs_saison_idx on public.pvp_joueurs (saison, points_saison desc);
create index if not exists pvp_joueurs_points_idx on public.pvp_joueurs (points desc);

create table if not exists public.pvp_attaques (
  id uuid primary key default gen_random_uuid(),
  partie_id uuid unique,
  attaquant uuid not null references public.profiles(id) on delete cascade,
  defenseur uuid not null references public.profiles(id) on delete cascade,
  saison text,
  jour date not null,
  pts_att integer not null,
  pts_def integer not null,
  resultat text not null default 'en_cours' check (resultat in ('en_cours', 'victoire', 'defaite')),
  delta_att integer,
  delta_def integer,
  duo_att jsonb not null default '[]'::jsonb,
  duo_def jsonb not null default '[]'::jsonb,
  cree_le timestamptz not null default now(),
  fin_le timestamptz
);
create index if not exists pvp_attaques_att_idx on public.pvp_attaques (attaquant, cree_le desc);
create index if not exists pvp_attaques_def_idx on public.pvp_attaques (defenseur, cree_le desc);
create index if not exists pvp_attaques_paire_idx on public.pvp_attaques (attaquant, defenseur, jour);

create table if not exists public.pvp_recompenses (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null check (type in ('hebdo', 'saison')),
  ref text not null,
  libelle text not null,
  vinyles integer not null default 0,
  wc integer not null default 0,
  detail jsonb,
  vu boolean not null default false,
  cree_le timestamptz not null default now(),
  unique (user_id, type, ref)
);

-- L'état du cycle (dernier dimanche versé).
create table if not exists public.pvp_cycle_etat (
  cle text primary key,
  valeur text not null,
  maj_le timestamptz not null default now()
);

alter table public.pvp_reglages enable row level security;
alter table public.pvp_rangs enable row level security;
alter table public.pvp_defenses enable row level security;
alter table public.pvp_saisons enable row level security;
alter table public.pvp_joueurs enable row level security;
alter table public.pvp_attaques enable row level security;
alter table public.pvp_recompenses enable row level security;
alter table public.pvp_cycle_etat enable row level security;

insert into public.combat_modes (id, nom, fonction_fin) values ('arene_classee', 'Arène classée', 'combat_fin_arene_classee')
on conflict (id) do update set nom = excluded.nom, fonction_fin = excluded.fonction_fin;

-- ---------------------------------------------------------------------------------------------------------------------------
-- 2. Les outils internes
-- ---------------------------------------------------------------------------------------------------------------------------

create or replace function public.pvp_recompenses_defaut() returns jsonb
language sql immutable set search_path to 'public' as $$
  select '[{"nom":"Top 1 %","top_pct":1,"vinyles":10,"wc":1000},{"nom":"Top 3 %","top_pct":3,"vinyles":6,"wc":600},{"nom":"Top 10 %","top_pct":10,"vinyles":4,"wc":400},{"nom":"Top 50 %","top_pct":50,"vinyles":2,"wc":200},{"nom":"Participation","top_pct":100,"vinyles":1,"wc":50}]'::jsonb $$;

create or replace function public.pvp_rang_de(p_points integer) returns public.pvp_rangs
language sql stable set search_path to 'public' as $$
  select r.* from public.pvp_rangs r where r.minimum <= greatest(coalesce(p_points, 0), 0) order by r.minimum desc limit 1 $$;

-- La saison en cours (créée au premier besoin pour le mois civil si l'équipe n'en a pas réglé).
create or replace function public.pvp_saison_courante() returns public.pvp_saisons
language plpgsql security definer set search_path to 'public' as $$
declare
  s public.pvp_saisons; v_jour date := public.xp_jour(); v_debut date; v_id text;
  v_mois text[] := array['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
begin
  select * into s from public.pvp_saisons where not clos and debut <= v_jour and fin >= v_jour order by debut desc limit 1;
  if found then return s; end if;
  v_id := to_char(v_jour, 'YYYY-MM');
  if exists (select 1 from public.pvp_saisons where id = v_id) then v_id := to_char(v_jour, 'YYYY-MM-DD'); end if;
  -- elle commence au début du mois, ou le lendemain de la dernière saison terminée si celle-ci s'est arrêtée en cours de mois
  v_debut := greatest(date_trunc('month', v_jour)::date, coalesce((select max(o.fin) + 1 from public.pvp_saisons o where o.clos and o.fin < v_jour), date_trunc('month', v_jour)::date));
  insert into public.pvp_saisons (id, nom, debut, fin, recompenses)
  values (v_id, 'Saison de ' || v_mois[extract(month from v_jour)::integer] || ' ' || extract(year from v_jour)::integer,
          v_debut, least((date_trunc('month', v_jour) + interval '1 month - 1 day')::date, coalesce((select min(o.debut) - 1 from public.pvp_saisons o where not o.clos and o.debut > v_jour), '9999-12-31'::date)),
          public.pvp_recompenses_defaut())
  on conflict (id) do nothing;
  select * into s from public.pvp_saisons where not clos and debut <= v_jour and fin >= v_jour order by debut desc limit 1;
  if not found then raise exception 'Aucune saison disponible.'; end if;
  return s;
end $$;

-- Verse des vinyles et des Wave Coins (idempotent côté Wave Coins par motif / référence).
create or replace function public.pvp_verser(p_user uuid, p_vinyles integer, p_wc integer, p_motif text, p_ref text) returns void
language plpgsql security definer set search_path to 'public' as $$
begin
  perform public.jeu_joueur_assurer(p_user);
  if coalesce(p_vinyles, 0) > 0 then perform public.jeu_crediter(p_user, p_vinyles, 0, 0); end if;
  if coalesce(p_wc, 0) > 0 then perform public.wc_crediter(p_user, p_wc, p_motif, p_ref); end if;
end $$;

-- Le cycle : clôture les saisons terminées (récompenses par tranche) et verse la récompense hebdomadaire du dimanche.
-- Appelée par pg_cron et à chaque ouverture de l'Arène ; sans effet quand il n'y a rien à faire.
create or replace function public.pvp_cycle() returns void
language plpgsql security definer set search_path to 'public' as $$
declare
  v_jour date := public.xp_jour(); v_dim date := public.xp_jour() - extract(dow from public.xp_jour())::integer;
  s public.pvp_saisons; j record; r public.pvp_rangs; t jsonb; v_t jsonb; v_n integer; v_ins bigint;
begin
  if not exists (select 1 from public.pvp_saisons where not clos and fin < v_jour)
     and exists (select 1 from public.pvp_cycle_etat where cle = 'hebdo' and valeur = v_dim::text) then
    return;
  end if;
  perform pg_advisory_xact_lock(74620011);

  for s in select * from public.pvp_saisons where not clos and fin < v_jour order by fin for update loop
    select count(*) into v_n from public.pvp_joueurs where saison = s.id and points_saison > 0;
    for j in
      select x.user_id, x.points_saison, x.rang from (
        select user_id, points_saison, row_number() over (order by points_saison desc, points desc, victoires desc, user_id) as rang
          from public.pvp_joueurs where saison = s.id and points_saison > 0) x
    loop
      v_t := null;
      for t in select e.value from jsonb_array_elements(s.recompenses) e order by (e.value ->> 'top_pct')::numeric loop
        if j.rang <= greatest(1, ceil(v_n * (t ->> 'top_pct')::numeric / 100.0)) then v_t := t; exit; end if;
      end loop;
      if v_t is not null then
        v_ins := null;
        insert into public.pvp_recompenses (user_id, type, ref, libelle, vinyles, wc, detail)
        values (j.user_id, 'saison', s.id, s.nom || ' · ' || (v_t ->> 'nom'), coalesce((v_t ->> 'vinyles')::integer, 0), coalesce((v_t ->> 'wc')::integer, 0),
                jsonb_build_object('rang', j.rang, 'total', v_n, 'points', j.points_saison, 'tranche', v_t ->> 'nom'))
        on conflict (user_id, type, ref) do nothing returning id into v_ins;
        if v_ins is not null then
          perform public.pvp_verser(j.user_id, coalesce((v_t ->> 'vinyles')::integer, 0), coalesce((v_t ->> 'wc')::integer, 0), 'pvp-saison', s.id);
        end if;
      end if;
    end loop;
    update public.pvp_saisons set clos = true, clos_le = now() where id = s.id;
  end loop;

  if not exists (select 1 from public.pvp_cycle_etat where cle = 'hebdo' and valeur = v_dim::text) then
    for j in select distinct a.attaquant as user_id from public.pvp_attaques a
              where a.jour >= v_dim - 7 and a.jour < v_dim and a.resultat <> 'en_cours' loop
      select * into r from public.pvp_rang_de((select p.points from public.pvp_joueurs p where p.user_id = j.user_id));
      if r.id is not null and (r.vinyles > 0 or r.wc > 0) then
        v_ins := null;
        insert into public.pvp_recompenses (user_id, type, ref, libelle, vinyles, wc, detail)
        values (j.user_id, 'hebdo', v_dim::text, 'Récompense hebdomadaire · ' || r.nom, r.vinyles, r.wc, jsonb_build_object('rang', r.id))
        on conflict (user_id, type, ref) do nothing returning id into v_ins;
        if v_ins is not null then perform public.pvp_verser(j.user_id, r.vinyles, r.wc, 'pvp-hebdo', v_dim::text); end if;
      end if;
    end loop;
    insert into public.pvp_cycle_etat (cle, valeur) values ('hebdo', v_dim::text)
    on conflict (cle) do update set valeur = excluded.valeur, maj_le = now();
  end if;
end $$;

-- La fiche d'arène d'un joueur : créée au premier besoin, saison remise à jour (points ramenés vers le départ), tickets rechargés.
create or replace function public.pvp_joueur_assurer(p_user uuid) returns public.pvp_joueurs
language plpgsql security definer set search_path to 'public' as $$
declare
  j public.pvp_joueurs; reg public.pvp_reglages; sa public.pvp_saisons; n integer;
begin
  perform public.pvp_cycle();
  select * into reg from public.pvp_reglages where id = 1;
  sa := public.pvp_saison_courante();
  insert into public.pvp_joueurs (user_id, points, saison, tickets, tickets_maj, meilleurs_points)
  values (p_user, reg.points_depart, sa.id, reg.tickets_max, now(), reg.points_depart) on conflict (user_id) do nothing;
  select * into j from public.pvp_joueurs where user_id = p_user for update;

  if j.saison is distinct from sa.id and not exists (select 1 from public.pvp_saisons where id = j.saison and not clos) then
    update public.pvp_joueurs
       set saison = sa.id, points = greatest(0, reg.points_depart + round((points - reg.points_depart) * reg.conserve_pct / 100.0)::integer), points_saison = 0
     where user_id = p_user;
  end if;

  if j.tickets > reg.tickets_max then
    update public.pvp_joueurs set tickets = reg.tickets_max where user_id = p_user;
  elsif j.tickets < reg.tickets_max then
    n := floor(extract(epoch from (now() - j.tickets_maj)) / (reg.recharge_minutes * 60))::integer;
    if n > 0 then
      if j.tickets + n >= reg.tickets_max then
        update public.pvp_joueurs set tickets = reg.tickets_max, tickets_maj = now() where user_id = p_user;
      else
        update public.pvp_joueurs set tickets = tickets + n, tickets_maj = tickets_maj + make_interval(mins => n * reg.recharge_minutes) where user_id = p_user;
      end if;
    end if;
  end if;
  select * into j from public.pvp_joueurs where user_id = p_user;
  return j;
end $$;

-- La défense d'un joueur « à l'affichage » : 2 entrées si les deux cartes sont encore dans sa collection, sinon moins.
create or replace function public.pvp_duo_infos(p_user uuid) returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select coalesce(jsonb_agg((public.combat_identite((t.x ->> 'artist')::uuid, bc.rarete, coalesce((t.x ->> 'holo')::boolean, false)) - 'surcharge')
                            || jsonb_build_object('booster', t.x ->> 'booster', 'numero', bc.numero) order by t.o), '[]'::jsonb)
    from public.pvp_defenses d
    cross join lateral jsonb_array_elements(d.duo) with ordinality as t (x, o)
    join public.jeu_booster_cartes bc on bc.booster_id = t.x ->> 'booster' and bc.artist_id = (t.x ->> 'artist')::uuid
    join public.jeu_collection_b col on col.user_id = d.user_id and col.booster_id = t.x ->> 'booster' and col.artist_id = (t.x ->> 'artist')::uuid
                                    and col.holo = coalesce((t.x ->> 'holo')::boolean, false) and col.quantite > 0
   where d.user_id = p_user $$;

create or replace function public.pvp_rang_json(p_points integer) returns jsonb
language sql stable set search_path to 'public' as $$
  select jsonb_build_object('id', r.id, 'nom', r.nom, 'ordre', r.ordre, 'minimum', r.minimum, 'couleur', r.couleur, 'vinyles', r.vinyles, 'wc', r.wc)
    from public.pvp_rang_de(p_points) r $$;

-- ---------------------------------------------------------------------------------------------------------------------------
-- 3. Les fonctions des joueurs
-- ---------------------------------------------------------------------------------------------------------------------------

-- L'écran d'accueil de l'Arène classée : mon rang, mes tickets, ma défense, les rangs, la saison, la récompense de la semaine.
create or replace function public.pvp_accueil() returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid(); j public.pvp_joueurs; reg public.pvp_reglages; sa public.pvp_saisons; v_jour date := public.xp_jour();
  v_dim date := public.xp_jour() - extract(dow from public.xp_jour())::integer; v_duo jsonb; v_suivant jsonb; v_podium jsonb; v_rang_s integer; v_total integer;
  v_rang_g integer; v_sec integer; v_sem integer;
begin
  if v_uid is null then raise exception 'Connecte-toi.'; end if;
  perform public.jeu_joueur_assurer(v_uid);
  j := public.pvp_joueur_assurer(v_uid);
  select * into reg from public.pvp_reglages where id = 1;
  sa := public.pvp_saison_courante();
  v_duo := public.pvp_duo_infos(v_uid);
  select jsonb_build_object('id', r.id, 'nom', r.nom, 'minimum', r.minimum, 'couleur', r.couleur) into v_suivant
    from public.pvp_rangs r where r.minimum > j.points order by r.minimum limit 1;
  if j.tickets < reg.tickets_max then
    v_sec := greatest(0, ceil(extract(epoch from (j.tickets_maj + make_interval(mins => reg.recharge_minutes) - now())))::integer);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('rang', c.rang, 'user_id', c.user_id, 'pseudo', c.pseudo, 'avatar', c.avatar, 'valeur', c.points_saison) order by c.rang), '[]'::jsonb)
    into v_podium from (
      select row_number() over (order by x.points_saison desc, x.points desc, x.victoires desc, x.user_id) as rang, x.user_id, p.pseudo, p.avatar_url as avatar, x.points_saison
        from public.pvp_joueurs x join public.profiles p on p.id = x.user_id where x.saison = sa.id and x.points_saison > 0 order by 1 limit 3) c;
  select count(*) into v_total from public.pvp_joueurs where saison = sa.id and points_saison > 0;
  if j.points_saison > 0 then
    select 1 + count(*) into v_rang_s from public.pvp_joueurs x
     where x.saison = sa.id and x.points_saison > 0
       and (x.points_saison, x.points, x.victoires, j.user_id) > (j.points_saison, j.points, j.victoires, x.user_id);
  end if;
  select 1 + count(*) into v_rang_g from public.pvp_joueurs x
   where (x.victoires + x.defaites + x.defenses_tenues + x.defenses_perdues) > 0
     and (x.points, x.victoires, j.user_id) > (j.points, j.victoires, x.user_id);
  select count(*) into v_sem from public.pvp_attaques a where a.attaquant = v_uid and a.jour >= v_dim and a.jour < v_dim + 7 and a.resultat <> 'en_cours';

  return jsonb_build_object(
    'moi', jsonb_build_object('points', j.points, 'rang', public.pvp_rang_json(j.points), 'suivant', v_suivant, 'tickets', j.tickets, 'tickets_max', reg.tickets_max,
            'prochain_ticket_s', v_sec, 'recharge_minutes', reg.recharge_minutes, 'victoires', j.victoires, 'defaites', j.defaites,
            'defenses_tenues', j.defenses_tenues, 'defenses_perdues', j.defenses_perdues, 'meilleurs_points', j.meilleurs_points,
            'points_saison', j.points_saison, 'place', case when (j.victoires + j.defaites + j.defenses_tenues + j.defenses_perdues) > 0 then v_rang_g end),
    'defense', jsonb_build_object('duo', v_duo, 'valide', jsonb_array_length(v_duo) = 2),
    'rangs', (select jsonb_agg(public.pvp_rang_json(r.minimum) order by r.ordre) from public.pvp_rangs r),
    'saison', jsonb_build_object('id', sa.id, 'nom', sa.nom, 'debut', sa.debut, 'fin', sa.fin, 'recompenses', sa.recompenses,
            'secondes_restantes', greatest(0, floor(extract(epoch from (((sa.fin + 1)::timestamp at time zone 'Europe/Paris') - now())))::integer),
            'podium', v_podium, 'participants', v_total, 'ma_place', v_rang_s, 'mes_points', j.points_saison),
    'hebdo', jsonb_build_object('prochain', v_dim + 7, 'attaques', v_sem, 'eligible', v_sem > 0,
            'vinyles', (select r.vinyles from public.pvp_rang_de(j.points) r), 'wc', (select r.wc from public.pvp_rang_de(j.points) r)),
    'nouvelles_recompenses', (select count(*) from public.pvp_recompenses where user_id = v_uid and not vu),
    'regles', jsonb_build_object('max_par_adversaire', reg.max_par_adversaire, 'facteur_k', reg.facteur_k, 'points_defense', reg.points_defense,
            'conserve_pct', reg.conserve_pct));
end $$;

create or replace function public.pvp_defense_sauver(p_duo jsonb) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); v_duo jsonb := '[]'::jsonb; d jsonb;
begin
  if v_uid is null then raise exception 'Connecte-toi.'; end if;
  perform public.jeu_joueur_assurer(v_uid);
  perform public.combat_duo_unites(v_uid, p_duo);
  for d in select value from jsonb_array_elements(p_duo) loop
    v_duo := v_duo || jsonb_build_object('booster', d ->> 'booster', 'artist', d ->> 'artist', 'holo', coalesce((d ->> 'holo')::boolean, false));
  end loop;
  insert into public.pvp_defenses (user_id, duo) values (v_uid, v_duo)
  on conflict (user_id) do update set duo = excluded.duo, maj_le = now();
  perform public.pvp_joueur_assurer(v_uid);
  return jsonb_build_object('duo', public.pvp_duo_infos(v_uid), 'valide', true);
end $$;

-- Les adversaires proposés : les 8 joueurs à la défense valide dont les points sont les plus proches des miens.
create or replace function public.pvp_adversaires() returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); j public.pvp_joueurs; reg public.pvp_reglages; v_jour date := public.xp_jour();
begin
  if v_uid is null then raise exception 'Connecte-toi.'; end if;
  perform public.jeu_joueur_assurer(v_uid);
  j := public.pvp_joueur_assurer(v_uid);
  select * into reg from public.pvp_reglages where id = 1;
  return coalesce((
    select jsonb_agg(s.x order by s.ecart, s.uid) from (
      select jsonb_build_object('user_id', c.user_id, 'pseudo', p.pseudo, 'avatar', p.avatar_url, 'points', c.points, 'rang', public.pvp_rang_json(c.points), 'duo', c.duo,
               'attaques_aujourdhui', (select count(*) from public.pvp_attaques a where a.attaquant = v_uid and a.defenseur = c.user_id and a.jour = v_jour),
               'gain', greatest(round(reg.facteur_k * (1 - 1 / (1 + power(10, (c.points - j.points) / 400.0))))::integer, 5),
               'perte', least(round(reg.facteur_k * (0 - 1 / (1 + power(10, (c.points - j.points) / 400.0))))::integer, -3)) as x,
             abs(c.points - j.points) as ecart, c.user_id as uid
        from (select pj.user_id, pj.points, public.pvp_duo_infos(pj.user_id) as duo from public.pvp_joueurs pj join public.pvp_defenses dd on dd.user_id = pj.user_id where pj.user_id <> v_uid) c
        join public.profiles p on p.id = c.user_id
       where jsonb_array_length(c.duo) = 2
       order by abs(c.points - j.points), c.user_id limit 8) s), '[]'::jsonb);
end $$;

-- Attaque la défense d'un joueur : consomme un ticket et crée le combat (mode arene_classee). Les points sont réglés à la fin
-- du combat par combat_fin_arene_classee.
create or replace function public.pvp_attaquer(p_cible uuid, p_duo jsonb, p_options jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid(); j public.pvp_joueurs; d public.pvp_joueurs; reg public.pvp_reglages; v_mine jsonb; v_opp jsonb; v_duo_def jsonb; v_nom text;
  v_id uuid; v_jour date := public.xp_jour(); v_n integer; v_min integer;
begin
  if v_uid is null then raise exception 'Connecte-toi.'; end if;
  if p_cible is null or p_cible = v_uid then raise exception 'Choisis un autre joueur à attaquer.'; end if;
  perform public.jeu_joueur_assurer(v_uid);
  perform public.combat_expirer(v_uid);
  if v_uid < p_cible then
    j := public.pvp_joueur_assurer(v_uid);
    if exists (select 1 from public.profiles where id = p_cible) then d := public.pvp_joueur_assurer(p_cible); end if;
  else
    if exists (select 1 from public.profiles where id = p_cible) then d := public.pvp_joueur_assurer(p_cible); end if;
    j := public.pvp_joueur_assurer(v_uid);
  end if;
  if d.user_id is null then raise exception 'Adversaire inconnu.'; end if;
  select * into reg from public.pvp_reglages where id = 1;
  if exists (select 1 from public.combat_parties where user_id = v_uid and etat = 'en_cours') then raise exception 'Un combat est déjà en cours.'; end if;
  if jsonb_array_length(public.pvp_duo_infos(v_uid)) <> 2 then raise exception 'Règle d''abord ta défense (deux cartes de ta collection) avant d''attaquer.'; end if;
  select duo into v_duo_def from public.pvp_defenses where user_id = p_cible;
  if v_duo_def is null then raise exception 'Ce joueur n''a pas encore réglé sa défense.'; end if;
  if j.tickets < 1 then
    v_min := greatest(1, ceil(extract(epoch from (j.tickets_maj + make_interval(mins => reg.recharge_minutes) - now())) / 60.0)::integer);
    raise exception 'Plus de ticket d''attaque : le prochain arrive dans % min.', v_min;
  end if;
  select count(*) into v_n from public.pvp_attaques where attaquant = v_uid and defenseur = p_cible and jour = v_jour;
  if v_n >= reg.max_par_adversaire then raise exception 'Tu as déjà attaqué ce joueur % fois aujourd''hui (maximum). Reviens demain ou choisis-en un autre.', reg.max_par_adversaire; end if;

  v_mine := public.combat_duo_unites(v_uid, p_duo);
  begin v_opp := public.combat_duo_unites(p_cible, v_duo_def);
  exception when others then raise exception 'Ce joueur n''a pas de défense valide pour le moment.'; end;
  select pseudo into v_nom from public.profiles where id = p_cible;

  update public.pvp_joueurs set tickets = tickets - 1, tickets_maj = case when j.tickets >= reg.tickets_max then now() else tickets_maj end where user_id = v_uid;
  delete from public.combat_equipes where user_id = v_uid and role = 'principal';
  insert into public.combat_equipes (user_id, role, slot, booster_id, artist_id, holo)
  select v_uid, 'principal', (ord)::smallint, x ->> 'booster', (x ->> 'artist')::uuid, coalesce((x ->> 'holo')::boolean, false)
    from jsonb_array_elements(p_duo) with ordinality as t (x, ord);

  v_id := public.combat_creer(v_uid, 'arene_classee', 'Arène classée · ' || coalesce(v_nom, 'adversaire'), 'concert', v_mine, v_opp, null, p_cible, p_options);
  insert into public.pvp_attaques (partie_id, attaquant, defenseur, saison, jour, pts_att, pts_def, duo_att, duo_def)
  values (v_id, v_uid, p_cible, j.saison, v_jour, j.points, d.points,
          (select jsonb_agg(u ->> 'nom') from jsonb_array_elements(v_mine) u), (select jsonb_agg(u ->> 'nom') from jsonb_array_elements(v_opp) u));
  return public.combat_partie_json(v_id);
end $$;

-- Fin d'un combat classé (appelée UNE fois par combat_conclure) : points Elo des deux joueurs, points de saison, rang.
create or replace function public.combat_fin_arene_classee(p_partie uuid, p_victoire boolean, p_abandon boolean) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  a public.pvp_attaques; reg public.pvp_reglages; att public.pvp_joueurs; def public.pvp_joueurs; v_e numeric; v_d integer; v_na integer; v_dd integer; v_nd integer;
  r0 public.pvp_rangs; r1 public.pvp_rangs; v_lignes jsonb := '[]'::jsonb; v_gagne boolean := p_victoire and not p_abandon; v_moins text := chr(8722);
begin
  select * into a from public.pvp_attaques where partie_id = p_partie for update;
  if not found or a.resultat <> 'en_cours' then return '{}'::jsonb; end if;
  select * into reg from public.pvp_reglages where id = 1;
  if a.attaquant < a.defenseur then
    att := public.pvp_joueur_assurer(a.attaquant); def := public.pvp_joueur_assurer(a.defenseur);
  else
    def := public.pvp_joueur_assurer(a.defenseur); att := public.pvp_joueur_assurer(a.attaquant);
  end if;

  v_e := 1 / (1 + power(10, (def.points - att.points) / 400.0));
  if v_gagne then v_d := greatest(round(reg.facteur_k * (1 - v_e))::integer, 5);
  else v_d := least(round(reg.facteur_k * (0 - v_e))::integer, -3); end if;
  v_dd := -sign(v_d)::integer * ceil(abs(v_d) / 2.0)::integer;
  v_na := greatest(0, att.points + v_d);   v_d := v_na - att.points;
  v_nd := greatest(0, def.points + v_dd);  v_dd := v_nd - def.points;
  r0 := public.pvp_rang_de(att.points);  r1 := public.pvp_rang_de(v_na);

  update public.pvp_joueurs
     set points = v_na, meilleurs_points = greatest(meilleurs_points, v_na),
         victoires = victoires + case when v_gagne then 1 else 0 end, defaites = defaites + case when v_gagne then 0 else 1 end,
         points_saison = points_saison + case when v_gagne then v_d else 0 end
   where user_id = a.attaquant;
  update public.pvp_joueurs
     set points = v_nd, meilleurs_points = greatest(meilleurs_points, v_nd),
         defenses_tenues = defenses_tenues + case when v_gagne then 0 else 1 end, defenses_perdues = defenses_perdues + case when v_gagne then 1 else 0 end,
         points_saison = points_saison + case when v_gagne then 0 else reg.points_defense end
   where user_id = a.defenseur;
  update public.pvp_attaques set resultat = case when v_gagne then 'victoire' else 'defaite' end, delta_att = v_d, delta_def = v_dd, fin_le = now() where id = a.id;

  v_lignes := v_lignes || to_jsonb((case when v_d >= 0 then '+' else v_moins end) || abs(v_d) || ' points d''arène');
  if v_gagne then v_lignes := v_lignes || to_jsonb('+' || abs(v_d) || ' points de saison'); end if;
  if p_abandon then v_lignes := v_lignes || to_jsonb('Abandon : compté comme une défaite'::text); end if;
  if r1.ordre > r0.ordre then v_lignes := v_lignes || to_jsonb('Nouveau rang : ' || r1.nom);
  elsif r1.ordre < r0.ordre then v_lignes := v_lignes || to_jsonb('Rang perdu : ' || r1.nom); end if;
  return jsonb_build_object('lignes', v_lignes,
    'arene', jsonb_build_object('delta', v_d, 'points', v_na, 'rang', r1.nom, 'rang_avant', r0.nom, 'promu', r1.ordre > r0.ordre));
end $$;

-- Le classement (p_type : points = classement général, saison = points de la saison en cours). Au format des classements de l'Accueil.
create or replace function public.pvp_classement(p_type text default 'points') returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); sa public.pvp_saisons; v_r jsonb;
begin
  if v_uid is null then raise exception 'Connecte-toi.'; end if;
  if p_type not in ('points', 'saison') then raise exception 'Classement inconnu.'; end if;
  perform public.jeu_joueur_assurer(v_uid);
  perform public.pvp_joueur_assurer(v_uid);
  sa := public.pvp_saison_courante();
  with cl as (
    select row_number() over (order by (case when p_type = 'saison' then x.points_saison else x.points end) desc, x.points desc, x.victoires desc, x.user_id) as rang,
           x.user_id, (case when p_type = 'saison' then x.points_saison else x.points end) as valeur, x.points
      from public.pvp_joueurs x
     where (p_type = 'saison' and x.saison = sa.id and x.points_saison > 0)
        or (p_type = 'points' and (x.victoires + x.defaites + x.defenses_tenues + x.defenses_perdues) > 0))
  select jsonb_build_object(
    'lignes', coalesce((select jsonb_agg(jsonb_build_object('rang', c.rang, 'user_id', c.user_id, 'pseudo', p.pseudo, 'avatar', p.avatar_url, 'valeur', c.valeur,
                'rang_nom', (select r.nom from public.pvp_rang_de(c.points) r), 'moi', c.user_id = v_uid) order by c.rang)
                from (select * from cl order by rang limit 50) c join public.profiles p on p.id = c.user_id), '[]'::jsonb),
    'moi', (select jsonb_build_object('rang', c.rang, 'valeur', c.valeur) from cl c where c.user_id = v_uid),
    'total', (select count(*) from cl), 'saison', sa.nom) into v_r;
  return v_r;
end $$;

-- Mes derniers combats classés, en attaque comme en défense.
create or replace function public.pvp_historique() returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Connecte-toi.'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', h.id, 'sens', case when h.attaquant = v_uid then 'attaque' else 'defense' end,
             'adversaire', p.pseudo, 'avatar', p.avatar_url,
             'victoire', (h.attaquant = v_uid) = (h.resultat = 'victoire'),
             'delta', case when h.attaquant = v_uid then h.delta_att else h.delta_def end,
             'moi', case when h.attaquant = v_uid then h.duo_att else h.duo_def end,
             'face', case when h.attaquant = v_uid then h.duo_def else h.duo_att end,
             'date', coalesce(h.fin_le, h.cree_le)) order by h.cree_le desc)
      from (select * from public.pvp_attaques where (attaquant = v_uid or defenseur = v_uid) and resultat <> 'en_cours' order by cree_le desc limit 30) h
      join public.profiles p on p.id = case when h.attaquant = v_uid then h.defenseur else h.attaquant end), '[]'::jsonb);
end $$;

-- Mes récompenses reçues (hebdomadaires et de saison) ; les marque comme vues.
create or replace function public.pvp_recompenses_voir() returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); v_r jsonb;
begin
  if v_uid is null then raise exception 'Connecte-toi.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'type', x.type, 'libelle', x.libelle, 'vinyles', x.vinyles, 'wc', x.wc, 'detail', x.detail, 'vu', x.vu, 'date', x.cree_le)
                           order by x.cree_le desc), '[]'::jsonb)
    into v_r from (select * from public.pvp_recompenses where user_id = v_uid order by cree_le desc limit 30) x;
  update public.pvp_recompenses set vu = true where user_id = v_uid and not vu;
  return v_r;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------
-- 4. La console de l'équipe (réservée à l'équipe)
-- ---------------------------------------------------------------------------------------------------------------------------

create or replace function public.pvp_equipe_lire() returns jsonb
language plpgsql security definer set search_path to 'public' as $$
begin
  perform public.combat_equipe_garde();
  perform public.pvp_cycle();
  perform public.pvp_saison_courante();
  return jsonb_build_object(
    'reglages', (select to_jsonb(r) - 'id' from public.pvp_reglages r where r.id = 1),
    'rangs', (select jsonb_agg(to_jsonb(r) order by r.ordre) from public.pvp_rangs r),
    'saisons', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'nom', s.nom, 'debut', s.debut, 'fin', s.fin, 'clos', s.clos, 'recompenses', s.recompenses,
                  'participants', (select count(*) from public.pvp_joueurs x where x.saison = s.id and x.points_saison > 0),
                  'courante', (not s.clos and s.debut <= public.xp_jour() and s.fin >= public.xp_jour())) order by s.debut desc), '[]'::jsonb)
                  from (select * from public.pvp_saisons order by debut desc limit 12) s),
    'aujourdhui', public.xp_jour());
end $$;

create or replace function public.pvp_equipe_regler(p jsonb) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare k text; v text; x jsonb; v_prev integer := -1; i integer := 0;
begin
  perform public.combat_equipe_garde();
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'Réglages invalides.'; end if;
  if p ? 'reglages' then
    for k in select jsonb_object_keys(p -> 'reglages') loop
      v := p -> 'reglages' ->> k;
      if k not in ('tickets_max', 'recharge_minutes', 'facteur_k', 'points_depart', 'conserve_pct', 'max_par_adversaire', 'points_defense') then raise exception 'Réglage inconnu : %.', k; end if;
      if v is null or v !~ '^[0-9]{1,5}$' then raise exception 'Valeur invalide pour %.', k; end if;
    end loop;
    update public.pvp_reglages set
      tickets_max = coalesce((p -> 'reglages' ->> 'tickets_max')::integer, tickets_max),
      recharge_minutes = coalesce((p -> 'reglages' ->> 'recharge_minutes')::integer, recharge_minutes),
      facteur_k = coalesce((p -> 'reglages' ->> 'facteur_k')::integer, facteur_k),
      points_depart = coalesce((p -> 'reglages' ->> 'points_depart')::integer, points_depart),
      conserve_pct = coalesce((p -> 'reglages' ->> 'conserve_pct')::integer, conserve_pct),
      max_par_adversaire = coalesce((p -> 'reglages' ->> 'max_par_adversaire')::integer, max_par_adversaire),
      points_defense = coalesce((p -> 'reglages' ->> 'points_defense')::integer, points_defense)
    where id = 1;
  end if;
  if p ? 'rangs' then
    if jsonb_typeof(p -> 'rangs') <> 'array' then raise exception 'Rangs invalides.'; end if;
    for x in select e.value from jsonb_array_elements(p -> 'rangs') e loop
      i := i + 1;
      if not exists (select 1 from public.pvp_rangs where id = x ->> 'id') then raise exception 'Rang inconnu.'; end if;
    end loop;
    if i <> (select count(*) from public.pvp_rangs) then raise exception 'Il faut envoyer les % rangs.', (select count(*) from public.pvp_rangs); end if;
    for x in select e.value from jsonb_array_elements(p -> 'rangs') e order by (e.value ->> 'minimum')::integer loop
      if (x ->> 'minimum')::integer <= v_prev then raise exception 'Les seuils des rangs doivent être strictement croissants.'; end if;
      v_prev := (x ->> 'minimum')::integer;
    end loop;
    if (select min((e.value ->> 'minimum')::integer) from jsonb_array_elements(p -> 'rangs') e) <> 0 then raise exception 'Le premier rang commence à 0 point.'; end if;
    for x in select e.value from jsonb_array_elements(p -> 'rangs') e loop
      if coalesce((x ->> 'vinyles')::integer, 0) not between 0 and 100 then raise exception 'Vinyles : entre 0 et 100.'; end if;
      if coalesce((x ->> 'wc')::integer, 0) not between 0 and 10000 then raise exception 'Wave Coins : entre 0 et 10 000.'; end if;
      update public.pvp_rangs set minimum = (x ->> 'minimum')::integer, vinyles = coalesce((x ->> 'vinyles')::integer, 0), wc = coalesce((x ->> 'wc')::integer, 0),
             nom = coalesce(nullif(btrim(x ->> 'nom'), ''), nom)
       where id = x ->> 'id';
    end loop;
  end if;
  return public.pvp_equipe_lire();
end $$;

-- Crée ou modifie une saison (id absent = nouvelle). Dates et récompenses par tranche : [{nom, top_pct, vinyles, wc}].
create or replace function public.pvp_equipe_saison_sauver(p jsonb) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_id text := nullif(btrim(p ->> 'id'), ''); v_debut date; v_fin date; v_nom text := left(btrim(coalesce(p ->> 'nom', '')), 60); v_rec jsonb := p -> 'recompenses';
  x jsonb; v_prev numeric := 0; s public.pvp_saisons; v_jour date := public.xp_jour(); v_base text;
begin
  perform public.combat_equipe_garde();
  begin v_debut := (p ->> 'debut')::date; v_fin := (p ->> 'fin')::date; exception when others then raise exception 'Dates invalides.'; end;
  if v_debut is null or v_fin is null or v_fin < v_debut then raise exception 'La fin doit suivre le début.'; end if;
  if v_fin - v_debut > 120 then raise exception 'Une saison dure 120 jours au plus.'; end if;
  if v_nom = '' then raise exception 'Donne un nom à la saison.'; end if;
  if v_rec is null or jsonb_typeof(v_rec) <> 'array' or jsonb_array_length(v_rec) not between 1 and 8 then raise exception 'Il faut entre 1 et 8 tranches de récompense.'; end if;
  for x in select e.value from jsonb_array_elements(v_rec) e order by (e.value ->> 'top_pct')::numeric loop
    if coalesce((x ->> 'top_pct')::numeric, 0) <= v_prev or (x ->> 'top_pct')::numeric > 100 then raise exception 'Les tranches (en %%) doivent être croissantes, entre 1 et 100, sans doublon.'; end if;
    v_prev := (x ->> 'top_pct')::numeric;
    if coalesce((x ->> 'vinyles')::integer, 0) not between 0 and 100 then raise exception 'Vinyles : entre 0 et 100.'; end if;
    if coalesce((x ->> 'wc')::integer, 0) not between 0 and 10000 then raise exception 'Wave Coins : entre 0 et 10 000.'; end if;
    if coalesce(btrim(x ->> 'nom'), '') = '' then raise exception 'Chaque tranche a un nom.'; end if;
  end loop;
  select jsonb_agg(jsonb_build_object('nom', left(btrim(e.value ->> 'nom'), 30), 'top_pct', (e.value ->> 'top_pct')::numeric, 'vinyles', coalesce((e.value ->> 'vinyles')::integer, 0),
                   'wc', coalesce((e.value ->> 'wc')::integer, 0)) order by (e.value ->> 'top_pct')::numeric)
    into v_rec from jsonb_array_elements(v_rec) e;

  if v_id is not null then
    select * into s from public.pvp_saisons where id = v_id for update;
    if not found then raise exception 'Saison inconnue.'; end if;
    if s.clos then raise exception 'Cette saison est terminée : on ne la modifie plus.'; end if;
  end if;
  if v_fin < v_jour then raise exception 'La fin de la saison ne peut pas être dans le passé.'; end if;
  if exists (select 1 from public.pvp_saisons o where not o.clos and o.id is distinct from v_id and o.debut <= v_fin and o.fin >= v_debut) then
    raise exception 'Ces dates chevauchent une autre saison en cours ou à venir.';
  end if;
  if v_id is null then
    v_base := to_char(v_debut, 'YYYY-MM');
    v_id := v_base;
    if exists (select 1 from public.pvp_saisons where id = v_id) then v_id := to_char(v_debut, 'YYYY-MM-DD'); end if;
    if exists (select 1 from public.pvp_saisons where id = v_id) then v_id := to_char(v_debut, 'YYYY-MM-DD') || '-' || substr(md5(random()::text), 1, 4); end if;
    insert into public.pvp_saisons (id, nom, debut, fin, recompenses) values (v_id, v_nom, v_debut, v_fin, v_rec);
  else
    update public.pvp_saisons set nom = v_nom, debut = v_debut, fin = v_fin, recompenses = v_rec where id = v_id;
  end if;
  return public.pvp_equipe_lire();
end $$;

-- Termine une saison maintenant (la veille d'aujourd'hui) : les récompenses par tranche sont versées tout de suite.
create or replace function public.pvp_equipe_saison_cloturer(p_id text) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare s public.pvp_saisons; v_hier date := public.xp_jour() - 1;
begin
  perform public.combat_equipe_garde();
  select * into s from public.pvp_saisons where id = p_id for update;
  if not found then raise exception 'Saison inconnue.'; end if;
  if s.clos then raise exception 'Cette saison est déjà terminée.'; end if;
  update public.pvp_saisons set fin = least(fin, v_hier), debut = least(debut, least(fin, v_hier)) where id = p_id;
  perform public.pvp_cycle();
  return public.pvp_equipe_lire();
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------
-- 5. Les droits et la planification
-- ---------------------------------------------------------------------------------------------------------------------------

revoke all on function public.pvp_recompenses_defaut(), public.pvp_rang_de(integer), public.pvp_saison_courante(), public.pvp_verser(uuid, integer, integer, text, text),
  public.pvp_cycle(), public.pvp_joueur_assurer(uuid), public.pvp_duo_infos(uuid), public.pvp_rang_json(integer),
  public.combat_fin_arene_classee(uuid, boolean, boolean) from public, anon, authenticated;

revoke all on function public.pvp_accueil(), public.pvp_defense_sauver(jsonb), public.pvp_adversaires(), public.pvp_attaquer(uuid, jsonb, jsonb), public.pvp_classement(text),
  public.pvp_historique(), public.pvp_recompenses_voir(), public.pvp_equipe_lire(), public.pvp_equipe_regler(jsonb), public.pvp_equipe_saison_sauver(jsonb),
  public.pvp_equipe_saison_cloturer(text) from public, anon;
grant execute on function public.pvp_accueil(), public.pvp_defense_sauver(jsonb), public.pvp_adversaires(), public.pvp_attaquer(uuid, jsonb, jsonb), public.pvp_classement(text),
  public.pvp_historique(), public.pvp_recompenses_voir(), public.pvp_equipe_lire(), public.pvp_equipe_regler(jsonb), public.pvp_equipe_saison_sauver(jsonb),
  public.pvp_equipe_saison_cloturer(text) to authenticated;

-- Toutes les heures, à la 7e minute : clôture des saisons terminées et récompense du dimanche (déjà paresseusement appelée par l'Arène).
select cron.unschedule('pvp-cycle') where exists (select 1 from cron.job where jobname = 'pvp-cycle');
select cron.schedule('pvp-cycle', '7 * * * *', 'select public.pvp_cycle()');
