-- =====================================================================
-- ENGAGEMENT : notifications utiles, résumé de la semaine, duels de sorties,
-- statut de découvreur, saisons, cosmétiques sans pouvoir.
--
-- Tout se passe dans la base : le navigateur lit (engagement.js) et propose,
-- il n'écrit jamais directement. Rien ici ne donne d'avantage : les
-- cosmétiques sont des cadres, des titres et des couleurs de pseudo.
--
--   1. Réglages
--   2. Notifications : nouveaux types, notifications « système », sorties
--   3. XP : gestes et succès des duels / pépites
--   4. Duels de sorties
--   5. Découvreur (pépites)
--   6. Cosmétiques
--   7. Saisons
--   8. Résumé de la semaine
--   9. Point d'entrée à l'ouverture
--  10. Droits
--  11. Métriques de l'XP
--  12. Planification (pg_cron) et amorçage
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Réglages
-- ---------------------------------------------------------------------

create table if not exists public.engagement_reglages (
  cle    text primary key,
  valeur jsonb not null
);

-- pepite : une sortie est une « pépite » quand elle réunit au moins notes_min notes, de moyenne >= moyenne_min,
-- et que le membre l'a notée (note >= note_min) parmi les « premiers » à le faire.
insert into public.engagement_reglages (cle, valeur) values
  ('pepite',     '{"notes_min": 5, "moyenne_min": 7, "premiers": 3, "note_min": 7}'),
  ('duels_auto', 'true')
on conflict (cle) do nothing;

alter table public.engagement_reglages enable row level security;


-- ---------------------------------------------------------------------
-- 2. Notifications
-- ---------------------------------------------------------------------

