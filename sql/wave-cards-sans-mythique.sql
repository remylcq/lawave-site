-- La rareté Mythique est retirée : ses cartes deviennent Légendaires, ses chances de tirage vont aux Légendaires,
-- ses succès disparaissent. (Passé en production le 2026-11-09.)
update public.jeu_cartes set rarete = 4 where rarete = 5;
update public.jeu_booster_cartes set rarete = 4 where rarete = 5;
update public.jeu_boosters
   set taux = case when array_length(taux, 1) >= 6
                   then array[taux[1], taux[2], taux[3], taux[4] + taux[5], 0::numeric, taux[6]]
                   else array[taux[1], taux[2], taux[3], taux[4] + taux[5], 0::numeric] end
 where taux is not null and array_length(taux, 1) >= 5;
delete from public.jeu_succes_def where famille = 'mythiques';
