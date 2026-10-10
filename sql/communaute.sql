-- =====================================================================
-- La Wave — la communauté
--
-- Un vrai réseau social pour les gens de la musique : un fil où l'on
-- partage et où l'on discute, des annonces pour trouver avec qui
-- collaborer (un artiste qui cherche un beatmaker, un beatmaker qui
-- cherche des voix...), des messages privés, des abonnements, des
-- notifications, des profils qui disent ce que chacun cherche et propose.
--
-- Cinq principes tiennent tout le fichier :
--
--   1. le navigateur ne touche jamais aux tables. Elles ont toutes la
--      sécurité par ligne activée et aucune règle d'accès : tout passe
--      par les fonctions com_*, qui vérifient qui appelle, ce qu'il a
--      le droit de faire, et rangent les données dans le bon état ;
--   2. les lectures publiques (le fil, un message, un profil) sont ouvertes
--      aux visiteurs sans compte, pour qu'on voie ce qui s'y passe avant
--      de s'inscrire. Tout ce qui écrit, et tout ce qui est privé (messages,
--      notifications), demande un compte ;
--   3. les messages privés ne sont lisibles que par les deux personnes
--      de la conversation, y compris par l'équipe : seuls les messages
--      publics se modèrent ;
--   4. les limites (messages par heure, taille...) sont ici : le
--      navigateur les affiche, il ne les tient pas. Les cadences se règlent
--      dans la table com_reglages, sans toucher au code ;
--   5. les sujets du fil et les métiers (ce que l'on cherche, ce que l'on
--      propose) sont dans deux tables que l'équipe peut modifier depuis
--      l'éditeur de tables de Supabase : ajouter un sujet n'est pas une
--      mise en ligne.
--
-- Les anciennes tables du forum (forum_posts, forum_comments...) ne sont
-- pas touchées : elles restent en base, simplement plus lues.
--
-- À exécuter dans Supabase → SQL Editor, d'un seul bloc. Sans danger si
-- on le relance : rien n'est écrasé ni vidé. Le tout est enveloppé dans
-- une transaction : si une instruction échoue, rien n'est appliqué (et
-- aucune fonction interne ne reste ouverte par erreur).
-- =====================================================================

begin;


-- ---------------------------------------------------------------------
-- 0. Un préalable
--
-- est_equipe() dit si l'appelant est de l'équipe (profil is_admin). Elle
-- existe déjà si clip-et-artiste-verifie.sql a été passé ; on la pose ici
-- à l'identique pour que ce fichier se suffise.
-- ---------------------------------------------------------------------

create or replace function public.est_equipe()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select p.is_admin from public.profiles p where p.id = auth.uid()),
    false
  );
$$;


-- ---------------------------------------------------------------------
-- 1. Les réglages
--
-- Une ligne par réglage. Pour laisser publier huit messages en dix minutes
-- au lieu de six : Table Editor → com_reglages → changer la valeur.
-- ---------------------------------------------------------------------

create table if not exists public.com_reglages (
  cle         text primary key,
  valeur      integer not null check (valeur >= 0),
  description text
);

insert into public.com_reglages (cle, valeur, description) values
  ('posts_par_10min', 6,
   'Messages qu''un membre peut publier en dix minutes. L''équipe n''est pas limitée.'),
  ('commentaires_par_10min', 20,
   'Commentaires qu''un membre peut écrire en dix minutes.'),
  ('messages_par_10min', 60,
   'Messages privés qu''un membre peut envoyer en dix minutes.'),
  ('reactions_par_10min', 120,
   'Réactions (cœur, feu...) qu''un membre peut poser en dix minutes.'),
  ('suivis_par_heure', 60,
   'Abonnements qu''un membre peut créer en une heure : freine les abonnements en rafale.'),
  ('signalements_par_jour', 20,
   'Signalements qu''un membre peut faire en un jour.'),
  ('edition_minutes', 60,
   'Pendant combien de minutes l''auteur d''un message peut encore le corriger.')
on conflict (cle) do nothing;


-- ---------------------------------------------------------------------
-- 2. Ce que le profil dit de chacun
--
-- La ville, ce que l'on cherche (un beatmaker, un mix...), ce que l'on
-- propose, et les styles. Ce sont ces champs qui font se trouver les gens :
-- l'annuaire les filtre, et les suggestions les croisent.
-- ---------------------------------------------------------------------

alter table public.profiles
  add column if not exists ville             text,
  add column if not exists cherche           text[] not null default '{}',
  add column if not exists propose           text[] not null default '{}',
  add column if not exists genres            text[] not null default '{}',
  add column if not exists derniere_activite timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_com_limites'
  ) then
    alter table public.profiles add constraint profiles_com_limites check (
      char_length(coalesce(ville, '')) <= 60
      and cardinality(cherche) <= 8
      and cardinality(propose) <= 8
      and cardinality(genres)  <= 6
      and char_length(array_to_string(genres, ',')) <= 160
      and char_length(array_to_string(cherche, ',')) <= 200
      and char_length(array_to_string(propose, ',')) <= 200
    );
  end if;
end $$;


-- ---------------------------------------------------------------------
-- 3. Les métiers et les sujets
--
-- Métiers : ce que l'on cherche ou propose (un beatmaker, un vidéaste...).
-- Sujets : les rubriques du fil. « reserve_equipe » en réserve l'écriture
-- à l'équipe (les annonces). Ajouter ou retirer une ligne suffit.
-- ---------------------------------------------------------------------

create table if not exists public.com_metiers (
  cle     text primary key,
  libelle text not null,
  icone   text not null default '✨',
  ordre   integer not null default 100,
  actif   boolean not null default true
);

insert into public.com_metiers (cle, libelle, icone, ordre) values
  ('artiste',     'Artiste',               '🎤', 10),
  ('beatmaker',   'Beatmaker',             '🎹', 20),
  ('topliner',    'Topliner / Chanteur·se', '🎶', 30),
  ('ingenieur',   'Ingé son · mix & master', '🎚️', 40),
  ('dj',          'DJ',                    '🎛️', 50),
  ('videaste',    'Vidéaste · clips',      '🎬', 60),
  ('photographe', 'Photographe',           '📷', 70),
  ('da',          'DA · graphisme',        '🎨', 80),
  ('manager',     'Manager · booker',      '📈', 90),
  ('label',       'Label',                 '🏷️', 100),
  ('media',       'Média · presse',        '📰', 110),
  ('autre',       'Autre',                 '✨', 999)
on conflict (cle) do nothing;

create table if not exists public.com_sujets (
  cle            text primary key,
  libelle        text not null,
  description    text not null default '',
  icone          text not null default '#',
  ordre          integer not null default 100,
  actif          boolean not null default true,
  reserve_equipe boolean not null default false
);

insert into public.com_sujets (cle, libelle, description, icone, ordre, reserve_equipe) values
  ('general',  'Général',          'Pour parler de tout, de rap et du reste.',          '💬', 10, false),
  ('feedback', 'Retours',          'Partage un son, demande un avis franc.',            '🎧', 20, false),
  ('prod',     'Prod & beats',     'Instrus, samples, techniques de production.',       '🎹', 30, false),
  ('sorties',  'Sorties & actus',  'Les projets qui sortent, l''actualité du rap.',     '💿', 40, false),
  ('concerts', 'Concerts & photos','Lives, accréditations, photos de scène.',           '📷', 50, false),
  ('matos',    'Matos & conseils', 'Studio, mix, logiciels, distribution.',             '🎚️', 60, false),
  ('off',      'Hors sujet',       'Tout ce qui n''a rien à voir, avec le sourire.',    '☕', 70, false),
  ('annonces', 'Annonces',         'Les nouvelles de l''équipe La Wave.',               '📣', 5,  true)
on conflict (cle) do nothing;


-- ---------------------------------------------------------------------
-- 4. Le fil
--
-- Un message peut être un message ordinaire, une question, le partage d'un
-- son, ou une annonce de collaboration (« je cherche un beatmaker », « je
-- propose du mix »). Les compteurs de réactions et de commentaires sont
-- tenus ici, par les fonctions qui écrivent : une lecture du fil n'a pas à
-- les recompter.
-- ---------------------------------------------------------------------

create table if not exists public.com_posts (
  id              uuid primary key default gen_random_uuid(),
  auteur_id       uuid not null references public.profiles(id) on delete cascade,
  type            text not null default 'message'
                  check (type in ('message', 'question', 'son', 'collab')),
  sujet           text not null default 'general' references public.com_sujets(cle),
  contenu         text not null default '' check (char_length(contenu) <= 2000),
  images          text[] not null default '{}' check (cardinality(images) <= 4),
  lien            text check (lien is null or (char_length(lien) <= 500 and lien ~* '^https?://[^[:space:]"''<>]+$')),
  tags            text[] not null default '{}' check (cardinality(tags) <= 10),
  collab          jsonb,
  epingle         boolean not null default false,
  nb_reactions    integer not null default 0 check (nb_reactions >= 0),
  nb_commentaires integer not null default 0 check (nb_commentaires >= 0),
  cree_le         timestamptz not null default clock_timestamp(),
  modifie_le      timestamptz,
  check (contenu <> '' or cardinality(images) > 0 or lien is not null),
  check ((type = 'collab') = (collab is not null))
);

create index if not exists com_posts_cree_idx   on public.com_posts (cree_le desc);
create index if not exists com_posts_auteur_idx on public.com_posts (auteur_id, cree_le desc);
create index if not exists com_posts_sujet_idx  on public.com_posts (sujet, cree_le desc);
create index if not exists com_posts_collab_idx on public.com_posts (cree_le desc) where type = 'collab';
create index if not exists com_posts_tags_idx   on public.com_posts using gin (tags);

-- Les réponses n'ont qu'un étage : répondre à une réponse la range sous le
-- même commentaire, et « reponse_a » garde à qui l'on parlait.
create table if not exists public.com_commentaires (
  id           uuid primary key default gen_random_uuid(),
  post_id      uuid not null references public.com_posts(id) on delete cascade,
  auteur_id    uuid not null references public.profiles(id) on delete cascade,
  parent_id    uuid references public.com_commentaires(id) on delete cascade,
  reponse_a    uuid references public.profiles(id) on delete set null,
  contenu      text not null check (char_length(btrim(contenu)) between 1 and 1000),
  nb_reactions integer not null default 0 check (nb_reactions >= 0),
  cree_le      timestamptz not null default clock_timestamp()
);

create index if not exists com_commentaires_post_idx   on public.com_commentaires (post_id, cree_le);
create index if not exists com_commentaires_auteur_idx on public.com_commentaires (auteur_id);

-- Une réaction par membre et par cible : en choisir une autre remplace la
-- première. Les réactions sont des clés (coeur, feu, rire, bravo, cent) et
-- non des émojis : le dessin vit dans l'interface, la base n'a pas à
-- connaître les variantes d'un caractère.
create table if not exists public.com_reactions (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  cible_type text not null check (cible_type in ('post', 'commentaire')),
  cible_id   uuid not null,
  emoji      text not null check (emoji in ('coeur', 'feu', 'rire', 'bravo', 'cent')),
  cree_le    timestamptz not null default clock_timestamp(),
  primary key (user_id, cible_type, cible_id)
);

