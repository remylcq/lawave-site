-- Wave Cards : les Rivaux et le Prestige — les fonctions de jeu (2026-10-28).
-- Chaque mode a une fonction de lancement (qui appelle combat_creer) et une fonction de fin combat_fin_<mode> (appelée UNE fois par
-- combat_conclure : elle verse les gains et fait avancer la progression). Données et réglages : sql/combat-rivaux-donnees.sql.
-- Récompenses : vinyles (jeu_crediter), Wave Coins (wc_crediter, idempotent par motif + référence : jamais versés deux fois) et titres
-- (cosmétiques existants). Les gains renvoyés à l'écran de fin : {vinyles: n, "WC": n, lignes: ['…']}.
-- Réutilise combat_pve_apercu et combat_pve_memoriser (sql/combat-pve-jeu.sql).

-- ---------------------------------------------------------------------------------------------------------------------------
-- Outils
-- ---------------------------------------------------------------------------------------------------------------------------

create or replace function public.combat_rp_reglage(p_cle text) returns integer
language sql stable set search_path to 'public' as
$$ select coalesce((select valeur from public.combat_rivaux_reglages where cle = p_cle), 0) $$;

-- Donne un titre (cosmétique) au joueur ; renvoie son nom si c'est nouveau, sinon null. Ne casse jamais la fin d'un combat.
create or replace function public.combat_rp_cosmetique(p_user uuid, p_id text) returns text
language plpgsql security definer set search_path to 'public' as $$
declare c public.cosmetiques; v_n integer;
begin
  select * into c from public.cosmetiques where id = p_id;
  if not found then return null; end if;
  insert into public.cosmetiques_obtenus (user_id, cosmetique_id) values (p_user, c.id) on conflict do nothing;
  get diagnostics v_n = row_count;
  if v_n = 0 then return null; end if;
  begin
    perform public.xp_evt(p_user, 'cosmetique', jsonb_build_object('id', c.id, 'type', c.type, 'nom', c.nom, 'style', c.style));
    perform public.com_notifier_systeme(p_user, 'cosmetique', 'cosm:' || c.id, jsonb_build_object('id', c.id, 'type', c.type, 'nom', c.nom, 'style', c.style));
  exception when others then null;
  end;
  return c.nom;
end $$;

-- Ajoute aux gains d'un combat : des vinyles, des Wave Coins (versés ici, idempotents) et une ligne de texte.
create or replace function public.combat_rp_verser(p_user uuid, p_gains jsonb, p_vin integer, p_wc integer, p_motif text, p_ref text) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare g jsonb := p_gains; v_wc integer := 0;
begin
  if coalesce(p_wc, 0) > 0 then v_wc := public.wc_crediter(p_user, p_wc, p_motif, p_ref); end if;
  if coalesce(p_vin, 0) > 0 then perform public.jeu_crediter(p_user, p_vin, 0, 0); end if;
  if v_wc > 0 then g := jsonb_set(g, '{WC}', to_jsonb(coalesce((g ->> 'WC')::integer, 0) + v_wc)); end if;
  if coalesce(p_vin, 0) > 0 then g := jsonb_set(g, '{vinyles}', to_jsonb(coalesce((g ->> 'vinyles')::integer, 0) + p_vin)); end if;
  return g;
end $$;

create or replace function public.combat_rp_ligne(p_gains jsonb, p_texte text) returns jsonb
language sql immutable set search_path to 'public' as
$$ select jsonb_set(p_gains, '{lignes}', coalesce(p_gains -> 'lignes', '[]'::jsonb) || to_jsonb(p_texte)) $$;

-- ---------------------------------------------------------------------------------------------------------------------------
-- Les Rivaux
-- ---------------------------------------------------------------------------------------------------------------------------

-- Les stats de l'équipe d'un rival à une manche : le bonus monte à chaque manche, la dernière manche gagne une rareté.
create or replace function public.combat_rivaux_equipe(p_rival text, p_niveau integer, p_manche integer) returns jsonb
language plpgsql stable set search_path to 'public' as $$
declare r public.combat_rivaux; n public.combat_rivaux_niveaux; v_bonus integer; v_rar integer;
begin
  select * into r from public.combat_rivaux where id = p_rival and actif;
  if not found then raise exception 'Rival inconnu.'; end if;
  select * into n from public.combat_rivaux_niveaux where niveau = p_niveau;
  if not found then raise exception 'Niveau inconnu.'; end if;
  v_bonus := n.bonus_base + (p_manche - 1) * n.bonus_manche;
  v_rar := least(5, n.rarete + case when p_manche >= 3 then 1 else 0 end);
  return jsonb_build_object('bonus', v_bonus, 'rarete', v_rar, 'decor', r.decor,
    'nom', r.nom || ' · ' || n.nom || ' · Manche ' || p_manche || '/3',
    'crew', jsonb_build_array(public.combat_unite(r.artist1, v_rar, false, v_bonus), public.combat_unite(r.artist2, v_rar, false, v_bonus)));
end $$;

