-- =====================================================================
-- La Wave — importer les sorties depuis Deezer
--
-- Deuxième des trois fichiers de l'import quotidien :
--
--   1. sql/deezer-artistes.sql      — relie chaque artiste à sa page Deezer
--   2. sql/deezer-import.sql        — celui-ci : la fonction qui importe
--   3. sql/deezer-planification.sql — la lance toute seule, chaque jour
--
-- Deezer ne publie pas de flux « toutes les nouveautés » : on ne peut
-- que lui demander, artiste par artiste, ce qu'il a sorti. C'est aussi
-- ce que font les sites qui répertorient les sorties : ils suivent une
-- liste d'artistes. Ici, la liste est celle des artistes de La Wave.
--
-- Ce fichier ne lance rien : il pose le journal, la plage de numéros
-- et la fonction importer_sorties_deezer(). Rien n'entre au catalogue
-- avant que tu l'appelles toi-même (voir « Essai » en bas) ou que tu
-- exécutes le fichier 3.
--
-- Avant de l'exécuter, une seule fois :
--   Supabase → Database → Extensions → activer « http ».
--
-- À exécuter dans Supabase → SQL Editor, d'un seul bloc. Relançable :
-- tout est écrit pour ne rien écraser.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 0. Les prérequis
--
-- L'extension « http » permet à la base d'interroger Deezer elle-même :
-- aucun serveur, aucune clé, aucun mot de passe à garder. L'API de
-- Deezer est publique.
-- ---------------------------------------------------------------------

do $$
begin

  if not exists (select 1 from pg_extension where extname = 'http') then
    begin
      create extension http with schema extensions;
    exception when others then
      raise exception
        'L''extension « http » n''est pas active : Supabase → Database → Extensions → http, puis relance ce fichier.';
    end;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'submissions'
      and column_name = 'deezer_album_id'
  ) then
    raise exception
      'Exécute d''abord sql/deezer-artistes.sql : la colonne submissions.deezer_album_id manque.';
  end if;

end $$;


-- ---------------------------------------------------------------------
-- 1. Ce que l'import ne renseigne pas
--
-- Ni l'Instagram de l'artiste ni un email de contact : une sortie
-- importée n'a pas été déposée par quelqu'un. Le site écrit déjà null
-- dans ces colonnes en fonctionnement normal ; ce bloc s'assure
-- seulement qu'elles l'acceptent, comme sql/artists-instagram-facultatif.sql.
-- ---------------------------------------------------------------------

do $$
begin

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'submissions'
      and column_name = 'instagram_url' and is_nullable = 'NO'
  ) then
    alter table public.submissions alter column instagram_url drop not null;
    raise notice 'submissions.instagram_url : NOT NULL retiré.';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'submissions'
      and column_name = 'contact_email' and is_nullable = 'NO'
  ) then
    alter table public.submissions alter column contact_email drop not null;
    raise notice 'submissions.contact_email : NOT NULL retiré.';
  end if;

end $$;


-- ---------------------------------------------------------------------
-- 2. Le journal des passages
--
-- Une ligne par passage qui a trouvé des artistes à vérifier : combien
-- d'artistes, combien de sorties ajoutées, combien d'erreurs, et le
-- détail. Seul le SQL Editor peut le lire (RLS sans aucune règle).
-- ---------------------------------------------------------------------

create table if not exists public.deezer_import_journal (
  id        bigint generated always as identity primary key,
  quand     timestamptz not null default now(),
  artistes  integer     not null default 0,
  ajoutees  integer     not null default 0,
  erreurs   integer     not null default 0,
  detail    jsonb
);

alter table public.deezer_import_journal enable row level security;

revoke all on table public.deezer_import_journal from anon, authenticated;


-- ---------------------------------------------------------------------
-- 3. Les numéros de catalogue des sorties importées
--
-- Une plage à part, au-dessus de 100 000 : le site l'ignore quand il
-- attribue le numéro suivant d'une sortie de La Wave (voir
-- sql/import-source.sql). Une séquence plutôt que « le dernier + 1 »,
-- pour que deux passages simultanés ne donnent jamais le même numéro.
-- ---------------------------------------------------------------------

create sequence if not exists public.catalogue_import_seq start with 100001;

do $$
declare
  v_max bigint;
begin
  select max(catalog_number) into v_max
  from public.submissions
  where catalog_number > 100000;

  if v_max is not null then
    perform setval('public.catalogue_import_seq', v_max);
  end if;
