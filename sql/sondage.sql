-- ============================================================
-- SONDAGE DES TESTEURS (TEMPORAIRE) — réponses au sondage du site
--
-- Chaque testeur (identifié par son accès au portail, ou par son compte
-- s'il est connecté) a UNE ligne : ses réponses se complètent au fil de
-- l'eau et peuvent être modifiées. L'équipe les lit depuis l'espace
-- équipe, onglet « Sondage ».
--
-- À passer dans Supabase (SQL Editor) AVANT de transférer sondage.js
-- et index.html. Peut être rejoué sans risque.
--
-- RETRAIT, quand le test est fini :
--   drop function if exists public.sondage_mien(text), public.sondage_enregistrer(text, jsonb, boolean, integer, text),
--     public.sondage_equipe_lire(), public.sondage_equipe_supprimer(text), public.sondage_identite(text);
--   drop table if exists public.sondage_reponses;
--   (puis retirer sondage.js, la page #page-sondage et l'onglet « Sondage » d'index.html)
-- ============================================================

create table if not exists public.sondage_reponses (
  email       text primary key check (email = lower(btrim(email))),
  reponses    jsonb not null default '{}'::jsonb check (jsonb_typeof(reponses) = 'object'),
  progression integer not null default 0 check (progression between 0 and 100),
  termine     boolean not null default false,
  appareil    text check (appareil is null or char_length(appareil) <= 20),
  cree_le     timestamptz not null default now(),
  maj_le      timestamptz not null default now(),
  termine_le  timestamptz
);

alter table public.sondage_reponses enable row level security;
revoke all on table public.sondage_reponses from anon, authenticated;


-- Qui répond : l'adresse e-mail de l'accès au portail (jeton valide), à défaut celle du compte connecté.
create or replace function public.sondage_identite(p_jeton text)
returns text
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_email text;
begin
  select s.email into v_email
    from public.acces_sessions s
    join public.acces_testeurs t on t.email = s.email
   where s.empreinte = encode(sha256(convert_to(coalesce(p_jeton, ''), 'UTF8')), 'hex')
     and s.expire_le > now()
     and t.revoque_le is null;

  if v_email is null and auth.uid() is not null then
    select lower(btrim(u.email)) into v_email from auth.users u where u.id = auth.uid();
  end if;

  if v_email is null then
    raise exception 'Connecte-toi pour répondre au sondage.';
  end if;

  return v_email;
end $$;


-- Ses propres réponses, pour reprendre où l'on s'était arrêté.
create or replace function public.sondage_mien(p_jeton text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_email text := public.sondage_identite(p_jeton);
  v_ligne public.sondage_reponses;
begin
  select * into v_ligne from public.sondage_reponses where email = v_email;

  if not found then
    return jsonb_build_object('reponses', '{}'::jsonb, 'termine', false, 'progression', 0, 'maj_le', null);
  end if;

  return jsonb_build_object(
    'reponses', v_ligne.reponses,
    'termine', v_ligne.termine,
    'progression', v_ligne.progression,
    'maj_le', v_ligne.maj_le
  );
end $$;


-- Enregistre (ou met à jour) ses réponses. p_termine = true quand il envoie le sondage.
create or replace function public.sondage_enregistrer(
  p_jeton text,
  p_reponses jsonb,
  p_termine boolean default false,
  p_progression integer default 0,
  p_appareil text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_email text := public.sondage_identite(p_jeton);
  v_termine boolean := coalesce(p_termine, false);
begin
  if p_reponses is null or jsonb_typeof(p_reponses) <> 'object' then
    raise exception 'Réponses invalides.';
  end if;

  if char_length(p_reponses::text) > 120000 then
    raise exception 'Les réponses sont trop longues.';
  end if;

  insert into public.sondage_reponses as r (email, reponses, progression, termine, appareil, termine_le)
  values (
    v_email,
    p_reponses,
    least(greatest(coalesce(p_progression, 0), 0), 100),
    v_termine,
    left(nullif(btrim(coalesce(p_appareil, '')), ''), 20),
    case when v_termine then now() end
  )
  on conflict (email) do update
    set reponses    = excluded.reponses,
        progression = excluded.progression,
        termine     = r.termine or excluded.termine,
        appareil    = coalesce(excluded.appareil, r.appareil),
        maj_le      = now(),
        termine_le  = case
                        when excluded.termine and r.termine_le is null then now()
                        else r.termine_le
                      end;

  return jsonb_build_object('ok', true, 'termine', v_termine);
end $$;


-- Équipe : toutes les réponses, avec le nom donné à l'invitation.
create or replace function public.sondage_equipe_lire()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  perform public.acces_exiger_equipe();

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'email', r.email,
             'nom', t.nom,
             'reponses', r.reponses,
             'progression', r.progression,
             'termine', r.termine,
             'appareil', r.appareil,
             'cree_le', r.cree_le,
             'maj_le', r.maj_le,
             'termine_le', r.termine_le
           ) order by r.maj_le desc)
      from public.sondage_reponses r
      left join public.acces_testeurs t on t.email = r.email
  ), '[]'::jsonb);
end $$;


-- Équipe : retire la réponse d'un testeur (un essai, un doublon).
create or replace function public.sondage_equipe_supprimer(p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  perform public.acces_exiger_equipe();
  delete from public.sondage_reponses where email = lower(btrim(coalesce(p_email, '')));
  return jsonb_build_object('ok', true);
end $$;


-- Les droits : seul ce qu'il faut est appelable depuis le navigateur.
revoke all on function public.sondage_identite(text) from public, anon, authenticated;
revoke all on function public.sondage_mien(text) from public, anon, authenticated;
revoke all on function public.sondage_enregistrer(text, jsonb, boolean, integer, text) from public, anon, authenticated;
revoke all on function public.sondage_equipe_lire() from public, anon, authenticated;
revoke all on function public.sondage_equipe_supprimer(text) from public, anon, authenticated;

grant execute on function public.sondage_mien(text) to anon, authenticated;
grant execute on function public.sondage_enregistrer(text, jsonb, boolean, integer, text) to anon, authenticated;
grant execute on function public.sondage_equipe_lire() to authenticated;
grant execute on function public.sondage_equipe_supprimer(text) to authenticated;
