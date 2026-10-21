-- =====================================================================
-- La Wave — le jeu de cartes : ouvre des packs, collectionne les sorties
--
-- Chaque sortie du catalogue est une carte. Un pack en contient une, tirée selon
-- sa rareté, et la rareté vient de la notoriété réelle de l'artiste (ses fans
-- Deezer, classés en pourcentages : les 1 % du haut sont Mythiques).
--
--   • tirages : 15 au départ, +3 toutes les 10 minutes jusqu'au plafond ;
--   • raretés : Commun 62 %, Rare 24 %, Épique 9,5 %, Légendaire 3,8 %, Mythique 0,7 % ;
--     chaque carte peut sortir en holographique (1 chance sur 200) ;
--   • la boucle quotidienne : cadeau de connexion en série de 7 jours, roue du jour,
--     coffre à cadeaux (4 fois par jour), 3 missions par jour et 3 défis par semaine ;
--   • la progression : niveau du joueur, vinyles (recyclage des doublons, atelier pour
--     fabriquer la carte de son choix), succès à récupérer ;
--   • le Discodex : tous les artistes, avec ce qu'on en possède.
--
-- Tout se passe dans la base (le navigateur ne fait que lire et demander) : les
-- tirages se font côté serveur, rien ne se triche depuis la page.
--
-- Retire aussi les annonces de l'engagement (duels, saison, résumés) : leurs tâches
-- planifiées sont arrêtées, la base de l'engagement reste intacte.
--
-- À exécuter dans Supabase → SQL Editor. Se rejoue sans risque.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Les fans Deezer : la rareté d'une carte
-- ---------------------------------------------------------------------

alter table public.artists add column if not exists deezer_fans bigint;
alter table public.artists add column if not exists deezer_fans_le timestamptz;

create or replace function public.jeu_fans_importer(p_lot integer default 200)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_debut timestamptz := clock_timestamp();
  a record; v_rep http_response; v_json jsonb;
  v_n integer := 0; v_err integer := 0; v_stop boolean := false;
begin
  if not pg_try_advisory_xact_lock(hashtext('jeu_fans_importer')) then
    return jsonb_build_object('ignore', true);
  end if;

  begin
    perform http_set_curlopt('CURLOPT_TIMEOUT', '10');
  exception when others then
    null;
  end;

  for a in
    select id, deezer_artist_id
      from public.artists
     where deezer_artist_id is not null
       and (deezer_fans_le is null or deezer_fans_le < now() - interval '30 days')
     order by deezer_fans_le nulls first, id
     limit greatest(p_lot, 1)
  loop
    exit when v_stop or clock_timestamp() - v_debut > interval '70 seconds';

    begin
      v_rep := http_get('https://api.deezer.com/artist/' || a.deezer_artist_id);

      if v_rep.status <> 200 then
        v_err := v_err + 1;
      else
        v_json := v_rep.content::jsonb;

        if (v_json -> 'error') is not null then
          -- Quota dépassé : on s'arrête. Un artiste que Deezer ne connaît plus : zéro fan, et on n'y revient pas avant un mois.
          if (v_json -> 'error' ->> 'code') = '4' then
            v_stop := true;
          else
            update public.artists set deezer_fans = 0, deezer_fans_le = now() where id = a.id;
            v_n := v_n + 1;
          end if;
        else
          update public.artists
             set deezer_fans = coalesce((v_json ->> 'nb_fan')::bigint, 0), deezer_fans_le = now()
           where id = a.id;
          v_n := v_n + 1;
        end if;
      end if;
    exception when others then
      v_err := v_err + 1;
    end;

    -- Deezer limite à 50 requêtes toutes les 5 secondes.
    perform pg_sleep(0.12);
  end loop;

  return jsonb_build_object(
    'faits', v_n, 'erreurs', v_err, 'quota', v_stop,
    'restants', (select count(*) from public.artists
                  where deezer_artist_id is not null and (deezer_fans_le is null or deezer_fans_le < now() - interval '30 days')));
end $$;


-- ---------------------------------------------------------------------
-- 2. Les cartes : une par sortie du catalogue
-- ---------------------------------------------------------------------

create table if not exists public.jeu_cartes (
  release_id uuid primary key references public.submissions(id) on delete cascade,
  numero     integer,
  rarete     smallint not null check (rarete between 1 and 5),   -- 1 commun … 5 mythique
  fans       bigint not null default 0,
  artiste    text not null,
  handle     text,
  titre      text not null,
  cover      text not null,
  sortie     date,
  type       text
);

create index if not exists jeu_cartes_rarete_idx on public.jeu_cartes (rarete);
create index if not exists jeu_cartes_handle_idx on public.jeu_cartes (handle);

-- La rareté suit la notoriété de l'artiste parmi les artistes qui ont des cartes : les 1 % du haut sont Mythiques,
-- les 4 % suivants Légendaires, les 10 % suivants Épiques, les 25 % suivants Rares, le reste Commun. Un artiste dont on
-- ne connaît pas les fans est Commun.
create or replace function public.jeu_cartes_rafraichir()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_n integer;
begin
  with base as (
    select s.id, s.catalog_number, s.artist_handle, s.artist_name, s.track_title, s.cover_url, s.release_date, s.release_type,
           coalesce(a.deezer_fans, 0) as fans
      from public.submissions s
      left join public.artists a on a.instagram_handle = s.artist_handle
     where s.status = 'approved' and not coalesce(s.banni, false)
       and coalesce(s.cover_url, '') <> '' and s.release_date is not null and s.release_date <= public.xp_jour()
  ), art as (
    select artist_handle, max(fans) as fans from base group by artist_handle
  ), rang as (
    select artist_handle, percent_rank() over (order by fans) as pr from art where fans > 0
  ), haut as (
    select b.*,
           case when r.pr is null then 1 when r.pr >= .99 then 5 when r.pr >= .95 then 4 when r.pr >= .85 then 3 when r.pr >= .60 then 2 else 1 end as rarete
      from base b left join rang r on r.artist_handle is not distinct from b.artist_handle
  ), maj as (
    insert into public.jeu_cartes (release_id, numero, rarete, fans, artiste, handle, titre, cover, sortie, type)
    select id, catalog_number, rarete, fans, coalesce(artist_name, ''), artist_handle, track_title, cover_url, release_date, release_type
      from haut
    on conflict (release_id) do update
      set numero = excluded.numero, rarete = excluded.rarete, fans = excluded.fans, artiste = excluded.artiste,
          handle = excluded.handle, titre = excluded.titre, cover = excluded.cover, sortie = excluded.sortie, type = excluded.type
    returning release_id
  ), nettoye as (
    delete from public.jeu_cartes c where not exists (select 1 from base b where b.id = c.release_id) returning 1
  )
  select count(*) into v_n from maj;

  return v_n;
end $$;


-- ---------------------------------------------------------------------
-- 3. Les joueurs, leur collection, leurs journées
-- ---------------------------------------------------------------------

create table if not exists public.jeu_joueurs (
  user_id        uuid primary key references public.profiles(id) on delete cascade,
  tirages        integer not null default 15,
  recharge_le    timestamptz not null default now(),
  niveau         integer not null default 1,
  xp             integer not null default 0,
  vinyles        integer not null default 0,
  garantis       integer not null default 0,              -- packs « Épique garanti »
  serie          integer not null default 0,
  serie_max      integer not null default 0,
  dernier_cadeau date,
  ouvertures     integer not null default 0,
  holos          integer not null default 0,
  recycles       integer not null default 0,
  ateliers       integer not null default 0,
  cree_le        timestamptz not null default now()
);

create table if not exists public.jeu_collection (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  release_id  uuid not null references public.submissions(id) on delete cascade,
  holo        boolean not null default false,
  quantite    integer not null default 1 check (quantite >= 0),
  premiere_le timestamptz not null default now(),
  primary key (user_id, release_id, holo)
);

create index if not exists jeu_collection_user_idx on public.jeu_collection (user_id, premiere_le desc);

