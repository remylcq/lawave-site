-- =====================================================================
-- La Wave — refonte complète de l'XP, côté serveur
--
-- Demande de Rémy : « une refonte du système d'XP sur le serveur, quelque chose
-- de vraiment complet qui est addictif », et des succès « qui donnent envie ».
--
-- Avant : le navigateur s'ajoutait lui-même de l'XP (un UPDATE sur son propre
-- profil, donc triche possible), un seul défi par jour, des niveaux tous les
-- 100 XP, 15 succès calculés à l'affichage.
--
-- Maintenant, tout se passe dans la base :
--
--   * NIVEAUX    courbe progressive (le niveau n demande 38 × (n-1)^1,7 XP),
--                60 niveaux, 10 titres, un « gel de série » tous les 5 niveaux.
--   * ACTIONS    chaque geste réel (noter, écouter, publier, commenter, réagir,
--                suivre…) rapporte de l'XP via des déclencheurs : impossible à
--                tricher depuis le navigateur. Un plafond par jour et par
--                action, et jamais deux fois pour la même sortie / le même message.
--   * SÉRIE      jours consécutifs d'activité, paliers (3, 7, 14, 30, 60, 100 jours)
--                qui rapportent un bonus, multiplicateur d'XP (×1,1 / ×1,25 / ×1,5),
--                et un gel qui sauve la série après un jour manqué.
--   * QUÊTES     trois quêtes par jour, différentes pour chacun ; les trois
--                faites ouvrent un coffre surprise.
--   * SEMAINE    objectif hebdomadaire à trois paliers (60 / 150 / 300 XP) et
--                classement de la semaine.
--   * SUCCÈS     71 succès en familles à 3-4 rangs (bronze → platine), des succès
--                secrets, une barre de progression sur chacun, de l'XP à la clé.
--   * ÉVÉNEMENTS tout ce qui arrive (gain, quête, coffre, niveau, succès…) est
--                posé dans xp_evenements : le navigateur les lit et les annonce,
--                même si le gain vient d'une réaction reçue hors ligne.
--
-- Rien n'est supprimé : profiles.xp reste le total (les 6 comptes gardent leur XP),
-- et les anciennes colonnes challenges / onboarding ne servent plus à l'XP.
--
-- À passer en une fois (Supabase → SQL Editor). Sans danger à rejouer.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Outils : jour, courbe des niveaux, titres
-- ---------------------------------------------------------------------

create or replace function public.xp_jour()
returns date language sql stable
as $$ select (now() at time zone 'Europe/Paris')::date $$;

-- XP cumulé qu'il faut pour ENTRER dans le niveau n.
create or replace function public.xp_seuil(n integer)
returns integer language sql immutable
as $$ select case when n <= 1 then 0 else round(38 * power(n - 1, 1.7))::integer end $$;

create or replace function public.xp_niveau(p_xp integer)
returns integer language plpgsql immutable
as $$
declare n integer := 1;
begin
  while n < 60 and coalesce(p_xp, 0) >= public.xp_seuil(n + 1) loop
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.xp_titre(n integer)
returns text language sql immutable
as $$
  select case
    when n >= 50 then 'Icône'
    when n >= 40 then 'Légende'
    when n >= 30 then 'Prescripteur'
    when n >= 23 then 'Mélomane'
    when n >= 17 then 'Pilier'
    when n >= 12 then 'Initié'
    when n >=  8 then 'Passionné'
    when n >=  5 then 'Habitué'
    when n >=  3 then 'Curieux'
    else 'Nouvelle Vague'
  end
$$;

-- Les trois paliers de l'objectif de la semaine : (numéro, XP à gagner, bonus).
create or replace function public.xp_paliers_semaine()
returns table (palier integer, seuil integer, bonus integer)
language sql immutable
as $$ select * from (values (1, 60, 20), (2, 150, 40), (3, 300, 80)) as t(palier, seuil, bonus) $$;


-- ---------------------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------------------

-- Ce que rapporte chaque geste. « bonus » = récompense interne (quête, coffre…).
create table if not exists public.xp_actions (
  action   text primary key,
  libelle  text not null,
  icone    text not null default '⚡',
  xp       integer not null default 0,
  plafond  integer,                     -- fois par jour qui rapportent de l'XP (null = sans limite)
  bonus    boolean not null default false
);

insert into public.xp_actions (action, libelle, icone, xp, plafond, bonus) values
  ('note',              'Noter une sortie',              '⭐', 4, 6,    false),
  ('ecoute',            'Écouter une sortie',            '🎧', 3, 8,    false),
  ('a_ecouter',         'Mettre une sortie de côté',     '🔖', 1, 5,    false),
  ('avis',              'Rédiger un avis',               '✍️', 8, 3,    false),
  ('favori',            'Choisir une favorite',          '💜', 3, 3,    false),
  ('post',              'Publier dans la communauté',    '📣', 10, 3,   false),
  ('commentaire',       'Commenter',                     '💬', 4, 10,   false),
  ('reaction',          'Réagir',                        '🔥', 1, 20,   false),
  ('reaction_recue',    'Réaction reçue',                '👏', 1, 30,   false),
  ('commentaire_recu',  'Commentaire reçu',              '💌', 2, 20,   false),
  ('suivre',            'Suivre un membre',              '🤝', 2, 10,   false),
  ('nouvel_abonne',     'Nouvel abonné',                 '🌟', 3, 20,   false),
  ('visite_artiste',    'Découvrir un artiste',          '🎤', 1, 5,    false),
  ('decouverte_sortie', 'Découvrir une sortie',          '💿', 1, 5,    false),
  ('visite_profil',     'Visiter un profil',             '👀', 1, 5,    false),
  ('connexion',         'Connexion du jour',             '☀️', 5, 1,    false),
  ('profil_photo',      'Ajouter une photo de profil',   '📸', 15, null, false),
  ('profil_bio',        'Rédiger sa description',        '📝', 10, null, false),
  ('profil_reseaux',    'Ajouter ses réseaux',           '🔗', 10, null, false),
  ('premier_post',      'Premier message publié',        '🎉', 15, null, false),
  ('quete',             'Quête accomplie',               '🎯', 0, null, true),
  ('coffre',            'Coffre du jour',                '🎁', 0, null, true),
  ('serie',             'Palier de série',               '🔥', 0, null, true),
  ('semaine',           'Objectif de la semaine',        '🏆', 0, null, true),
  ('succes',            'Succès obtenu',                 '🏅', 0, null, true)
on conflict (action) do update
  set libelle = excluded.libelle, icone = excluded.icone, xp = excluded.xp,
      plafond = excluded.plafond, bonus = excluded.bonus;

-- Le journal : une ligne par gain. La clé (membre, action, référence) empêche de
-- toucher deux fois l'XP du même geste (même sortie, même message…).
create table if not exists public.xp_journal (
  id       bigint generated always as identity primary key,
  user_id  uuid not null references public.profiles(id) on delete cascade,
  action   text not null,
  ref      text not null default '',
  xp       integer not null default 0,
  jour     date not null default public.xp_jour(),
  cree_le  timestamptz not null default now(),
  constraint xp_journal_unique unique (user_id, action, ref)
);
create index if not exists xp_journal_jour on public.xp_journal (user_id, jour);
create index if not exists xp_journal_semaine on public.xp_journal (jour, user_id);

-- La série, les gels et le dernier niveau annoncé de chacun.
create table if not exists public.xp_etat (
  user_id      uuid primary key references public.profiles(id) on delete cascade,
  serie        integer not null default 0,
  serie_max    integer not null default 0,
  dernier_jour date,
  gels         integer not null default 0,
  niveau_vu    integer not null default 1
);

-- Ce qu'il faut annoncer au membre (toasts) : lu une fois, puis marqué vu.
create table if not exists public.xp_evenements (
  id       bigint generated always as identity primary key,
  user_id  uuid not null references public.profiles(id) on delete cascade,
  type     text not null,
  donnees  jsonb not null default '{}'::jsonb,
  cree_le  timestamptz not null default now(),
  vu       boolean not null default false
);
create index if not exists xp_evenements_membre on public.xp_evenements (user_id, vu);

