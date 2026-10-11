-- =====================================================================
-- La Wave — accès temporaire au site (test privé)            TEMPORAIRE
--
-- Le temps du test, le site n'est visible qu'avec une adresse e-mail et un
-- mot de passe que l'équipe a créés. Ce fichier est la partie « base » :
--
--   • acces_testeurs  : un accès par personne invitée (le mot de passe n'est
--                       jamais conservé en clair, seulement son empreinte) ;
--   • acces_sessions  : les navigateurs déjà entrés (valables 30 jours) ;
--   • acces_tentatives: les essais ratés, pour freiner qui devinerait ;
--   • les fonctions acces_* que le portail (portail.js) et l'espace équipe
--     (onglet « Accès ») appellent.
--
-- Comme pour la communauté, rien n'est lisible ni modifiable en direct :
-- les tables ont la sécurité par ligne activée sans aucune règle, tout
-- passe par les fonctions, qui vérifient qui appelle.
--
-- Créer le tout premier accès (le tien), depuis cet éditeur SQL :
--
--     select public.acces_amorcer('ton.adresse@exemple.fr');
--
-- Le mot de passe s'affiche dans le résultat. Une fois entré sur le site, tu
-- crées les suivants depuis l'espace équipe → onglet « Accès ».
--
-- POUR TOUT RETIRER, UN JOUR : suivre la liste en tête de
-- sql/acces-testeurs-retrait.sql (site d'abord, base ensuite).
--
-- Sans danger si on le relance : rien n'est écrasé ni vidé.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- Un préalable : est_equipe(), comme dans communaute.sql
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
-- Les tables
-- ---------------------------------------------------------------------

create table if not exists public.acces_testeurs (
  email              text primary key check (email = lower(btrim(email))),
  sel                text not null,
  empreinte          text not null,
  nom                text check (nom is null or char_length(nom) <= 120),
  cree_le            timestamptz not null default now(),
  cree_par           uuid references public.profiles(id) on delete set null,
  derniere_connexion timestamptz,
  nb_connexions      integer not null default 0,
  revoque_le         timestamptz
);

create table if not exists public.acces_sessions (
  empreinte text primary key,
  email     text not null references public.acces_testeurs(email) on delete cascade,
  cree_le   timestamptz not null default now(),
  expire_le timestamptz not null
);

create table if not exists public.acces_tentatives (
  id      bigserial primary key,
  email   text not null,
  cree_le timestamptz not null default now()
);

create index if not exists acces_tentatives_idx on public.acces_tentatives (email, cree_le desc);
create index if not exists acces_sessions_expire_idx on public.acces_sessions (expire_le);


-- ---------------------------------------------------------------------
-- Les outils internes (fermés au navigateur, voir les droits plus bas)
-- ---------------------------------------------------------------------

-- Une suite de caractères tirés au hasard, sans les signes qui se
-- confondent (0 O, 1 I). Les octets viennent de gen_random_uuid(), tiré par
-- le générateur aléatoire sûr de Postgres ; les deux octets d'un identifiant
-- dont les bits sont imposés (version, variante) ne sont pas utilisés, pour
-- que chaque signe soit réellement équiprobable.
create or replace function public.acces_aleatoire(p_n integer)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_alphabet constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  v_hex      text := '';
  v_u        text;
  v_sortie   text := '';
  i          integer;
begin
  while char_length(v_hex) < p_n * 2 loop
    v_u := replace(gen_random_uuid()::text, '-', '');
    v_hex := v_hex || substr(v_u, 1, 12) || substr(v_u, 15, 2) || substr(v_u, 19, 14);
  end loop;

  for i in 0 .. p_n - 1 loop
    v_sortie := v_sortie ||
      substr(v_alphabet, (get_byte(decode(substr(v_hex, i * 2 + 1, 2), 'hex'), 0) % 32) + 1, 1);
  end loop;

  return v_sortie;
end $$;

-- Un mot de passe lisible et facile à recopier : XXXX-XXXX-XXXX (60 bits).
create or replace function public.acces_mot_de_passe()
returns text
language sql
volatile
security definer
set search_path = public
as $$
  select substr(s, 1, 4) || '-' || substr(s, 5, 4) || '-' || substr(s, 9, 4)
    from (select public.acces_aleatoire(12) as s) x;
$$;

-- Les mots de passe sont tirés au hasard par la base (jamais choisis par une
-- personne), assez longs pour qu'une empreinte salée suffise.
create or replace function public.acces_empreinte(p_sel text, p_secret text)
returns text
language sql
immutable
as $$
  select encode(sha256(convert_to(p_sel || ':' || upper(btrim(p_secret)), 'UTF8')), 'hex');
$$;

create or replace function public.acces_normaliser(p_email text)
returns text
language sql
immutable
as $$
  select lower(btrim(coalesce(p_email, '')));
$$;

create or replace function public.acces_exiger_equipe()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Connecte-toi pour continuer.';
  end if;

  if not public.est_equipe() then
    raise exception 'Réservé à l''équipe.';
  end if;
end $$;

create or replace function public.acces_valider_email(p_email text)
returns void
language plpgsql
immutable
as $$
begin
  if p_email is null or p_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or char_length(p_email) > 200 then
    raise exception 'Cette adresse e-mail n''est pas valide.';
  end if;
end $$;


-- ---------------------------------------------------------------------
-- Pour l'équipe : créer, relire, renouveler, retirer
-- ---------------------------------------------------------------------

-- Crée l'accès d'une personne et rend son mot de passe : c'est la seule fois
-- où il est visible.
create or replace function public.acces_creer(p_email text, p_nom text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_email text := public.acces_normaliser(p_email);
  v_nom   text := nullif(btrim(coalesce(p_nom, '')), '');
  v_mdp   text;
  v_sel   text;
begin
  perform public.acces_exiger_equipe();
  perform public.acces_valider_email(v_email);

  if char_length(coalesce(v_nom, '')) > 120 then
    raise exception 'La note est trop longue (120 caractères au plus).';
  end if;

  if exists (select 1 from public.acces_testeurs where email = v_email and revoque_le is null) then
    raise exception 'Cet accès existe déjà : utilise « Nouveau mot de passe ».';
  end if;

  v_mdp := public.acces_mot_de_passe();
  v_sel := public.acces_aleatoire(24);

  insert into public.acces_testeurs (email, sel, empreinte, nom, cree_par)
  values (v_email, v_sel, public.acces_empreinte(v_sel, v_mdp), v_nom, auth.uid())
  on conflict (email) do update
     set sel = excluded.sel, empreinte = excluded.empreinte, nom = coalesce(excluded.nom, public.acces_testeurs.nom),
         cree_le = now(), cree_par = excluded.cree_par, revoque_le = null,
         derniere_connexion = null, nb_connexions = 0;

  delete from public.acces_sessions where email = v_email;

  return jsonb_build_object('email', v_email, 'mot_de_passe', v_mdp, 'nom', v_nom);
end $$;

-- Un nouveau mot de passe pour un accès existant (l'ancien cesse de marcher,
-- les navigateurs déjà entrés sont déconnectés). Rétablit aussi un accès retiré.
create or replace function public.acces_nouveau_mot_de_passe(p_email text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_email text := public.acces_normaliser(p_email);
  v_mdp   text;
  v_sel   text;
begin
  perform public.acces_exiger_equipe();

  if not exists (select 1 from public.acces_testeurs where email = v_email) then
    raise exception 'Cet accès n''existe pas.';
  end if;

  v_mdp := public.acces_mot_de_passe();
  v_sel := public.acces_aleatoire(24);

  update public.acces_testeurs
     set sel = v_sel, empreinte = public.acces_empreinte(v_sel, v_mdp), revoque_le = null
   where email = v_email;

  delete from public.acces_sessions where email = v_email;
  delete from public.acces_tentatives where email = v_email;

  return jsonb_build_object('email', v_email, 'mot_de_passe', v_mdp);
end $$;

-- Retire l'accès : plus de connexion, et les navigateurs entrés sont mis dehors.
create or replace function public.acces_revoquer(p_email text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_email text := public.acces_normaliser(p_email);
begin
  perform public.acces_exiger_equipe();

  update public.acces_testeurs set revoque_le = now() where email = v_email and revoque_le is null;
  delete from public.acces_sessions where email = v_email;

  return jsonb_build_object('email', v_email, 'revoque', true);
end $$;

-- Efface définitivement la ligne d'un accès (pour faire le ménage).
create or replace function public.acces_supprimer(p_email text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_email text := public.acces_normaliser(p_email);
begin
  perform public.acces_exiger_equipe();

  delete from public.acces_testeurs where email = v_email;
  delete from public.acces_tentatives where email = v_email;

  return jsonb_build_object('email', v_email, 'supprime', true);
end $$;

-- Les accès, du plus récent au plus ancien : jamais d'empreinte ni de sel.
create or replace function public.acces_liste()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.acces_exiger_equipe();

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'email', t.email,
      'nom', t.nom,
      'cree_le', t.cree_le,
      'derniere_connexion', t.derniere_connexion,
      'nb_connexions', t.nb_connexions,
      'revoque_le', t.revoque_le,
      'navigateurs', (select count(*) from public.acces_sessions s where s.email = t.email and s.expire_le > now())
    ) order by t.cree_le desc)
    from public.acces_testeurs t
  ), '[]'::jsonb);
end $$;

-- Le tout premier accès, depuis l'éditeur SQL de Supabase (où l'on n'est pas
-- « l'équipe » au sens du site). Personne d'autre ne peut l'appeler.
create or replace function public.acces_amorcer(p_email text)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_email text := public.acces_normaliser(p_email);
  v_mdp   text;
  v_sel   text;
begin
  perform public.acces_valider_email(v_email);

  v_mdp := public.acces_mot_de_passe();
  v_sel := public.acces_aleatoire(24);

  insert into public.acces_testeurs (email, sel, empreinte, nom)
  values (v_email, v_sel, public.acces_empreinte(v_sel, v_mdp), 'Accès de départ')
  on conflict (email) do update
     set sel = excluded.sel, empreinte = excluded.empreinte, revoque_le = null,
         derniere_connexion = null, nb_connexions = 0;

  delete from public.acces_sessions where email = v_email;

  return 'Adresse : ' || v_email || '   Mot de passe : ' || v_mdp;
end $$;


-- ---------------------------------------------------------------------
-- Pour le portail (ouvert à tous, c'est lui qui filtre)
-- ---------------------------------------------------------------------

-- Entrer. En cas d'échec, on rend une réponse (et non une erreur) : une erreur
-- annulerait l'enregistrement de l'essai raté, et la limite ne servirait à rien.
create or replace function public.acces_connecter(p_email text, p_mot_de_passe text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_email  text := public.acces_normaliser(p_email);
  t        public.acces_testeurs;
  v_ratees integer;
  v_jeton  text;
begin
  perform pg_advisory_xact_lock(hashtextextended('acces:' || v_email, 0));

  -- Trop d'essais ratés pour cette adresse : on freine (huit en quinze minutes).
  -- Avec un mot de passe tiré au hasard sur 60 bits, deviner n'a aucune chance.
  select count(*) into v_ratees
    from public.acces_tentatives
   where email = v_email and cree_le > now() - interval '15 minutes';

  if v_ratees >= 8 then
    return jsonb_build_object('ok', false, 'attente', true,
      'erreur', 'Trop d''essais. Réessaie dans quelques minutes.');
  end if;

  select * into t from public.acces_testeurs where email = v_email;

  if not found
     or t.revoque_le is not null
     or t.empreinte is distinct from public.acces_empreinte(t.sel, coalesce(p_mot_de_passe, '')) then

    insert into public.acces_tentatives (email) values (left(v_email, 200));

    -- Un peu de ménage en passant, pour que la table ne grossisse pas.
    if random() < 0.05 then
      delete from public.acces_tentatives where cree_le < now() - interval '1 day';
      delete from public.acces_sessions where expire_le < now();
    end if;

    return jsonb_build_object('ok', false, 'erreur', 'Adresse e-mail ou mot de passe incorrect.');
  end if;

  v_jeton := public.acces_aleatoire(32);

  insert into public.acces_sessions (empreinte, email, expire_le)
  values (encode(sha256(convert_to(v_jeton, 'UTF8')), 'hex'), v_email, now() + interval '30 days');

  update public.acces_testeurs
     set derniere_connexion = now(), nb_connexions = nb_connexions + 1
   where email = v_email;

  delete from public.acces_tentatives where email = v_email;

  return jsonb_build_object('ok', true, 'jeton', v_jeton, 'email', v_email,
                            'expire_le', now() + interval '30 days');
end $$;

-- Le navigateur a-t-il encore le droit d'entrer ? (appelé à chaque ouverture)
create or replace function public.acces_verifier(p_jeton text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('ok', coalesce((
    select true
      from public.acces_sessions s
      join public.acces_testeurs t on t.email = s.email
     where s.empreinte = encode(sha256(convert_to(coalesce(p_jeton, ''), 'UTF8')), 'hex')
       and s.expire_le > now()
       and t.revoque_le is null
  ), false));
$$;


-- ---------------------------------------------------------------------
-- Les droits
-- ---------------------------------------------------------------------

do $$
declare
  t text;
  f record;
begin
  foreach t in array array['acces_testeurs', 'acces_sessions', 'acces_tentatives']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
  end loop;

  for f in
    select p.oid::regprocedure as signature
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname like 'acces\_%'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.signature);
  end loop;
end $$;

-- Ouvert à tous : c'est le portail qui s'en sert.
grant execute on function public.acces_connecter(text, text) to anon, authenticated;
grant execute on function public.acces_verifier(text)        to anon, authenticated;

-- Réservé aux comptes connectés ; chaque fonction vérifie en plus que c'est l'équipe.
grant execute on function public.acces_creer(text, text)           to authenticated;
grant execute on function public.acces_nouveau_mot_de_passe(text)  to authenticated;
grant execute on function public.acces_revoquer(text)              to authenticated;
grant execute on function public.acces_supprimer(text)             to authenticated;
grant execute on function public.acces_liste()                     to authenticated;

notify pgrst, 'reload schema';

commit;
