-- ============================================================
-- Import Deezer : un projet (album, EP) n'est plus écarté parce qu'un single
-- du même artiste porte la même pochette ou le même titre.
--
-- Le bug (2026-10-24) : « FINIS-LES » (La Fève) et « EXTASIAAAAA » (Ino
-- Casablanca), sortis le 2026-10-23, n'arrivaient pas. Leur pochette est celle
-- d'un single déjà importé, et pour La Fève un single « Finis-les » existe : les
-- deux règles anti-doublon de importer_sorties_deezer les prenaient pour des
-- doublons.
--
-- Nouvelle règle : ces deux contrôles ne comptent un single existant comme
-- doublon que si la sortie testée est elle-même un single. Un projet n'est
-- écarté que par un autre projet.
--
-- Déjà passé en production le 2026-10-24 (puis les deux sorties importées, et
-- deezer_verifie_le remis à null pour les 483 artistes suivis qui ont un single
-- de moins de 6 mois, afin que l'import les revoie). Rejouable : le motif ne
-- correspond plus une fois le correctif posé, la fonction lève alors une erreur
-- sans rien changer.
-- ============================================================

do $$
declare d text; d2 text;
begin
  d := pg_get_functiondef('public.importer_sorties_deezer(integer,boolean,integer,text,boolean)'::regprocedure);

  d2 := regexp_replace(d,
    '(s\.artist_handle = v_artiste\.instagram_handle\s+and coalesce\(nullif\(public\.titre_normalise\(s\.track_title\), ''''\),\s*lower\(s\.track_title\)\) = v_norme)',
    '\1 and (lower(coalesce(v_alb->>''record_type'','''')) = ''single'' or s.release_type::text <> ''Single'')');
  if d2 = d then raise exception 'motif titre introuvable'; end if;
  d := d2;

  d2 := regexp_replace(d,
    '(s\.artist_handle = v_artiste\.instagram_handle\s+and s\.cover_url like \(''%/cover/'' \|\| v_md5 \|\| ''/%''\))',
    '\1 and (lower(coalesce(v_alb->>''record_type'','''')) = ''single'' or s.release_type::text <> ''Single'')');
  if d2 = d then raise exception 'motif pochette introuvable'; end if;

  execute d2;
end $$;

-- Pour faire revoir les artistes concernés par l'import :
-- update public.artists a set deezer_verifie_le = null
--  where a.deezer_suivi and a.deezer_artist_id is not null
--    and exists (select 1 from public.submissions s
--                 where s.artist_handle = a.instagram_handle and s.release_type::text = 'Single'
--                   and s.release_date >= current_date - interval '6 months');
