-- =====================================================================
-- La Wave — la saison Halloween, et tout ce qui l'entoure
--
-- La saison 1 devient « Halloween » (21 octobre → 30 novembre) et le système
-- de saison passe de 8 récompenses à une vraie saison :
--
--   • 30 paliers de récompenses (au lieu de 8) : titres, cadres d'avatar,
--     couleurs de pseudo, et un nouveau type, les emblèmes (un petit
--     symbole à côté du pseudo), plus deux gels de série ;
--   • 4 chapitres de quelques jours, chacun avec ses défis et sa
--     récompense, et une récompense pour qui les termine tous ;
--   • des défis de saison qui durent toute la saison ;
--   • des événements : XP multiplié (Nuit d'Halloween ×2, Toussaint ×1,5,
--     trois nuits finales ×1,5) ;
--   • la citrouille du jour : une surprise par jour (des points de saison) ;
--   • un classement de la saison, et des récompenses pour le podium ;
--   • sept succès liés à la saison ;
--   • les annonces correspondantes (chapitres, événements, fin de saison).
--
-- Rien ne donne d'avantage : seulement du style (les gels de série, déjà
-- plafonnés à 3, sont le seul bonus).
--
-- Les saisons suivantes reçoivent la même structure (30 paliers, 4 chapitres,
-- un événement de fin) aux couleurs choisies dans l'espace équipe ; le décor
-- « Halloween » est réservé à celle-ci.
--
-- À exécuter dans Supabase → SQL Editor, après engagement.sql. Se rejoue sans
-- risque.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Structure
-- ---------------------------------------------------------------------

alter table public.saisons add column if not exists decor text;

-- Un quatrième type de cosmétique (l'emblème) et trois nouvelles façons de les gagner.
alter table public.cosmetiques drop constraint if exists cosmetiques_type_check;
alter table public.cosmetiques add constraint cosmetiques_type_check
  check (type in ('cadre', 'titre', 'couleur', 'embleme'));

alter table public.cosmetiques drop constraint if exists cosmetiques_source_check;
alter table public.cosmetiques add constraint cosmetiques_source_check
  check (source in ('defaut', 'niveau', 'succes', 'saison', 'chapitre', 'classement'));

alter table public.cosmetiques add column if not exists chapitre integer;   -- source « chapitre » : n° du chapitre, 0 = tous
alter table public.cosmetiques add column if not exists rang_max integer;   -- source « classement » : 1, 3, 10…

alter table public.cosmetiques_equipes
  add column if not exists embleme text references public.cosmetiques(id) on delete set null;

alter table public.saison_paliers add column if not exists bonus text;      -- 'gel' : un gel de série à la place d'un cosmétique
alter table public.saison_defis   add column if not exists chapitre integer; -- vide : défi de toute la saison

create table if not exists public.saison_chapitres (
  saison_id   uuid not null references public.saisons(id) on delete cascade,
  numero      integer not null,
  nom         text not null,
  description text not null default '',
  debut       date not null,
  fin         date not null,
  annonce     boolean not null default false,
  primary key (saison_id, numero),
  check (fin >= debut)
);

create table if not exists public.saison_evenements (
  id             bigint generated always as identity primary key,
  saison_id      uuid not null references public.saisons(id) on delete cascade,
  nom            text not null,
  description    text not null default '',
  emoji          text not null default '🎃',
  debut          date not null,
  fin            date not null,
  multiplicateur numeric(3, 2) not null default 1 check (multiplicateur >= 1 and multiplicateur <= 3),
  annonce        boolean not null default false,
  check (fin >= debut)
);

-- La citrouille du jour : une ligne par membre et par jour.
create table if not exists public.saison_citrouilles (
  user_id uuid not null references public.profiles(id) on delete cascade,
  jour    date not null,
  points  integer not null,
  tirage  text not null,
  primary key (user_id, jour)
);

-- Les gels de série déjà offerts par un palier.
create table if not exists public.saison_bonus_obtenus (
  user_id   uuid not null references public.profiles(id) on delete cascade,
  saison_id uuid not null references public.saisons(id) on delete cascade,
  palier    integer not null,
  obtenu_le timestamptz not null default now(),
  primary key (user_id, saison_id, palier)
);

-- Le classement figé à la fin de chaque saison.
create table if not exists public.saison_resultats (
  saison_id uuid not null references public.saisons(id) on delete cascade,
  user_id   uuid not null references public.profiles(id) on delete cascade,
  rang      integer not null,
  points    integer not null,
  palier    integer not null default 0,
  primary key (saison_id, user_id)
);

alter table public.saison_chapitres     enable row level security;
alter table public.saison_evenements    enable row level security;
alter table public.saison_citrouilles   enable row level security;
alter table public.saison_bonus_obtenus enable row level security;
alter table public.saison_resultats     enable row level security;

revoke all on table public.saison_chapitres, public.saison_evenements, public.saison_citrouilles,
                    public.saison_bonus_obtenus, public.saison_resultats
  from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 2. Les points : défis de chapitre, citrouilles, événements
-- ---------------------------------------------------------------------

-- Un défi de chapitre ne compte que les gestes faits pendant le chapitre.
create or replace function public.saison_defi_progres(p_user uuid, p_defi bigint)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
    from public.saison_defis d
    join public.saisons s on s.id = d.saison_id
    left join public.saison_chapitres c on c.saison_id = d.saison_id and c.numero = d.chapitre
    join public.xp_journal j on j.user_id = p_user and j.action = d.action
                            and j.jour between coalesce(c.debut, s.debut) and coalesce(c.fin, s.fin)
   where d.id = p_defi
$$;

-- Les points de saison : l'XP gagné pendant la saison, les défis accomplis, les citrouilles.
create or replace function public.saison_points(p_user uuid, p_saison uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select (
    coalesce((select sum(j.xp) from public.xp_journal j, public.saisons s
               where s.id = p_saison and j.user_id = p_user and j.jour between s.debut and s.fin), 0)
    + coalesce((select sum(d.points) from public.saison_defis d
                 where d.saison_id = p_saison and public.saison_defi_progres(p_user, d.id) >= d.objectif), 0)
    + coalesce((select sum(c.points) from public.saison_citrouilles c, public.saisons s
                 where s.id = p_saison and c.user_id = p_user and c.jour between s.debut and s.fin), 0)
  )::integer
$$;

-- Un chapitre est terminé quand tous ses défis le sont ; le chapitre 0 = tous les chapitres.
create or replace function public.saison_chapitre_fait(p_user uuid, p_saison uuid, p_num integer)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare c record;
begin
  if p_num = 0 then
    if not exists (select 1 from public.saison_chapitres where saison_id = p_saison) then return false; end if;
    for c in select numero from public.saison_chapitres where saison_id = p_saison loop
      if not public.saison_chapitre_fait(p_user, p_saison, c.numero) then return false; end if;
    end loop;
    return true;
  end if;

  if not exists (select 1 from public.saison_defis where saison_id = p_saison and chapitre = p_num) then return false; end if;

  return not exists (
    select 1 from public.saison_defis d
     where d.saison_id = p_saison and d.chapitre = p_num
       and public.saison_defi_progres(p_user, d.id) < d.objectif);
end $$;

-- Le multiplicateur d'XP du jour (événements de saison) : 1 quand rien ne se passe.
create or replace function public.xp_evenement_mult(p_jour date)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(max(multiplicateur), 1) from public.saison_evenements where p_jour between debut and fin
$$;

-- xp_crediter, tel qu'il tourne en production, avec une seule ligne de plus : le multiplicateur d'événement.
create or replace function public.xp_crediter(p_user uuid, p_action text, p_ref text default ''::text)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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

  v_mult := (case when v_serie >= 14 then 1.5 when v_serie >= 7 then 1.25 when v_serie >= 3 then 1.1 else 1 end)
            * public.xp_evenement_mult(v_jour);

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
end $function$;


-- ---------------------------------------------------------------------
-- 3. Cosmétiques : l'emblème, et les nouvelles façons de gagner
-- ---------------------------------------------------------------------

create or replace function public.cosmetique_condition(k public.cosmetiques)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case k.source
    when 'defaut' then 'Offert'
    when 'niveau' then 'Atteindre le niveau ' || k.niveau_requis
    when 'succes' then 'Succès « ' || coalesce((select nom from public.succes_def where id = k.succes_id), '?') || ' »'
    when 'chapitre' then case when k.chapitre = 0 then 'Terminer les 4 chapitres de la saison'
                              else 'Terminer le chapitre ' || k.chapitre || ' de la saison' end
    when 'classement' then case when k.rang_max = 1 then 'Finir 1er du classement de la saison'
                                else 'Finir dans les ' || k.rang_max || ' premiers du classement de la saison' end
    else coalesce((select s.nom || ' · palier ' || k.palier || ' (' || sp.points || ' pts)'
                     from public.saisons s join public.saison_paliers sp on sp.saison_id = s.id and sp.palier = k.palier
                    where s.id = k.saison_id), 'Saison')
  end
$$;

-- Débloque tout ce qui est mérité : niveau, succès, paliers, chapitres, classement, gels de série.
-- Annonce (toast + notification) sauf la toute première fois, pour ne pas inonder un compte qui existait déjà.
create or replace function public.cosmetiques_synchroniser(p_user uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_premiere boolean; v_niv integer; c record; g record; v_ins integer; v_n integer := 0;
begin
  if not exists (select 1 from public.profiles where id = p_user) then return 0; end if;

  select not exists (select 1 from public.cosmetiques_obtenus where user_id = p_user) into v_premiere;
  select public.xp_niveau(coalesce(xp, 0)) into v_niv from public.profiles where id = p_user;

  for c in
    select k.*
      from public.cosmetiques k
     where not exists (select 1 from public.cosmetiques_obtenus o where o.user_id = p_user and o.cosmetique_id = k.id)
       and (
            k.source = 'defaut'
         or (k.source = 'niveau' and v_niv >= coalesce(k.niveau_requis, 9999))
         or (k.source = 'succes' and exists (select 1 from public.succes_obtenus so where so.user_id = p_user and so.succes_id = k.succes_id))
         or (k.source = 'saison' and exists (
               select 1 from public.saison_paliers sp join public.saisons s on s.id = sp.saison_id
                where sp.saison_id = k.saison_id and sp.palier = k.palier and sp.cosmetique_id = k.id
                  and s.debut <= public.xp_jour()
                  and public.saison_points(p_user, s.id) >= sp.points))
         or (k.source = 'chapitre' and public.saison_chapitre_fait(p_user, k.saison_id, k.chapitre))
         or (k.source = 'classement' and exists (
               select 1 from public.saison_resultats r
                where r.saison_id = k.saison_id and r.user_id = p_user and r.rang <= k.rang_max))
       )
     order by k.ordre
  loop
    insert into public.cosmetiques_obtenus (user_id, cosmetique_id) values (p_user, c.id) on conflict do nothing;
    get diagnostics v_ins = row_count;
    if v_ins > 0 then
      v_n := v_n + 1;
      if not v_premiere and c.source <> 'defaut' then
        perform public.xp_evt(p_user, 'cosmetique', jsonb_build_object('id', c.id, 'type', c.type, 'nom', c.nom, 'style', c.style));
        perform public.com_notifier_systeme(p_user, 'cosmetique', 'cosm:' || c.id,
          jsonb_build_object('id', c.id, 'type', c.type, 'nom', c.nom, 'style', c.style));
      end if;
    end if;
  end loop;

  -- Les paliers qui offrent un gel de série (3 au maximum, comme toujours).
  for g in
    select sp.saison_id, sp.palier
      from public.saison_paliers sp join public.saisons s on s.id = sp.saison_id
     where sp.bonus = 'gel' and s.debut <= public.xp_jour()
       and public.saison_points(p_user, s.id) >= sp.points
       and not exists (select 1 from public.saison_bonus_obtenus b
                        where b.user_id = p_user and b.saison_id = sp.saison_id and b.palier = sp.palier)
     order by sp.palier
  loop
    insert into public.saison_bonus_obtenus (user_id, saison_id, palier) values (p_user, g.saison_id, g.palier)
    on conflict do nothing;
    get diagnostics v_ins = row_count;
    if v_ins > 0 then
      perform public.xp_etat_assurer(p_user);
      update public.xp_etat set gels = least(3, gels + 1) where user_id = p_user;
      v_n := v_n + 1;
      if not v_premiere then
        perform public.xp_evt(p_user, 'saison_gel', jsonb_build_object('palier', g.palier));
      end if;
    end if;
  end loop;

  return v_n;
end $$;

create or replace function public.cosmetiques_moi()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return null; end if;

  perform public.cosmetiques_synchroniser(v_uid);

  return jsonb_build_object(
    'catalogue', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', k.id, 'type', k.type, 'nom', k.nom, 'description', k.description, 'rarete', k.rarete,
               'style', k.style, 'source', k.source, 'condition', public.cosmetique_condition(k),
               'obtenu', o.obtenu_le is not null, 'obtenu_le', o.obtenu_le)
             order by k.type, (o.obtenu_le is null), k.ordre, k.id)
        from public.cosmetiques k
        left join public.cosmetiques_obtenus o on o.cosmetique_id = k.id and o.user_id = v_uid
    ), '[]'::jsonb),
    'equipe', coalesce((
      select jsonb_build_object('cadre', e.cadre, 'titre', e.titre, 'couleur', e.couleur, 'embleme', e.embleme)
        from public.cosmetiques_equipes e where e.user_id = v_uid
    ), jsonb_build_object('cadre', null, 'titre', null, 'couleur', null, 'embleme', null))
  );
