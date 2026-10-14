-- =====================================================================
-- La Wave — plusieurs rôles
--
-- Un beatmaker peut aussi être artiste, un photographe aussi vidéaste : chaque
-- membre garde un rôle PRINCIPAL (profiles.role : celui qui s'affiche d'abord,
-- et celui que l'on fait vérifier) et jusqu'à deux rôles SECONDAIRES
-- (profiles.roles_supp). Les rôles secondaires :
--   - s'affichent sur le profil, à côté du principal ;
--   - comptent pour l'accès aux pages réservées (soumettre une sortie,
--     accréditations photo) ;
--   - font retrouver le membre dans Explorer, par métier.
--
-- Sans danger à rejouer. À passer APRÈS sql/logo-media.sql (com_profil en reprend le logo).
-- =====================================================================

alter table public.profiles
  add column if not exists roles_supp text[] not null default '{}';

alter table public.profiles drop constraint if exists profiles_roles_supp_check;
alter table public.profiles
  add constraint profiles_roles_supp_check
  check (cardinality(roles_supp) <= 2);


-- Qui peut soumettre une sortie : l'équipe, ou un rôle (principal ou secondaire) de la liste.
create or replace function public.peut_soumettre()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select p.is_admin
        or p.role in (
             'Artiste',
             'Beatmaker',
             'Membre d''un label',
             'Manager',
             'Relation presse',
             'Manager / Booker',   -- ancien libellé
             'Booker'              -- ancien libellé
           )
        or p.roles_supp && array[
             'Artiste',
             'Beatmaker',
             'Membre d''un label',
             'Manager',
             'Relation presse'
           ]::text[]
    from public.profiles p
    where p.id = auth.uid()
  ), false);
$$;


-- Qui s'inscrit aux accréditations : l'équipe, ou un photographe (rôle principal OU secondaire) ; quand la
-- vérification est exigée, il faut de plus un profil vérifié pour le métier de photographe.
create or replace function public.est_photographe()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select p.is_admin
        or ((public.com_role_canonique(p.role) = 'Photographe' or 'Photographe' = any (p.roles_supp))
            and (not public.verification_exigee()
                 or (p.verifie and p.verifie_role = 'Photographe')))
    from public.profiles p
    where p.id = auth.uid()
  ), false);
$$;


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
     and (p_role is null or public.com_role_cle(p.role) = p_role or p_role = any (p.propose)
          or exists (select 1 from unnest(p.roles_supp) r where public.com_role_cle(r) = p_role))
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
               'roles_supp', to_jsonb(p.roles_supp),
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
      'roles_supp',  to_jsonb(p.roles_supp),
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

