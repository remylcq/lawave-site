-- Wave Cards : le quotidien (accueil, calendrier et événements, parcours, quêtes, nouveautés, classements, profil).
-- Ce fichier crée les tables et leurs données de départ ; les fonctions sont dans quotidien-jeu.sql.
-- Toutes les tables : RLS activée, aucune politique (on n'y accède que par les fonctions SECURITY DEFINER).
-- Les récompenses se prennent dans jeu_reclamations (clés « q:… », jamais « m:… » qui compte les missions) et se paient
-- par jeu_crediter : 1 vinyle = 1 pack, donc tout est modeste.

-- Événements à durée limitée : des missions qui rapportent des médailles, des récompenses qu'on achète en médailles
create table if not exists public.jeu_evenements (
  id text primary key check (id ~ '^[a-z0-9-]{2,40}$'),
  nom text not null check (char_length(nom) between 2 and 60),
  sous_titre text not null default '' check (char_length(sous_titre) <= 90),
  description text not null default '' check (char_length(description) <= 400),
  accent text not null default '#4FB4FF' check (accent ~ '^#[0-9a-fA-F]{6}$'),
  debut date not null,
  fin date not null,
  medaille text not null default 'Médailles' check (char_length(medaille) between 2 and 24),
  actif boolean not null default true,
  cree_le timestamptz not null default now(),
  check (fin >= debut)
);

create table if not exists public.jeu_evenement_missions (
  id bigserial primary key,
  evenement_id text not null references public.jeu_evenements (id) on delete cascade,
  libelle text not null check (char_length(libelle) between 3 and 90),
  metrique text not null check (metrique in ('ouvertures', 'holos', 'rares', 'epiques', 'combats', 'victoires', 'ventes', 'achats', 'annonces', 'echanges')),
  objectif integer not null check (objectif between 1 and 100000),
  medailles integer not null check (medailles between 1 and 100),
  ordre integer not null default 0
);

create table if not exists public.jeu_evenement_recompenses (
  id bigserial primary key,
  evenement_id text not null references public.jeu_evenements (id) on delete cascade,
  libelle text not null check (char_length(libelle) between 3 and 60),
  cout integer not null check (cout between 1 and 10000),
  vinyles integer not null default 0 check (vinyles between 0 and 50),
  garantis integer not null default 0 check (garantis between 0 and 5),
  ordre integer not null default 0,
  check (vinyles > 0 or garantis > 0)
);

-- Parcours du collectionneur : 30 étapes en 6 chapitres, détectées par les chiffres du joueur
create table if not exists public.jeu_parcours_def (
  id text primary key,
  chapitre integer not null check (chapitre between 1 and 6),
  ordre integer not null,
  nom text not null,
  description text not null,
  metrique text not null,
  seuil integer not null check (seuil >= 1),
  vinyles integer not null default 1 check (vinyles between 0 and 20)
);

-- Défis de la semaine : trois tirés par semaine dans cette réserve
create table if not exists public.jeu_defis_def (
  id text primary key,
  libelle text not null,
  metrique text not null check (metrique in ('ouvertures', 'holos', 'rares', 'epiques', 'combats', 'victoires', 'ventes', 'achats', 'annonces', 'echanges')),
  objectif integer not null check (objectif >= 1),
  vinyles integer not null default 2 check (vinyles between 1 and 20)
);

-- Titres du profil de collectionneur (et le cadre qui les accompagne)
create table if not exists public.jeu_titres_def (
  id text primary key,
  nom text not null,
  description text not null,
  metrique text not null,
  seuil integer not null check (seuil >= 1),
  cadre text not null default 'aucun' check (cadre in ('aucun', 'argent', 'or', 'azur', 'aurore')),
  ordre integer not null default 0
);

create table if not exists public.jeu_nouveautes (
  id bigserial primary key,
  titre text not null check (char_length(titre) between 3 and 90),
  texte text not null default '' check (char_length(texte) <= 600),
  etiquette text not null default 'Nouveau' check (char_length(etiquette) between 2 and 20),
  publie date not null default current_date,
  actif boolean not null default true,
  cree_le timestamptz not null default now()
);

create table if not exists public.jeu_lecture (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  nouveautes_vu timestamptz not null default now()
);

create table if not exists public.jeu_profils (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  vitrine jsonb not null default '[]'::jsonb,
  titre text references public.jeu_titres_def (id) on delete set null,
  cadre text not null default 'aucun' check (cadre in ('aucun', 'argent', 'or', 'azur', 'aurore')),
  maj timestamptz not null default now()
);

create table if not exists public.jeu_expeditions (
  id bigserial primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  booster_id text not null,
  artist_id uuid not null,
  holo boolean not null default false,
  rarete smallint not null,
  duree integer not null check (duree in (2, 6, 12)),
  debut timestamptz not null default now(),
  fin timestamptz not null,
  etat text not null default 'en_cours' check (etat in ('en_cours', 'prise')),
  gain integer not null default 0,
  prise_le timestamptz
);
create index if not exists jeu_expeditions_user_idx on public.jeu_expeditions (user_id, etat);

alter table public.jeu_evenements enable row level security;
alter table public.jeu_evenement_missions enable row level security;
alter table public.jeu_evenement_recompenses enable row level security;
alter table public.jeu_parcours_def enable row level security;
alter table public.jeu_defis_def enable row level security;
alter table public.jeu_titres_def enable row level security;
alter table public.jeu_nouveautes enable row level security;
alter table public.jeu_lecture enable row level security;
alter table public.jeu_profils enable row level security;
alter table public.jeu_expeditions enable row level security;

-- Le parcours : 5 étapes par chapitre
insert into public.jeu_parcours_def (id, chapitre, ordre, nom, description, metrique, seuil, vinyles) values
  ('p01', 1, 1, 'Ton premier pack', 'Ouvre un pack.', 'ouvertures', 1, 1),
  ('p02', 1, 2, 'Quelques disques de plus', 'Ouvre 5 packs.', 'ouvertures', 5, 1),
  ('p03', 1, 3, 'Le geste est acquis', 'Ouvre 25 packs.', 'ouvertures', 25, 1),
  ('p04', 1, 4, 'Le cadeau du jour', 'Récupère ton cadeau de connexion.', 'serie_max', 1, 1),
  ('p05', 1, 5, 'Des Wave Coins en vinyles', 'Échange des Wave Coins contre des vinyles.', 'echanges', 1, 1),
  ('p06', 2, 1, 'Première étagère', 'Possède 5 cartes différentes.', 'uniques', 5, 1),
  ('p07', 2, 2, 'Une vraie collection', 'Possède 15 cartes différentes.', 'uniques', 15, 1),
  ('p08', 2, 3, 'Ça brille', 'Obtiens une carte holographique.', 'holos', 1, 1),
  ('p09', 2, 4, 'Un gros nom', 'Obtiens une carte Épique ou mieux.', 'epiques', 1, 1),
  ('p10', 2, 5, 'Deux collections', 'Possède des cartes de deux collections.', 'collections', 2, 1),
  ('p11', 3, 1, 'La roue tourne', 'Tourne la roue du jour.', 'roues', 1, 1),
  ('p12', 3, 2, 'Premier contrat', 'Termine une mission.', 'missions', 1, 1),
  ('p13', 3, 3, 'Appliqué', 'Termine 5 missions.', 'missions', 5, 1),
  ('p14', 3, 4, 'Trois jours de suite', 'Récupère le cadeau 3 jours de suite.', 'serie_max', 3, 1),
  ('p15', 3, 5, 'Une semaine entière', 'Récupère le cadeau 7 jours de suite.', 'serie_max', 7, 2),
  ('p16', 4, 1, 'Première annonce', 'Mets une carte en vente sur le marché.', 'annonces', 1, 1),
  ('p17', 4, 2, 'Première vente', 'Vends une carte.', 'ventes', 1, 1),
  ('p18', 4, 3, 'Premier achat', 'Achète une carte à un autre joueur.', 'achats', 1, 1),
  ('p19', 4, 4, 'Habitué du marché', 'Fais 5 ventes ou achats.', 'echanges_marche', 5, 1),
  ('p20', 4, 5, 'Marchand', 'Vends 3 cartes.', 'ventes', 3, 2),
  ('p21', 5, 1, 'Premier round', 'Lance un combat.', 'combats', 1, 1),
  ('p22', 5, 2, 'Première victoire', 'Gagne un combat.', 'victoires', 1, 1),
  ('p23', 5, 3, 'Sur le ring', 'Livre 10 combats.', 'combats', 10, 1),
  ('p24', 5, 4, 'Cinq victoires', 'Gagne 5 combats.', 'victoires', 5, 1),
  ('p25', 5, 5, 'Invaincu', 'Gagne 15 combats.', 'victoires', 15, 2),
  ('p26', 6, 1, 'Niveau 5', 'Atteins le niveau 5.', 'niveau', 5, 1),
  ('p27', 6, 2, 'Niveau 10', 'Atteins le niveau 10.', 'niveau', 10, 2),
  ('p28', 6, 3, 'À mi-chemin', 'Remplis la moitié d''un classeur.', 'classeur_pct', 50, 2),
  ('p29', 6, 4, 'Une légende', 'Obtiens une carte Légendaire ou mieux.', 'legendaires', 1, 2),
  ('p30', 6, 5, 'Classeur complet', 'Termine un classeur entier.', 'classeurs_finis', 1, 3)
on conflict (id) do nothing;

insert into public.jeu_defis_def (id, libelle, metrique, objectif, vinyles) values
  ('d-ouv-5', 'Ouvrir 5 packs', 'ouvertures', 5, 2),
  ('d-ouv-15', 'Ouvrir 15 packs', 'ouvertures', 15, 3),
  ('d-holo-1', 'Obtenir une carte holo', 'holos', 1, 3),
  ('d-rare-3', 'Obtenir 3 cartes Rares ou mieux', 'rares', 3, 2),
  ('d-epi-1', 'Obtenir une carte Épique ou mieux', 'epiques', 1, 3),
  ('d-vente-1', 'Vendre une carte', 'ventes', 1, 2),
  ('d-achat-1', 'Acheter une carte', 'achats', 1, 2),
  ('d-annonce-2', 'Mettre 2 cartes en vente', 'annonces', 2, 2),
  ('d-combat-3', 'Livrer 3 combats', 'combats', 3, 2),
  ('d-victoire-2', 'Gagner 2 combats', 'victoires', 2, 3)
on conflict (id) do nothing;

insert into public.jeu_titres_def (id, nom, description, metrique, seuil, cadre, ordre) values
  ('apprenti', 'Apprenti digger', 'Ouvrir 10 packs.', 'ouvertures', 10, 'aucun', 1),
  ('collectionneur', 'Collectionneur', 'Posséder 25 cartes différentes.', 'uniques', 25, 'argent', 2),
  ('eclats', 'Chasseur d''éclats', 'Obtenir 3 cartes holo.', 'holos', 3, 'azur', 3),
  ('assidu', 'Assidu', 'Série de 7 jours de cadeaux.', 'serie_max', 7, 'argent', 4),
  ('marchand', 'Marchand', 'Réussir 5 ventes.', 'ventes', 5, 'or', 5),
  ('gladiateur', 'Gladiateur', 'Gagner 10 combats.', 'victoires', 10, 'or', 6),
  ('legende', 'Légende vivante', 'Obtenir une carte Légendaire.', 'legendaires', 1, 'or', 7),
  ('mythe', 'Mythe', 'Obtenir une carte Mythique.', 'mythiques', 1, 'aurore', 8),
  ('complet', 'Classeur complet', 'Terminer un classeur.', 'classeurs_finis', 1, 'aurore', 9),
  ('diplome', 'Diplômé du parcours', 'Terminer les 30 étapes du parcours.', 'parcours', 30, 'azur', 10)
on conflict (id) do nothing;

-- Un premier événement : Halloween, avec ses missions et sa boutique de médailles
insert into public.jeu_evenements (id, nom, sous_titre, description, accent, debut, fin, medaille)
values ('halloween-2026', 'Nuit des spectres', 'Halloween sur Wave Cards',
        'Une semaine pour ouvrir des packs et frapper fort : chaque mission rapporte des médailles, à échanger contre des vinyles.',
        '#FF7A29', date '2026-10-28', date '2026-11-03', 'Médailles du spectre')
on conflict (id) do nothing;

insert into public.jeu_evenement_missions (evenement_id, libelle, metrique, objectif, medailles, ordre)
select 'halloween-2026', x.libelle, x.metrique, x.objectif, x.medailles, x.ordre
  from (values ('Ouvrir 5 packs', 'ouvertures', 5, 2, 1), ('Ouvrir 15 packs', 'ouvertures', 15, 4, 2),
               ('Obtenir une carte holo', 'holos', 1, 4, 3), ('Obtenir 2 cartes Rares ou mieux', 'rares', 2, 2, 4),
               ('Livrer 3 combats', 'combats', 3, 3, 5), ('Réussir une vente sur le marché', 'ventes', 1, 3, 6)) x (libelle, metrique, objectif, medailles, ordre)
 where exists (select 1 from public.jeu_evenements where id = 'halloween-2026')
   and not exists (select 1 from public.jeu_evenement_missions where evenement_id = 'halloween-2026');

insert into public.jeu_evenement_recompenses (evenement_id, libelle, cout, vinyles, garantis, ordre)
select 'halloween-2026', x.libelle, x.cout, x.vinyles, x.garantis, x.ordre
  from (values ('1 vinyle', 4, 1, 0, 1), ('3 vinyles', 10, 3, 0, 2), ('Un pack Épique garanti', 14, 0, 1, 3)) x (libelle, cout, vinyles, garantis, ordre)
 where exists (select 1 from public.jeu_evenements where id = 'halloween-2026')
   and not exists (select 1 from public.jeu_evenement_recompenses where evenement_id = 'halloween-2026');

insert into public.jeu_nouveautes (titre, texte, etiquette, publie)
select x.titre, x.texte, x.etiquette, x.publie
  from (values
    ('Le combat 2 contre 2', 'Compose ton duo, affronte l''Arène, le défi du jour et les défenses des autres joueurs.', 'Combat', date '2026-10-27'),
    ('Le marché entre joueurs', 'Mets tes cartes en vente en vinyles, achète celles des autres : une commission de 5 % est détruite à chaque vente.', 'Marché', date '2026-10-27'),
    ('1 vinyle = 1 pack', 'Les packs se paient en vinyles. Échange tes Wave Coins contre des vinyles quand il t''en faut.', 'Économie', date '2026-10-27')
  ) x (titre, texte, etiquette, publie)
 where not exists (select 1 from public.jeu_nouveautes);
