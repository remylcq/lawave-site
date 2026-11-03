-- (Passé en production le 2026-11-04 avec l'accord de Rémy.)
-- Wave Cards, étape 3 : on repart de zéro (décision de Rémy, 2026-11-04). Les collections des joueurs sont vidées (les cartes d'avant n'ont
-- ni IV ni carte d'album), les joueurs récupèrent des vinyles à la place (la valeur de leurs cartes différentes, 1 500 au maximum).
-- À passer UNE SEULE FOIS, juste après sql/cartes-exemplaires-iv.sql.

-- 1. Le remboursement : la valeur de chaque carte différente possédée, plafonnée
update public.jeu_joueurs j set vinyles = j.vinyles + r.gain
  from (select col.user_id, least(1500, sum(public.jeu_valeur(bc.rarete) * case when col.holo then 3 else 1 end))::integer as gain
          from public.jeu_collection_b col
          join public.jeu_booster_cartes bc on bc.booster_id = col.booster_id and bc.artist_id = col.artist_id
         where col.quantite > 0 group by col.user_id) r
 where r.user_id = j.user_id;

-- 2. Les cartes en vente sont annulées, les équipes de combat et les défenses n'ont plus de cartes
update public.marche_annonces set etat = 'annulee', ferme_le = now() where etat = 'active';
delete from public.combat_equipes;
delete from public.combat_duos_sauves;
delete from public.pvp_defenses;
delete from public.jeu_expeditions where etat = 'en_cours';

-- 3. Les collections
delete from public.jeu_exemplaires;
delete from public.jeu_collection_b;
