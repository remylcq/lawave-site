-- =====================================================================
-- La Wave — la photo de profil Deezer des artistes qui n'en ont pas
--
-- Pour chaque artiste relié à Deezer et sans photo de profil, la base
-- lit sa page Deezer et reprend sa photo de profil (500 × 500 px).
--
-- Ce qu'il faut savoir :
--
--   · ne sont concernés que les artistes SANS photo : une photo réglée
--     par l'équipe n'est jamais remplacée ;
--   · l'image reste chez Deezer, comme les pochettes du catalogue : le
--     site en garde seulement l'adresse. Pour en mettre une autre,
--     « Changer la photo » dans l'espace équipe, comme avant ;
--   · un artiste que Deezer ne montre qu'avec l'image par défaut (une
--     silhouette) ne reçoit rien : il reste sans photo, et le filtre
--     « Sans photo » de l'onglet Artistes permet de les retrouver ;
--   · une photo retirée ensuite dans l'espace équipe ne revient pas
--     toute seule : la base note, pour chaque artiste, qu'elle a déjà
--     regardé (artists.deezer_photo_le) ;
--   · un artiste relié à Deezer plus tard — ou ajouté par l'import —
--     est pris en charge au passage suivant : plus rien à relancer.
--
-- Ce fichier crée la colonne et la fonction, puis les fait tourner tout
-- seul : toutes les cinq minutes, quarante artistes. Pour les quelque
-- 430 artistes d'aujourd'hui, une petite heure ; ensuite la tâche ne
-- trouve plus rien à faire et ne coûte rien.
--
-- Avant, une seule fois (déjà fait pour l'import) :
--   Supabase → Database → Extensions → « http » et « pg_cron ».
--
-- À exécuter dans Supabase → SQL Editor, d'un seul bloc. Relançable :
-- tout est écrit pour ne rien écraser, et la tâche se remplace au lieu
-- de se doubler.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 0. Les prérequis
-- ---------------------------------------------------------------------

do $$
begin

  if not exists (select 1 from pg_extension where extname = 'http') then
    raise exception
      'L''extension « http » n''est pas active : Supabase → Database → Extensions → http, puis relance ce fichier.';
  end if;

  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise exception
      'L''extension « pg_cron » n''est pas active : Supabase → Database → Extensions → pg_cron, puis relance ce fichier.';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'artists'
      and column_name = 'deezer_artist_id'
  ) then
    raise exception
      'Exécute d''abord sql/deezer-artistes.sql : la colonne artists.deezer_artist_id manque.';
  end if;

end $$;


-- ---------------------------------------------------------------------
-- 1. La colonne
--
--   artists.deezer_photo_le   la dernière fois que la base a regardé la
--                             photo de cet artiste sur Deezer (vide =
--                             jamais). Un artiste déjà regardé n'est pas
--                             revu : c'est ce qui laisse à l'équipe le
--                             dernier mot sur une photo retirée.
-- ---------------------------------------------------------------------

alter table public.artists
  add column if not exists deezer_photo_le timestamptz;


-- ---------------------------------------------------------------------
-- 2. La fonction
--
-- importer_photos_deezer(p_lot, p_essai)
--
--   p_lot    combien d'artistes traiter à ce passage (40 par défaut) ;
--   p_essai  true : ne rien écrire, seulement raconter ce qui serait
--            fait.
--
-- Elle renvoie un résumé : combien de photos reprises (« photos »), combien
-- d'artistes que Deezer n'illustre pas (« sans_photo », avec leurs noms),
-- combien d'erreurs, et combien d'artistes restent à traiter
-- (« restantes »).
-- ---------------------------------------------------------------------

