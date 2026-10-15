-- =====================================================================
-- La Wave — les coffres deviennent des BOOSTERS, gérés par l'équipe
--
-- Retours de Rémy sur la boutique :
--   * « remplace les coffres par des boosters » (visuel du booster : une image, ici Menace Santana) ;
--   * « n'affiche pas Top 2026 et Saint-Valentin, c'était juste des idées » ;
--   * « en cliquant sur le booster on voit l'aperçu des cartes à l'intérieur, la Secret Wave reste floue » ;
--   * « uniquement 31 cartes dans la collection Halloween, et c'est à moi d'ajouter les cartes » :
--     un accès équipe pour composer les boosters et en créer d'autres ;
--   * « des pièces illimitées pour tester » : 1 000 000 WC pour Rémy (remis à zéro à l'ouverture du site).
--
-- Les noms techniques (coffre_acheter, coffre_ouvrir, coffres_possedes…) ne changent pas : seuls les mots
-- affichés changent.
--
-- À passer APRÈS sql/coffres-cartes.sql. Sans danger à rejouer.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Le visuel du booster, et le retrait des idées
-- ---------------------------------------------------------------------

alter table public.collections add column if not exists visuel_url text;
alter table public.collections add column if not exists actif boolean not null default true;

-- Retiré : ce n'étaient que des idées (aucune carte, aucun stock : rien d'autre ne dépend d'eux).
delete from public.collections where id in ('top_2026', 'saint_valentin');

update public.collections
   set nom = 'Booster Halloween',
       description = 'Fantômes, démons et cauchemars : des projets et des singles du catalogue qui font frissonner. Disponible jusqu''au 15 novembre.',
       visuel_url = 'https://cdn-images.dzcdn.net/images/cover/8f858faa88ce9deae5e6128ec60986e1/500x500-000000-80-0-0.jpg'
 where id = 'halloween' and (visuel_url is null);

update public.collections set nom = 'Booster Halloween' where id = 'halloween' and nom = 'Coffre Halloween';


-- ---------------------------------------------------------------------
-- 2. Halloween : 31 cartes (six retirées), renumérotées sans trou
-- ---------------------------------------------------------------------

delete from public.cartes
 where collection_id = 'halloween'
   and (artiste, titre) in (
     ('Davodka', 'Fantômes'), ('Dalienski', 'vrais fantômes'), ('Zeg P', 'Blood'),
     ('a6el', 'Fantôme'), ('Khali', 'PLM DEATHROW'), ('Jarod', 'Fantôme'));

create or replace function public.booster_renumeroter(p_collection text)
returns void language plpgsql security definer set search_path = public
as $$
begin
  -- Deux temps : la clé (collection, numéro) est unique, on ne peut pas décaler d'un coup sans collision.
  update public.cartes set numero = numero + 100000 where collection_id = p_collection;

  update public.cartes c set numero = r.n
    from (select id, row_number() over (order by numero) as n from public.cartes where collection_id = p_collection) r
   where c.id = r.id;
end $$;

select public.booster_renumeroter('halloween');


-- ---------------------------------------------------------------------
-- 3. Acheter et ouvrir : les messages parlent de boosters
-- ---------------------------------------------------------------------

create or replace function public.coffre_acheter(p_collection text, p_quantite integer default 1)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  c public.collections%rowtype;
  v_solde integer; v_cout integer; v_coffres integer;
begin
  if v_uid is null then raise exception 'Connecte-toi pour acheter un booster.'; end if;

  p_quantite := coalesce(p_quantite, 1);
  if p_quantite < 1 or p_quantite > 10 then raise exception 'Tu peux acheter de 1 à 10 boosters à la fois.'; end if;

  select * into c from public.collections where id = p_collection and actif;
  if not found then raise exception 'Ce booster n''existe pas.'; end if;

  if now() < c.debut then raise exception 'Ce booster n''est pas encore en vente.'; end if;
  if now() > c.fin then raise exception 'Ce booster n''est plus en vente.'; end if;
  if not exists (select 1 from public.cartes where collection_id = c.id) then
    raise exception 'Ce booster n''est pas encore rempli.';
  end if;

  insert into public.wc_portefeuille (user_id, solde) values (v_uid, 0) on conflict (user_id) do nothing;
  select solde into v_solde from public.wc_portefeuille where user_id = v_uid for update;

  v_cout := c.prix_wc * p_quantite;
  if v_solde < v_cout then
    raise exception 'Il te manque % WC pour ce booster.', v_cout - v_solde;
  end if;

  update public.wc_portefeuille set solde = solde - v_cout where user_id = v_uid;
  insert into public.wc_journal (user_id, delta, motif, ref) values (v_uid, -v_cout, 'achat:' || c.id, gen_random_uuid()::text);

  insert into public.coffres_possedes as cp (user_id, collection_id, quantite) values (v_uid, c.id, p_quantite)
  on conflict (user_id, collection_id) do update set quantite = cp.quantite + p_quantite
  returning cp.quantite into v_coffres;

  return jsonb_build_object('solde', v_solde - v_cout, 'coffres', v_coffres);
end $$;

create or replace function public.coffre_ouvrir(p_collection text)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  c public.collections%rowtype;
  v_restant integer; v_rarete text; v_carte public.cartes%rowtype; v_qte integer; v_nouvelle boolean;
  v_ids integer[] := '{}'; v_sortie jsonb := '[]'::jsonb; v_min integer; v_haut boolean := false; i integer;
begin
  if v_uid is null then raise exception 'Connecte-toi pour ouvrir un booster.'; end if;

  select * into c from public.collections where id = p_collection;
  if not found then raise exception 'Ce booster n''existe pas.'; end if;

  update public.coffres_possedes set quantite = quantite - 1
   where user_id = v_uid and collection_id = c.id and quantite > 0
  returning quantite into v_restant;

  if v_restant is null then raise exception 'Tu n''as aucun booster à ouvrir.'; end if;

  for i in 1..c.cartes_par_coffre loop

    v_min := case when i = c.cartes_par_coffre and not v_haut then 2 else 1 end;
    v_rarete := public.coffre_tirer_rarete(c.id, v_min);

    select * into v_carte from public.cartes where collection_id = c.id and rarete = v_rarete order by random() limit 1;

    if public.rarete_ordre(v_carte.rarete) >= 2 then v_haut := true; end if;

    insert into public.cartes_possedees as cp (user_id, carte_id, quantite) values (v_uid, v_carte.id, 1)
    on conflict (user_id, carte_id) do update set quantite = cp.quantite + 1
    returning cp.quantite into v_qte;

    v_nouvelle := v_qte = 1;
    v_ids := v_ids || v_carte.id;

    v_sortie := v_sortie || jsonb_build_object(
      'id', v_carte.id, 'numero', v_carte.numero, 'titre', v_carte.titre, 'artiste', v_carte.artiste,
      'cover_url', v_carte.cover_url, 'type_sortie', v_carte.type_sortie, 'rarete', v_carte.rarete,
      'nouvelle', v_nouvelle, 'quantite', v_qte);
  end loop;

  insert into public.coffres_ouvertures (user_id, collection_id, carte_ids) values (v_uid, c.id, v_ids);

  return jsonb_build_object('collection', c.id, 'cartes', v_sortie, 'restants', v_restant,
                            'total', (select count(*) from public.cartes where collection_id = c.id));
end $$;


-- ---------------------------------------------------------------------
-- 4. Ce que le site lit : la boutique, l'aperçu d'un booster
-- ---------------------------------------------------------------------

-- Un booster apparaît s'il est actif et rempli (ou si l'on en a encore en stock).
create or replace function public.boutique_liste()
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_deb date := date_trunc('week', public.xp_jour())::date;
  v_solde integer; v_cols jsonb; v_defis jsonb;
