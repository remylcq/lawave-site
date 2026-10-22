-- =====================================================================
-- La Wave — des cartes d'artistes, et un site francophone
--
-- 1. La langue des artistes. Chaque artiste reçoit artists.francophone :
--      vrai  → il reste sur le site ;
--      faux  → son profil et ses sorties sont masqués partout (catalogue, accueil,
--              carte, recherche, espace équipe), comme un banni, mais sans entrer
--              dans la liste des bannis ;
--      vide  → pas encore tranché : il reste visible, mais n'a pas de carte.
--    Le premier tri vient de Wikidata (nationalité, langues) et des « artistes
--    similaires » de Deezer ; la liste de l'équipe (source « liste-rappeurs »,
--    ou ajout à la main) est francophone d'office. Les nouveaux artistes sont
--    triés par une tâche planifiée (langue_classer). L'équipe corrige à la main
--    dans l'onglet Artistes → « Non francophones ».
--
-- 2. Le jeu devient un jeu de cartes d'ARTISTES : une carte par artiste
--    francophone qui a au moins une sortie publiée et une photo (et au moins
--    1 000 fans Deezer, sauf les artistes de la liste de l'équipe). Les cartes
--    sont numérotées une fois pour toutes (#1 = le plus suivi au départ) ; la
--    rareté suit les fans, comme avant. Les collections tirées sur les sorties
--    sont remises à zéro (le jeu n'était pas encore annoncé).
--
-- À passer après sql/cartes.sql et sql/artistes-bannis.sql. Se rejoue sans risque.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. La langue des artistes
-- ---------------------------------------------------------------------

alter table public.artists     add column if not exists francophone   boolean;
alter table public.artists     add column if not exists langue_source text;
alter table public.artists     add column if not exists langue_le     timestamptz;
alter table public.submissions add column if not exists hors_langue   boolean not null default false;

create index if not exists artists_langue_a_trier_idx on public.artists (langue_le nulls first) where francophone is null;
create index if not exists submissions_hors_langue_idx on public.submissions (artist_handle) where hors_langue;

-- Masqués pour tout le monde, équipe comprise, comme les bannis : une règle « restrictive » s'ajoute aux autres.
drop policy if exists "artistes non francophones masques" on public.artists;
create policy "artistes non francophones masques"
  on public.artists as restrictive for select to public
  using (francophone is not false);

drop policy if exists "sorties non francophones masquees" on public.submissions;
create policy "sorties non francophones masquees"
  on public.submissions as restrictive for select to public
  using (not hors_langue);

-- Une sortie suit son artiste principal.
create or replace function public.submissions_langue()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.hors_langue := exists (
    select 1 from public.artists a where a.instagram_handle = new.artist_handle and a.francophone is false);
  return new;
end $$;

drop trigger if exists submissions_langue on public.submissions;
create trigger submissions_langue
  before insert or update of artist_handle on public.submissions
  for each row execute function public.submissions_langue();

create or replace function public.artists_langue_propager()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.francophone is distinct from old.francophone or new.instagram_handle is distinct from old.instagram_handle then
    update public.submissions s
       set hors_langue = (new.francophone is false)
     where s.artist_handle = new.instagram_handle
       and s.hors_langue is distinct from (new.francophone is false);
  end if;
  return null;
end $$;

drop trigger if exists artists_langue_propager on public.artists;
create trigger artists_langue_propager
  after update of francophone, instagram_handle on public.artists
  for each row execute function public.artists_langue_propager();

-- Recalcule le drapeau de toutes les sorties (après un tri en masse).
create or replace function public.langue_appliquer()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_on integer; v_off integer;
begin
  update public.submissions s set hors_langue = true
   where not s.hors_langue
     and exists (select 1 from public.artists a where a.instagram_handle = s.artist_handle and a.francophone is false);
  get diagnostics v_on = row_count;

  update public.submissions s set hors_langue = false
   where s.hors_langue
     and not exists (select 1 from public.artists a where a.instagram_handle = s.artist_handle and a.francophone is false);
  get diagnostics v_off = row_count;

  return jsonb_build_object('masquees', v_on, 'retablies', v_off);
end $$;


-- Les pays où l'on parle français (Wikidata) : la France et ses outre-mer, la Belgique, la Suisse, le Luxembourg,
-- Monaco, Haïti, l'Afrique francophone, le Maghreb, le Liban. Le Canada compte si l'artiste parle français.
create or replace function public.langue_pays_francophones()
returns text[]
language sql
immutable
as $$
  select array['Q142','Q31','Q39','Q32','Q235','Q790','Q1041','Q1008','Q1009','Q974','Q971','Q912','Q965','Q1032','Q945',
               'Q962','Q1000','Q1006','Q1019','Q970','Q977','Q657','Q929','Q967','Q1037','Q1027','Q1042','Q262','Q1028',
               'Q948','Q1025','Q822','Q686','Q17012','Q17054','Q17070','Q3769','Q17063','Q33788','Q30971','Q70972',
               'Q126125','Q34617','Q7226','Q83286']
$$;

-- Ce que Wikidata dit d'un artiste : vrai, faux, ou rien.
create or replace function public.langue_selon_wikidata(p_pays text[], p_langues text[])
returns boolean
language sql
immutable
as $$
  select case
    when coalesce(cardinality(p_pays), 0) > 0 then
      case when p_pays && public.langue_pays_francophones() then true
           when 'Q16' = any(p_pays) then case when coalesce(cardinality(p_langues), 0) > 0 then 'Q150' = any(p_langues) end
           else false end
    when coalesce(cardinality(p_langues), 0) > 0 then 'Q150' = any(p_langues)
  end
$$;

-- Le tri des nouveaux artistes, par petits lots :
--   · la liste de l'équipe : francophone d'office ;
--   · Wikidata, par l'identifiant Deezer (nationalité, pays d'origine, de naissance ou de formation, langues) ;
--   · sinon les « artistes similaires » de Deezer déjà triés sur La Wave, puis les collaborations du catalogue.
-- Un artiste qui reste sans réponse est revu deux semaines plus tard.
create or replace function public.langue_classer(p_lot integer default 25)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_debut timestamptz := clock_timestamp();
  v_ids bigint[]; v_q text; v_rep http_response; v_json jsonb; b jsonb;
  a record; v_val boolean; v_src text; v_oui integer; v_non integer;
  v_wd jsonb := '{}'::jsonb;
  v_faits integer := 0; v_tranches integer := 0;
begin
  if not pg_try_advisory_xact_lock(hashtext('langue_classer')) then
    return jsonb_build_object('ignore', true);
  end if;

  begin
    perform http_set_curlopt('CURLOPT_TIMEOUT', '20');
  exception when others then null;
  end;

  -- La liste de l'équipe, d'un coup.
  update public.artists set francophone = true, langue_source = 'liste', langue_le = now()
   where francophone is null and (source is null or source = 'liste-rappeurs');

  select array_agg(deezer_artist_id) into v_ids
    from (select deezer_artist_id from public.artists
           where francophone is null and deezer_artist_id is not null
             and (langue_le is null or langue_le < now() - interval '14 days')
           order by langue_le nulls first, id
           limit greatest(p_lot, 1)) x;

  if v_ids is null then
    return jsonb_build_object('faits', 0, 'restants', 0);
  end if;

  -- Wikidata : une seule question pour tout le lot.
  v_q := 'SELECT ?dz (GROUP_CONCAT(DISTINCT ?p;separator="|") AS ?pays) (GROUP_CONCAT(DISTINCT ?l;separator="|") AS ?langues) WHERE { '
      || 'VALUES ?dz { ' || (select string_agg('"' || i || '"', ' ') from unnest(v_ids) i) || ' } ?item wdt:P2722 ?dz . '
      || 'OPTIONAL { ?item wdt:P27|wdt:P495|wdt:P740/wdt:P17|wdt:P19/wdt:P17 ?p } OPTIONAL { ?item wdt:P1412|wdt:P407 ?l } } GROUP BY ?dz';
  begin
    v_rep := http((
      'GET', 'https://query.wikidata.org/sparql?format=json&query=' || urlencode(v_q),
      array[http_header('User-Agent', 'LaWaveBot/1.0 (https://lawave.fr)'), http_header('Accept', 'application/sparql-results+json')],
      null, null)::http_request);
    if v_rep.status = 200 then
      for b in select * from jsonb_array_elements(v_rep.content::jsonb -> 'results' -> 'bindings') loop
        v_wd := v_wd || jsonb_build_object(b -> 'dz' ->> 'value', jsonb_build_object(
          'pays', (select coalesce(jsonb_agg(regexp_replace(x, '^.*/', '')), '[]') from unnest(string_to_array(nullif(b -> 'pays' ->> 'value', ''), '|')) x),
          'langues', (select coalesce(jsonb_agg(regexp_replace(x, '^.*/', '')), '[]') from unnest(string_to_array(nullif(b -> 'langues' ->> 'value', ''), '|')) x)));
      end loop;
    end if;
  exception when others then null;
  end;

  for a in select id, instagram_handle, deezer_artist_id from public.artists where deezer_artist_id = any(v_ids) and francophone is null loop

    exit when clock_timestamp() - v_debut > interval '70 seconds';
    v_val := null; v_src := null;

    if v_wd ? a.deezer_artist_id::text then
      v_val := public.langue_selon_wikidata(
        array(select jsonb_array_elements_text(v_wd -> a.deezer_artist_id::text -> 'pays')),
        array(select jsonb_array_elements_text(v_wd -> a.deezer_artist_id::text -> 'langues')));
      v_src := 'wikidata';
    end if;

    -- Les artistes similaires de Deezer, quand on les connaît déjà.
    if v_val is null then
      begin
        v_rep := http_get('https://api.deezer.com/artist/' || a.deezer_artist_id || '/related?limit=20');
        if v_rep.status = 200 then
          v_json := v_rep.content::jsonb;
          select count(*) filter (where x.francophone is true), count(*) filter (where x.francophone is false)
            into v_oui, v_non
            from public.artists x
           where x.deezer_artist_id in (select (r ->> 'id')::bigint from jsonb_array_elements(coalesce(v_json -> 'data', '[]')) r);
          if v_non >= 3 and v_non > v_oui * 2 then v_val := false; v_src := 'deezer';
          elsif v_oui >= 3 and v_oui > v_non * 2 then v_val := true; v_src := 'deezer';
          end if;
        end if;
      exception when others then null;
      end;
      perform pg_sleep(0.12);
    end if;

    -- Les collaborations du catalogue : avec qui sort-il ?
    if v_val is null and a.instagram_handle is not null then
      with liens as (
        select f ->> 'handle' as h from public.submissions s, jsonb_array_elements(s.featuring) f
         where s.artist_handle = a.instagram_handle
        union all
        select s.artist_handle from public.submissions s
         where s.featuring @> jsonb_build_array(jsonb_build_object('handle', a.instagram_handle))
      )
      select count(*) filter (where x.francophone is true), count(*) filter (where x.francophone is false)
        into v_oui, v_non
        from liens l join public.artists x on x.instagram_handle = l.h;
      if v_non > v_oui then v_val := false; v_src := 'collaborations';
      elsif v_oui > v_non then v_val := true; v_src := 'collaborations';
      end if;
    end if;

    update public.artists
       set francophone = v_val, langue_source = coalesce(v_src, langue_source), langue_le = now()
     where id = a.id;

    v_faits := v_faits + 1;
    if v_val is not null then v_tranches := v_tranches + 1; end if;
  end loop;

  return jsonb_build_object('faits', v_faits, 'tranches', v_tranches,
    'restants', (select count(*) from public.artists where francophone is null and deezer_artist_id is not null
                   and (langue_le is null or langue_le < now() - interval '14 days')));
end $$;


-- L'équipe : la liste des artistes masqués, et la correction à la main (qu'aucun tri automatique ne défait).
create or replace function public.langue_equipe_liste(p_q text default null, p_page integer default 1)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_q text := nullif(btrim(coalesce(p_q, '')), ''); v_page integer := greatest(coalesce(p_page, 1), 1);
  v_taille constant integer := 40; v_total integer;
begin
  if not public.est_equipe() then raise exception 'Réservé à l''équipe.'; end if;

  select count(*) into v_total from public.artists a
   where a.francophone is false and not a.banni
     and (v_q is null or public.norme_artiste(a.display_name) like '%' || public.norme_artiste(v_q) || '%');

  return jsonb_build_object(
    'total', v_total, 'page', v_page, 'pages', greatest(1, ceil(v_total::numeric / v_taille)::integer),
    'artistes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', a.id, 'nom', coalesce(nullif(a.display_name, ''), a.instagram_handle), 'photo', a.photo_url,
               'fans', a.deezer_fans, 'source', a.langue_source, 'deezer_id', a.deezer_artist_id,
               'sorties', (select count(*) from public.submissions s where s.artist_handle = a.instagram_handle and s.status = 'approved'))
             order by a.deezer_fans desc nulls last, a.display_name)
        from (select * from public.artists a
               where a.francophone is false and not a.banni
                 and (v_q is null or public.norme_artiste(a.display_name) like '%' || public.norme_artiste(v_q) || '%')
               order by a.deezer_fans desc nulls last, a.display_name
               limit v_taille offset (v_page - 1) * v_taille) a), '[]'::jsonb));
