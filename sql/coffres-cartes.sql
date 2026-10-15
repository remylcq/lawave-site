-- =====================================================================
-- La Wave — Waves Coins (WC), coffres saisonniers, cartes à collectionner
--
-- Demande de Rémy : des coffres de cartes à collectionner, achetés avec des Waves Coins. Les WC se gagnent en
-- même temps que l'XP et par des défis spéciaux (WC seulement). Des collections saisonnières à durée limitée
-- (Halloween pour tester ; Saint-Valentin, Top 2026… annoncés) dont les cartes sont des sorties du catalogue
-- (pochette + cadre propre à la collection). Six raretés : commun, peu commun, rare, ultra rare, légendaire,
-- Secret Wave. Un classeur par collection. L'échange viendra plus tard.
--
--   * WC          1 XP gagné = 1 WC gagné (gestes, quêtes, séries, succès). Un cadeau de lancement de 300 WC aux
--                 comptes existants pour essayer. Tout passe par wc_crediter ; le membre ne peut rien écrire.
--   * DÉFIS WC    trois défis par semaine (tirés par membre), payés en WC seulement.
--   * COFFRES     acheter (coffre_acheter) puis ouvrir (coffre_ouvrir) : 5 cartes, la dernière au moins « peu commune ».
--   * CLASSEUR    classeur_collection : une page par collection, les cartes pas encore obtenues restent cachées.
--
-- Le « coffre du jour » de l'XP (bonus des trois quêtes) devient « bonus du jour », pour ne pas se confondre
-- avec les coffres de cartes.
--
-- À passer APRÈS sql/xp-refonte.sql. Sans danger à rejouer.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Les Waves Coins
-- ---------------------------------------------------------------------

create table if not exists public.wc_portefeuille (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  solde   integer not null default 0 check (solde >= 0)
);

create table if not exists public.wc_journal (
  id      bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  delta   integer not null,
  motif   text not null,
  ref     text not null default '',
  cree_le timestamptz not null default now(),
  constraint wc_journal_unique unique (user_id, motif, ref)
);
create index if not exists wc_journal_membre on public.wc_journal (user_id, cree_le desc);

-- Verse des WC (jamais deux fois le même motif + référence). Rend le nombre versé.
create or replace function public.wc_crediter(p_user uuid, p_n integer, p_motif text, p_ref text default '')
returns integer language plpgsql security definer set search_path = public
as $$
declare v_id bigint;
begin
  if p_user is null or coalesce(p_n, 0) <= 0 then return 0; end if;

  insert into public.wc_journal (user_id, delta, motif, ref)
  values (p_user, p_n, p_motif, coalesce(p_ref, ''))
  on conflict (user_id, motif, ref) do nothing
  returning id into v_id;

  if v_id is null then return 0; end if;

  insert into public.wc_portefeuille as w (user_id, solde) values (p_user, p_n)
  on conflict (user_id) do update set solde = w.solde + p_n;

  return p_n;
end $$;


-- ---------------------------------------------------------------------
-- 2. L'XP verse des WC (mêmes fonctions qu'avant, avec le WC en plus)
-- ---------------------------------------------------------------------

update public.xp_actions set libelle = 'Bonus du jour' where action = 'coffre';

create or replace function public.xp_brut(p_user uuid, p_action text, p_ref text, p_xp integer)
returns integer language plpgsql security definer set search_path = public
as $$
declare v_jid bigint;
begin
  insert into public.xp_journal (user_id, action, ref, xp)
  values (p_user, p_action, coalesce(p_ref, ''), greatest(coalesce(p_xp, 0), 0))
  on conflict (user_id, action, ref) do nothing
  returning id into v_jid;

  if v_jid is null then return 0; end if;

  if coalesce(p_xp, 0) > 0 then
    perform set_config('lawave.xp_ok', '1', true);
    update public.profiles set xp = coalesce(xp, 0) + p_xp where id = p_user;
    perform set_config('lawave.xp_ok', '0', true);
    perform public.wc_crediter(p_user, p_xp, 'xp', v_jid::text);
  end if;

  return greatest(coalesce(p_xp, 0), 0);
