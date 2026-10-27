-- Wave Cards : le marché entre joueurs (demande de Rémy, 2026-10-27).
-- Les joueurs mettent en vente leurs cartes de classeur (une carte = une annonce) et achètent celles des autres, en vinyles.
--
--  Séquestre      mettre en vente retire la carte de jeu_collection_b ; annuler, expirer ou retrait par l'équipe la rend.
--  Achat          atomique : vinyles de l'acheteur -> vendeur moins la commission (détruite), carte à l'acheteur.
--  Garde-fous     bornes de prix par rareté (holo : maximum x3), plafond d'annonces, expiration, suspension d'un joueur.
--  Journal        marche_journal : mises en vente, ventes, annulations, expirations, retraits. Jamais supprimé.
--  Ordre des verrous (contre les blocages) : annonce, puis lignes jeu_joueurs (par user_id), puis jeu_collection_b.
-- Toutes les tables ont la RLS sans politique : tout passe par les fonctions ci-dessous.

-- ---------------------------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------------------------

create table if not exists public.marche_reglages (
  id integer primary key default 1 check (id = 1),
  commission_pct numeric(5, 2) not null default 5 check (commission_pct >= 0 and commission_pct <= 50),
  duree_jours integer not null default 7 check (duree_jours between 1 and 60),
  max_annonces integer not null default 10 check (max_annonces between 1 and 100),
  maj_le timestamptz not null default now()
);
insert into public.marche_reglages (id) values (1) on conflict (id) do nothing;

create table if not exists public.marche_bornes (
  rarete smallint primary key check (rarete between 1 and 5),
  prix_min integer not null check (prix_min >= 1),
  prix_max integer not null,
  check (prix_max >= prix_min)
);
insert into public.marche_bornes (rarete, prix_min, prix_max) values (1, 1, 20), (2, 1, 50), (3, 2, 150), (4, 4, 500), (5, 10, 2000)
on conflict (rarete) do nothing;

create table if not exists public.marche_annonces (
  id bigint generated always as identity primary key,
  vendeur uuid not null references public.profiles (id) on delete cascade,
  booster_id text not null references public.jeu_boosters (id) on delete restrict,
  artist_id uuid not null,
  holo boolean not null default false,
  rarete smallint not null,
  prix integer not null check (prix >= 1),
  etat text not null default 'active' check (etat in ('active', 'vendue', 'annulee', 'expiree', 'retiree')),
  cree_le timestamptz not null default now(),
  expire_le timestamptz not null,
  ferme_le timestamptz,
  acheteur uuid
);
create index if not exists marche_annonces_etat_idx on public.marche_annonces (etat, expire_le);
create index if not exists marche_annonces_carte_idx on public.marche_annonces (booster_id, artist_id, holo) where etat = 'active';
create index if not exists marche_annonces_vendeur_idx on public.marche_annonces (vendeur, etat);

create table if not exists public.marche_journal (
  id bigint generated always as identity primary key,
  type text not null check (type in ('mise_en_vente', 'vente', 'annulation', 'expiration', 'retrait_equipe')),
  annonce_id bigint,
  booster_id text not null,
  artist_id uuid not null,
  holo boolean not null default false,
  rarete smallint,
  vendeur uuid,
  acheteur uuid,
  prix integer,
  commission integer,
  note text,
  cree_le timestamptz not null default now()
);
create index if not exists marche_journal_carte_idx on public.marche_journal (type, booster_id, artist_id, holo, cree_le desc);
create index if not exists marche_journal_vendeur_idx on public.marche_journal (vendeur, cree_le desc);
create index if not exists marche_journal_acheteur_idx on public.marche_journal (acheteur, cree_le desc);
create index if not exists marche_journal_date_idx on public.marche_journal (cree_le desc);

create table if not exists public.marche_suspendus (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  motif text,
  par uuid,
  cree_le timestamptz not null default now()
);

alter table public.marche_reglages enable row level security;
alter table public.marche_bornes enable row level security;
alter table public.marche_annonces enable row level security;
alter table public.marche_journal enable row level security;
alter table public.marche_suspendus enable row level security;

