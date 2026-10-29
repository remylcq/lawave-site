/* =====================================================================
   La Wave — Wave Cards : la console de l'équipe

   Chargé à la demande par Cartes.equipe(hote) (cartes.js), appelé par l'onglet « Wave Cards » de l'espace équipe
   (index.html, switchAdminTab). Six sections, chacune simple :

     Vue d'ensemble   chiffres clés, collections, activité récente
     Collections      créer / modifier / dupliquer / archiver un booster (visuel, taux, dates…)
     Cartes           les artistes d'une collection : rareté en un clic, ajout, renumérotation, aperçu
     Joueurs          vinyles, cartes offertes, journal
     Combat, Marché   panneaux fournis par combat.js et marche.js (WaveCombat.equipe, WaveMarche.equipe)

   Tout passe par les RPC jeu_equipe_* (sql/equipe-wave-cards.sql), gardées côté base par est_equipe() ; chaque
   geste laisse une ligne dans le journal d'équipe. L'interface partagée du jeu (window.Cartes.api) fournit les
   aides communes (appel, fenetre, toast, carteHtml…).
   ===================================================================== */

(function(){

  'use strict';

  let api = null;

  const E = {
    root: null, main: null, section: 'ensemble',
    boosters: [],
    col: null, form: null, orig: null,             // Collections : id en cours de modification (« + » = nouvelle)
    cid: null, cartes: [], filtre: '', rareteFiltre: null, sel: new Set(),   // Cartes
    joueurQ: '', joueur: null, cacheCartes: {}     // Joueurs
  };

  // ---------------------------------------------------------------------
  // Petites aides
  // ---------------------------------------------------------------------

  const esc = (t) => api.esc(t);
  const nf = (n) => api.nf(n);
  const rar = (r) => api.rar(r);
  const $ = (sel, racine) => (racine || E.root).querySelector(sel);
  const $$ = (sel, racine) => [...(racine || E.root).querySelectorAll(sel)];
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const slug = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

  const ICONES = {
    haut: '<path d="m6 15 6-6 6 6"/>', bas: '<path d="m6 9 6 6 6-6"/>', plus: '<path d="M12 5v14M5 12h14"/>',
    corbeille: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    oeil: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    copie: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>',
    televerser: '<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>', fleche: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
    baguette: '<path d="M4 20 15 9M14 4l1.5 3L19 8.5 15.5 10 14 13l-1.5-3L9 8.5 12.5 7z"/>', coche: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    cartes: '<rect x="3" y="5" width="12" height="16" rx="2"/><path d="M8 3h11a2 2 0 0 1 2 2v13"/>',
    pack: '<path d="M4 8 12 4l8 4v8l-8 4-8-4z"/><path d="M4 8l8 4 8-4M12 12v8"/>',
    joueurs: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M16 5.2a3 3 0 0 1 0 5.6M21 20c0-2.6-1.6-4.8-4-5.6"/>',
    ensemble: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>', croix: '<path d="M6 6l12 12M18 6 6 18"/>'
  };
  const ic = (n, t) => `<svg class="ee-ico" width="${t || 16}" height="${t || 16}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONES[n] || ''}</svg>`;

  // Un appel à la base : l'erreur (écrite en français dans le SQL) s'affiche telle quelle.
  async function rpc(nom, args){
    try{ return await api.appel(nom, args); }
    catch(e){ api.toast(e.message || String(e), 'err'); throw e; }
  }

  // Une confirmation avant un geste destructeur.
  function confirmer(titre, texte, oui){
    return new Promise((fin) => {
      let fait = false;
      const f = api.fenetre(`
        <h2>${esc(titre)}</h2>
        <p class="sous">${texte}</p>
        <div class="ct-actions" style="justify-content:flex-end; margin-top:18px"><button type="button" class="ct-btn" data-non>Annuler</button><button type="button" class="ct-btn principal" data-oui>${esc(oui || 'Confirmer')}</button></div>`, false, () => fin(fait));
      f.corps.querySelector('[data-non]').addEventListener('click', f.fermer);
      f.corps.querySelector('[data-oui]').addEventListener('click', () => { fait = true; f.fermer(); });
    });
  }

  // Un message en bas d'écran, avec « Annuler » quand le geste peut se défaire.
  function snack(texte, annuler){
    const ancien = document.querySelector('.ee-snack');
    if(ancien) ancien.remove();
    const s = document.createElement('div');
    s.className = 'ee-snack';
    s.setAttribute('role', 'status');
    s.innerHTML = `<span>${esc(texte)}</span>${annuler ? '<button type="button">Annuler</button>' : ''}`;
    document.body.appendChild(s);
    const fin = setTimeout(() => s.remove(), 9000);
    if(annuler) s.querySelector('button').addEventListener('click', () => { clearTimeout(fin); s.remove(); annuler(); });
  }

  const pts = (sel, attrs) => `<span class="ee-pts" role="group" aria-label="Rareté">${[1, 2, 3, 4, 5].map(r =>
    `<button type="button" class="ee-pt${Number(sel) === r ? ' on' : ''}" style="--rc:${rar(r).c}" data-r="${r}" ${attrs || ''} aria-label="${esc(rar(r).nom)}" aria-pressed="${Number(sel) === r}" title="${esc(rar(r).nom)}"></button>`).join('')}</span>`;

  const quand = (iso) => {
    const t = new Date(iso), s = (Date.now() - t) / 1000;
    if(s < 60) return 'à l\'instant';
    if(s < 3600) return 'il y a ' + Math.floor(s / 60) + ' min';
    if(s < 86400) return 'il y a ' + Math.floor(s / 3600) + ' h';
    return t.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  };

  const nomCol = (id) => { const b = E.boosters.find(x => x.id === id); return b ? b.nom : id; };

  function phrase(j){
    const d = j.detail || {}, cible = j.cible ? `<b>${esc(j.cible)}</b>` : 'un joueur', col = `<b>${esc(d.nom || nomCol(d.booster))}</b>`;
    switch(j.action){
      case 'collection_creee': return 'a créé la collection ' + col;
      case 'collection_modifiee': return 'a modifié la collection ' + col;
      case 'collection_dupliquee': return `a dupliqué <b>${esc(nomCol(d.depuis))}</b> en <b>${esc(d.booster)}</b>`;
      case 'collection_supprimee': return 'a supprimé la collection ' + col;
      case 'cartes_ajoutees': return `a ajouté ${d.nb} carte${d.nb > 1 ? 's' : ''} à <b>${esc(nomCol(d.booster))}</b>`;
      case 'cartes_retirees': return `a retiré ${d.nb} carte${d.nb > 1 ? 's' : ''} de <b>${esc(nomCol(d.booster))}</b>`;
      case 'raretes_changees': return `a changé la rareté de ${d.nb} carte${d.nb > 1 ? 's' : ''} (<b>${esc(nomCol(d.booster))}</b>)`;
      case 'cartes_renumerotees': return 'a renuméroté <b>' + esc(nomCol(d.booster)) + '</b>';
      case 'vinyles_donnes': return `a donné ${nf(d.delta)} vinyle${d.delta > 1 ? 's' : ''} à ${cible}`;
      case 'vinyles_retires': return `a retiré ${nf(-d.delta)} vinyle${d.delta < -1 ? 's' : ''} à ${cible}`;
      case 'carte_offerte': return `a offert ${d.quantite} carte${d.quantite > 1 ? 's' : ''} à ${cible}`;
      case 'carte_retiree': return `a retiré ${-d.quantite} carte${d.quantite < -1 ? 's' : ''} à ${cible}`;
      default: return esc(j.action);
    }
  }

  const ligneJournal = (j) => `<li><span class="ee-j-qui">${esc(j.auteur || 'L\'équipe')}</span> ${phrase(j)}<time>${esc(quand(j.cree_le))}</time></li>`;

  const vide = (titre, texte) => `<div class="ct-panneau ct-vide"><b>${esc(titre)}</b>${esc(texte || '')}</div>`;
  const tete = (titre, texte, droite) => `<header class="ee-tete"><div><h2>${esc(titre)}</h2>${texte ? `<p>${esc(texte)}</p>` : ''}</div>${droite || ''}</header>`;

  const miniature = (b) => api.visuelOk(b.visuel)
    ? `<img src="${esc(b.visuel)}" alt="" loading="lazy" decoding="async">`
    : `<span class="vide">${api.EMBLEMES[api.theme(b.theme)]}</span>`;

  const barreRaretes = (raretes) => {
    const tot = (raretes || []).reduce((a, b) => a + Number(b), 0) || 1;
    return `<div class="ee-barre" aria-hidden="true">${(raretes || []).map((n, i) => n ? `<i style="flex:${n}; background:${rar(i + 1).c}" title="${esc(rar(i + 1).nom)} : ${n}"></i>` : '').join('')}</div>`;
  };

  // ---------------------------------------------------------------------
  // La coquille et la navigation
  // ---------------------------------------------------------------------

  const SECTIONS = [
    ['ensemble', 'Vue d\'ensemble', 'ensemble'], ['collections', 'Collections', 'pack'], ['cartes', 'Cartes', 'cartes'],
    ['joueurs', 'Joueurs', 'joueurs'], ['combat', 'Combat', null], ['marche', 'Marché', null], ['quotidien', 'Quotidien', null], ['sons', 'Sons', null]
  ];

  async function monter(hote, a){
    api = a;
    poserStyle();
    E.root = document.createElement('div');
    E.root.className = 'ct ee';
    E.root.innerHTML = `
      <nav class="ee-nav" role="tablist" aria-label="Wave Cards, équipe">${SECTIONS.map(([id, nom, icone]) =>
        `<button type="button" role="tab" data-act="section" data-id="${id}" class="${id === E.section ? 'actif' : ''}" aria-selected="${id === E.section}">${icone ? ic(icone, 17) : api.ico({ combat: 'combat', quotidien: 'calendrier', sons: 'son' }[id] || 'marche', 17)}<span>${esc(nom)}</span></button>`).join('')}</nav>
      <div class="ee-main" data-main><div class="ct-vide">Chargement…</div></div>`;
    hote.innerHTML = '';
    hote.appendChild(E.root);
    E.main = $('[data-main]');
    E.root.addEventListener('click', clic);
    E.root.addEventListener('input', saisie);
    E.root.addEventListener('change', saisie);
    await rendre();
  }

  async function rendre(){
    $$('.ee-nav button').forEach((b) => { const on = b.dataset.id === E.section; b.classList.toggle('actif', on); b.setAttribute('aria-selected', String(on)); });
    E.main.innerHTML = '<div class="ct-vide">Chargement…</div>';
    try{
      if(!E.boosters.length || E.section !== 'collections') await chargerBoosters();
      if(E.section === 'ensemble') await sEnsemble();
      else if(E.section === 'collections') await sCollections();
      else if(E.section === 'cartes') await sCartes();
      else if(E.section === 'joueurs') await sJoueurs();
      else if(E.section === 'combat') await sModule('combat', 'WaveCombat', 'Combat', 'Types, statistiques et attaques des cartes.');
      else if(E.section === 'sons') await sSons();
      else if(E.section === 'quotidien') await sModule('accueil', 'WaveAccueil', 'Quotidien', 'Événements à durée limitée et nouveautés du jeu.');
      else await sModule('marche', 'WaveMarche', 'Marché', 'Annonces, prix et ventes entre joueurs.');
    }catch(e){
      E.main.innerHTML = vide('Impossible d\'afficher cette section', e.message || String(e));
    }
  }

  async function chargerBoosters(){
    E.boosters = await api.appel('jeu_equipe_boosters');
  }

  function aller(section, extra){
    E.section = section;
    if(extra) Object.assign(E, extra);
    return rendre();
  }

  // ---------------------------------------------------------------------
  // Les gestes (data-act) : un seul écouteur pour toute la console
  // ---------------------------------------------------------------------

  function clic(ev){
    const el = ev.target.closest('[data-act]');
    if(!el || !E.root.contains(el)) return;
    const f = ACTIONS[el.dataset.act];
    if(f){ if(el.tagName !== 'INPUT') ev.preventDefault(); Promise.resolve(f(el, ev)).catch(() => { /* l'erreur est déjà affichée */ }); }
  }

  function saisie(ev){
    const el = ev.target.closest('[data-in]');
    if(!el) return;
    const f = SAISIES[el.dataset.in];
    if(f) f(el, ev);
  }

  const ACTIONS = {
    section: (el) => aller(el.dataset.id),
    'aller-cartes': (el) => aller('cartes', { cid: el.dataset.id, filtre: '', rareteFiltre: null, sel: new Set() }),
    'aller-collection': (el) => aller('collections', { col: el.dataset.id }),
    'nouvelle-collection': () => aller('collections', { col: '+' }),
    'donner-vinyles': () => aller('joueurs', { joueur: null }),
    journal: () => voirJournal(),
    // Sons
    'son-ecouter': () => sonEcouter(),
    'son-sauver': () => sonSauver(),
    'son-repere': (el) => { E.son.delai_ms = Number(el.dataset.ms) || 0; sonMajVue(true); },
    // Collections
    'col-ouvrir': (el) => { E.col = el.dataset.id; return sCollections(); },
    'col-retour': async () => { if(!(await abandonOk())) return; E.col = null; return sCollections(); },
    'col-monter': (el) => deplacerCollection(el.dataset.id, -1),
    'col-descendre': (el) => deplacerCollection(el.dataset.id, 1),
    'col-sauver': () => sauverCollection(),
    'col-annuler': () => { E.form = JSON.parse(JSON.stringify(E.orig)); return sCollections(); },
    'col-dupliquer': () => dupliquerCollection(),
    'col-actif': () => basculerActif(),
    'col-supprimer': () => supprimerCollection(),
    'col-televerser': () => $('[data-fichier]').click(),
    'col-visuel-retirer': () => { E.form.visuel = ''; majVisuel(); majBarre(); },
    'col-visuel-choisir': (el) => { E.form.visuel = el.dataset.v; majVisuel(); majBarre(); },
    'col-preset': (el) => { E.form.taux = el.dataset.t.split(',').map(Number); majTaux(true); majBarre(); },
    // Cartes
    'carte-rarete': (el) => changerRarete([el.dataset.a], Number(el.dataset.r)),
    'carte-haut': (el) => deplacerCarte(el.dataset.a, -1),
    'carte-bas': (el) => deplacerCarte(el.dataset.a, 1),
    'carte-retirer': (el) => retirerCartes([el.dataset.a]),
    'carte-apercu': (el) => apercu(el.dataset.a),
    'carte-son': (el) => sonCarte(el.dataset.a),
    'carte-ajouter': () => ajouterArtistes(),
    'carte-auto': () => raretesAuto(),
    'carte-filtre-rarete': (el) => { const r = Number(el.dataset.r); E.rareteFiltre = E.rareteFiltre === r ? null : r; dessinerCartes(); },
    'carte-tout': () => { const vis = cartesVisibles(); const tous = vis.every(c => E.sel.has(c.artist_id)); vis.forEach(c => tous ? E.sel.delete(c.artist_id) : E.sel.add(c.artist_id)); dessinerCartes(); },
    'carte-sel-rarete': (el) => changerRarete([...E.sel], Number(el.dataset.r)),
    'carte-sel-retirer': () => retirerCartes([...E.sel]),
    'carte-sel-vider': () => { E.sel.clear(); dessinerCartes(); },
    // Joueurs
    'joueur-ouvrir': (el) => ouvrirJoueur(el.dataset.id),
    'joueur-retour': () => { E.joueur = null; return sJoueurs(); },
    'joueur-vinyles': (el) => gestVinyles(Number(el.dataset.s)),
    'joueur-carte': (el) => gestCarte(Number(el.dataset.s))
  };

  const SAISIES = {
    'son-choix': (el) => { E.son.son = el.value; sonMajVue(); },
    'son-delai': (el) => { E.son.delai_ms = Number(el.value) || 0; sonMajVue(); },
    'son-volume': (el) => { E.son.volume = Number(el.value) || 0; sonMajVue(); },
    'son-montee': (el) => { E.son.montee = el.checked; sonMajVue(); },
    'son-fichier': (el) => sonEnvoyer(el.files && el.files[0], el),
    'col-champ': (el) => { E.form[el.dataset.f] = el.type === 'number' ? Number(el.value) : el.value; if(el.dataset.f === 'accent'){ const t = $('[data-in="col-accent-t"]'); if(t) t.value = el.value; } majBarre(); },
    'col-accent-t': (el) => { if(/^#[0-9a-fA-F]{6}$/.test(el.value)){ E.form.accent = el.value; const c = $('[data-f="accent"]'); if(c) c.value = el.value; majBarre(); } },
    'col-actif': (el) => { E.form.actif = el.checked; majBarre(); },
    'col-theme': (el) => { E.form.theme = el.value; const p = $('[data-theme-apercu]'); if(p) p.innerHTML = api.EMBLEMES[api.theme(el.value)]; majVisuel(); majBarre(); },
    'col-taux': (el) => { E.form.taux[Number(el.dataset.i)] = Number(el.value); majTaux(false); majBarre(); },
    'col-fichier': (el) => { if(el.files && el.files[0]) televerser(el.files[0]); el.value = ''; },
    'carte-filtre': (el) => { E.filtre = el.value; dessinerListe(); },
    'carte-tri': (el) => { const v = el.value; el.value = ''; if(v) trierCartes(v); },
    'carte-cible': (el) => { E.cid = el.value; E.sel.clear(); E.filtre = ''; E.rareteFiltre = null; return sCartes(); },
    'joueur-q': debounce((el) => { E.joueurQ = el.value; listerJoueurs(); }, 250),
    'joueur-col': (el) => chargerArtistesOffre(el.value)
  };

  // ---------------------------------------------------------------------
  // 1. Vue d'ensemble
  // ---------------------------------------------------------------------

  async function sEnsemble(){
    const r = await api.appel('jeu_equipe_resume');
    E.boosters = r.collections || E.boosters;
    const kpi = (lib, val, sous) => `<div class="ee-kpi"><b>${val}</b><span>${esc(lib)}</span>${sous ? `<small>${sous}</small>` : ''}</div>`;
    E.main.innerHTML = `
      ${tete('Vue d\'ensemble', 'Wave Cards en un coup d\'œil.', `<button type="button" class="ct-btn principal" data-act="nouvelle-collection">${ic('plus', 16)}Nouvelle collection</button>`)}
      <div class="ee-kpis">
        ${kpi('Joueurs', nf(r.joueurs), nf(r.actifs_jour) + ' actif' + (r.actifs_jour > 1 ? 's' : '') + ' aujourd\'hui')}
        ${kpi('Packs ouverts', nf(r.ouvertures), nf(r.ouvertures_jour) + ' aujourd\'hui')}
        ${kpi('Vinyles en circulation', nf(r.vinyles), '1 vinyle = 1 pack')}
        ${kpi('Wave Coins détenus', nf(r.wc))}
        ${kpi('Cartes possédées', nf(r.cartes_possedees), nf(r.holos) + ' holo' + (r.holos > 1 ? 's' : ''))}
      </div>
      <h3 class="ee-titre">Collections</h3>
      ${(r.collections || []).length ? `<div class="ee-colonnes">${r.collections.map((b) => `
        <article class="ee-col-ligne">
          <span class="ee-mini">${miniature(b)}</span>
          <div class="ee-col-txt">
            <span class="ee-ligne-nom"><b>${esc(b.nom)}</b>${b.actif ? '<span class="ee-puce ok">En ligne</span>' : '<span class="ee-puce">Archivée</span>'}</span>
            <small>${nf(b.nb)} carte${b.nb > 1 ? 's' : ''} · ${nf(b.joueurs)} joueur${b.joueurs > 1 ? 's' : ''}</small>
            ${barreRaretes(b.raretes)}
          </div>
          <div class="ee-col-act"><button type="button" class="ct-btn petit" data-act="aller-cartes" data-id="${esc(b.id)}">Cartes</button><button type="button" class="ct-btn petit" data-act="aller-collection" data-id="${esc(b.id)}">Réglages</button></div>
        </article>`).join('')}</div>` : vide('Aucune collection', 'Crée la première avec « Nouvelle collection ».')}
      <div class="ee-titre-ligne"><h3 class="ee-titre">Activité récente</h3><button type="button" class="ct-lien" data-act="journal">Tout voir</button></div>
      ${(r.activite || []).length ? `<ul class="ee-journal">${r.activite.map(ligneJournal).join('')}</ul>` : vide('Rien pour l\'instant', 'Les gestes de l\'équipe apparaîtront ici.')}
      <h3 class="ee-titre">Raccourcis</h3>
      <div class="ee-raccourcis">
        <button type="button" class="ct-btn" data-act="section" data-id="cartes">${ic('cartes', 16)}Ajouter des cartes</button>
        <button type="button" class="ct-btn" data-act="donner-vinyles">${ic('joueurs', 16)}Donner des vinyles</button>
        <button type="button" class="ct-btn" data-act="section" data-id="combat">${api.ico('combat', 16)}Réglages du combat</button>
        <button type="button" class="ct-btn" data-act="section" data-id="marche">${api.ico('marche', 16)}Modérer le marché</button>
      </div>`;
  }

  async function voirJournal(){
    const j = await rpc('jeu_equipe_journal', { p_limite: 80, p_cible: null });
    const f = api.fenetre(`<h2>Journal de l'équipe</h2><p class="sous">Les 80 derniers gestes.</p>${j.length ? `<ul class="ee-journal long">${j.map(ligneJournal).join('')}</ul>` : vide('Rien pour l\'instant')}`, true);
    return f;
  }

  // ---------------------------------------------------------------------
  // 2. Collections
  // ---------------------------------------------------------------------

  const THEMES = [['onde', 'Onde'], ['couronne', 'Couronne'], ['aube', 'Aube'], ['garanti', 'Gala'], ['glace', 'Glace'], ['deferlante', 'Déferlante']];
  const PRESETS = [['Équilibré', [40, 30, 18, 9, 3]], ['Généreux', [30, 30, 22, 13, 5]], ['Rare', [55, 28, 11, 5, 1]]];

  const formDe = (b) => ({
    id: b.id, nom: b.nom || '', serie: b.serie || '', description: b.description || '', theme: b.theme || 'onde', accent: b.accent || '#4FB4FF',
    visuel: b.visuel || '', cout: Number(b.cout || 1), taux: (b.taux || [40, 30, 18, 9, 3]).map(Number), holo_x: Number(b.holo_x == null ? 1 : b.holo_x),
    debut: b.debut || '', fin: b.fin || '', actif: !!b.actif
  });
  const sale = () => E.form && JSON.stringify(E.form) !== JSON.stringify(E.orig);
  const totalTaux = () => E.form.taux.reduce((a, b) => a + (Number(b) || 0), 0);

  async function abandonOk(){
    if(!sale()) return true;
    return confirmer('Quitter sans enregistrer ?', 'Les modifications de cette collection seront perdues.', 'Quitter');
  }

  async function sCollections(){
    await chargerBoosters();
    if(E.col){
      if(E.col === '+' && (!E.form || E.form.id)) { E.form = formDe({ nom: '', actif: false }); E.form.id = ''; E.orig = JSON.parse(JSON.stringify(E.form)); }
      else if(E.col !== '+' && (!E.form || E.form.id !== E.col)){
        const b = E.boosters.find(x => x.id === E.col);
        if(!b){ E.col = null; return sCollections(); }
        E.form = formDe(b); E.orig = JSON.parse(JSON.stringify(E.form));
      }
      return dessinerFormulaire();
    }
    E.form = null;
    E.main.innerHTML = `
      ${tete('Collections', 'Les boosters du jeu. Touche une collection pour la régler.')}
      <div class="ee-tuiles">
        ${E.boosters.map((b, i) => `
          <article class="ee-tuile">
            <button type="button" class="ee-tuile-img" data-act="col-ouvrir" data-id="${esc(b.id)}" aria-label="Régler ${esc(b.nom)}">${miniature(b)}</button>
            <div class="ee-tuile-txt">
              <b>${esc(b.nom)}</b>
              <span>${b.actif ? '<span class="ee-puce ok">En ligne</span>' : '<span class="ee-puce">Archivée</span>'}<small>${nf(b.nb)} cartes · ${nf(b.joueurs)} joueur${b.joueurs > 1 ? 's' : ''}</small></span>
              ${barreRaretes(b.raretes)}
            </div>
            <div class="ee-tuile-act">
              <button type="button" class="ct-btn petit" data-act="col-ouvrir" data-id="${esc(b.id)}">Régler</button>
              <button type="button" class="ct-btn petit" data-act="aller-cartes" data-id="${esc(b.id)}">Cartes</button>
              <span class="ee-ordre"><button type="button" class="ee-ib" data-act="col-monter" data-id="${esc(b.id)}" aria-label="Monter" ${i === 0 ? 'disabled' : ''}>${ic('haut', 15)}</button><button type="button" class="ee-ib" data-act="col-descendre" data-id="${esc(b.id)}" aria-label="Descendre" ${i === E.boosters.length - 1 ? 'disabled' : ''}>${ic('bas', 15)}</button></span>
            </div>
          </article>`).join('')}
        <button type="button" class="ee-tuile nouvelle" data-act="nouvelle-collection">${ic('plus', 26)}<b>Nouvelle collection</b><small>Un nom, un visuel, des cartes : c'est tout.</small></button>
      </div>`;
  }

  async function deplacerCollection(id, sens){
    const l = E.boosters.map(b => b.id), i = l.indexOf(id), j = i + sens;
    if(i < 0 || j < 0 || j >= l.length) return;
    [l[i], l[j]] = [l[j], l[i]];
    for(let k = 0; k < l.length; k++){
      const b = E.boosters.find(x => x.id === l[k]);
      if(Number(b.ordre) !== k + 1) await rpc('jeu_equipe_booster_sauver', { p_id: l[k], p_donnees: { ordre: k + 1 } });
    }
    return sCollections();
  }

  function dessinerFormulaire(){
    const f = E.form, nouveau = E.col === '+';
    const champ = (lib, cle, attrs, aide) => `<label class="ee-champ"><span>${esc(lib)}</span><input data-in="col-champ" data-f="${cle}" value="${esc(f[cle])}" ${attrs || ''}>${aide ? `<small>${esc(aide)}</small>` : ''}</label>`;
    const autres = [...new Set(E.boosters.filter(b => b.id !== f.id && api.visuelOk(b.visuel)).map(b => b.visuel))];
    E.main.innerHTML = `
      <button type="button" class="ct-lien ee-retour" data-act="col-retour">${ic('fleche', 14)}Collections</button>
      ${tete(nouveau ? 'Nouvelle collection' : f.nom || 'Collection', nouveau ? 'Elle reste archivée tant que tu ne l\'actives pas.' : 'Identifiant : ' + f.id)}
      <div class="ee-grille2">
        <div class="ee-pile">
          <section class="ee-bloc"><h3>Identité</h3>
            ${champ('Nom', 'nom', 'maxlength="60" placeholder="Classic Wave"')}
            ${champ('Sous-titre', 'serie', 'maxlength="60" placeholder="Collection permanente"')}
            <label class="ee-champ"><span>Description</span><textarea data-in="col-champ" data-f="description" maxlength="400" rows="3" placeholder="Ce que les joueurs lisent sous la pochette">${esc(f.description)}</textarea></label>
          </section>
          <section class="ee-bloc"><h3>Visuel</h3>
            <div class="ee-visuel">
              <span class="ee-visuel-img" data-visuel></span>
              <div class="ee-visuel-act">
                <button type="button" class="ct-btn" data-act="col-televerser">${ic('televerser', 16)}Téléverser une image</button>
                <input type="file" accept="image/jpeg,image/png,image/webp" data-in="col-fichier" data-fichier hidden>
                <button type="button" class="ct-btn petit" data-act="col-visuel-retirer" ${f.visuel ? '' : 'disabled'} data-retirer>Retirer</button>
                <small>Image carrée (recadrée au centre sinon), 900 px.</small>
              </div>
            </div>
            ${autres.length ? `<div class="ee-reuse"><small>Ou reprendre un visuel existant</small><div>${autres.map(v => `<button type="button" class="ee-reuse-b" data-act="col-visuel-choisir" data-v="${esc(v)}" aria-label="Utiliser ce visuel"><img src="${esc(v)}" alt="" loading="lazy"></button>`).join('')}</div></div>` : ''}
          </section>
          <section class="ee-bloc"><h3>Apparence</h3>
            <div class="ee-ligne2">
              <label class="ee-champ"><span>Thème (sans visuel)</span><select data-in="col-theme">${THEMES.map(([v, n]) => `<option value="${v}"${f.theme === v ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
              <span class="ee-theme" data-theme-apercu>${api.EMBLEMES[api.theme(f.theme)]}</span>
            </div>
            <label class="ee-champ"><span>Couleur</span><span class="ee-couleur"><input type="color" data-in="col-champ" data-f="accent" value="${esc(f.accent)}" aria-label="Couleur"><input data-in="col-accent-t" value="${esc(f.accent)}" maxlength="7" aria-label="Code couleur"></span></label>
          </section>
        </div>
        <div class="ee-pile">
          <section class="ee-bloc"><h3>Tirage</h3>
            <label class="ee-champ"><span>Prix d'un pack (vinyles)</span><input type="number" min="1" max="10000" step="1" data-in="col-champ" data-f="cout" value="${f.cout}"><small>1 vinyle = 1 ouverture de pack.</small></label>
            <div class="ee-champ"><span>Chances par rareté (%)</span>
              <div class="ee-taux">${[1, 2, 3, 4, 5].map(r => `<label style="--rc:${rar(r).c}"><i></i><span>${esc(rar(r).nom)}</span><input type="number" min="0" max="100" step="0.5" data-in="col-taux" data-i="${r - 1}" value="${f.taux[r - 1]}" aria-label="${esc(rar(r).nom)}"></label>`).join('')}</div>
              <div class="ee-total" data-total></div>
              <div class="ee-presets">${PRESETS.map(([n, t]) => `<button type="button" class="ct-btn petit" data-act="col-preset" data-t="${t.join(',')}">${n}</button>`).join('')}</div>
            </div>
            <label class="ee-champ"><span>Multiplicateur holo</span><input type="number" min="0" max="20" step="0.5" data-in="col-champ" data-f="holo_x" value="${f.holo_x}"><small>1 = chances normales d'obtenir une carte holo.</small></label>
          </section>
          <section class="ee-bloc"><h3>Calendrier</h3>
            <label class="ee-interrupteur"><input type="checkbox" data-in="col-actif" ${f.actif ? 'checked' : ''}><span class="ee-sw"></span><b>En ligne</b><small>Visible dans les packs et ouvrable par les joueurs.</small></label>
            <div class="ee-ligne2">
              <label class="ee-champ"><span>Début</span><input type="date" data-in="col-champ" data-f="debut" value="${esc(f.debut)}"></label>
              <label class="ee-champ"><span>Fin</span><input type="date" data-in="col-champ" data-f="fin" value="${esc(f.fin)}"></label>
            </div>
            <small class="ee-aide">Laisse vide pour une collection permanente.</small>
          </section>
          ${nouveau ? '' : `<section class="ee-bloc"><h3>Actions</h3>
            <div class="ee-actions-col">
              <button type="button" class="ct-btn" data-act="aller-cartes" data-id="${esc(f.id)}">${ic('cartes', 16)}Modifier les cartes</button>
              <button type="button" class="ct-btn" data-act="col-dupliquer">${ic('copie', 16)}Dupliquer</button>
              <button type="button" class="ct-btn" data-act="col-actif">${f.actif ? 'Archiver' : 'Mettre en ligne'}</button>
              <button type="button" class="ct-btn danger" data-act="col-supprimer">${ic('corbeille', 16)}Supprimer</button>
            </div></section>`}
        </div>
      </div>
      <div class="ee-barre-save" data-barre></div>`;
    majVisuel(); majTaux(false); majBarre();
  }

  function majVisuel(){
    const z = $('[data-visuel]'); if(!z) return;
    z.innerHTML = miniature({ visuel: E.form.visuel, theme: E.form.theme });
    const r = $('[data-retirer]'); if(r) r.disabled = !E.form.visuel;
  }

  function majTaux(reecrire){
    if(reecrire) $$('[data-in="col-taux"]').forEach((i) => { i.value = E.form.taux[Number(i.dataset.i)]; });
    const t = Math.round(totalTaux() * 100) / 100, ok = Math.abs(t - 100) <= 0.05, z = $('[data-total]');
    if(z){ z.className = 'ee-total ' + (ok ? 'ok' : 'ko'); z.textContent = ok ? 'Total : 100 %' : 'Total : ' + String(t).replace('.', ',') + ' % (il faut 100 %)'; }
  }

  function majBarre(){
    const b = $('[data-barre]'); if(!b) return;
    const s = sale(), ok = Math.abs(totalTaux() - 100) <= 0.05 && E.form.nom.trim();
    b.classList.toggle('visible', s || E.col === '+');
    b.innerHTML = `<span class="ee-etat">${s ? 'Modifications non enregistrées' : (E.col === '+' ? 'Donne un nom à ta collection' : 'Tout est enregistré')}</span>
      ${E.col === '+' ? '' : `<button type="button" class="ct-btn" data-act="col-annuler" ${s ? '' : 'disabled'}>Annuler</button>`}
      <button type="button" class="ct-btn principal" data-act="col-sauver" ${(s || E.col === '+') && ok ? '' : 'disabled'}>${E.col === '+' ? 'Créer la collection' : 'Enregistrer'}</button>`;
  }

  async function sauverCollection(){
    const f = E.form, nouveau = E.col === '+';
    let id = f.id;
    if(nouveau){
      const base = slug(f.nom) || 'collection';
      id = base; let k = 2;
      while(E.boosters.some(b => b.id === id)) id = base.slice(0, 36) + '-' + k++;
    }
    const b = await rpc('jeu_equipe_booster_sauver', { p_id: id, p_donnees: {
      nom: f.nom.trim(), serie: f.serie.trim(), description: f.description.trim(), theme: f.theme, accent: f.accent, visuel: f.visuel || null,
      cout: Number(f.cout), taux: f.taux.map(Number), holo_x: Number(f.holo_x), debut: f.debut || null, fin: f.fin || null, actif: !!f.actif } });
    await chargerBoosters();
    E.col = b.id; E.form = formDe(b); E.orig = JSON.parse(JSON.stringify(E.form));
    api.toast(nouveau ? 'Collection créée' : 'Collection enregistrée');
    return sCollections();
  }

  async function dupliquerCollection(){
    if(!(await abandonOk())) return;
    const base = slug(E.form.id + '-copie') || 'copie'; let id = base, k = 2;
    while(E.boosters.some(b => b.id === id)) id = base.slice(0, 36) + '-' + k++;
    const b = await rpc('jeu_equipe_booster_dupliquer', { p_id: E.form.id, p_nouveau: id, p_nom: null });
    api.toast('Collection dupliquée (archivée)');
    E.col = b.id; E.form = null;
    return sCollections();
  }

  async function basculerActif(){
    const f = E.form;
    if(sale()){ api.toast('Enregistre d\'abord tes modifications.', 'err'); return; }
    if(f.actif && !(await confirmer('Archiver cette collection ?', 'Les joueurs ne pourront plus ouvrir de packs ' + esc(f.nom) + '. Leurs cartes restent dans leur collection.', 'Archiver'))) return;
    await rpc('jeu_equipe_booster_sauver', { p_id: f.id, p_donnees: { actif: !f.actif } });
    api.toast(f.actif ? 'Collection archivée' : 'Collection en ligne');
    E.form = null;
    return sCollections();
  }

  async function supprimerCollection(){
    const f = E.form;
    if(!(await confirmer('Supprimer « ' + f.nom + ' » ?', 'Ses cartes disparaissent aussi. C\'est impossible si des joueurs en possèdent : archive-la plutôt. Cette action est définitive.', 'Supprimer'))) return;
    await rpc('jeu_equipe_booster_supprimer', { p_id: f.id });
    api.toast('Collection supprimée');
    E.col = null; E.form = null;
    return sCollections();
  }

  // Une image carrée de 900 px : recadrée au centre, en WEBP, envoyée dans le stockage du site.
  async function televerser(fichier){
    if(typeof Fichiers === 'undefined'){ api.toast('Le stockage d\'images n\'est pas disponible ici.', 'err'); return; }
    if(!/^image\/(jpeg|png|webp)$/.test(fichier.type)){ api.toast('Choisis une image JPG, PNG ou WEBP.', 'err'); return; }
    const z = $('[data-visuel]'); if(z) z.classList.add('charge');
    try{
      const url = URL.createObjectURL(fichier);
      const img = await new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ko(new Error('Image illisible.')); i.src = url; });
      URL.revokeObjectURL(url);
      const c = Math.min(img.naturalWidth, img.naturalHeight), t = Math.min(900, c);
      const cv = document.createElement('canvas'); cv.width = cv.height = t;
      const x = cv.getContext('2d'); x.imageSmoothingQuality = 'high';
      x.drawImage(img, (img.naturalWidth - c) / 2, (img.naturalHeight - c) / 2, c, c, 0, 0, t, t);
      let blob = await new Promise(ok => cv.toBlob(ok, 'image/webp', .9));
      let type = 'image/webp', ext = '.webp';
      if(!blob || blob.type !== 'image/webp'){ blob = await new Promise(ok => cv.toBlob(ok, 'image/jpeg', .9)); type = 'image/jpeg'; ext = '.jpg'; }
      E.form.visuel = await Fichiers.envoyer(blob, Fichiers.nommer('wave-cards', E.form.id || E.form.nom, ext), type);
      api.toast('Image envoyée');
    }catch(e){
      api.toast(e.message || 'L\'envoi a échoué.', 'err');
    }finally{
      if(z) z.classList.remove('charge');
    }
    majVisuel(); majBarre();
  }

  // ---------------------------------------------------------------------
  // 3. Cartes d'une collection
  // ---------------------------------------------------------------------

  const triees = () => E.cartes.slice().sort((a, b) => a.numero - b.numero);
  const cartesVisibles = () => {
    const q = E.filtre.trim().toLowerCase();
    return E.cartes.filter(c => (!E.rareteFiltre || Number(c.rarete) === E.rareteFiltre) && (!q || String(c.nom || '').toLowerCase().includes(q)));
  };

  async function chargerCartes(){
    E.cartes = await api.appel('jeu_equipe_cartes', { p_booster: E.cid });
    const garde = new Set(E.cartes.map(c => c.artist_id));
    E.sel = new Set([...E.sel].filter(a => garde.has(a)));
  }

  async function sCartes(){
    await chargerBoosters();
    if(!E.boosters.length){ E.main.innerHTML = tete('Cartes') + vide('Aucune collection', 'Crée d\'abord une collection.'); return; }
    if(!E.boosters.some(b => b.id === E.cid)) E.cid = E.boosters[0].id;
    await chargerCartes();
    dessinerCartes();
  }

  function dessinerCartes(){
    if(!E.root.querySelector('[data-cartes-tete]')){
      E.main.innerHTML = `
        ${tete('Cartes', 'Les artistes de chaque collection et la rareté de leur carte.')}
        <div data-cartes-tete></div><div data-cartes-liste></div>`;
    }
    dessinerTete();
    dessinerListe();
  }

  function dessinerTete(){
    const b = E.boosters.find(x => x.id === E.cid) || {};
    const vis = cartesVisibles();
    const par = [1, 2, 3, 4, 5].map(r => E.cartes.filter(c => Number(c.rarete) === r).length);
    const tout = vis.length && vis.every(c => E.sel.has(c.artist_id));
    $('[data-cartes-tete]').innerHTML = `
      <div class="ee-barre-outils">
        <label class="ee-champ ee-cible"><span class="sr">Collection</span><select data-in="carte-cible" aria-label="Collection">${E.boosters.map(x => `<option value="${esc(x.id)}"${x.id === E.cid ? ' selected' : ''}>${esc(x.nom)}${x.actif ? '' : ' (archivée)'}</option>`).join('')}</select></label>
        <button type="button" class="ct-btn principal" data-act="carte-ajouter">${ic('plus', 16)}Ajouter des artistes</button>
        <button type="button" class="ct-btn" data-act="carte-auto">${ic('baguette', 16)}Raretés automatiques</button>
        <label class="ee-champ"><span class="sr">Trier</span><select data-in="carte-tri" aria-label="Renuméroter">
          <option value="">Renuméroter…</option><option value="rarete">Par rareté, puis écoutes</option><option value="fans">Par écoutes</option><option value="nom">Par nom (A–Z)</option></select></label>
        <button type="button" class="ct-btn petit" data-act="aller-collection" data-id="${esc(E.cid)}">Réglages de la collection</button>
      </div>
      <div class="ee-resume">
        ${[5, 4, 3, 2, 1].map(r => `<button type="button" class="ee-chip${E.rareteFiltre === r ? ' on' : ''}" style="--rc:${rar(r).c}" data-act="carte-filtre-rarete" data-r="${r}" aria-pressed="${E.rareteFiltre === r}"><i></i>${esc(rar(r).nom)}<b>${par[r - 1]}</b></button>`).join('')}
        <span class="ee-total-cartes">${nf(E.cartes.length)} carte${E.cartes.length > 1 ? 's' : ''}${b.actif ? '' : ' · archivée'}</span>
      </div>
      <div class="ee-barre-outils">
        <label class="ee-recherche">${api.ico('loupe', 16)}<input type="search" data-in="carte-filtre" value="${esc(E.filtre)}" placeholder="Filtrer cette collection" aria-label="Filtrer cette collection"></label>
        <label class="ee-case"><input type="checkbox" data-act="carte-tout" ${tout ? 'checked' : ''}> Tout sélectionner</label>
      </div>
      ${E.sel.size ? `<div class="ee-selection" role="region" aria-label="Sélection">
        <b>${E.sel.size} sélectionnée${E.sel.size > 1 ? 's' : ''}</b><span class="ee-sel-rar">Rareté ${pts(0, 'data-act="carte-sel-rarete"')}</span>
        <button type="button" class="ct-btn petit danger" data-act="carte-sel-retirer">Retirer</button><button type="button" class="ct-btn petit" data-act="carte-sel-vider">Désélectionner</button></div>` : ''}`;
  }

  function dessinerListe(){
    const vis = cartesVisibles(), filtre = !!(E.filtre.trim() || E.rareteFiltre);
    $('[data-cartes-liste]').innerHTML = vis.length
      ? `<div class="ee-cartes" role="list">${vis.map((c, i) => `
        <div class="ee-carte${E.sel.has(c.artist_id) ? ' sel' : ''}" role="listitem" style="--rc:${rar(c.rarete).c}">
          <input type="checkbox" class="ee-coche" data-act="carte-sel" data-a="${esc(c.artist_id)}" ${E.sel.has(c.artist_id) ? 'checked' : ''} aria-label="Sélectionner ${esc(c.nom || '')}">
          <span class="ee-num">${esc(String(c.numero).padStart(2, '0'))}</span>
          <img class="ee-photo" src="${esc(api.safeUrl(c.photo))}" alt="" loading="lazy">
          <div class="ee-nom"><b>${esc(c.nom || 'Artiste')}</b><small>${c.fans ? esc(api.court(c.fans)) + ' fans' : 'fans inconnus'}${c.joueurs ? ' · ' + c.joueurs + ' joueur' + (c.joueurs > 1 ? 's' : '') : ''}${Number(c.rarete) === 5 && (c.son_titre || c.clip_id) ? ' · ♪ ' + esc([c.son_nom ? c.son_nom : '', c.clip_id ? (c.clip_son ? 'clip + son du clip' : 'clip') : ''].filter(Boolean).join(' + ')) : ''}</small></div>
          ${pts(c.rarete, `data-act="carte-rarete" data-a="${esc(c.artist_id)}"`)}
          <div class="ee-outils">
            ${filtre ? '' : `<button type="button" class="ee-ib" data-act="carte-haut" data-a="${esc(c.artist_id)}" aria-label="Monter" ${i === 0 ? 'disabled' : ''}>${ic('haut', 15)}</button><button type="button" class="ee-ib" data-act="carte-bas" data-a="${esc(c.artist_id)}" aria-label="Descendre" ${i === vis.length - 1 ? 'disabled' : ''}>${ic('bas', 15)}</button>`}
            ${Number(c.rarete) === 5 ? `<button type="button" class="ee-ib son${c.son_titre || c.clip_id ? ' actif' : ''}" data-act="carte-son" data-a="${esc(c.artist_id)}" aria-label="Morceau et clip de la carte Mythique" title="Morceau et clip de la carte Mythique">${api.ico('son', 15)}</button>` : ''}
            <button type="button" class="ee-ib" data-act="carte-apercu" data-a="${esc(c.artist_id)}" aria-label="Aperçu de la carte">${ic('oeil', 15)}</button>
            <button type="button" class="ee-ib danger" data-act="carte-retirer" data-a="${esc(c.artist_id)}" aria-label="Retirer ${esc(c.nom || '')}">${ic('corbeille', 15)}</button>
          </div>
        </div>`).join('')}</div>`
      : vide(E.cartes.length ? 'Aucune carte ne correspond' : 'Cette collection est vide', E.cartes.length ? 'Change le filtre.' : 'Ajoute des artistes avec le bouton « Ajouter des artistes ».');
  }

  // La coche d'une ligne : un data-act comme les autres, mais sur « change ».
  ACTIONS['carte-sel'] = (el) => { if(el.checked) E.sel.add(el.dataset.a); else E.sel.delete(el.dataset.a); dessinerTete(); const l = el.closest('.ee-carte'); if(l) l.classList.toggle('sel', el.checked); };

  async function changerRarete(ids, r){
    if(!ids.length || !r) return;
    const items = ids.filter(a => { const c = E.cartes.find(x => x.artist_id === a); return c && Number(c.rarete) !== r; }).map(a => ({ artist_id: a, rarete: r }));
    if(!items.length) return;
    const avant = items.map(it => ({ artist_id: it.artist_id, rarete: E.cartes.find(x => x.artist_id === it.artist_id).rarete }));
    await rpc('jeu_equipe_cartes_raretes', { p_booster: E.cid, p_items: items });
    await chargerCartes(); dessinerCartes();
    snack(items.length > 1 ? items.length + ' cartes passées en ' + rar(r).nom : 'Carte passée en ' + rar(r).nom, async () => {
      await rpc('jeu_equipe_cartes_raretes', { p_booster: E.cid, p_items: avant });
      await chargerCartes(); dessinerCartes();
    });
  }

  async function deplacerCarte(a, sens){
    const l = triees().map(c => c.artist_id), i = l.indexOf(a), j = i + sens;
    if(i < 0 || j < 0 || j >= l.length) return;
    [l[i], l[j]] = [l[j], l[i]];
    await rpc('jeu_equipe_cartes_ordre', { p_booster: E.cid, p_artistes: l });
    await chargerCartes(); dessinerCartes();
  }

  async function trierCartes(mode){
    const l = E.cartes.slice();
    const f = (c) => Number(c.fans) || 0;
    if(mode === 'rarete') l.sort((a, b) => b.rarete - a.rarete || f(b) - f(a));
    else if(mode === 'fans') l.sort((a, b) => f(b) - f(a));
    else l.sort((a, b) => String(a.nom).localeCompare(String(b.nom), 'fr'));
    if(!(await confirmer('Renuméroter les cartes ?', 'Les numéros #1 à #' + l.length + ' suivront ce nouvel ordre. Les joueurs verront les nouveaux numéros.', 'Renuméroter'))) return;
    await rpc('jeu_equipe_cartes_ordre', { p_booster: E.cid, p_artistes: l.map(c => c.artist_id) });
    await chargerCartes(); dessinerCartes();
    api.toast('Cartes renumérotées');
  }

  async function retirerCartes(ids){
    const cs = ids.map(a => E.cartes.find(x => x.artist_id === a)).filter(Boolean);
    if(!cs.length) return;
    const proprio = cs.filter(c => c.joueurs > 0);
    if(proprio.length && !(await confirmer(cs.length > 1 ? 'Retirer ces cartes ?' : 'Retirer « ' + cs[0].nom + ' » ?',
      proprio.length + ' des cartes retirées ' + (proprio.length > 1 ? 'sont possédées' : 'est possédée') + ' par des joueurs (' + proprio.reduce((a, c) => a + c.joueurs, 0) + ' au total). Ils la gardent en base mais elle disparaît de leur classeur. Tu pourras l\'annuler tout de suite après.', 'Retirer'))) return;
    const ordre = triees().map(c => c.artist_id);
    const sauve = cs.map(c => ({ artist_id: c.artist_id, rarete: c.rarete }));
    await rpc('jeu_equipe_cartes_retirer', { p_booster: E.cid, p_artistes: cs.map(c => c.artist_id) });
    E.sel.clear();
    await chargerCartes(); dessinerCartes();
    snack(cs.length > 1 ? cs.length + ' cartes retirées' : '« ' + cs[0].nom + ' » retirée', async () => {
      await rpc('jeu_equipe_cartes_ajouter', { p_booster: E.cid, p_items: sauve });
      await rpc('jeu_equipe_cartes_ordre', { p_booster: E.cid, p_artistes: ordre });
      await chargerCartes(); dessinerCartes();
    });
  }

  // L'aperçu : la vraie carte, en holo ou non, et (si le combat est prêt) ses statistiques.
  async function apercu(a){
    const c = E.cartes.find(x => x.artist_id === a); if(!c) return;
    let holo = false;
    const f = api.fenetre(`
      <div class="ee-apercu">
        <div class="ee-apercu-carte" data-carte></div>
        <div class="ee-apercu-cote">
          <h2>${esc(c.nom || 'Artiste')}</h2>
          <p class="sous">${esc(rar(c.rarete).nom)} · n° ${esc(String(c.numero).padStart(3, '0'))} · ${c.fans ? esc(nf(c.fans)) + ' fans' : 'fans inconnus'}</p>
          <label class="ee-case"><input type="checkbox" data-holo> Version holo</label>
          <p class="sous">${c.joueurs ? nf(c.joueurs) + ' joueur' + (c.joueurs > 1 ? 's' : '') + ' · ' + nf(c.exemplaires) + ' exemplaire' + (c.exemplaires > 1 ? 's' : '') : 'Personne ne l\'a encore.'}</p>
          <div data-combat></div>
        </div>
      </div>`, true);
    const dessin = () => { $('[data-carte]', f.corps).innerHTML = api.carteHtml({ nom: c.nom, rarete: c.rarete, numero: c.numero, photo: c.photo, holo, fans: c.fans }, { eager: true, vivante: true }); };
    dessin();
    $('[data-holo]', f.corps).addEventListener('change', (ev) => { holo = ev.target.checked; dessin(); });
    try{
      await window.chargerWaveModule('combat');
      const z = $('[data-combat]', f.corps);
      if(z && window.WaveCombat && typeof window.WaveCombat.equipeCarte === 'function') await window.WaveCombat.equipeCarte(z, api, c.artist_id);
    }catch(e){ /* le combat n'est pas prêt : rien à montrer */ }
  }

  // Ajouter des artistes : trois façons dans la même fenêtre.
  function ajouterArtistes(){
    const etat = { onglet: 'chercher', r: 1, q: '', res: [], decalage: 0, fin: false, n: 10, liste: [], coller: [], ajoutes: 0 };
    const f = api.fenetre(`
      <h2>Ajouter des artistes</h2>
      <p class="sous">À « ${esc(nomCol(E.cid))} ». Choisis la rareté, puis ajoute.</p>
      <div class="ee-onglets" role="tablist">${[['chercher', 'Chercher'], ['top', 'Les plus écoutés'], ['coller', 'Coller une liste']].map(([id, n]) => `<button type="button" role="tab" data-o="${id}" class="${id === etat.onglet ? 'actif' : ''}">${n}</button>`).join('')}</div>
      <div class="ee-ajout-rar"><span>Rareté des cartes ajoutées</span><span data-pts></span></div>
      <div data-zone class="ee-ajout-zone"></div>`, true, async () => { if(etat.ajoutes){ await chargerCartes(); dessinerCartes(); } });
    const zone = $('[data-zone]', f.corps);
    const dessinerPts = () => { $('[data-pts]', f.corps).innerHTML = pts(etat.r, 'data-pr'); };
    const ligneArtiste = (a, i, action) => `
      <div class="ee-res">
        <img class="ee-photo" src="${esc(api.safeUrl(a.photo))}" alt="" loading="lazy">
        <div class="ee-nom"><b>${esc(a.nom)}</b><small>${a.fans ? esc(api.court(a.fans)) + ' fans' : 'fans inconnus'}</small></div>
        ${a.deja ? '<span class="ee-puce">Déjà dans la collection</span>' : action}
      </div>`;
    const ajouter = async (items) => {
      if(!items.length) return;
      await rpc('jeu_equipe_cartes_ajouter', { p_booster: E.cid, p_items: items });
      etat.ajoutes += items.length;
      api.toast(items.length + ' carte' + (items.length > 1 ? 's ajoutées' : ' ajoutée'));
    };

    async function chercher(plus){
      if(!plus){ etat.decalage = 0; etat.res = []; etat.fin = false; }
      const r = await rpc('jeu_equipe_artistes', { p_q: etat.q.trim() || null, p_booster: E.cid, p_limite: 30, p_decalage: etat.decalage });
      etat.res = etat.res.concat(r); etat.decalage += 30; etat.fin = r.length < 30;
      onglet();
    }

    function onglet(){
      $$('.ee-onglets button', f.corps).forEach(b => b.classList.toggle('actif', b.dataset.o === etat.onglet));
      if(etat.onglet === 'chercher'){
        zone.innerHTML = `
          <label class="ee-recherche">${api.ico('loupe', 16)}<input type="search" data-q value="${esc(etat.q)}" placeholder="Nom d'un artiste" aria-label="Nom d'un artiste" autocomplete="off"></label>
          <div class="ee-resultats">${etat.res.length ? etat.res.map((a, i) => ligneArtiste(a, i, `<button type="button" class="ct-btn petit principal" data-add="${i}">Ajouter</button>`)).join('') : `<p class="sous">${etat.q.trim() ? 'Aucun artiste trouvé.' : 'Les plus écoutés qui ne sont pas encore dans la collection.'}</p>`}</div>
          ${etat.res.length && !etat.fin ? '<button type="button" class="ct-btn petit" data-plus>Voir plus</button>' : ''}`;
        const q = $('[data-q]', zone);
        if(q){ q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
      }else if(etat.onglet === 'top'){
        zone.innerHTML = `
          <label class="ee-champ"><span>Combien d'artistes ?</span><input type="number" min="1" max="100" value="${etat.n}" data-n></label>
          <div class="ee-resultats">${etat.liste.map(a => `<div class="ee-res compact"><img class="ee-photo" src="${esc(api.safeUrl(a.photo))}" alt="" loading="lazy"><div class="ee-nom"><b>${esc(a.nom)}</b><small>${a.fans ? esc(api.court(a.fans)) + ' fans' : ''}</small></div></div>`).join('') || '<p class="sous">Chargement…</p>'}</div>
          <button type="button" class="ct-btn principal" data-top ${etat.liste.length ? '' : 'disabled'}>Ajouter ${etat.liste.length} carte${etat.liste.length > 1 ? 's' : ''} en ${esc(rar(etat.r).nom)}</button>`;
      }else{
        zone.innerHTML = `
          <label class="ee-champ"><span>Un nom d'artiste par ligne</span><textarea rows="6" data-noms placeholder="Booba&#10;Ninho&#10;Jul"></textarea></label>
          <button type="button" class="ct-btn" data-trouver>Chercher ces artistes</button>
          ${etat.coller.length ? `<div class="ee-resultats">${etat.coller.map((m, i) => m.artist_id
            ? `<label class="ee-res"><input type="checkbox" data-c="${i}" ${m.pris ? 'checked' : ''}><img class="ee-photo" src="${esc(api.safeUrl(m.photo))}" alt="" loading="lazy"><div class="ee-nom"><b>${esc(m.nom)}</b><small>« ${esc(m.saisi)} »${m.deja ? ' · déjà dans la collection' : ''}</small></div></label>`
            : `<div class="ee-res introuvable"><span class="ee-photo"></span><div class="ee-nom"><b>${esc(m.saisi)}</b><small>Introuvable</small></div></div>`).join('')}</div>
            <button type="button" class="ct-btn principal" data-coller>Ajouter ${etat.coller.filter(m => m.pris).length} carte${etat.coller.filter(m => m.pris).length > 1 ? 's' : ''} en ${esc(rar(etat.r).nom)}</button>` : ''}`;
      }
    }

    const chargerTop = debounce(async () => {
      etat.liste = await rpc('jeu_equipe_artistes', { p_q: null, p_booster: E.cid, p_limite: Math.max(1, Math.min(100, etat.n)), p_decalage: 0 });
      onglet();
    }, 300);

    f.corps.addEventListener('click', async (ev) => {
      const o = ev.target.closest('[data-o]');
      if(o){ etat.onglet = o.dataset.o; if(etat.onglet === 'chercher' && !etat.res.length) await chercher(false); else if(etat.onglet === 'top') { etat.liste = []; onglet(); chargerTop(); } else onglet(); return; }
      const p = ev.target.closest('[data-pr]');
      if(p){ etat.r = Number(p.dataset.r); dessinerPts(); if(etat.onglet !== 'chercher') onglet(); return; }
      const add = ev.target.closest('[data-add]');
      if(add){ const a = etat.res[Number(add.dataset.add)]; add.disabled = true; try{ await ajouter([{ artist_id: a.artist_id, rarete: etat.r }]); a.deja = true; onglet(); }catch(e){ add.disabled = false; } return; }
      if(ev.target.closest('[data-plus]')){ await chercher(true); return; }
      if(ev.target.closest('[data-top]')){ try{ await ajouter(etat.liste.map(a => ({ artist_id: a.artist_id, rarete: etat.r }))); f.fermer(); }catch(e){ /* affiché */ } return; }
      if(ev.target.closest('[data-trouver]')){
        const noms = $('[data-noms]', zone).value.split('\n').map(x => x.trim()).filter(Boolean);
        if(!noms.length) return;
        const r = await rpc('jeu_equipe_artistes_noms', { p_noms: noms.slice(0, 200) });
        const deja = new Set(E.cartes.map(c => c.artist_id));
        etat.coller = r.map(m => ({ ...m, deja: deja.has(m.artist_id), pris: !!m.artist_id && !deja.has(m.artist_id) }));
        onglet(); return;
      }
      if(ev.target.closest('[data-coller]')){ try{ await ajouter(etat.coller.filter(m => m.pris).map(m => ({ artist_id: m.artist_id, rarete: etat.r }))); f.fermer(); }catch(e){ /* affiché */ } }
    });
    f.corps.addEventListener('input', (ev) => {
      if(ev.target.matches('[data-q]')){ etat.q = ev.target.value; clearTimeout(chercher.t); chercher.t = setTimeout(() => chercher(false).catch(() => {}), 260); }
      else if(ev.target.matches('[data-n]')){ etat.n = Number(ev.target.value) || 1; chargerTop(); }
    });
    f.corps.addEventListener('change', (ev) => {
      if(ev.target.matches('[data-c]')){ etat.coller[Number(ev.target.dataset.c)].pris = ev.target.checked; onglet(); }
    });
    dessinerPts();
    chercher(false).catch(() => {});
  }

  // Raretés automatiques : on fixe la part de chaque rareté, les plus écoutés prennent les plus rares.
  function raretesAuto(){
    if(!E.cartes.length){ api.toast('La collection est vide.', 'err'); return; }
    const parts = [40, 25, 20, 10, 5];   // Commun … Mythique
    const classes = E.cartes.slice().sort((a, b) => (Number(b.fans) || 0) - (Number(a.fans) || 0));
    const calcul = () => {
      const n = classes.length, nb = parts.map(p => Math.round(n * p / 100));
      nb[0] = Math.max(0, n - nb.slice(1).reduce((a, b) => a + b, 0));
      const res = new Map(); let k = 0;
      for(let r = 5; r >= 1; r--){ for(let i = 0; i < nb[r - 1] && k < n; i++) res.set(classes[k++].artist_id, r); }
      classes.slice(k).forEach(c => res.set(c.artist_id, 1));
      return { nb, res, changes: classes.filter(c => res.get(c.artist_id) !== Number(c.rarete)) };
    };
    const f = api.fenetre(`
      <h2>Raretés automatiques</h2>
      <p class="sous">Les artistes les plus écoutés reçoivent les raretés les plus hautes. Règle la part de chaque rareté.</p>
      <div class="ee-taux ee-taux-auto">${[1, 2, 3, 4, 5].map(r => `<label style="--rc:${rar(r).c}"><i></i><span>${esc(rar(r).nom)}</span><input type="number" min="0" max="100" step="1" data-p="${r - 1}" value="${parts[r - 1]}" aria-label="${esc(rar(r).nom)} en %"></label>`).join('')}</div>
      <div class="ee-total" data-t></div>
      <div data-apercu class="ee-auto-apercu"></div>
      <div class="ct-actions" style="justify-content:flex-end; margin-top:16px"><button type="button" class="ct-btn" data-non>Annuler</button><button type="button" class="ct-btn principal" data-oui>Appliquer</button></div>`, true);
    const maj = () => {
      const tot = parts.reduce((a, b) => a + b, 0), ok = Math.abs(tot - 100) < .5, { nb, changes, res } = calcul();
      const t = $('[data-t]', f.corps); t.className = 'ee-total ' + (ok ? 'ok' : 'ko'); t.textContent = ok ? 'Total : 100 %' : 'Total : ' + tot + ' % (il faut 100 %)';
      $('[data-apercu]', f.corps).innerHTML = `<div class="ee-auto-nb">${[5, 4, 3, 2, 1].map(r => `<span style="--rc:${rar(r).c}"><i></i>${esc(rar(r).nom)} <b>${nb[r - 1]}</b></span>`).join('')}</div>
        <p class="sous">${changes.length ? changes.length + ' carte' + (changes.length > 1 ? 's changent' : ' change') + ' de rareté.' : 'Aucun changement.'}</p>
        ${changes.length ? `<ul class="ee-auto-liste">${changes.slice(0, 10).map(c => `<li><b>${esc(c.nom)}</b> ${esc(rar(c.rarete).nom)} → <span style="color:${rar(res.get(c.artist_id)).c}">${esc(rar(res.get(c.artist_id)).nom)}</span></li>`).join('')}${changes.length > 10 ? `<li>… et ${changes.length - 10} autres</li>` : ''}</ul>` : ''}`;
      $('[data-oui]', f.corps).disabled = !ok || !changes.length;
    };
    f.corps.addEventListener('input', (ev) => { if(ev.target.matches('[data-p]')){ parts[Number(ev.target.dataset.p)] = Number(ev.target.value) || 0; maj(); } });
    f.corps.querySelector('[data-non]').addEventListener('click', f.fermer);
    f.corps.querySelector('[data-oui]').addEventListener('click', async () => {
      const { changes, res } = calcul();
      const avant = changes.map(c => ({ artist_id: c.artist_id, rarete: c.rarete }));
      f.fermer();
      await rpc('jeu_equipe_cartes_raretes', { p_booster: E.cid, p_items: changes.map(c => ({ artist_id: c.artist_id, rarete: res.get(c.artist_id) })) });
      await chargerCartes(); dessinerCartes();
      snack(changes.length + ' raretés mises à jour', async () => { await rpc('jeu_equipe_cartes_raretes', { p_booster: E.cid, p_items: avant }); await chargerCartes(); dessinerCartes(); });
    });
    maj();
  }

  // ---------------------------------------------------------------------
  // 4. Joueurs
  // ---------------------------------------------------------------------

  async function sJoueurs(){
    if(E.joueur) return dessinerJoueur(await rpc('jeu_equipe_joueur', { p_user: E.joueur }));
    E.main.innerHTML = `
      ${tete('Joueurs', 'Cherche un joueur pour voir son jeu, lui donner des vinyles ou lui offrir une carte.')}
      <label class="ee-recherche grand">${api.ico('loupe', 16)}<input type="search" data-in="joueur-q" value="${esc(E.joueurQ)}" placeholder="Pseudo du joueur" aria-label="Pseudo du joueur" autocomplete="off"></label>
      <div data-joueurs></div>`;
    await listerJoueurs();
  }

  async function listerJoueurs(){
    const z = $('[data-joueurs]'); if(!z) return;
    const l = await rpc('jeu_equipe_joueurs', { p_q: E.joueurQ.trim() || null });
    z.innerHTML = l.length ? `<div class="ee-joueurs">${l.map(j => `
      <button type="button" class="ee-joueur" data-act="joueur-ouvrir" data-id="${esc(j.id)}">
        ${j.avatar ? `<img class="ee-avatar" src="${esc(api.safeUrl(j.avatar))}" alt="" loading="lazy">` : `<span class="ee-avatar">${esc(String(j.pseudo || '?').slice(0, 1).toUpperCase())}</span>`}
        <span class="ee-nom"><b>${esc(j.pseudo || 'Sans pseudo')}</b><small>Niveau ${j.niveau} · ${nf(j.ouvertures)} packs · ${nf(j.cartes)} cartes</small></span>
        <span class="ee-soldes"><b>${nf(j.vinyles)}</b> vinyles<small>${nf(j.wc)} Wave Coins</small></span>
      </button>`).join('')}</div>`
      : vide(E.joueurQ.trim() ? 'Aucun joueur trouvé' : 'Personne n\'a encore joué', E.joueurQ.trim() ? 'Vérifie l\'orthographe du pseudo.' : 'Cherche un pseudo pour donner un premier vinyle.');
  }

  async function ouvrirJoueur(id){
    E.joueur = id;
    return sJoueurs();
  }

  async function dessinerJoueur(d){
    const p = d.profil || {}, j = d.jeu || {};
    const jr = await api.appel('jeu_equipe_journal', { p_limite: 12, p_cible: E.joueur });
    E.main.innerHTML = `
      <button type="button" class="ct-lien ee-retour" data-act="joueur-retour">${ic('fleche', 14)}Joueurs</button>
      <header class="ee-tete joueur">
        ${p.avatar ? `<img class="ee-avatar grand" src="${esc(api.safeUrl(p.avatar))}" alt="">` : `<span class="ee-avatar grand">${esc(String(p.pseudo || '?').slice(0, 1).toUpperCase())}</span>`}
        <div><h2>${esc(p.pseudo || 'Sans pseudo')}</h2><p>Niveau ${j.niveau} · ${nf(j.xp)} XP${j.inscrit ? '' : ' · n\'a pas encore ouvert le jeu'}</p></div>
      </header>
      <div class="ee-kpis">
        <div class="ee-kpi"><b>${nf(j.vinyles)}</b><span>Vinyles</span></div><div class="ee-kpi"><b>${nf(d.wc)}</b><span>Wave Coins</span></div>
        <div class="ee-kpi"><b>${nf(j.ouvertures)}</b><span>Packs ouverts</span></div><div class="ee-kpi"><b>${nf(j.holos)}</b><span>Cartes holo</span></div>
      </div>
      <div class="ee-grille2">
        <section class="ee-bloc"><h3>Vinyles</h3>
          <p class="ee-aide">1 vinyle = 1 pack. De 1 à 1 000 à la fois.</p>
          <div class="ee-ligne2"><label class="ee-champ"><span>Combien</span><input type="number" min="1" max="1000" value="5" data-v></label>
          <label class="ee-champ"><span>Motif (facultatif)</span><input data-m maxlength="120" placeholder="Cadeau, correction…"></label></div>
          <div class="ee-actions-col row"><button type="button" class="ct-btn principal" data-act="joueur-vinyles" data-s="1">Donner</button><button type="button" class="ct-btn" data-act="joueur-vinyles" data-s="-1">Retirer</button></div>
        </section>
        <section class="ee-bloc"><h3>Cartes</h3>
          <label class="ee-champ"><span>Collection</span><select data-in="joueur-col" data-c>${E.boosters.map(b => `<option value="${esc(b.id)}">${esc(b.nom)}</option>`).join('')}</select></label>
          <label class="ee-champ"><span>Artiste</span><select data-a><option>Chargement…</option></select></label>
          <div class="ee-ligne2"><label class="ee-champ"><span>Exemplaires</span><input type="number" min="1" max="20" value="1" data-q2></label>
          <label class="ee-case bas"><input type="checkbox" data-h> Version holo</label></div>
          <div class="ee-actions-col row"><button type="button" class="ct-btn principal" data-act="joueur-carte" data-s="1">Offrir</button><button type="button" class="ct-btn" data-act="joueur-carte" data-s="-1">Retirer</button></div>
        </section>
      </div>
      <h3 class="ee-titre">Collections</h3>
      <div class="ee-colonnes">${(d.collections || []).map(c => `<article class="ee-col-ligne"><div class="ee-col-txt"><b>${esc(c.nom)}</b><small>${nf(c.possedees)} / ${nf(c.total)} cartes · ${nf(c.exemplaires)} exemplaire${c.exemplaires > 1 ? 's' : ''}</small><div class="ee-progres"><i style="width:${c.total ? Math.round(c.possedees / c.total * 100) : 0}%"></i></div></div></article>`).join('')}</div>
      ${(d.recentes || []).length ? `<h3 class="ee-titre">Dernières cartes obtenues</h3><div class="ee-recentes">${d.recentes.map(c => `<div class="ee-rec" style="--rc:${rar(c.rarete || 1).c}" title="${esc(c.nom)} · ${esc(nomCol(c.booster))}"><img src="${esc(api.safeUrl(c.photo))}" alt="" loading="lazy"><span>${esc(c.nom)}${c.holo ? ' ✦' : ''}${c.quantite > 1 ? ' ×' + c.quantite : ''}</span></div>`).join('')}</div>` : ''}
      <h3 class="ee-titre">Gestes de l'équipe sur ce joueur</h3>
      ${jr.length ? `<ul class="ee-journal">${jr.map(ligneJournal).join('')}</ul>` : '<p class="sous">Aucun geste pour l\'instant.</p>'}`;
    chargerArtistesOffre(E.boosters.length ? E.boosters[0].id : '');
  }

  async function chargerArtistesOffre(booster){
    const s = $('[data-a]'); if(!s || !booster) return;
    try{
      if(!E.cacheCartes[booster]) E.cacheCartes[booster] = await api.appel('jeu_equipe_cartes', { p_booster: booster });
      s.innerHTML = E.cacheCartes[booster].map(c => `<option value="${esc(c.artist_id)}">${esc(String(c.numero).padStart(2, '0'))} · ${esc(c.nom)} (${esc(rar(c.rarete).nom)})</option>`).join('') || '<option value="">Collection vide</option>';
    }catch(e){ s.innerHTML = '<option value="">Indisponible</option>'; }
  }

  async function gestVinyles(sens){
    const n = Math.floor(Number($('[data-v]').value));
    if(!(n >= 1 && n <= 1000)){ api.toast('Choisis entre 1 et 1 000 vinyles.', 'err'); return; }
    const d = await rpc('jeu_equipe_vinyles', { p_user: E.joueur, p_delta: sens * n, p_motif: $('[data-m]').value.trim() || null });
    api.toast(sens > 0 ? 'Vinyles donnés' : 'Vinyles retirés');
    return dessinerJoueur(d);
  }

  async function gestCarte(sens){
    const a = $('[data-a]').value, n = Math.floor(Number($('[data-q2]').value));
    if(!a){ api.toast('Choisis un artiste.', 'err'); return; }
    if(!(n >= 1 && n <= 20)){ api.toast('Choisis entre 1 et 20 exemplaires.', 'err'); return; }
    const d = await rpc('jeu_equipe_carte_donner', { p_user: E.joueur, p_booster: $('[data-c]').value, p_artist: a, p_holo: $('[data-h]').checked, p_quantite: sens * n });
    api.toast(sens > 0 ? 'Carte offerte' : 'Carte retirée');
    return dessinerJoueur(d);
  }

  // ---------------------------------------------------------------------
  // 5 et 6. Combat et marché : des panneaux fournis par leurs modules
  // ---------------------------------------------------------------------

  // ---------------------------------------------------------------------
  // Morceau et clip d'une carte Mythique (sql/cartes-son-artiste.sql)
  // ---------------------------------------------------------------------

  // L'identifiant d'une vidéo YouTube depuis un lien collé (watch, youtu.be, shorts, embed, live) ou l'identifiant seul.
  function ytId(texte){
    const t = String(texte || '').trim();
    if(/^[A-Za-z0-9_-]{11}$/.test(t)) return t;
    const m = t.match(/(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/|shorts\/|live\/|v\/))([A-Za-z0-9_-]{11})/);
    return m ? m[1] : null;
  }
  // « 1:30 », « 90 », « 1m30s » → des secondes.
  function tempsEnSecondes(texte){
    const t = String(texte || '').trim().toLowerCase();
    if(!t) return 0;
    let m = t.match(/^(?:(\d+):)?(\d+):(\d{1,2})$/);
    if(m) return (Number(m[1] || 0) * 3600) + Number(m[2]) * 60 + Number(m[3]);
    m = t.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/);
    if(m && (m[1] || m[2] || m[3])) return Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0);
    return NaN;
  }
  const secondesEnTexte = (n) => { n = Math.max(0, Math.round(n || 0)); return Math.floor(n / 60) + ':' + String(n % 60).padStart(2, '0'); };

  async function sonCarte(artistId){
    const c = E.cartes.find((x) => x.artist_id === artistId);
    if(!c) return;
    const etat = { titre: c.son_titre || null, nom: c.son_nom || '', debut: Number(c.son_debut) || 0, liste: [], audio: null, ecoute: null };
    let clipTexte = c.clip_id ? 'https://www.youtube.com/watch?v=' + c.clip_id : '';
    let clipDebut = Number(c.clip_debut) || 0;

    const fen = api.fenetre(`
      <div class="ee-fen-son">
        <h2>Son de ${esc(c.nom || 'l\'artiste')}</h2>
        <p class="ee-aide">Se joue quand cette carte sort en Mythique, à l'instant et au volume réglés dans « Sons ». Le morceau tourne en boucle tant que la carte n'est pas passée.</p>
        <section class="ee-bloc">
          <h3>Morceau</h3>
          <div class="ee-son-liste" data-liste><div class="ct-vide">Chargement des morceaux…</div></div>
          <div class="ee-champ"><span>Départ dans l'extrait de 30 s : <b data-debut-txt></b></span>
            <input type="range" min="0" max="29" step="1" data-debut value="${etat.debut}">
            <small>Deezer ne donne que 30 secondes de chaque morceau : elles sont prises au milieu du titre.</small></div>
          <div><button type="button" class="ct-btn petit" data-ecouter>${api.ico('son', 14)}Écouter depuis ce point</button></div>
        </section>
        <section class="ee-bloc">
          <h3>Clip en fond (YouTube)</h3>
          <label class="ee-champ"><span>Lien YouTube</span>
            <input type="url" inputmode="url" placeholder="https://www.youtube.com/watch?v=…" data-clip value="${esc(clipTexte)}"></label>
          <div class="ee-clip-info" data-clip-info></div>
          <label class="ee-champ"><span>Départ du clip</span>
            <input type="text" inputmode="numeric" placeholder="0:00" data-clip-debut value="${clipDebut ? esc(secondesEnTexte(clipDebut)) : ''}">
            <small>Minutes:secondes, ou secondes (ex. 1:30 ou 90). Le clip tourne en boucle derrière la carte, en plein écran et sans sous-titres.</small></label>
          <label class="ee-case"><input type="checkbox" data-clip-son ${c.clip_son ? 'checked' : ''}> Jouer le son du clip (le morceau en entier) à la place de l'extrait Deezer de 30 s</label>
          <small class="ee-aide">Le clip démarre dès que la carte est touchée et le son s'allume à l'instant réglé dans « Sons » : mets le départ du clip environ 2 secondes avant l'endroit voulu.</small>
        </section>
        <div class="ee-son-barre">
          <span class="ee-etat" data-etat></span>
          <button type="button" class="ct-btn" data-retirer>Tout retirer</button>
          <button type="button" class="ct-btn principal" data-sauver>Enregistrer</button>
        </div>
      </div>`, true, () => { arreter(); });

    const z = fen.corps, $z = (sel) => z.querySelector(sel);
    function arreter(){ if(etat.audio){ try{ etat.audio.pause(); }catch(e){} etat.audio = null; etat.ecoute = null; } majLignes(); }
    function jouer(url, id, depart){
      if(etat.audio && etat.ecoute === id && !depart){ arreter(); return; }
      arreter();
      const a = new Audio(url);
      a.volume = .8;
      etat.audio = a; etat.ecoute = id;
      if(depart) a.addEventListener('loadedmetadata', () => { try{ a.currentTime = depart; }catch(e){} }, { once: true });
      a.onended = () => { if(etat.audio === a){ etat.audio = null; etat.ecoute = null; majLignes(); } };
      a.play().catch(() => { api.toast('Lecture impossible ici.', 'err'); arreter(); });
      majLignes();
    }
    function majLignes(){
      z.querySelectorAll('[data-t]').forEach((l) => {
        const id = Number(l.dataset.t);
        l.classList.toggle('choisi', id === etat.titre);
        const b = l.querySelector('[data-jouer]');
        if(b) b.innerHTML = etat.ecoute === id ? '❚❚' : '▶';
      });
    }
    function majDebut(){ $z('[data-debut-txt]').textContent = secondesEnTexte(etat.debut) + ' / 0:30'; }
    function majClip(){
      const id = ytId($z('[data-clip]').value);
      const zone = $z('[data-clip-info]');
      const v = $z('[data-clip]').value.trim();
      if(!v){ zone.innerHTML = ''; return; }
      zone.innerHTML = id
        ? `<img src="https://i.ytimg.com/vi/${esc(id)}/mqdefault.jpg" alt="" loading="lazy"><span>Lien reconnu. Si le clip ne se joue pas en jeu, c'est que son propriétaire interdit de l'intégrer ailleurs.</span>`
        : '<span class="ee-clip-err">Ce lien YouTube n\'est pas reconnu.</span>';
    }
    majDebut(); majClip();

    z.addEventListener('input', (ev) => {
      if(ev.target.matches('[data-debut]')){ etat.debut = Number(ev.target.value) || 0; majDebut(); }
      else if(ev.target.matches('[data-clip]')){
        majClip();
        // Un lien avec « &t=90 » ou « ?start=90 » donne aussi le départ.
        const m = ev.target.value.match(/[?&](?:t|start)=([0-9hms]+)/);
        const champ = $z('[data-clip-debut]');
        if(m && !champ.value){ const sec = tempsEnSecondes(m[1]); if(sec > 0) champ.value = secondesEnTexte(sec); }
      }
    });
    z.addEventListener('click', (ev) => {
      const t = ev.target.closest('button');
      if(!t) return;
      if(t.matches('[data-jouer]')){
        const l = t.closest('[data-t]'); const tr = etat.liste.find((x) => x.id === Number(l.dataset.t));
        if(tr) jouer(tr.preview, tr.id, 0);
      }else if(t.matches('[data-choisir]')){
        const l = t.closest('[data-t]'); const tr = etat.liste.find((x) => x.id === Number(l.dataset.t));
        if(tr){ etat.titre = tr.id; etat.nom = tr.titre; majLignes(); }
      }else if(t.matches('[data-ecouter]')){
        const tr = etat.liste.find((x) => x.id === etat.titre);
        if(!tr){ api.toast('Choisis d\'abord un morceau.', 'err'); return; }
        jouer(tr.preview, tr.id, etat.debut);
      }else if(t.matches('[data-retirer]')){
        etat.titre = null; etat.nom = ''; etat.debut = 0; $z('[data-debut]').value = 0; majDebut();
        $z('[data-clip]').value = ''; $z('[data-clip-debut]').value = ''; $z('[data-clip-son]').checked = false; majClip(); majLignes();
      }else if(t.matches('[data-sauver]')){
        sauver(t);
      }
    });

    async function sauver(bouton){
      const lien = $z('[data-clip]').value.trim();
      const id = lien ? ytId(lien) : null;
      if(lien && !id){ api.toast('Ce lien YouTube n\'est pas reconnu.', 'err'); return; }
      const dep = tempsEnSecondes($z('[data-clip-debut]').value);
      if(Number.isNaN(dep)){ api.toast('Le départ du clip s\'écrit 1:30 ou 90.', 'err'); return; }
      bouton.disabled = true;
      try{
        const v = await api.appel('jeu_equipe_carte_son', { p_booster: E.cid, p_artiste: artistId, p_titre: etat.titre, p_nom: etat.nom || null, p_debut: etat.debut, p_clip: id, p_clip_debut: id ? dep : 0, p_clip_son: !!($z('[data-clip-son]') && $z('[data-clip-son]').checked) });
        Object.assign(c, v);
        api.toast(v.son_titre || v.clip_id ? 'Enregistré : s\'applique à la prochaine Mythique de ' + (c.nom || 'l\'artiste') + '.' : 'Son et clip retirés.');
        fen.fermer();
        dessinerCartes();
      }catch(e){
        api.toast(e.message || 'L\'enregistrement a échoué.', 'err');
        bouton.disabled = false;
      }
    }

    // Les morceaux de l'artiste : son identifiant Deezer, puis ses titres les plus écoutés.
    try{
      let idDz = null;
      if(typeof supabaseClient !== 'undefined'){
        const { data } = await supabaseClient.from('artists').select('deezer_artist_id').eq('id', artistId).maybeSingle();
        idDz = data && data.deezer_artist_id;
      }
      if(!idDz){ $z('[data-liste]').innerHTML = '<div class="ct-vide">Cet artiste n\'est pas relié à Deezer : pas de morceau à choisir.</div>'; return; }
      etat.liste = await api.Extrait.titresArtiste(idDz);
      if(etat.titre && !etat.liste.some((t) => t.id === etat.titre) && etat.nom) etat.liste.unshift({ id: etat.titre, titre: etat.nom, album: 'Choix actuel', cover: '', preview: '' });
      $z('[data-liste]').innerHTML = etat.liste.length
        ? etat.liste.map((t) => `<div class="ee-titre-ligne" data-t="${t.id}">
            ${t.cover ? `<img src="${esc(api.safeUrl(t.cover))}" alt="" loading="lazy">` : '<span class="ee-titre-img"></span>'}
            <div class="ee-nom"><b>${esc(t.titre)}</b><small>${esc(t.album)}</small></div>
            ${t.preview ? '<button type="button" class="ee-ib" data-jouer aria-label="Écouter">▶</button>' : ''}
            <button type="button" class="ct-btn petit" data-choisir>Choisir</button></div>`).join('')
        : '<div class="ct-vide">Deezer ne propose aucun extrait pour cet artiste.</div>';
      majLignes();
    }catch(e){
      $z('[data-liste]').innerHTML = '<div class="ct-vide">Les morceaux n\'ont pas pu être chargés. Réessaie dans un instant.</div>';
    }
  }

  // ---------------------------------------------------------------------
  // Sons : ce qui se joue quand une carte Mythique est révélée (sql/cartes-son-mythique.sql)
  // ---------------------------------------------------------------------

  const SONS_CHOIX = [
    ['fanfare', 'Fanfare (par défaut)', 'Un grand coup de basse, un accord qui gonfle, un arpège qui monte.'],
    ['impact', 'Impact grave', 'Un seul coup de basse très profond.'],
    ['cristal', 'Cristal', 'Quatre notes douces qui s\'égrènent.'],
    ['artiste', 'Extrait de l\'artiste', 'Les 30 secondes de son titre le plus écouté sur Deezer, joué sur sa propre carte. Il ne s\'écoute pas ici : il faut une vraie carte.'],
    ['fichier', 'Mon fichier audio', 'Un son que tu envoies : mp3, wav, ogg ou m4a, 2 Mo au plus.'],
    ['aucun', 'Aucun son', 'Rien ne se joue à la révélation.']
  ];
  const SON_T_MONTEE = 1.9, SON_T_FLIP = 2.05, SON_T_FIN = 6.05;

  // « 0,5 s avant le retournement », « Au retournement de la carte ».
  function sonDelaiTexte(ms){
    if(!ms) return 'au retournement de la carte';
    const s = String(Math.round(Math.abs(ms) / 10) / 100).replace('.', ',');
    return s + ' s ' + (ms < 0 ? 'avant' : 'après') + ' le retournement';
  }

  async function sSons(){
    E.main.innerHTML = tete('Sons', 'Ce qui se joue quand un joueur tombe sur une carte Mythique. Pour choisir le morceau et le clip d\'un artiste, ouvre l\'onglet Cartes : un bouton ♪ apparaît à côté de ses cartes Mythiques.') + '<div data-son><div class="ct-vide">Chargement…</div></div>';
    let cfg;
    try{ cfg = api.SonMythique.valider(await api.appel('jeu_reglage_son_mythique')); }
    catch(e){
      $('[data-son]').innerHTML = vide('Les réglages de son ne sont pas encore activés', 'Le fichier cartes-son-mythique.sql n\'a pas été passé dans Supabase.');
      return;
    }
    E.son = Object.assign({}, cfg);
    E.sonNom = '';
    $('[data-son]').innerHTML = `
      <section class="ee-bloc ee-son">
        <h3>Cartes Mythiques : réglage général</h3>
        <label class="ee-champ"><span>Son à la révélation (quand l'artiste n'a pas de morceau choisi)</span>
          <select data-in="son-choix">${SONS_CHOIX.map(([id, nom]) => `<option value="${id}" ${id === E.son.son ? 'selected' : ''}>${esc(nom)}</option>`).join('')}</select>
          <small data-son-aide></small></label>
        <div class="ee-champ" data-son-zone-fichier><span>Fichier audio</span>
          <input type="file" data-in="son-fichier" accept="audio/mpeg,audio/wav,audio/ogg,audio/mp4,audio/webm,.mp3,.wav,.ogg,.m4a">
          <small data-son-fichier-nom></small></div>
        <div class="ee-champ"><span>Quand il se lance : <b data-son-delai-texte></b></span>
          <input type="range" min="-2000" max="4000" step="50" data-in="son-delai" value="${E.son.delai_ms}" aria-label="Instant du son, en millisecondes autour du retournement">
          <div class="ee-son-reperes">
            <button type="button" class="ct-btn petit" data-act="son-repere" data-ms="-1500">Pendant la montée</button>
            <button type="button" class="ct-btn petit" data-act="son-repere" data-ms="0">Au retournement</button>
            <button type="button" class="ct-btn petit" data-act="son-repere" data-ms="1000">1 s après</button>
          </div></div>
        <div class="ee-son-tl" data-son-tl aria-hidden="true">
          <div class="ee-son-piste"><i class="ee-son-montee" data-son-montee></i><i class="ee-son-pin flip" data-son-flip></i><i class="ee-son-pin son" data-son-pin></i></div>
          <div class="ee-son-legende"><span>0 s</span><span data-son-leg-montee>Montée</span><span data-son-leg-flip>Retournement</span><span data-son-leg-son>Son</span></div>
        </div>
        <label class="ee-champ"><span>Volume : <b data-son-vol-texte></b></span>
          <input type="range" min="0" max="100" step="5" data-in="son-volume" value="${E.son.volume}"></label>
        <label class="ee-case"><input type="checkbox" data-in="son-montee" ${E.son.montee ? 'checked' : ''}> Jouer la montée sonore avant le retournement</label>
        <div class="ee-son-barre">
          <span class="ee-etat" data-son-etat></span>
          <button type="button" class="ct-btn" data-act="son-ecouter">${api.ico('son', 16)}Écouter</button>
          <button type="button" class="ct-btn principal" data-act="son-sauver">Enregistrer</button>
        </div>
      </section>`;
    sonMajVue();
  }

  // Remet à jour tout ce qui dépend du réglage en cours (libellés, repères, frise) sans toucher aux champs que l'on tape.
  function sonMajVue(depuisRepere){
    const d = E.son, z = $('[data-son]');
    if(!z) return;
    const choix = SONS_CHOIX.find((c) => c[0] === d.son) || SONS_CHOIX[0];
    $('[data-son-aide]').textContent = choix[2];
    $('[data-son-zone-fichier]').hidden = d.son !== 'fichier';
    $('[data-son-fichier-nom]').textContent = d.url ? 'Fichier actuel : ' + (E.sonNom || decodeURIComponent(String(d.url).split('/').pop())) : 'Aucun fichier envoyé pour l\'instant.';
    $('[data-son-delai-texte]').textContent = sonDelaiTexte(d.delai_ms);
    $('[data-son-vol-texte]').textContent = d.volume + ' %';
    if(depuisRepere){ const r = $('[data-in="son-delai"]'); if(r) r.value = d.delai_ms; }
    const pct = (t) => Math.max(0, Math.min(100, t / SON_T_FIN * 100));
    const montee = $('[data-son-montee]');
    montee.style.width = pct(SON_T_MONTEE) + '%';
    montee.classList.toggle('coupee', !d.montee);
    $('[data-son-flip]').style.left = pct(SON_T_FLIP) + '%';
    const pin = $('[data-son-pin]');
    pin.style.left = pct(SON_T_FLIP + d.delai_ms / 1000) + '%';
    pin.classList.toggle('muet', d.son === 'aucun' || d.volume === 0);
    $('[data-son-leg-son]').textContent = d.son === 'aucun' ? 'Pas de son' : 'Son : ' + (SONS_CHOIX.find((c) => c[0] === d.son) || ['', ''])[1].split(' (')[0].toLowerCase();
    $('[data-son-etat]').textContent = '';
  }

  async function sonEnvoyer(fichier, champ){
    if(!fichier) return;
    const types = { 'audio/mpeg': '.mp3', 'audio/mp3': '.mp3', 'audio/wav': '.wav', 'audio/x-wav': '.wav', 'audio/ogg': '.ogg', 'audio/mp4': '.m4a', 'audio/x-m4a': '.m4a', 'audio/webm': '.webm' };
    const ext = types[fichier.type];
    if(!ext){ api.toast('Choisis un fichier mp3, wav, ogg ou m4a.', 'err'); champ.value = ''; return; }
    if(fichier.size > 2 * 1024 * 1024){ api.toast('2 Mo au plus : ce fichier est trop lourd.', 'err'); champ.value = ''; return; }
    if(typeof supabaseClient === 'undefined'){ api.toast('Le stockage n\'est pas disponible ici.', 'err'); return; }
    const nom = Date.now() + '-mythique' + ext;
    $('[data-son-fichier-nom]').textContent = 'Envoi en cours…';
    const { error } = await supabaseClient.storage.from('sons-jeu').upload(nom, fichier, { contentType: fichier.type, upsert: false });
    if(error){ api.toast('Envoi impossible : ' + error.message, 'err'); sonMajVue(); return; }
    E.son.url = supabaseClient.storage.from('sons-jeu').getPublicUrl(nom).data.publicUrl;
    E.sonNom = fichier.name;
    api.toast('Fichier envoyé. Pense à enregistrer.');
    sonMajVue();
  }

  function sonEcouter(){
    const ok = api.SonMythique.apercu(E.son);
    if(!ok) api.toast('L\'extrait d\'un artiste se joue sur sa carte : ouvre un pack pour l\'entendre.', 'err');
  }

  async function sonSauver(){
    const d = E.son;
    if(d.son === 'fichier' && !d.url){ api.toast('Envoie un fichier audio, ou choisis un autre son.', 'err'); return; }
    const bouton = $('[data-act="son-sauver"]');
    bouton.disabled = true;
    try{
      const v = await api.appel('jeu_equipe_son_mythique_sauver', { p_donnees: { son: d.son, delai_ms: d.delai_ms, volume: d.volume, montee: d.montee, url: d.url } });
      E.son = Object.assign({}, api.SonMythique.valider(v));
      api.SonMythique.invalider();
      api.toast('Son enregistré : il s\'applique à la prochaine carte Mythique.');
      $('[data-son-etat]').textContent = 'Enregistré';
    }catch(e){
      api.toast(e.message || 'L\'enregistrement a échoué.', 'err');
    }finally{
      bouton.disabled = false;
    }
  }

  async function sModule(nom, global, titre, texte){
    E.main.innerHTML = tete(titre, texte) + '<div data-module><div class="ct-vide">Chargement…</div></div>';
    const z = $('[data-module]');
    try{
      await window.chargerWaveModule(nom);
      const m = window[global];
      if(!m || typeof m.equipe !== 'function'){ z.innerHTML = vide('Pas encore prêt', 'Ce panneau arrive avec le module ' + titre.toLowerCase() + '.'); return; }
      z.innerHTML = '';
      await m.equipe(z, api);
    }catch(e){
      z.innerHTML = vide('Ce panneau ne s\'est pas ouvert', e.message || String(e));
    }
  }

  // ---------------------------------------------------------------------
  // La feuille de style
  // ---------------------------------------------------------------------

  function poserStyle(){
    if(document.getElementById('ee-style')) return;
    const s = document.createElement('style');
    s.id = 'ee-style';
    s.textContent = STYLE;
    document.head.appendChild(s);
  }

  const STYLE = `
  .ee{display:grid; grid-template-columns:200px minmax(0, 1fr); gap:30px; align-items:start; max-width:1180px; padding:0 0 90px; color:var(--ink);}
  .ee *{box-sizing:border-box;}
  .ee-ico{flex:none; display:block;}
  .sr{position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap;}
  .ee-nav{position:sticky; top:14px; display:flex; flex-direction:column; gap:4px;}
  .ee-nav button{appearance:none; border:0; background:transparent; font:inherit; color:var(--ink-soft); display:flex; align-items:center; gap:11px; height:44px; padding:0 14px; border-radius:12px; cursor:pointer; text-align:left; font-size:14.5px; font-weight:600; transition:background .15s, color .15s;}
  .ee-nav button:hover{background:var(--ct-surface); color:var(--ink);}
  .ee-nav button.actif{background:var(--ct-surface-2); color:var(--ink); box-shadow:inset 3px 0 0 var(--ct-accent);}
  .ee-nav button:focus-visible{outline:2px solid var(--ct-accent); outline-offset:2px;}
  .ee-main{min-width:0; animation:ctFondu .3s ease both;}
  .ee-tete{display:flex; align-items:flex-start; justify-content:space-between; gap:16px; margin:0 0 22px; flex-wrap:wrap;}
  .ee-tete h2{margin:0; font-size:clamp(24px, 3vw, 32px); letter-spacing:-.02em; line-height:1.1;}
  .ee-tete p{margin:7px 0 0; font-size:14px; color:var(--ink-soft); max-width:60ch;}
  .ee-tete.joueur{justify-content:flex-start; align-items:center; gap:16px;}
  .ee-titre{margin:30px 0 12px; font-size:12.5px; font-weight:700; letter-spacing:.1em; text-transform:uppercase; color:var(--muted);}
  .ee-titre-ligne{display:flex; align-items:baseline; justify-content:space-between; gap:12px;}
  .ee-retour{margin-bottom:14px;}
  .ee-kpis{display:grid; grid-template-columns:repeat(auto-fit, minmax(150px, 1fr)); gap:12px;}
  .ee-kpi{display:grid; gap:2px; padding:16px; border-radius:16px; border:1px solid var(--ct-trait); background:var(--ct-surface);}
  .ee-kpi b{font-size:26px; letter-spacing:-.02em; font-variant-numeric:tabular-nums;}
  .ee-kpi span{font-size:13px; color:var(--ink-soft);}
  .ee-kpi small{font-size:12px; color:var(--muted);}
  .ee-colonnes{display:grid; gap:10px;}
  .ee-col-ligne{display:flex; align-items:center; gap:14px; padding:12px 14px; border-radius:16px; border:1px solid var(--ct-trait); background:var(--ct-surface);}
  .ee-mini{flex:none; width:58px; height:58px; border-radius:8px; overflow:hidden; background:linear-gradient(160deg, #0d2b4c, #08121f); display:grid; place-items:center; box-shadow:0 8px 18px -10px rgba(0,0,0,.8);}
  .ee-mini img, .ee-tuile-img img, .ee-visuel-img img{width:100%; height:100%; object-fit:cover; display:block;}
  .ee-mini .vide, .ee-tuile-img .vide, .ee-visuel-img .vide{display:grid; place-items:center; width:100%; height:100%; color:#fff;}
  .ee-mini .vide svg, .ee-tuile-img .vide svg, .ee-visuel-img .vide svg{width:55%; height:auto;}
  .ee-col-txt{flex:1; min-width:0; display:grid; gap:5px;}
  .ee-ligne-nom{display:flex; align-items:center; gap:8px; flex-wrap:wrap;}
  .ee-col-txt b{font-size:15.5px;}
  .ee-col-txt small, .ee-tuile-txt small{font-size:12.5px; color:var(--muted);}
  .ee-col-act{display:flex; gap:8px; flex:none;}
  .ee-puce{display:inline-flex; align-items:center; height:20px; padding:0 8px; border-radius:99px; font-size:11px; font-weight:700; letter-spacing:.05em; color:var(--ink-soft); background:rgba(255,255,255,.07);}
  .ee-puce.ok{color:#5BE0A6; background:rgba(91,224,166,.12);}
  .ee-barre{display:flex; gap:2px; height:6px; border-radius:99px; overflow:hidden; background:rgba(255,255,255,.06);}
  .ee-barre i{display:block; min-width:3px;}
  .ee-journal{list-style:none; margin:0; padding:0; display:grid; gap:2px;}
  .ee-journal li{display:flex; align-items:baseline; gap:6px; flex-wrap:wrap; padding:10px 4px; border-bottom:1px solid var(--ct-trait); font-size:14px; color:var(--ink-soft);}
  .ee-journal li b, .ee-j-qui{color:var(--ink); font-weight:700;}
  .ee-journal time{margin-left:auto; font-size:12px; color:var(--muted);}
  .ee-journal.long{max-height:60vh; overflow:auto;}
  .ee-raccourcis, .ee-presets{display:flex; flex-wrap:wrap; gap:10px;}
  /* tuiles de collections */
  .ee-tuiles{display:grid; grid-template-columns:repeat(auto-fill, minmax(250px, 1fr)); gap:18px;}
  .ee-tuile{appearance:none; font:inherit; color:inherit; text-align:left; display:grid; gap:12px; padding:14px; border-radius:20px; border:1px solid var(--ct-trait); background:var(--ct-surface);}
  .ee-tuile-img{appearance:none; border:0; padding:0; cursor:pointer; display:block; aspect-ratio:1; border-radius:10px; overflow:hidden; background:linear-gradient(160deg, #0d2b4c, #08121f); box-shadow:0 18px 34px -16px rgba(0,0,0,.85); transition:transform .2s;}
  .ee-tuile-img:hover{transform:translateY(-3px);}
  .ee-tuile-img:focus-visible{outline:2px solid var(--ct-accent); outline-offset:3px;}
  .ee-tuile-txt{display:grid; gap:6px;}
  .ee-tuile-txt b{font-size:17px; letter-spacing:-.01em;}
  .ee-tuile-txt > span{display:flex; align-items:center; gap:8px; flex-wrap:wrap;}
  .ee-tuile-act{display:flex; align-items:center; gap:8px;}
  .ee-ordre{margin-left:auto; display:flex; gap:4px;}
  .ee-tuile.nouvelle{cursor:pointer; place-items:center; align-content:center; text-align:center; min-height:300px; border-style:dashed; border-color:var(--ct-trait-fort); color:var(--ink-soft); transition:background .2s, color .2s;}
  .ee-tuile.nouvelle:hover{background:var(--ct-surface-2); color:var(--ink);}
  .ee-tuile.nouvelle b{font-size:16px; color:var(--ink);}
  .ee-tuile.nouvelle small{font-size:12.5px; max-width:22ch;}
  .ee-ib{appearance:none; border:1px solid var(--ct-trait); background:var(--ct-surface); color:var(--ink-soft); width:32px; height:32px; border-radius:9px; display:grid; place-items:center; cursor:pointer; padding:0; transition:background .15s, color .15s;}
  .ee-ib:hover{background:var(--ct-surface-2); color:var(--ink);}
  .ee-ib.danger:hover{color:#ff8a8a; border-color:rgba(255,120,120,.4);}
  .ee-ib[disabled]{opacity:.3; cursor:default;}
  .ee-ib:focus-visible{outline:2px solid var(--ct-accent); outline-offset:2px;}
  .ct-btn.danger{color:#ff9a9a; border-color:rgba(255,120,120,.3);}
  .ct-btn.danger:hover{background:rgba(255,90,90,.12);}
  /* formulaire de collection */
  /* Deux colonnes seulement s'il y a la place : dans l'espace équipe la console est coincée entre deux menus, la largeur de
     l'écran ne dit rien de la largeur disponible. */
  .ee-grille2{display:grid; grid-template-columns:repeat(auto-fit, minmax(min(100%, 340px), 1fr)); gap:18px; align-items:start;}
  .ee-grille2 > *{min-width:0;}
  .ee-pile{display:grid; gap:18px;}
  .ee-bloc{padding:20px; border-radius:20px; border:1px solid var(--ct-trait); background:var(--ct-surface); display:grid; gap:14px;}
  .ee-bloc h3{margin:0; font-size:13px; font-weight:700; letter-spacing:.1em; text-transform:uppercase; color:var(--muted);}
  .ee-champ{display:grid; gap:6px; font-size:13px; color:var(--ink-soft); min-width:0;}
  .ee-champ > span:first-child{font-weight:600;}
  .ee-champ small, .ee-aide{font-size:12px; color:var(--muted); margin:0;}
  .ee-champ input:not([type=checkbox]):not([type=color]):not([type=file]), .ee-champ select, .ee-champ textarea, .ee-taux input{width:100%; min-height:42px; padding:9px 12px; border-radius:12px; border:1px solid var(--ct-trait-fort); background:rgba(0,0,0,.28); color:var(--ink); font:inherit; font-size:14.5px;}
  .ee-champ textarea{resize:vertical; line-height:1.45;}
  .ee-champ input:focus-visible, .ee-champ select:focus-visible, .ee-champ textarea:focus-visible, .ee-taux input:focus-visible{outline:2px solid var(--ct-accent); outline-offset:1px; border-color:transparent;}
  .ee-ligne2{display:grid; grid-template-columns:repeat(auto-fit, minmax(min(100%, 170px), 1fr)); gap:12px; align-items:end;}
  .ee-ligne2 > *{min-width:0;}
  .ee-visuel{display:flex; gap:16px; align-items:center;}
  .ee-visuel-img{flex:none; width:120px; height:120px; border-radius:10px; overflow:hidden; background:linear-gradient(160deg, #0d2b4c, #08121f); box-shadow:0 14px 28px -14px rgba(0,0,0,.8); position:relative;}
  .ee-visuel-img.charge::after{content:'Envoi…'; position:absolute; inset:0; display:grid; place-items:center; background:rgba(0,0,0,.6); font-size:13px; font-weight:600;}
  .ee-visuel-act{display:grid; gap:8px; justify-items:start;}
  .ee-visuel-act small{font-size:12px; color:var(--muted);}
  .ee-reuse{display:grid; gap:8px;}
  .ee-reuse small{font-size:12px; color:var(--muted);}
  .ee-reuse > div{display:flex; gap:8px; flex-wrap:wrap;}
  .ee-reuse-b{appearance:none; padding:0; border:1px solid var(--ct-trait); border-radius:8px; overflow:hidden; width:54px; height:54px; cursor:pointer; background:#0a1018;}
  .ee-reuse-b img{width:100%; height:100%; object-fit:cover; display:block;}
  .ee-reuse-b:hover{border-color:var(--ct-accent);}
  .ee-theme{display:grid; place-items:center; width:56px; height:56px; border-radius:12px; color:#fff; background:linear-gradient(160deg, #0d2b4c, #08121f);}
  .ee-theme svg{width:70%; height:auto;}
  .ee-couleur{display:flex; gap:10px;}
  .ee-couleur input[type=color]{width:46px; height:42px; padding:3px; border-radius:10px; border:1px solid var(--ct-trait-fort); background:rgba(0,0,0,.28); cursor:pointer; flex:none;}
  .ee-taux{display:grid; grid-template-columns:repeat(5, minmax(0, 1fr)); gap:8px;}
  .ee-taux label{display:grid; gap:5px; font-size:11.5px; font-weight:600; color:var(--ink-soft); text-align:center;}
  .ee-taux label i{display:block; height:4px; border-radius:99px; background:var(--rc);}
  .ee-taux input{text-align:center; padding:9px 4px !important;}
  .ee-total{font-size:13px; font-weight:600; padding:7px 12px; border-radius:10px; width:fit-content;}
  .ee-total.ok{color:#5BE0A6; background:rgba(91,224,166,.1);}
  .ee-total.ko{color:#ffb86b; background:rgba(255,184,107,.12);}
  .ee-interrupteur{display:grid; grid-template-columns:auto 1fr; column-gap:12px; align-items:center; cursor:pointer;}
  .ee-interrupteur input{position:absolute; opacity:0; width:1px; height:1px;}
  .ee-sw{grid-row:1 / 3; width:46px; height:26px; border-radius:99px; background:rgba(255,255,255,.14); position:relative; transition:background .2s;}
  .ee-sw::after{content:''; position:absolute; left:3px; top:3px; width:20px; height:20px; border-radius:50%; background:#fff; transition:transform .2s;}
  .ee-interrupteur input:checked + .ee-sw{background:#1fa36a;}
  .ee-interrupteur input:checked + .ee-sw::after{transform:translateX(20px);}
  .ee-interrupteur input:focus-visible + .ee-sw{outline:2px solid var(--ct-accent); outline-offset:2px;}
  .ee-interrupteur b{font-size:14.5px;}
  .ee-interrupteur small{font-size:12px; color:var(--muted); grid-column:2;}
  .ee-actions-col{display:flex; flex-wrap:wrap; gap:10px;}
  .ee-barre-save{position:sticky; bottom:12px; z-index:5; display:none; align-items:center; gap:10px; justify-content:flex-end; margin-top:22px; padding:12px 14px; border-radius:16px; border:1px solid var(--ct-trait-fort); background:rgba(14,20,30,.94); backdrop-filter:blur(10px); box-shadow:0 20px 40px -16px rgba(0,0,0,.9);}
  .ee-barre-save.visible{display:flex;}
  .ee-etat{margin-right:auto; font-size:13.5px; color:var(--ink-soft);}
  /* cartes */
  .ee-barre-outils{display:flex; flex-wrap:wrap; gap:10px; align-items:center; margin-bottom:12px;}
  .ee-cible{min-width:200px;}
  .ee-resume{display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin-bottom:14px;}
  .ee-chip{appearance:none; font:inherit; color:var(--ink-soft); display:inline-flex; align-items:center; gap:8px; height:34px; padding:0 12px; border-radius:99px; border:1px solid var(--ct-trait); background:var(--ct-surface); cursor:pointer; font-size:13px; font-weight:600;}
  .ee-chip i{width:9px; height:9px; border-radius:50%; background:var(--rc);}
  .ee-chip b{font-variant-numeric:tabular-nums; color:var(--ink);}
  .ee-chip:hover{background:var(--ct-surface-2);}
  .ee-chip.on{border-color:var(--rc); background:color-mix(in srgb, var(--rc) 16%, transparent); color:var(--ink);}
  .ee-total-cartes{margin-left:auto; font-size:13px; color:var(--muted);}
  .ee-recherche{flex:1; min-width:200px; display:flex; align-items:center; gap:10px; height:44px; padding:0 14px; border-radius:12px; border:1px solid var(--ct-trait-fort); background:rgba(0,0,0,.28); color:var(--muted);}
  .ee-recherche.grand{width:100%; margin-bottom:18px;}
  .ee-recherche input{all:unset; flex:1; min-width:0; color:var(--ink); font-size:14.5px;}
  .ee-recherche:focus-within{outline:2px solid var(--ct-accent); outline-offset:1px;}
  #page-admin .ee-recherche input, #page-admin .ee-recherche input:hover, #page-admin .ee-recherche input:focus{min-height:0; padding:0; border:0; background:transparent; box-shadow:none; outline:none;}
  .ee-case{display:inline-flex; align-items:center; gap:8px; font-size:13.5px; color:var(--ink-soft); cursor:pointer;}
  .ee-case.bas{padding-bottom:10px;}
  .ee-case input, .ee-coche{width:18px; height:18px; accent-color:#2C9BEF; cursor:pointer; flex:none;}
  .ee-selection{position:sticky; top:8px; z-index:4; display:flex; flex-wrap:wrap; align-items:center; gap:12px; padding:10px 14px; margin-bottom:12px; border-radius:14px; border:1px solid var(--ct-accent); background:rgba(14,24,38,.96); backdrop-filter:blur(8px);}
  .ee-sel-rar{display:inline-flex; align-items:center; gap:10px; font-size:13px; color:var(--ink-soft);}
  .ee-cartes{display:grid; gap:6px;}
  .ee-carte{display:grid; grid-template-columns:20px 34px 44px minmax(0, 1fr) auto auto; align-items:center; gap:12px; padding:8px 12px; border-radius:14px; border:1px solid var(--ct-trait); background:var(--ct-surface); transition:background .15s, border-color .15s;}
  .ee-carte:hover{background:var(--ct-surface-2);}
  .ee-carte.sel{border-color:var(--ct-accent); background:rgba(79,180,255,.08);}
  .ee-num{font-size:13px; font-weight:700; color:var(--muted); font-variant-numeric:tabular-nums; text-align:right;}
  .ee-photo{width:44px; height:44px; border-radius:10px; object-fit:cover; object-position:50% 22%; background:#0a1018; display:block; flex:none;}
  .ee-nom{min-width:0; display:grid; gap:1px;}
  .ee-nom b{font-size:15px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
  .ee-nom small{font-size:12px; color:var(--muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
  .ee-pts{display:inline-flex; gap:7px; align-items:center;}
  .ee-pt{appearance:none; padding:0; width:22px; height:22px; border-radius:50%; border:2px solid color-mix(in srgb, var(--rc) 50%, transparent); background:transparent; cursor:pointer; transition:transform .12s, background .12s;}
  .ee-pt:hover{transform:scale(1.18); background:color-mix(in srgb, var(--rc) 45%, transparent);}
  .ee-pt.on{background:var(--rc); border-color:#fff; box-shadow:0 0 0 2px color-mix(in srgb, var(--rc) 40%, transparent), 0 0 14px color-mix(in srgb, var(--rc) 60%, transparent);}
  .ee-pt:focus-visible{outline:2px solid #fff; outline-offset:2px;}
  .ee-outils{display:flex; gap:5px;}
  /* fenêtres : ajout, raretés auto, aperçu */
  .ee-onglets{display:flex; gap:4px; padding:4px; border-radius:12px; background:rgba(255,255,255,.05); margin:14px 0; width:fit-content; max-width:100%; overflow-x:auto;}
  .ee-onglets button{appearance:none; border:0; background:transparent; font:inherit; color:var(--ink-soft); height:36px; padding:0 14px; border-radius:9px; cursor:pointer; font-size:13.5px; font-weight:600; white-space:nowrap;}
  .ee-onglets button.actif{background:#F4F5F6; color:#05070a;}
  .ee-ajout-rar{display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; font-size:13px; color:var(--ink-soft); margin-bottom:12px;}
  .ee-ajout-zone{display:grid; gap:12px;}
  .ee-resultats{display:grid; gap:6px; max-height:44vh; overflow:auto; padding-right:2px;}
  .ee-res{display:flex; align-items:center; gap:12px; padding:8px 10px; border-radius:12px; border:1px solid var(--ct-trait); background:var(--ct-surface);}
  .ee-res .ee-nom{flex:1;}
  .ee-res.compact{padding:5px 10px;}
  .ee-res.compact .ee-photo{width:34px; height:34px;}
  .ee-res.introuvable{opacity:.6;}
  .ee-res.introuvable .ee-photo{border:1px dashed var(--ct-trait-fort);}
  .ee-taux-auto{margin:16px 0 10px;}
  .ee-auto-nb{display:flex; flex-wrap:wrap; gap:8px 14px; margin:12px 0 4px; font-size:13px;}
  .ee-auto-nb span{display:inline-flex; align-items:center; gap:6px; color:var(--ink-soft);}
  .ee-auto-nb i{width:9px; height:9px; border-radius:50%; background:var(--rc);}
  .ee-auto-nb b{color:var(--ink);}
  .ee-auto-liste{list-style:none; margin:6px 0 0; padding:0; display:grid; gap:4px; font-size:13px; color:var(--ink-soft);}
  .ee-apercu{display:grid; grid-template-columns:minmax(200px, 250px) minmax(0, 1fr); gap:26px; align-items:start;}
  .ee-apercu-carte .ct-carte{width:100%;}
  .ee-apercu-cote{display:grid; gap:12px;}
  .ee-apercu-cote h2{margin:0;}
  /* joueurs */
  .ee-joueurs{display:grid; gap:8px;}
  .ee-joueur{appearance:none; font:inherit; color:inherit; text-align:left; display:flex; align-items:center; gap:14px; padding:12px 14px; border-radius:16px; border:1px solid var(--ct-trait); background:var(--ct-surface); cursor:pointer; width:100%;}
  .ee-joueur:hover{background:var(--ct-surface-2);}
  .ee-joueur:focus-visible{outline:2px solid var(--ct-accent); outline-offset:2px;}
  .ee-joueur .ee-nom{flex:1;}
  .ee-avatar{flex:none; width:44px; height:44px; border-radius:50%; object-fit:cover; display:grid; place-items:center; background:linear-gradient(160deg, #1b4f86, #0d2b4c); font-weight:800; color:#fff;}
  .ee-avatar.grand{width:64px; height:64px; font-size:24px;}
  .ee-soldes{text-align:right; display:grid; font-size:12.5px; color:var(--ink-soft);}
  .ee-soldes b{font-size:17px; color:var(--ink);}
  .ee-soldes small{color:var(--muted); font-size:12px;}
  .ee-progres{height:6px; border-radius:99px; background:rgba(255,255,255,.07); overflow:hidden;}
  .ee-progres i{display:block; height:100%; background:var(--ct-accent);}
  .ee-recentes{display:flex; flex-wrap:wrap; gap:10px;}
  .ee-rec{display:grid; gap:5px; width:84px; text-align:center; font-size:11.5px; color:var(--ink-soft);}
  .ee-rec img{width:84px; height:84px; border-radius:12px; object-fit:cover; object-position:50% 22%; border:2px solid var(--rc); background:#0a1018;}
  .ee-rec span{white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
  .ee-snack{position:fixed; left:50%; bottom:26px; transform:translateX(-50%); z-index:99999; display:flex; align-items:center; gap:16px; padding:12px 14px 12px 18px; border-radius:14px; background:#F4F5F6; color:#05070a; font:600 14px/1.3 Inter, system-ui, sans-serif; box-shadow:0 20px 40px -12px rgba(0,0,0,.7); max-width:calc(100vw - 24px);}
  .ee-snack button{appearance:none; border:0; background:rgba(5,7,10,.1); color:#05070a; font:inherit; font-weight:700; padding:7px 12px; border-radius:9px; cursor:pointer;}
  /* Dans l'espace équipe, le site met tout en 300 et enlève le gras des <b> : la console reprend ses graisses. */
  .ee{font-weight:400;}
  .ee b, .ee strong{font-weight:700;}
  .ee-son{max-width:640px;}
  .ee-ib.son.actif{color:#FF5C8A;}
  .ee-fen-son{display:grid; gap:14px; min-width:0;}
  .ee-fen-son h2{margin:0; font-size:20px;}
  .ee-son-liste{display:grid; gap:6px; max-height:260px; overflow-y:auto; scrollbar-width:thin; padding-right:4px;}
  .ee-titre-ligne{display:flex; align-items:center; gap:10px; padding:6px 8px; border-radius:12px; border:1px solid transparent; background:rgba(255,255,255,.03);}
  .ee-titre-ligne.choisi{border-color:#FF5C8A; background:rgba(255,92,138,.1);}
  .ee-titre-ligne img, .ee-titre-img{width:40px; height:40px; border-radius:8px; object-fit:cover; flex:none; background:#0a1018;}
  .ee-titre-ligne .ee-nom{flex:1; min-width:0;}
  .ee-titre-ligne .ee-nom b, .ee-titre-ligne .ee-nom small{display:block; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
  .ee-clip-info{display:flex; align-items:center; gap:10px; font-size:12.5px; color:var(--muted);}
  .ee-clip-info img{width:96px; height:54px; border-radius:8px; object-fit:cover; flex:none;}
  .ee-clip-err{color:#ff8fa8;}
  .ee [hidden]{display:none !important;}
  .ee-son input[type=range]{width:100%; accent-color:#2C9BEF; cursor:pointer;}
  .ee-son input[type=file]{font:inherit; font-size:13.5px; color:var(--ink-soft);}
  .ee-son-reperes{display:flex; flex-wrap:wrap; gap:8px;}
  .ee-son-tl{display:grid; gap:6px; padding:12px 14px; border-radius:14px; border:1px solid var(--ct-trait); background:rgba(0,0,0,.2);}
  .ee-son-piste{position:relative; height:26px; border-radius:8px; background:rgba(255,255,255,.05);}
  .ee-son-montee{position:absolute; left:0; top:0; bottom:0; border-radius:8px 0 0 8px; background:linear-gradient(90deg, rgba(79,180,255,.15), rgba(255,92,138,.55));}
  .ee-son-montee.coupee{background:repeating-linear-gradient(45deg, rgba(255,255,255,.07) 0 6px, transparent 6px 12px);}
  .ee-son-pin{position:absolute; top:-4px; bottom:-4px; width:3px; margin-left:-1.5px; border-radius:2px;}
  .ee-son-pin.flip{background:rgba(255,255,255,.75);}
  .ee-son-pin.son{background:#FF5C8A; box-shadow:0 0 10px #FF5C8A; transition:left .12s;}
  .ee-son-pin.son.muet{background:rgba(255,255,255,.25); box-shadow:none;}
  .ee-son-legende{display:flex; justify-content:space-between; gap:8px; font-size:12px; color:var(--muted);}
  .ee-son-barre{display:flex; flex-wrap:wrap; align-items:center; gap:10px; justify-content:flex-end;}
  .ee-son-barre .ee-etat{margin-right:auto;}
  @media (max-width:860px){
    .ee{grid-template-columns:1fr; gap:16px; padding-bottom:110px;}
    .ee-nav{position:static; flex-direction:row; flex-wrap:wrap; gap:6px; padding-bottom:4px;}
    .ee-nav button{flex:none; height:40px; padding:0 14px; background:var(--ct-surface);}
    .ee-nav button.actif{box-shadow:none; background:#F4F5F6; color:#05070a;}
    .ee-grille2{grid-template-columns:1fr;}
    .ee-apercu{grid-template-columns:1fr; justify-items:center;}
    .ee-apercu-carte{width:min(240px, 70vw);}
    .ee-col-ligne{flex-wrap:wrap;}
    .ee-col-act{width:100%;}
    .ee-carte{grid-template-columns:20px 26px 40px minmax(0, 1fr); row-gap:10px;}
    .ee-carte .ee-photo{width:40px; height:40px;}
    .ee-carte .ee-pts{grid-column:2 / -1; justify-content:space-between;}
    .ee-carte .ee-outils{grid-column:2 / -1; justify-content:flex-end;}
    .ee-visuel{flex-direction:column; align-items:flex-start;}
    .ee-barre-outils > .ct-btn, .ee-barre-outils > .ee-champ{flex:1 1 auto;}
    .ee-barre-outils .ee-cible{min-width:100%;}
  }
  @media (max-width:520px){
    .ee-ligne2{grid-template-columns:1fr;}
    .ee-barre-save{flex-wrap:wrap;}
    .ee-etat{width:100%;}
    .ee-taux{gap:5px;}
    .ee-joueur{flex-wrap:wrap;}
    .ee-soldes{text-align:left; margin-left:58px;}
  }
  @media (prefers-reduced-motion:reduce){ .ee-main, .ee-tuile-img{animation:none; transition:none;} }
  `;

  window.WaveEquipe = { pret: true, monter };

})();
