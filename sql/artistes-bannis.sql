-- =====================================================================
-- La Wave — bannir des artistes
--
-- À passer après sql/deezer-featurings.sql. Un artiste banni :
--
--   · disparaît du site pour tout le monde, équipe comprise (catalogue,
--     accueil, carte, page artiste, recherche, listes de l'espace
--     équipe) : son profil et ses sorties sont masqués, pas supprimés ;
--   · n'est plus suivi ni importé depuis Deezer, et ses apparitions en
--     featuring sur les sorties des autres sont retirées ;
--   · ne peut plus être ajouté par personne : ni par un membre qui dépose
--     une sortie, ni par l'équipe, ni par l'import automatique — sous son
--     nom, avec son profil Deezer ou avec son pseudo.
--
-- On le retrouve dans l'onglet Artistes de l'espace équipe → « Artistes
-- bannis », d'où on le rétablit : son profil et ses sorties reviennent tels
-- quels (seul le suivi Deezer est à remettre à la main).
--
-- Le bannissement vaut pour un NOM (sans accents ni ponctuation : « Josman »
-- et « JOSMAN » sont le même), pour un profil Deezer et pour un pseudo. Un
-- homonyme est donc banni avec lui : c'est voulu, c'est ce qui empêche qu'il
-- revienne par une seconde page Deezer.
--
-- Fonctions (réservées à l'équipe) :
--   bannir_artiste(nom, pseudo, id Deezer, raison)
--   retablir_artiste(id du bannissement)
--   bannis_liste()
--
-- À exécuter dans Supabase → SQL Editor, d'un seul bloc. Relançable : rien
-- n'est écrasé ni vidé. Si une instruction échoue, rien n'est appliqué.
--
-- POUR TOUT RETIRER : rétablir chaque artiste, puis supprimer les objets
-- listés dans la section « Retrait » en bas de ce fichier.
-- =====================================================================

begin;

do $$
begin

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'artists'
      and column_name = 'deezer_suivi'
  ) then
    raise exception
      'Exécute d''abord sql/deezer-featurings.sql : la colonne artists.deezer_suivi manque.';
  end if;

  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'est_equipe'
  ) then
    raise exception
      'La fonction est_equipe() manque : exécute sql/communaute.sql ou sql/acces-testeurs.sql.';
  end if;

end $$;


-- ---------------------------------------------------------------------
-- 1. La liste des bannis
-- ---------------------------------------------------------------------

create table if not exists public.artistes_bannis (
  id               uuid        primary key default gen_random_uuid(),
  nom              text        not null,
  nom_norme        text,
  instagram_handle text,
  deezer_artist_id bigint,
  -- Toutes les pages Deezer connues de l'artiste au moment du bannissement
  -- (un artiste en a souvent deux ou trois).
  deezer_ids       bigint[]    not null default '{}',
  raison           text,
  banni_le         timestamptz not null default now(),
  banni_par        uuid,
  -- Les featurings retirés des sorties des autres, pour les remettre au
  -- rétablissement : [ { "id": "<sortie>", "entrees": [ { "nom", "handle" } ] } ].
  feats            jsonb       not null default '[]'::jsonb,
  constraint artistes_bannis_nom_norme_non_vide
    check (nom_norme is null or nom_norme <> ''),
  constraint artistes_bannis_une_cle
    check (nom_norme is not null or instagram_handle is not null or deezer_artist_id is not null)
);

create unique index if not exists artistes_bannis_nom_uidx
  on public.artistes_bannis (nom_norme) where nom_norme is not null;
create unique index if not exists artistes_bannis_handle_uidx
  on public.artistes_bannis (instagram_handle) where instagram_handle is not null;
create unique index if not exists artistes_bannis_deezer_uidx
  on public.artistes_bannis (deezer_artist_id) where deezer_artist_id is not null;

-- Pour une table déjà créée par une version antérieure de ce fichier.
alter table public.artistes_bannis
  add column if not exists deezer_ids bigint[] not null default '{}';

alter table public.artistes_bannis enable row level security;
revoke all on public.artistes_bannis from public, anon, authenticated;

-- Le drapeau qui masque : posé sur le profil et sur chaque sortie du banni.
alter table public.artists
  add column if not exists banni boolean not null default false;

