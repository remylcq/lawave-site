-- =====================================================================
-- La Wave — les boosters en vinyles (Wave Cards)
--
-- Un booster peut avoir un visuel carré (un vinyle) qui remplace le paquet dans le carrousel et dans la scène d'ouverture.
-- Le chemin est celui d'une image du site (dossier img/) ; sans visuel, le booster garde son paquet dessiné.
--
-- Vague Glaciale : img/vinyle-glaciale.webp
-- À passer APRÈS sql/cartes-classeurs.sql. Sans danger si on le repasse.
-- Retrait : alter table public.jeu_boosters drop column visuel; puis remettre jeu_boosters() de sql/cartes-classeurs.sql.
-- =====================================================================

alter table public.jeu_boosters add column if not exists visuel text;

update public.jeu_boosters set visuel = 'img/vinyle-glaciale.webp' where id = 'glaciale';

do $$
declare d text;
begin
  d := pg_get_functiondef('public.jeu_boosters()'::regprocedure);
  if position('''visuel'', b.visuel' in d) = 0 then
    d := replace(d, '''classeur'', b.classeur,', '''classeur'', b.classeur, ''visuel'', b.visuel,');
    if position('''visuel'', b.visuel' in d) = 0 then raise exception 'patch introuvable'; end if;
    execute d;
  end if;
end $$;
