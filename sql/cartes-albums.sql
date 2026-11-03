-- Wave Cards, étape 2 : les cartes d'album. Une carte d'album = un artiste + un de ses projets (sa cover, son type, ses titres) ;
-- ses attaques sont 1 à 3 titres du projet. L'équipe les crée et les règle dans la console (section « Albums »).
-- Cette étape ne change pas encore le jeu : les collections, les tirages et le combat s'y brancheront à l'étape suivante.
-- Sans danger si on le repasse.

create table if not exists public.jeu_albums (
  id uuid primary key default gen_random_uuid(),
  artist_id uuid not null references public.jeu_cartes(artist_id) on delete cascade,
  release_id uuid not null references public.submissions(id) on delete cascade,
  type text references public.combat_types(id) on update cascade on delete set null,
  titres jsonb not null default '[]'::jsonb,     -- [{id, titre, rang, duree, pos}] : la liste des titres du projet (Deezer)
  attaques jsonb not null default '[]'::jsonb,   -- les identifiants des titres choisis comme attaques (1 à 3)
  titres_le timestamptz,
  actif boolean not null default true,
  cree_le timestamptz not null default now(),
  unique (artist_id, release_id)
);
create index if not exists jeu_albums_artist_idx on public.jeu_albums (artist_id);
alter table public.jeu_albums enable row level security;

-- Les titres d'un projet, lus chez Deezer (interne : appelée seulement par les fonctions ci-dessous).
create or replace function public.jeu_album_titres_charger(p_deezer bigint) returns jsonb
language plpgsql security definer set search_path to 'public', 'extensions' as $$
declare v_rep http_response; v_json jsonb; v_out jsonb;
begin
  begin
    v_rep := http_get('https://api.deezer.com/album/' || p_deezer::text || '/tracks?limit=100');
    perform pg_sleep(0.25);
  exception when others then
    raise exception 'Deezer ne répond pas : %', sqlerrm;
  end;
  if v_rep.status <> 200 then raise exception 'Deezer a répondu HTTP %.', v_rep.status; end if;
  v_json := v_rep.content::jsonb;
  if (v_json -> 'error') is not null then raise exception 'Deezer : %', coalesce(v_json -> 'error' ->> 'message', 'erreur'); end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', (e.value ->> 'id')::bigint, 'titre', btrim(e.value ->> 'title'),
           'rang', coalesce((e.value ->> 'rank')::bigint, 0), 'duree', coalesce((e.value ->> 'duration')::integer, 0),
           'pos', coalesce((e.value ->> 'track_position')::integer, 0))
         order by coalesce((e.value ->> 'disk_number')::integer, 1), coalesce((e.value ->> 'track_position')::integer, 0), e.ordinality), '[]'::jsonb)
    into v_out
    from jsonb_array_elements(coalesce(v_json -> 'data', '[]'::jsonb)) with ordinality as e(value, ordinality)
   where nullif(e.value ->> 'id', '') is not null and btrim(coalesce(e.value ->> 'title', '')) <> '';
  return v_out;
end $$;

-- Les trois titres les plus écoutés : les attaques par défaut.
create or replace function public.jeu_album_attaques_defaut(p_titres jsonb) returns jsonb
language sql immutable set search_path to 'public' as $$
  select coalesce(jsonb_agg(x.id order by x.rang desc, x.pos), '[]'::jsonb)
    from (select (t ->> 'id')::bigint as id, (t ->> 'rang')::bigint as rang, (t ->> 'pos')::integer as pos
            from jsonb_array_elements(p_titres) t order by (t ->> 'rang')::bigint desc, (t ->> 'pos')::integer limit 3) x $$;

-- Une carte d'album, prête à afficher.
create or replace function public.jeu_album_json(p_id uuid) returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
      'id', a.id, 'artist_id', a.artist_id, 'artiste', c.nom, 'photo', c.photo,
      'release_id', a.release_id, 'album', s.track_title, 'cover', s.cover_url, 'date', s.release_date, 'sortie', s.release_type,
      'type', a.type, 'type_nom', t.nom, 'couleur', t.couleur, 'icone', t.icone,
      'titres', a.titres, 'attaques', a.attaques, 'nb_titres', jsonb_array_length(a.titres), 'actif', a.actif)
    from public.jeu_albums a
    join public.jeu_cartes c on c.artist_id = a.artist_id
    join public.submissions s on s.id = a.release_id
    left join public.combat_types t on t.id = a.type
   where a.id = p_id $$;

