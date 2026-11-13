-- Import Deezer limité aux artistes déjà présents sur le site, discographie complète, profils des invités validés à la main.
-- (Passé en production le 2026-11-14.)
--
-- 1. L'import (importer_sorties_deezer) et la complétion des featurings (completer_sorties_deezer) ne créent plus aucun profil :
--    un album dont l'artiste principal n'est pas l'artiste suivi est ignoré ; un invité sans profil garde son nom (handle nul,
--    'deezer_id' conservé dans l'entrée de featuring) et est inscrit dans artistes_proposes, en attente de validation.
--    Patchs appliqués par remplacement de texte sur la définition des deux fonctions (voir l'historique du dépôt / la base).
-- 2. Tâche deezer-import-sorties : importer_sorties_deezer(20, false, 1200) -> toute la discographie (et non plus 6 mois) ;
--    tâche deezer-discographies réactivée (premier passage complet). Les albums marqués « import vidé » sont de nouveau importables.
-- 3. Onglet « Nouveaux artistes » de Soumissions : propositions_liste / proposition_decider. Valider crée le profil
--    (deezer_profil_artiste), le suit, et relie les sorties qui citaient l'invité ; refuser garde le nom sans lien.
-- RETRAIT : drop function public.propositions_liste(text, integer, integer), public.proposition_decider(bigint[], boolean);
--   drop table public.artistes_proposes;

create table if not exists public.artistes_proposes (
  deezer_artist_id bigint primary key,
  nom              text not null,
  photo            text,
  nb_sorties       integer not null default 1,
  exemple_titre    text,
  exemple_par      text,
  statut           text not null default 'attente' check (statut in ('attente', 'valide', 'refuse')),
  cree_le          timestamptz not null default now(),
  decide_le        timestamptz
);
alter table public.artistes_proposes enable row level security;
revoke all on public.artistes_proposes from public, anon, authenticated;
create index if not exists artistes_proposes_attente_idx on public.artistes_proposes (nb_sorties desc) where statut = 'attente';

create or replace function public.propositions_liste(p_texte text default '', p_page integer default 0, p_taille integer default 50)
returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare v_q text := nullif(replace(replace(btrim(coalesce(p_texte, '')), '%', ''), '_', ''), ''); v_total integer; v_items jsonb;
begin
  if auth.uid() is null or not public.est_equipe() then raise exception 'Réservé à l''équipe.'; end if;
  select count(*) into v_total from public.artistes_proposes p where p.statut = 'attente' and (v_q is null or p.nom ilike '%' || v_q || '%');
  select coalesce(jsonb_agg(jsonb_build_object('id', x.deezer_artist_id, 'nom', x.nom, 'photo', x.photo, 'n', x.nb_sorties, 'titre', x.exemple_titre, 'par', x.exemple_par) order by x.nb_sorties desc, x.nom), '[]'::jsonb)
    into v_items
    from (select * from public.artistes_proposes p where p.statut = 'attente' and (v_q is null or p.nom ilike '%' || v_q || '%')
           order by p.nb_sorties desc, p.nom offset greatest(p_page, 0) * greatest(p_taille, 1) limit greatest(least(p_taille, 100), 1)) x;
  return jsonb_build_object('total', v_total, 'items', v_items);
end $$;
revoke all on function public.propositions_liste(text, integer, integer) from public, anon;
grant execute on function public.propositions_liste(text, integer, integer) to authenticated;

create or replace function public.proposition_decider(p_ids bigint[], p_valider boolean)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare p record; v_ligne public.artists; v_ok integer := 0; v_refus integer := 0;
begin
  if auth.uid() is null or not public.est_equipe() then raise exception 'Réservé à l''équipe.'; end if;

  for p in select * from public.artistes_proposes where deezer_artist_id = any(p_ids) and statut = 'attente' loop
    if p_valider and not public.artiste_banni(null, p.nom, p.deezer_artist_id) then
      v_ligne := public.deezer_profil_artiste(p.deezer_artist_id, p.nom, p.photo);

      update public.artists set deezer_suivi = true where id = v_ligne.id and not coalesce(banni, false);

      update public.submissions s
         set featuring = (
               select jsonb_agg(case when e.value->>'deezer_id' = p.deezer_artist_id::text
                                     then e.value || jsonb_build_object('handle', v_ligne.instagram_handle, 'nom', coalesce(nullif(v_ligne.display_name, ''), p.nom))
                                     else e.value end order by e.ord)
                 from jsonb_array_elements(s.featuring) with ordinality as e(value, ord))
       where s.featuring @> jsonb_build_array(jsonb_build_object('deezer_id', p.deezer_artist_id));

      update public.artistes_proposes set statut = 'valide', decide_le = now() where deezer_artist_id = p.deezer_artist_id;
      v_ok := v_ok + 1;
    else
      update public.artistes_proposes set statut = 'refuse', decide_le = now() where deezer_artist_id = p.deezer_artist_id;
      v_refus := v_refus + 1;
    end if;
  end loop;

  return jsonb_build_object('valides', v_ok, 'refuses', v_refus);
end $$;
revoke all on function public.proposition_decider(bigint[], boolean) from public, anon;
grant execute on function public.proposition_decider(bigint[], boolean) to authenticated;
