-- Wave Cards, étape 3 : chaque carte obtenue est un EXEMPLAIRE unique, avec ses IV (4 statistiques de 0 à 31) ; la carte d'une collection
-- peut être liée à une carte d'album (type + attaques = titres du projet) ; le combat tient compte des deux.
-- Identité d'une carte inchangée : (collection, artiste, holo). jeu_collection_b.quantite reste le nombre d'exemplaires (tenu par un déclencheur),
-- donc tout ce qui compte les cartes (classeurs, quêtes, succès…) continue de marcher. Sans danger si on le repasse.

-- 1. Les colonnes et les réglages
alter table public.jeu_booster_cartes add column if not exists album_id uuid references public.jeu_albums(id) on update cascade on delete set null;
alter table public.jeu_boosters add column if not exists iv_parfait numeric(5, 2) check (iv_parfait is null or iv_parfait between 0 and 100);
alter table public.marche_annonces add column if not exists iv_pv smallint, add column if not exists iv_pui smallint,
  add column if not exists iv_def smallint, add column if not exists iv_vit smallint;

create table if not exists public.jeu_exemplaires (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  booster_id text not null references public.jeu_boosters(id) on update cascade on delete cascade,
  artist_id uuid not null,
  holo boolean not null default false,
  iv_pv smallint not null check (iv_pv between 0 and 31),
  iv_pui smallint not null check (iv_pui between 0 and 31),
  iv_def smallint not null check (iv_def between 0 and 31),
  iv_vit smallint not null check (iv_vit between 0 and 31),
  origine text not null default 'tirage',
  obtenu_le timestamptz not null default now()
);
create index if not exists jeu_exemplaires_carte_idx on public.jeu_exemplaires (user_id, booster_id, artist_id, holo);
alter table public.jeu_exemplaires enable row level security;

-- Le nombre d'exemplaires suit les exemplaires (la ligne reste à 0 quand on n'en a plus : elle garde la date de première obtention).
create or replace function public.jeu_exemplaires_sync() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.jeu_collection_b (user_id, booster_id, artist_id, holo, quantite)
    values (new.user_id, new.booster_id, new.artist_id, new.holo, 1)
    on conflict (user_id, booster_id, artist_id, holo) do update set quantite = public.jeu_collection_b.quantite + 1;
    return new;
  end if;
  update public.jeu_collection_b set quantite = greatest(quantite - 1, 0)
   where user_id = old.user_id and booster_id = old.booster_id and artist_id = old.artist_id and holo = old.holo;
  return old;
end $$;
drop trigger if exists jeu_exemplaires_sync on public.jeu_exemplaires;
create trigger jeu_exemplaires_sync after insert or delete on public.jeu_exemplaires for each row execute function public.jeu_exemplaires_sync();

