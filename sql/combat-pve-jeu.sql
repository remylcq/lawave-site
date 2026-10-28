-- Wave Cards : les modes de combat contre le jeu — les fonctions (2026-10-28).
-- Tour, Champions, Ligue : chaque mode a une fonction de lancement (qui appelle combat_creer) et une fonction de fin
-- combat_fin_<mode> (appelée UNE fois par combat_conclure : elle verse les gains et fait avancer la progression).
-- Les données et les réglages sont dans sql/combat-pve-donnees.sql. Récompenses : vinyles (jeu_crediter) et Wave Coins (wc_crediter,
-- idempotent par motif + référence : une récompense ne peut jamais être versée deux fois).
-- Les gains renvoyés à l'écran de fin : {vinyles: n, "WC": n} (les clés numériques sont affichées telles quelles par combat.js).

-- ---------------------------------------------------------------------------------------------------------------------------
-- Outils
-- ---------------------------------------------------------------------------------------------------------------------------

create or replace function public.combat_pve_reglage(p_cle text) returns integer
language sql stable set search_path to 'public' as
$$ select coalesce((select valeur from public.combat_pve_reglages where cle = p_cle), 0) $$;

-- Le n-ième artiste du classement par fans (1 = le plus connu).
create or replace function public.combat_pve_artiste(p_rang integer) returns uuid
language sql stable set search_path to 'public' as
$$ select artist_id from public.jeu_cartes where active order by fans desc nulls last, artist_id offset greatest(p_rang, 1) - 1 limit 1 $$;

-- Un duo sans les champs lourds (techniques, passif…) : pour l'affichage.
create or replace function public.combat_pve_apercu(p_unites jsonb) returns jsonb
language sql immutable set search_path to 'public' as
$$ select coalesce(jsonb_agg(u - 'techs' - 'capacite' - 'cd' - 'statuts'), '[]'::jsonb) from jsonb_array_elements(p_unites) u $$;

-- Mémorise le duo choisi (comme le font les modes intégrés) : la fenêtre d'équipe le proposera la prochaine fois.
create or replace function public.combat_pve_memoriser(p_user uuid, p_duo jsonb) returns void
language plpgsql security definer set search_path to 'public' as $$
begin
  delete from public.combat_equipes where user_id = p_user and role = 'principal';
  insert into public.combat_equipes (user_id, role, slot, booster_id, artist_id, holo)
  select p_user, 'principal', (ord)::smallint, d ->> 'booster', (d ->> 'artist')::uuid, coalesce((d ->> 'holo')::boolean, false)
    from jsonb_array_elements(p_duo) with ordinality as t (d, ord);
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------
-- La Tour
-- ---------------------------------------------------------------------------------------------------------------------------

-- L'équipe adverse d'un étage : toujours la même pour un étage donné (tirée par un hasard fixe), de plus en plus connue en montant.
create or replace function public.combat_tour_equipe(p_diff text, p_etage integer) returns jsonb
language plpgsql stable set search_path to 'public' as $$
declare
  d public.combat_tour_difficultes; n integer; frac numeric; centre integer; marge integer; r1 integer; r2 integer;
  v_gardien boolean; v_rar integer; v_bonus integer; v_decor text;
begin
  select * into d from public.combat_tour_difficultes where id = p_diff and actif;
  if not found then raise exception 'Difficulté inconnue.'; end if;
  if p_etage is null or p_etage < 1 or p_etage > d.etages then raise exception 'Cet étage n''existe pas.'; end if;
  select count(*) into n from public.jeu_cartes where active;
  if n < 4 then raise exception 'Pas assez d''artistes pour bâtir la Tour.'; end if;
  v_gardien := p_etage % 10 = 0;
  frac := case when d.etages > 1 then (p_etage - 1)::numeric / (d.etages - 1) else 1 end;
  centre := 1 + round(power(1 - frac, 1.6) * (n - 1))::integer;
  if v_gardien then centre := greatest(1, round(centre * 0.6)::integer); end if;
  marge := greatest(3, n / 40);
  r1 := least(n, greatest(1, centre + (abs(hashtext(d.id || ':' || p_etage || ':a')::bigint) % (2 * marge + 1))::integer - marge));
  r2 := least(n, greatest(1, centre + (abs(hashtext(d.id || ':' || p_etage || ':b')::bigint) % (2 * marge + 1))::integer - marge));
  if r2 = r1 then r2 := case when r1 < n then r1 + 1 else r1 - 1 end; end if;
  v_rar := least(5, 1 + floor(frac * 4)::integer + d.rarete_plus + case when v_gardien then 1 else 0 end);
  v_bonus := round(d.bonus_base + d.bonus_etage * p_etage + case when v_gardien then d.bonus_gardien else 0 end)::integer;
  v_decor := case when v_gardien then (case when p_etage % 20 = 0 then 'toit' else 'concert' end)
                  else (array['ruelle', 'studio', 'plateau'])[1 + ((p_etage - 1) / 10) % 3] end;
  return jsonb_build_object('etage', p_etage, 'gardien', v_gardien, 'decor', v_decor, 'bonus', v_bonus, 'rarete', v_rar,
    'nom', case when v_gardien then 'Gardien du palier ' || p_etage else 'Étage ' || p_etage end,
    'crew', jsonb_build_array(public.combat_unite(public.combat_pve_artiste(r1), v_rar, false, v_bonus),
                              public.combat_unite(public.combat_pve_artiste(r2), v_rar, false, v_bonus)));
