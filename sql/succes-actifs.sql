-- Succès : retire ceux que plus aucune fonctionnalité du site ne permet d'obtenir.
--
-- Les duels, les pépites (découvreur) et la saison Halloween ont quitté le site (PR #152) : leurs 15 succès
-- ne pouvaient plus se débloquer. Ils sont rangés (actif = false), pas supprimés :
--   - ils disparaissent de la liste des succès et du total (« 12 / 56 ») ;
--   - ceux que quelqu'un a déjà obtenus restent visibles chez lui et comptés dans son total ;
--   - le moteur ne les évalue plus ;
--   - rien n'est effacé : il suffit de repasser actif à true si la fonctionnalité revient.
--
-- À passer une fois dans l'éditeur SQL de Supabase (ou par Claude, avec l'accord de Rémy). Rejouable.

alter table public.succes_def add column if not exists actif boolean not null default true;

update public.succes_def
   set actif = false
 where id in (
   'duel-1', 'duel-10', 'duel-30', 'duel-100',
   'pepite-1', 'pepite-3', 'pepite-10', 'pepite-25',
   'chapitre-1', 'chapitre-4',
   'citrouille-7', 'citrouille-25',
   'saison-palier-10', 'saison-palier-20', 'saison-palier-30');


-- Le moteur n'évalue que les succès actifs.
create or replace function public.xp_succes_evaluer(p_user uuid, p_silencieux boolean default false)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  m jsonb; d record; v_n integer; v_nouveau integer; v_total integer := 0; v_tour integer;
begin
  for v_tour in 1..3 loop
    v_nouveau := 0;
    m := public.xp_metriques(p_user);

    for d in
      select * from public.succes_def sd
       where sd.actif
         and not exists (select 1 from public.succes_obtenus o where o.user_id = p_user and o.succes_id = sd.id)
       order by sd.ordre
    loop
      if coalesce((m ->> d.metrique)::numeric, 0) >= d.seuil then
        insert into public.succes_obtenus (user_id, succes_id) values (p_user, d.id) on conflict do nothing;
        get diagnostics v_n = row_count;
        if v_n > 0 then
          v_nouveau := v_nouveau + 1;
          if not p_silencieux then
            perform public.xp_brut(p_user, 'succes', d.id, d.xp);
            perform public.xp_evt(p_user, 'succes', jsonb_build_object(
              'id', d.id, 'nom', d.nom, 'description', d.description, 'icone', d.icone,
              'rang', d.rang, 'xp', d.xp, 'secret', d.secret));
          end if;
        end if;
      end if;
    end loop;

    v_total := v_total + v_nouveau;
    exit when v_nouveau = 0 or p_silencieux;
  end loop;

  return v_total;
end $function$;


-- La liste : les succès actifs, plus ceux (rangés) que ce membre a déjà obtenus.
create or replace function public.xp_succes_liste(p_user uuid default null::uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_moi uuid := auth.uid();
  v_user uuid := coalesce(p_user, auth.uid());
  v_sien boolean;
  m jsonb;
  v_membres integer;
  v_liste jsonb;
begin
  if v_moi is null or v_user is null then return null; end if;
  v_sien := v_user = v_moi;

  if v_sien then
    perform public.xp_succes_evaluer(v_user);
    m := public.xp_metriques(v_user);
  end if;

  select count(*) into v_membres from public.profiles;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', d.id, 'famille', d.famille, 'categorie', d.categorie, 'rang', d.rang,
           'nom',         case when d.secret and o.user_id is null then '???' else d.nom end,
           'description', case when d.secret and o.user_id is null then 'Succès secret : à toi de le trouver.' else d.description end,
           'icone',       case when d.secret and o.user_id is null then '❓' else d.icone end,
           'seuil',       case when d.secret and o.user_id is null then null else d.seuil end,
           'valeur',      case when v_sien and (not d.secret or o.user_id is not null)
                               then coalesce((m ->> d.metrique)::numeric, 0) else null end,
           'xp', d.xp, 'secret', d.secret, 'obtenu_le', o.obtenu_le,
           'detenteurs',  (select count(*) from public.succes_obtenus x where x.succes_id = d.id))
         order by d.ordre), '[]'::jsonb)
    into v_liste
    from public.succes_def d
    left join public.succes_obtenus o on o.succes_id = d.id and o.user_id = v_user
   where d.actif or o.user_id is not null;

  return jsonb_build_object('membres', v_membres, 'liste', v_liste);
end $function$;


-- Le résumé de l'XP (panneau des défis) : total et « prochains succès » sans les succès rangés.
create or replace function public.xp_moi()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_jour date := public.xp_jour();
  v_deb date := date_trunc('week', public.xp_jour())::date;
  p public.profiles%rowtype;
  e public.xp_etat%rowtype;
  n integer; v_mult numeric; v_serie integer; v_semaine integer; v_rang integer;
  v_quetes jsonb; v_coffre integer; v_paliers jsonb; v_recents jsonb; v_prochains jsonb;
  m jsonb; v_obtenus integer; v_total integer;
