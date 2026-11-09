-- Wave Cards : le combat simplifié (2026-11-09).
--   1. Une seule Tour, la « classique », sur 1000 étages (un gardien tous les 10 étages). Les 3 autres difficultés sont désactivées.
--   2. Les récompenses (première victoire de chaque étage) sont recalculées pour 1000 étages.
--   3. Les statistiques d'une carte ne dépendent plus des IV de l'exemplaire : la rareté seulement. Les IV restent en base, intacts.
--   4. Les anciens modes (arène, défi, duels, quêtes, rivaux, prestige…) ne sont plus appelables par les joueurs.
-- La progression déjà enregistrée (combat_tour_progres, difficulté « classique ») reste telle quelle : le joueur reprend à son étage.
-- Sans danger si on le repasse.

-- 1. La Tour : une seule difficulté, 1000 étages
update public.combat_tour_difficultes set
  etages = 1000, bonus_base = -15, bonus_etage = 0.12, bonus_gardien = 10, rarete_plus = 0, mult_wc = 1, mult_vinyles = 1, deblocage_etage = 0, actif = true, ordre = 1,
  nom = 'La Tour', resume = 'Mille étages, un gardien tous les dix : des artistes de plus en plus connus.'
 where id = 'classique';
update public.combat_tour_difficultes set actif = false where id <> 'classique';
delete from public.combat_tour_progres where difficulte <> 'classique';

-- 2. Les récompenses : de 1 à 11 Wave Coins par étage, +10 au gardien ; un vinyle tous les 50 étages (de 1 à 5)
create or replace function public.combat_tour_recompense(p_diff text, p_etage integer) returns jsonb
language plpgsql stable set search_path to 'public' as $$
declare d public.combat_tour_difficultes; v_wc integer; v_vin integer := 0;
begin
  select * into d from public.combat_tour_difficultes where id = p_diff;
  if not found then return jsonb_build_object('vinyles', 0, 'wc', 0); end if;
  v_wc := greatest(1, round(d.mult_wc * (1 + p_etage / 100.0))::integer);
  if p_etage % 10 = 0 then v_wc := v_wc + round(d.mult_wc * 10)::integer; end if;
  if p_etage % 50 = 0 then v_vin := greatest(1, round(d.mult_vinyles * (1 + p_etage / 250))::integer); end if;
  return jsonb_build_object('vinyles', v_vin, 'wc', v_wc);
end $$;

-- 3. L'identité d'une carte : statistiques = base de l'artiste × rareté (plus aucun IV)
create or replace function public.combat_identite(p_artist uuid, p_rarete integer, p_holo boolean, p_sans boolean default false, p_booster text default null, p_user uuid default null) returns jsonb
language plpgsql stable set search_path to 'public' as $$
declare
  c public.jeu_cartes; s public.combat_surcharges; ro public.combat_roles; v_role text;
  al public.jeu_albums; ti jsonb; rmax bigint; v_alb jsonb;
  n numeric; m numeric; hm numeric; h numeric; v_pv integer; v_pui integer; v_def integer; v_vit integer;
  b_pv integer; b_pui integer; b_def integer; b_vit integer;
  ids text[]; tid text; titres jsonb := '[]'::jsonb; sl integer; cp text; jc jsonb; v_nom text; v_mult numeric;
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

  n := greatest(0, least(1, (log(greatest(c.fans, 1000)::numeric) - 5.5) / 1.6));
  m := case when p_rarete <= 1 then 1 when p_rarete = 2 then 1.08 when p_rarete = 3 then 1.18 when p_rarete = 4 then 1.3 when p_rarete = 5 then 1.45 else 1.6 end;
  hm := case when p_holo then 1.06 else 1 end;
  h := (abs(hashtext(p_artist::text || 'vit')) % 1000) / 1000.0;
  b_pv  := coalesce(s.pv,  round((80 + 50 * n) * ro.m_pv));
  b_pui := coalesce(s.pui, round((45 + 25 * n) * ro.m_pui));
  b_def := coalesce(s.def, round((40 + 25 * n) * ro.m_def));
  b_vit := coalesce(s.vit, round((45 + 50 * h) * ro.m_vit));
  v_pv  := round(b_pv * m * hm);
  v_pui := round(b_pui * m * hm);
  v_def := round(b_def * m * hm);
  v_vit := round(b_vit * hm);

  -- Les attaques : les titres choisis de l'album (puissance de 0,9 à 1,1 selon la popularité du titre), sinon des noms par défaut
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
    'role', i ->> 'role', 'role_nom', i ->> 'role_nom',
    'pv', round((i ->> 'pv')::numeric * k), 'pv_max', round((i ->> 'pv')::numeric * k), 'pui', round((i ->> 'pui')::numeric * k),
    'def', round((i ->> 'def')::numeric * k), 'vit', round((i ->> 'vit')::numeric * k),
    'titres', i -> 'titres', 'capacite', i -> 'capacite');
