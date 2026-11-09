-- Wave Cards : UN SEUL PACK (2026-11-09).
--   Avant : un pack par collection (Classic Wave, Vague Glaciale…). Maintenant : un pack « principal » qui contient toutes les cartes.
--   Les événements (ex. Vague Glaciale) ne sont plus des packs : leurs cartes « collector » se mélangent temporairement au pack, à chaque carte tirée,
--   avec la probabilité « melange » (en %) de l'événement, entre sa date de début et sa date de fin. Les cartes collector restent des cartes à part
--   (leur propre classeur) : on les garde pour toujours, même quand l'événement est fini.
--   Les cartes de Classic Wave et tout ce que les joueurs en avaient (collection, niveaux, étoiles, marché, équipes) passent dans le pack principal.
-- Sans danger si on le repasse.

-- 1. Les colonnes et la règle de rareté (le rang 6 « Spécial » est permis dans toute collection d'événement, pas dans le pack principal)
alter table public.jeu_boosters add column if not exists melange numeric not null default 0 check (melange between 0 and 90);
alter table public.jeu_booster_cartes drop constraint if exists jeu_booster_cartes_rarete_check;
alter table public.jeu_booster_cartes add constraint jeu_booster_cartes_rarete_check
  check ((rarete >= 1 and rarete <= 5) or (rarete = 6 and booster_id <> 'principal'));

-- 2. Le pack principal
insert into public.jeu_boosters (id, nom, serie, description, ordre, actif, cout, taux, holo_x, theme, accent, classeur, visuel, melange)
values ('principal', 'Pack La Wave', 'Toutes les cartes',
        'Tous les artistes de la scène francophone dans un seul pack. Pendant les événements, des cartes collector s''y mêlent.',
        0, true, 1, array[40, 30, 18, 12, 0]::numeric[], 1, 'deferlante', '#3DD6F5', true, 'img/visuel-deferlante.webp', 0)
on conflict (id) do nothing;

-- 3. Les cartes du pack : tous les artistes actifs (Classic Wave garde sa rareté et ses réglages : album, son, clip, photo)
insert into public.jeu_booster_cartes (booster_id, artist_id, numero, rarete, son_titre, son_nom, son_debut, clip_id, clip_debut, clip_son, photo_perso, album_id)
select 'principal', c.artist_id, c.numero, coalesce(d.rarete, least(c.rarete, 4))::smallint, d.son_titre, d.son_nom, coalesce(d.son_debut, 0), d.clip_id,
       coalesce(d.clip_debut, 0), coalesce(d.clip_son, false), d.photo_perso, d.album_id
  from public.jeu_cartes c
  left join public.jeu_booster_cartes d on d.booster_id = 'deferlante' and d.artist_id = c.artist_id
 where c.active or d.artist_id is not null
on conflict (booster_id, artist_id) do nothing;

-- 4. Ce que les joueurs avaient dans Classic Wave passe dans le pack principal
insert into public.jeu_collection_b (user_id, booster_id, artist_id, holo, quantite, premiere_le)
select user_id, 'principal', artist_id, holo, quantite, premiere_le from public.jeu_collection_b where booster_id = 'deferlante'
on conflict (user_id, booster_id, artist_id, holo) do update set quantite = public.jeu_collection_b.quantite + excluded.quantite;
delete from public.jeu_collection_b where booster_id = 'deferlante';
update public.jeu_exemplaires set booster_id = 'principal' where booster_id = 'deferlante';

insert into public.jeu_cartes_niveaux (user_id, booster_id, artist_id, niveau, etoiles, maj)
select user_id, 'principal', artist_id, niveau, etoiles, maj from public.jeu_cartes_niveaux where booster_id = 'deferlante'
on conflict (user_id, booster_id, artist_id) do update set niveau = greatest(public.jeu_cartes_niveaux.niveau, excluded.niveau), etoiles = greatest(public.jeu_cartes_niveaux.etoiles, excluded.etoiles);
delete from public.jeu_cartes_niveaux where booster_id = 'deferlante';

update public.marche_annonces set booster_id = 'principal' where booster_id = 'deferlante';
update public.marche_journal set booster_id = 'principal' where booster_id = 'deferlante';
update public.jeu_expeditions set booster_id = 'principal' where booster_id = 'deferlante';
update public.combat_equipes set booster_id = 'principal' where booster_id = 'deferlante';

-- Classic Wave n'existe plus en tant que pack (ses données sont gardées, mais archivées)
update public.jeu_boosters set actif = false, classeur = false where id = 'deferlante';

-- Vague Glaciale devient un événement : 12 % des cartes du pack sont des cartes collector tant qu'il dure
update public.jeu_boosters set melange = 12 where id = 'glaciale' and melange = 0;

-- 5. Un nouvel artiste actif reçoit sa carte dans le pack principal (la rareté peut ensuite être réglée par l'équipe)
do $$
declare d text;
begin
  d := pg_get_functiondef('public.jeu_cartes_rafraichir()'::regprocedure);
  if position('''principal'', c.artist_id' in d) > 0 then return; end if;
  if position('select count(*) into v_n from public.jeu_cartes where active;' in d) = 0 then raise exception 'jeu_cartes_rafraichir : motif introuvable'; end if;
  d := replace(d, 'select count(*) into v_n from public.jeu_cartes where active;',
    'insert into public.jeu_booster_cartes (booster_id, artist_id, numero, rarete)
  select ''principal'', c.artist_id, c.numero, least(c.rarete, 4)::smallint from public.jeu_cartes c
   where c.active and exists (select 1 from public.jeu_boosters where id = ''principal'')
     and not exists (select 1 from public.jeu_booster_cartes x where x.booster_id = ''principal'' and x.artist_id = c.artist_id);

  select count(*) into v_n from public.jeu_cartes where active;');
  execute d;
end $$;

-- 6. Ouvrir des packs : toujours le pack principal ; chaque carte peut venir d'un événement en cours (probabilité « melange »)
create or replace function public.jeu_ouvrir(p_n integer, p_garanti boolean default false, p_booster text default 'principal') returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid();
  j public.jeu_joueurs; v_ev jsonb; v_taux numeric[]; v_holo_p numeric; v_jour date := public.xp_jour();
  v_main public.jeu_boosters; b public.jeu_boosters; v_cout integer;
  i integer; k integer; v_tier integer; c public.jeu_cartes; v_holo boolean; v_nouvelle boolean; v_nv_holo boolean; v_qte integer;
  v_rb smallint; v_nb integer; v_id uuid; v_iv smallint[]; v_ex bigint;
  v_cartes jsonb := '[]'::jsonb; v_rare_plus boolean := false;
  v_nb_rare integer := 0; v_nb_epique integer := 0; v_nb_holo integer := 0; v_xp integer := 0;
  v_niv integer; v_niveaux jsonb := '[]'::jsonb; v_bonus_t integer := 0; v_bonus_v integer := 0;
  v_evs text[]; v_parts numeric[]; v_part_tot numeric := 0; v_roll numeric; v_cum numeric;
begin
  if v_uid is null then raise exception 'Connecte-toi.'; end if;
  if p_n not in (1, 5, 10) then raise exception 'Quantité inconnue.'; end if;

  select * into v_main from public.jeu_boosters where id = 'principal' and actif;
  if not found then raise exception 'Le pack n''est pas disponible.'; end if;
  v_cout := case when p_garanti then 0 else v_main.cout end;

  perform public.jeu_joueur_assurer(v_uid);
  perform public.jeu_regen(v_uid);
  select * into j from public.jeu_joueurs where user_id = v_uid for update;

  if p_garanti then
    if j.garantis < 1 then raise exception 'Tu n''as pas de pack garanti.'; end if;
    p_n := 1;
  elsif j.vinyles < p_n * v_cout then
    raise exception 'Il te manque % vinyles.', p_n * v_cout - j.vinyles;
  end if;

  v_ev := public.jeu_evenement();

  -- les événements en cours dont les cartes collector se mêlent au pack
  select array_agg(e.id order by e.ordre, e.id), array_agg(e.melange order by e.ordre, e.id), coalesce(sum(e.melange), 0)
    into v_evs, v_parts, v_part_tot
    from public.jeu_boosters e
   where e.classeur and e.actif and e.id <> 'principal' and e.melange > 0
     and (e.debut is null or e.debut <= v_jour) and (e.fin is null or e.fin >= v_jour)
     and exists (select 1 from public.jeu_booster_cartes x join public.jeu_cartes jc on jc.artist_id = x.artist_id and jc.active where x.booster_id = e.id);
  v_part_tot := least(v_part_tot, 90);

  for i in 1..p_n loop

    -- d'où vient cette carte : du pack principal, ou d'un événement en cours
    b := v_main;
    if v_part_tot > 0 and random() * 100 < v_part_tot then
      v_roll := random() * (select sum(x) from unnest(v_parts) x); v_cum := 0;
      for k in 1..array_length(v_evs, 1) loop
        v_cum := v_cum + v_parts[k];
        if v_roll < v_cum or k = array_length(v_evs, 1) then
          select * into b from public.jeu_boosters where id = v_evs[k];
          exit;
        end if;
      end loop;
    end if;

    if b.taux is not null then
      v_taux := b.taux;
    else
      select array_agg(x::numeric order by ord) into v_taux from jsonb_array_elements_text(v_ev -> 'taux') with ordinality as t (x, ord);
    end if;
    v_holo_p := (v_ev ->> 'holo')::numeric * b.holo_x;

    -- Sur dix packs, au moins une Rare ou mieux ; un pack garanti est Épique ou mieux.
    v_tier := public.jeu_tirer_rarete(v_taux,
      case when p_garanti then 3 when p_n >= 10 and i = p_n and not v_rare_plus then 2 else 1 end);

    v_id := null;
    select bc.artist_id into v_id from public.jeu_booster_cartes bc join public.jeu_cartes jc on jc.artist_id = bc.artist_id and jc.active
     where bc.booster_id = b.id and bc.rarete = v_tier order by random() limit 1;
    if v_id is null then
      select bc.artist_id into v_id from public.jeu_booster_cartes bc join public.jeu_cartes jc on jc.artist_id = bc.artist_id and jc.active
       where bc.booster_id = b.id and bc.rarete <= v_tier order by bc.rarete desc, random() limit 1;
    end if;
    if v_id is null then
      select bc.artist_id into v_id from public.jeu_booster_cartes bc join public.jeu_cartes jc on jc.artist_id = bc.artist_id and jc.active
       where bc.booster_id = b.id order by bc.rarete, random() limit 1;
    end if;
    if v_id is null then raise exception 'Le pack est vide pour le moment.'; end if;
    select * into c from public.jeu_cartes where artist_id = v_id;
    select bc.rarete, bc.numero into v_rb, v_nb from public.jeu_booster_cartes bc where bc.booster_id = b.id and bc.artist_id = v_id;
    c.rarete := v_rb; c.numero := v_nb;

    v_holo := random() < v_holo_p;

    v_nouvelle := not exists (select 1 from public.jeu_collection_b where user_id = v_uid and booster_id = b.id and artist_id = c.artist_id and quantite > 0);
    v_nv_holo := v_holo and not exists (select 1 from public.jeu_collection_b where user_id = v_uid and booster_id = b.id and artist_id = c.artist_id and holo and quantite > 0);
    v_iv := public.jeu_iv_tirer(c.rarete, b.iv_parfait);
    insert into public.jeu_exemplaires (user_id, booster_id, artist_id, holo, iv_pv, iv_pui, iv_def, iv_vit)
    values (v_uid, b.id, c.artist_id, v_holo, v_iv[1], v_iv[2], v_iv[3], v_iv[4]) returning id into v_ex;
    select quantite into v_qte from public.jeu_collection_b where user_id = v_uid and booster_id = b.id and artist_id = c.artist_id and holo = v_holo;

    if c.rarete >= 2 then v_rare_plus := true; v_nb_rare := v_nb_rare + 1; end if;
    if c.rarete >= 3 then v_nb_epique := v_nb_epique + 1; end if;
    if v_holo then v_nb_holo := v_nb_holo + 1; end if;

    v_xp := v_xp + 1 + case c.rarete when 3 then 3 when 4 then 10 when 5 then 40 when 6 then 120 else 0 end + case when v_holo then 20 else 0 end;

    v_cartes := v_cartes || (public.jeu_carte_json_b(c, b.id, c.rarete::integer, c.numero, v_holo, v_qte)
        || jsonb_build_object('exemplaire', v_ex, 'iv', to_jsonb(v_iv), 'iv_pct', public.jeu_iv_pct(v_iv[1], v_iv[2], v_iv[3], v_iv[4]),
                              'parfaite', v_iv = array[31, 31, 31, 31]::smallint[])
        || jsonb_build_object('nouvelle', v_nouvelle, 'nouveau_holo', v_nv_holo, 'classeur', b.id, 'collector', b.id <> 'principal', 'evenement', case when b.id <> 'principal' then b.nom end));
  end loop;

  -- Niveaux gagnés : un petit cadeau à chaque niveau.
  v_niv := j.niveau;
  while j.xp + v_xp >= public.jeu_xp_seuil(v_niv + 1) loop
    v_niv := v_niv + 1;
    v_bonus_t := v_bonus_t + 3 + v_niv / 2;
    v_bonus_v := v_bonus_v + 10 * v_niv;
    v_niveaux := v_niveaux || jsonb_build_object('niveau', v_niv, 'tirages', 3 + v_niv / 2, 'vinyles', 10 * v_niv);
  end loop;

  update public.jeu_joueurs
     set vinyles = vinyles - p_n * v_cout + v_bonus_t + ceil(v_bonus_v / 50.0)::integer,
         garantis = garantis - case when p_garanti then 1 else 0 end,
         xp = xp + v_xp, niveau = v_niv,
         ouvertures = ouvertures + p_n, holos = holos + v_nb_holo
   where user_id = v_uid;

  insert into public.jeu_jour (user_id, jour, ouvertures, rare_plus, epique_plus, holos)
  values (v_uid, v_jour, p_n, v_nb_rare, v_nb_epique, v_nb_holo)
  on conflict (user_id, jour) do update
    set ouvertures = public.jeu_jour.ouvertures + excluded.ouvertures, rare_plus = public.jeu_jour.rare_plus + excluded.rare_plus,
        epique_plus = public.jeu_jour.epique_plus + excluded.epique_plus, holos = public.jeu_jour.holos + excluded.holos;

  return jsonb_build_object('cartes', v_cartes, 'niveaux', v_niveaux, 'booster', v_main.id, 'etat', public.jeu_etat_json(v_uid));
end $$;

-- 7. La liste des packs : le pack principal, plus les événements en cours (avec leur part dans le pack)
create or replace function public.jeu_boosters() returns jsonb
language sql stable security definer set search_path to 'public', 'extensions', 'pg_temp' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', b.id, 'nom', b.nom, 'serie', b.serie, 'description', b.description, 'cout', b.cout,
    'taux', to_jsonb(coalesce(b.taux, (select array_agg(x::numeric order by ord) from jsonb_array_elements_text(public.jeu_evenement() -> 'taux') with ordinality t (x, ord)))),
    'holo_x', b.holo_x, 'theme', b.theme, 'accent', b.accent, 'classeur', b.classeur, 'visuel', b.visuel, 'fin', b.fin, 'debut', b.debut,
    'melange', b.melange, 'evenement', b.id <> 'principal',
    'nb_cartes', (select count(*) from public.jeu_booster_cartes c join public.jeu_cartes jc on jc.artist_id = c.artist_id and jc.active where c.booster_id = b.id)
  ) order by b.ordre), '[]'::jsonb)
  from public.jeu_boosters b
  where b.actif and (b.id = 'principal' or (b.classeur and b.melange > 0)) and (b.debut is null or b.debut <= public.xp_jour()) and (b.fin is null or b.fin >= public.xp_jour());
$$;

-- 8. La console équipe : la part d'un événement dans le pack
do $$
declare d text;
begin
  d := pg_get_functiondef('public.jeu_equipe_booster_json(text)'::regprocedure);
  if position('''melange''' in d) = 0 then
    if position('''debut'', b.debut,' in d) = 0 then raise exception 'jeu_equipe_booster_json : motif introuvable'; end if;
    d := replace(d, '''debut'', b.debut,', '''melange'', b.melange, ''debut'', b.debut,');
    execute d;
  end if;

  d := pg_get_functiondef('public.jeu_equipe_booster_sauver(text,jsonb)'::regprocedure);
  if position('b.melange' in d) = 0 then
    if position('if p_donnees ? ''ordre'' then b.ordre := (p_donnees ->> ''ordre'')::integer; end if;' in d) = 0
       or position('b.taux := array[40, 30, 18, 9, 3]::numeric[];' in d) = 0
       or position('if v_taux is null or array_length(v_taux, 1) <> 5 + (p_id = ''glaciale'')::integer then' in d) = 0
       or position('(array[''Mythique'', ''Spécial''])[1 + (p_id = ''glaciale'')::integer]; end if;' in d) = 0
       or position('raise exception ''Il faut % taux, de Commun à %.'', 5 + (p_id = ''glaciale'')::integer,' in d) = 0
       or position('classeur, debut, fin, visuel)' in d) = 0
       or position('b.accent, true, b.debut, b.fin, b.visuel)' in d) = 0
       or position('debut = excluded.debut, fin = excluded.fin, visuel = excluded.visuel;' in d) = 0 then
      raise exception 'jeu_equipe_booster_sauver : motif introuvable';
    end if;
    d := replace(d, 'b.taux := array[40, 30, 18, 9, 3]::numeric[];', 'b.taux := array[0, 0, 0, 0, 0, 100]::numeric[]; b.melange := 10;');
    d := replace(d, 'if p_donnees ? ''ordre'' then b.ordre := (p_donnees ->> ''ordre'')::integer; end if;',
      'if p_donnees ? ''ordre'' then b.ordre := (p_donnees ->> ''ordre'')::integer; end if;
  if p_donnees ? ''melange'' then
    b.melange := (p_donnees ->> ''melange'')::numeric;
    if b.melange < 0 or b.melange > 90 then raise exception ''La part dans le pack va de 0 à 90 %%.''; end if;
  end if;');
    d := replace(d, 'if v_taux is null or array_length(v_taux, 1) <> 5 + (p_id = ''glaciale'')::integer then',
      'if v_taux is null or array_length(v_taux, 1) <> (case when p_id = ''principal'' then 5 else 6 end) then');
    d := replace(d, 'raise exception ''Il faut % taux, de Commun à %.'', 5 + (p_id = ''glaciale'')::integer,', 'raise exception ''Il faut % taux, de Commun à %.'', (case when p_id = ''principal'' then 5 else 6 end),');
    d := replace(d, '(array[''Mythique'', ''Spécial''])[1 + (p_id = ''glaciale'')::integer]; end if;', '(case when p_id = ''principal'' then ''Légendaire'' else ''Spécial'' end); end if;');
    d := replace(d, 'classeur, debut, fin, visuel)', 'classeur, debut, fin, visuel, melange)');
    d := replace(d, 'b.accent, true, b.debut, b.fin, b.visuel)', 'b.accent, true, b.debut, b.fin, b.visuel, b.melange)');
    d := replace(d, 'debut = excluded.debut, fin = excluded.fin, visuel = excluded.visuel;', 'debut = excluded.debut, fin = excluded.fin, visuel = excluded.visuel, melange = excluded.melange;');
    execute d;
  end if;
end $$;

select public.jeu_cartes_rafraichir();
