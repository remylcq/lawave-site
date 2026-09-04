-- =====================================================================
-- La Wave — clip des sorties, et gestion de page par l'artiste
--
-- Ce script rattrape ce qui manque en base pour deux fonctions déjà
-- présentes dans le site :
--
--   1. le lien du clip d'une sortie (submissions.clip_url) ;
--   2. la demande d'un membre à gérer la page d'un artiste, et sa
--      validation par l'équipe (trois colonnes sur artists, une règle
--      d'accès, un déclencheur et une fonction).
--
-- Sans la première, publier une sortie échoue avec le message
-- « Could not find the 'clip_url' column of 'submissions' ».
--
-- À exécuter dans Supabase → SQL Editor, d'un seul bloc.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Le clip
-- ---------------------------------------------------------------------

alter table public.submissions
  add column if not exists clip_url text;


-- ---------------------------------------------------------------------
-- 2. La propriété d'une page artiste
--
-- demande_par : le membre qui demande à gérer la page.
-- demande_le  : quand, pour que l'équipe traite dans l'ordre.
-- verifie_par : le membre à qui l'équipe a accordé la page.
-- ---------------------------------------------------------------------

alter table public.artists
  add column if not exists demande_par uuid references auth.users(id) on delete set null,
  add column if not exists demande_le  timestamptz,
  add column if not exists verifie_par uuid references auth.users(id) on delete set null;


-- ---------------------------------------------------------------------
-- 3. Qui fait partie de l'équipe
--
-- Déjà créée par sql/soumission-reservee.sql. Reprise ici pour que ce
-- script tienne debout seul, et parce que « create or replace » ne
-- casse rien s'il l'a déjà été.
-- ---------------------------------------------------------------------

create or replace function public.est_equipe()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select p.is_admin from public.profiles p where p.id = auth.uid()),
    false
  );
$$;


-- ---------------------------------------------------------------------
-- 4. L'artiste vérifié peut modifier sa page
--
-- Les policies se cumulent : celles de l'équipe restent en place, on
-- ajoute simplement le cas de l'artiste à qui la page a été accordée.
-- Le « with check » sur la même condition l'empêche de passer la page
-- à quelqu'un d'autre au passage.
-- ---------------------------------------------------------------------

drop policy if exists "artiste verifie modifie sa page" on public.artists;

create policy "artiste verifie modifie sa page"
on public.artists
for update
to authenticated
using (verifie_par = auth.uid())
with check (verifie_par = auth.uid());


-- ---------------------------------------------------------------------
-- 5. Le déclencheur qui gèle les trois colonnes
--
-- La règle ci-dessus donne à l'artiste vérifié le droit d'écrire sur
-- sa ligne — donc, sans garde-fou, celui de se déclarer propriétaire
-- d'une autre page ou de s'auto-valider. Ces trois colonnes ne
-- bougent plus que par l'équipe, à une exception près : déposer sa
-- propre demande sur une page encore libre.
--
-- L'insertion est gardée elle aussi : le formulaire public crée des
-- profils d'artistes, une ligne ne doit pas pouvoir naître déjà
-- vérifiée.
-- ---------------------------------------------------------------------

create or replace function public.artists_gel_verification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin

  if public.est_equipe() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.demande_par is not null
       or new.demande_le is not null
       or new.verifie_par is not null then
      raise exception 'Ces colonnes sont réservées à l''équipe.';
    end if;
    return new;
  end if;

  if new.verifie_par is distinct from old.verifie_par then
    raise exception 'Seule l''équipe peut accorder la gestion d''une page.';
  end if;

  -- Seul cas autorisé : déposer sa propre demande sur une page libre.
  if new.demande_par is distinct from old.demande_par
     and not (old.demande_par is null and new.demande_par = auth.uid()) then
    raise exception 'Demande de gestion invalide.';
  end if;

  return new;
end $$;

drop trigger if exists artists_gel_verification on public.artists;

create trigger artists_gel_verification
before insert or update on public.artists
for each row
execute function public.artists_gel_verification();


-- ---------------------------------------------------------------------
-- 6. Demander à gérer une page
--
-- Passe par une fonction plutôt que par une écriture directe : un
-- membre ordinaire n'a aucun droit d'écriture sur artists, c'est elle
-- qui dépose la demande pour lui. Elle ne touche qu'une page encore
-- libre, et n'écrit que l'identifiant de l'appelant.
-- ---------------------------------------------------------------------

create or replace function public.demander_verification_artiste(p_handle text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin

  if auth.uid() is null then
    raise exception 'Connexion requise.';
  end if;

  update public.artists
     set demande_par = auth.uid(),
         demande_le  = now()
   where instagram_handle = p_handle
     and demande_par is null
     and verifie_par is null;

  if not found then
    raise exception 'Cette page est déjà demandée ou déjà gérée.';
  end if;

end $$;

revoke all on function public.demander_verification_artiste(text) from public;
grant execute on function public.demander_verification_artiste(text) to authenticated;


-- ---------------------------------------------------------------------
-- 7. Vérification
--
-- Les quatre colonnes doivent apparaître, puis la règle, le
-- déclencheur et la fonction.
-- ---------------------------------------------------------------------

select table_name, column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and (
    (table_name = 'submissions' and column_name = 'clip_url') or
    (table_name = 'artists' and column_name in ('demande_par','demande_le','verifie_par'))
  )
order by table_name, column_name;

select policyname, cmd from pg_policies
where schemaname = 'public' and tablename = 'artists'
order by cmd, policyname;

select tgname from pg_trigger
where tgrelid = 'public.artists'::regclass and not tgisinternal;