end $$;

create or replace function public.cosmetique_equiper(p_type text, p_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid(); k public.cosmetiques%rowtype;
begin
  if v_uid is null then raise exception 'Connecte-toi.'; end if;
  if p_type not in ('cadre', 'titre', 'couleur', 'embleme') then raise exception 'Type inconnu.'; end if;

  if p_id is not null then
    select * into k from public.cosmetiques where id = p_id;
    if not found or k.type <> p_type then raise exception 'Cosmétique inconnu.'; end if;
    if not exists (select 1 from public.cosmetiques_obtenus where user_id = v_uid and cosmetique_id = p_id) then
      raise exception 'Tu ne l''as pas encore débloqué.';
    end if;
  end if;

  insert into public.cosmetiques_equipes (user_id) values (v_uid) on conflict do nothing;

  if p_type = 'cadre' then update public.cosmetiques_equipes set cadre = p_id where user_id = v_uid;
  elsif p_type = 'titre' then update public.cosmetiques_equipes set titre = p_id where user_id = v_uid;
  elsif p_type = 'couleur' then update public.cosmetiques_equipes set couleur = p_id where user_id = v_uid;
  else update public.cosmetiques_equipes set embleme = p_id where user_id = v_uid;
  end if;
end $$;

-- L'auteur vu par le site : cadre, titre, couleur, emblème et rang de découvreur en plus.
create or replace function public.com_auteur_json(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select jsonb_build_object(
        'id',         p.id,
        'pseudo',     p.pseudo,
        'avatar_url', p.avatar_url,
        'role',       public.com_role_canonique(p.role),
        'xp',         coalesce(p.xp, 0),
        'equipe',     coalesce(p.is_admin, false),
        'verifie',    coalesce(p.verifie, false),
        'ville',      p.ville,
        'artiste',    (
          select a.instagram_handle from public.artists a
           where a.verifie_par = p.id
           order by a.instagram_handle
           limit 1
        ),
        'cadre',      (select k.style from public.cosmetiques_equipes e join public.cosmetiques k on k.id = e.cadre where e.user_id = p.id),
        'titre',      (select k.nom from public.cosmetiques_equipes e join public.cosmetiques k on k.id = e.titre where e.user_id = p.id),
        'couleur',    (select k.style from public.cosmetiques_equipes e join public.cosmetiques k on k.id = e.couleur where e.user_id = p.id),
        'embleme',    (select k.style ->> 'emoji' from public.cosmetiques_equipes e join public.cosmetiques k on k.id = e.embleme where e.user_id = p.id),
        'decouvreur', public.decouvreur_rang((select count(*)::integer from public.pepites x where x.user_id = p.id))
      )
      from public.profiles p
      where p.id = p_id
    ),
    jsonb_build_object(
      'id', null, 'pseudo', 'Compte supprimé', 'avatar_url', null,
      'role', 'Autre', 'xp', 0, 'equipe', false, 'verifie', false, 'ville', null, 'artiste', null
    )
  );
