-- =====================================================================
-- La Wave — profils vérifiés
--
-- Un membre qui se dit photographe, artiste, journaliste... peut prouver
-- qu'il l'est : il envoie une capture d'écran (son compte Instagram, sa
-- page artiste, son site...) et l'équipe valide ou refuse depuis l'espace
-- équipe (onglet « Profils »). Un profil validé porte le badge « Profil
-- vérifié », partout où son nom s'affiche.
--
-- Ce que ce fichier met en place :
--
--   1. trois colonnes sur `profiles` : verifie, verifie_role, verifie_le ;
--   2. un verrou : personne, sauf l'équipe, ne peut se mettre ces colonnes
--      (ni is_admin) lui-même ; changer de rôle fait perdre le badge, la
--      preuve valant pour un rôle précis ;
--   3. une table des demandes (`verifications_profil`), fermée : tout passe
--      par des fonctions qui vérifient qui appelle ;
--   4. des fonctions : demander, lire sa demande, lister et traiter (équipe) ;
--   5. un bucket de stockage PRIVÉ pour les captures : seul leur auteur et
--      l'équipe peuvent les ouvrir (le bucket « Covers », lui, est public) ;
--   6. l'accès aux accréditations photo exige un photographe vérifié
--      (est_photographe), tant que l'interrupteur « vérification exigée »
--      est allumé : il peut être mis en pause (voir la section 6) ;
--   7. le badge dans les données de la communauté (4 fonctions reprises
--      de communaute.sql, avec une clé `verifie` en plus).
--
-- Prérequis : communaute.sql (com_role_canonique), accreditations.sql
-- (est_photographe) et profils-is-admin-protege.sql (que ce fichier remplace).
--
-- À exécuter dans Supabase → SQL Editor, d'un seul bloc. Sans danger si on
-- le relance. Tout est dans une transaction : si une instruction échoue,
-- rien n'est appliqué.
-- =====================================================================

begin;


-- ---------------------------------------------------------------------
-- 1. Ce que dit le profil
-- ---------------------------------------------------------------------

alter table public.profiles
  add column if not exists verifie      boolean     not null default false,
  add column if not exists verifie_role text,
  add column if not exists verifie_le   timestamptz;


-- Les rôles qui se font vérifier : tous les métiers de la musique et de
-- l'image. Un simple auditeur, ou « Autre », n'a rien à prouver. Même liste
-- que l'interface (MEMBER_ROLES, drapeau `verifiable`).
create or replace function public.verification_roles()
returns text[]
language sql
immutable
set search_path = public
as $$
  select array[
    'Artiste', 'Beatmaker', 'DJ', 'Membre d''un label', 'Manager',
    'Relation presse', 'Média / Presse', 'Photographe'
  ]::text[];
$$;


-- ---------------------------------------------------------------------
-- 2. Le verrou
--
-- Remplace profils_garder_is_admin : mêmes garanties pour is_admin, plus
-- les colonnes de vérification. Il n'agit que sur un compte connecté qui
-- n'est pas de l'équipe : l'éditeur SQL et les fonctions de l'équipe
-- passent. Changer de rôle (de Photographe à Artiste, par exemple) retire
-- le badge : la preuve valait pour l'autre rôle.
-- ---------------------------------------------------------------------

-- « security definer » : les fonctions com_* (dont com_role_canonique) ne sont
-- exécutables par aucun compte connecté (voir communaute.sql) ; le verrou, lui,
-- tourne pour chacun d'eux. Il ne touche qu'à la ligne en cours d'écriture.
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

      else
        new.verifie      := old.verifie;
        new.verifie_role := old.verifie_role;
        new.verifie_le   := old.verifie_le;
      end if;

    end if;

  end if;

  return new;
end $$;

drop trigger if exists profils_garder_is_admin on public.profiles;
drop trigger if exists profils_garder_champs_equipe on public.profiles;

create trigger profils_garder_champs_equipe
  before insert or update on public.profiles
  for each row
  execute function public.profils_garder_champs_equipe();

drop function if exists public.profils_garder_is_admin();