alter table public.submissions
  add column if not exists banni boolean not null default false;


-- ---------------------------------------------------------------------
-- 2. Reconnaître un banni
-- ---------------------------------------------------------------------

-- « Josman », « JOSMAN » et « Jos.man » donnent le même texte ; « josman.268 »
-- (pseudo d'un profil créé par l'import) aussi, une fois son suffixe retiré.
create or replace function public.norme_artiste(p_texte text)
returns text
language sql
immutable
as $$
  select regexp_replace(
    translate(
      lower(coalesce(p_texte, '')),
      'àáâãäåçèéêëìíîïñòóôõöùúûüýÿœæ',
      'aaaaaaceeeeiiiinooooouuuuyyoa'
    ),
    '[^a-z0-9]+', '', 'g'
  );
$$;


create or replace function public.ban_correspond(
  b         public.artistes_bannis,
  p_handle  text,
  p_nom     text,
  p_deezer  bigint
)
returns boolean
language sql
immutable
as $$
  select (coalesce(p_handle, '') <> '' and b.instagram_handle = p_handle)
      or (p_deezer is not null and (b.deezer_artist_id = p_deezer or p_deezer = any(b.deezer_ids)))
      or (b.nom_norme is not null and (
            b.nom_norme = public.norme_artiste(p_nom)
         or b.nom_norme = public.norme_artiste(
              regexp_replace(coalesce(p_handle, ''), '\.[0-9]+$', ''))
         ));
$$;


create or replace function public.artiste_banni(
  p_handle text,
  p_nom    text,
  p_deezer bigint
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.artistes_bannis b
     where public.ban_correspond(b, p_handle, p_nom, p_deezer)
  );
$$;


-- ---------------------------------------------------------------------
-- 3. Poser et lever le drapeau
--
-- Recalculé sur tout le monde : le résultat ne dépend pas de l'ordre dans
-- lequel on a banni ou rétabli. Un banni n'est plus suivi sur Deezer.
-- Renvoie les pseudos devenus bannis et le nombre de sorties masquées.
-- ---------------------------------------------------------------------

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

  with m as (
    update public.artists a
       set banni = true, deezer_suivi = false, updated_at = now()
     where not a.banni
       and public.artiste_banni(a.instagram_handle, a.display_name, a.deezer_artist_id)
    returning a.instagram_handle
  )
  select coalesce(array_agg(instagram_handle), '{}') into v_nouveaux from m;

  update public.artists a
     set banni = false, updated_at = now()
   where a.banni
     and not public.artiste_banni(a.instagram_handle, a.display_name, a.deezer_artist_id);

  update public.submissions s
     set banni = true
   where not s.banni
     and (
       public.artiste_banni(s.artist_handle, s.artist_name, null)
       or exists (select 1 from public.artists a
                   where a.banni and a.instagram_handle = s.artist_handle)
     );

  get diagnostics v_sorties = row_count;

  update public.submissions s
     set banni = false
   where s.banni
     and not (
       public.artiste_banni(s.artist_handle, s.artist_name, null)
       or exists (select 1 from public.artists a
                   where a.banni and a.instagram_handle = s.artist_handle)
     );

  get diagnostics v_levees = row_count;

  return jsonb_build_object(
    'profils', to_jsonb(v_nouveaux),
    'sorties', v_sorties,
    'sorties_levees', v_levees
  );

end $$;


-- ---------------------------------------------------------------------
-- 4. Masquer : aucune lecture ne renvoie un banni
--
-- Une règle « restrictive » s'ajoute à celles qui existent déjà sans les
-- remplacer : une ligne n'est visible que si les anciennes règles ET
-- celle-ci la laissent passer. Elle vaut pour tout le monde, l'équipe
-- comprise ; les bannis se lisent par bannis_liste().
-- ---------------------------------------------------------------------

alter table public.artists     enable row level security;
alter table public.submissions enable row level security;

drop policy if exists "artistes bannis masques" on public.artists;
create policy "artistes bannis masques"
  on public.artists
  as restrictive
  for select
  to public
  using (not banni);

drop policy if exists "sorties des bannis masquees" on public.submissions;
create policy "sorties des bannis masquees"
  on public.submissions
  as restrictive
  for select
  to public
  using (not banni);


