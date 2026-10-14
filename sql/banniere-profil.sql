-- =====================================================================
-- La Wave — la bannière du profil
--
-- Chaque membre peut mettre une image en haut de son profil (celui de la
-- communauté, qui est aussi « Mon profil »). L'image est envoyée dans le
-- bucket public « Covers », comme la photo de profil ; seule son adresse
-- est gardée ici.
--
-- Ce que ça change :
--   1. profiles.banniere_url : l'adresse de l'image (null : la bannière
--      de couleur, dérivée du pseudo, comme avant). Le membre la modifie
--      lui-même (la politique « profil modification » couvre déjà toute
--      la ligne), personne d'autre.
--   2. com_profil() renvoie « banniere_url » : c'est par elle que la
--      communauté lit un profil.
--
-- Sans danger à rejouer.
-- =====================================================================

alter table public.profiles
  add column if not exists banniere_url text;

-- Une adresse https, de taille raisonnable : pas de data:, pas de javascript:.
alter table public.profiles drop constraint if exists profiles_banniere_url_check;
alter table public.profiles
  add constraint profiles_banniere_url_check
  check (banniere_url is null or (length(banniere_url) <= 600 and banniere_url ~* '^https://'));

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

grant execute on function public.com_profil(text) to anon, authenticated;