end $$;


-- ---------------------------------------------------------------------
-- 3. Les défis spéciaux : trois par semaine, WC seulement
-- ---------------------------------------------------------------------

create table if not exists public.wc_defis_def (
  id       text primary key,
  action   text not null,
  libelle  text not null,
  icone    text not null default '🎯',
  objectif integer not null,
  wc       integer not null
);

insert into public.wc_defis_def (id, action, libelle, icone, objectif, wc) values
  ('w-notes',        'note',              'Noter 8 sorties',                          '⭐', 8,  60),
  ('w-ecoutes',      'ecoute',            'Écouter 10 sorties',                       '🎧', 10, 60),
  ('w-posts',        'post',              'Publier 3 messages dans la communauté',    '📣', 3,  70),
  ('w-commentaires', 'commentaire',       'Commenter 8 messages',                     '💬', 8,  60),
  ('w-reactions',    'reaction',          'Réagir à 20 messages',                     '🔥', 20, 50),
  ('w-artistes',     'visite_artiste',    'Découvrir 15 artistes',                    '🎤', 15, 50),
  ('w-sorties',      'decouverte_sortie', 'Ouvrir 15 fiches de sorties',              '💿', 15, 50),
  ('w-suivre',       'suivre',            'Suivre 3 nouveaux membres',                '🤝', 3,  40),
  ('w-avis',         'avis',              'Rédiger 2 avis',                           '✍️', 2,  70),
  ('w-favoris',      'favori',            'Choisir 3 favorites',                      '💜', 3,  40)
on conflict (id) do update
  set action = excluded.action, libelle = excluded.libelle, icone = excluded.icone,
      objectif = excluded.objectif, wc = excluded.wc;

create table if not exists public.wc_defis (
  user_id  uuid not null references public.profiles(id) on delete cascade,
  semaine  text not null,
  slot     integer not null,
  def_id   text not null,
  action   text not null,
  libelle  text not null,
  icone    text not null default '🎯',
  progres  integer not null default 0,
  objectif integer not null,
  wc       integer not null,
  faite_le timestamptz,
  primary key (user_id, semaine, slot)
);

create or replace function public.wc_defis_assurer(p_user uuid)
returns void language plpgsql security definer set search_path = public
as $$
declare v_sem text := to_char(public.xp_jour(), 'IYYY-IW');
begin
  if exists (select 1 from public.wc_defis where user_id = p_user and semaine = v_sem) then return; end if;

  insert into public.wc_defis (user_id, semaine, slot, def_id, action, libelle, icone, objectif, wc)
  select p_user, v_sem, row_number() over (order by t.k), t.id, t.action, t.libelle, t.icone, t.objectif, t.wc
  from (
    select d.*, md5(p_user::text || v_sem || d.id) as k
    from public.wc_defis_def d order by k limit 3
  ) t
  on conflict do nothing;
end $$;

create or replace function public.wc_defis_avancer(p_user uuid, p_action text)
returns void language plpgsql security definer set search_path = public
as $$
declare
  v_sem text := to_char(public.xp_jour(), 'IYYY-IW');
  q public.wc_defis%rowtype;
begin
  for q in
    select * from public.wc_defis
     where user_id = p_user and semaine = v_sem and action = p_action and faite_le is null
     for update
  loop
    if q.progres + 1 >= q.objectif then
      update public.wc_defis set progres = q.objectif, faite_le = now()
       where user_id = p_user and semaine = v_sem and slot = q.slot;
      if public.wc_crediter(p_user, q.wc, 'defi', v_sem || ':' || q.def_id) > 0 then
        perform public.xp_evt(p_user, 'defi_wc', jsonb_build_object('libelle', q.libelle, 'icone', q.icone, 'wc', q.wc));
      end if;
    else
      update public.wc_defis set progres = q.progres + 1
       where user_id = p_user and semaine = v_sem and slot = q.slot;
    end if;
  end loop;
end $$;