end $$;

-- Ce que rapporte la première victoire sur un étage : des Wave Coins à chaque étage, des vinyles en plus sur un gardien.
create or replace function public.combat_tour_recompense(p_diff text, p_etage integer) returns jsonb
language plpgsql stable set search_path to 'public' as $$
declare d public.combat_tour_difficultes; v_wc integer; v_vin integer := 0;
begin
  select * into d from public.combat_tour_difficultes where id = p_diff;
  if not found then return jsonb_build_object('vinyles', 0, 'wc', 0); end if;
  v_wc := greatest(1, round(d.mult_wc * (1 + p_etage / 10.0))::integer);
  if p_etage % 10 = 0 then
    v_wc := v_wc + round(d.mult_wc * 20)::integer;
    v_vin := greatest(1, round(d.mult_vinyles * (1 + p_etage / 40))::integer);
  end if;
  return jsonb_build_object('vinyles', v_vin, 'wc', v_wc);
end $$;

-- Une difficulté est ouverte quand le joueur a atteint l'étage demandé dans la précédente.
create or replace function public.combat_tour_debloque(p_user uuid, p_diff text) returns boolean
language sql stable security definer set search_path to 'public' as
$$ select coalesce((
     select coalesce(pp.etage_max, 0) >= d.deblocage_etage
       from public.combat_tour_difficultes d
       join lateral (select pd.id from public.combat_tour_difficultes pd where pd.actif and pd.ordre < d.ordre order by pd.ordre desc limit 1) prev on true
       left join public.combat_tour_progres pp on pp.user_id = p_user and pp.difficulte = prev.id
      where d.id = p_diff), true) $$;

