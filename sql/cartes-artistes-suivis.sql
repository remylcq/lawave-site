-- Wave Cards : seuls les artistes suivis ont des cartes (2026-11-10).
-- Avant : tout artiste du site qui avait une sortie approuvée avait ses cartes, y compris les simples invités importés automatiquement
-- (artists.deezer_suivi = false), comme Lomepal. Maintenant : seuls les artistes suivis (deezer_suivi) ou ajoutés à la main ont des cartes ;
-- un artiste non suivi garde ses cartes tant qu'un joueur en possède (rien ne disparaît d'une collection). Les artistes bannis et d'une autre
-- langue restent exclus. Un artiste qui devient suivi retrouve ses cartes au prochain rafraîchissement (toutes les 20 minutes).
do $$
declare d text;
begin
  d := pg_get_functiondef('public.jeu_cartes_rafraichir()'::regprocedure);
  if position('deezer_suivi is distinct from false' in d) = 0 then
    if position('where not a.banni and a.francophone is not false' in d) = 0 then raise exception 'jeu_cartes_rafraichir : motif introuvable'; end if;
    d := replace(d, 'where not a.banni and a.francophone is not false',
      'where not a.banni and a.francophone is not false
       and (a.deezer_suivi is distinct from false
            or a.id in (select c0.artiste_id from public.jeu_collection_b x0 join public.jeu_cartes c0 on c0.artist_id = x0.artist_id where x0.quantite > 0))');
    execute d;
  end if;
end $$;
select public.jeu_cartes_rafraichir();