-- xp_crediter : identique, avec les WC du geste, et les défis spéciaux qui avancent.
create or replace function public.xp_crediter(p_user uuid, p_action text, p_ref text default '')
returns integer language plpgsql security definer set search_path = public
as $$
declare
  a public.xp_actions%rowtype;
  v_jour date := public.xp_jour();
  v_serie integer; v_mult numeric; v_pris integer; v_xp integer; v_jid bigint;
begin
  if p_user is null then return 0; end if;

  select * into a from public.xp_actions where action = p_action and not bonus;
  if not found then return 0; end if;

  if not exists (select 1 from public.profiles where id = p_user) then return 0; end if;

  p_ref := coalesce(p_ref, '');
  if exists (select 1 from public.xp_journal where user_id = p_user and action = p_action and ref = p_ref) then
    return 0;
  end if;

  perform public.xp_etat_assurer(p_user);
  v_serie := public.xp_serie_toucher(p_user);

  v_mult := case when v_serie >= 14 then 1.5 when v_serie >= 7 then 1.25 when v_serie >= 3 then 1.1 else 1 end;

  select count(*) into v_pris
    from public.xp_journal
   where user_id = p_user and action = p_action and jour = v_jour and xp > 0;

  v_xp := case when a.plafond is not null and v_pris >= a.plafond then 0
               else round(a.xp * v_mult)::integer end;

  insert into public.xp_journal (user_id, action, ref, xp) values (p_user, p_action, p_ref, v_xp)
  on conflict (user_id, action, ref) do nothing
  returning id into v_jid;

  if v_jid is null then return 0; end if;

  if v_xp > 0 then
    perform set_config('lawave.xp_ok', '1', true);
    update public.profiles set xp = coalesce(xp, 0) + v_xp where id = p_user;
    perform set_config('lawave.xp_ok', '0', true);

    perform public.wc_crediter(p_user, v_xp, 'xp', v_jid::text);

    perform public.xp_evt(p_user, 'gain', jsonb_build_object(
      'action', p_action, 'libelle', a.libelle, 'icone', a.icone, 'xp', v_xp, 'wc', v_xp, 'multiplicateur', v_mult));
  end if;

  perform public.xp_quetes_assurer(p_user);
  perform public.xp_quetes_avancer(p_user, p_action);
  perform public.wc_defis_assurer(p_user);
  perform public.wc_defis_avancer(p_user, p_action);
  perform public.xp_semaine_verifier(p_user);
  perform public.xp_succes_evaluer(p_user);
  perform public.xp_niveau_verifier(p_user);

  return v_xp;
end $$;

-- Les succès « coffre » parlaient du coffre du jour : on les renomme (les identifiants ne bougent pas).
update public.succes_def set nom = 'Bonus en poche', description = 'Toucher le bonus du jour' where id = 'coffre-1';
update public.succes_def set nom = 'Chasseur de bonus', description = 'Toucher 10 bonus du jour' where id = 'coffre-10';
update public.succes_def set nom = 'Coffre-fort', description = 'Toucher 40 bonus du jour' where id = 'coffre-40';


-- ---------------------------------------------------------------------
-- 4. Collections, cartes, coffres
-- ---------------------------------------------------------------------

create table if not exists public.collections (
  id                text primary key,
  nom               text not null,
  theme             text not null,
  description       text not null default '',
  emoji             text not null default '📦',
  couleurs          jsonb not null default '{}'::jsonb,
  debut             timestamptz not null,
  fin               timestamptz not null,
  prix_wc           integer not null check (prix_wc > 0),
  cartes_par_coffre integer not null default 5 check (cartes_par_coffre between 1 and 12),
  ordre             integer not null default 0
);

-- Une carte = une sortie du catalogue, figée à la création (le titre et la pochette ne changent plus).
create table if not exists public.cartes (
  id            integer generated always as identity primary key,
  collection_id text not null references public.collections(id) on delete cascade,
  numero        integer not null,
  release_id    uuid,
  titre         text not null,
  artiste       text not null,
  cover_url     text,
  type_sortie   text,
  rarete        text not null check (rarete in ('commun', 'peu_commun', 'rare', 'ultra_rare', 'legendaire', 'secret_wave')),
  constraint cartes_numero_unique unique (collection_id, numero)
);

