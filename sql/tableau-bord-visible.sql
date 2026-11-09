-- Le tableau de bord ne compte que les sorties que l'équipe peut réellement voir : les sorties d'artistes bannis ou non
-- francophones sont masquées partout (règles de lecture de « submissions »), y compris pour l'équipe — elles gonflaient
-- « Imports à valider » (76 comptées, 1 visible).
create or replace function public.equipe_tableau_bord() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if not public.est_equipe() then raise exception 'Réservé à l''équipe.'; end if;
  r := jsonb_build_object(
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
      'soumissions', (select count(*) from public.submissions where status = 'pending' and source is null and not banni and not hors_langue),
      'imports', (select count(*) from public.submissions where status = 'pending' and source is not null and not banni and not hors_langue),
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
  return r;
end $$;