$$;

-- Un cosmétique tel que le site le montre, avec « est-ce que je l'ai ? ».
create or replace function public.saison_cosm_json(p_id text, p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
           'id', k.id, 'type', k.type, 'nom', k.nom, 'description', k.description, 'rarete', k.rarete, 'style', k.style,
           'condition', public.cosmetique_condition(k),
           'obtenu', exists (select 1 from public.cosmetiques_obtenus o where o.user_id = p_user and o.cosmetique_id = k.id))
    from public.cosmetiques k where k.id = p_id
$$;


-- ---------------------------------------------------------------------
-- 4. Le contenu d'une saison : le « pack »
--
--    Un pack décrit 30 paliers, 4 chapitres (avec leurs défis), les défis de
--    toute la saison, les événements et les récompenses spéciales. Halloween a
--    le sien, écrit à la main ; les autres saisons reçoivent un pack
--    générique aux couleurs de la saison.
-- ---------------------------------------------------------------------

create or replace function public.saison_pack_halloween()
returns jsonb
language sql
immutable
as $json$
select $pack$
{
  "paliers": [
    {"k": 1,  "type": "titre",   "nom": "Âme en peine",          "rarete": "commun"},
    {"k": 2,  "type": "couleur", "nom": "Orange citrouille",     "rarete": "commun",     "style": {"a": "#ff7a1a", "b": "#ffc44d"}},
    {"k": 3,  "type": "cadre",   "nom": "Toile d'araignée",      "rarete": "commun",     "style": {"a": "#d8dde6", "b": "#7a8494"}},
    {"k": 4,  "type": "titre",   "nom": "Chasseur de fantômes",  "rarete": "commun"},
    {"k": 5,  "type": "embleme", "nom": "Citrouille",            "rarete": "commun",     "style": {"emoji": "🎃"}},
    {"k": 6,  "type": "gel"},
    {"k": 7,  "type": "titre",   "nom": "Apprenti sorcier",      "rarete": "commun"},
    {"k": 8,  "type": "cadre",   "nom": "Citrouille hantée",     "rarete": "rare",       "style": {"a": "#ff7a1a", "b": "#ffc44d", "anim": "pulse"}},
    {"k": 9,  "type": "embleme", "nom": "Chauve-souris",         "rarete": "commun",     "style": {"emoji": "🦇"}},
    {"k": 10, "type": "titre",   "nom": "Veilleur de nuit",      "rarete": "rare"},
    {"k": 11, "type": "couleur", "nom": "Rouge sang",            "rarete": "rare",       "style": {"a": "#ff3b4e", "b": "#a30f24"}},
    {"k": 12, "type": "cadre",   "nom": "Brume violette",        "rarete": "rare",       "style": {"a": "#8b5cf6", "b": "#e0aaff", "anim": "pulse"}},
    {"k": 13, "type": "titre",   "nom": "Noctambule",            "rarete": "rare"},
    {"k": 14, "type": "embleme", "nom": "Fantôme",               "rarete": "rare",       "style": {"emoji": "👻"}},
    {"k": 15, "type": "couleur", "nom": "Brume d'automne",       "rarete": "rare",       "style": {"a": "#c9b8ff", "b": "#8b5cf6"}},
    {"k": 16, "type": "titre",   "nom": "Vampire mélomane",      "rarete": "rare"},
    {"k": 17, "type": "cadre",   "nom": "Lune de sang",          "rarete": "epique",     "style": {"a": "#7a0c1c", "b": "#ff3b4e", "anim": "pulse"}},
    {"k": 18, "type": "embleme", "nom": "Toile tissée",          "rarete": "rare",       "style": {"emoji": "🕸️"}},
    {"k": 19, "type": "titre",   "nom": "Maître des ombres",     "rarete": "epique"},
    {"k": 20, "type": "couleur", "nom": "Ectoplasme",            "rarete": "epique",     "style": {"a": "#7dff6a", "b": "#12d9c4"}},
    {"k": 21, "type": "cadre",   "nom": "Feu follet",            "rarete": "epique",     "style": {"a": "#7dff6a", "b": "#12d9c4", "c": "#b4ff9a", "anim": "tourne"}},
    {"k": 22, "type": "gel"},
    {"k": 23, "type": "titre",   "nom": "Spectre du dancefloor", "rarete": "epique"},
    {"k": 24, "type": "embleme", "nom": "Bougie",                "rarete": "epique",     "style": {"emoji": "🕯️"}},
    {"k": 25, "type": "cadre",   "nom": "Spectre",               "rarete": "epique",     "style": {"a": "#e8f4ff", "b": "#7fb7ff", "c": "#ffffff", "anim": "tourne"}},
    {"k": 26, "type": "couleur", "nom": "Nuit étoilée",          "rarete": "epique",     "style": {"a": "#8b5cf6", "b": "#27c4ff"}},
    {"k": 27, "type": "titre",   "nom": "Seigneur d'Halloween",  "rarete": "legendaire"},
    {"k": 28, "type": "cadre",   "nom": "Sorcière",              "rarete": "legendaire", "style": {"a": "#8b5cf6", "b": "#7dff6a", "c": "#ff7a1a", "anim": "tourne"}},
    {"k": 29, "type": "embleme", "nom": "Pleine lune",           "rarete": "epique",     "style": {"emoji": "🌙"}},
    {"k": 30, "type": "cadre",   "nom": "Minuit",                "rarete": "legendaire", "style": {"a": "#ff7a1a", "b": "#8b5cf6", "c": "#ffd166", "anim": "tourne"}}
  ],
  "chapitres": [
    {"n": 1, "nom": "Les Premiers Frissons", "description": "La brume se lève sur les sorties. Montre que tu n'as pas peur du noir.",
     "de": 0, "a": 6,
     "defis": [["Noter 5 sorties", "note", 5, 40], ["Écouter 8 sorties", "ecoute", 8, 40], ["Voter à 2 duels", "duel", 2, 40], ["Passer 5 jours sur le site", "connexion", 5, 60]]},
    {"n": 2, "nom": "La Semaine Maudite", "description": "Halloween approche. Le 31, tout ce que tu fais rapporte le double.",
     "de": 7, "a": 13,
     "defis": [["Noter 8 sorties", "note", 8, 60], ["Écrire 3 avis", "avis", 3, 80], ["Commenter 5 fois", "commentaire", 5, 50], ["Voter à 2 duels", "duel", 2, 60], ["Passer 6 jours sur le site", "connexion", 6, 80]]},
    {"n": 3, "nom": "Brumes de Novembre", "description": "Les fantômes s'attardent. Deux semaines pour fouiller les sorties.",
     "de": 14, "a": 27,
     "defis": [["Noter 12 sorties", "note", 12, 80], ["Écouter 15 sorties", "ecoute", 15, 80], ["Publier 3 messages", "post", 3, 70], ["Découvrir 5 artistes", "visite_artiste", 5, 60], ["Voter à 4 duels", "duel", 4, 70]]},
    {"n": 4, "nom": "Le Dernier Sabbat", "description": "La dernière ligne droite avant la fin de la saison. Trois nuits finales à XP augmenté.",
     "de": 28, "a": null,
     "defis": [["Noter 15 sorties", "note", 15, 100], ["Écrire 4 avis", "avis", 4, 100], ["Voter à 4 duels", "duel", 4, 80], ["Réagir 20 fois", "reaction", 20, 60], ["Passer 8 jours sur le site", "connexion", 8, 100]]}
  ],
  "epopee": [
    ["Noter 40 sorties", "note", 40, 250], ["Écouter 50 sorties", "ecoute", 50, 250], ["Écrire 12 avis", "avis", 12, 300],
    ["Voter à 10 duels", "duel", 10, 200], ["Commenter 25 fois", "commentaire", 25, 200], ["Publier 10 messages", "post", 10, 200],
    ["Réagir 60 fois", "reaction", 60, 150], ["Passer 30 jours sur le site", "connexion", 30, 300]
  ],
  "evenements": [
    {"nom": "Nuit d'Halloween", "emoji": "🎃", "description": "Toute l'XP gagnée le 31 octobre est doublée.",
     "mois": 10, "jour": 31, "duree": 1, "mult": 2},
    {"nom": "Toussaint et Jour des morts", "emoji": "💀", "description": "1er et 2 novembre : l'XP est multipliée par 1,5.",
     "mois": 11, "jour": 1, "duree": 2, "mult": 1.5},
    {"nom": "Les trois nuits finales", "emoji": "🧙", "description": "Les trois derniers jours de la saison, l'XP est multipliée par 1,5.",
     "fin_saison": 3, "mult": 1.5}
  ],
  "recompenses": [
    {"id": "ch1",   "source": "chapitre",   "chapitre": 1,  "type": "titre",   "nom": "Survivant de la première nuit", "rarete": "rare"},
    {"id": "ch2",   "source": "chapitre",   "chapitre": 2,  "type": "embleme", "nom": "Boule de cristal",              "rarete": "rare",       "style": {"emoji": "🔮"}},
    {"id": "ch3",   "source": "chapitre",   "chapitre": 3,  "type": "couleur", "nom": "Lueur d'automne",               "rarete": "epique",     "style": {"a": "#ff9d3d", "b": "#ffe29a"}},
    {"id": "ch4",   "source": "chapitre",   "chapitre": 4,  "type": "cadre",   "nom": "Sabbat",                        "rarete": "epique",     "style": {"a": "#8b5cf6", "b": "#ff7a1a", "c": "#7dff6a", "anim": "tourne"}},
    {"id": "chall", "source": "chapitre",   "chapitre": 0,  "type": "titre",   "nom": "Maître du Sabbat",              "rarete": "legendaire"},
    {"id": "top1",  "source": "classement", "rang_max": 1,  "type": "titre",   "nom": "Souverain de la Nuit",          "rarete": "legendaire"},
    {"id": "top3",  "source": "classement", "rang_max": 3,  "type": "cadre",   "nom": "Podium maudit",                 "rarete": "legendaire", "style": {"a": "#ffd166", "b": "#ff3b4e", "c": "#8b5cf6", "anim": "tourne"}},
    {"id": "top10", "source": "classement", "rang_max": 10, "type": "embleme", "nom": "Élu de la nuit",                "rarete": "epique",     "style": {"emoji": "🏆"}}
  ]
}
$pack$::jsonb
$json$;

