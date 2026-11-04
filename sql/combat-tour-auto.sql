-- (Passé en production le 2026-11-04 avec l'accord de Rémy.)
-- Wave Cards : le nouveau combat (2026-11-04). Plus de types. On pose son équipe (3 cartes) et le combat se joue tout seul, très vite :
-- les cartes attaquent dans l'ordre de leur Vitesse, la carte d'en face (ou la première encore debout), avec le titre de leur album
-- comme attaque (toutes les 3 attaques, le titre « signature » frappe plus fort). Les IV de l'exemplaire du joueur comptent.
-- Seul le mode « La Tour » reste ouvert (4 difficultés, 100 étages, gardien tous les 10 étages, mêmes récompenses qu'avant).
-- Sans danger si on le repasse (la suppression des types ne se fait que s'il en reste).

-- 1. On supprime les types : les champions (mode retiré pour l'instant) gardent leur ligne sans type
do $$
declare k record;
begin
  for k in select conname from pg_constraint where contype = 'f' and conrelid = 'public.combat_champions'::regclass and confrelid = 'public.combat_types'::regclass loop
    execute format('alter table public.combat_champions drop constraint %I', k.conname);
  end loop;
  alter table public.combat_champions alter column type drop not null;
  if not exists (select 1 from pg_constraint where conname = 'combat_champions_type_fkey2') then
    alter table public.combat_champions add constraint combat_champions_type_fkey2 foreign key (type) references public.combat_types(id) on delete set null on update cascade;
  end if;
  delete from public.combat_types;
end $$;
update public.combat_modes set actif = (id = 'pve_tour');

alter table public.combat_equipes drop constraint if exists combat_equipes_slot_check;
alter table public.combat_equipes add constraint combat_equipes_slot_check check (slot between 1 and 5);

-- 2. Les réglages : le nombre de cartes d'une équipe
insert into public.combat_pve_reglages (cle, valeur, libelle, ordre) values ('equipe_taille', 3, 'Cartes par équipe (1 à 5)', 0)
on conflict (cle) do nothing;
create or replace function public.combat_equipe_taille() returns integer
language sql stable set search_path to 'public' as $$ select least(5, greatest(1, coalesce((select valeur from public.combat_pve_reglages where cle = 'equipe_taille'), 3))) $$;

-- 3. L'identité d'une carte sans types : rôle, statistiques (rareté, IV de l'exemplaire du joueur), attaques = titres de l'album, passif
drop function if exists public.combat_unite(uuid, integer, boolean, integer, text, uuid);
drop function if exists public.combat_identite(uuid, integer, boolean, boolean, text, uuid);

create or replace function public.combat_identite(p_artist uuid, p_rarete integer, p_holo boolean, p_sans boolean default false, p_booster text default null, p_user uuid default null) returns jsonb
language plpgsql stable set search_path to 'public' as $$
declare
  c public.jeu_cartes; s public.combat_surcharges; ro public.combat_roles; v_role text;
  al public.jeu_albums; ex public.jeu_exemplaires; v_eff numeric := (public.jeu_iv_reglage() ->> 'effet_pct')::numeric;
  fpv numeric := 1; fpui numeric := 1; fdef numeric := 1; fvit numeric := 1; v_ivpct numeric; ti jsonb; rmax bigint; v_alb jsonb;
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

  if p_user is not null and p_booster is not null then
    select * into ex from public.jeu_exemplaires e
     where e.user_id = p_user and e.booster_id = p_booster and e.artist_id = p_artist and e.holo = coalesce(p_holo, false)
     order by (e.iv_pv + e.iv_pui + e.iv_def + e.iv_vit) desc, e.id limit 1;
    if ex.id is not null then
      fpv := 1 + v_eff / 100.0 * (2 * ex.iv_pv / 31.0 - 1);   fpui := 1 + v_eff / 100.0 * (2 * ex.iv_pui / 31.0 - 1);
      fdef := 1 + v_eff / 100.0 * (2 * ex.iv_def / 31.0 - 1); fvit := 1 + v_eff / 100.0 * (2 * ex.iv_vit / 31.0 - 1);
      v_ivpct := public.jeu_iv_pct(ex.iv_pv, ex.iv_pui, ex.iv_def, ex.iv_vit);
    end if;
  end if;

  n := greatest(0, least(1, (log(greatest(c.fans, 1000)::numeric) - 5.5) / 1.6));
  m := case when p_rarete <= 1 then 1 when p_rarete = 2 then 1.08 when p_rarete = 3 then 1.18 when p_rarete = 4 then 1.3 when p_rarete = 5 then 1.45 else 1.6 end;
  hm := case when p_holo then 1.06 else 1 end;
  h := (abs(hashtext(p_artist::text || 'vit')) % 1000) / 1000.0;
  b_pv  := coalesce(s.pv,  round((80 + 50 * n) * ro.m_pv));
  b_pui := coalesce(s.pui, round((45 + 25 * n) * ro.m_pui));
  b_def := coalesce(s.def, round((40 + 25 * n) * ro.m_def));
  b_vit := coalesce(s.vit, round((45 + 50 * h) * ro.m_vit));
  v_pv  := round(b_pv * m * hm * fpv);
  v_pui := round(b_pui * m * hm * fpui);
  v_def := round(b_def * m * hm * fdef);
  v_vit := round(b_vit * hm * fvit);

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
    'artist_id', p_artist, 'nom', c.nom, 'photo', c.photo, 'numero', c.numero, 'rarete', p_rarete, 'holo', p_holo,
    'role', v_role, 'role_nom', ro.nom, 'role_resume', ro.resume,
    'pv', v_pv, 'pui', v_pui, 'def', v_def, 'vit', v_vit,
    'titres', titres, 'capacite', jc,
    'base', jsonb_build_object('pv', b_pv, 'pui', b_pui, 'def', b_def, 'vit', b_vit),
    'mult_rarete', m, 'album', v_alb,
    'iv', case when ex.id is null then null else jsonb_build_array(ex.iv_pv, ex.iv_pui, ex.iv_def, ex.iv_vit) end, 'iv_pct', v_ivpct, 'exemplaire', ex.id,
    'surcharge', case when s.artist_id is null then null else jsonb_strip_nulls(to_jsonb(s) - 'artist_id' - 'maj_le') end);
end $$;

-- Une carte prête à combattre (p_bonus : bonus de stats en % pour les adversaires)
create or replace function public.combat_unite(p_artist uuid, p_rarete integer, p_holo boolean, p_bonus integer default 0, p_booster text default null, p_user uuid default null) returns jsonb
language plpgsql stable set search_path to 'public' as $$
declare i jsonb := public.combat_identite(p_artist, p_rarete, p_holo, false, p_booster, p_user); k numeric := 1 + coalesce(p_bonus, 0) / 100.0;
begin
  return jsonb_build_object(
    'artist_id', p_artist, 'booster', p_booster, 'nom', i ->> 'nom', 'photo', i ->> 'photo', 'numero', i -> 'numero', 'rarete', p_rarete, 'holo', p_holo,
    'role', i ->> 'role', 'role_nom', i ->> 'role_nom',
    'pv', round((i ->> 'pv')::numeric * k), 'pv_max', round((i ->> 'pv')::numeric * k), 'pui', round((i ->> 'pui')::numeric * k),
    'def', round((i ->> 'def')::numeric * k), 'vit', round((i ->> 'vit')::numeric * k),
    'titres', i -> 'titres', 'capacite', i -> 'capacite', 'iv_pct', i -> 'iv_pct');
end $$;

-- 4. Le moteur : un combat entier, simulé d'un coup (équipe a contre équipe b), avec le déroulé pour l'animation
do $$ begin
  if not exists (select 1 from pg_type where typname = 'combat_auto_u') then
    create type public.combat_auto_u as (cote integer, pos integer, nom text, pv integer, pvmax integer, pui integer, def integer, vit integer,
      cap text, capv integer, nb integer, surv boolean, titres jsonb);
  end if;
end $$;

create or replace function public.combat_auto_simuler(p_a jsonb, p_b jsonb) returns jsonb
language plpgsql volatile set search_path to 'public' as $$
declare
  u public.combat_auto_u[] := '{}'; x jsonb; i integer; j integer; r integer; na integer := jsonb_array_length(p_a); nb integer := jsonb_array_length(p_b);
  ev jsonb := '[]'::jsonb; ordre integer[]; t integer; n integer; m numeric; dmg integer; refl integer; ti jsonb; sig boolean; fin boolean := false;
  vivants_a integer; vivants_b integer; v_gagnant text; hp_a numeric; hp_b numeric; soin integer;
begin
  if na = 0 or nb = 0 then raise exception 'Il faut des cartes des deux côtés.'; end if;
  for i in 0..na - 1 loop
    x := p_a -> i;
    u := u || row(0, i + 1, x ->> 'nom', (x ->> 'pv')::integer, (x ->> 'pv_max')::integer, (x ->> 'pui')::integer, (x ->> 'def')::integer, (x ->> 'vit')::integer,
                  x -> 'capacite' ->> 'code', coalesce((x -> 'capacite' ->> 'valeur')::integer, 0), 0, false, x -> 'titres')::public.combat_auto_u;
  end loop;
  for i in 0..nb - 1 loop
    x := p_b -> i;
    u := u || row(1, i + 1, x ->> 'nom', (x ->> 'pv')::integer, (x ->> 'pv_max')::integer, (x ->> 'pui')::integer, (x ->> 'def')::integer, (x ->> 'vit')::integer,
                  x -> 'capacite' ->> 'code', coalesce((x -> 'capacite' ->> 'valeur')::integer, 0), 0, false, x -> 'titres')::public.combat_auto_u;
  end loop;

  -- Les passifs de départ : l'aura (Puissance de l'équipe), le sang-froid (Défense), la concentration (Vitesse)
  for i in 1..array_length(u, 1) loop
    if u[i].cap = 'aura' then
      for j in 1..array_length(u, 1) loop
        if u[j].cote = u[i].cote then u[j].pui := round(u[j].pui * (1 + greatest(u[i].capv, 10) / 100.0)); end if;
      end loop;
      ev := ev || jsonb_build_object('t', 'passif', 'c', jsonb_build_array(u[i].cote, u[i].pos), 'n', 'Aura de star');
    elsif u[i].cap = 'sang_froid' then
      u[i].def := round(u[i].def * 1.15); ev := ev || jsonb_build_object('t', 'passif', 'c', jsonb_build_array(u[i].cote, u[i].pos), 'n', 'Sang-froid');
    elsif u[i].cap = 'concentration' then
      u[i].vit := round(u[i].vit * 1.15); ev := ev || jsonb_build_object('t', 'passif', 'c', jsonb_build_array(u[i].cote, u[i].pos), 'n', 'Flow chirurgical');
    end if;
  end loop;

  r := 0;
  while r < 30 and not fin loop
    r := r + 1;
    ev := ev || jsonb_build_object('t', 'tour', 'n', r);
    select array_agg(q.i order by q.vit desc, random()) into ordre from (select g as i, u[g].vit as vit from generate_series(1, array_length(u, 1)) g where u[g].pv > 0) q;
    foreach i in array ordre loop
      continue when u[i].pv <= 0;
      -- la cible : la carte d'en face, sinon la première encore debout
      t := null;
      for j in 1..array_length(u, 1) loop
        if u[j].cote <> u[i].cote and u[j].pos = u[i].pos and u[j].pv > 0 then t := j; exit; end if;
      end loop;
      if t is null then
        for j in 1..array_length(u, 1) loop
          if u[j].cote <> u[i].cote and u[j].pv > 0 then t := j; exit; end if;
        end loop;
      end if;
      if t is null then fin := true; exit; end if;

      u[i].nb := u[i].nb + 1; n := u[i].nb;
      ti := u[i].titres -> ((n - 1) % greatest(jsonb_array_length(u[i].titres), 1))::integer;
      m := coalesce((ti ->> 'mult')::numeric, 1);
      sig := n % 3 = 0;
      dmg := greatest(1, round(u[i].pui * m * case when sig then 1.6 else 1 end * case when u[i].cap = 'ouverture' and n = 1 then 1 + greatest(u[i].capv, 30) / 100.0 else 1 end
                               * 100.0 / (100 + u[t].def)));
      u[t].pv := u[t].pv - dmg;
      if u[t].pv <= 0 and u[t].cap = 'survivant' and not u[t].surv then
        u[t].pv := 1; u[t].surv := true;
        ev := ev || jsonb_build_object('t', 'passif', 'c', jsonb_build_array(u[t].cote, u[t].pos), 'n', 'Jamais au tapis');
      end if;
      ev := ev || jsonb_build_object('t', 'att', 'a', jsonb_build_array(u[i].cote, u[i].pos), 'c', jsonb_build_array(u[t].cote, u[t].pos),
                                     'n', ti ->> 'nom', 'd', dmg, 's', sig, 'pv', greatest(u[t].pv, 0));
      if u[t].pv > 0 and u[t].cap = 'epines' then
        refl := greatest(1, round(dmg * greatest(u[t].capv, 12) / 100.0));
        u[i].pv := u[i].pv - refl;
        ev := ev || jsonb_build_object('t', 'epines', 'c', jsonb_build_array(u[i].cote, u[i].pos), 'd', refl, 'pv', greatest(u[i].pv, 0));
      end if;
      if u[t].pv <= 0 then
        ev := ev || jsonb_build_object('t', 'ko', 'c', jsonb_build_array(u[t].cote, u[t].pos));
        if u[t].cap = 'dernier_souffle' then
          for j in 1..array_length(u, 1) loop
            if u[j].cote <> u[t].cote and u[j].pv > 0 then
              refl := greatest(1, round(u[t].pvmax * greatest(u[t].capv, 15) / 100.0));
              u[j].pv := u[j].pv - refl;
              ev := ev || jsonb_build_object('t', 'epines', 'c', jsonb_build_array(u[j].cote, u[j].pos), 'd', refl, 'pv', greatest(u[j].pv, 0), 'n', 'Dernier couplet');
              if u[j].pv <= 0 then ev := ev || jsonb_build_object('t', 'ko', 'c', jsonb_build_array(u[j].cote, u[j].pos)); end if;
              exit;
            end if;
          end loop;
        end if;
      end if;
      if u[i].pv <= 0 then ev := ev || jsonb_build_object('t', 'ko', 'c', jsonb_build_array(u[i].cote, u[i].pos)); end if;

      select count(*) filter (where g.cote = 0 and g.pv > 0), count(*) filter (where g.cote = 1 and g.pv > 0) into vivants_a, vivants_b from unnest(u) g;
      if vivants_a = 0 or vivants_b = 0 then fin := true; exit; end if;
    end loop;

    if not fin then
      for i in 1..array_length(u, 1) loop
        if u[i].pv > 0 and u[i].cap = 'regeneration' then
          soin := least(u[i].pvmax - u[i].pv, greatest(1, round(u[i].pvmax * greatest(u[i].capv, 6) / 100.0)));
          if soin > 0 then
            u[i].pv := u[i].pv + soin;
            ev := ev || jsonb_build_object('t', 'soin', 'c', jsonb_build_array(u[i].cote, u[i].pos), 'd', soin, 'pv', u[i].pv);
          end if;
        end if;
      end loop;
    end if;
  end loop;

  select count(*) filter (where g.cote = 0 and g.pv > 0), count(*) filter (where g.cote = 1 and g.pv > 0),
         sum(greatest(g.pv, 0)) filter (where g.cote = 0)::numeric / nullif(sum(g.pvmax) filter (where g.cote = 0), 0),
         sum(greatest(g.pv, 0)) filter (where g.cote = 1)::numeric / nullif(sum(g.pvmax) filter (where g.cote = 1), 0)
    into vivants_a, vivants_b, hp_a, hp_b from unnest(u) g;
  -- Au bout de 30 tours : celui qui a gardé le plus de PV l'emporte (égalité : le défenseur)
  v_gagnant := case when vivants_b = 0 and vivants_a > 0 then 'a' when vivants_a = 0 then 'b' when coalesce(hp_a, 0) > coalesce(hp_b, 0) then 'a' else 'b' end;
  return jsonb_build_object('gagnant', v_gagnant, 'tours', r, 'evenements', ev,
    'restants', jsonb_build_object('a', coalesce(hp_a, 0), 'b', coalesce(hp_b, 0)));
end $$;

-- 5. Les cartes d'une équipe du joueur : des cartes différentes qu'il possède, prêtes à combattre
create or replace function public.combat_equipe_unites(p_user uuid, p_equipe jsonb) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare r jsonb := '[]'::jsonb; d jsonb; v_b text; v_a uuid; v_h boolean; v_r integer; v_seen text[] := '{}'; v_key text; v_n integer := public.combat_equipe_taille();
begin
  if p_equipe is null or jsonb_typeof(p_equipe) <> 'array' or jsonb_array_length(p_equipe) <> v_n then raise exception 'Choisis exactement % cartes.', v_n; end if;
  for d in select value from jsonb_array_elements(p_equipe) loop
    v_b := d ->> 'booster';
    begin v_a := (d ->> 'artist')::uuid; exception when others then raise exception 'Carte invalide.'; end;
    v_h := coalesce((d ->> 'holo')::boolean, false);
    v_key := coalesce(v_b, '') || v_a::text;
    if v_key = any (v_seen) then raise exception 'Choisis des cartes différentes.'; end if;
    v_seen := v_seen || v_key;
    select bc.rarete into v_r from public.jeu_booster_cartes bc join public.jeu_boosters bo on bo.id = bc.booster_id and bo.classeur where bc.booster_id = v_b and bc.artist_id = v_a;
    if not found then raise exception 'Cette carte n''existe pas.'; end if;
    if not exists (select 1 from public.jeu_collection_b where user_id = p_user and booster_id = v_b and artist_id = v_a and holo = v_h and quantite > 0) then raise exception 'Tu ne possèdes pas cette carte.'; end if;
    r := r || public.combat_unite(v_a, v_r, v_h, 0, v_b, p_user);
  end loop;
  return r;
end $$;

-- 6. Les adversaires d'un étage de la Tour : une équipe de la même taille, des artistes de plus en plus connus
create or replace function public.combat_tour_equipe(p_diff text, p_etage integer) returns jsonb
language plpgsql stable set search_path to 'public' as $$
declare
  d public.combat_tour_difficultes; n integer; frac numeric; centre integer; marge integer; v_k integer; v_t integer := public.combat_equipe_taille();
  v_rangs integer[] := '{}'; v_r integer; v_gardien boolean; v_rar integer; v_bonus integer; v_decor text; v_crew jsonb := '[]'::jsonb; v_guard integer := 0;
begin
  select * into d from public.combat_tour_difficultes where id = p_diff and actif;
  if not found then raise exception 'Difficulté inconnue.'; end if;
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

-- 7. L'accueil de la Tour : les difficultés, l'étage à gravir avec ses adversaires, la dernière équipe
create or replace function public.combat_tour_accueil() returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Connecte-toi.'; end if;
  perform public.jeu_joueur_assurer(v_uid);
  return jsonb_build_object(
    'taille', public.combat_equipe_taille(),
    'difficultes', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', d.id, 'nom', d.nom, 'resume', d.resume, 'etages', d.etages, 'etage_max', coalesce(p.etage_max, 0),
        'victoires', coalesce(p.victoires, 0), 'defaites', coalesce(p.defaites, 0),
        'debloque', public.combat_tour_debloque(v_uid, d.id), 'deblocage_etage', d.deblocage_etage,
        'precedente', (select pd.nom from public.combat_tour_difficultes pd where pd.actif and pd.ordre < d.ordre order by pd.ordre desc limit 1),
        'gardiens', (select coalesce(jsonb_agg(jsonb_build_object('etage', g, 'fait', g <= coalesce(p.etage_max, 0), 'recompense', public.combat_tour_recompense(d.id, g)) order by g), '[]'::jsonb) from generate_series(10, d.etages, 10) g),
        'prochain', case when coalesce(p.etage_max, 0) < d.etages and public.combat_tour_debloque(v_uid, d.id)
          then (public.combat_tour_equipe(d.id, coalesce(p.etage_max, 0) + 1) - 'crew')
               || jsonb_build_object('crew', (select jsonb_agg(u - 'titres' - 'capacite') from jsonb_array_elements(public.combat_tour_equipe(d.id, coalesce(p.etage_max, 0) + 1) -> 'crew') u),
                                     'recompense', public.combat_tour_recompense(d.id, coalesce(p.etage_max, 0) + 1)) end
      ) order by d.ordre), '[]'::jsonb)
      from public.combat_tour_difficultes d left join public.combat_tour_progres p on p.user_id = v_uid and p.difficulte = d.id where d.actif),
    'equipe', (select coalesce(jsonb_agg(jsonb_build_object('booster', e.booster_id, 'artist', e.artist_id, 'holo', e.holo) order by e.slot), '[]'::jsonb)
                 from public.combat_equipes e where e.user_id = v_uid and e.role = 'principal'));
