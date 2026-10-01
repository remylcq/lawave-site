-- =====================================================================
-- La Wave — retirer les doublons de pochette déjà importés
--
-- Les premiers passages de l'import ont ajouté, pour un album, les
-- singles qu'on en détache — avec la même pochette : huit tuiles
-- identiques chez Gradur, six chez Passi, deux chez Vald. La fonction
-- importer_sorties_deezer() ne le fait plus depuis sa dernière version
-- (sql/deezer-import.sql) ; ce fichier retire ce qui était déjà entré.
--
-- Pour chaque artiste et chaque pochette, il ne garde qu'une sortie :
-- l'album ou l'EP s'il y en a un, sinon la plus ancienne.
--
-- À exécuter UNE FOIS, après sql/deezer-import.sql. Ne touche que ce
-- que l'import a ajouté (source = 'deezer') : les sorties de La Wave
-- n'ont pas de source. Relançable sans risque : une fois les doublons
-- partis, il n'y a plus rien à retirer.
--
-- Les sorties retirées ne reviendront pas : l'import reconnaît désormais
-- une pochette qu'il a déjà.
-- =====================================================================


-- ---------------------------------------------------------------------
-- Pour voir d'abord ce qui partirait, sans rien supprimer — à lancer
-- seul, en sélectionnant ces lignes avant « Run » :
--
--   select artist_name, track_title, release_type, release_date
--   from (
--     select s.*,
--            row_number() over (
--              partition by s.artist_handle,
--                           substring(s.cover_url from 'cover/([0-9a-f]{32})/')
--              order by (s.release_type = 'Projet') desc, s.release_date, s.catalog_number
--            ) as rang
--     from public.submissions s
--     where s.source = 'deezer'
--       and substring(s.cover_url from 'cover/([0-9a-f]{32})/') is not null
--   ) t
--   where rang > 1
--   order by artist_name, release_date;
-- ---------------------------------------------------------------------


-- ---------------------------------------------------------------------
-- Le nettoyage. Le résultat est une ligne : le nombre de sorties retirées.
-- ---------------------------------------------------------------------

with rangs as (
  select s.id,
         row_number() over (
           partition by s.artist_handle,
                        substring(s.cover_url from 'cover/([0-9a-f]{32})/')
           order by (s.release_type = 'Projet') desc, s.release_date, s.catalog_number
         ) as rang
  from public.submissions s
  where s.source = 'deezer'
    and substring(s.cover_url from 'cover/([0-9a-f]{32})/') is not null
),
retirees as (
  delete from public.submissions s
  using rangs r
  where s.id = r.id
    and r.rang > 1
  returning s.id
)
select count(*) as sorties_retirees
from retirees;
