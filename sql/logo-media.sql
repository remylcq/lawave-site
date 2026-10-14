-- =====================================================================
-- La Wave — le logo d'un média, à côté de son pseudo
--
-- Un média qui fait vérifier son profil envoie aussi son logo, détouré (un PNG
-- sur fond transparent). L'équipe le voit avec la demande ; en validant, le
-- logo s'affiche à côté du pseudo sur le profil. Retirer la vérification, ou
-- changer de rôle, retire le logo.
--
-- Ce que ça change :
--   1. profiles.logo_url et verifications_profil.logo_url : l'adresse du logo (https).
--   2. Le verrou : un membre de l'équipe seul pose ou change profiles.logo_url.
--   3. verification_demander accepte p_logo (exigé pour « Média / Presse »,
--      et seulement une adresse du stockage public « Covers » du site).
--   4. verifications_liste montre le logo à l'équipe ; verification_traiter le
--      pose en validant et le retire en retirant le badge.
--   5. com_profil renvoie logo_url.
--
-- Sans danger à rejouer.
-- =====================================================================

alter table public.profiles
  add column if not exists logo_url text;

alter table public.profiles drop constraint if exists profiles_logo_url_check;
alter table public.profiles
  add constraint profiles_logo_url_check
  check (logo_url is null or (length(logo_url) <= 600 and logo_url ~* '^https://'));

alter table public.verifications_profil
  add column if not exists logo_url text;

alter table public.verifications_profil drop constraint if exists verifications_profil_logo_url_check;
alter table public.verifications_profil
  add constraint verifications_profil_logo_url_check
  check (logo_url is null or (length(logo_url) <= 600 and logo_url ~* '^https://'));


-- 2. Le verrou

create or replace function public.profils_garder_champs_equipe()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin

  if auth.uid() is not null and not public.est_equipe() then

    if tg_op = 'INSERT' then

      new.is_admin     := false;
      new.verifie      := false;
      new.verifie_role := null;
      new.verifie_le   := null;
      new.logo_url     := null;

    else

      new.is_admin := old.is_admin;

      if public.com_role_canonique(new.role) is distinct from public.com_role_canonique(old.role) then

        -- La preuve valait pour l'ancien rôle : la vérification accordée est
        -- close (sans annonce : c'est le membre qui l'a voulu), et une demande
        -- encore en attente n'a plus d'objet.
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


-- 3. La demande : le logo en plus (l'ancienne signature disparaît, sans quoi
-- les deux se disputeraient les appels).

drop function if exists public.verification_demander(text, text, text);

