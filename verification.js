/* =====================================================================
   La Wave — la vérification d'un profil

   Un membre qui se dit photographe, artiste, journaliste… le prouve avec une
   capture d'écran (son compte Instagram, sa page artiste, son site). L'équipe
   la regarde dans l'espace équipe (onglet « Profils ») et valide : le profil
   reçoit le badge « Profil vérifié ».

   Ce fichier est chargé à la demande (voir ouvrirVerification dans index.html) :
   le reste du site n'en paie pas le poids. Il sert deux fois : en dialogue
   (Verification.ouvrir : depuis le profil ou le voile des accréditations) et en
   pièce de l'assistant d'inscription (Verification.monter).

   La capture part dans un bucket PRIVÉ (Fichiers.envoyerPrive : « preuves-profil »,
   un dossier par membre) ; la demande, elle, passe par la fonction
   verification_demander de la base, qui revérifie tout (rôle, chemin, cadence).
   ===================================================================== */

(function(){

  'use strict';

  // ---------------------------------------------------------------------
  // Ce qu'on demande à chaque rôle
  // ---------------------------------------------------------------------

  const GUIDES = {
    'Photographe': {
      quoi: "Une capture de ton compte Instagram (ou de ton site, de ton portfolio) où l'on voit ton travail et ton nom.",
      exemple: "Par exemple : ton profil Instagram avec tes dernières photos de concert.",
      lien: 'Ton Instagram ou ton portfolio'
    },
    'Artiste': {
      quoi: "Une capture de ta page artiste (Spotify for Artists, Deezer, Apple Music, YouTube ou Instagram) avec ton nom d'artiste et tes sorties.",
      exemple: "Par exemple : ta page Spotify avec tes titres.",
      lien: 'Ta page artiste ou ton Instagram'
    },
    'Beatmaker': {
      quoi: "Une capture de ton profil BeatStars, YouTube, SoundCloud ou Instagram où l'on voit tes productions et ton nom.",
      exemple: "Par exemple : ta page BeatStars avec tes instrus.",
      lien: 'Ta page de prods'
    },
    'DJ': {
      quoi: "Une capture de ton profil Instagram, SoundCloud ou Mixcloud, ou d'une affiche de soirée où tu figures.",
      exemple: "Par exemple : l'affiche d'un événement avec ton nom.",
      lien: 'Ton profil ou ta page de mixes'
    },
    "Membre d'un label": {
      quoi: "Une capture de la page du label (site ou Instagram) où tu figures, ou de tout document qui montre ton rôle dans l'équipe.",
      exemple: "Par exemple : la page « équipe » du site du label.",
      lien: "Le site ou l'Instagram du label"
    },
    'Manager': {
      quoi: "Une capture de la page d'un artiste que tu accompagnes (Instagram, site) où ton nom apparaît, ou de ta fiche d'agence.",
      exemple: "Par exemple : le contact « management » du profil de l'artiste.",
      lien: "La page de l'artiste ou de ton agence"
    },
    'Relation presse': {
      quoi: "Une capture de ton site d'agence ou de ton profil LinkedIn, ou d'un communiqué de presse signé de ton nom.",
      exemple: "Par exemple : la page « équipe » de ton agence.",
      lien: "Ton site d'agence ou ton LinkedIn"
    },
    'Média / Presse': {
      quoi: "Une capture de ta page auteur sur le média, de ta carte de presse (masque ce qui est privé) ou d'un article signé de ton nom.",
      exemple: "Par exemple : ta page auteur, avec ton nom et celui du média.",
      lien: 'Ta page auteur ou ton média'
    }
  };

  const GUIDE_PAR_DEFAUT = {
    quoi: "Une capture d'écran qui montre ton métier et ton nom.",
    exemple: '',
    lien: 'Un lien vers ton travail'
  };

  const TYPES = ['image/png', 'image/jpeg', 'image/webp'];

  // ---------------------------------------------------------------------
  // Petites aides
  // ---------------------------------------------------------------------

  const esc = (t) => escapeHtml(t);
  const attr = (t) => escapeAttribute(t);

  const date = (iso) => iso ? formatFrDate(String(iso).slice(0, 10)) : '';

  // Des déclarations tardives : le fichier peut être chargé avant que la page n'ait fini de se construire.
  const icone = () => iconeVerifie();

  // ---------------------------------------------------------------------
  // La feuille de style, posée une fois
  // ---------------------------------------------------------------------

  const FEUILLE = `
  .vd-fond{
    position:fixed; inset:0; z-index:190; display:flex; align-items:center; justify-content:center;
    padding:20px; background:rgba(3,5,8,.64);
    -webkit-backdrop-filter:blur(14px) saturate(120%); backdrop-filter:blur(14px) saturate(120%);
    opacity:0; transition:opacity .35s var(--ease);
  }
  .vd-fond.ouvert{opacity:1;}
  .vd-carte{
    position:relative; width:min(560px,100%); max-height:calc(100dvh - 40px); overflow:auto;
    padding:30px 28px 26px; border-radius:var(--radius-lg);
    background:rgba(11,15,21,.94); border:1px solid var(--line-strong);
    box-shadow:var(--ombre-3), var(--reflet-int);
    transform:translateY(18px) scale(.97); transition:transform .55s var(--ease);
  }
  .vd-fond.ouvert .vd-carte{transform:none;}
  .vd-fermer{
    position:absolute; top:14px; right:14px; width:34px; height:34px; border-radius:50%;
    display:flex; align-items:center; justify-content:center; font-size:14px; cursor:pointer;
    color:var(--ink-soft); background:rgba(255,255,255,.05); border:1px solid var(--line);
    transition:background .2s var(--ease), color .2s var(--ease);
  }
  .vd-fermer:hover{background:rgba(255,255,255,.1); color:#fff;}

  .vd-entete{display:flex; gap:14px; align-items:center; margin-bottom:20px; padding-right:34px;}
  .vd-ic{
    width:46px; height:46px; border-radius:50%; flex-shrink:0;
    display:flex; align-items:center; justify-content:center;
    color:var(--blue-bright); background:rgba(79,180,255,.12); box-shadow:0 0 22px rgba(20,137,222,.22);
  }
  .vd-ic svg{width:26px; height:26px;}
  .vd-entete h3{margin:0; font-size:19px; line-height:1.25;}
  .vd-entete p{margin:4px 0 0; font-size:13px; color:var(--ink-soft);}

  .vd-bloc{margin:0 0 18px; animation:vdMonte .5s var(--ease) both; animation-delay:calc(var(--i,0) * 70ms);}
  .vd-bloc > b{display:flex; align-items:center; gap:8px; font-size:13px; margin-bottom:6px;}
  .vd-num{
    width:20px; height:20px; border-radius:50%; flex-shrink:0; background:var(--blue); color:#fff;
    font-size:11px; display:inline-flex; align-items:center; justify-content:center;
  }
  .vd-bloc p{margin:0 0 10px; font-size:13px; color:var(--ink-soft);}
  .vd-bloc .vd-exemple{font-size:12px; color:var(--muted); font-style:italic;}
  .vd-bloc .field{margin:0;}

  .vd-depot{
    position:relative; display:flex; flex-direction:column; align-items:center; justify-content:center;
    gap:8px; min-height:150px; padding:18px; text-align:center; cursor:pointer;
    border-radius:var(--radius); border:1.5px dashed rgba(255,255,255,.22);
    background:rgba(255,255,255,.03); color:var(--ink-soft); font-size:13px;
    transition:border-color .25s var(--ease), background .25s var(--ease);
  }
  .vd-depot:hover, .vd-depot:focus-visible, .vd-depot.survol{
    border-color:var(--blue-bright); background:rgba(79,180,255,.07); outline:none;
  }
  .vd-depot > svg{width:30px; height:30px; color:var(--blue-bright);}
  .vd-depot .vd-astuce{font-size:12px; color:var(--muted);}
  .vd-depot.plein{padding:10px; border-style:solid; border-color:rgba(79,180,255,.45);}
  .vd-depot img{
    max-width:100%; max-height:230px; border-radius:var(--radius-sm); object-fit:contain;
    animation:vdPop .45s var(--ease) both;
  }
  .vd-changer{margin-top:8px; font-size:12px; color:var(--blue-bright); text-decoration:underline;}

  .vd-confidentiel{
    display:flex; gap:8px; align-items:flex-start; margin:4px 0 18px; padding:12px 14px;
    font-size:12px; color:var(--ink-soft); border-radius:var(--radius-sm);
    background:rgba(255,255,255,.04); border:1px solid var(--line);
  }
  .vd-actions{display:flex; gap:10px; flex-wrap:wrap; align-items:center;}
  .vd-actions .btn{flex-shrink:0;}
  .vd-refus{
    margin:0 0 18px; padding:12px 14px; font-size:13px; border-radius:var(--radius-sm);
    color:#ffd3ce; background:rgba(229,105,92,.12); border:1px solid rgba(229,105,92,.4);
  }

  .vd-etat{display:flex; flex-direction:column; align-items:center; text-align:center; gap:10px; padding:10px 0 4px;}
  .vd-etat h3{margin:0; font-size:20px;}
  .vd-etat p{margin:0; max-width:40ch; font-size:14px; color:var(--ink-soft);}
  .vd-etat .vd-grand{
    width:76px; height:76px; border-radius:50%; display:flex; align-items:center; justify-content:center;
    color:var(--blue-bright); background:rgba(79,180,255,.12); box-shadow:0 0 34px rgba(20,137,222,.3);
    animation:vdPop .6s var(--ease) both;
  }
  .vd-etat .vd-grand svg{width:46px; height:46px;}
  .vd-etat.attente .vd-grand{color:var(--gold-favori); background:rgba(233,196,106,.12); box-shadow:0 0 34px rgba(233,196,106,.22); font-size:34px;}
  .vd-coche path{stroke-dasharray:30; stroke-dashoffset:30; animation:vdTrace .6s .3s var(--ease) forwards;}

  .vd-compact .vd-entete{display:none;}
  .vd-compact{padding:0;}

  @keyframes vdMonte{from{opacity:0; transform:translateY(12px);} to{opacity:1; transform:none;}}
  @keyframes vdPop{from{opacity:0; transform:scale(.86);} to{opacity:1; transform:none;}}
  @keyframes vdTrace{to{stroke-dashoffset:0;}}
  @media (prefers-reduced-motion:reduce){
    .vd-fond, .vd-carte{transition:none;}
    .vd-bloc, .vd-depot img, .vd-etat .vd-grand{animation:none;}
    .vd-coche path{animation:none; stroke-dashoffset:0;}
  }
  @media (max-width:560px){
    .vd-fond{padding:0; align-items:flex-end;}
    .vd-carte{width:100%; max-height:92dvh; border-radius:var(--radius-lg) var(--radius-lg) 0 0; padding:26px 20px 22px;}
  }
  `;

  function poserFeuille(){
    if(document.getElementById('vd-feuille')) return;
    const style = document.createElement('style');
    style.id = 'vd-feuille';
    style.textContent = FEUILLE;
    document.head.appendChild(style);
  }

  // ---------------------------------------------------------------------
  // L'état : où en est ce membre ?
  // ---------------------------------------------------------------------

  async function etat(){

    const moi = currentUser;
    const role = roleNom(moi.role);
    const verifiable = roleAVerifier(role);
    const verifie = !!(moi.verifie && moi.verifieRole === role);

    let demande = null;

    const { data, error } = await supabaseClient.rpc('verification_ma_demande');

    if(!error) demande = data || null;

    return { role, verifiable, verifie, demande, indisponible: !!error };
  }

  // ---------------------------------------------------------------------
  // Le composant : monte l'une des vues dans `racine`
  // ---------------------------------------------------------------------
  //
  // options : { compact, surEnvoye(demande), surPlusTard(), surFermer() }
  //   compact : sans en-tête, pour l'assistant d'inscription.

  async function monter(racine, options){

    const opt = options || {};
    poserFeuille();

    racine.classList.add('vd-corps');
    racine.classList.toggle('vd-compact', !!opt.compact);
    racine.innerHTML = `<div class="vd-etat"><p>Chargement…</p></div>`;

    let e;
    try{
      e = await etat();
    }catch(erreur){
      racine.innerHTML = `<div class="vd-etat"><p>${esc(erreur.message)}</p></div>`;
      return null;
    }

    const controleur = { nettoyer(){} };

    const fermer = () => { if(opt.surFermer) opt.surFermer(); };

    // ----- Le rôle n'a rien à prouver -----
    if(!e.verifiable){
      racine.innerHTML = `
        <div class="vd-etat">
          <h3>Pas de vérification pour ce rôle</h3>
          <p>Seuls les métiers de la musique et de l'image se font vérifier. Si tu es photographe, artiste, DJ…
             choisis-le dans ton profil.</p>
          <div class="vd-actions"><button type="button" class="btn btn-ghost" data-vd="fermer">Fermer</button></div>
        </div>`;
      racine.querySelector('[data-vd="fermer"]').addEventListener('click', fermer);
      return controleur;
    }

    // ----- La base n'a pas encore la vérification -----
    if(e.indisponible){
      racine.innerHTML = `
        <div class="vd-etat">
          <h3>Bientôt disponible</h3>
          <p>La vérification des profils n'est pas encore ouverte. Reviens dans quelques jours.</p>
          <div class="vd-actions"><button type="button" class="btn btn-ghost" data-vd="fermer">Fermer</button></div>
        </div>`;
      racine.querySelector('[data-vd="fermer"]').addEventListener('click', fermer);
      return controleur;
    }

    // ----- Déjà vérifié -----
    if(e.verifie){
      racine.innerHTML = `
        <div class="vd-etat">
          <span class="vd-grand vd-coche">${icone()}</span>
          <h3>Profil vérifié</h3>
          <p>L'équipe a validé ton profil ${esc(e.role)}${currentUser.verifieLe ? ' le ' + esc(date(currentUser.verifieLe)) : ''}.
             Le badge s'affiche à côté de ton nom.</p>
          <div class="vd-actions"><button type="button" class="btn btn-primary" data-vd="fermer">Super</button></div>
        </div>`;
      racine.querySelector('[data-vd="fermer"]').addEventListener('click', fermer);
      return controleur;
    }

    // ----- Une demande attend l'équipe -----
    const attente = e.demande && e.demande.statut === 'en_attente';

    const montrerAttente = () => {
      racine.innerHTML = `
        <div class="vd-etat attente">
          <span class="vd-grand" aria-hidden="true">⏳</span>
          <h3>Vérification en cours</h3>
          <p>Ta demande est partie${e.demande ? ' le ' + esc(date(e.demande.cree_le)) : ''}. L'équipe regarde ta capture :
             tu seras prévenu dès qu'elle est validée.</p>
          <div class="vd-actions">
            <button type="button" class="btn btn-primary" data-vd="fermer">D'accord</button>
            <button type="button" class="btn btn-ghost" data-vd="modifier">Envoyer une autre capture</button>
          </div>
        </div>`;
      racine.querySelector('[data-vd="fermer"]').addEventListener('click', fermer);
      racine.querySelector('[data-vd="modifier"]').addEventListener('click', montrerFormulaire);
    };

    // ----- Le formulaire -----
    const guide = GUIDES[e.role] || GUIDE_PAR_DEFAUT;

    function montrerFormulaire(){

      const refuse = e.demande && e.demande.statut === 'refuse';

      racine.innerHTML = `
        <div class="vd-entete">
          <span class="vd-ic" aria-hidden="true">${icone()}</span>
          <div>
            <h3>Fais vérifier ton profil ${esc(e.role)}</h3>
            <p>Une capture, validée par l'équipe : ton profil reçoit le badge « Profil vérifié ».</p>
          </div>
        </div>

        ${refuse ? `<p class="vd-refus"><b>Demande précédente refusée.</b> ${esc(e.demande.motif_refus || '')} Tu peux en envoyer une nouvelle.</p>` : ''}

        <div class="vd-bloc" style="--i:0">
          <b><span class="vd-num">1</span>Une capture qui le prouve</b>
          <p>${esc(guide.quoi)}</p>
          ${guide.exemple ? `<p class="vd-exemple">${esc(guide.exemple)}</p>` : ''}
          <div class="vd-depot" id="vd-depot" role="button" tabindex="0" aria-label="Choisir une capture d'écran">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16V4m0 0-4 4m4-4 4 4"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>
            <span>${window.matchMedia && window.matchMedia('(pointer: coarse)').matches
              ? 'Touche ici pour choisir ta capture dans ta galerie'
              : 'Glisse ta capture ici, colle-la (Ctrl+V) ou clique pour la choisir'}</span>
            <span class="vd-astuce">JPG, PNG ou WEBP</span>
          </div>
          <input type="file" id="vd-fichier" accept="image/png,image/jpeg,image/webp" hidden>
        </div>

        <div class="vd-bloc" style="--i:1">
          <b><span class="vd-num">2</span>Un lien <span style="font-weight:400; color:var(--muted);">— facultatif</span></b>
          <div class="field">
            <input type="text" id="vd-lien" maxlength="300" placeholder="${attr(guide.lien)}" autocomplete="off" spellcheck="false">
          </div>
        </div>

        <div class="vd-bloc" style="--i:2">
          <b><span class="vd-num">3</span>Un mot pour l'équipe <span style="font-weight:400; color:var(--muted);">— facultatif</span></b>
          <div class="field">
            <textarea id="vd-message" rows="2" maxlength="500" placeholder="Ce que tu fais, où te trouver…"></textarea>
          </div>
        </div>

        <p class="vd-confidentiel">
          <span aria-hidden="true">🔒</span>
          <span>Seule l'équipe La Wave voit cette capture. Elle ne sert qu'à vérifier ton profil et n'est jamais publique.</span>
        </p>

        <div class="vd-actions">
          <button type="button" class="btn btn-primary" id="vd-envoyer" disabled>Envoyer pour vérification</button>
          ${opt.surPlusTard ? `<button type="button" class="btn btn-ghost" id="vd-plus-tard">Plus tard</button>` : ''}
          ${attente ? `<button type="button" class="btn btn-ghost" id="vd-retour">Retour</button>` : ''}
        </div>
        <div class="form-msg" id="vd-msg" style="margin-top:12px;"></div>`;

      const depot = racine.querySelector('#vd-depot');
      const entree = racine.querySelector('#vd-fichier');
      const lien = racine.querySelector('#vd-lien');
      const message = racine.querySelector('#vd-message');
      const bouton = racine.querySelector('#vd-envoyer');
      const msg = racine.querySelector('#vd-msg');

      let fichier = null;
      let apercu = null;
      let enCours = false;

      const dire = (texte, ok) => {
        msg.textContent = texte || '';
        msg.className = texte ? 'form-msg ' + (ok ? 'ok' : 'err') : 'form-msg';
      };

      const choisir = (f) => {

        if(!f) return;

        if(!TYPES.includes(f.type)){
          dire('Une image JPG, PNG ou WEBP, s\'il te plaît (pas de PDF ni de vidéo).');
          return;
        }

        if(f.size > 60 * 1024 * 1024){
          dire('Cette image est trop lourde (60 Mo au plus).');
          return;
        }

        if(apercu) URL.revokeObjectURL(apercu);
        fichier = f;
        apercu = URL.createObjectURL(f);

        depot.classList.add('plein');
        depot.innerHTML = `
          <img src="${attr(apercu)}" alt="Aperçu de ta capture">
          <span class="vd-changer">Changer de capture</span>`;

        dire('');
        bouton.disabled = false;
      };

      depot.addEventListener('click', () => entree.click());
      depot.addEventListener('keydown', (ev) => {
        if(ev.key === 'Enter' || ev.key === ' '){ ev.preventDefault(); entree.click(); }
      });
      entree.addEventListener('change', () => { choisir(entree.files[0]); entree.value = ''; });

      depot.addEventListener('dragover', (ev) => { ev.preventDefault(); depot.classList.add('survol'); });
      depot.addEventListener('dragleave', () => depot.classList.remove('survol'));
      depot.addEventListener('drop', (ev) => {
        ev.preventDefault();
        depot.classList.remove('survol');
        choisir(ev.dataTransfer && ev.dataTransfer.files[0]);
      });

      // Une capture d'écran se colle : Ctrl+V, depuis le presse-papiers, où qu'on soit dans la fenêtre.
      const coller = (ev) => {
        const fichiers = ev.clipboardData && ev.clipboardData.files;
        if(fichiers && fichiers.length){
          ev.preventDefault();
          choisir(fichiers[0]);
        }
      };
      document.addEventListener('paste', coller);

      controleur.nettoyer = () => {
        document.removeEventListener('paste', coller);
        if(apercu) URL.revokeObjectURL(apercu);
      };

      bouton.addEventListener('click', async () => {

        if(enCours) return;

        if(!fichier){
          dire('Ajoute une capture : c\'est ce qui permet à l\'équipe de vérifier ton profil.');
          return;
        }

        let adresse = lien.value.trim();

        if(adresse && !/^https?:\/\//i.test(adresse)){
          // « instagram.com/lea.photo » ou « @lea.photo » : on complète, comme pour le portfolio.
          adresse = typeof normaliserPortfolio === 'function' ? normaliserPortfolio(adresse) : 'https://' + adresse;
        }

        enCours = true;
        bouton.disabled = true;
        const libelle = bouton.textContent;
        bouton.textContent = 'Envoi…';
        dire('');

        try{

          const extension = fichier.type === 'image/png' ? 'png' : fichier.type === 'image/webp' ? 'webp' : 'jpg';
          const nom = Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.' + extension;

          const chemin = await Fichiers.envoyerPrive(fichier, nom);

          const { data, error } = await supabaseClient.rpc('verification_demander', {
            p_preuve: chemin,
            p_lien: adresse || null,
            p_message: message.value.trim() || null
          });

          if(error) throw error;

          controleur.nettoyer();

          e.demande = { id: data, statut: 'en_attente', cree_le: new Date().toISOString() };

          if(opt.surEnvoye) opt.surEnvoye(e.demande);

          // La carte du profil se met à jour d'elle-même.
          if(typeof rendreCarteVerification === 'function') rendreCarteVerification();

          if(!opt.surEnvoye) montrerEnvoye();

        }catch(erreur){
          dire(erreur.message || "L'envoi a échoué : réessaie.");
          bouton.disabled = false;
          bouton.textContent = libelle;
          enCours = false;
        }
      });

      const plusTard = racine.querySelector('#vd-plus-tard');
      if(plusTard) plusTard.addEventListener('click', () => { controleur.nettoyer(); opt.surPlusTard(); });

      const retour = racine.querySelector('#vd-retour');
      if(retour) retour.addEventListener('click', () => { controleur.nettoyer(); montrerAttente(); });
    }

    function montrerEnvoye(){
      racine.innerHTML = `
        <div class="vd-etat">
          <span class="vd-grand vd-coche"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg></span>
          <h3>Demande envoyée</h3>
          <p>L'équipe regarde ta capture. Tu seras prévenu dès qu'elle est validée : le badge « Profil vérifié »
             apparaîtra à côté de ton nom.</p>
          <div class="vd-actions"><button type="button" class="btn btn-primary" data-vd="fermer">Parfait</button></div>
        </div>`;
      racine.querySelector('[data-vd="fermer"]').addEventListener('click', fermer);
    }

    if(attente) montrerAttente();
    else montrerFormulaire();

    return controleur;
  }

  // ---------------------------------------------------------------------
  // Le dialogue
  // ---------------------------------------------------------------------

  let ouvert = null;

  async function ouvrir(options){

    if(!currentUser) return;

    if(ouvert) return;

    poserFeuille();

    const fond = document.createElement('div');
    fond.className = 'vd-fond';
    fond.setAttribute('role', 'dialog');
    fond.setAttribute('aria-modal', 'true');
    fond.setAttribute('aria-label', 'Faire vérifier mon profil');

    const carte = document.createElement('div');
    carte.className = 'vd-carte';
    carte.innerHTML = `<button type="button" class="vd-fermer" aria-label="Fermer">✕</button><div class="vd-contenu"></div>`;
    fond.appendChild(carte);
    document.body.appendChild(fond);

    requestAnimationFrame(() => requestAnimationFrame(() => fond.classList.add('ouvert')));

    let controleur = null;

    const fermer = () => {
      if(!ouvert) return;
      ouvert = null;
      document.removeEventListener('keydown', surTouche);
      if(controleur) controleur.nettoyer();
      fond.classList.remove('ouvert');
      setTimeout(() => fond.remove(), 380);
      // La carte du profil reflète l'état d'après.
      if(typeof rendreCarteVerification === 'function') rendreCarteVerification();
    };

    const surTouche = (ev) => { if(ev.key === 'Escape') fermer(); };

    ouvert = { fermer };

    document.addEventListener('keydown', surTouche);
    carte.querySelector('.vd-fermer').addEventListener('click', fermer);
    fond.addEventListener('mousedown', (ev) => { if(ev.target === fond) fermer(); });

    controleur = await monter(carte.querySelector('.vd-contenu'), { surFermer: fermer });
  }

  window.Verification = { ouvrir, monter, etat, GUIDES };

})();
