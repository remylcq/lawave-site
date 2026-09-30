-- =====================================================================
-- La Wave — l'espace des waveurs
--
-- La machine à sous de la salle rapporte de l'XP et des pièces, jamais
-- d'argent : aucun tour n'est vendu, et les pièces ne s'achètent pas avec
-- de l'argent, ni ne se convertissent en argent. Elles se gagnent en jouant
-- et se dépensent chez le croupier, en boosters de cartes La Wave TCG, que
-- l'on ouvre ensuite pour en tirer des cartes à collectionner. Ni les
-- boosters ni les cartes ne s'achètent avec de l'argent, ni ne se revendent :
-- c'est la règle du jeu, et la limite à ne pas franchir.
--
-- Cinq principes tiennent tout le fichier :
--
--   1. le tirage se fait ici, en base. Les rouleaux du navigateur ne
--      font qu'illustrer un résultat déjà décidé : personne ne peut
--      choisir son gain, ni rejouer un tirage qui lui déplaît ;
--   2. le nombre de tours par jour est compté ici aussi. Le navigateur
--      affiche ce compteur, il ne le tient pas ;
--   3. les pièces et les boosters sont dans un portefeuille que personne
--      ne peut écrire depuis le navigateur : les pièces n'y entrent que
--      par un tirage, n'en sortent que par un achat, et un achat ne passe
--      que si le solde suffit ;
--   4. tout ce qui se règle (nombre de tours, prix d'un booster, gains,
--      probabilités, cartes) est dans une table modifiable depuis l'éditeur
--      de tables de Supabase, sans toucher au code ni relancer ce fichier ;
--   5. l'ouverture d'un booster se fait ici aussi : les cartes sont tirées
--      par la base, ajoutées à la collection du membre dans le même geste
--      que le booster est retiré de son stock. Le navigateur ne fait que
--      montrer ce qui est sorti.
--
-- À exécuter dans Supabase → SQL Editor, d'un seul bloc. Sans danger si
-- on le relance : rien n'est écrasé, et une installation déjà en service
-- reçoit les pièces et la boutique sans perdre ses tours ni ses gains.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Les réglages
--
-- Une ligne par réglage. Pour donner 15 tours par jour au lieu de 10 :
-- Table Editor → waveurs_reglages → changer la valeur. Pas de code.
-- ---------------------------------------------------------------------

create table if not exists public.waveurs_reglages (
  cle         text primary key,
  valeur      integer not null,
  description text
);

insert into public.waveurs_reglages (cle, valeur, description) values
  ('tours_par_jour', 10,
   'Nombre de tours offerts à chaque membre, chaque jour. Remise à zéro à minuit, heure de Paris.'),
  ('prix_booster', 60,
   'Prix d''un booster La Wave TCG chez le croupier, en pièces. Les valeurs de départ des gains donnent environ 56 pièces par jour de dix tours.')
on conflict (cle) do nothing;


-- ---------------------------------------------------------------------
-- 2. Les gains
--
-- Chaque ligne est une issue possible d'un tour. Le tirage choisit une
-- ligne au hasard, en proportion de son poids : un poids de 3 000
-- contre un total de 10 000 donne 3 chances sur 10.
--
--   motif   : 'rien'  aucun gain, trois symboles tous différents
--             'paire' deux symboles identiques et un autre
--             'trio'  trois symboles identiques
--   symbole : le symbole concerné (vague, poisson, coquillage, ancre,
--             bulle, perle, logo). Vide, il est tiré au hasard parmi
--             les cinq symboles courants.
--   poids   : probabilité relative
--   xp      : XP gagnée
--   pieces  : pièces gagnées, en plus de l'XP
--   actif   : décocher pour retirer une ligne du jeu sans la supprimer
--
-- Les valeurs de départ donnent environ 2 XP et 5,6 pièces par tour : 20 XP
-- et 56 pièces par jour pour dix tours. L'XP, c'est l'équivalent de quatre
-- défis quotidiens (un niveau se fait à 100 XP ; un jackpot en vaut plus de
-- la moitié). Les pièces, c'est à peu près un booster par jour au prix de
-- départ (60 pièces, réglage prix_booster).
-- ---------------------------------------------------------------------

create table if not exists public.waveurs_gains (
  id      serial primary key,
  nom     text not null,
  motif   text not null check (motif in ('rien', 'paire', 'trio')),
  symbole text check (symbole in ('vague', 'poisson', 'coquillage', 'ancre', 'bulle', 'perle', 'logo')),
  poids   integer not null check (poids >= 0),
  xp      integer not null default 0 check (xp >= 0),
  pieces  integer not null default 0 check (pieces >= 0),
  actif   boolean not null default true,
  check (motif <> 'rien' or symbole is null)
);

-- Une installation d'avant les pièces n'a pas cette colonne : on l'ajoute,
-- et on pose les pièces de départ dans le même geste, une seule fois. Le
-- test porte sur l'existence de la colonne, pas sur les valeurs : mettre
-- toutes les pièces à zéro à la main (pour geler l'économie, par exemple)
-- puis relancer le fichier ne les rétablit pas.
do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'waveurs_gains'
      and column_name  = 'pieces'
  ) then

    alter table public.waveurs_gains
      add column pieces integer not null default 0 check (pieces >= 0);

    update public.waveurs_gains g
       set pieces = v.pieces
      from (values
        ('Pas cette fois',         0),
        ('Une paire',              3),
        ('Trois identiques',      12),
        ('Deux logos La Wave',    20),
        ('Trois perles',          40),
        ('Trois logos — jackpot', 200)
      ) as v(nom, pieces)
     where g.nom = v.nom;

  end if;
end $$;

