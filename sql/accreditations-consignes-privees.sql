-- =====================================================================
-- La Wave — accréditations : des consignes réellement privées
--
-- Le problème : les consignes aux photographes retenus (point de
-- rendez-vous, contact sur place, règles de la salle) étaient une
-- colonne de la table des événements. Or cette table est publique :
-- n'importe quel visiteur, même sans compte, pouvait les lire en
-- interrogeant l'API. Le site ne les montrait qu'aux retenus, mais la
-- base, elle, les donnait à tout le monde.
--
-- La correction : les consignes passent dans leur propre table, que la
-- base ne montre qu'à l'équipe et aux photographes retenus pour
-- l'événement concerné. La colonne publique est supprimée.
--
-- Aucune consigne n'était saisie au moment de l'écriture de ce fichier
-- (0 événement sur 3) ; s'il y en avait, elles sont reprises avant la
-- suppression de la colonne.
--
-- À exécuter dans Supabase → SQL Editor, d'un seul bloc. Sans danger
-- si on le repasse. Le site fonctionne avant comme après : tant que ce
-- fichier n'est pas passé, il garde les consignes dans l'ancienne
-- colonne (repli prévu dans BD.consignesTableAbsente).
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. La table : une ligne de consignes par événement
-- ---------------------------------------------------------------------

create table if not exists public.consignes_accreditation (
  evenement_id  uuid primary key
                references public.evenements_accreditation(id) on delete cascade,
  texte         text not null,
  maj_le        timestamptz not null default now()
);

alter table public.consignes_accreditation enable row level security;

drop policy if exists "consignes lues par l'equipe et les retenus" on public.consignes_accreditation;
drop policy if exists "consignes ecrites par l'equipe"             on public.consignes_accreditation;

-- Lecture : l'équipe, et le photographe retenu pour cet événement —
-- personne d'autre, ni les inscrits en attente, ni les non retenus, ni
-- les visiteurs sans compte.
create policy "consignes lues par l'equipe et les retenus"
  on public.consignes_accreditation
  for select
  to authenticated
  using (
    public.est_equipe()
    or exists (
      select 1
      from public.inscriptions_accreditation i
      where i.evenement_id = consignes_accreditation.evenement_id
        and i.user_id = auth.uid()
        and i.statut = 'retenu'
    )
  );

-- Écriture : l'équipe seule.
create policy "consignes ecrites par l'equipe"
  on public.consignes_accreditation
  for all
  to authenticated
  using (public.est_equipe())
  with check (public.est_equipe());


-- ---------------------------------------------------------------------
-- 2. Reprise de l'existant, puis suppression de la colonne publique
--
-- L'ordre compte : on copie d'abord. Si la copie échoue, le fichier
-- s'arrête ici et la colonne reste en place.
-- ---------------------------------------------------------------------

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'evenements_accreditation'
      and column_name = 'consignes'
  ) then

    insert into public.consignes_accreditation (evenement_id, texte)
    select e.id, btrim(e.consignes)
    from public.evenements_accreditation e
    where coalesce(btrim(e.consignes), '') <> ''
    on conflict (evenement_id) do nothing;

    alter table public.evenements_accreditation drop column consignes;

  end if;
end $$;


-- ---------------------------------------------------------------------
-- 3. Vérification
--
-- La première requête doit montrer la table avec RLS activée ; la
-- seconde ne doit plus lister de colonne « consignes » sur les
-- événements ; la troisième compte les consignes reprises.
-- ---------------------------------------------------------------------

select relname as table_name, relrowsecurity as rls_active
from pg_class
where relname = 'consignes_accreditation';

select column_name
from information_schema.columns
where table_schema = 'public'
  and table_name = 'evenements_accreditation'
  and column_name = 'consignes';

select count(*) as consignes_reprises from public.consignes_accreditation;
