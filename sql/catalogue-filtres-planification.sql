-- =====================================================================
-- La Wave — lancer la lecture des styles (genres) chez Deezer
--
-- À passer APRÈS sql/catalogue-filtres.sql.
--
-- Toutes les 2 minutes, 12 artistes dont le style n'a pas été relu depuis plus
-- d'un jour sont traités (une à trois requêtes Deezer chacun). Avec environ 900
-- artistes : une heure pour tout rattraper, puis une relecture par jour qui
-- ajoute le style des nouvelles sorties.
--
-- Suivre l'avancement (SQL Editor) :
--   select count(*) filter (where genre_id is not null) as avec_style, count(*) as total
--     from public.submissions where source = 'deezer';
--
-- Pour tout arrêter : select cron.unschedule('deezer-styles');
-- =====================================================================

select cron.unschedule('deezer-styles')
 where exists (select 1 from cron.job where jobname = 'deezer-styles');

select cron.schedule(
  'deezer-styles',
  '*/2 * * * *',
  $cron$ select public.completer_styles_deezer(12); $cron$
);
