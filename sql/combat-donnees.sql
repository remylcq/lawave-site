-- Wave Cards : le combat 2v2 — les données (2026-10-27).
-- Chaque carte a un TYPE (8 styles de rap français), des statistiques (PV, Puissance, Défense, Vitesse), 2 attaques et une
-- capacité passive. Tout est calculé par défaut (rareté du classeur, notoriété = fans, holo, type tiré de l'artiste) et
-- peut être surchargé par l'équipe, artiste par artiste (combat_surcharges). Les catalogues (types, affinités, attaques,
-- capacités) sont des tables que l'équipe modifie.
-- Toutes les tables ont la RLS sans politique : seules les fonctions SECURITY DEFINER (sql/combat-moteur.sql) y touchent.

create table if not exists public.combat_types (
  id text primary key,
  nom text not null,
  couleur text not null check (couleur ~ '^#[0-9a-fA-F]{6}$'),
  ordre integer not null,
  citation text not null
);

-- Affinités : multiplicateur des dégâts d'un type attaquant sur un type défenseur ; absent = neutre (×1).
create table if not exists public.combat_affinites (
  att text not null references public.combat_types(id) on delete cascade on update cascade,
  def text not null references public.combat_types(id) on delete cascade on update cascade,
  mult numeric(4,2) not null check (mult > 0 and mult <= 3),
  primary key (att, def)
);