end $$;


-- ---------------------------------------------------------------------
-- 4. Comparer deux titres
--
-- Pour ne pas importer une sortie que La Wave connaît déjà : ajoutée à
-- la main, ou sous une autre édition. Minuscules, accents retirés,
-- « (feat. …) » et « - Single » ignorés, ponctuation écrasée.
-- « Ma Chérie (feat. Gradur) » et « Ma cherie » donnent le même texte.
-- ---------------------------------------------------------------------

create or replace function public.titre_normalise(p_titre text)
returns text
language sql
immutable
as $$
  select btrim(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          translate(
            lower(coalesce(p_titre, '')),
            'àáâãäåçèéêëìíîïñòóôõöùúûüýÿœæ',
            'aaaaaaceeeeiiiinooooouuuuyyoa'
          ),
          '\s*[(\[]\s*(feat|ft|featuring|avec|with|prod)\y[^)\]]*[)\]]', ' ', 'g'
        ),
        '\s*-\s*(single|ep)\s*$', '', 'g'
      ),
      '[^a-z0-9]+', ' ', 'g'
    )
  );
$$;


-- ---------------------------------------------------------------------
-- 5. La fonction d'import
--
-- importer_sorties_deezer(p_lot, p_essai, p_mois, p_handle)
--
--   p_lot    combien d'artistes vérifier à ce passage (20 par défaut) ;
--   p_essai  true : ne rien écrire, seulement raconter ce qui serait
--            ajouté ;
--   p_mois   jusqu'où remonter, en mois (6 par défaut) ;
--   p_handle un seul artiste (son pseudo), pour un essai ciblé.
--
-- À chaque passage elle prend les artistes les plus anciennement
-- vérifiés — ceux qui ne l'ont pas été depuis 20 heures —, demande à
-- Deezer leurs albums, EP et singles, et ajoute ceux qui ne sont pas
-- encore au catalogue. Lancée toutes les vingt minutes, elle fait le
-- tour des artistes en une demi-journée au premier remplissage, puis
-- ne trouve plus grand-chose à faire : chaque artiste est revu une
-- fois par jour environ.
--
-- Ce qu'elle respecte :
--   · rien avant la date limite (p_mois) ni plus de deux jours après
--     aujourd'hui — le site masque de toute façon une sortie tant que
--     sa date n'est pas arrivée ;
--   · un titre déjà connu pour le même artiste n'est pas rajouté ;
--   · les versions instrumentales et karaoké sont ignorées ;
--   · une erreur sur un artiste n'arrête pas les autres : il sera
--     revu une heure plus tard ;
--   · si Deezer répond « quota dépassé », le passage s'arrête et reprend
--     au suivant.
--
-- Les sorties importées portent source = 'deezer' : c'est ce qui les
-- distingue de celles de La Wave, et ce qui permet de tout défaire.
-- ---------------------------------------------------------------------