-- Chercher un artiste (nom ou pseudo) : combien de projets il a, combien ont déjà une carte.
create or replace function public.jeu_equipe_albums_artistes(p_q text) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare v_q text := btrim(coalesce(p_q, ''));
begin
  if not public.est_equipe() then raise exception 'Réservé à l''équipe.'; end if;
  return coalesce((select jsonb_agg(x order by x.fans desc) from (
    select jsonb_build_object('artist_id', c.artist_id, 'nom', c.nom, 'photo', c.photo, 'fans', c.fans,
             'projets', (select count(*) from public.submissions s where s.artist_handle = c.handle and s.status = 'approved' and not s.banni and not s.hors_langue and s.release_type = 'Projet' and s.deezer_album_id is not null),
             'cartes', (select count(*) from public.jeu_albums a where a.artist_id = c.artist_id)) as x, c.fans
      from public.jeu_cartes c
     where c.active and (v_q = '' or c.nom ilike '%' || v_q || '%' or c.handle ilike '%' || v_q || '%')
     order by c.fans desc limit 12) q), '[]'::jsonb);
end $$;

-- Les projets d'un artiste (les albums et EP ; les singles en option), avec la carte déjà créée s'il y en a une.
create or replace function public.jeu_equipe_albums_projets(p_artist uuid, p_singles boolean default false) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not public.est_equipe() then raise exception 'Réservé à l''équipe.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('release', s.id, 'titre', s.track_title, 'cover', s.cover_url, 'date', s.release_date,
                    'sortie', s.release_type, 'carte', a.id) order by s.release_date desc nulls last, s.created_at desc)
    from public.jeu_cartes c
    join public.submissions s on s.artist_handle = c.handle and s.status = 'approved' and not s.banni and not s.hors_langue
         and s.deezer_album_id is not null and s.release_date <= public.xp_jour() and (s.release_type = 'Projet' or coalesce(p_singles, false))
    left join public.jeu_albums a on a.release_id = s.id and a.artist_id = c.artist_id
   where c.artist_id = p_artist), '[]'::jsonb);
end $$;

-- Créer la carte d'un projet : ses titres sont lus chez Deezer, ses trois titres les plus écoutés deviennent ses attaques.
create or replace function public.jeu_equipe_album_ajouter(p_release uuid, p_type text default null) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare s public.submissions; v_artist uuid; v_titres jsonb; v_id uuid; v_type text := nullif(btrim(coalesce(p_type, '')), '');
begin
  if not public.est_equipe() then raise exception 'Réservé à l''équipe.'; end if;
  select * into s from public.submissions where id = p_release and status = 'approved' and not banni and not hors_langue;
  if not found or s.deezer_album_id is null then raise exception 'Ce projet n''est pas disponible.'; end if;
  select c.artist_id into v_artist from public.jeu_cartes c where c.handle = s.artist_handle;
  if v_artist is null then raise exception 'Cet artiste n''a pas de carte.'; end if;
  if v_type is not null and not exists (select 1 from public.combat_types where id = v_type) then raise exception 'Type inconnu.'; end if;
  if exists (select 1 from public.jeu_albums where artist_id = v_artist and release_id = p_release) then raise exception 'Cette carte existe déjà.'; end if;

  v_titres := public.jeu_album_titres_charger(s.deezer_album_id);
  if jsonb_array_length(v_titres) = 0 then raise exception 'Deezer ne renvoie aucun titre pour ce projet.'; end if;

  insert into public.jeu_albums (artist_id, release_id, type, titres, attaques, titres_le)
  values (v_artist, p_release, v_type, v_titres, public.jeu_album_attaques_defaut(v_titres), now())
  returning id into v_id;
  perform public.jeu_equipe_noter('album_ajouter', jsonb_build_object('album', v_id, 'release', p_release, 'type', v_type));
  return public.jeu_album_json(v_id);
end $$;

-- La liste des cartes d'album (recherche par artiste ou album, filtre par type).
create or replace function public.jeu_equipe_albums_lire(p_q text default null, p_type text default null) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare v_q text := btrim(coalesce(p_q, ''));
begin
  if not public.est_equipe() then raise exception 'Réservé à l''équipe.'; end if;
  return jsonb_build_object(
    'total', (select count(*) from public.jeu_albums),
    'sans_type', (select count(*) from public.jeu_albums where type is null),
    'cartes', coalesce((select jsonb_agg(public.jeu_album_json(x.id) order by x.cree_le desc) from (
        select a.id, a.cree_le from public.jeu_albums a
          join public.jeu_cartes c on c.artist_id = a.artist_id
          join public.submissions s on s.id = a.release_id
         where (v_q = '' or c.nom ilike '%' || v_q || '%' or s.track_title ilike '%' || v_q || '%')
           and (nullif(p_type, '') is null or (p_type = '-' and a.type is null) or a.type = p_type)
         order by a.cree_le desc limit 200) x), '[]'::jsonb));
end $$;

