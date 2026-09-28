-- =====================================================================
-- La Wave — accréditations photo
--
-- Deux tables : les événements que l'équipe publie (un concert, un
-- festival) et les inscriptions des photographes au tirage au sort.
--
-- Trois principes tiennent tout le fichier :
--
--   1. un photographe ne voit que ses propres inscriptions — jamais
--      celles des autres, ni leur téléphone, ni leur email ;
--   2. un photographe ne peut pas écrire son propre statut : s'inscrire,
--      se retirer et livrer ses photos passent par trois fonctions, et
--      « retenu » ne s'obtient que par le tirage ;
--   3. le tirage se fait ici, en base, et non dans le navigateur : il
--      est aléatoire, atomique, et personne ne peut le rejouer à son
--      avantage.
--
-- À exécuter dans Supabase → SQL Editor, d'un seul bloc.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Qui est photographe ?
--
-- Même forme que peut_soumettre() : security definer pour lire profiles
-- sans dépendre de ses règles de lecture, search_path figé pour qu'on ne
-- puisse pas glisser une autre table sous le même nom.
--
-- L'équipe passe quel que soit son rôle affiché, comme partout ailleurs.
-- ---------------------------------------------------------------------

create or replace function public.est_photographe()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select p.is_admin or p.role = 'Photographe'
    from public.profiles p
    where p.id = auth.uid()
  ), false);
$$;


-- ---------------------------------------------------------------------
-- 2. Les événements
--
-- « brouillon » reste invisible du public : l'équipe prépare la fiche,
-- puis l'ouvre. « ferme » garde la fiche visible mais coupe les
-- inscriptions ; « termine » l'archive une fois les photos reçues.
-- ---------------------------------------------------------------------

create table if not exists public.evenements_accreditation (
  id                    uuid primary key default gen_random_uuid(),
  artiste               text not null,
  salle                 text not null,
  ville                 text,
  date_evenement        timestamptz not null,
  places                integer not null default 1 check (places >= 1),
  inscriptions_jusqu_au timestamptz,
  statut                text not null default 'brouillon'
                          check (statut in ('brouillon', 'ouvert', 'ferme', 'termine')),
  description           text,
  -- Affichées aux seuls photographes retenus : point de rendez-vous,
  -- nom du contact sur place, règles de la salle.
  consignes             text,
  image_url             text,
  cree_le               timestamptz not null default now(),
  cree_par              uuid references auth.users(id) on delete set null
);

create index if not exists evenements_accreditation_statut_idx
  on public.evenements_accreditation (statut, date_evenement);


-- ---------------------------------------------------------------------
-- 3. Les inscriptions
--
-- Les coordonnées sont saisies à l'inscription plutôt que reprises du
-- compte : c'est ce qui rend le consentement explicite, et le
-- photographe peut donner une autre adresse que celle de sa connexion.
--
-- Une seule inscription par personne et par événement.
-- ---------------------------------------------------------------------

