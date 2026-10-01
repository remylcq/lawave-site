-- =====================================================================
-- La Wave — relier les artistes à leur page Deezer
--
-- Premier des trois fichiers de l'import quotidien des sorties :
--
--   1. sql/deezer-artistes.sql      — celui-ci : qui suivre sur Deezer
--   2. sql/deezer-import.sql        — la fonction qui importe
--   3. sql/deezer-planification.sql — la lance toute seule, chaque jour
--
-- Deezer ne publie pas de flux « toutes les nouveautés » : on ne peut
-- que lui demander, artiste par artiste, ce qu'il a sorti. Ce fichier
-- pose donc la liste des artistes à suivre — leur identifiant Deezer —
-- et les colonnes qui servent à ne rien importer deux fois.
--
-- Les 432 identifiants ci-dessous ont été relevés sur Deezer et
-- contrôlés : même nom, mais aussi même genre (le rap), un catalogue
-- cohérent, un pays d'enregistrement vraisemblable et, pour les
-- artistes dont La Wave connaît déjà des sorties, ces sorties
-- retrouvées sur la page Deezer. Le but : ne pas suivre un homonyme.
--
-- 35 artistes sur 467 n'y figurent pas : un nom partagé avec
-- d'autres artistes, introuvable, ou un doute. Mieux vaut les relier
-- plus tard, à la main, que de publier chez eux les sorties de
-- quelqu'un d'autre :
--
--   Ademo, Ali, Ambrose, Angie, Belabeu, Berry, Bushi, Deemax, Django,
--   Edou, Etane, Franglish & KeBlack, Gandhi, Gen, Haroun, Harrÿ,
--   IKBINKS, Inconnu, Jasem, Karmen, Kasei, Kikesa, Labri, LYNN, Myra,
--   N.O.S, Nans, rob, Serane, Sianna, ToothPick, Uzi, Vaï, YOVO,
--   YUNG POOR ALO
--
-- Pour suivre un artiste de plus, une fois ce fichier passé :
--
--   update public.artists
--      set deezer_artist_id = 1234567   -- le numéro qui termine l'adresse
--    where instagram_handle = 'son_pseudo';   -- de sa page deezer.com/…/artist/
--
-- À exécuter dans Supabase → SQL Editor, d'un seul bloc. Relançable :
-- tout est écrit pour ne rien écraser.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Les colonnes
--
--   artists.deezer_artist_id    l'artiste sur Deezer ; vide = pas suivi
--   artists.deezer_verifie_le   la dernière fois qu'on a regardé ce
--                               qu'il avait sorti
--   submissions.deezer_album_id l'album sur Deezer, pour qu'une même
--                               sortie ne soit jamais importée deux fois
-- ---------------------------------------------------------------------

alter table public.artists
  add column if not exists deezer_artist_id  bigint,
  add column if not exists deezer_verifie_le timestamptz;

alter table public.submissions
  add column if not exists deezer_album_id bigint;

-- Une sortie Deezer = une ligne, au plus.
create unique index if not exists submissions_deezer_album_uidx
  on public.submissions (deezer_album_id)
  where deezer_album_id is not null;

-- Trouver vite les artistes à revérifier, les plus anciens d'abord.
create index if not exists artists_deezer_a_verifier_idx
  on public.artists (deezer_verifie_le nulls first)
  where deezer_artist_id is not null;


-- ---------------------------------------------------------------------
-- 2. Qui peut changer qui l'on suit
--
-- Une règle d'artists laisse l'artiste vérifié modifier sa propre page
-- (sql/clip-et-artiste-verifie.sql). Sans garde-fou, il pourrait y
-- écrire n'importe quel identifiant Deezer et voir arriver, sous son
-- nom, les sorties d'un autre. Ces deux colonnes ne bougent donc plus
-- que par l'équipe — et par la base elle-même, sans utilisateur
-- connecté : l'import, et ce fichier.
-- ---------------------------------------------------------------------

