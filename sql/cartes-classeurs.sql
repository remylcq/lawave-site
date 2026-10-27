-- =====================================================================
-- La Wave — les classeurs : une collection de cartes exclusives par booster
--
-- Chaque booster « collection » a son classeur : ses propres cartes (un artiste peut y être, même s'il est déjà dans
-- le jeu de base), sa propre rareté pour chaque carte, sa propre numérotation et ses propres possessions.
-- Les cartes d'un classeur ne sortent que du booster qui lui correspond.
--
--   jeu_boosters       + classeur (vrai = a son classeur), debut / fin (dates de disponibilité du booster)
--   jeu_booster_cartes les cartes d'un classeur : artiste, numéro, rareté
--   jeu_collection_b   ce que chaque joueur possède dans chaque classeur
--
-- Deux collections au départ :
--   deferlante   Vague Déferlante   permanente, 50 artistes (les plus écoutés), de Commune à Mythique selon le rang
--   glaciale     Vague Glaciale     hiver, jusqu'au 2027-01-31, 40 artistes, holos ×2
-- Les deux boosters d'essai (legendes, nouvelle-vague) sont désactivés. Les artistes et raretés se règlent ensuite
-- dans l'espace équipe (jeu_classeur_equipe_*) : ce fichier ne remplit un classeur que s'il est vide.
--
-- Rien à voir avec sql/boosters.sql (ancienne boutique de coffres). À passer APRÈS sql/cartes-boosters.sql.
-- Retrait : voir la fin du fichier.
-- =====================================================================

alter table public.jeu_boosters
  add column if not exists classeur boolean not null default false,
  add column if not exists debut date,
  add column if not exists fin date;

create table if not exists public.jeu_booster_cartes (
  booster_id text not null references public.jeu_boosters (id) on delete cascade,
  artist_id  uuid not null,
  numero     integer not null,
  rarete     smallint not null check (rarete between 1 and 5),
  primary key (booster_id, artist_id)
);
create index if not exists jeu_booster_cartes_rarete on public.jeu_booster_cartes (booster_id, rarete);

create table if not exists public.jeu_collection_b (
  user_id     uuid not null,
  booster_id  text not null references public.jeu_boosters (id) on delete cascade,
  artist_id   uuid not null,
  holo        boolean not null default false,
  quantite    integer not null default 0,
  premiere_le timestamptz not null default now(),
  primary key (user_id, booster_id, artist_id, holo)
);

alter table public.jeu_booster_cartes enable row level security;   -- aucune règle : tout passe par les fonctions
alter table public.jeu_collection_b enable row level security;

-- ---------------------------------------------------------------------
-- Les boosters
-- ---------------------------------------------------------------------

update public.jeu_boosters set actif = false where id in ('legendes', 'nouvelle-vague');

insert into public.jeu_boosters (id, nom, serie, description, ordre, cout, taux, holo_x, theme, accent, classeur, debut, fin) values
  ('deferlante', 'Vague Déferlante', 'Collection permanente',
   'Les grosses têtes du rap français, de la Commune à la Mythique. Des cartes que tu ne trouves que dans ce booster, rangées dans leur propre classeur.',
   2, 2, array[40, 30, 18, 9, 3]::numeric[], 1, 'deferlante', '#3DD6F5', true, null, null),
  ('glaciale', 'Vague Glaciale', 'Collection d''hiver',
   'L''édition givrée de l''hiver, jusqu''au 31 janvier. Des cartes exclusives dans leur propre classeur, qui ne ressortiront plus après la fonte des neiges.',
   3, 1, array[45, 30, 16, 7, 2]::numeric[], 2, 'glace', '#8FD3FF', true, null, date '2027-01-31')
on conflict (id) do update set
  nom = excluded.nom, serie = excluded.serie, description = excluded.description, ordre = excluded.ordre,
  cout = excluded.cout, taux = excluded.taux, holo_x = excluded.holo_x, theme = excluded.theme, accent = excluded.accent,
  classeur = excluded.classeur, debut = excluded.debut, fin = excluded.fin;

