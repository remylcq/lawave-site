-- =====================================================================
-- La Wave — la soumission de sorties devient réservée
--
-- Avant : n'importe qui, connecté ou non, pouvait insérer une ligne
-- dans submissions. Le formulaire était ouvert, la base aussi.
--
-- Après : seuls les comptes connectés dont le rôle figure dans la liste
-- ci-dessous peuvent déposer une sortie, et l'équipe passe quel que
-- soit son rôle.
--
-- À exécuter dans Supabase → SQL Editor, d'un seul bloc.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Qui a le droit de déposer une sortie ?
--
-- Une fonction plutôt qu'une condition écrite dans la policy : elle est
-- réutilisable, et surtout lisible quand il faudra la relire dans six
-- mois. security definer pour qu'elle lise profiles sans dépendre des
-- règles de lecture de cette table ; search_path figé pour qu'on ne
-- puisse pas lui glisser une autre table sous le même nom.
--
-- Les deux derniers libellés sont les anciens : un compte enregistré
-- « Manager / Booker » avant le changement de libellés doit continuer
-- de passer. Sa valeur sera réécrite au prochain enregistrement de son
-- profil, et ces deux lignes pourront disparaître.
-- ---------------------------------------------------------------------

create or replace function public.peut_soumettre()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select p.is_admin
        or p.role in (
             'Artiste',
             'Beatmaker',
             'Membre d''un label',
             'Manager',
             'Relation presse',
             'Manager / Booker',   -- ancien libellé
             'Booker'              -- ancien libellé
           )
    from public.profiles p
    where p.id = auth.uid()
  ), false);
$$;


-- Qui fait partie de l'équipe. Sert à laisser passer l'espace équipe
-- sur les états autres que « pending ».
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
-- 2. Retirer les anciennes règles d'insertion
--
-- Les policies d'une même commande se cumulent : tant que l'ancienne
-- règle « tout le monde peut insérer » existe, la nouvelle ne restreint
-- rien. On les retire par la liste plutôt que par leur nom, qu'on n'a
-- pas besoin de connaître.
--
-- Seules les policies d'INSERT sont touchées. Celles de lecture, de
-- modification et de suppression restent en place.
-- ---------------------------------------------------------------------

do $$
declare regle record;
begin
  for regle in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename  = 'submissions'
      and cmd        = 'INSERT'
  loop
    execute format('drop policy %I on public.submissions', regle.policyname);
    raise notice 'Ancienne règle retirée : %', regle.policyname;
  end loop;
end $$;


-- ---------------------------------------------------------------------
-- 3. La nouvelle règle
--
-- « to authenticated » exclut déjà les visiteurs anonymes. La condition
-- sur le statut reprend la règle existante : une sortie entre en
-- attente, c'est la validation qui lui donne son numéro de catalogue.
-- L'équipe, elle, n'est pas tenue par cet état.
-- ---------------------------------------------------------------------

create policy "soumission reservee aux comptes autorises"
on public.submissions
for insert
to authenticated
with check (
  public.peut_soumettre()
  and (status = 'pending' or public.est_equipe())
);


-- ---------------------------------------------------------------------
-- 4. Vérification
--
-- La première requête doit renvoyer une seule ligne d'INSERT, la
-- nouvelle. La seconde liste les comptes qui ont tous les droits :
-- il ne doit y avoir que Rémy et Yanis.
-- ---------------------------------------------------------------------

select policyname, cmd, roles, with_check
from pg_policies
where schemaname = 'public'
  and tablename  = 'submissions'
order by cmd, policyname;

select pseudo, role, is_admin
from public.profiles
where is_admin
order by pseudo;
