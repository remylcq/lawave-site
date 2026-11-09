-- Wave Cards : choisir l'album d'une carte même quand la sortie n'a pas encore d'identifiant Deezer (2026-11-09).
-- Avant : seuls les projets avec deezer_album_id apparaissaient (Bekar : « Boréal » seulement ; ses autres projets, ajoutés à la main avec un lien Spotify, étaient absents).
-- Maintenant : tous les projets sortis apparaissent. À l'enregistrement, si l'identifiant Deezer manque, il est cherché sur Deezer (artiste + titre identiques,
-- sans tenir compte des accents ni de la ponctuation), gardé sur la sortie, puis les titres sont lus comme d'habitude.
-- Sans danger si on le repasse.

create or replace function public.jeu_norme_titre(p_texte text) returns text
language sql immutable set search_path to 'public' as $$
  select regexp_replace(lower(translate(coalesce(p_texte, ''), 'àâäáãéèêëíîïìóôöòõúùûüçñÀÂÄÉÈÊËÎÏÔÖÙÛÜÇ', 'aaaaaeeeeiiiiooooouuuucnaaaeeeeiioouuuc')), '[^a-z0-9]+', '', 'g') $$;

-- Cherche l'album d'une sortie sur Deezer : l'identifiant, ou null s'il n'y est pas
create or replace function public.jeu_album_deezer_trouver(p_release uuid) returns bigint
language plpgsql security definer set search_path to 'public', 'extensions' as $$
declare
  s public.submissions; v_rep http_response; v_json jsonb; e jsonb; q text; v_titre text; v_art text;
begin
  select * into s from public.submissions where id = p_release;
  if not found then return null; end if;
  v_titre := public.jeu_norme_titre(s.track_title); v_art := public.jeu_norme_titre(s.artist_name);
  if v_titre = '' or v_art = '' then return null; end if;
  foreach q in array array['artist:"' || s.artist_name || '" album:"' || s.track_title || '"', s.artist_name || ' ' || s.track_title] loop
    begin
      v_rep := http_get('https://api.deezer.com/search/album?limit=25&q=' || urlencode(q));
      perform pg_sleep(0.25);
    exception when others then
      raise exception 'Deezer ne répond pas : %', sqlerrm;
    end;
    continue when v_rep.status <> 200;
    v_json := v_rep.content::jsonb;
    for e in select value from jsonb_array_elements(coalesce(v_json -> 'data', '[]'::jsonb)) loop
      if public.jeu_norme_titre(e ->> 'title') = v_titre and public.jeu_norme_titre(e -> 'artist' ->> 'name') = v_art and nullif(e ->> 'id', '') is not null then
        return (e ->> 'id')::bigint;
      end if;
    end loop;
  end loop;
  return null;
end $$;

-- Les projets d'un artiste : tous ceux qui sont sortis (avec ou sans identifiant Deezer)
create or replace function public.jeu_equipe_albums_projets(p_artist uuid, p_singles boolean default false) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not public.est_equipe() then raise exception 'Réservé à l''équipe.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('release', s.id, 'titre', s.track_title, 'cover', s.cover_url, 'date', s.release_date,
                    'sortie', s.release_type, 'carte', a.id, 'sans_deezer', s.deezer_album_id is null) order by s.release_date desc nulls last, s.created_at desc)
    from public.jeu_cartes c
    join public.submissions s on s.artist_handle = c.handle and s.status = 'approved' and not s.banni and not s.hors_langue
         and s.release_date <= public.xp_jour() and (s.release_type = 'Projet' or coalesce(p_singles, false))
    left join public.jeu_albums a on a.release_id = s.id and a.artist_id = c.artist_id
   where c.artist_id = p_artist), '[]'::jsonb);
end $$;

-- Créer la carte d'album d'une sortie : l'identifiant Deezer est cherché s'il manque
create or replace function public.jeu_equipe_album_ajouter(p_release uuid, p_type text default null) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare s public.submissions; v_artist uuid; v_titres jsonb; v_id uuid; v_type text := nullif(btrim(coalesce(p_type, '')), ''); v_dz bigint;
begin
  if not public.est_equipe() then raise exception 'Réservé à l''équipe.'; end if;
  select * into s from public.submissions where id = p_release and status = 'approved' and not banni and not hors_langue;
  if not found then raise exception 'Ce projet n''est pas disponible.'; end if;
  select c.artist_id into v_artist from public.jeu_cartes c where c.handle = s.artist_handle;
  if v_artist is null then raise exception 'Cet artiste n''a pas de carte.'; end if;
  if v_type is not null and not exists (select 1 from public.combat_types where id = v_type) then raise exception 'Type inconnu.'; end if;
  if exists (select 1 from public.jeu_albums where artist_id = v_artist and release_id = p_release) then raise exception 'Cette carte existe déjà.'; end if;

  v_dz := s.deezer_album_id;
  if v_dz is null then
    v_dz := public.jeu_album_deezer_trouver(p_release);
    if v_dz is null then raise exception '« % » est introuvable sur Deezer : ses titres ne peuvent pas être lus.', s.track_title; end if;
    update public.submissions set deezer_album_id = v_dz where id = p_release and deezer_album_id is null;
  end if;

  v_titres := public.jeu_album_titres_charger(v_dz);
  if jsonb_array_length(v_titres) = 0 then raise exception 'Deezer ne renvoie aucun titre pour ce projet.'; end if;

  insert into public.jeu_albums (artist_id, release_id, type, titres, attaques, titres_le)
  values (v_artist, p_release, v_type, v_titres, public.jeu_album_attaques_defaut(v_titres), now())
  returning id into v_id;
  perform public.jeu_equipe_noter('album_ajouter', jsonb_build_object('album', v_id, 'release', p_release, 'type', v_type));
  return public.jeu_album_json(v_id);
end $$;

revoke all on function public.jeu_norme_titre(text), public.jeu_album_deezer_trouver(uuid) from public, anon, authenticated;