-- Le contenu de départ (rang = nombre de fans) : seulement si le classeur est vide.
insert into public.jeu_booster_cartes (booster_id, artist_id, numero, rarete)
select 'deferlante', t.artist_id, t.rn,
       case when t.rn <= 2 then 5 when t.rn <= 8 then 4 when t.rn <= 20 then 3 when t.rn <= 35 then 2 else 1 end
  from (select c.artist_id, row_number() over (order by c.fans desc, c.numero)::integer as rn from public.jeu_cartes c where c.active) t
 where t.rn <= 50
   and not exists (select 1 from public.jeu_booster_cartes x where x.booster_id = 'deferlante');

insert into public.jeu_booster_cartes (booster_id, artist_id, numero, rarete)
select 'glaciale', t.artist_id, t.rn - 24,
       case when t.rn - 24 <= 1 then 5 when t.rn - 24 <= 4 then 4 when t.rn - 24 <= 12 then 3 when t.rn - 24 <= 24 then 2 else 1 end
  from (select c.artist_id, row_number() over (order by c.fans desc, c.numero)::integer as rn from public.jeu_cartes c where c.active) t
 where t.rn between 25 and 64
   and not exists (select 1 from public.jeu_booster_cartes x where x.booster_id = 'glaciale');

-- ---------------------------------------------------------------------
-- La liste des boosters du carrousel (dates respectées)
-- ---------------------------------------------------------------------

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
    'holo_x', b.holo_x, 'theme', b.theme, 'accent', b.accent, 'classeur', b.classeur, 'fin', b.fin,
    'nb_cartes', (select count(*) from public.jeu_booster_cartes c where c.booster_id = b.id)
  ) order by b.ordre), '[]'::jsonb)
  from public.jeu_boosters b
  where b.actif and (b.debut is null or b.debut <= public.xp_jour()) and (b.fin is null or b.fin >= public.xp_jour());
$$;

-- ---------------------------------------------------------------------
-- L'ouverture : un booster à classeur tire dans ses propres cartes
-- ---------------------------------------------------------------------

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
  v_rb smallint; v_nb integer; v_id uuid;
  v_cartes jsonb := '[]'::jsonb; v_rare_plus boolean := false;
  v_nb_rare integer := 0; v_nb_epique integer := 0; v_nb_holo integer := 0; v_xp integer := 0;
  v_niv integer; v_niveaux jsonb := '[]'::jsonb; v_bonus_t integer := 0; v_bonus_v integer := 0;
