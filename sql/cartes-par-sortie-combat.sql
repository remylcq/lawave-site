-- Wave Cards : le titre de la sortie accompagne la carte dans le combat (choix d'équipe, adversaires de la Tour) (2026-11-09).
-- La définition de combat_identite et de combat_unite est relue en base puis modifiée (rien n'est refait si c'est déjà fait).
do $$
declare d text;
begin
  d := pg_get_functiondef('public.combat_identite(uuid,integer,boolean,boolean,text,uuid,integer,integer)'::regprocedure);
  if position('''titre'', c.titre' in d) = 0 then
    if position('''artist_id'', p_artist, ''nom'', c.nom,' in d) = 0 then raise exception 'combat_identite : motif introuvable'; end if;
    d := replace(d, '''artist_id'', p_artist, ''nom'', c.nom,', '''artist_id'', p_artist, ''nom'', c.nom, ''titre'', c.titre,');
    execute d;
  end if;
  d := pg_get_functiondef('public.combat_unite(uuid,integer,boolean,integer,text,uuid)'::regprocedure);
  if position('''titre'', i ->> ''titre''' in d) = 0 then
    if position('''nom'', i ->> ''nom'',' in d) = 0 then raise exception 'combat_unite : motif introuvable'; end if;
    d := replace(d, '''nom'', i ->> ''nom'',', '''nom'', i ->> ''nom'', ''titre'', i ->> ''titre'',');
    execute d;
  end if;
end $$;