end $$;

-- 8. Lancer un combat : l'équipe est vérifiée, le combat est simulé, la progression et les récompenses sont données (première victoire d'un étage)
create or replace function public.combat_tour_lancer(p_difficulte text, p_etage integer, p_equipe jsonb) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid(); d public.combat_tour_difficultes; v_max integer; v_etage integer; v_info jsonb; v_mine jsonb; v_sim jsonb; v_vic boolean;
  v_wc integer := 0; v_vin integer := 0; rec jsonb; v_gains jsonb := '{}'::jsonb; v_prem boolean := false; i integer;
begin
  if v_uid is null then raise exception 'Connecte-toi.'; end if;
  perform public.jeu_joueur_assurer(v_uid);
  select * into d from public.combat_tour_difficultes where id = p_difficulte and actif;
  if not found then raise exception 'Difficulté inconnue.'; end if;
  if not public.combat_tour_debloque(v_uid, d.id) then raise exception 'Cette difficulté n''est pas encore débloquée.'; end if;
  insert into public.combat_tour_progres (user_id, difficulte) values (v_uid, d.id) on conflict (user_id, difficulte) do nothing;
  select etage_max into v_max from public.combat_tour_progres where user_id = v_uid and difficulte = d.id for update;
  v_max := coalesce(v_max, 0);
  v_etage := coalesce(p_etage, v_max + 1);
  if v_etage < 1 or v_etage > d.etages then raise exception 'Cet étage n''existe pas.'; end if;
  if v_etage > v_max + 1 then raise exception 'Gravis d''abord l''étage %.', v_max + 1; end if;

  v_mine := public.combat_equipe_unites(v_uid, p_equipe);
  v_info := public.combat_tour_equipe(d.id, v_etage);
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

  return jsonb_build_object('victoire', v_vic, 'premiere', v_prem, 'gains', v_gains, 'difficulte', d.id, 'difficulte_nom', d.nom, 'etage', v_etage,
    'etage_max', greatest(v_max, case when v_vic then v_etage else 0 end), 'etages', d.etages, 'gardien', v_info -> 'gardien', 'nom', v_info ->> 'nom', 'decor', v_info ->> 'decor',
    'a', v_mine, 'b', v_info -> 'crew', 'tours', v_sim -> 'tours', 'evenements', v_sim -> 'evenements', 'etat', public.jeu_etat_json(v_uid));
end $$;

-- 9. Mes cartes pour composer l'équipe (une ligne par carte possédée : stats avec les IV du meilleur exemplaire)
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

revoke all on function public.combat_equipe_taille(), public.combat_identite(uuid, integer, boolean, boolean, text, uuid), public.combat_unite(uuid, integer, boolean, integer, text, uuid),
  public.combat_auto_simuler(jsonb, jsonb), public.combat_equipe_unites(uuid, jsonb), public.combat_tour_equipe(text, integer),
  public.combat_tour_accueil(), public.combat_tour_lancer(text, integer, jsonb), public.combat_tour_cartes() from public, anon;
grant execute on function public.combat_tour_accueil(), public.combat_tour_lancer(text, integer, jsonb), public.combat_tour_cartes() to authenticated;
