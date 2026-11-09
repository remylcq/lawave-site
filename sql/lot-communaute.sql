-- ============================================================
-- Communauté : messages vocaux, défi de la semaine, suivi des signalements, annuaire de studios.
--
-- Demandes de Rémy (2026-11-09) :
--  45. des messages vocaux courts dans les messages privés ;
--  43. des défis hebdomadaires (« Partage ton son préféré de 2019 ») ;
--  58. un signalement simplifié, avec suivi de son traitement ;
--  53. un annuaire de studios, avec avis et tarifs.
-- (46, les mentions @pseudo avec notification, existait déjà : com_extraire_mentions / com_notifier_mentions.)
--
-- Peut être rejoué sans risque.
-- RETRAIT : drop function if exists public.com_envoyer_vocal(uuid, text, integer), public.com_defi_courant(),
--   public.com_defi_creer(text, text, text, date, date), public.com_mes_signalements(), public.com_studios_liste(text, text, integer, integer),
--   public.com_studio(uuid), public.com_studio_proposer(text, text, text, integer, text[], text), public.com_studio_noter(uuid, integer, text),
--   public.com_studio_avis_retirer(uuid), public.com_studios_a_valider(), public.com_studio_traiter(uuid, text);
--   drop table if exists public.com_defis, public.com_studios_avis, public.com_studios;
--   alter table public.com_messages drop column if exists audio_path, drop column if exists audio_duree;
--   (et remettre com_messages() tel que dans sql/communaute.sql) ; le bucket « vocaux » se vide puis se supprime dans Storage.
-- ============================================================


-- ---------------------------------------------------------------------
-- 1. Les messages vocaux
-- ---------------------------------------------------------------------

alter table public.com_messages
  add column if not exists audio_path  text,
  add column if not exists audio_duree integer;

do $$ begin
  alter table public.com_messages add constraint com_messages_audio_duree check (audio_duree is null or audio_duree between 1 and 180);
exception when duplicate_object then null; end $$;

-- Un bucket privé : seuls les deux participants de la conversation (et l'auteur avant l'envoi) lisent un vocal.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('vocaux', 'vocaux', false, 3145728, array['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/aac', 'audio/wav', 'audio/x-m4a'])
on conflict (id) do update set public = false, file_size_limit = 3145728,
  allowed_mime_types = array['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/aac', 'audio/wav', 'audio/x-m4a'];

drop policy if exists "vocaux deposes dans son dossier" on storage.objects;
create policy "vocaux deposes dans son dossier" on storage.objects for insert to authenticated
  with check (bucket_id = 'vocaux' and (storage.foldername(name))[1] = (auth.uid())::text);

drop policy if exists "vocaux lus par la conversation" on storage.objects;
create policy "vocaux lus par la conversation" on storage.objects for select to authenticated
  using (bucket_id = 'vocaux' and (
    (storage.foldername(name))[1] = (auth.uid())::text
    or exists (
      select 1 from public.com_messages m
        join public.com_participants p on p.conversation_id = m.conversation_id and p.user_id = auth.uid()
       where m.audio_path = storage.objects.name)));