begin
  if v_uid is null then return null; end if;

  perform public.xp_etat_assurer(v_uid);
  perform public.xp_crediter(v_uid, 'connexion', v_jour::text);
  perform public.xp_quetes_assurer(v_uid);
  perform public.xp_profil_verifier(v_uid);
  perform public.xp_succes_evaluer(v_uid);
  perform public.xp_niveau_verifier(v_uid);

  select * into p from public.profiles where id = v_uid;
  select * into e from public.xp_etat where user_id = v_uid;
  if not found or p.id is null then return null; end if;

  n := public.xp_niveau(coalesce(p.xp, 0));

  v_serie := case when e.dernier_jour >= v_jour - 1 or (e.dernier_jour = v_jour - 2 and e.gels > 0)
                  then e.serie else 0 end;
  v_mult := case when v_serie >= 14 then 1.5 when v_serie >= 7 then 1.25 when v_serie >= 3 then 1.1 else 1 end;

  select coalesce(jsonb_agg(jsonb_build_object(
           'slot', q.slot, 'id', q.def_id, 'libelle', q.libelle, 'icone', q.icone,
           'progres', q.progres, 'objectif', q.objectif, 'xp', q.xp, 'faite', q.faite_le is not null)
         order by q.slot), '[]'::jsonb)
    into v_quetes
    from public.xp_quetes q where q.user_id = v_uid and q.jour = v_jour;

  select xp into v_coffre from public.xp_journal where user_id = v_uid and action = 'coffre' and ref = v_jour::text;

  select coalesce(sum(xp), 0) into v_semaine
    from public.xp_journal where user_id = v_uid and jour >= v_deb and action <> 'semaine';

  select coalesce(jsonb_agg(jsonb_build_object(
           'palier', s.palier, 'seuil', s.seuil, 'bonus', s.bonus, 'atteint', v_semaine >= s.seuil)
         order by s.palier), '[]'::jsonb)
    into v_paliers from public.xp_paliers_semaine() s;

  select r.rang into v_rang
    from (select user_id, rank() over (order by sum(xp) desc) as rang
            from public.xp_journal where jour >= v_deb group by user_id having sum(xp) > 0) r
   where r.user_id = v_uid;

  m := public.xp_metriques(v_uid);

  -- Les succès rangés ne comptent que chez ceux qui les ont déjà.
  select count(*) into v_total from public.succes_def d
   where d.actif or exists (select 1 from public.succes_obtenus o where o.user_id = v_uid and o.succes_id = d.id);
  select count(*) into v_obtenus from public.succes_obtenus where user_id = v_uid;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', d.id, 'nom', d.nom, 'icone', d.icone, 'rang', d.rang, 'obtenu_le', o.obtenu_le)
         order by o.obtenu_le desc), '[]'::jsonb)
    into v_recents
    from (select * from public.succes_obtenus where user_id = v_uid order by obtenu_le desc limit 3) o
    join public.succes_def d on d.id = o.succes_id;

  select coalesce(jsonb_agg(t.x order by t.ratio desc), '[]'::jsonb)
    into v_prochains
    from (
      select jsonb_build_object('id', d.id, 'nom', d.nom, 'icone', d.icone, 'rang', d.rang,
               'description', d.description, 'valeur', q.v, 'seuil', d.seuil, 'xp', d.xp) as x,
             q.v / d.seuil as ratio
        from public.succes_def d
        cross join lateral (select coalesce((m ->> d.metrique)::numeric, 0) as v) q
       where d.actif
         and not d.secret
         and not exists (select 1 from public.succes_obtenus o where o.user_id = v_uid and o.succes_id = d.id)
       order by q.v / d.seuil desc, d.ordre
       limit 3
    ) t;

  return jsonb_build_object(
    'xp',            coalesce(p.xp, 0),
    'niveau',        n,
    'titre',         public.xp_titre(n),
    'seuil_bas',     public.xp_seuil(n),
    'seuil_haut',    case when n >= 60 then null else public.xp_seuil(n + 1) end,
    'serie',         v_serie,
    'serie_max',     e.serie_max,
    'fait_aujourdhui', e.dernier_jour = v_jour,
    'gels',          e.gels,
    'multiplicateur', v_mult,
    'quetes',        v_quetes,
    'coffre',        jsonb_build_object('ouvert', v_coffre is not null, 'xp', v_coffre),
    'semaine',       jsonb_build_object(
                       'xp', v_semaine, 'paliers', v_paliers, 'rang', v_rang,
                       'jours_restants', (v_deb + 6) - v_jour),
    'succes',        jsonb_build_object(
                       'obtenus', v_obtenus, 'total', v_total,
                       'recents', v_recents, 'prochains', v_prochains)
  );
end $function$;