-- Le pack des autres saisons : les mêmes 30 paliers et 4 chapitres, aux couleurs de la saison.
create or replace function public.saison_pack_generique(p_saison uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s public.saisons%rowtype;
  v_types text[] := array['titre','couleur','cadre','titre','embleme','gel','titre','cadre','embleme','titre',
                          'couleur','cadre','titre','embleme','couleur','titre','cadre','embleme','titre','couleur',
                          'cadre','gel','titre','embleme','cadre','couleur','titre','cadre','embleme','cadre'];
  v_mots text[] := array['Éclaireur','Initié','Habitué','Fidèle','Vétéran','Expert','Maître','Légende','Mythe'];
  v_emojis text[] := array['⭐','🎵','🔥','💎','👑','🏆'];
  v_romain text[] := array['I','II','III','IV','V','VI','VII','VIII','IX'];
  v_paliers jsonb := '[]'::jsonb;
  k integer; t text;
  n_titre integer := 0; n_cadre integer := 0; n_couleur integer := 0; n_emb integer := 0;
  v_rarete text; v_style jsonb; v_nom text;
  v_defis jsonb := '[["Noter 6 sorties","note",6,60],["Écouter 8 sorties","ecoute",8,60],["Écrire 2 avis","avis",2,80],["Passer 4 jours sur le site","connexion",4,60]]';
begin
  select * into s from public.saisons where id = p_saison;

  for k in 1..30 loop
    t := v_types[k];
    v_rarete := case when k >= 27 then 'legendaire' when k >= 17 then 'epique' when k >= 8 then 'rare' else 'commun' end;
    v_style := '{}'::jsonb;
    v_nom := null;

    if t = 'titre' then
      n_titre := n_titre + 1;
      v_nom := s.theme || ' · ' || v_mots[least(n_titre, 9)];
    elsif t = 'cadre' then
      n_cadre := n_cadre + 1;
      v_nom := 'Cadre ' || s.theme || ' ' || v_romain[least(n_cadre, 9)];
      v_style := case
        when n_cadre <= 2 then jsonb_build_object('a', s.couleur_a, 'b', s.couleur_b)
        when n_cadre <= 4 then jsonb_build_object('a', s.couleur_a, 'b', s.couleur_b, 'anim', 'pulse')
        when n_cadre <= 6 then jsonb_build_object('a', s.couleur_a, 'b', s.couleur_b, 'c', s.couleur_c, 'anim', 'tourne')
        else jsonb_build_object('a', s.couleur_c, 'b', s.couleur_a, 'c', s.couleur_b, 'anim', 'tourne') end;
    elsif t = 'couleur' then
      n_couleur := n_couleur + 1;
      v_nom := 'Pseudo ' || s.theme || ' ' || v_romain[least(n_couleur, 9)];
      v_style := case n_couleur % 3
        when 1 then jsonb_build_object('a', s.couleur_a, 'b', s.couleur_b)
        when 2 then jsonb_build_object('a', s.couleur_b, 'b', s.couleur_c)
        else jsonb_build_object('a', s.couleur_c, 'b', s.couleur_a) end;
    elsif t = 'embleme' then
      n_emb := n_emb + 1;
      v_nom := 'Emblème ' || s.theme || ' ' || v_romain[least(n_emb, 9)];
      v_style := jsonb_build_object('emoji', v_emojis[least(n_emb, 6)]);
    end if;

    v_paliers := v_paliers || jsonb_build_array(
      case when t = 'gel' then jsonb_build_object('k', k, 'type', 'gel')
           else jsonb_build_object('k', k, 'type', t, 'nom', v_nom, 'rarete', v_rarete, 'style', v_style) end);
  end loop;

  return jsonb_build_object(
    'paliers', v_paliers,
    'chapitres', jsonb_build_array(
      jsonb_build_object('n', 1, 'nom', 'Chapitre 1', 'description', 'Les premiers jours de la saison.', 'defis', v_defis),
      jsonb_build_object('n', 2, 'nom', 'Chapitre 2', 'description', 'La saison prend son rythme.', 'defis', v_defis),
      jsonb_build_object('n', 3, 'nom', 'Chapitre 3', 'description', 'Le cœur de la saison.', 'defis', v_defis),
      jsonb_build_object('n', 4, 'nom', 'Chapitre 4', 'description', 'La dernière ligne droite.', 'defis', v_defis)
    ),
    'epopee', '[["Noter 40 sorties","note",40,250],["Écouter 50 sorties","ecoute",50,250],["Écrire 12 avis","avis",12,300],["Voter à 10 duels","duel",10,200],["Commenter 25 fois","commentaire",25,200],["Passer 30 jours sur le site","connexion",30,300]]'::jsonb,
    'evenements', jsonb_build_array(
      jsonb_build_object('nom', 'Les derniers jours', 'emoji', '🔥', 'description', 'Les deux derniers jours de la saison, l''XP est multipliée par 1,5.', 'fin_saison', 2, 'mult', 1.5)),
    'recompenses', jsonb_build_array(
      jsonb_build_object('id', 'ch1', 'source', 'chapitre', 'chapitre', 1, 'type', 'titre', 'nom', s.theme || ' · Chapitre 1', 'rarete', 'rare'),
      jsonb_build_object('id', 'ch2', 'source', 'chapitre', 'chapitre', 2, 'type', 'embleme', 'nom', s.theme || ' · Chapitre 2', 'rarete', 'rare', 'style', jsonb_build_object('emoji', '📖')),
      jsonb_build_object('id', 'ch3', 'source', 'chapitre', 'chapitre', 3, 'type', 'couleur', 'nom', s.theme || ' · Chapitre 3', 'rarete', 'epique', 'style', jsonb_build_object('a', s.couleur_b, 'b', s.couleur_c)),
      jsonb_build_object('id', 'ch4', 'source', 'chapitre', 'chapitre', 4, 'type', 'cadre', 'nom', s.theme || ' · Chapitre 4', 'rarete', 'epique', 'style', jsonb_build_object('a', s.couleur_a, 'b', s.couleur_c, 'c', s.couleur_b, 'anim', 'tourne')),
      jsonb_build_object('id', 'chall', 'source', 'chapitre', 'chapitre', 0, 'type', 'titre', 'nom', s.theme || ' · Grand Maître', 'rarete', 'legendaire'),
      jsonb_build_object('id', 'top1', 'source', 'classement', 'rang_max', 1, 'type', 'titre', 'nom', s.theme || ' · Numéro 1', 'rarete', 'legendaire'),
      jsonb_build_object('id', 'top3', 'source', 'classement', 'rang_max', 3, 'type', 'cadre', 'nom', s.theme || ' · Podium', 'rarete', 'legendaire', 'style', jsonb_build_object('a', s.couleur_b, 'b', s.couleur_a, 'c', s.couleur_c, 'anim', 'tourne')),
      jsonb_build_object('id', 'top10', 'source', 'classement', 'rang_max', 10, 'type', 'embleme', 'nom', s.theme || ' · Élite', 'rarete', 'epique', 'style', jsonb_build_object('emoji', '🏆'))
    )
  );
end $$;

-- Crée (ou remet à jour) tout le contenu d'une saison : paliers, chapitres, défis, événements, récompenses.
-- Les points déjà gagnés ne sont pas touchés : ils se calculent à la lecture.
create or replace function public.saison_generer_paliers(p_saison uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.saisons%rowtype;
  v_pack jsonb; e jsonb; d jsonb;
  k integer; v_id text; v_pts integer; v_ordre integer;
  v_debut date; v_fin date; v_len integer; v_nb_chap integer;
  v_annonces text[];
begin
  select * into s from public.saisons where id = p_saison;
  if not found then return; end if;

  v_pack := case when s.decor = 'halloween' then public.saison_pack_halloween()
                 else public.saison_pack_generique(s.id) end;

  -- 1. Les 30 paliers.
  for e in select * from jsonb_array_elements(v_pack -> 'paliers') loop
    k := (e ->> 'k')::integer;
    v_pts := (round((60 * k + 4 * k * k) / 10.0) * 10)::integer;

    if e ->> 'type' = 'gel' then
      insert into public.saison_paliers (saison_id, palier, points, cosmetique_id, bonus)
      values (s.id, k, v_pts, null, 'gel')
      on conflict (saison_id, palier) do update set points = excluded.points, cosmetique_id = null, bonus = 'gel';
    else
      v_id := 'saison-' || s.numero || '-' || k;

      insert into public.cosmetiques (id, type, nom, description, rarete, style, source, saison_id, palier, ordre)
      values (v_id, e ->> 'type', e ->> 'nom', 'Récompense de la ' || lower(s.nom) || ' (' || s.theme || '), introuvable ailleurs.',
              e ->> 'rarete', coalesce(e -> 'style', '{}'::jsonb), 'saison', s.id, k, 1000 + s.numero * 100 + k)
      on conflict (id) do update
        set type = excluded.type, nom = excluded.nom, description = excluded.description, rarete = excluded.rarete,
            style = excluded.style, source = 'saison', saison_id = excluded.saison_id, palier = excluded.palier,
            chapitre = null, rang_max = null, ordre = excluded.ordre;

      insert into public.saison_paliers (saison_id, palier, points, cosmetique_id, bonus)
      values (s.id, k, v_pts, v_id, null)
      on conflict (saison_id, palier) do update set points = excluded.points, cosmetique_id = excluded.cosmetique_id, bonus = null;
    end if;
  end loop;

  delete from public.saison_paliers where saison_id = s.id and palier > 30;

  -- Les anciennes récompenses de palier qui ne servent plus (et que personne n'a obtenues) disparaissent.
  delete from public.cosmetiques k
   where k.saison_id = s.id and k.source = 'saison'
     and not exists (select 1 from public.saison_paliers sp where sp.cosmetique_id = k.id)
     and not exists (select 1 from public.cosmetiques_obtenus o where o.cosmetique_id = k.id);

  -- 2. Les chapitres et leurs défis. Le premier est annoncé avec la saison.
  v_len := s.fin - s.debut + 1;
  v_nb_chap := jsonb_array_length(v_pack -> 'chapitres');

  delete from public.saison_defis where saison_id = s.id;
  delete from public.saison_chapitres where saison_id = s.id and numero > v_nb_chap;

  for e in select * from jsonb_array_elements(v_pack -> 'chapitres') loop
    k := (e ->> 'n')::integer;

    if e ? 'de' then
      v_debut := s.debut + (e ->> 'de')::integer;
      v_fin := case when e ->> 'a' is null then s.fin else least(s.fin, s.debut + (e ->> 'a')::integer) end;
    else
      v_debut := s.debut + ((k - 1) * v_len) / v_nb_chap;
      v_fin := case when k = v_nb_chap then s.fin else s.debut + (k * v_len) / v_nb_chap - 1 end;
    end if;

    continue when v_debut > s.fin;

    insert into public.saison_chapitres (saison_id, numero, nom, description, debut, fin, annonce)
    values (s.id, k, e ->> 'nom', coalesce(e ->> 'description', ''), v_debut, v_fin, k = 1)
    on conflict (saison_id, numero) do update
      set nom = excluded.nom, description = excluded.description, debut = excluded.debut, fin = excluded.fin;

    v_ordre := 0;
    for d in select * from jsonb_array_elements(e -> 'defis') loop
      v_ordre := v_ordre + 1;
      insert into public.saison_defis (saison_id, libelle, action, objectif, points, ordre, chapitre)
      values (s.id, d ->> 0, d ->> 1, (d ->> 2)::integer, (d ->> 3)::integer, v_ordre, k);
    end loop;
  end loop;

  -- 3. Les défis de toute la saison.
  v_ordre := 0;
  for d in select * from jsonb_array_elements(v_pack -> 'epopee') loop
    v_ordre := v_ordre + 1;
    insert into public.saison_defis (saison_id, libelle, action, objectif, points, ordre, chapitre)
    values (s.id, d ->> 0, d ->> 1, (d ->> 2)::integer, (d ->> 3)::integer, 100 + v_ordre, null);
  end loop;

  -- 4. Les événements (une annonce déjà faite n'est pas refaite).
  select coalesce(array_agg(nom), '{}') into v_annonces
    from public.saison_evenements where saison_id = s.id and annonce;
  delete from public.saison_evenements where saison_id = s.id;

  for e in select * from jsonb_array_elements(v_pack -> 'evenements') loop
    if e ? 'fin_saison' then
      v_fin := s.fin;
      v_debut := s.fin - ((e ->> 'fin_saison')::integer - 1);
    else
      v_debut := make_date(extract(year from s.debut)::integer, (e ->> 'mois')::integer, (e ->> 'jour')::integer);
      v_fin := v_debut + ((e ->> 'duree')::integer - 1);
    end if;

    continue when v_fin < s.debut or v_debut > s.fin;

    insert into public.saison_evenements (saison_id, nom, description, emoji, debut, fin, multiplicateur, annonce)
    values (s.id, e ->> 'nom', coalesce(e ->> 'description', ''), coalesce(e ->> 'emoji', '🎃'),
            greatest(v_debut, s.debut), least(v_fin, s.fin), (e ->> 'mult')::numeric,
            (e ->> 'nom') = any(v_annonces));
  end loop;

  -- 5. Les récompenses de chapitre et de classement.
  for e in select * from jsonb_array_elements(v_pack -> 'recompenses') loop
    v_id := 'saison-' || s.numero || '-' || (e ->> 'id');

    insert into public.cosmetiques (id, type, nom, description, rarete, style, source, saison_id, chapitre, rang_max, ordre)
    values (v_id, e ->> 'type', e ->> 'nom', 'Récompense de la ' || lower(s.nom) || ' (' || s.theme || '), introuvable ailleurs.',
            e ->> 'rarete', coalesce(e -> 'style', '{}'::jsonb), e ->> 'source', s.id,
            (e ->> 'chapitre')::integer, (e ->> 'rang_max')::integer,
            1100 + s.numero * 100 + coalesce((e ->> 'chapitre')::integer, 0) + coalesce((e ->> 'rang_max')::integer, 0))
    on conflict (id) do update
      set type = excluded.type, nom = excluded.nom, description = excluded.description, rarete = excluded.rarete,
          style = excluded.style, source = excluded.source, saison_id = excluded.saison_id,
          chapitre = excluded.chapitre, rang_max = excluded.rang_max, ordre = excluded.ordre;
  end loop;
end $$;


-- ---------------------------------------------------------------------
-- 5. Ce que le site lit : l'état de la saison, le classement, la citrouille
-- ---------------------------------------------------------------------

create or replace function public.saison_etat()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  s public.saisons%rowtype;
  v_jour date := public.xp_jour();
  v_pts integer; v_actuel integer; v_suivant record; v_cit record; v_rang integer; v_part integer;
begin
  if v_uid is null then return null; end if;

  select * into s from public.saisons where debut <= v_jour order by debut desc limit 1;
  if not found then
    select * into s from public.saisons where debut > v_jour order by debut limit 1;
    if not found then return null; end if;
    return jsonb_build_object('a_venir', true, 'nom', s.nom, 'theme', s.theme, 'decor', s.decor, 'debut', s.debut, 'fin', s.fin,
                              'couleurs', jsonb_build_array(s.couleur_a, s.couleur_b, s.couleur_c));
  end if;

  perform public.cosmetiques_synchroniser(v_uid);

  v_pts := public.saison_points(v_uid, s.id);
  select coalesce(max(palier), 0) into v_actuel from public.saison_paliers where saison_id = s.id and points <= v_pts;
  select * into v_suivant from public.saison_paliers where saison_id = s.id and points > v_pts order by points limit 1;
  select * into v_cit from public.saison_citrouilles where user_id = v_uid and jour = v_jour;

  with p as (
    select u.user_id, public.saison_points(u.user_id, s.id) as pts
      from (select user_id from public.xp_journal where jour between s.debut and s.fin
            union
            select user_id from public.saison_citrouilles where jour between s.debut and s.fin) u
  )
  select case when v_pts > 0 then count(*) filter (where pts > v_pts) + 1 end, count(*) filter (where pts > 0)
    into v_rang, v_part
    from p;

  return jsonb_build_object(
    'id', s.id, 'numero', s.numero, 'nom', s.nom, 'theme', s.theme, 'decor', s.decor,
    'debut', s.debut, 'fin', s.fin, 'terminee', s.fin < v_jour,
    'jours_restants', greatest(s.fin - v_jour, 0),
    'couleurs', jsonb_build_array(s.couleur_a, s.couleur_b, s.couleur_c),
    'points', v_pts, 'palier', v_actuel,
    'total_paliers', (select count(*) from public.saison_paliers where saison_id = s.id),
    'prochain', case when v_suivant.palier is null then null
                     else jsonb_build_object('palier', v_suivant.palier, 'points', v_suivant.points) end,
    'rang', v_rang, 'participants', v_part,
    'multiplicateur', public.xp_evenement_mult(v_jour),
    'citrouille', jsonb_build_object(
      'ouverte', v_cit.jour is not null, 'tirage', v_cit.tirage, 'points', v_cit.points,
      'total', (select count(*) from public.saison_citrouilles c where c.user_id = v_uid and c.jour between s.debut and s.fin)),
    'paliers', coalesce((
      select jsonb_agg(jsonb_build_object(
               'palier', sp.palier, 'points', sp.points, 'atteint', sp.points <= v_pts, 'bonus', sp.bonus,
               'cosmetique', case when k.id is null then null
                                  else jsonb_build_object('id', k.id, 'type', k.type, 'nom', k.nom, 'rarete', k.rarete, 'style', k.style) end)
             order by sp.palier)
        from public.saison_paliers sp left join public.cosmetiques k on k.id = sp.cosmetique_id
       where sp.saison_id = s.id
    ), '[]'::jsonb),
    'chapitres', coalesce((
      select jsonb_agg(jsonb_build_object(
               'numero', c.numero, 'nom', c.nom, 'description', c.description, 'debut', c.debut, 'fin', c.fin,
               'statut', case when c.fin < v_jour then 'termine' when c.debut > v_jour then 'a_venir' else 'en_cours' end,
               'fait', public.saison_chapitre_fait(v_uid, s.id, c.numero),
               'defis', coalesce((
                  select jsonb_agg(jsonb_build_object(
                           'libelle', d.libelle, 'objectif', d.objectif, 'points', d.points,
                           'progres', least(public.saison_defi_progres(v_uid, d.id), d.objectif),
                           'fait', public.saison_defi_progres(v_uid, d.id) >= d.objectif)
                         order by d.ordre, d.id)
                    from public.saison_defis d where d.saison_id = s.id and d.chapitre = c.numero), '[]'::jsonb),
               'recompense', (select public.saison_cosm_json(k.id, v_uid) from public.cosmetiques k
                               where k.saison_id = s.id and k.source = 'chapitre' and k.chapitre = c.numero limit 1))
             order by c.numero)
        from public.saison_chapitres c where c.saison_id = s.id
    ), '[]'::jsonb),
    'defis', coalesce((
      select jsonb_agg(jsonb_build_object(
               'libelle', d.libelle, 'objectif', d.objectif, 'points', d.points,
               'progres', least(public.saison_defi_progres(v_uid, d.id), d.objectif),
               'fait', public.saison_defi_progres(v_uid, d.id) >= d.objectif)
             order by d.ordre, d.id)
        from public.saison_defis d where d.saison_id = s.id and d.chapitre is null
    ), '[]'::jsonb),
    'evenements', coalesce((
      select jsonb_agg(jsonb_build_object(
               'nom', ev.nom, 'description', ev.description, 'emoji', ev.emoji, 'debut', ev.debut, 'fin', ev.fin,
               'multiplicateur', ev.multiplicateur, 'actif', v_jour between ev.debut and ev.fin)
             order by ev.debut)
        from public.saison_evenements ev where ev.saison_id = s.id and ev.fin >= v_jour
    ), '[]'::jsonb),
    'speciales', coalesce((
      select jsonb_agg(public.saison_cosm_json(k.id, v_uid) order by k.source desc, k.ordre)
        from public.cosmetiques k
       where k.saison_id = s.id and ((k.source = 'chapitre' and k.chapitre = 0) or k.source = 'classement')
    ), '[]'::jsonb)
  );
end $$;

-- Le haut du classement de la saison, et ma place.
create or replace function public.saison_classement(p_limite integer default 10)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  s public.saisons%rowtype;
  v_jour date := public.xp_jour();
begin
  if v_uid is null then return null; end if;

  select * into s from public.saisons where debut <= v_jour order by debut desc limit 1;
  if not found then return null; end if;

  p_limite := least(greatest(coalesce(p_limite, 10), 1), 50);

  return (
    with p as (
      select u.user_id, public.saison_points(u.user_id, s.id) as pts
        from (select user_id from public.xp_journal where jour between s.debut and s.fin
              union
              select user_id from public.saison_citrouilles where jour between s.debut and s.fin) u
       where exists (select 1 from public.profiles pr where pr.id = u.user_id)
    ), r as (
      select p.user_id, p.pts, rank() over (order by p.pts desc) as rang from p where p.pts > 0
    )
    select jsonb_build_object(
      'top', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'rang', r.rang, 'points', r.pts, 'moi', r.user_id = v_uid,
                 'palier', (select coalesce(max(sp.palier), 0) from public.saison_paliers sp where sp.saison_id = s.id and sp.points <= r.pts),
                 'membre', public.com_auteur_json(r.user_id))
               order by r.rang, r.user_id)
          from r where r.rang <= p_limite), '[]'::jsonb),
      'moi', (select jsonb_build_object('rang', r.rang, 'points', r.pts) from r where r.user_id = v_uid),
      'participants', (select count(*) from r)
    )
  );