create table if not exists public.inscriptions_accreditation (
  id              uuid primary key default gen_random_uuid(),
  evenement_id    uuid not null references public.evenements_accreditation(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  nom             text not null,
  email           text not null,
  telephone       text,
  portfolio       text,
  message         text,
  statut          text not null default 'inscrit'
                    check (statut in ('inscrit', 'retenu', 'non_retenu')),
  tirage_le       timestamptz,
  livraison_url   text,
  livraison_le    timestamptz,
  livraison_recue boolean not null default false,
  cree_le         timestamptz not null default now(),
  unique (evenement_id, user_id)
);

create index if not exists inscriptions_accreditation_evenement_idx
  on public.inscriptions_accreditation (evenement_id, statut);

create index if not exists inscriptions_accreditation_user_idx
  on public.inscriptions_accreditation (user_id);


-- ---------------------------------------------------------------------
-- 4. Règles de lecture et d'écriture
--
-- Les événements sont publics dès qu'ils quittent le brouillon : la page
-- doit pouvoir les montrer à un visiteur pas encore inscrit, pour qu'il
-- sache ce qu'il gagnerait à créer un compte.
--
-- Les inscriptions, elles, ne sortent jamais de leur propriétaire.
-- ---------------------------------------------------------------------

alter table public.evenements_accreditation   enable row level security;
alter table public.inscriptions_accreditation enable row level security;

drop policy if exists "evenements visibles"        on public.evenements_accreditation;
drop policy if exists "evenements ecrits par equipe" on public.evenements_accreditation;
drop policy if exists "inscriptions visibles"      on public.inscriptions_accreditation;
drop policy if exists "inscriptions ecrites par equipe" on public.inscriptions_accreditation;
drop policy if exists "retrait par le photographe"  on public.inscriptions_accreditation;

create policy "evenements visibles"
on public.evenements_accreditation
for select
to anon, authenticated
using (statut <> 'brouillon' or public.est_equipe());

create policy "evenements ecrits par equipe"
on public.evenements_accreditation
for all
to authenticated
using (public.est_equipe())
with check (public.est_equipe());

create policy "inscriptions visibles"
on public.inscriptions_accreditation
for select
to authenticated
using (user_id = auth.uid() or public.est_equipe());

-- L'équipe corrige au besoin : ajouter quelqu'un oublié, marquer des
-- photos reçues. Les photographes, eux, n'écrivent que par les
-- fonctions ci-dessous — aucune policy d'insert ou d'update pour eux.
create policy "inscriptions ecrites par equipe"
on public.inscriptions_accreditation
for all
to authenticated
using (public.est_equipe())
with check (public.est_equipe());

-- Se retirer reste possible tant que le tirage n'a pas eu lieu.
create policy "retrait par le photographe"
on public.inscriptions_accreditation
for delete
to authenticated
using (user_id = auth.uid() and statut = 'inscrit');


-- ---------------------------------------------------------------------
-- 5. S'inscrire
--
-- La fonction vérifie tout ce qu'une policy ne saurait pas dire d'un
-- seul tenant : le rôle, l'état de l'événement, la date limite. Un
-- second appel met à jour les coordonnées plutôt que d'échouer.
-- ---------------------------------------------------------------------

create or replace function public.inscription_accreditation(
  p_evenement uuid,
  p_nom       text,
  p_email     text,
  p_telephone text default null,
  p_portfolio text default null,
  p_message   text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_evenement public.evenements_accreditation%rowtype;
  v_id uuid;
begin

  if auth.uid() is null then
    raise exception 'Connecte-toi pour t''inscrire.';
  end if;

  if not public.est_photographe() then
    raise exception 'Les inscriptions sont réservées aux comptes photographes.';
  end if;

  select * into v_evenement
  from public.evenements_accreditation
  where id = p_evenement;

  if v_evenement.id is null then
    raise exception 'Cet événement n''existe plus.';
  end if;

  if v_evenement.statut <> 'ouvert' then
    raise exception 'Les inscriptions ne sont pas ouvertes pour cet événement.';
  end if;

  if v_evenement.inscriptions_jusqu_au is not null
     and now() > v_evenement.inscriptions_jusqu_au then
    raise exception 'La date limite d''inscription est passée.';
  end if;

  if coalesce(trim(p_nom), '') = '' or coalesce(trim(p_email), '') = '' then
    raise exception 'Le nom et l''email sont nécessaires.';
  end if;

  insert into public.inscriptions_accreditation
    (evenement_id, user_id, nom, email, telephone, portfolio, message)
  values
    (p_evenement, auth.uid(), trim(p_nom), trim(p_email),
     nullif(trim(p_telephone), ''), nullif(trim(p_portfolio), ''),
     nullif(trim(p_message), ''))
  on conflict (evenement_id, user_id) do update
    set nom       = excluded.nom,
        email     = excluded.email,
        telephone = excluded.telephone,
        portfolio = excluded.portfolio,
        message   = excluded.message
  returning id into v_id;

  return v_id;
end $$;


-- ---------------------------------------------------------------------
-- 6. Livrer ses photos
--
-- Un lien, rien de plus : les fichiers d'un concert pèsent trop lourd
-- pour le stockage du site, et les photographes travaillent déjà avec
-- WeTransfer ou Drive.
-- ---------------------------------------------------------------------

create or replace function public.livraison_accreditation(
  p_evenement uuid,
  p_lien      text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin

  if coalesce(trim(p_lien), '') = '' then
    raise exception 'Le lien est vide.';
  end if;

  if trim(p_lien) !~* '^https?://' then
    raise exception 'Le lien doit commencer par http:// ou https://';
  end if;

  update public.inscriptions_accreditation
     set livraison_url = trim(p_lien),
         livraison_le  = now()
   where evenement_id = p_evenement
     and user_id      = auth.uid()
     and statut       = 'retenu';

  if not found then
    raise exception 'Aucune accréditation retenue à ton nom pour cet événement.';
  end if;

end $$;


-- ---------------------------------------------------------------------
-- 7. Le tirage au sort
--
-- Fait en base pour trois raisons : le hasard ne dépend pas du
-- navigateur de celui qui clique, l'opération est atomique, et les
-- inscriptions des autres n'ont jamais à descendre côté client.
--
-- Un second appel complète les places restées libres sans défaire le
-- premier tirage : personne ne perd une place déjà obtenue.
-- ---------------------------------------------------------------------

create or replace function public.tirage_accreditation(p_evenement uuid)
returns table (nom text, email text, telephone text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_places  integer;
  v_retenus integer;
begin

  if not public.est_equipe() then
    raise exception 'Le tirage est réservé à l''équipe.';
  end if;

  select e.places into v_places
  from public.evenements_accreditation e
  where e.id = p_evenement;

  if v_places is null then
    raise exception 'Cet événement n''existe plus.';
  end if;

  select count(*) into v_retenus
  from public.inscriptions_accreditation i
  where i.evenement_id = p_evenement and i.statut = 'retenu';

  update public.inscriptions_accreditation
     set statut = 'retenu', tirage_le = now()
   where id in (
     select i.id
     from public.inscriptions_accreditation i
     where i.evenement_id = p_evenement
       and i.statut = 'inscrit'
     order by random()
     limit greatest(v_places - v_retenus, 0)
   );

  -- Tous les autres ont leur réponse dans la foulée : une inscription
  -- laissée en attente sans nouvelle est le plus sûr moyen de perdre
  -- quelqu'un pour le prochain concert.
  update public.inscriptions_accreditation
     set statut = 'non_retenu', tirage_le = now()
   where evenement_id = p_evenement
     and statut = 'inscrit';

  return query
    select i.nom, i.email, i.telephone
    from public.inscriptions_accreditation i
    where i.evenement_id = p_evenement
      and i.statut = 'retenu'
    order by i.nom;

end $$;


-- ---------------------------------------------------------------------
-- 8. Combien d'inscrits par événement
--
-- Le nombre est public — il dit à chacun ses chances — mais les lignes
-- ne le sont pas. D'où une fonction qui ne renvoie que des comptes.
-- ---------------------------------------------------------------------

create or replace function public.compte_inscriptions_accreditation()
returns table (evenement_id uuid, inscrits bigint)
language sql
stable
security definer
set search_path = public
as $$
  select i.evenement_id, count(*)
  from public.inscriptions_accreditation i
  group by i.evenement_id;
$$;


-- ---------------------------------------------------------------------
-- 9. Qui peut appeler quoi
-- ---------------------------------------------------------------------

revoke all on function public.inscription_accreditation(uuid, text, text, text, text, text) from public;
revoke all on function public.livraison_accreditation(uuid, text) from public;
revoke all on function public.tirage_accreditation(uuid) from public;
revoke all on function public.compte_inscriptions_accreditation() from public;

grant execute on function public.inscription_accreditation(uuid, text, text, text, text, text) to authenticated;
grant execute on function public.livraison_accreditation(uuid, text) to authenticated;
grant execute on function public.tirage_accreditation(uuid) to authenticated;
grant execute on function public.compte_inscriptions_accreditation() to anon, authenticated;


-- ---------------------------------------------------------------------
-- 10. Vérification
--
-- La première requête doit lister les deux tables avec RLS activée.
-- La seconde, les cinq fonctions. La troisième ne renvoie rien tant
-- qu'aucun événement n'est créé.
-- ---------------------------------------------------------------------

select relname as table_name, relrowsecurity as rls_active
from pg_class
where relname in ('evenements_accreditation', 'inscriptions_accreditation');

select proname as fonction, prosecdef as security_definer
from pg_proc
where pronamespace = 'public'::regnamespace
  and proname in (
    'est_photographe', 'inscription_accreditation', 'livraison_accreditation',
    'tirage_accreditation', 'compte_inscriptions_accreditation'
  )
order by proname;

select statut, count(*) from public.evenements_accreditation group by statut;
