-- Wave Cards : chaque type a une icône (choisie dans la console) et tous les joueurs peuvent lire le tableau des forces / faiblesses
-- (le visuel qui s'ouvre en touchant un type). Sans danger si on le repasse.

alter table public.combat_types add column if not exists icone text;
update public.combat_types set icone = case id
    when 'feu' then 'flamme' when 'eau' then 'goutte' when 'plante' then 'feuille' when 'electrik' then 'eclair'
    when 'gel' then 'flocon' when 'tenebres' then 'lune' when 'lumiere' then 'soleil' when 'terre' then 'montagne'
    when 'vent' then 'vent' when 'poison' then 'fiole' when 'acier' then 'hexagone' when 'psy' then 'oeil'
    else 'etoile' end
 where icone is null;

-- Le tableau (types + efficacités), lisible par tout joueur connecté : ce n'est pas un secret, on le voit en combat.
create or replace function public.combat_types_tableau() returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if auth.uid() is null then raise exception 'Connecte-toi.'; end if;
  return jsonb_build_object(
    'types', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'nom', t.nom, 'couleur', t.couleur, 'icone', coalesce(t.icone, 'etoile'), 'citation', t.citation) order by t.ordre), '[]'::jsonb) from public.combat_types t),
    'affinites', (select coalesce(jsonb_agg(jsonb_build_object('att', a.att, 'def', a.def, 'mult', a.mult)), '[]'::jsonb) from public.combat_affinites a));
end $$;
revoke all on function public.combat_types_tableau() from public, anon;
grant execute on function public.combat_types_tableau() to authenticated;

-- La console : l'icône se règle avec le nom et la couleur
create or replace function public.combat_equipe_type_sauver(p jsonb) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_id text := p ->> 'id'; v_icone text := nullif(btrim(coalesce(p ->> 'icone', '')), '');
begin
  perform public.combat_equipe_garde();
  if not exists (select 1 from public.combat_types where id = v_id) then raise exception 'Type inconnu.'; end if;
  if coalesce(btrim(p ->> 'nom'), '') = '' then raise exception 'Donne un nom au type.'; end if;
  if coalesce(p ->> 'couleur', '') !~ '^#[0-9a-fA-F]{6}$' then raise exception 'Couleur : au format #RRGGBB.'; end if;
  if v_icone is not null and v_icone not in ('flamme','goutte','feuille','eclair','flocon','lune','soleil','montagne','vent','fiole','hexagone','oeil','etoile','note','nuage','coeur') then
    raise exception 'Icône inconnue.';
  end if;
  update public.combat_types set nom = btrim(p ->> 'nom'), couleur = p ->> 'couleur', citation = coalesce(nullif(btrim(p ->> 'citation'), ''), citation),
         icone = coalesce(v_icone, icone) where id = v_id;
  return (select to_jsonb(t) from public.combat_types t where t.id = v_id);
end $$;

create or replace function public.combat_equipe_type_creer(p jsonb) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_nom text := btrim(coalesce(p ->> 'nom', '')); v_id text; v_ordre integer; v_icone text := coalesce(nullif(btrim(coalesce(p ->> 'icone', '')), ''), 'etoile');
begin
  perform public.combat_equipe_garde();
  if v_nom = '' then raise exception 'Donne un nom au type.'; end if;
  if coalesce(p ->> 'couleur', '') !~ '^#[0-9a-fA-F]{6}$' then raise exception 'Couleur : au format #RRGGBB.'; end if;
  if v_icone not in ('flamme','goutte','feuille','eclair','flocon','lune','soleil','montagne','vent','fiole','hexagone','oeil','etoile','note','nuage','coeur') then raise exception 'Icône inconnue.'; end if;
  v_id := left(regexp_replace(lower(translate(v_nom, 'àâäéèêëîïôöùûüçÀÂÄÉÈÊËÎÏÔÖÙÛÜÇ', 'aaaeeeeiioouuucaaaeeeeiioouuuc')), '[^a-z0-9]+', '', 'g'), 19);
  if v_id !~ '^[a-z][a-z0-9]{1,18}$' then raise exception 'Le nom doit commencer par une lettre (2 caractères au minimum).'; end if;
  if exists (select 1 from public.combat_types where id = v_id) then raise exception 'Ce type existe déjà.'; end if;
  select coalesce(max(ordre), 0) + 1 into v_ordre from public.combat_types;
  insert into public.combat_types (id, nom, couleur, ordre, citation, icone)
  values (v_id, v_nom, p ->> 'couleur', v_ordre, coalesce(nullif(btrim(p ->> 'citation'), ''), 'Un nouveau type à découvrir.'), v_icone);
  return (select to_jsonb(t) from public.combat_types t where t.id = v_id);
end $$;
