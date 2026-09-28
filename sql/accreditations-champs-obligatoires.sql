-- =====================================================================
-- La Wave — téléphone et portfolio deviennent obligatoires
--
-- L'accréditation se demande auprès d'une salle : elle réclame un nom,
-- un moyen de joindre la personne le jour même, et de quoi juger son
-- travail. Le formulaire les exige désormais — mais un champ obligatoire
-- dans le navigateur ne garantit rien : c'est ici que la règle tient.
--
-- Les inscriptions déjà enregistrées sans ces informations restent
-- valides ; seule une nouvelle inscription, ou la modification d'une
-- existante, passe par ce contrôle.
--
-- À exécuter dans Supabase → SQL Editor, après accreditations.sql.
-- =====================================================================

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

  -- Les quatre informations que la salle demande.
  if coalesce(trim(p_nom), '') = '' then
    raise exception 'Le nom est nécessaire.';
  end if;

  if coalesce(trim(p_email), '') = '' then
    raise exception 'L''email est nécessaire.';
  end if;

  if coalesce(trim(p_telephone), '') = '' then
    raise exception 'Le téléphone est nécessaire : la salle demande un contact joignable le jour même.';
  end if;

  if coalesce(trim(p_portfolio), '') = '' then
    raise exception 'Un lien vers ton travail est nécessaire : portfolio, Instagram ou site.';
  end if;

  insert into public.inscriptions_accreditation
    (evenement_id, user_id, nom, email, telephone, portfolio, message)
  values
    (p_evenement, auth.uid(), trim(p_nom), trim(p_email),
     trim(p_telephone), trim(p_portfolio), nullif(trim(p_message), ''))
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
-- Vérification
--
-- Doit renvoyer une ligne : la fonction remplacée, toujours en
-- security definer.
-- ---------------------------------------------------------------------

select proname as fonction, prosecdef as security_definer
from pg_proc
where pronamespace = 'public'::regnamespace
  and proname = 'inscription_accreditation';