-- Régler une carte : son type, ses attaques (1 à 3 titres du projet), active ou non.
create or replace function public.jeu_equipe_album_regler(p_id uuid, p_champs jsonb) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare a public.jeu_albums; v_att jsonb; v_ok integer; v_type text;
begin
  if not public.est_equipe() then raise exception 'Réservé à l''équipe.'; end if;
  select * into a from public.jeu_albums where id = p_id;
  if not found then raise exception 'Carte inconnue.'; end if;
  if p_champs ? 'type' then
    v_type := nullif(btrim(coalesce(p_champs ->> 'type', '')), '');
    if v_type is not null and not exists (select 1 from public.combat_types where id = v_type) then raise exception 'Type inconnu.'; end if;
    update public.jeu_albums set type = v_type where id = p_id;
  end if;
  if p_champs ? 'attaques' then
    v_att := p_champs -> 'attaques';
    if jsonb_typeof(v_att) <> 'array' or jsonb_array_length(v_att) not between 1 and 3 then raise exception 'Choisis de 1 à 3 titres.'; end if;
    select count(distinct x.v) into v_ok from jsonb_array_elements_text(v_att) x(v)
      where exists (select 1 from jsonb_array_elements(a.titres) t where t ->> 'id' = x.v);
    if v_ok <> jsonb_array_length(v_att) or (select count(distinct v) from jsonb_array_elements_text(v_att) x(v)) <> jsonb_array_length(v_att) then
      raise exception 'Ces attaques doivent être des titres du projet, sans doublon.';
    end if;
    update public.jeu_albums set attaques = (select jsonb_agg(v::bigint) from jsonb_array_elements_text(v_att) x(v)) where id = p_id;
  end if;
  if p_champs ? 'actif' then update public.jeu_albums set actif = coalesce((p_champs ->> 'actif')::boolean, actif) where id = p_id; end if;
  perform public.jeu_equipe_noter('album_regler', jsonb_build_object('album', p_id, 'champs', p_champs));
  return public.jeu_album_json(p_id);
end $$;

-- Relire les titres chez Deezer (un titre ajouté ou renommé) ; les attaques choisies sont gardées tant que leur titre existe.
create or replace function public.jeu_equipe_album_titres(p_id uuid) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare a public.jeu_albums; s public.submissions; v_titres jsonb; v_garde jsonb;
begin
  if not public.est_equipe() then raise exception 'Réservé à l''équipe.'; end if;
  select * into a from public.jeu_albums where id = p_id;
  if not found then raise exception 'Carte inconnue.'; end if;
  select * into s from public.submissions where id = a.release_id;
  v_titres := public.jeu_album_titres_charger(s.deezer_album_id);
  if jsonb_array_length(v_titres) = 0 then raise exception 'Deezer ne renvoie aucun titre pour ce projet.'; end if;
  select coalesce(jsonb_agg(x.v::bigint), '[]'::jsonb) into v_garde from jsonb_array_elements_text(a.attaques) x(v)
    where exists (select 1 from jsonb_array_elements(v_titres) t where t ->> 'id' = x.v);
  update public.jeu_albums set titres = v_titres, titres_le = now(),
         attaques = case when jsonb_array_length(v_garde) = 0 then public.jeu_album_attaques_defaut(v_titres) else v_garde end
   where id = p_id;
  return public.jeu_album_json(p_id);
end $$;

create or replace function public.jeu_equipe_album_retirer(p_id uuid) returns void
language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.est_equipe() then raise exception 'Réservé à l''équipe.'; end if;
  if not exists (select 1 from public.jeu_albums where id = p_id) then raise exception 'Carte inconnue.'; end if;
  delete from public.jeu_albums where id = p_id;
  perform public.jeu_equipe_noter('album_retirer', jsonb_build_object('album', p_id));
end $$;

revoke all on function public.jeu_album_titres_charger(bigint), public.jeu_album_attaques_defaut(jsonb), public.jeu_album_json(uuid),
  public.jeu_equipe_albums_artistes(text), public.jeu_equipe_albums_projets(uuid, boolean), public.jeu_equipe_album_ajouter(uuid, text),
  public.jeu_equipe_albums_lire(text, text), public.jeu_equipe_album_regler(uuid, jsonb), public.jeu_equipe_album_titres(uuid),
  public.jeu_equipe_album_retirer(uuid) from public, anon, authenticated;
grant execute on function public.jeu_equipe_albums_artistes(text), public.jeu_equipe_albums_projets(uuid, boolean), public.jeu_equipe_album_ajouter(uuid, text),
  public.jeu_equipe_albums_lire(text, text), public.jeu_equipe_album_regler(uuid, jsonb), public.jeu_equipe_album_titres(uuid),
  public.jeu_equipe_album_retirer(uuid) to authenticated;
