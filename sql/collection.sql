-- =====================================================================
-- La Wave — la collection
--
-- La collection devient quelque chose que l'on tient au quotidien, comme un
-- journal d'écoute :
--
--   • « À écouter » : une liste de sorties mises de côté (a_ecouter) ;
--   • le journal : le jour où l'on a écouté chaque sortie (ecoute_le) ;
--   • des notes à la demi-étoile : `rating` va de 1 (½ étoile) à 10 (cinq
--     étoiles) ; les notes déjà données (1 à 5) sont doublées.
--
-- `saved` garde son sens : la sortie est dans la collection, c'est-à-dire
-- écoutée. Une sortie est soit écoutée (saved), soit à écouter (a_ecouter),
-- jamais les deux : le déclencheur ci-dessous y veille, et tient le jour
-- d'écoute à jour pour les clients qui ne le connaissent pas.
--
-- À exécuter dans Supabase → SQL Editor, d'un seul bloc, AVANT la mise en
-- ligne du site qui l'utilise. Sans danger si on le relance (le doublement
-- des notes ne se fait qu'une fois). Tout est dans une transaction.
-- =====================================================================

begin;


-- ---------------------------------------------------------------------
-- 1. Les colonnes
-- ---------------------------------------------------------------------

alter table public.release_ratings
  add column if not exists a_ecouter boolean not null default false,
  add column if not exists ecoute_le date;


-- ---------------------------------------------------------------------
-- 2. Des notes à la demi-étoile (1 à 10)
--
-- Le doublement des notes existantes n'a lieu que tant que la contrainte
-- d'origine (1 à 5) est en place : relancer ce fichier ne les redouble pas.
-- ---------------------------------------------------------------------

do $$
begin
  if exists (
    select 1 from pg_constraint
     where conrelid = 'public.release_ratings'::regclass
       and conname = 'release_ratings_rating_check'
       and pg_get_constraintdef(oid) like '%<= 5%'
  ) then
    alter table public.release_ratings drop constraint release_ratings_rating_check;
    update public.release_ratings set rating = rating * 2 where rating is not null;
    alter table public.release_ratings
      add constraint release_ratings_rating_check check (rating >= 1 and rating <= 10);
  end if;
end $$;

-- Un avis reste un avis, pas un roman.
alter table public.release_ratings drop constraint if exists release_ratings_avis_check;
alter table public.release_ratings
  add constraint release_ratings_avis_check check (avis is null or char_length(avis) <= 1000);


-- ---------------------------------------------------------------------
-- 3. Le journal : le jour d'écoute des sorties déjà dans la collection
-- ---------------------------------------------------------------------

update public.release_ratings
   set ecoute_le = created_at::date
 where saved and ecoute_le is null;


-- ---------------------------------------------------------------------
-- 4. Cohérence : écoutée ou à écouter, et le jour d'écoute
--
--   saved      → pas « à écouter », et un jour d'écoute (aujourd'hui s'il manque) ;
--   pas saved  → pas de jour d'écoute.
-- ---------------------------------------------------------------------

create or replace function public.notes_garder_coherence()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.saved then
    new.a_ecouter := false;
    new.ecoute_le := coalesce(new.ecoute_le, current_date);
  else
    new.ecoute_le := null;
  end if;

  return new;
end $$;

drop trigger if exists notes_garder_coherence on public.release_ratings;

create trigger notes_garder_coherence
  before insert or update on public.release_ratings
  for each row
  execute function public.notes_garder_coherence();


commit;


-- ---------------------------------------------------------------------
-- Vérification : les colonnes, la contrainte des notes, le déclencheur.
-- ---------------------------------------------------------------------

select column_name from information_schema.columns
 where table_schema = 'public' and table_name = 'release_ratings'
   and column_name in ('a_ecouter', 'ecoute_le')
 order by 1;

select conname, pg_get_constraintdef(oid) as definition from pg_constraint
 where conrelid = 'public.release_ratings'::regclass and conname like 'release_ratings_%check';

select tgname from pg_trigger
 where tgrelid = 'public.release_ratings'::regclass and not tgisinternal;