end $$;

create or replace function public.langue_equipe_regler(p_artist uuid, p_francophone boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_handle text; v_nom text;
begin
  if not public.est_equipe() then raise exception 'Réservé à l''équipe.'; end if;
  if p_francophone is null then raise exception 'Choisis oui ou non.'; end if;

  update public.artists
     set francophone = p_francophone, langue_source = 'equipe', langue_le = now(), updated_at = now()
   where id = p_artist
  returning instagram_handle, coalesce(nullif(display_name, ''), instagram_handle) into v_handle, v_nom;
  if v_handle is null then raise exception 'Artiste introuvable.'; end if;

  perform public.jeu_cartes_rafraichir();

  return jsonb_build_object('nom', v_nom, 'francophone', p_francophone,
    'sorties', (select count(*) from public.submissions s where s.artist_handle = v_handle and s.status = 'approved'));
end $$;


-- ---------------------------------------------------------------------
-- 2. Le jeu : des cartes d'artistes
-- ---------------------------------------------------------------------

-- On repart de zéro : les cartes étaient des sorties, ce sont maintenant des artistes.
drop function if exists public.jeu_discodex(integer, text, text, text);
drop function if exists public.jeu_artiste(text);
drop function if exists public.jeu_collection_lire(integer, text, integer, boolean, text);
drop function if exists public.jeu_recycler(uuid, boolean, integer);
drop function if exists public.jeu_atelier(uuid);
drop function if exists public.jeu_carte_json(public.jeu_cartes, boolean, integer);
drop table if exists public.jeu_collection;
drop table if exists public.jeu_cartes;

delete from public.jeu_reclamations;
delete from public.jeu_roue_log;
delete from public.jeu_jour;
delete from public.jeu_joueurs;
delete from public.jeu_succes_def where famille = 'artistes';

create table public.jeu_cartes (
  artist_id uuid primary key references public.artists(id) on delete cascade,
  numero    integer not null unique,                              -- donné une fois pour toutes
  rarete    smallint not null check (rarete between 1 and 5),     -- 1 commun … 5 mythique
  fans      bigint not null default 0,
  nom       text not null,
  handle    text not null,
  photo     text not null,
  ville     text,
  sorties   integer not null default 0,
  derniere  jsonb,                                                -- { titre, cover, numero, date }
  active    boolean not null default true                         -- une carte retirée reste dans les collections
);

create index jeu_cartes_tirage_idx on public.jeu_cartes (rarete) where active;

create table public.jeu_collection (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  artist_id   uuid not null references public.jeu_cartes(artist_id) on delete cascade,
  holo        boolean not null default false,
  quantite    integer not null default 1 check (quantite >= 0),
  premiere_le timestamptz not null default now(),
  primary key (user_id, artist_id, holo)
);

create index jeu_collection_user_idx on public.jeu_collection (user_id, premiere_le desc);

alter table public.jeu_cartes     enable row level security;
alter table public.jeu_collection enable row level security;
revoke all on table public.jeu_cartes, public.jeu_collection from public, anon, authenticated;

-- Les cartes : les artistes francophones qui ont au moins une sortie publiée, une vraie photo, et au moins 1 000 fans
-- (la liste de l'équipe n'a pas ce seuil). La rareté suit les fans parmi ces artistes : les 1 % du haut sont
-- Mythiques, les 4 % suivants Légendaires, les 10 % suivants Épiques, les 25 % suivants Rares, le reste Commun.
create or replace function public.jeu_cartes_rafraichir()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_n integer; v_max integer;
begin
  if not pg_try_advisory_xact_lock(hashtext('jeu_cartes_rafraichir')) then return 0; end if;

  create temporary table if not exists jeu_cartes_base (
    artist_id uuid primary key, rarete smallint, fans bigint, nom text, handle text, photo text, ville text, sorties integer, derniere jsonb
  ) on commit drop;
  truncate jeu_cartes_base;

  insert into jeu_cartes_base
  with so as (
    select s.artist_handle, count(*)::integer as n,
           (array_agg(jsonb_build_object('titre', s.track_title, 'cover', s.cover_url, 'numero', s.catalog_number, 'date', s.release_date)
                      order by s.release_date desc, s.created_at desc))[1] as derniere
      from public.submissions s
     where s.status = 'approved' and not s.banni and not s.hors_langue
       and s.release_date is not null and s.release_date <= public.xp_jour()
     group by s.artist_handle
  ), base as (
    select a.id, coalesce(nullif(btrim(a.display_name), ''), a.instagram_handle) as nom, a.instagram_handle as handle,
           a.photo_url as photo, a.ville, coalesce(a.deezer_fans, 0) as fans, so.n, so.derniere
      from public.artists a
      join so on so.artist_handle = a.instagram_handle
     where not a.banni and a.francophone is true
       and a.photo_url ~ '^https://' and a.photo_url not like '%d41d8cd98f00b204e9800998ecf8427e%'
       and (coalesce(a.deezer_fans, 0) >= 1000 or a.source is null or a.source = 'liste-rappeurs')
  ), rang as (
    select b.*, percent_rank() over (order by b.fans) as pr from base b
  )
  select id, case when pr >= .99 then 5 when pr >= .95 then 4 when pr >= .85 then 3 when pr >= .60 then 2 else 1 end,
         fans, nom, handle, photo, ville, n, derniere
    from rang;

  update public.jeu_cartes c
     set rarete = b.rarete, fans = b.fans, nom = b.nom, handle = b.handle, photo = b.photo, ville = b.ville,
         sorties = b.sorties, derniere = b.derniere, active = true
    from jeu_cartes_base b
   where b.artist_id = c.artist_id;

  select coalesce(max(numero), 0) into v_max from public.jeu_cartes;

  insert into public.jeu_cartes (artist_id, numero, rarete, fans, nom, handle, photo, ville, sorties, derniere)
  select b.artist_id, v_max + row_number() over (order by b.fans desc, b.nom), b.rarete, b.fans, b.nom, b.handle, b.photo,
         b.ville, b.sorties, b.derniere
    from jeu_cartes_base b
   where not exists (select 1 from public.jeu_cartes c where c.artist_id = b.artist_id);

  update public.jeu_cartes c set active = false
   where c.active and not exists (select 1 from jeu_cartes_base b where b.artist_id = c.artist_id);

  select count(*) into v_n from public.jeu_cartes where active;
  return v_n;
end $$;

create or replace function public.jeu_carte_json(c public.jeu_cartes, p_holo boolean, p_quantite integer)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'id', c.artist_id, 'numero', c.numero, 'rarete', c.rarete, 'fans', c.fans, 'nom', c.nom, 'handle', c.handle,
    'photo', c.photo, 'ville', c.ville, 'sorties', c.sorties, 'derniere', c.derniere, 'holo', p_holo, 'quantite', p_quantite)
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
    'uniques', (select count(distinct col.artist_id) from public.jeu_collection col join public.jeu_cartes c on c.artist_id = col.artist_id
                 where col.user_id = p_user and col.quantite > 0 and c.active),
    'doublons', (select coalesce(sum(greatest(col.quantite - 1, 0)), 0) from public.jeu_collection col where col.user_id = p_user),
    'total_cartes', (select count(*) from public.jeu_cartes where active));