create or replace function public.combat_pve_tour(p_difficulte text, p_etage integer, p_duo jsonb, p_options jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid(); d public.combat_tour_difficultes; v_max integer; v_etage integer; v_info jsonb; v_mine jsonb; v_id uuid;
begin
  if v_uid is null then raise exception 'Connecte-toi.'; end if;
  perform public.jeu_joueur_assurer(v_uid);
  perform public.combat_expirer(v_uid);
  select * into d from public.combat_tour_difficultes where id = p_difficulte and actif;
  if not found then raise exception 'Difficulté inconnue.'; end if;
  if not public.combat_tour_debloque(v_uid, d.id) then raise exception 'Cette difficulté n''est pas encore débloquée.'; end if;
  select etage_max into v_max from public.combat_tour_progres where user_id = v_uid and difficulte = d.id;
  v_max := coalesce(v_max, 0);
  if p_etage is null and v_max >= d.etages then raise exception 'Tu as gravi toute la Tour à cette difficulté : rejoue l''étage de ton choix.'; end if;
  v_etage := coalesce(p_etage, v_max + 1);
  if v_etage < 1 or v_etage > d.etages then raise exception 'Cet étage n''existe pas.'; end if;
  if v_etage > v_max + 1 then raise exception 'Gravis d''abord l''étage %.', v_max + 1; end if;
  v_mine := public.combat_duo_unites(v_uid, p_duo);
  v_info := public.combat_tour_equipe(d.id, v_etage);
  perform public.combat_pve_memoriser(v_uid, p_duo);
  v_id := public.combat_creer(v_uid, 'pve_tour', d.nom || ' · ' || (v_info ->> 'nom'), v_info ->> 'decor', v_mine, v_info -> 'crew',
                              d.id || ':' || v_etage, null, p_options);
  return public.combat_partie_json(v_id);
end $$;

create or replace function public.combat_fin_pve_tour(p_partie uuid, p_victoire boolean, p_abandon boolean) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  p public.combat_parties; v_diff text; v_etage integer; v_max integer; rec jsonb; v_wc integer := 0; v_vin integer := 0; v_gains jsonb := '{}'::jsonb;
begin
  select * into p from public.combat_parties where id = p_partie;
  if not found then return '{}'::jsonb; end if;
  v_diff := split_part(coalesce(p.cible, ''), ':', 1);
  begin v_etage := nullif(split_part(coalesce(p.cible, ''), ':', 2), '')::integer; exception when others then v_etage := null; end;
  if v_etage is null or not exists (select 1 from public.combat_tour_difficultes where id = v_diff) then return '{}'::jsonb; end if;
  insert into public.combat_tour_progres (user_id, difficulte, victoires, defaites)
  values (p.user_id, v_diff, case when p_victoire then 1 else 0 end, case when p_victoire or p_abandon then 0 else 1 end)
  on conflict (user_id, difficulte) do update
    set victoires = public.combat_tour_progres.victoires + excluded.victoires, defaites = public.combat_tour_progres.defaites + excluded.defaites, maj = now();
  if not p_victoire then return '{}'::jsonb; end if;
  select etage_max into v_max from public.combat_tour_progres where user_id = p.user_id and difficulte = v_diff for update;
  if v_etage > v_max then
    update public.combat_tour_progres set etage_max = v_etage, maj = now() where user_id = p.user_id and difficulte = v_diff;
    rec := public.combat_tour_recompense(v_diff, v_etage);
    v_vin := (rec ->> 'vinyles')::integer;
    v_wc := (rec ->> 'wc')::integer;
    if v_wc > 0 then v_wc := public.wc_crediter(p.user_id, v_wc, 'pve:tour:' || v_diff, v_etage::text); end if;
    if v_vin > 0 then perform public.jeu_crediter(p.user_id, v_vin, 0, 0); end if;
    v_gains := jsonb_build_object('premiere', true, 'etage_atteint', v_etage::text);
    if v_vin > 0 then v_gains := v_gains || jsonb_build_object('vinyles', v_vin); end if;
    if v_wc > 0 then v_gains := v_gains || jsonb_build_object('WC', v_wc); end if;
  end if;
  return v_gains;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------
-- Les champions
-- ---------------------------------------------------------------------------------------------------------------------------

-- Le champion du jour : un style qui tourne chaque jour, deux artistes connus de ce style tirés au sort (toujours les mêmes ce jour-là).
create or replace function public.combat_champion_jour(p_jour date) returns jsonb
language plpgsql stable set search_path to 'public' as $$
declare t public.combat_types; n integer; v_crew jsonb := '[]'::jsonb; x record; v_rar integer; v_bonus integer;
begin
  select count(*) into n from public.combat_types;
  select * into t from public.combat_types order by ordre offset (((p_jour - date '2026-01-01') + 4) % n + n) % n limit 1;
  v_rar := least(greatest(public.combat_pve_reglage('champion_jour_rarete'), 1), 5);
  v_bonus := public.combat_pve_reglage('champion_jour_bonus');
  for x in
    select s.artist_id from (select artist_id from public.jeu_cartes where active order by fans desc nulls last, artist_id limit 150) s
     order by (public.combat_type_de(s.artist_id) = t.id) desc, md5(s.artist_id::text || p_jour::text || 'cdj') limit 2
  loop
    v_crew := v_crew || public.combat_unite(x.artist_id, v_rar, false, v_bonus);
  end loop;
  if jsonb_array_length(v_crew) < 2 then raise exception 'Pas de champion du jour pour le moment.'; end if;
  return jsonb_build_object('jour', p_jour, 'type', t.id, 'type_nom', t.nom, 'couleur', t.couleur, 'nom', 'Champion du jour · ' || t.nom,
                            'decor', 'concert', 'bonus', v_bonus, 'rarete', v_rar, 'crew', v_crew);
end $$;

create or replace function public.combat_pve_champion(p_champion text, p_duo jsonb, p_options jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid(); c public.combat_champions; v_info jsonb; v_mine jsonb; v_id uuid; v_titre text; v_decor text; v_crew jsonb; v_cible text;
begin
  if v_uid is null then raise exception 'Connecte-toi.'; end if;
  perform public.jeu_joueur_assurer(v_uid);
  perform public.combat_expirer(v_uid);
  if p_champion = 'jour' then
    v_info := public.combat_champion_jour(public.xp_jour());
    v_titre := v_info ->> 'nom'; v_decor := v_info ->> 'decor'; v_crew := v_info -> 'crew'; v_cible := 'jour:' || (v_info ->> 'jour');
  else
    select * into c from public.combat_champions where id = p_champion and actif;
    if not found then raise exception 'Champion inconnu.'; end if;
    v_titre := c.nom; v_decor := c.decor; v_cible := c.id;
    v_crew := jsonb_build_array(public.combat_unite(c.artist1, c.rarete1, false, c.bonus), public.combat_unite(c.artist2, c.rarete2, false, c.bonus));
  end if;
  v_mine := public.combat_duo_unites(v_uid, p_duo);
  perform public.combat_pve_memoriser(v_uid, p_duo);
  v_id := public.combat_creer(v_uid, 'pve_champion', v_titre, v_decor, v_mine, v_crew, v_cible, null, p_options);
  return public.combat_partie_json(v_id);
end $$;

create or replace function public.combat_fin_pve_champion(p_partie uuid, p_victoire boolean, p_abandon boolean) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  p public.combat_parties; c public.combat_champions; v_jour date := public.xp_jour(); v_n integer; v_vin integer := 0; v_wc integer := 0;
  v_gains jsonb := '{}'::jsonb; v_rev integer; v_id text;
begin
  select * into p from public.combat_parties where id = p_partie;
  if not found or not p_victoire then return '{}'::jsonb; end if;
  v_id := coalesce(p.cible, '');

  if v_id like 'jour:%' then
    insert into public.combat_pve_jour as j (user_id, jour, champion_jour) values (p.user_id, v_jour, true)
    on conflict (user_id, jour) do update set champion_jour = true where j.champion_jour = false;
    get diagnostics v_n = row_count;
    if v_n > 0 then
      v_vin := public.combat_pve_reglage('champion_jour_vinyles');
      v_wc := public.combat_pve_reglage('champion_jour_wc');
      if v_wc > 0 then v_wc := public.wc_crediter(p.user_id, v_wc, 'pve:champion-jour', v_jour::text); end if;
      v_gains := jsonb_build_object('premiere', true);
    end if;
  else
    select * into c from public.combat_champions where id = v_id;
    if not found then return '{}'::jsonb; end if;
    insert into public.combat_champions_progres (user_id, champion) values (p.user_id, c.id) on conflict do nothing;
    get diagnostics v_n = row_count;
    if v_n > 0 then
      v_vin := c.vinyles;
      v_wc := c.wc;
      if v_wc > 0 then v_wc := public.wc_crediter(p.user_id, v_wc, 'pve:champion', c.id); end if;
      v_gains := jsonb_build_object('premiere', true);
    else
      update public.combat_champions_progres set victoires = victoires + 1 where user_id = p.user_id and champion = c.id;
      select revanches into v_rev from public.combat_pve_jour where user_id = p.user_id and jour = v_jour;
      if coalesce(v_rev, 0) < public.combat_pve_reglage('champion_revanche_max') then
        update public.combat_champions_progres set revanche_jour = v_jour
         where user_id = p.user_id and champion = c.id and revanche_jour is distinct from v_jour;
        get diagnostics v_n = row_count;
        if v_n > 0 then
          insert into public.combat_pve_jour as j (user_id, jour, revanches) values (p.user_id, v_jour, 1)
          on conflict (user_id, jour) do update set revanches = j.revanches + 1;
          v_wc := public.combat_pve_reglage('champion_revanche_wc');
          if v_wc > 0 then v_wc := public.wc_crediter(p.user_id, v_wc, 'pve:revanche', c.id || ':' || v_jour::text); end if;
          v_gains := jsonb_build_object('revanche', true);
        end if;
      end if;
    end if;
  end if;

  if v_vin > 0 then perform public.jeu_crediter(p.user_id, v_vin, 0, 0); v_gains := v_gains || jsonb_build_object('vinyles', v_vin); end if;
  if v_wc > 0 then v_gains := v_gains || jsonb_build_object('WC', v_wc); end if;
  return v_gains;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------
-- La Ligue
-- ---------------------------------------------------------------------------------------------------------------------------

create or replace function public.combat_pve_ligue(p_duo jsonb, p_options jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid(); v_jour date := public.xp_jour(); e public.combat_ligue_essais; m public.combat_ligue; v_total integer; v_mine jsonb; v_id uuid;
begin
  if v_uid is null then raise exception 'Connecte-toi.'; end if;
  perform public.jeu_joueur_assurer(v_uid);
  perform public.combat_expirer(v_uid);
  insert into public.combat_ligue_essais (user_id, jour, vies) values (v_uid, v_jour, greatest(1, public.combat_pve_reglage('ligue_vies')))
  on conflict (user_id, jour) do nothing;
  select * into e from public.combat_ligue_essais where user_id = v_uid and jour = v_jour for update;
  if e.etat = 'gagnee' then raise exception 'Tu as déjà vaincu la Ligue aujourd''hui. Reviens demain !'; end if;
  if e.etat = 'perdue' then raise exception 'Ta tentative du jour est terminée. Reviens demain !'; end if;
  select count(*) into v_total from public.combat_ligue;
  select * into m from public.combat_ligue where rang = e.etape + 1;
  if not found then raise exception 'La Ligue n''est pas prête pour le moment.'; end if;
  v_mine := public.combat_duo_unites(v_uid, p_duo);
  perform public.combat_pve_memoriser(v_uid, p_duo);
  v_id := public.combat_creer(v_uid, 'pve_ligue', m.nom || ' (' || m.rang || '/' || v_total || ')', m.decor, v_mine,
           jsonb_build_array(public.combat_unite(m.artist1, m.rarete1, false, m.bonus), public.combat_unite(m.artist2, m.rarete2, false, m.bonus)),
           'ligue:' || m.rang || ':' || v_jour::text, null, p_options);
  return public.combat_partie_json(v_id);
end $$;

create or replace function public.combat_fin_pve_ligue(p_partie uuid, p_victoire boolean, p_abandon boolean) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  p public.combat_parties; e public.combat_ligue_essais; v_rang integer; v_jour date; v_total integer; v_premiere boolean; v_parfait boolean;
  v_vin integer := 0; v_wc integer := 0; v_gains jsonb := '{}'::jsonb; v_w integer;
begin
  select * into p from public.combat_parties where id = p_partie;
  if not found then return '{}'::jsonb; end if;
  begin
    v_rang := split_part(coalesce(p.cible, ''), ':', 2)::integer;
    v_jour := split_part(coalesce(p.cible, ''), ':', 3)::date;
  exception when others then return '{}'::jsonb;
  end;
  select * into e from public.combat_ligue_essais where user_id = p.user_id and jour = v_jour for update;
  if not found or e.etat <> 'en_cours' then return '{}'::jsonb; end if;
  select count(*) into v_total from public.combat_ligue;

  if not p_victoire then
    update public.combat_ligue_essais
       set defaites = defaites + 1, etat = case when defaites + 1 >= vies then 'perdue' else 'en_cours' end, maj = now()
     where user_id = p.user_id and jour = v_jour;
    return jsonb_build_object('ligue', case when e.defaites + 1 >= e.vies then 'perdue' else 'suite' end);
  end if;

  if v_rang < v_total then
    update public.combat_ligue_essais set etape = greatest(etape, v_rang), maj = now() where user_id = p.user_id and jour = v_jour;
    return jsonb_build_object('ligue', 'suite');
  end if;

  -- Dernier combat gagné : la Ligue est à toi.
  v_parfait := e.defaites = 0;
  v_premiere := not exists (select 1 from public.combat_ligue_essais where user_id = p.user_id and etat = 'gagnee');
  update public.combat_ligue_essais set etape = v_total, etat = 'gagnee', parfait = v_parfait, maj = now() where user_id = p.user_id and jour = v_jour;
  v_vin := public.combat_pve_reglage('ligue_vinyles');
  v_w := public.combat_pve_reglage('ligue_wc');
  if v_parfait then
    v_vin := v_vin + public.combat_pve_reglage('ligue_parfait_vinyles');
    v_w := v_w + public.combat_pve_reglage('ligue_parfait_wc');
  end if;
  if v_premiere then
    v_vin := v_vin + public.combat_pve_reglage('ligue_premiere_vinyles');
    v_w := v_w + public.combat_pve_reglage('ligue_premiere_wc');
  end if;
  if v_w > 0 then v_wc := public.wc_crediter(p.user_id, v_w, 'pve:ligue', v_jour::text); end if;
  if v_vin > 0 then perform public.jeu_crediter(p.user_id, v_vin, 0, 0); v_gains := v_gains || jsonb_build_object('vinyles', v_vin); end if;
  if v_wc > 0 then v_gains := v_gains || jsonb_build_object('WC', v_wc); end if;
  return v_gains || jsonb_build_object('ligue', 'gagnee', 'parfait', v_parfait, 'premiere', v_premiere);
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------
-- L'accueil des trois modes (une seule lecture pour toute la page)
-- ---------------------------------------------------------------------------------------------------------------------------

create or replace function public.combat_pve_accueil() returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid(); v_jour date := public.xp_jour(); v_tour jsonb; v_champions jsonb; v_jour_info jsonb; v_ligue jsonb;
  e public.combat_ligue_essais; v_total integer; v_rev integer; v_revmax integer := public.combat_pve_reglage('champion_revanche_max'); v_cdj boolean;
begin
  if v_uid is null then raise exception 'Connecte-toi.'; end if;
  perform public.jeu_joueur_assurer(v_uid);

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', d.id, 'nom', d.nom, 'resume', d.resume, 'etages', d.etages, 'etage_max', coalesce(p.etage_max, 0),
      'victoires', coalesce(p.victoires, 0), 'defaites', coalesce(p.defaites, 0),
      'debloque', public.combat_tour_debloque(v_uid, d.id), 'deblocage_etage', d.deblocage_etage,
      'precedente', (select pd.nom from public.combat_tour_difficultes pd where pd.actif and pd.ordre < d.ordre order by pd.ordre desc limit 1),
      'prochain', case when coalesce(p.etage_max, 0) < d.etages and public.combat_tour_debloque(v_uid, d.id) then
          (public.combat_tour_equipe(d.id, coalesce(p.etage_max, 0) + 1) - 'crew')
          || jsonb_build_object('crew', public.combat_pve_apercu(public.combat_tour_equipe(d.id, coalesce(p.etage_max, 0) + 1) -> 'crew'),
                                'recompense', public.combat_tour_recompense(d.id, coalesce(p.etage_max, 0) + 1)) end,
      'gardiens', (select coalesce(jsonb_agg(jsonb_build_object('etage', g, 'fait', g <= coalesce(p.etage_max, 0),
                         'recompense', public.combat_tour_recompense(d.id, g)) order by g), '[]'::jsonb) from generate_series(10, d.etages, 10) g)
    ) order by d.ordre), '[]'::jsonb)
    into v_tour
    from public.combat_tour_difficultes d
    left join public.combat_tour_progres p on p.user_id = v_uid and p.difficulte = d.id
   where d.actif;

  select revanches, champion_jour into v_rev, v_cdj from public.combat_pve_jour where user_id = v_uid and jour = v_jour;
  v_rev := coalesce(v_rev, 0);
  v_cdj := coalesce(v_cdj, false);

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id, 'nom', c.nom, 'description', c.description, 'type', c.type, 'type_nom', t.nom, 'couleur', t.couleur, 'bonus', c.bonus,
      'etat', case when g.user_id is null then 'nouveau' else 'vaincu' end, 'victoires', coalesce(g.victoires, 0),
      'recompense', jsonb_build_object('vinyles', c.vinyles, 'wc', c.wc),
      'revanche_prete', g.user_id is not null and g.revanche_jour is distinct from v_jour and v_rev < v_revmax,
      'crew', public.combat_pve_apercu(jsonb_build_array(public.combat_unite(c.artist1, c.rarete1, false, c.bonus), public.combat_unite(c.artist2, c.rarete2, false, c.bonus)))
    ) order by c.ordre, c.id), '[]'::jsonb)
    into v_champions
    from public.combat_champions c join public.combat_types t on t.id = c.type
    left join public.combat_champions_progres g on g.user_id = v_uid and g.champion = c.id
   where c.actif;

  v_jour_info := public.combat_champion_jour(v_jour);
  v_jour_info := (v_jour_info - 'crew') || jsonb_build_object('crew', public.combat_pve_apercu(v_jour_info -> 'crew'), 'fait', v_cdj,
                    'recompense', jsonb_build_object('vinyles', public.combat_pve_reglage('champion_jour_vinyles'), 'wc', public.combat_pve_reglage('champion_jour_wc')));

  select * into e from public.combat_ligue_essais where user_id = v_uid and jour = v_jour;
  select count(*) into v_total from public.combat_ligue;
  v_ligue := jsonb_build_object(
    'etat', coalesce(e.etat, 'libre'), 'etape', coalesce(e.etape, 0), 'defaites', coalesce(e.defaites, 0),
    'vies', coalesce(e.vies, greatest(1, public.combat_pve_reglage('ligue_vies'))), 'parfait', coalesce(e.parfait, false),
    'premiere_faite', exists (select 1 from public.combat_ligue_essais x where x.user_id = v_uid and x.etat = 'gagnee'),
    'victoires', (select count(*) from public.combat_ligue_essais x where x.user_id = v_uid and x.etat = 'gagnee'),
    'recompenses', jsonb_build_object(
      'vinyles', public.combat_pve_reglage('ligue_vinyles'), 'wc', public.combat_pve_reglage('ligue_wc'),
      'parfait_vinyles', public.combat_pve_reglage('ligue_parfait_vinyles'), 'parfait_wc', public.combat_pve_reglage('ligue_parfait_wc'),
      'premiere_vinyles', public.combat_pve_reglage('ligue_premiere_vinyles'), 'premiere_wc', public.combat_pve_reglage('ligue_premiere_wc')),
    'membres', (select coalesce(jsonb_agg(jsonb_build_object(
        'rang', l.rang, 'nom', l.nom, 'description', l.description, 'bonus', l.bonus, 'maitre', l.rang = v_total,
        'etat', case when l.rang <= coalesce(e.etape, 0) then 'vaincu' when l.rang = coalesce(e.etape, 0) + 1 and coalesce(e.etat, 'libre') in ('libre', 'en_cours') then 'actuel' else 'a_venir' end,
        'crew', public.combat_pve_apercu(jsonb_build_array(public.combat_unite(l.artist1, l.rarete1, false, l.bonus), public.combat_unite(l.artist2, l.rarete2, false, l.bonus)))
      ) order by l.rang), '[]'::jsonb) from public.combat_ligue l));

  return jsonb_build_object('tour', v_tour, 'champions', v_champions, 'champion_jour', v_jour_info,
                            'revanches_restantes', greatest(0, v_revmax - v_rev), 'ligue', v_ligue);
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------
-- La console de l'équipe
-- ---------------------------------------------------------------------------------------------------------------------------