create table if not exists public.cartes_possedees (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  carte_id   integer not null references public.cartes(id) on delete cascade,
  quantite   integer not null default 1 check (quantite > 0),
  premiere_le timestamptz not null default now(),
  primary key (user_id, carte_id)
);

create table if not exists public.coffres_possedes (
  user_id       uuid not null references public.profiles(id) on delete cascade,
  collection_id text not null references public.collections(id) on delete cascade,
  quantite      integer not null default 0 check (quantite >= 0),
  primary key (user_id, collection_id)
);

create table if not exists public.coffres_ouvertures (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  collection_id text not null references public.collections(id) on delete cascade,
  carte_ids     integer[] not null,
  cree_le       timestamptz not null default now()
);

alter table public.wc_portefeuille    enable row level security;
alter table public.wc_journal         enable row level security;
alter table public.wc_defis_def       enable row level security;
alter table public.wc_defis           enable row level security;
alter table public.collections        enable row level security;
alter table public.cartes             enable row level security;
alter table public.cartes_possedees   enable row level security;
alter table public.coffres_possedes   enable row level security;
alter table public.coffres_ouvertures enable row level security;

drop policy if exists "wc_portefeuille lecture"    on public.wc_portefeuille;
drop policy if exists "wc_journal lecture"         on public.wc_journal;
drop policy if exists "wc_defis_def lecture"       on public.wc_defis_def;
drop policy if exists "wc_defis lecture"           on public.wc_defis;
drop policy if exists "collections lecture"        on public.collections;
drop policy if exists "cartes_possedees lecture"   on public.cartes_possedees;
drop policy if exists "coffres_possedes lecture"   on public.coffres_possedes;
drop policy if exists "coffres_ouvertures lecture" on public.coffres_ouvertures;

create policy "wc_portefeuille lecture"    on public.wc_portefeuille    for select to authenticated using (user_id = auth.uid());
create policy "wc_journal lecture"         on public.wc_journal         for select to authenticated using (user_id = auth.uid());
create policy "wc_defis_def lecture"       on public.wc_defis_def       for select to authenticated using (true);
create policy "wc_defis lecture"           on public.wc_defis           for select to authenticated using (user_id = auth.uid());
create policy "collections lecture"        on public.collections        for select to authenticated using (true);
create policy "cartes_possedees lecture"   on public.cartes_possedees   for select to authenticated using (user_id = auth.uid());
create policy "coffres_possedes lecture"   on public.coffres_possedes   for select to authenticated using (user_id = auth.uid());
create policy "coffres_ouvertures lecture" on public.coffres_ouvertures for select to authenticated using (user_id = auth.uid());
-- `cartes` n'a volontairement aucune lecture directe : on ne découvre une carte (surtout la Secret Wave) qu'en la tirant.

revoke all on public.wc_portefeuille, public.wc_journal, public.wc_defis_def, public.wc_defis, public.collections,
              public.cartes, public.cartes_possedees, public.coffres_possedes, public.coffres_ouvertures
  from anon;
revoke insert, update, delete, truncate on public.wc_portefeuille, public.wc_journal, public.wc_defis_def,
              public.wc_defis, public.collections, public.cartes, public.cartes_possedees,
              public.coffres_possedes, public.coffres_ouvertures
  from authenticated;
revoke all on public.cartes from authenticated;


-- ---------------------------------------------------------------------
-- 5. Les collections
-- ---------------------------------------------------------------------

insert into public.collections (id, nom, theme, description, emoji, couleurs, debut, fin, prix_wc, cartes_par_coffre, ordre) values
  ('halloween', 'Coffre Halloween', 'halloween',
   'Fantômes, démons et cauchemars : des projets et des singles du catalogue qui font frissonner. Disponible jusqu''au 15 novembre.',
   '🎃', '{"a":"#ff7a18","b":"#7a2cff","c":"#12061f"}'::jsonb,
   timestamptz '2026-10-01 00:00:00+02', timestamptz '2026-11-15 23:59:59+01', 150, 5, 1),
  ('top_2026', 'Coffre Top 2026', 'top',
   'Les meilleurs projets de l''année, en cartes dorées.',
   '🏆', '{"a":"#f5c542","b":"#ff8a3d","c":"#1a1405"}'::jsonb,
   timestamptz '2026-12-15 00:00:00+01', timestamptz '2027-01-15 23:59:59+01', 200, 5, 2),
  ('saint_valentin', 'Coffre Saint-Valentin', 'amour',
   'Des sorties qui parlent d''amour, pour la Saint-Valentin.',
   '💘', '{"a":"#ff5c8a","b":"#ff9ec1","c":"#2a0b16"}'::jsonb,
   timestamptz '2027-02-01 00:00:00+01', timestamptz '2027-02-20 23:59:59+01', 150, 5, 3)
