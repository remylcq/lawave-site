-- =====================================================================
-- La Wave — les boosters du jeu de cartes d'artistes
--
-- Jusqu'ici il n'y avait qu'un pack. Désormais plusieurs boosters se défilent dans un carrousel (onglet Packs) ;
-- chacun a son coût en tirages, ses taux de rareté et son décor. Les trois d'aujourd'hui sont des boosters d'essai :
--   scene            Scène francophone   taux de l'événement du jour, tous les artistes   1 tirage
--   legendes         Légendes            Rare et mieux seulement                         2 tirages
--   nouvelle-vague   Nouvelle vague      Commun à Épique, holos ×3                       1 tirage
--
-- (Rien à voir avec sql/boosters.sql, l'ancienne boutique de coffres retirée du site.)
--
-- Plus tard : des collections à cartes exclusives (comme les extensions Pokémon) = une nouvelle ligne ici
-- + une liste d'artistes réservés à ce booster.
--
-- À passer une fois dans l'éditeur SQL de Supabase. Sans danger si on le repasse.
-- Retrait : drop function public.jeu_boosters(); drop function public.jeu_ouvrir(integer, boolean, text); drop table public.jeu_boosters;
-- puis remettre jeu_ouvrir(integer, boolean) de sql/cartes-artistes.sql.
-- =====================================================================

create table if not exists public.jeu_boosters (
  id          text primary key,
  nom         text not null,
  serie       text not null default '',
  description text not null default '',
  ordre       integer not null default 0,
  actif       boolean not null default true,
  cout        integer not null default 1 check (cout between 1 and 10),
  taux        numeric[] check (taux is null or array_length(taux, 1) = 5),   -- Commun, Rare, Épique, Légendaire, Mythique ; null = ceux de l'événement du jour
  holo_x      numeric not null default 1,                                    -- multiplicateur de la chance de holo
  theme       text not null default 'onde',                                  -- le décor dessiné par cartes.js
  accent      text not null default '#4FB4FF'
);

alter table public.jeu_boosters enable row level security;   -- aucune règle : tout passe par jeu_boosters()

insert into public.jeu_boosters (id, nom, serie, description, ordre, cout, taux, holo_x, theme, accent) values
  ('scene', 'Scène francophone', 'Série de lancement',
   'Le pack de référence : un artiste de la scène francophone, tiré parmi tous. Plus il est écouté, plus sa carte est rare.',
   1, 1, null, 1, 'onde', '#4FB4FF'),
  ('legendes', 'Légendes', 'Série de lancement',
   'Que des cartes Rare ou mieux. Les têtes d''affiche de la scène, avec une vraie chance de Légendaire.',
   2, 2, array[0, 55, 30, 12, 3]::numeric[], 1, 'couronne', '#F2C14E'),
  ('nouvelle-vague', 'Nouvelle vague', 'Série de lancement',
   'Les artistes qui montent : de Commun à Épique, et les holos sortent trois fois plus souvent.',
   3, 1, array[55, 33, 12, 0, 0]::numeric[], 3, 'aube', '#FF6FA8')
on conflict (id) do update set
  nom = excluded.nom, serie = excluded.serie, description = excluded.description, ordre = excluded.ordre,
  cout = excluded.cout, taux = excluded.taux, holo_x = excluded.holo_x, theme = excluded.theme, accent = excluded.accent;

-- La liste pour le carrousel : taux compris (ceux de l'événement quand le booster n'a pas les siens).
create or replace function public.jeu_boosters()
returns jsonb
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', b.id, 'nom', b.nom, 'serie', b.serie, 'description', b.description, 'cout', b.cout,
    'taux', to_jsonb(coalesce(b.taux, (select array_agg(x::numeric order by ord) from jsonb_array_elements_text(public.jeu_evenement() -> 'taux') with ordinality t (x, ord)))),
    'holo_x', b.holo_x, 'theme', b.theme, 'accent', b.accent
  ) order by b.ordre), '[]'::jsonb)
  from public.jeu_boosters b
  where b.actif;
$$;

revoke all on function public.jeu_boosters() from public, anon;
grant execute on function public.jeu_boosters() to authenticated;

-- L'ouverture : un booster en plus. Le pack Épique garanti (récompenses) reste un pack de la Scène francophone.
drop function if exists public.jeu_ouvrir(integer, boolean);

create or replace function public.jeu_ouvrir(p_n integer, p_garanti boolean default false, p_booster text default 'scene')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  j public.jeu_joueurs; v_ev jsonb; v_taux numeric[]; v_holo_p numeric; v_jour date := public.xp_jour();
  b public.jeu_boosters; v_cout integer;
  i integer; v_tier integer; c public.jeu_cartes; v_holo boolean; v_nouvelle boolean; v_nv_holo boolean; v_qte integer;
  v_cartes jsonb := '[]'::jsonb; v_rare_plus boolean := false;
  v_nb_rare integer := 0; v_nb_epique integer := 0; v_nb_holo integer := 0; v_xp integer := 0;
  v_niv integer; v_niveaux jsonb := '[]'::jsonb; v_bonus_t integer := 0; v_bonus_v integer := 0;
