-- =====================================================================
-- La Wave — lancer la discographie complète
--
-- À passer APRÈS sql/catalogue-pagine.sql, sql/discographie-complete.sql ET la mise
-- en ligne du site qui sait lire un gros catalogue (index.html, PR « Un catalogue
-- qui peut grossir »).
--
-- Tous les trois minutes, trois artistes dont la discographie n'a pas encore été
-- lue sont traités (jusqu'à 100 secondes de lecture). Avec 890 artistes et une
-- moyenne d'une quarantaine de sorties chacun, comptez de 10 à 20 heures.
-- La tâche s'éteint toute seule dans le sens où elle ne trouve plus personne à
-- traiter : on peut la retirer ensuite (voir la dernière ligne).
--
-- Suivre l'avancement (SQL Editor) :
--   select count(*) filter (where deezer_complet_le is not null) as faits,
--          count(*) as total
--     from public.artists where deezer_suivi and deezer_artist_id is not null;
--   select count(*) from public.submissions where source = 'deezer';
--
-- Pour tout arrêter : select cron.unschedule('deezer-discographies');
-- =====================================================================

select cron.unschedule('deezer-discographies')
 where exists (select 1 from cron.job where jobname = 'deezer-discographies');

select cron.schedule(
  'deezer-discographies',
  '*/3 * * * *',
  $cron$ select public.importer_sorties_deezer(3, false, 6, null, true); $cron$
);