-- ---------------------------------------------------------------------------------------------------------------
-- Aides internes (jamais appelables par le site)
-- ---------------------------------------------------------------------------------------------------------------

-- La carte d'une annonce, au format du jeu.
create or replace function public.marche_carte_json(p_booster text, p_artist uuid, p_holo boolean, p_rarete smallint default null)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select public.jeu_carte_json_b(c, p_booster, coalesce(bc.rarete, p_rarete, c.rarete)::integer, coalesce(bc.numero, 0), p_holo, 1)
    from public.jeu_cartes c
    left join public.jeu_booster_cartes bc on bc.booster_id = p_booster and bc.artist_id = c.artist_id
   where c.artist_id = p_artist
$$;

-- Les repères de prix d'une carte : plancher actuel, médiane des ventes sur 30 jours, dernière vente.
create or replace function public.marche_indice_carte(p_booster text, p_artist uuid, p_holo boolean)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'plancher', (select min(a.prix) from public.marche_annonces a
                  where a.etat = 'active' and a.expire_le > now() and a.booster_id = p_booster and a.artist_id = p_artist and a.holo = p_holo),
    'actives', (select count(*) from public.marche_annonces a
                 where a.etat = 'active' and a.expire_le > now() and a.booster_id = p_booster and a.artist_id = p_artist and a.holo = p_holo),
    'mediane', (select round(percentile_cont(0.5) within group (order by j.prix))::integer from public.marche_journal j
                 where j.type = 'vente' and j.booster_id = p_booster and j.artist_id = p_artist and j.holo = p_holo and j.cree_le > now() - interval '30 days'),
    'derniere', (select j.prix from public.marche_journal j
                  where j.type = 'vente' and j.booster_id = p_booster and j.artist_id = p_artist and j.holo = p_holo order by j.cree_le desc limit 1),
    'ventes_30j', (select count(*) from public.marche_journal j
                    where j.type = 'vente' and j.booster_id = p_booster and j.artist_id = p_artist and j.holo = p_holo and j.cree_le > now() - interval '30 days'))
$$;

-- Rend la carte d'une annonce à son vendeur (annulation, expiration, retrait).
create or replace function public.marche_rendre(a public.marche_annonces)
returns void language sql security definer set search_path to 'public' as $$
  insert into public.jeu_collection_b (user_id, booster_id, artist_id, holo, quantite)
  values (a.vendeur, a.booster_id, a.artist_id, a.holo, 1)
  on conflict (user_id, booster_id, artist_id, holo) do update set quantite = public.jeu_collection_b.quantite + 1
$$;

-- Ferme les annonces arrivées au bout de leur durée (rend les cartes). Appelée par les fonctions du marché et par pg_cron.
create or replace function public.marche_expirer()
returns integer language plpgsql security definer set search_path to 'public' as $$
declare a public.marche_annonces; n integer := 0;
begin
  for a in select * from public.marche_annonces where etat = 'active' and expire_le <= now() order by id for update skip locked loop
    perform public.marche_rendre(a);
    update public.marche_annonces set etat = 'expiree', ferme_le = now() where id = a.id;
    insert into public.marche_journal (type, annonce_id, booster_id, artist_id, holo, rarete, vendeur, prix)
    values ('expiration', a.id, a.booster_id, a.artist_id, a.holo, a.rarete, a.vendeur, a.prix);
    n := n + 1;
  end loop;
  return n;
end $$;

revoke all on function public.marche_carte_json(text, uuid, boolean, smallint) from public, anon, authenticated;
revoke all on function public.marche_indice_carte(text, uuid, boolean) from public, anon, authenticated;
revoke all on function public.marche_rendre(public.marche_annonces) from public, anon, authenticated;
revoke all on function public.marche_expirer() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- Fonctions des joueurs
-- ---------------------------------------------------------------------------------------------------------------

