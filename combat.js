/* =====================================================================
   La Wave — Wave Cards : le combat 2v2

   Chargé à la demande par cartes.js (onglet « Combat », chargerWaveModule('combat') dans index.html).
   Le moteur vit dans la base (sql/combat-*.sql) : types, statistiques, attaques, tours, adversaires, trophées. Ce fichier
   demande, affiche et anime : tout calcul et tout hasard restent côté serveur.

     monter(hote, api)            l'onglet : mon rang, mes duos, l'Arène, le défi du jour, les défis entre joueurs,
                                  le classement, l'historique, l'écran de combat animé
     fiche(el, api, opts)         la fiche de combat d'une carte (type, stats, attaques, capacité, faiblesses)
     equipe(hote, api)            la console de l'équipe : cartes, types et affinités, attaques, capacités, Arène, test
     equipeCarte(hote, api, id)   l'éditeur compact des réglages d'UNE carte (pour l'éditeur de cartes de l'équipe)
     quitter()                    ferme l'écran de combat (le combat reste en cours côté serveur)
   ===================================================================== */

(function(){

  'use strict';

  let A = null;   // l'interface partagée du jeu (window.Cartes.api)
  const S = { hote: null, vue: 'jouer', acc: null, adv: null, clas: null, histo: null, scene: null, cat: null };

  const LIB = { pv: 'PV', pui: 'Puissance', def: 'Défense', vit: 'Vitesse' };
  const MODES = { arene: 'Arène', defi: 'Défi du jour', pvp: 'Défi entre joueurs', entrainement: 'Entraînement' };
  const EFFETS = { soin: 'Soin', 'pui+': 'Puissance +', 'def+': 'Défense +', 'vit+': 'Vitesse +', 'pui-': 'Puissance −', 'def-': 'Défense −', 'vit-': 'Vitesse −', etourdi: 'Étourdissement', poison: 'Poison', vampirisme: 'Vampirisme', recul: 'Recul' };
  const CIBLES = { ennemi: 'Un adversaire', ennemis: 'Les deux adversaires', allie: 'Un allié', soi: 'Soi-même', equipe: 'Tout le duo' };
  const ROLES = { base: 'Attaque de base', forte: 'Attaque forte', soutien: 'Soutien', neutre: 'Neutre (sans type)' };
  const CODES = { regeneration: 'Régénération (% PV par tour)', epines: 'Épines (% des dégâts renvoyés)', sang_froid: 'Sang-froid (insensible aux statuts)', ouverture: 'Ouverture (% de dégâts en plus au 1er coup)', dernier_souffle: 'Dernier souffle (% des PV max en dégâts)', survivant: 'Survivant (1 PV une fois)', aura: 'Aura (% de Puissance pour le duo)', concentration: 'Concentration (ne rate jamais)' };

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

  /* ---------- l'écran de combat ---------- */
  .cb-scene{--tc:#4FB4FF; background:#05080d; font-family:inherit;}
  .cb-s-tete{position:relative; z-index:7; display:flex; align-items:center; gap:10px; padding:max(12px, env(safe-area-inset-top)) 70px 8px 16px;}
  .cb-s-tete > div:first-child{flex:1; min-width:0;}
  .cb-s-tete small{display:block; font-size:11px; font-weight:700; letter-spacing:.1em; text-transform:uppercase; color:rgba(255,255,255,.55);}
  .cb-s-tete b{display:block; font-size:16px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
  .cb-s-tour{font-size:12px; color:rgba(255,255,255,.6); white-space:nowrap;}
  .cb-s-tour b{display:inline; font-size:14px; color:#fff;}
  .cb-mini{all:unset; cursor:pointer; box-sizing:border-box; height:30px; padding:0 11px; border-radius:9px; font-size:12px; font-weight:700; color:rgba(255,255,255,.75); border:1px solid rgba(255,255,255,.16); background:rgba(255,255,255,.06); white-space:nowrap;}
  .cb-mini:hover{background:rgba(255,255,255,.12);}
  .cb-mini[aria-pressed="true"]{color:#05070a; background:#F4F5F6;}
  .cb-mini:focus-visible{outline:2px solid #fff;}
  .cb-champ{position:relative; z-index:3; flex:1; min-height:0; display:flex; flex-direction:column; justify-content:space-around; gap:6px; padding:4px 12px; overflow:hidden;}
  .cb-rangee{display:flex; justify-content:center; gap:clamp(10px, 4vw, 44px);}
  .cb-u{position:relative; width:clamp(104px, 21vh, 160px); display:grid; gap:5px; transition:opacity .4s, filter .4s;}
  .cb-u-carte{position:relative; border-radius:13px;}
  .cb-u-carte .ct-carte{width:100%;}
  .cb-u.agit-b .cb-u-carte{animation:cbAvB .5s cubic-bezier(.3,.7,.3,1);}
  .cb-u.agit-h .cb-u-carte{animation:cbAvH .5s cubic-bezier(.3,.7,.3,1);}
  .cb-u.touche .cb-u-carte{animation:cbSecoue .45s;}
  .cb-u.touche .cb-u-carte::after{content:''; position:absolute; inset:0; border-radius:13px; background:rgba(255,70,70,.45); animation:cbFlash .45s both;}
  .cb-u.soin .cb-u-carte::after{content:''; position:absolute; inset:0; border-radius:13px; background:rgba(91,224,166,.4); animation:cbFlash .6s both;}
  .cb-u.ko{filter:grayscale(1); opacity:.42;}
  .cb-ko{position:absolute; z-index:6; left:50%; top:46%; transform:translate(-50%, -50%) rotate(-12deg); display:none; padding:4px 12px; border-radius:8px; font-size:18px; font-weight:900; letter-spacing:.08em; color:#fff; background:rgba(220,50,60,.92);}
  .cb-u.ko .cb-ko{display:block;}
  .cb-u.cible-ok .cb-u-carte{outline:3px solid var(--ct-accent); outline-offset:3px; cursor:pointer;}
  .cb-u-nom{display:flex; align-items:center; justify-content:center; gap:6px; flex-wrap:wrap; font-size:12.5px; font-weight:700; text-align:center;}
  .cb-pv{position:relative; height:14px; border-radius:99px; background:rgba(255,255,255,.12); overflow:hidden;}
  .cb-pv i{position:absolute; inset:0 auto 0 0; border-radius:99px; background:#5BE0A6; transition:width .55s cubic-bezier(.2,.8,.2,1), background .3s;}
  .cb-pv.mid i{background:#F2C14E;} .cb-pv.bas i{background:#FF5C6A;}
  .cb-pv b{position:absolute; inset:0; display:grid; place-items:center; font-size:10.5px; font-weight:800; color:#fff; text-shadow:0 1px 3px rgba(0,0,0,.8); font-variant-numeric:tabular-nums;}
  .cb-badges{display:flex; flex-wrap:wrap; justify-content:center; gap:3px; min-height:16px;}
  .cb-badges span{padding:1px 6px; border-radius:6px; font-size:10px; font-weight:800; background:rgba(255,255,255,.12); color:#fff;}
  .cb-badges .haut{background:rgba(91,224,166,.25); color:#8ff0c2;}
  .cb-badges .bas{background:rgba(255,92,106,.25); color:#ff9aa3;}
  .cb-badges .statut{background:rgba(242,193,78,.25); color:#F2C14E;}
  .cb-flotte{position:absolute; z-index:8; left:50%; top:30%; transform:translateX(-50%); font-size:26px; font-weight:900; pointer-events:none; text-shadow:0 2px 8px rgba(0,0,0,.9); animation:cbFlotte 1.1s ease-out both;}
  .cb-flotte.degat{color:#ff6b75;} .cb-flotte.soin{color:#5BE0A6;} .cb-flotte.texte{font-size:16px; color:#fff;}
  .cb-fx{position:absolute; z-index:5; inset:-14%; border-radius:50%; pointer-events:none; background:radial-gradient(circle, var(--tc) 0%, transparent 68%); mix-blend-mode:screen; animation:cbFx .55s ease-out both;}
  .cb-msg{position:relative; z-index:4; min-height:46px; display:grid; place-items:center; padding:8px 14px; border-radius:14px; border:1px solid rgba(255,255,255,.12); background:rgba(0,0,0,.45); text-align:center; font-size:15px; font-weight:700; line-height:1.35;}
  .cb-cmd{position:relative; z-index:7; max-height:46vh; overflow-y:auto; padding:10px 12px max(16px, env(safe-area-inset-bottom)); background:linear-gradient(180deg, rgba(5,8,13,.2), rgba(5,8,13,.96) 18%); scrollbar-width:thin;}
  .cb-cmd-grille{display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:10px; max-width:860px; margin:0 auto;}
  .cb-cmd-u{display:grid; gap:7px; align-content:start; padding:10px; border-radius:14px; border:1px solid rgba(255,255,255,.12); background:rgba(255,255,255,.04);}
  .cb-cmd-u.ko{opacity:.4;}
  .cb-cmd-t{display:flex; align-items:center; justify-content:space-between; gap:6px; font-size:13px; font-weight:800;}
  .cb-attbtn{all:unset; box-sizing:border-box; cursor:pointer; display:grid; gap:3px; padding:8px 10px; border-radius:11px; border:2px solid rgba(255,255,255,.1); background:rgba(0,0,0,.3); border-left:4px solid var(--tc, #9aa4b2);}
  .cb-attbtn:hover{background:rgba(255,255,255,.08);}
  .cb-attbtn:focus-visible{outline:2px solid #fff; outline-offset:1px;}
  .cb-attbtn[aria-pressed="true"]{border-color:#F4F5F6; background:rgba(255,255,255,.1);}
  .cb-attbtn .n{display:flex; align-items:center; justify-content:space-between; gap:6px; font-size:13px; font-weight:800;}
  .cb-attbtn .m{font-size:11px; color:rgba(255,255,255,.6);}
  .cb-attbtn .e{font-size:11px; font-weight:800; min-height:14px;}
  .cb-attbtn .e.sup{color:#5BE0A6;} .cb-attbtn .e.peu{color:#ff9aa3;}
  .cb-cibles{display:flex; flex-wrap:wrap; align-items:center; gap:5px; font-size:11.5px; color:rgba(255,255,255,.6);}
  .cb-cibles button{all:unset; cursor:pointer; box-sizing:border-box; height:26px; padding:0 10px; border-radius:99px; font-size:12px; font-weight:700; color:#fff; border:1px solid rgba(255,255,255,.2);}
  .cb-cibles button[aria-pressed="true"]{color:#05070a; background:#F4F5F6; border-color:#F4F5F6;}
  .cb-cibles button:focus-visible{outline:2px solid #fff;}
  .cb-go{display:flex; justify-content:center; margin-top:12px;}
  .cb-fin{max-width:520px; margin:0 auto; display:grid; gap:12px; text-align:center; justify-items:center; padding:6px 0;}
  .cb-fin h3{margin:0; font-size:clamp(28px, 7vw, 40px); font-weight:900; letter-spacing:-.02em;}
  .cb-fin.victoire h3{color:#5BE0A6;} .cb-fin.defaite h3{color:#FF7A85;}
  .cb-fin .boutons{display:flex; flex-wrap:wrap; gap:10px; justify-content:center;}
  .cb-fin-gains{display:flex; flex-wrap:wrap; gap:8px; justify-content:center;}
  .cb-fin-gains span{padding:7px 12px; border-radius:11px; font-size:14px; font-weight:800; background:rgba(255,255,255,.1);}
  @keyframes cbAvH{40%{transform:translateY(26px) scale(1.04);} 100%{transform:none;}}
  @keyframes cbAvB{40%{transform:translateY(-26px) scale(1.04);} 100%{transform:none;}}
  @keyframes cbSecoue{0%,100%{transform:none;} 20%{transform:translateX(-9px);} 40%{transform:translateX(8px);} 60%{transform:translateX(-5px);} 80%{transform:translateX(3px);}}
  @keyframes cbFlash{from{opacity:1;} to{opacity:0;}}
  @keyframes cbFlotte{from{opacity:0; transform:translate(-50%, 10px) scale(.7);} 20%{opacity:1; transform:translate(-50%, 0) scale(1.15);} to{opacity:0; transform:translate(-50%, -46px) scale(1);}}
  @keyframes cbFx{from{opacity:.95; transform:scale(.3);} to{opacity:0; transform:scale(1.25);}}
  @media (max-width:640px){
    .cb-rang{grid-template-columns:1fr;}
    .cb-trophees{grid-template-columns:auto auto; justify-content:space-between; place-items:center; text-align:left; gap:10px;}
    .cb-ligne{grid-template-columns:auto 1fr; }
    .cb-ligne > :last-child{grid-column:1 / -1;}
    .cb-cmd-grille{grid-template-columns:1fr;}
    .cb-u{width:clamp(96px, 19vh, 132px);}
    .cb-cmd{max-height:50vh;}
  }
  @media (prefers-reduced-motion: reduce){
    .cb-u.agit-b .cb-u-carte, .cb-u.agit-h .cb-u-carte, .cb-u.touche .cb-u-carte, .cb-fx{animation:none !important;}
  }
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
  }

  const nf = (n) => A.nf(n);
  const esc = (t) => A.esc(t);
  const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
  const calme = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const couleur = (c) => A.couleurOk(c || '#9aa4b2');
  const pct = (a, b) => Math.max(0, Math.min(100, b ? a / b * 100 : 0));
  const mu = (m) => '×' + String(Number(m)).replace('.', ',');
  const chip = (nom, c) => nom ? `<span class="cb-type" style="--tc:${couleur(c)}">${esc(nom)}</span>` : '<span class="cb-type neutre">Neutre</span>';
  const signe = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n);

  // ---------------------------------------------------------------------
  // La fiche de combat d'une carte : type, PV, stats, attaques, capacité, faiblesses, citation
  // ---------------------------------------------------------------------

  function attaqueHtml(a){
    const bits = [];
    if(a.puissance) bits.push('Puissance ' + a.puissance);
    if(a.puissance) bits.push(a.justesse + ' % de précision');
    bits.push(CIBLES[a.cible] || '');
    if(a.effet && a.chance < 100) bits.push(a.chance + ' % d\'effet');
    return `<div class="cb-att" style="--tc:${couleur(a.couleur)}">
      <div class="cb-att-t"><b>${esc(a.nom)}</b>${chip(a.type_nom, a.couleur)}</div>
      <div class="cb-att-m">${bits.filter(Boolean).map((b) => `<span>${esc(b)}</span>`).join('')}</div>
      ${a.description ? `<p>${esc(a.description)}</p>` : ''}
    </div>`;
  }

  function ficheHtml(c){
    const mx = { pv: 300, pui: 160, def: 160, vit: 120 };
    const aff = (liste) => liste && liste.length ? liste.map((t) => `<span class="cb-type" style="--tc:${couleur(t.couleur)}">${esc(t.nom)} ${mu(t.mult)}</span>`).join('') : '<span>aucune</span>';
    return `<div class="cb-fiche" style="--tc:${couleur(c.couleur)}">
      <div class="cb-fiche-t"><div>${chip(c.type_nom, c.couleur)}</div><div class="cb-pvgros"><small>PV</small>${nf(c.pv)}</div></div>
      <div class="cb-stats">${['pui', 'def', 'vit'].map((k) => `<div class="cb-st"><span>${LIB[k]}</span><b>${nf(c[k])}</b><i style="--w:${pct(c[k], mx[k])}%"></i></div>`).join('')}</div>
      <div class="cb-atts">${(c.attaques || []).map(attaqueHtml).join('')}</div>
      ${c.capacite ? `<div class="cb-cap"><b>${esc(c.capacite.nom)}</b> · ${esc(c.capacite.description)}</div>` : ''}
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

  // ---------------------------------------------------------------------
  // Mon rang, mes duos, les modes de jeu
  // ---------------------------------------------------------------------

  const duoDepuis = (infos) => infos.map((c) => ({ booster: c.booster, artist: c.artist_id, holo: !!c.holo }));

  async function monter(hote, api){
    init(api);
    S.hote = hote;
    if(!hote.querySelector('.cb')) hote.innerHTML = '<div class="ct-vide">Chargement…</div>';
    try{
      S.acc = await A.appel('combat_accueil');
    }catch(e){
      hote.innerHTML = `<div class="ct-panneau ct-vide"><b>Le combat n'a pas pu s'ouvrir</b>${esc(e.message)}</div>`;
      return;
    }
    dessiner();
  }

  function quitter(){ fermerScene(); }

  async function rafraichir(){
    try{ S.acc = await A.appel('combat_accueil'); }catch(e){ /* l'écran reste tel quel */ }
    if(S.hote && S.hote.isConnected) dessiner();
  }

  const slotHtml = (c) => c
    ? `<div class="cb-slot" style="--tc:${couleur(c.couleur)}">
        ${A.carteHtml({ nom: c.nom, photo: c.photo, rarete: c.rarete, holo: c.holo, numero: c.numero || 0 }, {})}
        <div class="cb-slot-i"><b>${esc(c.nom)}</b>${chip(c.type_nom, c.couleur)}
          <div class="cb-mini-stats" style="margin-top:5px"><span>PV <b>${nf(c.pv)}</b></span><span>PUI <b>${nf(c.pui)}</b></span><span>DÉF <b>${nf(c.def)}</b></span><span>VIT <b>${nf(c.vit)}</b></span></div></div>
      </div>`
    : '<div class="cb-slot"><div class="vide">Carte à choisir</div></div>';

  function dessiner(){
    const a = S.acc, m = a.moi;
    const duo = a.duo || [], def = a.defense || [];
    const fin = new Date(m.saison_fin + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
    const palFaits = a.arene.filter((p) => p.etat === 'fait').length;
    const vues = [['jouer', 'Jouer'], ['arene', 'Arène'], ['classement', 'Classement'], ['historique', 'Historique']];

    S.hote.innerHTML = `
      <div class="cb">
        ${a.en_cours ? `<div class="cb-banniere"><div><b>Un combat est en cours</b>${esc(a.en_cours.adversaire)} · ${esc(MODES[a.en_cours.mode] || '')} · tour ${a.en_cours.tour}</div>
          <button type="button" class="ct-btn principal" data-reprendre>Reprendre</button><button type="button" class="ct-btn" data-abandonner>Abandonner</button></div>` : ''}
        <section class="ct-panneau cb-rang">
          <div class="cb-trophees"><b>${nf(m.trophees)}</b><span>${A.ico('trophee', 14)}Trophées</span></div>
          <div class="cb-rang-d">
            <h3>${m.rang ? 'N° ' + m.rang + ' du classement' : 'Pas encore classé'} · saison ${esc(m.saison)}</h3>
            <p>La saison se termine le ${esc(fin)} : tes trophées reviennent alors à mi-chemin de 1 000.</p>
            <div class="cb-chiffres">
              <span><b>${m.victoires}</b> victoire${m.victoires > 1 ? 's' : ''}</span><span><b>${m.defaites}</b> défaite${m.defaites > 1 ? 's' : ''}</span>
              <span>Série <b>${m.serie}</b> (record ${m.meilleure_serie})</span><span>Défense : <b>${m.defenses_gagnees}</b> tenue${m.defenses_gagnees > 1 ? 's' : ''}, <b>${m.defenses_perdues}</b> perdue${m.defenses_perdues > 1 ? 's' : ''}</span>
              <span>Vinyles gagnés aujourd'hui <b>${m.vinyles_jour} / ${m.plafond_jour}</b></span>
            </div>
          </div>
        </section>
        <nav class="cb-seg" aria-label="Combat">${vues.map(([id, nom]) => `<button type="button" data-vue="${id}" aria-pressed="${S.vue === id}">${nom}</button>`).join('')}</nav>
        <div data-corps></div>
      </div>`;

    const corps = S.hote.querySelector('[data-corps]');
    if(S.vue === 'jouer') vueJouer(corps, duo, def, palFaits);
    else if(S.vue === 'arene') vueArene(corps);
    else if(S.vue === 'classement') vueClassement(corps);
    else vueHistorique(corps);

    S.hote.querySelectorAll('.cb-seg [data-vue]').forEach((b) => b.addEventListener('click', () => { S.vue = b.dataset.vue; dessiner(); }));
    const r = S.hote.querySelector('[data-reprendre]');
    if(r) r.addEventListener('click', () => ouvrirScene(S.acc.en_cours));
    const ab = S.hote.querySelector('[data-abandonner]');
    if(ab) ab.addEventListener('click', () => confirmerAbandon(S.acc.en_cours));
  }

  function vueJouer(corps, duo, def, palFaits){
    const a = S.acc, m = a.moi, defi = a.defi;
    const pret = duo.length === 2;
    corps.innerHTML = `
      <div class="cb" style="gap:22px">
        <section class="ct-panneau">
          <div class="ct-entete-panneau"><div><h3>Mon duo</h3><p class="sous">Les deux cartes que tu emmènes au combat. Elles ne sont jamais perdues, quoi qu'il arrive.</p></div></div>
          <div class="cb-bloc-duo">
            <div class="cb-duo">${slotHtml(duo[0])}${slotHtml(duo[1])}</div>
            <div class="cb-actions"><button type="button" class="ct-btn principal" data-duo="principal">${pret ? 'Changer mon duo' : 'Choisir mon duo'}</button>
              <p>Un duo bien pensé joue sur les <b>types</b> : un style bat deux autres (×1,5) et plie devant deux autres (×0,67).</p></div>
          </div>
        </section>

        <div>
          <div class="ct-titre-sec" style="margin-top:0"><h3>Se battre</h3></div>
          <div class="cb-modes">
            <button type="button" class="cb-mode" data-mode="entrainement"><h4>${A.ico('combat', 18)}Entraînement</h4><p>Un duo au hasard de ton niveau. Pas de gain, pas de risque : parfait pour tester ton duo.</p><div class="pied"><span class="cb-puce">Illimité</span></div></button>
            <button type="button" class="cb-mode" data-mode="defi" style="--tc:${couleur(defi.couleur)}"><h4>${A.ico('cible', 18)}Défi du jour</h4>
              <p>Aujourd'hui, le style <b>${esc(defi.type_nom)}</b> est à l'honneur : ${defi.crew.map((c) => esc(c.nom)).join(' & ')}.</p>
              <div class="pied">${chip(defi.type_nom, defi.couleur)}<span class="cb-puce ${defi.fait ? 'ok' : 'or'}">${defi.fait ? 'Relevé aujourd\'hui' : '+' + defi.recompense + ' vinyles'}</span></div></button>
            <button type="button" class="cb-mode" data-vue-go="arene"><h4>${A.ico('trophee', 18)}Arène</h4><p>12 crews de plus en plus forts. La première victoire sur chacun rapporte des vinyles.</p><div class="pied"><span class="cb-puce ${palFaits === a.arene.length ? 'ok' : ''}">${palFaits} / ${a.arene.length} vaincus</span></div></button>
          </div>
        </div>

        <section class="ct-panneau">
          <div class="ct-entete-panneau"><div><h3>Ma défense</h3><p class="sous">Quand un joueur te défie, ce duo se bat à ta place (piloté par l'ordinateur). Tu gagnes des trophées s'il tient.</p></div></div>
          <div class="cb-bloc-duo">
            <div class="cb-duo">${slotHtml(def[0])}${slotHtml(def[1])}</div>
            <div class="cb-actions"><button type="button" class="ct-btn" data-duo="defense">${def.length === 2 ? 'Changer ma défense' : 'Régler ma défense'}</button>
              ${def.length === 2 ? '' : '<p>Sans défense réglée, personne ne peut te défier (et tu ne gagnes pas de trophées passivement).</p>'}</div>
          </div>
        </section>

        <section>
          <div class="ct-titre-sec" style="margin-top:0"><h3>Défier un joueur</h3><span class="cb-puce">${m.pvp_restants} défi${m.pvp_restants > 1 ? 's' : ''} restant${m.pvp_restants > 1 ? 's' : ''} aujourd'hui</span></div>
          <div class="cb-liste" data-adv><div class="ct-vide" style="padding:20px">Chargement…</div></div>
        </section>
      </div>`;

    corps.querySelectorAll('[data-duo]').forEach((b) => b.addEventListener('click', () => ouvrirSelecteur(b.dataset.duo)));
    corps.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => lancer(b.dataset.mode, null)));
    corps.querySelectorAll('[data-vue-go]').forEach((b) => b.addEventListener('click', () => { S.vue = b.dataset.vueGo; dessiner(); }));

    A.appel('combat_adversaires').then((liste) => {
      const z = corps.querySelector('[data-adv]');
      if(!z) return;
      S.adv = liste;
      z.innerHTML = liste.length ? liste.map((o, i) => `
        <div class="cb-ligne">
          <div class="cb-portraits">${o.avatar ? `<img class="cb-avatar" src="${esc(A.safeUrl(o.avatar))}" alt="">` : ''}</div>
          <div><h4>${esc(o.pseudo)} · ${nf(o.trophees)} ${A.ico('trophee', 13)}</h4>
            <p>${o.duo.map((c) => `${esc(c.nom)} ${chip(c.type_nom, c.couleur)}`).join(' &nbsp;·&nbsp; ')}</p></div>
          <button type="button" class="ct-btn petit principal" data-defier="${i}" ${m.pvp_restants < 1 ? 'disabled' : ''}>Défier</button>
        </div>`).join('')
        : '<div class="ct-panneau ct-vide"><b>Personne à défier pour l\'instant</b>Les autres joueurs doivent d\'abord régler leur défense.</div>';
      z.querySelectorAll('[data-defier]').forEach((b) => b.addEventListener('click', () => lancer('pvp', liste[Number(b.dataset.defier)].user_id)));
    }).catch(() => {
      const z = corps.querySelector('[data-adv]');
      if(z) z.innerHTML = '<div class="ct-panneau ct-vide">Impossible de charger les adversaires.</div>';
    });
  }

  function vueArene(corps){
    const a = S.acc;
    corps.innerHTML = `
      <div class="ct-titre-sec" style="margin-top:0"><h3>L'Arène</h3><span class="cb-puce">${a.arene.filter((p) => p.etat === 'fait').length} / ${a.arene.length} vaincus</span></div>
      <div class="cb-liste">${a.arene.map((p) => `
        <div class="cb-ligne${p.etat === 'verrouille' ? ' verrou' : ''}" style="--tc:${couleur(p.crew[0].couleur)}">
          <div class="cb-n">${p.palier}</div>
          <div><h4>${esc(p.nom)}</h4><p>${esc(p.description)}</p>
            <div style="display:flex; align-items:center; gap:10px; margin-top:8px; flex-wrap:wrap">
              <div class="cb-portraits">${p.crew.map((c) => `<img style="--tc:${couleur(c.couleur)}" src="${esc(A.safeUrl(c.photo))}" alt="${esc(c.nom)}" title="${esc(c.nom)} · ${esc(c.type_nom)}" loading="lazy">`).join('')}</div>
              <span class="cb-slot-i">${p.crew.map((c) => esc(c.nom)).join(' & ')}</span>
              ${p.crew.map((c) => chip(c.type_nom, c.couleur)).join('')}
              ${p.bonus ? `<span class="cb-puce">Stats +${p.bonus} %</span>` : ''}
              <span class="cb-puce ${p.etat === 'fait' ? 'ok' : 'or'}">${p.etat === 'fait' ? 'Vaincu' : '+' + p.recompense + ' vinyle' + (p.recompense > 1 ? 's' : '')}</span></div></div>
          <button type="button" class="ct-btn petit ${p.etat === 'ouvert' ? 'principal' : ''}" data-palier="${p.palier}" ${p.etat === 'verrouille' ? 'disabled' : ''}>${p.etat === 'verrouille' ? 'Verrouillé' : p.etat === 'fait' ? 'Rejouer' : 'Combattre'}</button>
        </div>`).join('')}</div>`;
    corps.querySelectorAll('[data-palier]').forEach((b) => b.addEventListener('click', () => lancer('arene', b.dataset.palier)));
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
  // Le sélecteur de duo
  // ---------------------------------------------------------------------

  async function ouvrirSelecteur(role, apres){
    let cartes;
    try{ cartes = await A.appel('combat_mes_cartes'); }catch(e){ A.toast(e.message, 'err'); return; }
    if(cartes.length < 2){ A.toast('Il te faut au moins 2 cartes pour former un duo : ouvre des boosters !', 'err'); return; }

    const cle = (c) => c.booster + '|' + c.artist_id + '|' + (c.holo ? 1 : 0);
    const f = { q: '', type: null, tri: 'rarete' };
    let choix = [];
    const actuel = role === 'defense' ? S.acc.defense : S.acc.duo;
    (actuel || []).forEach((c) => { const k = cle(c); if(cartes.some((x) => cle(x) === k) && choix.length < 2) choix.push(k); });

    const types = [];
    cartes.forEach((c) => { if(!types.some((t) => t.id === c.type)) types.push({ id: c.type, nom: c.type_nom, c: c.couleur }); });
    const fen = A.fenetre(`
      <h2>${role === 'defense' ? 'Ma défense' : 'Mon duo'}</h2>
      <p class="sous">${role === 'defense' ? 'Ces deux cartes se battront quand un joueur te défiera.' : 'Choisis deux cartes : elles combattront ensemble.'} Touche une carte pour la choisir, ⓘ pour sa fiche.</p>
      <div class="cb-sel-tete">
        <input type="search" placeholder="Chercher un artiste" data-q aria-label="Chercher un artiste">
        <select data-tri aria-label="Trier"><option value="rarete">Rareté</option><option value="pv">PV</option><option value="pui">Puissance</option><option value="def">Défense</option><option value="vit">Vitesse</option><option value="nom">Nom (A–Z)</option></select>
      </div>
      <div class="cb-filtres" role="group" aria-label="Style">${types.map((t) => `<button type="button" data-t="${esc(t.id)}" style="--tc:${couleur(t.c)}" aria-pressed="false">${esc(t.nom)}</button>`).join('')}</div>
      <div class="cb-grille" data-grille></div>
      <div class="cb-sel-pied"><div class="cb-sel-choix" data-choix></div><button type="button" class="ct-btn principal" data-valider disabled>Valider le duo</button></div>`, true);

    const corps = fen.corps;
    const grille = corps.querySelector('[data-grille]');
    const dessine = () => {
      const q = f.q.trim().toLowerCase();
      let l = cartes.filter((c) => (!f.type || c.type === f.type) && (!q || c.nom.toLowerCase().includes(q)));
      const cmp = { rarete: (a, b) => b.rarete - a.rarete || b.pv - a.pv, pv: (a, b) => b.pv - a.pv, pui: (a, b) => b.pui - a.pui, def: (a, b) => b.def - a.def, vit: (a, b) => b.vit - a.vit, nom: (a, b) => a.nom.localeCompare(b.nom, 'fr') }[f.tri];
      l = l.slice().sort(cmp);
      grille.innerHTML = l.length ? l.map((c) => {
        const k = cle(c), i = choix.indexOf(k);
        return `<button type="button" class="cb-tuile" data-k="${esc(k)}" aria-pressed="${i >= 0}" aria-label="${esc(c.nom)}, ${esc(c.type_nom)}">
          <span class="num">${i + 1}</span><span class="info" data-info="${esc(k)}" role="button" aria-label="Fiche de ${esc(c.nom)}">i</span>
          ${A.carteHtml({ nom: c.nom, photo: c.photo, rarete: c.rarete, holo: c.holo, numero: c.numero }, {})}
          <span class="t">${chip(c.type_nom, c.couleur)}<span>PV ${nf(c.pv)}</span><span>PUI ${nf(c.pui)}</span></span></button>`;
      }).join('') : '<div class="ct-vide" style="grid-column:1/-1">Aucune carte ne correspond.</div>';
      corps.querySelectorAll('.cb-filtres button').forEach((b) => b.setAttribute('aria-pressed', String(f.type === b.dataset.t)));
      const ch = corps.querySelector('[data-choix]');
      ch.innerHTML = choix.length ? choix.map((k) => { const c = cartes.find((x) => cle(x) === k); return `<div style="border-left:3px solid ${couleur(c.couleur)}"><b>${esc(c.nom)}</b>${esc(c.type_nom)} · PV ${nf(c.pv)} · PUI ${nf(c.pui)} · DÉF ${nf(c.def)} · VIT ${nf(c.vit)}</div>`; }).join('') : 'Aucune carte choisie.';
      corps.querySelector('[data-valider]').disabled = choix.length !== 2;
    };
    dessine();

    grille.addEventListener('click', (ev) => {
      const inf = ev.target.closest('[data-info]');
      if(inf){ ev.stopPropagation(); const c = cartes.find((x) => cle(x) === inf.dataset.info); A.fiche(c.artist_id, c.booster); return; }
      const t = ev.target.closest('[data-k]');
      if(!t) return;
      const k = t.dataset.k, i = choix.indexOf(k);
      if(i >= 0) choix.splice(i, 1);
      else { if(choix.length >= 2) choix.shift(); choix.push(k); }
      dessine();
    });
    corps.querySelector('[data-q]').addEventListener('input', (ev) => { f.q = ev.target.value; dessine(); });
    corps.querySelector('[data-tri]').addEventListener('change', (ev) => { f.tri = ev.target.value; dessine(); });
    corps.querySelectorAll('.cb-filtres button').forEach((b) => b.addEventListener('click', () => { f.type = f.type === b.dataset.t ? null : b.dataset.t; dessine(); }));
    const ok = corps.querySelector('[data-valider]');
    ok.addEventListener('click', async () => {
      const duo = choix.map((k) => { const c = cartes.find((x) => cle(x) === k); return { booster: c.booster, artist: c.artist_id, holo: !!c.holo }; });
      ok.disabled = true;
      try{
        const infos = await A.appel('combat_duo_enregistrer', { p_role: role, p_duo: duo });
        if(role === 'defense') S.acc.defense = infos; else S.acc.duo = infos;
        fen.fermer();
        A.toast(role === 'defense' ? 'Défense enregistrée.' : 'Duo enregistré.');
        if(S.hote && S.hote.isConnected) dessiner();
        if(apres) apres(infos);
      }catch(e){ A.toast(e.message, 'err'); ok.disabled = false; }
    });
  }

  // ---------------------------------------------------------------------
  // Lancer, reprendre et abandonner un combat
  // ---------------------------------------------------------------------

  async function lancer(mode, cible){
    if(S.acc.en_cours){ A.toast('Un combat est déjà en cours : reprends-le ou abandonne-le.', 'err'); return; }
    if((S.acc.duo || []).length !== 2){
      ouvrirSelecteur('principal', () => lancer(mode, cible));
      return;
    }
    try{
      const p = await A.appel('combat_lancer', { p_mode: mode, p_cible: cible === null || cible === undefined ? null : String(cible), p_duo: duoDepuis(S.acc.duo) });
      S.acc.en_cours = null;
      ouvrirScene(p, { mode, cible });
    }catch(e){
      A.toast(e.message, 'err');
      rafraichir();
    }
  }

  function confirmerAbandon(partie, depuisScene){
    const f = A.fenetre(`
      <h2>Abandonner le combat ?</h2>
      <p class="sous">${partie.mode === 'pvp' ? 'Contre un joueur, un abandon compte comme une défaite et te coûte des trophées.' : 'Tu ne perds aucune carte. Tu pourras relancer un combat quand tu veux.'}</p>
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
  // L'écran de combat
  // ---------------------------------------------------------------------

  function fermerScene(){
    const sc = S.scene;
    if(!sc) return;
    S.scene = null;
    sc.fin = true;
    document.removeEventListener('keydown', sc.touche);
    sc.ov.remove();
    if(!document.querySelector('.ct-voile, .ct-scene')) document.documentElement.style.overflow = sc.avant;
  }

  function ouvrirScene(partie, ctx){
    if(S.scene) fermerScene();
    const U = JSON.parse(JSON.stringify(partie.unites));
    const sc = { id: partie.id, partie, ctx: ctx || { mode: partie.mode, cible: partie.cible }, U, tour: partie.tour, rapide: false, occupe: false, fin: false,
                 choix: {}, avant: document.documentElement.style.overflow };
    S.scene = sc;

    const ov = document.createElement('div');
    ov.className = 'ct-scene cb-scene';
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    ov.setAttribute('aria-label', 'Combat');
    ov.innerHTML = `
      <div class="ct-scene-fond"></div>
      <button type="button" class="ct-scene-x" aria-label="Quitter l'écran (le combat reste en cours)">${A.ico('croix', 20)}</button>
      <header class="cb-s-tete"><div><small>${esc(MODES[partie.mode] || '')}</small><b>${esc(partie.adversaire)}</b></div>
        <div class="cb-s-tour">Tour <b data-tour>${sc.tour}</b> / ${partie.max_tours || 20}</div>
        <button type="button" class="cb-mini" data-vite aria-pressed="false">Rapide</button><button type="button" class="cb-mini" data-abandon>Abandonner</button></header>
      <div class="cb-champ">
        <div class="cb-rangee" data-rang="1"></div>
        <div class="cb-msg" data-msg aria-live="polite">Le combat commence !</div>
        <div class="cb-rangee" data-rang="0"></div>
      </div>
      <div class="cb-cmd" data-cmd></div>`;
    document.documentElement.style.overflow = 'hidden';
    document.body.appendChild(ov);
    sc.ov = ov;

    sc.touche = (ev) => { if(ev.key === 'Escape' && !document.querySelector('.ct-voile')) quitterScene(); };
    document.addEventListener('keydown', sc.touche);

    const quitterScene = () => { fermerScene(); rafraichir(); };
    ov.querySelector('.ct-scene-x').addEventListener('click', quitterScene);
    ov.querySelector('[data-abandon]').addEventListener('click', () => { if(!sc.fin) confirmerAbandon({ id: sc.id, mode: partie.mode }, true); });
    const vite = ov.querySelector('[data-vite]');
    vite.addEventListener('click', () => { sc.rapide = !sc.rapide; vite.setAttribute('aria-pressed', String(sc.rapide)); });

    [2, 3].forEach((i) => ov.querySelector('[data-rang="1"]').appendChild(tuile(sc, i)));
    [0, 1].forEach((i) => ov.querySelector('[data-rang="0"]').appendChild(tuile(sc, i)));
    commandes(sc);
    const j = partie.journal || [];
    if(j.length) msg(sc, 'Combat repris au tour ' + sc.tour + '.');
    Son().jouer('volte');
  }

  const Son = () => A.Son;

  function tuile(sc, i){
    const u = sc.U[i];
    const d = document.createElement('div');
    d.className = 'cb-u';
    d.dataset.u = String(i);
    d.style.setProperty('--tc', couleur(u.couleur));
    d.innerHTML = `
      <div class="cb-u-carte">${A.carteHtml({ nom: u.nom, photo: u.photo, rarete: u.rarete, holo: u.holo, numero: u.numero || 0 }, {})}<span class="cb-ko">K.O.</span></div>
      <div class="cb-u-nom">${esc(u.nom)}${chip(u.type_nom, u.couleur)}</div>
      <div class="cb-pv" data-pv><i></i><b></b></div>
      <div class="cb-badges" data-badges></div>`;
    majTuile(sc, i, d);
    return d;
  }

  const elTuile = (sc, i) => sc.ov.querySelector(`.cb-u[data-u="${i}"]`);

  function majTuile(sc, i, d){
    d = d || elTuile(sc, i);
    if(!d) return;
    const u = sc.U[i], p = pct(u.pv, u.pv_max);
    d.classList.toggle('ko', !!u.ko);
    const b = d.querySelector('[data-pv]');
    b.classList.toggle('mid', p <= 50 && p > 25);
    b.classList.toggle('bas', p <= 25);
    b.querySelector('i').style.width = p + '%';
    b.querySelector('b').textContent = u.pv + ' / ' + u.pv_max;
    const bad = [];
    ['pui', 'def', 'vit'].forEach((k) => { const n = (u.mods || {})[k] || 0; if(n) bad.push(`<span class="${n > 0 ? 'haut' : 'bas'}">${LIB[k].slice(0, 3)} ${n > 0 ? '+' : '−'}${Math.abs(n)}</span>`); });
    if(u.statut && u.statut.etourdi) bad.push('<span class="statut">Étourdi</span>');
    if(u.statut && u.statut.poison > 0) bad.push('<span class="statut">Poison</span>');
    d.querySelector('[data-badges]').innerHTML = bad.join('');
  }

  function msg(sc, texte){
    const m = sc.ov.querySelector('[data-msg]');
    if(m) m.textContent = texte;
  }

  const pause = (sc, ms) => attendre(calme() ? Math.min(ms, 60) : sc.rapide ? ms * 0.25 : ms);

  function flotter(sc, i, texte, genre){
    const d = elTuile(sc, i);
    if(!d) return;
    const f = document.createElement('span');
    f.className = 'cb-flotte ' + genre;
    f.textContent = texte;
    d.querySelector('.cb-u-carte').appendChild(f);
    setTimeout(() => f.remove(), 1200);
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
    d.querySelector('.cb-u-carte').appendChild(fx);
    setTimeout(() => fx.remove(), 700);
  }

  // --- les commandes : une attaque et une cible pour chaque carte en vie
  function ciblesPossibles(sc, i, a){
    const camp = sc.U[i].camp;
    const v = (k) => !sc.U[k].ko;
    if(a.cible === 'ennemi') return sc.U.map((u, k) => k).filter((k) => sc.U[k].camp !== camp && v(k));
    if(a.cible === 'allie') return sc.U.map((u, k) => k).filter((k) => sc.U[k].camp === camp && v(k));
    return [];
  }

  function plusFaible(sc, liste){
    return liste.slice().sort((a, b) => sc.U[a].pv - sc.U[b].pv)[0];
  }

  function efficacite(sc, i, a, c){
    if(!a.puissance || !a.type || c === null || c === undefined) return '';
    const t = sc.U[c];
    if((t.faiblesses || []).includes(a.type)) return '<span class="e sup">Super efficace ×1,5</span>';
    if((t.resistances || []).includes(a.type)) return '<span class="e peu">Peu efficace ×0,67</span>';
    return '<span class="e"></span>';
  }

  function commandes(sc){
    const zone = sc.ov.querySelector('[data-cmd]');
    const mes = [0, 1].filter((i) => !sc.U[i].ko);
    sc.choix = {};
    mes.forEach((i) => {
      const cibles = ciblesPossibles(sc, i, sc.U[i].attaques[0]);
      sc.choix[i] = { a: 0, c: cibles.length ? plusFaible(sc, cibles) : null };
    });
    zone.innerHTML = `
      <div class="cb-cmd-grille">${[0, 1].map((i) => {
        const u = sc.U[i];
        if(u.ko) return `<div class="cb-cmd-u ko"><div class="cb-cmd-t"><span>${esc(u.nom)}</span><span>K.O.</span></div></div>`;
        return `<div class="cb-cmd-u" data-cu="${i}" style="--tc:${couleur(u.couleur)}"><div class="cb-cmd-t"><span>${esc(u.nom)}</span>${chip(u.type_nom, u.couleur)}</div>
          <div data-atts></div><div class="cb-cibles" data-cibles></div></div>`;
      }).join('')}</div>
      <div class="cb-go"><button type="button" class="ct-btn principal grand" data-go>Combattre !</button></div>`;
    mes.forEach((i) => dessinerChoix(sc, i));
    zone.querySelector('[data-go]').addEventListener('click', () => jouerTour(sc));
    const premier = zone.querySelector('.cb-attbtn');
    if(premier && !calme()) { /* le focus reste à l'utilisateur */ }
  }

  function dessinerChoix(sc, i){
    const u = sc.U[i], ch = sc.choix[i];
    const bloc = sc.ov.querySelector(`[data-cu="${i}"]`);
    if(!bloc) return;
    bloc.querySelector('[data-atts]').innerHTML = u.attaques.map((a, k) => `
      <button type="button" class="cb-attbtn" data-a="${k}" aria-pressed="${ch.a === k}" style="--tc:${couleur(a.couleur)}">
        <span class="n"><span>${esc(a.nom)}</span>${a.type ? chip(a.type_nom, a.couleur) : ''}</span>
        <span class="m">${a.puissance ? 'Puissance ' + a.puissance + ' · ' : ''}${esc(a.description || CIBLES[a.cible])}</span>
        ${ch.a === k ? efficacite(sc, i, a, ch.c) : ''}
      </button>`).join('');
    const a = u.attaques[ch.a], cibles = ciblesPossibles(sc, i, a);
    const zc = bloc.querySelector('[data-cibles]');
    if(cibles.length){
      if(!cibles.includes(ch.c)) ch.c = plusFaible(sc, cibles);
      zc.innerHTML = '<span>Cible :</span>' + cibles.map((k) => `<button type="button" data-c="${k}" aria-pressed="${ch.c === k}">${k === i ? 'Soi-même' : esc(sc.U[k].nom)}</button>`).join('');
    }else{
      zc.innerHTML = `<span>Cible : ${esc(CIBLES[a.cible] || '')}</span>`;
    }
    bloc.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', () => { ch.a = Number(b.dataset.a); ch.c = null; dessinerChoix(sc, i); }));
    bloc.querySelectorAll('[data-c]').forEach((b) => b.addEventListener('click', () => { ch.c = Number(b.dataset.c); dessinerChoix(sc, i); }));
  }

  // --- un tour : on envoie les choix, puis on rejoue les événements un à un
  async function jouerTour(sc){
    if(sc.occupe || sc.fin) return;
    sc.occupe = true;
    const zone = sc.ov.querySelector('[data-cmd]');
    zone.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    const actions = Object.keys(sc.choix).map((i) => ({ u: Number(i), a: sc.choix[i].a, c: sc.choix[i].c }));
    let r;
    try{
      r = await A.appel('combat_tour', { p_id: sc.id, p_actions: actions });
    }catch(e){
      A.toast(e.message, 'err');
      sc.occupe = false;
      zone.querySelectorAll('button').forEach((b) => { b.disabled = false; });
      return;
    }
    if(sc.fin) return;
    if(r.expire){
      msg(sc, 'Ce combat a expiré (trop longtemps sans jouer).');
      sc.fin = true;
      zone.innerHTML = '<div class="cb-fin"><h3>Combat expiré</h3><div class="boutons"><button type="button" class="ct-btn principal" data-retour>Retour</button></div></div>';
      zone.querySelector('[data-retour]').addEventListener('click', () => { fermerScene(); rafraichir(); });
      return;
    }
    A.Son.pret();
    let dernierType = null;
    for(const ev of r.evenements){
      if(sc.fin) return;
      if(ev.t === 'usage') dernierType = couleurAttaque(sc, ev);
      await rejouer(sc, ev, dernierType);
    }
    sc.U = JSON.parse(JSON.stringify(r.unites));
    [0, 1, 2, 3].forEach((i) => majTuile(sc, i));
    sc.tour = r.tour;
    const t = sc.ov.querySelector('[data-tour]');
    if(t) t.textContent = String(Math.min(sc.tour, (sc.partie.max_tours || 20)));
    sc.occupe = false;
    if(r.fini){ terminer(sc, r); return; }
    msg(sc, 'Que va jouer ton duo ?');
    commandes(sc);
  }

  function couleurAttaque(sc, ev){
    const a = (sc.U[ev.u].attaques || []).find((x) => x.nom === ev.a);
    return a && a.type ? a.couleur : '#ffffff';
  }

  const nomU = (sc, i) => sc.U[i].nom;

  async function rejouer(sc, ev, coul){
    const U = sc.U;
    switch(ev.t){
      case 'usage':
        msg(sc, `${nomU(sc, ev.u)} utilise ${ev.a} !`);
        classe(sc, ev.u, U[ev.u].camp === 0 ? 'agit-b' : 'agit-h', 520);
        await pause(sc, 800);
        break;
      case 'rate':
        msg(sc, `${nomU(sc, ev.c)} esquive l'attaque !`);
        flotter(sc, ev.c, 'Raté', 'texte');
        await pause(sc, 700);
        break;
      case 'degats': {
        const u = U[ev.c];
        u.pv = ev.pv;
        if(ev.ko) u.ko = true;
        classe(sc, ev.c, 'touche', 500);
        if(!ev.indirect) effetType(sc, ev.c, coul);
        flotter(sc, ev.c, '−' + ev.d, 'degat');
        A.Son.jouer('tic');
        A.vibre(ev.crit ? [20, 30, 20] : 12);
        majTuile(sc, ev.c);
        if(ev.recul) msg(sc, `${nomU(sc, ev.c)} subit le recul !`);
        else if(ev.poison) msg(sc, `${nomU(sc, ev.c)} souffre du poison.`);
        else if(ev.crit) msg(sc, 'Coup critique !');
        else if(ev.m > 1) msg(sc, 'C\'est super efficace !');
        else if(ev.m < 1) msg(sc, 'Ce n\'est pas très efficace…');
        await pause(sc, 750);
        if(ev.ko){ msg(sc, `${nomU(sc, ev.c)} est K.O. !`); await pause(sc, 800); }
        break;
      }
      case 'soin':
        U[ev.u].pv = ev.pv;
        classe(sc, ev.u, 'soin', 700);
        flotter(sc, ev.u, '+' + ev.v, 'soin');
        majTuile(sc, ev.u);
        msg(sc, `${nomU(sc, ev.u)} récupère ${ev.v} PV.`);
        await pause(sc, 800);
        break;
      case 'stat':
        U[ev.u].mods[ev.s] = ev.n;
        majTuile(sc, ev.u);
        flotter(sc, ev.u, LIB[ev.s].slice(0, 3) + ' ' + (ev.v > 0 ? '▲' : '▼'), 'texte');
        msg(sc, `${LIB[ev.s]} de ${nomU(sc, ev.u)} ${ev.v > 0 ? 'augmente' : 'baisse'}${Math.abs(ev.v) > 1 ? ' beaucoup' : ''} !`);
        await pause(sc, 800);
        break;
      case 'stat_max':
        msg(sc, `${LIB[ev.s]} de ${nomU(sc, ev.u)} ne peut pas aller plus loin.`);
        await pause(sc, 600);
        break;
      case 'statut':
        if(ev.s === 'etourdi'){ U[ev.u].statut.etourdi = 1; msg(sc, `${nomU(sc, ev.u)} est étourdi !`); }
        else{ U[ev.u].statut.poison = 3; msg(sc, `${nomU(sc, ev.u)} est empoisonné !`); }
        majTuile(sc, ev.u);
        await pause(sc, 800);
        break;
      case 'immunise':
        msg(sc, `${nomU(sc, ev.u)} garde son sang-froid : rien ne l'atteint.`);
        flotter(sc, ev.u, 'Immunisé', 'texte');
        await pause(sc, 800);
        break;
      case 'etourdi':
        U[ev.u].statut.etourdi = 0;
        majTuile(sc, ev.u);
        msg(sc, `${nomU(sc, ev.u)} est trop étourdi pour agir !`);
        await pause(sc, 800);
        break;
      case 'epuise':
        msg(sc, `${nomU(sc, ev.u)} n'a plus assez d'énergie pour recommencer (${ev.a}).`);
        await pause(sc, 800);
        break;
      case 'capacite': {
        const txt = { epines: `${nomU(sc, ev.u)} renvoie les coups avec sa langue acérée !`, survivant: `${nomU(sc, ev.u)} s'accroche et reste debout avec 1 PV !`, dernier_souffle: `${nomU(sc, ev.u)} lance son dernier couplet !` }[ev.code];
        if(txt){ msg(sc, txt); await pause(sc, 800); }
        break;
      }
      case 'limite':
        msg(sc, 'Le temps est écoulé : le duo qui a le plus de PV l\'emporte.');
        await pause(sc, 1000);
        break;
      default: break;
    }
  }

  function terminer(sc, r){
    sc.fin = true;
    const gagne = r.etat === 'victoire';
    const g = r.gains || {};
    A.Son.jouer(gagne ? 'r4' : 'volte');
    if(gagne) A.vibre([30, 50, 30]);
    msg(sc, gagne ? 'Victoire !' : 'Défaite…');
    const zone = sc.ov.querySelector('[data-cmd]');
    const d = r.trophees_delta;
    zone.innerHTML = `
      <div class="cb-fin ${gagne ? 'victoire' : 'defaite'}">
        <h3>${gagne ? 'Victoire !' : 'Défaite'}</h3>
        <div class="cb-fin-gains">
          ${g.vinyles ? `<span>${A.ico('vinyle', 15)} +${g.vinyles} vinyle${g.vinyles > 1 ? 's' : ''}${g.premiere ? ' · première victoire' : ''}</span>` : ''}
          ${typeof d === 'number' ? `<span>${A.ico('trophee', 15)} ${signe(d)} trophée${Math.abs(d) > 1 ? 's' : ''} · ${nf(r.trophees)}</span>` : ''}
          ${!g.vinyles && typeof d !== 'number' ? `<span>${gagne ? 'Bien joué, aucun gain cette fois (déjà obtenu ou plafond du jour atteint).' : 'Aucune carte perdue : retente ta chance !'}</span>` : ''}
        </div>
        <div class="boutons"><button type="button" class="ct-btn principal grand" data-rejouer>Rejouer</button><button type="button" class="ct-btn grand" data-retour>Retour</button></div>
      </div>`;
    zone.querySelector('[data-retour]').addEventListener('click', () => { fermerScene(); rafraichir(); });
    zone.querySelector('[data-rejouer]').addEventListener('click', async () => {
      const ctx = sc.ctx;
      fermerScene();
      await rafraichir();
      lancer(ctx.mode, ctx.cible);
    });
    A.rafraichirEtat();
  }

  // ---------------------------------------------------------------------
  // La console de l'équipe
  // ---------------------------------------------------------------------

  async function catalogue(force){
    if(!S.cat || force) S.cat = await A.appel('combat_equipe_catalogue');
    return S.cat;
  }

  const OPT = (valeur, texte, sel) => `<option value="${esc(valeur)}"${String(sel) === String(valeur) ? ' selected' : ''}>${esc(texte)}</option>`;

  async function equipe(hote, api){
    init(api);
    const vues = [['cartes', 'Cartes'], ['types', 'Types et affinités'], ['attaques', 'Attaques'], ['capacites', 'Capacités'], ['arene', 'Arène'], ['test', 'Test de combat']];
    let vue = 'cartes';
    hote.innerHTML = `<div class="ct cb" style="padding:0"><nav class="cb-seg" aria-label="Réglages du combat">${vues.map(([id, nom]) => `<button type="button" data-v="${id}" aria-pressed="${id === vue}">${nom}</button>`).join('')}</nav><div data-corps><div class="ct-vide">Chargement…</div></div></div>`;
    const corps = hote.querySelector('[data-corps]');
    const aller = async (v) => {
      vue = v;
      hote.querySelectorAll('.cb-seg [data-v]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === v)));
      corps.innerHTML = '<div class="ct-vide">Chargement…</div>';
      try{
        const cat = await catalogue(true);
        if(v === 'cartes') await eqCartes(corps, cat);
        else if(v === 'types') eqTypes(corps, cat);
        else if(v === 'attaques') eqAttaques(corps, cat);
        else if(v === 'capacites') eqCapacites(corps, cat);
        else if(v === 'arene') eqArene(corps, cat);
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
          <div><h4>${esc(c.nom)} ${chip(e.type_nom, e.couleur)} ${e.surcharge ? '<span class="cb-puce or">Réglé</span>' : ''}</h4>
            <p>PV ${nf(e.pv)} · PUI ${nf(e.pui)} · DÉF ${nf(e.def)} · VIT ${nf(e.vit)} — ${e.attaques.map((a) => esc(a.nom)).join(' / ')} — ${esc(e.capacite.nom)}</p></div>
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
    const attaques = cat.attaques.filter((a) => a.actif || a.id === sur.atk1 || a.id === sur.atk2);
    const optsAtt = (cle, defId) => `<option value="">Par défaut (${esc((cat.attaques.find((a) => a.id === defId) || {}).nom || '—')})</option>` +
      cat.types.concat([{ id: null, nom: 'Neutre' }]).map((t) => {
        const l = attaques.filter((a) => (a.type || null) === t.id);
        return l.length ? `<optgroup label="${esc(t.nom)}">${l.map((a) => OPT(a.id, a.nom + (a.puissance ? ' · ' + a.puissance : ' · soutien'), sur[cle])).join('')}</optgroup>` : '';
      }).join('');
    const M = [1, 1.08, 1.18, 1.3, 1.45];
    const base = e.base;
    hote.innerHTML = `
      <div style="display:flex; align-items:center; gap:14px; padding-right:40px">
        <img class="cb-avatar" style="width:56px; height:56px" src="${esc(A.safeUrl(c.photo))}" alt="">
        <div><h2 style="margin:0">${esc(c.nom)}</h2><p class="sous" style="margin:2px 0 0">${nf(c.fans)} fans · ${c.boosters.map((b) => esc(b.nom) + ' (' + esc(A.rar(b.rarete).nom) + ')').join(', ') || 'dans aucun booster'}</p></div></div>
      <p class="sous" style="margin-top:10px">Laisse un champ vide pour la valeur par défaut. Les stats saisies sont des <b>stats de base</b> : le multiplicateur de rareté du booster et le bonus holo s'y ajoutent.</p>
      <div class="cb-form">
        <label>Type<select class="cb-champ-eq" data-k="type"><option value="">Par défaut (${esc(d.type_nom)})</option>${cat.types.map((t) => OPT(t.id, t.nom, sur.type)).join('')}</select></label>
        ${['pv', 'pui', 'def', 'vit'].map((k) => `<label>${LIB[k]} de base<input class="cb-champ-eq" type="number" min="${k === 'pv' ? 20 : 10}" max="${k === 'pv' ? 400 : 300}" data-k="${k}" value="${sur[k] !== undefined ? sur[k] : ''}" placeholder="${d.base[k]}"><small>Par défaut : ${d.base[k]}</small></label>`).join('')}
        <label>Attaque 1<select class="cb-champ-eq" data-k="atk1">${optsAtt('atk1', d.attaques[0].id)}</select></label>
        <label>Attaque 2<select class="cb-champ-eq" data-k="atk2">${optsAtt('atk2', d.attaques[1].id)}</select></label>
        <label>Capacité<select class="cb-champ-eq" data-k="capacite"><option value="">Par défaut (${esc(d.capacite.nom)})</option>${cat.capacites.map((k) => OPT(k.id, k.nom, sur.capacite)).join('')}</select></label>
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

  function eqAttaques(corps, cat, filtre){
    const f = filtre === undefined ? 'tous' : filtre;
    const liste = cat.attaques.filter((a) => f === 'tous' || (f === 'neutre' ? !a.type : a.type === f));
    corps.innerHTML = `
      <div class="cb-sel-tete"><button type="button" class="ct-btn principal" data-nouv>Nouvelle attaque</button></div>
      <div class="cb-filtres"><button type="button" data-f="tous" aria-pressed="${f === 'tous'}">Toutes</button>${cat.types.map((t) => `<button type="button" data-f="${esc(t.id)}" style="--tc:${couleur(t.couleur)}" aria-pressed="${f === t.id}">${esc(t.nom)}</button>`).join('')}<button type="button" data-f="neutre" aria-pressed="${f === 'neutre'}">Neutres</button></div>
      <div class="cb-liste">${liste.map((a) => `
        <div class="cb-ligne${a.actif ? '' : ' verrou'}" style="--tc:${couleur((cat.types.find((t) => t.id === a.type) || {}).couleur)}">
          <span class="cb-n" style="min-width:56px">${a.puissance || '—'}</span>
          <div><h4>${esc(a.nom)} ${chip((cat.types.find((t) => t.id === a.type) || {}).nom, (cat.types.find((t) => t.id === a.type) || {}).couleur)} ${a.actif ? '' : '<span class="cb-puce">Désactivée</span>'}</h4>
            <p>${esc(ROLES[a.role])} · ${esc(CIBLES[a.cible])} · ${a.justesse} % de précision${a.effet ? ' · ' + esc(EFFETS[a.effet]) + ' ' + a.valeur + (a.chance < 100 ? ' (' + a.chance + ' %)' : '') : ''}<br>${esc(a.description)}</p></div>
          <button type="button" class="ct-btn petit" data-id="${esc(a.id)}">Modifier</button></div>`).join('')}</div>`;
    corps.querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => eqAttaques(corps, cat, b.dataset.f)));
    const edit = (a) => formAttaque(a, cat, async () => { await catalogue(true); eqAttaques(corps, S.cat, f); });
    corps.querySelector('[data-nouv]').addEventListener('click', () => edit(null));
    corps.querySelectorAll('[data-id]').forEach((b) => b.addEventListener('click', () => edit(cat.attaques.find((a) => a.id === b.dataset.id))));
  }

  function formAttaque(a, cat, apres){
    const nouv = !a;
    a = a || { id: '', nom: '', type: null, role: 'base', puissance: 50, justesse: 95, effet: null, valeur: 0, chance: 100, cible: 'ennemi', description: '', actif: true };
    const f = A.fenetre(`
      <h2>${nouv ? 'Nouvelle attaque' : esc(a.nom)}</h2>
      <div class="cb-form">
        <label>Identifiant<input class="cb-champ-eq" data-k="id" value="${esc(a.id)}" ${nouv ? '' : 'readonly'} placeholder="ex. trap-808"><small>Minuscules, chiffres et tirets.</small></label>
        <label>Nom<input class="cb-champ-eq" data-k="nom" value="${esc(a.nom)}"></label>
        <label>Style<select class="cb-champ-eq" data-k="type"><option value="">Neutre (sans style)</option>${cat.types.map((t) => OPT(t.id, t.nom, a.type)).join('')}</select></label>
        <label>Rôle<select class="cb-champ-eq" data-k="role">${Object.keys(ROLES).map((k) => OPT(k, ROLES[k], a.role)).join('')}</select><small>Sert au choix des attaques par défaut.</small></label>
        <label>Puissance (0 = soutien)<input class="cb-champ-eq" type="number" min="0" max="200" data-k="puissance" value="${a.puissance}"></label>
        <label>Précision (%)<input class="cb-champ-eq" type="number" min="1" max="100" data-k="justesse" value="${a.justesse}"></label>
        <label>Cible<select class="cb-champ-eq" data-k="cible">${Object.keys(CIBLES).map((k) => OPT(k, CIBLES[k], a.cible)).join('')}</select></label>
        <label>Effet<select class="cb-champ-eq" data-k="effet"><option value="">Aucun</option>${Object.keys(EFFETS).map((k) => OPT(k, EFFETS[k], a.effet)).join('')}</select></label>
        <label>Valeur de l'effet<input class="cb-champ-eq" type="number" min="0" max="100" data-k="valeur" value="${a.valeur}"><small>% (soin, poison, vol de PV, recul) ou niveaux de stat.</small></label>
        <label>Chance de l'effet (%)<input class="cb-champ-eq" type="number" min="0" max="100" data-k="chance" value="${a.chance}"></label>
        <label class="large">Description<input class="cb-champ-eq" data-k="description" value="${esc(a.description)}"></label>
        <label><span>Active</span><select class="cb-champ-eq" data-k="actif">${OPT('true', 'Oui', String(a.actif))}${OPT('false', 'Non (n\'est plus tirée par défaut)', String(a.actif))}</select></label>
      </div>
      <div class="ct-actions" style="justify-content:flex-end; margin-top:18px"><button type="button" class="ct-btn" data-non>Annuler</button><button type="button" class="ct-btn principal" data-ok>Enregistrer</button></div>`, true);
    f.corps.querySelector('[data-non]').addEventListener('click', f.fermer);
    const ok = f.corps.querySelector('[data-ok]');
    ok.addEventListener('click', async () => {
      const p = {};
      f.corps.querySelectorAll('[data-k]').forEach((x) => { p[x.dataset.k] = x.value; });
      ['puissance', 'justesse', 'valeur', 'chance'].forEach((k) => { p[k] = Number(p[k]); });
      p.actif = p.actif === 'true';
      ok.disabled = true;
      try{ await A.appel('combat_equipe_attaque_sauver', { p }); A.toast('Attaque enregistrée.'); f.fermer(); await apres(); }
      catch(e){ A.toast(e.message, 'err'); ok.disabled = false; }
    });
  }

  function eqCapacites(corps, cat){
    corps.innerHTML = `
      <div class="cb-sel-tete"><button type="button" class="ct-btn principal" data-nouv>Nouvelle capacité</button></div>
      <div class="cb-liste">${cat.capacites.map((c) => `
        <div class="cb-ligne"><span class="cb-n" style="min-width:56px">${c.valeur || '—'}</span>
          <div><h4>${esc(c.nom)}</h4><p>${esc(CODES[c.code] || c.code)}<br>${esc(c.description)}</p></div>
          <button type="button" class="ct-btn petit" data-id="${esc(c.id)}">Modifier</button></div>`).join('')}</div>`;
    const edit = (c) => {
      const nouv = !c;
      c = c || { id: '', nom: '', code: 'regeneration', valeur: 5, description: '' };
      const f = A.fenetre(`
        <h2>${nouv ? 'Nouvelle capacité' : esc(c.nom)}</h2>
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
        try{ await A.appel('combat_equipe_capacite_sauver', { p }); A.toast('Capacité enregistrée.'); f.fermer(); await catalogue(true); eqCapacites(corps, S.cat); }
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

  // Le test : deux duos choisis, jouels par l'ordinateur ; un combat détaillé, ou 20 combats pour juger l'équilibre.
  function texteEvenement(U, ev){
    const n = (i) => U[i] ? U[i].nom : '?';
    switch(ev.t){
      case 'usage': return `${n(ev.u)} utilise ${ev.a}.`;
      case 'rate': return `… raté sur ${n(ev.c)}.`;
      case 'degats': return `${n(ev.c)} perd ${ev.d} PV (${ev.pv} restants)${ev.crit ? ', coup critique' : ev.m > 1 ? ', super efficace' : ev.m < 1 ? ', peu efficace' : ''}${ev.ko ? ' — K.O. !' : ''}`;
      case 'soin': return `${n(ev.u)} récupère ${ev.v} PV.`;
      case 'stat': return `${LIB[ev.s]} de ${n(ev.u)} ${ev.v > 0 ? 'monte' : 'baisse'} (niveau ${ev.n}).`;
      case 'statut': return `${n(ev.u)} est ${ev.s === 'etourdi' ? 'étourdi' : 'empoisonné'}.`;
      case 'etourdi': return `${n(ev.u)} ne peut pas agir.`;
      case 'immunise': return `${n(ev.u)} est immunisé.`;
      case 'epuise': return `${n(ev.u)} ne peut plus se soigner.`;
      case 'capacite': return `Capacité de ${n(ev.u)} : ${ev.code}.`;
      case 'limite': return 'Limite de tours atteinte.';
      default: return '';
    }
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
        res.innerHTML = `<div class="ct-panneau"><h3>${r.vainqueur === 0 ? 'Le camp A l\'emporte' : 'Le camp B l\'emporte'} en ${r.tours.length} tour${r.tours.length > 1 ? 's' : ''}</h3>
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
          n++; tours += r.tours.length; if(r.vainqueur === 0) a++;
        }
        res.innerHTML = `<div class="ct-panneau"><h3>Camp A : ${a} victoire${a > 1 ? 's' : ''} sur ${n}</h3><p class="sous">Camp B : ${n - a} · durée moyenne ${(tours / n).toFixed(1).replace('.', ',')} tours. Autour de 10 sur 20, le duel est équilibré.</p></div>`;
      }catch(e){ res.innerHTML = `<div class="ct-panneau ct-vide">${esc(e.message)}</div>`; }
      bouton(null, false);
    });
  }

  window.WaveCombat = { monter, quitter, fiche, equipe, equipeCarte };

})();