create or replace function public.combat_pve_equipe_lire() returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
begin
  perform public.combat_equipe_garde();
  return jsonb_build_object(
    'reglages', (select coalesce(jsonb_agg(jsonb_build_object('cle', r.cle, 'valeur', r.valeur, 'libelle', r.libelle) order by r.ordre), '[]'::jsonb) from public.combat_pve_reglages r),
    'difficultes', (select coalesce(jsonb_agg(to_jsonb(d) order by d.ordre), '[]'::jsonb) from public.combat_tour_difficultes d),
    'champions', (select coalesce(jsonb_agg(to_jsonb(c) || jsonb_build_object('type_nom', t.nom, 'nom1', a1.nom, 'nom2', a2.nom) order by c.ordre, c.id), '[]'::jsonb)
                    from public.combat_champions c join public.combat_types t on t.id = c.type
                    join public.jeu_cartes a1 on a1.artist_id = c.artist1 join public.jeu_cartes a2 on a2.artist_id = c.artist2),
    'ligue', (select coalesce(jsonb_agg(to_jsonb(l) || jsonb_build_object('nom1', a1.nom, 'nom2', a2.nom) order by l.rang), '[]'::jsonb)
                from public.combat_ligue l join public.jeu_cartes a1 on a1.artist_id = l.artist1 join public.jeu_cartes a2 on a2.artist_id = l.artist2));
