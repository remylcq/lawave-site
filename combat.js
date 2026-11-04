/* =====================================================================
   La Wave — Wave Cards : le combat (La Tour)

   Chargé à la demande par cartes.js (onglet « Combat », chargerWaveModule('combat') dans index.html).
   Un Heartstone très simplifié et très rapide : on compose une équipe de 3 cartes, on la pose, et le combat se joue tout seul.
   Le moteur vit dans la base (sql/combat-tour-auto.sql) : il simule le combat entier d'un coup et renvoie le déroulé ;
   ce fichier choisit l'équipe et REJOUE le déroulé en animation. Aucun calcul ni hasard côté navigateur.

   LES RÈGLES EN BREF
     Chaque carte a PV, Puissance, Défense et Vitesse (rareté + IV de l'exemplaire du joueur) et jusqu'à 3 attaques : les titres de son album.
     Les cartes jouent dans l'ordre de leur Vitesse, chacune frappe la carte d'en face (sinon la première encore debout).
     Dégâts = Puissance × (100 / (100 + Défense adverse)). Toutes les 3 attaques, le titre « signature » frappe 60 % plus fort.
     Un passif (Légendaire et plus) peut changer la partie. Le dernier debout gagne ; au bout de 30 tours, celui qui a gardé le plus de PV.
   La Tour : 4 difficultés, 100 étages, un gardien tous les 10 étages ; récompenses à la première victoire de chaque étage.

   L'API PUBLIQUE (window.WaveCombat)
     monter(hote, api)           l'onglet : la Tour
     quitter()                   ferme le combat en cours d'animation
     fiche(el, api, opts)        la fiche de combat d'une carte (collection)
     equipe(hote, api)           le panneau de l'équipe : difficultés de la Tour, taille des équipes
     equipeCarte(hote, api, id)  les statistiques d'une carte (lecture)
   ===================================================================== */

