-- Wave Cards : la console de l'équipe (cartes-equipe.js), 2026-10-27.
-- Tout ce que l'équipe règle sans toucher au SQL : collections (boosters), cartes de chaque collection, joueurs.
-- Chaque fonction est gardée par est_equipe() et laisse une ligne dans le journal d'équipe (jeu_equipe_journal).
--
--  jeu_equipe_resume()                          chiffres clés et activité récente
--  jeu_equipe_boosters()                        les collections (classeurs), actives ou archivées
--  jeu_equipe_booster_sauver(id, données)       créer / modifier (nom, taux, visuel, dates, actif…)
--  jeu_equipe_booster_dupliquer(id, nouveau, nom)
--  jeu_equipe_booster_supprimer(id)             seulement si aucun joueur n'en possède de carte
--  jeu_equipe_cartes(booster)                   les cartes d'une collection, avec leurs propriétaires
--  jeu_equipe_artistes(q, booster, limite, décalage)   recherche / les plus écoutés pas encore dans la collection
--  jeu_equipe_artistes_noms(noms[])             retrouve des artistes depuis une liste de noms collée
--  jeu_equipe_cartes_ajouter(booster, [{artist_id, rarete}])
--  jeu_equipe_cartes_raretes(booster, [{artist_id, rarete}])
--  jeu_equipe_cartes_retirer(booster, artistes[])
--  jeu_equipe_cartes_ordre(booster, artistes[]) renumérote 1..n dans l'ordre donné
--  jeu_equipe_joueurs(q) / jeu_equipe_joueur(id)
--  jeu_equipe_vinyles(id, delta, motif)         donner ou retirer des vinyles
--  jeu_equipe_carte_donner(id, booster, artiste, holo, quantité)  offrir (ou retirer avec une quantité négative)
--  jeu_equipe_journal(limite, cible)

create table if not exists public.jeu_equipe_journal (
  id bigserial primary key,
  cree_le timestamptz not null default now(),
  auteur uuid,
  action text not null,
  detail jsonb not null default '{}'::jsonb
);
alter table public.jeu_equipe_journal enable row level security;
create index if not exists jeu_equipe_journal_cree on public.jeu_equipe_journal (cree_le desc);

-- Une ligne de journal ; jamais appelable depuis le site.
create or replace function public.jeu_equipe_noter(p_action text, p_detail jsonb default '{}'::jsonb)
returns void language sql security definer set search_path to 'public' as $$
  insert into public.jeu_equipe_journal (auteur, action, detail) values (auth.uid(), p_action, coalesce(p_detail, '{}'::jsonb));
$$;
revoke all on function public.jeu_equipe_noter(text, jsonb) from public, anon, authenticated;

-- Un booster tel que la console le lit.
create or replace function public.jeu_equipe_booster_json(p_id text)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'id', b.id, 'nom', b.nom, 'serie', b.serie, 'description', b.description, 'ordre', b.ordre, 'actif', b.actif,
    'cout', b.cout, 'taux', to_jsonb(coalesce(b.taux, array[40, 30, 18, 9, 3]::numeric[])), 'holo_x', b.holo_x, 'theme', b.theme, 'accent', b.accent,
    'debut', b.debut, 'fin', b.fin, 'visuel', b.visuel,
    'nb', (select count(*) from public.jeu_booster_cartes x where x.booster_id = b.id),
    'raretes', (select jsonb_build_array(
        count(*) filter (where x.rarete = 1), count(*) filter (where x.rarete = 2), count(*) filter (where x.rarete = 3),
        count(*) filter (where x.rarete = 4), count(*) filter (where x.rarete = 5)) from public.jeu_booster_cartes x where x.booster_id = b.id),
    'joueurs', (select count(distinct c.user_id) from public.jeu_collection_b c where c.booster_id = b.id and c.quantite > 0))
  from public.jeu_boosters b where b.id = p_id;
$$;
revoke all on function public.jeu_equipe_booster_json(text) from public, anon, authenticated;

