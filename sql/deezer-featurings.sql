-- =====================================================================
-- La Wave — les artistes en featuring, et le bon artiste principal
--
-- À passer après les trois fichiers de l'import (deezer-artistes,
-- deezer-import, deezer-planification). Ce fichier ne lance rien tout
-- seul : il remplace la fonction d'import par une version qui lit, pour
-- chaque sortie, qui la signe et qui y est invité, et pose une seconde
-- fonction qui corrige les sorties déjà importées. Le fichier
-- sql/deezer-featurings-planification.sql la fera tourner toute seule.
--
-- Ce que l'import faisait jusqu'ici : il demandait à Deezer « les
-- albums de tel artiste » et classait tout ce qui revenait sous cet
-- artiste. Or Deezer y inclut les sorties où il est seulement invité.
-- Sur un échantillon de 90 sorties importées, 28 étaient rangées chez
-- l'invité (« Hot dog », de Jok'air avec Le Juiice et Gemtro, était chez
-- Le Juiice) et 47 avaient des invités que le site ne montrait pas.
--
-- Ce que fait la nouvelle version, pour chaque nouvelle sortie :
--
--   · elle demande à Deezer l'album lui-même : l'artiste principal et la
--     liste des artistes crédités ;
--   · la sortie est rangée chez l'artiste principal ; les autres
--     artistes crédités deviennent ses featurings, affichés sur la page
--     de la sortie et rattachés à leur propre page artiste ;
--   · si un de ces artistes n'existe pas encore sur La Wave, son profil
--     est créé (source « deezer-auto », avec sa photo Deezer) : c'est la
--     liste « ajoutés automatiquement » de l'espace équipe ;
--   · un artiste ajouté ainsi n'est PAS suivi : seules les sorties où il
--     apparaît avec un artiste suivi entrent au catalogue. Pour importer
--     aussi toutes ses autres sorties, il se suit depuis l'espace équipe
--     (colonne artists.deezer_suivi) ;
--   · une sortie dont l'artiste principal est suivi par l'import n'est
--     pas ajoutée depuis la page de l'invité : elle arrive depuis la
--     sienne, avec ses featurings ;
--   · les compilations (« Various Artists ») ne sont la sortie de
--     personne : elles sont laissées de côté.
--
-- Les artistes ne sont jamais créés « pour rien » : un profil n'est
-- ajouté que pour une sortie qui entre au catalogue.
--
-- Pour l'espace équipe (onglet Artistes du site) : deux fonctions
-- permettent de chercher un artiste sur Deezer et de l'ajouter — ou de
-- relier à Deezer un profil que l'import n'avait pas su rattacher — sans
-- écrire une ligne de SQL.
--
-- À exécuter dans Supabase → SQL Editor, d'un seul bloc. Relançable :
-- tout est écrit pour ne rien écraser. Si une instruction échoue, rien
-- n'est appliqué (le bloc entier est annulé) : l'import continue alors
-- de tourner comme avant.
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

  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'importer_sorties_deezer'
  ) then
    raise exception
      'Exécute d''abord sql/deezer-import.sql : la fonction importer_sorties_deezer() manque.';
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
-- 1. Les colonnes
--
--   artists.deezer_suivi        l'import va-t-il chercher les sorties de
--                               cet artiste ? Vrai pour tous ceux qui
--                               étaient déjà suivis ; faux pour ceux que
--                               l'import ajoute lui-même.
--   submissions.deezer_feat_le  la sortie a été vérifiée côté artiste
--                               principal et invités (vide = pas encore).
--
-- Et un artiste Deezer ne peut figurer qu'une fois dans la table : c'est
-- ce qui empêche deux passages simultanés de créer le même profil deux
-- fois.
-- ---------------------------------------------------------------------

alter table public.artists
  add column if not exists deezer_suivi boolean not null default true;

alter table public.submissions
  add column if not exists deezer_feat_le timestamptz;

create unique index if not exists artists_deezer_artist_uidx
  on public.artists (deezer_artist_id)
  where deezer_artist_id is not null;

-- Les sorties encore à corriger, dans l'ordre : l'index les retrouve
-- sans parcourir la table.
create index if not exists submissions_deezer_a_completer_idx
  on public.submissions (id)
  where source = 'deezer' and deezer_feat_le is null;

