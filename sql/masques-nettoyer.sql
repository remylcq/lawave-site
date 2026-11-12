-- Les sorties des artistes masqués (non francophones, hors bannis) sont supprimées de la base, et leurs albums mis dans la
-- liste des ignorés pour que l'import ne les redépose pas. Les profils eux-mêmes restent (non francophone, non suivi) :
-- les supprimer les ferait recréer et reclasser à chaque passage de l'import. (Passé en production le 2026-11-12 : 3 291
-- sorties supprimées d'un coup, puis tâche planifiée toutes les 10 minutes pour les artistes écartés ensuite.)
-- Les sorties de membres (source nulle) ne sont jamais touchées par la tâche.
-- RETRAIT : select cron.unschedule('masques-nettoyer'); drop function public.masques_nettoyer();

create or replace function public.masques_nettoyer() returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_n integer;
begin
  if not pg_try_advisory_xact_lock(hashtext('masques_nettoyer')) then return jsonb_build_object('ignore', true); end if;
  create temp table if not exists tmp_masques_n (id uuid, deezer_album_id bigint) on commit drop;
  truncate tmp_masques_n;
  insert into tmp_masques_n
    select s.id, s.deezer_album_id from public.submissions s
      join public.artists a on a.instagram_handle = s.artist_handle
     where a.francophone is false and not coalesce(a.banni, false) and s.source = 'deezer'
     limit 5000;
  insert into public.deezer_albums_ignores (deezer_album_id, raison)
    select deezer_album_id, 'non francophone' from tmp_masques_n where deezer_album_id is not null on conflict do nothing;
  delete from public.submissions s using tmp_masques_n t where s.id = t.id;
  get diagnostics v_n = row_count;
  return jsonb_build_object('supprimees', v_n);
end $$;
revoke all on function public.masques_nettoyer() from public, anon, authenticated;

select cron.schedule('masques-nettoyer', '*/10 * * * *', $$ select public.masques_nettoyer(); $$);