-- 2. Les IV : réglages (effet sur les stats, minimum selon la rareté, chance d'une carte parfaite) et tirage
create or replace function public.jeu_iv_reglage() returns jsonb
language sql stable set search_path to 'public' as $$
  select jsonb_build_object(
      'effet_pct', coalesce((x.v ->> 'effet_pct')::numeric, 15),
      'min', coalesce(x.v -> 'min', '[0,2,4,7,10,14]'::jsonb),
      'parfait_defaut', coalesce((x.v ->> 'parfait_defaut')::numeric, 1))
    from (select (select r.valeur from public.jeu_reglages r where r.cle = 'iv') as v) x $$;

create or replace function public.jeu_iv_pct(a integer, b integer, c integer, d integer) returns numeric
language sql immutable set search_path to 'public' as $$ select round((coalesce(a, 0) + coalesce(b, 0) + coalesce(c, 0) + coalesce(d, 0)) / 124.0 * 100, 1) $$;

create or replace function public.jeu_iv_tirer(p_rarete integer, p_parfait numeric default null) returns smallint[]
language plpgsql volatile set search_path to 'public' as $$
declare r jsonb := public.jeu_iv_reglage(); v_min integer; v_p numeric; i integer; o smallint[] := '{}';
begin
  v_p := coalesce(p_parfait, (r ->> 'parfait_defaut')::numeric);
  if random() * 100 < v_p then return array[31, 31, 31, 31]::smallint[]; end if;
  v_min := least(greatest(coalesce((r -> 'min' ->> (greatest(coalesce(p_rarete, 1), 1) - 1))::integer, 0), 0), 30);
  for i in 1..4 loop o := o || (v_min + floor(random() * (32 - v_min)))::smallint; end loop;
  return o;
end $$;

-- 3. La carte d'album d'une carte de collection, prête à afficher
create or replace function public.jeu_album_carte_json(p_booster text, p_artist uuid) returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select coalesce((
    select jsonb_build_object('album_id', a.id, 'album', s.track_title, 'cover', s.cover_url, 'type', a.type, 'type_nom', t.nom, 'couleur', t.couleur, 'icone', t.icone,
             'attaques', coalesce((select jsonb_agg(z.nom order by q.o)
                                     from jsonb_array_elements(a.attaques) with ordinality as q(id, o)
                                     join lateral (select x ->> 'titre' as nom from jsonb_array_elements(a.titres) x where (x ->> 'id') = (q.id #>> '{}') limit 1) z on true), '[]'::jsonb))
      from public.jeu_booster_cartes x
      join public.jeu_albums a on a.id = x.album_id
      join public.submissions s on s.id = a.release_id
      left join public.combat_types t on t.id = a.type
     where x.booster_id = p_booster and x.artist_id = p_artist), '{}'::jsonb) $$;

create or replace function public.jeu_carte_json_b(c public.jeu_cartes, p_booster text, p_rarete integer, p_numero integer, p_holo boolean, p_quantite integer) returns jsonb
language sql stable set search_path to 'public', 'extensions', 'pg_temp' as $$
  select public.jeu_carte_json(c, p_holo, p_quantite) || jsonb_build_object('rarete', p_rarete, 'numero', p_numero, 'classeur', p_booster)
    || coalesce((select jsonb_build_object('photo', x.photo_perso) from public.jeu_booster_cartes x where x.booster_id = p_booster and x.artist_id = c.artist_id and x.photo_perso is not null), '{}'::jsonb)
    || public.jeu_album_carte_json(p_booster, c.artist_id) $$;

-- 4. L'outil de correction d'une fonction existante (le texte est remplacé, il doit exister)
create or replace function pg_temp.corriger(p_fn regprocedure, p_avant text, p_apres text) returns void
  language plpgsql as $$
declare v_def text := replace(pg_get_functiondef(p_fn), E'\r\n', E'\n');
begin
  if position(p_avant in v_def) = 0 then raise exception 'Morceau introuvable dans % : %', p_fn, left(p_avant, 70); end if;
  execute replace(v_def, p_avant, p_apres);
end $$;

-- 5. L'ouverture d'un pack : chaque carte d'un classeur devient un exemplaire avec ses IV
select pg_temp.corriger('public.jeu_ouvrir(integer, boolean, text)'::regprocedure,
  $a$v_rb smallint; v_nb integer; v_id uuid;$a$,
  $b$v_rb smallint; v_nb integer; v_id uuid; v_iv smallint[]; v_ex bigint;$b$);
select pg_temp.corriger('public.jeu_ouvrir(integer, boolean, text)'::regprocedure,
  $a$      insert into public.jeu_collection_b (user_id, booster_id, artist_id, holo, quantite) values (v_uid, b.id, c.artist_id, v_holo, 1)
      on conflict (user_id, booster_id, artist_id, holo) do update set quantite = public.jeu_collection_b.quantite + 1
      returning quantite into v_qte;$a$,
  $b$      v_iv := public.jeu_iv_tirer(c.rarete, b.iv_parfait);
      insert into public.jeu_exemplaires (user_id, booster_id, artist_id, holo, iv_pv, iv_pui, iv_def, iv_vit)
      values (v_uid, b.id, c.artist_id, v_holo, v_iv[1], v_iv[2], v_iv[3], v_iv[4]) returning id into v_ex;
      select quantite into v_qte from public.jeu_collection_b where user_id = v_uid and booster_id = b.id and artist_id = c.artist_id and holo = v_holo;$b$);
select pg_temp.corriger('public.jeu_ouvrir(integer, boolean, text)'::regprocedure,
  $a$v_cartes := v_cartes || (public.jeu_carte_json(c, v_holo, v_qte)$a$,
  $b$v_cartes := v_cartes || (case when b.classeur
        then public.jeu_carte_json_b(c, b.id, c.rarete::integer, c.numero, v_holo, v_qte)
             || jsonb_build_object('exemplaire', v_ex, 'iv', to_jsonb(v_iv), 'iv_pct', public.jeu_iv_pct(v_iv[1], v_iv[2], v_iv[3], v_iv[4]),
                                   'parfaite', v_iv = array[31, 31, 31, 31]::smallint[])
        else public.jeu_carte_json(c, v_holo, v_qte) end$b$);

-- 6. Le classeur : le meilleur IV de chaque carte, et la liste des exemplaires sur la fiche d'une carte
select pg_temp.corriger('public.jeu_classeur_lire(text, integer, text, integer, text, text)'::regprocedure,
  $a$jsonb_build_object('normales', x.normales, 'holos', x.holos) order by x.ord$a$,
  $b$jsonb_build_object('normales', x.normales, 'holos', x.holos,
        'iv_max', (select max(public.jeu_iv_pct(e.iv_pv, e.iv_pui, e.iv_def, e.iv_vit)) from public.jeu_exemplaires e
                    where e.user_id = v_uid and e.booster_id = p_booster and e.artist_id = (x.c).artist_id)) order by x.ord$b$);
select pg_temp.corriger('public.jeu_classeur_carte(text, uuid)'::regprocedure,
  $a$'holo', v_h > 0);$a$,
  $b$'holo', v_h > 0)
    || public.jeu_album_carte_json(p_booster, p_id)
    || jsonb_build_object('exemplaires', (select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'iv', jsonb_build_array(e.iv_pv, e.iv_pui, e.iv_def, e.iv_vit),
            'pct', public.jeu_iv_pct(e.iv_pv, e.iv_pui, e.iv_def, e.iv_vit), 'holo', e.holo, 'parfaite', (e.iv_pv + e.iv_pui + e.iv_def + e.iv_vit) = 124, 'le', e.obtenu_le)
            order by (e.iv_pv + e.iv_pui + e.iv_def + e.iv_vit) desc, e.id), '[]'::jsonb)
          from public.jeu_exemplaires e where e.user_id = v_uid and e.booster_id = p_booster and e.artist_id = p_id));$b$);

-- 7. Les cartes offertes ou retirées par l'équipe
create or replace function public.jeu_equipe_carte_donner(p_user uuid, p_booster text, p_artist uuid, p_holo boolean, p_quantite integer) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_q integer; v_rar integer; v_h boolean := coalesce(p_holo, false); v_iv smallint[]; i integer;
begin
  if not public.est_equipe() then raise exception 'Réservé à l''équipe.'; end if;
  if p_quantite is null or p_quantite = 0 or abs(p_quantite) > 20 then raise exception 'Donne ou retire de 1 à 20 exemplaires.'; end if;
  if not exists (select 1 from public.profiles where id = p_user) then raise exception 'Joueur introuvable.'; end if;
  select bc.rarete into v_rar from public.jeu_booster_cartes bc where bc.booster_id = p_booster and bc.artist_id = p_artist;
  if v_rar is null then raise exception 'Cette carte n''est pas dans la collection.'; end if;
  perform public.jeu_joueur_assurer(p_user);
  if p_quantite > 0 then
    for i in 1..p_quantite loop
      v_iv := public.jeu_iv_tirer(v_rar, (select bo.iv_parfait from public.jeu_boosters bo where bo.id = p_booster));
      insert into public.jeu_exemplaires (user_id, booster_id, artist_id, holo, iv_pv, iv_pui, iv_def, iv_vit, origine)
      values (p_user, p_booster, p_artist, v_h, v_iv[1], v_iv[2], v_iv[3], v_iv[4], 'equipe');
    end loop;
  else
    select count(*) into v_q from public.jeu_exemplaires where user_id = p_user and booster_id = p_booster and artist_id = p_artist and holo = v_h;
    if v_q + p_quantite < 0 then raise exception 'Ce joueur n''en a que %.', v_q; end if;
    delete from public.jeu_exemplaires where id in (
      select e.id from public.jeu_exemplaires e where e.user_id = p_user and e.booster_id = p_booster and e.artist_id = p_artist and e.holo = v_h
       order by (e.iv_pv + e.iv_pui + e.iv_def + e.iv_vit), e.id limit -p_quantite);
  end if;
  perform public.jeu_equipe_noter(case when p_quantite > 0 then 'carte_offerte' else 'carte_retiree' end,
    jsonb_build_object('cible', p_user, 'booster', p_booster, 'artist', p_artist, 'holo', v_h, 'quantite', p_quantite));
  return public.jeu_equipe_joueur(p_user);
end $$;

-- 8. Le marché : l'exemplaire vendu garde ses IV (le plus faible par défaut, ou celui qu'on choisit)
drop function if exists public.marche_mettre_en_vente(text, uuid, boolean, integer);
create or replace function public.marche_mettre_en_vente(p_booster text, p_artist uuid, p_holo boolean, p_prix integer, p_exemplaire bigint default null) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid(); v_holo boolean := coalesce(p_holo, false);
  v_cfg public.marche_reglages; v_bc public.jeu_booster_cartes; v_b public.marche_bornes; ex public.jeu_exemplaires;
  v_max integer; v_nb integer; v_id bigint; v_noms text[] := array['Commune', 'Rare', 'Épique', 'Légendaire', 'Mythique'];
begin
  if v_uid is null then raise exception 'Connecte-toi.'; end if;
  perform public.jeu_joueur_assurer(v_uid);
  if exists (select 1 from public.marche_suspendus where user_id = v_uid) then raise exception 'Tu es suspendu du marché.'; end if;
  perform public.marche_expirer();

  select * into v_cfg from public.marche_reglages where id = 1;
  select * into v_bc from public.jeu_booster_cartes where booster_id = p_booster and artist_id = p_artist;
  if not found then raise exception 'Carte introuvable.'; end if;
  select * into v_b from public.marche_bornes where rarete = v_bc.rarete;
  v_max := case when v_holo then v_b.prix_max * 3 else v_b.prix_max end;
  if p_prix is null or p_prix < v_b.prix_min or p_prix > v_max then
    raise exception 'Une carte % se vend entre % et % vinyles.', lower(v_noms[v_bc.rarete]) || case when v_holo then ' holo' else '' end, v_b.prix_min, v_max;
  end if;

  perform 1 from public.jeu_joueurs where user_id = v_uid for update;
  select * into ex from public.jeu_exemplaires
   where user_id = v_uid and booster_id = p_booster and artist_id = p_artist and holo = v_holo and (p_exemplaire is null or id = p_exemplaire)
   order by (iv_pv + iv_pui + iv_def + iv_vit), id limit 1 for update;
  if not found then raise exception 'Tu ne possèdes pas cette carte.'; end if;

  select count(*) into v_nb from public.marche_annonces where vendeur = v_uid and etat = 'active';
  if v_nb >= v_cfg.max_annonces then raise exception 'Tu as déjà % annonces en cours, le maximum.', v_nb; end if;

  delete from public.jeu_exemplaires where id = ex.id;

  insert into public.marche_annonces (vendeur, booster_id, artist_id, holo, rarete, prix, expire_le, iv_pv, iv_pui, iv_def, iv_vit)
  values (v_uid, p_booster, p_artist, v_holo, v_bc.rarete, p_prix, now() + make_interval(days => v_cfg.duree_jours), ex.iv_pv, ex.iv_pui, ex.iv_def, ex.iv_vit)
  returning id into v_id;

  insert into public.marche_journal (type, annonce_id, booster_id, artist_id, holo, rarete, vendeur, prix)
  values ('mise_en_vente', v_id, p_booster, p_artist, v_holo, v_bc.rarete, v_uid, p_prix);

  return jsonb_build_object('id', v_id, 'etat', public.jeu_etat_json(v_uid));
end $$;
revoke all on function public.marche_mettre_en_vente(text, uuid, boolean, integer, bigint) from public, anon;
grant execute on function public.marche_mettre_en_vente(text, uuid, boolean, integer, bigint) to authenticated;

create or replace function public.marche_rendre(a public.marche_annonces) returns void
language sql security definer set search_path to 'public' as $$
  insert into public.jeu_exemplaires (user_id, booster_id, artist_id, holo, iv_pv, iv_pui, iv_def, iv_vit, origine)
  values (a.vendeur, a.booster_id, a.artist_id, a.holo, coalesce(a.iv_pv, 15), coalesce(a.iv_pui, 15), coalesce(a.iv_def, 15), coalesce(a.iv_vit, 15), 'retour') $$;

select pg_temp.corriger('public.marche_acheter(bigint)'::regprocedure,
  $a$  insert into public.jeu_collection_b (user_id, booster_id, artist_id, holo, quantite)
  values (v_uid, a.booster_id, a.artist_id, a.holo, 1)
  on conflict (user_id, booster_id, artist_id, holo) do update set quantite = public.jeu_collection_b.quantite + 1;$a$,
  $b$  insert into public.jeu_exemplaires (user_id, booster_id, artist_id, holo, iv_pv, iv_pui, iv_def, iv_vit, origine)
  values (v_uid, a.booster_id, a.artist_id, a.holo, coalesce(a.iv_pv, 15), coalesce(a.iv_pui, 15), coalesce(a.iv_def, 15), coalesce(a.iv_vit, 15), 'marche');$b$);
select pg_temp.corriger('public.marche_acheter(bigint)'::regprocedure,
  $a$'carte', public.marche_carte_json(a.booster_id, a.artist_id, a.holo, a.rarete));$a$,
  $b$'carte', public.marche_carte_json(a.booster_id, a.artist_id, a.holo, a.rarete)
      || jsonb_build_object('iv', jsonb_build_array(a.iv_pv, a.iv_pui, a.iv_def, a.iv_vit), 'iv_pct', public.jeu_iv_pct(a.iv_pv, a.iv_pui, a.iv_def, a.iv_vit)));$b$);
