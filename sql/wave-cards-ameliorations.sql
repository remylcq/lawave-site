-- Wave Cards : le système d'amélioration des cartes + beaucoup plus de succès (2026-11-09).
--
-- AMÉLIORER UNE CARTE (par joueur, par carte : booster + artiste ; l'holo et la version normale partagent le même niveau)
--   Niveaux  : de 1 à 60, payés en Wave Coins. Le palier plafonne le niveau : 10 + 10 par étoile (étoile 0 → niveau 10 … 5 étoiles → niveau 60).
--   Étoiles  : de 0 à 5. Pour gagner une étoile, la carte doit être au plafond de son palier ; on dépense des DOUBLONS de cette carte
--              (exemplaires en plus du premier, qu'on garde toujours) et des Wave Coins.
--   Effet    : toutes les statistiques × (1 + 2 % par niveau au-dessus du 1) × (1 + 8 % par étoile). Maximum : × 3,05.
--   Moteur   : combat_identite applique ce bonus aux cartes du joueur ; les adversaires de la Tour n'en ont pas.
-- SUCCÈS : une colonne « wc » (récompense en Wave Coins) et 75 nouveaux succès (Tour, combats, gardiens, niveaux, étoiles, marché…).
-- Sans danger si on le repasse.

-- 1. Les niveaux et les étoiles de chaque carte du joueur
create table if not exists public.jeu_cartes_niveaux (
  user_id uuid not null references auth.users (id) on delete cascade,
  booster_id text not null references public.jeu_boosters (id) on delete cascade,
  artist_id uuid not null,
  niveau smallint not null default 1 check (niveau between 1 and 60),
  etoiles smallint not null default 0 check (etoiles between 0 and 5),
  maj timestamptz not null default now(),
  primary key (user_id, booster_id, artist_id)
);
alter table public.jeu_cartes_niveaux enable row level security;
revoke all on table public.jeu_cartes_niveaux from anon, authenticated;

-- 2. Les règles (une seule source de vérité ; le site en garde un miroir pour l'aperçu)
create or replace function public.jeu_amelio_cap(p_etoiles integer) returns integer
language sql immutable set search_path to 'public' as $$ select 10 + 10 * least(greatest(coalesce(p_etoiles, 0), 0), 5) $$;

create or replace function public.jeu_amelio_mult(p_niveau integer, p_etoiles integer) returns numeric
language sql immutable set search_path to 'public' as $$
  select round((1 + 0.02 * (least(greatest(coalesce(p_niveau, 1), 1), 60) - 1)) * (1 + 0.08 * least(greatest(coalesce(p_etoiles, 0), 0), 5)), 4) $$;

-- Wave Coins pour passer du niveau p_niveau au suivant
create or replace function public.jeu_amelio_cout_niveau(p_rarete integer, p_niveau integer) returns integer
language sql immutable set search_path to 'public' as $$
  select greatest(1, round((array[2, 3, 4, 6, 6, 9])[least(greatest(coalesce(p_rarete, 1), 1), 6)] * power(greatest(coalesce(p_niveau, 1), 1), 1.25)))::integer $$;

-- Doublons et Wave Coins pour passer de p_etoiles à p_etoiles + 1 (null au maximum)
create or replace function public.jeu_amelio_etoile(p_rarete integer, p_etoiles integer) returns jsonb
language sql immutable set search_path to 'public' as $$
  select case when coalesce(p_etoiles, 0) >= 5 then null else jsonb_build_object(
    'doublons', (array[1, 2, 3, 4, 6])[coalesce(p_etoiles, 0) + 1],
    'wc', round((array[150, 400, 1000, 2500, 6000])[coalesce(p_etoiles, 0) + 1] * (array[1, 1, 1.5, 2.5, 2.5, 4])[least(greatest(coalesce(p_rarete, 1), 1), 6)])::integer) end $$;

-- 3. Le moteur : l'identité d'une carte prend en compte le niveau et les étoiles du joueur (p_niveau / p_etoiles : aperçu d'un autre palier)
drop function if exists public.combat_identite(uuid, integer, boolean, boolean, text, uuid);

create or replace function public.combat_identite(p_artist uuid, p_rarete integer, p_holo boolean, p_sans boolean default false, p_booster text default null, p_user uuid default null,
                                                  p_niveau integer default null, p_etoiles integer default null) returns jsonb
language plpgsql stable set search_path to 'public' as $$
declare
  c public.jeu_cartes; s public.combat_surcharges; ro public.combat_roles; v_role text;
  al public.jeu_albums; ti jsonb; rmax bigint; v_alb jsonb;
  n numeric; m numeric; hm numeric; h numeric; v_pv integer; v_pui integer; v_def integer; v_vit integer;
  b_pv integer; b_pui integer; b_def integer; b_vit integer;
  ids text[]; tid text; titres jsonb := '[]'::jsonb; sl integer; cp text; jc jsonb; v_nom text; v_mult numeric;
  v_niv integer := 1; v_eto integer := 0; v_am numeric := 1;
begin
  select * into c from public.jeu_cartes where artist_id = p_artist;
  if not found then raise exception 'Carte inconnue.'; end if;
  if not p_sans then select * into s from public.combat_surcharges where artist_id = p_artist; end if;

  if p_booster is not null then
    select a.* into al from public.jeu_booster_cartes bc join public.jeu_albums a on a.id = bc.album_id and a.actif
     where bc.booster_id = p_booster and bc.artist_id = p_artist;
  end if;
  if al.id is null then
    select a.* into al from public.jeu_albums a join public.submissions su on su.id = a.release_id
     where a.artist_id = p_artist and a.actif order by su.release_date desc nulls last, a.cree_le desc limit 1;
  end if;

  v_role := coalesce(s.role, public.combat_role_de(p_artist, null));
  if p_sans then
    v_role := public.combat_role_de(p_artist, null);
    select * into s from public.combat_surcharges where false;
  end if;
  select * into ro from public.combat_roles where id = v_role;

  -- Le niveau et les étoiles du joueur sur cette carte (ou ceux demandés pour un aperçu)
  if p_niveau is not null or p_etoiles is not null then
    v_niv := coalesce(p_niveau, 1); v_eto := coalesce(p_etoiles, 0);
  elsif p_user is not null and p_booster is not null then
    select coalesce(x.niveau, 1), coalesce(x.etoiles, 0) into v_niv, v_eto
      from (select 1) base left join public.jeu_cartes_niveaux x on x.user_id = p_user and x.booster_id = p_booster and x.artist_id = p_artist;
  end if;
  v_am := public.jeu_amelio_mult(v_niv, v_eto);

  n := greatest(0, least(1, (log(greatest(c.fans, 1000)::numeric) - 5.5) / 1.6));
  m := case when p_rarete <= 1 then 1 when p_rarete = 2 then 1.08 when p_rarete = 3 then 1.18 when p_rarete = 4 then 1.3 when p_rarete = 5 then 1.45 else 1.6 end;
  hm := case when p_holo then 1.06 else 1 end;
  h := (abs(hashtext(p_artist::text || 'vit')) % 1000) / 1000.0;
  b_pv  := coalesce(s.pv,  round((80 + 50 * n) * ro.m_pv));
  b_pui := coalesce(s.pui, round((45 + 25 * n) * ro.m_pui));
  b_def := coalesce(s.def, round((40 + 25 * n) * ro.m_def));
  b_vit := coalesce(s.vit, round((45 + 50 * h) * ro.m_vit));
  v_pv  := round(b_pv * m * hm * v_am);
  v_pui := round(b_pui * m * hm * v_am);
  v_def := round(b_def * m * hm * v_am);
  v_vit := round(b_vit * hm * v_am);

  if al.id is not null then select coalesce(max((x ->> 'rang')::bigint), 0) into rmax from jsonb_array_elements(al.titres) x; end if;
  for sl in 1..3 loop
    v_nom := null; v_mult := 1; ti := null;
    if al.id is not null and jsonb_array_length(al.attaques) >= sl then
      select x into ti from jsonb_array_elements(al.titres) x where (x ->> 'id') = (al.attaques ->> (sl - 1)) limit 1;
      if ti is not null then
        v_nom := ti ->> 'titre';
        if rmax > 0 then v_mult := 0.9 + 0.2 * (ti ->> 'rang')::numeric / rmax; end if;
      end if;
    end if;
    if v_nom is null then
      ids := array(select id from public.combat_techniques where actif and role = v_role and slot = sl order by id);
      if array_length(ids, 1) is null then ids := array(select id from public.combat_techniques where actif and slot = sl order by id); end if;
      tid := ids[1 + abs(hashtext(p_artist::text || 'tech' || sl)) % array_length(ids, 1)];
      select nom into v_nom from public.combat_techniques where id = tid;
    end if;
    titres := titres || jsonb_build_array(jsonb_build_object('nom', v_nom, 'mult', round(v_mult, 3), 'album', ti is not null));
  end loop;

  cp := s.capacite;
  if cp is null and p_rarete >= 4 then
    ids := array(select id from public.combat_capacites order by id);
    cp := ids[1 + abs(hashtext(p_artist::text || 'cap')) % array_length(ids, 1)];
  end if;
  if cp is not null then
    select jsonb_build_object('id', id, 'nom', nom, 'code', code, 'valeur', valeur, 'description', description) into jc from public.combat_capacites where id = cp;
  end if;

  if al.id is not null then
    select jsonb_build_object('id', al.id, 'titre', su.track_title, 'cover', su.cover_url) into v_alb from public.submissions su where su.id = al.release_id;
  end if;

  return jsonb_build_object(
    'artist_id', p_artist, 'nom', c.nom, 'photo', c.photo, 'numero', c.numero, 'rarete', p_rarete, 'holo', p_holo, 'fans', c.fans,
    'role', v_role, 'role_nom', ro.nom, 'role_resume', ro.resume,
    'pv', v_pv, 'pui', v_pui, 'def', v_def, 'vit', v_vit,
    'niveau', v_niv, 'etoiles', v_eto, 'mult_niveau', v_am,
    'titres', titres, 'capacite', jc,
    'base', jsonb_build_object('pv', b_pv, 'pui', b_pui, 'def', b_def, 'vit', b_vit),
    'mult_rarete', m, 'album', v_alb,
    'surcharge', case when s.artist_id is null then null else jsonb_strip_nulls(to_jsonb(s) - 'artist_id' - 'maj_le') end);
end $$;

create or replace function public.combat_unite(p_artist uuid, p_rarete integer, p_holo boolean, p_bonus integer default 0, p_booster text default null, p_user uuid default null) returns jsonb
language plpgsql stable set search_path to 'public' as $$
declare i jsonb := public.combat_identite(p_artist, p_rarete, p_holo, false, p_booster, p_user); k numeric := 1 + coalesce(p_bonus, 0) / 100.0;
begin
  return jsonb_build_object(
    'artist_id', p_artist, 'booster', p_booster, 'nom', i ->> 'nom', 'photo', i ->> 'photo', 'numero', i -> 'numero', 'rarete', p_rarete, 'holo', p_holo,
    'role', i ->> 'role', 'role_nom', i ->> 'role_nom', 'niveau', i -> 'niveau', 'etoiles', i -> 'etoiles',
    'pv', round((i ->> 'pv')::numeric * k), 'pv_max', round((i ->> 'pv')::numeric * k), 'pui', round((i ->> 'pui')::numeric * k),
    'def', round((i ->> 'def')::numeric * k), 'vit', round((i ->> 'vit')::numeric * k),
    'titres', i -> 'titres', 'capacite', i -> 'capacite');
end $$;

revoke all on function public.combat_identite(uuid, integer, boolean, boolean, text, uuid, integer, integer) from public, anon;
grant execute on function public.combat_identite(uuid, integer, boolean, boolean, text, uuid, integer, integer) to authenticated;

-- 4. La fiche d'amélioration d'une carte : niveau, étoiles, coûts, statistiques actuelles et suivantes
create or replace function public.jeu_carte_progres(p_booster text, p_artist uuid) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid(); bc public.jeu_booster_cartes; v_n integer; v_h integer; n public.jeu_cartes_niveaux;
  v_niv integer := 1; v_eto integer := 0; v_cap integer; v_wc integer; v_et jsonb; v_spare integer; v_cout integer;
  s0 jsonb; s1 jsonb; s2 jsonb;
begin
  if v_uid is null then raise exception 'Connecte-toi.'; end if;
  select * into bc from public.jeu_booster_cartes where booster_id = p_booster and artist_id = p_artist;
  if not found then raise exception 'Carte introuvable.'; end if;
  select coalesce(sum(quantite) filter (where not holo), 0), coalesce(sum(quantite) filter (where holo), 0) into v_n, v_h
    from public.jeu_collection_b where user_id = v_uid and booster_id = p_booster and artist_id = p_artist;
  select * into n from public.jeu_cartes_niveaux where user_id = v_uid and booster_id = p_booster and artist_id = p_artist;
  if found then v_niv := n.niveau; v_eto := n.etoiles; end if;
  v_cap := public.jeu_amelio_cap(v_eto);
  v_wc := coalesce((select solde from public.wc_portefeuille where user_id = v_uid), 0);
  v_et := public.jeu_amelio_etoile(bc.rarete, v_eto);
  v_spare := greatest(v_n + v_h - 1, 0);
  v_cout := case when v_niv < v_cap then public.jeu_amelio_cout_niveau(bc.rarete, v_niv) end;
  s0 := public.combat_identite(p_artist, bc.rarete, v_h > 0, false, p_booster, null, v_niv, v_eto);
  s1 := case when v_niv < v_cap then public.combat_identite(p_artist, bc.rarete, v_h > 0, false, p_booster, null, v_niv + 1, v_eto) end;
  s2 := case when v_et is not null then public.combat_identite(p_artist, bc.rarete, v_h > 0, false, p_booster, null, v_niv, v_eto + 1) end;
  return jsonb_build_object(
    'booster', p_booster, 'artist', p_artist, 'rarete', bc.rarete, 'possede', v_n + v_h > 0, 'quantite', v_n + v_h, 'doublons', v_spare,
    'niveau', v_niv, 'etoiles', v_eto, 'cap', v_cap, 'niveau_max', 60, 'etoiles_max', 5,
    'mult', public.jeu_amelio_mult(v_niv, v_eto),
    'cout', v_cout, 'wc', v_wc, 'peut', v_cout is not null and v_wc >= v_cout and v_n + v_h > 0,
    'etoile', case when v_et is null then null else v_et || jsonb_build_object('pret', v_niv >= v_cap,
        'peut', v_niv >= v_cap and v_spare >= (v_et ->> 'doublons')::integer and v_wc >= (v_et ->> 'wc')::integer) end,
    'stats', jsonb_build_object('pv', s0 -> 'pv', 'pui', s0 -> 'pui', 'def', s0 -> 'def', 'vit', s0 -> 'vit'),
    'stats_suivant', case when s1 is null then null else jsonb_build_object('pv', s1 -> 'pv', 'pui', s1 -> 'pui', 'def', s1 -> 'def', 'vit', s1 -> 'vit') end,
    'stats_etoile', case when s2 is null then null else jsonb_build_object('pv', s2 -> 'pv', 'pui', s2 -> 'pui', 'def', s2 -> 'def', 'vit', s2 -> 'vit') end);
end $$;

-- 5. Monter une carte de 1 à 20 niveaux d'un coup (le plus possible avec les Wave Coins, sans dépasser le plafond du palier)
create or replace function public.jeu_carte_monter(p_booster text, p_artist uuid, p_niveaux integer default 1) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid(); bc public.jeu_booster_cartes; n public.jeu_cartes_niveaux; v_qte integer; v_cap integer; v_solde integer;
  v_depense integer := 0; v_niv integer; v_fait integer := 0; v_cout integer := 0; v_max integer := least(greatest(coalesce(p_niveaux, 1), 1), 20);
begin
  if v_uid is null then raise exception 'Connecte-toi.'; end if;
  perform public.jeu_joueur_assurer(v_uid);
  select * into bc from public.jeu_booster_cartes where booster_id = p_booster and artist_id = p_artist;
  if not found then raise exception 'Carte introuvable.'; end if;
  select coalesce(sum(quantite), 0) into v_qte from public.jeu_collection_b where user_id = v_uid and booster_id = p_booster and artist_id = p_artist;
  if v_qte < 1 then raise exception 'Tu ne possèdes pas cette carte.'; end if;

  insert into public.jeu_cartes_niveaux (user_id, booster_id, artist_id) values (v_uid, p_booster, p_artist) on conflict do nothing;
  select * into n from public.jeu_cartes_niveaux where user_id = v_uid and booster_id = p_booster and artist_id = p_artist for update;
  v_cap := public.jeu_amelio_cap(n.etoiles);
  if n.niveau >= v_cap then
    if n.etoiles >= 5 then raise exception 'Cette carte est au niveau maximum.'; end if;
    raise exception 'Palier atteint (niveau %) : ajoute une étoile pour continuer.', v_cap;
  end if;

  insert into public.wc_portefeuille (user_id, solde) values (v_uid, 0) on conflict (user_id) do nothing;
  select solde into v_solde from public.wc_portefeuille where user_id = v_uid for update;

  v_niv := n.niveau;
  while v_fait < v_max and v_niv < v_cap loop
    v_cout := public.jeu_amelio_cout_niveau(bc.rarete, v_niv);
    exit when v_solde - v_depense < v_cout;
    v_depense := v_depense + v_cout; v_niv := v_niv + 1; v_fait := v_fait + 1;
  end loop;
  if v_fait = 0 then raise exception 'Il te manque % Wave Coins.', v_cout - v_solde; end if;

  update public.wc_portefeuille set solde = solde - v_depense where user_id = v_uid;
  insert into public.wc_journal (user_id, delta, motif, ref) values (v_uid, -v_depense, 'jeu:amelio', p_booster || ':' || p_artist || ':' || v_niv);
  update public.jeu_cartes_niveaux set niveau = v_niv, maj = now() where user_id = v_uid and booster_id = p_booster and artist_id = p_artist;
  return jsonb_build_object('niveaux', v_fait, 'depense', v_depense, 'progres', public.jeu_carte_progres(p_booster, p_artist), 'etat', public.jeu_etat_json(v_uid));
end $$;

-- 6. Ajouter une étoile : la carte est au plafond de son palier ; on dépense des doublons de cette carte et des Wave Coins
create or replace function public.jeu_carte_etoile(p_booster text, p_artist uuid) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid(); bc public.jeu_booster_cartes; n public.jeu_cartes_niveaux; v_qte integer; v_cap integer; v_solde integer;
  e jsonb; v_dbl integer; v_wc integer; v_reste integer; r record; v_pris integer;
begin
  if v_uid is null then raise exception 'Connecte-toi.'; end if;
  perform public.jeu_joueur_assurer(v_uid);
  select * into bc from public.jeu_booster_cartes where booster_id = p_booster and artist_id = p_artist;
  if not found then raise exception 'Carte introuvable.'; end if;
  select coalesce(sum(quantite), 0) into v_qte from public.jeu_collection_b where user_id = v_uid and booster_id = p_booster and artist_id = p_artist;
  if v_qte < 1 then raise exception 'Tu ne possèdes pas cette carte.'; end if;

  insert into public.jeu_cartes_niveaux (user_id, booster_id, artist_id) values (v_uid, p_booster, p_artist) on conflict do nothing;
  select * into n from public.jeu_cartes_niveaux where user_id = v_uid and booster_id = p_booster and artist_id = p_artist for update;
  if n.etoiles >= 5 then raise exception 'Cette carte a déjà ses cinq étoiles.'; end if;
  v_cap := public.jeu_amelio_cap(n.etoiles);
  if n.niveau < v_cap then raise exception 'Monte d''abord la carte au niveau % pour lui donner une étoile.', v_cap; end if;

  e := public.jeu_amelio_etoile(bc.rarete, n.etoiles);
  v_dbl := (e ->> 'doublons')::integer; v_wc := (e ->> 'wc')::integer;
  if v_qte - 1 < v_dbl then raise exception 'Il te faut % doublon(s) de cette carte : tu en as %.', v_dbl, greatest(v_qte - 1, 0); end if;
  insert into public.wc_portefeuille (user_id, solde) values (v_uid, 0) on conflict (user_id) do nothing;
  select solde into v_solde from public.wc_portefeuille where user_id = v_uid for update;
  if v_solde < v_wc then raise exception 'Il te manque % Wave Coins.', v_wc - v_solde; end if;

  -- les doublons : d'abord les versions normales, l'holo en dernier
  v_reste := v_dbl;
  for r in select holo, quantite from public.jeu_collection_b where user_id = v_uid and booster_id = p_booster and artist_id = p_artist and quantite > 0 order by holo, quantite desc for update loop
    exit when v_reste <= 0;
    v_pris := least(v_reste, r.quantite);
    update public.jeu_collection_b set quantite = quantite - v_pris where user_id = v_uid and booster_id = p_booster and artist_id = p_artist and holo = r.holo;
    v_reste := v_reste - v_pris;
  end loop;

  update public.wc_portefeuille set solde = solde - v_wc where user_id = v_uid;
  insert into public.wc_journal (user_id, delta, motif, ref) values (v_uid, -v_wc, 'jeu:etoile', p_booster || ':' || p_artist || ':' || (n.etoiles + 1));
  update public.jeu_cartes_niveaux set etoiles = etoiles + 1, maj = now() where user_id = v_uid and booster_id = p_booster and artist_id = p_artist;
  return jsonb_build_object('etoiles', n.etoiles + 1, 'doublons', v_dbl, 'depense', v_wc, 'progres', public.jeu_carte_progres(p_booster, p_artist), 'etat', public.jeu_etat_json(v_uid));
end $$;

-- Les niveaux de toutes mes cartes (pour les badges de la collection et le choix de l'équipe)
create or replace function public.jeu_cartes_niveaux_lire() returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('booster', booster_id, 'artist', artist_id, 'niveau', niveau, 'etoiles', etoiles))
                     from public.jeu_cartes_niveaux where user_id = v_uid and (niveau > 1 or etoiles > 0)), '[]'::jsonb);
end $$;

revoke all on function public.jeu_amelio_cap(integer), public.jeu_amelio_mult(integer, integer), public.jeu_amelio_cout_niveau(integer, integer), public.jeu_amelio_etoile(integer, integer),
  public.jeu_carte_progres(text, uuid), public.jeu_carte_monter(text, uuid, integer), public.jeu_carte_etoile(text, uuid), public.jeu_cartes_niveaux_lire() from public, anon;
grant execute on function public.jeu_carte_progres(text, uuid), public.jeu_carte_monter(text, uuid, integer), public.jeu_carte_etoile(text, uuid), public.jeu_cartes_niveaux_lire() to authenticated;

-- 7. La Tour : mes cartes avec leur niveau (les statistiques en tiennent déjà compte)
create or replace function public.combat_tour_cartes() returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg((public.combat_identite(col.artist_id, bc.rarete, col.holo, false, col.booster_id, v_uid) - 'surcharge' - 'base')
                     || jsonb_build_object('booster', col.booster_id, 'booster_nom', bo.nom, 'numero', bc.numero, 'quantite', col.quantite)
                     order by bc.rarete desc, c.fans desc)
      from public.jeu_collection_b col
      join public.jeu_boosters bo on bo.id = col.booster_id and bo.classeur and bo.actif
      join public.jeu_booster_cartes bc on bc.booster_id = col.booster_id and bc.artist_id = col.artist_id
      join public.jeu_cartes c on c.artist_id = col.artist_id and c.active
     where col.user_id = v_uid and col.quantite > 0), '[]'::jsonb);
