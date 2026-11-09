-- =====================================================================
-- « Question de la semaine » : un encadré sous « Explorer », hors du fil
--
-- Le message du défi (sql/defis-epingles.sql) n'est plus dans le fil ni épinglé :
-- il vit dans l'encadré de la communauté ; les réponses sont ses commentaires.
-- Retrait : recréer com_candidats sans la ligne « defi_id is null ».
-- =====================================================================

create or replace function public.com_candidats(p_moi uuid, p_vue text, p_sujet text, p_type text, p_tag text, p_auteur uuid, p_motif text, p_favoris boolean)
 returns setof public.com_posts
 language sql
 stable
 set search_path to 'public', 'extensions', 'pg_temp'
as $function$
  select p.*
    from public.com_posts p
   where p.defi_id is null
     and (p_sujet  is null or p.sujet = p_sujet)
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
$function$;

-- La question en cours, avec son message (pour répondre) et le nombre de réponses.
create or replace function public.com_defi_courant() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
           'id', d.id, 'titre', d.titre, 'consigne', d.consigne, 'debut', d.debut, 'fin', d.fin,
           'jours_restants', greatest(d.fin - current_date, 0),
           'post_id', p.id, 'nb', p.nb_commentaires)
    from public.com_defis d
    join public.com_posts p on p.defi_id = d.id
   where current_date between d.debut and d.fin
   order by d.debut desc
   limit 1;
$$;

grant execute on function public.com_defi_courant() to anon, authenticated;

-- Publier une question ne l'épingle plus ; le texte du message dit « Question de la semaine ».
create or replace function public.com_defi_publier(p_defi uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  d public.com_defis;
  v_id uuid;
begin
  if not public.est_equipe() then raise exception 'Réservé à l''équipe.'; end if;
  select * into d from public.com_defis where id = p_defi;
  if not found then raise exception 'Question introuvable.'; end if;
  if exists (select 1 from public.com_posts where defi_id = d.id) then
    raise exception 'Cette question est déjà publiée.';
  end if;

  insert into public.com_posts (auteur_id, type, sujet, contenu, tags, epingle, defi_id)
  values (auth.uid(), 'message', 'annonces',
          E'Question de la semaine : ' || d.titre || E'\n\n' || d.consigne
            || E'\n\nRéponds en commentaire, avec une sortie du catalogue si tu veux. Jusqu''au '
            || to_char(d.fin, 'DD/MM') || '.',
          array[d.tag], false, d.id)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'post_id', v_id);
end $$;

update public.com_posts p
   set epingle = false,
       contenu = replace(replace(contenu, 'Défi de la semaine : ', 'Question de la semaine : '),
                         E'\n\nRéponds en commentaire sous ce message pour valider ton défi.',
                         E'\n\nRéponds en commentaire, avec une sortie du catalogue si tu veux.')
 where p.defi_id is not null;

-- Les styles de musique des profils disparaissent.
update public.profiles set genres = '{}' where genres is not null and cardinality(genres) > 0;