create or replace function public.combat_rivaux_duel(p_rival text, p_niveau integer, p_duo jsonb, p_options jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid(); r public.combat_rivaux; pr public.combat_rivaux_progres; v_manche integer; v_info jsonb; v_mine jsonb; v_id uuid;
begin
  if v_uid is null then raise exception 'Connecte-toi.'; end if;
  perform public.jeu_joueur_assurer(v_uid);
  perform public.combat_expirer(v_uid);
  select * into r from public.combat_rivaux where id = p_rival and actif;
  if not found then raise exception 'Rival inconnu.'; end if;
  if p_niveau is null or not exists (select 1 from public.combat_rivaux_niveaux where niveau = p_niveau) then raise exception 'Niveau inconnu.'; end if;
  if p_niveau > 1 and not exists (select 1 from public.combat_rivaux_progres where user_id = v_uid and rival = r.id and niveau = p_niveau - 1 and serie_faite) then
    raise exception 'Termine d''abord la série précédente contre ce rival.';
  end if;
  insert into public.combat_rivaux_progres (user_id, rival, niveau) values (v_uid, r.id, p_niveau) on conflict do nothing;
  select * into pr from public.combat_rivaux_progres where user_id = v_uid and rival = r.id and niveau = p_niveau for update;
  v_manche := case when pr.serie_faite then 3 else pr.manches + 1 end;   -- série finie : on rejoue la dernière manche (gain du jour seulement)
  v_info := public.combat_rivaux_equipe(r.id, p_niveau, v_manche);
  v_mine := public.combat_duo_unites(v_uid, p_duo);
  perform public.combat_pve_memoriser(v_uid, p_duo);
  v_id := public.combat_creer(v_uid, 'rivaux', v_info ->> 'nom', v_info ->> 'decor', v_mine, v_info -> 'crew',
                              r.id || ':' || p_niveau || ':' || v_manche, null, p_options);
  return public.combat_partie_json(v_id);
end $$;

create or replace function public.combat_fin_rivaux(p_partie uuid, p_victoire boolean, p_abandon boolean) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  p public.combat_parties; r public.combat_rivaux; n public.combat_rivaux_niveaux; pr public.combat_rivaux_progres; v_jour date := public.xp_jour();
  v_riv text; v_niv integer; v_man integer; v_gains jsonb := '{}'::jsonb; v_n integer; v_titre text; v_vin integer := 0; v_wc integer := 0; v_tous integer;
begin
  select * into p from public.combat_parties where id = p_partie;
  if not found then return '{}'::jsonb; end if;
  begin
    v_riv := split_part(coalesce(p.cible, ''), ':', 1);
    v_niv := split_part(coalesce(p.cible, ''), ':', 2)::integer;
    v_man := split_part(coalesce(p.cible, ''), ':', 3)::integer;
  exception when others then return '{}'::jsonb;
  end;
  select * into r from public.combat_rivaux where id = v_riv;
  select * into n from public.combat_rivaux_niveaux where niveau = v_niv;
  select * into pr from public.combat_rivaux_progres where user_id = p.user_id and rival = v_riv and niveau = v_niv for update;
  if r.id is null or n.niveau is null or pr.user_id is null then return '{}'::jsonb; end if;

  if not p_victoire then
    if not p_abandon then update public.combat_rivaux_progres set defaites = defaites + 1, maj = now() where user_id = p.user_id and rival = v_riv and niveau = v_niv; end if;
    return '{}'::jsonb;   -- une défaite ne coûte rien : on retente la même manche
  end if;
  update public.combat_rivaux_progres set victoires = victoires + 1, maj = now() where user_id = p.user_id and rival = v_riv and niveau = v_niv;

  if not pr.serie_faite and v_man = pr.manches + 1 then
    update public.combat_rivaux_progres set manches = v_man, serie_faite = (v_man >= 3), maj = now() where user_id = p.user_id and rival = v_riv and niveau = v_niv;
    v_wc := n.wc_manche;
    v_gains := public.combat_rp_ligne(v_gains, 'Manche ' || v_man || '/3 gagnée contre ' || split_part(r.nom, ' ', 1));
    v_gains := public.combat_rp_verser(p.user_id, v_gains, 0, v_wc, 'rivaux:manche', v_riv || ':' || v_niv || ':' || v_man);
    if v_man >= 3 then
      v_gains := public.combat_rp_verser(p.user_id, v_gains, n.vinyles_serie, n.wc_serie, 'rivaux:serie', v_riv || ':' || v_niv);
      v_gains := public.combat_rp_ligne(v_gains, 'Série ' || n.nom || ' terminée : la rivalité grandit');
      if v_niv = 3 then
        v_titre := public.combat_rp_cosmetique(p.user_id, 'titre-rival-' || v_riv);
        if v_titre is not null then v_gains := public.combat_rp_ligne(v_gains, 'Titre débloqué : ' || v_titre); end if;
        select count(*) into v_tous from public.combat_rivaux x
         where x.actif and exists (select 1 from public.combat_rivaux_progres q where q.user_id = p.user_id and q.rival = x.id and q.niveau = 3 and q.serie_faite);
        if v_tous >= (select count(*) from public.combat_rivaux where actif) then
          v_titre := public.combat_rp_cosmetique(p.user_id, 'titre-rivaux-maitre');
          if v_titre is not null then
            v_gains := public.combat_rp_verser(p.user_id, v_gains, public.combat_rp_reglage('rivaux_titre_vinyles'), public.combat_rp_reglage('rivaux_titre_wc'), 'rivaux:maitre', 'tous');
            v_gains := public.combat_rp_ligne(v_gains, 'Les six rivaux Légendaires : titre « ' || v_titre || ' »');
          end if;
        end if;
      end if;
    end if;
  end if;

  -- Le petit gain du jour : une victoire par rival et par jour, quelle que soit la manche.
  insert into public.combat_rivaux_jour (user_id, rival, jour) values (p.user_id, v_riv, v_jour) on conflict do nothing;
  get diagnostics v_n = row_count;
  if v_n > 0 and public.combat_rp_reglage('rivaux_jour_wc') > 0 then
    v_gains := public.combat_rp_verser(p.user_id, v_gains, 0, public.combat_rp_reglage('rivaux_jour_wc'), 'rivaux:jour', v_riv || ':' || v_jour::text);
    v_gains := public.combat_rp_ligne(v_gains, 'Première victoire du jour contre ' || split_part(r.nom, ' ', 1));
  end if;
  return v_gains;
end $$;

create or replace function public.combat_rivaux_accueil() returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); v_jour date := public.xp_jour(); v_total integer;
begin
  if v_uid is null then raise exception 'Connecte-toi.'; end if;
  perform public.jeu_joueur_assurer(v_uid);
  select count(*) into v_total from public.combat_rivaux where actif;
  return jsonb_build_object(
    'jour_wc', public.combat_rp_reglage('rivaux_jour_wc'),
    'niveaux', (select coalesce(jsonb_agg(to_jsonb(n) order by n.niveau), '[]'::jsonb) from public.combat_rivaux_niveaux n),
    'legendaires', (select count(*) from public.combat_rivaux x where x.actif and exists
        (select 1 from public.combat_rivaux_progres q where q.user_id = v_uid and q.rival = x.id and q.niveau = 3 and q.serie_faite)),
    'total', v_total,
    'titre_maitre', exists (select 1 from public.cosmetiques_obtenus o where o.user_id = v_uid and o.cosmetique_id = 'titre-rivaux-maitre'),
    'rivaux', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', r.id, 'nom', r.nom, 'surnom', r.surnom, 'replique', r.replique, 'decor', r.decor,
        'rivalite', (select count(*) from public.combat_rivaux_progres q where q.user_id = v_uid and q.rival = r.id and q.serie_faite),
        'histoire', (select coalesce(jsonb_agg(h.t order by h.o), '[]'::jsonb)
                       from jsonb_array_elements_text(r.histoire) with ordinality as h (t, o)
                      where h.o <= 1 + (select count(*) from public.combat_rivaux_progres q where q.user_id = v_uid and q.rival = r.id and q.serie_faite)),
        'chapitres', jsonb_array_length(r.histoire),
        'jour_fait', exists (select 1 from public.combat_rivaux_jour j where j.user_id = v_uid and j.rival = r.id and j.jour = v_jour),
        'titre', (select nom from public.cosmetiques where id = 'titre-rival-' || r.id),
        'titre_obtenu', exists (select 1 from public.cosmetiques_obtenus o where o.user_id = v_uid and o.cosmetique_id = 'titre-rival-' || r.id),
        'crew', public.combat_pve_apercu(jsonb_build_array(public.combat_unite(r.artist1, 3, false, 0), public.combat_unite(r.artist2, 3, false, 0))),
        'niveaux', (select jsonb_agg(jsonb_build_object(
            'niveau', n.niveau, 'nom', n.nom, 'manches', coalesce(q.manches, 0), 'serie_faite', coalesce(q.serie_faite, false),
            'victoires', coalesce(q.victoires, 0), 'defaites', coalesce(q.defaites, 0),
            'debloque', n.niveau = 1 or exists (select 1 from public.combat_rivaux_progres q2 where q2.user_id = v_uid and q2.rival = r.id and q2.niveau = n.niveau - 1 and q2.serie_faite),
            'manche', case when coalesce(q.serie_faite, false) then 3 else coalesce(q.manches, 0) + 1 end,
            'bonus', n.bonus_base + (case when coalesce(q.serie_faite, false) then 2 else coalesce(q.manches, 0) end) * n.bonus_manche,
            'rarete', least(5, n.rarete + case when coalesce(q.serie_faite, false) or coalesce(q.manches, 0) >= 2 then 1 else 0 end),
            'recompense_manche', n.wc_manche, 'recompense_serie', jsonb_build_object('wc', n.wc_serie, 'vinyles', n.vinyles_serie)
          ) order by n.niveau)
          from public.combat_rivaux_niveaux n left join public.combat_rivaux_progres q on q.user_id = v_uid and q.rival = r.id and q.niveau = n.niveau)
      ) order by r.ordre, r.id), '[]'::jsonb) from public.combat_rivaux r where r.actif));
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------
-- Le Prestige
-- ---------------------------------------------------------------------------------------------------------------------------

