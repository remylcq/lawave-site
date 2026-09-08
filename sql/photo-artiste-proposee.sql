-- =====================================================================
-- La Wave — photo d'artiste proposée avec la sortie
--
-- Quand quelqu'un soumet une sortie pour un artiste qui n'existe pas
-- encore, il peut désormais joindre une photo de profil. Elle voyage
-- avec la sortie et n'est posée sur le profil qu'à la validation par
-- l'équipe : rien n'apparaît en ligne sans qu'on l'ait regardé.
--
-- Elle ne remplace jamais une photo déjà réglée par l'équipe, ni celle
-- d'un artiste déjà connu — cette règle-là vit dans le site.
--
-- À exécuter dans Supabase → SQL Editor.
-- =====================================================================

alter table public.submissions
  add column if not exists artist_photo_url text;


-- Vérification : la colonne doit apparaître, en text et nullable.
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name   = 'submissions'
  and column_name  = 'artist_photo_url';
