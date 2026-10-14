-- =====================================================================
-- La Wave — changer le profil Deezer d'un artiste
--
-- À passer après sql/deezer-featurings.sql. Ajoute une fonction que
-- l'onglet Artistes de l'espace équipe appelle quand on clique sur
-- « Changer de profil » : elle remplace le profil Deezer relié à un
-- artiste (un homonyme pris pour un autre, par exemple) par le bon.
--
--   relier_artiste_deezer(pseudo, id Deezer, photo, retirer)
--
-- Ce qu'elle fait, d'un seul bloc (tout ou rien) :
--
--   · si « retirer » est vrai (par défaut), les sorties que l'import avait
--     rangées chez cet artiste (source « deezer ») sont supprimées : elles
--     venaient du mauvais profil. Les sorties ajoutées à la main ne sont
--     jamais touchées. Les bonnes arrivent d'elles-mêmes au prochain
--     passage de l'import ;
--   · le bon profil Deezer est relié à l'artiste et suivi ;
--   · si ce profil Deezer existait déjà sur La Wave sous un profil créé
--     automatiquement par l'import (source « deezer-auto »), ce doublon est
--     fusionné : ses sorties et ses apparitions en featuring passent à
--     l'artiste, puis il disparaît. Un profil que l'équipe a ajouté ou
--     qu'un artiste a revendiqué n'est jamais fusionné : la fonction
--     refuse et dit lequel c'est ;
--   · la photo : si elle venait de Deezer (donc peut-être de l'homonyme),
--     elle est remplacée par celle du bon profil ; une photo ajoutée à la
--     main est gardée.
--
-- Réservée à l'équipe. Relançable : « create or replace ».
-- =====================================================================

begin;

do $$
begin

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'artists'
      and column_name = 'deezer_suivi'
  ) then
    raise exception
      'Exécute d''abord sql/deezer-featurings.sql : la colonne artists.deezer_suivi manque.';
  end if;

  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'est_equipe'
  ) then
    raise exception
      'La fonction est_equipe() manque : exécute sql/communaute.sql ou sql/acces-testeurs.sql.';
  end if;

end $$;


create or replace function public.relier_artiste_deezer(
  p_handle    text,
  p_deezer_id bigint,
  p_photo     text    default null,
  p_retirer   boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_a        public.artists;
  v_p        public.artists;
  v_nom      text;
  v_retires  integer := 0;
  v_fusion   integer := 0;
  v_photo    text    := nullif(btrim(coalesce(p_photo, '')), '');
  v_nouvelle text;
begin

  if not public.est_equipe() then
    raise exception 'Réservé à l''équipe.';
  end if;

  if p_deezer_id is null then
    raise exception 'Identifiant Deezer manquant.';
  end if;

  select * into v_a
    from public.artists a
   where a.instagram_handle = p_handle
   for update;

  if not found then
    raise exception 'Profil introuvable.';
  end if;

  if v_a.deezer_artist_id is not distinct from p_deezer_id then
    raise exception 'Cet artiste est déjà relié à ce profil Deezer.';
  end if;

  v_nom := coalesce(nullif(v_a.display_name, ''), v_a.instagram_handle);

  -- Ce profil Deezer est-il déjà sur La Wave, sous un autre nom ?
  select * into v_p
    from public.artists a
   where a.deezer_artist_id = p_deezer_id
     and a.id <> v_a.id
   limit 1;

  if found and (v_p.source is distinct from 'deezer-auto' or v_p.verifie_par is not null) then
    raise exception 'Ce profil Deezer est déjà relié à « % » : change d''abord le sien.',
      coalesce(nullif(v_p.display_name, ''), v_p.instagram_handle);
  end if;

  -- 1. Les sorties venues de l'ancien profil.
  if p_retirer then
    delete from public.submissions s
     where s.source = 'deezer'
       and s.artist_handle = v_a.instagram_handle;

    get diagnostics v_retires = row_count;
  end if;

  -- 2. Le doublon créé par l'import : ses sorties passent à l'artiste.
  if v_p.id is not null then

    update public.submissions s
       set artist_handle = v_a.instagram_handle,
           artist_name   = v_nom
     where s.artist_handle = v_p.instagram_handle;

    get diagnostics v_fusion = row_count;

    -- Les sorties où le doublon figure en featuring pointent maintenant
    -- vers l'artiste.
    update public.submissions s
       set featuring = (
             select coalesce(jsonb_agg(
                      case when e.value->>'handle' = v_p.instagram_handle
                           then jsonb_set(
                                  jsonb_set(e.value, '{handle}', to_jsonb(v_a.instagram_handle)),
                                  '{nom}', to_jsonb(v_nom))
                           else e.value end
                      order by e.ord), '[]'::jsonb)
               from jsonb_array_elements(s.featuring) with ordinality as e(value, ord)
           )
     where jsonb_typeof(s.featuring) = 'array'
       and s.featuring @> jsonb_build_array(jsonb_build_object('handle', v_p.instagram_handle));

    begin
      delete from public.artists where id = v_p.id;
    exception when foreign_key_violation then
      raise exception 'Le profil « % » est utilisé ailleurs sur le site : il ne peut pas être fusionné.',
        coalesce(nullif(v_p.display_name, ''), v_p.instagram_handle);
    end;

    -- Si l'artiste n'avait pas de photo, il prend celle du doublon.
    if v_photo is null and coalesce(v_a.photo_url, '') = '' then
      v_photo := nullif(btrim(coalesce(v_p.photo_url, '')), '');
    end if;

  end if;

  -- 3. La photo : celle de Deezer suit le profil, celle ajoutée à la main reste.
  v_nouvelle := v_a.photo_url;

  if coalesce(v_a.photo_url, '') = '' or v_a.photo_url like '%dzcdn.net%' then
    v_nouvelle := v_photo;
  end if;

  -- 4. Le lien, et le suivi dès le prochain passage.
  update public.artists
     set deezer_artist_id  = p_deezer_id,
         deezer_suivi      = true,
         deezer_verifie_le = null,
         photo_url         = v_nouvelle,
         updated_at        = now()
   where id = v_a.id;

  return jsonb_build_object(
    'handle',     v_a.instagram_handle,
    'nom',        v_nom,
    'retires',    v_retires,
    'fusionnees', v_fusion,
    'fusion_avec', case when v_p.id is not null
                        then coalesce(nullif(v_p.display_name, ''), v_p.instagram_handle) end,
    'photo',      v_nouvelle
  );

end $$;

revoke all on function public.relier_artiste_deezer(text, bigint, text, boolean)
  from public, anon;
grant execute on function public.relier_artiste_deezer(text, bigint, text, boolean)
  to authenticated;

notify pgrst, 'reload schema';

commit;
