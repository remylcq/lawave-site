-- Wave Cards : le combat 2v2, nouveau moteur — les fonctions de jeu (2026-10-28).
-- Appelées par combat.js (les joueurs) ; s'appuient sur le moteur (sql/combat-v2-moteur.sql). Un combat est une ligne de
-- combat_parties ; combat_avancer joue les tours jusqu'à la prochaine décision du joueur et renvoie les événements à animer.
--
-- POUR AJOUTER UN MODE DE COMBAT (autres modules) :
--   1. insert into combat_modes (id, nom, fonction_fin) values ('mon_mode', 'Mon mode', 'combat_fin_mon_mode');
--   2. écrire une fonction SECURITY DEFINER qui vérifie ses règles, construit l'équipe adverse et appelle
--        combat_creer(auth.uid(), 'mon_mode', 'Titre affiché', 'decor', combat_duo_unites(auth.uid(), p_duo),
--                     combat_adverses('[{"artist":"<uuid>","rarete":3,"holo":false,"bonus":10}, {…}]'), 'cible libre', null, options)
--      puis renvoie combat_partie_json(<id>) ; décors : studio, concert, plateau, ruelle, toit.
--   3. (si le mode verse des gains) écrire public.combat_fin_mon_mode(p_partie uuid, p_victoire boolean, p_abandon boolean)
--      returns jsonb — appelée UNE fois à la fin du combat, elle verse les gains (jeu_crediter) et renvoie {vinyles: n, …} à afficher.
--   combat.js s'occupe du reste (écran, équipe, animations) : WaveCombat.lancerCombat({ rpc: 'ma_fonction', params, mode, titre, decor }).

drop function if exists public.combat_lancer(text, text, jsonb);
drop function if exists public.combat_tour(uuid, jsonb);
drop function if exists public.combat_equipe_attaque_sauver(jsonb);

-- Les unités adverses depuis une liste [{artist, rarete, holo, bonus}] (bonus : stats en %).
create or replace function public.combat_adverses(p_spec jsonb) returns jsonb
language plpgsql stable set search_path to 'public' as $$
declare r jsonb := '[]'::jsonb; d jsonb;
begin
  if p_spec is null or jsonb_typeof(p_spec) <> 'array' then raise exception 'Adversaires invalides.'; end if;
  for d in select value from jsonb_array_elements(p_spec) loop
    r := r || public.combat_unite((d ->> 'artist')::uuid, least(greatest(coalesce((d ->> 'rarete')::integer, 3), 1), 5),
                                  coalesce((d ->> 'holo')::boolean, false), least(greatest(coalesce((d ->> 'bonus')::integer, 0), 0), 100));
  end loop;
  return r;
end $$;

create or replace function public.combat_partie_json(p_id uuid) returns jsonb
language sql stable security definer set search_path to 'public' as
$$ select jsonb_build_object('id', id, 'mode', mode, 'cible', cible, 'adversaire', adversaire, 'titre', coalesce(titre, adversaire), 'decor', decor,
          'options', options, 'etat', etat, 'tour', tour, 'unites', unites, 'jeu', jeu, 'ordre', to_jsonb(public.combat_ordre(unites, 8)),
          'max_actions', 120, 'gains', gains, 'trophees_delta', trophees_delta, 'debut', debut)
     from public.combat_parties where id = p_id $$;

-- Fin d'un combat : gains, trophées, statistiques. p_abandon : abandon ou expiration (défaite en PvP, rien ailleurs).
create or replace function public.combat_conclure(p_id uuid, p_victoire boolean, p_abandon boolean) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  p public.combat_parties; j public.combat_joueurs; d public.combat_joueurs; pal public.combat_arene; m public.combat_modes;
  v_jour date := public.xp_jour(); v_gains jsonb := '{}'::jsonb; v_delta integer; v_nv integer; v_e numeric; v_gain integer;
  v_n integer; v_serie integer; v_plafond constant integer := 5; v_victoire boolean := p_victoire and not p_abandon; v_g jsonb;
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

  elsif p.mode not in ('arene', 'defi', 'pvp', 'entrainement') then
    select * into m from public.combat_modes where id = p.mode;
    if m.fonction_fin is not null then
      execute format('select public.%I($1, $2, $3)', m.fonction_fin) into v_g using p_id, v_victoire, p_abandon;
      v_gains := coalesce(v_g, '{}'::jsonb);
    end if;
  end if;

  if p.mode in ('arene', 'defi', 'pvp') and (not p_abandon or p.mode = 'pvp') then
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