begin
  if v_uid is null then return null; end if;

  perform public.wc_defis_assurer(v_uid);

  select coalesce(solde, 0) into v_solde from public.wc_portefeuille where user_id = v_uid;

  select coalesce(jsonb_agg(x.j order by x.ordre), '[]'::jsonb) into v_cols from (
    select c.ordre, jsonb_build_object(
             'id', c.id, 'nom', c.nom, 'theme', c.theme, 'description', c.description, 'emoji', c.emoji,
             'couleurs', c.couleurs, 'visuel_url', c.visuel_url, 'prix_wc', c.prix_wc, 'debut', c.debut, 'fin', c.fin,
             'cartes_par_coffre', c.cartes_par_coffre,
             'statut', case when now() < c.debut then 'a_venir' when now() > c.fin then 'termine' else 'en_cours' end,
             'nb_cartes', (select count(*) from public.cartes k where k.collection_id = c.id),
             'possedees', (select count(*) from public.cartes_possedees p join public.cartes k on k.id = p.carte_id
                            where p.user_id = v_uid and k.collection_id = c.id),
             'coffres', coalesce((select cp.quantite from public.coffres_possedes cp
                                   where cp.user_id = v_uid and cp.collection_id = c.id), 0)) as j
      from public.collections c
     where c.actif
       and (exists (select 1 from public.cartes k where k.collection_id = c.id)
            or exists (select 1 from public.coffres_possedes cp where cp.user_id = v_uid and cp.collection_id = c.id and cp.quantite > 0))
  ) x;

  select coalesce(jsonb_agg(jsonb_build_object(
           'libelle', d.libelle, 'icone', d.icone, 'progres', d.progres, 'objectif', d.objectif, 'wc', d.wc,
           'faite', d.faite_le is not null) order by d.slot), '[]'::jsonb)
    into v_defis from public.wc_defis d
   where d.user_id = v_uid and d.semaine = to_char(public.xp_jour(), 'IYYY-IW');

  return jsonb_build_object('wc', coalesce(v_solde, 0), 'collections', v_cols, 'defis', v_defis,
                            'jours_restants', (v_deb + 6) - public.xp_jour());