end $$;

create or replace function public.combat_pve_equipe_reglage(p_cle text, p_valeur integer) returns void
language plpgsql security definer set search_path to 'public' as $$
begin
  perform public.combat_equipe_garde();
  if not exists (select 1 from public.combat_pve_reglages where cle = p_cle) then raise exception 'Réglage inconnu.'; end if;
  if p_valeur is null or p_valeur < 0 or p_valeur > 5000 then raise exception 'Valeur : entre 0 et 5 000.'; end if;
  if p_cle = 'champion_jour_rarete' and p_valeur not between 1 and 5 then raise exception 'Rareté : entre 1 et 5.'; end if;
  if p_cle = 'ligue_vies' and p_valeur < 1 then raise exception 'Il faut au moins une vie.'; end if;
  update public.combat_pve_reglages set valeur = p_valeur where cle = p_cle;
end $$;

create or replace function public.combat_pve_equipe_difficulte(p jsonb) returns void
language plpgsql security definer set search_path to 'public' as $$
begin
  perform public.combat_equipe_garde();
  if not exists (select 1 from public.combat_tour_difficultes where id = p ->> 'id') then raise exception 'Difficulté inconnue.'; end if;
  if coalesce(btrim(p ->> 'nom'), '') = '' then raise exception 'Donne un nom à la difficulté.'; end if;
  if coalesce((p ->> 'etages')::integer, 0) not between 10 and 1000 then raise exception 'Étages : entre 10 et 1 000.'; end if;
  if coalesce((p ->> 'bonus_base')::integer, 0) not between -50 and 300 then raise exception 'Bonus de départ : entre -50 et 300 %%.'; end if;
  if coalesce((p ->> 'bonus_etage')::numeric, 0) not between 0 and 10 then raise exception 'Bonus par étage : entre 0 et 10 %%.'; end if;
  if coalesce((p ->> 'bonus_gardien')::integer, 0) not between 0 and 100 then raise exception 'Bonus des gardiens : entre 0 et 100 %%.'; end if;
  if coalesce((p ->> 'rarete_plus')::integer, 0) not between 0 and 3 then raise exception 'Rareté en plus : entre 0 et 3.'; end if;
  if coalesce((p ->> 'mult_wc')::numeric, 0) not between 0 and 10 or coalesce((p ->> 'mult_vinyles')::numeric, 0) not between 0 and 10 then raise exception 'Multiplicateurs : entre 0 et 10.'; end if;
  if coalesce((p ->> 'deblocage_etage')::integer, 0) not between 0 and 1000 then raise exception 'Déblocage : entre 0 et 1 000.'; end if;
  update public.combat_tour_difficultes set
    nom = btrim(p ->> 'nom'), resume = coalesce(btrim(p ->> 'resume'), resume), etages = (p ->> 'etages')::integer,
    bonus_base = (p ->> 'bonus_base')::integer, bonus_etage = (p ->> 'bonus_etage')::numeric, bonus_gardien = (p ->> 'bonus_gardien')::integer,
    rarete_plus = (p ->> 'rarete_plus')::integer, mult_wc = (p ->> 'mult_wc')::numeric, mult_vinyles = (p ->> 'mult_vinyles')::numeric,
    deblocage_etage = (p ->> 'deblocage_etage')::integer, actif = coalesce((p ->> 'actif')::boolean, actif)
   where id = p ->> 'id';