-- ---------------------------------------------------------------------
-- 5. Empêcher l'ajout
--
-- Un membre, l'équipe ou l'import qui tente d'ajouter un banni :
--   · une personne connectée reçoit un refus ;
--   · l'import (tâche planifiée, sans utilisateur) ne peut pas échouer : la
--     ligne est rangée déjà masquée, ce qui évite qu'il la redemande à
--     chaque passage.
-- Les artistes bannis cités en featuring sont retirés de la liste.
-- ---------------------------------------------------------------------

create or replace function public.artists_garde_bannis()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin

  if tg_op = 'INSERT' then

    if public.artiste_banni(new.instagram_handle, new.display_name, new.deezer_artist_id) then
      if auth.uid() is not null then
        raise exception 'Cet artiste ne peut pas être ajouté sur La Wave.';
      end if;
      new.banni        := true;
      new.deezer_suivi := false;
    end if;

    return new;

  end if;

  -- Un banni reste non suivi, quoi qu'on lui fasse.
  if new.banni then
    new.deezer_suivi := false;
  end if;

  -- On ne relie pas un profil à la page Deezer d'un banni.
  if new.deezer_artist_id is not null
     and new.deezer_artist_id is distinct from old.deezer_artist_id
     and not new.banni
     and exists (select 1 from public.artistes_bannis b
                  where b.deezer_artist_id = new.deezer_artist_id
                     or new.deezer_artist_id = any(b.deezer_ids)) then
    raise exception 'Cet artiste ne peut pas être ajouté sur La Wave.';
  end if;

  return new;

end $$;

drop trigger if exists artists_garde_bannis on public.artists;

create trigger artists_garde_bannis
before insert or update on public.artists
for each row
execute function public.artists_garde_bannis();


create or replace function public.submissions_garde_bannis()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin

  if public.artiste_banni(new.artist_handle, new.artist_name, null)
     or exists (select 1 from public.artists a
                 where a.banni and a.instagram_handle = new.artist_handle) then

    if tg_op = 'INSERT' and auth.uid() is not null then
      raise exception 'Cet artiste ne peut pas être ajouté sur La Wave.';
    end if;

    new.banni := true;

  end if;

  if jsonb_typeof(new.featuring) = 'array' and jsonb_array_length(new.featuring) > 0 then

    new.featuring := coalesce((
      select jsonb_agg(e.value order by e.ord)
        from jsonb_array_elements(new.featuring) with ordinality as e(value, ord)
       where not (
         public.artiste_banni(e.value->>'handle', e.value->>'nom', null)
         or exists (select 1 from public.artists a
                     where a.banni and a.instagram_handle = e.value->>'handle')
       )
    ), '[]'::jsonb);

  end if;

  return new;

end $$;

drop trigger if exists submissions_garde_bannis on public.submissions;

create trigger submissions_garde_bannis
before insert or update of featuring, artist_handle on public.submissions
for each row
execute function public.submissions_garde_bannis();


-- ---------------------------------------------------------------------
-- 6. Pour l'espace équipe
-- ---------------------------------------------------------------------