end $$;

-- La citrouille du jour : une surprise par jour, des points de saison.
create or replace function public.saison_citrouille()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  s public.saisons%rowtype;
  v_jour date := public.xp_jour();
  v_deja record; r numeric; v_tirage text; v_pts integer; v_n integer;
begin
  if v_uid is null then raise exception 'Connecte-toi.'; end if;

  select * into s from public.saisons where debut <= v_jour and fin >= v_jour order by debut desc limit 1;
  if not found then raise exception 'Il n''y a pas de saison en cours.'; end if;

  select * into v_deja from public.saison_citrouilles where user_id = v_uid and jour = v_jour;
  if found then
    return jsonb_build_object('deja', true, 'tirage', v_deja.tirage, 'points', v_deja.points);
  end if;

  r := random();
  if r < 0.55 then v_tirage := 'bonbon';       v_pts := 10 + floor(random() * 6)::integer;
  elsif r < 0.85 then v_tirage := 'friandise'; v_pts := 20 + floor(random() * 11)::integer;
  elsif r < 0.97 then v_tirage := 'sortilege'; v_pts := 40 + floor(random() * 11)::integer;
  else v_tirage := 'tresor'; v_pts := 80;
  end if;

  insert into public.saison_citrouilles (user_id, jour, points, tirage) values (v_uid, v_jour, v_pts, v_tirage)
  on conflict do nothing;
  get diagnostics v_n = row_count;

  if v_n = 0 then
    select * into v_deja from public.saison_citrouilles where user_id = v_uid and jour = v_jour;
    return jsonb_build_object('deja', true, 'tirage', v_deja.tirage, 'points', v_deja.points);
  end if;

  perform public.cosmetiques_synchroniser(v_uid);
  perform public.xp_succes_evaluer(v_uid);

  return jsonb_build_object('deja', false, 'tirage', v_tirage, 'points', v_pts);