end $$;

-- 4. La Tour : plus de difficultés, les fonctions ne prennent plus que l'étage
drop function if exists public.combat_tour_equipe(text, integer);
drop function if exists public.combat_tour_accueil();
drop function if exists public.combat_tour_lancer(text, integer, jsonb);
drop function if exists public.combat_tour_debloque(uuid, text);

-- Les adversaires d'un étage : une équipe de la même taille, des artistes de plus en plus connus
create or replace function public.combat_tour_equipe(p_etage integer) returns jsonb
language plpgsql stable set search_path to 'public' as $$
declare
  d public.combat_tour_difficultes; n integer; frac numeric; centre integer; marge integer; v_k integer; v_t integer := public.combat_equipe_taille();
  v_rangs integer[] := '{}'; v_r integer; v_gardien boolean; v_rar integer; v_bonus integer; v_decor text; v_crew jsonb := '[]'::jsonb; v_guard integer := 0;
begin
  select * into d from public.combat_tour_difficultes where id = 'classique' and actif;
  if not found then raise exception 'La Tour est fermée.'; end if;
  if p_etage is null or p_etage < 1 or p_etage > d.etages then raise exception 'Cet étage n''existe pas.'; end if;
  select count(*) into n from public.jeu_cartes where active;
  if n < v_t + 2 then raise exception 'Pas assez d''artistes pour bâtir la Tour.'; end if;
  v_gardien := p_etage % 10 = 0;
  frac := case when d.etages > 1 then (p_etage - 1)::numeric / (d.etages - 1) else 1 end;
  centre := 1 + round(power(1 - frac, 1.6) * (n - 1))::integer;
  if v_gardien then centre := greatest(1, round(centre * 0.6)::integer); end if;
  marge := greatest(3, n / 40);
  for v_k in 1..v_t loop
    v_r := least(n, greatest(1, centre + (abs(hashtext(d.id || ':' || p_etage || ':' || v_k)::bigint) % (2 * marge + 1))::integer - marge));
    while v_r = any (v_rangs) and v_guard < 500 loop v_r := case when v_r < n then v_r + 1 else 1 end; v_guard := v_guard + 1; end loop;
    v_rangs := v_rangs || v_r;
  end loop;
  v_rar := least(5, 1 + floor(frac * 4)::integer + d.rarete_plus + case when v_gardien then 1 else 0 end);
  v_bonus := round(d.bonus_base + d.bonus_etage * p_etage + case when v_gardien then d.bonus_gardien else 0 end)::integer;
  v_decor := case when v_gardien then (case when p_etage % 20 = 0 then 'toit' else 'concert' end)
                  else (array['ruelle', 'studio', 'plateau'])[1 + ((p_etage - 1) / 10) % 3] end;
  foreach v_r in array v_rangs loop
    v_crew := v_crew || public.combat_unite(public.combat_pve_artiste(v_r), v_rar, false, v_bonus);
  end loop;
  return jsonb_build_object('etage', p_etage, 'gardien', v_gardien, 'decor', v_decor, 'bonus', v_bonus, 'rarete', v_rar,
    'nom', case when v_gardien then 'Gardien du palier ' || p_etage else 'Étage ' || p_etage end, 'crew', v_crew);
end $$;