-- ---------------------------------------------------------------------
-- 3. Les demandes de vérification
--
-- Une ligne par demande. Fermée : les comptes connectés ne la lisent que
-- pour leurs propres lignes (ou toutes, pour l'équipe) et n'y écrivent
-- jamais directement.
-- ---------------------------------------------------------------------

create table if not exists public.verifications_profil (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  role          text not null,
  lien          text check (lien is null or char_length(lien) <= 300),
  message       text check (message is null or char_length(message) <= 500),
  -- Le chemin de la capture dans le bucket privé : « <id du membre>/<fichier> ».
  preuve_chemin text,
  statut        text not null default 'en_attente'
                check (statut in ('en_attente', 'valide', 'refuse', 'retire')),
  motif_refus   text check (motif_refus is null or char_length(motif_refus) <= 300),
  cree_le       timestamptz not null default now(),
  traite_le     timestamptz,
  traite_par    uuid references public.profiles(id) on delete set null,
  -- Le membre a-t-il été prévenu de la décision (une seule annonce à l'écran) ?
  vu            boolean not null default false
);

create index if not exists verifications_profil_statut_idx on public.verifications_profil (statut, cree_le);
create index if not exists verifications_profil_user_idx   on public.verifications_profil (user_id, cree_le desc);

alter table public.verifications_profil enable row level security;

drop policy if exists "verifications lues par le demandeur et l'equipe" on public.verifications_profil;

create policy "verifications lues par le demandeur et l'equipe"
  on public.verifications_profil
  for select
  to authenticated
  using (user_id = auth.uid() or public.est_equipe());

revoke all on table public.verifications_profil from anon;
revoke insert, update, delete on table public.verifications_profil from authenticated;


-- ---------------------------------------------------------------------
-- 4. Demander une vérification
--
-- Le membre envoie sa capture dans le bucket privé (chemin « <son id>/… »),
-- puis appelle cette fonction avec le chemin. Une demande encore en
-- attente est remplacée (on a le droit de corriger sa preuve) ; un profil
-- déjà vérifié pour son rôle n'a plus rien à demander.
-- ---------------------------------------------------------------------

create or replace function public.verification_demander(
  p_preuve  text,
  p_lien    text default null,
  p_message text default null
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
         preuve_chemin = v_preuve, cree_le = now(), vu = false
   where user_id = v_moi and statut = 'en_attente'
   returning id into v_id;

  if v_id is null then
    insert into public.verifications_profil (user_id, role, lien, message, preuve_chemin)
    values (v_moi, v_role, v_lien, v_message, v_preuve)
    returning id into v_id;
  end if;

  return v_id;
end $$;


-- Où en est ma dernière demande ? (null s'il n'y en a jamais eu)
create or replace function public.verification_ma_demande()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id',          v.id,
    'role',        v.role,
    'statut',      v.statut,
    'motif_refus', v.motif_refus,
    'cree_le',     v.cree_le,
    'traite_le',   v.traite_le,
    'vu',          v.vu
  )
  from public.verifications_profil v
  where v.user_id = auth.uid()
  order by v.cree_le desc
  limit 1;
$$;


-- Le membre a vu la décision : on ne la lui annonce plus.
create or replace function public.verification_marquer_vue(p_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.verifications_profil set vu = true where id = p_id and user_id = auth.uid();
$$;


-- ---------------------------------------------------------------------
-- 5. Côté équipe
-- ---------------------------------------------------------------------

-- Les demandes, avec de quoi décider : le profil, la preuve, le lien.
-- p_statut : 'en_attente' (les plus anciennes d'abord) ou 'traitees'
-- (les plus récentes d'abord). La réponse donne aussi le nombre de demandes
-- à traiter, pour la pastille de l'onglet.
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
            'verifie_role', p.verifie_role
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


-- Valider, refuser, ou retirer un badge accordé.
--   valider : la demande doit être en attente, et le profil avoir encore le
--             rôle pour lequel la preuve a été envoyée ;
--   refuser : un motif est exigé, le membre le lira ;
--   retirer : sur une demande validée ; le profil perd son badge.
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
       set verifie = true, verifie_role = v.role, verifie_le = now()
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
       set verifie = false, verifie_role = null, verifie_le = null
     where id = v.user_id and verifie_role is not distinct from v.role;

  else
    raise exception 'Action inconnue.';
  end if;

end $$;


-- ---------------------------------------------------------------------
-- 6. L'interrupteur, et les accréditations photo
--
-- « Vérification exigée » : allumé, l'accès aux accréditations photo demande
-- un photographe VÉRIFIÉ (l'équipe a validé sa preuve) ; éteint, le rôle
-- Photographe suffit, comme avant la vérification, et le site n'invite plus
-- personne à faire vérifier son profil (pause, par exemple pendant une phase
-- de test). Une seule ligne, dans la table verification_reglage.
--
-- Il se change dans l'espace équipe (onglet « Profils » : bandeau et bouton),
-- ou depuis l'éditeur SQL :
--     update public.verification_reglage set exigee = false;   -- pause
--     update public.verification_reglage set exigee = true;    -- réactivée
-- Relancer ce fichier ne change pas sa position (allumé à la première
-- installation).
--
-- EN PRODUCTION : éteint le 2026-10-14, pour la phase de test des
-- photographes. À RÉACTIVER quand elle est levée (voir aussi la liste de
-- retrait du portail, en tête de acces-testeurs-retrait.sql).
--
-- Remplace est_photographe() (accreditations.sql). Les inscriptions, la
-- livraison des photos et les propositions de concert s'y appuient déjà.
-- ---------------------------------------------------------------------

create table if not exists public.verification_reglage (
  id      boolean     primary key default true check (id),   -- une seule ligne
  exigee  boolean     not null default true,
  maj_le  timestamptz not null default now(),
  maj_par uuid        references public.profiles(id) on delete set null
);

insert into public.verification_reglage (id, exigee) values (true, true)
on conflict (id) do nothing;

alter table public.verification_reglage enable row level security;
revoke all on table public.verification_reglage from anon, authenticated;

-- La vérification est-elle exigée ? Lisible par tous : le site en a besoin
-- pour savoir quoi proposer, même à un visiteur.
create or replace function public.verification_exigee()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select r.exigee from public.verification_reglage r where r.id), true);
$$;

-- Allumer ou éteindre (équipe). Renvoie la nouvelle position.
create or replace function public.verification_regler(p_exigee boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.est_equipe() then
    raise exception 'Réservé à l''équipe.';
  end if;

  update public.verification_reglage
     set exigee = coalesce(p_exigee, true), maj_le = now(), maj_par = auth.uid()
   where id;

  return public.verification_exigee();
end $$;

revoke all on function public.verification_regler(boolean) from public, anon;
grant execute on function public.verification_regler(boolean) to authenticated;
grant execute on function public.verification_exigee()        to anon, authenticated;

create or replace function public.est_photographe()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select p.is_admin
        or (public.com_role_canonique(p.role) = 'Photographe'
            and (not public.verification_exigee()
                 or (p.verifie and p.verifie_role = 'Photographe')))
    from public.profiles p
    where p.id = auth.uid()
  ), false);
$$;


-- ---------------------------------------------------------------------
-- 7. Qui peut appeler quoi
-- ---------------------------------------------------------------------

revoke all on function public.verification_demander(text, text, text) from public, anon;
revoke all on function public.verification_ma_demande()                from public, anon;
revoke all on function public.verification_marquer_vue(uuid)           from public, anon;
revoke all on function public.verifications_liste(text, integer)       from public, anon;
revoke all on function public.verification_traiter(uuid, text, text)   from public, anon;

grant execute on function public.verification_demander(text, text, text) to authenticated;
grant execute on function public.verification_ma_demande()                to authenticated;
grant execute on function public.verification_marquer_vue(uuid)           to authenticated;
grant execute on function public.verifications_liste(text, integer)       to authenticated;
grant execute on function public.verification_traiter(uuid, text, text)   to authenticated;
grant execute on function public.verification_roles()                     to anon, authenticated;


-- ---------------------------------------------------------------------
-- 8. Les captures : un bucket privé
--
-- « preuves-profil » n'est pas public : une capture ne s'ouvre que par une
-- adresse signée, que seuls son auteur et l'équipe peuvent demander. Chaque
-- membre n'écrit que dans son dossier (« <son id>/… »). Huit Mo au plus,
-- images JPG, PNG ou WEBP (le site allège de lui-même une image plus lourde).
-- ---------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('preuves-profil', 'preuves-profil', false, 8 * 1024 * 1024,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "preuves deposees dans son dossier"        on storage.objects;
drop policy if exists "preuves lues par leur auteur et l'equipe" on storage.objects;

create policy "preuves deposees dans son dossier"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'preuves-profil'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "preuves lues par leur auteur et l'equipe"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'preuves-profil'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.est_equipe())
  );


-- ---------------------------------------------------------------------
-- 9. Le badge dans la communauté
--
-- Les quatre fonctions qui décrivent un membre (l'auteur d'un message, un
-- profil, l'annuaire, les suggestions) reprennent communaute.sql avec une
-- clé `verifie` en plus. Rien d'autre ne change.
-- ---------------------------------------------------------------------

create or replace function public.com_auteur_json(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select jsonb_build_object(
        'id',         p.id,
        'pseudo',     p.pseudo,
        'avatar_url', p.avatar_url,
        'role',       public.com_role_canonique(p.role),
        'xp',         coalesce(p.xp, 0),
        'equipe',     coalesce(p.is_admin, false),
        'verifie',    coalesce(p.verifie, false),
        'ville',      p.ville,
        'artiste',    (
          select a.instagram_handle from public.artists a
           where a.verifie_par = p.id
           order by a.instagram_handle
           limit 1
        )
      )
      from public.profiles p
      where p.id = p_id
    ),
    jsonb_build_object(
      'id', null, 'pseudo', 'Compte supprimé', 'avatar_url', null,
      'role', 'Autre', 'xp', 0, 'equipe', false, 'verifie', false, 'ville', null, 'artiste', null
    )
  );
$$;




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




create or replace function public.com_membres(
  p_role      text    default null,
  p_cherche   text    default null,
  p_propose   text    default null,
  p_ville     text    default null,
  p_recherche text    default null,
  p_tri       text    default 'actifs',
  p_limite    integer default 24,
  p_decalage  integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_moi       uuid := auth.uid();
  v_limite    integer := least(greatest(coalesce(p_limite, 24), 1), 60);
  v_ville     text := nullif(left(btrim(coalesce(p_ville, '')), 60), '');
  v_recherche text := nullif(left(btrim(coalesce(p_recherche, '')), 60), '');
  v_mville    text;
  v_mrech     text;
  v_ids       uuid[];
  v_membres   jsonb;
  v_total     integer;
begin
  if v_ville is not null then
    v_mville := '%' || replace(replace(replace(v_ville, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  if v_recherche is not null then
    v_mrech := '%' || replace(replace(replace(v_recherche, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  select coalesce(array_agg(p.id), '{}')
    into v_ids
    from public.profiles p
   where (v_moi is null or p.id <> v_moi)
     -- Le métier cherché : celui du profil, ou un service qu'il propose (un
     -- artiste qui propose du mix est aussi un ingé son pour qui le cherche).
     and (p_role is null or public.com_role_cle(p.role) = p_role or p_role = any (p.propose))
     and (p_cherche is null or p_cherche = any (p.cherche))
     and (p_propose is null or p_propose = any (p.propose))
     and (v_mville is null or p.ville ilike v_mville escape '\')
     and (v_mrech is null or p.pseudo ilike v_mrech escape '\' or p.bio ilike v_mrech escape '\')
     and (v_moi is null or not public.com_est_bloque(v_moi, p.id));

  v_total := coalesce(cardinality(v_ids), 0);

  select coalesce(jsonb_agg(m.j order by m.rang), '[]'::jsonb)
    into v_membres
    from (
      select row_number() over (
               order by
                 case when coalesce(p_tri, 'actifs') = 'populaires'
                      then (select count(*) from public.com_suivis s where s.suivi_id = p.id) end desc nulls last,
                 case when coalesce(p_tri, 'actifs') = 'recents' then p.created_at end desc nulls last,
                 coalesce(p.derniere_activite, p.updated_at, p.created_at) desc,
                 coalesce(p.xp, 0) desc,
                 p.id
             ) as rang,
             jsonb_build_object(
               'id',         p.id,
               'pseudo',     p.pseudo,
               'avatar_url', p.avatar_url,
               'bio',        left(coalesce(p.bio, ''), 160),
               'role',       public.com_role_canonique(p.role),
               'xp',         coalesce(p.xp, 0),
               'ville',      p.ville,
               'cherche',    to_jsonb(p.cherche),
               'propose',    to_jsonb(p.propose),
               'genres',     to_jsonb(p.genres),
               'equipe',     coalesce(p.is_admin, false),
               'verifie',    coalesce(p.verifie, false),
               'nb_abonnes', (select count(*) from public.com_suivis s where s.suivi_id = p.id),
               'nb_posts',   (select count(*) from public.com_posts k where k.auteur_id = p.id),
               'moi',        jsonb_build_object(
                 'suit', exists (select 1 from public.com_suivis s
                                  where s.suiveur_id = v_moi and s.suivi_id = p.id)
               )
             ) as j
        from public.profiles p
       where p.id = any (v_ids)
    ) m
   where m.rang > greatest(coalesce(p_decalage, 0), 0)
     and m.rang <= greatest(coalesce(p_decalage, 0), 0) + v_limite;

  return jsonb_build_object(
    'membres', v_membres,
    'total',   v_total,
    'fin',     greatest(coalesce(p_decalage, 0), 0) + v_limite >= v_total
  );
end $$;




create or replace function public.com_suggestions(p_limite integer default 5)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_moi    uuid := auth.uid();
  v_limite integer := least(greatest(coalesce(p_limite, 5), 1), 20);
  m        public.profiles;
  v_cle    text;
  v_res    jsonb;
begin
  if v_moi is not null then
    select * into m from public.profiles where id = v_moi;
    v_cle := public.com_role_cle(m.role);
  end if;

  select coalesce(jsonb_agg(x.j order by x.score desc, x.actif desc, x.xp desc, x.id), '[]'::jsonb)
    into v_res
    from (
      select s.*, jsonb_build_object(
               'id',         s.id,
               'pseudo',     s.pseudo,
               'avatar_url', s.avatar_url,
               'bio',        left(coalesce(s.bio, ''), 120),
               'role',       public.com_role_canonique(s.role),
               'xp',         coalesce(s.xp, 0),
               'ville',      s.ville,
               'cherche',    to_jsonb(s.cherche),
               'propose',    to_jsonb(s.propose),
               'equipe',     coalesce(s.is_admin, false),
               'verifie',    coalesce(s.verifie, false),
               'raisons',    to_jsonb(array_remove(array[
                 case when s.tu_cherches then 'tu_cherches' end,
                 case when s.te_cherche  then 'te_cherche'  end,
                 case when s.meme_ville  then 'meme_ville'  end,
                 case when s.meme_style  then 'meme_style'  end
               ], null))
             ) as j
        from (
          select c.id, c.pseudo, c.avatar_url, c.bio, c.role, c.xp, c.ville,
                 c.cherche, c.propose, c.is_admin, c.verifie,
                 coalesce(c.derniere_activite, c.updated_at, c.created_at) as actif,
                 (v_moi is not null and public.com_role_cle(c.role) = any (m.cherche))     as tu_cherches,
                 (v_cle is not null and v_cle = any (c.cherche))                           as te_cherche,
                 (m.ville is not null and c.ville is not null and lower(c.ville) = lower(m.ville)) as meme_ville,
                 (v_moi is not null and m.genres && c.genres)                              as meme_style,
                 (
                   (case when v_moi is not null and public.com_role_cle(c.role) = any (m.cherche) then 3 else 0 end)
                 + (case when v_cle is not null and v_cle = any (c.cherche) then 2 else 0 end)
                 + (case when m.ville is not null and c.ville is not null and lower(c.ville) = lower(m.ville) then 2 else 0 end)
                 + (case when v_moi is not null and m.genres && c.genres then 1 else 0 end)
                 + (case when coalesce(c.derniere_activite, c.updated_at, c.created_at) > now() - interval '14 days' then 1 else 0 end)
                 + (case when c.avatar_url is not null then 1 else 0 end)
                 ) as score
            from public.profiles c
           where (v_moi is null or c.id <> v_moi)
             and (v_moi is null or not exists (select 1 from public.com_suivis f
                                                where f.suiveur_id = v_moi and f.suivi_id = c.id))
             and (v_moi is null or not public.com_est_bloque(v_moi, c.id))
        ) s
       order by s.score desc, s.actif desc, coalesce(s.xp, 0) desc
       limit v_limite
    ) x;

  return v_res;
end $$;




commit;


-- ---------------------------------------------------------------------
-- Vérification : le déclencheur, la table, le bucket et les cinq fonctions.
-- ---------------------------------------------------------------------

select tgname as declencheur from pg_trigger
 where tgrelid = 'public.profiles'::regclass and not tgisinternal;

select relname as table_name, relrowsecurity as rls_active
  from pg_class where relname = 'verifications_profil';

select id, public, file_size_limit from storage.buckets where id = 'preuves-profil';

select proname from pg_proc
 where pronamespace = 'public'::regnamespace
   and proname in ('verification_demander', 'verification_ma_demande', 'verification_marquer_vue',
                   'verifications_liste', 'verification_traiter', 'verification_exigee', 'verification_regler')
 order by 1;

select exigee as verification_exigee from public.verification_reglage;
