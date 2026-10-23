/* =====================================================================
   La Wave — le jeu de cartes d'artistes, côté navigateur

   Le moteur vit dans la base (sql/cartes.sql, sql/cartes-artistes.sql) : tirages, collection, cadeaux, roue,
   missions, succès. Ce fichier demande et dessine.

     Packs        ouvrir 1, 5 ou 10 packs ; le pack se déchire, les cartes se retournent une à une
     Collection   toutes les cartes d'artistes, obtenues ou non ; fiche, recyclage, atelier
     Missions     3 par jour, 3 par semaine, et leur bonus
     Bonus        cadeau de connexion, roue du jour, coffre
     Succès       des paliers à récupérer

   Chargé à la demande (renderCartes dans index.html).
   ===================================================================== */

(function(){

  'use strict';

  const esc = (t) => escapeHtml(t);
  const nf = (n) => Number(n || 0).toLocaleString('fr-FR');
  const court = (n) => {
    n = Number(n || 0);
    if(n >= 1e6) return (Math.round(n / 1e5) / 10).toLocaleString('fr-FR') + ' M';
    if(n >= 1e3) return Math.round(n / 1e3) + ' k';
    return String(n);
  };
  const pluriel = (n, mot, pl) => nf(n) + ' ' + (n > 1 ? (pl || mot + 's') : mot);
  const el = (tag, classe, html) => { const e = document.createElement(tag); if(classe) e.className = classe; if(html !== undefined) e.innerHTML = html; return e; };
  const attendre = (ms) => new Promise(r => setTimeout(r, ms));
  const calme = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const numero = (n) => '#' + String(n || 0).padStart(3, '0');

  const RAR = [null,
    { nom: 'Commun', c: '#B4BDC8' },
    { nom: 'Rare', c: '#4FB4FF' },
    { nom: 'Épique', c: '#A879FF' },
    { nom: 'Légendaire', c: '#F2C14E' },
    { nom: 'Mythique', c: '#FF5C8A' }
  ];
  const rar = (r) => RAR[Math.min(Math.max(Number(r) || 1, 1), 5)];

  const VUES = [['packs', 'Packs'], ['collection', 'Collection'], ['missions', 'Missions'], ['bonus', 'Bonus'], ['succes', 'Succès']];

  // ---------------------------------------------------------------------
  // Les icônes (un trait, la couleur du texte)
  // ---------------------------------------------------------------------

  const ICONES = {
    eclair: '<path d="M13 2 4.5 13.5H11L10 22l8.5-11.5H12L13 2z"/>',
    vinyle: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.6"/><path d="M12 5.5a6.5 6.5 0 0 1 6.5 6.5"/>',
    cadeau: '<rect x="3.5" y="8.5" width="17" height="12" rx="2"/><path d="M12 8.5v12M3.5 13h17M12 8.5c-2-4.2-6.5-3.6-6.5-1.2S9.7 8.5 12 8.5zM12 8.5c2-4.2 6.5-3.6 6.5-1.2S14.3 8.5 12 8.5z"/>',
    roue: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2"/><path d="M12 3v7M12 14v7M3 12h7M14 12h7"/>',
    coffre: '<path d="M4 10h16v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19z"/><path d="M4 10V8a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v2"/><path d="M10.5 13h3v3h-3z"/>',
    cible: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2"/>',
    trophee: '<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H4.5a3.5 3.5 0 0 0 3.6 4.4M16 6h3.5a3.5 3.5 0 0 1-3.6 4.4M12 13v4M8.5 20.5h7M9.5 17h5"/>',
    cartes: '<rect x="3.5" y="6" width="11" height="15" rx="2"/><path d="M9 3.2l9.3 1.9a2 2 0 0 1 1.6 2.3l-2.4 11.8"/>',
    pack: '<path d="M6 3h12l-1 2.5 1 2.5H6l1-2.5z"/><path d="M6 8h12v11.5A1.5 1.5 0 0 1 16.5 21h-9A1.5 1.5 0 0 1 6 19.5z"/><circle cx="12" cy="14" r="3"/>',
    son: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
    muet: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="m16 9.5 5 5M21 9.5l-5 5"/>',
    cadenas: '<rect x="5" y="10.5" width="14" height="10" rx="2.2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
    recycler: '<path d="M7.5 7.8 10 3.5a2.3 2.3 0 0 1 4 0l1.3 2.2M19.6 10.5l2 3.5a2.3 2.3 0 0 1-2 3.4h-4.4M8.6 17.4H4.4a2.3 2.3 0 0 1-2-3.4l1.4-2.4"/><path d="m14.4 3.8 1 1.9-2.1.3M16.8 19.5l-1.6-2.1 1.6-1.6M3 9.7l2.3-.3.6 2.1"/>',
    marteau: '<path d="m14 6 4 4M12.5 7.5l-8.3 8.3a1.9 1.9 0 0 0 2.7 2.7l8.3-8.3"/><path d="m13 4 3.2-1.5 5.3 5.3L20 11"/>',
    fleche: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    croix: '<path d="M6 6l12 12M18 6 6 18"/>',
    loupe: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
    etoile: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
    coche: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    horloge: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>'
  };
  const ico = (n, t, extra) => `<svg class="ct-ico${extra ? ' ' + extra : ''}" width="${t || 18}" height="${t || 18}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONES[n] || ''}</svg>`;

  // L'emblème de la marque, en traits : une onde dans un disque.
  const EMBLEME = `<svg class="ct-embleme" viewBox="0 0 100 100" aria-hidden="true">
    <circle cx="50" cy="50" r="46" fill="none" stroke="currentColor" stroke-width="2" opacity=".55"/>
    <circle cx="50" cy="50" r="36" fill="none" stroke="currentColor" stroke-width="1" opacity=".3"/>
    <path d="M14 54c8 0 8-14 16-14s8 22 16 22 8-30 16-30 8 22 16 22 6-8 10-8" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;

  // ---------------------------------------------------------------------
  // La feuille de style
  // ---------------------------------------------------------------------

  const STYLE = `
  @property --ct-a{syntax:'<angle>'; inherits:false; initial-value:0deg;}

  .ct, .ct-scene, .ct-voile{
    --r1:#B4BDC8; --r2:#4FB4FF; --r3:#A879FF; --r4:#F2C14E; --r5:#FF5C8A;
    --ct-surface:rgba(255,255,255,.04); --ct-surface-2:rgba(255,255,255,.07);
    --ct-trait:rgba(255,255,255,.08); --ct-trait-fort:rgba(255,255,255,.15);
    --ct-accent:#4FB4FF; --ct-accent-fonce:#1489DE; --ct-ok:#5BE0A6;
  }
  .ct *, .ct-scene *, .ct-voile *{box-sizing:border-box;}
  .ct button, .ct-scene button, .ct-voile button{font:inherit;}
  .ct{max-width:1120px; margin:0 auto; padding:0 16px 72px; color:var(--ink);}
  .ct-ico{flex:none; display:block;}

  /* ---------- boutons ---------- */
  .ct-btn{all:unset; box-sizing:border-box; cursor:pointer; display:inline-flex; align-items:center; justify-content:center; gap:8px; min-height:42px; padding:0 18px; border-radius:12px; font-size:14px; font-weight:600; color:var(--ink); background:var(--ct-surface-2); border:1px solid var(--ct-trait-fort); transition:background .15s, border-color .15s, transform .15s, opacity .15s; white-space:nowrap;}
  .ct-btn:hover{background:rgba(255,255,255,.11);}
  .ct-btn:active{transform:scale(.98);}
  .ct-btn:focus-visible{outline:2px solid var(--ct-accent); outline-offset:2px;}
  .ct-btn.principal{color:#fff; background:linear-gradient(180deg, #2C9BEF, #1478C9); border-color:rgba(255,255,255,.18); box-shadow:0 8px 24px -10px rgba(20,137,222,.9), inset 0 1px 0 rgba(255,255,255,.25);}
  .ct-btn.principal:hover{background:linear-gradient(180deg, #3AA6F5, #1A83D6);}
  .ct-btn.blanc{color:#05070a; background:#F4F5F6; border-color:#F4F5F6;}
  .ct-btn.blanc:hover{background:#fff;}
  .ct-btn.petit{min-height:34px; padding:0 13px; font-size:13px; border-radius:10px;}
  .ct-btn.grand{min-height:50px; padding:0 24px; font-size:15px; border-radius:14px;}
  .ct-btn[disabled]{opacity:.4; cursor:default; transform:none; box-shadow:none;}
  .ct-btn .cout{display:inline-flex; align-items:center; gap:3px; margin-left:2px; padding:3px 7px 3px 5px; border-radius:7px; font-size:12px; background:rgba(0,0,0,.22);}
  .ct-btn-ico{all:unset; box-sizing:border-box; cursor:pointer; width:38px; height:38px; display:grid; place-items:center; border-radius:11px; color:var(--ink-soft); border:1px solid var(--ct-trait); background:var(--ct-surface);}
  .ct-btn-ico:hover{color:var(--ink); background:var(--ct-surface-2);}
  .ct-btn-ico:focus-visible{outline:2px solid var(--ct-accent); outline-offset:2px;}

  /* ---------- panneaux ---------- */
  .ct-panneau{position:relative; border-radius:20px; border:1px solid var(--ct-trait); background:linear-gradient(180deg, rgba(255,255,255,.045), rgba(255,255,255,.02)); padding:20px;}
  .ct-panneau h3{margin:0; font-size:15px; font-weight:700; letter-spacing:-.005em;}
  .ct-panneau .sous{margin:4px 0 0; font-size:13px; color:var(--muted); line-height:1.5;}
  .ct-entete-panneau{display:flex; align-items:flex-start; justify-content:space-between; gap:12px; margin-bottom:16px;}
  .ct-puce-temps{display:inline-flex; align-items:center; gap:6px; padding:5px 10px; border-radius:99px; font-size:12px; color:var(--ink-soft); background:var(--ct-surface-2); white-space:nowrap; font-variant-numeric:tabular-nums;}
  .ct-vide{padding:48px 16px; text-align:center; color:var(--muted); font-size:14px; line-height:1.6;}
  .ct-vide b{display:block; margin-bottom:6px; font-size:17px; color:var(--ink);}
  .ct-titre-sec{display:flex; align-items:baseline; justify-content:space-between; gap:12px; margin:28px 0 12px;}
  .ct-titre-sec h3{margin:0; font-size:13px; font-weight:600; letter-spacing:.1em; text-transform:uppercase; color:var(--muted);}
  .ct-lien{all:unset; cursor:pointer; font-size:13px; color:var(--ct-accent); display:inline-flex; align-items:center; gap:4px;}
  .ct-lien:hover{text-decoration:underline;}
  .ct-barre{position:relative; display:block; height:6px; border-radius:99px; background:rgba(255,255,255,.08); overflow:hidden;}
  .ct-barre i{position:absolute; inset:0 auto 0 0; border-radius:99px; background:linear-gradient(90deg, var(--ct-accent-fonce), var(--ct-accent)); transition:width .6s cubic-bezier(.2,.8,.2,1);}
  .ct-barre.or i{background:linear-gradient(90deg, #d79a2b, #F2C14E);}

  /* ---------- en-tête du joueur ---------- */
  .ct-tete{display:flex; align-items:center; gap:14px; padding:12px 12px 12px 14px; border-radius:20px; border:1px solid var(--ct-trait); background:rgba(255,255,255,.035); backdrop-filter:blur(18px); -webkit-backdrop-filter:blur(18px);}
  .ct-niv{position:relative; width:46px; height:46px; flex:none;}
  .ct-niv svg{width:100%; height:100%; transform:rotate(-90deg);}
  .ct-niv b{position:absolute; inset:0; display:grid; place-items:center; font-size:16px; font-weight:800;}
  .ct-qui{min-width:0; flex:1;}
  .ct-qui b{display:block; font-size:14px;}
  .ct-qui small{display:block; margin-top:2px; font-size:12px; color:var(--muted); font-variant-numeric:tabular-nums;}
  .ct-ress{display:flex; align-items:center; gap:8px; flex-wrap:wrap; justify-content:flex-end;}
  .ct-res{display:flex; align-items:center; gap:8px; height:38px; padding:0 12px; border-radius:11px; border:1px solid var(--ct-trait); background:var(--ct-surface); font-size:14px; font-weight:700; font-variant-numeric:tabular-nums; white-space:nowrap;}
  .ct-res .ct-ico{color:var(--ct-accent);}
  .ct-res.vinyles .ct-ico{color:#F2C14E;}
  .ct-res.garanti{cursor:pointer; color:inherit; font:inherit; font-weight:700; border-color:rgba(168,121,255,.45); background:rgba(168,121,255,.1);}
  .ct-res.garanti .ct-ico{color:var(--r3);}
  .ct-res small{font-size:11.5px; font-weight:500; color:var(--muted);}

  .ct-onglets{display:flex; gap:4px; margin:14px 0 22px; padding:4px; border-radius:14px; border:1px solid var(--ct-trait); background:rgba(255,255,255,.025); overflow-x:auto; scrollbar-width:none;}
  .ct-onglets::-webkit-scrollbar{display:none;}
  .ct-onglet{all:unset; box-sizing:border-box; cursor:pointer; flex:1 0 auto; display:inline-flex; align-items:center; justify-content:center; gap:8px; height:40px; padding:0 16px; border-radius:10px; font-size:14px; font-weight:600; color:var(--muted); transition:color .15s, background .15s;}
  .ct-onglet:hover{color:var(--ink);}
  .ct-onglet.actif{color:#05070a; background:#F4F5F6;}
  .ct-onglet:focus-visible{outline:2px solid var(--ct-accent); outline-offset:-2px;}
  .ct-pastille{min-width:18px; height:18px; padding:0 5px; border-radius:99px; display:inline-grid; place-items:center; font-size:11px; font-weight:700; color:#fff; background:var(--ct-accent-fonce);}

  /* ---------- la carte d'artiste ---------- */
  .ct-carte{position:relative; container-type:inline-size; aspect-ratio:5 / 7; border-radius:13px; padding:3px; color:#fff; text-align:left;
    background:var(--ct-cadre); box-shadow:0 14px 30px -14px rgba(0,0,0,.8); isolation:isolate; --rc:var(--r1);}
  .ct-carte.r1{--rc:var(--r1); --ct-cadre:linear-gradient(155deg, #e9edf2, #95a0ad 42%, #4e5866 78%, #aeb7c2);}
  .ct-carte.r2{--rc:var(--r2); --ct-cadre:linear-gradient(155deg, #c9ebff, #45a6f4 42%, #12549a 78%, #7fc6ff);}
  .ct-carte.r3{--rc:var(--r3); --ct-cadre:linear-gradient(155deg, #ecdcff, #9466f7 42%, #4b2399 78%, #c4a3ff);}
  .ct-carte.r4{--rc:var(--r4); --ct-cadre:linear-gradient(155deg, #fff6c9, #eab645 38%, #95600f 70%, #f9dc7e);}
  .ct-carte.r5{--rc:var(--r5); --ct-cadre:conic-gradient(from var(--ct-a), #ff5c8a, #ffb547, #fff27a, #5cffc8, #5cb8ff, #b36bff, #ff5c8a);}
  .ct-c-in{position:relative; width:100%; height:100%; border-radius:10px; overflow:hidden; background:#0b0f15;}
  .ct-c-photo{position:absolute; inset:0; width:100%; height:100%; max-width:none; object-fit:cover; display:block; transition:transform .5s cubic-bezier(.2,.8,.2,1);}
  .ct-c-voile{position:absolute; inset:0; background:linear-gradient(180deg, rgba(5,7,10,.35) 0%, rgba(5,7,10,0) 22%, rgba(5,7,10,0) 46%, rgba(5,7,10,.7) 72%, rgba(5,7,10,.96) 100%);}
  .ct-c-num{position:absolute; top:5.5cqw; left:5.5cqw; padding:1.6cqw 3.6cqw; border-radius:99px; font-size:max(8px, 6.6cqw); font-weight:700; letter-spacing:.02em; font-variant-numeric:tabular-nums; color:#fff; background:rgba(5,7,10,.5); backdrop-filter:blur(6px); -webkit-backdrop-filter:blur(6px);}
  .ct-c-gemme{position:absolute; top:7cqw; right:7.5cqw; width:7.5cqw; height:7.5cqw; min-width:7px; min-height:7px; transform:rotate(45deg); border-radius:1.6cqw; background:var(--rc); box-shadow:0 0 0 1.5px rgba(255,255,255,.75) inset, 0 0 12px var(--rc);}
  .ct-c-bas{position:absolute; left:6.5cqw; right:6.5cqw; bottom:6cqw;}
  .ct-c-nom{font-size:max(11px, 10.5cqw); font-weight:800; line-height:1.05; letter-spacing:-.015em; text-shadow:0 2px 14px rgba(0,0,0,.55); overflow-wrap:anywhere; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;}
  .ct-c-meta{display:flex; justify-content:space-between; gap:4px; margin-top:2.6cqw; font-size:max(7.5px, 5.8cqw); font-weight:700; letter-spacing:.08em; text-transform:uppercase; color:rgba(255,255,255,.7);}
  .ct-c-meta .rar{color:var(--rc); filter:brightness(1.15);}
  .ct-c-reflet{position:absolute; inset:0; pointer-events:none; opacity:0; transition:opacity .3s;}
  .ct-carte.r4 .ct-c-reflet, .ct-carte.r5 .ct-c-reflet{opacity:1; background:linear-gradient(115deg, transparent 38%, rgba(255,255,255,.22) 48%, transparent 58%); background-size:300% 100%; background-position:var(--ct-lum, 120%) 0;}
  .ct-carte.holo .ct-c-reflet{opacity:.55; mix-blend-mode:color-dodge;
    background:linear-gradient(115deg, transparent 15%, rgba(255,60,190,.65) 30%, rgba(60,255,255,.6) 42%, rgba(255,255,90,.6) 54%, rgba(120,90,255,.6) 66%, transparent 80%);
    background-size:260% 260%; background-position:var(--hx, 50%) var(--hy, 50%);}
  .ct-carte.holo .ct-c-in::after{content:''; position:absolute; inset:0; pointer-events:none; opacity:.35; mix-blend-mode:overlay;
    background-image:radial-gradient(circle at 20% 30%, #fff 0 1px, transparent 1.5px), radial-gradient(circle at 70% 60%, #fff 0 1px, transparent 1.5px), radial-gradient(circle at 40% 80%, #fff 0 1px, transparent 1.5px);
    background-size:23px 23px, 31px 31px, 17px 17px;}
  .ct-c-holo{position:absolute; top:5.5cqw; left:50%; transform:translateX(-50%); padding:1.4cqw 3.4cqw; border-radius:99px; font-size:max(7px, 5.6cqw); font-weight:800; letter-spacing:.12em; color:#05070a; background:linear-gradient(90deg, #ff9ad5, #9af7ff, #fff59a);}
  .ct-carte.vivante.r4, .ct-carte.r4:hover{box-shadow:0 0 0 1px rgba(242,193,78,.35), 0 0 34px -6px rgba(242,193,78,.55), 0 14px 30px -14px rgba(0,0,0,.8);}
  .ct-carte.vivante.r5, .ct-carte.r5:hover{box-shadow:0 0 40px -6px rgba(255,92,138,.55), 0 14px 30px -14px rgba(0,0,0,.8);}
  .ct-carte.vivante.r5{animation:ctBord 5s linear infinite;}
  .ct-carte.vivante.r4 .ct-c-reflet, .ct-carte.vivante.r5 .ct-c-reflet{animation:ctLum 3.6s ease-in-out infinite;}
  @media (hover:hover){
    .ct-carte.r5:hover{animation:ctBord 5s linear infinite;}
    .ct-carte.r4:hover .ct-c-reflet, .ct-carte.r5:hover .ct-c-reflet{animation:ctLum 2.4s ease-in-out infinite;}
    .ct-case:hover .ct-c-photo{transform:scale(1.04);}
  }
  .ct-carte.verrou{--ct-cadre:linear-gradient(155deg, #2c333d, #161b22 60%, #252c35); box-shadow:none;}
  .ct-carte.verrou .ct-c-photo{filter:grayscale(1) brightness(.26) contrast(1.15);}
  .ct-carte.verrou .ct-c-gemme{opacity:.45; box-shadow:none;}
  .ct-carte.verrou .ct-c-nom{color:rgba(255,255,255,.55); text-shadow:none;}
  .ct-carte.verrou .ct-c-meta{color:rgba(255,255,255,.35);}
  @container (max-width:120px){
    .ct-c-meta span:last-child, .ct-c-holo{display:none;}
    .ct-c-nom{font-size:11px;}
  }
  .ct-c-cadenas{position:absolute; left:50%; top:42%; transform:translate(-50%, -50%); width:16cqw; height:16cqw; color:rgba(255,255,255,.5);}
  .ct-c-cadenas svg{width:100%; height:100%;}
  .ct-c-badge{position:absolute; z-index:3; top:-7px; right:-7px; min-width:26px; height:24px; padding:0 7px; border-radius:99px; display:grid; place-items:center; font-size:12px; font-weight:800; color:#05070a; background:#F4F5F6; box-shadow:0 4px 12px rgba(0,0,0,.45); font-variant-numeric:tabular-nums;}
  .ct-c-nouveau{position:absolute; z-index:3; left:50%; top:-9px; transform:translateX(-50%); height:22px; padding:0 10px; border-radius:99px; display:grid; place-items:center; font-size:10.5px; font-weight:800; letter-spacing:.1em; text-transform:uppercase; color:#04131f; background:var(--ct-accent); box-shadow:0 4px 14px rgba(79,180,255,.5); white-space:nowrap;}

  .ct-case{all:unset; box-sizing:border-box; display:block; cursor:pointer; border-radius:13px; transition:transform .2s cubic-bezier(.2,.8,.2,1);}
  .ct-case:hover{transform:translateY(-4px);}
  .ct-case:focus-visible{outline:2px solid var(--ct-accent); outline-offset:3px;}
  .ct-grille{display:grid; grid-template-columns:repeat(auto-fill, minmax(150px, 1fr)); gap:18px 14px;}
  .ct-ruban{display:grid; grid-auto-flow:column; grid-auto-columns:minmax(130px, 150px); gap:14px; overflow-x:auto; padding:10px 2px 6px; scrollbar-width:none;}
  .ct-ruban::-webkit-scrollbar{display:none;}

  /* ---------- Packs ---------- */
  .ct-hero{display:grid; grid-template-columns:minmax(0, 1.1fr) minmax(0, .9fr); align-items:center; gap:24px; padding:32px; overflow:hidden;
    background:radial-gradient(70% 90% at 85% 40%, rgba(20,137,222,.22), transparent 70%), radial-gradient(60% 80% at 0% 100%, rgba(122,77,255,.12), transparent 70%), linear-gradient(180deg, rgba(255,255,255,.045), rgba(255,255,255,.015));}
  .ct-surtitre{display:inline-flex; align-items:center; gap:7px; font-size:12px; font-weight:700; letter-spacing:.12em; text-transform:uppercase; color:var(--ct-accent);}
  .ct-hero h2{margin:10px 0 0; font-size:clamp(28px, 4vw, 40px); line-height:1.04; letter-spacing:-.025em;}
  .ct-hero p{margin:12px 0 0; max-width:44ch; font-size:15px; line-height:1.6; color:var(--ink-soft);}
  .ct-hero-actions{display:flex; flex-wrap:wrap; gap:10px; margin-top:24px;}
  .ct-hero-note{display:flex; align-items:center; gap:7px; margin-top:14px; font-size:13px; color:var(--muted);}
  .ct-hero-pack{display:grid; place-items:center; min-height:330px; perspective:900px;}
  .ct-hero-pack .ct-pack{cursor:pointer; animation:ctFlotte 5s ease-in-out infinite;}

  .ct-taux{display:flex; height:10px; border-radius:99px; overflow:hidden; gap:2px; margin:16px 0 12px;}
  .ct-taux i{display:block; height:100%; min-width:4px;}
  .ct-legende{display:grid; grid-template-columns:repeat(5, minmax(0, 1fr)); gap:8px;}
  .ct-legende div{font-size:12px; color:var(--muted);}
  .ct-legende b{display:flex; align-items:center; gap:6px; font-size:14px; color:var(--ink); font-variant-numeric:tabular-nums;}
  .ct-legende b::before{content:''; width:8px; height:8px; border-radius:2px; transform:rotate(45deg); background:var(--rc);}
  .ct-evts{display:flex; flex-wrap:wrap; gap:8px; margin-top:14px;}
  .ct-evt{display:inline-flex; align-items:center; gap:7px; padding:7px 12px; border-radius:10px; font-size:13px; color:var(--ink); background:rgba(242,193,78,.1); border:1px solid rgba(242,193,78,.3);}
  .ct-attente{display:flex; align-items:center; gap:14px; margin-top:16px; padding:14px 16px; border-radius:16px; border:1px solid rgba(79,180,255,.3); background:rgba(20,137,222,.08); cursor:pointer; width:100%; color:inherit; font:inherit; text-align:left;}
  .ct-attente:hover{background:rgba(20,137,222,.13);}
  .ct-attente .ct-ico{color:var(--ct-accent);}
  .ct-attente b{font-size:14px;}
  .ct-attente span{display:block; font-size:13px; color:var(--muted);}
  .ct-attente .ct-ico:last-child{margin-left:auto;}

  /* ---------- le pack ---------- */
  .ct-pack{--pk-w:210px; position:relative; width:var(--pk-w); aspect-ratio:.66; transform-style:preserve-3d; user-select:none; -webkit-user-select:none; touch-action:none;
    --pk-fond:radial-gradient(90% 55% at 25% 18%, rgba(110,200,255,.85) 0%, rgba(110,200,255,0) 60%), radial-gradient(80% 60% at 85% 85%, rgba(122,77,255,.75) 0%, rgba(122,77,255,0) 65%), linear-gradient(160deg, #0d3a66 0%, #0a1c36 48%, #120f33 100%);
    filter:drop-shadow(0 30px 40px rgba(0,0,0,.55)) drop-shadow(0 0 40px rgba(20,137,222,.25));}
  .ct-pack.garanti{--pk-fond:radial-gradient(90% 55% at 25% 18%, rgba(255,215,120,.85) 0%, rgba(255,215,120,0) 60%), radial-gradient(80% 60% at 85% 85%, rgba(200,90,255,.8) 0%, rgba(200,90,255,0) 65%), linear-gradient(160deg, #5b2a8a 0%, #2a1250 50%, #3a1636 100%);
    filter:drop-shadow(0 30px 40px rgba(0,0,0,.55)) drop-shadow(0 0 44px rgba(168,121,255,.4));}
  .ct-pk-haut, .ct-pk-corps{position:absolute; left:0; right:0; overflow:hidden; background:var(--pk-fond);}
  .ct-pk-haut{top:0; height:14%; border-radius:12px 12px 3px 3px; background-size:100% 714.3%; background-position:50% 0;}
  .ct-pk-corps{bottom:0; height:86%; border-radius:3px 3px 12px 12px; background-size:100% 116.3%; background-position:50% 100%;}
  .ct-pk-haut::before, .ct-pk-corps::after{content:''; position:absolute; left:0; right:0; height:9px; background:repeating-linear-gradient(90deg, rgba(255,255,255,.28) 0 2px, rgba(255,255,255,.05) 2px 5px);}
  .ct-pk-haut::before{top:0;}
  .ct-pk-corps::after{bottom:0;}
  .ct-pk-haut::after, .ct-pk-corps::before{content:''; position:absolute; inset:0; pointer-events:none; background:linear-gradient(115deg, transparent 35%, rgba(255,255,255,.35) 47%, transparent 58%); background-size:280% 100%; animation:ctLum 4s ease-in-out infinite;}
  .ct-pk-contenu{position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:6%; padding:12% 10% 14%; color:#fff; text-align:center;}
  .ct-pk-contenu .ct-embleme{width:58%; color:#fff; filter:drop-shadow(0 0 14px rgba(255,255,255,.35));}
  .ct-pk-marque{font-size:calc(var(--pk-w) * .095); font-weight:800; letter-spacing:.32em; margin-right:-.32em;}
  .ct-pk-type{font-size:calc(var(--pk-w) * .05); font-weight:700; letter-spacing:.22em; text-transform:uppercase; opacity:.75;}
  .ct-pk-pied{position:absolute; left:0; right:0; bottom:9%; text-align:center; font-size:calc(var(--pk-w) * .046); font-weight:600; letter-spacing:.14em; text-transform:uppercase; opacity:.6;}
  .ct-pk-ligne{position:absolute; left:0; top:14%; height:2px; width:calc(var(--dech, 0) * 100%); margin-top:-1px; background:#fff; box-shadow:0 0 10px #fff, 0 0 22px var(--teinte, #4FB4FF); border-radius:2px; z-index:3;}
  .ct-pk-lumiere{position:absolute; left:50%; top:14%; width:160%; aspect-ratio:1; transform:translate(-50%, -50%) scale(0); border-radius:50%; pointer-events:none; z-index:4;
    background:radial-gradient(circle, #fff 0%, var(--teinte, #4FB4FF) 22%, transparent 62%); opacity:0;}
  .ct-pk-pile{position:absolute; inset:0; border-radius:12px; background:linear-gradient(160deg, #0b2f55, #0a1730); border:1px solid rgba(255,255,255,.12);}
  .ct-pk-nombre{position:absolute; z-index:5; right:-12px; top:-12px; min-width:40px; height:40px; padding:0 10px; border-radius:99px; display:grid; place-items:center; font-size:15px; font-weight:800; color:#05070a; background:#fff; box-shadow:0 8px 20px rgba(0,0,0,.4);}
  .ct-pk-indice{position:absolute; z-index:6; left:8%; top:14%; width:30px; height:30px; margin-top:-15px; border-radius:50%; background:rgba(255,255,255,.9); box-shadow:0 0 0 6px rgba(255,255,255,.18), 0 0 24px rgba(255,255,255,.6); animation:ctIndice 1.8s cubic-bezier(.5,0,.2,1) infinite; pointer-events:none;}

  /* ---------- la scène d'ouverture ---------- */
  .ct-scene{position:fixed; inset:0; z-index:500; display:flex; flex-direction:column; color:#fff; overflow:hidden; touch-action:manipulation; animation:ctFondu .3s ease both;}
  .ct-scene-fond{position:absolute; inset:0; background:radial-gradient(60% 55% at 50% 45%, color-mix(in srgb, var(--teinte, #1489DE) 22%, #070a10) 0%, #030407 72%); transition:background .8s ease;}
  .ct-scene-fond::after{content:''; position:absolute; inset:0; background:radial-gradient(120% 90% at 50% 50%, transparent 55%, rgba(0,0,0,.7) 100%);}
  .ct-scene canvas{position:absolute; inset:0; width:100%; height:100%; pointer-events:none; z-index:6;}
  .ct-scene-x{all:unset; position:absolute; z-index:8; top:max(14px, env(safe-area-inset-top)); right:14px; width:42px; height:42px; display:grid; place-items:center; border-radius:12px; cursor:pointer; color:rgba(255,255,255,.8); background:rgba(255,255,255,.08); border:1px solid rgba(255,255,255,.12);}
  .ct-scene-x:hover{background:rgba(255,255,255,.14);}
  .ct-scene-x:focus-visible{outline:2px solid #fff;}
  .ct-scene-centre{position:relative; z-index:3; flex:1; min-height:0; display:grid; place-items:center; padding:64px 16px 8px; perspective:1200px;}
  .ct-scene-pied{position:relative; z-index:7; min-height:96px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:12px; padding:8px 16px max(22px, env(safe-area-inset-bottom)); text-align:center;}
  .ct-scene-pied p{margin:0; font-size:14px; color:rgba(255,255,255,.72);}
  .ct-scene-pied .boutons{display:flex; gap:10px; flex-wrap:wrap; justify-content:center;}
  .ct-scene .ct-btn{border-color:rgba(255,255,255,.16);}
  .ct-flash{position:absolute; inset:0; z-index:5; pointer-events:none; opacity:0; background:radial-gradient(circle at 50% 45%, #fff, var(--teinte, #fff) 40%, transparent 75%);}
  .ct-flash.on{animation:ctFlash .8s ease-out;}
  .ct-rayons{position:absolute; left:50%; top:45%; width:170vmax; height:170vmax; transform:translate(-50%, -50%); pointer-events:none; z-index:1; opacity:0; transition:opacity .6s;
    background:repeating-conic-gradient(from 0deg, color-mix(in srgb, var(--teinte) 45%, transparent) 0deg 4deg, transparent 4deg 15deg);
    -webkit-mask-image:radial-gradient(circle, #000 0%, transparent 42%); mask-image:radial-gradient(circle, #000 0%, transparent 42%); animation:ctTourne 40s linear infinite;}
  .ct-rayons.on{opacity:.7;}
  .ct-scene.secousse .ct-scene-centre{animation:ctSecousse .55s cubic-bezier(.36,.07,.19,.97);}
  .ct-scene-pack{position:relative; transition:transform .6s cubic-bezier(.2,.8,.2,1), opacity .5s;}
  .ct-scene-pack .ct-pack{--pk-w:min(240px, 56vw); animation:ctArrivee .7s cubic-bezier(.2,1.3,.4,1) both;}
  .ct-scene-pack.tremble .ct-pack{animation:ctTremble .12s linear infinite;}
  .ct-pk-haut.part{transition:transform .65s cubic-bezier(.3,.6,.2,1), opacity .65s; transform:translate(-18%, -230%) rotate(-28deg); opacity:0;}
  .ct-pk-lumiere.on{animation:ctLumiere .9s ease-out forwards;}
  .ct-scene-pack.parti{transform:translateY(55vh) scale(.8) rotate(6deg); opacity:0;}

  .ct-donne{display:grid; gap:40px 14px; width:min(1000px, 100%); grid-template-columns:repeat(var(--cols, 5), minmax(0, 1fr)); justify-items:center; align-content:center;}
  .ct-place{position:relative; width:100%; max-width:var(--lc, 180px); perspective:1000px;}
  .ct-donne.seule .ct-place{--lc:min(300px, 66vw, 40vh);}
  .ct-volte{position:relative; width:100%; aspect-ratio:5 / 7; cursor:pointer; transform-style:preserve-3d; transition:transform .75s cubic-bezier(.2,.75,.25,1);}
  .ct-volte:focus-visible{outline:2px solid #fff; outline-offset:4px; border-radius:14px;}
  .ct-place.retournee .ct-volte{transform:rotateY(180deg);}
  .ct-place.donne{animation:ctDonne .6s cubic-bezier(.2,.9,.25,1) both;}
  .ct-dos, .ct-face{position:absolute; inset:0; backface-visibility:hidden; -webkit-backface-visibility:hidden; border-radius:13px;}
  .ct-face{transform:rotateY(180deg);}
  .ct-face .ct-carte{width:100%; height:100%;}
  .ct-dos{display:grid; place-items:center; padding:3px; background:linear-gradient(155deg, #3c4757, #1a212b 50%, #2d3644); box-shadow:0 18px 40px -16px rgba(0,0,0,.9);}
  .ct-dos-in{width:100%; height:100%; border-radius:10px; display:grid; place-items:center; color:rgba(255,255,255,.85);
    background:radial-gradient(80% 60% at 50% 40%, rgba(79,180,255,.25), transparent 70%), repeating-linear-gradient(45deg, rgba(255,255,255,.035) 0 6px, transparent 6px 12px), linear-gradient(160deg, #0d2b4c, #08121f);}
  .ct-dos-in .ct-embleme{width:52%;}
  .ct-dos[data-r="2"]{box-shadow:0 0 0 1px rgba(79,180,255,.5), 0 0 26px -2px rgba(79,180,255,.55), 0 18px 40px -16px rgba(0,0,0,.9);}
  .ct-dos[data-r="3"]{box-shadow:0 0 0 1px rgba(168,121,255,.6), 0 0 34px 0 rgba(168,121,255,.6), 0 18px 40px -16px rgba(0,0,0,.9); animation:ctPouls 1.6s ease-in-out infinite; --pc:rgba(168,121,255,.75);}
  .ct-dos[data-r="4"]{box-shadow:0 0 0 1px rgba(242,193,78,.7), 0 0 42px 2px rgba(242,193,78,.65), 0 18px 40px -16px rgba(0,0,0,.9); animation:ctPouls 1.1s ease-in-out infinite; --pc:rgba(242,193,78,.85);}
  .ct-dos[data-r="5"]{box-shadow:0 0 0 1px rgba(255,92,138,.8), 0 0 50px 4px rgba(255,92,138,.7), 0 18px 40px -16px rgba(0,0,0,.9); animation:ctPouls .8s ease-in-out infinite; --pc:rgba(255,120,180,.95);}
  .ct-place.charge .ct-volte{animation:ctCharge .09s linear infinite;}
  .ct-place.charge .ct-dos{filter:brightness(1.35);}
  .ct-etiq{position:absolute; left:50%; top:calc(100% + 12px); transform:translateX(-50%); z-index:4; white-space:nowrap; pointer-events:none;
    padding:6px 14px; border-radius:99px; font-size:12px; font-weight:800; letter-spacing:.14em; text-transform:uppercase; color:#05070a; background:var(--rc); box-shadow:0 6px 18px rgba(0,0,0,.35); animation:ctEtiq .5s cubic-bezier(.2,1.4,.4,1) both;}
  .ct-etiq.nouveau{background:var(--ct-accent);}
  .ct-etiq.double{background:rgba(255,255,255,.9);}
  .ct-donne:not(.seule) .ct-etiq{top:calc(100% + 8px); font-size:10px; padding:4px 9px; letter-spacing:.1em;}
  .ct-titre-rar{position:absolute; left:0; right:0; top:12%; z-index:4; text-align:center; pointer-events:none; font-size:clamp(28px, 7vw, 64px); font-weight:900; letter-spacing:.18em; text-transform:uppercase;
    color:#fff; text-shadow:0 0 30px var(--teinte), 0 0 60px var(--teinte); animation:ctTitre 1.6s cubic-bezier(.2,.8,.2,1) both;}
  .ct-bilan{display:flex; flex-wrap:wrap; justify-content:center; gap:8px;}
  .ct-bilan span{display:inline-flex; align-items:center; gap:6px; padding:6px 12px; border-radius:99px; font-size:13px; font-weight:600; background:rgba(255,255,255,.08); border:1px solid rgba(255,255,255,.1);}
  .ct-bilan span i{width:8px; height:8px; border-radius:2px; transform:rotate(45deg); background:var(--rc);}

  /* ---------- fenêtres ---------- */
  .ct-voile{position:fixed; inset:0; z-index:520; display:flex; align-items:center; justify-content:center; padding:16px; background:rgba(3,5,8,.72); backdrop-filter:blur(14px); -webkit-backdrop-filter:blur(14px); animation:ctFondu .2s ease both;}
  .ct-fen{position:relative; width:min(520px, 100%); max-height:min(92vh, 860px); overflow-y:auto; scrollbar-width:thin; padding:24px; border-radius:22px; border:1px solid var(--ct-trait-fort); background:linear-gradient(180deg, #10151d, #0a0e14); color:var(--ink); box-shadow:0 40px 80px -20px rgba(0,0,0,.8); animation:ctMonte .35s cubic-bezier(.2,.8,.2,1) both;}
  .ct-fen.large{width:min(880px, 100%);}
  .ct-fen h2{margin:0; font-size:20px; letter-spacing:-.01em; padding-right:40px;}
  .ct-fen .sous{margin:6px 0 0; font-size:14px; color:var(--muted); line-height:1.5;}
  .ct-fermer{all:unset; position:absolute; top:14px; right:14px; z-index:2; width:36px; height:36px; display:grid; place-items:center; border-radius:10px; cursor:pointer; color:var(--ink-soft); background:rgba(255,255,255,.06);}
  .ct-fermer:hover{background:rgba(255,255,255,.12); color:var(--ink);}
  .ct-fermer:focus-visible{outline:2px solid var(--ct-accent);}

  .ct-fiche{display:grid; grid-template-columns:minmax(0, 280px) minmax(0, 1fr); gap:28px; align-items:start;}
  .ct-fiche-carte{perspective:900px;}
  .ct-fiche-carte .ct-carte{transition:transform .2s ease-out;}
  .ct-fiche-num{display:inline-block; padding:4px 9px; border-radius:99px; font-size:12px; font-weight:700; background:var(--ct-surface-2); font-variant-numeric:tabular-nums;}
  .ct-fiche h2{margin-top:10px; font-size:28px; letter-spacing:-.02em;}
  .ct-fiche-rar{display:inline-flex; align-items:center; gap:8px; margin-top:8px; font-size:13px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; color:var(--rc);}
  .ct-fiche-rar::before{content:''; width:9px; height:9px; border-radius:2px; transform:rotate(45deg); background:var(--rc);}
  .ct-stats{display:grid; grid-template-columns:repeat(3, minmax(0, 1fr)); gap:8px; margin:18px 0 0;}
  .ct-stat{padding:12px; border-radius:14px; background:var(--ct-surface); border:1px solid var(--ct-trait);}
  .ct-stat b{display:block; font-size:17px; font-variant-numeric:tabular-nums;}
  .ct-stat span{display:block; margin-top:2px; font-size:12px; color:var(--muted);}
  .ct-pochettes{display:grid; grid-template-columns:repeat(6, minmax(0, 1fr)); gap:8px;}
  .ct-pochette{all:unset; cursor:pointer; display:block; aspect-ratio:1; border-radius:8px; overflow:hidden; background:#0b0f15; box-shadow:0 0 0 1px var(--ct-trait);}
  .ct-pochette img{width:100%; height:100%; object-fit:cover; max-width:none; display:block; transition:transform .3s;}
  .ct-pochette:hover img{transform:scale(1.06);}
  .ct-pochette:focus-visible{outline:2px solid var(--ct-accent);}
  .ct-actions{display:flex; flex-wrap:wrap; gap:8px; margin-top:18px;}
  .ct-ligne-act{display:flex; align-items:center; gap:10px; flex-wrap:wrap; padding:14px; margin-top:12px; border-radius:14px; background:var(--ct-surface); border:1px solid var(--ct-trait);}
  .ct-ligne-act .tx{flex:1; min-width:150px; font-size:13px; color:var(--ink-soft); line-height:1.4;}
  .ct-ligne-act .tx b{display:block; color:var(--ink); font-size:14px;}
  .ct-ligne-act select{height:34px; padding:0 8px; border-radius:9px; border:1px solid var(--ct-trait-fort); background:rgba(255,255,255,.05); color:var(--ink); font:inherit; font-size:13px;}

  /* ---------- Collection ---------- */
  .ct-prog{display:grid; grid-template-columns:auto minmax(0, 1fr); gap:10px 22px; align-items:center;}
  .ct-prog-chiffre{font-size:34px; font-weight:800; letter-spacing:-.02em; font-variant-numeric:tabular-nums; line-height:1;}
  .ct-prog-chiffre small{font-size:15px; font-weight:500; color:var(--muted); letter-spacing:0;}
  .ct-prog-droite{min-width:0;}
  .ct-prog-droite .lib{display:flex; align-items:center; justify-content:space-between; gap:10px; font-size:13px; color:var(--muted); margin-bottom:8px;}
  .ct-raretes{grid-column:1 / -1; display:grid; grid-template-columns:repeat(5, minmax(0, 1fr)); gap:8px; margin-top:6px;}
  .ct-rar-btn{all:unset; box-sizing:border-box; cursor:pointer; padding:10px 12px; border-radius:12px; border:1px solid var(--ct-trait); background:var(--ct-surface); transition:border-color .15s, background .15s;}
  .ct-rar-btn:hover{background:var(--ct-surface-2);}
  .ct-rar-btn.actif{border-color:var(--rc); background:color-mix(in srgb, var(--rc) 12%, transparent);}
  .ct-rar-btn:focus-visible{outline:2px solid var(--ct-accent);}
  .ct-rar-btn .nom{display:flex; align-items:center; gap:6px; font-size:12px; font-weight:700; color:var(--rc);}
  .ct-rar-btn .nom::before{content:''; width:7px; height:7px; border-radius:2px; transform:rotate(45deg); background:var(--rc);}
  .ct-rar-btn .nb{display:block; margin:4px 0 8px; font-size:13px; color:var(--ink-soft); font-variant-numeric:tabular-nums;}
  .ct-rar-btn .ct-barre{height:4px;}
  .ct-rar-btn .ct-barre i{background:var(--rc);}
  .ct-outils{display:flex; flex-wrap:wrap; gap:10px; align-items:center; margin:16px 0 18px;}
  .ct-recherche{position:relative; flex:1 1 220px; min-width:0;}
  .ct-recherche .ct-ico{position:absolute; left:12px; top:50%; transform:translateY(-50%); color:var(--muted); pointer-events:none;}
  .ct-recherche input{width:100%; height:40px; padding:0 12px 0 38px; border-radius:11px; border:1px solid var(--ct-trait-fort); background:rgba(255,255,255,.04); color:var(--ink); font:inherit; font-size:14px;}
  .ct-recherche input:focus{outline:none; border-color:var(--ct-accent);}
  .ct-segment{display:inline-flex; padding:3px; border-radius:11px; border:1px solid var(--ct-trait); background:rgba(255,255,255,.025); overflow-x:auto; scrollbar-width:none; max-width:100%;}
  .ct-segment button{all:unset; box-sizing:border-box; cursor:pointer; height:32px; padding:0 12px; border-radius:8px; font-size:13px; font-weight:600; color:var(--muted); white-space:nowrap;}
  .ct-segment button:hover{color:var(--ink);}
  .ct-segment button.actif{color:var(--ink); background:rgba(255,255,255,.1);}
  .ct-segment button:focus-visible{outline:2px solid var(--ct-accent); outline-offset:-2px;}
  .ct-select{height:40px; padding:0 10px; border-radius:11px; border:1px solid var(--ct-trait-fort); background:rgba(255,255,255,.04); color:var(--ink); font:inherit; font-size:13.5px;}
  .ct-pages{display:flex; align-items:center; justify-content:center; gap:14px; margin-top:28px; font-size:13px; color:var(--muted); font-variant-numeric:tabular-nums;}

  /* ---------- Missions, Bonus, Succès ---------- */
  .ct-deux{display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:16px; align-items:start;}
  .ct-liste{display:grid; gap:8px;}
  .ct-ligne{display:flex; align-items:center; gap:14px; padding:14px; border-radius:16px; border:1px solid var(--ct-trait); background:var(--ct-surface);}
  .ct-ligne.pret{border-color:rgba(79,180,255,.45); background:rgba(20,137,222,.08);}
  .ct-ligne.fait{opacity:.55;}
  .ct-pastille-ico{width:40px; height:40px; flex:none; border-radius:12px; display:grid; place-items:center; color:var(--ct-accent); background:rgba(79,180,255,.1);}
  .ct-ligne.fait .ct-pastille-ico{color:var(--ct-ok); background:rgba(91,224,166,.1);}
  .ct-ligne .tx{flex:1; min-width:0;}
  .ct-ligne .tx b{display:block; font-size:14px; font-weight:600;}
  .ct-ligne .tx .bas{display:flex; align-items:center; gap:10px; margin-top:8px;}
  .ct-ligne .tx .bas .ct-barre{flex:1;}
  .ct-ligne .tx .bas small{font-size:12px; color:var(--muted); font-variant-numeric:tabular-nums; white-space:nowrap;}
  .ct-gains{display:flex; gap:6px; flex-wrap:wrap; margin-top:8px;}
  .ct-gain{display:inline-flex; align-items:center; gap:4px; height:24px; padding:0 8px; border-radius:7px; font-size:12px; font-weight:700; color:var(--ink-soft); background:rgba(255,255,255,.06); font-variant-numeric:tabular-nums;}
  .ct-gain .ct-ico{color:var(--ct-accent);}
  .ct-gain.v .ct-ico{color:#F2C14E;}
  .ct-gain.g .ct-ico{color:var(--r3);}

  .ct-bonus{display:grid; grid-template-columns:minmax(0, 1fr) minmax(0, 1fr); gap:16px; align-items:start;}
  .ct-bonus .ct-panneau.roue{grid-row:span 2;}
  .ct-serie{display:grid; grid-template-columns:repeat(7, minmax(0, 1fr)); gap:6px; margin-bottom:16px;}
  .ct-jour{position:relative; display:flex; flex-direction:column; align-items:center; gap:5px; padding:10px 2px 9px; border-radius:12px; border:1px solid var(--ct-trait); background:var(--ct-surface); font-size:11px; color:var(--muted); text-align:center;}
  .ct-jour .ct-ico{color:var(--ink-soft);}
  .ct-jour b{font-size:12px; color:var(--ink); font-variant-numeric:tabular-nums; line-height:1.25;}
  .ct-jour.fait{opacity:.45;}
  .ct-jour.fait .ct-ico{color:var(--ct-ok);}
  .ct-jour.aujourdhui{border-color:var(--ct-accent); background:rgba(20,137,222,.12);}
  .ct-jour.aujourdhui .ct-ico{color:var(--ct-accent);}
  .ct-jour.sept{border-color:rgba(168,121,255,.45);}
  .ct-creneaux{display:grid; grid-template-columns:repeat(4, minmax(0, 1fr)); gap:8px;}
  .ct-creneau{display:flex; flex-direction:column; align-items:center; gap:6px; padding:14px 6px 12px; border-radius:14px; border:1px solid var(--ct-trait); background:var(--ct-surface); text-align:center;}
  .ct-creneau .h{font-size:20px; font-weight:800; font-variant-numeric:tabular-nums;}
  .ct-creneau small{font-size:11.5px; color:var(--muted); min-height:1.3em;}
  .ct-creneau.pret{border-color:var(--ct-accent); background:rgba(20,137,222,.12);}
  .ct-creneau.prise .h, .ct-creneau.expire .h{color:var(--muted);}
  .ct-roue-zone{display:flex; flex-direction:column; align-items:center; gap:18px;}
  .ct-roue{position:relative; width:min(100%, 360px); aspect-ratio:1;}
  .ct-roue > svg:last-child{width:100%; height:100%; display:block; overflow:visible;}
  .ct-roue-disque{transform-origin:0 0; transition:transform 5.4s cubic-bezier(.12,.68,.06,1);}
  .ct-roue-pointe{position:absolute; left:50%; top:-8px; z-index:2; width:26px; height:32px; transform:translateX(-50%); filter:drop-shadow(0 4px 8px rgba(0,0,0,.5));}
  .ct-roue-res{min-height:22px; font-size:14px; color:var(--ink-soft); text-align:center;}
  .ct-roue-res b{color:var(--ink);}

  .ct-medaille{width:44px; height:44px; flex:none; border-radius:14px; display:grid; place-items:center; color:var(--muted); background:var(--ct-surface-2);}
  .ct-ligne.pret .ct-medaille{color:#2a1a00; background:linear-gradient(135deg, #ffe08a, #e7a933);}
  .ct-paliers{display:flex; gap:3px;}
  .ct-paliers i{width:6px; height:6px; border-radius:50%; background:rgba(255,255,255,.15);}
  .ct-paliers i.on{background:#F2C14E;}

  /* ---------- messages ---------- */
  .ct-toasts{position:fixed; left:50%; bottom:max(22px, env(safe-area-inset-bottom)); transform:translateX(-50%); z-index:700; display:grid; gap:8px; justify-items:center; pointer-events:none; width:max-content; max-width:calc(100vw - 32px);}
  .ct-toast{display:flex; align-items:center; gap:8px; padding:11px 16px; border-radius:14px; font-size:14px; font-weight:600; color:var(--ink); background:rgba(16,21,29,.92); border:1px solid rgba(255,255,255,.14); box-shadow:0 14px 34px rgba(0,0,0,.45); backdrop-filter:blur(12px); -webkit-backdrop-filter:blur(12px); animation:ctToast .35s cubic-bezier(.2,1.2,.4,1) both;}
  .ct-toast .ct-ico{color:#4FB4FF;}
  .ct-toast.err{border-color:rgba(229,105,92,.5);}
  .ct-toast.err .ct-ico{color:#E5695C;}

  /* ---------- animations ---------- */
  @keyframes ctBord{to{--ct-a:360deg;}}
  @keyframes ctLum{0%{background-position:130% 0;} 55%,100%{background-position:-30% 0;}}
  @keyframes ctFlotte{0%,100%{transform:translateY(0) rotateY(-14deg) rotateZ(-3deg);} 50%{transform:translateY(-12px) rotateY(-6deg) rotateZ(-1deg);}}
  @keyframes ctFondu{from{opacity:0;} to{opacity:1;}}
  @keyframes ctMonte{from{opacity:0; transform:translateY(18px) scale(.98);} to{opacity:1; transform:none;}}
  @keyframes ctToast{from{opacity:0; transform:translateY(12px) scale(.96);} to{opacity:1; transform:none;}}
  @keyframes ctArrivee{from{opacity:0; transform:translateY(-60px) scale(.7) rotate(-8deg);} to{opacity:1; transform:none;}}
  @keyframes ctTremble{0%{transform:translate(0,0) rotate(0);} 25%{transform:translate(-2px,1px) rotate(-1deg);} 50%{transform:translate(2px,-1px) rotate(1deg);} 75%{transform:translate(-1px,-1px) rotate(-.5deg);} 100%{transform:translate(0,0) rotate(0);}}
  @keyframes ctLumiere{0%{opacity:0; transform:translate(-50%, -50%) scale(0);} 25%{opacity:1;} 100%{opacity:0; transform:translate(-50%, -50%) scale(3.2);}}
  @keyframes ctFlash{0%{opacity:.95;} 100%{opacity:0;}}
  @keyframes ctTourne{to{transform:translate(-50%, -50%) rotate(360deg);}}
  @keyframes ctSecousse{10%,90%{transform:translate(-2px, 1px);} 20%,80%{transform:translate(4px, -2px);} 30%,50%,70%{transform:translate(-7px, 3px);} 40%,60%{transform:translate(7px, -3px);}}
  @keyframes ctDonne{from{opacity:0; transform:translate(var(--dx, 0), var(--dy, 0)) scale(.35) rotate(var(--rot, 0deg));} 60%{opacity:1;} to{opacity:1; transform:none;}}
  @keyframes ctPouls{0%,100%{filter:brightness(1);} 50%{filter:brightness(1.25) drop-shadow(0 0 14px var(--pc));}}
  @keyframes ctCharge{0%{transform:translate(0,0) rotate(0);} 25%{transform:translate(-2px,1px) rotate(-1.2deg);} 50%{transform:translate(2px,-1px) rotate(1.2deg);} 75%{transform:translate(-1px,-2px) rotate(-.6deg);} 100%{transform:translate(0,0) rotate(0);}}
  @keyframes ctEtiq{from{opacity:0; transform:translate(-50%, 8px) scale(.7);} to{opacity:1; transform:translate(-50%, 0) scale(1);}}
  @keyframes ctTitre{0%{opacity:0; letter-spacing:.6em; transform:scale(1.2);} 25%{opacity:1; letter-spacing:.18em; transform:scale(1);} 75%{opacity:1;} 100%{opacity:0; transform:translateY(-14px);}}
  @keyframes ctIndice{0%{left:8%; opacity:0;} 15%{opacity:1;} 70%{left:88%; opacity:1;} 100%{left:88%; opacity:0;}}

  @media (max-width:820px){
    .ct-hero{grid-template-columns:1fr; padding:22px 18px 24px;}
    .ct-hero-pack{order:-1; min-height:290px;}
    .ct-deux, .ct-bonus{grid-template-columns:1fr;}
    .ct-bonus .ct-panneau.roue{grid-row:auto;}
    .ct-fiche{grid-template-columns:1fr;}
    .ct-fiche-carte{width:min(260px, 72%); margin:0 auto;}
  }
  @media (max-width:640px){
    .ct{padding:0 12px 90px;}
    .ct-tete{flex-wrap:wrap; gap:10px 12px;}
    .ct-ress{width:100%; flex-wrap:nowrap; justify-content:flex-start; gap:6px;}
    .ct-res{flex:1 1 auto; justify-content:center; gap:6px; padding:0 9px; min-width:0;}
    .ct-res small:not([data-recharge]){display:none;}
    .ct-res small[data-recharge]{white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
    .ct-res:has(small[data-recharge]){flex:2.4 1 auto;}
    .ct-btn-ico{flex:none;}
    .ct-hero-pack{min-height:236px;}
    .ct-hero-pack .ct-pack{--pk-w:150px;}
    .ct-onglet{padding:0 12px; font-size:13px;}
    .ct-onglet .ct-ico{display:none;}
    .ct-hero-actions .ct-btn.grand{flex:1 1 auto; min-height:46px; padding:0 14px;}
    .ct-grille{grid-template-columns:repeat(3, minmax(0, 1fr)); gap:12px 9px;}
    .ct-raretes{grid-template-columns:repeat(6, minmax(0, 1fr)); gap:6px;}
    .ct-rar-btn{grid-column:span 2; padding:9px 10px;}
    .ct-rar-btn:nth-child(n+4){grid-column:span 3;}
    .ct-prog-droite .lib span:last-child{white-space:nowrap;}
    .ct-legende b{font-size:12.5px;} .ct-legende div{font-size:10.5px;}
    .ct-donne{gap:34px 10px;}
    .ct-serie{gap:4px;}
    .ct-jour{padding:8px 1px; font-size:9.5px;} .ct-jour b{font-size:10.5px;}
    .ct-creneaux{grid-template-columns:repeat(2, minmax(0, 1fr));}
    .ct-pochettes{grid-template-columns:repeat(3, minmax(0, 1fr));}
    .ct-fen{padding:20px 16px;}
  }
  @media (prefers-reduced-motion:reduce){
    .ct-carte, .ct-c-reflet, .ct-pack, .ct-hero-pack .ct-pack, .ct-pk-haut::after, .ct-pk-corps::before, .ct-dos, .ct-rayons, .ct-pk-indice{animation:none !important;}
    .ct-volte, .ct-roue-disque{transition-duration:.01s !important;}
  }`;

  function poserStyle(){
    if(document.getElementById('ct-style')) return;
    const s = document.createElement('style');
    s.id = 'ct-style';
    s.textContent = STYLE;
    document.head.appendChild(s);
  }

  // ---------------------------------------------------------------------
  // Petits outils
  // ---------------------------------------------------------------------

  async function appel(nom, args){
    const { data, error } = await BD.jeuAppel(nom, args || {});
    if(error) throw new Error(error.message || 'Une erreur est survenue. Réessaie dans un instant.');
    if(data === null || data === undefined) throw new Error('Connecte-toi pour jouer.');
    return data;
  }

  function toast(texte, genre){
    let boite = document.querySelector('.ct-toasts');
    if(!boite){ boite = el('div', 'ct-toasts'); boite.setAttribute('role', 'status'); document.body.appendChild(boite); }
    const t = el('div', 'ct-toast' + (genre === 'err' ? ' err' : ''), ico(genre === 'err' ? 'croix' : 'coche', 16) + '<span></span>');
    t.querySelector('span').textContent = texte;
    boite.appendChild(t);
    setTimeout(() => { t.style.transition = 'opacity .3s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, genre === 'err' ? 4200 : 2800);
  }

  const vibre = (m) => { try{ if(navigator.vibrate) navigator.vibrate(m); }catch(e){} };

  // ---------------------------------------------------------------------
  // Le son : tout est synthétisé (rien à charger), coupable d'un clic
  // ---------------------------------------------------------------------

  const Son = {
    ctx: null,
    actif(){ try{ return localStorage.getItem('lw-cartes-son') !== '0'; }catch(e){ return true; } },
    basculer(){ const v = !this.actif(); try{ localStorage.setItem('lw-cartes-son', v ? '1' : '0'); }catch(e){} return v; },
    pret(){
      if(!this.actif()) return null;
      try{
        if(!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        if(this.ctx.state === 'suspended') this.ctx.resume();
      }catch(e){ return null; }
      return this.ctx;
    },
    bruit(debut, duree, f0, f1, vol, q){
      const a = this.ctx, n = Math.floor(a.sampleRate * duree), buf = a.createBuffer(1, n, a.sampleRate), d = buf.getChannelData(0);
      for(let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      const src = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain(), t = a.currentTime + debut;
      src.buffer = buf; f.type = 'bandpass'; f.Q.value = q || 1.2;
      f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + duree);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + duree * .15); g.gain.exponentialRampToValueAtTime(0.0001, t + duree);
      src.connect(f); f.connect(g); g.connect(a.destination); src.start(t); src.stop(t + duree + .02);
    },
    cloche(f, debut, duree, vol){
      const a = this.ctx, t = a.currentTime + debut;
      [[1, 1], [2.76, .35], [5.4, .12]].forEach(([m, v]) => {
        const o = a.createOscillator(), g = a.createGain();
        o.type = 'sine'; o.frequency.setValueAtTime(f * m, t);
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol * v, t + .01); g.gain.exponentialRampToValueAtTime(0.0001, t + duree / m);
        o.connect(g); g.connect(a.destination); o.start(t); o.stop(t + duree + .05);
      });
    },
    ton(f0, f1, debut, duree, vol, type){
      const a = this.ctx, t = a.currentTime + debut, o = a.createOscillator(), g = a.createGain();
      o.type = type || 'sine'; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + duree);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + duree * .3); g.gain.exponentialRampToValueAtTime(0.0001, t + duree);
      o.connect(g); g.connect(a.destination); o.start(t); o.stop(t + duree + .05);
    },
    jouer(quoi){
      if(!this.pret()) return;
      try{
        if(quoi === 'dechire'){ this.bruit(0, .38, 900, 3800, .35, .8); this.bruit(.04, .2, 2400, 5200, .18, 2); }
        else if(quoi === 'donne'){ this.bruit(0, .12, 500, 1600, .07, 1.5); }
        else if(quoi === 'volte'){ this.bruit(0, .1, 1800, 700, .1, 1.4); }
        else if(quoi === 'charge'){ this.ton(160, 620, 0, .8, .07, 'sawtooth'); this.ton(320, 1240, 0, .8, .03); }
        else if(quoi === 'r1'){ this.cloche(784, 0, .5, .05); }
        else if(quoi === 'r2'){ this.cloche(880, 0, .7, .07); this.cloche(1175, .08, .7, .05); }
        else if(quoi === 'r3'){ [784, 988, 1319].forEach((f, k) => this.cloche(f, k * .08, 1, .07)); }
        else if(quoi === 'r4'){ [523, 659, 784, 1047, 1319].forEach((f, k) => this.cloche(f, k * .07, 1.4, .07)); this.ton(65, 55, 0, 1.2, .14); }
        else if(quoi === 'r5'){ [392, 523, 659, 784, 1047, 1319, 1568, 2093].forEach((f, k) => this.cloche(f, k * .06, 1.8, .07)); this.ton(55, 41, 0, 1.6, .18); this.bruit(0, 1, 4000, 9000, .04, .6); }
        else if(quoi === 'holo'){ [1568, 2093, 2637, 3136].forEach((f, k) => this.cloche(f, .1 + k * .05, .7, .03)); }
        else if(quoi === 'gain'){ this.cloche(1047, 0, .4, .06); this.cloche(1568, .07, .5, .05); }
        else if(quoi === 'niveau'){ [523, 659, 784, 1047].forEach((f, k) => this.cloche(f, k * .11, 1, .08)); }
        else if(quoi === 'tic'){ this.bruit(0, .03, 3000, 2000, .05, 3); }
      }catch(e){ /* un navigateur sans audio : on joue en silence */ }
    }
  };

  // ---------------------------------------------------------------------
  // Les particules : un seul canevas, qui ne tourne que tant qu'il a de quoi dessiner
  // ---------------------------------------------------------------------

  function Effets(canvas){
    const g = canvas.getContext('2d');
    let parts = [], boucle = 0, l = 0, h = 0;
    function taille(){
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      l = canvas.clientWidth; h = canvas.clientHeight;
      canvas.width = l * dpr; canvas.height = h * dpr;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    taille();
    window.addEventListener('resize', taille);
    function image(){
      g.clearRect(0, 0, l, h);
      parts = parts.filter(p => p.vie > 0);
      for(const p of parts){
        p.vie -= 1; p.vx *= p.frein; p.vy = p.vy * p.frein + p.grav; p.x += p.vx; p.y += p.vy; p.rot += p.vr;
        if(p.vers){ p.x += (p.vers.x - p.x) * .08; p.y += (p.vers.y - p.y) * .08; }
        const a = Math.min(1, p.vie / p.vie0 * 1.6);
        g.globalAlpha = a;
        if(p.forme === 'confetti'){
          g.save(); g.translate(p.x, p.y); g.rotate(p.rot); g.fillStyle = p.c; g.fillRect(-p.t / 2, -p.t * .35, p.t, p.t * .7); g.restore();
        }else{
          g.globalCompositeOperation = 'lighter';
          const r = p.t * (.6 + a * .4);
          const grd = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 3);
          grd.addColorStop(0, p.c); grd.addColorStop(.25, p.c); grd.addColorStop(1, 'rgba(0,0,0,0)');
          g.fillStyle = grd; g.beginPath(); g.arc(p.x, p.y, r * 3, 0, Math.PI * 2); g.fill();
          g.globalCompositeOperation = 'source-over';
        }
      }
      g.globalAlpha = 1;
      boucle = parts.length ? requestAnimationFrame(image) : 0;
    }
    function lancer(){ if(!boucle) boucle = requestAnimationFrame(image); }
    return {
      gerbe(x, y, couleurs, n, o){
        if(calme()) return;
        o = o || {};
        for(let i = 0; i < n; i++){
          const a = Math.random() * Math.PI * 2, v = (o.vitesse || 7) * (.35 + Math.random() * .9);
          const vie = (o.vie || 60) * (.6 + Math.random() * .6);
          parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - (o.monte || 0), grav: o.grav === undefined ? .12 : o.grav, frein: o.frein || .95,
            t: (o.taille || 3) * (.6 + Math.random() * .8), c: couleurs[i % couleurs.length], vie, vie0: vie, rot: Math.random() * 6, vr: (Math.random() - .5) * .3, forme: 'etincelle' });
        }
        lancer();
      },
      aspire(x, y, couleur, n){
        if(calme()) return;
        for(let i = 0; i < n; i++){
          const a = Math.random() * Math.PI * 2, d = 140 + Math.random() * 160;
          parts.push({ x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, vx: 0, vy: 0, grav: 0, frein: 1, t: 2 + Math.random() * 2, c: couleur, vie: 34, vie0: 34, rot: 0, vr: 0, forme: 'etincelle', vers: { x, y } });
        }
        lancer();
      },
      pluie(couleurs, n){
        if(calme()) return;
        for(let i = 0; i < n; i++){
          const vie = 140 + Math.random() * 80;
          parts.push({ x: Math.random() * l, y: -20 - Math.random() * h * .4, vx: (Math.random() - .5) * 2, vy: 2 + Math.random() * 3, grav: .05, frein: .995,
            t: 7 + Math.random() * 6, c: couleurs[i % couleurs.length], vie, vie0: vie, rot: Math.random() * 6, vr: (Math.random() - .5) * .25, forme: 'confetti' });
        }
        lancer();
      },
      fin(){ cancelAnimationFrame(boucle); boucle = 0; parts = []; window.removeEventListener('resize', taille); }
    };
  }

  // ---------------------------------------------------------------------
  // Les fenêtres
  // ---------------------------------------------------------------------

  function fenetre(html, large, onFermer){
    const voile = el('div', 'ct-voile');
    voile.innerHTML = `<div class="ct-fen${large ? ' large' : ''}" role="dialog" aria-modal="true"><button type="button" class="ct-fermer" aria-label="Fermer">${ico('croix', 18)}</button><div class="ct-fen-corps">${html}</div></div>`;
    const avant = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    document.body.appendChild(voile);
    let ferme = false;
    function fermer(){
      if(ferme) return;
      ferme = true;
      voile.remove();
      if(!document.querySelector('.ct-voile, .ct-scene')) document.documentElement.style.overflow = avant;
      document.removeEventListener('keydown', touche);
      if(onFermer) onFermer();
    }
    function touche(ev){
      if(ev.key !== 'Escape') return;
      const tous = document.querySelectorAll('.ct-voile');
      if(tous[tous.length - 1] === voile) fermer();
    }
    voile.querySelector('.ct-fermer').addEventListener('click', fermer);
    voile.addEventListener('click', (ev) => { if(ev.target === voile) fermer(); });
    document.addEventListener('keydown', touche);
    setTimeout(() => { const f = voile.querySelector('.ct-fermer'); if(f) f.focus({ preventScroll: true }); }, 30);
    return { fermer, corps: voile.querySelector('.ct-fen-corps'), voile };
  }

  // ---------------------------------------------------------------------
  // La carte d'artiste
  // ---------------------------------------------------------------------

  function carteHtml(c, o){
    o = o || {};
    const r = Math.min(Math.max(Number(c.rarete) || 1, 1), 5);
    const verrou = !!o.verrou;
    return `
      <div class="ct-carte r${r}${c.holo && !verrou ? ' holo' : ''}${verrou ? ' verrou' : ''}${o.vivante ? ' vivante' : ''}">
        <div class="ct-c-in">
          <img class="ct-c-photo" src="${esc(safeUrl(c.photo))}" alt="" loading="${o.eager ? 'eager' : 'lazy'}" decoding="async">
          <div class="ct-c-voile"></div>
          <span class="ct-c-num">${numero(c.numero)}</span>
          <span class="ct-c-gemme" aria-hidden="true"></span>
          ${c.holo && !verrou ? '<span class="ct-c-holo">Holo</span>' : ''}
          ${verrou ? `<span class="ct-c-cadenas">${ico('cadenas', 24)}</span>` : ''}
          <div class="ct-c-bas">
            <div class="ct-c-nom">${esc(c.nom)}</div>
            <div class="ct-c-meta"><span class="rar">${esc(rar(r).nom)}</span><span>${c.fans ? esc(court(c.fans)) + ' fans' : ''}</span></div>
          </div>
          <div class="ct-c-reflet"></div>
        </div>
        ${o.quantite && c.quantite > 1 ? `<span class="ct-c-badge">×${c.quantite}</span>` : ''}
        ${o.nouveau ? '<span class="ct-c-nouveau">Nouveau</span>' : ''}
      </div>`;
  }

  // Une carte qui suit le pointeur : elle penche, et son reflet holographique glisse.
  function inclinable(zone, cible){
    if(!zone || calme()) return;
    const carte = () => cible || zone.querySelector('.ct-carte');
    zone.addEventListener('pointermove', (ev) => {
      const c = carte(); if(!c || ev.pointerType === 'touch') return;
      const b = c.getBoundingClientRect();
      const x = (ev.clientX - b.left) / b.width, y = (ev.clientY - b.top) / b.height;
      c.style.transform = `rotateY(${((x - .5) * 16).toFixed(1)}deg) rotateX(${((.5 - y) * 14).toFixed(1)}deg)`;
      c.style.setProperty('--hx', (x * 100).toFixed(0) + '%');
      c.style.setProperty('--hy', (y * 100).toFixed(0) + '%');
      c.style.setProperty('--ct-lum', (130 - x * 160).toFixed(0) + '%');
    });
    zone.addEventListener('pointerleave', () => { const c = carte(); if(c) c.style.transform = ''; });
  }

  // ---------------------------------------------------------------------
  // L'état du joueur, l'en-tête, les onglets
  // ---------------------------------------------------------------------

  const S = {
    hote: null, etat: null, vue: 'packs', occupe: false, minuteur: null, corps: null,
    col: { page: 1, vue: 'toutes', rarete: null, q: '', tri: 'numero' }
  };

  function duree(s){
    s = Math.max(0, Math.floor(s));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    if(h >= 24) return Math.ceil(s / 86400) + ' j';
    return h ? h + ' h ' + String(m).padStart(2, '0') : m + ':' + String(x).padStart(2, '0');
  }

  function enteteHtml(){
    const e = S.etat;
    const part = Math.max(0, Math.min(1, (e.xp - e.xp_depart) / Math.max(1, e.xp_fin - e.xp_depart)));
    const circ = 2 * Math.PI * 20;
    return `
      <div class="ct-niv" title="Niveau ${e.niveau}">
        <svg viewBox="0 0 46 46"><circle cx="23" cy="23" r="20" fill="none" stroke="rgba(255,255,255,.1)" stroke-width="3.5"/>
          <circle cx="23" cy="23" r="20" fill="none" stroke="#4FB4FF" stroke-width="3.5" stroke-linecap="round" stroke-dasharray="${circ.toFixed(1)}" stroke-dashoffset="${(circ * (1 - part)).toFixed(1)}"/></svg>
        <b>${e.niveau}</b>
      </div>
      <div class="ct-qui"><b>Niveau ${e.niveau}</b><small>${nf(e.xp - e.xp_depart)} / ${nf(e.xp_fin - e.xp_depart)} XP · ${nf(e.uniques)} / ${nf(e.total_cartes)} artistes</small></div>
      <div class="ct-ress">
        <div class="ct-res" title="Un tirage = un pack. +3 toutes les 10 minutes, jusqu'à ${e.plafond}.">${ico('eclair', 17)}${nf(e.tirages)}<small>/ ${e.plafond}</small><small data-recharge></small></div>
        <div class="ct-res vinyles" title="Vinyles : gagnés en recyclant tes doublons, dépensés à l'atelier.">${ico('vinyle', 17)}${nf(e.vinyles)}</div>
        ${e.garantis > 0 ? `<button type="button" class="ct-res garanti" data-garanti title="Ouvrir un pack Épique garanti">${ico('pack', 17)}${e.garantis}<small>Épique garanti</small></button>` : ''}
        <button type="button" class="ct-btn-ico" data-son aria-label="${Son.actif() ? 'Couper le son' : 'Remettre le son'}">${ico(Son.actif() ? 'son' : 'muet', 18)}</button>
      </div>`;
  }

  function aRecuperer(e){
    return (e.cadeau_pret ? 1 : 0) + (e.roue_prete ? 1 : 0) + (e.coffres_prets || 0);
  }

  function ongletsHtml(){
    const e = S.etat;
    const pastilles = { missions: e.missions_pretes || 0, bonus: aRecuperer(e) };
    const icones = { packs: 'pack', collection: 'cartes', missions: 'cible', bonus: 'cadeau', succes: 'trophee' };
    return VUES.map(([id, nom]) => `
      <button type="button" class="ct-onglet${S.vue === id ? ' actif' : ''}" data-vue="${id}" role="tab" aria-selected="${S.vue === id}">
        ${ico(icones[id], 17)}${esc(nom)}${pastilles[id] ? `<span class="ct-pastille">${pastilles[id]}</span>` : ''}
      </button>`).join('');
  }

  function majEntete(){
    if(!S.hote || !S.etat) return;
    const t = S.hote.querySelector('.ct-tete');
    if(t) t.innerHTML = enteteHtml();
    const n = S.hote.querySelector('.ct-onglets');
    if(n) n.innerHTML = ongletsHtml();
    if(typeof majPastilleCartes === 'function') majPastilleCartes(S.etat);
    tic();
  }

  function tic(){
    const e = S.etat;
    const z = S.hote && S.hote.querySelector('[data-recharge]');
    if(!e || !z) return;
    if(e.tirages >= e.plafond || e.prochain_dans === null || e.prochain_dans === undefined){ z.textContent = ''; return; }
    const restant = e.prochain_dans - Math.floor((Date.now() - (e._le || Date.now())) / 1000);
    if(restant <= 0){
      z.textContent = '· …';
      if(!S.occupe) rafraichirEtat();
      return;
    }
    z.textContent = '· +3 dans ' + duree(restant);
  }

  async function rafraichirEtat(){
    if(S.rafraichit) return;
    S.rafraichit = true;
    try{ poserEtat(await appel('jeu_etat')); majEntete(); }catch(e){ /* le prochain tour réessaie */ }
    S.rafraichit = false;
  }

  function poserEtat(etat){
    if(!etat) return;
    S.etat = etat;
    S.etat._le = Date.now();
  }

  // ---------------------------------------------------------------------
  // Monter la page
  // ---------------------------------------------------------------------

  function invite(hote, titre, texte){
    hote.innerHTML = `<div class="ct"><div class="ct-panneau ct-vide"><b>${esc(titre)}</b>${texte}${currentUser ? '' : '<div style="margin-top:18px"><button type="button" class="ct-btn principal" data-connexion>Se connecter</button></div>'}</div></div>`;
    const b = hote.querySelector('[data-connexion]');
    if(b) b.addEventListener('click', () => { if(typeof openAuthModal === 'function') openAuthModal('login'); });
  }

  async function monter(hote){

    poserStyle();
    S.hote = hote;

    if(!currentUser){
      invite(hote, 'Ta collection t\'attend', 'Connecte-toi pour ouvrir des packs et collectionner les artistes de la scène francophone.');
      return;
    }

    if(!hote.querySelector('.ct')) hote.innerHTML = '<div class="ct"><div class="ct-vide">Chargement…</div></div>';

    try{
      poserEtat(await appel('jeu_etat'));
    }catch(e){
      invite(hote, 'Le jeu n\'a pas pu s\'ouvrir', esc(e.message));
      return;
    }

    const demande = (location.hash.split('/')[2] || '').toLowerCase();
    S.vue = VUES.some(v => v[0] === demande) ? demande : (VUES.some(v => v[0] === S.vue) ? S.vue : 'packs');

    hote.innerHTML = `
      <div class="ct">
        <div class="ct-tete"></div>
        <nav class="ct-onglets" role="tablist" aria-label="Le jeu"></nav>
        <div class="ct-corps"></div>
      </div>`;

    S.corps = hote.querySelector('.ct-corps');
    majEntete();

    if(!hote.dataset.ctBranche){
      hote.dataset.ctBranche = '1';
      hote.addEventListener('click', (ev) => {
        const v = ev.target.closest('[data-vue]');
        if(v && hote.contains(v)){ changerVue(v.dataset.vue); return; }
        if(ev.target.closest('.ct-tete [data-garanti]')){ ouvrir(1, true); return; }
        if(ev.target.closest('.ct-tete [data-son]')){ Son.basculer(); if(Son.actif()) Son.jouer('tic'); majEntete(); }
      });
    }

    clearInterval(S.minuteur);
    S.minuteur = setInterval(() => { if(S.hote && S.hote.isConnected) tic(); else clearInterval(S.minuteur); }, 1000);

    await afficherVue(S.vue);

    // Le cadeau du jour s'offre de lui-même, une fois par visite.
    if(S.etat.cadeau_pret && !S.cadeauPropose){
      S.cadeauPropose = true;
      setTimeout(() => { if(S.hote && S.hote.isConnected && !document.querySelector('.ct-voile, .ct-scene')) fenetreCadeau(); }, 700);
    }
  }

  function quitter(){
    clearInterval(S.minuteur);
  }

  function changerVue(v){
    if(S.vue === v && S.corps && S.corps.children.length) return;
    S.vue = v;
    try{ history.replaceState(history.state, '', '#community/cartes/' + v); }catch(e){}
    majEntete();
    afficherVue(v);
  }

  async function afficherVue(v){
    if(!S.corps.querySelector('.ct-panneau')) S.corps.innerHTML = '<div class="ct-vide">Chargement…</div>';
    try{
      if(v === 'packs') await vuePacks();
      else if(v === 'collection') await vueCollection();
      else if(v === 'missions') await vueMissions();
      else if(v === 'bonus') await vueBonus();
      else if(v === 'succes') await vueSucces();
    }catch(e){
      S.corps.innerHTML = `<div class="ct-panneau ct-vide">${esc(e.message)}</div>`;
    }
  }

  const gainsHtml = (g) => [
    g.tirages ? `<span class="ct-gain">${ico('eclair', 13)}+${g.tirages}</span>` : '',
    g.vinyles ? `<span class="ct-gain v">${ico('vinyle', 13)}+${g.vinyles}</span>` : '',
    g.garantis ? `<span class="ct-gain g">${ico('pack', 13)}Épique</span>` : ''
  ].join('');
  const gainsTexte = (g) => [g.tirages ? '+' + g.tirages + ' tirages' : '', g.vinyles ? '+' + g.vinyles + ' vinyles' : '', g.garantis ? 'un pack Épique garanti' : ''].filter(Boolean).join(', ');

  // ---------------------------------------------------------------------
  // Packs
  // ---------------------------------------------------------------------

  function packHtml(o){
    o = o || {};
    return `
      <div class="ct-pack${o.garanti ? ' garanti' : ''}"${o.attrs || ''}>
        ${o.pile ? Array.from({ length: o.pile }, (_, k) => `<div class="ct-pk-pile" style="transform:translate(${(k + 1) * 7}px, ${(k + 1) * -5}px) rotate(${(k + 1) * 2.5}deg); z-index:-${k + 1}"></div>`).join('') : ''}
        <div class="ct-pk-corps">
          <div class="ct-pk-contenu">
            ${EMBLEME}
            <div class="ct-pk-marque">LA WAVE</div>
            <div class="ct-pk-type">${o.garanti ? 'Pack Épique' : 'Pack d\'artistes'}</div>
          </div>
          <div class="ct-pk-pied">${o.garanti ? 'Épique ou mieux' : 'Scène francophone'}</div>
        </div>
        <div class="ct-pk-haut"></div>
        <div class="ct-pk-ligne"></div>
        <div class="ct-pk-lumiere"></div>
        ${o.nombre > 1 ? `<div class="ct-pk-nombre">×${o.nombre}</div>` : ''}
      </div>`;
  }

  async function vuePacks(){

    const e = S.etat;
    const ev = e.evenement || {};
    const taux = ev.taux || [62, 24, 9.5, 3.8, 0.7];
    const fmt = (x) => { const n = Number(x); return (n < 10 ? String(Math.round(n * 10) / 10).replace('.', ',') : String(Math.round(n))) + ' %'; };

    let recentes = [];
    try{ recentes = (await appel('jeu_collection_lire', { p_page: 1, p_vue: 'possedees', p_tri: 'recent' })).cartes.slice(0, 10); }catch(err){ /* pas grave */ }

    const attente = aRecuperer(e) + (e.missions_pretes || 0);
    const bouton = (n, classe) => `<button type="button" class="ct-btn ${classe}" data-ouvrir="${n}" ${e.tirages < n ? 'disabled' : ''}>${n > 1 ? n + ' packs' : 'Ouvrir un pack'}<span class="cout">${ico('eclair', 12)}${n}</span></button>`;

    S.corps.innerHTML = `
      <section class="ct-panneau ct-hero">
        <div>
          <span class="ct-surtitre">${ico('pack', 15)}Packs d'artistes</span>
          <h2>Ouvre un pack,<br>révèle un artiste.</h2>
          <p>Chaque pack contient la carte d'un artiste de la scène francophone. Plus il est écouté, plus sa carte est rare.</p>
          <div class="ct-hero-actions">
            ${bouton(1, 'principal grand')}
            ${bouton(5, 'grand')}
            ${bouton(10, 'grand')}
          </div>
          <div class="ct-hero-note">${ico('horloge', 15)}${e.tirages >= e.plafond ? 'Tes tirages sont au maximum.' : '+3 tirages toutes les 10 minutes, jusqu\'à ' + e.plafond + '.'} Dix packs garantissent une Rare ou mieux.</div>
        </div>
        <div class="ct-hero-pack">${packHtml({ attrs: ' data-ouvrir="1" role="button" tabindex="0" aria-label="Ouvrir un pack"' })}</div>
      </section>

      ${attente ? `<button type="button" class="ct-attente" data-aller="${aRecuperer(e) ? 'bonus' : 'missions'}">${ico('cadeau', 22)}<div><b>${pluriel(attente, 'récompense')} à récupérer</b><span>${[e.cadeau_pret ? 'cadeau du jour' : '', e.roue_prete ? 'roue' : '', e.coffres_prets ? 'coffre' : '', e.missions_pretes ? 'missions' : ''].filter(Boolean).join(' · ')}</span></div>${ico('fleche', 18)}</button>` : ''}

      <div class="ct-titre-sec"><h3>Chances par pack</h3></div>
      <section class="ct-panneau">
        <div class="ct-taux">${[1, 2, 3, 4, 5].map(k => `<i style="flex:${Math.max(Number(taux[k - 1]), 1.2)}; background:${RAR[k].c}"></i>`).join('')}</div>
        <div class="ct-legende">${[1, 2, 3, 4, 5].map(k => `<div style="--rc:${RAR[k].c}"><b>${fmt(taux[k - 1])}</b>${esc(RAR[k].nom)}</div>`).join('')}</div>
        ${ev.lundi || ev.heure_holo ? `<div class="ct-evts">${ev.lundi ? `<span class="ct-evt">${ico('etoile', 15)}Lundi des légendes : Épique et mieux ×2</span>` : ''}${ev.heure_holo ? `<span class="ct-evt">${ico('etoile', 15)}Heure holo jusqu'à 22 h : holos ×2</span>` : ''}</div>` : ''}
        <p class="sous" style="margin-top:14px">Chaque carte peut sortir en version holographique (1 chance sur ${ev.heure_holo ? 100 : 200}). La rareté vient du nombre de fans Deezer de l'artiste.</p>
      </section>

      <div class="ct-titre-sec"><h3>Dernières cartes obtenues</h3>${recentes.length ? '<button type="button" class="ct-lien" data-aller="collection">Toute la collection' + ico('fleche', 14) + '</button>' : ''}</div>
      ${recentes.length
        ? `<div class="ct-ruban">${recentes.map((c, i) => `<button type="button" class="ct-case" data-i="${i}" aria-label="${esc(c.nom)}">${carteHtml(c, { quantite: true })}</button>`).join('')}</div>`
        : '<div class="ct-panneau ct-vide"><b>Ta collection est vide</b>Ouvre ton premier pack pour découvrir ta première carte.</div>'}`;

    S.corps.querySelectorAll('[data-ouvrir]').forEach((b) => {
      b.addEventListener('click', () => ouvrir(Number(b.dataset.ouvrir), false));
      if(!b.matches('button')) b.addEventListener('keydown', (ev) => { if(ev.key === 'Enter' || ev.key === ' '){ ev.preventDefault(); ouvrir(Number(b.dataset.ouvrir), false); } });
    });
    S.corps.querySelectorAll('[data-aller]').forEach((b) => b.addEventListener('click', () => changerVue(b.dataset.aller)));
    S.corps.querySelectorAll('.ct-ruban [data-i]').forEach((b) => b.addEventListener('click', () => fiche(recentes[Number(b.dataset.i)].id)));
    const pk = S.corps.querySelector('.ct-hero-pack');
    if(pk) inclinable(pk, pk.querySelector('.ct-pack'));
  }

  async function ouvrir(n, garanti){

    if(S.occupe) return;
    if(!garanti && S.etat && S.etat.tirages < n){ toast('Pas assez de tirages pour l\'instant.', 'err'); return; }
    S.occupe = true;
    Son.pret();

    let r;
    try{
      r = await appel('jeu_ouvrir', { p_n: n, p_garanti: !!garanti });
    }catch(e){
      toast(e.message, 'err');
      S.occupe = false;
      return;
    }

    poserEtat(r.etat);
    majEntete();

    let encore = false;
    try{ encore = await scene(r.cartes, garanti); }
    finally{ S.occupe = false; }

    for(const nv of (r.niveaux || [])) await niveauAtteint(nv);

    if(encore){ ouvrir(n, false); return; }
    if(S.vue === 'packs' || S.vue === 'collection') afficherVue(S.vue);
  }

  function niveauAtteint(nv){
    return new Promise((fin) => {
      Son.jouer('niveau');
      vibre([30, 50, 30]);
      const f = fenetre(`
        <div style="text-align:center; padding:6px 0 2px">
          <span class="ct-surtitre" style="justify-content:center">${ico('etoile', 15)}Niveau supérieur</span>
          <div style="font-size:72px; font-weight:900; line-height:1.05; margin:10px 0 6px; letter-spacing:-.03em; background:linear-gradient(180deg, #fff, #8fcfff); -webkit-background-clip:text; background-clip:text; color:transparent">${nv.niveau}</div>
          <div class="ct-gains" style="justify-content:center">${gainsHtml(nv)}</div>
          <p class="sous" style="margin-top:12px">Ton plafond de tirages grandit avec ton niveau.</p>
          <div style="margin-top:20px"><button type="button" class="ct-btn principal" data-ok>Continuer</button></div>
        </div>`, false, fin);
      f.corps.querySelector('[data-ok]').addEventListener('click', f.fermer);
    });
  }

  // ---------------------------------------------------------------------
  // La scène d'ouverture
  //   1. le pack arrive ; on le déchire d'un geste (ou d'un toucher) ;
  //   2. les cartes sortent face cachée, leur lueur annonce leur rareté ;
  //   3. on les retourne une à une (ou toutes) ; les grandes cartes ont leur moment ;
  //   4. le bilan, rouvrir ou terminer.
  // Renvoie vrai si le joueur veut rouvrir le même nombre de packs.
  // ---------------------------------------------------------------------

  function scene(cartes, garanti){

    return new Promise((fin) => {

      const n = cartes.length;
      const meilleure = cartes.reduce((m, c) => Math.max(m, Number(c.rarete) || 1), 1);
      const teinteMeilleure = meilleure >= 3 ? RAR[meilleure].c : '#4FB4FF';

      const ov = el('div', 'ct-scene');
      ov.setAttribute('role', 'dialog');
      ov.setAttribute('aria-modal', 'true');
      ov.setAttribute('aria-label', 'Ouverture de pack');
      ov.innerHTML = `
        <div class="ct-scene-fond"></div>
        <div class="ct-rayons"></div>
        <div class="ct-flash"></div>
        <canvas></canvas>
        <button type="button" class="ct-scene-x" aria-label="Fermer">${ico('croix', 20)}</button>
        <div class="ct-scene-centre"></div>
        <div class="ct-scene-pied"></div>`;
      const avant = document.documentElement.style.overflow;
      document.documentElement.style.overflow = 'hidden';
      document.body.appendChild(ov);

      const centre = ov.querySelector('.ct-scene-centre');
      const pied = ov.querySelector('.ct-scene-pied');
      const flash = ov.querySelector('.ct-flash');
      const rayons = ov.querySelector('.ct-rayons');
      const fx = Effets(ov.querySelector('canvas'));
      let fini = false, phase = 'pack', occupe = false;
      const retournees = new Set();

      const teinte = (c) => ov.style.setProperty('--teinte', c);
      const eclair = () => { flash.classList.remove('on'); void flash.offsetWidth; flash.classList.add('on'); };
      teinte('#1489DE');

      function fermer(rouvrir){
        if(fini) return;
        fini = true;
        fx.fin();
        document.removeEventListener('keydown', touche);
        ov.style.transition = 'opacity .25s';
        ov.style.opacity = '0';
        setTimeout(() => {
          ov.remove();
          if(!document.querySelector('.ct-voile, .ct-scene')) document.documentElement.style.overflow = avant;
          fin(!!rouvrir);
        }, 250);
      }

      function touche(ev){
        if(document.querySelector('.ct-voile')) return;
        if(ev.key === 'Escape'){ fermer(false); return; }
        if(ev.key !== ' ' && ev.key !== 'Enter') return;
        if(ev.target && ev.target.closest && ev.target.closest('button')) return;
        ev.preventDefault();
        if(phase === 'pack') dechirer();
        else if(phase === 'cartes') suivante();
      }
      document.addEventListener('keydown', touche);
      ov.querySelector('.ct-scene-x').addEventListener('click', () => fermer(false));

      const centreDe = (elm) => { const b = elm.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; };

      // ---- 1. le pack
      const zonePack = el('div', 'ct-scene-pack', packHtml({ garanti, nombre: n, pile: n > 1 ? Math.min(n - 1, 3) : 0 }));
      centre.appendChild(zonePack);
      const pack = zonePack.querySelector('.ct-pack');
      pack.style.setProperty('--teinte', teinteMeilleure);
      pack.insertAdjacentHTML('beforeend', '<div class="ct-pk-indice"></div>');
      pied.innerHTML = `<p>${'ontouchstart' in window ? 'Glisse ton doigt sur le pack pour le déchirer' : 'Glisse sur le pack pour le déchirer, ou clique dessus'}</p>`;

      // Le geste : on suit le doigt d'un bord à l'autre ; au-delà de 60 %, le pack se déchire.
      let geste = null;
      pack.addEventListener('pointerdown', (ev) => {
        if(phase !== 'pack') return;
        geste = { x: ev.clientX, l: pack.getBoundingClientRect().width, max: 0 };
        try{ pack.setPointerCapture(ev.pointerId); }catch(e){}
        const ind = pack.querySelector('.ct-pk-indice'); if(ind) ind.remove();
      });
      pack.addEventListener('pointermove', (ev) => {
        if(!geste || phase !== 'pack') return;
        const p = Math.min(1, Math.abs(ev.clientX - geste.x) / (geste.l * .9));
        geste.max = Math.max(geste.max, p);
        pack.style.setProperty('--dech', geste.max.toFixed(3));
        if(geste.max > .12) zonePack.classList.add('tremble');
        if(geste.max >= .6){ geste = null; dechirer(); }
      });
      pack.addEventListener('pointerup', () => {
        if(!geste || phase !== 'pack') return;
        const p = geste.max; geste = null;
        if(p < .05) dechirer();
        else{ zonePack.classList.remove('tremble'); pack.style.setProperty('--dech', '0'); }
      });
      pack.addEventListener('pointercancel', () => { geste = null; pack.style.setProperty('--dech', '0'); zonePack.classList.remove('tremble'); });

      async function dechirer(){
        if(phase !== 'pack') return;
        phase = 'dechire';
        const ind = pack.querySelector('.ct-pk-indice'); if(ind) ind.remove();
        pied.innerHTML = '';
        zonePack.classList.add('tremble');

        // La ligne court jusqu'au bout, puis le haut s'envole.
        const debut = parseFloat(pack.style.getPropertyValue('--dech')) || 0;
        const t0 = performance.now();
        await new Promise((ok) => {
          const pas = (t) => {
            const k = Math.min(1, (t - t0) / 220);
            pack.style.setProperty('--dech', (debut + (1 - debut) * k).toFixed(3));
            if(k < 1) requestAnimationFrame(pas); else ok();
          };
          requestAnimationFrame(pas);
        });
        if(fini) return;

        Son.jouer('dechire');
        vibre(meilleure >= 4 ? [20, 30, 60] : 25);
        zonePack.classList.remove('tremble');
        pack.querySelector('.ct-pk-haut').classList.add('part');
        pack.querySelector('.ct-pk-lumiere').classList.add('on');
        teinte(teinteMeilleure);
        const h = pack.querySelector('.ct-pk-ligne').getBoundingClientRect();
        fx.gerbe(h.left + h.width / 2, h.top, ['#ffffff', teinteMeilleure, teinteMeilleure], meilleure >= 4 ? 70 : 40, { vitesse: 9, monte: 3, vie: 55 });
        if(meilleure >= 4) eclair();

        await attendre(calme() ? 50 : 520);
        if(!fini) distribuer();
      }

      // ---- 2. les cartes sortent du pack
      let places = [];
      function distribuer(){
        phase = 'cartes';
        const donne = el('div', 'ct-donne' + (n === 1 ? ' seule' : ''));
        const etroit = window.innerWidth < 640;
        const cols = n === 1 ? 1 : (etroit ? (n === 5 ? 3 : 4) : 5);
        donne.style.setProperty('--cols', cols);
        if(n > 1){
          // Assez petites pour tenir à l'écran sans défiler.
          const lignes = Math.ceil(n / cols);
          const hDispo = window.innerHeight - 64 - 130 - (lignes - 1) * 40 - 30;
          const lc = Math.max(70, Math.min(180, (hDispo / lignes) * 5 / 7, (Math.min(window.innerWidth, 1000) - 32 - (cols - 1) * 14) / cols));
          donne.style.setProperty('--lc', Math.floor(lc) + 'px');
        }
        donne.innerHTML = cartes.map((c, i) => `
          <div class="ct-place" data-i="${i}" style="--rc:${rar(c.rarete).c}">
            <div class="ct-volte" role="button" tabindex="0" aria-label="Retourner la carte ${i + 1}">
              <div class="ct-dos" data-r="${c.rarete}"><div class="ct-dos-in">${EMBLEME}</div></div>
              <div class="ct-face">${carteHtml(c, { vivante: true, eager: true })}</div>
            </div>
          </div>`).join('');

        const depart = centreDe(pack);
        zonePack.classList.add('parti');
        zonePack.style.position = 'absolute';
        centre.appendChild(donne);

        places = [...donne.querySelectorAll('.ct-place')];
        places.forEach((p, i) => {
          const c = centreDe(p);
          p.style.setProperty('--dx', (depart.x - c.x).toFixed(0) + 'px');
          p.style.setProperty('--dy', (depart.y - c.y).toFixed(0) + 'px');
          p.style.setProperty('--rot', ((i % 2 ? 1 : -1) * (6 + i * 2)) + 'deg');
          p.style.animationDelay = (i * 70) + 'ms';
          p.classList.add('donne');
          setTimeout(() => { if(!fini) Son.jouer('donne'); }, i * 70);
          const v = p.querySelector('.ct-volte');
          v.addEventListener('click', () => { if(phase === 'bilan') fiche(cartes[i].id); else retourner(i); });
          v.addEventListener('keydown', (ev) => { if(ev.key === 'Enter' || ev.key === ' '){ ev.preventDefault(); ev.stopPropagation(); v.click(); } });
        });
        setTimeout(() => zonePack.remove(), 700);

        pied.innerHTML = `<p>${n === 1 ? 'Touche la carte pour la retourner' : 'Touche une carte pour la retourner'}</p>${n > 1 ? '<div class="boutons"><button type="button" class="ct-btn blanc" data-tout>Tout retourner</button></div>' : ''}`;
        const bt = pied.querySelector('[data-tout]');
        if(bt) bt.addEventListener('click', toutRetourner);
      }

      function suivante(){
        const i = cartes.findIndex((c, k) => !retournees.has(k));
        if(i >= 0) retourner(i);
      }

      // ---- 3. retourner une carte
      async function retourner(i){
        if(fini || retournees.has(i) || occupe) return;
        occupe = true;
        retournees.add(i);
        const c = cartes[i], r = Number(c.rarete) || 1, p = places[i];
        const pos = centreDe(p);

        if(r >= 3 && !calme()){
          // L'attente : la carte vibre, la lumière se rassemble.
          p.classList.add('charge');
          Son.jouer('charge');
          vibre(r >= 4 ? [15, 40, 15, 40, 15] : 20);
          fx.aspire(pos.x, pos.y, RAR[r].c, r >= 5 ? 60 : (r >= 4 ? 42 : 24));
          await attendre(r >= 5 ? 1150 : (r >= 4 ? 850 : 520));
          p.classList.remove('charge');
        }
        if(fini){ occupe = false; return; }

        p.classList.add('retournee');
        Son.jouer('volte');
        setTimeout(() => {
          if(fini) return;
          Son.jouer('r' + r);
          if(c.holo) Son.jouer('holo');
        }, 180);

        setTimeout(() => {
          if(fini) return;
          // L'étiquette : la rareté pour une grande carte seule, sinon nouvelle carte ou doublon.
          let classe = 'double', texte = 'Doublon ×' + c.quantite;
          if(c.nouvelle){ classe = 'nouveau'; texte = 'Nouveau'; }
          else if(c.nouveau_holo){ classe = 'nouveau'; texte = 'Nouveau holo'; }
          if(n === 1 && r >= 3){ classe = ''; texte = RAR[r].nom + (c.nouvelle ? ' · Nouveau' : ''); }
          p.insertAdjacentHTML('beforeend', `<div class="ct-etiq ${classe}">${esc(texte)}</div>`);

          if(r >= 2) fx.gerbe(pos.x, pos.y, [RAR[r].c, '#ffffff'], r >= 5 ? 110 : (r >= 4 ? 80 : (r >= 3 ? 48 : 18)), { vitesse: r >= 4 ? 11 : 7, vie: r >= 4 ? 70 : 45 });
          if(c.holo) fx.gerbe(pos.x, pos.y, ['#ff9ad5', '#9af7ff', '#fff59a', '#c4a3ff'], 50, { vitesse: 8, vie: 60 });
          if(r >= 4){
            teinte(RAR[r].c);
            rayons.classList.add('on');
            eclair();
            ov.classList.remove('secousse'); void ov.offsetWidth; ov.classList.add('secousse');
            fx.pluie(r >= 5 ? ['#ff5c8a', '#ffb547', '#fff27a', '#5cffc8', '#5cb8ff', '#b36bff'] : ['#F2C14E', '#fff3c4', '#ffffff', '#e9a73a'], r >= 5 ? 160 : 90);
            const titre = el('div', 'ct-titre-rar', esc(RAR[r].nom));
            ov.appendChild(titre);
            setTimeout(() => titre.remove(), 1700);
            if(n > 1) setTimeout(() => rayons.classList.remove('on'), 1800);
          }else if(r === 3){
            teinte(RAR[3].c);
          }
        }, 330);

        await attendre(calme() ? 120 : (r >= 4 ? 900 : (r >= 3 ? 520 : 260)));
        occupe = false;
        if(retournees.size === n && !fini) bilan();
      }

      async function toutRetourner(){
        const bt = pied.querySelector('[data-tout]');
        if(bt) bt.disabled = true;
        for(let i = 0; i < n && !fini; i++){
          if(retournees.has(i)) continue;
          while(occupe && !fini) await attendre(60);
          await retourner(i);
          await attendre(Number(cartes[i].rarete) >= 3 ? 250 : 90);
        }
      }

      // ---- 4. le bilan
      function bilan(){
        phase = 'bilan';
        const nouvelles = cartes.filter(c => c.nouvelle).length;
        const holos = cartes.filter(c => c.holo).length;
        const par = [5, 4, 3].map(r => [r, cartes.filter(c => Number(c.rarete) === r).length]).filter(x => x[1]);
        const peutRouvrir = !garanti && S.etat && S.etat.tirages >= n;
        pied.innerHTML = `
          <div class="ct-bilan">
            <span>${nouvelles ? pluriel(nouvelles, 'nouvel artiste', 'nouveaux artistes') : 'Aucun nouvel artiste'}</span>
            ${par.map(([r, k]) => `<span style="--rc:${RAR[r].c}"><i></i>${k} ${esc(RAR[r].nom)}</span>`).join('')}
            ${holos ? `<span>${pluriel(holos, 'holo')}</span>` : ''}
          </div>
          <div class="boutons">
            ${peutRouvrir ? `<button type="button" class="ct-btn principal" data-encore>${n > 1 ? 'Rouvrir ' + n + ' packs' : 'Rouvrir un pack'}<span class="cout">${ico('eclair', 12)}${n}</span></button>` : ''}
            <button type="button" class="ct-btn ${peutRouvrir ? '' : 'blanc'}" data-fin>Terminer</button>
          </div>`;
        pied.querySelector('[data-fin]').addEventListener('click', () => fermer(false));
        const e = pied.querySelector('[data-encore]');
        if(e) e.addEventListener('click', () => fermer(true));
      }
    });
  }

  // ---------------------------------------------------------------------
  // La fiche d'une carte
  // ---------------------------------------------------------------------

  async function fiche(id){

    let c;
    try{ c = await appel('jeu_carte', { p_id: id }); }catch(e){ toast(e.message, 'err'); return; }

    const r = Number(c.rarete);
    const possede = c.quantite > 0;
    const date = (iso) => iso ? new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' }) : '';

    const doublons = [
      c.normales > 1 ? { holo: false, n: c.normales - 1, v: c.valeur } : null,
      c.holos > 1 ? { holo: true, n: c.holos - 1, v: c.valeur * 3 } : null
    ].filter(Boolean);

    const f = fenetre(`
      <div class="ct-fiche" style="--rc:${rar(r).c}">
        <div class="ct-fiche-carte">${carteHtml(c, { verrou: !possede, vivante: possede, eager: true })}</div>
        <div>
          <span class="ct-fiche-num">${numero(c.numero)}</span>
          <h2>${esc(c.nom)}</h2>
          <div class="ct-fiche-rar">${esc(rar(r).nom)}${c.holos > 0 ? ' · Holo obtenue' : ''}</div>
          <div class="ct-stats">
            <div class="ct-stat"><b>${c.fans ? esc(court(c.fans)) : '—'}</b><span>fans Deezer</span></div>
            <div class="ct-stat"><b>${nf(c.sorties)}</b><span>${c.sorties > 1 ? 'sorties' : 'sortie'} sur La Wave</span></div>
            <div class="ct-stat"><b>${possede ? '×' + c.quantite : '—'}</b><span>${possede ? 'en ta possession' : 'pas encore obtenue'}</span></div>
          </div>
          ${c.ville ? `<p class="sous" style="margin-top:12px">${esc(c.ville)}</p>` : ''}
          ${(c.sorties_liste || []).length ? `
            <div class="ct-titre-sec" style="margin:22px 0 10px"><h3>Dernières sorties</h3></div>
            <div class="ct-pochettes">${c.sorties_liste.map((s, i) => `<button type="button" class="ct-pochette" data-s="${i}" title="${esc(s.titre)} · ${esc(date(s.date))}"><img src="${esc(safeUrl(s.cover))}" alt="${esc(s.titre)}" loading="lazy"></button>`).join('')}</div>` : ''}
          ${c.handle && typeof ouvrirPageArtiste === 'function' ? `<div class="ct-actions"><button type="button" class="ct-btn petit" data-artiste>Voir la page de l'artiste${ico('fleche', 14)}</button></div>` : ''}
          ${!possede ? `
            <div class="ct-ligne-act">
              <span class="ct-pastille-ico">${ico('marteau', 18)}</span>
              <div class="tx"><b>Fabriquer à l'atelier</b>${nf(c.cout)} vinyles · tu en as ${nf(S.etat.vinyles)}</div>
              <button type="button" class="ct-btn principal petit" data-atelier ${S.etat.vinyles < c.cout ? 'disabled' : ''}>${S.etat.vinyles < c.cout ? 'Il en manque ' + nf(c.cout - S.etat.vinyles) : 'Fabriquer'}</button>
            </div>` : ''}
          ${doublons.map((d, k) => `
            <div class="ct-ligne-act">
              <span class="ct-pastille-ico">${ico('recycler', 18)}</span>
              <div class="tx"><b>${pluriel(d.n, d.holo ? 'doublon holo' : 'doublon', d.holo ? 'doublons holo' : 'doublons')}</b>${nf(d.v)} vinyles chacun</div>
              <select data-qte="${k}" aria-label="Quantité">${Array.from({ length: d.n }, (_, j) => `<option value="${j + 1}"${j + 1 === d.n ? ' selected' : ''}>${j + 1}</option>`).join('')}</select>
              <button type="button" class="ct-btn petit" data-recycler="${k}">Recycler</button>
            </div>`).join('')}
        </div>
      </div>`, true);

    inclinable(f.corps.querySelector('.ct-fiche-carte'));

    f.corps.querySelectorAll('[data-s]').forEach((b) => b.addEventListener('click', () => {
      const s = c.sorties_liste[Number(b.dataset.s)];
      if(s && s.numero && typeof ouvrirSortieParNumero === 'function'){ fermerTout(); ouvrirSortieParNumero(s.numero); }
    }));
    const ar = f.corps.querySelector('[data-artiste]');
    if(ar) ar.addEventListener('click', () => { fermerTout(); ouvrirPageArtiste(c.handle); });

    const at = f.corps.querySelector('[data-atelier]');
    if(at) at.addEventListener('click', async () => {
      at.disabled = true;
      try{
        const x = await appel('jeu_atelier', { p_artist: c.id });
        poserEtat(x.etat); majEntete(); Son.jouer('r' + r); vibre(25);
        toast(c.nom + ' rejoint ta collection');
        f.fermer();
        if(S.vue === 'collection') vueCollection();
        fiche(c.id);
      }catch(e){ toast(e.message, 'err'); at.disabled = false; }
    });

    f.corps.querySelectorAll('[data-recycler]').forEach((b) => b.addEventListener('click', async () => {
      const d = doublons[Number(b.dataset.recycler)];
      const q = Number(f.corps.querySelector(`[data-qte="${b.dataset.recycler}"]`).value);
      b.disabled = true;
      try{
        const x = await appel('jeu_recycler', { p_artist: c.id, p_holo: d.holo, p_quantite: q });
        poserEtat(x.etat); majEntete(); Son.jouer('gain');
        toast('+' + nf(x.vinyles) + ' vinyles');
        f.fermer();
        if(S.vue === 'collection') vueCollection();
      }catch(e){ toast(e.message, 'err'); b.disabled = false; }
    }));
  }

  // Quitter le jeu pour une autre page : les fenêtres et la scène se ferment.
  function fermerTout(){
    document.querySelectorAll('.ct-voile').forEach((v) => { const b = v.querySelector('.ct-fermer'); if(b) b.click(); });
    const x = document.querySelector('.ct-scene .ct-scene-x');
    if(x) x.click();
  }

  // ---------------------------------------------------------------------
  // Collection
  // ---------------------------------------------------------------------

  async function vueCollection(){

    const o = S.col;
    const r = await appel('jeu_collection_lire', { p_page: o.page, p_vue: o.vue, p_rarete: o.rarete, p_q: o.q || null, p_tri: o.tri });
    const e = S.etat;
    const pct = e.total_cartes ? Math.round(e.uniques / e.total_cartes * 1000) / 10 : 0;
    const raretes = r.raretes || [];

    S.corps.innerHTML = `
      <section class="ct-panneau ct-prog">
        <div class="ct-prog-chiffre">${nf(e.uniques)}<small> / ${nf(e.total_cartes)}</small></div>
        <div class="ct-prog-droite">
          <div class="lib"><span>artistes dans ta collection</span><span>${String(pct).replace('.', ',')} %</span></div>
          <div class="ct-barre"><i style="width:${Math.max(pct, e.uniques ? .6 : 0)}%"></i></div>
        </div>
        <div class="ct-raretes">${raretes.map(x => `
          <button type="button" class="ct-rar-btn${o.rarete === x.rarete ? ' actif' : ''}" data-rar="${x.rarete}" style="--rc:${rar(x.rarete).c}" aria-pressed="${o.rarete === x.rarete}">
            <span class="nom">${esc(rar(x.rarete).nom)}</span>
            <span class="nb">${nf(x.possedees)} / ${nf(x.total)}</span>
            <span class="ct-barre"><i style="width:${x.total ? x.possedees / x.total * 100 : 0}%"></i></span>
          </button>`).join('')}</div>
      </section>

      <div class="ct-outils">
        <label class="ct-recherche">${ico('loupe', 17)}<input type="search" placeholder="Chercher un artiste" value="${esc(o.q)}" data-q aria-label="Chercher un artiste"></label>
        <div class="ct-segment" role="group" aria-label="Afficher">
          ${[['toutes', 'Toutes'], ['possedees', 'Obtenues'], ['manquantes', 'Manquantes'], ['doublons', 'Doublons'], ['holos', 'Holos']].map(([v, l]) => `<button type="button" data-v="${v}" class="${o.vue === v ? 'actif' : ''}" aria-pressed="${o.vue === v}">${l}</button>`).join('')}
        </div>
        <select class="ct-select" data-tri aria-label="Trier">
          ${[['numero', 'Numéro'], ['rarete', 'Rareté'], ['fans', 'Fans'], ['nom', 'Nom (A–Z)'], ['recent', 'Dernières obtenues']].map(([v, l]) => `<option value="${v}"${o.tri === v ? ' selected' : ''}>${l}</option>`).join('')}
        </select>
        ${r.doublons > 0 ? `<button type="button" class="ct-btn" data-recycler-tout>${ico('recycler', 16)}Recycler les doublons<span class="cout" style="background:rgba(242,193,78,.15)">+${nf(r.valeur_doublons)}</span></button>` : ''}
      </div>

      ${r.cartes.length
        ? `<div class="ct-grille">${r.cartes.map((c, i) => `<button type="button" class="ct-case" data-i="${i}" aria-label="${esc(c.nom)}${c.quantite ? '' : ', pas encore obtenue'}">${carteHtml(c, { quantite: true, verrou: !c.quantite })}</button>`).join('')}</div>`
        : `<div class="ct-panneau ct-vide">${o.q || o.rarete || o.vue !== 'toutes' ? '<b>Aucune carte</b>Rien ne correspond à ces filtres.' : '<b>Aucune carte pour l\'instant</b>Les cartes arrivent dès que les artistes sont prêts.'}</div>`}
      ${r.pages > 1 ? `<div class="ct-pages"><button type="button" class="ct-btn petit" data-page="-1" ${o.page <= 1 ? 'disabled' : ''}>Précédente</button><span>Page ${r.page} sur ${r.pages}</span><button type="button" class="ct-btn petit" data-page="1" ${o.page >= r.pages ? 'disabled' : ''}>Suivante</button></div>` : ''}`;

    let minuteur = null;
    const champ = S.corps.querySelector('[data-q]');
    champ.addEventListener('input', () => {
      clearTimeout(minuteur);
      minuteur = setTimeout(() => { o.q = champ.value.trim(); o.page = 1; vueCollection().catch(() => {}); }, 320);
    });
    S.corps.querySelectorAll('[data-rar]').forEach((b) => b.addEventListener('click', () => { const v = Number(b.dataset.rar); o.rarete = o.rarete === v ? null : v; o.page = 1; vueCollection(); }));
    S.corps.querySelectorAll('[data-v]').forEach((b) => b.addEventListener('click', () => { o.vue = b.dataset.v; o.page = 1; vueCollection(); }));
    S.corps.querySelector('[data-tri]').addEventListener('change', (ev) => { o.tri = ev.target.value; o.page = 1; vueCollection(); });
    S.corps.querySelectorAll('[data-page]').forEach((b) => b.addEventListener('click', () => {
      o.page = Math.max(1, o.page + Number(b.dataset.page));
      vueCollection().then(() => { const t = S.hote.querySelector('.ct-onglets'); if(t) t.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    }));
    S.corps.querySelectorAll('.ct-grille [data-i]').forEach((b) => b.addEventListener('click', () => fiche(r.cartes[Number(b.dataset.i)].id)));
    const rt = S.corps.querySelector('[data-recycler-tout]');
    if(rt) rt.addEventListener('click', () => recyclerTout(r.doublons, r.valeur_doublons));
    if(o.q){ champ.focus(); champ.setSelectionRange(champ.value.length, champ.value.length); }
  }

  function recyclerTout(nb, valeur){
    const f = fenetre(`
      <h2>Recycler tes doublons</h2>
      <p class="sous">Tu gardes un exemplaire de chaque carte (et de chaque holo). Les ${pluriel(nb, 'doublon')} deviennent des vinyles, à dépenser à l'atelier pour fabriquer les cartes qui te manquent.</p>
      <div class="ct-ligne-act" style="margin-top:18px"><span class="ct-pastille-ico" style="color:#F2C14E; background:rgba(242,193,78,.12)">${ico('vinyle', 20)}</span><div class="tx"><b>+${nf(valeur)} vinyles</b>pour ${pluriel(nb, 'carte')}</div></div>
      <div class="ct-actions" style="justify-content:flex-end"><button type="button" class="ct-btn" data-non>Annuler</button><button type="button" class="ct-btn principal" data-oui>Recycler</button></div>`);
    f.corps.querySelector('[data-non]').addEventListener('click', f.fermer);
    const b = f.corps.querySelector('[data-oui]');
    b.addEventListener('click', async () => {
      b.disabled = true;
      try{
        const x = await appel('jeu_recycler_tout');
        poserEtat(x.etat); majEntete(); Son.jouer('gain'); vibre(25);
        toast('+' + nf(x.vinyles) + ' vinyles');
        f.fermer();
        vueCollection();
      }catch(e){ toast(e.message, 'err'); b.disabled = false; }
    });
  }

  // ---------------------------------------------------------------------
  // Missions
  // ---------------------------------------------------------------------

  async function vueMissions(){

    const m = await appel('jeu_missions');

    const ligne = (q) => {
      const fait = q.progres >= q.objectif;
      return `
        <div class="ct-ligne${q.prise ? ' fait' : (fait ? ' pret' : '')}">
          <span class="ct-pastille-ico">${ico(q.prise ? 'coche' : 'cible', 19)}</span>
          <div class="tx">
            <b>${esc(q.libelle)}</b>
            <div class="bas"><span class="ct-barre"><i style="width:${Math.round(q.progres / q.objectif * 100)}%"></i></span><small>${nf(q.progres)} / ${nf(q.objectif)}</small></div>
            <div class="ct-gains">${gainsHtml(q)}</div>
          </div>
          ${q.prise ? '' : `<button type="button" class="ct-btn ${fait ? 'principal' : ''} petit" data-prendre="${esc(q.cle)}" ${fait ? '' : 'disabled'}>Récupérer</button>`}
        </div>`;
    };

    const bonus = (b, titre, texte) => `
      <div class="ct-ligne${b.pris ? ' fait' : (b.pret ? ' pret' : '')}" style="margin-top:4px">
        <span class="ct-pastille-ico" style="color:var(--r3); background:rgba(168,121,255,.12)">${ico(b.pris ? 'coche' : 'cadeau', 19)}</span>
        <div class="tx"><b>${esc(titre)}</b><div class="ct-gains">${gainsHtml(b)}</div><small style="display:block; margin-top:6px; font-size:12px; color:var(--muted)">${esc(texte)}</small></div>
        ${b.pris ? '' : `<button type="button" class="ct-btn ${b.pret ? 'principal' : ''} petit" data-prendre="${esc(b.cle)}" ${b.pret ? '' : 'disabled'}>Récupérer</button>`}
      </div>`;

    S.corps.innerHTML = `
      <div class="ct-deux">
        <section class="ct-panneau">
          <div class="ct-entete-panneau"><div><h3>Aujourd'hui</h3><p class="sous">Trois missions, renouvelées chaque jour.</p></div><span class="ct-puce-temps">${ico('horloge', 14)}${duree(m.fin_jour)}</span></div>
          <div class="ct-liste">${m.jour.map(ligne).join('')}${bonus(m.bonus_jour, 'Bonus du jour', 'Termine les trois missions.')}</div>
        </section>
        <section class="ct-panneau">
          <div class="ct-entete-panneau"><div><h3>Cette semaine</h3><p class="sous">Trois défis, du lundi au dimanche.</p></div><span class="ct-puce-temps">${ico('horloge', 14)}${duree(m.fin_semaine)}</span></div>
          <div class="ct-liste">${m.semaine.map(ligne).join('')}${bonus(m.bonus_semaine, 'Bonus de la semaine', 'Termine les trois défis.')}</div>
        </section>
      </div>
      <p style="margin:14px 2px 0; font-size:13px; color:var(--muted)">Noter, écouter, commenter ou donner ton avis sur une sortie compte pour les missions du site.</p>`;

    S.corps.querySelectorAll('[data-prendre]').forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true;
      try{
        const r = await appel('jeu_mission_prendre', { p_cle: b.dataset.prendre });
        poserEtat(r.etat); majEntete(); Son.jouer('gain'); vibre(20);
        toast('Récupéré : ' + gainsTexte(r.gain));
        vueMissions();
      }catch(e){ toast(e.message, 'err'); b.disabled = false; }
    }));
  }

  // ---------------------------------------------------------------------
  // Bonus : cadeau de connexion, roue, coffre
  // ---------------------------------------------------------------------

  function serieHtml(c){
    return `<div class="ct-serie">${c.cadeaux.map((g) => {
      const fait = g.jour < c.jour || (!c.pret && g.jour === c.jour);
      return `
      <div class="ct-jour${fait ? ' fait' : ''}${c.pret && g.jour === c.jour ? ' aujourdhui' : ''}${g.jour === 7 ? ' sept' : ''}">
        <span>J${g.jour}</span>${ico(fait ? 'coche' : (g.garantis ? 'pack' : (g.vinyles ? 'vinyle' : 'eclair')), 17)}
        <b>${g.tirages ? '+' + g.tirages : ''}${g.vinyles ? (g.tirages ? '<br>' : '') + '+' + g.vinyles + 'v' : ''}</b>
      </div>`;
    }).join('')}</div>`;
  }

  async function prendreCadeau(bouton, apres){
    bouton.disabled = true;
    try{
      const r = await appel('jeu_cadeau_prendre');
      poserEtat(r.etat); majEntete(); Son.jouer('gain'); vibre(25);
      toast('Cadeau du jour : ' + gainsTexte(r.gain));
      if(apres) apres();
    }catch(e){ toast(e.message, 'err'); bouton.disabled = false; }
  }

  async function fenetreCadeau(){
    let c;
    try{ c = await appel('jeu_cadeau'); }catch(e){ return; }
    if(!c.pret) return;
    const f = fenetre(`
      <span class="ct-surtitre">${ico('cadeau', 15)}Cadeau de connexion</span>
      <h2 style="margin-top:8px">Jour ${c.jour} de ta série</h2>
      <p class="sous">${c.serie > 0 ? pluriel(c.serie, 'jour') + ' d\'affilée. Reviens demain pour ne pas casser ta série : le 7ᵉ jour est le plus gros.' : 'Reviens chaque jour : les cadeaux grossissent jusqu\'au 7ᵉ jour.'}</p>
      <div style="margin-top:18px">${serieHtml(c)}</div>
      <button type="button" class="ct-btn principal grand" style="width:100%" data-prendre>Récupérer : ${esc(gainsTexte(c.cadeaux[c.jour - 1]))}</button>`);
    const b = f.corps.querySelector('[data-prendre]');
    b.addEventListener('click', () => prendreCadeau(b, () => { f.fermer(); if(S.vue === 'bonus' || S.vue === 'packs') afficherVue(S.vue); }));
  }

  async function vueBonus(){

    const [c, roue, coffre] = await Promise.all([appel('jeu_cadeau'), appel('jeu_roue'), appel('jeu_coffre')]);
    const heure = (iso) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });

    // La roue : des parts sombres aux bleus de la marque, une seule dorée pour le gros lot.
    const sect = roue.secteurs, ang = 360 / sect.length, R = 150;
    const jackpot = (l) => /JACKPOT/i.test(l);
    const couleurs = ['#0f2c4d', '#14406e', '#0c2440', '#185089'];
    const svgRoue = sect.map((s, k) => {
      const a0 = (k - .5) * ang - 90, a1 = (k + .5) * ang - 90;
      const pt = (a) => [R * Math.cos(a * Math.PI / 180), R * Math.sin(a * Math.PI / 180)];
      const [x0, y0] = pt(a0), [x1, y1] = pt(a1);
      const lib = s.libelle.replace(/JACKPOT\s*·\s*/i, '').replace(/\s*💿/, ' vinyles');
      const mots = lib.split(' ');
      const or = jackpot(s.libelle);
      return `<path d="M0 0 L${x0.toFixed(2)} ${y0.toFixed(2)} A${R} ${R} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)} Z" fill="${or ? 'url(#ctOr)' : couleurs[k % couleurs.length]}" stroke="rgba(255,255,255,.14)" stroke-width="1"/>
        <g transform="rotate(${k * ang})"><text x="0" y="${-R + 40}" text-anchor="middle" fill="${or ? '#2a1a00' : '#fff'}" font-weight="800" font-size="17">${esc(mots[0])}</text>
        <text x="0" y="${-R + 57}" text-anchor="middle" fill="${or ? '#3d2700' : 'rgba(255,255,255,.62)'}" font-weight="700" font-size="9.5" letter-spacing="1">${esc(mots.slice(1).join(' ').toUpperCase())}</text></g>`;
    }).join('');

    S.corps.innerHTML = `
      <div class="ct-bonus">
        <section class="ct-panneau roue">
          <div class="ct-entete-panneau"><div><h3>Roue du jour</h3><p class="sous">Un tour gratuit chaque jour.</p></div>${roue.prete ? '' : `<span class="ct-puce-temps">${ico('horloge', 14)}demain</span>`}</div>
          <div class="ct-roue-zone">
            <div class="ct-roue">
              <svg class="ct-roue-pointe" viewBox="0 0 26 32" aria-hidden="true"><path d="M13 31 1.5 6.5A11.5 11.5 0 1 1 24.5 6.5z" fill="#F4F5F6"/><circle cx="13" cy="11" r="4" fill="#1489DE"/></svg>
              <svg viewBox="-160 -160 320 320" role="img" aria-label="Roue du jour">
                <defs><linearGradient id="ctOr" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff1b0"/><stop offset=".5" stop-color="#f2c14e"/><stop offset="1" stop-color="#c88a1e"/></linearGradient></defs>
                <circle r="157" fill="#08111d" stroke="rgba(255,255,255,.14)" stroke-width="2"/>
                <g class="ct-roue-disque" data-disque>${svgRoue}</g>
                <circle r="30" fill="#0b0f15" stroke="rgba(255,255,255,.25)" stroke-width="2"/>
                <g transform="translate(-19 -19) scale(.38)" style="color:#4FB4FF">${EMBLEME.replace('class="ct-embleme"', 'width="100" height="100"')}</g>
              </svg>
            </div>
            <div class="ct-roue-res" data-res>${roue.dernier ? 'Aujourd\'hui : <b>' + esc(roue.dernier.libelle) + '</b>' : 'Des tirages, des vinyles, un pack Épique… et un gros lot.'}</div>
            <button type="button" class="ct-btn principal grand" data-tourner ${roue.prete ? '' : 'disabled'}>${roue.prete ? 'Tourner la roue' : 'Déjà tournée aujourd\'hui'}</button>
          </div>
        </section>

        <section class="ct-panneau">
          <div class="ct-entete-panneau"><div><h3>Cadeau de connexion</h3><p class="sous">${c.serie > 0 ? 'Série de ' + pluriel(c.serie, 'jour') + '. ' : ''}Le 7ᵉ jour est le plus gros.</p></div></div>
          ${serieHtml(c)}
          <button type="button" class="ct-btn ${c.pret ? 'principal' : ''}" style="width:100%" data-cadeau ${c.pret ? '' : 'disabled'}>${c.pret ? 'Récupérer : ' + esc(gainsTexte(c.cadeaux[c.jour - 1])) : 'Récupéré, reviens demain'}</button>
        </section>

        <section class="ct-panneau">
          <div class="ct-entete-panneau"><div><h3>Coffre</h3><p class="sous">8 tirages à 9 h, 13 h, 18 h et 22 h, à prendre dans les 8 heures.</p></div></div>
          <div class="ct-creneaux">${coffre.cadeaux.map((x) => `
            <div class="ct-creneau ${x.etat}">
              <span class="h">${String(x.heure).padStart(2, '0')} h</span>
              <small>${x.etat === 'pret' ? 'jusqu\'à ' + heure(x.fin) : (x.etat === 'a_venir' ? 'à venir' : (x.etat === 'prise' ? 'récupéré' : 'expiré'))}</small>
              <button type="button" class="ct-btn ${x.etat === 'pret' ? 'principal' : ''} petit" data-coffre="${esc(x.cle)}" ${x.etat === 'pret' ? '' : 'disabled'} aria-label="Récupérer ${x.tirages} tirages">${x.etat === 'prise' ? ico('coche', 15) : ico('eclair', 14) + '+' + x.tirages}</button>
            </div>`).join('')}</div>
        </section>
      </div>`;

    const disque = S.corps.querySelector('[data-disque]');
    if(roue.dernier){ disque.style.transition = 'none'; disque.style.transform = `rotate(${-(roue.dernier.n - 1) * ang}deg)`; }

    const t = S.corps.querySelector('[data-tourner]');
    t.addEventListener('click', async () => {
      t.disabled = true;
      let x;
      try{ x = await appel('jeu_roue_tourner'); }catch(e){ toast(e.message, 'err'); t.disabled = false; return; }
      Son.pret();
      disque.getBoundingClientRect();
      disque.style.transition = '';
      disque.style.transform = `rotate(${-(x.n - 1) * ang - 360 * 7}deg)`;
      // Le cliquetis ralentit avec la roue.
      let d = 55, total = 0;
      const clic = () => { if(total > 5000 || !disque.isConnected) return; Son.jouer('tic'); total += d; d *= 1.09; setTimeout(clic, d); };
      clic();
      await attendre(calme() ? 100 : 5500);
      poserEtat(x.etat); majEntete();
      Son.jouer(jackpot(x.libelle) ? 'r5' : 'gain'); vibre([25, 40, 25]);
      const res = S.corps.querySelector('[data-res]');
      if(res) res.innerHTML = 'Gagné : <b>' + esc(x.libelle) + '</b>';
      t.textContent = 'Déjà tournée aujourd\'hui';
      toast('Roue du jour : ' + x.libelle);
    });

    const cb = S.corps.querySelector('[data-cadeau]');
    if(cb) cb.addEventListener('click', () => prendreCadeau(cb, () => vueBonus()));

    S.corps.querySelectorAll('[data-coffre]').forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true;
      try{
        const x = await appel('jeu_coffre_prendre', { p_cle: b.dataset.coffre });
        poserEtat(x.etat); majEntete(); Son.jouer('gain'); vibre(20);
        toast('+' + x.gain.tirages + ' tirages');
        vueBonus();
      }catch(e){ toast(e.message, 'err'); b.disabled = false; }
    }));
  }

  // ---------------------------------------------------------------------
  // Succès
  // ---------------------------------------------------------------------

  const FAMILLES = {
    ouvertures: 'pack', uniques: 'cartes', holos: 'etoile', rares: 'etoile', epiques: 'etoile', legendaires: 'trophee',
    mythiques: 'trophee', niveau: 'eclair', recycles: 'recycler', ateliers: 'marteau', roues: 'roue', serie: 'horloge', missions: 'cible'
  };

  async function vueSucces(){

    const r = await appel('jeu_succes');
    const liste = r.succes || [];
    const familles = {};
    liste.forEach((s) => { (familles[s.famille] = familles[s.famille] || []).push(s); });

    const pris = liste.filter(s => s.pris).length;
    const prets = liste.filter(s => s.atteint && !s.pris);
    const lignes = Object.keys(familles).map((k) => {
      const l = familles[k];
      return { k, s: l.find(x => !x.pris) || l[l.length - 1], l };
    }).sort((a, b) => (Number(b.s.atteint && !b.s.pris) - Number(a.s.atteint && !a.s.pris)) || (Number(a.s.pris) - Number(b.s.pris)) || (b.s.progres / b.s.seuil - a.s.progres / a.s.seuil));

    S.corps.innerHTML = `
      <section class="ct-panneau ct-prog" style="margin-bottom:16px">
        <div class="ct-prog-chiffre">${pris}<small> / ${liste.length}</small></div>
        <div class="ct-prog-droite">
          <div class="lib"><span>succès récupérés</span>${prets.length ? `<button type="button" class="ct-btn principal petit" data-tout>Tout récupérer (${prets.length})</button>` : ''}</div>
          <div class="ct-barre or"><i style="width:${liste.length ? pris / liste.length * 100 : 0}%"></i></div>
        </div>
      </section>
      <div class="ct-liste">${lignes.map(({ k, s, l }) => {
        const pret = s.atteint && !s.pris;
        return `
          <div class="ct-ligne${pret ? ' pret' : (s.pris ? ' fait' : '')}">
            <span class="ct-medaille">${ico(FAMILLES[k] || 'trophee', 20)}</span>
            <div class="tx">
              <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap"><b>${esc(s.nom)}</b><span class="ct-paliers" aria-label="${l.filter(x => x.pris).length} paliers sur ${l.length}">${l.map(x => `<i class="${x.pris ? 'on' : ''}"></i>`).join('')}</span></div>
              <div style="font-size:12.5px; color:var(--muted); margin-top:2px">${esc(s.description)}</div>
              <div class="bas"><span class="ct-barre or"><i style="width:${Math.round(s.progres / s.seuil * 100)}%"></i></span><small>${nf(s.progres)} / ${nf(s.seuil)}</small></div>
              ${s.pris ? '' : `<div class="ct-gains">${gainsHtml(s)}</div>`}
            </div>
            ${s.pris ? '' : `<button type="button" class="ct-btn ${pret ? 'principal' : ''} petit" data-prendre="${esc(s.id)}" ${pret ? '' : 'disabled'}>Récupérer</button>`}
          </div>`;
      }).join('')}</div>`;

    const prendre = async (id) => { const x = await appel('jeu_succes_prendre', { p_id: id }); poserEtat(x.etat); return x; };

    S.corps.querySelectorAll('[data-prendre]').forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true;
      try{ const x = await prendre(b.dataset.prendre); majEntete(); Son.jouer('gain'); vibre(20); toast('Succès : ' + gainsTexte(x.gain)); vueSucces(); }
      catch(e){ toast(e.message, 'err'); b.disabled = false; }
    }));

    const tout = S.corps.querySelector('[data-tout]');
    if(tout) tout.addEventListener('click', async () => {
      tout.disabled = true;
      let t = 0, v = 0;
      for(const s of prets){
        try{ const x = await prendre(s.id); t += x.gain.tirages || 0; v += x.gain.vinyles || 0; }catch(e){ /* déjà pris : on passe */ }
      }
      majEntete(); Son.jouer('gain');
      toast('Récupéré : ' + gainsTexte({ tirages: t, vinyles: v }));
      vueSucces();
    });
  }

  window.Cartes = { monter, quitter };

})();
