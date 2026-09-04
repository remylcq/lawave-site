-- =====================================================================
-- La Wave — featurings sur les sorties
--
-- Une sortie peut désormais porter des artistes invités. Ils sont
-- stockés sur la sortie elle-même, sous forme de liste :
--
--   [{ "nom": "Edou", "handle": "edou", "instagram_url": "https://..." }]
--
-- Le pseudo Instagram sert de clé, comme pour l'artiste principal :
-- c'est lui qui rattache le featuring au profil de la table artists,
-- profil que le site crée à l'envoi s'il n'existe pas encore.
--
-- Une table de liaison aurait été plus orthodoxe, mais elle aurait
-- demandé ses propres règles d'accès et une jointure à chaque lecture
-- du catalogue — pour une donnée qui n'est jamais interrogée seule.
--
-- À exécuter dans Supabase → SQL Editor, d'un seul bloc.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. La colonne
--
-- NOT NULL avec une liste vide par défaut : le site n'a ainsi jamais à
-- distinguer « pas de featuring » de « champ jamais rempli », et les
-- sorties déjà en base sont mises à jour d'office.
-- ---------------------------------------------------------------------

alter table public.submissions
  add column if not exists featuring jsonb not null default '[]'::jsonb;


-- ---------------------------------------------------------------------
-- 2. Une liste, et rien d'autre
--
-- Le site n'écrit que des tableaux, mais la contrainte évite qu'une
-- correction faite à la main depuis Supabase ne casse l'affichage du
-- catalogue. Le bloc la pose seulement si elle manque : le script peut
-- être rejoué sans erreur.
-- ---------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'submissions_featuring_est_une_liste'
      and conrelid = 'public.submissions'::regclass
  ) then
    alter table public.submissions
      add constraint submissions_featuring_est_une_liste
      check (jsonb_typeof(featuring) = 'array');
  end if;
end $$;


-- ---------------------------------------------------------------------
-- 3. Vérification
--
-- La colonne doit apparaître en jsonb, non nulle, avec '[]' par défaut.
-- ---------------------------------------------------------------------

select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name   = 'submissions'
  and column_name  = 'featuring';