-- Les règles du marché, pour l'écran de mise en vente.
create or replace function public.marche_reglages_lire()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); c public.marche_reglages;
begin
  if v_uid is null then return null; end if;
  select * into c from public.marche_reglages where id = 1;
  return jsonb_build_object(
    'commission_pct', c.commission_pct, 'duree_jours', c.duree_jours, 'max_annonces', c.max_annonces,
    'suspendu', exists (select 1 from public.marche_suspendus where user_id = v_uid),
    'bornes', (select jsonb_agg(jsonb_build_object('rarete', b.rarete, 'prix_min', b.prix_min, 'prix_max', b.prix_max) order by b.rarete) from public.marche_bornes b));
end $$;

-- Mettre une carte en vente : elle quitte la collection et attend un acheteur.
create or replace function public.marche_mettre_en_vente(p_booster text, p_artist uuid, p_holo boolean, p_prix integer)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid(); v_holo boolean := coalesce(p_holo, false);
  v_cfg public.marche_reglages; v_bc public.jeu_booster_cartes; v_b public.marche_bornes;
  v_max integer; v_qte integer; v_nb integer; v_id bigint; v_noms text[] := array['Commune', 'Rare', 'Épique', 'Légendaire', 'Mythique'];
begin
  if v_uid is null then raise exception 'Connecte-toi.'; end if;
  perform public.jeu_joueur_assurer(v_uid);
  if exists (select 1 from public.marche_suspendus where user_id = v_uid) then raise exception 'Tu es suspendu du marché.'; end if;
  perform public.marche_expirer();

  select * into v_cfg from public.marche_reglages where id = 1;
  select * into v_bc from public.jeu_booster_cartes where booster_id = p_booster and artist_id = p_artist;
  if not found then raise exception 'Carte introuvable.'; end if;
  select * into v_b from public.marche_bornes where rarete = v_bc.rarete;
  v_max := case when v_holo then v_b.prix_max * 3 else v_b.prix_max end;
  if p_prix is null or p_prix < v_b.prix_min or p_prix > v_max then
    raise exception 'Une carte % se vend entre % et % vinyles.', lower(v_noms[v_bc.rarete]) || case when v_holo then ' holo' else '' end, v_b.prix_min, v_max;
  end if;

  -- Les verrous dans l'ordre : le joueur, puis sa ligne de collection.
  perform 1 from public.jeu_joueurs where user_id = v_uid for update;
  select quantite into v_qte from public.jeu_collection_b
   where user_id = v_uid and booster_id = p_booster and artist_id = p_artist and holo = v_holo for update;
  if v_qte is null or v_qte < 1 then raise exception 'Tu ne possèdes pas cette carte.'; end if;

  select count(*) into v_nb from public.marche_annonces where vendeur = v_uid and etat = 'active';
  if v_nb >= v_cfg.max_annonces then raise exception 'Tu as déjà % annonces en cours, le maximum.', v_nb; end if;

  update public.jeu_collection_b set quantite = quantite - 1
   where user_id = v_uid and booster_id = p_booster and artist_id = p_artist and holo = v_holo;

  insert into public.marche_annonces (vendeur, booster_id, artist_id, holo, rarete, prix, expire_le)
  values (v_uid, p_booster, p_artist, v_holo, v_bc.rarete, p_prix, now() + make_interval(days => v_cfg.duree_jours))
  returning id into v_id;

  insert into public.marche_journal (type, annonce_id, booster_id, artist_id, holo, rarete, vendeur, prix)
  values ('mise_en_vente', v_id, p_booster, p_artist, v_holo, v_bc.rarete, v_uid, p_prix);

  return jsonb_build_object('id', v_id, 'etat', public.jeu_etat_json(v_uid));
end $$;

-- Retirer sa propre annonce : la carte revient.
create or replace function public.marche_annuler(p_id bigint)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); a public.marche_annonces;
begin
  if v_uid is null then raise exception 'Connecte-toi.'; end if;
  select * into a from public.marche_annonces where id = p_id for update;
  if not found or a.vendeur <> v_uid then raise exception 'Annonce introuvable.'; end if;
  if a.etat <> 'active' then raise exception 'Cette annonce n''est plus en vente.'; end if;
  perform public.marche_rendre(a);
  update public.marche_annonces set etat = 'annulee', ferme_le = now() where id = a.id;
  insert into public.marche_journal (type, annonce_id, booster_id, artist_id, holo, rarete, vendeur, prix)
  values ('annulation', a.id, a.booster_id, a.artist_id, a.holo, a.rarete, a.vendeur, a.prix);
  return jsonb_build_object('etat', public.jeu_etat_json(v_uid));
