-- Wave Cards : le combat 2v2, nouveau moteur — les données (2026-10-27).
-- Remplace le combat « au tour par tour » (sql/combat-moteur.sql) par un combat à JAUGE DE TOUR : chaque carte remplit une
-- jauge selon sa Vitesse et joue quand elle est pleine. Une carte a un RÔLE (6), 3 TECHNIQUES (la 1re toujours prête, les deux
-- autres avec un temps de recharge) et, pour les Légendaires et Mythiques, un PASSIF. Tout est calculé par défaut et peut être
-- surchargé par l'équipe, artiste par artiste (combat_surcharges). Les catalogues sont des tables que l'équipe modifie.
-- Toutes les tables ont la RLS sans politique : seules les fonctions SECURITY DEFINER y touchent.

-- 1. Les six rôles. Les multiplicateurs ajustent les statistiques par défaut (PV, Puissance, Défense, Vitesse).
create table if not exists public.combat_roles (
  id text primary key,
  nom text not null,
  resume text not null,
  ordre integer not null,
  m_pv numeric(4,2) not null default 1,
  m_pui numeric(4,2) not null default 1,
  m_def numeric(4,2) not null default 1,
  m_vit numeric(4,2) not null default 1
);

insert into public.combat_roles (id, nom, resume, ordre, m_pv, m_pui, m_def, m_vit) values
  ('lyriciste', 'Lyriciste',  'Gros dégâts sur une seule cible.',                          1, 0.90, 1.15, 0.90, 1.00),
  ('pilier',    'Pilier',     'Encaisse les coups et protège ses alliés.',                  2, 1.35, 0.90, 1.30, 0.90),
  ('beatmaker', 'Beatmaker',  'Soigne et purifie l''équipe.',                               3, 1.10, 0.95, 1.00, 1.00),
  ('hypeman',   'Hype man',   'Bonus d''attaque, de vitesse et de jauge pour le duo.',      4, 1.00, 1.00, 1.00, 1.15),
  ('clasheur',  'Clasheur',   'Étourdit, gèle ou ralentit les adversaires.',                5, 0.95, 0.95, 0.95, 1.10),
  ('briseur',   'Briseur',    'Casse les défenses et frappe plusieurs adversaires.',        6, 1.00, 1.05, 0.95, 1.00)
on conflict (id) do update set nom = excluded.nom, resume = excluded.resume, ordre = excluded.ordre,
  m_pv = excluded.m_pv, m_pui = excluded.m_pui, m_def = excluded.m_def, m_vit = excluded.m_vit;

-- 2. Les techniques. slot : 1 = de base (toujours prête), 2 = spéciale, 3 = ultime. type vide = le style de la carte qui la lance
-- (donc ▲ super efficace / ▼ peu efficace et bonus de même style suivent la carte). cible : ennemi, ennemis, allie (soi compris),
-- allies (tout le duo), soi. perce : % de Défense ignorée. effets : liste de {k, v, d, chance, sur} avec
--   k : soin (v % des PV max de la cible), bouclier (v % des PV max), vampirisme / recul (v % des dégâts infligés),
--       pui+ pui- def+ def- vit+ vit- (v % pendant d tours de la cible), etourdi, gel (la cible passe son prochain tour),
--       brulure, poison (v % des PV max par tour pendant d tours), regen (soin v % par tour), marque (v % de dégâts subis en plus),
--       provoc (les adversaires doivent la viser), purif (retire statuts négatifs), jauge+ / jauge- (v points de jauge sur 100) ;
--   sur : cible (par défaut), soi, allies, ennemis ; chance : % (100 par défaut).
create table if not exists public.combat_techniques (
  id text primary key,
  nom text not null,
  role text not null references public.combat_roles(id) on update cascade,
  slot smallint not null check (slot between 1 and 3),
  type text references public.combat_types(id) on delete set null on update cascade,
  puissance integer not null default 0 check (puissance between 0 and 250),
  hits smallint not null default 1 check (hits between 1 and 4),
  justesse integer not null default 100 check (justesse between 1 and 100),
  cible text not null default 'ennemi' check (cible in ('ennemi', 'ennemis', 'allie', 'allies', 'soi')),
  recharge smallint not null default 0 check (recharge between 0 and 9),
  perce integer not null default 0 check (perce between 0 and 100),
  effets jsonb not null default '[]'::jsonb,
  description text not null default '',
  actif boolean not null default true
);