-- Pose les malédictions sur l'équipe : une malédiction de stats vaut pour les deux cartes ; un passif se pose sur une carte à la fois
-- (d'abord celle qui n'en a pas).
create or replace function public.combat_prestige_appliquer(p_crew jsonb, p_ids text[]) returns jsonb
language plpgsql stable set search_path to 'public' as $$
declare r jsonb := p_crew; m public.combat_prestige_maledictions; x text; i integer; u jsonb; v_cap integer := 0; k numeric;
begin
  foreach x in array coalesce(p_ids, '{}') loop
    select * into m from public.combat_prestige_maledictions where id = x;
    if not found then continue; end if;
    if m.genre = 'stat' then
      k := 1 + m.valeur / 100.0;
      for i in 0..1 loop
        u := r -> i;
        if m.cible = 'pv' then
          u := u || jsonb_build_object('pv', round((u ->> 'pv')::numeric * k), 'pv_max', round((u ->> 'pv_max')::numeric * k));
        else
          u := u || jsonb_build_object(m.cible, round((u ->> m.cible)::numeric * k));
        end if;
        r := jsonb_set(r, array[i::text], u);
      end loop;
    else
      i := case when jsonb_typeof(r -> 0 -> 'capacite') is distinct from 'object' then 0
                when jsonb_typeof(r -> 1 -> 'capacite') is distinct from 'object' then 1 else v_cap % 2 end;
      v_cap := v_cap + 1;
      u := (r -> i) || jsonb_build_object('capacite', jsonb_build_object('id', 'maudit-' || m.id, 'nom', m.nom, 'code', m.cible, 'valeur', m.valeur, 'description', m.description));
      r := jsonb_set(r, array[i::text], u);
    end if;
  end loop;
  return r;
