-- Wave Cards : le combat 2v2 — les fonctions de jeu (2026-10-27).
-- Appelées par combat.js (les joueurs) ; s'appuient sur le moteur (sql/combat-moteur.sql). Tout est calculé ici : un combat est
-- une ligne de combat_parties, un tour = un appel à combat_tour, les gains et les trophées sont versés à la fin.
-- Économie (1 vinyle = 1 ouverture de pack) : première victoire sur chaque palier de l'Arène (1 à 4 vinyles), défi du jour
-- (2 vinyles, une fois par jour), victoires PvP (1 vinyle) ; défi du jour + PvP plafonnés à 5 vinyles par jour.
-- PvP : classement par trophées (ELO, K = 28), saison mensuelle (les trophées reviennent à mi-chemin de 1000), 10 défis par jour.

create or replace function public.combat_saison() returns text language sql stable set search_path to 'public' as
$$ select to_char(public.xp_jour(), 'YYYY-MM') $$;

-- La fiche de combat d'un joueur (créée au premier besoin, saison et jour remis à jour).
create or replace function public.combat_joueur_assurer(p_user uuid) returns public.combat_joueurs
language plpgsql security definer set search_path to 'public' as $$
declare j public.combat_joueurs; v_jour date := public.xp_jour(); v_saison text := public.combat_saison();
begin
  insert into public.combat_joueurs (user_id, saison, jour) values (p_user, v_saison, v_jour) on conflict (user_id) do nothing;
  select * into j from public.combat_joueurs where user_id = p_user for update;
  if j.saison is distinct from v_saison then
    update public.combat_joueurs
       set saison = v_saison, trophees = 1000 + round((trophees - 1000) / 2.0)::integer,
           victoires = 0, defaites = 0, serie = 0, defenses_gagnees = 0, defenses_perdues = 0
     where user_id = p_user;
  end if;
  if j.jour is distinct from v_jour then
    update public.combat_joueurs set jour = v_jour, vinyles_jour = 0, pvp_jour = 0 where user_id = p_user;
  end if;
  select * into j from public.combat_joueurs where user_id = p_user;
  return j;
end $$;

-- Le duo enregistré d'un joueur, au format attendu par combat_duo_unites : [{booster, artist, holo}].
create or replace function public.combat_duo_json(p_user uuid, p_role text) returns jsonb
language sql stable security definer set search_path to 'public' as
$$ select coalesce(jsonb_agg(jsonb_build_object('booster', booster_id, 'artist', artist_id, 'holo', holo) order by slot), '[]'::jsonb)
     from public.combat_equipes where user_id = p_user and role = p_role $$;

-- Vérifie un duo (2 cartes différentes, que le joueur possède) et renvoie ses 2 unités prêtes à combattre.
create or replace function public.combat_duo_unites(p_user uuid, p_duo jsonb) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare r jsonb := '[]'::jsonb; d jsonb; v_b text; v_a uuid; v_h boolean; v_r integer; v_n integer; v_seen text[] := '{}'; v_key text;
begin
  if p_duo is null or jsonb_typeof(p_duo) <> 'array' or jsonb_array_length(p_duo) <> 2 then raise exception 'Choisis exactement 2 cartes.'; end if;
  for d in select value from jsonb_array_elements(p_duo) loop
    v_b := d ->> 'booster';
    begin v_a := (d ->> 'artist')::uuid; exception when others then raise exception 'Carte invalide.'; end;
    v_h := coalesce((d ->> 'holo')::boolean, false);
    v_key := coalesce(v_b, '') || v_a::text;
    if v_key = any (v_seen) then raise exception 'Choisis deux cartes différentes.'; end if;
    v_seen := v_seen || v_key;
    select bc.rarete, bc.numero into v_r, v_n
      from public.jeu_booster_cartes bc join public.jeu_boosters bo on bo.id = bc.booster_id and bo.classeur
     where bc.booster_id = v_b and bc.artist_id = v_a;
    if not found then raise exception 'Cette carte n''existe pas.'; end if;
    if not exists (select 1 from public.jeu_collection_b where user_id = p_user and booster_id = v_b and artist_id = v_a and holo = v_h and quantite > 0) then
      raise exception 'Tu ne possèdes pas cette carte.';
    end if;
    r := r || (public.combat_unite(v_a, v_r, v_h) || jsonb_build_object('booster', v_b, 'numero', v_n));
  end loop;
  return r;