begin
  if v_uid is null then raise exception 'Connecte-toi.'; end if;
  if p_n not in (1, 5, 10) then raise exception 'Quantité inconnue.'; end if;

  select * into b from public.jeu_boosters where id = case when p_garanti then 'scene' else coalesce(p_booster, 'scene') end and actif;
  if not found then raise exception 'Ce booster n''existe pas.'; end if;
  v_cout := case when p_garanti then 0 else b.cout end;

  perform public.jeu_joueur_assurer(v_uid);
  perform public.jeu_regen(v_uid);
  select * into j from public.jeu_joueurs where user_id = v_uid for update;

  if p_garanti then
    if j.garantis < 1 then raise exception 'Tu n''as pas de pack garanti.'; end if;
    p_n := 1;
  elsif j.tirages < p_n * v_cout then
    raise exception 'Pas assez de tirages.';
  end if;

  v_ev := public.jeu_evenement();
  if b.taux is not null then
    v_taux := b.taux;
  else
    select array_agg(x::numeric order by ord) into v_taux from jsonb_array_elements_text(v_ev -> 'taux') with ordinality as t (x, ord);
  end if;
  v_holo_p := (v_ev ->> 'holo')::numeric * b.holo_x;

  for i in 1..p_n loop

    -- Sur dix packs, au moins une Rare ou mieux ; un pack garanti est Épique ou mieux.
    v_tier := public.jeu_tirer_rarete(v_taux,
      case when p_garanti then 3 when p_n >= 10 and i = p_n and not v_rare_plus then 2 else 1 end);

    select * into c from public.jeu_cartes where active and rarete = v_tier order by random() limit 1;
    if not found then
      select * into c from public.jeu_cartes where active and rarete <= v_tier order by rarete desc, random() limit 1;
    end if;
    if not found then raise exception 'Aucune carte disponible pour le moment.'; end if;

    v_holo := random() < v_holo_p;
    v_nouvelle := not exists (select 1 from public.jeu_collection where user_id = v_uid and artist_id = c.artist_id);
    v_nv_holo := v_holo and not exists (select 1 from public.jeu_collection where user_id = v_uid and artist_id = c.artist_id and holo);

    insert into public.jeu_collection (user_id, artist_id, holo, quantite) values (v_uid, c.artist_id, v_holo, 1)
    on conflict (user_id, artist_id, holo) do update set quantite = public.jeu_collection.quantite + 1
    returning quantite into v_qte;

    if c.rarete >= 2 then v_rare_plus := true; v_nb_rare := v_nb_rare + 1; end if;
    if c.rarete >= 3 then v_nb_epique := v_nb_epique + 1; end if;
    if v_holo then v_nb_holo := v_nb_holo + 1; end if;

    v_xp := v_xp + 1 + case c.rarete when 3 then 3 when 4 then 10 when 5 then 40 else 0 end + case when v_holo then 20 else 0 end;

    v_cartes := v_cartes || (public.jeu_carte_json(c, v_holo, v_qte) || jsonb_build_object('nouvelle', v_nouvelle, 'nouveau_holo', v_nv_holo));
  end loop;

  -- Niveaux gagnés : un petit cadeau à chaque niveau.
  v_niv := j.niveau;
  while j.xp + v_xp >= public.jeu_xp_seuil(v_niv + 1) loop
    v_niv := v_niv + 1;
    v_bonus_t := v_bonus_t + 3 + v_niv / 2;
    v_bonus_v := v_bonus_v + 10 * v_niv;
    v_niveaux := v_niveaux || jsonb_build_object('niveau', v_niv, 'tirages', 3 + v_niv / 2, 'vinyles', 10 * v_niv);
  end loop;

  update public.jeu_joueurs
     set tirages = tirages - p_n * v_cout + v_bonus_t,
         garantis = garantis - case when p_garanti then 1 else 0 end,
         vinyles = vinyles + v_bonus_v,
         xp = xp + v_xp, niveau = v_niv,
         ouvertures = ouvertures + p_n, holos = holos + v_nb_holo
   where user_id = v_uid;

  insert into public.jeu_jour (user_id, jour, ouvertures, rare_plus, epique_plus, holos)
  values (v_uid, v_jour, p_n, v_nb_rare, v_nb_epique, v_nb_holo)
  on conflict (user_id, jour) do update
    set ouvertures = public.jeu_jour.ouvertures + excluded.ouvertures, rare_plus = public.jeu_jour.rare_plus + excluded.rare_plus,
        epique_plus = public.jeu_jour.epique_plus + excluded.epique_plus, holos = public.jeu_jour.holos + excluded.holos;

  return jsonb_build_object('cartes', v_cartes, 'niveaux', v_niveaux, 'booster', b.id, 'etat', public.jeu_etat_json(v_uid));
end $$;

revoke all on function public.jeu_ouvrir(integer, boolean, text) from public, anon;
grant execute on function public.jeu_ouvrir(integer, boolean, text) to authenticated;
