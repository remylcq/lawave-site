-- Wave Cards : le combat 2v2 — le moteur (2026-10-27).
-- Fonctions INTERNES (aucun droit pour les joueurs : seules les fonctions de sql/combat-jeu.sql les appellent).
-- Un combat = 4 « unités » (indices 0-1 : le joueur, 2-3 : l'adversaire) décrites en JSON. Un tour : chaque unité en vie
-- choisit une attaque et une cible, puis tout se résout par ordre de Vitesse. Aucune confiance au client : hasard et calculs ici.
--
-- Dégâts = puissance × Puissance / Défense × 0,36 × affinité × 1,2 (même type) × critique (6 %, ×1,5) × 0,88..1.
-- Niveaux de stats (Puissance / Défense / Vitesse) : -3..+3, 25 % par niveau. Limite : 20 tours, puis le plus de PV restants gagne.

create or replace function public.combat_mult_stage(p integer) returns numeric
language sql immutable set search_path to 'public' as
$$ select greatest(0.25, 1 + 0.25 * greatest(-3, least(3, coalesce(p, 0)))) $$;

create or replace function public.combat_stat(u jsonb, champ text) returns numeric
language sql immutable set search_path to 'public' as
$$ select (u ->> champ)::numeric * public.combat_mult_stage(((u -> 'mods') ->> champ)::integer) $$;

create or replace function public.combat_aff(p_att text, p_def text) returns numeric
language sql stable set search_path to 'public' as
$$ select coalesce((select mult from public.combat_affinites where att = p_att and def = p_def), 1) $$;

-- Le type d'un artiste : la surcharge de l'équipe, sinon un type tiré de l'identifiant (toujours le même).
create or replace function public.combat_type_de(p_artist uuid) returns text
language sql stable set search_path to 'public' as
$$ select coalesce(
     (select s.type from public.combat_surcharges s where s.artist_id = p_artist and s.type is not null),
     (select (array_agg(t.id order by t.ordre))[1 + abs(hashtext(p_artist::text)) % count(*)] from public.combat_types t)) $$;

-- L'identité de combat d'une carte : type, stats, attaques, capacité, citation, faiblesses, résistances.
-- p_sans : ignore les surcharges (pour montrer ce que serait la valeur par défaut).
create or replace function public.combat_identite(p_artist uuid, p_rarete integer, p_holo boolean, p_sans boolean default false)
returns jsonb language plpgsql stable set search_path to 'public' as $$
declare
  c public.jeu_cartes; s public.combat_surcharges; ty public.combat_types; v_t text;
  n numeric; m numeric; hm numeric; h numeric; v_pv integer; v_pui integer; v_def integer; v_vit integer;
  ids text[]; a1 text; a2 text; cp text; j1 jsonb; j2 jsonb; jc jsonb; faibles text[]; resiste text[];
begin
  select * into c from public.jeu_cartes where artist_id = p_artist;
  if not found then raise exception 'Carte inconnue.'; end if;
  if not p_sans then select * into s from public.combat_surcharges where artist_id = p_artist; end if;

  v_t := coalesce(s.type, (select (array_agg(t.id order by t.ordre))[1 + abs(hashtext(p_artist::text)) % count(*)] from public.combat_types t));
  select * into ty from public.combat_types where id = v_t;

  n := greatest(0, least(1, (log(greatest(c.fans, 1000)::numeric) - 5.5) / 1.6));
  m := case when p_rarete <= 1 then 1 when p_rarete = 2 then 1.08 when p_rarete = 3 then 1.18 when p_rarete = 4 then 1.3 else 1.45 end;
  hm := case when p_holo then 1.06 else 1 end;
  h := (abs(hashtext(p_artist::text || 'vit')) % 1000) / 1000.0;
  v_pv  := round(coalesce(s.pv,  round(80 + 50 * n)) * m * hm);
  v_pui := round(coalesce(s.pui, round(45 + 25 * n)) * m * hm);
  v_def := round(coalesce(s.def, round(40 + 25 * n)) * m * hm);
  v_vit := round(coalesce(s.vit, round(45 + 50 * h)) * hm);

  a1 := s.atk1;
  if a1 is null then
    ids := array(select id from public.combat_attaques where actif and type = v_t and role = 'base' order by id);
    if array_length(ids, 1) is null then ids := array(select id from public.combat_attaques where actif and type is null order by id); end if;
    a1 := ids[1 + abs(hashtext(p_artist::text || 'a1')) % array_length(ids, 1)];
  end if;
  a2 := s.atk2;
  if a2 is null then
    ids := array(select id from public.combat_attaques
                  where actif and id <> a1 and ((p_rarete <= 2 and type is null and role = 'neutre')
                     or (p_rarete = 3 and type = v_t and role = 'soutien') or (p_rarete >= 4 and type = v_t and role = 'forte'))
                  order by id);
    if array_length(ids, 1) is null then ids := array(select id from public.combat_attaques where actif and id <> a1 order by id); end if;
    a2 := ids[1 + abs(hashtext(p_artist::text || 'a2')) % array_length(ids, 1)];
  end if;
  select jsonb_build_object('id', id, 'nom', nom, 'type', type, 'role', role, 'puissance', puissance, 'justesse', justesse,
           'effet', effet, 'valeur', valeur, 'chance', chance, 'cible', cible, 'description', description)
    into j1 from public.combat_attaques where id = a1;
  select jsonb_build_object('id', id, 'nom', nom, 'type', type, 'role', role, 'puissance', puissance, 'justesse', justesse,
           'effet', effet, 'valeur', valeur, 'chance', chance, 'cible', cible, 'description', description)
    into j2 from public.combat_attaques where id = a2;

  cp := s.capacite;
  if cp is null then
    ids := array(select id from public.combat_capacites order by id);
    cp := ids[1 + abs(hashtext(p_artist::text || 'cap')) % array_length(ids, 1)];
  end if;
  select jsonb_build_object('id', id, 'nom', nom, 'code', code, 'valeur', valeur, 'description', description)
    into jc from public.combat_capacites where id = cp;

  faibles := array(select att from public.combat_affinites where def = v_t and mult > 1 order by att);
  resiste := array(select att from public.combat_affinites where def = v_t and mult < 1 order by att);

  return jsonb_build_object(
    'artist_id', p_artist, 'nom', c.nom, 'photo', c.photo, 'rarete', p_rarete, 'holo', p_holo,
    'type', v_t, 'type_nom', ty.nom, 'couleur', ty.couleur, 'citation', coalesce(s.citation, ty.citation),
    'pv', v_pv, 'pui', v_pui, 'def', v_def, 'vit', v_vit,
    'attaques', jsonb_build_array(j1, j2), 'capacite', jc,
    'faiblesses', to_jsonb(faibles), 'resistances', to_jsonb(resiste),
    'surcharge', case when s.artist_id is null then null else jsonb_strip_nulls(to_jsonb(s) - 'artist_id' - 'maj_le') end);
end $$;

-- Une unité prête à combattre (p_bonus : bonus de stats en %, pour les crews de l'Arène).
create or replace function public.combat_unite(p_artist uuid, p_rarete integer, p_holo boolean, p_bonus integer default 0)
returns jsonb language plpgsql stable set search_path to 'public' as $$
declare i jsonb := public.combat_identite(p_artist, p_rarete, p_holo); k numeric := 1 + coalesce(p_bonus, 0) / 100.0;
begin
  return jsonb_build_object(
    'artist_id', p_artist, 'nom', i ->> 'nom', 'photo', i ->> 'photo', 'rarete', p_rarete, 'holo', p_holo,
    'type', i ->> 'type', 'type_nom', i ->> 'type_nom', 'couleur', i ->> 'couleur',
    'pv', round((i ->> 'pv')::numeric * k), 'pv_max', round((i ->> 'pv')::numeric * k),
    'pui', round((i ->> 'pui')::numeric * k), 'def', round((i ->> 'def')::numeric * k), 'vit', round((i ->> 'vit')::numeric * k),
    'mods', jsonb_build_object('pui', 0, 'def', 0, 'vit', 0), 'statut', jsonb_build_object('etourdi', 0, 'poison', 0, 'poison_pct', 0),
    'attaques', i -> 'attaques', 'capacite', i -> 'capacite', 'ko', false, 'ouv', false, 'surv', false);
end $$;

-- Les quatre unités d'un combat : p_a (le joueur) aux indices 0-1, p_b aux indices 2-3 ; l'aura de star est posée ici.
create or replace function public.combat_assembler(p_a jsonb, p_b jsonb) returns jsonb
language plpgsql stable set search_path to 'public' as $$
declare r jsonb := '[]'::jsonb; u jsonb; k integer; camp integer; src jsonb; aura numeric;
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
      r := r || u;
    end loop;
  end loop;
  return r;
end $$;

create or replace function public.combat_cibles(st jsonb, i integer, ct text, c integer) returns integer[]
language plpgsql volatile set search_path to 'public' as $$
declare camp integer := ((st -> 'u' -> i) ->> 'camp')::integer; ennemis integer[]; allies integer[];
begin
  select coalesce(array_agg(k order by k), '{}') into ennemis from generate_series(0, jsonb_array_length(st -> 'u') - 1) k
   where ((st -> 'u' -> k) ->> 'camp')::integer <> camp and not ((st -> 'u' -> k) ->> 'ko')::boolean;
  select coalesce(array_agg(k order by k), '{}') into allies from generate_series(0, jsonb_array_length(st -> 'u') - 1) k
   where ((st -> 'u' -> k) ->> 'camp')::integer = camp and not ((st -> 'u' -> k) ->> 'ko')::boolean;
  if ct = 'ennemi' then
    if c is not null and c = any (ennemis) then return array[c]; end if;
    if array_length(ennemis, 1) is null then return '{}'; end if;
    return array[ennemis[1 + floor(random() * array_length(ennemis, 1))::integer]];
  elsif ct = 'ennemis' then return ennemis;
  elsif ct = 'allie' then
    if c is not null and c = any (allies) then return array[c]; end if;
    return array[i];
  elsif ct = 'soi' then return array[i];
  end if;
  return allies;
end $$;

-- Retire des PV (survivant, mise à terre, dernier couplet) et note l'événement.
create or replace function public.combat_blesser(st jsonb, src integer, cible integer, d integer, extra jsonb default '{}'::jsonb)
returns jsonb language plpgsql volatile set search_path to 'public' as $$
declare
  tu jsonb := st -> 'u' -> cible; pv integer := (tu ->> 'pv')::integer; npv integer; cap jsonb := tu -> 'capacite';
  dd integer := d; dest integer[]; e integer; d2 integer;
begin
  if (tu ->> 'ko')::boolean then return st; end if;
  if dd >= pv and cap ->> 'code' = 'survivant' and not (tu ->> 'surv')::boolean then
    dd := pv - 1;
    st := jsonb_set(st, array['u', cible::text, 'surv'], 'true'::jsonb);
    st := jsonb_set(st, '{ev}', (st -> 'ev') || jsonb_build_object('t', 'capacite', 'u', cible, 'code', 'survivant'));
  end if;
  npv := greatest(0, pv - dd);
  st := jsonb_set(st, array['u', cible::text, 'pv'], to_jsonb(npv));
  if npv = 0 then st := jsonb_set(st, array['u', cible::text, 'ko'], 'true'::jsonb); end if;
  st := jsonb_set(st, '{ev}', (st -> 'ev') || (jsonb_build_object('t', 'degats', 'u', src, 'c', cible, 'd', dd, 'pv', npv, 'ko', npv = 0) || extra));
  if npv = 0 and cap ->> 'code' = 'dernier_souffle' then
    select array_agg(k) into dest from generate_series(0, jsonb_array_length(st -> 'u') - 1) k
     where ((st -> 'u' -> k) ->> 'camp') <> (tu ->> 'camp') and not ((st -> 'u' -> k) ->> 'ko')::boolean;
    if dest is not null then
      e := dest[1 + floor(random() * array_length(dest, 1))::integer];
      d2 := greatest(1, round((tu ->> 'pv_max')::numeric * (cap ->> 'valeur')::numeric / 100));
      st := jsonb_set(st, '{ev}', (st -> 'ev') || jsonb_build_object('t', 'capacite', 'u', cible, 'code', 'dernier_souffle', 'c', e));
      st := public.combat_blesser(st, cible, e, d2, jsonb_build_object('indirect', true));
    end if;
  end if;
  return st;
end $$;

-- Soigne une unité (en PV), sans dépasser son maximum.
create or replace function public.combat_soigner(st jsonb, tgt integer, v integer) returns jsonb
language plpgsql volatile set search_path to 'public' as $$
declare tu jsonb := st -> 'u' -> tgt; pv integer := (tu ->> 'pv')::integer; mx integer := (tu ->> 'pv_max')::integer; g integer;
begin
  if (tu ->> 'ko')::boolean then return st; end if;
  g := least(mx - pv, greatest(0, v));
  if g <= 0 then return st; end if;
  st := jsonb_set(st, array['u', tgt::text, 'pv'], to_jsonb(pv + g));
  return jsonb_set(st, '{ev}', (st -> 'ev') || jsonb_build_object('t', 'soin', 'u', tgt, 'v', g, 'pv', pv + g));
end $$;

-- Applique l'effet d'une attaque à une unité : soin, hausse ou baisse de stat, étourdissement, poison.
create or replace function public.combat_effet(st jsonb, tgt integer, effet text, valeur integer) returns jsonb
language plpgsql volatile set search_path to 'public' as $$
declare tu jsonb := st -> 'u' -> tgt; froid boolean := tu -> 'capacite' ->> 'code' = 'sang_froid'; stat text; niv integer; nv integer;
begin
  if (tu ->> 'ko')::boolean then return st; end if;
  if effet = 'soin' then
    return public.combat_soigner(st, tgt, round((tu ->> 'pv_max')::numeric * valeur / 100.0)::integer);
  elsif effet in ('pui+', 'def+', 'vit+') then
    stat := left(effet, 3);
    niv := ((tu -> 'mods') ->> stat)::integer;
    nv := least(3, niv + greatest(valeur, 1));
    if nv = niv then return jsonb_set(st, '{ev}', (st -> 'ev') || jsonb_build_object('t', 'stat_max', 'u', tgt, 's', stat)); end if;
    st := jsonb_set(st, array['u', tgt::text, 'mods', stat], to_jsonb(nv));
    return jsonb_set(st, '{ev}', (st -> 'ev') || jsonb_build_object('t', 'stat', 'u', tgt, 's', stat, 'v', nv - niv, 'n', nv));
  elsif effet in ('pui-', 'def-', 'vit-') then
    if froid then return jsonb_set(st, '{ev}', (st -> 'ev') || jsonb_build_object('t', 'immunise', 'u', tgt)); end if;
    stat := left(effet, 3);
    niv := ((tu -> 'mods') ->> stat)::integer;
    nv := greatest(-3, niv - greatest(valeur, 1));
    if nv = niv then return jsonb_set(st, '{ev}', (st -> 'ev') || jsonb_build_object('t', 'stat_max', 'u', tgt, 's', stat)); end if;
    st := jsonb_set(st, array['u', tgt::text, 'mods', stat], to_jsonb(nv));
    return jsonb_set(st, '{ev}', (st -> 'ev') || jsonb_build_object('t', 'stat', 'u', tgt, 's', stat, 'v', nv - niv, 'n', nv));
  elsif effet = 'etourdi' then
    if froid then return jsonb_set(st, '{ev}', (st -> 'ev') || jsonb_build_object('t', 'immunise', 'u', tgt)); end if;
    st := jsonb_set(st, array['u', tgt::text, 'statut', 'etourdi'], '1'::jsonb);
    return jsonb_set(st, '{ev}', (st -> 'ev') || jsonb_build_object('t', 'statut', 'u', tgt, 's', 'etourdi'));
  elsif effet = 'poison' then
    if froid then return jsonb_set(st, '{ev}', (st -> 'ev') || jsonb_build_object('t', 'immunise', 'u', tgt)); end if;
    if ((tu -> 'statut') ->> 'poison')::integer > 0 then return st; end if;
    st := jsonb_set(st, array['u', tgt::text, 'statut', 'poison'], '3'::jsonb);
    st := jsonb_set(st, array['u', tgt::text, 'statut', 'poison_pct'], to_jsonb(greatest(valeur, 1)));
    return jsonb_set(st, '{ev}', (st -> 'ev') || jsonb_build_object('t', 'statut', 'u', tgt, 's', 'poison'));
  end if;
  return st;
end $$;

-- L'action d'une unité : l'attaque a (0 ou 1) sur la cible c.
create or replace function public.combat_agir(st jsonb, i integer, a integer, c integer) returns jsonb
language plpgsql volatile set search_path to 'public' as $$
declare
  me jsonb := st -> 'u' -> i; att jsonb := (st -> 'u' -> i -> 'attaques') -> a; ct text := att ->> 'cible';
  cibles integer[]; t integer; tu jsonb; nb integer; pu integer := coalesce((att ->> 'puissance')::integer, 0); ef text := att ->> 'effet';
  va integer := coalesce((att ->> 'valeur')::integer, 0); ch integer := coalesce((att ->> 'chance')::integer, 100);
  cap text := me -> 'capacite' ->> 'code'; capv numeric := coalesce((me -> 'capacite' ->> 'valeur')::numeric, 0);
  mult numeric; stab numeric; crit boolean; spread numeric; ouv numeric := 1; d integer; pv_avant integer; infli integer; touche boolean;
begin
  if att is null or (me ->> 'ko')::boolean then return st; end if;
  cibles := public.combat_cibles(st, i, ct, c);
  if array_length(cibles, 1) is null then return st; end if;
  nb := array_length(cibles, 1);
  if cap = 'ouverture' and not (me ->> 'ouv')::boolean then ouv := 1 + capv / 100; end if;
  st := jsonb_set(st, '{ev}', (st -> 'ev') || jsonb_build_object('t', 'usage', 'u', i, 'a', att ->> 'nom', 'type', att ->> 'type', 'cible', ct, 'c', to_jsonb(cibles)));

  foreach t in array cibles loop
    if ((st -> 'u' -> i) ->> 'ko')::boolean then exit; end if;
    tu := st -> 'u' -> t;
    if (tu ->> 'ko')::boolean then continue; end if;
    me := st -> 'u' -> i;

    if pu > 0 then
      touche := cap = 'concentration' or random() * 100 < coalesce((att ->> 'justesse')::numeric, 100);
      if not touche then
        st := jsonb_set(st, '{ev}', (st -> 'ev') || jsonb_build_object('t', 'rate', 'u', i, 'c', t));
        continue;
      end if;
      mult := public.combat_aff(att ->> 'type', tu ->> 'type');
      stab := case when att ->> 'type' is not null and att ->> 'type' = me ->> 'type' then 1.2 else 1 end;
      crit := random() < 0.06;
      spread := case when ct = 'ennemis' and nb > 1 then 0.75 else 1 end;
      d := greatest(1, round(pu * public.combat_stat(me, 'pui') / greatest(public.combat_stat(tu, 'def'), 1) * 0.36
                             * mult * stab * case when crit then 1.5 else 1 end * spread * ouv * (0.88 + random() * 0.12)));
      pv_avant := (tu ->> 'pv')::integer;
      st := public.combat_blesser(st, i, t, d, jsonb_build_object('m', mult, 'crit', crit, 'stab', stab > 1));
      infli := pv_avant - ((st -> 'u' -> t ->> 'pv')::integer);

      if infli > 0 then
        if (st -> 'u' -> t -> 'capacite' ->> 'code') = 'epines' and not ((st -> 'u' -> i) ->> 'ko')::boolean then
          st := jsonb_set(st, '{ev}', (st -> 'ev') || jsonb_build_object('t', 'capacite', 'u', t, 'code', 'epines', 'c', i));
          st := public.combat_blesser(st, t, i, greatest(1, round(infli * (st -> 'u' -> t -> 'capacite' ->> 'valeur')::numeric / 100)::integer),
                                      jsonb_build_object('indirect', true));
        end if;
        if ef = 'vampirisme' and not ((st -> 'u' -> i) ->> 'ko')::boolean then
          st := public.combat_soigner(st, i, greatest(1, round(infli * va / 100.0)::integer));
        elsif ef = 'recul' and not ((st -> 'u' -> i) ->> 'ko')::boolean then
          st := public.combat_blesser(st, i, i, greatest(1, round(infli * va / 100.0)::integer), jsonb_build_object('recul', true, 'indirect', true));
        end if;
      end if;
      if ef in ('pui-', 'def-', 'vit-', 'etourdi', 'poison') then
        if not ((st -> 'u' -> t) ->> 'ko')::boolean and random() * 100 < ch then st := public.combat_effet(st, t, ef, va); end if;
      elsif ef in ('pui+', 'def+', 'vit+', 'soin') then
        if not ((st -> 'u' -> i) ->> 'ko')::boolean and random() * 100 < ch then st := public.combat_effet(st, i, ef, va); end if;
      end if;
    else
      if ef is not null and random() * 100 < ch then st := public.combat_effet(st, t, ef, va); end if;
    end if;
  end loop;

  if ouv > 1 then st := jsonb_set(st, array['u', i::text, 'ouv'], 'true'::jsonb); end if;
  return st;
end $$;

-- 0 si le joueur a gagné, 1 si l'adversaire a gagné (ou en cas d'égalité), null tant que ça dure.
create or replace function public.combat_gagnant(st jsonb) returns integer
language sql immutable set search_path to 'public' as
$$ select case
     when count(*) filter (where (u ->> 'camp') = '0' and not (u ->> 'ko')::boolean) = 0 then 1
     when count(*) filter (where (u ->> 'camp') = '1' and not (u ->> 'ko')::boolean) = 0 then 0
     else null end
   from jsonb_array_elements(st -> 'u') u $$;

-- Fin de tour : poison, second souffle, l'étourdissement s'efface.
create or replace function public.combat_fin_tour(st jsonb) returns jsonb
language plpgsql volatile set search_path to 'public' as $$
declare k integer; u jsonb; d integer;
begin
  for k in 0..jsonb_array_length(st -> 'u') - 1 loop
    u := st -> 'u' -> k;
    if (u ->> 'ko')::boolean then continue; end if;
    if ((u -> 'statut') ->> 'poison')::integer > 0 then
      d := greatest(1, round((u ->> 'pv_max')::numeric * ((u -> 'statut') ->> 'poison_pct')::numeric / 100));
      st := jsonb_set(st, array['u', k::text, 'statut', 'poison'], to_jsonb(((u -> 'statut') ->> 'poison')::integer - 1));
      st := public.combat_blesser(st, k, k, d, jsonb_build_object('poison', true, 'indirect', true));
      u := st -> 'u' -> k;
      if (u ->> 'ko')::boolean then continue; end if;
    end if;
    if u -> 'capacite' ->> 'code' = 'regeneration' then
      st := public.combat_soigner(st, k, round((u ->> 'pv_max')::numeric * (u -> 'capacite' ->> 'valeur')::numeric / 100)::integer);
    end if;
    st := jsonb_set(st, array['u', k::text, 'statut', 'etourdi'], '0'::jsonb);
  end loop;
  return st;
end $$;

-- Le choix d'une unité pilotée par l'ordinateur : l'attaque et la cible au meilleur score (avec un peu de hasard).
create or replace function public.combat_ia_unite(st jsonb, i integer) returns jsonb
language plpgsql volatile set search_path to 'public' as $$
declare
  me jsonb := st -> 'u' -> i; camp text := me ->> 'camp'; a integer; att jsonb; ct text; cands integer[]; t integer; tu jsonb;
  sc numeric; e numeric; best numeric := -1e9; ba integer := 0; bc integer := null; ef text; va integer; ch numeric; lack numeric; ne integer; pu integer;
begin
  for a in 0..1 loop
    att := me -> 'attaques' -> a;
    if att is null then continue; end if;
    ct := att ->> 'cible'; ef := att ->> 'effet'; va := coalesce((att ->> 'valeur')::integer, 0); ch := coalesce((att ->> 'chance')::numeric, 100);
    pu := coalesce((att ->> 'puissance')::integer, 0);
    if ct in ('ennemi', 'ennemis') then
      cands := array(select k from generate_series(0, jsonb_array_length(st -> 'u') - 1) k
                      where ((st -> 'u' -> k) ->> 'camp') <> camp and not ((st -> 'u' -> k) ->> 'ko')::boolean order by k);
    elsif ct = 'allie' then
      cands := array(select k from generate_series(0, jsonb_array_length(st -> 'u') - 1) k
                      where ((st -> 'u' -> k) ->> 'camp') = camp and not ((st -> 'u' -> k) ->> 'ko')::boolean order by k);
    else
      cands := array[i];
    end if;
    ne := coalesce(array_length(cands, 1), 0);
    if ne = 0 then continue; end if;
    foreach t in array cands loop
      tu := st -> 'u' -> t;
      sc := 0;
      if pu > 0 then
        e := pu * public.combat_stat(me, 'pui') / greatest(public.combat_stat(tu, 'def'), 1) * 0.36
             * public.combat_aff(att ->> 'type', tu ->> 'type') * case when att ->> 'type' = me ->> 'type' then 1.2 else 1 end
             * coalesce((att ->> 'justesse')::numeric, 100) / 100;
        if ct = 'ennemis' then e := e * 0.75 * ne; end if;
        sc := e;
        if e >= (tu ->> 'pv')::numeric then sc := sc + 25; end if;
      end if;
      if ef = 'soin' then
        lack := 1 - (tu ->> 'pv')::numeric / greatest((tu ->> 'pv_max')::numeric, 1);
        if lack > 0.3 then sc := sc + 70 * lack * va / 30; end if;
      elsif ef in ('pui+', 'def+', 'vit+') then
        if coalesce(((me -> 'mods') ->> left(ef, 3))::integer, 0) < 2 then sc := sc + case when ct = 'equipe' then 22 else 14 end; end if;
      elsif ef in ('pui-', 'def-', 'vit-', 'etourdi', 'poison') then
        sc := sc + 4 + 10 * ch / 100;
      end if;
      sc := sc * (0.75 + random() * 0.5);
      if sc > best then best := sc; ba := a; bc := t; end if;
    end loop;
  end loop;
  return jsonb_build_object('a', ba, 'c', bc);
end $$;

-- Un tour complet. p_actions : [{u, a, c}] pour les unités du joueur (les manquantes sont jouées par l'ordinateur).
create or replace function public.combat_moteur(p_unites jsonb, p_actions jsonb, p_tour integer) returns jsonb
language plpgsql volatile set search_path to 'public' as $$
declare
  st jsonb := jsonb_build_object('u', p_unites, 'ev', '[]'::jsonb); acts jsonb := '{}'::jsonb; k integer; act jsonb; ordre integer[]; i integer;
  g integer; s0 numeric; s1 numeric; n integer := jsonb_array_length(p_unites);
begin
  for k in 0..n - 1 loop
    if (p_unites -> k ->> 'ko')::boolean then continue; end if;
    act := null;
    if (p_unites -> k ->> 'camp') = '0' and p_actions is not null and jsonb_typeof(p_actions) = 'array' then
      select e into act from jsonb_array_elements(p_actions) e
       where jsonb_typeof(e) = 'object' and (e ->> 'u') ~ '^[0-9]+$' and (e ->> 'u')::integer = k and (e ->> 'a') ~ '^[01]$' limit 1;
      if act is not null and (act ->> 'c') is not null and (act ->> 'c') !~ '^[0-9]+$' then act := act - 'c'; end if;
    end if;
    if act is null then act := public.combat_ia_unite(st, k); end if;
    acts := jsonb_set(acts, array[k::text], act);
  end loop;

  select array_agg(x.kk order by public.combat_stat(p_unites -> x.kk, 'vit') + random() * 0.5 desc) into ordre
    from generate_series(0, n - 1) as x (kk) where not (p_unites -> x.kk ->> 'ko')::boolean;

  foreach i in array ordre loop
    if ((st -> 'u' -> i) ->> 'ko')::boolean then continue; end if;
    if (((st -> 'u' -> i) -> 'statut') ->> 'etourdi')::integer > 0 then
      st := jsonb_set(st, '{ev}', (st -> 'ev') || jsonb_build_object('t', 'etourdi', 'u', i));
      st := jsonb_set(st, array['u', i::text, 'statut', 'etourdi'], '0'::jsonb);
      continue;
    end if;
    st := public.combat_agir(st, i, (acts -> i::text ->> 'a')::integer, nullif(acts -> i::text ->> 'c', '')::integer);
    g := public.combat_gagnant(st);
    if g is not null then exit; end if;
  end loop;

  if g is null then
    st := public.combat_fin_tour(st);
    g := public.combat_gagnant(st);
  end if;
  if g is null and p_tour >= 20 then
    select sum((u ->> 'pv')::numeric) filter (where (u ->> 'camp') = '0') / sum((u ->> 'pv_max')::numeric) filter (where (u ->> 'camp') = '0'),
           sum((u ->> 'pv')::numeric) filter (where (u ->> 'camp') = '1') / sum((u ->> 'pv_max')::numeric) filter (where (u ->> 'camp') = '1')
      into s0, s1 from jsonb_array_elements(st -> 'u') u;
    g := case when s0 > s1 then 0 else 1 end;
    st := jsonb_set(st, '{ev}', (st -> 'ev') || jsonb_build_object('t', 'limite'));
  end if;

  return jsonb_build_object('u', st -> 'u', 'ev', st -> 'ev', 'fini', g is not null, 'vainqueur', g,
                            'tour', case when g is null then p_tour + 1 else p_tour end);
end $$;

revoke all on function public.combat_mult_stage(integer), public.combat_stat(jsonb, text), public.combat_aff(text, text),
  public.combat_type_de(uuid), public.combat_identite(uuid, integer, boolean, boolean), public.combat_unite(uuid, integer, boolean, integer),
  public.combat_assembler(jsonb, jsonb), public.combat_cibles(jsonb, integer, text, integer), public.combat_blesser(jsonb, integer, integer, integer, jsonb),
  public.combat_soigner(jsonb, integer, integer), public.combat_effet(jsonb, integer, text, integer), public.combat_agir(jsonb, integer, integer, integer),
  public.combat_gagnant(jsonb), public.combat_fin_tour(jsonb), public.combat_ia_unite(jsonb, integer), public.combat_moteur(jsonb, jsonb, integer)
  from public, anon, authenticated;
