-- Wave Cards : la rareté « Spécial » (6), réservée à la collection Vague Glaciale, et la photo d'artiste réglable depuis la console.
-- Sans danger si on le repasse.

-- ============================== 1. La rareté Spécial ==============================

-- Un « Spécial » n'existe que dans Vague Glaciale : la rareté globale d'une carte (jeu_cartes) reste de 1 à 5.
alter table public.jeu_booster_cartes drop constraint if exists jeu_booster_cartes_rarete_check;
alter table public.jeu_booster_cartes add constraint jeu_booster_cartes_rarete_check
  check ((rarete between 1 and 5) or (rarete = 6 and booster_id = 'glaciale'));

alter table public.marche_bornes drop constraint if exists marche_bornes_rarete_check;
alter table public.marche_bornes add constraint marche_bornes_rarete_check check (rarete between 1 and 6);
insert into public.marche_bornes (rarete, prix_min, prix_max) values (6, 30, 8000) on conflict (rarete) do nothing;

-- Les taux d'une collection : cinq valeurs, ou six pour Vague Glaciale.
alter table public.jeu_boosters drop constraint if exists jeu_boosters_taux_check;
alter table public.jeu_boosters add constraint jeu_boosters_taux_check
  check (taux is null or array_length(taux, 1) = 5 or (id = 'glaciale' and array_length(taux, 1) = 6));

create or replace function public.jeu_valeur(p_rarete integer) returns integer
  language sql immutable set search_path to 'public'
as $$ select (array[2, 6, 22, 90, 350, 1200])[least(greatest(p_rarete, 1), 6)] $$;

create or replace function public.jeu_cout(p_rarete integer) returns integer
  language sql immutable set search_path to 'public'
as $$ select (array[15, 50, 180, 700, 2500, 8000])[least(greatest(p_rarete, 1), 6)] $$;

-- Remplace un morceau du texte d'une fonction existante (échoue si le morceau n'y est pas : rien n'est modifié à moitié).
create or replace function pg_temp.corriger(p_fn regprocedure, p_avant text, p_apres text) returns void
  language plpgsql as $$
declare v_def text := pg_get_functiondef(p_fn);
begin
  if position(p_avant in v_def) = 0 then raise exception 'Morceau introuvable dans % : %', p_fn, left(p_avant, 60); end if;
  execute replace(v_def, p_avant, p_apres);
end $$;

-- Le tirage : jusqu'à six raretés (un booster à cinq taux ignore la sixième).
select pg_temp.corriger('public.jeu_tirer_rarete(numeric[], integer)'::regprocedure,
  $a$  for k in greatest(p_min, 1)..5 loop v_tot := v_tot + p_taux[k]; end loop;
  v_r := random() * v_tot;
  for k in greatest(p_min, 1)..5 loop
    v_cum := v_cum + p_taux[k];
    if v_r < v_cum then return k; end if;
  end loop;
  return 5;$a$,
  $b$  for k in greatest(p_min, 1)..coalesce(array_upper(p_taux, 1), 5) loop v_tot := v_tot + coalesce(p_taux[k], 0); end loop;
  v_r := random() * v_tot;
  for k in greatest(p_min, 1)..coalesce(array_upper(p_taux, 1), 5) loop
    v_cum := v_cum + coalesce(p_taux[k], 0);
    if v_r < v_cum then return k; end if;
  end loop;
  return coalesce(array_upper(p_taux, 1), 5);$b$);

-- L'XP d'une ouverture : un Spécial vaut 120.
select pg_temp.corriger(p.oid::regprocedure,
  'case c.rarete when 3 then 3 when 4 then 10 when 5 then 40 else 0 end',
  'case c.rarete when 3 then 3 when 4 then 10 when 5 then 40 when 6 then 120 else 0 end')
  from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'jeu_ouvrir';

-- Le combat : un Spécial a le plus gros bonus de stats.
select pg_temp.corriger(p.oid::regprocedure,
  'when p_rarete = 4 then 1.3 else 1.45 end',
  'when p_rarete = 4 then 1.3 when p_rarete = 5 then 1.45 else 1.6 end')
  from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'combat_identite';

-- La console : un Spécial se règle comme les autres raretés, mais seulement dans Vague Glaciale.
select pg_temp.corriger('public.jeu_equipe_cartes_raretes(text, jsonb)'::regprocedure,
  $a$where (e ->> 'rarete')::integer not between 1 and 5) then raise exception 'Rareté inconnue.'; end if;$a$,
  $b$where (e ->> 'rarete')::integer not between 1 and 6) then raise exception 'Rareté inconnue.'; end if;
  if p_booster <> 'glaciale' and exists (select 1 from jsonb_array_elements(p_items) e where (e ->> 'rarete')::integer = 6) then raise exception 'La rareté Spécial est réservée à Vague Glaciale.'; end if;$b$);

