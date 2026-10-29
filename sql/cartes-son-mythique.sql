-- =====================================================================
-- Wave Cards — le son de la carte Mythique, réglé par l'équipe
--
-- Demande de Rémy : « il faudrait que je puisse choisir le timing et le son sur lequel se lance quand on drop une
-- carte mythique ».
--
--   jeu_reglages                      une ligne par réglage du jeu (clé → valeur JSON). Aucune politique : tout passe
--                                     par les fonctions ci-dessous.
--   jeu_reglage_son_mythique()        lu par le jeu à l'ouverture d'un pack (tout joueur connecté).
--   jeu_equipe_son_mythique_sauver()  écrit par l'équipe (console Wave Cards → Sons) ; noté au journal d'équipe.
--   bucket « sons-jeu »               les fichiers audio envoyés par l'équipe (2 Mo, mp3 / wav / ogg / m4a / webm),
--                                     lisibles par tous, déposés et supprimés par l'équipe seule.
--
-- Valeur d'un réglage « son_mythique » :
--   son        fanfare (défaut) | impact | cristal | artiste (extrait Deezer de l'artiste) | fichier | aucun
--   delai_ms   de -2000 à 4000 : quand le son part, par rapport au retournement de la carte (négatif = avant, pendant
--              la montée ; 0 = au retournement)
--   volume     0 à 100
--   montee     vrai : la montée sonore avant le retournement est jouée
--   url        l'adresse du fichier du bucket sons-jeu (obligatoire avec son = fichier)
--
-- Sans danger à rejouer.
-- =====================================================================

create table if not exists public.jeu_reglages (
  cle text primary key,
  valeur jsonb not null default '{}'::jsonb,
  maj_le timestamptz not null default now(),
  maj_par uuid
);
alter table public.jeu_reglages enable row level security;

insert into public.jeu_reglages (cle, valeur)
values ('son_mythique', '{"son":"fanfare","delai_ms":0,"volume":80,"montee":true,"url":null}'::jsonb)
on conflict (cle) do nothing;


create or replace function public.jeu_reglage_son_mythique()
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select coalesce((select valeur from public.jeu_reglages where cle = 'son_mythique'),
                  '{"son":"fanfare","delai_ms":0,"volume":80,"montee":true,"url":null}'::jsonb);
$$;
revoke all on function public.jeu_reglage_son_mythique() from public, anon;
grant execute on function public.jeu_reglage_son_mythique() to authenticated;


create or replace function public.jeu_equipe_son_mythique_sauver(p_donnees jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_son text; v_delai integer; v_volume integer; v_montee boolean; v_url text; v_valeur jsonb;
  v_motif constant text := '^https://bqataeghgjyiqrnnesqq\.supabase\.co/storage/v1/object/public/sons-jeu/[A-Za-z0-9._/%~-]+$';
begin
  if not public.est_equipe() then raise exception 'Réservé à l''équipe.'; end if;
  p_donnees := coalesce(p_donnees, '{}'::jsonb);

  v_son := coalesce(p_donnees ->> 'son', 'fanfare');
  if v_son not in ('fanfare', 'impact', 'cristal', 'artiste', 'fichier', 'aucun') then
    raise exception 'Son inconnu.';
  end if;

  begin v_delai := coalesce((p_donnees ->> 'delai_ms')::numeric, 0)::integer; exception when others then raise exception 'Le délai doit être un nombre de millisecondes.'; end;
  if v_delai < -2000 or v_delai > 4000 then raise exception 'Le délai va de -2000 à 4000 millisecondes.'; end if;

  begin v_volume := coalesce((p_donnees ->> 'volume')::numeric, 80)::integer; exception when others then raise exception 'Le volume doit être un nombre.'; end;
  if v_volume < 0 or v_volume > 100 then raise exception 'Le volume va de 0 à 100.'; end if;

  begin v_montee := coalesce((p_donnees ->> 'montee')::boolean, true); exception when others then raise exception 'La montée est vraie ou fausse.'; end;

  v_url := nullif(btrim(coalesce(p_donnees ->> 'url', '')), '');
  if v_url is not null and v_url !~ v_motif then raise exception 'Le fichier doit venir du stockage des sons du site.'; end if;
  if v_son = 'fichier' and v_url is null then raise exception 'Envoie un fichier audio, ou choisis un autre son.'; end if;

  v_valeur := jsonb_build_object('son', v_son, 'delai_ms', v_delai, 'volume', v_volume, 'montee', v_montee, 'url', v_url);

  insert into public.jeu_reglages (cle, valeur, maj_le, maj_par) values ('son_mythique', v_valeur, now(), auth.uid())
  on conflict (cle) do update set valeur = excluded.valeur, maj_le = now(), maj_par = auth.uid();

  perform public.jeu_equipe_noter('son_mythique_modifie', v_valeur);
  return v_valeur;
end $$;
revoke all on function public.jeu_equipe_son_mythique_sauver(jsonb) from public, anon;
grant execute on function public.jeu_equipe_son_mythique_sauver(jsonb) to authenticated;


-- Le stockage des sons : lisible par tous, écrit par l'équipe.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('sons-jeu', 'sons-jeu', true, 2097152, array['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/mp4', 'audio/x-m4a', 'audio/webm'])
on conflict (id) do update set public = true, file_size_limit = 2097152,
  allowed_mime_types = array['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/mp4', 'audio/x-m4a', 'audio/webm'];

drop policy if exists "sons jeu lecture publique" on storage.objects;
create policy "sons jeu lecture publique" on storage.objects for select using (bucket_id = 'sons-jeu');
drop policy if exists "sons jeu depot equipe" on storage.objects;
create policy "sons jeu depot equipe" on storage.objects for insert with check (bucket_id = 'sons-jeu' and public.est_admin_lawave());
drop policy if exists "sons jeu suppression equipe" on storage.objects;
create policy "sons jeu suppression equipe" on storage.objects for delete using (bucket_id = 'sons-jeu' and public.est_admin_lawave());
