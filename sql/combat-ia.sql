-- Combats : des cartes qui choisissent mieux (2026-11-12). Vaut pour les deux camps : le même moteur joue ton équipe et l'adversaire.
--   1. Le choix de la cible. Avant : la carte d'en face (ou la première debout). Maintenant, chaque carte évalue toutes les cibles permises :
--        - si elle peut en achever une ce tour-ci, elle achève la plus dangereuse (un « Jamais au tapis » encore actif ne compte pas comme achevable) ;
--        - sinon elle frappe là où son coup pèse le plus : la part de vie qu'elle enlève × la menace de la cible
--          (sa Puissance, majorée pour un Guérisseur, un Soutien, un Artilleur, un Assassin) ; à égalité, la carte d'en face.
--      Le Tank provoque toujours (on doit le frapper tant qu'il est debout) et l'Assassin passe toujours derrière lui.
--   2. Le Guérisseur ne gâche plus son tour : il soigne seulement si un allié a perdu au moins 12 % de ses PV, sinon il attaque.
--   3. Le Soutien protège en priorité son Tank quand celui-ci n'a plus de bouclier (c'est lui qui prend les coups).
--   4. L'Artilleur, quand il ne reste qu'un adversaire, concentre son tir sur lui (dégâts pleins au lieu d'une salve affaiblie).
-- Sans danger si on le repasse.

do $$
declare d text; p1 integer; p2 integer; v_fin text := 'mult := case when u[i].role = ''guerisseur'' then 0.6 else 1 end;';
begin
  d := pg_get_functiondef('public.combat_auto_simuler(jsonb,jsonb)'::regprocedure);
  if position('v_sc numeric' in d) > 0 then return; end if;   -- déjà passé

  -- les variables du choix
  if position('cibles integer[]; degats integer[];' in d) = 0 then raise exception 'combat_auto_simuler : déclarations introuvables'; end if;
  d := replace(d, 'cibles integer[]; degats integer[];', 'cibles integer[]; degats integer[]; v_sc numeric; v_best numeric; v_de numeric; v_tank boolean;');

  -- 1. le choix de la cible
  p1 := position('if u[i].role = ''assassin'' then' in d);
  p2 := position(v_fin in d);
  if p1 = 0 or p2 = 0 or p2 < p1 then raise exception 'combat_auto_simuler : choix de la cible introuvable'; end if;
  d := left(d, p1 - 1) || $ia$mult := case when u[i].role = 'guerisseur' then 0.6 else 1 end;
        v_tank := u[i].role <> 'assassin' and exists (select 1 from unnest(u) g where g.cote <> u[i].cote and g.pv > 0 and g.role = 'tank');
        v_best := null;
        for j in 1..array_length(u, 1) loop
          continue when u[j].cote = u[i].cote or u[j].pv <= 0 or (v_tank and u[j].role <> 'tank');
          v_de := greatest(1, round(base * mult * 100.0 / (100 + u[j].def)));
          v_sc := greatest(u[j].pui, 1) * case u[j].role when 'guerisseur' then 1.5 when 'soutien' then 1.35 when 'artilleur' then 1.3 when 'assassin' then 1.2 else 1 end;
          if v_de >= u[j].pv + u[j].bouc and not (u[j].cap = 'survivant' and not u[j].surv) then
            v_sc := 100000 + v_sc;
          else
            v_sc := v_sc * least(1, v_de / (u[j].pv + u[j].bouc)::numeric);
          end if;
          if u[j].pos = u[i].pos then v_sc := v_sc * 1.02; end if;
          if v_best is null or v_sc > v_best then t := j; v_best := v_sc; end if;
        end loop;
        cibles := array[t];$ia$ || substr(d, p2 + length(v_fin));

  -- 2. le Guérisseur ne soigne que si cela vaut le coup
  if position('and u[j].pv < u[j].pvmax and u[j].pv::numeric / u[j].pvmax < v_min' in d) = 0
     or position('if u[j].cote = u[i].cote and u[j].pv > 0 and u[j].pv < u[j].pvmax then' in d) = 0 then
    raise exception 'combat_auto_simuler : soins introuvables';
  end if;
  d := replace(d, 'and u[j].pv < u[j].pvmax and u[j].pv::numeric / u[j].pvmax < v_min', 'and u[j].pv <= u[j].pvmax * 0.88 and u[j].pv::numeric / u[j].pvmax < v_min');
  d := replace(d, 'if u[j].cote = u[i].cote and u[j].pv > 0 and u[j].pv < u[j].pvmax then',
    'if u[j].cote = u[i].cote and u[j].pv > 0 and u[j].pv < u[j].pvmax and exists (select 1 from unnest(u) g where g.cote = u[i].cote and g.pv > 0 and g.pv <= g.pvmax * 0.88) then');

  -- 3. le Soutien protège d'abord son Tank découvert
  if position('if u[j].cote = u[i].cote and u[j].pv > 0 and (u[j].pv::numeric / u[j].pvmax + u[j].bouc::numeric / u[j].pvmax) < v_min then' in d) = 0
     or position('t := j; v_min := u[j].pv::numeric / u[j].pvmax + u[j].bouc::numeric / u[j].pvmax;' in d) = 0 then
    raise exception 'combat_auto_simuler : boucliers introuvables';
  end if;
  d := replace(d, 'if u[j].cote = u[i].cote and u[j].pv > 0 and (u[j].pv::numeric / u[j].pvmax + u[j].bouc::numeric / u[j].pvmax) < v_min then',
    'if u[j].cote = u[i].cote and u[j].pv > 0 and (u[j].pv::numeric / u[j].pvmax + u[j].bouc::numeric / u[j].pvmax) * (case when u[j].role = ''tank'' and u[j].bouc = 0 then 0.5 else 1 end) < v_min then');
  d := replace(d, 't := j; v_min := u[j].pv::numeric / u[j].pvmax + u[j].bouc::numeric / u[j].pvmax;',
    't := j; v_min := (u[j].pv::numeric / u[j].pvmax + u[j].bouc::numeric / u[j].pvmax) * case when u[j].role = ''tank'' and u[j].bouc = 0 then 0.5 else 1 end;');

  -- 4. l'Artilleur concentre son tir sur le dernier adversaire
  if position('mult := case when sig then 0.9 else 0.55 end;' in d) = 0 then raise exception 'combat_auto_simuler : salve introuvable'; end if;
  d := replace(d, 'mult := case when sig then 0.9 else 0.55 end;', 'mult := case when array_length(cibles, 1) = 1 then 1 when sig then 0.9 else 0.55 end;');

  execute d;
end $$;

update public.combat_roles set resume = 'Équilibré : il choisit la cible où son coup pèse le plus, et achève dès qu''il le peut.' where id = 'combattant';
update public.combat_roles set resume = 'Passe derrière le tank : achève la carte la plus dangereuse à sa portée. Très rapide, fragile.' where id = 'assassin';
update public.combat_roles set resume = 'Soigne l''allié le plus blessé (sinon il attaque) ; tous les 3 coups, il soigne toute l''équipe.' where id = 'guerisseur';
update public.combat_roles set resume = 'Pose un bouclier sur l''allié le plus exposé, son tank en premier ; tous les 3 coups, sur toute l''équipe.' where id = 'soutien';
update public.combat_roles set resume = 'Frappe toutes les cartes adverses à la fois, un peu moins fort sur chacune ; plein pot sur la dernière debout.' where id = 'artilleur';