-- Une notification « système » n'a pas d'acteur (pas de membre qui l'a déclenchée) mais des données.
alter table public.com_notifications alter column acteur_id drop not null;
alter table public.com_notifications add column if not exists donnees jsonb;

alter table public.com_notifications drop constraint if exists com_notifications_type_check;
alter table public.com_notifications add constraint com_notifications_type_check
  check (type in ('reaction', 'commentaire', 'reponse', 'suivi', 'mention',
                  'sortie_artiste', 'sortie_a_ecouter', 'resume_semaine', 'duel', 'saison',
                  'decouvreur', 'cosmetique'));

create or replace function public.com_notifier_systeme(p_user uuid, p_type text, p_cle text, p_donnees jsonb)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.com_notifications (user_id, type, acteur_id, cle, donnees)
  values (p_user, p_type, null, p_cle, coalesce(p_donnees, '{}'::jsonb))
  on conflict (user_id, cle) do nothing
$$;

-- La notification vue par le site : les données du système en plus.
create or replace function public.com_notification_json(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id',       n.id,
    'type',     n.type,
    'cree_le',  n.cree_le,
    'lu',       n.lu_le is not null,
    'reaction', n.reaction,
    'donnees',  n.donnees,
    'acteur',   case when n.acteur_id is null then null else public.com_auteur_json(n.acteur_id) end,
    'post',     (
      select jsonb_build_object(
        'id', p.id, 'type', p.type, 'extrait', left(p.contenu, 140), 'image', p.images[1]
      ) from public.com_posts p where p.id = n.post_id
    ),
    'commentaire', (
      select jsonb_build_object(
        'id', c.id, 'post_id', c.post_id, 'extrait', left(c.contenu, 140)
      ) from public.com_commentaires c where c.id = n.commentaire_id
    )
  )
  from public.com_notifications n
  where n.id = p_id;
$$;

-- Les membres à prévenir d'une annonce générale (duel, saison) : ceux qui sont passés récemment.
create or replace function public.engagement_membres_actifs()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.id from public.profiles p
   where coalesce(p.derniere_activite, p.created_at) > now() - interval '45 days'
$$;

-- Une sortie vue par le site (duels, notifications).
create or replace function public.engagement_sortie_json(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', s.id, 'numero', s.catalog_number, 'titre', s.track_title, 'artiste', s.artist_name,
    'cover', s.cover_url, 'date', s.release_date, 'type', s.release_type)
  from public.submissions s where s.id = p_id
$$;

-- Les sorties du jour : chaque sortie récente est annoncée une seule fois, à ceux qui l'attendent.
--   * sortie_artiste   : le membre a bien noté (>= 7) ou mis en favori une autre sortie du même artiste
--   * sortie_a_ecouter : le membre avait mis cette sortie de côté
-- Au plus 3 annonces de ce genre par membre et par jour : une alerte rare vaut mieux qu'un flot.
create table if not exists public.sorties_notifiees (
  release_id uuid primary key,
  le         timestamptz not null default now()
);
alter table public.sorties_notifiees enable row level security;

create or replace function public.engagement_sorties()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record; u record; v_n integer := 0; v_plafond constant integer := 3;
begin
  for r in
    select s.id, s.catalog_number, s.track_title, s.artist_name, s.cover_url, s.release_date, s.artist_norme
      from public.submissions s
     where s.status = 'approved' and not coalesce(s.banni, false)
       and s.release_date between public.xp_jour() - 2 and public.xp_jour()
       and not exists (select 1 from public.sorties_notifiees x where x.release_id = s.id)
     order by s.release_date desc
     limit 300
  loop
    insert into public.sorties_notifiees (release_id) values (r.id) on conflict do nothing;

    for u in
      select t.user_id, min(t.type) as type
        from (
          select rr.user_id, 'sortie_a_ecouter' as type
            from public.release_ratings rr
           where rr.release_id = r.id and coalesce(rr.a_ecouter, false)
          union all
          select rr.user_id, 'sortie_artiste'
            from public.submissions o
            join public.release_ratings rr on rr.release_id = o.id
           where r.artist_norme is not null and r.artist_norme <> ''
             and o.artist_norme = r.artist_norme and o.id <> r.id
             and (coalesce(rr.rating, 0) >= 7 or coalesce(rr.favori, false))
        ) t
       group by t.user_id
    loop
      if (select count(*) from public.com_notifications n
           where n.user_id = u.user_id and n.type in ('sortie_artiste', 'sortie_a_ecouter')
             and n.cree_le > now() - interval '1 day') < v_plafond then
        perform public.com_notifier_systeme(u.user_id, u.type, 'sortie:' || r.id::text, jsonb_build_object(
          'release', r.id, 'numero', r.catalog_number, 'titre', r.track_title, 'artiste', r.artist_name,
          'cover', r.cover_url, 'date', r.release_date));
        v_n := v_n + 1;
      end if;
    end loop;
  end loop;

  return v_n;
end $$;


-- ---------------------------------------------------------------------
-- 3. XP : les gestes et les succès
-- ---------------------------------------------------------------------

insert into public.xp_actions (action, libelle, icone, xp, plafond, bonus) values
  ('duel',   'Voter à un duel',     '⚔️', 3, 3,    false),
  ('pepite', 'Pépite découverte',   '💎', 0, null, true)
on conflict (action) do update
  set libelle = excluded.libelle, icone = excluded.icone, xp = excluded.xp,
      plafond = excluded.plafond, bonus = excluded.bonus;

insert into public.succes_def (id, famille, categorie, rang, nom, description, icone, metrique, seuil, secret, xp, ordre)
select v.id, v.famille, v.categorie, v.rang, v.nom, v.description, v.icone, v.metrique, v.seuil, false,
       case v.rang when 'bronze' then 10 when 'argent' then 25 when 'or' then 60 else 150 end,
       v.ordre
from (values
  ('duel-1',    'duel',   'Communauté', 'bronze',  'Dans l''arène',   'Voter à un duel de sorties',               '⚔️', 'duels',   1,   501),
  ('duel-10',   'duel',   'Communauté', 'argent',  'Juré populaire',  'Voter à 10 duels',                         '⚔️', 'duels',   10,  502),
  ('duel-30',   'duel',   'Communauté', 'or',      'Arbitre',         'Voter à 30 duels',                         '⚔️', 'duels',   30,  503),
  ('duel-100',  'duel',   'Communauté', 'platine', 'Juge suprême',    'Voter à 100 duels',                        '⚔️', 'duels',   100, 504),
  ('pepite-1',  'pepite', 'Collection', 'bronze',  'Découvreur',      'Repérer une pépite avant tout le monde',   '💎', 'pepites', 1,   511),
  ('pepite-3',  'pepite', 'Collection', 'argent',  'Dénicheur',       'Repérer 3 pépites avant tout le monde',    '💎', 'pepites', 3,   512),
  ('pepite-10', 'pepite', 'Collection', 'or',      'Visionnaire',     'Repérer 10 pépites avant tout le monde',   '💎', 'pepites', 10,  513),
  ('pepite-25', 'pepite', 'Collection', 'platine', 'Prophète',        'Repérer 25 pépites avant tout le monde',   '💎', 'pepites', 25,  514)
) as v (id, famille, categorie, rang, nom, description, icone, metrique, seuil, ordre)
on conflict (id) do update
  set famille = excluded.famille, categorie = excluded.categorie, rang = excluded.rang, nom = excluded.nom,
      description = excluded.description, icone = excluded.icone, metrique = excluded.metrique,
      seuil = excluded.seuil, ordre = excluded.ordre;


-- ---------------------------------------------------------------------
-- 4. Duels de sorties
-- ---------------------------------------------------------------------

create table if not exists public.duels (
  id               uuid primary key default gen_random_uuid(),
  titre            text,
  release_a        uuid not null references public.submissions(id) on delete cascade,
  release_b        uuid not null references public.submissions(id) on delete cascade,
  debut            timestamptz not null default now(),
  fin              timestamptz not null,
  auto             boolean not null default false,
  cree_par         uuid references public.profiles(id) on delete set null,
  resultat_notifie boolean not null default false,
  cree_le          timestamptz not null default now(),
  check (release_a <> release_b),
  check (fin > debut)
);
create index if not exists duels_fin_idx on public.duels (fin desc);

create table if not exists public.duel_votes (
  duel_id uuid not null references public.duels(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  choix   text not null check (choix in ('a', 'b')),
  cree_le timestamptz not null default now(),
  primary key (duel_id, user_id)
);
create index if not exists duel_votes_user_idx on public.duel_votes (user_id, cree_le desc);

alter table public.duels enable row level security;
alter table public.duel_votes enable row level security;

-- Un duel vu par un membre : les chiffres ne se montrent qu'à celui qui a voté (ou une fois le duel fini).
create or replace function public.duel_json(p_id uuid, p_user uuid, p_tout boolean default false)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  d public.duels%rowtype;
  v_mon text; v_a integer; v_b integer; v_voir boolean;
begin
  select * into d from public.duels where id = p_id;
  if not found then return null; end if;

  select choix into v_mon from public.duel_votes where duel_id = d.id and user_id = p_user;
  select count(*) filter (where choix = 'a'), count(*) filter (where choix = 'b')
    into v_a, v_b from public.duel_votes where duel_id = d.id;

  v_voir := p_tout or v_mon is not null or d.fin <= now();

  return jsonb_build_object(
    'id',       d.id,
    'titre',    d.titre,
    'debut',    d.debut,
    'fin',      d.fin,
    'actif',    d.debut <= now() and d.fin > now(),
    'auto',     d.auto,
    'a',        public.engagement_sortie_json(d.release_a),
    'b',        public.engagement_sortie_json(d.release_b),
    'mon_vote', v_mon,
    'total',    v_a + v_b,
    'votes',    case when v_voir then jsonb_build_object('a', v_a, 'b', v_b) else null end,
    'gagnant',  case when d.fin <= now() and v_a <> v_b then (case when v_a > v_b then 'a' else 'b' end) else null end
  );
end $$;

-- Les duels en cours, puis les derniers terminés.
create or replace function public.duels_liste()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return '[]'::jsonb; end if;

  return coalesce((
    select jsonb_agg(public.duel_json(x.id, v_uid) order by (x.fin > now()) desc, x.fin desc)
      from (
        select id, fin from public.duels
         where debut <= now()
         order by (fin > now()) desc, fin desc
         limit 4
      ) x
  ), '[]'::jsonb);
end $$;

create or replace function public.duel_voter(p_duel uuid, p_choix text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  d public.duels%rowtype;
begin
  if v_uid is null then raise exception 'Connecte-toi pour voter.'; end if;
  if p_choix not in ('a', 'b') then raise exception 'Choix inconnu.'; end if;

  select * into d from public.duels where id = p_duel;
  if not found then raise exception 'Ce duel n''existe plus.'; end if;
  if d.debut > now() or d.fin <= now() then raise exception 'Ce duel est terminé.'; end if;

  begin
    insert into public.duel_votes (duel_id, user_id, choix) values (d.id, v_uid, p_choix);
  exception when unique_violation then
    raise exception 'Tu as déjà voté pour ce duel.';
  end;

  perform public.xp_crediter(v_uid, 'duel', d.id::text);

  return public.duel_json(d.id, v_uid);
end $$;

-- Prévient les membres actifs qu'un duel commence.
create or replace function public.duel_annoncer(p_duel uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare d public.duels%rowtype; v_uid uuid; v_a jsonb; v_b jsonb;
begin
  select * into d from public.duels where id = p_duel;
  if not found then return; end if;
  v_a := public.engagement_sortie_json(d.release_a);
  v_b := public.engagement_sortie_json(d.release_b);

  for v_uid in select * from public.engagement_membres_actifs() loop
    perform public.com_notifier_systeme(v_uid, 'duel', 'duel:' || d.id::text, jsonb_build_object(
      'duel', d.id, 'fin', d.fin, 'titre', d.titre, 'a', v_a, 'b', v_b));
  end loop;
end $$;

-- Un duel au hasard : deux sorties récentes du même type, d'artistes différents, pas déjà opposées récemment.
create or replace function public.duel_creer_hasard(p_jours integer default 3, p_cree_par uuid default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_a uuid; v_b uuid; v_type text; v_norme text; v_id uuid;
begin
  select s.id, s.release_type, s.artist_norme into v_a, v_type, v_norme
    from public.submissions s
   where s.status = 'approved' and not coalesce(s.banni, false)
     and coalesce(s.cover_url, '') <> ''
     and s.release_date between public.xp_jour() - 150 and public.xp_jour()
     and not exists (select 1 from public.duels d
                      where (d.release_a = s.id or d.release_b = s.id) and d.cree_le > now() - interval '90 days')
   order by random()
   limit 1;

  if v_a is null then return null; end if;

  select s.id into v_b
    from public.submissions s
   where s.status = 'approved' and not coalesce(s.banni, false)
     and coalesce(s.cover_url, '') <> ''
     and s.id <> v_a
     and s.release_type is not distinct from v_type
     and s.artist_norme is distinct from v_norme
     and s.release_date between public.xp_jour() - 150 and public.xp_jour()
     and not exists (select 1 from public.duels d
                      where (d.release_a = s.id or d.release_b = s.id) and d.cree_le > now() - interval '90 days')
   order by random()
   limit 1;

  if v_b is null then return null; end if;

  insert into public.duels (release_a, release_b, debut, fin, auto, cree_par)
  values (v_a, v_b, now(), now() + make_interval(days => greatest(coalesce(p_jours, 3), 1)), p_cree_par is null, p_cree_par)
  returning id into v_id;

  perform public.duel_annoncer(v_id);
  return v_id;
end $$;

-- Planifié : annonce le résultat des duels finis, et en lance un quand il n'y en a plus (si c'est permis).
create or replace function public.engagement_duels()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  d record; v_n integer := 0; v_a integer; v_b integer; v_uid uuid; v_choix text; v_auto boolean;
begin
  for d in select * from public.duels where fin <= now() and not resultat_notifie order by fin limit 20 loop
    select count(*) filter (where choix = 'a'), count(*) filter (where choix = 'b')
      into v_a, v_b from public.duel_votes where duel_id = d.id;

    for v_uid, v_choix in select user_id, choix from public.duel_votes where duel_id = d.id loop
      perform public.com_notifier_systeme(v_uid, 'duel', 'duel-fin:' || d.id::text, jsonb_build_object(
        'duel', d.id, 'fini', true, 'titre', d.titre, 'mon_vote', v_choix, 'votes', jsonb_build_object('a', v_a, 'b', v_b),
        'a', public.engagement_sortie_json(d.release_a), 'b', public.engagement_sortie_json(d.release_b)));
    end loop;

    update public.duels set resultat_notifie = true where id = d.id;
    v_n := v_n + 1;
  end loop;

  select coalesce((valeur)::text = 'true', true) into v_auto from public.engagement_reglages where cle = 'duels_auto';
  if coalesce(v_auto, true)
     and not exists (select 1 from public.duels where debut <= now() and fin > now()) then
    if public.duel_creer_hasard(3, null) is not null then v_n := v_n + 1; end if;
  end if;

  return v_n;
end $$;

-- L'équipe : tous les duels avec leurs chiffres, en créer, en retirer.
create or replace function public.duel_equipe_liste()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.est_equipe() then raise exception 'Réservé à l''équipe.'; end if;
  return coalesce((
    select jsonb_agg(public.duel_json(x.id, auth.uid(), true) order by x.fin desc)
      from (select id, fin from public.duels order by fin desc limit 30) x
  ), '[]'::jsonb);
end $$;

create or replace function public.duel_equipe_sauver(p_release_a uuid, p_release_b uuid, p_fin timestamptz, p_titre text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if not public.est_equipe() then raise exception 'Réservé à l''équipe.'; end if;
  if p_release_a is null or p_release_b is null or p_release_a = p_release_b then
    raise exception 'Choisis deux sorties différentes.';
  end if;
  if not exists (select 1 from public.submissions where id = p_release_a)
     or not exists (select 1 from public.submissions where id = p_release_b) then
    raise exception 'Sortie introuvable.';
  end if;
  if p_fin is null or p_fin <= now() then raise exception 'La fin du duel doit être dans le futur.'; end if;

  insert into public.duels (titre, release_a, release_b, debut, fin, auto, cree_par)
  values (nullif(trim(coalesce(p_titre, '')), ''), p_release_a, p_release_b, now(), p_fin, false, auth.uid())
  returning id into v_id;

  perform public.duel_annoncer(v_id);
  return public.duel_json(v_id, auth.uid(), true);
end $$;

create or replace function public.duel_equipe_hasard(p_jours integer default 3)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if not public.est_equipe() then raise exception 'Réservé à l''équipe.'; end if;
  v_id := public.duel_creer_hasard(p_jours, auth.uid());
  if v_id is null then raise exception 'Pas assez de sorties récentes avec une pochette pour tirer un duel.'; end if;
  return public.duel_json(v_id, auth.uid(), true);
end $$;

create or replace function public.duel_equipe_supprimer(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.est_equipe() then raise exception 'Réservé à l''équipe.'; end if;
  delete from public.duels where id = p_id;
end $$;


-- ---------------------------------------------------------------------
-- 5. Statut de découvreur (pépites)
-- ---------------------------------------------------------------------

create table if not exists public.pepites (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  release_id uuid not null references public.submissions(id) on delete cascade,
  obtenu_le  timestamptz not null default now(),
  primary key (user_id, release_id)
);
create index if not exists pepites_release_idx on public.pepites (release_id);
alter table public.pepites enable row level security;

-- Le rang de découvreur selon le nombre de pépites.
create or replace function public.decouvreur_rang(p_n integer)
returns text
language sql
immutable
as $$
  select case when coalesce(p_n, 0) >= 25 then 'Prophète'
              when coalesce(p_n, 0) >= 10 then 'Visionnaire'
              when coalesce(p_n, 0) >= 3  then 'Dénicheur'
              when coalesce(p_n, 0) >= 1  then 'Découvreur'
              else null end
$$;

-- Cherche les pépites d'un membre : des sorties qu'il a bien notées parmi les premiers, que la communauté a
-- ensuite confirmées. Rend le nombre de nouvelles pépites.
create or replace function public.decouvreur_evaluer(p_user uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  g jsonb; v_min integer; v_moy numeric; v_premiers integer; v_note integer;
  r record; v_n integer := 0; v_ins integer;
begin
  select valeur into g from public.engagement_reglages where cle = 'pepite';
  v_min := coalesce((g ->> 'notes_min')::integer, 5);
  v_moy := coalesce((g ->> 'moyenne_min')::numeric, 7);
  v_premiers := coalesce((g ->> 'premiers')::integer, 3);
  v_note := coalesce((g ->> 'note_min')::integer, 7);

  for r in
    select mine.release_id
      from public.release_ratings mine
     where mine.user_id = p_user and mine.rating >= v_note
       and not exists (select 1 from public.pepites x where x.user_id = p_user and x.release_id = mine.release_id)
       and (select count(*) from public.release_ratings o
             where o.release_id = mine.release_id and o.rating is not null) >= v_min
       and (select avg(o.rating) from public.release_ratings o
             where o.release_id = mine.release_id and o.rating is not null) >= v_moy
       and (select count(*) from public.release_ratings o
             where o.release_id = mine.release_id and o.rating is not null
               and (o.created_at, o.user_id) < (mine.created_at, mine.user_id)) < v_premiers
  loop
    insert into public.pepites (user_id, release_id) values (p_user, r.release_id) on conflict do nothing;
    get diagnostics v_ins = row_count;
    if v_ins > 0 then
      v_n := v_n + 1;
      perform public.com_notifier_systeme(p_user, 'decouvreur', 'pepite:' || r.release_id::text,
        jsonb_build_object('release', r.release_id, 'sortie', public.engagement_sortie_json(r.release_id)));
      perform public.xp_brut(p_user, 'pepite', r.release_id::text, 20);
      perform public.xp_evt(p_user, 'pepite', public.engagement_sortie_json(r.release_id));
    end if;
  end loop;

  if v_n > 0 then
    perform public.xp_succes_evaluer(p_user);
  end if;

  return v_n;
end $$;

-- Planifié, chaque jour : une note d'un autre peut avoir confirmé la vôtre.
create or replace function public.engagement_pepites()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid; v_n integer := 0;
begin
  for v_uid in select distinct user_id from public.release_ratings where rating is not null loop
    v_n := v_n + public.decouvreur_evaluer(v_uid);
  end loop;
  return v_n;
end $$;

-- Les pépites d'un membre, pour sa fiche.
create or replace function public.decouvreur_fiche(p_user uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_uid uuid := coalesce(p_user, auth.uid()); v_n integer;
begin
  select count(*) into v_n from public.pepites where user_id = v_uid;
  return jsonb_build_object(
    'nombre', v_n,
    'rang', public.decouvreur_rang(v_n),
    'prochain', case when v_n >= 25 then null when v_n >= 10 then 25 when v_n >= 3 then 10 when v_n >= 1 then 3 else 1 end,
    'liste', coalesce((
      select jsonb_agg(public.engagement_sortie_json(x.release_id) order by x.obtenu_le desc)
        from (select release_id, obtenu_le from public.pepites where user_id = v_uid order by obtenu_le desc limit 12) x
    ), '[]'::jsonb)
  );
end $$;


-- ---------------------------------------------------------------------
-- 6. Cosmétiques (sans pouvoir : cadre d'avatar, titre, couleur de pseudo)
-- ---------------------------------------------------------------------

create table if not exists public.saisons (
  id           uuid primary key default gen_random_uuid(),
  numero       integer not null unique,
  nom          text not null,
  theme        text not null,
  debut        date not null,
  fin          date not null,
  couleur_a    text not null default '#7b5cff',
  couleur_b    text not null default '#ffc46b',
  couleur_c    text not null default '#ff7a59',
  annoncee     boolean not null default false,
  fin_notifiee boolean not null default false,
  cree_le      timestamptz not null default now(),
  check (fin >= debut)
);

create table if not exists public.cosmetiques (
  id             text primary key,
  type           text not null check (type in ('cadre', 'titre', 'couleur')),
  nom            text not null,
  description    text not null default '',
  rarete         text not null default 'commun' check (rarete in ('commun', 'rare', 'epique', 'legendaire')),
  style          jsonb not null default '{}'::jsonb,
  source         text not null check (source in ('defaut', 'niveau', 'succes', 'saison')),
  niveau_requis  integer,
  succes_id      text references public.succes_def(id) on delete set null,
  saison_id      uuid references public.saisons(id) on delete cascade,
  palier         integer,
  ordre          integer not null default 0
);

create table if not exists public.cosmetiques_obtenus (
  user_id       uuid not null references public.profiles(id) on delete cascade,
  cosmetique_id text not null references public.cosmetiques(id) on delete cascade,
  obtenu_le     timestamptz not null default now(),
  primary key (user_id, cosmetique_id)
);

create table if not exists public.cosmetiques_equipes (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  cadre   text references public.cosmetiques(id) on delete set null,
  titre   text references public.cosmetiques(id) on delete set null,
  couleur text references public.cosmetiques(id) on delete set null
);

alter table public.saisons enable row level security;
alter table public.cosmetiques enable row level security;
alter table public.cosmetiques_obtenus enable row level security;
alter table public.cosmetiques_equipes enable row level security;

-- Le catalogue qui ne dépend pas d'une saison.
insert into public.cosmetiques (id, type, nom, description, rarete, style, source, niveau_requis, succes_id, ordre) values
  ('titre-auditeur',   'titre',   'Auditeur',        'Là où tout commence.',                       'commun',     '{}',                                            'defaut', null, null, 1),

  ('cadre-bronze',     'cadre',   'Bronze',          'Un premier liseré.',                         'commun',     '{"a":"#b9783a","b":"#e3a56a"}',                 'niveau', 5,    null, 10),
  ('cadre-argent',     'cadre',   'Argent',          'Le liseré des habitués.',                    'commun',     '{"a":"#aab4c2","b":"#eef2f8"}',                 'niveau', 10,   null, 11),
  ('cadre-or',         'cadre',   'Or',              'Pour ceux qui reviennent.',                  'rare',       '{"a":"#d9a53a","b":"#fbe39a"}',                 'niveau', 20,   null, 12),
  ('cadre-platine',    'cadre',   'Platine',         'Un halo qui respire.',                       'rare',       '{"a":"#7fd6e6","b":"#e0f8ff","anim":"pulse"}',  'niveau', 30,   null, 13),
  ('cadre-holo',       'cadre',   'Holographique',   'Les couleurs tournent autour de ta photo.',  'epique',     '{"a":"#ff6ad5","b":"#6aa8ff","c":"#7dffd0","anim":"tourne"}', 'niveau', 45, null, 14),
  ('cadre-mythique',   'cadre',   'Mythique',        'Le cadre des plus fidèles.',                 'legendaire', '{"a":"#ff4d4d","b":"#ffd166","c":"#7b5cff","anim":"tourne"}', 'niveau', 60, null, 15),

  ('titre-melomane',   'titre',   'Mélomane',        'Niveau 6.',                                  'commun',     '{}', 'niveau', 6,  null, 20),
  ('titre-limier',     'titre',   'Fin limier',      'Niveau 12.',                                 'commun',     '{}', 'niveau', 12, null, 21),
  ('titre-oreille',    'titre',   'Oreille d''or',   'Niveau 22.',                                 'rare',       '{}', 'niveau', 22, null, 22),
  ('titre-esthete',    'titre',   'Esthète',         'Niveau 35.',                                 'epique',     '{}', 'niveau', 35, null, 23),
  ('titre-legende',    'titre',   'Légende vivante', 'Niveau 55.',                                 'legendaire', '{}', 'niveau', 55, null, 24),

  ('couleur-neon',     'couleur', 'Violet néon',     'Un pseudo qui se remarque.',                 'rare',       '{"a":"#a78bfa","b":"#f0abfc"}', 'niveau', 14, null, 30),
  ('couleur-or',       'couleur', 'Or liquide',      'Un pseudo qui brille.',                      'epique',     '{"a":"#f5c45e","b":"#fff1b8"}', 'niveau', 40, null, 31),

  ('titre-decouvreur', 'titre',   'Découvreur',      'A repéré une pépite avant tout le monde.',   'rare',       '{}', 'succes', null, 'pepite-1',  40),
  ('titre-deniche',    'titre',   'Dénicheur',       'A repéré 3 pépites.',                        'rare',       '{}', 'succes', null, 'pepite-3',  41),
  ('titre-visionnaire','titre',   'Visionnaire',     'A repéré 10 pépites.',                       'epique',     '{}', 'succes', null, 'pepite-10', 42),
  ('cadre-prophete',   'cadre',   'Prophète',        'A repéré 25 pépites.',                       'legendaire', '{"a":"#9d7bff","b":"#5ee6c9","c":"#ffd166","anim":"tourne"}', 'succes', null, 'pepite-25', 43),
  ('titre-arbitre',    'titre',   'Arbitre',         'A voté à 30 duels.',                         'rare',       '{}', 'succes', null, 'duel-30',   44)
on conflict (id) do update
  set nom = excluded.nom, description = excluded.description, rarete = excluded.rarete, style = excluded.style,
      source = excluded.source, niveau_requis = excluded.niveau_requis, succes_id = excluded.succes_id, ordre = excluded.ordre;

create table if not exists public.saison_paliers (
  saison_id     uuid not null references public.saisons(id) on delete cascade,
  palier        integer not null,
  points        integer not null,
  cosmetique_id text references public.cosmetiques(id) on delete set null,
  primary key (saison_id, palier)
);

create table if not exists public.saison_defis (
  id        bigint generated always as identity primary key,
  saison_id uuid not null references public.saisons(id) on delete cascade,
  libelle   text not null,
  action    text not null,
  objectif  integer not null check (objectif > 0),
  points    integer not null check (points > 0),
  ordre     integer not null default 0
);

alter table public.saison_paliers enable row level security;
alter table public.saison_defis enable row level security;

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
    join public.xp_journal j on j.user_id = p_user and j.action = d.action and j.jour between s.debut and s.fin
   where d.id = p_defi
$$;

-- Les points de saison d'un membre : l'XP gagné pendant la saison, plus les défis de saison accomplis.
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
  )::integer
$$;

-- Débloque tout ce qui est mérité : niveau, succès, paliers de saison. Annonce (toast + notification) sauf la
-- toute première fois, pour ne pas inonder un compte qui existait déjà.
create or replace function public.cosmetiques_synchroniser(p_user uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_premiere boolean; v_niv integer; c record; v_ins integer; v_n integer := 0;
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

  return v_n;
end $$;

-- Ce qu'il faut pour l'obtenir, écrit pour le membre.
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
    else coalesce((select s.nom || ' · palier ' || k.palier || ' (' || sp.points || ' pts)'
                     from public.saisons s join public.saison_paliers sp on sp.saison_id = s.id and sp.palier = k.palier
                    where s.id = k.saison_id), 'Saison')
  end
$$;

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
      select jsonb_build_object('cadre', e.cadre, 'titre', e.titre, 'couleur', e.couleur)
        from public.cosmetiques_equipes e where e.user_id = v_uid
    ), jsonb_build_object('cadre', null, 'titre', null, 'couleur', null))
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
  if p_type not in ('cadre', 'titre', 'couleur') then raise exception 'Type inconnu.'; end if;

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
  else update public.cosmetiques_equipes set couleur = p_id where user_id = v_uid;
  end if;
end $$;

-- L'auteur vu par le site : cadre, titre, couleur et rang de découvreur en plus.
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


-- ---------------------------------------------------------------------
-- 7. Saisons
-- ---------------------------------------------------------------------

-- Crée (ou remet à jour) les 8 récompenses d'une saison, aux couleurs de la saison, et ses défis.
create or replace function public.saison_generer_paliers(p_saison uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.saisons%rowtype;
  k integer; v_id text; v_type text; v_nom text; v_style jsonb; v_rarete text;
  pts integer[] := array[100, 300, 600, 1000, 1500, 2100, 2800, 3600];
begin
  select * into s from public.saisons where id = p_saison;
  if not found then return; end if;

  for k in 1..8 loop
    v_id := 'saison-' || s.numero || '-' || k;

    v_type := case k when 1 then 'titre' when 2 then 'couleur' when 3 then 'cadre' when 4 then 'titre'
                     when 5 then 'cadre' when 6 then 'couleur' when 7 then 'titre' else 'cadre' end;

    v_nom := case k
      when 1 then s.theme || ' · Éclaireur'
      when 2 then 'Pseudo ' || s.theme
      when 3 then 'Cadre ' || s.theme
      when 4 then s.theme || ' · Habitué'
      when 5 then 'Cadre ' || s.theme || ' brillant'
      when 6 then 'Pseudo ' || s.theme || ' doré'
      when 7 then s.theme || ' · Légende'
      else 'Cadre ' || s.theme || ' légendaire' end;

    v_style := case k
      when 2 then jsonb_build_object('a', s.couleur_a, 'b', s.couleur_b)
      when 3 then jsonb_build_object('a', s.couleur_a, 'b', s.couleur_b)
      when 5 then jsonb_build_object('a', s.couleur_a, 'b', s.couleur_b, 'anim', 'pulse')
      when 6 then jsonb_build_object('a', s.couleur_b, 'b', s.couleur_c)
      when 8 then jsonb_build_object('a', s.couleur_a, 'b', s.couleur_b, 'c', s.couleur_c, 'anim', 'tourne')
      else '{}'::jsonb end;

    v_rarete := case when k >= 8 then 'legendaire' when k >= 5 then 'epique' when k >= 3 then 'rare' else 'commun' end;

    insert into public.cosmetiques (id, type, nom, description, rarete, style, source, saison_id, palier, ordre)
    values (v_id, v_type, v_nom, 'Récompense de la ' || lower(s.nom) || ', introuvable ailleurs.', v_rarete, v_style,
            'saison', s.id, k, 100 + s.numero * 10 + k)
    on conflict (id) do update
      set type = excluded.type, nom = excluded.nom, rarete = excluded.rarete, style = excluded.style,
          description = excluded.description;

    insert into public.saison_paliers (saison_id, palier, points, cosmetique_id)
    values (s.id, k, pts[k], v_id)
    on conflict (saison_id, palier) do update set cosmetique_id = excluded.cosmetique_id;
  end loop;

  if not exists (select 1 from public.saison_defis where saison_id = s.id) then
    insert into public.saison_defis (saison_id, libelle, action, objectif, points, ordre) values
      (s.id, 'Noter 15 sorties',            'note',        15, 120, 1),
      (s.id, 'Écouter 20 sorties',          'ecoute',      20, 120, 2),
      (s.id, 'Écrire 5 avis',               'avis',        5,  150, 3),
      (s.id, 'Voter à 10 duels',            'duel',        10, 100, 4),
      (s.id, 'Commenter 10 fois',           'commentaire', 10, 80,  5),
      (s.id, 'Passer 20 jours sur le site', 'connexion',   20, 150, 6);
  end if;
end $$;

-- La saison en cours (ou la dernière terminée), avec ma progression. Débloque au passage ce qui est mérité.
create or replace function public.saison_etat()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  s public.saisons%rowtype;
  v_pts integer; v_jour date := public.xp_jour(); v_actuel integer; v_suivant record;
begin
  if v_uid is null then return null; end if;

  select * into s from public.saisons where debut <= v_jour order by debut desc limit 1;
  if not found then
    select * into s from public.saisons where debut > v_jour order by debut limit 1;
    if not found then return null; end if;
    return jsonb_build_object('a_venir', true, 'nom', s.nom, 'theme', s.theme, 'debut', s.debut, 'fin', s.fin);
  end if;

  perform public.cosmetiques_synchroniser(v_uid);

  v_pts := public.saison_points(v_uid, s.id);
  select coalesce(max(palier), 0) into v_actuel from public.saison_paliers where saison_id = s.id and points <= v_pts;
  select * into v_suivant from public.saison_paliers where saison_id = s.id and points > v_pts order by points limit 1;

  return jsonb_build_object(
    'id', s.id, 'numero', s.numero, 'nom', s.nom, 'theme', s.theme,
    'debut', s.debut, 'fin', s.fin, 'terminee', s.fin < v_jour,
    'jours_restants', greatest(s.fin - v_jour, 0),
    'couleurs', jsonb_build_array(s.couleur_a, s.couleur_b, s.couleur_c),
    'points', v_pts, 'palier', v_actuel,
    'prochain', case when v_suivant.palier is null then null
                     else jsonb_build_object('palier', v_suivant.palier, 'points', v_suivant.points) end,
    'paliers', coalesce((
      select jsonb_agg(jsonb_build_object(
               'palier', sp.palier, 'points', sp.points, 'atteint', sp.points <= v_pts,
               'cosmetique', jsonb_build_object('id', k.id, 'type', k.type, 'nom', k.nom, 'rarete', k.rarete, 'style', k.style))
             order by sp.palier)
        from public.saison_paliers sp join public.cosmetiques k on k.id = sp.cosmetique_id
       where sp.saison_id = s.id
    ), '[]'::jsonb),
    'defis', coalesce((
      select jsonb_agg(jsonb_build_object(
               'libelle', d.libelle, 'objectif', d.objectif, 'points', d.points,
               'progres', least(public.saison_defi_progres(v_uid, d.id), d.objectif),
               'fait', public.saison_defi_progres(v_uid, d.id) >= d.objectif)
             order by d.ordre, d.id)
        from public.saison_defis d where d.saison_id = s.id
    ), '[]'::jsonb)
  );
end $$;

-- L'équipe : voir, créer, modifier les saisons (les récompenses se génèrent aux couleurs de la saison).
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
             'id', s.id, 'numero', s.numero, 'nom', s.nom, 'theme', s.theme, 'debut', s.debut, 'fin', s.fin,
             'couleurs', jsonb_build_array(s.couleur_a, s.couleur_b, s.couleur_c),
             'participants', (select count(distinct j.user_id) from public.xp_journal j where j.jour between s.debut and s.fin and j.xp > 0))
           order by s.debut desc)
      from public.saisons s
  ), '[]'::jsonb);
end $$;

create or replace function public.saison_equipe_sauver(
  p_id uuid, p_nom text, p_theme text, p_debut date, p_fin date, p_a text, p_b text, p_c text)
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
  if p_nom is null or p_theme is null then raise exception 'Donne un nom et un thème à la saison.'; end if;
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
    insert into public.saisons (numero, nom, theme, debut, fin, couleur_a, couleur_b, couleur_c)
    values (v_num, p_nom, p_theme, p_debut, p_fin, p_a, p_b, p_c)
    returning id into v_id;
  else
    update public.saisons
       set nom = p_nom, theme = p_theme, debut = p_debut, fin = p_fin, couleur_a = p_a, couleur_b = p_b, couleur_c = p_c
     where id = v_id;
    if not found then raise exception 'Saison introuvable.'; end if;
  end if;

  perform public.saison_generer_paliers(v_id);
  return v_id;
end $$;

-- Planifié chaque jour : annonce le début d'une saison et son bilan.
create or replace function public.engagement_saisons()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  s record; v_uid uuid; v_n integer := 0; v_pts integer; v_pal integer; v_jour date := public.xp_jour();
begin
  for s in select * from public.saisons where debut <= v_jour and fin >= v_jour and not annoncee loop
    for v_uid in select * from public.engagement_membres_actifs() loop
      perform public.com_notifier_systeme(v_uid, 'saison', 'saison:' || s.id::text, jsonb_build_object(
        'saison', s.id, 'nom', s.nom, 'theme', s.theme, 'fin', s.fin, 'couleurs', jsonb_build_array(s.couleur_a, s.couleur_b, s.couleur_c)));
    end loop;
    update public.saisons set annoncee = true where id = s.id;
    v_n := v_n + 1;
  end loop;

  for s in select * from public.saisons where fin < v_jour and not fin_notifiee loop
    for v_uid in select distinct user_id from public.xp_journal where jour between s.debut and s.fin and xp > 0 loop
      perform public.cosmetiques_synchroniser(v_uid);
      v_pts := public.saison_points(v_uid, s.id);
      select coalesce(max(palier), 0) into v_pal from public.saison_paliers where saison_id = s.id and points <= v_pts;
      perform public.com_notifier_systeme(v_uid, 'saison', 'saison-fin:' || s.id::text, jsonb_build_object(
        'saison', s.id, 'nom', s.nom, 'theme', s.theme, 'fini', true, 'points', v_pts, 'palier', v_pal,
        'couleurs', jsonb_build_array(s.couleur_a, s.couleur_b, s.couleur_c)));
    end loop;
    update public.saisons set fin_notifiee = true where id = s.id;
    v_n := v_n + 1;
  end loop;

  return v_n;
end $$;


-- ---------------------------------------------------------------------
-- 8. Résumé de la semaine
-- ---------------------------------------------------------------------

-- Lundi → dimanche. p_decalage = 0 : la semaine en cours ; 1 : la semaine dernière (par défaut).
create or replace function public.resume_semaine(p_decalage integer default 1)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_lundi date := date_trunc('week', public.xp_jour()::timestamp)::date - 7 * least(greatest(coalesce(p_decalage, 1), 0), 12);
  v_fin date;
  v_xp integer; v_xp_avant integer; v_jours integer;
  v_nb integer; v_moy numeric; v_top jsonb; v_ecart numeric; v_artiste jsonb;
  v_ecoutes integer; v_avis integer; v_posts integer; v_comm integer; v_react integer; v_duels integer;
  v_decouv integer; v_quetes integer; v_succes jsonb; v_pepites integer; v_serie integer; v_niveau integer;
begin
  if v_uid is null then return null; end if;
  v_fin := least(v_lundi + 6, public.xp_jour());

  select coalesce(sum(xp), 0), count(distinct jour) into v_xp, v_jours
    from public.xp_journal where user_id = v_uid and jour between v_lundi and v_fin;

  select coalesce(sum(xp), 0) into v_xp_avant
    from public.xp_journal where user_id = v_uid and jour between v_lundi - 7 and v_lundi - 1;

  with n as (
    select rr.release_id, rr.rating, s.track_title as titre, s.artist_name as artiste, s.cover_url as cover,
           s.catalog_number as numero,
           (select avg(o.rating) from public.release_ratings o where o.release_id = rr.release_id and o.user_id <> v_uid and o.rating is not null) as moy_autres,
           (select count(*) from public.release_ratings o where o.release_id = rr.release_id and o.user_id <> v_uid and o.rating is not null) as nb_autres
      from public.xp_journal j
      join public.release_ratings rr on rr.user_id = j.user_id and rr.release_id::text = j.ref
      join public.submissions s on s.id = rr.release_id
     where j.user_id = v_uid and j.action = 'note' and j.jour between v_lundi and v_fin and rr.rating is not null
  )
  select
    (select count(*) from n),
    (select round(avg(rating)::numeric, 1) from n),
    (select jsonb_build_object('id', release_id, 'numero', numero, 'titre', titre, 'artiste', artiste, 'cover', cover, 'note', rating)
       from n order by rating desc, titre limit 1),
    (select round(avg(rating - moy_autres)::numeric, 1) from n where nb_autres >= 2),
    (select jsonb_build_object('nom', t.artiste, 'nombre', t.c)
       from (
         select z.artiste, count(*) c from (
           select artiste from n
           union all
           select s2.artist_name
             from public.xp_journal j2
             join public.submissions s2 on s2.id::text = j2.ref
            where j2.user_id = v_uid and j2.action = 'ecoute' and j2.jour between v_lundi and v_fin
         ) z
         where z.artiste is not null group by z.artiste order by count(*) desc, z.artiste limit 1
       ) t)
  into v_nb, v_moy, v_top, v_ecart, v_artiste;

  select count(*) filter (where action = 'ecoute'), count(*) filter (where action = 'avis'),
         count(*) filter (where action = 'post'), count(*) filter (where action = 'commentaire'),
         count(*) filter (where action in ('visite_artiste', 'decouverte_sortie'))
    into v_ecoutes, v_avis, v_posts, v_comm, v_decouv
    from public.xp_journal where user_id = v_uid and jour between v_lundi and v_fin;

  select count(*) into v_react
    from public.com_reactions x
   where x.user_id <> v_uid and (x.cree_le at time zone 'Europe/Paris')::date between v_lundi and v_fin
     and ((x.cible_type = 'post' and exists (select 1 from public.com_posts c where c.id = x.cible_id and c.auteur_id = v_uid))
       or (x.cible_type = 'commentaire' and exists (select 1 from public.com_commentaires c where c.id = x.cible_id and c.auteur_id = v_uid)));

  select count(*) into v_duels from public.duel_votes
   where user_id = v_uid and (cree_le at time zone 'Europe/Paris')::date between v_lundi and v_fin;

  select count(*) into v_quetes from public.xp_quetes
   where user_id = v_uid and jour between v_lundi and v_fin and faite_le is not null;

  select coalesce(jsonb_agg(jsonb_build_object('nom', d.nom, 'icone', d.icone, 'rang', d.rang) order by o.obtenu_le), '[]'::jsonb)
    into v_succes
    from public.succes_obtenus o join public.succes_def d on d.id = o.succes_id
   where o.user_id = v_uid and not d.secret and (o.obtenu_le at time zone 'Europe/Paris')::date between v_lundi and v_fin;

  select count(*) into v_pepites from public.pepites
   where user_id = v_uid and (obtenu_le at time zone 'Europe/Paris')::date between v_lundi and v_fin;

  select coalesce(serie, 0) into v_serie from public.xp_etat where user_id = v_uid;
  select public.xp_niveau(coalesce(xp, 0)) into v_niveau from public.profiles where id = v_uid;

  return jsonb_build_object(
    'debut', v_lundi, 'fin', v_lundi + 6, 'en_cours', v_lundi + 6 > public.xp_jour(),
    'actif', (v_xp > 0 or v_nb > 0),
    'xp', v_xp, 'xp_avant', v_xp_avant, 'jours_actifs', v_jours,
    'serie', coalesce(v_serie, 0), 'niveau', v_niveau,
    'notes', jsonb_build_object('nombre', v_nb, 'moyenne', v_moy, 'top', v_top, 'ecart_communaute', v_ecart),
    'artiste', v_artiste,
    'ecoutes', v_ecoutes, 'avis', v_avis, 'posts', v_posts, 'commentaires', v_comm,
    'decouvertes', v_decouv, 'reactions_recues', v_react, 'duels', v_duels, 'quetes', v_quetes,
    'succes', v_succes, 'pepites', v_pepites
  );
end $$;

-- Planifié chaque lundi : « ta semaine est prête » à ceux qui ont été actifs.
create or replace function public.engagement_resumes()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lundi date := date_trunc('week', public.xp_jour()::timestamp)::date - 7;
  v_uid uuid; v_xp integer; v_n integer := 0;
begin
  for v_uid, v_xp in
    select user_id, sum(xp)::integer from public.xp_journal
     where jour between v_lundi and v_lundi + 6 and xp > 0
     group by user_id
  loop
    perform public.com_notifier_systeme(v_uid, 'resume_semaine', 'resume:' || v_lundi::text,
      jsonb_build_object('debut', v_lundi, 'fin', v_lundi + 6, 'xp', v_xp));
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;


-- ---------------------------------------------------------------------
-- 9. Un point d'entrée pour le navigateur à l'ouverture
-- ---------------------------------------------------------------------

create or replace function public.engagement_synchroniser()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return null; end if;
  perform public.decouvreur_evaluer(v_uid);
  perform public.cosmetiques_synchroniser(v_uid);
  return jsonb_build_object('ok', true);
end $$;


-- ---------------------------------------------------------------------
-- 10. Droits : tout se lit par les fonctions, rien ne s'écrit à la main
-- ---------------------------------------------------------------------

revoke all on table public.engagement_reglages, public.sorties_notifiees, public.duels, public.duel_votes,
                    public.pepites, public.saisons, public.cosmetiques, public.cosmetiques_obtenus,
                    public.cosmetiques_equipes, public.saison_paliers, public.saison_defis
  from public, anon, authenticated;

-- Les fonctions internes (planifiées ou appelées par d'autres) : personne depuis le navigateur.
revoke all on function public.com_notifier_systeme(uuid, text, text, jsonb)       from public, anon, authenticated;
revoke all on function public.engagement_membres_actifs()                         from public, anon, authenticated;
revoke all on function public.engagement_sortie_json(uuid)                        from public, anon, authenticated;
revoke all on function public.engagement_sorties()                                from public, anon, authenticated;
revoke all on function public.duel_json(uuid, uuid, boolean)                      from public, anon, authenticated;
revoke all on function public.duel_annoncer(uuid)                                 from public, anon, authenticated;
revoke all on function public.duel_creer_hasard(integer, uuid)                    from public, anon, authenticated;
revoke all on function public.engagement_duels()                                  from public, anon, authenticated;
revoke all on function public.decouvreur_evaluer(uuid)                            from public, anon, authenticated;
revoke all on function public.engagement_pepites()                                from public, anon, authenticated;
revoke all on function public.cosmetiques_synchroniser(uuid)                      from public, anon, authenticated;
revoke all on function public.cosmetique_condition(public.cosmetiques)            from public, anon, authenticated;
revoke all on function public.saison_defi_progres(uuid, bigint)                   from public, anon, authenticated;
revoke all on function public.saison_points(uuid, uuid)                           from public, anon, authenticated;
revoke all on function public.saison_generer_paliers(uuid)                        from public, anon, authenticated;
revoke all on function public.engagement_saisons()                                from public, anon, authenticated;
revoke all on function public.engagement_resumes()                                from public, anon, authenticated;

-- Ce que le site appelle.
revoke all on function public.duels_liste()                                       from public, anon;
revoke all on function public.duel_voter(uuid, text)                              from public, anon;
revoke all on function public.duel_equipe_liste()                                 from public, anon;
revoke all on function public.duel_equipe_sauver(uuid, uuid, timestamptz, text)   from public, anon;
revoke all on function public.duel_equipe_hasard(integer)                         from public, anon;
revoke all on function public.duel_equipe_supprimer(uuid)                         from public, anon;
revoke all on function public.decouvreur_fiche(uuid)                              from public, anon;
revoke all on function public.cosmetiques_moi()                                   from public, anon;
revoke all on function public.cosmetique_equiper(text, text)                      from public, anon;
revoke all on function public.saison_etat()                                       from public, anon;
revoke all on function public.saison_equipe_liste()                               from public, anon;
revoke all on function public.saison_equipe_sauver(uuid, text, text, date, date, text, text, text) from public, anon;
revoke all on function public.resume_semaine(integer)                             from public, anon;
revoke all on function public.engagement_synchroniser()                           from public, anon;

grant execute on function public.duels_liste()                                    to authenticated;
grant execute on function public.duel_voter(uuid, text)                           to authenticated;
grant execute on function public.duel_equipe_liste()                              to authenticated;
grant execute on function public.duel_equipe_sauver(uuid, uuid, timestamptz, text) to authenticated;
grant execute on function public.duel_equipe_hasard(integer)                      to authenticated;
grant execute on function public.duel_equipe_supprimer(uuid)                      to authenticated;
grant execute on function public.decouvreur_fiche(uuid)                           to authenticated;
grant execute on function public.cosmetiques_moi()                                to authenticated;
grant execute on function public.cosmetique_equiper(text, text)                   to authenticated;
grant execute on function public.saison_etat()                                    to authenticated;
grant execute on function public.saison_equipe_liste()                            to authenticated;
grant execute on function public.saison_equipe_sauver(uuid, text, text, date, date, text, text, text) to authenticated;
grant execute on function public.resume_semaine(integer)                          to authenticated;
grant execute on function public.engagement_synchroniser()                        to authenticated;

-- Les fonctions appelées par les déclencheurs et par com_auteur_json (droits de l'appelant) : exécutables.
grant execute on function public.decouvreur_rang(integer)                         to anon, authenticated;


-- ---------------------------------------------------------------------
-- 11. Les métriques de l'XP : les duels et les pépites en plus
-- ---------------------------------------------------------------------

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
    'variete',           (select count(distinct j.action) from j),
    'duels',             (select count(*) from public.duel_votes dv where dv.user_id = p_user),
    'pepites',           (select count(*) from public.pepites pe where pe.user_id = p_user)
  ) into m;

  return m;
end $$;

revoke all on function public.xp_metriques(uuid) from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 12. Planification et amorçage
-- ---------------------------------------------------------------------

-- La saison 1 : cinq semaines à partir d'aujourd'hui, récompenses aux couleurs de la rentrée.
insert into public.saisons (numero, nom, theme, debut, fin, couleur_a, couleur_b, couleur_c)
select 1, 'Saison 1', 'La Rentrée', public.xp_jour(), public.xp_jour() + 34, '#ff7a59', '#ffc46b', '#7b5cff'
 where not exists (select 1 from public.saisons);

select public.saison_generer_paliers(id) from public.saisons;

-- Les tâches planifiées. cron.schedule remplace une tâche de même nom.
select cron.schedule('engagement-sorties',   '7 * * * *',  'select public.engagement_sorties()');
select cron.schedule('engagement-duels',     '12 * * * *', 'select public.engagement_duels()');
select cron.schedule('engagement-quotidien', '0 5 * * *',  'select public.engagement_pepites(); select public.engagement_saisons()');
select cron.schedule('engagement-resumes',   '0 6 * * 1',  'select public.engagement_resumes()');

-- Premier tour : un premier duel et l'annonce de la saison 1.
select public.engagement_duels();
select public.engagement_saisons();
