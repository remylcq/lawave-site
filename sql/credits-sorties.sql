-- ============================================================
-- Crédits d'une sortie (beatmaker, mixage, mastering, ingé son…)
-- Passé en production (projet La Wave). Peut être rejoué sans risque.
--
-- Deezer ne donne que les artistes : les crédits techniques sont saisis par l'équipe, sur la fiche de la sortie.
-- Chaque crédit a un rôle, un nom et, si la personne a une page sur le site, son identifiant (le nom devient alors un lien).
--
--   sortie_credits(p_release)                          lecture publique (sortie publiée seulement)
--   sortie_credit_ajouter(p_release, p_role, p_nom, p_handle)   équipe
--   sortie_credit_supprimer(p_id)                      équipe
--
-- RETRAIT : drop function if exists public.sortie_credits(uuid), public.sortie_credit_ajouter(uuid,text,text,text),
--           public.sortie_credit_supprimer(uuid); drop table if exists public.sortie_credits_table;
-- ============================================================

create table if not exists public.sortie_credits_table (
  id         uuid primary key default gen_random_uuid(),
  release_id uuid not null references public.submissions(id) on delete cascade,
  role       text not null check (role in ('Production','Beatmaker','Composition','Écriture','Ingé son','Mixage','Mastering',
                                           'Direction artistique','Réalisation clip','Photographie','Design pochette','Autre')),
  nom        text not null check (char_length(btrim(nom)) between 1 and 80),
  handle     text,
  ordre      integer not null default 0,
  cree_le    timestamptz not null default now()
);

create index if not exists sortie_credits_release_idx on public.sortie_credits_table (release_id, ordre, cree_le);

alter table public.sortie_credits_table enable row level security;
revoke all on table public.sortie_credits_table from anon, authenticated;

create or replace function public.sortie_credits(p_release uuid) returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'role', c.role, 'nom', c.nom, 'handle', c.handle)
                            order by c.ordre, c.cree_le), '[]'::jsonb)
    from public.sortie_credits_table c
    join public.submissions s on s.id = c.release_id
   where c.release_id = p_release and s.status = 'approved' and not s.banni;
$$;

create or replace function public.sortie_credit_ajouter(p_release uuid, p_role text, p_nom text, p_handle text default null)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_id uuid;
begin
  if not public.est_equipe() then
    raise exception 'Réservé à l''équipe.';
  end if;

  if not exists (select 1 from public.submissions where id = p_release) then
    raise exception 'Cette sortie n''existe pas.';
  end if;

  insert into public.sortie_credits_table (release_id, role, nom, handle, ordre)
  values (p_release, p_role, btrim(p_nom), nullif(btrim(coalesce(p_handle, '')), ''),
          coalesce((select max(ordre) + 1 from public.sortie_credits_table where release_id = p_release), 0))
  returning id into v_id;

  return jsonb_build_object('id', v_id);
end $$;

create or replace function public.sortie_credit_supprimer(p_id uuid) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.est_equipe() then
    raise exception 'Réservé à l''équipe.';
  end if;

  delete from public.sortie_credits_table where id = p_id;

  return jsonb_build_object('ok', true);
end $$;

grant execute on function public.sortie_credits(uuid) to anon, authenticated;
grant execute on function public.sortie_credit_ajouter(uuid, text, text, text) to authenticated;
grant execute on function public.sortie_credit_supprimer(uuid) to authenticated;
