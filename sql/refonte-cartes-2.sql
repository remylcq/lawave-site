-- Wave Cards : cartes pour tous les artistes du site, attaques sans noms, récompenses de la Tour (2026-11-10).
--   1. Une carte par sortie pour TOUS les artistes présents sur le site (hors artistes d'une autre langue que le français) : plus de seuil de fans.
--   2. Les cartes n'ont plus de noms d'attaques : elles attaquent avec leur seule Puissance (le coup « signature » toutes les 3 attaques reste).
--   3. La Tour : chaque victoire rapporte 1 vinyle ; un gardien (tous les 10 étages) rapporte 3 vinyles + 1 par 20 étages (étage 100 : 8, étage 1 000 : 53).
--      Un étage déjà franchi rapporte 1 vinyle par victoire, dans la limite de 10 par jour, pour que rejouer en boucle ne fasse pas de vinyles à l'infini.
-- Sans danger si on le repasse.

alter table public.jeu_jour add column if not exists tour_vinyles integer not null default 0;

-- 1. Les cartes
do $$
declare d text;
begin
  d := pg_get_functiondef('public.jeu_cartes_rafraichir()'::regprocedure);
  if position('a.francophone is not false' in d) = 0 then
    if position(E'where not a.banni and (a.francophone is true or (a.francophone is null and a.source is null))\n       and (coalesce(a.deezer_fans, 0) >= 1000 or a.source is null or a.source = ''liste-rappeurs'')' in d) = 0 then
      raise exception 'jeu_cartes_rafraichir : motif introuvable';
    end if;
    d := replace(d, E'where not a.banni and (a.francophone is true or (a.francophone is null and a.source is null))\n       and (coalesce(a.deezer_fans, 0) >= 1000 or a.source is null or a.source = ''liste-rappeurs'')',
      'where not a.banni and a.francophone is not false');
    execute d;
  end if;

  -- 2. Plus de noms d'attaques
  d := pg_get_functiondef('public.combat_identite(uuid,integer,boolean,boolean,text,uuid,integer,integer)'::regprocedure);
  if position('''titres'', ''[]''::jsonb' in d) = 0 then
    if position('''titres'', titres, ''capacite'', jc,' in d) = 0 then raise exception 'combat_identite : motif introuvable'; end if;
    d := replace(d, '''titres'', titres, ''capacite'', jc,', '''titres'', ''[]''::jsonb, ''capacite'', jc,');
    execute d;
  end if;
end $$;

select public.jeu_cartes_rafraichir();

-- les titres des sorties ne servent plus au combat : la tâche de fond qui les lisait s'arrête
do $$ begin
  if exists (select 1 from cron.job where jobname = 'albums-cartes') then perform cron.unschedule('albums-cartes'); end if;
end $$;

-- 3. Les récompenses de la Tour
create or replace function public.combat_tour_recompense(p_diff text, p_etage integer) returns jsonb
language plpgsql stable set search_path to 'public' as $$
declare d public.combat_tour_difficultes; v_wc integer; v_vin integer;
begin
  select * into d from public.combat_tour_difficultes where id = p_diff;
  if not found then return jsonb_build_object('vinyles', 0, 'wc', 0); end if;
  v_wc := greatest(1, round(d.mult_wc * (1 + p_etage / 100.0))::integer);
  v_vin := 1;
  if p_etage % 10 = 0 then
    v_wc := v_wc + round(d.mult_wc * 10)::integer;
    v_vin := round(d.mult_vinyles * (3 + p_etage / 20))::integer;
  end if;
  return jsonb_build_object('vinyles', greatest(v_vin, 1), 'wc', v_wc);
end $$;

create or replace function public.combat_tour_lancer(p_etage integer, p_equipe jsonb) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid(); d public.combat_tour_difficultes; v_max integer; v_etage integer; v_info jsonb; v_mine jsonb; v_sim jsonb; v_vic boolean;
  v_wc integer := 0; v_vin integer := 0; rec jsonb; v_gains jsonb := '{}'::jsonb; v_prem boolean := false; i integer; v_rejeu integer;
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
  elsif v_vic then
    -- un étage déjà franchi : 1 vinyle par victoire, 10 par jour au plus
    insert into public.jeu_jour (user_id, jour) values (v_uid, public.xp_jour()) on conflict (user_id, jour) do nothing;
    update public.jeu_jour set tour_vinyles = tour_vinyles + 1 where user_id = v_uid and jour = public.xp_jour() and tour_vinyles < 10 returning tour_vinyles into v_rejeu;
    if v_rejeu is not null then
      perform public.jeu_crediter(v_uid, 1, 0, 0);
      v_gains := jsonb_build_object('vinyles', 1, 'wc', 0, 'rejeu_restant', 10 - v_rejeu);
    end if;
  end if;

  return jsonb_build_object('victoire', v_vic, 'premiere', v_prem, 'gains', v_gains, 'etage', v_etage,
    'etage_max', greatest(v_max, case when v_vic then v_etage else 0 end), 'etages', d.etages, 'gardien', v_info -> 'gardien', 'nom', v_info ->> 'nom', 'decor', v_info ->> 'decor',
    'a', v_mine, 'b', v_info -> 'crew', 'tours', v_sim -> 'tours', 'evenements', v_sim -> 'evenements', 'etat', public.jeu_etat_json(v_uid));
end $$;
revoke all on function public.combat_tour_lancer(integer, jsonb) from public, anon;
grant execute on function public.combat_tour_lancer(integer, jsonb) to authenticated;