-- Le catalogue des quêtes du jour (une par type de geste) et les quêtes tirées.
create table if not exists public.xp_quetes_def (
  id        text primary key,
  action    text not null,
  libelle   text not null,
  icone     text not null default '🎯',
  objectif  integer not null,
  xp        integer not null
);

insert into public.xp_quetes_def (id, action, libelle, icone, objectif, xp) values
  ('q-note',        'note',              'Noter 2 sorties',                         '⭐', 2, 12),
  ('q-ecoute',      'ecoute',            'Écouter 3 sorties',                       '🎧', 3, 10),
  ('q-decouverte',  'decouverte_sortie', 'Ouvrir 5 fiches de sorties',              '💿', 5, 8),
  ('q-artiste',     'visite_artiste',    'Découvrir 3 artistes',                    '🎤', 3, 8),
  ('q-post',        'post',              'Publier un message dans la communauté',   '📣', 1, 15),
  ('q-commentaire', 'commentaire',       'Commenter 2 messages',                    '💬', 2, 12),
  ('q-reaction',    'reaction',          'Réagir à 5 messages',                     '🔥', 5, 8),
  ('q-suivre',      'suivre',            'Suivre un nouveau membre',                '🤝', 1, 8),
  ('q-a-ecouter',   'a_ecouter',         'Mettre 2 sorties de côté',                '🔖', 2, 6),
  ('q-profil',      'visite_profil',     'Visiter 2 profils de membres',            '👀', 2, 6),
  ('q-avis',        'avis',              'Rédiger un avis',                         '✍️', 1, 15),
  ('q-favori',      'favori',            'Choisir une favorite',                    '💜', 1, 8)
on conflict (id) do update
  set action = excluded.action, libelle = excluded.libelle, icone = excluded.icone,
      objectif = excluded.objectif, xp = excluded.xp;

create table if not exists public.xp_quetes (
  user_id   uuid not null references public.profiles(id) on delete cascade,
  jour      date not null,
  slot      integer not null,
  def_id    text not null,
  action    text not null,
  libelle   text not null,
  icone     text not null default '🎯',
  progres   integer not null default 0,
  objectif  integer not null,
  xp        integer not null,
  faite_le  timestamptz,
  primary key (user_id, jour, slot)
);

-- Les succès : définitions, et qui les a obtenus.
create table if not exists public.succes_def (
  id          text primary key,
  famille     text not null,
  categorie   text not null,
  rang        text not null check (rang in ('bronze', 'argent', 'or', 'platine')),
  nom         text not null,
  description text not null,
  icone       text not null default '🏅',
  metrique    text not null,
  seuil       integer not null,
  secret      boolean not null default false,
  xp          integer not null default 0,
  ordre       integer not null default 0
);

create table if not exists public.succes_obtenus (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  succes_id  text not null references public.succes_def(id) on delete cascade,
  obtenu_le  timestamptz not null default now(),
  primary key (user_id, succes_id)
);
create index if not exists succes_obtenus_succes on public.succes_obtenus (succes_id);


-- ---------------------------------------------------------------------
-- 3. Droits : tout se lit, rien ne s'écrit depuis le navigateur
-- ---------------------------------------------------------------------

alter table public.xp_actions     enable row level security;
alter table public.xp_journal     enable row level security;
alter table public.xp_etat        enable row level security;
alter table public.xp_evenements  enable row level security;
alter table public.xp_quetes_def  enable row level security;
alter table public.xp_quetes      enable row level security;
alter table public.succes_def     enable row level security;
alter table public.succes_obtenus enable row level security;

drop policy if exists "xp_actions lecture"     on public.xp_actions;
drop policy if exists "xp_quetes_def lecture"  on public.xp_quetes_def;
drop policy if exists "succes_def lecture"     on public.succes_def;
drop policy if exists "succes_obtenus lecture" on public.succes_obtenus;
drop policy if exists "xp_journal lecture"     on public.xp_journal;
drop policy if exists "xp_etat lecture"        on public.xp_etat;
drop policy if exists "xp_quetes lecture"      on public.xp_quetes;
drop policy if exists "xp_evenements lecture"  on public.xp_evenements;

create policy "xp_actions lecture"     on public.xp_actions     for select to authenticated using (true);
create policy "xp_quetes_def lecture"  on public.xp_quetes_def  for select to authenticated using (true);
create policy "succes_def lecture"     on public.succes_def     for select to authenticated using (true);
create policy "succes_obtenus lecture" on public.succes_obtenus for select to authenticated using (true);
create policy "xp_journal lecture"     on public.xp_journal     for select to authenticated using (user_id = auth.uid());
create policy "xp_etat lecture"        on public.xp_etat        for select to authenticated using (user_id = auth.uid());
create policy "xp_quetes lecture"      on public.xp_quetes      for select to authenticated using (user_id = auth.uid());
create policy "xp_evenements lecture"  on public.xp_evenements  for select to authenticated using (user_id = auth.uid());

revoke all on public.xp_actions, public.xp_journal, public.xp_etat, public.xp_evenements,
              public.xp_quetes_def, public.xp_quetes, public.succes_def, public.succes_obtenus
  from anon;
revoke insert, update, delete, truncate on public.xp_actions, public.xp_journal, public.xp_etat,
              public.xp_evenements, public.xp_quetes_def, public.xp_quetes, public.succes_def,
              public.succes_obtenus
  from authenticated;


-- ---------------------------------------------------------------------
-- 4. Le moteur (fonctions internes : le navigateur ne peut pas les appeler)
-- ---------------------------------------------------------------------