-- Les lignes de départ ne sont posées qu'une fois : relancer le fichier
-- après avoir réglé les gains à sa main ne les remet pas à zéro.
insert into public.waveurs_gains (nom, motif, symbole, poids, xp, pieces)
select v.nom, v.motif, v.symbole, v.poids, v.xp, v.pieces
from (values
  ('Pas cette fois',       'rien',  null::text, 5500,  0,   0),
  ('Une paire',            'paire', null::text, 3000,  1,   3),
  ('Trois identiques',     'trio',  null::text, 1000,  5,  12),
  ('Deux logos La Wave',   'paire', 'logo',       50, 10,  20),
  ('Trois perles',         'trio',  'perle',     350, 15,  40),
  ('Trois logos — jackpot','trio',  'logo',      100, 60, 200)
) as v(nom, motif, symbole, poids, xp, pieces)
where not exists (select 1 from public.waveurs_gains);


-- ---------------------------------------------------------------------
-- 3. Le journal des tours
--
-- Une ligne par tour. Il sert à compter les tours du jour, à retrouver
-- ce qui s'est passé si un membre conteste un gain, et à suivre le jeu
-- (voir les requêtes en bas de fichier).
-- ---------------------------------------------------------------------

create table if not exists public.waveurs_tours (
  id        bigserial primary key,
  user_id   uuid not null references auth.users(id) on delete cascade,
  machine   text not null,
  gain_nom  text not null,
  motif     text not null,
  symboles  text[] not null,
  xp        integer not null,
  pieces    integer not null default 0,
  cree_le   timestamptz not null default now()
);

alter table public.waveurs_tours
  add column if not exists pieces integer not null default 0;

create index if not exists waveurs_tours_user_idx
  on public.waveurs_tours (user_id, cree_le desc);


-- ---------------------------------------------------------------------
-- 3 bis. Le portefeuille et le journal des achats
--
-- Une ligne par membre : ses pièces et ses boosters en attente d'être
-- ouverts. Elle n'est jamais écrite depuis le navigateur (voir les règles
-- d'accès plus bas) : waveurs_tourner y verse des pièces, et
-- waveurs_acheter_booster en retire pour ajouter des boosters. Les deux
-- colonnes ne peuvent pas descendre sous zéro, quoi qu'il arrive.
--
-- Le journal des achats garde une trace de chaque passage en caisse.
-- ---------------------------------------------------------------------

create table if not exists public.waveurs_portefeuille (
  user_id  uuid primary key references auth.users(id) on delete cascade,
  pieces   integer not null default 0 check (pieces >= 0),
  boosters integer not null default 0 check (boosters >= 0),
  maj      timestamptz not null default now()
);

create table if not exists public.waveurs_achats (
  id            bigserial primary key,
  user_id       uuid not null references auth.users(id) on delete cascade,
  quantite      integer not null check (quantite > 0),
  prix_unitaire integer not null check (prix_unitaire > 0),
  cree_le       timestamptz not null default now()
);

create index if not exists waveurs_achats_user_idx
  on public.waveurs_achats (user_id, cree_le desc);


