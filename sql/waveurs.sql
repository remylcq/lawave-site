-- =====================================================================
-- La Wave — l'espace des waveurs
--
-- Les machines à sous de la salle rapportent de l'XP, jamais d'argent :
-- rien ne s'achète, aucun tour n'est vendu, aucun gain ne se convertit.
-- C'est la règle du jeu, et la limite à ne pas franchir le jour où les
-- cartes à collectionner arriveront.
--
-- Trois principes tiennent tout le fichier :
--
--   1. le tirage se fait ici, en base. Les rouleaux du navigateur ne
--      font qu'illustrer un résultat déjà décidé : personne ne peut
--      choisir son gain, ni rejouer un tirage qui lui déplaît ;
--   2. le nombre de tours par jour est compté ici aussi. Le navigateur
--      affiche ce compteur, il ne le tient pas ;
--   3. tout ce qui se règle (nombre de tours, gains, probabilités) est
--      dans une table modifiable depuis l'éditeur de tables de Supabase,
--      sans toucher au code ni relancer ce fichier.
--
-- À exécuter dans Supabase → SQL Editor, d'un seul bloc. Sans danger si
-- on le relance : rien n'est écrasé.
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
   'Nombre de tours offerts à chaque membre, chaque jour. Remise à zéro à minuit, heure de Paris.')
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
--   actif   : décocher pour retirer une ligne du jeu sans la supprimer
--
-- Les valeurs de départ donnent environ 2 XP par tour : 20 XP par jour
-- pour dix tours, soit l'équivalent de quatre défis quotidiens. Un
-- niveau se fait à 100 XP ; un jackpot en vaut plus de la moitié.
-- ---------------------------------------------------------------------

create table if not exists public.waveurs_gains (
  id      serial primary key,
  nom     text not null,
  motif   text not null check (motif in ('rien', 'paire', 'trio')),
  symbole text check (symbole in ('vague', 'poisson', 'coquillage', 'ancre', 'bulle', 'perle', 'logo')),
  poids   integer not null check (poids >= 0),
  xp      integer not null default 0 check (xp >= 0),
  actif   boolean not null default true,
  check (motif <> 'rien' or symbole is null)
);

-- Les lignes de départ ne sont posées qu'une fois : relancer le fichier
-- après avoir réglé les gains à sa main ne les remet pas à zéro.
insert into public.waveurs_gains (nom, motif, symbole, poids, xp)
select v.nom, v.motif, v.symbole, v.poids, v.xp
from (values
  ('Pas cette fois',       'rien',  null::text, 5500,  0),
  ('Une paire',            'paire', null::text, 3000,  1),
  ('Trois identiques',     'trio',  null::text, 1000,  5),
  ('Deux logos La Wave',   'paire', 'logo',       50, 10),
  ('Trois perles',         'trio',  'perle',     350, 15),
  ('Trois logos — jackpot','trio',  'logo',      100, 60)
) as v(nom, motif, symbole, poids, xp)
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
  cree_le   timestamptz not null default now()
);

create index if not exists waveurs_tours_user_idx
  on public.waveurs_tours (user_id, cree_le desc);


-- ---------------------------------------------------------------------
-- 4. Règles d'accès
--
-- Les gains sont publics : la salle affiche la table des combinaisons,
-- et cacher ce que rapporte une machine n'aurait aucun sens. Le journal,
-- lui, n'est lisible que par son propriétaire et par l'équipe. Personne
-- n'écrit dans ces tables depuis le navigateur : seules les fonctions
-- ci-dessous le font.
-- ---------------------------------------------------------------------

alter table public.waveurs_reglages enable row level security;
alter table public.waveurs_gains    enable row level security;
alter table public.waveurs_tours    enable row level security;

drop policy if exists "reglages lisibles"          on public.waveurs_reglages;
drop policy if exists "reglages ecrits par equipe" on public.waveurs_reglages;
drop policy if exists "gains lisibles"             on public.waveurs_gains;
drop policy if exists "gains ecrits par equipe"    on public.waveurs_gains;
drop policy if exists "tours visibles"             on public.waveurs_tours;

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