end $$;

create or replace function public.combat_prestige_nb(p_niveau integer, p_renaiss integer, p_total integer) returns integer
language sql immutable set search_path to 'public' as
$$ select least(greatest(p_total, 1), 1 + (greatest(p_niveau, 1) - 1) / 4 + greatest(p_renaiss, 0)) $$;

-- L'équipe d'un champion à un niveau de prestige (avec ses malédictions) et ce que le niveau rapporte.
create or replace function public.combat_prestige_equipe(p_champion text, p_niveau integer, p_renaiss integer) returns jsonb
language plpgsql stable set search_path to 'public' as $$
declare
  c public.combat_champions; pc public.combat_prestige_champions; v_bonus integer; v_rar integer; v_ids text[]; v_nb integer; v_crew jsonb; v_wc integer; v_vin integer;
begin
  select * into c from public.combat_champions where id = p_champion and actif;
  if not found then raise exception 'Champion inconnu.'; end if;
  select * into pc from public.combat_prestige_champions where champion = c.id;
  v_bonus := public.combat_rp_reglage('prestige_bonus_base') + public.combat_rp_reglage('prestige_bonus_niveau') * p_niveau
           + public.combat_rp_reglage('prestige_bonus_renaiss') * p_renaiss;
  v_rar := case when p_niveau >= 8 or p_renaiss >= 1 then 5 else greatest(4, least(5, c.rarete1)) end;
  v_nb := public.combat_prestige_nb(p_niveau, p_renaiss, coalesce(array_length(pc.maledictions, 1), 0));
  v_ids := (coalesce(pc.maledictions, '{}'::text[]))[1:v_nb];
  v_crew := public.combat_prestige_appliquer(jsonb_build_array(public.combat_unite(c.artist1, v_rar, false, v_bonus), public.combat_unite(c.artist2, v_rar, false, v_bonus)), v_ids);
  v_wc := round((public.combat_rp_reglage('prestige_wc_base') + public.combat_rp_reglage('prestige_wc_niveau') * p_niveau)
                * (100 + public.combat_rp_reglage('prestige_gain_renaiss') * p_renaiss) / 100.0)::integer;
  v_vin := case when p_niveau % 5 = 0 then 1 + p_niveau / 5 else 0 end;
  return jsonb_build_object('niveau', p_niveau, 'bonus', v_bonus, 'rarete', v_rar, 'decor', c.decor, 'nom', 'Prestige ' || p_niveau || ' · ' || c.nom,
    'maledictions', (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'nom', m.nom, 'description', m.description) order by o.ord), '[]'::jsonb)
                       from unnest(v_ids) with ordinality as o (id, ord) join public.combat_prestige_maledictions m on m.id = o.id),
    'recompense', jsonb_build_object('wc', v_wc, 'vinyles', v_vin), 'crew', v_crew);
end $$;