select pg_temp.corriger('public.marche_lister(text, integer, boolean, integer, integer, text, boolean, text, integer)'::regprocedure,
  $a$'carte', public.marche_carte_json(x.booster_id, x.artist_id, x.holo, x.rarete))$a$,
  $b$'carte', public.marche_carte_json(x.booster_id, x.artist_id, x.holo, x.rarete)
        || jsonb_build_object('iv', jsonb_build_array(x.iv_pv, x.iv_pui, x.iv_def, x.iv_vit), 'iv_pct', public.jeu_iv_pct(x.iv_pv, x.iv_pui, x.iv_def, x.iv_vit)))$b$);

-- 9. Le combat : le type et les attaques viennent de la carte d'album, les stats des IV de l'exemplaire (le meilleur du joueur)
drop function if exists public.combat_unite(uuid, integer, boolean, integer);
drop function if exists public.combat_identite(uuid, integer, boolean, boolean);

create or replace function public.combat_identite(p_artist uuid, p_rarete integer, p_holo boolean, p_sans boolean default false, p_booster text default null, p_user uuid default null) returns jsonb
language plpgsql stable set search_path to 'public' as $$
declare
  c public.jeu_cartes; s public.combat_surcharges; ty public.combat_types; ro public.combat_roles; v_t text; v_role text;
  al public.jeu_albums; ex public.jeu_exemplaires; v_eff numeric := (public.jeu_iv_reglage() ->> 'effet_pct')::numeric;
  fpv numeric := 1; fpui numeric := 1; fdef numeric := 1; fvit numeric := 1; v_ivpct numeric; tj jsonb; ti jsonb; rmax bigint; v_alb jsonb;
  n numeric; m numeric; hm numeric; h numeric; v_pv integer; v_pui integer; v_def integer; v_vit integer;
  b_pv integer; b_pui integer; b_def integer; b_vit integer;
  ids text[]; tid text; techs jsonb := '[]'::jsonb; sl integer; cp text; jc jsonb; faibles jsonb; resiste jsonb; forts jsonb;