-- ---------------------------------------------------------------------
-- 5. Où en est un membre
--
-- Appelée à l'ouverture de la salle : combien de tours restent, combien
-- d'XP il a gagné aujourd'hui.
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
  v_debut   timestamptz;
  v_limite  integer;
  v_utilises integer;
  v_gagne   integer;
begin

  if auth.uid() is null then
    raise exception 'Connecte-toi pour jouer.';
  end if;

  v_debut := (date_trunc('day', now() at time zone 'Europe/Paris')) at time zone 'Europe/Paris';

  select coalesce((select valeur from public.waveurs_reglages where cle = 'tours_par_jour'), 10)
    into v_limite;

  select count(*), coalesce(sum(xp), 0)
    into v_utilises, v_gagne
  from public.waveurs_tours
  where user_id = auth.uid() and cree_le >= v_debut;

  return json_build_object(
    'tours_par_jour',  v_limite,
    'tours_restants',  greatest(v_limite - v_utilises, 0),
    'gagne_aujourdhui', v_gagne
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
  v_tirage   integer;
  v_gain     public.waveurs_gains%rowtype;
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

  select t.id, t.nom, t.motif, t.symbole, t.poids, t.xp, t.actif
    into v_gain
  from (
    select g.*, sum(g.poids) over (order by g.id) as cumul
    from public.waveurs_gains g
    where g.actif and g.poids > 0
  ) t
  where t.cumul > v_tirage
  order by t.id
  limit 1;

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

  insert into public.waveurs_tours (user_id, machine, gain_nom, motif, symboles, xp)
  values (auth.uid(), trim(p_machine), v_gain.nom, v_gain.motif, v_symboles, v_gain.xp);

  v_total := v_xp + v_gain.xp;

  return json_build_object(
    'symboles',        to_json(v_symboles),
    'gain',            v_gain.xp,
    'nom',             v_gain.nom,
    'motif',           v_gain.motif,
    'symbole',         v_gain.symbole,
    'xp_total',        v_total,
    'tours_restants',  v_limite - v_utilises - 1,
    'tours_par_jour',  v_limite
  );
end $$;


-- ---------------------------------------------------------------------
-- 7. Qui peut appeler quoi
--
-- Seuls les comptes connectés jouent. Les visiteurs se promènent dans la
-- salle sans pouvoir tirer le levier.
-- ---------------------------------------------------------------------

-- Supabase accorde par défaut l'exécution des fonctions aux visiteurs
-- anonymes ; « from public » seul ne la retire pas.
revoke all on function public.waveurs_etat() from public, anon;
revoke all on function public.waveurs_tourner(text) from public, anon;

grant execute on function public.waveurs_etat() to authenticated;
grant execute on function public.waveurs_tourner(text) to authenticated;


-- ---------------------------------------------------------------------
-- 8. Vérification
--
-- La première requête doit lister les trois tables avec RLS activée, la
-- deuxième les deux fonctions, la troisième les six gains de départ. La
-- dernière donne le gain moyen par tour : autour de 2 XP.
-- ---------------------------------------------------------------------

select relname as table_name, relrowsecurity as rls_active
from pg_class
where relname in ('waveurs_reglages', 'waveurs_gains', 'waveurs_tours')
order by relname;

select proname as fonction, prosecdef as security_definer
from pg_proc
where pronamespace = 'public'::regnamespace
  and proname in ('waveurs_etat', 'waveurs_tourner')
order by proname;

select id, nom, motif, symbole, poids, xp, actif
from public.waveurs_gains
order by xp desc, id;

select round(
         sum(poids::numeric * xp) / nullif(sum(poids), 0), 2
       ) as gain_moyen_par_tour_en_xp,
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
--   select p.pseudo, t.cree_le, t.xp
--   from public.waveurs_tours t
--   join public.profiles p on p.id = t.user_id
--   where t.motif = 'trio' and 'logo' = all (t.symboles)
--   order by t.cree_le desc;
-- ---------------------------------------------------------------------