end $$;
revoke all on function public.combat_tour_cartes() from public, anon;
grant execute on function public.combat_tour_cartes() to authenticated;

-- 8. Les succès : une récompense en Wave Coins, de nouvelles mesures, 75 nouveaux succès
alter table public.jeu_succes_def add column if not exists wc integer not null default 0;

create or replace function public.jeu_metriques(p_user uuid) returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'ouvertures', coalesce(j.ouvertures, 0), 'holos', coalesce(j.holos, 0), 'niveau', coalesce(j.niveau, 1),
    'recycles', coalesce(j.recycles, 0), 'ateliers', coalesce(j.ateliers, 0), 'serie_max', coalesce(j.serie_max, 0),
    'roues', (select count(*) from public.jeu_roue_log r where r.user_id = p_user),
    'missions', (select count(*) from public.jeu_reclamations r where r.user_id = p_user and r.cle like 'm:%'),
    'uniques', coalesce(c.uniques, 0), 'rares', coalesce(c.rares, 0), 'epiques', coalesce(c.epiques, 0),
    'legendaires', coalesce(c.legendaires, 0), 'mythiques', coalesce(c.mythiques, 0), 'speciales', coalesce(c.speciales, 0),
    'etage', coalesce(t.etage, 0), 'gardiens', coalesce(t.etage, 0) / 10, 'combats_gagnes', coalesce(t.gagnes, 0), 'combats', coalesce(t.gagnes, 0) + coalesce(t.perdus, 0),
    'niv_max', coalesce(a.niv_max, 1), 'ameliorations', coalesce(a.ameliorations, 0), 'etoiles', coalesce(a.etoiles, 0), 'etoiles_max', coalesce(a.cinq, 0),
    'ventes', (select count(*) from public.marche_annonces m where m.vendeur = p_user and m.etat = 'vendue'),
    'achats', (select count(*) from public.marche_annonces m where m.acheteur = p_user and m.etat = 'vendue'),
    'doublons', coalesce(d.doublons, 0),
    'wc_depenses', coalesce((select -sum(w.delta) from public.wc_journal w where w.user_id = p_user and w.motif in ('jeu:amelio', 'jeu:etoile')), 0))
  from (select 1) base
  left join public.jeu_joueurs j on j.user_id = p_user
  left join lateral (
    select count(*)::integer as uniques,
           count(*) filter (where k.rarete >= 2)::integer as rares, count(*) filter (where k.rarete >= 3)::integer as epiques,
           count(*) filter (where k.rarete >= 4)::integer as legendaires, count(*) filter (where k.rarete >= 5)::integer as mythiques,
           count(*) filter (where k.rarete = 6)::integer as speciales
      from (select distinct bc.booster_id, bc.artist_id, bc.rarete from public.jeu_collection_b col
              join public.jeu_boosters bb on bb.id = col.booster_id and bb.classeur and bb.actif
              join public.jeu_booster_cartes bc on bc.booster_id = col.booster_id and bc.artist_id = col.artist_id
             where col.user_id = p_user and col.quantite > 0) k
  ) c on true
  left join lateral (select max(etage_max)::integer as etage, sum(victoires)::integer as gagnes, sum(defaites)::integer as perdus
                       from public.combat_tour_progres where user_id = p_user) t on true
  left join lateral (select max(niveau)::integer as niv_max, sum(niveau - 1)::integer as ameliorations, sum(etoiles)::integer as etoiles,
                            count(*) filter (where etoiles = 5)::integer as cinq
                       from public.jeu_cartes_niveaux where user_id = p_user) a on true
  left join lateral (select sum(q.t)::integer as doublons
                       from (select sum(quantite) - 1 as t from public.jeu_collection_b where user_id = p_user and quantite > 0 group by booster_id, artist_id) q where q.t > 0) d on true