-- Crée un combat (INTERNE : appelée par les fonctions de mode). p_duo : les 2 unités du joueur (combat_duo_unites) ; p_adversaires :
-- les 2 unités adverses (combat_adverses, combat_unite…). Le combat démarre au premier appel de combat_avancer.
create or replace function public.combat_creer(p_user uuid, p_mode text, p_titre text, p_decor text, p_duo jsonb, p_adversaires jsonb,
  p_cible text default null, p_defenseur uuid default null, p_options jsonb default '{}'::jsonb) returns uuid
language plpgsql security definer set search_path to 'public' as $$
declare v_id uuid; v_opt jsonb := coalesce(p_options, '{}'::jsonb); v_decor text := p_decor;
begin
  if not exists (select 1 from public.combat_modes where id = p_mode and actif) then raise exception 'Mode de combat inconnu.'; end if;
  if jsonb_typeof(p_duo) <> 'array' or jsonb_array_length(p_duo) <> 2 or jsonb_typeof(p_adversaires) <> 'array' or jsonb_array_length(p_adversaires) <> 2 then
    raise exception 'Chaque camp a besoin de 2 cartes.';
  end if;
  if exists (select 1 from public.combat_parties where user_id = p_user and etat = 'en_cours') then raise exception 'Un combat est déjà en cours.'; end if;
  if coalesce(v_decor, '') not in ('studio', 'concert', 'plateau', 'ruelle', 'toit') then v_decor := 'studio'; end if;
  insert into public.combat_parties (user_id, mode, cible, adversaire, titre, decor, defenseur, options, unites, jeu, moteur)
  values (p_user, p_mode, p_cible, coalesce(nullif(btrim(p_titre), ''), 'Combat'), nullif(btrim(p_titre), ''), v_decor, p_defenseur, v_opt,
          public.combat_assembler(p_duo, p_adversaires),
          jsonb_build_object('n', 0, 'actif', null, 'auto', coalesce((v_opt ->> 'auto')::boolean, false)), 2)
  returning id into v_id;
  return v_id;
end $$;

-- Ferme les combats restés en plan depuis plus d'une demi-heure (inchangée : rappelée ici pour mémoire).
create or replace function public.combat_expirer(p_user uuid) returns void
language plpgsql security definer set search_path to 'public' as $$
declare x uuid;
begin
  for x in select id from public.combat_parties where user_id = p_user and etat = 'en_cours' and maj < now() - interval '30 minutes' loop
    perform public.combat_conclure(x, false, true);
  end loop;
end $$;