create or replace function public.verification_demander(
  p_preuve  text,
  p_lien    text default null,
  p_message text default null,
  p_logo    text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_moi      uuid := auth.uid();
  v_role     text;
  v_verifie  boolean;
  v_vrole    text;
  v_preuve   text := nullif(btrim(coalesce(p_preuve, '')), '');
  v_lien     text := nullif(btrim(coalesce(p_lien, '')), '');
  v_message  text := nullif(btrim(coalesce(p_message, '')), '');
  v_logo     text := nullif(btrim(coalesce(p_logo, '')), '');
  v_id       uuid;
begin

  if v_moi is null then
    raise exception 'Connecte-toi pour demander une vérification.';
  end if;

  select public.com_role_canonique(p.role), p.verifie, p.verifie_role
    into v_role, v_verifie, v_vrole
    from public.profiles p
   where p.id = v_moi;

  if v_role is null then
    raise exception 'Ton profil est introuvable.';
  end if;

  if not (v_role = any (public.verification_roles())) then
    raise exception 'Ce rôle n''a pas besoin d''être vérifié.';
  end if;

  if v_verifie and v_vrole = v_role then
    raise exception 'Ton profil est déjà vérifié.';
  end if;

  if v_preuve is null then
    raise exception 'Joins une capture d''écran : c''est ce qui permet à l''équipe de vérifier ton profil.';
  end if;

  if v_preuve !~ ('^' || v_moi::text || '/[A-Za-z0-9._-]{1,120}$') then
    raise exception 'Cette capture n''est pas valide : envoie-la de nouveau.';
  end if;

  -- Un média envoie aussi son logo détouré : il ira à côté de son pseudo. Il doit venir du stockage du site
  -- (bucket public « Covers »), pas d'une adresse quelconque. Les autres métiers n'en envoient pas.
  if v_role <> 'Média / Presse' then
    v_logo := null;
  elsif v_logo is null then
    raise exception 'Ajoute le logo de ton média, détouré (un PNG sur fond transparent).';
  end if;

  if v_logo is not null
     and (char_length(v_logo) > 600
          or v_logo !~* '^https://[a-z0-9.-]+\.supabase\.co/storage/v1/object/public/Covers/[A-Za-z0-9._%/-]+$') then
    raise exception 'Ce logo n''est pas valide : envoie-le de nouveau.';
  end if;

  if v_lien is not null
     and (char_length(v_lien) > 300 or v_lien !~* '^https?://[^[:space:]"''<>]+$') then
    raise exception 'Le lien doit commencer par http:// ou https://.';
  end if;

  if char_length(coalesce(v_message, '')) > 500 then
    raise exception 'Le message est trop long (500 caractères au plus).';
  end if;

  -- Une cadence raisonnable : le tri se fait à la main, côté équipe.
  if (select count(*) from public.verifications_profil
       where user_id = v_moi and cree_le > now() - interval '1 day') >= 5 then
    raise exception 'Tu as déjà envoyé plusieurs demandes aujourd''hui : réessaie demain.';
  end if;

  update public.verifications_profil
     set role = v_role, lien = v_lien, message = v_message,
         preuve_chemin = v_preuve, logo_url = v_logo, cree_le = now(), vu = false
   where user_id = v_moi and statut = 'en_attente'
   returning id into v_id;

  if v_id is null then
    insert into public.verifications_profil (user_id, role, lien, message, preuve_chemin, logo_url)
    values (v_moi, v_role, v_lien, v_message, v_preuve, v_logo)
    returning id into v_id;
  end if;

  return v_id;
end $$;


-- 4. Côté équipe

create or replace function public.verifications_liste(
  p_statut  text    default 'en_attente',
  p_limite  integer default 60
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_lignes jsonb;
  v_n      integer;
begin

  if not public.est_equipe() then
    raise exception 'Réservé à l''équipe.';
  end if;

  select count(*) into v_n from public.verifications_profil where statut = 'en_attente';

  select coalesce(jsonb_agg(q.j order by q.tri), '[]'::jsonb)
    into v_lignes
    from (
      select
        jsonb_build_object(
          'id',          v.id,
          'user_id',     v.user_id,
          'role',        v.role,
          'statut',      v.statut,
          'lien',        v.lien,
          'message',     v.message,
          'preuve',      v.preuve_chemin,
          'logo',        v.logo_url,
          'motif_refus', v.motif_refus,
          'cree_le',     v.cree_le,
          'traite_le',   v.traite_le,
          'traite_par',  (select t.pseudo from public.profiles t where t.id = v.traite_par),
          'profil',      jsonb_build_object(
            'pseudo',       p.pseudo,
            'avatar_url',   p.avatar_url,
            'role',         public.com_role_canonique(p.role),
            'bio',          left(coalesce(p.bio, ''), 300),
            'ville',        p.ville,
            'socials',      coalesce(p.socials, '{}'::jsonb),
            'cree_le',      p.created_at,
            'verifie',      p.verifie,
            'verifie_role', p.verifie_role,
            'logo_url',     p.logo_url
          )
        ) as j,
        case when p_statut = 'en_attente'
             then extract(epoch from v.cree_le)
             else -extract(epoch from coalesce(v.traite_le, v.cree_le))
        end as tri
      from public.verifications_profil v
      join public.profiles p on p.id = v.user_id
      where case when p_statut = 'en_attente'
                 then v.statut = 'en_attente'
                 else v.statut <> 'en_attente'
            end
      order by 2
      limit greatest(1, least(coalesce(p_limite, 60), 200))
    ) q;

  return jsonb_build_object('en_attente', v_n, 'lignes', v_lignes);
end $$;


create or replace function public.verification_traiter(
  p_id     uuid,
  p_action text,
  p_motif  text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_moi   uuid := auth.uid();
  v       public.verifications_profil;
  v_role  text;
  v_motif text := nullif(btrim(coalesce(p_motif, '')), '');
begin

  if not public.est_equipe() then
    raise exception 'Réservé à l''équipe.';
  end if;

  select * into v from public.verifications_profil where id = p_id for update;

  if v.id is null then
    raise exception 'Cette demande n''existe plus.';
  end if;

  if char_length(coalesce(v_motif, '')) > 300 then
    raise exception 'Le motif est trop long (300 caractères au plus).';
  end if;

  if p_action = 'valider' then

    if v.statut <> 'en_attente' then
      raise exception 'Cette demande a déjà été traitée.';
    end if;

    select public.com_role_canonique(role) into v_role from public.profiles where id = v.user_id;

    if v_role is distinct from v.role then
      raise exception 'Le rôle du profil a changé depuis la demande (% au lieu de %) : refuse-la, le membre en enverra une nouvelle.',
        coalesce(v_role, '?'), v.role;
    end if;

    update public.verifications_profil
       set statut = 'valide', traite_le = now(), traite_par = v_moi, motif_refus = null, vu = false
     where id = v.id;

    update public.profiles
       set verifie = true, verifie_role = v.role, verifie_le = now(),
           logo_url = coalesce(v.logo_url, logo_url)
     where id = v.user_id;

  elsif p_action = 'refuser' then

    if v.statut <> 'en_attente' then
      raise exception 'Cette demande a déjà été traitée.';
    end if;

    if v_motif is null then
      raise exception 'Dis au membre pourquoi : il lira ce motif.';
    end if;

    update public.verifications_profil
       set statut = 'refuse', traite_le = now(), traite_par = v_moi, motif_refus = v_motif, vu = false
     where id = v.id;

  elsif p_action = 'retirer' then

    if v.statut <> 'valide' then
      raise exception 'Seule une vérification accordée peut être retirée.';
    end if;

    update public.verifications_profil
       set statut = 'retire', traite_le = now(), traite_par = v_moi, motif_refus = v_motif, vu = false
     where id = v.id;

    update public.profiles
       set verifie = false, verifie_role = null, verifie_le = null, logo_url = null
     where id = v.user_id and verifie_role is not distinct from v.role;

  else
    raise exception 'Action inconnue.';
  end if;

end $$;


-- 5. Le profil de la communauté

create or replace function public.com_profil(p_cle text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_moi uuid := auth.uid();
  p     public.profiles;
begin
  if p_cle ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select * into p from public.profiles where id = p_cle::uuid;
  else
    select * into p from public.profiles
     where lower(pseudo) = lower(btrim(coalesce(p_cle, '')))
     limit 1;
  end if;

  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'profil', jsonb_build_object(
      'id',          p.id,
      'pseudo',      p.pseudo,
      'avatar_url',  p.avatar_url,
      'banniere_url', p.banniere_url,
      'logo_url',    p.logo_url,
      'bio',         coalesce(p.bio, ''),
      'role',        public.com_role_canonique(p.role),
      'xp',          coalesce(p.xp, 0),
      'ville',       p.ville,
      'cherche',     to_jsonb(p.cherche),
      'propose',     to_jsonb(p.propose),
      'genres',      to_jsonb(p.genres),
      'socials',     coalesce(p.socials, '{}'::jsonb),
      'equipe',      coalesce(p.is_admin, false),
      'verifie',     coalesce(p.verifie, false),
      'verifie_role', p.verifie_role,
      'cree_le',     p.created_at,
      'artiste',     (select a.instagram_handle from public.artists a
                       where a.verifie_par = p.id order by a.instagram_handle limit 1),
      'artiste_nom', (select coalesce(a.display_name, a.instagram_handle) from public.artists a
                       where a.verifie_par = p.id order by a.instagram_handle limit 1)
    ),
    'stats', jsonb_build_object(
      'posts',       (select count(*) from public.com_posts where auteur_id = p.id),
      'collabs',     (select count(*) from public.com_posts where auteur_id = p.id and type = 'collab'),
      'abonnes',     (select count(*) from public.com_suivis where suivi_id = p.id),
      'abonnements', (select count(*) from public.com_suivis where suiveur_id = p.id)
    ),
    'moi', jsonb_build_object(
      'soi',        v_moi is not null and v_moi = p.id,
      'suit',       exists (select 1 from public.com_suivis where suiveur_id = v_moi and suivi_id = p.id),
      'suivi_par',  exists (select 1 from public.com_suivis where suiveur_id = p.id and suivi_id = v_moi),
      'bloque',     exists (select 1 from public.com_blocages where user_id = v_moi and bloque_id = p.id),
      'bloque_par', exists (select 1 from public.com_blocages where user_id = p.id and bloque_id = v_moi)
    )
  );
end $$;


-- 6. Qui peut appeler quoi

revoke all on function public.verification_demander(text, text, text, text) from public, anon;
grant execute on function public.verification_demander(text, text, text, text) to authenticated;
revoke all on function public.verifications_liste(text, integer)             from public, anon;
grant execute on function public.verifications_liste(text, integer)             to authenticated;
revoke all on function public.verification_traiter(uuid, text, text)         from public, anon;
grant execute on function public.verification_traiter(uuid, text, text)         to authenticated;
grant execute on function public.com_profil(text)                              to anon, authenticated;
