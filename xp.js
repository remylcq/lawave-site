/* =====================================================================
   La Wave — l'XP, côté navigateur

   Le moteur vit dans la base (sql/xp-refonte.sql) : niveaux, série de jours, quêtes du jour, coffre, objectif
   de la semaine, succès, classement. Ce fichier ne calcule rien d'important : il LIT l'état (xp_moi), ANNONCE ce
   qui est arrivé (xp_evenements_lire) et le DESSINE :

     le bouton rond et son panneau   les quêtes du jour, la série, la semaine, le classement
     les annonces                    un « +N XP » regroupé, les quêtes, les paliers, les niveaux, les succès
     la fiche du profil              niveau, titre, barre, série, échelle des titres
     les succès                      des familles à rangs bronze → platine, une barre de progression chacune

   Chargé à la demande (chargerXp dans index.html). Si le SQL n'est pas encore passé, tout se tait : le bouton
   reste caché et le profil garde son niveau calculé sur place.
   ===================================================================== */

(function(){

  'use strict';

  const esc = (t) => escapeHtml(t);
  const attr = (t) => escapeAttribute(t);
  const nf = (n) => Number(n || 0).toLocaleString('fr-FR');

  let etat = null;            // ce que rend xp_moi
  let succes = null;          // ce que rend xp_succes_liste (les siens)
  let classement = null;      // ce que rend xp_classement
  let indispo = false;        // le SQL n'est pas passé
  let demarreePour = null;    // le membre pour lequel on a démarré
  let vue = 'jour';           // 'jour' | 'classement'
  let periode = 'semaine';    // 'semaine' | 'total'
  let filtre = 'Tous';        // catégorie des succès
  let minuteur = null;
  let lecture = null;
  let sonde = null;
  const vues = new Set();     // gestes de découverte déjà envoyés dans cette session

  // ---------------------------------------------------------------------
  // La feuille de style, posée une fois
  // ---------------------------------------------------------------------

  const FEUILLE = `
  :root{
    --xp-or:#f5b301; --xp-feu:#ff8a3d; --xp-ok:#8fe3ab;
    --xp-bronze:#d28c55; --xp-argent:#cfd6df; --xp-orr:#f5c542; --xp-platine:#8fe3ff;
  }

  /* ---- Le bouton rond : une pastille de série, un anneau de quêtes ---- */
  .defis-serie{
    position:absolute; top:-7px; left:-7px; padding:1px 6px; border-radius:var(--radius-pill);
    background:rgba(8,10,14,.94); border:1px solid rgba(255,138,61,.55); color:var(--xp-feu);
    font-size:10px; font-weight:700; line-height:1.5; font-variant-numeric:tabular-nums; white-space:nowrap;
    pointer-events:none;
  }
  .defis-serie[hidden]{display:none;}
  .defis-bouton.xp-pulse{animation:xpPulse 1.1s ease 2;}
  @keyframes xpPulse{0%,100%{transform:scale(1);}40%{transform:scale(1.14);}}

  /* ---- Le panneau ---- */
  #defisPanneau.defis-panneau{
    width:min(372px, calc(100vw - 40px)); max-height:min(600px, 80vh); padding:0; overflow-y:auto; overflow-x:hidden;
    scrollbar-width:thin;
  }
  .xp-p-tete{padding:16px 16px 12px; border-bottom:1px solid var(--line);}
  .xp-niv{display:flex; align-items:center; gap:12px;}
  .xp-niv-num{
    width:46px; height:46px; flex-shrink:0; border-radius:50%; display:grid; place-items:center;
    font-size:19px; font-weight:700; color:#0b0d11;
    background:linear-gradient(145deg,var(--xp-or),#ff9d3d); box-shadow:0 0 0 3px rgba(245,179,1,.18);
  }
  .xp-niv b{display:block; font-size:15px; color:var(--ink);}
  .xp-niv small{display:block; color:var(--muted); font-size:12px; margin-top:2px; font-variant-numeric:tabular-nums;}
  .xp-bar{height:8px; margin-top:12px; border-radius:99px; background:rgba(255,255,255,.08); overflow:hidden;}
  .xp-bar > span{
    display:block; height:100%; border-radius:99px; width:0;
    background:linear-gradient(90deg,var(--xp-or),#ff9d3d); transition:width .8s cubic-bezier(.2,.8,.3,1);
  }
  .xp-bar.big{height:12px;}
  .xp-p-serie{
    display:flex; flex-wrap:wrap; gap:6px 10px; align-items:center; margin-top:12px;
    font-size:12px; color:var(--ink-soft);
  }
  .xp-puce{
    display:inline-flex; align-items:center; gap:5px; padding:4px 9px; border-radius:99px;
    background:rgba(255,255,255,.06); border:1px solid var(--line); font-size:12px; color:var(--ink-soft);
    white-space:nowrap;
  }
  .xp-puce.feu{border-color:rgba(255,138,61,.5); color:var(--xp-feu);}
  .xp-puce.danger{border-color:rgba(229,105,92,.6); color:#f0867b;}
  .xp-onglets{display:flex; gap:4px; padding:10px 12px 0;}
  .xp-onglet{
    flex:1; padding:8px 10px; border-radius:12px 12px 0 0; font-size:13px; color:var(--muted);
    background:transparent; border:0; border-bottom:2px solid transparent; cursor:pointer;
  }
  .xp-onglet.actif{color:var(--ink); border-bottom-color:var(--blue-bright);}
  .xp-corps{padding:12px 16px 16px;}
  .xp-titre-bloc{
    margin:14px 0 8px; font-size:11px; letter-spacing:.14em; text-transform:uppercase; color:var(--muted);
    display:flex; justify-content:space-between; align-items:baseline;
  }
  .xp-titre-bloc:first-child{margin-top:2px;}

  /* ---- Quêtes ---- */
  .xp-quete{
    display:grid; grid-template-columns:28px 1fr auto; gap:10px; align-items:center;
    padding:10px 12px; margin-bottom:6px; border-radius:14px; background:rgba(255,255,255,.04);
    border:1px solid var(--line); transition:border-color .3s, background .3s;
  }
  .xp-quete.faite{border-color:rgba(143,227,171,.45); background:rgba(143,227,171,.07);}
  .xp-quete .ic{font-size:19px; text-align:center;}
  .xp-quete .tx{min-width:0; font-size:13px; color:var(--ink); line-height:1.3;}
  .xp-quete.faite .tx{color:var(--ink-soft);}
  .xp-quete .mini{height:5px; margin-top:7px; border-radius:99px; background:rgba(255,255,255,.08); overflow:hidden;}
  .xp-quete .mini span{display:block; height:100%; background:var(--blue-bright); border-radius:99px; transition:width .6s;}
  .xp-quete.faite .mini span{background:var(--xp-ok);}
  .xp-quete .gain{font-size:12px; font-weight:700; color:var(--xp-or); white-space:nowrap;}
  .xp-quete.faite .gain{color:var(--xp-ok);}
  .xp-coffre{
    display:flex; align-items:center; gap:12px; padding:12px; border-radius:14px; margin-top:4px;
    border:1px dashed rgba(245,179,1,.45); background:rgba(245,179,1,.06); font-size:13px; color:var(--ink-soft);
  }
  .xp-coffre .ic{font-size:26px; filter:grayscale(.85) opacity(.7);}
  .xp-coffre.ouvert{border-style:solid; color:var(--ink);}
  .xp-coffre.ouvert .ic{filter:none; animation:xpSecoue .8s ease 1;}
  .xp-coffre b{color:var(--xp-or);}
  @keyframes xpSecoue{0%,100%{transform:rotate(0);}20%{transform:rotate(-14deg);}40%{transform:rotate(12deg);}60%{transform:rotate(-8deg);}80%{transform:rotate(5deg);}}

  /* ---- La semaine : une barre, trois paliers ---- */
  .xp-semaine{position:relative; margin:22px 4px 26px;}
  .xp-semaine .piste{height:8px; border-radius:99px; background:rgba(255,255,255,.08); overflow:hidden;}
  .xp-semaine .piste span{display:block; height:100%; border-radius:99px; background:linear-gradient(90deg,var(--blue-bright),var(--xp-or));}
  .xp-borne{
    position:absolute; top:-4px; width:16px; height:16px; margin-left:-8px; border-radius:50%;
    background:#10141a; border:2px solid rgba(255,255,255,.28); display:grid; place-items:center;
    font-size:9px; color:#0b0d11;
  }
  .xp-borne.ok{background:var(--xp-or); border-color:var(--xp-or);}
  .xp-borne em{
    position:absolute; top:20px; left:50%; transform:translateX(-50%); font-style:normal; font-size:10px;
    color:var(--muted); white-space:nowrap; font-variant-numeric:tabular-nums;
  }
  .xp-borne:last-child em{left:auto; right:-4px; transform:none;}
  .xp-semaine-infos{display:flex; justify-content:space-between; font-size:12px; color:var(--muted); margin-top:30px;}
  .xp-semaine-infos b{color:var(--ink);}

  /* ---- Prochains succès ---- */
  .xp-proche{display:grid; grid-template-columns:28px 1fr auto; gap:10px; align-items:center; padding:7px 0; font-size:13px;}
  .xp-proche .ic{font-size:19px; text-align:center;}
  .xp-proche .nom{color:var(--ink);}
  .xp-proche .mini{height:4px; margin-top:6px; border-radius:99px; background:rgba(255,255,255,.08); overflow:hidden;}
  .xp-proche .mini span{display:block; height:100%; border-radius:99px; background:var(--xp-or);}
  .xp-proche .val{font-size:11px; color:var(--muted); font-variant-numeric:tabular-nums;}
  .xp-lien{
    display:block; width:100%; margin-top:10px; padding:10px; border-radius:12px; font-size:13px; cursor:pointer;
    background:rgba(255,255,255,.06); border:1px solid var(--line); color:var(--ink);
  }
  .xp-lien:hover{background:rgba(255,255,255,.1);}

  /* ---- Classement ---- */
  .xp-bascule{display:flex; gap:6px; margin-bottom:10px;}
  .xp-bascule button{
    flex:1; padding:7px; border-radius:99px; font-size:12px; cursor:pointer;
    background:transparent; border:1px solid var(--line); color:var(--muted);
  }
  .xp-bascule button.actif{background:rgba(79,180,255,.14); border-color:rgba(79,180,255,.5); color:var(--ink);}
  .xp-rang{
    display:grid; grid-template-columns:26px 32px 1fr auto; gap:10px; align-items:center; width:100%;
    padding:8px 10px; margin-bottom:4px; border-radius:12px; text-align:left; cursor:pointer;
    background:rgba(255,255,255,.035); border:1px solid transparent; color:var(--ink);
  }
  .xp-rang:hover{background:rgba(255,255,255,.07);}
  .xp-rang.moi{border-color:rgba(79,180,255,.5); background:rgba(79,180,255,.09);}
  .xp-rang .n{font-weight:700; font-size:13px; color:var(--muted); text-align:center; font-variant-numeric:tabular-nums;}
  .xp-rang:nth-child(1) .n{color:var(--xp-orr);} .xp-rang:nth-child(2) .n{color:var(--xp-argent);} .xp-rang:nth-child(3) .n{color:var(--xp-bronze);}
  .xp-rang .av{width:32px; height:32px; border-radius:50%; background:rgba(255,255,255,.1) center/cover; display:grid; place-items:center; font-size:13px; color:var(--ink-soft);}
  .xp-rang .nm{font-size:13px; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
  .xp-rang .nm small{display:block; color:var(--muted); font-size:11px;}
  .xp-rang .pts{font-size:12px; font-weight:700; color:var(--xp-or); font-variant-numeric:tabular-nums;}
  .xp-vide{padding:18px 6px; text-align:center; font-size:13px; color:var(--muted);}

  /* ---- Annonces ---- */
  .notif.xp-rang-bronze{border-color:rgba(210,140,85,.6);} .notif.xp-rang-argent{border-color:rgba(207,214,223,.65);}
  .notif.xp-rang-or{border-color:rgba(245,197,66,.8);} .notif.xp-rang-platine{border-color:rgba(143,227,255,.85);}
  .notif.xp-feu{border-color:rgba(255,138,61,.6);} .notif.xp-feu .notif-titre{color:var(--xp-feu);}

  .xp-celebre{
    position:fixed; inset:0; z-index:450; display:grid; place-items:center; padding:20px;
    background:rgba(3,5,8,.72); backdrop-filter:blur(10px); -webkit-backdrop-filter:blur(10px);
    animation:xpFond .25s ease; cursor:pointer;
  }
  .xp-celebre.sortie{animation:xpFondSort .28s ease forwards;}
  @keyframes xpFond{from{opacity:0;}to{opacity:1;}}
  @keyframes xpFondSort{to{opacity:0;}}
  .xp-carte{
    position:relative; width:min(380px, 100%); padding:34px 26px 24px; text-align:center; overflow:hidden;
    border-radius:var(--radius); background:linear-gradient(180deg,rgba(24,30,40,.97),rgba(10,13,18,.98));
    border:1px solid rgba(245,179,1,.5); box-shadow:0 0 0 1px rgba(255,255,255,.04), 0 30px 90px rgba(0,0,0,.6), 0 0 80px rgba(245,179,1,.18);
    animation:xpCarte .55s cubic-bezier(.2,1.2,.3,1);
  }
  @keyframes xpCarte{from{opacity:0; transform:translateY(24px) scale(.88);}to{opacity:1; transform:none;}}
  .xp-carte.rang-platine{border-color:rgba(143,227,255,.7); box-shadow:0 30px 90px rgba(0,0,0,.6), 0 0 80px rgba(143,227,255,.22);}
  .xp-carte .halo{
    position:absolute; left:50%; top:-60px; width:300px; height:300px; margin-left:-150px; border-radius:50%;
    background:radial-gradient(circle,rgba(245,179,1,.3),transparent 65%); animation:xpTourne 6s linear infinite; pointer-events:none;
  }
  @keyframes xpTourne{to{transform:rotate(360deg) scale(1.1);}}
  .xp-carte .gros{
    position:relative; width:104px; height:104px; margin:0 auto 14px; border-radius:50%; display:grid; place-items:center;
    font-size:52px; font-weight:800; color:#0b0d11; line-height:1;
    background:linear-gradient(145deg,#ffd54a,#ff9d3d); box-shadow:0 0 0 6px rgba(245,179,1,.2), 0 10px 40px rgba(245,179,1,.35);
    animation:xpRebond .8s .15s cubic-bezier(.2,1.5,.4,1) both;
  }
  .xp-carte .gros.emoji{background:rgba(255,255,255,.07); box-shadow:0 0 0 6px rgba(255,255,255,.06); color:inherit;}
  @keyframes xpRebond{from{transform:scale(.2) rotate(-25deg); opacity:0;}to{transform:none; opacity:1;}}
  .xp-carte .eyebrow{position:relative; font-size:11px; letter-spacing:.22em; text-transform:uppercase; color:var(--xp-or); margin:0 0 6px;}
  .xp-carte h2{position:relative; font-size:26px; margin:0 0 6px; color:var(--ink); line-height:1.15;}
  .xp-carte p{position:relative; margin:0; font-size:14px; color:var(--ink-soft); line-height:1.45;}
  .xp-carte .recompenses{position:relative; display:flex; gap:8px; justify-content:center; flex-wrap:wrap; margin-top:16px;}
  .xp-carte .bouton{
    position:relative; margin-top:22px; padding:11px 26px; border-radius:99px; border:0; cursor:pointer;
    background:var(--ink); color:#0b0d11; font-weight:600; font-size:14px;
  }
  .xp-conf{position:absolute; top:-12px; width:8px; height:14px; border-radius:2px; opacity:0; animation:xpConf 2.4s ease-out forwards; pointer-events:none;}
  @keyframes xpConf{
    0%{opacity:1; transform:translate(0,0) rotate(0);}
    100%{opacity:0; transform:translate(var(--dx),420px) rotate(var(--r));}
  }

  /* ---- La fiche du profil ---- */
  .xp-fiche{display:grid; grid-template-columns:auto 1fr; gap:20px; align-items:center;}
  .xp-medaillon{position:relative; width:104px; height:104px;}
  .xp-medaillon svg{width:100%; height:100%; transform:rotate(-90deg);}
  .xp-medaillon circle{fill:none; stroke-width:7;}
  .xp-medaillon .fond{stroke:rgba(255,255,255,.1);}
  .xp-medaillon .jauge{stroke:url(#xpDegrade); stroke-linecap:round; stroke-dasharray:100; stroke-dashoffset:100; transition:stroke-dashoffset 1.1s cubic-bezier(.2,.8,.3,1);}
  .xp-medaillon b{position:absolute; inset:0; display:grid; place-items:center; font-size:34px; color:var(--ink);}
  .xp-medaillon small{position:absolute; left:0; right:0; bottom:20px; text-align:center; font-size:9px; letter-spacing:.2em; color:var(--muted); text-transform:uppercase;}
  .xp-fiche-titre{display:flex; align-items:baseline; gap:10px; flex-wrap:wrap;}
  .xp-fiche-titre strong{font-size:22px; color:var(--ink);}
  .xp-fiche-titre span{color:var(--muted); font-size:13px;}
  .xp-fiche-sous{margin-top:9px; font-size:13px; color:var(--ink-soft); font-variant-numeric:tabular-nums;}
  .xp-fiche .xp-p-serie{margin-top:12px;}
  .xp-echelle{display:flex; gap:6px; flex-wrap:wrap; margin-top:18px;}
  .xp-echelle .rang{
    padding:5px 10px; border-radius:99px; font-size:12px; border:1px solid var(--line); color:var(--muted);
    background:rgba(255,255,255,.03);
  }
  .xp-echelle .rang.acquis{color:var(--ink-soft); border-color:rgba(255,255,255,.22);}
  .xp-echelle .rang.actuel{color:#0b0d11; background:linear-gradient(145deg,#ffd54a,#ff9d3d); border-color:transparent; font-weight:700;}
  .xp-echelle .rang small{opacity:.7; margin-left:4px;}

  /* ---- Les succès ---- */
  .xp-succes-tete{display:flex; align-items:center; gap:18px; flex-wrap:wrap; margin:6px 0 16px;}
  .xp-succes-tete h3{margin:0; font-size:18px; color:var(--ink);}
  .xp-succes-tete .sous{font-size:13px; color:var(--muted); margin-top:3px;}
  .xp-succes-total{margin-left:auto; text-align:right; font-size:13px; color:var(--ink-soft);}
  .xp-succes-total b{display:block; font-size:24px; color:var(--xp-or); line-height:1.1;}
  .xp-recents{display:flex; gap:10px; overflow-x:auto; padding-bottom:6px; margin-bottom:6px;}
  .xp-recent{
    flex:0 0 auto; display:flex; align-items:center; gap:9px; padding:8px 14px 8px 10px; border-radius:99px;
    background:rgba(245,179,1,.08); border:1px solid rgba(245,179,1,.35); font-size:13px; color:var(--ink);
  }
  .xp-recent .ic{font-size:20px;}
  .xp-filtres{display:flex; gap:6px; flex-wrap:wrap; margin:14px 0;}
  .xp-filtre{
    padding:7px 13px; border-radius:99px; font-size:12px; cursor:pointer;
    background:transparent; border:1px solid var(--line); color:var(--muted);
  }
  .xp-filtre.actif{background:rgba(255,255,255,.1); color:var(--ink); border-color:rgba(255,255,255,.3);}
  .xp-grille{display:grid; grid-template-columns:repeat(auto-fill,minmax(250px,1fr)); gap:12px;}
  .xp-fam{
    position:relative; padding:16px; border-radius:18px; background:rgba(255,255,255,.04); border:1px solid var(--line);
    display:flex; flex-direction:column; gap:8px; transition:transform .25s var(--ease), border-color .25s;
  }
  .xp-fam:hover{transform:translateY(-2px); border-color:rgba(255,255,255,.26);}
  .xp-fam .haut{display:flex; gap:12px; align-items:center;}
  .xp-fam .ic{
    width:48px; height:48px; flex-shrink:0; border-radius:14px; display:grid; place-items:center; font-size:25px;
    background:rgba(255,255,255,.07);
  }
  .xp-fam .nom{font-size:15px; font-weight:600; color:var(--ink); line-height:1.2;}
  .xp-fam .cat{font-size:11px; letter-spacing:.12em; text-transform:uppercase; color:var(--muted);}
  .xp-fam .desc{font-size:13px; color:var(--ink-soft); line-height:1.4; min-height:2.8em;}
  .xp-fam .barre{height:7px; border-radius:99px; background:rgba(255,255,255,.08); overflow:hidden;}
  .xp-fam .barre span{display:block; height:100%; border-radius:99px; background:var(--blue-bright); transition:width .9s cubic-bezier(.2,.8,.3,1);}
  .xp-fam .bas{display:flex; justify-content:space-between; align-items:center; font-size:12px; color:var(--muted); font-variant-numeric:tabular-nums;}
  .xp-fam .bas b{color:var(--xp-or);}
  .xp-fam.complet{border-color:rgba(245,179,1,.55); background:linear-gradient(180deg,rgba(245,179,1,.1),rgba(255,255,255,.03));}
  .xp-fam.complet .ic{background:rgba(245,179,1,.18);}
  .xp-fam.complet .barre span{background:var(--xp-or);}
  .xp-fam.secret:not(.complet){border-style:dashed;}
  .xp-fam.secret:not(.complet) .ic{filter:grayscale(1);}
  .xp-fam.vide{opacity:.78;}
  .xp-pips{display:flex; gap:5px;}
  .xp-pip{width:11px; height:11px; border-radius:50%; border:2px solid rgba(255,255,255,.2); background:transparent;}
  .xp-pip.on.bronze{background:var(--xp-bronze); border-color:var(--xp-bronze);}
  .xp-pip.on.argent{background:var(--xp-argent); border-color:var(--xp-argent);}
  .xp-pip.on.or{background:var(--xp-orr); border-color:var(--xp-orr);}
  .xp-pip.on.platine{background:var(--xp-platine); border-color:var(--xp-platine); box-shadow:0 0 8px rgba(143,227,255,.6);}
  .xp-rang-pastille{
    font-size:10px; letter-spacing:.1em; text-transform:uppercase; padding:2px 8px; border-radius:99px; border:1px solid currentColor;
  }
  .xp-rang-pastille.bronze{color:var(--xp-bronze);} .xp-rang-pastille.argent{color:var(--xp-argent);}
  .xp-rang-pastille.or{color:var(--xp-orr);} .xp-rang-pastille.platine{color:var(--xp-platine);}

  @media (max-width:560px){
    .xp-fiche{grid-template-columns:1fr; justify-items:center; text-align:center;}
    .xp-fiche-titre{justify-content:center;}
    .xp-fiche .xp-p-serie, .xp-echelle{justify-content:center;}
    .xp-succes-total{margin-left:0; text-align:left;}
    .xp-grille{grid-template-columns:1fr;}
  }
  @media (prefers-reduced-motion:reduce){
    .xp-carte, .xp-carte .gros, .xp-carte .halo, .xp-celebre, .defis-bouton.xp-pulse, .xp-coffre.ouvert .ic{animation:none;}
    .xp-conf{display:none;}
  }
  `;

  function poserFeuille(){
    if(document.getElementById('xpFeuille')) return;
    const s = document.createElement('style');
    s.id = 'xpFeuille';
    s.textContent = FEUILLE;
    document.head.appendChild(s);
  }

  // ---------------------------------------------------------------------
  // Les appels au serveur
  // ---------------------------------------------------------------------

  async function lireEtat(){

    const { data, error } = await BD.xpMoi();

    if(error || !data){

      const absent = error && (error.code === 'PGRST202' || error.code === '42883'
        || /could not find the function|does not exist/i.test(error.message || ''));

      if(absent){
        // Les fonctions n'existent pas encore (SQL pas passé) : on se tait.
        indispo = true;
        majFlottant();
      }else{
        // Une panne passagère : le prochain passage réessaiera.
        demarreePour = null;
      }

      return null;
    }

    indispo = false;
    etat = data;
    if(currentUser) currentUser.xp = data.xp;
    return data;
  }

  async function lireSucces(){

    const { data, error } = await BD.xpSuccesListe(null);
    if(error || !data) return null;
    succes = data;
    return data;
  }

  // ---------------------------------------------------------------------
  // Le démarrage, l'actualisation, la veille
  // ---------------------------------------------------------------------

  async function demarrer(){

    if(!currentUser || indispo) return;
    if(demarreePour === currentUser.id) return;

    poserFeuille();
    demarreePour = currentUser.id;

    if(!await lireEtat()) return;

    dessiner();
    majProfil();

    // Laisse la page s'afficher avant les annonces.
    setTimeout(() => lireEvenements(), 1400);

    clearInterval(sonde);
    sonde = setInterval(() => { if(!document.hidden && currentUser) lireEvenements(); }, 60000);
  }

  function reinitialiser(){
    demarreePour = null;
    etat = succes = classement = null;
    indispo = false;
    vue = 'jour';
    vues.clear();
    clearInterval(sonde);
    clearTimeout(minuteur);
  }

  // Après un geste du membre : on relit les annonces dès que le serveur a fini.
  function apres(delai){

    if(!currentUser || indispo) return;
    if(!demarreePour) { demarrer(); return; }

    clearTimeout(minuteur);
    minuteur = setTimeout(() => lireEvenements(), delai === undefined ? 500 : delai);
  }

  // Un geste de découverte que seul le navigateur voit (fiche d'artiste, de sortie, de membre).
  async function action(nom, ref){

    if(!currentUser || indispo || !ref) return;

    const cle = nom + ':' + ref;
    if(vues.has(cle)) return;
    vues.add(cle);

    try{
      await BD.xpAction(nom, String(ref));
    }catch(erreur){
      return;
    }

    apres(700);
  }

  async function lireEvenements(profondeur){

    if(lecture) return lecture;
    if(!currentUser || indispo) return;

    lecture = (async () => {

      try{
        const { data, error } = await BD.xpEvenements();
        if(error || !Array.isArray(data) || !data.length) return;

        // L'état d'abord : les barres sont à jour quand les annonces arrivent.
        await lireEtat();
        dessiner();
        majProfil();

        pousser(data);

      }catch(erreur){
        // Une annonce manquée n'est pas grave.
      }finally{
        lecture = null;
      }
    })();

    return lecture;
  }

  // ---------------------------------------------------------------------
  // Les annonces
  // ---------------------------------------------------------------------

  const file = [];
  let enCours = false;

  const pause = (ms) => new Promise(r => setTimeout(r, ms));

  function pousser(evenements){

    const gains = evenements.filter(e => e.type === 'gain');
    const reste = evenements.filter(e => e.type !== 'gain');

    if(gains.length){
      const total = gains.reduce((s, e) => s + (e.donnees.xp || 0), 0);
      const libelles = [];
      gains.forEach(e => { if(!libelles.includes(e.donnees.libelle)) libelles.push(e.donnees.libelle); });
      const mult = Math.max(...gains.map(e => Number(e.donnees.multiplicateur) || 1));

      let detail = libelles.slice(0, 2).join(' · ') + (libelles.length > 2 ? ' · …' : '');
      if(mult > 1) detail += ' — série ×' + String(mult).replace('.', ',');

      file.push({ sorte: 'toast', titre: '+' + total + ' XP', options: {
        type: 'xp', icone: gains.length === 1 ? (gains[0].donnees.icone || '⚡') : '⚡', detail, duree: 3800
      }});
    }

    reste.forEach(e => {

      const d = e.donnees || {};

      if(e.type === 'quete'){
        file.push({ sorte: 'toast', titre: 'Quête accomplie · +' + d.xp + ' XP', options: {
          type: 'succes', icone: d.icone || '🎯', detail: d.libelle, duree: 4800 }});
      }
      else if(e.type === 'coffre'){
        file.push({ sorte: 'celebre', icone: '🎁', eyebrow: 'Coffre du jour', titre: '+' + d.xp + ' XP',
          texte: 'Les trois quêtes du jour sont faites : le coffre s’ouvre.', confettis: true });
      }
      else if(e.type === 'semaine'){
        file.push({ sorte: 'toast', titre: 'Objectif de la semaine · palier ' + d.palier, options: {
          type: 'xp', icone: '🏆', detail: d.objectif + ' XP atteints cette semaine : +' + d.xp + ' XP de bonus.', duree: 5500 }});
      }
      else if(e.type === 'serie'){
        file.push({ sorte: 'toast', titre: 'Série de ' + d.serie + ' jours · +' + d.xp + ' XP', options: {
          type: 'xp', icone: '🔥', detail: d.gel ? 'Et un gel de série gagné : il sauvera un jour manqué.' : 'Reviens demain pour la prolonger.',
          duree: 5500 }});
      }
      else if(e.type === 'gel_utilise'){
        file.push({ sorte: 'toast', titre: 'Gel de série utilisé', options: {
          type: 'info', icone: '❄️', detail: 'Ta série de ' + d.serie + ' jours est sauvée. Il t’en reste ' + d.gels + '.', duree: 6000 }});
      }
      else if(e.type === 'serie_perdue'){
        file.push({ sorte: 'toast', titre: 'Série interrompue', options: {
          type: 'info', icone: '💤', detail: d.serie + ' jours, c’était beau. On repart d’aujourd’hui.', duree: 5500 }});
      }
      else if(e.type === 'succes'){
        const grand = d.rang === 'or' || d.rang === 'platine' || d.secret;
        if(grand){
          file.push({ sorte: 'celebre', icone: d.icone, eyebrow: d.secret ? 'Succès secret' : 'Succès ' + d.rang,
            titre: d.nom, texte: d.description, recompenses: ['+' + d.xp + ' XP'], rang: d.rang, confettis: true });
        }else{
          file.push({ sorte: 'toast', titre: 'Succès : ' + d.nom, rang: d.rang, options: {
            type: 'succes', icone: d.icone, detail: d.description + ' · +' + d.xp + ' XP', duree: 5500 }});
        }
      }
      else if(e.type === 'niveau'){
        const recompenses = [];
        if(d.nouveau_titre) recompenses.push('Nouveau titre');
        if(d.gels > 0) recompenses.push('❄️ +' + d.gels + ' gel de série');
        file.push({ sorte: 'celebre', gros: String(d.niveau), eyebrow: 'Niveau supérieur', titre: d.titre,
          texte: d.nouveau_titre ? 'Tu passes ' + d.titre + '. Le prochain titre se mérite encore.' : 'Niveau ' + d.niveau + ' atteint.',
          recompenses, confettis: true, prioritaire: true });
      }
    });

    // Les montées de niveau passent avant le reste : c'est l'événement.
    file.sort((a, b) => (b.prioritaire ? 1 : 0) - (a.prioritaire ? 1 : 0));

    // Le bouton rond rebondit : l'XP vient de bouger.
    const bouton = document.getElementById('defisBouton');
    if(bouton){
      bouton.classList.remove('xp-pulse');
      void bouton.offsetWidth;
      bouton.classList.add('xp-pulse');
    }

    vider();
  }

  async function vider(){

    if(enCours) return;
    enCours = true;

    while(file.length){

      const a = file.shift();

      if(a.sorte === 'toast'){
        const n = notifier(a.titre, a.options);
        if(n && a.rang) n.classList.add('xp-rang-' + a.rang);
        if(n && a.options.icone === '🔥') n.classList.add('xp-feu');
        await pause(600);
      }else{
        await celebrer(a);
        await pause(250);
      }
    }

    enCours = false;
  }

  function celebrer(a){

    return new Promise((fin) => {

      poserFeuille();

      const fond = document.createElement('div');
      fond.className = 'xp-celebre';
      fond.setAttribute('role', 'dialog');
      fond.setAttribute('aria-modal', 'true');

      const recompenses = (a.recompenses || []).map(r => `<span class="xp-puce">${esc(r)}</span>`).join('');

      fond.innerHTML = `
        <div class="xp-carte${a.rang === 'platine' ? ' rang-platine' : ''}">
          <div class="halo"></div>
          <div class="gros${a.gros ? '' : ' emoji'}">${a.gros ? esc(a.gros) : esc(a.icone || '🏅')}</div>
          <p class="eyebrow">${esc(a.eyebrow || '')}</p>
          <h2>${esc(a.titre)}</h2>
          ${a.texte ? `<p>${esc(a.texte)}</p>` : ''}
          ${recompenses ? `<div class="recompenses">${recompenses}</div>` : ''}
          <button type="button" class="bouton">Continuer</button>
        </div>`;

      if(a.confettis && !window.matchMedia('(prefers-reduced-motion: reduce)').matches){
        const carte = fond.querySelector('.xp-carte');
        const couleurs = ['#f5b301', '#ff8a3d', '#4FB4FF', '#8fe3ab', '#f0867b', '#ffffff'];
        for(let i = 0; i < 34; i++){
          const c = document.createElement('i');
          c.className = 'xp-conf';
          c.style.left = (Math.random() * 100) + '%';
          c.style.background = couleurs[i % couleurs.length];
          c.style.setProperty('--dx', ((Math.random() - 0.5) * 220) + 'px');
          c.style.setProperty('--r', ((Math.random() - 0.5) * 900) + 'deg');
          c.style.animationDelay = (Math.random() * 0.5) + 's';
          c.style.animationDuration = (1.8 + Math.random() * 1.4) + 's';
          carte.appendChild(c);
        }
      }

      let ferme = false;

      const fermer = () => {
        if(ferme) return;
        ferme = true;
        document.removeEventListener('keydown', touche);
        fond.classList.add('sortie');
        setTimeout(() => { fond.remove(); fin(); }, 280);
      };

      const touche = (e) => { if(e.key === 'Escape' || e.key === 'Enter') fermer(); };

      fond.addEventListener('click', fermer);
      document.addEventListener('keydown', touche);
      document.body.appendChild(fond);

      const bouton = fond.querySelector('.bouton');
      if(bouton) bouton.focus({ preventScroll: true });

      setTimeout(fermer, 9000);
    });
  }

  // ---------------------------------------------------------------------
  // Le bouton rond et son panneau
  // ---------------------------------------------------------------------

  function majFlottant(){
    if(typeof majDefisFlottant === 'function') majDefisFlottant();
  }

  function multiplicateurTexte(m){
    return '×' + String(m).replace('.', ',');
  }

  function dessiner(){

    poserFeuille();
    dessinerBouton();
    dessinerPanneau();
  }

  function dessinerBouton(){

    const bouton = document.getElementById('defisBouton');
    if(!bouton || !etat) return;

    const quetes = etat.quetes || [];
    const total = quetes.length || 3;
    const faites = quetes.filter(q => q.faite).length;
    const pct = Math.round((faites / total) * 100);

    const anneau = document.getElementById('defisAnneau');
    const compteur = document.getElementById('defisBoutonCompteur');
    const point = document.getElementById('dailyNewDot');
    const serie = document.getElementById('defisSerie');

    if(anneau) anneau.style.strokeDashoffset = 100 - pct;
    if(compteur) compteur.textContent = faites + '/' + total;
    if(point) point.style.display = faites < total ? 'inline-block' : 'none';

    if(serie){
      serie.hidden = !(etat.serie > 0);
      serie.textContent = '🔥 ' + etat.serie;
    }

    bouton.classList.toggle('defis-tous-faits', faites === total);
    bouton.title = 'Niveau ' + etat.niveau + ' · quêtes ' + faites + '/' + total
      + (etat.serie > 0 ? ' · série de ' + etat.serie + ' jours' : '');
    bouton.setAttribute('aria-label', 'Progression : niveau ' + etat.niveau + ', quêtes du jour ' + faites + ' sur ' + total);
  }

  function entetePanneau(){

    const e = etat;
    const haut = e.seuil_haut;
    const pct = haut ? Math.max(0, Math.min(100, ((e.xp - e.seuil_bas) / (haut - e.seuil_bas)) * 100)) : 100;

    const puces = [];
    if(e.serie > 0) puces.push(`<span class="xp-puce feu">🔥 ${e.serie} jour${e.serie > 1 ? 's' : ''}</span>`);
    else puces.push(`<span class="xp-puce">🔥 Pas de série</span>`);
    if(e.multiplicateur > 1) puces.push(`<span class="xp-puce feu">✨ XP ${multiplicateurTexte(e.multiplicateur)}</span>`);
    if(e.gels > 0) puces.push(`<span class="xp-puce">❄️ ${e.gels} gel${e.gels > 1 ? 's' : ''}</span>`);

    return `
      <div class="xp-p-tete">
        <div class="xp-niv">
          <span class="xp-niv-num">${e.niveau}</span>
          <div>
            <b>${esc(e.titre)}</b>
            <small>${haut ? nf(e.xp - e.seuil_bas) + ' / ' + nf(haut - e.seuil_bas) + ' XP vers le niveau ' + (e.niveau + 1) : 'Niveau maximum'}</small>
          </div>
        </div>
        <div class="xp-bar"><span style="width:${pct}%"></span></div>
        <div class="xp-p-serie">${puces.join('')}</div>
      </div>`;
  }

  function vueJour(){

    const e = etat;
    const quetes = e.quetes || [];
    const faites = quetes.filter(q => q.faite).length;

    const liste = quetes.map(q => {
      const pct = Math.min(100, Math.round((q.progres / q.objectif) * 100));
      return `
        <div class="xp-quete${q.faite ? ' faite' : ''}">
          <span class="ic">${q.faite ? '✅' : esc(q.icone)}</span>
          <div class="tx">${esc(q.libelle)}
            <div class="mini"><span style="width:${pct}%"></span></div>
          </div>
          <span class="gain">${q.faite ? '✓' : q.progres + '/' + q.objectif + ' · +' + q.xp}</span>
        </div>`;
    }).join('');

    const coffre = e.coffre && e.coffre.ouvert
      ? `<div class="xp-coffre ouvert"><span class="ic">🎁</span><span>Coffre ouvert : <b>+${e.coffre.xp} XP</b>. À demain pour le prochain.</span></div>`
      : `<div class="xp-coffre"><span class="ic">🎁</span><span>Termine les <b>3 quêtes</b> pour ouvrir le coffre surprise (${faites}/${quetes.length || 3}).</span></div>`;

    const s = e.semaine;
    const max = Math.max(...s.paliers.map(p => p.seuil));
    const pctSemaine = Math.min(100, (s.xp / max) * 100);
    const bornes = s.paliers.map(p => `
      <span class="xp-borne${p.atteint ? ' ok' : ''}" style="left:${(p.seuil / max) * 100}%">${p.atteint ? '✓' : ''}<em>${p.seuil} · +${p.bonus}</em></span>`).join('');

    const jours = s.jours_restants === 0 ? 'dernier jour' : s.jours_restants + ' j restant' + (s.jours_restants > 1 ? 's' : '');

    const proches = ((e.succes && e.succes.prochains) || []).map(p => {
      const pct = Math.min(100, Math.round((p.valeur / p.seuil) * 100));
      return `
        <div class="xp-proche">
          <span class="ic">${esc(p.icone)}</span>
          <div><span class="nom">${esc(p.nom)}</span><div class="mini"><span style="width:${pct}%"></span></div></div>
          <span class="val">${nf(Math.min(p.valeur, p.seuil))} / ${nf(p.seuil)}</span>
        </div>`;
    }).join('');

    return `
      <div class="xp-titre-bloc"><span>Quêtes du jour</span><span>${faites}/${quetes.length || 3}</span></div>
      ${liste || '<div class="xp-vide">Les quêtes arrivent…</div>'}
      ${coffre}

      <div class="xp-titre-bloc"><span>Objectif de la semaine</span><span>${nf(s.xp)} XP</span></div>
      <div class="xp-semaine"><div class="piste"><span style="width:${pctSemaine}%"></span></div>${bornes}</div>
      <div class="xp-semaine-infos">
        <span>${s.rang ? '<b>' + s.rang + (s.rang === 1 ? 'er' : 'e') + '</b> cette semaine' : 'Gagne de l’XP pour entrer au classement'}</span>
        <span>${jours}</span>
      </div>

      ${proches ? `<div class="xp-titre-bloc"><span>Prochains succès</span><span>${e.succes.obtenus}/${e.succes.total}</span></div>${proches}` : ''}
      <button type="button" class="xp-lien" data-xp-aller="succes">Voir tous mes succès</button>`;
  }

  function vueClassement(){

    const bascule = `
      <div class="xp-bascule">
        <button type="button" data-xp-periode="semaine" class="${periode === 'semaine' ? 'actif' : ''}">Cette semaine</button>
        <button type="button" data-xp-periode="total" class="${periode === 'total' ? 'actif' : ''}">Depuis le début</button>
      </div>`;

    if(!classement || classement.periode !== periode){
      chargerClassement();
      return bascule + '<div class="xp-vide">Chargement…</div>';
    }

    if(!classement.top.length){
      return bascule + '<div class="xp-vide">Personne n’a encore marqué d’XP cette semaine. Sois le premier.</div>';
    }

    const lignes = classement.top.map(r => {
      const moi = currentUser && r.user_id === currentUser.id;
      const photo = typeof safeUrl === 'function' ? safeUrl(r.avatar_url) : r.avatar_url;
      const avatar = photo
        ? `<span class="av" style="background-image:url('${attr(photo)}')"></span>`
        : `<span class="av">${esc((r.pseudo || '?').slice(0, 1).toUpperCase())}</span>`;
      return `
        <button type="button" class="xp-rang${moi ? ' moi' : ''}" data-xp-profil="${attr(r.user_id)}">
          <span class="n">${r.rang}</span>${avatar}
          <span class="nm">${esc(r.pseudo || 'Membre')}${moi ? ' (toi)' : ''}<small>Niveau ${r.niveau}</small></span>
          <span class="pts">${nf(r.xp)} XP</span>
        </button>`;
    }).join('');

    const horsListe = classement.moi && !classement.top.some(r => currentUser && r.user_id === currentUser.id)
      ? `<div class="xp-vide">Tu es <b>${classement.moi.rang}e</b> avec ${nf(classement.moi.xp)} XP.</div>` : '';

    return bascule + lignes + horsListe;
  }

  async function chargerClassement(){

    const voulue = periode;
    const { data, error } = await BD.xpClassement(voulue);
    if(error || !data) return;
    classement = data;
    if(vue === 'classement' && periode === voulue) dessinerPanneau();
  }

  function dessinerPanneau(){

    const panneau = document.getElementById('defisPanneau');
    if(!panneau || !etat) return;

    const defil = panneau.scrollTop;

    panneau.innerHTML = `
      ${entetePanneau()}
      <div class="xp-onglets" role="tablist">
        <button type="button" class="xp-onglet${vue === 'jour' ? ' actif' : ''}" data-xp-vue="jour" role="tab">Aujourd’hui</button>
        <button type="button" class="xp-onglet${vue === 'classement' ? ' actif' : ''}" data-xp-vue="classement" role="tab">Classement</button>
      </div>
      <div class="xp-corps">${vue === 'jour' ? vueJour() : vueClassement()}</div>`;

    panneau.scrollTop = defil;
  }

  document.addEventListener('click', (ev) => {

    const cible = ev.target.closest && ev.target.closest('[data-xp-vue], [data-xp-periode], [data-xp-aller], [data-xp-profil], [data-xp-filtre]');
    if(!cible) return;

    if(cible.dataset.xpVue){
      vue = cible.dataset.xpVue;
      dessinerPanneau();
    }
    else if(cible.dataset.xpPeriode){
      periode = cible.dataset.xpPeriode;
      dessinerPanneau();
    }
    else if(cible.dataset.xpAller === 'succes'){
      if(typeof fermerDefis === 'function') fermerDefis();
      if(typeof ouvrirMesSucces === 'function') ouvrirMesSucces();
    }
    else if(cible.dataset.xpProfil){
      if(typeof fermerDefis === 'function') fermerDefis();
      if(typeof viewProfile === 'function') viewProfile(cible.dataset.xpProfil);
    }
    else if(cible.dataset.xpFiltre){
      filtre = cible.dataset.xpFiltre;
      dessinerSucces();
    }
  });

  // ---------------------------------------------------------------------
  // Le profil : la fiche de niveau et les succès
  // ---------------------------------------------------------------------

  function ficheHtml(){

    const e = etat;
    const haut = e.seuil_haut;
    const pct = haut ? Math.max(0, Math.min(100, ((e.xp - e.seuil_bas) / (haut - e.seuil_bas)) * 100)) : 100;

    const puces = [];
    puces.push(`<span class="xp-puce feu">🔥 ${e.serie} jour${e.serie > 1 ? 's' : ''} de suite${e.serie_max > e.serie ? ' · record ' + e.serie_max : ''}</span>`);
    if(e.multiplicateur > 1) puces.push(`<span class="xp-puce feu">✨ XP ${multiplicateurTexte(e.multiplicateur)}</span>`);
    puces.push(`<span class="xp-puce">❄️ ${e.gels} gel${e.gels > 1 ? 's' : ''}</span>`);
    if(e.semaine && e.semaine.rang) puces.push(`<span class="xp-puce">🏆 ${e.semaine.rang}${e.semaine.rang === 1 ? 'er' : 'e'} cette semaine</span>`);

    const echelle = (typeof BADGE_TIERS !== 'undefined' ? BADGE_TIERS.slice().reverse() : []).map(b => {
      const classe = b.name === e.titre ? 'actuel' : (e.niveau >= b.minLevel ? 'acquis' : '');
      return `<span class="rang ${classe}" title="Niveau ${b.minLevel}">${b.icon} ${esc(b.name)}<small>niv. ${b.minLevel}</small></span>`;
    }).join('');

    return `
      <svg width="0" height="0" style="position:absolute" aria-hidden="true">
        <defs><linearGradient id="xpDegrade" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffd54a"/><stop offset="1" stop-color="#ff7a3d"/></linearGradient></defs>
      </svg>
      <div class="xp-fiche">
        <div class="xp-medaillon">
          <svg viewBox="0 0 48 48"><circle class="fond" cx="24" cy="24" r="20" pathLength="100"/><circle class="jauge" cx="24" cy="24" r="20" pathLength="100" data-pct="${pct}"/></svg>
          <small>Niveau</small>
          <b>${e.niveau}</b>
        </div>
        <div>
          <div class="xp-fiche-titre"><strong>${esc(e.titre)}</strong><span>${nf(e.xp)} XP au total</span></div>
          <div class="xp-bar big" style="margin-top:12px"><span style="width:${pct}%"></span></div>
          <div class="xp-fiche-sous">${haut ? nf(haut - e.xp) + ' XP avant le niveau ' + (e.niveau + 1) : 'Niveau maximum atteint'}</div>
          <div class="xp-p-serie">${puces.join('')}</div>
        </div>
      </div>
      <div class="xp-echelle">${echelle}</div>`;
  }

  function famillesDe(liste){

    const groupes = new Map();

    liste.forEach(s => {
      const cle = s.secret ? s.id : s.famille;
      if(!groupes.has(cle)) groupes.set(cle, []);
      groupes.get(cle).push(s);
    });

    return [...groupes.values()].map(g => g.slice().sort((a, b) => (a.seuil || 0) - (b.seuil || 0)));
  }

  function rarete(s){

    if(!succes) return '';
    const n = s.detenteurs || 0;
    if(succes.membres >= 10) return 'Obtenu par ' + Math.round((n / succes.membres) * 100) + ' % des membres';
    return n === 0 ? 'Personne ne l’a encore' : 'Obtenu par ' + n + ' membre' + (n > 1 ? 's' : '');
  }

  function familleHtml(g){

    const suivant = g.find(s => !s.obtenu_le);
    const complet = !suivant;
    const ref = suivant || g[g.length - 1];
    const secretCache = ref.secret && !ref.obtenu_le;

    const pips = g.length > 1
      ? `<span class="xp-pips">${g.map(s => `<i class="xp-pip ${s.rang}${s.obtenu_le ? ' on' : ''}" title="${attr(s.nom + ' — ' + s.description)}"></i>`).join('')}</span>`
      : '';

    let barre = '';
    if(ref.valeur !== null && ref.valeur !== undefined && ref.seuil){
      const pct = complet ? 100 : Math.min(100, Math.round((ref.valeur / ref.seuil) * 100));
      barre = `<div class="barre"><span style="width:${pct}%"></span></div>`;
    }

    const valeur = !secretCache && ref.valeur !== null && ref.valeur !== undefined && ref.seuil
      ? `${nf(Math.min(ref.valeur, ref.seuil))} / ${nf(ref.seuil)}` : (complet ? 'Complété' : '');

    const pastille = secretCache ? '' : `<span class="xp-rang-pastille ${ref.rang}">${ref.rang}</span>`;
    const dernier = g.filter(s => s.obtenu_le).pop();

    return `
      <div class="xp-fam${complet ? ' complet' : ''}${ref.secret ? ' secret' : ''}${!dernier && !complet ? ' vide' : ''}" title="${attr(rarete(ref))}">
        <div class="haut">
          <span class="ic">${esc(ref.icone)}</span>
          <div style="min-width:0">
            <div class="cat">${esc(ref.categorie)}</div>
            <div class="nom">${esc(ref.nom)}</div>
          </div>
          <span style="margin-left:auto">${pastille}</span>
        </div>
        <div class="desc">${esc(ref.description)}</div>
        ${barre}
        <div class="bas">
          <span>${valeur}</span>
          ${pips}
          <span>${complet ? '✓' : '<b>+' + ref.xp + ' XP</b>'}</span>
        </div>
      </div>`;
  }

  function succesHtml(){

    const liste = succes.liste;
    const obtenus = liste.filter(s => s.obtenu_le);
    const xpGagne = obtenus.reduce((t, s) => t + (s.xp || 0), 0);
    const pct = Math.round((obtenus.length / liste.length) * 100);

    const recents = obtenus.slice().sort((a, b) => String(b.obtenu_le).localeCompare(String(a.obtenu_le))).slice(0, 5);

    const categories = ['Tous'];
    liste.forEach(s => { if(!categories.includes(s.categorie)) categories.push(s.categorie); });

    return `
      <div class="xp-succes-tete">
        <div>
          <h3>Succès</h3>
          <div class="sous">${obtenus.length} sur ${liste.length} débloqués · ${nf(xpGagne)} XP gagnés</div>
        </div>
        <div class="xp-succes-total"><b>${pct} %</b>complété</div>
      </div>
      ${recents.length ? `<div class="xp-titre-bloc" style="margin-top:0"><span>Obtenus récemment</span></div>
        <div class="xp-recents">${recents.map(s => `<span class="xp-recent"><span class="ic">${esc(s.icone)}</span>${esc(s.nom)}</span>`).join('')}</div>` : ''}
      <div class="xp-filtres">
        ${categories.map(c => `<button type="button" class="xp-filtre${filtre === c ? ' actif' : ''}" data-xp-filtre="${attr(c)}">${esc(c)}</button>`).join('')}
      </div>
      <div class="xp-grille" id="xpGrille">${grilleHtml()}</div>`;
  }

  function grilleHtml(){

    const familles = famillesDe(succes.liste)
      .filter(g => filtre === 'Tous' || g[0].categorie === filtre);

    // Ceux qui avancent d'abord, les complétés à la fin.
    familles.sort((a, b) => {
      const sa = a.every(s => s.obtenu_le) ? 2 : 0;
      const sb = b.every(s => s.obtenu_le) ? 2 : 0;
      return sa - sb;
    });

    return familles.map(familleHtml).join('');
  }

  function dessinerSucces(){

    const hote = document.getElementById('xpSuccesHote');
    if(!hote || !succes) return;

    hote.innerHTML = succesHtml();
  }

  // Remplit la fiche et les succès dans l'onglet « Succès » du profil.
  async function majProfil(){

    const fiche = document.getElementById('profilXp');
    const hote = document.getElementById('xpSuccesHote');
    if(!fiche && !hote) return;

    poserFeuille();

    if(!etat){
      await demarrer();
      if(!etat){ repliProfil(fiche, hote); return; }
    }

    if(fiche){
      fiche.innerHTML = ficheHtml();
      // La jauge se remplit une fois posée : c'est elle qui anime.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const jauge = fiche.querySelector('.jauge');
        if(jauge) jauge.style.strokeDashoffset = 100 - Number(jauge.dataset.pct || 0);
      }));
    }

    if(hote){
      if(!succes) hote.innerHTML = '<div class="xp-vide">Chargement des succès…</div>';
      await lireSucces();
      if(succes) dessinerSucces();
    }
  }

  // Sans le SQL : le niveau reste lisible, les succès attendent.
  function repliProfil(fiche, hote){

    if(fiche && currentUser){
      fiche.innerHTML = `<div class="xp-fiche-titre"><strong>Niveau ${levelForXP(currentUser.xp)}</strong><span>${nf(currentUser.xp)} XP</span></div>`;
    }
    if(hote) hote.innerHTML = '<div class="xp-vide">Les succès arrivent bientôt.</div>';
  }

  window.Xp = {
    demarrer, apres, action, dessiner, reinitialiser,
    remplirProfil: majProfil,
    rafraichir: () => lireEvenements(),
    indisponible: () => indispo
  };

})();