end $$;

-- Un duo « à l'affichage » : l'identité de chaque carte encore possédée.
create or replace function public.combat_duo_infos(p_user uuid, p_role text) returns jsonb
language sql stable security definer set search_path to 'public' as
$$ select coalesce(jsonb_agg((public.combat_identite(e.artist_id, bc.rarete, e.holo) - 'surcharge')
                             || jsonb_build_object('booster', e.booster_id, 'numero', bc.numero) order by e.slot), '[]'::jsonb)
     from public.combat_equipes e
     join public.jeu_booster_cartes bc on bc.booster_id = e.booster_id and bc.artist_id = e.artist_id
     join public.jeu_collection_b col on col.user_id = e.user_id and col.booster_id = e.booster_id and col.artist_id = e.artist_id and col.holo = e.holo and col.quantite > 0
    where e.user_id = p_user and e.role = p_role $$;

-- Le défi du jour : un style mis en avant, un duo tiré parmi les cartes des classeurs (de ce style d'abord).
create or replace function public.combat_defi(p_jour date) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare v_type public.combat_types; v_crew jsonb := '[]'::jsonb; x record; v_nb integer;
begin
  select count(*) into v_nb from public.combat_types;
  select * into v_type from public.combat_types order by ordre offset ((p_jour - date '2026-01-01') % v_nb + v_nb) % v_nb limit 1;
  for x in
    select s.artist_id, s.rarete from (
      select distinct on (bc.artist_id) bc.artist_id, bc.rarete
        from public.jeu_booster_cartes bc join public.jeu_boosters bo on bo.id = bc.booster_id and bo.classeur and bo.actif
        join public.jeu_cartes c on c.artist_id = bc.artist_id and c.active
       order by bc.artist_id, bc.rarete desc) s
     order by (public.combat_type_de(s.artist_id) = v_type.id) desc, md5(s.artist_id::text || p_jour::text) limit 2
  loop
    v_crew := v_crew || public.combat_unite(x.artist_id, x.rarete, false, 10);
  end loop;
  return jsonb_build_object('jour', p_jour, 'type', v_type.id, 'type_nom', v_type.nom, 'couleur', v_type.couleur, 'crew', v_crew);
end $$;

create or replace function public.combat_partie_json(p_id uuid) returns jsonb
language sql stable security definer set search_path to 'public' as
$$ select jsonb_build_object('id', id, 'mode', mode, 'cible', cible, 'adversaire', adversaire, 'etat', etat, 'tour', tour,
          'unites', unites, 'journal', journal, 'max_tours', 20, 'gains', gains, 'trophees_delta', trophees_delta, 'debut', debut)
     from public.combat_parties where id = p_id $$;

-- Fin d'un combat : gains, trophées, statistiques. p_abandon : abandon ou expiration (défaite en PvP, rien ailleurs).
create or replace function public.combat_conclure(p_id uuid, p_victoire boolean, p_abandon boolean) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  p public.combat_parties; j public.combat_joueurs; d public.combat_joueurs; pal public.combat_arene;
  v_jour date := public.xp_jour(); v_gains jsonb := '{}'::jsonb; v_delta integer; v_nv integer; v_e numeric; v_gain integer;
  v_n integer; v_serie integer; v_plafond constant integer := 5; v_victoire boolean := p_victoire and not p_abandon;
begin
  select * into p from public.combat_parties where id = p_id for update;
  if not found or p.etat <> 'en_cours' then return jsonb_build_object('etat', coalesce(p.etat, 'inconnu')); end if;
  j := public.combat_joueur_assurer(p.user_id);
  v_nv := j.trophees;

  if p.mode = 'arene' and v_victoire then
    select * into pal from public.combat_arene where palier = p.cible::integer;
    insert into public.combat_progres (user_id, palier) values (p.user_id, pal.palier) on conflict do nothing;
    get diagnostics v_n = row_count;
    if v_n > 0 and pal.recompense > 0 then
      perform public.jeu_crediter(p.user_id, pal.recompense, 0, 0);
      v_gains := jsonb_build_object('vinyles', pal.recompense, 'premiere', true);
    end if;

  elsif p.mode = 'defi' and v_victoire and j.defi_jour is distinct from v_jour then
    v_gain := greatest(0, least(2, v_plafond - j.vinyles_jour));
    update public.combat_joueurs set defi_jour = v_jour, vinyles_jour = vinyles_jour + v_gain where user_id = p.user_id;
    if v_gain > 0 then
      perform public.jeu_crediter(p.user_id, v_gain, 0, 0);
      v_gains := jsonb_build_object('vinyles', v_gain, 'premiere', true);
    end if;

  elsif p.mode = 'pvp' and p.defenseur is not null then
    d := public.combat_joueur_assurer(p.defenseur);
    v_e := 1 / (1 + power(10, (d.trophees - j.trophees) / 400.0));
    v_delta := round(28 * ((case when v_victoire then 1 else 0 end) - v_e))::integer;
    if v_victoire then v_delta := greatest(v_delta, 4); else v_delta := least(v_delta, -4); end if;
    v_nv := greatest(0, j.trophees + v_delta);
    v_delta := v_nv - j.trophees;
    update public.combat_joueurs
       set trophees = greatest(0, trophees + case when v_victoire then -ceil(abs(v_delta) / 2.0)::integer else ceil(abs(v_delta) / 2.0)::integer end),
           defenses_gagnees = defenses_gagnees + case when v_victoire then 0 else 1 end,
           defenses_perdues = defenses_perdues + case when v_victoire then 1 else 0 end
     where user_id = p.defenseur;
    if v_victoire then
      v_gain := greatest(0, least(1, v_plafond - j.vinyles_jour));
      if v_gain > 0 then
        update public.combat_joueurs set vinyles_jour = vinyles_jour + v_gain where user_id = p.user_id;
        perform public.jeu_crediter(p.user_id, v_gain, 0, 0);
        v_gains := jsonb_build_object('vinyles', v_gain);
      end if;
    end if;
  end if;

  if p.mode <> 'entrainement' and (not p_abandon or p.mode = 'pvp') then
    v_serie := case when v_victoire then j.serie + 1 else 0 end;
    update public.combat_joueurs
       set victoires = victoires + case when v_victoire then 1 else 0 end,
           defaites = defaites + case when v_victoire then 0 else 1 end,
           serie = v_serie, meilleure_serie = greatest(meilleure_serie, v_serie),
           trophees = v_nv
     where user_id = p.user_id;
  end if;

  update public.combat_parties
     set etat = case when p_abandon then 'abandon' when v_victoire then 'victoire' else 'defaite' end, fin = now(), maj = now(),
         gains = v_gains, trophees_delta = case when p.mode = 'pvp' then v_nv - j.trophees end
   where id = p_id;
  return jsonb_build_object('etat', case when p_abandon then 'abandon' when v_victoire then 'victoire' else 'defaite' end,
                            'gains', v_gains, 'trophees_delta', case when p.mode = 'pvp' then v_nv - j.trophees end, 'trophees', v_nv);
end $$;

-- Ferme les combats restés en plan depuis plus d'une demi-heure.
create or replace function public.combat_expirer(p_user uuid) returns void
language plpgsql security definer set search_path to 'public' as $$
declare x uuid;
begin
  for x in select id from public.combat_parties where user_id = p_user and etat = 'en_cours' and maj < now() - interval '30 minutes' loop
    perform public.combat_conclure(x, false, true);
  end loop;
end $$;

-- Lance un combat. p_mode : arene (p_cible = palier), defi, pvp (p_cible = identifiant du joueur), entrainement.
create or replace function public.combat_lancer(p_mode text, p_cible text, p_duo jsonb) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid(); j public.combat_joueurs; v_mine jsonb; v_opp jsonb := '[]'::jsonb; v_nom text; v_def uuid; pal public.combat_arene;
  v_info jsonb; v_id uuid; v_rar integer; x record; v_cible text := p_cible;
begin
  if v_uid is null then raise exception 'Connecte-toi.'; end if;
  perform public.jeu_joueur_assurer(v_uid);
  perform public.combat_expirer(v_uid);
  j := public.combat_joueur_assurer(v_uid);
  if exists (select 1 from public.combat_parties where user_id = v_uid and etat = 'en_cours') then raise exception 'Un combat est déjà en cours.'; end if;
  v_mine := public.combat_duo_unites(v_uid, p_duo);

  if p_mode = 'arene' then
    begin select * into pal from public.combat_arene where palier = p_cible::integer; exception when others then raise exception 'Palier inconnu.'; end;
    if pal.palier is null then raise exception 'Palier inconnu.'; end if;
    if pal.palier > 1 and not exists (select 1 from public.combat_progres where user_id = v_uid and palier = pal.palier - 1) then
      raise exception 'Bats d''abord le palier précédent.';
    end if;
    v_opp := jsonb_build_array(public.combat_unite(pal.artist1, pal.rarete1, false, pal.bonus), public.combat_unite(pal.artist2, pal.rarete2, false, pal.bonus));
    v_nom := pal.nom;
  elsif p_mode = 'defi' then
    v_info := public.combat_defi(public.xp_jour());
    v_opp := v_info -> 'crew';
    v_nom := 'Défi du jour · ' || (v_info ->> 'type_nom');
    v_cible := null;
  elsif p_mode = 'pvp' then
    begin v_def := p_cible::uuid; exception when others then raise exception 'Adversaire inconnu.'; end;
    if v_def = v_uid then raise exception 'Tu ne peux pas t''affronter toi-même.'; end if;
    if j.pvp_jour >= 10 then raise exception 'Tu as atteint la limite de 10 défis par jour.'; end if;
    select pseudo into v_nom from public.profiles where id = v_def;
    if v_nom is null then raise exception 'Adversaire inconnu.'; end if;
    begin v_opp := public.combat_duo_unites(v_def, public.combat_duo_json(v_def, 'defense'));
    exception when others then raise exception 'Ce joueur n''a pas de duo de défense valide pour le moment.'; end;
    update public.combat_joueurs set pvp_jour = pvp_jour + 1 where user_id = v_uid;
  elsif p_mode = 'entrainement' then
    select round(avg((u ->> 'rarete')::numeric))::integer into v_rar from jsonb_array_elements(v_mine) u;
    for x in
      select s.artist_id, s.rarete from (
        select distinct on (bc.artist_id) bc.artist_id, bc.rarete
          from public.jeu_booster_cartes bc join public.jeu_boosters bo on bo.id = bc.booster_id and bo.classeur and bo.actif
          join public.jeu_cartes c on c.artist_id = bc.artist_id and c.active
         where bc.rarete between v_rar - 1 and v_rar + 1
         order by bc.artist_id, bc.rarete) s
       order by random() limit 2
    loop
      v_opp := v_opp || public.combat_unite(x.artist_id, x.rarete, false, 0);
    end loop;
    if jsonb_array_length(v_opp) < 2 then raise exception 'Pas d''adversaire d''entraînement pour le moment.'; end if;
    v_nom := 'Entraînement';
    v_cible := null;
  else
    raise exception 'Mode de combat inconnu.';
  end if;

  delete from public.combat_equipes where user_id = v_uid and role = 'principal';
  insert into public.combat_equipes (user_id, role, slot, booster_id, artist_id, holo)
  select v_uid, 'principal', (ord)::smallint, d ->> 'booster', (d ->> 'artist')::uuid, coalesce((d ->> 'holo')::boolean, false)
    from jsonb_array_elements(p_duo) with ordinality as t (d, ord);

  insert into public.combat_parties (user_id, mode, cible, adversaire, defenseur, unites)
  values (v_uid, p_mode, v_cible, v_nom, v_def, public.combat_assembler(v_mine, v_opp))
  returning id into v_id;
  return public.combat_partie_json(v_id);
end $$;

-- Joue un tour. p_actions : [{u, a, c}] — l'unité (0 ou 1), l'attaque (0 ou 1), la cible (indice d'unité).
create or replace function public.combat_tour(p_id uuid, p_actions jsonb) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); p public.combat_parties; r jsonb; v_res jsonb;
begin
  if v_uid is null then raise exception 'Connecte-toi.'; end if;
  select * into p from public.combat_parties where id = p_id and user_id = v_uid for update;
  if not found then raise exception 'Combat introuvable.'; end if;
  if p.etat <> 'en_cours' then raise exception 'Ce combat est terminé.'; end if;
  if p.maj < now() - interval '30 minutes' then
    perform public.combat_conclure(p.id, false, true);
    return jsonb_build_object('expire', true);
  end if;
  r := public.combat_moteur(p.unites, p_actions, p.tour);
  update public.combat_parties
     set unites = r -> 'u', tour = (r ->> 'tour')::integer, maj = now(),
         journal = journal || jsonb_build_array(jsonb_build_object('tour', p.tour, 'ev', r -> 'ev'))
   where id = p.id;
  v_res := jsonb_build_object('evenements', r -> 'ev', 'unites', r -> 'u', 'tour', (r ->> 'tour')::integer, 'tour_joue', p.tour,
                              'fini', (r ->> 'fini')::boolean, 'vainqueur', r -> 'vainqueur');
  if (r ->> 'fini')::boolean then
    v_res := v_res || public.combat_conclure(p.id, (r ->> 'vainqueur') = '0', false);
  end if;
  return v_res;
end $$;

create or replace function public.combat_abandonner(p_id uuid) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Connecte-toi.'; end if;
  if not exists (select 1 from public.combat_parties where id = p_id and user_id = v_uid and etat = 'en_cours') then raise exception 'Combat introuvable.'; end if;
  return public.combat_conclure(p_id, false, true);
end $$;

-- Le combat en cours, s'il y en a un (pour le reprendre après un rechargement).
create or replace function public.combat_en_cours() returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); v_id uuid;
begin
  if v_uid is null then return null; end if;
  perform public.combat_expirer(v_uid);
  select id into v_id from public.combat_parties where user_id = v_uid and etat = 'en_cours';
  if v_id is null then return null; end if;
  return public.combat_partie_json(v_id);