create or replace function public.importer_photos_deezer(
  p_lot   integer default 40,
  p_essai boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_debut       timestamptz := clock_timestamp();
  v_artiste     record;
  v_rep         http_response;
  v_json        jsonb;
  v_photo       text;
  v_arret       boolean := false;
  v_nb_traitees integer := 0;
  v_nb_photos   integer := 0;
  v_nb_sans     integer := 0;
  v_nb_erreurs  integer := 0;
  v_exemples    jsonb   := '[]'::jsonb;
  v_sans        jsonb   := '[]'::jsonb;
  v_problemes   jsonb   := '[]'::jsonb;
begin

  -- Un seul passage à la fois.
  if not pg_try_advisory_xact_lock(hashtext('importer_photos_deezer')) then
    return jsonb_build_object('ignore', 'un autre passage est déjà en cours');
  end if;

  begin
    perform http_set_curlopt('CURLOPT_TIMEOUT', '10');
  exception when others then
    null;
  end;

  -- Une photo déjà là vaut décision : on le note, pour qu'une photo
  -- retirée plus tard dans l'espace équipe ne soit pas remise d'office.
  if not p_essai then
    update public.artists
       set deezer_photo_le = now()
     where deezer_photo_le is null
       and photo_url is not null
       and btrim(photo_url) <> '';
  end if;

  -- Au hasard plutôt que dans l'ordre : un artiste dont la page répond mal
  -- ne peut pas occuper tous les passages et empêcher les autres.
  for v_artiste in
    select a.id, a.display_name, a.instagram_handle, a.deezer_artist_id
      from public.artists a
     where a.deezer_artist_id is not null
       and (a.photo_url is null or btrim(a.photo_url) = '')
       and a.deezer_photo_le is null
     order by random()
     limit greatest(p_lot, 1)
  loop

    exit when v_arret or clock_timestamp() - v_debut > interval '75 seconds';

    v_nb_traitees := v_nb_traitees + 1;
    v_photo := null;

    begin

      v_rep := http_get('https://api.deezer.com/artist/' || v_artiste.deezer_artist_id::text);

      -- Deezer limite à 50 requêtes toutes les 5 secondes.
      perform pg_sleep(0.25);

      if v_rep.status <> 200 then
        raise exception 'Deezer a répondu HTTP %', v_rep.status;
      end if;

      v_json := v_rep.content::jsonb;

      if (v_json->'error') is not null then

        -- Quota dépassé : on s'arrête, le passage suivant reprendra.
        if (v_json->'error'->>'code') = '4' then
          v_arret := true;
          raise exception 'quota Deezer atteint';
        end if;

        -- L'artiste n'existe plus chez Deezer : rien à reprendre, et inutile
        -- d'y revenir. Toute autre erreur : on y reviendra.
        if (v_json->'error'->>'code') is distinct from '800' then
          raise exception '%', coalesce(v_json->'error'->>'message', 'erreur renvoyée par Deezer');
        end if;

      else

        v_photo := coalesce(
          nullif(v_json->>'picture_big', ''),
          nullif(v_json->>'picture_xl', ''),
          nullif(v_json->>'picture_medium', '')
        );

        -- L'image par défaut de Deezer (un artiste sans photo) a une adresse
        -- sans empreinte : « …/artist//500x500… ». Ce n'est pas une photo.
        if v_photo like '%/artist//%' then
          v_photo := null;
        end if;

      end if;

      if not p_essai then
        update public.artists
           set photo_url = case when photo_url is null or btrim(photo_url) = ''
                                then v_photo else photo_url end,
               updated_at = case when v_photo is not null then now() else updated_at end,
               deezer_photo_le = now()
         where id = v_artiste.id;
      end if;

      if v_photo is not null then
        v_nb_photos := v_nb_photos + 1;
        if jsonb_array_length(v_exemples) < 10 then
          v_exemples := v_exemples || jsonb_build_object(
            'artiste', v_artiste.display_name,
            'photo',   v_photo
          );
        end if;
      else
        v_nb_sans := v_nb_sans + 1;
        if jsonb_array_length(v_sans) < 60 then
          v_sans := v_sans || to_jsonb(coalesce(v_artiste.display_name, v_artiste.instagram_handle));
        end if;
      end if;

    exception when others then

      -- Une erreur sur un artiste ne touche pas les autres : il sera revu
      -- à un prochain passage (il n'est pas marqué comme regardé).
      v_nb_erreurs := v_nb_erreurs + 1;

      if jsonb_array_length(v_problemes) < 20 then
        v_problemes := v_problemes || jsonb_build_object(
          'artiste', coalesce(v_artiste.display_name, v_artiste.instagram_handle),
          'erreur',  sqlerrm
        );
      end if;

    end;

  end loop;

  return jsonb_build_object(
    'essai',      p_essai,
    'traitees',   v_nb_traitees,
    'photos',     v_nb_photos,
    'sans_photo', v_nb_sans,
    'erreurs',    v_nb_erreurs,
    'quota_atteint', v_arret,
    'exemples',   v_exemples,
    'sans_photo_noms', v_sans,
    'problemes',  v_problemes,
    'restantes',  (select count(*)
                     from public.artists a
                    where a.deezer_artist_id is not null
                      and (a.photo_url is null or btrim(a.photo_url) = '')
                      and a.deezer_photo_le is null)
  );

end $$;

-- Personne d'autre que la base ne doit pouvoir la déclencher.
revoke all on function public.importer_photos_deezer(integer, boolean)
  from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 3. La tâche
--
--   '*/5 * * * *'   toutes les cinq minutes ;
--   40              artistes traités à chaque passage ;
--   false           pour de vrai (true = à blanc, ne rien écrire).
--
-- Les passages qui n'ont plus d'artiste à traiter ne font rien et ne
-- coûtent rien. Le nom de la tâche la remplace au lieu de la doubler.
-- ---------------------------------------------------------------------

select cron.schedule(
  'deezer-photos-artistes',
  '*/5 * * * *',
  $$ select public.importer_photos_deezer(40, false); $$
);


-- ---------------------------------------------------------------------
-- Vérification
--
-- Les artistes reliés à Deezer, avec ou sans photo. « sans photo » doit
-- baisser de quarante tous les cinq minutes, jusqu'à ne garder que ceux
-- que Deezer n'illustre pas. La dernière ligne doit montrer la tâche
-- active.
-- ---------------------------------------------------------------------

select 'artistes reliés à Deezer' as quoi, count(*)::text as valeur
from public.artists
where deezer_artist_id is not null
union all
select 'dont avec photo', count(*)::text
from public.artists
where deezer_artist_id is not null
  and photo_url is not null and btrim(photo_url) <> ''
union all
select 'dont sans photo', count(*)::text
from public.artists
where deezer_artist_id is not null
  and (photo_url is null or btrim(photo_url) = '')
union all
select 'tâche planifiée (active)', coalesce(string_agg(active::text, ''), 'aucune')
from cron.job
where jobname = 'deezer-photos-artistes';


-- ---------------------------------------------------------------------
-- Pour regarder avant de lancer (à exécuter à part, avant ce fichier ou
-- après l'avoir retiré de la planification) :
--
--   select public.importer_photos_deezer(5, true);
--
-- « exemples » montre cinq artistes et la photo qu'ils recevraient ;
-- rien n'est écrit.
--
-- ---------------------------------------------------------------------
-- Pour suivre le travail, quand tu veux
--
--   -- Combien d'artistes restent à traiter :
--   select count(*) from public.artists
--   where deezer_artist_id is not null
--     and (photo_url is null or btrim(photo_url) = '')
--     and deezer_photo_le is null;
--
--   -- Les artistes que Deezer n'illustre pas (à compléter à la main) :
--   select display_name, instagram_handle from public.artists
--   where deezer_artist_id is not null
--     and (photo_url is null or btrim(photo_url) = '')
--     and deezer_photo_le is not null
--   order by display_name;
--
-- ---------------------------------------------------------------------
-- Pour arrêter, sans rien supprimer de ce qui a été repris
--
--   select cron.unschedule('deezer-photos-artistes');
--
-- Pour retirer d'un coup toutes les photos reprises de Deezer (celles
-- que l'équipe a réglées elle-même, hébergées sur le site, ne sont pas
-- touchées) :
--
--   update public.artists set photo_url = null
--   where photo_url like '%dzcdn.net/images/artist/%';
-- ---------------------------------------------------------------------
