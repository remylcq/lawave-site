-- Wave Cards : UNE CARTE PAR PROJET ET PAR SINGLE (2026-11-09).
--   Avant : une carte par artiste. Maintenant : une carte par sortie (projet ou single) d'un artiste du jeu ; la pochette de la sortie est la photo de la carte,
--   le nom de la carte reste celui de l'artiste, le titre de la sortie s'affiche dessous.
--   L'identifiant d'une carte est celui de la sortie (submissions.id), rangé dans les colonnes « artist_id » existantes (collection, niveaux, marché, équipes…) :
--   aucune table de joueur n'a besoin de changer. Les anciennes cartes d'artiste sont désactivées ; ce que les joueurs en avaient passe sur la
--   dernière sortie du même artiste.
--   Rareté : celle de l'artiste (selon ses fans) pour un projet, un cran de moins pour un single (jamais sous Commun) ; le pack plafonne à Légendaire.
--   Combat : les attaques d'une carte sont les titres de sa sortie (lus sur Deezer par une tâche de fond, cartes possédées d'abord).
-- Sans danger si on le repasse.

-- 1. Les colonnes (artiste réel, sortie, titre, type) ; la clé étrangère passe de « artist_id » (désormais l'identifiant de la carte) à « artiste_id »
alter table public.jeu_cartes add column if not exists artiste_id uuid;
alter table public.jeu_cartes add column if not exists release_id uuid;
alter table public.jeu_cartes add column if not exists titre text;
alter table public.jeu_cartes add column if not exists type text;
update public.jeu_cartes set artiste_id = artist_id where artiste_id is null and release_id is null;
alter table public.jeu_cartes drop constraint if exists jeu_cartes_artist_id_fkey;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'jeu_cartes_artiste_fkey') then
    alter table public.jeu_cartes add constraint jeu_cartes_artiste_fkey foreign key (artiste_id) references public.artists (id) on delete cascade;
  end if;
end $$;
create unique index if not exists jeu_cartes_release_idx on public.jeu_cartes (release_id) where release_id is not null;
create index if not exists jeu_cartes_artiste_idx on public.jeu_cartes (artiste_id);

