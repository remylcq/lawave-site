/* =====================================================================
   La Wave — la collection d'un membre

   Il n'y a qu'un profil : celui de la communauté (communaute.js). Ce fichier fournit ce qui s'y ajoute
   pour parler de musique, en quatre onglets :

     Collection   le podium (trois favorites), puis tout ce que le membre a écouté, avec sa note
     Journal      ses écoutes jour après jour, mois par mois
     À écouter    les sorties mises de côté           (réservé à soi)
     Succès       le niveau, l'XP et les trophées      (réservé à soi)

   Il porte aussi le tiroir des paramètres (photo, pseudo, description, rôle, réseaux) que l'engrenage du
   profil ouvre : le formulaire reste celui d'index.html (saveProfile), seul son emplacement a changé.

   Chargé à la demande (chargerProfil dans index.html). Les données viennent de la mémoire du site :
   toutesLesNotes et catalogueData, déjà chargés avec le catalogue.
   ===================================================================== */

(function(){

  'use strict';

  const esc = (t) => escapeHtml(t);
  const attr = (t) => escapeAttribute(t);

  // ---------------------------------------------------------------------
  // La feuille de style, posée une fois
  // ---------------------------------------------------------------------

  const FEUILLE = `
  /* « Termine ton profil », « Fais vérifier ton profil » : des bandeaux discrets. */
  #profilVerification{margin-top:14px;}
  #profilVerification:empty{display:none;}
  #profilVerification .vf-carte-profil{margin:0 0 10px; padding:12px 16px; box-shadow:none; background:rgba(255,255,255,.035);}
  #profilVerification .vf-carte-profil .vf-ic{width:36px; height:36px; font-size:16px;}
  #profilVerification .vf-carte-profil .vf-texte b{font-size:14px;}
  #profilVerification .btn{padding:9px 16px; font-size:13px;}
  /* Un bandeau, une ligne : le titre et le bouton. Le détail se lit dans le dialogue. */
  #profilVerification .vf-carte-profil .vf-texte span{display:none;}
  #profilVerification .vf-carte-profil{gap:12px;}

  .pf-panneau{padding-top:4px; animation:fondu .45s var(--ease) both;}

  /* ----- le podium ----- */
  .pf-titre-petit{margin:0 0 12px; font-size:12px; font-weight:600; letter-spacing:.1em; text-transform:uppercase; color:var(--muted);}
  .pf-podium{margin-bottom:34px;}
  .pf-podium-grille{display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:14px; max-width:540px;}
  .pf-marche{
    position:relative; display:block; aspect-ratio:1/1; padding:0; overflow:hidden; border-radius:var(--radius-sm);
    border:1px solid var(--line-strong); background:rgba(255,255,255,.05); color:inherit;
    animation:pfPop .55s var(--ease) both; animation-delay:calc(var(--k,0) * 90ms);
    transition:transform .35s var(--ease), box-shadow .35s var(--ease);
  }
  button.pf-marche:hover{transform:translateY(-4px); box-shadow:var(--ombre-2);}
  .pf-marche img{width:100%; height:100%; object-fit:cover; display:block;}
  .pf-rang{
    position:absolute; left:8px; top:8px; width:24px; height:24px; border-radius:50%;
    display:flex; align-items:center; justify-content:center; font-size:12px; font-weight:800;
    color:#1a1405; background:var(--gold-favori);
  }
  .pf-marche.vide{
    display:flex; align-items:center; justify-content:center; border-style:dashed;
    font-size:22px; font-weight:700; color:var(--muted); background:none;
  }
  .pf-indice{margin:12px 0 0; font-size:13px; color:var(--muted);}

  /* ----- la collection ----- */
  .pf-barre{display:flex; align-items:center; justify-content:space-between; gap:14px; flex-wrap:wrap; margin-bottom:16px;}
  .pf-barre .pf-titre-petit{margin:0;}
  .pf-chips{display:flex; gap:6px; flex-wrap:wrap;}
  .pf-chip{
    padding:6px 14px; border-radius:var(--radius-pill); font-size:12.5px; font-weight:600; color:var(--ink-soft);
    background:rgba(255,255,255,.04); border:1px solid var(--line);
    transition:color .2s var(--ease), background .2s var(--ease), border-color .2s var(--ease);
  }
  .pf-chip:hover{color:#fff; border-color:var(--line-strong);}
  .pf-chip[aria-pressed="true"]{color:#fff; background:rgba(20,137,222,.2); border-color:var(--blue);}
  .pf-grille{display:grid; grid-template-columns:repeat(auto-fill,minmax(132px,1fr)); gap:20px 16px;}
  .pf-pochette{
    display:block; padding:0; background:none; border:0; text-align:left; color:inherit;
    animation:pfMonte .5s var(--ease) both; animation-delay:calc(var(--k,0) * 30ms);
  }
  .pf-pochette .pf-img{
    position:relative; display:block; aspect-ratio:1/1; overflow:hidden; border-radius:var(--radius-sm);
    border:1px solid var(--line); background:rgba(255,255,255,.06);
    transition:transform .4s var(--ease), box-shadow .4s var(--ease);
  }
  .pf-pochette img{width:100%; height:100%; object-fit:cover; display:block;}
  .pf-pochette:hover .pf-img{transform:translateY(-4px); box-shadow:var(--ombre-2);}
  .pf-pochette .st{display:flex; margin-top:7px;}
  .pf-pochette .pf-sans-note{display:block; margin-top:7px; height:12px;}
  .pf-pochette .pf-coeur{
    position:absolute; right:7px; top:7px; width:22px; height:22px; border-radius:50%;
    display:flex; align-items:center; justify-content:center; background:rgba(5,7,10,.72); color:var(--gold-favori);
  }
  .pf-pochette .pf-coeur svg{width:12px; height:12px; fill:currentColor;}
  .pf-vide{
    display:flex; flex-direction:column; align-items:center; gap:10px; padding:54px 20px; text-align:center;
    border:1px dashed var(--line-strong); border-radius:var(--radius);
  }
  .pf-vide b{font-size:17px;}
  .pf-vide p{margin:0; max-width:38ch; font-size:14px; color:var(--ink-soft);}
  .pf-vide .btn{margin-top:8px;}

  /* ----- le journal ----- */
  .pf-resume{display:flex; gap:34px; flex-wrap:wrap; align-items:flex-end; margin:0 0 30px;}
  .pf-resume div{display:flex; flex-direction:column-reverse; gap:3px;}
  .pf-resume dd{margin:0; font-size:28px; font-weight:700; letter-spacing:-.02em; line-height:1; font-variant-numeric:tabular-nums;}
  .pf-resume dt{font-size:12.5px; color:var(--muted);}
  .pf-resume .pf-mois-barres{flex-direction:row; align-items:flex-end; gap:10px; height:64px; margin-left:auto;}
  .pf-mois-barres span{display:flex; flex-direction:column; align-items:center; justify-content:flex-end; gap:5px; width:30px; height:100%;}
  .pf-mois-barres i{
    display:block; width:100%; min-height:3px; height:calc(var(--h) * 0.4px + 3px); border-radius:4px;
    background:rgba(255,255,255,.2); animation:pfGrandit .7s var(--ease) both;
  }
  .pf-mois-barres span.courant i{background:var(--blue-bright);}
  .pf-mois-barres em{font-style:normal; font-size:10px; color:var(--muted); text-transform:capitalize;}
  .pf-mois{margin:0 0 6px; padding-top:22px; display:flex; align-items:baseline; justify-content:space-between; gap:10px;}
  .pf-mois h3{margin:0; font-size:16px; font-weight:600; text-transform:capitalize;}
  .pf-mois span{font-size:12.5px; color:var(--muted);}
  .pf-ligne{
    display:flex; align-items:center; gap:14px; width:100%; padding:10px 0; text-align:left;
    background:none; border:0; border-bottom:1px solid var(--line); color:inherit;
  }
  .pf-ligne:hover .pf-ligne-titre{color:var(--blue-bright);}
  .pf-ligne-jour{width:28px; flex-shrink:0; text-align:center; font-size:18px; font-weight:700; color:var(--ink-soft); font-variant-numeric:tabular-nums;}
  .pf-ligne img{width:52px; height:52px; flex-shrink:0; border-radius:8px; object-fit:cover; display:block;}
  .pf-ligne-texte{flex:1; min-width:0;}
  .pf-ligne-titre{display:block; font-size:14.5px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; transition:color .2s var(--ease);}
  .pf-ligne-artiste{display:block; font-size:12.5px; color:var(--muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
  .pf-ligne-avis{display:block; margin-top:3px; font-size:12.5px; color:var(--ink-soft); font-style:italic; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
  .pf-ligne .st{flex-shrink:0;}

  /* ----- à écouter ----- */
  .pf-aecouter{display:grid; grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); gap:22px 16px;}
  .pf-carte{animation:pfMonte .5s var(--ease) both; animation-delay:calc(var(--k,0) * 40ms);}
  .pf-carte .pf-pochette{animation:none; width:100%;}
  .pf-carte-titre{display:block; margin-top:9px; font-size:13.5px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
  .pf-carte-artiste{display:block; font-size:12px; color:var(--muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
  .pf-carte-actions{display:flex; gap:6px; margin-top:10px;}
  .pf-carte-actions .fiche-statut{flex:1; padding:8px 10px; font-size:12.5px;}
  .pf-carte-actions .fiche-statut svg{width:15px; height:15px;}
  .pf-retirer{
    width:34px; height:34px; flex-shrink:0; padding:0; border-radius:50%; font-size:12px; color:var(--muted);
    background:rgba(255,255,255,.04); border:1px solid var(--line); transition:color .2s var(--ease), border-color .2s var(--ease);
  }
  .pf-retirer:hover{color:#fff; border-color:var(--line-strong);}

  /* ----- les succès ----- */
  .pf-succes-tete{display:flex; align-items:center; justify-content:space-between; gap:14px; margin:26px 0 14px;}
  .pf-succes-tete .pf-titre-petit{margin:0;}
  .pf-succes-tete span{font-size:12.5px; color:var(--muted);}

  /* ----- les paramètres : un tiroir à droite ----- */
  html.pf-tiroir-ouvert, html.pf-tiroir-ouvert body{overflow:hidden;}
  .pf-tiroir{position:fixed; inset:0; z-index:170; visibility:hidden; pointer-events:none; transition:visibility 0s .5s;}
  .pf-tiroir.ouvert{visibility:visible; pointer-events:auto; transition:none;}
  .pf-tiroir-fond{
    position:absolute; inset:0; background:rgba(3,5,8,.6);
    -webkit-backdrop-filter:blur(6px); backdrop-filter:blur(6px);
    opacity:0; transition:opacity .35s var(--ease);
  }
  .pf-tiroir.ouvert .pf-tiroir-fond{opacity:1;}
  .pf-tiroir-panneau{
    position:absolute; top:0; right:0; bottom:0; width:min(440px,100%);
    display:flex; flex-direction:column; background:rgba(11,15,21,.97); border-left:1px solid var(--line-strong);
    box-shadow:var(--ombre-3); transform:translateX(100%); transition:transform .5s var(--ease);
  }
  .pf-tiroir.ouvert .pf-tiroir-panneau{transform:none;}
  .pf-tiroir-tete{display:flex; align-items:center; justify-content:space-between; padding:18px 22px; border-bottom:1px solid var(--line);}
  .pf-tiroir-tete h3{margin:0; font-size:18px;}
  .pf-tiroir-fermer{
    width:38px; height:38px; padding:0; border-radius:50%; font-size:14px; color:var(--ink-soft);
    background:rgba(255,255,255,.05); border:1px solid var(--line);
  }
  .pf-tiroir-fermer:hover{color:#fff; background:rgba(255,255,255,.1);}
  .pf-tiroir-corps{flex:1; overflow-y:auto; padding:22px; overscroll-behavior:contain;}
  .pf-tiroir-corps .profile-form{max-width:none; padding:0;}
  .pf-tiroir-pied{display:flex; flex-direction:column; gap:14px; padding:16px 22px calc(18px + env(safe-area-inset-bottom,0px)); border-top:1px solid var(--line);}
  .pf-tiroir-pied .btn{justify-content:center;}
  .pf-tiroir-liens{display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap;}

  @keyframes pfMonte{from{opacity:0; transform:translateY(12px);} to{opacity:1; transform:none;}}
  @keyframes pfPop{from{opacity:0; transform:scale(.88);} to{opacity:1; transform:none;}}
  @keyframes pfGrandit{from{height:3px;}}

  @media (max-width:640px){
    .pf-grille{grid-template-columns:repeat(3,minmax(0,1fr)); gap:16px 10px;}
    .pf-aecouter{grid-template-columns:repeat(2,minmax(0,1fr)); gap:20px 12px;}
    .pf-podium-grille{gap:10px;}
    .pf-resume .pf-mois-barres{margin-left:0; width:100%;}
    .pf-tiroir-panneau{border-left:0;}
  }
  @media (prefers-reduced-motion:reduce){
    .pf-panneau, .pf-marche, .pf-pochette, .pf-carte, .pf-mois-barres i{animation:none;}
    .pf-tiroir-panneau, .pf-tiroir-fond{transition:none;}
  }
  `;

  function poserFeuille(){

    if(document.getElementById('pf-feuille')) return;

    const style = document.createElement('style');
    style.id = 'pf-feuille';
    style.textContent = FEUILLE;
    document.head.appendChild(style);
  }

  // ---------------------------------------------------------------------
  // Ce que le profil lit
  // ---------------------------------------------------------------------

  // De qui parle le panneau, et est-ce moi ? (À écouter et Succès ne regardent que soi.)
  const ctx = { uid: null, soi: false, onglet: 'collection' };
  let tri = 'recentes';

  const sortieDe = (ligne) => catalogueData.find(s => s.id === ligne.release_id);

  const sesLignes = () => toutesLesNotes.filter(n => n.user_id === ctx.uid);

  const ecoutees = () => sesLignes().filter(n => n.saved && sortieDe(n));

  const aEcouter = () => sesLignes().filter(n => n.a_ecouter && !n.saved && sortieDe(n));

  const jourDe = (ligne) => ligne.ecoute_le || String(ligne.created_at || '').slice(0, 10);

  const minuscules = (n) => String(n || '').toLowerCase();

  function trier(lignes){

    const copie = lignes.slice();

    if(tri === 'notes'){
      return copie.sort((a, b) => (b.rating || 0) - (a.rating || 0) || jourDe(b).localeCompare(jourDe(a)));
    }

    if(tri === 'az'){
      return copie.sort((a, b) => minuscules(sortieDe(a).title).localeCompare(minuscules(sortieDe(b).title), 'fr'));
    }

    return copie.sort((a, b) => jourDe(b).localeCompare(jourDe(a)) || String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
  }

  function actif(){
    return !!(currentUser && document.querySelector('[data-pf-uid]'));
  }

  // ---------------------------------------------------------------------
  // Collection : le podium, puis tout ce qui est écouté
  // ---------------------------------------------------------------------

  function videHtml(titre, texte, bouton){
    return `
      <div class="pf-vide">
        <b>${titre}</b>
        <p>${texte}</p>
        ${bouton ? `<button type="button" class="btn btn-primary" onclick="${bouton[1]}">${bouton[0]}</button>` : ''}
      </div>`;
  }

  function podiumHtml(){

    const favoris = sesLignes().filter(n => n.favori && sortieDe(n));

    if(!favoris.length && !(ctx.soi && ecoutees().length)) return '';

    const marches = [];

    for(let i = 0; i < MAX_FAVORIS; i++){

      const ligne = favoris[i];
      const sortie = ligne && sortieDe(ligne);

      if(!sortie && !ctx.soi) continue;

      marches.push(sortie
        ? `<button type="button" class="pf-marche" style="--k:${i}" onclick="openCatalogueModal('${sortie.id}')"
                   aria-label="${attr('Podium, place ' + (i + 1) + ' : ' + sortie.title)}" title="${attr(sortie.title + ' — ' + sortie.artist)}">
             <img src="${attr(safeUrl(sortie.cover))}" alt="" loading="lazy"><span class="pf-rang">${i + 1}</span>
           </button>`
        : `<span class="pf-marche vide" style="--k:${i}" aria-hidden="true">${i + 1}</span>`);
    }

    return `
      <div class="pf-podium" role="group" aria-label="Podium">
        <h3 class="pf-titre-petit">Podium</h3>
        <div class="pf-podium-grille">${marches.join('')}</div>
        ${ctx.soi && favoris.length < MAX_FAVORIS ? `<p class="pf-indice">Ajoute une favorite depuis la fiche d'une sortie : « Podium ».</p>` : ''}
      </div>`;
  }

  function collectionPanneauHtml(){

    const lignes = ecoutees();

    if(!lignes.length){
      return ctx.soi
        ? videHtml(
            'Ta collection est vide',
            "Touche le « + » d'une pochette du catalogue, ou « J'ai écouté » sur une fiche : tes sorties s'ajoutent ici, avec ta note.",
            ['Parcourir le catalogue', "goTo('catalogue')"]
          )
        : videHtml('Rien dans sa collection', "Les sorties qu'il a écoutées apparaîtront ici, avec sa note.");
    }

    const pochettes = trier(lignes).map((ligne, k) => {

      const sortie = sortieDe(ligne);

      return `
        <button type="button" class="pf-pochette" style="--k:${Math.min(k, 14)}" onclick="openCatalogueModal('${sortie.id}')"
                aria-label="${attr(sortie.title + ' — ' + sortie.artist)}" title="${attr(sortie.title + ' — ' + sortie.artist)}">
          <span class="pf-img">
            <img src="${attr(safeUrl(sortie.cover))}" alt="" loading="lazy">
            ${ligne.favori ? `<span class="pf-coeur">${iconeCollection('coeur')}</span>` : ''}
          </span>
          ${ligne.rating ? etoilesHtml(ligne.rating, 'petite') : '<span class="pf-sans-note"></span>'}
        </button>`;
    }).join('');

    const chip = (cle, libelle) =>
      `<button type="button" class="pf-chip" data-tri="${cle}" aria-pressed="${tri === cle}">${libelle}</button>`;

    return `
      ${podiumHtml()}
      <div class="pf-barre">
        <h3 class="pf-titre-petit">${lignes.length} sortie${lignes.length > 1 ? 's' : ''}</h3>
        <div class="pf-chips" role="group" aria-label="Trier">
          ${chip('recentes', 'Récentes')}${chip('notes', 'Mieux notées')}${chip('az', 'A–Z')}
        </div>
      </div>
      <div class="pf-grille">${pochettes}</div>`;
  }

  // ---------------------------------------------------------------------
  // Journal : les écoutes, jour après jour
  // ---------------------------------------------------------------------

  function moisDe(jour){
    return new Date(jour + 'T00:00:00').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  }

  function journalHtml(){

    const lignes = ecoutees().slice().sort((a, b) =>
      jourDe(b).localeCompare(jourDe(a)) || String(b.updated_at || '').localeCompare(String(a.updated_at || '')));

    if(!lignes.length){
      return ctx.soi
        ? videHtml(
            'Ton journal est vide',
            "Chaque sortie que tu écoutes s'y inscrit avec son jour : tu verras combien tu en explores chaque mois.",
            ['Parcourir le catalogue', "goTo('catalogue')"]
          )
        : videHtml('Journal vide', "Ses écoutes apparaîtront ici, jour après jour.");
    }

    const aujourdhui = jourLocal();
    const moisCourant = aujourdhui.slice(0, 7);

    // Les six derniers mois, pour voir son rythme d'un coup d'œil.
    const barres = [];
    const base = new Date(aujourdhui + 'T00:00:00');

    for(let i = 5; i >= 0; i--){
      const d = new Date(base.getFullYear(), base.getMonth() - i, 1);
      const cle = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
      barres.push({
        cle,
        court: d.toLocaleDateString('fr-FR', { month: 'short' }).replace('.', ''),
        n: lignes.filter(l => jourDe(l).slice(0, 7) === cle).length
      });
    }

    const maxi = Math.max(1, ...barres.map(b => b.n));

    const ceMois = lignes.filter(l => jourDe(l).slice(0, 7) === moisCourant).length;
    const cetteAnnee = lignes.filter(l => jourDe(l).slice(0, 4) === aujourdhui.slice(0, 4)).length;
    const notees = lignes.filter(l => l.rating);
    const moyenne = notees.length ? notees.reduce((a, l) => a + l.rating, 0) / notees.length / 2 : null;

    let html = `
      <dl class="pf-resume">
        <div><dd>${ceMois}</dd><dt>ce mois-ci</dt></div>
        <div><dd>${cetteAnnee}</dd><dt>cette année</dt></div>
        ${moyenne !== null ? `<div><dd>${moyenne.toFixed(1).replace('.', ',')}</dd><dt>${ctx.soi ? 'ta' : 'sa'} note moyenne</dt></div>` : ''}
        <div class="pf-mois-barres" aria-hidden="true">
          ${barres.map(b => `
            <span class="${b.cle === moisCourant ? 'courant' : ''}" title="${b.n} écoute${b.n > 1 ? 's' : ''}">
              <i style="--h:${Math.round((b.n / maxi) * 100)}"></i><em>${esc(b.court)}</em>
            </span>`).join('')}
        </div>
      </dl>`;

    let mois = null;
    let ouvert = false;

    lignes.forEach(ligne => {

      const sortie = sortieDe(ligne);
      const jour = jourDe(ligne);
      const m = jour.slice(0, 7);

      if(m !== mois){

        if(ouvert) html += '</div>';

        const nbMois = lignes.filter(l => jourDe(l).slice(0, 7) === m).length;

        html += `<div class="pf-mois"><h3>${esc(moisDe(jour))}</h3><span>${nbMois} écoute${nbMois > 1 ? 's' : ''}</span></div><div>`;
        mois = m;
        ouvert = true;
      }

      html += `
        <button type="button" class="pf-ligne" onclick="openCatalogueModal('${sortie.id}')">
          <span class="pf-ligne-jour">${Number(jour.slice(8, 10))}</span>
          <img src="${attr(safeUrl(sortie.cover))}" alt="" loading="lazy">
          <span class="pf-ligne-texte">
            <span class="pf-ligne-titre">${esc(sortie.title)}</span>
            <span class="pf-ligne-artiste">${esc(sortie.artist)}</span>
            ${ligne.avis ? `<span class="pf-ligne-avis">${esc(ligne.avis)}</span>` : ''}
          </span>
          ${ligne.rating ? etoilesHtml(ligne.rating, 'petite') : ''}
        </button>`;
    });

    if(ouvert) html += '</div>';

    return html;
  }

  // ---------------------------------------------------------------------
  // À écouter
  // ---------------------------------------------------------------------

  function aEcouterPanneauHtml(){

    const lignes = aEcouter().slice().sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));

    if(!lignes.length){
      return videHtml(
        "Rien de côté pour l'instant",
        "Touche le « + » d'une pochette puis « À écouter » : tu retrouveras ici les sorties que tu veux garder pour plus tard.",
        ['Parcourir le catalogue', "goTo('catalogue')"]
      );
    }

    return `
      <div class="pf-aecouter">
        ${lignes.map((ligne, k) => {
          const sortie = sortieDe(ligne);
          return `
            <div class="pf-carte" style="--k:${Math.min(k, 12)}">
              <button type="button" class="pf-pochette" onclick="openCatalogueModal('${sortie.id}')"
                      aria-label="${attr(sortie.title + ' — ' + sortie.artist)}">
                <span class="pf-img"><img src="${attr(safeUrl(sortie.cover))}" alt="" loading="lazy"></span>
              </button>
              <span class="pf-carte-titre">${esc(sortie.title)}</span>
              <span class="pf-carte-artiste">${esc(sortie.artist)}</span>
              <div class="pf-carte-actions">
                <button type="button" class="fiche-statut" onclick="basculerEcoute('${sortie.id}')">${iconeCollection('coche')}<span>Écouté</span></button>
                <button type="button" class="pf-retirer" onclick="basculerAEcouter('${sortie.id}')" aria-label="Retirer de la liste" title="Retirer de la liste">✕</button>
              </div>
            </div>`;
        }).join('')}
      </div>`;
  }

  // ---------------------------------------------------------------------
  // Succès : le niveau, l'XP, les trophées
  // ---------------------------------------------------------------------

  // Deux emplacements que xp.js remplit (majCarteXpProfil) : la fiche de niveau, puis les succès. Tout vient de
  // la base (sql/xp-refonte.sql).
  function succesPanneauHtml(){

    return `
      <div class="xp-card" id="profilXp"></div>
      <div id="xpSuccesHote"></div>`;
  }

  // ---------------------------------------------------------------------
  // L'affichage
  // ---------------------------------------------------------------------

  // Les onglets que le profil ajoute à ceux de la communauté.
  function onglets(soi){

    const liste = [['collection', 'Collection'], ['journal', 'Journal']];

    if(soi) liste.push(['aecouter', 'À écouter'], ['succes', 'Succès']);

    return liste.map(([cle, libelle]) => ({ cle, libelle }));
  }

  function estUnOnglet(cle){
    return ['collection', 'journal', 'aecouter', 'succes'].includes(cle);
  }

  function panneauHtml(){

    if(ctx.onglet === 'journal') return journalHtml();
    if(ctx.onglet === 'aecouter' && ctx.soi) return aEcouterPanneauHtml();
    if(ctx.onglet === 'succes' && ctx.soi) return succesPanneauHtml();

    return collectionPanneauHtml();
  }

  // Un hôte se redessine d'après ce qu'il porte : de qui, quel onglet. Plusieurs profils peuvent exister
  // dans la page (ceux déjà visités) : chacun garde ses propres réponses.
  function dessiner(hote){

    ctx.uid = hote.dataset.pfUid;
    ctx.soi = hote.dataset.pfSoi === '1';
    ctx.onglet = hote.dataset.pfOnglet;

    hote.innerHTML = panneauHtml();

    if(ctx.onglet === 'succes' && typeof majCarteXpProfil === 'function') majCarteXpProfil();
  }

  // Le panneau d'un onglet, à poser dans la page : il se redessine seul quand une note change (rafraichir).
  function panneau(cle, uid, soi){

    poserFeuille();

    ctx.uid = uid;
    ctx.soi = !!soi;
    ctx.onglet = estUnOnglet(cle) ? cle : 'collection';

    return `<div class="pf-panneau" data-pf-uid="${attr(uid)}" data-pf-soi="${soi ? 1 : 0}" data-pf-onglet="${ctx.onglet}">${panneauHtml()}</div>`;
  }

  // À appeler une fois le panneau posé dans la page : le niveau et la barre d'XP se remplissent alors.
  function apres(){

    if(typeof majCarteXpProfil === 'function') majCarteXpProfil();
  }

  function rafraichir(){

    document.querySelectorAll('[data-pf-uid]').forEach(dessiner);
  }

  // ---------------------------------------------------------------------
  // Les clics
  // ---------------------------------------------------------------------

  document.addEventListener('click', (ev) => {

    const t = ev.target.closest && ev.target.closest('.pf-chip');

    if(t && t.dataset.tri){
      tri = t.dataset.tri;
      const hote = t.closest('[data-pf-uid]');
      if(hote) dessiner(hote);
    }
  });

  // ---------------------------------------------------------------------
  // Les paramètres : le tiroir
  // ---------------------------------------------------------------------

  function ouvrirReglages(){

    const tiroir = document.getElementById('profilReglages');
    if(!tiroir) return;

    if(typeof remplirReglages === 'function') remplirReglages();

    tiroir.classList.add('ouvert');
    tiroir.setAttribute('aria-hidden', 'false');
    document.documentElement.classList.add('pf-tiroir-ouvert');

    const msg = document.getElementById('profileMsg');
    if(msg){ msg.textContent = ''; msg.className = 'form-msg'; }

    if(typeof jouerEntreeFormulaire === 'function') jouerEntreeFormulaire(document.getElementById('profileFormWrap'));

    setTimeout(() => {
      const champ = document.getElementById('profilePseudo');
      if(champ && tiroir.classList.contains('ouvert')) champ.focus({ preventScroll: true });
    }, 380);
  }

  function fermerReglages(){

    const tiroir = document.getElementById('profilReglages');
    if(!tiroir) return;

    tiroir.classList.remove('ouvert');
    tiroir.setAttribute('aria-hidden', 'true');
    document.documentElement.classList.remove('pf-tiroir-ouvert');
  }

  document.addEventListener('keydown', (ev) => {

    if(ev.key !== 'Escape') return;

    const tiroir = document.getElementById('profilReglages');

    // Le recadrage de la photo, ouvert par-dessus, gère sa propre touche Échap.
    const recadrage = document.getElementById('cropModal');
    if(recadrage && recadrage.classList.contains('open')) return;

    if(tiroir && tiroir.classList.contains('ouvert')) fermerReglages();
  });

  window.Profil = { poserFeuille, panneau, apres, onglets, estUnOnglet, rafraichir, actif, ouvrirReglages, fermerReglages };

})();
