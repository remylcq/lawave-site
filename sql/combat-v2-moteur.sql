-- Wave Cards : le combat 2v2, nouveau moteur à jauge de tour (2026-10-28).
-- Fonctions INTERNES (aucun droit pour les joueurs : seules les fonctions de sql/combat-v2-jeu.sql les appellent).
-- Un combat = 4 « unités » (indices 0-1 : le joueur, 2-3 : l'adversaire) décrites en JSON. Chaque unité a une JAUGE (0 à 100) qui se
-- remplit selon sa Vitesse ; quand elle est pleine, l'unité joue (une technique sur une cible), puis sa jauge repart de zéro.
-- Les durées (statuts, recharges) se comptent en tours DE L'UNITÉ concernée. Hasard, ordre, dégâts : tout est calculé ici.
--
-- Dégâts d'un coup = puissance × Puissance / Défense × 0,36 × affinité (▲ ×1,5 / ▼ ×0,67) × 1,2 (même style) × critique (8 %, ×1,5)
--                    × 0,9..1 × dégâts subis en plus (marque, gel). Une technique « perce » une part de la Défense.
-- Statistiques modifiées par des statuts en % (±), bornées entre ×0,4 et ×2,2. Limite : 120 actions, puis le plus de PV restants gagne.

drop function if exists public.combat_mult_stage(integer);
drop function if exists public.combat_soigner(jsonb, integer, integer);
drop function if exists public.combat_effet(jsonb, integer, text, integer);
drop function if exists public.combat_agir(jsonb, integer, integer, integer);
drop function if exists public.combat_fin_tour(jsonb);
drop function if exists public.combat_ia_unite(jsonb, integer);
drop function if exists public.combat_moteur(jsonb, jsonb, integer);

-- ---------------------------------------------------------------------------------------------------------------------------
-- Petits outils
-- ---------------------------------------------------------------------------------------------------------------------------

create or replace function public.combat_push(st jsonb, e jsonb) returns jsonb
language sql immutable set search_path to 'public' as
$$ select jsonb_set(st, '{ev}', (st -> 'ev') || e) $$;

-- Un statut est-il néfaste ?
create or replace function public.combat_neg(k text) returns boolean
language sql immutable set search_path to 'public' as
$$ select k in ('pui-', 'def-', 'vit-', 'etourdi', 'gel', 'brulure', 'poison', 'marque') $$;

create or replace function public.combat_sv(u jsonb, k text) returns numeric
language sql immutable set search_path to 'public' as
$$ select coalesce(sum((s ->> 'v')::numeric), 0) from jsonb_array_elements(u -> 'statuts') s where s ->> 'k' = k $$;

create or replace function public.combat_a(u jsonb, k text) returns boolean
language sql immutable set search_path to 'public' as
$$ select exists (select 1 from jsonb_array_elements(u -> 'statuts') s where s ->> 'k' = k) $$;

-- Une statistique « en direct » : base × statuts (± en %), plus la fureur (passif) et la brûlure.
create or replace function public.combat_stat(u jsonb, champ text) returns numeric
language plpgsql immutable set search_path to 'public' as $$
declare b numeric := public.combat_sv(u, champ || '+') - public.combat_sv(u, champ || '-'); cap jsonb := u -> 'capacite';
begin
  if champ = 'pui' then
    if public.combat_a(u, 'brulure') then b := b - 10; end if;
    if cap ->> 'code' = 'rage' and (u ->> 'pv')::numeric * 2 <= (u ->> 'pv_max')::numeric then b := b + (cap ->> 'valeur')::numeric; end if;
  end if;
  return greatest(1, (u ->> champ)::numeric * greatest(0.4, least(2.2, 1 + b / 100)));
end $$;

create or replace function public.combat_aff(p_att text, p_def text) returns numeric
language sql stable set search_path to 'public' as
$$ select coalesce((select mult from public.combat_affinites where att = p_att and def = p_def), 1) $$;

create or replace function public.combat_type_de(p_artist uuid) returns text
language sql stable set search_path to 'public' as
$$ select coalesce(
     (select s.type from public.combat_surcharges s where s.artist_id = p_artist and s.type is not null),
     (select (array_agg(t.id order by t.ordre))[1 + abs(hashtext(p_artist::text)) % count(*)] from public.combat_types t)) $$;

-- Le rôle par défaut : déterministe, tiré de l'artiste parmi les trois rôles qui vont le mieux à son style.
create or replace function public.combat_role_de(p_artist uuid, p_type text) returns text
language sql stable set search_path to 'public' as
$$ select coalesce(
     (select s.role from public.combat_surcharges s where s.artist_id = p_artist and s.role is not null),
     (case p_type
        when 'drill'     then array['lyriciste', 'briseur', 'clasheur']
        when 'trap'      then array['clasheur', 'hypeman', 'lyriciste']
        when 'boombap'   then array['pilier', 'beatmaker', 'lyriciste']
        when 'cloud'     then array['beatmaker', 'clasheur', 'hypeman']
        when 'pop'       then array['hypeman', 'beatmaker', 'lyriciste']
        when 'conscient' then array['beatmaker', 'pilier', 'lyriciste']
        when 'rue'       then array['pilier', 'briseur', 'clasheur']
        when 'afro'      then array['hypeman', 'beatmaker', 'briseur']
        else array['lyriciste', 'pilier', 'hypeman'] end)[1 + abs(hashtext(p_artist::text || 'role')) % 3]) $$;

-- ---------------------------------------------------------------------------------------------------------------------------
-- L'identité de combat d'une carte : style, rôle, statistiques, 3 techniques, passif, citation, faiblesses, résistances, forces.
-- p_sans : ignore les surcharges (pour montrer ce que serait la valeur par défaut).
-- ---------------------------------------------------------------------------------------------------------------------------

create or replace function public.combat_technique_json(p_id text, p_type text) returns jsonb
language sql stable set search_path to 'public' as
$$ select jsonb_build_object('id', t.id, 'nom', t.nom, 'slot', t.slot, 'type', coalesce(t.type, p_type), 'type_nom', ty.nom, 'couleur', ty.couleur,
          'puissance', t.puissance, 'hits', t.hits, 'justesse', t.justesse, 'cible', t.cible, 'recharge', t.recharge, 'perce', t.perce,
          'effets', t.effets, 'description', t.description)
     from public.combat_techniques t left join public.combat_types ty on ty.id = coalesce(t.type, p_type) where t.id = p_id $$;

create or replace function public.combat_identite(p_artist uuid, p_rarete integer, p_holo boolean, p_sans boolean default false)
returns jsonb language plpgsql stable set search_path to 'public' as $$
declare
  c public.jeu_cartes; s public.combat_surcharges; ty public.combat_types; ro public.combat_roles; v_t text; v_role text;
  n numeric; m numeric; hm numeric; h numeric; v_pv integer; v_pui integer; v_def integer; v_vit integer;
  b_pv integer; b_pui integer; b_def integer; b_vit integer;
  ids text[]; tid text; techs jsonb := '[]'::jsonb; sl integer; cp text; jc jsonb; faibles jsonb; resiste jsonb; forts jsonb;
begin
  select * into c from public.jeu_cartes where artist_id = p_artist;
  if not found then raise exception 'Carte inconnue.'; end if;
  if not p_sans then select * into s from public.combat_surcharges where artist_id = p_artist; end if;

  v_t := coalesce(s.type, (select (array_agg(t.id order by t.ordre))[1 + abs(hashtext(p_artist::text)) % count(*)] from public.combat_types t));
  select * into ty from public.combat_types where id = v_t;
  v_role := coalesce(s.role, public.combat_role_de(p_artist, v_t));
  if p_sans then
    v_role := public.combat_role_de(p_artist, v_t);
    select * into s from public.combat_surcharges where false;
  end if;
  select * into ro from public.combat_roles where id = v_role;

  n := greatest(0, least(1, (log(greatest(c.fans, 1000)::numeric) - 5.5) / 1.6));
  m := case when p_rarete <= 1 then 1 when p_rarete = 2 then 1.08 when p_rarete = 3 then 1.18 when p_rarete = 4 then 1.3 else 1.45 end;
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

  for sl in 1..3 loop
    tid := case sl when 1 then s.tech1 when 2 then s.tech2 else s.tech3 end;
    if tid is null or not exists (select 1 from public.combat_techniques where id = tid) then
      ids := array(select id from public.combat_techniques where actif and role = v_role and slot = sl order by id);
      if array_length(ids, 1) is null then ids := array(select id from public.combat_techniques where actif and slot = sl order by id); end if;
      tid := ids[1 + abs(hashtext(p_artist::text || 'tech' || sl)) % array_length(ids, 1)];
    end if;
    techs := techs || jsonb_build_array(public.combat_technique_json(tid, v_t));
  end loop;

  cp := s.capacite;
  if cp is null and p_rarete >= 4 then
    ids := array(select id from public.combat_capacites order by id);
    cp := ids[1 + abs(hashtext(p_artist::text || 'cap')) % array_length(ids, 1)];
  end if;
  if cp is not null then
    select jsonb_build_object('id', id, 'nom', nom, 'code', code, 'valeur', valeur, 'description', description) into jc from public.combat_capacites where id = cp;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'nom', t.nom, 'couleur', t.couleur, 'mult', a.mult) order by t.ordre), '[]'::jsonb) into faibles
    from public.combat_affinites a join public.combat_types t on t.id = a.att where a.def = v_t and a.mult > 1;
  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'nom', t.nom, 'couleur', t.couleur, 'mult', a.mult) order by t.ordre), '[]'::jsonb) into resiste
    from public.combat_affinites a join public.combat_types t on t.id = a.att where a.def = v_t and a.mult < 1;
  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'nom', t.nom, 'couleur', t.couleur, 'mult', a.mult) order by t.ordre), '[]'::jsonb) into forts
    from public.combat_affinites a join public.combat_types t on t.id = a.def where a.att = v_t and a.mult > 1;

  return jsonb_build_object(
    'artist_id', p_artist, 'nom', c.nom, 'photo', c.photo, 'numero', c.numero, 'rarete', p_rarete, 'holo', p_holo,
    'type', v_t, 'type_nom', ty.nom, 'couleur', ty.couleur, 'citation', coalesce(s.citation, ty.citation),
    'role', v_role, 'role_nom', ro.nom, 'role_resume', ro.resume,
    'pv', v_pv, 'pui', v_pui, 'def', v_def, 'vit', v_vit,
    'techniques', techs, 'capacite', jc,
    'faiblesses', faibles, 'resistances', resiste, 'forces', forts,
    'base', jsonb_build_object('pv', b_pv, 'pui', b_pui, 'def', b_def, 'vit', b_vit),
    'mult_rarete', m,
    'surcharge', case when s.artist_id is null then null else jsonb_strip_nulls(to_jsonb(s) - 'artist_id' - 'maj_le') end);
