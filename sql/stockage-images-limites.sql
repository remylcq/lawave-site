-- =====================================================================
-- La Wave — le stockage d'images (bucket « Covers ») a des limites
--
-- Le problème : n'importe qui, même sans compte, pouvait envoyer dans ce
-- bucket des fichiers de n'importe quelle taille et de n'importe quel
-- type. Les envois anonymes sont voulus (une capture d'écran jointe à un
-- signalement n'exige pas de compte), mais sans limite ils ouvraient la
-- porte aux fichiers très lourds, ou qui n'ont rien d'une image.
--
-- La correction : huit Mo au plus, et des images JPG, PNG ou WEBP —
-- tout ce que le site envoie déjà. Le site allège de lui-même une image
-- plus lourde avant de l'envoyer (Fichiers.alleger, dans index.html) :
-- une personne qui joint une photo de 20 Mo n'a rien à faire.
--
-- Les images déjà envoyées ne bougent pas. Sans danger si on le repasse.
-- À exécuter dans Supabase → SQL Editor.
-- =====================================================================

update storage.buckets
   set file_size_limit    = 8 * 1024 * 1024,
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
 where id = 'Covers';

-- Vérification : une ligne, 8388608 octets et les trois types.
select id, file_size_limit, allowed_mime_types
from storage.buckets
where id = 'Covers';