begin
  select * into c from public.jeu_cartes where artist_id = p_artist;
  if not found then raise exception 'Carte inconnue.'; end if;
  if not p_sans then select * into s from public.combat_surcharges where artist_id = p_artist; end if;

  -- La carte d'album : celle de la collection, sinon la plus récente de l'artiste qui a un type
  if p_booster is not null then
    select a.* into al from public.jeu_booster_cartes bc join public.jeu_albums a on a.id = bc.album_id and a.actif
     where bc.booster_id = p_booster and bc.artist_id = p_artist;
  end if;
  if al.id is null then
    select a.* into al from public.jeu_albums a join public.submissions su on su.id = a.release_id
     where a.artist_id = p_artist and a.actif and a.type is not null order by su.release_date desc nulls last, a.cree_le desc limit 1;
  end if;

  v_t := coalesce(al.type, s.type, (select (array_agg(t.id order by t.ordre))[1 + abs(hashtext(p_artist::text)) % count(*)] from public.combat_types t));
  select * into ty from public.combat_types where id = v_t;
  v_role := coalesce(s.role, public.combat_role_de(p_artist, v_t));
  if p_sans then
    v_role := public.combat_role_de(p_artist, v_t);
    select * into s from public.combat_surcharges where false;
  end if;
  select * into ro from public.combat_roles where id = v_role;

  -- Les IV de l'exemplaire du joueur (le meilleur) : de - effet % à + effet % sur chaque statistique
  if p_user is not null and p_booster is not null then
    select * into ex from public.jeu_exemplaires e
     where e.user_id = p_user and e.booster_id = p_booster and e.artist_id = p_artist and e.holo = coalesce(p_holo, false)
     order by (e.iv_pv + e.iv_pui + e.iv_def + e.iv_vit) desc, e.id limit 1;
    if ex.id is not null then
      fpv := 1 + v_eff / 100.0 * (2 * ex.iv_pv / 31.0 - 1);   fpui := 1 + v_eff / 100.0 * (2 * ex.iv_pui / 31.0 - 1);
      fdef := 1 + v_eff / 100.0 * (2 * ex.iv_def / 31.0 - 1); fvit := 1 + v_eff / 100.0 * (2 * ex.iv_vit / 31.0 - 1);
      v_ivpct := public.jeu_iv_pct(ex.iv_pv, ex.iv_pui, ex.iv_def, ex.iv_vit);
    end if;
  end if;

  n := greatest(0, least(1, (log(greatest(c.fans, 1000)::numeric) - 5.5) / 1.6));
  m := case when p_rarete <= 1 then 1 when p_rarete = 2 then 1.08 when p_rarete = 3 then 1.18 when p_rarete = 4 then 1.3 when p_rarete = 5 then 1.45 else 1.6 end;
  hm := case when p_holo then 1.06 else 1 end;
  h := (abs(hashtext(p_artist::text || 'vit')) % 1000) / 1000.0;
  b_pv  := coalesce(s.pv,  round((80 + 50 * n) * ro.m_pv));
  b_pui := coalesce(s.pui, round((45 + 25 * n) * ro.m_pui));
  b_def := coalesce(s.def, round((40 + 25 * n) * ro.m_def));
  b_vit := coalesce(s.vit, round((45 + 50 * h) * ro.m_vit));
  v_pv  := round(b_pv * m * hm * fpv);
  v_pui := round(b_pui * m * hm * fpui);
  v_def := round(b_def * m * hm * fdef);
  v_vit := round(b_vit * hm * fvit);

  for sl in 1..3 loop
    tid := case sl when 1 then s.tech1 when 2 then s.tech2 else s.tech3 end;
    if tid is null or not exists (select 1 from public.combat_techniques where id = tid) then
      ids := array(select id from public.combat_techniques where actif and role = v_role and slot = sl order by id);
      if array_length(ids, 1) is null then ids := array(select id from public.combat_techniques where actif and slot = sl order by id); end if;
      tid := ids[1 + abs(hashtext(p_artist::text || 'tech' || sl)) % array_length(ids, 1)];
    end if;
    tj := public.combat_technique_json(tid, v_t);
    -- Le nom d'une attaque est un titre du projet ; sa puissance suit la popularité du titre dans le projet (de - 10 % à + 10 %)
    if al.id is not null and jsonb_array_length(al.attaques) >= sl then
      select x into ti from jsonb_array_elements(al.titres) x where (x ->> 'id') = (al.attaques ->> (sl - 1)) limit 1;
      if ti is not null then
        select coalesce(max((x ->> 'rang')::bigint), 0) into rmax from jsonb_array_elements(al.titres) x;
        tj := tj || jsonb_build_object('nom', ti ->> 'titre', 'titre_id', (ti ->> 'id')::bigint);
        if (tj ->> 'puissance')::integer > 0 and rmax > 0 then
          tj := jsonb_set(tj, '{puissance}', to_jsonb(round((tj ->> 'puissance')::numeric * (0.9 + 0.2 * (ti ->> 'rang')::numeric / rmax))::integer));
        end if;
      end if;
    end if;
    techs := techs || jsonb_build_array(tj);
  end loop;

  cp := s.capacite;
  if cp is null and p_rarete >= 4 then
    ids := array(select id from public.combat_capacites order by id);
    cp := ids[1 + abs(hashtext(p_artist::text || 'cap')) % array_length(ids, 1)];
  end if;
  if cp is not null then
    select jsonb_build_object('id', id, 'nom', nom, 'code', code, 'valeur', valeur, 'description', description) into jc from public.combat_capacites where id = cp;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'nom', t.nom, 'couleur', t.couleur, 'mult', a.mult) order by t.ordre), '[]'::jsonb) into faibles
    from public.combat_affinites a join public.combat_types t on t.id = a.att where a.def = v_t and a.mult > 1;
  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'nom', t.nom, 'couleur', t.couleur, 'mult', a.mult) order by t.ordre), '[]'::jsonb) into resiste
    from public.combat_affinites a join public.combat_types t on t.id = a.att where a.def = v_t and a.mult < 1;
  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'nom', t.nom, 'couleur', t.couleur, 'mult', a.mult) order by t.ordre), '[]'::jsonb) into forts
    from public.combat_affinites a join public.combat_types t on t.id = a.def where a.att = v_t and a.mult > 1;

  if al.id is not null then
    select jsonb_build_object('id', al.id, 'titre', su.track_title, 'cover', su.cover_url) into v_alb from public.submissions su where su.id = al.release_id;
  end if;

  return jsonb_build_object(
    'artist_id', p_artist, 'nom', c.nom, 'photo', c.photo, 'numero', c.numero, 'rarete', p_rarete, 'holo', p_holo,
    'type', v_t, 'type_nom', ty.nom, 'couleur', ty.couleur, 'icone', ty.icone, 'citation', coalesce(s.citation, ty.citation),
    'role', v_role, 'role_nom', ro.nom, 'role_resume', ro.resume,
    'pv', v_pv, 'pui', v_pui, 'def', v_def, 'vit', v_vit,
    'techniques', techs, 'capacite', jc,
    'faiblesses', faibles, 'resistances', resiste, 'forces', forts,
    'base', jsonb_build_object('pv', b_pv, 'pui', b_pui, 'def', b_def, 'vit', b_vit),
    'mult_rarete', m, 'album', v_alb,
    'iv', case when ex.id is null then null else jsonb_build_array(ex.iv_pv, ex.iv_pui, ex.iv_def, ex.iv_vit) end, 'iv_pct', v_ivpct, 'exemplaire', ex.id,
    'surcharge', case when s.artist_id is null then null else jsonb_strip_nulls(to_jsonb(s) - 'artist_id' - 'maj_le') end);
