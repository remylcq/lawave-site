-- Wave Cards : le combat 2v2 — la console de l'équipe (2026-10-27).
-- Tout est réservé à l'équipe (est_equipe()). Réglages : types et affinités, catalogue d'attaques et de capacités,
-- surcharges par artiste (type, stats de base, attaques, capacité, citation), crews de l'Arène, simulation d'un combat.

create or replace function public.combat_equipe_garde() returns void
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not public.est_equipe() then raise exception 'Réservé à l''équipe.'; end if;
end $$;

create or replace function public.combat_equipe_catalogue() returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
begin
  perform public.combat_equipe_garde();
  return jsonb_build_object(
    'types', (select jsonb_agg(to_jsonb(t) order by t.ordre) from public.combat_types t),
    'affinites', (select coalesce(jsonb_agg(jsonb_build_object('att', a.att, 'def', a.def, 'mult', a.mult) order by a.att, a.def), '[]'::jsonb) from public.combat_affinites a),
    'attaques', (select jsonb_agg(to_jsonb(a) order by a.type nulls last, a.role, a.id) from public.combat_attaques a),
    'capacites', (select jsonb_agg(to_jsonb(c) order by c.id) from public.combat_capacites c),
    'arene', (select jsonb_agg(jsonb_build_object('palier', a.palier, 'nom', a.nom, 'description', a.description, 'bonus', a.bonus, 'recompense', a.recompense,
                'rarete1', a.rarete1, 'rarete2', a.rarete2, 'artiste1', c1.nom, 'artiste2', c2.nom) order by a.palier)
                from public.combat_arene a join public.jeu_cartes c1 on c1.artist_id = a.artist1 join public.jeu_cartes c2 on c2.artist_id = a.artist2));
end $$;

-- Une carte vue par l'équipe : les boosters où elle figure, ce qu'elle vaut au combat (avec et sans surcharge).
create or replace function public.combat_equipe_carte(p_artist uuid) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare v_r integer; v_c public.jeu_cartes;
begin
  perform public.combat_equipe_garde();
  select * into v_c from public.jeu_cartes where artist_id = p_artist;
  if not found then raise exception 'Artiste inconnu.'; end if;
  select max(rarete) into v_r from public.jeu_booster_cartes where artist_id = p_artist;
  v_r := coalesce(v_r, 3);
  return jsonb_build_object(
    'artist_id', p_artist, 'nom', v_c.nom, 'photo', v_c.photo, 'fans', v_c.fans, 'rarete_ref', v_r,
    'boosters', coalesce((select jsonb_agg(jsonb_build_object('booster', bc.booster_id, 'nom', bo.nom, 'rarete', bc.rarete) order by bo.ordre)
                            from public.jeu_booster_cartes bc join public.jeu_boosters bo on bo.id = bc.booster_id where bc.artist_id = p_artist), '[]'::jsonb),
    'effectif', public.combat_identite(p_artist, v_r, false),
    'defaut', public.combat_identite(p_artist, v_r, false, true) - 'surcharge');
end $$;

-- Les artistes des classeurs, avec leur identité de combat effective (recherche par nom).
create or replace function public.combat_equipe_cartes(p_q text default null) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare v_q text := nullif(public.norme_artiste(p_q), '');
begin
  perform public.combat_equipe_garde();
  return coalesce((
    select jsonb_agg(public.combat_equipe_carte(s.artist_id) order by s.fans desc)
      from (select distinct c.artist_id, c.fans from public.jeu_booster_cartes bc join public.jeu_cartes c on c.artist_id = bc.artist_id and c.active
             where v_q is null or public.norme_artiste(c.nom) like '%' || v_q || '%') s), '[]'::jsonb);
end $$;