end $$;

-- Acheter une annonce : tout ou rien.
create or replace function public.marche_acheter(p_id bigint)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid(); a public.marche_annonces; v_cfg public.marche_reglages;
  v_solde integer; v_com integer; v_net integer;
begin
  if v_uid is null then raise exception 'Connecte-toi.'; end if;
  perform public.jeu_joueur_assurer(v_uid);
  if exists (select 1 from public.marche_suspendus where user_id = v_uid) then raise exception 'Tu es suspendu du marché.'; end if;

  select * into a from public.marche_annonces where id = p_id for update;
  if not found or a.etat <> 'active' then raise exception 'Cette carte n''est plus en vente.'; end if;
  if a.expire_le <= now() then raise exception 'Cette annonce a expiré.'; end if;
  if a.vendeur = v_uid then raise exception 'Tu ne peux pas acheter ta propre annonce.'; end if;

  select * into v_cfg from public.marche_reglages where id = 1;
  perform 1 from public.jeu_joueurs where user_id in (v_uid, a.vendeur) order by user_id for update;
  select vinyles into v_solde from public.jeu_joueurs where user_id = v_uid;
  if v_solde is null or v_solde < a.prix then
    raise exception 'Il te manque % vinyles pour cette carte.', a.prix - coalesce(v_solde, 0);
  end if;

  v_com := round(a.prix * v_cfg.commission_pct / 100.0)::integer;
  v_net := a.prix - v_com;

  update public.jeu_joueurs set vinyles = vinyles - a.prix where user_id = v_uid;
  update public.jeu_joueurs set vinyles = vinyles + v_net where user_id = a.vendeur;

  insert into public.jeu_collection_b (user_id, booster_id, artist_id, holo, quantite)
  values (v_uid, a.booster_id, a.artist_id, a.holo, 1)
  on conflict (user_id, booster_id, artist_id, holo) do update set quantite = public.jeu_collection_b.quantite + 1;

  update public.marche_annonces set etat = 'vendue', acheteur = v_uid, ferme_le = now() where id = a.id;
  insert into public.marche_journal (type, annonce_id, booster_id, artist_id, holo, rarete, vendeur, acheteur, prix, commission)
  values ('vente', a.id, a.booster_id, a.artist_id, a.holo, a.rarete, a.vendeur, v_uid, a.prix, v_com);

  return jsonb_build_object('etat', public.jeu_etat_json(v_uid), 'prix', a.prix,
    'carte', public.marche_carte_json(a.booster_id, a.artist_id, a.holo, a.rarete));
end $$;

-- La vitrine : les annonces en cours, filtrées et triées, 24 par page.
create or replace function public.marche_lister(
  p_booster text default null, p_rarete integer default null, p_holo boolean default null,
  p_prix_min integer default null, p_prix_max integer default null, p_q text default null,
  p_manquantes boolean default false, p_tri text default 'recent', p_page integer default 1)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid(); v_taille constant integer := 24; v_page integer := greatest(coalesce(p_page, 1), 1);
  v_q text := nullif(public.norme_artiste(p_q), ''); v_tri text := coalesce(p_tri, 'recent'); v_total integer; v_liste jsonb;