insert into public.combat_techniques (id, nom, role, slot, puissance, hits, justesse, cible, recharge, perce, effets, description) values
  -- Lyriciste
  ('ly-punchline',   'Punchline',               'lyriciste', 1, 58, 1, 95,  'ennemi',  0, 0,  '[]', 'Une phrase, une cible, un silence.'),
  ('ly-couplet',     'Couplet tranchant',       'lyriciste', 1, 54, 1, 100, 'ennemi',  0, 0,  '[{"k":"def-","v":10,"d":2,"chance":30}]', 'Un couplet qui peut faire baisser la garde.'),
  ('ly-flow',        'Flow éclair',             'lyriciste', 1, 30, 2, 95,  'ennemi',  0, 0,  '[]', 'Deux coups de micro d''affilée.'),
  ('ly-refrain',     'Refrain assassin',        'lyriciste', 2, 92, 1, 90,  'ennemi',  3, 0,  '[]', 'Un refrain qui ne laisse aucune chance.'),
  ('ly-diss',        'Diss track',              'lyriciste', 2, 76, 1, 90,  'ennemi',  3, 0,  '[{"k":"pui-","v":20,"d":2}]', 'Un morceau qui vise juste et affaiblit sa cible.'),
  ('ly-freestyle',   'Freestyle sans filet',    'lyriciste', 2, 40, 3, 90,  'ennemi',  3, 0,  '[]', 'Trois rimes improvisées, sans respirer.'),
  ('ly-tube',        'Tube de l''été',          'lyriciste', 3, 125, 1, 85, 'ennemi',  5, 0,  '[{"k":"marque","v":25,"d":2}]', 'Le hit qui écrase tout, et marque sa cible.'),
  ('ly-clash',       'Clash du siècle',         'lyriciste', 3, 112, 1, 88, 'ennemi',  5, 0,  '[{"k":"vampirisme","v":30}]', 'Un clash qui redonne de l''énergie.'),
  ('ly-couronne',    'Couronne de la scène',    'lyriciste', 3, 108, 1, 90, 'ennemi',  5, 0,  '[{"k":"pui+","v":25,"d":2,"sur":"soi"}]', 'Sacrée sur scène : la Puissance monte.'),
  -- Pilier
  ('pi-epaule',      'Épaule de quartier',      'pilier',    1, 46, 1, 100, 'ennemi',  0, 0,  '[]', 'Un coup d''épaule sans fioriture.'),
  ('pi-posture',     'Posture de caïd',         'pilier',    1, 38, 1, 100, 'ennemi',  0, 0,  '[{"k":"def+","v":15,"d":2,"sur":"soi"}]', 'Le torse bombé : la Défense monte.'),
  ('pi-mur',         'Mur du son',              'pilier',    1, 42, 1, 100, 'ennemi',  0, 0,  '[{"k":"pui-","v":10,"d":2,"chance":35}]', 'Un mur de basses qui peut affaiblir.'),
  ('pi-rempart',     'Rempart du crew',         'pilier',    2, 0,  1, 100, 'soi',     3, 0,  '[{"k":"bouclier","v":30,"d":3},{"k":"provoc","d":2}]', 'Un bouclier, et tous les regards sur lui.'),
  ('pi-couvrir',     'Couvrir les arrières',    'pilier',    2, 0,  1, 100, 'allie',   3, 0,  '[{"k":"bouclier","v":28,"d":3}]', 'Un bouclier pour un allié.'),
  ('pi-provoc',      'Provocation',             'pilier',    2, 40, 1, 100, 'ennemi',  3, 0,  '[{"k":"provoc","d":2,"sur":"soi"}]', 'Il attire les coups sur lui.'),
  ('pi-blindage',    'Blindage total',          'pilier',    3, 0,  1, 100, 'allies',  5, 0,  '[{"k":"bouclier","v":30,"d":3},{"k":"def+","v":20,"d":3}]', 'Tout le duo est protégé.'),
  ('pi-contre',      'Contre-attaque du quartier','pilier',  3, 82, 1, 95,  'ennemi',  5, 0,  '[{"k":"def+","v":25,"d":3,"sur":"soi"}]', 'Il encaisse et rend le coup, en plus solide.'),
  ('pi-impact',      'Impact de scène',         'pilier',    3, 92, 1, 90,  'ennemi',  5, 0,  '[{"k":"etourdi","d":1,"chance":40}]', 'Un choc qui peut étourdir.'),
  -- Beatmaker
  ('be-kick',        'Coup de kick',            'beatmaker', 1, 52, 1, 100, 'ennemi',  0, 0,  '[]', 'Une grosse caisse en plein cœur.'),
  ('be-sample',      'Sample malin',            'beatmaker', 1, 50, 1, 100, 'ennemi',  0, 0,  '[{"k":"soin","v":8,"sur":"soi"}]', 'Un bout de vieux tube qui remonte le moral.'),
  ('be-caisse',      'Caisse claire',           'beatmaker', 1, 50, 1, 100, 'ennemi',  0, 0,  '[{"k":"jauge-","v":15,"chance":50}]', 'Un claquement qui casse le rythme adverse.'),
  ('be-berceuse',    'Mélodie apaisante',       'beatmaker', 2, 0,  1, 100, 'allie',   3, 0,  '[{"k":"soin","v":38}]', 'Rend un tiers de ses PV à un allié.'),
  ('be-mixage',      'Mixage propre',           'beatmaker', 2, 0,  1, 100, 'allie',   3, 0,  '[{"k":"purif"},{"k":"soin","v":15}]', 'Efface les parasites et soigne un peu.'),
  ('be-boucle',      'Boucle réparatrice',      'beatmaker', 2, 0,  1, 100, 'allie',   3, 0,  '[{"k":"regen","v":10,"d":3}]', 'Une boucle qui soigne tour après tour.'),
  ('be-mastering',   'Mastering parfait',       'beatmaker', 3, 0,  1, 100, 'allies',  5, 0,  '[{"k":"soin","v":30},{"k":"purif"}]', 'Tout le duo est soigné et purifié.'),
  ('be-remix',       'Remix salvateur',         'beatmaker', 3, 0,  1, 100, 'allies',  5, 0,  '[{"k":"soin","v":22},{"k":"regen","v":8,"d":3}]', 'Un remix qui remet tout le monde d''aplomb.'),
  ('be-drop',        'Drop libérateur',         'beatmaker', 3, 0,  1, 100, 'allies',  5, 0,  '[{"k":"soin","v":25},{"k":"jauge+","v":20}]', 'Le drop qui relance tout le duo.'),
  -- Hype man
  ('hy-chauffer',    'Chauffer la salle',       'hypeman',   1, 50, 1, 100, 'ennemi',  0, 0,  '[{"k":"pui+","v":10,"d":2,"sur":"allies","chance":50}]', 'La salle chauffe : le duo peut gagner en Puissance.'),
  ('hy-cri',         'Cri de ralliement',       'hypeman',   1, 50, 1, 100, 'ennemi',  0, 0,  '[{"k":"vit+","v":10,"d":2,"sur":"soi"}]', 'Un cri qui donne de l''élan.'),
  ('hy-adlibs',      'Ad-libs',                 'hypeman',   1, 50, 1, 100, 'ennemi',  0, 0,  '[{"k":"jauge+","v":12,"sur":"allies","chance":60}]', 'Skrrt ! Skrrt ! La jauge du duo monte.'),
  ('hy-tempo',       'Accélérer le tempo',      'hypeman',   2, 0,  1, 100, 'allies',  3, 0,  '[{"k":"vit+","v":25,"d":3}]', 'Tout le duo joue plus vite.'),
  ('hy-hype',        'Hype collective',         'hypeman',   2, 0,  1, 100, 'allies',  3, 0,  '[{"k":"pui+","v":25,"d":3}]', 'Tout le duo frappe plus fort.'),
  ('hy-micro',       'Passe le micro',          'hypeman',   2, 0,  1, 100, 'allie',   3, 0,  '[{"k":"jauge+","v":60},{"k":"pui+","v":15,"d":2}]', 'Un allié reprend la main immédiatement.'),
  ('hy-festival',    'Festival total',          'hypeman',   3, 0,  1, 100, 'allies',  5, 0,  '[{"k":"pui+","v":25,"d":3},{"k":"vit+","v":20,"d":3}]', 'Puissance et Vitesse montent pour le duo.'),
  ('hy-rappel',      'Rappel général',          'hypeman',   3, 0,  1, 100, 'allies',  5, 0,  '[{"k":"jauge+","v":45},{"k":"regen","v":6,"d":3}]', 'Le public en redemande : la jauge du duo bondit.'),
  ('hy-feat',        'Feat surprise',           'hypeman',   3, 0,  1, 100, 'allie',   5, 0,  '[{"k":"jauge+","v":100},{"k":"pui+","v":30,"d":2}]', 'Un invité de dernière minute prend le micro tout de suite.'),
  -- Clasheur
  ('cl-pique',       'Pique bien placée',       'clasheur',  1, 50, 1, 100, 'ennemi',  0, 0,  '[{"k":"vit-","v":15,"d":2,"chance":35}]', 'Une pique qui peut ralentir.'),
  ('cl-silence',     'Silence radio',           'clasheur',  1, 46, 1, 100, 'ennemi',  0, 0,  '[{"k":"etourdi","d":1,"chance":12}]', 'Un blanc qui peut figer l''adversaire.'),
  ('cl-regard',      'Regard glacial',          'clasheur',  1, 48, 1, 100, 'ennemi',  0, 0,  '[{"k":"vit-","v":20,"d":2,"chance":30}]', 'Un regard qui coupe l''élan.'),
  ('cl-gel',         'Gel d''ambiance',         'clasheur',  2, 62, 1, 95,  'ennemi',  3, 0,  '[{"k":"gel","d":1,"chance":45}]', 'L''ambiance se glace : il peut sauter son tour.'),
  ('cl-bruit',       'Bruit blanc',             'clasheur',  2, 55, 1, 95,  'ennemi',  3, 0,  '[{"k":"etourdi","d":1,"chance":45}]', 'Un bruit blanc qui étourdit souvent.'),
  ('cl-ralenti',     'Ralentir la prod',        'clasheur',  2, 40, 1, 95,  'ennemis', 3, 0,  '[{"k":"vit-","v":25,"d":3}]', 'Les deux adversaires perdent de la Vitesse.'),
  ('cl-blackout',    'Black-out',               'clasheur',  3, 60, 1, 95,  'ennemis', 5, 0,  '[{"k":"etourdi","d":1,"chance":40}]', 'Plus de lumière : chaque adversaire peut être étourdi.'),
  ('cl-banc',        'Banc de touche',          'clasheur',  3, 95, 1, 90,  'ennemi',  5, 0,  '[{"k":"gel","d":1,"chance":55}]', 'Un coup qui envoie sur le banc.'),
  ('cl-mute',        'Mute général',            'clasheur',  3, 78, 1, 90,  'ennemi',  5, 0,  '[{"k":"etourdi","d":1,"chance":55},{"k":"pui-","v":20,"d":2}]', 'Plus un son : étourdi et affaibli.'),
  -- Briseur
  ('br-rafale',      'Rafale de barres',        'briseur',   1, 36, 1, 95,  'ennemis', 0, 0,  '[]', 'Touche les deux adversaires.'),
  ('br-brise',       'Brise-glace',             'briseur',   1, 48, 1, 100, 'ennemi',  0, 20, '[{"k":"def-","v":15,"d":3,"chance":60}]', 'Fissure la défense de sa cible.'),
  ('br-percussion',  'Percussion sèche',        'briseur',   1, 50, 1, 100, 'ennemi',  0, 30, '[]', 'Passe à travers une partie de la Défense.'),
  ('br-onde',        'Onde de choc',            'briseur',   2, 65, 1, 95,  'ennemis', 3, 0,  '[{"k":"def-","v":15,"d":3}]', 'Touche les deux adversaires et casse leur Défense.'),
  ('br-demolition',  'Démolition',              'briseur',   2, 84, 1, 90,  'ennemi',  3, 40, '[{"k":"def-","v":25,"d":3}]', 'Ignore une grosse part de la Défense.'),
  ('br-cassure',     'Cassure de rythme',       'briseur',   2, 70, 1, 95,  'ennemi',  3, 0,  '[{"k":"marque","v":20,"d":3}]', 'La cible subit plus de dégâts un moment.'),
  ('br-final',       'Final éclatant',          'briseur',   3, 90, 1, 90,  'ennemis', 5, 25, '[{"k":"marque","v":20,"d":3}]', 'Un final qui frappe tout le monde.'),
  ('br-bigbang',     'Big bang',                'briseur',   3, 120, 1, 85, 'ennemi',  5, 50, '[]', 'Ignore la moitié de la Défense.'),
  ('br-saccage',     'Saccager la scène',       'briseur',   3, 75, 1, 90,  'ennemis', 5, 0,  '[{"k":"def-","v":30,"d":3},{"k":"brulure","v":5,"d":3,"chance":60}]', 'Tout brûle, tout casse.')