end $$;


-- ---------------------------------------------------------------------
-- 6. L'équipe : le décor d'une saison
-- ---------------------------------------------------------------------

create or replace function public.saison_equipe_liste()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.est_equipe() then raise exception 'Réservé à l''équipe.'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', s.id, 'numero', s.numero, 'nom', s.nom, 'theme', s.theme, 'decor', s.decor, 'debut', s.debut, 'fin', s.fin,
             'couleurs', jsonb_build_array(s.couleur_a, s.couleur_b, s.couleur_c),
             'participants', (select count(distinct j.user_id) from public.xp_journal j where j.jour between s.debut and s.fin and j.xp > 0))
           order by s.debut desc)
      from public.saisons s
  ), '[]'::jsonb);
end $$;

drop function if exists public.saison_equipe_sauver(uuid, text, text, date, date, text, text, text);

create or replace function public.saison_equipe_sauver(
  p_id uuid, p_nom text, p_theme text, p_debut date, p_fin date, p_a text, p_b text, p_c text, p_decor text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid := p_id; v_num integer;
begin
  if not public.est_equipe() then raise exception 'Réservé à l''équipe.'; end if;

  p_nom := nullif(trim(coalesce(p_nom, '')), '');
  p_theme := nullif(trim(coalesce(p_theme, '')), '');
  p_decor := nullif(trim(coalesce(p_decor, '')), '');
  if p_nom is null or p_theme is null then raise exception 'Donne un nom et un thème à la saison.'; end if;
  if p_decor is not null and p_decor <> 'halloween' then raise exception 'Décor inconnu.'; end if;
  if p_debut is null or p_fin is null or p_fin < p_debut then raise exception 'Les dates de la saison sont incohérentes.'; end if;
  if p_fin - p_debut < 6 or p_fin - p_debut > 90 then raise exception 'Une saison dure entre 1 semaine et 3 mois (4 à 6 semaines conseillées).'; end if;
  if coalesce(p_a, '') !~ '^#[0-9a-fA-F]{6}$' or coalesce(p_b, '') !~ '^#[0-9a-fA-F]{6}$' or coalesce(p_c, '') !~ '^#[0-9a-fA-F]{6}$' then
    raise exception 'Les couleurs doivent être au format #rrggbb.';
  end if;

  if exists (select 1 from public.saisons s where s.id is distinct from v_id and s.debut <= p_fin and s.fin >= p_debut) then
    raise exception 'Cette saison en chevauche une autre.';
  end if;

  if v_id is null then
    select coalesce(max(numero), 0) + 1 into v_num from public.saisons;
    insert into public.saisons (numero, nom, theme, debut, fin, couleur_a, couleur_b, couleur_c, decor)
    values (v_num, p_nom, p_theme, p_debut, p_fin, p_a, p_b, p_c, p_decor)
    returning id into v_id;
  else
    update public.saisons
       set nom = p_nom, theme = p_theme, debut = p_debut, fin = p_fin,
           couleur_a = p_a, couleur_b = p_b, couleur_c = p_c, decor = p_decor
     where id = v_id;
    if not found then raise exception 'Saison introuvable.'; end if;
  end if;

  perform public.saison_generer_paliers(v_id);
  return v_id;
end $$;


-- ---------------------------------------------------------------------
-- 7. Les annonces : début de saison, chapitres, événements, bilan et classement final
-- ---------------------------------------------------------------------

create or replace function public.engagement_saisons()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  s record; c record; ev record; v_uid uuid; v_n integer := 0; v_pts integer; v_pal integer;
  v_jour date := public.xp_jour(); v_total integer; v_rang integer;
begin
  -- Le début d'une saison.
  for s in select * from public.saisons where debut <= v_jour and fin >= v_jour and not annoncee loop
    for v_uid in select * from public.engagement_membres_actifs() loop
      perform public.com_notifier_systeme(v_uid, 'saison', 'saison:' || s.id::text, jsonb_build_object(
        'saison', s.id, 'nom', s.nom, 'theme', s.theme, 'fin', s.fin, 'couleurs', jsonb_build_array(s.couleur_a, s.couleur_b, s.couleur_c)));
    end loop;
    update public.saisons set annoncee = true where id = s.id;
    v_n := v_n + 1;
  end loop;

  -- Un nouveau chapitre commence.
  for c in
    select ch.*, s2.nom as saison_nom, s2.theme, s2.couleur_a, s2.couleur_b, s2.couleur_c
      from public.saison_chapitres ch join public.saisons s2 on s2.id = ch.saison_id
     where ch.debut <= v_jour and ch.fin >= v_jour and not ch.annonce
  loop
    for v_uid in select * from public.engagement_membres_actifs() loop
      perform public.com_notifier_systeme(v_uid, 'saison', 'chapitre:' || c.saison_id::text || ':' || c.numero, jsonb_build_object(
        'saison', c.saison_id, 'nom', c.saison_nom, 'theme', c.theme,
        'chapitre', jsonb_build_object('numero', c.numero, 'nom', c.nom, 'fin', c.fin),
        'couleurs', jsonb_build_array(c.couleur_a, c.couleur_b, c.couleur_c)));
    end loop;
    update public.saison_chapitres set annonce = true where saison_id = c.saison_id and numero = c.numero;
    v_n := v_n + 1;
  end loop;

  -- Un événement approche (la veille) ou commence.
  for ev in
    select e.*, s3.nom as saison_nom, s3.theme, s3.couleur_a, s3.couleur_b, s3.couleur_c
      from public.saison_evenements e join public.saisons s3 on s3.id = e.saison_id
     where e.debut - 1 <= v_jour and e.fin >= v_jour and not e.annonce
  loop
    for v_uid in select * from public.engagement_membres_actifs() loop
      perform public.com_notifier_systeme(v_uid, 'saison', 'evenement:' || ev.id::text, jsonb_build_object(
        'saison', ev.saison_id, 'nom', ev.saison_nom, 'theme', ev.theme,
        'evenement', jsonb_build_object('nom', ev.nom, 'emoji', ev.emoji, 'debut', ev.debut, 'fin', ev.fin, 'multiplicateur', ev.multiplicateur),
        'couleurs', jsonb_build_array(ev.couleur_a, ev.couleur_b, ev.couleur_c)));
    end loop;
    update public.saison_evenements set annonce = true where id = ev.id;
    v_n := v_n + 1;
  end loop;

  -- La fin d'une saison : le classement est figé, les récompenses de podium tombent, le bilan est envoyé.
  for s in select * from public.saisons where fin < v_jour and not fin_notifiee loop

    delete from public.saison_resultats where saison_id = s.id;

    insert into public.saison_resultats (saison_id, user_id, rang, points, palier)
    select s.id, r.user_id, r.rang, r.pts,
           (select coalesce(max(sp.palier), 0) from public.saison_paliers sp where sp.saison_id = s.id and sp.points <= r.pts)
      from (
        select p.user_id, p.pts, rank() over (order by p.pts desc) as rang
          from (
            select u.user_id, public.saison_points(u.user_id, s.id) as pts
              from (select user_id from public.xp_journal where jour between s.debut and s.fin
                    union
                    select user_id from public.saison_citrouilles where jour between s.debut and s.fin) u
             where exists (select 1 from public.profiles pr where pr.id = u.user_id)
          ) p
         where p.pts > 0
      ) r;

    select count(*) into v_total from public.saison_paliers where saison_id = s.id;

    for v_uid in select user_id from public.saison_resultats where saison_id = s.id loop
      perform public.cosmetiques_synchroniser(v_uid);
      select r.points, r.palier, r.rang into v_pts, v_pal, v_rang
        from public.saison_resultats r where r.saison_id = s.id and r.user_id = v_uid;
      perform public.com_notifier_systeme(v_uid, 'saison', 'saison-fin:' || s.id::text, jsonb_build_object(
        'saison', s.id, 'nom', s.nom, 'theme', s.theme, 'fini', true, 'points', v_pts, 'palier', v_pal, 'total', v_total,
        'rang', v_rang, 'couleurs', jsonb_build_array(s.couleur_a, s.couleur_b, s.couleur_c)));
    end loop;

    update public.saisons set fin_notifiee = true where id = s.id;
    v_n := v_n + 1;
  end loop;

  return v_n;
end $$;


-- ---------------------------------------------------------------------
-- 8. Les succès de saison
-- ---------------------------------------------------------------------

create or replace function public.xp_metriques(p_user uuid)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  p public.profiles%rowtype;
  e public.xp_etat%rowtype;
  m jsonb;
  v_saison uuid; v_pts integer := 0;
begin
  select * into p from public.profiles where id = p_user;
  if not found then return '{}'::jsonb; end if;
  select * into e from public.xp_etat where user_id = p_user;

  select id into v_saison from public.saisons where debut <= public.xp_jour() order by debut desc limit 1;
  if v_saison is not null then v_pts := public.saison_points(p_user, v_saison); end if;

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
    'variete',           (select count(distinct j.action) from j),
    'duels',             (select count(*) from public.duel_votes dv where dv.user_id = p_user),
    'pepites',           (select count(*) from public.pepites pe where pe.user_id = p_user),
    'saison_palier',     (select count(*) from public.saison_paliers sp where sp.saison_id = v_saison and sp.points <= v_pts),
    'saison_chapitres',  (select count(*) from public.saison_chapitres ch
                           where ch.saison_id = v_saison and public.saison_chapitre_fait(p_user, ch.saison_id, ch.numero)),
    'citrouilles',       (select count(*) from public.saison_citrouilles x where x.user_id = p_user)
  ) into m;

  return m;