begin
  if v_uid is null then return null; end if;
  if v_tri not in ('recent', 'prix_asc', 'prix_desc', 'rarete', 'fin') then v_tri := 'recent'; end if;
  perform public.marche_expirer();

  with base as (
    select a.*, c.nom, coalesce(bc.rarete, a.rarete)::integer as rar
      from public.marche_annonces a
      join public.jeu_cartes c on c.artist_id = a.artist_id
      left join public.jeu_booster_cartes bc on bc.booster_id = a.booster_id and bc.artist_id = a.artist_id
     where a.etat = 'active' and a.expire_le > now()
       and (p_booster is null or a.booster_id = p_booster)
       and (p_rarete is null or coalesce(bc.rarete, a.rarete) = p_rarete)
       and (p_holo is null or a.holo = p_holo)
       and (p_prix_min is null or a.prix >= p_prix_min)
       and (p_prix_max is null or a.prix <= p_prix_max)
       and (v_q is null or public.norme_artiste(c.nom) like '%' || v_q || '%')
       and (not coalesce(p_manquantes, false) or not exists (
              select 1 from public.jeu_collection_b m
               where m.user_id = v_uid and m.booster_id = a.booster_id and m.artist_id = a.artist_id and m.quantite > 0))
  ), page as (
    select b.*, row_number() over (
             order by case when v_tri = 'prix_asc' then b.prix end asc nulls last,
                      case when v_tri = 'prix_desc' then b.prix end desc nulls last,
                      case when v_tri = 'rarete' then b.rar end desc nulls last,
                      case when v_tri = 'fin' then b.expire_le end asc nulls last,
                      b.cree_le desc, b.id desc) as ord
      from base b
     order by ord
     limit v_taille offset (v_page - 1) * v_taille
  )
  select (select count(*) from base),
         coalesce((select jsonb_agg(jsonb_build_object(
             'id', x.id, 'prix', x.prix, 'moi', x.vendeur = v_uid,
             'vendeur', coalesce((select p.pseudo from public.profiles p where p.id = x.vendeur), 'Un joueur'),
             'cree_le', x.cree_le, 'expire_le', x.expire_le,
             'possede', coalesce((select sum(m.quantite) from public.jeu_collection_b m
                                   where m.user_id = v_uid and m.booster_id = x.booster_id and m.artist_id = x.artist_id), 0),
             'indice', public.marche_indice_carte(x.booster_id, x.artist_id, x.holo),
             'carte', public.marche_carte_json(x.booster_id, x.artist_id, x.holo, x.rarete)) order by x.ord) from page x), '[]'::jsonb)
    into v_total, v_liste;

  return jsonb_build_object('total', v_total, 'page', v_page, 'pages', greatest(1, ceil(v_total::numeric / v_taille)::integer), 'annonces', v_liste);
end $$;

-- Mes annonces : celles en cours, puis les fermées des 30 derniers jours.
create or replace function public.marche_mes_annonces()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return null; end if;
  perform public.marche_expirer();
  return jsonb_build_object('annonces', coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', a.id, 'prix', a.prix, 'etat', a.etat, 'cree_le', a.cree_le, 'expire_le', a.expire_le, 'ferme_le', a.ferme_le,
             'acheteur', (select p.pseudo from public.profiles p where p.id = a.acheteur),
             'indice', public.marche_indice_carte(a.booster_id, a.artist_id, a.holo),
             'carte', public.marche_carte_json(a.booster_id, a.artist_id, a.holo, a.rarete))
           order by (a.etat = 'active') desc, coalesce(a.ferme_le, a.cree_le) desc)
      from (select * from public.marche_annonces
             where vendeur = v_uid and (etat = 'active' or ferme_le > now() - interval '30 days')
             order by (etat = 'active') desc, coalesce(ferme_le, cree_le) desc limit 100) a), '[]'::jsonb));
end $$;

-- Mes ventes ou mes achats, 20 par page.
create or replace function public.marche_historique(p_sens text default 'ventes', p_page integer default 1)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid(); v_taille constant integer := 20; v_page integer := greatest(coalesce(p_page, 1), 1);
  v_vente boolean := coalesce(p_sens, 'ventes') <> 'achats'; v_total integer; v_liste jsonb;