-- L'accueil : où j'en suis, l'étage à gravir avec ses adversaires, les cinq prochains gardiens, ma dernière équipe
create or replace function public.combat_tour_accueil() returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid(); d public.combat_tour_difficultes; p public.combat_tour_progres; v_max integer; v_pro jsonb;
begin
  if v_uid is null then raise exception 'Connecte-toi.'; end if;
  perform public.jeu_joueur_assurer(v_uid);
  select * into d from public.combat_tour_difficultes where id = 'classique' and actif;
  if not found then raise exception 'La Tour est fermée.'; end if;
  select * into p from public.combat_tour_progres where user_id = v_uid and difficulte = d.id;
  v_max := coalesce(p.etage_max, 0);
  if v_max < d.etages then
    v_pro := public.combat_tour_equipe(v_max + 1);
    v_pro := (v_pro - 'crew') || jsonb_build_object(
      'crew', (select jsonb_agg(u - 'titres' - 'capacite') from jsonb_array_elements(v_pro -> 'crew') u),
      'recompense', public.combat_tour_recompense(d.id, v_max + 1));
  end if;
  return jsonb_build_object(
    'taille', public.combat_equipe_taille(), 'etages', d.etages, 'etage_max', v_max,
    'victoires', coalesce(p.victoires, 0), 'defaites', coalesce(p.defaites, 0),
    'prochain', v_pro,
    'gardiens', (select coalesce(jsonb_agg(jsonb_build_object('etage', g, 'recompense', public.combat_tour_recompense(d.id, g)) order by g), '[]'::jsonb)
                   from (select g from generate_series(((v_max / 10) + 1) * 10, d.etages, 10) g limit 5) q),
    'equipe', (select coalesce(jsonb_agg(jsonb_build_object('booster', e.booster_id, 'artist', e.artist_id, 'holo', e.holo) order by e.slot), '[]'::jsonb)
                 from public.combat_equipes e where e.user_id = v_uid and e.role = 'principal'));
end $$;