on conflict (id) do update set nom = excluded.nom, role = excluded.role, slot = excluded.slot, type = excluded.type, puissance = excluded.puissance,
  hits = excluded.hits, justesse = excluded.justesse, cible = excluded.cible, recharge = excluded.recharge, perce = excluded.perce,
  effets = excluded.effets, description = excluded.description;

-- 3. Les passifs (réservés aux Légendaires et Mythiques, sauf réglage de l'équipe). Trois nouveaux codes : rythme (démarre avec de la
-- jauge), bouclier (démarre protégé), rage (plus de Puissance sous la moitié des PV).
alter table public.combat_capacites drop constraint if exists combat_capacites_code_check;
alter table public.combat_capacites add constraint combat_capacites_code_check
  check (code in ('regeneration', 'epines', 'sang_froid', 'ouverture', 'dernier_souffle', 'survivant', 'aura', 'concentration', 'rythme', 'bouclier', 'rage'));
insert into public.combat_capacites (id, nom, code, valeur, description) values
  ('bon-rythme',      'Bon rythme',        'rythme',  40, 'Démarre le combat avec 40 % de jauge.'),
  ('armure-de-scene', 'Armure de scène',   'bouclier', 20, 'Démarre le combat avec un bouclier de 20 % des PV.'),
  ('rage-de-vaincre', 'Rage de vaincre',   'rage',    30, 'Sous la moitié de ses PV, gagne 30 % de Puissance.')
