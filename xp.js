/* =====================================================================
   La Wave — l'XP, côté navigateur

   Le moteur vit dans la base (sql/xp-refonte.sql) : niveaux, série de jours, quêtes du jour, coffre, succès.
   Ce fichier ne calcule rien d'important : il LIT l'état (xp_moi), ANNONCE ce qui est arrivé
   (xp_evenements_lire) et le DESSINE, volontairement sobre :

     le bouton rond et son panneau   le niveau, les trois quêtes du jour, un lien vers les succès
     les annonces                    un « +N XP » regroupé, les quêtes, les succès, un écran de niveau
     la fiche du profil              niveau, titre, barre
     les succès                      une carte par famille, avec sa barre de progression

   Chargé à la demande (chargerXp dans index.html). Si le SQL n'est pas passé, tout se tait.
   ===================================================================== */

(function(){

  'use strict';

  const esc = (t) => escapeHtml(t);
  const nf = (n) => Number(n || 0).toLocaleString('fr-FR');

  let etat = null;            // ce que rend xp_moi
  let succes = null;          // ce que rend xp_succes_liste (les siens)
  let wc = null;              // le solde de Waves Coins (null : pas encore de WC côté base)
  let indispo = false;        // le SQL n'est pas passé
  let demarreePour = null;    // le membre pour lequel on a démarré
  let minuteur = null;
  let lecture = null;
  let sonde = null;
  const vues = new Set();     // gestes de découverte déjà envoyés dans cette session

  // ---------------------------------------------------------------------
  // La feuille de style, posée une fois
  // ---------------------------------------------------------------------

  const FEUILLE = `
  /* ---- Le panneau : le niveau, les quêtes, un lien ---- */
  #defisPanneau.defis-panneau{
    width:min(320px, calc(100vw - 40px)); max-height:min(460px, 80vh); padding:18px; overflow-y:auto; overflow-x:hidden;
    scrollbar-width:thin;
  }
  .xp-niv{display:flex; align-items:center; gap:12px;}
  .xp-niv-num{
    width:44px; height:44px; flex-shrink:0; border-radius:50%; display:grid; place-items:center;
    font-size:18px; font-weight:700; color:var(--ink); background:rgba(255,255,255,.08); border:1px solid var(--line-strong);
  }
  .xp-niv b{display:block; font-size:15px; color:var(--ink);}
  .xp-niv small{display:block; margin-top:2px; font-size:12px; color:var(--muted); font-variant-numeric:tabular-nums;}
  .xp-bar{height:4px; margin-top:14px; border-radius:99px; background:rgba(255,255,255,.1); overflow:hidden;}
  .xp-bar > span{display:block; height:100%; width:0; border-radius:99px; background:var(--blue-bright); transition:width .8s var(--ease);}
  .xp-serie{margin:12px 0 0; font-size:12px; color:var(--muted);}
  .xp-titre-bloc{
    display:flex; justify-content:space-between; margin:20px 0 6px; font-size:11px; letter-spacing:.14em;
    text-transform:uppercase; color:var(--muted);
  }
  .xp-quete{display:flex; align-items:center; gap:10px; padding:9px 0; border-top:1px solid var(--line); font-size:13px; color:var(--ink);}
  .xp-titre-bloc + .xp-quete{border-top:0;}
  .xp-quete .coche{
    width:16px; height:16px; flex-shrink:0; border-radius:50%; border:1.5px solid rgba(255,255,255,.28);
    display:grid; place-items:center; font-size:10px; color:transparent;
  }
  .xp-quete.faite{color:var(--muted);}
  .xp-quete.faite .coche{background:var(--blue-bright); border-color:var(--blue-bright); color:#06101a;}
  .xp-quete .tx{flex:1; min-width:0; line-height:1.3;}
  .xp-quete .reste{font-size:12px; color:var(--muted); font-variant-numeric:tabular-nums; white-space:nowrap;}
  .xp-note{margin:10px 0 0; font-size:12px; color:var(--muted);}
  .xp-lien{
    display:block; width:100%; margin-top:16px; padding:10px; border-radius:12px; font-size:13px; cursor:pointer;
    background:rgba(255,255,255,.06); border:1px solid var(--line); color:var(--ink);
  }
  .xp-lien:hover{background:rgba(255,255,255,.1);}
  .xp-vide{padding:14px 0; font-size:13px; color:var(--muted);}

  /* ---- L'écran de niveau ---- */
  .xp-celebre{
    position:fixed; inset:0; z-index:450; display:grid; place-items:center; padding:20px; cursor:pointer;
    background:rgba(3,5,8,.7); backdrop-filter:blur(8px); -webkit-backdrop-filter:blur(8px); animation:xpFond .25s ease;
  }
  .xp-celebre.sortie{animation:xpFondSort .25s ease forwards;}
  @keyframes xpFond{from{opacity:0;}to{opacity:1;}}
  @keyframes xpFondSort{to{opacity:0;}}
  .xp-carte{
    width:min(300px, 100%); padding:30px 24px 22px; text-align:center; border-radius:var(--radius);
    background:rgba(14,18,25,.96); border:1px solid var(--line-strong); box-shadow:var(--ombre-3);
    animation:xpCarte .4s var(--ease);
  }
  @keyframes xpCarte{from{opacity:0; transform:translateY(14px) scale(.96);}to{opacity:1; transform:none;}}
  .xp-carte .gros{font-size:56px; font-weight:700; line-height:1; color:var(--ink);}
  .xp-carte .eyebrow{margin:10px 0 4px; font-size:11px; letter-spacing:.2em; text-transform:uppercase; color:var(--muted);}
  .xp-carte h2{margin:0; font-size:20px; color:var(--ink);}
  .xp-carte .bouton{margin-top:20px; padding:10px 24px; border-radius:99px; border:0; cursor:pointer; background:var(--ink); color:#0b0d11; font-weight:600; font-size:13px;}

  /* ---- La fiche du profil ---- */
  .xp-fiche{display:flex; align-items:center; gap:18px;}
  .xp-fiche .xp-niv-num{width:64px; height:64px; font-size:26px;}
  .xp-fiche-corps{flex:1; min-width:0;}
  .xp-fiche-titre{display:flex; align-items:baseline; gap:10px; flex-wrap:wrap;}
  .xp-fiche-titre strong{font-size:20px; color:var(--ink);}
  .xp-fiche-titre span{font-size:13px; color:var(--muted);}
  .xp-fiche .xp-bar{margin-top:10px;}
  .xp-fiche-sous{margin-top:8px; font-size:13px; color:var(--muted); font-variant-numeric:tabular-nums;}

  /* ---- Les succès ---- */
  .xp-succes-tete{display:flex; align-items:baseline; justify-content:space-between; margin:26px 0 12px;}
  .xp-succes-tete h3{margin:0; font-size:17px; color:var(--ink);}
  .xp-succes-tete span{font-size:13px; color:var(--muted); font-variant-numeric:tabular-nums;}
  .xp-grille{display:grid; grid-template-columns:repeat(auto-fill,minmax(240px,1fr)); gap:10px;}
  .xp-fam{display:flex; gap:12px; align-items:center; padding:14px; border-radius:16px; background:rgba(255,255,255,.035); border:1px solid var(--line);}
  .xp-fam .ic{width:40px; height:40px; flex-shrink:0; border-radius:12px; display:grid; place-items:center; font-size:21px; background:rgba(255,255,255,.06);}
  .xp-fam .corps{flex:1; min-width:0;}
  .xp-fam .nom{font-size:14px; font-weight:600; color:var(--ink);}
  .xp-fam .desc{margin-top:2px; font-size:12px; color:var(--muted); line-height:1.35;}
  .xp-fam .barre{height:3px; margin-top:9px; border-radius:99px; background:rgba(255,255,255,.1); overflow:hidden;}
  .xp-fam .barre span{display:block; height:100%; border-radius:99px; background:var(--blue-bright);}
  .xp-fam .val{font-size:11px; color:var(--muted); font-variant-numeric:tabular-nums; white-space:nowrap;}
  .xp-fam.complet{border-color:rgba(79,180,255,.45);}
  .xp-fam.complet .ic{background:rgba(79,180,255,.16);}
  @media (max-width:560px){
    .xp-grille{grid-template-columns:1fr;}
  }
  @media (prefers-reduced-motion:reduce){
    .xp-carte, .xp-celebre{animation:none;}
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

    // Le solde de Waves Coins (sql/coffres-cartes.sql) : sans lui, le panneau n'affiche simplement pas les WC.
    try{
      const reponse = await BD.wcSolde();
      wc = reponse && !reponse.error && typeof reponse.data === 'number' ? reponse.data : null;
    }catch(erreur){
      wc = null;
    }

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
    etat = succes = null;
    indispo = false;
    vues.clear();
    clearInterval(sonde);
    clearTimeout(minuteur);
  }

  // Après un geste du membre : on relit les annonces dès que le serveur a fini.
  function apres(delai){

    if(!currentUser || indispo) return;
    if(!demarreePour){ demarrer(); return; }

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

  async function lireEvenements(){

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

        annoncer(data);

      }catch(erreur){
        // Une annonce manquée n'est pas grave.
      }finally{
        lecture = null;
      }
    })();

    return lecture;
  }

  // ---------------------------------------------------------------------
  // Les annonces : sobres. Les bonus de série et de semaine rejoignent le total sans bruit.
  // ---------------------------------------------------------------------

  const file = [];
  let enCours = false;

  const pause = (ms) => new Promise(r => setTimeout(r, ms));

  function annoncer(evenements){

    const gains = evenements.filter(e => e.type === 'gain');

    if(gains.length){
      const total = gains.reduce((s, e) => s + (e.donnees.xp || 0), 0);
      const totalWc = gains.reduce((s, e) => s + (e.donnees.wc || 0), 0);
      const libelles = [];
      gains.forEach(e => { if(!libelles.includes(e.donnees.libelle)) libelles.push(e.donnees.libelle); });
      file.push({ sorte: 'toast', titre: '+' + total + ' XP' + (totalWc ? ' · +' + totalWc + ' WC' : ''), options: {
        type: 'xp', icone: '⚡', detail: libelles.slice(0, 2).join(' · ') + (libelles.length > 2 ? ' · …' : ''), duree: 3200 }});
    }

    evenements.forEach(e => {

      const d = e.donnees || {};

      if(e.type === 'quete'){
        file.push({ sorte: 'toast', titre: 'Quête accomplie', options: { type: 'succes', icone: '✓', detail: d.libelle + ' · +' + d.xp + ' XP', duree: 4000 }});
      }
      else if(e.type === 'coffre'){
        file.push({ sorte: 'toast', titre: 'Trois quêtes faites', options: { type: 'succes', icone: '🎁', detail: 'Bonus du jour : +' + d.xp + ' XP', duree: 4500 }});
      }
      else if(e.type === 'defi_wc'){
        file.push({ sorte: 'toast', titre: 'Défi spécial accompli', options: { type: 'xp', icone: d.icone || '🏅', detail: d.libelle + ' · +' + d.wc + ' WC', duree: 5000 }});
      }
      else if(e.type === 'succes'){
        file.push({ sorte: 'toast', titre: 'Succès : ' + d.nom, options: { type: 'succes', icone: d.icone, detail: d.description + ' · +' + d.xp + ' XP', duree: 5000 }});
      }
      else if(e.type === 'niveau'){
        file.unshift({ sorte: 'niveau', niveau: d.niveau, titre: d.titre });
      }
    });

    vider();
  }

  async function vider(){

    if(enCours) return;
    enCours = true;

    while(file.length){

      const a = file.shift();

      if(a.sorte === 'toast'){
        notifier(a.titre, a.options);
        await pause(500);
      }else{
        await ecranNiveau(a);
        await pause(200);
      }
    }

    enCours = false;
  }

  function ecranNiveau(a){

    return new Promise((fin) => {

      poserFeuille();

      const fond = document.createElement('div');
      fond.className = 'xp-celebre';
      fond.setAttribute('role', 'dialog');
      fond.setAttribute('aria-modal', 'true');
      fond.innerHTML = `
        <div class="xp-carte">
          <div class="gros">${esc(a.niveau)}</div>
          <p class="eyebrow">Niveau atteint</p>
          <h2>${esc(a.titre)}</h2>
          <button type="button" class="bouton">Continuer</button>
        </div>`;

      let ferme = false;

      const fermer = () => {
        if(ferme) return;
        ferme = true;
        document.removeEventListener('keydown', touche);
        fond.classList.add('sortie');
        setTimeout(() => { fond.remove(); fin(); }, 260);
      };

      const touche = (e) => { if(e.key === 'Escape' || e.key === 'Enter') fermer(); };

      fond.addEventListener('click', fermer);
      document.addEventListener('keydown', touche);
      document.body.appendChild(fond);
      fond.querySelector('.bouton').focus({ preventScroll: true });

      setTimeout(fermer, 6000);
    });
  }

  // ---------------------------------------------------------------------
  // Le bouton rond et son panneau
  // ---------------------------------------------------------------------

  function majFlottant(){
    if(typeof majDefisFlottant === 'function') majDefisFlottant();
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

    const anneau = document.getElementById('defisAnneau');
    const compteur = document.getElementById('defisBoutonCompteur');
    const point = document.getElementById('dailyNewDot');

    if(anneau) anneau.style.strokeDashoffset = 100 - Math.round((faites / total) * 100);
    if(compteur) compteur.textContent = faites + '/' + total;
    if(point) point.style.display = faites < total ? 'inline-block' : 'none';

    bouton.classList.toggle('defis-tous-faits', faites === total);
    bouton.title = 'Niveau ' + etat.niveau + ' · quêtes ' + faites + '/' + total;
    bouton.setAttribute('aria-label', 'Niveau ' + etat.niveau + ', quêtes du jour ' + faites + ' sur ' + total);
  }

  function dessinerPanneau(){

    const panneau = document.getElementById('defisPanneau');
    if(!panneau || !etat) return;

    const e = etat;
    const haut = e.seuil_haut;
    const pct = haut ? Math.max(0, Math.min(100, ((e.xp - e.seuil_bas) / (haut - e.seuil_bas)) * 100)) : 100;
    const quetes = e.quetes || [];
    const faites = quetes.filter(q => q.faite).length;

    const liste = quetes.map(q => `
      <div class="xp-quete${q.faite ? ' faite' : ''}">
        <span class="coche">✓</span>
        <span class="tx">${esc(q.libelle)}</span>
        <span class="reste">${q.faite ? '' : q.progres + '/' + q.objectif}</span>
      </div>`).join('');

    const coffre = e.coffre && e.coffre.ouvert
      ? `<p class="xp-note">Bonus du jour touché : +${e.coffre.xp} XP.</p>`
      : `<p class="xp-note">Trois quêtes faites : un bonus surprise.</p>`;

    panneau.innerHTML = `
      <div class="xp-niv">
        <span class="xp-niv-num">${e.niveau}</span>
        <div><b>${esc(e.titre)}</b><small>${haut ? nf(haut - e.xp) + ' XP avant le niveau ' + (e.niveau + 1) : 'Niveau maximum'}</small></div>
      </div>
      <div class="xp-bar"><span style="width:${pct}%"></span></div>
      ${e.serie > 1 ? `<p class="xp-serie">${e.serie} jours de suite</p>` : ''}

      <div class="xp-titre-bloc"><span>Quêtes du jour</span><span>${faites}/${quetes.length || 3}</span></div>
      ${liste || '<div class="xp-vide">Les quêtes arrivent…</div>'}
      ${coffre}
      ${wc === null ? '' : `<button type="button" class="xp-lien" data-xp-aller="boutique">Boutique · ${nf(wc)} WC</button>`}
      <button type="button" class="xp-lien" data-xp-aller="succes">Mes succès${e.succes ? ' · ' + e.succes.obtenus + '/' + e.succes.total : ''}</button>`;
  }

  document.addEventListener('click', (ev) => {

    const cible = ev.target.closest && ev.target.closest('[data-xp-aller]');
    if(!cible) return;

    if(typeof fermerDefis === 'function') fermerDefis();

    if(cible.dataset.xpAller === 'boutique'){
      if(typeof ouvrirBoutique === 'function') ouvrirBoutique();
    }else if(typeof ouvrirMesSucces === 'function'){
      ouvrirMesSucces();
    }
  });

  // ---------------------------------------------------------------------
  // Le profil : la fiche de niveau et les succès
  // ---------------------------------------------------------------------

  function ficheHtml(){

    const e = etat;
    const haut = e.seuil_haut;
    const pct = haut ? Math.max(0, Math.min(100, ((e.xp - e.seuil_bas) / (haut - e.seuil_bas)) * 100)) : 100;

    return `
      <div class="xp-fiche">
        <span class="xp-niv-num">${e.niveau}</span>
        <div class="xp-fiche-corps">
          <div class="xp-fiche-titre"><strong>${esc(e.titre)}</strong><span>${nf(e.xp)} XP</span></div>
          <div class="xp-bar"><span style="width:${pct}%"></span></div>
          <div class="xp-fiche-sous">${haut ? nf(haut - e.xp) + ' XP avant le niveau ' + (e.niveau + 1) : 'Niveau maximum atteint'}</div>
        </div>
      </div>`;
  }

  // Une famille (Écouter 5, 25, 60 sorties…) = une carte, qui montre le prochain palier. Les secrets
  // n'apparaissent qu'une fois trouvés.
  function famillesDe(liste){

    const groupes = new Map();

    liste.forEach(s => {
      if(s.secret && !s.obtenu_le) return;
      const cle = s.secret ? s.id : s.famille;
      if(!groupes.has(cle)) groupes.set(cle, []);
      groupes.get(cle).push(s);
    });

    return [...groupes.values()].map(g => g.slice().sort((a, b) => (a.seuil || 0) - (b.seuil || 0)));
  }

  function familleHtml(g){

    const suivant = g.find(s => !s.obtenu_le);
    const complet = !suivant;
    const ref = suivant || g[g.length - 1];

    const aValeur = ref.valeur !== null && ref.valeur !== undefined && ref.seuil;
    const pct = complet ? 100 : (aValeur ? Math.min(100, Math.round((ref.valeur / ref.seuil) * 100)) : 0);

    return `
      <div class="xp-fam${complet ? ' complet' : ''}">
        <span class="ic">${esc(ref.icone)}</span>
        <div class="corps">
          <div class="nom">${esc(ref.nom)}</div>
          <div class="desc">${esc(ref.description)}</div>
          ${complet ? '' : `<div class="barre"><span style="width:${pct}%"></span></div>`}
        </div>
        ${!complet && aValeur ? `<span class="val">${nf(Math.min(ref.valeur, ref.seuil))} / ${nf(ref.seuil)}</span>` : ''}
      </div>`;
  }

  function succesHtml(){

    const obtenus = succes.liste.filter(s => s.obtenu_le).length;

    const familles = famillesDe(succes.liste);

    // Ceux qui avancent d'abord, les terminés à la fin.
    familles.sort((a, b) => (a.every(s => s.obtenu_le) ? 1 : 0) - (b.every(s => s.obtenu_le) ? 1 : 0));

    return `
      <div class="xp-succes-tete"><h3>Succès</h3><span>${obtenus} / ${succes.liste.length}</span></div>
      <div class="xp-grille">${familles.map(familleHtml).join('')}</div>`;
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

    if(fiche) fiche.innerHTML = ficheHtml();

    if(hote){
      if(!succes) hote.innerHTML = '<div class="xp-vide">Chargement…</div>';
      await lireSucces();
      if(succes) hote.innerHTML = succesHtml();
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
