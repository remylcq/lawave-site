-- =====================================================================
-- La Wave — lancer l'import Deezer tout seul
--
-- Troisième et dernier fichier de l'import quotidien. À n'exécuter
-- qu'après l'essai décrit en bas de sql/deezer-import.sql : à partir
-- d'ici, la base interroge Deezer sans qu'on le lui demande.
--
-- Avant, une seule fois :
--   Supabase → Database → Extensions → activer « pg_cron ».
--
-- Toutes les vingt minutes, la base vérifie vingt artistes auprès de
-- Deezer : ceux qu'elle n'a pas regardés depuis vingt heures. Au
-- premier remplissage elle fait le tour des quelque 450 artistes en
-- une demi-journée ; ensuite chaque artiste est revu une fois par jour,
-- et la plupart des passages n'ont plus rien à faire.
--
-- À exécuter dans Supabase → SQL Editor, d'un seul bloc. Relançable :
-- le nom de la tâche la remplace au lieu de la doubler.
-- =====================================================================


do $$
begin

  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise exception
      'L''extension « pg_cron » n''est pas active : Supabase → Database → Extensions → pg_cron, puis relance ce fichier.';
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

end $$;


-- ---------------------------------------------------------------------
-- La tâche
--
--   '*/20 * * * *'   toutes les vingt minutes (heure UTC, sans importance
--                    ici : le passage n'est pas lié à une heure précise) ;
--   20               artistes vérifiés à chaque passage ;
--   false            pour de vrai (true = à blanc, ne rien écrire) ;
--   6                jusqu'où remonter, en mois. Pour garder plus de
--                    sorties plus anciennes derrière « Afficher plus »,
--                    mets 12 ou 24 et relance ce fichier : les artistes
--                    déjà vérifiés ne sont revus qu'au bout de vingt
--                    heures, les sorties plus anciennes arrivent alors.
-- ---------------------------------------------------------------------

select cron.schedule(
  'deezer-import-sorties',
  '*/20 * * * *',
  $$ select public.importer_sorties_deezer(20, false, 6); $$
);


-- ---------------------------------------------------------------------
-- Vérification
--
-- La première requête doit renvoyer une ligne active. Les deux autres
-- servent plus tard : ce que la base a fait, passage après passage.
-- ---------------------------------------------------------------------

select jobid, jobname, schedule, active
from cron.job
where jobname = 'deezer-import-sorties';


-- ---------------------------------------------------------------------
-- Pour suivre l'import, quand tu veux (à exécuter à part)
--
--   -- Ce que l'import a ajouté, passage après passage :
--   select quand, artistes, ajoutees, erreurs
--   from public.deezer_import_journal
--   order by quand desc
--   limit 20;
--
--   -- Les passages eux-mêmes (une erreur de planification se lit ici) :
--   select start_time, status, return_message
--   from cron.job_run_details
--   where jobid = (select jobid from cron.job where jobname = 'deezer-import-sorties')
--   order by start_time desc
--   limit 10;
--
--   -- Combien d'artistes restent à vérifier aujourd'hui :
--   select count(*)
--   from public.artists
--   where deezer_artist_id is not null
--     and (deezer_verifie_le is null or deezer_verifie_le < now() - interval '20 hours');
--
-- ---------------------------------------------------------------------
-- Pour arrêter l'import, sans rien supprimer de ce qu'il a ajouté
--
--   select cron.unschedule('deezer-import-sorties');
-- ---------------------------------------------------------------------
