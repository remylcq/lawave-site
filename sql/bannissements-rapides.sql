-- =====================================================================
-- La Wave — des bannissements qui ne dépassent plus le délai
--
-- Symptôme : bannir (ou supprimer « pour de bon ») un artiste échouait avec
-- « canceling statement due to statement timeout ». Cause : à chaque
-- bannissement, bannissements_appliquer() recalculait, pour CHAQUE sortie du
-- catalogue (28 000 depuis les discographies complètes) et CHAQUE banni (55),
-- le nom normalisé de l'artiste — plusieurs expressions régulières par
-- comparaison. 7,7 secondes pour un plafond de 8.
--
-- Correction : le nom normalisé de l'artiste de chaque sortie est gardé dans
-- deux colonnes (artist_norme, artist_handle_norme), tenues à jour par un
-- déclencheur ; bannissements_appliquer() compare alors des valeurs déjà
-- prêtes à la liste des bannis (une recherche dans un ensemble, au lieu d'un
-- calcul par ligne). Même résultat qu'avant, quelques millisecondes.
--
-- Sans danger à rejouer.
-- =====================================================================

alter table public.submissions
  add column if not exists artist_norme        text,
  add column if not exists artist_handle_norme text;


create or replace function public.submissions_normes_maj()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.artist_norme        := public.norme_artiste(new.artist_name);
  new.artist_handle_norme := public.norme_artiste(regexp_replace(coalesce(new.artist_handle, ''), '\.[0-9]+$', ''));
  return new;
end $$;

drop trigger if exists submissions_normes_maj on public.submissions;

create trigger submissions_normes_maj
  before insert or update of artist_name, artist_handle on public.submissions
  for each row
  execute function public.submissions_normes_maj();


-- Les lignes déjà là (une fois). Le déclencheur de la date de modification est mis de côté le temps de l'opération :
-- ce n'est pas une modification des sorties.
alter table public.submissions disable trigger submissions_updated_at;

update public.submissions
   set artist_norme        = public.norme_artiste(artist_name),
       artist_handle_norme = public.norme_artiste(regexp_replace(coalesce(artist_handle, ''), '\.[0-9]+$', ''))
 where artist_norme is null or artist_handle_norme is null;

alter table public.submissions enable trigger submissions_updated_at;

create index if not exists submissions_banni_idx
  on public.submissions (id) where banni;


create or replace function public.bannissements_appliquer()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nouveaux text[];
  v_sorties  integer;
  v_levees   integer;
begin

  -- Les profils (7 000, avec les invités créés par l'import) : la liste des bannis est lue UNE fois, en trois
  -- ensembles (pseudos, pages Deezer, noms normalisés), et chaque profil n'est plus comparé qu'à ces ensembles.
  with bh as (
    select b.instagram_handle as hh from public.artistes_bannis b where b.instagram_handle is not null
  ),
  bd as (
    select b.deezer_artist_id as dd from public.artistes_bannis b where b.deezer_artist_id is not null
    union
    select unnest(b.deezer_ids) from public.artistes_bannis b
  ),
  bn as (
    select b.nom_norme as nn from public.artistes_bannis b where b.nom_norme is not null
  ),
  c as (
    select a.id,
           public.norme_artiste(a.display_name) as n1,
           public.norme_artiste(regexp_replace(coalesce(a.instagram_handle, ''), '\.[0-9]+$', '')) as n2
      from public.artists a
     where not a.banni
  ),
  m as (
    update public.artists a
       set banni = true, deezer_suivi = false, updated_at = now()
      from c
     where a.id = c.id
       and (
            a.instagram_handle in (select hh from bh)
         or a.deezer_artist_id in (select dd from bd)
         or c.n1 in (select nn from bn)
         or c.n2 in (select nn from bn)
       )
    returning a.instagram_handle
  )
  select coalesce(array_agg(instagram_handle), '{}') into v_nouveaux from m;

  with bh as (
    select b.instagram_handle as hh from public.artistes_bannis b where b.instagram_handle is not null
  ),
  bd as (
    select b.deezer_artist_id as dd from public.artistes_bannis b where b.deezer_artist_id is not null
    union
    select unnest(b.deezer_ids) from public.artistes_bannis b
  ),
  bn as (
    select b.nom_norme as nn from public.artistes_bannis b where b.nom_norme is not null
  ),
  c as (
    select a.id,
           public.norme_artiste(a.display_name) as n1,
           public.norme_artiste(regexp_replace(coalesce(a.instagram_handle, ''), '\.[0-9]+$', '')) as n2
      from public.artists a
     where a.banni
  )
  update public.artists a
     set banni = false, updated_at = now()
    from c
   where a.id = c.id
     and not (
          coalesce(a.instagram_handle in (select hh from bh), false)
       or coalesce(a.deezer_artist_id in (select dd from bd), false)
       or coalesce(c.n1 in (select nn from bn), false)
       or coalesce(c.n2 in (select nn from bn), false)
     );

  -- Les sorties : un artiste banni par son pseudo, par son nom (ou le nom tiré de son pseudo), ou dont le profil est
  -- banni. Les valeurs normalisées sont déjà dans la table.
  update public.submissions s
     set banni = true
   where not s.banni
     and (
          coalesce(s.artist_handle in (select b.instagram_handle from public.artistes_bannis b where b.instagram_handle is not null), false)
       or coalesce(s.artist_norme        in (select b.nom_norme from public.artistes_bannis b where b.nom_norme is not null), false)
       or coalesce(s.artist_handle_norme in (select b.nom_norme from public.artistes_bannis b where b.nom_norme is not null), false)
       or coalesce(s.artist_handle in (select a.instagram_handle from public.artists a where a.banni), false)
     );

  get diagnostics v_sorties = row_count;

  update public.submissions s
     set banni = false
   where s.banni
     and not (
          coalesce(s.artist_handle in (select b.instagram_handle from public.artistes_bannis b where b.instagram_handle is not null), false)
       or coalesce(s.artist_norme        in (select b.nom_norme from public.artistes_bannis b where b.nom_norme is not null), false)
       or coalesce(s.artist_handle_norme in (select b.nom_norme from public.artistes_bannis b where b.nom_norme is not null), false)
       or coalesce(s.artist_handle in (select a.instagram_handle from public.artists a where a.banni), false)
     );

  get diagnostics v_levees = row_count;

  return jsonb_build_object(
    'profils', to_jsonb(v_nouveaux),
    'sorties', v_sorties,
    'sorties_levees', v_levees
  );

end $$;
