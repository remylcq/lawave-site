#!/usr/bin/env bash
# Contrôle de sécurité de la base Supabase (lecture seule). Échoue si :
#   1. une table de public n'a pas la RLS ;
#   2. une fonction SECURITY DEFINER n'a pas de search_path figé ;
#   3. une fonction de public est exécutable par un visiteur sans compte (anon) sans figurer dans fonctions-anon.txt ;
#   4. un bucket de stockage est public sans figurer dans buckets-publics.txt ;
#   5. anon a un droit d'écriture sur une table (hors dépôt d'un signalement de bug).
# Usage : SUPABASE_DB_URL=postgresql://… bash outils/securite/controler-base.sh
set -euo pipefail

: "${SUPABASE_DB_URL:?SUPABASE_DB_URL est vide}"

ici="$(cd "$(dirname "$0")" && pwd)"
echec=0

# Une requête qui échoue (base injoignable, mot de passe refusé…) arrête tout : jamais de « ok » par défaut.
requete() {
  psql "$SUPABASE_DB_URL" -X -A -t -q -v ON_ERROR_STOP=1 -c "$1" || { echo "::error title=Sécurité de la base::la requête a échoué (base injoignable ?)"; exit 2; }
}

# $1 : titre, $2 : lignes fautives (vide = tout va bien)
verdict() {
  if [ -n "$2" ]; then
    echo "::error title=Sécurité de la base::$1"
    echo "ÉCHEC — $1 :"
    echo "$2" | sed 's/^/   · /'
    echec=1
  else
    echo "ok — $1"
  fi
}

fautives="$(requete "
  select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r','p') and not c.relrowsecurity order by 1")"
verdict "tables de public sans RLS" "$fautives"

fautives="$(requete "
  select p.proname from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prosecdef and p.prokind in ('f','p')
     and not exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) c where c like 'search_path=%')
     and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
   order by 1")"
verdict "fonctions SECURITY DEFINER sans search_path figé" "$fautives"

reel="$(requete "
  select distinct p.proname from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prokind in ('f','p')
     and has_function_privilege('anon', p.oid, 'execute')
     and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
   order by 1")"
reel="$(echo "$reel" | sort -u)"
voulu="$(grep -v '^\s*#' "$ici/fonctions-anon.txt" | sed '/^\s*$/d' | sort -u)"
verdict "fonctions ouvertes aux visiteurs sans compte, absentes de fonctions-anon.txt (si c'est voulu, ajoute-les au fichier)" \
  "$(comm -23 <(echo "$reel") <(echo "$voulu"))"

reel="$(requete "select id from storage.buckets where public order by 1")"
reel="$(echo "$reel" | sort -u)"
voulu="$(grep -v '^\s*#' "$ici/buckets-publics.txt" | sed '/^\s*$/d' | sort -u)"
verdict "buckets publics absents de buckets-publics.txt" "$(comm -23 <(echo "$reel") <(echo "$voulu"))"

fautives="$(requete "
  select table_name || ' : ' || privilege_type from information_schema.role_table_grants
   where table_schema = 'public' and grantee = 'anon'
     and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER')
     and not (table_name = 'bug_reports' and privilege_type = 'INSERT')
   order by 1")"
verdict "droits d'écriture de anon sur les tables (seul bug_reports INSERT est permis)" "$fautives"

exit "$echec"
