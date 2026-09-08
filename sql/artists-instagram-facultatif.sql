-- =====================================================================
-- La Wave — l'Instagram d'un artiste devient facultatif
--
-- La colonne était NOT NULL : tous les profils venaient d'une
-- soumission, qui l'exige. Les profils importés n'en ont pas — leur
-- pseudo est déduit de leur nom, donc invérifiable, et le site refuse
-- d'inventer un lien qui serait faux.
--
-- Le site sait déjà vivre sans : instagramConnu() teste la colonne
-- partout où elle est affichée, et le formulaire demande le pseudo à
-- celui qui soumet une sortie pour un de ces artistes. La colonne se
-- remplit alors d'elle-même à la validation.
--
-- À exécuter AVANT 01-artistes.sql.
-- =====================================================================


alter table public.artists
  alter column instagram_url drop not null;


-- ---------------------------------------------------------------------
-- Les mêmes vérifications sur submissions
--
-- L'import ne renseigne ni l'Instagram ni l'email de contact. Le site
-- écrit déjà null dans ces deux colonnes en fonctionnement normal,
-- elles devraient donc l'accepter — ce bloc s'en assure sans rien
-- forcer d'autre.
-- ---------------------------------------------------------------------

do $$
begin

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'submissions'
      and column_name = 'instagram_url' and is_nullable = 'NO'
  ) then
    alter table public.submissions alter column instagram_url drop not null;
    raise notice 'submissions.instagram_url : NOT NULL retiré.';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'submissions'
      and column_name = 'contact_email' and is_nullable = 'NO'
  ) then
    alter table public.submissions alter column contact_email drop not null;
    raise notice 'submissions.contact_email : NOT NULL retiré.';
  end if;

end $$;


-- ---------------------------------------------------------------------
-- Vérification
--
-- Liste ce qui reste obligatoire et sans valeur par défaut sur les
-- deux tables. Tout ce qui apparaît ici doit être fourni par l'import ;
-- s'il y figure autre chose que ce que les fichiers renseignent, le
-- chargement s'arrêtera dessus.
-- ---------------------------------------------------------------------

select table_name, column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name in ('artists', 'submissions')
  and is_nullable = 'NO'
  and column_default is null
order by table_name, column_name;