end $$;

-- Ce qu'il y a dans un booster : toutes les cartes, sauf que la Secret Wave reste cachée (ni titre ni pochette).
create or replace function public.booster_apercu(p_collection text)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare c public.collections%rowtype; v_cartes jsonb;
begin
  if auth.uid() is null then return null; end if;

  select * into c from public.collections where id = p_collection and actif;
  if not found then return null; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'numero', k.numero, 'rarete', k.rarete, 'secret', k.rarete = 'secret_wave',
           'titre',       case when k.rarete = 'secret_wave' then null else k.titre end,
           'artiste',     case when k.rarete = 'secret_wave' then null else k.artiste end,
           'cover_url',   case when k.rarete = 'secret_wave' then null else k.cover_url end,
           'type_sortie', case when k.rarete = 'secret_wave' then null else k.type_sortie end)
         order by public.rarete_ordre(k.rarete), k.numero), '[]'::jsonb)
    into v_cartes from public.cartes k where k.collection_id = c.id;

  return jsonb_build_object('id', c.id, 'nom', c.nom, 'theme', c.theme, 'emoji', c.emoji, 'couleurs', c.couleurs,
                            'total', jsonb_array_length(v_cartes), 'cartes', v_cartes);
end $$;


-- ---------------------------------------------------------------------
-- 5. L'accès équipe : composer les boosters, en créer d'autres
-- ---------------------------------------------------------------------

create or replace function public.booster_equipe_liste()
returns jsonb language plpgsql security definer set search_path = public
as $$
begin
  if not public.est_equipe() then raise exception 'Réservé à l''équipe.'; end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', c.id, 'nom', c.nom, 'emoji', c.emoji, 'description', c.description, 'couleurs', c.couleurs,
             'visuel_url', c.visuel_url, 'actif', c.actif, 'prix_wc', c.prix_wc, 'debut', c.debut, 'fin', c.fin,
             'cartes_par_coffre', c.cartes_par_coffre,
             'detenteurs', (select count(distinct p.user_id) from public.cartes_possedees p join public.cartes k on k.id = p.carte_id where k.collection_id = c.id),
             'cartes', coalesce((select jsonb_agg(jsonb_build_object(
                          'id', k.id, 'numero', k.numero, 'titre', k.titre, 'artiste', k.artiste,
                          'cover_url', k.cover_url, 'type_sortie', k.type_sortie, 'rarete', k.rarete,
                          'release_id', k.release_id) order by k.numero)
                        from public.cartes k where k.collection_id = c.id), '[]'::jsonb))
           order by c.ordre, c.nom)
      from public.collections c), '[]'::jsonb);