-- Envoyer un vocal : mêmes règles qu'un message (participant, blocage, cadence), puis le fichier y est rattaché.
create or replace function public.com_envoyer_vocal(p_conversation uuid, p_path text, p_duree integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_moi uuid := public.com_moi();
  v_res jsonb;
begin
  if p_path is null or p_path not like v_moi::text || '/%' or char_length(p_path) > 200 or p_path like '%..%' then
    raise exception 'Fichier audio invalide.';
  end if;

  if p_duree is null or p_duree < 1 or p_duree > 180 then
    raise exception 'Un message vocal dure 3 minutes au plus.';
  end if;

  if not exists (select 1 from storage.objects o where o.bucket_id = 'vocaux' and o.name = p_path) then
    raise exception 'Le fichier audio n''est pas arrivé : réessaie.';
  end if;

  v_res := public.com_envoyer(p_conversation, '🎤 Message vocal');

  update public.com_messages
     set audio_path = p_path, audio_duree = p_duree
   where id = (v_res->>'id')::uuid;

  return v_res || jsonb_build_object('audio_path', p_path, 'audio_duree', p_duree);
end $$;

grant execute on function public.com_envoyer_vocal(uuid, text, integer) to authenticated;

-- La liste des messages d'une conversation, avec le vocal (chemin et durée) quand il y en a un.
create or replace function public.com_messages(p_conversation uuid, p_avant timestamp with time zone default null, p_limite integer default 40)
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
           'id', m.id, 'auteur_id', m.auteur_id, 'contenu', m.contenu, 'cree_le', m.cree_le,
           'audio_path', m.audio_path, 'audio_duree', m.audio_duree
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
-- 2. Le défi de la semaine
-- ---------------------------------------------------------------------

create table if not exists public.com_defis (
  id       uuid primary key default gen_random_uuid(),
  titre    text not null check (char_length(btrim(titre)) between 3 and 80),
  consigne text not null check (char_length(btrim(consigne)) between 5 and 300),
  tag      text not null check (tag ~ '^[a-z0-9_]{2,30}$'),
  debut    date not null,
  fin      date not null,
  cree_le  timestamptz not null default now(),
  constraint com_defis_dates check (fin >= debut),
  constraint com_defis_debut_unique unique (debut)
);

alter table public.com_defis enable row level security;
revoke all on table public.com_defis from anon, authenticated;

-- Les premières semaines (du lundi au dimanche) ; l'équipe en ajoute d'autres avec com_defi_creer.
insert into public.com_defis (titre, consigne, tag, debut, fin) values
  ('Ton son préféré de 2019', 'Partage le morceau de 2019 que tu écoutes encore aujourd''hui, et dis pourquoi.', 'son2019', date '2026-11-09', date '2026-11-15'),
  ('Le premier album qui t''a marqué', 'Celui qui t''a donné envie de t''y mettre : titre, artiste, souvenir.', 'premierealbum', date '2026-11-16', date '2026-11-22'),
  ('Le feat de tes rêves', 'Deux artistes qui devraient faire un morceau ensemble : lesquels, et pourquoi ?', 'featreve', date '2026-11-23', date '2026-11-29'),
  ('La pochette la plus folle', 'Une pochette que tu trouves incroyable. Poste-la, dis ce qu''elle t''inspire.', 'pochette', date '2026-11-30', date '2026-12-06'),
  ('Ton couplet préféré', 'Un couplet que tu connais par cœur : cite-le, et dis qui l''a écrit.', 'couplet', date '2026-12-07', date '2026-12-13'),
  ('Une pépite sous-côtée', 'Un artiste que tout le monde devrait connaître. Fais-le découvrir.', 'pepite', date '2026-12-14', date '2026-12-20'),
  ('Le son de ta salle de sport', 'Le morceau qui te fait soulever plus lourd.', 'sport', date '2026-12-21', date '2026-12-27'),
  ('Ton titre de l''année 2026', 'Un seul morceau pour résumer 2026. Lequel ?', 'top2026', date '2026-12-28', date '2027-01-03'),
  ('L''album que tu écoutes en boucle', 'Celui que tu ne lâches pas en ce moment.', 'enboucle', date '2027-01-04', date '2027-01-10'),
  ('Un concert inoubliable', 'Le meilleur concert que tu aies vu : où, quand, qui ?', 'concert', date '2027-01-11', date '2027-01-17'),
  ('Ta rime de l''année', 'La punchline ou la rime qui t''a le plus marqué cette année.', 'rime', date '2027-01-18', date '2027-01-24'),
  ('Le morceau qui te rappelle un été', 'Un son, une saison, un souvenir : raconte-le.', 'souvenirete', date '2027-01-25', date '2027-01-31')
on conflict (debut) do nothing;

create or replace function public.com_defi_courant() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
           'id', d.id, 'titre', d.titre, 'consigne', d.consigne, 'tag', d.tag, 'debut', d.debut, 'fin', d.fin,
           'jours_restants', greatest(d.fin - current_date, 0),
           'nb', (select count(*) from public.com_posts p where d.tag = any (p.tags) and p.cree_le >= d.debut::timestamptz))
    from public.com_defis d
   where current_date between d.debut and d.fin
   order by d.debut desc
   limit 1;
$$;

grant execute on function public.com_defi_courant() to anon, authenticated;