create or replace function public.bannir_artiste(
  p_nom        text   default null,
  p_handle     text   default null,
  p_deezer_id  bigint default null,
  p_raison     text   default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_a       public.artists;
  v_ban     public.artistes_bannis;
  v_nom     text   := nullif(btrim(coalesce(p_nom, '')), '');
  v_handle  text   := nullif(btrim(coalesce(p_handle, '')), '');
  v_deezer  bigint := p_deezer_id;
  v_norme   text;
  v_res     jsonb;
  v_handles text[];
  v_sortie  record;
  v_entree  record;
  v_garde   jsonb;
  v_retire  jsonb;
  v_backup  jsonb  := '[]'::jsonb;
  v_feats   integer := 0;
begin

  if not public.est_equipe() then
    raise exception 'Réservé à l''équipe.';
  end if;

  if v_handle is not null then

    select * into v_a from public.artists a where a.instagram_handle = v_handle;

    if not found then
      raise exception 'Profil introuvable.';
    end if;

    v_nom    := coalesce(v_nom, nullif(v_a.display_name, ''), v_a.instagram_handle);
    v_deezer := coalesce(v_deezer, v_a.deezer_artist_id);

  end if;

  if v_nom is null then
    raise exception 'Indique le nom de l''artiste.';
  end if;

  v_norme := nullif(public.norme_artiste(v_nom), '');

  if v_norme is null and v_handle is null and v_deezer is null then
    raise exception 'Ce nom ne contient aucun caractère reconnaissable : donne l''adresse de sa page Deezer.';
  end if;

  if exists (
    select 1 from public.artistes_bannis b
     where (v_norme is not null  and b.nom_norme = v_norme)
        or (v_deezer is not null and b.deezer_artist_id = v_deezer)
        or (v_handle is not null and b.instagram_handle = v_handle)
  ) then
    raise exception 'Cet artiste est déjà banni.';
  end if;

  insert into public.artistes_bannis (nom, nom_norme, instagram_handle, deezer_artist_id, raison, banni_par)
  values (v_nom, v_norme, v_handle, v_deezer, nullif(btrim(coalesce(p_raison, '')), ''), auth.uid())
  returning * into v_ban;

  v_res := public.bannissements_appliquer();

  v_handles := array(select jsonb_array_elements_text(v_res->'profils'));

  if v_handle is not null and not (v_handle = any(v_handles)) then
    v_handles := v_handles || v_handle;
  end if;

  -- Les pages Deezer de tous les profils masqués : elles ne pourront pas
  -- être reliées à un autre artiste.
  update public.artistes_bannis b
     set deezer_ids = array(
           select a.deezer_artist_id
             from public.artists a
            where a.instagram_handle = any(v_handles)
              and a.deezer_artist_id is not null
           union
           select v_deezer where v_deezer is not null
         )
   where b.id = v_ban.id;

  select * into v_ban from public.artistes_bannis b where b.id = v_ban.id;

  -- Ses apparitions en featuring sur les sorties des autres : retirées,
  -- et gardées de côté pour le rétablissement.
  for v_sortie in
    select s.id, s.featuring
      from public.submissions s
     where not s.banni
       and jsonb_typeof(s.featuring) = 'array'
       and jsonb_array_length(s.featuring) > 0
  loop

    v_garde  := '[]'::jsonb;
    v_retire := '[]'::jsonb;

    for v_entree in
      select e.value
        from jsonb_array_elements(v_sortie.featuring) with ordinality as e(value, ord)
       order by e.ord
    loop

      if (v_entree.value->>'handle') = any(v_handles)
         or public.ban_correspond(v_ban, v_entree.value->>'handle', v_entree.value->>'nom', null) then
        v_retire := v_retire || v_entree.value;
      else
        v_garde := v_garde || v_entree.value;
      end if;

    end loop;

    if jsonb_array_length(v_retire) > 0 then

      update public.submissions set featuring = v_garde where id = v_sortie.id;

      v_backup := v_backup || jsonb_build_object('id', v_sortie.id::text, 'entrees', v_retire);
      v_feats  := v_feats + 1;

    end if;

  end loop;

  update public.artistes_bannis set feats = v_backup where id = v_ban.id;

  return jsonb_build_object(
    'id',         v_ban.id,
    'nom',        v_nom,
    'profils',    coalesce(cardinality(v_handles), 0),
    'sorties',    (v_res->>'sorties')::integer,
    'featurings', v_feats
  );

end $$;


create or replace function public.retablir_artiste(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ban  public.artistes_bannis;
  v_item record;
  v_res  jsonb;
  v_rend integer := 0;
begin

  if not public.est_equipe() then
    raise exception 'Réservé à l''équipe.';
  end if;

  select * into v_ban from public.artistes_bannis b where b.id = p_id;

  if not found then
    raise exception 'Ce bannissement n''existe plus.';
  end if;

  delete from public.artistes_bannis where id = v_ban.id;

  v_res := public.bannissements_appliquer();

  -- Les featurings retirés à l'époque reviennent à la fin de la liste.
  for v_item in
    select e.value from jsonb_array_elements(v_ban.feats) as e(value)
  loop

    update public.submissions s
       set featuring = s.featuring || coalesce((
             select jsonb_agg(n.value)
               from jsonb_array_elements(v_item.value->'entrees') as n(value)
              where not exists (
                select 1 from jsonb_array_elements(s.featuring) as f(value)
                 where f.value->>'handle' is not null
                   and f.value->>'handle' = n.value->>'handle'
              )
           ), '[]'::jsonb)
     where s.id::text = v_item.value->>'id'
       and jsonb_typeof(s.featuring) = 'array';

    v_rend := v_rend + 1;

  end loop;

  return jsonb_build_object(
    'nom',        v_ban.nom,
    'sorties',    (v_res->>'sorties_levees')::integer,
    'featurings', v_rend
  );

end $$;


create or replace function public.bannis_liste()
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
    select jsonb_agg(
      jsonb_build_object(
        'id',          b.id,
        'nom',         b.nom,
        'handle',      b.instagram_handle,
        'deezer_id',   b.deezer_artist_id,
        'raison',      b.raison,
        'banni_le',    b.banni_le,
        'photo',       (select a.photo_url from public.artists a
                         where a.banni
                           and public.ban_correspond(b, a.instagram_handle, a.display_name, a.deezer_artist_id)
                           and coalesce(a.photo_url, '') <> ''
                         limit 1),
        'profils',     (select count(*) from public.artists a
                         where a.banni
                           and public.ban_correspond(b, a.instagram_handle, a.display_name, a.deezer_artist_id)),
        'sorties',     (select count(*) from public.submissions s
                         where s.banni
                           and (public.ban_correspond(b, s.artist_handle, s.artist_name, null)
                                or s.artist_handle in (
                                     select a.instagram_handle from public.artists a
                                      where a.banni
                                        and public.ban_correspond(b, a.instagram_handle, a.display_name, a.deezer_artist_id))))
      )
      order by b.banni_le desc
    )
    from public.artistes_bannis b
  ), '[]'::jsonb);

