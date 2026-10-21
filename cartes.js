/* =====================================================================
   La Wave — le jeu de cartes, côté navigateur

   Le moteur vit dans la base (sql/cartes.sql) : les tirages, la collection, les cadeaux, la roue, les missions, les
   succès. Ce fichier demande et dessine.

     Ouvrir        un pack (×1, ×5, ×10), les chances du moment, le cadeau de connexion
     Collection    toutes tes cartes, tri, filtres, recyclage des doublons
     Discodex      les artistes, ce que tu en possèdes, fabriquer une carte à l'atelier
     Quêtes        3 missions par jour, 3 défis par semaine, leurs coffres
     Roue          un tour par jour
     Coffre        des tirages offerts quatre fois par jour
     Succès        des paliers à récupérer

   Chargé à la demande (renderCartes dans index.html). Si le SQL n'est pas passé, la page le dit.
   ===================================================================== */

(function(){

  'use strict';

  const esc = (t) => escapeHtml(t);
  const nf = (n) => Number(n || 0).toLocaleString('fr-FR');
  const court = (n) => {
    n = Number(n || 0);
    if(n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace('.', ',').replace(',0', '') + ' M';
    if(n >= 1e3) return Math.round(n / 1e3) + ' k';
    return String(n);
  };
  const annee = (iso) => (iso ? String(iso).slice(0, 4) : '');
  const pluriel = (n, mot) => n + ' ' + mot + (n > 1 ? 's' : '');
  const el = (tag, classe, html) => { const e = document.createElement(tag); if(classe) e.className = classe; if(html !== undefined) e.innerHTML = html; return e; };

  const RAR = [null, ['Commun', '#9aa7b8'], ['Rare', '#4aa8ff'], ['Épique', '#b36bff'], ['Légendaire', '#ffb340'], ['Mythique', '#ff4d6d']];
  const VUES = [
    ['ouvrir', 'Ouvrir'], ['collection', 'Collection'], ['discodex', 'Discodex'], ['quetes', 'Quêtes'],
    ['roue', 'Roue'], ['coffre', 'Coffre'], ['succes', 'Succès']
  ];

  const ICONES = {
    ouvrir: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2.4"/><path d="M12 4a8 8 0 0 1 8 8"/>',
    collection: '<rect x="4" y="6" width="11" height="14" rx="2"/><path d="M9 3h9a2 2 0 0 1 2 2v11"/>',
    discodex: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
    quetes: '<path d="M7 4h10a2 2 0 0 1 2 2v14l-3-2-3 2-3-2-3 2V6a2 2 0 0 1 2-2z"/><path d="M9 9h6M9 13h4"/>',
    roue: '<circle cx="12" cy="12" r="8"/><path d="M12 4v16M4 12h16M6.3 6.3l11.4 11.4M17.7 6.3 6.3 17.7"/>',
    coffre: '<rect x="3" y="9" width="18" height="11" rx="2"/><path d="M12 9v11M3 13h18M12 9C10 4.5 5.5 5 5.5 7.4S9.6 9 12 9zM12 9c2-4.5 6.5-4 6.5-1.6S14.4 9 12 9z"/>',
    succes: '<circle cx="12" cy="9" r="5"/><path d="m8.5 13.5-1.5 7 5-2.6 5 2.6-1.5-7"/>'
  };
  const icone = (n, t) => `<svg width="${t || 20}" height="${t || 20}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONES[n] || ''}</svg>`;

  // ---------------------------------------------------------------------
  // La feuille de style, posée une fois
  // ---------------------------------------------------------------------

  const STYLE = `
  .ct, .ct-scene, .ct-voile{--ct-bord:rgba(255,255,255,.10); --ct-fond:rgba(255,255,255,.045); --r1:#9aa7b8; --r2:#4aa8ff; --r3:#b36bff; --r4:#ffb340; --r5:#ff4d6d;}
  .ct{max-width:1120px; margin:0 auto; padding:8px 16px 60px; color:var(--ink);}
  .ct *, .ct-scene *, .ct-voile *{box-sizing:border-box;}
  .ct button, .ct-scene button, .ct-voile button{font:inherit;}
  .ct-btn{all:unset; box-sizing:border-box; cursor:pointer; display:inline-flex; align-items:center; justify-content:center; gap:8px; padding:11px 20px; border-radius:99px; font-size:14px; font-weight:600; color:#06101a; background:var(--ink); transition:transform .15s, filter .15s;}
  .ct-btn:hover{filter:brightness(.93); transform:translateY(-1px);}
  .ct-btn:focus-visible{outline:2px solid var(--blue-bright); outline-offset:2px;}
  .ct-btn.discret{color:var(--ink); background:rgba(255,255,255,.1);}
  .ct-btn.or{color:#2a1a00; background:linear-gradient(135deg, #ffd166, #ff9d3d);}
  .ct-btn.petit{padding:7px 14px; font-size:12.5px;}
  .ct-btn[disabled]{opacity:.45; cursor:default; transform:none; filter:none;}

  /* ---- l'en-tête du joueur ---- */
  .ct-tete{display:flex; align-items:center; gap:14px; flex-wrap:wrap; padding:14px 16px; border-radius:20px; border:1px solid var(--ct-bord); background:linear-gradient(135deg, rgba(123,92,255,.14), rgba(255,160,64,.08)), var(--ct-fond);}
  .ct-niv{position:relative; width:54px; height:54px; flex:none; border-radius:50%; display:grid; place-items:center; background:conic-gradient(#ffb340 calc(var(--p) * 1%), rgba(255,255,255,.12) 0);}
  .ct-niv b{width:44px; height:44px; border-radius:50%; display:grid; place-items:center; font-size:17px; background:#0a0e15;}
  .ct-tete .qui{min-width:0;}
  .ct-tete .qui b{display:block; font-size:15px;}
  .ct-tete .qui small{font-size:11.5px; color:var(--muted);}
  .ct-ress{display:flex; gap:10px; flex-wrap:wrap; margin-left:auto;}
  .ct-pastille{display:flex; align-items:center; gap:8px; padding:8px 13px; border-radius:14px; background:rgba(0,0,0,.28); border:1px solid var(--ct-bord); font-size:14px; font-weight:600; font-variant-numeric:tabular-nums;}
  .ct-pastille small{font-weight:400; font-size:11px; color:var(--muted);}
  .ct-pastille .ico{font-size:17px; line-height:1;}

  .ct-nav{display:flex; gap:6px; margin:14px 0; overflow-x:auto; scrollbar-width:none; padding-bottom:2px;}
  .ct-onglet{all:unset; box-sizing:border-box; cursor:pointer; position:relative; flex:none; display:inline-flex; align-items:center; gap:7px; padding:9px 15px; border-radius:99px; font-size:13.5px; font-weight:600; color:var(--muted); border:1px solid var(--ct-bord);}
  .ct-onglet:hover{color:var(--ink);}
  .ct-onglet.actif{color:#06101a; background:var(--ink); border-color:var(--ink);}
  .ct-onglet:focus-visible{outline:2px solid var(--blue-bright); outline-offset:2px;}
  .ct-badge{min-width:17px; height:17px; padding:0 5px; border-radius:99px; display:inline-grid; place-items:center; font-size:10.5px; font-weight:700; color:#fff; background:#ff4d6d;}

  .ct-titre{margin:22px 0 10px; font-size:12px; font-weight:600; letter-spacing:.14em; text-transform:uppercase; color:var(--muted);}
  .ct-vide{padding:40px 12px; text-align:center; color:var(--muted); font-size:14px; line-height:1.5;}
  .ct-note{margin:10px 0 0; font-size:12.5px; color:var(--muted); line-height:1.5;}

  /* ---- la carte ---- */
  .ct-carte{position:relative; width:100%; aspect-ratio:5 / 7.2; border-radius:14px; padding:7px; background:linear-gradient(160deg, color-mix(in srgb, var(--rc) 55%, #10141c), color-mix(in srgb, var(--rc) 18%, #080b11)); box-shadow:0 0 0 1px color-mix(in srgb, var(--rc) 70%, transparent), 0 8px 22px rgba(0,0,0,.45); overflow:hidden; text-align:left; color:#fff; isolation:isolate;}
  .ct-carte.r1{--rc:var(--r1);} .ct-carte.r2{--rc:var(--r2);} .ct-carte.r3{--rc:var(--r3);} .ct-carte.r4{--rc:var(--r4);} .ct-carte.r5{--rc:var(--r5);}
  .ct-art{position:relative; width:100%; aspect-ratio:1; border-radius:9px; overflow:hidden; background:#0b0f15;}
  .ct-art img{width:100%; height:100%; object-fit:cover; display:block; max-width:none;}
  .ct-gem{position:absolute; top:6px; left:6px; padding:2px 7px; border-radius:99px; font-size:9px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; color:#0a0e15; background:var(--rc);}
  .ct-infos{padding:7px 3px 2px;}
  .ct-nom{font-size:12px; font-weight:700; line-height:1.2; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;}
  .ct-artiste{margin-top:2px; font-size:10.5px; color:rgba(255,255,255,.72); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
  .ct-pied{position:absolute; left:7px; right:7px; bottom:6px; display:flex; justify-content:space-between; font-size:9.5px; color:rgba(255,255,255,.6); font-variant-numeric:tabular-nums;}
  .ct-q{position:absolute; top:6px; right:6px; padding:2px 7px; border-radius:99px; font-size:10px; font-weight:700; background:rgba(0,0,0,.65); color:#fff;}
  .ct-nouveau{position:absolute; bottom:24px; right:6px; padding:2px 7px; border-radius:99px; font-size:9px; font-weight:800; letter-spacing:.06em; text-transform:uppercase; color:#06101a; background:#7be0a4;}
  .ct-carte.r5{box-shadow:0 0 0 1px var(--r5), 0 0 24px rgba(255,77,109,.35), 0 8px 22px rgba(0,0,0,.45);}
  .ct-carte.r4{box-shadow:0 0 0 1px var(--r4), 0 0 20px rgba(255,179,64,.28), 0 8px 22px rgba(0,0,0,.45);}
  .ct-carte.holo .ct-art::after, .ct-carte.holo::after{content:''; position:absolute; inset:0; pointer-events:none; mix-blend-mode:color-dodge; opacity:.5;
    background:conic-gradient(from var(--ang, 0deg) at var(--hx, 50%) var(--hy, 50%), #ff6ad5, #6aa8ff, #7dffd0, #ffe56a, #ff6ad5); animation:ctHolo 6s linear infinite;}
  .ct-carte.holo::after{opacity:.22; z-index:3;}
  .ct-carte.r5::before{content:''; position:absolute; inset:0; z-index:2; pointer-events:none; background:linear-gradient(115deg, transparent 38%, rgba(255,255,255,.28) 50%, transparent 62%); background-size:260% 100%; animation:ctBrille 3.4s linear infinite;}
  .ct-carte.r4::before{content:''; position:absolute; inset:0; z-index:2; pointer-events:none; background:linear-gradient(115deg, transparent 40%, rgba(255,255,255,.18) 50%, transparent 60%); background-size:260% 100%; animation:ctBrille 4.6s linear infinite;}
  .ct-case{all:unset; box-sizing:border-box; display:block; cursor:pointer; border-radius:14px; transition:transform .18s ease;}
  .ct-case:hover{transform:translateY(-4px) scale(1.02);}
  .ct-case:focus-visible{outline:2px solid var(--blue-bright); outline-offset:3px;}
  .ct-case.manque .ct-carte{filter:grayscale(1) brightness(.45); box-shadow:0 0 0 1px rgba(255,255,255,.12);}

  .ct-grille{display:grid; grid-template-columns:repeat(auto-fill, minmax(138px, 1fr)); gap:14px;}

  /* ---- Ouvrir ---- */
  .ct-hero{position:relative; display:grid; grid-template-columns:minmax(0, 1fr) minmax(0, 1.1fr); gap:20px; align-items:center; padding:26px; border-radius:26px; overflow:hidden; border:1px solid var(--ct-bord);
    background:radial-gradient(90% 100% at 20% 0%, rgba(123,92,255,.3), transparent 60%), radial-gradient(80% 90% at 100% 100%, rgba(255,90,209,.2), transparent 60%), #0a0d14;}
  .ct-hero h2{margin:0; font-size:34px; line-height:1.05; letter-spacing:-.01em;}
  .ct-hero h2 span{background:linear-gradient(90deg, #ff6ad5, #ffb340); -webkit-background-clip:text; background-clip:text; color:transparent;}
  .ct-hero p{margin:12px 0 0; font-size:14px; line-height:1.55; color:var(--ink-soft); max-width:46ch;}
  .ct-actions{display:flex; flex-wrap:wrap; gap:10px; margin-top:20px;}
  .ct-pack-zone{display:grid; place-items:center; min-height:300px;}
  .ct-pack{position:relative; width:190px; height:260px; border-radius:16px; transform:rotate(-4deg); animation:ctFlotte 4.5s ease-in-out infinite; filter:drop-shadow(0 20px 40px rgba(123,92,255,.45));
    background:linear-gradient(150deg, #7b5cff 0%, #c04bd8 55%, #ff7a59 100%); border:1px solid rgba(255,255,255,.3); overflow:hidden;}
  .ct-pack::before{content:''; position:absolute; inset:0; background:linear-gradient(115deg, transparent 38%, rgba(255,255,255,.35) 50%, transparent 62%); background-size:260% 100%; animation:ctBrille 3.2s linear infinite;}
  .ct-pack .disque{position:absolute; left:50%; top:46%; width:130px; height:130px; transform:translate(-50%, -50%); border-radius:50%;
    background:radial-gradient(circle, #1a1a22 0 22%, #0b0b10 23% 100%), repeating-radial-gradient(circle, rgba(255,255,255,.06) 0 2px, transparent 2px 5px); box-shadow:0 0 0 3px rgba(0,0,0,.35); animation:ctTourne 9s linear infinite;}
  .ct-pack .disque::after{content:''; position:absolute; left:50%; top:50%; width:44px; height:44px; transform:translate(-50%, -50%); border-radius:50%; background:linear-gradient(135deg, #ffd166, #ff7a59);}
  .ct-pack .marque{position:absolute; left:0; right:0; bottom:16px; text-align:center; font-size:15px; font-weight:800; letter-spacing:.3em; text-transform:uppercase; text-shadow:0 2px 10px rgba(0,0,0,.4);}
  .ct-pack.garanti{background:linear-gradient(150deg, #b36bff 0%, #ff4d6d 60%, #ffb340 100%);}
  .ct-chances{display:grid; grid-template-columns:repeat(5, 1fr); gap:8px;}
  .ct-chance{padding:12px 6px; border-radius:14px; text-align:center; border:1px solid color-mix(in srgb, var(--rc) 50%, transparent); background:linear-gradient(160deg, color-mix(in srgb, var(--rc) 16%, #0c111a), #090d14);}
  .ct-chance b{display:block; font-size:16px; font-variant-numeric:tabular-nums;}
  .ct-chance span{display:block; margin-top:2px; font-size:10.5px; letter-spacing:.06em; text-transform:uppercase; color:var(--rc);}
  .ct-bandeau{margin-top:14px; padding:11px 14px; border-radius:14px; font-size:13px; border:1px solid rgba(255,179,64,.5); background:rgba(255,179,64,.1);}
  .ct-reste{margin-top:10px; font-size:12.5px; color:var(--ink-soft); min-height:1.5em;}
  .ct-raccourci{all:unset; box-sizing:border-box; cursor:pointer; display:flex; align-items:center; gap:14px; padding:14px 16px; border-radius:18px; border:1px solid var(--ct-bord); background:var(--ct-fond);}
  .ct-raccourci.pret{border-color:#ffb340; background:rgba(255,179,64,.08);}
  .ct-raccourci:focus-visible{outline:2px solid var(--blue-bright); outline-offset:2px;}
  .ct-raccourci .ico{font-size:26px;}
  .ct-raccourci b{display:block; font-size:14px;}
  .ct-raccourci small{display:block; font-size:12px; color:var(--muted);}

  /* ---- la scène d'ouverture ---- */
  .ct-scene{position:fixed; inset:0; z-index:500; display:flex; flex-direction:column; align-items:center; justify-content:center; color:#fff; overflow:hidden; animation:ctVoile .25s ease both; touch-action:manipulation;}
  .ct-scene-fond{position:absolute; inset:0; background:radial-gradient(70% 70% at 50% 45%, color-mix(in srgb, var(--aura, #7b5cff) 30%, #080a10), #04050a 75%); transition:background .6s;}
  .ct-scene-x{all:unset; position:absolute; top:16px; right:16px; z-index:5; width:40px; height:40px; display:grid; place-items:center; border-radius:50%; background:rgba(255,255,255,.1); font-size:22px; cursor:pointer;}
  .ct-scene-x:focus-visible{outline:2px solid #fff;}
  .ct-scene-zone{position:relative; z-index:2; display:grid; place-items:center; width:100%; flex:1; min-height:0; padding:20px;}
  .ct-scene-pied{position:relative; z-index:3; min-height:84px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:10px; padding:0 16px 24px; text-align:center;}
  .ct-scene-pied small{color:rgba(255,255,255,.7); font-size:13px;}
  .ct-aura{position:absolute; left:50%; top:50%; width:min(80vw, 520px); height:min(80vw, 520px); transform:translate(-50%, -50%); border-radius:50%; pointer-events:none;
    background:radial-gradient(circle, color-mix(in srgb, var(--aura) 55%, transparent), transparent 65%); animation:ctAura 2.4s ease-in-out infinite;}
  .ct-rayons{position:absolute; left:50%; top:50%; width:min(150vw, 1100px); height:min(150vw, 1100px); transform:translate(-50%, -50%); pointer-events:none; opacity:.55;
    background:repeating-conic-gradient(from 0deg, color-mix(in srgb, var(--aura) 60%, transparent) 0 5deg, transparent 5deg 18deg); -webkit-mask-image:radial-gradient(circle, #000 0, transparent 65%); mask-image:radial-gradient(circle, #000 0, transparent 65%); animation:ctTourne 28s linear infinite;}
  .ct-scene.tremble .ct-scene-zone{animation:ctTremble .5s ease-in-out;}
  .ct-flash{position:absolute; inset:0; z-index:4; pointer-events:none; background:#fff; opacity:0;}
  .ct-flash.on{animation:ctFlash .7s ease-out;}
  .ct-pack-scene{position:relative; cursor:pointer; display:grid; place-items:center;}
  .ct-pack-scene .ct-pack{animation:ctFlotte 3s ease-in-out infinite;}
  .ct-pack-scene.secoue .ct-pack{animation:ctSecoue .7s ease-in-out;}
  .ct-pile{position:absolute; width:190px; height:260px; border-radius:16px; background:linear-gradient(150deg, #4b3aa8, #8a3aa0); border:1px solid rgba(255,255,255,.2);}
  .ct-flip{position:relative; width:min(66vw, 280px); perspective:1100px; cursor:pointer; z-index:2;}
  .ct-flip-in{position:relative; width:100%; aspect-ratio:5 / 7.2; transform-style:preserve-3d; transition:transform .75s cubic-bezier(.2, .8, .2, 1);}
  .ct-flip.retourne .ct-flip-in{transform:rotateY(180deg);}
  .ct-face, .ct-dos{position:absolute; inset:0; backface-visibility:hidden; -webkit-backface-visibility:hidden; border-radius:14px;}
  .ct-face{transform:rotateY(180deg);}
  .ct-face .ct-carte{height:100%; aspect-ratio:auto;}
  .ct-face .ct-nom{font-size:15px;} .ct-face .ct-artiste{font-size:12.5px;} .ct-face .ct-gem{font-size:10px; padding:3px 9px;} .ct-face .ct-pied{font-size:11px;}
  .ct-dos{display:grid; place-items:center; background:linear-gradient(150deg, #231a4f, #3d1f5e); border:1px solid rgba(255,255,255,.25); box-shadow:0 20px 60px rgba(0,0,0,.6);}
  .ct-dos i{width:46%; aspect-ratio:1; border-radius:50%; background:radial-gradient(circle, #ffd166 0 16%, #14141c 17% 100%), repeating-radial-gradient(circle, rgba(255,255,255,.08) 0 2px, transparent 2px 5px); box-shadow:0 0 0 3px rgba(255,255,255,.15); animation:ctTourneSimple 7s linear infinite;}
  .ct-dos.attente{animation:ctBat .5s ease-in-out infinite;}
  .ct-etiquette{position:absolute; left:50%; top:-8px; transform:translate(-50%, -100%); z-index:4; padding:6px 16px; border-radius:99px; font-size:13px; font-weight:800; letter-spacing:.14em; text-transform:uppercase; color:#0a0e15; background:var(--aura); white-space:nowrap; animation:ctPopC .45s ease both;}
  .ct-etiquette.nouveau{background:#7be0a4;}
  .ct-particules{position:absolute; left:50%; top:50%; z-index:6; pointer-events:none;}
  .ct-particules i{position:absolute; width:8px; height:8px; margin:-4px; border-radius:50%; background:var(--c); box-shadow:0 0 12px var(--c); animation:ctJaillit 1s cubic-bezier(.12, .8, .3, 1) both;}
  .ct-resume{width:min(1000px, 100%); max-height:100%; overflow-y:auto; scrollbar-width:thin; padding:4px;}
  .ct-resume h3{margin:0 0 4px; text-align:center; font-size:22px;}
  .ct-resume .stats{margin:0 0 16px; text-align:center; font-size:13.5px; color:rgba(255,255,255,.75);}
  .ct-resume .ct-grille{grid-template-columns:repeat(auto-fill, minmax(104px, 1fr)); gap:10px;}
  .ct-resume .ct-nom{font-size:10.5px;} .ct-resume .ct-artiste{font-size:9.5px;}
  .ct-resume .ct-carte-cell{animation:ctPop .5s ease both;}

  /* ---- fenêtres ---- */
  .ct-voile{position:fixed; inset:0; z-index:480; display:flex; align-items:center; justify-content:center; padding:16px; background:rgba(3,5,8,.78); backdrop-filter:blur(10px); -webkit-backdrop-filter:blur(10px); animation:ctVoile .2s ease both;}
  .ct-fen{position:relative; width:min(560px, 100%); max-height:92vh; overflow-y:auto; scrollbar-width:thin; padding:20px; border-radius:24px; border:1px solid var(--line-strong); background:#0b0f15; color:var(--ink); animation:ctMonte .3s ease both;}
  .ct-fen.large{width:min(860px, 100%);}
  .ct-fen h2{margin:0 0 4px; font-size:19px; padding-right:34px;}
  .ct-fen .sous{margin:0 0 16px; font-size:13px; color:var(--muted);}
  .ct-fermer{all:unset; position:absolute; top:12px; right:12px; width:34px; height:34px; display:grid; place-items:center; border-radius:50%; background:rgba(255,255,255,.08); font-size:18px; cursor:pointer;}
  .ct-fermer:hover{background:rgba(255,255,255,.16);}
  .ct-fermer:focus-visible{outline:2px solid var(--blue-bright);}
  .ct-fiche{display:grid; grid-template-columns:minmax(0, 220px) minmax(0, 1fr); gap:20px; align-items:start;}
  .ct-fiche dl{margin:0; display:grid; grid-template-columns:auto 1fr; gap:6px 14px; font-size:13px;}
  .ct-fiche dt{color:var(--muted);} .ct-fiche dd{margin:0; font-variant-numeric:tabular-nums;}
  .ct-ligne-act{display:flex; flex-wrap:wrap; align-items:center; gap:8px; margin-top:14px;}
  .ct-ligne-act select{padding:8px 10px; border-radius:10px; border:1px solid var(--line-strong); background:rgba(255,255,255,.06); color:var(--ink); font:inherit; font-size:13px;}

  /* ---- barre d'outils ---- */
  .ct-outils{display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin-bottom:14px;}
  .ct-outils input[type=search], .ct-outils select{padding:9px 13px; border-radius:99px; border:1px solid var(--line-strong); background:rgba(255,255,255,.06); color:var(--ink); font:inherit; font-size:13.5px; min-width:0;}
  .ct-outils input[type=search]{flex:1 1 180px;}
  .ct-puce{all:unset; box-sizing:border-box; cursor:pointer; padding:7px 13px; border-radius:99px; font-size:12.5px; color:var(--muted); border:1px solid var(--ct-bord); white-space:nowrap;}
  .ct-puce.actif{color:var(--ink); background:rgba(255,255,255,.12); border-color:var(--line-strong);}
  .ct-puce:focus-visible{outline:2px solid var(--blue-bright);}
  .ct-pager{display:flex; align-items:center; justify-content:center; gap:14px; margin-top:20px; font-size:13px; color:var(--muted);}
  .ct-barre{display:block; height:6px; border-radius:99px; background:rgba(255,255,255,.12); overflow:hidden;}
  .ct-barre i{display:block; height:100%; border-radius:99px; background:linear-gradient(90deg, #ffb340, #ffd166); transition:width .6s ease;}
  .ct-synthese{display:flex; align-items:center; gap:16px; padding:14px 16px; margin-bottom:14px; border-radius:18px; border:1px solid var(--ct-bord); background:var(--ct-fond);}
  .ct-synthese .gros{font-size:26px; font-weight:700; font-variant-numeric:tabular-nums;}
  .ct-synthese .gros small{font-size:13px; font-weight:400; color:var(--muted);}
  .ct-synthese .barre{flex:1; min-width:0;}

  /* ---- Discodex ---- */
  .ct-artistes{display:grid; grid-template-columns:repeat(auto-fill, minmax(190px, 1fr)); gap:10px;}
  .ct-artiste-case{all:unset; box-sizing:border-box; cursor:pointer; display:flex; align-items:center; gap:12px; padding:10px; border-radius:16px; border:1px solid color-mix(in srgb, var(--rc) 45%, transparent); background:linear-gradient(160deg, color-mix(in srgb, var(--rc) 13%, #0c111a), #090d14); transition:transform .15s;}
  .ct-artiste-case:hover{transform:translateY(-2px);}
  .ct-artiste-case:focus-visible{outline:2px solid var(--blue-bright); outline-offset:2px;}
  .ct-artiste-case .ph{width:52px; height:52px; flex:none; border-radius:50%; overflow:hidden; background:#10151c; box-shadow:0 0 0 2px var(--rc); display:grid; place-items:center; font-weight:700;}
  .ct-artiste-case .ph img{width:100%; height:100%; object-fit:cover; max-width:none;}
  .ct-artiste-case .tx{min-width:0; flex:1;}
  .ct-artiste-case b{display:block; font-size:13px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
  .ct-artiste-case small{display:block; margin:2px 0 6px; font-size:11px; color:var(--muted);}
  .ct-artiste-case .ct-barre{height:4px;}

  /* ---- quêtes, coffre, succès ---- */
  .ct-liste{display:grid; gap:10px;}
  .ct-mission{display:flex; align-items:center; gap:14px; padding:14px 16px; border-radius:18px; border:1px solid var(--ct-bord); background:var(--ct-fond);}
  .ct-mission.fait{border-color:rgba(123,224,164,.5);}
  .ct-mission.pret{border-color:#ffb340; background:rgba(255,179,64,.08);}
  .ct-mission .tx{flex:1; min-width:0;}
  .ct-mission .tx b{display:block; font-size:14px;}
  .ct-mission .tx small{display:block; margin:3px 0 7px; font-size:12px; color:var(--muted);}
  .ct-gain{display:inline-flex; gap:6px; flex-wrap:wrap; font-size:12px; color:var(--ink-soft);}
  .ct-gain span{padding:2px 8px; border-radius:99px; background:rgba(255,255,255,.08);}
  .ct-coffre-bloc{display:grid; grid-template-columns:repeat(auto-fill, minmax(220px, 1fr)); gap:10px;}
  .ct-slot{display:flex; flex-direction:column; gap:8px; padding:16px; border-radius:18px; border:1px solid var(--ct-bord); background:var(--ct-fond); text-align:center;}
  .ct-slot .heure{font-size:26px; font-weight:700; font-variant-numeric:tabular-nums;}
  .ct-slot.pret{border-color:#ffb340; background:rgba(255,179,64,.08);}
  .ct-slot.prise, .ct-slot.expire{opacity:.5;}
  .ct-slot small{color:var(--muted); font-size:12px;}
  .ct-succes{display:flex; align-items:center; gap:14px; padding:12px 16px; border-radius:16px; border:1px solid var(--ct-bord); background:var(--ct-fond);}
  .ct-succes.atteint{border-color:#ffb340; background:rgba(255,179,64,.07);}
  .ct-succes .medaille{width:44px; height:44px; flex:none; border-radius:50%; display:grid; place-items:center; font-size:20px; background:rgba(255,255,255,.07);}
  .ct-succes.atteint .medaille{background:linear-gradient(135deg, #ffd166, #ff9d3d);}
  .ct-succes .tx{flex:1; min-width:0;}
  .ct-succes .tx b{display:block; font-size:14px;} .ct-succes .tx small{display:block; font-size:12px; color:var(--muted); margin-bottom:6px;}

  /* ---- la roue ---- */
  .ct-roue-zone{display:grid; place-items:center; gap:18px; padding:10px 0 20px;}
  .ct-roue-cadre{position:relative; width:min(86vw, 380px); aspect-ratio:1;}
  .ct-roue-cadre svg{width:100%; height:100%; display:block; overflow:visible;}
  .ct-roue-disque{transform-origin:0 0; transition:transform 5.2s cubic-bezier(.12, .7, .08, 1);}
  .ct-roue-pointe{position:absolute; left:50%; top:-10px; width:0; height:0; transform:translateX(-50%); border-left:14px solid transparent; border-right:14px solid transparent; border-top:28px solid #fff; filter:drop-shadow(0 4px 8px rgba(0,0,0,.5)); z-index:2;}

  /* ---- le cadeau de connexion ---- */
  .ct-serie{display:grid; grid-template-columns:repeat(7, 1fr); gap:6px; margin:16px 0;}
  .ct-jour{display:flex; flex-direction:column; align-items:center; gap:4px; padding:10px 2px; border-radius:12px; border:1px solid var(--ct-bord); background:var(--ct-fond); text-align:center; font-size:10.5px; color:var(--muted);}
  .ct-jour b{font-size:11px; color:var(--ink); line-height:1.25;}
  .ct-jour .ico{font-size:18px;}
  .ct-jour.fait{opacity:.5;}
  .ct-jour.aujourdhui{border-color:#ffb340; background:rgba(255,179,64,.12);}
  .ct-jour.gros{border-color:rgba(255,77,109,.5);}

  .ct-toasts{position:fixed; left:50%; bottom:22px; transform:translateX(-50%); z-index:600; display:grid; gap:8px; pointer-events:none;}
  .ct-toast{padding:11px 18px; border-radius:99px; font-size:13.5px; font-weight:600; color:#06101a; background:#fff; box-shadow:0 10px 30px rgba(0,0,0,.4); animation:ctPopC .3s ease both;}
  .ct-toast.err{color:#fff; background:#d6455a;}
  .ct-confetti{position:fixed; inset:0; z-index:610; pointer-events:none;}

  @keyframes ctFlotte{0%,100%{transform:translateY(0) rotate(-4deg);} 50%{transform:translateY(-12px) rotate(-2deg);}}
  @keyframes ctBrille{from{background-position:130% 0;} to{background-position:-130% 0;}}
  @keyframes ctHolo{to{filter:hue-rotate(360deg);}}
  @keyframes ctTourne{to{transform:translate(-50%, -50%) rotate(360deg);}}
  @keyframes ctTourneSimple{to{transform:rotate(360deg);}}
  @keyframes ctSecoue{0%,100%{transform:rotate(-4deg);} 12%{transform:rotate(-12deg) scale(1.04);} 28%{transform:rotate(10deg) scale(1.07);} 44%{transform:rotate(-9deg) scale(1.1);} 60%{transform:rotate(8deg) scale(1.12);} 80%{transform:rotate(-5deg) scale(1.14);}}
  @keyframes ctPop{from{opacity:0; transform:scale(.6);} to{opacity:1; transform:scale(1);}}
  @keyframes ctPopC{from{opacity:0; transform:translate(-50%, -100%) scale(.6);} to{opacity:1; transform:translate(-50%, -100%) scale(1);}}
  @keyframes ctVoile{from{opacity:0;} to{opacity:1;}}
  @keyframes ctMonte{from{opacity:0; transform:translateY(24px) scale(.97);} to{opacity:1; transform:none;}}
  @keyframes ctAura{0%,100%{opacity:.75; transform:translate(-50%, -50%) scale(.96);} 50%{opacity:1; transform:translate(-50%, -50%) scale(1.06);}}
  @keyframes ctFlash{0%{opacity:.9;} 100%{opacity:0;}}
  @keyframes ctTremble{0%,100%{transform:translate(0, 0);} 15%{transform:translate(-8px, 4px);} 30%{transform:translate(7px, -5px);} 45%{transform:translate(-6px, -3px);} 60%{transform:translate(5px, 5px);} 75%{transform:translate(-3px, 2px);}}
  @keyframes ctBat{0%,100%{transform:scale(1);} 50%{transform:scale(1.035);}}
  @keyframes ctJaillit{from{transform:translate(0, 0) scale(1.3); opacity:1;} to{transform:translate(var(--dx), var(--dy)) scale(.2); opacity:0;}}

  @media (max-width:760px){
    .ct{padding:4px 12px 80px;}
    .ct-hero{grid-template-columns:1fr; padding:20px 16px;}
    .ct-hero h2{font-size:27px;}
    .ct-pack-zone{min-height:250px; order:-1;}
    .ct-pack{width:150px; height:208px;} .ct-pack .disque{width:104px; height:104px;}
    .ct-ress{margin-left:0; width:100%;}
    .ct-grille{grid-template-columns:repeat(auto-fill, minmax(108px, 1fr)); gap:10px;}
    .ct-fiche{grid-template-columns:1fr; justify-items:center;} .ct-fiche > :first-child{width:min(230px, 100%);}
    .ct-chances{gap:5px;} .ct-chance b{font-size:13px;} .ct-chance span{font-size:8.5px;}
    .ct-serie{grid-template-columns:repeat(4, 1fr);}
    .ct-synthese{flex-wrap:wrap;}
  }
  @media (prefers-reduced-motion:reduce){
    .ct-pack, .ct-pack::before, .ct-pack .disque, .ct-aura, .ct-rayons, .ct-dos i, .ct-dos.attente, .ct-carte.holo .ct-art::after, .ct-carte.r5::before, .ct-carte.r4::before{animation:none !important;}
    .ct-flip-in, .ct-roue-disque{transition-duration:.01s;}
  }`;

  function poserStyle(){
    if(document.getElementById('ct-style')) return;
    const s = document.createElement('style');
    s.id = 'ct-style';
    s.textContent = STYLE;
    document.head.appendChild(s);
  }

  // ---------------------------------------------------------------------
  // Petits outils : appels à la base, messages, sons, confettis
  // ---------------------------------------------------------------------

  async function appel(nom, args){
    const { data, error } = await BD.jeuAppel(nom, args || {});
    if(error) throw new Error(error.message || 'Une erreur est survenue. Réessaie dans un instant.');
    if(data === null || data === undefined) throw new Error('Connecte-toi pour jouer.');
    return data;
  }

  function toast(texte, genre){
    let boite = document.querySelector('.ct-toasts');
    if(!boite){ boite = el('div', 'ct-toasts'); document.body.appendChild(boite); }
    const t = el('div', 'ct-toast' + (genre === 'err' ? ' err' : ''));
    t.textContent = texte;
    boite.appendChild(t);
    setTimeout(() => { t.remove(); }, genre === 'err' ? 4500 : 3000);
  }

  let audio = null;
  const sonActif = () => { try{ return localStorage.getItem('lw-cartes-son') !== '0'; }catch(e){ return true; } };

  function note(freq, debut, duree, volume, type){
    if(!audio) return;
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, audio.currentTime + debut);
    g.gain.setValueAtTime(0.0001, audio.currentTime + debut);
    g.gain.exponentialRampToValueAtTime(volume || .12, audio.currentTime + debut + .02);
    g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + debut + duree);
    o.connect(g); g.connect(audio.destination);
    o.start(audio.currentTime + debut); o.stop(audio.currentTime + debut + duree + .05);
  }

  // Un son par événement, synthétisé (rien à charger) : discret pour un Commun, une fanfare pour un Mythique.
  function son(quoi){
    if(!sonActif()) return;
    try{
      if(!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
      if(audio.state === 'suspended') audio.resume();
    }catch(e){ return; }
    if(!audio) return;
    if(quoi === 'ouvre'){ note(180, 0, .25, .1, 'triangle'); note(120, .08, .3, .1, 'triangle'); note(520, .16, .2, .06, 'square'); }
    else if(quoi === 'bat'){ note(70, 0, .16, .18, 'sine'); note(70, .22, .16, .14, 'sine'); }
    else if(quoi === 'r1'){ note(330, 0, .18, .08, 'triangle'); }
    else if(quoi === 'r2'){ note(523, 0, .3, .1); note(659, .09, .3, .08); }
    else if(quoi === 'r3'){ [523, 659, 784].forEach((f, k) => note(f, k * .09, .4, .1)); }
    else if(quoi === 'r4'){ [392, 523, 659, 784, 1047].forEach((f, k) => note(f, k * .08, .5, .1, 'triangle')); }
    else if(quoi === 'r5'){ [262, 392, 523, 659, 784, 1047, 1319].forEach((f, k) => note(f, k * .07, .7, .11, 'triangle')); note(131, 0, 1.2, .14, 'sawtooth'); }
    else if(quoi === 'holo'){ [1319, 1568, 2093].forEach((f, k) => note(f, .05 + k * .06, .5, .06)); }
    else if(quoi === 'gain'){ note(880, 0, .12, .08); note(1175, .08, .2, .08); }
    else if(quoi === 'niveau'){ [523, 659, 784, 1047].forEach((f, k) => note(f, k * .1, .45, .1, 'triangle')); }
  }

  const vibre = (m) => { try{ navigator.vibrate && navigator.vibrate(m); }catch(e){} };

  function confetti(nb, couleurs){
    if(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const c = el('canvas', 'ct-confetti');
    document.body.appendChild(c);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = innerWidth * dpr; c.height = innerHeight * dpr;
    const g = c.getContext('2d'); g.scale(dpr, dpr);
    const cols = couleurs || ['#ff5a4e', '#ffc531', '#2fd8a2', '#3d8bff', '#a35cff', '#ff5ad1'];
    const ps = Array.from({ length: nb || 140 }, () => ({
      x: innerWidth / 2 + (Math.random() - .5) * 160, y: innerHeight * .5, vx: (Math.random() - .5) * 17, vy: -Math.random() * 17 - 5,
      r: Math.random() * 3, vr: (Math.random() - .5) * .4, w: 6 + Math.random() * 6, h: 8 + Math.random() * 8, c: cols[Math.floor(Math.random() * cols.length)]
    }));
    const t0 = performance.now();
    const frame = (t) => {
      g.clearRect(0, 0, innerWidth, innerHeight);
      ps.forEach((p) => {
        p.vy += .42; p.vx *= .985; p.x += p.vx; p.y += p.vy; p.r += p.vr;
        g.save(); g.translate(p.x, p.y); g.rotate(p.r); g.fillStyle = p.c; g.globalAlpha = Math.max(0, 1 - (t - t0) / 2600); g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); g.restore();
      });
      if(t - t0 < 2600) requestAnimationFrame(frame); else c.remove();
    };
    requestAnimationFrame(frame);
  }

  // Une fenêtre : renvoie { fermer, corps, voile } ; onFermer est appelé une fois à la fermeture.
  function fenetre(html, large, onFermer){
    const voile = el('div', 'ct-voile');
    voile.innerHTML = `<div class="ct-fen${large ? ' large' : ''}" role="dialog" aria-modal="true"><button type="button" class="ct-fermer" aria-label="Fermer">×</button><div class="ct-fen-corps">${html}</div></div>`;
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
    function touche(ev){ if(ev.key === 'Escape' && !document.querySelector('.ct-voile:last-of-type ~ .ct-voile')) fermer(); }
    voile.querySelector('.ct-fermer').addEventListener('click', fermer);
    voile.addEventListener('click', (ev) => { if(ev.target === voile) fermer(); });
    document.addEventListener('keydown', touche);
    return { fermer, corps: voile.querySelector('.ct-fen-corps'), voile };
  }

  // ---------------------------------------------------------------------
  // La carte
  // ---------------------------------------------------------------------

  function carteHtml(c, o){
    o = o || {};
    const r = Math.min(Math.max(Number(c.rarete) || 1, 1), 5);
    return `
      <div class="ct-carte r${r}${c.holo ? ' holo' : ''}">
        <div class="ct-art"><img src="${esc(safeUrl(c.cover))}" alt="" loading="lazy" decoding="async"><span class="ct-gem">${esc(RAR[r][0])}${c.holo ? ' · Holo' : ''}</span></div>
        <div class="ct-infos"><div class="ct-nom">${esc(c.titre)}</div><div class="ct-artiste">${esc(c.artiste)}</div></div>
        <div class="ct-pied"><span>${esc(annee(c.sortie))}</span><span>${c.fans ? esc(court(c.fans)) + ' fans' : ''}</span></div>
        ${o.quantite && c.quantite > 1 ? `<span class="ct-q">×${c.quantite}</span>` : ''}
        ${o.nouveau ? '<span class="ct-nouveau">Nouveau</span>' : ''}
      </div>`;
  }

  // Un reflet qui suit le pointeur sur les cartes holographiques.
  function reflets(racine){
    racine.addEventListener('pointermove', (ev) => {
      const c = ev.target.closest && ev.target.closest('.ct-carte.holo');
      if(!c || ev.pointerType === 'touch') return;
      const b = c.getBoundingClientRect();
      c.style.setProperty('--hx', ((ev.clientX - b.left) / b.width * 100).toFixed(0) + '%');
      c.style.setProperty('--hy', ((ev.clientY - b.top) / b.height * 100).toFixed(0) + '%');
      c.style.setProperty('--ang', ((ev.clientX - b.left) / b.width * 180).toFixed(0) + 'deg');
    });
  }

  // ---------------------------------------------------------------------
  // L'état du joueur et l'en-tête
  // ---------------------------------------------------------------------

  const S = { hote: null, etat: null, vue: 'ouvrir', occupe: false, minuteur: null, corps: null, col: { page: 1, tri: 'recent', rarete: null, holo: null, q: '' }, dex: { page: 1, filtre: 'tous', tri: 'fans', q: '' } };

  function duree(s){
    s = Math.max(0, Math.floor(s));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return h ? h + ' h ' + String(m).padStart(2, '0') : (m + ':' + String(x).padStart(2, '0'));
  }

  function enteteHtml(){
    const e = S.etat;
    const pct = Math.max(0, Math.min(100, ((e.xp - e.xp_depart) / Math.max(1, e.xp_fin - e.xp_depart)) * 100));
    return `
      <div class="ct-niv" style="--p:${pct.toFixed(0)}" title="Niveau ${e.niveau} · ${nf(e.xp - e.xp_depart)} / ${nf(e.xp_fin - e.xp_depart)} XP"><b>${e.niveau}</b></div>
      <div class="qui"><b>Niveau ${e.niveau}</b><small>${nf(e.uniques)} cartes sur ${nf(e.total_cartes)}</small></div>
      <div class="ct-ress">
        <div class="ct-pastille" title="Tirages : +3 toutes les 10 minutes jusqu'à ${e.plafond}"><span class="ico">⚡</span>${nf(e.tirages)}<small>/ ${e.plafond}</small><small data-recharge></small></div>
        <div class="ct-pastille" title="Vinyles : recyclage des doublons, atelier"><span class="ico">💿</span>${nf(e.vinyles)}</div>
        ${e.garantis > 0 ? `<button type="button" class="ct-pastille" data-act="garanti" style="cursor:pointer;color:inherit" title="Pack Épique garanti"><span class="ico">🎁</span>${e.garantis}<small>pack Épique</small></button>` : ''}
      </div>`;
  }

  function onglets(){
    const e = S.etat;
    const badges = { quetes: e.missions_pretes, roue: e.roue_prete ? 1 : 0, coffre: e.coffres_prets, ouvrir: e.cadeau_pret ? 1 : 0 };
    return VUES.map(([id, nom]) => `
      <button type="button" class="ct-onglet${S.vue === id ? ' actif' : ''}" data-vue="${id}" role="tab" aria-selected="${S.vue === id}">
        ${icone(id, 17)}${esc(nom)}${badges[id] ? `<span class="ct-badge">${id === 'roue' || id === 'ouvrir' ? '!' : badges[id]}</span>` : ''}
      </button>`).join('');
  }

  function majEntete(){
    if(!S.hote || !S.etat) return;
    const t = S.hote.querySelector('.ct-tete');
    if(t) t.innerHTML = enteteHtml();
    const n = S.hote.querySelector('.ct-nav');
    if(n) n.innerHTML = onglets();
    if(typeof majPastilleCartes === 'function') majPastilleCartes(S.etat);
    tic();
  }

  function tic(){
    const e = S.etat;
    const z = S.hote && S.hote.querySelector('[data-recharge]');
    if(!e || !z) return;
    if(e.prochain_dans === null || e.prochain_dans === undefined || e.tirages >= e.plafond){ z.textContent = e.tirages >= e.plafond ? 'plein' : ''; return; }
    const restant = e.prochain_dans - Math.floor((Date.now() - (e._le || Date.now())) / 1000);
    if(restant <= 0){
      z.textContent = '…';
      if(!S.occupe) rafraichirEtat();
      return;
    }
    z.textContent = '+3 dans ' + duree(restant);
  }

  async function rafraichirEtat(){
    if(S.rafraichit) return;
    S.rafraichit = true;
    try{ poserEtat(await appel('jeu_etat')); majEntete(); }catch(e){ /* le prochain tour réessaie */ }
    S.rafraichit = false;
  }

  function poserEtat(etat){
    S.etat = etat;
    if(S.etat) S.etat._le = Date.now();
  }

  // ---------------------------------------------------------------------
  // Monter la page
  // ---------------------------------------------------------------------

  function invite(hote, titre, texte){
    hote.innerHTML = `<div class="ct"><div class="ct-vide"><b style="display:block;font-size:18px;color:var(--ink);margin-bottom:8px">${esc(titre)}</b>${texte}${currentUser ? '' : '<br><br><button type="button" class="ct-btn" data-connexion>Se connecter</button>'}</div></div>`;
    const b = hote.querySelector('[data-connexion]');
    if(b) b.addEventListener('click', () => { if(typeof openAuthModal === 'function') openAuthModal('login'); });
  }

  async function monter(hote){

    poserStyle();
    S.hote = hote;

    if(!currentUser){
      invite(hote, 'Ton jeu de cartes t\'attend', 'Connecte-toi pour ouvrir des packs, collectionner les sorties du catalogue et relever les défis du jour.');
      return;
    }

    if(!S.etat || !hote.querySelector('.ct')) hote.innerHTML = '<div class="ct"><div class="ct-vide">Chargement…</div></div>';

    try{
      poserEtat(await appel('jeu_etat'));
    }catch(e){
      invite(hote, 'Le jeu n\'a pas pu s\'ouvrir', esc(e.message));
      return;
    }

    const demande = (location.hash.split('/')[1] || '').toLowerCase();
    S.vue = VUES.some(v => v[0] === demande) ? demande : (VUES.some(v => v[0] === S.vue) ? S.vue : 'ouvrir');

    hote.innerHTML = `
      <div class="ct">
        <div class="ct-tete"></div>
        <nav class="ct-nav" role="tablist" aria-label="Le jeu"></nav>
        <div class="ct-corps"></div>
      </div>`;

    S.corps = hote.querySelector('.ct-corps');
    majEntete();
    brancher(hote);
    reflets(hote);

    clearInterval(S.minuteur);
    S.minuteur = setInterval(() => { if(S.hote && S.hote.isConnected) tic(); else clearInterval(S.minuteur); }, 1000);

    await afficherVue(S.vue);

    if(S.etat.cadeau_pret) setTimeout(() => { if(S.hote && S.hote.isConnected && !document.querySelector('.ct-voile, .ct-scene')) cadeau(); }, 600);
  }

  function quitter(){
    clearInterval(S.minuteur);
  }

  function brancher(hote){
    hote.addEventListener('click', (ev) => {
      const v = ev.target.closest('[data-vue]');
      if(v){ changerVue(v.dataset.vue); return; }
      if(ev.target.closest('.ct-tete [data-act="garanti"]')){ ouvrir(1, true); }
    });
  }

  function changerVue(v){
    if(S.vue === v && S.corps && S.corps.children.length) return;
    S.vue = v;
    try{ history.replaceState(history.state, '', '#cartes/' + v); }catch(e){}
    majEntete();
    afficherVue(v);
  }

  async function afficherVue(v){
    S.corps.innerHTML = '<div class="ct-vide">Chargement…</div>';
    try{
      if(v === 'ouvrir') await vueOuvrir();
      else if(v === 'collection') await vueCollection();
      else if(v === 'discodex') await vueDiscodex();
      else if(v === 'quetes') await vueQuetes();
      else if(v === 'roue') await vueRoue();
      else if(v === 'coffre') await vueCoffre();
      else if(v === 'succes') await vueSucces();
    }catch(e){
      S.corps.innerHTML = `<div class="ct-vide">${esc(e.message)}</div>`;
    }
  }

  // ---------------------------------------------------------------------
  // Ouvrir
  // ---------------------------------------------------------------------

  function vueOuvrir(){

    const e = S.etat;
    const ev = e.evenement || {};
    const taux = ev.taux || [62, 24, 9.5, 3.8, 0.7];
    const fmt = (x) => {
      const n = Number(x);
      return (n < 10 ? String(Math.round(n * 10) / 10).replace('.', ',') : String(Math.round(n))) + ' %';
    };

    const bandeaux = [];
    if(ev.lundi) bandeaux.push('🎤 <b>Lundi des légendes</b> : les cartes Épiques et mieux sortent deux fois plus.');
    if(ev.heure_holo) bandeaux.push('✨ <b>Heure holo</b> : jusqu\'à 22 h, les cartes holographiques sortent deux fois plus.');

    const raccourcis = [
      ['cadeau', '🎁', 'Cadeau de connexion', e.cadeau_pret ? 'À récupérer' : 'Récupéré · série de ' + pluriel(e.serie, 'jour'), e.cadeau_pret],
      ['roue', '🎡', 'Roue du jour', e.roue_prete ? 'Un tour t\'attend' : 'Déjà tournée', e.roue_prete],
      ['coffre', '📦', 'Coffre', e.coffres_prets ? pluriel(e.coffres_prets, 'cadeau') + ' à récupérer' : 'Rien pour l\'instant', e.coffres_prets > 0],
      ['quetes', '🎯', 'Missions', e.missions_pretes ? pluriel(e.missions_pretes, 'récompense') + ' à récupérer' : '3 missions par jour', e.missions_pretes > 0]
    ];

    S.corps.innerHTML = `
      <section class="ct-hero">
        <div>
          <h2>Ouvre un pack.<br><span>Trouve une légende.</span></h2>
          <p>Chaque pack contient une sortie du catalogue, tirée selon la notoriété de son artiste : plus il est grand, plus la carte est rare. Collectionne-les toutes, chasse les cartes holographiques et grimpe de niveau.</p>
          <div class="ct-actions">
            <button type="button" class="ct-btn or" data-ouvrir="1" ${e.tirages < 1 ? 'disabled' : ''}>Ouvrir ×1</button>
            <button type="button" class="ct-btn" data-ouvrir="5" ${e.tirages < 5 ? 'disabled' : ''}>Ouvrir ×5</button>
            <button type="button" class="ct-btn" data-ouvrir="10" ${e.tirages < 10 ? 'disabled' : ''}>Ouvrir ×10</button>
            ${e.garantis > 0 ? '<button type="button" class="ct-btn discret" data-garanti>🎁 Pack Épique garanti</button>' : ''}
          </div>
          <div class="ct-reste">${e.tirages < 1 ? 'Plus de tirage : les prochains arrivent toutes les 10 minutes, ou passe par le Coffre, la Roue et les Quêtes.' : 'Un tirage = un pack. Dix packs garantissent au moins une carte Rare ou mieux.'}</div>
        </div>
        <div class="ct-pack-zone"><div class="ct-pack" aria-hidden="true"><span class="disque"></span><span class="marque">La Wave</span></div></div>
      </section>

      ${bandeaux.map(b => `<div class="ct-bandeau">${b}</div>`).join('')}

      <div class="ct-titre">Chances du moment</div>
      <div class="ct-chances">${[1, 2, 3, 4, 5].map(k => `<div class="ct-chance" style="--rc:${RAR[k][1]}"><b>${fmt(taux[k - 1])}</b><span>${esc(RAR[k][0])}</span></div>`).join('')}</div>
      <p class="ct-note">Chaque carte peut sortir en version holographique : 1 chance sur ${ev.heure_holo ? 100 : 200}. La rareté d'une carte vient du nombre de fans Deezer de l'artiste, comparé aux autres artistes du catalogue.</p>

      <div class="ct-titre">Aujourd'hui</div>
      <div class="ct-grille" style="grid-template-columns:repeat(auto-fill, minmax(220px, 1fr))">
        ${raccourcis.map(([cible, ico, titre, sous, pret]) => `
          <button type="button" class="ct-raccourci${pret ? ' pret' : ''}" data-aller="${cible}">
            <span class="ico">${ico}</span><span><b>${esc(titre)}</b><small>${esc(sous)}</small></span>
          </button>`).join('')}
      </div>`;

    S.corps.querySelectorAll('[data-ouvrir]').forEach((b) => b.addEventListener('click', () => ouvrir(Number(b.dataset.ouvrir), false)));
    const g = S.corps.querySelector('[data-garanti]');
    if(g) g.addEventListener('click', () => ouvrir(1, true));
    S.corps.querySelectorAll('[data-aller]').forEach((b) => b.addEventListener('click', () => {
      if(b.dataset.aller === 'cadeau') cadeau(); else changerVue(b.dataset.aller);
    }));
  }

  async function ouvrir(n, garanti){

    if(S.occupe) return;
    S.occupe = true;
    son('ouvre');

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

    await scene(r.cartes, n, garanti);

    S.occupe = false;

    for(const nv of (r.niveaux || [])) await niveauAtteint(nv);

    if(S.vue === 'ouvrir') vueOuvrir();
    else if(S.vue === 'collection') vueCollection();
  }

  function niveauAtteint(nv){
    return new Promise((fin) => {
      son('niveau');
      vibre([40, 60, 40]);
      confetti(110);
      const f = fenetre(`
        <div style="text-align:center;padding:10px 0 4px">
          <div style="font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:var(--muted)">Niveau supérieur</div>
          <div style="font-size:64px;font-weight:800;line-height:1.1;margin:6px 0;background:linear-gradient(135deg,#ffd166,#ff7a59);-webkit-background-clip:text;background-clip:text;color:transparent">${nv.niveau}</div>
          <div class="ct-gain" style="justify-content:center"><span>+${nv.tirages} tirages</span><span>+${nv.vinyles} vinyles</span></div>
          <p class="ct-note">Le plafond de tirages grandit avec ton niveau.</p>
          <div style="margin-top:14px"><button type="button" class="ct-btn or" data-ok>Super</button></div>
        </div>`, false, fin);
      f.corps.querySelector('[data-ok]').addEventListener('click', f.fermer);
    });
  }

  // ---------------------------------------------------------------------
  // La scène d'ouverture : le pack, puis les cartes une à une, puis le bilan
  // ---------------------------------------------------------------------

  function scene(cartes, n, garanti){

    return new Promise((fin) => {

      const ov = el('div', 'ct-scene');
      ov.innerHTML = `
        <div class="ct-scene-fond"></div>
        <button type="button" class="ct-scene-x" aria-label="Fermer">×</button>
        <div class="ct-scene-zone"></div>
        <div class="ct-flash"></div>
        <div class="ct-scene-pied"></div>`;
      const avant = document.documentElement.style.overflow;
      document.documentElement.style.overflow = 'hidden';
      document.body.appendChild(ov);

      const zone = ov.querySelector('.ct-scene-zone');
      const pied = ov.querySelector('.ct-scene-pied');
      const flash = ov.querySelector('.ct-flash');
      let i = 0, retournee = false, termine = false, occupe = false;

      const meilleure = cartes.reduce((m, c) => Math.max(m, c.rarete), 1);
      const couleur = (r) => RAR[r][1];
      const poserAura = (r) => { ov.style.setProperty('--aura', couleur(r)); };

      poserAura(1);

      function fermer(){
        if(termine) return;
        termine = true;
        ov.remove();
        document.removeEventListener('keydown', touche);
        if(!document.querySelector('.ct-voile')) document.documentElement.style.overflow = avant;
        fin();
      }
      function touche(ev){
        if(ev.key === 'Escape') fermer();
        else if(ev.key === ' ' || ev.key === 'Enter'){
          if(ev.target && ev.target.closest && ev.target.closest('button')) return;
          ev.preventDefault();
          avancer();
        }
      }
      document.addEventListener('keydown', touche);
      ov.querySelector('.ct-scene-x').addEventListener('click', fermer);

      // ---- le pack
      function phasePack(){
        const piles = n > 1 ? Array.from({ length: Math.min(n, 4) - 1 }, (_, k) => `<div class="ct-pile" style="transform:translate(${(k + 1) * 14}px, ${(k + 1) * -6}px) rotate(${(k + 1) * 3}deg)"></div>`).join('') : '';
        zone.innerHTML = `<div class="ct-pack-scene" role="button" tabindex="0" aria-label="Ouvrir le pack">${piles}<div class="ct-pack${garanti ? ' garanti' : ''}"><span class="disque"></span><span class="marque">La Wave</span></div></div>`;
        pied.innerHTML = '<small>Touche le pack pour l\'ouvrir</small>';
        const p = zone.querySelector('.ct-pack-scene');
        p.addEventListener('click', ouvrirPack);
        setTimeout(() => { if(!termine && p.isConnected) ouvrirPack(); }, 2200);
        function ouvrirPack(){
          if(p.classList.contains('secoue') || termine) return;
          p.classList.add('secoue');
          son('bat');
          vibre(30);
          setTimeout(() => {
            if(termine) return;
            flash.classList.add('on');
            son('ouvre');
            poserAura(meilleure);
            setTimeout(() => { flash.classList.remove('on'); if(!termine) phaseCarte(); }, 380);
          }, 720);
        }
      }

      // ---- une carte, face cachée puis retournée
      function phaseCarte(){
        const c = cartes[i];
        retournee = false;
        poserAura(1);
        zone.innerHTML = `
          <div class="ct-aura" hidden></div>
          <div class="ct-flip" data-flip role="button" tabindex="0" aria-label="Retourner la carte">
            <div class="ct-flip-in"><div class="ct-dos"><i></i></div><div class="ct-face">${carteHtml(c, {})}</div></div>
          </div>`;
        pied.innerHTML = `<small>${cartes.length > 1 ? 'Carte ' + (i + 1) + ' sur ' + cartes.length + ' · ' : ''}touche la carte pour la retourner</small>${cartes.length > 1 ? '<button type="button" class="ct-btn discret petit" data-tout>Tout voir</button>' : ''}`;
        const bt = pied.querySelector('[data-tout]');
        if(bt) bt.addEventListener('click', (ev) => { ev.stopPropagation(); bilan(); });
        zone.querySelector('[data-flip]').addEventListener('click', avancer);
      }

      async function retourner(){
        if(occupe) return;
        occupe = true;
        const c = cartes[i];
        const f = zone.querySelector('[data-flip]');
        const dos = f.querySelector('.ct-dos');

        // Plus la carte est rare, plus l'attente est longue.
        if(c.rarete >= 3){
          dos.classList.add('attente');
          son('bat');
          vibre(c.rarete >= 4 ? [60, 80, 60] : 30);
          await new Promise(r => setTimeout(r, c.rarete >= 5 ? 1300 : (c.rarete >= 4 ? 900 : 520)));
        }
        if(termine || !f.isConnected){ occupe = false; return; }

        poserAura(c.rarete);
        const aura = zone.querySelector('.ct-aura');
        if(aura){
          aura.hidden = false;
          if(c.rarete >= 4) aura.insertAdjacentHTML('beforebegin', '<div class="ct-rayons"></div>');
        }
        f.classList.add('retourne');
        retournee = true;
        son('r' + c.rarete);
        if(c.holo) setTimeout(() => son('holo'), 250);
        vibre(c.rarete >= 4 ? [30, 40, 30, 40, 80] : 18);

        setTimeout(() => {
          if(termine || !f.isConnected) return;
          const etiquette = c.nouvelle || c.nouveau_holo
            ? `<div class="ct-etiquette nouveau">${c.nouvelle ? 'Nouvelle carte' : 'Nouveau holo'}</div>`
            : `<div class="ct-etiquette">${c.quantite > 1 ? 'Doublon ×' + c.quantite : esc(RAR[c.rarete][0])}</div>`;
          f.insertAdjacentHTML('afterbegin', etiquette);
          particules(f, couleur(c.rarete), c.rarete >= 5 ? 46 : (c.rarete >= 4 ? 34 : (c.rarete >= 3 ? 24 : (c.rarete >= 2 ? 12 : 0))));
          if(c.rarete >= 4){ ov.classList.add('tremble'); setTimeout(() => ov.classList.remove('tremble'), 520); }
          if(c.rarete >= 3 || c.holo) confetti(c.rarete >= 5 ? 220 : (c.rarete >= 4 ? 150 : 80), c.holo ? ['#ff6ad5', '#6aa8ff', '#7dffd0', '#ffe56a'] : [couleur(c.rarete), '#ffffff', '#ffd166']);
        }, 380);

        const dernier = i >= cartes.length - 1;
        pied.innerHTML = `<small>${esc(c.titre)} · ${esc(c.artiste)}</small>
          <button type="button" class="ct-btn ${dernier ? 'or' : ''}" data-suite>${dernier ? (cartes.length > 1 ? 'Voir le bilan' : 'Terminer') : 'Carte suivante'}</button>`;
        pied.querySelector('[data-suite]').addEventListener('click', (ev) => { ev.stopPropagation(); avancer(); });
        occupe = false;
      }

      function particules(cible, c, nb){
        if(!nb) return;
        const z = el('div', 'ct-particules');
        z.innerHTML = Array.from({ length: nb }, (_, k) => {
          const a = k / nb * Math.PI * 2;
          const d = 90 + (k * 37) % 150;
          return `<i style="--dx:${Math.round(Math.cos(a) * d)}px;--dy:${Math.round(Math.sin(a) * d)}px;--c:${c};animation-delay:${(k % 6) * 22}ms"></i>`;
        }).join('');
        cible.appendChild(z);
        setTimeout(() => z.remove(), 1400);
      }

      function avancer(){
        if(termine || occupe) return;
        if(zone.querySelector('.ct-pack-scene')) return;
        if(zone.querySelector('.ct-resume')) return;
        if(!retournee){ retourner(); return; }
        if(i >= cartes.length - 1){ cartes.length > 1 ? bilan() : fermer(); return; }
        i++;
        phaseCarte();
      }

      // ---- le bilan
      function bilan(){
        const tri = cartes.slice().sort((a, b) => b.rarete - a.rarete || Number(b.holo) - Number(a.holo));
        const nouvelles = cartes.filter(c => c.nouvelle).length;
        const holos = cartes.filter(c => c.holo).length;
        const top = tri[0];
        poserAura(meilleure);
        if(meilleure >= 3) confetti(120, [couleur(meilleure), '#ffffff', '#ffd166']);
        zone.innerHTML = `
          <div class="ct-resume">
            <h3>${cartes.length > 1 ? 'Ton bilan' : 'Ta carte'}</h3>
            <p class="stats">${pluriel(nouvelles, 'nouvelle')} sur ${cartes.length}${holos ? ' · ' + pluriel(holos, 'holo') : ''} · meilleure prise : ${esc(RAR[top.rarete][0])}</p>
            <div class="ct-grille">${tri.map((c, k) => `<div style="animation-delay:${k * 40}ms" class="ct-carte-cell">${carteHtml(c, { nouveau: c.nouvelle || c.nouveau_holo, quantite: true })}</div>`).join('')}</div>
          </div>`;
        const encore = S.etat.tirages >= n && !garanti;
        pied.innerHTML = `<div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center">
          ${encore ? `<button type="button" class="ct-btn or" data-encore>Rouvrir ×${n}</button>` : ''}
          <button type="button" class="ct-btn ${encore ? 'discret' : 'or'}" data-fin>Terminer</button></div>`;
        pied.querySelector('[data-fin]').addEventListener('click', fermer);
        const e = pied.querySelector('[data-encore]');
        if(e) e.addEventListener('click', () => { fermer(); setTimeout(() => ouvrir(n, false), 150); });
      }

      phasePack();
    });
  }

  // ---------------------------------------------------------------------
  // Le cadeau de connexion
  // ---------------------------------------------------------------------

  const texteGain = (g) => [g.tirages ? g.tirages + ' tirages' : '', g.vinyles ? g.vinyles + ' vinyles' : '', g.garantis ? 'pack Épique' : ''].filter(Boolean).join(' + ');

  async function cadeau(){

    let c;
    try{ c = await appel('jeu_cadeau'); }catch(e){ toast(e.message, 'err'); return; }
    if(!c.pret){ toast('Cadeau déjà récupéré aujourd\'hui. Reviens demain !'); return; }

    const f = fenetre(`
      <h2>Jour ${c.jour} de ta série</h2>
      <p class="sous">${c.serie > 0 ? pluriel(c.serie, 'jour') + ' d\'affilée : ne casse pas ta série, le 7ᵉ jour est le plus gros.' : 'Reviens chaque jour : les cadeaux grossissent jusqu\'au 7ᵉ jour.'}</p>
      <div class="ct-serie">${c.cadeaux.map((g) => `
        <div class="ct-jour${g.jour < c.jour ? ' fait' : ''}${g.jour === c.jour ? ' aujourdhui' : ''}${g.jour === 7 ? ' gros' : ''}">
          <span>Jour ${g.jour}</span><span class="ico">${g.jour < c.jour ? '✓' : (g.garantis ? '🎁' : (g.tirages ? '⚡' : '💿'))}</span><b>${esc(texteGain(g))}</b>
        </div>`).join('')}</div>
      <button type="button" class="ct-btn or" style="width:100%" data-prendre>Récupérer · ${esc(texteGain(c.cadeaux[c.jour - 1]))}</button>`);

    f.corps.querySelector('[data-prendre]').addEventListener('click', async (ev) => {
      const b = ev.currentTarget;
      b.disabled = true;
      try{
        const r = await appel('jeu_cadeau_prendre');
        poserEtat(r.etat); majEntete();
        son('gain'); vibre(30); confetti(90);
        toast('Cadeau récupéré : ' + texteGain(r.gain) + ' !');
        f.fermer();
        if(S.vue === 'ouvrir') vueOuvrir();
      }catch(e){ toast(e.message, 'err'); b.disabled = false; }
    });
  }

  // ---------------------------------------------------------------------
  // Collection
  // ---------------------------------------------------------------------

  async function vueCollection(){

    const c = S.col;
    const r = await appel('jeu_collection_lire', { p_page: c.page, p_tri: c.tri, p_rarete: c.rarete, p_holo: c.holo, p_q: c.q || null });
    const pct = r.pool ? Math.round(r.uniques / r.pool * 100) : 0;

    S.corps.innerHTML = `
      <div class="ct-synthese">
        <div class="gros">${nf(r.uniques)}<small> / ${nf(r.pool)} cartes</small></div>
        <div class="barre"><span class="ct-barre"><i style="width:${Math.max(pct, r.uniques ? 1 : 0)}%"></i></span></div>
        <b>${pct} %</b>
      </div>
      <div class="ct-outils">
        <input type="search" placeholder="Chercher une carte ou un artiste" value="${esc(c.q)}" data-q aria-label="Chercher">
        <select data-tri aria-label="Trier">
          ${[['recent', 'Plus récentes'], ['rarete', 'Rareté'], ['quantite', 'Doublons'], ['fans', 'Fans'], ['nom', 'Artiste (A–Z)'], ['sortie', 'Date de sortie']].map(([v, n]) => `<option value="${v}"${c.tri === v ? ' selected' : ''}>${n}</option>`).join('')}
        </select>
        <button type="button" class="ct-puce${c.rarete === null ? ' actif' : ''}" data-rar="">Toutes</button>
        ${[1, 2, 3, 4, 5].map(k => `<button type="button" class="ct-puce${c.rarete === k ? ' actif' : ''}" data-rar="${k}" style="${c.rarete === k ? '' : 'color:' + RAR[k][1]}">${esc(RAR[k][0])}</button>`).join('')}
        <button type="button" class="ct-puce${c.holo === true ? ' actif' : ''}" data-holo>✨ Holo</button>
      </div>
      ${r.cartes.length ? `<div class="ct-grille">${r.cartes.map((k, n) => `<button type="button" class="ct-case" data-i="${n}" aria-label="${esc(k.titre)} de ${esc(k.artiste)}">${carteHtml(k, { quantite: true })}</button>`).join('')}</div>` : `<div class="ct-vide">${c.q || c.rarete || c.holo ? 'Aucune carte ne correspond.' : 'Ta collection est vide. Ouvre ton premier pack !'}</div>`}
      ${r.pages > 1 ? `<div class="ct-pager"><button type="button" class="ct-btn discret petit" data-page="-1" ${c.page <= 1 ? 'disabled' : ''}>Précédentes</button><span>Page ${r.page} sur ${r.pages}</span><button type="button" class="ct-btn discret petit" data-page="1" ${c.page >= r.pages ? 'disabled' : ''}>Suivantes</button></div>` : ''}`;

    let minuteur = null;
    const champ = S.corps.querySelector('[data-q]');
    champ.addEventListener('input', (ev) => {
      clearTimeout(minuteur);
      minuteur = setTimeout(() => { c.q = ev.target.value.trim(); c.page = 1; vueCollection().catch(() => {}); }, 350);
    });
    S.corps.querySelector('[data-tri]').addEventListener('change', (ev) => { c.tri = ev.target.value; c.page = 1; vueCollection(); });
    S.corps.querySelectorAll('[data-rar]').forEach((b) => b.addEventListener('click', () => { c.rarete = b.dataset.rar ? Number(b.dataset.rar) : null; c.page = 1; vueCollection(); }));
    S.corps.querySelector('[data-holo]').addEventListener('click', () => { c.holo = c.holo === true ? null : true; c.page = 1; vueCollection(); });
    S.corps.querySelectorAll('[data-page]').forEach((b) => b.addEventListener('click', () => { c.page = Math.max(1, c.page + Number(b.dataset.page)); vueCollection(); window.scrollTo({ top: 0, behavior: 'smooth' }); }));
    S.corps.querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', () => fiche(r.cartes[Number(b.dataset.i)])));
    if(c.q){ champ.focus(); champ.setSelectionRange(champ.value.length, champ.value.length); }
  }

  const VALEUR = [0, 2, 6, 22, 90, 350];
  const COUT = [0, 15, 50, 180, 700, 2500];

  // La fiche d'une carte : en grand, et ce qu'on peut en faire.
  function fiche(c, onFermer){

    const r = Number(c.rarete);
    const valeur = VALEUR[r] * (c.holo ? 3 : 1);

    const f = fenetre(`
      <div class="ct-fiche">
        <div>${carteHtml(c, { quantite: true })}</div>
        <div>
          <h2>${esc(c.titre)}</h2>
          <p class="sous">${esc(c.artiste)}${c.type ? ' · ' + esc(c.type) : ''}</p>
          <dl>
            <dt>Rareté</dt><dd style="color:${RAR[r][1]}">${esc(RAR[r][0])}${c.holo ? ' · holographique' : ''}</dd>
            <dt>Fans de l'artiste</dt><dd>${c.fans ? nf(c.fans) : '—'}</dd>
            <dt>Sortie</dt><dd>${c.sortie ? esc(new Date(c.sortie + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })) : '—'}</dd>
            <dt>Exemplaires</dt><dd>${c.quantite}</dd>
          </dl>
          <div class="ct-ligne-act">
            ${c.numero && typeof ouvrirSortieParNumero === 'function' ? '<button type="button" class="ct-btn discret petit" data-ecouter>Voir la sortie</button>' : ''}
            ${c.handle ? '<button type="button" class="ct-btn discret petit" data-artiste>Cartes de l\'artiste</button>' : ''}
          </div>
          ${c.quantite > 1 ? `
            <div class="ct-titre" style="margin-top:20px">Doublons</div>
            <div class="ct-ligne-act" style="margin-top:0">
              <select data-qte aria-label="Quantité à recycler">${Array.from({ length: c.quantite - 1 }, (_, k) => `<option value="${k + 1}">${k + 1}</option>`).join('')}</select>
              <button type="button" class="ct-btn petit" data-recycler>Recycler · <span data-gain>+${valeur}</span> 💿</button>
            </div>` : ''}
        </div>
      </div>`, false, onFermer);

    const q = f.corps.querySelector('[data-qte]');
    if(q) q.addEventListener('change', () => { f.corps.querySelector('[data-gain]').textContent = '+' + valeur * Number(q.value); });

    const rec = f.corps.querySelector('[data-recycler]');
    if(rec) rec.addEventListener('click', async () => {
      rec.disabled = true;
      try{
        const x = await appel('jeu_recycler', { p_release: c.id, p_holo: !!c.holo, p_quantite: Number(q.value) });
        poserEtat(x.etat); majEntete(); son('gain');
        toast('+' + nf(x.vinyles) + ' vinyles');
        f.fermer();
        if(S.vue === 'collection') vueCollection();
      }catch(e){ toast(e.message, 'err'); rec.disabled = false; }
    });

    const ec = f.corps.querySelector('[data-ecouter]');
    if(ec) ec.addEventListener('click', () => { f.fermer(); ouvrirSortieParNumero(c.numero); });

    const ar = f.corps.querySelector('[data-artiste]');
    if(ar) ar.addEventListener('click', () => { f.fermer(); sheetArtiste(c.handle); });

    reflets(f.corps);
  }

  // ---------------------------------------------------------------------
  // Discodex
  // ---------------------------------------------------------------------

  async function vueDiscodex(){

    const d = S.dex;
    const r = await appel('jeu_discodex', { p_page: d.page, p_q: d.q || null, p_filtre: d.filtre, p_tri: d.tri });

    S.corps.innerHTML = `
      <div class="ct-outils">
        <input type="search" placeholder="Chercher un artiste" value="${esc(d.q)}" data-q aria-label="Chercher un artiste">
        <select data-tri aria-label="Trier">
          ${[['fans', 'Les plus connus'], ['avancement', 'Avancement'], ['nom', 'A–Z']].map(([v, n]) => `<option value="${v}"${d.tri === v ? ' selected' : ''}>${n}</option>`).join('')}
        </select>
        ${[['tous', 'Tous'], ['decouverts', 'Découverts'], ['commences', 'Commencés'], ['manquants', 'À compléter'], ['complets', 'Complets']].map(([v, n]) => `<button type="button" class="ct-puce${d.filtre === v ? ' actif' : ''}" data-f="${v}">${n}</button>`).join('')}
      </div>
      <p class="ct-note" style="margin:-4px 0 14px">${pluriel(r.total, 'artiste')}. Complète toutes les cartes d'un artiste pour boucler sa discographie.</p>
      ${r.artistes.length ? `<div class="ct-artistes">${r.artistes.map((a, n) => {
        const rc = RAR[Math.min(Math.max(a.rarete || 1, 1), 5)][1];
        const pct = a.total ? Math.round(a.possedees / a.total * 100) : 0;
        return `<button type="button" class="ct-artiste-case" style="--rc:${rc}" data-i="${n}">
          <span class="ph">${a.photo ? `<img src="${esc(safeUrl(a.photo))}" alt="" loading="lazy">` : esc(String(a.nom || '?').charAt(0).toUpperCase())}</span>
          <span class="tx"><b>${esc(a.nom)}</b><small>${a.possedees}/${pluriel(a.total, 'carte')}${a.fans ? ' · ' + esc(court(a.fans)) + ' fans' : ''}</small><span class="ct-barre"><i style="width:${pct}%"></i></span></span></button>`;
      }).join('')}</div>` : '<div class="ct-vide">Aucun artiste ne correspond.</div>'}
      ${r.pages > 1 ? `<div class="ct-pager"><button type="button" class="ct-btn discret petit" data-page="-1" ${d.page <= 1 ? 'disabled' : ''}>Précédents</button><span>Page ${r.page} sur ${r.pages}</span><button type="button" class="ct-btn discret petit" data-page="1" ${d.page >= r.pages ? 'disabled' : ''}>Suivants</button></div>` : ''}`;

    let minuteur = null;
    const champ = S.corps.querySelector('[data-q]');
    champ.addEventListener('input', (ev) => {
      clearTimeout(minuteur);
      minuteur = setTimeout(() => { d.q = ev.target.value.trim(); d.page = 1; vueDiscodex().catch(() => {}); }, 350);
    });
    S.corps.querySelector('[data-tri]').addEventListener('change', (ev) => { d.tri = ev.target.value; d.page = 1; vueDiscodex(); });
    S.corps.querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => { d.filtre = b.dataset.f; d.page = 1; vueDiscodex(); }));
    S.corps.querySelectorAll('[data-page]').forEach((b) => b.addEventListener('click', () => { d.page = Math.max(1, d.page + Number(b.dataset.page)); vueDiscodex(); window.scrollTo({ top: 0, behavior: 'smooth' }); }));
    S.corps.querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', () => sheetArtiste(r.artistes[Number(b.dataset.i)].handle)));
    if(d.q){ champ.focus(); champ.setSelectionRange(champ.value.length, champ.value.length); }
  }

  // Les cartes d'un artiste : celles qu'on a, celles qu'il manque (qu'on peut fabriquer à l'atelier).
  async function sheetArtiste(handle){

    let r;
    try{ r = await appel('jeu_artiste', { p_handle: handle }); }catch(e){ toast(e.message, 'err'); return; }

    const cartes = r.cartes || [];
    const possedees = cartes.filter(c => c.quantite > 0).length;

    const f = fenetre(`
      <h2>${esc(r.nom || handle)}</h2>
      <p class="sous">${possedees} carte${possedees > 1 ? 's' : ''} sur ${cartes.length}. Touche une carte manquante pour la fabriquer à l'atelier (💿).</p>
      <div class="ct-grille" style="grid-template-columns:repeat(auto-fill, minmax(118px, 1fr))">
        ${cartes.map((c, n) => `<button type="button" class="ct-case${c.quantite > 0 ? '' : ' manque'}" data-i="${n}" aria-label="${esc(c.titre)}">${carteHtml(c, { quantite: true })}</button>`).join('')}
      </div>`, true);

    reflets(f.corps);

    f.corps.querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', () => {
      const c = cartes[Number(b.dataset.i)];
      if(c.quantite > 0){ f.fermer(); fiche(c, () => sheetArtiste(handle)); } else atelier(c, f);
    }));
  }

  function atelier(c, fenetreParent){

    const cout = COUT[Number(c.rarete)];
    const manque = S.etat.vinyles < cout;

    const f = fenetre(`
      <h2>Atelier</h2>
      <p class="sous">Fabrique « ${esc(c.titre)} » de ${esc(c.artiste)} avec des vinyles.</p>
      <div style="display:flex;justify-content:center;margin:6px 0 16px"><div style="width:190px">${carteHtml(c, {})}</div></div>
      <div style="text-align:center;font-size:14px;margin-bottom:14px">Coût : <b>${nf(cout)} 💿</b> · tu en as ${nf(S.etat.vinyles)}</div>
      <button type="button" class="ct-btn or" style="width:100%" data-fabriquer ${manque ? 'disabled' : ''}>${manque ? 'Il te manque ' + nf(cout - S.etat.vinyles) + ' vinyles' : 'Fabriquer la carte'}</button>
      <p class="ct-note">Les vinyles viennent du recyclage de tes doublons, des missions, de la roue et des succès.</p>`);

    const b = f.corps.querySelector('[data-fabriquer]');
    b.addEventListener('click', async () => {
      b.disabled = true;
      try{
        const x = await appel('jeu_atelier', { p_release: c.id });
        poserEtat(x.etat); majEntete(); son('r' + c.rarete); confetti(80);
        toast('Carte fabriquée !');
        f.fermer();
        if(fenetreParent) fenetreParent.fermer();
        sheetArtiste(c.handle);
      }catch(e){ toast(e.message, 'err'); b.disabled = false; }
    });
  }

  // ---------------------------------------------------------------------
  // Quêtes
  // ---------------------------------------------------------------------

  async function vueQuetes(){

    const m = await appel('jeu_missions');

    const carte = (q) => {
      const fait = q.progres >= q.objectif;
      return `
        <div class="ct-mission${q.prise ? ' fait' : (fait ? ' pret' : '')}">
          <div class="tx">
            <b>${q.prise ? '✓ ' : ''}${esc(q.libelle)}</b>
            <small>${q.progres} / ${q.objectif}</small>
            <span class="ct-barre"><i style="width:${Math.round(q.progres / q.objectif * 100)}%"></i></span>
            <div class="ct-gain" style="margin-top:8px"><span>⚡ +${q.tirages}</span>${q.vinyles ? `<span>💿 +${q.vinyles}</span>` : ''}</div>
          </div>
          ${q.prise ? '<span class="ct-note" style="margin:0">Récupérée</span>' : `<button type="button" class="ct-btn ${fait ? 'or' : 'discret'} petit" data-prendre="${esc(q.cle)}" ${fait ? '' : 'disabled'}>Récupérer</button>`}
        </div>`;
    };

    const bonus = (b, titre, libelle) => `
      <div class="ct-mission${b.pret ? ' pret' : (b.pris ? ' fait' : '')}">
        <span style="font-size:28px">${b.pris ? '✅' : '🎁'}</span>
        <div class="tx"><b>${esc(titre)}</b><small style="margin:3px 0 0">${esc(libelle)}</small></div>
        ${b.pris ? '<span class="ct-note" style="margin:0">Récupéré</span>' : `<button type="button" class="ct-btn ${b.pret ? 'or' : 'discret'} petit" data-prendre="${esc(b.cle)}" ${b.pret ? '' : 'disabled'}>Récupérer</button>`}
      </div>`;

    S.corps.innerHTML = `
      <div class="ct-titre" style="margin-top:4px">Missions du jour <span style="float:right;letter-spacing:0;text-transform:none">Nouvelles dans ${duree(m.fin_jour)}</span></div>
      <div class="ct-liste">${m.jour.map(carte).join('')}${bonus(m.bonus_jour, 'Bonus du jour', 'Termine les trois missions : +' + m.bonus_jour.tirages + ' tirages')}</div>
      <div class="ct-titre">Défis de la semaine <span style="float:right;letter-spacing:0;text-transform:none">Nouveaux dans ${Math.ceil(m.fin_semaine / 86400)} j</span></div>
      <div class="ct-liste">${m.semaine.map(carte).join('')}${bonus(m.bonus_semaine, 'Bonus de la semaine', 'Termine les trois défis : +' + m.bonus_semaine.tirages + ' tirages et un pack Épique')}</div>
      <p class="ct-note">Les missions de notes, d'écoutes, d'avis et de commentaires comptent ce que tu fais sur le site : noter une sortie, l'écouter, écrire un avis, commenter.</p>`;

    S.corps.querySelectorAll('[data-prendre]').forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true;
      try{
        const r = await appel('jeu_mission_prendre', { p_cle: b.dataset.prendre });
        poserEtat(r.etat); majEntete(); son('gain'); vibre(25);
        toast('Récupéré : ' + texteGain(r.gain));
        vueQuetes();
      }catch(e){ toast(e.message, 'err'); b.disabled = false; }
    }));
  }

  // ---------------------------------------------------------------------
  // Roue
  // ---------------------------------------------------------------------

  async function vueRoue(){

    const r = await appel('jeu_roue');
    const sect = r.secteurs;
    const n = sect.length;
    const ang = 360 / n;
    const couleurs = ['#7b5cff', '#ff5ad1', '#ff7a59', '#ffb340', '#2fd8a2', '#3d8bff', '#c04bd8', '#ff4d6d'];
    const jackpot = (l) => /JACKPOT/i.test(l);

    const rayon = 150;
    const secteurSvg = sect.map((s, k) => {
      const a0 = (k - .5) * ang - 90, a1 = (k + .5) * ang - 90;
      const p = (a) => [rayon * Math.cos(a * Math.PI / 180), rayon * Math.sin(a * Math.PI / 180)];
      const [x0, y0] = p(a0), [x1, y1] = p(a1);
      return `
        <path d="M0 0 L${x0.toFixed(2)} ${y0.toFixed(2)} A${rayon} ${rayon} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)} Z" fill="${couleurs[k % couleurs.length]}" stroke="rgba(0,0,0,.35)" stroke-width="1.5"/>
        <g transform="rotate(${k * ang})"><text x="0" y="${-rayon + 34}" text-anchor="middle" font-size="${jackpot(s.libelle) ? 11 : 13}" font-weight="700" fill="#fff" style="paint-order:stroke;stroke:rgba(0,0,0,.45);stroke-width:2.5px">${esc(s.libelle.replace(/JACKPOT\s*·\s*/i, '★ '))}</text></g>`;
    }).join('');

    S.corps.innerHTML = `
      <div class="ct-roue-zone">
        <div class="ct-roue-cadre">
          <div class="ct-roue-pointe"></div>
          <svg viewBox="-160 -160 320 320" role="img" aria-label="Roue du jour">
            <g class="ct-roue-disque" data-disque>${secteurSvg}<circle r="22" fill="#0b0f15" stroke="#fff" stroke-width="3"/><circle r="8" fill="#ffd166"/></g>
          </svg>
        </div>
        <div style="text-align:center">
          <button type="button" class="ct-btn or" data-tourner ${r.prete ? '' : 'disabled'}>${r.prete ? 'Tourner la roue' : 'Reviens demain'}</button>
          <div class="ct-reste" data-gain-roue>${r.dernier ? 'Aujourd\'hui : <b>' + esc(r.dernier.libelle) + '</b>' : 'Un tour par jour : des tirages, des vinyles, un pack Épique, et un jackpot.'}</div>
        </div>
      </div>`;

    const disque = S.corps.querySelector('[data-disque]');
    if(r.dernier){
      disque.style.transition = 'none';
      disque.style.transform = `rotate(${-(r.dernier.n - 1) * ang}deg)`;
    }

    const b = S.corps.querySelector('[data-tourner]');
    b.addEventListener('click', async () => {
      b.disabled = true;
      let x;
      try{ x = await appel('jeu_roue_tourner'); }catch(e){ toast(e.message, 'err'); b.disabled = false; return; }
      son('bat');
      disque.getBoundingClientRect();
      disque.style.transition = '';
      disque.style.transform = `rotate(${-(x.n - 1) * ang - 360 * 6}deg)`;
      const cliquetis = setInterval(() => son('r1'), 260);
      setTimeout(() => {
        clearInterval(cliquetis);
        poserEtat(x.etat); majEntete();
        son(jackpot(x.libelle) ? 'r5' : 'gain'); vibre([30, 40, 30]); confetti(jackpot(x.libelle) ? 220 : 110);
        const z = S.corps.querySelector('[data-gain-roue]');
        if(z) z.innerHTML = 'Gagné : <b>' + esc(x.libelle) + '</b>';
        b.textContent = 'Reviens demain';
        toast('Roue : ' + x.libelle + ' !');
      }, 5400);
    });
  }

  // ---------------------------------------------------------------------
  // Coffre
  // ---------------------------------------------------------------------

  async function vueCoffre(){

    const r = await appel('jeu_coffre');

    const heure = (iso) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
    const noms = { pret: 'Récupérer', prise: 'Récupéré', expire: 'Expiré', a_venir: 'Bientôt' };

    S.corps.innerHTML = `
      <p class="ct-note" style="margin:0 0 14px">Des tirages offerts à 9 h, 13 h, 18 h et 22 h. Chaque cadeau reste disponible pendant 8 heures.</p>
      <div class="ct-coffre-bloc">${r.cadeaux.map((c) => `
        <div class="ct-slot ${c.etat}">
          <div class="heure">${String(c.heure).padStart(2, '0')} h</div>
          <b>⚡ +${c.tirages} tirages</b>
          <small>${c.etat === 'pret' ? 'Jusqu\'à ' + heure(c.fin) : (c.etat === 'a_venir' ? 'Disponible à ' + heure(c.debut) : (c.etat === 'prise' ? 'Déjà récupéré' : 'Trop tard'))}</small>
          <button type="button" class="ct-btn ${c.etat === 'pret' ? 'or' : 'discret'} petit" data-prendre="${esc(c.cle)}" ${c.etat === 'pret' ? '' : 'disabled'}>${noms[c.etat] || ''}</button>
        </div>`).join('')}</div>`;

    S.corps.querySelectorAll('[data-prendre]').forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true;
      try{
        const x = await appel('jeu_coffre_prendre', { p_cle: b.dataset.prendre });
        poserEtat(x.etat); majEntete(); son('gain'); vibre(25);
        toast('+' + x.gain.tirages + ' tirages !');
        vueCoffre();
      }catch(e){ toast(e.message, 'err'); b.disabled = false; }
    }));
  }

  // ---------------------------------------------------------------------
  // Succès
  // ---------------------------------------------------------------------

  const FAMILLES = {
    ouvertures: '📦', uniques: '🗂️', holos: '✨', rares: '💎', epiques: '🔮', legendaires: '👑', mythiques: '🔥',
    artistes: '🎤', niveau: '⭐', recycles: '♻️', atelier: '🛠️', ateliers: '🛠️', roues: '🎡', serie: '📅', missions: '🎯'
  };

  async function vueSucces(){

    const r = await appel('jeu_succes');
    const liste = r.succes || [];

    // Une famille = une chaîne de paliers : on montre le prochain à atteindre ou à récupérer.
    const familles = {};
    liste.forEach((s) => { (familles[s.famille] = familles[s.famille] || []).push(s); });

    const aRecuperer = liste.filter(s => s.atteint && !s.pris);
    const cartes = Object.keys(familles).map((k) => {
      const l = familles[k];
      const prochain = l.find(s => !s.pris) || l[l.length - 1];
      return { k, prochain, prises: l.filter(s => s.pris).length, total: l.length };
    }).sort((a, b) => (Number(b.prochain.atteint && !b.prochain.pris) - Number(a.prochain.atteint && !a.prochain.pris)) || (Number(a.prochain.pris) - Number(b.prochain.pris)));

    const pris = liste.filter(s => s.pris).length;

    S.corps.innerHTML = `
      <div class="ct-synthese">
        <div class="gros">${pris}<small> / ${liste.length} succès</small></div>
        <div class="barre"><span class="ct-barre"><i style="width:${liste.length ? Math.round(pris / liste.length * 100) : 0}%"></i></span></div>
        ${aRecuperer.length ? `<button type="button" class="ct-btn or petit" data-tout>Tout récupérer (${aRecuperer.length})</button>` : ''}
      </div>
      <div class="ct-liste">${cartes.map(({ k, prochain: s, prises, total }) => `
        <div class="ct-succes${s.atteint && !s.pris ? ' atteint' : ''}">
          <span class="medaille">${FAMILLES[k] || '🏅'}</span>
          <div class="tx">
            <b>${esc(s.nom)}${s.pris ? ' ✓' : ''}</b>
            <small>${esc(s.description)} · palier ${Math.min(prises + (s.pris ? 0 : 1), total)}/${total}</small>
            <span class="ct-barre"><i style="width:${Math.round(s.progres / s.seuil * 100)}%"></i></span>
            <div class="ct-gain" style="margin-top:7px"><span>${nf(s.progres)} / ${nf(s.seuil)}</span>${s.tirages ? `<span>⚡ +${s.tirages}</span>` : ''}${s.vinyles ? `<span>💿 +${s.vinyles}</span>` : ''}</div>
          </div>
          ${s.pris ? '' : `<button type="button" class="ct-btn ${s.atteint ? 'or' : 'discret'} petit" data-prendre="${esc(s.id)}" ${s.atteint ? '' : 'disabled'}>Récupérer</button>`}
        </div>`).join('')}</div>`;

    async function prendre(id){
      const x = await appel('jeu_succes_prendre', { p_id: id });
      poserEtat(x.etat);
      return x;
    }

    S.corps.querySelectorAll('[data-prendre]').forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true;
      try{ const x = await prendre(b.dataset.prendre); majEntete(); son('gain'); vibre(25); toast('Succès : ' + texteGain(x.gain)); vueSucces(); }
      catch(e){ toast(e.message, 'err'); b.disabled = false; }
    }));

    const tout = S.corps.querySelector('[data-tout]');
    if(tout) tout.addEventListener('click', async () => {
      tout.disabled = true;
      let t = 0, v = 0;
      for(const s of aRecuperer){
        try{ const x = await prendre(s.id); t += x.gain.tirages || 0; v += x.gain.vinyles || 0; }catch(e){ /* un succès déjà pris : on passe au suivant */ }
      }
      majEntete(); son('gain'); confetti(100);
      toast('Récupéré : +' + t + ' tirages · +' + v + ' vinyles');
      vueSucces();
    });
  }

  window.Cartes = { monter, quitter };

})();
