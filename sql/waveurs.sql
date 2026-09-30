-- =====================================================================
-- La Wave — l'espace des waveurs
--
-- La machine à sous de la salle rapporte de l'XP et des pièces, jamais
-- d'argent : aucun tour n'est vendu, et les pièces ne s'achètent pas avec
-- de l'argent, ni ne se convertissent en argent. Elles se gagnent en jouant
-- et se dépensent chez le croupier, en boosters de cartes La Wave TCG.
-- C'est la règle du jeu, et la limite à ne pas franchir.
--
-- Quatre principes tiennent tout le fichier :
--
--   1. le tirage se fait ici, en base. Les rouleaux du navigateur ne
--      font qu'illustrer un résultat déjà décidé : personne ne peut
--      choisir son gain, ni rejouer un tirage qui lui déplaît ;
--   2. le nombre de tours par jour est compté ici aussi. Le navigateur
--      affiche ce compteur, il ne le tient pas ;
--   3. les pièces et les boosters sont dans un portefeuille que personne
--      ne peut écrire depuis le navigateur : les pièces n'y entrent que
--      par un tirage, n'en sortent que par un achat, et un achat ne passe
--      que si le solde suffit ;
--   4. tout ce qui se règle (nombre de tours, prix d'un booster, gains,
--      probabilités) est dans une table modifiable depuis l'éditeur de
--      tables de Supabase, sans toucher au code ni relancer ce fichier.
--
-- À exécuter dans Supabase → SQL Editor, d'un seul bloc. Sans danger si
-- on le relance : rien n'est écrasé, et une installation déjà en service
-- reçoit les pièces et la boutique sans perdre ses tours ni ses gains.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Les réglages
--
-- Une ligne par réglage. Pour donner 15 tours par jour au lieu de 10 :
-- Table Editor → waveurs_reglages → changer la valeur. Pas de code.
-- ---------------------------------------------------------------------

create table if not exists public.waveurs_reglages (
  cle         text primary key,
  valeur      integer not null,
  description text
);

insert into public.waveurs_reglages (cle, valeur, description) values
  ('tours_par_jour', 10,
   'Nombre de tours offerts à chaque membre, chaque jour. Remise à zéro à minuit, heure de Paris.'),
  ('prix_booster', 60,
   'Prix d''un booster La Wave TCG chez le croupier, en pièces. Les valeurs de départ des gains donnent environ 56 pièces par jour de dix tours.')
on conflict (cle) do nothing;


-- ---------------------------------------------------------------------
-- 2. Les gains
--
-- Chaque ligne est une issue possible d'un tour. Le tirage choisit une
-- ligne au hasard, en proportion de son poids : un poids de 3 000
-- contre un total de 10 000 donne 3 chances sur 10.
--
--   motif   : 'rien'  aucun gain, trois symboles tous différents
--             'paire' deux symboles identiques et un autre
--             'trio'  trois symboles identiques
--   symbole : le symbole concerné (vague, poisson, coquillage, ancre,
--             bulle, perle, logo). Vide, il est tiré au hasard parmi
--             les cinq symboles courants.
--   poids   : probabilité relative
--   xp      : XP gagnée
--   pieces  : pièces gagnées, en plus de l'XP
--   actif   : décocher pour retirer une ligne du jeu sans la supprimer
--
-- Les valeurs de départ donnent environ 2 XP et 5,6 pièces par tour : 20 XP
-- et 56 pièces par jour pour dix tours. L'XP, c'est l'équivalent de quatre
-- défis quotidiens (un niveau se fait à 100 XP ; un jackpot en vaut plus de
-- la moitié). Les pièces, c'est à peu près un booster par jour au prix de
-- départ (60 pièces, réglage prix_booster).
-- ---------------------------------------------------------------------

create table if not exists public.waveurs_gains (
  id      serial primary key,
  nom     text not null,
  motif   text not null check (motif in ('rien', 'paire', 'trio')),
  symbole text check (symbole in ('vague', 'poisson', 'coquillage', 'ancre', 'bulle', 'perle', 'logo')),
  poids   integer not null check (poids >= 0),
  xp      integer not null default 0 check (xp >= 0),
  pieces  integer not null default 0 check (pieces >= 0),
  actif   boolean not null default true,
  check (motif <> 'rien' or symbole is null)
);