begin
  if v_uid is null then raise exception 'Connecte-toi.'; end if;
  if p_n not in (1, 5, 10) then raise exception 'Quantité inconnue.'; end if;

  select * into b from public.jeu_boosters
   where id = case when p_garanti then 'scene' else coalesce(p_booster, 'scene') end and actif
     and (debut is null or debut <= v_jour) and (fin is null or fin >= v_jour);
  if not found then raise exception 'Ce booster n''est pas disponible.'; end if;
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

    if b.classeur then
      v_id := null;
      select bc.artist_id into v_id from public.jeu_booster_cartes bc join public.jeu_cartes jc on jc.artist_id = bc.artist_id and jc.active
       where bc.booster_id = b.id and bc.rarete = v_tier order by random() limit 1;
      if v_id is null then
        select bc.artist_id into v_id from public.jeu_booster_cartes bc join public.jeu_cartes jc on jc.artist_id = bc.artist_id and jc.active
         where bc.booster_id = b.id and bc.rarete <= v_tier order by bc.rarete desc, random() limit 1;
      end if;
      if v_id is null then
        select bc.artist_id into v_id from public.jeu_booster_cartes bc join public.jeu_cartes jc on jc.artist_id = bc.artist_id and jc.active
         where bc.booster_id = b.id order by bc.rarete, random() limit 1;
      end if;
      if v_id is null then raise exception 'Ce classeur est vide pour le moment.'; end if;
      select * into c from public.jeu_cartes where artist_id = v_id;
      select bc.rarete, bc.numero into v_rb, v_nb from public.jeu_booster_cartes bc where bc.booster_id = b.id and bc.artist_id = v_id;
      c.rarete := v_rb; c.numero := v_nb;
    else
      select * into c from public.jeu_cartes where active and rarete = v_tier order by random() limit 1;
      if not found then
        select * into c from public.jeu_cartes where active and rarete <= v_tier order by rarete desc, random() limit 1;
      end if;
      if not found then raise exception 'Aucune carte disponible pour le moment.'; end if;
    end if;

    v_holo := random() < v_holo_p;

    if b.classeur then
      v_nouvelle := not exists (select 1 from public.jeu_collection_b where user_id = v_uid and booster_id = b.id and artist_id = c.artist_id and quantite > 0);
      v_nv_holo := v_holo and not exists (select 1 from public.jeu_collection_b where user_id = v_uid and booster_id = b.id and artist_id = c.artist_id and holo and quantite > 0);
      insert into public.jeu_collection_b (user_id, booster_id, artist_id, holo, quantite) values (v_uid, b.id, c.artist_id, v_holo, 1)
      on conflict (user_id, booster_id, artist_id, holo) do update set quantite = public.jeu_collection_b.quantite + 1
      returning quantite into v_qte;
    else
      v_nouvelle := not exists (select 1 from public.jeu_collection where user_id = v_uid and artist_id = c.artist_id);
      v_nv_holo := v_holo and not exists (select 1 from public.jeu_collection where user_id = v_uid and artist_id = c.artist_id and holo);
      insert into public.jeu_collection (user_id, artist_id, holo, quantite) values (v_uid, c.artist_id, v_holo, 1)
      on conflict (user_id, artist_id, holo) do update set quantite = public.jeu_collection.quantite + 1
      returning quantite into v_qte;
    end if;

    if c.rarete >= 2 then v_rare_plus := true; v_nb_rare := v_nb_rare + 1; end if;
    if c.rarete >= 3 then v_nb_epique := v_nb_epique + 1; end if;
    if v_holo then v_nb_holo := v_nb_holo + 1; end if;

    v_xp := v_xp + 1 + case c.rarete when 3 then 3 when 4 then 10 when 5 then 40 else 0 end + case when v_holo then 20 else 0 end;

    v_cartes := v_cartes || (public.jeu_carte_json(c, v_holo, v_qte)
      || jsonb_build_object('nouvelle', v_nouvelle, 'nouveau_holo', v_nv_holo, 'classeur', case when b.classeur then b.id end));
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

-- ---------------------------------------------------------------------
-- Lire les classeurs
-- ---------------------------------------------------------------------

-- Une carte de classeur : la carte de l'artiste, avec la rareté et le numéro du classeur.
create or replace function public.jeu_carte_json_b(c public.jeu_cartes, p_booster text, p_rarete integer, p_numero integer, p_holo boolean, p_quantite integer)
returns jsonb
language sql
immutable
set search_path = public, extensions, pg_temp
as $$
  select public.jeu_carte_json(c, p_holo, p_quantite) || jsonb_build_object('rarete', p_rarete, 'numero', p_numero, 'classeur', p_booster)
$$;

-- Les classeurs du joueur : un par booster à classeur (les collections terminées restent consultables).
create or replace function public.jeu_classeurs()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return null; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', b.id, 'nom', b.nom, 'theme', b.theme, 'accent', b.accent, 'fin', b.fin,
      'total', (select count(*) from public.jeu_booster_cartes bc join public.jeu_cartes jc on jc.artist_id = bc.artist_id and jc.active where bc.booster_id = b.id),
      'possedees', (select count(distinct col.artist_id) from public.jeu_collection_b col where col.user_id = v_uid and col.booster_id = b.id and col.quantite > 0)
    ) order by b.ordre)
    from public.jeu_boosters b where b.classeur and b.actif), '[]'::jsonb);
end $$;

create or replace function public.jeu_classeur_lire(
  p_booster text, p_page integer default 1, p_vue text default 'toutes', p_rarete integer default null, p_q text default null, p_tri text default 'numero')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid(); v_taille constant integer := 60; v_total integer; v_liste jsonb;
  v_q text := nullif(public.norme_artiste(p_q), ''); v_page integer := greatest(coalesce(p_page, 1), 1);