create or replace function public.com_defi_creer(p_titre text, p_consigne text, p_tag text, p_debut date, p_fin date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.est_equipe() then raise exception 'Réservé à l''équipe.'; end if;
  insert into public.com_defis (titre, consigne, tag, debut, fin)
  values (btrim(p_titre), btrim(p_consigne), lower(btrim(p_tag)), p_debut, p_fin)
  on conflict (debut) do update set titre = excluded.titre, consigne = excluded.consigne, tag = excluded.tag, fin = excluded.fin
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

grant execute on function public.com_defi_creer(text, text, text, date, date) to authenticated;


-- ---------------------------------------------------------------------
-- 3. Suivre ses signalements
-- ---------------------------------------------------------------------

create or replace function public.com_mes_signalements() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_moi uuid := public.com_moi();
begin
  return coalesce((
    select jsonb_agg(x.j order by x.cree desc) from (
      select s.cree_le as cree, jsonb_build_object(
        'id', s.id, 'cible_type', s.cible_type, 'motif', s.motif, 'cree_le', s.cree_le, 'traite_le', s.traite_le,
        'statut', case
                    when s.traite_le is null then 'en_cours'
                    when (case s.cible_type
                            when 'post'        then exists (select 1 from public.com_posts where id = s.cible_id)
                            when 'commentaire' then exists (select 1 from public.com_commentaires where id = s.cible_id)
                            else true end) then 'examine'
                    else 'retire' end,
        'extrait', case s.cible_type
                     when 'post'        then (select left(p.contenu, 120) from public.com_posts p where p.id = s.cible_id)
                     when 'commentaire' then (select left(c.contenu, 120) from public.com_commentaires c where c.id = s.cible_id)
                     else (select pr.pseudo from public.profiles pr where pr.id = s.cible_id) end
      ) as j
        from public.com_signalements s
       where s.auteur_id = v_moi
       order by s.cree_le desc
       limit 50
    ) x), '[]'::jsonb);
end $$;

grant execute on function public.com_mes_signalements() to authenticated;


-- ---------------------------------------------------------------------
-- 4. L'annuaire de studios
-- ---------------------------------------------------------------------

create table if not exists public.com_studios (
  id          uuid primary key default gen_random_uuid(),
  nom         text not null check (char_length(btrim(nom)) between 2 and 80),
  ville       text not null check (char_length(btrim(ville)) between 2 and 60),
  description text check (description is null or char_length(description) <= 600),
  tarif_heure integer check (tarif_heure is null or tarif_heure between 5 and 500),
  services    text[] not null default '{}' check (cardinality(services) <= 8),
  lien        text check (lien is null or (char_length(lien) <= 300 and lien ~* '^https://')),
  propose_par uuid references public.profiles(id) on delete set null,
  statut      text not null default 'en_attente' check (statut in ('en_attente', 'publie')),
  cree_le     timestamptz not null default now()
);

create index if not exists com_studios_statut_idx on public.com_studios (statut, ville);
alter table public.com_studios enable row level security;
revoke all on table public.com_studios from anon, authenticated;

create table if not exists public.com_studios_avis (
  studio_id  uuid not null references public.com_studios(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  note       smallint not null check (note between 1 and 5),
  avis       text check (avis is null or char_length(avis) <= 500),
  cree_le    timestamptz not null default now(),
  primary key (studio_id, user_id)
);

alter table public.com_studios_avis enable row level security;
revoke all on table public.com_studios_avis from anon, authenticated;

-- La liste : les studios publiés (et ceux que l'on a proposés soi-même, en attente), avec leur note moyenne.
create or replace function public.com_studios_liste(p_q text default null, p_ville text default null, p_limite integer default 40, p_decalage integer default 0)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_moi  uuid := auth.uid();
  v_q    text := nullif(btrim(coalesce(p_q, '')), '');
  v_ville text := nullif(btrim(coalesce(p_ville, '')), '');
  v_total integer;
  v_liste jsonb;
begin
  with f as (
    select s.* from public.com_studios s
     where (s.statut = 'publie' or s.propose_par = v_moi)
       and (v_q is null or lower(public.com_normaliser(s.nom || ' ' || s.ville || ' ' || coalesce(s.description, ''))) like '%' || lower(public.com_normaliser(v_q)) || '%')
       and (v_ville is null or lower(public.com_normaliser(s.ville)) = lower(public.com_normaliser(v_ville)))
  )
  select (select count(*) from f)::integer,
         coalesce((select jsonb_agg(jsonb_build_object(
                     'id', t.id, 'nom', t.nom, 'ville', t.ville, 'description', t.description, 'tarif_heure', t.tarif_heure,
                     'services', t.services, 'lien', t.lien, 'statut', t.statut,
                     'note', (select round(avg(a.note)::numeric, 1) from public.com_studios_avis a where a.studio_id = t.id),
                     'nb_avis', (select count(*) from public.com_studios_avis a where a.studio_id = t.id))
                   order by t.cree_le desc)
                     from (select * from f order by cree_le desc
                           limit least(greatest(coalesce(p_limite, 40), 1), 100) offset greatest(coalesce(p_decalage, 0), 0)) t), '[]'::jsonb)
    into v_total, v_liste;

  return jsonb_build_object('total', v_total, 'studios', v_liste,
    'villes', coalesce((select jsonb_agg(v order by v) from (select distinct ville as v from public.com_studios where statut = 'publie') z), '[]'::jsonb));
end $$;

grant execute on function public.com_studios_liste(text, text, integer, integer) to anon, authenticated;

create or replace function public.com_studio(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_moi uuid := auth.uid();
  s     public.com_studios;
begin
  select * into s from public.com_studios where id = p_id and (statut = 'publie' or propose_par = v_moi or public.est_equipe());
  if not found then return null; end if;
  return jsonb_build_object(
    'id', s.id, 'nom', s.nom, 'ville', s.ville, 'description', s.description, 'tarif_heure', s.tarif_heure,
    'services', s.services, 'lien', s.lien, 'statut', s.statut,
    'note', (select round(avg(a.note)::numeric, 1) from public.com_studios_avis a where a.studio_id = s.id),
    'nb_avis', (select count(*) from public.com_studios_avis a where a.studio_id = s.id),
    'avis', coalesce((select jsonb_agg(jsonb_build_object(
                'auteur', public.com_auteur_json(a.user_id), 'note', a.note, 'avis', a.avis, 'cree_le', a.cree_le,
                'mien', a.user_id = v_moi) order by a.cree_le desc)
                from public.com_studios_avis a where a.studio_id = s.id), '[]'::jsonb));
end $$;

grant execute on function public.com_studio(uuid) to anon, authenticated;

create or replace function public.com_studio_proposer(p_nom text, p_ville text, p_description text default null, p_tarif integer default null,
                                                      p_services text[] default '{}', p_lien text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_moi uuid := public.com_moi();
  v_id  uuid;
  v_lien text := nullif(btrim(coalesce(p_lien, '')), '');
  v_serv text[] := coalesce((select array_agg(left(btrim(x), 40)) from unnest(coalesce(p_services, '{}')) as x where btrim(x) <> ''), '{}');
begin
  if char_length(btrim(coalesce(p_nom, ''))) < 2 then raise exception 'Donne le nom du studio.'; end if;
  if char_length(btrim(coalesce(p_ville, ''))) < 2 then raise exception 'Indique la ville du studio.'; end if;
  if v_lien is not null and v_lien !~* '^https://' then raise exception 'Le lien doit commencer par https://'; end if;
  if cardinality(v_serv) > 8 then v_serv := v_serv[1:8]; end if;
  if not public.est_equipe() and (select count(*) from public.com_studios where propose_par = v_moi and statut = 'en_attente') >= 3 then
    raise exception 'Tu as déjà 3 studios en attente de validation.';
  end if;
  insert into public.com_studios (nom, ville, description, tarif_heure, services, lien, propose_par, statut)
  values (btrim(p_nom), btrim(p_ville), nullif(btrim(coalesce(p_description, '')), ''), p_tarif, v_serv, left(v_lien, 300), v_moi,
          case when public.est_equipe() then 'publie' else 'en_attente' end)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'publie', public.est_equipe());
end $$;

grant execute on function public.com_studio_proposer(text, text, text, integer, text[], text) to authenticated;

create or replace function public.com_studio_noter(p_id uuid, p_note integer, p_avis text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_moi uuid := public.com_moi();
begin
  if p_note is null or p_note < 1 or p_note > 5 then raise exception 'Choisis une note de 1 à 5.'; end if;
  if not exists (select 1 from public.com_studios where id = p_id and statut = 'publie') then raise exception 'Ce studio n''existe pas.'; end if;
  insert into public.com_studios_avis (studio_id, user_id, note, avis)
  values (p_id, v_moi, p_note, left(nullif(btrim(coalesce(p_avis, '')), ''), 500))
  on conflict (studio_id, user_id) do update set note = excluded.note, avis = excluded.avis, cree_le = now();
  return jsonb_build_object('ok', true);
end $$;

grant execute on function public.com_studio_noter(uuid, integer, text) to authenticated;

create or replace function public.com_studio_avis_retirer(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_moi uuid := public.com_moi();
begin
  delete from public.com_studios_avis where studio_id = p_id and user_id = v_moi;
  return jsonb_build_object('ok', true);
end $$;

grant execute on function public.com_studio_avis_retirer(uuid) to authenticated;

-- Côté équipe : les studios proposés, à publier ou à refuser.
create or replace function public.com_studios_a_valider() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.est_equipe() then raise exception 'Réservé à l''équipe.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'nom', s.nom, 'ville', s.ville, 'description', s.description,
                     'tarif_heure', s.tarif_heure, 'services', s.services, 'lien', s.lien, 'cree_le', s.cree_le,
                     'auteur', public.com_auteur_json(s.propose_par)) order by s.cree_le)
                     from public.com_studios s where s.statut = 'en_attente'), '[]'::jsonb);
end $$;

grant execute on function public.com_studios_a_valider() to authenticated;

create or replace function public.com_studio_traiter(p_id uuid, p_action text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.est_equipe() then raise exception 'Réservé à l''équipe.'; end if;
  if p_action = 'publier' then
    update public.com_studios set statut = 'publie' where id = p_id;
  elsif p_action in ('refuser', 'supprimer') then
    delete from public.com_studios where id = p_id;
  else
    raise exception 'Action inconnue.';
  end if;
  return jsonb_build_object('ok', true);
end $$;

grant execute on function public.com_studio_traiter(uuid, text) to authenticated;
