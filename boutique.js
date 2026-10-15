/* =====================================================================
   La Wave — la boutique des coffres, les cartes et les classeurs

   Le moteur vit dans la base (sql/coffres-cartes.sql) : Waves Coins (WC), collections saisonnières, tirage des
   cartes, classeurs. Ce fichier LIT et DESSINE :

     la boutique    les coffres en vente (ou annoncés), leur prix en WC, le temps qu'il reste, les défis spéciaux
     l'ouverture    le coffre qui s'ouvre, les cartes retournées une à une, du plus commun au plus rare
     le classeur    une page par collection, les cartes obtenues et les emplacements encore vides
     les cartes     la pochette de la sortie + un cadre propre à la collection + l'effet de la rareté

   Chargé à la demande (chargerBoutique dans index.html) quand on ouvre l'onglet « Boutique » de la communauté.
   ===================================================================== */

(function(){

  'use strict';

  const esc = (t) => escapeHtml(t);
  const attr = (t) => escapeAttribute(t);
  const nf = (n) => Number(n || 0).toLocaleString('fr-FR');

  // Les six raretés, de la plus commune à la plus rare.
  const RARETES = [
    { cle: 'commun',      nom: 'Commun' },
    { cle: 'peu_commun',  nom: 'Peu commun' },
    { cle: 'rare',        nom: 'Rare' },
    { cle: 'ultra_rare',  nom: 'Ultra rare' },
    { cle: 'legendaire',  nom: 'Légendaire' },
    { cle: 'secret_wave', nom: 'Secret Wave' }
  ];

  const rarete = (cle) => RARETES.find(r => r.cle === cle) || null;
  const ordreRarete = (cle) => RARETES.findIndex(r => r.cle === cle);

  let hote = null;          // l'emplacement dans la page
  let boutique = null;      // ce que rend boutique_liste
  const classeurs = {};     // collection -> ce que rend classeur_collection
  let onglet = 'coffres';   // 'coffres' | 'classeur'
  let colChoisie = null;    // la collection montrée dans le classeur
  let occupe = false;       // un achat est en cours
  let uid = 0;

  // ---------------------------------------------------------------------
  // La feuille de style, posée une fois
  // ---------------------------------------------------------------------

  const FEUILLE = `
  .bq{max-width:980px; margin:0 auto; padding:4px 0 40px;}
  .bq-tete{display:flex; align-items:center; justify-content:space-between; gap:16px; flex-wrap:wrap; margin:4px 0 18px;}
  .bq-tete h2{margin:0; font-size:26px; color:var(--ink);}
  .bq-tete p{margin:4px 0 0; font-size:14px; color:var(--muted); max-width:46ch;}
  .bq-wc{
    display:flex; align-items:center; gap:10px; padding:9px 16px 9px 10px; border-radius:99px;
    background:rgba(245,179,1,.1); border:1px solid rgba(245,179,1,.4); color:var(--ink); font-size:13px;
  }
  .bq-wc b{font-size:19px; color:#ffd36b; font-variant-numeric:tabular-nums;}
  .bq-piece{
    width:26px; height:26px; border-radius:50%; flex-shrink:0; display:grid; place-items:center; font-size:11px; font-weight:800;
    color:#4a2f00; background:radial-gradient(circle at 30% 28%,#fff1b3,#f5b301 55%,#b97700); box-shadow:0 0 0 2px rgba(245,179,1,.25);
  }
  .bq-onglets{display:flex; gap:6px; margin:0 0 20px; border-bottom:1px solid var(--line);}
  .bq-onglet{
    padding:10px 16px; font-size:14px; color:var(--muted); background:transparent; border:0; cursor:pointer;
    border-bottom:2px solid transparent; margin-bottom:-1px;
  }
  .bq-onglet.actif{color:var(--ink); border-bottom-color:var(--blue-bright);}
  .bq-vide{padding:30px 10px; text-align:center; color:var(--muted); font-size:14px;}

  /* ---- Les coffres en vente ---- */
  .bq-grille{display:grid; grid-template-columns:repeat(auto-fill,minmax(290px,1fr)); gap:16px;}
  .bq-coffre{
    --ca:#ff7a18; --cb:#7a2cff; --cc:#12061f;
    position:relative; display:flex; flex-direction:column; border-radius:22px; overflow:hidden;
    background:linear-gradient(180deg,color-mix(in srgb,var(--cb) 22%,#0b0d12),#0a0c11 70%); border:1px solid color-mix(in srgb,var(--ca) 40%,transparent);
    box-shadow:var(--ombre-2);
  }
  .bq-coffre.bientot, .bq-coffre.termine{filter:saturate(.55); opacity:.85;}
  .bq-vitrine{
    position:relative; height:170px; display:grid; place-items:center; overflow:hidden;
    background:radial-gradient(ellipse at 50% 85%,color-mix(in srgb,var(--ca) 40%,transparent),transparent 65%);
  }
  .bq-vitrine .bq-coffre-svg{width:150px; height:auto; filter:drop-shadow(0 14px 22px rgba(0,0,0,.55)); transition:transform .5s var(--ease);}
  .bq-coffre:hover .bq-coffre-svg{transform:translateY(-4px) scale(1.04);}
  .bq-ruban{
    position:absolute; top:14px; left:14px; padding:4px 10px; border-radius:99px; font-size:11px; font-weight:700;
    letter-spacing:.08em; text-transform:uppercase; background:rgba(8,10,14,.75); border:1px solid color-mix(in srgb,var(--ca) 60%,transparent);
    color:color-mix(in srgb,var(--ca) 70%,#fff);
  }
  .bq-corps{display:flex; flex-direction:column; gap:10px; padding:16px 18px 18px; flex:1;}
  .bq-corps h3{margin:0; font-size:18px; color:var(--ink);}
  .bq-corps p{margin:0; font-size:13px; line-height:1.45; color:var(--ink-soft);}
  .bq-meta{display:flex; gap:6px 14px; flex-wrap:wrap; margin:0; padding:0; list-style:none; font-size:12px; color:var(--muted);}
  .bq-raretes{display:flex; gap:5px; flex-wrap:wrap;}
  .bq-pastille{
    display:inline-block; padding:2px 8px; border-radius:99px; font-size:10px; letter-spacing:.04em;
    border:1px solid var(--rc); color:var(--rc); background:color-mix(in srgb,var(--rc) 10%,transparent);
  }
  .bq-progres{height:5px; border-radius:99px; background:rgba(255,255,255,.1); overflow:hidden;}
  .bq-progres > span{display:block; height:100%; border-radius:99px; background:linear-gradient(90deg,var(--ca),var(--cb));}
  .bq-progres-txt{display:flex; justify-content:space-between; font-size:12px; color:var(--muted); font-variant-numeric:tabular-nums;}
  .bq-actions{display:flex; gap:8px; margin-top:auto; padding-top:4px; flex-wrap:wrap;}
  .bq-btn{
    flex:1; min-width:120px; padding:11px 14px; border-radius:12px; font-size:13px; font-weight:600; cursor:pointer;
    border:1px solid var(--line-strong); background:rgba(255,255,255,.07); color:var(--ink); transition:transform .15s, background .2s;
  }
  .bq-btn:hover:not(:disabled){background:rgba(255,255,255,.13);}
  .bq-btn:active:not(:disabled){transform:scale(.97);}
  .bq-btn:disabled{opacity:.45; cursor:not-allowed;}
  .bq-btn.plein{background:linear-gradient(135deg,var(--ca),var(--cb)); border-color:transparent; color:#fff; text-shadow:0 1px 2px rgba(0,0,0,.4);}
  .bq-btn.plein:hover:not(:disabled){filter:brightness(1.1); background:linear-gradient(135deg,var(--ca),var(--cb));}

  /* ---- Les défis spéciaux ---- */
  .bq-defis{margin-top:30px; padding:18px; border-radius:20px; background:rgba(255,255,255,.035); border:1px solid var(--line);}
  .bq-defis h3{display:flex; justify-content:space-between; align-items:baseline; gap:10px; margin:0 0 6px; font-size:16px; color:var(--ink);}
  .bq-defis h3 small{font-size:12px; font-weight:400; color:var(--muted);}
  .bq-defis > p{margin:0 0 10px; font-size:13px; color:var(--muted);}
  .bq-defi{display:flex; align-items:center; gap:12px; padding:10px 0; border-top:1px solid var(--line); font-size:13px; color:var(--ink);}
  .bq-defi .ic{font-size:20px; width:26px; text-align:center;}
  .bq-defi .tx{flex:1; min-width:0;}
  .bq-defi .mini{height:4px; margin-top:7px; border-radius:99px; background:rgba(255,255,255,.1); overflow:hidden;}
  .bq-defi .mini span{display:block; height:100%; background:var(--blue-bright); border-radius:99px;}
  .bq-defi.faite{color:var(--muted);}
  .bq-defi.faite .mini span{background:#8fe3ab;}
  .bq-defi .gain{font-size:12px; font-weight:700; color:#ffd36b; white-space:nowrap;}
  .bq-defi.faite .gain{color:#8fe3ab;}

  /* ---- Le classeur ---- */
  .bq-choix{display:flex; gap:8px; flex-wrap:wrap; margin-bottom:16px;}
  .bq-puce{
    padding:8px 14px; border-radius:99px; font-size:13px; cursor:pointer; background:transparent; color:var(--muted);
    border:1px solid var(--line);
  }
  .bq-puce.actif{background:rgba(255,255,255,.1); color:var(--ink); border-color:rgba(255,255,255,.3);}
  .bq-cl{
    --ca:#ff7a18; --cb:#7a2cff; --cc:#12061f;
    padding:18px; border-radius:22px; border:1px solid color-mix(in srgb,var(--ca) 35%,transparent);
    background:linear-gradient(160deg,color-mix(in srgb,var(--cb) 16%,#0b0d12),#080a0e);
  }
  .bq-cl-tete{display:flex; align-items:baseline; justify-content:space-between; gap:10px; margin-bottom:10px;}
  .bq-cl-tete h3{margin:0; font-size:19px; color:var(--ink);}
  .bq-cl-tete span{font-size:13px; color:var(--muted); font-variant-numeric:tabular-nums;}
  .bq-cl .bq-progres{margin-bottom:18px;}
  .bq-pages{display:grid; grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); gap:14px;}
  .bq-case{position:relative; display:block; width:100%; padding:0; border:0; background:none; cursor:pointer; text-align:left;}
  .bq-case .wc-carte{transition:transform .3s var(--ease);}
  .bq-case:hover .wc-carte{transform:translateY(-4px) rotate(-1deg);}
  .bq-quantite{
    position:absolute; top:-6px; right:-6px; z-index:5; min-width:24px; padding:2px 6px; border-radius:99px; text-align:center;
    font-size:11px; font-weight:800; background:#0b0d12; color:#ffd36b; border:1px solid rgba(245,179,1,.6);
  }
  .bq-vide-case{
    position:relative; width:100%; aspect-ratio:5/7; border-radius:14px; display:grid; place-items:center;
    background:rgba(255,255,255,.03); border:1.5px dashed rgba(255,255,255,.14); color:rgba(255,255,255,.32);
  }
  .bq-vide-case b{font-size:22px; font-variant-numeric:tabular-nums;}
  .bq-vide-case i{position:absolute; bottom:10px; left:50%; transform:translateX(-50%); width:8px; height:8px; border-radius:50%; background:var(--rc);}
  .bq-vide-case.secret{border-color:rgba(94,240,255,.35); color:rgba(94,240,255,.6);}

  /* ---- Une carte ---- */
  .wc-carte{
    --ca:#ff7a18; --cb:#7a2cff; --cc:#12061f; --rc:#9aa3ad;
    position:relative; width:100%; aspect-ratio:5/7; border-radius:14px; padding:5px; container-type:inline-size; user-select:none;
    background:linear-gradient(145deg,var(--ca),var(--cb)); box-shadow:0 6px 18px rgba(0,0,0,.45);
    transform-style:preserve-3d;
  }
  .wc-fond{
    position:absolute; inset:5px; border-radius:10px;
    background:radial-gradient(ellipse at 50% 0%,color-mix(in srgb,var(--cb) 45%,transparent),transparent 60%),
               linear-gradient(170deg,color-mix(in srgb,var(--cc) 82%,#fff),var(--cc) 55%);
  }
  .wc-deco{position:absolute; inset:5px; border-radius:10px; overflow:hidden; pointer-events:none; color:var(--ca); opacity:.5;}
  .wc-deco svg{position:absolute;}
  .wc-int{position:relative; height:100%; display:flex; flex-direction:column; gap:3cqw; padding:3.5cqw; z-index:2;}
  .wc-haut{display:flex; justify-content:space-between; align-items:center; font-size:5.6cqw; letter-spacing:.06em; text-transform:uppercase; color:rgba(255,255,255,.85);}
  .wc-rar{padding:.6cqw 2.6cqw; border-radius:99px; color:var(--rc); border:1px solid var(--rc); background:rgba(0,0,0,.35); font-weight:700;}
  .wc-cover{position:relative; width:100%; aspect-ratio:1; border-radius:2.4cqw; overflow:hidden; border:.8cqw solid var(--rc); background:#000; box-shadow:0 0 0 .5cqw rgba(0,0,0,.5);}
  .wc-cover img{display:block; width:100%; height:100%; object-fit:cover;}
  .wc-bas{display:flex; flex-direction:column; gap:.8cqw; min-width:0; margin-top:auto; text-align:center;}
  .wc-bas b{font-size:8.2cqw; line-height:1.15; color:#fff; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;}
  .wc-bas span{font-size:6cqw; color:rgba(255,255,255,.7); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
  .wc-ruban{
    position:absolute; left:50%; bottom:15cqw; transform:translateX(-50%); z-index:4; padding:.6cqw 4cqw; border-radius:99px; white-space:nowrap;
    font-size:5.2cqw; font-weight:800; letter-spacing:.14em; text-transform:uppercase; color:#06222a;
    background:linear-gradient(90deg,#5ef0ff,#c9a6ff,#ff9ed1); box-shadow:0 0 14px rgba(94,240,255,.6);
  }
  .wc-brillance{position:absolute; inset:5px; border-radius:10px; pointer-events:none; z-index:3; opacity:0;}

  .wc-carte[data-rar="commun"]{--rc:#9aa3ad;}
  .wc-carte[data-rar="peu_commun"]{--rc:#4cc38a; box-shadow:0 6px 18px rgba(0,0,0,.45), 0 0 14px rgba(76,195,138,.25);}
  .wc-carte[data-rar="rare"]{--rc:#4fb4ff; box-shadow:0 6px 18px rgba(0,0,0,.45), 0 0 18px rgba(79,180,255,.4);}
  .wc-carte[data-rar="ultra_rare"]{--rc:#b66bff; box-shadow:0 6px 18px rgba(0,0,0,.45), 0 0 22px rgba(182,107,255,.55);}
  .wc-carte[data-rar="ultra_rare"] .wc-brillance{
    opacity:.5; mix-blend-mode:color-dodge;
    background:linear-gradient(115deg,transparent 20%,rgba(255,120,220,.5) 36%,rgba(120,220,255,.5) 50%,rgba(255,240,140,.45) 64%,transparent 80%);
    background-size:250% 100%; animation:wcHolo 4.5s ease-in-out infinite;
  }
  .wc-carte[data-rar="legendaire"]{
    --rc:#ffc23d; background:linear-gradient(145deg,#fff1a8,#ffb300 40%,#b87400 70%,#ffe27a);
    box-shadow:0 6px 18px rgba(0,0,0,.45), 0 0 26px rgba(255,194,61,.6);
  }
  .wc-carte[data-rar="legendaire"] .wc-brillance{
    opacity:.55; mix-blend-mode:overlay;
    background:linear-gradient(105deg,transparent 30%,rgba(255,255,255,.9) 48%,transparent 62%);
    background-size:260% 100%; animation:wcHolo 3.2s ease-in-out infinite;
  }
  .wc-carte[data-rar="secret_wave"]{
    --rc:#5ef0ff; background:conic-gradient(from 0deg,#5ef0ff,#c9a6ff,#ff9ed1,#ffe08a,#8fe3ab,#5ef0ff);
    box-shadow:0 6px 18px rgba(0,0,0,.45), 0 0 30px rgba(94,240,255,.65); animation:wcTeinte 6s linear infinite;
  }
  .wc-carte[data-rar="secret_wave"] .wc-brillance{
    opacity:.55; mix-blend-mode:color-dodge;
    background:repeating-linear-gradient(120deg,rgba(255,255,255,.0) 0 14px,rgba(255,255,255,.35) 18px,rgba(255,255,255,0) 24px),
               linear-gradient(115deg,transparent 25%,rgba(255,255,255,.7) 50%,transparent 75%);
    background-size:auto,260% 100%; animation:wcHolo 3s ease-in-out infinite;
  }
  @keyframes wcHolo{0%{background-position:0% 0,100% 0;}50%{background-position:30px 0,0% 0;}100%{background-position:0% 0,100% 0;}}
  @keyframes wcTeinte{to{filter:hue-rotate(360deg);}}

  /* ---- L'aperçu d'une carte ---- */
  .bq-apercu{
    position:fixed; inset:0; z-index:450; display:grid; place-items:center; padding:20px; cursor:pointer;
    background:rgba(3,5,8,.78); backdrop-filter:blur(8px); -webkit-backdrop-filter:blur(8px); animation:bqFond .25s ease;
  }
  .bq-apercu .wc-carte{width:min(320px, 82vw); cursor:default; transition:transform .12s; transform:perspective(900px) rotateX(var(--rx,0deg)) rotateY(var(--ry,0deg));}
  @keyframes bqFond{from{opacity:0;}to{opacity:1;}}

  /* ---- L'ouverture d'un coffre ---- */
  .bq-ouv{
    --ca:#ff7a18; --cb:#7a2cff; --cc:#12061f;
    position:fixed; inset:0; z-index:450; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:18px;
    padding:24px 16px; overflow:auto; animation:bqFond .3s ease;
    background:radial-gradient(ellipse at 50% 60%,color-mix(in srgb,var(--cb) 40%,#05070a),#03050a 75%);
  }
  .bq-ouv.sortie{animation:bqFondSort .3s ease forwards;}
  @keyframes bqFondSort{to{opacity:0;}}
  .bq-scene{display:flex; flex-direction:column; align-items:center; gap:14px; text-align:center;}
  .bq-scene .bq-coffre-svg{width:min(260px, 62vw); height:auto; filter:drop-shadow(0 22px 34px rgba(0,0,0,.6)); cursor:pointer;}
  .bq-scene .bq-coffre-svg.attend{animation:bqRespire 2.4s ease-in-out infinite;}
  .bq-scene .bq-coffre-svg.secoue{animation:bqSecoue .7s ease-in-out infinite;}
  @keyframes bqRespire{50%{transform:translateY(-8px) scale(1.03);}}
  @keyframes bqSecoue{0%,100%{transform:rotate(0);}20%{transform:rotate(-6deg) translateX(-4px);}40%{transform:rotate(6deg) translateX(4px);}60%{transform:rotate(-4deg);}80%{transform:rotate(4deg);}}
  .bq-scene h2{margin:0; font-size:22px; color:var(--ink);}
  .bq-scene p{margin:0; font-size:14px; color:var(--ink-soft);}
  .bq-fermer{
    position:absolute; top:14px; right:14px; width:38px; height:38px; border-radius:50%; cursor:pointer; font-size:16px;
    background:rgba(255,255,255,.08); border:1px solid var(--line-strong); color:var(--ink);
  }
  .bq-cartes{display:flex; gap:clamp(8px,1.6vw,16px); justify-content:center; flex-wrap:wrap; width:100%; max-width:960px;}
  .bq-flip{width:clamp(104px, 17vw, 168px); aspect-ratio:5/7; perspective:900px; cursor:pointer; position:relative;}
  .bq-flip-in{position:absolute; inset:0; transform-style:preserve-3d; transition:transform .7s cubic-bezier(.2,.8,.2,1);}
  .bq-flip.retournee .bq-flip-in{transform:rotateY(180deg);}
  .bq-face, .bq-dos{position:absolute; inset:0; backface-visibility:hidden; -webkit-backface-visibility:hidden;}
  .bq-face{transform:rotateY(180deg);}
  .bq-dos{
    border-radius:14px; display:grid; place-items:center; font-size:44px; border:2px solid color-mix(in srgb,var(--ca) 70%,#fff);
    background:repeating-linear-gradient(45deg,rgba(255,255,255,.06) 0 6px,transparent 6px 12px),linear-gradient(145deg,var(--ca),var(--cb));
    box-shadow:0 8px 22px rgba(0,0,0,.5);
  }
  .bq-dos small{position:absolute; bottom:9%; font-size:10px; letter-spacing:.3em; text-transform:uppercase; color:rgba(255,255,255,.8);}
  .bq-flip:hover:not(.retournee) .bq-dos{filter:brightness(1.15);}
  .bq-nouvelle{
    position:absolute; top:-8px; left:50%; transform:translateX(-50%); z-index:6; padding:2px 10px; border-radius:99px; white-space:nowrap;
    font-size:10px; font-weight:800; letter-spacing:.1em; text-transform:uppercase; background:#8fe3ab; color:#04210f; opacity:0; transition:opacity .3s .5s;
  }
  .bq-nouvelle.doublon{background:#ffd36b; color:#3a2600;}
  .bq-flip.retournee .bq-nouvelle{opacity:1;}
  .bq-flip.lueur-legendaire .bq-flip-in, .bq-flip.lueur-secret_wave .bq-flip-in{animation:bqPop .9s ease;}
  @keyframes bqPop{0%{transform:rotateY(180deg) scale(.8);}40%{transform:rotateY(180deg) scale(1.18);}100%{transform:rotateY(180deg) scale(1);}}
  .bq-eclair{position:fixed; inset:0; z-index:451; pointer-events:none; background:#fff; opacity:0; animation:bqEclair .6s ease-out;}
  @keyframes bqEclair{0%{opacity:.85;}100%{opacity:0;}}
  .bq-bas{display:flex; gap:10px; flex-wrap:wrap; justify-content:center;}
  .bq-bas .bq-btn{flex:none; min-width:150px;}

  @media (max-width:560px){
    .bq-grille{grid-template-columns:1fr;}
    .bq-pages{grid-template-columns:repeat(auto-fill,minmax(110px,1fr)); gap:10px;}
  }
  @media (prefers-reduced-motion:reduce){
    .wc-carte, .wc-brillance, .bq-scene .bq-coffre-svg, .bq-flip-in, .bq-eclair{animation:none !important; transition:none !important;}
  }
  `;

  function poserFeuille(){
    if(document.getElementById('bqFeuille')) return;
    const s = document.createElement('style');
    s.id = 'bqFeuille';
    s.textContent = FEUILLE;
    document.head.appendChild(s);
  }

  // ---------------------------------------------------------------------
  // Les dessins : le coffre, les décors des collections
  // ---------------------------------------------------------------------

  function couleursDe(col){
    const c = col.couleurs || {};
    return { a: c.a || '#4fb4ff', b: c.b || '#7a2cff', c: c.c || '#0b0d12' };
  }

  function styleCol(col){
    const c = couleursDe(col);
    return `--ca:${c.a};--cb:${c.b};--cc:${c.c};`;
  }

  function coffreSvg(col, etat){

    const c = couleursDe(col);
    const id = 'cf' + (++uid);

    return `
      <svg class="bq-coffre-svg ${etat || ''}" viewBox="0 0 200 170" aria-hidden="true">
        <defs>
          <linearGradient id="${id}c" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c.a}"/><stop offset="1" stop-color="${c.b}"/></linearGradient>
          <linearGradient id="${id}d" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c.b}"/><stop offset="1" stop-color="${c.c}"/></linearGradient>
          <radialGradient id="${id}g"><stop offset="0" stop-color="#fff6c8" stop-opacity=".95"/><stop offset="1" stop-color="${c.a}" stop-opacity="0"/></radialGradient>
        </defs>
        <ellipse cx="100" cy="160" rx="74" ry="8" fill="rgba(0,0,0,.45)"/>
        <ellipse class="lueur" cx="100" cy="84" rx="62" ry="34" fill="url(#${id}g)" style="opacity:${etat === 'ouvert' ? 1 : 0};transition:opacity .5s"/>
        <g>
          <rect x="30" y="84" width="140" height="70" rx="9" fill="url(#${id}d)" stroke="rgba(255,255,255,.22)" stroke-width="1.5"/>
          <rect x="30" y="106" width="140" height="9" fill="${c.a}" opacity=".85"/>
          <rect x="44" y="84" width="9" height="70" fill="${c.a}" opacity=".6"/>
          <rect x="147" y="84" width="9" height="70" fill="${c.a}" opacity=".6"/>
        </g>
        <g class="couvercle" style="transform-origin:30px 86px;transition:transform .6s cubic-bezier(.2,.9,.3,1.2);transform:${etat === 'ouvert' ? 'rotate(-42deg)' : 'none'}">
          <path d="M30 88 Q30 34 100 34 Q170 34 170 88 Z" fill="url(#${id}c)" stroke="rgba(255,255,255,.28)" stroke-width="1.5"/>
          <path d="M30 70 Q100 52 170 70" fill="none" stroke="rgba(255,255,255,.3)" stroke-width="2"/>
          <rect x="44" y="40" width="9" height="48" fill="rgba(0,0,0,.18)"/>
          <rect x="147" y="40" width="9" height="48" fill="rgba(0,0,0,.18)"/>
          <text x="100" y="74" text-anchor="middle" font-size="26">${esc(col.emoji || '')}</text>
        </g>
        <rect x="88" y="96" width="24" height="26" rx="5" fill="#ffd98a" stroke="#a87614" stroke-width="1.5"/>
        <circle cx="100" cy="106" r="3.4" fill="#4a3000"/><rect x="98.6" y="107" width="2.8" height="8" rx="1.2" fill="#4a3000"/>
      </svg>`;
  }

  // Le décor propre à chaque collection, sur le cadre de ses cartes.
  function decor(theme){

    if(theme === 'halloween'){
      return `<div class="wc-deco" aria-hidden="true">
        <svg style="left:-2px;top:-2px;width:34%;height:auto" viewBox="0 0 60 60" fill="none" stroke="currentColor" stroke-width="1.2">
          <path d="M0 0 60 60M0 0 38 62M0 0 62 38M0 0 60 12M0 0 12 60"/><path d="M12 4Q14 14 4 12M24 8Q28 28 8 24M36 12Q42 42 12 36M48 16Q56 56 16 48" /></svg>
        <svg style="right:5%;top:2%;width:24%;height:auto" viewBox="0 0 40 24" fill="currentColor">
          <path d="M20 22c-2-5-6-6-8-5-2-4-6-6-12-5 3 1 5 3 5 6 3-1 6 0 8 3 1-3 4-4 7-4 3 0 5 2 7 4 2-3 5-4 8-3 0-3 2-5 5-6-6-1-10 1-12 5-2-1-6 0-8 5z"/></svg>
        <svg style="right:12%;top:15%;width:15%;height:auto" viewBox="0 0 40 24" fill="currentColor">
          <path d="M20 22c-2-5-6-6-8-5-2-4-6-6-12-5 3 1 5 3 5 6 3-1 6 0 8 3 1-3 4-4 7-4 3 0 5 2 7 4 2-3 5-4 8-3 0-3 2-5 5-6-6-1-10 1-12 5-2-1-6 0-8 5z"/></svg>
        <svg style="left:3%;bottom:1.5%;width:13%;height:auto" viewBox="0 0 40 36" fill="currentColor">
          <path d="M20 8c-9 0-16 6-16 14s7 12 16 12 16-4 16-12S29 8 20 8z"/><path d="M19 8c0-4 1-6 4-7l1 2c-2 1-2 3-2 5z" opacity=".7"/></svg>
      </div>`;
    }

    if(theme === 'amour'){
      return `<div class="wc-deco" aria-hidden="true">
        <svg style="left:6%;top:4%;width:14%;height:auto" viewBox="0 0 24 24" fill="currentColor"><path d="M12 21s-8-5.2-8-11a4.6 4.6 0 0 1 8-3 4.6 4.6 0 0 1 8 3c0 5.8-8 11-8 11z"/></svg>
        <svg style="right:8%;top:12%;width:10%;height:auto" viewBox="0 0 24 24" fill="currentColor"><path d="M12 21s-8-5.2-8-11a4.6 4.6 0 0 1 8-3 4.6 4.6 0 0 1 8 3c0 5.8-8 11-8 11z"/></svg>
        <svg style="left:10%;bottom:16%;width:9%;height:auto" viewBox="0 0 24 24" fill="currentColor"><path d="M12 21s-8-5.2-8-11a4.6 4.6 0 0 1 8-3 4.6 4.6 0 0 1 8 3c0 5.8-8 11-8 11z"/></svg>
      </div>`;
    }

    // « top » et toute collection à venir : des étoiles.
    return `<div class="wc-deco" aria-hidden="true">
      <svg style="left:6%;top:4%;width:12%;height:auto" viewBox="0 0 24 24" fill="currentColor"><path d="m12 2 3 6.5 7 .8-5.2 4.8 1.5 7L12 17.6 5.7 21l1.5-7L2 9.3l7-.8z"/></svg>
      <svg style="right:7%;top:10%;width:9%;height:auto" viewBox="0 0 24 24" fill="currentColor"><path d="m12 2 3 6.5 7 .8-5.2 4.8 1.5 7L12 17.6 5.7 21l1.5-7L2 9.3l7-.8z"/></svg>
      <svg style="right:10%;bottom:18%;width:10%;height:auto" viewBox="0 0 24 24" fill="currentColor"><path d="m12 2 3 6.5 7 .8-5.2 4.8 1.5 7L12 17.6 5.7 21l1.5-7L2 9.3l7-.8z"/></svg>
    </div>`;
  }

  // Une carte : pochette de la sortie + cadre de la collection + effet de rareté.
  function carteHtml(c, col, total){

    const r = rarete(c.rarete) || RARETES[0];
    const photo = typeof safeUrl === 'function' ? safeUrl(c.cover_url) : c.cover_url;

    return `
      <div class="wc-carte" data-rar="${attr(c.rarete)}" data-theme="${attr(col.theme)}" style="${styleCol(col)}">
        <div class="wc-fond"></div>
        ${decor(col.theme)}
        <div class="wc-int">
          <div class="wc-haut"><span>${c.numero}/${total}</span><span class="wc-rar">${esc(r.nom)}</span></div>
          <div class="wc-cover">${photo ? `<img src="${attr(photo)}" alt="" loading="lazy" draggable="false">` : ''}</div>
          <div class="wc-bas"><b>${esc(c.titre)}</b><span>${esc(c.artiste)}${c.type_sortie ? ' · ' + esc(c.type_sortie) : ''}</span></div>
        </div>
        ${c.rarete === 'secret_wave' ? '<span class="wc-ruban">Secret Wave</span>' : ''}
        <div class="wc-brillance"></div>
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
    const heures = Math.max(1, Math.floor(ms / 3600000));
    return heures > 24 ? 'Dernier jour' : 'Dernières heures';
  }

  function coffreHtml(c){

    const enVente = c.statut === 'en_cours' && c.nb_cartes > 0;
    const manque = enVente && boutique.wc < c.prix_wc;
    const pct = c.nb_cartes ? Math.round((c.possedees / c.nb_cartes) * 100) : 0;

    const ruban = c.statut === 'a_venir' ? 'Bientôt' : (c.statut === 'termine' ? 'Terminé' : 'Édition limitée');

    const pastilles = RARETES.map(r => `<span class="bq-pastille" style="--rc:${couleurDe(r.cle)}">${esc(r.nom)}</span>`).join('');

    return `
      <article class="bq-coffre${c.statut === 'a_venir' ? ' bientot' : ''}${c.statut === 'termine' ? ' termine' : ''}" style="${styleCol(c)}">
        <div class="bq-vitrine">${coffreSvg(c)}<span class="bq-ruban">${ruban}</span></div>
        <div class="bq-corps">
          <h3>${esc(c.emoji)} ${esc(c.nom)}</h3>
          <p>${esc(c.description)}</p>
          <ul class="bq-meta">
            <li>${c.nb_cartes ? c.nb_cartes + ' cartes' : 'Cartes bientôt dévoilées'}</li>
            <li>${c.cartes_par_coffre} par coffre</li>
            <li>${tempsRestant(c)}</li>
          </ul>
          ${c.nb_cartes ? `
            <div class="bq-raretes">${pastilles}</div>
            <div><div class="bq-progres"><span style="width:${pct}%"></span></div>
              <div class="bq-progres-txt"><span>Ma collection</span><span>${c.possedees} / ${c.nb_cartes}</span></div></div>` : ''}
          <div class="bq-actions">
            ${enVente ? `<button type="button" class="bq-btn plein" data-bq-acheter="${attr(c.id)}" ${manque || occupe ? 'disabled' : ''}
                title="${manque ? 'Il te manque ' + (c.prix_wc - boutique.wc) + ' WC' : ''}">Acheter · ${nf(c.prix_wc)} WC</button>` : ''}
            ${c.coffres > 0 ? `<button type="button" class="bq-btn${enVente ? '' : ' plein'}" data-bq-ouvrir="${attr(c.id)}">Ouvrir (${c.coffres})</button>` : ''}
            ${c.nb_cartes && c.possedees > 0 ? `<button type="button" class="bq-btn" data-bq-classeur="${attr(c.id)}">Classeur</button>` : ''}
          </div>
          ${manque ? `<p style="font-size:12px;color:var(--muted)">Il te manque ${nf(c.prix_wc - boutique.wc)} WC : gagne de l'XP ou relève un défi spécial.</p>` : ''}
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
        <p>Ces défis rapportent des WC, et rien que des WC. Tu gagnes aussi 1 WC pour chaque point d'XP.</p>
        ${defis.map(d => `
          <div class="bq-defi${d.faite ? ' faite' : ''}">
            <span class="ic">${d.faite ? '✅' : esc(d.icone)}</span>
            <div class="tx">${esc(d.libelle)}<div class="mini"><span style="width:${Math.min(100, Math.round((d.progres / d.objectif) * 100))}%"></span></div></div>
            <span class="gain">${d.faite ? '✓' : d.progres + '/' + d.objectif + ' · +' + d.wc + ' WC'}</span>
          </div>`).join('')}
      </section>`;
  }

  function coffresHtml(){

    // Les collections terminées n'apparaissent que si l'on a encore des coffres à ouvrir.
    const liste = collections().filter(c => c.statut !== 'termine' || c.coffres > 0);

    return `
      <div class="bq-grille">${liste.map(coffreHtml).join('') || '<div class="bq-vide">Aucun coffre en vente pour le moment.</div>'}</div>
      ${defisHtml()}`;
  }

  // ---------------------------------------------------------------------
  // Le classeur
  // ---------------------------------------------------------------------

  function classeurHtml(){

    const dispo = collections().filter(c => c.nb_cartes > 0 && (c.possedees > 0 || c.statut === 'en_cours'));

    if(!dispo.length) return '<div class="bq-vide">Ton classeur est vide pour l\'instant. Ouvre un coffre pour commencer ta collection.</div>';

    if(!colChoisie || !dispo.some(c => c.id === colChoisie)) colChoisie = dispo[0].id;

    const choix = dispo.map(c => `
      <button type="button" class="bq-puce${c.id === colChoisie ? ' actif' : ''}" data-bq-col="${attr(c.id)}">${esc(c.emoji)} ${esc(c.nom.replace(/^Coffre /, ''))}</button>`).join('');

    return `<div class="bq-choix">${choix}</div><div id="bqClasseur"><div class="bq-vide">Chargement…</div></div>`;
  }

  async function remplirClasseur(){

    const zone = hote && hote.querySelector('#bqClasseur');
    if(!zone || !colChoisie) return;

    const voulue = colChoisie;

    try{
      const cl = await lireClasseur(voulue);
      if(colChoisie !== voulue || !hote.contains(zone)) return;

      const pct = cl.total ? Math.round((cl.possedees / cl.total) * 100) : 0;

      const cases = cl.cartes.map((c, i) => {

        if(!c.possedee){
          const secret = !c.rarete;
          return `<div class="bq-vide-case${secret ? ' secret' : ''}" ${c.rarete ? `style="--rc:${couleurDe(c.rarete)}"` : ''}><b>${c.numero}</b>${secret ? '<span style="position:absolute;bottom:8px;font-size:18px">?</span>' : '<i></i>'}</div>`;
        }

        return `
          <button type="button" class="bq-case" data-bq-carte="${i}" aria-label="${attr(c.titre + ' — ' + c.artiste)}">
            ${c.quantite > 1 ? `<span class="bq-quantite">×${c.quantite}</span>` : ''}
            ${carteHtml(c, cl, cl.total)}
          </button>`;
      }).join('');

      zone.innerHTML = `
        <div class="bq-cl" style="${styleCol(cl)}">
          <div class="bq-cl-tete"><h3>${esc(cl.emoji)} ${esc(cl.nom)}</h3><span>${cl.possedees} / ${cl.total} cartes</span></div>
          <div class="bq-progres"><span style="width:${pct}%"></span></div>
          <div class="bq-pages">${cases}</div>
        </div>`;

    }catch(erreur){
      zone.innerHTML = `<div class="bq-vide">${esc(erreur.message)}</div>`;
    }
  }

  function couleurDe(cle){
    return { commun: '#9aa3ad', peu_commun: '#4cc38a', rare: '#4fb4ff', ultra_rare: '#b66bff', legendaire: '#ffc23d', secret_wave: '#5ef0ff' }[cle] || '#9aa3ad';
  }

  // Une carte du classeur, en grand : elle suit le pointeur.
  function apercu(i){

    const cl = classeurs[colChoisie];
    const c = cl && cl.cartes[i];
    if(!c) return;

    poserFeuille();

    const fond = document.createElement('div');
    fond.className = 'bq-apercu';
    fond.innerHTML = carteHtml(c, cl, cl.total);

    const carte = fond.querySelector('.wc-carte');

    fond.addEventListener('pointermove', (e) => {
      const r = carte.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      carte.style.setProperty('--ry', (x * 22) + 'deg');
      carte.style.setProperty('--rx', (-y * 22) + 'deg');
    });

    const fermer = () => { fond.remove(); document.removeEventListener('keydown', touche); };
    const touche = (e) => { if(e.key === 'Escape') fermer(); };

    fond.addEventListener('click', (e) => { if(!carte.contains(e.target)) fermer(); });
    document.addEventListener('keydown', touche);
    document.body.appendChild(fond);
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
            <p>Achète des coffres saisonniers avec tes Waves Coins et collectionne les cartes des sorties du catalogue.</p>
          </div>
          <div class="bq-wc" title="Waves Coins"><span class="bq-piece">WC</span><b>${nf(boutique.wc)}</b></div>
        </div>
        <div class="bq-onglets" role="tablist">
          <button type="button" class="bq-onglet${onglet === 'coffres' ? ' actif' : ''}" data-bq-onglet="coffres" role="tab">Coffres</button>
          <button type="button" class="bq-onglet${onglet === 'classeur' ? ' actif' : ''}" data-bq-onglet="classeur" role="tab">Classeur</button>
        </div>
        ${onglet === 'coffres' ? coffresHtml() : classeurHtml()}
      </div>`;

    if(onglet === 'classeur') remplirClasseur();
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

      notifier('Coffre acheté', {
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
  // Ouvrir un coffre : le coffre, puis les cartes retournées une à une
  // ---------------------------------------------------------------------

  function ouvrir(id){

    const col = collections().find(x => x.id === id);

    if(!col || col.coffres < 1){
      notifier('Aucun coffre à ouvrir', { type: 'info', icone: '📦', detail: 'Achète-en un dans la boutique.' });
      return;
    }

    poserFeuille();

    const fond = document.createElement('div');
    fond.className = 'bq-ouv';
    fond.setAttribute('role', 'dialog');
    fond.setAttribute('aria-modal', 'true');
    fond.style.cssText = styleCol(col);

    let fini = false;

    const fermer = () => {
      document.removeEventListener('keydown', touche);
      fond.classList.add('sortie');
      setTimeout(() => fond.remove(), 300);
      // Le solde, les stocks et les classeurs ont changé : on relit tout.
      delete classeurs[id];
      actualiser();
    };

    const touche = (e) => { if(e.key === 'Escape') fermer(); };
    document.addEventListener('keydown', touche);

    const scene = (reste) => {
      fond.innerHTML = `
        <button type="button" class="bq-fermer" aria-label="Fermer">✕</button>
        <div class="bq-scene">
          ${coffreSvg(col, 'attend')}
          <h2>${esc(col.nom)}</h2>
          <p>Touche le coffre pour l'ouvrir · ${reste} en stock</p>
        </div>`;
      fond.querySelector('.bq-fermer').addEventListener('click', fermer);
      fond.querySelector('.bq-coffre-svg').addEventListener('click', tirer);
    };

    let enCours = false;

    const tirer = async () => {

      if(enCours) return;
      enCours = true;

      const svg = fond.querySelector('.bq-coffre-svg');
      svg.setAttribute('class', 'bq-coffre-svg secoue');
      fond.querySelector('.bq-scene p').textContent = 'Ça bouge…';

      try{

        const [{ data, error }] = await Promise.all([BD.coffreOuvrir(id), new Promise(r => setTimeout(r, 1500))]);
        if(error) throw new Error(error.message);

        svg.setAttribute('class', 'bq-coffre-svg');
        svg.querySelector('.couvercle').style.transform = 'rotate(-42deg)';
        svg.querySelector('.lueur').style.opacity = 1;

        await new Promise(r => setTimeout(r, 650));

        col.coffres = data.restants;
        revelation(data);

      }catch(erreur){
        notifier("Ouverture impossible", { type: 'erreur', detail: erreur.message });
        fermer();
      }
    };

    // Les cartes arrivent face cachée, de la plus commune à la plus rare : le meilleur pour la fin.
    const revelation = (data) => {

      const cartes = data.cartes.slice().sort((a, b) => ordreRarete(a.rarete) - ordreRarete(b.rarete));
      let retournees = 0;

      fond.innerHTML = `
        <button type="button" class="bq-fermer" aria-label="Fermer">✕</button>
        <div class="bq-scene">
          <h2>${esc(col.nom)}</h2>
          <p data-bq-aide>Touche une carte pour la retourner</p>
        </div>
        <div class="bq-cartes">
          ${cartes.map((c, i) => `
            <div class="bq-flip" data-i="${i}" style="${styleCol(col)}">
              <span class="bq-nouvelle${c.nouvelle ? '' : ' doublon'}">${c.nouvelle ? 'Nouvelle' : 'Double ×' + c.quantite}</span>
              <div class="bq-flip-in">
                <div class="bq-dos">${esc(col.emoji)}<small>La Wave</small></div>
                <div class="bq-face">${carteHtml(c, col, col.nb_cartes)}</div>
              </div>
            </div>`).join('')}
        </div>
        <div class="bq-bas" data-bq-bas>
          <button type="button" class="bq-btn" data-bq-tout>Tout retourner</button>
        </div>`;

      fond.querySelector('.bq-fermer').addEventListener('click', fermer);

      const retourner = (el) => {

        if(el.classList.contains('retournee')) return;

        const c = cartes[Number(el.dataset.i)];
        el.classList.add('retournee');
        retournees++;

        if(c.rarete === 'legendaire' || c.rarete === 'secret_wave'){
          el.classList.add('lueur-' + c.rarete);
          const eclair = document.createElement('div');
          eclair.className = 'bq-eclair';
          document.body.appendChild(eclair);
          setTimeout(() => eclair.remove(), 700);

          const aide = fond.querySelector('[data-bq-aide]');
          if(aide) aide.textContent = c.rarete === 'secret_wave' ? 'SECRET WAVE ! Une carte introuvable ailleurs.' : 'Légendaire !';
        }

        if(retournees === cartes.length) terminer();
      };

      const terminer = () => {

        if(fini) return;
        fini = true;

        const nouvelles = cartes.filter(c => c.nouvelle).length;
        const aide = fond.querySelector('[data-bq-aide]');
        if(aide && !/SECRET|Légendaire/.test(aide.textContent)){
          aide.textContent = nouvelles + ' nouvelle' + (nouvelles > 1 ? 's' : '') + ' carte' + (nouvelles > 1 ? 's' : '') + ' dans ton classeur';
        }

        const bas = fond.querySelector('[data-bq-bas]');
        bas.innerHTML = `
          ${data.restants > 0 ? `<button type="button" class="bq-btn plein" data-bq-encore>Ouvrir un autre coffre (${data.restants})</button>` : ''}
          <button type="button" class="bq-btn" data-bq-voir>Voir mon classeur</button>
          <button type="button" class="bq-btn" data-bq-fin>Fermer</button>`;

        bas.querySelector('[data-bq-fin]').addEventListener('click', fermer);
        bas.querySelector('[data-bq-voir]').addEventListener('click', () => { onglet = 'classeur'; colChoisie = id; fermer(); });

        const encore = bas.querySelector('[data-bq-encore]');
        if(encore) encore.addEventListener('click', () => { fini = false; enCours = false; scene(data.restants); });
      };

      fond.querySelectorAll('.bq-flip').forEach(el => el.addEventListener('click', () => retourner(el)));

      fond.querySelector('[data-bq-tout]').addEventListener('click', () => {
        fond.querySelectorAll('.bq-flip:not(.retournee)').forEach((el, k) => setTimeout(() => retourner(el), k * 380));
      });
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

      const cible = ev.target.closest && ev.target.closest('[data-bq-onglet], [data-bq-acheter], [data-bq-ouvrir], [data-bq-classeur], [data-bq-col], [data-bq-carte]');
      if(!cible) return;

      if(cible.dataset.bqOnglet){
        onglet = cible.dataset.bqOnglet;
        dessiner();
      }
      else if(cible.dataset.bqAcheter){
        acheter(cible.dataset.bqAcheter);
      }
      else if(cible.dataset.bqOuvrir){
        ouvrir(cible.dataset.bqOuvrir);
      }
      else if(cible.dataset.bqClasseur){
        onglet = 'classeur';
        colChoisie = cible.dataset.bqClasseur;
        dessiner();
      }
      else if(cible.dataset.bqCol){
        colChoisie = cible.dataset.bqCol;
        dessiner();
      }
      else if(cible.dataset.bqCarte !== undefined){
        apercu(Number(cible.dataset.bqCarte));
      }
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

  window.Boutique = { monter };

})();