on conflict (id) do nothing;
update public.combat_capacites set description = 'Récupère 6 % de ses PV au début de chacun de ses tours.' where id = 'second-souffle';

-- 4. Les surcharges de l'équipe : rôle et trois techniques à la place des deux attaques.
alter table public.combat_surcharges drop column if exists atk1;
alter table public.combat_surcharges drop column if exists atk2;
alter table public.combat_surcharges add column if not exists role text references public.combat_roles(id) on delete set null on update cascade;
alter table public.combat_surcharges add column if not exists tech1 text references public.combat_techniques(id) on delete set null on update cascade;
alter table public.combat_surcharges add column if not exists tech2 text references public.combat_techniques(id) on delete set null on update cascade;
alter table public.combat_surcharges add column if not exists tech3 text references public.combat_techniques(id) on delete set null on update cascade;
drop table if exists public.combat_attaques cascade;

-- 5. Cinq équipes enregistrées par joueur.
create table if not exists public.combat_duos_sauves (
  user_id uuid not null references public.profiles(id) on delete cascade,
  slot smallint not null check (slot between 1 and 5),
  nom text not null check (char_length(nom) between 1 and 30),
  duo jsonb not null,
  maj_le timestamptz not null default now(),
  primary key (user_id, slot)
);

-- 6. Le registre des modes. Un mode a un identifiant (celui de combat_parties.mode) et, s'il verse des gains, une fonction de fin
-- (public.<nom>(p_partie uuid, p_victoire boolean, p_abandon boolean) returns jsonb, dont le nom commence par combat_fin_ : les gains à afficher) que combat_conclure appelle.
create table if not exists public.combat_modes (
  id text primary key check (id ~ '^[a-z][a-z0-9_-]{1,29}$'),
  nom text not null,
  fonction_fin text check (fonction_fin is null or fonction_fin ~ '^combat_fin_[a-z0-9_]{1,50}$'),
  actif boolean not null default true
);
insert into public.combat_modes (id, nom) values
  ('arene', 'Arène'), ('defi', 'Défi du jour'), ('pvp', 'Défi entre joueurs'), ('entrainement', 'Entraînement')
on conflict (id) do nothing;

-- 7. Les parties : modes ouverts (voir combat_modes), titre, décor, options et état de la jauge.
alter table public.combat_parties drop constraint if exists combat_parties_mode_check;
alter table public.combat_parties add constraint combat_parties_mode_check check (mode ~ '^[a-z][a-z0-9_-]{1,29}$');
alter table public.combat_parties add column if not exists titre text;
alter table public.combat_parties add column if not exists decor text;
alter table public.combat_parties add column if not exists options jsonb not null default '{}'::jsonb;
alter table public.combat_parties add column if not exists jeu jsonb not null default '{}'::jsonb;
alter table public.combat_parties add column if not exists moteur smallint not null default 1;
update public.combat_parties set etat = 'expire', fin = coalesce(fin, now()) where etat = 'en_cours' and moteur = 1;
alter table public.combat_parties alter column moteur set default 2;

alter table public.combat_roles enable row level security;
alter table public.combat_techniques enable row level security;
alter table public.combat_duos_sauves enable row level security;
alter table public.combat_modes enable row level security;