end $$;

create or replace function public.combat_pve_equipe_champion(p jsonb) returns void
language plpgsql security definer set search_path to 'public' as $$
begin
  perform public.combat_equipe_garde();
  if not exists (select 1 from public.combat_champions where id = p ->> 'id') then raise exception 'Champion inconnu.'; end if;
  if coalesce(btrim(p ->> 'nom'), '') = '' then raise exception 'Donne un nom au champion.'; end if;
  if not exists (select 1 from public.jeu_cartes where artist_id = (p ->> 'artist1')::uuid) or not exists (select 1 from public.jeu_cartes where artist_id = (p ->> 'artist2')::uuid) then
    raise exception 'Artiste inconnu.';
  end if;
  if (p ->> 'artist1') = (p ->> 'artist2') then raise exception 'Choisis deux artistes différents.'; end if;
  if coalesce((p ->> 'rarete1')::integer, 0) not between 1 and 5 or coalesce((p ->> 'rarete2')::integer, 0) not between 1 and 5 then raise exception 'Rareté : entre 1 et 5.'; end if;
  if coalesce((p ->> 'bonus')::integer, 0) not between 0 and 300 then raise exception 'Bonus : entre 0 et 300 %%.'; end if;
  if coalesce((p ->> 'vinyles')::integer, 0) not between 0 and 50 then raise exception 'Vinyles : entre 0 et 50.'; end if;
  if coalesce((p ->> 'wc')::integer, 0) not between 0 and 5000 then raise exception 'Wave Coins : entre 0 et 5 000.'; end if;
  if coalesce(p ->> 'decor', 'studio') not in ('studio', 'concert', 'plateau', 'ruelle', 'toit') then raise exception 'Décor inconnu.'; end if;
  update public.combat_champions set
    nom = btrim(p ->> 'nom'), description = coalesce(btrim(p ->> 'description'), description),
    artist1 = (p ->> 'artist1')::uuid, rarete1 = (p ->> 'rarete1')::integer, artist2 = (p ->> 'artist2')::uuid, rarete2 = (p ->> 'rarete2')::integer,
    bonus = (p ->> 'bonus')::integer, vinyles = (p ->> 'vinyles')::integer, wc = (p ->> 'wc')::integer, decor = coalesce(p ->> 'decor', decor),
    actif = coalesce((p ->> 'actif')::boolean, actif)
   where id = p ->> 'id';
