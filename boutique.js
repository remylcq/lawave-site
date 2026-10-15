/* =====================================================================
   La Wave — les boosters, les cartes et les classeurs

   Le moteur vit dans la base (sql/coffres-cartes.sql, sql/boosters.sql) : Waves Coins (WC), boosters saisonniers,
   tirage des cartes, classeurs, accès équipe. Ce fichier LIT et DESSINE :

     la boutique    les boosters en vente, leur prix en WC, le temps qu'il reste, l'aperçu des cartes, les défis spéciaux
     l'ouverture    le booster qu'on déchire, puis les cartes tirées une par une
     le classeur    une page à la fois, qu'on tourne ; les emplacements vides restent numérotés
     les cartes     la pochette de la sortie, un cadre aux couleurs du booster, la rareté en discret
     l'équipe       composer les boosters (cartes, raretés, image, prix, dates) et en créer d'autres

   Chargé à la demande (chargerBoutique dans index.html) : par l'onglet « Boutique » de la communauté, ou par
   l'onglet « Boosters » de l'espace équipe.
   ===================================================================== */

(function(){

  'use strict';

  const esc = (t) => escapeHtml(t);
  const attr = (t) => escapeAttribute(t);
  const nf = (n) => Number(n || 0).toLocaleString('fr-FR');

  // Les six raretés, de la plus commune à la plus rare, avec leur poids dans le tirage (voir coffre_tirer_rarete).
  const RARETES = [
    { cle: 'commun',      nom: 'Commun',      couleur: '#9aa3ad', poids: 60 },
    { cle: 'peu_commun',  nom: 'Peu commun',  couleur: '#4cc38a', poids: 24 },
    { cle: 'rare',        nom: 'Rare',        couleur: '#4fb4ff', poids: 10 },
    { cle: 'ultra_rare',  nom: 'Ultra rare',  couleur: '#b66bff', poids: 4 },
    { cle: 'legendaire',  nom: 'Légendaire',  couleur: '#ffc23d', poids: 1.6 },
    { cle: 'secret_wave', nom: 'Secret Wave', couleur: '#5ef0ff', poids: 0.4 }
  ];

  const rarete = (cle) => RARETES.find(r => r.cle === cle) || RARETES[0];
  const ordreRarete = (cle) => RARETES.findIndex(r => r.cle === cle);

  const PAR_PAGE = 9;       // cartes par page du classeur (3 × 3)

  let hote = null;          // l'emplacement dans la page
  let boutique = null;      // ce que rend boutique_liste
  const classeurs = {};     // collection -> ce que rend classeur_collection
  const apercus = {};       // collection -> ce que rend booster_apercu
  const pages = {};         // collection -> page du classeur
  let onglet = 'boosters';  // 'boosters' | 'classeurs'
  let colChoisie = null;    // la collection montrée dans le classeur
  let occupe = false;       // un achat est en cours
  let tourne = false;       // une page est en train de se tourner

  // ---------------------------------------------------------------------
  // La feuille de style, posée une fois
  // ---------------------------------------------------------------------

  const FEUILLE = `
  .bq{max-width:980px; margin:0 auto; padding:4px 0 48px;}
  .bq-tete{display:flex; align-items:center; justify-content:space-between; gap:16px; flex-wrap:wrap; margin:4px 0 22px;}
  .bq-tete h2{margin:0; font-size:26px; color:var(--ink);}
  .bq-tete p{margin:4px 0 0; font-size:14px; color:var(--muted); max-width:48ch;}
  .bq-wc{display:flex; align-items:center; gap:10px; padding:8px 16px 8px 9px; border-radius:99px; background:rgba(255,255,255,.06); border:1px solid var(--line-strong); color:var(--muted); font-size:13px;}
  .bq-wc b{font-size:18px; color:var(--ink); font-variant-numeric:tabular-nums;}
  .bq-piece{
    width:26px; height:26px; border-radius:50%; flex-shrink:0; display:grid; place-items:center; font-size:10px; font-weight:800;
    color:#4a2f00; background:radial-gradient(circle at 30% 28%,#fff1b3,#f5b301 55%,#b97700);
  }
  .bq-onglets{display:flex; gap:6px; margin:0 0 24px; border-bottom:1px solid var(--line);}
  .bq-onglet{padding:10px 16px; font-size:14px; color:var(--muted); background:transparent; border:0; cursor:pointer; border-bottom:2px solid transparent; margin-bottom:-1px;}
  .bq-onglet.actif{color:var(--ink); border-bottom-color:var(--blue-bright);}
  .bq-vide{padding:36px 10px; text-align:center; color:var(--muted); font-size:14px;}

  /* ---- Le booster : le paquet ---- */
  .bq-pack{
    --ca:#ff7a18; --cb:#7a2cff; --cc:#12061f;
    position:relative; width:var(--l,170px); aspect-ratio:5/8; border-radius:10px; overflow:hidden; isolation:isolate; flex-shrink:0;
    background:linear-gradient(160deg,var(--ca),var(--cb) 70%,var(--cc));
    box-shadow:0 22px 40px rgba(0,0,0,.55), 0 0 0 1px rgba(255,255,255,.18) inset;
    transition:transform .45s var(--ease);
  }
  button.bq-pack{padding:0; border:0; cursor:pointer; display:block;}
  button.bq-pack:hover{transform:translateY(-6px) rotate(-1.5deg) scale(1.03);}
  .bq-pack-art{position:absolute; inset:0; background:var(--cc) center/cover; z-index:0;}
  .bq-pack-art::after{content:''; position:absolute; inset:0; background:linear-gradient(180deg,rgba(0,0,0,.35),transparent 30%,transparent 55%,rgba(0,0,0,.8)); }
  .bq-pack-emoji{position:absolute; inset:0; display:grid; place-items:center; font-size:calc(var(--l,170px) * .42); z-index:0; opacity:.9;}
  .bq-pack-sceau{
    position:absolute; left:0; right:0; height:8%; z-index:3;
    background:linear-gradient(180deg,rgba(255,255,255,.4),rgba(255,255,255,.08)), repeating-linear-gradient(90deg,rgba(255,255,255,.34) 0 2px,rgba(0,0,0,.28) 2px 4px), linear-gradient(var(--ca),var(--cb));
    box-shadow:0 1px 0 rgba(255,255,255,.25) inset;
  }
  .bq-pack-sceau.haut{top:0;}
  .bq-pack-sceau.bas{bottom:0;}
  .bq-pack-marque{position:absolute; top:11%; left:0; right:0; z-index:2; text-align:center; font-size:calc(var(--l,170px) * .06); letter-spacing:.38em; text-transform:uppercase; color:rgba(255,255,255,.9); text-shadow:0 1px 6px rgba(0,0,0,.7);}
  .bq-pack-nom{
    position:absolute; left:0; right:0; bottom:0; padding:26% 8% 13%; z-index:2; text-align:center; color:#fff; line-height:1.05; font-weight:800;
    font-size:calc(var(--l,170px) * .105); text-transform:uppercase; letter-spacing:.03em;
    background:linear-gradient(180deg,transparent,rgba(0,0,0,.92) 52%);
  }
  .bq-pack-nom small{display:block; margin-top:5%; font-size:.46em; font-weight:600; letter-spacing:.2em; color:rgba(255,255,255,.82);}
  .bq-pack-reflet{
    position:absolute; inset:0; z-index:4; pointer-events:none; mix-blend-mode:overlay; opacity:.75;
    background:linear-gradient(115deg,transparent 30%,rgba(255,255,255,.75) 46%,transparent 58%); background-size:260% 100%; background-position:120% 0;
    transition:background-position .9s var(--ease);
  }
  .bq-pack:hover .bq-pack-reflet{background-position:-20% 0;}
  .bq-pack.grand{--l:min(260px, 56vw);}

  /* ---- La boutique : un booster par bandeau ---- */
  .bq-liste{display:flex; flex-direction:column; gap:20px;}
  .bq-booster{
    --ca:#ff7a18; --cb:#7a2cff; --cc:#12061f;
    display:flex; gap:clamp(18px,4vw,40px); align-items:center; padding:clamp(18px,3vw,30px); border-radius:26px;
    background:radial-gradient(ellipse at 18% 40%,color-mix(in srgb,var(--cb) 28%,transparent),transparent 60%),rgba(255,255,255,.03);
    border:1px solid var(--line);
  }
  .bq-booster.termine, .bq-booster.bientot{opacity:.85;}
  .bq-infos{flex:1; min-width:0; display:flex; flex-direction:column; gap:12px;}
  .bq-infos h3{margin:0; font-size:24px; color:var(--ink);}
  .bq-infos p{margin:0; font-size:14px; line-height:1.5; color:var(--ink-soft); max-width:52ch;}
  .bq-meta{display:flex; gap:6px 16px; flex-wrap:wrap; margin:0; padding:0; list-style:none; font-size:13px; color:var(--muted);}
  .bq-meta b{color:var(--ink); font-weight:600;}
  .bq-lien{background:none; border:0; padding:0; font-size:13px; color:var(--blue-bright); cursor:pointer; text-align:left; width:fit-content;}
  .bq-lien:hover{text-decoration:underline;}
  .bq-progres{height:4px; border-radius:99px; background:rgba(255,255,255,.1); overflow:hidden;}
  .bq-progres > span{display:block; height:100%; border-radius:99px; background:var(--blue-bright); transition:width .8s var(--ease);}
  .bq-progres-txt{display:flex; justify-content:space-between; margin-top:6px; font-size:12px; color:var(--muted); font-variant-numeric:tabular-nums;}
  .bq-actions{display:flex; gap:10px; flex-wrap:wrap; margin-top:4px;}
  .bq-btn{
    padding:12px 20px; border-radius:12px; font-size:14px; font-weight:600; cursor:pointer; white-space:nowrap;
    border:1px solid var(--line-strong); background:rgba(255,255,255,.07); color:var(--ink); transition:transform .15s, background .2s, filter .2s;
  }
  .bq-btn:hover:not(:disabled){background:rgba(255,255,255,.13);}
  .bq-btn:active:not(:disabled){transform:scale(.97);}
  .bq-btn:disabled{opacity:.45; cursor:not-allowed;}
  .bq-btn.plein{background:var(--ink); border-color:transparent; color:#0b0d11;}
  .bq-btn.plein:hover:not(:disabled){background:#fff; filter:none;}
  .bq-note{margin:0; font-size:12px; color:var(--muted);}

  /* ---- Les défis spéciaux ---- */
  .bq-defis{margin-top:34px;}
  .bq-defis h3{display:flex; justify-content:space-between; align-items:baseline; gap:10px; margin:0 0 4px; font-size:16px; color:var(--ink);}
  .bq-defis h3 small{font-size:12px; font-weight:400; color:var(--muted);}
  .bq-defis > p{margin:0 0 6px; font-size:13px; color:var(--muted);}
  .bq-defi{display:flex; align-items:center; gap:12px; padding:11px 0; border-top:1px solid var(--line); font-size:13px; color:var(--ink);}
  .bq-defi .coche{width:16px; height:16px; flex-shrink:0; border-radius:50%; border:1.5px solid rgba(255,255,255,.28); display:grid; place-items:center; font-size:10px; color:transparent;}
  .bq-defi.faite{color:var(--muted);}
  .bq-defi.faite .coche{background:var(--blue-bright); border-color:var(--blue-bright); color:#06101a;}
  .bq-defi .tx{flex:1; min-width:0;}
  .bq-defi .gain{font-size:12px; color:var(--muted); white-space:nowrap; font-variant-numeric:tabular-nums;}

  /* ---- Une carte : sobre ---- */
  .wc-carte{
    --ca:#ff7a18; --cb:#7a2cff; --cc:#12061f; --rc:#9aa3ad;
    position:relative; width:100%; aspect-ratio:5/7; border-radius:11px; padding:3px; container-type:inline-size; user-select:none;
    background:linear-gradient(150deg,var(--ca),var(--cb)); box-shadow:0 8px 20px rgba(0,0,0,.45);
  }
  .wc-cadre{
    position:relative; height:100%; display:flex; flex-direction:column; gap:3.5cqw; padding:4.5cqw; border-radius:8px; overflow:hidden;
    background:linear-gradient(170deg,color-mix(in srgb,var(--cb) 30%,#0a0c10),#0a0c10 70%);
  }
  .wc-cover{width:100%; aspect-ratio:1; border-radius:5px; overflow:hidden; background:#000;}
  .wc-cover img{display:block; width:100%; height:100%; object-fit:cover;}
  .wc-bas{display:flex; flex-direction:column; gap:1cqw; min-width:0; margin-top:1cqw;}
  .wc-bas b{font-size:8.4cqw; line-height:1.15; color:#fff; font-weight:700; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;}
  .wc-bas span{font-size:6.2cqw; color:rgba(255,255,255,.62); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
  .wc-pied{display:flex; align-items:center; justify-content:space-between; margin-top:auto; font-size:5.4cqw; letter-spacing:.08em; text-transform:uppercase; color:rgba(255,255,255,.5); font-variant-numeric:tabular-nums;}
  .wc-pied .wc-rar{color:var(--rc); font-weight:700;}
  .wc-pied .wc-emb{font-size:7cqw; letter-spacing:0; filter:grayscale(.2); opacity:.85;}
  .wc-brillance{position:absolute; inset:0; border-radius:11px; pointer-events:none; opacity:0;}

  .wc-carte[data-rar="peu_commun"]{box-shadow:0 8px 20px rgba(0,0,0,.45), 0 0 0 1px rgba(76,195,138,.5);}
  .wc-carte[data-rar="rare"]{box-shadow:0 8px 20px rgba(0,0,0,.45), 0 0 14px rgba(79,180,255,.45);}
  .wc-carte[data-rar="ultra_rare"]{box-shadow:0 8px 20px rgba(0,0,0,.45), 0 0 18px rgba(182,107,255,.55);}
  .wc-carte[data-rar="ultra_rare"] .wc-brillance{
    opacity:.4; mix-blend-mode:color-dodge;
    background:linear-gradient(115deg,transparent 25%,rgba(255,120,220,.55) 40%,rgba(120,220,255,.55) 52%,transparent 70%);
    background-size:260% 100%; animation:wcHolo 5s ease-in-out infinite;
  }
  .wc-carte[data-rar="legendaire"]{background:linear-gradient(150deg,#fff1a8,#ffb300 45%,#b87400 75%,#ffe27a); box-shadow:0 8px 22px rgba(0,0,0,.45), 0 0 22px rgba(255,194,61,.55);}
  .wc-carte[data-rar="legendaire"] .wc-brillance{
    opacity:.5; mix-blend-mode:overlay; background:linear-gradient(105deg,transparent 35%,rgba(255,255,255,.9) 50%,transparent 62%);
    background-size:260% 100%; animation:wcHolo 3.6s ease-in-out infinite;
  }
  .wc-carte[data-rar="secret_wave"]{background:conic-gradient(from 0deg,#5ef0ff,#c9a6ff,#ff9ed1,#ffe08a,#8fe3ab,#5ef0ff); box-shadow:0 8px 22px rgba(0,0,0,.45), 0 0 26px rgba(94,240,255,.6); animation:wcTeinte 7s linear infinite;}
  .wc-carte[data-rar="secret_wave"] .wc-brillance{
    opacity:.45; mix-blend-mode:color-dodge; background:linear-gradient(115deg,transparent 30%,rgba(255,255,255,.8) 50%,transparent 70%);
    background-size:260% 100%; animation:wcHolo 3.2s ease-in-out infinite;
  }
  @keyframes wcHolo{0%,100%{background-position:100% 0;}50%{background-position:0% 0;}}
  @keyframes wcTeinte{to{filter:hue-rotate(360deg);}}

  /* La carte cachée (Secret Wave dans l'aperçu) : tout est flou. */
  .wc-carte.secrete .wc-cover{background:linear-gradient(135deg,#5ef0ff,#c9a6ff,#ff9ed1); filter:blur(7px); transform:scale(1.15);}
  .wc-carte.secrete .wc-bas{filter:blur(5px);}
  .wc-carte.secrete .wc-point{position:absolute; inset:0; display:grid; place-items:center; font-size:22cqw; font-weight:800; color:#fff; text-shadow:0 2px 14px rgba(0,0,0,.6); z-index:3;}

  /* ---- L'aperçu d'un booster ---- */
  .bq-voile{position:fixed; inset:0; z-index:450; display:flex; justify-content:center; align-items:flex-start; overflow:auto; padding:28px 16px; background:rgba(3,5,8,.82); backdrop-filter:blur(8px); -webkit-backdrop-filter:blur(8px); animation:bqFond .25s ease;}
  @keyframes bqFond{from{opacity:0;}to{opacity:1;}}
  @keyframes bqFondSort{to{opacity:0;}}
  .bq-voile.sortie, .bq-ouv.sortie{animation:bqFondSort .28s ease forwards;}
  .bq-ap{width:min(900px,100%); margin:auto 0; padding:26px; border-radius:26px; background:#0d1016; border:1px solid var(--line-strong); box-shadow:var(--ombre-3);}
  .bq-ap-tete{display:flex; justify-content:space-between; align-items:flex-start; gap:14px; margin-bottom:16px;}
  .bq-ap-tete h3{margin:0; font-size:22px; color:var(--ink);}
  .bq-ap-tete p{margin:4px 0 0; font-size:13px; color:var(--muted);}
  .bq-fermer{width:36px; height:36px; flex-shrink:0; border-radius:50%; cursor:pointer; font-size:15px; background:rgba(255,255,255,.08); border:1px solid var(--line-strong); color:var(--ink);}
  .bq-legende{display:flex; gap:8px 18px; flex-wrap:wrap; margin:0 0 20px; padding:0; list-style:none; font-size:12px; color:var(--muted);}
  .bq-legende li{display:flex; align-items:center; gap:7px;}
  .bq-legende i{width:8px; height:8px; border-radius:50%; background:var(--rc);}
  .bq-legende b{color:var(--ink); font-weight:600;}
  .bq-ap-grille{display:grid; grid-template-columns:repeat(auto-fill,minmax(132px,1fr)); gap:14px;}

  /* ---- Le classeur : une page à la fois ---- */
  .bq-choix{display:flex; gap:8px; flex-wrap:wrap; margin-bottom:18px;}
  .bq-puce{padding:8px 14px; border-radius:99px; font-size:13px; cursor:pointer; background:transparent; color:var(--muted); border:1px solid var(--line);}
  .bq-puce.actif{background:rgba(255,255,255,.1); color:var(--ink); border-color:rgba(255,255,255,.3);}
  .bq-livre{--ca:#ff7a18; --cb:#7a2cff; --cc:#12061f;}
  .bq-livre-tete{display:flex; align-items:baseline; justify-content:space-between; gap:10px; margin-bottom:10px;}
  .bq-livre-tete h3{margin:0; font-size:20px; color:var(--ink);}
  .bq-livre-tete span{font-size:13px; color:var(--muted); font-variant-numeric:tabular-nums;}
  .bq-livre .bq-progres{margin-bottom:20px;}
  .bq-livre{max-width:660px; margin:0 auto;}
  .bq-livre-corps{display:flex; align-items:center; gap:clamp(6px,2vw,18px);}
  .bq-tourne{
    width:44px; height:44px; flex-shrink:0; border-radius:50%; cursor:pointer; font-size:20px; line-height:1; display:grid; place-items:center;
    background:rgba(255,255,255,.07); border:1px solid var(--line-strong); color:var(--ink); transition:background .2s, opacity .2s;
  }
  .bq-tourne:hover:not(:disabled){background:rgba(255,255,255,.14);}
  .bq-tourne:disabled{opacity:.25; cursor:default;}
  .bq-reliure{
    position:relative; flex:1; min-width:0; padding:clamp(14px,3vw,26px) clamp(14px,3vw,26px) clamp(14px,3vw,26px) clamp(30px,5vw,48px); border-radius:18px;
    background:linear-gradient(160deg,color-mix(in srgb,var(--cb) 22%,#0c0f14),#090b0f); border:1px solid color-mix(in srgb,var(--ca) 35%,transparent);
    box-shadow:0 20px 50px rgba(0,0,0,.5);
  }
  .bq-reliure::before{
    content:''; position:absolute; left:clamp(8px,2vw,16px); top:14px; bottom:14px; width:10px;
    background:radial-gradient(circle,#cfd6df 0 4px,transparent 5px) 0 0/10px 46px repeat-y; opacity:.55;
  }
  .bq-zone{display:grid; perspective:1600px;}
  .bq-feuille{grid-area:1/1; display:grid; grid-template-columns:repeat(3,1fr); gap:clamp(8px,2vw,16px); transform-origin:left center; backface-visibility:hidden;}
  .bq-case{position:relative; display:block; width:100%; padding:0; border:0; background:none; cursor:pointer; text-align:left;}
  .bq-case .wc-carte{transition:transform .3s var(--ease);}
  .bq-case:hover .wc-carte{transform:translateY(-4px);}
  .bq-quantite{
    position:absolute; top:-6px; right:-6px; z-index:5; min-width:24px; padding:2px 6px; border-radius:99px; text-align:center;
    font-size:11px; font-weight:800; background:#0b0d12; color:var(--ink); border:1px solid var(--line-strong);
  }
  .bq-vide-case{
    position:relative; width:100%; aspect-ratio:5/7; border-radius:12px; display:grid; place-items:center;
    background:rgba(255,255,255,.025); border:1.5px dashed rgba(255,255,255,.12); color:rgba(255,255,255,.3);
  }
  .bq-vide-case b{font-size:clamp(16px,4vw,26px); font-variant-numeric:tabular-nums; font-weight:600;}
  .bq-vide-case i{position:absolute; bottom:10px; left:50%; transform:translateX(-50%); width:7px; height:7px; border-radius:50%; background:var(--rc);}
  .bq-vide-case.secret{color:rgba(94,240,255,.55); border-color:rgba(94,240,255,.3);}
  .bq-cellule-vide{visibility:hidden;}
  .bq-livre-pied{display:flex; justify-content:center; align-items:center; gap:14px; margin-top:16px; font-size:13px; color:var(--muted);}
  .bq-points{display:flex; gap:7px;}
  .bq-point{width:8px; height:8px; padding:0; border-radius:50%; border:0; cursor:pointer; background:rgba(255,255,255,.2); transition:transform .2s, background .2s;}
  .bq-point.actif{background:var(--ink); transform:scale(1.3);}

  /* ---- L'ouverture d'un booster ---- */
  .bq-ouv{
    --ca:#ff7a18; --cb:#7a2cff; --cc:#12061f; --hc:transparent;
    position:fixed; inset:0; z-index:450; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:18px;
    padding:24px 16px; overflow:auto; animation:bqFond .3s ease;
    background:radial-gradient(ellipse at 50% 55%,color-mix(in srgb,var(--cb) 34%,#05070a),#03050a 75%);
  }
  .bq-ouv .bq-fermer{position:absolute; top:14px; right:14px; z-index:5;}
  .bq-scene{display:flex; flex-direction:column; align-items:center; gap:16px; text-align:center;}
  .bq-scene h2{margin:0; font-size:22px; color:var(--ink);}
  .bq-scene p{margin:0; font-size:14px; color:var(--ink-soft); min-height:1.4em;}
  .bq-pack-ouv{position:relative; cursor:pointer;}
  .bq-pack-ouv .bq-pack{box-shadow:0 30px 60px rgba(0,0,0,.6), 0 0 0 1px rgba(255,255,255,.2) inset;}
  .bq-pack-ouv.attend{animation:bqRespire 2.6s ease-in-out infinite;}
  .bq-pack-ouv.secoue{animation:bqSecoue .6s ease-in-out infinite;}
  .bq-pack-ouv.arrache .bq-pack-sceau.haut{animation:bqArrache .8s cubic-bezier(.4,0,.2,1) forwards;}
  .bq-pack-ouv.arrache .bq-pack{animation:bqDecoupe .5s ease .1s forwards;}
  @keyframes bqRespire{50%{transform:translateY(-8px);}}
  @keyframes bqSecoue{0%,100%{transform:rotate(0);}20%{transform:rotate(-5deg) translateX(-5px);}40%{transform:rotate(5deg) translateX(5px);}60%{transform:rotate(-3deg);}80%{transform:rotate(3deg);}}
  @keyframes bqArrache{to{transform:translate(70px,-110px) rotate(24deg); opacity:0;}}
  @keyframes bqDecoupe{to{transform:translateY(40px) scale(.9); opacity:0;}}

  .bq-defile{display:flex; flex-direction:column; align-items:center; gap:14px; width:100%;}
  .bq-compteur{font-size:12px; letter-spacing:.22em; text-transform:uppercase; color:var(--muted);}
  .bq-table{position:relative; width:min(300px, 66vw); aspect-ratio:5/7;}
  .bq-halo{position:absolute; inset:-40%; border-radius:50%; background:radial-gradient(circle,var(--hc),transparent 62%); opacity:0; transition:opacity .6s; pointer-events:none;}
  .bq-halo.on{opacity:.8;}
  .bq-flip{position:absolute; inset:0; perspective:1100px; cursor:pointer; transition:transform .45s cubic-bezier(.5,0,.75,0), opacity .45s;}
  .bq-flip.sort{transform:translateX(-130%) rotate(-14deg); opacity:0;}
  .bq-flip.entre{animation:bqEntre .5s cubic-bezier(.2,.9,.3,1);}
  @keyframes bqEntre{from{transform:translateY(40px) scale(.9); opacity:0;}to{transform:none; opacity:1;}}
  .bq-flip-in{position:absolute; inset:0; transform-style:preserve-3d; transition:transform .75s cubic-bezier(.2,.8,.2,1);}
  .bq-flip.retournee .bq-flip-in{transform:rotateY(180deg);}
  .bq-face, .bq-dos{position:absolute; inset:0; backface-visibility:hidden; -webkit-backface-visibility:hidden;}
  .bq-face{transform:rotateY(180deg);}
  .bq-dos{
    border-radius:14px; display:grid; place-items:center; font-size:56px; border:2px solid color-mix(in srgb,var(--ca) 60%,#fff);
    background:repeating-linear-gradient(45deg,rgba(255,255,255,.05) 0 6px,transparent 6px 12px),linear-gradient(145deg,var(--ca),var(--cb));
    box-shadow:0 14px 34px rgba(0,0,0,.55);
  }
  .bq-dos small{position:absolute; bottom:9%; font-size:11px; letter-spacing:.34em; text-transform:uppercase; color:rgba(255,255,255,.8);}
  .bq-etiquette{
    position:absolute; top:-12px; left:50%; transform:translateX(-50%); z-index:6; padding:3px 12px; border-radius:99px; white-space:nowrap;
    font-size:11px; font-weight:800; letter-spacing:.1em; text-transform:uppercase; background:#fff; color:#0b0d11; opacity:0; transition:opacity .3s .55s;
  }
  .bq-flip.retournee .bq-etiquette{opacity:1;}
  .bq-etiquette.double{background:rgba(255,255,255,.16); color:var(--ink);}
  .bq-annonce{min-height:1.5em; font-size:15px; font-weight:600; color:var(--ink);}
  .bq-defausse{display:flex; gap:6px; min-height:46px; align-items:flex-end;}
  .bq-defausse .mini{width:34px; aspect-ratio:5/7; border-radius:5px; overflow:hidden; border:1.5px solid var(--rc); background:#000;}
  .bq-defausse .mini img{width:100%; height:100%; object-fit:cover; display:block;}
  .bq-bas{display:flex; gap:10px; flex-wrap:wrap; justify-content:center; min-height:46px;}
  .bq-resume{display:grid; grid-template-columns:repeat(auto-fit,minmax(110px,150px)); gap:12px; justify-content:center; width:min(860px,100%);}
  .bq-eclair{position:fixed; inset:0; z-index:451; pointer-events:none; background:#fff; opacity:0; animation:bqEclair .6s ease-out;}
  @keyframes bqEclair{0%{opacity:.8;}100%{opacity:0;}}

  /* ---- L'aperçu d'une carte du classeur ---- */
  .bq-carte-grande{width:min(320px,82vw); transition:transform .12s; transform:perspective(900px) rotateX(var(--rx,0deg)) rotateY(var(--ry,0deg));}

  @media (max-width:640px){
    .bq-booster{flex-direction:column; text-align:center;}
    .bq-infos{align-items:center;}
    .bq-meta, .bq-actions{justify-content:center;}
    .bq-pack{--l:150px;}
    .bq-tourne{width:36px; height:36px; font-size:16px;}
    .bq-reliure{padding-left:26px;}
    .bq-ap{padding:18px;}
  }
  @media (prefers-reduced-motion:reduce){
    .wc-carte, .wc-brillance, .bq-pack-ouv, .bq-flip-in, .bq-flip, .bq-eclair, .bq-pack-ouv *{animation:none !important; transition:none !important;}
  }

  /* ---- L'accès équipe ---- */
  .bqa{display:flex; flex-direction:column; gap:22px;}
  .bqa-liste{display:grid; grid-template-columns:repeat(auto-fill,minmax(240px,1fr)); gap:12px;}
  .bqa-carte{display:flex; gap:12px; align-items:center; padding:12px; border-radius:16px; background:rgba(255,255,255,.04); border:1px solid var(--line); cursor:pointer; text-align:left; color:var(--ink);}
  .bqa-carte:hover, .bqa-carte.actif{border-color:var(--blue-bright);}
  .bqa-carte .vignette{width:44px; height:62px; flex-shrink:0; border-radius:6px; overflow:hidden; background:rgba(255,255,255,.08) center/cover; display:grid; place-items:center; font-size:22px;}
  .bqa-carte b{display:block; font-size:14px;}
  .bqa-carte small{display:block; margin-top:3px; font-size:12px; color:var(--muted);}
  .bqa-form{display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:14px; padding:20px; border-radius:18px; background:rgba(255,255,255,.035); border:1px solid var(--line);}
  .bqa-form label{display:flex; flex-direction:column; gap:6px; font-size:12px; color:var(--muted);}
  .bqa-form label.large{grid-column:1/-1;}
  .bqa-form input, .bqa-form textarea, .bqa-form select{padding:10px 12px; border-radius:10px; font-size:14px; background:rgba(255,255,255,.06); border:1px solid var(--line-strong); color:var(--ink); font-family:inherit;}
  .bqa-form input[type=color]{padding:2px; height:40px;}
  .bqa-form textarea{min-height:70px; resize:vertical;}
  .bqa-form .case{flex-direction:row; align-items:center; gap:10px; font-size:14px; color:var(--ink);}
  .bqa-form .case input{width:auto;}
  .bqa-actions{grid-column:1/-1; display:flex; gap:10px; flex-wrap:wrap; align-items:center;}
  .bqa-apercu-visuel{display:flex; align-items:center; gap:14px;}
  .bqa-cartes h4, .bqa-ajout h4{margin:0 0 10px; font-size:15px;}
  .bqa-ligne{display:flex; align-items:center; gap:12px; padding:8px 0; border-top:1px solid var(--line); font-size:13px; color:var(--ink);}
  .bqa-ligne .num{width:26px; text-align:right; color:var(--muted); font-variant-numeric:tabular-nums;}
  .bqa-ligne img{width:38px; height:38px; border-radius:6px; object-fit:cover; background:#000; flex-shrink:0;}
  .bqa-ligne .tx{flex:1; min-width:0;}
  .bqa-ligne .tx span{display:block; font-size:12px; color:var(--muted);}
  .bqa-ligne select{padding:7px 9px; border-radius:8px; font-size:12px; background:rgba(255,255,255,.06); border:1px solid var(--line-strong); color:var(--ink);}
  .bqa-resume{display:flex; gap:8px; flex-wrap:wrap; margin-bottom:10px;}
  .bqa-resume .p{padding:3px 10px; border-radius:99px; font-size:12px; border:1px solid var(--rc); color:var(--rc);}
  `;

  function poserFeuille(){
    if(document.getElementById('bqFeuille')) return;
    const s = document.createElement('style');
    s.id = 'bqFeuille';
    s.textContent = FEUILLE;
    document.head.appendChild(s);
  }

  // ---------------------------------------------------------------------
  // Les dessins : le paquet, la carte
  // ---------------------------------------------------------------------

  function couleursDe(col){
    const c = col.couleurs || {};
    return { a: c.a || '#4fb4ff', b: c.b || '#7a2cff', c: c.c || '#0b0d12' };
  }

  function styleCol(col){
    const c = couleursDe(col);
    return `--ca:${c.a};--cb:${c.b};--cc:${c.c};`;
  }

  // Le paquet : l'image du booster (ou son emoji), deux sceaux, le nom. `balise` = 'button' pour un paquet cliquable.
  function packHtml(col, options){

    const o = options || {};
    const photo = typeof safeUrl === 'function' ? safeUrl(col.visuel_url) : col.visuel_url;
    const nom = String(col.nom || '').replace(/^Booster\s+/i, '');
    const balise = o.balise || 'div';

    return `
      <${balise} class="bq-pack${o.grand ? ' grand' : ''}"${balise === 'button' ? ` type="button" ${o.attrs || ''}` : ''} style="${styleCol(col)}${o.largeur ? '--l:' + o.largeur + ';' : ''}">
        ${photo ? `<span class="bq-pack-art" style="background-image:url('${attr(photo)}')"></span>` : `<span class="bq-pack-emoji">${esc(col.emoji || '🎴')}</span>`}
        <span class="bq-pack-sceau haut"></span>
        <span class="bq-pack-marque">La Wave</span>
        <span class="bq-pack-nom">${esc(nom)}<small>Booster</small></span>
        <span class="bq-pack-sceau bas"></span>
        <span class="bq-pack-reflet"></span>
      </${balise}>`;
  }

  // Une carte : la pochette, le titre, l'artiste, et en pied le numéro, l'emblème du booster, la rareté.
  function carteHtml(c, col, total){

    const r = rarete(c.rarete);
    const photo = typeof safeUrl === 'function' ? safeUrl(c.cover_url) : c.cover_url;

    return `
      <div class="wc-carte" data-rar="${attr(c.rarete)}" style="${styleCol(col)}--rc:${r.couleur};">
        <div class="wc-cadre">
          <div class="wc-cover">${photo ? `<img src="${attr(photo)}" alt="" loading="lazy" draggable="false">` : ''}</div>
          <div class="wc-bas"><b>${esc(c.titre)}</b><span>${esc(c.artiste)}${c.type_sortie ? ' · ' + esc(c.type_sortie) : ''}</span></div>
          <div class="wc-pied"><span>${String(c.numero).padStart(2, '0')}/${total}</span><span class="wc-emb">${esc(col.emoji || '')}</span><span class="wc-rar">${esc(r.nom)}</span></div>
        </div>
        <div class="wc-brillance"></div>
      </div>`;
  }

  // La Secret Wave dans l'aperçu : on voit qu'elle existe, pas ce qu'elle est.
  function carteSecreteHtml(c, col, total){

    const r = rarete('secret_wave');

    return `
      <div class="wc-carte secrete" data-rar="secret_wave" style="${styleCol(col)}--rc:${r.couleur};">
        <div class="wc-cadre">
          <div class="wc-cover"></div>
          <div class="wc-bas"><b>Carte secrète</b><span>Artiste inconnu</span></div>
          <div class="wc-pied"><span>${String(c.numero).padStart(2, '0')}/${total}</span><span class="wc-emb"></span><span class="wc-rar">${esc(r.nom)}</span></div>
          <div class="wc-point">?</div>
        </div>
      </div>`;
  }

  // ---------------------------------------------------------------------
  // Les appels au serveur
  // ---------------------------------------------------------------------

  async function lireBoutique(){

    const { data, error } = await BD.boutiqueListe();

    if(error || !data){
      const absent = error && (error.code === 'PGRST202' || error.code === '42883'
        || /could not find the function|does not exist/i.test(error.message || ''));
      throw new Error(absent ? 'La boutique arrive bientôt.' : "La boutique n'a pas pu se charger. Réessaie dans un instant.");
    }

    boutique = data;
    return data;
  }

  async function lireClasseur(id, force){

    if(classeurs[id] && !force) return classeurs[id];

    const { data, error } = await BD.classeurCollection(id);
    if(error || !data) throw new Error("Le classeur n'a pas pu se charger.");

    classeurs[id] = data;
    return data;
  }

  async function lireApercu(id){

    if(apercus[id]) return apercus[id];

    const { data, error } = await BD.boosterApercu(id);
    if(error || !data) throw new Error("L'aperçu n'a pas pu se charger.");

    apercus[id] = data;
    return data;
  }

  const collections = () => (boutique && boutique.collections) || [];

  // ---------------------------------------------------------------------
  // La boutique
  // ---------------------------------------------------------------------

  function tempsRestant(c){

    if(c.statut === 'a_venir'){
      return 'Dès le ' + new Date(c.debut).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
    }
    if(c.statut === 'termine') return 'Vente terminée';

    const ms = new Date(c.fin).getTime() - Date.now();
    const jours = Math.floor(ms / 86400000);
    if(jours >= 2) return 'Encore ' + jours + ' jours';
    return ms > 86400000 ? 'Dernier jour' : 'Dernières heures';
  }

  function boosterHtml(c){

    const enVente = c.statut === 'en_cours' && c.nb_cartes > 0;
    const manque = enVente && boutique.wc < c.prix_wc;
    const pct = c.nb_cartes ? Math.round((c.possedees / c.nb_cartes) * 100) : 0;

    return `
      <article class="bq-booster${c.statut === 'a_venir' ? ' bientot' : ''}${c.statut === 'termine' ? ' termine' : ''}" style="${styleCol(c)}">
        ${packHtml(c, { balise: 'button', attrs: `data-bq-apercu="${attr(c.id)}" aria-label="Voir les cartes du ${attr(c.nom)}"` })}
        <div class="bq-infos">
          <h3>${esc(c.nom)}</h3>
          <p>${esc(c.description)}</p>
          <ul class="bq-meta">
            <li><b>${c.nb_cartes}</b> cartes</li>
            <li><b>${c.cartes_par_coffre}</b> par booster</li>
            <li>${tempsRestant(c)}</li>
          </ul>
          <button type="button" class="bq-lien" data-bq-apercu="${attr(c.id)}">Voir les cartes du booster</button>
          <div>
            <div class="bq-progres"><span style="width:${pct}%"></span></div>
            <div class="bq-progres-txt"><span>Ma collection</span><span>${c.possedees} / ${c.nb_cartes}</span></div>
          </div>
          <div class="bq-actions">
            ${enVente ? `<button type="button" class="bq-btn${c.coffres > 0 ? '' : ' plein'}" data-bq-acheter="${attr(c.id)}" ${manque || occupe ? 'disabled' : ''}>Acheter · ${nf(c.prix_wc)} WC</button>` : ''}
            ${c.coffres > 0 ? `<button type="button" class="bq-btn plein" data-bq-ouvrir="${attr(c.id)}">Ouvrir un booster (${c.coffres})</button>` : ''}
            ${c.possedees > 0 ? `<button type="button" class="bq-btn" data-bq-classeur="${attr(c.id)}">Mon classeur</button>` : ''}
          </div>
          ${manque ? `<p class="bq-note">Il te manque ${nf(c.prix_wc - boutique.wc)} WC : gagne de l'XP ou relève un défi spécial.</p>` : ''}
        </div>
      </article>`;
  }

  function defisHtml(){

    const defis = boutique.defis || [];
    if(!defis.length) return '';

    const j = boutique.jours_restants;

    return `
      <section class="bq-defis">
        <h3>Défis spéciaux <small>${j === 0 ? 'Dernier jour' : 'Renouvelés dans ' + j + ' jour' + (j > 1 ? 's' : '')}</small></h3>
        <p>Ils rapportent des WC, et rien que des WC. Tu gagnes aussi 1 WC pour chaque point d'XP.</p>
        ${defis.map(d => `
          <div class="bq-defi${d.faite ? ' faite' : ''}">
            <span class="coche">✓</span>
            <span class="tx">${esc(d.libelle)}</span>
            <span class="gain">${d.faite ? '' : d.progres + '/' + d.objectif + ' · '}+${d.wc} WC</span>
          </div>`).join('')}
      </section>`;
  }

  function boostersHtml(){

    // Les boosters terminés n'apparaissent que si l'on en a encore à ouvrir.
    const liste = collections().filter(c => c.statut !== 'termine' || c.coffres > 0);

    return `
      <div class="bq-liste">${liste.map(boosterHtml).join('') || '<div class="bq-vide">Aucun booster en vente pour le moment.</div>'}</div>
      ${defisHtml()}`;
  }

  // ---------------------------------------------------------------------
  // L'aperçu d'un booster : toutes les cartes, la Secret Wave floue
  // ---------------------------------------------------------------------

  async function apercuBooster(id){

    poserFeuille();

    const voile = document.createElement('div');
    voile.className = 'bq-voile';
    voile.innerHTML = '<div class="bq-ap"><div class="bq-vide">Chargement…</div></div>';
    document.body.appendChild(voile);

    const fermer = () => {
      document.removeEventListener('keydown', touche);
      voile.classList.add('sortie');
      setTimeout(() => voile.remove(), 280);
    };
    const touche = (e) => { if(e.key === 'Escape') fermer(); };

    document.addEventListener('keydown', touche);
    voile.addEventListener('click', (e) => { if(e.target === voile) fermer(); });

    try{

      const ap = await lireApercu(id);

      // Les chances d'obtenir chaque rareté pour une carte (la dernière carte d'un booster est au moins « peu commune »).
      const presentes = RARETES.filter(r => ap.cartes.some(c => c.rarete === r.cle));
      const poidsTotal = presentes.reduce((s, r) => s + r.poids, 0);

      const legende = presentes.map(r => {
        const n = ap.cartes.filter(c => c.rarete === r.cle).length;
        const p = (r.poids / poidsTotal) * 100;
        return `<li style="--rc:${r.couleur}"><i></i><b>${esc(r.nom)}</b> ${n} carte${n > 1 ? 's' : ''} · ${p < 1 ? p.toFixed(1).replace('.', ',') : Math.round(p)} %</li>`;
      }).join('');

      const grille = ap.cartes.map(c => c.secret ? carteSecreteHtml(c, ap, ap.total) : carteHtml(c, ap, ap.total)).join('');

      voile.querySelector('.bq-ap').innerHTML = `
        <div class="bq-ap-tete">
          <div><h3>${esc(ap.emoji)} ${esc(ap.nom)}</h3><p>${ap.total} cartes dans ce booster. La carte Secret Wave reste cachée jusqu'à ce que tu la tires.</p></div>
          <button type="button" class="bq-fermer" aria-label="Fermer">✕</button>
        </div>
        <ul class="bq-legende">${legende}</ul>
        <div class="bq-ap-grille">${grille}</div>`;

      voile.querySelector('.bq-fermer').addEventListener('click', fermer);

    }catch(erreur){
      voile.querySelector('.bq-ap').innerHTML = `<div class="bq-vide">${esc(erreur.message)}</div>`;
    }
  }

  // ---------------------------------------------------------------------
  // Le classeur : une page à la fois, qu'on tourne
  // ---------------------------------------------------------------------

  function classeurHtml(){

    const dispo = collections().filter(c => c.nb_cartes > 0 && (c.possedees > 0 || c.statut === 'en_cours'));

    if(!dispo.length) return `<div class="bq-vide">Ton classeur est vide pour l'instant. Ouvre un booster pour commencer ta collection.</div>`;

    if(!colChoisie || !dispo.some(c => c.id === colChoisie)) colChoisie = dispo[0].id;

    const choix = dispo.length > 1 ? `<div class="bq-choix">${dispo.map(c => `
      <button type="button" class="bq-puce${c.id === colChoisie ? ' actif' : ''}" data-bq-col="${attr(c.id)}">${esc(c.emoji)} ${esc(c.nom.replace(/^Booster /, ''))}</button>`).join('')}</div>` : '';

    return `${choix}<div id="bqClasseur"><div class="bq-vide">Chargement…</div></div>`;
  }

  function couleurDe(cle){
    return rarete(cle).couleur;
  }

  function feuilleHtml(cl, page){

    const debut = page * PAR_PAGE;
    const morceau = cl.cartes.slice(debut, debut + PAR_PAGE);

    const cases = morceau.map((c, k) => {

      const i = debut + k;

      if(!c.possedee){
        const secret = !c.rarete;
        return `<div class="bq-vide-case${secret ? ' secret' : ''}" ${c.rarete ? `style="--rc:${couleurDe(c.rarete)}"` : ''}><b>${c.numero}</b>${secret ? '<span style="position:absolute;bottom:8px;font-size:16px">?</span>' : '<i></i>'}</div>`;
      }

      return `
        <button type="button" class="bq-case" data-bq-carte="${i}" aria-label="${attr(c.titre + ' — ' + c.artiste)}">
          ${c.quantite > 1 ? `<span class="bq-quantite">×${c.quantite}</span>` : ''}
          ${carteHtml(c, cl, cl.total)}
        </button>`;
    });

    while(cases.length < PAR_PAGE) cases.push('<div class="bq-cellule-vide"></div>');

    return cases.join('');
  }

  async function remplirClasseur(){

    const zone = hote && hote.querySelector('#bqClasseur');
    if(!zone || !colChoisie) return;

    const voulue = colChoisie;

    try{

      const cl = await lireClasseur(voulue);
      if(colChoisie !== voulue || !hote.contains(zone)) return;

      const nb = Math.max(1, Math.ceil(cl.total / PAR_PAGE));
      const page = Math.min(pages[voulue] || 0, nb - 1);
      pages[voulue] = page;

      const pct = cl.total ? Math.round((cl.possedees / cl.total) * 100) : 0;

      zone.innerHTML = `
        <div class="bq-livre" style="${styleCol(cl)}">
          <div class="bq-livre-tete"><h3>${esc(cl.emoji)} ${esc(cl.nom)}</h3><span>${cl.possedees} / ${cl.total} cartes</span></div>
          <div class="bq-progres"><span style="width:${pct}%"></span></div>
          <div class="bq-livre-corps">
            <button type="button" class="bq-tourne" data-bq-page="-1" aria-label="Page précédente" ${page === 0 ? 'disabled' : ''}>‹</button>
            <div class="bq-reliure" tabindex="0" aria-label="Classeur, page ${page + 1} sur ${nb}">
              <div class="bq-zone"><div class="bq-feuille">${feuilleHtml(cl, page)}</div></div>
            </div>
            <button type="button" class="bq-tourne" data-bq-page="1" aria-label="Page suivante" ${page >= nb - 1 ? 'disabled' : ''}>›</button>
          </div>
          <div class="bq-livre-pied">
            <span class="bq-numero-page">Page ${page + 1} / ${nb}</span>
            ${nb > 1 ? `<span class="bq-points">${Array.from({ length: nb }, (_, k) => `<button type="button" class="bq-point${k === page ? ' actif' : ''}" data-bq-aller="${k}" aria-label="Page ${k + 1}"></button>`).join('')}</span>` : ''}
          </div>
        </div>`;

      brancherGlisse(zone.querySelector('.bq-reliure'));

    }catch(erreur){
      zone.innerHTML = `<div class="bq-vide">${esc(erreur.message)}</div>`;
    }
  }

  // Va à la page demandée : l'ancienne se soulève et se tourne comme une feuille de classeur.
  function allerPage(cible){

    const cl = classeurs[colChoisie];
    if(!cl || tourne) return;

    const nb = Math.max(1, Math.ceil(cl.total / PAR_PAGE));
    cible = Math.max(0, Math.min(nb - 1, cible));

    const actuelle = pages[colChoisie] || 0;
    if(cible === actuelle) return;

    const zone = hote.querySelector('.bq-zone');
    const ancienne = zone && zone.querySelector('.bq-feuille');
    if(!ancienne) return;

    const avant = cible > actuelle;
    const nouvelle = document.createElement('div');
    nouvelle.className = 'bq-feuille';
    nouvelle.innerHTML = feuilleHtml(cl, cible);

    pages[colChoisie] = cible;
    tourne = true;

    // Le pied et les flèches se mettent à jour tout de suite.
    const pied = hote.querySelector('.bq-numero-page');
    if(pied) pied.textContent = 'Page ' + (cible + 1) + ' / ' + nb;
    hote.querySelectorAll('.bq-point').forEach((p, k) => p.classList.toggle('actif', k === cible));
    const prec = hote.querySelector('[data-bq-page="-1"]');
    const suiv = hote.querySelector('[data-bq-page="1"]');
    if(prec) prec.disabled = cible === 0;
    if(suiv) suiv.disabled = cible >= nb - 1;

    let termine = false;
    const fini = () => {
      if(termine) return;
      termine = true;
      ancienne.remove();
      nouvelle.style.zIndex = '';
      tourne = false;
    };

    // Filet de sécurité : un onglet en arrière-plan peut suspendre l'animation sans jamais la finir.
    setTimeout(fini, 900);

    if(!zone.animate || window.matchMedia('(prefers-reduced-motion: reduce)').matches){
      zone.appendChild(nouvelle);
      fini();
      return;
    }

    if(avant){
      // La page actuelle se tourne vers la gauche et laisse voir la suivante, dessous.
      zone.insertBefore(nouvelle, ancienne);
      ancienne.style.zIndex = 2;
      ancienne.animate([
        { transform: 'rotateY(0deg)', opacity: 1, filter: 'brightness(1)' },
        { transform: 'rotateY(-95deg)', opacity: 0.2, filter: 'brightness(.6)', offset: .85 },
        { transform: 'rotateY(-110deg)', opacity: 0, filter: 'brightness(.5)' }
      ], { duration: 650, easing: 'cubic-bezier(.45,.05,.3,1)' }).onfinish = fini;
    }else{
      // On revient en arrière : la page précédente se rabat par-dessus.
      zone.appendChild(nouvelle);
      nouvelle.style.zIndex = 2;
      nouvelle.animate([
        { transform: 'rotateY(-110deg)', opacity: 0, filter: 'brightness(.5)' },
        { transform: 'rotateY(-95deg)', opacity: 0.2, filter: 'brightness(.6)', offset: .15 },
        { transform: 'rotateY(0deg)', opacity: 1, filter: 'brightness(1)' }
      ], { duration: 650, easing: 'cubic-bezier(.45,.05,.3,1)' }).onfinish = fini;
    }
  }

  // Au doigt : glisser vers la gauche tourne la page, vers la droite revient en arrière. Aux flèches du clavier aussi.
  function brancherGlisse(el){

    if(!el) return;

    let x0 = null;

    el.addEventListener('pointerdown', (e) => { x0 = e.clientX; });
    el.addEventListener('pointerup', (e) => {
      if(x0 === null) return;
      const dx = e.clientX - x0;
      x0 = null;
      if(Math.abs(dx) > 50) allerPage((pages[colChoisie] || 0) + (dx < 0 ? 1 : -1));
    });
    el.addEventListener('pointercancel', () => { x0 = null; });
    el.addEventListener('keydown', (e) => {
      if(e.key === 'ArrowRight') allerPage((pages[colChoisie] || 0) + 1);
      else if(e.key === 'ArrowLeft') allerPage((pages[colChoisie] || 0) - 1);
    });
  }

  // Une carte du classeur, en grand : elle suit le pointeur.
  function apercuCarte(i){

    const cl = classeurs[colChoisie];
    const c = cl && cl.cartes[i];
    if(!c) return;

    poserFeuille();

    const voile = document.createElement('div');
    voile.className = 'bq-voile';
    voile.style.alignItems = 'center';
    voile.innerHTML = `<div class="bq-carte-grande">${carteHtml(c, cl, cl.total)}</div>`;

    const carte = voile.querySelector('.bq-carte-grande');

    voile.addEventListener('pointermove', (e) => {
      const r = carte.getBoundingClientRect();
      carte.style.setProperty('--ry', (((e.clientX - r.left) / r.width - 0.5) * 20) + 'deg');
      carte.style.setProperty('--rx', ((-((e.clientY - r.top) / r.height - 0.5)) * 20) + 'deg');
    });

    const fermer = () => { voile.remove(); document.removeEventListener('keydown', touche); };
    const touche = (e) => { if(e.key === 'Escape') fermer(); };

    voile.addEventListener('click', (e) => { if(!carte.contains(e.target)) fermer(); });
    document.addEventListener('keydown', touche);
    document.body.appendChild(voile);
  }

  // ---------------------------------------------------------------------
  // L'affichage
  // ---------------------------------------------------------------------

  function dessiner(){

    if(!hote || !boutique) return;

    hote.innerHTML = `
      <div class="bq">
        <div class="bq-tete">
          <div>
            <h2>Boutique</h2>
            <p>Ouvre des boosters avec tes Waves Coins et collectionne les cartes des sorties du catalogue.</p>
          </div>
          <div class="bq-wc" title="Waves Coins"><span class="bq-piece">WC</span><b>${nf(boutique.wc)}</b></div>
        </div>
        <div class="bq-onglets" role="tablist">
          <button type="button" class="bq-onglet${onglet === 'boosters' ? ' actif' : ''}" data-bq-onglet="boosters" role="tab">Boosters</button>
          <button type="button" class="bq-onglet${onglet === 'classeurs' ? ' actif' : ''}" data-bq-onglet="classeurs" role="tab">Classeurs</button>
        </div>
        ${onglet === 'boosters' ? boostersHtml() : classeurHtml()}
      </div>`;

    if(onglet === 'classeurs') remplirClasseur();
  }

  async function actualiser(){

    try{
      await lireBoutique();
      dessiner();
    }catch(erreur){
      if(hote) hote.innerHTML = `<div class="bq-vide">${esc(erreur.message)}</div>`;
    }
  }

  // ---------------------------------------------------------------------
  // Acheter
  // ---------------------------------------------------------------------

  async function acheter(id){

    if(occupe) return;

    const c = collections().find(x => x.id === id);
    if(!c) return;

    occupe = true;
    dessiner();

    try{
      const { data, error } = await BD.coffreAcheter(id, 1);
      if(error) throw new Error(error.message);

      boutique.wc = data.solde;
      c.coffres = data.coffres;

      notifier('Booster acheté', {
        type: 'succes', icone: c.emoji, detail: c.nom + ' · −' + c.prix_wc + ' WC', duree: 6000,
        actions: [{ label: 'Ouvrir maintenant', primaire: true, action: () => ouvrir(id) }]
      });

    }catch(erreur){
      notifier('Achat impossible', { type: 'erreur', detail: erreur.message });
    }

    occupe = false;
    dessiner();
  }

  // ---------------------------------------------------------------------
  // Ouvrir un booster : on le déchire, puis les cartes arrivent une par une
  // ---------------------------------------------------------------------

  function ouvrir(id){

    const col = collections().find(x => x.id === id);

    if(!col || col.coffres < 1){
      notifier('Aucun booster à ouvrir', { type: 'info', icone: '📦', detail: 'Achètes-en un dans la boutique.' });
      return;
    }

    poserFeuille();

    const fond = document.createElement('div');
    fond.className = 'bq-ouv';
    fond.setAttribute('role', 'dialog');
    fond.setAttribute('aria-modal', 'true');
    fond.style.cssText = styleCol(col);

    let actif = true;

    const fermer = () => {
      if(!actif) return;
      actif = false;
      document.removeEventListener('keydown', touche);
      fond.classList.add('sortie');
      setTimeout(() => fond.remove(), 300);
      // Le solde, les stocks et les classeurs ont changé : on relit tout.
      delete classeurs[id];
      actualiser();
    };

    let suite = null;   // ce que fait Entrée / Espace / flèche droite à cet instant

    const touche = (e) => {
      if(e.key === 'Escape') fermer();
      else if((e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowRight') && suite){ e.preventDefault(); suite(); }
    };
    document.addEventListener('keydown', touche);

    const pause = (ms) => new Promise(r => setTimeout(r, ms));

    const eclair = () => {
      const e = document.createElement('div');
      e.className = 'bq-eclair';
      document.body.appendChild(e);
      setTimeout(() => e.remove(), 700);
    };

    // --- Le paquet, fermé ---
    const scene = (reste) => {

      fond.innerHTML = `
        <button type="button" class="bq-fermer" aria-label="Fermer">✕</button>
        <div class="bq-scene">
          <div class="bq-pack-ouv attend" data-bq-paquet>${packHtml(col, { grand: true })}</div>
          <h2>${esc(col.nom)}</h2>
          <p data-bq-aide>Touche le booster pour le déchirer · ${reste} en stock</p>
        </div>`;

      fond.querySelector('.bq-fermer').addEventListener('click', fermer);

      const paquet = fond.querySelector('[data-bq-paquet]');
      let enCours = false;

      const tirer = async () => {

        if(enCours) return;
        enCours = true;
        suite = null;

        paquet.className = 'bq-pack-ouv secoue';
        fond.querySelector('[data-bq-aide]').textContent = '';

        try{

          const [{ data, error }] = await Promise.all([BD.coffreOuvrir(id), pause(1400)]);
          if(error) throw new Error(error.message);

          paquet.className = 'bq-pack-ouv arrache';
          eclair();
          await pause(750);

          col.coffres = data.restants;
          defiler(data);

        }catch(erreur){
          notifier('Ouverture impossible', { type: 'erreur', detail: erreur.message });
          fermer();
        }
      };

      paquet.addEventListener('click', tirer);
      suite = tirer;
    };

    // --- Les cartes, une par une : la plus commune d'abord, la plus rare pour la fin ---
    const defiler = (data) => {

      const cartes = data.cartes.slice().sort((a, b) => ordreRarete(a.rarete) - ordreRarete(b.rarete));
      const total = data.total;
      let i = 0;
      const vues = [];

      const montrer = () => {

        const c = cartes[i];
        const r = rarete(c.rarete);

        fond.innerHTML = `
          <button type="button" class="bq-fermer" aria-label="Fermer">✕</button>
          <div class="bq-defile">
            <div class="bq-compteur">Carte ${i + 1} sur ${cartes.length}</div>
            <div class="bq-table" style="--hc:${r.couleur}">
              <div class="bq-halo"></div>
              <div class="bq-flip entre" data-bq-carte-flip>
                <span class="bq-etiquette${c.nouvelle ? '' : ' double'}">${c.nouvelle ? 'Nouvelle' : 'Double ×' + c.quantite}</span>
                <div class="bq-flip-in">
                  <div class="bq-dos">${esc(col.emoji || '🎴')}<small>La Wave</small></div>
                  <div class="bq-face">${carteHtml(c, col, total)}</div>
                </div>
              </div>
            </div>
            <div class="bq-annonce" data-bq-annonce>Touche la carte pour la retourner</div>
            <div class="bq-defausse">${vues.map(v => `<span class="mini" style="--rc:${rarete(v.rarete).couleur}"><img src="${attr(safeUrl(v.cover_url))}" alt=""></span>`).join('')}</div>
            <div class="bq-bas" data-bq-bas></div>
          </div>`;

        fond.querySelector('.bq-fermer').addEventListener('click', fermer);

        const flip = fond.querySelector('[data-bq-carte-flip]');
        const annonce = fond.querySelector('[data-bq-annonce]');
        const bas = fond.querySelector('[data-bq-bas]');
        let retournee = false;

        const suivante = () => {
          flip.classList.add('sort');
          suite = null;
          vues.push(c);
          setTimeout(() => {
            i++;
            if(i < cartes.length) montrer(); else resume();
          }, 420);
        };

        const retourner = () => {

          if(retournee){ suivante(); return; }

          retournee = true;
          flip.classList.add('retournee');
          flip.classList.remove('entre');

          if(ordreRarete(c.rarete) >= 2) fond.querySelector('.bq-halo').classList.add('on');

          const mots = { rare: 'Rare !', ultra_rare: 'Ultra rare !', legendaire: 'Légendaire !', secret_wave: 'SECRET WAVE ! Une carte introuvable ailleurs.' };
          annonce.textContent = mots[c.rarete] || (c.nouvelle ? 'Nouvelle carte pour ton classeur' : "Tu l'avais déjà");

          if(c.rarete === 'legendaire' || c.rarete === 'secret_wave') eclair();

          bas.innerHTML = `<button type="button" class="bq-btn plein">${i < cartes.length - 1 ? 'Carte suivante' : 'Terminer'}</button>`;
          bas.querySelector('button').addEventListener('click', (e) => { e.stopPropagation(); suivante(); });
        };

        flip.addEventListener('click', retourner);
        suite = retourner;
      };

      const resume = () => {

        const nouvelles = cartes.filter(c => c.nouvelle).length;
        suite = null;

        fond.innerHTML = `
          <button type="button" class="bq-fermer" aria-label="Fermer">✕</button>
          <div class="bq-scene">
            <h2>${esc(col.nom)}</h2>
            <p>${nouvelles} nouvelle${nouvelles > 1 ? 's' : ''} carte${nouvelles > 1 ? 's' : ''} dans ton classeur</p>
          </div>
          <div class="bq-resume">${cartes.map(c => carteHtml(c, col, total)).join('')}</div>
          <div class="bq-bas">
            ${data.restants > 0 ? `<button type="button" class="bq-btn plein" data-bq-encore>Ouvrir un autre booster (${data.restants})</button>` : ''}
            <button type="button" class="bq-btn" data-bq-voir>Voir mon classeur</button>
            <button type="button" class="bq-btn" data-bq-fin>Fermer</button>
          </div>`;

        fond.querySelector('.bq-fermer').addEventListener('click', fermer);
        fond.querySelector('[data-bq-fin]').addEventListener('click', fermer);
        fond.querySelector('[data-bq-voir]').addEventListener('click', () => { onglet = 'classeurs'; colChoisie = id; fermer(); });

        const encore = fond.querySelector('[data-bq-encore]');
        if(encore) encore.addEventListener('click', () => scene(data.restants));
      };

      montrer();
    };

    document.body.appendChild(fond);
    scene(col.coffres);
  }

  // ---------------------------------------------------------------------
  // Les clics
  // ---------------------------------------------------------------------

  function brancher(){

    if(hote.__bqBranche) return;
    hote.__bqBranche = true;

    hote.addEventListener('click', (ev) => {

      const cible = ev.target.closest && ev.target.closest('[data-bq-onglet], [data-bq-acheter], [data-bq-ouvrir], [data-bq-classeur], [data-bq-col], [data-bq-carte], [data-bq-apercu], [data-bq-page], [data-bq-aller]');
      if(!cible) return;

      const d = cible.dataset;

      if(d.bqOnglet){ onglet = d.bqOnglet; dessiner(); }
      else if(d.bqAcheter){ acheter(d.bqAcheter); }
      else if(d.bqOuvrir){ ouvrir(d.bqOuvrir); }
      else if(d.bqApercu){ apercuBooster(d.bqApercu); }
      else if(d.bqClasseur){ onglet = 'classeurs'; colChoisie = d.bqClasseur; dessiner(); }
      else if(d.bqCol){ colChoisie = d.bqCol; dessiner(); }
      else if(d.bqCarte !== undefined){ apercuCarte(Number(d.bqCarte)); }
      else if(d.bqPage){ allerPage((pages[colChoisie] || 0) + Number(d.bqPage)); }
      else if(d.bqAller !== undefined){ allerPage(Number(d.bqAller)); }
    });
  }

  // La communauté pose la boutique dans son emplacement et la relit à chaque visite.
  async function monter(emplacement){

    poserFeuille();

    hote = emplacement;
    brancher();

    if(!boutique) hote.innerHTML = '<div class="bq-vide">Chargement…</div>';

    await actualiser();
  }

  // ---------------------------------------------------------------------
  // L'espace équipe : composer les boosters, en créer d'autres
  // ---------------------------------------------------------------------

  const EQ = { el: null, liste: [], choisi: null, resultats: [], minuteur: null };

  const versLocal = (iso) => {
    const d = new Date(iso);
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
  };

  const nouveauBooster = () => {
    const debut = new Date();
    const fin = new Date(Date.now() + 30 * 86400000);
    return {
      id: null, nom: '', emoji: '🎴', description: '', couleurs: { a: '#4fb4ff', b: '#7a2cff', c: '#0b0d12' },
      visuel_url: '', actif: true, prix_wc: 150, cartes_par_coffre: 5, debut: debut.toISOString(), fin: fin.toISOString(), cartes: []
    };
  };

  function messageEquipe(texte, type){
    const m = EQ.el && EQ.el.querySelector('[data-bqa-msg]');
    if(!m) return;
    m.textContent = texte || '';
    m.className = 'form-msg ' + (type || '');
  }

  async function equipeCharger(garder){

    const { data, error } = await BD.boosterEquipeListe();

    if(error){
      const absent = /could not find the function|does not exist/i.test(error.message || '');
      EQ.el.innerHTML = `<div class="empty-state">${esc(absent ? "Le SQL des boosters n'est pas encore passé (sql/boosters.sql)." : error.message)}</div>`;
      return;
    }

    EQ.liste = data || [];

    if(!garder || !EQ.choisi || (EQ.choisi !== 'nouveau' && !EQ.liste.some(b => b.id === EQ.choisi))){
      EQ.choisi = EQ.liste.length ? EQ.liste[0].id : 'nouveau';
    }

    equipeDessiner();
  }

  function equipeDessiner(){

    const el = EQ.el;
    if(!el) return;

    const courant = EQ.choisi === 'nouveau' ? nouveauBooster() : EQ.liste.find(b => b.id === EQ.choisi);

    const vignettes = EQ.liste.map(b => `
      <button type="button" class="bqa-carte${b.id === EQ.choisi ? ' actif' : ''}" data-bqa-choisir="${attr(b.id)}">
        <span class="vignette" style="${b.visuel_url ? `background-image:url('${attr(safeUrl(b.visuel_url))}')` : ''}">${b.visuel_url ? '' : esc(b.emoji)}</span>
        <span><b>${esc(b.nom)}</b><small>${b.cartes.length} carte${b.cartes.length > 1 ? 's' : ''} · ${b.prix_wc} WC${b.actif ? '' : ' · désactivé'}</small></span>
      </button>`).join('');

    el.innerHTML = `
      <div class="bqa">
        <div class="bqa-liste">
          ${vignettes}
          <button type="button" class="bqa-carte${EQ.choisi === 'nouveau' ? ' actif' : ''}" data-bqa-choisir="nouveau">
            <span class="vignette">＋</span><span><b>Nouveau booster</b><small>Créer un booster à composer</small></span>
          </button>
        </div>
        <div class="form-msg" data-bqa-msg></div>
        ${courant ? equipeFormulaire(courant) : ''}
        ${courant && courant.id ? equipeCartes(courant) : (courant ? '<p class="desc">Enregistre le booster, puis ajoute-lui des cartes.</p>' : '')}
      </div>`;
  }

  function equipeFormulaire(b){

    const c = couleursDe(b);

    return `
      <form class="bqa-form" data-bqa-form onsubmit="return false">
        <label>Nom<input type="text" name="nom" value="${attr(b.nom)}" maxlength="60" placeholder="Booster Halloween"></label>
        <label>Emblème (emoji)<input type="text" name="emoji" value="${attr(b.emoji)}" maxlength="4"></label>
        <label class="large">Description<textarea name="description" maxlength="300">${esc(b.description)}</textarea></label>
        <label>Couleur 1<input type="color" name="a" value="${attr(c.a)}"></label>
        <label>Couleur 2<input type="color" name="b" value="${attr(c.b)}"></label>
        <label>Fond des cartes<input type="color" name="c" value="${attr(c.c)}"></label>
        <label>Prix (WC)<input type="number" name="prix" min="1" max="100000" value="${b.prix_wc}"></label>
        <label>Cartes par booster<input type="number" name="par" min="1" max="12" value="${b.cartes_par_coffre}"></label>
        <label>Début de la vente<input type="datetime-local" name="debut" value="${versLocal(b.debut)}"></label>
        <label>Fin de la vente<input type="datetime-local" name="fin" value="${versLocal(b.fin)}"></label>
        <label class="large">Image du booster (adresse https://… ; astuce : « Pochette du booster » sur une sortie ci-dessous)
          <input type="url" name="visuel" value="${attr(b.visuel_url || '')}" placeholder="https://…">
        </label>
        <div class="large bqa-apercu-visuel">
          ${packHtml(b, { largeur: '64px' })}
          <label class="case"><input type="checkbox" name="actif" ${b.actif ? 'checked' : ''}> Visible dans la boutique</label>
        </div>
        <div class="bqa-actions">
          <button type="button" class="btn btn-primary" data-bqa-sauver>${b.id ? 'Enregistrer' : 'Créer le booster'}</button>
          ${b.id ? `<button type="button" class="btn btn-ghost" data-bqa-supprimer>Supprimer le booster</button>` : ''}
          ${b.id && b.detenteurs ? `<span class="mono" style="color:var(--muted);font-size:12px">${b.detenteurs} membre${b.detenteurs > 1 ? 's ont' : ' a'} des cartes</span>` : ''}
        </div>
      </form>`;
  }

  function equipeCartes(b){

    const parRarete = RARETES.map(r => ({ r, n: b.cartes.filter(c => c.rarete === r.cle).length })).filter(x => x.n);

    const lignes = b.cartes.map(c => `
      <div class="bqa-ligne">
        <span class="num">${c.numero}</span>
        <img src="${attr(safeUrl(c.cover_url))}" alt="" loading="lazy">
        <div class="tx"><b>${esc(c.titre)}</b><span>${esc(c.artiste)}${c.type_sortie ? ' · ' + esc(c.type_sortie) : ''}</span></div>
        <select data-bqa-rarete="${c.id}" aria-label="Rareté">${RARETES.map(r => `<option value="${r.cle}"${r.cle === c.rarete ? ' selected' : ''}>${esc(r.nom)}</option>`).join('')}</select>
        <button type="button" class="btn btn-ghost" data-bqa-retirer="${c.id}" title="Retirer du booster">✕</button>
      </div>`).join('');

    return `
      <div class="bqa-cartes">
        <h4>Cartes du booster <span class="mono" style="color:var(--muted)">${b.cartes.length}</span></h4>
        <div class="bqa-resume">${parRarete.map(x => `<span class="p" style="--rc:${x.r.couleur}">${esc(x.r.nom)} · ${x.n}</span>`).join('') || '<span class="desc">Aucune carte pour l\'instant.</span>'}</div>
        ${lignes}
      </div>
      <div class="bqa-ajout">
        <h4>Ajouter une sortie du catalogue</h4>
        <div class="eq-outils">
          <input type="text" data-bqa-recherche autocomplete="off" placeholder="Chercher un titre ou un artiste du catalogue">
          <select data-bqa-rarete-defaut aria-label="Rareté des cartes ajoutées">${RARETES.map(r => `<option value="${r.cle}">${esc(r.nom)}</option>`).join('')}</select>
        </div>
        <div data-bqa-resultats style="margin-top:12px"></div>
      </div>`;
  }

  function equipeResultats(){

    const zone = EQ.el && EQ.el.querySelector('[data-bqa-resultats]');
    const b = EQ.liste.find(x => x.id === EQ.choisi);
    if(!zone || !b) return;

    const dedans = new Set(b.cartes.map(c => c.release_id));

    if(!EQ.resultats.length){
      const q = EQ.el.querySelector('[data-bqa-recherche]');
      zone.innerHTML = q && q.value.trim() ? '<div class="empty-state">Aucune sortie trouvée.</div>' : '';
      return;
    }

    zone.innerHTML = EQ.resultats.map(s => `
      <div class="bqa-ligne">
        <img src="${attr(safeUrl(s.cover_url))}" alt="" loading="lazy">
        <div class="tx"><b>${esc(s.track_title)}</b><span>${esc(s.artist_name)}${s.release_date ? ' · ' + esc(String(s.release_date).slice(0, 4)) : ''}</span></div>
        <button type="button" class="btn btn-ghost" data-bqa-pochette="${attr(s.id)}" title="Utiliser cette pochette comme image du booster">Pochette du booster</button>
        ${dedans.has(s.id)
          ? '<span class="mono" style="color:var(--muted);font-size:12px">Déjà dedans</span>'
          : `<button type="button" class="btn btn-primary" data-bqa-ajouter="${attr(s.id)}">Ajouter</button>`}
      </div>`).join('');
  }

  function lireFormulaire(){

    const f = EQ.el.querySelector('[data-bqa-form]');
    const v = (n) => f.elements[n].value;

    return {
      p_id: EQ.choisi === 'nouveau' ? null : EQ.choisi,
      p_nom: v('nom'), p_emoji: v('emoji'), p_description: v('description'),
      p_couleurs: { a: v('a'), b: v('b'), c: v('c') },
      p_debut: new Date(v('debut')).toISOString(), p_fin: new Date(v('fin')).toISOString(),
      p_prix: Number(v('prix')), p_par_coffre: Number(v('par')), p_visuel: v('visuel'), p_actif: f.elements.actif.checked
    };
  }

  async function equipeAction(fn, ok){

    try{
      const r = await fn();
      if(r && r.error) throw new Error(r.error.message);
      if(ok) messageEquipe(ok, 'ok');
      return r;
    }catch(erreur){
      messageEquipe(erreur.message, 'err');
      return null;
    }
  }

  function equipeBrancher(){

    const el = EQ.el;
    if(el.__bqaBranche) return;
    el.__bqaBranche = true;

    el.addEventListener('click', async (ev) => {

      const cible = ev.target.closest && ev.target.closest('[data-bqa-choisir], [data-bqa-sauver], [data-bqa-supprimer], [data-bqa-retirer], [data-bqa-ajouter], [data-bqa-pochette]');
      if(!cible) return;

      const d = cible.dataset;

      if(d.bqaChoisir){
        EQ.choisi = d.bqaChoisir;
        EQ.resultats = [];
        equipeDessiner();
      }
      else if(d.bqaSauver !== undefined){
        const r = await equipeAction(() => BD.boosterEquipeSauver(lireFormulaire()));
        if(r){
          EQ.choisi = r.data;
          await equipeCharger(true);
          messageEquipe('Booster enregistré.', 'ok');
        }
      }
      else if(d.bqaSupprimer !== undefined){
        const b = EQ.liste.find(x => x.id === EQ.choisi);
        if(!b || !confirm('Supprimer « ' + b.nom + ' » et ses ' + b.cartes.length + ' cartes ?')) return;

        let r = await equipeAction(() => BD.boosterEquipeSupprimer(b.id, false));

        // Des membres en ont : on demande une seconde fois avant de forcer.
        if(!r && b.detenteurs !== 0 && confirm('Des membres ont des boosters ou des cartes de celui-ci. Les supprimer quand même ?')){
          r = await equipeAction(() => BD.boosterEquipeSupprimer(b.id, true));
        }

        if(r){ EQ.choisi = null; await equipeCharger(false); messageEquipe('Booster supprimé.', 'ok'); }
      }
      else if(d.bqaRetirer){
        const r = await equipeAction(() => BD.boosterEquipeCarteRetirer(Number(d.bqaRetirer)));
        if(r){ await equipeCharger(true); messageEquipe('Carte retirée (les numéros sont recalculés).', 'ok'); equipeResultats(); }
      }
      else if(d.bqaAjouter){
        const rar = el.querySelector('[data-bqa-rarete-defaut]').value;
        const r = await equipeAction(() => BD.boosterEquipeCarteAjouter(EQ.choisi, d.bqaAjouter, rar));
        if(r){ await equipeCharger(true); messageEquipe('Carte ajoutée.', 'ok'); equipeResultats(); }
      }
      else if(d.bqaPochette){
        const s = EQ.resultats.find(x => x.id === d.bqaPochette);
        const champ = el.querySelector('[name="visuel"]');
        if(s && champ){
          champ.value = s.cover_url;
          messageEquipe('Pochette prise : enregistre le booster pour la garder.', 'ok');
        }
      }
    });

    el.addEventListener('change', async (ev) => {
      const sel = ev.target.closest && ev.target.closest('[data-bqa-rarete]');
      if(!sel) return;
      const r = await equipeAction(() => BD.boosterEquipeCarteRarete(Number(sel.dataset.bqaRarete), sel.value), 'Rareté modifiée.');
      if(r) await equipeCharger(true);
    });

    el.addEventListener('input', (ev) => {

      const champ = ev.target.closest && ev.target.closest('[data-bqa-recherche]');
      if(!champ) return;

      clearTimeout(EQ.minuteur);

      EQ.minuteur = setTimeout(async () => {

        const q = champ.value.trim();

        if(typeof texteNu === 'function' && texteNu(q).length < 2){
          EQ.resultats = [];
          equipeResultats();
          return;
        }

        const { data, error } = await BD.catalogueChercher(q, 12, 0);
        EQ.resultats = error ? [] : (data || []);
        equipeResultats();
      }, 250);
    });
  }

  async function equipe(emplacement){

    poserFeuille();

    EQ.el = emplacement;
    equipeBrancher();

    if(!EQ.liste.length) emplacement.innerHTML = '<div class="empty-state">Chargement…</div>';

    await equipeCharger(true);
  }

  window.Boutique = { monter, equipe };

})();