-- Lance un combat des modes intégrés. p_mode : arene (p_cible = palier), defi, pvp (p_cible = identifiant du joueur), entrainement.
-- p_options : {auto: bool}.
create or replace function public.combat_lancer(p_mode text, p_cible text, p_duo jsonb, p_options jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid(); j public.combat_joueurs; v_mine jsonb; v_opp jsonb := '[]'::jsonb; v_nom text; v_def uuid; pal public.combat_arene;
  v_info jsonb; v_id uuid; v_rar integer; x record; v_cible text := p_cible; v_decor text := 'studio';
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
    v_decor := case when pal.palier <= 3 then 'ruelle' when pal.palier <= 6 then 'studio' when pal.palier <= 9 then 'plateau' when pal.palier <= 11 then 'concert' else 'toit' end;
  elsif p_mode = 'defi' then
    v_info := public.combat_defi(public.xp_jour());
    v_opp := v_info -> 'crew';
    v_nom := 'Défi du jour · ' || (v_info ->> 'type_nom');
    v_cible := null;
    v_decor := 'plateau';
  elsif p_mode = 'pvp' then
    begin v_def := p_cible::uuid; exception when others then raise exception 'Adversaire inconnu.'; end;
    if v_def = v_uid then raise exception 'Tu ne peux pas t''affronter toi-même.'; end if;
    if j.pvp_jour >= 10 then raise exception 'Tu as atteint la limite de 10 défis par jour.'; end if;
    select pseudo into v_nom from public.profiles where id = v_def;
    if v_nom is null then raise exception 'Adversaire inconnu.'; end if;
    begin v_opp := public.combat_duo_unites(v_def, public.combat_duo_json(v_def, 'defense'));
    exception when others then raise exception 'Ce joueur n''a pas de duo de défense valide pour le moment.'; end;
    update public.combat_joueurs set pvp_jour = pvp_jour + 1 where user_id = v_uid;
    v_decor := 'ruelle';
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

  v_id := public.combat_creer(v_uid, p_mode, v_nom, v_decor, v_mine, v_opp, v_cible, v_def, p_options);
  return public.combat_partie_json(v_id);
end $$;

-- Joue la suite du combat. p_action : {t: 0..2, c: unité visée} ou {passer: true} quand une unité du joueur attend son ordre ;
-- p_auto : active (true) ou coupe (false) le mode Auto. Renvoie les événements à animer et l'état.
create or replace function public.combat_avancer(p_id uuid, p_action jsonb default null, p_auto boolean default null) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); p public.combat_parties; r jsonb; v_jeu jsonb; v_res jsonb;
begin
  if v_uid is null then raise exception 'Connecte-toi.'; end if;
  select * into p from public.combat_parties where id = p_id and user_id = v_uid for update;
  if not found then raise exception 'Combat introuvable.'; end if;
  if p.etat <> 'en_cours' then raise exception 'Ce combat est terminé.'; end if;
  if p.maj < now() - interval '30 minutes' then
    perform public.combat_conclure(p.id, false, true);
    return jsonb_build_object('expire', true);
  end if;
  if p_action is not null and jsonb_typeof(p_action) <> 'object' then raise exception 'Action invalide.'; end if;
  v_jeu := p.jeu;
  if p_auto is not null then v_jeu := v_jeu || jsonb_build_object('auto', p_auto); end if;
  if p_action is not null and nullif(v_jeu ->> 'actif', '') is null then raise exception 'Ce n''est pas ton tour.'; end if;
  r := public.combat_derouler(p.unites, v_jeu, p_action, 12);
  update public.combat_parties
     set unites = r -> 'u', jeu = r -> 'jeu', tour = greatest(1, ceil(((r -> 'jeu' ->> 'n')::integer) / 4.0)::integer), maj = now()
   where id = p.id;
  v_res := jsonb_build_object('evenements', r -> 'ev', 'unites', r -> 'u', 'jeu', r -> 'jeu', 'ordre', r -> 'ordre',
                              'fini', (r ->> 'fini')::boolean, 'vainqueur', r -> 'vainqueur', 'continuer', (r ->> 'continuer')::boolean);
  if (r ->> 'fini')::boolean then
    v_res := v_res || public.combat_conclure(p.id, (r ->> 'vainqueur') = '0', false);
  end if;
  return v_res;
end $$;

-- Mes équipes enregistrées (5 emplacements) : le nom, les 2 cartes et si elles sont toujours dans ma collection.
create or replace function public.combat_duos_lire() returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Connecte-toi.'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('slot', s.slot, 'nom', s.nom, 'duo', s.duo, 'cartes', (
             select coalesce(jsonb_agg(
                      case when col.quantite > 0 and bc.rarete is not null
                           then (public.combat_identite((d ->> 'artist')::uuid, bc.rarete, coalesce((d ->> 'holo')::boolean, false)) - 'surcharge')
                                || jsonb_build_object('booster', d ->> 'booster', 'numero', bc.numero)
                           else null end order by o), '[]'::jsonb)
               from jsonb_array_elements(s.duo) with ordinality as t (d, o)
               left join public.jeu_collection_b col on col.user_id = v_uid and col.booster_id = d ->> 'booster' and col.artist_id = (d ->> 'artist')::uuid
                                                    and col.holo = coalesce((d ->> 'holo')::boolean, false)
               left join public.jeu_booster_cartes bc on bc.booster_id = d ->> 'booster' and bc.artist_id = (d ->> 'artist')::uuid)) order by s.slot)
      from public.combat_duos_sauves s where s.user_id = v_uid), '[]'::jsonb);