-- Règle une carte : seuls les champs présents dans p_champs changent ; une valeur nulle ou vide remet le défaut.
create or replace function public.combat_equipe_regler_carte(p_artist uuid, p_champs jsonb) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare k text; v text;
begin
  perform public.combat_equipe_garde();
  if not exists (select 1 from public.jeu_cartes where artist_id = p_artist) then raise exception 'Artiste inconnu.'; end if;
  if p_champs is null or jsonb_typeof(p_champs) <> 'object' then raise exception 'Réglages invalides.'; end if;
  for k in select jsonb_object_keys(p_champs) loop
    v := nullif(btrim(p_champs ->> k), '');
    if k not in ('type', 'pv', 'pui', 'def', 'vit', 'atk1', 'atk2', 'capacite', 'citation') then raise exception 'Réglage inconnu : %.', k; end if;
    if v is null then continue; end if;
    if k = 'type' and not exists (select 1 from public.combat_types where id = v) then raise exception 'Type inconnu.'; end if;
    if k in ('atk1', 'atk2') and not exists (select 1 from public.combat_attaques where id = v) then raise exception 'Attaque inconnue.'; end if;
    if k = 'capacite' and not exists (select 1 from public.combat_capacites where id = v) then raise exception 'Capacité inconnue.'; end if;
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
    pv = case when p_champs ? 'pv' then nullif(btrim(p_champs ->> 'pv'), '')::integer else pv end,
    pui = case when p_champs ? 'pui' then nullif(btrim(p_champs ->> 'pui'), '')::integer else pui end,
    def = case when p_champs ? 'def' then nullif(btrim(p_champs ->> 'def'), '')::integer else def end,
    vit = case when p_champs ? 'vit' then nullif(btrim(p_champs ->> 'vit'), '')::integer else vit end,
    atk1 = case when p_champs ? 'atk1' then nullif(btrim(p_champs ->> 'atk1'), '') else atk1 end,
    atk2 = case when p_champs ? 'atk2' then nullif(btrim(p_champs ->> 'atk2'), '') else atk2 end,
    capacite = case when p_champs ? 'capacite' then nullif(btrim(p_champs ->> 'capacite'), '') else capacite end,
    citation = case when p_champs ? 'citation' then nullif(btrim(p_champs ->> 'citation'), '') else citation end,
    maj_le = now()
  where artist_id = p_artist;
  delete from public.combat_surcharges
   where artist_id = p_artist and type is null and pv is null and pui is null and def is null and vit is null
     and atk1 is null and atk2 is null and capacite is null and citation is null;
  return public.combat_equipe_carte(p_artist);
end $$;

create or replace function public.combat_equipe_attaque_sauver(p jsonb) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_id text := lower(btrim(p ->> 'id')); v_type text := nullif(btrim(p ->> 'type'), ''); v_effet text := nullif(btrim(p ->> 'effet'), '');
begin
  perform public.combat_equipe_garde();
  if v_id is null or v_id !~ '^[a-z0-9-]{2,40}$' then raise exception 'Identifiant : lettres minuscules, chiffres et tirets (2 à 40).'; end if;
  if coalesce(btrim(p ->> 'nom'), '') = '' then raise exception 'Donne un nom à l''attaque.'; end if;
  if v_type is not null and not exists (select 1 from public.combat_types where id = v_type) then raise exception 'Type inconnu.'; end if;
  if coalesce(p ->> 'role', '') not in ('base', 'forte', 'soutien', 'neutre') then raise exception 'Rôle inconnu.'; end if;
  if coalesce(p ->> 'cible', '') not in ('ennemi', 'ennemis', 'allie', 'soi', 'equipe') then raise exception 'Cible inconnue.'; end if;
  if v_effet is not null and v_effet not in ('soin', 'pui+', 'def+', 'vit+', 'pui-', 'def-', 'vit-', 'etourdi', 'poison', 'vampirisme', 'recul') then raise exception 'Effet inconnu.'; end if;
  if coalesce((p ->> 'puissance')::integer, 0) not between 0 and 200 then raise exception 'Puissance : entre 0 et 200.'; end if;
  if coalesce((p ->> 'justesse')::integer, 100) not between 1 and 100 then raise exception 'Justesse : entre 1 et 100.'; end if;
  if coalesce((p ->> 'valeur')::integer, 0) not between 0 and 100 then raise exception 'Valeur : entre 0 et 100.'; end if;
  if coalesce((p ->> 'chance')::integer, 100) not between 0 and 100 then raise exception 'Chance : entre 0 et 100.'; end if;
  insert into public.combat_attaques (id, nom, type, role, puissance, justesse, effet, valeur, chance, cible, description, actif)
  values (v_id, btrim(p ->> 'nom'), v_type, p ->> 'role', coalesce((p ->> 'puissance')::integer, 0), coalesce((p ->> 'justesse')::integer, 100), v_effet,
          coalesce((p ->> 'valeur')::integer, 0), coalesce((p ->> 'chance')::integer, 100), p ->> 'cible', coalesce(btrim(p ->> 'description'), ''), coalesce((p ->> 'actif')::boolean, true))
  on conflict (id) do update set nom = excluded.nom, type = excluded.type, role = excluded.role, puissance = excluded.puissance, justesse = excluded.justesse,
    effet = excluded.effet, valeur = excluded.valeur, chance = excluded.chance, cible = excluded.cible, description = excluded.description, actif = excluded.actif;
  return (select to_jsonb(a) from public.combat_attaques a where a.id = v_id);
