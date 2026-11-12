-- Bannir un artiste ne doit plus dépasser le délai de 8 s des appels du site (« canceling statement due to statement timeout »).
-- Cause : bannir_artiste rejouait à chaque fois bannissements_appliquer() sur TOUS les profils et TOUTES les sorties
-- (plus de 70 000 aujourd'hui, ~4 s à vide, bien plus pendant les imports), puis parcourait tous les featurings.
-- Maintenant : l'appel ne traite que cet artiste (pseudo, page Deezer, nom normalisé) et ses featurings, ce qui est
-- immédiat ; le recalcul complet (même nom sous un autre pseudo…) est demandé et fait dans la minute qui suit
-- par une tâche planifiée. (Passé en production le 2026-11-12.)
-- (Version finale passée en production : les featurings aussi sont différés — fonction bannissement_featurings, file
--  bannissements_a_appliquer(ban_id) traitée chaque minute par la tâche bannissements-rattrapage ; le fichier ci-dessous
--  est la première version, remplacée par les migrations bannir_rapide_featurings_exacts et bannir_rapide_file_attente.)
-- RETRAIT : select cron.unschedule('bannissements-rattrapage'); drop function public.bannissements_rattrapage();
--   drop table public.bannissements_a_appliquer; puis remettre bannir_artiste de sql/artistes-bannis.sql.

create table if not exists public.bannissements_a_appliquer (
  id         integer primary key default 1 check (id = 1),
  demande_le timestamptz not null default now()
);
alter table public.bannissements_a_appliquer enable row level security;
revoke all on table public.bannissements_a_appliquer from anon, authenticated;

create or replace function public.bannissements_rattrapage() returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_demande timestamptz;
begin
  if not pg_try_advisory_xact_lock(hashtext('bannissements_rattrapage')) then
    return jsonb_build_object('ignore', true);
  end if;
  delete from public.bannissements_a_appliquer returning demande_le into v_demande;
  if v_demande is null then return jsonb_build_object('rien', true); end if;
  return public.bannissements_appliquer();
end $$;
revoke all on function public.bannissements_rattrapage() from public, anon, authenticated;

create or replace function public.bannir_artiste(p_nom text default null, p_handle text default null, p_deezer_id bigint default null, p_raison text default null)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_a       public.artists;
  v_ban     public.artistes_bannis;
  v_nom     text   := nullif(btrim(coalesce(p_nom, '')), '');
  v_handle  text   := nullif(btrim(coalesce(p_handle, '')), '');
  v_deezer  bigint := p_deezer_id;
  v_norme   text;
  v_handles text[] := '{}';
  v_sorties integer := 0;
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

  -- Les profils exacts (pseudo, page Deezer) : masqués et plus suivis tout de suite.
  with m as (
    update public.artists a
       set banni = true, deezer_suivi = false, updated_at = now()
     where not a.banni
       and ((v_handle is not null and a.instagram_handle = v_handle)
         or (v_deezer is not null and a.deezer_artist_id = v_deezer))
    returning a.instagram_handle
  )
  select coalesce(array_agg(instagram_handle), '{}') into v_handles from m;

  if v_handle is not null and not (v_handle = any(v_handles)) then
    v_handles := v_handles || v_handle;
  end if;

  update public.artistes_bannis b
     set deezer_ids = array(
           select a.deezer_artist_id from public.artists a
            where a.instagram_handle = any(v_handles) and a.deezer_artist_id is not null
           union
           select v_deezer where v_deezer is not null
         )
   where b.id = v_ban.id;

  select * into v_ban from public.artistes_bannis b where b.id = v_ban.id;

  -- Ses sorties : masquées tout de suite.
  update public.submissions s
     set banni = true
   where not s.banni
     and (s.artist_handle = any(v_handles)
       or (v_norme is not null and (s.artist_norme = v_norme or s.artist_handle_norme = v_norme)));
  get diagnostics v_sorties = row_count;

  -- Ses apparitions en featuring sur les sorties des autres : retirées, et gardées de côté pour le rétablissement.
  -- Seules les sorties où il apparaît (pseudo ou nom) sont parcourues.
  for v_sortie in
    select s.id, s.featuring
      from public.submissions s
     where not s.banni
       and jsonb_typeof(s.featuring) = 'array'
       and jsonb_array_length(s.featuring) > 0
       and (s.featuring::text ilike '%' || replace(replace(replace(v_nom, '\', '\\'), '%', '\%'), '_', '\_') || '%'
            or exists (select 1 from unnest(v_handles) h
                        where s.featuring @> jsonb_build_array(jsonb_build_object('handle', h))))
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

  -- Le recalcul complet (même nom sous un autre pseudo, autres profils liés) se fait dans la minute qui suit.
  insert into public.bannissements_a_appliquer (id) values (1) on conflict (id) do update set demande_le = now();

  return jsonb_build_object(
    'id',         v_ban.id,
    'nom',        v_nom,
    'profils',    coalesce(cardinality(v_handles), 0),
    'sorties',    v_sorties,
    'featurings', v_feats
  );

end $$;
