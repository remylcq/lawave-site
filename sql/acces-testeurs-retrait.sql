-- =====================================================================
-- La Wave — RETIRER l'accès temporaire au site
--
-- À faire le jour où le site s'ouvre à tout le monde, DANS CET ORDRE (le SQL en
-- dernier : sans ses fonctions, un portail encore en ligne resterait fermé).
--
--   1. index.html — supprimer :
--        • le bloc du <head> « ACCÈS TESTEURS (TEMPORAIRE) — début … fin »
--          (il contient aussi la balise noindex : sans elle, le site pourra de
--          nouveau être référencé par les moteurs de recherche) ;
--        • le bouton d'onglet #adminTab-acces ;
--        • la section « ACCÈS TESTEURS (TEMPORAIRE) — section … fin (section) »
--          (#adminSection-acces, avec sa feuille de style) ;
--        • le bloc JavaScript « ACCÈS TESTEURS (TEMPORAIRE) — ESPACE ÉQUIPE » ;
--        • 'acces' dans ADMIN_TABS et le test « nom === 'acces' » de
--          switchAdminTab.
--      Rechercher « ACCÈS TESTEURS » et « acces » pour ne rien oublier.
--   2. Transférer le nouvel index.html par FTP, puis SUPPRIMER portail.js du
--      serveur.
--   3. Passer ce fichier dans l'éditeur SQL de Supabase.
--   4. Facultatif : si un .htaccess protégeait le site, le retirer aussi.
--
-- (Les navigateurs des testeurs gardent une clé « lw-portail-jeton » dans leur
-- stockage local : inoffensive, plus rien ne la lit.)
--
-- Supprime les tables et les fonctions d'accès. Les accès créés disparaissent
-- avec elles. Sans danger si on le relance.
-- =====================================================================

begin;

drop function if exists public.acces_connecter(text, text);
drop function if exists public.acces_verifier(text);
drop function if exists public.acces_creer(text, text);
drop function if exists public.acces_nouveau_mot_de_passe(text);
drop function if exists public.acces_revoquer(text);
drop function if exists public.acces_supprimer(text);
drop function if exists public.acces_liste();
drop function if exists public.acces_amorcer(text);
drop function if exists public.acces_exiger_equipe();
drop function if exists public.acces_valider_email(text);
drop function if exists public.acces_normaliser(text);
drop function if exists public.acces_empreinte(text, text);
drop function if exists public.acces_mot_de_passe();
drop function if exists public.acces_aleatoire(integer);

drop table if exists public.acces_sessions;
drop table if exists public.acces_tentatives;
drop table if exists public.acces_testeurs;

-- est_equipe() n'est PAS retirée : la communauté et d'autres parties du site s'en servent.

notify pgrst, 'reload schema';

commit;