-- Vue d'ensemble
create or replace function public.jeu_equipe_resume()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_jour date := public.xp_jour();
begin
  if not public.est_equipe() then raise exception 'Réservé à l''équipe.'; end if;
  return jsonb_build_object(
    'joueurs', (select count(*) from public.jeu_joueurs),
    'ouvertures', (select coalesce(sum(ouvertures), 0) from public.jeu_joueurs),
    'ouvertures_jour', (select coalesce(sum(ouvertures), 0) from public.jeu_jour where jour = v_jour),
    'actifs_jour', (select count(*) from public.jeu_jour where jour = v_jour and ouvertures > 0),
    'vinyles', (select coalesce(sum(vinyles), 0) from public.jeu_joueurs),
    'wc', (select coalesce(sum(w.solde), 0) from public.wc_portefeuille w where w.user_id in (select user_id from public.jeu_joueurs)),
    'holos', (select coalesce(sum(holos), 0) from public.jeu_joueurs),
    'cartes_possedees', (select coalesce(sum(quantite), 0) from public.jeu_collection_b),
    'collections', coalesce((select jsonb_agg(public.jeu_equipe_booster_json(b.id) order by b.ordre, b.nom) from public.jeu_boosters b where b.classeur), '[]'::jsonb),
    'activite', coalesce((select jsonb_agg(jsonb_build_object('cree_le', j.cree_le, 'action', j.action, 'detail', j.detail, 'auteur', p.pseudo) order by j.cree_le desc)
                            from (select * from public.jeu_equipe_journal order by cree_le desc limit 8) j left join public.profiles p on p.id = j.auteur), '[]'::jsonb));
end $$;

create or replace function public.jeu_equipe_boosters()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not public.est_equipe() then raise exception 'Réservé à l''équipe.'; end if;
  return coalesce((select jsonb_agg(public.jeu_equipe_booster_json(b.id) order by b.ordre, b.nom) from public.jeu_boosters b where b.classeur), '[]'::jsonb);
end $$;

