-- Mesure d'audience maison, respectueuse de la vie privée.
--
-- Ce qui est compté : des pages vues et des visites, par jour, par page, par type d'appareil et par provenance
-- (« direct », « google », « instagram »…). Rien d'autre.
-- Ce qui n'est PAS enregistré : adresse IP, identifiant, cookie, compte, agent de navigation, pseudo, page de profil
-- précise, adresse complète de provenance. Il n'y a donc pas de profil de visiteur à protéger, et pas de bandeau de
-- consentement à afficher (mesure d'audience anonyme, strictement agrégée).
--
-- Le site envoie un compteur à chaque page ; le navigateur ne le fait pas s'il envoie « Do Not Track » ou « Global
-- Privacy Control ». Seule l'équipe lit les chiffres (onglet « Audience » de l'espace équipe).
--
-- À passer une fois dans l'éditeur SQL de Supabase (ou par Claude, avec l'accord de Rémy). Rejouable.

create table if not exists public.mesure_jours (
  jour      date    not null,
  page      text    not null,
  appareil  text    not null,
  source    text    not null,
  vues      integer not null default 0,
  visites   integer not null default 0,
  primary key (jour, page, appareil, source)
);

alter table public.mesure_jours enable row level security;

-- Aucune règle : ni lecture ni écriture directes, pour personne. Tout passe par les deux fonctions ci-dessous.
revoke all on public.mesure_jours from public, anon, authenticated;


-- Un visiteur annonce une page vue. Les valeurs hors liste sont ignorées en silence : impossible de remplir la
-- table de texte libre.
create or replace function public.mesure_enregistrer(p_page text, p_appareil text, p_source text, p_visite boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_jour date := (now() at time zone 'Europe/Paris')::date;
begin
  if p_page not in ('accueil', 'catalogue', 'artiste', 'carte', 'contenu', 'soumettre', 'accreditations',
                    'a-propos', 'communaute', 'profil', 'signalement', 'aide', 'faq', 'conditions',
                    'confidentialite', 'mentions') then
    return;
  end if;

  if p_appareil not in ('mobile', 'tablette', 'ordinateur') then return; end if;

  if p_source not in ('direct', 'interne', 'google', 'moteur', 'instagram', 'tiktok', 'x', 'youtube', 'facebook',
                      'spotify', 'deezer', 'autre') then
    return;
  end if;

  insert into public.mesure_jours as m (jour, page, appareil, source, vues, visites)
  values (v_jour, p_page, p_appareil, p_source, 1, case when coalesce(p_visite, false) then 1 else 0 end)
  on conflict (jour, page, appareil, source) do update
    set vues    = m.vues + 1,
        visites = m.visites + case when coalesce(p_visite, false) then 1 else 0 end;
end $$;

revoke all on function public.mesure_enregistrer(text, text, text, boolean) from public;
grant execute on function public.mesure_enregistrer(text, text, text, boolean) to anon, authenticated;


-- Les chiffres, pour l'équipe seulement : les N derniers jours, jour par jour, puis par page, provenance, appareil.
create or replace function public.mesure_lire(p_jours integer default 30)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_jours integer := greatest(1, least(coalesce(p_jours, 30), 365));
  v_depuis date := (now() at time zone 'Europe/Paris')::date - (greatest(1, least(coalesce(p_jours, 30), 365)) - 1);
  j jsonb; pg jsonb; so jsonb; ap jsonb; t jsonb;
begin
  if not public.est_equipe() then
    raise exception 'Réservé à l''équipe.';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('jour', g.jour::date, 'vues', coalesce(s.vues, 0), 'visites', coalesce(s.visites, 0))
                            order by g.jour), '[]'::jsonb)
    into j
    from generate_series(v_depuis, (now() at time zone 'Europe/Paris')::date, interval '1 day') as g(jour)
    left join (select jour, sum(vues) as vues, sum(visites) as visites from public.mesure_jours
                where jour >= v_depuis group by jour) s on s.jour = g.jour::date;

  select coalesce(jsonb_agg(jsonb_build_object('page', x.page, 'vues', x.vues, 'visites', x.visites) order by x.vues desc), '[]'::jsonb)
    into pg from (select page, sum(vues) as vues, sum(visites) as visites from public.mesure_jours
                   where jour >= v_depuis group by page) x;

  select coalesce(jsonb_agg(jsonb_build_object('source', x.source, 'visites', x.visites) order by x.visites desc), '[]'::jsonb)
    into so from (select source, sum(visites) as visites from public.mesure_jours
                   where jour >= v_depuis and visites > 0 group by source) x;

  select coalesce(jsonb_agg(jsonb_build_object('appareil', x.appareil, 'vues', x.vues) order by x.vues desc), '[]'::jsonb)
    into ap from (select appareil, sum(vues) as vues from public.mesure_jours
                   where jour >= v_depuis group by appareil) x;

  select jsonb_build_object('vues', coalesce(sum(vues), 0), 'visites', coalesce(sum(visites), 0))
    into t from public.mesure_jours where jour >= v_depuis;

  return jsonb_build_object('jours', v_jours, 'total', t, 'par_jour', j, 'pages', pg, 'sources', so, 'appareils', ap);
end $$;

revoke all on function public.mesure_lire(integer) from public, anon;
grant execute on function public.mesure_lire(integer) to authenticated;