-- Une installation d'avant les pièces n'a pas cette colonne : on l'ajoute,
-- et on pose les pièces de départ dans le même geste, une seule fois. Le
-- test porte sur l'existence de la colonne, pas sur les valeurs : mettre
-- toutes les pièces à zéro à la main (pour geler l'économie, par exemple)
-- puis relancer le fichier ne les rétablit pas.
do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'waveurs_gains'
      and column_name  = 'pieces'
  ) then

    alter table public.waveurs_gains
      add column pieces integer not null default 0 check (pieces >= 0);

    update public.waveurs_gains g
       set pieces = v.pieces
      from (values
        ('Pas cette fois',         0),
        ('Une paire',              3),
        ('Trois identiques',      12),
        ('Deux logos La Wave',    20),
        ('Trois perles',          40),
        ('Trois logos — jackpot', 200)
      ) as v(nom, pieces)
     where g.nom = v.nom;

  end if;
end $$;

-- Les lignes de départ ne sont posées qu'une fois : relancer le fichier
-- après avoir réglé les gains à sa main ne les remet pas à zéro.
insert into public.waveurs_gains (nom, motif, symbole, poids, xp, pieces)
select v.nom, v.motif, v.symbole, v.poids, v.xp, v.pieces
from (values
  ('Pas cette fois',       'rien',  null::text, 5500,  0,   0),
  ('Une paire',            'paire', null::text, 3000,  1,   3),
  ('Trois identiques',     'trio',  null::text, 1000,  5,  12),
  ('Deux logos La Wave',   'paire', 'logo',       50, 10,  20),
  ('Trois perles',         'trio',  'perle',     350, 15,  40),
  ('Trois logos — jackpot','trio',  'logo',      100, 60, 200)
) as v(nom, motif, symbole, poids, xp, pieces)
where not exists (select 1 from public.waveurs_gains);


-- ---------------------------------------------------------------------
-- 3. Le journal des tours
--
-- Une ligne par tour. Il sert à compter les tours du jour, à retrouver
-- ce qui s'est passé si un membre conteste un gain, et à suivre le jeu
-- (voir les requêtes en bas de fichier).
-- ---------------------------------------------------------------------

create table if not exists public.waveurs_tours (
  id        bigserial primary key,
  user_id   uuid not null references auth.users(id) on delete cascade,
  machine   text not null,
  gain_nom  text not null,
  motif     text not null,
  symboles  text[] not null,
  xp        integer not null,
  pieces    integer not null default 0,
  cree_le   timestamptz not null default now()
);

alter table public.waveurs_tours
  add column if not exists pieces integer not null default 0;

create index if not exists waveurs_tours_user_idx
  on public.waveurs_tours (user_id, cree_le desc);


-- ---------------------------------------------------------------------
-- 3 bis. Le portefeuille et le journal des achats
--
-- Une ligne par membre : ses pièces et ses boosters en attente d'être
-- ouverts. Elle n'est jamais écrite depuis le navigateur (voir les règles
-- d'accès plus bas) : waveurs_tourner y verse des pièces, et
-- waveurs_acheter_booster en retire pour ajouter des boosters. Les deux
-- colonnes ne peuvent pas descendre sous zéro, quoi qu'il arrive.
--
-- Le journal des achats garde une trace de chaque passage en caisse.
-- ---------------------------------------------------------------------

create table if not exists public.waveurs_portefeuille (
  user_id  uuid primary key references auth.users(id) on delete cascade,
  pieces   integer not null default 0 check (pieces >= 0),
  boosters integer not null default 0 check (boosters >= 0),
  maj      timestamptz not null default now()
);

create table if not exists public.waveurs_achats (
  id            bigserial primary key,
  user_id       uuid not null references auth.users(id) on delete cascade,
  quantite      integer not null check (quantite > 0),
  prix_unitaire integer not null check (prix_unitaire > 0),
  cree_le       timestamptz not null default now()
);

create index if not exists waveurs_achats_user_idx
  on public.waveurs_achats (user_id, cree_le desc);


-- ---------------------------------------------------------------------
-- 4. Règles d'accès
--
-- Les gains sont publics : la salle affiche la table des combinaisons,
-- et cacher ce que rapporte une machine n'aurait aucun sens. Le journal,
-- le portefeuille et les achats, eux, ne sont lisibles que par leur
-- propriétaire et par l'équipe. Personne n'écrit dans ces tables depuis le
-- navigateur, pas même l'équipe pour le portefeuille : seules les
-- fonctions ci-dessous le font.
-- ---------------------------------------------------------------------