-- Créer ou modifier une collection. Seules les clés présentes dans p_donnees sont changées.
create or replace function public.jeu_equipe_booster_sauver(p_id text, p_donnees jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  b public.jeu_boosters; v_nouveau boolean; k text; v_taux numeric[]; v_somme numeric; v_visuel text;
  v_url constant text := '^https://bqataeghgjyiqrnnesqq\.supabase\.co/storage/v1/object/public/Covers/[A-Za-z0-9._/%~-]+$';
begin
  if not public.est_equipe() then raise exception 'Réservé à l''équipe.'; end if;
  p_id := lower(btrim(coalesce(p_id, '')));
  if p_id !~ '^[a-z0-9][a-z0-9-]{1,39}$' then raise exception 'Identifiant invalide : lettres minuscules, chiffres et tirets (2 à 40 signes).'; end if;
  p_donnees := coalesce(p_donnees, '{}'::jsonb);

  select * into b from public.jeu_boosters where id = p_id;
  v_nouveau := not found;
  if v_nouveau then
    if not (p_donnees ? 'nom') then raise exception 'Donne un nom à la collection.'; end if;
    b.id := p_id; b.serie := ''; b.description := ''; b.actif := false; b.cout := 1; b.taux := array[40, 30, 18, 9, 3]::numeric[]; b.holo_x := 1;
    b.theme := 'onde'; b.accent := '#4FB4FF'; b.debut := null; b.fin := null; b.visuel := null;
    b.ordre := coalesce((select max(ordre) from public.jeu_boosters where classeur), 0) + 1;
  elsif not b.classeur then
    raise exception 'Cette ancienne collection n''est pas modifiable ici.';
  end if;
  b.classeur := true;

  if p_donnees ? 'nom' then
    b.nom := btrim(coalesce(p_donnees ->> 'nom', ''));
    if char_length(b.nom) not between 1 and 60 then raise exception 'Le nom fait de 1 à 60 signes.'; end if;
  end if;
  if p_donnees ? 'serie' then
    b.serie := btrim(coalesce(p_donnees ->> 'serie', ''));
    if char_length(b.serie) > 60 then raise exception 'Le sous-titre fait 60 signes au plus.'; end if;
  end if;
  if p_donnees ? 'description' then
    b.description := btrim(coalesce(p_donnees ->> 'description', ''));
    if char_length(b.description) > 400 then raise exception 'La description fait 400 signes au plus.'; end if;
  end if;
  if p_donnees ? 'ordre' then b.ordre := (p_donnees ->> 'ordre')::integer; end if;
  if p_donnees ? 'actif' then b.actif := (p_donnees ->> 'actif')::boolean; end if;
  if p_donnees ? 'cout' then
    b.cout := (p_donnees ->> 'cout')::integer;
    if b.cout not between 1 and 10000 then raise exception 'Le prix va de 1 à 10 000 vinyles.'; end if;
  end if;
  if p_donnees ? 'holo_x' then
    b.holo_x := (p_donnees ->> 'holo_x')::numeric;
    if b.holo_x < 0 or b.holo_x > 20 then raise exception 'Le multiplicateur holo va de 0 à 20.'; end if;
  end if;
  if p_donnees ? 'taux' then
    select array_agg(x::numeric order by ord) into v_taux from jsonb_array_elements_text(p_donnees -> 'taux') with ordinality t (x, ord);
    if v_taux is null or array_length(v_taux, 1) <> 5 then raise exception 'Il faut cinq taux, de Commun à Mythique.'; end if;
    if exists (select 1 from unnest(v_taux) z where z < 0) then raise exception 'Un taux ne peut pas être négatif.'; end if;
    select sum(z) into v_somme from unnest(v_taux) z;
    if abs(v_somme - 100) > 0.05 then raise exception 'Les taux doivent faire 100 %% au total (là : % %%).', v_somme; end if;
    b.taux := v_taux;
  end if;
  if p_donnees ? 'theme' then
    b.theme := coalesce(p_donnees ->> 'theme', '');
    if b.theme not in ('onde', 'couronne', 'aube', 'garanti', 'glace', 'deferlante') then raise exception 'Thème inconnu.'; end if;
  end if;
  if p_donnees ? 'accent' then
    b.accent := coalesce(p_donnees ->> 'accent', '');
    if b.accent !~ '^#[0-9a-fA-F]{6}$' then raise exception 'La couleur doit s''écrire #RRGGBB.'; end if;
  end if;
  if p_donnees ? 'debut' then b.debut := nullif(p_donnees ->> 'debut', '')::date; end if;
  if p_donnees ? 'fin' then b.fin := nullif(p_donnees ->> 'fin', '')::date; end if;
  if b.debut is not null and b.fin is not null and b.fin < b.debut then raise exception 'La fin doit venir après le début.'; end if;
  if p_donnees ? 'visuel' then
    v_visuel := nullif(btrim(coalesce(p_donnees ->> 'visuel', '')), '');
    if v_visuel is not null and v_visuel !~ '^img/[A-Za-z0-9._-]+$' and v_visuel !~ v_url then raise exception 'Visuel refusé : une image de img/ ou du stockage du site.'; end if;
    b.visuel := v_visuel;
  end if;

  insert into public.jeu_boosters (id, nom, serie, description, ordre, actif, cout, taux, holo_x, theme, accent, classeur, debut, fin, visuel)
  values (b.id, b.nom, b.serie, b.description, b.ordre, b.actif, b.cout, b.taux, b.holo_x, b.theme, b.accent, true, b.debut, b.fin, b.visuel)
  on conflict (id) do update set nom = excluded.nom, serie = excluded.serie, description = excluded.description, ordre = excluded.ordre, actif = excluded.actif,
    cout = excluded.cout, taux = excluded.taux, holo_x = excluded.holo_x, theme = excluded.theme, accent = excluded.accent,
    debut = excluded.debut, fin = excluded.fin, visuel = excluded.visuel;

  perform public.jeu_equipe_noter(case when v_nouveau then 'collection_creee' else 'collection_modifiee' end,
    jsonb_build_object('booster', b.id, 'nom', b.nom, 'champs', (select coalesce(jsonb_agg(key), '[]'::jsonb) from jsonb_object_keys(p_donnees) key)));
  return public.jeu_equipe_booster_json(b.id);
end $$;

create or replace function public.jeu_equipe_booster_dupliquer(p_id text, p_nouveau text, p_nom text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare b public.jeu_boosters;
begin
  if not public.est_equipe() then raise exception 'Réservé à l''équipe.'; end if;
  p_nouveau := lower(btrim(coalesce(p_nouveau, '')));
  if p_nouveau !~ '^[a-z0-9][a-z0-9-]{1,39}$' then raise exception 'Identifiant invalide : lettres minuscules, chiffres et tirets (2 à 40 signes).'; end if;
  if exists (select 1 from public.jeu_boosters where id = p_nouveau) then raise exception 'Cet identifiant existe déjà.'; end if;
  select * into b from public.jeu_boosters where id = p_id and classeur;
  if not found then raise exception 'Collection introuvable.'; end if;
  insert into public.jeu_boosters (id, nom, serie, description, ordre, actif, cout, taux, holo_x, theme, accent, classeur, debut, fin, visuel)
  values (p_nouveau, left(coalesce(nullif(btrim(p_nom), ''), b.nom || ' (copie)'), 60), b.serie, b.description,
          coalesce((select max(ordre) from public.jeu_boosters where classeur), 0) + 1, false, b.cout, b.taux, b.holo_x, b.theme, b.accent, true, b.debut, b.fin, b.visuel);
  insert into public.jeu_booster_cartes (booster_id, artist_id, numero, rarete)
    select p_nouveau, artist_id, numero, rarete from public.jeu_booster_cartes where booster_id = p_id;
  perform public.jeu_equipe_noter('collection_dupliquee', jsonb_build_object('booster', p_nouveau, 'depuis', p_id));
  return public.jeu_equipe_booster_json(p_nouveau);
end $$;

create or replace function public.jeu_equipe_booster_supprimer(p_id text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_nom text;
begin
  if not public.est_equipe() then raise exception 'Réservé à l''équipe.'; end if;
  select nom into v_nom from public.jeu_boosters where id = p_id and classeur;
  if not found then raise exception 'Collection introuvable.'; end if;
  if exists (select 1 from public.jeu_collection_b where booster_id = p_id and quantite > 0) then
    raise exception 'Des joueurs possèdent des cartes de cette collection : archive-la plutôt que de la supprimer.';
  end if;
  delete from public.jeu_boosters where id = p_id;
  perform public.jeu_equipe_noter('collection_supprimee', jsonb_build_object('booster', p_id, 'nom', v_nom));
  return jsonb_build_object('supprime', p_id);
end $$;

-- Les cartes d'une collection, dans l'ordre des numéros, avec le nombre de joueurs et d'exemplaires.
create or replace function public.jeu_equipe_cartes(p_booster text)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not public.est_equipe() then raise exception 'Réservé à l''équipe.'; end if;
  if not exists (select 1 from public.jeu_boosters where id = p_booster and classeur) then raise exception 'Collection introuvable.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('artist_id', bc.artist_id, 'numero', bc.numero, 'rarete', bc.rarete, 'nom', c.nom, 'photo', c.photo, 'fans', c.fans,
                                                       'joueurs', coalesce(o.joueurs, 0), 'exemplaires', coalesce(o.exemplaires, 0)) order by bc.numero, c.nom)
    from public.jeu_booster_cartes bc
    left join public.jeu_cartes c on c.artist_id = bc.artist_id
    left join lateral (select count(distinct x.user_id)::integer as joueurs, sum(x.quantite)::integer as exemplaires from public.jeu_collection_b x
                        where x.booster_id = bc.booster_id and x.artist_id = bc.artist_id and x.quantite > 0) o on true
   where bc.booster_id = p_booster), '[]'::jsonb);