-- Les compteurs de la journée (missions et défis).
create table if not exists public.jeu_jour (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  jour        date not null,
  ouvertures  integer not null default 0,
  rare_plus   integer not null default 0,
  epique_plus integer not null default 0,
  holos       integer not null default 0,
  recycles    integer not null default 0,
  ateliers    integer not null default 0,
  primary key (user_id, jour)
);

-- Tout ce qui se récupère une seule fois : cadeau du jour, coffres, missions, succès…
create table if not exists public.jeu_reclamations (
  user_id uuid not null references public.profiles(id) on delete cascade,
  cle     text not null,
  le      timestamptz not null default now(),
  primary key (user_id, cle)
);

create table if not exists public.jeu_roue_log (
  user_id uuid not null references public.profiles(id) on delete cascade,
  jour    date not null,
  secteur integer not null,
  libelle text not null,
  primary key (user_id, jour)
);

create table if not exists public.jeu_succes_def (
  id          text primary key,
  famille     text not null,
  nom         text not null,
  description text not null,
  metrique    text not null,
  seuil       integer not null,
  tirages     integer not null default 0,
  vinyles     integer not null default 0,
  ordre       integer not null default 0
);

alter table public.jeu_cartes       enable row level security;
alter table public.jeu_joueurs      enable row level security;
alter table public.jeu_collection   enable row level security;
alter table public.jeu_jour         enable row level security;
alter table public.jeu_reclamations enable row level security;
alter table public.jeu_roue_log     enable row level security;
alter table public.jeu_succes_def   enable row level security;

revoke all on table public.jeu_cartes, public.jeu_joueurs, public.jeu_collection, public.jeu_jour,
                    public.jeu_reclamations, public.jeu_roue_log, public.jeu_succes_def
  from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 4. Les règles : plafond, niveaux, valeurs, chances
-- ---------------------------------------------------------------------

create or replace function public.jeu_plafond(p_niveau integer)
returns integer language sql immutable as $$ select least(30 + (greatest(p_niveau, 1) - 1) * 2, 120) $$;

-- XP total pour atteindre un niveau.
create or replace function public.jeu_xp_seuil(p_niveau integer)
returns integer language sql immutable as $$ select 30 * (greatest(p_niveau, 1) - 1) * greatest(p_niveau, 1) $$;

-- Vinyles rendus par le recyclage d'un doublon, et coût de fabrication à l'atelier, selon la rareté (1 à 5).
create or replace function public.jeu_valeur(p_rarete integer)
returns integer language sql immutable as $$ select (array[2, 6, 22, 90, 350])[least(greatest(p_rarete, 1), 5)] $$;

create or replace function public.jeu_cout(p_rarete integer)
returns integer language sql immutable as $$ select (array[15, 50, 180, 700, 2500])[least(greatest(p_rarete, 1), 5)] $$;

-- Le lundi de la semaine d'un jour.
create or replace function public.jeu_lundi(p_jour date)
returns date language sql immutable as $$ select p_jour - (extract(isodow from p_jour)::integer - 1) $$;

-- Ce qui change les chances aujourd'hui : le lundi, Épique et mieux comptent double ; de 21 h à 22 h, l'holo aussi.
create or replace function public.jeu_evenement()
returns jsonb
language plpgsql
stable
as $$
declare
  v_paris timestamp := now() at time zone 'Europe/Paris';
  v_lundi boolean := extract(isodow from v_paris) = 1;
  v_heure boolean := extract(hour from v_paris) = 21;
  taux numeric[] := array[62, 24, 9.5, 3.8, 0.7];
  v_plus numeric;
begin
  if v_lundi then
    v_plus := taux[3] + taux[4] + taux[5];
    taux := array[taux[1] - v_plus, taux[2], taux[3] * 2, taux[4] * 2, taux[5] * 2];
  end if;

  return jsonb_build_object(
    'taux', to_jsonb(taux), 'lundi', v_lundi, 'heure_holo', v_heure,
    'holo', case when v_heure then 1.0 / 100 else 1.0 / 200 end);
end $$;

-- Tire une rareté selon les taux, au moins égale à p_min.
create or replace function public.jeu_tirer_rarete(p_taux numeric[], p_min integer)
returns integer
language plpgsql
volatile
as $$
declare v_tot numeric := 0; v_r numeric; v_cum numeric := 0; k integer;
begin
  for k in greatest(p_min, 1)..5 loop v_tot := v_tot + p_taux[k]; end loop;
  v_r := random() * v_tot;
  for k in greatest(p_min, 1)..5 loop
    v_cum := v_cum + p_taux[k];
    if v_r < v_cum then return k; end if;
  end loop;
  return 5;
end $$;


-- ---------------------------------------------------------------------
-- 5. L'état d'un joueur
-- ---------------------------------------------------------------------

-- Crée le joueur au premier passage.
create or replace function public.jeu_joueur_assurer(p_user uuid)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.jeu_joueurs (user_id) select p_user where exists (select 1 from public.profiles where id = p_user)
  on conflict (user_id) do nothing
$$;