create or replace function public.xp_evt(p_user uuid, p_type text, p_donnees jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = public
as $$ insert into public.xp_evenements (user_id, type, donnees) values (p_user, p_type, coalesce(p_donnees, '{}'::jsonb)) $$;

create or replace function public.xp_etat_assurer(p_user uuid)
returns void language sql security definer set search_path = public
as $$
  insert into public.xp_etat (user_id, niveau_vu)
  select p.id, public.xp_niveau(coalesce(p.xp, 0)) from public.profiles p where p.id = p_user
  on conflict (user_id) do nothing
$$;

-- Verse de l'XP « brut » (sans plafond ni multiplicateur) et le note au journal.
-- Rend l'XP versé : 0 si ce gain avait déjà été versé (même action, même référence).
create or replace function public.xp_brut(p_user uuid, p_action text, p_ref text, p_xp integer)
returns integer language plpgsql security definer set search_path = public
as $$
declare v_n integer;
begin
  insert into public.xp_journal (user_id, action, ref, xp)
  values (p_user, p_action, coalesce(p_ref, ''), greatest(coalesce(p_xp, 0), 0))
  on conflict (user_id, action, ref) do nothing;

  get diagnostics v_n = row_count;
  if v_n = 0 then return 0; end if;

  if coalesce(p_xp, 0) > 0 then
    perform set_config('lawave.xp_ok', '1', true);
    update public.profiles set xp = coalesce(xp, 0) + p_xp where id = p_user;
    perform set_config('lawave.xp_ok', '0', true);
  end if;

  return greatest(coalesce(p_xp, 0), 0);
end $$;

-- Un nouveau niveau ? On l'annonce, et un gel de série tombe tous les 5 niveaux.
create or replace function public.xp_niveau_verifier(p_user uuid)
returns void language plpgsql security definer set search_path = public
as $$
declare e public.xp_etat%rowtype; v_xp integer; n integer; g integer;
begin
  select * into e from public.xp_etat where user_id = p_user for update;
  if not found then return; end if;

  select coalesce(xp, 0) into v_xp from public.profiles where id = p_user;
  n := public.xp_niveau(v_xp);

  if n > e.niveau_vu then
    g := greatest(n / 5 - e.niveau_vu / 5, 0);
    update public.xp_etat set niveau_vu = n, gels = least(3, gels + g) where user_id = p_user;
    perform public.xp_evt(p_user, 'niveau', jsonb_build_object(
      'niveau', n, 'titre', public.xp_titre(n),
      'nouveau_titre', public.xp_titre(n) <> public.xp_titre(e.niveau_vu), 'gels', g));
  elsif n < e.niveau_vu then
    update public.xp_etat set niveau_vu = n where user_id = p_user;
  end if;
end $$;

-- La série : appelée à chaque geste. Un jour de plus, ou un gel, ou on repart de 1.
create or replace function public.xp_serie_toucher(p_user uuid)
returns integer language plpgsql security definer set search_path = public
as $$
declare
  e public.xp_etat%rowtype;
  v_jour date := public.xp_jour();
  v_ecart integer;
  v_nouvelle integer;
  v_bonus integer;
  v_gel boolean := false;
begin
  select * into e from public.xp_etat where user_id = p_user for update;
  if not found then return 0; end if;
  if e.dernier_jour = v_jour then return e.serie; end if;

  v_ecart := case when e.dernier_jour is null then null else v_jour - e.dernier_jour end;

  if v_ecart = 1 then
    v_nouvelle := e.serie + 1;
  elsif v_ecart = 2 and e.gels > 0 then
    v_nouvelle := e.serie + 1;
    e.gels := e.gels - 1;
    perform public.xp_evt(p_user, 'gel_utilise', jsonb_build_object('serie', v_nouvelle, 'gels', e.gels));
  else
    if coalesce(e.serie, 0) >= 3 then
      perform public.xp_evt(p_user, 'serie_perdue', jsonb_build_object('serie', e.serie));
    end if;
    v_nouvelle := 1;
  end if;

  update public.xp_etat
     set serie = v_nouvelle, serie_max = greatest(serie_max, v_nouvelle),
         dernier_jour = v_jour, gels = e.gels
   where user_id = p_user;

  v_bonus := case v_nouvelle when 3 then 10 when 7 then 30 when 14 then 60
                             when 30 then 150 when 60 then 300 when 100 then 600 else 0 end;

  if v_bonus > 0 then
    if public.xp_brut(p_user, 'serie', v_nouvelle || '@' || (v_jour - v_nouvelle)::text, v_bonus) > 0 then
      if v_nouvelle in (7, 30, 100) then
        update public.xp_etat set gels = least(3, gels + 1) where user_id = p_user;
        v_gel := true;
      end if;
      perform public.xp_evt(p_user, 'serie', jsonb_build_object('serie', v_nouvelle, 'xp', v_bonus, 'gel', v_gel));
    end if;
  end if;

  return v_nouvelle;
end $$;

-- Les trois quêtes du jour : tirées au hasard mais figées pour la journée.
create or replace function public.xp_quetes_assurer(p_user uuid)
returns void language plpgsql security definer set search_path = public
as $$
declare v_jour date := public.xp_jour();
begin
  if exists (select 1 from public.xp_quetes where user_id = p_user and jour = v_jour) then
    return;
  end if;

  insert into public.xp_quetes (user_id, jour, slot, def_id, action, libelle, icone, objectif, xp)
  select p_user, v_jour, row_number() over (order by t.k), t.id, t.action, t.libelle, t.icone, t.objectif, t.xp
  from (
    select d.*, md5(p_user::text || v_jour::text || d.id) as k
    from public.xp_quetes_def d
    order by k
    limit 3
  ) t
  on conflict do nothing;
end $$;

-- Un geste avance les quêtes qui le demandent ; les trois faites ouvrent le coffre.
create or replace function public.xp_quetes_avancer(p_user uuid, p_action text)
returns void language plpgsql security definer set search_path = public
as $$
declare
  v_jour date := public.xp_jour();
  q public.xp_quetes%rowtype;
  v_faites integer; v_total integer; v_coffre integer;
begin
  for q in
    select * from public.xp_quetes
     where user_id = p_user and jour = v_jour and action = p_action and faite_le is null
     for update
  loop
    if q.progres + 1 >= q.objectif then
      update public.xp_quetes set progres = q.objectif, faite_le = now()
       where user_id = p_user and jour = v_jour and slot = q.slot;
      if public.xp_brut(p_user, 'quete', v_jour::text || ':' || q.def_id, q.xp) > 0 then
        perform public.xp_evt(p_user, 'quete', jsonb_build_object('libelle', q.libelle, 'icone', q.icone, 'xp', q.xp));
      end if;
    else
      update public.xp_quetes set progres = q.progres + 1
       where user_id = p_user and jour = v_jour and slot = q.slot;
    end if;
  end loop;

  select count(*) filter (where faite_le is not null), count(*)
    into v_faites, v_total
    from public.xp_quetes where user_id = p_user and jour = v_jour;

  if v_total > 0 and v_faites = v_total then
    v_coffre := 20 + floor(random() * 31)::integer;
    if public.xp_brut(p_user, 'coffre', v_jour::text, v_coffre) > 0 then
      perform public.xp_evt(p_user, 'coffre', jsonb_build_object('xp', v_coffre));
    end if;
  end if;
end $$;

-- L'objectif de la semaine : trois paliers, un bonus à chacun.
create or replace function public.xp_semaine_verifier(p_user uuid)
returns void language plpgsql security definer set search_path = public
as $$
declare
  v_jour date := public.xp_jour();
  v_xp integer;
  p record;
begin
  select coalesce(sum(xp), 0) into v_xp
    from public.xp_journal
   where user_id = p_user and jour >= date_trunc('week', v_jour)::date and action <> 'semaine';

  for p in select * from public.xp_paliers_semaine() order by palier loop
    if v_xp >= p.seuil
       and public.xp_brut(p_user, 'semaine', to_char(v_jour, 'IYYY-IW') || '-' || p.palier, p.bonus) > 0 then
      perform public.xp_evt(p_user, 'semaine',
        jsonb_build_object('palier', p.palier, 'objectif', p.seuil, 'xp', p.bonus));
    end if;
  end loop;
end $$;

-- Tous les compteurs dont les succès ont besoin, calculés d'un coup.
create or replace function public.xp_metriques(p_user uuid)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  p public.profiles%rowtype;
  e public.xp_etat%rowtype;
  m jsonb;
begin
  select * into p from public.profiles where id = p_user;
  if not found then return '{}'::jsonb; end if;
  select * into e from public.xp_etat where user_id = p_user;

  with j as (
    select jo.* from public.xp_journal jo
     where jo.user_id = p_user and jo.jour > date '2020-01-01'
       and jo.action in (select a.action from public.xp_actions a where not a.bonus)
  )
  select jsonb_build_object(
    'notes',             (select count(*) from public.release_ratings r where r.user_id = p_user and r.rating is not null),
    'notes_basses',      (select count(*) from public.release_ratings r where r.user_id = p_user and r.rating is not null and r.rating <= 4),
    'cinq_etoiles',      (select count(*) from public.release_ratings r where r.user_id = p_user and r.rating = 10),
    'ecoutes',           (select count(*) from public.release_ratings r where r.user_id = p_user and r.saved),
    'avis',              (select count(*) from public.release_ratings r where r.user_id = p_user and nullif(trim(coalesce(r.avis, '')), '') is not null),
    'favoris',           (select count(*) from public.release_ratings r where r.user_id = p_user and r.favori),
    'posts',             (select count(*) from public.com_posts x where x.auteur_id = p_user),
    'commentaires',      (select count(*) from public.com_commentaires x where x.auteur_id = p_user),
    'reactions_donnees', (select count(*) from public.com_reactions x where x.user_id = p_user),
    'reactions_recues',  (select count(*) from public.com_reactions x
                           where x.user_id <> p_user
                             and ((x.cible_type = 'post' and exists (select 1 from public.com_posts c where c.id = x.cible_id and c.auteur_id = p_user))
                               or (x.cible_type = 'commentaire' and exists (select 1 from public.com_commentaires c where c.id = x.cible_id and c.auteur_id = p_user)))),
    'abonnes',           (select count(*) from public.com_suivis x where x.suivi_id = p_user),
    'abonnements',       (select count(*) from public.com_suivis x where x.suiveur_id = p_user),
    'serie',             coalesce(e.serie, 0),
    'serie_max',         coalesce(e.serie_max, 0),
    'niveau',            public.xp_niveau(coalesce(p.xp, 0)),
    'xp',                coalesce(p.xp, 0),
    'decouvertes',       (select count(*) from j where j.action = 'visite_artiste'),
    'quetes',            (select count(*) from public.xp_quetes q where q.user_id = p_user and q.faite_le is not null),
    'coffres',           (select count(*) from public.xp_journal x where x.user_id = p_user and x.action = 'coffre'),
    'semaines',          (select count(*) from public.xp_journal x where x.user_id = p_user and x.action = 'semaine' and x.ref like '%-3'),
    'profil_complet',    case when coalesce(p.avatar_url, '') <> '' and coalesce(p.bio, '') <> '' and coalesce(p.role, '') <> '' then 1 else 0 end,
    'verifie',           case when coalesce(p.verifie, false) then 1 else 0 end,
    'anciennete',        (current_date - p.created_at::date),
    'nuit',              (select count(*) from j where extract(hour from j.cree_le at time zone 'Europe/Paris') < 5),
    'matin',             (select count(*) from j where extract(hour from j.cree_le at time zone 'Europe/Paris') between 5 and 7),
    'marathon',          coalesce((select max(c) from (select count(*) c from j group by j.jour) t), 0),
    'variete',           (select count(distinct j.action) from j)
  ) into m;

  return m;
end $$;

-- Débloque les succès atteints (en silence pour le rattrapage des comptes existants).
create or replace function public.xp_succes_evaluer(p_user uuid, p_silencieux boolean default false)
returns integer language plpgsql security definer set search_path = public
as $$
declare
  m jsonb; d record; v_n integer; v_nouveau integer; v_total integer := 0; v_tour integer;
begin
  for v_tour in 1..3 loop
    v_nouveau := 0;
    m := public.xp_metriques(p_user);

    for d in
      select * from public.succes_def sd
       where not exists (select 1 from public.succes_obtenus o where o.user_id = p_user and o.succes_id = sd.id)
       order by sd.ordre
    loop
      if coalesce((m ->> d.metrique)::numeric, 0) >= d.seuil then
        insert into public.succes_obtenus (user_id, succes_id) values (p_user, d.id) on conflict do nothing;
        get diagnostics v_n = row_count;
        if v_n > 0 then
          v_nouveau := v_nouveau + 1;
          if not p_silencieux then
            perform public.xp_brut(p_user, 'succes', d.id, d.xp);
            perform public.xp_evt(p_user, 'succes', jsonb_build_object(
              'id', d.id, 'nom', d.nom, 'description', d.description, 'icone', d.icone,
              'rang', d.rang, 'xp', d.xp, 'secret', d.secret));
          end if;
        end if;
      end if;
    end loop;

    v_total := v_total + v_nouveau;
    exit when v_nouveau = 0 or p_silencieux;
  end loop;

  return v_total;
end $$;

-- LE point d'entrée de tous les gestes : plafond, multiplicateur de série,
-- journal, quêtes, objectif de la semaine, succès, niveau.
create or replace function public.xp_crediter(p_user uuid, p_action text, p_ref text default '')
returns integer language plpgsql security definer set search_path = public
as $$
declare
  a public.xp_actions%rowtype;
  v_jour date := public.xp_jour();
  v_serie integer; v_mult numeric; v_pris integer; v_xp integer; v_n integer;
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
  on conflict (user_id, action, ref) do nothing;
  get diagnostics v_n = row_count;
  if v_n = 0 then return 0; end if;

  if v_xp > 0 then
    perform set_config('lawave.xp_ok', '1', true);
    update public.profiles set xp = coalesce(xp, 0) + v_xp where id = p_user;
    perform set_config('lawave.xp_ok', '0', true);

    perform public.xp_evt(p_user, 'gain', jsonb_build_object(
      'action', p_action, 'libelle', a.libelle, 'icone', a.icone, 'xp', v_xp, 'multiplicateur', v_mult));
  end if;

  perform public.xp_quetes_assurer(p_user);
  perform public.xp_quetes_avancer(p_user, p_action);
  perform public.xp_semaine_verifier(p_user);
  perform public.xp_succes_evaluer(p_user);
  perform public.xp_niveau_verifier(p_user);

  return v_xp;
end $$;

-- Photo, description, réseaux, premier message : cochés d'eux-mêmes, une seule fois.
create or replace function public.xp_profil_verifier(p_user uuid)
returns void language plpgsql security definer set search_path = public
as $$
declare p public.profiles%rowtype;
begin
  select * into p from public.profiles where id = p_user;
  if not found then return; end if;

  if coalesce(p.avatar_url, '') <> '' then perform public.xp_crediter(p_user, 'profil_photo', '1'); end if;
  if nullif(trim(coalesce(p.bio, '')), '') is not null then perform public.xp_crediter(p_user, 'profil_bio', '1'); end if;
  if exists (select 1 from jsonb_each_text(coalesce(p.socials, '{}'::jsonb)) s where nullif(trim(s.value), '') is not null) then
    perform public.xp_crediter(p_user, 'profil_reseaux', '1');
  end if;
  if exists (select 1 from public.com_posts where auteur_id = p_user) then
    perform public.xp_crediter(p_user, 'premier_post', '1');
  end if;
end $$;


-- ---------------------------------------------------------------------
-- 5. Déclencheurs : l'XP vient des vrais gestes, pas du navigateur.
--    Jamais bloquants : une erreur d'XP ne doit rien empêcher.
-- ---------------------------------------------------------------------

create or replace function public.xp_trg_release_ratings()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  o_rating smallint; o_saved boolean; o_aecouter boolean; o_avis text; o_favori boolean;
begin
  begin
    if tg_op = 'UPDATE' then
      o_rating := old.rating; o_saved := old.saved; o_aecouter := old.a_ecouter;
      o_avis := old.avis; o_favori := old.favori;
    end if;

    if new.rating is not null and o_rating is null then
      perform public.xp_crediter(new.user_id, 'note', new.release_id::text);
    end if;
    if coalesce(new.saved, false) and not coalesce(o_saved, false) then
      perform public.xp_crediter(new.user_id, 'ecoute', new.release_id::text);
    end if;
    if coalesce(new.a_ecouter, false) and not coalesce(o_aecouter, false) then
      perform public.xp_crediter(new.user_id, 'a_ecouter', new.release_id::text);
    end if;
    if nullif(trim(coalesce(new.avis, '')), '') is not null and nullif(trim(coalesce(o_avis, '')), '') is null then
      perform public.xp_crediter(new.user_id, 'avis', new.release_id::text);
    end if;
    if coalesce(new.favori, false) and not coalesce(o_favori, false) then
      perform public.xp_crediter(new.user_id, 'favori', new.release_id::text);
    end if;
  exception when others then
    null;
  end;
  return null;
end $$;

create or replace function public.xp_trg_com_posts()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  begin
    perform public.xp_crediter(new.auteur_id, 'post', new.id::text);
    perform public.xp_crediter(new.auteur_id, 'premier_post', '1');
  exception when others then
    null;
  end;
  return null;
end $$;

create or replace function public.xp_trg_com_commentaires()
returns trigger language plpgsql security definer set search_path = public
as $$
declare v_auteur uuid;
begin
  begin
    perform public.xp_crediter(new.auteur_id, 'commentaire', new.id::text);
    select auteur_id into v_auteur from public.com_posts where id = new.post_id;
    if v_auteur is not null and v_auteur <> new.auteur_id then
      perform public.xp_crediter(v_auteur, 'commentaire_recu', new.id::text);
    end if;
  exception when others then
    null;
  end;
  return null;
end $$;

create or replace function public.xp_trg_com_reactions()
returns trigger language plpgsql security definer set search_path = public
as $$
declare v_auteur uuid;
begin
  begin
    perform public.xp_crediter(new.user_id, 'reaction', new.cible_type || ':' || new.cible_id::text);

    if new.cible_type = 'post' then
      select auteur_id into v_auteur from public.com_posts where id = new.cible_id;
    else
      select auteur_id into v_auteur from public.com_commentaires where id = new.cible_id;
    end if;

    if v_auteur is not null and v_auteur <> new.user_id then
      perform public.xp_crediter(v_auteur, 'reaction_recue', new.user_id::text || ':' || new.cible_id::text);
    end if;
  exception when others then
    null;
  end;
  return null;
end $$;

create or replace function public.xp_trg_com_suivis()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  begin
    perform public.xp_crediter(new.suiveur_id, 'suivre', new.suivi_id::text);
    perform public.xp_crediter(new.suivi_id, 'nouvel_abonne', new.suiveur_id::text);
  exception when others then
    null;
  end;
  return null;
end $$;

create or replace function public.xp_trg_profiles()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  begin
    perform public.xp_profil_verifier(new.id);
  exception when others then
    null;
  end;
  return null;
end $$;

drop trigger if exists xp_release_ratings on public.release_ratings;
create trigger xp_release_ratings after insert or update on public.release_ratings
  for each row execute function public.xp_trg_release_ratings();

drop trigger if exists xp_com_posts on public.com_posts;
create trigger xp_com_posts after insert on public.com_posts
  for each row execute function public.xp_trg_com_posts();

drop trigger if exists xp_com_commentaires on public.com_commentaires;
create trigger xp_com_commentaires after insert on public.com_commentaires
  for each row execute function public.xp_trg_com_commentaires();

drop trigger if exists xp_com_reactions on public.com_reactions;
create trigger xp_com_reactions after insert on public.com_reactions
  for each row execute function public.xp_trg_com_reactions();

drop trigger if exists xp_com_suivis on public.com_suivis;
create trigger xp_com_suivis after insert on public.com_suivis
  for each row execute function public.xp_trg_com_suivis();

drop trigger if exists xp_profiles on public.profiles;
create trigger xp_profiles after update on public.profiles
  for each row
  when (old.avatar_url is distinct from new.avatar_url
     or old.bio is distinct from new.bio
     or old.socials is distinct from new.socials)
  execute function public.xp_trg_profiles();


-- ---------------------------------------------------------------------
-- 6. Anti-triche : un membre ne peut plus écrire son propre XP.
--    Seuls le moteur (et l'équipe) le font ; waveurs_* passent par la même porte.
-- ---------------------------------------------------------------------

create or replace function public.profils_garder_champs_equipe()
returns trigger language plpgsql security definer set search_path = public
as $$
begin

  if auth.uid() is not null and not public.est_equipe() then

    -- L'XP ne bouge que par le moteur (qui lève ce drapeau le temps de sa requête).
    if coalesce(current_setting('lawave.xp_ok', true), '0') <> '1' then
      if tg_op = 'INSERT' then
        new.xp := 0;
      else
        new.xp := old.xp;
      end if;
    end if;

    if tg_op = 'INSERT' then

      new.is_admin     := false;
      new.verifie      := false;
      new.verifie_role := null;
      new.verifie_le   := null;
      new.logo_url     := null;

    else

      new.is_admin := old.is_admin;

      if public.com_role_canonique(new.role) is distinct from public.com_role_canonique(old.role) then

        update public.verifications_profil
           set statut = 'retire', traite_le = now(), motif_refus = 'Rôle modifié', vu = true
         where user_id = new.id and statut = 'valide';

        delete from public.verifications_profil
         where user_id = new.id and statut = 'en_attente';

        new.verifie      := false;
        new.verifie_role := null;
        new.verifie_le   := null;
        new.logo_url     := null;

      else
        new.verifie      := old.verifie;
        new.verifie_role := old.verifie_role;
        new.verifie_le   := old.verifie_le;
        new.logo_url     := old.logo_url;
      end if;

    end if;

  end if;

  return new;
end $$;

-- Les machines des waveurs versaient déjà de l'XP : elles lèvent le même drapeau.
do $patch$
declare d text; f text;
begin
  foreach f in array array['public.waveurs_tourner(text)', 'public.waveurs_crediter(uuid,integer,integer,integer)'] loop
    if to_regprocedure(f) is not null then
      d := pg_get_functiondef(to_regprocedure(f));
      if position('lawave.xp_ok' in d) = 0 then
        d := replace(d, 'update public.profiles',
                        E'perform set_config(''lawave.xp_ok'', ''1'', true);\n  update public.profiles');
        execute d;
      end if;
    end if;
  end loop;
end $patch$;


-- ---------------------------------------------------------------------
-- 7. Les succès : 71 définitions, rangs, secrets
--    (l'XP de chaque succès dépend du rang : 10 / 25 / 60 / 150, secret 40)
-- ---------------------------------------------------------------------

insert into public.succes_def (id, famille, categorie, rang, nom, description, icone, metrique, seuil, secret, xp, ordre)
select v.id, v.famille, v.categorie, v.rang, v.nom, v.description, v.icone, v.metrique, v.seuil, v.secret,
       case when v.secret then 40
            else case v.rang when 'bronze' then 10 when 'argent' then 25 when 'or' then 60 else 150 end end,
       v.ordre
from (values
  -- COLLECTION
  ('ecoute-5',   'ecoute', 'Collection', 'bronze',  'Étagère',              'Écouter 5 sorties',              '🎧', 'ecoutes',   5,   false, 101),
  ('ecoute-25',  'ecoute', 'Collection', 'argent',  'Discothèque',          'Écouter 25 sorties',             '🎧', 'ecoutes',   25,  false, 102),
  ('ecoute-60',  'ecoute', 'Collection', 'or',      'Archiviste',           'Écouter 60 sorties',             '🎧', 'ecoutes',   60,  false, 103),
  ('ecoute-150', 'ecoute', 'Collection', 'platine', 'Bibliothèque vivante', 'Écouter 150 sorties',            '🎧', 'ecoutes',   150, false, 104),
  ('podium',     'podium', 'Collection', 'argent',  'Podium complet',       'Choisir ses 3 favorites',        '💜', 'favoris',   3,   false, 111),
  ('decouv-10',  'decouv', 'Collection', 'bronze',  'Explorateur',          'Découvrir 10 artistes',          '🧭', 'decouvertes', 10,  false, 121),
  ('decouv-50',  'decouv', 'Collection', 'argent',  'Éclaireur',            'Découvrir 50 artistes',          '🧭', 'decouvertes', 50,  false, 122),
  ('decouv-150', 'decouv', 'Collection', 'or',      'Cartographe',          'Découvrir 150 artistes',         '🧭', 'decouvertes', 150, false, 123),
  -- CRITIQUE
  ('note-1',     'note',   'Critique',   'bronze',  'Premier verdict',      'Noter une sortie',               '⭐', 'notes',     1,   false, 201),
  ('note-10',    'note',   'Critique',   'argent',  'Oreille affûtée',      'Noter 10 sorties',               '⭐', 'notes',     10,  false, 202),
  ('note-30',    'note',   'Critique',   'or',      'Juge de paix',         'Noter 30 sorties',               '⭐', 'notes',     30,  false, 203),
  ('note-100',   'note',   'Critique',   'platine', 'Maître des notes',     'Noter 100 sorties',              '⭐', 'notes',     100, false, 204),
  ('avis-1',     'avis',   'Critique',   'bronze',  'Chroniqueur',          'Rédiger un avis',                '✍️', 'avis',      1,   false, 211),
  ('avis-5',     'avis',   'Critique',   'argent',  'Critique',             'Rédiger 5 avis',                 '✍️', 'avis',      5,   false, 212),
  ('avis-15',    'avis',   'Critique',   'or',      'Plume de La Wave',     'Rédiger 15 avis',                '✍️', 'avis',      15,  false, 213),
  ('avis-40',    'avis',   'Critique',   'platine', 'Éditorialiste',        'Rédiger 40 avis',                '✍️', 'avis',      40,  false, 214),
  ('coeur-1',    'coeur',  'Critique',   'bronze',  'Coup de cœur',         'Mettre 5 étoiles à une sortie',  '😍', 'cinq_etoiles', 1,  false, 221),
  ('coeur-5',    'coeur',  'Critique',   'argent',  'Fan fidèle',           'Mettre 5 étoiles à 5 sorties',   '😍', 'cinq_etoiles', 5,  false, 222),
  ('coeur-15',   'coeur',  'Critique',   'or',      'Cœur d''artichaut',    'Mettre 5 étoiles à 15 sorties',  '😍', 'cinq_etoiles', 15, false, 223),
  ('severe-5',   'severe', 'Critique',   'argent',  'Critique sévère',      'Mettre 5 notes de 2 étoiles ou moins', '🧐', 'notes_basses', 5,  false, 231),
  ('severe-15',  'severe', 'Critique',   'or',      'Impitoyable',          'Mettre 15 notes de 2 étoiles ou moins', '🧐', 'notes_basses', 15, false, 232),
  -- COMMUNAUTÉ
  ('post-1',     'post',   'Communauté', 'bronze',  'Prise de parole',      'Publier un message',             '📣', 'posts',     1,   false, 301),
  ('post-5',     'post',   'Communauté', 'argent',  'Habitué du fil',       'Publier 5 messages',             '📣', 'posts',     5,   false, 302),
  ('post-20',    'post',   'Communauté', 'or',      'Voix de la communauté','Publier 20 messages',            '📣', 'posts',     20,  false, 303),
  ('post-60',    'post',   'Communauté', 'platine', 'Tribun',               'Publier 60 messages',            '📣', 'posts',     60,  false, 304),
  ('com-3',      'com',    'Communauté', 'bronze',  'Bon voisin',           'Commenter 3 messages',           '💬', 'commentaires', 3,   false, 311),
  ('com-15',     'com',    'Communauté', 'argent',  'Bavard',               'Commenter 15 messages',          '💬', 'commentaires', 15,  false, 312),
  ('com-50',     'com',    'Communauté', 'or',      'Pilier de comptoir',   'Commenter 50 messages',          '💬', 'commentaires', 50,  false, 313),
  ('com-150',    'com',    'Communauté', 'platine', 'Éternel interlocuteur','Commenter 150 messages',         '💬', 'commentaires', 150, false, 314),
  ('react-10',   'react',  'Communauté', 'bronze',  'Applaudisseur',        'Réagir à 10 messages',           '🔥', 'reactions_donnees', 10,  false, 321),
  ('react-50',   'react',  'Communauté', 'argent',  'Public conquis',       'Réagir à 50 messages',           '🔥', 'reactions_donnees', 50,  false, 322),
  ('react-200',  'react',  'Communauté', 'or',      'Standing ovation',     'Réagir à 200 messages',          '🔥', 'reactions_donnees', 200, false, 323),
  ('recu-5',     'recu',   'Communauté', 'bronze',  'Remarqué',             'Recevoir 5 réactions',           '👏', 'reactions_recues', 5,   false, 331),
  ('recu-25',    'recu',   'Communauté', 'argent',  'Apprécié',             'Recevoir 25 réactions',          '👏', 'reactions_recues', 25,  false, 332),
  ('recu-100',   'recu',   'Communauté', 'or',      'Populaire',            'Recevoir 100 réactions',         '👏', 'reactions_recues', 100, false, 333),
  ('recu-300',   'recu',   'Communauté', 'platine', 'Star',                 'Recevoir 300 réactions',         '👏', 'reactions_recues', 300, false, 334),
  ('fan-1',      'fan',    'Communauté', 'bronze',  'Premier fan',          'Avoir 1 abonné',                 '🌟', 'abonnes',   1,   false, 341),
  ('fan-5',      'fan',    'Communauté', 'argent',  'Petit cercle',         'Avoir 5 abonnés',                '🌟', 'abonnes',   5,   false, 342),
  ('fan-20',     'fan',    'Communauté', 'or',      'Communauté à soi',     'Avoir 20 abonnés',               '🌟', 'abonnes',   20,  false, 343),
  ('fan-50',     'fan',    'Communauté', 'platine', 'Influenceur',          'Avoir 50 abonnés',               '🌟', 'abonnes',   50,  false, 344),
  ('suit-5',     'suit',   'Communauté', 'bronze',  'Curieux',              'Suivre 5 membres',               '🤝', 'abonnements', 5,  false, 351),
  ('suit-20',    'suit',   'Communauté', 'argent',  'Chasseur de talents',  'Suivre 20 membres',              '🤝', 'abonnements', 20, false, 352),
  -- RÉGULARITÉ
  ('serie-3',    'serie',  'Régularité', 'bronze',  'Régulier',             'Tenir 3 jours de suite',         '🔥', 'serie_max', 3,   false, 401),
  ('serie-7',    'serie',  'Régularité', 'argent',  'Semaine parfaite',     'Tenir 7 jours de suite',         '🔥', 'serie_max', 7,   false, 402),
  ('serie-14',   'serie',  'Régularité', 'argent',  'Quinzaine',            'Tenir 14 jours de suite',        '🔥', 'serie_max', 14,  false, 403),
  ('serie-30',   'serie',  'Régularité', 'or',      'Mois de fer',          'Tenir 30 jours de suite',        '🔥', 'serie_max', 30,  false, 404),
  ('serie-60',   'serie',  'Régularité', 'or',      'Increvable',           'Tenir 60 jours de suite',        '🔥', 'serie_max', 60,  false, 405),
  ('serie-100',  'serie',  'Régularité', 'platine', 'Centurion',            'Tenir 100 jours de suite',       '🔥', 'serie_max', 100, false, 406),
  ('quete-5',    'quete',  'Régularité', 'bronze',  'Appliqué',             'Accomplir 5 quêtes',             '🎯', 'quetes',    5,   false, 411),
  ('quete-25',   'quete',  'Régularité', 'argent',  'Assidu',               'Accomplir 25 quêtes',            '🎯', 'quetes',    25,  false, 412),
  ('quete-75',   'quete',  'Régularité', 'or',      'Infatigable',          'Accomplir 75 quêtes',            '🎯', 'quetes',    75,  false, 413),
  ('quete-200',  'quete',  'Régularité', 'platine', 'Machine de guerre',    'Accomplir 200 quêtes',           '🎯', 'quetes',    200, false, 414),
  ('coffre-1',   'coffre', 'Régularité', 'bronze',  'Ouvre-boîte',          'Ouvrir un coffre du jour',       '🎁', 'coffres',   1,   false, 421),
  ('coffre-10',  'coffre', 'Régularité', 'argent',  'Chasseur de trésors',  'Ouvrir 10 coffres',              '🎁', 'coffres',   10,  false, 422),
  ('coffre-40',  'coffre', 'Régularité', 'or',      'Coffre-fort',          'Ouvrir 40 coffres',              '🎁', 'coffres',   40,  false, 423),
  ('semaine-1',  'semaine','Régularité', 'bronze',  'Objectif atteint',     'Atteindre le dernier palier de la semaine', '🏆', 'semaines', 1,  false, 431),
  ('semaine-4',  'semaine','Régularité', 'argent',  'Quatre semaines pleines','Atteindre 4 fois le dernier palier de la semaine', '🏆', 'semaines', 4,  false, 432),
  ('semaine-12', 'semaine','Régularité', 'or',      'Trimestre en or',      'Atteindre 12 fois le dernier palier de la semaine', '🏆', 'semaines', 12, false, 433),
  -- PROGRESSION
  ('niveau-5',   'niveau', 'Progression','bronze',  'Habitué',              'Atteindre le niveau 5',          '🎧', 'niveau',    5,   false, 501),
  ('niveau-12',  'niveau', 'Progression','argent',  'Initié',               'Atteindre le niveau 12',         '🌊', 'niveau',    12,  false, 502),
  ('niveau-23',  'niveau', 'Progression','or',      'Mélomane',             'Atteindre le niveau 23',         '⭐', 'niveau',    23,  false, 503),
  ('niveau-40',  'niveau', 'Progression','platine', 'Légende',              'Atteindre le niveau 40',         '👑', 'niveau',    40,  false, 504),
  ('profil',     'profil', 'Progression','bronze',  'Carte de visite',      'Renseigner photo, description et rôle', '🪪', 'profil_complet', 1, false, 511),
  ('verifie',    'profil', 'Progression','argent',  'Profil vérifié',       'Faire vérifier son profil par l''équipe', '✅', 'verifie', 1,   false, 512),
  ('age-30',     'age',    'Progression','bronze',  'Un mois à bord',       'Être membre depuis 30 jours',    '⚓', 'anciennete', 30,  false, 521),
  ('age-180',    'age',    'Progression','argent',  'Six mois de vagues',   'Être membre depuis 6 mois',      '⚓', 'anciennete', 180, false, 522),
  ('age-365',    'age',    'Progression','or',      'Un an de Wave',        'Être membre depuis 1 an',        '⚓', 'anciennete', 365, false, 523),
  -- SECRETS
  ('secret-nuit',     'secret', 'Secrets', 'or', 'Oiseau de nuit',  'Être actif entre minuit et 5 h',            '🦉', 'nuit',     1,  true, 901),
  ('secret-matin',    'secret', 'Secrets', 'or', 'Lève-tôt',        'Être actif entre 5 h et 8 h',               '🌅', 'matin',    1,  true, 902),
  ('secret-marathon', 'secret', 'Secrets', 'or', 'Marathon',        'Faire 15 gestes en une seule journée',      '🏃', 'marathon', 15, true, 903),
  ('secret-variete',  'secret', 'Secrets', 'or', 'Touche-à-tout',   'Essayer 10 types de gestes différents',     '🎭', 'variete',  10, true, 904)
) as v (id, famille, categorie, rang, nom, description, icone, metrique, seuil, secret, ordre)
on conflict (id) do update
  set famille = excluded.famille, categorie = excluded.categorie, rang = excluded.rang,
      nom = excluded.nom, description = excluded.description, icone = excluded.icone,
      metrique = excluded.metrique, seuil = excluded.seuil, secret = excluded.secret,
      xp = excluded.xp, ordre = excluded.ordre;


-- ---------------------------------------------------------------------
-- 8. Ce que le navigateur peut appeler
-- ---------------------------------------------------------------------

-- Tout l'état d'un membre en un appel : niveau, série, quêtes, semaine, succès.
-- C'est aussi lui qui compte la connexion du jour (série, +5 XP, quêtes tirées).
create or replace function public.xp_moi()
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_jour date := public.xp_jour();
  v_deb date := date_trunc('week', public.xp_jour())::date;
  p public.profiles%rowtype;
  e public.xp_etat%rowtype;
  n integer; v_mult numeric; v_serie integer; v_semaine integer; v_rang integer;
  v_quetes jsonb; v_coffre integer; v_paliers jsonb; v_recents jsonb; v_prochains jsonb;
  m jsonb; v_obtenus integer; v_total integer;
begin
  if v_uid is null then return null; end if;

  perform public.xp_etat_assurer(v_uid);
  perform public.xp_crediter(v_uid, 'connexion', v_jour::text);
  perform public.xp_quetes_assurer(v_uid);
  perform public.xp_profil_verifier(v_uid);
  perform public.xp_succes_evaluer(v_uid);
  perform public.xp_niveau_verifier(v_uid);

  select * into p from public.profiles where id = v_uid;
  select * into e from public.xp_etat where user_id = v_uid;
  if not found or p.id is null then return null; end if;

  n := public.xp_niveau(coalesce(p.xp, 0));

  v_serie := case when e.dernier_jour >= v_jour - 1 or (e.dernier_jour = v_jour - 2 and e.gels > 0)
                  then e.serie else 0 end;
  v_mult := case when v_serie >= 14 then 1.5 when v_serie >= 7 then 1.25 when v_serie >= 3 then 1.1 else 1 end;

  select coalesce(jsonb_agg(jsonb_build_object(
           'slot', q.slot, 'id', q.def_id, 'libelle', q.libelle, 'icone', q.icone,
           'progres', q.progres, 'objectif', q.objectif, 'xp', q.xp, 'faite', q.faite_le is not null)
         order by q.slot), '[]'::jsonb)
    into v_quetes
    from public.xp_quetes q where q.user_id = v_uid and q.jour = v_jour;

  select xp into v_coffre from public.xp_journal where user_id = v_uid and action = 'coffre' and ref = v_jour::text;

  select coalesce(sum(xp), 0) into v_semaine
    from public.xp_journal where user_id = v_uid and jour >= v_deb and action <> 'semaine';

  select coalesce(jsonb_agg(jsonb_build_object(
           'palier', s.palier, 'seuil', s.seuil, 'bonus', s.bonus, 'atteint', v_semaine >= s.seuil)
         order by s.palier), '[]'::jsonb)
    into v_paliers from public.xp_paliers_semaine() s;

  select r.rang into v_rang
    from (select user_id, rank() over (order by sum(xp) desc) as rang
            from public.xp_journal where jour >= v_deb group by user_id having sum(xp) > 0) r
   where r.user_id = v_uid;

  m := public.xp_metriques(v_uid);

  select count(*) into v_total from public.succes_def;
  select count(*) into v_obtenus from public.succes_obtenus where user_id = v_uid;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', d.id, 'nom', d.nom, 'icone', d.icone, 'rang', d.rang, 'obtenu_le', o.obtenu_le)
         order by o.obtenu_le desc), '[]'::jsonb)
    into v_recents
    from (select * from public.succes_obtenus where user_id = v_uid order by obtenu_le desc limit 3) o
    join public.succes_def d on d.id = o.succes_id;

  select coalesce(jsonb_agg(t.x order by t.ratio desc), '[]'::jsonb)
    into v_prochains
    from (
      select jsonb_build_object('id', d.id, 'nom', d.nom, 'icone', d.icone, 'rang', d.rang,
               'description', d.description, 'valeur', q.v, 'seuil', d.seuil, 'xp', d.xp) as x,
             q.v / d.seuil as ratio
        from public.succes_def d
        cross join lateral (select coalesce((m ->> d.metrique)::numeric, 0) as v) q
       where not d.secret
         and not exists (select 1 from public.succes_obtenus o where o.user_id = v_uid and o.succes_id = d.id)
       order by q.v / d.seuil desc, d.ordre
       limit 3
    ) t;

  return jsonb_build_object(
    'xp',            coalesce(p.xp, 0),
    'niveau',        n,
    'titre',         public.xp_titre(n),
    'seuil_bas',     public.xp_seuil(n),
    'seuil_haut',    case when n >= 60 then null else public.xp_seuil(n + 1) end,
    'serie',         v_serie,
    'serie_max',     e.serie_max,
    'fait_aujourdhui', e.dernier_jour = v_jour,
    'gels',          e.gels,
    'multiplicateur', v_mult,
    'quetes',        v_quetes,
    'coffre',        jsonb_build_object('ouvert', v_coffre is not null, 'xp', v_coffre),
    'semaine',       jsonb_build_object(
                       'xp', v_semaine, 'paliers', v_paliers, 'rang', v_rang,
                       'jours_restants', (v_deb + 6) - v_jour),
    'succes',        jsonb_build_object(
                       'obtenus', v_obtenus, 'total', v_total,
                       'recents', v_recents, 'prochains', v_prochains)
  );
end $$;

-- Les trois gestes de simple découverte que seul le navigateur voit.
-- (Plafonnés à 5 par jour et par geste : inutile de les fabriquer.)
create or replace function public.xp_action_client(p_action text, p_ref text)
returns void language plpgsql security definer set search_path = public
as $$
declare v_uid uuid := auth.uid(); v_ref text := left(coalesce(trim(p_ref), ''), 80);
begin
  if v_uid is null or v_ref = '' then return; end if;
  if p_action not in ('visite_artiste', 'decouverte_sortie', 'visite_profil') then return; end if;
  if p_action = 'visite_profil' and v_ref = v_uid::text then return; end if;
  perform public.xp_crediter(v_uid, p_action, v_ref);
end $$;

-- Les annonces à faire : rend ce qui n'a pas encore été vu, puis le marque vu.
create or replace function public.xp_evenements_lire()
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_uid uuid := auth.uid(); v_res jsonb;
begin
  if v_uid is null then return '[]'::jsonb; end if;

  with lus as (
    update public.xp_evenements set vu = true
     where user_id = v_uid and not vu
    returning id, type, donnees, cree_le
  )
  select coalesce(jsonb_agg(jsonb_build_object('type', type, 'donnees', donnees, 'cree_le', cree_le)
                            order by id), '[]'::jsonb)
    into v_res from lus;

  delete from public.xp_evenements where user_id = v_uid and vu and cree_le < now() - interval '30 days';

  return v_res;
end $$;

-- Les succès d'un membre : les siens avec la progression, ceux des autres sans.
create or replace function public.xp_succes_liste(p_user uuid default null)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_moi uuid := auth.uid();
  v_user uuid := coalesce(p_user, auth.uid());
  v_sien boolean;
  m jsonb;
  v_membres integer;
  v_liste jsonb;
begin
  if v_moi is null or v_user is null then return null; end if;
  v_sien := v_user = v_moi;

  if v_sien then
    perform public.xp_succes_evaluer(v_user);
    m := public.xp_metriques(v_user);
  end if;

  select count(*) into v_membres from public.profiles;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', d.id, 'famille', d.famille, 'categorie', d.categorie, 'rang', d.rang,
           'nom',         case when d.secret and o.user_id is null then '???' else d.nom end,
           'description', case when d.secret and o.user_id is null then 'Succès secret : à toi de le trouver.' else d.description end,
           'icone',       case when d.secret and o.user_id is null then '❓' else d.icone end,
           'seuil',       case when d.secret and o.user_id is null then null else d.seuil end,
           'valeur',      case when v_sien and (not d.secret or o.user_id is not null)
                               then coalesce((m ->> d.metrique)::numeric, 0) else null end,
           'xp', d.xp, 'secret', d.secret, 'obtenu_le', o.obtenu_le,
           'detenteurs',  (select count(*) from public.succes_obtenus x where x.succes_id = d.id))
         order by d.ordre), '[]'::jsonb)
    into v_liste
    from public.succes_def d
    left join public.succes_obtenus o on o.succes_id = d.id and o.user_id = v_user;

  return jsonb_build_object('membres', v_membres, 'liste', v_liste);
