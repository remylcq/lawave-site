-- Wave Cards : le quotidien — fonctions (voir quotidien-donnees.sql pour les tables).
-- Joueur : quotidien_accueil, quotidien_programme, quotidien_artiste_prendre, quotidien_evenements,
--          quotidien_ev_mission_prendre, quotidien_ev_recompense_prendre, quotidien_parcours, quotidien_parcours_prendre,
--          quotidien_defis, quotidien_defi_prendre, quotidien_expeditions, quotidien_expedition_envoyer,
--          quotidien_expedition_prendre, quotidien_nouveautes, quotidien_nouveautes_vu, quotidien_classement,
--          quotidien_profil, quotidien_profil_regler, quotidien_tout_prendre
-- Équipe : quotidien_equipe_evenements / _evenement_sauver / _evenement_supprimer,
--          quotidien_equipe_nouveautes / _nouveaute_sauver / _nouveaute_supprimer
-- Internes (jamais appelables par un joueur) : quotidien_compte, quotidien_metriques, quotidien_valeurs, quotidien_gain_expedition.
-- Tout se paie en vinyles par jeu_crediter (1 tirage = 1 vinyle). Les clés de jeu_reclamations commencent par « q: ».

-- ---------------------------------------------------------------------------
-- Aides internes
-- ---------------------------------------------------------------------------

-- Un chiffre d'activité sur une période (dates de Paris)
create or replace function public.quotidien_compte(p_user uuid, p_metrique text, p_du date, p_au date)
returns integer language plpgsql stable security definer set search_path to 'public' as $$
declare v integer := 0;
begin
  if p_metrique = 'ouvertures' then
    select coalesce(sum(ouvertures), 0) into v from public.jeu_jour where user_id = p_user and jour between p_du and p_au;
  elsif p_metrique = 'holos' then
    select coalesce(sum(holos), 0) into v from public.jeu_jour where user_id = p_user and jour between p_du and p_au;
  elsif p_metrique = 'rares' then
    select coalesce(sum(rare_plus), 0) into v from public.jeu_jour where user_id = p_user and jour between p_du and p_au;
  elsif p_metrique = 'epiques' then
    select coalesce(sum(epique_plus), 0) into v from public.jeu_jour where user_id = p_user and jour between p_du and p_au;
  elsif p_metrique = 'ventes' then
    select count(*) into v from public.marche_journal
     where type = 'vente' and vendeur = p_user and (cree_le at time zone 'Europe/Paris')::date between p_du and p_au;
  elsif p_metrique = 'achats' then
    select count(*) into v from public.marche_journal
     where type = 'vente' and acheteur = p_user and (cree_le at time zone 'Europe/Paris')::date between p_du and p_au;
  elsif p_metrique = 'annonces' then
    select count(*) into v from public.marche_annonces
     where vendeur = p_user and (cree_le at time zone 'Europe/Paris')::date between p_du and p_au;
  elsif p_metrique = 'echanges' then
    select count(*) into v from public.wc_journal
     where user_id = p_user and motif = 'jeu:vinyles' and (cree_le at time zone 'Europe/Paris')::date between p_du and p_au;
  elsif p_metrique in ('combats', 'victoires') then
    -- Le combat évolue : si ses tables changent, ce compteur retombe à zéro au lieu de tout casser.
    begin
      execute 'select count(*) from public.combat_parties where user_id = $1 and (debut at time zone ''Europe/Paris'')::date between $2 and $3'
              || case when p_metrique = 'victoires' then ' and etat = ''victoire''' else '' end
         into v using p_user, p_du, p_au;
    exception when others then v := 0;
    end;
  else
    raise exception 'Métrique inconnue : %.', p_metrique;
  end if;
  return coalesce(v, 0);
end $$;

-- Tous les chiffres d'un joueur : ceux du jeu, plus ceux du quotidien
create or replace function public.quotidien_metriques(p_user uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_tout_du constant date := date '2000-01-01'; v_tout_au constant date := date '2100-01-01';
  v_ventes integer; v_achats integer; v_pct integer; v_finis integer; v_cols integer; v_parcours integer;
begin
  v_ventes := public.quotidien_compte(p_user, 'ventes', v_tout_du, v_tout_au);
  v_achats := public.quotidien_compte(p_user, 'achats', v_tout_du, v_tout_au);

  select count(distinct col.booster_id) into v_cols
    from public.jeu_collection_b col join public.jeu_boosters b on b.id = col.booster_id and b.classeur and b.actif
   where col.user_id = p_user and col.quantite > 0;

  select coalesce(max(floor(100.0 * x.possedees / x.total)), 0)::integer, coalesce(count(*) filter (where x.total > 0 and x.possedees >= x.total), 0)::integer
    into v_pct, v_finis
    from (select b.id,
                 (select count(*) from public.jeu_booster_cartes bc join public.jeu_cartes c on c.artist_id = bc.artist_id and c.active where bc.booster_id = b.id) as total,
                 (select count(distinct col.artist_id) from public.jeu_collection_b col join public.jeu_cartes c on c.artist_id = col.artist_id and c.active
                   where col.user_id = p_user and col.booster_id = b.id and col.quantite > 0
                     and exists (select 1 from public.jeu_booster_cartes bc where bc.booster_id = b.id and bc.artist_id = col.artist_id)) as possedees
            from public.jeu_boosters b where b.classeur and b.actif) x
   where x.total > 0;

  select count(*) into v_parcours from public.jeu_reclamations where user_id = p_user and cle ~ '^q:pc:p[0-9]{2}$';

  return public.jeu_metriques(p_user) || jsonb_build_object(
    'echanges', public.quotidien_compte(p_user, 'echanges', v_tout_du, v_tout_au),
    'annonces', public.quotidien_compte(p_user, 'annonces', v_tout_du, v_tout_au),
    'ventes', v_ventes, 'achats', v_achats, 'echanges_marche', v_ventes + v_achats,
    'combats', public.quotidien_compte(p_user, 'combats', v_tout_du, v_tout_au),
    'victoires', public.quotidien_compte(p_user, 'victoires', v_tout_du, v_tout_au),
    'collections', coalesce(v_cols, 0), 'classeur_pct', coalesce(v_pct, 0), 'classeurs_finis', coalesce(v_finis, 0),
    'parcours', v_parcours);
end $$;

create or replace function public.quotidien_gain_expedition(p_duree integer, p_rarete integer)
returns integer language sql immutable as $$
  select (case p_duree when 2 then 1 when 6 then 2 else 3 end) + (case when p_rarete >= 5 then 2 when p_rarete >= 3 then 1 else 0 end)
$$;

-- ---------------------------------------------------------------------------
-- Programme du jour : l'artiste mis en avant, le style, les bonus du moment
-- ---------------------------------------------------------------------------

create or replace function public.quotidien_programme()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid(); v_jour date := public.xp_jour(); v_paris timestamp := now() at time zone 'Europe/Paris';
  a record; v_art jsonb := null; v_style jsonb := null; v_ev jsonb := public.jeu_evenement(); v_prochain timestamp; v_possede boolean; v_holo boolean;
begin
  if v_uid is null then raise exception 'Connecte-toi.'; end if;
  perform public.jeu_joueur_assurer(v_uid);

  select bc.booster_id, bc.artist_id, bc.rarete, bc.numero, c.nom, c.photo into a
    from public.jeu_booster_cartes bc
    join public.jeu_boosters b on b.id = bc.booster_id and b.classeur and b.actif
    join public.jeu_cartes c on c.artist_id = bc.artist_id and c.active
   order by md5(v_jour::text || bc.booster_id || bc.artist_id::text) limit 1;

  if found then
    select exists (select 1 from public.jeu_collection_b where user_id = v_uid and booster_id = a.booster_id and artist_id = a.artist_id and quantite > 0),
           exists (select 1 from public.jeu_collection_b where user_id = v_uid and booster_id = a.booster_id and artist_id = a.artist_id and holo and quantite > 0)
      into v_possede, v_holo;
    v_art := jsonb_build_object('booster_id', a.booster_id, 'artist_id', a.artist_id, 'nom', a.nom, 'photo', a.photo, 'rarete', a.rarete, 'numero', a.numero,
                                'possede', v_possede, 'holo', v_holo, 'bonus', 1 + case when v_holo then 1 else 0 end,
                                'pris', exists (select 1 from public.jeu_reclamations where user_id = v_uid and cle = 'q:art:' || v_jour));
  end if;

  begin
    select jsonb_build_object('id', t.id, 'nom', t.nom, 'couleur', t.couleur, 'citation', t.citation) into v_style
      from public.combat_types t order by md5(v_jour::text || t.id) limit 1;
  exception when others then v_style := null;
  end;

  -- La prochaine heure du holo (21 h, heure de Paris)
  v_prochain := date_trunc('day', v_paris) + interval '21 hours';
  if v_paris >= v_prochain + interval '1 hour' then v_prochain := v_prochain + interval '1 day'; end if;

  return jsonb_build_object(
    'jour', v_jour, 'artiste', v_art, 'style', v_style,
    'lundi', coalesce((v_ev ->> 'lundi')::boolean, false), 'heure_holo', coalesce((v_ev ->> 'heure_holo')::boolean, false),
    'holo_dans', greatest(0, floor(extract(epoch from v_prochain - v_paris))::integer),
    'fin_jour', greatest(0, floor(extract(epoch from date_trunc('day', v_paris) + interval '1 day' - v_paris))::integer));
end $$;

create or replace function public.quotidien_artiste_prendre()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); v_prog jsonb; v_art jsonb; v_jour date := public.xp_jour(); v_bonus integer;
begin
  if v_uid is null then raise exception 'Connecte-toi.'; end if;
  perform public.jeu_joueur_assurer(v_uid);
  perform 1 from public.jeu_joueurs where user_id = v_uid for update;
  v_prog := public.quotidien_programme();
  v_art := v_prog -> 'artiste';
  if v_art is null or v_art = 'null'::jsonb then raise exception 'Pas d''artiste du jour pour l''instant.'; end if;
  if not (v_art ->> 'possede')::boolean then raise exception 'Il te faut la carte de l''artiste du jour.'; end if;
  if not public.jeu_reclamer(v_uid, 'q:art:' || v_jour) then raise exception 'Déjà récupéré aujourd''hui.'; end if;
  v_bonus := (v_art ->> 'bonus')::integer;
  perform public.jeu_crediter(v_uid, v_bonus, 0, 0);
  return jsonb_build_object('gain', v_bonus, 'etat', public.jeu_etat_json(v_uid));
