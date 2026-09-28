-- =====================================================================
-- La Wave — les photographes proposent des concerts
--
-- Jusqu'ici l'échange allait dans un seul sens : l'équipe publiait une
-- place, les photographes s'inscrivaient. Cette table porte l'autre
-- sens — les concerts qu'ils aimeraient couvrir, et pour lesquels
-- l'équipe peut aller demander une accréditation.
--
-- Mêmes principes que le reste des accréditations : un photographe ne
-- voit que ses propres propositions, il ne peut pas écrire leur statut,
-- et l'insertion passe par une fonction qui vérifie son rôle.
--
-- À exécuter dans Supabase → SQL Editor, après accreditations.sql.
-- =====================================================================


create table if not exists public.souhaits_accreditation (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  artiste        text not null,
  salle          text,
  ville          text,
  date_souhaitee date,
  lien           text,
  message        text,
  statut         text not null default 'nouveau'
                   check (statut in ('nouveau', 'vu', 'retenu', 'ecarte')),
  reponse        text,
  cree_le        timestamptz not null default now()
);

create index if not exists souhaits_accreditation_statut_idx
  on public.souhaits_accreditation (statut, cree_le desc);

create index if not exists souhaits_accreditation_user_idx
  on public.souhaits_accreditation (user_id);


-- ---------------------------------------------------------------------
-- Règles d'accès
--
-- Aucune policy d'insertion pour les photographes : ils passent par la
-- fonction, qui vérifie le rôle et limite le nombre de propositions en
-- attente. Ils peuvent retirer une proposition tant que l'équipe ne l'a
-- pas regardée.
-- ---------------------------------------------------------------------

alter table public.souhaits_accreditation enable row level security;

drop policy if exists "souhaits visibles"        on public.souhaits_accreditation;
drop policy if exists "souhaits ecrits par equipe" on public.souhaits_accreditation;
drop policy if exists "retrait du souhait"       on public.souhaits_accreditation;

create policy "souhaits visibles"
on public.souhaits_accreditation
for select
to authenticated
using (user_id = auth.uid() or public.est_equipe());

create policy "souhaits ecrits par equipe"
on public.souhaits_accreditation
for all
to authenticated
using (public.est_equipe())
with check (public.est_equipe());

create policy "retrait du souhait"
on public.souhaits_accreditation
for delete
to authenticated
using (user_id = auth.uid() and statut = 'nouveau');


-- ---------------------------------------------------------------------
-- Proposer un concert
--
-- La limite de dix propositions en attente n'est pas une punition :
-- elle garde la liste de l'équipe lisible, et une proposition retirée
-- ou traitée libère aussitôt la place.
-- ---------------------------------------------------------------------

create or replace function public.souhait_accreditation(
  p_artiste text,
  p_salle   text default null,
  p_ville   text default null,
  p_date    date default null,
  p_lien    text default null,
  p_message text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_en_attente integer;
  v_id uuid;
begin

  if auth.uid() is null then
    raise exception 'Connecte-toi pour proposer un concert.';
  end if;

  if not public.est_photographe() then
    raise exception 'Les propositions sont réservées aux comptes photographes.';
  end if;

  if coalesce(trim(p_artiste), '') = '' then
    raise exception 'Le nom de l''artiste est nécessaire.';
  end if;

  select count(*) into v_en_attente
  from public.souhaits_accreditation
  where user_id = auth.uid() and statut = 'nouveau';

  if v_en_attente >= 10 then
    raise exception 'Tu as déjà dix propositions en attente : retires-en une avant d''en ajouter.';
  end if;

  insert into public.souhaits_accreditation
    (user_id, artiste, salle, ville, date_souhaitee, lien, message)
  values
    (auth.uid(), trim(p_artiste), nullif(trim(p_salle), ''), nullif(trim(p_ville), ''),
     p_date, nullif(trim(p_lien), ''), nullif(trim(p_message), ''))
  returning id into v_id;

  return v_id;
end $$;


revoke all on function public.souhait_accreditation(text, text, text, date, text, text) from public;
grant execute on function public.souhait_accreditation(text, text, text, date, text, text) to authenticated;


-- ---------------------------------------------------------------------
-- Vérification
--
-- La table avec RLS activée, puis la fonction en security definer.
-- ---------------------------------------------------------------------

select relname as table_name, relrowsecurity as rls_active
from pg_class
where relname = 'souhaits_accreditation';

select proname as fonction, prosecdef as security_definer
from pg_proc
where pronamespace = 'public'::regnamespace
  and proname = 'souhait_accreditation';