(function(){

  'use strict';

  let A = null;   // l'interface partagée du jeu (window.Cartes.api)
  const S = { acc: null, diff: null, cartes: null, equipe: [], scene: null };

  const CSS = `
  .tr h2{margin:0; font-size:26px; letter-spacing:-.02em;}
  .tr .sous{color:var(--muted); font-size:14px; line-height:1.55;}
  .tr-diffs{display:flex; flex-wrap:wrap; gap:8px; margin:16px 0;}
  .tr-diff{all:unset; box-sizing:border-box; cursor:pointer; display:grid; gap:2px; padding:10px 16px; border-radius:14px; border:1px solid var(--ct-trait); background:var(--ct-surface); min-width:120px;}
  .tr-diff b{font-size:14px;} .tr-diff small{font-size:11.5px; color:var(--muted);}
  .tr-diff.actif{border-color:#4FB4FF; background:rgba(79,180,255,.1);}
  .tr-diff.verrou{opacity:.55; cursor:not-allowed;}
  .tr-diff:focus-visible{outline:2px solid var(--ct-accent);}
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
  .tr-slots{display:grid; grid-template-columns:repeat(var(--n, 3), minmax(0, 1fr)); gap:10px; max-width:560px; margin:6px 0 14px;}
  .tr-slot{position:relative;}
  .tr-slot .ct-carte{width:100%;}
  .tr-slot-act{display:flex; justify-content:center; gap:6px; margin-top:6px;}
  .tr-mini{all:unset; box-sizing:border-box; cursor:pointer; width:30px; height:30px; display:grid; place-items:center; border-radius:9px; background:var(--ct-surface-2); border:1px solid var(--ct-trait); font-size:14px;}
  .tr-mini:disabled{opacity:.3; cursor:default;}
  .tr-grille{display:grid; grid-template-columns:repeat(auto-fill, minmax(118px, 1fr)); gap:12px; max-height:46vh; overflow-y:auto; padding:4px;}
  .tr-tuile{all:unset; box-sizing:border-box; cursor:pointer; display:grid; gap:6px; padding:6px; border-radius:14px; border:2px solid transparent;}
  .tr-tuile:hover{background:rgba(255,255,255,.04);}
  .tr-tuile.choisie{border-color:#4FB4FF; background:rgba(79,180,255,.1);}
  .tr-tuile .ct-carte{width:100%;}
  .tr-tuile:focus-visible{outline:2px solid var(--ct-accent);}

  /* La scène du combat */
  .tr-scene{position:fixed; inset:0; z-index:9000; display:grid; grid-template-rows:auto 1fr auto; color:#fff; background:#05070a;}
  .tr-fond{position:absolute; inset:0; background-size:cover; background-position:50% 30%; image-rendering:pixelated; opacity:1;}
  .tr-fond::after{content:''; position:absolute; inset:0; background:linear-gradient(180deg, rgba(5,7,10,.25), rgba(5,7,10,0) 45%, rgba(5,7,10,.45));}
  .tr-scene > *{position:relative;}
  .tr-haut{display:flex; align-items:center; justify-content:space-between; gap:12px; padding:14px 18px;}
  .tr-haut h3{margin:0; font-size:17px;} .tr-haut small{display:block; color:rgba(255,255,255,.7); font-size:12px;}
  .tr-tour{font-size:13px; font-weight:800; letter-spacing:.12em; text-transform:uppercase; padding:6px 14px; border-radius:99px; background:rgba(0,0,0,.5); border:1px solid rgba(255,255,255,.2);}
  .tr-terrain{display:grid; grid-template-rows:1fr 1fr; gap:10px; padding:6px 14px; align-content:center; max-width:820px; width:100%; margin:0 auto;}
  .tr-ligne{display:grid; grid-template-columns:repeat(var(--n, 3), minmax(0, 1fr)); gap:14px; align-items:center; justify-items:center;}
  .tr-uc{position:relative; width:min(150px, 100%); transition:transform .22s cubic-bezier(.3,1.5,.5,1), filter .3s, opacity .4s;}
  .tr-uc .ct-carte{width:100%; box-shadow:0 10px 28px rgba(0,0,0,.6);}
  .tr-uc.ko{filter:grayscale(1) brightness(.5); opacity:.55; transform:scale(.92);}
  .tr-uc.touche .ct-carte{animation:trTouche .3s;}
  .tr-pv{height:9px; margin-top:7px; border-radius:99px; background:rgba(0,0,0,.65); border:1px solid rgba(255,255,255,.25); overflow:hidden;}
  .tr-pv i{display:block; height:100%; width:100%; background:linear-gradient(90deg, #3DD68C, #8BE05A); transition:width .35s;}
  .tr-pv.bas i{background:linear-gradient(90deg, #FF5C5C, #FF9F43);}
  .tr-pvn{margin-top:3px; font-size:11px; text-align:center; font-variant-numeric:tabular-nums; color:rgba(255,255,255,.85); text-shadow:0 1px 4px #000;}
  .tr-nomu{margin-top:4px; text-align:center; font-size:12px; font-weight:700; text-shadow:0 1px 4px #000; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
  .tr-deg{position:absolute; left:50%; top:30%; z-index:6; transform:translateX(-50%); font-size:30px; font-weight:900; pointer-events:none; text-shadow:0 2px 0 #000, 0 0 12px #000; animation:trDeg .9s ease-out forwards;}
  .tr-deg.soin{color:#5BE0A6;} .tr-deg.sig{color:#ffd76a; font-size:38px;} .tr-deg.ref{color:#ff9f43;}
  .tr-titre{position:absolute; left:50%; bottom:calc(100% + 4px); z-index:7; transform:translateX(-50%); white-space:nowrap; max-width:190px; overflow:hidden; text-overflow:ellipsis; padding:4px 11px; border-radius:99px; font-size:12px; font-weight:800; color:#05070a; background:#F4F5F6; box-shadow:0 4px 14px rgba(0,0,0,.5); animation:trTitre .8s ease-out forwards; pointer-events:none;}
  .tr-titre.sig{background:linear-gradient(90deg, #ffd76a, #ffb547);}
  .tr-titre.passif{background:#4FB4FF;}
  .tr-bas{display:flex; flex-wrap:wrap; justify-content:center; gap:10px; padding:14px 18px 22px;}
  .tr-fin{position:absolute; inset:0; z-index:20; display:grid; place-items:center; background:rgba(3,5,8,.72); padding:20px;}
  .tr-fin-c{display:grid; gap:14px; justify-items:center; text-align:center; padding:28px 30px; border-radius:24px; background:#0c1119; border:1px solid var(--ct-trait-fort); max-width:420px; animation:trFin .5s cubic-bezier(.2,1.4,.4,1);}
  .tr-fin-c h2{font-size:34px;} .tr-fin-c.v h2{color:#5BE0A6;} .tr-fin-c.d h2{color:#FF7A85;}
  .tr-gains{display:flex; flex-wrap:wrap; justify-content:center; gap:8px;}
  @keyframes trTouche{0%{filter:brightness(2.2);} 100%{filter:none;}}
  @keyframes trDeg{0%{opacity:0; transform:translate(-50%, 10px) scale(.6);} 15%{opacity:1; transform:translate(-50%, 0) scale(1.15);} 100%{opacity:0; transform:translate(-50%, -46px) scale(1);}}
  @keyframes trTitre{0%{opacity:0; transform:translate(-50%, 6px);} 12%{opacity:1; transform:translate(-50%, 0);} 80%{opacity:1;} 100%{opacity:0;}}
  @keyframes trFin{from{opacity:0; transform:scale(.85);}}
  .tr-role{justify-self:center; display:inline-flex; align-items:center; height:20px; padding:0 9px; border-radius:99px; font-size:10.5px; font-weight:800; letter-spacing:.06em; text-transform:uppercase; background:rgba(255,255,255,.1); color:var(--ink-soft);}
  .tr-rolu{margin-top:2px; text-align:center; font-size:10.5px; font-weight:800; letter-spacing:.06em; text-transform:uppercase; color:rgba(255,255,255,.7);}
  .tr-deg.bou{color:#5cc8ff;}
  .tr-corps{position:relative; min-height:0; overflow:hidden;}
  .tr-corps > .tr-terrain{position:absolute; inset:0;}
  .tr3-canvas{position:absolute; inset:0; width:100%; height:100%; display:block;}
  .tr3-hud-layer{position:absolute; inset:0; pointer-events:none; overflow:hidden;}
  .tr3-hud{position:absolute; left:0; top:0; width:150px; margin:-62px 0 0 -75px; text-align:center; transition:opacity .4s; will-change:transform;}
  .tr3-hud .n{display:inline-block; max-width:100%; padding:1px 9px; border-radius:99px; font-size:13px; font-weight:800; background:rgba(5,7,10,.62); text-shadow:0 1px 3px #000; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
  .tr3-hud .ro{display:inline-block; margin:2px 0 4px; padding:1px 8px; border-radius:99px; font-size:9.5px; font-weight:800; letter-spacing:.08em; text-transform:uppercase; background:rgba(0,0,0,.6); border:1px solid rgba(255,255,255,.25);}
  .tr3-hud.ami .ro{border-color:rgba(79,180,255,.7);} .tr3-hud.ennemi .ro{border-color:rgba(255,92,138,.7);}
  .tr3-hud .pv{position:relative; height:9px; border-radius:99px; background:rgba(0,0,0,.7); border:1px solid rgba(255,255,255,.3); overflow:hidden;}
  .tr3-hud .pv i{position:absolute; inset:0 auto 0 0; width:100%; background:linear-gradient(90deg, #3DD68C, #8BE05A); transition:width .3s;}
  .tr3-hud .pv.bas i{background:linear-gradient(90deg, #FF5C5C, #FF9F43);}
  .tr3-hud .pv b{position:absolute; inset:0 auto 0 0; width:0; background:rgba(92,200,255,.75); transition:width .3s;}
  .tr3-hud .pvn{display:inline-block; margin-top:2px; padding:0 7px; border-radius:99px; font-size:10.5px; font-variant-numeric:tabular-nums; background:rgba(5,7,10,.55); text-shadow:0 1px 3px #000;}
  .tr3-pop{position:absolute; z-index:6; transform:translateX(-50%); font-size:32px; font-weight:900; pointer-events:none; text-shadow:0 2px 0 #000, 0 0 14px #000; animation:trDeg3 1s ease-out forwards;}
  .tr3-pop.soin{color:#5BE0A6;} .tr3-pop.sig{color:#ffd76a; font-size:42px;} .tr3-pop.ref{color:#ff9f43;} .tr3-pop.bou{color:#5cc8ff;}
  .tr3-ban{position:absolute; z-index:7; transform:translateX(-50%); white-space:nowrap; max-width:220px; overflow:hidden; text-overflow:ellipsis; padding:5px 14px; border-radius:99px; font-size:13px; font-weight:800; color:#05070a; background:#F4F5F6; box-shadow:0 4px 16px rgba(0,0,0,.55); pointer-events:none; animation:trTitre 0.9s ease-out forwards;}
  .tr3-ban.sig{background:linear-gradient(90deg, #ffd76a, #ffb547); font-size:15px;} .tr3-ban.passif{background:#ffd76a;} .tr3-ban.soin{background:#5BE0A6;} .tr3-ban.bou{background:#5cc8ff;}
  .tr3-tour{position:absolute; left:0; right:0; top:38%; text-align:center; font-size:clamp(34px, 8vw, 76px); font-weight:900; letter-spacing:.2em; text-transform:uppercase; color:#fff; text-shadow:0 0 30px rgba(79,180,255,.9), 0 3px 0 #000; pointer-events:none; animation:trTour3 1.1s ease-out forwards;}
  @keyframes trDeg3{0%{opacity:0; transform:translate(-50%, 12px) scale(.6);} 15%{opacity:1; transform:translate(-50%, 0) scale(1.18);} 100%{opacity:0; transform:translate(-50%, -54px) scale(1);}}
  @keyframes trTour3{0%{opacity:0; transform:scale(1.6);} 25%{opacity:1; transform:scale(1);} 100%{opacity:0; transform:scale(.95);}}
  .cb-fiche{display:grid; gap:12px; padding:14px; border-radius:16px; background:var(--ct-surface-2);}
  .cb-fiche-t{display:flex; align-items:center; justify-content:space-between; gap:10px;}
  .cb-roles{display:flex; flex-wrap:wrap; gap:6px; align-items:center;}
  .cb-role, .cb-iv{display:inline-flex; align-items:center; height:22px; padding:0 10px; border-radius:99px; font-size:11px; font-weight:800; letter-spacing:.05em; text-transform:uppercase; background:rgba(255,255,255,.1);}
  .cb-pvgros{font-size:26px; font-weight:900; font-variant-numeric:tabular-nums;} .cb-pvgros small{font-size:11px; font-weight:700; color:var(--muted); margin-right:6px;}
  .cb-stats{display:grid; grid-template-columns:repeat(3, 1fr); gap:10px;}
  .cb-st{display:grid; gap:4px; font-size:12px; color:var(--ink-soft);} .cb-st b{font-size:18px; color:var(--ink); font-variant-numeric:tabular-nums;}
  .cb-st i{display:block; height:5px; border-radius:99px; background:linear-gradient(90deg, #4FB4FF, #FF5C8A); width:var(--w, 50%);}
  .cb-atts{display:grid; gap:6px;}
  .cb-att{display:flex; align-items:center; gap:10px; padding:8px 12px; border-radius:12px; background:rgba(255,255,255,.05); font-size:13.5px;}
  .cb-att span{display:grid; place-items:center; width:22px; height:22px; border-radius:50%; font-size:11px; font-weight:800; color:#05070a; background:#F4F5F6; flex:none;}
  .cb-att small{margin-left:auto; color:var(--muted); font-size:11.5px;}
  .cb-cap{font-size:13px; line-height:1.5; color:var(--ink-soft);}
  @media (max-width:560px){
    .tr-uc{width:min(104px, 100%);} .tr-ligne{gap:8px;} .tr-deg{font-size:24px;} .tr-haut{padding:10px 12px;}
  }
  @media (prefers-reduced-motion: reduce){ .tr-uc, .tr-pv i{transition:none;} .tr-deg, .tr-titre, .tr-fin-c{animation-duration:.01s;} }
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
  const carte = (c) => A.carteHtml({ nom: c.nom, rarete: c.rarete, numero: c.numero, photo: c.photo, holo: c.holo, iv_pct: c.iv_pct, classeur: c.booster }, {});
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
    if(!S.diff || !S.acc.difficultes.some((d) => d.id === S.diff && d.debloque)){
      const d = S.acc.difficultes.filter((x) => x.debloque).pop();
      S.diff = d ? d.id : (S.acc.difficultes[0] || {}).id;
      // on reprend à la dernière difficulté ouverte où il reste des étages
      const ouverte = S.acc.difficultes.find((x) => x.debloque && x.etage_max < x.etages);
      if(ouverte) S.diff = ouverte.id;
    }
    if(!S.cartes) S.cartes = await A.appel('combat_tour_cartes');
    S.equipe = (S.acc.equipe || []).map((e) => S.cartes.find((c) => c.booster === e.booster && c.artist_id === e.artist && !!c.holo === !!e.holo)).filter(Boolean);
    if(S.equipe.length !== S.acc.taille) S.equipe = [];
  }

  function dessiner(){
    const hote = S.hote;
    const acc = S.acc;
    const d = acc.difficultes.find((x) => x.id === S.diff) || acc.difficultes[0];
    const n = acc.taille;
    const p = d.prochain;
    hote.innerHTML = `
      <div class="ct tr">
        <div class="ct-panneau">
          <h2>La Tour</h2>
          <p class="sous" style="margin:4px 0 0">Compose une équipe de ${n} cartes et pose-la : le combat se joue tout seul, en quelques secondes. Les IV de tes cartes comptent.</p>
          <div class="tr-diffs" role="tablist">${acc.difficultes.map((x) => `
            <button type="button" role="tab" class="tr-diff${x.id === d.id ? ' actif' : ''}${x.debloque ? '' : ' verrou'}" data-diff="${esc(x.id)}" aria-selected="${x.id === d.id}">
              <b>${esc(x.nom)}</b><small>${x.debloque ? 'Étage ' + x.etage_max + ' / ' + x.etages : 'Étage ' + x.deblocage_etage + ' en ' + esc(x.precedente || '') + ' requis'}</small></button>`).join('')}</div>
          <p class="sous" style="margin:0">${esc(d.resume)}</p>
        </div>

        ${p ? `
        <div class="ct-panneau tr-etage" style="margin-top:16px">
          <div class="tr-etage-t"><h3>${esc(p.nom)}</h3>${p.gardien ? '<span class="tr-puce or">Gardien</span>' : ''}<span class="tr-puce">Bonus adverse ${p.bonus >= 0 ? '+' : ''}${p.bonus} %</span>
            <span class="tr-puce">Récompense : ${p.recompense.wc} WC${p.recompense.vinyles ? ' + ' + p.recompense.vinyles + ' vinyle' + (p.recompense.vinyles > 1 ? 's' : '') : ''}</span></div>
          <div class="tr-barre" title="Étage ${d.etage_max} sur ${d.etages}"><i style="width:${Math.round(d.etage_max / d.etages * 100)}%"></i></div>
          <div class="tr-rang" style="--n:${n}">${p.crew.map((u) => `<div class="tr-u">${carte(u)}${statsHtml(u)}</div>`).join('')}</div>
        </div>

        <div class="ct-panneau" style="margin-top:16px">
          <h3 style="margin:0 0 4px">Mon équipe</h3>
          <p class="sous" style="margin:0 0 10px">Une carte attaque celle d'en face : l'ordre compte.</p>
          <div class="tr-slots" style="--n:${n}">${Array.from({ length: n }, (_, i) => S.equipe[i]
            ? `<div class="tr-slot">${carte(S.equipe[i])}${statsHtml(S.equipe[i])}</div>`
            : `<div class="tr-slot"><div class="tr-vide">Libre</div></div>`).join('')}</div>
          <div class="tr-actions">
            <button type="button" class="ct-btn" data-equipe>${S.equipe.length ? 'Changer mon équipe' : 'Choisir mon équipe'}</button>
            <button type="button" class="ct-btn principal" data-lancer ${S.equipe.length === n ? '' : 'disabled'}>Combattre</button>
          </div>
          ${S.cartes.length < n ? `<p class="sous" style="margin:12px 0 0">Il te faut au moins ${n} cartes : ouvre des packs dans l'onglet Packs.</p>` : ''}
        </div>` : `
        <div class="ct-panneau ct-vide" style="margin-top:16px"><b>${d.debloque ? 'Tu as gravi toute la Tour à cette difficulté !' : 'Difficulté verrouillée'}</b>${d.debloque ? '' : 'Atteins l\'étage ' + d.deblocage_etage + ' de la difficulté précédente.'}</div>`}

        <div class="ct-panneau" style="margin-top:16px">
          <h3 style="margin:0 0 10px">Les gardiens</h3>
          <div class="tr-gardiens">${d.gardiens.map((g) => `<div class="tr-g${g.fait ? ' fait' : ''}"><b>${g.etage}</b>${g.fait ? 'vaincu' : g.recompense.wc + ' WC' + (g.recompense.vinyles ? ' + ' + g.recompense.vinyles + ' ♪' : '')}</div>`).join('')}</div>
        </div>
      </div>`;
    hote.querySelectorAll('[data-diff]').forEach((b) => b.addEventListener('click', () => {
      const x = acc.difficultes.find((y) => y.id === b.dataset.diff);
      if(!x.debloque){ A.toast('Atteins l\'étage ' + x.deblocage_etage + ' en ' + x.precedente + ' pour l\'ouvrir.', 'err'); return; }
      S.diff = x.id; dessiner();
    }));
    const be = hote.querySelector('[data-equipe]');
    if(be) be.addEventListener('click', composerEquipe);
    const bl = hote.querySelector('[data-lancer]');
    if(bl) bl.addEventListener('click', () => lancer(d.id, null));
  }

  // ---------------------------------------------------------------------
  // Composer l'équipe
  // ---------------------------------------------------------------------

  function composerEquipe(){
    const n = S.acc.taille;
    let choix = S.equipe.slice();
    const f = A.fenetre('<div data-ed></div>', true);
    const ed = f.corps.querySelector('[data-ed]');
    const tri = S.cartes.slice().sort((a, b) => score(b) - score(a));
    const auto = () => {
      const vus = new Set(); const r = [];
      for(const c of tri){ if(!vus.has(c.artist_id)){ vus.add(c.artist_id); r.push(c); } if(r.length === n) break; }
      for(const c of tri){ if(r.length >= n) break; if(!r.includes(c)) r.push(c); }
      return r;
    };
    function rendre(){
      ed.innerHTML = `
        <h2>Mon équipe</h2>
        <p class="sous">Choisis ${n} cartes. Dans l'ordre : la 1re affronte la 1re carte adverse, etc.</p>
        <div class="tr-slots" style="--n:${n}">${Array.from({ length: n }, (_, i) => choix[i]
          ? `<div class="tr-slot">${carte(choix[i])}${statsHtml(choix[i])}<div class="tr-slot-act">
              <button type="button" class="tr-mini" data-gauche="${i}" aria-label="Avancer" ${i === 0 ? 'disabled' : ''}>←</button>
              <button type="button" class="tr-mini" data-retirer="${i}" aria-label="Retirer">✕</button>
              <button type="button" class="tr-mini" data-droite="${i}" aria-label="Reculer" ${i === choix.length - 1 ? 'disabled' : ''}>→</button></div></div>`
          : `<div class="tr-slot"><div class="tr-vide">Libre</div></div>`).join('')}</div>
        <div class="tr-actions" style="margin-bottom:12px"><button type="button" class="ct-btn petit" data-auto>Équipe auto</button>
          <button type="button" class="ct-btn principal petit" data-ok ${choix.length === n ? '' : 'disabled'}>Valider</button></div>
        <div class="tr-grille">${tri.map((c) => `
          <button type="button" class="tr-tuile${choix.some((x) => cle(x) === cle(c)) ? ' choisie' : ''}" data-c="${esc(cle(c))}" aria-pressed="${choix.some((x) => cle(x) === cle(c))}">
            ${carte(c)}${statsHtml(c)}</button>`).join('') || '<p class="sous">Tu n\'as pas encore de carte.</p>'}</div>`;
      ed.querySelectorAll('[data-c]').forEach((b) => b.addEventListener('click', () => {
        const c = S.cartes.find((x) => cle(x) === b.dataset.c);
        const k = choix.findIndex((x) => cle(x) === b.dataset.c);
        if(k >= 0) choix.splice(k, 1);
        else if(choix.some((x) => x.artist_id === c.artist_id && x.booster === c.booster)){ A.toast('Une seule version de chaque carte.', 'err'); return; }
        else if(choix.length < n) choix.push(c);
        else { A.toast('Retire d\'abord une carte.', 'err'); return; }
        rendre();
      }));
      ed.querySelectorAll('[data-retirer]').forEach((b) => b.addEventListener('click', () => { choix.splice(Number(b.dataset.retirer), 1); rendre(); }));
      ed.querySelectorAll('[data-gauche]').forEach((b) => b.addEventListener('click', () => { const i = Number(b.dataset.gauche); [choix[i - 1], choix[i]] = [choix[i], choix[i - 1]]; rendre(); }));
      ed.querySelectorAll('[data-droite]').forEach((b) => b.addEventListener('click', () => { const i = Number(b.dataset.droite); [choix[i + 1], choix[i]] = [choix[i], choix[i + 1]]; rendre(); }));
      ed.querySelector('[data-auto]').addEventListener('click', () => { choix = auto(); rendre(); });
      ed.querySelector('[data-ok]').addEventListener('click', () => { S.equipe = choix; f.fermer(); dessiner(); });
    }
    rendre();
  }

  // ---------------------------------------------------------------------
  // Le combat : la base le joue, on le rejoue
  // ---------------------------------------------------------------------

  async function lancer(diff, etage){
    const bl = S.hote && S.hote.querySelector('[data-lancer]');
    if(bl) bl.disabled = true;
    let r;
    try{
      r = await A.appel('combat_tour_lancer', { p_difficulte: diff, p_etage: etage, p_equipe: S.equipe.map((c) => ({ booster: c.booster, artist: c.artist_id, holo: !!c.holo })) });
    }catch(e){
      A.toast(e.message, 'err');
      if(bl) bl.disabled = false;
      return;
    }
    if(r.etat && A.poserEtat){ A.poserEtat(r.etat); if(A.majEntete) A.majEntete(); }
    await jouer(r);
  }

  function fermerScene(){
    if(S.scene){ S.scene.fini = true; if(S.scene.detruire) S.scene.detruire(); if(S.scene.ov) S.scene.ov.remove(); S.scene = null; }
  }

  // Les deux « acteurs » qui rejouent le déroulé : la scène 3D (WebGL) et, à défaut, la scène 2D. Même interface :
  //   intro(), evenement(ev), fin(victoire), detruire().
  const webglOk = () => { try{ const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); }catch(e){ return false; } };
  const chargerImage = (url) => new Promise((ok) => {
    if(!url) return ok(null);
    const i = new Image();
    i.crossOrigin = 'anonymous';
    i.onload = () => ok(i); i.onerror = () => ok(null);
    i.src = url;
  });

  async function jouer(r){
    fermerScene();
    const ov = document.createElement('div');
    ov.className = 'tr-scene';
    ov.innerHTML = `
      <div class="tr-haut"><div><h3>${esc(r.difficulte_nom)} · ${esc(r.nom)}</h3><small>${r.gardien ? 'Gardien · ' : ''}Étage ${r.etage} sur ${r.etages}</small></div><span class="tr-tour" data-tour>Prêts ?</span></div>
      <div class="tr-corps" data-corps></div>
      <div class="tr-bas"><button type="button" class="ct-btn petit" data-vitesse>Vitesse ×1</button><button type="button" class="ct-btn petit" data-passer>Passer</button></div>`;
    document.body.appendChild(ov);
    const sc = { ov, fini: false, vitesse: 1, passer: false, detruire: null };
    S.scene = sc;
    ov.querySelector('[data-vitesse]').addEventListener('click', (ev) => { sc.vitesse = sc.vitesse >= 3 ? 1 : sc.vitesse + 1; ev.currentTarget.textContent = 'Vitesse ×' + sc.vitesse; });
    ov.querySelector('[data-passer]').addEventListener('click', () => { sc.passer = true; });
    const corps = ov.querySelector('[data-corps]');

    let acteur = null;
    try{ acteur = await creerActeur3d(r, sc, corps); }catch(e){ acteur = null; }
    if(sc.fini) return;
    if(!acteur){ corps.innerHTML = ''; acteur = creerActeur2d(r, sc, corps); }
    sc.detruire = () => { try{ acteur.detruire(); }catch(e){ /* déjà fermé */ } };

    await acteur.intro();
    for(const ev of r.evenements){
      if(sc.fini) return;
      if(ev.t === 'tour') ov.querySelector('[data-tour]').textContent = 'Tour ' + ev.n;
      await acteur.evenement(ev);
    }
    if(sc.fini) return;
    await acteur.fin(!!r.victoire);
    if(sc.fini) return;
    finir(r, sc);
  }

  // ---------------------------------------------------------------------
  // La scène 2D (repli : pas de WebGL, mouvement réduit)
  // ---------------------------------------------------------------------

  function creerActeur2d(r, sc, corps){
    const n = r.a.length;
    const unite = (u, c, i) => `
      <div class="tr-uc" data-u="${c}-${i + 1}">${carte(u)}
        <div class="tr-pv"><i></i></div><div class="tr-pvn">${nf(u.pv_max)} / ${nf(u.pv_max)}</div><div class="tr-nomu">${esc(u.nom)}</div>${u.role_nom ? `<div class="tr-rolu">${esc(u.role_nom)}</div>` : ''}</div>`;
    corps.innerHTML = `
      <div class="tr-fond" style="background-image:url(img/combat/olympia.png?v=3)"></div>
      <div class="tr-terrain" style="--n:${n}">
        <div class="tr-ligne" style="--n:${n}">${r.b.map((u, i) => unite(u, 1, i)).join('')}</div>
        <div class="tr-ligne" style="--n:${n}">${r.a.map((u, i) => unite(u, 0, i)).join('')}</div>
      </div>`;
    const ov = sc.ov;
    const pvmax = { '0': r.a.map((u) => u.pv_max), '1': r.b.map((u) => u.pv_max) };
    const el = (c, p) => ov.querySelector(`[data-u="${c}-${p}"]`);
    const ms = (t) => (sc.passer || calme()) ? 0 : t / sc.vitesse;
    const majPv = (c, p, pv) => {
      const u = el(c, p); if(!u) return;
      const m = pvmax[c][p - 1];
      u.querySelector('.tr-pv i').style.width = Math.max(0, pv / m * 100) + '%';
      u.querySelector('.tr-pv').classList.toggle('bas', pv / m < .35);
      u.querySelector('.tr-pvn').textContent = nf(Math.max(0, pv)) + ' / ' + nf(m);
    };
    const flotte = (c, p, texte, cl) => {
      const u = el(c, p); if(!u || sc.passer) return;
      const d = document.createElement('div');
      d.className = 'tr-deg ' + (cl || '');
      d.textContent = texte;
      u.appendChild(d);
      setTimeout(() => d.remove(), 1000);
    };
    const bulle = (c, p, texte, cl) => {
      const u = el(c, p); if(!u || sc.passer) return;
      const d = document.createElement('div');
      d.className = 'tr-titre ' + (cl || '');
      d.textContent = texte;
      u.appendChild(d);
      setTimeout(() => d.remove(), 900);
    };
    const avance = (a, cote) => { if(a && !sc.passer) a.style.transform = `translateY(${cote === 0 ? -22 : 22}px) scale(1.06)`; };
    const secoue = (t) => { if(t && !sc.passer){ t.classList.add('touche'); setTimeout(() => t.classList.remove('touche'), 320); } };
    return {
      async intro(){ await attendre(ms(500)); },
      async evenement(ev){
        if(ev.t === 'tour'){ await attendre(ms(260)); }
        else if(ev.t === 'passif'){ bulle(ev.c[0], ev.c[1], ev.n, 'passif'); await attendre(ms(380)); }
        else if(ev.t === 'att'){
          const a = el(ev.a[0], ev.a[1]);
          bulle(ev.a[0], ev.a[1], ev.n, ev.s ? 'sig' : '');
          avance(a, ev.a[0]);
          await attendre(ms(230));
          secoue(el(ev.c[0], ev.c[1]));
          flotte(ev.c[0], ev.c[1], '−' + nf(ev.d), ev.s ? 'sig' : '');
          majPv(ev.c[0], ev.c[1], ev.pv);
          if(a) a.style.transform = '';
          await attendre(ms(330));
        }else if(ev.t === 'zone'){
          const a = el(ev.a[0], ev.a[1]);
          bulle(ev.a[0], ev.a[1], ev.n, ev.s ? 'sig' : '');
          avance(a, ev.a[0]);
          await attendre(ms(230));
          ev.x.forEach((h) => { secoue(el(h.c[0], h.c[1])); flotte(h.c[0], h.c[1], '−' + nf(h.d), ev.s ? 'sig' : ''); majPv(h.c[0], h.c[1], h.pv); });
          if(a) a.style.transform = '';
          await attendre(ms(330));
        }else if(ev.t === 'soin' && ev.x){
          bulle(ev.a[0], ev.a[1], ev.n, 'soin');
          await attendre(ms(200));
          ev.x.forEach((h) => { flotte(h.c[0], h.c[1], '+' + nf(h.d), 'soin'); majPv(h.c[0], h.c[1], h.pv); });
          await attendre(ms(320));
        }else if(ev.t === 'bouclier'){
          bulle(ev.a[0], ev.a[1], ev.n, 'passif');
          await attendre(ms(200));
          ev.x.forEach((h) => flotte(h.c[0], h.c[1], '🛡 +' + nf(h.d), 'bou'));
          await attendre(ms(320));
        }else if(ev.t === 'epines'){
          flotte(ev.c[0], ev.c[1], '−' + nf(ev.d), 'ref');
          if(ev.n) bulle(ev.c[0], ev.c[1], ev.n, 'passif');
          majPv(ev.c[0], ev.c[1], ev.pv);
          await attendre(ms(300));
        }else if(ev.t === 'soin'){
          flotte(ev.c[0], ev.c[1], '+' + nf(ev.d), 'soin');
          majPv(ev.c[0], ev.c[1], ev.pv);
          await attendre(ms(240));
        }else if(ev.t === 'ko'){
          const u = el(ev.c[0], ev.c[1]); if(u) u.classList.add('ko');
          await attendre(ms(300));
        }
      },
      async fin(){ await attendre(ms(400)); },
      detruire(){}
    };
  }

  // ---------------------------------------------------------------------
  // La scène 3D : une arène de concert, des cartes en volume sur des socles, une caméra qui suit l'action
  // ---------------------------------------------------------------------

  const PALETTES = {
    ruelle: { spots: [0xff7a2f, 0x23d5c9, 0xff7a2f], neon: 0xff7a2f, mur: ['#1d0c06', '#ff7a2f'], sol: 0x120f18 },
    studio: { spots: [0x4fb4ff, 0xa879ff, 0x4fb4ff], neon: 0x4fb4ff, mur: ['#081230', '#4fb4ff'], sol: 0x0b1020 },
    plateau: { spots: [0xffffff, 0x8fefff, 0xffffff], neon: 0x8fefff, mur: ['#0a1a20', '#8fefff'], sol: 0x0d1318 },
    concert: { spots: [0xff3d9a, 0xffd23f, 0xff3d9a], neon: 0xff3d9a, mur: ['#26081f', '#ff3d9a'], sol: 0x150a14 },
    toit: { spots: [0xff9f43, 0xa879ff, 0xff5c8a], neon: 0xff9f43, mur: ['#180d28', '#ff9f43'], sol: 0x120d1a }
  };
  const ease = {
    lin: (t) => t, out: (t) => 1 - Math.pow(1 - t, 3), in: (t) => t * t * t, io: (t) => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
    bounce: (t) => { const n1 = 7.5625, d1 = 2.75; if(t < 1 / d1) return n1 * t * t; if(t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + .75; if(t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + .9375; return n1 * (t -= 2.625 / d1) * t + .984375; }
  };

  function rectRond(g, x, y, w, h, r){
    g.beginPath();
    g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }

  // La carte du modèle Canva, dessinée sur un canvas pour servir de texture (cadre noir, photo, numéro, logo, nom en Anton, rareté colorée).
  async function dessinerCarte(u, logo){
    const W = 512, H = 640;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');
    const rc = A.rar(u.rarete).c;
    g.fillStyle = '#000'; rectRond(g, 0, 0, W, H, 34); g.fill();
    g.save(); rectRond(g, 10, 10, W - 20, H - 20, 26); g.clip();
    const img = await chargerImage(u.photo);
    if(img){
      const s = Math.max((W - 20) / img.width, (H - 20) / img.height), dw = img.width * s, dh = img.height * s;
      g.drawImage(img, 10 + (W - 20 - dw) / 2, 10 + (H - 20 - dh) * .22, dw, dh);
    }else{
      const gr = g.createLinearGradient(0, 0, W, H); gr.addColorStop(0, '#16314f'); gr.addColorStop(1, '#0a0d18'); g.fillStyle = gr; g.fillRect(10, 10, W - 20, H - 20);
    }
    const v = g.createLinearGradient(0, H * .52, 0, H - 10); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(.62, 'rgba(0,0,0,.88)'); v.addColorStop(1, '#000');
    g.fillStyle = v; g.fillRect(10, H * .5, W - 20, H * .5);
    if(u.holo){
      const h = g.createLinearGradient(0, 0, W, H);
      ['rgba(255,120,200,.22)', 'rgba(120,255,255,.22)', 'rgba(255,250,150,.22)', 'rgba(190,150,255,.22)'].forEach((col, i) => h.addColorStop(i / 3, col));
      g.globalCompositeOperation = 'screen'; g.fillStyle = h; g.fillRect(10, 10, W - 20, H - 20); g.globalCompositeOperation = 'source-over';
    }
    g.restore();
    g.fillStyle = 'rgba(255,255,255,.9)'; g.textAlign = 'left'; g.font = 'italic 300 24px Inter, Arial, sans-serif';
    g.fillText('#' + String(u.numero || 0).padStart(3, '0'), 40, 56);
    if(logo) g.drawImage(logo, W - 40 - 94, 30, 94, 94 * logo.height / logo.width);
    g.textAlign = 'center'; g.fillStyle = '#fff';
    const nom = String(u.nom || '').toUpperCase();
    let taille = 84; g.font = taille + 'px Anton, Impact, "Arial Narrow", sans-serif';
    while(g.measureText(nom).width > W - 90 && taille > 30){ taille -= 3; g.font = taille + 'px Anton, Impact, "Arial Narrow", sans-serif'; }
    g.fillText(nom, W / 2, H - 78);
    g.font = 'italic 300 24px Inter, Arial, sans-serif'; g.fillStyle = rc;
    g.fillText(A.rar(u.rarete).nom.toUpperCase().split('').join(String.fromCharCode(8202)), W / 2, H - 40);
    return c;
  }

  async function creerActeur3d(r, sc, corps){
    if(calme() || !webglOk() || S.sans3d) return null;
    let THREE = S.three;
    if(!THREE){
      try{ THREE = S.three = await import('./lib/three/three.module.min.js'); }catch(e){ S.sans3d = true; return null; }
    }
    if(sc.fini) return null;
    let renderer;
    try{ renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' }); }catch(e){ S.sans3d = true; return null; }

    const pal = PALETTES[r.decor] || PALETTES.studio;
    const n = r.a.length;
    const mobile = window.innerWidth < 700;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    const canvas = renderer.domElement;
    canvas.className = 'tr3-canvas';
    corps.innerHTML = '';
    corps.appendChild(canvas);
    const hudLayer = document.createElement('div');
    hudLayer.className = 'tr3-hud-layer';
    corps.appendChild(hudLayer);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xbcd6ea);
    scene.fog = new THREE.Fog(0xd4e4ee, 30, 70);
    const camera = new THREE.PerspectiveCamera(50, 1, .1, 90);
    const look = new THREE.Vector3(0, 1.1, 0);
    const accueil = { pos: new THREE.Vector3(0, 4.3, 9.6), look: new THREE.Vector3(0, 1.1, 0) };

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
    clef.castShadow = true; clef.shadow.mapSize.set(mobile ? 1024 : 2048, mobile ? 1024 : 2048);
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
    const [texOlympia, texTrottoir, texAsphalte] = await Promise.all([pixel('img/combat/olympia.png?v=3'), pixel('img/combat/trottoir.png?v=3', true), pixel('img/combat/asphalte.png?v=3', true)]);
    // la chaussée
    if(texAsphalte) texAsphalte.repeat.set(32, 32);
    const sol = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshStandardMaterial({ color: texAsphalte ? 0xffffff : 0x62656c, map: texAsphalte, roughness: .9, metalness: 0 }));
    sol.rotation.x = -Math.PI / 2; sol.receiveShadow = true; scene.add(sol);
    // le trottoir au pied de la façade, son bord, les traits blancs de la chaussée
    if(texTrottoir) texTrottoir.repeat.set(27, 2.5);
    const trottoir = new THREE.Mesh(new THREE.PlaneGeometry(40, 3.8), new THREE.MeshStandardMaterial({ color: texTrottoir ? 0xffffff : 0xb9b3a6, map: texTrottoir, roughness: .85, metalness: 0 }));
    trottoir.rotation.x = -Math.PI / 2; trottoir.position.set(0, .02, -11.1); trottoir.receiveShadow = true; scene.add(trottoir);
    const bord = new THREE.Mesh(new THREE.BoxGeometry(40, .14, .3), new THREE.MeshStandardMaterial({ color: 0xa8a398, roughness: .9 }));
    bord.position.set(0, .07, -9.15); bord.receiveShadow = true; scene.add(bord);
    for(let k = -6; k <= 6; k++){
      const trait = new THREE.Mesh(new THREE.BoxGeometry(1.7, .012, .13), new THREE.MeshStandardMaterial({ color: 0xe9e6dc, roughness: .8 }));
      trait.position.set(k * 3.4, .012, -6.6); scene.add(trait);
    }
    // la façade, tout au fond : le sol de l'image (ligne 215 sur 270) est posé sur le sol de la scène
    const HM = 12, LM = HM * 480 / 270;
    const mur = new THREE.Mesh(new THREE.PlaneGeometry(LM, HM), new THREE.MeshBasicMaterial({ map: texOlympia, color: texOlympia ? 0xffffff : 0xb4c8d8, fog: false, toneMapped: false }));
    mur.position.set(0, HM * (215 / 270 - .5), -13);
    // --- le relief : le décor est recentré sur l'enseigne, les immeubles voisins sont en V, les enseignes sortent du mur, des arbres et des lampadaires sont en vrai 3D
    const s = HM / 270;                                  // un pixel de l'image, en unités de la scène
    const decor = new THREE.Group(); decor.position.x = -(281 - 240) * s; scene.add(decor);
    decor.add(mur);
    const coupe = (x0, y0, x1, y1) => {
      if(!texOlympia) return null;
      const t = texOlympia.clone(); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      t.repeat.set((x1 - x0) / 480, (y1 - y0) / 270); t.offset.set(x0 / 480, 1 - y1 / 270); t.needsUpdate = true;
      return t;
    };
    const toile = (x0, y0, x1, y1, teinte) => new THREE.Mesh(new THREE.PlaneGeometry((x1 - x0) * s, (y1 - y0) * s), new THREE.MeshBasicMaterial({ map: coupe(x0, y0, x1, y1), color: teinte || 0xffffff, fog: false, toneMapped: false, side: THREE.DoubleSide }));
    if(texOlympia){
      // le bloc central, un peu en avant du fond
      const centre = toile(215, 0, 345, 215); centre.position.set((280 - 240) * s, 215 * s / 2, -12.7); decor.add(centre);
      // les toits : corniche en pierre, mansarde en zinc, cheminée en brique (la photo s'arrête en plein milieu de l'immeuble)
      const ardoise = new THREE.MeshStandardMaterial({ color: 0x66707f, roughness: .8 });
      const pierre = new THREE.MeshStandardMaterial({ color: 0xd9d2c0, roughness: .9 });
      const brique = new THREE.MeshStandardMaterial({ color: 0x9a6a55, roughness: .9 });
      const toit = (parent, cx, w, z) => {
        const h0 = 215 * s;
        const pieces = [
          [new THREE.BoxGeometry(w, .3, 1.4), pierre, cx, h0 + .1, z + .05],
          [new THREE.BoxGeometry(w * .98, 1.6, 1.1), ardoise, cx, h0 + 1, z - .35],
          [new THREE.BoxGeometry(w * .9, .7, .6), ardoise, cx, h0 + 2.15, z - .6],
          [new THREE.BoxGeometry(.5, 1.2, .5), brique, cx + w * .3, h0 + 2.9, z - .65]
        ];
        pieces.forEach(([geo, mat, x, y, zz]) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, zz); m.castShadow = true; parent.add(m); });
      };
      const gc = new THREE.Group(); gc.position.z = -12.7; decor.add(gc); toit(gc, (280 - 240) * s, 130 * s, 0);
      // les immeubles voisins, tournés vers la rue : on dirait une vraie perspective de boulevard
      const flanc = (x0, x1, cote, angle, teinte) => {
        const g = new THREE.Group(), w = (x1 - x0) * s;
        for(let k = 0; k < 3; k++){                       // la rue continue : la deuxième tranche est le reflet de la première
          const p = toile(x0, 0, x1, 215, teinte);
          p.position.set(cote * (k + .5) * w, 215 * s / 2, 0); if(k % 2) p.scale.x = -1;
          g.add(p); toit(g, cote * (k + .5) * w, w, 0);
        }
        g.position.set(((cote < 0 ? x1 : x0) - 240) * s, 0, -12.7); g.rotation.y = -cote * angle;
        decor.add(g);
      };
      flanc(0, 215, -1, .36, 0xe6e6e6);
      flanc(345, 480, 1, .42, 0xdcdcdc);
      // les enseignes sortent du mur : l'OLYMPIA et la devanture LA WAVE
      const saillie = (x0, y0, x1, y1, prof) => {
        const g = new THREE.Group();
        const corps = new THREE.Mesh(new THREE.BoxGeometry((x1 - x0) * s, (y1 - y0) * s, prof), new THREE.MeshStandardMaterial({ color: 0x5a3a32, roughness: .8 }));
        corps.castShadow = true; g.add(corps);
        const face = toile(x0, y0, x1, y1); face.position.z = prof / 2 + .01; g.add(face);
        g.position.set(((x0 + x1) / 2 - 240) * s, (215 - (y0 + y1) / 2) * s, -12.7 + prof / 2);
        decor.add(g);
      };
      saillie(220, 19, 342, 50, .55);
      saillie(225, 70, 317, 158, .32);
    }
    // les arbres : un tronc, des touffes de feuillage en facettes
    const alea = (i) => { const v = Math.sin(i * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
    const vertsArbre = [0x4f7d3a, 0x5f9142, 0x3f6b32, 0x6ea34c, 0x567f3c];
    // le feuillage est tacheté de gros pixels : même grain que la façade
    const texFeuille = (() => {
      const c = document.createElement('canvas'); c.width = c.height = 12; const g = c.getContext('2d');
      for(let y = 0; y < 12; y++) for(let x = 0; x < 12; x++){ g.fillStyle = vertsArbre.map((v) => '#' + v.toString(16))[Math.floor(alea(x * 12 + y + 5) * vertsArbre.length)]; g.fillRect(x, y, 1, 1); }
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; t.wrapS = t.wrapT = THREE.RepeatWrapping;
      return t;
    })();
    const arbre = (x, z, haut, graine) => {
      const g = new THREE.Group();
      const tronc = new THREE.Mesh(new THREE.CylinderGeometry(.14, .22, haut * .6, 6), new THREE.MeshStandardMaterial({ color: 0x4a3b2e, roughness: 1, flatShading: true }));
      tronc.position.y = haut * .3; tronc.castShadow = true; g.add(tronc);
      for(let i = 0; i < 9; i++){
        const r = .75 + alea(graine + i) * .55;
        const b = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), new THREE.MeshStandardMaterial({ color: 0xffffff, map: texFeuille, roughness: .95, flatShading: true }));
        b.position.set((alea(graine + i * 3) - .5) * 2.6, haut * (.62 + alea(graine + i * 5) * .38), (alea(graine + i * 7) - .5) * 1.6);
        b.castShadow = true; g.add(b);
      }
      const grille = new THREE.Mesh(new THREE.BoxGeometry(.9, .06, .9), new THREE.MeshStandardMaterial({ color: 0x2b2b2e, roughness: .6, metalness: .5 }));
      grille.position.y = .03; g.add(grille);
      g.position.set(x, 0, z); scene.add(g);
    };
    arbre(-6.9, -10.4, 7.2, 3); arbre(7.4, -10.6, 6.6, 17); arbre(-12.5, -10.2, 6.4, 29); arbre(13, -10.5, 6.8, 41);
    // les lampadaires du boulevard
    const lampadaire = (x, z) => {
      const g = new THREE.Group();
      const fer = new THREE.MeshStandardMaterial({ color: 0x26332d, roughness: .5, metalness: .6 });
      const mat = new THREE.Mesh(new THREE.CylinderGeometry(.06, .1, 4.6, 8), fer); mat.position.y = 2.3; mat.castShadow = true;
      const socle = new THREE.Mesh(new THREE.CylinderGeometry(.16, .2, .5, 8), fer); socle.position.y = .25;
      const lanterne = new THREE.Mesh(new THREE.BoxGeometry(.36, .5, .36), new THREE.MeshStandardMaterial({ color: 0xfff1c9, emissive: 0xffe2a0, emissiveIntensity: .5, roughness: .4 })); lanterne.position.y = 4.85;
      const toit = new THREE.Mesh(new THREE.ConeGeometry(.3, .22, 4), fer); toit.position.y = 5.2; toit.rotation.y = Math.PI / 4;
      g.add(mat, socle, lanterne, toit); g.position.set(x, 0, z); scene.add(g);
    };
    lampadaire(-3.4, -9.5); lampadaire(4.6, -9.5); lampadaire(-9.4, -9.5); lampadaire(10.6, -9.5);
    // le ciel : un dégradé et des nuages en gros pixels, loin derrière les toits
    {
      const c = document.createElement('canvas'); c.width = 160; c.height = 60; const g = c.getContext('2d');
      const gr = g.createLinearGradient(0, 0, 0, 60); gr.addColorStop(0, '#6fa6dc'); gr.addColorStop(1, '#cfe3f1');
      g.fillStyle = gr; g.fillRect(0, 0, 160, 60);
      g.fillStyle = '#f4f9fc';
      for(let i = 0; i < 7; i++){
        const cx = 10 + alea(i * 3 + 1) * 140, cy = 8 + alea(i * 5 + 2) * 34, L = 14 + Math.floor(alea(i * 7 + 3) * 16);
        g.fillRect(cx, cy, L, 3); g.fillRect(cx + 3, cy - 3, L - 8, 3); g.fillRect(cx - 4, cy + 3, L + 6, 2);
      }
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
      const ciel = new THREE.Mesh(new THREE.PlaneGeometry(150, 56), new THREE.MeshBasicMaterial({ map: t, fog: false, toneMapped: false }));
      ciel.position.set(0, 24, -40); scene.add(ciel);
    }
    let impact = 0;

    // --- la poussière lumineuse qui flotte
    const poussiere = (() => {
      const N = 260, pos = new Float32Array(N * 3), vit = new Float32Array(N);
      for(let i = 0; i < N; i++){ pos[i * 3] = (Math.random() - .5) * 26; pos[i * 3 + 1] = Math.random() * 9; pos[i * 3 + 2] = (Math.random() - .7) * 22; vit[i] = .1 + Math.random() * .25; }
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xfff3d0, size: .06, transparent: true, opacity: .45, blending: THREE.AdditiveBlending, depthWrite: false }));
      scene.add(pts);
      return { pts, pos, vit, N };
    })();

    // --- les particules (impacts, soins, confettis) : un seul nuage réutilisé
    const NP = 700;
    const part = { pos: new Float32Array(NP * 3), vel: new Float32Array(NP * 3), col: new Float32Array(NP * 3), vie: new Float32Array(NP), max: new Float32Array(NP), grav: new Float32Array(NP), base: new Float32Array(NP * 3), i: 0 };
    const sprite = (() => {
      const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
      const rg = g.createRadialGradient(32, 32, 0, 32, 32, 32); rg.addColorStop(0, 'rgba(255,255,255,1)'); rg.addColorStop(.35, 'rgba(255,255,255,.6)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = rg; g.fillRect(0, 0, 64, 64);
      return new THREE.CanvasTexture(c);
    })();
    const pgeo = new THREE.BufferGeometry();
    pgeo.setAttribute('position', new THREE.BufferAttribute(part.pos, 3));
    pgeo.setAttribute('color', new THREE.BufferAttribute(part.col, 3));
    const pts = new THREE.Points(pgeo, new THREE.PointsMaterial({ size: .28, map: sprite, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true }));
    pts.frustumCulled = false; scene.add(pts);
    const tmpC = new THREE.Color();
    const burst = (p, couleur, nb, vitesse, vie, grav) => {
      tmpC.set(couleur);
      for(let k = 0; k < nb; k++){
        const i = part.i = (part.i + 1) % NP;
        const th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1), v = vitesse * (.35 + Math.random() * .65);
        part.pos[i * 3] = p.x; part.pos[i * 3 + 1] = p.y; part.pos[i * 3 + 2] = p.z;
        part.vel[i * 3] = Math.sin(ph) * Math.cos(th) * v; part.vel[i * 3 + 1] = Math.abs(Math.cos(ph)) * v + vitesse * .25; part.vel[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * v;
        part.base[i * 3] = tmpC.r; part.base[i * 3 + 1] = tmpC.g; part.base[i * 3 + 2] = tmpC.b;
        part.vie[i] = part.max[i] = vie * (.6 + Math.random() * .6); part.grav[i] = grav === undefined ? 6 : grav;
      }
    };
    const jaillir = (p, couleur, nb, haut) => {   // un flot qui monte (soins, boucliers)
      tmpC.set(couleur);
      for(let k = 0; k < nb; k++){
        const i = part.i = (part.i + 1) % NP;
        part.pos[i * 3] = p.x + (Math.random() - .5) * 1.3; part.pos[i * 3 + 1] = p.y - .9 + Math.random() * .4; part.pos[i * 3 + 2] = p.z + (Math.random() - .5) * .4;
        part.vel[i * 3] = 0; part.vel[i * 3 + 1] = haut * (.6 + Math.random() * .6); part.vel[i * 3 + 2] = 0;
        part.base[i * 3] = tmpC.r; part.base[i * 3 + 1] = tmpC.g; part.base[i * 3 + 2] = tmpC.b;
        part.vie[i] = part.max[i] = .9 + Math.random() * .5; part.grav[i] = -1;
      }
    };
    const ondes = [];
    const onde = (p, couleur, max, dur) => {
      const m = new THREE.Mesh(new THREE.RingGeometry(.25, .34, 64), new THREE.MeshBasicMaterial({ color: couleur, transparent: true, opacity: .9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      m.position.set(p.x, .06, p.z); m.rotation.x = -Math.PI / 2; scene.add(m);
      ondes.push({ m, t: 0, dur, max });
    };

    // --- les combattants : une carte en volume sur un socle lumineux
    const logo = await chargerImage('img/logo-wave.png');
    try{ await Promise.race([document.fonts.load('64px Anton'), attendre(900)]); }catch(e){ /* police système */ }
    const dos = await new Promise((ok) => new THREE.TextureLoader().load('img/carte-dos.webp', ok, undefined, () => ok(null)));
    if(dos) dos.colorSpace = THREE.SRGBColorSpace;
    const CW = 1.5, CH = 1.875, EP = .07, YC = .3 + CH / 2 + .12;
    const forme = (() => { const s = new THREE.Shape(), r2 = .1, x = -CW / 2, y = -CH / 2; s.moveTo(x + r2, y); s.lineTo(x + CW - r2, y); s.quadraticCurveTo(x + CW, y, x + CW, y + r2); s.lineTo(x + CW, y + CH - r2); s.quadraticCurveTo(x + CW, y + CH, x + CW - r2, y + CH); s.lineTo(x + r2, y + CH); s.quadraticCurveTo(x, y + CH, x, y + CH - r2); s.lineTo(x, y + r2); s.quadraticCurveTo(x, y, x + r2, y); return s; })();
    const geoTranche = new THREE.ExtrudeGeometry(forme, { depth: EP, bevelEnabled: false, curveSegments: 10 }); geoTranche.translate(0, 0, -EP / 2);
    const geoFace = new THREE.ShapeGeometry(forme, 10);
    const geoSocle = new THREE.CylinderGeometry(.95, 1.05, .3, 48);
    const geoAnneau = new THREE.TorusGeometry(.99, .03, 10, 64);
    const geoHalo = new THREE.CircleGeometry(1.5, 48);
    const aniso = renderer.capabilities.getMaxAnisotropy();
    // les socles : de la pierre en pixel art
    const texPierre = (() => {
      const c = document.createElement('canvas'); c.width = c.height = 16; const g = c.getContext('2d');
      g.fillStyle = '#2a2d3d'; g.fillRect(0, 0, 16, 16);
      for(let y = 0; y < 16; y += 4){ for(let x = (y / 4) % 2 ? -4 : 0; x < 16; x += 8){ g.fillStyle = ((x + y) / 4 & 1) ? '#4a4f66' : '#434860'; g.fillRect(x + 1, y + 1, 6, 2); g.fillStyle = '#6c7390'; g.fillRect(x + 1, y + 1, 6, 1); } }
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(8, 1);
      return t;
    })();
    const matSocle = new THREE.MeshStandardMaterial({ color: 0xffffff, map: texPierre, metalness: .1, roughness: .85 });
    const matTranche = new THREE.MeshStandardMaterial({ color: 0x07080c, metalness: .5, roughness: .45 });
    if(dos){ dos.repeat.set(1 / CW, 1 / CH); dos.offset.set(.5, .5); dos.wrapS = dos.wrapT = THREE.RepeatWrapping; }
    const sp = n <= 3 ? 2.2 : (n === 4 ? 1.95 : 1.75);
    const combattants = {};
    const textures = await Promise.all([...r.a.map((u, i) => ({ u, i, c: 0 })), ...r.b.map((u, i) => ({ u, i, c: 1 }))].map(async (o) => ({ o, cv: await dessinerCarte(o.u, logo) })));
    if(sc.fini){ renderer.dispose(); return null; }
    const hud = (u, c) => {
      const d = document.createElement('div');
      d.className = 'tr3-hud ' + (c === 0 ? 'ami' : 'ennemi');
      d.innerHTML = `<div class="n">${esc(u.nom)}</div>${u.role_nom ? `<div class="ro">${esc(u.role_nom)}</div>` : ''}<div class="pv"><i></i><b></b></div><div class="pvn">${nf(u.pv_max)} / ${nf(u.pv_max)}</div>`;
      hudLayer.appendChild(d);
      return d;
    };
    textures.forEach(({ o, cv }) => {
      const { u, c, i } = o;
      const rc = new THREE.Color(A.rar(u.rarete).c);
      const g = new THREE.Group();
      g.position.set((i - (n - 1) / 2) * sp, 0, c === 0 ? 2.5 : -2.5);
      const socle = new THREE.Mesh(geoSocle, matSocle); socle.position.y = .15; socle.castShadow = socle.receiveShadow = true; g.add(socle);
      const anneau = new THREE.Mesh(geoAnneau, new THREE.MeshBasicMaterial({ color: c === 0 ? 0x4fb4ff : 0xff5c8a })); anneau.rotation.x = Math.PI / 2; anneau.position.y = .31; g.add(anneau);
      const halo = new THREE.Mesh(geoHalo, new THREE.MeshBasicMaterial({ color: rc, map: sprite, transparent: true, opacity: .35, blending: THREE.AdditiveBlending, depthWrite: false })); halo.rotation.x = -Math.PI / 2; halo.position.y = .02; g.add(halo);
      const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = aniso;
      tex.repeat.set(1 / CW, 1 / CH); tex.offset.set(.5, .5);
      const matF = u.holo
        ? new THREE.MeshPhysicalMaterial({ map: tex, roughness: .28, metalness: .15, clearcoat: 1, clearcoatRoughness: .15, iridescence: 1, iridescenceIOR: 1.7, iridescenceThicknessRange: [200, 600], emissive: 0x000000 })
        : new THREE.MeshStandardMaterial({ map: tex, roughness: .42, metalness: .12, emissive: 0x000000 });
      const carteG = new THREE.Group(); carteG.position.y = YC;
      const face = new THREE.Mesh(geoFace, matF); face.position.z = EP / 2 + .002; face.castShadow = true; carteG.add(face);
      const verso = new THREE.Mesh(geoFace, new THREE.MeshStandardMaterial({ map: dos || null, color: dos ? 0xffffff : 0x10304f, roughness: .5, metalness: .1 })); verso.rotation.y = Math.PI; verso.position.z = -EP / 2 - .002;
      carteG.add(verso);
      const tr = new THREE.Mesh(geoTranche, matTranche); tr.castShadow = true; carteG.add(tr);
      g.add(carteG);
      const bouclier = new THREE.Mesh(new THREE.SphereGeometry(1.55, 28, 20), new THREE.MeshPhysicalMaterial({ color: 0x5cc8ff, transparent: true, opacity: 0, roughness: .1, emissive: 0x2a8fff, emissiveIntensity: .6, side: THREE.DoubleSide, depthWrite: false }));
      bouclier.position.y = YC; g.add(bouclier);
      scene.add(g);
      combattants[c + '-' + (i + 1)] = { g, carteG, matF, bouclier, halo, anneau, home: g.position.clone(), c, i, u, pv: u.pv_max, pvmax: u.pv_max, bouc: 0, hud: hud(u, c), vivant: true, saut: false, ph: Math.random() * 6 };
    });
    const tous = Object.values(combattants);
    const fz = (c, p) => combattants[c + '-' + p];

    // --- la caméra : cadrage adapté à la taille de l'écran
    const cadrer = () => {
      const w = corps.clientWidth || 800, h = corps.clientHeight || 500;
      renderer.setSize(w, h, false);
      canvas.style.width = '100%'; canvas.style.height = '100%';
      camera.aspect = w / h;
      const largeur = (n - 1) * sp + CW + 1.2;
      const hfov = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect);
      const dist = Math.max(11, (largeur / 2) / Math.tan(hfov / 2) + 4.2);
      accueil.pos.set(0, 4.3 + dist * .04, dist);
      accueil.look.set(0, 3.9, -.4);
      camera.updateProjectionMatrix();
    };
    cadrer();
    camera.position.set(0, 9, accueil.pos.z + 6); look.set(0, 1.2, 0);
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(cadrer) : null;
    if(ro) ro.observe(corps); else window.addEventListener('resize', cadrer);

    // --- le moteur d'animation : des tweens avancés à chaque image, à la vitesse choisie
    const tweens = [];
    let echelle = 1;            // ralenti (1 = normal)
    let secousse = 0;
    const tw = (dur, f, fn) => new Promise((ok) => {
      if(sc.passer || dur <= 0){ f(1); ok(); return; }
      tweens.push({ t: 0, dur, f, fn: fn || ease.lin, ok });
    });
    const att = (ms) => (sc.passer ? Promise.resolve() : new Promise((ok) => tweens.push({ t: 0, dur: ms / 1000, f: () => {}, fn: ease.lin, ok })));
    const camVers = (pos, cible, dur) => {
      const p0 = camera.position.clone(), l0 = look.clone();
      return tw(dur, (k) => { camera.position.lerpVectors(p0, pos, k); look.lerpVectors(l0, cible, k); }, ease.io);
    };
    const vecP = new THREE.Vector3();
    const ecran = (p, dy) => {
      vecP.copy(p); vecP.y += dy; vecP.project(camera);
      return { x: (vecP.x * .5 + .5) * (corps.clientWidth || 1), y: (-vecP.y * .5 + .5) * (corps.clientHeight || 1), ok: vecP.z < 1 };
    };
    const etiquette = (f, texte, cl, dy, classe, duree) => {
      if(sc.passer) return;
      const e = ecran(f.g.position, dy);
      const d = document.createElement('div');
      d.className = classe + ' ' + (cl || '');
      d.textContent = texte;
      d.style.left = e.x + 'px'; d.style.top = e.y + 'px';
      hudLayer.appendChild(d);
      setTimeout(() => d.remove(), duree);
    };
    const popup = (f, texte, cl) => etiquette(f, texte, cl, 2.0, 'tr3-pop', 1100);
    const banniere = (f, texte, cl) => etiquette(f, texte, cl, 2.6, 'tr3-ban', 950);
    const majHud = (f) => {
      const pct = Math.max(0, f.pv / f.pvmax * 100);
      f.hud.querySelector('.pv i').style.width = pct + '%';
      f.hud.querySelector('.pv').classList.toggle('bas', pct < 35);
      f.hud.querySelector('.pv b').style.width = Math.min(100, f.bouc / f.pvmax * 100) + '%';
      f.hud.querySelector('.pvn').textContent = nf(Math.max(0, f.pv)) + ' / ' + nf(f.pvmax) + (f.bouc > 0 ? ' · 🛡' + nf(f.bouc) : '');
      f.bouclier.material.opacity = f.bouc > 0 ? .22 : 0;
    };
    const eclat = (f, couleur, dur) => {   // la carte s'illumine un instant (touchée, soignée…)
      f.matF.emissive.set(couleur);
      return tw(dur, (k) => { f.matF.emissiveIntensity = (1 - k) * 1.1; if(k >= 1) f.matF.emissive.set(0x000000); }, ease.out);
    };
    const centre = (f) => new THREE.Vector3(f.g.position.x, 1.9, f.g.position.z);
    const coup = (f) => new THREE.Vector3(f.g.position.x, 2.0, f.g.position.z + .1);

    // la carte touchée recule et se redresse ; le flash, les particules, la secousse
    const touche = (f, d, sig, couleur) => {
      const z0 = f.g.position.z, dir = f.c === 0 ? 1 : -1;
      impact = Math.min(1, impact + .7);
      flash.color.set(couleur || 0xffffff); flash.position.set(f.g.position.x, 2.6, z0 + (f.c === 0 ? -1 : 1));
      flash.intensity = sig ? 260 : 140;
      burst(coup(f), couleur || 0xffffff, sig ? 70 : 38, sig ? 7.5 : 5, .75);
      burst(coup(f), 0xffe6a8, sig ? 40 : 18, 3, .5);
      onde(f.g.position, couleur || 0xffffff, sig ? 3.4 : 2.4, .55);
      secousse = Math.max(secousse, Math.min(.55, .12 + d / f.pvmax * 1.2 + (sig ? .15 : 0)));
      eclat(f, 0xff4040, .35);
      return tw(.34, (k) => {
        const rebond = Math.sin(k * Math.PI);
        f.g.position.z = z0 + dir * rebond * .55;
        f.carteG.rotation.x = -rebond * .22 * dir; f.carteG.rotation.z = Math.sin(k * Math.PI * 3) * .06 * (1 - k);
      }, ease.lin);
    };
    const ko = (f) => {
      f.vivant = false;
      burst(centre(f), 0x666c80, 50, 3.5, 1.1, 2); burst(centre(f), 0xffffff, 20, 4, .6);
      f.hud.style.opacity = '.25';
      tw(.65, (k) => { f.carteG.rotation.x = -1.4 * k; f.carteG.position.y = YC - .55 * k; f.carteG.rotation.z = .12 * k; f.matF.color.setScalar(1 - .6 * k); f.halo.material.opacity = .35 * (1 - k); }, ease.out);
      return att(500);
    };

    // le déplacement d'attaque : un élan vers la cible puis le retour
    const elan = async (f, cible, dur) => {
      const x0 = f.g.position.x, z0 = f.g.position.z;
      const dest = new THREE.Vector3(cible.x, 0, cible.z + (f.c === 0 ? 1.7 : -1.7));
      await tw(.22, (k) => { f.carteG.rotation.x = .25 * k * (f.c === 0 ? 1 : -1); f.carteG.scale.setScalar(1 + .08 * k); }, ease.out);
      await tw(dur, (k) => {
        f.g.position.x = x0 + (dest.x - x0) * k; f.g.position.z = z0 + (dest.z - z0) * k;
        f.carteG.position.y = YC + Math.sin(k * Math.PI) * .7; f.carteG.rotation.x = (.25 - .6 * k) * (f.c === 0 ? 1 : -1);
      }, ease.in);
    };
    const retour = (f, dur) => {
      const x1 = f.g.position.x, z1 = f.g.position.z, rx = f.carteG.rotation.x;
      return tw(dur, (k) => {
        f.g.position.x = x1 + (f.home.x - x1) * k; f.g.position.z = z1 + (f.home.z - z1) * k;
        f.carteG.position.y = YC; f.carteG.rotation.x = rx * (1 - k); f.carteG.scale.setScalar(1 + .08 * (1 - k));
      }, ease.out);
    };

    let fini3d = false;
    const horloge = new THREE.Clock();
    let tFrames = 0, nFrames = 0, adapte = false, rafId = 0;
    const boucle = () => {
      if(fini3d) return;
      rafId = requestAnimationFrame(boucle);
      const brut = Math.min(horloge.getDelta(), .05);
      const t = horloge.elapsedTime;
      echelle += (1 - echelle) * Math.min(1, brut * 6);   // le ralenti revient doucement à la normale
      const dt = brut * sc.vitesse * echelle;
      for(let k = tweens.length - 1; k >= 0; k--){
        const w = tweens[k]; w.t += dt;
        const p = Math.min(1, w.t / w.dur);
        w.f(w.fn(p));
        if(p >= 1){ tweens.splice(k, 1); w.ok(); }
      }
      spots.forEach((o) => { o.s.target.position.x = o.base + Math.sin(t * .8 + o.ph) * 2.2; o.cone.rotation.z = Math.sin(t * .8 + o.ph) * .14; });
      flash.intensity *= Math.pow(.0009, brut);
      impact *= Math.pow(.05, brut);
      mur.material.color.setScalar(1 + impact * .1);   // la façade s'éclaire un peu à chaque impact
      for(let i = 0; i < poussiere.N; i++){ let y = poussiere.pos[i * 3 + 1] + poussiere.vit[i] * brut; if(y > 9) y = 0; poussiere.pos[i * 3 + 1] = y; poussiere.pos[i * 3] += Math.sin(t + i) * .1 * brut; }
      poussiere.pts.geometry.attributes.position.needsUpdate = true;
      tous.forEach((f) => {
        if(f.vivant && !f.saut) f.halo.material.opacity = .3 + Math.sin(t * 2 + f.ph) * .08;
        if(f.vivant) f.bouclier.rotation.y = t * .5;
        if(f.saut) f.carteG.position.y = YC + Math.abs(Math.sin(t * 4 + f.ph)) * .55;
      });
      const v = brut * sc.vitesse;
      for(let i = 0; i < NP; i++){
        if(part.vie[i] <= 0){ part.col[i * 3] = part.col[i * 3 + 1] = part.col[i * 3 + 2] = 0; continue; }
        part.vie[i] -= v;
        part.vel[i * 3 + 1] -= part.grav[i] * v;
        part.pos[i * 3] += part.vel[i * 3] * v; part.pos[i * 3 + 1] += part.vel[i * 3 + 1] * v; part.pos[i * 3 + 2] += part.vel[i * 3 + 2] * v;
        const a = Math.max(0, part.vie[i] / part.max[i]);
        part.col[i * 3] = part.base[i * 3] * a; part.col[i * 3 + 1] = part.base[i * 3 + 1] * a; part.col[i * 3 + 2] = part.base[i * 3 + 2] * a;
      }
      pgeo.attributes.position.needsUpdate = true; pgeo.attributes.color.needsUpdate = true;
      for(let k = ondes.length - 1; k >= 0; k--){
        const o = ondes[k]; o.t += v; const p = Math.min(1, o.t / o.dur);
        o.m.scale.setScalar(1 + p * o.max * 3); o.m.material.opacity = (1 - p) * .9;
        if(p >= 1){ scene.remove(o.m); o.m.geometry.dispose(); o.m.material.dispose(); ondes.splice(k, 1); }
      }
      secousse *= Math.pow(.02, brut);
      const sx = (Math.random() - .5) * secousse, sy = (Math.random() - .5) * secousse;
      camera.position.x += sx; camera.position.y += sy; camera.lookAt(look); camera.updateMatrixWorld(true);
      tous.forEach((f) => { const e = ecran(f.g.position, 2.55); f.hud.style.transform = `translate3d(${e.x}px, ${e.y}px, 0)`; f.hud.style.display = e.ok ? '' : 'none'; });
      renderer.render(scene, camera);
      camera.position.x -= sx; camera.position.y -= sy;
      tFrames += brut; nFrames++;
      if(!adapte && nFrames === 50){   // si la machine peine, on allège (résolution, ombres)
        adapte = true;
        if(tFrames / nFrames > .03){ renderer.setPixelRatio(1); renderer.shadowMap.enabled = false; scene.traverse((o) => { if(o.material) o.material.needsUpdate = true; }); cadrer(); }
      }
    };
    tous.forEach(majHud);
    boucle();

    // --- les événements du combat, en images
    const posCamAmi = (a) => new THREE.Vector3(a.home.x * .5, 4.6, a.home.z + 8.4);
    const evenement = async (ev) => {
      if(ev.t === 'tour'){
        if(!sc.passer){ const b = document.createElement('div'); b.className = 'tr3-tour'; b.textContent = 'Tour ' + ev.n; hudLayer.appendChild(b); setTimeout(() => b.remove(), 1100); }
        await camVers(accueil.pos, accueil.look, .35);
      }else if(ev.t === 'passif'){
        const f = fz(ev.c[0], ev.c[1]); if(!f) return;
        onde(f.g.position, 0xffd76a, 2.6, .6); burst(centre(f), 0xffd76a, 24, 3, .7); banniere(f, ev.n, 'passif');
        await eclat(f, 0xffd76a, .4);
      }else if(ev.t === 'att'){
        const a = fz(ev.a[0], ev.a[1]), t = fz(ev.c[0], ev.c[1]);
        banniere(a, ev.n, ev.s ? 'sig' : '');
        const mid = new THREE.Vector3((a.home.x + t.g.position.x) / 2, 1.5, (a.home.z + t.g.position.z) / 2);
        if(ev.s) echelle = .35;
        camVers(new THREE.Vector3(mid.x * .6 + (a.c === 0 ? 1.2 : -1.2), 4.6, mid.z + 8.6), new THREE.Vector3(mid.x, 2.8, mid.z), .38);
        await elan(a, t.g.position, ev.s ? .26 : .2);
        touche(t, ev.d, ev.s, ev.s ? 0xffd76a : (a.c === 0 ? 0x7fd0ff : 0xff8fb0));
        popup(t, '−' + nf(ev.d), ev.s ? 'sig' : '');
        t.pv = ev.pv; t.bouc = ev.b || 0; majHud(t);
        await att(120);
        retour(a, .3);
        await att(330);
      }else if(ev.t === 'zone'){
        const a = fz(ev.a[0], ev.a[1]);
        banniere(a, ev.n, ev.s ? 'sig' : '');
        if(ev.s) echelle = .35;
        camVers(new THREE.Vector3(0, 5, accueil.pos.z - .5), new THREE.Vector3(0, 2.8, a.c === 0 ? -1 : 1), .4);
        await tw(.32, (k) => { a.carteG.position.y = YC + Math.sin(k * Math.PI) * .9; a.carteG.rotation.y = k * Math.PI * 2; }, ease.io);
        a.carteG.rotation.y = 0;
        onde(a.g.position, ev.s ? 0xffd76a : 0xffffff, 5, .8);
        ev.x.forEach((h, k) => {
          const t = fz(h.c[0], h.c[1]);
          setTimeout(() => { if(sc.fini) return; touche(t, h.d, ev.s, ev.s ? 0xffd76a : 0xffa05c); popup(t, '−' + nf(h.d), ev.s ? 'sig' : ''); t.pv = h.pv; t.bouc = h.b || 0; majHud(t); }, sc.passer ? 0 : k * 90 / sc.vitesse);
        });
        await att(520);
      }else if(ev.t === 'soin' && ev.x){
        const a = fz(ev.a[0], ev.a[1]);
        banniere(a, ev.n, 'soin');
        eclat(a, 0x5be0a6, .5);
        camVers(posCamAmi(a), new THREE.Vector3(a.home.x * .5, 2.8, a.home.z), .35);
        await att(260);
        ev.x.forEach((h) => { const t = fz(h.c[0], h.c[1]); jaillir(t.g.position.clone().setY(2.2), 0x5be0a6, 36, 3.2); onde(t.g.position, 0x5be0a6, 2, .6); eclat(t, 0x5be0a6, .55); popup(t, '+' + nf(h.d), 'soin'); t.pv = h.pv; majHud(t); });
        await att(520);
      }else if(ev.t === 'bouclier'){
        const a = fz(ev.a[0], ev.a[1]);
        banniere(a, ev.n, 'bou');
        eclat(a, 0x5cc8ff, .5);
        camVers(posCamAmi(a), new THREE.Vector3(a.home.x * .5, 2.8, a.home.z), .35);
        await att(260);
        ev.x.forEach((h) => { const t = fz(h.c[0], h.c[1]); jaillir(t.g.position.clone().setY(2.2), 0x5cc8ff, 30, 2.4); onde(t.g.position, 0x5cc8ff, 2.2, .6); eclat(t, 0x5cc8ff, .55); popup(t, '🛡 +' + nf(h.d), 'bou'); t.bouc = h.b; majHud(t); });
        await att(520);
      }else if(ev.t === 'epines'){
        const f = fz(ev.c[0], ev.c[1]);
        if(ev.n) banniere(f, ev.n, 'passif');
        touche(f, ev.d, false, 0xff9f43); popup(f, '−' + nf(ev.d), 'ref'); f.pv = ev.pv; majHud(f);
        await att(320);
      }else if(ev.t === 'soin'){
        const f = fz(ev.c[0], ev.c[1]);
        jaillir(f.g.position.clone().setY(2.2), 0x5be0a6, 18, 2.6); popup(f, '+' + nf(ev.d), 'soin'); f.pv = ev.pv; majHud(f);
        await att(260);
      }else if(ev.t === 'ko'){
        await ko(fz(ev.c[0], ev.c[1]));
      }
    };

    return {
      async intro(){
        // les cartes tombent sur leurs socles, la caméra descend vers l'arène
        const dolly = camVers(accueil.pos, accueil.look, 1.7);
        tous.forEach((f, k) => {
          f.carteG.position.y = YC + 9; f.hud.style.opacity = '0';
          setTimeout(() => {
            if(fini3d) return;
            tw(.7, (p) => { f.carteG.position.y = YC + (1 - p) * 9; }, ease.bounce).then(() => { onde(f.g.position, f.c === 0 ? 0x4fb4ff : 0xff5c8a, 2, .5); burst(f.g.position.clone().setY(.4), 0xffffff, 10, 2.5, .5); secousse = Math.max(secousse, .06); f.hud.style.opacity = ''; });
          }, sc.passer ? 0 : (k * 130 + 250) / sc.vitesse);
        });
        await dolly; await att(700);
      },
      evenement,
      async fin(victoire){
        tous.filter((f) => f.c === (victoire ? 0 : 1) && f.vivant).forEach((f) => { f.saut = true; burst(centre(f), 0xffd76a, 40, 6, 1.2, 4); });
        if(victoire){ for(let k = 0; k < 4; k++) burst(new THREE.Vector3((k - 1.5) * 2.2, 5, 0), [0xff5c8a, 0xffd76a, 0x4fb4ff, 0x5be0a6][k], 60, 5, 1.6, 3); }
        camVers(new THREE.Vector3(0, 3.6, accueil.pos.z - 2.2), new THREE.Vector3(0, 1.6, victoire ? 1.2 : -1.2), 1.1);
        await att(1100);
      },
      detruire(){
        fini3d = true;
        cancelAnimationFrame(rafId);
        if(ro) ro.disconnect(); else window.removeEventListener('resize', cadrer);
        scene.traverse((o) => {
          if(o.geometry) o.geometry.dispose();
          if(o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { if(m.map && m.map !== dos) m.map.dispose(); m.dispose(); });
        });
        if(scene.environment) scene.environment.dispose();
        sprite.dispose(); texPierre.dispose(); [texOlympia, texTrottoir, texAsphalte].forEach((t) => { if(t) t.dispose(); }); if(dos) dos.dispose();
        renderer.dispose();
        if(renderer.forceContextLoss) renderer.forceContextLoss();
      }
    };
  }

  function finir(r, sc){
    const g = r.gains || {};
    const fin = document.createElement('div');
    fin.className = 'tr-fin';
    const suite = r.victoire && r.etage < r.etages;
    fin.innerHTML = `
      <div class="tr-fin-c ${r.victoire ? 'v' : 'd'}">
        <h2>${r.victoire ? 'Victoire !' : 'Défaite'}</h2>
        <p class="sous" style="margin:0">${esc(r.nom)} · ${esc(r.difficulte_nom)} · ${pluriel(r.tours, 'tour', 'tours')}</p>
        ${r.premiere ? `<div class="tr-gains">${g.wc ? `<span class="tr-puce or">+${nf(g.wc)} Wave Coins</span>` : ''}${g.vinyles ? `<span class="tr-puce or">+${nf(g.vinyles)} vinyle${g.vinyles > 1 ? 's' : ''}</span>` : ''}<span class="tr-puce">Étage ${r.etage_max} atteint</span></div>`
          : (r.victoire ? '<p class="sous" style="margin:0">Étage déjà franchi : pas de récompense, mais c\'est la classe.</p>' : '<p class="sous" style="margin:0">Change l\'ordre ou les cartes de ton équipe, puis réessaie.</p>')}
        <div class="tr-actions" style="justify-content:center">
          ${suite ? '<button type="button" class="ct-btn principal" data-suite>Étage suivant</button>' : ''}
          <button type="button" class="ct-btn${suite ? '' : ' principal'}" data-rejouer>Rejouer</button>
          <button type="button" class="ct-btn" data-retour>Retour</button>
        </div>
      </div>`;
    sc.ov.appendChild(fin);
    const retour = async () => { fermerScene(); try{ await charger(); dessiner(); }catch(e){ /* l'onglet a changé */ } };
    fin.querySelector('[data-retour]').addEventListener('click', retour);
    fin.querySelector('[data-rejouer]').addEventListener('click', async () => { fermerScene(); await lancer(r.difficulte, r.etage); });
    const s = fin.querySelector('[data-suite]');
    if(s) s.addEventListener('click', async () => { fermerScene(); await lancer(r.difficulte, null); });
  }

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
          <div class="cb-fiche-t"><div class="cb-roles">${c.role_nom ? `<span class="cb-role">${esc(c.role_nom)}</span>` : ''}${c.iv_pct != null ? `<span class="cb-iv" title="Les IV de ton meilleur exemplaire">IV ${esc(String(c.iv_pct).replace('.', ','))} %</span>` : ''}</div>
            <div class="cb-pvgros"><small>PV</small>${nf(c.pv)}</div></div>
          ${c.role_resume ? `<p class="cb-cap" style="margin:0">${esc(c.role_resume)}</p>` : ''}
          <div class="cb-stats">${[['pui', 'Puissance'], ['def', 'Défense'], ['vit', 'Vitesse']].map(([k, l]) => `<div class="cb-st"><span>${l}</span><b>${nf(c[k])}</b><i style="--w:${pct(c[k], mx[k])}%"></i></div>`).join('')}</div>
          <div class="cb-atts">${(c.titres || []).map((t, i) => `<div class="cb-att"><span>${i + 1}</span>${esc(t.nom)}<small>${i === 2 ? 'signature · ' : ''}×${String(t.mult).replace('.', ',')}</small></div>`).join('')}</div>
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
        ${d.difficultes.map((x) => `
        <div class="ct-panneau" style="margin-top:14px" data-diff="${esc(x.id)}">
          <h3 style="margin:0 0 4px">${esc(x.nom)}</h3>
          <p class="sous" style="margin:0 0 10px">${esc(x.resume)}</p>
          <div class="ee-iv-grille">
            ${champ(x.id, 'Étages', 'etages', x.etages)}${champ(x.id, 'Bonus adverse au départ (%)', 'bonus_base', x.bonus_base)}
            ${champ(x.id, 'Bonus par étage (%)', 'bonus_etage', x.bonus_etage, 0.05)}${champ(x.id, 'Bonus des gardiens (%)', 'bonus_gardien', x.bonus_gardien)}
            ${champ(x.id, 'Rareté en plus (0 à 3)', 'rarete_plus', x.rarete_plus)}${champ(x.id, 'Multiplicateur de Wave Coins', 'mult_wc', x.mult_wc, 0.1)}
            ${champ(x.id, 'Multiplicateur de vinyles', 'mult_vinyles', x.mult_vinyles, 0.1)}${champ(x.id, 'Étage requis dans la précédente', 'deblocage_etage', x.deblocage_etage)}
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
      const p = { id: x.id, nom: x.nom, resume: x.resume, actif: x.actif };
      hote.querySelectorAll(`[data-diff="${x.id}"] [data-f]`).forEach((i) => { p[i.dataset.f] = Number(i.value); });
      b.disabled = true;
      try{ await A.appel('combat_pve_equipe_difficulte', { p }); A.toast('Difficulté enregistrée.'); }
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
        <div class="cb-atts">${(e.titres || []).map((t, i) => `<div class="cb-att"><span>${i + 1}</span>${esc(t.nom)}<small>×${String(t.mult).replace('.', ',')}</small></div>`).join('')}</div>
        ${e.capacite ? `<div class="cb-cap"><b>Passif · ${esc(e.capacite.nom)}</b> — ${esc(e.capacite.description)}</div>` : ''}
        <p class="cb-cap" style="margin:0">Statistiques de base (sans IV). Les attaques sont les titres de l'album lié à la carte.</p></div>`;
    }catch(err){
      hote.innerHTML = `<p class="sous">${esc(err.message)}</p>`;
    }
  }

  window.WaveCombat = { monter, quitter, fiche, equipe, equipeCarte };

})();
