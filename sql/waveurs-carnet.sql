-- =====================================================================
-- La Wave — le carnet des waveurs : défis du jour, série, succès, recyclage
--
-- À passer APRÈS sql/waveurs.sql. Ce fichier ajoute à l'espace des waveurs
-- de quoi revenir chaque jour : trois défis tirés pour chaque membre, une
-- série de jours consécutifs, des succès à débloquer, et la possibilité
-- de recycler ses cartes en double contre des pièces.
--
-- Comme tout le reste du jeu, rien ne se décide dans le navigateur :
--
--   · la progression est CALCULÉE ici, à partir des journaux qui existent
--     déjà (waveurs_tours, waveurs_ouvertures, waveurs_achats,
--     waveurs_collection). Il n'y a donc aucun compteur à tricher ;
--   · une récompense ne se réclame qu'une fois (tables « reclames ») et
--     seulement si l'objectif est atteint, vérifié par la base ;
--   · les récompenses sont des pièces, des boosters et un peu d'XP : jamais
--     d'argent, et rien ne se vend ni ne s'achète avec de l'argent. Les
--     pièces gagnées ici ne s'échangent que contre des boosters, comme
--     celles de la machine ;
--   · tout se règle dans des tables modifiables depuis l'éditeur de tables
--     de Supabase (waveurs_defis, waveurs_serie_paliers, waveurs_succes,
--     waveurs_recyclage), sans toucher au code.
--
-- Sans danger si on le relance : rien n'est écrasé ni vidé. Une instruction
-- qui échoue annule tout le bloc.
-- =====================================================================

begin;

do $$
begin

  if to_regclass('public.waveurs_tours') is null
     or to_regclass('public.waveurs_portefeuille') is null
     or to_regclass('public.waveurs_collection') is null then
    raise exception
      'Exécute d''abord sql/waveurs.sql : les tables du jeu manquent.';
  end if;

end $$;


