-- Correctif : la règle de lecture des vocaux interrogeait com_messages (fermée aux comptes connectés) ; Postgres
-- évalue toutes les règles de lecture de storage.objects, donc LIRE N'IMPORTE QUEL fichier privé échouait
-- (« Capture introuvable » dans l'espace équipe). La vérification passe par une fonction aux droits propres.
create or replace function public.com_vocal_lisible(p_chemin text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.com_messages m
      join public.com_participants p on p.conversation_id = m.conversation_id and p.user_id = auth.uid()
     where m.audio_path = p_chemin);
$$;
revoke all on function public.com_vocal_lisible(text) from public, anon;
grant execute on function public.com_vocal_lisible(text) to authenticated;

drop policy if exists "vocaux lus par la conversation" on storage.objects;
create policy "vocaux lus par la conversation" on storage.objects for select to authenticated
using (bucket_id = 'vocaux' and ((storage.foldername(name))[1] = auth.uid()::text or public.com_vocal_lisible(name)));
