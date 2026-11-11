-- Tous les artistes du site sont suivis sur Deezer (sorties, projets, featurings, concerts), les nouveaux aussi.
-- (Passé en production le 2026-11-12.)
-- « Du site » = relié à Deezer, francophone, pas banni. Un artiste non francophone (masqué) ou banni n'est pas suivi.
-- Le déclencheur ne suit que quand l'artiste vient d'être créé ou que son lien Deezer, sa langue ou son bannissement
-- changent : un artiste qu'un membre de l'équipe a volontairement retiré du suivi ne revient pas tout seul.
-- RETRAIT : drop trigger artists_suivi_auto on public.artists; drop function public.artists_suivi_auto();
--   (les artistes déjà suivis le restent ; pour les défaire : update public.artists set deezer_suivi = false where source = 'deezer-auto' and ...)

create or replace function public.artists_suivi_auto() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  if new.deezer_artist_id is not null
     and coalesce(new.banni, false) = false
     and new.francophone is true
     and not coalesce(new.deezer_suivi, false)
     and (tg_op = 'INSERT'
          or new.deezer_artist_id is distinct from old.deezer_artist_id
          or new.francophone      is distinct from old.francophone
          or new.banni            is distinct from old.banni) then
    new.deezer_suivi := true;
  end if;
  return new;
end $$;
revoke all on function public.artists_suivi_auto() from public, anon, authenticated;

drop trigger if exists artists_suivi_auto on public.artists;
create trigger artists_suivi_auto before insert or update on public.artists
  for each row execute function public.artists_suivi_auto();

-- Les artistes déjà sur le site.
update public.artists
   set deezer_suivi = true
 where deezer_artist_id is not null and coalesce(banni, false) = false and francophone is true and not coalesce(deezer_suivi, false);