end $$;

create or replace function public.combat_unite(p_artist uuid, p_rarete integer, p_holo boolean, p_bonus integer default 0, p_booster text default null, p_user uuid default null) returns jsonb
language plpgsql stable set search_path to 'public' as $$
declare i jsonb := public.combat_identite(p_artist, p_rarete, p_holo, false, p_booster, p_user); k numeric := 1 + coalesce(p_bonus, 0) / 100.0; cd jsonb;
begin
  select jsonb_agg(case when (t ->> 'slot')::integer = 3 then greatest((t ->> 'recharge')::integer - 2, 0) else 0 end order by o) into cd
    from jsonb_array_elements(i -> 'techniques') with ordinality as x (t, o);
  return jsonb_build_object(
    'artist_id', p_artist, 'nom', i ->> 'nom', 'photo', i ->> 'photo', 'numero', i -> 'numero', 'rarete', p_rarete, 'holo', p_holo,
    'type', i ->> 'type', 'type_nom', i ->> 'type_nom', 'couleur', i ->> 'couleur', 'role', i ->> 'role', 'role_nom', i ->> 'role_nom',
    'pv', round((i ->> 'pv')::numeric * k), 'pv_max', round((i ->> 'pv')::numeric * k), 'pui', round((i ->> 'pui')::numeric * k),
    'def', round((i ->> 'def')::numeric * k), 'vit', round((i ->> 'vit')::numeric * k),
    'jauge', 0, 'techs', i -> 'techniques', 'cd', cd, 'statuts', '[]'::jsonb, 'capacite', i -> 'capacite',
    'ko', false, 'ouv', false, 'surv', false, 'stats', jsonb_build_object('deg', 0, 'soins', 0, 'ko', 0, 'sub', 0),
    'iv_pct', i -> 'iv_pct',
    'faiblesses', (select coalesce(jsonb_agg(x ->> 'id'), '[]'::jsonb) from jsonb_array_elements(i -> 'faiblesses') x),
    'resistances', (select coalesce(jsonb_agg(x ->> 'id'), '[]'::jsonb) from jsonb_array_elements(i -> 'resistances') x),
    'forces', (select coalesce(jsonb_agg(x ->> 'id'), '[]'::jsonb) from jsonb_array_elements(i -> 'forces') x));