end $$;

create or replace function public.combat_pve_equipe_ligue(p jsonb) returns void
language plpgsql security definer set search_path to 'public' as $$
begin
  perform public.combat_equipe_garde();
  if not exists (select 1 from public.combat_ligue where rang = (p ->> 'rang')::integer) then raise exception 'Siège inconnu.'; end if;
  if coalesce(btrim(p ->> 'nom'), '') = '' then raise exception 'Donne un nom à ce siège.'; end if;
  if not exists (select 1 from public.jeu_cartes where artist_id = (p ->> 'artist1')::uuid) or not exists (select 1 from public.jeu_cartes where artist_id = (p ->> 'artist2')::uuid) then
    raise exception 'Artiste inconnu.';
  end if;
  if (p ->> 'artist1') = (p ->> 'artist2') then raise exception 'Choisis deux artistes différents.'; end if;
  if coalesce((p ->> 'rarete1')::integer, 0) not between 1 and 5 or coalesce((p ->> 'rarete2')::integer, 0) not between 1 and 5 then raise exception 'Rareté : entre 1 et 5.'; end if;
  if coalesce((p ->> 'bonus')::integer, 0) not between 0 and 300 then raise exception 'Bonus : entre 0 et 300 %%.'; end if;
  if coalesce(p ->> 'decor', 'studio') not in ('studio', 'concert', 'plateau', 'ruelle', 'toit') then raise exception 'Décor inconnu.'; end if;
  update public.combat_ligue set
    nom = btrim(p ->> 'nom'), description = coalesce(btrim(p ->> 'description'), description),
    artist1 = (p ->> 'artist1')::uuid, rarete1 = (p ->> 'rarete1')::integer, artist2 = (p ->> 'artist2')::uuid, rarete2 = (p ->> 'rarete2')::integer,
    bonus = (p ->> 'bonus')::integer, decor = coalesce(p ->> 'decor', decor)
   where rang = (p ->> 'rang')::integer;
