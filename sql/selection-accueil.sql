-- =====================================================================
-- La Wave — la sélection de l'accueil
--
-- Une poignée de sorties du catalogue, choisies par l'équipe, mises en avant à
-- l'accueil dans un défilé de grandes pochettes. L'équipe les ajoute, les retire
-- et les ordonne dans l'espace équipe (onglet « Sélection »).
--
-- Une ligne par sortie choisie ; `ordre` donne la place (de 1 à n). Lecture
-- publique (c'est l'accueil) ; écriture réservée à l'équipe. Une sortie
-- supprimée du catalogue sort d'elle-même de la sélection.
--
-- Sans danger à rejouer.
-- =====================================================================

create table if not exists public.selection_accueil (
  release_id uuid        primary key references public.submissions(id) on delete cascade,
  ordre      integer     not null default 0,
  ajoute_par uuid        references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists selection_accueil_ordre_idx
  on public.selection_accueil (ordre);

alter table public.selection_accueil enable row level security;

drop policy if exists "selection lecture publique" on public.selection_accueil;
drop policy if exists "selection ecriture equipe"   on public.selection_accueil;

create policy "selection lecture publique"
  on public.selection_accueil for select
  using (true);

create policy "selection ecriture equipe"
  on public.selection_accueil for all
  to authenticated
  using (public.est_equipe())
  with check (public.est_equipe());

grant select on public.selection_accueil to anon, authenticated;
grant insert, update, delete on public.selection_accueil to authenticated;
