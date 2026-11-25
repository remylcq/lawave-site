-- ============================================================
-- DURCISSEMENT INTERNE (2026-11-25)
--
-- 1. Journal d'audit des actions de l'équipe (qui a fait quoi, quand).
-- 2. Alertes de sécurité (nouvel accès équipe, pic d'inscriptions, requêtes bloquées…) + notification push à l'équipe.
-- 3. Limite de débit sur l'API (appels RPC et écritures) via le « pre-request » de PostgREST.
-- 4. Double authentification (TOTP) de l'équipe : prête, désactivée par défaut, activable depuis l'onglet Sécurité.
--
-- Rien ne change pour les visiteurs : limites larges, 2FA non exigée tant que le propriétaire ne l'active pas.
--
-- INTERRUPTEURS DE SECOURS (à passer dans le SQL Editor) :
--   -- couper la limite de débit tout de suite :
--   update public.reglages_securite set valeur = 'false' where cle = 'debit_actif';
--   -- ou la retirer complètement :
--   alter role authenticator reset pgrst.db_pre_request;  notify pgrst, 'reload config';
--   -- ne plus exiger la 2FA de l'équipe :
--   update public.reglages_securite set valeur = 'false' where cle = 'mfa_equipe_exigee';
-- ============================================================


-- ---------- Réglages ----------

create table if not exists public.reglages_securite (
  cle        text primary key,
  valeur     jsonb not null,
  modifie_le timestamptz not null default now()
);

alter table public.reglages_securite enable row level security;
revoke all on table public.reglages_securite from anon, authenticated;

insert into public.reglages_securite (cle, valeur) values
  ('debit_actif',        'true'),
  ('debit_global_anon',  '1500'),
  ('debit_global_membre','1200'),
  ('debit_par_fonction', '300'),
  ('mfa_equipe_exigee',  'false')
on conflict (cle) do nothing;

create or replace function public.reglage_securite(p_cle text) returns jsonb
language sql stable security definer set search_path = public as $$
  select valeur from public.reglages_securite where cle = p_cle
$$;

revoke all on function public.reglage_securite(text) from public, anon, authenticated;


-- ---------- Journal d'audit ----------

create table if not exists public.journal_audit (
  id            bigint generated always as identity primary key,
  le            timestamptz not null default now(),
  acteur        uuid,
  acteur_pseudo text,
  action        text not null,
  cible         text,
  detail        jsonb not null default '{}'::jsonb
);

create index if not exists journal_audit_le_idx on public.journal_audit (le desc);

alter table public.journal_audit enable row level security;
revoke all on table public.journal_audit from anon, authenticated;

create or replace function public.audit_noter(p_action text, p_cible text, p_detail jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_acteur uuid := auth.uid();
begin
  insert into public.journal_audit (acteur, acteur_pseudo, action, cible, detail)
  values (v_acteur, (select p.pseudo from public.profiles p where p.id = v_acteur), p_action, left(p_cible, 200), coalesce(p_detail, '{}'::jsonb));
exception when others then
  null;
end $$;

revoke all on function public.audit_noter(text, text, jsonb) from public, anon, authenticated;


-- ---------- Alertes ----------

create table if not exists public.alertes_securite (
  id      bigint generated always as identity primary key,
  le      timestamptz not null default now(),
  niveau  text not null check (niveau in ('info', 'attention', 'critique')),
  genre   text not null,
  message text not null,
  lue_le  timestamptz
);

create index if not exists alertes_securite_le_idx on public.alertes_securite (le desc);

alter table public.alertes_securite enable row level security;
revoke all on table public.alertes_securite from anon, authenticated;

-- Une alerte d'un même genre n'est créée qu'une fois par heure (sauf p_toujours), et prévient l'équipe par push
-- (seulement ceux qui ont activé les alertes sur un appareil : voir sql/push.sql).
create or replace function public.alerte_creer(p_niveau text, p_genre text, p_message text, p_toujours boolean default false)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not p_toujours and exists (
    select 1 from public.alertes_securite where genre = p_genre and le > now() - interval '1 hour'
  ) then
    return;
  end if;

  insert into public.alertes_securite (niveau, genre, message) values (p_niveau, p_genre, left(p_message, 400));

  if p_niveau in ('attention', 'critique') then
    insert into public.push_file (user_id, titre, corps, url)
    select p.id, 'Sécurité La Wave', left(p_message, 180), '/'
      from public.profiles p
     where p.is_admin
       and exists (select 1 from public.push_abonnements a where a.user_id = p.id);
  end if;
exception when others then
  null;
end $$;

revoke all on function public.alerte_creer(text, text, text, boolean) from public, anon, authenticated;


-- ---------- Déclencheurs d'audit ----------

create or replace function public.audit_profils() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then

    if new.is_admin is distinct from old.is_admin then
      perform public.audit_noter(
        case when new.is_admin then 'équipe : accès donné' else 'équipe : accès retiré' end,
        coalesce(new.pseudo, '?') || ' (' || new.id || ')', '{}'::jsonb);

      if new.is_admin then
        perform public.alerte_creer('critique', 'nouvel_admin',
          'Un accès équipe vient d''être donné à ' || coalesce(new.pseudo, 'un compte') || '. Si ce n''est pas toi, coupe-le tout de suite (onglet Membres).', true);
      end if;
    end if;

    if new.verifie is distinct from old.verifie then
      perform public.audit_noter(
        case when new.verifie then 'profil : vérifié' else 'profil : vérification retirée' end,
        coalesce(new.pseudo, '?') || ' (' || new.id || ')', jsonb_build_object('role', new.verifie_role));
    end if;

  elsif tg_op = 'DELETE' then

    perform public.audit_noter('membre : compte supprimé',
      coalesce(old.pseudo, '?') || ' (' || old.id || ')',
      jsonb_build_object('role', old.role, 'était_équipe', coalesce(old.is_admin, false)));

  end if;

  return null;
exception when others then
  return null;
end $$;

drop trigger if exists audit_profils_maj on public.profiles;
create trigger audit_profils_maj
  after update of is_admin, verifie on public.profiles
  for each row execute function public.audit_profils();

drop trigger if exists audit_profils_suppr on public.profiles;
create trigger audit_profils_suppr
  after delete on public.profiles
  for each row execute function public.audit_profils();


create or replace function public.audit_bannis() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.audit_noter('artiste : banni', coalesce(new.nom, '?'), jsonb_build_object('raison', new.raison));
  else
    perform public.audit_noter('artiste : bannissement levé', coalesce(old.nom, '?'), '{}'::jsonb);
  end if;
  return null;
exception when others then
  return null;
end $$;

drop trigger if exists audit_bannis_trig on public.artistes_bannis;
create trigger audit_bannis_trig
  after insert or delete on public.artistes_bannis
  for each row execute function public.audit_bannis();


create or replace function public.audit_acces_testeurs() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.audit_noter('accès testeur : créé', coalesce(new.nom, new.email), '{}'::jsonb);
  elsif tg_op = 'DELETE' then
    perform public.audit_noter('accès testeur : supprimé', coalesce(old.nom, old.email), '{}'::jsonb);
  elsif new.revoque_le is distinct from old.revoque_le then
    perform public.audit_noter(case when new.revoque_le is null then 'accès testeur : rétabli' else 'accès testeur : révoqué' end,
                               coalesce(new.nom, new.email), '{}'::jsonb);
  end if;
  return null;
exception when others then
  return null;
end $$;

drop trigger if exists audit_acces_testeurs_trig on public.acces_testeurs;
create trigger audit_acces_testeurs_trig
  after insert or update of revoque_le or delete on public.acces_testeurs
  for each row execute function public.audit_acces_testeurs();


-- Seulement les gestes d'une personne connectée (les tâches planifiées n'ont pas d'utilisateur).
create or replace function public.audit_artistes() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then
    perform public.audit_noter('artiste : supprimé',
      coalesce(to_jsonb(old) ->> 'name', to_jsonb(old) ->> 'nom', to_jsonb(old) ->> 'pseudo', old.id::text), '{}'::jsonb);
  end if;
  return null;
exception when others then
  return null;
end $$;

drop trigger if exists audit_artistes_suppr on public.artists;
create trigger audit_artistes_suppr
  after delete on public.artists
  for each row execute function public.audit_artistes();


create or replace function public.audit_verifications() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and new.statut is distinct from old.statut and new.statut in ('valide', 'refuse', 'retire') then
    perform public.audit_noter('vérification : ' || new.statut, new.user_id::text, jsonb_build_object('role', new.role));
  end if;
  return null;
exception when others then
  return null;
end $$;

drop trigger if exists audit_verifications_trig on public.verifications_profil;
create trigger audit_verifications_trig
  after update of statut on public.verifications_profil
  for each row execute function public.audit_verifications();


revoke all on function public.audit_profils(), public.audit_bannis(), public.audit_acces_testeurs(), public.audit_artistes(), public.audit_verifications()
  from public, anon, authenticated;


-- ---------- Limite de débit ----------

create unlogged table if not exists public.limites_debit (
  cle     text not null,
  debut   timestamptz not null,
  n       integer not null default 0,
  plafond integer not null default 0,
  primary key (cle, debut)
);

alter table public.limites_debit enable row level security;
revoke all on table public.limites_debit from anon, authenticated;

-- Exécutée par PostgREST avant chaque requête (alter role authenticator … plus bas). Compte les requêtes par minute et par
-- identité (le membre connecté, sinon l'adresse IP), au total et par fonction RPC. Au-delà du plafond : réponse 429.
-- Aucune erreur interne ne bloque jamais une requête : seule la limite elle-même le fait. Les clés de service (tâches
-- planifiées, fonctions Edge) ne sont pas comptées. PostgREST ouvre en lecture seule les lectures de tables (GET) et les
-- fonctions déclarées STABLE : leur compteur ne peut pas s'écrire, elles ne sont donc pas limitées ici (c'est le travail
-- de Cloudflare). Vérifié en production : les appels de fonctions qui écrivent sont comptés, pas ces lectures.
create or replace function public.pre_requete() returns void
language plpgsql security definer set search_path = public as $$
declare
  v_claims  jsonb;
  v_head    jsonb;
  v_role    text;
  v_id      text;
  v_chemin  text;
  v_fn      text;
  v_debut   timestamptz := date_trunc('minute', now());
  v_plafond integer;
  v_n       integer;
  v_trop    boolean := false;
begin

  begin

    if coalesce(public.reglage_securite('debit_actif'), 'true'::jsonb) <> 'true'::jsonb then
      return;
    end if;

    v_claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
    v_role   := coalesce(v_claims ->> 'role', 'anon');

    if v_role = 'service_role' then
      return;
    end if;

    if v_role = 'authenticated' and coalesce(v_claims ->> 'sub', '') <> '' then
      v_id := 'u:' || (v_claims ->> 'sub');
      v_plafond := coalesce((public.reglage_securite('debit_global_membre'))::text::integer, 1200);
    else
      v_head := coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}'::jsonb);
      v_id := 'i:' || coalesce(
        nullif(trim(v_head ->> 'cf-connecting-ip'), ''),
        nullif(trim(split_part(coalesce(v_head ->> 'x-forwarded-for', ''), ',', 1)), ''),
        nullif(trim(v_head ->> 'x-real-ip'), ''),
        'inconnue');
      v_plafond := coalesce((public.reglage_securite('debit_global_anon'))::text::integer, 1500);
    end if;

    insert into public.limites_debit as l (cle, debut, n, plafond) values (v_id, v_debut, 1, v_plafond)
    on conflict (cle, debut) do update set n = l.n + 1, plafond = excluded.plafond
    returning l.n into v_n;

    if v_n > v_plafond then
      v_trop := true;
    else

      v_chemin := coalesce(current_setting('request.path', true), '');

      if v_chemin like '/rpc/%' then

        v_fn := left(substr(v_chemin, 6), 80);
        v_plafond := coalesce((public.reglage_securite('debit_par_fonction'))::text::integer, 300);

        insert into public.limites_debit as l (cle, debut, n, plafond) values (v_id || '|' || v_fn, v_debut, 1, v_plafond)
        on conflict (cle, debut) do update set n = l.n + 1, plafond = excluded.plafond
        returning l.n into v_n;

        if v_n > v_plafond then
          v_trop := true;
        end if;
      end if;
    end if;

  exception when others then
    return;
  end;

  if v_trop then
    raise exception 'Trop de requêtes : réessaie dans une minute.' using errcode = 'PT429', hint = 'limite de débit';
  end if;
end $$;

revoke all on function public.pre_requete() from public;
grant execute on function public.pre_requete() to anon, authenticated, service_role;


-- ---------- Veille (toutes les 5 minutes) ----------

create or replace function public.securite_veiller() returns void
language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin

  select count(*) into v_n from auth.users where created_at > now() - interval '10 minutes';
  if v_n >= 8 then
    perform public.alerte_creer('attention', 'inscriptions',
      v_n || ' comptes créés en 10 minutes, c''est inhabituel. L''inscription est ouverte à tous : vérifie qu''il ne s''agit pas d''un robot (onglet Membres).');
  end if;

  select count(distinct l.cle) into v_n
    from public.limites_debit l
   where l.plafond > 0 and l.n >= l.plafond and l.debut > now() - interval '10 minutes';
  if v_n > 0 then
    perform public.alerte_creer('attention', 'debit',
      v_n || ' source(s) ont été bloquées par la limite de débit ces 10 dernières minutes (trop de requêtes).');
  end if;

  select count(*) into v_n from public.journal_audit where le > now() - interval '10 minutes' and acteur is not null;
  if v_n >= 30 then
    perform public.alerte_creer('attention', 'rafale',
      v_n || ' actions d''équipe en 10 minutes : si ce n''est pas toi, regarde le journal.');
  end if;

exception when others then
  null;
end $$;

revoke all on function public.securite_veiller() from public, anon, authenticated;

create or replace function public.securite_nettoyer() returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from public.limites_debit where debut < now() - interval '15 minutes';
  delete from public.alertes_securite where le < now() - interval '180 days';
end $$;

revoke all on function public.securite_nettoyer() from public, anon, authenticated;

select cron.schedule('securite-veille',    '*/5 * * * *',  'select public.securite_veiller()');
select cron.schedule('securite-nettoyage', '*/10 * * * *', 'select public.securite_nettoyer()');


-- ---------- Double authentification de l'équipe ----------

-- Même règle qu'avant, avec une exigence en plus quand le réglage « mfa_equipe_exigee » est vrai : la session doit
-- avoir passé le second facteur (aal2).
create or replace function public.est_equipe() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select p.is_admin from public.profiles p where p.id = auth.uid())
    and (
      coalesce(public.reglage_securite('mfa_equipe_exigee'), 'false'::jsonb) <> 'true'::jsonb
      or coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
    ),
    false
  );