end $$;

-- Crée (p_id nul) ou modifie un booster. Rend son identifiant.
create or replace function public.booster_equipe_sauver(
  p_id text, p_nom text, p_emoji text, p_description text, p_couleurs jsonb,
  p_debut timestamptz, p_fin timestamptz, p_prix integer, p_par_coffre integer, p_visuel text, p_actif boolean)
returns text language plpgsql security definer set search_path = public
as $$
declare v_id text := nullif(trim(coalesce(p_id, '')), ''); v_base text; v_n integer := 1;
begin
  if not public.est_equipe() then raise exception 'Réservé à l''équipe.'; end if;

  p_nom := trim(coalesce(p_nom, ''));
  if p_nom = '' then raise exception 'Donne un nom au booster.'; end if;
  if coalesce(p_prix, 0) < 1 then raise exception 'Le prix doit être d''au moins 1 WC.'; end if;
  if coalesce(p_par_coffre, 0) < 1 or p_par_coffre > 12 then raise exception 'Un booster contient de 1 à 12 cartes.'; end if;
  if p_debut is null or p_fin is null or p_fin <= p_debut then raise exception 'La date de fin doit suivre la date de début.'; end if;

  p_visuel := nullif(trim(coalesce(p_visuel, '')), '');
  if p_visuel is not null and p_visuel !~ '^https://' then raise exception 'L''image doit être une adresse https://.'; end if;

  if v_id is null then
    v_base := trim(both '_' from lower(regexp_replace(
                translate(p_nom, 'àâäéèêëîïôöùûüçÀÂÄÉÈÊËÎÏÔÖÙÛÜÇ', 'aaaeeeeiioouuucAAAEEEEIIOOUUUC'),
                '[^a-zA-Z0-9]+', '_', 'g')));
    if v_base = '' then v_base := 'booster'; end if;
    v_id := v_base;
    while exists (select 1 from public.collections where id = v_id) loop
      v_n := v_n + 1;
      v_id := v_base || '_' || v_n;
    end loop;
  end if;

  insert into public.collections (id, nom, theme, description, emoji, couleurs, debut, fin, prix_wc, cartes_par_coffre, visuel_url, actif, ordre)
  values (v_id, p_nom, v_id, coalesce(p_description, ''), coalesce(nullif(trim(p_emoji), ''), '🎴'),
          coalesce(p_couleurs, '{}'::jsonb), p_debut, p_fin, p_prix, p_par_coffre, p_visuel, coalesce(p_actif, true),
          coalesce((select max(ordre) from public.collections), 0) + 1)
  on conflict (id) do update
    set nom = excluded.nom, description = excluded.description, emoji = excluded.emoji, couleurs = excluded.couleurs,
        debut = excluded.debut, fin = excluded.fin, prix_wc = excluded.prix_wc,
        cartes_par_coffre = excluded.cartes_par_coffre, visuel_url = excluded.visuel_url, actif = excluded.actif;

  return v_id;
end $$;

-- Supprime un booster. Refusé si des membres en ont encore ou en ont des cartes, sauf si p_force.
create or replace function public.booster_equipe_supprimer(p_id text, p_force boolean default false)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if not public.est_equipe() then raise exception 'Réservé à l''équipe.'; end if;

  if not coalesce(p_force, false) and (
       exists (select 1 from public.coffres_possedes where collection_id = p_id and quantite > 0)
    or exists (select 1 from public.cartes_possedees p join public.cartes k on k.id = p.carte_id where k.collection_id = p_id)) then
    raise exception 'Des membres ont déjà des boosters ou des cartes de celui-ci : désactive-le plutôt que de le supprimer.';
  end if;

  delete from public.collections where id = p_id;
