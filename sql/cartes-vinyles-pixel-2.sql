-- Vague Glaciale : vinyle pixel, version plus détaillée (320 px tramés, logo La Wave conservé) : img/vinyle-glaciale-pixel-2.png
-- À passer APRÈS le déploiement du site (le fichier doit exister). Sans danger si on le repasse.
update public.jeu_boosters set visuel = 'img/vinyle-glaciale-pixel-2.png' where id = 'glaciale';
