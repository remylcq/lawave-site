-- Wave Cards : la série de lancement disparaît (demande de Rémy, 2026-10-27).
-- Toutes les cartes de la série de base, y compris celles déjà obtenues par les joueurs, sont retirées.
-- Il ne reste que les classeurs des collections (Classic Wave, Vague Glaciale…).
--
--  1. les cartes obtenues sont mises de côté (jeu_collection_serie_lancement) puis retirées de jeu_collection ;
--  2. le pack garanti tire désormais dans Classic Wave (Épique ou mieux) au lieu de la série de lancement ;
--  3. les compteurs (en-tête, succès « cartes différentes / raretés ») comptent les cartes des classeurs.
-- La table jeu_cartes reste : elle sert aussi d'annuaire d'artistes (nom, photo) aux classeurs.

-- 1. Mise de côté, puis retrait
create table if not exists public.jeu_collection_serie_lancement as
  select c.*, now() as retire_le from public.jeu_collection c;
alter table public.jeu_collection_serie_lancement enable row level security;
delete from public.jeu_collection;

-- 2. Le pack garanti tire dans Classic Wave
do $$
declare d text;
begin
  d := pg_get_functiondef('public.jeu_ouvrir(integer,boolean,text)'::regprocedure);
  d := replace(d, 'case when p_garanti then ''scene'' else', 'case when p_garanti then ''deferlante'' else');
  if position('then ''deferlante'' else' in d) = 0 then raise exception 'jeu_ouvrir : motif introuvable'; end if;
  execute d;
end $$;

-- 3. Les compteurs comptent les cartes des classeurs
do $$
declare d text;
begin
  d := pg_get_functiondef('public.jeu_etat_json(uuid)'::regprocedure);
  d := regexp_replace(d, '''uniques'',\s*\(select count\(distinct col\.artist_id\).*?c\.active\),',
    $r$'uniques', (select count(*) from (select distinct col.booster_id, col.artist_id from public.jeu_collection_b col
                  join public.jeu_boosters bb on bb.id = col.booster_id and bb.classeur and bb.actif
                  join public.jeu_booster_cartes bc on bc.booster_id = col.booster_id and bc.artist_id = col.artist_id
                 where col.user_id = p_user and col.quantite > 0) x),$r$, 's');
  d := regexp_replace(d, '''total_cartes'',\s*\(select count\(\*\) from public\.jeu_cartes where active\)',
    $r$'total_cartes', (select count(*) from public.jeu_booster_cartes bc
                  join public.jeu_boosters bb on bb.id = bc.booster_id and bb.classeur and bb.actif
                  join public.jeu_cartes c on c.artist_id = bc.artist_id and c.active)$r$, 's');
  if position('jeu_collection_b col' in d) = 0 or position('bb.classeur and bb.actif' in d) = 0 then raise exception 'jeu_etat_json : motif introuvable'; end if;
  execute d;

  d := pg_get_functiondef('public.jeu_metriques(uuid)'::regprocedure);
  d := regexp_replace(d, 'from \(select distinct artist_id from public\.jeu_collection where user_id = p_user and quantite > 0\) o\s+join public\.jeu_cartes k on k\.artist_id = o\.artist_id',
    $r$from (select distinct bc.booster_id, bc.artist_id, bc.rarete from public.jeu_collection_b col
              join public.jeu_boosters bb on bb.id = col.booster_id and bb.classeur and bb.actif
              join public.jeu_booster_cartes bc on bc.booster_id = col.booster_id and bc.artist_id = col.artist_id
             where col.user_id = p_user and col.quantite > 0) k$r$, 's');
  if position('jeu_collection_b col' in d) = 0 then raise exception 'jeu_metriques : motif introuvable'; end if;
  execute d;
end $$;