end $$;

create or replace function public.combat_duo_sauver(p_slot integer, p_nom text, p_duo jsonb) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); v_nom text := left(btrim(coalesce(p_nom, '')), 30); v_duo jsonb := '[]'::jsonb; d jsonb;
begin
  if v_uid is null then raise exception 'Connecte-toi.'; end if;
  if p_slot is null or p_slot not between 1 and 5 then raise exception 'Emplacement inconnu (1 à 5).'; end if;
  perform public.jeu_joueur_assurer(v_uid);
  perform public.combat_duo_unites(v_uid, p_duo);
  if v_nom = '' then v_nom := 'Équipe ' || p_slot; end if;
  for d in select value from jsonb_array_elements(p_duo) loop
    v_duo := v_duo || jsonb_build_object('booster', d ->> 'booster', 'artist', d ->> 'artist', 'holo', coalesce((d ->> 'holo')::boolean, false));
  end loop;
  insert into public.combat_duos_sauves (user_id, slot, nom, duo) values (v_uid, p_slot, v_nom, v_duo)
  on conflict (user_id, slot) do update set nom = excluded.nom, duo = excluded.duo, maj_le = now();
  return public.combat_duos_lire();
end $$;

create or replace function public.combat_duo_supprimer(p_slot integer) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Connecte-toi.'; end if;
  delete from public.combat_duos_sauves where user_id = v_uid and slot = p_slot;
  return public.combat_duos_lire();
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
           'crew', jsonb_build_array(public.combat_unite(a.artist1, a.rarete1, false, a.bonus) - 'techs' - 'capacite' - 'cd' - 'statuts',
                                     public.combat_unite(a.artist2, a.rarete2, false, a.bonus) - 'techs' - 'capacite' - 'cd' - 'statuts')) order by a.palier), '[]'::jsonb)
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
              'crew', (select jsonb_agg(u - 'techs' - 'capacite' - 'cd' - 'statuts') from jsonb_array_elements(v_defi -> 'crew') u)),
    'en_cours', (select public.combat_en_cours()));
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------
-- La console de l'équipe (réservée à l'équipe)
-- ---------------------------------------------------------------------------------------------------------------------------

create or replace function public.combat_equipe_catalogue() returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
begin
  perform public.combat_equipe_garde();
  return jsonb_build_object(
    'types', (select jsonb_agg(to_jsonb(t) order by t.ordre) from public.combat_types t),
    'affinites', (select coalesce(jsonb_agg(jsonb_build_object('att', a.att, 'def', a.def, 'mult', a.mult) order by a.att, a.def), '[]'::jsonb) from public.combat_affinites a),
    'roles', (select jsonb_agg(to_jsonb(r) order by r.ordre) from public.combat_roles r),
    'techniques', (select jsonb_agg(to_jsonb(a) order by a.role, a.slot, a.id) from public.combat_techniques a),
    'capacites', (select jsonb_agg(to_jsonb(c) order by c.id) from public.combat_capacites c),
    'arene', (select jsonb_agg(jsonb_build_object('palier', a.palier, 'nom', a.nom, 'description', a.description, 'bonus', a.bonus, 'recompense', a.recompense,
                'rarete1', a.rarete1, 'rarete2', a.rarete2, 'artiste1', c1.nom, 'artiste2', c2.nom) order by a.palier)
                from public.combat_arene a join public.jeu_cartes c1 on c1.artist_id = a.artist1 join public.jeu_cartes c2 on c2.artist_id = a.artist2));
