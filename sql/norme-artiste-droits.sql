-- =====================================================================
-- La Wave — l'ajout d'une sortie était refusé : « permission denied for function norme_artiste »
--
-- Le déclencheur submissions_normes_maj remplit artist_norme et artist_handle_norme à chaque ajout ou
-- modification d'une sortie. Il tourne avec les droits de la personne qui ajoute (membre de l'équipe dans
-- l'ajout manuel, visiteur dans le formulaire public), or norme_artiste n'était exécutable que par
-- l'administrateur de la base et service_role : tout ajout échouait.
--
-- norme_artiste ne fait que normaliser un texte (minuscules, sans accents ni espaces) : rien à protéger.
-- Passé en production le 2026-10-21 avec l'accord de Rémy. Sans danger à rejouer.
-- =====================================================================

grant execute on function public.norme_artiste(text) to anon, authenticated;
