/* =====================================================================
   La Wave — Wave Cards : le combat 2v2 à jauge de tour

   Chargé à la demande par cartes.js (onglet « Combat », chargerWaveModule('combat') dans index.html).
   Le moteur vit dans la base (sql/combat-v2-*.sql) : jauges de tour, rôles, techniques, statuts, passifs, adversaires, trophées.
   Ce fichier demande, affiche et anime : tout calcul et tout hasard restent côté serveur.

   LE COMBAT EN BREF
     2 cartes contre 2 cartes. Chaque carte remplit une jauge selon sa Vitesse et joue quand elle est pleine. Elle a un RÔLE
     (Lyriciste, Pilier, Beatmaker, Hype man, Clasheur, Briseur), 3 TECHNIQUES (la 1re toujours prête, les 2 autres avec un temps
     de recharge) et, en Légendaire / Mythique, un PASSIF. Styles : ▲ super efficace (×1,5), ▼ peu efficace (×0,67).
     Statuts avec durée : Puissance / Défense / Vitesse ±, étourdi, gel, brûlure, poison, régénération, marque, provocation, bouclier.

   L'API PUBLIQUE (window.WaveCombat)
     monter(hote, api)             l'onglet : mon rang, le HUB EN TUILES des modes, le classement, l'historique
     quitter()                     ferme l'écran de combat (le combat reste en cours côté serveur)
     fiche(el, api, opts)          la fiche de combat d'une carte (collection)
     equipe(hote, api)             la console de l'équipe (réglages : cartes, styles, techniques, passifs, Arène, test)
     equipeCarte(hote, api, id)    l'éditeur compact des réglages d'UNE carte

   POUR AJOUTER UN MODE DE COMBAT (autres modules)
     1. SQL (voir l'en-tête de sql/combat-v2-jeu.sql) : une ligne dans combat_modes, une fonction de mode qui appelle combat_creer(...)
        avec l'équipe adverse, et — si le mode verse des gains — une fonction combat_fin_<mode>(partie, victoire, abandon) → jsonb.
     2. JS : charger le module (await chargerWaveModule('combat')), puis enregistrer le mode dans le hub :

          WaveCombat.modes.enregistrer({
            id: 'mon_mode',                         // [a-z][a-z0-9_-]{1,29}, le même que dans combat_modes
            titre: 'Mon mode',
            groupe: 'jeu' | 'dresseurs' | 'farm',   // « Contre le jeu » / « Contre les dresseurs » / « Entraînement »
            icone: 'combat',                        // une icône de A.ico (combat, trophee, cible, eclair…)
            resume: async (acc) => 'où j\'en suis',  // UNE ligne affichée sur la tuile (acc = combat_accueil)
            ouvrir(hote, api) { … }                 // dessine la page du mode dans hote ; api = l'API du jeu (appel, toast, fenetre,
          });                                       //   esc, nf, safeUrl, ico…) + lancerCombat, equipeModal, rafraichir, acc(), retour()

     3. Lancer un combat depuis ouvrir() :

          api.lancerCombat({
            rpc: 'ma_fonction_sql',        // fonction SQL du mode : (…params, p_duo jsonb, p_options jsonb) → combat_partie_json
            params: { p_niveau: 3 },       // ses paramètres propres
            titre: 'Mon combat', decor: 'ruelle',   // décors : studio, concert, plateau, ruelle, toit (le décor est fixé côté SQL)
            adversaires: [{ nom, photo, type, type_nom, couleur, role_nom }],  // facultatif : aperçu « face à » + indicateur ▲ ▼
            options: { auto: false },      // facultatif
            // mode: 'arene' | 'defi' | 'pvp' | 'entrainement' + cible : les modes intégrés passent par combat_lancer
            // partie: <objet renvoyé par le SQL> : ouvre directement un combat déjà créé, sans choix d'équipe
            // choix: { duo, auto, cible } : saute la fenêtre d'équipe (Rejouer)
          });

        lancerCombat ouvre la fenêtre d'équipe (equipeModal), crée le combat côté serveur, ouvre l'écran animé, affiche le
        bilan (dégâts / soins / K.O., MVP, gains) et propose Rejouer.

     WaveCombat.equipeModal({ titre, taille: 2, adversaires, duo, auto, confirmer, sansOptions })
        → Promise<{ duo: [{booster, artist, holo}], infos, auto, cible } | null>
        La composition d'équipe seule (2 cartes, ordre par glisser-déposer ou flèches, 5 équipes enregistrées, équipe auto,
        indicateur « super efficace » face à `adversaires`, Auto / Manuel, cible présélectionnée).

     WaveCombat.modes.liste()   les modes enregistrés.
     Le bilan d'un combat peut afficher des lignes toutes prêtes : combat_fin_<mode> renvoie { lignes: ['+18 points', …] } (ex. Arène classée).

     UN MODULE À PART (ex. combat-pve.js : La Tour, Les champions, La Ligue)
       Déclarer le fichier dans WAVE_MODULES (index.html) sous un nom « combat-… » : combat.js le charge avec l'onglet (et avec la console
       de l'équipe), AVANT le premier dessin du hub. Le module appelle alors lui-même WaveCombat.modes.enregistrer({…}) et, pour un réglage
       dans la console de l'équipe, WaveCombat.equipeVues.enregistrer({ id, nom, ouvrir(corps, api) }).
   ===================================================================== */

