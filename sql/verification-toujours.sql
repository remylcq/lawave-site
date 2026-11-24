-- ============================================================
-- La vérification des profils est toujours exigée : l'interrupteur « en pause » disparaît.
-- À passer une fois en production (rejouable).
--
-- Un photographe accède aux accréditations seulement s'il est vérifié comme photographe (ou membre de l'équipe).
-- On retire la table de réglage et ses deux fonctions.
-- ============================================================

create or replace function public.est_photographe()
returns boolean
language sql stable security definer set search_path to 'public'
as $$
  select coalesce((
    select p.is_admin
        or ((public.com_role_canonique(p.role) = 'Photographe' or 'Photographe' = any (p.roles_supp))
            and p.verifie and p.verifie_role = 'Photographe')
    from public.profiles p
    where p.id = auth.uid()
  ), false);
$$;

drop function if exists public.verification_regler(boolean);
drop function if exists public.verification_exigee();
drop table if exists public.verification_reglage;