end $$;

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
  v_nb_rare integer := 0; v_nb_epique integer := 0; v_nb_holo integer := 0; v_xp integer := 0;
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

    select * into c from public.jeu_cartes where active and rarete = v_tier order by random() limit 1;
    if not found then
      select * into c from public.jeu_cartes where active and rarete <= v_tier order by rarete desc, random() limit 1;
    end if;
    if not found then raise exception 'Aucune carte disponible pour le moment.'; end if;

    v_holo := random() < v_holo_p;
    v_nouvelle := not exists (select 1 from public.jeu_collection where user_id = v_uid and artist_id = c.artist_id);
    v_nv_holo := v_holo and not exists (select 1 from public.jeu_collection where user_id = v_uid and artist_id = c.artist_id and holo);

    insert into public.jeu_collection (user_id, artist_id, holo, quantite) values (v_uid, c.artist_id, v_holo, 1)
    on conflict (user_id, artist_id, holo) do update set quantite = public.jeu_collection.quantite + 1
    returning quantite into v_qte;

    if c.rarete >= 2 then v_rare_plus := true; v_nb_rare := v_nb_rare + 1; end if;
    if c.rarete >= 3 then v_nb_epique := v_nb_epique + 1; end if;
    if v_holo then v_nb_holo := v_nb_holo + 1; end if;

    v_xp := v_xp + 1 + case c.rarete when 3 then 3 when 4 then 10 when 5 then 40 else 0 end + case when v_holo then 20 else 0 end;

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