on conflict (id) do update
  set nom = excluded.nom, theme = excluded.theme, description = excluded.description, emoji = excluded.emoji,
      couleurs = excluded.couleurs, debut = excluded.debut, fin = excluded.fin, prix_wc = excluded.prix_wc,
      cartes_par_coffre = excluded.cartes_par_coffre, ordre = excluded.ordre;

-- Les 37 cartes d'Halloween : (numéro, artiste, titre, rareté). Retrouvées dans le catalogue par artiste + titre.
insert into public.cartes (collection_id, numero, release_id, titre, artiste, cover_url, type_sortie, rarete)
select 'halloween', v.numero, s.id, s.track_title, s.artist_name, s.cover_url, s.release_type, v.rarete
from (values
  ( 1, 'DJ ASARI',        'MONTAGEM SPOOKY RENICHT',     'commun'),
  ( 2, 'Hugo TSR',        'Gare fantôme',                'commun'),
  ( 3, 'MAROUANE',        'Fantômes',                    'commun'),
  ( 4, 'Davodka',         'Fantômes',                    'commun'),
  ( 5, 'Dalienski',       'vrais fantômes',              'commun'),
  ( 6, 'Sins',            'Daydreams and Nightmares',    'commun'),
  ( 7, 'Tibab',           'Evil Twin',                   'commun'),
  ( 8, 'Mufasa',          'Demon Party',                 'commun'),
  ( 9, 'W0lfy',           'Monstre',                     'commun'),
  (10, 'Bojack',          'I Love Blood',                'commun'),
  (11, 'Babi Tape',       'Sang',                        'commun'),
  (12, 'La Rvfleuze',     'Connexion Macabre',           'commun'),
  (13, 'Zeg P',           'Blood',                       'commun'),
  (14, 'Damn Low',        'Death Pact',                  'commun'),
  (15, 'Trafiquinte',     'Démon',                       'commun'),
  (16, 'Gambino',         'Nightmare On California',     'peu_commun'),
  (17, 'Kalash',          'Cauchemar',                   'peu_commun'),
  (18, 'Assassin',        'HELL',                        'peu_commun'),
  (19, 'NØNAME',          'DEMON',                       'peu_commun'),
  (20, 'Dooz Kawa',       'Les monstres',                'peu_commun'),
  (21, 'Kepler',          'Death Wish',                  'peu_commun'),
  (22, 'Nahir',           'Macabre (Mission #1)',        'peu_commun'),
  (23, 'Chaax',           'DEMON TIME',                  'peu_commun'),
  (24, 'a6el',            'Fantôme',                     'peu_commun'),
  (25, 'Sins',            'Ghost',                       'peu_commun'),
  (26, 'Vald',            'PANDEMONIUM RELOADED',        'rare'),
  (27, 'La Bourse',       'CAUCHEMARS',                  'rare'),
  (28, 'Yanso',           'FANTÔMES',                    'rare'),
  (29, 'Khali',           'PLM DEATHROW',                'rare'),
  (30, 'Mairo',           'Rougemort',                   'rare'),
  (31, 'Gambino',         'Blood of My Blood (E.P)',     'rare'),
  (32, 'Gulien',          'Danse Macabre',               'ultra_rare'),
  (33, 'Al''Tarba',       'Horror 404',                  'ultra_rare'),
  (34, 'Jarod',           'Fantôme',                     'ultra_rare'),
  (35, 'Vald',            'PANDEMONIUM',                 'legendaire'),
  (36, 'Menace Santana',  'Into The Dark',               'legendaire'),
  (37, 'Sins',            'HALLOWEEN',                   'secret_wave')
) as v (numero, artiste, titre, rarete)
join lateral (
  select s2.* from public.submissions s2
   where s2.status = 'approved' and s2.artist_name = v.artiste and s2.track_title = v.titre
   order by s2.release_date desc nulls last limit 1
) s on true
on conflict (collection_id, numero) do update
  set release_id = excluded.release_id, titre = excluded.titre, artiste = excluded.artiste,
      cover_url = excluded.cover_url, type_sortie = excluded.type_sortie, rarete = excluded.rarete;


