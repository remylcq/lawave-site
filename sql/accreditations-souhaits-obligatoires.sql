-- =====================================================================
-- La Wave — une proposition de concert devient complète
--
-- L'équipe doit pouvoir écrire à la salle sans avoir à chercher : la
-- salle, la ville, la date et le lien vers l'événement sont désormais
-- exigés, comme le nom de l'artiste.
--
-- Le formulaire les réclame déjà ; cette fonction est ce qui le
-- garantit, un champ requis dans le navigateur pouvant se contourner.
--
-- Les propositions déjà envoyées restent telles quelles.
--
-- À exécuter dans Supabase → SQL Editor, après accreditations-souhaits.sql.
-- =====================================================================

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

  if coalesce(trim(p_salle), '') = '' then
    raise exception 'La salle est nécessaire : c''est à elle que l''accréditation se demande.';
  end if;

  if coalesce(trim(p_ville), '') = '' then
    raise exception 'La ville est nécessaire.';
  end if;

  if p_date is null then
    raise exception 'La date du concert est nécessaire.';
  end if;

  -- Une date passée ne sert à personne : la demande arriverait après.
  if p_date < current_date then
    raise exception 'Cette date est déjà passée.';
  end if;

  if coalesce(trim(p_lien), '') = '' then
    raise exception 'Le lien vers l''événement est nécessaire.';
  end if;

  if trim(p_lien) !~* '^https?://' then
    raise exception 'Le lien doit commencer par http:// ou https://';
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
    (auth.uid(), trim(p_artiste), trim(p_salle), trim(p_ville),
     p_date, trim(p_lien), nullif(trim(p_message), ''))
  returning id into v_id;

  return v_id;
end $$;


-- ---------------------------------------------------------------------
-- Vérification
-- ---------------------------------------------------------------------

select proname as fonction, prosecdef as security_definer
from pg_proc
where pronamespace = 'public'::regnamespace
  and proname = 'souhait_accreditation';
