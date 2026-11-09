-- ============================================================
-- Outils des artistes et des photographes.
--
-- Demandes de Rémy (2026-11-09) :
--  81. le suivi du traitement de ses soumissions (en attente, publiée, refusée + raison) ;
--  82. un tableau de bord « Mes sorties » avec des chiffres clés ;
--  83 / 84. une page de lancement partageable avec compte à rebours (la pré-sauvegarde = « Me prévenir le jour J » :
--      la sortie passe en « À écouter », et engagement_sorties() prévient le jour de la sortie) ;
--  65. un espace pour déposer les photos livrées après un événement (bucket privé « livraisons ») ;
--  64. un rappel la veille d'un événement pour les photographes retenus.
--
-- Peut être rejoué sans risque.
-- RETRAIT : drop function if exists public.mes_soumissions(), public.mes_sorties_stats(), public.lancement_page(integer),
--   public.accreditation_fichier_ajouter(uuid, text, text, integer), public.accreditation_fichiers(uuid),
--   public.accreditation_fichier_supprimer(uuid), public.rappels_accreditation();
--   drop table if exists public.accreditation_fichiers, public.submission_auteurs; drop function if exists public.submissions_noter_auteur();
--   select cron.unschedule('rappels-accreditation'); (le bucket « livraisons » se vide puis se supprime dans Storage)
-- ============================================================


-- ---------------------------------------------------------------------
-- 1. Qui a soumis quoi
-- ---------------------------------------------------------------------

-- Qui a déposé une sortie : une table à part et fermée (le droit de lecture de submissions couvre toutes ses colonnes,
-- une colonne de plus aurait été lisible par tous). Remplie par un déclencheur à chaque dépôt d'un compte connecté.
create table if not exists public.submission_auteurs (
  submission_id uuid primary key references public.submissions(id) on delete cascade,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  cree_le       timestamptz not null default now()
);

create index if not exists submission_auteurs_user_idx on public.submission_auteurs (user_id);
alter table public.submission_auteurs enable row level security;
revoke all on table public.submission_auteurs from anon, authenticated;

create or replace function public.submissions_noter_auteur() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and exists (select 1 from public.profiles where id = auth.uid()) then
    insert into public.submission_auteurs (submission_id, user_id) values (new.id, auth.uid()) on conflict do nothing;
  end if;
  return new;
end $$;

drop trigger if exists submissions_noter_auteur on public.submissions;
create trigger submissions_noter_auteur after insert on public.submissions
  for each row execute function public.submissions_noter_auteur();

-- Mes soumissions : celles que j'ai déposées (ou, avant ce suivi, déposées avec mon adresse e-mail).
create or replace function public.mes_soumissions() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_moi uuid := auth.uid();
  v_mail text;
begin
  if v_moi is null then raise exception 'Connexion requise.'; end if;
  select lower(email) into v_mail from auth.users where id = v_moi;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', s.id, 'titre', s.track_title, 'artiste', s.artist_name, 'type', s.release_type, 'cover', s.cover_url,
             'statut', s.status, 'raison', s.rejection_reason, 'date_sortie', s.release_date, 'depose_le', s.created_at,
             'valide_le', s.validated_at, 'num', case when s.status = 'approved' then s.catalog_number end)
           order by s.created_at desc)
      from (select * from public.submissions x
             where (exists (select 1 from public.submission_auteurs sa where sa.submission_id = x.id and sa.user_id = v_moi)
                    or (not exists (select 1 from public.submission_auteurs sa where sa.submission_id = x.id)
                        and v_mail is not null and lower(coalesce(x.contact_email, '')) = v_mail))
               and x.source is null
             order by x.created_at desc limit 100) s), '[]'::jsonb);
end $$;

grant execute on function public.mes_soumissions() to authenticated;


-- ---------------------------------------------------------------------
-- 2. Mes sorties : les chiffres clés
-- ---------------------------------------------------------------------

