-- Wave Cards : les Rivaux et le Prestige — les données (2026-10-28).
-- Deux modes de combat contre le jeu qui s'appuient sur le moteur v2 (sql/combat-v2-*.sql) :
--   · les RIVAUX (rivaux)   : six rivaux nommés, chacun avec une courte histoire. Trois niveaux (Normal, Difficile, Légendaire), chaque niveau est
--                             une SÉRIE de 3 duels (manches) de plus en plus durs ; la rivalité progresse à chaque série terminée et débloque
--                             un chapitre de l'histoire. Récompense à chaque manche gagnée pour la première fois, à la fin de chaque série,
--                             et un petit gain par rival et par jour.
--   · le PRESTIGE (prestige): les huit champions de style reviennent, 15 niveaux chacun, armés de MALÉDICTIONS (bonus de stats ou passifs
--                             posés sur leurs cartes). Une fois les 15 niveaux vaincus, le joueur peut RENAÎTRE : la progression de ce champion
--                             repart de zéro (remise à zéro douce), il garde ses titres, gagne une étoile, et les niveaux deviennent plus
--                             durs (stats et malédiction en plus) mais plus généreux.
-- Les fonctions sont dans sql/combat-rivaux-jeu.sql. Tout se règle depuis la console de l'équipe (onglet « Rivaux & Prestige »).
-- Toutes les tables ont la RLS sans politique : seules les fonctions SECURITY DEFINER y touchent.

-- 1. Les réglages numériques des deux modes.
create table if not exists public.combat_rivaux_reglages (
  cle text primary key,
  valeur integer not null check (valeur between 0 and 5000),
  libelle text not null,
  ordre integer not null default 0
);
insert into public.combat_rivaux_reglages (cle, valeur, libelle, ordre) values
  ('rivaux_jour_wc',          20, 'Rivaux : Wave Coins pour une victoire par rival et par jour', 1),
  ('rivaux_titre_wc',        150, 'Rivaux : Wave Coins pour les six rivaux Légendaires',         2),
  ('rivaux_titre_vinyles',     5, 'Rivaux : vinyles pour les six rivaux Légendaires',            3),
  ('prestige_niveaux',        15, 'Prestige : niveaux par champion',                             4),
  ('prestige_bonus_base',     20, 'Prestige : bonus de stats au niveau 0 (%)',                   5),
  ('prestige_bonus_niveau',    6, 'Prestige : bonus de stats par niveau (%)',                    6),
  ('prestige_bonus_renaiss',  10, 'Prestige : bonus de stats par renaissance (%)',               7),
  ('prestige_wc_base',        20, 'Prestige : Wave Coins de base à la 1re victoire d''un niveau', 8),
  ('prestige_wc_niveau',       4, 'Prestige : Wave Coins en plus par niveau',                    9),
  ('prestige_gain_renaiss',   25, 'Prestige : gains en plus par renaissance (%)',               10),
  ('prestige_renaiss_max',     5, 'Prestige : renaissances possibles par champion',             11),
  ('prestige_renaiss_wc',    150, 'Prestige : Wave Coins par renaissance (× son numéro)',       12),
  ('prestige_renaiss_vinyles', 2, 'Prestige : vinyles à chaque renaissance',                    13),
  ('prestige_champion_wc',   100, 'Prestige : Wave Coins pour un champion terminé (15 niveaux)', 14),
  ('prestige_champion_vinyles', 2, 'Prestige : vinyles pour un champion terminé',               15)
on conflict (cle) do nothing;

