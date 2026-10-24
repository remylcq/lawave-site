-- ============================================================
-- Fige le search_path des fonctions d'assistance (alerte Supabase
-- « function_search_path_mutable »).
--
-- Sans réglage, une fonction cherche ses tables et ses fonctions dans
-- le search_path de l'appelant : un appelant qui fabrique un schéma à
-- lui peut détourner ce qu'elle trouve. On le fige sur public,
-- extensions (pour http, pgcrypto…) puis pg_temp en dernier.
--
-- Ne change rien au comportement : les fonctions visées ne lisent que
-- des objets de public / extensions. Réversible, par fonction :
--   alter function public.<nom>(<args>) reset search_path;
-- Peut être rejoué sans risque.
-- ============================================================

do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as signature
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.prokind = 'f'
      and not exists (
        select 1 from unnest(coalesce(p.proconfig, '{}')) c
        where c like 'search_path=%'
      )
      -- pas les fonctions d'extensions installées dans public
      and not exists (
        select 1 from pg_depend d
        where d.objid = p.oid and d.deptype = 'e'
      )
  loop
    execute format('alter function %s set search_path = public, extensions, pg_temp', f.signature);
  end loop;
end $$;