begin
  if v_uid is null then return null; end if;
  if not exists (select 1 from public.jeu_boosters where id = p_booster and classeur and actif) then raise exception 'Classeur introuvable.'; end if;

  with possede as (
    select artist_id,
           coalesce(sum(quantite) filter (where not holo), 0)::integer as normales,
           coalesce(sum(quantite) filter (where holo), 0)::integer as holos,
           min(premiere_le) as premiere_le
      from public.jeu_collection_b where user_id = v_uid and booster_id = p_booster and quantite > 0 group by artist_id
  ), cartes as (
    select c, bc.rarete as rb, bc.numero as nb, coalesce(p.normales, 0) as normales, coalesce(p.holos, 0) as holos, p.premiere_le
      from public.jeu_booster_cartes bc
      join public.jeu_cartes c on c.artist_id = bc.artist_id and c.active
      left join possede p on p.artist_id = bc.artist_id
     where bc.booster_id = p_booster
       and (p_rarete is null or bc.rarete = p_rarete)
       and (v_q is null or public.norme_artiste(c.nom) like '%' || v_q || '%')
  ), filtre as (
    select * from cartes x
     where case coalesce(p_vue, 'toutes')
             when 'possedees'  then x.normales + x.holos > 0
             when 'manquantes' then x.normales + x.holos = 0
             when 'doublons'   then x.normales > 1 or x.holos > 1
             when 'holos'      then x.holos > 0
             else true end
  ), page as (
    select x.*, row_number() over (
             order by case when p_tri = 'rarete' then x.rb end desc nulls last,
                      case when p_tri = 'fans' then (x.c).fans end desc nulls last,
                      case when p_tri = 'nom' then lower((x.c).nom) end asc nulls last,
                      case when p_tri = 'recent' then x.premiere_le end desc nulls last,
                      x.nb) as ord
      from filtre x
     order by ord
     limit v_taille offset (v_page - 1) * v_taille
  )
  select (select count(*) from filtre),
         coalesce((select jsonb_agg(public.jeu_carte_json_b(x.c, p_booster, x.rb, x.nb, x.holos > 0, x.normales + x.holos)
                                    || jsonb_build_object('normales', x.normales, 'holos', x.holos) order by x.ord)
                     from page x), '[]'::jsonb)
    into v_total, v_liste;

  return jsonb_build_object(
    'total', v_total, 'page', v_page, 'pages', greatest(1, ceil(v_total::numeric / v_taille)::integer),
    'cartes', v_liste,
    'raretes', (select jsonb_agg(jsonb_build_object('rarete', r.rarete, 'total', r.total, 'possedees', r.possedees) order by r.rarete)
                  from (select bc.rarete, count(*)::integer as total,
                               count(*) filter (where exists (select 1 from public.jeu_collection_b col
                                                               where col.user_id = v_uid and col.booster_id = p_booster and col.artist_id = bc.artist_id and col.quantite > 0))::integer as possedees
                          from public.jeu_booster_cartes bc join public.jeu_cartes jc on jc.artist_id = bc.artist_id and jc.active
                         where bc.booster_id = p_booster group by bc.rarete) r),
    'doublons', 0, 'valeur_doublons', 0);
end $$;

-- La fiche d'une carte de classeur.
create or replace function public.jeu_classeur_carte(p_booster text, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid(); bc public.jeu_booster_cartes; v_n integer; v_h integer;
begin
  if v_uid is null then return null; end if;
  select * into bc from public.jeu_booster_cartes where booster_id = p_booster and artist_id = p_id;
  if not found then raise exception 'Carte introuvable.'; end if;
  select coalesce(sum(quantite) filter (where not holo), 0), coalesce(sum(quantite) filter (where holo), 0)
    into v_n, v_h from public.jeu_collection_b where user_id = v_uid and booster_id = p_booster and artist_id = p_id;
  return public.jeu_carte(p_id) || jsonb_build_object(
    'rarete', bc.rarete, 'numero', bc.numero, 'classeur', p_booster,
    'quantite', v_n + v_h, 'normales', v_n, 'holos', v_h, 'holo', v_h > 0);
end $$;

-- ---------------------------------------------------------------------
-- L'espace équipe : choisir les artistes d'un classeur et leur rareté
-- ---------------------------------------------------------------------

create or replace function public.jeu_classeur_equipe_lire(p_booster text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.est_equipe() then raise exception 'Réservé à l''équipe.'; end if;
  return jsonb_build_object(
    'classeurs', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'nom', b.nom, 'nb', (select count(*) from public.jeu_booster_cartes x where x.booster_id = b.id)) order by b.ordre)
                             from public.jeu_boosters b where b.classeur), '[]'::jsonb),
    'cartes', coalesce((select jsonb_agg(jsonb_build_object('artist_id', bc.artist_id, 'numero', bc.numero, 'rarete', bc.rarete, 'nom', c.nom, 'photo', c.photo, 'fans', c.fans) order by bc.numero)
                          from public.jeu_booster_cartes bc left join public.jeu_cartes c on c.artist_id = bc.artist_id
                         where bc.booster_id = p_booster), '[]'::jsonb));
