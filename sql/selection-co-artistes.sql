-- =====================================================================
-- La Wave — projets en commun dans la sélection de l'accueil
--
-- Retour de Rémy : afficher le deuxième artiste principal quand une sortie est
-- un projet en commun.
--
-- Deezer range tous les crédits d'un album en « Main » (même de simples
-- invités sur une mixtape) : impossible de reconnaître un vrai projet en commun
-- à coup sûr. C'est donc l'équipe qui le dit, sortie par sortie, dans l'onglet
-- « Sélection » (cases « Aussi artiste principal ») ; le choix est gardé ici :
--
--   co_artistes : [ { "nom": "…", "handle": "…" }, … ]
--
-- L'accueil écrit alors « A & B » sous la pochette.
--
-- À passer APRÈS sql/selection-accueil.sql. Sans danger à rejouer.
-- =====================================================================

alter table public.selection_accueil
  add column if not exists co_artistes jsonb not null default '[]'::jsonb;