end $$;


-- ---------------------------------------------------------------------
-- 7. Droits
-- ---------------------------------------------------------------------

revoke all on function public.norme_artiste(text)                                 from public, anon, authenticated;
revoke all on function public.ban_correspond(public.artistes_bannis, text, text, bigint) from public, anon, authenticated;
revoke all on function public.artiste_banni(text, text, bigint)                   from public, anon, authenticated;
revoke all on function public.bannissements_appliquer()                           from public, anon, authenticated;
revoke all on function public.artists_garde_bannis()                              from public, anon, authenticated;
revoke all on function public.submissions_garde_bannis()                          from public, anon, authenticated;

revoke all on function public.bannir_artiste(text, text, bigint, text) from public, anon;
revoke all on function public.retablir_artiste(uuid)                   from public, anon;
revoke all on function public.bannis_liste()                           from public, anon;

grant execute on function public.bannir_artiste(text, text, bigint, text) to authenticated;
grant execute on function public.retablir_artiste(uuid)                   to authenticated;
grant execute on function public.bannis_liste()                           to authenticated;

notify pgrst, 'reload schema';

commit;


-- ---------------------------------------------------------------------
-- Retrait (à garder de côté, pas à exécuter maintenant)
--
-- Après avoir rétabli chaque artiste depuis l'espace équipe :
--
--   drop trigger if exists artists_garde_bannis on public.artists;
--   drop trigger if exists submissions_garde_bannis on public.submissions;
--   drop policy if exists "artistes bannis masques" on public.artists;
--   drop policy if exists "sorties des bannis masquees" on public.submissions;
--   drop function if exists public.bannir_artiste(text, text, bigint, text);
--   drop function if exists public.retablir_artiste(uuid);
--   drop function if exists public.bannis_liste();
--   drop function if exists public.bannissements_appliquer();
--   drop function if exists public.artists_garde_bannis();
--   drop function if exists public.submissions_garde_bannis();
--   drop function if exists public.artiste_banni(text, text, bigint);
--   drop function if exists public.ban_correspond(public.artistes_bannis, text, text, bigint);
--   drop function if exists public.norme_artiste(text);
--   drop table if exists public.artistes_bannis;
--   alter table public.artists     drop column if exists banni;
--   alter table public.submissions drop column if exists banni;
-- ---------------------------------------------------------------------