end $$;

-- ---------------------------------------------------------------------------
-- Événements à durée limitée
-- ---------------------------------------------------------------------------

create or replace function public.quotidien_evenements()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); v_jour date := public.xp_jour(); v_res jsonb;
begin
  if v_uid is null then raise exception 'Connecte-toi.'; end if;
  perform public.jeu_joueur_assurer(v_uid);

  select coalesce(jsonb_agg(ev order by (ev ->> 'debut')), '[]'::jsonb) into v_res from (
    select jsonb_build_object(
      'id', e.id, 'nom', e.nom, 'sous_titre', e.sous_titre, 'description', e.description, 'accent', e.accent,
      'debut', e.debut, 'fin', e.fin, 'medaille', e.medaille, 'en_cours', e.debut <= v_jour,
      'jours_restants', greatest(0, (e.fin - v_jour) + 1), 'dans_jours', greatest(0, e.debut - v_jour),
      'medailles', coalesce((select sum(m.medailles) from public.jeu_evenement_missions m
                              where m.evenement_id = e.id and exists (select 1 from public.jeu_reclamations r where r.user_id = v_uid and r.cle = 'q:ev:' || e.id || ':m:' || m.id)), 0)
                 - coalesce((select sum(r2.cout) from public.jeu_evenement_recompenses r2
                              where r2.evenement_id = e.id and exists (select 1 from public.jeu_reclamations r where r.user_id = v_uid and r.cle = 'q:ev:' || e.id || ':r:' || r2.id)), 0),
      'missions', coalesce((select jsonb_agg(jsonb_build_object(
                    'id', m.id, 'libelle', m.libelle, 'metrique', m.metrique, 'objectif', m.objectif, 'medailles', m.medailles,
                    'progres', case when e.debut <= v_jour then public.quotidien_compte(v_uid, m.metrique, e.debut, e.fin) else 0 end,
                    'prise', exists (select 1 from public.jeu_reclamations r where r.user_id = v_uid and r.cle = 'q:ev:' || e.id || ':m:' || m.id)) order by m.ordre, m.id)
                    from public.jeu_evenement_missions m where m.evenement_id = e.id), '[]'::jsonb),
      'recompenses', coalesce((select jsonb_agg(jsonb_build_object(
                    'id', r2.id, 'libelle', r2.libelle, 'cout', r2.cout, 'vinyles', r2.vinyles, 'garantis', r2.garantis,
                    'prise', exists (select 1 from public.jeu_reclamations r where r.user_id = v_uid and r.cle = 'q:ev:' || e.id || ':r:' || r2.id)) order by r2.ordre, r2.id)
                    from public.jeu_evenement_recompenses r2 where r2.evenement_id = e.id), '[]'::jsonb)
    ) as ev
      from public.jeu_evenements e
     where e.actif and e.fin >= v_jour and e.debut <= v_jour + 7
  ) x;
  return v_res;
end $$;

create or replace function public.quotidien_ev_mission_prendre(p_id bigint)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); v_jour date := public.xp_jour(); m public.jeu_evenement_missions; e public.jeu_evenements; v_ok integer;
begin
  if v_uid is null then raise exception 'Connecte-toi.'; end if;
  perform public.jeu_joueur_assurer(v_uid);
  perform 1 from public.jeu_joueurs where user_id = v_uid for update;
  select * into m from public.jeu_evenement_missions where id = p_id;
  if not found then raise exception 'Mission inconnue.'; end if;
  select * into e from public.jeu_evenements where id = m.evenement_id and actif;
  if not found or v_jour < e.debut or v_jour > e.fin then raise exception 'Cet événement n''est pas en cours.'; end if;
  v_ok := public.quotidien_compte(v_uid, m.metrique, e.debut, e.fin);
  if v_ok < m.objectif then raise exception 'Mission pas encore accomplie.'; end if;
  if not public.jeu_reclamer(v_uid, 'q:ev:' || e.id || ':m:' || m.id) then raise exception 'Déjà récupérée.'; end if;
  return jsonb_build_object('medailles', m.medailles, 'evenement', e.id);
