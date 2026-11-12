-- Vue « par artiste » des sorties à valider (espace équipe) : une ligne par artiste avec le nombre de sorties automatiques
-- en attente et quelques titres, et une décision (tout valider / tout refuser) qui s'applique d'un coup à toutes ses sorties,
-- côté base (pas de liste d'identifiants à faire voyager). Réservé à l'équipe ; ne touche que les sorties automatiques
-- (source renseignée) d'artistes ni bannis ni masqués. Tri : fans Deezer décroissants (ou nombre de sorties).
-- RETRAIT : drop function public.attente_artistes(text, integer, integer, text), public.attente_artiste_traiter(text, boolean, text);

create or replace function public.attente_artistes(p_texte text default '', p_page integer default 0, p_taille integer default 25, p_tri text default 'fans')
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_q text := nullif(replace(replace(btrim(coalesce(p_texte, '')), '%', ''), '_', ''), '');
  v_res jsonb;
  v_total integer;
begin
  if auth.uid() is null or not public.est_equipe() then
    raise exception 'Réservé à l''équipe.';
  end if;

  create temp table if not exists tmp_att_art (handle text, nom text, n integer, fans integer) on commit drop;
  truncate tmp_att_art;

  insert into tmp_att_art
    select s.artist_handle, max(s.artist_name), count(*)::integer, coalesce(max(a.deezer_fans), 0)::integer
      from public.submissions s
      left join public.artists a on a.instagram_handle = s.artist_handle
     where s.status = 'pending' and s.source is not null and not s.banni and not s.hors_langue
       and (v_q is null or s.artist_name ilike '%' || v_q || '%' or s.artist_handle ilike '%' || v_q || '%')
     group by s.artist_handle;

  select count(*) into v_total from tmp_att_art;

  select jsonb_build_object('total', v_total, 'artistes', coalesce(jsonb_agg(q.x order by q.ord), '[]'::jsonb)) into v_res
    from (
      select row_number() over (order by case when p_tri = 'nombre' then t.n else t.fans end desc, t.handle) as ord,
             jsonb_build_object(
               'handle', t.handle, 'nom', t.nom, 'n', t.n, 'fans', t.fans,
               'photo', (select a.photo_url from public.artists a where a.instagram_handle = t.handle),
               'cover', (select s.cover_url from public.submissions s where s.artist_handle = t.handle and s.status = 'pending' and s.source is not null and s.cover_url is not null order by s.release_date desc nulls last limit 1),
               'titres', (select coalesce(jsonb_agg(z.track_title), '[]'::jsonb) from (
                           select s.track_title from public.submissions s
                            where s.artist_handle = t.handle and s.status = 'pending' and s.source is not null
                            order by s.release_date desc nulls last limit 4) z)
             ) as x
        from tmp_att_art t
       order by case when p_tri = 'nombre' then t.n else t.fans end desc, t.handle
       offset greatest(p_page, 0) * greatest(p_taille, 1) limit greatest(least(p_taille, 100), 1)
    ) q;

  return v_res;
end $$;

revoke all on function public.attente_artistes(text, integer, integer, text) from public, anon;
grant execute on function public.attente_artistes(text, integer, integer, text) to authenticated;

create or replace function public.attente_artiste_traiter(p_handle text, p_valider boolean, p_motif text default '')
returns integer
language plpgsql security definer set search_path to 'public' as $$
declare v_n integer;
begin
  if auth.uid() is null or not public.est_equipe() then
    raise exception 'Réservé à l''équipe.';
  end if;
  if nullif(btrim(coalesce(p_handle, '')), '') is null then
    raise exception 'Indique l''artiste.';
  end if;

  if p_valider then
    update public.submissions
       set status = 'approved', validated_at = now(), validated_by = null
     where artist_handle = p_handle and status = 'pending' and source is not null and not banni and not hors_langue;
  else
    update public.submissions
       set status = 'rejected', rejection_reason = coalesce(p_motif, ''), validated_at = now()
     where artist_handle = p_handle and status = 'pending' and source is not null and not banni and not hors_langue;
  end if;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke all on function public.attente_artiste_traiter(text, boolean, text) from public, anon;
grant execute on function public.attente_artiste_traiter(text, boolean, text) to authenticated;
