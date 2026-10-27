-- Vague Glaciale : le booster utilise le visuel fourni par Rémy tel quel (plus d'effet pixel) : img/visuel-glaciale.webp
-- À passer APRÈS le déploiement du site (le fichier doit exister). Sans danger si on le repasse.
update public.jeu_boosters set visuel = 'img/visuel-glaciale.webp' where id = 'glaciale';