-- ---------------------------------------------------------------------
-- 3 ter. Les cartes
--
-- La série « Premières vagues » compte 36 cartes, en quatre raretés :
-- 16 communes, 11 rares, 6 épiques et 3 légendaires. Chaque ligne du
-- catalogue est une carte :
--
--   id        : son numéro dans la série
--   nom       : ce qui est écrit en haut de la carte
--   rarete    : commune, rare, epique ou legendaire
--   categorie : instrument, objet, mer, lieu... (affiché sous l'image)
--   motif     : le dessin, choisi parmi ceux que sait tracer le jeu
--               (guitare, micro, batterie, piano, saxo, violon, platines,
--               synthe, trompette, vinyle, casque, enceinte, cassette,
--               note, vague, coquillage, poisson, ancre, bulle, perle,
--               phare, voilier, bouee, projecteur, scene, flamme,
--               couronne, soleil, eclair, lune, meduse, hippocampe,
--               baleine, mouette, etoile, logo)
--   legende   : la phrase en italique
--   actif     : décocher pour retirer une carte du jeu sans la supprimer
--
-- Les cartes de départ ne sont posées que si leur numéro est libre :
-- relancer le fichier ne remet pas à zéro une carte renommée. Pour en
-- ajouter une, donner la ligne suivante de la table (id 37, 38...).
-- ---------------------------------------------------------------------

create table if not exists public.waveurs_cartes (
  id        integer primary key,
  nom       text not null,
  rarete    text not null check (rarete in ('commune', 'rare', 'epique', 'legendaire')),
  categorie text not null,
  motif     text not null,
  legende   text not null default '',
  actif     boolean not null default true
);

insert into public.waveurs_cartes (id, nom, rarete, categorie, motif, legende) values
  ( 1, 'La Guitare Électrique',       'commune',    'Instrument', 'guitare',    'Trois accords et la salle chavire.'),
  ( 2, 'Le Micro du Soir',            'commune',    'Instrument', 'micro',      'Premier couplet, dernière lumière.'),
  ( 3, 'La Caisse Claire',            'commune',    'Instrument', 'batterie',   'Le tempo de la marée.'),
  ( 4, 'Le Piano du Hall',            'commune',    'Instrument', 'piano',      'Il a vu passer toutes les tempêtes.'),
  ( 5, 'Le Casque Fidèle',            'commune',    'Objet',      'casque',     'Le monde entier, en stéréo.'),
  ( 6, 'L''Enceinte de Quai',         'commune',    'Objet',      'enceinte',   'Elle fait trembler les amarres.'),
  ( 7, 'La Cassette Oubliée',         'commune',    'Objet',      'cassette',   'Face B : les souvenirs.'),
  ( 8, 'La Note Bleue',               'commune',    'Son',        'note',       'Celle qu''on fredonne sans le savoir.'),
  ( 9, 'La Vague du Matin',           'commune',    'Mer',        'vague',      'Elle arrive toujours à l''heure.'),
  (10, 'Le Coquillage Sonore',        'commune',    'Mer',        'coquillage', 'Colle-le à ton oreille.'),
  (11, 'Le Petit Poisson',            'commune',    'Mer',        'poisson',    'Il nage à contre-courant, et ça lui va bien.'),
  (12, 'L''Ancre du Bar',             'commune',    'Mer',        'ancre',      'Quand on arrive, on reste.'),
  (13, 'La Bulle de Basse',           'commune',    'Son',        'bulle',      'Elle monte avec la basse.'),
  (14, 'Le Projecteur',               'commune',    'Scène',      'projecteur', 'Chacun cherche sa lumière.'),
  (15, 'La Mouette Rieuse',           'commune',    'Mer',        'mouette',    'Elle chante faux, avec assurance.'),
  (16, 'La Bouée de Sauvetage',       'commune',    'Mer',        'bouee',      'Pour les mauvais jours d''écoute.'),
  (17, 'Le Saxophone des Marées',     'rare',       'Instrument', 'saxo',       'Il souffle quand la mer monte.'),
  (18, 'Le Violon du Phare',          'rare',       'Instrument', 'violon',     'Une corde pour chaque navire.'),
  (19, 'Les Platines de Minuit',      'rare',       'Instrument', 'platines',   'Le set qui ne finit jamais.'),
  (20, 'Le Synthé Néon',              'rare',       'Instrument', 'synthe',     'Des couleurs qui n''existent pas encore.'),
  (21, 'La Trompette d''Écume',       'rare',       'Instrument', 'trompette',  'Elle réveille les sirènes.'),
  (22, 'Le Vinyle Rayé',              'rare',       'Objet',      'vinyle',     'Le même sillon, mille fois aimé.'),
  (23, 'Le Phare de La Wave',         'rare',       'Lieu',       'phare',      'Il guide les oreilles égarées.'),
  (24, 'Le Voilier Fantôme',          'rare',       'Mer',        'voilier',    'Il ne navigue qu''au son du blues.'),
  (25, 'La Méduse Électrique',        'rare',       'Mer',        'meduse',     'Elle s''illumine aux refrains.'),
  (26, 'La Scène Flottante',          'rare',       'Lieu',       'scene',      'Un concert entre deux vagues.'),
  (27, 'L''Éclair de Basse',          'rare',       'Son',        'eclair',     'Il frappe toujours sur le temps fort.'),
  (28, 'La Perle Noire',              'epique',     'Trésor',     'perle',      'Une seule par océan.'),
  (29, 'L''Hippocampe Doré',          'epique',     'Mer',        'hippocampe', 'Il danse sur trois temps.'),
  (30, 'La Baleine Chanteuse',        'epique',     'Mer',        'baleine',    'Sa voix traverse les océans.'),
  (31, 'La Lune sur le Quai',         'epique',     'Lieu',       'lune',       'La nuit est à nous.'),
  (32, 'La Flamme du Festival',       'epique',     'Lieu',       'flamme',     'Elle ne s''éteint qu''au petit matin.'),
  (33, 'Le Soleil sur la Mer',        'epique',     'Lieu',       'soleil',     'Dernier morceau, premières lueurs.'),
  (34, 'La Couronne des Waveurs',     'legendaire', 'Légende',    'couronne',   'Elle va à qui écoute vraiment.'),
  (35, 'Le Vinyle d''Or',             'legendaire', 'Légende',    'vinyle',     'Tout le monde en rêve, peu l''entendent.'),
  (36, 'La Wave',                     'legendaire', 'Légende',    'logo',       'Le son qui les réunit tous.')
on conflict (id) do nothing;


-- Le tirage d'un booster : un emplacement par carte. Avec les valeurs de
-- départ, un booster contient cinq cartes : trois communes en général, un
-- quatrième emplacement un peu plus généreux, et un dernier qui donne au
-- moins une rare. Le tirage choisit une rareté en proportion du poids, puis
-- une carte de cette rareté au hasard.
--
--   emplacement : 1, 2, 3... (autant de lignes distinctes, autant de cartes)
--   rarete      : commune, rare, epique ou legendaire
--   poids       : probabilité relative, dans cet emplacement
--
-- Pour un booster de six cartes, ajouter des lignes avec l'emplacement 6.
-- Un poids à zéro retire une rareté d'un emplacement.

create table if not exists public.waveurs_tirage (
  emplacement integer not null check (emplacement >= 1),
  rarete      text    not null check (rarete in ('commune', 'rare', 'epique', 'legendaire')),
  poids       integer not null check (poids >= 0),
  primary key (emplacement, rarete)
);

insert into public.waveurs_tirage (emplacement, rarete, poids)
select v.emplacement, v.rarete, v.poids
from (values
  (1, 'commune', 7800), (1, 'rare', 1800), (1, 'epique', 350), (1, 'legendaire',  50),
  (2, 'commune', 7800), (2, 'rare', 1800), (2, 'epique', 350), (2, 'legendaire',  50),
  (3, 'commune', 7800), (3, 'rare', 1800), (3, 'epique', 350), (3, 'legendaire',  50),
  (4, 'commune', 5500), (4, 'rare', 3500), (4, 'epique', 900), (4, 'legendaire', 100),
  (5, 'commune',    0), (5, 'rare', 7000), (5, 'epique', 2400), (5, 'legendaire', 600)
) as v(emplacement, rarete, poids)
where not exists (select 1 from public.waveurs_tirage);


-- La collection de chaque membre : une ligne par carte possédée, avec le
-- nombre d'exemplaires. Elle n'est jamais écrite depuis le navigateur :
-- seule waveurs_ouvrir_booster y ajoute des cartes.
--
-- Le journal des ouvertures garde, pour chaque booster ouvert, les numéros
-- des cartes sorties.

create table if not exists public.waveurs_collection (
  user_id     uuid    not null references auth.users(id) on delete cascade,
  carte_id    integer not null references public.waveurs_cartes(id) on delete cascade,
  quantite    integer not null default 1 check (quantite >= 1),
  premiere_le timestamptz not null default now(),
  derniere_le timestamptz not null default now(),
  primary key (user_id, carte_id)
);

create table if not exists public.waveurs_ouvertures (
  id      bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  cartes  integer[] not null,
  cree_le timestamptz not null default now()
);

create index if not exists waveurs_ouvertures_user_idx
  on public.waveurs_ouvertures (user_id, cree_le desc);


-- ---------------------------------------------------------------------
-- 4. Règles d'accès
--
-- Les gains sont publics : la salle affiche la table des combinaisons,
-- et cacher ce que rapporte une machine n'aurait aucun sens. Le journal,
-- le portefeuille et les achats, eux, ne sont lisibles que par leur
-- propriétaire et par l'équipe. Personne n'écrit dans ces tables depuis le
-- navigateur, pas même l'équipe pour le portefeuille : seules les
-- fonctions ci-dessous le font.
-- ---------------------------------------------------------------------

alter table public.waveurs_reglages    enable row level security;
alter table public.waveurs_gains       enable row level security;
alter table public.waveurs_tours       enable row level security;
alter table public.waveurs_portefeuille enable row level security;
alter table public.waveurs_achats      enable row level security;
alter table public.waveurs_cartes      enable row level security;
alter table public.waveurs_tirage      enable row level security;
alter table public.waveurs_collection  enable row level security;
alter table public.waveurs_ouvertures  enable row level security;

drop policy if exists "cartes lisibles"            on public.waveurs_cartes;
drop policy if exists "cartes ecrites par equipe"  on public.waveurs_cartes;
drop policy if exists "tirage lisible"             on public.waveurs_tirage;
drop policy if exists "tirage ecrit par equipe"    on public.waveurs_tirage;
drop policy if exists "collection visible"         on public.waveurs_collection;
drop policy if exists "ouvertures visibles"        on public.waveurs_ouvertures;
drop policy if exists "reglages lisibles"          on public.waveurs_reglages;
drop policy if exists "reglages ecrits par equipe" on public.waveurs_reglages;
drop policy if exists "gains lisibles"             on public.waveurs_gains;
drop policy if exists "gains ecrits par equipe"    on public.waveurs_gains;
drop policy if exists "tours visibles"             on public.waveurs_tours;
drop policy if exists "portefeuille visible"       on public.waveurs_portefeuille;
drop policy if exists "achats visibles"            on public.waveurs_achats;

create policy "reglages lisibles"
on public.waveurs_reglages for select
to anon, authenticated
using (true);

create policy "reglages ecrits par equipe"
on public.waveurs_reglages for all
to authenticated
using (public.est_equipe())
with check (public.est_equipe());

create policy "gains lisibles"
on public.waveurs_gains for select
to anon, authenticated
using (actif);

create policy "gains ecrits par equipe"
on public.waveurs_gains for all
to authenticated
using (public.est_equipe())
with check (public.est_equipe());

create policy "tours visibles"
on public.waveurs_tours for select
to authenticated
using (user_id = auth.uid() or public.est_equipe());

create policy "portefeuille visible"
on public.waveurs_portefeuille for select
to authenticated
using (user_id = auth.uid() or public.est_equipe());

create policy "achats visibles"
on public.waveurs_achats for select
to authenticated
using (user_id = auth.uid() or public.est_equipe());

-- Le catalogue est public, comme la table des gains : les cartes se
-- montrent, seules celles qu'on possède sont à soi. Les probabilités de
-- tirage sont lisibles elles aussi : un jeu de cartes honnête annonce ses
-- chances.
create policy "cartes lisibles"
on public.waveurs_cartes for select
to anon, authenticated
using (actif);

create policy "cartes ecrites par equipe"
on public.waveurs_cartes for all
to authenticated
using (public.est_equipe())
with check (public.est_equipe());

create policy "tirage lisible"
on public.waveurs_tirage for select
to anon, authenticated
using (true);

create policy "tirage ecrit par equipe"
on public.waveurs_tirage for all
to authenticated
using (public.est_equipe())
with check (public.est_equipe());

create policy "collection visible"
on public.waveurs_collection for select
to authenticated
using (user_id = auth.uid() or public.est_equipe());

create policy "ouvertures visibles"
on public.waveurs_ouvertures for select
to authenticated
using (user_id = auth.uid() or public.est_equipe());

-- Aucune règle d'écriture n'existe pour ces deux tables : sans elle, RLS
-- refuse tout. On retire en plus les droits d'écriture eux-mêmes, que
-- Supabase accorde par défaut : une règle ajoutée par erreur plus tard ne
-- suffirait pas à ouvrir le portefeuille.
revoke insert, update, delete, truncate on public.waveurs_portefeuille from anon, authenticated;
revoke insert, update, delete, truncate on public.waveurs_achats       from anon, authenticated;
-- Le journal des tours porte le compteur quotidien : il n'est écrit que par
-- waveurs_tourner, même précaution.
revoke insert, update, delete, truncate on public.waveurs_tours        from anon, authenticated;
revoke all on public.waveurs_portefeuille from anon;
revoke all on public.waveurs_achats       from anon;

-- La collection et le journal des ouvertures sont écrits par la seule
-- fonction d'ouverture : personne ne s'ajoute une carte depuis le
-- navigateur. Le catalogue et le tirage, eux, peuvent être modifiés par
-- l'équipe (policies ci-dessus), jamais par les visiteurs.
revoke insert, update, delete, truncate on public.waveurs_collection from anon, authenticated;
revoke insert, update, delete, truncate on public.waveurs_ouvertures from anon, authenticated;
revoke all on public.waveurs_collection from anon;
revoke all on public.waveurs_ouvertures from anon;
revoke insert, update, delete, truncate on public.waveurs_cartes from anon;
revoke insert, update, delete, truncate on public.waveurs_tirage from anon;


-- ---------------------------------------------------------------------
-- 5. Où en est un membre
--
-- Appelée à l'ouverture de la salle : combien de tours restent, combien
-- d'XP et de pièces il a gagné aujourd'hui, ce qu'il a en poche, et le
-- prix d'un booster.
--
-- « Aujourd'hui » commence à minuit à Paris, et non à minuit UTC : un
-- tour joué à 1 h du matin l'été compte pour le jour qui commence.
-- ---------------------------------------------------------------------

create or replace function public.waveurs_etat()
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_debut    timestamptz;
  v_limite   integer;
  v_utilises integer;
  v_gagne    integer;
  v_pieces_j integer;
  v_pieces   integer;
  v_boosters integer;
  v_prix     integer;
  v_cartes   integer;
  v_catalogue integer;
begin

  if auth.uid() is null then
    raise exception 'Connecte-toi pour jouer.';
  end if;

  v_debut := (date_trunc('day', now() at time zone 'Europe/Paris')) at time zone 'Europe/Paris';

  select coalesce((select valeur from public.waveurs_reglages where cle = 'tours_par_jour'), 10)
    into v_limite;

  select coalesce((select valeur from public.waveurs_reglages where cle = 'prix_booster'), 60)
    into v_prix;

  -- Les cartes différentes possédées, et la taille du catalogue en jeu.
  select count(*) into v_cartes
  from public.waveurs_collection k
  join public.waveurs_cartes c on c.id = k.carte_id and c.actif
  where k.user_id = auth.uid();

  select count(*) into v_catalogue
  from public.waveurs_cartes
  where actif;

  select count(*), coalesce(sum(xp), 0), coalesce(sum(pieces), 0)
    into v_utilises, v_gagne, v_pieces_j
  from public.waveurs_tours
  where user_id = auth.uid() and cree_le >= v_debut;

  -- Pas encore de portefeuille : rien en poche, rien n'est créé pour autant.
  select coalesce(max(w.pieces), 0), coalesce(max(w.boosters), 0)
    into v_pieces, v_boosters
  from public.waveurs_portefeuille w
  where w.user_id = auth.uid();

  return json_build_object(
    'tours_par_jour',    v_limite,
    'tours_restants',    greatest(v_limite - v_utilises, 0),
    'gagne_aujourdhui',  v_gagne,
    'pieces_aujourdhui', v_pieces_j,
    'pieces',            v_pieces,
    'boosters',          v_boosters,
    'prix_booster',      v_prix,
    'cartes_possedees',  v_cartes,
    'cartes_total',      v_catalogue
  );
end $$;


-- ---------------------------------------------------------------------
-- 6. Tirer le levier
--
-- La ligne de la table profiles est verrouillée pour la durée de
-- l'appel : deux tours lancés au même instant par le même membre (deux
-- onglets, un double clic) passent l'un après l'autre, et le second voit
-- le tour du premier dans son décompte. Sans ce verrou, on pourrait
-- dépasser la limite quotidienne en jouant en parallèle.
--
-- La fonction renvoie les trois symboles à afficher et le gain. Le
-- navigateur anime les rouleaux vers ces symboles ; il n'a aucun moyen
-- d'en influencer le choix.
-- ---------------------------------------------------------------------