$$;

create or replace function public.jeu_succes() returns jsonb
language plpgsql security definer set search_path to 'public' as $$
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
             'tirages', d.tirages, 'vinyles', d.vinyles, 'wc', d.wc) order by d.ordre)
      from public.jeu_succes_def d), '[]'::jsonb));
end $$;

create or replace function public.jeu_succes_prendre(p_id text) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); d public.jeu_succes_def; m jsonb; v_credit jsonb; v_wc integer := 0;
begin
  if v_uid is null then raise exception 'Connecte-toi.'; end if;
  perform public.jeu_joueur_assurer(v_uid);
  select * into d from public.jeu_succes_def where id = p_id;
  if not found then raise exception 'Succès inconnu.'; end if;
  m := public.jeu_metriques(v_uid);
  if coalesce((m ->> d.metrique)::integer, 0) < d.seuil then raise exception 'Succès pas encore atteint.'; end if;
  if not public.jeu_reclamer(v_uid, 'succes:' || p_id) then raise exception 'Déjà récupéré.'; end if;
  v_credit := public.jeu_crediter(v_uid, d.tirages, d.vinyles, 0);
  if d.wc > 0 then v_wc := public.wc_crediter(v_uid, d.wc, 'jeu:succes', p_id); end if;
  return jsonb_build_object('gain', v_credit || jsonb_build_object('wc', v_wc), 'etat', public.jeu_etat_json(v_uid));
