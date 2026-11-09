-- =====================================================================
-- Le défi de la semaine devient un message épinglé de La Wave
--
-- Avant : une carte au-dessus du fil. Maintenant : un vrai message, publié
-- depuis l'onglet « Défis » de l'espace équipe, épinglé en haut de la
-- communauté ; chacun répond en commentaire pour valider son défi.
-- Le message est signé « La Wave » côté site (l'auteur réel reste le membre
-- de l'équipe qui l'a publié).
--
-- Retrait : drop function com_defis_equipe, com_defi_publier, com_defi_retirer ;
--           alter table com_posts drop column defi_id.
-- =====================================================================

alter table public.com_posts
  add column if not exists defi_id uuid references public.com_defis(id) on delete set null;

create unique index if not exists com_posts_defi_idx on public.com_posts (defi_id) where defi_id is not null;

-- com_post_json : le message dit s'il porte un défi.
create or replace function public.com_post_json(p_id uuid, p_moi uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  p public.com_posts;
begin
  select * into p from public.com_posts where id = p_id;

  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'id',              p.id,
    'type',            p.type,
    'sujet',           p.sujet,
    'contenu',         p.contenu,
    'images',          to_jsonb(p.images),
    'lien',            p.lien,
    'tags',            to_jsonb(p.tags),
    'collab',          p.collab,
    'epingle',         p.epingle,
    'defi',            (select jsonb_build_object('titre', d.titre, 'debut', d.debut, 'fin', d.fin)
                          from public.com_defis d where d.id = p.defi_id),
    'nb_reactions',    p.nb_reactions,
    'nb_commentaires', p.nb_commentaires,
    'cree_le',         p.cree_le,
    'modifie_le',      p.modifie_le,
    'auteur',          public.com_auteur_json(p.auteur_id),
    'mentions',        case when p.contenu like '%@%' then coalesce((
      select jsonb_agg(pr.pseudo)
        from public.profiles pr
       where lower(pr.pseudo) = any (public.com_extraire_mentions(p.contenu))
    ), '[]'::jsonb) else '[]'::jsonb end,
    'reactions',       coalesce((
      select jsonb_agg(jsonb_build_object('emoji', r.emoji, 'n', r.n) order by r.n desc, r.emoji)
        from (
          select emoji, count(*) as n
            from public.com_reactions
           where cible_type = 'post' and cible_id = p.id
           group by emoji
        ) r
    ), '[]'::jsonb),
    'moi',             jsonb_build_object(
      'reaction', (
        select emoji from public.com_reactions
         where user_id = p_moi and cible_type = 'post' and cible_id = p.id
      ),
      'favori', exists (
        select 1 from public.com_favoris f
         where f.user_id = p_moi and f.post_id = p.id
      )
    )
  );
end $$;


-- Les défis, avec leur message s'il est publié (espace équipe).
create or replace function public.com_defis_equipe() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.est_equipe() then raise exception 'Réservé à l''équipe.'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', d.id, 'titre', d.titre, 'consigne', d.consigne, 'tag', d.tag, 'debut', d.debut, 'fin', d.fin,
             'post_id', p.id, 'epingle', coalesce(p.epingle, false),
             'nb_commentaires', coalesce(p.nb_commentaires, 0), 'nb_reactions', coalesce(p.nb_reactions, 0))
           order by d.debut desc)
      from public.com_defis d
      left join public.com_posts p on p.defi_id = d.id
  ), '[]'::jsonb);
end $$;

-- Publie le défi : un message épinglé en haut de la communauté. Les défis
-- précédents se désépinglent (leurs réponses restent lisibles).
create or replace function public.com_defi_publier(p_defi uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  d public.com_defis;
  v_id uuid;
begin
  if not public.est_equipe() then raise exception 'Réservé à l''équipe.'; end if;
  select * into d from public.com_defis where id = p_defi;
  if not found then raise exception 'Défi introuvable.'; end if;
  if exists (select 1 from public.com_posts where defi_id = d.id) then
    raise exception 'Ce défi est déjà publié.';
  end if;

  update public.com_posts set epingle = false where defi_id is not null;

  insert into public.com_posts (auteur_id, type, sujet, contenu, tags, epingle, defi_id)
  values (auth.uid(), 'message', 'annonces',
          E'Défi de la semaine : ' || d.titre || E'\n\n' || d.consigne
            || E'\n\nRéponds en commentaire sous ce message pour valider ton défi. Jusqu''au '
            || to_char(d.fin, 'DD/MM') || '.',
          array[d.tag], true, d.id)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'post_id', v_id);
end $$;

-- Retire le message du défi (et ses réponses) ; le défi reste, republiable.
create or replace function public.com_defi_retirer(p_defi uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.est_equipe() then raise exception 'Réservé à l''équipe.'; end if;
  delete from public.com_posts where defi_id = p_defi;
  return jsonb_build_object('ok', true);
end $$;

revoke execute on function public.com_defis_equipe()     from public, anon;
revoke execute on function public.com_defi_publier(uuid) from public, anon;
revoke execute on function public.com_defi_retirer(uuid) from public, anon;
grant execute on function public.com_defis_equipe()          to authenticated;
grant execute on function public.com_defi_publier(uuid)      to authenticated;
grant execute on function public.com_defi_retirer(uuid)      to authenticated;

-- Le défi de la semaine en cours, publié une première fois (à passer une seule fois, en tant qu'équipe) :
--   select public.com_defi_publier((select id from public.com_defis where current_date between debut and fin));