create or replace function public.waveurs_tourner(p_machine text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  c_tous    constant text[] := array['vague','poisson','coquillage','ancre','bulle','perle','logo'];
  c_communs constant text[] := array['vague','poisson','coquillage','ancre','bulle'];

  v_debut    timestamptz;
  v_limite   integer;
  v_utilises integer;
  v_xp       integer;
  v_total    integer;
  v_pieces   integer;
  v_tirage   integer;
  -- Un « record » et non un %rowtype : l'ordre des colonnes de waveurs_gains
  -- n'est pas le même sur une installation neuve et sur une installation
  -- à laquelle la colonne pieces a été ajoutée après coup, et une lecture
  -- par position s'y tromperait.
  v_gain     record;
  v_symboles text[];
  v_paire    text;
  v_autre    text;
  v_place    integer;
begin

  if auth.uid() is null then
    raise exception 'Connecte-toi pour jouer.';
  end if;

  if coalesce(trim(p_machine), '') = '' or length(p_machine) > 40 then
    raise exception 'Machine inconnue.';
  end if;

  -- Verrou : voir plus haut.
  select coalesce(p.xp, 0) into v_xp
  from public.profiles p
  where p.id = auth.uid()
  for update;

  if not found then
    raise exception 'Ton profil est introuvable : reconnecte-toi.';
  end if;

  -- Un tour par seconde au plus : le navigateur en met trois ou quatre à
  -- animer un, ce garde-fou ne sert qu'à contrer un script.
  if exists (
    select 1 from public.waveurs_tours
    where user_id = auth.uid() and cree_le > now() - interval '1 second'
  ) then
    raise exception 'Doucement : laisse les rouleaux s''arrêter.';
  end if;

  v_debut := (date_trunc('day', now() at time zone 'Europe/Paris')) at time zone 'Europe/Paris';

  select coalesce((select valeur from public.waveurs_reglages where cle = 'tours_par_jour'), 10)
    into v_limite;

  select count(*) into v_utilises
  from public.waveurs_tours
  where user_id = auth.uid() and cree_le >= v_debut;

  if v_utilises >= v_limite then
    raise exception 'Plus de tours aujourd''hui : reviens demain.';
  end if;

  -- Le tirage : un entier de 0 au poids total moins un, puis la ligne où
  -- le cumul des poids dépasse cet entier.
  select coalesce(sum(poids), 0) into v_tirage
  from public.waveurs_gains
  where actif and poids > 0;

  if v_tirage = 0 then
    raise exception 'Les machines sont en panne : reviens plus tard.';
  end if;

  v_tirage := floor(random() * v_tirage)::integer;

  select t.id, t.nom, t.motif, t.symbole, t.poids, t.xp, t.pieces
    into v_gain
  from (
    select g.*, sum(g.poids) over (order by g.id) as cumul
    from public.waveurs_gains g
    where g.actif and g.poids > 0
  ) t
  where t.cumul > v_tirage
  order by t.id
  limit 1;

  if not found then
    raise exception 'Les machines sont en panne : reviens plus tard.';
  end if;

  -- Les trois symboles qui illustrent l'issue.
  if v_gain.motif = 'trio' then

    v_paire := coalesce(v_gain.symbole, c_communs[1 + floor(random() * array_length(c_communs, 1))::integer]);
    v_symboles := array[v_paire, v_paire, v_paire];

  elsif v_gain.motif = 'paire' then

    v_paire := coalesce(v_gain.symbole, c_communs[1 + floor(random() * array_length(c_communs, 1))::integer]);

    select s into v_autre
    from unnest(c_tous) as s
    where s <> v_paire
    order by random()
    limit 1;

    -- Le symbole isolé tombe sur l'un des trois rouleaux, au hasard.
    v_place := 1 + floor(random() * 3)::integer;
    v_symboles := array[v_paire, v_paire, v_paire];
    v_symboles[v_place] := v_autre;

  else

    -- Trois symboles tous différents : jamais un gain.
    select array_agg(s) into v_symboles
    from (
      select s from unnest(c_tous) as s order by random() limit 3
    ) t;

  end if;

  update public.profiles
     set xp = v_xp + v_gain.xp
   where id = auth.uid();

  -- Les pièces vont au portefeuille, créé au premier gain. Un tour qui ne
  -- rapporte aucune pièce y passe aussi, pour renvoyer le solde à jour.
  insert into public.waveurs_portefeuille as w (user_id, pieces)
  values (auth.uid(), v_gain.pieces)
  on conflict (user_id) do update
     set pieces = w.pieces + excluded.pieces,
         maj    = now()
  returning w.pieces into v_pieces;

  insert into public.waveurs_tours (user_id, machine, gain_nom, motif, symboles, xp, pieces)
  values (auth.uid(), trim(p_machine), v_gain.nom, v_gain.motif, v_symboles, v_gain.xp, v_gain.pieces);

  v_total := v_xp + v_gain.xp;

  return json_build_object(
    'symboles',        to_json(v_symboles),
    'gain',            v_gain.xp,
    'pieces',          v_gain.pieces,
    'nom',             v_gain.nom,
    'motif',           v_gain.motif,
    'symbole',         v_gain.symbole,
    'xp_total',        v_total,
    'pieces_total',    v_pieces,
    'tours_restants',  v_limite - v_utilises - 1,
    'tours_par_jour',  v_limite
  );
end $$;


-- ---------------------------------------------------------------------
-- 6 bis. Acheter des boosters chez le croupier
--
-- Les pièces gagnées à la machine se dépensent ici, et seulement ici. Le
-- prix est celui du réglage prix_booster ; le navigateur affiche ce prix,
-- il ne le fixe pas.
--
-- La ligne du portefeuille est verrouillée pour la durée de l'appel : deux
-- achats lancés au même instant (deux onglets, un double clic) passent
-- l'un après l'autre, et le second voit le solde laissé par le premier.
-- Sans ce verrou, on pourrait dépenser deux fois les mêmes pièces.
--
-- Les boosters achetés s'ajoutent au stock du membre ; on les ouvre avec
-- waveurs_ouvrir_booster, plus bas.
-- ---------------------------------------------------------------------

create or replace function public.waveurs_acheter_booster(p_quantite integer default 1)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prix     integer;
  v_cout     integer;
  v_pieces   integer;
  v_boosters integer;
begin

  if auth.uid() is null then
    raise exception 'Connecte-toi pour acheter.';
  end if;

  if p_quantite is null or p_quantite < 1 or p_quantite > 10 then
    raise exception 'Quantité invalide : de 1 à 10 boosters à la fois.';
  end if;

  select coalesce((select valeur from public.waveurs_reglages where cle = 'prix_booster'), 60)
    into v_prix;

  -- Un prix nul ou négatif est une erreur de réglage, pas une distribution
  -- gratuite : la caisse reste fermée.
  if v_prix < 1 then
    raise exception 'Le croupier a fermé sa caisse : reviens plus tard.';
  end if;

  v_cout := v_prix * p_quantite;

  -- Le portefeuille existe avant d'être verrouillé.
  insert into public.waveurs_portefeuille (user_id)
  values (auth.uid())
  on conflict (user_id) do nothing;

  select w.pieces into v_pieces
  from public.waveurs_portefeuille w
  where w.user_id = auth.uid()
  for update;

  if v_pieces < v_cout then
    raise exception 'Pas assez de pièces : il t''en faut %, tu en as %.', v_cout, v_pieces;
  end if;

  update public.waveurs_portefeuille
     set pieces   = pieces - v_cout,
         boosters = boosters + p_quantite,
         maj      = now()
   where user_id = auth.uid()
  returning pieces, boosters into v_pieces, v_boosters;

  insert into public.waveurs_achats (user_id, quantite, prix_unitaire)
  values (auth.uid(), p_quantite, v_prix);

  return json_build_object(
    'quantite',       p_quantite,
    'prix_unitaire',  v_prix,
    'pieces_total',   v_pieces,
    'boosters_total', v_boosters
  );
end $$;


-- ---------------------------------------------------------------------
-- 6 ter. Ouvrir un booster
--
-- Un booster est retiré du stock, les cartes sont tirées (une par
-- emplacement de la table waveurs_tirage) et ajoutées à la collection, le
-- tout dans le même appel : si quelque chose échoue en route, rien n'est
-- débité ni ajouté. La fonction renvoie les cartes dans l'ordre des
-- emplacements, avec pour chacune « nouvelle » (première fois qu'on la
-- sort) et le nombre d'exemplaires possédés ensuite.
--
-- La ligne du portefeuille est verrouillée : deux ouvertures lancées au
-- même instant avec un seul booster ne passent pas toutes les deux.
-- ---------------------------------------------------------------------

create or replace function public.waveurs_ouvrir_booster()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_boosters  integer;
  v_catalogue integer;
  v_place     integer;
  v_total     integer;
  v_tirage    integer;
  v_rarete    text;
  v_carte     record;
  v_quantite  integer;
  v_cartes    jsonb := '[]'::jsonb;
  v_ids       integer[] := '{}';
  v_possedees integer;
begin

  if auth.uid() is null then
    raise exception 'Connecte-toi pour ouvrir un booster.';
  end if;

  select count(*) into v_catalogue
  from public.waveurs_cartes
  where actif;

  if v_catalogue = 0 then
    raise exception 'Les cartes ne sont pas encore imprimées : reviens plus tard.';
  end if;

  if not exists (select 1 from public.waveurs_tirage where poids > 0) then
    raise exception 'Les boosters sont vides pour le moment : reviens plus tard.';
  end if;

  select w.boosters into v_boosters
  from public.waveurs_portefeuille w
  where w.user_id = auth.uid()
  for update;

  if not found or v_boosters < 1 then
    raise exception 'Tu n''as aucun booster à ouvrir : passe voir le croupier.';
  end if;

  update public.waveurs_portefeuille
     set boosters = boosters - 1,
         maj      = now()
   where user_id = auth.uid()
  returning boosters into v_boosters;

  for v_place in
    select distinct t.emplacement
    from public.waveurs_tirage t
    where t.poids > 0
    order by t.emplacement
  loop

    -- Les raretés possibles à cet emplacement : celles dont au moins une
    -- carte est en jeu.
    select coalesce(sum(t.poids), 0) into v_total
    from public.waveurs_tirage t
    where t.emplacement = v_place and t.poids > 0
      and exists (select 1 from public.waveurs_cartes c where c.actif and c.rarete = t.rarete);

    if v_total > 0 then

      v_tirage := floor(random() * v_total)::integer;

      select r.rarete into v_rarete
      from (
        select t.rarete, sum(t.poids) over (order by t.rarete) as cumul
        from public.waveurs_tirage t
        where t.emplacement = v_place and t.poids > 0
          and exists (select 1 from public.waveurs_cartes c where c.actif and c.rarete = t.rarete)
      ) r
      where r.cumul > v_tirage
      order by r.cumul
      limit 1;

      select c.id, c.nom, c.rarete, c.categorie, c.motif, c.legende
        into v_carte
      from public.waveurs_cartes c
      where c.actif and c.rarete = v_rarete
      order by random()
      limit 1;

    else

      -- Aucune des raretés prévues pour cet emplacement n'a de carte en
      -- jeu : n'importe quelle carte en jeu plutôt qu'un booster raté.
      select c.id, c.nom, c.rarete, c.categorie, c.motif, c.legende
        into v_carte
      from public.waveurs_cartes c
      where c.actif
      order by random()
      limit 1;

    end if;

    if not found then
      raise exception 'Les cartes ne sont pas encore imprimées : reviens plus tard.';
    end if;

    insert into public.waveurs_collection as k (user_id, carte_id)
    values (auth.uid(), v_carte.id)
    on conflict (user_id, carte_id) do update
       set quantite    = k.quantite + 1,
           derniere_le = now()
    returning k.quantite into v_quantite;

    v_ids := v_ids || v_carte.id;

    v_cartes := v_cartes || jsonb_build_object(
      'id',        v_carte.id,
      'nom',       v_carte.nom,
      'rarete',    v_carte.rarete,
      'categorie', v_carte.categorie,
      'motif',     v_carte.motif,
      'legende',   v_carte.legende,
      'nouvelle',  v_quantite = 1,
      'quantite',  v_quantite
    );

  end loop;

  insert into public.waveurs_ouvertures (user_id, cartes)
  values (auth.uid(), v_ids);

  select count(*) into v_possedees
  from public.waveurs_collection k
  join public.waveurs_cartes c on c.id = k.carte_id and c.actif
  where k.user_id = auth.uid();

  return json_build_object(
    'cartes',           v_cartes,
    'boosters_total',   v_boosters,
    'cartes_possedees', v_possedees,
    'cartes_total',     v_catalogue
  );
end $$;


-- ---------------------------------------------------------------------
-- 7. Qui peut appeler quoi
--
-- Seuls les comptes connectés jouent et achètent. Les visiteurs se
-- promènent dans la salle et parlent au croupier sans pouvoir tirer le
-- levier ni rien acheter.
-- ---------------------------------------------------------------------

-- Supabase accorde par défaut l'exécution des fonctions aux visiteurs
-- anonymes ; « from public » seul ne la retire pas.
revoke all on function public.waveurs_etat() from public, anon;
revoke all on function public.waveurs_tourner(text) from public, anon;
revoke all on function public.waveurs_acheter_booster(integer) from public, anon;
revoke all on function public.waveurs_ouvrir_booster() from public, anon;

grant execute on function public.waveurs_etat() to authenticated;
grant execute on function public.waveurs_tourner(text) to authenticated;
grant execute on function public.waveurs_acheter_booster(integer) to authenticated;
grant execute on function public.waveurs_ouvrir_booster() to authenticated;


-- ---------------------------------------------------------------------
-- 8. Vérification
--
-- La première requête doit lister les neuf tables avec RLS activée, la
-- deuxième les quatre fonctions, la troisième les six gains de départ, la
-- quatrième les droits d'écriture sur le portefeuille, les achats, les
-- tours, la collection et les ouvertures (aucune ligne : ni les visiteurs
-- ni les membres ne peuvent y écrire). La cinquième compte les cartes par
-- rareté (16, 11, 6 et 3 au départ) et la sixième donne les chances de
-- chaque emplacement d'un booster, en pourcentage. La dernière donne le
-- gain moyen par tour : autour de 2 XP et de 5,6 pièces.
-- ---------------------------------------------------------------------

select relname as table_name, relrowsecurity as rls_active
from pg_class
where relname in ('waveurs_reglages', 'waveurs_gains', 'waveurs_tours',
                  'waveurs_portefeuille', 'waveurs_achats',
                  'waveurs_cartes', 'waveurs_tirage',
                  'waveurs_collection', 'waveurs_ouvertures')
order by relname;

select proname as fonction, prosecdef as security_definer
from pg_proc
where pronamespace = 'public'::regnamespace
  and proname in ('waveurs_etat', 'waveurs_tourner', 'waveurs_acheter_booster',
                  'waveurs_ouvrir_booster')
order by proname;

select id, nom, motif, symbole, poids, xp, pieces, actif
from public.waveurs_gains
order by xp desc, id;

select grantee, table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('waveurs_portefeuille', 'waveurs_achats', 'waveurs_tours',
                     'waveurs_collection', 'waveurs_ouvertures')
  and grantee in ('anon', 'authenticated')
  and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE');

select rarete, count(*) as cartes, count(*) filter (where actif) as en_jeu
from public.waveurs_cartes
group by rarete
order by min(id);

select emplacement, rarete,
       round(100.0 * poids / nullif(sum(poids) over (partition by emplacement), 0), 1) as pourcent
from public.waveurs_tirage
order by emplacement, rarete;

select round(sum(poids::numeric * xp) / nullif(sum(poids), 0), 2)     as gain_moyen_par_tour_en_xp,
       round(sum(poids::numeric * pieces) / nullif(sum(poids), 0), 2) as gain_moyen_par_tour_en_pieces,
       sum(poids) as poids_total
from public.waveurs_gains
where actif;


-- ---------------------------------------------------------------------
-- Pour suivre le jeu
--
-- À lancer à la demande, pour voir comment la salle est utilisée. Rien
-- ici ne modifie quoi que ce soit.
--
--   -- Activité des sept derniers jours
--   select (cree_le at time zone 'Europe/Paris')::date as jour,
--          count(*)                as tours,
--          count(distinct user_id) as joueurs,
--          sum(xp)                 as xp_distribue
--   from public.waveurs_tours
--   where cree_le > now() - interval '7 days'
--   group by 1 order by 1 desc;
--
--   -- Les jackpots
--   select p.pseudo, t.cree_le, t.xp, t.pieces
--   from public.waveurs_tours t
--   join public.profiles p on p.id = t.user_id
--   where t.motif = 'trio' and 'logo' = all (t.symboles)
--   order by t.cree_le desc;
--
--   -- Pièces distribuées et boosters vendus, jour par jour
--   select j.jour, j.pieces_distribuees, coalesce(a.boosters_vendus, 0) as boosters_vendus
--   from (
--     select (cree_le at time zone 'Europe/Paris')::date as jour, sum(pieces) as pieces_distribuees
--     from public.waveurs_tours
--     where cree_le > now() - interval '14 days'
--     group by 1
--   ) j
--   left join (
--     select (cree_le at time zone 'Europe/Paris')::date as jour, sum(quantite) as boosters_vendus
--     from public.waveurs_achats
--     where cree_le > now() - interval '14 days'
--     group by 1
--   ) a using (jour)
--   order by j.jour desc;
--
--   -- Boosters ouverts par jour, et cartes légendaires sorties
--   select (o.cree_le at time zone 'Europe/Paris')::date as jour,
--          count(*) as boosters_ouverts,
--          count(*) filter (where exists (
--            select 1 from public.waveurs_cartes c
--            where c.id = any (o.cartes) and c.rarete = 'legendaire'
--          )) as avec_une_legendaire
--   from public.waveurs_ouvertures o
--   where o.cree_le > now() - interval '14 days'
--   group by 1 order by 1 desc;
--
--   -- Les collections les plus avancées
--   select p.pseudo, count(*) as cartes_differentes, sum(k.quantite) as exemplaires
--   from public.waveurs_collection k
--   join public.profiles p on p.id = k.user_id
--   group by p.pseudo
--   order by cartes_differentes desc, exemplaires desc
--   limit 20;
--
--   -- Les plus gros portefeuilles (pour repérer une anomalie)
--   select p.pseudo, w.pieces, w.boosters
--   from public.waveurs_portefeuille w
--   join public.profiles p on p.id = w.user_id
--   order by w.pieces desc, w.boosters desc
--   limit 20;
-- ---------------------------------------------------------------------