end $$;

-- Le classement : la semaine en cours, ou depuis le début.
create or replace function public.xp_classement(p_periode text default 'semaine')
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_deb date := date_trunc('week', public.xp_jour())::date; v_res jsonb;
begin
  if auth.uid() is null then return null; end if;

  with s as (
    select p.id, p.pseudo, p.avatar_url, coalesce(p.xp, 0) as xp_total,
           case when p_periode = 'total' then coalesce(p.xp, 0)
                else coalesce((select sum(j.xp) from public.xp_journal j where j.user_id = p.id and j.jour >= v_deb), 0)
           end as xp
      from public.profiles p
  ), r as (
    select s.*, rank() over (order by s.xp desc) as rang from s where s.xp > 0
  )
  select jsonb_build_object(
    'periode', case when p_periode = 'total' then 'total' else 'semaine' end,
    'top', coalesce((select jsonb_agg(jsonb_build_object(
                       'rang', t.rang, 'user_id', t.id, 'pseudo', t.pseudo, 'avatar_url', t.avatar_url,
                       'xp', t.xp, 'niveau', public.xp_niveau(t.xp_total)) order by t.rang, t.pseudo)
                      from (select * from r order by rang, pseudo limit 20) t), '[]'::jsonb),
    'moi', (select jsonb_build_object('rang', r.rang, 'xp', r.xp) from r where r.id = auth.uid())
  ) into v_res;

  return v_res;
