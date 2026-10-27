-- Vague Glaciale : vinyle pixel avec le disque en noir franc (sans reflet), titre en clair bien lisible : img/vinyle-glaciale-pixel-3.png
-- À passer APRÈS le déploiement du site (le fichier doit exister). Sans danger si on le repasse.
update public.jeu_boosters set visuel = 'img/vinyle-glaciale-pixel-3.png' where id = 'glaciale';