end $$;

create or replace function public.quotidien_ev_recompense_prendre(p_id bigint)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); v_jour date := public.xp_jour(); r public.jeu_evenement_recompenses; e public.jeu_evenements; v_solde integer;
begin
  if v_uid is null then raise exception 'Connecte-toi.'; end if;
  perform public.jeu_joueur_assurer(v_uid);
  perform 1 from public.jeu_joueurs where user_id = v_uid for update;
  select * into r from public.jeu_evenement_recompenses where id = p_id;
  if not found then raise exception 'Récompense inconnue.'; end if;
  select * into e from public.jeu_evenements where id = r.evenement_id and actif;
  if not found or v_jour < e.debut or v_jour > e.fin then raise exception 'Cet événement n''est pas en cours.'; end if;

  select coalesce((select sum(m.medailles) from public.jeu_evenement_missions m
                    where m.evenement_id = e.id and exists (select 1 from public.jeu_reclamations x where x.user_id = v_uid and x.cle = 'q:ev:' || e.id || ':m:' || m.id)), 0)
       - coalesce((select sum(r2.cout) from public.jeu_evenement_recompenses r2
                    where r2.evenement_id = e.id and exists (select 1 from public.jeu_reclamations x where x.user_id = v_uid and x.cle = 'q:ev:' || e.id || ':r:' || r2.id)), 0)
    into v_solde;
  if v_solde < r.cout then raise exception 'Il te manque % %.', r.cout - v_solde, lower(e.medaille); end if;
  if not public.jeu_reclamer(v_uid, 'q:ev:' || e.id || ':r:' || r.id) then raise exception 'Déjà prise.'; end if;
  perform public.jeu_crediter(v_uid, r.vinyles, 0, r.garantis);
  return jsonb_build_object('gain', jsonb_build_object('vinyles', r.vinyles, 'garantis', r.garantis), 'medailles', v_solde - r.cout,
                            'etat', public.jeu_etat_json(v_uid));
end $$;

-- ---------------------------------------------------------------------------
-- Le parcours du collectionneur
-- ---------------------------------------------------------------------------

create or replace function public.quotidien_parcours()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); m jsonb; v_etapes jsonb; v_pris integer;
begin
  if v_uid is null then raise exception 'Connecte-toi.'; end if;
  perform public.jeu_joueur_assurer(v_uid);
  m := public.quotidien_metriques(v_uid);
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', d.id, 'chapitre', d.chapitre, 'ordre', d.ordre, 'nom', d.nom, 'description', d.description, 'seuil', d.seuil, 'vinyles', d.vinyles,
           'progres', coalesce((m ->> d.metrique)::integer, 0),
           'atteint', coalesce((m ->> d.metrique)::integer, 0) >= d.seuil,
           'pris', exists (select 1 from public.jeu_reclamations r where r.user_id = v_uid and r.cle = 'q:pc:' || d.id)) order by d.chapitre, d.ordre), '[]'::jsonb)
    into v_etapes from public.jeu_parcours_def d;
  select count(*) into v_pris from public.jeu_reclamations where user_id = v_uid and cle ~ '^q:pc:p[0-9]{2}$';
  return jsonb_build_object('etapes', v_etapes, 'pris', v_pris, 'total', (select count(*) from public.jeu_parcours_def),
    'diplome', jsonb_build_object('pret', v_pris >= (select count(*) from public.jeu_parcours_def),
                                   'pris', exists (select 1 from public.jeu_reclamations where user_id = v_uid and cle = 'q:pc:diplome'), 'vinyles', 5));
end $$;

create or replace function public.quotidien_parcours_prendre(p_id text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); d public.jeu_parcours_def; m jsonb; v_pris integer; v_total integer;
begin
  if v_uid is null then raise exception 'Connecte-toi.'; end if;
  perform public.jeu_joueur_assurer(v_uid);
  perform 1 from public.jeu_joueurs where user_id = v_uid for update;
  select count(*) into v_total from public.jeu_parcours_def;

  if p_id = 'diplome' then
    select count(*) into v_pris from public.jeu_reclamations where user_id = v_uid and cle ~ '^q:pc:p[0-9]{2}$';
    if v_pris < v_total then raise exception 'Il reste des étapes à terminer.'; end if;
    if not public.jeu_reclamer(v_uid, 'q:pc:diplome') then raise exception 'Déjà récupéré.'; end if;
    perform public.jeu_crediter(v_uid, 5, 0, 0);
    return jsonb_build_object('gain', 5, 'etat', public.jeu_etat_json(v_uid));
  end if;

  select * into d from public.jeu_parcours_def where id = p_id;
  if not found then raise exception 'Étape inconnue.'; end if;
  m := public.quotidien_metriques(v_uid);
  if coalesce((m ->> d.metrique)::integer, 0) < d.seuil then raise exception 'Étape pas encore accomplie.'; end if;
  if not public.jeu_reclamer(v_uid, 'q:pc:' || d.id) then raise exception 'Déjà récupérée.'; end if;
  perform public.jeu_crediter(v_uid, d.vinyles, 0, 0);
  return jsonb_build_object('gain', d.vinyles, 'etat', public.jeu_etat_json(v_uid));
end $$;

-- ---------------------------------------------------------------------------
-- Les défis de la semaine
-- ---------------------------------------------------------------------------

create or replace function public.quotidien_defis_semaine(p_lundi date)
returns setof public.jeu_defis_def language sql stable security definer set search_path to 'public' as $$
  select y.* from (
    select distinct on (d.metrique) d.* from public.jeu_defis_def d order by d.metrique, md5(d.id || p_lundi::text)
  ) y order by md5(y.id || p_lundi::text) limit 3
$$;

create or replace function public.quotidien_defis()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); v_jour date := public.xp_jour(); v_lundi date := public.jeu_lundi(public.xp_jour()); v_paris timestamp := now() at time zone 'Europe/Paris';
begin
  if v_uid is null then raise exception 'Connecte-toi.'; end if;
  perform public.jeu_joueur_assurer(v_uid);
  return jsonb_build_object(
    'fin_semaine', greatest(0, floor(extract(epoch from (v_lundi + 7)::timestamp - v_paris))::integer),
    'defis', coalesce((select jsonb_agg(jsonb_build_object(
        'id', d.id, 'libelle', d.libelle, 'metrique', d.metrique, 'objectif', d.objectif, 'vinyles', d.vinyles,
        'progres', public.quotidien_compte(v_uid, d.metrique, v_lundi, v_lundi + 6),
        'prise', exists (select 1 from public.jeu_reclamations r where r.user_id = v_uid and r.cle = 'q:df:' || v_lundi || ':' || d.id)))
        from public.quotidien_defis_semaine(v_lundi) d), '[]'::jsonb));
end $$;