end $$;

create or replace function public.combat_equipe_regler_carte(p_artist uuid, p_champs jsonb) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare k text; v text;
begin
  perform public.combat_equipe_garde();
  if not exists (select 1 from public.jeu_cartes where artist_id = p_artist) then raise exception 'Artiste inconnu.'; end if;
  if p_champs is null or jsonb_typeof(p_champs) <> 'object' then raise exception 'Réglages invalides.'; end if;
  for k in select jsonb_object_keys(p_champs) loop
    v := nullif(btrim(p_champs ->> k), '');
    if k not in ('type', 'role', 'pv', 'pui', 'def', 'vit', 'tech1', 'tech2', 'tech3', 'capacite', 'citation') then raise exception 'Réglage inconnu : %.', k; end if;
    if v is null then continue; end if;
    if k = 'type' and not exists (select 1 from public.combat_types where id = v) then raise exception 'Style inconnu.'; end if;
    if k = 'role' and not exists (select 1 from public.combat_roles where id = v) then raise exception 'Rôle inconnu.'; end if;
    if k in ('tech1', 'tech2', 'tech3') and not exists (select 1 from public.combat_techniques where id = v) then raise exception 'Technique inconnue.'; end if;
    if k = 'capacite' and not exists (select 1 from public.combat_capacites where id = v) then raise exception 'Passif inconnu.'; end if;
    if k in ('pv', 'pui', 'def', 'vit') then
      if v !~ '^[0-9]{1,3}$' then raise exception 'Valeur de % invalide.', upper(k); end if;
      if k = 'pv' and (v::integer < 20 or v::integer > 400) then raise exception 'PV : entre 20 et 400.'; end if;
      if k <> 'pv' and (v::integer < 10 or v::integer > 300) then raise exception '% : entre 10 et 300.', initcap(k); end if;
    end if;
    if k = 'citation' and char_length(v) > 160 then raise exception 'Citation : 160 caractères au plus.'; end if;
  end loop;
  insert into public.combat_surcharges (artist_id) values (p_artist) on conflict do nothing;
  update public.combat_surcharges set
    type = case when p_champs ? 'type' then nullif(btrim(p_champs ->> 'type'), '') else type end,
    role = case when p_champs ? 'role' then nullif(btrim(p_champs ->> 'role'), '') else role end,
    pv = case when p_champs ? 'pv' then nullif(btrim(p_champs ->> 'pv'), '')::integer else pv end,
    pui = case when p_champs ? 'pui' then nullif(btrim(p_champs ->> 'pui'), '')::integer else pui end,
    def = case when p_champs ? 'def' then nullif(btrim(p_champs ->> 'def'), '')::integer else def end,
    vit = case when p_champs ? 'vit' then nullif(btrim(p_champs ->> 'vit'), '')::integer else vit end,
    tech1 = case when p_champs ? 'tech1' then nullif(btrim(p_champs ->> 'tech1'), '') else tech1 end,
    tech2 = case when p_champs ? 'tech2' then nullif(btrim(p_champs ->> 'tech2'), '') else tech2 end,
    tech3 = case when p_champs ? 'tech3' then nullif(btrim(p_champs ->> 'tech3'), '') else tech3 end,
    capacite = case when p_champs ? 'capacite' then nullif(btrim(p_champs ->> 'capacite'), '') else capacite end,
    citation = case when p_champs ? 'citation' then nullif(btrim(p_champs ->> 'citation'), '') else citation end,
    maj_le = now()
  where artist_id = p_artist;
  delete from public.combat_surcharges
   where artist_id = p_artist and type is null and role is null and pv is null and pui is null and def is null and vit is null
     and tech1 is null and tech2 is null and tech3 is null and capacite is null and citation is null;
  return public.combat_equipe_carte(p_artist);
end $$;