end $$;

-- Les artistes du jeu : recherche par nom, ou (sans recherche) les plus écoutés qui ne sont pas déjà dans la collection.
create or replace function public.jeu_equipe_artistes(p_q text, p_booster text, p_limite integer default 30, p_decalage integer default 0)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_q text := nullif(public.norme_artiste(p_q), '');
begin
  if not public.est_equipe() then raise exception 'Réservé à l''équipe.'; end if;
  p_limite := least(greatest(coalesce(p_limite, 30), 1), 200);
  p_decalage := greatest(coalesce(p_decalage, 0), 0);
  return coalesce((select jsonb_agg(jsonb_build_object('artist_id', t.artist_id, 'nom', t.nom, 'photo', t.photo, 'fans', t.fans, 'deja', t.deja) order by t.fans desc nulls last)
    from (select c.artist_id, c.nom, c.photo, c.fans,
                 exists (select 1 from public.jeu_booster_cartes bc where bc.booster_id = p_booster and bc.artist_id = c.artist_id) as deja
            from public.jeu_cartes c
           where c.active
             and (v_q is not null and public.norme_artiste(c.nom) like '%' || v_q || '%'
                  or v_q is null and not exists (select 1 from public.jeu_booster_cartes bc where bc.booster_id = p_booster and bc.artist_id = c.artist_id))
           order by c.fans desc nulls last limit p_limite offset p_decalage) t), '[]'::jsonb);