create or replace function public.quotidien_defi_prendre(p_id text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); v_lundi date := public.jeu_lundi(public.xp_jour()); d public.jeu_defis_def;
begin
  if v_uid is null then raise exception 'Connecte-toi.'; end if;
  perform public.jeu_joueur_assurer(v_uid);
  perform 1 from public.jeu_joueurs where user_id = v_uid for update;
  select * into d from public.quotidien_defis_semaine(v_lundi) where id = p_id;
  if not found then raise exception 'Ce défi ne fait pas partie de cette semaine.'; end if;
  if public.quotidien_compte(v_uid, d.metrique, v_lundi, v_lundi + 6) < d.objectif then raise exception 'Défi pas encore relevé.'; end if;
  if not public.jeu_reclamer(v_uid, 'q:df:' || v_lundi || ':' || d.id) then raise exception 'Déjà récupéré.'; end if;
  perform public.jeu_crediter(v_uid, d.vinyles, 0, 0);
  return jsonb_build_object('gain', d.vinyles, 'etat', public.jeu_etat_json(v_uid));
end $$;

-- ---------------------------------------------------------------------------
-- Les expéditions : des cartes en tournée, des vinyles au retour (plafonnés)
-- ---------------------------------------------------------------------------

create or replace function public.quotidien_expeditions()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); v_jour date := public.xp_jour(); v_gagne integer;
begin
  if v_uid is null then raise exception 'Connecte-toi.'; end if;
  perform public.jeu_joueur_assurer(v_uid);
  select coalesce(sum(gain), 0) into v_gagne from public.jeu_expeditions
   where user_id = v_uid and etat = 'prise' and (prise_le at time zone 'Europe/Paris')::date = v_jour;
  return jsonb_build_object('emplacements', 3, 'plafond_jour', 8, 'gagne_jour', v_gagne,
    'en_cours', coalesce((select jsonb_agg(jsonb_build_object(
        'id', x.id, 'booster_id', x.booster_id, 'artist_id', x.artist_id, 'nom', c.nom, 'photo', c.photo, 'rarete', x.rarete, 'holo', x.holo,
        'duree', x.duree, 'fin', x.fin, 'restant', greatest(0, floor(extract(epoch from x.fin - now()))::integer), 'prete', x.fin <= now(),
        'gain', public.quotidien_gain_expedition(x.duree, x.rarete)) order by x.fin)
        from public.jeu_expeditions x join public.jeu_cartes c on c.artist_id = x.artist_id
       where x.user_id = v_uid and x.etat = 'en_cours'), '[]'::jsonb));
end $$;

create or replace function public.quotidien_expedition_envoyer(p_booster text, p_artist uuid, p_holo boolean, p_duree integer)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); v_rarete smallint; v_n integer;
begin
  if v_uid is null then raise exception 'Connecte-toi.'; end if;
  if p_duree not in (2, 6, 12) then raise exception 'Durée inconnue : 2, 6 ou 12 heures.'; end if;
  perform public.jeu_joueur_assurer(v_uid);
  perform 1 from public.jeu_joueurs where user_id = v_uid for update;

  select count(*) into v_n from public.jeu_expeditions where user_id = v_uid and etat = 'en_cours';
  if v_n >= 3 then raise exception 'Tes 3 emplacements sont occupés.'; end if;

  if not exists (select 1 from public.jeu_collection_b where user_id = v_uid and booster_id = p_booster and artist_id = p_artist and holo = coalesce(p_holo, false) and quantite > 0) then
    raise exception 'Tu ne possèdes pas cette carte.';
  end if;
  if exists (select 1 from public.jeu_expeditions where user_id = v_uid and etat = 'en_cours' and booster_id = p_booster and artist_id = p_artist and holo = coalesce(p_holo, false)) then
    raise exception 'Cette carte est déjà en tournée.';
  end if;
  select rarete into v_rarete from public.jeu_booster_cartes where booster_id = p_booster and artist_id = p_artist;
  if v_rarete is null then raise exception 'Carte inconnue.'; end if;

  insert into public.jeu_expeditions (user_id, booster_id, artist_id, holo, rarete, duree, fin)
  values (v_uid, p_booster, p_artist, coalesce(p_holo, false), v_rarete, p_duree, now() + make_interval(hours => p_duree));
  return public.quotidien_expeditions();
end $$;

create or replace function public.quotidien_expedition_prendre(p_id bigint)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); x public.jeu_expeditions; v_jour date := public.xp_jour(); v_gagne integer; v_gain integer; v_plafond constant integer := 8;
begin
  if v_uid is null then raise exception 'Connecte-toi.'; end if;
  perform public.jeu_joueur_assurer(v_uid);
  perform 1 from public.jeu_joueurs where user_id = v_uid for update;
  select * into x from public.jeu_expeditions where id = p_id and user_id = v_uid for update;
  if not found then raise exception 'Expédition inconnue.'; end if;
  if x.etat <> 'en_cours' then raise exception 'Déjà récupérée.'; end if;
  if x.fin > now() then raise exception 'La carte n''est pas encore rentrée.'; end if;

  select coalesce(sum(gain), 0) into v_gagne from public.jeu_expeditions
   where user_id = v_uid and etat = 'prise' and (prise_le at time zone 'Europe/Paris')::date = v_jour;
  v_gain := greatest(0, least(public.quotidien_gain_expedition(x.duree, x.rarete), v_plafond - v_gagne));
  update public.jeu_expeditions set etat = 'prise', gain = v_gain, prise_le = now() where id = x.id;
  if v_gain > 0 then perform public.jeu_crediter(v_uid, v_gain, 0, 0); end if;
  return jsonb_build_object('gain', v_gain, 'plafonne', v_gain < public.quotidien_gain_expedition(x.duree, x.rarete), 'etat', public.jeu_etat_json(v_uid));
end $$;

-- ---------------------------------------------------------------------------
-- Nouveautés
-- ---------------------------------------------------------------------------

create or replace function public.quotidien_nouveautes()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); v_vu timestamptz;
begin
  if v_uid is null then raise exception 'Connecte-toi.'; end if;
  select nouveautes_vu into v_vu from public.jeu_lecture where user_id = v_uid;
  return jsonb_build_object(
    'non_lues', (select count(*) from public.jeu_nouveautes n where n.actif and n.publie <= public.xp_jour() and n.cree_le > coalesce(v_vu, 'epoch'::timestamptz)),
    'liste', coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'titre', n.titre, 'texte', n.texte, 'etiquette', n.etiquette, 'publie', n.publie,
                         'nouveau', n.cree_le > coalesce(v_vu, 'epoch'::timestamptz)) order by n.publie desc, n.id desc)
                       from (select * from public.jeu_nouveautes where actif and publie <= public.xp_jour() order by publie desc, id desc limit 40) n), '[]'::jsonb));
end $$;

create or replace function public.quotidien_nouveautes_vu()
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if auth.uid() is null then raise exception 'Connecte-toi.'; end if;
  insert into public.jeu_lecture (user_id, nouveautes_vu) values (auth.uid(), now())
  on conflict (user_id) do update set nouveautes_vu = now();
end $$;

-- ---------------------------------------------------------------------------
-- Classements
-- ---------------------------------------------------------------------------