-- Attaques. role : base / forte / soutien (d'un type) ou neutre (sans type). cible : ennemi, ennemis, allie (soi compris), soi, equipe.
-- effet : soin, pui+, def+, vit+ (sur l'utilisateur ou ses alliés), pui-, def-, vit-, etourdi, poison (sur la cible),
-- vampirisme, recul (sur l'utilisateur, en % des dégâts). valeur : % ou niveaux. chance : % d'effet.
create table if not exists public.combat_attaques (
  id text primary key,
  nom text not null,
  type text references public.combat_types(id) on delete set null on update cascade,
  role text not null check (role in ('base', 'forte', 'soutien', 'neutre')),
  puissance integer not null default 0 check (puissance between 0 and 200),
  justesse integer not null default 100 check (justesse between 1 and 100),
  effet text check (effet in ('soin', 'pui+', 'def+', 'vit+', 'pui-', 'def-', 'vit-', 'etourdi', 'poison', 'vampirisme', 'recul')),
  valeur integer not null default 0 check (valeur between 0 and 100),
  chance integer not null default 100 check (chance between 0 and 100),
  cible text not null default 'ennemi' check (cible in ('ennemi', 'ennemis', 'allie', 'soi', 'equipe')),
  description text not null default '',
  actif boolean not null default true
);

-- Capacités passives. code : regeneration, epines, sang_froid, ouverture, dernier_souffle, survivant, aura, concentration.
create table if not exists public.combat_capacites (
  id text primary key,
  nom text not null,
  code text not null check (code in ('regeneration', 'epines', 'sang_froid', 'ouverture', 'dernier_souffle', 'survivant', 'aura', 'concentration')),
  valeur integer not null default 0 check (valeur between 0 and 100),
  description text not null default ''
);

-- Surcharges de l'équipe : une ligne par artiste, chaque champ vide = valeur par défaut. Les stats sont les stats DE BASE
-- (avant le multiplicateur de rareté du booster et le bonus holo).
create table if not exists public.combat_surcharges (
  artist_id uuid primary key references public.jeu_cartes(artist_id) on delete cascade,
  type text references public.combat_types(id) on delete set null on update cascade,
  pv integer check (pv between 20 and 400),
  pui integer check (pui between 10 and 300),
  def integer check (def between 10 and 300),
  vit integer check (vit between 10 and 300),
  atk1 text references public.combat_attaques(id) on delete set null on update cascade,
  atk2 text references public.combat_attaques(id) on delete set null on update cascade,
  capacite text references public.combat_capacites(id) on delete set null on update cascade,
  citation text check (char_length(citation) <= 160),
  maj_le timestamptz not null default now()
);

-- Le duo de chaque joueur : « principal » (celui qu'il emmène au combat) et « defense » (celui que les autres affrontent).
create table if not exists public.combat_equipes (
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('principal', 'defense')),
  slot smallint not null check (slot in (1, 2)),
  booster_id text not null,
  artist_id uuid not null,
  holo boolean not null default false,
  primary key (user_id, role, slot)
);

create table if not exists public.combat_joueurs (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  trophees integer not null default 1000 check (trophees >= 0),
  victoires integer not null default 0,
  defaites integer not null default 0,
  serie integer not null default 0,
  meilleure_serie integer not null default 0,
  defenses_gagnees integer not null default 0,
  defenses_perdues integer not null default 0,
  saison text,
  jour date,
  vinyles_jour integer not null default 0,
  pvp_jour integer not null default 0,
  defi_jour date
);

-- L'Arène : des crews fictifs de plus en plus forts ; la première victoire sur chacun rapporte des vinyles.
create table if not exists public.combat_arene (
  palier integer primary key,
  nom text not null,
  description text not null default '',
  artist1 uuid not null references public.jeu_cartes(artist_id) on delete cascade,
  rarete1 integer not null check (rarete1 between 1 and 5),
  artist2 uuid not null references public.jeu_cartes(artist_id) on delete cascade,
  rarete2 integer not null check (rarete2 between 1 and 5),
  bonus integer not null default 0 check (bonus between 0 and 100),
  recompense integer not null default 1 check (recompense between 0 and 50)
);

create table if not exists public.combat_progres (
  user_id uuid not null references public.profiles(id) on delete cascade,
  palier integer not null references public.combat_arene(palier) on delete cascade,
  premiere_le timestamptz not null default now(),
  primary key (user_id, palier)
);

create table if not exists public.combat_parties (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  mode text not null check (mode in ('arene', 'defi', 'pvp', 'entrainement')),
  cible text,
  adversaire text not null,
  defenseur uuid,
  etat text not null default 'en_cours' check (etat in ('en_cours', 'victoire', 'defaite', 'abandon', 'expire')),
  tour integer not null default 1,
  unites jsonb not null,
  journal jsonb not null default '[]'::jsonb,
  gains jsonb,
  trophees_delta integer,
  debut timestamptz not null default now(),
  maj timestamptz not null default now(),
  fin timestamptz
);
create index if not exists combat_parties_user_idx on public.combat_parties (user_id, debut desc);
create unique index if not exists combat_parties_en_cours_idx on public.combat_parties (user_id) where etat = 'en_cours';

alter table public.combat_types enable row level security;
alter table public.combat_affinites enable row level security;
alter table public.combat_attaques enable row level security;
alter table public.combat_capacites enable row level security;
alter table public.combat_surcharges enable row level security;
alter table public.combat_equipes enable row level security;
alter table public.combat_joueurs enable row level security;
alter table public.combat_arene enable row level security;
alter table public.combat_progres enable row level security;
alter table public.combat_parties enable row level security;

-- Les 8 styles, dans l'ordre du cycle des affinités.
insert into public.combat_types (id, nom, couleur, ordre, citation) values
  ('drill',      'Drill',      '#E5484D', 1, 'Le froid du bitume, la rage dans la voix.'),
  ('trap',       'Trap',       '#A879FF', 2, '808 qui tremblent, hi-hats qui filent.'),
  ('boombap',    'Boom Bap',   '#F2C14E', 3, 'Un sample, une caisse claire, et tout est dit.'),
  ('cloud',      'Cloud',      '#8FD3FF', 4, 'Dans les nuages, sans jamais redescendre.'),
  ('pop',        'Pop Rap',    '#FF7AB8', 5, 'Un refrain, et c''est tout le monde qui chante.'),
  ('conscient',  'Conscient',  '#3DD68C', 6, 'Chaque rime pèse, chaque mot compte.'),
  ('rue',        'Rue',        '#FF9F43', 7, 'Le son du quartier, sans filtre.'),
  ('afro',       'Afro',       '#20C9B0', 8, 'Le rythme venu d''ailleurs, le groove d''ici.')
on conflict (id) do nothing;

-- Le cycle : le type n bat les types n+1 et n+2 (×1,5) ; ceux-ci le subissent à l'inverse (×0,67).
insert into public.combat_affinites (att, def, mult)
select a.id, d.id, 1.5
  from public.combat_types a join public.combat_types d on (d.ordre - a.ordre + 8) % 8 in (1, 2)
on conflict (att, def) do nothing;
insert into public.combat_affinites (att, def, mult)
select d.id, a.id, 0.67
  from public.combat_types a join public.combat_types d on (d.ordre - a.ordre + 8) % 8 in (1, 2)
on conflict (att, def) do nothing;

insert into public.combat_attaques (id, nom, type, role, puissance, justesse, effet, valeur, chance, cible, description) values
  ('drill-rafale',   'Rafale de bars',          'drill', 'base',    55,  95, null,     0,  100, 'ennemis', 'Des barres sans respirer : touche les deux adversaires.'),
  ('drill-slide',    'Slide glacial',           'drill', 'base',    60,  90, 'vit-',   1,  30,  'ennemi',  'Un flow glissant qui peut ralentir l''adversaire.'),
  ('drill-diss',     'Diss de quartier',        'drill', 'forte',   85,  80, 'recul',  15, 100, 'ennemi',  'Un tacle frontal : ça fait mal des deux côtés.'),
  ('drill-masque',   'Cagoule de scène',        'drill', 'soutien', 0,   100,'pui+',   1,  100, 'soi',     'Anonymat et intimidation : la Puissance monte.'),
  ('trap-808',       '808 qui tremble',         'trap',  'base',    58,  95, null,     0,  100, 'ennemi',  'Une basse qui fait vibrer les murs.'),
  ('trap-hihat',     'Roulement de hi-hats',    'trap',  'base',    50,  100,'etourdi',0,  15,  'ennemi',  'Un roulement hypnotique qui peut étourdir.'),
  ('trap-autotune',  'Autotune acide',          'trap',  'forte',   82,  85, 'def-',   1,  40,  'ennemi',  'Une voix qui découpe la Défense adverse.'),
  ('trap-adlibs',    'Ad-libs en cascade',      'trap',  'soutien', 0,   100,'vit+',   1,  100, 'soi',     'Skrrt ! Skrrt ! La Vitesse monte.'),
  ('bb-sample',      'Sample de vinyle',        'boombap','base',   56,  95, null,     0,  100, 'ennemi',  'Un vieux disque qui frappe encore.'),
  ('bb-boucle',      'Boucle de caisse claire', 'boombap','base',   52,  100,'def-',   1,  25,  'ennemi',  'Une boucle tenace qui use la Défense.'),
  ('bb-ancien',      'Coup de l''ancien',       'boombap','forte',  88,  80, null,     0,  100, 'ennemi',  'La référence qui remet les jeunes à leur place.'),
  ('bb-cypher',      'Cypher de la vieille école','boombap','soutien',0, 100,'def+',   1,  100, 'equipe',  'Le crew se serre les coudes : Défense en hausse pour le duo.'),
  ('cloud-reverb',   'Réverb infinie',          'cloud', 'base',    54,  100,null,     0,  100, 'ennemi',  'Un écho qui n''en finit pas.'),
  ('cloud-bruine',   'Brume mélancolique',      'cloud', 'base',    55,  95, 'pui-',   1,  30,  'ennemi',  'Une ambiance grise qui peut éteindre l''adversaire.'),
  ('cloud-nostalgie','Vague de nostalgie',      'cloud', 'forte',   80,  85, 'etourdi',0,  25,  'ennemis', 'Touche les deux adversaires, et peut les étourdir.'),
  ('cloud-berceuse', 'Berceuse planante',       'cloud', 'soutien', 0,   100,'soin',   30, 100, 'allie',   'Une mélodie qui rend 30 % des PV à un allié.'),
  ('pop-refrain',    'Refrain entêtant',        'pop',   'base',    55,  100,null,     0,  100, 'ennemi',  'Impossible de se le sortir de la tête.'),
  ('pop-feat',       'Feat surprise',           'pop',   'base',    62,  90, null,     0,  100, 'ennemi',  'Un invité de dernière minute fait mouche.'),
  ('pop-tube',       'Tube de l''été',          'pop',   'forte',   84,  85, null,     0,  100, 'ennemi',  'Le hit qui passe partout, tout le temps.'),
  ('pop-clip',       'Clip viral',              'pop',   'soutien', 0,   100,'pui+',   1,  100, 'equipe',  'Le duo entier gagne en Puissance.'),
  ('cons-punchline', 'Punchline chirurgicale',  'conscient','base', 58,  95, null,     0,  100, 'ennemi',  'Une phrase, une cible, un silence.'),
  ('cons-texte',     'Texte qui pèse',          'conscient','base', 52,  100,'def-',   1,  30,  'ennemi',  'Un message qui fait baisser la garde.'),
  ('cons-manifeste', 'Manifeste',               'conscient','forte',82,  90, null,     0,  100, 'ennemi',  'Un couplet qui reste dans les têtes.'),
  ('cons-reflexion', 'Moment de réflexion',     'conscient','soutien',0, 100,'soin',   35, 100, 'allie',   'Reprendre son souffle : rend 35 % des PV.'),
  ('rue-freestyle',  'Freestyle de trottoir',   'rue',   'base',    56,  95, null,     0,  100, 'ennemi',  'Du sang-froid et du flow, sans préparation.'),
  ('rue-badbuzz',    'Bad buzz',                'rue',   'base',    50,  100,'poison', 7,  35,  'ennemi',  'Une rumeur qui ronge, tour après tour.'),
  ('rue-coup',       'Coup de force',           'rue',   'forte',   90,  75, 'recul',  15, 100, 'ennemi',  'Puissant mais risqué : l''attaquant encaisse un peu.'),
  ('rue-reputation', 'Réputation',              'rue',   'soutien', 0,   100,'pui+',   1,  100, 'soi',     'Le nom qui précède : la Puissance monte.'),
  ('afro-groove',    'Groove contagieux',       'afro',  'base',    55,  100,'vit+',   1,  25,  'ennemi',  'Un groove qui donne envie de bouger plus vite.'),
  ('afro-percu',     'Percussions',             'afro',  'base',    60,  95, null,     0,  100, 'ennemi',  'Des percussions qui claquent.'),
  ('afro-carnaval',  'Carnaval de feu',         'afro',  'forte',   86,  80, 'vampirisme',40,100,'ennemi',  'Ça brûle, et ça redonne de l''énergie.'),
  ('afro-danse',     'Danse collective',        'afro',  'soutien', 0,   100,'vit+',   1,  100, 'equipe',  'Tout le duo gagne en Vitesse.'),
  ('neutre-freestyle','Freestyle',              null,    'neutre',  50,  100,null,     0,  100, 'ennemi',  'Un classique, sans fioriture.'),
  ('neutre-punchline','Punchline',              null,    'neutre',  58,  95, null,     0,  100, 'ennemi',  'Une phrase qui claque.'),
  ('neutre-sample',  'Sample malin',            null,    'neutre',  54,  100,null,     0,  100, 'ennemi',  'Un bout de vieux tube bien placé.'),
  ('neutre-diss',    'Diss track',              null,    'neutre',  72,  85, 'pui-',   1,  30,  'ennemi',  'Un morceau qui vise juste et peut affaiblir.'),
  ('neutre-feat',    'Feat inattendu',          null,    'neutre',  0,   100,'soin',   25, 100, 'allie',   'Un invité remet un allié d''aplomb (25 % des PV).'),
  ('neutre-ambiance','Ambiance de salle',       null,    'neutre',  0,   100,'pui+',   1,  100, 'equipe',  'La salle est chaude : Puissance en hausse pour le duo.'),
  ('neutre-clash',   'Clash général',           null,    'neutre',  62,  90, null,     0,  100, 'ennemis', 'Tout le monde dans le viseur.')
on conflict (id) do nothing;

insert into public.combat_capacites (id, nom, code, valeur, description) values
  ('second-souffle',  'Second souffle',        'regeneration',    6,  'Récupère 6 % de ses PV à la fin de chaque tour.'),
  ('langue-acree',   'Langue acérée',         'epines',          12, 'Renvoie 12 % des dégâts qu''elle reçoit.'),
  ('sang-froid',      'Sang-froid',            'sang_froid',      0,  'Insensible à l''étourdissement, au poison et aux baisses de stats.'),
  ('entree-en-scene', 'Entrée en scène',       'ouverture',       30, 'Sa première attaque inflige 30 % de dégâts en plus.'),
  ('dernier-couplet', 'Dernier couplet',       'dernier_souffle', 15, 'Mise à terre, elle inflige des dégâts à un adversaire.'),
  ('jamais-au-tapis', 'Jamais au tapis',       'survivant',       0,  'Survit une fois à un coup fatal avec 1 PV.'),
  ('aura-de-star',    'Aura de star',          'aura',            10, 'Toute l''équipe gagne 10 % de Puissance.'),
  ('flow-chirurgical','Flow chirurgical',      'concentration',   0,  'Ses attaques ne ratent jamais.')
on conflict (id) do nothing;

-- Les 12 crews de l'Arène : des artistes choisis par notoriété (rang parmi tous les artistes), de plus en plus haut.
insert into public.combat_arene (palier, nom, description, artist1, rarete1, artist2, rarete2, bonus, recompense)
select v.palier, v.nom, v.description, a.artist_id, v.r, b.artist_id, v.r, v.bonus, v.rec
  from (values
    (1,  'Les Premiers Couplets',      'Des débutants motivés, parfait pour s''échauffer.',                   600, 601, 1, 0,  1),
    (2,  'Cypher du Quartier',         'Ça rappe au pied de l''immeuble, sans filet.',                         450, 451, 1, 5,  1),
    (3,  'Open Mic de Province',       'La scène locale a de la ressource.',                                   350, 351, 2, 0,  1),
    (4,  'Les Beatmakers',             'Ils produisent, ils rappent, ils frappent.',                           250, 251, 2, 8,  1),
    (5,  'Bande à Part',               'Un duo soudé qui ne connaît que ses propres règles.',                  160, 161, 3, 0,  2),
    (6,  'Studio Nuit Blanche',        'Des enregistrements jusqu''à l''aube, des nerfs d''acier.',            110, 111, 3, 8,  2),
    (7,  'La Dream Team Régionale',    'Le meilleur de chaque région, réuni pour te battre.',                  70,  71,  3, 15, 2),
    (8,  'Les Têtes d''Affiche',       'Des noms qui remplissent les salles.',                                 40,  41,  4, 0,  2),
    (9,  'Chaîne de Montage Platine',  'Les disques s''enchaînent, les victoires aussi.',                      22,  23,  4, 10, 3),
    (10, 'Légendes Vivantes',          'Ils ont écrit les pages du rap français.',                             12,  13,  4, 20, 3),
    (11, 'Les Intouchables',           'Personne ne les a battus depuis des années.',                          6,   7,   5, 10, 3),
    (12, 'Le Sommet',                  'Le duo ultime : bats-les et tu es au sommet de la scène.',             1,   2,   5, 25, 4)
  ) as v (palier, nom, description, rang1, rang2, r, bonus, rec)
  join (select artist_id, row_number() over (order by fans desc, artist_id) as rn from public.jeu_cartes where active) a on a.rn = v.rang1
  join (select artist_id, row_number() over (order by fans desc, artist_id) as rn from public.jeu_cartes where active) b on b.rn = v.rang2
on conflict (palier) do nothing;
