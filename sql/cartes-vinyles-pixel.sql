-- Vague Glaciale : le vinyle passe au style pixel (bitmap 1 bit, tramé) : img/vinyle-glaciale-pixel.png
-- À passer APRÈS le déploiement du site (le fichier doit exister). Sans danger si on le repasse.
update public.jeu_boosters set visuel = 'img/vinyle-glaciale-pixel.png' where id = 'glaciale';