end $$;

-- Seules ces cinq fonctions sont appelables depuis le navigateur.
revoke all on function public.xp_evt(uuid, text, jsonb)                     from public, anon, authenticated;
revoke all on function public.xp_etat_assurer(uuid)                         from public, anon, authenticated;
revoke all on function public.xp_brut(uuid, text, text, integer)            from public, anon, authenticated;
revoke all on function public.xp_niveau_verifier(uuid)                      from public, anon, authenticated;
revoke all on function public.xp_serie_toucher(uuid)                        from public, anon, authenticated;
revoke all on function public.xp_quetes_assurer(uuid)                       from public, anon, authenticated;
revoke all on function public.xp_quetes_avancer(uuid, text)                 from public, anon, authenticated;
revoke all on function public.xp_semaine_verifier(uuid)                     from public, anon, authenticated;
revoke all on function public.xp_metriques(uuid)                            from public, anon, authenticated;
revoke all on function public.xp_succes_evaluer(uuid, boolean)              from public, anon, authenticated;
revoke all on function public.xp_crediter(uuid, text, text)                 from public, anon, authenticated;
revoke all on function public.xp_profil_verifier(uuid)                      from public, anon, authenticated;
revoke all on function public.xp_trg_release_ratings()                      from public, anon, authenticated;
revoke all on function public.xp_trg_com_posts()                            from public, anon, authenticated;
revoke all on function public.xp_trg_com_commentaires()                     from public, anon, authenticated;
revoke all on function public.xp_trg_com_reactions()                        from public, anon, authenticated;
revoke all on function public.xp_trg_com_suivis()                           from public, anon, authenticated;
revoke all on function public.xp_trg_profiles()                             from public, anon, authenticated;