create or replace function public.combat_equipe_technique_sauver(p jsonb) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_id text := lower(btrim(p ->> 'id')); v_type text := nullif(btrim(p ->> 'type'), ''); v_effets jsonb := coalesce(p -> 'effets', '[]'::jsonb); e jsonb;
begin
  perform public.combat_equipe_garde();
  if v_id is null or v_id !~ '^[a-z0-9-]{2,40}$' then raise exception 'Identifiant : lettres minuscules, chiffres et tirets (2 à 40).'; end if;
  if coalesce(btrim(p ->> 'nom'), '') = '' then raise exception 'Donne un nom à la technique.'; end if;
  if v_type is not null and not exists (select 1 from public.combat_types where id = v_type) then raise exception 'Style inconnu.'; end if;
  if not exists (select 1 from public.combat_roles where id = p ->> 'role') then raise exception 'Rôle inconnu.'; end if;
  if coalesce((p ->> 'slot')::integer, 0) not between 1 and 3 then raise exception 'Emplacement : 1 (base), 2 (spéciale) ou 3 (ultime).'; end if;
  if coalesce(p ->> 'cible', '') not in ('ennemi', 'ennemis', 'allie', 'allies', 'soi') then raise exception 'Cible inconnue.'; end if;
  if coalesce((p ->> 'puissance')::integer, 0) not between 0 and 250 then raise exception 'Puissance : entre 0 et 250.'; end if;
  if coalesce((p ->> 'hits')::integer, 1) not between 1 and 4 then raise exception 'Coups : entre 1 et 4.'; end if;
  if coalesce((p ->> 'justesse')::integer, 100) not between 1 and 100 then raise exception 'Précision : entre 1 et 100.'; end if;
  if coalesce((p ->> 'recharge')::integer, 0) not between 0 and 9 then raise exception 'Recharge : entre 0 et 9 tours.'; end if;
  if coalesce((p ->> 'perce')::integer, 0) not between 0 and 100 then raise exception 'Perce-défense : entre 0 et 100.'; end if;
  if jsonb_typeof(v_effets) <> 'array' then raise exception 'Effets invalides.'; end if;
  for e in select value from jsonb_array_elements(v_effets) loop
    if coalesce(e ->> 'k', '') not in ('soin', 'bouclier', 'vampirisme', 'recul', 'pui+', 'pui-', 'def+', 'def-', 'vit+', 'vit-', 'etourdi', 'gel', 'brulure', 'poison',
                                      'regen', 'marque', 'provoc', 'purif', 'jauge+', 'jauge-') then raise exception 'Effet inconnu.'; end if;
    if coalesce(e ->> 'sur', 'cible') not in ('cible', 'soi', 'allies', 'ennemis') then raise exception 'Effet : cible inconnue.'; end if;
  end loop;
  insert into public.combat_techniques (id, nom, role, slot, type, puissance, hits, justesse, cible, recharge, perce, effets, description, actif)
  values (v_id, btrim(p ->> 'nom'), p ->> 'role', (p ->> 'slot')::integer, v_type, coalesce((p ->> 'puissance')::integer, 0), coalesce((p ->> 'hits')::integer, 1),
          coalesce((p ->> 'justesse')::integer, 100), p ->> 'cible', coalesce((p ->> 'recharge')::integer, 0), coalesce((p ->> 'perce')::integer, 0), v_effets,
          coalesce(btrim(p ->> 'description'), ''), coalesce((p ->> 'actif')::boolean, true))
  on conflict (id) do update set nom = excluded.nom, role = excluded.role, slot = excluded.slot, type = excluded.type, puissance = excluded.puissance,
    hits = excluded.hits, justesse = excluded.justesse, cible = excluded.cible, recharge = excluded.recharge, perce = excluded.perce, effets = excluded.effets,
    description = excluded.description, actif = excluded.actif;
  return (select to_jsonb(a) from public.combat_techniques a where a.id = v_id);
end $$;

