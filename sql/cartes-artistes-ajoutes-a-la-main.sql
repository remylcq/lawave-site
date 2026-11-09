-- Wave Cards : un artiste ajouté à la main par l'équipe a sa carte tout de suite (2026-11-09).
-- Avant : le jeu ne créait de cartes que pour les artistes marqués « francophone » ; un artiste ajouté à la main n'a pas de langue connue (champ vide,
-- il n'a pas d'identifiant Deezer pour que la détection de langue le traite) : Cherry Pie n'apparaissait pas dans « Ajouter des artistes ».
-- Maintenant : langue inconnue + source vide (ajouté à la main) = traité comme francophone, comme les artistes de la liste d'origine.
-- Les artistes de l'import Deezer automatique (source « deezer-auto ») restent écartés tant que leur langue n'est pas établie.
-- La définition de jeu_cartes_rafraichir est relue en base puis modifiée (rien n'est refait si c'est déjà fait).
do $$
declare d text;
begin
  d := pg_get_functiondef('public.jeu_cartes_rafraichir()'::regprocedure);
  if position('a.francophone is null and a.source is null' in d) > 0 then return; end if;
  if position('where not a.banni and a.francophone is true' in d) = 0 then raise exception 'jeu_cartes_rafraichir : motif introuvable'; end if;
  d := replace(d, 'where not a.banni and a.francophone is true', 'where not a.banni and (a.francophone is true or (a.francophone is null and a.source is null))');
  execute d;
end $$;
select public.jeu_cartes_rafraichir();