alter table public.waveurs_reglages    enable row level security;
alter table public.waveurs_gains       enable row level security;
alter table public.waveurs_tours       enable row level security;
alter table public.waveurs_portefeuille enable row level security;
alter table public.waveurs_achats      enable row level security;

drop policy if exists "reglages lisibles"          on public.waveurs_reglages;
drop policy if exists "reglages ecrits par equipe" on public.waveurs_reglages;
drop policy if exists "gains lisibles"             on public.waveurs_gains;
drop policy if exists "gains ecrits par equipe"    on public.waveurs_gains;
drop policy if exists "tours visibles"             on public.waveurs_tours;
drop policy if exists "portefeuille visible"       on public.waveurs_portefeuille;
drop policy if exists "achats visibles"            on public.waveurs_achats;

create policy "reglages lisibles"
on public.waveurs_reglages for select
to anon, authenticated
using (true);

create policy "reglages ecrits par equipe"
on public.waveurs_reglages for all
to authenticated
using (public.est_equipe())
with check (public.est_equipe());

create policy "gains lisibles"
on public.waveurs_gains for select
to anon, authenticated
using (actif);

create policy "gains ecrits par equipe"
on public.waveurs_gains for all
to authenticated
using (public.est_equipe())
with check (public.est_equipe());

create policy "tours visibles"
on public.waveurs_tours for select
to authenticated
using (user_id = auth.uid() or public.est_equipe());

create policy "portefeuille visible"
on public.waveurs_portefeuille for select
to authenticated
using (user_id = auth.uid() or public.est_equipe());

create policy "achats visibles"
on public.waveurs_achats for select
to authenticated
using (user_id = auth.uid() or public.est_equipe());

-- Aucune règle d'écriture n'existe pour ces deux tables : sans elle, RLS
-- refuse tout. On retire en plus les droits d'écriture eux-mêmes, que
-- Supabase accorde par défaut : une règle ajoutée par erreur plus tard ne
-- suffirait pas à ouvrir le portefeuille.
revoke insert, update, delete, truncate on public.waveurs_portefeuille from anon, authenticated;
revoke insert, update, delete, truncate on public.waveurs_achats       from anon, authenticated;
-- Le journal des tours porte le compteur quotidien : il n'est écrit que par
-- waveurs_tourner, même précaution.
revoke insert, update, delete, truncate on public.waveurs_tours        from anon, authenticated;
revoke all on public.waveurs_portefeuille from anon;
revoke all on public.waveurs_achats       from anon;


-- ---------------------------------------------------------------------
-- 5. Où en est un membre
--
-- Appelée à l'ouverture de la salle : combien de tours restent, combien
-- d'XP et de pièces il a gagné aujourd'hui, ce qu'il a en poche, et le
-- prix d'un booster.
--
-- « Aujourd'hui » commence à minuit à Paris, et non à minuit UTC : un
-- tour joué à 1 h du matin l'été compte pour le jour qui commence.
-- ---------------------------------------------------------------------

create or replace function public.waveurs_etat()
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_debut    timestamptz;
  v_limite   integer;
  v_utilises integer;
  v_gagne    integer;
  v_pieces_j integer;
  v_pieces   integer;
  v_boosters integer;
  v_prix     integer;
begin

  if auth.uid() is null then
    raise exception 'Connecte-toi pour jouer.';
  end if;

  v_debut := (date_trunc('day', now() at time zone 'Europe/Paris')) at time zone 'Europe/Paris';

  select coalesce((select valeur from public.waveurs_reglages where cle = 'tours_par_jour'), 10)
    into v_limite;

  select coalesce((select valeur from public.waveurs_reglages where cle = 'prix_booster'), 60)
    into v_prix;

  select count(*), coalesce(sum(xp), 0), coalesce(sum(pieces), 0)
    into v_utilises, v_gagne, v_pieces_j
  from public.waveurs_tours
  where user_id = auth.uid() and cree_le >= v_debut;

  -- Pas encore de portefeuille : rien en poche, rien n'est créé pour autant.
  select coalesce(max(w.pieces), 0), coalesce(max(w.boosters), 0)
    into v_pieces, v_boosters
  from public.waveurs_portefeuille w
  where w.user_id = auth.uid();

  return json_build_object(
    'tours_par_jour',    v_limite,
    'tours_restants',    greatest(v_limite - v_utilises, 0),
    'gagne_aujourdhui',  v_gagne,
    'pieces_aujourdhui', v_pieces_j,
    'pieces',            v_pieces,
    'boosters',          v_boosters,
    'prix_booster',      v_prix
  );