create or replace function public.combat_prestige_duel(p_champion text, p_niveau integer, p_duo jsonb, p_options jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid(); c public.combat_champions; pr public.combat_prestige_progres; v_niv integer; v_max integer := public.combat_rp_reglage('prestige_niveaux');
  v_info jsonb; v_mine jsonb; v_id uuid;
begin
  if v_uid is null then raise exception 'Connecte-toi.'; end if;
  perform public.jeu_joueur_assurer(v_uid);
  perform public.combat_expirer(v_uid);
  select * into c from public.combat_champions where id = p_champion and actif;
  if not found then raise exception 'Champion inconnu.'; end if;
  if not exists (select 1 from public.combat_champions_progres g where g.user_id = v_uid and g.champion = c.id) then
    raise exception 'Bats d''abord ce champion dans « Les champions » pour débloquer son prestige.';
  end if;
  insert into public.combat_prestige_progres (user_id, champion) values (v_uid, c.id) on conflict do nothing;
  select * into pr from public.combat_prestige_progres where user_id = v_uid and champion = c.id for update;
  if p_niveau is null and pr.niveau_max >= v_max then raise exception 'Les % niveaux sont vaincus : renais pour recommencer plus fort, ou rejoue un niveau.', v_max; end if;
  v_niv := coalesce(p_niveau, pr.niveau_max + 1);
  if v_niv < 1 or v_niv > v_max then raise exception 'Ce niveau n''existe pas.'; end if;
  if v_niv > pr.niveau_max + 1 then raise exception 'Vaincs d''abord le niveau %.', pr.niveau_max + 1; end if;
  v_info := public.combat_prestige_equipe(c.id, v_niv, pr.renaissances);
  v_mine := public.combat_duo_unites(v_uid, p_duo);
  perform public.combat_pve_memoriser(v_uid, p_duo);
  v_id := public.combat_creer(v_uid, 'prestige', v_info ->> 'nom', v_info ->> 'decor', v_mine, v_info -> 'crew', c.id || ':' || v_niv || ':' || pr.renaissances, null, p_options);
  return public.combat_partie_json(v_id);
end $$;

create or replace function public.combat_fin_prestige(p_partie uuid, p_victoire boolean, p_abandon boolean) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  p public.combat_parties; pr public.combat_prestige_progres; c public.combat_champions; v_champ text; v_niv integer; v_ren integer; v_gains jsonb := '{}'::jsonb;
  v_max integer := public.combat_rp_reglage('prestige_niveaux'); v_info jsonb; v_titre text;
begin
  select * into p from public.combat_parties where id = p_partie;
  if not found then return '{}'::jsonb; end if;
  begin
    v_champ := split_part(coalesce(p.cible, ''), ':', 1);
    v_niv := split_part(coalesce(p.cible, ''), ':', 2)::integer;
    v_ren := split_part(coalesce(p.cible, ''), ':', 3)::integer;
  exception when others then return '{}'::jsonb;
  end;
  select * into c from public.combat_champions where id = v_champ;
  select * into pr from public.combat_prestige_progres where user_id = p.user_id and champion = v_champ for update;
  if c.id is null or pr.user_id is null then return '{}'::jsonb; end if;
  if not p_victoire then
    if not p_abandon then update public.combat_prestige_progres set defaites = defaites + 1, maj = now() where user_id = p.user_id and champion = v_champ; end if;
    return '{}'::jsonb;   -- une défaite ne coûte rien
  end if;
  update public.combat_prestige_progres set victoires = victoires + 1, maj = now() where user_id = p.user_id and champion = v_champ;
  -- Le résultat compte seulement s'il appartient à la renaissance en cours et ouvre le niveau suivant.
  if v_ren = pr.renaissances and v_niv = pr.niveau_max + 1 then
    update public.combat_prestige_progres set niveau_max = v_niv where user_id = p.user_id and champion = v_champ;
    v_info := public.combat_prestige_equipe(v_champ, v_niv, pr.renaissances);
    v_gains := public.combat_rp_ligne(v_gains, 'Niveau de prestige ' || v_niv || '/' || v_max || ' franchi');
    v_gains := public.combat_rp_verser(p.user_id, v_gains, (v_info -> 'recompense' ->> 'vinyles')::integer, (v_info -> 'recompense' ->> 'wc')::integer,
                                       'prestige:niveau', v_champ || ':' || v_ren || ':' || v_niv);
    if v_niv >= v_max then
      v_gains := public.combat_rp_verser(p.user_id, v_gains, public.combat_rp_reglage('prestige_champion_vinyles'), public.combat_rp_reglage('prestige_champion_wc'),
                                         'prestige:champion', v_champ || ':' || v_ren);
      v_titre := public.combat_rp_cosmetique(p.user_id, 'titre-prestige-' || v_champ);
      if v_titre is not null then v_gains := public.combat_rp_ligne(v_gains, 'Titre débloqué : ' || v_titre); end if;
      v_gains := public.combat_rp_ligne(v_gains, c.nom || ' est à terre : tu peux renaître pour recommencer plus fort');
    end if;
  end if;
  return v_gains;
end $$;

-- La renaissance : remise à zéro douce de la progression d'un champion (titres et gains déjà reçus restent acquis).
create or replace function public.combat_prestige_renaitre(p_champion text) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid(); pr public.combat_prestige_progres; v_max integer := public.combat_rp_reglage('prestige_niveaux'); v_new integer; v_gains jsonb := '{}'::jsonb; v_titre text;
begin
  if v_uid is null then raise exception 'Connecte-toi.'; end if;
  select * into pr from public.combat_prestige_progres where user_id = v_uid and champion = p_champion for update;
  if not found or pr.niveau_max < v_max then raise exception 'Vaincs d''abord les % niveaux de ce champion.', v_max; end if;
  if pr.renaissances >= public.combat_rp_reglage('prestige_renaiss_max') then raise exception 'Ce champion n''a plus rien à t''apprendre : renaissances au maximum.'; end if;
  if exists (select 1 from public.combat_parties where user_id = v_uid and etat = 'en_cours') then raise exception 'Un combat est en cours.'; end if;
  v_new := pr.renaissances + 1;
  update public.combat_prestige_progres set niveau_max = 0, renaissances = v_new, maj = now() where user_id = v_uid and champion = p_champion;
  v_gains := public.combat_rp_verser(v_uid, v_gains, public.combat_rp_reglage('prestige_renaiss_vinyles'), public.combat_rp_reglage('prestige_renaiss_wc') * v_new,
                                     'prestige:renaissance', p_champion || ':' || v_new);
  v_gains := public.combat_rp_ligne(v_gains, 'Renaissance ' || v_new || ' : les niveaux sont plus durs, les gains aussi');
  v_titre := public.combat_rp_cosmetique(v_uid, 'titre-prestige-renaissance');
  if v_titre is not null then v_gains := public.combat_rp_ligne(v_gains, 'Titre débloqué : ' || v_titre); end if;
  return jsonb_build_object('renaissances', v_new, 'gains', v_gains);
end $$;

create or replace function public.combat_prestige_accueil() returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); v_max integer := public.combat_rp_reglage('prestige_niveaux'); v_rmax integer := public.combat_rp_reglage('prestige_renaiss_max');
begin
  if v_uid is null then raise exception 'Connecte-toi.'; end if;
  perform public.jeu_joueur_assurer(v_uid);
  return jsonb_build_object(
    'niveaux', v_max, 'renaiss_max', v_rmax,
    'regles', jsonb_build_object('bonus_niveau', public.combat_rp_reglage('prestige_bonus_niveau'), 'bonus_renaiss', public.combat_rp_reglage('prestige_bonus_renaiss'),
                                 'gain_renaiss', public.combat_rp_reglage('prestige_gain_renaiss')),
    'champions', (select coalesce(jsonb_agg(
      (jsonb_build_object(
        'id', c.id, 'nom', c.nom, 'description', c.description, 'type_nom', t.nom, 'couleur', t.couleur,
        'debloque', g.user_id is not null, 'niveau_max', coalesce(p.niveau_max, 0), 'renaissances', coalesce(p.renaissances, 0),
        'victoires', coalesce(p.victoires, 0), 'defaites', coalesce(p.defaites, 0),
        'pret_renaitre', coalesce(p.niveau_max, 0) >= v_max and coalesce(p.renaissances, 0) < v_rmax,
        'titre', (select nom from public.cosmetiques where id = 'titre-prestige-' || c.id),
        'titre_obtenu', exists (select 1 from public.cosmetiques_obtenus o where o.user_id = v_uid and o.cosmetique_id = 'titre-prestige-' || c.id),
        'maledictions', (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'nom', m.nom, 'description', m.description) order by o.ord), '[]'::jsonb)
                           from public.combat_prestige_champions pc, unnest(pc.maledictions) with ordinality as o (id, ord)
                           join public.combat_prestige_maledictions m on m.id = o.id where pc.champion = c.id),
        'crew', public.combat_pve_apercu(jsonb_build_array(public.combat_unite(c.artist1, 4, false, 0), public.combat_unite(c.artist2, 4, false, 0)))
      ) || case when g.user_id is not null and coalesce(p.niveau_max, 0) < v_max
                then jsonb_build_object('prochain', (public.combat_prestige_equipe(c.id, coalesce(p.niveau_max, 0) + 1, coalesce(p.renaissances, 0)) - 'crew'))
                else '{}'::jsonb end)
      order by c.ordre, c.id), '[]'::jsonb)
      from public.combat_champions c join public.combat_types t on t.id = c.type
      left join public.combat_champions_progres g on g.user_id = v_uid and g.champion = c.id
      left join public.combat_prestige_progres p on p.user_id = v_uid and p.champion = c.id
     where c.actif));
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------
-- La console de l'équipe
-- ---------------------------------------------------------------------------------------------------------------------------