end $$;

select pg_temp.corriger('public.combat_duo_unites(uuid, jsonb)'::regprocedure,
  $a$public.combat_unite(v_a, v_r, v_h)$a$, $b$public.combat_unite(v_a, v_r, v_h, 0, v_b, p_user)$b$);
select pg_temp.corriger('public.combat_duo_infos(uuid, text)'::regprocedure,
  $a$public.combat_identite(e.artist_id, bc.rarete, e.holo)$a$, $b$public.combat_identite(e.artist_id, bc.rarete, e.holo, false, e.booster_id, e.user_id)$b$);
select pg_temp.corriger('public.combat_duos_lire()'::regprocedure,
  $a$public.combat_identite((d ->> 'artist')::uuid, bc.rarete, coalesce((d ->> 'holo')::boolean, false))$a$,
  $b$public.combat_identite((d ->> 'artist')::uuid, bc.rarete, coalesce((d ->> 'holo')::boolean, false), false, d ->> 'booster', v_uid)$b$);
select pg_temp.corriger('public.combat_mes_cartes()'::regprocedure,
  $a$public.combat_identite(col.artist_id, bc.rarete, col.holo)$a$, $b$public.combat_identite(col.artist_id, bc.rarete, col.holo, false, col.booster_id, col.user_id)$b$);
