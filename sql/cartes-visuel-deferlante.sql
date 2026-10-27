-- Vague Déferlante : visuel du booster fourni par Rémy (« Classic Wave ») : img/visuel-deferlante.webp
-- À passer APRÈS le déploiement du site (le fichier doit exister). Sans danger si on le repasse.
update public.jeu_boosters set visuel = 'img/visuel-deferlante.webp' where id = 'deferlante';