end $$;

insert into public.succes_def (id, famille, categorie, rang, nom, description, icone, metrique, seuil, secret, xp, ordre)
select v.id, v.famille, v.categorie, v.rang, v.nom, v.description, v.icone, v.metrique, v.seuil, false,
       case v.rang when 'bronze' then 10 when 'argent' then 25 when 'or' then 60 else 150 end,
       v.ordre
from (values
  ('saison-palier-10', 'saison-palier', 'Saison', 'bronze',  'Premières brumes',    'Atteindre le palier 10 d''une saison',        '🌫️', 'saison_palier',    10, 521),
  ('saison-palier-20', 'saison-palier', 'Saison', 'argent',  'Cœur de la nuit',     'Atteindre le palier 20 d''une saison',        '🌕', 'saison_palier',    20, 522),
  ('saison-palier-30', 'saison-palier', 'Saison', 'or',      'Minuit passé',        'Atteindre le dernier palier d''une saison',   '🕛', 'saison_palier',    30, 523),
  ('chapitre-1',       'chapitre',      'Saison', 'bronze',  'Chapitre bouclé',     'Terminer un chapitre de saison',              '📖', 'saison_chapitres', 1,  524),
  ('chapitre-4',       'chapitre',      'Saison', 'platine', 'Sabbat accompli',     'Terminer les 4 chapitres d''une saison',      '📜', 'saison_chapitres', 4,  525),
  ('citrouille-7',     'citrouille',    'Saison', 'bronze',  'Chasseur de bonbons', 'Ouvrir la citrouille du jour 7 fois',         '🎃', 'citrouilles',      7,  526),
  ('citrouille-25',    'citrouille',    'Saison', 'or',      'Citrouille sans fin', 'Ouvrir la citrouille du jour 25 fois',        '🎃', 'citrouilles',      25, 527)
) as v (id, famille, categorie, rang, nom, description, icone, metrique, seuil, ordre)
on conflict (id) do update
  set famille = excluded.famille, categorie = excluded.categorie, rang = excluded.rang, nom = excluded.nom,
      description = excluded.description, icone = excluded.icone, metrique = excluded.metrique,
      seuil = excluded.seuil, ordre = excluded.ordre;


