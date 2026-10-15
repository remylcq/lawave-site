-- =====================================================================
-- La Wave — espace équipe : les comptes par artiste, calculés par la base
--
-- L'onglet Artistes de l'espace équipe affichait, pour chaque profil, son nombre
-- de sorties, de featurings, de sorties importées de Deezer et ses adresses de
-- contact. Pour cela le navigateur relisait TOUTES les sorties (22 000 lignes,
-- 2,6 Mo, près de 8 secondes) à chaque ouverture de l'espace équipe et à
-- chaque modification d'artiste.
--
-- equipe_comptes_artistes() rend la même chose, déjà comptée, en une requête :
--   { "<pseudo>": { n: sorties, d: dont importées de Deezer, f: featurings,
--                   emails: [adresses de contact distinctes] }, … }
-- Toutes les sorties comptent, quel que soit leur état (comme avant).
--
-- Réservé à l'équipe : les adresses de contact y figurent.
--
-- Sans danger à rejouer.
-- =====================================================================

create or replace function public.equipe_comptes_artistes()
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
    with a as (
      select s.artist_handle as h,
             count(*)                                          as n,
             count(*) filter (where s.source = 'deezer')       as d,
             array_agg(distinct btrim(s.contact_email))
               filter (where nullif(btrim(coalesce(s.contact_email, '')), '') is not null) as emails
        from public.submissions s
       where s.artist_handle is not null
       group by s.artist_handle
    ),
    f as (
      select e.value ->> 'handle' as h, count(*) as nf
        from public.submissions s
       cross join lateral jsonb_array_elements(
             case when jsonb_typeof(s.featuring) = 'array' then s.featuring else '[]'::jsonb end
           ) as e(value)
       where e.value ->> 'handle' is not null
       group by 1
    )
    select jsonb_object_agg(
             coalesce(a.h, f.h),
             jsonb_build_object(
               'n',      coalesce(a.n, 0),
               'd',      coalesce(a.d, 0),
               'f',      coalesce(f.nf, 0),
               'emails', coalesce(to_jsonb(a.emails), '[]'::jsonb)
             )
           )
      from a full join f on a.h = f.h
  ), '{}'::jsonb);

end $$;

revoke all on function public.equipe_comptes_artistes() from public, anon;
grant execute on function public.equipe_comptes_artistes() to authenticated;
