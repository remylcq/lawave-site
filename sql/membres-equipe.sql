-- =====================================================================
-- La Wave — espace équipe, onglet « Membres »
--
-- Demande de Rémy : « avoir un accès dans l'espace équipe pour voir les profils
-- utilisateur qui sont créés pour pouvoir supprimer certains qui sont des
-- tests ».
--
--   membres_liste()          tous les comptes, du plus récent au plus ancien :
--                            pseudo, rôle, adresse e-mail, dernière connexion,
--                            et ce que le compte a produit (messages, notes).
--   membre_supprimer(p_id)   supprime le compte et tout ce qui lui est lié.
--
-- Réservé à l'équipe (est_equipe). Les adresses e-mail ne sortent donc que vers
-- elle. La suppression refuse : son propre compte, un compte de l'équipe (il
-- faut d'abord lui retirer ce droit), un compte inexistant.
--
-- Supprimer la ligne de auth.users suffit : profiles, messages, notes, suivis,
-- demandes de vérification, accréditations, jeu… partent en cascade (voir les
-- clés étrangères) ; les liens « créé par / traité par » repassent à vide.
-- Les fichiers déposés dans les buckets de stockage ne sont pas touchés.
--
-- Sans danger à rejouer.
-- =====================================================================

create or replace function public.membres_liste()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin

  if not public.est_equipe() then
    raise exception 'Réservé à l''équipe.';
  end if;

  return coalesce((
    select jsonb_agg(q.j order by q.cree desc)
      from (
        select
          p.created_at as cree,
          jsonb_build_object(
            'id',           p.id,
            'pseudo',       p.pseudo,
            'role',         public.com_role_canonique(p.role),
            'avatar_url',   p.avatar_url,
            'email',        u.email,
            'cree_le',      p.created_at,
            'connecte_le',  u.last_sign_in_at,
            'is_admin',     coalesce(p.is_admin, false),
            'verifie',      coalesce(p.verifie, false),
            'nb_posts',     (select count(*) from public.com_posts x where x.auteur_id = p.id),
            'nb_notes',     (select count(*) from public.release_ratings x where x.user_id = p.id)
          ) as j
        from public.profiles p
        left join auth.users u on u.id = p.id
      ) q
  ), '[]'::jsonb);
end $$;


create or replace function public.membre_supprimer(p_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pseudo text;
  v_admin  boolean;
begin

  if not public.est_equipe() then
    raise exception 'Réservé à l''équipe.';
  end if;

  if p_id is null or p_id = auth.uid() then
    raise exception 'Tu ne peux pas supprimer ton propre compte ici.';
  end if;

  select p.pseudo, coalesce(p.is_admin, false)
    into v_pseudo, v_admin
    from public.profiles p
   where p.id = p_id;

  if not found then
    raise exception 'Compte introuvable.';
  end if;

  if v_admin then
    raise exception 'C''est un compte de l''équipe : retire-lui d''abord ce droit.';
  end if;

  delete from auth.users where id = p_id;

  return v_pseudo;
end $$;


revoke all on function public.membres_liste()          from public, anon;
revoke all on function public.membre_supprimer(uuid)   from public, anon;
grant execute on function public.membres_liste()        to authenticated;
grant execute on function public.membre_supprimer(uuid) to authenticated;