end $$;


-- ---------------------------------------------------------------------
-- 6. Tirer le levier
--
-- La ligne de la table profiles est verrouillée pour la durée de
-- l'appel : deux tours lancés au même instant par le même membre (deux
-- onglets, un double clic) passent l'un après l'autre, et le second voit
-- le tour du premier dans son décompte. Sans ce verrou, on pourrait
-- dépasser la limite quotidienne en jouant en parallèle.
--
-- La fonction renvoie les trois symboles à afficher et le gain. Le
-- navigateur anime les rouleaux vers ces symboles ; il n'a aucun moyen
-- d'en influencer le choix.
-- ---------------------------------------------------------------------

create or replace function public.waveurs_tourner(p_machine text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  c_tous    constant text[] := array['vague','poisson','coquillage','ancre','bulle','perle','logo'];
  c_communs constant text[] := array['vague','poisson','coquillage','ancre','bulle'];

  v_debut    timestamptz;
  v_limite   integer;
  v_utilises integer;
  v_xp       integer;
  v_total    integer;
  v_pieces   integer;
  v_tirage   integer;
  -- Un « record » et non un %rowtype : l'ordre des colonnes de waveurs_gains
  -- n'est pas le même sur une installation neuve et sur une installation
  -- à laquelle la colonne pieces a été ajoutée après coup, et une lecture
  -- par position s'y tromperait.
  v_gain     record;
  v_symboles text[];
  v_paire    text;
  v_autre    text;
  v_place    integer;
begin

  if auth.uid() is null then
    raise exception 'Connecte-toi pour jouer.';
  end if;

  if coalesce(trim(p_machine), '') = '' or length(p_machine) > 40 then
    raise exception 'Machine inconnue.';
  end if;

  -- Verrou : voir plus haut.
  select coalesce(p.xp, 0) into v_xp
  from public.profiles p
  where p.id = auth.uid()
  for update;

  if not found then
    raise exception 'Ton profil est introuvable : reconnecte-toi.';
  end if;

  -- Un tour par seconde au plus : le navigateur en met trois ou quatre à
  -- animer un, ce garde-fou ne sert qu'à contrer un script.
  if exists (
    select 1 from public.waveurs_tours
    where user_id = auth.uid() and cree_le > now() - interval '1 second'
  ) then
    raise exception 'Doucement : laisse les rouleaux s''arrêter.';
  end if;

  v_debut := (date_trunc('day', now() at time zone 'Europe/Paris')) at time zone 'Europe/Paris';

  select coalesce((select valeur from public.waveurs_reglages where cle = 'tours_par_jour'), 10)
    into v_limite;

  select count(*) into v_utilises
  from public.waveurs_tours
  where user_id = auth.uid() and cree_le >= v_debut;

  if v_utilises >= v_limite then
    raise exception 'Plus de tours aujourd''hui : reviens demain.';
  end if;

  -- Le tirage : un entier de 0 au poids total moins un, puis la ligne où
  -- le cumul des poids dépasse cet entier.
  select coalesce(sum(poids), 0) into v_tirage
  from public.waveurs_gains
  where actif and poids > 0;

  if v_tirage = 0 then
    raise exception 'Les machines sont en panne : reviens plus tard.';
  end if;

  v_tirage := floor(random() * v_tirage)::integer;

  select t.id, t.nom, t.motif, t.symbole, t.poids, t.xp, t.pieces
    into v_gain
  from (
    select g.*, sum(g.poids) over (order by g.id) as cumul
    from public.waveurs_gains g
    where g.actif and g.poids > 0
  ) t
  where t.cumul > v_tirage
  order by t.id
  limit 1;

  if not found then
    raise exception 'Les machines sont en panne : reviens plus tard.';
  end if;

  -- Les trois symboles qui illustrent l'issue.
  if v_gain.motif = 'trio' then

    v_paire := coalesce(v_gain.symbole, c_communs[1 + floor(random() * array_length(c_communs, 1))::integer]);
    v_symboles := array[v_paire, v_paire, v_paire];

  elsif v_gain.motif = 'paire' then

    v_paire := coalesce(v_gain.symbole, c_communs[1 + floor(random() * array_length(c_communs, 1))::integer]);

    select s into v_autre
    from unnest(c_tous) as s
    where s <> v_paire
    order by random()
    limit 1;

    -- Le symbole isolé tombe sur l'un des trois rouleaux, au hasard.
    v_place := 1 + floor(random() * 3)::integer;
    v_symboles := array[v_paire, v_paire, v_paire];
    v_symboles[v_place] := v_autre;

  else

    -- Trois symboles tous différents : jamais un gain.
    select array_agg(s) into v_symboles
    from (
      select s from unnest(c_tous) as s order by random() limit 3
    ) t;

  end if;

  update public.profiles
     set xp = v_xp + v_gain.xp
   where id = auth.uid();

  -- Les pièces vont au portefeuille, créé au premier gain. Un tour qui ne
  -- rapporte aucune pièce y passe aussi, pour renvoyer le solde à jour.
  insert into public.waveurs_portefeuille as w (user_id, pieces)
  values (auth.uid(), v_gain.pieces)
  on conflict (user_id) do update
     set pieces = w.pieces + excluded.pieces,
         maj    = now()
  returning w.pieces into v_pieces;

  insert into public.waveurs_tours (user_id, machine, gain_nom, motif, symboles, xp, pieces)
  values (auth.uid(), trim(p_machine), v_gain.nom, v_gain.motif, v_symboles, v_gain.xp, v_gain.pieces);

  v_total := v_xp + v_gain.xp;

  return json_build_object(
    'symboles',        to_json(v_symboles),
    'gain',            v_gain.xp,
    'pieces',          v_gain.pieces,
    'nom',             v_gain.nom,
    'motif',           v_gain.motif,
    'symbole',         v_gain.symbole,
    'xp_total',        v_total,
    'pieces_total',    v_pieces,
    'tours_restants',  v_limite - v_utilises - 1,
    'tours_par_jour',  v_limite
  );
end $$;


-- ---------------------------------------------------------------------
-- 6 bis. Acheter des boosters chez le croupier
--
-- Les pièces gagnées à la machine se dépensent ici, et seulement ici. Le
-- prix est celui du réglage prix_booster ; le navigateur affiche ce prix,
-- il ne le fixe pas.
--
-- La ligne du portefeuille est verrouillée pour la durée de l'appel : deux
-- achats lancés au même instant (deux onglets, un double clic) passent
-- l'un après l'autre, et le second voit le solde laissé par le premier.
-- Sans ce verrou, on pourrait dépenser deux fois les mêmes pièces.
--
-- Les boosters achetés s'ajoutent au stock du membre ; leur ouverture
-- viendra avec les cartes.
-- ---------------------------------------------------------------------

create or replace function public.waveurs_acheter_booster(p_quantite integer default 1)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prix     integer;
  v_cout     integer;
  v_pieces   integer;
  v_boosters integer;
begin

  if auth.uid() is null then
    raise exception 'Connecte-toi pour acheter.';
  end if;

  if p_quantite is null or p_quantite < 1 or p_quantite > 10 then
    raise exception 'Quantité invalide : de 1 à 10 boosters à la fois.';
  end if;

  select coalesce((select valeur from public.waveurs_reglages where cle = 'prix_booster'), 60)
    into v_prix;

  -- Un prix nul ou négatif est une erreur de réglage, pas une distribution
  -- gratuite : la caisse reste fermée.
  if v_prix < 1 then
    raise exception 'Le croupier a fermé sa caisse : reviens plus tard.';
  end if;

  v_cout := v_prix * p_quantite;

  -- Le portefeuille existe avant d'être verrouillé.
  insert into public.waveurs_portefeuille (user_id)
  values (auth.uid())
  on conflict (user_id) do nothing;

  select w.pieces into v_pieces
  from public.waveurs_portefeuille w
  where w.user_id = auth.uid()
  for update;

  if v_pieces < v_cout then
    raise exception 'Pas assez de pièces : il t''en faut %, tu en as %.', v_cout, v_pieces;
  end if;

  update public.waveurs_portefeuille
     set pieces   = pieces - v_cout,
         boosters = boosters + p_quantite,
         maj      = now()
   where user_id = auth.uid()
  returning pieces, boosters into v_pieces, v_boosters;

  insert into public.waveurs_achats (user_id, quantite, prix_unitaire)
  values (auth.uid(), p_quantite, v_prix);

  return json_build_object(
    'quantite',       p_quantite,
    'prix_unitaire',  v_prix,
    'pieces_total',   v_pieces,
    'boosters_total', v_boosters
  );
end $$;


-- ---------------------------------------------------------------------
-- 7. Qui peut appeler quoi
--
-- Seuls les comptes connectés jouent et achètent. Les visiteurs se
-- promènent dans la salle et parlent au croupier sans pouvoir tirer le
-- levier ni rien acheter.
-- ---------------------------------------------------------------------

-- Supabase accorde par défaut l'exécution des fonctions aux visiteurs
-- anonymes ; « from public » seul ne la retire pas.
revoke all on function public.waveurs_etat() from public, anon;
revoke all on function public.waveurs_tourner(text) from public, anon;
revoke all on function public.waveurs_acheter_booster(integer) from public, anon;

grant execute on function public.waveurs_etat() to authenticated;
grant execute on function public.waveurs_tourner(text) to authenticated;
grant execute on function public.waveurs_acheter_booster(integer) to authenticated;


-- ---------------------------------------------------------------------
-- 8. Vérification
--
-- La première requête doit lister les cinq tables avec RLS activée, la
-- deuxième les trois fonctions, la troisième les six gains de départ, la
-- quatrième les droits d'écriture sur le portefeuille, les achats et les
-- tours (aucune ligne : ni les visiteurs ni les membres ne peuvent y
-- écrire). La dernière donne le gain moyen par tour : autour de 2 XP et de
-- 5,6 pièces.
-- ---------------------------------------------------------------------

select relname as table_name, relrowsecurity as rls_active
from pg_class
where relname in ('waveurs_reglages', 'waveurs_gains', 'waveurs_tours',
                  'waveurs_portefeuille', 'waveurs_achats')
order by relname;

select proname as fonction, prosecdef as security_definer
from pg_proc
where pronamespace = 'public'::regnamespace
  and proname in ('waveurs_etat', 'waveurs_tourner', 'waveurs_acheter_booster')
order by proname;

select id, nom, motif, symbole, poids, xp, pieces, actif
from public.waveurs_gains
order by xp desc, id;

select grantee, table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('waveurs_portefeuille', 'waveurs_achats', 'waveurs_tours')
  and grantee in ('anon', 'authenticated')
  and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE');

select round(sum(poids::numeric * xp) / nullif(sum(poids), 0), 2)     as gain_moyen_par_tour_en_xp,
       round(sum(poids::numeric * pieces) / nullif(sum(poids), 0), 2) as gain_moyen_par_tour_en_pieces,
       sum(poids) as poids_total
from public.waveurs_gains
where actif;


-- ---------------------------------------------------------------------
-- Pour suivre le jeu
--
-- À lancer à la demande, pour voir comment la salle est utilisée. Rien
-- ici ne modifie quoi que ce soit.
--
--   -- Activité des sept derniers jours
--   select (cree_le at time zone 'Europe/Paris')::date as jour,
--          count(*)                as tours,
--          count(distinct user_id) as joueurs,
--          sum(xp)                 as xp_distribue
--   from public.waveurs_tours
--   where cree_le > now() - interval '7 days'
--   group by 1 order by 1 desc;
--
--   -- Les jackpots
--   select p.pseudo, t.cree_le, t.xp, t.pieces
--   from public.waveurs_tours t
--   join public.profiles p on p.id = t.user_id
--   where t.motif = 'trio' and 'logo' = all (t.symboles)
--   order by t.cree_le desc;
--
--   -- Pièces distribuées et boosters vendus, jour par jour
--   select j.jour, j.pieces_distribuees, coalesce(a.boosters_vendus, 0) as boosters_vendus
--   from (
--     select (cree_le at time zone 'Europe/Paris')::date as jour, sum(pieces) as pieces_distribuees
--     from public.waveurs_tours
--     where cree_le > now() - interval '14 days'
--     group by 1
--   ) j
--   left join (
--     select (cree_le at time zone 'Europe/Paris')::date as jour, sum(quantite) as boosters_vendus
--     from public.waveurs_achats
--     where cree_le > now() - interval '14 days'
--     group by 1
--   ) a using (jour)
--   order by j.jour desc;
--
--   -- Les plus gros portefeuilles (pour repérer une anomalie)
--   select p.pseudo, w.pieces, w.boosters
--   from public.waveurs_portefeuille w
--   join public.profiles p on p.id = w.user_id
--   order by w.pieces desc, w.boosters desc
--   limit 20;
-- ---------------------------------------------------------------------
