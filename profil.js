/* =====================================================================
   La Wave — la page « Mon profil »

   Une page claire : qui je suis en haut (avec l'engrenage des paramètres à droite), puis
   ma collection, comme un journal d'écoute. Quatre onglets :

     Collection   le podium (trois favorites), puis tout ce que j'ai écouté, avec ma note
     Journal      mes écoutes jour après jour, mois par mois, et ce que j'explore
     À écouter    les sorties mises de côté
     Succès       le niveau, l'XP et les trophées

   Les paramètres (photo, pseudo, description, rôle, réseaux) s'ouvrent dans un tiroir : le
   formulaire reste celui d'index.html (saveProfile), seul son emplacement a changé.

   Chargé à la demande (voir renderProfileForm dans index.html). Les données viennent de la
   mémoire du site : toutesLesNotes et catalogueData, déjà chargés avec le catalogue.
   ===================================================================== */

(function(){

  'use strict';

  const esc = (t) => escapeHtml(t);
  const attr = (t) => escapeAttribute(t);

  // ---------------------------------------------------------------------
  // La feuille de style, posée une fois
  // ---------------------------------------------------------------------

  const FEUILLE = `
  .pf-corps{max-width:980px; margin:0 auto;}

  /* ----- l'identité ----- */
  .pf-entete{position:relative; padding-top:4px; animation:fondu .5s var(--ease) both;}
  .pf-engrenage{
    position:absolute; top:0; right:0; z-index:2; width:44px; height:44px; padding:0; border-radius:50%;
    display:flex; align-items:center; justify-content:center; color:var(--ink-soft);
    background:var(--glass); border:1px solid var(--line);
    -webkit-backdrop-filter:blur(var(--glass-blur-sm)); backdrop-filter:blur(var(--glass-blur-sm));
    transition:transform .6s var(--ease), color .25s var(--ease), background .25s var(--ease), border-color .25s var(--ease);
  }
  .pf-engrenage:hover{transform:rotate(70deg); color:#fff; background:var(--glass-hi); border-color:var(--line-strong);}
  .pf-engrenage svg{width:22px; height:22px;}
  .pf-identite{display:flex; align-items:center; gap:20px; padding-right:58px;}
  .pf-photo{
    width:104px; height:104px; flex-shrink:0; border-radius:50%; overflow:hidden;
    display:flex; align-items:center; justify-content:center; font-size:40px; font-weight:700;
    color:var(--blue-bright); text-transform:uppercase; background:rgba(255,255,255,.06);
    box-shadow:0 0 0 1px var(--line-strong), 0 18px 44px rgba(0,0,0,.45);
  }
  .pf-photo img{width:100%; height:100%; object-fit:cover; display:block;}
  .pf-nom{min-width:0;}
  .pf-nom h2{
    display:flex; align-items:center; gap:8px; margin:0; font-size:clamp(26px,5vw,36px);
    letter-spacing:-.025em; line-height:1.08; overflow-wrap:anywhere;
  }
  .pf-meta{margin:8px 0 0; display:flex; align-items:center; gap:10px; flex-wrap:wrap; font-size:14px; color:var(--ink-soft);}
  .pf-niveau{
    padding:3px 11px; border-radius:var(--radius-pill); border:0; font-size:12px; font-weight:600;
    color:var(--blue-bright); background:rgba(79,180,255,.12); transition:background .25s var(--ease);
  }
  .pf-niveau:hover{background:rgba(79,180,255,.22);}
  .pf-bio{margin:18px 0 0; max-width:62ch; font-size:15px; line-height:1.6; color:var(--ink-soft); white-space:pre-wrap; overflow-wrap:anywhere;}
  .pf-liens{display:flex; gap:8px; flex-wrap:wrap; margin-top:16px;}
  .pf-lien{
    padding:6px 14px; border-radius:var(--radius-pill); font-size:12.5px; font-weight:600; color:var(--ink-soft);
    background:rgba(255,255,255,.05); border:1px solid var(--line);
    transition:color .2s var(--ease), border-color .2s var(--ease), background .2s var(--ease);
  }
  .pf-lien:hover{color:#fff; border-color:var(--line-strong); background:rgba(255,255,255,.09);}
  .pf-stats{display:flex; gap:36px; flex-wrap:wrap; margin:26px 0 0;}
  .pf-stats div{display:flex; flex-direction:column-reverse; gap:2px;}
  .pf-stats dd{margin:0; font-size:26px; font-weight:700; letter-spacing:-.02em; line-height:1; font-variant-numeric:tabular-nums;}
  .pf-stats dt{font-size:12.5px; color:var(--muted);}
  .pf-public{display:inline-block; margin-top:18px; font-size:13px;}

  /* « Termine ton profil », « Fais vérifier ton profil » : des bandeaux discrets. */
  #profilVerification{margin-top:22px;}
  #profilVerification:empty{display:none;}
  #profilVerification .vf-carte-profil{margin:0 0 10px; padding:12px 16px; box-shadow:none; background:rgba(255,255,255,.035);}
  #profilVerification .vf-carte-profil .vf-ic{width:36px; height:36px; font-size:16px;}
  #profilVerification .vf-carte-profil .vf-texte b{font-size:14px;}
  #profilVerification .btn{padding:9px 16px; font-size:13px;}
  /* Un bandeau, une ligne : le titre et le bouton. Le détail se lit dans le dialogue. */
  #profilVerification .vf-carte-profil .vf-texte span{display:none;}
  #profilVerification .vf-carte-profil{gap:12px;}

  /* ----- les onglets ----- */
  .pf-onglets{
    display:flex; gap:4px; margin-top:30px; overflow-x:auto; scrollbar-width:none;
    border-bottom:1px solid var(--line);
  }
  .pf-onglets::-webkit-scrollbar{display:none;}
  .pf-onglet{
    position:relative; padding:13px 14px; background:none; border:0; white-space:nowrap;
    font-size:14.5px; font-weight:600; color:var(--muted); transition:color .25s var(--ease);
  }
  .pf-onglet:hover{color:var(--ink-soft);}
  .pf-onglet em{margin-left:6px; font-style:normal; font-size:12px; font-weight:500; color:var(--muted);}
  .pf-onglet[aria-selected="true"]{color:#fff;}
  .pf-onglet::after{
    content:""; position:absolute; left:14px; right:14px; bottom:-1px; height:2px; border-radius:2px;
    background:var(--blue-bright); transform:scaleX(0); transition:transform .4s var(--ease);
  }
  .pf-onglet[aria-selected="true"]::after{transform:scaleX(1);}
  .pf-panneau{padding-top:26px; animation:fondu .45s var(--ease) both;}

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
    .pf-identite{gap:14px; padding-right:52px;}
    .pf-photo{width:80px; height:80px; font-size:30px;}
    .pf-stats{gap:26px;}
    .pf-stats dd{font-size:22px;}
    .pf-grille{grid-template-columns:repeat(3,minmax(0,1fr)); gap:16px 10px;}
    .pf-aecouter{grid-template-columns:repeat(2,minmax(0,1fr)); gap:20px 12px;}
    .pf-podium-grille{gap:10px;}
    .pf-resume .pf-mois-barres{margin-left:0; width:100%;}
    .pf-tiroir-panneau{border-left:0;}
  }
  @media (prefers-reduced-motion:reduce){
    .pf-entete, .pf-panneau, .pf-marche, .pf-pochette, .pf-carte, .pf-mois-barres i{animation:none;}
    .pf-engrenage, .pf-tiroir-panneau, .pf-tiroir-fond, .pf-onglet::after{transition:none;}
    .pf-engrenage:hover{transform:none;}
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

  let ongletCourant = 'collection';
  let tri = 'recentes';
  let social = null;          // { abonnes, abonnements } : la communauté, quand elle répond
  let socialPour = null;

  const sortieDe = (ligne) => catalogueData.find(s => s.id === ligne.release_id);

  const mesLignes = () => toutesLesNotes.filter(n => n.user_id === currentUser.id);

  const ecoutees = () => mesLignes().filter(n => n.saved && sortieDe(n));

  const aEcouter = () => mesLignes().filter(n => n.a_ecouter && !n.saved && sortieDe(n));

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
    const page = document.getElementById('page-profile');
    return !!(currentUser && page && page.classList.contains('active') && document.getElementById('pfCorps'));
  }

  // ---------------------------------------------------------------------
  // L'identité
  // ---------------------------------------------------------------------

  const ENGRENAGE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5h0a1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>';

  function enteteHtml(){

    const u = currentUser;
    const photo = safeUrl(u.avatar);
    const niveau = levelForXP(u.xp);
    const role = roleInfo(u.role);
    const liens = Object.entries({
      portfolio: 'Portfolio', instagram: 'Instagram', twitter: 'X', tiktok: 'TikTok',
      spotify: 'Spotify', appleMusic: 'Apple Music', deezer: 'Deezer'
    }).map(([cle, libelle]) => [safeUrl((u.socials || {})[cle]), libelle])
      .filter(([url]) => url)
      .map(([url, libelle]) => `<a class="pf-lien" href="${attr(url)}" target="_blank" rel="noopener noreferrer">${esc(libelle)}</a>`)
      .join('');

    const nbEcoutees = ecoutees().length;

    return `
      <button type="button" class="pf-engrenage" onclick="Profil.ouvrirReglages()" aria-label="Paramètres du profil" title="Paramètres">${ENGRENAGE}</button>
      <div class="pf-identite">
        <span class="pf-photo">${photo ? `<img src="${attr(photo)}" alt="">` : esc(artistInitial(u.pseudo))}</span>
        <div class="pf-nom">
          <h2>${esc(u.pseudo)}${u.verifie && typeof cocheVerifieHtml === 'function'
            ? cocheVerifieHtml('Profil vérifié' + (u.verifieRole ? ' · ' + u.verifieRole : '')) : ''}</h2>
          <p class="pf-meta">
            <span>${esc(role.icon)} ${esc(role.name)}</span>
            <button type="button" class="pf-niveau" onclick="Profil.onglet('succes')" title="Voir mes succès">Niveau ${niveau}</button>
          </p>
        </div>
      </div>
      ${u.bio ? `<p class="pf-bio">${esc(u.bio)}</p>` : ''}
      ${liens ? `<div class="pf-liens">${liens}</div>` : ''}
      <dl class="pf-stats">
        <div><dd>${nbEcoutees}</dd><dt>écoutée${nbEcoutees > 1 ? 's' : ''}</dt></div>
        ${social ? `
        <div><dd>${social.abonnes}</dd><dt>abonné${social.abonnes > 1 ? 's' : ''}</dt></div>
        <div><dd>${social.abonnements}</dd><dt>abonnement${social.abonnements > 1 ? 's' : ''}</dt></div>` : ''}
      </dl>
      ${social ? `<a class="pf-public lien-discret" href="javascript:void(0)" onclick="viewProfile('${attr(u.id)}')">Voir mon profil public</a>` : ''}`;
  }

  // ---------------------------------------------------------------------
  // Les onglets
  // ---------------------------------------------------------------------

  function ongletsHtml(){

    const liste = [
      ['collection', 'Collection', ecoutees().length],
      ['journal', 'Journal', null],
      ['aecouter', 'À écouter', aEcouter().length],
      ['succes', 'Succès', null]
    ];

    return liste.map(([cle, libelle, n]) => `
      <button type="button" class="pf-onglet" role="tab" id="pf-onglet-${cle}" data-onglet="${cle}"
              aria-selected="${cle === ongletCourant}" aria-controls="pfPanneau" tabindex="${cle === ongletCourant ? 0 : -1}">
        ${libelle}${n ? `<em>${n}</em>` : ''}
      </button>`).join('');
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

    const favoris = mesLignes().filter(n => n.favori && sortieDe(n));

    if(!favoris.length && !ecoutees().length) return '';

    const marches = [];

    for(let i = 0; i < MAX_FAVORIS; i++){

      const ligne = favoris[i];
      const sortie = ligne && sortieDe(ligne);

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
        ${favoris.length < MAX_FAVORIS ? `<p class="pf-indice">Ajoute une favorite depuis la fiche d'une sortie : « Podium ».</p>` : ''}
      </div>`;
  }

  function collectionPanneauHtml(){

    const lignes = ecoutees();

    if(!lignes.length){
      return videHtml(
        'Ta collection est vide',
        "Touche le « + » d'une pochette du catalogue, ou « J'ai écouté » sur une fiche : tes sorties s'ajoutent ici, avec ta note.",
        ['Parcourir le catalogue', "goTo('catalogue')"]
      );
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
      return videHtml(
        'Ton journal est vide',
        "Chaque sortie que tu écoutes s'y inscrit avec son jour : tu verras combien tu en explores chaque mois.",
        ['Parcourir le catalogue', "goTo('catalogue')"]
      );
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
        ${moyenne !== null ? `<div><dd>${moyenne.toFixed(1).replace('.', ',')}</dd><dt>ta note moyenne</dt></div>` : ''}
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

  function succesPanneauHtml(){

    return `
      <div class="xp-card" id="profilXp"></div>
      <div class="pf-succes-tete">
        <h3 class="pf-titre-petit">Succès</h3>
        <span>${nombreDeSucces(currentUser)} / ${SUCCES.length}</span>
      </div>
      ${succesHtml(currentUser)}`;
  }

  // ---------------------------------------------------------------------
  // L'affichage
  // ---------------------------------------------------------------------

  function panneauHtml(){

    if(ongletCourant === 'journal') return journalHtml();
    if(ongletCourant === 'aecouter') return aEcouterPanneauHtml();
    if(ongletCourant === 'succes') return succesPanneauHtml();

    return collectionPanneauHtml();
  }

  function dessinerPanneau(animer){

    const zone = document.getElementById('pfPanneau');
    if(!zone) return;

    zone.innerHTML = panneauHtml();
    zone.setAttribute('aria-labelledby', 'pf-onglet-' + ongletCourant);

    // Le panneau ne rejoue son entrée que quand on change d'onglet, pas à chaque note donnée.
    if(animer){
      zone.style.animation = 'none';
      void zone.offsetWidth;
      zone.style.animation = '';
    }

    if(ongletCourant === 'succes' && typeof majCarteXpProfil === 'function') majCarteXpProfil();
  }

  function dessinerEntete(){

    const entete = document.getElementById('pfEntete');
    const onglets = document.getElementById('pfOnglets');

    if(entete) entete.innerHTML = enteteHtml();
    if(onglets) onglets.innerHTML = ongletsHtml();
  }

  // Les chiffres de la communauté : une lecture par membre, sans bloquer la page.
  async function chargerSocial(){

    if(socialPour === currentUser.id) return;

    socialPour = currentUser.id;

    try{
      const { data, error } = await supabaseClient.rpc('com_profil', { p_cle: currentUser.id });

      if(!error && data && data.stats){
        social = { abonnes: data.stats.abonnes || 0, abonnements: data.stats.abonnements || 0 };
        if(actif()) dessinerEntete();
      }
    }catch(erreur){
      // La communauté n'est pas là : seul le nombre d'écoutes s'affiche.
    }
  }

  function monter(){

    poserFeuille();

    const racine = document.getElementById('pfCorps');
    if(!racine) return;

    racine.innerHTML = `
      <header class="pf-entete" id="pfEntete"></header>
      <div id="profilVerification"></div>
      <nav class="pf-onglets" id="pfOnglets" role="tablist" aria-label="Mon profil"></nav>
      <div class="pf-panneau" id="pfPanneau" role="tabpanel"></div>`;

    if(socialPour !== currentUser.id) social = null;

    dessinerEntete();
    dessinerPanneau(false);

    if(typeof rendreCarteVerification === 'function') rendreCarteVerification();

    chargerSocial();
  }

  function rafraichir(){

    if(!actif()) return;

    dessinerEntete();
    dessinerPanneau(false);
  }

  function onglet(cle){

    if(!['collection', 'journal', 'aecouter', 'succes'].includes(cle)) return;

    const change = cle !== ongletCourant;

    ongletCourant = cle;

    const onglets = document.getElementById('pfOnglets');
    if(onglets) onglets.innerHTML = ongletsHtml();

    dessinerPanneau(change);

    if(onglets && change) onglets.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  // ---------------------------------------------------------------------
  // Les clics
  // ---------------------------------------------------------------------

  document.addEventListener('click', (ev) => {

    const o = ev.target.closest && ev.target.closest('.pf-onglet');

    if(o){ onglet(o.dataset.onglet); return; }

    const t = ev.target.closest && ev.target.closest('.pf-chip');

    if(t && t.dataset.tri){
      tri = t.dataset.tri;
      dessinerPanneau(false);
    }
  });

  document.addEventListener('keydown', (ev) => {

    const o = ev.target.closest && ev.target.closest('.pf-onglet');

    if(!o || (ev.key !== 'ArrowRight' && ev.key !== 'ArrowLeft')) return;

    const cles = ['collection', 'journal', 'aecouter', 'succes'];
    const i = cles.indexOf(o.dataset.onglet);
    const suivant = cles[(i + (ev.key === 'ArrowRight' ? 1 : cles.length - 1)) % cles.length];

    ev.preventDefault();
    onglet(suivant);

    const bouton = document.getElementById('pf-onglet-' + suivant);
    if(bouton) bouton.focus();
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

  window.Profil = { monter, rafraichir, actif, onglet, ouvrirReglages, fermerReglages };

})();
