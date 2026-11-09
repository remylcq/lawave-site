-- ============================================================
-- Confort : idées proposées par les membres, export de ses données, tableau de bord de l'équipe.
--
-- Demandes de Rémy (2026-11-09) :
--  97. « Proposer une idée » avec vote des membres ;
--  95. l'export de ses données personnelles en un clic ;
--  98. un tableau de bord d'équipe : activité du jour, signalements, nouvelles inscriptions, files à traiter.
--
-- Peut être rejoué sans risque.
-- RETRAIT : drop function if exists public.idees_liste(text), public.idee_proposer(text, text), public.idee_voter(uuid, boolean),
--   public.idee_traiter(uuid, text, text), public.idee_supprimer(uuid), public.exporter_mes_donnees(), public.equipe_tableau_bord();
--   drop table if exists public.idees_votes, public.idees;
-- ============================================================


-- ---------------------------------------------------------------------
-- 1. Les idées
-- ---------------------------------------------------------------------

create table if not exists public.idees (
  id         uuid primary key default gen_random_uuid(),
  auteur_id  uuid references public.profiles(id) on delete set null,
  titre      text not null check (char_length(btrim(titre)) between 4 and 90),
  description text check (description is null or char_length(description) <= 700),
  statut     text not null default 'nouvelle' check (statut in ('nouvelle', 'retenue', 'en_cours', 'faite', 'refusee')),
  reponse    text check (reponse is null or char_length(reponse) <= 400),
  cree_le    timestamptz not null default now()
);

create table if not exists public.idees_votes (
  idee_id  uuid not null references public.idees(id) on delete cascade,
  user_id  uuid not null references public.profiles(id) on delete cascade,
  cree_le  timestamptz not null default now(),
  primary key (idee_id, user_id)
);

create index if not exists idees_statut_idx on public.idees (statut, cree_le desc);
alter table public.idees enable row level security;
alter table public.idees_votes enable row level security;
revoke all on table public.idees from anon, authenticated;
revoke all on table public.idees_votes from anon, authenticated;

create or replace function public.idees_liste(p_tri text default 'votes') returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_moi uuid := auth.uid();
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', i.id, 'titre', i.titre, 'description', i.description, 'statut', i.statut, 'reponse', i.reponse, 'cree_le', i.cree_le,
             'votes', i.votes, 'mon_vote', i.mon_vote, 'mienne', i.auteur_id = v_moi,
             'auteur', (select p.pseudo from public.profiles p where p.id = i.auteur_id))
           order by case when coalesce(p_tri, 'votes') = 'recent' then extract(epoch from i.cree_le) else i.votes end desc, i.cree_le desc)
      from (
        select x.*,
               (select count(*) from public.idees_votes v where v.idee_id = x.id) as votes,
               v_moi is not null and exists (select 1 from public.idees_votes v where v.idee_id = x.id and v.user_id = v_moi) as mon_vote
          from public.idees x
         where x.statut <> 'refusee' or x.auteur_id = v_moi or public.est_equipe()
         order by x.cree_le desc limit 200) i), '[]'::jsonb);
end $$;

grant execute on function public.idees_liste(text) to anon, authenticated;