select pg_temp.corriger('public.pvp_duo_infos(uuid)'::regprocedure,
  $a$public.combat_identite((t.x ->> 'artist')::uuid, bc.rarete, coalesce((t.x ->> 'holo')::boolean, false))$a$,
  $b$public.combat_identite((t.x ->> 'artist')::uuid, bc.rarete, coalesce((t.x ->> 'holo')::boolean, false), false, t.x ->> 'booster', d.user_id)$b$);
select pg_temp.corriger('public.combat_carte(uuid, text, boolean)'::regprocedure,
  $a$public.combat_identite(p_artist, v_r, coalesce(p_holo, false))$a$, $b$public.combat_identite(p_artist, v_r, coalesce(p_holo, false), false, p_booster, auth.uid())$b$);

-- 10. La console : les réglages des IV et la carte d'album d'une carte de collection
-- La console lit la carte d'album de chaque carte d'une collection
select pg_temp.corriger('public.jeu_equipe_cartes(text)'::regprocedure,
  $a$'clip_son', bc.clip_son)$a$,
  $b$'clip_son', bc.clip_son, 'album_id', bc.album_id, 'carte_album', public.jeu_album_carte_json(bc.booster_id, bc.artist_id))$b$);

create or replace function public.jeu_equipe_iv_lire() returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not public.est_equipe() then raise exception 'Réservé à l''équipe.'; end if;
  return public.jeu_iv_reglage() || jsonb_build_object('boosters', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'nom', b.nom, 'parfait', b.iv_parfait) order by b.ordre) from public.jeu_boosters b where b.classeur), '[]'::jsonb));