end $$;

-- Pour chaque nom d'une liste collée : l'artiste le plus proche (nom exact d'abord, puis le plus écouté qui le contient).
create or replace function public.jeu_equipe_artistes_noms(p_noms text[])
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not public.est_equipe() then raise exception 'Réservé à l''équipe.'; end if;
  if coalesce(array_length(p_noms, 1), 0) > 200 then raise exception '200 noms au plus à la fois.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('saisi', n.nom, 'artist_id', m.artist_id, 'nom', m.nom, 'photo', m.photo, 'fans', m.fans) order by n.ord)
    from unnest(p_noms) with ordinality n (nom, ord)
    left join lateral (select c.artist_id, c.nom, c.photo, c.fans from public.jeu_cartes c
                        where c.active and nullif(public.norme_artiste(n.nom), '') is not null and public.norme_artiste(c.nom) like '%' || public.norme_artiste(n.nom) || '%'
                        order by (public.norme_artiste(c.nom) = public.norme_artiste(n.nom)) desc, c.fans desc nulls last limit 1) m on true), '[]'::jsonb);
end $$;

-- Ajouter des cartes (ou changer leur rareté si elles y sont déjà). Les numéros suivent l'ordre d'arrivée.
create or replace function public.jeu_equipe_cartes_ajouter(p_booster text, p_items jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare it jsonb; v_num integer; v_nb integer := 0;
begin
  if not public.est_equipe() then raise exception 'Réservé à l''équipe.'; end if;
  if not exists (select 1 from public.jeu_boosters where id = p_booster and classeur) then raise exception 'Collection introuvable.'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 300 then raise exception 'Liste invalide (300 cartes au plus).'; end if;
  select coalesce(max(numero), 0) into v_num from public.jeu_booster_cartes where booster_id = p_booster;
  for it in select * from jsonb_array_elements(p_items) loop
    if (it ->> 'rarete')::integer not between 1 and 5 then raise exception 'Rareté inconnue.'; end if;
    if not exists (select 1 from public.jeu_cartes where artist_id = (it ->> 'artist_id')::uuid and active) then raise exception 'Un artiste n''a pas de carte dans le jeu.'; end if;
    if exists (select 1 from public.jeu_booster_cartes where booster_id = p_booster and artist_id = (it ->> 'artist_id')::uuid) then
      update public.jeu_booster_cartes set rarete = (it ->> 'rarete')::integer where booster_id = p_booster and artist_id = (it ->> 'artist_id')::uuid;
    else
      v_num := v_num + 1;
      insert into public.jeu_booster_cartes (booster_id, artist_id, numero, rarete) values (p_booster, (it ->> 'artist_id')::uuid, v_num, (it ->> 'rarete')::integer);
    end if;
    v_nb := v_nb + 1;
  end loop;
  perform public.jeu_equipe_noter('cartes_ajoutees', jsonb_build_object('booster', p_booster, 'nb', v_nb));
  return public.jeu_equipe_booster_json(p_booster);
end $$;

create or replace function public.jeu_equipe_cartes_raretes(p_booster text, p_items jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_nb integer;
begin
  if not public.est_equipe() then raise exception 'Réservé à l''équipe.'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 500 then raise exception 'Liste invalide (500 cartes au plus).'; end if;
  if exists (select 1 from jsonb_array_elements(p_items) e where (e ->> 'rarete')::integer not between 1 and 5) then raise exception 'Rareté inconnue.'; end if;
  update public.jeu_booster_cartes bc set rarete = (e ->> 'rarete')::integer
    from jsonb_array_elements(p_items) e where bc.booster_id = p_booster and bc.artist_id = (e ->> 'artist_id')::uuid;
  get diagnostics v_nb = row_count;
  perform public.jeu_equipe_noter('raretes_changees', jsonb_build_object('booster', p_booster, 'nb', v_nb));
  return public.jeu_equipe_booster_json(p_booster);
end $$;

create or replace function public.jeu_equipe_cartes_retirer(p_booster text, p_artistes uuid[])
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_nb integer;
begin
  if not public.est_equipe() then raise exception 'Réservé à l''équipe.'; end if;
  delete from public.jeu_booster_cartes where booster_id = p_booster and artist_id = any (coalesce(p_artistes, '{}'::uuid[]));
  get diagnostics v_nb = row_count;
  perform public.jeu_equipe_noter('cartes_retirees', jsonb_build_object('booster', p_booster, 'nb', v_nb));
  return public.jeu_equipe_booster_json(p_booster);
end $$;

-- Renumérote : la première de la liste prend le numéro 1, etc. Les cartes absentes de la liste suivent, dans leur ordre.
create or replace function public.jeu_equipe_cartes_ordre(p_booster text, p_artistes uuid[])
returns jsonb language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.est_equipe() then raise exception 'Réservé à l''équipe.'; end if;
  with ordre as (
    select bc.artist_id, row_number() over (order by coalesce(a.ord, 1000000), bc.numero) as n
      from public.jeu_booster_cartes bc
      left join unnest(coalesce(p_artistes, '{}'::uuid[])) with ordinality a (artist_id, ord) on a.artist_id = bc.artist_id
     where bc.booster_id = p_booster)
  update public.jeu_booster_cartes bc set numero = o.n from ordre o where bc.booster_id = p_booster and bc.artist_id = o.artist_id;
  perform public.jeu_equipe_noter('cartes_renumerotees', jsonb_build_object('booster', p_booster));
  return public.jeu_equipe_booster_json(p_booster);
end $$;

-- Les joueurs
create or replace function public.jeu_equipe_joueurs(p_q text)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_q text := nullif(btrim(coalesce(p_q, '')), '');
begin
  if not public.est_equipe() then raise exception 'Réservé à l''équipe.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'pseudo', t.pseudo, 'avatar', t.avatar_url, 'vinyles', t.vinyles, 'ouvertures', t.ouvertures,
                                                       'niveau', t.niveau, 'wc', t.wc, 'cartes', t.cartes) order by t.ouvertures desc, t.pseudo)
    from (select p.id, p.pseudo, p.avatar_url, coalesce(j.vinyles, 0) as vinyles, coalesce(j.ouvertures, 0) as ouvertures, coalesce(j.niveau, 1) as niveau,
                 coalesce((select w.solde from public.wc_portefeuille w where w.user_id = p.id), 0) as wc,
                 (select count(*) from public.jeu_collection_b c where c.user_id = p.id and c.quantite > 0) as cartes
            from public.profiles p left join public.jeu_joueurs j on j.user_id = p.id
           where (v_q is null and j.user_id is not null) or (v_q is not null and p.pseudo ilike '%' || replace(replace(v_q, '%', ''), '_', '') || '%')
           order by coalesce(j.ouvertures, 0) desc, p.pseudo limit 25) t), '[]'::jsonb);