create index if not exists com_reactions_cible_idx on public.com_reactions (cible_type, cible_id);

create table if not exists public.com_favoris (
  user_id uuid not null references public.profiles(id) on delete cascade,
  post_id uuid not null references public.com_posts(id) on delete cascade,
  cree_le timestamptz not null default clock_timestamp(),
  primary key (user_id, post_id)
);

create table if not exists public.com_suivis (
  suiveur_id uuid not null references public.profiles(id) on delete cascade,
  suivi_id   uuid not null references public.profiles(id) on delete cascade,
  cree_le    timestamptz not null default clock_timestamp(),
  primary key (suiveur_id, suivi_id),
  check (suiveur_id <> suivi_id)
);

create index if not exists com_suivis_suivi_idx on public.com_suivis (suivi_id);

create table if not exists public.com_blocages (
  user_id   uuid not null references public.profiles(id) on delete cascade,
  bloque_id uuid not null references public.profiles(id) on delete cascade,
  cree_le   timestamptz not null default clock_timestamp(),
  primary key (user_id, bloque_id),
  check (user_id <> bloque_id)
);


-- ---------------------------------------------------------------------
-- 5. Les messages privés
--
-- Une conversation à deux. Sa clé (les deux identifiants rangés dans
-- l'ordre) garantit qu'il n'en existe qu'une par paire. « lu_le » dit
-- jusqu'où chacun a lu : les messages non lus d'un membre sont ceux de
-- l'autre postérieurs à cette date.
-- ---------------------------------------------------------------------

create table if not exists public.com_conversations (
  id                 uuid primary key default gen_random_uuid(),
  cle                text not null unique,
  cree_le            timestamptz not null default clock_timestamp(),
  dernier_message_le timestamptz,
  dernier_auteur_id  uuid references public.profiles(id) on delete set null,
  dernier_extrait    text
);

create table if not exists public.com_participants (
  conversation_id uuid not null references public.com_conversations(id) on delete cascade,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  lu_le           timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create index if not exists com_participants_user_idx on public.com_participants (user_id);

create table if not exists public.com_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.com_conversations(id) on delete cascade,
  auteur_id       uuid not null references public.profiles(id) on delete cascade,
  contenu         text not null check (char_length(btrim(contenu)) between 1 and 2000),
  cree_le         timestamptz not null default clock_timestamp()
);

create index if not exists com_messages_conv_idx on public.com_messages (conversation_id, cree_le desc);


-- ---------------------------------------------------------------------
-- 6. Notifications et signalements
--
-- Une notification par événement : « cle » en évite les doublons (la même
-- personne qui réagit deux fois au même message ne notifie qu'une fois).
-- ---------------------------------------------------------------------

create table if not exists public.com_notifications (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles(id) on delete cascade,
  type           text not null
                 check (type in ('reaction', 'commentaire', 'reponse', 'suivi', 'mention')),
  acteur_id      uuid not null references public.profiles(id) on delete cascade,
  post_id        uuid references public.com_posts(id) on delete cascade,
  commentaire_id uuid references public.com_commentaires(id) on delete cascade,
  reaction       text,
  cle            text not null,
  lu_le          timestamptz,
  cree_le        timestamptz not null default clock_timestamp(),
  unique (user_id, cle)
);

create index if not exists com_notifications_user_idx
  on public.com_notifications (user_id, cree_le desc);

create table if not exists public.com_signalements (
  id         uuid primary key default gen_random_uuid(),
  auteur_id  uuid not null references public.profiles(id) on delete cascade,
  cible_type text not null check (cible_type in ('post', 'commentaire', 'membre')),
  cible_id   uuid not null,
  motif      text not null check (motif in ('spam', 'haine', 'harcelement', 'faux', 'autre')),
  details    text check (details is null or char_length(details) <= 500),
  cree_le    timestamptz not null default clock_timestamp(),
  traite_le  timestamptz,
  traite_par uuid references public.profiles(id) on delete set null,
  unique (auteur_id, cible_type, cible_id)
);

create index if not exists com_signalements_ouverts_idx
  on public.com_signalements (cree_le desc) where traite_le is null;

-- Le journal des cadences : une ligne par action limitée (publier, réagir,
-- suivre...). Il ne se vide jamais à la suppression d'un message : supprimer
-- puis republier en boucle ne contourne donc plus la limite.
create table if not exists public.com_cadence (
  user_id uuid not null references public.profiles(id) on delete cascade,
  action  text not null,
  cree_le timestamptz not null default clock_timestamp()
);

create index if not exists com_cadence_idx on public.com_cadence (user_id, action, cree_le desc);

-- Les épinglés se cherchent à chaque ouverture du fil ; les pseudos cités se
-- retrouvent par leur minuscule.
create index if not exists com_posts_epingles_idx on public.com_posts (cree_le desc) where epingle;
create index if not exists profiles_pseudo_minuscule_idx on public.profiles (lower(pseudo));


-- ---------------------------------------------------------------------
-- 7. Les outils internes
--
-- Ces fonctions ne sont appelées que par les autres : personne ne peut les
-- lancer depuis le navigateur (voir les droits, tout en bas).
-- ---------------------------------------------------------------------

create or replace function public.com_reglage(p_cle text, p_defaut integer)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select valeur from public.com_reglages where cle = p_cle), p_defaut);
$$;


-- Le membre connecté, ou une erreur claire.
create or replace function public.com_moi()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_id uuid := auth.uid();
begin
  if v_id is null then
    raise exception 'Connecte-toi pour continuer.';
  end if;

  if not exists (select 1 from public.profiles where id = v_id) then
    raise exception 'Ton profil n''existe pas encore : reconnecte-toi.';
  end if;

  return v_id;
end $$;


-- Les rôles du profil ont changé de libellé avec le temps : les comptes
-- anciens gardent l'ancien texte en base. Même table de correspondance
-- que l'interface (ROLES_RENOMMES).
create or replace function public.com_role_canonique(p_role text)
returns text
language sql
immutable
as $$
  select case coalesce(btrim(p_role), '')
    when ''                 then 'Auditeur / Auditrice'
    when 'Auditeur'         then 'Auditeur / Auditrice'
    when 'Manager / Booker' then 'Manager'
    when 'Booker'           then 'Manager'
    else btrim(p_role)
  end;
$$;


-- Le métier qui correspond au rôle d'un profil, pour croiser « je suis »
-- et « je cherche ».
create or replace function public.com_role_cle(p_role text)
returns text
language sql
immutable
as $$
  select case public.com_role_canonique(p_role)
    when 'Artiste'            then 'artiste'
    when 'Beatmaker'          then 'beatmaker'
    when 'DJ'                 then 'dj'
    when 'Photographe'        then 'photographe'
    when 'Manager'            then 'manager'
    when 'Membre d''un label' then 'label'
    when 'Relation presse'    then 'media'
    when 'Média / Presse'     then 'media'
    when 'Autre'              then 'autre'
    else null
  end;
$$;


create or replace function public.com_normaliser(p_texte text)
returns text
language sql
immutable
as $$
  select translate(
    lower(coalesce(p_texte, '')),
    'àáâãäåçèéêëìíîïñòóôõöùúûüýÿœæ',
    'aaaaaaceeeeiiiinooooouuuuyyoa'
  );
$$;


-- Les mots-clics d'un message : « #trap » devient « trap ». Dix au plus.
create or replace function public.com_extraire_tags(p_texte text)
returns text[]
language sql
immutable
as $$
  select coalesce(array(
    select t from (
      select distinct public.com_normaliser(m[1]) as t
      from regexp_matches(coalesce(p_texte, ''), '#([[:alpha:]][[:alnum:]_]{1,29})', 'g') as m
    ) q
    limit 10
  ), '{}'::text[]);
$$;


-- Les pseudos cités (« @carla ») : cinq au plus.
create or replace function public.com_extraire_mentions(p_texte text)
returns text[]
language sql
immutable
as $$
  select coalesce(array(
    select p from (
      -- « @carla. » ou « @eve- » : la ponctuation de fin ne fait pas partie du pseudo.
      select distinct lower(regexp_replace(m[1], '[._-]+$', '')) as p
      from regexp_matches(
        coalesce(p_texte, ''),
        '(?:^|[^[:alnum:]_.])@([[:alnum:]_.-]{2,40})',
        'g'
      ) as m
    ) q
    where char_length(p) >= 2
    order by p
    limit 5
  ), '{}'::text[]);
$$;


-- Vrai si l'un des deux a bloqué l'autre.
create or replace function public.com_est_bloque(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.com_blocages b
    where (b.user_id = p_a and b.bloque_id = p_b)
       or (b.user_id = p_b and b.bloque_id = p_a)
  );
$$;


-- La cadence : au-delà du réglage, on freine. L'équipe n'est pas limitée.
create or replace function public.com_limiter(p_action text, p_moi uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max     integer;
  v_fenetre interval;
  v_n       integer := 0;
begin
  if public.est_equipe() then
    return;
  end if;

  if p_action = 'posts' then
    v_max := public.com_reglage('posts_par_10min', 6);
    v_fenetre := interval '10 minutes';

  elsif p_action = 'commentaires' then
    v_max := public.com_reglage('commentaires_par_10min', 20);
    v_fenetre := interval '10 minutes';

  elsif p_action = 'messages' then
    v_max := public.com_reglage('messages_par_10min', 60);
    v_fenetre := interval '10 minutes';

  elsif p_action = 'reactions' then
    v_max := public.com_reglage('reactions_par_10min', 120);
    v_fenetre := interval '10 minutes';

  elsif p_action = 'suivis' then
    v_max := public.com_reglage('suivis_par_heure', 60);
    v_fenetre := interval '1 hour';

  elsif p_action = 'signalements' then
    v_max := public.com_reglage('signalements_par_jour', 20);
    v_fenetre := interval '1 day';

  else
    return;
  end if;

  -- Un appel à la fois par membre et par action : deux requêtes lancées
  -- ensemble ne voient plus le même compte et ne passent plus toutes les deux.
  perform pg_advisory_xact_lock(hashtextextended(p_action || ':' || p_moi::text, 0));

  select count(*) into v_n
    from public.com_cadence
   where user_id = p_moi and action = p_action
     and cree_le > clock_timestamp() - v_fenetre;

  if v_n >= v_max then
    raise exception 'Doucement : tu vas un peu vite. Réessaie dans quelques minutes.';
  end if;

  insert into public.com_cadence (user_id, action) values (p_moi, p_action);

  -- Le ménage se fait en passant, de temps en temps : pas de tâche à planifier.
  if random() < 0.02 then
    delete from public.com_cadence where cree_le < now() - interval '2 days';
  end if;
end $$;


-- Ce qu'on montre d'un membre à côté de ce qu'il écrit.
create or replace function public.com_auteur_json(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select jsonb_build_object(
        'id',         p.id,
        'pseudo',     p.pseudo,
        'avatar_url', p.avatar_url,
        'role',       public.com_role_canonique(p.role),
        'xp',         coalesce(p.xp, 0),
        'equipe',     coalesce(p.is_admin, false),
        'ville',      p.ville,
        'artiste',    (
          select a.instagram_handle from public.artists a
           where a.verifie_par = p.id
           order by a.instagram_handle
           limit 1
        )
      )
      from public.profiles p
      where p.id = p_id
    ),
    jsonb_build_object(
      'id', null, 'pseudo', 'Compte supprimé', 'avatar_url', null,
      'role', 'Autre', 'xp', 0, 'equipe', false, 'ville', null, 'artiste', null
    )
  );
