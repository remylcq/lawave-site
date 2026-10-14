-- =====================================================================
-- La Wave — le premier message de la communauté (facultatif)
--
-- À passer APRÈS communaute.sql, une seule fois. Il publie un mot de
-- bienvenue épinglé en haut du fil, signé par le plus ancien compte de
-- l'équipe (profil is_admin), pour que la page ne s'ouvre pas sur un fil
-- vide. Relancé, il ne fait rien : s'il y a déjà un message épinglé dans
-- « Équipe La Wave », il s'arrête.
--
-- Pour changer le texte : modifier le contenu ci-dessous avant de lancer,
-- ou, une fois publié, le corriger / le supprimer depuis la communauté
-- (menu ⋯ du message, connecté avec le compte de l'équipe).
-- =====================================================================

insert into public.com_posts (auteur_id, type, sujet, contenu, tags, epingle)
select
  p.id,
  'message',
  'annonces',
  E'Bienvenue dans la communauté La Wave ! 🌊\n\n'
  'Ici, on partage ses sons, on demande des retours, et on trouve avec qui '
  'collaborer : un artiste qui cherche un beatmaker, un beatmaker qui cherche '
  'des voix, un vidéaste pour un clip…\n\n'
  'Pour bien démarrer :\n'
  '• complète ton profil et dis ce que tu cherches ou ce que tu proposes ;\n'
  '• passe par « Collabs » pour publier une demande de collaboration ;\n'
  '• « Explorer » te montre les membres qui correspondent à ce que tu cherches.\n\n'
  'Quelques règles simples : bienveillance, pas de spam, et un message qui '
  'dérape se signale depuis son menu ⋯. À toi de jouer !',
  '{}',
  true
from public.profiles p
where p.is_admin
  and not exists (
    select 1 from public.com_posts x where x.epingle and x.sujet = 'annonces'
  )
order by p.created_at
limit 1;
