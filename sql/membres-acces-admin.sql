-- =====================================================================
-- La Wave — donner et retirer l'accès admin à un membre
--
-- Demande de Rémy : « il faudrait que je puisse donner a certains membres l'accès admin, comme ça il pourra voir
-- les pages cachées, je pourrais lui retirer quand je souhaite ».
--
--   profiles.proprietaire        vrai pour le propriétaire du site (Rémy) : lui seul donne et retire l'accès. Cette
--                                colonne ne se change pas depuis le site, ni par lui ni par un admin.
--   membre_acces_regler(id, oui) donne (oui) ou retire (non) l'accès admin d'un membre. Refuse : un appel qui ne vient
--                                pas du propriétaire, son propre compte, un compte inexistant, le propriétaire.
--   membres_liste()              renvoie aussi « proprietaire », pour que l'onglet Membres sache qui voit les boutons.
--
-- L'accès admin (profiles.is_admin) ne passe plus que par membre_acces_regler : le déclencheur
-- profils_garder_champs_equipe remet is_admin à sa valeur d'avant pour tout appel venu du site, admin compris
-- (jusqu'ici, un admin pouvait modifier la sienne). Les modifications faites depuis l'éditeur SQL de Supabase
-- (auth.uid() vide) restent possibles, c'est le secours du propriétaire.
--
-- Sans danger à rejouer.
-- =====================================================================

alter table public.profiles add column if not exists proprietaire boolean not null default false;

update public.profiles set proprietaire = true where id = '9bb3ee9c-b0ff-4c79-8d16-41e7fc077e41';   -- Rémy


-- Le déclencheur : tout ce qu'il faisait déjà, plus deux gardes (propriétaire, is_admin) pour les appels du site.
create or replace function public.profils_garder_champs_equipe()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin

  if auth.uid() is not null then

    if tg_op = 'INSERT' then
      new.proprietaire := false;
      new.is_admin     := false;
    else
      new.proprietaire := old.proprietaire;
      -- L'accès admin ne change que par membre_acces_regler (qui lève ce drapeau le temps d'une écriture).
      if coalesce(current_setting('lawave.acces_ok', true), '0') <> '1' then
        new.is_admin := old.is_admin;
      end if;
    end if;

  end if;

  if auth.uid() is not null and not public.est_equipe() then

    if coalesce(current_setting('lawave.xp_ok', true), '0') <> '1' then
      if tg_op = 'INSERT' then
        new.xp := 0;
      else
        new.xp := old.xp;
      end if;
    end if;

    if tg_op = 'INSERT' then

      new.is_admin     := false;
      new.verifie      := false;
      new.verifie_role := null;
      new.verifie_le   := null;
      new.logo_url     := null;

    else

      new.is_admin := old.is_admin;

      if public.com_role_canonique(new.role) is distinct from public.com_role_canonique(old.role) then

        update public.verifications_profil
           set statut = 'retire', traite_le = now(), motif_refus = 'Rôle modifié', vu = true
         where user_id = new.id and statut = 'valide';

        delete from public.verifications_profil
         where user_id = new.id and statut = 'en_attente';

        new.verifie      := false;
        new.verifie_role := null;
        new.verifie_le   := null;
        new.logo_url     := null;

      else
        new.verifie      := old.verifie;
        new.verifie_role := old.verifie_role;
        new.verifie_le   := old.verifie_le;
        new.logo_url     := old.logo_url;
      end if;

    end if;

  end if;

  return new;
end $$;


-- Donner ou retirer l'accès admin (propriétaire seulement).
create or replace function public.membre_acces_regler(p_id uuid, p_admin boolean)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_cible public.profiles%rowtype;
begin

  if auth.uid() is null then
    raise exception 'Connecte-toi.';
  end if;

  if not coalesce((select p.proprietaire from public.profiles p where p.id = auth.uid()), false) then
    raise exception 'Seul le propriétaire du site peut donner ou retirer l''accès admin.';
  end if;

  if p_id is null or p_admin is null then
    raise exception 'Choisis un membre.';
  end if;

  if p_id = auth.uid() then
    raise exception 'Ton propre accès ne se change pas ici.';
  end if;

  select * into v_cible from public.profiles where id = p_id for update;

  if not found then
    raise exception 'Ce compte n''existe pas.';
  end if;

  if v_cible.proprietaire then
    raise exception 'Le propriétaire garde toujours son accès.';
  end if;

  perform set_config('lawave.acces_ok', '1', true);

  update public.profiles set is_admin = p_admin where id = p_id;

  perform set_config('lawave.acces_ok', '0', true);

  return jsonb_build_object('id', p_id, 'is_admin', p_admin);
end $$;

revoke all on function public.membre_acces_regler(uuid, boolean) from public, anon;
grant execute on function public.membre_acces_regler(uuid, boolean) to authenticated;


-- La liste des membres : ajoute « proprietaire » à chaque ligne.
do $$
declare d text;
begin
  d := pg_get_functiondef('public.membres_liste()'::regprocedure);
  if position('''proprietaire''' in d) = 0 then
    d := replace(d, '''is_admin'',     coalesce(p.is_admin, false),', '''is_admin'',     coalesce(p.is_admin, false), ''proprietaire'', coalesce(p.proprietaire, false),');
    if position('''proprietaire''' in d) = 0 then raise exception 'membres_liste : motif introuvable'; end if;
    execute d;
  end if;
end $$;