$$;


-- Un message du fil, tel que l'interface l'affiche : l'auteur, les
-- compteurs, ce que le lecteur en a fait (sa réaction, son favori).
create or replace function public.com_post_json(p_id uuid, p_moi uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  p public.com_posts;
begin
  select * into p from public.com_posts where id = p_id;

  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'id',              p.id,
    'type',            p.type,
    'sujet',           p.sujet,
    'contenu',         p.contenu,
    'images',          to_jsonb(p.images),
    'lien',            p.lien,
    'tags',            to_jsonb(p.tags),
    'collab',          p.collab,
    'epingle',         p.epingle,
    'nb_reactions',    p.nb_reactions,
    'nb_commentaires', p.nb_commentaires,
    'cree_le',         p.cree_le,
    'modifie_le',      p.modifie_le,
    'auteur',          public.com_auteur_json(p.auteur_id),
    'mentions',        case when p.contenu like '%@%' then coalesce((
      select jsonb_agg(pr.pseudo)
        from public.profiles pr
       where lower(pr.pseudo) = any (public.com_extraire_mentions(p.contenu))
    ), '[]'::jsonb) else '[]'::jsonb end,
    'reactions',       coalesce((
      select jsonb_agg(jsonb_build_object('emoji', r.emoji, 'n', r.n) order by r.n desc, r.emoji)
        from (
          select emoji, count(*) as n
            from public.com_reactions
           where cible_type = 'post' and cible_id = p.id
           group by emoji
        ) r
    ), '[]'::jsonb),
    'moi',             jsonb_build_object(
      'reaction', (
        select emoji from public.com_reactions
         where user_id = p_moi and cible_type = 'post' and cible_id = p.id
      ),
      'favori', exists (
        select 1 from public.com_favoris f
         where f.user_id = p_moi and f.post_id = p.id
      )
    )
  );
end $$;


create or replace function public.com_commentaire_json(p_id uuid, p_moi uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c public.com_commentaires;
begin
  select * into c from public.com_commentaires where id = p_id;

  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'id',           c.id,
    'post_id',      c.post_id,
    'parent_id',    c.parent_id,
    'reponse_a',    (
      select jsonb_build_object('id', pr.id, 'pseudo', pr.pseudo)
        from public.profiles pr where pr.id = c.reponse_a
    ),
    'contenu',      c.contenu,
    'cree_le',      c.cree_le,
    'nb_reactions', c.nb_reactions,
    'auteur',       public.com_auteur_json(c.auteur_id),
    'mentions',     case when c.contenu like '%@%' then coalesce((
      select jsonb_agg(pr.pseudo)
        from public.profiles pr
       where lower(pr.pseudo) = any (public.com_extraire_mentions(c.contenu))
    ), '[]'::jsonb) else '[]'::jsonb end,
    'moi',          jsonb_build_object(
      'reaction', (
        select emoji from public.com_reactions
         where user_id = p_moi and cible_type = 'commentaire' and cible_id = c.id
      )
    )
  );
end $$;


-- Une notification, sauf pour soi-même et sauf entre deux membres dont
-- l'un a bloqué l'autre.
create or replace function public.com_notifier(
  p_user           uuid,
  p_type           text,
  p_acteur         uuid,
  p_post           uuid,
  p_commentaire    uuid,
  p_reaction       text,
  p_cle            text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user is null or p_user = p_acteur then
    return;
  end if;

  if public.com_est_bloque(p_user, p_acteur) then
    return;
  end if;

  insert into public.com_notifications
    (user_id, type, acteur_id, post_id, commentaire_id, reaction, cle)
  values
    (p_user, p_type, p_acteur, p_post, p_commentaire, p_reaction, p_cle)
  on conflict (user_id, cle) do nothing;
end $$;


create or replace function public.com_notifier_mentions(
  p_texte       text,
  p_acteur      uuid,
  p_post        uuid,
  p_commentaire uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  for r in
    select id from public.profiles
     where lower(pseudo) = any (public.com_extraire_mentions(p_texte))
  loop
    perform public.com_notifier(
      r.id, 'mention', p_acteur, p_post, p_commentaire, null,
      'mention:' || p_acteur::text || ':' || coalesce(p_commentaire::text, p_post::text)
    );
  end loop;
end $$;


-- Une annonce de collaboration, remise au propre : ce que l'on cherche ou
-- propose, le métier, les styles, le lieu, la rémunération.
create or replace function public.com_collab_valide(p_collab jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_mode   text := p_collab ->> 'mode';
  v_role   text := p_collab ->> 'role';
  v_lieu   text := nullif(btrim(coalesce(p_collab ->> 'lieu', '')), '');
  v_remu   text := coalesce(nullif(p_collab ->> 'remuneration', ''), 'a_discuter');
  v_styles text[];
begin
  if p_collab is null or jsonb_typeof(p_collab) <> 'object' then
    raise exception 'Précise ce que tu cherches ou ce que tu proposes.';
  end if;

  if v_mode is null or v_mode not in ('cherche', 'propose') then
    raise exception 'Dis si tu cherches quelqu''un ou si tu proposes tes services.';
  end if;

  if v_role is null
     or not exists (select 1 from public.com_metiers where cle = v_role and actif) then
    raise exception 'Choisis le métier concerné.';
  end if;

  if char_length(coalesce(v_lieu, '')) > 60 then
    raise exception 'Le lieu est trop long (60 caractères au plus).';
  end if;

  if v_remu not in ('gratuit', 'partage', 'paye', 'a_discuter') then
    raise exception 'Cette rémunération n''existe pas.';
  end if;

  select coalesce(array(
    select s from (
      select distinct btrim(x) as s
        from jsonb_array_elements_text(
          case when jsonb_typeof(p_collab -> 'styles') = 'array'
               then p_collab -> 'styles' else '[]'::jsonb end
        ) as x
    ) q
    where char_length(s) between 2 and 24
    limit 5
  ), '{}'::text[]) into v_styles;

  return jsonb_build_object(
    'mode',         v_mode,
    'role',         v_role,
    'styles',       to_jsonb(v_styles),
    'lieu',         v_lieu,
    'remuneration', v_remu
  );
end $$;


-- Une image de message doit venir du stockage du site : pas d'adresse
-- quelconque qui s'afficherait chez tous les lecteurs.
--
-- Plus précis : l'adresse doit être celle du stockage de CE site, dans le
-- bucket des images, et le nom du fichier doit commencer par « com- » suivi
-- de l'identifiant de son auteur (c'est ainsi que l'interface les nomme).
-- Un membre ne peut donc ni afficher une image hébergée ailleurs, ni
-- référencer le fichier d'un autre pour le faire supprimer avec son message.
drop function if exists public.com_images_valides(text[]);

create or replace function public.com_images_valides(p_images text[], p_auteur uuid)
returns boolean
language sql
immutable
as $$
  select coalesce(bool_and(
    u is not null
    and char_length(u) <= 300
    and u ~ ('^https://bqataeghgjyiqrnnesqq\.supabase\.co/storage/v1/object/public/Covers/com-'
             || p_auteur::text || '-[A-Za-z0-9._-]{1,120}$')
  ), true)
  from unnest(coalesce(p_images, '{}'::text[])) as u;
$$;


-- ---------------------------------------------------------------------
-- 8. Les lectures
--
-- Ouvertes aux visiteurs sans compte : le fil, un message et ses
-- commentaires, un profil, l'annuaire, les tendances. Ce qui est privé
-- (compteurs, notifications, messages) demande un compte.
-- ---------------------------------------------------------------------

-- Les sujets et les métiers : de quoi dessiner les menus.
create or replace function public.com_referentiel()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'version', 1,
    'sujets', coalesce((
      select jsonb_agg(jsonb_build_object(
        'cle', s.cle, 'libelle', s.libelle, 'description', s.description,
        'icone', s.icone, 'reserve_equipe', s.reserve_equipe
      ) order by s.ordre, s.cle)
      from public.com_sujets s where s.actif
    ), '[]'::jsonb),
    'metiers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'cle', m.cle, 'libelle', m.libelle, 'icone', m.icone
      ) order by m.ordre, m.cle)
      from public.com_metiers m where m.actif
    ), '[]'::jsonb)
  );
$$;