-- ---------------------------------------------------------------------
-- 6. Acheter et ouvrir
-- ---------------------------------------------------------------------

create or replace function public.rarete_ordre(r text)
returns integer language sql immutable
as $$ select case r when 'commun' then 1 when 'peu_commun' then 2 when 'rare' then 3 when 'ultra_rare' then 4
                    when 'legendaire' then 5 when 'secret_wave' then 6 else 0 end $$;

create or replace function public.rarete_poids(r text)
returns numeric language sql immutable
as $$ select case r when 'commun' then 60 when 'peu_commun' then 24 when 'rare' then 10 when 'ultra_rare' then 4
                    when 'legendaire' then 1.6 when 'secret_wave' then 0.4 else 0 end $$;

-- Tire une rareté au hasard parmi celles que la collection contient, au moins `p_min` (1 = toutes).
create or replace function public.coffre_tirer_rarete(p_collection text, p_min integer)
returns text language plpgsql security definer set search_path = public
as $$
declare v_total numeric; v_tirage numeric; v_r record; v_cumul numeric := 0;
begin
  select coalesce(sum(public.rarete_poids(x.rarete)), 0) into v_total
    from (select distinct rarete from public.cartes where collection_id = p_collection) x
   where public.rarete_ordre(x.rarete) >= p_min;

  if v_total = 0 then
    select coalesce(sum(public.rarete_poids(x.rarete)), 0) into v_total
      from (select distinct rarete from public.cartes where collection_id = p_collection) x;
    p_min := 1;
  end if;

  v_tirage := random() * v_total;

  for v_r in
    select x.rarete from (select distinct rarete from public.cartes where collection_id = p_collection) x
     where public.rarete_ordre(x.rarete) >= p_min
     order by public.rarete_ordre(x.rarete)
  loop
    v_cumul := v_cumul + public.rarete_poids(v_r.rarete);
    if v_tirage < v_cumul then return v_r.rarete; end if;
  end loop;

  return v_r.rarete;
end $$;

create or replace function public.coffre_acheter(p_collection text, p_quantite integer default 1)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  c public.collections%rowtype;
  v_solde integer; v_cout integer; v_coffres integer;
begin
  if v_uid is null then raise exception 'Connecte-toi pour acheter un coffre.'; end if;

  p_quantite := coalesce(p_quantite, 1);
  if p_quantite < 1 or p_quantite > 10 then raise exception 'Tu peux acheter de 1 à 10 coffres à la fois.'; end if;

  select * into c from public.collections where id = p_collection;
  if not found then raise exception 'Ce coffre n''existe pas.'; end if;

  if now() < c.debut then raise exception 'Ce coffre n''est pas encore en vente.'; end if;
  if now() > c.fin then raise exception 'Ce coffre n''est plus en vente.'; end if;
  if not exists (select 1 from public.cartes where collection_id = c.id) then
    raise exception 'Ce coffre n''est pas encore rempli.';
  end if;

  insert into public.wc_portefeuille (user_id, solde) values (v_uid, 0) on conflict (user_id) do nothing;
  select solde into v_solde from public.wc_portefeuille where user_id = v_uid for update;

  v_cout := c.prix_wc * p_quantite;
  if v_solde < v_cout then
    raise exception 'Il te manque % WC pour ce coffre.', v_cout - v_solde;
  end if;

  update public.wc_portefeuille set solde = solde - v_cout where user_id = v_uid;
  insert into public.wc_journal (user_id, delta, motif, ref) values (v_uid, -v_cout, 'achat:' || c.id, gen_random_uuid()::text);

  insert into public.coffres_possedes as cp (user_id, collection_id, quantite) values (v_uid, c.id, p_quantite)
  on conflict (user_id, collection_id) do update set quantite = cp.quantite + p_quantite
  returning cp.quantite into v_coffres;

  return jsonb_build_object('solde', v_solde - v_cout, 'coffres', v_coffres);