create or replace function public.combat_rivaux_equipe_lire() returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
begin
  perform public.combat_equipe_garde();
  return jsonb_build_object(
    'reglages', (select coalesce(jsonb_agg(jsonb_build_object('cle', r.cle, 'valeur', r.valeur, 'libelle', r.libelle) order by r.ordre), '[]'::jsonb) from public.combat_rivaux_reglages r),
    'niveaux', (select coalesce(jsonb_agg(to_jsonb(n) order by n.niveau), '[]'::jsonb) from public.combat_rivaux_niveaux n),
    'rivaux', (select coalesce(jsonb_agg(to_jsonb(r) || jsonb_build_object('nom1', a1.nom, 'nom2', a2.nom) order by r.ordre, r.id), '[]'::jsonb)
                 from public.combat_rivaux r join public.jeu_cartes a1 on a1.artist_id = r.artist1 join public.jeu_cartes a2 on a2.artist_id = r.artist2),
    'maledictions', (select coalesce(jsonb_agg(to_jsonb(m) order by m.genre desc, m.id), '[]'::jsonb) from public.combat_prestige_maledictions m),
    'champions', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'nom', c.nom, 'type_nom', t.nom, 'maledictions', to_jsonb(coalesce(pc.maledictions, '{}'))) order by c.ordre, c.id), '[]'::jsonb)
                    from public.combat_champions c join public.combat_types t on t.id = c.type left join public.combat_prestige_champions pc on pc.champion = c.id));