(function(){

  'use strict';

  let A = null;   // l'interface partagée du jeu (window.Cartes.api)
  const S = { hote: null, vue: 'jouer', mode: null, acc: null, scene: null, cat: null, modes: [], init: false };

  const LIB = { pv: 'PV', pui: 'Puissance', def: 'Défense', vit: 'Vitesse' };
  const CIBLES = { ennemi: 'Un adversaire', ennemis: 'Les deux adversaires', allie: 'Un allié (soi compris)', allies: 'Tout le duo', soi: 'Soi-même' };
  const CODES = { regeneration: 'Régénération (% PV au début de chaque tour)', epines: 'Épines (% des dégâts renvoyés)', sang_froid: 'Sang-froid (insensible aux statuts néfastes)', ouverture: 'Ouverture (% de dégâts en plus au 1er coup)',
    dernier_souffle: 'Dernier souffle (% des PV max en dégâts)', survivant: 'Survivant (1 PV une fois)', aura: 'Aura (% de Puissance pour le duo)', concentration: 'Concentration (ne rate jamais)',
    rythme: 'Bon rythme (% de jauge au départ)', bouclier: 'Armure de scène (bouclier de départ, % des PV)', rage: 'Rage (Puissance en plus sous la moitié des PV)' };
  const EFFETS_AIDE = 'k : soin, bouclier, vampirisme, recul, pui+, pui-, def+, def-, vit+, vit-, etourdi, gel, brulure, poison, regen, marque, provoc, purif, jauge+, jauge- · v : % · d : tours · chance : % · sur : soi, allies, ennemis (sinon la cible)';
  const STAT = {
    'pui+': { c: 'PUI▲', n: 'Puissance en hausse', t: 'haut' }, 'pui-': { c: 'PUI▼', n: 'Puissance en baisse', t: 'bas' },
    'def+': { c: 'DÉF▲', n: 'Défense en hausse', t: 'haut' }, 'def-': { c: 'DÉF▼', n: 'Défense en baisse', t: 'bas' },
    'vit+': { c: 'VIT▲', n: 'Vitesse en hausse', t: 'haut' }, 'vit-': { c: 'VIT▼', n: 'Vitesse en baisse', t: 'bas' },
    etourdi: { c: 'ÉTOURDI', n: 'Étourdi : saute son prochain tour', t: 'bas' }, gel: { c: 'GELÉ', n: 'Gelé : saute son prochain tour et subit plus de dégâts', t: 'bas' },
    brulure: { c: 'BRÛLÉ', n: 'Brûlure : perd des PV chaque tour et frappe moins fort', t: 'bas' }, poison: { c: 'POISON', n: 'Poison : perd des PV chaque tour', t: 'bas' },
    marque: { c: 'MARQUÉ', n: 'Marqué : subit plus de dégâts', t: 'bas' }, regen: { c: 'RÉGÉN', n: 'Récupère des PV chaque tour', t: 'haut' },
    provoc: { c: 'PROVOC', n: 'Provocation : les adversaires doivent le viser', t: 'neutre' }, bouclier: { c: 'BOUCLIER', n: 'Bouclier : absorbe des dégâts', t: 'haut' }
  };

  const CSS = `
  .cb{display:grid; gap:18px;}
  .cb *{box-sizing:border-box;}
  .cb-type{display:inline-flex; align-items:center; height:20px; padding:0 8px; border-radius:99px; font-size:11px; font-weight:800; letter-spacing:.04em; text-transform:uppercase; white-space:nowrap; color:#06090e; background:var(--tc, #9aa4b2);}
  .cb-type.neutre{color:var(--ink-soft); background:rgba(255,255,255,.12);}
  .cb-seg{display:flex; gap:4px; padding:4px; border-radius:14px; border:1px solid var(--ct-trait); background:rgba(255,255,255,.025); overflow-x:auto; scrollbar-width:none;}
  .cb-seg::-webkit-scrollbar{display:none;}
  .cb-seg button{all:unset; box-sizing:border-box; cursor:pointer; flex:1 0 auto; height:38px; padding:0 16px; border-radius:10px; font-size:14px; font-weight:600; color:var(--muted); display:inline-flex; align-items:center; justify-content:center; white-space:nowrap;}
  .cb-seg button:hover{color:var(--ink);}
  .cb-seg button[aria-pressed="true"]{color:#05070a; background:#F4F5F6;}
  .cb-seg button:focus-visible{outline:2px solid var(--ct-accent); outline-offset:2px;}
  /* La console de l'équipe a une dizaine de vues : elles passent à la ligne au lieu de se cacher hors de l'écran. */
  .cb-seg.wrap{flex-wrap:wrap; overflow-x:visible;}
  .cb-seg.wrap button{flex:1 1 auto;}

  .cb-rang{display:grid; grid-template-columns:auto 1fr; gap:18px; align-items:center;}
  .cb-trophees{display:grid; place-items:center; min-width:112px; padding:14px 16px; border-radius:18px; background:linear-gradient(180deg, rgba(242,193,78,.18), rgba(242,193,78,.04)); border:1px solid rgba(242,193,78,.35);}
  .cb-trophees b{font-size:34px; line-height:1; font-weight:900; letter-spacing:-.03em; font-variant-numeric:tabular-nums;}
  .cb-trophees span{margin-top:6px; font-size:11px; font-weight:700; letter-spacing:.1em; text-transform:uppercase; color:#F2C14E; display:inline-flex; align-items:center; gap:5px;}
  .cb-rang-d h3{margin:0; font-size:18px; letter-spacing:-.01em;}
  .cb-rang-d p{margin:4px 0 0; font-size:13px; color:var(--muted); line-height:1.5;}
  .cb-chiffres{display:flex; flex-wrap:wrap; gap:8px; margin-top:12px;}
  .cb-chiffres span{padding:6px 10px; border-radius:10px; font-size:12.5px; color:var(--ink-soft); background:var(--ct-surface-2); font-variant-numeric:tabular-nums;}
  .cb-chiffres b{color:var(--ink);}

  .cb-banniere{display:flex; flex-wrap:wrap; align-items:center; gap:12px; padding:14px 16px; border-radius:16px; border:1px solid rgba(79,180,255,.4); background:rgba(79,180,255,.08);}
  .cb-banniere div{flex:1 1 220px; font-size:14px; line-height:1.45;}
  .cb-banniere b{display:block;}

  .cb-duo{display:grid; grid-template-columns:repeat(2, minmax(0, 150px)); gap:14px; justify-content:start;}
  .cb-slot{display:grid; gap:8px; align-content:start;}
  .cb-slot .vide{display:grid; place-items:center; aspect-ratio:5 / 7; border-radius:14px; border:2px dashed var(--ct-trait-fort); color:var(--muted); font-size:13px; text-align:center; padding:10px;}
  .cb-slot-i{font-size:12px; color:var(--ink-soft); line-height:1.5;}
  .cb-slot-i b{display:block; font-size:14px; color:var(--ink);}
  .cb-mini-stats{display:flex; flex-wrap:wrap; gap:3px 8px; font-size:11.5px; color:var(--ink-soft); font-variant-numeric:tabular-nums;}
  .cb-mini-stats b{color:var(--ink);}
  .cb-bloc-duo{display:flex; flex-wrap:wrap; gap:18px 26px; align-items:flex-start;}
  .cb-bloc-duo .cb-actions{display:grid; gap:10px; align-content:start; flex:1 1 220px; min-width:200px;}
  .cb-bloc-duo p{margin:0; font-size:13px; color:var(--muted); line-height:1.5;}

  .cb-modes{display:grid; grid-template-columns:repeat(auto-fit, minmax(230px, 1fr)); gap:12px;}
  .cb-mode{all:unset; box-sizing:border-box; cursor:pointer; display:grid; gap:8px; align-content:start; padding:16px; border-radius:18px; border:1px solid var(--ct-trait); background:linear-gradient(180deg, rgba(255,255,255,.05), rgba(255,255,255,.02)); transition:transform .2s, border-color .2s;}
  .cb-mode:hover{transform:translateY(-3px); border-color:color-mix(in srgb, var(--tc, #4FB4FF) 70%, transparent);}
  .cb-mode:focus-visible{outline:2px solid var(--ct-accent); outline-offset:2px;}
  .cb-mode[disabled]{opacity:.45; cursor:default; transform:none;}
  .cb-mode h4{margin:0; display:flex; align-items:center; gap:8px; font-size:16px;}
  .cb-mode p{margin:0; font-size:13px; line-height:1.5; color:var(--muted);}
  .cb-mode .pied{display:flex; flex-wrap:wrap; gap:6px; margin-top:2px;}
  .cb-puce{display:inline-flex; align-items:center; gap:5px; height:24px; padding:0 9px; border-radius:99px; font-size:12px; font-weight:700; color:var(--ink-soft); background:var(--ct-surface-2);}
  .cb-puce.ok{color:#5BE0A6; background:rgba(91,224,166,.12);}
  .cb-puce.or{color:#F2C14E; background:rgba(242,193,78,.12);}

  .cb-liste{display:grid; gap:8px;}
  .cb-ligne{display:grid; grid-template-columns:auto 1fr auto; gap:14px; align-items:center; padding:12px 14px; border-radius:16px; border:1px solid var(--ct-trait); background:var(--ct-surface);}
  .cb-ligne.moi{border-color:rgba(79,180,255,.5); background:rgba(79,180,255,.07);}
  .cb-ligne.verrou{opacity:.5;}
  .cb-n{min-width:30px; text-align:center; font-size:15px; font-weight:800; font-variant-numeric:tabular-nums; color:var(--ink-soft);}
  .cb-ligne h4{margin:0; font-size:15px;}
  .cb-ligne p{margin:3px 0 0; font-size:12.5px; line-height:1.45; color:var(--muted);}
  .cb-portraits{display:flex;}
  .cb-portraits img, .cb-avatar{width:40px; height:40px; border-radius:50%; object-fit:cover; object-position:50% 22%; border:2px solid var(--tc, #2a3340); background:#0a1018; display:block;}
  .cb-portraits img + img{margin-left:-12px;}
  .cb-avatar{border-color:var(--ct-trait-fort);}
  .cb-res{padding:3px 9px; border-radius:99px; font-size:11.5px; font-weight:800; text-transform:uppercase; letter-spacing:.05em;}
  .cb-res.victoire{color:#5BE0A6; background:rgba(91,224,166,.14);}
  .cb-res.defaite{color:#FF7A85; background:rgba(255,122,133,.14);}
  .cb-res.abandon, .cb-res.expire{color:var(--muted); background:var(--ct-surface-2);}
  .cb-delta{font-weight:800; font-variant-numeric:tabular-nums;}
  .cb-delta.p{color:#5BE0A6;} .cb-delta.m{color:#FF7A85;}

  /* ---------- le sélecteur de duo ---------- */
  .cb-sel-tete{display:flex; flex-wrap:wrap; gap:10px; margin:14px 0 12px;}
  .cb-sel-tete input[type=search], .cb-sel-tete select, .cb-champ-eq{height:40px; padding:0 12px; border-radius:12px; border:1px solid var(--ct-trait); background:var(--ct-surface); color:var(--ink); font:inherit; font-size:14px;}
  .cb-sel-tete input[type=search]{flex:1 1 180px; min-width:0;}
  .cb-filtres{display:flex; flex-wrap:wrap; gap:6px; margin-bottom:14px;}
  .cb-filtres button{all:unset; cursor:pointer; box-sizing:border-box; height:28px; padding:0 11px; border-radius:99px; font-size:12px; font-weight:700; color:var(--ink-soft); border:1px solid var(--ct-trait); display:inline-flex; align-items:center;}
  .cb-filtres button[aria-pressed="true"]{color:#06090e; background:var(--tc, #F4F5F6); border-color:transparent;}
  .cb-grille{display:grid; grid-template-columns:repeat(auto-fill, minmax(128px, 1fr)); gap:14px 12px; max-height:min(52vh, 520px); overflow-y:auto; padding:6px 4px 10px; scrollbar-width:thin;}
  .cb-tuile{all:unset; box-sizing:border-box; cursor:pointer; display:grid; gap:6px; align-content:start; position:relative; border-radius:14px; padding:6px; border:2px solid transparent; transition:border-color .15s, transform .15s;}
  .cb-tuile:hover{transform:translateY(-2px);}
  .cb-tuile:focus-visible{outline:2px solid var(--ct-accent); outline-offset:1px;}
  .cb-tuile[aria-pressed="true"]{border-color:var(--ct-accent); background:rgba(79,180,255,.1);}
  .cb-tuile .num{position:absolute; z-index:4; top:2px; left:2px; width:24px; height:24px; border-radius:50%; display:none; place-items:center; font-size:13px; font-weight:900; color:#05070a; background:var(--ct-accent);}
  .cb-tuile[aria-pressed="true"] .num{display:grid;}
  .cb-tuile .info{position:absolute; z-index:4; top:2px; right:2px; width:26px; height:26px; border-radius:50%; display:grid; place-items:center; font-size:13px; font-weight:800; font-style:italic; font-family:Georgia, serif; color:#fff; background:rgba(5,7,10,.7); border:1px solid rgba(255,255,255,.25);}
  .cb-tuile .t{display:flex; flex-wrap:wrap; gap:4px 6px; align-items:center; font-size:11.5px; color:var(--ink-soft); font-variant-numeric:tabular-nums;}
  .cb-sel-pied{display:flex; flex-wrap:wrap; align-items:center; gap:14px; margin-top:14px; padding-top:14px; border-top:1px solid var(--ct-trait);}
  .cb-sel-choix{display:flex; flex-wrap:wrap; gap:10px; flex:1 1 260px; font-size:13px; color:var(--ink-soft);}
  .cb-sel-choix div{padding:8px 10px; border-radius:12px; background:var(--ct-surface-2); min-width:140px;}
  .cb-sel-choix b{display:block; font-size:14px; color:var(--ink);}

  /* ---------- la fiche de combat ---------- */
  .cb-fiche{display:grid; gap:12px; padding:14px; border-radius:16px; border:1px solid color-mix(in srgb, var(--tc, #4FB4FF) 55%, transparent); background:linear-gradient(160deg, color-mix(in srgb, var(--tc, #4FB4FF) 18%, #0b1018), #0a0e14 70%);}
  .cb-fiche-t{display:flex; align-items:center; justify-content:space-between; gap:10px;}
  .cb-fiche-t b{font-size:13px; letter-spacing:.1em; text-transform:uppercase; color:var(--ink-soft);}
  .cb-pvgros{font-size:22px; font-weight:900; font-variant-numeric:tabular-nums;}
  .cb-pvgros small{font-size:12px; font-weight:700; color:var(--muted); margin-right:3px;}
  .cb-stats{display:grid; gap:7px;}
  .cb-st{display:grid; grid-template-columns:74px 34px 1fr; gap:8px; align-items:center; font-size:12.5px; color:var(--ink-soft);}
  .cb-st b{color:var(--ink); font-variant-numeric:tabular-nums; text-align:right;}
  .cb-st i{display:block; height:6px; border-radius:99px; background:rgba(255,255,255,.08); position:relative; overflow:hidden;}
  .cb-st i::after{content:''; position:absolute; inset:0 auto 0 0; width:var(--w); border-radius:99px; background:var(--tc, #4FB4FF);}
  .cb-atts{display:grid; gap:8px;}
  .cb-att{padding:10px 12px; border-radius:12px; background:rgba(0,0,0,.25); border-left:3px solid var(--tc, #9aa4b2);}
  .cb-att-t{display:flex; align-items:center; justify-content:space-between; gap:8px;}
  .cb-att-t b{font-size:14px;}
  .cb-att-m{display:flex; flex-wrap:wrap; gap:3px 10px; margin-top:3px; font-size:11.5px; color:var(--muted);}
  .cb-att p{margin:5px 0 0; font-size:12.5px; line-height:1.45; color:var(--ink-soft);}
  .cb-cap{font-size:13px; line-height:1.5; color:var(--ink-soft);}
  .cb-cap b{color:var(--ink);}
  .cb-aff{display:flex; flex-wrap:wrap; align-items:center; gap:5px 8px; font-size:12px; color:var(--muted);}
  .cb-aff .cb-type{height:18px; font-size:10.5px;}
  .cb-cit{margin:0; padding-left:10px; border-left:2px solid var(--ct-trait-fort); font-size:12.5px; font-style:italic; color:var(--muted); line-height:1.5;}

  /* ---------- le hub des modes ---------- */
  .cb-groupe{display:grid; gap:10px;}
  .cb-groupe > h3{margin:0; font-size:12px; font-weight:800; letter-spacing:.12em; text-transform:uppercase; color:var(--muted);}
  .cb-tuiles{display:grid; grid-template-columns:repeat(auto-fill, minmax(230px, 1fr)); gap:12px;}
  .cb-tuile-mode{all:unset; box-sizing:border-box; cursor:pointer; display:grid; grid-template-columns:auto 1fr; gap:4px 14px; align-items:center; padding:16px; border-radius:18px; border:1px solid var(--ct-trait); background:linear-gradient(160deg, rgba(255,255,255,.06), rgba(255,255,255,.015)); transition:transform .2s, border-color .2s;}
  .cb-tuile-mode:hover{transform:translateY(-3px); border-color:var(--ct-accent);}
  .cb-tuile-mode:focus-visible{outline:2px solid var(--ct-accent); outline-offset:2px;}
  .cb-tuile-mode .ic{grid-row:1 / 3; display:grid; place-items:center; width:46px; height:46px; border-radius:14px; background:rgba(79,180,255,.14); color:var(--ct-accent);}
  .cb-tuile-mode h4{margin:0; font-size:16px;}
  .cb-tuile-mode p{margin:0; font-size:12.5px; line-height:1.4; color:var(--muted); min-height:17px;}
  .cb-retour{all:unset; cursor:pointer; box-sizing:border-box; display:inline-flex; align-items:center; gap:6px; height:34px; padding:0 14px 0 10px; border-radius:99px; font-size:13px; font-weight:700; color:var(--ink-soft); border:1px solid var(--ct-trait);}
  .cb-retour:hover{color:var(--ink); border-color:var(--ct-trait-fort);}
  .cb-retour:focus-visible{outline:2px solid var(--ct-accent);}
  .cb-roles{display:flex; flex-wrap:wrap; gap:6px; align-items:center;}
  .cb-role{display:inline-flex; align-items:center; height:20px; padding:0 8px; border-radius:6px; font-size:10.5px; font-weight:800; letter-spacing:.06em; text-transform:uppercase; color:#dfe6ee; background:rgba(255,255,255,.1); white-space:nowrap;}

  /* ---------- la composition d'équipe ---------- */
  .cb-eq-slots{display:grid; grid-template-columns:1fr 1fr; gap:10px; margin:12px 0;}
  .cb-eq-slot{position:relative; display:grid; grid-template-columns:auto 1fr; gap:4px 10px; align-items:center; padding:10px; border-radius:14px; border:2px dashed var(--ct-trait-fort); min-height:78px; background:rgba(255,255,255,.03); transition:border-color .15s, background .15s;}
  .cb-eq-slot.rempli{border-style:solid; border-color:color-mix(in srgb, var(--tc, #4FB4FF) 60%, transparent); background:linear-gradient(160deg, color-mix(in srgb, var(--tc, #4FB4FF) 14%, transparent), rgba(255,255,255,.02));}
  .cb-eq-slot.survol{border-color:var(--ct-accent); background:rgba(79,180,255,.12);}
  .cb-eq-slot img{width:50px; height:50px; border-radius:50%; object-fit:cover; object-position:50% 22%; border:2px solid var(--tc, #4FB4FF); background:#0a1018; display:block;}
  .cb-eq-slot .vide{grid-column:1 / -1; text-align:center; font-size:12.5px; color:var(--muted);}
  .cb-eq-slot b{display:block; font-size:13.5px; line-height:1.2;}
  .cb-eq-slot small{display:block; font-size:11px; color:var(--ink-soft); font-variant-numeric:tabular-nums;}
  .cb-eq-ordre{grid-column:1 / -1; display:flex; gap:6px; justify-content:flex-end;}
  .cb-eq-ordre button{all:unset; cursor:pointer; box-sizing:border-box; height:26px; min-width:30px; padding:0 8px; border-radius:8px; font-size:12px; font-weight:800; text-align:center; color:var(--ink-soft); border:1px solid var(--ct-trait-fort);}
  .cb-eq-ordre button:hover{color:var(--ink); background:rgba(255,255,255,.08);}
  .cb-eq-ordre button:focus-visible{outline:2px solid var(--ct-accent);}
  .cb-eq-poignee{position:absolute; top:6px; left:8px; font-size:10px; font-weight:800; color:var(--muted); letter-spacing:.1em;}
  .cb-eq-barre{display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin-bottom:10px;}
  .cb-eq-sauves{display:grid; grid-template-columns:repeat(5, minmax(0, 1fr)); gap:6px; margin-bottom:10px;}
  .cb-eq-sauve{all:unset; cursor:pointer; box-sizing:border-box; display:grid; gap:2px; padding:7px 6px; border-radius:11px; border:1px solid var(--ct-trait); text-align:center; font-size:11px; color:var(--ink-soft); min-width:0; background:var(--ct-surface);}
  .cb-eq-sauve b{display:block; font-size:12px; color:var(--ink); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
  .cb-eq-sauve.vide{opacity:.55; border-style:dashed;}
  .cb-eq-sauve.cassee{opacity:.5;}
  .cb-eq-sauve[aria-pressed="true"]{border-color:var(--ct-accent); background:rgba(79,180,255,.1);}
  .cb-eq-sauve:focus-visible{outline:2px solid var(--ct-accent);}
  .cb-eq-sauve i{display:flex; justify-content:center; gap:2px;}
  .cb-eq-sauve img{width:22px; height:22px; border-radius:50%; object-fit:cover; object-position:50% 22%; border:1px solid var(--ct-trait-fort);}
  .cb-eq-enreg{display:none; flex-wrap:wrap; gap:8px; align-items:center; margin-bottom:10px; padding:10px; border-radius:12px; background:var(--ct-surface-2);}
  .cb-eq-enreg.ouvert{display:flex;}
  .cb-eq-enreg input, .cb-eq-enreg select{height:36px; padding:0 10px; border-radius:10px; border:1px solid var(--ct-trait); background:var(--ct-surface); color:var(--ink); font:inherit; font-size:13px; min-width:0;}
  .cb-eq-enreg input{flex:1 1 130px;}
  .cb-eq-options{display:grid; gap:10px; margin-top:12px; padding-top:12px; border-top:1px solid var(--ct-trait);}
  .cb-eq-opt{display:flex; flex-wrap:wrap; align-items:center; gap:8px 12px; font-size:13px; color:var(--ink-soft);}
  .cb-eq-opt > span{min-width:132px; font-weight:700;}
  .cb-eq-face{display:flex; flex-wrap:wrap; align-items:center; gap:8px; padding:10px 12px; border-radius:12px; background:var(--ct-surface-2); font-size:12.5px; color:var(--ink-soft);}
  .cb-eq-face .adv{display:inline-flex; align-items:center; gap:6px;}
  .cb-eq-face img{width:28px; height:28px; border-radius:50%; object-fit:cover; object-position:50% 22%; border:2px solid var(--tc, #9aa4b2); background:#0a1018;}
  .cb-tuile .eff{position:absolute; z-index:4; left:2px; bottom:46px; padding:1px 7px; border-radius:99px; font-size:10.5px; font-weight:900; color:#05110b; background:#5BE0A6;}
  .cb-tuile .eff.faible{color:#1a0508; background:#FF7A85;}
  .cb-tuile[draggable="true"]{cursor:grab;}
  .cb-seg.mini{padding:3px; width:max-content; max-width:100%;}
  .cb-seg.mini button{height:32px; padding:0 14px; font-size:13px;}

  /* ---------- l'écran de combat ---------- */
  .cb-scene{--tc:#4FB4FF; background:#05080d; font-family:inherit; overflow:hidden; display:flex; flex-direction:column;}
  .cb-scene .ct-scene-fond{display:none;}
  .cb-scene .ct-scene-x{display:none;}
  /* Le décor est une image pixel-art (img/combat/, fabriquée par outils/combat/fonds.py) affichée sans lissage ;
     les combattants se tiennent sur un disque de scène, leur barre de vie au-dessus. Sur grand écran : les alliés en bas à gauche,
     les adversaires en haut à droite, la liste des tours en haut à gauche, le panneau d'actions en bas. */
  .cb-scene{--vw:clamp(60px, 19vw, 92px); --uw:calc(var(--vw) + 44px);}
  .cb-decor{position:absolute; inset:0; z-index:0; overflow:hidden; pointer-events:none; contain:strict; background:#05070d;}
  .cb-fond{position:absolute; inset:0; width:100%; height:100%; max-width:none; object-fit:cover; object-position:50% 64%; image-rendering:pixelated; image-rendering:crisp-edges; display:block; animation:cbRespire 3.6s steps(5) infinite alternate;}
  .cb-decor::after{content:''; position:absolute; inset:0; background:linear-gradient(180deg, rgba(3,5,12,.22) 0%, rgba(3,5,12,0) 36%, rgba(3,5,12,.34) 100%);}
  .cb-lum{position:absolute; left:-10%; right:-10%; top:-30%; height:90%; mix-blend-mode:screen; opacity:.5; transform-origin:50% 0;
    background:conic-gradient(from 170deg at 50% 0%, transparent 0 14deg, var(--lc) 19deg, transparent 27deg 40deg, var(--lc) 44deg, transparent 51deg); animation:cbBalaye 7s ease-in-out infinite alternate;}
  .cb-lum.b{opacity:.38; animation-duration:9s; animation-delay:-3s; animation-direction:alternate-reverse;}
  @keyframes cbRespire{from{filter:brightness(.96);} to{filter:brightness(1.12);}}
  @keyframes cbBalaye{from{transform:rotate(-7deg);} to{transform:rotate(7deg);}}

  .cb-s-tete{position:relative; z-index:7; display:flex; align-items:center; gap:7px; padding:max(10px, env(safe-area-inset-top)) 12px 4px;}
  .cb-s-tete > div:first-child{flex:1; min-width:0;}
  .cb-s-tete small{display:block; font-size:10px; font-weight:800; letter-spacing:.12em; text-transform:uppercase; color:rgba(255,255,255,.7); text-shadow:0 1px 4px rgba(0,0,0,.9);}
  .cb-s-tete b{display:block; font-size:14px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; text-shadow:0 1px 6px rgba(0,0,0,.9);}
  .cb-mini{all:unset; cursor:pointer; box-sizing:border-box; height:34px; min-width:36px; padding:0 11px; display:inline-flex; align-items:center; justify-content:center; border-radius:8px; font-size:12px; font-weight:800; letter-spacing:.05em; color:#1a2547; background:#f4f6fb; border:2px solid #fff; box-shadow:0 3px 0 #7f8db0, 0 6px 14px rgba(0,0,0,.4); white-space:nowrap; transition:transform .1s, box-shadow .1s;}
  .cb-mini:hover{background:#fff;}
  .cb-mini:active{transform:translateY(2px); box-shadow:0 1px 0 #7f8db0;}
  .cb-mini[aria-pressed="true"]{color:#fff; background:#2f7be0; border-color:#9cc8ff; box-shadow:0 3px 0 #17407f, 0 6px 14px rgba(0,0,0,.4);}
  .cb-mini[disabled]{opacity:.45; cursor:default;}
  .cb-mini:focus-visible{outline:2px solid #FFD76B; outline-offset:2px;}
  .cb-frise{position:relative; z-index:6; display:flex; align-items:center; gap:3px; margin:2px 12px 4px; padding:4px; width:max-content; max-width:calc(100% - 24px); overflow:hidden; border-radius:9px; background:rgba(8,13,32,.84); border:2px solid #1d2c5c; box-shadow:0 4px 12px rgba(0,0,0,.4);}
  .cb-frise > small{display:none;}
  .cb-frise .f{position:relative; width:32px; height:32px; flex:0 0 auto; border-radius:4px; border:2px solid var(--fc, #888); background:#0a1018 center / cover no-repeat; opacity:.88; transition:transform .3s, opacity .3s;}
  .cb-frise .f.allie{--fc:#5BB8FF;} .cb-frise .f.ennemi{--fc:#FF6B77;}
  .cb-frise .f:first-of-type{width:40px; height:40px; opacity:1; border-color:#fff; box-shadow:0 0 0 2px var(--fc), 0 0 12px var(--fc);}
  .cb-frise .f.ko{filter:grayscale(1); opacity:.3;}
  .cb-champ{position:relative; z-index:3; flex:1 1 auto; min-height:0; display:flex; flex-direction:column; justify-content:space-around; gap:6px; padding:2px 10px 18px;}
  .cb-rangee{position:relative; display:flex; justify-content:center; align-items:flex-start; gap:clamp(8px, 4vw, 40px);}
  /* le disque de scène sous chaque camp */
  .cb-rangee::before{content:''; position:absolute; z-index:0; left:50%; top:calc(100% - var(--sx, 0px) / 2); width:calc(100% + 44px); aspect-ratio:160 / 52; transform:translate(-50%, -38%);
    background:var(--plat) center / 100% 100% no-repeat; image-rendering:pixelated; pointer-events:none;}
  .cb-rangee[data-rang="0"]{--plat:url(img/combat/plateforme-allie.png);}
  .cb-rangee[data-rang="1"]{--plat:url(img/combat/plateforme-ennemi.png);}
  .cb-u{position:relative; z-index:1; width:var(--uw); display:grid; gap:3px; justify-items:center; align-content:start; transition:opacity .4s, filter .4s;}
  .cb-u-nom{order:1; display:flex; align-items:center; justify-content:center; gap:5px; max-width:100%; font-size:11.5px; font-weight:800; text-align:center; text-shadow:0 1px 5px rgba(0,0,0,.95), 0 0 2px rgba(0,0,0,.9); line-height:1.15;}
  .cb-u-nom span{overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:100%;}
  .cb-pv{order:2; position:relative; width:100%; height:11px; border-radius:2px; background:#150c1a; border:2px solid #0a0610; box-shadow:0 0 0 1px rgba(255,255,255,.2), 0 2px 6px rgba(0,0,0,.5); overflow:hidden;}
  .cb-u.ennemi .cb-pv{border-color:#7a1c24;} .cb-u.allie .cb-pv{border-color:#14502e;}
  .cb-pv i{position:absolute; inset:0 auto 0 0; background:#43d88f; box-shadow:inset 0 2px 0 rgba(255,255,255,.4), inset 0 -2px 0 rgba(0,0,0,.28); transition:width .55s cubic-bezier(.2,.8,.2,1), background .3s;}
  .cb-pv.mid i{background:#F2C14E;} .cb-pv.bas i{background:#FF5C6A;}
  .cb-pv b{position:absolute; inset:0; display:grid; place-items:center; font-size:8.5px; font-weight:800; color:#fff; text-shadow:0 1px 2px rgba(0,0,0,1), 0 0 3px rgba(0,0,0,.9); font-variant-numeric:tabular-nums;}
  .cb-jauge{order:3; position:relative; width:88%; height:5px; border-radius:1px; background:#0a0610; border:1px solid #0a0610; box-shadow:0 0 0 1px rgba(255,255,255,.14); overflow:hidden;}
  .cb-jauge i{position:absolute; inset:0 auto 0 0; width:0; background:linear-gradient(90deg, #2f8fe8, #8fd3ff); transition:width .5s ease;}
  .cb-u.ennemi .cb-jauge i{background:linear-gradient(90deg, #e8503f, #ffb08f);}
  .cb-jauge.pleine i{box-shadow:0 0 8px #fff;}
  .cb-badges{order:4; display:flex; flex-wrap:wrap; justify-content:center; gap:3px; min-height:15px;}
  .cb-badges span{display:inline-flex; align-items:center; gap:3px; height:15px; padding:0 5px; border-radius:3px; font-size:9px; font-weight:900; letter-spacing:.03em; background:rgba(8,12,28,.8); border:1px solid rgba(255,255,255,.2); color:#fff; white-space:nowrap;}
  .cb-badges span i{font-style:normal; opacity:.75;}
  .cb-badges .haut{background:rgba(20,80,46,.9); color:#9af5cb;}
  .cb-badges .bas{background:rgba(90,20,30,.92); color:#ffadb5;}
  .cb-badges .neutre{background:rgba(80,60,10,.92); color:#ffe39a;}
  /* le combattant : un portrait à coins taillés au pixel, debout sur le disque */
  .cb-u-vis{order:5; position:relative; width:var(--vw); aspect-ratio:4 / 5; margin-top:2px; filter:drop-shadow(0 4px 0 rgba(0,0,0,.35));}
  .cb-u-vis::before{content:''; position:absolute; z-index:-1; left:-10%; right:-10%; bottom:-9px; height:14px; border-radius:50%; background:rgba(0,0,0,.42);}
  .cb-u-cadre{position:absolute; inset:0; padding:3px; background:var(--tc); clip-path:polygon(0 4px, 4px 4px, 4px 0, calc(100% - 4px) 0, calc(100% - 4px) 4px, 100% 4px, 100% calc(100% - 4px), calc(100% - 4px) calc(100% - 4px), calc(100% - 4px) 100%, 4px 100%, 4px calc(100% - 4px), 0 calc(100% - 4px));}
  .cb-u-cadre img{width:100%; height:100%; object-fit:cover; object-position:50% 20%; display:block; background:#0a1018; clip-path:polygon(0 2px, 2px 2px, 2px 0, calc(100% - 2px) 0, calc(100% - 2px) 2px, 100% 2px, 100% calc(100% - 2px), calc(100% - 2px) calc(100% - 2px), calc(100% - 2px) 100%, 2px 100%, 2px calc(100% - 2px), 0 calc(100% - 2px));}
  .cb-u-role{position:absolute; z-index:2; left:50%; bottom:-8px; transform:translateX(-50%); padding:1px 7px; border-radius:3px; font-size:8.5px; font-weight:900; letter-spacing:.08em; text-transform:uppercase; color:#06090e; background:var(--tc); border:1px solid rgba(0,0,0,.5); white-space:nowrap;}
  .cb-u.actif .cb-u-vis{filter:drop-shadow(0 0 9px var(--tc)) drop-shadow(0 4px 0 rgba(0,0,0,.35));}
  .cb-u.actif::before{content:''; position:absolute; z-index:2; left:50%; top:-12px; width:0; height:0; margin-left:-7px; border:7px solid transparent; border-top-color:#FFD25A; filter:drop-shadow(0 0 4px rgba(255,210,90,.9)); animation:cbMarque .8s steps(3) infinite alternate;}
  .cb-u.agit-b .cb-u-vis{animation:cbAvB .5s cubic-bezier(.3,.7,.3,1);}
  .cb-u.agit-h .cb-u-vis{animation:cbAvH .5s cubic-bezier(.3,.7,.3,1);}
  .cb-u.touche .cb-u-vis{animation:cbSecoue .45s;}
  .cb-u.touche .cb-u-cadre::after{content:''; position:absolute; inset:0; background:rgba(255,70,70,.55); animation:cbFlash .45s both; pointer-events:none;}
  .cb-u.soigne .cb-u-cadre::after{content:''; position:absolute; inset:0; background:rgba(91,224,166,.55); animation:cbFlash .6s both; pointer-events:none;}
  .cb-u.cible, .cb-u.cible .cb-u-vis{cursor:pointer;}
  .cb-u.cible .cb-u-vis{animation:cbCible .7s steps(4) infinite alternate; filter:drop-shadow(0 0 10px rgba(255,215,107,.95));}
  .cb-u.cible .cb-u-cadre{background:#FFD76B;}
  .cb-u.cible .cb-u-vis::before{border:2px dashed #ff6b77; background:rgba(255,80,80,.2);}
  .cb-u.presel::after{content:'CIBLE'; position:absolute; z-index:3; right:2px; top:-4px; padding:1px 6px; border-radius:3px; font-size:8.5px; font-weight:900; letter-spacing:.08em; color:#1c1500; background:#FFD76B;}
  .cb-u.ko{filter:grayscale(1); opacity:.4;}
  .cb-ko{position:absolute; z-index:6; left:50%; top:50%; transform:translate(-50%, -50%) rotate(-12deg); display:none; padding:2px 9px; border-radius:4px; font-size:15px; font-weight:900; letter-spacing:.08em; color:#fff; background:rgba(220,50,60,.94); border:2px solid #fff;}
  .cb-u.ko .cb-ko{display:block;}
  .cb-flotte{position:absolute; z-index:9; left:50%; top:18%; transform:translateX(-50%); font-size:24px; font-weight:900; pointer-events:none; text-shadow:0 2px 0 rgba(0,0,0,.95), 0 0 8px rgba(0,0,0,.9); white-space:nowrap; animation:cbFlotte 1.15s ease-out both;}
  .cb-flotte.degat{color:#ff6b75;} .cb-flotte.soin{color:#5BE0A6;} .cb-flotte.texte{font-size:14px; color:#fff;} .cb-flotte.crit{color:#FFD76B; font-size:30px;}
  .cb-flotte.sup{color:#7dffb3;} .cb-flotte.mal{color:#ff9aa3;}
  .cb-fx{position:absolute; z-index:5; inset:-30%; border-radius:50%; pointer-events:none; background:radial-gradient(circle, var(--tc) 0%, transparent 68%); mix-blend-mode:screen; animation:cbFx .55s ease-out both;}
  .cb-bandeau{position:absolute; z-index:10; left:0; right:0; top:44%; display:grid; place-items:center; pointer-events:none; opacity:0;}
  .cb-bandeau span{padding:7px 22px; font-size:clamp(15px, 4.4vw, 22px); font-weight:900; letter-spacing:.04em; text-transform:uppercase; color:#fff; background:linear-gradient(90deg, transparent, color-mix(in srgb, var(--tc) 85%, #000) 18%, color-mix(in srgb, var(--tc) 85%, #000) 82%, transparent); text-shadow:0 2px 8px rgba(0,0,0,.7); transform:skewX(-10deg);}
  .cb-bandeau.on{animation:cbBandeau 1s ease both;}
  /* le panneau du bas : le combattant qui joue à gauche, ses techniques en cartes à droite */
  .cb-panneau{position:relative; z-index:7; padding:14px 10px max(12px, env(safe-area-inset-bottom)); background:linear-gradient(180deg, rgba(6,10,28,0), rgba(6,10,28,.9) 16px, #070b1e 100%); border-top:2px solid rgba(60,90,190,.35);}
  .cb-pan-in{max-width:1100px; margin:0 auto; display:grid; gap:8px; grid-template-areas:'a' 't' 'h' 'b';}
  .cb-pan-actif{grid-area:a; display:flex; align-items:center; gap:10px; min-height:34px;}
  .cb-pan-actif img{width:38px; height:38px; border-radius:4px; object-fit:cover; object-position:50% 20%; border:2px solid var(--tc); background:#0a1018; flex:0 0 auto;}
  .cb-pan-actif div{min-width:0; flex:1; font-size:13px; line-height:1.25;}
  .cb-pan-actif b{display:block; font-size:14.5px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
  .cb-pan-actif small{color:rgba(255,255,255,.68); font-size:11.5px;}
  .cb-techs{grid-area:t; display:grid; grid-template-columns:repeat(3, minmax(0, 1fr)); gap:8px;}
  .cb-tech{all:unset; box-sizing:border-box; cursor:pointer; position:relative; display:grid; gap:3px; align-content:start; min-height:76px; padding:8px 9px; border-radius:9px; border:2px solid #243a78; border-top:4px solid var(--tc, #9aa4b2); background:#0d1736; box-shadow:0 3px 0 #050a1c;}
  .cb-tech:hover{background:#13214a; border-color:#3560c8;}
  .cb-tech:focus-visible{outline:2px solid #FFD76B; outline-offset:1px;}
  .cb-tech[aria-pressed="true"]{border-color:#FFD76B; background:#1b2a58; box-shadow:0 0 0 1px #FFD76B, 0 3px 0 #050a1c;}
  .cb-tech[disabled]{opacity:.45; cursor:default;}
  .cb-tech .n{font-size:12.5px; font-weight:800; line-height:1.2;}
  .cb-tech .m{font-size:10.5px; color:rgba(255,255,255,.66); line-height:1.3;}
  .cb-tech .r{font-size:10.5px; font-weight:900; letter-spacing:.04em; text-transform:uppercase;}
  .cb-tech .r.pret{color:#5BE0A6;} .cb-tech .r.cd{color:#ffb35c;}
  .cb-tech .e{font-size:10.5px; font-weight:900; min-height:13px;}
  .cb-tech .e.sup{color:#7dffb3;} .cb-tech .e.peu{color:#ff9aa3;}
  .cb-tech .k{position:absolute; top:5px; right:7px; font-size:10px; font-weight:800; color:rgba(255,255,255,.35);}
  .cb-pan-msg{min-height:44px; display:grid; place-items:center; padding:6px 10px; border-radius:9px; background:#0d1736; border:2px solid #243a78; text-align:center; font-size:13.5px; font-weight:700; line-height:1.35;}
  .cb-pan-aide{grid-area:h; font-size:11.5px; color:rgba(255,255,255,.66); text-align:center;}
  .cb-pan-bas{grid-area:b; display:flex; justify-content:center; gap:8px;}

  /* ---------- le tutoriel et l'écran de fin ---------- */
  .cb-voile{position:absolute; z-index:30; inset:0; display:flex; align-items:center; justify-content:center; padding:16px; background:rgba(3,5,8,.82); backdrop-filter:blur(8px); -webkit-backdrop-filter:blur(8px); overflow-y:auto;}
  .cb-tuto{width:min(420px, 100%); display:grid; gap:12px; padding:20px; border-radius:20px; border:1px solid rgba(255,255,255,.18); background:#0b1119; text-align:center;}
  .cb-tuto h3{margin:0; font-size:20px;}
  .cb-tuto p{margin:0; font-size:14px; line-height:1.55; color:rgba(255,255,255,.8);}
  .cb-tuto .pts{display:flex; justify-content:center; gap:6px;}
  .cb-tuto .pts i{width:7px; height:7px; border-radius:50%; background:rgba(255,255,255,.25);}
  .cb-tuto .pts i.on{background:#fff;}
  .cb-tuto .ill{display:grid; place-items:center; height:78px; border-radius:14px; background:rgba(255,255,255,.05); font-size:13px; font-weight:800; letter-spacing:.04em;}
  .cb-tuto .boutons, .cb-fin .boutons{display:flex; flex-wrap:wrap; gap:10px; justify-content:center;}
  .cb-fin{width:min(560px, 100%); display:grid; gap:14px; text-align:center; justify-items:center; padding:18px 6px;}
  .cb-fin h3{margin:0; font-size:clamp(30px, 8vw, 44px); font-weight:900; letter-spacing:-.02em; animation:cbTitre .6s cubic-bezier(.2,1.4,.4,1) both;}
  .cb-fin.victoire h3{color:#5BE0A6; text-shadow:0 0 30px rgba(91,224,166,.5);} .cb-fin.defaite h3{color:#FF7A85;}
  .cb-fin-gains{display:flex; flex-wrap:wrap; gap:8px; justify-content:center;}
  .cb-fin-gains span{padding:7px 12px; border-radius:11px; font-size:14px; font-weight:800; background:rgba(255,255,255,.1);}
  .cb-bilan{width:100%; display:grid; gap:7px;}
  .cb-bilan .l{display:grid; grid-template-columns:auto 1fr auto auto auto; gap:6px 10px; align-items:center; padding:8px 10px; border-radius:12px; background:rgba(255,255,255,.06); text-align:left; font-size:12px; font-variant-numeric:tabular-nums;}
  .cb-bilan .l.mvp{background:linear-gradient(90deg, rgba(255,215,107,.22), rgba(255,255,255,.06)); box-shadow:inset 0 0 0 1px rgba(255,215,107,.5);}
  .cb-bilan .l img{width:34px; height:34px; border-radius:50%; object-fit:cover; object-position:50% 22%; border:2px solid var(--tc, #888);}
  .cb-bilan .l b{display:block; font-size:13px;}
  .cb-bilan .l span.c{display:grid; text-align:center; line-height:1.2; font-size:10px; color:rgba(255,255,255,.6);}
  .cb-bilan .l span.c strong{font-size:14px; color:#fff;}
  .cb-bilan .mvp-t{display:inline-block; margin-left:6px; padding:1px 6px; border-radius:6px; font-size:9.5px; font-weight:900; letter-spacing:.08em; color:#1c1500; background:#FFD76B;}
  .cb-bilan .adv{opacity:.7;}

  @keyframes cbAvH{40%{transform:translateY(26px) scale(1.06);} 100%{transform:none;}}
  @keyframes cbAvB{40%{transform:translateY(-26px) scale(1.06);} 100%{transform:none;}}
  @keyframes cbSecoue{0%,100%{transform:none;} 20%{transform:translateX(-8px);} 40%{transform:translateX(7px);} 60%{transform:translateX(-4px);} 80%{transform:translateX(3px);}}
  @keyframes cbFlash{from{opacity:1;} to{opacity:0;}}
  @keyframes cbFlotte{from{opacity:0; transform:translate(-50%, 10px) scale(.7);} 20%{opacity:1; transform:translate(-50%, 0) scale(1.15);} to{opacity:0; transform:translate(-50%, -52px) scale(1);}}
  @keyframes cbFx{from{opacity:.95; transform:scale(.3);} to{opacity:0; transform:scale(1.25);}}
  @keyframes cbBandeau{0%{opacity:0; transform:translateX(-40px);} 18%{opacity:1; transform:none;} 80%{opacity:1;} 100%{opacity:0; transform:translateX(40px);}}
  @keyframes cbMarque{from{transform:translateY(0);} to{transform:translateY(5px);}}
  @keyframes cbCible{from{transform:scale(1);} to{transform:scale(1.07);}}
  @keyframes cbTitre{from{opacity:0; transform:scale(.5);} to{opacity:1; transform:none;}}
  @media (max-width:640px){
    .cb-rang{grid-template-columns:1fr;}
    .cb-trophees{grid-template-columns:auto auto; justify-content:space-between; place-items:center; text-align:left; gap:10px;}
    .cb-ligne{grid-template-columns:auto 1fr; }
    .cb-ligne > :last-child{grid-column:1 / -1;}
    .cb-mini.texte{display:none;}
    .cb-eq-sauves{grid-template-columns:repeat(5, minmax(0, 1fr));}
    .cb-eq-opt > span{min-width:100%;}
  }
  @media (max-height:700px){
    .cb-scene{--vw:clamp(50px, 14vw, 74px);}
    .cb-tech{min-height:62px; padding:6px 8px;}
    .cb-tech .m{display:none;}
    .cb-pan-aide{display:none;}
  }
  /* grand écran en largeur : la scène comme dans un jeu de rôle (alliés en bas à gauche, adversaires en haut à droite) */
  @media (min-width:900px) and (min-aspect-ratio:13/10){
    .cb-scene{--vw:clamp(96px, 8.4vw, 150px); --uw:calc(var(--vw) + 56px);}
    .cb-s-tete{position:absolute; top:0; left:0; right:0; z-index:8; pointer-events:none; padding-top:max(12px, env(safe-area-inset-top));}
    .cb-s-tete > *{pointer-events:auto;}
    .cb-s-tete > div:first-child{position:absolute; left:50%; top:max(12px, env(safe-area-inset-top)); transform:translateX(-50%); flex:none; text-align:center; max-width:36vw; pointer-events:none;}
    .cb-s-tete > .cb-mini:first-of-type{margin-left:auto;}
    .cb-frise{position:absolute; left:12px; top:12px; margin:0; z-index:9;}
    .cb-champ{display:block; padding:0;}
    .cb-rangee{position:absolute; gap:clamp(28px, 5vw, 90px);}
    .cb-rangee[data-rang="0"]{left:6%; bottom:9%; width:42%; --sx:70px; padding-bottom:6px;}
    .cb-rangee[data-rang="1"]{right:6%; top:17%; width:40%; --sx:-50px;}
    .cb-rangee[data-rang="0"] .cb-u:nth-child(2){margin-top:calc(var(--sx) * -1);}
    .cb-rangee[data-rang="1"] .cb-u:nth-child(2){margin-top:calc(var(--sx) * -1);}
    .cb-rangee::before{width:calc(100% + 90px);}
    .cb-u-nom{font-size:13px;}
    .cb-flotte{font-size:30px;}
    .cb-pan-in{grid-template-columns:minmax(240px, 1fr) minmax(0, 2.2fr); grid-template-areas:'a t' 'h t' 'b t'; column-gap:18px; align-items:start;}
    .cb-pan-in > .cb-pan-msg{grid-column:1 / -1;}
    .cb-pan-actif{padding-top:4px;} .cb-pan-aide{text-align:left;} .cb-pan-bas{justify-content:flex-start;}
    .cb-tech{min-height:96px; padding:10px 12px;}
    .cb-tech .n{font-size:14px;}
  }
  @media (prefers-reduced-motion: reduce){
    .cb-u.agit-b .cb-u-vis, .cb-u.agit-h .cb-u-vis, .cb-u.touche .cb-u-vis, .cb-fx, .cb-decor *, .cb-u.cible .cb-u-vis, .cb-u.actif::before, .cb-fin h3{animation:none !important;}
  }
  .cb-frise img.f{object-fit:cover; object-position:50% 22%; display:block;}
  .cb-effn{pointer-events:none;}
  .cb-eq-t{width:100%; border-collapse:collapse; font-size:13px;}
  .cb-eq-t th, .cb-eq-t td{padding:6px 8px; text-align:center; border-bottom:1px solid var(--ct-trait);}
  .cb-eq-t th:first-child, .cb-eq-t td:first-child{text-align:left;}
  .cb-case{all:unset; cursor:pointer; box-sizing:border-box; min-width:44px; height:30px; padding:0 6px; border-radius:8px; display:inline-grid; place-items:center; font-size:12px; font-weight:800; font-variant-numeric:tabular-nums; color:var(--ink-soft); background:var(--ct-surface-2);}
  .cb-case.sup{color:#5BE0A6; background:rgba(91,224,166,.14);}
  .cb-case.peu{color:#FF7A85; background:rgba(255,122,133,.14);}
  .cb-case:focus-visible{outline:2px solid var(--ct-accent);}
  .cb-form{display:grid; grid-template-columns:repeat(auto-fit, minmax(160px, 1fr)); gap:12px; margin-top:14px;}
  .cb-form label{display:grid; gap:5px; font-size:12px; font-weight:700; color:var(--ink-soft);}
  .cb-form label.large{grid-column:1 / -1;}
  .cb-form .cb-champ-eq{width:100%; min-width:0;}
  .cb-form small{font-weight:500; color:var(--muted);}
  .cb-apercu{display:grid; grid-template-columns:repeat(5, 1fr); gap:6px; margin-top:12px; font-size:11.5px; text-align:center; color:var(--ink-soft);}
  .cb-apercu div{padding:7px 3px; border-radius:10px; background:var(--ct-surface-2); line-height:1.5; font-variant-numeric:tabular-nums;}
  .cb-apercu b{display:block; font-size:11px; color:var(--ink);}
  .cb-journal{max-height:320px; overflow-y:auto; padding:12px; border-radius:14px; background:rgba(0,0,0,.3); font-size:13px; line-height:1.6; color:var(--ink-soft);}
  .cb-journal h5{margin:8px 0 2px; font-size:11px; letter-spacing:.1em; text-transform:uppercase; color:var(--muted);}
  `;

  function init(api){
    A = api;
    if(!document.getElementById('cb-style')){
      const s = document.createElement('style');
      s.id = 'cb-style';
      s.textContent = CSS;
      document.head.appendChild(s);
    }
    if(!S.init){
      S.init = true;
      modesIntegres();
    }
  }

  const nf = (n) => A.nf(n);
  const esc = (t) => A.esc(t);
  const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
  const calme = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const couleur = (c) => A.couleurOk(c || '#9aa4b2');
  const pct = (a, b) => Math.max(0, Math.min(100, b ? a / b * 100 : 0));
  const mu = (m) => '×' + String(Number(m)).replace('.', ',');
  const chip = (nom, c) => nom ? `<span class="cb-type" style="--tc:${couleur(c)}">${esc(nom)}</span>` : '<span class="cb-type neutre">Neutre</span>';
  const roleChip = (nom) => nom ? `<span class="cb-role">${esc(nom)}</span>` : '';
  const signe = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n);
  const stock = {
    lire(k, def){ try{ const v = localStorage.getItem(k); return v === null ? def : v; }catch(e){ return def; } },
    ecrire(k, v){ try{ localStorage.setItem(k, String(v)); }catch(e){ /* stockage indisponible : on garde la valeur du moment */ } }
  };

  // ---------------------------------------------------------------------
  // La fiche de combat d'une carte : style, rôle, PV, stats, 3 techniques, passif, faiblesses, citation
  // ---------------------------------------------------------------------

  function techHtml(a){
    const bits = [];
    if(a.puissance) bits.push('Puissance ' + a.puissance + (a.hits > 1 ? ' ×' + a.hits : ''));
    if(a.puissance) bits.push(a.justesse + ' % de précision');
    if(a.perce) bits.push('ignore ' + a.perce + ' % de la Défense');
    bits.push(CIBLES[a.cible] || '');
    bits.push(a.slot === 1 ? 'toujours prête' : 'recharge ' + a.recharge + ' tour' + (a.recharge > 1 ? 's' : ''));
    return `<div class="cb-att" style="--tc:${couleur(a.couleur)}">
      <div class="cb-att-t"><b>${esc(a.nom)}</b>${chip(a.type_nom, a.couleur)}</div>
      <div class="cb-att-m">${bits.filter(Boolean).map((b) => `<span>${esc(b)}</span>`).join('')}</div>
      ${a.description ? `<p>${esc(a.description)}</p>` : ''}
    </div>`;
  }

  function ficheHtml(c){
    const mx = { pv: 300, pui: 160, def: 160, vit: 120 };
    const aff = (liste) => liste && liste.length ? liste.map((t) => `<span class="cb-type" style="--tc:${couleur(t.couleur)}">${esc(t.nom)} ${mu(t.mult)}</span>`).join('') : '<span>aucun</span>';
    const techs = c.techniques || c.techs || [];
    return `<div class="cb-fiche" style="--tc:${couleur(c.couleur)}">
      <div class="cb-fiche-t"><div class="cb-roles">${chip(c.type_nom, c.couleur)}${roleChip(c.role_nom)}</div><div class="cb-pvgros"><small>PV</small>${nf(c.pv_max || c.pv)}</div></div>
      ${c.role_resume ? `<p class="cb-cit" style="font-style:normal">${esc(c.role_resume)}</p>` : ''}
      <div class="cb-stats">${['pui', 'def', 'vit'].map((k) => `<div class="cb-st"><span>${LIB[k]}</span><b>${nf(c[k])}</b><i style="--w:${pct(c[k], mx[k])}%"></i></div>`).join('')}</div>
      <div class="cb-atts">${techs.map(techHtml).join('')}</div>
      ${c.capacite ? `<div class="cb-cap"><b>Passif · ${esc(c.capacite.nom)}</b> — ${esc(c.capacite.description)}</div>` : ''}
      <div class="cb-aff"><span>Frappe fort contre</span>${aff(c.forces)}</div>
      <div class="cb-aff"><span>Faible contre</span>${aff(c.faiblesses)}</div>
      <div class="cb-aff"><span>Résiste à</span>${aff(c.resistances)}</div>
      ${c.citation ? `<p class="cb-cit">« ${esc(c.citation)} »</p>` : ''}
    </div>`;
  }

  // Dans la fiche d'une carte (cartes.js) : la fiche de combat arrive sous les statistiques.
  async function fiche(el, api, o){
    init(api);
    try{
      const c = await A.appel('combat_carte', { p_artist: o.artist, p_booster: o.booster || null, p_holo: !!o.holo });
      el.innerHTML = `<div class="ct-titre-sec" style="margin:22px 0 10px"><h3>Fiche de combat</h3></div>${ficheHtml(c)}`;
    }catch(e){
      el.innerHTML = '';
    }
  }

  // La fiche d'une unité EN COMBAT (statuts compris), dans une fenêtre.
  function ficheUnite(u){
    const st = (u.statuts || []).map((s) => statutInfo(s)).join('') || '<span class="cb-puce">Aucun statut</span>';
    const f = A.fenetre(`
      <div style="display:flex; align-items:center; gap:14px; padding-right:40px">
        <img class="cb-avatar" style="width:56px; height:56px; border-color:${couleur(u.couleur)}" src="${esc(A.safeUrl(u.photo))}" alt="">
        <div><h2 style="margin:0">${esc(u.nom)}</h2><p class="sous" style="margin:2px 0 0">${nf(u.pv)} / ${nf(u.pv_max)} PV · ${u.ko ? 'K.O.' : 'en lice'}</p></div></div>
      <div class="cb-roles" style="margin:12px 0">${st}</div>
      <div style="margin-top:6px">${ficheHtml(u)}</div>`, true);
    return f;
  }

  function statutInfo(s){
    const d = STAT[s.k] || { c: s.k, n: s.k, t: 'neutre' };
    const val = s.k === 'bouclier' ? ' ' + Math.round(s.v) : '';
    const num = ['pui+', 'pui-', 'def+', 'def-', 'vit+', 'vit-', 'marque', 'brulure', 'poison', 'regen'].includes(s.k) ? ` (${s.k.endsWith('-') ? '−' : '+'}${Math.round(s.v)} %)` : '';
    return `<span class="cb-puce ${d.t === 'haut' ? 'ok' : d.t === 'bas' ? '' : 'or'}" title="${esc(d.n)}">${esc(d.c)}${esc(val)} · ${esc(d.n)}${esc(num)} · ${s.d} tour${s.d > 1 ? 's' : ''}</span>`;
  }

  // ---------------------------------------------------------------------
  // Les modes de combat : le registre, le hub en tuiles, les modes intégrés
  // ---------------------------------------------------------------------

  const GROUPES = [['jeu', 'Contre le jeu'], ['dresseurs', 'Contre les dresseurs'], ['farm', 'Entraînement']];

  function enregistrer(m){
    if(!m || !/^[a-z][a-z0-9_-]{1,29}$/.test(String(m.id || '')) || !m.titre || typeof m.ouvrir !== 'function') throw new Error('Mode de combat invalide : il faut un id, un titre et une fonction ouvrir(hote, api).');
    if(!GROUPES.some((g) => g[0] === m.groupe)) m.groupe = 'jeu';
    const i = S.modes.findIndex((x) => x.id === m.id);
    if(i >= 0) S.modes[i] = m; else S.modes.push(m);
    if(S.hote && S.hote.isConnected && S.acc && S.vue === 'jouer' && !S.mode) dessiner();
  }

  const apiModes = () => Object.assign({}, A, {
    lancerCombat, equipeModal, rafraichir, acc: () => S.acc,
    retour: () => { S.mode = null; dessiner(); }
  });

  async function chargerAcc(){
    S.acc = await A.appel('combat_accueil');
    return S.acc;
  }

  // Les modes fournis par d'autres fichiers (combat-pve.js…) : tout module « combat-… » déclaré dans WAVE_MODULES (index.html)
  // est chargé avec l'onglet ; il s'enregistre lui-même (modes.enregistrer, equipeVues.enregistrer). Un échec n'empêche rien.
  let modesCharges = null;
  function chargerModes(){
    if(modesCharges) return modesCharges;
    if(typeof WAVE_MODULES !== 'object' || typeof window.chargerWaveModule !== 'function') return Promise.resolve();
    modesCharges = Promise.all(Object.keys(WAVE_MODULES).filter((n) => /^combat-/.test(n)).map((n) => window.chargerWaveModule(n).catch(() => null)));
    return modesCharges;
  }

  async function monter(hote, api){
    init(api);
    S.hote = hote;
    if(!hote.querySelector('.cb')) hote.innerHTML = '<div class="ct-vide">Chargement…</div>';
    try{
      await Promise.all([chargerAcc(), chargerModes()]);
    }catch(e){
      hote.innerHTML = `<div class="ct-panneau ct-vide"><b>Le combat n'a pas pu s'ouvrir</b>${esc(e.message)}</div>`;
      return;
    }
    dessiner();
  }

  function quitter(){ fermerScene(); }

  async function rafraichir(){
    try{ await chargerAcc(); }catch(e){ /* l'écran reste tel quel */ }
    if(S.hote && S.hote.isConnected) dessiner();
  }

  const slotHtml = (c) => c
    ? `<div class="cb-slot" style="--tc:${couleur(c.couleur)}">
        ${A.carteHtml({ nom: c.nom, photo: c.photo, rarete: c.rarete, holo: c.holo, numero: c.numero || 0 }, {})}
        <div class="cb-slot-i"><b>${esc(c.nom)}</b><div class="cb-roles">${chip(c.type_nom, c.couleur)}${roleChip(c.role_nom)}</div>
          <div class="cb-mini-stats" style="margin-top:5px"><span>PV <b>${nf(c.pv)}</b></span><span>PUI <b>${nf(c.pui)}</b></span><span>DÉF <b>${nf(c.def)}</b></span><span>VIT <b>${nf(c.vit)}</b></span></div></div>
      </div>`
    : '<div class="cb-slot"><div class="vide">Carte à choisir</div></div>';

  function dessiner(){
    const a = S.acc, m = a.moi;
    const fin = new Date(m.saison_fin + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
    const vues = [['jouer', 'Jouer'], ['classement', 'Classement'], ['historique', 'Historique']];
    const mode = S.mode ? S.modes.find((x) => x.id === S.mode) : null;

    S.hote.innerHTML = `
      <div class="cb">
        ${a.en_cours ? `<div class="cb-banniere"><div><b>Un combat est en cours</b>${esc(a.en_cours.titre || a.en_cours.adversaire)} · tour ${a.en_cours.tour}</div>
          <button type="button" class="ct-btn principal" data-reprendre>Reprendre</button><button type="button" class="ct-btn" data-abandonner>Abandonner</button></div>` : ''}
        <section class="ct-panneau cb-rang">
          <div class="cb-trophees"><b>${nf(m.trophees)}</b><span>${A.ico('trophee', 14)}Trophées</span></div>
          <div class="cb-rang-d">
            <h3>${m.rang ? 'N° ' + m.rang + ' du classement' : 'Pas encore classé'} · saison ${esc(m.saison)}</h3>
            <p>La saison se termine le ${esc(fin)} : tes trophées reviennent alors à mi-chemin de 1 000.</p>
            <div class="cb-chiffres">
              <span><b>${m.victoires}</b> victoire${m.victoires > 1 ? 's' : ''}</span><span><b>${m.defaites}</b> défaite${m.defaites > 1 ? 's' : ''}</span>
              <span>Série <b>${m.serie}</b> (record ${m.meilleure_serie})</span>
              <span>Vinyles gagnés aujourd'hui <b>${m.vinyles_jour} / ${m.plafond_jour}</b></span>
            </div>
          </div>
        </section>
        <nav class="cb-seg" aria-label="Combat">${vues.map(([id, nom]) => `<button type="button" data-vue="${id}" aria-pressed="${S.vue === id}">${nom}</button>`).join('')}</nav>
        <div data-corps></div>
      </div>`;

    const corps = S.hote.querySelector('[data-corps]');
    if(S.vue === 'jouer'){
      if(mode) vueMode(corps, mode); else vueHub(corps);
    }
    else if(S.vue === 'classement') vueClassement(corps);
    else vueHistorique(corps);

    S.hote.querySelectorAll('.cb-seg [data-vue]').forEach((b) => b.addEventListener('click', () => { S.vue = b.dataset.vue; S.mode = null; dessiner(); }));
    const r = S.hote.querySelector('[data-reprendre]');
    if(r) r.addEventListener('click', () => ouvrirScene(S.acc.en_cours, { reprise: true }));
    const ab = S.hote.querySelector('[data-abandonner]');
    if(ab) ab.addEventListener('click', () => confirmerAbandon(S.acc.en_cours));
  }

  function vueHub(corps){
    corps.innerHTML = `<div class="cb" style="gap:22px">${GROUPES.map(([g, titre]) => {
      const l = S.modes.filter((m) => m.groupe === g);
      return l.length ? `<section class="cb-groupe"><h3>${esc(titre)}</h3><div class="cb-tuiles">${l.map((m) => `
        <button type="button" class="cb-tuile-mode" data-mode="${esc(m.id)}"><span class="ic">${A.ico(m.icone || 'combat', 24)}</span><h4>${esc(m.titre)}</h4><p data-resume="${esc(m.id)}">&nbsp;</p></button>`).join('')}</div></section>` : '';
    }).join('')}</div>`;
    corps.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => { S.mode = b.dataset.mode; dessiner(); }));
    S.modes.forEach((m) => {
      if(typeof m.resume !== 'function') return;
      Promise.resolve().then(() => m.resume(S.acc)).then((t) => {
        const p = corps.querySelector(`[data-resume="${m.id}"]`);
        if(p && t) p.textContent = t;
      }).catch(() => { /* la tuile reste sans résumé */ });
    });
  }

  function vueMode(corps, m){
    corps.innerHTML = `<div class="cb" style="gap:16px"><div><button type="button" class="cb-retour" data-retour>‹ Les modes</button></div><div data-mode-corps></div></div>`;
    corps.querySelector('[data-retour]').addEventListener('click', () => { S.mode = null; dessiner(); });
    try{
      const r = m.ouvrir(corps.querySelector('[data-mode-corps]'), apiModes());
      if(r && typeof r.catch === 'function') r.catch((e) => { corps.querySelector('[data-mode-corps]').innerHTML = `<div class="ct-panneau ct-vide">${esc(e.message)}</div>`; });
    }catch(e){
      corps.querySelector('[data-mode-corps]').innerHTML = `<div class="ct-panneau ct-vide">${esc(e.message)}</div>`;
    }
  }

  const entete = (titre, sous) => `<div class="ct-titre-sec" style="margin-top:0"><h3>${esc(titre)}</h3></div>${sous ? `<p class="sous" style="margin:-6px 0 14px; font-size:13px; color:var(--muted); line-height:1.5">${sous}</p>` : ''}`;

  function modesIntegres(){
    // --- L'Arène ---
    enregistrer({ id: 'arene', titre: 'Arène', groupe: 'jeu', icone: 'trophee',
      resume: (a) => `${a.arene.filter((p) => p.etat === 'fait').length} / ${a.arene.length} crews vaincus`,
      ouvrir(hote, api){
        const a = api.acc();
        hote.innerHTML = `${entete('L\'Arène', '12 crews de plus en plus forts. La première victoire sur chacun rapporte des vinyles.')}
          <div class="cb-liste">${a.arene.map((p) => `
            <div class="cb-ligne${p.etat === 'verrouille' ? ' verrou' : ''}" style="--tc:${couleur(p.crew[0].couleur)}">
              <div class="cb-n">${p.palier}</div>
              <div><h4>${esc(p.nom)}</h4><p>${esc(p.description)}</p>
                <div style="display:flex; align-items:center; gap:10px; margin-top:8px; flex-wrap:wrap">
                  <div class="cb-portraits">${p.crew.map((c) => `<img style="--tc:${couleur(c.couleur)}" src="${esc(api.safeUrl(c.photo))}" alt="${esc(c.nom)}" title="${esc(c.nom)} · ${esc(c.type_nom)} · ${esc(c.role_nom || '')}" loading="lazy">`).join('')}</div>
                  <span class="cb-slot-i">${p.crew.map((c) => esc(c.nom)).join(' & ')}</span>
                  ${p.crew.map((c) => chip(c.type_nom, c.couleur)).join('')}
                  ${p.bonus ? `<span class="cb-puce">Stats +${p.bonus} %</span>` : ''}
                  <span class="cb-puce ${p.etat === 'fait' ? 'ok' : 'or'}">${p.etat === 'fait' ? 'Vaincu' : '+' + p.recompense + ' vinyle' + (p.recompense > 1 ? 's' : '')}</span></div></div>
              <button type="button" class="ct-btn petit ${p.etat === 'ouvert' ? 'principal' : ''}" data-palier="${p.palier}" ${p.etat === 'verrouille' ? 'disabled' : ''}>${p.etat === 'verrouille' ? 'Verrouillé' : p.etat === 'fait' ? 'Rejouer' : 'Combattre'}</button>
            </div>`).join('')}</div>`;
        hote.querySelectorAll('[data-palier]').forEach((b) => b.addEventListener('click', () => {
          const p = a.arene.find((x) => String(x.palier) === b.dataset.palier);
          api.lancerCombat({ mode: 'arene', cible: p.palier, titre: p.nom, adversaires: p.crew });
        }));
      } });

    // --- Le défi du jour ---
    enregistrer({ id: 'defi', titre: 'Défi du jour', groupe: 'jeu', icone: 'cible',
      resume: (a) => a.defi.fait ? 'Relevé aujourd\'hui · reviens demain' : `Style ${a.defi.type_nom} · +${a.defi.recompense} vinyles`,
      ouvrir(hote, api){
        const d = api.acc().defi;
        hote.innerHTML = `${entete('Défi du jour', `Aujourd'hui, le style <b>${esc(d.type_nom)}</b> est à l'honneur : ${d.crew.map((c) => esc(c.nom)).join(' &amp; ')}.`)}
          <section class="ct-panneau" style="--tc:${couleur(d.couleur)}">
            <div class="cb-bloc-duo"><div class="cb-duo">${d.crew.map(slotHtml).join('')}</div>
              <div class="cb-actions">${chip(d.type_nom, d.couleur)}
                <span class="cb-puce ${d.fait ? 'ok' : 'or'}">${d.fait ? 'Relevé aujourd\'hui (plus de gain)' : '+' + d.recompense + ' vinyles à la première victoire'}</span>
                <button type="button" class="ct-btn principal" data-go>${d.fait ? 'Rejouer pour le plaisir' : 'Relever le défi'}</button></div></div>
          </section>`;
        hote.querySelector('[data-go]').addEventListener('click', () => api.lancerCombat({ mode: 'defi', titre: 'Défi du jour · ' + d.type_nom, adversaires: d.crew }));
      } });

    // --- Les défis entre joueurs ---
    enregistrer({ id: 'pvp', titre: 'Défier un joueur', groupe: 'dresseurs', icone: 'combat',
      resume: (a) => `${a.moi.pvp_restants} défi${a.moi.pvp_restants > 1 ? 's' : ''} restant${a.moi.pvp_restants > 1 ? 's' : ''} aujourd'hui`,
      ouvrir(hote, api){ vuePvp(hote, api); } });

    // --- L'entraînement ---
    enregistrer({ id: 'entrainement', titre: 'Entraînement libre', groupe: 'farm', icone: 'eclair',
      resume: () => 'Sans coût ni récompense',
      ouvrir(hote, api){
        hote.innerHTML = `${entete('Entraînement libre', 'Un duo au hasard, de ton niveau. Aucun gain et aucun risque : parfait pour tester une équipe, une technique ou le mode Auto.')}
          <section class="ct-panneau"><button type="button" class="ct-btn principal" data-go>Lancer un entraînement</button></section>`;
        hote.querySelector('[data-go]').addEventListener('click', () => api.lancerCombat({ mode: 'entrainement', titre: 'Entraînement' }));
      } });
  }

  function vuePvp(hote, api){
    const a = api.acc(), m = a.moi, def = a.defense || [];
    hote.innerHTML = `${entete('Défier un joueur', 'Tu affrontes la défense d\'un autre joueur (pilotée par l\'ordinateur). Victoire : trophées et vinyles ; défaite : tu perds des trophées.')}
      <section class="ct-panneau">
        <div class="ct-entete-panneau"><div><h3>Ma défense</h3><p class="sous">Quand un joueur te défie, ce duo se bat à ta place. Tu gagnes des trophées s'il tient.</p></div></div>
        <div class="cb-bloc-duo"><div class="cb-duo">${slotHtml(def[0])}${slotHtml(def[1])}</div>
          <div class="cb-actions"><button type="button" class="ct-btn" data-defense>${def.length === 2 ? 'Changer ma défense' : 'Régler ma défense'}</button>
            ${def.length === 2 ? '' : '<p>Sans défense réglée, personne ne peut te défier (et tu ne gagnes pas de trophées passivement).</p>'}</div></div>
      </section>
      <section style="margin-top:18px">
        <div class="ct-titre-sec" style="margin-top:0"><h3>Adversaires</h3><span class="cb-puce">${m.pvp_restants} défi${m.pvp_restants > 1 ? 's' : ''} restant${m.pvp_restants > 1 ? 's' : ''} aujourd'hui</span></div>
        <div class="cb-liste" data-adv><div class="ct-vide" style="padding:20px">Chargement…</div></div>
      </section>`;
    hote.querySelector('[data-defense]').addEventListener('click', async () => {
      const r = await equipeModal({ titre: 'Ma défense', sansOptions: true, confirmer: 'Valider ma défense', duo: def });
      if(!r) return;
      try{
        a.defense = await api.appel('combat_duo_enregistrer', { p_role: 'defense', p_duo: r.duo });
        api.toast('Défense enregistrée.');
        vuePvp(hote, api);
      }catch(e){ api.toast(e.message, 'err'); }
    });
    api.appel('combat_adversaires').then((liste) => {
      const z = hote.querySelector('[data-adv]');
      if(!z) return;
      z.innerHTML = liste.length ? liste.map((o, i) => `
        <div class="cb-ligne">
          <div class="cb-portraits">${o.avatar ? `<img class="cb-avatar" src="${esc(api.safeUrl(o.avatar))}" alt="">` : ''}</div>
          <div><h4>${esc(o.pseudo)} · ${nf(o.trophees)} ${api.ico('trophee', 13)}</h4>
            <p>${o.duo.map((c) => `${esc(c.nom)} ${chip(c.type_nom, c.couleur)}`).join(' &nbsp;·&nbsp; ')}</p></div>
          <button type="button" class="ct-btn petit principal" data-defier="${i}" ${m.pvp_restants < 1 ? 'disabled' : ''}>Défier</button>
        </div>`).join('')
        : '<div class="ct-panneau ct-vide"><b>Personne à défier pour l\'instant</b>Les autres joueurs doivent d\'abord régler leur défense.</div>';
      z.querySelectorAll('[data-defier]').forEach((b) => b.addEventListener('click', () => {
        const o = liste[Number(b.dataset.defier)];
        api.lancerCombat({ mode: 'pvp', cible: o.user_id, titre: 'Défi · ' + o.pseudo, adversaires: o.duo });
      }));
    }).catch(() => {
      const z = hote.querySelector('[data-adv]');
      if(z) z.innerHTML = '<div class="ct-panneau ct-vide">Impossible de charger les adversaires.</div>';
    });
  }

  async function vueClassement(corps){
    corps.innerHTML = '<div class="ct-vide">Chargement…</div>';
    try{
      const r = await A.appel('combat_classement');
      corps.innerHTML = `
        <div class="ct-titre-sec" style="margin-top:0"><h3>Classement · saison ${esc(r.saison)}</h3></div>
        ${r.liste.length ? `<div class="cb-liste">${r.liste.map((j) => `
          <div class="cb-ligne${j.moi ? ' moi' : ''}"><div class="cb-n">${j.rang}</div>
            <div style="display:flex; align-items:center; gap:12px; min-width:0">${j.avatar ? `<img class="cb-avatar" src="${esc(A.safeUrl(j.avatar))}" alt="" loading="lazy">` : '<span class="cb-avatar"></span>'}
              <div><h4>${esc(j.pseudo)}${j.moi ? ' (toi)' : ''}</h4><p>${j.victoires} victoire${j.victoires > 1 ? 's' : ''} · ${j.defaites} défaite${j.defaites > 1 ? 's' : ''}</p></div></div>
            <b style="display:inline-flex; align-items:center; gap:5px; font-variant-numeric:tabular-nums">${A.ico('trophee', 15)}${nf(j.trophees)}</b></div>`).join('')}</div>`
          : '<div class="ct-panneau ct-vide"><b>Personne n\'est encore classé</b>Remporte un défi contre un autre joueur pour ouvrir le classement de la saison.</div>'}`;
    }catch(e){
      corps.innerHTML = `<div class="ct-panneau ct-vide">${esc(e.message)}</div>`;
    }
  }

  async function vueHistorique(corps){
    corps.innerHTML = '<div class="ct-vide">Chargement…</div>';
    try{
      const l = await A.appel('combat_historique');
      const lib = { victoire: 'Victoire', defaite: 'Défaite', abandon: 'Abandon', expire: 'Expiré' };
      corps.innerHTML = `
        <div class="ct-titre-sec" style="margin-top:0"><h3>Mes derniers combats</h3></div>
        ${l.length ? `<div class="cb-liste">${l.map((h) => `
          <div class="cb-ligne"><span class="cb-res ${esc(h.etat)}">${lib[h.etat] || ''}</span>
            <div><h4>${esc(h.adversaire)}</h4><p>${esc((h.duo || []).join(' & '))} contre ${esc((h.face || []).join(' & '))} · ${h.tours} tour${h.tours > 1 ? 's' : ''} · ${new Date(h.debut).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}</p></div>
            <div style="text-align:right">${h.trophees_delta ? `<span class="cb-delta ${h.trophees_delta > 0 ? 'p' : 'm'}">${signe(h.trophees_delta)} ${A.ico('trophee', 12)}</span>` : ''}${h.gains && h.gains.vinyles ? `<div class="cb-puce or" style="margin-top:4px">+${h.gains.vinyles} vinyle${h.gains.vinyles > 1 ? 's' : ''}</div>` : ''}</div></div>`).join('')}</div>`
          : '<div class="ct-panneau ct-vide"><b>Aucun combat pour l\'instant</b>Lance un entraînement pour commencer.</div>'}`;
    }catch(e){
      corps.innerHTML = `<div class="ct-panneau ct-vide">${esc(e.message)}</div>`;
    }
  }

  // ---------------------------------------------------------------------
  // La composition d'équipe : 2 cartes, ordre, équipes enregistrées, équipe auto, Auto / Manuel, cible présélectionnée
  // ---------------------------------------------------------------------

  const cleCarte = (c) => c.booster + '|' + c.artist_id + '|' + (c.holo ? 1 : 0);

  // Les 2 cartes les plus fortes, en cherchant des rôles qui se complètent et l'avantage de style face aux adversaires.
  function equipeAuto(cartes, advTypes){
    const score = (c) => (c.pv * 0.8 + c.pui * 1.6 + c.def + c.vit) * (1 + c.rarete * 0.08) * (advTypes.length && (c.forces || []).some((t) => advTypes.includes(t.id)) ? 1.2 : 1)
      * (advTypes.length && (c.faiblesses || []).some((t) => advTypes.includes(t.id)) ? 0.85 : 1);
    const l = cartes.slice().sort((a, b) => score(b) - score(a));
    if(l.length < 2) return l.map(cleCarte);
    const p = l[0];
    const s = l.slice(1).find((c) => c.artist_id !== p.artist_id && c.role !== p.role && score(c) >= score(l[1]) * 0.8) || l.slice(1).find((c) => c.artist_id !== p.artist_id) || l[1];
    return [cleCarte(p), cleCarte(s)];
  }

  // Ouvre la fenêtre de composition. Renvoie (promesse) { duo:[{booster, artist, holo}], auto, cible } ou null si on annule.
  // o : { titre, taille:2, adversaires:[{nom, photo, type, type_nom, couleur, role_nom}], duo:[infos de cartes], auto, confirmer, sansOptions }
  function equipeModal(o){
    o = o || {};
    return new Promise((resolve) => { equipeModalInterne(o, resolve).catch((e) => { A.toast(e.message, 'err'); resolve(null); }); });
  }

  async function equipeModalInterne(o, resolve){
    if(!A) throw new Error('Le combat n\'est pas encore prêt.');
    if(o.taille && o.taille !== 2) throw new Error('Seules les équipes de 2 cartes sont gérées pour l\'instant.');
    const [cartes, sauves0] = await Promise.all([A.appel('combat_mes_cartes'), A.appel('combat_duos_lire').catch(() => [])]);
    if(!S.acc) await chargerAcc().catch(() => {});
    if(cartes.length < 2){ A.toast('Il te faut au moins 2 cartes pour former une équipe : ouvre des boosters !', 'err'); resolve(null); return; }

    const adv = (o.adversaires || []).filter(Boolean);
    const advTypes = adv.map((a) => a.type).filter(Boolean);
    const dispo = (k) => cartes.some((c) => cleCarte(c) === k);
    const carte = (k) => cartes.find((c) => cleCarte(c) === k);
    let sauves = sauves0;
    let choix = [null, null];
    const depart = o.duo || (S.acc && S.acc.duo) || [];
    depart.forEach((c, i) => { const k = cleCarte({ booster: c.booster, artist_id: c.artist_id || c.artist, holo: c.holo }); if(i < 2 && dispo(k)) choix[i] = k; });
    if(!choix[0] && !choix[1]) choix = equipeAuto(cartes, advTypes).concat([null, null]).slice(0, 2);
    let auto = o.auto !== undefined && o.auto !== null ? !!o.auto : stock.lire('wc-cb-auto', '0') === '1';
    let cible = stock.lire('wc-cb-cible', '0'); cible = cible === 'x' ? null : Math.min(Number(cible) || 0, 1);
    const f = { q: '', type: null, role: null, tri: advTypes.length ? 'efficacite' : 'rarete' };
    let fini = false;

    const types = [], roles = [];
    cartes.forEach((c) => {
      if(!types.some((t) => t.id === c.type)) types.push({ id: c.type, nom: c.type_nom, c: c.couleur });
      if(c.role && !roles.some((t) => t.id === c.role)) roles.push({ id: c.role, nom: c.role_nom });
    });
    const fen = A.fenetre(`
      <h2>${esc(o.titre || 'Mon équipe')}</h2>
      <p class="sous">Choisis 2 cartes. Touche pour choisir, glisse une carte sur un emplacement ou utilise les flèches pour l'ordre, ⓘ pour la fiche.</p>
      ${adv.length ? `<div class="cb-eq-face"><b>Face à</b>${adv.map((a) => `<span class="adv" style="--tc:${couleur(a.couleur)}">${a.photo ? `<img src="${esc(A.safeUrl(a.photo))}" alt="">` : ''}<span>${esc(a.nom || 'Adversaire')} ${a.type_nom ? chip(a.type_nom, a.couleur) : ''}</span></span>`).join('')}</div>` : ''}
      <div class="cb-eq-slots" data-slots></div>
      <div class="cb-eq-barre"><button type="button" class="ct-btn petit" data-auto-eq>Équipe auto</button><button type="button" class="ct-btn petit" data-inverse>⇄ Inverser</button><button type="button" class="ct-btn petit" data-enreg>Enregistrer cette équipe</button><span class="cb-slot-i" data-eff></span></div>
      <div class="cb-eq-enreg" data-enreg-zone><select data-ex-slot aria-label="Emplacement"></select><input type="text" maxlength="30" placeholder="Nom de l'équipe" data-ex-nom aria-label="Nom de l'équipe"><button type="button" class="ct-btn petit principal" data-ex-ok>Enregistrer</button><button type="button" class="ct-btn petit" data-ex-sup>Supprimer</button></div>
      <div class="cb-eq-sauves" data-sauves aria-label="Équipes enregistrées"></div>
      <div class="cb-sel-tete">
        <input type="search" placeholder="Chercher un artiste" data-q aria-label="Chercher un artiste">
        <select data-tri aria-label="Trier"><option value="rarete">Rareté</option>${advTypes.length ? '<option value="efficacite">Avantage de style</option>' : ''}<option value="pv">PV</option><option value="pui">Puissance</option><option value="def">Défense</option><option value="vit">Vitesse</option><option value="nom">Nom (A–Z)</option></select>
      </div>
      <div class="cb-filtres" role="group" aria-label="Style">${types.map((t) => `<button type="button" data-t="${esc(t.id)}" style="--tc:${couleur(t.c)}" aria-pressed="false">${esc(t.nom)}</button>`).join('')}</div>
      <div class="cb-filtres" role="group" aria-label="Rôle">${roles.map((t) => `<button type="button" data-r="${esc(t.id)}" aria-pressed="false">${esc(t.nom)}</button>`).join('')}</div>
      <div class="cb-grille" data-grille></div>
      ${o.sansOptions ? '' : `<div class="cb-eq-options">
        <div class="cb-eq-opt"><span>Mode de combat</span><div class="cb-seg mini" data-seg-mode><button type="button" data-v="auto" aria-pressed="false">Auto</button><button type="button" data-v="manuel" aria-pressed="false">Manuel</button></div></div>
        <div class="cb-eq-opt"><span>Cible présélectionnée</span><div class="cb-seg mini" data-seg-cible>${[0, 1].map((i) => `<button type="button" data-v="${i}" aria-pressed="false">${esc(adv[i] && adv[i].nom ? adv[i].nom : 'Adversaire ' + (i + 1))}</button>`).join('')}<button type="button" data-v="x" aria-pressed="false">Aucune</button></div></div>
      </div>`}
      <div class="cb-sel-pied"><div class="cb-sel-choix" data-resume-eq></div><button type="button" class="ct-btn" data-annuler>Annuler</button><button type="button" class="ct-btn principal" data-valider disabled>${esc(o.confirmer || 'Combattre')}</button></div>`, true, () => { if(!fini){ fini = true; resolve(null); } });

    const corps = fen.corps;
    const grille = corps.querySelector('[data-grille]');
    const efficace = (c) => advTypes.length ? ((c.forces || []).some((t) => advTypes.includes(t.id)) ? 1 : (c.faiblesses || []).some((t) => advTypes.includes(t.id)) ? -1 : 0) : 0;

    const dessineSlots = () => {
      corps.querySelector('[data-slots]').innerHTML = [0, 1].map((i) => {
        const c = choix[i] ? carte(choix[i]) : null;
        if(!c) return `<div class="cb-eq-slot" data-slot="${i}"><span class="cb-eq-poignee">${i + 1}</span><div class="vide">Emplacement ${i + 1}<br>glisse une carte ici</div></div>`;
        return `<div class="cb-eq-slot rempli" data-slot="${i}" draggable="true" data-sk="${esc(choix[i])}" style="--tc:${couleur(c.couleur)}">
          <span class="cb-eq-poignee">${i + 1}</span>
          <img src="${esc(A.safeUrl(c.photo))}" alt="">
          <div><b>${esc(c.nom)}</b><div class="cb-roles">${chip(c.type_nom, c.couleur)}${roleChip(c.role_nom)}</div><small>PV ${nf(c.pv)} · PUI ${nf(c.pui)} · DÉF ${nf(c.def)} · VIT ${nf(c.vit)}</small></div>
          <div class="cb-eq-ordre"><button type="button" data-move="-1" aria-label="Avant" ${i === 0 ? 'disabled' : ''}>◀</button><button type="button" data-move="1" aria-label="Après" ${i === 1 ? 'disabled' : ''}>▶</button><button type="button" data-ote="${i}" aria-label="Retirer ${esc(c.nom)}">✕</button></div></div>`;
      }).join('');
      const cs = choix.map((k) => k && carte(k)).filter(Boolean);
      const sup = advTypes.length && cs.length ? cs.filter((c) => efficace(c) > 0).length : 0;
      const eff = corps.querySelector('[data-eff]');
      eff.innerHTML = advTypes.length && cs.length ? (sup ? `<span class="cb-puce ok">▲ ${sup} carte${sup > 1 ? 's' : ''} super efficace${sup > 1 ? 's' : ''}</span>` : '<span class="cb-puce">Aucun avantage de style</span>') : '';
      const ch = corps.querySelector('[data-resume-eq]');
      ch.innerHTML = cs.length === 2 ? cs.map((c) => `<div style="border-left:3px solid ${couleur(c.couleur)}"><b>${esc(c.nom)}</b>${esc(c.role_nom || '')} · ${esc(c.type_nom)}${c.capacite ? ' · passif ' + esc(c.capacite.nom) : ''}</div>`).join('') : 'Choisis 2 cartes.';
      corps.querySelector('[data-valider]').disabled = cs.length !== 2;
    };

    const dessineGrille = () => {
      const y = grille.scrollTop;
      const q = f.q.trim().toLowerCase();
      let l = cartes.filter((c) => (!f.type || c.type === f.type) && (!f.role || c.role === f.role) && (!q || c.nom.toLowerCase().includes(q)));
      const cmp = { rarete: (a, b) => b.rarete - a.rarete || b.pv - a.pv, efficacite: (a, b) => efficace(b) - efficace(a) || b.rarete - a.rarete, pv: (a, b) => b.pv - a.pv, pui: (a, b) => b.pui - a.pui, def: (a, b) => b.def - a.def, vit: (a, b) => b.vit - a.vit, nom: (a, b) => a.nom.localeCompare(b.nom, 'fr') }[f.tri];
      l = l.slice().sort(cmp);
      grille.innerHTML = l.length ? l.map((c) => {
        const k = cleCarte(c), i = choix.indexOf(k), e = efficace(c);
        return `<button type="button" class="cb-tuile" draggable="true" data-k="${esc(k)}" aria-pressed="${i >= 0}" aria-label="${esc(c.nom)}, ${esc(c.type_nom)}, ${esc(c.role_nom || '')}">
          <span class="num">${i + 1}</span><span class="info" data-info="${esc(k)}" role="button" aria-label="Fiche de ${esc(c.nom)}">i</span>
          ${e ? `<span class="eff${e < 0 ? ' faible' : ''}">${e > 0 ? '▲ super' : '▼ faible'}</span>` : ''}
          ${A.carteHtml({ nom: c.nom, photo: c.photo, rarete: c.rarete, holo: c.holo, numero: c.numero }, {})}
          <span class="t">${chip(c.type_nom, c.couleur)}${roleChip(c.role_nom)}<span>PV ${nf(c.pv)}</span><span>PUI ${nf(c.pui)}</span></span></button>`;
      }).join('') : '<div class="ct-vide" style="grid-column:1/-1">Aucune carte ne correspond.</div>';
      grille.scrollTop = y;
      corps.querySelectorAll('.cb-filtres [data-t]').forEach((b) => b.setAttribute('aria-pressed', String(f.type === b.dataset.t)));
      corps.querySelectorAll('.cb-filtres [data-r]').forEach((b) => b.setAttribute('aria-pressed', String(f.role === b.dataset.r)));
    };

    const dessineSauves = () => {
      const z = corps.querySelector('[data-sauves]');
      z.innerHTML = [1, 2, 3, 4, 5].map((n) => {
        const s = sauves.find((x) => x.slot === n);
        if(!s) return `<button type="button" class="cb-eq-sauve vide" data-sl="${n}" aria-label="Emplacement ${n} vide"><b>${n}</b>vide</button>`;
        const ok = (s.cartes || []).length === 2 && s.cartes.every(Boolean);
        return `<button type="button" class="cb-eq-sauve${ok ? '' : ' cassee'}" data-sl="${n}" aria-label="Équipe ${esc(s.nom)}"><b>${esc(s.nom)}</b><i>${(s.cartes || []).map((c) => c ? `<img src="${esc(A.safeUrl(c.photo))}" alt="">` : '').join('')}</i></button>`;
      }).join('');
      const sel = corps.querySelector('[data-ex-slot]');
      sel.innerHTML = [1, 2, 3, 4, 5].map((n) => { const s = sauves.find((x) => x.slot === n); return `<option value="${n}">${n} · ${s ? esc(s.nom) : 'libre'}</option>`; }).join('');
    };

    const dessineOptions = () => {
      const m = corps.querySelector('[data-seg-mode]');
      if(m) m.querySelectorAll('[data-v]').forEach((b) => b.setAttribute('aria-pressed', String((b.dataset.v === 'auto') === auto)));
      const c = corps.querySelector('[data-seg-cible]');
      if(c) c.querySelectorAll('[data-v]').forEach((b) => b.setAttribute('aria-pressed', String(String(cible === null ? 'x' : cible) === b.dataset.v)));
    };

    const placer = (k, i) => {
      const autre = choix.indexOf(k);
      if(autre >= 0 && autre !== i){ choix[autre] = choix[i]; }
      choix[i] = k;
      dessineSlots(); dessineGrille();
    };

    dessineSlots(); dessineGrille(); dessineSauves(); dessineOptions();

    grille.addEventListener('click', (ev) => {
      const inf = ev.target.closest('[data-info]');
      if(inf){ ev.stopPropagation(); const c = carte(inf.dataset.info); A.fiche(c.artist_id, c.booster); return; }
      const t = ev.target.closest('[data-k]');
      if(!t) return;
      const k = t.dataset.k, i = choix.indexOf(k);
      if(i >= 0) choix[i] = null;
      else if(choix[0] === null) choix[0] = k;
      else if(choix[1] === null) choix[1] = k;
      else { choix[0] = choix[1]; choix[1] = k; }
      dessineSlots(); dessineGrille();
    });
    grille.addEventListener('dragstart', (ev) => { const t = ev.target.closest('[data-k]'); if(t){ ev.dataTransfer.setData('text/plain', t.dataset.k); ev.dataTransfer.effectAllowed = 'move'; } });
    const zoneSlots = corps.querySelector('[data-slots]');
    zoneSlots.addEventListener('dragstart', (ev) => { const t = ev.target.closest('[data-sk]'); if(t){ ev.dataTransfer.setData('text/plain', t.dataset.sk); ev.dataTransfer.effectAllowed = 'move'; } });
    zoneSlots.addEventListener('dragover', (ev) => { const s = ev.target.closest('[data-slot]'); if(s){ ev.preventDefault(); zoneSlots.querySelectorAll('.survol').forEach((x) => x.classList.remove('survol')); s.classList.add('survol'); } });
    zoneSlots.addEventListener('dragleave', (ev) => { const s = ev.target.closest('[data-slot]'); if(s) s.classList.remove('survol'); });
    zoneSlots.addEventListener('drop', (ev) => {
      const s = ev.target.closest('[data-slot]');
      if(!s) return;
      ev.preventDefault();
      const k = ev.dataTransfer.getData('text/plain');
      if(dispo(k)) placer(k, Number(s.dataset.slot)); else dessineSlots();
    });
    zoneSlots.addEventListener('click', (ev) => {
      const mv = ev.target.closest('[data-move]');
      if(mv){
        const slot = Number(mv.closest('[data-slot]').dataset.slot), j = slot + Number(mv.dataset.move);
        if(j >= 0 && j <= 1){ const t = choix[slot]; choix[slot] = choix[j]; choix[j] = t; dessineSlots(); dessineGrille(); }
        return;
      }
      const ot = ev.target.closest('[data-ote]');
      if(ot){ choix[Number(ot.dataset.ote)] = null; dessineSlots(); dessineGrille(); }
    });

    corps.querySelector('[data-q]').addEventListener('input', (ev) => { f.q = ev.target.value; dessineGrille(); });
    const tri = corps.querySelector('[data-tri]');
    tri.value = f.tri;
    tri.addEventListener('change', (ev) => { f.tri = ev.target.value; dessineGrille(); });
    corps.querySelectorAll('.cb-filtres [data-t]').forEach((b) => b.addEventListener('click', () => { f.type = f.type === b.dataset.t ? null : b.dataset.t; dessineGrille(); }));
    corps.querySelectorAll('.cb-filtres [data-r]').forEach((b) => b.addEventListener('click', () => { f.role = f.role === b.dataset.r ? null : b.dataset.r; dessineGrille(); }));
    corps.querySelector('[data-auto-eq]').addEventListener('click', () => { choix = equipeAuto(cartes, advTypes); dessineSlots(); dessineGrille(); });
    corps.querySelector('[data-inverse]').addEventListener('click', () => { choix = [choix[1], choix[0]]; dessineSlots(); dessineGrille(); });

    const enreg = corps.querySelector('[data-enreg-zone]');
    corps.querySelector('[data-enreg]').addEventListener('click', () => enreg.classList.toggle('ouvert'));
    corps.querySelector('[data-sauves]').addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-sl]');
      if(!b) return;
      const s = sauves.find((x) => x.slot === Number(b.dataset.sl));
      if(!s){ enreg.classList.add('ouvert'); corps.querySelector('[data-ex-slot]').value = b.dataset.sl; return; }
      const ks = (s.duo || []).map((d) => cleCarte({ booster: d.booster, artist_id: d.artist, holo: d.holo }));
      if(ks.length !== 2 || !ks.every(dispo)){ A.toast('Une carte de cette équipe n\'est plus dans ta collection.', 'err'); return; }
      choix = ks;
      corps.querySelectorAll('.cb-eq-sauve').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      corps.querySelector('[data-ex-slot]').value = String(s.slot);
      corps.querySelector('[data-ex-nom]').value = s.nom;
      dessineSlots(); dessineGrille();
    });
    const duoActuel = () => choix.map((k) => { const c = carte(k); return { booster: c.booster, artist: c.artist_id, holo: !!c.holo }; });
    corps.querySelector('[data-ex-ok]').addEventListener('click', async (ev) => {
      if(choix.some((k) => !k)){ A.toast('Choisis d\'abord 2 cartes.', 'err'); return; }
      ev.currentTarget.disabled = true;
      try{
        sauves = await A.appel('combat_duo_sauver', { p_slot: Number(corps.querySelector('[data-ex-slot]').value), p_nom: corps.querySelector('[data-ex-nom]').value, p_duo: duoActuel() });
        dessineSauves(); A.toast('Équipe enregistrée.');
      }catch(e){ A.toast(e.message, 'err'); }
      ev.currentTarget.disabled = false;
    });
    corps.querySelector('[data-ex-sup]').addEventListener('click', async (ev) => {
      const slot = Number(corps.querySelector('[data-ex-slot]').value);
      if(!sauves.some((x) => x.slot === slot)) return;
      ev.currentTarget.disabled = true;
      try{ sauves = await A.appel('combat_duo_supprimer', { p_slot: slot }); dessineSauves(); A.toast('Équipe supprimée.'); }
      catch(e){ A.toast(e.message, 'err'); }
      ev.currentTarget.disabled = false;
    });

    const sm = corps.querySelector('[data-seg-mode]');
    if(sm) sm.addEventListener('click', (ev) => { const b = ev.target.closest('[data-v]'); if(b){ auto = b.dataset.v === 'auto'; stock.ecrire('wc-cb-auto', auto ? '1' : '0'); dessineOptions(); } });
    const sc = corps.querySelector('[data-seg-cible]');
    if(sc) sc.addEventListener('click', (ev) => { const b = ev.target.closest('[data-v]'); if(b){ cible = b.dataset.v === 'x' ? null : Number(b.dataset.v); stock.ecrire('wc-cb-cible', b.dataset.v); dessineOptions(); } });

    corps.querySelector('[data-annuler]').addEventListener('click', () => fen.fermer());
    corps.querySelector('[data-valider]').addEventListener('click', () => {
      if(choix.some((k) => !k)) return;
      const duo = duoActuel();
      fini = true;
      fen.fermer();
      resolve({ duo, infos: choix.map(carte), auto, cible });
    });
  }

  // ---------------------------------------------------------------------
  // Lancer, reprendre et abandonner un combat
  // ---------------------------------------------------------------------

  // Lance un combat : choix de l'équipe (sauf si o.choix ou o.partie), création côté serveur, puis écran de combat.
  // Voir la documentation en tête de fichier.
  async function lancerCombat(o){
    o = o || {};
    if(!A) throw new Error('Le combat n\'est pas encore prêt : ouvre d\'abord l\'onglet Combat.');
    if(!o.partie){
      if(!S.acc){ try{ await chargerAcc(); }catch(e){ /* on tentera quand même */ } }
      if(S.acc && S.acc.en_cours){ A.toast('Un combat est déjà en cours : reprends-le ou abandonne-le.', 'err'); return null; }
    }
    let choix = o.choix || null;
    if(!o.partie && !choix){
      choix = await equipeModal({ titre: o.titre || 'Combat', adversaires: o.adversaires, duo: o.duo, auto: o.options ? o.options.auto : undefined, confirmer: o.confirmer || 'Combattre' });
      if(!choix) return null;
    }
    try{
      let partie = o.partie;
      if(!partie){
        const opts = Object.assign({}, o.options || {}, { auto: !!choix.auto });
        if(o.rpc) partie = await A.appel(o.rpc, Object.assign({}, o.params || {}, { p_duo: choix.duo, p_options: opts }));
        else partie = await A.appel('combat_lancer', { p_mode: o.mode, p_cible: o.cible === null || o.cible === undefined ? null : String(o.cible), p_duo: choix.duo, p_options: opts });
      }
      if(S.acc) S.acc.en_cours = null;
      ouvrirScene(partie, { o, choix });
      return partie;
    }catch(e){
      A.toast(e.message, 'err');
      rafraichir();
      return null;
    }
  }

  function confirmerAbandon(partie, depuisScene){
    const f = A.fenetre(`
      <h2>Abandonner le combat ?</h2>
      <p class="sous">${partie.mode === 'arene_classee' ? "En Arène classée, un abandon compte comme une défaite : tu perds des points d'arène et le ticket d'attaque est consommé." : partie.mode === 'pvp' ? 'Contre un joueur, un abandon compte comme une défaite et te coûte des trophées.' : 'Tu ne perds aucune carte. Tu pourras relancer un combat quand tu veux.'}</p>
      <div class="ct-actions" style="justify-content:flex-end; margin-top:18px"><button type="button" class="ct-btn" data-non>Continuer</button><button type="button" class="ct-btn principal" data-oui>Abandonner</button></div>`);
    f.corps.querySelector('[data-non]').addEventListener('click', f.fermer);
    const oui = f.corps.querySelector('[data-oui]');
    oui.addEventListener('click', async () => {
      oui.disabled = true;
      try{
        await A.appel('combat_abandonner', { p_id: partie.id });
        f.fermer();
        if(depuisScene) fermerScene();
        A.toast('Combat abandonné.');
        rafraichir();
      }catch(e){ A.toast(e.message, 'err'); oui.disabled = false; }
    });
  }

  // ---------------------------------------------------------------------
  // Les décors : studio, concert, plateau, ruelle, toit (CSS + SVG animés)
  // ---------------------------------------------------------------------

  // Chaque décor : une image pixel-art (img/combat/<id>.png) et la couleur de ses deux faisceaux de lumière qui balaient la salle.
  const DECORS = {
    concert: { img: 'concert', lum: ['#ff3fa4', '#35e0ff'] },
    studio: { img: 'studio', lum: ['#ffb347', '#ff3fa4'] },
    plateau: { img: 'plateau', lum: ['#9be8ff', '#ffffff'] },
    ruelle: { img: 'ruelle', lum: ['#ffb347', '#7be0a6'] },
    toit: { img: 'toit', lum: ['#ffd36b', '#ff7a9c'] }
  };

  const decorHtml = (id) => {
    const d = DECORS[id] || DECORS.concert;
    return `<img class="cb-fond" src="img/combat/${d.img}.png" alt="" draggable="false" decoding="async">
      <span class="cb-lum a" style="--lc:${d.lum[0]}"></span><span class="cb-lum b" style="--lc:${d.lum[1]}"></span>`;
  };

  // ---------------------------------------------------------------------
  // L'écran de combat
  // ---------------------------------------------------------------------

  function fermerScene(){
    const sc = S.scene;
    if(!sc) return;
    S.scene = null;
    sc.fin = true;
    document.removeEventListener('keydown', sc.touche);
    clearTimeout(sc.appui);
    sc.ov.remove();
    if(!document.querySelector('.ct-voile, .ct-scene')) document.documentElement.style.overflow = sc.avant;
  }

  const nomMode = (m) => { const r = S.modes.find((x) => x.id === m); return r ? r.titre : (m === 'pvp' ? 'Défi entre joueurs' : ''); };

  function ouvrirScene(partie, ctx){
    if(S.scene) fermerScene();
    const U = JSON.parse(JSON.stringify(partie.unites));
    const sc = { id: partie.id, partie, ctx: ctx || {}, U, jeu: partie.jeu || { n: 0, actif: null, auto: false }, ordre: partie.ordre || [], auto: !!(partie.jeu && partie.jeu.auto),
                 rapide: false, occupe: false, fin: false, choix: null, texte: '', presel: null, nflot: 0, avant: document.documentElement.style.overflow };
    const cibleDef = ctx && ctx.choix && ctx.choix.cible !== null && ctx.choix.cible !== undefined ? 2 + Number(ctx.choix.cible) : null;
    sc.presel = cibleDef;
    S.scene = sc;

    const ov = document.createElement('div');
    ov.className = 'ct-scene cb-scene';
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    ov.setAttribute('aria-label', 'Combat');
    ov.innerHTML = `
      <div class="cb-decor" data-decor>${decorHtml(partie.decor)}</div>
      <header class="cb-s-tete"><div><small>${esc(nomMode(partie.mode))}</small><b>${esc(partie.titre || partie.adversaire)}</b></div>
        <button type="button" class="cb-mini" data-auto aria-pressed="${sc.auto}" title="Laisser l'ordinateur jouer à ta place">AUTO</button>
        <button type="button" class="cb-mini" data-vite aria-pressed="false" title="Animations deux fois plus rapides">×2</button>
        <button type="button" class="cb-mini texte" data-abandon>Abandonner</button>
        <button type="button" class="cb-mini" data-quitter aria-label="Quitter l'écran (le combat reste en cours)">✕</button></header>
      <div class="cb-frise" data-frise aria-label="Ordre des prochains tours"></div>
      <div class="cb-champ">
        <div class="cb-rangee" data-rang="1"></div>
        <div class="cb-rangee" data-rang="0"></div>
      </div>
      <div class="cb-bandeau" data-bandeau><span></span></div>
      <div class="cb-panneau"><div class="cb-pan-in" data-pan></div></div>`;
    document.documentElement.style.overflow = 'hidden';
    document.body.appendChild(ov);
    sc.ov = ov;

    sc.touche = (ev) => {
      if(document.querySelector('.ct-voile')) return;
      if(ev.key === 'Escape'){ quitterScene(); return; }
      if(ev.key === 'i' || ev.key === 'I'){ const u = sc.U[sc.jeu.actif !== null && sc.jeu.actif !== undefined ? sc.jeu.actif : (sc.presel !== null ? sc.presel : 0)]; if(u) ficheUnite(u); return; }
      if(['1', '2', '3'].includes(ev.key)) choisirTech(sc, Number(ev.key) - 1);
    };
    document.addEventListener('keydown', sc.touche);

    const quitterScene = () => { fermerScene(); rafraichir(); };
    ov.querySelector('[data-quitter]').addEventListener('click', quitterScene);
    ov.querySelector('[data-abandon]').addEventListener('click', () => { if(!sc.fin) confirmerAbandon({ id: sc.id, mode: partie.mode }, true); });
    const bAuto = ov.querySelector('[data-auto]');
    bAuto.addEventListener('click', () => {
      sc.auto = !sc.auto;
      bAuto.setAttribute('aria-pressed', String(sc.auto));
      A.toast(sc.auto ? 'Mode Auto : l\'ordinateur joue pour toi.' : 'Mode manuel : tu reprends la main au prochain tour.');
      if(sc.auto && !sc.occupe && !sc.fin) pas(sc, null);
      else dessinerPanneau(sc);
    });
    const vite = ov.querySelector('[data-vite]');
    vite.addEventListener('click', () => { sc.rapide = !sc.rapide; vite.setAttribute('aria-pressed', String(sc.rapide)); });

    sc.redim = () => {};
    [2, 3].forEach((i) => ov.querySelector('[data-rang="1"]').appendChild(tuile(sc, i)));
    [0, 1].forEach((i) => ov.querySelector('[data-rang="0"]').appendChild(tuile(sc, i)));
    majTout(sc);
    A.Son.jouer('volte');

    (async () => {
      const neuf = !(ctx && ctx.reprise) && (!sc.jeu.n);
      if(neuf && stock.lire('wc-cb-tuto', '0') !== '1') await tutoriel(sc);
      if(sc.fin) return;
      if(attend(sc)) dessinerPanneau(sc); else pas(sc, null);
    })();
  }

  const attend = (sc) => !sc.fin && !sc.occupe && !sc.auto && sc.jeu.actif !== null && sc.jeu.actif !== undefined && sc.U[sc.jeu.actif] && !sc.U[sc.jeu.actif].ko;
  const elTuile = (sc, i) => sc.ov.querySelector(`.cb-u[data-u="${i}"]`);
  const pause = (sc, ms) => attendre(calme() ? Math.min(ms, 50) : sc.rapide ? ms * 0.45 : ms);
  const vivants = (sc, camp) => sc.U.map((u, i) => i).filter((i) => sc.U[i].camp === camp && !sc.U[i].ko);

  function tuile(sc, i){
    const u = sc.U[i];
    const d = document.createElement('div');
    d.className = 'cb-u ' + (u.camp === 0 ? 'allie' : 'ennemi');
    d.dataset.u = String(i);
    d.tabIndex = 0;
    d.setAttribute('role', 'button');
    d.setAttribute('aria-label', u.nom + ', ' + (u.role_nom || '') + '. Appui long ou touche I : fiche.');
    d.style.setProperty('--tc', couleur(u.couleur));
    d.innerHTML = `
      <div class="cb-u-vis"><div class="cb-u-cadre"><img src="${esc(A.safeUrl(u.photo))}" alt=""></div><span class="cb-u-role">${esc(u.role_nom || '')}</span><span class="cb-ko">K.O.</span></div>
      <div class="cb-u-nom"><span>${esc(u.nom)}</span></div>
      <div class="cb-pv" data-pv><i></i><b></b></div>
      <div class="cb-jauge" data-jauge><i></i></div>
      <div class="cb-badges" data-badges></div>`;
    d.addEventListener('click', () => cliquerUnite(sc, i));
    d.addEventListener('keydown', (ev) => { if(ev.key === 'Enter' || ev.key === ' '){ ev.preventDefault(); cliquerUnite(sc, i); } });
    d.addEventListener('pointerdown', () => { clearTimeout(sc.appui); sc.appui = setTimeout(() => { sc.appuiFait = true; ficheUnite(sc.U[i]); }, 520); });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((n) => d.addEventListener(n, () => clearTimeout(sc.appui)));
    d.addEventListener('contextmenu', (ev) => ev.preventDefault());
    return d;
  }

  const LIB_STAT = { 'pui+': 'PUI', 'pui-': 'PUI', 'def+': 'DÉF', 'def-': 'DÉF', 'vit+': 'VIT', 'vit-': 'VIT' };

  function badgesHtml(u){
    return (u.statuts || []).map((s) => {
      const d = STAT[s.k] || { c: s.k, n: s.k, t: 'neutre' };
      const val = s.k === 'bouclier' ? ' ' + Math.round(s.v) : '';
      return `<span class="${d.t}" title="${esc(d.n)} · ${s.d} tour${s.d > 1 ? 's' : ''}">${esc(d.c)}${esc(val)}<i>${s.d}</i></span>`;
    }).join('');
  }

  function majTuile(sc, i){
    const d = elTuile(sc, i);
    if(!d) return;
    const u = sc.U[i], p = pct(u.pv, u.pv_max);
    d.classList.toggle('ko', !!u.ko);
    d.classList.toggle('actif', (sc.actifIdx === i || (!sc.occupe && sc.jeu.actif === i)) && !u.ko);
    d.classList.toggle('presel', sc.presel === i && !u.ko && u.camp === 1);
    const b = d.querySelector('[data-pv]');
    b.classList.toggle('mid', p <= 50 && p > 25);
    b.classList.toggle('bas', p <= 25);
    b.querySelector('i').style.width = p + '%';
    b.querySelector('b').textContent = Math.round(u.pv) + ' / ' + Math.round(u.pv_max);
    const j = d.querySelector('[data-jauge]');
    const jv = u.ko ? 0 : Math.max(0, Math.min(100, Number(u.jauge) || 0));
    j.querySelector('i').style.width = jv + '%';
    j.classList.toggle('pleine', jv >= 99.9 && !u.ko);
    d.querySelector('[data-badges]').innerHTML = badgesHtml(u);
  }

  function majFrise(sc){
    const z = sc.ov.querySelector('[data-frise]');
    if(!z) return;
    const ordre = (sc.ordre || []).slice(0, 8);
    z.innerHTML = `<small>À venir</small>` + ordre.map((i) => {
      const u = sc.U[i];
      return u ? `<img class="f ${u.camp === 0 ? 'allie' : 'ennemi'}${u.ko ? ' ko' : ''}" src="${esc(A.safeUrl(u.photo))}" alt="${esc(u.nom)}" title="${esc(u.nom)}">` : '';
    }).join('');
  }

  function majTout(sc){
    sc.U.forEach((u, i) => majTuile(sc, i));
    majFrise(sc);
    dessinerPanneau(sc);
  }

  function msg(sc, texte){
    sc.texte = texte;
    const m = sc.ov.querySelector('[data-msg]');
    if(m) m.textContent = texte;
  }

  function flotter(sc, i, texte, genre){
    const d = elTuile(sc, i);
    if(!d) return;
    const f = document.createElement('span');
    f.className = 'cb-flotte ' + genre;
    f.textContent = texte;
    f.style.marginTop = ((sc.nflot++ % 3) * -15) + 'px';
    d.querySelector('.cb-u-vis').appendChild(f);
    setTimeout(() => f.remove(), 1300);
  }

  function classe(sc, i, nom, ms){
    const d = elTuile(sc, i);
    if(!d) return;
    d.classList.remove(nom);
    void d.offsetWidth;
    d.classList.add(nom);
    setTimeout(() => d.classList.remove(nom), ms || 600);
  }

  function effetType(sc, i, c){
    const d = elTuile(sc, i);
    if(!d || calme()) return;
    const fx = document.createElement('span');
    fx.className = 'cb-fx';
    fx.style.setProperty('--tc', couleur(c));
    d.querySelector('.cb-u-vis').appendChild(fx);
    setTimeout(() => fx.remove(), 700);
  }

  function bandeau(sc, texte, c){
    const b = sc.ov.querySelector('[data-bandeau]');
    if(!b) return;
    b.style.setProperty('--tc', couleur(c));
    b.querySelector('span').textContent = texte;
    b.classList.remove('on');
    void b.offsetWidth;
    b.classList.add('on');
  }

  // Les textes courts des effets d'une technique (pour les boutons).
  function effetsTexte(t){
    const l = [];
    (t.effets || []).forEach((e) => {
      const ch = e.chance && e.chance < 100 ? ' ' + e.chance + ' %' : '';
      const v = e.v ? ' ' + e.v + ' %' : '';
      const d = e.d ? ' · ' + e.d + 't' : '';
      const sur = e.sur === 'soi' ? ' (soi)' : e.sur === 'allies' ? ' (duo)' : e.sur === 'ennemis' ? ' (adv.)' : '';
      const nom = { soin: 'Soin', bouclier: 'Bouclier', vampirisme: 'Vol de PV', recul: 'Recul', 'pui+': 'PUI+', 'pui-': 'PUI−', 'def+': 'DÉF+', 'def-': 'DÉF−', 'vit+': 'VIT+', 'vit-': 'VIT−',
        etourdi: 'Étourdit', gel: 'Gèle', brulure: 'Brûle', poison: 'Empoisonne', regen: 'Régén.', marque: 'Marque', provoc: 'Provoque', purif: 'Purifie', 'jauge+': 'Jauge+', 'jauge-': 'Jauge−' }[e.k] || e.k;
      l.push(nom + (['soin', 'bouclier', 'vampirisme', 'recul', 'pui+', 'pui-', 'def+', 'def-', 'vit+', 'vit-', 'brulure', 'poison', 'regen', 'marque', 'jauge+', 'jauge-'].includes(e.k) ? v : '') + d + sur + (ch ? ' (' + ch.trim() + ')' : ''));
    });
    return l;
  }

  function resumeTech(t){
    const bits = [];
    if(t.puissance) bits.push('Puiss. ' + t.puissance + (t.hits > 1 ? '×' + t.hits : ''));
    const eff = effetsTexte(t);
    return bits.concat(eff.slice(0, 2)).join(' · ') || CIBLES[t.cible] || '';
  }

  function ciblesValides(sc, ct){
    if(ct === 'ennemi'){
      const e = vivants(sc, 1);
      const prov = e.find((i) => (sc.U[i].statuts || []).some((s) => s.k === 'provoc'));
      return prov !== undefined ? [prov] : e;
    }
    if(ct === 'allie') return vivants(sc, 0);
    return [];
  }

  function efficaciteSur(t, e){
    if(!t.puissance || !t.type || !e) return 0;
    if((e.faiblesses || []).includes(t.type)) return 1;
    if((e.resistances || []).includes(t.type)) return -1;
    return 0;
  }

  function validerPresel(sc){
    const v = vivants(sc, 1);
    if(sc.presel !== null && sc.presel !== undefined && !v.includes(sc.presel)) sc.presel = v.length ? v[0] : null;
  }

  function dessinerPanneau(sc){
    const z = sc.ov.querySelector('[data-pan]');
    if(!z || sc.fin) return;
    validerPresel(sc);
    sc.U.forEach((u, i) => { const d = elTuile(sc, i); if(d){ d.classList.remove('cible'); d.classList.toggle('presel', sc.presel === i && !u.ko && u.camp === 1); const o = d.querySelector('.cb-effn'); if(o) o.remove(); } });
    if(attend(sc)){
      const u = sc.U[sc.jeu.actif];
      const pre = sc.presel !== null && sc.presel !== undefined ? sc.U[sc.presel] : null;
      const tous = vivants(sc, 1).map((i) => sc.U[i]);
      z.innerHTML = `
        <div class="cb-pan-actif" style="--tc:${couleur(u.couleur)}"><img src="${esc(A.safeUrl(u.photo))}" alt=""><div><b>${esc(u.nom)} · à toi de jouer</b><small>${esc(u.role_nom || '')}${u.capacite ? ' · passif ' + esc(u.capacite.nom) : ''}</small></div>
          <button type="button" class="cb-mini" data-info aria-label="Fiche de ${esc(u.nom)}">i</button></div>
        <div class="cb-techs">${(u.techs || []).map((t, n) => {
          const cd = (u.cd || [])[n] || 0;
          const e = pre && ['ennemi'].includes(t.cible) ? efficaciteSur(t, pre) : (['ennemi', 'ennemis'].includes(t.cible) ? (tous.some((x) => efficaciteSur(t, x) > 0) ? 1 : tous.length && tous.every((x) => efficaciteSur(t, x) < 0) ? -1 : 0) : 0);
          return `<button type="button" class="cb-tech" data-t="${n}" style="--tc:${couleur(t.couleur)}" ${cd > 0 ? 'disabled' : ''} aria-pressed="${sc.choix === n}" aria-label="${esc(t.nom)}, ${cd > 0 ? 'recharge ' + cd + ' tours' : 'prête'}">
            <span class="k">${n + 1}</span><span class="n">${esc(t.nom)}</span><span class="m">${esc(resumeTech(t))}</span>
            <span class="e ${e > 0 ? 'sup' : e < 0 ? 'peu' : ''}">${e > 0 ? '▲ super efficace' : e < 0 ? '▼ peu efficace' : '&nbsp;'}</span>
            <span class="r ${cd > 0 ? 'cd' : 'pret'}">${cd > 0 ? 'Recharge ' + cd : (t.slot === 1 ? 'Toujours prête' : 'Prête')}</span></button>`;
        }).join('')}</div>
        <div class="cb-pan-aide">${sc.choix !== null ? 'Touche une cible en surbrillance.' : (pre && vivants(sc, 1).length > 1 ? 'Cible : <b>' + esc(pre.nom) + '</b> · touche un adversaire pour changer de cible.' : 'Touche une technique.')}</div>
        <div class="cb-pan-bas"><button type="button" class="cb-mini" data-passer>Passer le tour</button></div>`;
      z.querySelectorAll('[data-t]').forEach((b) => b.addEventListener('click', () => choisirTech(sc, Number(b.dataset.t))));
      z.querySelector('[data-info]').addEventListener('click', () => ficheUnite(u));
      z.querySelector('[data-passer]').addEventListener('click', () => { sc.choix = null; pas(sc, { passer: true }); });
      if(sc.choix !== null){
        const t = u.techs[sc.choix];
        ciblesValides(sc, t.cible).forEach((i) => {
          const d = elTuile(sc, i);
          if(!d) return;
          d.classList.add('cible');
          const e = efficaciteSur(t, sc.U[i]);
          if(e){ const s = document.createElement('span'); s.className = 'cb-effn'; s.textContent = e > 0 ? '▲ ×1,5' : '▼ ×0,67'; s.style.cssText = 'position:absolute;z-index:4;top:-6px;left:4px;padding:1px 6px;border-radius:6px;font-size:10px;font-weight:900;color:#06110a;background:' + (e > 0 ? '#5BE0A6' : '#FF9AA3'); d.appendChild(s); }
        });
      }
      return;
    }
    if(!sc.occupe && !sc.auto && (sc.jeu.actif === null || sc.jeu.actif === undefined)){
      z.innerHTML = `<div class="cb-pan-msg" data-msg>${esc(sc.texte || 'Le combat est prêt.')}</div><div class="cb-pan-bas"><button type="button" class="cb-mini" data-suite>Continuer</button></div>`;
      z.querySelector('[data-suite]').addEventListener('click', () => pas(sc, null));
      return;
    }
    z.innerHTML = `<div class="cb-pan-msg" data-msg aria-live="polite">${esc(sc.texte || (sc.auto ? 'Mode Auto : l\'ordinateur joue pour toi.' : 'Le combat commence !'))}</div>
      ${sc.auto ? '<div class="cb-pan-aide">Touche AUTO pour reprendre la main.</div>' : ''}`;
  }

  function choisirTech(sc, n){
    if(!attend(sc)) return;
    const u = sc.U[sc.jeu.actif], t = (u.techs || [])[n];
    if(!t || ((u.cd || [])[n] || 0) > 0) return;
    if(sc.choix === n){ sc.choix = null; dessinerPanneau(sc); return; }
    if(t.cible === 'ennemi' || t.cible === 'allie'){
      const l = ciblesValides(sc, t.cible);
      if(!l.length) return;
      if(t.cible === 'ennemi'){
        if(l.length === 1) return envoyer(sc, { t: n, c: l[0] });
        if(sc.presel !== null && sc.presel !== undefined && l.includes(sc.presel)) return envoyer(sc, { t: n, c: sc.presel });
      }
      sc.choix = n;
      dessinerPanneau(sc);
      return;
    }
    envoyer(sc, { t: n, c: null });
  }

  function cliquerUnite(sc, i){
    if(sc.appuiFait){ sc.appuiFait = false; return; }
    const u = sc.U[i];
    if(!u || u.ko) return;
    const d = elTuile(sc, i);
    if(attend(sc) && sc.choix !== null && d && d.classList.contains('cible')) return envoyer(sc, { t: sc.choix, c: i });
    if(u.camp === 1 && !sc.occupe && !sc.fin){
      sc.presel = i;
      sc.U.forEach((x, k) => majTuile(sc, k));
      dessinerPanneau(sc);
    }
  }

  function envoyer(sc, action){
    sc.choix = null;
    return pas(sc, action);
  }

  // Une étape : envoie l'action (ou rien), anime les événements reçus, recommence tant que le serveur a encore des tours à jouer.
  async function pas(sc, action){
    if(sc.occupe || sc.fin) return;
    sc.occupe = true;
    sc.choix = null;
    dessinerPanneau(sc);
    let act = action || null;
    try{
      for(;;){
        const r = await A.appel('combat_avancer', { p_id: sc.id, p_action: act, p_auto: sc.auto });
        act = null;
        if(sc.fin) return;
        if(r.expire){ A.toast('Ce combat a expiré.', 'err'); fermerScene(); rafraichir(); return; }
        await jouer(sc, r.evenements || []);
        if(sc.fin) return;
        sc.U = r.unites;
        sc.jeu = r.jeu;
        sc.ordre = r.ordre;
        sc.actifIdx = null;
        sc.U.forEach((u, i) => majTuile(sc, i));
        majFrise(sc);
        if(r.fini){ sc.occupe = false; await terminer(sc, r); return; }
        if(r.continuer) continue;
        break;
      }
    }catch(e){
      A.toast(e.message, 'err');
    }
    if(sc.fin) return;
    sc.occupe = false;
    sc.texte = '';
    sc.U.forEach((u, i) => majTuile(sc, i));
    dessinerPanneau(sc);
  }

  async function jouer(sc, evs){
    for(const ev of evs){
      if(sc.fin) return;
      await evenement(sc, ev);
    }
  }

  const NOMS_STATUT = { 'pui+': 'Puissance', 'pui-': 'Puissance', 'def+': 'Défense', 'def-': 'Défense', 'vit+': 'Vitesse', 'vit-': 'Vitesse' };
  function libelleStatut(ev){
    const d = STAT[ev.k];
    if(!d) return ev.k;
    if(NOMS_STATUT[ev.k]) return NOMS_STATUT[ev.k] + ' ' + (ev.k.endsWith('+') ? '+' : '−') + Math.round(ev.v) + ' %';
    if(ev.k === 'bouclier') return 'Bouclier ' + Math.round(ev.v);
    if(['brulure', 'poison', 'regen', 'marque'].includes(ev.k)) return d.c + ' ' + Math.round(ev.v) + ' %';
    return d.c;
  }

  async function evenement(sc, ev){
    const U = sc.U;
    const nom = (i) => (U[i] ? U[i].nom : '?');
    switch(ev.t){
      case 'debut':
        sc.actifIdx = ev.u;
        if(U[ev.u]) U[ev.u].cd = ev.cd;
        (ev.jauges || []).forEach((j, k) => { if(U[k]) U[k].jauge = j; });
        sc.ordre = ev.ordre || sc.ordre;
        U.forEach((u, i) => majTuile(sc, i));
        majFrise(sc);
        await pause(sc, 160);
        break;
      case 'tech': {
        const u = U[ev.u];
        u.cd = ev.cd;
        msg(sc, nom(ev.u) + ' · ' + ev.nom);
        bandeau(sc, ev.nom, ev.couleur);
        classe(sc, ev.u, u.camp === 0 ? 'agit-b' : 'agit-h', 520);
        (ev.c || []).forEach((c) => effetType(sc, c, ev.couleur));
        A.Son.jouer('tic');
        await pause(sc, 620);
        break;
      }
      case 'rate':
        flotter(sc, ev.c, 'Raté !', 'texte');
        await pause(sc, 320);
        break;
      case 'degats': {
        const u = U[ev.c];
        if(!u) break;
        u.pv = ev.pv;
        if(ev.ko) u.ko = true;
        const lib = ev.dot ? (STAT[ev.dot] ? STAT[ev.dot].c.toLowerCase() : '') : '';
        if(ev.d > 0 || !ev.a) flotter(sc, ev.c, '−' + ev.d + (lib ? ' ' + lib : ''), ev.crit ? 'crit' : 'degat');
        if(ev.a) flotter(sc, ev.c, 'Bouclier −' + ev.a, 'texte');
        if(ev.crit) flotter(sc, ev.c, 'CRITIQUE !', 'crit');
        else if(ev.m > 1 && !ev.dot) flotter(sc, ev.c, '▲ Super efficace', 'sup');
        else if(ev.m < 1 && !ev.dot) flotter(sc, ev.c, '▼ Peu efficace', 'mal');
        classe(sc, ev.c, 'touche', 500);
        majTuile(sc, ev.c);
        A.Son.jouer('volte');
        await pause(sc, ev.h > 1 ? 280 : 430);
        break;
      }
      case 'soin': {
        const u = U[ev.c];
        if(!u) break;
        u.pv = ev.pv;
        flotter(sc, ev.c, '+' + ev.v, 'soin');
        classe(sc, ev.c, 'soigne', 700);
        majTuile(sc, ev.c);
        A.Son.jouer('gain');
        await pause(sc, 400);
        break;
      }
      case 'statut':
        flotter(sc, ev.c, libelleStatut(ev), (STAT[ev.k] && STAT[ev.k].t === 'haut') ? 'soin' : 'texte');
        await pause(sc, 260);
        break;
      case 'statuts':
        if(U[ev.c]){ U[ev.c].statuts = ev.s; majTuile(sc, ev.c); }
        break;
      case 'fin_statut':
        flotter(sc, ev.c, (STAT[ev.k] ? STAT[ev.k].c : ev.k) + ' : fin', 'texte');
        await pause(sc, 140);
        break;
      case 'immunise':
        flotter(sc, ev.c, 'Immunisé !', 'texte');
        await pause(sc, 260);
        break;
      case 'purif':
        flotter(sc, ev.c, 'Purifié', 'soin');
        await pause(sc, 260);
        break;
      case 'jauge':
        if(U[ev.c]){ U[ev.c].jauge = ev.j; majTuile(sc, ev.c); }
        flotter(sc, ev.c, 'Jauge ' + signe(Math.round(ev.v)), 'texte');
        await pause(sc, 260);
        break;
      case 'passif': {
        const u = U[ev.u];
        const cap = u && u.capacite ? u.capacite.nom : 'Passif';
        flotter(sc, ev.u, cap, 'texte');
        msg(sc, nom(ev.u) + ' · ' + cap);
        await pause(sc, 340);
        break;
      }
      case 'saut':
        flotter(sc, ev.u, ev.k === 'gel' ? 'Gelé !' : 'Étourdi !', 'texte');
        msg(sc, nom(ev.u) + ' saute son tour.');
        await pause(sc, 560);
        break;
      case 'passe':
        msg(sc, nom(ev.u) + ' passe son tour.');
        await pause(sc, 300);
        break;
      case 'ko':
        if(U[ev.c]) U[ev.c].ko = true;
        majTuile(sc, ev.c);
        msg(sc, nom(ev.c) + ' est K.O. !');
        await pause(sc, 520);
        break;
      case 'limite':
        msg(sc, 'Durée maximale atteinte : les PV restants décident.');
        await pause(sc, 700);
        break;
      default:
        break;
    }
  }

  // ---------------------------------------------------------------------
  // Le tutoriel du premier combat et l'écran de fin
  // ---------------------------------------------------------------------

  const TUTO = [
    ['La jauge de tour', 'Chaque carte remplit sa jauge selon sa Vitesse. Quand elle est pleine, elle joue. La frise « À venir » en haut montre qui joue ensuite.', 'JAUGE ▮▮▮▮▯'],
    ['Trois techniques', 'La première est toujours prête. Les deux autres demandent quelques tours de recharge après usage. Touche une technique, puis un adversaire ; ou touche un adversaire avant pour présélectionner ta cible.', '1 · 2 · 3'],
    ['Styles et rôles', '▲ super efficace (×1,5) ou ▼ peu efficace (×0,67) selon les styles. Chaque carte a un rôle : Lyriciste, Pilier, Beatmaker, Hype man, Clasheur ou Briseur.', '▲ ×1,5   ▼ ×0,67'],
    ['Auto, ×2, Passer', 'AUTO joue à ta place, ×2 accélère les animations, « Passer » saute ton tour. Appui long sur une carte (ou touche I) : sa fiche complète.', 'AUTO · ×2']
  ];

  function tutoriel(sc){
    return new Promise((resolve) => {
      let n = 0;
      const v = document.createElement('div');
      v.className = 'cb-voile';
      sc.ov.appendChild(v);
      const fin = () => { stock.ecrire('wc-cb-tuto', '1'); v.remove(); resolve(); };
      const dessine = () => {
        const [t, p, ill] = TUTO[n];
        v.innerHTML = `<div class="cb-tuto" role="dialog" aria-label="Comment jouer"><div class="ill">${esc(ill)}</div><h3>${esc(t)}</h3><p>${esc(p)}</p>
          <div class="pts">${TUTO.map((_, i) => `<i class="${i === n ? 'on' : ''}"></i>`).join('')}</div>
          <div class="boutons"><button type="button" class="ct-btn" data-passer>Passer</button><button type="button" class="ct-btn principal" data-suite>${n === TUTO.length - 1 ? 'Au combat !' : 'Suivant'}</button></div></div>`;
        v.querySelector('[data-passer]').addEventListener('click', fin);
        v.querySelector('[data-suite]').addEventListener('click', () => { if(n === TUTO.length - 1) fin(); else { n++; dessine(); } });
        v.querySelector('[data-suite]').focus({ preventScroll: true });
      };
      dessine();
    });
  }

  async function terminer(sc, r){
    sc.occupe = false;
    sc.texte = '';
    const gagne = r.gains && r.gains.ton ? r.gains.ton === 'victoire' : r.etat === 'victoire';   // un mode peut fixer le ton du bilan (gains.ton, gains.titre : ex. la Faille)
    A.Son.jouer(gagne ? 'niveau' : 'volte');
    await pause(sc, 400);
    if(sc.fin) return;
    const sco = (u) => (u.stats ? u.stats.deg + u.stats.soins * 1.2 + u.stats.ko * 80 : 0);
    const moi = sc.U.filter((u) => u.camp === 0), eux = sc.U.filter((u) => u.camp === 1);
    const mvp = moi.reduce((m, u) => (!m || sco(u) > sco(m) ? u : m), null);
    const g = r.gains || {};
    const gains = [];
    if(g.vinyles) gains.push(`+${g.vinyles} vinyle${g.vinyles > 1 ? 's' : ''}`);
    if(Array.isArray(g.lignes)) g.lignes.forEach((t) => gains.push(String(t)));   // lignes toutes prêtes d'un mode (ex. Arène classée)
    if(r.trophees_delta) gains.push(`${signe(r.trophees_delta)} trophées`);
    Object.keys(g).filter((k) => !['vinyles', 'premiere'].includes(k) && typeof g[k] === 'number').forEach((k) => gains.push(`+${g[k]} ${k}`));
    const ligne = (u, adv) => `<div class="l${u === mvp ? ' mvp' : ''}${adv ? ' adv' : ''}" style="--tc:${couleur(u.couleur)}"><img src="${esc(A.safeUrl(u.photo))}" alt=""><div><b>${esc(u.nom)}${u === mvp ? '<span class="mvp-t">MVP</span>' : ''}</b><span style="font-size:11px; color:rgba(255,255,255,.6)">${esc(u.role_nom || '')}${u.ko ? ' · K.O.' : ''}</span></div>
      <span class="c"><strong>${nf(u.stats ? u.stats.deg : 0)}</strong>dégâts</span><span class="c"><strong>${nf(u.stats ? u.stats.soins : 0)}</strong>soins</span><span class="c"><strong>${u.stats ? u.stats.ko : 0}</strong>K.O.</span></div>`;
    const v = document.createElement('div');
    v.className = 'cb-voile';
    v.innerHTML = `<div class="cb-fin ${gagne ? 'victoire' : 'defaite'}" role="dialog" aria-label="Fin du combat">
      <h3>${g.titre ? esc(String(g.titre)) : (gagne ? 'VICTOIRE' : (r.etat === 'abandon' ? 'ABANDON' : 'DÉFAITE'))}</h3>
      <p style="margin:0; color:rgba(255,255,255,.75); font-size:14px">${esc(sc.partie.titre || sc.partie.adversaire)}</p>
      ${gains.length ? `<div class="cb-fin-gains">${gains.map((t) => `<span>${esc(t)}</span>`).join('')}</div>` : ''}
      <div class="cb-bilan">${moi.map((u) => ligne(u, false)).join('')}${eux.map((u) => ligne(u, true)).join('')}</div>
      <div class="boutons"><button type="button" class="ct-btn principal" data-rejouer>Rejouer</button><button type="button" class="ct-btn" data-fermer>Fermer</button></div></div>`;
    sc.ov.appendChild(v);
    v.querySelector('[data-fermer]').addEventListener('click', () => { fermerScene(); rafraichir(); });
    v.querySelector('[data-rejouer]').addEventListener('click', () => {
      const o = sc.ctx && sc.ctx.o;
      const choix = sc.ctx && sc.ctx.choix;
      fermerScene();
      if(o) lancerCombat(Object.assign({}, o, { choix: choix ? Object.assign({}, choix, { auto: sc.auto }) : null })); else rafraichir();
    });
    v.querySelector('[data-rejouer]').focus({ preventScroll: true });
    S.acc = null;
  }

  // ---------------------------------------------------------------------
  // La console de l'équipe
  // ---------------------------------------------------------------------

  async function catalogue(force){
    if(!S.cat || force) S.cat = await A.appel('combat_equipe_catalogue');
    return S.cat;
  }

  const OPT = (valeur, texte, sel) => `<option value="${esc(valeur)}"${String(sel) === String(valeur) ? ' selected' : ''}>${esc(texte)}</option>`;

  // Les onglets de la console ajoutés par d'autres fichiers : { id, nom, ouvrir(corps, api) }.
  const vuesEquipe = [];
  function enregistrerVueEquipe(v){
    if(!v || !/^[a-z][a-z0-9_-]{1,29}$/.test(String(v.id || '')) || !v.nom || typeof v.ouvrir !== 'function') throw new Error('Onglet de console invalide : il faut un id, un nom et une fonction ouvrir(corps, api).');
    const i = vuesEquipe.findIndex((x) => x.id === v.id);
    if(i >= 0) vuesEquipe[i] = v; else vuesEquipe.push(v);
  }

  async function equipe(hote, api){
    init(api);
    await chargerModes();
    const vues = [['cartes', 'Cartes'], ['types', 'Types et affinités'], ['techniques', 'Techniques'], ['capacites', 'Passifs'], ['arene', 'Arène'], ['test', 'Test de combat']]
      .concat(vuesEquipe.map((v) => [v.id, v.nom]));
    let vue = 'cartes';
    hote.innerHTML = `<div class="ct cb" style="padding:0"><nav class="cb-seg wrap" aria-label="Réglages du combat">${vues.map(([id, nom]) => `<button type="button" data-v="${id}" aria-pressed="${id === vue}">${nom}</button>`).join('')}</nav><div data-corps><div class="ct-vide">Chargement…</div></div></div>`;
    const corps = hote.querySelector('[data-corps]');
    const aller = async (v) => {
      vue = v;
      hote.querySelectorAll('.cb-seg [data-v]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === v)));
      corps.innerHTML = '<div class="ct-vide">Chargement…</div>';
      try{
        const cat = await catalogue(true);
        if(v === 'cartes') await eqCartes(corps, cat);
        else if(v === 'types') eqTypes(corps, cat);
        else if(v === 'techniques') eqTechniques(corps, cat);
        else if(v === 'capacites') eqCapacites(corps, cat);
        else if(v === 'arene') eqArene(corps, cat);
        else if(vuesEquipe.some((x) => x.id === v)) await vuesEquipe.find((x) => x.id === v).ouvrir(corps, A);
        else await eqTest(corps, cat);
      }catch(e){
        corps.innerHTML = `<div class="ct-panneau ct-vide"><b>Impossible d'ouvrir ce réglage</b>${esc(e.message)}</div>`;
      }
    };
    hote.querySelectorAll('.cb-seg [data-v]').forEach((b) => b.addEventListener('click', () => aller(b.dataset.v)));
    aller(vue);
  }

  async function eqCartes(corps, cat, q){
    let liste;
    liste = await A.appel('combat_equipe_cartes', { p_q: q || null });
    corps.innerHTML = `
      <div class="cb-sel-tete"><input type="search" placeholder="Chercher un artiste" value="${esc(q || '')}" data-q aria-label="Chercher un artiste"></div>
      <p class="sous" style="margin:0 0 10px; font-size:13px; color:var(--muted)">${liste.length} artiste${liste.length > 1 ? 's' : ''} dans les classeurs. Les stats affichées sont celles du booster de plus haute rareté de l'artiste. « Réglé » = au moins un réglage manuel.</p>
      <div class="cb-liste">${liste.length ? liste.map((c, i) => {
        const e = c.effectif;
        return `<div class="cb-ligne" style="--tc:${couleur(e.couleur)}">
          <div class="cb-portraits"><img src="${esc(A.safeUrl(c.photo))}" alt="" loading="lazy"></div>
          <div><h4>${esc(c.nom)} ${chip(e.type_nom, e.couleur)} ${roleChip(e.role_nom)} ${e.surcharge ? '<span class="cb-puce or">Réglé</span>' : ''}</h4>
            <p>PV ${nf(e.pv)} · PUI ${nf(e.pui)} · DÉF ${nf(e.def)} · VIT ${nf(e.vit)} — ${e.techniques.map((a) => esc(a.nom)).join(' / ')} — ${e.capacite ? esc(e.capacite.nom) : 'pas de passif'}</p></div>
          <button type="button" class="ct-btn petit" data-i="${i}">Modifier</button></div>`;
      }).join('') : '<div class="ct-panneau ct-vide">Aucun artiste trouvé.</div>'}</div>`;
    let minuteur = null;
    corps.querySelector('[data-q]').addEventListener('input', (ev) => {
      clearTimeout(minuteur);
      minuteur = setTimeout(() => eqCartes(corps, cat, ev.target.value).then(() => { const c = corps.querySelector('[data-q]'); c.focus(); c.setSelectionRange(c.value.length, c.value.length); }).catch(() => {}), 320);
    });
    corps.querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', () => {
      const c = liste[Number(b.dataset.i)];
      const f = A.fenetre('<div data-ed></div>', true);
      equipeCarte(f.corps.querySelector('[data-ed]'), A, c.artist_id, () => eqCartes(corps, cat, q));
    }));
  }

  // L'éditeur compact d'une carte : à embarquer dans l'éditeur de cartes de l'équipe.
  async function equipeCarte(hote, api, artistId, apres){
    init(api);
    hote.innerHTML = '<div class="ct-vide">Chargement…</div>';
    let c, cat;
    try{ [c, cat] = await Promise.all([A.appel('combat_equipe_carte', { p_artist: artistId }), catalogue()]); }
    catch(e){ hote.innerHTML = `<div class="ct-panneau ct-vide">${esc(e.message)}</div>`; return; }
    const e = c.effectif, d = c.defaut, sur = e.surcharge || {};
    const optsTech = (slot, cle, defId) => `<option value="">Par défaut (${esc((cat.techniques.find((a) => a.id === defId) || {}).nom || '—')})</option>` +
      cat.roles.map((r) => {
        const l = cat.techniques.filter((a) => a.role === r.id && (a.slot === slot || a.id === sur[cle]) && (a.actif || a.id === sur[cle]));
        return l.length ? `<optgroup label="${esc(r.nom)}">${l.map((a) => OPT(a.id, a.nom + (a.puissance ? ' · ' + a.puissance : ' · soutien'), sur[cle])).join('')}</optgroup>` : '';
      }).join('');
    const M = [1, 1.08, 1.18, 1.3, 1.45];
    const base = e.base;
    hote.innerHTML = `
      <div style="display:flex; align-items:center; gap:14px; padding-right:40px">
        <img class="cb-avatar" style="width:56px; height:56px" src="${esc(A.safeUrl(c.photo))}" alt="">
        <div><h2 style="margin:0">${esc(c.nom)}</h2><p class="sous" style="margin:2px 0 0">${nf(c.fans)} fans · ${c.boosters.map((b) => esc(b.nom) + ' (' + esc(A.rar(b.rarete).nom) + ')').join(', ') || 'dans aucun booster'}</p></div></div>
      <p class="sous" style="margin-top:10px">Laisse un champ vide pour la valeur par défaut. Les stats saisies sont des <b>stats de base</b> (le rôle n'y ajoute rien) : le multiplicateur de rareté du booster et le bonus holo s'y ajoutent. Le passif n'est donné par défaut qu'aux Légendaires et Mythiques.</p>
      <div class="cb-form">
        <label>Style<select class="cb-champ-eq" data-k="type"><option value="">Par défaut (${esc(d.type_nom)})</option>${cat.types.map((t) => OPT(t.id, t.nom, sur.type)).join('')}</select></label>
        <label>Rôle<select class="cb-champ-eq" data-k="role"><option value="">Par défaut (${esc(d.role_nom)})</option>${cat.roles.map((r) => OPT(r.id, r.nom, sur.role)).join('')}</select></label>
        ${['pv', 'pui', 'def', 'vit'].map((k) => `<label>${LIB[k]} de base<input class="cb-champ-eq" type="number" min="${k === 'pv' ? 20 : 10}" max="${k === 'pv' ? 400 : 300}" data-k="${k}" value="${sur[k] !== undefined ? sur[k] : ''}" placeholder="${d.base[k]}"><small>Par défaut : ${d.base[k]}</small></label>`).join('')}
        <label>Technique 1 (base)<select class="cb-champ-eq" data-k="tech1">${optsTech(1, 'tech1', d.techniques[0].id)}</select></label>
        <label>Technique 2 (spéciale)<select class="cb-champ-eq" data-k="tech2">${optsTech(2, 'tech2', d.techniques[1].id)}</select></label>
        <label>Technique 3 (ultime)<select class="cb-champ-eq" data-k="tech3">${optsTech(3, 'tech3', d.techniques[2].id)}</select></label>
        <label>Passif<select class="cb-champ-eq" data-k="capacite"><option value="">Par défaut (${d.capacite ? esc(d.capacite.nom) : 'aucun'})</option>${cat.capacites.map((k) => OPT(k.id, k.nom, sur.capacite)).join('')}</select></label>
        <label class="large">Citation (160 caractères)<input class="cb-champ-eq" type="text" maxlength="160" data-k="citation" value="${esc(sur.citation || '')}" placeholder="${esc(d.citation)}"></label>
      </div>
      <p class="sous" style="margin-top:14px">Stats finales selon la rareté (avec tes réglages actuels) :</p>
      <div class="cb-apercu">${M.map((m, i) => `<div><b>${esc(A.rar(i + 1).nom)}</b>PV ${Math.round(base.pv * m)}<br>PUI ${Math.round(base.pui * m)}<br>DÉF ${Math.round(base.def * m)}<br>VIT ${base.vit}</div>`).join('')}</div>
      <div style="margin-top:14px">${ficheHtml(e)}</div>
      <div class="ct-actions" style="justify-content:flex-end; margin-top:18px"><button type="button" class="ct-btn" data-defaut>Tout remettre par défaut</button><button type="button" class="ct-btn principal" data-ok>Enregistrer</button></div>`;
    const lire = (tout) => { const r = {}; hote.querySelectorAll('[data-k]').forEach((x) => { r[x.dataset.k] = tout ? '' : x.value.trim(); }); return r; };
    const envoyer = async (champs, bouton) => {
      bouton.disabled = true;
      try{
        await A.appel('combat_equipe_regler_carte', { p_artist: artistId, p_champs: champs });
        A.toast('Réglages enregistrés.');
        await equipeCarte(hote, api, artistId, apres);
        if(apres) apres();
      }catch(err){ A.toast(err.message, 'err'); bouton.disabled = false; }
    };
    hote.querySelector('[data-ok]').addEventListener('click', (ev) => envoyer(lire(false), ev.currentTarget));
    hote.querySelector('[data-defaut]').addEventListener('click', (ev) => envoyer(lire(true), ev.currentTarget));
  }

  function eqTechniques(corps, cat, filtre){
    const f = filtre === undefined ? 'tous' : filtre;
    const roleNom = (id) => (cat.roles.find((r) => r.id === id) || {}).nom || id;
    const liste = cat.techniques.filter((a) => f === 'tous' || a.role === f);
    corps.innerHTML = `
      <div class="cb-sel-tete"><button type="button" class="ct-btn principal" data-nouv>Nouvelle technique</button></div>
      <div class="cb-filtres"><button type="button" data-f="tous" aria-pressed="${f === 'tous'}">Toutes</button>${cat.roles.map((r) => `<button type="button" data-f="${esc(r.id)}" aria-pressed="${f === r.id}">${esc(r.nom)}</button>`).join('')}</div>
      <div class="cb-liste">${liste.map((a) => {
        const ty = cat.types.find((t) => t.id === a.type);
        return `<div class="cb-ligne${a.actif ? '' : ' verrou'}" style="--tc:${couleur(ty ? ty.couleur : null)}">
          <span class="cb-n" style="min-width:56px">${a.puissance || '—'}</span>
          <div><h4>${esc(a.nom)} ${roleChip(roleNom(a.role))} <span class="cb-puce">${a.slot === 1 ? 'Base' : a.slot === 2 ? 'Spéciale' : 'Ultime'}</span> ${ty ? chip(ty.nom, ty.couleur) : ''} ${a.actif ? '' : '<span class="cb-puce">Désactivée</span>'}</h4>
            <p>${esc(CIBLES[a.cible])} · ${a.hits > 1 ? a.hits + ' coups · ' : ''}${a.justesse} % de précision · recharge ${a.recharge}${a.perce ? ' · perce ' + a.perce + ' %' : ''}${(a.effets || []).length ? ' · ' + a.effets.map((e) => esc(e.k + (e.v ? ' ' + e.v : '') + (e.d ? ' / ' + e.d + 't' : ''))).join(', ') : ''}<br>${esc(a.description)}</p></div>
          <button type="button" class="ct-btn petit" data-id="${esc(a.id)}">Modifier</button></div>`;
      }).join('')}</div>`;
    corps.querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => eqTechniques(corps, cat, b.dataset.f)));
    const edit = (a) => formTechnique(a, cat, async () => { await catalogue(true); eqTechniques(corps, S.cat, f); });
    corps.querySelector('[data-nouv]').addEventListener('click', () => edit(null));
    corps.querySelectorAll('[data-id]').forEach((b) => b.addEventListener('click', () => edit(cat.techniques.find((a) => a.id === b.dataset.id))));
  }

  function formTechnique(a, cat, apres){
    const nouv = !a;
    a = a || { id: '', nom: '', role: cat.roles[0].id, slot: 1, type: null, puissance: 50, hits: 1, justesse: 95, cible: 'ennemi', recharge: 0, perce: 0, effets: [], description: '', actif: true };
    const f = A.fenetre(`
      <h2>${nouv ? 'Nouvelle technique' : esc(a.nom)}</h2>
      <div class="cb-form">
        <label>Identifiant<input class="cb-champ-eq" data-k="id" value="${esc(a.id)}" ${nouv ? '' : 'readonly'} placeholder="ex. ly-punchline"><small>Minuscules, chiffres et tirets.</small></label>
        <label>Nom<input class="cb-champ-eq" data-k="nom" value="${esc(a.nom)}"></label>
        <label>Rôle<select class="cb-champ-eq" data-k="role">${cat.roles.map((r) => OPT(r.id, r.nom, a.role)).join('')}</select></label>
        <label>Emplacement<select class="cb-champ-eq" data-k="slot">${OPT(1, '1 · base (toujours prête)', a.slot)}${OPT(2, '2 · spéciale', a.slot)}${OPT(3, '3 · ultime', a.slot)}</select></label>
        <label>Style<select class="cb-champ-eq" data-k="type"><option value="">Celui de la carte</option>${cat.types.map((t) => OPT(t.id, t.nom, a.type)).join('')}</select><small>Vide : suit le style de la carte (bonus de même style).</small></label>
        <label>Puissance (0 = soutien)<input class="cb-champ-eq" type="number" min="0" max="250" data-k="puissance" value="${a.puissance}"></label>
        <label>Coups<input class="cb-champ-eq" type="number" min="1" max="4" data-k="hits" value="${a.hits}"></label>
        <label>Précision (%)<input class="cb-champ-eq" type="number" min="1" max="100" data-k="justesse" value="${a.justesse}"></label>
        <label>Cible<select class="cb-champ-eq" data-k="cible">${Object.keys(CIBLES).map((k) => OPT(k, CIBLES[k], a.cible)).join('')}</select></label>
        <label>Recharge (tours)<input class="cb-champ-eq" type="number" min="0" max="9" data-k="recharge" value="${a.recharge}"></label>
        <label>Perce-défense (%)<input class="cb-champ-eq" type="number" min="0" max="100" data-k="perce" value="${a.perce}"></label>
        <label class="large">Effets (JSON)<textarea class="cb-champ-eq" style="height:84px; padding:8px 12px; font-family:monospace; font-size:12px" data-k="effets">${esc(JSON.stringify(a.effets || []))}</textarea><small>${esc(EFFETS_AIDE)}</small></label>
        <label class="large">Description<input class="cb-champ-eq" data-k="description" value="${esc(a.description)}"></label>
        <label><span>Active</span><select class="cb-champ-eq" data-k="actif">${OPT('true', 'Oui', String(a.actif))}${OPT('false', 'Non (n\'est plus tirée par défaut)', String(a.actif))}</select></label>
      </div>
      <div class="ct-actions" style="justify-content:flex-end; margin-top:18px"><button type="button" class="ct-btn" data-non>Annuler</button><button type="button" class="ct-btn principal" data-ok>Enregistrer</button></div>`, true);
    f.corps.querySelector('[data-non]').addEventListener('click', f.fermer);
    const ok = f.corps.querySelector('[data-ok]');
    ok.addEventListener('click', async () => {
      const p = {};
      f.corps.querySelectorAll('[data-k]').forEach((x) => { p[x.dataset.k] = x.value; });
      ['slot', 'puissance', 'hits', 'justesse', 'recharge', 'perce'].forEach((k) => { p[k] = Number(p[k]); });
      p.actif = p.actif === 'true';
      try{ p.effets = JSON.parse(p.effets || '[]'); }catch(e){ A.toast('Les effets doivent être un JSON valide, par exemple [{"k":"soin","v":30}].', 'err'); return; }
      ok.disabled = true;
      try{ await A.appel('combat_equipe_technique_sauver', { p }); A.toast('Technique enregistrée.'); f.fermer(); await apres(); }
      catch(e){ A.toast(e.message, 'err'); ok.disabled = false; }
    });
  }

  // Le test : deux duos choisis, joués par l'ordinateur ; un combat détaillé, ou 20 combats pour juger l'équilibre.
  function texteEvenement(U, ev){
    const n = (i) => U[i] ? U[i].nom : '?';
    switch(ev.t){
      case 'debut': return `— ${n(ev.u)} prend la main.`;
      case 'tech': return `${n(ev.u)} utilise ${ev.nom}.`;
      case 'rate': return `… raté sur ${n(ev.c)}.`;
      case 'degats': return `${n(ev.c)} perd ${ev.d} PV${ev.a ? ' (+' + ev.a + ' absorbés)' : ''} (${ev.pv} restants)${ev.dot ? ', ' + ev.dot : ''}${ev.crit ? ', coup critique' : ev.m > 1 ? ', super efficace' : ev.m < 1 ? ', peu efficace' : ''}${ev.ko ? ' — K.O. !' : ''}`;
      case 'soin': return `${n(ev.c)} récupère ${ev.v} PV.`;
      case 'statut': return `${n(ev.c)} : ${ev.k} (${Math.round(ev.v)}, ${ev.d} tour${ev.d > 1 ? 's' : ''}).`;
      case 'saut': return `${n(ev.u)} saute son tour (${ev.k}).`;
      case 'passe': return `${n(ev.u)} passe son tour.`;
      case 'immunise': return `${n(ev.c)} est immunisé.`;
      case 'purif': return `${n(ev.c)} est purifié.`;
      case 'jauge': return `Jauge de ${n(ev.c)} : ${Math.round(ev.v) > 0 ? '+' : ''}${Math.round(ev.v)}.`;
      case 'passif': return `Passif de ${n(ev.u)} : ${ev.code}.`;
      case 'limite': return 'Limite de durée atteinte.';
      default: return '';
    }
  }

  function eqTypes(corps, cat){
    const T = cat.types;
    const aff = {};
    cat.affinites.forEach((a) => { aff[a.att + '>' + a.def] = Number(a.mult); });
    const cases = [1, 1.5, 0.67, 2, 0.5];
    corps.innerHTML = `
      <div class="ct-titre-sec" style="margin-top:4px"><h3>Les styles</h3></div>
      <div class="cb-liste">${T.map((t) => `
        <div class="cb-ligne" style="--tc:${couleur(t.couleur)}">
          <span class="cb-type" style="--tc:${couleur(t.couleur)}">${esc(t.nom)}</span>
          <div style="display:grid; gap:8px"><div style="display:flex; flex-wrap:wrap; gap:8px"><input class="cb-champ-eq" style="flex:1 1 140px" data-nom="${esc(t.id)}" value="${esc(t.nom)}" aria-label="Nom"><input class="cb-champ-eq" type="color" style="width:56px; padding:3px" data-col="${esc(t.id)}" value="${esc(t.couleur)}" aria-label="Couleur"></div>
            <input class="cb-champ-eq" data-cit="${esc(t.id)}" value="${esc(t.citation)}" maxlength="160" aria-label="Citation"></div>
          <button type="button" class="ct-btn petit" data-sauver="${esc(t.id)}">Enregistrer</button></div>`).join('')}</div>
      <div class="ct-titre-sec"><h3>Affinités (attaquant en ligne, défenseur en colonne)</h3></div>
      <p class="sous" style="margin:0 0 10px; font-size:13px; color:var(--muted)">Touche une case pour changer le multiplicateur de dégâts : ·, ×1,5, ×0,67, ×2, ×0,5. Une case neutre vaut ×1.</p>
      <div style="overflow-x:auto"><table class="cb-eq-t"><thead><tr><th></th>${T.map((t) => `<th>${chipCourt(t)}</th>`).join('')}</tr></thead>
        <tbody>${T.map((a) => `<tr><th>${chipCourt(a)}</th>${T.map((d) => {
          const m = aff[a.id + '>' + d.id] || 1;
          return `<td><button type="button" class="cb-case ${m > 1 ? 'sup' : m < 1 ? 'peu' : ''}" data-a="${esc(a.id)}" data-d="${esc(d.id)}" data-m="${m}" aria-label="${esc(a.nom)} contre ${esc(d.nom)}">${m === 1 ? '·' : mu(m)}</button></td>`;
        }).join('')}</tr>`).join('')}</tbody></table></div>`;
    corps.querySelectorAll('[data-sauver]').forEach((b) => b.addEventListener('click', async () => {
      const id = b.dataset.sauver;
      b.disabled = true;
      try{
        await A.appel('combat_equipe_type_sauver', { p: { id, nom: corps.querySelector(`[data-nom="${id}"]`).value, couleur: corps.querySelector(`[data-col="${id}"]`).value, citation: corps.querySelector(`[data-cit="${id}"]`).value } });
        A.toast('Style enregistré.');
        await catalogue(true);
        eqTypes(corps, S.cat);
      }catch(e){ A.toast(e.message, 'err'); b.disabled = false; }
    }));
    corps.querySelectorAll('.cb-case').forEach((b) => b.addEventListener('click', async () => {
      const m = Number(b.dataset.m);
      const suivant = cases[(cases.findIndex((x) => Math.abs(x - m) < .001) + 1) % cases.length];
      b.disabled = true;
      try{
        await A.appel('combat_equipe_affinite', { p_att: b.dataset.a, p_def: b.dataset.d, p_mult: suivant });
        b.dataset.m = String(suivant);
        b.textContent = suivant === 1 ? '·' : mu(suivant);
        b.className = 'cb-case ' + (suivant > 1 ? 'sup' : suivant < 1 ? 'peu' : '');
        aff[b.dataset.a + '>' + b.dataset.d] = suivant;
        S.cat = null;
      }catch(e){ A.toast(e.message, 'err'); }
      b.disabled = false;
    }));
  }

  const chipCourt = (t) => `<span class="cb-type" style="--tc:${couleur(t.couleur)}" title="${esc(t.nom)}">${esc(t.nom.slice(0, 5))}</span>`;

  function eqCapacites(corps, cat){
    corps.innerHTML = `
      <div class="cb-sel-tete"><button type="button" class="ct-btn principal" data-nouv>Nouveau passif</button></div>
      <div class="cb-liste">${cat.capacites.map((c) => `
        <div class="cb-ligne"><span class="cb-n" style="min-width:56px">${c.valeur || '—'}</span>
          <div><h4>${esc(c.nom)}</h4><p>${esc(CODES[c.code] || c.code)}<br>${esc(c.description)}</p></div>
          <button type="button" class="ct-btn petit" data-id="${esc(c.id)}">Modifier</button></div>`).join('')}</div>`;
    const edit = (c) => {
      const nouv = !c;
      c = c || { id: '', nom: '', code: 'regeneration', valeur: 5, description: '' };
      const f = A.fenetre(`
        <h2>${nouv ? 'Nouveau passif' : esc(c.nom)}</h2>
        <div class="cb-form">
          <label>Identifiant<input class="cb-champ-eq" data-k="id" value="${esc(c.id)}" ${nouv ? '' : 'readonly'}></label>
          <label>Nom<input class="cb-champ-eq" data-k="nom" value="${esc(c.nom)}"></label>
          <label>Effet<select class="cb-champ-eq" data-k="code">${Object.keys(CODES).map((k) => OPT(k, CODES[k], c.code)).join('')}</select></label>
          <label>Valeur<input class="cb-champ-eq" type="number" min="0" max="100" data-k="valeur" value="${c.valeur}"></label>
          <label class="large">Description<input class="cb-champ-eq" data-k="description" value="${esc(c.description)}"></label>
        </div>
        <div class="ct-actions" style="justify-content:flex-end; margin-top:18px"><button type="button" class="ct-btn" data-non>Annuler</button><button type="button" class="ct-btn principal" data-ok>Enregistrer</button></div>`);
      f.corps.querySelector('[data-non]').addEventListener('click', f.fermer);
      const ok = f.corps.querySelector('[data-ok]');
      ok.addEventListener('click', async () => {
        const p = {};
        f.corps.querySelectorAll('[data-k]').forEach((x) => { p[x.dataset.k] = x.value; });
        p.valeur = Number(p.valeur);
        ok.disabled = true;
        try{ await A.appel('combat_equipe_capacite_sauver', { p }); A.toast('Passif enregistré.'); f.fermer(); await catalogue(true); eqCapacites(corps, S.cat); }
        catch(e){ A.toast(e.message, 'err'); ok.disabled = false; }
      });
    };
    corps.querySelector('[data-nouv]').addEventListener('click', () => edit(null));
    corps.querySelectorAll('[data-id]').forEach((b) => b.addEventListener('click', () => edit(cat.capacites.find((c) => c.id === b.dataset.id))));
  }

  function eqArene(corps, cat){
    corps.innerHTML = `
      <p class="sous" style="margin:0 0 12px; font-size:13px; color:var(--muted)">Les 12 crews de l'Arène. Le bonus augmente toutes leurs stats ; la récompense est versée une seule fois par joueur, à la première victoire.</p>
      <div class="cb-liste">${cat.arene.map((p) => `
        <div class="cb-ligne"><span class="cb-n">${p.palier}</span>
          <div><h4>${esc(p.nom)}</h4><p>${esc(p.artiste1)} (${esc(A.rar(p.rarete1).nom)}) & ${esc(p.artiste2)} (${esc(A.rar(p.rarete2).nom)}) · stats +${p.bonus} % · ${p.recompense} vinyle${p.recompense > 1 ? 's' : ''}</p></div>
          <button type="button" class="ct-btn petit" data-p="${p.palier}">Modifier</button></div>`).join('')}</div>`;
    corps.querySelectorAll('[data-p]').forEach((b) => b.addEventListener('click', () => {
      const p = cat.arene.find((x) => String(x.palier) === b.dataset.p);
      const f = A.fenetre(`
        <h2>Palier ${p.palier}</h2>
        <div class="cb-form">
          <label class="large">Nom du crew<input class="cb-champ-eq" data-k="nom" value="${esc(p.nom)}"></label>
          <label class="large">Description<input class="cb-champ-eq" data-k="description" value="${esc(p.description)}"></label>
          <label>Bonus de stats (%)<input class="cb-champ-eq" type="number" min="0" max="100" data-k="bonus" value="${p.bonus}"></label>
          <label>Récompense (vinyles)<input class="cb-champ-eq" type="number" min="0" max="50" data-k="recompense" value="${p.recompense}"></label>
        </div>
        <div class="ct-actions" style="justify-content:flex-end; margin-top:18px"><button type="button" class="ct-btn" data-non>Annuler</button><button type="button" class="ct-btn principal" data-ok>Enregistrer</button></div>`);
      f.corps.querySelector('[data-non]').addEventListener('click', f.fermer);
      const ok = f.corps.querySelector('[data-ok]');
      ok.addEventListener('click', async () => {
        const v = { palier: p.palier };
        f.corps.querySelectorAll('[data-k]').forEach((x) => { v[x.dataset.k] = x.value; });
        v.bonus = Number(v.bonus); v.recompense = Number(v.recompense);
        ok.disabled = true;
        try{ await A.appel('combat_equipe_arene_sauver', { p: v }); A.toast('Crew enregistré.'); f.fermer(); await catalogue(true); eqArene(corps, S.cat); }
        catch(e){ A.toast(e.message, 'err'); ok.disabled = false; }
      });
    }));
  }

  async function eqTest(corps, cat){
    const cartes = await A.appel('combat_equipe_cartes', { p_q: null });
    const optA = (sel) => cartes.map((c) => OPT(c.artist_id, c.nom + ' · ' + c.effectif.type_nom, sel)).join('');
    const ligne = (camp, k, sel) => `<div style="display:grid; grid-template-columns:1fr 100px auto; gap:8px; align-items:center"><select class="cb-champ-eq" data-c="${camp}${k}">${optA(sel)}</select>
      <select class="cb-champ-eq" data-r="${camp}${k}">${[1, 2, 3, 4, 5].map((r) => OPT(r, A.rar(r).nom, 3)).join('')}</select><label style="display:flex; gap:5px; align-items:center; font-size:12px"><input type="checkbox" data-h="${camp}${k}"> holo</label></div>`;
    corps.innerHTML = `
      <p class="sous" style="margin:0 0 12px; font-size:13px; color:var(--muted)">Choisis deux duos : l'ordinateur joue les deux camps. Idéal pour vérifier un réglage avant de le laisser aux joueurs.</p>
      <div class="cb-form" style="grid-template-columns:repeat(auto-fit, minmax(300px, 1fr))">
        <div class="ct-panneau" style="display:grid; gap:8px"><h3>Camp A</h3>${ligne('a', 0, cartes[0] && cartes[0].artist_id)}${ligne('a', 1, cartes[1] && cartes[1].artist_id)}<label style="font-size:12px">Bonus de stats (%) <input class="cb-champ-eq" style="width:80px" type="number" min="0" max="100" value="0" data-b="a"></label></div>
        <div class="ct-panneau" style="display:grid; gap:8px"><h3>Camp B</h3>${ligne('b', 0, cartes[2] && cartes[2].artist_id)}${ligne('b', 1, cartes[3] && cartes[3].artist_id)}<label style="font-size:12px">Bonus de stats (%) <input class="cb-champ-eq" style="width:80px" type="number" min="0" max="100" value="0" data-b="b"></label></div>
      </div>
      <div class="ct-actions" style="margin-top:14px"><button type="button" class="ct-btn principal" data-un>Simuler un combat</button><button type="button" class="ct-btn" data-vingt>Simuler 20 combats</button></div>
      <div data-res style="margin-top:14px"></div>`;
    const duo = (c) => [0, 1].map((k) => ({ artist: corps.querySelector(`[data-c="${c}${k}"]`).value, rarete: Number(corps.querySelector(`[data-r="${c}${k}"]`).value), holo: corps.querySelector(`[data-h="${c}${k}"]`).checked, bonus: Number(corps.querySelector(`[data-b="${c}"]`).value) || 0 }));
    const res = corps.querySelector('[data-res]');
    const bouton = (b, on) => corps.querySelectorAll('.ct-actions button').forEach((x) => { x.disabled = on; });
    corps.querySelector('[data-un]').addEventListener('click', async () => {
      bouton(null, true);
      try{
        const r = await A.appel('combat_equipe_simuler', { p_a: duo('a'), p_b: duo('b') });
        const U = r.depart;
        res.innerHTML = `<div class="ct-panneau"><h3>${r.vainqueur === 0 ? 'Le camp A l\'emporte' : 'Le camp B l\'emporte'} en ${r.actions} actions</h3>
          <p class="sous">${r.unites.map((u) => `${esc(u.nom)} : ${u.pv}/${u.pv_max} PV`).join(' · ')}</p>
          <div class="cb-journal" style="margin-top:12px">${r.tours.map((t) => `<h5>Tour ${t.tour}</h5>${t.ev.map((e) => esc(texteEvenement(U, e))).filter(Boolean).join('<br>')}`).join('')}</div></div>`;
      }catch(e){ res.innerHTML = `<div class="ct-panneau ct-vide">${esc(e.message)}</div>`; }
      bouton(null, false);
    });
    corps.querySelector('[data-vingt]').addEventListener('click', async () => {
      bouton(null, true);
      let a = 0, tours = 0, n = 0;
      try{
        for(let i = 0; i < 20; i++){
          res.innerHTML = `<div class="ct-vide" style="padding:20px">Combat ${i + 1} / 20…</div>`;
          const r = await A.appel('combat_equipe_simuler', { p_a: duo('a'), p_b: duo('b') });
          n++; tours += r.actions; if(r.vainqueur === 0) a++;
        }
        res.innerHTML = `<div class="ct-panneau"><h3>Camp A : ${a} victoire${a > 1 ? 's' : ''} sur ${n}</h3><p class="sous">Camp B : ${n - a} · durée moyenne ${(tours / n).toFixed(1).replace('.', ',')} actions. Autour de 10 sur 20, le duel est équilibré.</p></div>`;
      }catch(e){ res.innerHTML = `<div class="ct-panneau ct-vide">${esc(e.message)}</div>`; }
      bouton(null, false);
    });
  }


  window.WaveCombat = { monter, quitter, fiche, equipe, equipeCarte, lancerCombat, equipeModal, modes: { enregistrer, liste: () => S.modes.slice() }, equipeVues: { enregistrer: enregistrerVueEquipe } };

})();
