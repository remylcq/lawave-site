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
  .tr-fond{position:absolute; inset:0; background-size:cover; background-position:center; image-rendering:pixelated; opacity:.9;}
  .tr-fond::after{content:''; position:absolute; inset:0; background:linear-gradient(180deg, rgba(5,7,10,.55), rgba(5,7,10,.1) 45%, rgba(5,7,10,.65));}
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
  const statsHtml = (c) => `<div class="tr-stats"><span>PV <b>${nf(c.pv_max || c.pv)}</b></span><span>PUI <b>${nf(c.pui)}</b></span><span>DÉF <b>${nf(c.def)}</b></span><span>VIT <b>${nf(c.vit)}</b></span></div>`;

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
    if(S.scene){ S.scene.fini = true; if(S.scene.ov) S.scene.ov.remove(); S.scene = null; }
  }

  async function jouer(r){
    fermerScene();
    const n = r.a.length;
    const ov = document.createElement('div');
    ov.className = 'tr-scene';
    const fond = ['concert', 'studio', 'plateau', 'ruelle', 'toit'].includes(r.decor) ? r.decor : 'studio';
    const unite = (u, c, i) => `
      <div class="tr-uc" data-u="${c}-${i + 1}">${carte(u)}
        <div class="tr-pv"><i></i></div><div class="tr-pvn">${nf(u.pv_max)} / ${nf(u.pv_max)}</div><div class="tr-nomu">${esc(u.nom)}</div></div>`;
    ov.innerHTML = `
      <div class="tr-fond" style="background-image:url(img/combat/${fond}.png)"></div>
      <div class="tr-haut"><div><h3>${esc(r.difficulte_nom)} · ${esc(r.nom)}</h3><small>${r.gardien ? 'Gardien · ' : ''}Étage ${r.etage} sur ${r.etages}</small></div><span class="tr-tour" data-tour>Prêts ?</span></div>
      <div class="tr-terrain" style="--n:${n}">
        <div class="tr-ligne" style="--n:${n}">${r.b.map((u, i) => unite(u, 1, i)).join('')}</div>
        <div class="tr-ligne" style="--n:${n}">${r.a.map((u, i) => unite(u, 0, i)).join('')}</div>
      </div>
      <div class="tr-bas"><button type="button" class="ct-btn petit" data-vitesse>Vitesse ×1</button><button type="button" class="ct-btn petit" data-passer>Passer</button></div>`;
    document.body.appendChild(ov);
    const sc = { ov, fini: false, vitesse: 1, passer: false };
    S.scene = sc;
    const pvmax = { '0': r.a.map((u) => u.pv_max), '1': r.b.map((u) => u.pv_max) };
    const el = (c, p) => ov.querySelector(`[data-u="${c}-${p}"]`);
    const ms = (t) => (sc.passer || calme()) ? 0 : t / sc.vitesse;
    ov.querySelector('[data-vitesse]').addEventListener('click', (ev) => { sc.vitesse = sc.vitesse >= 3 ? 1 : sc.vitesse + 1; ev.currentTarget.textContent = 'Vitesse ×' + sc.vitesse; });
    ov.querySelector('[data-passer]').addEventListener('click', () => { sc.passer = true; });

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

    await attendre(ms(500));
    for(const ev of r.evenements){
      if(sc.fini) return;
      if(ev.t === 'tour'){
        ov.querySelector('[data-tour]').textContent = 'Tour ' + ev.n;
        await attendre(ms(260));
      }else if(ev.t === 'passif'){
        bulle(ev.c[0], ev.c[1], ev.n, 'passif');
        await attendre(ms(380));
      }else if(ev.t === 'att'){
        const a = el(ev.a[0], ev.a[1]), t = el(ev.c[0], ev.c[1]);
        bulle(ev.a[0], ev.a[1], ev.n, ev.s ? 'sig' : '');
        if(a && !sc.passer){ a.style.transform = `translateY(${ev.a[0] === 0 ? -22 : 22}px) scale(1.06)`; }
        await attendre(ms(230));
        if(t && !sc.passer){ t.classList.add('touche'); setTimeout(() => t.classList.remove('touche'), 320); }
        flotte(ev.c[0], ev.c[1], '−' + nf(ev.d), ev.s ? 'sig' : '');
        majPv(ev.c[0], ev.c[1], ev.pv);
        if(a) a.style.transform = '';
        await attendre(ms(330));
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
    }
    if(sc.fini) return;
    await attendre(ms(400));
    finir(r, sc);
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
