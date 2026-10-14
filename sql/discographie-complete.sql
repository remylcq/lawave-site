-- =====================================================================
-- La Wave — toutes les sorties de tous les artistes, suivies automatiquement
--
-- Deux choses, demandées ensemble :
--
--   1. SUIVRE TOUS LES ARTISTES. Plus de choix « suivre / ne plus suivre » :
--      tout artiste relié à Deezer (hors artistes bannis) est suivi, et ses
--      nouvelles sorties arrivent seules. (Les profils créés plus tard par un
--      featuring restent à part : sans cela, chaque invité deviendrait suivi à
--      son tour, avec ses propres invités, et l'import n'aurait plus de fin.
--      L'équipe qui ajoute un artiste le suit toujours.)
--
--   2. TOUTE LA DISCOGRAPHIE. importer_sorties_deezer gagne un dernier
--      paramètre, p_complet : à vrai, il lit tout ce que Deezer connaît de
--      l'artiste (et non plus les six derniers mois), une seule fois par
--      artiste (artists.deezer_complet_le), avec les mêmes règles qu'avant :
--      une pochette = une sortie, compilations et versions instrumentales
--      écartées, invités reliés à leurs profils. Les artistes trop longs à lire
--      sont repris au passage suivant ; un artiste en erreur attend deux heures.
--      Rien ne tourne seul tant que sql/discographie-planification.sql n'est pas
--      passé : le site doit d'abord savoir lire un catalogue de cette taille
--      (sql/catalogue-pagine.sql et la mise en ligne qui va avec).
--
-- Sans danger à rejouer.
-- =====================================================================

alter table public.artists
  add column if not exists deezer_complet_le       timestamptz,
  add column if not exists deezer_complet_essai_le timestamptz;

-- Chaque album lu est comparé aux sorties déjà connues du même artiste : sans cet index, ce serait un parcours de
-- toute la table à chaque album.
create index if not exists submissions_artist_handle_idx
  on public.submissions (artist_handle);


-- 1. Tous les artistes reliés à Deezer sont suivis.

update public.artists
   set deezer_suivi = true
 where deezer_artist_id is not null
   and not coalesce(banni, false)
   and deezer_suivi is distinct from true;


-- 2. L'import, avec la discographie complète.
-- (La signature change : l'ancienne disparaît, les tâches planifiées existantes
-- continuent d'appeler importer_sorties_deezer(20, false, 6), le dernier
-- paramètre ayant une valeur par défaut.)

drop function if exists public.importer_sorties_deezer(integer, boolean, integer, text);

create or replace function public.importer_sorties_deezer(
  p_lot    integer default 20,
  p_essai  boolean default false,
  p_mois   integer default 6,
  p_handle text    default null,
  p_complet boolean default false   -- NOUVEAU : toute la discographie, pas seulement les derniers mois
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_depuis      date := case when p_complet then date '1900-01-01'
                             else (current_date - make_interval(months => greatest(p_mois, 1)))::date end;
  v_debut       timestamptz := clock_timestamp();
  v_artiste     record;
  v_alb         jsonb;
  v_rep         http_response;
  v_json        jsonb;
  v_url         text;
  v_pages       integer;
  v_id          bigint;
  v_titre       text;
  v_norme       text;
  v_vus         text[];
  v_date_txt    text;
  v_date        date;
  -- Du type de la colonne, quel qu'il soit (texte ou énumération).
  v_type        public.submissions.release_type%type;
  v_cover       text;
  v_md5         text;
  v_empreintes  text[];
  v_lien        text;
  v_n           integer;
  v_ajout       integer;
  v_erreur      text;
  v_arret       boolean := false;
  v_nb_artistes integer := 0;
  v_nb_ajoutees integer := 0;
  v_nb_erreurs  integer := 0;
  v_nouvelles   jsonb   := '[]'::jsonb;
  v_problemes   jsonb   := '[]'::jsonb;
  v_resume      jsonb;
  -- NOUVEAU : l'artiste principal et les invités de la sortie en cours.
  v_credits     jsonb;
  v_prin        jsonb;
  v_prin_id     bigint;
  v_ligne       public.artists;
  v_inv         jsonb;
  v_handle      text;
  v_nom_prin    text;
  v_feats       jsonb;
  v_noms_feats  text[];
  v_arret_temps boolean := false;   -- NOUVEAU : cet artiste a pris trop de temps, on le reprend au passage suivant
begin

  -- Un seul passage à la fois : un essai lancé à la main pendant que le
  -- passage planifié tourne n'écrirait rien de plus, mais mieux vaut ne
  -- pas interroger Deezer deux fois pour la même chose.
  if not pg_try_advisory_xact_lock(hashtext('importer_sorties_deezer')) then
    return jsonb_build_object('ignore', 'un autre passage est déjà en cours');
  end if;

  -- Deezer répond en une fraction de seconde ; au-delà de dix, on laisse.
  begin
    perform http_set_curlopt('CURLOPT_TIMEOUT', '10');
  exception when others then
    null;
  end;

  for v_artiste in
    select a.id, a.instagram_handle, a.display_name, a.deezer_artist_id
      from public.artists a
     where a.deezer_artist_id is not null
       and a.deezer_suivi                                   -- NOUVEAU
       and (
             (p_handle is not null and a.instagram_handle = p_handle)
          or (p_handle is null and not p_complet
              and (a.deezer_verifie_le is null
                   or a.deezer_verifie_le < now() - interval '20 hours'))
          -- NOUVEAU : la discographie complète, une fois par artiste ; un artiste en erreur (ou repris faute de
          -- temps) attend son tour : ceux qu'on n'a pas encore essayés passent d'abord.
          or (p_handle is null and p_complet
              and a.deezer_complet_le is null
              and (a.deezer_complet_essai_le is null
                   or a.deezer_complet_essai_le < now() - interval '2 hours'))
           )
     order by case when p_complet then a.deezer_complet_essai_le else a.deezer_verifie_le end nulls first, a.id
     limit greatest(p_lot, 1)
  loop

    -- NOUVEAU : chaque sortie coûte désormais une requête de plus ; au-delà
    -- de 75 secondes, les artistes restants attendent le passage suivant.
    exit when v_arret or clock_timestamp() - v_debut > interval '75 seconds';

    v_nb_artistes := v_nb_artistes + 1;
    v_erreur  := null;
    v_ajout   := 0;
    v_vus     := '{}';
    v_empreintes := '{}';
    v_pages   := 0;
    v_arret_temps := false;
    v_url     := 'https://api.deezer.com/artist/' || v_artiste.deezer_artist_id
                 || '/albums?limit=100';

    -- Tout ce qui concerne un artiste tient dans ce bloc : si quelque
    -- chose casse, ses ajouts sont annulés et on passe au suivant.
    begin

      while v_url is not null and v_pages < (case when p_complet then 30 else 8 end)
            and not v_arret and not v_arret_temps loop

        v_pages := v_pages + 1;
        v_json  := null;

        begin
          v_rep := http_get(v_url);
          if v_rep.status <> 200 then
            raise exception 'Deezer a répondu HTTP %', v_rep.status;
          end if;
          v_json := v_rep.content::jsonb;
        exception when others then
          v_erreur := sqlerrm;
          v_json   := null;
        end;

        -- Deezer limite à 50 requêtes toutes les 5 secondes.
        perform pg_sleep(0.25);

        exit when v_json is null;

        if (v_json->'error') is not null then
          if (v_json->'error'->>'code') = '4' then
            v_arret := true;
          end if;
          v_erreur := coalesce(v_json->'error'->>'message', 'erreur renvoyée par Deezer');
          exit;
        end if;

        -- Les albums et les EP d'abord, puis les singles : quand un album
        -- et ses singles partagent la même pochette, c'est l'album qui
        -- reste (voir « même pochette » plus bas). Ensuite du plus ancien
        -- au plus récent ; à titre égal, l'édition explicite d'abord
        -- (c'est l'originale, pour le rap).
        for v_alb in
          select e.value
            from jsonb_array_elements(coalesce(v_json->'data', '[]'::jsonb)) as e
           order by (e.value->>'record_type') = 'single',
                    e.value->>'release_date',
                    e.value->>'explicit_lyrics' desc,
                    e.value->>'id'
        loop

          -- NOUVEAU : une discographie peut compter des centaines d'albums, chacun coûte une requête : au-delà de
          -- 100 secondes, on s'arrête ; l'artiste sera repris (les albums déjà ajoutés sont reconnus).
          if clock_timestamp() - v_debut > interval '100 seconds' then
            v_arret_temps := true;
            exit;
          end if;

          v_date := null;
          v_date_txt := v_alb->>'release_date';

          if v_date_txt ~ '^\d{4}-\d{2}-\d{2}$' and v_date_txt <> '0000-00-00' then
            begin
              v_date := v_date_txt::date;
            exception when others then
              v_date := null;
            end;
          end if;

          continue when v_date is null
                     or v_date < v_depuis
                     or v_date > current_date + 2;

          v_titre := btrim(coalesce(v_alb->>'title', ''));
          v_id    := (v_alb->>'id')::bigint;

          continue when v_titre = '' or v_id is null;

          -- Versions sans intérêt pour un catalogue de sorties.
          continue when v_titre ~* '(instrumental|karaok|a ?cappella)';

          v_cover := coalesce(
            nullif(v_alb->>'cover_big', ''),
            nullif(v_alb->>'cover_xl', ''),
            nullif(v_alb->>'cover_medium', ''),
            nullif(v_alb->>'cover', '')
          );

          -- Une adresse de pochette sans empreinte, c'est « pas d'image ».
          continue when v_cover is null or v_cover like '%/cover//%';

          v_norme := coalesce(nullif(public.titre_normalise(v_titre), ''), lower(v_titre));

          -- Déjà vu pendant ce passage (édition explicite / non explicite).
          continue when v_norme = any(v_vus);

          -- Déjà au catalogue : même identifiant Deezer…
          continue when exists (
            select 1 from public.submissions s
             where s.deezer_album_id = v_id
          );

          -- NOUVEAU : …ou écarté pour de bon lors d'un passage précédent.
          continue when exists (
            select 1 from public.deezer_albums_ignores i
             where i.deezer_album_id = v_id
          );

          -- …ou même titre pour le même artiste (sortie ajoutée à la
          -- main, ou autre édition de la même).
          continue when exists (
            select 1 from public.submissions s
             where s.artist_handle = v_artiste.instagram_handle
               and coalesce(nullif(public.titre_normalise(s.track_title), ''),
                            lower(s.track_title)) = v_norme
          );

          -- Même pochette = même sortie. Un artiste qui sort un album puis
          -- en détache les titres en singles leur garde la même image :
          -- un catalogue de pochettes n'a pas à la montrer huit fois.
          v_md5 := substring(v_cover from 'cover/([0-9a-f]{32})/');

          if v_md5 is not null then

            continue when v_md5 = any(v_empreintes);

            continue when exists (
              select 1 from public.submissions s
               where s.artist_handle = v_artiste.instagram_handle
                 and s.cover_url like ('%/cover/' || v_md5 || '/%')
            );

            v_empreintes := v_empreintes || v_md5;

          end if;

          -- ===== NOUVEAU : qui signe cette sortie, et avec qui ? =====
          --
          -- Deezer range parmi les albums d'un artiste ceux où il est
          -- seulement invité. L'album lui-même dit qui le signe et qui y
          -- participe.
          --
          -- Tout ce bloc, jusqu'à « fin du nouveau bloc », est protégé : si
          -- l'une de ses instructions échoue, seule CETTE sortie est
          -- laissée de côté (et signalée dans « problemes ») ; les autres
          -- sorties de l'artiste continuent d'entrer.
          begin

          v_credits := public.deezer_credits(v_id);

          if (v_credits->>'erreur') is not null then

            if (v_credits->>'quota') = 'true' then
              v_arret := true;
            end if;

            -- Pas de sortie sans ses invités : on la reprendra au prochain
            -- passage (l'artiste est revu dans l'heure). Un album que
            -- Deezer ne connaît plus n'est pas une erreur.
            if (v_credits->>'absent') is distinct from 'true' then
              v_erreur := coalesce(v_erreur, v_credits->>'erreur');
            end if;

            exit when v_arret;
            continue;

          end if;

          v_prin     := v_credits->'principal';
          v_prin_id  := (v_prin->>'id')::bigint;
          v_handle   := v_artiste.instagram_handle;
          v_nom_prin := v_artiste.display_name;

          if v_prin_id is distinct from v_artiste.deezer_artist_id then

            -- L'artiste suivi n'est qu'invité. Les compilations ne sont la
            -- sortie de personne : écartées, et retenues comme telles.
            if v_prin_id = 5080 or (v_prin->>'nom') ~* '^(various|compilation)' then

              if not p_essai then
                insert into public.deezer_albums_ignores (deezer_album_id, raison)
                values (v_id, 'compilation')
                on conflict do nothing;
              end if;

              continue;

            end if;

            select * into v_ligne
              from public.artists a
             where a.deezer_artist_id = v_prin_id
             limit 1;

            if found then

              -- Un artiste que l'import suit : sa sortie arrivera depuis sa
              -- propre page, avec ses invités.
              continue when v_ligne.deezer_suivi;

              v_handle   := v_ligne.instagram_handle;
              v_nom_prin := coalesce(nullif(v_ligne.display_name, ''), v_ligne.instagram_handle);

              -- Déjà chez lui : même titre, ou même pochette.
              continue when exists (
                select 1 from public.submissions s
                 where s.artist_handle = v_handle
                   and coalesce(nullif(public.titre_normalise(s.track_title), ''),
                                lower(s.track_title)) = v_norme
              ) or (v_md5 is not null and exists (
                select 1 from public.submissions s
                 where s.artist_handle = v_handle
                   and s.cover_url like ('%/cover/' || v_md5 || '/%')
              ));

            elsif p_essai then

              -- À blanc : on raconte, on ne crée rien.
              v_handle   := null;
              v_nom_prin := v_prin->>'nom';

            else

              v_ligne    := public.deezer_profil_artiste(v_prin_id, v_prin->>'nom', v_prin->>'photo');
              v_handle   := v_ligne.instagram_handle;
              v_nom_prin := coalesce(nullif(v_ligne.display_name, ''), v_ligne.instagram_handle);

            end if;

          end if;

          -- Les invités : un profil chacun, créé s'il manque.
          v_feats      := '[]'::jsonb;
          v_noms_feats := '{}';

          for v_inv in
            select e.value
              from jsonb_array_elements(coalesce(v_credits->'invites', '[]'::jsonb)) as e
          loop

            if p_essai then
              v_noms_feats := v_noms_feats || (v_inv->>'nom');
            else
              v_ligne := public.deezer_profil_artiste(
                (v_inv->>'id')::bigint, v_inv->>'nom', v_inv->>'photo'
              );

              v_feats := v_feats || jsonb_build_object(
                'nom',    coalesce(nullif(v_ligne.display_name, ''), v_inv->>'nom'),
                'handle', v_ligne.instagram_handle
              );

              v_noms_feats := v_noms_feats
                || coalesce(nullif(v_ligne.display_name, ''), v_inv->>'nom');
            end if;

          end loop;

          exception when others then
            v_erreur := coalesce(v_erreur, sqlerrm);
            continue;
          end;

          -- ===== fin du nouveau bloc =====

          v_vus  := v_vus || v_norme;
          v_type := case when lower(coalesce(v_alb->>'record_type', '')) = 'single'
                         then 'Single' else 'Projet' end;
          v_lien := coalesce(nullif(v_alb->>'link', ''),
                             'https://www.deezer.com/album/' || v_id);

          if p_essai then
            v_n := 1;
          else
            insert into public.submissions (
              artist_name, track_title, listen_url, deezer_url, cover_url,
              status, validated_at, created_at, updated_at,
              catalog_number, release_date, release_type,
              artist_handle, featuring, source, deezer_album_id,
              deezer_feat_le
            ) values (
              v_nom_prin, v_titre, v_lien, v_lien, v_cover,
              'approved', now(), now(), now(),
              nextval('public.catalogue_import_seq'), v_date, v_type,
              v_handle, v_feats, 'deezer', v_id,
              now()
            )
            on conflict do nothing;

            get diagnostics v_n = row_count;
          end if;

          v_ajout := v_ajout + v_n;

          if v_n > 0 and jsonb_array_length(v_nouvelles) < 40 then
            v_nouvelles := v_nouvelles || jsonb_build_object(
              'artiste', v_nom_prin,
              'titre',   v_titre,
              'date',    v_date,
              'type',    v_type,
              'avec',    to_jsonb(v_noms_feats)
            );
          end if;

        end loop;

        v_url := nullif(v_json->>'next', '');

      end loop;

    exception when others then
      v_erreur := sqlerrm;
      v_ajout  := 0;
    end;

    v_nb_ajoutees := v_nb_ajoutees + v_ajout;

    if v_erreur is not null then
      v_nb_erreurs := v_nb_erreurs + 1;
      if jsonb_array_length(v_problemes) < 20 then
        v_problemes := v_problemes || jsonb_build_object(
          'artiste', v_artiste.display_name,
          'erreur',  v_erreur
        );
      end if;
    end if;

    -- Vérifié maintenant ; en cas d'erreur, « vérifié il y a 19 heures »,
    -- donc revu dans l'heure plutôt que le lendemain. Après un quota
    -- dépassé, l'artiste n'a pas été vu : on n'y touche pas.
    if not p_essai and not v_arret and not v_arret_temps then
      update public.artists
         set deezer_verifie_le = case when v_erreur is null
                                      then now()
                                      else now() - interval '19 hours' end
       where id = v_artiste.id;
    end if;

    -- NOUVEAU : la discographie complète est faite quand tout a été lu sans erreur ; sinon l'artiste est repris.
    if p_complet and not p_essai and not v_arret then
      update public.artists
         set deezer_complet_essai_le = case when v_arret_temps then now() - interval '2 hours' else now() end,
             deezer_complet_le       = case when v_erreur is null and not v_arret_temps then now() else deezer_complet_le end
       where id = v_artiste.id;
    end if;

  end loop;

  v_resume := jsonb_build_object(
    'essai',         p_essai,
    'complet',       p_complet,
    'remonte_a',     v_depuis,
    'artistes',      v_nb_artistes,
    'ajoutees',      v_nb_ajoutees,
    'erreurs',       v_nb_erreurs,
    'quota_atteint', v_arret,
    'nouvelles',     v_nouvelles,
    'problemes',     v_problemes
  );

  if not p_essai and v_nb_artistes > 0 then
    insert into public.deezer_import_journal (artistes, ajoutees, erreurs, detail)
    values (v_nb_artistes, v_nb_ajoutees, v_nb_erreurs, v_resume);

    delete from public.deezer_import_journal
     where quand < now() - interval '60 days';
  end if;

  return v_resume;

end $$;

revoke all on function public.importer_sorties_deezer(integer, boolean, integer, text, boolean) from public, anon, authenticated;