-- ---------------------------------------------------------------------
-- 1. Les défis du jour
--
-- Chaque ligne est un défi possible. Chaque jour, chaque membre en reçoit
-- trois : un de chaque groupe (la machine, les cartes, la chance), tirés au
-- hasard mais toujours les mêmes pour lui ce jour-là. Le jour change à
-- minuit, heure de Paris.
--
--   type :  tours     tours joués aujourd'hui
--           gains     tours gagnants (de l'XP ou des pièces)
--           paires    tours à deux symboles identiques ou plus
--           trios     tours à trois symboles identiques
--           pieces    pièces gagnées à la machine aujourd'hui
--           boosters  boosters ouverts aujourd'hui
--           achats    achats chez le croupier aujourd'hui
--           nouvelles cartes nouvelles pour le membre, obtenues aujourd'hui
-- ---------------------------------------------------------------------

create table if not exists public.waveurs_defis (
  id        serial primary key,
  cle       text not null unique,
  nom       text not null,
  description text,
  groupe    text not null check (groupe in ('machine', 'cartes', 'chance')),
  type      text not null check (type in
              ('tours', 'gains', 'paires', 'trios', 'pieces', 'boosters', 'achats', 'nouvelles')),
  objectif  integer not null check (objectif > 0),
  pieces    integer not null default 0 check (pieces >= 0),
  xp        integer not null default 0 check (xp >= 0),
  actif     boolean not null default true
);

insert into public.waveurs_defis (cle, nom, description, groupe, type, objectif, pieces, xp) values
  ('tours-5',    'Échauffement',   'Tire le levier 5 fois.',                         'machine', 'tours',     5,  4, 0),
  ('tours-8',    'Marathon',       'Joue 8 tours.',                                  'machine', 'tours',     8,  8, 2),
  ('pieces-20',  'Cagnotte',       'Gagne 20 pièces à la machine.',                  'machine', 'pieces',   20,  5, 0),
  ('pieces-50',  'Gros portefeuille', 'Gagne 50 pièces à la machine.',               'machine', 'pieces',   50, 10, 2),
  ('boosters-1', 'Déchire !',      'Ouvre un booster.',                              'cartes',  'boosters',  1,  6, 0),
  ('achats-1',   'Chez le croupier', 'Achète un booster.',                           'cartes',  'achats',    1,  3, 0),
  ('nouvelles-1','Une nouvelle',   'Obtiens une carte que tu n''avais pas.',         'cartes',  'nouvelles', 1,  8, 2),
  ('nouvelles-3','Collectionneur', 'Obtiens 3 cartes que tu n''avais pas.',          'cartes',  'nouvelles', 3, 15, 4),
  ('gains-1',    'Premier gain',   'Fais un tour gagnant.',                          'chance',  'gains',     1,  3, 0),
  ('gains-3',    'Veinard',        'Fais 3 tours gagnants.',                         'chance',  'gains',     3,  7, 2),
  ('paires-2',   'Doublé',         'Fais 2 tours avec au moins une paire.',          'chance',  'paires',    2,  6, 1),
  ('trios-1',    'Triplé',         'Aligne trois symboles identiques.',              'chance',  'trios',     1, 15, 5)
on conflict (cle) do nothing;

create table if not exists public.waveurs_defis_reclames (
  user_id uuid    not null references auth.users(id) on delete cascade,
  jour    date    not null,
  defi_id integer not null references public.waveurs_defis(id) on delete cascade,
  cree_le timestamptz not null default now(),
  primary key (user_id, jour, defi_id)
);


-- ---------------------------------------------------------------------
-- 2. La série
--
-- Un jour compte dès qu'on a tiré le levier une fois. La série, c'est le
-- nombre de jours de suite jusqu'à aujourd'hui (ou jusqu'à hier : on a
-- jusqu'à minuit pour la prolonger). Rater un jour la remet à zéro.
--
-- Chaque palier se réclame une fois par série : après une interruption, une
-- nouvelle série peut en gagner à nouveau.
-- ---------------------------------------------------------------------

create table if not exists public.waveurs_serie_paliers (
  jours    integer primary key check (jours > 0),
  pieces   integer not null default 0 check (pieces >= 0),
  boosters integer not null default 0 check (boosters >= 0),
  xp       integer not null default 0 check (xp >= 0)
);

insert into public.waveurs_serie_paliers (jours, pieces, boosters, xp) values
  (2,   8, 0,  0),
  (3,  15, 0,  2),
  (5,  25, 0,  3),
  (7,  20, 1,  5),
  (14,  0, 2, 10),
  (30, 60, 5, 25)
on conflict (jours) do nothing;

create table if not exists public.waveurs_serie_reclames (
  user_id uuid    not null references auth.users(id) on delete cascade,
  debut   date    not null,
  jours   integer not null references public.waveurs_serie_paliers(jours) on delete cascade,
  cree_le timestamptz not null default now(),
  primary key (user_id, debut, jours)
);


-- ---------------------------------------------------------------------
-- 3. Les succès
--
-- Des objectifs qui se débloquent une fois pour toutes. Chaque ligne a un
-- type, qui dit ce qu'on compte, et un objectif :
--
--   tours        tours joués en tout          jackpots   trois logos La Wave
--   gains        tours gagnants               trios      trois symboles identiques
--   pieces       pièces gagnées à la machine  boosters   boosters ouverts
--   cartes       cartes différentes possédées serie      plus longue série de jours
--   rares        cartes rares, épiques ou légendaires différentes
--   epiques      cartes épiques ou légendaires différentes
--   legendaires  cartes légendaires différentes
--   communes_toutes / rares_toutes / epiques_toutes / legendaires_toutes /
--   collection   toutes les cartes de cette rareté, ou de la série entière
--                (l'objectif est alors calculé : la taille du catalogue en jeu)
-- ---------------------------------------------------------------------

create table if not exists public.waveurs_succes (
  id          serial primary key,
  cle         text not null unique,
  nom         text not null,
  description text,
  type        text not null check (type in
                ('tours', 'gains', 'pieces', 'jackpots', 'trios', 'boosters', 'cartes', 'rares',
                 'epiques', 'legendaires', 'serie', 'communes_toutes', 'rares_toutes',
                 'epiques_toutes', 'legendaires_toutes', 'collection')),
  objectif    integer not null default 1 check (objectif > 0),
  pieces      integer not null default 0 check (pieces >= 0),
  boosters    integer not null default 0 check (boosters >= 0),
  xp          integer not null default 0 check (xp >= 0),
  ordre       integer not null default 100,
  actif       boolean not null default true
);

insert into public.waveurs_succes (cle, nom, description, type, objectif, pieces, boosters, xp, ordre) values
  ('premier-tour',   'Premier tour',      'Tire le levier une première fois.',            'tours',      1,    5, 0,  2,  10),
  ('habitue',        'Habitué',           'Joue 50 tours.',                               'tours',     50,   30, 0,  5,  20),
  ('accro',          'Accro à la vague',  'Joue 250 tours.',                              'tours',    250,   80, 1, 15,  30),
  ('veinard',        'Veinard',           'Fais 25 tours gagnants.',                      'gains',     25,   25, 0,  5,  40),
  ('riche',          'Poches pleines',    'Gagne 500 pièces à la machine.',               'pieces',   500,   40, 0,  8,  50),
  ('triple',         'Tout pareil',       'Aligne trois symboles identiques.',            'trios',      1,   15, 0,  3,  60),
  ('jackpot',        'Jackpot !',         'Aligne trois logos La Wave.',                  'jackpots',   1,   50, 1, 20,  70),
  ('premier-booster','Déchirer le papier','Ouvre ton premier booster.',                   'boosters',   1,   10, 0,  2,  80),
  ('dix-boosters',   'Pluie de cartes',   'Ouvre 10 boosters.',                           'boosters',  10,   40, 1, 10,  90),
  ('dix-cartes',     'Un début d''album', 'Possède 10 cartes différentes.',               'cartes',    10,   20, 0,  5, 100),
  ('vingt-cartes',   'L''album se remplit','Possède 20 cartes différentes.',              'cartes',    20,   40, 1, 10, 110),
  ('communes',       'Les communes au complet','Possède toutes les cartes communes.',     'communes_toutes', 1, 40, 1, 10, 120),
  ('rares',          'Chasseur de raretés','Possède 5 cartes rares ou mieux, différentes.','rares',     5,   40, 0, 10, 130),
  ('epique',         'Une pièce d''exception','Obtiens une carte épique.',                'epiques',    1,   30, 0,  8, 140),
  ('legendaire',     'Légende vivante',   'Obtiens une carte légendaire.',                'legendaires',1,  100, 2, 25, 150),
  ('serie-7',        'Une semaine de vague','Tiens une série de 7 jours.',                'serie',      7,   40, 1, 10, 160),
  ('serie-30',       'Un mois sur la vague','Tiens une série de 30 jours.',               'serie',     30,  150, 3, 40, 170),
  ('collection',     'La série complète', 'Possède toutes les cartes de la série.',       'collection', 1,  300, 5, 80, 180)
on conflict (cle) do nothing;

create table if not exists public.waveurs_succes_reclames (
  user_id   uuid    not null references auth.users(id) on delete cascade,
  succes_id integer not null references public.waveurs_succes(id) on delete cascade,
  cree_le   timestamptz not null default now(),
  primary key (user_id, succes_id)
);


-- ---------------------------------------------------------------------
-- 4. Le recyclage
--
-- Une carte en double (on en possède plusieurs exemplaires) se recycle en
-- pièces : on en garde toujours un exemplaire. La valeur dépend de la
-- rareté.
-- ---------------------------------------------------------------------

create table if not exists public.waveurs_recyclage (
  rarete text primary key check (rarete in ('commune', 'rare', 'epique', 'legendaire')),
  pieces integer not null check (pieces >= 0)
);

insert into public.waveurs_recyclage (rarete, pieces) values
  ('commune', 3), ('rare', 10), ('epique', 35), ('legendaire', 120)
on conflict (rarete) do nothing;


-- ---------------------------------------------------------------------
-- 5. Règles d'accès : les barèmes sont publics, les réclamations privées
-- ---------------------------------------------------------------------

alter table public.waveurs_defis            enable row level security;
alter table public.waveurs_defis_reclames   enable row level security;
alter table public.waveurs_serie_paliers    enable row level security;
alter table public.waveurs_serie_reclames   enable row level security;
alter table public.waveurs_succes           enable row level security;
alter table public.waveurs_succes_reclames  enable row level security;
alter table public.waveurs_recyclage        enable row level security;

drop policy if exists "defis lisibles"      on public.waveurs_defis;
drop policy if exists "defis ecrits"        on public.waveurs_defis;
drop policy if exists "paliers lisibles"    on public.waveurs_serie_paliers;
drop policy if exists "paliers ecrits"      on public.waveurs_serie_paliers;
drop policy if exists "succes lisibles"     on public.waveurs_succes;
drop policy if exists "succes ecrits"       on public.waveurs_succes;
drop policy if exists "recyclage lisible"   on public.waveurs_recyclage;
drop policy if exists "recyclage ecrit"     on public.waveurs_recyclage;

create policy "defis lisibles"   on public.waveurs_defis for select to anon, authenticated using (actif);
create policy "defis ecrits"     on public.waveurs_defis for all to authenticated
  using (public.est_equipe()) with check (public.est_equipe());

create policy "paliers lisibles" on public.waveurs_serie_paliers for select to anon, authenticated using (true);
create policy "paliers ecrits"   on public.waveurs_serie_paliers for all to authenticated
  using (public.est_equipe()) with check (public.est_equipe());

create policy "succes lisibles"  on public.waveurs_succes for select to anon, authenticated using (actif);
create policy "succes ecrits"    on public.waveurs_succes for all to authenticated
  using (public.est_equipe()) with check (public.est_equipe());

create policy "recyclage lisible" on public.waveurs_recyclage for select to anon, authenticated using (true);
create policy "recyclage ecrit"   on public.waveurs_recyclage for all to authenticated
  using (public.est_equipe()) with check (public.est_equipe());

-- Les réclamations n'ont aucune règle : seules les fonctions les écrivent et
-- les lisent.
revoke all on public.waveurs_defis_reclames  from anon, authenticated;
revoke all on public.waveurs_serie_reclames  from anon, authenticated;
revoke all on public.waveurs_succes_reclames from anon, authenticated;

revoke insert, update, delete, truncate on public.waveurs_defis, public.waveurs_serie_paliers,
  public.waveurs_succes, public.waveurs_recyclage from anon;


-- ---------------------------------------------------------------------
-- 6. Les petits outils (internes : personne ne les appelle d'un navigateur)
-- ---------------------------------------------------------------------

-- Le jour de Paris.
create or replace function public.waveurs_jour()
returns date
language sql
stable
as $$
  select (now() at time zone 'Europe/Paris')::date;
$$;

-- Les pièces, boosters et XP versés à un membre. Renvoie ce qu'il a ensuite.
create or replace function public.waveurs_crediter(
  p_user     uuid,
  p_pieces   integer,
  p_boosters integer,
  p_xp       integer
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pieces   integer;
  v_boosters integer;
  v_xp       integer;
begin

  insert into public.waveurs_portefeuille as w (user_id, pieces, boosters)
  values (p_user, greatest(p_pieces, 0), greatest(p_boosters, 0))
  on conflict (user_id) do update
     set pieces   = w.pieces + greatest(p_pieces, 0),
         boosters = w.boosters + greatest(p_boosters, 0),
         maj      = now()
  returning w.pieces, w.boosters into v_pieces, v_boosters;

  if coalesce(p_xp, 0) > 0 then
    update public.profiles set xp = coalesce(xp, 0) + p_xp where id = p_user;
  end if;

  select coalesce(p.xp, 0) into v_xp from public.profiles p where p.id = p_user;

  return json_build_object('pieces_total', v_pieces, 'boosters_total', v_boosters, 'xp_total', v_xp);
end $$;

-- Où en est un défi, pour un membre, un jour donné.
create or replace function public.waveurs_progres_defi(p_user uuid, p_type text, p_jour date)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_debut timestamptz := (p_jour::timestamp) at time zone 'Europe/Paris';
  v_fin   timestamptz := ((p_jour + 1)::timestamp) at time zone 'Europe/Paris';
  v_n     integer := 0;
begin

  if p_type = 'tours' then
    select count(*) into v_n from public.waveurs_tours
     where user_id = p_user and cree_le >= v_debut and cree_le < v_fin;

  elsif p_type = 'gains' then
    select count(*) into v_n from public.waveurs_tours
     where user_id = p_user and cree_le >= v_debut and cree_le < v_fin and (xp > 0 or pieces > 0);

  elsif p_type = 'paires' then
    select count(*) into v_n from public.waveurs_tours
     where user_id = p_user and cree_le >= v_debut and cree_le < v_fin and motif in ('paire', 'trio');

  elsif p_type = 'trios' then
    select count(*) into v_n from public.waveurs_tours
     where user_id = p_user and cree_le >= v_debut and cree_le < v_fin and motif = 'trio';

  elsif p_type = 'pieces' then
    select coalesce(sum(pieces), 0) into v_n from public.waveurs_tours
     where user_id = p_user and cree_le >= v_debut and cree_le < v_fin;

  elsif p_type = 'boosters' then
    select count(*) into v_n from public.waveurs_ouvertures
     where user_id = p_user and cree_le >= v_debut and cree_le < v_fin;

  elsif p_type = 'achats' then
    select coalesce(sum(quantite), 0) into v_n from public.waveurs_achats
     where user_id = p_user and cree_le >= v_debut and cree_le < v_fin;

  elsif p_type = 'nouvelles' then
    select count(*) into v_n from public.waveurs_collection
     where user_id = p_user and premiere_le >= v_debut and premiere_le < v_fin;

  end if;

  return coalesce(v_n, 0);
end $$;

-- Les trois défis d'un membre pour un jour : un par groupe, toujours les
-- mêmes pour lui ce jour-là.
create or replace function public.waveurs_defis_du_jour(p_user uuid, p_jour date)
returns setof public.waveurs_defis
language sql
stable
security definer
set search_path = public
as $$
  select w.*
    from public.waveurs_defis w
   where w.id in (
           select x.id
             from (
               select d.id,
                      row_number() over (
                        partition by d.groupe
                        order by md5(p_user::text || p_jour::text || d.id::text)
                      ) as rang
                 from public.waveurs_defis d
                where d.actif
             ) x
            where x.rang = 1
         )
   order by case w.groupe when 'machine' then 1 when 'cartes' then 2 else 3 end;
$$;

-- La série d'un membre : sa longueur, son premier jour, sa meilleure, et s'il
-- a déjà joué aujourd'hui.
create or replace function public.waveurs_serie_calcul(p_user uuid)
returns table (jours integer, debut date, meilleure integer, aujourdhui boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_aujourdhui date := public.waveurs_jour();
  v_dernier    date;
begin

  return query
  with j as (
    select distinct (t.cree_le at time zone 'Europe/Paris')::date as jour
      from public.waveurs_tours t
     where t.user_id = p_user
  ),
  g as (
    select jour, jour - (row_number() over (order by jour))::integer as groupe from j
  ),
  s as (
    select groupe, count(*)::integer as n, min(jour) as premier, max(jour) as dernier from g group by groupe
  )
  select
    coalesce((select s.n from s where s.dernier >= v_aujourdhui - 1 order by s.dernier desc limit 1), 0),
    (select s.premier from s where s.dernier >= v_aujourdhui - 1 order by s.dernier desc limit 1),
    coalesce((select max(s.n) from s), 0),
    exists (select 1 from j where j.jour = v_aujourdhui);

end $$;

-- Où en est un succès pour un membre.
create or replace function public.waveurs_progres_succes(p_user uuid, p_type text)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_n integer := 0;
begin

  if p_type = 'tours' then
    select count(*) into v_n from public.waveurs_tours where user_id = p_user;
  elsif p_type = 'gains' then
    select count(*) into v_n from public.waveurs_tours where user_id = p_user and (xp > 0 or pieces > 0);
  elsif p_type = 'pieces' then
    select coalesce(sum(pieces), 0) into v_n from public.waveurs_tours where user_id = p_user;
  elsif p_type = 'trios' then
    select count(*) into v_n from public.waveurs_tours where user_id = p_user and motif = 'trio';
  elsif p_type = 'jackpots' then
    select count(*) into v_n from public.waveurs_tours
     where user_id = p_user and motif = 'trio' and 'logo' = all (symboles);
  elsif p_type = 'boosters' then
    select count(*) into v_n from public.waveurs_ouvertures where user_id = p_user;
  elsif p_type = 'cartes' then
    select count(*) into v_n from public.waveurs_collection k
      join public.waveurs_cartes c on c.id = k.carte_id and c.actif where k.user_id = p_user;
  elsif p_type = 'rares' then
    select count(*) into v_n from public.waveurs_collection k
      join public.waveurs_cartes c on c.id = k.carte_id and c.actif
     where k.user_id = p_user and c.rarete in ('rare', 'epique', 'legendaire');
  elsif p_type = 'epiques' then
    select count(*) into v_n from public.waveurs_collection k
      join public.waveurs_cartes c on c.id = k.carte_id and c.actif
     where k.user_id = p_user and c.rarete in ('epique', 'legendaire');
  elsif p_type = 'legendaires' then
    select count(*) into v_n from public.waveurs_collection k
      join public.waveurs_cartes c on c.id = k.carte_id and c.actif
     where k.user_id = p_user and c.rarete = 'legendaire';
  elsif p_type = 'serie' then
    select s.meilleure into v_n from public.waveurs_serie_calcul(p_user) s;
  elsif p_type in ('communes_toutes', 'rares_toutes', 'epiques_toutes', 'legendaires_toutes') then
    -- 1 quand on les a toutes, 0 sinon (l'objectif d'une ligne de ce type est 1).
    select case when (
             select count(*) from public.waveurs_cartes c
              where c.actif and c.rarete = replace(p_type, 's_toutes', '')
           ) > 0 and not exists (
             select 1 from public.waveurs_cartes c
              where c.actif and c.rarete = replace(p_type, 's_toutes', '')
                and not exists (select 1 from public.waveurs_collection k
                                 where k.user_id = p_user and k.carte_id = c.id)
           ) then 1 else 0 end into v_n;
  elsif p_type = 'collection' then
    select case when (select count(*) from public.waveurs_cartes where actif) > 0 and not exists (
             select 1 from public.waveurs_cartes c where c.actif
               and not exists (select 1 from public.waveurs_collection k
                                where k.user_id = p_user and k.carte_id = c.id)
           ) then 1 else 0 end into v_n;
  end if;

  return coalesce(v_n, 0);
end $$;


-- ---------------------------------------------------------------------
-- 7. Le carnet : tout ce qu'on affiche, en un appel
-- ---------------------------------------------------------------------

create or replace function public.waveurs_carnet()
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_jour   date := public.waveurs_jour();
  v_serie  record;
  v_defis  jsonb;
  v_succes jsonb;
  v_paliers jsonb;
  v_recyclage jsonb;
  v_doubles integer;
  v_a_reclamer integer := 0;
begin

  if auth.uid() is null then
    raise exception 'Connecte-toi pour ouvrir ton carnet.';
  end if;

  select s.jours, s.debut, s.meilleure, s.aujourdhui into v_serie
    from public.waveurs_serie_calcul(auth.uid()) s;

  -- Les défis du jour.
  select coalesce(jsonb_agg(x.o order by x.ordre), '[]'::jsonb) into v_defis
    from (
      select row_number() over (order by case d.groupe when 'machine' then 1 when 'cartes' then 2 else 3 end) as ordre,
             jsonb_build_object(
               'id', d.id, 'nom', d.nom, 'description', d.description, 'groupe', d.groupe,
               'objectif', d.objectif, 'pieces', d.pieces, 'xp', d.xp,
               'progres', least(p.n, d.objectif),
               'atteint', p.n >= d.objectif,
               'reclame', r.defi_id is not null,
               'reclamable', p.n >= d.objectif and r.defi_id is null
             ) as o
        from public.waveurs_defis_du_jour(auth.uid(), v_jour) d
        cross join lateral (select public.waveurs_progres_defi(auth.uid(), d.type, v_jour) as n) p
        left join public.waveurs_defis_reclames r
               on r.user_id = auth.uid() and r.jour = v_jour and r.defi_id = d.id
    ) x;

  -- Les paliers de la série.
  select coalesce(jsonb_agg(jsonb_build_object(
           'jours', p.jours, 'pieces', p.pieces, 'boosters', p.boosters, 'xp', p.xp,
           'atteint', v_serie.jours >= p.jours,
           'reclame', r.jours is not null,
           'reclamable', v_serie.jours >= p.jours and r.jours is null
         ) order by p.jours), '[]'::jsonb) into v_paliers
    from public.waveurs_serie_paliers p
    left join public.waveurs_serie_reclames r
           on r.user_id = auth.uid() and r.debut = v_serie.debut and r.jours = p.jours;

  -- Les succès.
  select coalesce(jsonb_agg(x.o order by x.ordre, x.id), '[]'::jsonb) into v_succes
    from (
      select s.id, s.ordre,
             jsonb_build_object(
               'id', s.id, 'nom', s.nom, 'description', s.description, 'type', s.type,
               'objectif', s.objectif, 'pieces', s.pieces, 'boosters', s.boosters, 'xp', s.xp,
               'progres', least(p.n, s.objectif),
               'debloque', p.n >= s.objectif,
               'reclame', r.succes_id is not null,
               'reclamable', p.n >= s.objectif and r.succes_id is null
             ) as o
        from public.waveurs_succes s
        cross join lateral (select public.waveurs_progres_succes(auth.uid(), s.type) as n) p
        left join public.waveurs_succes_reclames r
               on r.user_id = auth.uid() and r.succes_id = s.id
       where s.actif
    ) x;

  select coalesce(jsonb_object_agg(rarete, pieces), '{}'::jsonb) into v_recyclage
    from public.waveurs_recyclage;

  select coalesce(sum(k.quantite - 1), 0)::integer into v_doubles
    from public.waveurs_collection k
    join public.waveurs_cartes c on c.id = k.carte_id and c.actif
   where k.user_id = auth.uid();

  -- De quoi afficher la pastille « à récupérer ».
  select coalesce(sum(case when (e->>'reclamable')::boolean then 1 else 0 end), 0)::integer
    into v_a_reclamer from jsonb_array_elements(v_defis || v_paliers || v_succes) e;

  return json_build_object(
    'jour',        v_jour,
    'defis',       v_defis,
    'serie',       json_build_object(
                     'jours', v_serie.jours, 'debut', v_serie.debut,
                     'meilleure', v_serie.meilleure, 'aujourdhui', v_serie.aujourdhui,
                     'paliers', v_paliers),
    'succes',      v_succes,
    'recyclage',   v_recyclage,
    'doubles',     v_doubles,
    'a_reclamer',  v_a_reclamer
  );
end $$;


-- ---------------------------------------------------------------------
-- 8. Réclamer une récompense
--
-- Le profil est verrouillé pour la durée de l'appel, comme pour un tirage :
-- deux clics au même instant passent l'un après l'autre, et la seconde
-- réclamation voit la première.
-- ---------------------------------------------------------------------

create or replace function public.waveurs_defi_reclamer(p_defi integer)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_jour date := public.waveurs_jour();
  v_defi public.waveurs_defis;
  v_n    integer;
  v_res  json;
begin

  if auth.uid() is null then
    raise exception 'Connecte-toi pour récupérer ta récompense.';
  end if;

  perform 1 from public.profiles where id = auth.uid() for update;

  select d.* into v_defi
    from public.waveurs_defis_du_jour(auth.uid(), v_jour) d
   where d.id = p_defi;

  if not found then
    raise exception 'Ce défi n''est pas un des tiens aujourd''hui.';
  end if;

  if exists (select 1 from public.waveurs_defis_reclames
              where user_id = auth.uid() and jour = v_jour and defi_id = v_defi.id) then
    raise exception 'Tu as déjà récupéré cette récompense.';
  end if;

  v_n := public.waveurs_progres_defi(auth.uid(), v_defi.type, v_jour);

  if v_n < v_defi.objectif then
    raise exception 'Ce défi n''est pas encore accompli.';
  end if;

  insert into public.waveurs_defis_reclames (user_id, jour, defi_id)
  values (auth.uid(), v_jour, v_defi.id);

  v_res := public.waveurs_crediter(auth.uid(), v_defi.pieces, 0, v_defi.xp);

  return json_build_object(
    'pieces', v_defi.pieces, 'boosters', 0, 'xp', v_defi.xp,
    'pieces_total', v_res->'pieces_total', 'boosters_total', v_res->'boosters_total', 'xp_total', v_res->'xp_total'
  );
end $$;


create or replace function public.waveurs_serie_reclamer(p_jours integer)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_serie  record;
  v_palier public.waveurs_serie_paliers;
  v_res    json;
begin

  if auth.uid() is null then
    raise exception 'Connecte-toi pour récupérer ta récompense.';
  end if;

  perform 1 from public.profiles where id = auth.uid() for update;

  select * into v_palier from public.waveurs_serie_paliers where jours = p_jours;

  if not found then
    raise exception 'Ce palier n''existe pas.';
  end if;

  select s.jours, s.debut into v_serie from public.waveurs_serie_calcul(auth.uid()) s;

  if v_serie.jours < v_palier.jours then
    raise exception 'Ta série n''a pas encore atteint % jours.', v_palier.jours;
  end if;

  if exists (select 1 from public.waveurs_serie_reclames
              where user_id = auth.uid() and debut = v_serie.debut and jours = v_palier.jours) then
    raise exception 'Tu as déjà récupéré ce palier de ta série.';
  end if;

  insert into public.waveurs_serie_reclames (user_id, debut, jours)
  values (auth.uid(), v_serie.debut, v_palier.jours);

  v_res := public.waveurs_crediter(auth.uid(), v_palier.pieces, v_palier.boosters, v_palier.xp);

  return json_build_object(
    'pieces', v_palier.pieces, 'boosters', v_palier.boosters, 'xp', v_palier.xp,
    'pieces_total', v_res->'pieces_total', 'boosters_total', v_res->'boosters_total', 'xp_total', v_res->'xp_total'
  );
end $$;


create or replace function public.waveurs_succes_reclamer(p_succes integer)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_succes public.waveurs_succes;
  v_n      integer;
  v_res    json;
begin

  if auth.uid() is null then
    raise exception 'Connecte-toi pour récupérer ta récompense.';
  end if;

  perform 1 from public.profiles where id = auth.uid() for update;

  select * into v_succes from public.waveurs_succes where id = p_succes and actif;

  if not found then
    raise exception 'Ce succès n''existe pas.';
  end if;

  if exists (select 1 from public.waveurs_succes_reclames
              where user_id = auth.uid() and succes_id = v_succes.id) then
    raise exception 'Tu as déjà récupéré ce succès.';
  end if;

  v_n := public.waveurs_progres_succes(auth.uid(), v_succes.type);

  if v_n < v_succes.objectif then
    raise exception 'Ce succès n''est pas encore débloqué.';
  end if;

  insert into public.waveurs_succes_reclames (user_id, succes_id)
  values (auth.uid(), v_succes.id);

  v_res := public.waveurs_crediter(auth.uid(), v_succes.pieces, v_succes.boosters, v_succes.xp);

  return json_build_object(
    'pieces', v_succes.pieces, 'boosters', v_succes.boosters, 'xp', v_succes.xp,
    'pieces_total', v_res->'pieces_total', 'boosters_total', v_res->'boosters_total', 'xp_total', v_res->'xp_total'
  );
end $$;


-- ---------------------------------------------------------------------
-- 9. Recycler ses doubles
--
-- Une carte (p_carte) ou tous les doubles jusqu'à une rareté (p_jusqua :
-- 'commune', 'rare', 'epique' ; jamais les légendaires en bloc). Un
-- exemplaire de chaque carte est toujours gardé.
-- ---------------------------------------------------------------------

create or replace function public.waveurs_recycler(
  p_carte    integer default null,
  p_quantite integer default 1,
  p_jusqua   text    default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ligne   record;
  v_gagne   integer := 0;
  v_cartes  integer := 0;
  v_ordre   constant text[] := array['commune', 'rare', 'epique', 'legendaire'];
  v_limite  integer;
  v_res     json;
begin

  if auth.uid() is null then
    raise exception 'Connecte-toi pour recycler tes cartes.';
  end if;

  perform 1 from public.profiles where id = auth.uid() for update;

  -- Le portefeuille d'abord, comme l'ouverture d'un booster : deux gestes
  -- simultanés se suivent au lieu de s'attendre l'un l'autre.
  perform 1 from public.waveurs_portefeuille where user_id = auth.uid() for update;

  if p_carte is not null then

    if coalesce(p_quantite, 0) < 1 or p_quantite > 99 then
      raise exception 'Quantité invalide.';
    end if;

    select k.quantite, c.rarete, coalesce(r.pieces, 0) as valeur into v_ligne
      from public.waveurs_collection k
      join public.waveurs_cartes c on c.id = k.carte_id
      left join public.waveurs_recyclage r on r.rarete = c.rarete
     where k.user_id = auth.uid() and k.carte_id = p_carte
     for update of k;

    if not found then
      raise exception 'Tu ne possèdes pas cette carte.';
    end if;

    if v_ligne.quantite - p_quantite < 1 then
      raise exception 'Un exemplaire de chaque carte reste dans ton album : tu n''as que % double(s).', v_ligne.quantite - 1;
    end if;

    update public.waveurs_collection
       set quantite = quantite - p_quantite
     where user_id = auth.uid() and carte_id = p_carte;

    v_gagne := v_ligne.valeur * p_quantite;
    v_cartes := p_quantite;

  else

    v_limite := array_position(v_ordre, coalesce(p_jusqua, 'commune'));

    if v_limite is null or v_limite > 3 then
      raise exception 'Les cartes légendaires ne se recyclent pas en bloc.';
    end if;

    for v_ligne in
      select k.carte_id, k.quantite - 1 as doubles, coalesce(r.pieces, 0) as valeur
        from public.waveurs_collection k
        join public.waveurs_cartes c on c.id = k.carte_id
        left join public.waveurs_recyclage r on r.rarete = c.rarete
       where k.user_id = auth.uid() and k.quantite > 1
         and array_position(v_ordre, c.rarete) <= v_limite
       for update of k
    loop
      update public.waveurs_collection set quantite = 1 where user_id = auth.uid() and carte_id = v_ligne.carte_id;
      v_gagne := v_gagne + v_ligne.valeur * v_ligne.doubles;
      v_cartes := v_cartes + v_ligne.doubles;
    end loop;

    if v_cartes = 0 then
      raise exception 'Tu n''as aucun double à recycler.';
    end if;

  end if;

  v_res := public.waveurs_crediter(auth.uid(), v_gagne, 0, 0);

  return json_build_object(
    'cartes', v_cartes, 'pieces', v_gagne,
    'pieces_total', v_res->'pieces_total', 'boosters_total', v_res->'boosters_total'
  );
end $$;


-- ---------------------------------------------------------------------
-- 10. Droits d'appel
-- ---------------------------------------------------------------------

revoke all on function public.waveurs_jour()                                    from public, anon, authenticated;
revoke all on function public.waveurs_crediter(uuid, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.waveurs_progres_defi(uuid, text, date)            from public, anon, authenticated;
revoke all on function public.waveurs_defis_du_jour(uuid, date)                 from public, anon, authenticated;
revoke all on function public.waveurs_serie_calcul(uuid)                        from public, anon, authenticated;
revoke all on function public.waveurs_progres_succes(uuid, text)                from public, anon, authenticated;

revoke all on function public.waveurs_carnet()                       from public, anon;
revoke all on function public.waveurs_defi_reclamer(integer)         from public, anon;
revoke all on function public.waveurs_serie_reclamer(integer)        from public, anon;
revoke all on function public.waveurs_succes_reclamer(integer)       from public, anon;
revoke all on function public.waveurs_recycler(integer, integer, text) from public, anon;

grant execute on function public.waveurs_carnet()                       to authenticated;
grant execute on function public.waveurs_defi_reclamer(integer)         to authenticated;
grant execute on function public.waveurs_serie_reclamer(integer)        to authenticated;
grant execute on function public.waveurs_succes_reclamer(integer)       to authenticated;
grant execute on function public.waveurs_recycler(integer, integer, text) to authenticated;

notify pgrst, 'reload schema';

commit;


-- ---------------------------------------------------------------------
-- Pour retirer le carnet (à garder de côté, pas à exécuter maintenant)
--
--   drop function if exists public.waveurs_carnet();
--   drop function if exists public.waveurs_defi_reclamer(integer);
--   drop function if exists public.waveurs_serie_reclamer(integer);
--   drop function if exists public.waveurs_succes_reclamer(integer);
--   drop function if exists public.waveurs_recycler(integer, integer, text);
--   drop function if exists public.waveurs_progres_succes(uuid, text);
--   drop function if exists public.waveurs_serie_calcul(uuid);
--   drop function if exists public.waveurs_defis_du_jour(uuid, date);
--   drop function if exists public.waveurs_progres_defi(uuid, text, date);
--   drop function if exists public.waveurs_crediter(uuid, integer, integer, integer);
--   drop function if exists public.waveurs_jour();
--   drop table if exists public.waveurs_defis_reclames, public.waveurs_serie_reclames,
--     public.waveurs_succes_reclames, public.waveurs_defis, public.waveurs_serie_paliers,
--     public.waveurs_succes, public.waveurs_recyclage;
-- ---------------------------------------------------------------------