-- La collection : toutes les cartes du jeu, avec ce qu'on en possède. Vues : toutes, possedees, manquantes, doublons,
-- holos. Tris : numero, rarete, fans, nom, recent (les dernières obtenues).
create or replace function public.jeu_collection_lire(
  p_page integer default 1, p_vue text default 'toutes', p_rarete integer default null, p_q text default null, p_tri text default 'numero')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid(); v_taille constant integer := 60; v_total integer; v_liste jsonb;
  v_q text := nullif(public.norme_artiste(p_q), ''); v_page integer := greatest(coalesce(p_page, 1), 1);
begin
  if v_uid is null then return null; end if;

  with possede as (
    select artist_id,
           coalesce(sum(quantite) filter (where not holo), 0)::integer as normales,
           coalesce(sum(quantite) filter (where holo), 0)::integer as holos,
           min(premiere_le) as premiere_le
      from public.jeu_collection where user_id = v_uid and quantite > 0 group by artist_id
  ), cartes as (
    select c, coalesce(p.normales, 0) as normales, coalesce(p.holos, 0) as holos, p.premiere_le
      from public.jeu_cartes c left join possede p on p.artist_id = c.artist_id
     where c.active
       and (p_rarete is null or c.rarete = p_rarete)
       and (v_q is null or public.norme_artiste(c.nom) like '%' || v_q || '%')
  ), filtre as (
    select * from cartes x
     where case coalesce(p_vue, 'toutes')
             when 'possedees'  then x.normales + x.holos > 0
             when 'manquantes' then x.normales + x.holos = 0
             when 'doublons'   then x.normales > 1 or x.holos > 1
             when 'holos'      then x.holos > 0
             else true end
  ), page as (
    select x.*, row_number() over (
             order by case when p_tri = 'rarete' then (x.c).rarete end desc nulls last,
                      case when p_tri = 'fans' then (x.c).fans end desc nulls last,
                      case when p_tri = 'nom' then lower((x.c).nom) end asc nulls last,
                      case when p_tri = 'recent' then x.premiere_le end desc nulls last,
                      (x.c).numero) as ord
      from filtre x
     order by ord
     limit v_taille offset (v_page - 1) * v_taille
  )
  select (select count(*) from filtre),
         coalesce((select jsonb_agg(public.jeu_carte_json(x.c, x.holos > 0, x.normales + x.holos)
                                    || jsonb_build_object('normales', x.normales, 'holos', x.holos) order by x.ord)
                     from page x), '[]'::jsonb)
    into v_total, v_liste;

  return jsonb_build_object(
    'total', v_total, 'page', v_page, 'pages', greatest(1, ceil(v_total::numeric / v_taille)::integer),
    'cartes', v_liste,
    'raretes', (select jsonb_agg(jsonb_build_object('rarete', r.rarete, 'total', r.total, 'possedees', r.possedees) order by r.rarete)
                  from (select c.rarete, count(*)::integer as total,
                               count(*) filter (where exists (select 1 from public.jeu_collection col
                                                               where col.user_id = v_uid and col.artist_id = c.artist_id and col.quantite > 0))::integer as possedees
                          from public.jeu_cartes c where c.active group by c.rarete) r),
    'doublons', (select coalesce(sum(greatest(col.quantite - 1, 0)), 0) from public.jeu_collection col where col.user_id = v_uid),
    'valeur_doublons', (select coalesce(sum(greatest(col.quantite - 1, 0) * public.jeu_valeur(c.rarete) * case when col.holo then 3 else 1 end), 0)
                          from public.jeu_collection col join public.jeu_cartes c on c.artist_id = col.artist_id where col.user_id = v_uid));
