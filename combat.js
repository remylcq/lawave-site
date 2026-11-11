/* =====================================================================
   La Wave — Wave Cards : le combat (La Tour)

   Chargé à la demande par cartes.js (onglet « Combat », chargerWaveModule('combat') dans index.html).
   Un Heartstone très simplifié et très rapide : on compose une équipe de 3 cartes, on la pose, et le combat se joue tout seul.
   Le moteur vit dans la base (sql/combat-tour-auto.sql) : il simule le combat entier d'un coup et renvoie le déroulé ;
   ce fichier choisit l'équipe et REJOUE le déroulé en animation. Aucun calcul ni hasard côté navigateur.

   LES RÈGLES EN BREF
     Chaque carte a PV, Puissance, Défense et Vitesse (selon sa rareté) et un rôle, qui décide de sa façon de se battre.
     Les cartes jouent dans l'ordre de leur Vitesse, chacune frappe la carte d'en face (sinon la première encore debout).
     Dégâts = Puissance × (100 / (100 + Défense adverse)). Toutes les 3 attaques, le titre « signature » frappe 60 % plus fort.
     Un passif (Légendaire et plus) peut changer la partie. Le dernier debout gagne ; au bout de 30 tours, celui qui a gardé le plus de PV.
   La Tour : une seule, 1000 étages, un gardien tous les 10 étages ; récompenses à la première victoire de chaque étage.

   L'API PUBLIQUE (window.WaveCombat)
     monter(hote, api)           l'onglet : la Tour
     quitter()                   ferme le combat en cours d'animation
     fiche(el, api, opts)        la fiche de combat d'une carte (collection)
     equipe(hote, api)           le panneau de l'équipe : réglages de la Tour, taille des équipes
     equipeCarte(hote, api, id)  les statistiques d'une carte (lecture)
     essai(resultat, api, opts)  rejoue un déroulé sans la base (essais de la mise en scène)
   ===================================================================== */