-- 2. Les cartes : une par sortie sortie, approuvée, non bannie, en langue du site, avec une pochette, d'un artiste du jeu
create or replace function public.jeu_cartes_rafraichir() returns integer
language plpgsql security definer set search_path to 'public' as $$
declare v_n integer; v_max integer;
begin
  if not pg_try_advisory_xact_lock(hashtext('jeu_cartes_rafraichir')) then return 0; end if;

  create temporary table if not exists jeu_cartes_base (
    release_id uuid primary key, artiste_id uuid, rarete smallint, fans bigint, nom text, handle text, photo text, ville text, sorties integer,
    derniere jsonb, titre text, type text, sortie date
  ) on commit drop;
  truncate jeu_cartes_base;

  insert into jeu_cartes_base
  with so as (
    select s.id, s.artist_handle, s.track_title, s.release_type, s.cover_url, s.release_date, s.catalog_number
      from public.submissions s
     where s.status = 'approved' and not s.banni and not s.hors_langue
       and s.release_date is not null and s.release_date <= public.xp_jour()
       and s.cover_url ~ '^https://' and s.cover_url not like '%d41d8cd98f00b204e9800998ecf8427e%'
       and s.release_type in ('Projet', 'Single')
  ), nb as (
    select artist_handle, count(*)::integer as n from so group by artist_handle
  ), art as (
    select a.id, coalesce(nullif(btrim(a.display_name), ''), a.instagram_handle) as nom, a.instagram_handle as handle, a.ville,
           coalesce(a.deezer_fans, 0) as fans, nb.n
      from public.artists a
      join nb on nb.artist_handle = a.instagram_handle
     where not a.banni and (a.francophone is true or (a.francophone is null and a.source is null))
       and (coalesce(a.deezer_fans, 0) >= 1000 or a.source is null or a.source = 'liste-rappeurs')
  ), rang as (
    select art.*, percent_rank() over (order by art.fans) as pr from art
  )
  select so.id, r.id,
         (case when so.release_type = 'Projet' then tt.t else greatest(tt.t - 1, 1) end)::smallint,
         r.fans, r.nom, r.handle, so.cover_url, r.ville, r.n,
         jsonb_build_object('titre', so.track_title, 'cover', so.cover_url, 'numero', so.catalog_number, 'date', so.release_date),
         so.track_title, so.release_type, so.release_date
    from rang r
    join so on so.artist_handle = r.handle
    cross join lateral (select case when r.pr >= .99 then 5 when r.pr >= .95 then 4 when r.pr >= .85 then 3 when r.pr >= .60 then 2 else 1 end as t) tt;

  update public.jeu_cartes c
     set rarete = b.rarete, fans = b.fans, nom = b.nom, handle = b.handle, photo = b.photo, ville = b.ville, sorties = b.sorties,
         derniere = b.derniere, titre = b.titre, type = b.type, artiste_id = b.artiste_id, active = true
    from jeu_cartes_base b
   where c.release_id = b.release_id
     and (c.rarete, c.fans, c.nom, c.handle, c.photo, c.ville, c.sorties, c.titre, c.type, c.artiste_id, c.active)
         is distinct from (b.rarete, b.fans, b.nom, b.handle, b.photo, b.ville, b.sorties, b.titre, b.type, b.artiste_id, true);

  select coalesce(max(numero), 0) into v_max from public.jeu_cartes;

  insert into public.jeu_cartes (artist_id, numero, rarete, fans, nom, handle, photo, ville, sorties, derniere, active, artiste_id, release_id, titre, type)
  select b.release_id, v_max + row_number() over (order by b.fans desc, b.sortie desc, b.titre, b.release_id), b.rarete, b.fans, b.nom, b.handle, b.photo, b.ville,
         b.sorties, b.derniere, true, b.artiste_id, b.release_id, b.titre, b.type
    from jeu_cartes_base b
   where not exists (select 1 from public.jeu_cartes c where c.release_id = b.release_id);

  -- les anciennes cartes d'artiste, et les sorties qui ne remplissent plus les conditions, sortent du jeu
  update public.jeu_cartes c set active = false
   where c.active and (c.release_id is null or not exists (select 1 from jeu_cartes_base b where b.release_id = c.release_id));

  -- chaque carte active est dans le pack principal (la rareté peut ensuite être réglée par l'équipe)
  insert into public.jeu_booster_cartes (booster_id, artist_id, numero, rarete)
  select 'principal', c.artist_id, c.numero, least(c.rarete, 4)::smallint
    from public.jeu_cartes c
   where c.active and exists (select 1 from public.jeu_boosters where id = 'principal')
     and not exists (select 1 from public.jeu_booster_cartes x where x.booster_id = 'principal' and x.artist_id = c.artist_id);

  select count(*) into v_n from public.jeu_cartes where active;
  return v_n;
end $$;

select public.jeu_cartes_rafraichir();

-- 3. Ce que les joueurs avaient : l'ancienne carte d'un artiste devient sa dernière sortie
create temporary table _vieux_nouveau as
select c.artist_id as vieux, n.artist_id as nouveau
  from public.jeu_cartes c
  cross join lateral (select x.artist_id from public.jeu_cartes x
                       where x.release_id is not null and x.artiste_id = c.artist_id and x.active
                       order by x.derniere ->> 'date' desc nulls last, x.numero limit 1) n
 where c.release_id is null;

insert into public.jeu_collection_b (user_id, booster_id, artist_id, holo, quantite, premiere_le)
select x.user_id, x.booster_id, m.nouveau, x.holo, x.quantite, x.premiere_le
  from public.jeu_collection_b x join _vieux_nouveau m on m.vieux = x.artist_id
on conflict (user_id, booster_id, artist_id, holo) do update set quantite = public.jeu_collection_b.quantite + excluded.quantite;
delete from public.jeu_collection_b x using _vieux_nouveau m where x.artist_id = m.vieux;

update public.jeu_exemplaires x set artist_id = m.nouveau from _vieux_nouveau m where x.artist_id = m.vieux;

insert into public.jeu_cartes_niveaux (user_id, booster_id, artist_id, niveau, etoiles, maj)
select x.user_id, x.booster_id, m.nouveau, x.niveau, x.etoiles, x.maj from public.jeu_cartes_niveaux x join _vieux_nouveau m on m.vieux = x.artist_id
on conflict (user_id, booster_id, artist_id) do update set niveau = greatest(public.jeu_cartes_niveaux.niveau, excluded.niveau), etoiles = greatest(public.jeu_cartes_niveaux.etoiles, excluded.etoiles);
delete from public.jeu_cartes_niveaux x using _vieux_nouveau m where x.artist_id = m.vieux;

update public.marche_annonces x set artist_id = m.nouveau from _vieux_nouveau m where x.artist_id = m.vieux;
update public.jeu_expeditions x set artist_id = m.nouveau from _vieux_nouveau m where x.artist_id = m.vieux;
update public.combat_equipes x set artist_id = m.nouveau from _vieux_nouveau m where x.artist_id = m.vieux;
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'marche_journal' and column_name = 'artist_id') then
    update public.marche_journal x set artist_id = m.nouveau from _vieux_nouveau m where x.artist_id = m.vieux;
  end if;
