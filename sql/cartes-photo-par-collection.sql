-- Wave Cards : la photo d'une carte se règle par collection (booster), pas pour toutes les collections de l'artiste.
-- Remplace cartes-special-photo.sql (partie « photo »). Sans danger si on le repasse.

alter table public.jeu_booster_cartes add column if not exists photo_perso text;

drop trigger if exists jeu_cartes_photo_perso on public.jeu_cartes;
drop function if exists public.jeu_cartes_photo_perso();

-- Les photos déjà choisies (Bekar, Zola) avaient été réglées dans Vague Glaciale : elles y restent, et seulement là.
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'jeu_cartes' and column_name = 'photo_perso') then
    update public.jeu_booster_cartes bc set photo_perso = c.photo_perso
      from public.jeu_cartes c
     where c.artist_id = bc.artist_id and c.photo_perso is not null and bc.booster_id = 'glaciale' and bc.photo_perso is null;
    -- les cartes de base reprennent la photo de l'artiste
    update public.jeu_cartes c
       set photo = coalesce((select a.photo_url from public.artists a where a.id = c.artist_id), c.photo)
     where c.photo_perso is not null;
  end if;
end $$;

create or replace function pg_temp.corriger(p_fn regprocedure, p_avant text, p_apres text) returns void
  language plpgsql as $$
declare v_def text := pg_get_functiondef(p_fn);
begin
  if position(p_avant in v_def) = 0 then raise exception 'Morceau introuvable dans % : %', p_fn, left(p_avant, 60); end if;
  execute replace(v_def, p_avant, p_apres);
end $$;

-- La console lit la photo de la carte dans la collection, et dit si elle est choisie.
select pg_temp.corriger('public.jeu_equipe_cartes(text)'::regprocedure,
  $a$'photo', c.photo, 'photo_perso', c.photo_perso is not null, 'fans'$a$,
  $b$'photo', coalesce(bc.photo_perso, c.photo), 'photo_perso', bc.photo_perso is not null, 'fans'$b$);

-- Une carte d'une collection porte la photo choisie pour cette collection (collection, ouverture, marché, fiche).
select pg_temp.corriger('public.jeu_carte_json_b(public.jeu_cartes, text, integer, integer, boolean, integer)'::regprocedure,
  $a$|| jsonb_build_object('rarete', p_rarete, 'numero', p_numero, 'classeur', p_booster)$a$,
  $b$|| jsonb_build_object('rarete', p_rarete, 'numero', p_numero, 'classeur', p_booster)
       || coalesce((select jsonb_build_object('photo', x.photo_perso) from public.jeu_booster_cartes x
                     where x.booster_id = p_booster and x.artist_id = c.artist_id and x.photo_perso is not null), '{}'::jsonb)$b$);

drop function if exists public.jeu_equipe_carte_photo(uuid, text);
create or replace function public.jeu_equipe_carte_photo(p_booster text, p_artist uuid, p_photo text) returns jsonb
  language plpgsql security definer set search_path to 'public'
as $$
declare v_photo text := nullif(btrim(coalesce(p_photo, '')), '');
begin
  if not public.est_equipe() then raise exception 'Réservé à l''équipe.'; end if;
  if v_photo is not null and (v_photo !~ '^https://[^[:space:]<>"'']+$' or length(v_photo) > 600) then
    raise exception 'Adresse d''image invalide : elle doit commencer par https://.';
  end if;
  update public.jeu_booster_cartes set photo_perso = v_photo where booster_id = p_booster and artist_id = p_artist;
  if not found then raise exception 'Cette carte n''est pas dans la collection.'; end if;

  perform public.jeu_equipe_noter('carte_photo', jsonb_build_object('booster', p_booster, 'artist', p_artist, 'perso', v_photo is not null));
  return jsonb_build_object('photo', coalesce(v_photo, (select photo from public.jeu_cartes where artist_id = p_artist)), 'perso', v_photo is not null);
end $$;

revoke all on function public.jeu_equipe_carte_photo(text, uuid, text) from public, anon;
grant execute on function public.jeu_equipe_carte_photo(text, uuid, text) to authenticated;

alter table public.jeu_cartes drop column if exists photo_perso;
