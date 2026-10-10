-- =====================================================================
-- La Wave — corriger toutes seules les sorties déjà importées
--
-- Dernier fichier des featurings. À n'exécuter qu'après l'essai décrit
-- en bas de sql/deezer-featurings.sql : à partir d'ici, la base
-- interroge Deezer, sortie après sortie, sans qu'on le lui demande.
--
-- Toutes les dix minutes, la base reprend vingt sorties importées avant
-- les featurings : elle y ajoute les invités et, si Deezer dit qu'elles
-- sont d'un autre artiste que celui chez qui elles étaient rangées, les
-- range chez lui. Le travail se compte en centaines de sorties : quelques
-- heures. Une fois toutes corrigées, la tâche ne trouve plus rien à
-- faire ; elle peut alors être retirée (voir en bas).
--
-- Les sorties que l'import ajoute désormais sont complètes dès leur
-- entrée : cette tâche ne sert que pour celles d'avant.
--
-- Avant, une seule fois (déjà fait pour l'import) :
--   Supabase → Database → Extensions → « pg_cron ».
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
    where n.nspname = 'public' and p.proname = 'completer_sorties_deezer'
  ) then
    raise exception
      'Exécute d''abord sql/deezer-featurings.sql : la fonction completer_sorties_deezer() manque.';
  end if;

end $$;


-- ---------------------------------------------------------------------
-- La tâche
--
--   '*/10 * * * *'   toutes les dix minutes ;
--   20               sorties corrigées à chaque passage ;
--   false            pour de vrai (true = à blanc, ne rien écrire).
-- ---------------------------------------------------------------------

select cron.schedule(
  'deezer-completer-sorties',
  '*/10 * * * *',
  $$ select public.completer_sorties_deezer(20, false); $$
);


-- ---------------------------------------------------------------------
-- Vérification
--
-- La première requête doit renvoyer une ligne active.
-- ---------------------------------------------------------------------

select jobid, jobname, schedule, active
from cron.job
where jobname = 'deezer-completer-sorties';


-- ---------------------------------------------------------------------
-- Pour suivre le travail, quand tu veux (à exécuter à part)
--
--   -- Combien de sorties restent à corriger :
--   select count(*)
--   from public.submissions
--   where source = 'deezer' and deezer_feat_le is null;
--
--   -- Ce que chaque passage a fait :
--   select quand, ajoutees as sorties_corrigees, erreurs, detail->'problemes' as problemes
--   from public.deezer_import_journal
--   where artistes = 0
--   order by quand desc
--   limit 20;
--
--   -- Les artistes que l'import a ajoutés lui-même :
--   select display_name, instagram_handle, created_at
--   from public.artists
--   where source = 'deezer-auto'
--   order by created_at desc
--   limit 50;
--
-- ---------------------------------------------------------------------
-- Quand il n'en reste plus (le premier compte ci-dessus affiche 0), la
-- tâche peut être retirée, sans rien supprimer de ce qu'elle a fait :
--
--   select cron.unschedule('deezer-completer-sorties');
-- ---------------------------------------------------------------------