end $$;

-- Ajoute une sortie du catalogue au booster, avec sa rareté. La carte garde le titre et la pochette du moment.
create or replace function public.booster_equipe_carte_ajouter(p_collection text, p_release uuid, p_rarete text)
returns integer language plpgsql security definer set search_path = public
as $$
declare s public.submissions%rowtype; v_id integer;
begin
  if not public.est_equipe() then raise exception 'Réservé à l''équipe.'; end if;

  if not exists (select 1 from public.collections where id = p_collection) then raise exception 'Ce booster n''existe pas.'; end if;
  if public.rarete_ordre(p_rarete) = 0 then raise exception 'Rareté inconnue.'; end if;

  select * into s from public.submissions where id = p_release and status = 'approved';
  if not found then raise exception 'Cette sortie n''est pas dans le catalogue.'; end if;

  if exists (select 1 from public.cartes where collection_id = p_collection and release_id = p_release) then
    raise exception 'Cette sortie est déjà dans le booster.';
  end if;

  insert into public.cartes (collection_id, numero, release_id, titre, artiste, cover_url, type_sortie, rarete)
  values (p_collection,
          coalesce((select max(numero) from public.cartes where collection_id = p_collection), 0) + 1,
          s.id, s.track_title, s.artist_name, s.cover_url, s.release_type, p_rarete)
  returning id into v_id;

  return v_id;
end $$;

create or replace function public.booster_equipe_carte_retirer(p_carte integer)
returns void language plpgsql security definer set search_path = public
as $$
declare v_col text;
begin
  if not public.est_equipe() then raise exception 'Réservé à l''équipe.'; end if;

  delete from public.cartes where id = p_carte returning collection_id into v_col;
  if v_col is not null then perform public.booster_renumeroter(v_col); end if;
end $$;

create or replace function public.booster_equipe_carte_rarete(p_carte integer, p_rarete text)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if not public.est_equipe() then raise exception 'Réservé à l''équipe.'; end if;
  if public.rarete_ordre(p_rarete) = 0 then raise exception 'Rareté inconnue.'; end if;

  update public.cartes set rarete = p_rarete where id = p_carte;
end $$;

revoke all on function public.booster_renumeroter(text)                              from public, anon, authenticated;
revoke all on function public.booster_apercu(text)                                   from public, anon;
revoke all on function public.booster_equipe_liste()                                 from public, anon;
revoke all on function public.booster_equipe_sauver(text, text, text, text, jsonb, timestamptz, timestamptz, integer, integer, text, boolean) from public, anon;
revoke all on function public.booster_equipe_supprimer(text, boolean)                from public, anon;
revoke all on function public.booster_equipe_carte_ajouter(text, uuid, text)         from public, anon;
revoke all on function public.booster_equipe_carte_retirer(integer)                  from public, anon;
revoke all on function public.booster_equipe_carte_rarete(integer, text)             from public, anon;
grant execute on function public.booster_apercu(text)                                to authenticated;
grant execute on function public.booster_equipe_liste()                              to authenticated;
grant execute on function public.booster_equipe_sauver(text, text, text, text, jsonb, timestamptz, timestamptz, integer, integer, text, boolean) to authenticated;
grant execute on function public.booster_equipe_supprimer(text, boolean)             to authenticated;
grant execute on function public.booster_equipe_carte_ajouter(text, uuid, text)      to authenticated;
grant execute on function public.booster_equipe_carte_retirer(integer)               to authenticated;
grant execute on function public.booster_equipe_carte_rarete(integer, text)          to authenticated;


-- ---------------------------------------------------------------------
-- 6. Des WC « illimités » pour Rémy, le temps des essais (remise à zéro à l'ouverture du site)
-- ---------------------------------------------------------------------

select public.wc_crediter(id, 1000000, 'essais', 'illimite') from public.profiles where pseudo = 'Rémy' and is_admin;
