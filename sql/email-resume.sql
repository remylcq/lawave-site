-- ============================================================
-- Le résumé hebdomadaire par e-mail (idée 89 de Rémy, 2026-11-09), pour ceux qui le demandent.
--
-- Chaque lundi, une personne inscrite reçoit : les sorties de la semaine des artistes qu'elle suit ou qu'elle a mis de côté,
-- les messages les plus aimés de la communauté et le défi de la semaine. Elle s'inscrit et se désinscrit dans ses réglages
-- (ou par le lien au pied de l'e-mail, desinscrire.php).
--
-- L'envoi passe par la fonction Edge « envoyer-resume » et un fournisseur d'e-mails (Resend). Tant que la clé n'est pas posée
-- dans email_config, rien ne part : la chaîne attend. Pour l'activer :
--   1. créer un compte Resend et vérifier le domaine lawave.fr (enregistrements DNS) ;
--   2. insert into public.email_config (id, cle_api, expediteur, secret)
--        values (1, '<clé Resend>', 'La Wave <resume@lawave.fr>', '<secret partagé avec la fonction Edge>')
--        on conflict (id) do update set cle_api = excluded.cle_api, expediteur = excluded.expediteur;
--
-- Peut être rejoué sans risque.
-- RETRAIT : select cron.unschedule('email-resume'); drop function if exists public.email_resume_declencher(), public.email_resume_a_envoyer(),
--   public.email_resume_contenu(uuid), public.email_resume_etat(), public.email_resume_regler(boolean), public.email_resume_stop(uuid);
--   drop table if exists public.email_resume, public.email_config;
-- ============================================================

create table if not exists public.email_config (
  id         integer primary key default 1 check (id = 1),
  cle_api    text,
  expediteur text not null default 'La Wave <resume@lawave.fr>',
  secret     text not null
);

create table if not exists public.email_resume (
  user_id       uuid primary key references public.profiles(id) on delete cascade,
  actif         boolean not null default true,
  jeton         uuid not null default gen_random_uuid() unique,
  cree_le       timestamptz not null default now(),
  dernier_envoi timestamptz
);

alter table public.email_config enable row level security;
alter table public.email_resume enable row level security;
revoke all on table public.email_config, public.email_resume from anon, authenticated;

create or replace function public.email_resume_etat() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select actif from public.email_resume where user_id = auth.uid()), false)
$$;

grant execute on function public.email_resume_etat() to authenticated;

create or replace function public.email_resume_regler(p_actif boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_moi uuid := auth.uid();
begin
  if v_moi is null then raise exception 'Connexion requise.'; end if;
  insert into public.email_resume (user_id, actif) values (v_moi, coalesce(p_actif, true))
  on conflict (user_id) do update set actif = coalesce(p_actif, true);
  return jsonb_build_object('ok', true, 'actif', coalesce(p_actif, true));
end $$;

grant execute on function public.email_resume_regler(boolean) to authenticated;

-- Le lien de désinscription de l'e-mail : le jeton suffit (pas de connexion).
create or replace function public.email_resume_stop(p_jeton uuid) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update public.email_resume set actif = false where jeton = p_jeton;
  return found;
end $$;

grant execute on function public.email_resume_stop(uuid) to anon, authenticated;

-- Le contenu d'un résumé (vide s'il n'y a rien à dire cette semaine).
create or replace function public.email_resume_contenu(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_sorties jsonb; v_posts jsonb; v_defi jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('titre', s.track_title, 'artiste', s.artist_name, 'cover', s.cover_url, 'num', s.catalog_number)
                            order by s.release_date desc), '[]'::jsonb)
    into v_sorties
    from (
      select distinct on (x.id) x.* from public.submissions x
       where x.status = 'approved' and not x.banni and not x.hors_langue
         and x.release_date > current_date - 7 and x.release_date <= current_date
         and (lower(coalesce(x.artist_handle, '')) in (select f.artist_handle from public.artiste_suivis f where f.user_id = p_user)
              or exists (select 1 from public.release_ratings r where r.release_id = x.id and r.user_id = p_user and r.a_ecouter))
       order by x.id limit 12) s;

  select coalesce(jsonb_agg(jsonb_build_object('extrait', left(p.contenu, 160), 'auteur', (select pseudo from public.profiles a where a.id = p.auteur_id),
                                               'reactions', p.nb_reactions) order by p.nb_reactions desc), '[]'::jsonb)
    into v_posts
    from (select * from public.com_posts where cree_le > now() - interval '7 days' and nb_reactions > 0 order by nb_reactions desc limit 3) p;

  v_defi := public.com_defi_courant();

  return jsonb_build_object('sorties', v_sorties, 'posts', v_posts, 'defi', v_defi,
                            'pseudo', (select pseudo from public.profiles where id = p_user));
end $$;

revoke all on function public.email_resume_contenu(uuid) from public, anon, authenticated;
grant execute on function public.email_resume_contenu(uuid) to service_role;

-- Les résumés à envoyer maintenant (une personne au plus tous les six jours, et seulement s'il y a des sorties à annoncer).
create or replace function public.email_resume_a_envoyer() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('user_id', e.user_id, 'email', u.email, 'jeton', e.jeton, 'contenu', c.contenu))
      from public.email_resume e
      join auth.users u on u.id = e.user_id
      cross join lateral (select public.email_resume_contenu(e.user_id) as contenu) c
     where e.actif and (e.dernier_envoi is null or e.dernier_envoi < now() - interval '6 days')
       and jsonb_array_length(c.contenu->'sorties') > 0
       and u.email is not null), '[]'::jsonb);
end $$;

revoke all on function public.email_resume_a_envoyer() from public, anon, authenticated;
grant execute on function public.email_resume_a_envoyer() to service_role;

-- Chaque lundi matin : la fonction Edge envoie, si une clé d'envoi est posée.
create or replace function public.email_resume_declencher() returns void
language plpgsql security definer set search_path = public, extensions as $$
declare v_secret text; v_cle text;
begin
  select secret, cle_api into v_secret, v_cle from public.email_config where id = 1;
  if v_secret is null or v_cle is null then return; end if;
  begin
    perform http_set_curlopt('CURLOPT_TIMEOUT', '50');
  exception when others then null;
  end;
  perform http(('POST', 'https://bqataeghgjyiqrnnesqq.supabase.co/functions/v1/envoyer-resume',
                array[http_header('x-resume-secret', v_secret)], 'application/json', '{}')::http_request);
exception when others then
  null;
end $$;

revoke all on function public.email_resume_declencher() from public, anon, authenticated;

select cron.schedule('email-resume', '0 8 * * 1', 'select public.email_resume_declencher()');