end $$;

-- Les cartes que le joueur peut engager : chaque exemplaire possédé (normal ou holo), avec son identité de combat.
create or replace function public.combat_mes_cartes() returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg((public.combat_identite(col.artist_id, bc.rarete, col.holo) - 'surcharge')
                     || jsonb_build_object('booster', col.booster_id, 'booster_nom', bo.nom, 'numero', bc.numero, 'quantite', col.quantite)
                     order by bc.rarete desc, c.fans desc)
      from public.jeu_collection_b col
      join public.jeu_boosters bo on bo.id = col.booster_id and bo.classeur and bo.actif
      join public.jeu_booster_cartes bc on bc.booster_id = col.booster_id and bc.artist_id = col.artist_id
      join public.jeu_cartes c on c.artist_id = col.artist_id and c.active
     where col.user_id = v_uid and col.quantite > 0), '[]'::jsonb);
end $$;

-- Enregistre le duo principal ou de défense.
create or replace function public.combat_duo_enregistrer(p_role text, p_duo jsonb) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Connecte-toi.'; end if;
  if p_role not in ('principal', 'defense') then raise exception 'Rôle inconnu.'; end if;
  perform public.jeu_joueur_assurer(v_uid);
  perform public.combat_duo_unites(v_uid, p_duo);
  delete from public.combat_equipes where user_id = v_uid and role = p_role;
  insert into public.combat_equipes (user_id, role, slot, booster_id, artist_id, holo)
  select v_uid, p_role, (ord)::smallint, d ->> 'booster', (d ->> 'artist')::uuid, coalesce((d ->> 'holo')::boolean, false)
    from jsonb_array_elements(p_duo) with ordinality as t (d, ord);
  perform public.combat_joueur_assurer(v_uid);
  return public.combat_duo_infos(v_uid, p_role);