(function(){

  'use strict';

  let A = null;   // l'interface partagée du jeu (window.Cartes.api)
  const S = { acc: null, cartes: null, equipe: [], scene: null, tri: 'rarete', rarete: 0, q: '' };

  const CSS = `
  .tr h2{margin:0; font-size:26px; letter-spacing:-.02em;}
  .tr .sous{color:var(--muted); font-size:14px; line-height:1.55;}
  .tr-progres{display:grid; gap:8px; margin-top:14px;}
  .tr-progres-l{display:flex; flex-wrap:wrap; align-items:baseline; justify-content:space-between; gap:6px 14px; font-size:13px; color:var(--muted);}
  .tr-progres-l b{font-size:22px; color:var(--ink); font-variant-numeric:tabular-nums;}
  .tr-etage{display:grid; gap:16px;}
  .tr-etage-t{display:flex; flex-wrap:wrap; align-items:center; gap:8px 12px;}
  .tr-etage-t h3{margin:0; font-size:20px;}
  .tr-puce{display:inline-flex; align-items:center; height:22px; padding:0 10px; border-radius:99px; font-size:11px; font-weight:800; letter-spacing:.06em; text-transform:uppercase; background:rgba(255,255,255,.08); color:var(--ink-soft);}
  .tr-puce.or{color:#1a1200; background:linear-gradient(90deg, #ffd76a, #ffb547);}
  .tr-barre{height:8px; border-radius:99px; background:rgba(255,255,255,.08); overflow:hidden;}
  .tr-barre i{display:block; height:100%; border-radius:99px; background:linear-gradient(90deg, #4FB4FF, #FF5C8A);}
  .tr-rang{display:grid; grid-template-columns:repeat(var(--n, 3), minmax(0, 170px)); gap:12px;}
  .tr-u{display:grid; gap:8px; align-content:start; text-align:center;}
  .tr-u .ct-carte{width:100%;}
  .tr-stats{display:flex; justify-content:center; flex-wrap:wrap; gap:3px 8px; font-size:11.5px; color:var(--ink-soft); font-variant-numeric:tabular-nums;}
  .tr-stats b{color:var(--ink);}
  .tr-vide{display:grid; place-items:center; aspect-ratio:4 / 5; border-radius:14px; border:2px dashed var(--ct-trait-fort); color:var(--muted); font-size:13px; background:rgba(255,255,255,.02);}
  .tr-actions{display:flex; flex-wrap:wrap; gap:10px; align-items:center;}
  .tr-gardiens{display:flex; flex-wrap:wrap; gap:8px;}
  .tr-g{display:grid; gap:2px; padding:8px 12px; border-radius:12px; border:1px solid var(--ct-trait); background:var(--ct-surface); font-size:11.5px; color:var(--muted); text-align:center; min-width:84px;}
  .tr-g b{font-size:15px; color:var(--ink);}
  .tr-g.fait{border-color:rgba(91,224,166,.5); background:rgba(91,224,166,.08);} .tr-g.fait b{color:#5BE0A6;}
  .tr-slots{display:grid; grid-template-columns:repeat(var(--n, 3), minmax(0, 1fr)); gap:12px; max-width:440px; margin:4px 0 12px;}
  .tr-slot-carte{position:relative;}
  .tr-x{all:unset; box-sizing:border-box; cursor:pointer; position:absolute; top:-8px; right:-8px; z-index:5; width:26px; height:26px; display:grid; place-items:center; border-radius:50%; font-size:12px; font-weight:800; color:#fff; background:rgba(12,17,25,.92); border:1px solid rgba(255,255,255,.28); box-shadow:0 4px 10px rgba(0,0,0,.5);}
  .tr-x:hover{background:#c4313c;} .tr-x:focus-visible{outline:2px solid var(--ct-accent);}
  .tr-mini-stats{display:flex; justify-content:center; flex-wrap:wrap; gap:1px 8px; margin-top:6px; font-size:10.5px; color:var(--muted); font-variant-numeric:tabular-nums; line-height:1.35;}
  .tr-mini-stats b{color:var(--ink); font-weight:700;}
  .tr-slot{position:relative; display:grid; gap:8px; align-content:start;}
  .tr-slot-n{display:flex; align-items:center; justify-content:center; gap:6px; font-size:11px; font-weight:800; letter-spacing:.08em; text-transform:uppercase; color:var(--muted);}
  .tr-slot-n i{display:grid; place-items:center; width:20px; height:20px; border-radius:50%; font-style:normal; font-size:11px; color:#05070a; background:#F4F5F6;}
  .tr-slot .ct-carte{width:100%;}
  .tr-slot-act{display:flex; justify-content:center; gap:6px;}
  .tr-mini{all:unset; box-sizing:border-box; cursor:pointer; width:32px; height:32px; display:grid; place-items:center; border-radius:9px; background:var(--ct-surface-2); border:1px solid var(--ct-trait); font-size:14px;}
  .tr-mini:hover:not(:disabled){background:rgba(255,255,255,.12);}
  .tr-mini:disabled{opacity:.3; cursor:default;}
  .tr-mini:focus-visible{outline:2px solid var(--ct-accent);}
  .tr-vide{cursor:default; font-size:22px; font-weight:800; color:rgba(255,255,255,.25);}
  /* Le sélecteur d'équipe : même grille que la Collection */
  .tr-sel{display:grid; grid-template-columns:minmax(0, 1fr); gap:14px;}
  .tr-sel > *{min-width:0;}
  .tr-sel .ct-segment{max-width:100%;}
  .tr-sel-haut{padding:4px 0 6px;}
  .tr-sel-bas{position:sticky; bottom:-1px; z-index:3; display:flex; align-items:center; justify-content:space-between; gap:12px; padding:12px 0 4px; background:linear-gradient(0deg, #0c1119 70%, rgba(12,17,25,0));}
  .tr-sel-bas span{font-size:14px; font-weight:700; color:var(--ink-soft);}
  .tr-sel .ct-outils{margin:0;}
  .tr-sel .ct-grille{grid-template-columns:repeat(auto-fill, minmax(124px, 1fr)); gap:16px 12px;}
  .tr-case{position:relative; display:grid; gap:6px; padding:4px; border-radius:14px;}
  .tr-case.choisie{box-shadow:0 0 0 2px #4FB4FF; background:rgba(79,180,255,.1);}
  .tr-case .tr-rang-n{position:absolute; top:-6px; left:-6px; z-index:4; display:grid; place-items:center; width:24px; height:24px; border-radius:50%; font-size:13px; font-weight:900; color:#05070a; background:#4FB4FF; box-shadow:0 2px 8px rgba(0,0,0,.5);}
  .tr-plus{justify-self:center;}
  .tr-aucune{padding:26px 14px; text-align:center; color:var(--muted); font-size:14px;}
  @media (max-width:560px){ .tr-sel .ct-grille{grid-template-columns:repeat(3, minmax(0, 1fr)); gap:12px 8px;} .tr-stats{font-size:10.5px;} }

  /* La scène du combat : un écran de jeu. La 3D occupe tout l'écran, l'interface se pose par-dessus. */
  .tr-gains{display:flex; flex-wrap:wrap; justify-content:center; gap:8px;}
  .tr-role{justify-self:center; display:inline-flex; align-items:center; height:20px; padding:0 9px; border-radius:99px; font-size:10.5px; font-weight:800; letter-spacing:.06em; text-transform:uppercase; background:rgba(255,255,255,.1); color:var(--ink-soft);}
  .tr-verdict{display:inline-flex; align-items:center; height:24px; padding:0 10px; border-radius:99px; font-size:11px; font-weight:800; letter-spacing:.06em; text-transform:uppercase;}
  .tr-verdict.ok{color:#05281a; background:#5BE0A6;} .tr-verdict.mid{color:#2a1c00; background:#ffd76a;} .tr-verdict.ko{color:#2b0509; background:#FF7A85;}
  /* La page Combat : les adversaires et mon équipe côte à côte sur grand écran */
  .tr-vs{display:grid; gap:16px; margin-top:16px;}
  .tr-vs > .ct-panneau{margin-top:0 !important; align-content:start;}
  @media (min-width:980px){ .tr-vs{grid-template-columns:minmax(0, 1fr) minmax(0, 1fr);} .tr-vs .tr-rang, .tr-vs .tr-slots{grid-template-columns:repeat(var(--n, 3), minmax(0, 1fr));} }

  .cbt{position:fixed; inset:0; z-index:9000; color:#fff; background:#05070a; overflow:hidden; user-select:none; -webkit-user-select:none; --cbt-titre:Anton, Impact, "Arial Narrow", sans-serif;}
  .cbt-corps{position:absolute; inset:0;}
  .cbt-canvas{position:absolute; inset:0; width:100%; height:100%; display:block;}
  .cbt-couche{position:absolute; inset:0; pointer-events:none; overflow:hidden;}
  .cbt-vig{position:absolute; inset:0; pointer-events:none; background:radial-gradient(ellipse at 50% 56%, rgba(0,0,0,0) 55%, rgba(3,5,10,.5) 100%);}
  .cbt-nuit{position:absolute; inset:0; pointer-events:none; opacity:0; visibility:hidden; background:radial-gradient(ellipse at 50% 56%, rgba(4,6,14,.1) 25%, rgba(3,4,10,.78) 100%);}
  .cbt-rouge{position:absolute; inset:0; pointer-events:none; opacity:0; visibility:hidden; background:radial-gradient(ellipse at center, rgba(255,40,40,0) 46%, rgba(255,30,30,.62) 100%);}
  /* en haut : les deux jauges d'équipe, comme dans un jeu de combat */
  .cbt-haut{position:absolute; left:0; right:0; top:0; display:grid; grid-template-columns:minmax(0, 1fr) auto minmax(0, 1fr); align-items:start; gap:12px; padding:calc(12px + env(safe-area-inset-top, 0px)) 18px 30px; background:linear-gradient(180deg, rgba(3,5,10,.86), rgba(3,5,10,0)); pointer-events:none;}
  .cbt-camp{display:grid; gap:6px; min-width:0;}
  .cbt-camp-t{display:flex; align-items:baseline; justify-content:space-between; gap:8px; font-size:12px; font-weight:800; letter-spacing:.08em; text-transform:uppercase; text-shadow:0 1px 4px #000;}
  .cbt-camp-t b{min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
  .cbt-camp-t span{flex:none; font-family:var(--cbt-titre); font-weight:400; font-size:15px; letter-spacing:.03em; font-variant-numeric:tabular-nums;}
  .cbt-camp.ennemi .cbt-camp-t{flex-direction:row-reverse;}
  .cbt-jauge{position:relative; height:15px; transform:skewX(-20deg); border-radius:3px; background:rgba(0,0,0,.66); box-shadow:0 0 0 2px rgba(255,255,255,.9), 0 5px 16px rgba(0,0,0,.55); overflow:hidden;}
  .cbt-jauge u, .cbt-jauge i{position:absolute; top:0; bottom:0; left:0; width:100%;}
  .cbt-jauge u{background:#fff;}
  .cbt-camp.ami .cbt-jauge i{background:linear-gradient(180deg, #9bdcff, #2f8fe6);}
  .cbt-camp.ennemi .cbt-jauge i{background:linear-gradient(180deg, #ffa3bf, #e6396f);}
  .cbt-camp.ennemi .cbt-jauge u, .cbt-camp.ennemi .cbt-jauge i{left:auto; right:0;}
  .cbt-centre{display:grid; justify-items:center; min-width:78px; text-align:center; text-shadow:0 2px 6px #000;}
  .cbt-centre small{font-size:10px; font-weight:800; letter-spacing:.16em; text-transform:uppercase; color:#ffd76a; white-space:nowrap;}
  .cbt-centre b{display:inline-block; font-family:var(--cbt-titre); font-weight:400; font-size:26px; line-height:1.1; letter-spacing:.04em; text-transform:uppercase; white-space:nowrap;}
  /* l'ordre de jeu */
  .cbt-ordre{position:absolute; top:calc(66px + env(safe-area-inset-top, 0px)); left:50%; transform:translateX(-50%); display:flex; gap:7px; align-items:center; padding:6px 10px; border-radius:12px; background:rgba(4,6,12,.5); border:1px solid rgba(255,255,255,.12); max-width:calc(100% - 20px); pointer-events:none;}
  .cbt-ch{position:relative; width:28px; height:28px; border-radius:7px; background:#111 50% 22% / cover; box-shadow:0 0 0 2px #4FB4FF; flex:none; opacity:.7; transition:transform .16s, opacity .25s, box-shadow .16s;}
  .cbt-ch.e{box-shadow:0 0 0 2px #FF5C8A;}
  .cbt-ch.on{opacity:1; transform:translateY(4px) scale(1.28); box-shadow:0 0 0 2px #fff, 0 0 14px rgba(255,255,255,.9); z-index:2;}
  .cbt-ch.ko{opacity:.2; filter:grayscale(1);}
  /* le journal des derniers coups (grand écran) */
  .cbt-log{position:absolute; left:14px; bottom:calc(16px + env(safe-area-inset-bottom, 0px)); width:min(330px, 40%); display:grid; gap:3px; pointer-events:none;}
  .cbt-log div{padding:3px 9px; border-radius:7px; font-size:11.5px; background:rgba(4,6,12,.55); text-shadow:0 1px 3px #000; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; animation:cbtLog 5s ease forwards;}
  .cbt-log .k{color:#ff8a8a; font-weight:800;} .cbt-log .a{color:#7fd0ff;} .cbt-log .e{color:#ff8fb0;} .cbt-log .v{color:#5BE0A6;}
  @keyframes cbtLog{0%{opacity:0;} 6%{opacity:1;} 80%{opacity:1;} 100%{opacity:0;}}
  /* les commandes */
  .cbt-bas{position:absolute; right:14px; bottom:calc(14px + env(safe-area-inset-bottom, 0px)); display:flex; gap:8px; z-index:6;}
  .cbt-btn{all:unset; box-sizing:border-box; cursor:pointer; display:inline-flex; align-items:center; justify-content:center; gap:6px; min-width:46px; height:42px; padding:0 15px; border-radius:12px; font-size:13px; font-weight:800; letter-spacing:.05em; text-transform:uppercase; color:#fff; background:rgba(8,11,18,.74); border:1px solid rgba(255,255,255,.24);}
  .cbt-btn:hover{background:rgba(34,42,62,.9);} .cbt-btn:active{transform:scale(.96);} .cbt-btn:focus-visible{outline:2px solid #4FB4FF; outline-offset:2px;}
  .cbt-btn.principal{background:linear-gradient(180deg, #2C9BEF, #1478C9); border-color:rgba(255,255,255,.3); box-shadow:0 8px 24px -10px rgba(20,137,222,.9);}
  .cbt-btn.principal:hover{background:linear-gradient(180deg, #3AA6F5, #1A83D6);}
  .cbt-fin-a{display:flex; flex-wrap:wrap; justify-content:center; gap:10px; width:100%;}
  .cbt-fin-a .cbt-btn{flex:1 1 auto; height:46px;}
  .cbt-fleche{position:absolute; left:0; top:0; width:0; height:0; margin:-14px 0 0 -10px; border-left:10px solid transparent; border-right:10px solid transparent; border-top:14px solid #7fd0ff; opacity:0; filter:drop-shadow(0 2px 3px rgba(0,0,0,.8)); will-change:transform;}
  /* sous chaque carte : sa jauge de PV */
  .cbt-pl{position:absolute; left:0; top:0; width:var(--pl, 96px); margin-left:calc(var(--pl, 96px) / -2); opacity:0; will-change:transform;}
  .cbt-couche.serre .cbt-pl .lv{display:none;} .cbt-couche.serre .cbt-pl .x{font-size:12.5px;} .cbt-couche.serre .cbt-pl .pv{height:7px;}
  .cbt-pl.ennemi{margin-top:-36px;} .cbt-pl.ami{margin-top:4px;}
  .cbt-pl .pv{position:relative; height:9px; border-radius:3px; background:rgba(0,0,0,.74); box-shadow:0 0 0 1.5px rgba(255,255,255,.92), 0 2px 8px rgba(0,0,0,.6); overflow:hidden;}
  .cbt-pl .pv u, .cbt-pl .pv i, .cbt-pl .pv b{position:absolute; left:0; top:0; bottom:0; width:100%;}
  .cbt-pl .pv u{background:#fff;}
  .cbt-pl .pv i{background:linear-gradient(180deg, #9dffab, #2fbf6a);}
  .cbt-pl .pv.bas i{background:linear-gradient(180deg, #ffb36a, #ff4d4d);}
  .cbt-pl .pv b{width:0; top:auto; height:45%; background:#7fd6ff; box-shadow:0 0 6px #7fd6ff;}
  .cbt-pl .x{display:flex; justify-content:center; align-items:baseline; gap:5px; margin-top:3px; font-family:var(--cbt-titre); font-size:15px; line-height:1; letter-spacing:.02em; text-shadow:0 1px 0 #000, 0 0 6px #000, 0 0 2px #000; font-variant-numeric:tabular-nums; white-space:nowrap;}
  .cbt-pl .x em{font-style:normal; color:#7fd6ff; font-size:12px;}
  .cbt-pl .x .lv{padding:1px 5px; border-radius:4px; font-family:inherit; font-size:10px; color:#1a1200; background:linear-gradient(180deg, #ffe08a, #ffb547); text-shadow:none;}
  .cbt-pl.ennemi{display:flex; flex-direction:column-reverse;} .cbt-pl.ennemi .x{margin:0 0 3px;}
  /* les effets d'interface : nombres, étiquettes, rubans, bandeaux */
  .cbt-fx{position:absolute; inset:0; pointer-events:none; overflow:hidden;}
  .cbt-nb{position:absolute; left:0; top:0; font-family:var(--cbt-titre); font-size:40px; line-height:1; color:#fff; white-space:nowrap; text-align:center; -webkit-text-stroke:5px #0a0c12; paint-order:stroke fill; text-shadow:0 3px 0 #0a0c12; will-change:transform, opacity;}
  .cbt-nb small{display:block; margin-bottom:2px; font-size:.36em; letter-spacing:.14em; text-transform:uppercase; -webkit-text-stroke:3px #0a0c12;}
  .cbt-nb.sig{font-size:52px; color:#ffd76a;} .cbt-nb.crit{font-size:60px; color:#ff5252;} .cbt-nb.crit small{color:#fff;}
  .cbt-nb.soin{color:#6dfcb0;} .cbt-nb.bou{color:#7fd6ff; font-size:30px;} .cbt-nb.ref{color:#ffa54d; font-size:30px;}
  .cbt-et{position:absolute; left:0; top:0; padding:4px 12px; border-radius:6px; font-size:12px; font-weight:800; letter-spacing:.08em; text-transform:uppercase; white-space:nowrap; color:#05070a; background:#ffd76a; box-shadow:0 4px 14px rgba(0,0,0,.5);}
  .cbt-et.soin{background:#6dfcb0;} .cbt-et.bou{background:#7fd6ff;}
  .cbt-ruban{position:absolute; left:0; right:0; top:40%; height:60px; display:grid; place-items:center; background:linear-gradient(90deg, rgba(4,6,12,0), rgba(4,6,12,.84) 22%, rgba(4,6,12,.84) 78%, rgba(4,6,12,0)); border-top:2px solid rgba(255,255,255,.55); border-bottom:2px solid rgba(255,255,255,.55);}
  .cbt-ruban span{font-family:var(--cbt-titre); font-size:34px; letter-spacing:.18em; text-transform:uppercase; text-shadow:0 3px 0 #000;}
  .cbt-ruban.go{height:84px; border-color:#ffd76a;} .cbt-ruban.go span{font-size:52px; color:#ffd76a;}
  .cbt-cut{position:absolute; left:-8%; right:-8%; top:19%; height:104px; display:flex; align-items:center; gap:18px; padding:0 14%; background:linear-gradient(90deg, #061a33, #1565c0 58%, #4FB4FF); box-shadow:0 0 0 3px #fff, 0 14px 40px rgba(0,0,0,.6); overflow:hidden;}
  .cbt-cut.ennemi{top:60%; flex-direction:row-reverse; text-align:right; background:linear-gradient(270deg, #33060f, #c0153f 58%, #FF5C8A);}
  .cbt-cut::before{content:''; position:absolute; inset:0; background:repeating-linear-gradient(90deg, rgba(255,255,255,0) 0 46px, rgba(255,255,255,.14) 46px 50px, rgba(255,255,255,0) 50px 120px); background-position:var(--x, 0) 0;}
  .cbt-cut-img{position:relative; width:140px; height:175px; flex:none; border-radius:10px; background:#111 50% 20% / cover; box-shadow:0 0 0 3px #fff;}
  .cbt-cut-t{position:relative; display:grid; gap:2px; min-width:0;}
  .cbt-cut-t small{font-size:12px; font-weight:800; letter-spacing:.24em; text-transform:uppercase; color:#ffd76a;}
  .cbt-cut-t b{font-family:var(--cbt-titre); font-weight:400; font-size:44px; line-height:1; text-transform:uppercase; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; text-shadow:0 3px 0 rgba(0,0,0,.55);}
  /* l'écran de présentation : les deux équipes face à face */
  .cbt-vs{position:absolute; inset:0; z-index:5; overflow:hidden;}
  .cbt-vs-p{position:absolute; top:0; bottom:0; width:60%; display:grid; align-content:center; justify-items:center; gap:14px; padding:70px 18px;}
  .cbt-vs-p.ami{left:0; padding-right:calc(21% + 10px); background:linear-gradient(135deg, #04101f, #0f4c8a 72%, #2f8fe6); clip-path:polygon(0 0, 100% 0, 67% 100%, 0 100%);}
  .cbt-vs-p.ennemi{right:0; padding-left:calc(21% + 10px); background:linear-gradient(315deg, #1f040a, #8a0f33 72%, #e6396f); clip-path:polygon(33% 0, 100% 0, 100% 100%, 0 100%);}
  .cbt-vs-p small{font-size:12px; font-weight:800; letter-spacing:.22em; text-transform:uppercase; color:rgba(255,255,255,.82);}
  .cbt-vs-p b{font-family:var(--cbt-titre); font-weight:400; font-size:clamp(20px, 3.4vw, 40px); line-height:1.05; text-transform:uppercase; text-align:center; max-width:100%; overflow-wrap:anywhere; text-shadow:0 3px 0 rgba(0,0,0,.5);}
  .cbt-vs-l{display:flex; flex-wrap:wrap; justify-content:center; gap:14px; max-width:600px;}
  .cbt-vs-l span{width:clamp(64px, 10vw, 170px); aspect-ratio:4 / 5; border-radius:8px; background:#111 50% 20% / cover; box-shadow:0 0 0 2px #fff, 0 8px 22px rgba(0,0,0,.5);}
  .cbt-vs-c{position:absolute; left:50%; top:50%; font-family:var(--cbt-titre); font-style:italic; font-size:clamp(70px, 15vw, 160px); line-height:1; color:#fff; -webkit-text-stroke:10px #0a0c12; paint-order:stroke fill; text-shadow:0 7px 0 #0a0c12, 0 0 44px rgba(255,215,106,.9);}
  .cbt-vs-e{position:absolute; left:0; right:0; bottom:8%; text-align:center; font-size:13px; font-weight:800; letter-spacing:.24em; text-transform:uppercase; color:#ffd76a; text-shadow:0 2px 8px #000;}
  .cbt-titre{position:absolute; left:0; right:0; top:32%; text-align:center;}
  .cbt-titre b{display:inline-block; font-family:var(--cbt-titre); font-weight:400; font-size:clamp(64px, 15vw, 170px); line-height:1; text-transform:uppercase; color:#ffe08a; -webkit-text-stroke:10px #0a0c12; paint-order:stroke fill; text-shadow:0 8px 0 #0a0c12, 0 0 50px rgba(255,215,106,.85);}
  .cbt-titre.d b{color:#c9ceda; text-shadow:0 8px 0 #0a0c12, 0 0 40px rgba(120,140,190,.5);}
  /* la fin : le bilan */
  .cbt-fin{position:absolute; inset:0; z-index:20; display:grid; place-items:center; padding:18px; background:rgba(3,5,8,.7); overflow:auto;}
  .cbt-fin-c{position:relative; display:grid; gap:14px; justify-items:center; text-align:center; width:min(440px, 100%); padding:0 24px 24px; border-radius:22px; background:#0c1119; border:1px solid rgba(255,255,255,.16); box-shadow:0 30px 80px rgba(0,0,0,.6); overflow:hidden;}
  .cbt-fin-t{display:grid; gap:2px; justify-self:stretch; margin:0 -24px; padding:22px 20px 16px; background:linear-gradient(180deg, rgba(91,224,166,.26), rgba(91,224,166,0));}
  .cbt-fin-c.d .cbt-fin-t{background:linear-gradient(180deg, rgba(255,92,110,.24), rgba(255,92,110,0));}
  .cbt-fin-t small{font-size:11.5px; font-weight:800; letter-spacing:.14em; text-transform:uppercase; color:rgba(255,255,255,.7);}
  .cbt-fin-t h2{margin:0; font-family:var(--cbt-titre); font-weight:400; font-size:52px; line-height:1.05; letter-spacing:.03em; text-transform:uppercase; color:#5BE0A6;}
  .cbt-fin-c.d h2{color:#FF7A85;}
  .cbt-recs{display:flex; flex-wrap:wrap; justify-content:center; gap:10px; width:100%;}
  .cbt-rec{flex:1 1 120px; display:grid; gap:1px; padding:11px 10px; border-radius:14px; background:linear-gradient(180deg, rgba(255,215,106,.2), rgba(255,181,71,.07)); border:1px solid rgba(255,215,106,.45);}
  .cbt-rec b{font-family:var(--cbt-titre); font-weight:400; font-size:30px; line-height:1; color:#ffe08a; font-variant-numeric:tabular-nums;}
  .cbt-rec span{font-size:11px; font-weight:800; letter-spacing:.08em; text-transform:uppercase; color:rgba(255,255,255,.75);}
  .cbt-rec.palier{background:rgba(255,255,255,.06); border-color:rgba(255,255,255,.18);} .cbt-rec.palier b{color:#fff;}
  .cbt-fin .sous{margin:0; color:rgba(255,255,255,.7); font-size:13.5px; line-height:1.5;}
  .tr-bilan{display:grid; grid-template-columns:repeat(3, minmax(0, 1fr)); gap:8px; width:100%;}
  .tr-bilan div{padding:9px 6px; border-radius:11px; background:rgba(255,255,255,.06); font-size:11px; color:var(--muted); text-transform:uppercase; letter-spacing:.06em;}
  .tr-bilan b{display:block; font-size:18px; letter-spacing:0; color:var(--ink); font-variant-numeric:tabular-nums;}
  .tr-mvp{display:flex; align-items:center; gap:10px; padding:8px 12px; border-radius:12px; background:linear-gradient(90deg, rgba(255,215,106,.18), rgba(255,181,71,.06)); border:1px solid rgba(255,215,106,.4); font-size:13px; width:100%; text-align:left;}
  .tr-mvp img{width:38px; height:38px; border-radius:8px; object-fit:cover; flex:none; max-width:none;}
  .tr-mvp b{color:#ffe9a8;}
  .tr-confetti{position:absolute; inset:0; overflow:hidden; pointer-events:none; z-index:19;}
  .tr-confetti i{position:absolute; top:-12px; width:9px; height:14px; border-radius:2px; opacity:.95; animation:trConf var(--d, 2.6s) linear var(--l, 0s) forwards;}
  @keyframes trConf{to{transform:translate(var(--x, 0), 105vh) rotate(var(--r, 540deg)); opacity:.8;}}
  /* la scène de repli (pas de WebGL) : les cartes à plat */
  .tr-fond{position:absolute; inset:0; background-size:cover; background-position:50% 30%; image-rendering:pixelated;}
  .tr-fond::after{content:''; position:absolute; inset:0; background:linear-gradient(180deg, rgba(5,7,10,.25), rgba(5,7,10,0) 45%, rgba(5,7,10,.45));}
  .tr-terrain{position:absolute; inset:118px 0 70px; display:grid; grid-template-rows:1fr 1fr; gap:10px; padding:6px 14px; align-content:center; max-width:820px; margin:0 auto;}
  .tr-ligne{display:grid; grid-template-columns:repeat(var(--n, 3), minmax(0, 1fr)); gap:14px; align-items:center; justify-items:center;}
  .tr-uc{position:relative; width:min(150px, 100%); transition:transform .2s cubic-bezier(.3,1.5,.5,1), filter .3s, opacity .4s;}
  .tr-uc .ct-carte{width:100%; box-shadow:0 10px 28px rgba(0,0,0,.6);}
  .tr-uc.ko{filter:grayscale(1) brightness(.5); opacity:.55; transform:scale(.92);}
  .tr-uc.touche .ct-carte{animation:trTouche .3s;}
  .tr-pv{height:9px; margin-top:7px; border-radius:3px; background:rgba(0,0,0,.7); box-shadow:0 0 0 1.5px rgba(255,255,255,.9); overflow:hidden;}
  .tr-pv i{display:block; height:100%; width:100%; background:linear-gradient(180deg, #9dffab, #2fbf6a); transition:width .3s;}
  .tr-pv.bas i{background:linear-gradient(180deg, #ffb36a, #ff4d4d);}
  .tr-pvn{margin-top:4px; font-family:var(--cbt-titre); font-size:15px; text-align:center; font-variant-numeric:tabular-nums; text-shadow:0 1px 0 #000, 0 0 6px #000;}
  @keyframes trTouche{0%{filter:brightness(2.4);} 100%{filter:none;}}
  @media (max-width:700px){
    .cbt-haut{gap:8px; padding-left:12px; padding-right:12px;} .cbt-camp-t{font-size:10.5px;} .cbt-camp-t span{font-size:13px;} .cbt-jauge{height:12px;}
    .cbt-centre{min-width:60px;} .cbt-centre b{font-size:20px;} .cbt-centre small{font-size:9px;}
    .cbt-ordre{top:calc(58px + env(safe-area-inset-top, 0px)); gap:5px; padding:5px 8px;} .cbt-ch{width:23px; height:23px; border-radius:6px;}
    .cbt-log{display:none;} .cbt-bas{left:0; right:0; justify-content:center;}
    .cbt-pl.ennemi{margin-top:-32px;}
    .cbt-nb{font-size:30px; -webkit-text-stroke-width:4px;} .cbt-nb.sig{font-size:38px;} .cbt-nb.crit{font-size:44px;} .cbt-nb.bou, .cbt-nb.ref{font-size:22px;}
    .cbt-ruban{height:48px;} .cbt-ruban span{font-size:26px;} .cbt-ruban.go{height:64px;} .cbt-ruban.go span{font-size:38px;}
    .cbt-cut{height:76px; gap:12px;} .cbt-cut-img{width:92px; height:115px;} .cbt-cut-t b{font-size:28px;} .cbt-cut-t small{font-size:10px;}
    .cbt-vs-p{gap:10px; left:0; right:0; width:auto;} .cbt-vs-p small{font-size:10px; letter-spacing:.16em;}
    .cbt-vs-p.ennemi{bottom:46%; padding:74px 16px 12%; clip-path:polygon(0 0, 100% 0, 100% 80%, 0 100%); background:linear-gradient(200deg, #1f040a, #8a0f33 72%, #e6396f);}
    .cbt-vs-p.ami{top:40%; padding:22% 16px 96px; clip-path:none; background:linear-gradient(20deg, #04101f, #0f4c8a 72%, #2f8fe6);}
    .cbt-vs-l{gap:10px;} .cbt-vs-l span{width:clamp(60px, 24vw, 120px);} .cbt-vs-c{top:47%;} .cbt-vs-e{bottom:calc(64px + env(safe-area-inset-bottom, 0px));} .cbt-vs-c, .cbt-titre b{-webkit-text-stroke-width:6px;}
    .cbt-fin-t h2{font-size:42px;}
    .tr-uc{width:min(104px, 100%);} .tr-ligne{gap:8px;} .tr-terrain{inset:104px 0 64px;}
  }
  @media (prefers-reduced-motion: reduce){ .tr-uc, .tr-pv i, .cbt-ch{transition:none;} .cbt-log div, .tr-confetti i{animation-duration:.01s;} }
  .cb-fiche{display:grid; gap:12px; padding:14px; border-radius:16px; background:var(--ct-surface-2);}
  .cb-fiche-t{display:flex; align-items:center; justify-content:space-between; gap:10px;}
  .cb-roles{display:flex; flex-wrap:wrap; gap:6px; align-items:center;}
  .cb-role{display:inline-flex; align-items:center; height:22px; padding:0 10px; border-radius:99px; font-size:11px; font-weight:800; letter-spacing:.05em; text-transform:uppercase; background:rgba(255,255,255,.1);}
  .cb-pvgros{font-size:26px; font-weight:900; font-variant-numeric:tabular-nums;} .cb-pvgros small{font-size:11px; font-weight:700; color:var(--muted); margin-right:6px;}
  .cb-stats{display:grid; grid-template-columns:repeat(3, 1fr); gap:10px;}
  .cb-st{display:grid; gap:4px; font-size:12px; color:var(--ink-soft);} .cb-st b{font-size:18px; color:var(--ink); font-variant-numeric:tabular-nums;}
  .cb-st i{display:block; height:5px; border-radius:99px; background:linear-gradient(90deg, #4FB4FF, #FF5C8A); width:var(--w, 50%);}
  .cb-atts{display:grid; gap:6px;}
  .cb-att{display:flex; align-items:center; gap:10px; padding:8px 12px; border-radius:12px; background:rgba(255,255,255,.05); font-size:13.5px;}
  .cb-att span{display:grid; place-items:center; width:22px; height:22px; border-radius:50%; font-size:11px; font-weight:800; color:#05070a; background:#F4F5F6; flex:none;}
  .cb-att small{margin-left:auto; color:var(--muted); font-size:11.5px;}
  .cb-cap{font-size:13px; line-height:1.5; color:var(--ink-soft);}
  `;

  function init(api){
    A = api;
    if(!document.getElementById('tr-style')){
      const s = document.createElement('style');
      s.id = 'tr-style';
      s.textContent = CSS;
      document.head.appendChild(s);
    }
  }

  const esc = (t) => A.esc(t);
  const nf = (n) => A.nf(n);
  const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
  const calme = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const pluriel = (n, un, plus) => n + ' ' + (n > 1 ? plus : un);
  const cle = (c) => c.booster + '|' + c.artist_id + '|' + (c.holo ? 1 : 0);
  const score = (c) => c.pv * .3 + c.pui + c.def * .8 + c.vit * .5;
  const carte = (c) => A.carteHtml({ nom: c.nom, titre: c.titre, rarete: c.rarete, numero: c.numero, photo: c.photo, holo: c.holo, classeur: c.booster }, { niv: (c.niveau > 1 || c.etoiles > 0) ? { niveau: c.niveau, etoiles: c.etoiles } : null });
  const sansAccent = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const statsMini = (c) => `<div class="tr-mini-stats"><span>PV <b>${nf(c.pv_max || c.pv)}</b></span><span>PUI <b>${nf(c.pui)}</b></span><span>DÉF <b>${nf(c.def)}</b></span><span>VIT <b>${nf(c.vit)}</b></span></div>`;
  const statsHtml = (c) => `<div class="tr-stats"><span>PV <b>${nf(c.pv_max || c.pv)}</b></span><span>PUI <b>${nf(c.pui)}</b></span><span>DÉF <b>${nf(c.def)}</b></span><span>VIT <b>${nf(c.vit)}</b></span></div>${c.role_nom ? `<div class="tr-role" title="${esc(c.role_resume || '')}">${esc(c.role_nom)}</div>` : ''}`;

  // ---------------------------------------------------------------------
  // L'onglet : la Tour
  // ---------------------------------------------------------------------

  async function monter(hote, api){
    init(api);
    S.hote = hote;
    await charger();
    dessiner();
  }

  function quitter(){ fermerScene(); }

  async function charger(){
    S.acc = await A.appel('combat_tour_accueil');
    if(!S.cartes) S.cartes = await A.appel('combat_tour_cartes');
    S.equipe = (S.acc.equipe || []).map((e) => S.cartes.find((c) => c.booster === e.booster && c.artist_id === e.artist && !!c.holo === !!e.holo)).filter(Boolean);
    if(S.equipe.length !== S.acc.taille) S.equipe = [];
  }

  function dessiner(){
    const hote = S.hote;
    const acc = S.acc;
    const n = acc.taille;
    const p = acc.prochain;
    const pct = Math.min(100, Math.round(acc.etage_max / acc.etages * 1000) / 10);
    const recompense = (r) => r.wc + ' WC' + (r.vinyles ? ' + ' + r.vinyles + ' vinyle' + (r.vinyles > 1 ? 's' : '') : '');
    // Une idée de la force des deux équipes (indicatif : le combat a ses rôles, ses passifs et ses critiques)
    const pe = p ? Math.round(p.crew.reduce((t, c) => t + score(c), 0)) : 0;
    const pm = Math.round(S.equipe.reduce((t, c) => t + score(c), 0));
    let verdict = '';
    if(p && S.equipe.length === n && pe > 0){
      const q = pm / pe;
      verdict = `<span class="tr-puce" title="Somme pondérée des statistiques">Puissance ${nf(pm)}</span><span class="tr-verdict ${q >= 1.25 ? 'ok' : (q >= .85 ? 'mid' : 'ko')}" title="Estimation : le combat dépend aussi des rôles et des passifs">${q >= 1.25 ? 'Favorable' : (q >= .85 ? 'Équilibré' : 'Difficile')}</span>`;
    }
    hote.innerHTML = `
      <div class="ct tr">
        <div class="ct-panneau">
          <h2>La Tour</h2>
          <p class="sous" style="margin:4px 0 0">${nf(acc.etages)} étages, un gardien tous les 10. Compose une équipe de ${n} cartes et pose-la : le combat se joue tout seul, en quelques secondes.</p>
          <div class="tr-progres">
            <div class="tr-progres-l"><span><b>${nf(acc.etage_max)}</b> / ${nf(acc.etages)} étages</span></div>
            <div class="tr-barre" title="${pct} %"><i style="width:${Math.max(pct, acc.etage_max ? 1 : 0)}%"></i></div>
          </div>
        </div>

        ${p ? `
        <div class="tr-vs">
        <div class="ct-panneau tr-etage" style="margin-top:16px">
          <div class="tr-etage-t"><h3>${esc(p.nom)}</h3>${p.gardien ? '<span class="tr-puce or">Gardien</span>' : ''}<span class="tr-puce">Adversaires ${p.bonus >= 0 ? '+' : ''}${p.bonus} %</span><span class="tr-puce">Puissance ${nf(pe)}</span>
            <span class="tr-puce">Récompense : ${esc(recompense(p.recompense))}</span></div>
          <div class="tr-rang" style="--n:${n}">${p.crew.map((u) => `<div class="tr-u">${carte(u)}${statsMini(u)}</div>`).join('')}</div>
        </div>

        <div class="ct-panneau" style="margin-top:16px">
          <div class="tr-etage-t" style="margin-bottom:4px"><h3 style="margin:0">Mon équipe</h3>${verdict}</div>
          <p class="sous" style="margin:0 0 12px">Chaque carte attaque celle d'en face : la 1<sup>re</sup> affronte la 1<sup>re</sup> carte adverse, et ainsi de suite.</p>
          <div class="tr-slots" style="--n:${n}">${Array.from({ length: n }, (_, i) => S.equipe[i]
            ? `<div class="tr-slot"><div class="tr-slot-n"><i>${i + 1}</i></div>${carte(S.equipe[i])}${statsMini(S.equipe[i])}</div>`
            : `<div class="tr-slot"><div class="tr-slot-n"><i>${i + 1}</i></div><div class="tr-vide">Libre</div></div>`).join('')}</div>
          <div class="tr-actions">
            <button type="button" class="ct-btn" data-equipe>${S.equipe.length ? 'Changer mon équipe' : 'Choisir mon équipe'}</button>
            <button type="button" class="ct-btn principal" data-lancer ${S.equipe.length === n ? '' : 'disabled'}>Combattre l'étage ${p.etage}</button>
          </div>
          ${S.cartes.length < n ? `<p class="sous" style="margin:12px 0 0">Il te faut au moins ${n} cartes : ouvre des packs dans l'onglet Accueil.</p>` : ''}
        </div>
        </div>` : `
        <div class="ct-panneau ct-vide" style="margin-top:16px"><b>Tu as gravi toute la Tour !</b>Les ${nf(acc.etages)} étages sont franchis.</div>`}

        ${acc.gardiens.length ? `
        <div class="ct-panneau" style="margin-top:16px">
          <h3 style="margin:0 0 10px">Prochains gardiens</h3>
          <div class="tr-gardiens">${acc.gardiens.map((g) => `<div class="tr-g"><b>${g.etage}</b>${esc(recompense(g.recompense))}</div>`).join('')}</div>
        </div>` : ''}
      </div>`;
    const be = hote.querySelector('[data-equipe]');
    if(be) be.addEventListener('click', composerEquipe);
    const bl = hote.querySelector('[data-lancer]');
    if(bl) bl.addEventListener('click', () => lancer(null));
  }

  // ---------------------------------------------------------------------
  // Composer l'équipe : la grille de la Collection, avec recherche, filtre de rareté et tri
  // ---------------------------------------------------------------------

  const TRIS = [['rarete', 'Rareté'], ['score', 'Meilleures'], ['niveau', 'Niveau'], ['pui', 'Puissance'], ['pv', 'PV'], ['def', 'Défense'], ['vit', 'Vitesse'], ['nom', 'Nom (A–Z)'], ['numero', 'Numéro']];
  const GROUPES = [[0, 'Toutes'], [1, 'Commun'], [2, 'Rare'], [3, 'Épique'], [4, 'Légendaire'], [6, 'Spécial']];
  const PAR_PAGE = 60;

  function composerEquipe(){
    const n = S.acc.taille;
    let choix = S.equipe.slice();
    let nb = PAR_PAGE;
    const f = A.fenetre('<div data-ed></div>', true);
    const ed = f.corps.querySelector('[data-ed]');

    const tri = {
      rarete: (a, b) => b.rarete - a.rarete || score(b) - score(a),
      score: (a, b) => score(b) - score(a),
      niveau: (a, b) => (b.etoiles - a.etoiles) || (b.niveau - a.niveau) || (b.rarete - a.rarete),
      pui: (a, b) => b.pui - a.pui, pv: (a, b) => b.pv - a.pv, def: (a, b) => b.def - a.def, vit: (a, b) => b.vit - a.vit,
      nom: (a, b) => a.nom.localeCompare(b.nom, 'fr'), numero: (a, b) => (a.numero || 0) - (b.numero || 0)
    };
    const meilleure = () => {
      const r = []; const vus = new Set();
      for(const c of S.cartes.slice().sort(tri.score)){
        const k = c.booster + '|' + c.artist_id;
        if(vus.has(k)) continue;
        vus.add(k); r.push(c);
        if(r.length === n) break;
      }
      return r;
    };
    const visibles = () => {
      const q = sansAccent(S.q.trim());
      return S.cartes
        .filter((c) => (!S.rarete || (S.rarete === 4 ? (c.rarete === 4 || c.rarete === 5) : c.rarete === S.rarete)) && (!q || sansAccent(c.nom).includes(q) || sansAccent(c.titre).includes(q)))
        .sort(tri[S.tri] || tri.rarete);
    };
    const rang = (c) => choix.findIndex((x) => cle(x) === cle(c));

    // Le haut (emplacements) et la grille se redessinent séparément : la recherche garde le focus.
    function emplacements(){
      const zone = ed.querySelector('[data-slots]');
      zone.innerHTML = Array.from({ length: n }, (_, i) => choix[i]
        ? `<div class="tr-slot"><div class="tr-slot-carte">${carte(choix[i])}<button type="button" class="tr-x" data-retirer="${i}" aria-label="Retirer ${esc(choix[i].nom)}">✕</button></div>${statsMini(choix[i])}</div>`
        : `<div class="tr-slot"><div class="tr-vide">${i + 1}</div></div>`).join('');
      ed.querySelector('[data-ok]').disabled = choix.length !== n;
      ed.querySelector('[data-compte]').textContent = choix.length + ' / ' + n + ' cartes choisies';
      zone.querySelectorAll('[data-retirer]').forEach((b) => b.addEventListener('click', () => { choix.splice(Number(b.dataset.retirer), 1); tout(); }));
    }

    function grille(){
      const liste = visibles();
      const zone = ed.querySelector('[data-grille]');
      if(!S.cartes.length){ zone.innerHTML = '<div class="tr-aucune">Tu n\'as pas encore de carte : ouvre des packs dans l\'onglet Accueil.</div>'; return; }
      if(!liste.length){ zone.innerHTML = '<div class="tr-aucune"><b>Aucune carte</b><br>Rien ne correspond à cette recherche.</div>'; return; }
      zone.innerHTML = `<div class="ct-grille">${liste.slice(0, nb).map((c) => {
        const r = rang(c);
        return `<button type="button" class="ct-case tr-case${r >= 0 ? ' choisie' : ''}" data-c="${esc(cle(c))}" aria-pressed="${r >= 0}" aria-label="${esc(c.nom)}${r >= 0 ? ', place ' + (r + 1) : ''}">
          ${r >= 0 ? `<span class="tr-rang-n">${r + 1}</span>` : ''}${carte(c)}${statsMini(c)}</button>`;
      }).join('')}</div>${liste.length > nb ? `<div class="tr-actions" style="justify-content:center; margin-top:16px"><button type="button" class="ct-btn petit" data-plus>Afficher plus (${liste.length - nb})</button></div>` : ''}`;
      zone.querySelectorAll('[data-c]').forEach((b) => b.addEventListener('click', () => {
        const c = S.cartes.find((x) => cle(x) === b.dataset.c);
        const k = rang(c);
        if(k >= 0) choix.splice(k, 1);
        else if(choix.some((x) => x.artist_id === c.artist_id && x.booster === c.booster)){ A.toast('Une seule version de chaque carte.', 'err'); return; }
        else if(choix.length < n) choix.push(c);
        else { A.toast('Équipe complète : retire d\'abord une carte.', 'err'); return; }
        tout();
      }));
      const plus = zone.querySelector('[data-plus]');
      if(plus) plus.addEventListener('click', () => { nb += PAR_PAGE; grille(); });
    }

    function tout(){ emplacements(); grille(); }

    ed.innerHTML = `
      <div class="tr-sel">
        <div class="tr-sel-haut">
          <h2 style="margin:0 0 2px">Mon équipe</h2>
          <p class="sous" style="margin:0 0 10px">Touche ${n} cartes pour composer ton équipe.</p>
          <div class="tr-slots" style="--n:${n}" data-slots></div>
          <div class="tr-actions"><button type="button" class="ct-btn petit" data-auto>Meilleure équipe</button>
            <button type="button" class="ct-btn petit" data-vider>Vider</button></div>
        </div>
        <div class="ct-outils">
          <label class="ct-recherche">${A.ico('loupe', 17)}<input type="search" placeholder="Chercher un artiste ou un titre" value="${esc(S.q)}" data-q aria-label="Chercher une carte"></label>
          <div class="ct-segment" role="group" aria-label="Rareté">${GROUPES.map(([v, l]) => `<button type="button" data-rar="${v}" class="${S.rarete === v ? 'actif' : ''}" aria-pressed="${S.rarete === v}">${l}</button>`).join('')}</div>
          <select class="ct-select" data-tri aria-label="Trier">${TRIS.map(([v, l]) => `<option value="${v}"${S.tri === v ? ' selected' : ''}>${l}</option>`).join('')}</select>
        </div>
        <div data-grille></div>
        <div class="tr-sel-bas"><span data-compte></span><button type="button" class="ct-btn principal" data-ok>Valider l'équipe</button></div>
      </div>`;

    const champ = ed.querySelector('[data-q]');
    champ.addEventListener('input', () => { S.q = champ.value; nb = PAR_PAGE; grille(); });
    ed.querySelectorAll('[data-rar]').forEach((b) => b.addEventListener('click', () => {
      S.rarete = Number(b.dataset.rar); nb = PAR_PAGE;
      ed.querySelectorAll('[data-rar]').forEach((x) => { const on = Number(x.dataset.rar) === S.rarete; x.classList.toggle('actif', on); x.setAttribute('aria-pressed', on); });
      grille();
    }));
    ed.querySelector('[data-tri]').addEventListener('change', (ev) => { S.tri = ev.target.value; nb = PAR_PAGE; grille(); });
    ed.querySelector('[data-auto]').addEventListener('click', () => { choix = meilleure(); tout(); });
    ed.querySelector('[data-vider]').addEventListener('click', () => { choix = []; tout(); });
    ed.querySelector('[data-ok]').addEventListener('click', () => { S.equipe = choix; f.fermer(); dessiner(); });
    tout();
  }

  // ---------------------------------------------------------------------
  // Le combat : la base le joue, on le rejoue
  // ---------------------------------------------------------------------

  async function lancer(etage){
    const bl = S.hote && S.hote.querySelector('[data-lancer]');
    if(bl) bl.disabled = true;
    let r;
    try{
      r = await A.appel('combat_tour_lancer', { p_etage: etage, p_equipe: S.equipe.map((c) => ({ booster: c.booster, artist: c.artist_id, holo: !!c.holo })) });
    }catch(e){
      A.toast(e.message, 'err');
      if(bl) bl.disabled = false;
      return;
    }
    if(r.etat && A.poserEtat){ A.poserEtat(r.etat); if(A.majEntete) A.majEntete(); }
    await jouer(r);
  }

  function fermerScene(){
    if(S.scene){
      S.scene.fini = true;
      if(S.scene.clavier) document.removeEventListener('keydown', S.scene.clavier);
      if(S.scene.moteur) S.scene.moteur.arreter();
      if(S.scene.detruire) S.scene.detruire();
      if(S.scene.ov) S.scene.ov.remove();
      S.scene = null;
    }
  }

  // La vitesse choisie (×1, ×2, ×3) est gardée d'un combat à l'autre.
  const VITESSE_CLE = 'wc-combat-vitesse';
  const vitesseSauvee = () => { try{ const v = Number(localStorage.getItem(VITESSE_CLE)); return v >= 1 && v <= 3 ? v : 1; }catch(e){ return 1; } };
  const sauverVitesse = (v) => { try{ localStorage.setItem(VITESSE_CLE, String(v)); }catch(e){ /* sans mémoire */ } };

  // La qualité de la scène 3D : une machine qui a peiné démarre allégée les fois suivantes (retenu une semaine).
  const QUALITE_CLE = 'wc-combat-qualite';
  const qualiteBasse = () => { try{ const d = Number(localStorage.getItem(QUALITE_CLE)); return d > 0 && Date.now() - d < 7 * 864e5; }catch(e){ return false; } };
  const noterQualiteBasse = () => { try{ localStorage.setItem(QUALITE_CLE, String(Date.now())); }catch(e){ /* sans mémoire */ } };

  const webglOk = () => { try{ const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); }catch(e){ return false; } };
  const chargerImage = (url) => new Promise((ok) => {
    if(!url) return ok(null);
    const i = new Image();
    i.crossOrigin = 'anonymous';
    i.onload = () => ok(i); i.onerror = () => ok(null);
    i.src = url;
  });

  // ---------------------------------------------------------------------
  // Le moteur de la scène : une seule horloge pour tout (la 3D, l'interface, les nombres), à la vitesse choisie.
  //   tw(durée, f, courbe)  joue f(0 → 1) ; att(durée) attend ; geler(durée) fige l'action un instant (l'arrêt sur image
  //   d'un coup qui porte) ; pas(dt) avance d'une image (appelé par le navigateur, ou à la main pour les essais).
  // ---------------------------------------------------------------------

  const ease = {
    lin: (t) => t, out: (t) => 1 - Math.pow(1 - t, 3), in: (t) => t * t * t, io: (t) => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
    back: (t) => { const c = 1.70158; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); }
  };

  function creerMoteur(sc){
    const tweens = [], images = [];
    let raf = 0, dernier = 0, gel = 0, ralenti = 1, arrete = false;
    const M = {
      t: 0,
      tw(dur, f, fn){
        return new Promise((ok) => {
          if(sc.passer || sc.fini || !(dur > 0)){ if(!sc.fini){ try{ f(1); }catch(e){ /* l'élément a disparu */ } } ok(); return; }
          tweens.push({ t: 0, dur, f, fn: fn || ease.lin, ok });
        });
      },
      att(s){ return M.tw(s, () => {}); },
      geler(s){ if(!sc.passer) gel = Math.max(gel, s); },
      ralentir(k){ ralenti = Math.min(ralenti, k); },
      gele(){ return gel > 0; },
      surImage(f){ images.push(f); },
      pas(brut){
        if(arrete) return;
        brut = Math.min(Math.max(brut, 0), .05);
        ralenti += (1 - ralenti) * Math.min(1, brut * 4);
        const v = brut * sc.vitesse;
        let dt = v * ralenti;
        if(gel > 0){ gel -= v; dt = 0; }
        M.t += v;
        if(sc.passer){
          let garde = 0;
          while(tweens.length && garde++ < 5000){ const w = tweens.shift(); try{ w.f(1); }catch(e){ /* l'élément a disparu */ } w.ok(); }
        }else{
          for(let k = tweens.length - 1; k >= 0; k--){
            const w = tweens[k]; w.t += dt;
            const p = Math.min(1, w.t / w.dur);
            try{ w.f(w.fn(p)); }catch(e){ /* l'élément a disparu */ }
            if(p >= 1){ tweens.splice(tweens.indexOf(w), 1); w.ok(); }
          }
        }
        for(const f of images) f(brut, v, dt);
      },
      demarrer(){
        if(sc.manuel) return;
        const b = (h) => { if(arrete) return; raf = requestAnimationFrame(b); const d = dernier ? (h - dernier) / 1000 : 1 / 60; dernier = h; M.pas(d); };
        raf = requestAnimationFrame(b);
      },
      arreter(){ arrete = true; cancelAnimationFrame(raf); const reste = tweens.splice(0); reste.forEach((w) => w.ok()); }
    };
    return M;
  }

  // Une jauge de PV : la barre suit tout de suite, une traînée blanche la rattrape après un instant (on voit ce qu'on vient de perdre).
  const creerJauge = (i, u) => {
    const j = {
      c: 1, a: 1, g: 1, w: 0, wi: '', wu: '',
      poser(x){ x = Math.max(0, Math.min(1, x)); if(x < j.c) j.w = .32; j.c = x; },
      image(v, direct){
        if(direct){ j.a = j.g = j.c; }
        else{
          j.a += (j.c - j.a) * Math.min(1, v * 14);
          if(j.g < j.a) j.g = j.a;
          else if(j.w > 0) j.w -= v;
          else j.g += (j.a - j.g) * Math.min(1, v * 6);
        }
        const wi = (j.a * 100).toFixed(1) + '%', wu = (j.g * 100).toFixed(1) + '%';
        if(wi !== j.wi){ j.wi = wi; i.style.width = wi; }
        if(u && wu !== j.wu){ j.wu = wu; u.style.width = wu; }
      }
    };
    return j;
  };

  // Les sons du combat : synthétisés avec le moteur de son du jeu (A.Son), donc coupés par le même bouton. Sourds et ronds, dans le ton du jeu.
  const ton = (a, So, t, type, f0, f1, dur, vol, envoi) => {
    const o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t);
    if(f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(.0001, t); g.gain.linearRampToValueAtTime(vol, t + Math.min(.012, dur * .2)); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    o.connect(g); So.vers(g, envoi || 0); o.start(t); o.stop(t + dur + .03);
  };
  const souffle = (a, So, t, f0, f1, dur, vol, q, type) => {
    const s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
    s.buffer = So.bruitBuf(); s.loop = true;
    f.type = type || 'bandpass'; f.Q.value = q || 1; f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    g.gain.setValueAtTime(.0001, t); g.gain.linearRampToValueAtTime(vol, t + dur * .2); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    s.connect(f); f.connect(g); So.vers(g, .08); s.start(t, Math.random() * .5); s.stop(t + dur + .03);
  };
  const SONS = {
    pose: (a, o, t) => { ton(a, o, t, 'sine', 210, 96, .12, .14); souffle(a, o, t, 900, 300, .1, .05, .8, 'lowpass'); },
    elan: (a, o, t) => souffle(a, o, t, 500, 2300, .16, .11, 1.2),
    coup: (a, o, t) => { souffle(a, o, t, 1900, 300, .1, .2, .7, 'lowpass'); ton(a, o, t, 'sine', 150, 48, .16, .24); },
    lourd: (a, o, t) => { souffle(a, o, t, 1400, 140, .22, .22, .7, 'lowpass'); ton(a, o, t, 'sine', 112, 34, .3, .25); },
    critique: (a, o, t) => { souffle(a, o, t, 2400, 200, .2, .24, .7, 'lowpass'); ton(a, o, t, 'sine', 130, 30, .36, .25); ton(a, o, t, 'square', 640, 170, .14, .05); },
    lance: (a, o, t) => { ton(a, o, t, 'triangle', 420, 980, .12, .09); souffle(a, o, t, 900, 2600, .12, .05, 1.4); },
    onde: (a, o, t) => { ton(a, o, t, 'sine', 74, 50, .46, .25); ton(a, o, t, 'sawtooth', 148, 60, .3, .04); },
    charge: (a, o, t) => { ton(a, o, t, 'triangle', 220, 880, .42, .08, .2); souffle(a, o, t, 300, 2400, .42, .06, 1.5); },
    soin: (a, o, t) => [523, 659, 784].forEach((f, i) => ton(a, o, t + i * .07, 'sine', f, f, .24, .09, .3)),
    bouclier: (a, o, t) => { ton(a, o, t, 'sine', 392, 392, .32, .09, .3); ton(a, o, t + .05, 'sine', 587, 587, .3, .07, .3); },
    epines: (a, o, t) => ton(a, o, t, 'square', 880, 440, .08, .04),
    passif: (a, o, t) => ton(a, o, t, 'triangle', 660, 990, .18, .07, .3),
    ko: (a, o, t) => { souffle(a, o, t, 1600, 80, .5, .2, .8, 'lowpass'); ton(a, o, t, 'sine', 180, 36, .5, .22); },
    tour: (a, o, t) => ton(a, o, t, 'sine', 740, 740, .07, .05, .2),
    vs: (a, o, t) => { ton(a, o, t, 'sine', 92, 34, .5, .25); souffle(a, o, t, 2000, 120, .4, .13, .7, 'lowpass'); },
    combat: (a, o, t) => { ton(a, o, t, 'triangle', 330, 660, .16, .1); ton(a, o, t + .12, 'triangle', 660, 660, .28, .11, .3); },
    victoire: (a, o, t) => { [523, 659, 784, 1047].forEach((f, i) => ton(a, o, t + i * .11, 'triangle', f, f, i === 3 ? .6 : .2, .12, .35)); ton(a, o, t, 'sine', 131, 131, .7, .14); },
    defaite: (a, o, t) => [392, 349, 311, 262].forEach((f, i) => ton(a, o, t + i * .16, 'triangle', f, f, i === 3 ? .7 : .26, .1, .35)),
    gain: (a, o, t) => ton(a, o, t, 'sine', 880, 1320, .1, .06, .2)
  };
  const bruit = (nom, sc) => {
    if(sc && (sc.passer || sc.fini)) return;
    const So = A && A.Son;
    if(!So || !So.pret || !SONS[nom]) return;
    try{ const a = So.pret(); if(a) SONS[nom](a, So, a.currentTime + .005); }catch(e){ /* pas de son : tant pis */ }
  };

  // ---------------------------------------------------------------------
  // Le combat à l'écran : l'interface (commune), puis un « acteur » qui rejoue le déroulé — la scène 3D (WebGL) ou, à défaut,
  // la scène à plat. Même interface pour les deux : intro(), evenement(ev), fin(victoire), detruire().
  // ---------------------------------------------------------------------

  async function jouer(r, options){
    fermerScene();
    const o = options || {};
    const son = () => !!(A.Son && A.Son.actif && A.Son.actif());
    const ov = document.createElement('div');
    ov.className = 'cbt';
    ov.innerHTML = `
      <div class="cbt-corps" data-corps></div>
      <div class="cbt-vig"></div><div class="cbt-nuit" data-nuit></div><div class="cbt-rouge" data-rouge></div>
      <div class="cbt-haut">
        <div class="cbt-camp ami"><div class="cbt-camp-t"><b>Ton équipe</b><span data-pvt="0"></span></div><div class="cbt-jauge" data-jauge="0"><u></u><i></i></div></div>
        <div class="cbt-centre"><small>${r.gardien ? 'Gardien · ' : ''}Étage ${nf(r.etage)}</small><b data-tour>Prêts ?</b></div>
        <div class="cbt-camp ennemi"><div class="cbt-camp-t"><b>${esc(r.nom)}</b><span data-pvt="1"></span></div><div class="cbt-jauge" data-jauge="1"><u></u><i></i></div></div>
      </div>
      <div class="cbt-ordre" data-ordre aria-label="Ordre de jeu"></div>
      <div class="cbt-log" data-log aria-live="off"></div>
      <div class="cbt-fx" data-fx></div>
      <div class="cbt-bas">
        <button type="button" class="cbt-btn" data-son aria-label="${son() ? 'Couper le son' : 'Remettre le son'}">${A.ico ? A.ico(son() ? 'son' : 'muet', 18) : 'Son'}</button>
        <button type="button" class="cbt-btn" data-vitesse aria-label="Changer la vitesse">×1</button>
        <button type="button" class="cbt-btn" data-passer>Passer</button>
      </div>`;
    document.body.appendChild(ov);
    const sc = { ov, fini: false, vitesse: vitesseSauvee(), passer: calme(), detruire: null, clavier: null, moteur: null, manuel: !!o.manuel };
    S.scene = sc;
    const M = sc.moteur = creerMoteur(sc);
    const bVitesse = ov.querySelector('[data-vitesse]'), bSon = ov.querySelector('[data-son]');
    bVitesse.textContent = '×' + sc.vitesse;
    const changerVitesse = () => { sc.vitesse = sc.vitesse >= 3 ? 1 : sc.vitesse + 1; bVitesse.textContent = '×' + sc.vitesse; sauverVitesse(sc.vitesse); };
    bVitesse.addEventListener('click', changerVitesse);
    ov.querySelector('[data-passer]').addEventListener('click', () => { sc.passer = true; });
    bSon.addEventListener('click', () => {
      if(!A.Son || !A.Son.basculer) return;
      A.Son.basculer();
      bSon.innerHTML = A.ico ? A.ico(son() ? 'son' : 'muet', 18) : 'Son';
      bSon.setAttribute('aria-label', son() ? 'Couper le son' : 'Remettre le son');
      if(A.majEntete){ try{ A.majEntete(); }catch(e){ /* l'en-tête n'est pas à l'écran */ } }
    });
    // Espace : changer de vitesse ; Échap : passer le combat
    sc.clavier = (e) => {
      if(e.key === 'Escape'){ sc.passer = true; }
      else if((e.key === ' ' || e.code === 'Space') && !(e.target && e.target.closest && e.target.closest('button, input, select, textarea'))){ e.preventDefault(); changerVitesse(); }
    };
    document.addEventListener('keydown', sc.clavier);
    const corps = ov.querySelector('[data-corps]');
    const I = creerInterface(r, sc, M);
    M.demarrer();

    // L'écran de présentation couvre la préparation de la scène (textures, cartes), puis s'ouvre dessus.
    const vs = I.vs();
    let acteur = null;
    if(!o.sans3d){ try{ acteur = await creerActeur3d(r, sc, corps, I); }catch(e){ acteur = null; if(window.console) console.warn('Combat : scène 3D indisponible', e); } }
    if(sc.fini) return;
    if(!acteur){ corps.innerHTML = ''; acteur = creerActeur2d(r, sc, corps, I); }
    sc.detruire = () => { try{ acteur.detruire(); }catch(e){ /* déjà fermé */ } };
    await vs.pret;
    if(sc.fini) return;
    vs.ouvrir();
    await acteur.intro();
    for(const ev of r.evenements){
      if(sc.fini) return;
      I.suivi(ev);
      await acteur.evenement(ev);
    }
    if(sc.fini) return;
    I.finOrdre();
    await acteur.fin(!!r.victoire);
    if(sc.fini) return;
    finir(r, sc, I.stats);
  }

  // L'interface du combat : les jauges d'équipe, l'ordre de jeu, le journal, les nombres et les bandeaux. Tout est animé par le moteur.
  function creerInterface(r, sc, M){
    const ov = sc.ov, q = (s) => ov.querySelector(s);
    const fx = q('[data-fx]'), ordre = q('[data-ordre]'), log = q('[data-log]'), nuit = q('[data-nuit]'), rouge = q('[data-rouge]'), elTour = q('[data-tour]');
    const camps = [r.a, r.b];
    const pv = camps.map((l) => l.map((u) => u.pv_max));
    const totMax = camps.map((l) => l.reduce((t, u) => t + u.pv_max, 0) || 1);
    const jauges = [0, 1].map((c) => { const j = q('[data-jauge="' + c + '"]'); return creerJauge(j.querySelector('i'), j.querySelector('u')); });
    const txt = [0, 1].map((c) => q('[data-pvt="' + c + '"]'));
    const majTotal = (c) => { const t = pv[c].reduce((x, y) => x + Math.max(0, y), 0); jauges[c].poser(t / totMax[c]); txt[c].textContent = nf(t); };
    majTotal(0); majTotal(1);
    let nuitA = 0, nuitC = 0, nuitS = '', rougeA = 0;
    M.surImage((brut, v) => {
      jauges[0].image(v, sc.passer); jauges[1].image(v, sc.passer);
      nuitA += (nuitC - nuitA) * Math.min(1, brut * 9);
      const s = nuitA < .01 ? '0' : nuitA.toFixed(2);
      if(s !== nuitS){ nuitS = s; nuit.style.opacity = s; nuit.style.visibility = s === '0' ? 'hidden' : 'visible'; }   // un voile éteint ne coûte plus rien à composer
      if(rougeA > 0){ rougeA = Math.max(0, rougeA - brut * 2.4); rouge.style.opacity = rougeA.toFixed(2); if(rougeA <= 0) rouge.style.visibility = 'hidden'; }
    });

    // l'ordre de jeu (par Vitesse), le journal des derniers coups et le bilan du combat
    const stats = { degats: r.a.map(() => 0), crits: 0, soins: 0, meilleur: { d: 0, nom: '' } };
    const unites = [...r.a.map((u, i) => ({ u, c: 0, p: i + 1 })), ...r.b.map((u, i) => ({ u, c: 1, p: i + 1 }))].sort((x, y) => y.u.vit - x.u.vit);
    ordre.innerHTML = unites.map(({ u, c, p }) => `<span class="cbt-ch${c ? ' e' : ''}" data-ch="${c}-${p}" style="background-image:url('${esc(A.safeUrl(u.photo))}')" title="${esc(u.nom)} · Vitesse ${u.vit}"></span>`).join('');
    const ligne = (html) => {
      if(sc.passer) return;
      const d = document.createElement('div'); d.innerHTML = html; log.appendChild(d);
      while(log.children.length > 3) log.firstChild.remove();
      setTimeout(() => d.remove(), 5200);
    };
    const nomDe = (c, p) => ((c === 0 ? r.a : r.b)[p - 1] || {}).nom || '?';
    const cl = (c) => (c === 0 ? 'a' : 'e');
    const puce = (c, p) => ordre.querySelector(`[data-ch="${c}-${p}"]`);
    const eteindre = () => ordre.querySelectorAll('.on').forEach((x) => x.classList.remove('on'));
    const suivi = (ev) => {
      if(ev.t === 'tour'){ eteindre(); return; }
      if(ev.a){ eteindre(); const x = puce(ev.a[0], ev.a[1]); if(x) x.classList.add('on'); }
      if(ev.t === 'att'){
        ligne(`<span class="${cl(ev.a[0])}">${esc(nomDe(ev.a[0], ev.a[1]))}</span> → <span class="${cl(ev.c[0])}">${esc(nomDe(ev.c[0], ev.c[1]))}</span> <b>−${nf(ev.d)}</b>${ev.k ? ' <span class="k">CRITIQUE</span>' : ''}`);
        if(ev.a[0] === 0){
          stats.degats[ev.a[1] - 1] += ev.d;
          if(ev.k) stats.crits++;
          if(ev.d > stats.meilleur.d) stats.meilleur = { d: ev.d, nom: nomDe(ev.a[0], ev.a[1]) };
        }
      }else if(ev.t === 'zone'){
        const tot = ev.x.reduce((t, h) => t + h.d, 0);
        ligne(`<span class="${cl(ev.a[0])}">${esc(nomDe(ev.a[0], ev.a[1]))}</span> <b>−${nf(tot)}</b> sur toute l'équipe${ev.x.some((h) => h.k) ? ' <span class="k">CRITIQUE</span>' : ''}`);
        if(ev.a[0] === 0){
          stats.degats[ev.a[1] - 1] += tot;
          stats.crits += ev.x.filter((h) => h.k).length;
          if(tot > stats.meilleur.d) stats.meilleur = { d: tot, nom: nomDe(ev.a[0], ev.a[1]) };
        }
      }else if(ev.t === 'soin' && ev.x){
        const tot = ev.x.reduce((t, h) => t + h.d, 0);
        ligne(`<span class="${cl(ev.a[0])}">${esc(nomDe(ev.a[0], ev.a[1]))}</span> soigne <span class="v">+${nf(tot)} PV</span>`);
        if(ev.a[0] === 0) stats.soins += tot;
      }else if(ev.t === 'bouclier'){
        ligne(`<span class="${cl(ev.a[0])}">${esc(nomDe(ev.a[0], ev.a[1]))}</span> pose un bouclier`);
      }else if(ev.t === 'ko'){
        const x = puce(ev.c[0], ev.c[1]); if(x){ x.classList.add('ko'); x.classList.remove('on'); }
        ligne(`<span class="${cl(ev.c[0])}">${esc(nomDe(ev.c[0], ev.c[1]))}</span> est K.O.`);
      }
    };

    // un élément d'interface éphémère, animé par le moteur (donc à la vitesse du combat, et figé par l'arrêt sur image)
    const dom = (html, classe, dur, f, fn) => {
      if(sc.passer || sc.fini) return Promise.resolve();
      const d = document.createElement('div'); d.className = classe; d.innerHTML = html; fx.appendChild(d);
      f(0, d);
      return M.tw(dur, (k) => f(k, d), fn).then(() => d.remove());
    };
    const portraits = (l) => l.map((u) => `<span style="background-image:url('${esc(A.safeUrl(u.photo))}')"></span>`).join('');

    return {
      stats, suivi,
      finOrdre: eteindre,
      pv(c, p, valeur){ pv[c][p - 1] = valeur; majTotal(c); },
      assombrir(x){ nuitC = x; },
      eclatRouge(){ if(!sc.passer){ rougeA = 1; rouge.style.visibility = 'visible'; } },
      // un nombre qui jaillit d'une carte (dégâts, soins, bouclier) ; xy() donne sa place à l'écran à chaque image
      nombre(xy, html, classe){
        const dx = (Math.random() - .5) * 40, sens = Math.random() < .5 ? -1 : 1, gros = classe === 'crit';
        return dom(html, 'cbt-nb ' + (classe || ''), gros ? 1.15 : .95, (k, d) => {
          const p = xy();
          const s = k < .1 ? .4 + 1.2 * (k / .1) : (k < .24 ? 1.6 - .6 * ((k - .1) / .14) : 1);
          const y = -14 - 52 * ease.out(k), x = dx + sens * 12 * k;
          d.style.opacity = k > .72 ? String(Math.max(0, 1 - (k - .72) / .28)) : '1';
          d.style.transform = `translate3d(${(p.x + x).toFixed(1)}px, ${(p.y + y).toFixed(1)}px, 0) translate(-50%, -50%) scale(${s.toFixed(3)}) rotate(${gros ? -4 : 0}deg)`;
        });
      },
      etiquette(xy, texte, classe){
        if(!texte) return Promise.resolve();
        return dom(esc(texte), 'cbt-et ' + (classe || ''), 1, (k, d) => {
          const p = xy(), s = k < .12 ? .6 + .4 * (k / .12) : 1;
          d.style.opacity = k > .78 ? String(Math.max(0, 1 - (k - .78) / .22)) : '1';
          d.style.transform = `translate3d(${p.x.toFixed(1)}px, ${(p.y - 8 * ease.out(k)).toFixed(1)}px, 0) translate(-50%, -50%) scale(${s.toFixed(3)})`;
        });
      },
      // un nouveau tour : le compteur du haut change et saute
      tour(n){
        elTour.textContent = 'Tour ' + n;
        return M.tw(.4, (k) => { elTour.style.transform = `scale(${(1 + (1 - ease.out(k)) * .9).toFixed(3)})`; elTour.style.color = k < .7 ? '#ffd76a' : ''; }).then(() => { elTour.style.transform = ''; elTour.style.color = ''; });
      },
      // un ruban qui traverse l'écran : « Combat ! »
      ruban(texte, classe){
        return dom(`<span>${esc(texte)}</span>`, 'cbt-ruban ' + (classe || ''), classe === 'go' ? 1 : .8, (k, d) => {
          const e = k < .16 ? ease.out(k / .16) : (k > .8 ? 1 - ease.in((k - .8) / .2) : 1);
          d.style.opacity = e.toFixed(2);
          d.style.transform = `scaleY(${(.15 + .85 * e).toFixed(3)})`;
          d.firstChild.style.transform = `translateX(${((.5 - k) * 46).toFixed(1)}px) scale(${(1 + (1 - e) * .5).toFixed(3)})`;
        });
      },
      // le bandeau d'un coup signature : la pochette et le nom de la carte qui traversent l'écran
      cutIn(u, c){
        const s = c === 0 ? -1 : 1;
        return dom(`<div class="cbt-cut-img" style="background-image:url('${esc(A.safeUrl(u.photo))}')"></div><div class="cbt-cut-t"><small>Coup signature</small><b>${esc(u.nom)}</b></div>`, 'cbt-cut ' + (c === 0 ? 'ami' : 'ennemi'), .72, (k, d) => {
          const e = k < .22 ? ease.out(k / .22) : (k > .76 ? 1 + ease.in((k - .76) / .24) : 1);
          const x = k < .22 ? s * (1 - e) * 110 : (k > .76 ? -s * (e - 1) * 110 : -s * (k - .22) * 5);
          d.style.transform = `translateX(${x.toFixed(1)}%) rotate(-6deg)`;
          d.style.setProperty('--x', Math.round(-s * k * 420) + 'px');
        });
      },
      // l'écran « VS » : les deux équipes se font face, puis les volets s'écartent sur la scène
      vs(){
        if(sc.passer) return { pret: Promise.resolve(), ouvrir(){} };
        const d = document.createElement('div'); d.className = 'cbt-vs';
        d.innerHTML = `
          <div class="cbt-vs-p ami"><small>Ton équipe</small><div class="cbt-vs-l">${portraits(r.a)}</div></div>
          <div class="cbt-vs-p ennemi"><small>${r.gardien ? 'Gardien' : 'Adversaires'}</small><b>${esc(r.nom)}</b><div class="cbt-vs-l">${portraits(r.b)}</div></div>
          <div class="cbt-vs-c">VS</div>
          <div class="cbt-vs-e">Étage ${nf(r.etage)} sur ${nf(r.etages)}</div>`;
        fx.appendChild(d);
        const pa = d.children[0], pb = d.children[1], vc = d.children[2], ve = d.children[3];
        let tape = false;
        const poser = (k) => {
          const e = ease.out(Math.min(1, k / .6));
          pa.style.transform = `translateX(${(-(1 - e) * 102).toFixed(1)}%)`; pb.style.transform = `translateX(${((1 - e) * 102).toFixed(1)}%)`;
          const z = Math.max(0, (k - .5) / .5);
          vc.style.opacity = z > 0 ? '1' : '0'; ve.style.opacity = z.toFixed(2);
          vc.style.transform = `translate(-50%, -50%) scale(${(1 + (1 - ease.out(z)) * 2.4).toFixed(3)}) rotate(-6deg)`;
          if(z > 0 && !tape){ tape = true; bruit('vs', sc); }
        };
        poser(0);
        const pret = M.tw(.6, poser).then(() => M.att(.8));
        return {
          pret,
          ouvrir(){
            M.tw(.4, (k) => {
              const e = ease.in(k);
              pa.style.transform = `translateX(${(-e * 104).toFixed(1)}%)`; pb.style.transform = `translateX(${(e * 104).toFixed(1)}%)`;
              vc.style.opacity = ve.style.opacity = (1 - k).toFixed(2);
              vc.style.transform = `translate(-50%, -50%) scale(${(1 + e * 1.6).toFixed(3)}) rotate(-6deg)`;
            }).then(() => d.remove());
          }
        };
      },
      // le mot de la fin, en grand
      titre(victoire){
        return dom(`<b>${victoire ? 'Victoire' : 'Défaite'}</b>`, 'cbt-titre ' + (victoire ? 'v' : 'd'), 1.5, (k, d) => {
          const e = k < .16 ? ease.out(k / .16) : 1;
          d.style.opacity = k > .86 ? String(Math.max(0, 1 - (k - .86) / .14)) : e.toFixed(2);
          d.firstChild.style.transform = `scale(${(victoire ? 1 + (1 - e) * 1.8 + k * .06 : .9 + .1 * e).toFixed(3)}) translateY(${(victoire ? 0 : (1 - e) * -40).toFixed(1)}px) rotate(${victoire ? -3 : 0}deg)`;
          d.firstChild.style.letterSpacing = (victoire ? .04 : .04 + k * .12).toFixed(3) + 'em';
        });
      }
    };
  }

  // ---------------------------------------------------------------------
  // La scène à plat (repli : pas de WebGL, ou mouvement réduit — tout se joue alors d'un coup)
  // ---------------------------------------------------------------------

  function creerActeur2d(r, sc, corps, I){
    const M = sc.moteur;
    const unite = (u, c, i) => `<div class="tr-uc" data-u="${c}-${i + 1}">${carte(u)}<div class="tr-pv"><i></i></div><div class="tr-pvn">${nf(u.pv_max)}</div></div>`;
    corps.innerHTML = `
      <div class="tr-fond" style="background-image:url(img/combat/olympia-fond.png?v=5)"></div>
      <div class="tr-terrain">
        <div class="tr-ligne" style="--n:${r.b.length}">${r.b.map((u, i) => unite(u, 1, i)).join('')}</div>
        <div class="tr-ligne" style="--n:${r.a.length}">${r.a.map((u, i) => unite(u, 0, i)).join('')}</div>
      </div>`;
    const pvmax = { '0': r.a.map((u) => u.pv_max), '1': r.b.map((u) => u.pv_max) };
    const el = (c, p) => corps.querySelector(`[data-u="${c}-${p}"]`);
    const xy = (c, p) => () => {
      const u = el(c, p); if(!u) return { x: 0, y: 0 };
      const b = corps.getBoundingClientRect(), q = u.getBoundingClientRect();
      return { x: q.left - b.left + q.width / 2, y: q.top - b.top + q.height * .4 };
    };
    const majPv = (c, p, pv) => {
      I.pv(c, p, pv);
      const u = el(c, p); if(!u) return;
      const m = pvmax[c][p - 1];
      u.querySelector('.tr-pv i').style.width = Math.max(0, pv / m * 100) + '%';
      u.querySelector('.tr-pv').classList.toggle('bas', pv / m < .35);
      u.querySelector('.tr-pvn').textContent = nf(Math.max(0, pv));
    };
    const avance = (a, cote) => { if(a && !sc.passer) a.style.transform = `translateY(${cote === 0 ? -22 : 22}px) scale(1.06)`; };
    const secoue = (t) => { if(t && !sc.passer){ t.classList.add('touche'); setTimeout(() => t.classList.remove('touche'), 320); } };
    const coup = (h, sig) => {
      secoue(el(h.c[0], h.c[1]));
      I.nombre(xy(h.c[0], h.c[1]), (h.k ? '<small>Critique !</small>' : '') + '−' + nf(h.d), h.k ? 'crit' : (sig ? 'sig' : ''));
      if(h.k) I.eclatRouge();
      bruit(h.k ? 'critique' : 'coup', sc);
      majPv(h.c[0], h.c[1], h.pv);
    };
    return {
      async intro(){ I.ruban('Combat !', 'go'); bruit('combat', sc); await M.att(.7); },
      async evenement(ev){
        if(ev.t === 'tour'){ I.tour(ev.n); await M.att(.4); }
        else if(ev.t === 'passif'){ I.etiquette(xy(ev.c[0], ev.c[1]), ev.n); await M.att(.4); }
        else if(ev.t === 'att' || ev.t === 'zone'){
          const a = el(ev.a[0], ev.a[1]);
          if(ev.s) I.cutIn((ev.a[0] === 0 ? r.a : r.b)[ev.a[1] - 1], ev.a[0]);
          avance(a, ev.a[0]);
          await M.att(.22);
          (ev.t === 'att' ? [ev] : ev.x).forEach((h) => coup(h, ev.s));
          if(a) a.style.transform = '';
          await M.att(.36);
        }else if(ev.t === 'soin' && ev.x){
          bruit('soin', sc);
          ev.x.forEach((h) => { I.nombre(xy(h.c[0], h.c[1]), '+' + nf(h.d), 'soin'); majPv(h.c[0], h.c[1], h.pv); });
          await M.att(.45);
        }else if(ev.t === 'bouclier'){
          bruit('bouclier', sc);
          ev.x.forEach((h) => I.nombre(xy(h.c[0], h.c[1]), '🛡 +' + nf(h.d), 'bou'));
          await M.att(.45);
        }else if(ev.t === 'epines'){
          I.nombre(xy(ev.c[0], ev.c[1]), '−' + nf(ev.d), 'ref');
          majPv(ev.c[0], ev.c[1], ev.pv);
          await M.att(.3);
        }else if(ev.t === 'soin'){
          I.nombre(xy(ev.c[0], ev.c[1]), '+' + nf(ev.d), 'soin');
          majPv(ev.c[0], ev.c[1], ev.pv);
          await M.att(.26);
        }else if(ev.t === 'ko'){
          const u = el(ev.c[0], ev.c[1]); if(u) u.classList.add('ko');
          bruit('ko', sc);
          await M.att(.32);
        }
      },
      async fin(victoire){ bruit(victoire ? 'victoire' : 'defaite', sc); await I.titre(victoire); },
      detruire(){}
    };
  }

  // ---------------------------------------------------------------------
  // La scène 3D : devant l'Olympia, des cartes en volume qui se battent pour de bon — élans, entailles, disques lancés,
  // ondes de basse, arrêts sur image, éclats de carte au K.O. — et une caméra qui suit l'action.
  // ---------------------------------------------------------------------

  function rectRond(g, x, y, w, h, r){
    g.beginPath();
    g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }

  // La carte, dessinée sur un canvas pour servir de texture : cadre noir liseré à la couleur de la rareté, pochette, numéro, logo, nom en Anton, titre.
  async function dessinerCarte(u, logo){
    const W = 512, H = 640;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');
    const rc = A.rar(u.rarete).c;
    const glace = u.booster === 'glaciale';   // Vague Glaciale : la carte prise dans la glace, comme dans la collection
    if(glace){
      const cg = g.createLinearGradient(0, 0, W, H);
      [[0, '#f4fbff'], [.16, '#a9daf7'], [.38, '#3f78ad'], [.52, '#dff3ff'], [.7, '#6ea9d6'], [.88, '#eefaff'], [1, '#9cd0f2']].forEach((s) => cg.addColorStop(s[0], s[1]));
      g.fillStyle = cg;
    }else g.fillStyle = '#000';
    rectRond(g, 0, 0, W, H, 34); g.fill();
    g.save(); rectRond(g, 12, 12, W - 24, H - 24, 24); g.clip();
    const img = await chargerImage(u.photo);
    if(img){
      const s = Math.max((W - 24) / img.width, (H - 24) / img.height), dw = img.width * s, dh = img.height * s;
      g.drawImage(img, 12 + (W - 24 - dw) / 2, 12 + (H - 24 - dh) * .22, dw, dh);
    }else{
      const gr = g.createLinearGradient(0, 0, W, H); gr.addColorStop(0, '#16314f'); gr.addColorStop(1, '#0a0d18'); g.fillStyle = gr; g.fillRect(12, 12, W - 24, H - 24);
    }
    const v = g.createLinearGradient(0, H * .5, 0, H - 12);
    if(glace){ v.addColorStop(0, 'rgba(8,30,60,0)'); v.addColorStop(.6, 'rgba(6,24,50,.9)'); v.addColorStop(1, '#05172e'); }
    else{ v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(.6, 'rgba(0,0,0,.88)'); v.addColorStop(1, '#000'); }
    g.fillStyle = v; g.fillRect(12, H * .48, W - 24, H * .52);
    if(glace){
      // le voile froid, la neige (toujours la même pour une carte donnée) et les éclats de glace dans les coins
      const fr = g.createLinearGradient(0, 0, 0, H * .5); fr.addColorStop(0, 'rgba(10,40,84,.5)'); fr.addColorStop(.45, 'rgba(40,110,190,.14)'); fr.addColorStop(1, 'rgba(40,110,190,0)');
      g.fillStyle = fr; g.fillRect(12, 12, W - 24, H * .5);
      let sd = (Number(u.numero) || 7) * 9301 + 49297;
      const al = () => { sd = (sd * 9301 + 49297) % 233280; return sd / 233280; };
      for(let i = 0; i < 70; i++){
        const y = 12 + al() * (H * .78), x = 12 + al() * (W - 24), ry = .8 + al() * 3.4;
        g.fillStyle = 'rgba(255,255,255,' + ((.45 + al() * .5) * Math.min(1, (H * .86 - y) / (H * .3))).toFixed(2) + ')';
        g.beginPath(); g.arc(x, y, ry, 0, 6.3); g.fill();
      }
      const eclat = (pts, a) => { g.fillStyle = 'rgba(255,255,255,' + a + ')'; g.strokeStyle = 'rgba(255,255,255,.5)'; g.lineWidth = 1.2; g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p[0] * W / 100, p[1] * H / 125) : g.moveTo(p[0] * W / 100, p[1] * H / 125))); g.closePath(); g.fill(); g.stroke(); };
      eclat([[100, 0], [70, 0], [79, 5], [87, 8], [93, 17], [100, 31]], .2); eclat([[70, 0], [79, 5], [87, 8], [100, 0]], .28);
      eclat([[0, 125], [0, 98], [4, 107], [10, 114], [19, 120], [30, 125]], .2); eclat([[0, 125], [10, 114], [19, 120]], .3);
      eclat([[0, 0], [17, 0], [9, 4], [4, 10], [0, 21]], .16); eclat([[100, 125], [100, 106], [96, 114], [89, 120], [79, 125]], .16);
    }
    if(u.holo){
      const h = g.createLinearGradient(0, 0, W, H);
      ['rgba(255,120,200,.22)', 'rgba(120,255,255,.22)', 'rgba(255,250,150,.22)', 'rgba(190,150,255,.22)'].forEach((col, i) => h.addColorStop(i / 3, col));
      g.globalCompositeOperation = 'screen'; g.fillStyle = h; g.fillRect(12, 12, W - 24, H - 24); g.globalCompositeOperation = 'source-over';
    }
    g.restore();
    if(glace){
      g.strokeStyle = 'rgba(8,28,54,.9)'; g.lineWidth = 3; rectRond(g, 12, 12, W - 24, H - 24, 24); g.stroke();
      g.strokeStyle = 'rgba(214,240,255,.7)'; g.lineWidth = 2; rectRond(g, 15, 15, W - 30, H - 30, 21); g.stroke();
      // l'étiquette de la collection : la plaque bleue de sa pochette
      g.font = '19px Anton, Impact, "Arial Narrow", sans-serif'; g.textAlign = 'center';
      const et = 'VAGUE GLACIALE'.split('').join(String.fromCharCode(8202)), le = g.measureText(et).width + 46;
      g.fillStyle = '#1b4679'; g.fillRect(W / 2 - le / 2, 28, le, 32); g.strokeStyle = '#bfe3fb'; g.lineWidth = 2; g.strokeRect(W / 2 - le / 2, 28, le, 32);
      g.fillStyle = '#cdeaff'; g.fillText(et, W / 2 - 9, 51);
      for(let i = 0; i < 6; i++) g.fillRect(W / 2 + le / 2 - 26 + i * 3, 35, i % 3 === 1 ? 1 : 2, 18);
    }else{ g.strokeStyle = rc; g.lineWidth = 7; rectRond(g, 8.5, 8.5, W - 17, H - 17, 28); g.stroke(); }
    g.fillStyle = 'rgba(255,255,255,.92)'; g.textAlign = 'left'; g.font = 'italic 300 24px Inter, Arial, sans-serif';
    g.fillText('#' + String(u.numero || 0).padStart(3, '0'), 40, 58);
    if(logo) g.drawImage(logo, W - 40 - 94, 32, 94, 94 * logo.height / logo.width);
    g.textAlign = 'center'; g.fillStyle = '#fff';
    const ajuste = (texte, taille, mini, police) => { g.font = taille + 'px ' + police; while(g.measureText(texte).width > W - 90 && taille > mini){ taille -= 2; g.font = taille + 'px ' + police; } };
    const nom = String(u.nom || '').toUpperCase(), titre = String(u.titre || '');
    ajuste(nom, 84, 30, 'Anton, Impact, "Arial Narrow", sans-serif');
    if(glace){ const ng = g.createLinearGradient(0, H - 170, 0, H - 78); ng.addColorStop(.3, '#fff'); ng.addColorStop(.65, '#cfecff'); ng.addColorStop(1, '#7cc2f1'); g.fillStyle = ng; g.shadowColor = 'rgba(40,140,235,.6)'; g.shadowBlur = 14; }
    g.fillText(nom, W / 2, H - (titre ? 92 : 78)); g.shadowBlur = 0;
    if(titre){
      g.fillStyle = 'rgba(255,255,255,.86)';
      ajuste(titre, 26, 16, 'Inter, Arial, sans-serif');
      g.fillText(titre, W / 2, H - 58);
    }
    g.font = 'italic 300 21px Inter, Arial, sans-serif'; g.fillStyle = rc;
    g.fillText(A.rar(u.rarete).nom.toUpperCase().split('').join(String.fromCharCode(8202)), W / 2, H - 30);
    return c;
  }

  async function creerActeur3d(r, sc, corps, I){
    if(calme() || !webglOk() || S.sans3d) return null;
    let THREE = S.three;
    if(!THREE){
      try{ THREE = S.three = await import('./lib/three/three.module.min.js'); }catch(e){ S.sans3d = true; return null; }
    }
    if(sc.fini) return null;
    let renderer;
    try{ renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' }); }catch(e){ S.sans3d = true; return null; }

    const M = sc.moteur, V3 = THREE.Vector3;
    const mobile = window.innerWidth < 700;
    // la qualité : une image nette sans calculer plus de points que nécessaire ; allégée d'office si la machine a peiné la dernière fois
    let palier = qualiteBasse() ? 2 : 0;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, palier ? 1 : 1.5));
    renderer.shadowMap.enabled = !palier;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    const canvas = renderer.domElement;
    canvas.className = 'cbt-canvas';
    corps.innerHTML = '';
    corps.appendChild(canvas);
    const couche = document.createElement('div');   // les jauges de PV, posées sur les cartes
    couche.className = 'cbt-couche';
    corps.appendChild(couche);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xbcd6ea);
    scene.fog = new THREE.Fog(0xd4e4ee, 30, 70);
    const FOV = 50;
    const camera = new THREE.PerspectiveCamera(FOV, 1, .1, 120);
    const accueil = { pos: new V3(0, 6, 11), look: new V3(0, 1.5, -.3) };
    let cielM = null;

    // --- l'environnement (reflets) : un ciel de jour
    {
      const ec = document.createElement('canvas'); ec.width = 256; ec.height = 128;
      const g = ec.getContext('2d');
      const gr = g.createLinearGradient(0, 0, 0, 128); gr.addColorStop(0, '#86b6e6'); gr.addColorStop(.5, '#e4eef2'); gr.addColorStop(1, '#8c8a80');
      g.fillStyle = gr; g.fillRect(0, 0, 256, 128);
      const rg = g.createRadialGradient(190, 30, 0, 190, 30, 40); rg.addColorStop(0, '#fff6d8'); rg.addColorStop(1, 'rgba(255,246,216,0)');
      g.fillStyle = rg; g.fillRect(140, 0, 100, 80);
      const et = new THREE.CanvasTexture(ec); et.mapping = THREE.EquirectangularReflectionMapping; et.colorSpace = THREE.SRGBColorSpace;
      const pm = new THREE.PMREMGenerator(renderer);
      scene.environment = pm.fromEquirectangular(et).texture;
      et.dispose(); pm.dispose();
    }

    // --- les lumières : un après-midi sur le boulevard
    scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x9a968a, 1.1));
    const clef = new THREE.DirectionalLight(0xfff1d6, 2.6);
    clef.position.set(-4, 11, 7); clef.target.position.set(0, 0, 0);
    clef.castShadow = true; clef.shadow.mapSize.set(1024, 1024);
    clef.shadow.camera.left = -9; clef.shadow.camera.right = 9; clef.shadow.camera.top = 9; clef.shadow.camera.bottom = -9; clef.shadow.camera.far = 30; clef.shadow.bias = -.0004;
    scene.add(clef, clef.target);
    const spots = [];
    const flash = new THREE.PointLight(0xffffff, 0, 18, 2);
    scene.add(flash);

    // --- les textures en pixel art : la façade de l'Olympia (de jour, d'après des photos du boulevard des Capucines), le trottoir, l'asphalte
    const pixel = (url, repete) => new Promise((ok) => new THREE.TextureLoader().load(url, (t) => {
      t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
      if(repete){ t.wrapS = t.wrapT = THREE.RepeatWrapping; }
      ok(t);
    }, undefined, () => ok(null)));
    const [texOlympia, texTrottoir, texAsphalte, texHorizon, texAcc] = await Promise.all([pixel('img/combat/olympia.png?v=5'), pixel('img/combat/trottoir.png?v=5', true), pixel('img/combat/asphalte.png?v=5', true), pixel('img/combat/horizon.png?v=5'), pixel('img/combat/accessoires.png?v=5')]);
    // la chaussée
    if(texAsphalte) texAsphalte.repeat.set(117, 117);
    const sol = new THREE.Mesh(new THREE.PlaneGeometry(220, 220), new THREE.MeshStandardMaterial({ color: texAsphalte ? 0xffffff : 0x62656c, map: texAsphalte, roughness: .9, metalness: 0 }));
    sol.rotation.x = -Math.PI / 2; sol.receiveShadow = true; scene.add(sol);
    // le trottoir au pied de la façade, son bord, les traits blancs de la chaussée
    if(texTrottoir) texTrottoir.repeat.set(61, 2.5);
    const trottoir = new THREE.Mesh(new THREE.PlaneGeometry(90, 3.8), new THREE.MeshStandardMaterial({ color: texTrottoir ? 0xffffff : 0xb9b3a6, map: texTrottoir, roughness: .85, metalness: 0 }));
    trottoir.rotation.x = -Math.PI / 2; trottoir.position.set(0, .02, -11.1); trottoir.receiveShadow = true; scene.add(trottoir);
    const bord = new THREE.Mesh(new THREE.BoxGeometry(90, .14, .3), new THREE.MeshStandardMaterial({ color: 0xa8a398, roughness: .9 }));
    bord.position.set(0, .07, -9.15); bord.receiveShadow = true; scene.add(bord);
    for(let k = -13; k <= 13; k++){
      const trait = new THREE.Mesh(new THREE.BoxGeometry(1.7, .012, .13), new THREE.MeshStandardMaterial({ color: 0xe9e6dc, roughness: .8 }));
      trait.position.set(k * 3.4, .012, -6.6); scene.add(trait);
    }
    // --- la rue de l'Olympia : une bande de 447 x 115 pixels (outils/combat/olympia_sprites.py), le sol est en bas de l'image.
    // Le bloc central (x 187 à 263) fait face à la caméra, les immeubles se prolongent de chaque côté en s'arrondissant jusqu'à faire face à la rue :
    // on est dans une vraie rue fermée. Derrière, un horizon de toits dans la brume ; autour, un ciel. Les enseignes et les piliers sortent du mur.
    const alea = (i) => { const v = Math.sin(i * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
    const IW = 447, IH = 115, s = .12, CX0 = 187, CX1 = 263;   // s : un pixel de l'image, en unités de la scène
    const facades = [];                                // [matériau, luminosité de base] : la façade s'éclaire un peu à chaque impact
    const decoupe = (tex, w, h, x0, y0, x1, y1) => {
      const t = tex.clone();
      t.repeat.set((x1 - x0) / w, (y1 - y0) / h); t.offset.set(x0 / w, 1 - y1 / h); t.needsUpdate = true;
      return t;
    };
    const matPixel = (tex, rect, base) => new THREE.MeshBasicMaterial({ map: rect ? decoupe(tex, ...rect) : tex, color: new THREE.Color().setScalar(base || 1), transparent: true, alphaTest: .5, side: THREE.DoubleSide, fog: false, toneMapped: false });
    const toile = (x0, y0, x1, y1, base) => {
      const m = matPixel(texOlympia, [IW, IH, x0, y0, x1, y1], base);
      facades.push([m, base || 1]);
      return new THREE.Mesh(new THREE.PlaneGeometry((x1 - x0) * s, (y1 - y0) * s), m);
    };
    const decor = new THREE.Group(); scene.add(decor);
    const px = (x) => (x - (CX0 + CX1) / 2) * s;       // le milieu du bloc central est au milieu de la scène
    // les accessoires dessinés (arbres, colonne Morris, lampadaire) : des cartes tournées vers la caméra, avec leur ombre au sol
    const ACC = { arbre: [[0, 0, 48, 72], [48, 0, 96, 72], [96, 0, 144, 72]], colonne: [144, 24, 164, 72], lampe: [164, 16, 176, 72] };
    const accessoire = (r, x, z, ech) => {
      if(!texAcc) return;
      const w = (r[2] - r[0]) * s * ech, h = (r[3] - r[1]) * s * ech;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), matPixel(texAcc, [176, 72, ...r]));
      m.position.set(x, h / 2, z); m.rotation.y = Math.atan2(-x, 12 - z);
      const o = new THREE.Mesh(new THREE.CircleGeometry(w * .38, 14), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: .22, depthWrite: false, fog: false }));
      o.rotation.x = -Math.PI / 2; o.position.set(x + w * .12, .03, z + .1); o.scale.y = .5;
      scene.add(m, o);
    };
    if(texOlympia){
      const centre = toile(CX0, 0, CX1, IH); centre.position.set(0, IH * s / 2, -12.7); decor.add(centre);
      // une chaîne de tranches d'immeubles : chacune est tournée un peu plus vers la rue que la précédente
      const chaine = (cote, tranches) => {
        let X = px(cote < 0 ? CX0 : CX1), Z = -12.7;
        tranches.forEach(([x0, x1, a], i) => {
          const w = (x1 - x0) * s, g = new THREE.Group(), r = -cote * a;
          const p = toile(x0, 0, x1, IH, .94 - i * .02); p.position.set(cote * w / 2, IH * s / 2, 0); g.add(p);
          if(texTrottoir){                                  // le trottoir au pied de la tranche
            const tt = texTrottoir.clone(); tt.repeat.set(w / 1.5, 2.1); tt.needsUpdate = true;
            const t = new THREE.Mesh(new THREE.PlaneGeometry(w, 3.2), new THREE.MeshStandardMaterial({ map: tt, roughness: .85, metalness: 0 }));
            t.rotation.x = -Math.PI / 2; t.position.set(cote * w / 2, .02, 1.6); t.receiveShadow = true; g.add(t);
          }
          g.position.set(X, 0, Z); g.rotation.y = r; decor.add(g);
          const nx = Math.sin(r), nz = Math.cos(r);         // la normale de la tranche, vers la rue
          if(i > 0){
            accessoire(ACC.arbre[(i + (cote > 0 ? 1 : 0)) % 3], X + nx * 2.2, Z + nz * 2.2, .85);
            accessoire(ACC.lampe, X + cote * w * .5 * Math.cos(r) + nx * 3, Z - cote * w * .5 * Math.sin(r) + nz * 3, .65);
          }
          X += cote * w * Math.cos(r); Z -= cote * w * Math.sin(r);
        });
      };
      chaine(-1, [[117, 187, .28], [54, 117, .7], [0, 54, 1.15], [117, 187, 1.5], [54, 117, 1.57]]);
      chaine(1, [[263, 333, .34], [333, 391, .75], [391, 447, 1.2], [263, 333, 1.5], [333, 391, 1.57]]);
      const saillie = (x0, y0, x1, y1, prof, couleur) => {
        const g = new THREE.Group();
        const corps = new THREE.Mesh(new THREE.BoxGeometry((x1 - x0) * s, (y1 - y0) * s, prof), new THREE.MeshStandardMaterial({ color: couleur, roughness: .85 }));
        corps.castShadow = true; g.add(corps);
        const face = toile(x0, y0, x1, y1); face.position.z = prof / 2 + .01; g.add(face);
        g.position.set(px((x0 + x1) / 2), (IH - (y0 + y1) / 2) * s, -12.7 + prof / 2);
        decor.add(g);
      };
      saillie(201, 57, 251, 70, .6, 0x8a1c1c);           // l'enseigne OLYMPIA
      saillie(210, 81, 242, 96, .35, 0xb9b2a2);          // la marquise LA WAVE
      saillie(202, 71, 209, 115, .5, 0xd0c4a8);          // les deux piliers
      saillie(243, 71, 250, 115, .5, 0xd0c4a8);
    }
    // sur le trottoir du fond : des arbres, des lampadaires, une colonne Morris
    [[-7.5, 0], [7.5, 1], [-15, 2], [15, 0]].forEach(([x, k]) => accessoire(ACC.arbre[k], x, -10.6, .85));
    [-3.6, 3.6, -11.3, 11.3].forEach((x) => accessoire(ACC.lampe, x, -9.7, .65));
    accessoire(ACC.colonne, 9.6, -9.9, .45);
    // l'horizon : les toits d'une ville plus loin dans la brume, derrière et sur les côtés, pour que le ciel ne soit jamais vide
    if(texHorizon){
      const HZ = .2, L = 447 * HZ, H = 48 * HZ;
      const hz = (x, z, ry) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(L, H), matPixel(texHorizon, null, 1)); m.position.set(x, 8.5 + H / 2, z); m.rotation.y = ry; scene.add(m); };
      hz(0, -26, 0); hz(-L, -26, 0); hz(L, -26, 0);
      hz(-34, -6, Math.PI / 2); hz(-34, -6 - L, Math.PI / 2); hz(-34, -6 + L, Math.PI / 2);
      hz(34, -6, -Math.PI / 2); hz(34, -6 - L, -Math.PI / 2); hz(34, -6 + L, -Math.PI / 2);
    }
    // le ciel : un dégradé et des nuages en gros pixels, tout autour
    {
      const c = document.createElement('canvas'); c.width = 160; c.height = 60; const g = c.getContext('2d');
      const gr = g.createLinearGradient(0, 0, 0, 60); gr.addColorStop(0, '#5f98d4'); gr.addColorStop(1, '#cfe3f1');
      g.fillStyle = gr; g.fillRect(0, 0, 160, 60);
      g.fillStyle = '#f4f9fc';
      for(let i = 0; i < 9; i++){
        const cx = 6 + alea(i * 3 + 1) * 140, cy = 6 + alea(i * 5 + 2) * 30, L = 14 + Math.floor(alea(i * 7 + 3) * 16);
        g.fillRect(cx, cy, L, 3); g.fillRect(cx + 3, cy - 3, L - 8, 3); g.fillRect(cx - 4, cy + 3, L + 6, 2);
      }
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; t.wrapS = THREE.RepeatWrapping; t.repeat.x = 2;
      const ciel = new THREE.Mesh(new THREE.CylinderGeometry(80, 80, 70, 32, 1, true), new THREE.MeshBasicMaterial({ map: t, side: THREE.BackSide, fog: false, toneMapped: false }));
      ciel.position.y = 26; scene.add(ciel); cielM = ciel;
      scene.background = new THREE.Color(0x5f98d4);
    }

    // --- l'ambiance : le décor s'assombrit pendant les coups signature, pour que les effets ressortent (les cartes, elles, restent éclairées)
    const pixels = [];
    scene.traverse((o) => { if(o.material && o.material.isMeshBasicMaterial && o.material.map) pixels.push([o.material, o.material.color.r]); });
    const hemi = scene.children.find((o) => o.isHemisphereLight);
    const lum = { amb: 1, cible: 1, impact: 0, hemi: hemi ? hemi.intensity : 1, clef: clef.intensity };

    // --- la poussière lumineuse qui flotte
    const poussiere = (() => {
      const N = 200, pos = new Float32Array(N * 3), vit = new Float32Array(N);
      for(let i = 0; i < N; i++){ pos[i * 3] = (Math.random() - .5) * 26; pos[i * 3 + 1] = Math.random() * 9; pos[i * 3 + 2] = (Math.random() - .7) * 22; vit[i] = .1 + Math.random() * .25; }
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xfff3d0, size: .06, transparent: true, opacity: .45, blending: THREE.AdditiveBlending, depthWrite: false }));
      scene.add(pts);
      return { pts, pos, vit, N };
    })();

    // --- les textures des effets, dessinées une fois
    const jetables = [];
    const toileTex = (w, h, dessin) => {
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      dessin(c.getContext('2d'), w, h);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; jetables.push(t);
      return t;
    };
    const texDoux = toileTex(64, 64, (g) => {
      const rg = g.createRadialGradient(32, 32, 0, 32, 32, 32); rg.addColorStop(0, 'rgba(255,255,255,1)'); rg.addColorStop(.35, 'rgba(255,255,255,.6)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = rg; g.fillRect(0, 0, 64, 64);
    });
    const texEtoile = toileTex(128, 128, (g) => {   // l'éclat d'un impact : une étoile à huit branches
      g.translate(64, 64);
      const rg = g.createRadialGradient(0, 0, 0, 0, 0, 30); rg.addColorStop(0, 'rgba(255,255,255,1)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = rg; g.fillRect(-64, -64, 128, 128);
      g.fillStyle = '#fff';
      for(let k = 0; k < 4; k++){ g.rotate(Math.PI / 4); const L = k % 2 ? 40 : 62; g.beginPath(); g.moveTo(-L, 0); g.quadraticCurveTo(0, -5, L, 0); g.quadraticCurveTo(0, 5, -L, 0); g.fill(); }
    });
    const texEntaille = toileTex(256, 256, (g) => {   // une entaille : un croissant effilé
      g.translate(128, 128); g.shadowColor = '#fff'; g.shadowBlur = 14; g.fillStyle = '#fff';
      for(let k = 0; k < 2; k++){ g.beginPath(); g.arc(0, 0, 112, -1.24, 1.24, false); g.arc(-30, 0, 125, 1.011, -1.011, true); g.closePath(); g.fill(); }
    });
    const texAnneau = toileTex(256, 256, (g) => {
      const rg = g.createRadialGradient(128, 128, 0, 128, 128, 128);
      rg.addColorStop(0, 'rgba(255,255,255,0)'); rg.addColorStop(.6, 'rgba(255,255,255,0)'); rg.addColorStop(.82, 'rgba(255,255,255,1)'); rg.addColorStop(.9, 'rgba(255,255,255,.55)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = rg; g.fillRect(0, 0, 256, 256);
    });
    const texCercle = toileTex(256, 256, (g) => {   // le cercle au pied de chaque carte
      g.translate(128, 128);
      const rg = g.createRadialGradient(0, 0, 20, 0, 0, 120); rg.addColorStop(0, 'rgba(255,255,255,.3)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = rg; g.beginPath(); g.arc(0, 0, 120, 0, 7); g.fill();
      g.strokeStyle = '#fff'; g.fillStyle = '#fff';
      g.lineWidth = 7; g.beginPath(); g.arc(0, 0, 112, 0, 7); g.stroke();
      g.lineWidth = 2.5; g.beginPath(); g.arc(0, 0, 98, 0, 7); g.stroke();
      g.lineWidth = 6; g.setLineDash([22, 14]); g.beginPath(); g.arc(0, 0, 84, 0, 7); g.stroke(); g.setLineDash([]);
      for(let k = 0; k < 4; k++){ g.rotate(Math.PI / 2); g.beginPath(); g.moveTo(104, -9); g.lineTo(124, 0); g.lineTo(104, 9); g.closePath(); g.fill(); }
    });
    const texFaisceau = toileTex(64, 256, (g) => {   // une colonne de lumière : pleine en bas, fondue en haut
      const h = g.createLinearGradient(0, 0, 64, 0); h.addColorStop(0, 'rgba(255,255,255,0)'); h.addColorStop(.5, 'rgba(255,255,255,1)'); h.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = h; g.fillRect(0, 0, 64, 256);
      g.globalCompositeOperation = 'destination-in';
      const v = g.createLinearGradient(0, 0, 0, 256); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(.4, 'rgba(0,0,0,.75)'); v.addColorStop(1, 'rgba(0,0,0,1)');
      g.fillStyle = v; g.fillRect(0, 0, 64, 256);
    });
    const texVinyle = toileTex(128, 128, (g) => {
      g.translate(64, 64);
      g.fillStyle = '#0b0b10'; g.beginPath(); g.arc(0, 0, 62, 0, 7); g.fill();
      g.strokeStyle = 'rgba(255,255,255,.18)'; g.lineWidth = 1;
      for(let rr = 28; rr < 60; rr += 5){ g.beginPath(); g.arc(0, 0, rr, 0, 7); g.stroke(); }
      g.strokeStyle = 'rgba(255,255,255,.8)'; g.lineWidth = 3;
      g.beginPath(); g.arc(0, 0, 50, -.9, -.2); g.stroke(); g.beginPath(); g.arc(0, 0, 50, 2.2, 2.9); g.stroke();
      g.fillStyle = '#fff'; g.beginPath(); g.arc(0, 0, 21, 0, 7); g.fill();
      g.fillStyle = '#0b0b10'; g.beginPath(); g.arc(0, 0, 4, 0, 7); g.fill();
    });
    const texNote = toileTex(96, 96, (g) => {
      g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.shadowColor = 'rgba(0,0,0,.55)'; g.shadowBlur = 6;
      g.font = '76px "Segoe UI Symbol", "Apple Symbols", "Noto Sans Symbols", serif'; g.fillText('♪', 48, 50);
    });
    const texFissure = toileTex(256, 256, (g) => {   // le sol qui se fend sous un coup lourd
      g.translate(128, 128);
      const rg = g.createRadialGradient(0, 0, 0, 0, 0, 100); rg.addColorStop(0, 'rgba(0,0,0,.62)'); rg.addColorStop(.45, 'rgba(0,0,0,.3)'); rg.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = rg; g.beginPath(); g.arc(0, 0, 100, 0, 7); g.fill();
      g.strokeStyle = 'rgba(8,8,12,.95)'; g.lineCap = 'round';
      const branche = (x, y, a, larg, n, graine) => {
        for(let j = 0; j < n; j++){
          a += (alea(graine * 7 + j * 3) - .5) * 1.1;
          const L = 11 + alea(graine * 5 + j) * 11, x2 = x + Math.cos(a) * L, y2 = y + Math.sin(a) * L;
          g.lineWidth = Math.max(1, larg * (1 - j / n)); g.beginPath(); g.moveTo(x, y); g.lineTo(x2, y2); g.stroke();
          if(j === 1 && larg > 5) branche(x2, y2, a + (alea(graine + 3) > .5 ? .9 : -.9), larg * .5, 3, graine + 11);
          x = x2; y = y2;
        }
      };
      for(let k = 0; k < 7; k++) branche(0, 0, k / 7 * 6.283 + alea(k + 40) * .6, 10, 5, k + 1);
    });

    // --- les effets : des objets éphémères, animés par le moteur puis retirés
    const geoPlan = new THREE.PlaneGeometry(1, 1);
    const matFx = (tex, couleur, additif, op) => new THREE.MeshBasicMaterial({ map: tex, color: couleur, transparent: true, opacity: op === undefined ? 1 : op, blending: additif ? THREE.AdditiveBlending : THREE.NormalBlending, depthWrite: false, side: THREE.DoubleSide, fog: false, toneMapped: false });
    const lutin = (tex, couleur, additif, op) => new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: couleur, transparent: true, opacity: op === undefined ? 1 : op, blending: additif ? THREE.AdditiveBlending : THREE.NormalBlending, depthWrite: false, fog: false, toneMapped: false }));
    const dessus = (s, ordre) => { s.material.depthTest = false; s.renderOrder = ordre || 10; return s; };
    const libere = (obj) => obj.traverse((x) => { if(x.material) x.material.dispose(); if(x.geometry && x.userData.geoPropre) x.geometry.dispose(); });
    const ephem = (obj, dur, f, fn) => {
      if(sc.passer || sc.fini){ libere(obj); return Promise.resolve(); }
      scene.add(obj); f(0, obj);
      return M.tw(dur, (k) => f(k, obj), fn).then(() => { scene.remove(obj); libere(obj); });
    };
    const eclair = (p, couleur, taille, dur) => {   // l'éclat d'un impact
      const g = new THREE.Group(), a = dessus(lutin(texEtoile, couleur, true), 10), b = dessus(lutin(texEtoile, 0xffffff, false), 11);
      a.material.rotation = b.material.rotation = Math.random() * 3;
      g.add(a, b); g.position.copy(p);
      return ephem(g, dur || .16, (k) => {
        const s = taille * (k < .3 ? .3 + .7 * k / .3 : 1 - (k - .3) / .7 * .5);
        a.scale.setScalar(s * 1.5); b.scale.setScalar(s);
        a.material.opacity = b.material.opacity = k < .4 ? 1 : 1 - (k - .4) / .6;
      });
    };
    const entaille = (p, couleur, angle, taille, dur) => {
      const g = new THREE.Group(), a = dessus(lutin(texEntaille, couleur, true), 12), b = dessus(lutin(texEntaille, 0xffffff, false), 13);
      g.add(a, b); g.position.copy(p);
      return ephem(g, dur || .22, (k) => {
        const s = taille * (.7 + .55 * ease.out(k)), o = k < .35 ? 1 : 1 - (k - .35) / .65;
        a.scale.setScalar(s * 1.14); b.scale.setScalar(s);
        a.material.rotation = b.material.rotation = angle + ease.out(k) * 1.5;
        a.material.opacity = o; b.material.opacity = o;
      });
    };
    const anneau = (p, couleur, r0, r1, dur, additif) => {   // une onde au sol
      const m = new THREE.Mesh(geoPlan, matFx(texAnneau, couleur, additif !== false));
      m.rotation.x = -Math.PI / 2; m.position.set(p.x, .05, p.z);
      return ephem(m, dur, (k) => { const s = (r0 + (r1 - r0) * ease.out(k)) * 2; m.scale.set(s, s, 1); m.material.opacity = 1 - k * k; });
    };
    const fumee = (p, nb, couleur, etendue) => {
      for(let k = 0; k < nb; k++){
        const s = lutin(texDoux, couleur || 0xd8d2c4, false, .5);
        const a = Math.random() * 6.283, d = (.3 + Math.random() * .7) * (etendue || 1), h = .5 + Math.random() * .5;
        ephem(s, .5 + Math.random() * .35, (q) => {
          const e = ease.out(q);
          s.position.set(p.x + Math.cos(a) * d * e, .18 + e * .5 * h, p.z + Math.sin(a) * d * e * .6);
          s.scale.setScalar(.5 + e * 1.3 * h); s.material.opacity = .5 * (1 - q);
        });
      }
    };
    const fissure = (p, taille) => {
      const m = new THREE.Mesh(geoPlan, matFx(texFissure, 0xffffff, false, .8));
      m.rotation.x = -Math.PI / 2; m.rotation.z = Math.random() * 6; m.position.set(p.x, .04, p.z);
      return ephem(m, 1.6, (k) => { const s = taille * (k < .06 ? .5 + k / .06 * .5 : 1); m.scale.set(s, s, 1); m.material.opacity = k < .7 ? .8 : .8 * (1 - (k - .7) / .3); });
    };
    const colonne = (p, couleur, haut, dur, large) => {
      const s = lutin(texFaisceau, couleur, true); s.center.set(.5, 0); s.position.set(p.x, 0, p.z);
      return ephem(s, dur, (k) => { const e = k < .2 ? k / .2 : 1 - (k - .2) / .8; s.scale.set((large || 1.6) * (.6 + .4 * e), haut * (.4 + .6 * ease.out(Math.min(1, k * 3))), 1); s.material.opacity = e; });
    };
    const notes = (p, couleur, nb) => {
      for(let k = 0; k < nb; k++){
        const s = lutin(texNote, couleur, false);
        const x0 = p.x + (Math.random() - .5) * 1.4, z0 = p.z + .35, d = Math.random() * .25, ph = Math.random() * 6;
        ephem(s, .9 + Math.random() * .3, (q) => {
          const u = Math.max(0, (q - d) / (1 - d));
          s.position.set(x0 + Math.sin(ph + u * 5) * .18, .6 + u * 2.6, z0);
          s.scale.setScalar(.34 + .12 * Math.sin(u * 3.14));
          s.material.opacity = u <= 0 ? 0 : (u > .7 ? 1 - (u - .7) / .3 : 1);
        });
      }
    };
    const viser = (t, couleur) => {   // un cercle qui se referme sur la cible
      const m = new THREE.Mesh(geoPlan, matFx(texCercle, couleur, false));
      m.rotation.x = -Math.PI / 2; m.position.set(t.home.x, .06, t.home.z);
      return ephem(m, .3, (k) => { const s = 5 - 2.4 * ease.out(k); m.scale.set(s, s, 1); m.rotation.z = k * 2; m.material.opacity = Math.min(1, k * 3) * (1 - k * k * .5); });
    };

    // --- les particules : un seul nuage réutilisé (étincelles, éclats, confettis), chaque point a sa couleur, sa taille et sa transparence
    const NP = 600;
    const part = { pos: new Float32Array(NP * 3), vel: new Float32Array(NP * 3), col: new Float32Array(NP * 3), alpha: new Float32Array(NP), taille: new Float32Array(NP), t0: new Float32Array(NP), vie: new Float32Array(NP), max: new Float32Array(NP), grav: new Float32Array(NP), frein: new Float32Array(NP), i: 0, maj: false };
    const pgeo = new THREE.BufferGeometry();
    pgeo.setAttribute('position', new THREE.BufferAttribute(part.pos, 3));
    pgeo.setAttribute('color', new THREE.BufferAttribute(part.col, 3));
    pgeo.setAttribute('aAlpha', new THREE.BufferAttribute(part.alpha, 1));
    pgeo.setAttribute('aTaille', new THREE.BufferAttribute(part.taille, 1));
    const matPart = new THREE.ShaderMaterial({
      uniforms: { uEch: { value: 600 } },
      vertexShader: 'attribute float aAlpha; attribute float aTaille; uniform float uEch; varying float vA; varying vec3 vC; void main(){ vC = color; vA = aAlpha; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = aTaille * uEch / max(0.1, -mv.z); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'varying float vA; varying vec3 vC; void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; float m = smoothstep(1.0, 0.25, d); vec3 c = mix(vC, vec3(1.0), smoothstep(0.5, 0.0, d) * 0.8); gl_FragColor = vec4(c, vA * m); }',
      vertexColors: true, transparent: true, depthWrite: false
    });
    const nuage = new THREE.Points(pgeo, matPart);
    nuage.frustumCulled = false; nuage.renderOrder = 8; scene.add(nuage);
    const tmpC = new THREE.Color();
    const emettre = (x, y, z, vx, vy, vz, taille, vie, grav, frein) => {
      const i = part.i = (part.i + 1) % NP, i3 = i * 3;
      part.pos[i3] = x; part.pos[i3 + 1] = y; part.pos[i3 + 2] = z;
      part.vel[i3] = vx; part.vel[i3 + 1] = vy; part.vel[i3 + 2] = vz;
      part.col[i3] = tmpC.r; part.col[i3 + 1] = tmpC.g; part.col[i3 + 2] = tmpC.b;
      part.t0[i] = taille; part.vie[i] = part.max[i] = vie; part.grav[i] = grav; part.frein[i] = frein || 0; part.maj = true;
    };
    const etincelles = (p, couleur, nb, vitesse, vie, grav, taille) => {
      if(sc.passer) return;
      tmpC.set(couleur);
      for(let k = 0; k < nb; k++){
        const th = Math.random() * 6.283, ph = Math.acos(2 * Math.random() - 1), v = vitesse * (.35 + Math.random() * .65);
        emettre(p.x, p.y, p.z, Math.sin(ph) * Math.cos(th) * v, Math.abs(Math.cos(ph)) * v + vitesse * .2, Math.sin(ph) * Math.sin(th) * v, (taille || .16) * (.6 + Math.random() * .8), vie * (.6 + Math.random() * .6), grav === undefined ? 7 : grav, 1.2);
      }
    };
    const gerbe = (p, sensZ, couleur, nb, vitesse) => {   // les étincelles partent dans le sens du coup
      if(sc.passer) return;
      tmpC.set(couleur);
      for(let k = 0; k < nb; k++) emettre(p.x, p.y, p.z, (Math.random() - .5) * vitesse * .9, (Math.random() - .15) * vitesse * .8, sensZ * vitesse * (.5 + Math.random() * .7), .14 * (.6 + Math.random() * .9), .35 + Math.random() * .35, 8, 1.5);
    };
    const convergence = (p, couleur, nb, rayon, dur) => {   // l'énergie se rassemble sur la carte
      if(sc.passer) return;
      tmpC.set(couleur);
      for(let k = 0; k < nb; k++){
        const th = Math.random() * 6.283, ph = Math.acos(2 * Math.random() - 1), dx = Math.sin(ph) * Math.cos(th), dy = Math.cos(ph) * .7, dz = Math.sin(ph) * Math.sin(th), d = rayon * (.6 + Math.random() * .5), t = dur * (.6 + Math.random() * .4);
        emettre(p.x + dx * d, p.y + dy * d, p.z + dz * d, -dx * d / t, -dy * d / t, -dz * d / t, .17, t, 0, 0);
      }
    };
    const confettis = () => {
      if(sc.passer) return;
      const cs = [0xff5c8a, 0xffd76a, 0x4fb4ff, 0x5be0a6, 0xb36bff, 0xffffff];
      for(let k = 0; k < 160; k++){ tmpC.set(cs[k % cs.length]); emettre((Math.random() - .5) * 13, 5 + Math.random() * 5, (Math.random() - .5) * 8, (Math.random() - .5) * 1.5, -Math.random(), (Math.random() - .5) * 1.5, .2, 2.4 + Math.random() * 1.4, 2.2, .9); }
    };

    // --- les combattants : une carte en volume qui flotte au-dessus de son cercle
    const logo = await chargerImage('img/logo-wave.png');
    try{ await Promise.race([document.fonts.load('64px Anton'), attendre(900)]); }catch(e){ /* police système */ }
    const dos = await new Promise((ok) => new THREE.TextureLoader().load('img/carte-dos.webp', ok, undefined, () => ok(null)));
    if(dos) dos.colorSpace = THREE.SRGBColorSpace;
    const CW = 1.5, CH = 1.875, EP = .07, YC = CH / 2 + .42, TILT = -.14;
    const forme = (() => { const f = new THREE.Shape(), r2 = .1, x = -CW / 2, y = -CH / 2; f.moveTo(x + r2, y); f.lineTo(x + CW - r2, y); f.quadraticCurveTo(x + CW, y, x + CW, y + r2); f.lineTo(x + CW, y + CH - r2); f.quadraticCurveTo(x + CW, y + CH, x + CW - r2, y + CH); f.lineTo(x + r2, y + CH); f.quadraticCurveTo(x, y + CH, x, y + CH - r2); f.lineTo(x, y + r2); f.quadraticCurveTo(x, y, x + r2, y); return f; })();
    const geoTranche = new THREE.ExtrudeGeometry(forme, { depth: EP, bevelEnabled: false, curveSegments: 10 }); geoTranche.translate(0, 0, -EP / 2);
    const geoFace = new THREE.ShapeGeometry(forme, 10);
    { const uv = geoFace.attributes.uv, po = geoFace.attributes.position; for(let k = 0; k < uv.count; k++) uv.setXY(k, po.getX(k) / CW + .5, po.getY(k) / CH + .5); uv.needsUpdate = true; }
    const geoDos = geoFace.clone();
    { const uv = geoDos.attributes.uv; for(let k = 0; k < uv.count; k++) uv.setX(k, 1 - uv.getX(k)); uv.needsUpdate = true; }
    const geoBulle = new THREE.SphereGeometry(1.42, 28, 18);
    const matBouclier = () => new THREE.ShaderMaterial({
      uniforms: { uC: { value: new THREE.Color(0x66ccff) }, uO: { value: 0 } },
      vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform vec3 uC; uniform float uO; varying vec3 vN; varying vec3 vV; void main(){ float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2); gl_FragColor = vec4(uC + f * 0.5, (f * 0.85 + 0.08) * uO); }',
      transparent: true, depthWrite: false, side: THREE.DoubleSide
    });
    const aniso = renderer.capabilities.getMaxAnisotropy();
    const matTranche = new THREE.MeshStandardMaterial({ color: 0x07080c, metalness: .5, roughness: .45 });
    // chaque rôle a sa façon de frapper ; les autres lancent des disques
    const STYLES = { combattant: 'frappe', hypeman: 'frappe', tank: 'charge', pilier: 'charge', briseur: 'charge', assassin: 'eclairs' };
    const camps = [r.a, r.b], nMax = Math.max(r.a.length, r.b.length, 1);
    const sp = nMax <= 3 ? 2.2 : (nMax === 4 ? 1.95 : 1.75);
    const RANG = (corps.clientWidth || 800) / (corps.clientHeight || 500) < .8 ? 3.5 : 2.6;   // en portrait, les deux rangées s'écartent : elles occupent la hauteur de l'écran
    const combattants = {};
    const dessins = await Promise.all([...r.a.map((u, i) => ({ u, i, c: 0 })), ...r.b.map((u, i) => ({ u, i, c: 1 }))].map(async (x) => ({ x, cv: await dessinerCarte(x.u, logo) })));
    if(sc.fini){ renderer.dispose(); return null; }
    const plaque = (u, c) => {
      const d = document.createElement('div');
      d.className = 'cbt-pl ' + (c === 0 ? 'ami' : 'ennemi');
      const niv = u.niveau > 1 || u.etoiles > 0 ? `<span class="lv">N${u.niveau}${u.etoiles ? ' ' + '★'.repeat(u.etoiles) : ''}</span>` : '';
      d.innerHTML = `<div class="pv"><u></u><i></i><b></b></div><div class="x"><span data-pv>${nf(u.pv_max)}</span><em data-b></em>${niv}</div>`;
      couche.appendChild(d);
      return d;
    };
    dessins.forEach(({ x, cv }) => {
      const { u, c, i } = x;
      const cc = c === 0 ? 0x4fb4ff : 0xff5c8a, rc = new THREE.Color(A.rar(u.rarete).c);
      const g = new THREE.Group();
      const home = new V3((i - (camps[c].length - 1) / 2) * sp, 0, c === 0 ? RANG : -RANG);
      g.position.copy(home);
      const base = new THREE.Mesh(geoPlan, matFx(texCercle, cc, false, .62));
      base.rotation.x = -Math.PI / 2; base.position.y = .035; base.scale.set(2.5, 2.5, 1); base.visible = false; g.add(base);
      const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = aniso;
      const matF = u.holo
        ? new THREE.MeshPhysicalMaterial({ map: tex, emissiveMap: tex, emissive: 0x000000, roughness: .28, metalness: .15, clearcoat: 1, clearcoatRoughness: .15, iridescence: 1, iridescenceIOR: 1.7, iridescenceThicknessRange: [200, 600] })
        : new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0x000000, roughness: .42, metalness: .12 });
      const pivot = new THREE.Group(); pivot.position.y = YC; pivot.rotation.x = TILT; pivot.visible = false;
      const face = new THREE.Mesh(geoFace, matF); face.position.z = EP / 2 + .002; face.castShadow = true; pivot.add(face);
      const voileM = new THREE.Mesh(geoFace, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false }));
      voileM.position.z = EP / 2 + .008; pivot.add(voileM);
      const verso = new THREE.Mesh(geoDos, new THREE.MeshStandardMaterial({ map: dos || null, color: dos ? 0xffffff : 0x10304f, roughness: .5, metalness: .1 }));
      verso.rotation.y = Math.PI; verso.position.z = -EP / 2 - .002; pivot.add(verso);
      const tr = new THREE.Mesh(geoTranche, matTranche); tr.castShadow = true; pivot.add(tr);
      const lueur = lutin(texDoux, rc, true, .1); lueur.scale.set(3.6, 4.2, 1); lueur.position.z = -.25; pivot.add(lueur);
      g.add(pivot);
      const bulle = new THREE.Mesh(geoBulle, matBouclier()); bulle.visible = false; g.add(bulle);
      scene.add(g);
      const pl = plaque(u, c);
      combattants[c + '-' + (i + 1)] = {
        g, pivot, base, matF, tex, voileM, lueur, bulle, home, c, i, u, cc, rc, sens: c === 0 ? -1 : 1, style: STYLES[u.role] || 'disque',
        dep: new V3(), o: { y: 0, z: 0, rx: 0, ry: 0, rz: 0, s: 1, ex: 1, sq: 0 }, h: { z: 0, rx: 0, rz: 0, sq: 0 },
        pv: u.pv_max, pvmax: u.pv_max, bouc: 0, boucA: 0, boucFlash: 0, vivant: true, fete: false, actif: 0, lueurF: 0, ph: Math.random() * 6,
        plaque: pl, elPv: pl.querySelector('[data-pv]'), elB: pl.querySelector('[data-b]'), elBarre: pl.querySelector('.pv'), elBou: pl.querySelector('.pv b'),
        jauge: creerJauge(pl.querySelector('.pv i'), pl.querySelector('.pv u'))
      };
    });
    const tous = Object.values(combattants);
    const fleche = document.createElement('div');   // la carte qui joue est montrée du doigt
    fleche.className = 'cbt-fleche'; couche.appendChild(fleche);
    let enJeu = null;
    const fz = (cp) => (cp ? combattants[cp[0] + '-' + cp[1]] : null);

    // --- la caméra : elle rejoint en douceur le plan demandé ; secousses et coups de zoom s'y ajoutent
    const cam = { pos: new V3(), look: new V3(), posC: new V3(), lookC: new V3(), raideur: 5, secousse: 0, fov: 0, orbite: 0 };
    let W = 800, H = 500, mort = false;
    const tmp = new V3();
    const ecran = (x, y, z) => { tmp.set(x, y, z).project(camera); return { x: (tmp.x * .5 + .5) * W, y: (-tmp.y * .5 + .5) * H }; };
    const large = () => { cam.posC.copy(accueil.pos); cam.lookC.copy(accueil.look); };
    const plan = (p, zoom) => {   // se rapprocher d'un point de la scène (zoom de 0 à 1)
      const lat = camera.aspect < .8 ? .3 : 1;   // en portrait, la caméra glisse peu sur les côtés : les cartes restent à l'écran
      cam.lookC.set(accueil.look.x + (p.x - accueil.look.x) * (.3 + zoom) * lat, accueil.look.y, accueil.look.z + (p.z - accueil.look.z) * (.25 + zoom));
      const e = 1 - zoom * .5;
      cam.posC.set(cam.lookC.x + (accueil.pos.x - accueil.look.x) * e + p.x * .12 * lat, cam.lookC.y + (accueil.pos.y - accueil.look.y) * e, cam.lookC.z + (accueil.pos.z - accueil.look.z) * e);
    };
    const cadrer = () => {
      W = corps.clientWidth || 800; H = corps.clientHeight || 500;
      renderer.setSize(W, H, false);
      camera.aspect = W / H;
      const tv = Math.tan(THREE.MathUtils.degToRad(FOV / 2)), th = tv * camera.aspect;
      const portrait = camera.aspect < .8;
      const D = Math.max(11.5, ((nMax - 1) * sp + CW + (portrait ? 2.1 : 1.5)) / 2 / th + RANG + .8), pente = portrait ? .5 : .38;
      accueil.look.set(0, portrait ? 2.4 : 1.5, -.3);   // en portrait, on regarde de plus haut : la façade remplit l'écran, les rangées s'étagent
      accueil.pos.set(0, accueil.look.y + Math.sin(pente) * D, accueil.look.z + Math.cos(pente) * D);
      camera.updateProjectionMatrix();
      matPart.uniforms.uEch.value = H * renderer.getPixelRatio() / (2 * tv);
      // la largeur des jauges suit l'écart entre deux cartes à l'écran (la rangée du fond est la plus serrée)
      camera.position.copy(accueil.pos); camera.lookAt(accueil.look); camera.updateMatrixWorld(true);
      const lp = Math.max(38, Math.min(96, Math.abs(ecran(sp, 0, -RANG).x - ecran(0, 0, -RANG).x) - 8));
      couche.style.setProperty('--pl', lp.toFixed(0) + 'px'); couche.classList.toggle('serre', lp < 70);
      if(!cam.orbite) large();
    };
    cadrer();
    cam.pos.set(0, accueil.pos.y + 5, accueil.pos.z + 9); cam.look.set(0, 3.2, -4);
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(cadrer) : null;
    if(ro) ro.observe(corps); else window.addEventListener('resize', cadrer);

    // --- l'état d'une carte et ses réactions
    const centre = (f) => new V3(f.home.x + f.dep.x, YC, f.home.z + f.dep.z);
    const devant = (f) => new V3(f.home.x + f.dep.x, YC + .1, f.home.z + f.dep.z + .3);
    const ecranDe = (f) => () => ecran(f.home.x + f.dep.x, YC + .35, f.home.z + f.dep.z);
    const majPlaque = (f) => {
      const pct = Math.max(0, f.pv / f.pvmax);
      f.jauge.poser(pct);
      f.elBarre.classList.toggle('bas', pct < .35);
      f.elPv.textContent = nf(Math.max(0, f.pv));
      f.elB.textContent = f.bouc > 0 ? '+' + nf(f.bouc) : '';
      f.elBou.style.width = Math.min(100, f.bouc / f.pvmax * 100).toFixed(1) + '%';
    };
    const appliquer = (f, pv, bouc) => { f.pv = pv; if(bouc !== undefined) f.bouc = bouc; majPlaque(f); I.pv(f.c, f.i + 1, pv); };
    const voile = (f, couleur, dur, force) => {   // la carte s'illumine un instant
      f.voileM.material.color.set(couleur);
      return M.tw(dur, (k) => { f.voileM.material.opacity = (1 - k) * (force || .9); }, ease.out);
    };
    const recul = (f, force) => M.tw(.34, (k) => {
      const s = Math.sin(ease.out(k) * Math.PI);
      f.h.z = -f.sens * s * (.28 + force * .5); f.h.rx = -f.sens * s * (.16 + force * .2); f.h.rz = Math.sin(k * Math.PI * 3) * .07 * (1 - k); f.h.sq = s * .08;
    });
    // un coup qui porte : l'état d'abord, puis tout ce qui le fait sentir (arrêt sur image, éclat, étincelles, onde, secousse, nombre)
    const frapper = (a, t, d, pv, b, o) => {
      const avait = t.bouc > 0;
      appliquer(t, pv, b || 0);
      if(sc.passer) return;
      const c = devant(t), col = o.crit ? 0xff4040 : (o.sig ? 0xffd76a : o.couleur);
      const force = Math.min(1, (.25 + d / t.pvmax * 1.6) * (o.crit ? 1.3 : 1) * (o.sig ? 1.15 : 1));
      I.nombre(ecranDe(t), (o.crit ? '<small>Critique !</small>' : '') + '−' + nf(d), o.crit ? 'crit' : (o.sig ? 'sig' : ''));
      bruit(o.crit ? 'critique' : (o.lourd || o.sig ? 'lourd' : 'coup'), sc);
      if(o.crit){ I.eclatRouge(); if(A.vibre) A.vibre(30); }
      M.geler(o.crit ? .13 : (o.sig ? .09 : .05));
      lum.impact = Math.min(1, lum.impact + .6);
      cam.secousse = Math.max(cam.secousse, .1 + force * .34); cam.fov = -(1.2 + force * 3);
      flash.color.set(col); flash.position.set(c.x, 2.6, c.z + t.sens); flash.intensity = o.crit ? 380 : (o.sig ? 260 : 140);
      eclair(c, col, 2.2 + force * 1.7, .18);
      gerbe(c, -t.sens, col, Math.round(12 + force * 22), 5 + force * 5);
      etincelles(c, 0xffffff, Math.round(6 + force * 10), 3.5, .45, 7, .12);
      anneau(t.home, col, .5, 1.8 + force * 1.8, .45);
      if(avait){ t.boucFlash = 1; etincelles(c, 0x7fd6ff, 14, 4, .5, 4, .16); }
      voile(t, o.crit ? 0xff7070 : 0xffffff, .22);
      recul(t, force);
    };
    const fantome = (a) => {   // l'image rémanente d'une carte lancée à toute vitesse
      const m = new THREE.Mesh(geoFace, new THREE.MeshBasicMaterial({ map: a.tex, color: a.c === 0 ? 0x9fdcff : 0xffa8c0, transparent: true, opacity: .5, depthWrite: false, fog: false }));
      a.pivot.updateWorldMatrix(true, false);
      m.matrixAutoUpdate = false; m.matrix.copy(a.pivot.matrixWorld);
      return ephem(m, .22, (k) => { m.material.opacity = .5 * (1 - k); });
    };
    const approche = (a, t, dx, dz) => {   // le déplacement qui amène la carte contre sa cible, de côté : la cible reste visible
      const cote = a.home.x < t.home.x - .1 ? -1 : (a.home.x > t.home.x + .1 ? 1 : (t.home.x > .1 ? -1 : 1));
      return new V3(t.home.x + cote * dx - a.home.x, 0, t.home.z - a.sens * dz - a.home.z);
    };
    const retour = (a, dep, dur) => M.tw(dur, (k) => {
      const e = ease.out(k);
      a.dep.copy(dep).multiplyScalar(1 - e); a.o.y = Math.sin(k * Math.PI) * .45; a.o.rx *= (1 - e); a.o.rz *= (1 - e); a.o.sq *= (1 - e);
    }).then(() => { a.dep.set(0, 0, 0); a.o.y = 0; a.o.rx = 0; a.o.rz = 0; a.o.sq = 0; });

    // --- les façons d'attaquer
    const frappe = async (a, t, ev, o) => {   // l'élan : la carte recule, fonce et entaille
      const dep = approche(a, t, 1, .75), cote = a.home.x + dep.x < t.home.x ? 1 : -1;
      await M.tw(.15, (k) => { a.o.z = -a.sens * .4 * k; a.o.rx = -a.sens * .16 * k; a.o.sq = .05 * k; }, ease.out);
      bruit('elan', sc);
      let pas = 0;
      await M.tw(o.sig ? .16 : .12, (k) => {
        a.dep.copy(dep).multiplyScalar(k); a.o.z = -a.sens * .4 * (1 - k); a.o.y = Math.sin(k * Math.PI) * .3; a.o.rx = a.sens * .3 * k; a.o.rz = -.2 * k * cote; a.o.sq = .05 * (1 - k);
        if(k > pas && k < 1){ pas += .3; fantome(a); }
      }, ease.in);
      const c = devant(t), ang = cote > 0 ? .5 : 2.6;
      entaille(c, o.couleur, ang, o.sig ? 4.4 : 3.1, .22);
      if(o.crit || o.sig) entaille(c, o.crit ? 0xff4040 : 0xffd76a, ang + 1.7, o.sig ? 4.8 : 3.6, .26);
      frapper(a, t, ev.d, ev.pv, ev.b, o);
      if(o.sig){ fissure(t.home, 3.4); anneau(t.home, 0xffffff, .6, 4.4, .6, false); fumee(t.home, 7, 0xd8d2c4, 1.6); }
      await M.att(.12);
      a.o.z = 0;
      await retour(a, dep, .24);
    };
    const charge = async (a, t, ev, o) => {   // la charge : la carte se tasse, bondit et s'écrase sur sa cible
      const dep = approche(a, t, .45, 1.15);
      await M.tw(.2, (k) => { a.o.y = -.14 * k; a.o.sq = .12 * k; a.o.rx = -a.sens * .1 * k; }, ease.out);
      bruit('elan', sc);
      await M.tw(.26, (k) => {
        a.dep.copy(dep).multiplyScalar(k); a.o.y = Math.sin(k * Math.PI) * (o.sig ? 2.5 : 1.5) - .14 * (1 - k);
        a.o.sq = .12 * (1 - k) - .1 * Math.sin(k * Math.PI); a.o.rx = a.sens * .5 * k;
      }, ease.io);
      frapper(a, t, ev.d, ev.pv, ev.b, Object.assign({}, o, { lourd: true }));
      fissure(t.home, o.sig ? 4.2 : 2.7); anneau(t.home, 0xffffff, .5, o.sig ? 4.8 : 3.3, .55, false); fumee(t.home, o.sig ? 9 : 6, 0xd8d2c4, 1.5);
      cam.secousse = Math.max(cam.secousse, o.sig ? .6 : .4);
      await M.tw(.1, (k) => { a.o.sq = .16 * Math.sin(k * Math.PI); });
      await retour(a, dep, .28);
    };
    const eclairs = async (a, t, ev, o) => {   // l'éclair : la carte disparaît, surgit contre sa cible, taille deux fois et revient
      const dep = approche(a, t, -1.05, .45);
      bruit('elan', sc);
      await M.tw(.09, (k) => { a.o.ex = 1 - k * .96; }, ease.in);
      eclair(centre(a), o.couleur, 1.8, .14); a.dep.copy(dep);
      await M.tw(.07, (k) => { a.o.ex = .04 + k * .96; }, ease.out);
      const c = devant(t);
      entaille(c, o.couleur, .6, 2.9, .18);
      await M.att(.07);
      entaille(c, 0xffffff, 2.3, 3.2, .2);
      if(o.sig || o.crit){ await M.att(.06); entaille(c, o.crit ? 0xff4040 : 0xffd76a, 1.4, 4.2, .24); }
      frapper(a, t, ev.d, ev.pv, ev.b, o);
      await M.att(.15);
      await M.tw(.08, (k) => { a.o.ex = 1 - k * .96; }, ease.in);
      a.dep.set(0, 0, 0); eclair(centre(a), o.couleur, 1.4, .12);
      await M.tw(.08, (k) => { a.o.ex = .04 + k * .96; }, ease.out);
      a.o.ex = 1;
    };
    const lancerDisque = (de, vers, couleur, dur, taille) => {
      const g = new THREE.Group(), halo = lutin(texDoux, couleur, true, .8), m = new THREE.Mesh(geoPlan, matFx(texVinyle, couleur, false));
      halo.scale.setScalar(taille * 2.4); m.scale.setScalar(taille); m.rotation.x = -1.1; g.add(halo, m);
      return ephem(g, dur, (k) => {
        g.position.lerpVectors(de, vers, k); g.position.y += Math.sin(k * Math.PI) * .7; m.rotation.z = k * 24;
        tmpC.set(couleur); emettre(g.position.x, g.position.y, g.position.z, (Math.random() - .5) * 1.2, (Math.random() - .5) * 1.2, (Math.random() - .5) * 1.2, .13, .3, 0, 1);
      });
    };
    const disque = async (a, t, ev, o) => {   // le lancer : la carte arme, pivote et envoie un vinyle (trois pour un coup signature)
      const nb = o.sig ? 3 : 1;
      await M.tw(.14, (k) => { a.o.ry = -.7 * k; a.o.z = -a.sens * .2 * k; }, ease.out);
      for(let n2 = 0; n2 < nb; n2++){
        const dernier = n2 === nb - 1;
        bruit('lance', sc);
        M.tw(.12, (k) => { a.o.ry = -.7 + 1.25 * k; a.o.z = -a.sens * .2 * (1 - k) + a.sens * .25 * k; }, ease.out);
        const de = centre(a).add(new V3(0, .3, a.sens * .6)), vers = devant(t);
        const vol = lancerDisque(de, vers, o.couleur, .2, dernier && o.sig ? 1.25 : .85);
        if(dernier){ await vol; frapper(a, t, ev.d, ev.pv, ev.b, o); etincelles(vers, 0x15151c, 10, 4, .6, 9, .2); }
        else{
          vol.then(() => { if(sc.fini || sc.passer) return; eclair(vers, o.couleur, 1.7, .12); voile(t, 0xffffff, .14); recul(t, .15); cam.secousse = Math.max(cam.secousse, .12); bruit('coup', sc); });
          await M.att(.13);
        }
      }
      await M.tw(.2, (k) => { a.o.ry = .55 * (1 - k); a.o.z = a.sens * .25 * (1 - k); }, ease.out);
      a.o.ry = 0; a.o.z = 0;
    };
    const ATTAQUES = { frappe, charge, eclairs, disque };
    const zone = async (a, ev, o) => {   // l'onde : la carte s'élève, tourne sur elle-même et lâche une onde de basse sur tout le camp adverse
      await M.tw(.26, (k) => { a.o.y = 1.1 * ease.out(k); a.o.ry = k * 6.283; a.o.s = Math.max(a.o.s, 1 + .12 * k); });
      a.o.ry = 0;
      bruit('onde', sc);
      anneau(a.home, o.couleur, .4, 9.5, .62); anneau(a.home, 0xffffff, .2, 8, .5, false);
      M.att(.08).then(() => anneau(a.home, o.couleur, .4, 8.5, .6));
      cam.secousse = Math.max(cam.secousse, .3); lum.impact = 1;
      M.tw(.2, (k) => { a.o.y = 1.1 * (1 - ease.in(k)); a.o.sq = .12 * Math.sin(k * Math.PI); }).then(() => { a.o.y = 0; a.o.sq = 0; });
      await M.att(.1);
      await Promise.all(ev.x.map((h) => {
        const t = fz(h.c); if(!t) return null;
        return M.att(Math.max(0, t.home.distanceTo(a.home) - 3) * .03).then(() => {
          if(sc.fini) return;
          colonne(t.home, h.k ? 0xff4040 : o.couleur, 3.6, .35, 1.2);
          frapper(a, t, h.d, h.pv, h.b, Object.assign({}, o, { crit: !!h.k }));
        });
      }));
      await M.att(.3);
    };
    // le prélude d'un coup signature : le décor s'assombrit, le bandeau traverse l'écran, l'énergie se rassemble
    const prelude = async (a) => {
      lum.cible = .34; I.assombrir(1); I.cutIn(a.u, a.c); bruit('charge', sc);
      plan(a.home, a.c === 0 ? .24 : .1);
      convergence(centre(a), a.rc, 46, 2.6, .36); colonne(a.home, a.rc, 5, .5, 2);
      await M.tw(.4, (k) => { a.o.y = .5 * Math.sin(k * Math.PI); a.o.s = 1 + .14 * ease.out(k); a.lueurF = Math.max(a.lueurF, k); });
      a.o.y = 0;
      eclair(centre(a), 0xffffff, 2.6, .16); anneau(a.home, a.rc, .4, 3, .4);
    };
    const epilogue = (a) => { lum.cible = 1; I.assombrir(0); M.tw(.25, (k) => { a.o.s = 1.14 - .14 * k; }).then(() => { a.o.s = 1; }); };
    const orbe = (de, vers, couleur, dur) => {   // une boule de lumière qui va d'une carte à l'autre (soin, bouclier)
      const g = new THREE.Group(), a = lutin(texDoux, couleur, true), b = lutin(texDoux, 0xffffff, false, .9);
      a.scale.setScalar(1.3); b.scale.setScalar(.4); g.add(a, b);
      return ephem(g, dur, (k) => {
        g.position.lerpVectors(de, vers, ease.io(k)); g.position.y += Math.sin(k * Math.PI) * 1.1;
        tmpC.set(couleur); emettre(g.position.x, g.position.y, g.position.z, Math.random() - .5, Math.random() - .5, Math.random() - .5, .14, .35, 0, 1);
      });
    };
    const soigne = (t, d, nb) => {
      if(sc.passer) return;
      colonne(t.home, 0x6dfcb0, 4.2, .6, 1.7); notes(t.home, 0xbfffd9, nb); anneau(t.home, 0x6dfcb0, .4, 2.2, .55);
      voile(t, 0x6dfcb0, .45, .5); t.lueurF = 1;
      I.nombre(ecranDe(t), '+' + nf(d), 'soin');
    };
    const briser = (f) => {   // la carte vole en éclats
      const cols = 4, rows = 5, pts = [];
      for(let j = 0; j <= rows; j++) for(let i = 0; i <= cols; i++){
        const bord = i === 0 || j === 0 || i === cols || j === rows;
        pts.push([(-.5 + i / cols + (bord ? 0 : (Math.random() - .5) * .15)) * CW, (-.5 + j / rows + (bord ? 0 : (Math.random() - .5) * .12)) * CH]);
      }
      const tris = [];
      for(let j = 0; j < rows; j++) for(let i = 0; i < cols; i++){
        const a = pts[j * (cols + 1) + i], b = pts[j * (cols + 1) + i + 1], c = pts[(j + 1) * (cols + 1) + i], d = pts[(j + 1) * (cols + 1) + i + 1];
        if((i + j) % 2) tris.push([a, b, d], [a, d, c]); else tris.push([a, b, c], [b, d, c]);
      }
      const N = tris.length, pos = new Float32Array(N * 9), uv = new Float32Array(N * 6);
      const morceaux = tris.map((t, k) => {
        const cx = (t[0][0] + t[1][0] + t[2][0]) / 3, cy = (t[0][1] + t[1][1] + t[2][1]) / 3;
        t.forEach((p, q2) => { uv[k * 6 + q2 * 2] = p[0] / CW + .5; uv[k * 6 + q2 * 2 + 1] = p[1] / CH + .5; });
        return {
          l: t.map((p) => new V3(p[0] - cx, p[1] - cy, 0)), c: new V3(cx, cy, 0),
          v: new V3(cx * 2.4 + (Math.random() - .5) * 1.6, 1.2 + Math.random() * 3 + cy * 1.4, -f.sens * (.6 + Math.random() * 2.6)),
          ax: new V3(Math.random() - .5, Math.random() - .5, Math.random() - .5).normalize(), w: 3 + Math.random() * 9, ang: 0
        };
      });
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: f.tex, color: 0xc4c9d6, transparent: true, side: THREE.DoubleSide, fog: false }));
      m.userData.geoPropre = true; m.frustumCulled = false;
      f.pivot.updateWorldMatrix(true, false);
      m.matrixAutoUpdate = false; m.matrix.copy(f.pivot.matrixWorld);
      const bas = -YC + .04, q4 = new THREE.Quaternion(), p = new V3(), DUR = 1.15;
      let kp = 0;
      return ephem(m, DUR, (k) => {
        const dt = (k - kp) * DUR; kp = k;
        morceaux.forEach((e, n2) => {
          if(e.c.y > bas){ e.v.y -= 9.5 * dt; e.c.addScaledVector(e.v, dt); e.ang += e.w * dt; if(e.c.y < bas) e.c.y = bas; }
          q4.setFromAxisAngle(e.ax, e.ang);
          for(let q2 = 0; q2 < 3; q2++){ p.copy(e.l[q2]).applyQuaternion(q4).add(e.c); pos[n2 * 9 + q2 * 3] = p.x; pos[n2 * 9 + q2 * 3 + 1] = p.y; pos[n2 * 9 + q2 * 3 + 2] = p.z; }
        });
        geo.attributes.position.needsUpdate = true;
        m.material.opacity = k < .62 ? 1 : 1 - (k - .62) / .38;
      });
    };
    const ko = async (f) => {
      f.vivant = false; f.fete = false; f.bouc = 0;
      bruit('ko', sc);
      if(!sc.passer){
        if(A.vibre) A.vibre(40);
        plan(f.home, .1);
        voile(f, 0xffffff, .3); M.geler(.07);
        cam.secousse = Math.max(cam.secousse, .24);
        await M.tw(.16, (k) => { f.o.rz = Math.sin(k * 30) * .07 * (1 - k); f.matF.color.setScalar(1 - .55 * k); });
      }
      if(!sc.passer){
        briser(f);
        eclair(centre(f), 0xffffff, 3, .2);
        etincelles(centre(f), 0x9aa3b8, 26, 4.5, .8, 7, .15);
        fumee(f.home, 5, 0x8b8f9c, 1.4); anneau(f.home, 0x9aa3b8, .4, 3, .5);
      }
      f.pivot.visible = false; f.bulle.visible = false; f.o.rz = 0;
      f.base.material.opacity = .16; f.base.material.color.set(0x555a66); f.base.scale.set(2.2, 2.2, 1);
      f.plaque.style.opacity = '0';
      await M.att(.42);
    };
    const invoquer = (f) => {   // la carte tombe du ciel dans une colonne de lumière
      if(sc.fini) return;
      f.pivot.visible = true; f.base.visible = true;
      if(!sc.passer){ colonne(f.home, f.cc, 6, .5, 1.5); bruit('pose', sc); }
      return M.tw(.42, (k) => { f.o.y = (1 - ease.back(k)) * 3.2; f.o.ry = (1 - ease.out(k)) * 6.283; f.o.s = .3 + .7 * Math.min(1, k * 2); }).then(() => {
        f.o.y = 0; f.o.ry = 0; f.o.s = 1; f.plaque.style.opacity = '1';
        if(sc.passer || sc.fini) return;
        anneau(f.home, f.cc, .4, 2, .4); fumee(f.home, 3, 0xd8d2c4, 1); cam.secousse = Math.max(cam.secousse, .05); f.actif = 1;
      });
    };

    // --- chaque image : l'ambiance, les cartes, les particules, la caméra, les jauges, le rendu
    // tout préparer pendant l'écran de présentation : textures envoyées à la carte graphique, programmes compilés.
    // Sans cela, le premier éclat, la première entaille, le premier K.O. feraient chacun un à-coup.
    try{
      jetables.forEach((t) => renderer.initTexture(t)); tous.forEach((f) => renderer.initTexture(f.tex)); if(dos) renderer.initTexture(dos);
      const chauffe = new THREE.Group();
      chauffe.add(lutin(texDoux, 0xffffff, true), lutin(texDoux, 0xffffff, false), new THREE.Mesh(geoPlan, matFx(texAnneau, 0xffffff, true)), new THREE.Mesh(geoPlan, matFx(texAnneau, 0xffffff, false)),
        new THREE.Mesh(geoFace, new THREE.MeshBasicMaterial({ map: tous[0].tex, transparent: true, depthWrite: false, fog: false })),
        new THREE.Mesh(geoFace, new THREE.MeshBasicMaterial({ map: tous[0].tex, transparent: true, side: THREE.DoubleSide, fog: false })));
      chauffe.position.set(0, -60, 0); scene.add(chauffe);
      tous.forEach((f) => { f.pivot.visible = true; f.base.visible = true; f.bulle.visible = true; });
      camera.position.copy(accueil.pos); camera.lookAt(accueil.look); camera.updateMatrixWorld(true);
      renderer.compile(scene, camera);
      tous.forEach((f) => { f.pivot.visible = false; f.base.visible = false; f.bulle.visible = false; });
      scene.remove(chauffe); libere(chauffe);
    }catch(e){ /* la scène se préparera au fil de l'eau */ }
    if(palier) poussiere.pts.visible = false;
    let tFrames = 0, nFrames = -40;   // les 40 premières images (mise en route) ne comptent pas
    tous.forEach(majPlaque);
    M.surImage((brut, v) => {
      if(mort) return;
      const t = M.t, fxv = M.gele() ? v * .15 : v;
      lum.amb += (lum.cible - lum.amb) * Math.min(1, brut * 7);
      lum.impact *= Math.pow(.03, brut);
      const am = lum.amb, e = 1 + lum.impact * .12, bl = Math.min(1.15, am + (1 - am) * .28);
      for(const [m, b] of pixels) m.color.setRGB(b * am * e, b * am * e, b * bl * e);
      if(hemi) hemi.intensity = lum.hemi * (.28 + .72 * am);
      clef.intensity = lum.clef * (.22 + .78 * am);
      flash.intensity *= Math.pow(.0009, brut);
      if(cielM) cielM.rotation.y += brut * .004;
      if(poussiere.pts.visible){ for(let i = 0; i < poussiere.N; i++){ let y = poussiere.pos[i * 3 + 1] + poussiere.vit[i] * brut; if(y > 9) y = 0; poussiere.pos[i * 3 + 1] = y; poussiere.pos[i * 3] += Math.sin(t + i) * .1 * brut; }
      poussiere.pts.geometry.attributes.position.needsUpdate = true; }

      for(let i = 0; i < NP; i++){
        if(part.vie[i] <= 0){ if(part.taille[i] !== 0){ part.alpha[i] = 0; part.taille[i] = 0; } continue; }
        part.vie[i] -= fxv;
        const i3 = i * 3, fr = Math.max(0, 1 - part.frein[i] * fxv);
        part.vel[i3] *= fr; part.vel[i3 + 1] = part.vel[i3 + 1] * fr - part.grav[i] * fxv; part.vel[i3 + 2] *= fr;
        part.pos[i3] += part.vel[i3] * fxv; part.pos[i3 + 1] += part.vel[i3 + 1] * fxv; part.pos[i3 + 2] += part.vel[i3 + 2] * fxv;
        if(part.grav[i] > 0 && part.pos[i3 + 1] < .03){ part.pos[i3 + 1] = .03; part.vel[i3 + 1] *= -.35; }
        const a = Math.max(0, part.vie[i] / part.max[i]);
        part.alpha[i] = Math.min(1, a * 1.8); part.taille[i] = part.t0[i] * (.35 + .65 * a);
      }
      pgeo.attributes.position.needsUpdate = true; pgeo.attributes.aAlpha.needsUpdate = true; pgeo.attributes.aTaille.needsUpdate = true;
      if(part.maj){ part.maj = false; pgeo.attributes.color.needsUpdate = true; }

      const kc = sc.passer ? 1 : 1 - Math.exp(-brut * cam.raideur * Math.min(sc.vitesse, 2));
      if(cam.orbite){
        const a = cam.orbite * brut, dx = cam.posC.x - cam.lookC.x, dz = cam.posC.z - cam.lookC.z;
        cam.posC.x = cam.lookC.x + dx * Math.cos(a) - dz * Math.sin(a); cam.posC.z = cam.lookC.z + dx * Math.sin(a) + dz * Math.cos(a);
      }
      cam.pos.lerp(cam.posC, kc); cam.look.lerp(cam.lookC, kc);
      cam.secousse *= Math.pow(.012, brut); cam.fov *= Math.pow(.004, brut);
      camera.position.set(cam.pos.x + Math.sin(t * .23) * .2 + (Math.random() - .5) * cam.secousse, cam.pos.y + Math.sin(t * .31) * .07 + (Math.random() - .5) * cam.secousse, cam.pos.z);
      camera.lookAt(cam.look);
      if(Math.abs(camera.fov - (FOV + cam.fov)) > .01){ camera.fov = FOV + cam.fov; camera.updateProjectionMatrix(); }
      camera.updateMatrixWorld(true);

      for(const f of tous){
        f.actif *= Math.pow(.25, brut); f.lueurF *= Math.pow(.2, brut);
        f.g.position.set(f.home.x + f.dep.x, 0, f.home.z + f.dep.z);
        const o = f.o, h = f.h;
        const flotte = f.vivant ? Math.sin(t * 1.7 + f.ph) * .05 : 0, fete = f.fete ? Math.abs(Math.sin(t * 5 + f.ph)) * .5 : 0;
        f.pivot.position.set(0, YC + flotte + fete + o.y, o.z + h.z);
        f.pivot.rotation.set(TILT + o.rx + h.rx, o.ry + (f.vivant ? Math.sin(t * .8 + f.ph) * .035 : 0) + (f.fete ? Math.sin(t * 2.5 + f.ph) * .3 : 0), o.rz + h.rz);
        const sq = o.sq + h.sq;
        f.pivot.scale.set(o.s * o.ex * (1 + sq), o.s * (1 - sq), o.s);
        if(f.vivant){
          f.matF.emissive.setScalar(Math.min(1, (1 - am) * .8 + f.lueurF * .35));
          f.lueur.material.opacity = Math.min(.9, .1 + (1 - am) * .55 + f.lueurF * .5 + f.actif * .2);
          f.base.rotation.z += brut * (f.c ? -.35 : .35);
          const sb = 2.5 * (1 + f.actif * .16); f.base.scale.set(sb, sb, 1);
          f.base.material.opacity = Math.min(1, .62 + f.actif * .38);
          f.boucA += ((f.bouc > 0 ? 1 : 0) - f.boucA) * Math.min(1, brut * 9);
          f.boucFlash *= Math.pow(.02, brut);
          f.bulle.visible = f.boucA > .02;
          if(f.bulle.visible){
            f.bulle.material.uniforms.uO.value = f.boucA * (.75 + Math.sin(t * 3 + f.ph) * .12) + f.boucFlash;
            f.bulle.scale.setScalar(.85 + .15 * f.boucA + f.boucFlash * .08);
            f.bulle.position.copy(f.pivot.position);
          }
        }
        f.jauge.image(v, sc.passer);
        const pe = f.c === 0 ? ecran(f.home.x, .02, f.home.z + .6) : ecran(f.home.x, YC + CH / 2 + .3, f.home.z);
        const px2 = Math.round(pe.x * 2) / 2, py2 = Math.round(pe.y * 2) / 2;
        if(px2 !== f.plX || py2 !== f.plY){ f.plX = px2; f.plY = py2; f.plaque.style.transform = `translate3d(${px2}px, ${py2}px, 0)`; }
      }
      if(enJeu && enJeu.vivant && !sc.passer){
        const pf = ecran(enJeu.home.x + enJeu.dep.x, YC + CH / 2 + (enJeu.c === 0 ? .25 : .75) + enJeu.o.y, enJeu.home.z + enJeu.dep.z);
        fleche.style.opacity = '1';
        fleche.style.borderTopColor = enJeu.c === 0 ? '#7fd0ff' : '#ff8fb0';
        fleche.style.transform = `translate3d(${pf.x.toFixed(1)}px, ${(pf.y - 8 + Math.sin(t * 9) * 4).toFixed(1)}px, 0)`;
      }else if(fleche.style.opacity !== '0') fleche.style.opacity = '0';
      renderer.render(scene, camera);
      // si la machine peine (moins de 45 images par seconde en moyenne), on allège par paliers : la résolution, puis les ombres et la poussière
      nFrames++; if(nFrames > 0) tFrames += brut;
      if(nFrames >= 50 && palier < 2 && !sc.manuel){
        const moy = tFrames / nFrames; tFrames = 0; nFrames = 0;
        if(moy > .022){
          if(palier === 0 && renderer.getPixelRatio() > 1){ palier = 1; renderer.setPixelRatio(1); cadrer(); }
          else{
            palier = 2; renderer.shadowMap.enabled = false; poussiere.pts.visible = false; noterQualiteBasse();
            scene.traverse((x) => { if(x.material && x.material.isMeshStandardMaterial) x.material.needsUpdate = true; });
          }
        }
      }
    });

    // --- les événements du combat, en images
    const evenement = async (ev) => {
      enJeu = ev.a && ev.t !== 'ko' ? fz(ev.a) : null;
      try{ await jouerEv(ev); }finally{ enJeu = null; }
    };
    const jouerEv = async (ev) => {
      if(ev.t === 'tour'){
        large(); I.tour(ev.n); bruit('tour', sc);
        await M.att(.42);
      }else if(ev.t === 'passif'){
        const f = fz(ev.c); if(!f) return;
        f.lueurF = 1; f.actif = 1; bruit('passif', sc);
        anneau(f.home, 0xffd76a, .4, 2.6, .6); etincelles(centre(f), 0xffd76a, 18, 3, .7, 2, .15);
        I.etiquette(ecranDe(f), ev.n);
        await M.att(.42);
      }else if(ev.t === 'att'){
        const a = fz(ev.a), t = fz(ev.c); if(!a || !t) return;
        const o = { sig: !!ev.s, crit: !!ev.k, couleur: a.c === 0 ? 0x7fd0ff : 0xff8fb0 };
        a.actif = 1; viser(t, a.c === 0 ? 0x7fd0ff : 0xff5c8a);
        if(o.sig) await prelude(a);
        plan(new V3((a.home.x + t.home.x) / 2, 0, (a.home.z + t.home.z) / 2), o.sig ? .15 : .07);
        await ATTAQUES[a.style](a, t, ev, o);
        if(o.sig) epilogue(a);
        await M.att(.1);
      }else if(ev.t === 'zone'){
        const a = fz(ev.a); if(!a) return;
        const o = { sig: !!ev.s, crit: false, couleur: a.c === 0 ? 0x7fd0ff : 0xff8fb0 };
        a.actif = 1;
        if(o.sig) await prelude(a);
        large();
        await zone(a, ev, o);
        if(o.sig) epilogue(a);
      }else if(ev.t === 'soin' && ev.x){
        const a = fz(ev.a);
        bruit('soin', sc);
        if(a){ a.actif = 1; a.lueurF = 1; plan(a.home, .06); await M.tw(.2, (k) => { a.o.y = Math.sin(k * Math.PI) * .3; }); a.o.y = 0; }
        await Promise.all(ev.x.map((h) => {
          const t = fz(h.c); if(!t) return null;
          return (a && a !== t ? orbe(centre(a), centre(t), 0x6dfcb0, .22) : Promise.resolve()).then(() => { if(sc.fini) return; appliquer(t, h.pv); soigne(t, h.d, 5); });
        }));
        await M.att(.42);
      }else if(ev.t === 'bouclier'){
        const a = fz(ev.a);
        bruit('bouclier', sc);
        if(a){ a.actif = 1; a.lueurF = 1; plan(a.home, .06); await M.tw(.2, (k) => { a.o.y = Math.sin(k * Math.PI) * .3; }); a.o.y = 0; }
        await Promise.all(ev.x.map((h) => {
          const t = fz(h.c); if(!t) return null;
          return (a && a !== t ? orbe(centre(a), centre(t), 0x7fd6ff, .22) : Promise.resolve()).then(() => {
            if(sc.fini) return;
            appliquer(t, t.pv, h.b);
            if(sc.passer) return;
            t.boucFlash = .9; anneau(t.home, 0x7fd6ff, .4, 2.4, .55); voile(t, 0x7fd6ff, .4, .5);
            I.nombre(ecranDe(t), '🛡 +' + nf(h.d), 'bou');
          });
        }));
        await M.att(.42);
      }else if(ev.t === 'epines'){
        const f = fz(ev.c); if(!f) return;
        appliquer(f, ev.pv);
        if(!sc.passer){
          bruit('epines', sc);
          eclair(devant(f), 0xffa54d, 2, .16); etincelles(devant(f), 0xffa54d, 12, 4, .5, 7, .14); voile(f, 0xffa54d, .2); recul(f, .1);
          if(ev.n) I.etiquette(ecranDe(f), ev.n);
          I.nombre(ecranDe(f), '−' + nf(ev.d), 'ref');
        }
        await M.att(.3);
      }else if(ev.t === 'soin'){
        const f = fz(ev.c); if(!f) return;
        appliquer(f, ev.pv); soigne(f, ev.d, 3);
        await M.att(.28);
      }else if(ev.t === 'ko'){
        const f = fz(ev.c); if(f) await ko(f);
      }
    };

    return {
      async intro(){
        // la caméra descend sur la rue pendant que les cartes tombent une à une
        cam.raideur = 2.4; large();
        await M.att(.3);
        const ordre = [...tous.filter((f) => f.c === 0), ...tous.filter((f) => f.c === 1)];
        ordre.forEach((f, k) => { M.att(k * .09).then(() => invoquer(f)); });
        await M.att(ordre.length * .09 + .6);
        cam.raideur = 5;
        I.ruban('Combat !', 'go'); bruit('combat', sc);
        await M.att(.65);
      },
      evenement,
      async fin(victoire){
        const gagnants = tous.filter((f) => f.vivant && f.c === (victoire ? 0 : 1));
        lum.cible = victoire ? 1 : .55; I.assombrir(victoire ? 0 : .6);
        plan(new V3(0, 0, victoire ? 2 : -2), .18); cam.orbite = victoire ? .14 : -.1;
        gagnants.forEach((f) => { f.fete = true; f.lueurF = 1; if(!sc.passer) etincelles(centre(f), 0xffd76a, 22, 5, 1, 4, .16); });
        if(victoire) confettis();
        bruit(victoire ? 'victoire' : 'defaite', sc);
        await I.titre(victoire);
      },
      detruire(){
        mort = true;
        if(ro) ro.disconnect(); else window.removeEventListener('resize', cadrer);
        scene.traverse((x) => {
          if(x.geometry) x.geometry.dispose();
          if(x.material) (Array.isArray(x.material) ? x.material : [x.material]).forEach((m) => { if(m.map) m.map.dispose(); m.dispose(); });
        });
        if(scene.environment) scene.environment.dispose();
        jetables.forEach((t) => t.dispose());
        [texOlympia, texTrottoir, texAsphalte, texHorizon, texAcc, dos].forEach((t) => { if(t) t.dispose(); });
        renderer.dispose();
        if(renderer.forceContextLoss) renderer.forceContextLoss();
      }
    };
  }

  // La fin du combat : le bilan (récompenses qui se comptent, dégâts, critiques, meilleure carte) et la suite.
  function finir(r, sc, stats){
    const M = sc.moteur, g = r.gains || {};
    const fin = document.createElement('div');
    fin.className = 'cbt-fin';
    const suite = r.victoire && r.etage < r.etages;
    let bilan = '';
    if(stats){
      const tot = stats.degats.reduce((a, b) => a + b, 0);
      const mi = stats.degats.indexOf(Math.max(...stats.degats));
      const mvp = mi >= 0 && stats.degats[mi] > 0 ? r.a[mi] : null;
      bilan = `<div class="tr-bilan"><div><b>${nf(tot)}</b>Dégâts</div><div><b>${stats.crits}</b>Critique${stats.crits > 1 ? 's' : ''}</div><div><b>${nf(stats.meilleur.d)}</b>Meilleur coup</div></div>`
        + (mvp ? `<div class="tr-mvp"><img src="${esc(A.safeUrl(mvp.photo))}" alt=""><span><b>Meilleure carte</b> · ${esc(mvp.nom)} : ${nf(stats.degats[mi])} dégâts</span></div>` : '');
    }
    const recs = [];
    if(r.victoire){
      if(g.vinyles) recs.push(`<div class="cbt-rec"><b data-compte="${Number(g.vinyles) || 0}">+${nf(g.vinyles)}</b><span>vinyle${g.vinyles > 1 ? 's' : ''}</span></div>`);
      if(g.wc) recs.push(`<div class="cbt-rec"><b data-compte="${Number(g.wc) || 0}">+${nf(g.wc)}</b><span>Wave Coins</span></div>`);
      if(r.premiere) recs.push(`<div class="cbt-rec palier"><b>${nf(r.etage_max)}</b><span>Étage atteint</span></div>`);
    }
    fin.innerHTML = `
      <div class="cbt-fin-c ${r.victoire ? 'v' : 'd'}">
        <div class="cbt-fin-t"><small>${esc(r.nom)} · ${pluriel(r.tours, 'tour', 'tours')}</small><h2>${r.victoire ? 'Victoire' : 'Défaite'}</h2></div>
        ${recs.length ? `<div class="cbt-recs">${recs.join('')}</div>` : ''}
        ${r.victoire && !g.vinyles && !r.premiere ? '<p class="sous">Limite de vinyles du jour atteinte pour les étages déjà franchis. Avance dans la Tour pour en gagner encore.</p>' : ''}
        ${r.victoire ? '' : '<p class="sous">Change tes cartes, puis réessaie.</p>'}
        ${bilan}
        <div class="cbt-fin-a">
          ${suite ? '<button type="button" class="cbt-btn principal" data-suite>Étage suivant</button>' : ''}
          <button type="button" class="cbt-btn${suite ? '' : ' principal'}" data-rejouer>Rejouer</button>
          <button type="button" class="cbt-btn" data-retour>Retour</button>
        </div>
      </div>`;
    sc.ov.appendChild(fin);
    const bas = sc.ov.querySelector('.cbt-bas'); if(bas) bas.style.display = 'none';
    if(!sc.passer && !calme()){
      // le panneau monte, puis les récompenses se comptent
      const c = fin.firstElementChild;
      M.tw(.4, (k) => { fin.style.opacity = Math.min(1, k * 2.2).toFixed(2); c.style.transform = `translateY(${((1 - ease.back(k)) * 70).toFixed(1)}px) scale(${(.92 + .08 * ease.out(k)).toFixed(3)})`; }).then(() => { fin.style.opacity = ''; c.style.transform = ''; });
      fin.querySelectorAll('[data-compte]').forEach((b, i) => {
        const n = Number(b.dataset.compte) || 0;
        b.textContent = '+0';
        M.att(.35 + i * .2).then(() => { bruit('gain', sc); return M.tw(.6, (k) => { b.textContent = '+' + nf(Math.round(n * ease.out(k))); }); }).then(() => { b.textContent = '+' + nf(n); });
      });
      if(r.victoire){
        const conf = document.createElement('div'); conf.className = 'tr-confetti';
        const couleurs = ['#ff5c8a', '#ffd76a', '#4fb4ff', '#5be0a6', '#b36bff', '#ffffff'];
        conf.innerHTML = Array.from({ length: 70 }, () => `<i style="left:${Math.random() * 100}%; background:${couleurs[Math.floor(Math.random() * couleurs.length)]}; --d:${(2.2 + Math.random() * 2).toFixed(2)}s; --l:${(Math.random() * .9).toFixed(2)}s; --x:${Math.round((Math.random() - .5) * 160)}px; --r:${Math.round(360 + Math.random() * 720)}deg"></i>`).join('');
        fin.appendChild(conf);
        setTimeout(() => conf.remove(), 5500);
      }
    }
    const retour = async () => { fermerScene(); try{ await charger(); dessiner(); }catch(e){ /* l'onglet a changé */ } };
    fin.querySelector('[data-retour]').addEventListener('click', retour);
    fin.querySelector('[data-rejouer]').addEventListener('click', async () => { fermerScene(); await lancer(r.etage); });
    const s2 = fin.querySelector('[data-suite]');
    if(s2) s2.addEventListener('click', async () => { fermerScene(); await lancer(null); });
  }

  // Rejouer un déroulé sans passer par la base (essais de la mise en scène) : WaveCombat.essai(resultat, api, { manuel, sans3d }).
  // Rend tout de suite { scene, fini } : scene.moteur.pas(dt) avance d'une image quand opts.manuel est vrai.
  function essai(r, api, options){ init(api); const fini = jouer(r, options); return { scene: S.scene, fini }; }

  // ---------------------------------------------------------------------
  // La fiche de combat d'une carte (collection)
  // ---------------------------------------------------------------------

  async function fiche(el, api, o){
    init(api);
    try{
      const c = await A.appel('combat_carte', { p_artist: o.artist, p_booster: o.booster || null, p_holo: !!o.holo });
      const mx = { pv: 300, pui: 160, def: 160, vit: 120 };
      const pct = (v, m) => Math.max(4, Math.min(100, Math.round(v / m * 100)));
      el.innerHTML = `<div class="ct-titre-sec" style="margin:22px 0 10px"><h3>Fiche de combat</h3></div>
        <div class="cb-fiche">
          <div class="cb-fiche-t"><div class="cb-roles">${c.role_nom ? `<span class="cb-role">${esc(c.role_nom)}</span>` : ''}${c.niveau > 1 || c.etoiles > 0 ? `<span class="cb-role" style="color:#1a1200; background:linear-gradient(90deg, #ffd76a, #ffb547)">Niv ${c.niveau}${c.etoiles ? ' ' + '★'.repeat(c.etoiles) : ''}</span>` : ''}</div>
            <div class="cb-pvgros"><small>PV</small>${nf(c.pv)}</div></div>
          ${c.role_resume ? `<p class="cb-cap" style="margin:0">${esc(c.role_resume)}</p>` : ''}
          <div class="cb-stats">${[['pui', 'Puissance'], ['def', 'Défense'], ['vit', 'Vitesse']].map(([k, l]) => `<div class="cb-st"><span>${l}</span><b>${nf(c[k])}</b><i style="--w:${pct(c[k], mx[k])}%"></i></div>`).join('')}</div>
          ${c.capacite ? `<div class="cb-cap"><b>Passif · ${esc(c.capacite.nom)}</b> — ${esc(c.capacite.description)}</div>` : ''}
        </div>`;
    }catch(e){
      el.innerHTML = '';
    }
  }

  // ---------------------------------------------------------------------
  // L'équipe : réglages de la Tour
  // ---------------------------------------------------------------------

  async function equipe(hote, api){
    init(api);
    hote.innerHTML = '<div class="ct-vide">Chargement…</div>';
    let d;
    try{ d = await A.appel('combat_pve_equipe_lire'); }
    catch(e){ hote.innerHTML = `<div class="ct-panneau ct-vide"><b>La Tour ne répond pas</b>${esc(e.message)}</div>`; return; }
    const taille = (d.reglages.find((r) => r.cle === 'equipe_taille') || {}).valeur || 3;
    const champ = (id, lib, cleF, v, pas) => `<label class="ee-champ"><span>${lib}</span><input type="number" step="${pas || 1}" data-f="${cleF}" data-id="${esc(id)}" value="${v}"></label>`;
    hote.innerHTML = `
      <div class="ct tr">
        <div class="ct-panneau">
          <h3 style="margin:0 0 4px">Cartes par équipe</h3>
          <p class="sous" style="margin:0 0 10px">Le nombre de cartes que chaque joueur pose (et que la Tour oppose). De 1 à 5.</p>
          <div class="tr-actions"><input type="number" min="1" max="5" value="${taille}" data-taille style="width:90px; height:42px; padding:0 12px; border-radius:10px; border:1px solid var(--ct-trait-fort); background:rgba(0,0,0,.28); color:var(--ink); font:inherit">
            <button type="button" class="ct-btn petit principal" data-taille-ok>Enregistrer</button></div>
        </div>
        ${d.difficultes.filter((x) => x.id === 'classique').map((x) => `
        <div class="ct-panneau" style="margin-top:14px" data-diff="${esc(x.id)}">
          <h3 style="margin:0 0 4px">${esc(x.nom)}</h3>
          <p class="sous" style="margin:0 0 10px">${esc(x.resume)}</p>
          <div class="ee-iv-grille">
            ${champ(x.id, 'Étages', 'etages', x.etages)}${champ(x.id, 'Bonus adverse au départ (%)', 'bonus_base', x.bonus_base)}
            ${champ(x.id, 'Bonus par étage (%)', 'bonus_etage', x.bonus_etage, 0.05)}${champ(x.id, 'Bonus des gardiens (%)', 'bonus_gardien', x.bonus_gardien)}
            ${champ(x.id, 'Rareté en plus (0 à 3)', 'rarete_plus', x.rarete_plus)}${champ(x.id, 'Multiplicateur de Wave Coins', 'mult_wc', x.mult_wc, 0.1)}
            ${champ(x.id, 'Multiplicateur de vinyles', 'mult_vinyles', x.mult_vinyles, 0.1)}
          </div>
          <div class="tr-actions" style="margin-top:12px"><button type="button" class="ct-btn petit principal" data-sauver="${esc(x.id)}">Enregistrer</button></div>
        </div>`).join('')}
      </div>`;
    hote.querySelector('[data-taille-ok]').addEventListener('click', async (ev) => {
      ev.target.disabled = true;
      try{ await A.appel('combat_pve_equipe_reglage', { p_cle: 'equipe_taille', p_valeur: Math.min(5, Math.max(1, Number(hote.querySelector('[data-taille]').value))) }); A.toast('Taille d\'équipe enregistrée.'); S.cartes = null; }
      catch(e){ A.toast(e.message, 'err'); }
      ev.target.disabled = false;
    });
    hote.querySelectorAll('[data-sauver]').forEach((b) => b.addEventListener('click', async () => {
      const x = d.difficultes.find((y) => y.id === b.dataset.sauver);
      const p = { id: x.id, nom: x.nom, resume: x.resume, actif: x.actif, deblocage_etage: 0 };
      hote.querySelectorAll(`[data-diff="${x.id}"] [data-f]`).forEach((i) => { p[i.dataset.f] = Number(i.value); });
      b.disabled = true;
      try{ await A.appel('combat_pve_equipe_difficulte', { p }); A.toast('Tour enregistrée.'); }
      catch(e){ A.toast(e.message, 'err'); }
      b.disabled = false;
    }));
  }

  async function equipeCarte(hote, api, artistId){
    init(api);
    hote.innerHTML = '<div class="ct-vide">Chargement…</div>';
    try{
      const c = await A.appel('combat_equipe_carte', { p_artist: artistId });
      const e = c.effectif || {};
      hote.innerHTML = `<div class="cb-fiche">
        <div class="cb-fiche-t"><div class="cb-roles">${e.role_nom ? `<span class="cb-role">${esc(e.role_nom)}</span>` : ''}</div><div class="cb-pvgros"><small>PV</small>${nf(e.pv)}</div></div>
        <div class="cb-stats">${[['pui', 'Puissance'], ['def', 'Défense'], ['vit', 'Vitesse']].map(([k, l]) => `<div class="cb-st"><span>${l}</span><b>${nf(e[k])}</b></div>`).join('')}</div>
        ${e.capacite ? `<div class="cb-cap"><b>Passif · ${esc(e.capacite.nom)}</b> — ${esc(e.capacite.description)}</div>` : ''}
        <p class="cb-cap" style="margin:0">Statistiques de base. Les attaques sont les titres de l'album lié à la carte.</p></div>`;
    }catch(err){
      hote.innerHTML = `<p class="sous">${esc(err.message)}</p>`;
    }
  }

  window.WaveCombat = { monter, quitter, fiche, equipe, equipeCarte, essai };

})();
