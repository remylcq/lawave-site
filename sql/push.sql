-- ============================================================
-- Notifications push (idée 90 de Rémy, 2026-11-09) : les alertes du site arrivent aussi sur le téléphone ou l'ordinateur,
-- même quand La Wave n'est pas ouverte.
--
-- Comment ça marche :
--   1. le navigateur de la personne s'abonne (sw.js + confort.js) : push_abonner() garde son « endpoint » et ses clés ;
--   2. une alerte personnelle (réaction, commentaire, réponse, mention, abonné, sortie, rappel d'accréditation) entre dans
--      com_notifications : un déclencheur la met dans push_file, si la personne a un abonnement ;
--   3. chaque minute, push_declencher() réveille la fonction Edge « envoyer-push », qui envoie les messages en attente
--      (web-push, signé avec les clés VAPID de push_config) et retire les abonnements morts.
--
-- push_config est fermée à tous (même aux membres) : seule la fonction Edge la lit, avec la clé de service.
-- Les clés VAPID n'écrivent jamais dans ce dépôt : elles sont insérées à la main (voir la fin du fichier).
--
-- Peut être rejoué sans risque.
-- RETRAIT : select cron.unschedule('push-declencher'); drop trigger if exists com_notifications_push on public.com_notifications;
--   drop function if exists public.com_notifications_push(), public.push_declencher(), public.push_cle_publique(),
--   public.push_abonner(text, text, text), public.push_desabonner(text), public.push_etat(text);
--   drop table if exists public.push_file, public.push_abonnements, public.push_config;
-- ============================================================

create table if not exists public.push_config (
  id          integer primary key default 1 check (id = 1),
  cle_publique text not null,
  cle_privee   text not null,
  secret       text not null,
  contact      text not null default 'contact@lawave.fr'
);

create table if not exists public.push_abonnements (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null references public.profiles(id) on delete cascade,
  endpoint  text not null unique check (char_length(endpoint) <= 600),
  p256dh    text not null check (char_length(p256dh) <= 200),
  auth      text not null check (char_length(auth) <= 100),
  cree_le   timestamptz not null default now()
);

create index if not exists push_abonnements_user_idx on public.push_abonnements (user_id);

create table if not exists public.push_file (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  titre      text not null,
  corps      text not null,
  url        text not null default '/',
  cree_le    timestamptz not null default now(),
  envoye_le  timestamptz
);

create index if not exists push_file_attente_idx on public.push_file (cree_le) where envoye_le is null;

alter table public.push_config enable row level security;
alter table public.push_abonnements enable row level security;
alter table public.push_file enable row level security;
revoke all on table public.push_config, public.push_abonnements, public.push_file from anon, authenticated;

-- La clé publique : le navigateur en a besoin pour s'abonner.
create or replace function public.push_cle_publique() returns text
language sql stable security definer set search_path = public as $$
  select cle_publique from public.push_config where id = 1
$$;

grant execute on function public.push_cle_publique() to anon, authenticated;

create or replace function public.push_abonner(p_endpoint text, p_p256dh text, p_auth text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_moi uuid := auth.uid();
begin
  if v_moi is null then raise exception 'Connexion requise.'; end if;
  if coalesce(p_endpoint, '') !~ '^https://' then raise exception 'Abonnement invalide.'; end if;
  -- Cinq appareils au plus par personne : le plus ancien cède sa place.
  delete from public.push_abonnements where id in (
    select id from public.push_abonnements where user_id = v_moi and endpoint <> p_endpoint order by cree_le desc offset 4);
  insert into public.push_abonnements (user_id, endpoint, p256dh, auth) values (v_moi, p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth;
  return jsonb_build_object('ok', true);
end $$;

grant execute on function public.push_abonner(text, text, text) to authenticated;

create or replace function public.push_desabonner(p_endpoint text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  delete from public.push_abonnements where endpoint = p_endpoint and user_id = auth.uid();
  return jsonb_build_object('ok', true);
end $$;

grant execute on function public.push_desabonner(text) to authenticated;

create or replace function public.push_etat(p_endpoint text) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and exists (select 1 from public.push_abonnements where endpoint = p_endpoint and user_id = auth.uid())
$$;

grant execute on function public.push_etat(text) to authenticated;

-- Une alerte personnelle devient un message push, si la personne a un abonnement (et au plus 8 par heure).
create or replace function public.com_notifications_push() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_pseudo text;
  v_corps  text;
  v_url    text := '/#community/notifications';
  d        jsonb := coalesce(new.donnees, '{}'::jsonb);
begin
  if not exists (select 1 from public.push_abonnements where user_id = new.user_id) then return new; end if;
  if (select count(*) from public.push_file where user_id = new.user_id and cree_le > now() - interval '1 hour') >= 8 then return new; end if;

  select pseudo into v_pseudo from public.profiles where id = new.acteur_id;

  v_corps := case new.type
    when 'reaction'    then coalesce('@' || v_pseudo, 'Quelqu''un') || ' a réagi à ton message'
    when 'commentaire' then coalesce('@' || v_pseudo, 'Quelqu''un') || ' a commenté ton message'
    when 'reponse'     then coalesce('@' || v_pseudo, 'Quelqu''un') || ' t''a répondu'
    when 'suivi'       then coalesce('@' || v_pseudo, 'Quelqu''un') || ' s''est abonné à ton profil'
    when 'mention'     then coalesce('@' || v_pseudo, 'Quelqu''un') || ' t''a mentionné'
    when 'sortie_artiste'   then coalesce(d->>'artiste', 'Un artiste') || ' vient de sortir « ' || coalesce(d->>'titre', 'un nouveau projet') || ' »'
    when 'sortie_a_ecouter' then '« ' || coalesce(d->>'titre', 'Une sortie') || ' » que tu voulais écouter vient de sortir'
    when 'rappel_accreditation' then 'Demain : ' || coalesce(d->>'artiste', 'ton événement') || coalesce(' · ' || nullif(d->>'salle', ''), '')
    else null end;

  if v_corps is null then return new; end if;

  if new.type in ('sortie_artiste', 'sortie_a_ecouter') and coalesce(d->>'numero', '') ~ '^\d+$' then
    v_url := '/#sortie/' || (d->>'numero');
  elsif new.type = 'rappel_accreditation' then
    v_url := '/#accreditations';
  end if;

  insert into public.push_file (user_id, titre, corps, url) values (new.user_id, 'La Wave', v_corps, v_url);
  return new;
end $$;

drop trigger if exists com_notifications_push on public.com_notifications;
create trigger com_notifications_push after insert on public.com_notifications
  for each row execute function public.com_notifications_push();

-- Chaque minute : s'il y a des messages en attente, la fonction Edge les envoie.
create or replace function public.push_declencher() returns void
language plpgsql security definer set search_path = public, extensions as $$
declare v_secret text;
begin
  if not exists (select 1 from public.push_file where envoye_le is null and cree_le > now() - interval '1 day') then return; end if;
  select secret into v_secret from public.push_config where id = 1;
  if v_secret is null then return; end if;
  begin
    perform http_set_curlopt('CURLOPT_TIMEOUT', '20');
  exception when others then null;
  end;
  perform http(('POST', 'https://bqataeghgjyiqrnnesqq.supabase.co/functions/v1/envoyer-push',
                array[http_header('x-push-secret', v_secret)], 'application/json', '{}')::http_request);
exception when others then
  null;
end $$;

revoke all on function public.push_declencher() from public, anon, authenticated;

select cron.schedule('push-declencher', '* * * * *', 'select public.push_declencher()');

-- Les clés (à ne jamais ranger dans le dépôt) :
--   insert into public.push_config (id, cle_publique, cle_privee, secret) values (1, '<clé publique VAPID>', '<clé privée VAPID>', '<secret partagé avec la fonction Edge>')
--   on conflict (id) do update set cle_publique = excluded.cle_publique, cle_privee = excluded.cle_privee, secret = excluded.secret;