create or replace function public.artists_gel_deezer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin

  if auth.uid() is null or public.est_equipe() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.deezer_artist_id is not null or new.deezer_verifie_le is not null then
      raise exception 'Ces colonnes sont réservées à l''équipe.';
    end if;
    return new;
  end if;

  if new.deezer_artist_id  is distinct from old.deezer_artist_id
     or new.deezer_verifie_le is distinct from old.deezer_verifie_le then
    raise exception 'Ces colonnes sont réservées à l''équipe.';
  end if;

  return new;
end $$;

drop trigger if exists artists_gel_deezer on public.artists;

create trigger artists_gel_deezer
before insert or update on public.artists
for each row
execute function public.artists_gel_deezer();


-- ---------------------------------------------------------------------
-- 3. Les artistes à suivre
--
-- Le pseudo est la clé : celui de la table artists. Un artiste déjà
-- relié n'est pas touché (« deezer_artist_id is null »), pour qu'un
-- identifiant corrigé à la main ne soit jamais écrasé en relançant le
-- fichier.
-- ---------------------------------------------------------------------

update public.artists a
   set deezer_artist_id = v.deezer_id
  from (values
    ('100blaze', 14103363),
    ('113', 252),
    ('13block', 7703718),
    ('1995', 1395256),
    ('1d1r', 93784812),
    ('1plike140', 85082932),
    ('20syl', 4433429),
    ('2l', 190007357),
    ('2metres', 193500817),
    ('2zerwashington', 4856051),
    ('3010', 3968381),
    ('3emeoeil', 2251),
    ('404billy', 11919965),
    ('47ter', 11933635),
    ('4keus', 13918541),
    ('63og', 131305362),
    ('7rusk', 197825917),
    ('88kvly', 135071612),
    ('8ruki', 14954881),
    ('abdalmalik', 5716),
    ('aboudebeing', 6329070),
    ('advm', 5463376),
    ('aketo', 58698),
    ('akhenaton', 49),
    ('akissi', 146935412),
    ('akro', 134205),
    ('alibimontana', 14843),
    ('alien', 200602867),
    ('alkpote', 72566),
    ('alonzo', 259729),
    ('alpha5.20', 58632),
    ('alphawann', 4428187),
    ('alybass', 51502772),
    ('amlascampia', 14633713),
    ('annie.adaa', 110089432),
    ('antonserra', 1666208),
    ('arma.jackson', 7029261),
    ('arone', 81384112),
    ('arsenik', 14497),
    ('ashe22', 60864502),
    ('asinine', 161650092),
    ('assassin', 2521),
    ('ateyaba', 15138227),
    ('attachingboy', 248919722),
    ('aupinard', 152058642),
    ('ayanakamura', 8909272),
    ('ayath', 195907117),
    ('b.b.jacques', 107059632),
    ('babysolo33', 57754602),
    ('baloji', 211454),
    ('banklaady', 102673772),
    ('beendoz', 109312472),
    ('begnetojack', 53335322),
    ('beka', 330011261),
    ('bekarnfr', 4626477),
    ('benash', 340513),
    ('benplg', 67211132),
    ('bigfloandoli', 5497121),
    ('bissonabisso', 7317),
    ('bkrbabyboy', 157046172),
    ('blackkent', 187525),
    ('blackm', 4494623),
    ('bobmarlich', 54939832),
    ('bolemvn', 13554009),
    ('bonniebanane', 4228313),
    ('bosh', 121584),
    ('bouss', 337973),
    ('boyoetc', 369119112),
    ('bramsito', 10930872),
    ('brulux', 7846452),
    ('brvmsoo', 13790241),
    ('bustaflex', 12842),
    ('caballero', 315030),
    ('calbo', 13715),
    ('canardo', 89643),
    ('carbonne', 98775702),
    ('casey', 210355),
    ('casseursflowters', 4944278),
    ('chaax', 73789052),
    ('cheub', 10264540),
    ('chilla', 4121259),
    ('cinco', 1322415),
    ('coelho', 331861),
    ('columbine', 7042927),
    ('coyotejobastard', 11548143),
    ('creamyg', 118415032),
    ('cyclopelheritier', 138889412),
    ('da_uzi', 11884111),
    ('dabs', 275677),
    ('daddylordc', 86023),
    ('dadi', 1265863),
    ('dadju', 4803754),
    ('dafliky', 101827542),
    ('damso', 9197980),
    ('danydan', 89063),
    ('danyl', 75818912),
    ('dara', 65223022),
    ('davodka', 5438206),
    ('decimo', 4406373),
    ('deelees', 146378152),
    ('deenasty', 85566),
    ('deenburbigo', 2331311),
    ('demiportion', 89172),
    ('demonone', 91244),
    ('desouza', 5927159),
    ('desporutti', 209318),
    ('diams', 388),
    ('dibby', 15282221),
    ('didditrix', 54856202),
    ('didib', 6412878),
    ('dinorrdt', 6994827),
    ('dinos', 292949),
    ('disiz', 292),
    ('djadjaanddinaz', 9930130),
    ('docgyneco', 974),
    ('donchoa', 60),
    ('doria', 1155427),
    ('dosseh', 158083),
    ('doums', 5877213),
    ('douzedeluge', 198304697),
    ('dr.beriz', 4775446),
    ('driver', 405519582),
    ('dry', 260223),
    ('dtf', 9884966),
    ('edge', 95149082),
    ('efgee', 5234011),
    ('ekloz', 52128412),
    ('elams', 7637436),
    ('elhkmer', 9261216),
    ('elyslime', 147958552),
    ('fababy', 1435566),
    ('fabe', 13674),
    ('faflarage', 10725),
    ('fave', 168275777),
    ('flynt', 90901),
    ('fonkyfamily', 2518),
    ('franglish', 10695573),
    ('freezecorleone', 13755123),
    ('frelonz', 67132162),
    ('frenetik', 2272071),
    ('furlax', 8924446),
    ('gambi', 65303292),
    ('gambino', 1971601),
    ('gambinolamg', 123033132),
    ('garuze', 52053332),
    ('gazo', 8873540),
    ('geneziooo', 51968652),
    ('georgio', 183727),
    ('gianni', 130528),
    ('gims', 4429712),
    ('girlsloveromsii', 118643972),
    ('glizbornn', 155528342),
    ('goune', 6720371),
    ('gradurofficiel243', 5876247),
    ('grandcorpsmalade', 2691),
    ('greenmontana', 15337813),
    ('gringe', 172008),
    ('guizmo', 162815),
    ('gulien', 57146052),
    ('guy2bezbar', 11026886),
    ('hamza', 171998),
    ('hatik', 12422192),
    ('haycelemsi', 2845031),
    ('heloim', 101490272),
    ('heusslenfoire', 13645509),
    ('hjeunecrack', 104543062),
    ('hmagnum', 259569),
    ('hocuspocus', 14950),
    ('hornetlafrappe', 6545727),
    ('houari', 363229),
    ('houdi', 48443532),
    ('hugotsr', 4542822),
    ('huntrill', 13797255),
    ('iam', 48),
    ('ichon', 5157545),
    ('ico', 483582),
    ('idealj', 6245),
    ('implaccable', 75749522),
    ('infinit', 5531672),
    ('inocasablanca', 181895087),
    ('ironsy', 16735),
    ('isha', 1236609),
    ('isk', 63519802),
    ('iss', 4365815),
    ('j9ueve', 93114652),
    ('jarod', 146830),
    ('jaymee', 1705266),
    ('jazzybazz', 4409884),
    ('jeanjass', 5838830),
    ('jeunelc', 13614973),
    ('jeunesaint', 89133382),
    ('jeybrownie', 64194042),
    ('jnrslice', 93035862),
    ('joedwetfile', 9281246),
    ('joeystarr', 70040),
    ('jokair', 4907510),
    ('jolagreen23', 132179322),
    ('jonnyvegas', 83141462),
    ('josman', 7365500),
    ('jrocrom', 4683064),
    ('jsx', 4868580),
    ('jul', 1191615),
    ('jwles', 13715731),
    ('jyeuhair', 62534662),
    ('kaaris', 388973),
    ('kacemwapalek', 5232536),
    ('kahila', 102876612),
    ('kalash', 73018),
    ('kalashcriminel', 10452069),
    ('kalashlafro', 68436),
    ('kamelancien', 13382),
    ('kamini', 10756),
    ('kanoe', 436733),
    ('kaza', 59620692),
    ('kekra', 8352118),
    ('kenyarkana', 12168),
    ('kenzafarah', 14262),
    ('kerchak', 162070292),
    ('kerosn', 4334621),
    ('keryjames', 5025),
    ('khali', 84312522),
    ('kidexotic', 77782592),
    ('klubdesloosers', 2186),
    ('kobalad', 14621667),
    ('kodes', 5241984),
    ('kofs', 5593078),
    ('koolshen', 362),
    ('krisy', 7217724),
    ('l2b', 13790723),
    ('lachine', 64754892),
    ('lacrim', 4087782),
    ('ladea', 488873),
    ('laeti', 147853382),
    ('lafeve7', 102204242),
    ('lafouine', 12778),
    ('lakadrilla', 49349822),
    ('lalgerino', 13501),
    ('lallemand', 12920049),
    ('lamano1.9', 184573357),
    ('landy', 14447309),
    ('larry', 455775),
    ('lartiste', 1670355),
    ('larumeur', 13395),
    ('larvfleuze', 174484227),
    ('laskiiz', 7641046),
    ('laylow', 4510044),
    ('leck', 95560),
    ('lecrime', 80268952),
    ('led_officieel', 1267790),
    ('lefa', 1473902),
    ('lejuiice', 54543682),
    ('lemondedaho', 259564992),
    ('lentourage', 5611094),
    ('leosvr', 129399072),
    ('leratluciano', 13672),
    ('lesram', 11949001),
    ('lessagespoetesdelarue', 13459),
    ('leto', 455796),
    ('liims', 55877602),
    ('limsadaulnay', 14659541),
    ('lino', 6568),
    ('linton', 4804840),
    ('lokyto', 49742632),
    ('lonepsi', 12412044),
    ('lordesperanza', 11193368),
    ('lorenzo', 123503),
    ('lossa', 4961934),
    ('lovarran', 131292122),
    ('luciobukowski', 4085316),
    ('luidji', 5617685),
    ('lujipeka', 7172552),
    ('lumjr', 139401002),
    ('lunatic', 3574),
    ('lutherantz', 161626742),
    ('luvresval', 53325902),
    ('luzon', 222064905),
    ('lybro', 99463432),
    ('mactyer', 156726),
    ('maes', 4448630),
    ('mafiak1fry', 12986),
    ('mairo', 6933055),
    ('makala', 536194),
    ('marwaloud', 9134960),
    ('maska', 4438831),
    ('mcsolaar', 63),
    ('medine', 14289),
    ('menacesantana', 123555852),
    ('meryl', 6351846),
    ('mhd', 881751),
    ('ministerea.m.e.r', 1003),
    ('misterv', 3638541),
    ('misteryou', 256681),
    ('mmz', 1002485),
    ('mohalasquale', 13816509),
    ('mokobe', 14493),
    ('nahir', 7602544),
    ('nakkmendosa', 205298),
    ('naps', 4842061),
    ('navyblu', 285512381),
    ('naza', 7459270),
    ('ndorunway', 199148267),
    ('negmarrons', 3649),
    ('nemir', 898748),
    ('nepal', 308440),
    ('nes', 69178362),
    ('nessbeal', 74095),
    ('niaks', 52937632),
    ('ninho', 5542343),
    ('niro', 58624),
    ('niska', 5288900),
    ('nobodylikesbirdie', 173804587),
    ('nonolagrinta', 194146027),
    ('oboy', 4986771),
    ('ogb', 97490),
    ('oldpee', 14785505),
    ('olkainry', 89626),
    ('orelsan', 259467),
    ('oso', 185200887),
    ('oxmopuccino', 7983),
    ('panamabende', 10146352),
    ('papiteddybear', 201695897),
    ('passi', 4975),
    ('peet', 1252133),
    ('pitbaccardi', 5224),
    ('plk', 1479842),
    ('pnl', 1519461),
    ('princewaly', 6745115),
    ('psy4delarime', 753),
    ('quincy', 6821499),
    ('r.e.d.k', 4601925),
    ('r2', 249270492),
    ('ratu', 59563612),
    ('realo', 14415029),
    ('remy', 12530904),
    ('retrox', 6754503),
    ('riles', 4521369),
    ('rimk', 256080),
    ('rockinsquat', 17160),
    ('rohff', 750),
    ('roshi', 50860262),
    ('rsko', 9976422),
    ('rufyo', 64656392),
    ('s.prinoir', 1412711),
    ('saaro', 282554801),
    ('sadek', 1270444),
    ('salif', 13666),
    ('samirflynn', 85233112),
    ('satlartificier', 347054),
    ('savagetoddy', 85211872),
    ('sch', 162665),
    ('scredconnexion', 90896),
    ('screw', 4856048),
    ('scylla', 104154),
    ('sdm', 604107),
    ('sean', 59474172),
    ('sefyu', 12984),
    ('sethgueko', 13499),
    ('sexiondassaut', 75001),
    ('shay', 314777),
    ('sheng', 1242216),
    ('sherifflazone', 214037557),
    ('shone', 68959),
    ('shorty7g', 147189302),
    ('shurikn', 1798),
    ('siaka', 6186930),
    ('siboy', 6311908),
    ('sicario', 138709052),
    ('sifax', 52049272),
    ('sinik', 751),
    ('skefre', 192642057),
    ('slimka', 12121824),
    ('sneazzy', 4428188),
    ('sniper', 460),
    ('so', 136179112),
    ('sofiane', 89657),
    ('solalune', 68553672),
    ('sonnyrave', 74448602),
    ('soolking', 10189104),
    ('soprano', 13011),
    ('sosomaness', 5594859),
    ('souffrance', 6554601),
    ('squeezie', 12748343),
    ('stavo', 12175486),
    ('stillfresh', 1211085),
    ('stomybugsy', 10867),
    ('suleebwax', 4601148),
    ('sultan', 89536),
    ('suprementm', 752),
    ('swaggman', 5616438),
    ('swiftguad', 1582990),
    ('taemintekken', 14175967),
    ('taipan', 94689),
    ('takeamic', 5075613),
    ('tandem', 389),
    ('tedaxmax', 83162262),
    ('tekilatex', 12933),
    ('th', 219251975),
    ('thabiti', 1164298),
    ('thatsluni', 1327678),
    ('theodora', 13820325),
    ('tiakola', 13918545),
    ('tiersmonde', 1204459),
    ('timar', 6354270),
    ('tk', 261065),
    ('toera', 199285817),
    ('triangledesbermudes', 222898665),
    ('tsewthekid', 14802869),
    ('tuerie', 87813262),
    ('tunisiano', 64085),
    ('vald', 5175734),
    ('vegedream', 9134324),
    ('ven1', 243505001),
    ('voltsface', 4548941),
    ('w0lfy', 170610777),
    ('wallacecleaver', 52375982),
    ('werenoi', 121672292),
    ('winnterzuko', 88895962),
    ('wojtek', 1528016),
    ('yalifay', 80961622),
    ('yame', 107030802),
    ('yl', 12490752),
    ('youri', 13516733),
    ('youssoupha', 13020),
    ('yvnnis', 72411282),
    ('zamdane', 13152245),
    ('zed', 2957),
    ('zefor', 14785507),
    ('ziak', 7668530),
    ('zkr', 14240131),
    ('zola', 13962203),
    ('zoomy', 87611072),
    ('zz', 302248731)
  ) as v(handle, deezer_id)
 where a.instagram_handle = v.handle
   and a.deezer_artist_id is null;


-- ---------------------------------------------------------------------
-- Vérification
--
-- La colonne « suivis » doit afficher 432 (ou plus, si tu en as ajouté).
-- Les artistes sans identifiant ne sont tout simplement pas suivis.
-- ---------------------------------------------------------------------

select count(*) filter (where deezer_artist_id is not null) as suivis,
       count(*) filter (where deezer_artist_id is null)     as non_suivis,
       count(*)                                             as total
from public.artists;