-- ---------------------------------------------------------------------
-- 9. Droits
-- ---------------------------------------------------------------------

revoke all on function public.saison_chapitre_fait(uuid, uuid, integer)  from public, anon, authenticated;
revoke all on function public.xp_evenement_mult(date)                    from public, anon, authenticated;
revoke all on function public.saison_cosm_json(text, uuid)               from public, anon, authenticated;
revoke all on function public.saison_pack_halloween()                    from public, anon, authenticated;
revoke all on function public.saison_pack_generique(uuid)                from public, anon, authenticated;
revoke all on function public.saison_generer_paliers(uuid)               from public, anon, authenticated;
revoke all on function public.engagement_saisons()                       from public, anon, authenticated;
revoke all on function public.xp_metriques(uuid)                         from public, anon, authenticated;

revoke all on function public.saison_etat()                              from public, anon;
revoke all on function public.saison_classement(integer)                 from public, anon;
revoke all on function public.saison_citrouille()                        from public, anon;
revoke all on function public.saison_equipe_liste()                      from public, anon;
revoke all on function public.saison_equipe_sauver(uuid, text, text, date, date, text, text, text, text) from public, anon;

grant execute on function public.saison_etat()                           to authenticated;
grant execute on function public.saison_classement(integer)              to authenticated;
grant execute on function public.saison_citrouille()                     to authenticated;
grant execute on function public.saison_equipe_liste()                   to authenticated;
grant execute on function public.saison_equipe_sauver(uuid, text, text, date, date, text, text, text, text) to authenticated;


-- ---------------------------------------------------------------------
-- 10. La saison 1 devient Halloween
-- ---------------------------------------------------------------------

do $$
declare s public.saisons%rowtype; v_uid uuid;
begin
  select * into s from public.saisons where numero = 1;
  if not found then return; end if;

  if s.decor is distinct from 'halloween' then

    update public.saisons
       set theme = 'Halloween', fin = date '2026-11-30',
           couleur_a = '#ff7a1a', couleur_b = '#ffd166', couleur_c = '#8b5cf6', decor = 'halloween'
     where id = s.id
    returning * into s;

    perform public.saison_generer_paliers(s.id);

    -- Ceux qui avaient reçu l'annonce de « La Rentrée » apprennent que la saison change de visage.
    for v_uid in select * from public.engagement_membres_actifs() loop
      perform public.com_notifier_systeme(v_uid, 'saison', 'saison-halloween:' || s.id::text, jsonb_build_object(
        'saison', s.id, 'nom', s.nom, 'theme', s.theme, 'fin', s.fin, 'refonte', true,
        'couleurs', jsonb_build_array(s.couleur_a, s.couleur_b, s.couleur_c)));
    end loop;
  end if;
end $$;
