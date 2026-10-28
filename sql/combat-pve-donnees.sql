-- Wave Cards : les modes de combat contre le jeu — les données (2026-10-28).
-- Trois modes qui s'appuient sur le moteur v2 (sql/combat-v2-*.sql) :
--   · la TOUR (pve_tour)        : des étages à gravir en 4 difficultés, un gardien tous les 10 étages ;
--   · les CHAMPIONS (pve_champion) : un champion par style de carte + un champion du jour ;
--   · la LIGUE (pve_ligue)      : le Conseil des 4 puis le Maître, enchaînés, une tentative par jour.
-- Les fonctions de jeu sont dans sql/combat-pve-jeu.sql. Tout se règle depuis la console de l'équipe (onglet « Contre le jeu »).
-- Toutes les tables ont la RLS sans politique : seules les fonctions SECURITY DEFINER y touchent.

-- 1. Les réglages numériques (récompenses, plafonds, bonus du champion du jour, vies de la Ligue).
create table if not exists public.combat_pve_reglages (
  cle text primary key,
  valeur integer not null check (valeur between 0 and 5000),
  libelle text not null,
  ordre integer not null default 0
);
insert into public.combat_pve_reglages (cle, valeur, libelle, ordre) values
  ('champion_revanche_wc',     10, 'Revanche d''un champion : Wave Coins',                 1),
  ('champion_revanche_max',     3, 'Revanches récompensées par jour (tous champions)',    2),
  ('champion_jour_vinyles',     1, 'Champion du jour : vinyles (une fois par jour)',      3),
  ('champion_jour_wc',         15, 'Champion du jour : Wave Coins (une fois par jour)',   4),
  ('champion_jour_bonus',      20, 'Champion du jour : bonus de stats (%)',               5),
  ('champion_jour_rarete',      4, 'Champion du jour : rareté des cartes (1 à 5)',        6),
  ('ligue_vies',                3, 'Ligue : défaites permises par tentative',             7),
  ('ligue_vinyles',             1, 'Ligue : vinyles à chaque victoire complète',          8),
  ('ligue_wc',                 40, 'Ligue : Wave Coins à chaque victoire complète',       9),
  ('ligue_parfait_vinyles',     1, 'Ligue sans défaite : vinyles en plus',               10),
  ('ligue_parfait_wc',         40, 'Ligue sans défaite : Wave Coins en plus',            11),
  ('ligue_premiere_vinyles',    3, 'Première victoire complète : vinyles en plus',       12),
  ('ligue_premiere_wc',       100, 'Première victoire complète : Wave Coins en plus',    13)
on conflict (cle) do nothing;

-- 2. La Tour : les difficultés. Les adversaires d'un étage sont tirés dans le classement des artistes par fans (les moins connus
-- en bas de la Tour, les plus connus en haut), avec un bonus de stats = bonus_base + bonus_etage × étage (+ bonus_gardien pour un gardien).
-- Une difficulté se débloque en atteignant deblocage_etage dans la précédente (ordre croissant).
create table if not exists public.combat_tour_difficultes (
  id text primary key check (id ~ '^[a-z][a-z0-9_]{1,19}$'),
  nom text not null,
  resume text not null default '',
  ordre integer not null,
  etages integer not null default 100 check (etages between 10 and 1000),
  bonus_base integer not null default 0 check (bonus_base between -50 and 300),
  bonus_etage numeric(5,2) not null default 0.5 check (bonus_etage between 0 and 10),
  bonus_gardien integer not null default 10 check (bonus_gardien between 0 and 100),
  rarete_plus integer not null default 0 check (rarete_plus between 0 and 3),
  mult_wc numeric(4,2) not null default 1 check (mult_wc between 0 and 10),
  mult_vinyles numeric(4,2) not null default 1 check (mult_vinyles between 0 and 10),
  deblocage_etage integer not null default 0 check (deblocage_etage between 0 and 1000),
  actif boolean not null default true
);
insert into public.combat_tour_difficultes (id, nom, resume, ordre, etages, bonus_base, bonus_etage, bonus_gardien, rarete_plus, mult_wc, mult_vinyles, deblocage_etage) values
  ('classique', 'Classique', 'Pour grimper à son rythme : des adversaires à ta portée, puis de plus en plus connus.', 1, 100, -15, 0.70, 10, 0, 1.00, 1.00, 0),
  ('difficile', 'Difficile', 'Des adversaires plus solides dès le premier étage. Débloqué à l''étage 20 du mode Classique.', 2, 100, 10, 1.00, 15, 0, 1.50, 1.50, 20),
  ('hell',      'HELL',      'Chaque étage est un mur. Débloqué à l''étage 30 du mode Difficile.',                                 3, 100, 35, 1.40, 20, 1, 2.00, 2.00, 30),
  ('abysse',    'Abysse',    'Pour les collections complètes et les équipes parfaites. Débloqué à l''étage 40 du mode HELL.',      4, 100, 60, 1.80, 30, 2, 3.00, 3.00, 40)