-- 2. Les Rivaux. histoire : 4 textes (présentation, puis un chapitre débloqué par niveau terminé).
create table if not exists public.combat_rivaux (
  id text primary key check (id ~ '^[a-z][a-z0-9_]{1,19}$'),
  nom text not null,
  surnom text not null default '',
  histoire jsonb not null default '[]'::jsonb,
  replique text not null default '',
  artist1 uuid not null references public.jeu_cartes(artist_id) on delete cascade,
  artist2 uuid not null references public.jeu_cartes(artist_id) on delete cascade,
  decor text not null default 'studio' check (decor in ('studio', 'concert', 'plateau', 'ruelle', 'toit')),
  ordre integer not null default 0,
  actif boolean not null default true
);
-- Les trois niveaux (communs aux six rivaux) : stats de l'adversaire, récompenses.
create table if not exists public.combat_rivaux_niveaux (
  niveau integer primary key check (niveau between 1 and 3),
  nom text not null,
  bonus_base integer not null check (bonus_base between 0 and 300),
  bonus_manche integer not null check (bonus_manche between 0 and 100),
  rarete integer not null check (rarete between 1 and 5),
  wc_manche integer not null check (wc_manche between 0 and 5000),
  wc_serie integer not null check (wc_serie between 0 and 5000),
  vinyles_serie integer not null check (vinyles_serie between 0 and 50)
);
insert into public.combat_rivaux_niveaux (niveau, nom, bonus_base, bonus_manche, rarete, wc_manche, wc_serie, vinyles_serie) values
  (1, 'Normal',      5,  4, 3,  10,  60, 1),
  (2, 'Difficile',  30,  6, 4,  20, 120, 2),
  (3, 'Légendaire', 60,  8, 5,  35, 250, 3)
on conflict (niveau) do nothing;
-- Où en est chaque joueur : manches gagnées (0 à 3) dans la série d'un rival à un niveau.
create table if not exists public.combat_rivaux_progres (
  user_id uuid not null references public.profiles(id) on delete cascade,
  rival text not null references public.combat_rivaux(id) on delete cascade on update cascade,
  niveau integer not null check (niveau between 1 and 3),
  manches integer not null default 0 check (manches between 0 and 3),
  serie_faite boolean not null default false,
  victoires integer not null default 0,
  defaites integer not null default 0,
  maj timestamptz not null default now(),
  primary key (user_id, rival, niveau)
);
-- Le gain quotidien : une victoire par rival et par jour.
create table if not exists public.combat_rivaux_jour (
  user_id uuid not null references public.profiles(id) on delete cascade,
  rival text not null references public.combat_rivaux(id) on delete cascade on update cascade,
  jour date not null,
  primary key (user_id, rival, jour)
);

-- 3. Le Prestige : la bibliothèque de malédictions. genre 'stat' : cible pv / pui / def / vit, valeur en % ; genre 'cap' : cible = code de
-- passif du moteur (rythme, bouclier, epines, sang_froid, rage, survivant, regeneration, dernier_souffle), valeur du passif.
create table if not exists public.combat_prestige_maledictions (
  id text primary key check (id ~ '^[a-z][a-z0-9_-]{1,29}$'),
  nom text not null,
  description text not null,
  genre text not null check (genre in ('stat', 'cap')),
  cible text not null,
  valeur integer not null check (valeur between 0 and 300),
  check ((genre = 'stat' and cible in ('pv', 'pui', 'def', 'vit'))
      or (genre = 'cap' and cible in ('rythme', 'bouclier', 'epines', 'sang_froid', 'rage', 'survivant', 'regeneration', 'dernier_souffle', 'ouverture', 'concentration')))
);
insert into public.combat_prestige_maledictions (id, nom, description, genre, cible, valeur) values
  ('colosse',        'Colosse',         'Ses cartes ont 25 % de PV en plus.',                           'stat', 'pv',  25),
  ('tranchant',      'Flow tranchant',  'Ses cartes frappent 20 % plus fort.',                          'stat', 'pui', 20),
  ('blindage',       'Blindage',        'Ses cartes ont 25 % de Défense en plus.',                      'stat', 'def', 25),
  ('fulgurant',      'Fulgurant',       'Ses cartes sont 20 % plus rapides.',                           'stat', 'vit', 20),
  ('epines-vives',   'Épines vives',    'Une carte renvoie 20 % des dégâts reçus.',                     'cap',  'epines', 20),
  ('froid-glacial',  'Sang-froid',      'Une carte est insensible aux statuts néfastes.',               'cap',  'sang_froid', 1),
  ('armure-maudite', 'Armure maudite',  'Une carte démarre avec un bouclier de 30 % de ses PV.',        'cap',  'bouclier', 30),
  ('rythme-infernal','Rythme infernal', 'Une carte démarre avec 50 % de jauge.',                        'cap',  'rythme', 50),
  ('furie',          'Furie',           'Une carte gagne 40 % de Puissance sous la moitié de ses PV.',  'cap',  'rage', 40),
  ('revenant',       'Revenant',        'Une carte survit une fois à un coup fatal avec 1 PV.',         'cap',  'survivant', 1),
  ('second-souffle', 'Second souffle',  'Une carte récupère 6 % de ses PV à chacun de ses tours.',      'cap',  'regeneration', 6),
  ('dernier-cri',    'Dernier cri',     'Une carte met à terre 25 % de ses PV max en dégâts en tombant.', 'cap', 'dernier_souffle', 25)