create or replace function public.quotidien_valeurs(p_type text)
returns table (user_id uuid, valeur bigint) language plpgsql stable security definer set search_path to 'public' as $$
begin
  if p_type = 'collection' then
    return query select col.user_id, count(*)::bigint from (select distinct c.user_id, c.booster_id, c.artist_id from public.jeu_collection_b c where c.quantite > 0) col
      join public.jeu_boosters b on b.id = col.booster_id and b.classeur and b.actif group by col.user_id;
  elsif p_type = 'holos' then
    return query select col.user_id, count(*)::bigint from (select distinct c.user_id, c.booster_id, c.artist_id from public.jeu_collection_b c where c.holo and c.quantite > 0) col
      join public.jeu_boosters b on b.id = col.booster_id and b.classeur and b.actif group by col.user_id;
  elsif p_type = 'packs' then
    return query select j.user_id, j.ouvertures::bigint from public.jeu_joueurs j;
  elsif p_type = 'serie' then
    return query select j.user_id, j.serie_max::bigint from public.jeu_joueurs j;
  elsif p_type = 'niveau' then
    return query select j.user_id, (j.niveau::bigint * 1000000 + j.xp) from public.jeu_joueurs j;
  elsif p_type = 'marche' then
    return query select m.vendeur, count(*)::bigint from public.marche_journal m where m.type = 'vente' group by m.vendeur;
  else
    raise exception 'Classement inconnu.';
  end if;
end $$;

create or replace function public.quotidien_classement(p_type text default 'collection', p_limite integer default 20)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); v_lib text; v_unite text; v_lignes jsonb; v_moi jsonb; v_total bigint;
begin
  if v_uid is null then raise exception 'Connecte-toi.'; end if;
  p_limite := least(greatest(coalesce(p_limite, 20), 1), 50);
  select x.l, x.u into v_lib, v_unite from (values
    ('collection', 'Collection', 'cartes'), ('holos', 'Cartes holo', 'holos'), ('packs', 'Packs ouverts', 'packs'),
    ('serie', 'Plus longue série', 'jours'), ('niveau', 'Niveau', 'niveau'), ('marche', 'Ventes sur le marché', 'ventes')) x (t, l, u) where x.t = p_type;
  if v_lib is null then raise exception 'Classement inconnu.'; end if;

  with r as (
    select v.user_id, v.valeur, (rank() over (order by v.valeur desc))::integer as rang from public.quotidien_valeurs(p_type) v where v.valeur > 0
  )
  select (select coalesce(jsonb_agg(jsonb_build_object('rang', t.rang, 'user_id', t.user_id, 'pseudo', p.pseudo, 'avatar', p.avatar_url,
                    'valeur', case when p_type = 'niveau' then t.valeur / 1000000 else t.valeur end, 'moi', t.user_id = v_uid) order by t.rang, p.pseudo), '[]'::jsonb)
            from (select * from r order by rang limit p_limite) t left join public.profiles p on p.id = t.user_id),
         (select jsonb_build_object('rang', t.rang, 'valeur', case when p_type = 'niveau' then t.valeur / 1000000 else t.valeur end) from r t where t.user_id = v_uid),
         (select count(*) from r)
    into v_lignes, v_moi, v_total;

  return jsonb_build_object('type', p_type, 'libelle', v_lib, 'unite', v_unite, 'lignes', v_lignes, 'moi', v_moi, 'total', v_total);
end $$;

-- ---------------------------------------------------------------------------
-- Profil de collectionneur
-- ---------------------------------------------------------------------------

create or replace function public.quotidien_profil(p_user uuid default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid(); v_cible uuid; m jsonb; pr public.jeu_profils; p record; v_titres jsonb; v_vitrine jsonb; v_total integer; v_rang integer;
begin
  if v_uid is null then raise exception 'Connecte-toi.'; end if;
  v_cible := coalesce(p_user, v_uid);
  if not exists (select 1 from public.jeu_joueurs where user_id = v_cible) then
    if v_cible = v_uid then perform public.jeu_joueur_assurer(v_uid); else raise exception 'Ce collectionneur n''a pas encore joué.'; end if;
  end if;
  select pseudo, avatar_url into p from public.profiles where id = v_cible;
  m := public.quotidien_metriques(v_cible);
  select * into pr from public.jeu_profils where user_id = v_cible;

  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'nom', t.nom, 'description', t.description, 'cadre', t.cadre) order by t.ordre), '[]'::jsonb)
    into v_titres from public.jeu_titres_def t where coalesce((m ->> t.metrique)::integer, 0) >= t.seuil;

  select coalesce(jsonb_agg(jsonb_build_object('booster_id', bc.booster_id, 'artist_id', bc.artist_id, 'nom', c.nom, 'photo', c.photo, 'rarete', bc.rarete,
                                               'numero', bc.numero, 'holo', coalesce((e.value ->> 'holo')::boolean, false), 'classeur', bc.booster_id)
                           order by e.ordinality), '[]'::jsonb)
    into v_vitrine
    from jsonb_array_elements(coalesce(pr.vitrine, '[]'::jsonb)) with ordinality e
    join public.jeu_booster_cartes bc on bc.booster_id = e.value ->> 'booster_id' and bc.artist_id = (e.value ->> 'artist_id')::uuid
    join public.jeu_cartes c on c.artist_id = bc.artist_id
   where exists (select 1 from public.jeu_collection_b col where col.user_id = v_cible and col.booster_id = bc.booster_id and col.artist_id = bc.artist_id and col.quantite > 0);

  select count(*) into v_total from public.jeu_booster_cartes bc join public.jeu_boosters b on b.id = bc.booster_id and b.classeur and b.actif
    join public.jeu_cartes c on c.artist_id = bc.artist_id and c.active;
  select t.rang into v_rang from (select user_id, (rank() over (order by valeur desc))::integer as rang from public.quotidien_valeurs('collection')) t where t.user_id = v_cible;

  return jsonb_build_object(
    'user_id', v_cible, 'moi', v_cible = v_uid, 'pseudo', coalesce(p.pseudo, 'Collectionneur'), 'avatar', p.avatar_url,
    'niveau', (m ->> 'niveau')::integer, 'ouvertures', (m ->> 'ouvertures')::integer, 'uniques', (m ->> 'uniques')::integer, 'total_cartes', v_total,
    'holos', (m ->> 'holos')::integer, 'serie_max', (m ->> 'serie_max')::integer, 'victoires', (m ->> 'victoires')::integer, 'ventes', (m ->> 'ventes')::integer,
    'parcours', (m ->> 'parcours')::integer, 'rang_collection', v_rang,
    'titre', (select jsonb_build_object('id', t.id, 'nom', t.nom) from public.jeu_titres_def t where t.id = pr.titre and exists (select 1 from jsonb_array_elements(v_titres) x where x ->> 'id' = t.id)),
    'cadre', case when pr.user_id is null then 'aucun' else pr.cadre end,
    'titres', v_titres, 'vitrine', v_vitrine);
end $$;