create or replace function public.idee_proposer(p_titre text, p_description text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_moi uuid := public.com_moi(); v_id uuid;
begin
  if char_length(btrim(coalesce(p_titre, ''))) < 4 then raise exception 'Donne un titre d''au moins 4 caractères.'; end if;
  if not public.est_equipe() and (select count(*) from public.idees where auteur_id = v_moi and cree_le > now() - interval '1 day') >= 3 then
    raise exception 'Trois idées par jour au plus : laisse les autres voter pour celles-ci.';
  end if;
  insert into public.idees (auteur_id, titre, description)
  values (v_moi, left(btrim(p_titre), 90), left(nullif(btrim(coalesce(p_description, '')), ''), 700)) returning id into v_id;
  insert into public.idees_votes (idee_id, user_id) values (v_id, v_moi) on conflict do nothing;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

grant execute on function public.idee_proposer(text, text) to authenticated;

create or replace function public.idee_voter(p_id uuid, p_actif boolean default true) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_moi uuid := public.com_moi();
begin
  if not exists (select 1 from public.idees where id = p_id and statut <> 'refusee') then raise exception 'Cette idée n''existe plus.'; end if;
  if coalesce(p_actif, true) then
    insert into public.idees_votes (idee_id, user_id) values (p_id, v_moi) on conflict do nothing;
  else
    delete from public.idees_votes where idee_id = p_id and user_id = v_moi;
  end if;
  return jsonb_build_object('ok', true, 'votes', (select count(*) from public.idees_votes where idee_id = p_id));
end $$;

grant execute on function public.idee_voter(uuid, boolean) to authenticated;

create or replace function public.idee_traiter(p_id uuid, p_statut text, p_reponse text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.est_equipe() then raise exception 'Réservé à l''équipe.'; end if;
  if p_statut not in ('nouvelle', 'retenue', 'en_cours', 'faite', 'refusee') then raise exception 'Statut inconnu.'; end if;
  update public.idees set statut = p_statut, reponse = left(nullif(btrim(coalesce(p_reponse, '')), ''), 400) where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

grant execute on function public.idee_traiter(uuid, text, text) to authenticated;

create or replace function public.idee_supprimer(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Connexion requise.'; end if;
  delete from public.idees where id = p_id and (auteur_id = auth.uid() or public.est_equipe());
  return jsonb_build_object('ok', true);
end $$;

grant execute on function public.idee_supprimer(uuid) to authenticated;


-- ---------------------------------------------------------------------
-- 2. L'export de ses données
-- ---------------------------------------------------------------------

create or replace function public.exporter_mes_donnees() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_moi uuid := auth.uid();
begin
  if v_moi is null then raise exception 'Connexion requise.'; end if;
  return jsonb_build_object(
    'exporte_le', now(),
    'profil', (select to_jsonb(p) from public.profiles p where p.id = v_moi),
    'email', (select u.email from auth.users u where u.id = v_moi),
    'messages_communaute', coalesce((select jsonb_agg(to_jsonb(x) order by x.cree_le) from public.com_posts x where x.auteur_id = v_moi), '[]'::jsonb),
    'commentaires', coalesce((select jsonb_agg(to_jsonb(x) order by x.cree_le) from public.com_commentaires x where x.auteur_id = v_moi), '[]'::jsonb),
    'reactions', coalesce((select jsonb_agg(to_jsonb(x)) from public.com_reactions x where x.user_id = v_moi), '[]'::jsonb),
    'favoris', coalesce((select jsonb_agg(to_jsonb(x)) from public.com_favoris x where x.user_id = v_moi), '[]'::jsonb),
    'abonnements_membres', coalesce((select jsonb_agg(to_jsonb(x)) from public.com_suivis x where x.suiveur_id = v_moi), '[]'::jsonb),
    'abonnements_artistes', coalesce((select jsonb_agg(to_jsonb(x)) from public.artiste_suivis x where x.user_id = v_moi), '[]'::jsonb),
    'membres_bloques', coalesce((select jsonb_agg(to_jsonb(x)) from public.com_blocages x where x.user_id = v_moi), '[]'::jsonb),
    'messages_prives_envoyes', coalesce((select jsonb_agg(jsonb_build_object('conversation', x.conversation_id, 'contenu', x.contenu, 'audio', x.audio_path is not null, 'cree_le', x.cree_le) order by x.cree_le)
                                          from public.com_messages x where x.auteur_id = v_moi), '[]'::jsonb),
    'notes_et_collection', coalesce((select jsonb_agg(to_jsonb(x)) from public.release_ratings x where x.user_id = v_moi), '[]'::jsonb),
    'notes_artistes', coalesce((select jsonb_agg(to_jsonb(x)) from public.artist_ratings x where x.user_id = v_moi), '[]'::jsonb),
    'sorties_deposees', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'titre', s.track_title, 'artiste', s.artist_name, 'statut', s.status, 'depose_le', s.created_at))
                                    from public.submissions s join public.submission_auteurs a on a.submission_id = s.id and a.user_id = v_moi), '[]'::jsonb),
    'signalements_faits', coalesce((select jsonb_agg(to_jsonb(x)) from public.com_signalements x where x.auteur_id = v_moi), '[]'::jsonb),
    'avis_studios', coalesce((select jsonb_agg(to_jsonb(x)) from public.com_studios_avis x where x.user_id = v_moi), '[]'::jsonb),
    'idees', coalesce((select jsonb_agg(to_jsonb(x)) from public.idees x where x.auteur_id = v_moi), '[]'::jsonb),
    'inscriptions_accreditation', coalesce((select jsonb_agg(to_jsonb(x)) from public.inscriptions_accreditation x where x.user_id = v_moi), '[]'::jsonb),
    'notifications', coalesce((select jsonb_agg(to_jsonb(x) order by x.cree_le desc) from (select * from public.com_notifications where user_id = v_moi order by cree_le desc limit 500) x), '[]'::jsonb)
  );