end $$;

-- (famille, id, nom, description, mesure, seuil, vinyles-pack, Wave Coins, ordre)
insert into public.jeu_succes_def (id, famille, nom, description, metrique, seuil, tirages, vinyles, wc, ordre) values
  -- La Tour : l'étage le plus haut atteint
  ('tour-10',   'tour', 'Premiers pas',            'Atteins l''étage 10 de la Tour.',   'etage', 10,   3, 0, 40,    300),
  ('tour-25',   'tour', 'Ça grimpe',               'Atteins l''étage 25 de la Tour.',   'etage', 25,   5, 0, 100,   301),
  ('tour-50',   'tour', 'Cinquantième',            'Atteins l''étage 50 de la Tour.',   'etage', 50,   8, 0, 200,   302),
  ('tour-100',  'tour', 'Centurion',               'Atteins l''étage 100 de la Tour.',  'etage', 100,  12, 0, 400,  303),
  ('tour-200',  'tour', 'Haut perché',             'Atteins l''étage 200 de la Tour.',  'etage', 200,  20, 0, 800,  304),
  ('tour-300',  'tour', 'Au-dessus des nuages',    'Atteins l''étage 300 de la Tour.',  'etage', 300,  30, 0, 1200, 305),
  ('tour-500',  'tour', 'À mi-chemin du ciel',     'Atteins l''étage 500 de la Tour.',  'etage', 500,  50, 0, 2500, 306),
  ('tour-750',  'tour', 'Presque au sommet',       'Atteins l''étage 750 de la Tour.',  'etage', 750,  80, 0, 4000, 307),
  ('tour-1000', 'tour', 'Sommet de la Tour',       'Atteins l''étage 1 000 de la Tour.', 'etage', 1000, 150, 0, 10000, 308),
  -- Les victoires au combat
  ('cbt-1',    'combats', 'Première victoire',    'Gagne un combat dans la Tour.',     'combats_gagnes', 1,    2, 0, 20,   310),
  ('cbt-10',   'combats', 'Échauffement',          'Gagne 10 combats.',                 'combats_gagnes', 10,   4, 0, 60,   311),
  ('cbt-50',   'combats', 'Habitué du ring',       'Gagne 50 combats.',                 'combats_gagnes', 50,   8, 0, 150,  312),
  ('cbt-100',  'combats', 'Vétéran',               'Gagne 100 combats.',                'combats_gagnes', 100,  12, 0, 300, 313),
  ('cbt-250',  'combats', 'Champion',              'Gagne 250 combats.',                'combats_gagnes', 250,  20, 0, 600, 314),
  ('cbt-500',  'combats', 'Machine de guerre',     'Gagne 500 combats.',                'combats_gagnes', 500,  35, 0, 1200, 315),
  ('cbt-1000', 'combats', 'Légende de l''arène',   'Gagne 1 000 combats.',              'combats_gagnes', 1000, 60, 0, 2500, 316),
  -- Les gardiens (un tous les 10 étages)
  ('gar-1',   'gardiens', 'Gardien tombé',         'Bats ton premier gardien (étage 10).', 'gardiens', 1,   3, 0, 50,   320),
  ('gar-5',   'gardiens', 'Briseur de gardes',     'Bats 5 gardiens.',                  'gardiens', 5,   6, 0, 150,  321),
  ('gar-10',  'gardiens', 'Chasseur de gardiens',  'Bats 10 gardiens.',                 'gardiens', 10,  10, 0, 300, 322),
  ('gar-25',  'gardiens', 'Fléau des gardiens',    'Bats 25 gardiens.',                 'gardiens', 25,  20, 0, 800, 323),
  ('gar-50',  'gardiens', 'Maître des gardiens',   'Bats 50 gardiens.',                 'gardiens', 50,  40, 0, 2000, 324),
  ('gar-100', 'gardiens', 'Seigneur de la Tour',   'Bats les 100 gardiens de la Tour.', 'gardiens', 100, 100, 0, 6000, 325),
  -- Le niveau de ta meilleure carte
  ('cniv-5',  'cniv', 'Affûtée',                   'Monte une carte au niveau 5.',      'niv_max', 5,  2, 0, 30,   330),
  ('cniv-10', 'cniv', 'En forme',                  'Monte une carte au niveau 10.',     'niv_max', 10, 4, 0, 80,   331),
  ('cniv-20', 'cniv', 'Aguerrie',                  'Monte une carte au niveau 20.',     'niv_max', 20, 8, 0, 200,  332),
  ('cniv-30', 'cniv', 'Redoutable',                'Monte une carte au niveau 30.',     'niv_max', 30, 15, 0, 500, 333),
  ('cniv-40', 'cniv', 'Redoutée',                  'Monte une carte au niveau 40.',     'niv_max', 40, 25, 0, 1000, 334),
  ('cniv-50', 'cniv', 'Légendaire',                'Monte une carte au niveau 50.',     'niv_max', 50, 40, 0, 2000, 335),
  ('cniv-60', 'cniv', 'Au sommet de sa forme',     'Monte une carte au niveau maximum (60).', 'niv_max', 60, 80, 0, 5000, 336),
  -- Le total de niveaux gagnés
  ('amel-10',   'amelio', 'Mécano',                'Gagne 10 niveaux en tout sur tes cartes.',   'ameliorations', 10,   3, 0, 40,   340),
  ('amel-50',   'amelio', 'Préparateur',           'Gagne 50 niveaux en tout.',                  'ameliorations', 50,   6, 0, 120,  341),
  ('amel-150',  'amelio', 'Coach',                 'Gagne 150 niveaux en tout.',                 'ameliorations', 150,  12, 0, 300, 342),
  ('amel-400',  'amelio', 'Entraîneur',            'Gagne 400 niveaux en tout.',                 'ameliorations', 400,  25, 0, 800, 343),
  ('amel-1000', 'amelio', 'Directeur sportif',     'Gagne 1 000 niveaux en tout.',               'ameliorations', 1000, 50, 0, 2000, 344),
  ('amel-2500', 'amelio', 'Manager de légende',    'Gagne 2 500 niveaux en tout.',               'ameliorations', 2500, 100, 0, 5000, 345),
  -- Les étoiles
  ('eto-1',  'etoiles', 'Première étoile',         'Donne une étoile à une carte.',              'etoiles', 1,  3, 0, 60,   350),
  ('eto-3',  'etoiles', 'Petit ciel',              'Gagne 3 étoiles en tout.',                   'etoiles', 3,  5, 0, 120,  351),
  ('eto-5',  'etoiles', 'Constellation',           'Gagne 5 étoiles en tout.',                   'etoiles', 5,  8, 0, 250,  352),
  ('eto-10', 'etoiles', 'Galaxie',                 'Gagne 10 étoiles en tout.',                  'etoiles', 10, 15, 0, 600, 353),
  ('eto-25', 'etoiles', 'Voie lactée',             'Gagne 25 étoiles en tout.',                  'etoiles', 25, 35, 0, 1800, 354),
  ('eto-50', 'etoiles', 'Univers',                 'Gagne 50 étoiles en tout.',                  'etoiles', 50, 80, 0, 5000, 355),
  ('et5-1',  'cinq', 'Cinq étoiles',               'Amène une carte à ses cinq étoiles.',        'etoiles_max', 1,  25, 0, 1500, 360),
  ('et5-3',  'cinq', 'Trio étoilé',                'Amène 3 cartes à cinq étoiles.',             'etoiles_max', 3,  60, 0, 4000, 361),
  ('et5-10', 'cinq', 'Panthéon cinq étoiles',      'Amène 10 cartes à cinq étoiles.',            'etoiles_max', 10, 150, 0, 12000, 362),
  -- Les cartes Spécial
  ('spe-1',  'speciales', 'Pièce rare',            'Obtiens une carte Spécial.',                 'speciales', 1,  10, 0, 150,  370),
  ('spe-2',  'speciales', 'Duo rouge',             'Obtiens 2 cartes Spécial différentes.',      'speciales', 2,  20, 0, 300,  371),
  ('spe-5',  'speciales', 'Collectionneur de Spécial', 'Obtiens 5 cartes Spécial différentes.',  'speciales', 5,  50, 0, 1000, 372),
  ('spe-10', 'speciales', 'Maison du Spécial',     'Obtiens 10 cartes Spécial différentes.',     'speciales', 10, 120, 0, 3000, 373),
  -- Le marché
  ('ven-1',   'ventes', 'Premier vendeur',         'Vends une carte sur le marché.',             'ventes', 1,   3, 0, 30,   380),
  ('ven-5',   'ventes', 'Brocanteur',              'Vends 5 cartes.',                            'ventes', 5,   6, 0, 100,  381),
  ('ven-25',  'ventes', 'Commerçant',              'Vends 25 cartes.',                           'ventes', 25,  15, 0, 400, 382),
  ('ven-100', 'ventes', 'Magnat du marché',        'Vends 100 cartes.',                          'ventes', 100, 50, 0, 2000, 383),
  ('ach-1',   'achats', 'Premier achat',           'Achète une carte sur le marché.',            'achats', 1,   3, 0, 30,   385),
  ('ach-5',   'achats', 'Acheteur avisé',          'Achète 5 cartes.',                           'achats', 5,   6, 0, 100,  386),
  ('ach-25',  'achats', 'Gros client',             'Achète 25 cartes.',                          'achats', 25,  15, 0, 400, 387),
  ('ach-100', 'achats', 'Collectionneur compulsif', 'Achète 100 cartes.',                        'achats', 100, 50, 0, 2000, 388),
  -- Les doublons
  ('dbl-10',  'doublons', 'Des doubles',           'Possède 10 doublons.',                       'doublons', 10,  2, 0, 30,   390),
  ('dbl-50',  'doublons', 'Stock de doublons',     'Possède 50 doublons.',                       'doublons', 50,  5, 0, 100,  391),
  ('dbl-200', 'doublons', 'Entrepôt',              'Possède 200 doublons.',                      'doublons', 200, 12, 0, 300, 392),
  ('dbl-500', 'doublons', 'Réserve infinie',       'Possède 500 doublons.',                      'doublons', 500, 30, 0, 800, 393),
  -- Les Wave Coins investis dans les améliorations
  ('dep-100',   'depenses', 'Premier investissement', 'Dépense 100 Wave Coins en améliorations.',   'wc_depenses', 100,   2, 0, 0,   395),
  ('dep-1000',  'depenses', 'Sérieux',                'Dépense 1 000 Wave Coins en améliorations.', 'wc_depenses', 1000,  6, 0, 0,   396),
  ('dep-10000', 'depenses', 'Gros budget',            'Dépense 10 000 Wave Coins en améliorations.', 'wc_depenses', 10000, 20, 0, 0, 397),
  ('dep-50000', 'depenses', 'Mécène',                 'Dépense 50 000 Wave Coins en améliorations.', 'wc_depenses', 50000, 60, 0, 0, 398),
  -- Les familles qui existent déjà, avec des paliers plus hauts
  ('ouv-5000',  'ouvertures', 'Pressage infini',    'Ouvre 5 000 packs.',                        'ouvertures', 5000,  500, 0, 500,  108),
  ('ouv-10000', 'ouvertures', 'Usine de pressage',  'Ouvre 10 000 packs.',                       'ouvertures', 10000, 1000, 0, 1500, 109),
  ('holo-50',   'holos', 'Prisme',                  'Obtiens 50 cartes holo.',                   'holos', 50,  200, 0, 300,  125),
  ('holo-100',  'holos', 'Hologramme vivant',       'Obtiens 100 cartes holo.',                  'holos', 100, 400, 0, 800,  126),
  ('serie-60',  'serie', 'Deux mois',               'Joue 60 jours d''affilée.',                 'serie_max', 60,  200, 0, 500,  224),
  ('serie-100', 'serie', 'Cent jours',              'Joue 100 jours d''affilée.',                'serie_max', 100, 400, 0, 1200, 225),
  ('mis-500',   'missions', 'Increvable',           'Termine 500 missions.',                     'missions', 500,  250, 0, 500,  234),
  ('mis-1000',  'missions', 'Légende des missions', 'Termine 1 000 missions.',                   'missions', 1000, 500, 0, 1500, 235),
  ('niv-75',    'niveau', 'Niveau 75',              'Atteins le niveau 75.',                     'niveau', 75,  400, 0, 800,  186),
  ('niv-100',   'niveau', 'Niveau 100',             'Atteins le niveau 100.',                    'niveau', 100, 800, 0, 2000, 187),
  ('roue-250',  'roues', 'Maître de la roue',       'Tourne 250 fois la roue.',                  'roues', 250, 250, 0, 500, 214)
on conflict (id) do update set famille = excluded.famille, nom = excluded.nom, description = excluded.description, metrique = excluded.metrique,
  seuil = excluded.seuil, tirages = excluded.tirages, vinyles = excluded.vinyles, wc = excluded.wc, ordre = excluded.ordre;

revoke all on function public.jeu_metriques(uuid) from public, anon, authenticated;
revoke all on function public.jeu_succes(), public.jeu_succes_prendre(text) from public, anon;
grant execute on function public.jeu_succes(), public.jeu_succes_prendre(text) to authenticated;