create or replace function public.quotidien_profil_regler(p_vitrine jsonb, p_titre text, p_cadre text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); m jsonb; e jsonb; v_cadres text[]; v_clean jsonb := '[]'::jsonb; v_n integer := 0; v_vus text[] := '{}'; v_cle text;
begin
  if v_uid is null then raise exception 'Connecte-toi.'; end if;
  perform public.jeu_joueur_assurer(v_uid);
  m := public.quotidien_metriques(v_uid);
  p_vitrine := coalesce(p_vitrine, '[]'::jsonb);
  if jsonb_typeof(p_vitrine) <> 'array' or jsonb_array_length(p_vitrine) > 3 then raise exception 'La vitrine accueille 3 cartes au plus.'; end if;

  for e in select * from jsonb_array_elements(p_vitrine) loop
    v_cle := (e ->> 'booster_id') || ':' || (e ->> 'artist_id');
    if v_cle = any (v_vus) then raise exception 'Une carte ne peut être posée qu''une fois.'; end if;
    v_vus := v_vus || v_cle;
    if not exists (select 1 from public.jeu_collection_b col where col.user_id = v_uid and col.booster_id = e ->> 'booster_id' and col.artist_id = (e ->> 'artist_id')::uuid and col.quantite > 0) then
      raise exception 'Tu ne possèdes pas une de ces cartes.';
    end if;
    v_clean := v_clean || jsonb_build_array(jsonb_build_object('booster_id', e ->> 'booster_id', 'artist_id', e ->> 'artist_id',
      'holo', coalesce((e ->> 'holo')::boolean, false) and exists (select 1 from public.jeu_collection_b col where col.user_id = v_uid and col.booster_id = e ->> 'booster_id' and col.artist_id = (e ->> 'artist_id')::uuid and col.holo and col.quantite > 0)));
    v_n := v_n + 1;
  end loop;

  p_titre := nullif(p_titre, '');
  if p_titre is not null and not exists (select 1 from public.jeu_titres_def t where t.id = p_titre and coalesce((m ->> t.metrique)::integer, 0) >= t.seuil) then
    raise exception 'Tu n''as pas encore ce titre.';
  end if;
  p_cadre := coalesce(nullif(p_cadre, ''), 'aucun');
  select coalesce(array_agg(t.cadre), '{}') into v_cadres from public.jeu_titres_def t where coalesce((m ->> t.metrique)::integer, 0) >= t.seuil;
  if p_cadre <> 'aucun' and not (p_cadre = any (v_cadres)) then raise exception 'Tu n''as pas encore ce cadre.'; end if;

  insert into public.jeu_profils (user_id, vitrine, titre, cadre, maj) values (v_uid, v_clean, p_titre, p_cadre, now())
  on conflict (user_id) do update set vitrine = excluded.vitrine, titre = excluded.titre, cadre = excluded.cadre, maj = now();
  return public.quotidien_profil(v_uid);
end $$;

-- ---------------------------------------------------------------------------
-- L'accueil : tout ce qu'il faut pour la première page, en un appel
-- ---------------------------------------------------------------------------

create or replace function public.quotidien_accueil()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid(); v_jour date := public.xp_jour(); v_lundi date := public.jeu_lundi(public.xp_jour()); m jsonb; j public.jeu_joueurs; v_pseudo text;
  v_succes integer; v_parcours integer; v_pc_pris integer; v_pc_total integer; v_ev integer; v_defis integer; v_exp integer; v_art integer := 0; v_nouv integer; v_vu timestamptz;
  v_combat jsonb := null; v_cj record; v_prog jsonb; v_evs jsonb;
begin
  if v_uid is null then raise exception 'Connecte-toi.'; end if;
  perform public.jeu_joueur_assurer(v_uid);
  select * into j from public.jeu_joueurs where user_id = v_uid;
  select pseudo into v_pseudo from public.profiles where id = v_uid;
  m := public.quotidien_metriques(v_uid);

  select count(*) into v_succes from public.jeu_succes_def d
   where coalesce((m ->> d.metrique)::integer, 0) >= d.seuil and not exists (select 1 from public.jeu_reclamations r where r.user_id = v_uid and r.cle = 'succes:' || d.id);

  select count(*) into v_pc_total from public.jeu_parcours_def;
  select count(*) into v_pc_pris from public.jeu_reclamations where user_id = v_uid and cle ~ '^q:pc:p[0-9]{2}$';
  select count(*) into v_parcours from public.jeu_parcours_def d
   where coalesce((m ->> d.metrique)::integer, 0) >= d.seuil and not exists (select 1 from public.jeu_reclamations r where r.user_id = v_uid and r.cle = 'q:pc:' || d.id);
  if v_pc_pris >= v_pc_total and not exists (select 1 from public.jeu_reclamations where user_id = v_uid and cle = 'q:pc:diplome') then v_parcours := v_parcours + 1; end if;

  select count(*) into v_ev from public.jeu_evenements e join public.jeu_evenement_missions em on em.evenement_id = e.id
   where e.actif and e.debut <= v_jour and e.fin >= v_jour
     and public.quotidien_compte(v_uid, em.metrique, e.debut, e.fin) >= em.objectif
     and not exists (select 1 from public.jeu_reclamations r where r.user_id = v_uid and r.cle = 'q:ev:' || e.id || ':m:' || em.id);

  select count(*) into v_defis from public.quotidien_defis_semaine(v_lundi) d
   where public.quotidien_compte(v_uid, d.metrique, v_lundi, v_lundi + 6) >= d.objectif
     and not exists (select 1 from public.jeu_reclamations r where r.user_id = v_uid and r.cle = 'q:df:' || v_lundi || ':' || d.id);

  select count(*) into v_exp from public.jeu_expeditions where user_id = v_uid and etat = 'en_cours' and fin <= now();

  v_prog := public.quotidien_programme();
  if v_prog -> 'artiste' is not null and v_prog -> 'artiste' <> 'null'::jsonb
     and (v_prog -> 'artiste' ->> 'possede')::boolean and not (v_prog -> 'artiste' ->> 'pris')::boolean then v_art := 1; end if;

  select nouveautes_vu into v_vu from public.jeu_lecture where user_id = v_uid;
  select count(*) into v_nouv from public.jeu_nouveautes n where n.actif and n.publie <= v_jour and n.cree_le > coalesce(v_vu, 'epoch'::timestamptz);

  begin
    v_cj := public.combat_joueur_assurer(v_uid);
    v_combat := jsonb_build_object('defi_fait', v_cj.defi_jour is not distinct from v_jour, 'pvp_restants', greatest(0, 10 - v_cj.pvp_jour), 'trophees', v_cj.trophees);
  exception when others then v_combat := null;
  end;

  select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'nom', e.nom, 'accent', e.accent, 'fin', e.fin, 'jours_restants', (e.fin - v_jour) + 1)
                            order by e.fin), '[]'::jsonb)
    into v_evs from public.jeu_evenements e where e.actif and e.debut <= v_jour and e.fin >= v_jour;

  return jsonb_build_object(
    'pseudo', coalesce(v_pseudo, 'collectionneur'), 'niveau', j.niveau, 'serie', case when j.dernier_cadeau >= v_jour - 1 then j.serie else 0 end,
    'pretes', jsonb_build_object('succes', v_succes, 'parcours', v_parcours, 'evenements', v_ev, 'defis', v_defis, 'expeditions', v_exp, 'artiste', v_art),
    'parcours', jsonb_build_object('pris', v_pc_pris, 'total', v_pc_total),
    'combat', v_combat,
    'marche', jsonb_build_object(
        'annonces', (select count(*) from public.marche_annonces where vendeur = v_uid and etat = 'active'),
        'ventes_24h', (select count(*) from public.marche_journal where type = 'vente' and vendeur = v_uid and cree_le > now() - interval '24 hours')),
    'expeditions', jsonb_build_object('en_cours', (select count(*) from public.jeu_expeditions where user_id = v_uid and etat = 'en_cours')),
    'evenements', v_evs, 'programme', v_prog, 'nouveautes', v_nouv);