end $$;

create or replace function public.coffre_ouvrir(p_collection text)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  c public.collections%rowtype;
  v_restant integer; v_rarete text; v_carte public.cartes%rowtype; v_qte integer; v_nouvelle boolean;
  v_ids integer[] := '{}'; v_sortie jsonb := '[]'::jsonb; v_min integer; v_haut boolean := false; i integer;
begin
  if v_uid is null then raise exception 'Connecte-toi pour ouvrir un coffre.'; end if;

  select * into c from public.collections where id = p_collection;
  if not found then raise exception 'Ce coffre n''existe pas.'; end if;

  update public.coffres_possedes set quantite = quantite - 1
   where user_id = v_uid and collection_id = c.id and quantite > 0
  returning quantite into v_restant;

  if v_restant is null then raise exception 'Tu n''as aucun coffre à ouvrir.'; end if;

  for i in 1..c.cartes_par_coffre loop

    -- La dernière carte est au moins « peu commune » si aucune des précédentes ne l'était.
    v_min := case when i = c.cartes_par_coffre and not v_haut then 2 else 1 end;
    v_rarete := public.coffre_tirer_rarete(c.id, v_min);

    select * into v_carte from public.cartes where collection_id = c.id and rarete = v_rarete order by random() limit 1;

    if public.rarete_ordre(v_carte.rarete) >= 2 then v_haut := true; end if;

    insert into public.cartes_possedees as cp (user_id, carte_id, quantite) values (v_uid, v_carte.id, 1)
    on conflict (user_id, carte_id) do update set quantite = cp.quantite + 1
    returning cp.quantite into v_qte;

    v_nouvelle := v_qte = 1;
    v_ids := v_ids || v_carte.id;

    v_sortie := v_sortie || jsonb_build_object(
      'id', v_carte.id, 'numero', v_carte.numero, 'titre', v_carte.titre, 'artiste', v_carte.artiste,
      'cover_url', v_carte.cover_url, 'type_sortie', v_carte.type_sortie, 'rarete', v_carte.rarete,
      'nouvelle', v_nouvelle, 'quantite', v_qte);
  end loop;

  insert into public.coffres_ouvertures (user_id, collection_id, carte_ids) values (v_uid, c.id, v_ids);

  return jsonb_build_object('collection', c.id, 'cartes', v_sortie, 'restants', v_restant);
end $$;


-- ---------------------------------------------------------------------
-- 7. Ce que le site lit
-- ---------------------------------------------------------------------

-- La boutique : solde, collections (en vente, à venir, terminées), coffres en stock, défis spéciaux de la semaine.
create or replace function public.boutique_liste()
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_deb date := date_trunc('week', public.xp_jour())::date;
  v_solde integer; v_cols jsonb; v_defis jsonb;
begin
  if v_uid is null then return null; end if;

  perform public.wc_defis_assurer(v_uid);

  select coalesce(solde, 0) into v_solde from public.wc_portefeuille where user_id = v_uid;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id, 'nom', c.nom, 'theme', c.theme, 'description', c.description, 'emoji', c.emoji,
           'couleurs', c.couleurs, 'prix_wc', c.prix_wc, 'debut', c.debut, 'fin', c.fin,
           'cartes_par_coffre', c.cartes_par_coffre,
           'statut', case when now() < c.debut then 'a_venir' when now() > c.fin then 'termine' else 'en_cours' end,
           'nb_cartes', (select count(*) from public.cartes k where k.collection_id = c.id),
           'possedees', (select count(*) from public.cartes_possedees p join public.cartes k on k.id = p.carte_id
                          where p.user_id = v_uid and k.collection_id = c.id),
           'coffres', coalesce((select cp.quantite from public.coffres_possedes cp
                                 where cp.user_id = v_uid and cp.collection_id = c.id), 0))
         order by c.ordre), '[]'::jsonb)
    into v_cols from public.collections c;

  select coalesce(jsonb_agg(jsonb_build_object(
           'libelle', d.libelle, 'icone', d.icone, 'progres', d.progres, 'objectif', d.objectif, 'wc', d.wc,
           'faite', d.faite_le is not null) order by d.slot), '[]'::jsonb)
    into v_defis from public.wc_defis d
   where d.user_id = v_uid and d.semaine = to_char(public.xp_jour(), 'IYYY-IW');

  return jsonb_build_object('wc', coalesce(v_solde, 0), 'collections', v_cols, 'defis', v_defis,
                            'jours_restants', (v_deb + 6) - public.xp_jour());