-- Les tirages reviennent par paquets de 3 toutes les 10 minutes, jusqu'au plafond.
create or replace function public.jeu_regen(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare j public.jeu_joueurs; v_cap integer; v_pas integer;
begin
  select * into j from public.jeu_joueurs where user_id = p_user for update;
  if not found then return; end if;

  v_cap := public.jeu_plafond(j.niveau);

  if j.tirages >= v_cap then
    update public.jeu_joueurs set recharge_le = now() where user_id = p_user;
    return;
  end if;

  v_pas := floor(extract(epoch from now() - j.recharge_le) / 600)::integer;

  if v_pas > 0 then
    update public.jeu_joueurs
       set tirages = least(v_cap, tirages + v_pas * 3),
           recharge_le = case when tirages + v_pas * 3 >= v_cap then now() else recharge_le + v_pas * interval '10 minutes' end
     where user_id = p_user;
  end if;
end $$;

-- Rend un crédit (tirages, vinyles, packs garantis) et le renvoie tel quel.
create or replace function public.jeu_crediter(p_user uuid, p_tirages integer, p_vinyles integer, p_garantis integer default 0)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.jeu_joueurs
     set tirages = tirages + coalesce(p_tirages, 0), vinyles = vinyles + coalesce(p_vinyles, 0), garantis = garantis + coalesce(p_garantis, 0)
   where user_id = p_user;
  return jsonb_build_object('tirages', coalesce(p_tirages, 0), 'vinyles', coalesce(p_vinyles, 0), 'garantis', coalesce(p_garantis, 0));
end $$;

-- Une récupération qui ne se fait qu'une fois : vrai si c'est la première.
create or replace function public.jeu_reclamer(p_user uuid, p_cle text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_n integer;
begin
  insert into public.jeu_reclamations (user_id, cle) values (p_user, p_cle) on conflict do nothing;
  get diagnostics v_n = row_count;
  return v_n > 0;
end $$;

-- Cadeaux de connexion : (tirages, vinyles, packs garantis) pour les jours 1 à 7.
create or replace function public.jeu_cadeaux()
returns table (jour integer, tirages integer, vinyles integer, garantis integer)
language sql
immutable
as $$
  select * from (values (1, 5, 0, 0), (2, 8, 30, 0), (3, 10, 0, 0), (4, 12, 60, 0), (5, 15, 0, 0), (6, 20, 120, 0), (7, 40, 250, 1)) t (jour, tirages, vinyles, garantis)
$$;

-- Le coffre : 8 tirages offerts à 9 h, 13 h, 18 h et 22 h (heure de Paris), à récupérer dans les 8 heures.
create or replace function public.jeu_coffre_liste(p_user uuid)
returns table (cle text, heure integer, debut timestamptz, fin timestamptz, etat text, tirages integer)
language sql
stable
security definer
set search_path = public
as $$
  select x.cle, x.h, x.debut, x.debut + interval '8 hours',
         case when exists (select 1 from public.jeu_reclamations r where r.user_id = p_user and r.cle = 'coffre:' || x.cle) then 'prise'
              when now() < x.debut then 'a_venir'
              when now() > x.debut + interval '8 hours' then 'expire'
              else 'pret' end,
         8
    from (
      select d::text || '-' || lpad(h::text, 2, '0') as cle, h, ((d::text || ' ' || h || ':00')::timestamp at time zone 'Europe/Paris') as debut, d
        from (select public.xp_jour() - 1 as d union all select public.xp_jour()) j
        cross join (values (9), (13), (18), (22)) s (h)
    ) x
   where x.d = public.xp_jour() or now() <= x.debut + interval '8 hours'
   order by x.debut
$$;

-- id, portée (j = jour, s = semaine), libellé, mesure, objectif, tirages, vinyles.
-- Une mesure « xp:note » compte les gestes du site (notes, écoutes, avis…), les autres viennent du jeu.
create or replace function public.jeu_missions_defs()
returns table (id text, portee text, libelle text, metrique text, objectif integer, tirages integer, vinyles integer)
language sql
immutable
as $$
  select * from (values
    ('ouvrir10',  'j', 'Ouvrir 10 packs',                    'ouvertures',  10, 6,  0),
    ('ouvrir25',  'j', 'Ouvrir 25 packs',                    'ouvertures',  25, 12, 20),
    ('rare1',     'j', 'Obtenir une carte Rare ou mieux',    'rare_plus',   1,  5,  10),
    ('epique1',   'j', 'Obtenir une carte Épique ou mieux',  'epique_plus', 1,  10, 30),
    ('note3',     'j', 'Noter 3 sorties',                    'xp:note',     3,  6,  10),
    ('ecoute3',   'j', 'Écouter 3 sorties',                  'xp:ecoute',   3,  6,  10),
    ('avis1',     'j', 'Écrire un avis',                     'xp:avis',     1,  8,  20),
    ('comm2',     'j', 'Commenter 2 fois',                   'xp:commentaire', 2, 6, 10),
    ('react5',    'j', 'Réagir 5 fois',                      'xp:reaction', 5,  5,  10),
    ('recycle5',  'j', 'Recycler 5 doublons',                'recycles',    5,  5,  15),
    ('s-ouvrir100','s', 'Ouvrir 100 packs',                  'ouvertures',  100, 40, 100),
    ('s-epique5', 's', 'Obtenir 5 cartes Épique ou mieux',   'epique_plus', 5,  30, 150),
    ('s-note15',  's', 'Noter 15 sorties',                   'xp:note',     15, 25, 80),
    ('s-ecoute15','s', 'Écouter 15 sorties',                 'xp:ecoute',   15, 25, 80),
    ('s-holo1',   's', 'Obtenir une carte holographique',    'holos',       1,  40, 200),
    ('s-avis5',   's', 'Écrire 5 avis',                      'xp:avis',     5,  30, 100)
  ) t (id, portee, libelle, metrique, objectif, tirages, vinyles)
$$;

create or replace function public.jeu_mesure(p_user uuid, p_metrique text, p_du date, p_au date)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_metrique like 'xp:%' then
      (select count(*)::integer from public.xp_journal j where j.user_id = p_user and j.action = substr(p_metrique, 4) and j.jour between p_du and p_au)
    else
      coalesce((select sum(case p_metrique when 'ouvertures' then d.ouvertures when 'rare_plus' then d.rare_plus when 'epique_plus' then d.epique_plus
                                           when 'holos' then d.holos when 'recycles' then d.recycles when 'ateliers' then d.ateliers else 0 end)::integer
                  from public.jeu_jour d where d.user_id = p_user and d.jour between p_du and p_au), 0)
  end
$$;

-- Les trois missions d'un joueur pour une période (le même tirage toute la journée ou la semaine).
create or replace function public.jeu_missions_du(p_user uuid, p_portee text, p_du date, p_au date)
returns table (cle text, id text, libelle text, objectif integer, progres integer, tirages integer, vinyles integer, prise boolean)
language sql
stable
security definer
set search_path = public
as $$
  with choix as (
    select d.*, row_number() over (order by md5(p_user::text || p_du::text || d.id)) as rn
      from public.jeu_missions_defs() d where d.portee = p_portee
  )
  select 'm:' || p_du::text || ':' || c.id, c.id, c.libelle, c.objectif,
         least(c.objectif, public.jeu_mesure(p_user, c.metrique, p_du, p_au)), c.tirages, c.vinyles,
         exists (select 1 from public.jeu_reclamations r where r.user_id = p_user and r.cle = 'm:' || p_du::text || ':' || c.id)
    from choix c where c.rn <= 3 order by c.rn
$$;

create or replace function public.jeu_etat_json(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  j public.jeu_joueurs; v_jour date := public.xp_jour(); v_cap integer; v_prochain integer; v_ev jsonb;
  v_coffres integer; v_miss integer;
begin
  select * into j from public.jeu_joueurs where user_id = p_user;
  v_cap := public.jeu_plafond(j.niveau);
  v_ev := public.jeu_evenement();

  v_prochain := case when j.tirages >= v_cap then null
                     else greatest(0, 600 - floor(extract(epoch from now() - j.recharge_le))::integer % 600) end;

  select count(*) into v_coffres from public.jeu_coffre_liste(p_user) c where c.etat = 'pret';
  select count(*) into v_miss from (
    select m.* from public.jeu_missions_du(p_user, 'j', v_jour, v_jour) m
    union all
    select m.* from public.jeu_missions_du(p_user, 's', public.jeu_lundi(v_jour), public.jeu_lundi(v_jour) + 6) m
  ) m where m.progres >= m.objectif and not m.prise;

  return jsonb_build_object(
    'tirages', j.tirages, 'plafond', v_cap, 'prochain_dans', v_prochain,
    'niveau', j.niveau, 'xp', j.xp, 'xp_depart', public.jeu_xp_seuil(j.niveau), 'xp_fin', public.jeu_xp_seuil(j.niveau + 1),
    'vinyles', j.vinyles, 'garantis', j.garantis, 'serie', j.serie, 'serie_max', j.serie_max,
    'ouvertures', j.ouvertures, 'holos', j.holos,
    'cadeau_pret', j.dernier_cadeau is distinct from v_jour,
    'roue_prete', not exists (select 1 from public.jeu_roue_log r where r.user_id = p_user and r.jour = v_jour),
    'coffres_prets', v_coffres, 'missions_pretes', v_miss,
    'evenement', v_ev,
    'uniques', (select count(distinct release_id) from public.jeu_collection where user_id = p_user and quantite > 0),
    'total_cartes', (select count(*) from public.jeu_cartes));
end $$;

create or replace function public.jeu_etat()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return null; end if;
  perform public.jeu_joueur_assurer(v_uid);
  perform public.jeu_regen(v_uid);
  return public.jeu_etat_json(v_uid);
end $$;


-- ---------------------------------------------------------------------
-- 6. Ouvrir des packs
-- ---------------------------------------------------------------------

create or replace function public.jeu_carte_json(c public.jeu_cartes, p_holo boolean, p_quantite integer)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'id', c.release_id, 'numero', c.numero, 'rarete', c.rarete, 'fans', c.fans, 'artiste', c.artiste, 'handle', c.handle,
    'titre', c.titre, 'cover', c.cover, 'sortie', c.sortie, 'type', c.type, 'holo', p_holo, 'quantite', p_quantite)
$$;

create or replace function public.jeu_ouvrir(p_n integer, p_garanti boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  j public.jeu_joueurs; v_ev jsonb; v_taux numeric[]; v_holo_p numeric; v_jour date := public.xp_jour();
  i integer; v_tier integer; c public.jeu_cartes; v_holo boolean; v_nouvelle boolean; v_nv_holo boolean; v_qte integer;
  v_cartes jsonb := '[]'::jsonb; v_rare_plus boolean := false;
  v_nb_rare integer := 0; v_nb_epique integer := 0; v_nb_holo integer := 0; v_xp integer := 0; v_gain_xp integer;
  v_niv integer; v_niveaux jsonb := '[]'::jsonb; v_bonus_t integer := 0; v_bonus_v integer := 0;
begin
  if v_uid is null then raise exception 'Connecte-toi.'; end if;
  if p_n not in (1, 5, 10) then raise exception 'Quantité inconnue.'; end if;

  perform public.jeu_joueur_assurer(v_uid);
  perform public.jeu_regen(v_uid);
  select * into j from public.jeu_joueurs where user_id = v_uid for update;

  if p_garanti then
    if j.garantis < 1 then raise exception 'Tu n''as pas de pack garanti.'; end if;
    p_n := 1;
  elsif j.tirages < p_n then
    raise exception 'Pas assez de tirages.';
  end if;

  v_ev := public.jeu_evenement();
  select array_agg(x::numeric order by ord) into v_taux from jsonb_array_elements_text(v_ev -> 'taux') with ordinality as t (x, ord);
  v_holo_p := (v_ev ->> 'holo')::numeric;

  for i in 1..p_n loop

    -- Sur dix packs, au moins une Rare ou mieux ; un pack garanti est Épique ou mieux.
    v_tier := public.jeu_tirer_rarete(v_taux,
      case when p_garanti then 3 when p_n >= 10 and i = p_n and not v_rare_plus then 2 else 1 end);

    select * into c from public.jeu_cartes where rarete = v_tier order by random() limit 1;
    if not found then
      select * into c from public.jeu_cartes where rarete <= v_tier order by rarete desc, random() limit 1;
    end if;
    if not found then raise exception 'Aucune carte disponible pour le moment.'; end if;

    v_holo := random() < v_holo_p;
    v_nouvelle := not exists (select 1 from public.jeu_collection where user_id = v_uid and release_id = c.release_id);
    v_nv_holo := v_holo and not exists (select 1 from public.jeu_collection where user_id = v_uid and release_id = c.release_id and holo);

    insert into public.jeu_collection (user_id, release_id, holo, quantite) values (v_uid, c.release_id, v_holo, 1)
    on conflict (user_id, release_id, holo) do update set quantite = public.jeu_collection.quantite + 1
    returning quantite into v_qte;

    if c.rarete >= 2 then v_rare_plus := true; v_nb_rare := v_nb_rare + 1; end if;
    if c.rarete >= 3 then v_nb_epique := v_nb_epique + 1; end if;
    if v_holo then v_nb_holo := v_nb_holo + 1; end if;

    v_gain_xp := 1 + case c.rarete when 3 then 3 when 4 then 10 when 5 then 40 else 0 end + case when v_holo then 20 else 0 end;
    v_xp := v_xp + v_gain_xp;

    v_cartes := v_cartes || (public.jeu_carte_json(c, v_holo, v_qte) || jsonb_build_object('nouvelle', v_nouvelle, 'nouveau_holo', v_nv_holo));
  end loop;

  -- Niveaux gagnés : un petit cadeau à chaque niveau.
  v_niv := j.niveau;
  while j.xp + v_xp >= public.jeu_xp_seuil(v_niv + 1) loop
    v_niv := v_niv + 1;
    v_bonus_t := v_bonus_t + 3 + v_niv / 2;
    v_bonus_v := v_bonus_v + 10 * v_niv;
    v_niveaux := v_niveaux || jsonb_build_object('niveau', v_niv, 'tirages', 3 + v_niv / 2, 'vinyles', 10 * v_niv);
  end loop;

  update public.jeu_joueurs
     set tirages = tirages - case when p_garanti then 0 else p_n end + v_bonus_t,
         garantis = garantis - case when p_garanti then 1 else 0 end,
         vinyles = vinyles + v_bonus_v,
         xp = xp + v_xp, niveau = v_niv,
         ouvertures = ouvertures + p_n, holos = holos + v_nb_holo
   where user_id = v_uid;

  insert into public.jeu_jour (user_id, jour, ouvertures, rare_plus, epique_plus, holos)
  values (v_uid, v_jour, p_n, v_nb_rare, v_nb_epique, v_nb_holo)
  on conflict (user_id, jour) do update
    set ouvertures = public.jeu_jour.ouvertures + excluded.ouvertures, rare_plus = public.jeu_jour.rare_plus + excluded.rare_plus,
        epique_plus = public.jeu_jour.epique_plus + excluded.epique_plus, holos = public.jeu_jour.holos + excluded.holos;

  return jsonb_build_object('cartes', v_cartes, 'niveaux', v_niveaux, 'etat', public.jeu_etat_json(v_uid));
end $$;


-- ---------------------------------------------------------------------
-- 7. La collection et le Discodex
-- ---------------------------------------------------------------------

create or replace function public.jeu_collection_lire(
  p_page integer default 1, p_tri text default 'recent', p_rarete integer default null, p_holo boolean default null, p_q text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid(); v_taille constant integer := 48; v_total integer; v_q text := nullif(btrim(coalesce(p_q, '')), '');
  v_page integer := greatest(coalesce(p_page, 1), 1);
begin
  if v_uid is null then return null; end if;

  select count(*) into v_total
    from public.jeu_collection col join public.jeu_cartes c on c.release_id = col.release_id
   where col.user_id = v_uid and col.quantite > 0
     and (p_rarete is null or c.rarete = p_rarete) and (p_holo is null or col.holo = p_holo)
     and (v_q is null or c.titre ilike '%' || v_q || '%' or c.artiste ilike '%' || v_q || '%');

  return jsonb_build_object(
    'total', v_total, 'pages', greatest(1, ceil(v_total::numeric / v_taille)::integer), 'page', v_page,
    'uniques', (select count(distinct release_id) from public.jeu_collection where user_id = v_uid and quantite > 0),
    'pool', (select count(*) from public.jeu_cartes),
    'cartes', coalesce((
      select jsonb_agg(public.jeu_carte_json(x.c, x.holo, x.quantite) || jsonb_build_object('premiere_le', x.premiere_le) order by x.ord)
        from (
          select c, col.holo, col.quantite, col.premiere_le,
                 row_number() over (order by
                   case when p_tri = 'rarete' then c.rarete end desc nulls last,
                   case when p_tri = 'quantite' then col.quantite end desc nulls last,
                   case when p_tri = 'fans' then c.fans end desc nulls last,
                   case when p_tri = 'nom' then lower(c.artiste) end asc nulls last,
                   case when p_tri = 'sortie' then c.sortie end desc nulls last,
                   col.premiere_le desc, c.release_id) as ord
            from public.jeu_collection col join public.jeu_cartes c on c.release_id = col.release_id
           where col.user_id = v_uid and col.quantite > 0
             and (p_rarete is null or c.rarete = p_rarete) and (p_holo is null or col.holo = p_holo)
             and (v_q is null or c.titre ilike '%' || v_q || '%' or c.artiste ilike '%' || v_q || '%')
           order by ord
           limit v_taille offset (v_page - 1) * v_taille) x), '[]'::jsonb));
end $$;

-- Les artistes : combien de cartes ils ont, combien on en possède.
create or replace function public.jeu_discodex(
  p_page integer default 1, p_q text default null, p_filtre text default 'tous', p_tri text default 'fans')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid(); v_taille constant integer := 36; v_q text := nullif(btrim(coalesce(p_q, '')), '');
  v_page integer := greatest(coalesce(p_page, 1), 1); v_total integer; v_liste jsonb;
begin
  if v_uid is null then return null; end if;

  with dex as (
    select c.handle, max(c.artiste) as nom, max(c.fans) as fans, max(c.rarete)::smallint as rarete, count(*)::integer as total,
           count(*) filter (where exists (select 1 from public.jeu_collection col
                                           where col.user_id = v_uid and col.release_id = c.release_id and col.quantite > 0))::integer as possedees
      from public.jeu_cartes c
     where c.handle is not null and (v_q is null or c.artiste ilike '%' || v_q || '%')
     group by c.handle
  ), filtre as (
    select * from dex
     where case p_filtre when 'commences' then possedees > 0 and possedees < total
                         when 'complets' then possedees = total
                         when 'manquants' then possedees < total
                         when 'decouverts' then possedees > 0
                         else true end
  ), page as (
    select * from filtre
     order by case when p_tri = 'nom' then lower(nom) end asc nulls last,
              case when p_tri = 'avancement' then possedees::numeric / total end desc nulls last,
              fans desc, handle
     limit v_taille offset (v_page - 1) * v_taille
  )
  select (select count(*) from filtre),
         coalesce((select jsonb_agg(jsonb_build_object('handle', p.handle, 'nom', p.nom, 'fans', p.fans, 'rarete', p.rarete,
                                                       'total', p.total, 'possedees', p.possedees,
                                                       'photo', (select a.photo_url from public.artists a where a.instagram_handle = p.handle limit 1))
                                    order by case when p_tri = 'nom' then lower(p.nom) end asc nulls last,
                                             case when p_tri = 'avancement' then p.possedees::numeric / p.total end desc nulls last,
                                             p.fans desc, p.handle)
                     from page p), '[]'::jsonb)
    into v_total, v_liste;

  return jsonb_build_object('total', v_total, 'pages', greatest(1, ceil(v_total::numeric / v_taille)::integer), 'page', v_page, 'artistes', v_liste);
end $$;

create or replace function public.jeu_artiste(p_handle text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return null; end if;

  return jsonb_build_object(
    'handle', p_handle,
    'nom', (select max(artiste) from public.jeu_cartes where handle = p_handle),
    'cartes', coalesce((
      select jsonb_agg(public.jeu_carte_json(c, false, coalesce(
               (select sum(col.quantite) from public.jeu_collection col where col.user_id = v_uid and col.release_id = c.release_id), 0)::integer)
             || jsonb_build_object('holo_possede', exists (select 1 from public.jeu_collection col where col.user_id = v_uid and col.release_id = c.release_id and col.holo and col.quantite > 0))
             order by c.sortie desc nulls last, c.titre)
        from public.jeu_cartes c where c.handle = p_handle), '[]'::jsonb));
end $$;


-- ---------------------------------------------------------------------
-- 8. Doublons : recycler en vinyles, fabriquer à l'atelier
-- ---------------------------------------------------------------------

create or replace function public.jeu_recycler(p_release uuid, p_holo boolean, p_quantite integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid(); col public.jeu_collection; c public.jeu_cartes; v_gain integer;
begin
  if v_uid is null then raise exception 'Connecte-toi.'; end if;
  if coalesce(p_quantite, 0) < 1 then raise exception 'Choisis une quantité.'; end if;

  perform public.jeu_joueur_assurer(v_uid);
  select * into col from public.jeu_collection where user_id = v_uid and release_id = p_release and holo = coalesce(p_holo, false) for update;
  if not found then raise exception 'Tu n''as pas cette carte.'; end if;

  select * into c from public.jeu_cartes where release_id = p_release;
  if col.quantite - p_quantite < 1 then raise exception 'Il faut en garder au moins un exemplaire.'; end if;

  v_gain := p_quantite * public.jeu_valeur(c.rarete) * case when col.holo then 3 else 1 end;

  update public.jeu_collection set quantite = quantite - p_quantite where user_id = v_uid and release_id = p_release and holo = col.holo;
  update public.jeu_joueurs set vinyles = vinyles + v_gain, recycles = recycles + p_quantite where user_id = v_uid;

  insert into public.jeu_jour (user_id, jour, recycles) values (v_uid, public.xp_jour(), p_quantite)
  on conflict (user_id, jour) do update set recycles = public.jeu_jour.recycles + excluded.recycles;

  return jsonb_build_object('vinyles', v_gain, 'etat', public.jeu_etat_json(v_uid));
end $$;

create or replace function public.jeu_atelier(p_release uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid(); c public.jeu_cartes; j public.jeu_joueurs; v_cout integer; v_qte integer;
begin
  if v_uid is null then raise exception 'Connecte-toi.'; end if;

  perform public.jeu_joueur_assurer(v_uid);
  select * into j from public.jeu_joueurs where user_id = v_uid for update;
  select * into c from public.jeu_cartes where release_id = p_release;
  if not found then raise exception 'Carte introuvable.'; end if;

  v_cout := public.jeu_cout(c.rarete);
  if j.vinyles < v_cout then raise exception 'Il te manque % vinyles.', v_cout - j.vinyles; end if;

  insert into public.jeu_collection (user_id, release_id, holo, quantite) values (v_uid, p_release, false, 1)
  on conflict (user_id, release_id, holo) do update set quantite = public.jeu_collection.quantite + 1
  returning quantite into v_qte;

  update public.jeu_joueurs set vinyles = vinyles - v_cout, ateliers = ateliers + 1 where user_id = v_uid;

  insert into public.jeu_jour (user_id, jour, ateliers) values (v_uid, public.xp_jour(), 1)
  on conflict (user_id, jour) do update set ateliers = public.jeu_jour.ateliers + 1;

  return jsonb_build_object('carte', public.jeu_carte_json(c, false, v_qte), 'cout', v_cout, 'etat', public.jeu_etat_json(v_uid));
end $$;


-- ---------------------------------------------------------------------
-- 9. La boucle quotidienne : cadeau, roue, coffre
-- ---------------------------------------------------------------------

create or replace function public.jeu_cadeau()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid(); j public.jeu_joueurs; v_jour date := public.xp_jour(); v_prochaine integer;
begin
  if v_uid is null then return null; end if;
  perform public.jeu_joueur_assurer(v_uid);
  select * into j from public.jeu_joueurs where user_id = v_uid;

  v_prochaine := case when j.dernier_cadeau = v_jour then j.serie
                      when j.dernier_cadeau = v_jour - 1 then j.serie + 1
                      else 1 end;

  return jsonb_build_object(
    'pret', j.dernier_cadeau is distinct from v_jour,
    'serie', case when j.dernier_cadeau >= v_jour - 1 then j.serie else 0 end,
    'jour', ((v_prochaine - 1) % 7) + 1,
    'cadeaux', (select jsonb_agg(jsonb_build_object('jour', g.jour, 'tirages', g.tirages, 'vinyles', g.vinyles, 'garantis', g.garantis) order by g.jour) from public.jeu_cadeaux() g));
end $$;

create or replace function public.jeu_cadeau_prendre()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid(); j public.jeu_joueurs; v_jour date := public.xp_jour(); v_serie integer; g record; v_credit jsonb;
begin
  if v_uid is null then raise exception 'Connecte-toi.'; end if;
  perform public.jeu_joueur_assurer(v_uid);
  select * into j from public.jeu_joueurs where user_id = v_uid for update;

  if j.dernier_cadeau = v_jour then raise exception 'Cadeau déjà récupéré aujourd''hui.'; end if;

  v_serie := case when j.dernier_cadeau = v_jour - 1 then j.serie + 1 else 1 end;
  select * into g from public.jeu_cadeaux() c where c.jour = ((v_serie - 1) % 7) + 1;

  update public.jeu_joueurs set serie = v_serie, serie_max = greatest(serie_max, v_serie), dernier_cadeau = v_jour where user_id = v_uid;
  v_credit := public.jeu_crediter(v_uid, g.tirages, g.vinyles, g.garantis);

  return jsonb_build_object('serie', v_serie, 'jour', g.jour, 'gain', v_credit, 'etat', public.jeu_etat_json(v_uid));
end $$;

-- La roue : libellé, tirages, vinyles, packs garantis, poids.
create or replace function public.jeu_roue_secteurs()
returns table (n integer, libelle text, tirages integer, vinyles integer, garantis integer, poids integer)
language sql
immutable
as $$
  select * from (values
    (1, '5 tirages',      5,  0,  0, 22),
    (2, '20 vinyles',     0,  20, 0, 18),
    (3, '10 tirages',     10, 0,  0, 16),
    (4, '60 vinyles',     0,  60, 0, 12),
    (5, '15 tirages',     15, 0,  0, 10),
    (6, 'Pack Épique',    0,  0,  1, 6),
    (7, '30 tirages',     30, 0,  0, 4),
    (8, 'JACKPOT · 80 tirages', 80, 0, 0, 1)
  ) t (n, libelle, tirages, vinyles, garantis, poids)
$$;

create or replace function public.jeu_roue()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid(); v_jour date := public.xp_jour(); r public.jeu_roue_log;
begin
  if v_uid is null then return null; end if;
  select * into r from public.jeu_roue_log where user_id = v_uid and jour = v_jour;
  return jsonb_build_object(
    'prete', r.user_id is null,
    'secteurs', (select jsonb_agg(jsonb_build_object('n', s.n, 'libelle', s.libelle) order by s.n) from public.jeu_roue_secteurs() s),
    'dernier', case when r.user_id is null then null else jsonb_build_object('n', r.secteur, 'libelle', r.libelle) end);
end $$;

create or replace function public.jeu_roue_tourner()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid(); v_jour date := public.xp_jour(); v_tot integer; v_r numeric; v_cum numeric := 0; s record; v_choix record; v_credit jsonb;
begin
  if v_uid is null then raise exception 'Connecte-toi.'; end if;
  perform public.jeu_joueur_assurer(v_uid);

  if exists (select 1 from public.jeu_roue_log where user_id = v_uid and jour = v_jour) then
    raise exception 'La roue a déjà tourné aujourd''hui.';
  end if;

  select sum(poids) into v_tot from public.jeu_roue_secteurs();
  v_r := random() * v_tot;

  for s in select * from public.jeu_roue_secteurs() order by n loop
    v_cum := v_cum + s.poids;
    if v_r < v_cum then v_choix := s; exit; end if;
  end loop;

  insert into public.jeu_roue_log (user_id, jour, secteur, libelle) values (v_uid, v_jour, v_choix.n, v_choix.libelle);
  v_credit := public.jeu_crediter(v_uid, v_choix.tirages, v_choix.vinyles, v_choix.garantis);

  return jsonb_build_object('n', v_choix.n, 'libelle', v_choix.libelle, 'gain', v_credit, 'etat', public.jeu_etat_json(v_uid));
end $$;

create or replace function public.jeu_coffre()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return null; end if;
  perform public.jeu_joueur_assurer(v_uid);
  return jsonb_build_object('cadeaux', coalesce((
    select jsonb_agg(jsonb_build_object('cle', c.cle, 'heure', c.heure, 'debut', c.debut, 'fin', c.fin, 'etat', c.etat, 'tirages', c.tirages) order by c.debut)
      from public.jeu_coffre_liste(v_uid) c), '[]'::jsonb));
end $$;

create or replace function public.jeu_coffre_prendre(p_cle text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid(); c record; v_credit jsonb;
begin
  if v_uid is null then raise exception 'Connecte-toi.'; end if;
  perform public.jeu_joueur_assurer(v_uid);

  select * into c from public.jeu_coffre_liste(v_uid) l where l.cle = p_cle;
  if not found then raise exception 'Ce cadeau n''existe pas.'; end if;
  if c.etat = 'prise' then raise exception 'Déjà récupéré.'; end if;
  if c.etat = 'a_venir' then raise exception 'Pas encore disponible.'; end if;
  if c.etat = 'expire' then raise exception 'Ce cadeau a expiré.'; end if;

  if not public.jeu_reclamer(v_uid, 'coffre:' || p_cle) then raise exception 'Déjà récupéré.'; end if;
  v_credit := public.jeu_crediter(v_uid, c.tirages, 0, 0);

  return jsonb_build_object('gain', v_credit, 'etat', public.jeu_etat_json(v_uid));
end $$;


-- ---------------------------------------------------------------------
-- 10. Missions du jour et défis de la semaine
-- ---------------------------------------------------------------------

create or replace function public.jeu_missions()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid(); v_jour date := public.xp_jour(); v_lundi date := public.jeu_lundi(public.xp_jour());
  v_paris timestamp := now() at time zone 'Europe/Paris';
begin
  if v_uid is null then return null; end if;
  perform public.jeu_joueur_assurer(v_uid);

  return jsonb_build_object(
    'jour', coalesce((select jsonb_agg(to_jsonb(m)) from public.jeu_missions_du(v_uid, 'j', v_jour, v_jour) m), '[]'::jsonb),
    'semaine', coalesce((select jsonb_agg(to_jsonb(m)) from public.jeu_missions_du(v_uid, 's', v_lundi, v_lundi + 6) m), '[]'::jsonb),
    'bonus_jour', jsonb_build_object(
      'cle', 'mb:' || v_jour::text, 'tirages', 15,
      'pret', (select count(*) from public.jeu_missions_du(v_uid, 'j', v_jour, v_jour) m where m.progres >= m.objectif) = 3
              and not exists (select 1 from public.jeu_reclamations r where r.user_id = v_uid and r.cle = 'mb:' || v_jour::text),
      'pris', exists (select 1 from public.jeu_reclamations r where r.user_id = v_uid and r.cle = 'mb:' || v_jour::text)),
    'bonus_semaine', jsonb_build_object(
      'cle', 'sb:' || v_lundi::text, 'tirages', 50, 'garantis', 1,
      'pret', (select count(*) from public.jeu_missions_du(v_uid, 's', v_lundi, v_lundi + 6) m where m.progres >= m.objectif) = 3
              and not exists (select 1 from public.jeu_reclamations r where r.user_id = v_uid and r.cle = 'sb:' || v_lundi::text),
      'pris', exists (select 1 from public.jeu_reclamations r where r.user_id = v_uid and r.cle = 'sb:' || v_lundi::text)),
    'fin_jour', floor(extract(epoch from (date_trunc('day', v_paris) + interval '1 day') - v_paris))::integer,
    'fin_semaine', floor(extract(epoch from (v_lundi + 7)::timestamp - v_paris))::integer);
end $$;

create or replace function public.jeu_mission_prendre(p_cle text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid(); v_jour date := public.xp_jour(); v_lundi date := public.jeu_lundi(public.xp_jour());
  m record; v_credit jsonb; v_nb integer;
begin
  if v_uid is null then raise exception 'Connecte-toi.'; end if;
  perform public.jeu_joueur_assurer(v_uid);

  if p_cle = 'mb:' || v_jour::text then
    select count(*) into v_nb from public.jeu_missions_du(v_uid, 'j', v_jour, v_jour) x where x.progres >= x.objectif;
    if v_nb < 3 then raise exception 'Termine les trois missions d''abord.'; end if;
    if not public.jeu_reclamer(v_uid, p_cle) then raise exception 'Déjà récupéré.'; end if;
    v_credit := public.jeu_crediter(v_uid, 15, 0, 0);

  elsif p_cle = 'sb:' || v_lundi::text then
    select count(*) into v_nb from public.jeu_missions_du(v_uid, 's', v_lundi, v_lundi + 6) x where x.progres >= x.objectif;
    if v_nb < 3 then raise exception 'Termine les trois défis d''abord.'; end if;
    if not public.jeu_reclamer(v_uid, p_cle) then raise exception 'Déjà récupéré.'; end if;
    v_credit := public.jeu_crediter(v_uid, 50, 0, 1);

  else
    select * into m from (
      select * from public.jeu_missions_du(v_uid, 'j', v_jour, v_jour)
      union all
      select * from public.jeu_missions_du(v_uid, 's', v_lundi, v_lundi + 6)
    ) x where x.cle = p_cle;

    if not found then raise exception 'Cette mission n''est pas la tienne aujourd''hui.'; end if;
    if m.progres < m.objectif then raise exception 'Mission pas encore terminée.'; end if;
    if not public.jeu_reclamer(v_uid, p_cle) then raise exception 'Déjà récupéré.'; end if;
    v_credit := public.jeu_crediter(v_uid, m.tirages, m.vinyles, 0);
  end if;

  return jsonb_build_object('gain', v_credit, 'etat', public.jeu_etat_json(v_uid));
end $$;


-- ---------------------------------------------------------------------
-- 11. Les succès
-- ---------------------------------------------------------------------

insert into public.jeu_succes_def (id, famille, nom, description, metrique, seuil, tirages, vinyles, ordre) values
  ('ouv-10',    'ouvertures', 'Premiers packs',      'Ouvrir 10 packs',                         'ouvertures', 10,   5,   0,   101),
  ('ouv-50',    'ouvertures', 'Chasseur de vinyles', 'Ouvrir 50 packs',                         'ouvertures', 50,   10,  20,  102),
  ('ouv-100',   'ouvertures', 'Habitué du bac',      'Ouvrir 100 packs',                        'ouvertures', 100,  20,  40,  103),
  ('ouv-250',   'ouvertures', 'Digger',              'Ouvrir 250 packs',                        'ouvertures', 250,  40,  80,  104),
  ('ouv-500',   'ouvertures', 'Disquaire',           'Ouvrir 500 packs',                        'ouvertures', 500,  80,  150, 105),
  ('ouv-1000',  'ouvertures', 'Grossiste',           'Ouvrir 1 000 packs',                      'ouvertures', 1000, 150, 300, 106),
  ('ouv-2500',  'ouvertures', 'Légende du bac',      'Ouvrir 2 500 packs',                      'ouvertures', 2500, 300, 600, 107),
  ('uni-10',    'uniques',    'Première étagère',    'Posséder 10 cartes différentes',          'uniques',    10,   5,   0,   111),
  ('uni-50',    'uniques',    'Une vraie collection','Posséder 50 cartes différentes',         'uniques',    50,   15,  30,  112),
  ('uni-100',   'uniques',    'Rayon complet',       'Posséder 100 cartes différentes',        'uniques',    100,  30,  60,  113),
  ('uni-250',   'uniques',    'Médiathèque',         'Posséder 250 cartes différentes',        'uniques',    250,  60,  120, 114),
  ('uni-500',   'uniques',    'Archiviste',          'Posséder 500 cartes différentes',        'uniques',    500,  120, 240, 115),
  ('uni-1000',  'uniques',    'Conservatoire',       'Posséder 1 000 cartes différentes',      'uniques',    1000, 250, 500, 116),
  ('holo-1',    'holos',      'Ça brille',           'Obtenir une carte holographique',         'holos',      1,    20,  50,  121),
  ('holo-3',    'holos',      'Chasseur d''éclats',  'Obtenir 3 cartes holographiques',         'holos',      3,    30,  80,  122),
  ('holo-10',   'holos',      'Arc-en-ciel',         'Obtenir 10 cartes holographiques',        'holos',      10,   60,  150, 123),
  ('holo-25',   'holos',      'Chrome',              'Obtenir 25 cartes holographiques',        'holos',      25,   120, 300, 124),
  ('rare-10',   'rares',      'Du goût',             'Posséder 10 cartes Rares ou mieux',       'rares',      10,   10,  20,  131),
  ('rare-50',   'rares',      'Bon flair',           'Posséder 50 cartes Rares ou mieux',       'rares',      50,   30,  60,  132),
  ('rare-150',  'rares',      'Œil de lynx',         'Posséder 150 cartes Rares ou mieux',      'rares',      150,  80,  160, 133),
  ('epi-1',     'epiques',    'Gros nom',            'Obtenir une carte Épique ou mieux',       'epiques',    1,    15,  30,  141),
  ('epi-5',     'epiques',    'Tête d''affiche',     'Posséder 5 cartes Épiques ou mieux',      'epiques',    5,    30,  70,  142),
  ('epi-20',    'epiques',    'Festival',            'Posséder 20 cartes Épiques ou mieux',     'epiques',    20,   70,  160, 143),
  ('epi-60',    'epiques',    'Panthéon',            'Posséder 60 cartes Épiques ou mieux',     'epiques',    60,   150, 350, 144),
  ('leg-1',     'legendaires','Légende',             'Obtenir une carte Légendaire ou mieux',   'legendaires',1,    30,  80,  151),
  ('leg-3',     'legendaires','Disque d''or',        'Posséder 3 cartes Légendaires ou mieux',  'legendaires',3,    60,  150, 152),
  ('leg-10',    'legendaires','Disque de diamant',   'Posséder 10 cartes Légendaires ou mieux', 'legendaires',10,   150, 350, 153),
  ('leg-25',    'legendaires','Hall of fame',        'Posséder 25 cartes Légendaires ou mieux', 'legendaires',25,   300, 700, 154),
  ('myt-1',     'mythiques',  'Mythique',            'Obtenir une carte Mythique',              'mythiques',  1,    60,  150, 161),
  ('myt-3',     'mythiques',  'Trinité',             'Posséder 3 cartes Mythiques',             'mythiques',  3,    120, 300, 162),
  ('myt-10',    'mythiques',  'Olympe',              'Posséder 10 cartes Mythiques',            'mythiques',  10,   300, 700, 163),
  ('art-10',    'artistes',   'Curieux',             'Posséder des cartes de 10 artistes',      'artistes',   10,   8,   20,  171),
  ('art-50',    'artistes',   'Explorateur',         'Posséder des cartes de 50 artistes',      'artistes',   50,   25,  60,  172),
  ('art-150',   'artistes',   'Cartographe',         'Posséder des cartes de 150 artistes',     'artistes',   150,  70,  160, 173),
  ('art-400',   'artistes',   'Encyclopédie',        'Posséder des cartes de 400 artistes',     'artistes',   400,  160, 360, 174),
  ('niv-5',     'niveau',     'Niveau 5',            'Atteindre le niveau 5',                   'niveau',     5,    10,  20,  181),
  ('niv-10',    'niveau',     'Niveau 10',           'Atteindre le niveau 10',                  'niveau',     10,   25,  50,  182),
  ('niv-20',    'niveau',     'Niveau 20',           'Atteindre le niveau 20',                  'niveau',     20,   60,  120, 183),
  ('niv-35',    'niveau',     'Niveau 35',           'Atteindre le niveau 35',                  'niveau',     35,   120, 250, 184),
  ('niv-50',    'niveau',     'Niveau 50',           'Atteindre le niveau 50',                  'niveau',     50,   250, 500, 185),
  ('rec-10',    'recycles',   'Tri sélectif',        'Recycler 10 doublons',                    'recycles',   10,   5,   0,   191),
  ('rec-100',   'recycles',   'Recyclerie',          'Recycler 100 doublons',                   'recycles',   100,  25,  0,   192),
  ('rec-500',   'recycles',   'Usine à vinyles',     'Recycler 500 doublons',                   'recycles',   500,  80,  0,   193),
  ('ate-1',     'ateliers',   'Sur mesure',          'Fabriquer une carte à l''atelier',        'ateliers',   1,    10,  0,   201),
  ('ate-10',    'ateliers',   'Artisan',             'Fabriquer 10 cartes à l''atelier',        'ateliers',   10,   40,  0,   202),
  ('ate-30',    'ateliers',   'Maître d''atelier',   'Fabriquer 30 cartes à l''atelier',        'ateliers',   30,   100, 0,   203),
  ('roue-7',    'roues',      'Chanceux',            'Tourner la roue du jour 7 fois',          'roues',      7,    10,  20,  211),
  ('roue-30',   'roues',      'Fidèle de la roue',   'Tourner la roue du jour 30 fois',         'roues',      30,   40,  80,  212),
  ('roue-100',  'roues',      'Roi de la roue',      'Tourner la roue du jour 100 fois',        'roues',      100,  120, 240, 213),
  ('serie-7',   'serie',      'Une semaine',         'Récupérer le cadeau 7 jours de suite',    'serie_max',  7,    15,  40,  221),
  ('serie-14',  'serie',      'Deux semaines',       'Récupérer le cadeau 14 jours de suite',   'serie_max',  14,   40,  100, 222),
  ('serie-30',  'serie',      'Un mois',             'Récupérer le cadeau 30 jours de suite',   'serie_max',  30,   100, 250, 223),
  ('mis-10',    'missions',   'Appliqué',            'Terminer 10 missions',                    'missions',   10,   10,  20,  231),
  ('mis-50',    'missions',   'Assidu',              'Terminer 50 missions',                    'missions',   50,   40,  100, 232),
  ('mis-200',   'missions',   'Infatigable',         'Terminer 200 missions',                   'missions',   200,  120, 300, 233)
on conflict (id) do update
  set famille = excluded.famille, nom = excluded.nom, description = excluded.description, metrique = excluded.metrique,
      seuil = excluded.seuil, tirages = excluded.tirages, vinyles = excluded.vinyles, ordre = excluded.ordre;

create or replace function public.jeu_metriques(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'ouvertures', coalesce(j.ouvertures, 0), 'holos', coalesce(j.holos, 0), 'niveau', coalesce(j.niveau, 1),
    'recycles', coalesce(j.recycles, 0), 'ateliers', coalesce(j.ateliers, 0), 'serie_max', coalesce(j.serie_max, 0),
    'roues', (select count(*) from public.jeu_roue_log r where r.user_id = p_user),
    'missions', (select count(*) from public.jeu_reclamations r where r.user_id = p_user and r.cle like 'm:%'),
    'uniques', coalesce(c.uniques, 0), 'rares', coalesce(c.rares, 0), 'epiques', coalesce(c.epiques, 0),
    'legendaires', coalesce(c.legendaires, 0), 'mythiques', coalesce(c.mythiques, 0), 'artistes', coalesce(c.artistes, 0))
  from (select 1) base
  left join public.jeu_joueurs j on j.user_id = p_user
  left join lateral (
    select count(*)::integer as uniques,
           count(*) filter (where k.rarete >= 2)::integer as rares, count(*) filter (where k.rarete >= 3)::integer as epiques,
           count(*) filter (where k.rarete >= 4)::integer as legendaires, count(*) filter (where k.rarete >= 5)::integer as mythiques,
           count(distinct k.handle)::integer as artistes
      from (select distinct release_id from public.jeu_collection where user_id = p_user and quantite > 0) o
      join public.jeu_cartes k on k.release_id = o.release_id
  ) c on true
$$;

create or replace function public.jeu_succes()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid(); m jsonb;
begin
  if v_uid is null then return null; end if;
  perform public.jeu_joueur_assurer(v_uid);
  m := public.jeu_metriques(v_uid);

  return jsonb_build_object('succes', coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', d.id, 'famille', d.famille, 'nom', d.nom, 'description', d.description, 'seuil', d.seuil,
             'progres', least(d.seuil, coalesce((m ->> d.metrique)::integer, 0)),
             'atteint', coalesce((m ->> d.metrique)::integer, 0) >= d.seuil,
             'pris', exists (select 1 from public.jeu_reclamations r where r.user_id = v_uid and r.cle = 'succes:' || d.id),
             'tirages', d.tirages, 'vinyles', d.vinyles) order by d.ordre)
      from public.jeu_succes_def d), '[]'::jsonb));
end $$;

create or replace function public.jeu_succes_prendre(p_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid(); d public.jeu_succes_def; m jsonb; v_credit jsonb;
begin
  if v_uid is null then raise exception 'Connecte-toi.'; end if;
  perform public.jeu_joueur_assurer(v_uid);

  select * into d from public.jeu_succes_def where id = p_id;
  if not found then raise exception 'Succès inconnu.'; end if;

  m := public.jeu_metriques(v_uid);
  if coalesce((m ->> d.metrique)::integer, 0) < d.seuil then raise exception 'Succès pas encore atteint.'; end if;
  if not public.jeu_reclamer(v_uid, 'succes:' || p_id) then raise exception 'Déjà récupéré.'; end if;

  v_credit := public.jeu_crediter(v_uid, d.tirages, d.vinyles, 0);
  return jsonb_build_object('gain', v_credit, 'etat', public.jeu_etat_json(v_uid));
end $$;


-- ---------------------------------------------------------------------
-- 12. L'équipe : offrir des tirages (pour tester ou récompenser)
-- ---------------------------------------------------------------------

create or replace function public.jeu_equipe_donner(p_pseudo text, p_tirages integer, p_vinyles integer default 0)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if not public.est_equipe() then raise exception 'Réservé à l''équipe.'; end if;
  select id into v_id from public.profiles where lower(pseudo) = lower(btrim(p_pseudo));
  if v_id is null then raise exception 'Pseudo introuvable.'; end if;
  perform public.jeu_joueur_assurer(v_id);
  return public.jeu_crediter(v_id, greatest(coalesce(p_tirages, 0), 0), greatest(coalesce(p_vinyles, 0), 0), 0);
end $$;


-- ---------------------------------------------------------------------
-- 13. Droits et tâches planifiées
-- ---------------------------------------------------------------------

-- Internes : jamais depuis le navigateur.
revoke all on function public.jeu_fans_importer(integer)                         from public, anon, authenticated;
revoke all on function public.jeu_cartes_rafraichir()                            from public, anon, authenticated;
revoke all on function public.jeu_joueur_assurer(uuid)                           from public, anon, authenticated;
revoke all on function public.jeu_regen(uuid)                                    from public, anon, authenticated;
revoke all on function public.jeu_crediter(uuid, integer, integer, integer)      from public, anon, authenticated;
revoke all on function public.jeu_reclamer(uuid, text)                           from public, anon, authenticated;
revoke all on function public.jeu_etat_json(uuid)                                from public, anon, authenticated;
revoke all on function public.jeu_coffre_liste(uuid)                             from public, anon, authenticated;
revoke all on function public.jeu_mesure(uuid, text, date, date)                 from public, anon, authenticated;
revoke all on function public.jeu_missions_du(uuid, text, date, date)            from public, anon, authenticated;
revoke all on function public.jeu_metriques(uuid)                                from public, anon, authenticated;

-- Ce que le site appelle.
revoke all on function public.jeu_etat()                                         from public, anon;
revoke all on function public.jeu_ouvrir(integer, boolean)                       from public, anon;
revoke all on function public.jeu_collection_lire(integer, text, integer, boolean, text) from public, anon;
revoke all on function public.jeu_discodex(integer, text, text, text)            from public, anon;
revoke all on function public.jeu_artiste(text)                                  from public, anon;
revoke all on function public.jeu_recycler(uuid, boolean, integer)               from public, anon;
revoke all on function public.jeu_atelier(uuid)                                  from public, anon;
revoke all on function public.jeu_cadeau()                                       from public, anon;
revoke all on function public.jeu_cadeau_prendre()                               from public, anon;
revoke all on function public.jeu_roue()                                         from public, anon;
revoke all on function public.jeu_roue_tourner()                                 from public, anon;
revoke all on function public.jeu_coffre()                                       from public, anon;
revoke all on function public.jeu_coffre_prendre(text)                           from public, anon;
revoke all on function public.jeu_missions()                                     from public, anon;
revoke all on function public.jeu_mission_prendre(text)                          from public, anon;
revoke all on function public.jeu_succes()                                       from public, anon;
revoke all on function public.jeu_succes_prendre(text)                           from public, anon;
revoke all on function public.jeu_equipe_donner(text, integer, integer)          from public, anon;

grant execute on function public.jeu_etat()                                      to authenticated;
grant execute on function public.jeu_ouvrir(integer, boolean)                    to authenticated;
grant execute on function public.jeu_collection_lire(integer, text, integer, boolean, text) to authenticated;
grant execute on function public.jeu_discodex(integer, text, text, text)         to authenticated;
grant execute on function public.jeu_artiste(text)                               to authenticated;
grant execute on function public.jeu_recycler(uuid, boolean, integer)            to authenticated;
grant execute on function public.jeu_atelier(uuid)                               to authenticated;
grant execute on function public.jeu_cadeau()                                    to authenticated;
grant execute on function public.jeu_cadeau_prendre()                            to authenticated;
grant execute on function public.jeu_roue()                                      to authenticated;
grant execute on function public.jeu_roue_tourner()                              to authenticated;
grant execute on function public.jeu_coffre()                                    to authenticated;
grant execute on function public.jeu_coffre_prendre(text)                        to authenticated;
grant execute on function public.jeu_missions()                                  to authenticated;
grant execute on function public.jeu_mission_prendre(text)                       to authenticated;
grant execute on function public.jeu_succes()                                    to authenticated;
grant execute on function public.jeu_succes_prendre(text)                        to authenticated;
grant execute on function public.jeu_equipe_donner(text, integer, integer)       to authenticated;

-- Les fans d'abord (toutes les 3 minutes jusqu'à ce que tous les artistes soient lus, puis une fois par mois), les cartes ensuite.
select cron.schedule('jeu-fans',   '*/3 * * * *',  'select public.jeu_fans_importer(220)');
select cron.schedule('jeu-cartes', '*/20 * * * *', 'select public.jeu_cartes_rafraichir()');

-- Les annonces de l'engagement (duels, saison, résumés, sorties d'artistes aimés) s'arrêtent.
select cron.unschedule(jobid) from cron.job where jobname like 'engagement-%';

-- Premier remplissage des cartes (les raretés se précisent à mesure que les fans arrivent).
select public.jeu_cartes_rafraichir();