begin
  if v_uid is null then return null; end if;
  select count(*) into v_total from public.marche_journal j
   where j.type = 'vente' and (case when v_vente then j.vendeur else j.acheteur end) = v_uid;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', x.id, 'prix', x.prix, 'commission', x.commission, 'net', x.prix - x.commission, 'cree_le', x.cree_le,
           'autre', coalesce((select p.pseudo from public.profiles p where p.id = case when v_vente then x.acheteur else x.vendeur end), 'Un joueur'),
           'carte', public.marche_carte_json(x.booster_id, x.artist_id, x.holo, x.rarete)) order by x.cree_le desc, x.id desc), '[]'::jsonb)
    into v_liste
    from (select * from public.marche_journal j
           where j.type = 'vente' and (case when v_vente then j.vendeur else j.acheteur end) = v_uid
           order by j.cree_le desc, j.id desc limit v_taille offset (v_page - 1) * v_taille) x;
  return jsonb_build_object('total', v_total, 'page', v_page, 'pages', greatest(1, ceil(v_total::numeric / v_taille)::integer),
                            'ventes', v_liste, 'sens', case when v_vente then 'ventes' else 'achats' end);
end $$;

-- Le prix conseillé d'une carte, pour l'écran de mise en vente.
create or replace function public.marche_indice(p_booster text, p_artist uuid, p_holo boolean default false)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); v_bc public.jeu_booster_cartes; v_b public.marche_bornes; v_holo boolean := coalesce(p_holo, false);
begin
  if v_uid is null then return null; end if;
  select * into v_bc from public.jeu_booster_cartes where booster_id = p_booster and artist_id = p_artist;
  if not found then raise exception 'Carte introuvable.'; end if;
  select * into v_b from public.marche_bornes where rarete = v_bc.rarete;
  return public.marche_indice_carte(p_booster, p_artist, v_holo) || jsonb_build_object(
    'rarete', v_bc.rarete, 'prix_min', v_b.prix_min, 'prix_max', case when v_holo then v_b.prix_max * 3 else v_b.prix_max end,
    'ventes', coalesce((select jsonb_agg(jsonb_build_object('prix', s.prix, 'le', s.cree_le) order by s.cree_le desc)
                          from (select j.prix, j.cree_le from public.marche_journal j
                                 where j.type = 'vente' and j.booster_id = p_booster and j.artist_id = p_artist and j.holo = v_holo
                                 order by j.cree_le desc limit 5) s), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Fonctions de l'équipe (toutes gardées par est_equipe())
-- ---------------------------------------------------------------------------------------------------------------

create or replace function public.marche_equipe_apercu()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.est_equipe() then raise exception 'Réservé à l''équipe.'; end if;
  perform public.marche_expirer();
  return jsonb_build_object(
    'actives', (select count(*) from public.marche_annonces where etat = 'active'),
    'valeur_actives', (select coalesce(sum(prix), 0) from public.marche_annonces where etat = 'active'),
    'jour', (select jsonb_build_object('ventes', count(*), 'vinyles', coalesce(sum(prix), 0), 'commission', coalesce(sum(commission), 0))
               from public.marche_journal where type = 'vente' and cree_le > now() - interval '24 hours'),
    'semaine', (select jsonb_build_object('ventes', count(*), 'vinyles', coalesce(sum(prix), 0), 'commission', coalesce(sum(commission), 0))
                  from public.marche_journal where type = 'vente' and cree_le > now() - interval '7 days'),
    'reglages', (select to_jsonb(r) - 'id' from public.marche_reglages r where r.id = 1),
    'bornes', (select jsonb_agg(jsonb_build_object('rarete', b.rarete, 'prix_min', b.prix_min, 'prix_max', b.prix_max) order by b.rarete) from public.marche_bornes b),
    'suspendus', coalesce((select jsonb_agg(jsonb_build_object('user_id', s.user_id, 'pseudo', coalesce(p.pseudo, '?'), 'motif', s.motif, 'cree_le', s.cree_le) order by s.cree_le desc)
                             from public.marche_suspendus s left join public.profiles p on p.id = s.user_id), '[]'::jsonb));
end $$;

create or replace function public.marche_equipe_annonces(p_q text default null, p_page integer default 1)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_taille constant integer := 25; v_page integer := greatest(coalesce(p_page, 1), 1); v_q text := nullif(public.norme_artiste(p_q), ''); v_total integer; v_liste jsonb;
begin
  if not public.est_equipe() then raise exception 'Réservé à l''équipe.'; end if;
  perform public.marche_expirer();
  with base as (
    select a.*, c.nom, p.pseudo
      from public.marche_annonces a
      join public.jeu_cartes c on c.artist_id = a.artist_id
      left join public.profiles p on p.id = a.vendeur
     where a.etat = 'active'
       and (v_q is null or public.norme_artiste(c.nom) like '%' || v_q || '%' or public.norme_artiste(coalesce(p.pseudo, '')) like '%' || v_q || '%')
  ), page as (select * from base order by cree_le desc, id desc limit v_taille offset (v_page - 1) * v_taille)
  select (select count(*) from base),
         coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'prix', x.prix, 'vendeur', coalesce(x.pseudo, '?'), 'cree_le', x.cree_le, 'expire_le', x.expire_le,
                                                       'carte', public.marche_carte_json(x.booster_id, x.artist_id, x.holo, x.rarete)) order by x.cree_le desc, x.id desc) from page x), '[]'::jsonb)
    into v_total, v_liste;
  return jsonb_build_object('total', v_total, 'page', v_page, 'pages', greatest(1, ceil(v_total::numeric / v_taille)::integer), 'annonces', v_liste);