end $$;

-- les cartes des événements (ex. Vague Glaciale) passent sur la dernière sortie de l'artiste, avec leur rareté et leurs réglages
insert into public.jeu_booster_cartes (booster_id, artist_id, numero, rarete, son_titre, son_nom, son_debut, clip_id, clip_debut, clip_son, photo_perso, album_id)
select x.booster_id, m.nouveau, x.numero, x.rarete, x.son_titre, x.son_nom, x.son_debut, x.clip_id, x.clip_debut, x.clip_son, x.photo_perso, x.album_id
  from public.jeu_booster_cartes x join _vieux_nouveau m on m.vieux = x.artist_id
 where x.booster_id <> 'principal'
on conflict (booster_id, artist_id) do nothing;
delete from public.jeu_booster_cartes x using _vieux_nouveau m where x.artist_id = m.vieux;
drop table _vieux_nouveau;

-- 4. Le moteur et les lectures : la carte porte son titre ; l'album d'une carte est sa propre sortie
do $$
declare d text; r record; n integer := 0;
begin
  -- 4a. combat_identite : l'album d'une carte-sortie est celui de sa sortie
  d := pg_get_functiondef('public.combat_identite(uuid,integer,boolean,boolean,text,uuid,integer,integer)'::regprocedure);
  if position('c.release_id is not null then' in d) = 0 then
    if position(E'select a.* into al from public.jeu_booster_cartes bc join public.jeu_albums a on a.id = bc.album_id and a.actif\n     where bc.booster_id = p_booster and bc.artist_id = p_artist;' in d) = 0 then
      raise exception 'combat_identite : motif introuvable';
    end if;
    d := replace(d, E'select a.* into al from public.jeu_booster_cartes bc join public.jeu_albums a on a.id = bc.album_id and a.actif\n     where bc.booster_id = p_booster and bc.artist_id = p_artist;',
      E'if c.release_id is not null then\n      select a.* into al from public.jeu_albums a where a.release_id = c.release_id and a.actif limit 1;\n    else\n      select a.* into al from public.jeu_booster_cartes bc join public.jeu_albums a on a.id = bc.album_id and a.actif\n       where bc.booster_id = p_booster and bc.artist_id = p_artist;\n    end if;');
    execute d;
  end if;

  -- 4b. le JSON d'une carte : le titre et le type de la sortie
  d := pg_get_functiondef('public.jeu_carte_json(jeu_cartes,boolean,integer)'::regprocedure);
  if position('''titre'', c.titre' in d) = 0 then
    if position('''photo'', c.photo,' in d) = 0 then raise exception 'jeu_carte_json : motif introuvable'; end if;
    d := replace(d, '''photo'', c.photo,', '''photo'', c.photo, ''titre'', c.titre, ''type_sortie'', c.type,');
    execute d;
  end if;

  -- 4c. les recherches par artiste cherchent aussi dans le titre de la sortie (classeur, marché, console…)
  for r in select p.oid::regprocedure as sig, pg_get_functiondef(p.oid) as def
             from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
            where ns.nspname = 'public' and p.prosrc like '%public.norme_artiste(c.nom) like ''%'' || v_q || ''%''%' and p.prosrc not like '%c.titre%'
  loop
    d := replace(r.def, 'public.norme_artiste(c.nom) like ''%'' || v_q || ''%''',
                 '(public.norme_artiste(c.nom) like ''%'' || v_q || ''%'' or public.norme_artiste(coalesce(c.titre, '''')) like ''%'' || v_q || ''%'')');
    execute d; n := n + 1;
  end loop;
  raise notice 'recherches patchées : %', n;

  -- 4d. la rareté Spécial est permise dans toute collection d'événement
  d := pg_get_functiondef('public.jeu_equipe_cartes_ajouter(text,jsonb)'::regprocedure);
  if position('p_booster <> ''glaciale''' in d) > 0 then
    d := replace(d, 'p_booster <> ''glaciale''', 'p_booster = ''principal''');
    d := replace(d, 'La rareté Spécial est réservée à Vague Glaciale.', 'La rareté Spécial est réservée aux collections d''''événement.');
    execute d;
  end if;
end $$;

-- 4e. l'album d'une carte : pour une carte-sortie, c'est sa sortie (pochette, titres choisis comme attaques)
create or replace function public.jeu_album_carte_json(p_booster text, p_artist uuid) returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select coalesce((
    select case when c.release_id is not null then
      jsonb_build_object('album_id', a.id, 'album', c.titre, 'cover', c.photo, 'type', null, 'type_nom', null, 'couleur', null, 'icone', null,
        'attaques', coalesce((select jsonb_agg(z.nom order by q.o)
                                from jsonb_array_elements(a.attaques) with ordinality as q(id, o)
                                join lateral (select x ->> 'titre' as nom from jsonb_array_elements(a.titres) x where (x ->> 'id') = (q.id #>> '{}') limit 1) z on true), '[]'::jsonb))
    else coalesce((
      select jsonb_build_object('album_id', a2.id, 'album', s.track_title, 'cover', s.cover_url, 'type', a2.type, 'type_nom', t.nom, 'couleur', t.couleur, 'icone', t.icone,
               'attaques', coalesce((select jsonb_agg(z.nom order by q.o)
                                       from jsonb_array_elements(a2.attaques) with ordinality as q(id, o)
                                       join lateral (select x ->> 'titre' as nom from jsonb_array_elements(a2.titres) x where (x ->> 'id') = (q.id #>> '{}') limit 1) z on true), '[]'::jsonb))
        from public.jeu_booster_cartes x2
        join public.jeu_albums a2 on a2.id = x2.album_id
        join public.submissions s on s.id = a2.release_id
        left join public.combat_types t on t.id = a2.type
       where x2.booster_id = p_booster and x2.artist_id = p_artist), '{}'::jsonb) end
      from public.jeu_cartes c
      left join public.jeu_albums a on a.release_id = c.release_id and a.actif
     where c.artist_id = p_artist limit 1), '{}'::jsonb) $$;

-- 5. La console équipe : la liste d'une collection (limitée et cherchable pour le pack principal) et la recherche de cartes à ajouter
drop function if exists public.jeu_equipe_cartes(text);
create or replace function public.jeu_equipe_cartes(p_booster text, p_q text default null, p_limite integer default null) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare v_q text := nullif(public.norme_artiste(p_q), ''); v_lim integer;
begin
  if not public.est_equipe() then raise exception 'Réservé à l''équipe.'; end if;
  if not exists (select 1 from public.jeu_boosters where id = p_booster and classeur) then raise exception 'Collection introuvable.'; end if;
  v_lim := coalesce(p_limite, case when p_booster = 'principal' then 150 else 100000 end);
  return coalesce((select jsonb_agg(z.j order by z.numero, z.nom)
    from (select bc.numero, c.nom,
                 jsonb_build_object('artist_id', bc.artist_id, 'numero', bc.numero, 'rarete', bc.rarete, 'nom', c.nom, 'titre', c.titre, 'type', c.type,
                                    'photo', coalesce(bc.photo_perso, c.photo), 'photo_perso', bc.photo_perso is not null, 'fans', c.fans,
                                    'joueurs', coalesce(o.joueurs, 0), 'exemplaires', coalesce(o.exemplaires, 0), 'son_titre', bc.son_titre, 'son_nom', bc.son_nom,
                                    'son_debut', bc.son_debut, 'clip_id', bc.clip_id, 'clip_debut', bc.clip_debut, 'clip_son', bc.clip_son, 'album_id', bc.album_id,
                                    'carte_album', public.jeu_album_carte_json(bc.booster_id, bc.artist_id)) as j
            from public.jeu_booster_cartes bc
            left join public.jeu_cartes c on c.artist_id = bc.artist_id
            left join lateral (select count(distinct x.user_id)::integer as joueurs, sum(x.quantite)::integer as exemplaires from public.jeu_collection_b x
                                where x.booster_id = bc.booster_id and x.artist_id = bc.artist_id and x.quantite > 0) o on true
           where bc.booster_id = p_booster
             and (v_q is null or public.norme_artiste(c.nom) like '%' || v_q || '%' or public.norme_artiste(coalesce(c.titre, '')) like '%' || v_q || '%')
           order by bc.numero limit v_lim) z), '[]'::jsonb);
end $$;
revoke all on function public.jeu_equipe_cartes(text, text, integer) from public, anon;
grant execute on function public.jeu_equipe_cartes(text, text, integer) to authenticated;

create or replace function public.jeu_equipe_artistes(p_q text, p_booster text, p_limite integer default 30, p_decalage integer default 0) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare v_q text := nullif(public.norme_artiste(p_q), '');
begin
  if not public.est_equipe() then raise exception 'Réservé à l''équipe.'; end if;
  p_limite := least(greatest(coalesce(p_limite, 30), 1), 200);
  p_decalage := greatest(coalesce(p_decalage, 0), 0);
  return coalesce((select jsonb_agg(jsonb_build_object('artist_id', t.artist_id, 'nom', t.nom, 'titre', t.titre, 'type', t.type, 'photo', t.photo, 'fans', t.fans, 'deja', t.deja)
                          order by t.fans desc nulls last, t.sortie desc nulls last)
    from (select c.artist_id, c.nom, c.titre, c.type, c.photo, c.fans, c.derniere ->> 'date' as sortie,
                 exists (select 1 from public.jeu_booster_cartes bc where bc.booster_id = p_booster and bc.artist_id = c.artist_id) as deja
            from public.jeu_cartes c
           where c.active
             and (v_q is not null and (public.norme_artiste(c.nom) like '%' || v_q || '%' or public.norme_artiste(coalesce(c.titre, '')) like '%' || v_q || '%')
                  or v_q is null and not exists (select 1 from public.jeu_booster_cartes bc where bc.booster_id = p_booster and bc.artist_id = c.artist_id))
           order by c.fans desc nulls last, c.derniere ->> 'date' desc nulls last limit p_limite offset p_decalage) t), '[]'::jsonb);
end $$;

-- 6. Les titres des sorties (pour les attaques) : lus sur Deezer par une tâche de fond, les cartes possédées d'abord
create table if not exists public.jeu_albums_echecs (
  release_id uuid primary key, le timestamptz not null default now(), nb integer not null default 1
);
alter table public.jeu_albums_echecs enable row level security;
revoke all on table public.jeu_albums_echecs from anon, authenticated;

create or replace function public.jeu_albums_remplir(p_max integer default 5) returns integer
language plpgsql security definer set search_path to 'public', 'extensions' as $$
declare r record; v_dz bigint; v_titres jsonb; v_fait integer := 0;
begin
  if not pg_try_advisory_xact_lock(hashtext('jeu_albums_remplir')) then return 0; end if;
  for r in
    select distinct c.release_id, c.artiste_id
      from public.jeu_collection_b col
      join public.jeu_cartes c on c.artist_id = col.artist_id and c.release_id is not null and c.active
     where col.quantite > 0
       and not exists (select 1 from public.jeu_albums a where a.release_id = c.release_id)
       and not exists (select 1 from public.jeu_albums_echecs e where e.release_id = c.release_id and e.le > now() - interval '7 days')
     limit greatest(coalesce(p_max, 5), 1)
  loop
    begin
      select s.deezer_album_id into v_dz from public.submissions s where s.id = r.release_id;
      if v_dz is null then
        v_dz := public.jeu_album_deezer_trouver(r.release_id);
        if v_dz is not null then update public.submissions set deezer_album_id = v_dz where id = r.release_id and deezer_album_id is null; end if;
      end if;
      if v_dz is null then raise exception 'introuvable'; end if;
      v_titres := public.jeu_album_titres_charger(v_dz);
      if jsonb_array_length(v_titres) = 0 then raise exception 'vide'; end if;
      insert into public.jeu_albums (artist_id, release_id, titres, attaques, titres_le)
      values (r.artiste_id, r.release_id, v_titres, public.jeu_album_attaques_defaut(v_titres), now());
      v_fait := v_fait + 1;
    exception when others then
      insert into public.jeu_albums_echecs (release_id) values (r.release_id)
      on conflict (release_id) do update set le = now(), nb = public.jeu_albums_echecs.nb + 1;
    end;
  end loop;
  return v_fait;
end $$;
revoke all on function public.jeu_albums_remplir(integer) from public, anon, authenticated;

do $$ begin
  if not exists (select 1 from cron.job where jobname = 'albums-cartes') then
    perform cron.schedule('albums-cartes', '*/3 * * * *', 'select public.jeu_albums_remplir(5)');
  end if;
end $$;