end $$;

-- « Tout récupérer » : ce que le quotidien sait prendre d'un coup (cadeau, coffre et missions ont déjà leurs fonctions)
create or replace function public.quotidien_tout_prendre()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid(); v_jour date := public.xp_jour(); v_lundi date := public.jeu_lundi(public.xp_jour()); m jsonb; r record;
  v_gain integer := 0; v_n integer := 0; v_cle text; v_plafond constant integer := 8; v_gagne integer; v_g integer; v_pris integer; v_total integer; v_prog jsonb;
begin
  if v_uid is null then raise exception 'Connecte-toi.'; end if;
  perform public.jeu_joueur_assurer(v_uid);
  perform 1 from public.jeu_joueurs where user_id = v_uid for update;
  m := public.quotidien_metriques(v_uid);

  for r in select * from public.jeu_parcours_def order by chapitre, ordre loop
    if coalesce((m ->> r.metrique)::integer, 0) >= r.seuil and public.jeu_reclamer(v_uid, 'q:pc:' || r.id) then
      v_gain := v_gain + r.vinyles; v_n := v_n + 1;
    end if;
  end loop;
  select count(*) into v_pris from public.jeu_reclamations where user_id = v_uid and cle ~ '^q:pc:p[0-9]{2}$';
  select count(*) into v_total from public.jeu_parcours_def;
  if v_pris >= v_total and public.jeu_reclamer(v_uid, 'q:pc:diplome') then v_gain := v_gain + 5; v_n := v_n + 1; end if;

  for r in select e.id as eid, e.debut, e.fin, em.id as mid, em.metrique, em.objectif from public.jeu_evenements e
             join public.jeu_evenement_missions em on em.evenement_id = e.id where e.actif and e.debut <= v_jour and e.fin >= v_jour loop
    if public.quotidien_compte(v_uid, r.metrique, r.debut, r.fin) >= r.objectif and public.jeu_reclamer(v_uid, 'q:ev:' || r.eid || ':m:' || r.mid) then v_n := v_n + 1; end if;
  end loop;

  for r in select * from public.quotidien_defis_semaine(v_lundi) loop
    if public.quotidien_compte(v_uid, r.metrique, v_lundi, v_lundi + 6) >= r.objectif and public.jeu_reclamer(v_uid, 'q:df:' || v_lundi || ':' || r.id) then
      v_gain := v_gain + r.vinyles; v_n := v_n + 1;
    end if;
  end loop;

  select coalesce(sum(gain), 0) into v_gagne from public.jeu_expeditions where user_id = v_uid and etat = 'prise' and (prise_le at time zone 'Europe/Paris')::date = v_jour;
  for r in select * from public.jeu_expeditions where user_id = v_uid and etat = 'en_cours' and fin <= now() order by fin for update loop
    v_g := greatest(0, least(public.quotidien_gain_expedition(r.duree, r.rarete), v_plafond - v_gagne));
    update public.jeu_expeditions set etat = 'prise', gain = v_g, prise_le = now() where id = r.id;
    v_gagne := v_gagne + v_g; v_gain := v_gain + v_g; v_n := v_n + 1;
  end loop;

  v_prog := public.quotidien_programme();
  if v_prog -> 'artiste' is not null and v_prog -> 'artiste' <> 'null'::jsonb and (v_prog -> 'artiste' ->> 'possede')::boolean
     and public.jeu_reclamer(v_uid, 'q:art:' || v_jour) then
    v_gain := v_gain + (v_prog -> 'artiste' ->> 'bonus')::integer; v_n := v_n + 1;
  end if;

  if v_gain > 0 then perform public.jeu_crediter(v_uid, v_gain, 0, 0); end if;
  return jsonb_build_object('gain', v_gain, 'prises', v_n, 'etat', public.jeu_etat_json(v_uid));
end $$;

-- ---------------------------------------------------------------------------
-- Équipe : événements et nouveautés
-- ---------------------------------------------------------------------------

create or replace function public.quotidien_equipe_evenements()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not public.est_equipe() then raise exception 'Réservé à l''équipe.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', e.id, 'nom', e.nom, 'sous_titre', e.sous_titre, 'description', e.description, 'accent', e.accent, 'debut', e.debut, 'fin', e.fin,
      'medaille', e.medaille, 'actif', e.actif,
      'participants', (select count(distinct r.user_id) from public.jeu_reclamations r where r.cle like 'q:ev:' || e.id || ':%'),
      'missions', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'libelle', m.libelle, 'metrique', m.metrique, 'objectif', m.objectif, 'medailles', m.medailles) order by m.ordre, m.id)
                              from public.jeu_evenement_missions m where m.evenement_id = e.id), '[]'::jsonb),
      'recompenses', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'libelle', x.libelle, 'cout', x.cout, 'vinyles', x.vinyles, 'garantis', x.garantis) order by x.ordre, x.id)
                                 from public.jeu_evenement_recompenses x where x.evenement_id = e.id), '[]'::jsonb)) order by e.debut desc)
    from public.jeu_evenements e), '[]'::jsonb);
end $$;