end $$;

-- Une unité prête à combattre (p_bonus : bonus de stats en %, pour les crews de l'Arène et du défi du jour).
create or replace function public.combat_unite(p_artist uuid, p_rarete integer, p_holo boolean, p_bonus integer default 0)
returns jsonb language plpgsql stable set search_path to 'public' as $$
declare i jsonb := public.combat_identite(p_artist, p_rarete, p_holo); k numeric := 1 + coalesce(p_bonus, 0) / 100.0; cd jsonb;
begin
  select jsonb_agg(case when (t ->> 'slot')::integer = 3 then greatest((t ->> 'recharge')::integer - 2, 0) else 0 end order by o)
    into cd from jsonb_array_elements(i -> 'techniques') with ordinality as x (t, o);
  return jsonb_build_object(
    'artist_id', p_artist, 'nom', i ->> 'nom', 'photo', i ->> 'photo', 'numero', i -> 'numero', 'rarete', p_rarete, 'holo', p_holo,
    'type', i ->> 'type', 'type_nom', i ->> 'type_nom', 'couleur', i ->> 'couleur', 'role', i ->> 'role', 'role_nom', i ->> 'role_nom',
    'pv', round((i ->> 'pv')::numeric * k), 'pv_max', round((i ->> 'pv')::numeric * k),
    'pui', round((i ->> 'pui')::numeric * k), 'def', round((i ->> 'def')::numeric * k), 'vit', round((i ->> 'vit')::numeric * k),
    'jauge', 0, 'techs', i -> 'techniques', 'cd', cd, 'statuts', '[]'::jsonb, 'capacite', i -> 'capacite',
    'ko', false, 'ouv', false, 'surv', false, 'stats', jsonb_build_object('deg', 0, 'soins', 0, 'ko', 0, 'sub', 0),
    'faiblesses', (select coalesce(jsonb_agg(x ->> 'id'), '[]'::jsonb) from jsonb_array_elements(i -> 'faiblesses') x),
    'resistances', (select coalesce(jsonb_agg(x ->> 'id'), '[]'::jsonb) from jsonb_array_elements(i -> 'resistances') x),
    'forces', (select coalesce(jsonb_agg(x ->> 'id'), '[]'::jsonb) from jsonb_array_elements(i -> 'forces') x));
end $$;

-- Les quatre unités d'un combat : p_a (le joueur) aux indices 0-1, p_b aux indices 2-3. Les passifs de départ sont posés ici :
-- aura de star (Puissance du duo), bon rythme (jauge de départ), armure de scène (bouclier de départ).
create or replace function public.combat_assembler(p_a jsonb, p_b jsonb) returns jsonb
language plpgsql stable set search_path to 'public' as $$
declare r jsonb := '[]'::jsonb; u jsonb; k integer; camp integer; src jsonb; aura numeric; code text; val numeric;
begin
  for camp in 0..1 loop
    src := case when camp = 0 then p_a else p_b end;
    aura := 0;
    for k in 0..jsonb_array_length(src) - 1 loop
      if src -> k -> 'capacite' ->> 'code' = 'aura' then aura := greatest(aura, (src -> k -> 'capacite' ->> 'valeur')::numeric); end if;
    end loop;
    for k in 0..jsonb_array_length(src) - 1 loop
      u := (src -> k) || jsonb_build_object('camp', camp, 'idx', camp * 2 + k);
      if aura > 0 then u := jsonb_set(u, '{pui}', to_jsonb(round((u ->> 'pui')::numeric * (1 + aura / 100)))); end if;
      code := u -> 'capacite' ->> 'code'; val := coalesce((u -> 'capacite' ->> 'valeur')::numeric, 0);
      if code = 'rythme' then u := jsonb_set(u, '{jauge}', to_jsonb(least(80, val))); end if;
      if code = 'bouclier' then
        u := jsonb_set(u, '{statuts}', jsonb_build_array(jsonb_build_object('k', 'bouclier', 'v', round((u ->> 'pv_max')::numeric * val / 100), 'd', 4)));
      end if;
      r := r || u;
    end loop;
  end loop;
  return r;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------
-- Statuts, dégâts, soins
-- ---------------------------------------------------------------------------------------------------------------------------

-- Pose un statut (k, valeur en % ou en PV, durée en tours de la cible). p_z : posé par la cible sur elle-même pendant son tour
-- (sa durée ne baisse pas à la fin de ce même tour).
create or replace function public.combat_poser(st jsonb, tgt integer, k text, v numeric, d integer, p_z boolean default false) returns jsonb
language plpgsql volatile set search_path to 'public' as $$
declare tu jsonb := st -> 'u' -> tgt; l jsonb; old jsonb; nv numeric := v; nd integer := d; nn jsonb;
begin
  if (tu ->> 'ko')::boolean then return st; end if;
  if public.combat_neg(k) and k <> 'marque' and tu -> 'capacite' ->> 'code' = 'sang_froid' then
    return public.combat_push(st, jsonb_build_object('t', 'immunise', 'c', tgt));
  end if;
  select s into old from jsonb_array_elements(tu -> 'statuts') s where s ->> 'k' = k limit 1;
  if old is not null then nv := greatest(v, (old ->> 'v')::numeric); nd := greatest(d, (old ->> 'd')::integer); end if;
  select coalesce(jsonb_agg(s), '[]'::jsonb) into l from jsonb_array_elements(tu -> 'statuts') s where s ->> 'k' <> k;
  nn := jsonb_build_object('k', k, 'v', nv, 'd', nd);
  if p_z then nn := nn || '{"z":true}'::jsonb; end if;
  l := l || nn;
  if jsonb_array_length(l) > 8 then l := l - 0; end if;
  st := jsonb_set(st, array['u', tgt::text, 'statuts'], l);
  st := public.combat_push(st, jsonb_build_object('t', 'statut', 'c', tgt, 'k', k, 'v', nv, 'd', nd));
  return public.combat_push(st, jsonb_build_object('t', 'statuts', 'c', tgt, 's', l));
end $$;

-- Retire des PV (bouclier d'abord, sauf dégâts sur la durée) et note l'événement. src = cible pour les dégâts qu'on se fait soi-même.
create or replace function public.combat_blesser(st jsonb, src integer, cible integer, d integer, extra jsonb default '{}'::jsonb)
returns jsonb language plpgsql volatile set search_path to 'public' as $$
declare
  tu jsonb := st -> 'u' -> cible; pv integer := (tu ->> 'pv')::integer; npv integer; cap jsonb := tu -> 'capacite';
  reste integer := d; absorbe integer := 0; sh jsonb; l jsonb; dest integer[]; e integer; d2 integer;
begin
  if (tu ->> 'ko')::boolean then return st; end if;
  if not (extra ? 'dot') then
    select s into sh from jsonb_array_elements(tu -> 'statuts') s where s ->> 'k' = 'bouclier' limit 1;
    if sh is not null and (sh ->> 'v')::numeric > 0 then
      absorbe := least(reste, (sh ->> 'v')::integer);
      reste := reste - absorbe;
      select coalesce(jsonb_agg(case when s ->> 'k' = 'bouclier' then jsonb_set(s, '{v}', to_jsonb((s ->> 'v')::numeric - absorbe)) else s end), '[]'::jsonb)
        into l from jsonb_array_elements(tu -> 'statuts') s
       where not (s ->> 'k' = 'bouclier' and (s ->> 'v')::numeric - absorbe <= 0);
      st := jsonb_set(st, array['u', cible::text, 'statuts'], l);
      st := public.combat_push(st, jsonb_build_object('t', 'statuts', 'c', cible, 's', l));
    end if;
  end if;
  if reste >= pv and cap ->> 'code' = 'survivant' and not (tu ->> 'surv')::boolean then
    reste := pv - 1;
    st := jsonb_set(st, array['u', cible::text, 'surv'], 'true'::jsonb);
    st := public.combat_push(st, jsonb_build_object('t', 'passif', 'u', cible, 'code', 'survivant'));
  end if;
  npv := greatest(0, pv - reste);
  st := jsonb_set(st, array['u', cible::text, 'pv'], to_jsonb(npv));
  st := jsonb_set(st, array['u', cible::text, 'stats', 'sub'], to_jsonb(coalesce((tu -> 'stats' ->> 'sub')::integer, 0) + reste));
  if src <> cible and src between 0 and 3 then
    st := jsonb_set(st, array['u', src::text, 'stats', 'deg'], to_jsonb(coalesce((st -> 'u' -> src -> 'stats' ->> 'deg')::integer, 0) + reste));
  end if;
  st := public.combat_push(st, jsonb_build_object('t', 'degats', 'u', src, 'c', cible, 'd', reste, 'a', absorbe, 'pv', npv, 'ko', npv = 0) || extra);
  if npv = 0 then
    st := jsonb_set(st, array['u', cible::text, 'ko'], 'true'::jsonb);
    st := jsonb_set(st, array['u', cible::text, 'statuts'], '[]'::jsonb);
    st := jsonb_set(st, array['u', cible::text, 'jauge'], '0'::jsonb);
    if src <> cible and src between 0 and 3 then
      st := jsonb_set(st, array['u', src::text, 'stats', 'ko'], to_jsonb(coalesce((st -> 'u' -> src -> 'stats' ->> 'ko')::integer, 0) + 1));
    end if;
    st := public.combat_push(st, jsonb_build_object('t', 'ko', 'c', cible));
    if cap ->> 'code' = 'dernier_souffle' then
      select array_agg(k) into dest from generate_series(0, jsonb_array_length(st -> 'u') - 1) k
       where ((st -> 'u' -> k) ->> 'camp') <> (tu ->> 'camp') and not ((st -> 'u' -> k) ->> 'ko')::boolean;
      if dest is not null then
        e := dest[1 + floor(random() * array_length(dest, 1))::integer];
        d2 := greatest(1, round((tu ->> 'pv_max')::numeric * (cap ->> 'valeur')::numeric / 100));
        st := public.combat_push(st, jsonb_build_object('t', 'passif', 'u', cible, 'code', 'dernier_souffle', 'c', e));
        st := public.combat_blesser(st, cible, e, d2, jsonb_build_object('indirect', true));
      end if;
    end if;
  end if;
  return st;
end $$;

-- Soigne une unité (en PV), sans dépasser son maximum.
create or replace function public.combat_soigner(st jsonb, src integer, tgt integer, v integer) returns jsonb
language plpgsql volatile set search_path to 'public' as $$
declare tu jsonb := st -> 'u' -> tgt; pv integer := (tu ->> 'pv')::integer; mx integer := (tu ->> 'pv_max')::integer; g integer;
begin
  if (tu ->> 'ko')::boolean then return st; end if;
  g := least(mx - pv, greatest(0, v));
  if g <= 0 then return st; end if;
  st := jsonb_set(st, array['u', tgt::text, 'pv'], to_jsonb(pv + g));
  if src between 0 and 3 then
    st := jsonb_set(st, array['u', src::text, 'stats', 'soins'], to_jsonb(coalesce((st -> 'u' -> src -> 'stats' ->> 'soins')::integer, 0) + g));
  end if;
  return public.combat_push(st, jsonb_build_object('t', 'soin', 'u', src, 'c', tgt, 'v', g, 'pv', pv + g));
end $$;

-- Les unités visées par une technique : ennemi (le provocateur s'il y en a un), ennemis, allie (soi compris), allies, soi.
create or replace function public.combat_cibles(st jsonb, i integer, ct text, c integer) returns integer[]
language plpgsql volatile set search_path to 'public' as $$
declare camp text := (st -> 'u' -> i) ->> 'camp'; ennemis integer[]; allies integer[]; prov integer;
begin
  select coalesce(array_agg(k order by k), '{}') into ennemis from generate_series(0, jsonb_array_length(st -> 'u') - 1) k
   where ((st -> 'u' -> k) ->> 'camp') <> camp and not ((st -> 'u' -> k) ->> 'ko')::boolean;
  select coalesce(array_agg(k order by k), '{}') into allies from generate_series(0, jsonb_array_length(st -> 'u') - 1) k
   where ((st -> 'u' -> k) ->> 'camp') = camp and not ((st -> 'u' -> k) ->> 'ko')::boolean;
  if ct = 'ennemi' then
    if array_length(ennemis, 1) is null then return '{}'; end if;
    select k into prov from unnest(ennemis) k where public.combat_a(st -> 'u' -> k, 'provoc') limit 1;
    if prov is not null then return array[prov]; end if;
    if c is not null and c = any (ennemis) then return array[c]; end if;
    return array[ennemis[1]];
  elsif ct = 'ennemis' then return ennemis;
  elsif ct = 'allie' then
    if c is not null and c = any (allies) then return array[c]; end if;
    return array[i];
  elsif ct = 'allies' then return allies;
  end if;
  return array[i];
end $$;

-- Applique un effet de technique (k, v, d) à une unité.
create or replace function public.combat_effet(st jsonb, src integer, tgt integer, ef jsonb) returns jsonb
language plpgsql volatile set search_path to 'public' as $$
declare
  tu jsonb := st -> 'u' -> tgt; k text := ef ->> 'k'; v numeric := coalesce((ef ->> 'v')::numeric, 0); d integer := coalesce((ef ->> 'd')::integer, 2);
  l jsonb; nj numeric;
begin
  if (tu ->> 'ko')::boolean then return st; end if;
  if k = 'soin' then
    return public.combat_soigner(st, src, tgt, round((tu ->> 'pv_max')::numeric * v / 100)::integer);
  elsif k = 'bouclier' then
    return public.combat_poser(st, tgt, 'bouclier', round((tu ->> 'pv_max')::numeric * v / 100), d, tgt = src);
  elsif k in ('pui+', 'def+', 'vit+', 'pui-', 'def-', 'vit-', 'brulure', 'poison', 'regen', 'marque') then
    return public.combat_poser(st, tgt, k, v, d, tgt = src);
  elsif k in ('etourdi', 'gel', 'provoc') then
    return public.combat_poser(st, tgt, k, 0, d, tgt = src);
  elsif k = 'purif' then
    select coalesce(jsonb_agg(s), '[]'::jsonb) into l from jsonb_array_elements(tu -> 'statuts') s where not public.combat_neg(s ->> 'k');
    if jsonb_array_length(l) = jsonb_array_length(tu -> 'statuts') then return st; end if;
    st := jsonb_set(st, array['u', tgt::text, 'statuts'], l);
    st := public.combat_push(st, jsonb_build_object('t', 'purif', 'c', tgt));
    return public.combat_push(st, jsonb_build_object('t', 'statuts', 'c', tgt, 's', l));
  elsif k in ('jauge+', 'jauge-') then
    nj := greatest(0, least(100, (tu ->> 'jauge')::numeric + case when k = 'jauge+' then v else -v end));
    st := jsonb_set(st, array['u', tgt::text, 'jauge'], to_jsonb(nj));
    return public.combat_push(st, jsonb_build_object('t', 'jauge', 'c', tgt, 'j', nj, 'v', case when k = 'jauge+' then v else -v end));
  end if;
  return st;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------
-- Une action : la technique t de l'unité i sur la cible c
-- ---------------------------------------------------------------------------------------------------------------------------

create or replace function public.combat_executer(st jsonb, i integer, t integer, c integer) returns jsonb
language plpgsql volatile set search_path to 'public' as $$
declare
  me jsonb := st -> 'u' -> i; tech jsonb := me -> 'techs' -> t; ct text := tech ->> 'cible'; cibles integer[]; tg integer; tu jsonb;
  pu integer := coalesce((tech ->> 'puissance')::integer, 0); nh integer := coalesce((tech ->> 'hits')::integer, 1);
  cap text := me -> 'capacite' ->> 'code'; capv numeric := coalesce((me -> 'capacite' ->> 'valeur')::numeric, 0);
  ouv numeric := 1; spread numeric := 1; aff numeric; stab numeric; crit boolean; d integer; h integer; pv0 integer; infli integer; dealt integer;
  une_touche boolean := false; ef jsonb; k text; sur text; tgts integer[]; x integer; cd jsonb; mm numeric; df numeric; camp text := me ->> 'camp';
begin
  if (me ->> 'ko')::boolean or tech is null then return st; end if;
  cibles := public.combat_cibles(st, i, ct, c);
  if array_length(cibles, 1) is null then return st; end if;
  cd := jsonb_set(me -> 'cd', array[t::text], to_jsonb(coalesce((tech ->> 'recharge')::integer, 0)));
  st := jsonb_set(st, array['u', i::text, 'jauge'], '0'::jsonb);
  st := jsonb_set(st, array['u', i::text, 'cd'], cd);
  st := public.combat_push(st, jsonb_build_object('t', 'tech', 'u', i, 'n', t, 'nom', tech ->> 'nom', 'type', tech ->> 'type', 'couleur', tech ->> 'couleur',
                                                  'cible', ct, 'c', to_jsonb(cibles), 'cd', cd));
  if pu > 0 and cap = 'ouverture' and not (me ->> 'ouv')::boolean then
    ouv := 1 + capv / 100;
    st := jsonb_set(st, array['u', i::text, 'ouv'], 'true'::jsonb);
    st := public.combat_push(st, jsonb_build_object('t', 'passif', 'u', i, 'code', 'ouverture'));
  end if;
  if ct = 'ennemis' and array_length(cibles, 1) > 1 then spread := 0.8; end if;

  foreach tg in array cibles loop
    if ((st -> 'u' -> i) ->> 'ko')::boolean then exit; end if;
    tu := st -> 'u' -> tg;
    if (tu ->> 'ko')::boolean then continue; end if;
    dealt := 0;
    if pu > 0 then
      if not (cap = 'concentration' or random() * 100 < coalesce((tech ->> 'justesse')::numeric, 100)) then
        st := public.combat_push(st, jsonb_build_object('t', 'rate', 'u', i, 'c', tg));
        continue;
      end if;
      une_touche := true;
      aff := public.combat_aff(tech ->> 'type', tu ->> 'type');
      stab := case when tech ->> 'type' is not null and tech ->> 'type' = me ->> 'type' then 1.2 else 1 end;
      for h in 1..nh loop
        tu := st -> 'u' -> tg;
        exit when (tu ->> 'ko')::boolean or ((st -> 'u' -> i) ->> 'ko')::boolean;
        crit := random() < 0.08;
        -- usure : au-delà de 40 actions, chaque coup frappe 4 % plus fort que le précédent (les combats ne s'éternisent pas)
        mm := 1 + public.combat_sv(tu, 'marque') / 100 + case when public.combat_a(tu, 'gel') then 0.2 else 0 end
              + greatest(0, coalesce((st ->> 'n')::integer, 0) - 40) * 0.04;
        df := public.combat_stat(tu, 'def') * (1 - coalesce((tech ->> 'perce')::numeric, 0) / 100);
        d := greatest(1, round(pu * public.combat_stat(st -> 'u' -> i, 'pui') / greatest(df, 1) * 0.36 * aff * stab
                               * case when crit then 1.5 else 1 end * spread * ouv * mm * (0.9 + random() * 0.1)));
        pv0 := (tu ->> 'pv')::integer;
        st := public.combat_blesser(st, i, tg, d, jsonb_build_object('m', aff, 'crit', crit, 'stab', stab > 1, 'h', h));
        infli := pv0 - ((st -> 'u' -> tg ->> 'pv')::integer);
        dealt := dealt + infli;
        if infli > 0 and (st -> 'u' -> tg -> 'capacite' ->> 'code') = 'epines' and not ((st -> 'u' -> i) ->> 'ko')::boolean then
          st := public.combat_push(st, jsonb_build_object('t', 'passif', 'u', tg, 'code', 'epines', 'c', i));
          st := public.combat_blesser(st, tg, i, greatest(1, round(infli * (st -> 'u' -> tg -> 'capacite' ->> 'valeur')::numeric / 100)::integer),
                                      jsonb_build_object('indirect', true));
        end if;
      end loop;
    end if;
    for ef in select value from jsonb_array_elements(tech -> 'effets') loop
      k := ef ->> 'k'; sur := coalesce(ef ->> 'sur', 'cible');
      if sur <> 'cible' then continue; end if;
      if ((st -> 'u' -> i) ->> 'ko')::boolean then exit; end if;
      if ((st -> 'u' -> tg) ->> 'ko')::boolean and k not in ('vampirisme', 'recul') then continue; end if;
      if random() * 100 >= coalesce((ef ->> 'chance')::numeric, 100) then continue; end if;
      if k = 'vampirisme' then
        if dealt > 0 then st := public.combat_soigner(st, i, i, greatest(1, round(dealt * coalesce((ef ->> 'v')::numeric, 0) / 100)::integer)); end if;
      elsif k = 'recul' then
        if dealt > 0 then
          st := public.combat_blesser(st, i, i, greatest(1, round(dealt * coalesce((ef ->> 'v')::numeric, 0) / 100)::integer),
                                      jsonb_build_object('recul', true, 'indirect', true));
        end if;
      else
        st := public.combat_effet(st, i, tg, ef);
      end if;
    end loop;
  end loop;

  -- les effets sur soi, sur le duo ou sur tous les adversaires, une seule fois
  if (pu = 0 or une_touche) and not ((st -> 'u' -> i) ->> 'ko')::boolean then
    for ef in select value from jsonb_array_elements(tech -> 'effets') loop
      sur := coalesce(ef ->> 'sur', 'cible');
      if sur = 'cible' then continue; end if;
      if random() * 100 >= coalesce((ef ->> 'chance')::numeric, 100) then continue; end if;
      if sur = 'soi' then tgts := array[i];
      elsif sur = 'allies' then
        select coalesce(array_agg(kk order by kk), '{}') into tgts from generate_series(0, jsonb_array_length(st -> 'u') - 1) kk
         where ((st -> 'u' -> kk) ->> 'camp') = camp and not ((st -> 'u' -> kk) ->> 'ko')::boolean;
      else
        select coalesce(array_agg(kk order by kk), '{}') into tgts from generate_series(0, jsonb_array_length(st -> 'u') - 1) kk
         where ((st -> 'u' -> kk) ->> 'camp') <> camp and not ((st -> 'u' -> kk) ->> 'ko')::boolean;
      end if;
      foreach x in array tgts loop
        st := public.combat_effet(st, i, x, ef);
      end loop;
    end loop;
  end if;
  return st;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------
-- Début et fin du tour d'une unité
-- ---------------------------------------------------------------------------------------------------------------------------

-- L'ordre prévisible des prochains tours (sans tenir compte des statuts à venir) : les indices des n prochaines unités à jouer.
create or replace function public.combat_ordre(p_u jsonb, p_n integer) returns integer[]
language plpgsql stable set search_path to 'public' as $$
declare
  n integer := jsonb_array_length(p_u); j numeric[] := '{}'; v numeric[] := '{}'; ok boolean[] := '{}'; k integer; s integer;
  res integer[] := '{}'; bdt numeric; bk integer; dt numeric;
begin
  for k in 0..n - 1 loop
    j := j || (p_u -> k ->> 'jauge')::numeric;
    v := v || public.combat_stat(p_u -> k, 'vit');
    ok := ok || (not (p_u -> k ->> 'ko')::boolean);
  end loop;
  for s in 1..p_n loop
    bdt := 1e9; bk := -1;
    for k in 0..n - 1 loop
      if not ok[k + 1] then continue; end if;
      dt := greatest(0, (100 - j[k + 1]) / v[k + 1]);
      if dt < bdt - 1e-9 or (abs(dt - bdt) <= 1e-9 and v[k + 1] > v[bk + 1]) then bdt := dt; bk := k; end if;
    end loop;
    exit when bk < 0;
    for k in 0..n - 1 loop
      if ok[k + 1] then j[k + 1] := least(100, j[k + 1] + bdt * v[k + 1]); end if;
    end loop;
    j[bk + 1] := 0;
    res := res || bk;
  end loop;
  return res;
end $$;

-- Fait avancer les jauges jusqu'à la prochaine unité prête. Pose st.qui (l'indice de l'unité).
create or replace function public.combat_prochain(st jsonb) returns jsonb
language plpgsql volatile set search_path to 'public' as $$
declare n integer := jsonb_array_length(st -> 'u'); k integer; u jsonb; v numeric; dt numeric; bdt numeric := 1e9; bk integer := -1; bv numeric := 0; nj numeric;
begin
  for k in 0..n - 1 loop
    u := st -> 'u' -> k;
    if (u ->> 'ko')::boolean then continue; end if;
    v := public.combat_stat(u, 'vit');
    dt := greatest(0, (100 - (u ->> 'jauge')::numeric) / v);
    if dt < bdt - 1e-9 or (abs(dt - bdt) <= 1e-9 and v > bv) then bdt := dt; bk := k; bv := v; end if;
  end loop;
  if bk < 0 then return st; end if;
  for k in 0..n - 1 loop
    u := st -> 'u' -> k;
    if (u ->> 'ko')::boolean then continue; end if;
    nj := least(100, (u ->> 'jauge')::numeric + bdt * public.combat_stat(u, 'vit'));
    st := jsonb_set(st, array['u', k::text, 'jauge'], to_jsonb(round(nj, 2)));
  end loop;
  st := jsonb_set(st, array['u', bk::text, 'jauge'], '100'::jsonb);
  return jsonb_set(st, '{qui}', to_jsonb(bk));
end $$;

-- Début du tour : recharges, brûlure et poison, soins sur la durée, étourdissement ou gel. Pose st.saute si l'unité ne joue pas.
create or replace function public.combat_debut_tour(st jsonb, i integer) returns jsonb
language plpgsql volatile set search_path to 'public' as $$
declare u jsonb := st -> 'u' -> i; cd jsonb; s jsonb; l jsonb; sk text; saute boolean := false; cap jsonb := u -> 'capacite'; jaug jsonb;
begin
  select coalesce(jsonb_agg(greatest(0, x::integer - 1) order by o), '[]'::jsonb) into cd from jsonb_array_elements_text(u -> 'cd') with ordinality as t (x, o);
  st := jsonb_set(st, array['u', i::text, 'cd'], cd);
  select jsonb_agg(round((x ->> 'jauge')::numeric, 1) order by o) into jaug from jsonb_array_elements(st -> 'u') with ordinality as t (x, o);
  st := public.combat_push(st, jsonb_build_object('t', 'debut', 'u', i, 'cd', cd, 'jauges', jaug, 'ordre', to_jsonb(public.combat_ordre(st -> 'u', 8))));

  for s in select value from jsonb_array_elements(u -> 'statuts') loop
    if s ->> 'k' in ('brulure', 'poison') then
      st := public.combat_blesser(st, i, i, greatest(1, round((u ->> 'pv_max')::numeric * (s ->> 'v')::numeric / 100)::integer),
                                  jsonb_build_object('dot', s ->> 'k', 'indirect', true));
      if ((st -> 'u' -> i) ->> 'ko')::boolean then saute := true; exit; end if;
    end if;
  end loop;
  if not saute then
    for s in select value from jsonb_array_elements(u -> 'statuts') loop
      if s ->> 'k' = 'regen' then
        st := public.combat_soigner(st, i, i, round((u ->> 'pv_max')::numeric * (s ->> 'v')::numeric / 100)::integer);
      end if;
    end loop;
    if cap ->> 'code' = 'regeneration' then
      st := public.combat_push(st, jsonb_build_object('t', 'passif', 'u', i, 'code', 'regeneration'));
      st := public.combat_soigner(st, i, i, round((u ->> 'pv_max')::numeric * (cap ->> 'valeur')::numeric / 100)::integer);
    end if;
    u := st -> 'u' -> i;
    sk := case when public.combat_a(u, 'etourdi') then 'etourdi' when public.combat_a(u, 'gel') then 'gel' end;
    if sk is not null then
      select coalesce(jsonb_agg(x), '[]'::jsonb) into l from jsonb_array_elements(u -> 'statuts') x where x ->> 'k' not in ('etourdi', 'gel');
      st := jsonb_set(st, array['u', i::text, 'statuts'], l);
      st := jsonb_set(st, array['u', i::text, 'jauge'], '0'::jsonb);
      st := public.combat_push(st, jsonb_build_object('t', 'saut', 'u', i, 'k', sk));
      st := public.combat_push(st, jsonb_build_object('t', 'statuts', 'c', i, 's', l));
      saute := true;
    end if;
  end if;
  return jsonb_set(st, '{saute}', to_jsonb(saute));
end $$;

-- Fin du tour : les durées baissent (sauf celles posées par l'unité sur elle-même pendant ce tour).
create or replace function public.combat_fin_tour(st jsonb, i integer) returns jsonb
language plpgsql volatile set search_path to 'public' as $$
declare u jsonb := st -> 'u' -> i; l jsonb := '[]'::jsonb; s jsonb; nd integer; chg boolean := false;
begin
  if (u ->> 'ko')::boolean then return st; end if;
  for s in select value from jsonb_array_elements(u -> 'statuts') loop
    if s ? 'z' then
      l := l || (s - 'z'); chg := true;
    else
      nd := (s ->> 'd')::integer - 1;
      chg := true;
      if nd > 0 then l := l || jsonb_set(s, '{d}', to_jsonb(nd));
      else st := public.combat_push(st, jsonb_build_object('t', 'fin_statut', 'c', i, 'k', s ->> 'k')); end if;
    end if;
  end loop;
  if not chg then return st; end if;
  st := jsonb_set(st, array['u', i::text, 'statuts'], l);
  return public.combat_push(st, jsonb_build_object('t', 'statuts', 'c', i, 's', l));
end $$;

-- 0 si le joueur a gagné, 1 si l'adversaire a gagné, null tant que ça dure.
create or replace function public.combat_gagnant(st jsonb) returns integer
language sql immutable set search_path to 'public' as
$$ select case
     when count(*) filter (where (u ->> 'camp') = '0' and not (u ->> 'ko')::boolean) = 0 then 1
     when count(*) filter (where (u ->> 'camp') = '1' and not (u ->> 'ko')::boolean) = 0 then 0
     else null end
   from jsonb_array_elements(st -> 'u') u $$;

-- ---------------------------------------------------------------------------------------------------------------------------
-- L'ordinateur : choix d'une technique et d'une cible (adversaires, mode Auto du joueur)
-- ---------------------------------------------------------------------------------------------------------------------------

create or replace function public.combat_score(st jsonb, i integer, tech jsonb, tg integer) returns numeric
language plpgsql volatile set search_path to 'public' as $$
declare
  me jsonb := st -> 'u' -> i; camp text := me ->> 'camp'; ct text := tech ->> 'cible'; pu integer := coalesce((tech ->> 'puissance')::integer, 0);
  sc numeric := 0; ef jsonb; k text; v numeric; ch numeric; sur text; tgts integer[]; grp integer[]; x integer; tu jsonb; e numeric; lack numeric; pos boolean;
  allies integer[]; ennemis integer[]; fort integer;
begin
  select coalesce(array_agg(kk order by kk), '{}') into allies from generate_series(0, jsonb_array_length(st -> 'u') - 1) kk
   where ((st -> 'u' -> kk) ->> 'camp') = camp and not ((st -> 'u' -> kk) ->> 'ko')::boolean;
  select coalesce(array_agg(kk order by kk), '{}') into ennemis from generate_series(0, jsonb_array_length(st -> 'u') - 1) kk
   where ((st -> 'u' -> kk) ->> 'camp') <> camp and not ((st -> 'u' -> kk) ->> 'ko')::boolean;
  grp := case ct when 'ennemis' then ennemis when 'allies' then allies when 'soi' then array[i] else array[tg] end;
  select kk into fort from unnest(ennemis) kk order by (st -> 'u' -> kk ->> 'pui')::numeric desc limit 1;

  if pu > 0 then
    foreach x in array grp loop
      tu := st -> 'u' -> x;
      e := pu * coalesce((tech ->> 'hits')::integer, 1) * public.combat_stat(me, 'pui')
           / greatest(public.combat_stat(tu, 'def') * (1 - coalesce((tech ->> 'perce')::numeric, 0) / 100), 1) * 0.36
           * public.combat_aff(tech ->> 'type', tu ->> 'type') * case when tech ->> 'type' = me ->> 'type' then 1.2 else 1 end
           * coalesce((tech ->> 'justesse')::numeric, 100) / 100 * case when ct = 'ennemis' and array_length(grp, 1) > 1 then 0.8 else 1 end
           * (1 + public.combat_sv(tu, 'marque') / 100);
      sc := sc + e + (1 - (tu ->> 'pv')::numeric / greatest((tu ->> 'pv_max')::numeric, 1)) * 8;
      if e >= (tu ->> 'pv')::numeric then sc := sc + 30; end if;
    end loop;
  end if;

  for ef in select value from jsonb_array_elements(tech -> 'effets') loop
    k := ef ->> 'k'; v := coalesce((ef ->> 'v')::numeric, 0); ch := coalesce((ef ->> 'chance')::numeric, 100) / 100; sur := coalesce(ef ->> 'sur', 'cible');
    if k in ('vampirisme', 'recul') then
      sc := sc + case when k = 'vampirisme' then 3 else -3 end;
      continue;
    end if;
    tgts := case sur when 'soi' then array[i] when 'allies' then allies when 'ennemis' then ennemis else grp end;
    pos := k in ('soin', 'bouclier', 'pui+', 'def+', 'vit+', 'regen', 'provoc', 'purif', 'jauge+');
    foreach x in array tgts loop
      tu := st -> 'u' -> x;
      if ((tu ->> 'camp') = camp) <> pos then continue; end if;
      lack := 1 - (tu ->> 'pv')::numeric / greatest((tu ->> 'pv_max')::numeric, 1);
      if k = 'soin' then sc := sc + case when lack > 0.25 then 85 * lack * v / 35 else -4 end;
      elsif k = 'regen' then sc := sc + case when lack > 0.2 then 40 * lack else -3 end;
      elsif k = 'bouclier' then sc := sc + case when public.combat_a(tu, 'bouclier') then -5 else 12 + 20 * lack end;
      elsif k in ('pui+', 'vit+', 'def+') then sc := sc + ch * case when public.combat_a(tu, k) then -6 else 15 + v / 5 end;
      elsif k in ('pui-', 'def-', 'vit-') then sc := sc + ch * case when public.combat_a(tu, k) then 0 else 8 + v / 6 end;
      elsif k in ('etourdi', 'gel') then
        sc := sc + ch * case when public.combat_a(tu, 'etourdi') or public.combat_a(tu, 'gel') then 0 else 24 + case when x = fort then 10 else 0 end end;
      elsif k in ('brulure', 'poison') then sc := sc + ch * case when public.combat_a(tu, k) then 0 else 10 + v end;
      elsif k = 'marque' then sc := sc + ch * case when public.combat_a(tu, 'marque') then 0 else 13 end;
      elsif k = 'provoc' then sc := sc + case when (me ->> 'pv')::numeric > (me ->> 'pv_max')::numeric * 0.5 then 9 else -4 end;
      elsif k = 'purif' then
        sc := sc + 14 * (select count(*) from jsonb_array_elements(tu -> 'statuts') s where public.combat_neg(s ->> 'k'));
      elsif k = 'jauge+' then sc := sc + ch * v / 100 * case when x <> i then 30 else 6 end;
      elsif k = 'jauge-' then sc := sc + ch * v / 100 * 14;
      end if;
    end loop;
  end loop;
  return sc * (0.8 + random() * 0.4);
end $$;

-- Le choix de l'ordinateur pour l'unité i : {t: technique, c: cible}.
create or replace function public.combat_ia(st jsonb, i integer) returns jsonb
language plpgsql volatile set search_path to 'public' as $$
declare
  me jsonb := st -> 'u' -> i; camp text := me ->> 'camp'; t integer; tech jsonb; ct text; cands integer[]; x integer; sc numeric;
  best numeric := -1e9; bt integer := 0; bc integer := null; prov integer;
begin
  for t in 0..2 loop
    tech := me -> 'techs' -> t;
    if tech is null or coalesce((me -> 'cd' ->> t)::integer, 0) > 0 then continue; end if;
    ct := tech ->> 'cible';
    if ct = 'ennemi' then
      cands := array(select kk from generate_series(0, jsonb_array_length(st -> 'u') - 1) kk
                      where ((st -> 'u' -> kk) ->> 'camp') <> camp and not ((st -> 'u' -> kk) ->> 'ko')::boolean order by kk);
      select kk into prov from unnest(cands) kk where public.combat_a(st -> 'u' -> kk, 'provoc') limit 1;
      if prov is not null then cands := array[prov]; end if;
    elsif ct = 'allie' then
      cands := array(select kk from generate_series(0, jsonb_array_length(st -> 'u') - 1) kk
                      where ((st -> 'u' -> kk) ->> 'camp') = camp and not ((st -> 'u' -> kk) ->> 'ko')::boolean order by kk);
    else
      cands := array[null::integer];
    end if;
    foreach x in array cands loop
      sc := public.combat_score(st, i, tech, x);
      if sc > best then best := sc; bt := t; bc := x; end if;
    end loop;
  end loop;
  return jsonb_build_object('t', bt, 'c', bc);
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------
-- La boucle : déroule le combat jusqu'à la prochaine décision du joueur (ou la fin).
-- p_jeu : {n: actions jouées, actif: unité du joueur qui attend son ordre ou null, auto: bool}. p_action : {t, c} ou {passer: true}.
-- ---------------------------------------------------------------------------------------------------------------------------

create or replace function public.combat_derouler(p_unites jsonb, p_jeu jsonb, p_action jsonb, p_max integer default 12) returns jsonb
language plpgsql volatile set search_path to 'public' as $$
declare
  st jsonb := jsonb_build_object('u', p_unites, 'ev', '[]'::jsonb, 'n', coalesce((p_jeu ->> 'n')::integer, 0)); jeu jsonb := p_jeu; auto boolean := coalesce((p_jeu ->> 'auto')::boolean, false);
  n integer := coalesce((p_jeu ->> 'n')::integer, 0); actif integer := nullif(p_jeu ->> 'actif', '')::integer; act jsonb := p_action;
  nb integer := 0; g integer; cont boolean := false; t integer; c integer; s0 numeric; s1 numeric; me jsonb;
begin
  g := public.combat_gagnant(st);
  while g is null loop
    if actif is null then
      st := public.combat_prochain(st);
      actif := (st ->> 'qui')::integer;
      st := public.combat_debut_tour(st, actif);
      if (st ->> 'saute')::boolean then
        st := public.combat_fin_tour(st, actif);
        n := n + 1; actif := null;
        g := public.combat_gagnant(st);
        if g is null and n >= 120 then exit; end if;
        continue;
      end if;
      if ((st -> 'u' -> actif) ->> 'camp') = '0' and not auto then
        exit;
      end if;
      act := null;
    elsif act is null and not auto and ((st -> 'u' -> actif) ->> 'camp') = '0' then
      exit;
    end if;

    me := st -> 'u' -> actif;
    if act is not null and act ? 'passer' then
      st := jsonb_set(st, array['u', actif::text, 'jauge'], '0'::jsonb);
      st := public.combat_push(st, jsonb_build_object('t', 'passe', 'u', actif));
    else
      if act is null then act := public.combat_ia(st, actif); end if;
      if (act ->> 't') !~ '^[0-2]$' then raise exception 'Technique inconnue.'; end if;
      t := (act ->> 't')::integer;
      if me -> 'techs' -> t is null then raise exception 'Technique inconnue.'; end if;
      if coalesce((me -> 'cd' ->> t)::integer, 0) > 0 then raise exception 'Cette technique n''est pas encore prête.'; end if;
      c := case when (act ->> 'c') ~ '^[0-3]$' then (act ->> 'c')::integer else null end;
      st := jsonb_set(st, '{n}', to_jsonb(n));
      st := public.combat_executer(st, actif, t, c);
    end if;
    st := public.combat_fin_tour(st, actif);
    n := n + 1; nb := nb + 1; actif := null; act := null;
    g := public.combat_gagnant(st);
    if g is null and n >= 120 then exit; end if;
    if g is null and nb >= p_max then cont := true; exit; end if;
  end loop;

  if g is null and n >= 120 then
    select sum((u ->> 'pv')::numeric) filter (where (u ->> 'camp') = '0') / sum((u ->> 'pv_max')::numeric) filter (where (u ->> 'camp') = '0'),
           sum((u ->> 'pv')::numeric) filter (where (u ->> 'camp') = '1') / sum((u ->> 'pv_max')::numeric) filter (where (u ->> 'camp') = '1')
      into s0, s1 from jsonb_array_elements(st -> 'u') u;
    g := case when s0 > s1 then 0 else 1 end;
    st := public.combat_push(st, jsonb_build_object('t', 'limite'));
  end if;

  jeu := jeu || jsonb_build_object('n', n, 'actif', actif, 'auto', auto);
  return jsonb_build_object('u', st -> 'u', 'jeu', jeu, 'ev', st -> 'ev', 'fini', g is not null, 'vainqueur', g, 'continuer', cont,
                            'ordre', to_jsonb(public.combat_ordre(st -> 'u', 8)));
end $$;

revoke all on function public.combat_push(jsonb, jsonb), public.combat_neg(text), public.combat_sv(jsonb, text), public.combat_a(jsonb, text),
  public.combat_stat(jsonb, text), public.combat_aff(text, text), public.combat_type_de(uuid), public.combat_role_de(uuid, text),
  public.combat_technique_json(text, text), public.combat_identite(uuid, integer, boolean, boolean), public.combat_unite(uuid, integer, boolean, integer),
  public.combat_assembler(jsonb, jsonb), public.combat_poser(jsonb, integer, text, numeric, integer, boolean),
  public.combat_blesser(jsonb, integer, integer, integer, jsonb), public.combat_soigner(jsonb, integer, integer, integer),
  public.combat_cibles(jsonb, integer, text, integer), public.combat_effet(jsonb, integer, integer, jsonb),
  public.combat_executer(jsonb, integer, integer, integer), public.combat_ordre(jsonb, integer), public.combat_prochain(jsonb),
  public.combat_debut_tour(jsonb, integer), public.combat_fin_tour(jsonb, integer), public.combat_gagnant(jsonb),
  public.combat_score(jsonb, integer, jsonb, integer), public.combat_ia(jsonb, integer), public.combat_derouler(jsonb, jsonb, jsonb, integer)
  from public, anon, authenticated;