create or replace function public.mes_sorties_stats() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_moi uuid := auth.uid();
begin
  if v_moi is null then raise exception 'Connexion requise.'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', s.id, 'num', s.catalog_number, 'titre', s.track_title, 'artiste', s.artist_name, 'handle', s.artist_handle,
             'cover', s.cover_url, 'date', s.release_date, 'type', s.release_type,
             'en_collection', (select count(*) from public.release_ratings r where r.release_id = s.id and (r.saved or r.favori)),
             'a_ecouter', (select count(*) from public.release_ratings r where r.release_id = s.id and r.a_ecouter),
             'nb_notes', (select count(*) from public.release_ratings r where r.release_id = s.id and r.rating is not null),
             'note', (select round(avg(r.rating)::numeric / 2, 1) from public.release_ratings r where r.release_id = s.id and r.rating is not null),
             'nb_avis', (select count(*) from public.release_ratings r where r.release_id = s.id and nullif(btrim(coalesce(r.avis, '')), '') is not null))
           order by s.release_date desc nulls last)
      from (select * from public.submissions x
             where x.status = 'approved' and not x.banni
               and (exists (select 1 from public.submission_auteurs sa where sa.submission_id = x.id and sa.user_id = v_moi)
                    or lower(coalesce(x.artist_handle, '')) in (select lower(a.instagram_handle) from public.artists a where a.verifie_par = v_moi))
             order by x.release_date desc nulls last limit 100) s), '[]'::jsonb);
end $$;

grant execute on function public.mes_sorties_stats() to authenticated;


-- ---------------------------------------------------------------------
-- 3. La page de lancement d'une sortie (publique, même avant sa date)
-- ---------------------------------------------------------------------

create or replace function public.lancement_page(p_num integer) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  s record;
  v_moi uuid := auth.uid();
begin
  select * into s from public.submissions
   where catalog_number = p_num and status = 'approved' and not banni and not hors_langue limit 1;
  if not found then return null; end if;
  return jsonb_build_object(
    'id', s.id, 'num', s.catalog_number, 'titre', s.track_title, 'artiste', s.artist_name, 'handle', s.artist_handle,
    'cover', s.cover_url, 'date', s.release_date, 'type', s.release_type, 'featuring', coalesce(s.featuring, '[]'::jsonb),
    'liens', jsonb_build_object('spotify', s.spotify_url, 'deezer', s.deezer_url, 'apple', s.apple_music_url,
                                'youtube', s.youtube_url, 'ecoute', s.listen_url),
    'nb_prevenus', (select count(*) from public.release_ratings r where r.release_id = s.id and r.a_ecouter),
    'prevenu', v_moi is not null and exists (select 1 from public.release_ratings r where r.release_id = s.id and r.user_id = v_moi and r.a_ecouter));
end $$;

grant execute on function public.lancement_page(integer) to anon, authenticated;


-- ---------------------------------------------------------------------
-- 4. Les photos livrées après un événement
-- ---------------------------------------------------------------------

create table if not exists public.accreditation_fichiers (
  id            uuid primary key default gen_random_uuid(),
  evenement_id  uuid not null references public.evenements_accreditation(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  chemin        text not null check (char_length(chemin) <= 220),
  nom           text check (nom is null or char_length(nom) <= 160),
  taille        integer check (taille is null or taille >= 0),
  cree_le       timestamptz not null default now()
);

create index if not exists accreditation_fichiers_evt_idx on public.accreditation_fichiers (evenement_id, user_id);
alter table public.accreditation_fichiers enable row level security;
revoke all on table public.accreditation_fichiers from anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('livraisons', 'livraisons', false, 6291456, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = 6291456, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists "livraisons deposees dans son dossier" on storage.objects;
create policy "livraisons deposees dans son dossier" on storage.objects for insert to authenticated
  with check (bucket_id = 'livraisons' and (storage.foldername(name))[1] = (auth.uid())::text);

drop policy if exists "livraisons lues par leur auteur et l'equipe" on storage.objects;
create policy "livraisons lues par leur auteur et l'equipe" on storage.objects for select to authenticated
  using (bucket_id = 'livraisons' and ((storage.foldername(name))[1] = (auth.uid())::text or public.est_equipe()));

drop policy if exists "livraisons retirees par leur auteur" on storage.objects;
create policy "livraisons retirees par leur auteur" on storage.objects for delete to authenticated
  using (bucket_id = 'livraisons' and (storage.foldername(name))[1] = (auth.uid())::text);

create or replace function public.accreditation_fichier_ajouter(p_evenement uuid, p_chemin text, p_nom text, p_taille integer)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Connexion requise.'; end if;
  if not exists (select 1 from public.inscriptions_accreditation where evenement_id = p_evenement and user_id = auth.uid() and statut = 'retenu') then
    raise exception 'Aucune accréditation retenue à ton nom pour cet événement.';
  end if;
  if p_chemin is null or p_chemin not like auth.uid()::text || '/%' or p_chemin like '%..%' then raise exception 'Fichier invalide.'; end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'livraisons' and o.name = p_chemin) then raise exception 'Le fichier n''est pas arrivé : réessaie.'; end if;
  if (select count(*) from public.accreditation_fichiers where evenement_id = p_evenement and user_id = auth.uid()) >= 40 then
    raise exception 'Déjà 40 photos déposées pour cet événement : envoie un lien pour le reste.';
  end if;
  insert into public.accreditation_fichiers (evenement_id, user_id, chemin, nom, taille)
  values (p_evenement, auth.uid(), p_chemin, left(p_nom, 160), p_taille) returning id into v_id;
  update public.inscriptions_accreditation set livraison_le = now() where evenement_id = p_evenement and user_id = auth.uid();
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

grant execute on function public.accreditation_fichier_ajouter(uuid, text, text, integer) to authenticated;

-- Le photographe voit ses photos ; l'équipe voit toutes celles de l'événement.
create or replace function public.accreditation_fichiers(p_evenement uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Connexion requise.'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', f.id, 'chemin', f.chemin, 'nom', f.nom, 'taille', f.taille, 'cree_le', f.cree_le,
                                        'user_id', f.user_id, 'photographe', (select i.nom from public.inscriptions_accreditation i
                                                                                where i.evenement_id = f.evenement_id and i.user_id = f.user_id))
                     order by f.cree_le)
      from public.accreditation_fichiers f
     where f.evenement_id = p_evenement and (f.user_id = auth.uid() or public.est_equipe())), '[]'::jsonb);
