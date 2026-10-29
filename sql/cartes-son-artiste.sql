-- =====================================================================
-- Wave Cards — le morceau de chaque carte Mythique, choisi par l'équipe
--
-- Demande de Rémy : « pouvoir choisir l'un des morceaux et le timecode du morceau des artistes mythiques moi-même,
-- directement depuis l'onglet cartes, avec une option à côté de la carte de l'artiste quand il est en mythique ».
--
--   jeu_booster_cartes.son_titre   l'identifiant Deezer du morceau choisi (vide = le réglage général de la console →
--                                  Sons). On garde l'identifiant, pas l'adresse de l'aperçu : elle expire au bout de
--                                  quelques heures, le jeu la redemande à Deezer à chaque ouverture.
--   jeu_booster_cartes.son_nom     le titre, pour l'afficher dans la console.
--   jeu_booster_cartes.son_debut   la seconde de départ dans l'extrait de 30 s (0 à 29).
--   jeu_booster_cartes.clip_id     l'identifiant YouTube (11 signes) du clip joué en fond, muet, derrière la carte.
--   jeu_booster_cartes.clip_debut  la seconde de départ du clip (0 à 3599).
--   jeu_booster_cartes.clip_son    vrai : le son du clip (le morceau en entier) est joué à la place de l'extrait Deezer.
--   jeu_equipe_cartes()            renvoie aussi tout cela.
--   jeu_equipe_carte_son()         l'équipe règle (ou retire) le morceau et le clip d'une carte ; noté au journal.
--   jeu_son_carte()                lu par le jeu quand une carte Mythique est révélée.
--
-- Sans danger à rejouer.
-- =====================================================================

alter table public.jeu_booster_cartes
  add column if not exists son_titre bigint,
  add column if not exists son_nom text,
  add column if not exists son_debut integer not null default 0,
  add column if not exists clip_id text,
  add column if not exists clip_debut integer not null default 0,
  add column if not exists clip_son boolean not null default false;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'jeu_booster_cartes_son_debut_check') then
    alter table public.jeu_booster_cartes add constraint jeu_booster_cartes_son_debut_check check (son_debut between 0 and 29);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'jeu_booster_cartes_clip_check') then
    alter table public.jeu_booster_cartes add constraint jeu_booster_cartes_clip_check
      check ((clip_id is null or clip_id ~ '^[A-Za-z0-9_-]{11}$') and clip_debut between 0 and 3599);
  end if;
end $$;


-- La console lit le morceau et le clip avec la carte.
do $$
declare d text;
begin
  d := pg_get_functiondef('public.jeu_equipe_cartes(text)'::regprocedure);
  if position('''son_titre''' in d) = 0 then
    d := replace(d, '''exemplaires'', coalesce(o.exemplaires, 0))', '''exemplaires'', coalesce(o.exemplaires, 0), ''son_titre'', bc.son_titre, ''son_nom'', bc.son_nom, ''son_debut'', bc.son_debut)');
  end if;
  if position('''clip_id''' in d) = 0 then
    d := replace(d, '''son_debut'', bc.son_debut)', '''son_debut'', bc.son_debut, ''clip_id'', bc.clip_id, ''clip_debut'', bc.clip_debut)');
  end if;
  if position('''clip_son''' in d) = 0 then
    d := replace(d, '''clip_debut'', bc.clip_debut)', '''clip_debut'', bc.clip_debut, ''clip_son'', bc.clip_son)');
  end if;
  if position('''clip_son''' in d) = 0 then raise exception 'jeu_equipe_cartes : motif introuvable'; end if;
  execute d;
end $$;


drop function if exists public.jeu_equipe_carte_son(text, uuid, bigint, text, integer);
drop function if exists public.jeu_equipe_carte_son(text, uuid, bigint, text, integer, text, integer);
create or replace function public.jeu_equipe_carte_son(p_booster text, p_artiste uuid, p_titre bigint, p_nom text, p_debut integer,
                                                       p_clip text default null, p_clip_debut integer default 0, p_clip_son boolean default false)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_debut integer := coalesce(p_debut, 0); v_nom text := left(nullif(btrim(coalesce(p_nom, '')), ''), 160);
  v_clip text := nullif(btrim(coalesce(p_clip, '')), ''); v_clip_debut integer := coalesce(p_clip_debut, 0); v_clip_son boolean;
begin
  if not public.est_equipe() then raise exception 'Réservé à l''équipe.'; end if;
  if p_titre is not null and p_titre <= 0 then raise exception 'Morceau invalide.'; end if;
  if v_debut < 0 or v_debut > 29 then raise exception 'Le départ se règle entre 0 et 29 secondes (l''extrait dure 30 secondes).'; end if;
  if v_clip is not null and v_clip !~ '^[A-Za-z0-9_-]{11}$' then raise exception 'Lien YouTube invalide.'; end if;
  if v_clip_debut < 0 or v_clip_debut > 3599 then raise exception 'Le départ du clip se règle entre 0 et 3599 secondes.'; end if;
  if p_titre is null then v_debut := 0; v_nom := null; end if;
  if v_clip is null then v_clip_debut := 0; end if;
  v_clip_son := coalesce(p_clip_son, false) and v_clip is not null;

  update public.jeu_booster_cartes
     set son_titre = p_titre, son_nom = v_nom, son_debut = v_debut, clip_id = v_clip, clip_debut = v_clip_debut, clip_son = v_clip_son
   where booster_id = p_booster and artist_id = p_artiste;
  if not found then raise exception 'Cette carte n''est pas dans la collection.'; end if;

  perform public.jeu_equipe_noter(case when p_titre is null and v_clip is null then 'carte_son_retire' else 'carte_son_regle' end,
    jsonb_build_object('booster', p_booster, 'artiste', p_artiste, 'titre', p_titre, 'nom', v_nom, 'debut', v_debut, 'clip', v_clip, 'clip_debut', v_clip_debut, 'clip_son', v_clip_son));
  return jsonb_build_object('son_titre', p_titre, 'son_nom', v_nom, 'son_debut', v_debut, 'clip_id', v_clip, 'clip_debut', v_clip_debut, 'clip_son', v_clip_son);
end $$;
revoke all on function public.jeu_equipe_carte_son(text, uuid, bigint, text, integer, text, integer, boolean) from public, anon;
grant execute on function public.jeu_equipe_carte_son(text, uuid, bigint, text, integer, text, integer, boolean) to authenticated;


-- Le jeu : le morceau et le clip d'une carte (vide si l'équipe n'en a pas choisi).
create or replace function public.jeu_son_carte(p_booster text, p_artiste uuid)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select case when bc.son_titre is null and bc.clip_id is null then null
              else jsonb_build_object('titre', bc.son_titre, 'nom', bc.son_nom, 'debut', bc.son_debut, 'clip', bc.clip_id, 'clip_debut', bc.clip_debut, 'clip_son', bc.clip_son) end
    from public.jeu_booster_cartes bc
   where bc.booster_id = p_booster and bc.artist_id = p_artiste;
$$;
revoke all on function public.jeu_son_carte(text, uuid) from public, anon;
grant execute on function public.jeu_son_carte(text, uuid) to authenticated;