create or replace function public.importer_sorties_deezer(
  p_lot    integer default 20,
  p_essai  boolean default false,
  p_mois   integer default 6,
  p_handle text    default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_depuis      date := (current_date - make_interval(months => greatest(p_mois, 1)))::date;
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
       and (
             (p_handle is not null and a.instagram_handle = p_handle)
          or (p_handle is null
              and (a.deezer_verifie_le is null
                   or a.deezer_verifie_le < now() - interval '20 hours'))
           )
     order by a.deezer_verifie_le nulls first, a.id
     limit greatest(p_lot, 1)
  loop

    exit when v_arret;

    v_nb_artistes := v_nb_artistes + 1;
    v_erreur  := null;
    v_ajout   := 0;
    v_vus     := '{}';
    v_pages   := 0;
    v_url     := 'https://api.deezer.com/artist/' || v_artiste.deezer_artist_id
                 || '/albums?limit=100';

    -- Tout ce qui concerne un artiste tient dans ce bloc : si quelque
    -- chose casse, ses ajouts sont annulés et on passe au suivant.
    begin

      while v_url is not null and v_pages < 8 loop

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

        -- Du plus ancien au plus récent ; à titre égal, l'édition
        -- explicite d'abord (c'est l'originale, pour le rap).
        for v_alb in
          select e.value
            from jsonb_array_elements(coalesce(v_json->'data', '[]'::jsonb)) as e
           order by e.value->>'release_date',
                    e.value->>'explicit_lyrics' desc,
                    e.value->>'id'
        loop

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

          -- …ou même titre pour le même artiste (sortie ajoutée à la
          -- main, ou autre édition de la même).
          continue when exists (
            select 1 from public.submissions s
             where s.artist_handle = v_artiste.instagram_handle
               and coalesce(nullif(public.titre_normalise(s.track_title), ''),
                            lower(s.track_title)) = v_norme
          );

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
              artist_handle, featuring, source, deezer_album_id
            ) values (
              v_artiste.display_name, v_titre, v_lien, v_lien, v_cover,
              'approved', now(), now(), now(),
              nextval('public.catalogue_import_seq'), v_date, v_type,
              v_artiste.instagram_handle, '[]'::jsonb, 'deezer', v_id
            )
            on conflict do nothing;

            get diagnostics v_n = row_count;
          end if;

          v_ajout := v_ajout + v_n;

          if v_n > 0 and jsonb_array_length(v_nouvelles) < 40 then
            v_nouvelles := v_nouvelles || jsonb_build_object(
              'artiste', v_artiste.display_name,
              'titre',   v_titre,
              'date',    v_date,
              'type',    v_type
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
    if not p_essai and not v_arret then
      update public.artists
         set deezer_verifie_le = case when v_erreur is null
                                      then now()
                                      else now() - interval '19 hours' end
       where id = v_artiste.id;
    end if;

  end loop;

  v_resume := jsonb_build_object(
    'essai',         p_essai,
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


-- Personne d'autre que la base ne doit pouvoir la déclencher : les
-- fonctions de public sont sinon appelables depuis le site par n'importe
-- quel visiteur.
revoke all on function public.importer_sorties_deezer(integer, boolean, integer, text)
  from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 6. Essai
--
-- Dans l'ordre, une requête à la fois (sélectionne-la avant « Run ») :
--
--   a) À blanc, sur un artiste — n'écrit rien. Le résultat dit ce qui
--      serait ajouté (« nouvelles ») ; « problemes » doit être vide.
--      Gradur, par exemple, a une vingtaine de sorties récentes :
--
--        select public.importer_sorties_deezer(1, true, 6, 'gradurofficiel243');
--
--      Sans pseudo, elle prend le premier artiste à vérifier :
--
--        select public.importer_sorties_deezer(1, true);
--
--   b) Pour de vrai, sur trois artistes. Les sorties apparaissent dans
--      le catalogue du site :
--
--        select public.importer_sorties_deezer(3);
--
--   c) Si ça te convient, exécute sql/deezer-planification.sql.
--
-- Pour remonter plus loin que six mois (au premier remplissage, par
-- exemple) : passer p_mois, ou changer le « 6 » dans la planification.
--
-- ---------------------------------------------------------------------
-- Ce que le journal raconte
--
--   select quand, artistes, ajoutees, erreurs
--   from public.deezer_import_journal
--   order by quand desc limit 20;
--
-- ---------------------------------------------------------------------
-- Si un artiste a été relié au mauvais homonyme sur Deezer — des sorties
-- qui ne sont pas les siennes apparaissent sous son nom —, on le
-- détache et on retire ce qui est venu de lui (son pseudo à la place
-- de « son_pseudo ») :
--
--   delete from public.submissions
--    where source = 'deezer' and artist_handle = 'son_pseudo';
--
--   update public.artists
--      set deezer_artist_id = null, deezer_verifie_le = null
--    where instagram_handle = 'son_pseudo';
--
-- ---------------------------------------------------------------------
-- Pour tout défaire, le jour où tu le veux
--
-- Ne touche QUE ce que cet import a ajouté : les sorties de La Wave
-- n'ont pas de source. À garder de côté, pas à exécuter maintenant.
--
--   delete from public.submissions where source = 'deezer';
--
-- Et pour que les artistes soient revérifiés dès le prochain passage :
--
--   update public.artists set deezer_verifie_le = null;
-- ---------------------------------------------------------------------


-- ---------------------------------------------------------------------
-- Vérification
-- ---------------------------------------------------------------------

select 'artistes suivis' as quoi, count(*)::text as valeur
from public.artists
where deezer_artist_id is not null
union all
select 'sorties importées', count(*)::text
from public.submissions
where source = 'deezer'
union all
select 'fonction installée', count(*)::text
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'importer_sorties_deezer';