-- Les messages qui répondent aux filtres, pour le lecteur donné : sans
-- ceux des membres qu'il a bloqués ou qui l'ont bloqué.
create or replace function public.com_candidats(
  p_moi     uuid,
  p_vue     text,
  p_sujet   text,
  p_type    text,
  p_tag     text,
  p_auteur  uuid,
  p_motif   text,
  p_favoris boolean
)
returns setof public.com_posts
language sql
stable
as $$
  -- Volontairement sans « security definer » : la fonction doit rester
  -- « inlinable », c'est-à-dire que Postgres la recopie dans la requête
  -- appelante et peut s'arrêter dès que la limite est atteinte (sans cela,
  -- chaque lecture du fil chargerait tous les messages). Elle n'est appelée
  -- que par des fonctions qui, elles, ont les droits (voir les droits, tout
  -- en bas : personne d'autre ne peut la lancer).
  select p.*
    from public.com_posts p
   where (p_sujet  is null or p.sujet = p_sujet)
     and (p_type   is null or p.type = p_type)
     and (p_tag    is null or p_tag = any (p.tags))
     and (p_auteur is null or p.auteur_id = p_auteur)
     and (p_motif  is null or p.contenu ilike p_motif escape '\')
     and (p_moi is null or not public.com_est_bloque(p_moi, p.auteur_id))
     and (not coalesce(p_favoris, false)
          or exists (select 1 from public.com_favoris f
                      where f.user_id = p_moi and f.post_id = p.id))
     and (p_vue <> 'abonnements'
          or p.auteur_id = p_moi
          or exists (select 1 from public.com_suivis s
                      where s.suiveur_id = p_moi and s.suivi_id = p.auteur_id));
$$;


-- Le fil.
--
--   p_vue       recent       tout, du plus récent au plus ancien
--               abonnements  les membres suivis, et soi
--               tendances    les messages des quatorze derniers jours, du
--                            plus vivant au moins vivant (réactions et
--                            commentaires, pesés par l'âge du message)
--   p_avant     curseur : seulement les messages plus anciens
--   p_apres     seulement les plus récents (« N nouveaux messages »)
--   p_decalage  pagination de la vue tendances
--
-- Les messages épinglés par l'équipe ouvrent la première page du fil
-- entier, et seulement elle.
create or replace function public.com_fil(
  p_vue       text        default 'recent',
  p_sujet     text        default null,
  p_type      text        default null,
  p_tag       text        default null,
  p_auteur    uuid        default null,
  p_recherche text        default null,
  p_avant     timestamptz default null,
  p_apres     timestamptz default null,
  p_decalage  integer     default 0,
  p_limite    integer     default 15,
  p_favoris   boolean     default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_moi       uuid := auth.uid();
  v_limite    integer := least(greatest(coalesce(p_limite, 15), 1), 40);
  v_vue       text := coalesce(p_vue, 'recent');
  v_tag       text := nullif(public.com_normaliser(btrim(coalesce(p_tag, ''))), '');
  v_recherche text := nullif(left(btrim(coalesce(p_recherche, '')), 60), '');
  v_motif     text;
  v_epingles  boolean;
  v_pins      uuid[] := '{}';
  v_top       uuid[] := '{}';
  v_reste     uuid[] := '{}';
  v_ids       uuid[];
  v_posts     jsonb;
begin
  if v_vue not in ('recent', 'abonnements', 'tendances') then
    raise exception 'Vue inconnue.';
  end if;

  if (v_vue = 'abonnements' or coalesce(p_favoris, false)) and v_moi is null then
    return jsonb_build_object('posts', '[]'::jsonb, 'fin', true);
  end if;

  if v_recherche is not null then
    v_motif := '%' || replace(replace(replace(v_recherche, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  v_epingles := v_vue = 'recent'
    and p_sujet is null and p_type is null and v_tag is null
    and p_auteur is null and v_motif is null
    and not coalesce(p_favoris, false);

  -- Les trois messages épinglés les plus récents ouvrent la première page du
  -- fil entier. Ils ne reviennent pas dans les pages suivantes ; les autres
  -- messages épinglés, s'il y en a davantage, restent à leur place dans le temps.
  if v_epingles then
    select coalesce(array_agg(x.id order by x.cree_le desc), '{}')
      into v_top
      from (
        select c.id, c.cree_le
          from public.com_candidats(v_moi, v_vue, null, null, null, null, null, false) c
         where c.epingle
         order by c.cree_le desc
         limit 3
      ) x;

    if p_avant is null and p_apres is null then
      v_pins := v_top;
    end if;
  end if;

  if v_vue = 'tendances' then

    select coalesce(array_agg(x.id order by x.score desc, x.cree_le desc), '{}')
      into v_reste
      from (
        select c.id, c.cree_le,
               (c.nb_reactions * 2 + c.nb_commentaires * 3 + 1)::float8
                 / power(extract(epoch from (now() - c.cree_le)) / 3600.0 + 2, 1.4) as score
          from public.com_candidats(v_moi, v_vue, p_sujet, p_type, v_tag, p_auteur, v_motif, p_favoris) c
         where c.cree_le > now() - interval '14 days'
         order by score desc, c.cree_le desc
         limit v_limite
         offset greatest(coalesce(p_decalage, 0), 0)
      ) x;

  else

    select coalesce(array_agg(x.id order by x.cree_le desc, x.id), '{}')
      into v_reste
      from (
        select c.id, c.cree_le
          from public.com_candidats(v_moi, v_vue, p_sujet, p_type, v_tag, p_auteur, v_motif, p_favoris) c
         where (p_avant is null or c.cree_le < p_avant)
           and (p_apres is null or c.cree_le > p_apres)
           and c.id <> all (v_top)
         order by c.cree_le desc, c.id
         limit v_limite
      ) x;

  end if;

  v_ids := v_pins || v_reste;

  select coalesce(jsonb_agg(public.com_post_json(t.id, v_moi) order by t.ord), '[]'::jsonb)
    into v_posts
    from unnest(v_ids) with ordinality as t(id, ord);

  return jsonb_build_object(
    'posts', v_posts,
    'fin',   coalesce(cardinality(v_reste), 0) < v_limite
  );
end $$;


-- Un message et ses commentaires, du plus ancien au plus récent : une
-- conversation se lit dans l'ordre où elle a eu lieu.
create or replace function public.com_post(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_moi  uuid := auth.uid();
  v_post jsonb;
begin
  v_post := public.com_post_json(p_id, v_moi);

  if v_post is null then
    return null;
  end if;

  if v_moi is not null
     and public.com_est_bloque(v_moi, (v_post -> 'auteur' ->> 'id')::uuid) then
    return null;
  end if;

  return jsonb_build_object(
    'post', v_post,
    'commentaires', coalesce((
      select jsonb_agg(public.com_commentaire_json(c.id, v_moi) order by c.cree_le, c.id)
        from (
          select id, cree_le
            from public.com_commentaires k
           where k.post_id = p_id
             and (v_moi is null or not public.com_est_bloque(v_moi, k.auteur_id))
           order by cree_le, id
           limit 300
        ) c
    ), '[]'::jsonb)
  );
end $$;


-- Un profil, par pseudo ou par identifiant.
create or replace function public.com_profil(p_cle text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_moi uuid := auth.uid();
  p     public.profiles;
begin
  if p_cle ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select * into p from public.profiles where id = p_cle::uuid;
  else
    select * into p from public.profiles
     where lower(pseudo) = lower(btrim(coalesce(p_cle, '')))
     limit 1;
  end if;

  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'profil', jsonb_build_object(
      'id',          p.id,
      'pseudo',      p.pseudo,
      'avatar_url',  p.avatar_url,
      'bio',         coalesce(p.bio, ''),
      'role',        public.com_role_canonique(p.role),
      'xp',          coalesce(p.xp, 0),
      'ville',       p.ville,
      'cherche',     to_jsonb(p.cherche),
      'propose',     to_jsonb(p.propose),
      'genres',      to_jsonb(p.genres),
      'socials',     coalesce(p.socials, '{}'::jsonb),
      'equipe',      coalesce(p.is_admin, false),
      'cree_le',     p.created_at,
      'artiste',     (select a.instagram_handle from public.artists a
                       where a.verifie_par = p.id order by a.instagram_handle limit 1),
      'artiste_nom', (select coalesce(a.display_name, a.instagram_handle) from public.artists a
                       where a.verifie_par = p.id order by a.instagram_handle limit 1)
    ),
    'stats', jsonb_build_object(
      'posts',       (select count(*) from public.com_posts where auteur_id = p.id),
      'collabs',     (select count(*) from public.com_posts where auteur_id = p.id and type = 'collab'),
      'abonnes',     (select count(*) from public.com_suivis where suivi_id = p.id),
      'abonnements', (select count(*) from public.com_suivis where suiveur_id = p.id)
    ),
    'moi', jsonb_build_object(
      'soi',        v_moi is not null and v_moi = p.id,
      'suit',       exists (select 1 from public.com_suivis where suiveur_id = v_moi and suivi_id = p.id),
      'suivi_par',  exists (select 1 from public.com_suivis where suiveur_id = p.id and suivi_id = v_moi),
      'bloque',     exists (select 1 from public.com_blocages where user_id = v_moi and bloque_id = p.id),
      'bloque_par', exists (select 1 from public.com_blocages where user_id = p.id and bloque_id = v_moi)
    )
  );
end $$;


-- Le nombre de messages d'un membre : le défi « premier message » le
-- compte.
create or replace function public.com_nb_posts(p_auteur uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer from public.com_posts where auteur_id = p_auteur;
$$;


-- L'annuaire : on y trouve les gens par métier, par ce qu'ils cherchent
-- ou proposent, par ville ou par nom.
create or replace function public.com_membres(
  p_role      text    default null,
  p_cherche   text    default null,
  p_propose   text    default null,
  p_ville     text    default null,
  p_recherche text    default null,
  p_tri       text    default 'actifs',
  p_limite    integer default 24,
  p_decalage  integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_moi       uuid := auth.uid();
  v_limite    integer := least(greatest(coalesce(p_limite, 24), 1), 60);
  v_ville     text := nullif(left(btrim(coalesce(p_ville, '')), 60), '');
  v_recherche text := nullif(left(btrim(coalesce(p_recherche, '')), 60), '');
  v_mville    text;
  v_mrech     text;
  v_ids       uuid[];
  v_membres   jsonb;
  v_total     integer;
begin
  if v_ville is not null then
    v_mville := '%' || replace(replace(replace(v_ville, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  if v_recherche is not null then
    v_mrech := '%' || replace(replace(replace(v_recherche, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  select coalesce(array_agg(p.id), '{}')
    into v_ids
    from public.profiles p
   where (v_moi is null or p.id <> v_moi)
     -- Le métier cherché : celui du profil, ou un service qu'il propose (un
     -- artiste qui propose du mix est aussi un ingé son pour qui le cherche).
     and (p_role is null or public.com_role_cle(p.role) = p_role or p_role = any (p.propose))
     and (p_cherche is null or p_cherche = any (p.cherche))
     and (p_propose is null or p_propose = any (p.propose))
     and (v_mville is null or p.ville ilike v_mville escape '\')
     and (v_mrech is null or p.pseudo ilike v_mrech escape '\' or p.bio ilike v_mrech escape '\')
     and (v_moi is null or not public.com_est_bloque(v_moi, p.id));

  v_total := coalesce(cardinality(v_ids), 0);

  select coalesce(jsonb_agg(m.j order by m.rang), '[]'::jsonb)
    into v_membres
    from (
      select row_number() over (
               order by
                 case when coalesce(p_tri, 'actifs') = 'populaires'
                      then (select count(*) from public.com_suivis s where s.suivi_id = p.id) end desc nulls last,
                 case when coalesce(p_tri, 'actifs') = 'recents' then p.created_at end desc nulls last,
                 coalesce(p.derniere_activite, p.updated_at, p.created_at) desc,
                 coalesce(p.xp, 0) desc,
                 p.id
             ) as rang,
             jsonb_build_object(
               'id',         p.id,
               'pseudo',     p.pseudo,
               'avatar_url', p.avatar_url,
               'bio',        left(coalesce(p.bio, ''), 160),
               'role',       public.com_role_canonique(p.role),
               'xp',         coalesce(p.xp, 0),
               'ville',      p.ville,
               'cherche',    to_jsonb(p.cherche),
               'propose',    to_jsonb(p.propose),
               'genres',     to_jsonb(p.genres),
               'equipe',     coalesce(p.is_admin, false),
               'nb_abonnes', (select count(*) from public.com_suivis s where s.suivi_id = p.id),
               'nb_posts',   (select count(*) from public.com_posts k where k.auteur_id = p.id),
               'moi',        jsonb_build_object(
                 'suit', exists (select 1 from public.com_suivis s
                                  where s.suiveur_id = v_moi and s.suivi_id = p.id)
               )
             ) as j
        from public.profiles p
       where p.id = any (v_ids)
    ) m
   where m.rang > greatest(coalesce(p_decalage, 0), 0)
     and m.rang <= greatest(coalesce(p_decalage, 0), 0) + v_limite;

  return jsonb_build_object(
    'membres', v_membres,
    'total',   v_total,
    'fin',     greatest(coalesce(p_decalage, 0), 0) + v_limite >= v_total
  );
end $$;


-- Qui suivre : d'abord ceux que l'on cherche (un artiste voit des
-- beatmakers), ceux qui cherchent ce que l'on est, la même ville, les
-- mêmes styles, puis les plus actifs. « raisons » dit pourquoi, pour que
-- l'interface puisse l'expliquer.
create or replace function public.com_suggestions(p_limite integer default 5)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_moi    uuid := auth.uid();
  v_limite integer := least(greatest(coalesce(p_limite, 5), 1), 20);
  m        public.profiles;
  v_cle    text;
  v_res    jsonb;
begin
  if v_moi is not null then
    select * into m from public.profiles where id = v_moi;
    v_cle := public.com_role_cle(m.role);
  end if;

  select coalesce(jsonb_agg(x.j order by x.score desc, x.actif desc, x.xp desc, x.id), '[]'::jsonb)
    into v_res
    from (
      select s.*, jsonb_build_object(
               'id',         s.id,
               'pseudo',     s.pseudo,
               'avatar_url', s.avatar_url,
               'bio',        left(coalesce(s.bio, ''), 120),
               'role',       public.com_role_canonique(s.role),
               'xp',         coalesce(s.xp, 0),
               'ville',      s.ville,
               'cherche',    to_jsonb(s.cherche),
               'propose',    to_jsonb(s.propose),
               'equipe',     coalesce(s.is_admin, false),
               'raisons',    to_jsonb(array_remove(array[
                 case when s.tu_cherches then 'tu_cherches' end,
                 case when s.te_cherche  then 'te_cherche'  end,
                 case when s.meme_ville  then 'meme_ville'  end,
                 case when s.meme_style  then 'meme_style'  end
               ], null))
             ) as j
        from (
          select c.id, c.pseudo, c.avatar_url, c.bio, c.role, c.xp, c.ville,
                 c.cherche, c.propose, c.is_admin,
                 coalesce(c.derniere_activite, c.updated_at, c.created_at) as actif,
                 (v_moi is not null and public.com_role_cle(c.role) = any (m.cherche))     as tu_cherches,
                 (v_cle is not null and v_cle = any (c.cherche))                           as te_cherche,
                 (m.ville is not null and c.ville is not null and lower(c.ville) = lower(m.ville)) as meme_ville,
                 (v_moi is not null and m.genres && c.genres)                              as meme_style,
                 (
                   (case when v_moi is not null and public.com_role_cle(c.role) = any (m.cherche) then 3 else 0 end)
                 + (case when v_cle is not null and v_cle = any (c.cherche) then 2 else 0 end)
                 + (case when m.ville is not null and c.ville is not null and lower(c.ville) = lower(m.ville) then 2 else 0 end)
                 + (case when v_moi is not null and m.genres && c.genres then 1 else 0 end)
                 + (case when coalesce(c.derniere_activite, c.updated_at, c.created_at) > now() - interval '14 days' then 1 else 0 end)
                 + (case when c.avatar_url is not null then 1 else 0 end)
                 ) as score
            from public.profiles c
           where (v_moi is null or c.id <> v_moi)
             and (v_moi is null or not exists (select 1 from public.com_suivis f
                                                where f.suiveur_id = v_moi and f.suivi_id = c.id))
             and (v_moi is null or not public.com_est_bloque(v_moi, c.id))
        ) s
       order by s.score desc, s.actif desc, coalesce(s.xp, 0) desc
       limit v_limite
    ) x;

  return v_res;
end $$;


-- Les mots-clics et les sujets du moment (sept derniers jours).
create or replace function public.com_tendances()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'tags', coalesce((
      select jsonb_agg(jsonb_build_object('tag', t.tag, 'n', t.n) order by t.n desc, t.tag)
        from (
          select tag, count(*) as n
            from public.com_posts p, unnest(p.tags) as tag
           where p.cree_le > now() - interval '7 days'
           group by tag
           order by n desc, tag
           limit 8
        ) t
    ), '[]'::jsonb),
    'sujets', coalesce((
      select jsonb_agg(jsonb_build_object('cle', s.sujet, 'n', s.n) order by s.n desc, s.sujet)
        from (
          select sujet, count(*) as n
            from public.com_posts
           where cree_le > now() - interval '7 days'
           group by sujet
        ) s
    ), '[]'::jsonb)
  );
$$;


-- La recherche de la colonne de droite : des membres, des mots-clics, des
-- messages.
create or replace function public.com_chercher(p_q text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_moi   uuid := auth.uid();
  v_q     text := btrim(coalesce(p_q, ''));
  v_motif text;
  v_debut text;
  v_tag   text;
begin
  if char_length(v_q) < 2 then
    return jsonb_build_object('membres', '[]'::jsonb, 'tags', '[]'::jsonb, 'posts', '[]'::jsonb);
  end if;

  v_q := left(v_q, 60);
  v_motif := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  v_debut := replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  v_tag := public.com_normaliser(regexp_replace(v_q, '^#', ''));

  return jsonb_build_object(
    'membres', coalesce((
      select jsonb_agg(m.j order by m.rang)
        from (
          select row_number() over (
                   order by (lower(p.pseudo) like lower(v_debut) escape '\') desc,
                            coalesce(p.xp, 0) desc, p.pseudo
                 ) as rang,
                 jsonb_build_object(
                   'id', p.id, 'pseudo', p.pseudo, 'avatar_url', p.avatar_url,
                   'role', public.com_role_canonique(p.role), 'ville', p.ville
                 ) as j
            from public.profiles p
           where p.pseudo ilike v_motif escape '\'
             and (v_moi is null or not public.com_est_bloque(v_moi, p.id))
           order by rang
           limit 5
        ) m
    ), '[]'::jsonb),
    'tags', coalesce((
      select jsonb_agg(jsonb_build_object('tag', t.tag, 'n', t.n) order by t.n desc, t.tag)
        from (
          select tag, count(*) as n
            from public.com_posts p, unnest(p.tags) as tag
           where p.cree_le > now() - interval '90 days'
             and tag like replace(replace(replace(v_tag, '\', '\\'), '%', '\%'), '_', '\_') || '%' escape '\'
           group by tag
           order by n desc, tag
           limit 5
        ) t
    ), '[]'::jsonb),
    'posts', coalesce((
      select jsonb_agg(public.com_post_json(x.id, v_moi) order by x.cree_le desc)
        from (
          select c.id, c.cree_le
            from public.com_candidats(v_moi, 'recent', null, null, null, null, v_motif, false) c
           where c.cree_le > now() - interval '90 days'
           order by c.cree_le desc
           limit 5
        ) x
    ), '[]'::jsonb)
  );
end $$;


-- Ce qui attend le membre : notifications non lues, conversations avec des
-- messages non lus. Appelée régulièrement par le navigateur, elle reste
-- volontairement minuscule.
create or replace function public.com_compteurs()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'notifications', (
      select count(*) from public.com_notifications n
       where n.user_id = auth.uid() and n.lu_le is null
    ),
    'messages', (
      select count(*) from public.com_participants mp
       where mp.user_id = auth.uid()
         and exists (
           select 1 from public.com_messages m
            where m.conversation_id = mp.conversation_id
              and m.auteur_id <> mp.user_id
              and m.cree_le > mp.lu_le
         )
    )
  );
$$;


create or replace function public.com_notifications(
  p_avant  timestamptz default null,
  p_limite integer     default 30
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_moi    uuid := public.com_moi();
  v_limite integer := least(greatest(coalesce(p_limite, 30), 1), 60);
  v_liste  jsonb;
begin
  select coalesce(jsonb_agg(public.com_notification_json(n.id) order by n.cree_le desc, n.id), '[]'::jsonb)
    into v_liste
    from (
      select id, cree_le
        from public.com_notifications
       where user_id = v_moi
         and (p_avant is null or cree_le < p_avant)
       order by cree_le desc, id
       limit v_limite
    ) n;

  return jsonb_build_object(
    'notifications', v_liste,
    'fin', jsonb_array_length(v_liste) < v_limite
  );
end $$;


create or replace function public.com_notification_json(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id',       n.id,
    'type',     n.type,
    'cree_le',  n.cree_le,
    'lu',       n.lu_le is not null,
    'reaction', n.reaction,
    'acteur',   public.com_auteur_json(n.acteur_id),
    'post',     (
      select jsonb_build_object(
        'id', p.id, 'type', p.type, 'extrait', left(p.contenu, 140), 'image', p.images[1]
      ) from public.com_posts p where p.id = n.post_id
    ),
    'commentaire', (
      select jsonb_build_object(
        'id', c.id, 'post_id', c.post_id, 'extrait', left(c.contenu, 140)
      ) from public.com_commentaires c where c.id = n.commentaire_id
    )
  )
  from public.com_notifications n
  where n.id = p_id;
$$;


-- Mes conversations, la plus récente d'abord. Une conversation n'apparaît
-- qu'une fois un premier message envoyé.
create or replace function public.com_conversations()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_moi uuid := public.com_moi();
begin
  return coalesce((
    select jsonb_agg(x.j order by x.dernier desc, x.id)
      from (
        select c.id, c.dernier_message_le as dernier,
               jsonb_build_object(
                 'id',      c.id,
                 'autre',   public.com_auteur_json(o.user_id),
                 'dernier', jsonb_build_object(
                   'contenu',   c.dernier_extrait,
                   'auteur_id', c.dernier_auteur_id,
                   'cree_le',   c.dernier_message_le
                 ),
                 'non_lus', (
                   select count(*) from public.com_messages m
                    where m.conversation_id = c.id
                      and m.auteur_id <> v_moi
                      and m.cree_le > mp.lu_le
                 ),
                 'lu_autre', o.lu_le,
                 'bloque',   public.com_est_bloque(v_moi, o.user_id)
               ) as j
          from public.com_participants mp
          join public.com_conversations c on c.id = mp.conversation_id
          join public.com_participants o
            on o.conversation_id = c.id and o.user_id <> v_moi
         where mp.user_id = v_moi
           and c.dernier_message_le is not null
      ) x
  ), '[]'::jsonb);
end $$;


-- Les messages d'une conversation, du plus ancien au plus récent, par
-- pages en remontant le temps.
create or replace function public.com_messages(
  p_conversation uuid,
  p_avant        timestamptz default null,
  p_limite       integer     default 40
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_moi    uuid := public.com_moi();
  v_limite integer := least(greatest(coalesce(p_limite, 40), 1), 100);
  v_autre  uuid;
  v_lu     timestamptz;
  v_liste  jsonb;
begin
  if not exists (
    select 1 from public.com_participants
     where conversation_id = p_conversation and user_id = v_moi
  ) then
    raise exception 'Cette conversation n''existe pas.';
  end if;

  select o.user_id, o.lu_le into v_autre, v_lu
    from public.com_participants o
   where o.conversation_id = p_conversation and o.user_id <> v_moi;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', m.id, 'auteur_id', m.auteur_id, 'contenu', m.contenu, 'cree_le', m.cree_le
         ) order by m.cree_le, m.id), '[]'::jsonb)
    into v_liste
    from (
      select * from public.com_messages
       where conversation_id = p_conversation
         and (p_avant is null or cree_le < p_avant)
       order by cree_le desc, id desc
       limit v_limite
    ) m;

  return jsonb_build_object(
    'messages', v_liste,
    'fin',      jsonb_array_length(v_liste) < v_limite,
    'autre',    public.com_auteur_json(v_autre),
    'lu_autre', v_lu,
    'bloque',   public.com_est_bloque(v_moi, v_autre)
  );
end $$;


-- ---------------------------------------------------------------------
-- 9. Écrire dans le fil
--
-- Chaque fonction vérifie qui appelle, ce qu'il a le droit de faire, et
-- tient les compteurs à jour dans le même geste.
-- ---------------------------------------------------------------------

-- Publier. Les mots-clics (#trap) et les citations (@carla) sont lus ici,
-- une fois : le fil n'a pas à les chercher à chaque affichage.
create or replace function public.com_publier(
  p_contenu text    default '',
  p_type    text    default 'message',
  p_sujet   text    default 'general',
  p_images  text[]  default '{}',
  p_lien    text    default null,
  p_collab  jsonb   default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_moi     uuid := public.com_moi();
  v_contenu text := btrim(coalesce(p_contenu, ''));
  v_images  text[] := array_remove(coalesce(p_images, '{}'::text[]), null);
  v_lien    text := nullif(btrim(coalesce(p_lien, '')), '');
  v_type    text := coalesce(p_type, 'message');
  v_collab  jsonb := null;
  v_id      uuid;
begin
  if v_type not in ('message', 'question', 'son', 'collab') then
    raise exception 'Ce type de publication n''existe pas.';
  end if;

  if char_length(v_contenu) > 2000 then
    raise exception 'Ton message est trop long (2 000 caractères au plus).';
  end if;

  if not exists (
    select 1 from public.com_sujets s
     where s.cle = p_sujet and s.actif
       and (not s.reserve_equipe or public.est_equipe())
  ) then
    raise exception 'Ce sujet n''existe pas, ou il est réservé à l''équipe.';
  end if;

  if cardinality(v_images) > 4 then
    raise exception 'Quatre images au plus par message.';
  end if;

  if not public.com_images_valides(v_images, v_moi) then
    raise exception 'Une des images n''a pas été envoyée correctement.';
  end if;

  if v_lien is not null and (char_length(v_lien) > 500 or v_lien !~* '^https?://[^[:space:]"''<>]+$') then
    raise exception 'Ce lien n''est pas valide.';
  end if;

  if v_type = 'son' and v_lien is null and cardinality(v_images) = 0 then
    raise exception 'Ajoute le lien de ton son.';
  end if;

  if v_contenu = '' and cardinality(v_images) = 0 and v_lien is null then
    raise exception 'Écris quelque chose, ou ajoute une image ou un lien.';
  end if;

  if v_type = 'collab' then
    v_collab := public.com_collab_valide(p_collab);
  end if;

  perform public.com_limiter('posts', v_moi);

  if v_contenu <> '' and exists (
    select 1 from public.com_posts
     where auteur_id = v_moi and contenu = v_contenu
       and cree_le > now() - interval '1 hour'
  ) then
    raise exception 'Tu viens déjà de publier exactement ce message.';
  end if;

  insert into public.com_posts
    (auteur_id, type, sujet, contenu, images, lien, tags, collab)
  values
    (v_moi, v_type, p_sujet, v_contenu, v_images, v_lien,
     public.com_extraire_tags(v_contenu), v_collab)
  returning id into v_id;

  perform public.com_notifier_mentions(v_contenu, v_moi, v_id, null);

  update public.profiles set derniere_activite = clock_timestamp() where id = v_moi;

  return public.com_post_json(v_id, v_moi);
end $$;


-- Corriger son message, pendant le temps que laisse le réglage
-- edition_minutes.
create or replace function public.com_modifier_post(p_id uuid, p_contenu text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_moi     uuid := public.com_moi();
  v_contenu text := btrim(coalesce(p_contenu, ''));
  p         public.com_posts;
begin
  select * into p from public.com_posts where id = p_id;

  if not found then
    raise exception 'Ce message n''existe plus.';
  end if;

  if p.auteur_id <> v_moi then
    raise exception 'Tu ne peux corriger que tes propres messages.';
  end if;

  if p.cree_le < now() - make_interval(mins => public.com_reglage('edition_minutes', 60)) then
    raise exception 'Il est trop tard pour corriger ce message.';
  end if;

  if char_length(v_contenu) > 2000 then
    raise exception 'Ton message est trop long (2 000 caractères au plus).';
  end if;

  if v_contenu = '' and cardinality(p.images) = 0 and p.lien is null then
    raise exception 'Un message ne peut pas être vide.';
  end if;

  update public.com_posts
     set contenu = v_contenu,
         tags = public.com_extraire_tags(v_contenu),
         modifie_le = clock_timestamp()
   where id = p_id;

  return public.com_post_json(p_id, v_moi);
end $$;


-- Supprimer : l'auteur, ou l'équipe. Renvoie les images, que le
-- navigateur peut alors retirer du stockage.
create or replace function public.com_supprimer_post(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_moi uuid := public.com_moi();
  p     public.com_posts;
begin
  select * into p from public.com_posts where id = p_id;

  if not found then
    return jsonb_build_object('supprime', false, 'images', '[]'::jsonb);
  end if;

  if p.auteur_id <> v_moi and not public.est_equipe() then
    raise exception 'Tu ne peux supprimer que tes propres messages.';
  end if;

  -- Ses commentaires, ses réactions et ses signalements s'en vont avec lui
  -- (voir les déclencheurs « com_nettoyer_* » plus bas).
  delete from public.com_posts where id = p_id;

  -- Seules les images conformes (celles que l'auteur a envoyées lui-même) sont
  -- rendues au navigateur pour être retirées du stockage.
  return jsonb_build_object('supprime', true, 'images', to_jsonb(coalesce(array(
    select u from unnest(p.images) as u
     where public.com_images_valides(array[u], p.auteur_id)
  ), '{}'::text[])));
end $$;


-- Épingler en tête du fil : l'équipe seulement. Trois au plus s'affichent.
create or replace function public.com_epingler(p_id uuid, p_actif boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.com_moi();

  if not public.est_equipe() then
    raise exception 'Seule l''équipe peut épingler un message.';
  end if;

  update public.com_posts set epingle = coalesce(p_actif, true) where id = p_id;

  return jsonb_build_object('epingle', coalesce(p_actif, true));
end $$;


create or replace function public.com_commenter(
  p_post    uuid,
  p_contenu text,
  p_parent  uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_moi       uuid := public.com_moi();
  v_contenu   text := btrim(coalesce(p_contenu, ''));
  v_post      public.com_posts;
  v_parent    public.com_commentaires;
  v_racine    uuid := null;
  v_reponse_a uuid := null;
  v_id        uuid;
begin
  if v_contenu = '' then
    raise exception 'Écris quelque chose avant d''envoyer.';
  end if;

  if char_length(v_contenu) > 1000 then
    raise exception 'Ton commentaire est trop long (1 000 caractères au plus).';
  end if;

  select * into v_post from public.com_posts where id = p_post;

  if not found then
    raise exception 'Ce message n''existe plus.';
  end if;

  if public.com_est_bloque(v_moi, v_post.auteur_id) then
    raise exception 'Tu ne peux pas répondre à ce membre.';
  end if;

  -- Répondre à une réponse : on la range sous le même commentaire.
  if p_parent is not null then

    select * into v_parent
      from public.com_commentaires
     where id = p_parent and post_id = p_post;

    if not found then
      raise exception 'Le commentaire auquel tu réponds n''existe plus.';
    end if;

    if public.com_est_bloque(v_moi, v_parent.auteur_id) then
      raise exception 'Tu ne peux pas répondre à ce membre.';
    end if;

    v_racine := coalesce(v_parent.parent_id, v_parent.id);
    v_reponse_a := v_parent.auteur_id;
  end if;

  perform public.com_limiter('commentaires', v_moi);

  insert into public.com_commentaires (post_id, auteur_id, parent_id, reponse_a, contenu)
  values (p_post, v_moi, v_racine, v_reponse_a, v_contenu)
  returning id into v_id;

  update public.com_posts
     set nb_commentaires = nb_commentaires + 1
   where id = p_post;

  -- Qui prévenir : celui à qui l'on répond, et l'auteur du message.
  if v_reponse_a is not null then
    perform public.com_notifier(v_reponse_a, 'reponse', v_moi, p_post, v_id, null,
                                'reponse:' || v_id::text);
  end if;

  if v_post.auteur_id is distinct from v_reponse_a then
    perform public.com_notifier(v_post.auteur_id, 'commentaire', v_moi, p_post, v_id, null,
                                'commentaire:' || v_id::text);
  end if;

  perform public.com_notifier_mentions(v_contenu, v_moi, p_post, v_id);

  update public.profiles set derniere_activite = clock_timestamp() where id = v_moi;

  return public.com_commentaire_json(v_id, v_moi);
end $$;


-- Supprimer un commentaire : son auteur, l'auteur du message, ou l'équipe.
create or replace function public.com_supprimer_commentaire(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_moi uuid := public.com_moi();
  c     public.com_commentaires;
  v_aut uuid;
  v_n   integer;
begin
  select * into c from public.com_commentaires where id = p_id;

  if not found then
    return jsonb_build_object('supprime', false);
  end if;

  select auteur_id into v_aut from public.com_posts where id = c.post_id;

  if c.auteur_id <> v_moi and v_aut is distinct from v_moi and not public.est_equipe() then
    raise exception 'Tu ne peux pas supprimer ce commentaire.';
  end if;

  -- Le message est verrouillé le temps de compter : deux suppressions ou un
  -- commentaire arrivé au même instant ne faussent pas le compteur.
  perform 1 from public.com_posts where id = c.post_id for update;

  -- Ses réponses, leurs réactions et le compteur du message suivent
  -- (voir les déclencheurs « com_nettoyer_* » plus bas).
  delete from public.com_commentaires where id = p_id;

  select nb_commentaires into v_n from public.com_posts where id = c.post_id;

  return jsonb_build_object('supprime', true, 'nb_commentaires', v_n);
end $$;


-- Réagir à un message ou à un commentaire. Une réaction par membre : en
-- choisir une autre remplace la première ; sans réaction (null), on retire
-- la sienne.
create or replace function public.com_reagir(
  p_type  text,
  p_id    uuid,
  p_emoji text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_moi    uuid := public.com_moi();
  v_auteur uuid;
  v_post   uuid;
  v_auteur_post uuid;
  v_n      integer;
begin
  -- La cible est verrouillée le temps du geste : deux réactions simultanées
  -- se comptent l'une après l'autre.
  if p_type = 'post' then
    select auteur_id, id into v_auteur, v_post from public.com_posts where id = p_id for update;
  elsif p_type = 'commentaire' then
    select auteur_id, post_id into v_auteur, v_post from public.com_commentaires where id = p_id for update;
  else
    raise exception 'On ne réagit qu''à un message ou à un commentaire.';
  end if;

  if v_auteur is null then
    raise exception 'Ce contenu n''existe plus.';
  end if;

  select auteur_id into v_auteur_post from public.com_posts where id = v_post;

  if p_emoji is not null and p_emoji not in ('coeur', 'feu', 'rire', 'bravo', 'cent') then
    raise exception 'Cette réaction n''existe pas.';
  end if;

  if p_emoji is null then

    delete from public.com_reactions
     where user_id = v_moi and cible_type = p_type and cible_id = p_id;

  else

    if public.com_est_bloque(v_moi, v_auteur) or public.com_est_bloque(v_moi, v_auteur_post) then
      raise exception 'Tu ne peux pas réagir à ce contenu.';
    end if;

    perform public.com_limiter('reactions', v_moi);

    insert into public.com_reactions (user_id, cible_type, cible_id, emoji)
    values (v_moi, p_type, p_id, p_emoji)
    on conflict (user_id, cible_type, cible_id) do update set emoji = excluded.emoji;

    perform public.com_notifier(
      v_auteur, 'reaction', v_moi, v_post,
      case when p_type = 'commentaire' then p_id end,
      p_emoji,
      'reaction:' || v_moi::text || ':' || p_type || ':' || p_id::text
    );

  end if;

  select count(*) into v_n
    from public.com_reactions
   where cible_type = p_type and cible_id = p_id;

  if p_type = 'post' then
    update public.com_posts set nb_reactions = v_n where id = p_id;
  else
    update public.com_commentaires set nb_reactions = v_n where id = p_id;
  end if;

  return jsonb_build_object(
    'nb_reactions', v_n,
    'reaction',     p_emoji,
    'reactions',    coalesce((
      select jsonb_agg(jsonb_build_object('emoji', r.emoji, 'n', r.n) order by r.n desc, r.emoji)
        from (
          select emoji, count(*) as n
            from public.com_reactions
           where cible_type = p_type and cible_id = p_id
           group by emoji
        ) r
    ), '[]'::jsonb)
  );
end $$;


create or replace function public.com_favori(p_post uuid, p_actif boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_moi    uuid := public.com_moi();
  v_auteur uuid;
begin
  select auteur_id into v_auteur from public.com_posts where id = p_post;

  if v_auteur is null then
    raise exception 'Ce message n''existe plus.';
  end if;

  if coalesce(p_actif, true) and public.com_est_bloque(v_moi, v_auteur) then
    raise exception 'Tu ne peux pas enregistrer ce message.';
  end if;

  if coalesce(p_actif, true) then
    insert into public.com_favoris (user_id, post_id) values (v_moi, p_post)
    on conflict do nothing;
  else
    delete from public.com_favoris where user_id = v_moi and post_id = p_post;
  end if;

  return jsonb_build_object('favori', coalesce(p_actif, true));
end $$;


-- ---------------------------------------------------------------------
-- 10. Se trouver : abonnements, blocages, profil
-- ---------------------------------------------------------------------

create or replace function public.com_suivre(p_id uuid, p_actif boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_moi uuid := public.com_moi();
  v_n   integer;
begin
  if p_id is null or p_id = v_moi then
    raise exception 'Tu ne peux pas t''abonner à toi-même.';
  end if;

  if not exists (select 1 from public.profiles where id = p_id) then
    raise exception 'Ce membre n''existe pas.';
  end if;

  if coalesce(p_actif, true) then

    if public.com_est_bloque(v_moi, p_id) then
      raise exception 'Tu ne peux pas suivre ce membre.';
    end if;

    if not exists (select 1 from public.com_suivis where suiveur_id = v_moi and suivi_id = p_id) then
      perform public.com_limiter('suivis', v_moi);

      insert into public.com_suivis (suiveur_id, suivi_id) values (v_moi, p_id)
      on conflict do nothing;

      perform public.com_notifier(p_id, 'suivi', v_moi, null, null, null, 'suivi:' || v_moi::text);
    end if;

  else
    delete from public.com_suivis where suiveur_id = v_moi and suivi_id = p_id;
  end if;

  select count(*) into v_n from public.com_suivis where suivi_id = p_id;

  return jsonb_build_object('suit', coalesce(p_actif, true), 'abonnes', v_n);
end $$;


-- Bloquer : plus d'abonnement dans aucun sens, plus de messages privés, plus
-- de contenus de l'autre dans son fil.
create or replace function public.com_bloquer(p_id uuid, p_actif boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_moi uuid := public.com_moi();
begin
  if p_id is null or p_id = v_moi then
    raise exception 'Tu ne peux pas te bloquer toi-même.';
  end if;

  if not exists (select 1 from public.profiles where id = p_id) then
    raise exception 'Ce membre n''existe pas.';
  end if;

  if coalesce(p_actif, true) then
    insert into public.com_blocages (user_id, bloque_id) values (v_moi, p_id)
    on conflict do nothing;

    delete from public.com_suivis
     where (suiveur_id = v_moi and suivi_id = p_id)
        or (suiveur_id = p_id and suivi_id = v_moi);
  else
    delete from public.com_blocages where user_id = v_moi and bloque_id = p_id;
  end if;

  return jsonb_build_object('bloque', coalesce(p_actif, true));
end $$;


-- Ce que le profil dit de soi : la ville, ce que l'on cherche, ce que l'on
-- propose, les styles. Les métiers doivent exister dans com_metiers.
create or replace function public.com_maj_profil(
  p_ville   text    default null,
  p_cherche text[]  default '{}',
  p_propose text[]  default '{}',
  p_genres  text[]  default '{}'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_moi     uuid := public.com_moi();
  v_ville   text := nullif(btrim(coalesce(p_ville, '')), '');
  v_cherche text[];
  v_propose text[];
  v_genres  text[];
begin
  if char_length(coalesce(v_ville, '')) > 60 then
    raise exception 'La ville est trop longue (60 caractères au plus).';
  end if;

  select coalesce(array(
    select distinct m.cle from public.com_metiers m
     where m.actif and m.cle = any (coalesce(p_cherche, '{}'::text[]))
  ), '{}'::text[]) into v_cherche;

  select coalesce(array(
    select distinct m.cle from public.com_metiers m
     where m.actif and m.cle = any (coalesce(p_propose, '{}'::text[]))
  ), '{}'::text[]) into v_propose;

  select coalesce(array(
    select s from (
      select distinct btrim(x) as s from unnest(coalesce(p_genres, '{}'::text[])) as x
    ) q
    where char_length(s) between 2 and 24
    limit 6
  ), '{}'::text[]) into v_genres;

  if cardinality(v_cherche) > 8 or cardinality(v_propose) > 8 then
    raise exception 'Huit métiers au plus.';
  end if;

  update public.profiles
     set ville = v_ville,
         cherche = v_cherche,
         propose = v_propose,
         genres = v_genres,
         derniere_activite = clock_timestamp()
   where id = v_moi;

  return jsonb_build_object(
    'ville', v_ville, 'cherche', to_jsonb(v_cherche),
    'propose', to_jsonb(v_propose), 'genres', to_jsonb(v_genres)
  );
end $$;


-- ---------------------------------------------------------------------
-- 11. Les messages privés
-- ---------------------------------------------------------------------

-- Ouvre (ou retrouve) la conversation avec un membre. Rien n'est visible
-- de l'autre côté tant qu'aucun message n'est envoyé.
create or replace function public.com_ouvrir_conversation(p_avec uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_moi uuid := public.com_moi();
  v_cle text;
  v_id  uuid;
  v_n   integer;
begin
  if p_avec is null or p_avec = v_moi then
    raise exception 'Choisis quelqu''un d''autre.';
  end if;

  if not exists (select 1 from public.profiles where id = p_avec) then
    raise exception 'Ce membre n''existe pas.';
  end if;

  if public.com_est_bloque(v_moi, p_avec) then
    raise exception 'Tu ne peux pas écrire à ce membre.';
  end if;

  v_cle := least(v_moi::text, p_avec::text) || ':' || greatest(v_moi::text, p_avec::text);

  select id into v_id from public.com_conversations where cle = v_cle;

  if v_id is null then

    -- Le démarchage : trop de conversations ouvertes en une heure sans que
    -- personne n'ait répondu, et on freine. Idem pour les conversations
    -- ouvertes mais jamais écrites : on ne les empile pas à l'avance.
    if not public.est_equipe() then

      select count(*) into v_n
        from public.com_conversations c
        join public.com_participants p on p.conversation_id = c.id and p.user_id = v_moi
       where c.dernier_message_le is null
         and c.cree_le > now() - interval '1 hour';

      if v_n >= 20 then
        raise exception 'Doucement : écris d''abord aux conversations que tu as ouvertes.';
      end if;

      select count(*) into v_n
        from public.com_conversations c
        join public.com_participants p on p.conversation_id = c.id and p.user_id = v_moi
       where c.cree_le > now() - interval '1 hour'
         and (select m.auteur_id from public.com_messages m
               where m.conversation_id = c.id order by m.cree_le limit 1) = v_moi;

      if v_n >= 15 then
        raise exception 'Doucement : tu as écrit à beaucoup de monde en peu de temps.';
      end if;
    end if;

    insert into public.com_conversations (cle) values (v_cle)
    on conflict (cle) do nothing
    returning id into v_id;

    if v_id is null then
      select id into v_id from public.com_conversations where cle = v_cle;
    end if;

    insert into public.com_participants (conversation_id, user_id)
    values (v_id, v_moi), (v_id, p_avec)
    on conflict do nothing;
  end if;

  return jsonb_build_object('id', v_id);
end $$;


create or replace function public.com_envoyer(p_conversation uuid, p_contenu text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_moi     uuid := public.com_moi();
  v_contenu text := btrim(coalesce(p_contenu, ''));
  v_autre   uuid;
  v_id      uuid;
  v_quand   timestamptz;
  v_n       integer;
begin
  if v_contenu = '' then
    raise exception 'Écris quelque chose avant d''envoyer.';
  end if;

  if char_length(v_contenu) > 2000 then
    raise exception 'Ton message est trop long (2 000 caractères au plus).';
  end if;

  if not exists (
    select 1 from public.com_participants
     where conversation_id = p_conversation and user_id = v_moi
  ) then
    raise exception 'Cette conversation n''existe pas.';
  end if;

  select user_id into v_autre
    from public.com_participants
   where conversation_id = p_conversation and user_id <> v_moi;

  if public.com_est_bloque(v_moi, v_autre) then
    raise exception 'Tu ne peux plus écrire dans cette conversation.';
  end if;

  perform public.com_limiter('messages', v_moi);

  -- Un premier message à quelqu'un qui n'a encore rien reçu : quinze par
  -- heure au plus (les réponses, elles, ne sont pas comptées).
  if not public.est_equipe()
     and not exists (select 1 from public.com_messages where conversation_id = p_conversation) then

    select count(*) into v_n
      from public.com_messages m
     where m.auteur_id = v_moi
       and m.cree_le > now() - interval '1 hour'
       and m.cree_le = (select min(x.cree_le) from public.com_messages x
                         where x.conversation_id = m.conversation_id);

    if v_n >= 15 then
      raise exception 'Doucement : tu as écrit à beaucoup de monde en peu de temps.';
    end if;
  end if;

  v_quand := clock_timestamp();

  insert into public.com_messages (conversation_id, auteur_id, contenu, cree_le)
  values (p_conversation, v_moi, v_contenu, v_quand)
  returning id into v_id;

  update public.com_conversations
     set dernier_message_le = v_quand,
         dernier_auteur_id  = v_moi,
         dernier_extrait    = left(v_contenu, 140)
   where id = p_conversation;

  update public.com_participants
     set lu_le = v_quand
   where conversation_id = p_conversation and user_id = v_moi;

  update public.profiles set derniere_activite = v_quand where id = v_moi;

  return jsonb_build_object(
    'id', v_id, 'auteur_id', v_moi, 'contenu', v_contenu, 'cree_le', v_quand
  );
end $$;


create or replace function public.com_lire(p_conversation uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_moi uuid := public.com_moi();
begin
  update public.com_participants
     set lu_le = clock_timestamp()
   where conversation_id = p_conversation and user_id = v_moi;
end $$;


create or replace function public.com_notifications_lues(p_jusqua timestamptz default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_moi uuid := public.com_moi();
  v_n   integer;
begin
  update public.com_notifications
     set lu_le = clock_timestamp()
   where user_id = v_moi
     and lu_le is null
     and (p_jusqua is null or cree_le <= p_jusqua);

  get diagnostics v_n = row_count;
  return v_n;
end $$;


-- ---------------------------------------------------------------------
-- 12. Signaler, modérer
-- ---------------------------------------------------------------------

create or replace function public.com_signaler(
  p_type    text,
  p_id      uuid,
  p_motif   text,
  p_details text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_moi     uuid := public.com_moi();
  v_details text := nullif(btrim(coalesce(p_details, '')), '');
begin
  if p_type is null or p_type not in ('post', 'commentaire', 'membre') then
    raise exception 'On ne signale qu''un message, un commentaire ou un membre.';
  end if;

  if p_motif is null or p_motif not in ('spam', 'haine', 'harcelement', 'faux', 'autre') then
    raise exception 'Choisis un motif.';
  end if;

  if char_length(coalesce(v_details, '')) > 500 then
    raise exception 'Le détail est trop long (500 caractères au plus).';
  end if;

  if (p_type = 'post' and not exists (select 1 from public.com_posts where id = p_id))
     or (p_type = 'commentaire' and not exists (select 1 from public.com_commentaires where id = p_id))
     or (p_type = 'membre' and not exists (select 1 from public.profiles where id = p_id)) then
    raise exception 'Ce contenu n''existe plus.';
  end if;

  if p_type = 'membre' and p_id = v_moi then
    raise exception 'Tu ne peux pas te signaler toi-même.';
  end if;

  perform public.com_limiter('signalements', v_moi);

  insert into public.com_signalements (auteur_id, cible_type, cible_id, motif, details)
  values (v_moi, p_type, p_id, p_motif, v_details)
  on conflict (auteur_id, cible_type, cible_id) do nothing;

  return jsonb_build_object('ok', true);
end $$;


-- La file de l'équipe : les signalements pas encore traités, avec de quoi
-- juger sans rien ouvrir.
create or replace function public.com_signalements_liste()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.com_moi();

  if not public.est_equipe() then
    raise exception 'Réservé à l''équipe.';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id',         s.id,
      'motif',      s.motif,
      'details',    s.details,
      'cree_le',    s.cree_le,
      'auteur',     public.com_auteur_json(s.auteur_id),
      'cible_type', s.cible_type,
      'cible_id',   s.cible_id,
      'cible',      case s.cible_type
        when 'post' then (
          select jsonb_build_object(
            'post_id', p.id, 'extrait', left(p.contenu, 240),
            'auteur', public.com_auteur_json(p.auteur_id)
          ) from public.com_posts p where p.id = s.cible_id)
        when 'commentaire' then (
          select jsonb_build_object(
            'post_id', c.post_id, 'extrait', left(c.contenu, 240),
            'auteur', public.com_auteur_json(c.auteur_id)
          ) from public.com_commentaires c where c.id = s.cible_id)
        else public.com_auteur_json(s.cible_id)
      end
    ) order by s.cree_le desc)
    from (
      select * from public.com_signalements g
       where g.traite_le is null
         and case g.cible_type
               when 'post'        then exists (select 1 from public.com_posts where id = g.cible_id)
               when 'commentaire' then exists (select 1 from public.com_commentaires where id = g.cible_id)
               else exists (select 1 from public.profiles where id = g.cible_id)
             end
       order by g.cree_le desc
       limit 100
    ) s
  ), '[]'::jsonb);
end $$;


-- Traiter un signalement : supprimer ce qui est signalé, ou l'écarter. Tous
-- les signalements sur la même cible sont soldés d'un coup.
create or replace function public.com_traiter_signalement(p_id uuid, p_action text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_moi uuid := public.com_moi();
  s     public.com_signalements;
begin
  if not public.est_equipe() then
    raise exception 'Réservé à l''équipe.';
  end if;

  if p_action not in ('supprimer', 'ignorer') then
    raise exception 'Action inconnue.';
  end if;

  select * into s from public.com_signalements where id = p_id;

  if not found then
    raise exception 'Ce signalement n''existe plus.';
  end if;

  if p_action = 'supprimer' then
    if s.cible_type = 'post' then
      perform public.com_supprimer_post(s.cible_id);
    elsif s.cible_type = 'commentaire' then
      perform public.com_supprimer_commentaire(s.cible_id);
    end if;
  end if;

  update public.com_signalements
     set traite_le = clock_timestamp(), traite_par = v_moi
   where cible_type = s.cible_type and cible_id = s.cible_id and traite_le is null;

  return jsonb_build_object('ok', true);
end $$;


-- ---------------------------------------------------------------------
-- 12 bis. Garder les comptes justes
--
-- Quand un message, un commentaire ou un compte disparaît, ce qui s'y
-- rattachait (réactions, signalements, compteurs) le suit. Ces
-- déclencheurs couvrent aussi la suppression d'un compte, que les
-- fonctions ci-dessus ne voient pas passer.
-- ---------------------------------------------------------------------

create or replace function public.com_nettoyer_reaction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.cible_type = 'post' then
    update public.com_posts
       set nb_reactions = (select count(*) from public.com_reactions
                            where cible_type = 'post' and cible_id = old.cible_id)
     where id = old.cible_id;
  else
    update public.com_commentaires
       set nb_reactions = (select count(*) from public.com_reactions
                            where cible_type = 'commentaire' and cible_id = old.cible_id)
     where id = old.cible_id;
  end if;

  return null;
end $$;

create or replace function public.com_nettoyer_post()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.com_reactions where cible_type = 'post' and cible_id = old.id;

  update public.com_signalements
     set traite_le = clock_timestamp()
   where cible_type = 'post' and cible_id = old.id and traite_le is null;

  return null;
end $$;

create or replace function public.com_nettoyer_commentaire()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.com_reactions where cible_type = 'commentaire' and cible_id = old.id;

  update public.com_signalements
     set traite_le = clock_timestamp()
   where cible_type = 'commentaire' and cible_id = old.id and traite_le is null;

  update public.com_posts
     set nb_commentaires = (select count(*) from public.com_commentaires where post_id = old.post_id)
   where id = old.post_id;

  return null;
end $$;

drop trigger if exists com_nettoyer_reaction on public.com_reactions;
create trigger com_nettoyer_reaction
  after delete on public.com_reactions
  for each row execute function public.com_nettoyer_reaction();

drop trigger if exists com_nettoyer_post on public.com_posts;
create trigger com_nettoyer_post
  after delete on public.com_posts
  for each row execute function public.com_nettoyer_post();

drop trigger if exists com_nettoyer_commentaire on public.com_commentaires;
create trigger com_nettoyer_commentaire
  after delete on public.com_commentaires
  for each row execute function public.com_nettoyer_commentaire();


-- ---------------------------------------------------------------------
-- 13. Les droits
--
-- Les tables : sécurité par ligne activée, aucune règle, aucun droit
-- direct — le navigateur ne peut ni les lire ni les écrire. Seules les
-- fonctions ci-dessus, qui s'exécutent avec les droits de leur auteur, y
-- touchent.
--
-- Les fonctions : on retire tout à tout le monde, puis on rend à chacun ce
-- qui lui revient. Les outils internes (com_moi, com_limiter...) restent
-- fermés : seules les autres fonctions les appellent.
-- ---------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'com_reglages', 'com_metiers', 'com_sujets', 'com_posts',
    'com_commentaires', 'com_reactions', 'com_favoris', 'com_suivis',
    'com_blocages', 'com_conversations', 'com_participants', 'com_messages',
    'com_notifications', 'com_signalements', 'com_cadence'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
  end loop;
end $$;

do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as signature
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname like 'com\_%'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.signature);
  end loop;
end $$;

-- Ouvert à tous, visiteurs compris.
grant execute on function public.com_referentiel()                      to anon, authenticated;
grant execute on function public.com_fil(
  text, text, text, text, uuid, text, timestamptz, timestamptz, integer, integer, boolean
)                                                                       to anon, authenticated;
grant execute on function public.com_post(uuid)                         to anon, authenticated;
grant execute on function public.com_profil(text)                       to anon, authenticated;
grant execute on function public.com_nb_posts(uuid)                     to anon, authenticated;
grant execute on function public.com_membres(
  text, text, text, text, text, text, integer, integer
)                                                                       to anon, authenticated;
grant execute on function public.com_suggestions(integer)               to anon, authenticated;
grant execute on function public.com_tendances()                        to anon, authenticated;
grant execute on function public.com_chercher(text)                     to anon, authenticated;
grant execute on function public.com_compteurs()                        to anon, authenticated;

-- Réservé aux comptes connectés.
grant execute on function public.com_notifications(timestamptz, integer) to authenticated;
grant execute on function public.com_conversations()                     to authenticated;
grant execute on function public.com_messages(uuid, timestamptz, integer) to authenticated;
grant execute on function public.com_publier(text, text, text, text[], text, jsonb) to authenticated;
grant execute on function public.com_modifier_post(uuid, text)           to authenticated;
grant execute on function public.com_supprimer_post(uuid)                to authenticated;
grant execute on function public.com_epingler(uuid, boolean)             to authenticated;
grant execute on function public.com_commenter(uuid, text, uuid)         to authenticated;
grant execute on function public.com_supprimer_commentaire(uuid)         to authenticated;
grant execute on function public.com_reagir(text, uuid, text)            to authenticated;
grant execute on function public.com_favori(uuid, boolean)               to authenticated;
grant execute on function public.com_suivre(uuid, boolean)               to authenticated;
grant execute on function public.com_bloquer(uuid, boolean)              to authenticated;
grant execute on function public.com_maj_profil(text, text[], text[], text[]) to authenticated;
grant execute on function public.com_ouvrir_conversation(uuid)           to authenticated;
grant execute on function public.com_envoyer(uuid, text)                 to authenticated;
grant execute on function public.com_lire(uuid)                          to authenticated;
grant execute on function public.com_notifications_lues(timestamptz)     to authenticated;
grant execute on function public.com_signaler(text, uuid, text, text)    to authenticated;
grant execute on function public.com_signalements_liste()                to authenticated;
grant execute on function public.com_traiter_signalement(uuid, text)     to authenticated;


commit;


-- ---------------------------------------------------------------------
-- Pour tout défaire (les tables du forum d'avant ne sont pas touchées) :
--
--   drop table if exists public.com_cadence, public.com_signalements, public.com_notifications,
--     public.com_messages, public.com_participants, public.com_conversations,
--     public.com_blocages, public.com_suivis, public.com_favoris,
--     public.com_reactions, public.com_commentaires, public.com_posts,
--     public.com_sujets, public.com_metiers, public.com_reglages cascade;
--   alter table public.profiles
--     drop column if exists ville, drop column if exists cherche,
--     drop column if exists propose, drop column if exists genres,
--     drop column if exists derniere_activite;
--   (puis supprimer les fonctions com_* depuis l'éditeur de fonctions)
-- ---------------------------------------------------------------------
