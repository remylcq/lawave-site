-- Wave Cards : les modes de quête du combat — les données (2026-10-28).
-- Deux modes qui s'appuient sur le moteur v2 (sql/combat-v2-*.sql), calqués sur les onglets « Faille » et « Trésor » de BallDex :
--   · la FAILLE (faille) : un boss légendaire par jour de la semaine, aux PV démesurés, qu'on ne peut pas abattre. Un seul combat par essai,
--     3 essais par jour (des essais supplémentaires s'achètent en Wave Coins) ; la NOTE (C → Ω) dépend des dégâts infligés au boss et
--     donne le butin, à chaque essai. Un essai acheté rapporte la moitié des Wave Coins et ni vinyles ni pack garanti.
--   · le TRÉSOR (tresor) : chaque jour, 10 paliers de gardiens de plus en plus durs, calés sur la rareté de ton duo ; chaque palier vaincu
--     rapporte sa récompense (Wave Coins, puis vinyles et pack garanti sur les derniers paliers). Autant d'essais que tu veux, avec un
--     plafond de combats par heure. Le trésor se remplit de nouveau à minuit (heure de Paris).
-- Les fonctions de jeu sont dans sql/combat-quete-jeu.sql. Tout se règle depuis la console de l'équipe (onglet « Faille & Trésor »).
-- Toutes les tables ont la RLS sans politique : seules les fonctions SECURITY DEFINER y touchent.

-- 1. Les réglages numériques.
create table if not exists public.combat_quete_reglages (
  cle text primary key,
  valeur integer not null check (valeur between 0 and 5000),
  libelle text not null,
  ordre integer not null default 0
);
insert into public.combat_quete_reglages (cle, valeur, libelle, ordre) values
  ('faille_essais',        3, 'Faille : essais gratuits par jour',                         1),
  ('faille_achat_max',     3, 'Faille : essais achetables par jour',                       2),
  ('faille_achat_prix',   25, 'Faille : prix d''un essai acheté (Wave Coins)',             3),
  ('faille_achat_pct',    50, 'Faille : part des Wave Coins rapportée par un essai acheté (%)', 4),
  ('tresor_combats_heure', 60, 'Trésor : combats au plus par heure',                       5)
on conflict (cle) do nothing;

-- 2. La Faille : le boss de chaque jour de la semaine (1 = lundi … 7 = dimanche). Les PV de chaque boss sont multipliés par pv_mult
-- (bonus : ses autres stats, en % ; rarete : la rareté de ses cartes). Un boss abattu donnerait la note maximale.
create table if not exists public.combat_faille_boss (
  jour integer primary key check (jour between 1 and 7),
  nom text not null,
  description text not null default '',
  artist1 uuid not null references public.jeu_cartes(artist_id) on delete cascade,
  artist2 uuid not null references public.jeu_cartes(artist_id) on delete cascade,
  rarete integer not null default 5 check (rarete between 1 and 5),
  holo boolean not null default true,
  bonus integer not null default -50 check (bonus between -80 and 300),
  pv_mult integer not null default 40 check (pv_mult between 1 and 500),
  decor text not null default 'toit' check (decor in ('studio', 'concert', 'plateau', 'ruelle', 'toit'))
);

-- Les notes, de la plus basse (seuil 0) à la plus haute : on obtient la meilleure note dont le seuil de dégâts est atteint.
create table if not exists public.combat_faille_notes (
  note text primary key check (char_length(note) between 1 and 6),
  ordre integer not null unique,
  seuil integer not null check (seuil >= 0),
  wc integer not null default 0 check (wc between 0 and 5000),
  vinyles integer not null default 0 check (vinyles between 0 and 100),
  garantis integer not null default 0 check (garantis between 0 and 10)
);
insert into public.combat_faille_notes (note, ordre, seuil, wc, vinyles, garantis) values
  ('C',     1,    0,  2, 0, 0),
  ('B',     2,  100,  4, 0, 0),
  ('A',     3,  250,  7, 0, 0),
  ('S',     4,  500, 11, 0, 0),
  ('SS',    5,  800, 16, 0, 0),
  ('SSS',   6, 1200, 22, 1, 0),
  ('SSS+',  7, 1800, 30, 2, 0),
  ('SSS++', 8, 2600, 40, 3, 1),
  ('Ω',     9, 3800, 60, 5, 1)
on conflict (note) do nothing;

-- Les essais du jour de chaque joueur (et son meilleur coup du jour).
create table if not exists public.combat_faille_essais (
  user_id uuid not null references public.profiles(id) on delete cascade,
  jour date not null,
  utilises integer not null default 0,
  achetes integer not null default 0,
  meilleur_deg integer not null default 0,
  meilleure_note text,
  maj timestamptz not null default now(),
  primary key (user_id, jour)
);

-- 3. Le Trésor : les 10 paliers (mult_pct : la force des gardiens par rapport à une carte normale de ta rareté, en % ; 84 = 16 % plus faibles).
create table if not exists public.combat_tresor_paliers (
  palier integer primary key check (palier between 1 and 20),
  mult_pct integer not null check (mult_pct between 20 and 600),
  wc integer not null default 0 check (wc between 0 and 5000),
  vinyles integer not null default 0 check (vinyles between 0 and 100),
  garantis integer not null default 0 check (garantis between 0 and 10)
);
insert into public.combat_tresor_paliers (palier, mult_pct, wc, vinyles, garantis) values
  (1,   84,  2, 0, 0),
  (2,   92,  4, 0, 0),
  (3,  100,  6, 0, 0),
  (4,  108,  8, 0, 0),
  (5,  116, 10, 1, 0),
  (6,  124, 12, 0, 0),
  (7,  132, 14, 0, 0),
  (8,  140, 16, 2, 0),
  (9,  150, 18, 0, 0),
  (10, 160, 20, 3, 1)
on conflict (palier) do nothing;

-- Où en est chaque joueur aujourd'hui : le dernier palier vaincu.
create table if not exists public.combat_tresor_jour (
  user_id uuid not null references public.profiles(id) on delete cascade,
  jour date not null,
  palier integer not null default 0 check (palier >= 0),
  maj timestamptz not null default now(),
  primary key (user_id, jour)
);

alter table public.combat_quete_reglages enable row level security;
alter table public.combat_faille_boss enable row level security;
alter table public.combat_faille_notes enable row level security;
alter table public.combat_faille_essais enable row level security;
alter table public.combat_tresor_paliers enable row level security;
alter table public.combat_tresor_jour enable row level security;

-- 4. Les modes au registre du hub (voir l'en-tête de sql/combat-v2-jeu.sql). Les fonctions de fin sont dans combat-quete-jeu.sql.
insert into public.combat_modes (id, nom, fonction_fin) values
  ('faille', 'Faille', 'combat_fin_faille'),
  ('tresor', 'Trésor', 'combat_fin_tresor')
on conflict (id) do nothing;

-- 5. Les 7 boss de la Faille : un style par jour de la semaine, les 2 artistes les plus connus du style (holo, rareté 5).
insert into public.combat_faille_boss (jour, nom, description, artist1, artist2, rarete, holo, bonus, pv_mult, decor)
select t.ordre, 'Faille du ' || (array['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'])[t.ordre],
       'Une brèche s''ouvre sur le style ' || t.nom || ' : deux légendes que personne n''a jamais abattues. Frappe le plus fort possible.',
       s.a1, s.a2, 5, true, -50, 40,
       (array['ruelle', 'studio', 'plateau', 'concert', 'toit', 'concert', 'toit'])[t.ordre]
  from public.combat_types t
  join lateral (
    select (array_agg(x.artist_id order by x.fans desc nulls last, x.artist_id))[1] a1, (array_agg(x.artist_id order by x.fans desc nulls last, x.artist_id))[2] a2
      from public.jeu_cartes x where x.active and public.combat_type_de(x.artist_id) = t.id) s on s.a2 is not null
 where t.ordre between 1 and 7
on conflict (jour) do nothing;