end $$;

-- Retrait forcé : la carte retourne à son vendeur.
create or replace function public.marche_equipe_retirer(p_id bigint, p_motif text default null)
returns void language plpgsql security definer set search_path to 'public' as $$
declare a public.marche_annonces;
begin
  if not public.est_equipe() then raise exception 'Réservé à l''équipe.'; end if;
  select * into a from public.marche_annonces where id = p_id for update;
  if not found or a.etat <> 'active' then raise exception 'Cette annonce n''est plus en vente.'; end if;
  perform public.marche_rendre(a);
  update public.marche_annonces set etat = 'retiree', ferme_le = now() where id = a.id;
  insert into public.marche_journal (type, annonce_id, booster_id, artist_id, holo, rarete, vendeur, prix, note)
  values ('retrait_equipe', a.id, a.booster_id, a.artist_id, a.holo, a.rarete, a.vendeur, a.prix, left(p_motif, 300));
end $$;

create or replace function public.marche_equipe_journal(p_type text default null, p_q text default null, p_page integer default 1)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_taille constant integer := 30; v_page integer := greatest(coalesce(p_page, 1), 1); v_q text := nullif(public.norme_artiste(p_q), ''); v_total integer; v_liste jsonb;
begin
  if not public.est_equipe() then raise exception 'Réservé à l''équipe.'; end if;
  with base as (
    select j.*, c.nom, pv.pseudo as pseudo_vendeur, pa.pseudo as pseudo_acheteur
      from public.marche_journal j
      join public.jeu_cartes c on c.artist_id = j.artist_id
      left join public.profiles pv on pv.id = j.vendeur
      left join public.profiles pa on pa.id = j.acheteur
     where (p_type is null or j.type = p_type)
       and (v_q is null or public.norme_artiste(c.nom) like '%' || v_q || '%'
            or public.norme_artiste(coalesce(pv.pseudo, '')) like '%' || v_q || '%' or public.norme_artiste(coalesce(pa.pseudo, '')) like '%' || v_q || '%')
  ), page as (select * from base order by cree_le desc, id desc limit v_taille offset (v_page - 1) * v_taille)
  select (select count(*) from base),
         coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'type', x.type, 'nom', x.nom, 'holo', x.holo, 'rarete', x.rarete, 'prix', x.prix, 'commission', x.commission,
                                                       'vendeur', x.pseudo_vendeur, 'acheteur', x.pseudo_acheteur, 'note', x.note, 'cree_le', x.cree_le) order by x.cree_le desc, x.id desc) from page x), '[]'::jsonb)
    into v_total, v_liste;
  return jsonb_build_object('total', v_total, 'page', v_page, 'pages', greatest(1, ceil(v_total::numeric / v_taille)::integer), 'lignes', v_liste);
end $$;