end $$;

create or replace function public.combat_equipe_capacite_sauver(p jsonb) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_id text := lower(btrim(p ->> 'id'));
begin
  perform public.combat_equipe_garde();
  if v_id is null or v_id !~ '^[a-z0-9-]{2,40}$' then raise exception 'Identifiant : lettres minuscules, chiffres et tirets (2 à 40).'; end if;
  if coalesce(btrim(p ->> 'nom'), '') = '' then raise exception 'Donne un nom à la capacité.'; end if;
  if coalesce(p ->> 'code', '') not in ('regeneration', 'epines', 'sang_froid', 'ouverture', 'dernier_souffle', 'survivant', 'aura', 'concentration') then raise exception 'Effet de capacité inconnu.'; end if;
  if coalesce((p ->> 'valeur')::integer, 0) not between 0 and 100 then raise exception 'Valeur : entre 0 et 100.'; end if;
  insert into public.combat_capacites (id, nom, code, valeur, description)
  values (v_id, btrim(p ->> 'nom'), p ->> 'code', coalesce((p ->> 'valeur')::integer, 0), coalesce(btrim(p ->> 'description'), ''))
  on conflict (id) do update set nom = excluded.nom, code = excluded.code, valeur = excluded.valeur, description = excluded.description;
  return (select to_jsonb(c) from public.combat_capacites c where c.id = v_id);
end $$;

create or replace function public.combat_equipe_type_sauver(p jsonb) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_id text := p ->> 'id';
begin
  perform public.combat_equipe_garde();
  if not exists (select 1 from public.combat_types where id = v_id) then raise exception 'Type inconnu.'; end if;
  if coalesce(btrim(p ->> 'nom'), '') = '' then raise exception 'Donne un nom au type.'; end if;
  if coalesce(p ->> 'couleur', '') !~ '^#[0-9a-fA-F]{6}$' then raise exception 'Couleur : au format #RRGGBB.'; end if;
  update public.combat_types set nom = btrim(p ->> 'nom'), couleur = p ->> 'couleur', citation = coalesce(nullif(btrim(p ->> 'citation'), ''), citation) where id = v_id;
  return (select to_jsonb(t) from public.combat_types t where t.id = v_id);
end $$;

-- Règle une affinité (att attaque def) : un multiplicateur de 1 la remet neutre.
create or replace function public.combat_equipe_affinite(p_att text, p_def text, p_mult numeric) returns void
language plpgsql security definer set search_path to 'public' as $$
begin
  perform public.combat_equipe_garde();
  if not exists (select 1 from public.combat_types where id = p_att) or not exists (select 1 from public.combat_types where id = p_def) then raise exception 'Type inconnu.'; end if;
  if p_mult is null or p_mult <= 0 or p_mult > 3 then raise exception 'Multiplicateur : entre 0,1 et 3.'; end if;
  if p_mult = 1 then
    delete from public.combat_affinites where att = p_att and def = p_def;
  else
    insert into public.combat_affinites (att, def, mult) values (p_att, p_def, p_mult)
    on conflict (att, def) do update set mult = excluded.mult;
  end if;
end $$;