end $$;

-- L'accueil du combat : mon rang, mes duos, l'Arène, le défi du jour, le combat en cours.
create or replace function public.combat_accueil() returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); j public.combat_joueurs; v_defi jsonb; v_arene jsonb; v_jour date := public.xp_jour();
begin
  if v_uid is null then raise exception 'Connecte-toi.'; end if;
  perform public.jeu_joueur_assurer(v_uid);
  perform public.combat_expirer(v_uid);
  j := public.combat_joueur_assurer(v_uid);
  v_defi := public.combat_defi(v_jour);
  select coalesce(jsonb_agg(jsonb_build_object(
           'palier', a.palier, 'nom', a.nom, 'description', a.description, 'bonus', a.bonus, 'recompense', a.recompense,
           'etat', case when exists (select 1 from public.combat_progres g where g.user_id = v_uid and g.palier = a.palier) then 'fait'
                        when a.palier = 1 or exists (select 1 from public.combat_progres g where g.user_id = v_uid and g.palier = a.palier - 1) then 'ouvert'
                        else 'verrouille' end,
           'crew', jsonb_build_array(public.combat_unite(a.artist1, a.rarete1, false, a.bonus) - 'attaques' - 'capacite',
                                     public.combat_unite(a.artist2, a.rarete2, false, a.bonus) - 'attaques' - 'capacite')) order by a.palier), '[]'::jsonb)
    into v_arene from public.combat_arene a;
  return jsonb_build_object(
    'moi', jsonb_build_object('trophees', j.trophees, 'victoires', j.victoires, 'defaites', j.defaites, 'serie', j.serie, 'meilleure_serie', j.meilleure_serie,
            'defenses_gagnees', j.defenses_gagnees, 'defenses_perdues', j.defenses_perdues, 'saison', j.saison,
            'saison_fin', (date_trunc('month', v_jour) + interval '1 month - 1 day')::date, 'vinyles_jour', j.vinyles_jour, 'plafond_jour', 5,
            'pvp_restants', greatest(0, 10 - j.pvp_jour),
            'rang', (select 1 + count(*) from public.combat_joueurs x where x.saison = j.saison and x.trophees > j.trophees and (x.victoires + x.defaites + x.defenses_gagnees + x.defenses_perdues) > 0)),
    'duo', public.combat_duo_infos(v_uid, 'principal'),
    'defense', public.combat_duo_infos(v_uid, 'defense'),
    'arene', v_arene,
    'defi', (v_defi - 'crew') || jsonb_build_object('recompense', 2, 'fait', j.defi_jour is not distinct from v_jour,
              'crew', (select jsonb_agg(u - 'attaques' - 'capacite') from jsonb_array_elements(v_defi -> 'crew') u)),
    'en_cours', (select public.combat_en_cours()));
