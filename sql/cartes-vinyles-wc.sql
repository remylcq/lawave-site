-- Wave Cards : les packs se paient en vinyles, les vinyles s'achètent en Wave Coins (demande de Rémy, 2026-10-27).
-- Plus d'énergie (tirages qui se rechargent) :
--  1. prix des boosters en vinyles (1 ancien tirage = 50 vinyles) ;
--  2. le stock de tirages des joueurs est converti en vinyles au même taux, puis la recharge est coupée ;
--  3. toute récompense « en tirages » (cadeau, roue, missions, coffre, succès, niveaux) est créditée en vinyles (×50) ;
--  4. jeu_ouvrir débite des vinyles ; jeu_etat_json renvoie aussi le solde de Wave Coins (clé « wc ») ;
--  5. jeu_vinyles_acheter(p_wc) : 1 Wave Coin = 1 vinyle.
-- Les colonnes et les définitions de récompenses ne changent pas : le site affiche tout en vinyles.

-- 1. Prix des packs (la contrainte limitait le coût à 10 : elle passe à 10 000)
alter table public.jeu_boosters drop constraint if exists jeu_boosters_cout_check;
alter table public.jeu_boosters add constraint jeu_boosters_cout_check check (cout >= 1 and cout <= 10000);
update public.jeu_boosters set cout = 100 where id in ('deferlante', 'legendes');
update public.jeu_boosters set cout = 50 where id in ('glaciale', 'nouvelle-vague', 'scene');

-- 2. Le stock de tirages devient des vinyles, la recharge s'arrête
update public.jeu_joueurs set vinyles = vinyles + tirages * 50, tirages = 0 where tirages > 0;

create or replace function public.jeu_regen(p_user uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  return;
end $$;

-- 3. Les récompenses en tirages sont créditées en vinyles
create or replace function public.jeu_crediter(p_user uuid, p_tirages integer, p_vinyles integer, p_garantis integer default 0)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
begin
  update public.jeu_joueurs
     set vinyles = vinyles + coalesce(p_vinyles, 0) + coalesce(p_tirages, 0) * 50, garantis = garantis + coalesce(p_garantis, 0)
   where user_id = p_user;
  return jsonb_build_object('tirages', coalesce(p_tirages, 0), 'vinyles', coalesce(p_vinyles, 0), 'garantis', coalesce(p_garantis, 0));
end $$;

-- 4. L'ouverture débite des vinyles ; l'état renvoie les Wave Coins
do $$
declare d text;
begin
  d := pg_get_functiondef('public.jeu_ouvrir(integer,boolean,text)'::regprocedure);
  d := replace(d, 'elsif j.tirages < p_n * v_cout then
    raise exception ''Pas assez de tirages.'';', 'elsif j.vinyles < p_n * v_cout then
    raise exception ''Il te manque % vinyles.'', p_n * v_cout - j.vinyles;');
  d := regexp_replace(d, 'set tirages = tirages - p_n \* v_cout \+ v_bonus_t,', 'set vinyles = vinyles - p_n * v_cout + v_bonus_t * 50 + v_bonus_v,');
  d := regexp_replace(d, '\s+vinyles = vinyles \+ v_bonus_v,', '');
  if position('j.vinyles < p_n * v_cout' in d) = 0 or position('v_bonus_t * 50 + v_bonus_v' in d) = 0 or d ~ 'vinyles = vinyles \+ v_bonus_v' then
    raise exception 'jeu_ouvrir : motif introuvable';
  end if;
  execute d;

  d := pg_get_functiondef('public.jeu_etat_json(uuid)'::regprocedure);
  d := replace(d, '''evenement'', v_ev,', '''evenement'', v_ev, ''wc'', coalesce((select w.solde from public.wc_portefeuille w where w.user_id = p_user), 0),');
  if position('''wc'', coalesce' in d) = 0 then raise exception 'jeu_etat_json : motif introuvable'; end if;
  execute d;
end $$;

-- 5. Échanger des Wave Coins contre des vinyles (1 pour 1)
create or replace function public.jeu_vinyles_acheter(p_wc integer)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); v_solde integer;
begin
  if v_uid is null then raise exception 'Connecte-toi.'; end if;
  if p_wc is null or p_wc < 10 or p_wc > 100000 then raise exception 'Échange entre 10 et 100 000 Wave Coins.'; end if;
  perform public.jeu_joueur_assurer(v_uid);
  insert into public.wc_portefeuille (user_id, solde) values (v_uid, 0) on conflict (user_id) do nothing;
  select solde into v_solde from public.wc_portefeuille where user_id = v_uid for update;
  if v_solde < p_wc then raise exception 'Il te manque % Wave Coins.', p_wc - v_solde; end if;
  update public.wc_portefeuille set solde = solde - p_wc where user_id = v_uid;
  insert into public.wc_journal (user_id, delta, motif, ref) values (v_uid, -p_wc, 'jeu:vinyles', gen_random_uuid()::text);
  update public.jeu_joueurs set vinyles = vinyles + p_wc where user_id = v_uid;
  return public.jeu_etat_json(v_uid);
end $$;
revoke all on function public.jeu_vinyles_acheter(integer) from public, anon;
grant execute on function public.jeu_vinyles_acheter(integer) to authenticated;
