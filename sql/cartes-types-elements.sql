-- Wave Cards, étape 1 : les types ne sont plus des genres musicaux mais des éléments (Feu, Eau, Plante, Électrik, Gel, Ténèbres,
-- Lumière, Terre, Vent, Poison, Acier, Psy). Les 8 anciens types sont renommés en place (leurs champions, techniques et progrès
-- suivent), 4 nouveaux s'ajoutent, le tableau « qui bat qui » est refait (chaque type en bat 3 : ×1,5, et subit ×0,67 en retour),
-- et la console peut créer / supprimer un type. Sans danger si on le repasse : la partie « renommage » ne s'exécute qu'une fois.

-- 1. Les types
do $$
declare
  v_renomme boolean := exists (select 1 from public.combat_types where id = 'drill');
begin
  if v_renomme then
    update public.combat_types set ordre = ordre + 100;
    update public.combat_types t set id = v.nid, nom = v.nom, couleur = v.couleur, ordre = v.ordre, citation = v.citation
      from (values
        ('drill',     'feu',      'Feu',      '#FF5A36', 1, 'Des textes brûlants, une scène en flammes.'),
        ('afro',      'eau',      'Eau',      '#3B9DFF', 2, 'Un flow qui coule de source.'),
        ('conscient', 'plante',   'Plante',   '#3DD68C', 3, 'Des racines profondes, un son qui pousse.'),
        ('boombap',   'electrik', 'Électrik', '#FFD23F', 4, 'Une décharge de basses : toute la salle saute.'),
        ('cloud',     'gel',      'Gel',      '#8FE7FF', 5, 'Froid, précis, tranchant comme la glace.'),
        ('trap',      'tenebres', 'Ténèbres', '#8B6BFF', 6, 'Le son de la nuit, sans lumière ni pitié.'),
        ('rue',       'terre',    'Terre',    '#C98B4B', 8, 'Le sol qui tremble : le son du quartier.'),
        ('pop',       'psy',      'Psy',      '#FF7AB8', 12, 'Il lit dans tes pensées avant le deuxième couplet.')
      ) as v (aid, nid, nom, couleur, ordre, citation)
     where t.id = v.aid;
  end if;

  insert into public.combat_types (id, nom, couleur, ordre, citation) values
    ('lumiere', 'Lumière', '#FFF1A8', 7,  'Un refrain qui éclaire toute la salle.'),
    ('vent',    'Vent',    '#7FE3C4', 9,  'Un souffle libre qui emporte tout sur son passage.'),
    ('poison',  'Poison',  '#B25CE6', 10, 'Des mots qui piquent et qui restent.'),
    ('acier',   'Acier',   '#A9B7C6', 11, 'Solide, sans faille, impossible à plier.')
  on conflict (id) do nothing;

  -- 2. Le tableau « qui bat qui » (uniquement à la première passe, pour ne pas écraser ce que l'équipe règle ensuite)
  if v_renomme then
    delete from public.combat_affinites;
    insert into public.combat_affinites (att, def, mult)
    select a, d, 1.5
      from (values
        ('feu', 'plante'), ('feu', 'gel'), ('feu', 'acier'),
        ('eau', 'feu'), ('eau', 'terre'), ('eau', 'poison'),
        ('plante', 'eau'), ('plante', 'terre'), ('plante', 'electrik'),
        ('electrik', 'eau'), ('electrik', 'vent'), ('electrik', 'acier'),
        ('gel', 'plante'), ('gel', 'terre'), ('gel', 'vent'),
        ('terre', 'feu'), ('terre', 'electrik'), ('terre', 'tenebres'),
        ('vent', 'plante'), ('vent', 'poison'), ('vent', 'psy'),
        ('tenebres', 'psy'), ('tenebres', 'vent'), ('tenebres', 'acier'),
        ('lumiere', 'tenebres'), ('lumiere', 'poison'), ('lumiere', 'gel'),
        ('poison', 'plante'), ('poison', 'psy'), ('poison', 'electrik'),
        ('acier', 'gel'), ('acier', 'lumiere'), ('acier', 'psy'),
        ('psy', 'feu'), ('psy', 'eau'), ('psy', 'lumiere')
      ) as v (a, d);
    insert into public.combat_affinites (att, def, mult)
    select def, att, 0.67 from public.combat_affinites where mult > 1;
  end if;
end $$;

-- 3. Les rôles proposés selon le type (inchangés pour les 8 premiers, 4 nouveaux)
create or replace function public.combat_role_de(p_artist uuid, p_type text) returns text
language sql stable set search_path to 'public' as
$$ select coalesce(
     (select s.role from public.combat_surcharges s where s.artist_id = p_artist and s.role is not null),
     (case p_type
        when 'feu'      then array['lyriciste', 'briseur', 'clasheur']
        when 'tenebres' then array['clasheur', 'hypeman', 'lyriciste']
        when 'electrik' then array['pilier', 'beatmaker', 'lyriciste']
        when 'gel'      then array['beatmaker', 'clasheur', 'hypeman']
        when 'psy'      then array['hypeman', 'beatmaker', 'lyriciste']
        when 'plante'   then array['beatmaker', 'pilier', 'lyriciste']
        when 'terre'    then array['pilier', 'briseur', 'clasheur']
        when 'eau'      then array['hypeman', 'beatmaker', 'briseur']
        when 'lumiere'  then array['hypeman', 'beatmaker', 'lyriciste']
        when 'vent'     then array['hypeman', 'clasheur', 'beatmaker']
        when 'poison'   then array['clasheur', 'briseur', 'lyriciste']
        when 'acier'    then array['pilier', 'briseur', 'beatmaker']
        else array['lyriciste', 'pilier', 'hypeman'] end)[1 + abs(hashtext(p_artist::text || 'role')) % 3]) $$;

-- 4. Les champions : un par type (les 8 premiers gardent leur duo, leurs récompenses et leurs progrès ; 4 nouveaux)
insert into public.combat_champions (id, type, nom, description, artist1, rarete1, artist2, rarete2, bonus, vinyles, wc, decor, ordre)
select t.id, t.id, 'Champion ' || t.nom, 'Le champion du type ' || t.nom || ' : ' || t.citation, s.a1, 4, s.a2, 4, 15, 2, 50,
       case t.id when 'lumiere' then 'concert' when 'vent' then 'toit' when 'poison' then 'ruelle' else 'studio' end,
       case t.id when 'lumiere' then 9 when 'vent' then 10 when 'poison' then 11 else 12 end
  from public.combat_types t
  join lateral (
    select (array_agg(x.artist_id order by x.fans desc, x.artist_id))[1] a1, (array_agg(x.artist_id order by x.fans desc, x.artist_id))[2] a2
      from public.jeu_cartes x where x.active and public.combat_type_de(x.artist_id) = t.id) s on s.a2 is not null
 where t.id in ('lumiere', 'vent', 'poison', 'acier')
on conflict (id) do nothing;
-- (le champion « drill » devient le champion du Feu, etc. : on met à jour les textes, pas les identifiants)
update public.combat_champions c
   set nom = 'Champion ' || t.nom, description = 'Le champion du type ' || t.nom || ' : ' || t.citation
  from public.combat_types t where t.id = c.type;
insert into public.combat_prestige_champions (champion, maledictions)
select c.id, array['fulgurant', 'colosse', 'rythme-infernal', 'second-souffle', 'furie', 'armure-maudite']
  from public.combat_champions c where c.id in ('lumiere', 'vent', 'poison', 'acier')
on conflict (champion) do nothing;
insert into public.cosmetiques (id, type, nom, description, rarete, style, source, ordre)
select 'titre-prestige-' || c.id, 'titre', 'Prestige ' || t.nom, 'Obtenu en venant à bout des 15 niveaux de prestige du champion ' || t.nom || '.', 'epique', '{}'::jsonb, 'succes', 3100 + c.ordre
  from public.combat_champions c join public.combat_types t on t.id = c.type
 where c.id in ('lumiere', 'vent', 'poison', 'acier')
on conflict (id) do nothing;

-- 5. Les textes qui parlaient de « styles »
update public.combat_ligue set description = case rang
    when 1 then 'Le Conseil ouvre ses portes avec le type Feu.'
    when 2 then 'Un flow qui fait trembler les murs : le type Ténèbres.'
    when 3 then 'Des refrains que tout le monde connaît : le type Psy.'
    when 4 then 'Chaque mot compte : le type Plante.'
    else description end
 where rang between 1 and 4 and description ~ '(style|Pop Rap)';
update public.combat_faille_boss
   set description = 'Une brèche s''ouvre : deux légendes que personne n''a jamais abattues. Frappe le plus fort possible.'
 where description like 'Une brèche s''ouvre sur le style%' or description like 'Une brèche s''ouvre sur le type%';

-- 6. La console : créer / supprimer un type
create or replace function public.combat_equipe_type_creer(p jsonb) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_nom text := btrim(coalesce(p ->> 'nom', '')); v_id text; v_ordre integer;
begin
  perform public.combat_equipe_garde();
  if v_nom = '' then raise exception 'Donne un nom au type.'; end if;
  if coalesce(p ->> 'couleur', '') !~ '^#[0-9a-fA-F]{6}$' then raise exception 'Couleur : au format #RRGGBB.'; end if;
  v_id := left(regexp_replace(lower(translate(v_nom, 'àâäéèêëîïôöùûüçÀÂÄÉÈÊËÎÏÔÖÙÛÜÇ', 'aaaeeeeiioouuucaaaeeeeiioouuuc')), '[^a-z0-9]+', '', 'g'), 19);
  if v_id !~ '^[a-z][a-z0-9]{1,18}$' then raise exception 'Le nom doit commencer par une lettre (2 caractères au minimum).'; end if;
  if exists (select 1 from public.combat_types where id = v_id) then raise exception 'Ce type existe déjà.'; end if;
  select coalesce(max(ordre), 0) + 1 into v_ordre from public.combat_types;
  insert into public.combat_types (id, nom, couleur, ordre, citation)
  values (v_id, v_nom, p ->> 'couleur', v_ordre, coalesce(nullif(btrim(p ->> 'citation'), ''), 'Un nouveau type à découvrir.'));
  return (select to_jsonb(t) from public.combat_types t where t.id = v_id);
end $$;

create or replace function public.combat_equipe_type_supprimer(p_id text) returns void
language plpgsql security definer set search_path to 'public' as $$
begin
  perform public.combat_equipe_garde();
  if not exists (select 1 from public.combat_types where id = p_id) then raise exception 'Type inconnu.'; end if;
  if (select count(*) from public.combat_types) <= 3 then raise exception 'Il faut au moins 3 types.'; end if;
  if exists (select 1 from public.combat_champions where type = p_id) then
    raise exception 'Ce type a un champion dans le mode Champions : donne-lui d''abord un autre type.';
  end if;
  delete from public.combat_types where id = p_id;
end $$;

revoke all on function public.combat_equipe_type_creer(jsonb), public.combat_equipe_type_supprimer(text) from public, anon;
grant execute on function public.combat_equipe_type_creer(jsonb), public.combat_equipe_type_supprimer(text) to authenticated;