end $$;

-- Une carte en grand : ce qu'on en a, ses dernières sorties, ce qu'elle coûte et rapporte.
create or replace function public.jeu_carte(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid(); c public.jeu_cartes; v_n integer; v_h integer;
begin
  if v_uid is null then return null; end if;
  select * into c from public.jeu_cartes where artist_id = p_id;
  if not found then raise exception 'Carte introuvable.'; end if;

  select coalesce(sum(quantite) filter (where not holo), 0), coalesce(sum(quantite) filter (where holo), 0)
    into v_n, v_h from public.jeu_collection where user_id = v_uid and artist_id = p_id;

  return public.jeu_carte_json(c, v_h > 0, v_n + v_h) || jsonb_build_object(
    'normales', v_n, 'holos', v_h, 'valeur', public.jeu_valeur(c.rarete), 'cout', public.jeu_cout(c.rarete),
    'sorties_liste', coalesce((
      select jsonb_agg(jsonb_build_object('titre', s.track_title, 'cover', s.cover_url, 'numero', s.catalog_number,
                                          'date', s.release_date, 'type', s.release_type) order by s.release_date desc)
        from (select * from public.submissions s
               where s.artist_handle = c.handle and s.status = 'approved' and not s.banni and not s.hors_langue
                 and s.release_date <= public.xp_jour() and coalesce(s.cover_url, '') <> ''
               order by s.release_date desc limit 6) s), '[]'::jsonb));
end $$;

create or replace function public.jeu_recycler(p_artist uuid, p_holo boolean, p_quantite integer)
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
  select * into col from public.jeu_collection where user_id = v_uid and artist_id = p_artist and holo = coalesce(p_holo, false) for update;
  if not found then raise exception 'Tu n''as pas cette carte.'; end if;
  if col.quantite - p_quantite < 1 then raise exception 'Il faut en garder au moins un exemplaire.'; end if;

  select * into c from public.jeu_cartes where artist_id = p_artist;
  v_gain := p_quantite * public.jeu_valeur(c.rarete) * case when col.holo then 3 else 1 end;

  update public.jeu_collection set quantite = quantite - p_quantite where user_id = v_uid and artist_id = p_artist and holo = col.holo;
  update public.jeu_joueurs set vinyles = vinyles + v_gain, recycles = recycles + p_quantite where user_id = v_uid;

  insert into public.jeu_jour (user_id, jour, recycles) values (v_uid, public.xp_jour(), p_quantite)
  on conflict (user_id, jour) do update set recycles = public.jeu_jour.recycles + excluded.recycles;

  return jsonb_build_object('vinyles', v_gain, 'etat', public.jeu_etat_json(v_uid));
end $$;

-- Tous les doublons d'un coup : on garde un exemplaire de chaque carte (et de chaque holo).
create or replace function public.jeu_recycler_tout()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid(); v_gain integer; v_nb integer;
begin
  if v_uid is null then raise exception 'Connecte-toi.'; end if;
  perform public.jeu_joueur_assurer(v_uid);
  perform 1 from public.jeu_joueurs where user_id = v_uid for update;

  select coalesce(sum((col.quantite - 1) * public.jeu_valeur(c.rarete) * case when col.holo then 3 else 1 end), 0),
         coalesce(sum(col.quantite - 1), 0)
    into v_gain, v_nb
    from public.jeu_collection col join public.jeu_cartes c on c.artist_id = col.artist_id
   where col.user_id = v_uid and col.quantite > 1;

  if v_nb = 0 then raise exception 'Aucun doublon à recycler.'; end if;

  update public.jeu_collection set quantite = 1 where user_id = v_uid and quantite > 1;
  update public.jeu_joueurs set vinyles = vinyles + v_gain, recycles = recycles + v_nb where user_id = v_uid;

  insert into public.jeu_jour (user_id, jour, recycles) values (v_uid, public.xp_jour(), v_nb)
  on conflict (user_id, jour) do update set recycles = public.jeu_jour.recycles + excluded.recycles;

  return jsonb_build_object('vinyles', v_gain, 'cartes', v_nb, 'etat', public.jeu_etat_json(v_uid));
end $$;

create or replace function public.jeu_atelier(p_artist uuid)
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
  select * into c from public.jeu_cartes where artist_id = p_artist and active;
  if not found then raise exception 'Carte introuvable.'; end if;

  v_cout := public.jeu_cout(c.rarete);
  if j.vinyles < v_cout then raise exception 'Il te manque % vinyles.', v_cout - j.vinyles; end if;

  insert into public.jeu_collection (user_id, artist_id, holo, quantite) values (v_uid, p_artist, false, 1)
  on conflict (user_id, artist_id, holo) do update set quantite = public.jeu_collection.quantite + 1
  returning quantite into v_qte;

  update public.jeu_joueurs set vinyles = vinyles - v_cout, ateliers = ateliers + 1 where user_id = v_uid;

  insert into public.jeu_jour (user_id, jour, ateliers) values (v_uid, public.xp_jour(), 1)
  on conflict (user_id, jour) do update set ateliers = public.jeu_jour.ateliers + 1;

  return jsonb_build_object('carte', public.jeu_carte_json(c, false, v_qte), 'cout', v_cout, 'etat', public.jeu_etat_json(v_uid));
end $$;

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
    'legendaires', coalesce(c.legendaires, 0), 'mythiques', coalesce(c.mythiques, 0))
  from (select 1) base
  left join public.jeu_joueurs j on j.user_id = p_user
  left join lateral (
    select count(*)::integer as uniques,
           count(*) filter (where k.rarete >= 2)::integer as rares, count(*) filter (where k.rarete >= 3)::integer as epiques,
           count(*) filter (where k.rarete >= 4)::integer as legendaires, count(*) filter (where k.rarete >= 5)::integer as mythiques
      from (select distinct artist_id from public.jeu_collection where user_id = p_user and quantite > 0) o
      join public.jeu_cartes k on k.artist_id = o.artist_id
  ) c on true
