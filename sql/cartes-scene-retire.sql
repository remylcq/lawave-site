-- =====================================================================
-- La Wave — retrait du booster « Scène francophone » du carrousel
--
-- Le booster de base n'est plus proposé (actif = false). Le pack Épique garanti des récompenses (jeu_ouvrir(1, true))
-- en dépend toujours : il ne regarde plus ni l'état ni les dates du booster. Les cartes déjà obtenues restent dans la
-- « Série de lancement » de la Collection.
-- Pour le remettre : update public.jeu_boosters set actif = true where id = 'scene';
-- À passer APRÈS sql/cartes-classeurs.sql. Sans danger si on le repasse.
-- =====================================================================

update public.jeu_boosters set actif = false where id = 'scene';

do $$
declare d text;
begin
  d := pg_get_functiondef('public.jeu_ouvrir(integer,boolean,text)'::regprocedure);
  d := regexp_replace(d, 'end and actif\s+and \(debut is null or debut <= v_jour\) and \(fin is null or fin >= v_jour\);', 'end and (p_garanti or (actif and (debut is null or debut <= v_jour) and (fin is null or fin >= v_jour)));');
  if position('p_garanti or (actif' in d) = 0 then raise exception 'patch introuvable'; end if;
  execute d;
end $$;