on conflict (id) do nothing;
-- Les six malédictions de chaque champion, dans l'ordre où elles s'ajoutent (niveaux 1, 5, 9, 13, puis une par renaissance).
create table if not exists public.combat_prestige_champions (
  champion text primary key references public.combat_champions(id) on delete cascade on update cascade,
  maledictions text[] not null default '{}'
);
insert into public.combat_prestige_champions (champion, maledictions)
select c.id, case c.type
    when 'drill'     then array['tranchant', 'fulgurant', 'rythme-infernal', 'epines-vives', 'dernier-cri', 'colosse']
    when 'trap'      then array['fulgurant', 'rythme-infernal', 'tranchant', 'armure-maudite', 'furie', 'blindage']
    when 'boombap'   then array['blindage', 'second-souffle', 'colosse', 'froid-glacial', 'epines-vives', 'tranchant']
    when 'cloud'     then array['froid-glacial', 'fulgurant', 'second-souffle', 'revenant', 'colosse', 'rythme-infernal']
    when 'pop'       then array['colosse', 'second-souffle', 'tranchant', 'armure-maudite', 'fulgurant', 'furie']
    when 'conscient' then array['blindage', 'colosse', 'epines-vives', 'second-souffle', 'revenant', 'froid-glacial']
    when 'rue'       then array['tranchant', 'epines-vives', 'furie', 'blindage', 'dernier-cri', 'fulgurant']
    else                  array['fulgurant', 'colosse', 'rythme-infernal', 'second-souffle', 'furie', 'armure-maudite']
  end
  from public.combat_champions c
on conflict (champion) do nothing;
-- Où en est chaque joueur chez chaque champion : niveau atteint dans la renaissance en cours, étoiles de renaissance.
create table if not exists public.combat_prestige_progres (
  user_id uuid not null references public.profiles(id) on delete cascade,
  champion text not null references public.combat_champions(id) on delete cascade on update cascade,
  niveau_max integer not null default 0 check (niveau_max >= 0),
  renaissances integer not null default 0 check (renaissances >= 0),
  victoires integer not null default 0,
  defaites integer not null default 0,
  maj timestamptz not null default now(),
  primary key (user_id, champion)
);

alter table public.combat_rivaux_reglages enable row level security;
alter table public.combat_rivaux enable row level security;
alter table public.combat_rivaux_niveaux enable row level security;
alter table public.combat_rivaux_progres enable row level security;
alter table public.combat_rivaux_jour enable row level security;
alter table public.combat_prestige_maledictions enable row level security;
alter table public.combat_prestige_champions enable row level security;
alter table public.combat_prestige_progres enable row level security;

