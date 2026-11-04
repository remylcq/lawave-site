-- (Passé en production le 2026-11-04 avec l'accord de Rémy.)
-- Wave Cards : six rôles pour pimenter les combats (2026-11-04). Chaque carte en a un (tiré une fois pour toutes selon l'artiste), il change sa façon de jouer :
--   Combattant  équilibré, frappe la carte d'en face.
--   Tank        PROVOQUE : les adversaires le frappent en premier tant qu'il est debout. Beaucoup de PV et de Défense.
--   Guérisseur  soigne l'allié le plus blessé au lieu d'attaquer ; tous les 3 coups, soigne toute l'équipe.
--   Assassin    vise la carte adverse la plus fragile (ignore la provocation). Très rapide, fragile.
--   Artilleur   frappe TOUTES les cartes adverses à la fois (moins fort sur chacune).
--   Soutien     pose un bouclier sur l'allié le plus blessé ; tous les 3 coups, sur toute l'équipe.
-- Les anciens rôles restent en base (leurs techniques y sont liées) mais ne sont plus tirés. Sans danger si on le repasse.

alter table public.combat_roles add column if not exists actif boolean not null default true;
update public.combat_roles set actif = false where id in ('lyriciste', 'pilier', 'beatmaker', 'hypeman', 'clasheur', 'briseur');
insert into public.combat_roles (id, nom, resume, ordre, m_pv, m_pui, m_def, m_vit, actif) values
  ('combattant', 'Combattant', 'Équilibré : il frappe la carte d''en face.',                                                        11, 1.00, 1.15, 0.95, 1.00, true),
  ('tank',       'Tank',       'Provoque : les adversaires le frappent en premier tant qu''il est debout. Beaucoup de PV et de Défense.', 12, 1.45, 0.70, 1.40, 0.80, true),
  ('guerisseur', 'Guérisseur', 'Soigne l''allié le plus blessé au lieu d''attaquer ; tous les 3 coups, il soigne toute l''équipe.',    13, 0.95, 0.90, 0.90, 1.05, true),
  ('assassin',   'Assassin',   'Vise la carte adverse la plus fragile, même derrière un tank. Très rapide, fragile.',               14, 0.80, 1.35, 0.75, 1.35, true),
  ('artilleur',  'Artilleur',  'Frappe toutes les cartes adverses à la fois, un peu moins fort sur chacune.',                       15, 0.90, 1.00, 0.85, 1.00, true),
  ('soutien',    'Soutien',    'Pose un bouclier sur l''allié le plus blessé ; tous les 3 coups, sur toute l''équipe.',             16, 1.10, 0.85, 1.05, 1.00, true)
on conflict (id) do update set nom = excluded.nom, resume = excluded.resume, ordre = excluded.ordre,
  m_pv = excluded.m_pv, m_pui = excluded.m_pui, m_def = excluded.m_def, m_vit = excluded.m_vit, actif = true;

-- Le rôle d'une carte : fixé par l'artiste (28 % Combattant, 20 % Tank, 15 % Guérisseur, 15 % Assassin, 12 % Artilleur, 10 % Soutien)
create or replace function public.combat_role_de(p_artist uuid, p_type text) returns text
language sql stable set search_path to 'public' as
$$ select coalesce(
     (select s.role from public.combat_surcharges s where s.artist_id = p_artist and s.role is not null),
     (select case when x.h < 28 then 'combattant' when x.h < 48 then 'tank' when x.h < 63 then 'guerisseur' when x.h < 78 then 'assassin' when x.h < 90 then 'artilleur' else 'soutien' end
        from (select abs(hashtext(p_artist::text || 'role2')) % 100 as h) x)) $$;

-- Le moteur avec les rôles
do $$ begin
  begin alter type public.combat_auto_u add attribute role text; exception when duplicate_column then null; end;
  begin alter type public.combat_auto_u add attribute bouc integer; exception when duplicate_column then null; end;
end $$;

create or replace function public.combat_auto_simuler(p_a jsonb, p_b jsonb) returns jsonb
language plpgsql volatile set search_path to 'public' as $$
declare
  u public.combat_auto_u[] := '{}'; x jsonb; i integer; j integer; k integer; r integer; na integer := jsonb_array_length(p_a); nb integer := jsonb_array_length(p_b);
  ev jsonb := '[]'::jsonb; ordre integer[]; t integer; n integer; m numeric; dmg integer; ti jsonb; sig boolean; fin boolean := false;
  vivants_a integer; vivants_b integer; v_gagnant text; hp_a numeric; hp_b numeric; soin integer; refl integer; absorbe integer;
  cibles integer[]; degats integer[]; lst jsonb; mult numeric; base numeric; v_min numeric;
begin
  if na = 0 or nb = 0 then raise exception 'Il faut des cartes des deux côtés.'; end if;
  for i in 0..na - 1 loop
    x := p_a -> i;
    u := u || row(0, i + 1, x ->> 'nom', (x ->> 'pv')::integer, (x ->> 'pv_max')::integer, (x ->> 'pui')::integer, (x ->> 'def')::integer, (x ->> 'vit')::integer,
                  x -> 'capacite' ->> 'code', coalesce((x -> 'capacite' ->> 'valeur')::integer, 0), 0, false, x -> 'titres', coalesce(x ->> 'role', 'combattant'), 0)::public.combat_auto_u;
  end loop;
  for i in 0..nb - 1 loop
    x := p_b -> i;
    u := u || row(1, i + 1, x ->> 'nom', (x ->> 'pv')::integer, (x ->> 'pv_max')::integer, (x ->> 'pui')::integer, (x ->> 'def')::integer, (x ->> 'vit')::integer,
                  x -> 'capacite' ->> 'code', coalesce((x -> 'capacite' ->> 'valeur')::integer, 0), 0, false, x -> 'titres', coalesce(x ->> 'role', 'combattant'), 0)::public.combat_auto_u;
  end loop;

  -- Les passifs de départ : l'aura (Puissance de l'équipe), le sang-froid (Défense), la concentration (Vitesse)
  for i in 1..array_length(u, 1) loop
    if u[i].cap = 'aura' then
      for j in 1..array_length(u, 1) loop
        if u[j].cote = u[i].cote then u[j].pui := round(u[j].pui * (1 + greatest(u[i].capv, 10) / 100.0)); end if;
      end loop;
      ev := ev || jsonb_build_object('t', 'passif', 'c', jsonb_build_array(u[i].cote, u[i].pos), 'n', 'Aura de star');
    elsif u[i].cap = 'sang_froid' then
      u[i].def := round(u[i].def * 1.15); ev := ev || jsonb_build_object('t', 'passif', 'c', jsonb_build_array(u[i].cote, u[i].pos), 'n', 'Sang-froid');
    elsif u[i].cap = 'concentration' then
      u[i].vit := round(u[i].vit * 1.15); ev := ev || jsonb_build_object('t', 'passif', 'c', jsonb_build_array(u[i].cote, u[i].pos), 'n', 'Flow chirurgical');
    end if;
  end loop;

  r := 0;
  while r < 30 and not fin loop
    r := r + 1;
    ev := ev || jsonb_build_object('t', 'tour', 'n', r);
    select array_agg(q.i order by q.vit desc, random()) into ordre from (select g as i, u[g].vit as vit from generate_series(1, array_length(u, 1)) g where u[g].pv > 0) q;
    foreach i in array ordre loop
      continue when u[i].pv <= 0;
      if not exists (select 1 from unnest(u) g where g.cote <> u[i].cote and g.pv > 0) then fin := true; exit; end if;

      u[i].nb := u[i].nb + 1; n := u[i].nb;
      ti := u[i].titres -> ((n - 1) % greatest(jsonb_array_length(u[i].titres), 1))::integer;
      m := coalesce((ti ->> 'mult')::numeric, 1);
      sig := n % 3 = 0;
      cibles := '{}'; degats := '{}'; lst := '[]'::jsonb;

      -- Le Guérisseur soigne (toute l'équipe tous les 3 coups, sinon l'allié le plus blessé) ; s'il n'y a personne à soigner, il attaque à 60 %
      if u[i].role = 'guerisseur' then
        if sig then
          for j in 1..array_length(u, 1) loop
            if u[j].cote = u[i].cote and u[j].pv > 0 and u[j].pv < u[j].pvmax then
              soin := least(u[j].pvmax - u[j].pv, greatest(1, round(u[i].pui * m * 0.55)));
              u[j].pv := u[j].pv + soin;
              lst := lst || jsonb_build_object('c', jsonb_build_array(u[j].cote, u[j].pos), 'd', soin, 'pv', u[j].pv);
            end if;
          end loop;
        else
          t := null; v_min := 2;
          for j in 1..array_length(u, 1) loop
            if u[j].cote = u[i].cote and u[j].pv > 0 and u[j].pv < u[j].pvmax and u[j].pv::numeric / u[j].pvmax < v_min then t := j; v_min := u[j].pv::numeric / u[j].pvmax; end if;
          end loop;
          if t is not null then
            soin := least(u[t].pvmax - u[t].pv, greatest(1, round(u[i].pui * m * 1.1)));
            u[t].pv := u[t].pv + soin;
            lst := lst || jsonb_build_object('c', jsonb_build_array(u[t].cote, u[t].pos), 'd', soin, 'pv', u[t].pv);
          end if;
        end if;
        if jsonb_array_length(lst) > 0 then
          ev := ev || jsonb_build_object('t', 'soin', 'a', jsonb_build_array(u[i].cote, u[i].pos), 'n', ti ->> 'nom', 's', sig, 'x', lst);
          continue;
        end if;
      end if;

      -- Le Soutien pose des boucliers (toute l'équipe tous les 3 coups, sinon l'allié le plus blessé)
      if u[i].role = 'soutien' then
        if sig then
          for j in 1..array_length(u, 1) loop
            if u[j].cote = u[i].cote and u[j].pv > 0 then
              soin := greatest(1, round(u[i].pui * m * 0.8)); u[j].bouc := u[j].bouc + soin;
              lst := lst || jsonb_build_object('c', jsonb_build_array(u[j].cote, u[j].pos), 'd', soin, 'b', u[j].bouc);
            end if;
          end loop;
        else
          t := null; v_min := 3;
          for j in 1..array_length(u, 1) loop
            if u[j].cote = u[i].cote and u[j].pv > 0 and (u[j].pv::numeric / u[j].pvmax + u[j].bouc::numeric / u[j].pvmax) < v_min then
              t := j; v_min := u[j].pv::numeric / u[j].pvmax + u[j].bouc::numeric / u[j].pvmax;
            end if;
          end loop;
          if t is not null then
            soin := greatest(1, round(u[i].pui * m * 1.6)); u[t].bouc := u[t].bouc + soin;
            lst := lst || jsonb_build_object('c', jsonb_build_array(u[t].cote, u[t].pos), 'd', soin, 'b', u[t].bouc);
          end if;
        end if;
        ev := ev || jsonb_build_object('t', 'bouclier', 'a', jsonb_build_array(u[i].cote, u[i].pos), 'n', ti ->> 'nom', 's', sig, 'x', lst);
        continue;
      end if;

      -- Les cibles : l'Artilleur frappe tout le monde, l'Assassin le plus fragile, les autres la provocation d'un Tank, sinon la carte d'en face
      base := u[i].pui * m * case when sig then 1.6 else 1 end * case when u[i].cap = 'ouverture' and n = 1 then 1 + greatest(u[i].capv, 30) / 100.0 else 1 end;
      if u[i].role = 'artilleur' then
        for j in 1..array_length(u, 1) loop
          if u[j].cote <> u[i].cote and u[j].pv > 0 then cibles := cibles || j; end if;
        end loop;
        mult := case when sig then 0.9 else 0.55 end;
      else
        t := null;
        if u[i].role = 'assassin' then
          v_min := null;
          for j in 1..array_length(u, 1) loop
            if u[j].cote <> u[i].cote and u[j].pv > 0 and (v_min is null or u[j].pv < v_min) then t := j; v_min := u[j].pv; end if;
          end loop;
        else
          for j in 1..array_length(u, 1) loop
            if u[j].cote <> u[i].cote and u[j].pv > 0 and u[j].role = 'tank' and (t is null or u[j].pos = u[i].pos) then t := j; end if;
          end loop;
          if t is null then
            for j in 1..array_length(u, 1) loop
              if u[j].cote <> u[i].cote and u[j].pos = u[i].pos and u[j].pv > 0 then t := j; exit; end if;
            end loop;
          end if;
          if t is null then
            for j in 1..array_length(u, 1) loop
              if u[j].cote <> u[i].cote and u[j].pv > 0 then t := j; exit; end if;
            end loop;
          end if;
        end if;
        cibles := array[t];
        mult := case when u[i].role = 'guerisseur' then 0.6 else 1 end;
      end if;

      -- les dégâts, le bouclier d'abord
      for k in 1..array_length(cibles, 1) loop
        t := cibles[k];
        dmg := greatest(1, round(base * mult * 100.0 / (100 + u[t].def)));
        absorbe := least(u[t].bouc, dmg); u[t].bouc := u[t].bouc - absorbe;
        u[t].pv := u[t].pv - (dmg - absorbe);
        if u[t].pv <= 0 and u[t].cap = 'survivant' and not u[t].surv then
          u[t].pv := 1; u[t].surv := true;
          ev := ev || jsonb_build_object('t', 'passif', 'c', jsonb_build_array(u[t].cote, u[t].pos), 'n', 'Jamais au tapis');
        end if;
        lst := lst || jsonb_build_object('c', jsonb_build_array(u[t].cote, u[t].pos), 'd', dmg, 'pv', greatest(u[t].pv, 0), 'b', u[t].bouc);
        degats := degats || dmg;
      end loop;
      if array_length(cibles, 1) = 1 then
        t := cibles[1];
        ev := ev || jsonb_build_object('t', 'att', 'a', jsonb_build_array(u[i].cote, u[i].pos), 'c', jsonb_build_array(u[t].cote, u[t].pos),
                                       'n', ti ->> 'nom', 'd', degats[1], 's', sig, 'pv', greatest(u[t].pv, 0), 'b', u[t].bouc);
      else
        ev := ev || jsonb_build_object('t', 'zone', 'a', jsonb_build_array(u[i].cote, u[i].pos), 'n', ti ->> 'nom', 's', sig, 'x', lst);
      end if;

      for k in 1..array_length(cibles, 1) loop
        t := cibles[k];
        if array_length(cibles, 1) = 1 and u[t].pv > 0 and u[t].cap = 'epines' then
          refl := greatest(1, round(degats[1] * greatest(u[t].capv, 12) / 100.0));
          u[i].pv := u[i].pv - refl;
          ev := ev || jsonb_build_object('t', 'epines', 'c', jsonb_build_array(u[i].cote, u[i].pos), 'd', refl, 'pv', greatest(u[i].pv, 0));
        end if;
        if u[t].pv <= 0 then
          ev := ev || jsonb_build_object('t', 'ko', 'c', jsonb_build_array(u[t].cote, u[t].pos));
          if u[t].cap = 'dernier_souffle' then
            for j in 1..array_length(u, 1) loop
              if u[j].cote <> u[t].cote and u[j].pv > 0 then
                refl := greatest(1, round(u[t].pvmax * greatest(u[t].capv, 15) / 100.0));
                u[j].pv := u[j].pv - refl;
                ev := ev || jsonb_build_object('t', 'epines', 'c', jsonb_build_array(u[j].cote, u[j].pos), 'd', refl, 'pv', greatest(u[j].pv, 0), 'n', 'Dernier couplet');
                if u[j].pv <= 0 then ev := ev || jsonb_build_object('t', 'ko', 'c', jsonb_build_array(u[j].cote, u[j].pos)); end if;
                exit;
              end if;
            end loop;
          end if;
        end if;
      end loop;
      if u[i].pv <= 0 then ev := ev || jsonb_build_object('t', 'ko', 'c', jsonb_build_array(u[i].cote, u[i].pos)); end if;

      select count(*) filter (where g.cote = 0 and g.pv > 0), count(*) filter (where g.cote = 1 and g.pv > 0) into vivants_a, vivants_b from unnest(u) g;
      if vivants_a = 0 or vivants_b = 0 then fin := true; exit; end if;
    end loop;

    if not fin then
      for i in 1..array_length(u, 1) loop
        if u[i].pv > 0 and u[i].cap = 'regeneration' then
          soin := least(u[i].pvmax - u[i].pv, greatest(1, round(u[i].pvmax * greatest(u[i].capv, 6) / 100.0)));
          if soin > 0 then
            u[i].pv := u[i].pv + soin;
            ev := ev || jsonb_build_object('t', 'soin', 'c', jsonb_build_array(u[i].cote, u[i].pos), 'd', soin, 'pv', u[i].pv);
          end if;
        end if;
      end loop;
    end if;
  end loop;

  select count(*) filter (where g.cote = 0 and g.pv > 0), count(*) filter (where g.cote = 1 and g.pv > 0),
         sum(greatest(g.pv, 0)) filter (where g.cote = 0)::numeric / nullif(sum(g.pvmax) filter (where g.cote = 0), 0),
         sum(greatest(g.pv, 0)) filter (where g.cote = 1)::numeric / nullif(sum(g.pvmax) filter (where g.cote = 1), 0)
    into vivants_a, vivants_b, hp_a, hp_b from unnest(u) g;
  v_gagnant := case when vivants_b = 0 and vivants_a > 0 then 'a' when vivants_a = 0 then 'b' when coalesce(hp_a, 0) > coalesce(hp_b, 0) then 'a' else 'b' end;
  return jsonb_build_object('gagnant', v_gagnant, 'tours', r, 'evenements', ev,
    'restants', jsonb_build_object('a', coalesce(hp_a, 0), 'b', coalesce(hp_b, 0)));
end $$;
revoke all on function public.combat_role_de(uuid, text), public.combat_auto_simuler(jsonb, jsonb) from public, anon, authenticated;
