-- Wave Cards : la rareté est mélangée autour de celle de l'artiste (2026-11-10).
-- Avant : toutes les cartes d'un artiste avaient la même rareté (un single = un cran de moins) : toutes celles de JUL étaient Légendaires.
-- Maintenant : la rareté de l'artiste (plafonnée à Légendaire) sert de base, et chaque carte s'en écarte selon un tirage fixe tiré de l'identifiant de la sortie
-- (toujours le même pour une carte donnée) :
--   projet : +1 (10 %), identique (50 %), -1 (30 %), -2 (10 %)
--   single : +1 (3 %), identique (17 %), -1 (30 %), -2 (30 %), -3 (20 %)
--   le résultat reste entre Commun et Légendaire.
-- Les raretés du pack principal sont recalculées une fois ; elles se règlent ensuite carte par carte dans la console.
do $$
declare d text;
begin
  d := pg_get_functiondef('public.jeu_cartes_rafraichir()'::regprocedure);
  if position('uu.u' in d) = 0 then
    if position('(case when so.release_type = ''Projet'' then tt.t else greatest(tt.t - 1, 1) end)::smallint' in d) = 0 or position('end as t) tt;' in d) = 0 then raise exception 'jeu_cartes_rafraichir : motif introuvable'; end if;
    d := replace(d, '(case when so.release_type = ''Projet'' then tt.t else greatest(tt.t - 1, 1) end)::smallint',
      'greatest(1, least(4, least(tt.t, 4) + (case when so.release_type = ''Projet'' then (case when uu.u < 10 then 1 when uu.u < 60 then 0 when uu.u < 90 then -1 else -2 end)
                                                    else (case when uu.u < 3 then 1 when uu.u < 20 then 0 when uu.u < 50 then -1 when uu.u < 80 then -2 else -3 end) end)))::smallint');
    d := replace(d, 'end as t) tt;', 'end as t) tt
    cross join lateral (select abs(hashtext(so.id::text || ''rarete'')) % 100 as u) uu;');
    execute d;
  end if;
  perform public.jeu_cartes_rafraichir();
  update public.jeu_booster_cartes bc set rarete = least(c.rarete, 4) from public.jeu_cartes c
   where bc.booster_id = 'principal' and c.artist_id = bc.artist_id and bc.rarete is distinct from least(c.rarete, 4);
end $$;