end $$;

grant execute on function public.accreditation_fichiers(uuid) to authenticated;

create or replace function public.accreditation_fichier_supprimer(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare f public.accreditation_fichiers;
begin
  select * into f from public.accreditation_fichiers where id = p_id and user_id = auth.uid();
  if not found then return jsonb_build_object('ok', true); end if;
  delete from public.accreditation_fichiers where id = p_id;
  delete from storage.objects where bucket_id = 'livraisons' and name = f.chemin;
  return jsonb_build_object('ok', true);
end $$;

grant execute on function public.accreditation_fichier_supprimer(uuid) to authenticated;


-- ---------------------------------------------------------------------
-- 5. Le rappel de la veille
-- ---------------------------------------------------------------------

alter table public.com_notifications drop constraint if exists com_notifications_type_check;
alter table public.com_notifications add constraint com_notifications_type_check
  check (type in ('reaction', 'commentaire', 'reponse', 'suivi', 'mention',
                  'sortie_artiste', 'sortie_a_ecouter', 'resume_semaine', 'duel', 'saison',
                  'decouvreur', 'cosmetique', 'rappel_accreditation'));

-- Chaque matin : les photographes retenus pour un événement de demain en sont prévenus (une seule fois, grâce à la clé).
create or replace function public.rappels_accreditation() returns integer
language plpgsql security definer set search_path = public as $$
declare r record; v_n integer := 0;
begin
  for r in
    select i.user_id, e.id as evt, e.artiste, e.salle, e.ville, e.date_evenement
      from public.inscriptions_accreditation i
      join public.evenements_accreditation e on e.id = i.evenement_id
     where i.statut = 'retenu' and e.statut <> 'brouillon'
       and (e.date_evenement at time zone 'Europe/Paris')::date = ((now() at time zone 'Europe/Paris')::date + 1)
  loop
    perform public.com_notifier_systeme(r.user_id, 'rappel_accreditation', 'rappel-accred:' || r.evt::text,
      jsonb_build_object('evenement', r.evt, 'artiste', r.artiste, 'salle', r.salle, 'ville', r.ville, 'date', r.date_evenement));
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

revoke all on function public.rappels_accreditation() from public, anon, authenticated;

select cron.schedule('rappels-accreditation', '0 8 * * *', 'select public.rappels_accreditation()');

-- NB : la tâche « engagement-sorties » (select public.engagement_sorties(), toutes les heures, voir sql/engagement.sql) n'est plus
-- planifiée en production : c'est elle qui prévient, le jour de la sortie, ceux qui ont mis la sortie « À écouter » ou suivent l'artiste.
-- À relancer si on veut ces annonces : select cron.schedule('engagement-sorties', '7 * * * *', 'select public.engagement_sorties()');