end $$;

create or replace function public.jeu_equipe_joueur(p_user uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare j public.jeu_joueurs;
begin
  if not public.est_equipe() then raise exception 'Réservé à l''équipe.'; end if;
  select * into j from public.jeu_joueurs where user_id = p_user;
  return jsonb_build_object(
    'profil', (select jsonb_build_object('id', p.id, 'pseudo', p.pseudo, 'avatar', p.avatar_url) from public.profiles p where p.id = p_user),
    'jeu', jsonb_build_object('vinyles', coalesce(j.vinyles, 0), 'ouvertures', coalesce(j.ouvertures, 0), 'niveau', coalesce(j.niveau, 1), 'xp', coalesce(j.xp, 0),
                              'holos', coalesce(j.holos, 0), 'garantis', coalesce(j.garantis, 0), 'inscrit', j.user_id is not null),
    'wc', coalesce((select w.solde from public.wc_portefeuille w where w.user_id = p_user), 0),
    'collections', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'nom', b.nom,
          'possedees', (select count(distinct c.artist_id) from public.jeu_collection_b c where c.user_id = p_user and c.booster_id = b.id and c.quantite > 0),
          'total', (select count(*) from public.jeu_booster_cartes x where x.booster_id = b.id),
          'exemplaires', (select coalesce(sum(c.quantite), 0) from public.jeu_collection_b c where c.user_id = p_user and c.booster_id = b.id)) order by b.ordre)
        from public.jeu_boosters b where b.classeur), '[]'::jsonb),
    'recentes', coalesce((select jsonb_agg(jsonb_build_object('booster', t.booster_id, 'artist_id', t.artist_id, 'nom', t.nom, 'photo', t.photo, 'rarete', t.rarete,
                                                              'holo', t.holo, 'quantite', t.quantite, 'le', t.premiere_le) order by t.premiere_le desc)
        from (select c.booster_id, c.artist_id, k.nom, k.photo, bc.rarete, c.holo, c.quantite, c.premiere_le
                from public.jeu_collection_b c join public.jeu_cartes k on k.artist_id = c.artist_id
                left join public.jeu_booster_cartes bc on bc.booster_id = c.booster_id and bc.artist_id = c.artist_id
               where c.user_id = p_user and c.quantite > 0 order by c.premiere_le desc limit 12) t), '[]'::jsonb),
    'wc_recent', coalesce((select jsonb_agg(jsonb_build_object('delta', w.delta, 'motif', w.motif, 'le', w.cree_le) order by w.cree_le desc)
        from (select * from public.wc_journal where user_id = p_user order by cree_le desc limit 8) w), '[]'::jsonb));