on conflict (id) do nothing;

-- Où en est chaque joueur dans chaque difficulté (reprise à l'étage atteint + 1).
create table if not exists public.combat_tour_progres (
  user_id uuid not null references public.profiles(id) on delete cascade,
  difficulte text not null references public.combat_tour_difficultes(id) on delete cascade on update cascade,
  etage_max integer not null default 0 check (etage_max >= 0),
  victoires integer not null default 0,
  defaites integer not null default 0,
  maj timestamptz not null default now(),
  primary key (user_id, difficulte)
);

-- 3. Les champions de style : un duo fixe, une récompense unique à la première victoire, une revanche quotidienne réduite.
create table if not exists public.combat_champions (
  id text primary key check (id ~ '^[a-z][a-z0-9_]{1,19}$' and id <> 'jour'),
  type text not null references public.combat_types(id) on delete cascade on update cascade,
  nom text not null,
  description text not null default '',
  artist1 uuid not null references public.jeu_cartes(artist_id) on delete cascade,
  rarete1 integer not null check (rarete1 between 1 and 5),
  artist2 uuid not null references public.jeu_cartes(artist_id) on delete cascade,
  rarete2 integer not null check (rarete2 between 1 and 5),
  bonus integer not null default 15 check (bonus between 0 and 300),
  vinyles integer not null default 2 check (vinyles between 0 and 50),
  wc integer not null default 50 check (wc between 0 and 5000),
  decor text not null default 'studio' check (decor in ('studio', 'concert', 'plateau', 'ruelle', 'toit')),
  ordre integer not null default 0,
  actif boolean not null default true
);
create table if not exists public.combat_champions_progres (
  user_id uuid not null references public.profiles(id) on delete cascade,
  champion text not null references public.combat_champions(id) on delete cascade on update cascade,
  premiere_le timestamptz not null default now(),
  victoires integer not null default 1,
  revanche_jour date,
  primary key (user_id, champion)
);
-- Le compteur du jour : revanches récompensées, champion du jour déjà battu.
create table if not exists public.combat_pve_jour (
  user_id uuid not null references public.profiles(id) on delete cascade,
  jour date not null,
  revanches integer not null default 0,
  champion_jour boolean not null default false,
  primary key (user_id, jour)
);

-- 4. La Ligue : le Conseil des 4 (rang 1 à 4) puis le Maître (rang 5).
create table if not exists public.combat_ligue (
  rang integer primary key check (rang between 1 and 9),
  nom text not null,
  description text not null default '',
  artist1 uuid not null references public.jeu_cartes(artist_id) on delete cascade,
  rarete1 integer not null check (rarete1 between 1 and 5),
  artist2 uuid not null references public.jeu_cartes(artist_id) on delete cascade,
  rarete2 integer not null check (rarete2 between 1 and 5),
  bonus integer not null default 20 check (bonus between 0 and 300),
  decor text not null default 'studio' check (decor in ('studio', 'concert', 'plateau', 'ruelle', 'toit'))
);
-- Une tentative par jour : où j'en suis, combien de défaites, comment ça s'est terminé.
create table if not exists public.combat_ligue_essais (
  user_id uuid not null references public.profiles(id) on delete cascade,
  jour date not null,
  etape integer not null default 0,
  defaites integer not null default 0,
  vies integer not null default 3,
  etat text not null default 'en_cours' check (etat in ('en_cours', 'gagnee', 'perdue')),
  parfait boolean not null default false,
  maj timestamptz not null default now(),
  primary key (user_id, jour)
);

alter table public.combat_pve_reglages enable row level security;
alter table public.combat_tour_difficultes enable row level security;
alter table public.combat_tour_progres enable row level security;
alter table public.combat_champions enable row level security;
alter table public.combat_champions_progres enable row level security;
alter table public.combat_pve_jour enable row level security;
alter table public.combat_ligue enable row level security;
alter table public.combat_ligue_essais enable row level security;

-- 5. Les modes au registre du hub (voir l'en-tête de sql/combat-v2-jeu.sql). Les fonctions de fin sont dans combat-pve-jeu.sql.
insert into public.combat_modes (id, nom, fonction_fin) values
  ('pve_tour', 'Tour', 'combat_fin_pve_tour'),
  ('pve_champion', 'Champions', 'combat_fin_pve_champion'),
  ('pve_ligue', 'Ligue', 'combat_fin_pve_ligue')
on conflict (id) do nothing;

-- 6. Les 8 champions : les 2 artistes les plus connus de chaque style (rareté 4, stats +15 %).
insert into public.combat_champions (id, type, nom, description, artist1, rarete1, artist2, rarete2, bonus, vinyles, wc, decor, ordre)
select t.id, t.id, 'Champion ' || t.nom, 'Le champion du style ' || t.nom || ' : ' || t.citation, s.a1, 4, s.a2, 4, 15, 2, 50,
       (array['ruelle', 'studio', 'plateau', 'concert', 'plateau', 'studio', 'ruelle', 'toit'])[t.ordre], t.ordre
  from public.combat_types t
  join lateral (
    select (array_agg(x.artist_id order by x.fans desc, x.artist_id))[1] a1, (array_agg(x.artist_id order by x.fans desc, x.artist_id))[2] a2
      from public.jeu_cartes x where x.active and public.combat_type_de(x.artist_id) = t.id) s on s.a2 is not null
on conflict (id) do nothing;

-- 7. La Ligue : quatre sièges (un style chacun : les 3e et 4e artistes les plus connus du style) puis le Maître (3e et 4e de tous).
insert into public.combat_ligue (rang, nom, description, artist1, rarete1, artist2, rarete2, bonus, decor)
select v.rang, v.nom, v.description, s.a3, v.rar, s.a4, v.rar, v.bonus, v.decor
  from (values
    (1, 'Premier siège du Conseil',    'Le Conseil ouvre ses portes avec le style Drill.',     'drill',     4, 15, 'ruelle'),
    (2, 'Deuxième siège du Conseil',   'Un flow qui fait trembler les murs : le style Trap.',  'trap',      4, 25, 'studio'),
    (3, 'Troisième siège du Conseil',  'Des refrains que tout le monde connaît : le Pop Rap.', 'pop',       5, 35, 'plateau'),
    (4, 'Quatrième siège du Conseil',  'Chaque mot compte : le style Conscient.',              'conscient', 5, 45, 'concert')
  ) as v (rang, nom, description, type, rar, bonus, decor)
  join lateral (
    select (array_agg(x.artist_id order by x.fans desc, x.artist_id))[3] a3, (array_agg(x.artist_id order by x.fans desc, x.artist_id))[4] a4
      from public.jeu_cartes x where x.active and public.combat_type_de(x.artist_id) = v.type) s on s.a4 is not null
on conflict (rang) do nothing;
insert into public.combat_ligue (rang, nom, description, artist1, rarete1, artist2, rarete2, bonus, decor)
select 5, 'Le Maître de la Ligue', 'Le dernier combat : bats le Maître et la Ligue est à toi.', s.a3, 5, s.a4, 5, 60, 'toit'
  from (select (array_agg(x.artist_id order by x.fans desc, x.artist_id))[3] a3, (array_agg(x.artist_id order by x.fans desc, x.artist_id))[4] a4
          from public.jeu_cartes x where x.active) s
 where s.a4 is not null
on conflict (rang) do nothing;