end $$;

grant execute on function public.exporter_mes_donnees() to authenticated;


-- ---------------------------------------------------------------------
-- 3. Le tableau de bord de l'équipe
-- ---------------------------------------------------------------------

create or replace function public.equipe_tableau_bord() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.est_equipe() then raise exception 'Réservé à l''équipe.'; end if;
  return jsonb_build_object(
    'inscriptions', jsonb_build_object(
      'aujourdhui', (select count(*) from public.profiles where created_at >= date_trunc('day', now())),
      'semaine', (select count(*) from public.profiles where created_at >= now() - interval '7 days'),
      'total', (select count(*) from public.profiles)),
    'activite', jsonb_build_object(
      'messages_24h', (select count(*) from public.com_posts where cree_le >= now() - interval '1 day'),
      'commentaires_24h', (select count(*) from public.com_commentaires where cree_le >= now() - interval '1 day'),
      'messages_7j', (select count(*) from public.com_posts where cree_le >= now() - interval '7 days'),
      'actifs_7j', (select count(*) from public.profiles where derniere_activite >= now() - interval '7 days')),
    'audience', jsonb_build_object(
      'vues_aujourdhui', coalesce((select sum(vues) from public.mesure_jours where jour = current_date), 0),
      'visites_aujourdhui', coalesce((select sum(visites) from public.mesure_jours where jour = current_date), 0),
      'vues_7j', coalesce((select sum(vues) from public.mesure_jours where jour > current_date - 7), 0),
      'visites_7j', coalesce((select sum(visites) from public.mesure_jours where jour > current_date - 7), 0)),
    'a_traiter', jsonb_build_object(
      'soumissions', (select count(*) from public.submissions where status = 'pending' and source is null),
      'imports', (select count(*) from public.submissions where status = 'pending' and source is not null),
      'signalements', (select count(*) from public.com_signalements where traite_le is null),
      'verifications', (select count(*) from public.verifications_profil where statut = 'en_attente'),
      'pages_artistes', (select count(*) from public.artists where demande_par is not null and verifie_par is null),
      'studios', (select count(*) from public.com_studios where statut = 'en_attente'),
      'idees', (select count(*) from public.idees where statut = 'nouvelle'),
      'accreditations', (select count(*) from public.inscriptions_accreditation i join public.evenements_accreditation e on e.id = i.evenement_id
                          where i.statut = 'inscrit' and e.statut in ('ouvert', 'ferme'))),
    'catalogue', jsonb_build_object(
      'publiees_7j', (select count(*) from public.submissions where status = 'approved' and release_date > current_date - 7 and release_date <= current_date),
      'total', (select count(*) from public.submissions where status = 'approved')));
end $$;

grant execute on function public.equipe_tableau_bord() to authenticated;