end $$;

create or replace function public.jeu_equipe_vinyles(p_user uuid, p_delta integer, p_motif text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_solde integer;
begin
  if not public.est_equipe() then raise exception 'Réservé à l''équipe.'; end if;
  if p_delta is null or p_delta = 0 or abs(p_delta) > 1000 then raise exception 'Donne ou retire de 1 à 1 000 vinyles.'; end if;
  if not exists (select 1 from public.profiles where id = p_user) then raise exception 'Joueur introuvable.'; end if;
  perform public.jeu_joueur_assurer(p_user);
  select vinyles into v_solde from public.jeu_joueurs where user_id = p_user for update;
  if v_solde + p_delta < 0 then raise exception 'Ce joueur n''a que % vinyles.', v_solde; end if;
  update public.jeu_joueurs set vinyles = vinyles + p_delta where user_id = p_user;
  perform public.jeu_equipe_noter(case when p_delta > 0 then 'vinyles_donnes' else 'vinyles_retires' end,
    jsonb_build_object('cible', p_user, 'delta', p_delta, 'motif', left(coalesce(p_motif, ''), 120)));
  return public.jeu_equipe_joueur(p_user);
end $$;

-- Offrir une carte (quantité positive) ou en retirer (quantité négative).
create or replace function public.jeu_equipe_carte_donner(p_user uuid, p_booster text, p_artist uuid, p_holo boolean, p_quantite integer)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_q integer;
begin
  if not public.est_equipe() then raise exception 'Réservé à l''équipe.'; end if;
  if p_quantite is null or p_quantite = 0 or abs(p_quantite) > 20 then raise exception 'Donne ou retire de 1 à 20 exemplaires.'; end if;
  if not exists (select 1 from public.profiles where id = p_user) then raise exception 'Joueur introuvable.'; end if;
  if not exists (select 1 from public.jeu_booster_cartes where booster_id = p_booster and artist_id = p_artist) then raise exception 'Cette carte n''est pas dans la collection.'; end if;
  perform public.jeu_joueur_assurer(p_user);
  if p_quantite > 0 then
    insert into public.jeu_collection_b (user_id, booster_id, artist_id, holo, quantite) values (p_user, p_booster, p_artist, coalesce(p_holo, false), p_quantite)
    on conflict (user_id, booster_id, artist_id, holo) do update set quantite = public.jeu_collection_b.quantite + excluded.quantite;
  else
    select quantite into v_q from public.jeu_collection_b where user_id = p_user and booster_id = p_booster and artist_id = p_artist and holo = coalesce(p_holo, false) for update;
    if coalesce(v_q, 0) + p_quantite < 0 then raise exception 'Ce joueur n''en a que %.', coalesce(v_q, 0); end if;
    update public.jeu_collection_b set quantite = quantite + p_quantite where user_id = p_user and booster_id = p_booster and artist_id = p_artist and holo = coalesce(p_holo, false);
  end if;
  perform public.jeu_equipe_noter(case when p_quantite > 0 then 'carte_offerte' else 'carte_retiree' end,
    jsonb_build_object('cible', p_user, 'booster', p_booster, 'artist', p_artist, 'holo', coalesce(p_holo, false), 'quantite', p_quantite));
  return public.jeu_equipe_joueur(p_user);
end $$;

create or replace function public.jeu_equipe_journal(p_limite integer default 40, p_cible uuid default null)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not public.est_equipe() then raise exception 'Réservé à l''équipe.'; end if;
  p_limite := least(greatest(coalesce(p_limite, 40), 1), 200);
  return coalesce((select jsonb_agg(jsonb_build_object('cree_le', j.cree_le, 'action', j.action, 'detail', j.detail, 'auteur', p.pseudo,
                                                       'cible', (select q.pseudo from public.profiles q where q.id = nullif(j.detail ->> 'cible', '')::uuid)) order by j.cree_le desc)
    from (select * from public.jeu_equipe_journal where p_cible is null or detail ->> 'cible' = p_cible::text order by cree_le desc limit p_limite) j
    left join public.profiles p on p.id = j.auteur), '[]'::jsonb);
end $$;

-- Droits : réservé aux comptes connectés (est_equipe() filtre ensuite).
do $$
declare f text;
begin
  foreach f in array array[
    'jeu_equipe_resume()', 'jeu_equipe_boosters()', 'jeu_equipe_booster_sauver(text,jsonb)', 'jeu_equipe_booster_dupliquer(text,text,text)',
    'jeu_equipe_booster_supprimer(text)', 'jeu_equipe_cartes(text)', 'jeu_equipe_artistes(text,text,integer,integer)', 'jeu_equipe_artistes_noms(text[])',
    'jeu_equipe_cartes_ajouter(text,jsonb)', 'jeu_equipe_cartes_raretes(text,jsonb)', 'jeu_equipe_cartes_retirer(text,uuid[])',
    'jeu_equipe_cartes_ordre(text,uuid[])', 'jeu_equipe_joueurs(text)', 'jeu_equipe_joueur(uuid)', 'jeu_equipe_vinyles(uuid,integer,text)',
    'jeu_equipe_carte_donner(uuid,text,uuid,boolean,integer)', 'jeu_equipe_journal(integer,uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