-- 4. Les modes au registre du hub (voir l'en-tête de sql/combat-v2-jeu.sql). Les fonctions de fin sont dans combat-rivaux-jeu.sql.
insert into public.combat_modes (id, nom, fonction_fin) values
  ('rivaux', 'Rivaux', 'combat_fin_rivaux'),
  ('prestige', 'Prestige', 'combat_fin_prestige')
on conflict (id) do nothing;

-- 5. Les six rivaux : des personnages inventés, joués par des artistes du catalogue (le 5e et le 6e les plus connus d'un style, pour ne
-- pas recouper les champions ni la Ligue).
insert into public.combat_rivaux (id, nom, surnom, histoire, replique, artist1, artist2, decor, ordre)
select v.id, v.nom, v.surnom, v.histoire, v.replique, s.a5, s.a6, v.decor, v.ordre
  from (values
    ('max', 'Max Delcourt', 'L''ami d''enfance',
     '["Vous avez grandi dans la même cité, sur le même banc. Max a pris le micro le jour où tu as pris le tien, et il ne t''a jamais pardonné d''être arrivé second au premier concours du quartier.",
       "Il a perdu, mais il sourit : « Tu as encore ton flow de 2015. Moi, j''ai appris à écrire. » Il veut sa revanche, plus sérieusement cette fois.",
       "Il s''est entraîné en secret pendant des mois. Cette fois, ce n''est plus un jeu : il te regarde dans les yeux avant chaque couplet.",
       "Max range son carnet de textes. « On a gagné chacun notre tour. Disons que le banc est à nous deux. » Une vraie rivalité, ça se termine en amitié."]'::jsonb,
     'On a grandi ensemble. Ce soir, un seul de nous deux rentre avec le titre.', 'rue', 'ruelle', 1),
    ('yasmine', 'Yasmine Belkacem', 'La plume de fer',
     '["Yasmine écrit ses textes à la main, dans un cahier d''écolière, et elle les récite sans une hésitation. Elle trouve que ton style manque de fond.",
       "Tu l''as surprise sur son terrain. Elle relit ses vers : « Pas mal… pour quelqu''un qui improvise. » Elle ajoute trois pages à son cahier.",
       "Elle revient avec ses textes les plus tranchants. Chaque rime est une pique, chaque silence un piège.",
       "Elle te tend son cahier, ouvert à la dernière page, où ton nom figure en gras. « Mon meilleur adversaire. Garde-le. »"]'::jsonb,
     'Chaque mot que j''écris a été pesé. Les tiens, je les ai déjà démontés.', 'boombap', 'studio', 2),
    ('tony', 'Tony Rossi', 'Le roi du refrain',
     '["Tony ne sort pas un morceau sans refrain que tout le monde chante dans le métro. Il te trouve talentueux, mais « introuvable à la radio ».",
       "Même lui a dû reconnaître que ton duo accroche. Il fredonne ton couplet malgré lui et ça l''énerve beaucoup.",
       "Il a engagé des choristes, un orchestre et trois cents figurants. Il compte t''écraser sous la production.",
       "Dans les coulisses, Tony chante ton refrain à voix basse. « Si un jour tu veux un featuring… » Il n''a pas fini sa phrase."]'::jsonb,
     'Un bon morceau, ça se chante sous la douche. Le tien, c''est du bruit de fond.', 'pop', 'plateau', 3),
    ('dalila', 'Dalila Okonkwo', 'La reine des îles',
     '["Dalila fait danser trois continents. Pour elle, une carte qui ne fait pas bouger les gens est une carte morte, et la tienne l''est à moitié.",
       "Tu as tenu le rythme, ce que peu osent faire. Elle rit, enlève ses lunettes et te demande ton nom, enfin.",
       "Elle revient avec ses percussions et un public déjà debout. Impossible de perdre le tempo une seconde.",
       "Elle t''invite chez elle, là où tout a commencé. « Le rythme, ça ne se bat pas. Ça se partage. »"]'::jsonb,
     'Le tempo, c''est moi qui le donne. Essaie de suivre.', 'afro', 'concert', 4),
    ('brume', 'Le Brouillard', 'Le fantôme du cloud',
     '["Personne ne connaît son vrai nom. Il publie à trois heures du matin, voix voilée, sans jamais montrer son visage. Il paraît qu''il t''écoute depuis le début.",
       "Il apparaît enfin, vaincu, dans la lumière bleutée du studio. « Alors tu existes pour de vrai. » Il disparaît avant que tu puisses répondre.",
       "Cette fois il sort de l''ombre. Ses nappes de reverb avalent tout. Tu ne sais plus où est le sol.",
       "Il laisse sur ton écran un seul message : « Merci d''avoir été réel. » Puis le brouillard se lève."]'::jsonb,
     '...tu m''entends ? Moi non plus, je ne t''entends plus.', 'cloud', 'toit', 5),
    ('zach', 'Zacharie Voss', 'Le champion en titre',
     '["Zach a gagné tous les concours de la région, trois années de suite. Il n''a jamais perdu un duel et il tient à ce que ça continue.",
       "Pour la première fois de sa vie, Zach est tombé. Il fixe ses mains. « Ce n''est pas fini. Je veux la suivante. »",
       "Il a tout recommencé de zéro : nouveau coach, nouvelle équipe, nouveau flow. Le champion que tu affrontes n''est plus celui du début.",
       "Il pose sa ceinture à tes pieds. « Un champion, ça sait aussi s''incliner. Montre-moi comment on la garde. »"]'::jsonb,
     'Je n''ai jamais perdu. Ne sois pas le premier à me faire changer d''avis.', 'trap', 'toit', 6)
  ) as v (id, nom, surnom, histoire, replique, type, decor, ordre)
  join lateral (
    select (array_agg(x.artist_id order by x.fans desc, x.artist_id))[5] a5, (array_agg(x.artist_id order by x.fans desc, x.artist_id))[6] a6
      from public.jeu_cartes x where x.active and public.combat_type_de(x.artist_id) = v.type) s on s.a6 is not null