$$;

update public.jeu_succes_def set description = replace(description, 'cartes différentes', 'artistes différents')
 where famille = 'uniques';


-- ---------------------------------------------------------------------
-- 3. Le premier tri (Wikidata + artistes similaires Deezer, calculé à part) — inséré à la génération
-- ---------------------------------------------------------------------

update public.artists set francophone = true, langue_source = 'liste', langue_le = now()
 where (source is null or source = 'liste-rappeurs') and francophone is distinct from true;

-- Le tri a été calculé à part (Wikidata + 20 artistes similaires Deezer par artiste + collaborations du catalogue),
-- sur un instantané du 2026-10-21 23:53 UTC. Ses résultats sont dans sql/donnees/langue-tri.json, lu ici à la
-- version exacte du dépôt : « faux » = non francophones, « inconnus » = sans réponse (laissés à langue_classer).
-- Tous les autres artistes présents lors du tri sont francophones.
do $$
declare v_rep extensions.http_response; v jsonb;
begin
  v_rep := extensions.http_get('https://raw.githubusercontent.com/remylcq/lawave-site/65283d7d0f804c8fde1ec8d6d5ac9992d9436a02/sql/donnees/langue-tri.json');
  if v_rep.status <> 200 then raise exception 'Données du tri introuvables (HTTP %).', v_rep.status; end if;
  v := v_rep.content::jsonb;

  update public.artists set francophone = false, langue_source = 'tri-auto', langue_le = now()
   where francophone is null and source is distinct from 'liste-rappeurs' and source is not null
     and deezer_artist_id = any(array(select jsonb_array_elements_text(v -> 'faux')::bigint));

  update public.artists set francophone = true, langue_source = 'tri-auto', langue_le = now()
   where francophone is null and created_at <= timestamptz '2026-10-21 23:53:03+00'
     and not (deezer_artist_id = any(array(select jsonb_array_elements_text(v -> 'faux')::bigint
                                            union all select jsonb_array_elements_text(v -> 'inconnus')::bigint)));