end $$;

-- Les joueurs que je peux défier : ceux qui ont un duo de défense valide, les plus proches de mes trophées d'abord.
create or replace function public.combat_adversaires() returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); j public.combat_joueurs;
begin
  if v_uid is null then raise exception 'Connecte-toi.'; end if;
  perform public.jeu_joueur_assurer(v_uid);
  j := public.combat_joueur_assurer(v_uid);
  return coalesce((
    select jsonb_agg(s.x order by s.ecart) from (
      select jsonb_build_object('user_id', cj.user_id, 'pseudo', p.pseudo, 'avatar', p.avatar_url, 'trophees', cj.trophees,
               'duo', public.combat_duo_infos(cj.user_id, 'defense')) as x, abs(cj.trophees - j.trophees) as ecart
        from public.combat_joueurs cj join public.profiles p on p.id = cj.user_id
       where cj.user_id <> v_uid
         and (select count(*) from public.combat_equipes e
                join public.jeu_collection_b col on col.user_id = e.user_id and col.booster_id = e.booster_id and col.artist_id = e.artist_id and col.holo = e.holo and col.quantite > 0
               where e.user_id = cj.user_id and e.role = 'defense') = 2
       order by abs(cj.trophees - j.trophees) limit 10) s), '[]'::jsonb);
