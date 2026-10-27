/* =====================================================================
   La Wave — Wave Cards : le marché entre joueurs

   Chargé à la demande par cartes.js (onglet « Marché », chargerWaveModule('marche') dans index.html).
   Le moteur vit dans la base (sql/marche-cartes.sql) : séquestre des cartes, achat atomique, commission, bornes de prix,
   expiration, journal. Ce fichier demande et dessine.

     Vitrine         les annonces en cours : recherche, filtres, tris, achat en deux gestes
     Mes annonces    ce que je vends (annuler) et ce qui est fini
     Mes ventes      mon historique de ventes et d'achats
     Mise en vente   guidée : choisir la carte, puis le prix (repères du marché, bornes, ce que je touche)
     Équipe          WaveMarche.equipe : modération, réglages, bornes de prix, journal, suspensions

   Contrat avec cartes.js :
     window.WaveMarche = { monter(hote, api), quitter(), equipe(hote, api), vendre(carte, api) }
   `api` est window.Cartes.api (cartes.js).
   ===================================================================== */

(function(){

  'use strict';

  let A = null;      // l'interface de cartes.js
  let H = null;      // l'élément de l'onglet, tant qu'il est affiché
  let REG = null;    // les règles du marché (commission, durée, plafond, bornes)

  const ST = {
    vue: 'vitrine',
    f: { q: '', booster: '', rarete: '', holo: '', pmin: '', pmax: '', manq: false, tri: 'recent', page: 1 },
    hist: { sens: 'ventes', page: 1 }
  };

  // ---------------------------------------------------------------------
  // Petits outils
  // ---------------------------------------------------------------------

  const entier = (v) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? n : null; };

  const reste = (iso) => {
    const ms = new Date(iso) - Date.now();
    if(!(ms > 0)) return 'expirée';
    const h = Math.floor(ms / 3.6e6);
    if(h >= 48) return Math.floor(h / 24) + ' j';
    if(h >= 1) return h + ' h';
    return Math.max(1, Math.floor(ms / 6e4)) + ' min';
  };

  const quand = (iso) => {
    const d = new Date(iso);
    return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) + ' · ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  };

  const prix = (n, grand) => `<span class="mk-prix${grand ? ' grand' : ''}">${A.ico('vinyle', grand ? 20 : 15)}<b>${A.nf(n)}</b></span>`;

  const commissionDe = (p) => Math.round(p * Number((REG && REG.commission_pct) || 0) / 100);

  const nomRar = (r) => A.rar(r).nom;

  async function charger(nom, args){
    return A.appel(nom, args);
  }

  async function reglages(){
    if(!REG){ try{ REG = await A.appel('marche_reglages_lire'); }catch(e){ REG = null; } }
    return REG;
  }

  async function collections(){
    let bs = A.boosters();
    if(!bs.length){ try{ bs = await A.appel('jeu_boosters'); }catch(e){ bs = []; } }
    return bs.filter((b) => b.classeur);
  }

  function apresOperation(etat){
    if(etat){ A.poserEtat(etat); A.majEntete(); }
  }

  async function rafraichir(){
    if(H && H.isConnected && H.querySelector('.mk')) await afficher(ST.vue);
    else await A.actualiser();
  }

  // ---------------------------------------------------------------------
  // La feuille de style
  // ---------------------------------------------------------------------

  const CSS = `
  .mk{padding-bottom:12px;}
  .mk-barre{display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; margin-bottom:18px;}
  .mk-barre .ct-segment{flex:0 1 auto;}
  .mk-filtres{display:flex; flex-wrap:wrap; gap:10px; align-items:center; margin-bottom:18px;}
  .mk-filtres .ct-select{min-width:0; max-width:100%;}
  .mk-champ-prix{width:92px; height:40px; padding:0 10px; border-radius:11px; border:1px solid var(--ct-trait-fort); background:rgba(255,255,255,.04); color:var(--ink); font:inherit; font-size:13.5px;}
  .mk-champ-prix:focus{outline:none; border-color:var(--ct-accent);}
  .mk-bascule{all:unset; box-sizing:border-box; cursor:pointer; height:40px; padding:0 14px; display:inline-flex; align-items:center; gap:8px; border-radius:11px; border:1px solid var(--ct-trait-fort); background:rgba(255,255,255,.04); color:var(--ink-soft); font-size:13.5px; font-weight:600;}
  .mk-bascule.actif{color:var(--ink); border-color:var(--ct-accent); background:rgba(79,180,255,.12);}
  .mk-bascule:focus-visible{outline:2px solid var(--ct-accent); outline-offset:2px;}
  .mk-compte{margin:0 0 14px; font-size:13px; color:var(--muted);}
  .mk-grille{display:grid; grid-template-columns:repeat(auto-fill, minmax(160px, 1fr)); gap:26px 16px;}
  .mk-ann{all:unset; box-sizing:border-box; cursor:pointer; display:grid; gap:9px; border-radius:14px; transition:transform .2s cubic-bezier(.2,.8,.2,1);}
  .mk-ann:hover{transform:translateY(-4px);}
  .mk-ann:focus-visible{outline:2px solid var(--ct-accent); outline-offset:4px;}
  .mk-ann .mk-pied{display:flex; align-items:center; justify-content:space-between; gap:8px; padding:0 2px;}
  .mk-prix{display:inline-flex; align-items:center; gap:6px; font-variant-numeric:tabular-nums; font-weight:800; font-size:16px; color:var(--ink);}
  .mk-prix .ct-ico{color:#F2C14E;}
  .mk-prix.grand{font-size:30px; letter-spacing:-.02em;}
  .mk-vendeur{min-width:0; font-size:12px; color:var(--muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; text-align:right;}
  .mk-etiquettes{display:flex; flex-wrap:wrap; gap:5px; padding:0 2px; min-height:20px;}
  .mk-tag{display:inline-flex; align-items:center; height:20px; padding:0 8px; border-radius:99px; font-size:11px; font-weight:700; letter-spacing:.02em; color:var(--ink-soft); background:var(--ct-surface-2); white-space:nowrap;}
  .mk-tag.nouveau{color:#04131f; background:var(--ct-accent);}
  .mk-tag.affaire{color:#06210f; background:var(--ct-ok);}
  .mk-tag.moi{color:#201500; background:#F2C14E;}
  .mk-tag.etat-active{color:#06210f; background:var(--ct-ok);}
  .mk-tag.etat-vendue{color:#04131f; background:var(--ct-accent);}
  .mk-tag.etat-annulee, .mk-tag.etat-expiree, .mk-tag.etat-retiree{color:var(--ink-soft);}

  .mk-liste{display:grid; gap:10px;}
  .mk-ligne{display:flex; align-items:center; gap:16px; padding:12px 14px; border-radius:16px; border:1px solid var(--ct-trait); background:var(--ct-surface);}
  .mk-ligne .mk-mini{flex:none; width:74px;}
  .mk-ligne .mk-mini .ct-carte{pointer-events:none;}
  .mk-ligne .tx{flex:1; min-width:0; display:grid; gap:4px;}
  .mk-ligne .tx b{font-size:15px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
  .mk-ligne .tx small{font-size:12.5px; color:var(--muted); line-height:1.45;}
  .mk-ligne .droite{display:grid; gap:8px; justify-items:end; flex:none;}
  .mk-repere{display:flex; flex-wrap:wrap; gap:6px 12px; font-size:12px; color:var(--muted);}
  .mk-repere b{color:var(--ink-soft); font-weight:700;}
  .mk-net{font-size:12px; color:var(--muted); text-align:right;}

  .mk-achat{display:grid; grid-template-columns:minmax(0, 190px) minmax(0, 1fr); gap:22px; margin-top:18px; align-items:start;}
  .mk-achat .gauche .ct-carte{width:100%;}
  .mk-achat h3{margin:0; font-size:20px; letter-spacing:-.01em;}
  .mk-achat .rar{margin-top:4px; font-size:13px; font-weight:700; color:var(--rc);}
  .mk-solde{display:grid; gap:6px; margin-top:16px; padding:12px 14px; border-radius:14px; background:var(--ct-surface); border:1px solid var(--ct-trait); font-size:13.5px; color:var(--ink-soft);}
  .mk-solde div{display:flex; justify-content:space-between; gap:12px; font-variant-numeric:tabular-nums;}
  .mk-solde b{color:var(--ink);}
  .mk-solde .manque b{color:#E5695C;}
  .mk-achat .ct-actions{margin-top:16px;}

  .mk-choix-tete{display:flex; flex-wrap:wrap; gap:10px; align-items:center; margin:16px 0 14px;}
  .mk-choix-grille{display:grid; grid-template-columns:repeat(auto-fill, minmax(118px, 1fr)); gap:16px 12px; max-height:52vh; overflow-y:auto; padding:6px 4px 10px; scrollbar-width:thin;}
  .mk-choix{all:unset; box-sizing:border-box; cursor:pointer; position:relative; display:block; border-radius:12px; transition:transform .2s;}
  .mk-choix:hover{transform:translateY(-3px);}
  .mk-choix:focus-visible{outline:2px solid var(--ct-accent); outline-offset:3px;}
  .mk-choix .mk-qte{position:absolute; z-index:3; top:-6px; right:-6px; min-width:24px; height:22px; padding:0 6px; border-radius:99px; display:grid; place-items:center; font-size:11.5px; font-weight:800; color:#05070a; background:#F4F5F6; box-shadow:0 4px 12px rgba(0,0,0,.45);}
  .mk-prix-champ{display:flex; align-items:center; gap:8px; margin-top:14px;}
  .mk-prix-champ input{width:130px; height:48px; padding:0 14px; border-radius:12px; border:1px solid var(--ct-trait-fort); background:rgba(255,255,255,.04); color:var(--ink); font:inherit; font-size:22px; font-weight:800; font-variant-numeric:tabular-nums; text-align:center;}
  .mk-prix-champ input:focus{outline:none; border-color:var(--ct-accent);}
  .mk-prix-champ .ct-btn-ico{width:48px; height:48px; font-size:22px; font-weight:700;}
  .mk-suggestions{display:flex; flex-wrap:wrap; gap:8px; margin-top:12px;}
  .mk-suggestions .ct-btn{min-height:32px; padding:0 12px; font-size:12.5px;}
  .mk-suggestions small{display:block; font-weight:500; color:var(--muted);}
  .mk-alerte{margin-top:12px; padding:10px 12px; border-radius:12px; font-size:13px; line-height:1.45; color:var(--ink-soft); background:rgba(242,193,78,.1); border:1px solid rgba(242,193,78,.3);}
  .mk-alerte.err{background:rgba(229,105,92,.1); border-color:rgba(229,105,92,.4); color:#f0a89f;}

  .mk-eq{padding-top:4px;}
  .mk-eq .ct-panneau{margin-top:16px;}
  .mk-eq-stats{display:grid; grid-template-columns:repeat(auto-fit, minmax(190px, 1fr)); gap:10px;}
  .mk-eq-champs{display:flex; flex-wrap:wrap; gap:12px; align-items:flex-end;}
  .mk-eq-champs label{display:grid; gap:6px; font-size:12px; font-weight:600; color:var(--muted);}
  .mk-eq-champs input, .mk-eq-champs select{height:40px; width:120px; padding:0 10px; border-radius:11px; border:1px solid var(--ct-trait-fort); background:rgba(255,255,255,.04); color:var(--ink); font:inherit; font-size:14px;}
  .mk-eq-champs input.large{width:220px;}
  .mk-eq table{width:100%; border-collapse:collapse; font-size:13.5px; margin-top:6px;}
  .mk-eq th{padding:8px 10px; text-align:left; font-size:11.5px; font-weight:600; letter-spacing:.1em; text-transform:uppercase; color:var(--muted); border-bottom:1px solid var(--ct-trait);}
  .mk-eq td{padding:9px 10px; border-bottom:1px solid var(--ct-trait); color:var(--ink-soft); vertical-align:middle;}
  .mk-eq td b{color:var(--ink);}
  .mk-eq td input{height:34px; width:86px; padding:0 8px; border-radius:9px; border:1px solid var(--ct-trait-fort); background:rgba(255,255,255,.04); color:var(--ink); font:inherit; font-size:13.5px;}
  .mk-eq .defile{overflow-x:auto;}

  @media (max-width:640px){
    .mk-grille{grid-template-columns:repeat(2, minmax(0, 1fr)); gap:22px 12px;}
    .mk-filtres .ct-recherche{flex-basis:100%;}
    .mk-filtres .ct-select, .mk-champ-prix, .mk-bascule{flex:1 1 calc(50% - 10px); width:auto; min-width:0; justify-content:center;}
    .mk-ligne{flex-wrap:wrap; gap:12px;}
    .mk-ligne .droite{width:100%; grid-auto-flow:column; justify-content:space-between; justify-items:start; align-items:center;}
    .mk-achat{grid-template-columns:1fr; justify-items:center;}
    .mk-achat .gauche{width:min(190px, 54vw);}
    .mk-achat .droite{width:100%;}
    .mk-prix-champ input{width:110px;}
    .mk-barre .ct-btn{flex:1;}
  }
  `;

  function poserCss(){
    if(document.getElementById('mk-style')) return;
    const s = document.createElement('style');
    s.id = 'mk-style';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  // ---------------------------------------------------------------------
  // L'onglet
  // ---------------------------------------------------------------------

  async function monter(hote, api){
    A = api;
    H = hote;
    poserCss();
    await reglages();

    hote.innerHTML = `
      <div class="mk">
        <div class="mk-barre">
          <div class="ct-segment" role="tablist" aria-label="Marché">
            ${[['vitrine', 'Vitrine'], ['annonces', 'Mes annonces'], ['ventes', 'Mes ventes']].map(([v, l]) => `<button type="button" data-mk-vue="${v}" role="tab">${l}</button>`).join('')}
          </div>
          <button type="button" class="ct-btn principal petit" data-mk-vendre>${A.ico('marche', 15)}Mettre en vente</button>
        </div>
        <div class="mk-corps"></div>
      </div>`;

    hote.querySelectorAll('[data-mk-vue]').forEach((b) => b.addEventListener('click', () => { ST.vue = b.dataset.mkVue; afficher(ST.vue); }));
    hote.querySelector('[data-mk-vendre]').addEventListener('click', () => choisirCarte());

    await afficher(ST.vue);
  }

  async function afficher(vue){
    if(!H) return;
    ST.vue = vue;
    H.querySelectorAll('[data-mk-vue]').forEach((b) => { const on = b.dataset.mkVue === vue; b.classList.toggle('actif', on); b.setAttribute('aria-selected', on); });
    const corps = H.querySelector('.mk-corps');
    if(!corps) return;
    if(!corps.children.length || !corps.querySelector('.mk-filtres, .mk-liste, .ct-titre-sec, .ct-panneau')) corps.innerHTML = '<div class="ct-vide">Chargement…</div>';
    try{
      if(vue === 'vitrine') await vueVitrine(corps);
      else if(vue === 'annonces') await vueAnnonces(corps);
      else await vueHistorique(corps);
    }catch(e){
      corps.innerHTML = `<div class="ct-panneau ct-vide"><b>Le marché ne répond pas</b>${A.esc(e.message)}</div>`;
    }
  }

  // ---------------------------------------------------------------------
  // La vitrine
  // ---------------------------------------------------------------------

  async function vueVitrine(corps){

    const f = ST.f;
    const bs = await collections();
    const r = await charger('marche_lister', {
      p_booster: f.booster || null, p_rarete: f.rarete ? Number(f.rarete) : null, p_holo: f.holo === '' ? null : f.holo === '1',
      p_prix_min: entier(f.pmin), p_prix_max: entier(f.pmax), p_q: f.q || null, p_manquantes: !!f.manq, p_tri: f.tri, p_page: f.page
    });
    const liste = r.annonces || [];
    const filtre = !!(f.q || f.booster || f.rarete || f.holo !== '' || f.pmin || f.pmax || f.manq);

    corps.innerHTML = `
      <div class="mk-filtres">
        <label class="ct-recherche">${A.ico('loupe', 17)}<input type="search" placeholder="Chercher un artiste" value="${A.esc(f.q)}" data-f="q" aria-label="Chercher un artiste"></label>
        <select class="ct-select" data-f="booster" aria-label="Collection"><option value="">Toutes les collections</option>${bs.map((b) => `<option value="${A.esc(b.id)}"${f.booster === b.id ? ' selected' : ''}>${A.esc(b.nom)}</option>`).join('')}</select>
        <select class="ct-select" data-f="rarete" aria-label="Rareté"><option value="">Toutes les raretés</option>${[1, 2, 3, 4, 5].map((n) => `<option value="${n}"${String(f.rarete) === String(n) ? ' selected' : ''}>${A.esc(nomRar(n))}</option>`).join('')}</select>
        <select class="ct-select" data-f="holo" aria-label="Type"><option value="">Normales et holos</option><option value="0"${f.holo === '0' ? ' selected' : ''}>Normales</option><option value="1"${f.holo === '1' ? ' selected' : ''}>Holos</option></select>
        <input class="mk-champ-prix" type="number" inputmode="numeric" min="1" placeholder="Prix min" value="${A.esc(f.pmin)}" data-f="pmin" aria-label="Prix minimum en vinyles">
        <input class="mk-champ-prix" type="number" inputmode="numeric" min="1" placeholder="Prix max" value="${A.esc(f.pmax)}" data-f="pmax" aria-label="Prix maximum en vinyles">
        <button type="button" class="mk-bascule${f.manq ? ' actif' : ''}" data-manq aria-pressed="${!!f.manq}">${A.ico('cartes', 15)}Ce qui me manque</button>
        <select class="ct-select" data-f="tri" aria-label="Trier">${[['recent', 'Plus récentes'], ['prix_asc', 'Prix croissant'], ['prix_desc', 'Prix décroissant'], ['rarete', 'Rareté'], ['fin', 'Bientôt terminées']].map(([v, l]) => `<option value="${v}"${f.tri === v ? ' selected' : ''}>${l}</option>`).join('')}</select>
      </div>
      ${liste.length
        ? `<p class="mk-compte">${A.pluriel(r.total, 'annonce')}${filtre ? ' pour ces filtres' : ' en vente'}</p>
           <div class="mk-grille">${liste.map((a, i) => tuile(a, i)).join('')}</div>
           ${r.pages > 1 ? `<div class="ct-pages"><button type="button" class="ct-btn petit" data-page="-1" ${f.page <= 1 ? 'disabled' : ''}>Précédente</button><span>Page ${r.page} sur ${r.pages}</span><button type="button" class="ct-btn petit" data-page="1" ${f.page >= r.pages ? 'disabled' : ''}>Suivante</button></div>` : ''}`
        : `<div class="ct-panneau ct-vide">${filtre
            ? '<b>Aucune annonce pour ces filtres</b>Élargis la recherche ou retire un filtre.'
            : '<b>Le marché est calme</b>Aucune carte n\'est en vente pour l\'instant. Sois le premier : mets une de tes cartes en vente.'}
           ${filtre ? '<div class="ct-actions" style="justify-content:center"><button type="button" class="ct-btn petit" data-reinit>Réinitialiser les filtres</button></div>' : ''}</div>`}`;

    let minuteur = null;
    corps.querySelectorAll('[data-f]').forEach((c) => {
      const k = c.dataset.f;
      const appliquer = () => { f[k] = c.value.trim(); f.page = 1; vueVitrine(corps).then(() => { const n = corps.querySelector(`[data-f="${k}"]`); if(n && (k === 'q' || k === 'pmin' || k === 'pmax')){ n.focus(); try{ n.setSelectionRange(n.value.length, n.value.length); }catch(e){} } }).catch(() => {}); };
      if(c.tagName === 'SELECT') c.addEventListener('change', appliquer);
      else c.addEventListener('input', () => { clearTimeout(minuteur); minuteur = setTimeout(appliquer, 380); });
    });
    corps.querySelector('[data-manq]').addEventListener('click', () => { f.manq = !f.manq; f.page = 1; vueVitrine(corps); });
    const ri = corps.querySelector('[data-reinit]');
    if(ri) ri.addEventListener('click', () => { Object.assign(f, { q: '', booster: '', rarete: '', holo: '', pmin: '', pmax: '', manq: false, page: 1 }); vueVitrine(corps); });
    corps.querySelectorAll('[data-page]').forEach((b) => b.addEventListener('click', () => {
      f.page = Math.max(1, f.page + Number(b.dataset.page));
      vueVitrine(corps).then(() => { const t = H && H.closest('.ct') && H.closest('.ct').querySelector('.ct-onglets'); if(t) t.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    }));
    corps.querySelectorAll('.mk-ann').forEach((b) => b.addEventListener('click', () => dialogueAchat(liste[Number(b.dataset.i)])));
  }

  function tuile(a, i){
    const c = a.carte, ind = a.indice || {};
    const etiquettes = [];
    if(a.moi) etiquettes.push('<span class="mk-tag moi">Ton annonce</span>');
    else if(!a.possede) etiquettes.push('<span class="mk-tag nouveau">Nouvelle pour toi</span>');
    else etiquettes.push(`<span class="mk-tag">Tu l'as ×${A.nf(a.possede)}</span>`);
    if(!a.moi && ind.mediane && a.prix < ind.mediane) etiquettes.push('<span class="mk-tag affaire">Bonne affaire</span>');
    return `
      <button type="button" class="mk-ann" data-i="${i}" aria-label="${A.esc(c.nom)}, ${A.esc(nomRar(c.rarete))}${c.holo ? ' holo' : ''}, ${A.nf(a.prix)} vinyles${a.moi ? ', ton annonce' : ''}">
        ${A.carteHtml(c, {})}
        <span class="mk-pied">${prix(a.prix)}<span class="mk-vendeur">${A.esc(a.vendeur)}</span></span>
        <span class="mk-etiquettes">${etiquettes.join('')}</span>
      </button>`;
  }

  // Acheter : une confirmation claire du solde, puis un geste.
  function dialogueAchat(a){
    const c = a.carte, ind = a.indice || {};
    const solde = Number(A.etat().vinyles || 0);
    const manque = Math.max(0, a.prix - solde);
    const f = A.fenetre(`
      <h2>${a.moi ? 'Ton annonce' : 'Acheter cette carte'}</h2>
      <div class="mk-achat">
        <div class="gauche">${A.carteHtml(c, { eager: true, vivante: true })}</div>
        <div class="droite">
          <h3>${A.esc(c.nom)}</h3>
          <div class="rar" style="--rc:${A.rar(c.rarete).c}">${A.esc(nomRar(c.rarete))}${c.holo ? ' · Holo' : ''}</div>
          <div style="margin-top:12px">${prix(a.prix, true)}</div>
          <p class="sous" style="margin-top:6px">Vendue par ${A.esc(a.vendeur)} · encore ${A.esc(reste(a.expire_le))}</p>
          <div class="mk-repere" style="margin-top:10px">
            ${ind.plancher ? `<span>Plus bas : <b>${A.nf(ind.plancher)}</b></span>` : ''}
            ${ind.mediane ? `<span>Médiane 30 j : <b>${A.nf(ind.mediane)}</b></span>` : '<span>Pas encore de vente</span>'}
            ${ind.derniere ? `<span>Dernière : <b>${A.nf(ind.derniere)}</b></span>` : ''}
          </div>
          ${a.moi ? '<div class="mk-alerte" style="margin-top:14px">C\'est ton annonce : tu peux l\'annuler depuis « Mes annonces ».</div>' : `
          <div class="mk-solde">
            <div><span>Ton solde</span><b>${A.nf(solde)} vinyles</b></div>
            <div><span>Prix</span><b>− ${A.nf(a.prix)}</b></div>
            <div class="${manque ? 'manque' : ''}"><span>${manque ? 'Il te manque' : 'Il te restera'}</span><b>${A.nf(manque || solde - a.prix)} vinyles</b></div>
          </div>
          ${a.possede ? `<p class="sous" style="margin-top:10px">Tu possèdes déjà cette carte (×${A.nf(a.possede)}).</p>` : ''}`}
          <div class="ct-actions">
            <button type="button" class="ct-btn" data-non>${a.moi ? 'Fermer' : 'Annuler'}</button>
            ${a.moi ? '' : `<button type="button" class="ct-btn principal" data-oui ${manque ? 'disabled' : ''}>${manque ? 'Pas assez de vinyles' : 'Acheter pour ' + A.nf(a.prix) + ' ' + A.ico('vinyle', 14)}</button>`}
          </div>
        </div>
      </div>`, false);
    f.corps.querySelector('[data-non]').addEventListener('click', f.fermer);
    const ok = f.corps.querySelector('[data-oui]');
    if(ok) ok.addEventListener('click', async () => {
      ok.disabled = true;
      try{
        const x = await A.appel('marche_acheter', { p_id: a.id });
        apresOperation(x.etat);
        A.Son.jouer('r' + c.rarete); A.vibre(25);
        A.toast(c.nom + ' rejoint ta collection');
        f.fermer();
        await rafraichir();
      }catch(e){
        A.toast(e.message, 'err');
        f.fermer();
        await rafraichir();
      }
    });
  }

  // ---------------------------------------------------------------------
  // Mes annonces
  // ---------------------------------------------------------------------

  const ETATS = { active: 'En vente', vendue: 'Vendue', annulee: 'Annulée', expiree: 'Expirée', retiree: 'Retirée' };

  async function vueAnnonces(corps){
    const r = await charger('marche_mes_annonces');
    const liste = r.annonces || [];
    const actives = liste.filter((a) => a.etat === 'active');
    const finies = liste.filter((a) => a.etat !== 'active');
    const max = REG && REG.max_annonces;

    const ligne = (a) => {
      const c = a.carte, ind = a.indice || {};
      return `
        <div class="mk-ligne">
          <div class="mk-mini">${A.carteHtml(c, {})}</div>
          <div class="tx">
            <b>${A.esc(c.nom)}</b>
            <span><span class="mk-tag etat-${a.etat}">${ETATS[a.etat] || a.etat}</span></span>
            <small>${A.esc(nomRar(c.rarete))}${c.holo ? ' · Holo' : ''} · ${a.etat === 'active' ? 'encore ' + A.esc(reste(a.expire_le)) : (a.etat === 'vendue' && a.acheteur ? 'à ' + A.esc(a.acheteur) + ' · ' : '') + A.esc(quand(a.ferme_le || a.cree_le))}</small>
            ${a.etat === 'active' ? `<div class="mk-repere">${ind.plancher ? `<span>Plus bas : <b>${A.nf(ind.plancher)}</b></span>` : ''}${ind.mediane ? `<span>Médiane : <b>${A.nf(ind.mediane)}</b></span>` : ''}</div>` : ''}
          </div>
          <div class="droite">
            ${prix(a.prix)}
            ${a.etat === 'vendue' ? `<span class="mk-net">Tu as touché ${A.nf(a.prix - commissionDe(a.prix))}</span>` : ''}
            ${a.etat === 'active' ? `<button type="button" class="ct-btn petit" data-annuler="${a.id}">Retirer de la vente</button>` : ''}
          </div>
        </div>`;
    };

    corps.innerHTML = `
      <div class="ct-titre-sec" style="margin-top:4px"><h3>En vente${max ? ` · ${actives.length} / ${max}` : ''}</h3></div>
      ${actives.length ? `<div class="mk-liste">${actives.map(ligne).join('')}</div>`
        : '<div class="ct-panneau ct-vide"><b>Rien en vente</b>Mets une carte en vente : elle quitte ta collection le temps de l\'annonce et te revient si elle ne trouve pas preneur.<div class="ct-actions" style="justify-content:center"><button type="button" class="ct-btn principal petit" data-vendre>Mettre en vente</button></div></div>'}
      ${finies.length ? `<div class="ct-titre-sec"><h3>Terminées · 30 derniers jours</h3></div><div class="mk-liste">${finies.map(ligne).join('')}</div>` : ''}`;

    corps.querySelectorAll('[data-annuler]').forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true;
      try{
        const x = await A.appel('marche_annuler', { p_id: Number(b.dataset.annuler) });
        apresOperation(x.etat);
        A.toast('Carte retirée de la vente : elle est revenue dans ta collection');
      }catch(e){ A.toast(e.message, 'err'); }
      await vueAnnonces(corps);
    }));
    const v = corps.querySelector('[data-vendre]');
    if(v) v.addEventListener('click', () => choisirCarte());
  }

  // ---------------------------------------------------------------------
  // Mes ventes et mes achats
  // ---------------------------------------------------------------------

  async function vueHistorique(corps){
    const h = ST.hist;
    const r = await charger('marche_historique', { p_sens: h.sens, p_page: h.page });
    const liste = r.ventes || [];
    const vente = r.sens === 'ventes';

    corps.innerHTML = `
      <div class="mk-filtres">
        <div class="ct-segment" role="group" aria-label="Historique">
          ${[['ventes', 'Mes ventes'], ['achats', 'Mes achats']].map(([v, l]) => `<button type="button" data-sens="${v}" class="${h.sens === v ? 'actif' : ''}" aria-pressed="${h.sens === v}">${l}</button>`).join('')}
        </div>
      </div>
      ${liste.length ? `<div class="mk-liste">${liste.map((x) => `
        <div class="mk-ligne">
          <div class="mk-mini">${A.carteHtml(x.carte, {})}</div>
          <div class="tx">
            <b>${A.esc(x.carte.nom)}</b>
            <small>${A.esc(nomRar(x.carte.rarete))}${x.carte.holo ? ' · Holo' : ''} · ${vente ? 'vendue à' : 'achetée à'} ${A.esc(x.autre)}</small>
            <small>${A.esc(quand(x.cree_le))}</small>
          </div>
          <div class="droite">
            ${prix(x.prix)}
            ${vente ? `<span class="mk-net">Tu as touché ${A.nf(x.net)} · commission ${A.nf(x.commission)}</span>` : ''}
          </div>
        </div>`).join('')}</div>
        ${r.pages > 1 ? `<div class="ct-pages"><button type="button" class="ct-btn petit" data-page="-1" ${h.page <= 1 ? 'disabled' : ''}>Précédente</button><span>Page ${r.page} sur ${r.pages}</span><button type="button" class="ct-btn petit" data-page="1" ${h.page >= r.pages ? 'disabled' : ''}>Suivante</button></div>` : ''}`
        : `<div class="ct-panneau ct-vide">${vente ? '<b>Aucune vente pour l\'instant</b>Tes ventes apparaîtront ici.' : '<b>Aucun achat pour l\'instant</b>Tes achats apparaîtront ici.'}</div>`}`;

    corps.querySelectorAll('[data-sens]').forEach((b) => b.addEventListener('click', () => { h.sens = b.dataset.sens; h.page = 1; vueHistorique(corps); }));
    corps.querySelectorAll('[data-page]').forEach((b) => b.addEventListener('click', () => { h.page = Math.max(1, h.page + Number(b.dataset.page)); vueHistorique(corps); }));
  }

  // ---------------------------------------------------------------------
  // Mettre en vente : choisir la carte, puis fixer le prix
  // ---------------------------------------------------------------------

  async function choisirCarte(){

    await reglages();
    const f = A.fenetre('', true);
    let zone = null;
    const poser = () => {
      f.corps.innerHTML = '<h2>Mettre en vente</h2><p class="sous">Choisis la carte à vendre. Elle quitte ta collection le temps de l\'annonce.</p><div class="mk-choix-zone"><div class="ct-vide">Chargement…</div></div>';
      zone = f.corps.querySelector('.mk-choix-zone');
    };
    poser();

    let cls = [];
    try{ cls = await A.appel('jeu_classeurs'); }catch(e){ cls = []; }
    if(!cls.length){ zone.innerHTML = '<div class="ct-vide"><b>Aucune collection</b>Ouvre des packs pour avoir des cartes à vendre.</div>'; return; }

    let id = (cls.find((c) => Number(c.possedees) > 0) || cls[0]).id;
    let q = '';
    const cache = {};

    async function cartesDe(b){
      if(cache[b]) return cache[b];
      let toutes = [];
      for(let page = 1; page <= 5; page++){
        const r = await A.appel('jeu_classeur_lire', { p_booster: b, p_page: page, p_vue: 'possedees', p_tri: 'nom' });
        toutes = toutes.concat(r.cartes || []);
        if(page >= (r.pages || 1)) break;
      }
      return (cache[b] = toutes);
    }

    async function dessiner(){
      let cartes = [];
      try{ cartes = await cartesDe(id); }catch(e){ zone.innerHTML = `<div class="ct-vide">${A.esc(e.message)}</div>`; return; }
      const n = q.trim().toLowerCase();
      const vues = n ? cartes.filter((c) => String(c.nom).toLowerCase().includes(n)) : cartes;
      zone.innerHTML = `
        <div class="mk-choix-tete">
          <div class="ct-segment" role="group" aria-label="Collection">${cls.map((c) => `<button type="button" data-cl="${A.esc(c.id)}" class="${c.id === id ? 'actif' : ''}" aria-pressed="${c.id === id}">${A.esc(c.nom)}</button>`).join('')}</div>
          <label class="ct-recherche">${A.ico('loupe', 17)}<input type="search" placeholder="Chercher dans mes cartes" value="${A.esc(q)}" data-q aria-label="Chercher dans mes cartes"></label>
        </div>
        ${vues.length
          ? `<div class="mk-choix-grille">${vues.map((c, i) => `<button type="button" class="mk-choix" data-i="${i}" aria-label="${A.esc(c.nom)}, ${A.esc(nomRar(c.rarete))}, ×${c.quantite}">${A.carteHtml(c, {})}<span class="mk-qte">×${c.quantite}</span></button>`).join('')}</div>`
          : `<div class="ct-vide">${cartes.length ? '<b>Aucune carte ne correspond</b>Essaie un autre nom.' : '<b>Tu n\'as encore aucune carte ici</b>Ouvre des packs de cette collection.'}</div>`}`;
      zone.querySelectorAll('[data-cl]').forEach((b) => b.addEventListener('click', () => { id = b.dataset.cl; q = ''; dessiner(); }));
      const champ = zone.querySelector('[data-q]');
      champ.addEventListener('input', () => { q = champ.value; clearTimeout(dessiner.t); dessiner.t = setTimeout(() => { dessiner().then(() => { const c2 = zone.querySelector('[data-q]'); if(c2){ c2.focus(); c2.setSelectionRange(c2.value.length, c2.value.length); } }); }, 250); });
      zone.querySelectorAll('.mk-choix').forEach((b) => b.addEventListener('click', () => etapePrix(f, vues[Number(b.dataset.i)], () => { poser(); dessiner(); })));
    }

    await dessiner();
  }

  // `retour` : comment revenir au choix de la carte (absent quand on vient de la fiche d'une carte).
  async function etapePrix(f, c, retour){

    await reglages();
    const normales = Number(c.normales || 0), holos = Number(c.holos || 0);
    let holo = normales > 0 ? false : holos > 0;
    const commission = Number((REG && REG.commission_pct) || 0);
    const duree = Number((REG && REG.duree_jours) || 7);
    let ind = null;

    function qte(){ return holo ? holos : normales; }

    async function chargerIndice(){
      try{ ind = await A.appel('marche_indice', { p_booster: c.classeur, p_artist: c.id, p_holo: holo }); }catch(e){ ind = null; }
    }

    function suggere(){
      if(!ind) return 1;
      const base = ind.mediane || ind.plancher || ind.derniere || [2, 3, 6, 15, 40][Math.min(Math.max(Number(c.rarete) || 1, 1), 5) - 1] * (holo ? 2 : 1);
      return Math.min(ind.prix_max, Math.max(ind.prix_min, base));
    }

    async function dessiner(valeur){
      await chargerIndice();
      const p0 = valeur !== undefined ? valeur : suggere();
      const chips = ind ? [
        ind.plancher ? ['Plus bas en vente', ind.plancher] : null,
        ind.mediane ? ['Médiane 30 j', ind.mediane] : null,
        ind.derniere ? ['Dernière vente', ind.derniere] : null
      ].filter(Boolean) : [];

      f.corps.innerHTML = `
        <h2>Fixer le prix</h2>
        <div class="mk-achat">
          <div class="gauche">${A.carteHtml(Object.assign({}, c, { holo }), { eager: true })}</div>
          <div class="droite">
            <h3>${A.esc(c.nom)}</h3>
            <div class="rar" style="--rc:${A.rar(c.rarete).c}">${A.esc(nomRar(c.rarete))}${holo ? ' · Holo' : ''}</div>
            ${normales > 0 && holos > 0 ? `<div class="ct-segment" style="margin-top:12px" role="group" aria-label="Version">
              <button type="button" data-v="0" class="${!holo ? 'actif' : ''}" aria-pressed="${!holo}">Normale ×${normales}</button>
              <button type="button" data-v="1" class="${holo ? 'actif' : ''}" aria-pressed="${holo}">Holo ×${holos}</button></div>` : `<p class="sous">Tu en as ×${qte()}.</p>`}
            <div class="mk-prix-champ">
              <button type="button" class="ct-btn-ico" data-pas="-1" aria-label="Moins">−</button>
              <input type="number" inputmode="numeric" min="${ind ? ind.prix_min : 1}" max="${ind ? ind.prix_max : ''}" step="1" value="${p0}" data-p aria-label="Prix en vinyles">
              <button type="button" class="ct-btn-ico" data-pas="1" aria-label="Plus">+</button>
              <span class="mk-prix">${A.ico('vinyle', 18)}</span>
            </div>
            ${ind ? `<p class="sous" style="margin-top:8px">Entre ${A.nf(ind.prix_min)} et ${A.nf(ind.prix_max)} vinyles pour cette carte.</p>` : ''}
            <div class="mk-suggestions">${chips.length
              ? chips.map(([l, v]) => `<button type="button" class="ct-btn" data-sug="${v}">${A.nf(v)}<small>${l}</small></button>`).join('')
              : '<small style="color:var(--muted)">Pas encore de vente pour cette carte : le prix est libre dans les bornes.</small>'}</div>
            <div class="mk-solde">
              <div><span>Prix affiché</span><b data-aff></b></div>
              <div><span>Commission du marché (${String(commission).replace('.', ',')} %)</span><b data-com></b></div>
              <div><span>Tu touches</span><b data-net></b></div>
            </div>
            <div data-msg></div>
            ${qte() === 1 ? '<div class="mk-alerte">C\'est ton dernier exemplaire : il quitte ta collection tant que l\'annonce dure (' + duree + ' jours au plus).</div>' : `<p class="sous" style="margin-top:10px">L'annonce dure ${duree} jours ; sans acheteur, la carte te revient.</p>`}
            <div class="ct-actions">
              <button type="button" class="ct-btn" data-retour>${retour ? 'Retour' : 'Annuler'}</button>
              <button type="button" class="ct-btn principal" data-oui>Mettre en vente</button>
            </div>
          </div>
        </div>`;

      const champ = f.corps.querySelector('[data-p]');
      const ok = f.corps.querySelector('[data-oui]');
      const maj = () => {
        const p = entier(champ.value);
        const bon = ind && p !== null && p >= ind.prix_min && p <= ind.prix_max;
        const com = p ? Math.round(p * commission / 100) : 0;
        f.corps.querySelector('[data-aff]').textContent = p ? A.nf(p) + ' vinyles' : '—';
        f.corps.querySelector('[data-com]').textContent = p ? '− ' + A.nf(com) : '—';
        f.corps.querySelector('[data-net]').textContent = p ? A.nf(p - com) + ' vinyles' : '—';
        f.corps.querySelector('[data-msg]').innerHTML = !bon && ind ? `<div class="mk-alerte err">Le prix doit être entre ${A.nf(ind.prix_min)} et ${A.nf(ind.prix_max)} vinyles.</div>` : '';
        ok.disabled = !bon;
      };
      champ.addEventListener('input', maj);
      champ.addEventListener('keydown', (ev) => { if(ev.key === 'Enter' && !ok.disabled) ok.click(); });
      f.corps.querySelectorAll('[data-pas]').forEach((b) => b.addEventListener('click', () => { champ.value = Math.max(1, (entier(champ.value) || 0) + Number(b.dataset.pas)); maj(); }));
      f.corps.querySelectorAll('[data-sug]').forEach((b) => b.addEventListener('click', () => { champ.value = b.dataset.sug; maj(); }));
      f.corps.querySelectorAll('[data-v]').forEach((b) => b.addEventListener('click', () => { holo = b.dataset.v === '1'; dessiner(); }));
      f.corps.querySelector('[data-retour]').addEventListener('click', () => { if(retour) retour(); else f.fermer(); });
      maj();
      ok.addEventListener('click', async () => {
        const p = entier(champ.value);
        ok.disabled = true;
        try{
          const x = await A.appel('marche_mettre_en_vente', { p_booster: c.classeur, p_artist: c.id, p_holo: holo, p_prix: p });
          apresOperation(x.etat);
          A.Son.jouer('gain'); A.vibre(20);
          A.toast(c.nom + ' est en vente pour ' + A.nf(p) + ' vinyles');
          document.querySelectorAll('.ct-voile .ct-fermer').forEach((b) => b.click());
          if(H && H.isConnected) ST.vue = 'annonces';
          await rafraichir();
        }catch(e){ A.toast(e.message, 'err'); ok.disabled = false; }
      });
    }

    await dessiner();
  }

  // Depuis la fiche d'une carte : on arrive directement au prix.
  async function vendre(carte, api){
    A = api;
    poserCss();
    await reglages();
    if(REG && REG.suspendu){ A.toast('Tu es suspendu du marché.', 'err'); return; }
    if(!carte || !carte.classeur){ A.toast('Seules les cartes de collection se vendent.', 'err'); return; }
    const f = A.fenetre('<div class="ct-vide">Chargement…</div>', false);
    await etapePrix(f, carte, null);
  }

  // ---------------------------------------------------------------------
  // L'équipe : modération simple
  // ---------------------------------------------------------------------

  async function equipe(hote, api){
    A = api;
    poserCss();
    hote.innerHTML = '<div class="ct mk-eq"><div class="ct-vide">Chargement…</div></div>';
    const racine = hote.querySelector('.mk-eq');
    await dessinerEquipe(racine);
  }

  async function dessinerEquipe(racine){

    let ap;
    try{ ap = await A.appel('marche_equipe_apercu'); }
    catch(e){ racine.innerHTML = `<div class="ct-panneau ct-vide"><b>Le marché ne répond pas</b>${A.esc(e.message)}</div>`; return; }

    const rg = ap.reglages || {};
    const bornes = ap.bornes || [];
    const stat = (n, l) => `<div class="ct-stat"><b>${n}</b><span>${l}</span></div>`;

    racine.innerHTML = `
      <div class="mk-eq-stats">
        ${stat(A.nf(ap.actives), 'annonces en cours · ' + A.nf(ap.valeur_actives) + ' vinyles')}
        ${stat(A.nf(ap.jour.ventes), 'ventes sur 24 h · ' + A.nf(ap.jour.vinyles) + ' vinyles')}
        ${stat(A.nf(ap.semaine.ventes), 'ventes sur 7 jours · ' + A.nf(ap.semaine.vinyles) + ' vinyles')}
        ${stat(A.nf(ap.semaine.commission), 'vinyles détruits en commission (7 j)')}
      </div>

      <section class="ct-panneau">
        <div class="ct-entete-panneau"><div><h3>Règles du marché</h3><p class="sous">Commission détruite à chaque vente, durée des annonces, plafond par joueur.</p></div></div>
        <div class="mk-eq-champs">
          <label>Commission (%)<input type="number" min="0" max="50" step="0.5" value="${A.esc(rg.commission_pct)}" data-rg="commission"></label>
          <label>Durée d'une annonce (jours)<input type="number" min="1" max="60" step="1" value="${A.esc(rg.duree_jours)}" data-rg="duree"></label>
          <label>Annonces par joueur<input type="number" min="1" max="100" step="1" value="${A.esc(rg.max_annonces)}" data-rg="max"></label>
          <button type="button" class="ct-btn principal" data-enreg-rg>Enregistrer</button>
        </div>
        <div class="ct-titre-sec" style="margin:22px 0 4px"><h3>Bornes de prix par rareté (vinyles)</h3></div>
        <p class="sous" style="margin:0 0 6px">Une carte holo peut se vendre jusqu'à trois fois le maximum.</p>
        <div class="defile"><table>
          <thead><tr><th>Rareté</th><th>Minimum</th><th>Maximum</th><th></th></tr></thead>
          <tbody>${bornes.map((b) => `<tr><td><b style="color:${A.rar(b.rarete).c}">${A.esc(nomRar(b.rarete))}</b></td>
            <td><input type="number" min="1" step="1" value="${b.prix_min}" data-bmin="${b.rarete}" aria-label="Minimum ${A.esc(nomRar(b.rarete))}"></td>
            <td><input type="number" min="1" step="1" value="${b.prix_max}" data-bmax="${b.rarete}" aria-label="Maximum ${A.esc(nomRar(b.rarete))}"></td>
            <td><button type="button" class="ct-btn petit" data-borne="${b.rarete}">Enregistrer</button></td></tr>`).join('')}</tbody>
        </table></div>
      </section>

      <section class="ct-panneau">
        <div class="ct-entete-panneau"><div><h3>Annonces en cours</h3><p class="sous">Retirer une annonce rend la carte à son vendeur.</p></div></div>
        <div class="mk-filtres"><label class="ct-recherche">${A.ico('loupe', 17)}<input type="search" placeholder="Artiste ou vendeur" data-eq-q aria-label="Chercher une annonce"></label></div>
        <div data-eq-annonces><div class="ct-vide">Chargement…</div></div>
      </section>

      <section class="ct-panneau">
        <div class="ct-entete-panneau"><div><h3>Journal du marché</h3><p class="sous">Toutes les opérations, jamais effacées.</p></div></div>
        <div class="mk-filtres">
          <select class="ct-select" data-j-type aria-label="Type d'opération"><option value="">Toutes les opérations</option>
            ${[['vente', 'Ventes'], ['mise_en_vente', 'Mises en vente'], ['annulation', 'Annulations'], ['expiration', 'Expirations'], ['retrait_equipe', 'Retraits de l\'équipe']].map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
          <label class="ct-recherche">${A.ico('loupe', 17)}<input type="search" placeholder="Artiste ou joueur" data-j-q aria-label="Chercher dans le journal"></label>
        </div>
        <div data-eq-journal><div class="ct-vide">Chargement…</div></div>
      </section>

      <section class="ct-panneau">
        <div class="ct-entete-panneau"><div><h3>Joueurs suspendus du marché</h3><p class="sous">Un joueur suspendu ne peut ni vendre ni acheter ; ses annonces en cours sont retirées et ses cartes lui reviennent.</p></div></div>
        ${(ap.suspendus || []).length ? `<div class="mk-liste" style="margin-bottom:14px">${ap.suspendus.map((s) => `
          <div class="mk-ligne"><div class="tx"><b>${A.esc(s.pseudo)}</b><small>${A.esc(s.motif || 'Sans motif')} · depuis le ${A.esc(quand(s.cree_le))}</small></div>
          <div class="droite"><button type="button" class="ct-btn petit" data-reint="${A.esc(s.user_id)}">Réintégrer</button></div></div>`).join('')}</div>` : '<p class="sous" style="margin-bottom:14px">Personne n\'est suspendu.</p>'}
        <div class="mk-eq-champs">
          <label>Pseudo<input class="large" type="text" maxlength="60" data-s-pseudo placeholder="Pseudo exact"></label>
          <label>Motif<input class="large" type="text" maxlength="300" data-s-motif placeholder="Facultatif"></label>
          <button type="button" class="ct-btn" data-suspendre>Suspendre</button>
        </div>
      </section>`;

    const action = async (bouton, fn, ok) => {
      bouton.disabled = true;
      try{ await fn(); A.toast(ok); await dessinerEquipe(racine); }
      catch(e){ A.toast(e.message, 'err'); bouton.disabled = false; }
    };
    const val = (s) => racine.querySelector(s).value;

    racine.querySelector('[data-enreg-rg]').addEventListener('click', (ev) => action(ev.currentTarget,
      () => A.appel('marche_equipe_regler', { p_commission: Number(val('[data-rg="commission"]')), p_duree: entier(val('[data-rg="duree"]')), p_max: entier(val('[data-rg="max"]')) }), 'Règles enregistrées'));
    racine.querySelectorAll('[data-borne]').forEach((b) => b.addEventListener('click', () => action(b,
      () => A.appel('marche_equipe_borne', { p_rarete: Number(b.dataset.borne), p_min: entier(val(`[data-bmin="${b.dataset.borne}"]`)), p_max: entier(val(`[data-bmax="${b.dataset.borne}"]`)) }), 'Bornes enregistrées')));
    racine.querySelectorAll('[data-reint]').forEach((b) => b.addEventListener('click', () => action(b, () => A.appel('marche_equipe_reintegrer', { p_user: b.dataset.reint }), 'Joueur réintégré')));
    racine.querySelector('[data-suspendre]').addEventListener('click', (ev) => {
      const pseudo = val('[data-s-pseudo]').trim();
      if(!pseudo){ A.toast('Écris le pseudo du joueur.', 'err'); return; }
      action(ev.currentTarget, () => A.appel('marche_equipe_suspendre', { p_pseudo: pseudo, p_motif: val('[data-s-motif]').trim() || null }), pseudo + ' est suspendu du marché');
    });

    // Les annonces en cours.
    const ea = { q: '', page: 1 };
    const zoneA = racine.querySelector('[data-eq-annonces]');
    async function annonces(){
      try{
        const r = await A.appel('marche_equipe_annonces', { p_q: ea.q || null, p_page: ea.page });
        zoneA.innerHTML = r.annonces.length ? `<div class="mk-liste">${r.annonces.map((a) => `
          <div class="mk-ligne">
            <div class="mk-mini">${A.carteHtml(a.carte, {})}</div>
            <div class="tx"><b>${A.esc(a.carte.nom)}</b><small>${A.esc(nomRar(a.carte.rarete))}${a.carte.holo ? ' · Holo' : ''} · par ${A.esc(a.vendeur)}</small><small>encore ${A.esc(reste(a.expire_le))}</small></div>
            <div class="droite">${prix(a.prix)}<button type="button" class="ct-btn petit" data-retirer="${a.id}">Retirer</button></div>
          </div>`).join('')}</div>${pagination(r)}` : '<div class="ct-vide">Aucune annonce en cours.</div>';
        zoneA.querySelectorAll('[data-retirer]').forEach((b) => b.addEventListener('click', () => confirmerRetrait(Number(b.dataset.retirer), annonces, racine)));
        zoneA.querySelectorAll('[data-page]').forEach((b) => b.addEventListener('click', () => { ea.page = Math.max(1, ea.page + Number(b.dataset.page)); annonces(); }));
      }catch(e){ zoneA.innerHTML = `<div class="ct-vide">${A.esc(e.message)}</div>`; }
    }
    let ta = null;
    racine.querySelector('[data-eq-q]').addEventListener('input', (ev) => { clearTimeout(ta); ta = setTimeout(() => { ea.q = ev.target.value.trim(); ea.page = 1; annonces(); }, 350); });
    annonces();

    // Le journal.
    const ej = { type: '', q: '', page: 1 };
    const zoneJ = racine.querySelector('[data-eq-journal]');
    const LIBELLES = { vente: 'Vente', mise_en_vente: 'Mise en vente', annulation: 'Annulation', expiration: 'Expiration', retrait_equipe: 'Retrait équipe' };
    async function journal(){
      try{
        const r = await A.appel('marche_equipe_journal', { p_type: ej.type || null, p_q: ej.q || null, p_page: ej.page });
        zoneJ.innerHTML = r.lignes.length ? `<div class="defile"><table>
          <thead><tr><th>Quand</th><th>Opération</th><th>Carte</th><th>Vendeur</th><th>Acheteur</th><th>Prix</th></tr></thead>
          <tbody>${r.lignes.map((l) => `<tr><td>${A.esc(quand(l.cree_le))}</td><td><b>${A.esc(LIBELLES[l.type] || l.type)}</b>${l.note ? `<br><small>${A.esc(l.note)}</small>` : ''}</td>
            <td>${A.esc(l.nom)}${l.holo ? ' · holo' : ''}${l.rarete ? ' · ' + A.esc(nomRar(l.rarete)) : ''}</td><td>${A.esc(l.vendeur || '—')}</td><td>${A.esc(l.acheteur || '—')}</td>
            <td>${l.prix ? A.nf(l.prix) + (l.commission ? ' <small>(com. ' + A.nf(l.commission) + ')</small>' : '') : '—'}</td></tr>`).join('')}</tbody></table></div>${pagination(r)}` : '<div class="ct-vide">Rien dans le journal pour ces filtres.</div>';
        zoneJ.querySelectorAll('[data-page]').forEach((b) => b.addEventListener('click', () => { ej.page = Math.max(1, ej.page + Number(b.dataset.page)); journal(); }));
      }catch(e){ zoneJ.innerHTML = `<div class="ct-vide">${A.esc(e.message)}</div>`; }
    }
    racine.querySelector('[data-j-type]').addEventListener('change', (ev) => { ej.type = ev.target.value; ej.page = 1; journal(); });
    let tj = null;
    racine.querySelector('[data-j-q]').addEventListener('input', (ev) => { clearTimeout(tj); tj = setTimeout(() => { ej.q = ev.target.value.trim(); ej.page = 1; journal(); }, 350); });
    journal();
  }

  const pagination = (r) => r.pages > 1
    ? `<div class="ct-pages"><button type="button" class="ct-btn petit" data-page="-1" ${r.page <= 1 ? 'disabled' : ''}>Précédente</button><span>Page ${r.page} sur ${r.pages}</span><button type="button" class="ct-btn petit" data-page="1" ${r.page >= r.pages ? 'disabled' : ''}>Suivante</button></div>`
    : '';

  function confirmerRetrait(id, recharger, racine){
    const f = A.fenetre(`
      <h2>Retirer cette annonce ?</h2>
      <p class="sous">La carte retourne dans la collection de son vendeur. L'opération est inscrite au journal.</p>
      <div class="mk-eq-champs" style="margin-top:14px"><label style="width:100%">Motif (facultatif)<input class="large" style="width:100%" type="text" maxlength="300" data-motif></label></div>
      <div class="ct-actions" style="justify-content:flex-end"><button type="button" class="ct-btn" data-non>Annuler</button><button type="button" class="ct-btn principal" data-oui>Retirer</button></div>`);
    f.corps.querySelector('[data-non]').addEventListener('click', f.fermer);
    const ok = f.corps.querySelector('[data-oui]');
    ok.addEventListener('click', async () => {
      ok.disabled = true;
      try{
        await A.appel('marche_equipe_retirer', { p_id: id, p_motif: f.corps.querySelector('[data-motif]').value.trim() || null });
        A.toast('Annonce retirée, carte rendue');
        f.fermer();
        await dessinerEquipe(racine);
      }catch(e){ A.toast(e.message, 'err'); ok.disabled = false; }
    });
  }

  window.WaveMarche = {
    monter,
    quitter(){ H = null; },
    equipe,
    vendre
  };

})();