$$;

create or replace function public.est_admin_lawave() returns boolean
language sql stable security definer set search_path = public as $$
  select public.est_equipe();
$$;

-- Donner ou retirer l'accès admin : propriétaire seulement (comme avant), et avec la 2FA validée si elle est exigée.
create or replace function public.membre_acces_regler(p_id uuid, p_admin boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_cible public.profiles%rowtype;
begin

  if auth.uid() is null then
    raise exception 'Connecte-toi.';
  end if;

  if not coalesce((select p.proprietaire from public.profiles p where p.id = auth.uid()), false) then
    raise exception 'Seul le propriétaire du site peut donner ou retirer l''accès admin.';
  end if;

  if coalesce(public.reglage_securite('mfa_equipe_exigee'), 'false'::jsonb) = 'true'::jsonb
     and coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then
    raise exception 'Valide d''abord ta double authentification (onglet Sécurité).';
  end if;

  if p_id is null or p_admin is null then
    raise exception 'Choisis un membre.';
  end if;

  if p_id = auth.uid() then
    raise exception 'Ton propre accès ne se change pas ici.';
  end if;

  select * into v_cible from public.profiles where id = p_id for update;

  if not found then
    raise exception 'Ce compte n''existe pas.';
  end if;

  if v_cible.proprietaire then
    raise exception 'Le propriétaire garde toujours son accès.';
  end if;

  perform set_config('lawave.acces_ok', '1', true);

  update public.profiles set is_admin = p_admin where id = p_id;

  perform set_config('lawave.acces_ok', '0', true);

  return jsonb_build_object('id', p_id, 'is_admin', p_admin);
end $$;


-- ---------- Ce que l'onglet « Sécurité » lit et règle ----------

create or replace function public.securite_etat() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin

  if not public.est_equipe() then
    raise exception 'Réservé à l''équipe.';
  end if;

  return jsonb_build_object(
    'reglages', (select coalesce(jsonb_object_agg(r.cle, r.valeur), '{}'::jsonb) from public.reglages_securite r),
    'alertes',  (select coalesce(jsonb_agg(to_jsonb(a) order by a.le desc), '[]'::jsonb)
                   from (select id, le, niveau, genre, message, lue_le from public.alertes_securite order by le desc limit 50) a),
    'journal',  (select coalesce(jsonb_agg(to_jsonb(j) order by j.le desc), '[]'::jsonb)
                   from (select id, le, acteur_pseudo, action, cible from public.journal_audit order by le desc limit 100) j),
    'equipe',   (select coalesce(jsonb_agg(jsonb_build_object(
                          'id', p.id, 'pseudo', p.pseudo,
                          'mfa', exists (select 1 from auth.mfa_factors f where f.user_id = p.id and f.status = 'verified')
                        ) order by p.pseudo), '[]'::jsonb)
                   from public.profiles p where p.is_admin),
    'proprietaire', coalesce((select p.proprietaire from public.profiles p where p.id = auth.uid()), false)
  );
end $$;

create or replace function public.securite_alertes_lues() returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.est_equipe() then
    raise exception 'Réservé à l''équipe.';
  end if;
  update public.alertes_securite set lue_le = now() where lue_le is null;
end $$;

-- Règle un interrupteur (propriétaire seulement). Exiger la 2FA suppose que toute l'équipe l'ait déjà activée et que le
-- propriétaire ait lui-même validé sa session : sinon on s'enfermerait dehors.
create or replace function public.securite_regler(p_cle text, p_actif boolean) returns void
language plpgsql security definer set search_path = public as $$
declare v_manquants text;
begin

  if not public.est_equipe() then
    raise exception 'Réservé à l''équipe.';
  end if;

  if not coalesce((select p.proprietaire from public.profiles p where p.id = auth.uid()), false) then
    raise exception 'Seul le propriétaire du site règle la sécurité.';
  end if;

  if p_cle not in ('debit_actif', 'mfa_equipe_exigee') or p_actif is null then
    raise exception 'Réglage inconnu.';
  end if;

  if p_cle = 'mfa_equipe_exigee' and p_actif then

    if coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then
      raise exception 'Valide d''abord ta double authentification sur cette session.';
    end if;

    select string_agg(p.pseudo, ', ') into v_manquants
      from public.profiles p
     where p.is_admin
       and not exists (select 1 from auth.mfa_factors f where f.user_id = p.id and f.status = 'verified');

    if v_manquants is not null then
      raise exception 'Ces comptes de l''équipe n''ont pas encore activé la double authentification : %', v_manquants;
    end if;
  end if;

  update public.reglages_securite set valeur = to_jsonb(p_actif), modifie_le = now() where cle = p_cle;

  perform public.audit_noter('sécurité : réglage', p_cle, jsonb_build_object('actif', p_actif));
end $$;

revoke all on function public.securite_etat(), public.securite_alertes_lues(), public.securite_regler(text, boolean) from public, anon;
grant execute on function public.securite_etat(), public.securite_alertes_lues(), public.securite_regler(text, boolean) to authenticated;


-- ---------- Droits de table : un visiteur sans compte ne peut rien écrire ----------

-- Supabase donne par défaut tous les droits d'écriture à « anon » sur chaque table, et c'est la RLS seule qui les arrête :
-- une table créée un jour sans RLS serait ouverte en écriture au monde entier. On retire les droits, sauf le dépôt d'un
-- signalement de bug (ouvert aux visiteurs sans compte), et pour les tables à venir aussi. TRUNCATE, REFERENCES et TRIGGER
-- ne servent à personne côté API.
revoke insert, update, delete, truncate, references, trigger on all tables in schema public from anon;
grant insert on public.bug_reports to anon;
revoke truncate, references, trigger on all tables in schema public from authenticated;
alter default privileges for role postgres in schema public revoke insert, update, delete, truncate, references, trigger on tables from anon;


-- ---------- Branchement de la limite de débit sur PostgREST (dernier geste) ----------

alter role authenticator set pgrst.db_pre_request = 'public.pre_requete';
notify pgrst, 'reload config';