end $$;

create or replace function public.combat_classement() returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); j public.combat_joueurs;
begin
  if v_uid is null then raise exception 'Connecte-toi.'; end if;
  perform public.jeu_joueur_assurer(v_uid);
  j := public.combat_joueur_assurer(v_uid);
  return jsonb_build_object('saison', j.saison, 'liste', coalesce((
    select jsonb_agg(jsonb_build_object('rang', s.rang, 'user_id', s.user_id, 'pseudo', s.pseudo, 'avatar', s.avatar, 'trophees', s.trophees,
             'victoires', s.victoires, 'defaites', s.defaites, 'moi', s.user_id = v_uid) order by s.rang)
      from (select row_number() over (order by cj.trophees desc, cj.victoires desc, p.pseudo) as rang, cj.user_id, p.pseudo, p.avatar_url as avatar,
                   cj.trophees, cj.victoires, cj.defaites
              from public.combat_joueurs cj join public.profiles p on p.id = cj.user_id
             where cj.saison = j.saison and (cj.victoires + cj.defaites + cj.defenses_gagnees + cj.defenses_perdues) > 0
             order by cj.trophees desc, cj.victoires desc, p.pseudo limit 25) s), '[]'::jsonb));
end $$;

create or replace function public.combat_historique() returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Connecte-toi.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', h.id, 'mode', h.mode, 'adversaire', h.adversaire, 'etat', h.etat, 'tours', h.tour,
           'gains', h.gains, 'trophees_delta', h.trophees_delta, 'debut', h.debut,
           'duo', (select jsonb_agg(u ->> 'nom') from jsonb_array_elements(h.unites) u where (u ->> 'camp') = '0'),
           'face', (select jsonb_agg(u ->> 'nom') from jsonb_array_elements(h.unites) u where (u ->> 'camp') = '1')) order by h.debut desc)
      from (select * from public.combat_parties where user_id = v_uid and etat <> 'en_cours' order by debut desc limit 15) h), '[]'::jsonb);
