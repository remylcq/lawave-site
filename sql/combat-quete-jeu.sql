-- Wave Cards : les modes de quête du combat — les fonctions (2026-10-28).
-- Faille et Trésor : chaque mode a une fonction de lancement (qui appelle combat_creer) et une fonction de fin
-- combat_fin_<mode> (appelée UNE fois par combat_conclure : elle verse les gains). Les données et les réglages sont dans
-- sql/combat-quete-donnees.sql. Récompenses : Wave Coins (wc_crediter, idempotent par motif + référence : jamais deux fois),
-- vinyles et packs « Épique garanti » (jeu_crediter). Les gains renvoyés à l'écran de fin :
--   {vinyles: n, "WC": n, lignes: ['…'], titre: 'Note SSS+', ton: 'victoire' | 'defaite'}  (combat.js affiche « titre » à la place de VICTOIRE / DÉFAITE).
-- Réutilise les outils de combat-pve-jeu.sql : combat_pve_artiste, combat_pve_apercu, combat_pve_memoriser.

-- ---------------------------------------------------------------------------------------------------------------------------
-- Outils
-- ---------------------------------------------------------------------------------------------------------------------------

create or replace function public.combat_quete_reglage(p_cle text) returns integer
language sql stable set search_path to 'public' as
$$ select coalesce((select valeur from public.combat_quete_reglages where cle = p_cle), 0) $$;

-- Un grand nombre avec des espaces fines : 1 234 567.
create or replace function public.combat_quete_nombre(p_n numeric) returns text
language sql immutable set search_path to 'public' as
$$ select replace(to_char(p_n, 'FM999,999,999,999,999'), ',', chr(8239)) $$;

-- ---------------------------------------------------------------------------------------------------------------------------
-- La Faille
-- ---------------------------------------------------------------------------------------------------------------------------

-- Le boss d'un jour de la semaine (1 = lundi … 7 = dimanche) : deux cartes aux PV démesurés.
create or replace function public.combat_faille_equipe(p_jour integer) returns jsonb
language plpgsql stable set search_path to 'public' as $$
declare b public.combat_faille_boss; v_crew jsonb := '[]'::jsonb; u jsonb; a uuid;
begin
  select * into b from public.combat_faille_boss where jour = p_jour;
  if not found then raise exception 'La Faille est fermée pour le moment.'; end if;
  foreach a in array array[b.artist1, b.artist2] loop
    u := public.combat_unite(a, b.rarete, b.holo, b.bonus);
    u := jsonb_set(u, '{pv}', to_jsonb(round((u ->> 'pv')::numeric * b.pv_mult)));
    u := jsonb_set(u, '{pv_max}', to_jsonb(round((u ->> 'pv_max')::numeric * b.pv_mult)));
    v_crew := v_crew || u;
  end loop;
  return jsonb_build_object('jour', b.jour, 'nom', b.nom, 'description', b.description, 'decor', b.decor, 'bonus', b.bonus, 'pv_mult', b.pv_mult, 'crew', v_crew);
end $$;