end $$;

create or replace function public.combat_rivaux_equipe_reglage(p_cle text, p_valeur integer) returns void
language plpgsql security definer set search_path to 'public' as $$
begin
  perform public.combat_equipe_garde();
  if not exists (select 1 from public.combat_rivaux_reglages where cle = p_cle) then raise exception 'Réglage inconnu.'; end if;
  if p_valeur is null or p_valeur < 0 or p_valeur > 5000 then raise exception 'Valeur : entre 0 et 5 000.'; end if;
  if p_cle = 'prestige_niveaux' and p_valeur not between 5 and 30 then raise exception 'Niveaux de prestige : entre 5 et 30.'; end if;
  if p_cle = 'prestige_renaiss_max' and p_valeur not between 1 and 20 then raise exception 'Renaissances : entre 1 et 20.'; end if;
  update public.combat_rivaux_reglages set valeur = p_valeur where cle = p_cle;
end $$;

create or replace function public.combat_rivaux_equipe_rival(p jsonb) returns void
language plpgsql security definer set search_path to 'public' as $$
declare v_h jsonb := p -> 'histoire'; x jsonb;
begin
  perform public.combat_equipe_garde();
  if not exists (select 1 from public.combat_rivaux where id = p ->> 'id') then raise exception 'Rival inconnu.'; end if;
  if coalesce(btrim(p ->> 'nom'), '') = '' then raise exception 'Donne un nom au rival.'; end if;
  if v_h is null or jsonb_typeof(v_h) <> 'array' or jsonb_array_length(v_h) not between 1 and 8 then raise exception 'L''histoire : 1 à 8 chapitres.'; end if;
  for x in select value from jsonb_array_elements(v_h) loop
    if jsonb_typeof(x) <> 'string' or btrim(x #>> '{}') = '' or length(x #>> '{}') > 600 then raise exception 'Chaque chapitre : du texte, 600 caractères au plus.'; end if;
  end loop;
  if not exists (select 1 from public.jeu_cartes where artist_id = (p ->> 'artist1')::uuid) or not exists (select 1 from public.jeu_cartes where artist_id = (p ->> 'artist2')::uuid) then
    raise exception 'Artiste inconnu.';
  end if;
  if (p ->> 'artist1') = (p ->> 'artist2') then raise exception 'Choisis deux artistes différents.'; end if;
  if coalesce(p ->> 'decor', 'studio') not in ('studio', 'concert', 'plateau', 'ruelle', 'toit') then raise exception 'Décor inconnu.'; end if;
  update public.combat_rivaux set nom = btrim(p ->> 'nom'), surnom = coalesce(btrim(p ->> 'surnom'), surnom), replique = coalesce(btrim(p ->> 'replique'), replique),
    histoire = v_h, artist1 = (p ->> 'artist1')::uuid, artist2 = (p ->> 'artist2')::uuid, decor = coalesce(p ->> 'decor', decor), actif = coalesce((p ->> 'actif')::boolean, actif)
   where id = p ->> 'id';
end $$;

create or replace function public.combat_rivaux_equipe_niveau(p jsonb) returns void
language plpgsql security definer set search_path to 'public' as $$
begin
  perform public.combat_equipe_garde();
  if not exists (select 1 from public.combat_rivaux_niveaux where niveau = (p ->> 'niveau')::integer) then raise exception 'Niveau inconnu.'; end if;
  if coalesce(btrim(p ->> 'nom'), '') = '' then raise exception 'Donne un nom au niveau.'; end if;
  if coalesce((p ->> 'bonus_base')::integer, -1) not between 0 and 300 then raise exception 'Bonus de départ : entre 0 et 300 %%.'; end if;
  if coalesce((p ->> 'bonus_manche')::integer, -1) not between 0 and 100 then raise exception 'Bonus par manche : entre 0 et 100 %%.'; end if;
  if coalesce((p ->> 'rarete')::integer, 0) not between 1 and 5 then raise exception 'Rareté : entre 1 et 5.'; end if;
  if coalesce((p ->> 'wc_manche')::integer, -1) not between 0 and 5000 or coalesce((p ->> 'wc_serie')::integer, -1) not between 0 and 5000 then raise exception 'Wave Coins : entre 0 et 5 000.'; end if;
  if coalesce((p ->> 'vinyles_serie')::integer, -1) not between 0 and 50 then raise exception 'Vinyles : entre 0 et 50.'; end if;
  update public.combat_rivaux_niveaux set nom = btrim(p ->> 'nom'), bonus_base = (p ->> 'bonus_base')::integer, bonus_manche = (p ->> 'bonus_manche')::integer,
    rarete = (p ->> 'rarete')::integer, wc_manche = (p ->> 'wc_manche')::integer, wc_serie = (p ->> 'wc_serie')::integer, vinyles_serie = (p ->> 'vinyles_serie')::integer
   where niveau = (p ->> 'niveau')::integer;
end $$;

create or replace function public.combat_prestige_equipe_champion(p jsonb) returns void
language plpgsql security definer set search_path to 'public' as $$
declare v_ids text[]; x text;
begin
  perform public.combat_equipe_garde();
  if not exists (select 1 from public.combat_champions where id = p ->> 'champion') then raise exception 'Champion inconnu.'; end if;
  if p -> 'maledictions' is null or jsonb_typeof(p -> 'maledictions') <> 'array' then raise exception 'Liste de malédictions invalide.'; end if;
  v_ids := array(select jsonb_array_elements_text(p -> 'maledictions'));
  if coalesce(array_length(v_ids, 1), 0) not between 1 and 8 then raise exception 'Entre 1 et 8 malédictions.'; end if;
  foreach x in array v_ids loop
    if not exists (select 1 from public.combat_prestige_maledictions where id = x) then raise exception 'Malédiction inconnue : %.', x; end if;
  end loop;
  if (select count(distinct y) from unnest(v_ids) y) <> array_length(v_ids, 1) then raise exception 'Chaque malédiction une seule fois.'; end if;
  insert into public.combat_prestige_champions (champion, maledictions) values (p ->> 'champion', v_ids)
  on conflict (champion) do update set maledictions = excluded.maledictions;
end $$;

create or replace function public.combat_prestige_equipe_malediction(p jsonb) returns void
language plpgsql security definer set search_path to 'public' as $$
begin
  perform public.combat_equipe_garde();
  if not exists (select 1 from public.combat_prestige_maledictions where id = p ->> 'id') then raise exception 'Malédiction inconnue.'; end if;
  if coalesce(btrim(p ->> 'nom'), '') = '' or coalesce(btrim(p ->> 'description'), '') = '' then raise exception 'Nom et description obligatoires.'; end if;
  if coalesce((p ->> 'valeur')::integer, -1) not between 0 and 300 then raise exception 'Valeur : entre 0 et 300.'; end if;
  update public.combat_prestige_maledictions set nom = btrim(p ->> 'nom'), description = btrim(p ->> 'description'), valeur = (p ->> 'valeur')::integer where id = p ->> 'id';
end $$;

-- Droits : les fonctions internes ne sont appelées que par d'autres fonctions SECURITY DEFINER ; les joueurs et l'équipe n'ont que les points d'entrée.
revoke all on function public.combat_rp_reglage(text), public.combat_rp_cosmetique(uuid, text), public.combat_rp_verser(uuid, jsonb, integer, integer, text, text),
  public.combat_rp_ligne(jsonb, text), public.combat_rivaux_equipe(text, integer, integer), public.combat_fin_rivaux(uuid, boolean, boolean),
  public.combat_prestige_appliquer(jsonb, text[]), public.combat_prestige_nb(integer, integer, integer), public.combat_prestige_equipe(text, integer, integer),
  public.combat_fin_prestige(uuid, boolean, boolean) from public, anon, authenticated;

revoke all on function public.combat_rivaux_duel(text, integer, jsonb, jsonb), public.combat_rivaux_accueil(), public.combat_prestige_duel(text, integer, jsonb, jsonb),
  public.combat_prestige_renaitre(text), public.combat_prestige_accueil(), public.combat_rivaux_equipe_lire(), public.combat_rivaux_equipe_reglage(text, integer),
  public.combat_rivaux_equipe_rival(jsonb), public.combat_rivaux_equipe_niveau(jsonb), public.combat_prestige_equipe_champion(jsonb),
  public.combat_prestige_equipe_malediction(jsonb) from public, anon;
grant execute on function public.combat_rivaux_duel(text, integer, jsonb, jsonb), public.combat_rivaux_accueil(), public.combat_prestige_duel(text, integer, jsonb, jsonb),
  public.combat_prestige_renaitre(text), public.combat_prestige_accueil(), public.combat_rivaux_equipe_lire(), public.combat_rivaux_equipe_reglage(text, integer),
  public.combat_rivaux_equipe_rival(jsonb), public.combat_rivaux_equipe_niveau(jsonb), public.combat_prestige_equipe_champion(jsonb),
  public.combat_prestige_equipe_malediction(jsonb) to authenticated;
