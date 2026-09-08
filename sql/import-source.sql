-- =====================================================================
-- La Wave — marquer ce qui vient d'un import en masse
--
-- Une colonne « source » sur les deux tables : vide pour ce que
-- l'équipe a choisi, renseignée pour ce qui a été importé
-- automatiquement.
--
-- Elle sert à trois choses, toutes nécessaires avant le premier
-- import :
--
--   1. l'accueil continue de montrer les sorties de La Wave, et non
--      la dernière nouveauté d'un artiste importé ;
--   2. la numérotation de catalogue éditoriale reprend son cours —
--      les sorties importées occupent une plage à part, au-dessus de
--      100 000, que le site ignore quand il attribue le numéro
--      suivant ;
--   3. l'import se défait d'une seule instruction (voir en bas).
--
-- À exécuter dans Supabase → SQL Editor, AVANT les fichiers d'import.
-- =====================================================================

alter table public.submissions
  add column if not exists source text;

alter table public.artists
  add column if not exists source text;


-- Retrouver rapidement ce qui a été importé, sans parcourir la table.
create index if not exists submissions_source_idx
  on public.submissions (source)
  where source is not null;

create index if not exists artists_source_idx
  on public.artists (source)
  where source is not null;


-- ---------------------------------------------------------------------
-- Vérification
-- ---------------------------------------------------------------------

select table_name, column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and column_name  = 'source'
  and table_name in ('submissions', 'artists')
order by table_name;


-- ---------------------------------------------------------------------
-- Pour tout défaire, le jour où tu le veux
--
-- Ces deux instructions ne touchent QUE l'importé : les sorties et les
-- profils de La Wave n'ont pas de source. À garder de côté, pas à
-- exécuter maintenant.
--
--   delete from public.submissions where source is not null;
--   delete from public.artists     where source is not null;
--
-- Les profils d'artistes que l'équipe a complétés entre-temps (photo,
-- ville, Instagram) partiraient avec. Pour les conserver, il suffit de
-- vider leur source au fur et à mesure :
--
--   update public.artists set source = null
--    where source is not null and instagram_url is not null;
-- ---------------------------------------------------------------------
