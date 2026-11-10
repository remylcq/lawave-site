-- Artistes bannis : retirer aussi leur nom des titres « (feat. …) » (2026-11-10).
-- Le bannissement (bannir_artiste) retire déjà leurs sorties, leurs cartes et leurs mentions dans le champ « featuring ».
-- Il restait le titre lui-même (ex. « Poche (feat. Lomepal) »). Cette fonction nettoie « (feat. X) », « [ft. X] », « (avec X) »
-- pour chaque artiste de la liste des bannis ; elle tourne toutes les 6 heures, donc aussi pour les futurs bannissements.
-- Lomepal a été banni en production avec bannir_artiste (retablir_artiste le remet si besoin).
-- Sans danger si on le repasse.

create or replace function public.bannis_titres_nettoyer() returns integer
language plpgsql security definer set search_path to 'public' as $$
declare r record; v_n integer := 0; v_k integer; v_motif text;
begin
  create temporary table if not exists _titres_feat (id uuid primary key) on commit drop;
  truncate _titres_feat;
  insert into _titres_feat select s.id from public.submissions s where s.track_title ~* '[\(\[]\s*(feat|ft|featuring|avec)';
  for r in select b.nom from public.artistes_bannis b where length(btrim(b.nom)) >= 3 loop
    v_motif := '\s*[\(\[]\s*(feat\.?|ft\.?|featuring|avec)\s+' || regexp_replace(btrim(r.nom), '([.^$*+?()\[\]{}|\\])', '\\\1', 'g') || '\s*[\)\]]';
    update public.submissions s set track_title = btrim(regexp_replace(s.track_title, v_motif, '', 'gi'))
     where s.id in (select id from _titres_feat) and s.track_title ~* v_motif;
    get diagnostics v_k = row_count; v_n := v_n + v_k;
  end loop;
  return v_n;
end $$;
revoke all on function public.bannis_titres_nettoyer() from public, anon, authenticated;

do $$ begin
  if not exists (select 1 from cron.job where jobname = 'bannis-titres') then
    perform cron.schedule('bannis-titres', '17 */6 * * *', 'select public.bannis_titres_nettoyer()');
  end if;
end $$;

select public.bannis_titres_nettoyer();