-- Les albums que l'import a écartés pour de bon (les compilations) : sans
-- cette mémoire, il les redemanderait à Deezer à chaque passage, puisqu'ils
-- n'entrent jamais au catalogue. Seul le SQL Editor peut la lire.
create table if not exists public.deezer_albums_ignores (
  deezer_album_id bigint      primary key,
  raison          text,
  le              timestamptz not null default now()
);

alter table public.deezer_albums_ignores enable row level security;

revoke all on table public.deezer_albums_ignores from anon, authenticated;


-- ---------------------------------------------------------------------
-- 2. Qui peut changer qui l'on suit
--
-- Le garde-fou de sql/deezer-artistes.sql couvrait l'identifiant Deezer
-- et la date de vérification. « Suivre » ou « ne plus suivre » est la
-- même décision : réservée à l'équipe, et à la base elle-même.
-- ---------------------------------------------------------------------

create or replace function public.artists_gel_deezer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin

  if auth.uid() is null or public.est_equipe() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.deezer_artist_id is not null or new.deezer_verifie_le is not null then
      raise exception 'Ces colonnes sont réservées à l''équipe.';
    end if;
    return new;
  end if;

  if new.deezer_artist_id   is distinct from old.deezer_artist_id
     or new.deezer_verifie_le is distinct from old.deezer_verifie_le
     or new.deezer_suivi      is distinct from old.deezer_suivi then
    raise exception 'Ces colonnes sont réservées à l''équipe.';
  end if;

  return new;
end $$;


-- ---------------------------------------------------------------------
-- 3. Le profil d'un artiste Deezer
--
-- deezer_profil_artiste(id Deezer, nom, photo)
--
-- Renvoie le profil relié à cet artiste Deezer, ou le crée. Le pseudo
-- est déduit du nom, comme pour les profils importés de la liste de
-- départ (« Pit Baccardi » → pitbaccardi) ; s'il est pris par quelqu'un
-- d'autre, l'identifiant Deezer y est ajouté (pitbaccardi.5224). Un
-- profil ainsi créé a pour source « deezer-auto » et n'est pas suivi.
-- ---------------------------------------------------------------------

create or replace function public.deezer_profil_artiste(
  p_deezer_id bigint,
  p_nom       text,
  p_photo     text default null
)
returns public.artists
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ligne  public.artists;
  v_nom    text := btrim(coalesce(p_nom, ''));
  v_base   text;
  v_handle text;
begin

  if p_deezer_id is null then
    raise exception 'Identifiant Deezer manquant.';
  end if;

  select * into v_ligne
    from public.artists a
   where a.deezer_artist_id = p_deezer_id
   limit 1;

  if found then
    return v_ligne;
  end if;

  v_base := regexp_replace(
    translate(
      lower(v_nom),
      'àáâãäåçèéêëìíîïñòóôõöùúûüýÿœæ',
      'aaaaaaceeeeiiiinooooouuuuyyoa'
    ),
    '[^a-z0-9]+', '', 'g'
  );
  v_base   := left(coalesce(nullif(v_base, ''), 'artiste'), 40);
  v_handle := v_base;

  if exists (select 1 from public.artists a where a.instagram_handle = v_handle) then
    v_handle := v_base || '.' || p_deezer_id::text;
  end if;

  -- Deux tentatives : si le pseudo a été pris entre-temps par quelqu'un
  -- d'autre, la seconde utilise celui qui porte l'identifiant Deezer. Si
  -- c'est le même artiste Deezer qui a été créé entre-temps par un autre
  -- passage, on le retrouve.
  for v_essai in 1..2 loop

    insert into public.artists (
      instagram_handle, display_name, photo_url,
      source, deezer_artist_id, deezer_suivi
    ) values (
      v_handle,
      coalesce(nullif(v_nom, ''), v_base),
      nullif(btrim(coalesce(p_photo, '')), ''),
      'deezer-auto', p_deezer_id, false
    )
    on conflict do nothing
    returning * into v_ligne;

    exit when v_ligne.id is not null;

    select * into v_ligne
      from public.artists a
     where a.deezer_artist_id = p_deezer_id
     limit 1;

    exit when found;

    v_handle := v_base || '.' || p_deezer_id::text;

  end loop;

  if v_ligne.id is null then
    raise exception 'Le profil de l''artiste Deezer % n''a pas pu être créé.', p_deezer_id;
  end if;

  return v_ligne;

