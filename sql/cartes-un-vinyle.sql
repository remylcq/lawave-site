-- Wave Cards : 1 vinyle = 1 ouverture de pack (demande de Rémy, 2026-10-27).
-- Tout est ramené à cette unité (l'ancienne échelle valait 50 vinyles par pack) :
--  1. les soldes sont divisés par 50 (arrondi au-dessus) ;
--  2. chaque booster coûte 1 vinyle ;
--  3. les récompenses « en tirages » valent 1 vinyle chacune, les anciens « vinyles » de récompense valent 1/50 ;
--  4. les niveaux gagnés suivent la même règle ;
--  5. les Wave Coins s'échangent contre des vinyles au taux jeu_taux_wc() (50 Wave Coins = 1 vinyle), renvoyé
--     aussi par jeu_etat_json (clé « taux_wc »).

-- 1 et 2. Soldes et prix
update public.jeu_joueurs set vinyles = ceil(vinyles / 50.0)::integer;
update public.jeu_boosters set cout = 1;

-- 3. Récompenses
create or replace function public.jeu_crediter(p_user uuid, p_tirages integer, p_vinyles integer, p_garantis integer default 0)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
begin
  update public.jeu_joueurs
     set vinyles = vinyles + coalesce(p_tirages, 0) + ceil(coalesce(p_vinyles, 0) / 50.0)::integer, garantis = garantis + coalesce(p_garantis, 0)
   where user_id = p_user;
  return jsonb_build_object('tirages', coalesce(p_tirages, 0), 'vinyles', coalesce(p_vinyles, 0), 'garantis', coalesce(p_garantis, 0));
end $$;

-- 4. Niveaux, et le taux d'échange dans l'état du joueur
create or replace function public.jeu_taux_wc() returns integer language sql immutable as $$ select 50 $$;

do $$
declare d text;
begin
  d := pg_get_functiondef('public.jeu_ouvrir(integer,boolean,text)'::regprocedure);
  d := replace(d, 'v_bonus_t * 50 + v_bonus_v', 'v_bonus_t + ceil(v_bonus_v / 50.0)::integer');
  if position('v_bonus_t + ceil(v_bonus_v / 50.0)' in d) = 0 then raise exception 'jeu_ouvrir : motif introuvable'; end if;
  execute d;

  d := pg_get_functiondef('public.jeu_etat_json(uuid)'::regprocedure);
  d := replace(d, '''wc'', coalesce(', '''taux_wc'', public.jeu_taux_wc(), ''wc'', coalesce(');
  if position('''taux_wc''' in d) = 0 then raise exception 'jeu_etat_json : motif introuvable'; end if;
  execute d;
end $$;

-- 5. Échange : on choisit un nombre de vinyles, le prix est en Wave Coins
drop function if exists public.jeu_vinyles_acheter(integer);
create function public.jeu_vinyles_acheter(p_vinyles integer)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); v_solde integer; v_prix integer;
begin
  if v_uid is null then raise exception 'Connecte-toi.'; end if;
  if p_vinyles is null or p_vinyles < 1 or p_vinyles > 1000 then raise exception 'Choisis entre 1 et 1 000 vinyles.'; end if;
  v_prix := p_vinyles * public.jeu_taux_wc();
  perform public.jeu_joueur_assurer(v_uid);
  insert into public.wc_portefeuille (user_id, solde) values (v_uid, 0) on conflict (user_id) do nothing;
  select solde into v_solde from public.wc_portefeuille where user_id = v_uid for update;
  if v_solde < v_prix then raise exception 'Il te manque % Wave Coins.', v_prix - v_solde; end if;
  update public.wc_portefeuille set solde = solde - v_prix where user_id = v_uid;
  insert into public.wc_journal (user_id, delta, motif, ref) values (v_uid, -v_prix, 'jeu:vinyles', gen_random_uuid()::text);
  update public.jeu_joueurs set vinyles = vinyles + p_vinyles where user_id = v_uid;
  return public.jeu_etat_json(v_uid);
end $$;
revoke all on function public.jeu_vinyles_acheter(integer) from public, anon;
grant execute on function public.jeu_vinyles_acheter(integer) to authenticated;