end $$;

-- Ajouter un artiste, changer sa rareté, ou le retirer (p_rarete nul).
create or replace function public.jeu_classeur_equipe_regler(p_booster text, p_artist uuid, p_rarete integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_num integer;
begin
  if not public.est_equipe() then raise exception 'Réservé à l''équipe.'; end if;
  if not exists (select 1 from public.jeu_boosters where id = p_booster and classeur) then raise exception 'Classeur introuvable.'; end if;

  if p_rarete is null then
    delete from public.jeu_booster_cartes where booster_id = p_booster and artist_id = p_artist;
  else
    if p_rarete not between 1 and 5 then raise exception 'Rareté inconnue.'; end if;
    if not exists (select 1 from public.jeu_cartes where artist_id = p_artist and active) then raise exception 'Cet artiste n''a pas de carte dans le jeu.'; end if;
    select coalesce(max(numero), 0) + 1 into v_num from public.jeu_booster_cartes where booster_id = p_booster;
    insert into public.jeu_booster_cartes (booster_id, artist_id, numero, rarete) values (p_booster, p_artist, v_num, p_rarete)
    on conflict (booster_id, artist_id) do update set rarete = excluded.rarete;
  end if;
  return public.jeu_classeur_equipe_lire(p_booster);
end $$;

create or replace function public.jeu_classeur_equipe_chercher(p_q text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_q text := nullif(public.norme_artiste(p_q), '');
begin
  if not public.est_equipe() then raise exception 'Réservé à l''équipe.'; end if;
  if v_q is null then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('artist_id', t.artist_id, 'nom', t.nom, 'photo', t.photo, 'fans', t.fans))
                     from (select c.artist_id, c.nom, c.photo, c.fans from public.jeu_cartes c
                            where c.active and public.norme_artiste(c.nom) like '%' || v_q || '%' order by c.fans desc limit 8) t), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------
-- Droits : joueurs connectés pour la lecture et l'ouverture, équipe vérifiée dans les fonctions
-- ---------------------------------------------------------------------

revoke all on function public.jeu_boosters(), public.jeu_ouvrir(integer, boolean, text), public.jeu_classeurs(),
  public.jeu_classeur_lire(text, integer, text, integer, text, text), public.jeu_classeur_carte(text, uuid),
  public.jeu_classeur_equipe_lire(text), public.jeu_classeur_equipe_regler(text, uuid, integer), public.jeu_classeur_equipe_chercher(text),
  public.jeu_carte_json_b(public.jeu_cartes, text, integer, integer, boolean, integer) from public, anon;
grant execute on function public.jeu_boosters(), public.jeu_ouvrir(integer, boolean, text), public.jeu_classeurs(),
  public.jeu_classeur_lire(text, integer, text, integer, text, text), public.jeu_classeur_carte(text, uuid),
  public.jeu_classeur_equipe_lire(text), public.jeu_classeur_equipe_regler(text, uuid, integer), public.jeu_classeur_equipe_chercher(text),
  public.jeu_carte_json_b(public.jeu_cartes, text, integer, integer, boolean, integer) to authenticated;

-- Retrait : drop function public.jeu_classeur_equipe_chercher(text), public.jeu_classeur_equipe_regler(text, uuid, integer),
--   public.jeu_classeur_equipe_lire(text), public.jeu_classeur_carte(text, uuid), public.jeu_classeur_lire(text, integer, text, integer, text, text),
--   public.jeu_classeurs(), public.jeu_carte_json_b(public.jeu_cartes, text, integer, integer, boolean, integer);
-- drop table public.jeu_collection_b, public.jeu_booster_cartes; alter table public.jeu_boosters drop column classeur, drop column debut, drop column fin;
-- puis remettre jeu_boosters() et jeu_ouvrir(integer, boolean, text) de sql/cartes-boosters.sql.