create or replace function public.marche_equipe_regler(p_commission numeric, p_duree integer, p_max integer)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.est_equipe() then raise exception 'Réservé à l''équipe.'; end if;
  if p_commission is null or p_commission < 0 or p_commission > 50 then raise exception 'La commission va de 0 à 50 %%.'; end if;
  if p_duree is null or p_duree < 1 or p_duree > 60 then raise exception 'La durée va de 1 à 60 jours.'; end if;
  if p_max is null or p_max < 1 or p_max > 100 then raise exception 'Le plafond d''annonces va de 1 à 100.'; end if;
  update public.marche_reglages set commission_pct = p_commission, duree_jours = p_duree, max_annonces = p_max, maj_le = now() where id = 1;
end $$;

create or replace function public.marche_equipe_borne(p_rarete integer, p_min integer, p_max integer)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.est_equipe() then raise exception 'Réservé à l''équipe.'; end if;
  if p_rarete is null or p_rarete not between 1 and 5 then raise exception 'Rareté inconnue.'; end if;
  if p_min is null or p_min < 1 or p_max is null or p_max < p_min or p_max > 100000 then raise exception 'Bornes invalides : le minimum est d''au moins 1 vinyle et le maximum n''est pas en dessous.'; end if;
  update public.marche_bornes set prix_min = p_min, prix_max = p_max where rarete = p_rarete;
end $$;

-- Suspendre un joueur du marché : ses annonces en cours sont retirées et ses cartes lui reviennent.
create or replace function public.marche_equipe_suspendre(p_pseudo text, p_motif text default null)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_id uuid; a public.marche_annonces;
begin
  if not public.est_equipe() then raise exception 'Réservé à l''équipe.'; end if;
  select id into v_id from public.profiles where lower(pseudo) = lower(trim(p_pseudo)) limit 1;
  if v_id is null then raise exception 'Aucun joueur nommé « % ».', p_pseudo; end if;
  insert into public.marche_suspendus (user_id, motif, par) values (v_id, left(p_motif, 300), auth.uid())
  on conflict (user_id) do update set motif = excluded.motif, par = excluded.par, cree_le = now();
  for a in select * from public.marche_annonces where vendeur = v_id and etat = 'active' order by id for update loop
    perform public.marche_rendre(a);
    update public.marche_annonces set etat = 'retiree', ferme_le = now() where id = a.id;
    insert into public.marche_journal (type, annonce_id, booster_id, artist_id, holo, rarete, vendeur, prix, note)
    values ('retrait_equipe', a.id, a.booster_id, a.artist_id, a.holo, a.rarete, a.vendeur, a.prix, 'Suspension du marché');
  end loop;
end $$;

create or replace function public.marche_equipe_reintegrer(p_user uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.est_equipe() then raise exception 'Réservé à l''équipe.'; end if;
  delete from public.marche_suspendus where user_id = p_user;
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Droits
-- ---------------------------------------------------------------------------------------------------------------

do $$
declare f text;
begin
  foreach f in array array[
    'marche_reglages_lire()', 'marche_mettre_en_vente(text, uuid, boolean, integer)', 'marche_annuler(bigint)', 'marche_acheter(bigint)',
    'marche_lister(text, integer, boolean, integer, integer, text, boolean, text, integer)', 'marche_mes_annonces()', 'marche_historique(text, integer)',
    'marche_indice(text, uuid, boolean)', 'marche_equipe_apercu()', 'marche_equipe_annonces(text, integer)', 'marche_equipe_retirer(bigint, text)',
    'marche_equipe_journal(text, text, integer)', 'marche_equipe_regler(numeric, integer, integer)', 'marche_equipe_borne(integer, integer, integer)',
    'marche_equipe_suspendre(text, text)', 'marche_equipe_reintegrer(uuid)']
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- Les annonces arrivées à terme sont fermées toutes les 10 minutes (les fonctions du marché le font aussi à chaque appel).
select cron.unschedule('marche-expirer') where exists (select 1 from cron.job where jobname = 'marche-expirer');
select cron.schedule('marche-expirer', '*/10 * * * *', 'select public.marche_expirer()');