end $$;

-- Droits : les fonctions internes ne sont appelées que par d'autres fonctions SECURITY DEFINER ; les joueurs et l'équipe n'ont que les points d'entrée.
revoke all on function public.combat_pve_reglage(text), public.combat_pve_artiste(integer), public.combat_pve_apercu(jsonb),
  public.combat_pve_memoriser(uuid, jsonb), public.combat_tour_equipe(text, integer), public.combat_tour_recompense(text, integer),
  public.combat_tour_debloque(uuid, text), public.combat_champion_jour(date), public.combat_fin_pve_tour(uuid, boolean, boolean),
  public.combat_fin_pve_champion(uuid, boolean, boolean), public.combat_fin_pve_ligue(uuid, boolean, boolean) from public, anon, authenticated;

revoke all on function public.combat_pve_tour(text, integer, jsonb, jsonb), public.combat_pve_champion(text, jsonb, jsonb), public.combat_pve_ligue(jsonb, jsonb),
  public.combat_pve_accueil(), public.combat_pve_equipe_lire(), public.combat_pve_equipe_reglage(text, integer),
  public.combat_pve_equipe_difficulte(jsonb), public.combat_pve_equipe_champion(jsonb), public.combat_pve_equipe_ligue(jsonb) from public, anon;
grant execute on function public.combat_pve_tour(text, integer, jsonb, jsonb), public.combat_pve_champion(text, jsonb, jsonb), public.combat_pve_ligue(jsonb, jsonb),
  public.combat_pve_accueil(), public.combat_pve_equipe_lire(), public.combat_pve_equipe_reglage(text, integer),
  public.combat_pve_equipe_difficulte(jsonb), public.combat_pve_equipe_champion(jsonb), public.combat_pve_equipe_ligue(jsonb) to authenticated;