create or replace function public.combat_equipe_capacite_sauver(p jsonb) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_id text := lower(btrim(p ->> 'id'));
begin
  perform public.combat_equipe_garde();
  if v_id is null or v_id !~ '^[a-z0-9-]{2,40}$' then raise exception 'Identifiant : lettres minuscules, chiffres et tirets (2 à 40).'; end if;
  if coalesce(btrim(p ->> 'nom'), '') = '' then raise exception 'Donne un nom au passif.'; end if;
  if coalesce(p ->> 'code', '') not in ('regeneration', 'epines', 'sang_froid', 'ouverture', 'dernier_souffle', 'survivant', 'aura', 'concentration', 'rythme', 'bouclier', 'rage') then
    raise exception 'Effet de passif inconnu.';
  end if;
  if coalesce((p ->> 'valeur')::integer, 0) not between 0 and 100 then raise exception 'Valeur : entre 0 et 100.'; end if;
  insert into public.combat_capacites (id, nom, code, valeur, description)
  values (v_id, btrim(p ->> 'nom'), p ->> 'code', coalesce((p ->> 'valeur')::integer, 0), coalesce(btrim(p ->> 'description'), ''))
  on conflict (id) do update set nom = excluded.nom, code = excluded.code, valeur = excluded.valeur, description = excluded.description;
  return (select to_jsonb(c) from public.combat_capacites c where c.id = v_id);
end $$;

-- Un combat de test entre deux duos (chacun : [{artist, rarete, holo, bonus}]), joué entièrement par l'ordinateur.
create or replace function public.combat_equipe_simuler(p_a jsonb, p_b jsonb) returns jsonb
language plpgsql volatile security definer set search_path to 'public' as $$
declare u jsonb; r jsonb; v_jeu jsonb := jsonb_build_object('n', 0, 'actif', null, 'auto', true); k integer := 0; v_tours jsonb := '[]'::jsonb; v_depart jsonb;
begin
  perform public.combat_equipe_garde();
  if jsonb_typeof(p_a) <> 'array' or jsonb_array_length(p_a) <> 2 or jsonb_typeof(p_b) <> 'array' or jsonb_array_length(p_b) <> 2 then raise exception 'Chaque camp a besoin de 2 cartes.'; end if;
  u := public.combat_assembler(public.combat_adverses(p_a), public.combat_adverses(p_b));
  v_depart := u;
  loop
    k := k + 1;
    r := public.combat_derouler(u, v_jeu, null, 40);
    v_tours := v_tours || jsonb_build_array(jsonb_build_object('tour', k, 'ev', r -> 'ev'));
    u := r -> 'u'; v_jeu := r -> 'jeu';
    exit when (r ->> 'fini')::boolean or k >= 10;
  end loop;
  return jsonb_build_object('depart', v_depart, 'tours', v_tours, 'unites', u, 'vainqueur', r -> 'vainqueur', 'actions', v_jeu -> 'n');
end $$;

revoke all on function public.combat_adverses(jsonb), public.combat_partie_json(uuid), public.combat_conclure(uuid, boolean, boolean),
  public.combat_creer(uuid, text, text, text, jsonb, jsonb, text, uuid, jsonb), public.combat_expirer(uuid) from public, anon, authenticated;

revoke all on function public.combat_lancer(text, text, jsonb, jsonb), public.combat_avancer(uuid, jsonb, boolean), public.combat_duos_lire(),
  public.combat_duo_sauver(integer, text, jsonb), public.combat_duo_supprimer(integer), public.combat_accueil(),
  public.combat_equipe_catalogue(), public.combat_equipe_regler_carte(uuid, jsonb), public.combat_equipe_technique_sauver(jsonb),
  public.combat_equipe_capacite_sauver(jsonb), public.combat_equipe_simuler(jsonb, jsonb) from public, anon;
grant execute on function public.combat_lancer(text, text, jsonb, jsonb), public.combat_avancer(uuid, jsonb, boolean), public.combat_duos_lire(),
  public.combat_duo_sauver(integer, text, jsonb), public.combat_duo_supprimer(integer), public.combat_accueil(),
  public.combat_equipe_catalogue(), public.combat_equipe_regler_carte(uuid, jsonb), public.combat_equipe_technique_sauver(jsonb),
  public.combat_equipe_capacite_sauver(jsonb), public.combat_equipe_simuler(jsonb, jsonb) to authenticated;