on conflict (id) do nothing;

-- 6. Les titres (cosmétiques existants, voir sql/engagement.sql) : un par rival Légendaire, un pour les six, un par champion de prestige,
-- un pour la première renaissance. Ils se portent comme les autres titres du profil.
insert into public.cosmetiques (id, type, nom, description, rarete, style, source, ordre)
select 'titre-rival-' || r.id, 'titre', 'Némésis de ' || split_part(r.nom, ' ', 1),
       'Obtenu en terminant la série Légendaire contre ' || r.nom || ' (Rivaux).', 'rare', '{}'::jsonb, 'succes', 3000 + r.ordre
  from public.combat_rivaux r
on conflict (id) do nothing;
insert into public.cosmetiques (id, type, nom, description, rarete, style, source, ordre) values
  ('titre-rivaux-maitre', 'titre', 'Roi des rivalités', 'Obtenu en terminant la série Légendaire contre les six rivaux.', 'legendaire', '{}'::jsonb, 'succes', 3010),
  ('titre-prestige-renaissance', 'titre', 'Renaissant', 'Obtenu à la première renaissance d''un champion de prestige.', 'epique', '{}'::jsonb, 'succes', 3020)
on conflict (id) do nothing;
insert into public.cosmetiques (id, type, nom, description, rarete, style, source, ordre)
select 'titre-prestige-' || c.id, 'titre', 'Prestige ' || t.nom, 'Obtenu en venant à bout des 15 niveaux de prestige du champion ' || t.nom || '.', 'epique', '{}'::jsonb, 'succes', 3100 + c.ordre
  from public.combat_champions c join public.combat_types t on t.id = c.type
on conflict (id) do nothing;