end $$;

-- La fiche de combat d'une carte (pour la fiche de la collection).
create or replace function public.combat_carte(p_artist uuid, p_booster text default null, p_holo boolean default false) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare v_r integer;
begin
  if auth.uid() is null then raise exception 'Connecte-toi.'; end if;
  select bc.rarete into v_r from public.jeu_booster_cartes bc where bc.artist_id = p_artist and (p_booster is null or bc.booster_id = p_booster) order by bc.rarete desc limit 1;
  if v_r is null then select least(greatest(rarete, 1), 5) into v_r from public.jeu_cartes where artist_id = p_artist; end if;
  if v_r is null then raise exception 'Carte inconnue.'; end if;
  return public.combat_identite(p_artist, v_r, coalesce(p_holo, false)) - 'surcharge';
end $$;

revoke all on function public.combat_saison(), public.combat_joueur_assurer(uuid), public.combat_duo_json(uuid, text), public.combat_duo_unites(uuid, jsonb),
  public.combat_duo_infos(uuid, text), public.combat_defi(date), public.combat_partie_json(uuid), public.combat_conclure(uuid, boolean, boolean),
  public.combat_expirer(uuid) from public, anon, authenticated;

revoke all on function public.combat_lancer(text, text, jsonb), public.combat_tour(uuid, jsonb), public.combat_abandonner(uuid), public.combat_en_cours(),
  public.combat_mes_cartes(), public.combat_duo_enregistrer(text, jsonb), public.combat_accueil(), public.combat_adversaires(), public.combat_classement(),
  public.combat_historique(), public.combat_carte(uuid, text, boolean) from public, anon;
grant execute on function public.combat_lancer(text, text, jsonb), public.combat_tour(uuid, jsonb), public.combat_abandonner(uuid), public.combat_en_cours(),
  public.combat_mes_cartes(), public.combat_duo_enregistrer(text, jsonb), public.combat_accueil(), public.combat_adversaires(), public.combat_classement(),
  public.combat_historique(), public.combat_carte(uuid, text, boolean) to authenticated;