end $$;

-- Le classeur d'une collection : toutes les cartes dans l'ordre ; celles que l'on n'a pas restent cachées.
create or replace function public.classeur_collection(p_collection text)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  c public.collections%rowtype;
  v_cartes jsonb; v_poss integer;
begin
  if v_uid is null then return null; end if;

  select * into c from public.collections where id = p_collection;
  if not found then return null; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', k.id, 'numero', k.numero, 'possedee', p.user_id is not null, 'quantite', coalesce(p.quantite, 0),
           'rarete', case when p.user_id is null and k.rarete = 'secret_wave' then null else k.rarete end,
           'titre', case when p.user_id is null then null else k.titre end,
           'artiste', case when p.user_id is null then null else k.artiste end,
           'cover_url', case when p.user_id is null then null else k.cover_url end,
           'type_sortie', case when p.user_id is null then null else k.type_sortie end)
         order by k.numero), '[]'::jsonb)
    into v_cartes
    from public.cartes k
    left join public.cartes_possedees p on p.carte_id = k.id and p.user_id = v_uid
   where k.collection_id = c.id;

  select count(*) into v_poss from public.cartes_possedees p join public.cartes k on k.id = p.carte_id
   where p.user_id = v_uid and k.collection_id = c.id;

  return jsonb_build_object(
    'id', c.id, 'nom', c.nom, 'theme', c.theme, 'emoji', c.emoji, 'couleurs', c.couleurs,
    'possedees', v_poss, 'total', jsonb_array_length(v_cartes), 'cartes', v_cartes);
end $$;

revoke all on function public.wc_crediter(uuid, integer, text, text)       from public, anon, authenticated;
revoke all on function public.wc_defis_assurer(uuid)                       from public, anon, authenticated;
revoke all on function public.wc_defis_avancer(uuid, text)                 from public, anon, authenticated;
revoke all on function public.coffre_tirer_rarete(text, integer)           from public, anon, authenticated;
revoke all on function public.xp_brut(uuid, text, text, integer)           from public, anon, authenticated;
revoke all on function public.xp_crediter(uuid, text, text)                from public, anon, authenticated;

-- Le solde de WC du membre connecté (le panneau d'XP l'affiche).
create or replace function public.wc_solde()
returns integer language sql stable security definer set search_path = public
as $$ select coalesce((select solde from public.wc_portefeuille where user_id = auth.uid()), 0) $$;

revoke all on function public.wc_solde()                     from public, anon;
grant execute on function public.wc_solde()                  to authenticated;

revoke all on function public.coffre_acheter(text, integer)  from public, anon;
revoke all on function public.coffre_ouvrir(text)            from public, anon;
revoke all on function public.boutique_liste()               from public, anon;
revoke all on function public.classeur_collection(text)      from public, anon;
grant execute on function public.coffre_acheter(text, integer) to authenticated;
grant execute on function public.coffre_ouvrir(text)           to authenticated;
grant execute on function public.boutique_liste()              to authenticated;
grant execute on function public.classeur_collection(text)     to authenticated;


-- ---------------------------------------------------------------------
-- 8. Cadeau de lancement : 300 WC aux comptes existants, pour essayer (une seule fois)
-- ---------------------------------------------------------------------

select public.wc_crediter(id, 300, 'lancement', '1') from public.profiles;