revoke all on function public.xp_moi()                         from public, anon;
revoke all on function public.xp_action_client(text, text)     from public, anon;
revoke all on function public.xp_evenements_lire()             from public, anon;
revoke all on function public.xp_succes_liste(uuid)            from public, anon;
revoke all on function public.xp_classement(text)              from public, anon;
grant execute on function public.xp_moi()                      to authenticated;
grant execute on function public.xp_action_client(text, text)  to authenticated;
grant execute on function public.xp_evenements_lire()          to authenticated;
grant execute on function public.xp_succes_liste(uuid)         to authenticated;
grant execute on function public.xp_classement(text)           to authenticated;


-- ---------------------------------------------------------------------
-- 9. Rattrapage des comptes existants (en silence, sans XP en plus)
-- ---------------------------------------------------------------------

insert into public.xp_etat (user_id, niveau_vu)
select p.id, public.xp_niveau(coalesce(p.xp, 0)) from public.profiles p
on conflict (user_id) do nothing;

-- Les étapes de démarrage déjà payées à l'ancienne ne le seront pas deux fois.
insert into public.xp_journal (user_id, action, ref, xp, jour, cree_le)
select p.id, 'profil_photo', '1', 0, date '2000-01-01', timestamptz '2000-01-01'
  from public.profiles p where coalesce(p.avatar_url, '') <> ''
on conflict do nothing;

insert into public.xp_journal (user_id, action, ref, xp, jour, cree_le)
select p.id, 'profil_bio', '1', 0, date '2000-01-01', timestamptz '2000-01-01'
  from public.profiles p where nullif(trim(coalesce(p.bio, '')), '') is not null
on conflict do nothing;

insert into public.xp_journal (user_id, action, ref, xp, jour, cree_le)
select p.id, 'profil_reseaux', '1', 0, date '2000-01-01', timestamptz '2000-01-01'
  from public.profiles p
 where exists (select 1 from jsonb_each_text(coalesce(p.socials, '{}'::jsonb)) s where nullif(trim(s.value), '') is not null)
on conflict do nothing;

insert into public.xp_journal (user_id, action, ref, xp, jour, cree_le)
select distinct x.auteur_id, 'premier_post', '1', 0, date '2000-01-01', timestamptz '2000-01-01'
  from public.com_posts x
 where exists (select 1 from public.profiles p where p.id = x.auteur_id)
on conflict do nothing;

select public.xp_succes_evaluer(id, true) from public.profiles;