end $$;

revoke all on function public.deezer_profil_artiste(bigint, text, text)
  from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 4. Qui signe une sortie, et avec qui
--
-- deezer_credits(id de l'album Deezer) renvoie un objet :
--
--   { "principal": { "id", "nom", "photo" },
--     "invites":   [ { "id", "nom", "photo" }, … ] }     (huit au plus)
--
-- ou, si Deezer n'a pas pu répondre :
--
--   { "erreur": "…", "quota": true|false, "absent": true|false }
--
-- « quota » : Deezer limite à 50 requêtes toutes les 5 secondes ;
-- « absent » : l'album n'existe plus chez Deezer.
-- ---------------------------------------------------------------------

create or replace function public.deezer_credits(p_album_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_rep     http_response;
  v_json    jsonb;
  v_prin    jsonb;
  v_invites jsonb    := '[]'::jsonb;
  v_c       jsonb;
  v_id      bigint;
  v_vus     bigint[];
  v_photo   text;
begin

  begin
    v_rep := http_get('https://api.deezer.com/album/' || p_album_id::text);
    -- Deezer limite à 50 requêtes toutes les 5 secondes.
    perform pg_sleep(0.25);

    if v_rep.status <> 200 then
      return jsonb_build_object('erreur', 'Deezer a répondu HTTP ' || v_rep.status::text);
    end if;

    v_json := v_rep.content::jsonb;
  exception when others then
    return jsonb_build_object('erreur', sqlerrm);
  end;

  if (v_json->'error') is not null then
    return jsonb_build_object(
      'erreur', coalesce(v_json->'error'->>'message', 'erreur renvoyée par Deezer'),
      'quota',  (v_json->'error'->>'code') = '4',
      'absent', (v_json->'error'->>'code') = '800'
    );
  end if;

  v_prin := v_json->'artist';

  if v_prin is null or nullif(v_prin->>'id', '') is null then
    return jsonb_build_object('erreur', 'artiste principal introuvable', 'absent', true);
  end if;

  v_vus := array[(v_prin->>'id')::bigint];

  -- L'image par défaut de Deezer (un artiste sans photo) a une adresse
  -- sans empreinte : « …/artist//250x250… ».
  v_photo := nullif(v_prin->>'picture_medium', '');
  if v_photo like '%/artist//%' then v_photo := null; end if;

  v_prin := jsonb_build_object(
    'id',    (v_prin->>'id')::bigint,
    'nom',   btrim(coalesce(v_prin->>'name', '')),
    'photo', v_photo
  );

  for v_c in
    select e.value
      from jsonb_array_elements(coalesce(v_json->'contributors', '[]'::jsonb)) as e
  loop

    v_id := nullif(v_c->>'id', '')::bigint;

    continue when v_id is null or v_id = any(v_vus);
    continue when btrim(coalesce(v_c->>'name', '')) = '';

    -- Un nom qui n'est pas un artiste : la chaîne COLORS est créditée sur
    -- chaque « A COLORS SHOW ».
    continue when btrim(v_c->>'name') ~* '^colors$';

    v_vus := v_vus || v_id;

    exit when jsonb_array_length(v_invites) >= 8;

    v_photo := nullif(v_c->>'picture_medium', '');
    if v_photo like '%/artist//%' then v_photo := null; end if;

    v_invites := v_invites || jsonb_build_object(
      'id',    v_id,
      'nom',   btrim(v_c->>'name'),
      'photo', v_photo
    );

  end loop;

  return jsonb_build_object('principal', v_prin, 'invites', v_invites);

end $$;

revoke all on function public.deezer_credits(bigint)
  from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 5. La fonction d'import, avec les invités
--
-- Même signature, même planification : la tâche de
-- sql/deezer-planification.sql continue d'appeler
-- importer_sorties_deezer(20, false, 6) sans qu'on y touche. Les ajouts
-- par rapport à la version de sql/deezer-import.sql sont signalés par
-- « NOUVEAU ».
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
          or (p_handle is null
              and (a.deezer_verifie_le is null
                   or a.deezer_verifie_le < now() - interval '20 hours'))
           )
     order by a.deezer_verifie_le nulls first, a.id
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
    v_url     := 'https://api.deezer.com/artist/' || v_artiste.deezer_artist_id
                 || '/albums?limit=100';

    -- Tout ce qui concerne un artiste tient dans ce bloc : si quelque
    -- chose casse, ses ajouts sont annulés et on passe au suivant.
    begin

      while v_url is not null and v_pages < 8 and not v_arret loop

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

revoke all on function public.importer_sorties_deezer(integer, boolean, integer, text)
  from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 6. Corriger les sorties déjà importées
--
-- completer_sorties_deezer(p_lot, p_essai)
--
--   p_lot    combien de sorties vérifier à ce passage (20 par défaut) ;
--   p_essai  true : ne rien écrire, seulement raconter ce qui changerait.
--
-- Pour chaque sortie importée avant ce fichier, elle demande à Deezer
-- l'album et :
--
--   · remplit les featurings (créant les profils qui manquent) ;
--   · si Deezer dit que la sortie est celle d'un autre artiste que celui
--     chez qui elle était rangée, la range chez le véritable artiste
--     principal — profil créé s'il n'existe pas ;
--   · laisse telles quelles les compilations ;
--   · note la sortie comme vérifiée (submissions.deezer_feat_le), pour ne
--     plus y revenir. Si Deezer ne répond pas, elle sera reprise au
--     passage suivant.
--
-- Rien ne se perd : numéro de catalogue, pochette, date, liens restent ce
-- qu'ils sont ; seuls l'artiste affiché et les featurings changent.
-- ---------------------------------------------------------------------

create or replace function public.completer_sorties_deezer(
  p_lot   integer default 20,
  p_essai boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_debut      timestamptz := clock_timestamp();
  v_sortie     record;
  v_credits    jsonb;
  v_prin       jsonb;
  v_prin_id    bigint;
  v_artiste    public.artists;
  v_ligne      public.artists;
  v_inv        jsonb;
  v_handle     text;
  v_nom        text;
  v_feats      jsonb;
  v_noms_feats text[];
  v_arret      boolean := false;
  v_nb_traitees integer := 0;
  v_nb_changees integer := 0;
  v_nb_deplacees integer := 0;
  v_nb_erreurs integer := 0;
  v_exemples   jsonb := '[]'::jsonb;
  v_problemes  jsonb := '[]'::jsonb;
  v_resume     jsonb;
begin

  if not pg_try_advisory_xact_lock(hashtext('completer_sorties_deezer')) then
    return jsonb_build_object('ignore', 'un autre passage est déjà en cours');
  end if;

  begin
    perform http_set_curlopt('CURLOPT_TIMEOUT', '10');
  exception when others then
    null;
  end;

  for v_sortie in
    select s.id, s.deezer_album_id, s.artist_handle, s.artist_name, s.track_title
      from public.submissions s
     where s.source = 'deezer'
       and s.deezer_feat_le is null
       and s.deezer_album_id is not null
     order by s.id
     limit greatest(p_lot, 1)
  loop

    exit when v_arret or clock_timestamp() - v_debut > interval '75 seconds';

    v_nb_traitees := v_nb_traitees + 1;
    v_credits := public.deezer_credits(v_sortie.deezer_album_id);

    if (v_credits->>'erreur') is not null then

      if (v_credits->>'quota') = 'true' then
        v_arret := true;
      end if;

      -- Un album que Deezer ne connaît plus : on le note, pour ne plus le
      -- redemander. Toute autre erreur : on y reviendra.
      if (v_credits->>'absent') = 'true' then
        if not p_essai then
          update public.submissions
             set deezer_feat_le = now()
           where id = v_sortie.id;
        end if;
      else
        v_nb_erreurs := v_nb_erreurs + 1;
        if jsonb_array_length(v_problemes) < 20 then
          v_problemes := v_problemes || jsonb_build_object(
            'titre',  v_sortie.track_title,
            'erreur', v_credits->>'erreur'
          );
        end if;
      end if;

      continue;

    end if;

    -- Une erreur sur une sortie annule ce qu'elle avait créé et passe à
    -- la suivante.
    begin

      v_prin    := v_credits->'principal';
      v_prin_id := (v_prin->>'id')::bigint;
      v_handle  := v_sortie.artist_handle;
      v_nom     := v_sortie.artist_name;

      select * into v_artiste
        from public.artists a
       where a.instagram_handle = v_sortie.artist_handle;

      -- Les compilations ne changent de mains pour personne : on n'y
      -- ajoute pas non plus les dizaines d'artistes qu'elles réunissent.
      if v_prin_id = 5080 or (v_prin->>'nom') ~* '^(various|compilation)' then

        if not p_essai then
          update public.submissions
             set deezer_feat_le = now()
           where id = v_sortie.id;
        end if;

        continue;

      end if;

      -- La sortie est-elle rangée chez quelqu'un d'autre que son artiste
      -- principal ? (On ne touche pas à une sortie dont l'artiste actuel
      -- n'a pas de profil Deezer : rien ne dit qu'il se trompe.)
      if v_artiste.id is not null
         and v_artiste.deezer_artist_id is not null
         and v_artiste.deezer_artist_id <> v_prin_id then

        select * into v_ligne
          from public.artists a
         where a.deezer_artist_id = v_prin_id
         limit 1;

        if found then
          v_handle := v_ligne.instagram_handle;
          v_nom    := coalesce(nullif(v_ligne.display_name, ''), v_ligne.instagram_handle);
        elsif p_essai then
          v_handle := null;
          v_nom    := v_prin->>'nom';
        else
          v_ligne  := public.deezer_profil_artiste(v_prin_id, v_prin->>'nom', v_prin->>'photo');
          v_handle := v_ligne.instagram_handle;
          v_nom    := coalesce(nullif(v_ligne.display_name, ''), v_ligne.instagram_handle);
        end if;

      end if;

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

      if not p_essai then
        update public.submissions
           set artist_handle  = v_handle,
               artist_name    = v_nom,
               featuring      = v_feats,
               deezer_feat_le = now(),
               updated_at     = now()
         where id = v_sortie.id;
      end if;

      v_nb_changees := v_nb_changees + 1;

      if v_handle is distinct from v_sortie.artist_handle then
        v_nb_deplacees := v_nb_deplacees + 1;
      end if;

      if jsonb_array_length(v_exemples) < 40
         and (jsonb_array_length(to_jsonb(v_noms_feats)) > 0
              or v_handle is distinct from v_sortie.artist_handle) then
        v_exemples := v_exemples || jsonb_build_object(
          'titre', v_sortie.track_title,
          'avant', v_sortie.artist_name,
          'apres', v_nom,
          'avec',  to_jsonb(v_noms_feats)
        );
      end if;

    exception when others then
      v_nb_erreurs := v_nb_erreurs + 1;
      if jsonb_array_length(v_problemes) < 20 then
        v_problemes := v_problemes || jsonb_build_object(
          'titre',  v_sortie.track_title,
          'erreur', sqlerrm
        );
      end if;
    end;

  end loop;

  v_resume := jsonb_build_object(
    'essai',          p_essai,
    'traitees',       v_nb_traitees,
    'changees',       v_nb_changees,
    'deplacees',      v_nb_deplacees,
    'erreurs',        v_nb_erreurs,
    'quota_atteint',  v_arret,
    'exemples',       v_exemples,
    'problemes',      v_problemes,
    'restantes',      (select count(*) from public.submissions s
                        where s.source = 'deezer' and s.deezer_feat_le is null
                          and s.deezer_album_id is not null)
  );

  if not p_essai and v_nb_traitees > 0 then
    insert into public.deezer_import_journal (artistes, ajoutees, erreurs, detail)
    values (0, v_nb_changees, v_nb_erreurs, v_resume);
  end if;

  return v_resume;

end $$;

revoke all on function public.completer_sorties_deezer(integer, boolean)
  from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 7. Pour l'espace équipe : chercher et ajouter un artiste
--
-- Deux fonctions que l'onglet Artistes appelle. C'est la base qui parle à
-- Deezer, comme pour l'import : le navigateur n'exécute rien venu d'un
-- site tiers. Les deux sont réservées à l'équipe.
--
--   deezer_chercher_artiste(texte)
--       cherche un artiste par son nom, ou par l'adresse (ou le numéro) de
--       sa page Deezer. Renvoie jusqu'à huit résultats avec leur photo,
--       leur nombre de fans et d'albums, et, s'il est déjà sur La Wave, son
--       profil (« deja »).
--
--   ajouter_artiste_deezer(id Deezer, nom, photo, pseudo du profil)
--       sans pseudo : ajoute l'artiste à La Wave (ou, s'il y est déjà, le
--       remet parmi les suivis) ; avec un pseudo : relie ce profil
--       existant à l'artiste Deezer. Dans les deux cas l'artiste est suivi
--       et sera vérifié au prochain passage de l'import.
-- ---------------------------------------------------------------------

-- Un texte prêt à entrer dans une adresse web : tout ce qui n'est pas une
-- lettre, un chiffre ou « . _ ~ - » devient %XX (en UTF-8 : « é » donne
-- %C3%A9). Écrit ici plutôt que de dépendre d'une fonction de l'extension
-- « http » dont le nom varie selon les versions.
create or replace function public.deezer_encoder(p_texte text)
returns text
language sql
immutable
as $$
  select coalesce(
    string_agg(
      case when t.c ~ '^[A-Za-z0-9._~-]$'
           then t.c
           else upper(regexp_replace(encode(convert_to(t.c, 'UTF8'), 'hex'), '(..)', '%\1', 'g'))
      end,
      '' order by t.n
    ),
    ''
  )
  from regexp_split_to_table(coalesce(p_texte, ''), '') with ordinality as t(c, n);
$$;


create or replace function public.deezer_chercher_artiste(p_recherche text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_q     text := btrim(coalesce(p_recherche, ''));
  v_id    text;
  v_rep   http_response;
  v_json  jsonb;
  v_res   jsonb := '[]'::jsonb;
  v_a     jsonb;
  v_connu public.artists;
  v_photo text;
begin

  if not public.est_equipe() then
    raise exception 'Réservé à l''équipe.';
  end if;

  if v_q = '' then
    return v_res;
  end if;

  begin
    perform http_set_curlopt('CURLOPT_TIMEOUT', '10');
  exception when others then
    null;
  end;

  -- Une adresse de page Deezer (…/artist/1234) ou un simple numéro :
  -- on va droit à l'artiste.
  v_id := coalesce(
    substring(v_q from 'artist/([0-9]+)'),
    case when v_q ~ '^[0-9]+$' then v_q end
  );

  if v_id is not null then
    v_rep := http_get('https://api.deezer.com/artist/' || v_id);
  else
    v_rep := http_get('https://api.deezer.com/search/artist?limit=8&q=' || public.deezer_encoder(v_q));
  end if;

  if v_rep.status <> 200 then
    raise exception 'Deezer a répondu HTTP %', v_rep.status;
  end if;

  v_json := v_rep.content::jsonb;

  if (v_json->'error') is not null then
    if v_id is not null then
      return v_res;
    end if;
    raise exception '%', coalesce(v_json->'error'->>'message', 'erreur renvoyée par Deezer');
  end if;

  for v_a in
    select e.value
      from jsonb_array_elements(
             case when v_id is not null
                  then jsonb_build_array(v_json)
                  else coalesce(v_json->'data', '[]'::jsonb) end
           ) as e
  loop

    continue when nullif(v_a->>'id', '') is null;

    select * into v_connu
      from public.artists a
     where a.deezer_artist_id = (v_a->>'id')::bigint
     limit 1;

    v_photo := nullif(v_a->>'picture_medium', '');
    if v_photo like '%/artist//%' then v_photo := null; end if;

    v_res := v_res || jsonb_build_object(
      'id',        (v_a->>'id')::bigint,
      'nom',       v_a->>'name',
      'lien',      v_a->>'link',
      'photo',     v_photo,
      'fans',      nullif(v_a->>'nb_fan', '')::bigint,
      'albums',    nullif(v_a->>'nb_album', '')::bigint,
      'deja',      v_connu.instagram_handle,
      'deja_nom',  v_connu.display_name,
      'deja_suivi', v_connu.deezer_suivi
    );

  end loop;

  return v_res;

end $$;


create or replace function public.ajouter_artiste_deezer(
  p_deezer_id bigint,
  p_nom       text,
  p_photo     text default null,
  p_handle    text default null
)
returns public.artists
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ligne  public.artists;
  v_autre  public.artists;
  v_existe boolean;
begin

  if not public.est_equipe() then
    raise exception 'Réservé à l''équipe.';
  end if;

  if p_deezer_id is null then
    raise exception 'Identifiant Deezer manquant.';
  end if;

  select * into v_autre
    from public.artists a
   where a.deezer_artist_id = p_deezer_id
   limit 1;

  v_existe := found;

  -- Relier un profil qui existe déjà (un de ceux que l'import n'avait pas
  -- su rattacher à Deezer).
  if p_handle is not null then

    if v_existe and v_autre.instagram_handle <> p_handle then
      raise exception 'Cet artiste Deezer est déjà relié au profil « % ».',
        coalesce(nullif(v_autre.display_name, ''), v_autre.instagram_handle);
    end if;

    update public.artists
       set deezer_artist_id  = p_deezer_id,
           deezer_suivi      = true,
           deezer_verifie_le = null,
           updated_at        = now()
     where instagram_handle = p_handle
    returning * into v_ligne;

    if v_ligne.id is null then
      raise exception 'Profil introuvable.';
    end if;

    return v_ligne;

  end if;

  -- Déjà sur La Wave : on le remet simplement parmi les artistes suivis.
  if v_existe then

    update public.artists
       set deezer_suivi      = true,
           deezer_verifie_le = null,
           updated_at        = now()
     where id = v_autre.id
    returning * into v_ligne;

    return v_ligne;

  end if;

  -- Un nouveau profil. Choisi par l'équipe : pas de source (la mention
  -- « ajouté automatiquement » est réservée à ce que l'import crée), et
  -- suivi d'emblée.
  v_ligne := public.deezer_profil_artiste(p_deezer_id, p_nom, p_photo);

  update public.artists
     set source            = null,
         deezer_suivi      = true,
         deezer_verifie_le = null,
         updated_at        = now()
   where id = v_ligne.id
  returning * into v_ligne;

  return v_ligne;

end $$;

revoke all on function public.deezer_chercher_artiste(text)
  from public, anon;
grant execute on function public.deezer_chercher_artiste(text)
  to authenticated;

revoke all on function public.ajouter_artiste_deezer(bigint, text, text, text)
  from public, anon;
grant execute on function public.ajouter_artiste_deezer(bigint, text, text, text)
  to authenticated;


-- ---------------------------------------------------------------------
-- 8. Essai
--
-- Dans l'ordre, une requête à la fois (sélectionne-la avant « Run »).
--
--   a) La correction des sorties déjà importées, À BLANC : rien n'est
--      écrit. « exemples » montre, pour chaque sortie, chez qui elle est
--      rangée aujourd'hui (« avant »), chez qui elle irait (« apres ») et
--      ses invités (« avec »). « problemes » doit être vide.
--
--        select public.completer_sorties_deezer(10, true);
--
--   b) Pour de vrai, sur dix sorties. Regarde-les ensuite dans le
--      catalogue du site (le featuring apparaît sous le nom de l'artiste,
--      et la sortie figure sur la page de chaque invité) :
--
--        select public.completer_sorties_deezer(10);
--
--   c) Les nouvelles sorties, à blanc, sur un artiste. « avec » liste les
--      invités ; « artiste » est l'artiste principal :
--
--        select public.importer_sorties_deezer(1, true, 12);
--
--   d) Si tout te convient, exécute
--      sql/deezer-featurings-planification.sql : la base corrigera le
--      reste des sorties importées toute seule, vingt à la fois.
--
-- ---------------------------------------------------------------------
-- Pour retirer ce que cette étape a ajouté
--
-- Les profils créés par l'import portent la source « deezer-auto ».
-- Pour les défaire (les sorties où ils figurent en featuring perdent
-- alors leur lien, sans casser l'affichage), à garder de côté, pas à
-- exécuter maintenant :
--
--   delete from public.artists
--    where source = 'deezer-auto'
--      and not exists (select 1 from public.submissions s
--                       where s.artist_handle = artists.instagram_handle);
--
-- ---------------------------------------------------------------------


-- ---------------------------------------------------------------------
-- Vérification
-- ---------------------------------------------------------------------

select 'artistes suivis' as quoi, count(*)::text as valeur
from public.artists
where deezer_artist_id is not null and deezer_suivi
union all
select 'artistes ajoutés automatiquement', count(*)::text
from public.artists
where source = 'deezer-auto'
union all
select 'sorties importées à corriger', count(*)::text
from public.submissions
where source = 'deezer' and deezer_feat_le is null
union all
select 'fonctions installées', count(*)::text
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('importer_sorties_deezer', 'completer_sorties_deezer',
                    'deezer_credits', 'deezer_profil_artiste');
