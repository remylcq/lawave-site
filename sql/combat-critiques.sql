-- Wave Cards : les coups critiques (2026-11-09).
-- Chaque attaque a une chance de critique qui grandit avec la Vitesse de la carte : 6 % + Vitesse / 25 %, au plus 25 % (une carte à 75 de Vitesse : 9 %).
-- Un critique fait 50 % de dégâts en plus. Le déroulé renvoie 'k' : true sur l'attaque (ou sur chaque cible d'une attaque de zone) pour l'animation.
-- La définition de combat_auto_simuler est relue en base puis modifiée : le moteur en production a évolué depuis les anciens fichiers du dépôt.
-- Sans danger si on le repasse (rien n'est refait si la modification est déjà là).
do $$
declare d text;
begin
  d := pg_get_functiondef('public.combat_auto_simuler(jsonb,jsonb)'::regprocedure);
  if position('crit boolean' in d) > 0 then return; end if;

  if position('refl integer; absorbe integer;' in d) = 0
     or position('dmg := greatest(1, round(base * mult * 100.0 / (100 + u[t].def)));' in d) = 0
     or position('''d'', dmg, ''pv'', greatest(u[t].pv, 0), ''b'', u[t].bouc);' in d) = 0
     or position('''d'', degats[1], ''s'', sig, ''pv'', greatest(u[t].pv, 0), ''b'', u[t].bouc);' in d) = 0 then
    raise exception 'combat_auto_simuler : motif introuvable';
  end if;

  d := replace(d, 'refl integer; absorbe integer;', 'refl integer; absorbe integer; crit boolean := false;');
  d := replace(d, 'dmg := greatest(1, round(base * mult * 100.0 / (100 + u[t].def)));',
    'crit := random() < least(0.25, 0.06 + u[i].vit / 2500.0);
        dmg := greatest(1, round(base * mult * case when crit then 1.5 else 1 end * 100.0 / (100 + u[t].def)));');
  d := replace(d, '''d'', dmg, ''pv'', greatest(u[t].pv, 0), ''b'', u[t].bouc);', '''d'', dmg, ''pv'', greatest(u[t].pv, 0), ''b'', u[t].bouc, ''k'', crit);');
  d := replace(d, '''d'', degats[1], ''s'', sig, ''pv'', greatest(u[t].pv, 0), ''b'', u[t].bouc);', '''d'', degats[1], ''s'', sig, ''pv'', greatest(u[t].pv, 0), ''b'', u[t].bouc, ''k'', crit);');
  execute d;
end $$;