select pg_temp.corriger('public.jeu_equipe_cartes_ajouter(text, jsonb)'::regprocedure,
  $a$if (it ->> 'rarete')::integer not between 1 and 5 then raise exception 'Rareté inconnue.'; end if;$a$,
  $b$if (it ->> 'rarete')::integer not between 1 and 6 then raise exception 'Rareté inconnue.'; end if;
    if (it ->> 'rarete')::integer = 6 and p_booster <> 'glaciale' then raise exception 'La rareté Spécial est réservée à Vague Glaciale.'; end if;$b$);

select pg_temp.corriger('public.marche_equipe_borne(integer, integer, integer)'::regprocedure,
  'p_rarete not between 1 and 5', 'p_rarete not between 1 and 6');

-- Les taux d'une collection : cinq, ou six pour Vague Glaciale.
select pg_temp.corriger('public.jeu_equipe_booster_sauver(text, jsonb)'::regprocedure,
  $a$array_length(v_taux, 1) <> 5 then raise exception 'Il faut cinq taux, de Commun à Mythique.'; end if;$a$,
  $b$array_length(v_taux, 1) <> 5 + (p_id = 'glaciale')::integer then
      raise exception 'Il faut % taux, de Commun à %.', 5 + (p_id = 'glaciale')::integer, (array['Mythique', 'Spécial'])[1 + (p_id = 'glaciale')::integer]; end if;$b$);

select pg_temp.corriger('public.jeu_equipe_booster_json(text)'::regprocedure,
  'count(*) filter (where x.rarete = 5))', 'count(*) filter (where x.rarete = 5), count(*) filter (where x.rarete = 6))');

-- Vague Glaciale : six taux (Spécial = 0,6 % des cartes tirées), et deux cartes Spécial : Freeze Corleone et Zola.
update public.jeu_boosters set taux = array[44.4, 30, 16, 7, 2, 0.6]::numeric[] where id = 'glaciale' and coalesce(array_length(taux, 1), 0) = 5;
update public.jeu_booster_cartes bc set rarete = 6
  from public.jeu_cartes c
 where bc.booster_id = 'glaciale' and c.artist_id = bc.artist_id and c.nom in ('Freeze Corleone', 'Zola') and bc.rarete = 5;

-- ============================== 2. La photo d'une carte ==============================

-- La photo choisie par l'équipe : elle remplace celle de l'artiste, et le rafraîchissement quotidien des cartes n'y touche plus.
alter table public.jeu_cartes add column if not exists photo_perso text;

create or replace function public.jeu_cartes_photo_perso() returns trigger
  language plpgsql set search_path to 'public'
as $$
begin
  if new.photo_perso is not null then new.photo := new.photo_perso; end if;
  return new;
end $$;

drop trigger if exists jeu_cartes_photo_perso on public.jeu_cartes;
create trigger jeu_cartes_photo_perso before insert or update on public.jeu_cartes
  for each row execute function public.jeu_cartes_photo_perso();

create or replace function public.jeu_equipe_carte_photo(p_artist uuid, p_photo text) returns jsonb
  language plpgsql security definer set search_path to 'public'
as $$
declare v_photo text := nullif(btrim(coalesce(p_photo, '')), '');
begin
  if not public.est_equipe() then raise exception 'Réservé à l''équipe.'; end if;
  if v_photo is not null and (v_photo !~ '^https://[^[:space:]<>"'']+$' or length(v_photo) > 600) then
    raise exception 'Adresse d''image invalide : elle doit commencer par https://.';
  end if;
  if not exists (select 1 from public.jeu_cartes where artist_id = p_artist) then raise exception 'Carte inconnue.'; end if;

  if v_photo is null then
    -- Retour à la photo de l'artiste.
    update public.jeu_cartes c
       set photo_perso = null, photo = coalesce((select a.photo_url from public.artists a where a.id = c.artist_id), c.photo)
     where c.artist_id = p_artist;
  else
    update public.jeu_cartes set photo_perso = v_photo, photo = v_photo where artist_id = p_artist;
  end if;

  perform public.jeu_equipe_noter('carte_photo', jsonb_build_object('artist', p_artist, 'perso', v_photo is not null));
  return jsonb_build_object('photo', (select photo from public.jeu_cartes where artist_id = p_artist), 'perso', v_photo is not null);
end $$;

revoke all on function public.jeu_equipe_carte_photo(uuid, text) from public, anon;
grant execute on function public.jeu_equipe_carte_photo(uuid, text) to authenticated;

select pg_temp.corriger('public.jeu_equipe_cartes(text)'::regprocedure,
  $a$'photo', c.photo, 'fans'$a$, $b$'photo', c.photo, 'photo_perso', c.photo_perso is not null, 'fans'$b$);
