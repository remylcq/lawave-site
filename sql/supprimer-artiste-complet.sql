-- Supprimer un artiste (et un featuring) avec TOUTES ses sorties, y compris celles que le site masque (artiste non
-- francophone ou banni : la sécurité par ligne les cache à l'équipe, donc une suppression depuis le site ne les atteignait
-- pas et elles restaient en base). Réservé à l'équipe. (Passé en production le 2026-11-12.)
-- Retire les sorties du pseudo, et celles qui portent exactement le même nom d'artiste (sans tenir compte de la casse).
-- Renvoie les adresses d'images à effacer du stockage (le site s'en occupe : seules celles du bucket comptent).
-- RETRAIT : drop function public.supprimer_artiste_complet(text, text);

create or replace function public.supprimer_artiste_complet(p_handle text default null, p_nom text default null)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_handle text := nullif(btrim(coalesce(p_handle, '')), '');
  v_nom    text := nullif(btrim(coalesce(p_nom, '')), '');
  v_covers text[];
  v_n      integer := 0;
  v_photo  text;
  v_profil boolean := false;
begin
  if auth.uid() is null or not public.est_equipe() then
    raise exception 'Réservé à l''équipe.';
  end if;

  if v_handle is null and v_nom is null then
    raise exception 'Indique l''artiste.';
  end if;

  with d as (
    delete from public.submissions s
     where (v_handle is not null and s.artist_handle = v_handle)
        or (v_nom is not null and lower(btrim(s.artist_name)) = lower(v_nom))
    returning s.cover_url
  )
  select coalesce(array_agg(cover_url) filter (where cover_url is not null), '{}'), count(*) into v_covers, v_n from d;

  if v_handle is not null then
    delete from public.artists a where a.instagram_handle = v_handle returning a.photo_url into v_photo;
    v_profil := found;
  end if;

  return jsonb_build_object('sorties', v_n, 'covers', to_jsonb(v_covers), 'photo', v_photo, 'profil', v_profil);
end $$;

revoke all on function public.supprimer_artiste_complet(text, text) from public, anon;
grant execute on function public.supprimer_artiste_complet(text, text) to authenticated;