-- Entre dans la Faille : un essai de plus (gratuit, puis acheté) est consommé AU LANCEMENT — abandonner ne le rend pas.
create or replace function public.combat_quete_faille(p_duo jsonb, p_options jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid(); v_jour date := public.xp_jour(); e public.combat_faille_essais; v_base integer; v_info jsonb; v_mine jsonb; v_id uuid; v_achete boolean;
begin
  if v_uid is null then raise exception 'Connecte-toi.'; end if;
  perform public.jeu_joueur_assurer(v_uid);
  perform public.combat_expirer(v_uid);
  v_base := public.combat_quete_reglage('faille_essais');
  insert into public.combat_faille_essais (user_id, jour) values (v_uid, v_jour) on conflict (user_id, jour) do nothing;
  select * into e from public.combat_faille_essais where user_id = v_uid and jour = v_jour for update;
  if e.utilises >= v_base + e.achetes then
    if e.achetes < public.combat_quete_reglage('faille_achat_max') then
      raise exception 'Tu as utilisé tous tes essais du jour : tu peux en acheter un de plus avec des Wave Coins.';
    end if;
    raise exception 'Plus d''essai dans la Faille aujourd''hui : reviens demain !';
  end if;
  v_info := public.combat_faille_equipe(extract(isodow from v_jour)::integer);
  v_mine := public.combat_duo_unites(v_uid, p_duo);
  perform public.combat_pve_memoriser(v_uid, p_duo);
  v_achete := e.utilises >= v_base;
  v_id := public.combat_creer(v_uid, 'faille', v_info ->> 'nom', v_info ->> 'decor', v_mine, v_info -> 'crew',
                              'faille:' || v_jour::text || ':' || (e.utilises + 1) || ':' || (case when v_achete then 1 else 0 end), null, p_options);
  update public.combat_faille_essais set utilises = utilises + 1, maj = now() where user_id = v_uid and jour = v_jour;
  return public.combat_partie_json(v_id);
end $$;

-- Achète un essai de plus dans la Faille (Wave Coins).
create or replace function public.combat_quete_faille_acheter() returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid(); v_jour date := public.xp_jour(); e public.combat_faille_essais; v_prix integer := public.combat_quete_reglage('faille_achat_prix'); v_solde integer;
begin
  if v_uid is null then raise exception 'Connecte-toi.'; end if;
  perform public.jeu_joueur_assurer(v_uid);
  insert into public.wc_portefeuille (user_id, solde) values (v_uid, 0) on conflict (user_id) do nothing;
  select solde into v_solde from public.wc_portefeuille where user_id = v_uid for update;
  insert into public.combat_faille_essais (user_id, jour) values (v_uid, v_jour) on conflict (user_id, jour) do nothing;
  select * into e from public.combat_faille_essais where user_id = v_uid and jour = v_jour for update;
  if e.achetes >= public.combat_quete_reglage('faille_achat_max') then raise exception 'Tu as déjà acheté tous les essais possibles aujourd''hui.'; end if;
  if e.utilises < public.combat_quete_reglage('faille_essais') + e.achetes then raise exception 'Il te reste des essais : utilise-les d''abord.'; end if;
  if v_solde < v_prix then raise exception 'Il te manque % Wave Coins.', v_prix - v_solde; end if;
  update public.wc_portefeuille set solde = solde - v_prix where user_id = v_uid;
  insert into public.wc_journal (user_id, delta, motif, ref) values (v_uid, -v_prix, 'faille:essai', v_jour::text || ':' || (e.achetes + 1));
  update public.combat_faille_essais set achetes = achetes + 1, maj = now() where user_id = v_uid and jour = v_jour;
  return public.combat_quete_accueil();
end $$;

-- Fin d'un essai : la note vient des dégâts infligés au boss (la somme des deux cartes du joueur), un boss abattu donne la note maximale.
create or replace function public.combat_fin_faille(p_partie uuid, p_victoire boolean, p_abandon boolean) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  p public.combat_parties; v_jour date; v_achete boolean; v_deg integer; n public.combat_faille_notes; v_wc integer; v_vin integer; v_gar integer; v_lignes jsonb := '[]'::jsonb;
  v_gains jsonb; v_pct integer := public.combat_quete_reglage('faille_achat_pct');
begin
  select * into p from public.combat_parties where id = p_partie;
  if not found then return '{}'::jsonb; end if;
  begin
    v_jour := split_part(coalesce(p.cible, ''), ':', 2)::date;
    v_achete := split_part(p.cible, ':', 4) = '1';
  exception when others then return '{}'::jsonb;
  end;
  if p_abandon then
    return jsonb_build_object('lignes', jsonb_build_array('Essai perdu : un abandon ne rapporte rien.'));
  end if;
  select coalesce(sum((u -> 'stats' ->> 'deg')::numeric), 0)::integer into v_deg from jsonb_array_elements(p.unites) u where u ->> 'camp' = '0';
  if p_victoire then
    select * into n from public.combat_faille_notes order by ordre desc limit 1;
  else
    select * into n from public.combat_faille_notes where seuil <= v_deg order by ordre desc limit 1;
  end if;
  if not found then select * into n from public.combat_faille_notes order by ordre limit 1; end if;
  v_wc := n.wc; v_vin := n.vinyles; v_gar := n.garantis;
  if v_achete then v_wc := round(v_wc * v_pct / 100.0)::integer; v_vin := 0; v_gar := 0; end if;
  if v_wc > 0 then v_wc := public.wc_crediter(p.user_id, v_wc, 'faille', p_partie::text); end if;
  if v_vin > 0 or v_gar > 0 then perform public.jeu_crediter(p.user_id, v_vin, 0, v_gar); end if;
  update public.combat_faille_essais
     set meilleure_note = case when v_deg > meilleur_deg then n.note else meilleure_note end, meilleur_deg = greatest(meilleur_deg, v_deg), maj = now()
   where user_id = p.user_id and jour = v_jour;
  v_lignes := jsonb_build_array('Note ' || n.note || ' · ' || public.combat_quete_nombre(v_deg) || ' dégâts');
  if v_gar > 0 then v_lignes := v_lignes || to_jsonb('+' || v_gar || (case when v_gar > 1 then ' packs Épique garanti' else ' pack Épique garanti' end)); end if;
  if v_achete then v_lignes := v_lignes || to_jsonb('Essai acheté : ' || v_pct || ' % des Wave Coins, sans vinyles ni pack.'::text); end if;
  v_gains := jsonb_build_object('titre', 'Note ' || n.note, 'ton', case when n.ordre >= 4 then 'victoire' else 'defaite' end, 'note', n.note, 'lignes', v_lignes);
  if v_vin > 0 then v_gains := v_gains || jsonb_build_object('vinyles', v_vin); end if;
  if v_wc > 0 then v_gains := v_gains || jsonb_build_object('WC', v_wc); end if;
  return v_gains;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------
-- Le Trésor
-- ---------------------------------------------------------------------------------------------------------------------------

-- Les gardiens d'un palier : toujours les mêmes artistes pour un jour et un palier donnés, de plus en plus connus en montant ;
-- leur rareté est celle du duo du joueur (p_rar), leur force vient de mult_pct (84 = 16 % plus faibles qu'une carte normale).
create or replace function public.combat_tresor_equipe(p_jour date, p_palier integer, p_rar integer) returns jsonb
language plpgsql stable set search_path to 'public' as $$
declare
  t public.combat_tresor_paliers; n integer; v_max integer; frac numeric; centre integer; marge integer; r1 integer; r2 integer; v_rar integer := least(5, greatest(1, coalesce(p_rar, 3)));
begin
  select * into t from public.combat_tresor_paliers where palier = p_palier;
  if not found then raise exception 'Ce palier n''existe pas.'; end if;
  select max(palier) into v_max from public.combat_tresor_paliers;
  select count(*) into n from public.jeu_cartes where active;
  if n < 4 then raise exception 'Pas assez d''artistes pour garder le trésor.'; end if;
  frac := case when v_max > 1 then (p_palier - 1)::numeric / (v_max - 1) else 1 end;
  centre := 1 + round(power(1 - frac, 1.4) * (n - 1) * 0.85)::integer;
  marge := greatest(3, n / 40);
  r1 := least(n, greatest(1, centre + (abs(hashtext(p_jour::text || ':t:' || p_palier || ':a')::bigint) % (2 * marge + 1))::integer - marge));
  r2 := least(n, greatest(1, centre + (abs(hashtext(p_jour::text || ':t:' || p_palier || ':b')::bigint) % (2 * marge + 1))::integer - marge));
  if r2 = r1 then r2 := case when r1 < n then r1 + 1 else r1 - 1 end; end if;
  return jsonb_build_object('palier', p_palier, 'mult_pct', t.mult_pct, 'bonus', t.mult_pct - 100, 'rarete', v_rar,
    'decor', (array['ruelle', 'studio', 'plateau', 'concert', 'toit'])[1 + ((p_palier - 1) / 2) % 5],
    'nom', 'Gardiens du palier ' || p_palier,
    'crew', jsonb_build_array(public.combat_unite(public.combat_pve_artiste(r1), v_rar, false, t.mult_pct - 100),
                              public.combat_unite(public.combat_pve_artiste(r2), v_rar, false, t.mult_pct - 100)));
end $$;

-- Affronte les gardiens du prochain palier du jour.
create or replace function public.combat_quete_tresor(p_duo jsonb, p_options jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid(); v_jour date := public.xp_jour(); t public.combat_tresor_jour; v_max integer; v_n integer; v_rar integer; v_info jsonb; v_mine jsonb; v_id uuid;
begin
  if v_uid is null then raise exception 'Connecte-toi.'; end if;
  perform public.jeu_joueur_assurer(v_uid);
  perform public.combat_expirer(v_uid);
  insert into public.combat_tresor_jour (user_id, jour) values (v_uid, v_jour) on conflict (user_id, jour) do nothing;
  select * into t from public.combat_tresor_jour where user_id = v_uid and jour = v_jour for update;
  select max(palier) into v_max from public.combat_tresor_paliers;
  if t.palier >= v_max then raise exception 'Trésor vidé pour aujourd''hui : reviens demain !'; end if;
  select count(*) into v_n from public.combat_parties where user_id = v_uid and mode = 'tresor' and debut > now() - interval '1 hour';
  if v_n >= public.combat_quete_reglage('tresor_combats_heure') then
    raise exception 'Fais une pause : % combats par heure au plus dans le Trésor.', public.combat_quete_reglage('tresor_combats_heure');
  end if;
  v_mine := public.combat_duo_unites(v_uid, p_duo);
  select round(avg((u ->> 'rarete')::numeric))::integer into v_rar from jsonb_array_elements(v_mine) u;
  v_info := public.combat_tresor_equipe(v_jour, t.palier + 1, v_rar);
  perform public.combat_pve_memoriser(v_uid, p_duo);
  v_id := public.combat_creer(v_uid, 'tresor', 'Trésor · palier ' || (t.palier + 1), v_info ->> 'decor', v_mine, v_info -> 'crew',
                              'tresor:' || v_jour::text || ':' || (t.palier + 1), null, p_options);
  return public.combat_partie_json(v_id);
end $$;

-- Fin d'un combat du Trésor : une victoire sur le palier attendu l'ouvre et verse sa récompense (une seule fois par jour et par palier).
create or replace function public.combat_fin_tresor(p_partie uuid, p_victoire boolean, p_abandon boolean) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  p public.combat_parties; v_jour date; v_pal integer; v_max integer; v_n integer; r public.combat_tresor_paliers; v_wc integer := 0; v_lignes jsonb; v_gains jsonb;
begin
  if not p_victoire or p_abandon then return '{}'::jsonb; end if;
  select * into p from public.combat_parties where id = p_partie;
  if not found then return '{}'::jsonb; end if;
  begin
    v_jour := split_part(coalesce(p.cible, ''), ':', 2)::date;
    v_pal := split_part(p.cible, ':', 3)::integer;
  exception when others then return '{}'::jsonb;
  end;
  select * into r from public.combat_tresor_paliers where palier = v_pal;
  if not found then return '{}'::jsonb; end if;
  select max(palier) into v_max from public.combat_tresor_paliers;
  update public.combat_tresor_jour set palier = v_pal, maj = now() where user_id = p.user_id and jour = v_jour and palier = v_pal - 1;
  get diagnostics v_n = row_count;
  if v_n = 0 then return '{}'::jsonb; end if;
  if r.wc > 0 then v_wc := public.wc_crediter(p.user_id, r.wc, 'tresor', v_jour::text || ':' || v_pal); end if;
  if r.vinyles > 0 or r.garantis > 0 then perform public.jeu_crediter(p.user_id, r.vinyles, 0, r.garantis); end if;
  v_lignes := jsonb_build_array('Palier ' || v_pal || ' / ' || v_max || ' ouvert');
  if r.garantis > 0 then v_lignes := v_lignes || to_jsonb('+' || r.garantis || (case when r.garantis > 1 then ' packs Épique garanti' else ' pack Épique garanti' end)); end if;
  if v_pal >= v_max then v_lignes := v_lignes || to_jsonb('Trésor vidé pour aujourd''hui !'::text); end if;
  v_gains := jsonb_build_object('lignes', v_lignes);
  if r.vinyles > 0 then v_gains := v_gains || jsonb_build_object('vinyles', r.vinyles); end if;
  if v_wc > 0 then v_gains := v_gains || jsonb_build_object('WC', v_wc); end if;
  return v_gains;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------
-- L'accueil des deux modes (une seule lecture pour toute la page)
-- ---------------------------------------------------------------------------------------------------------------------------

create or replace function public.combat_quete_accueil() returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid(); v_jour date := public.xp_jour(); e public.combat_faille_essais; t public.combat_tresor_jour; v_boss jsonb; v_base integer := public.combat_quete_reglage('faille_essais');
  v_amax integer := public.combat_quete_reglage('faille_achat_max'); v_max integer; v_top jsonb; v_notes jsonb; v_pal jsonb; v_prochain jsonb; v_solde integer; v_heure integer;
  v_record integer; v_complets integer;
begin
  if v_uid is null then raise exception 'Connecte-toi.'; end if;
  perform public.jeu_joueur_assurer(v_uid);
  select * into e from public.combat_faille_essais where user_id = v_uid and jour = v_jour;
  select * into t from public.combat_tresor_jour where user_id = v_uid and jour = v_jour;
  select coalesce(solde, 0) into v_solde from public.wc_portefeuille where user_id = v_uid;
  v_solde := coalesce(v_solde, 0);

  v_boss := public.combat_faille_equipe(extract(isodow from v_jour)::integer);
  v_boss := (v_boss - 'crew') || jsonb_build_object('crew', public.combat_pve_apercu(v_boss -> 'crew'));

  select coalesce(jsonb_agg(jsonb_build_object('note', n.note, 'seuil', n.seuil, 'wc', n.wc, 'vinyles', n.vinyles, 'garantis', n.garantis,
           'atteinte', coalesce(e.meilleur_deg, 0) > 0 and coalesce(e.meilleur_deg, 0) >= n.seuil) order by n.ordre), '[]'::jsonb)
    into v_notes from public.combat_faille_notes n;

  select coalesce(jsonb_agg(jsonb_build_object('pseudo', x.pseudo, 'deg', x.meilleur_deg, 'note', x.meilleure_note, 'moi', x.user_id = v_uid) order by x.meilleur_deg desc), '[]'::jsonb)
    into v_top from (
      select s.user_id, s.meilleur_deg, s.meilleure_note, coalesce(pr.pseudo, 'Anonyme') pseudo
        from public.combat_faille_essais s left join public.profiles pr on pr.id = s.user_id
       where s.jour = v_jour and s.meilleur_deg > 0 order by s.meilleur_deg desc limit 5) x;

  select coalesce(max(meilleur_deg), 0) into v_record from public.combat_faille_essais where user_id = v_uid;

  select max(palier) into v_max from public.combat_tresor_paliers;
  select coalesce(jsonb_agg(jsonb_build_object('palier', r.palier, 'mult_pct', r.mult_pct, 'wc', r.wc, 'vinyles', r.vinyles, 'garantis', r.garantis,
           'fait', r.palier <= coalesce(t.palier, 0)) order by r.palier), '[]'::jsonb) into v_pal from public.combat_tresor_paliers r;
  if coalesce(t.palier, 0) < v_max then
    v_prochain := public.combat_tresor_equipe(v_jour, coalesce(t.palier, 0) + 1, 3);
    v_prochain := (v_prochain - 'crew') || jsonb_build_object('crew', public.combat_pve_apercu(v_prochain -> 'crew'));
  end if;
  select count(*) into v_heure from public.combat_parties where user_id = v_uid and mode = 'tresor' and debut > now() - interval '1 hour';
  select count(*) into v_complets from public.combat_tresor_jour where user_id = v_uid and palier >= v_max;

  return jsonb_build_object(
    'faille', jsonb_build_object(
      'boss', v_boss, 'jour', v_jour, 'notes', v_notes, 'top', v_top, 'solde', v_solde,
      'essais_base', v_base, 'utilises', coalesce(e.utilises, 0), 'achetes', coalesce(e.achetes, 0),
      'restants', greatest(0, v_base + coalesce(e.achetes, 0) - coalesce(e.utilises, 0)),
      'achat_max', v_amax, 'achat_restants', greatest(0, v_amax - coalesce(e.achetes, 0)), 'prix', public.combat_quete_reglage('faille_achat_prix'),
      'pct', public.combat_quete_reglage('faille_achat_pct'),
      'meilleur_deg', coalesce(e.meilleur_deg, 0), 'meilleure_note', e.meilleure_note, 'record', v_record),
    'tresor', jsonb_build_object(
      'jour', v_jour, 'palier', coalesce(t.palier, 0), 'total', v_max, 'paliers', v_pal, 'prochain', v_prochain, 'jours_complets', v_complets,
      'combats_heure', v_heure, 'combats_heure_max', public.combat_quete_reglage('tresor_combats_heure')));
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------
-- La console de l'équipe
-- ---------------------------------------------------------------------------------------------------------------------------

create or replace function public.combat_quete_equipe_lire() returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
begin
  perform public.combat_equipe_garde();
  return jsonb_build_object(
    'reglages', (select coalesce(jsonb_agg(jsonb_build_object('cle', r.cle, 'valeur', r.valeur, 'libelle', r.libelle) order by r.ordre), '[]'::jsonb) from public.combat_quete_reglages r),
    'boss', (select coalesce(jsonb_agg(to_jsonb(b) || jsonb_build_object('nom1', a1.nom, 'nom2', a2.nom) order by b.jour), '[]'::jsonb)
               from public.combat_faille_boss b join public.jeu_cartes a1 on a1.artist_id = b.artist1 join public.jeu_cartes a2 on a2.artist_id = b.artist2),
    'notes', (select coalesce(jsonb_agg(to_jsonb(n) order by n.ordre), '[]'::jsonb) from public.combat_faille_notes n),
    'paliers', (select coalesce(jsonb_agg(to_jsonb(r) order by r.palier), '[]'::jsonb) from public.combat_tresor_paliers r));
end $$;

create or replace function public.combat_quete_equipe_reglage(p_cle text, p_valeur integer) returns void
language plpgsql security definer set search_path to 'public' as $$
begin
  perform public.combat_equipe_garde();
  if not exists (select 1 from public.combat_quete_reglages where cle = p_cle) then raise exception 'Réglage inconnu.'; end if;
  if p_valeur is null or p_valeur < 0 or p_valeur > 5000 then raise exception 'Valeur : entre 0 et 5 000.'; end if;
  if p_cle = 'faille_achat_pct' and p_valeur > 100 then raise exception 'Une part en %% : entre 0 et 100.'; end if;
  if p_cle = 'faille_essais' and p_valeur < 1 then raise exception 'Il faut au moins un essai gratuit.'; end if;
  if p_cle = 'tresor_combats_heure' and p_valeur < 1 then raise exception 'Il faut au moins un combat par heure.'; end if;
  update public.combat_quete_reglages set valeur = p_valeur where cle = p_cle;
end $$;

create or replace function public.combat_quete_equipe_boss(p jsonb) returns void
language plpgsql security definer set search_path to 'public' as $$
begin
  perform public.combat_equipe_garde();
  if not exists (select 1 from public.combat_faille_boss where jour = (p ->> 'jour')::integer) then raise exception 'Jour inconnu.'; end if;
  if coalesce(btrim(p ->> 'nom'), '') = '' then raise exception 'Donne un nom au boss.'; end if;
  if not exists (select 1 from public.jeu_cartes where artist_id = (p ->> 'artist1')::uuid) or not exists (select 1 from public.jeu_cartes where artist_id = (p ->> 'artist2')::uuid) then
    raise exception 'Artiste inconnu.';
  end if;
  if (p ->> 'artist1') = (p ->> 'artist2') then raise exception 'Choisis deux artistes différents.'; end if;
  if coalesce((p ->> 'rarete')::integer, 0) not between 1 and 5 then raise exception 'Rareté : entre 1 et 5.'; end if;
  if coalesce((p ->> 'bonus')::integer, -999) not between -80 and 300 then raise exception 'Stats : entre -80 et 300 %%.'; end if;
  if coalesce((p ->> 'pv_mult')::integer, 0) not between 1 and 500 then raise exception 'PV du boss : multiplicateur entre 1 et 500.'; end if;
  if coalesce(p ->> 'decor', 'toit') not in ('studio', 'concert', 'plateau', 'ruelle', 'toit') then raise exception 'Décor inconnu.'; end if;
  update public.combat_faille_boss set
    nom = btrim(p ->> 'nom'), description = coalesce(btrim(p ->> 'description'), description),
    artist1 = (p ->> 'artist1')::uuid, artist2 = (p ->> 'artist2')::uuid, rarete = (p ->> 'rarete')::integer, holo = coalesce((p ->> 'holo')::boolean, holo),
    bonus = (p ->> 'bonus')::integer, pv_mult = (p ->> 'pv_mult')::integer, decor = coalesce(p ->> 'decor', decor)
   where jour = (p ->> 'jour')::integer;
end $$;

create or replace function public.combat_quete_equipe_note(p jsonb) returns void
language plpgsql security definer set search_path to 'public' as $$
begin
  perform public.combat_equipe_garde();
  if not exists (select 1 from public.combat_faille_notes where note = p ->> 'note') then raise exception 'Note inconnue.'; end if;
  if coalesce((p ->> 'seuil')::integer, -1) not between 0 and 100000000 then raise exception 'Seuil de dégâts : entre 0 et 100 000 000.'; end if;
  if coalesce((p ->> 'wc')::integer, -1) not between 0 and 5000 then raise exception 'Wave Coins : entre 0 et 5 000.'; end if;
  if coalesce((p ->> 'vinyles')::integer, -1) not between 0 and 100 then raise exception 'Vinyles : entre 0 et 100.'; end if;
  if coalesce((p ->> 'garantis')::integer, -1) not between 0 and 10 then raise exception 'Packs garantis : entre 0 et 10.'; end if;
  update public.combat_faille_notes set seuil = (p ->> 'seuil')::integer, wc = (p ->> 'wc')::integer, vinyles = (p ->> 'vinyles')::integer, garantis = (p ->> 'garantis')::integer
   where note = p ->> 'note';
  if exists (select 1 from public.combat_faille_notes a join public.combat_faille_notes b on a.ordre < b.ordre and a.seuil > b.seuil) then
    raise exception 'Les seuils de dégâts doivent monter avec les notes.';
  end if;
  if (select seuil from public.combat_faille_notes order by ordre limit 1) <> 0 then raise exception 'La note la plus basse doit avoir un seuil de 0.'; end if;
end $$;

create or replace function public.combat_quete_equipe_palier(p jsonb) returns void
language plpgsql security definer set search_path to 'public' as $$
begin
  perform public.combat_equipe_garde();
  if not exists (select 1 from public.combat_tresor_paliers where palier = (p ->> 'palier')::integer) then raise exception 'Palier inconnu.'; end if;
  if coalesce((p ->> 'mult_pct')::integer, 0) not between 20 and 600 then raise exception 'Force des gardiens : entre 20 et 600 %%.'; end if;
  if coalesce((p ->> 'wc')::integer, -1) not between 0 and 5000 then raise exception 'Wave Coins : entre 0 et 5 000.'; end if;
  if coalesce((p ->> 'vinyles')::integer, -1) not between 0 and 100 then raise exception 'Vinyles : entre 0 et 100.'; end if;
  if coalesce((p ->> 'garantis')::integer, -1) not between 0 and 10 then raise exception 'Packs garantis : entre 0 et 10.'; end if;
  update public.combat_tresor_paliers set mult_pct = (p ->> 'mult_pct')::integer, wc = (p ->> 'wc')::integer, vinyles = (p ->> 'vinyles')::integer, garantis = (p ->> 'garantis')::integer
   where palier = (p ->> 'palier')::integer;
end $$;

-- Droits : les fonctions internes ne sont appelées que par d'autres fonctions SECURITY DEFINER ; les joueurs et l'équipe n'ont que les points d'entrée.
revoke all on function public.combat_quete_reglage(text), public.combat_quete_nombre(numeric), public.combat_faille_equipe(integer),
  public.combat_fin_faille(uuid, boolean, boolean), public.combat_tresor_equipe(date, integer, integer), public.combat_fin_tresor(uuid, boolean, boolean)
  from public, anon, authenticated;

revoke all on function public.combat_quete_faille(jsonb, jsonb), public.combat_quete_faille_acheter(), public.combat_quete_tresor(jsonb, jsonb), public.combat_quete_accueil(),
  public.combat_quete_equipe_lire(), public.combat_quete_equipe_reglage(text, integer), public.combat_quete_equipe_boss(jsonb),
  public.combat_quete_equipe_note(jsonb), public.combat_quete_equipe_palier(jsonb) from public, anon;
grant execute on function public.combat_quete_faille(jsonb, jsonb), public.combat_quete_faille_acheter(), public.combat_quete_tresor(jsonb, jsonb), public.combat_quete_accueil(),
  public.combat_quete_equipe_lire(), public.combat_quete_equipe_reglage(text, integer), public.combat_quete_equipe_boss(jsonb),
  public.combat_quete_equipe_note(jsonb), public.combat_quete_equipe_palier(jsonb) to authenticated;