end $$;

create or replace function public.jeu_equipe_iv_ecrire(p jsonb) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_eff numeric := (p ->> 'effet_pct')::numeric; v_def numeric := (p ->> 'parfait_defaut')::numeric; v_min jsonb := p -> 'min'; x jsonb; k integer;
begin
  if not public.est_equipe() then raise exception 'Réservé à l''équipe.'; end if;
  if v_eff is null or v_eff < 0 or v_eff > 50 then raise exception 'L''effet des IV : entre 0 et 50 pour cent.'; end if;
  if v_def is null or v_def < 0 or v_def > 100 then raise exception 'La chance d''une carte parfaite : entre 0 et 100 pour cent.'; end if;
  if jsonb_typeof(v_min) <> 'array' or jsonb_array_length(v_min) <> 6 then raise exception 'Il faut un minimum d''IV pour chacune des 6 raretés.'; end if;
  for k in 0..5 loop
    if (v_min ->> k)::integer not between 0 and 30 then raise exception 'Le minimum d''IV : entre 0 et 30.'; end if;
  end loop;
  insert into public.jeu_reglages (cle, valeur, maj_le, maj_par) values ('iv', jsonb_build_object('effet_pct', v_eff, 'min', v_min, 'parfait_defaut', v_def), now(), auth.uid())
  on conflict (cle) do update set valeur = excluded.valeur, maj_le = now(), maj_par = auth.uid();
  for x in select value from jsonb_array_elements(coalesce(p -> 'boosters', '[]'::jsonb)) loop
    if (x ->> 'parfait') is not null and ((x ->> 'parfait')::numeric not between 0 and 100) then raise exception 'La chance d''une carte parfaite : entre 0 et 100 pour cent.'; end if;
    update public.jeu_boosters set iv_parfait = nullif(x ->> 'parfait', '')::numeric where id = x ->> 'id';
  end loop;
  perform public.jeu_equipe_noter('iv_regles', p);
  return public.jeu_equipe_iv_lire();
end $$;

create or replace function public.jeu_equipe_carte_album(p_booster text, p_artist uuid, p_album uuid) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.est_equipe() then raise exception 'Réservé à l''équipe.'; end if;
  if not exists (select 1 from public.jeu_booster_cartes where booster_id = p_booster and artist_id = p_artist) then raise exception 'Cette carte n''est pas dans la collection.'; end if;
  if p_album is not null and not exists (select 1 from public.jeu_albums where id = p_album and artist_id = p_artist) then raise exception 'Cet album n''est pas celui de cet artiste.'; end if;
  update public.jeu_booster_cartes set album_id = p_album where booster_id = p_booster and artist_id = p_artist;
  perform public.jeu_equipe_noter('carte_album', jsonb_build_object('booster', p_booster, 'artist', p_artist, 'album', p_album));
  return public.jeu_album_carte_json(p_booster, p_artist);
end $$;

-- les albums d'un artiste pour la console (la carte de collection choisit parmi eux)
create or replace function public.jeu_equipe_albums_de(p_artist uuid) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not public.est_equipe() then raise exception 'Réservé à l''équipe.'; end if;
  return coalesce((select jsonb_agg(public.jeu_album_json(a.id) - 'titres' order by s.release_date desc nulls last)
                     from public.jeu_albums a join public.submissions s on s.id = a.release_id where a.artist_id = p_artist and a.actif), '[]'::jsonb);
end $$;

revoke all on function public.jeu_exemplaires_sync(), public.jeu_iv_reglage(), public.jeu_iv_pct(integer, integer, integer, integer), public.jeu_iv_tirer(integer, numeric),
  public.jeu_album_carte_json(text, uuid), public.jeu_equipe_iv_lire(), public.jeu_equipe_iv_ecrire(jsonb), public.jeu_equipe_carte_album(text, uuid, uuid),
  public.jeu_equipe_albums_de(uuid) from public, anon, authenticated;
grant execute on function public.jeu_equipe_iv_lire(), public.jeu_equipe_iv_ecrire(jsonb), public.jeu_equipe_carte_album(text, uuid, uuid), public.jeu_equipe_albums_de(uuid) to authenticated;
grant execute on function public.jeu_iv_pct(integer, integer, integer, integer) to authenticated;
