-- =====================================================================
-- La Wave — profils : le droit « équipe » ne se donne plus soi-même
--
-- Le problème : la règle de modification de `profiles` dit seulement
-- « chacun modifie sa propre ligne » (auth.uid() = id), sans limiter
-- les colonnes, et les comptes connectés ont le droit d'écrire dans
-- toutes. Résultat : n'importe quel compte connecté pouvait, en appelant
-- l'API avec son propre jeton, mettre `is_admin = true` sur son profil
-- — et devenir « équipe » : lire les inscriptions des photographes
-- (noms, e-mails, téléphones), supprimer des événements, bannir des
-- artistes, modérer la communauté.
--
-- Au moment de l'écriture, seuls Rémy et Yanis sont admins : rien n'a
-- été exploité.
--
-- La correction : un déclencheur refuse de changer `is_admin` quand la
-- modification vient d'un compte connecté qui n'est pas déjà équipe.
--   • à la création d'un profil : `is_admin` est forcé à faux ;
--   • à la modification : `is_admin` garde son ancienne valeur ;
--   • l'équipe peut toujours donner ou retirer le droit à quelqu'un ;
--   • l'éditeur SQL de Supabase et les fonctions de la base (qui ne
--     sont pas un compte connecté : auth.uid() est nul) passent comme
--     avant.
--
-- À exécuter dans Supabase → SQL Editor, d'un seul bloc. Sans danger
-- si on le repasse.
-- =====================================================================

create or replace function public.profils_garder_is_admin()
returns trigger
language plpgsql
set search_path = public
as $$
begin

  if auth.uid() is not null and not public.est_equipe() then

    if tg_op = 'INSERT' then
      new.is_admin := false;
    else
      new.is_admin := old.is_admin;
    end if;

  end if;

  return new;
end $$;

drop trigger if exists profils_garder_is_admin on public.profiles;

create trigger profils_garder_is_admin
  before insert or update on public.profiles
  for each row
  execute function public.profils_garder_is_admin();


-- ---------------------------------------------------------------------
-- Vérification : une ligne, le déclencheur en place.
-- ---------------------------------------------------------------------

select tgname as declencheur, tgenabled as actif
from pg_trigger
where tgrelid = 'public.profiles'::regclass
  and tgname = 'profils_garder_is_admin';