create or replace function public.combat_equipe_arene_sauver(p jsonb) returns void
language plpgsql security definer set search_path to 'public' as $$
begin
  perform public.combat_equipe_garde();
  if not exists (select 1 from public.combat_arene where palier = (p ->> 'palier')::integer) then raise exception 'Palier inconnu.'; end if;
  if coalesce((p ->> 'bonus')::integer, 0) not between 0 and 100 then raise exception 'Bonus : entre 0 et 100 %%.'; end if;
  if coalesce((p ->> 'recompense')::integer, 0) not between 0 and 50 then raise exception 'Récompense : entre 0 et 50 vinyles.'; end if;
  if coalesce(btrim(p ->> 'nom'), '') = '' then raise exception 'Donne un nom au crew.'; end if;
  update public.combat_arene set nom = btrim(p ->> 'nom'), description = coalesce(btrim(p ->> 'description'), description),
         bonus = (p ->> 'bonus')::integer, recompense = (p ->> 'recompense')::integer
   where palier = (p ->> 'palier')::integer;
end $$;

-- Un combat de test entre deux duos (chacun : [{artist, rarete, holo, bonus}]), joué entièrement par l'ordinateur.
create or replace function public.combat_equipe_simuler(p_a jsonb, p_b jsonb) returns jsonb
language plpgsql volatile security definer set search_path to 'public' as $$
declare v_a jsonb := '[]'::jsonb; v_b jsonb := '[]'::jsonb; d jsonb; u jsonb; r jsonb; t integer := 1; v_tours jsonb := '[]'::jsonb; v_depart jsonb;
begin
  perform public.combat_equipe_garde();
  if jsonb_typeof(p_a) <> 'array' or jsonb_array_length(p_a) <> 2 or jsonb_typeof(p_b) <> 'array' or jsonb_array_length(p_b) <> 2 then raise exception 'Chaque camp a besoin de 2 cartes.'; end if;
  for d in select value from jsonb_array_elements(p_a) loop
    v_a := v_a || public.combat_unite((d ->> 'artist')::uuid, least(greatest(coalesce((d ->> 'rarete')::integer, 3), 1), 5), coalesce((d ->> 'holo')::boolean, false), coalesce((d ->> 'bonus')::integer, 0));
  end loop;
  for d in select value from jsonb_array_elements(p_b) loop
    v_b := v_b || public.combat_unite((d ->> 'artist')::uuid, least(greatest(coalesce((d ->> 'rarete')::integer, 3), 1), 5), coalesce((d ->> 'holo')::boolean, false), coalesce((d ->> 'bonus')::integer, 0));
  end loop;
  u := public.combat_assembler(v_a, v_b);
  v_depart := u;
  loop
    r := public.combat_moteur(u, null, t);
    v_tours := v_tours || jsonb_build_array(jsonb_build_object('tour', t, 'ev', r -> 'ev'));
    u := r -> 'u';
    exit when (r ->> 'fini')::boolean or t >= 25;
    t := (r ->> 'tour')::integer;
  end loop;
  return jsonb_build_object('depart', v_depart, 'tours', v_tours, 'unites', u, 'vainqueur', r -> 'vainqueur');
end $$;

revoke all on function public.combat_equipe_garde(), public.combat_equipe_catalogue(), public.combat_equipe_carte(uuid), public.combat_equipe_cartes(text),
  public.combat_equipe_regler_carte(uuid, jsonb), public.combat_equipe_attaque_sauver(jsonb), public.combat_equipe_capacite_sauver(jsonb),
  public.combat_equipe_type_sauver(jsonb), public.combat_equipe_affinite(text, text, numeric), public.combat_equipe_arene_sauver(jsonb),
  public.combat_equipe_simuler(jsonb, jsonb) from public, anon;
grant execute on function public.combat_equipe_catalogue(), public.combat_equipe_carte(uuid), public.combat_equipe_cartes(text),
  public.combat_equipe_regler_carte(uuid, jsonb), public.combat_equipe_attaque_sauver(jsonb), public.combat_equipe_capacite_sauver(jsonb),
  public.combat_equipe_type_sauver(jsonb), public.combat_equipe_affinite(text, text, numeric), public.combat_equipe_arene_sauver(jsonb),
  public.combat_equipe_simuler(jsonb, jsonb) to authenticated;

-- La garde est interne : appelée seulement par les fonctions ci-dessus.
revoke all on function public.combat_equipe_garde() from authenticated;