-- Lancer un combat (p_etage vide = l'étage suivant) : l'équipe est vérifiée, le combat simulé, la progression et les récompenses données (première victoire d'un étage)
create or replace function public.combat_tour_lancer(p_etage integer, p_equipe jsonb) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid(); d public.combat_tour_difficultes; v_max integer; v_etage integer; v_info jsonb; v_mine jsonb; v_sim jsonb; v_vic boolean;
  v_wc integer := 0; v_vin integer := 0; rec jsonb; v_gains jsonb := '{}'::jsonb; v_prem boolean := false; i integer;
begin
  if v_uid is null then raise exception 'Connecte-toi.'; end if;
  perform public.jeu_joueur_assurer(v_uid);
  select * into d from public.combat_tour_difficultes where id = 'classique' and actif;
  if not found then raise exception 'La Tour est fermée.'; end if;
  insert into public.combat_tour_progres (user_id, difficulte) values (v_uid, d.id) on conflict (user_id, difficulte) do nothing;
  select etage_max into v_max from public.combat_tour_progres where user_id = v_uid and difficulte = d.id for update;
  v_max := coalesce(v_max, 0);
  v_etage := coalesce(p_etage, v_max + 1);
  if v_etage < 1 or v_etage > d.etages then raise exception 'Cet étage n''existe pas.'; end if;
  if v_etage > v_max + 1 then raise exception 'Gravis d''abord l''étage %.', v_max + 1; end if;

  v_mine := public.combat_equipe_unites(v_uid, p_equipe);
  v_info := public.combat_tour_equipe(v_etage);
  v_sim := public.combat_auto_simuler(v_mine, v_info -> 'crew');
  v_vic := v_sim ->> 'gagnant' = 'a';

  delete from public.combat_equipes where user_id = v_uid and role = 'principal';
  for i in 0..jsonb_array_length(p_equipe) - 1 loop
    insert into public.combat_equipes (user_id, role, slot, booster_id, artist_id, holo)
    values (v_uid, 'principal', (i + 1)::smallint, p_equipe -> i ->> 'booster', (p_equipe -> i ->> 'artist')::uuid, coalesce((p_equipe -> i ->> 'holo')::boolean, false));
  end loop;

  update public.combat_tour_progres set victoires = victoires + case when v_vic then 1 else 0 end, defaites = defaites + case when v_vic then 0 else 1 end, maj = now()
   where user_id = v_uid and difficulte = d.id;
  if v_vic and v_etage > v_max then
    v_prem := true;
    update public.combat_tour_progres set etage_max = v_etage, maj = now() where user_id = v_uid and difficulte = d.id;
    rec := public.combat_tour_recompense(d.id, v_etage);
    v_vin := (rec ->> 'vinyles')::integer;
    v_wc := (rec ->> 'wc')::integer;
    if v_wc > 0 then v_wc := public.wc_crediter(v_uid, v_wc, 'pve:tour:' || d.id, v_etage::text); end if;
    if v_vin > 0 then perform public.jeu_crediter(v_uid, v_vin, 0, 0); end if;
    v_gains := jsonb_build_object('vinyles', v_vin, 'wc', v_wc);
  end if;

  return jsonb_build_object('victoire', v_vic, 'premiere', v_prem, 'gains', v_gains, 'etage', v_etage,
    'etage_max', greatest(v_max, case when v_vic then v_etage else 0 end), 'etages', d.etages, 'gardien', v_info -> 'gardien', 'nom', v_info ->> 'nom', 'decor', v_info ->> 'decor',
    'a', v_mine, 'b', v_info -> 'crew', 'tours', v_sim -> 'tours', 'evenements', v_sim -> 'evenements', 'etat', public.jeu_etat_json(v_uid));
end $$;

-- Mes cartes pour composer l'équipe : une ligne par carte possédée, statistiques de rareté (plus d'IV)
create or replace function public.combat_tour_cartes() returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg((public.combat_identite(col.artist_id, bc.rarete, col.holo, false, col.booster_id) - 'surcharge' - 'base')
                     || jsonb_build_object('booster', col.booster_id, 'booster_nom', bo.nom, 'numero', bc.numero, 'quantite', col.quantite)
                     order by bc.rarete desc, c.fans desc)
      from public.jeu_collection_b col
      join public.jeu_boosters bo on bo.id = col.booster_id and bo.classeur and bo.actif
      join public.jeu_booster_cartes bc on bc.booster_id = col.booster_id and bc.artist_id = col.artist_id
      join public.jeu_cartes c on c.artist_id = col.artist_id and c.active
     where col.user_id = v_uid and col.quantite > 0), '[]'::jsonb);
end $$;

revoke all on function public.combat_tour_equipe(integer), public.combat_tour_accueil(), public.combat_tour_lancer(integer, jsonb), public.combat_tour_cartes() from public, anon;
grant execute on function public.combat_tour_accueil(), public.combat_tour_lancer(integer, jsonb), public.combat_tour_cartes() to authenticated;

-- 5. Les anciens modes (arène, défi du jour, duels, quêtes, rivaux, prestige…) ne sont plus appelables par les joueurs
--    (les tables et le moteur restent en base ; le panneau de l'équipe garde ses fonctions combat_equipe_* et combat_pve_equipe_*).
do $$
declare f text; o regprocedure;
begin
  foreach f in array array[
    'combat_lancer', 'combat_avancer', 'combat_abandonner', 'combat_en_cours', 'combat_accueil', 'combat_adversaires', 'combat_classement', 'combat_historique',
    'combat_duo_enregistrer', 'combat_duo_sauver', 'combat_duo_supprimer', 'combat_duos_lire', 'combat_mes_cartes',
    'combat_pve_accueil', 'combat_pve_tour', 'combat_pve_champion', 'combat_pve_ligue',
    'combat_quete_accueil', 'combat_quete_faille', 'combat_quete_faille_acheter', 'combat_quete_tresor',
    'combat_rivaux_accueil', 'combat_rivaux_duel', 'combat_prestige_accueil', 'combat_prestige_duel', 'combat_prestige_renaitre']
  loop
    for o in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = f loop
      execute format('revoke execute on function %s from public, anon, authenticated', o);
    end loop;
  end loop;
end $$;
