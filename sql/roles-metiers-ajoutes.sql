-- =====================================================================
-- La Wave — quatre nouveaux rôles : musicien, ingénieur son, danseur, graphiste
--
-- Demande de Rémy : « rajouter dans les rôles : ingénieur son, danseurs /
-- danseuses, musicien (tout ce qui est instrument, guitare, piano) et graphiste ».
--
-- Le rôle d'un profil est un texte libre (aucune contrainte à modifier). Il reste
-- à dire à Explorer quel métier chaque rôle représente, pour que ces membres
-- soient retrouvés par métier :
--
--   Musicien / Musicienne  ->  musicien   (nouveau métier)
--   Danseur / Danseuse     ->  danse      (nouveau métier)
--   Ingénieur son          ->  ingenieur  (existe : « Ingé son · mix & master »)
--   Graphiste              ->  da         (existe : « DA · graphisme »)
--
-- Sans danger à rejouer.
-- =====================================================================

insert into public.com_metiers (cle, libelle, icone, ordre) values
  ('musicien', 'Musicien·ne · instrumentiste', '🎸', 35),
  ('danse',    'Danseur·se',                   '💃', 65)
on conflict (cle) do nothing;


create or replace function public.com_role_cle(p_role text)
returns text
language sql
immutable
as $$
  select case public.com_role_canonique(p_role)
    when 'Artiste'                then 'artiste'
    when 'Beatmaker'              then 'beatmaker'
    when 'DJ'                     then 'dj'
    when 'Photographe'            then 'photographe'
    when 'Manager'                then 'manager'
    when 'Membre d''un label'     then 'label'
    when 'Relation presse'        then 'media'
    when 'Média / Presse'         then 'media'
    when 'Musicien / Musicienne'  then 'musicien'
    when 'Ingénieur son'          then 'ingenieur'
    when 'Danseur / Danseuse'     then 'danse'
    when 'Graphiste'              then 'da'
    when 'Autre'                  then 'autre'
    else null
  end;
$$;