create or replace function public.quotidien_equipe_evenement_sauver(p jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_id text := lower(btrim(coalesce(p ->> 'id', ''))); v_ids bigint[]; v_nouveau boolean;
begin
  if not public.est_equipe() then raise exception 'Réservé à l''équipe.'; end if;
  if v_id !~ '^[a-z0-9-]{2,40}$' then raise exception 'L''identifiant doit faire 2 à 40 caractères : lettres minuscules, chiffres et tirets.'; end if;
  if coalesce(btrim(p ->> 'nom'), '') = '' then raise exception 'Donne un nom à l''événement.'; end if;
  if (p ->> 'debut') is null or (p ->> 'fin') is null then raise exception 'Choisis les dates de début et de fin.'; end if;
  if (p ->> 'fin')::date < (p ->> 'debut')::date then raise exception 'La fin ne peut pas précéder le début.'; end if;
  if coalesce(p ->> 'accent', '#4FB4FF') !~ '^#[0-9a-fA-F]{6}$' then raise exception 'Couleur invalide (ex. #4FB4FF).'; end if;

  v_nouveau := not exists (select 1 from public.jeu_evenements where id = v_id);
  insert into public.jeu_evenements (id, nom, sous_titre, description, accent, debut, fin, medaille, actif)
  values (v_id, btrim(p ->> 'nom'), coalesce(p ->> 'sous_titre', ''), coalesce(p ->> 'description', ''), coalesce(p ->> 'accent', '#4FB4FF'),
          (p ->> 'debut')::date, (p ->> 'fin')::date, coalesce(nullif(btrim(p ->> 'medaille'), ''), 'Médailles'), coalesce((p ->> 'actif')::boolean, true))
  on conflict (id) do update set nom = excluded.nom, sous_titre = excluded.sous_titre, description = excluded.description, accent = excluded.accent,
      debut = excluded.debut, fin = excluded.fin, medaille = excluded.medaille, actif = excluded.actif;

  -- Missions : on met à jour celles qui ont un identifiant, on crée les autres, on retire les absentes
  select coalesce(array_agg((x ->> 'id')::bigint), '{}') into v_ids from jsonb_array_elements(coalesce(p -> 'missions', '[]'::jsonb)) x where nullif(x ->> 'id', '') is not null;
  delete from public.jeu_evenement_missions where evenement_id = v_id and not (id = any (v_ids));
  update public.jeu_evenement_missions m set libelle = x.libelle, metrique = x.metrique, objectif = x.objectif, medailles = x.medailles, ordre = x.ordre
    from (select (e.value ->> 'id')::bigint as id, e.value ->> 'libelle' as libelle, e.value ->> 'metrique' as metrique, (e.value ->> 'objectif')::integer as objectif,
                 (e.value ->> 'medailles')::integer as medailles, (e.ordinality)::integer as ordre
            from jsonb_array_elements(coalesce(p -> 'missions', '[]'::jsonb)) with ordinality e where nullif(e.value ->> 'id', '') is not null) x
   where m.id = x.id and m.evenement_id = v_id;
  insert into public.jeu_evenement_missions (evenement_id, libelle, metrique, objectif, medailles, ordre)
    select v_id, e.value ->> 'libelle', e.value ->> 'metrique', (e.value ->> 'objectif')::integer, (e.value ->> 'medailles')::integer, e.ordinality::integer
      from jsonb_array_elements(coalesce(p -> 'missions', '[]'::jsonb)) with ordinality e where nullif(e.value ->> 'id', '') is null;

  select coalesce(array_agg((x ->> 'id')::bigint), '{}') into v_ids from jsonb_array_elements(coalesce(p -> 'recompenses', '[]'::jsonb)) x where nullif(x ->> 'id', '') is not null;
  delete from public.jeu_evenement_recompenses where evenement_id = v_id and not (id = any (v_ids));
  update public.jeu_evenement_recompenses r set libelle = x.libelle, cout = x.cout, vinyles = x.vinyles, garantis = x.garantis, ordre = x.ordre
    from (select (e.value ->> 'id')::bigint as id, e.value ->> 'libelle' as libelle, (e.value ->> 'cout')::integer as cout,
                 coalesce((e.value ->> 'vinyles')::integer, 0) as vinyles, coalesce((e.value ->> 'garantis')::integer, 0) as garantis, (e.ordinality)::integer as ordre
            from jsonb_array_elements(coalesce(p -> 'recompenses', '[]'::jsonb)) with ordinality e where nullif(e.value ->> 'id', '') is not null) x
   where r.id = x.id and r.evenement_id = v_id;
  insert into public.jeu_evenement_recompenses (evenement_id, libelle, cout, vinyles, garantis, ordre)
    select v_id, e.value ->> 'libelle', (e.value ->> 'cout')::integer, coalesce((e.value ->> 'vinyles')::integer, 0), coalesce((e.value ->> 'garantis')::integer, 0), e.ordinality::integer
      from jsonb_array_elements(coalesce(p -> 'recompenses', '[]'::jsonb)) with ordinality e where nullif(e.value ->> 'id', '') is null;

  insert into public.jeu_equipe_journal (auteur, action, detail)
  values (auth.uid(), case when v_nouveau then 'evenement_creer' else 'evenement_modifier' end, jsonb_build_object('evenement', v_id, 'nom', p ->> 'nom'));
  return public.quotidien_equipe_evenements();
exception when check_violation then
  raise exception 'Une valeur de l''événement est hors limites (objectifs 1 à 100 000, médailles 1 à 100, coûts 1 à 10 000, récompenses 1 à 50 vinyles).';
end $$;

create or replace function public.quotidien_equipe_evenement_supprimer(p_id text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.est_equipe() then raise exception 'Réservé à l''équipe.'; end if;
  delete from public.jeu_evenements where id = p_id;
  insert into public.jeu_equipe_journal (auteur, action, detail) values (auth.uid(), 'evenement_supprimer', jsonb_build_object('evenement', p_id));
  return public.quotidien_equipe_evenements();
end $$;

create or replace function public.quotidien_equipe_nouveautes()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not public.est_equipe() then raise exception 'Réservé à l''équipe.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'titre', n.titre, 'texte', n.texte, 'etiquette', n.etiquette, 'publie', n.publie, 'actif', n.actif) order by n.publie desc, n.id desc)
                     from public.jeu_nouveautes n), '[]'::jsonb);
end $$;

create or replace function public.quotidien_equipe_nouveaute_sauver(p jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.est_equipe() then raise exception 'Réservé à l''équipe.'; end if;
  if char_length(btrim(coalesce(p ->> 'titre', ''))) < 3 then raise exception 'Le titre doit faire au moins 3 caractères.'; end if;
  if nullif(p ->> 'id', '') is null then
    insert into public.jeu_nouveautes (titre, texte, etiquette, publie, actif)
    values (btrim(p ->> 'titre'), coalesce(p ->> 'texte', ''), coalesce(nullif(btrim(p ->> 'etiquette'), ''), 'Nouveau'), coalesce((p ->> 'publie')::date, current_date), coalesce((p ->> 'actif')::boolean, true));
  else
    update public.jeu_nouveautes set titre = btrim(p ->> 'titre'), texte = coalesce(p ->> 'texte', ''), etiquette = coalesce(nullif(btrim(p ->> 'etiquette'), ''), 'Nouveau'),
           publie = coalesce((p ->> 'publie')::date, publie), actif = coalesce((p ->> 'actif')::boolean, actif)
     where id = (p ->> 'id')::bigint;
  end if;
  insert into public.jeu_equipe_journal (auteur, action, detail) values (auth.uid(), 'nouveaute_sauver', jsonb_build_object('titre', p ->> 'titre'));
  return public.quotidien_equipe_nouveautes();
exception when check_violation then
  raise exception 'Le titre fait 90 caractères au plus, le texte 600, l''étiquette 20.';
end $$;

create or replace function public.quotidien_equipe_nouveaute_supprimer(p_id bigint)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.est_equipe() then raise exception 'Réservé à l''équipe.'; end if;
  delete from public.jeu_nouveautes where id = p_id;
  insert into public.jeu_equipe_journal (auteur, action, detail) values (auth.uid(), 'nouveaute_supprimer', jsonb_build_object('id', p_id));
  return public.quotidien_equipe_nouveautes();
end $$;

-- ---------------------------------------------------------------------------
-- Droits : les fonctions internes ne sont à personne, les autres aux connectés
-- ---------------------------------------------------------------------------

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'quotidien\_%' loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    if f.proname not in ('quotidien_compte', 'quotidien_metriques', 'quotidien_valeurs', 'quotidien_gain_expedition', 'quotidien_defis_semaine') then
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
  end loop;
end $$;