end $$;


-- ---------------------------------------------------------------------
-- 4. Droits et tâches planifiées
-- ---------------------------------------------------------------------

revoke all on function public.submissions_langue()                         from public, anon, authenticated;
revoke all on function public.artists_langue_propager()                    from public, anon, authenticated;
revoke all on function public.langue_appliquer()                           from public, anon, authenticated;
revoke all on function public.langue_classer(integer)                      from public, anon, authenticated;
revoke all on function public.jeu_cartes_rafraichir()                      from public, anon, authenticated;
revoke all on function public.jeu_etat_json(uuid)                          from public, anon, authenticated;
revoke all on function public.jeu_metriques(uuid)                          from public, anon, authenticated;

revoke all on function public.langue_equipe_liste(text, integer)           from public, anon;
revoke all on function public.langue_equipe_regler(uuid, boolean)          from public, anon;
revoke all on function public.jeu_ouvrir(integer, boolean)                 from public, anon;
revoke all on function public.jeu_collection_lire(integer, text, integer, text, text) from public, anon;
revoke all on function public.jeu_carte(uuid)                              from public, anon;
revoke all on function public.jeu_recycler(uuid, boolean, integer)         from public, anon;
revoke all on function public.jeu_recycler_tout()                          from public, anon;
revoke all on function public.jeu_atelier(uuid)                            from public, anon;

grant execute on function public.langue_equipe_liste(text, integer)        to authenticated;
grant execute on function public.langue_equipe_regler(uuid, boolean)       to authenticated;
grant execute on function public.jeu_ouvrir(integer, boolean)              to authenticated;
grant execute on function public.jeu_collection_lire(integer, text, integer, text, text) to authenticated;
grant execute on function public.jeu_carte(uuid)                           to authenticated;
grant execute on function public.jeu_recycler(uuid, boolean, integer)      to authenticated;
grant execute on function public.jeu_recycler_tout()                       to authenticated;
grant execute on function public.jeu_atelier(uuid)                         to authenticated;

select public.langue_appliquer();
select public.jeu_cartes_rafraichir();

select cron.schedule('langue-artistes', '*/10 * * * *', 'select public.langue_classer(25)');
