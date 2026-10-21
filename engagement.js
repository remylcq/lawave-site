/* =====================================================================
   La Wave — l'engagement, côté navigateur

   Le moteur vit dans la base (sql/engagement.sql). Ce fichier lit et dessine :

     le duel de sorties           deux pochettes, un clic, le résultat s'affiche après le vote
     la bande de l'accueil        ma semaine · la saison · la garde-robe
     « Ma semaine »               le résumé du lundi au dimanche, partageable en image
     la saison                    8 paliers de récompenses, des défis, des couleurs qui changent à chaque saison
     la garde-robe                cadres d'avatar, titres, couleurs de pseudo (aucun avantage, que du style)
                                  + le statut de découvreur (les pépites repérées avant tout le monde)
     l'accès équipe               créer / retirer des duels, régler les saisons

   Chargé à la demande (chargerEngagement dans index.html). Si le SQL n'est pas passé, tout se tait.
   ===================================================================== */

(function(){

  'use strict';

  const esc = (t) => escapeHtml(t);
  const nf = (n) => Number(n || 0).toLocaleString('fr-FR');
  const hexa = (c, defaut) => (/^#[0-9a-fA-F]{6}$/.test(c || '') ? c : defaut);
  const etoiles = (note) => (Number(note) / 2).toFixed(1).replace('.', ',').replace(',0', '');
  const jourCourt = (iso) => new Date(String(iso).slice(0, 10) + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });

  const RANGS = { 1: 'Découvreur', 3: 'Dénicheur', 10: 'Visionnaire', 25: 'Prophète' };
  const RARETES = { commun: 'Commun', rare: 'Rare', epique: 'Épique', legendaire: 'Légendaire' };
  const TYPES = { cadre: 'Cadres', titre: 'Titres', couleur: 'Couleurs de pseudo' };

  // ---------------------------------------------------------------------
  // La feuille de style, posée une fois
  // ---------------------------------------------------------------------

  const FEUILLE = `
  .eng-duel, .eng-bande, .eng-voile{--eng-bord:rgba(255,255,255,.10); --eng-fond:rgba(255,255,255,.045);}

  /* ---- Le duel ---- */
  .eng-duel{margin:0 0 14px; padding:16px; border-radius:20px; border:1px solid var(--eng-bord); background:var(--eng-fond);}
  .eng-duel-tete{display:flex; align-items:baseline; justify-content:space-between; gap:12px; margin-bottom:12px;}
  .eng-eyebrow{font-size:11px; letter-spacing:.14em; text-transform:uppercase; color:var(--muted);}
  .eng-reste{font-size:12px; color:var(--muted); font-variant-numeric:tabular-nums;}
  .eng-duel-grille{display:grid; grid-template-columns:1fr auto 1fr; gap:10px; align-items:center;}
  .eng-vs{font-size:11px; font-weight:700; letter-spacing:.12em; color:var(--muted);}
  .eng-cote{
    all:unset; box-sizing:border-box; display:block; min-width:0; cursor:pointer; text-align:left; border-radius:14px;
    transition:transform .25s var(--ease, ease);
  }
  .eng-cote:focus-visible{outline:2px solid var(--blue-bright); outline-offset:3px;}
  .eng-cote[disabled]{cursor:default;}
  .eng-duel:not(.vote) .eng-cote:hover{transform:translateY(-2px);}
  .eng-pochette{position:relative; display:block; aspect-ratio:1; border-radius:12px; overflow:hidden; background:#10151c;}
  .eng-pochette img{width:100%; height:100%; object-fit:cover; display:block; transition:filter .3s, transform .5s var(--ease, ease);}
  .eng-duel.vote .eng-cote:not(.choisi) img{filter:saturate(.45) brightness(.62);}
  .eng-cote.choisi .eng-pochette{box-shadow:0 0 0 2px var(--blue-bright);}
  .eng-pourcent{
    position:absolute; left:0; right:0; bottom:0; padding:22px 10px 8px; font-size:22px; font-weight:700; color:#fff;
    background:linear-gradient(transparent, rgba(0,0,0,.72)); font-variant-numeric:tabular-nums; opacity:0; transition:opacity .35s;
  }
  .eng-duel.vote .eng-pourcent, .eng-duel.fini .eng-pourcent{opacity:1;}
  .eng-cote b{display:block; margin-top:8px; font-size:13px; color:var(--ink); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
  .eng-cote small{display:block; font-size:12px; color:var(--muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
  .eng-duel-pied{display:flex; justify-content:space-between; gap:10px; margin-top:12px; font-size:12px; color:var(--muted);}
  .eng-duel-pied a{color:var(--ink-soft); text-decoration:underline; text-underline-offset:3px; cursor:pointer;}
  .eng-erreur{margin:10px 0 0; font-size:12px; color:var(--danger);}

  /* ---- La bande : semaine · saison · garde-robe ---- */
  .eng-bande{display:grid; grid-template-columns:repeat(3, 1fr); gap:8px; margin:0 0 14px;}
  .eng-puce{
    all:unset; box-sizing:border-box; cursor:pointer; padding:11px 12px; border-radius:14px; border:1px solid var(--eng-bord);
    background:var(--eng-fond); min-width:0; transition:background .2s, transform .2s var(--ease, ease);
  }
  .eng-puce:hover{background:rgba(255,255,255,.08); transform:translateY(-1px);}
  .eng-puce:focus-visible{outline:2px solid var(--blue-bright); outline-offset:2px;}
  .eng-puce b{display:block; font-size:13px; color:var(--ink); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
  .eng-puce small{display:block; margin-top:2px; font-size:11px; color:var(--muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
  .eng-puce .eng-fil{display:block; height:3px; margin-top:8px; border-radius:99px; background:rgba(255,255,255,.1); overflow:hidden;}
  .eng-puce .eng-fil i{display:block; height:100%; border-radius:99px; background:linear-gradient(90deg, var(--s1, #4FB4FF), var(--s2, #ffc46b));}

  /* ---- La feuille (fenêtre) ---- */
  .eng-voile{
    position:fixed; inset:0; z-index:400; display:flex; align-items:flex-end; justify-content:center;
    background:rgba(3,5,8,.7); backdrop-filter:blur(10px); -webkit-backdrop-filter:blur(10px);
    animation:engVoile .25s ease both;
  }
  @media (min-width:700px){ .eng-voile{align-items:center;} }
  .eng-feuille{
    position:relative; width:min(560px, 100%); max-height:92vh; overflow-y:auto; overflow-x:hidden; scrollbar-width:thin;
    border-radius:24px 24px 0 0; border:1px solid var(--line-strong); background:#0b0f15; color:var(--ink);
    animation:engMonte .35s var(--ease, ease) both;
  }
  @media (min-width:700px){ .eng-feuille{border-radius:24px;} }
  .eng-feuille-tete{
    position:sticky; top:0; z-index:3; display:flex; align-items:center; justify-content:space-between; gap:10px;
    padding:16px 18px 12px; background:linear-gradient(#0b0f15 70%, transparent);
  }
  .eng-feuille-tete h2{margin:0; font-size:17px; font-weight:600;}
  .eng-fermer{
    all:unset; box-sizing:border-box; width:34px; height:34px; display:grid; place-items:center; cursor:pointer;
    border-radius:50%; background:rgba(255,255,255,.08); color:var(--ink); font-size:18px; line-height:1;
  }
  .eng-fermer:hover{background:rgba(255,255,255,.16);}
  .eng-fermer:focus-visible{outline:2px solid var(--blue-bright);}
  .eng-corps{padding:4px 18px 22px;}
  .eng-onglets{display:flex; gap:6px; margin-bottom:14px;}
  .eng-onglet{
    all:unset; box-sizing:border-box; cursor:pointer; padding:7px 13px; border-radius:99px; font-size:13px; color:var(--muted);
    border:1px solid var(--eng-bord);
  }
  .eng-onglet[aria-selected="true"]{color:var(--ink); background:rgba(255,255,255,.1); border-color:var(--line-strong);}
  .eng-vide{padding:30px 10px; text-align:center; color:var(--muted); font-size:14px; line-height:1.5;}
  .eng-note{margin:12px 0 0; font-size:12px; color:var(--muted); line-height:1.5;}
  .eng-btn{
    all:unset; box-sizing:border-box; cursor:pointer; display:inline-flex; align-items:center; justify-content:center; gap:8px;
    padding:11px 18px; border-radius:99px; font-size:14px; font-weight:600; color:#06101a; background:var(--ink);
  }
  .eng-btn:hover{filter:brightness(.92);}
  .eng-btn:focus-visible{outline:2px solid var(--blue-bright); outline-offset:2px;}
  .eng-btn.discret{color:var(--ink); background:rgba(255,255,255,.09);}
  .eng-btn[disabled]{opacity:.5; cursor:default;}

  /* ---- Ma semaine ---- */
  .eng-semaine-haut{
    padding:20px 18px; border-radius:20px; margin-bottom:12px;
    background:radial-gradient(120% 140% at 0% 0%, rgba(79,180,255,.28), transparent 60%), radial-gradient(120% 140% at 100% 100%, rgba(255,196,107,.2), transparent 60%), rgba(255,255,255,.04);
    border:1px solid var(--eng-bord);
  }
  .eng-semaine-haut .dates{font-size:12px; color:var(--muted);}
  .eng-semaine-haut .profil{margin:6px 0 0; font-size:15px; color:var(--ink-soft);}
  .eng-gros{margin:10px 0 0; font-size:44px; font-weight:700; line-height:1; font-variant-numeric:tabular-nums;}
  .eng-gros small{font-size:15px; font-weight:500; color:var(--muted); margin-left:6px;}
  .eng-delta{margin:8px 0 0; font-size:12px; color:var(--ink-soft);}
  .eng-tuiles{display:grid; grid-template-columns:repeat(3, 1fr); gap:8px; margin-bottom:12px;}
  .eng-tuile{padding:12px 10px; border-radius:14px; background:var(--eng-fond); border:1px solid var(--eng-bord); text-align:center;}
  .eng-tuile b{display:block; font-size:22px; font-variant-numeric:tabular-nums;}
  .eng-tuile span{display:block; margin-top:2px; font-size:11px; color:var(--muted);}
  .eng-ligne-sortie{display:flex; align-items:center; gap:12px; padding:10px; border-radius:14px; background:var(--eng-fond); border:1px solid var(--eng-bord); margin-bottom:8px;}
  .eng-ligne-sortie img{width:54px; height:54px; border-radius:9px; object-fit:cover; flex:none;}
  .eng-ligne-sortie .tx{min-width:0; flex:1;}
  .eng-ligne-sortie .tx small{display:block; font-size:11px; color:var(--muted); letter-spacing:.06em; text-transform:uppercase;}
  .eng-ligne-sortie .tx b{display:block; font-size:14px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
  .eng-ligne-sortie .tx span{display:block; font-size:12px; color:var(--muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
  .eng-ligne-sortie .note{font-size:15px; font-weight:600; white-space:nowrap;}
  .eng-succes{display:flex; flex-wrap:wrap; gap:6px; margin:6px 0 0;}
  .eng-succes span{padding:5px 10px; border-radius:99px; font-size:12px; background:rgba(255,255,255,.07); border:1px solid var(--eng-bord);}
  .eng-partage{display:flex; gap:8px; flex-wrap:wrap; margin-top:16px;}

  /* ---- La saison ---- */
  .eng-saison-haut{
    padding:20px 18px; border-radius:20px; margin-bottom:14px; border:1px solid var(--eng-bord);
    background:linear-gradient(135deg, color-mix(in srgb, var(--s1) 30%, transparent), color-mix(in srgb, var(--s3) 22%, transparent)), rgba(255,255,255,.03);
  }
  .eng-saison-haut .theme{font-size:12px; letter-spacing:.14em; text-transform:uppercase; color:var(--ink-soft);}
  .eng-saison-haut h3{margin:4px 0 0; font-size:22px;}
  .eng-saison-haut .reste{margin:4px 0 0; font-size:12px; color:var(--ink-soft);}
  .eng-barre{height:6px; margin-top:14px; border-radius:99px; background:rgba(255,255,255,.14); overflow:hidden;}
  .eng-barre i{display:block; height:100%; border-radius:99px; background:linear-gradient(90deg, var(--s1), var(--s2)); transition:width .8s var(--ease, ease);}
  .eng-saison-pts{display:flex; justify-content:space-between; margin-top:8px; font-size:12px; color:var(--ink-soft); font-variant-numeric:tabular-nums;}
  .eng-titre-bloc{margin:18px 0 8px; font-size:11px; letter-spacing:.14em; text-transform:uppercase; color:var(--muted);}
  .eng-palier{display:flex; align-items:center; gap:12px; padding:10px 12px; border-radius:14px; border:1px solid var(--eng-bord); background:var(--eng-fond); margin-bottom:6px;}
  .eng-palier.atteint{border-color:color-mix(in srgb, var(--s2) 55%, transparent);}
  .eng-palier.prochain{border-color:var(--line-strong); background:rgba(255,255,255,.08);}
  .eng-palier .num{width:26px; height:26px; flex:none; border-radius:50%; display:grid; place-items:center; font-size:12px; font-weight:700; background:rgba(255,255,255,.08);}
  .eng-palier.atteint .num{background:var(--s2); color:#06101a;}
  .eng-palier .tx{flex:1; min-width:0;}
  .eng-palier .tx b{display:block; font-size:13px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
  .eng-palier .tx small{display:block; font-size:11px; color:var(--muted);}
  .eng-defi{padding:10px 12px; border-radius:14px; border:1px solid var(--eng-bord); background:var(--eng-fond); margin-bottom:6px;}
  .eng-defi .l{display:flex; justify-content:space-between; gap:10px; font-size:13px;}
  .eng-defi .l span{color:var(--muted); font-variant-numeric:tabular-nums; white-space:nowrap;}
  .eng-defi.fait .l{color:var(--muted);}
  .eng-defi .eng-barre{height:4px; margin-top:8px; background:rgba(255,255,255,.1);}

  /* ---- Aperçus de cosmétiques ---- */
  .eng-av{
    position:relative; isolation:isolate; flex:none; width:var(--t, 44px); height:var(--t, 44px); border-radius:50%; display:grid; place-items:center;
    font-weight:700; color:#fff; background:linear-gradient(145deg, hsl(var(--h, 210) 58% 40%), hsl(calc(var(--h, 210) + 46) 62% 26%));
    box-shadow:0 0 0 2px #0b0f15;
  }
  .eng-av img{width:100%; height:100%; border-radius:50%; object-fit:cover; display:block;}
  .eng-av.cadre::before{
    content:''; position:absolute; inset:-5px; border-radius:50%; z-index:-1;
    background:linear-gradient(135deg, var(--ca), var(--cb));
  }
  .eng-av.cadre.tourne::before{background:conic-gradient(var(--ca), var(--cb), var(--cc, var(--ca)), var(--ca)); animation:engTourne 6s linear infinite;}
  .eng-av.cadre.pulse::before{animation:engPulse 2.6s ease-in-out infinite;}
  .eng-nom-couleur{background:linear-gradient(90deg, var(--na), var(--nb)); -webkit-background-clip:text; background-clip:text; color:transparent;}
  .eng-titre-pastille{display:inline-block; padding:3px 9px; border-radius:99px; font-size:11px; background:rgba(255,255,255,.09); border:1px solid var(--eng-bord); color:var(--ink-soft);}
  .eng-ap{display:flex; align-items:center; gap:14px; padding:14px; border-radius:18px; border:1px solid var(--eng-bord); background:var(--eng-fond); margin-bottom:12px;}
  .eng-ap .nom{font-size:16px; font-weight:600;}
  .eng-ap .nom + .eng-titre-pastille{margin-top:6px;}

  /* ---- La garde-robe ---- */
  .eng-grille{display:grid; grid-template-columns:repeat(auto-fill, minmax(150px, 1fr)); gap:8px;}
  .eng-objet{
    all:unset; box-sizing:border-box; cursor:pointer; padding:12px; border-radius:14px; border:1px solid var(--eng-bord); background:var(--eng-fond);
    display:flex; flex-direction:column; align-items:flex-start; gap:8px; min-width:0; transition:background .2s;
  }
  .eng-objet:hover{background:rgba(255,255,255,.08);}
  .eng-objet:focus-visible{outline:2px solid var(--blue-bright); outline-offset:2px;}
  .eng-objet.equipe{border-color:var(--blue-bright); background:rgba(79,180,255,.1);}
  .eng-objet.verrouille{opacity:.55;}
  .eng-objet .apercu{height:44px; display:flex; align-items:center; font-size:15px; font-weight:600; max-width:100%;}
  .eng-objet b{font-size:13px; max-width:100%; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
  .eng-objet small{font-size:11px; color:var(--muted); line-height:1.35;}
  .eng-rar-rare b{color:#7cc4ff;} .eng-rar-epique b{color:#c79bff;} .eng-rar-legendaire b{color:#ffc46b;}
  .eng-decouvreur{padding:14px; border-radius:18px; border:1px solid var(--eng-bord); background:var(--eng-fond); margin:14px 0;}
  .eng-decouvreur .rang{display:flex; align-items:baseline; justify-content:space-between; gap:10px;}
  .eng-decouvreur .rang b{font-size:16px;}
  .eng-decouvreur .rang span{font-size:12px; color:var(--muted);}
  .eng-pepites{display:flex; gap:6px; margin-top:10px; overflow-x:auto; scrollbar-width:thin;}
  .eng-pepites button{all:unset; cursor:pointer; flex:none; width:56px; height:56px; border-radius:9px; overflow:hidden; background:#10151c;}
  .eng-pepites img{width:100%; height:100%; object-fit:cover;}

  /* ---- L'accès équipe ---- */
  .eng-eq{display:grid; gap:22px;}
  .eng-eq h4{margin:0 0 8px; font-size:15px;}
  .eng-eq .carte{padding:14px; border-radius:16px; border:1px solid var(--eng-bord); background:var(--eng-fond);}
  .eng-eq .ligne{display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin:6px 0;}
  .eng-eq input[type=text], .eng-eq input[type=date], .eng-eq select{
    box-sizing:border-box; padding:9px 11px; border-radius:10px; border:1px solid var(--line-strong); background:rgba(255,255,255,.06);
    color:var(--ink); font:inherit; font-size:14px; min-width:0;
  }
  .eng-eq input[type=color]{width:38px; height:34px; padding:2px; border-radius:8px; border:1px solid var(--line-strong); background:transparent;}
  .eng-eq .resultat{display:flex; align-items:center; gap:10px; padding:6px 0; border-top:1px solid var(--line);}
  .eng-eq .resultat img{width:38px; height:38px; border-radius:7px; object-fit:cover;}
  .eng-eq .resultat .tx{flex:1; min-width:0; font-size:13px;}
  .eng-eq .resultat .tx span{display:block; font-size:12px; color:var(--muted);}
  .eng-eq .duel-ligne{display:flex; align-items:center; gap:10px; padding:8px 0; border-top:1px solid var(--line); font-size:13px;}
  .eng-eq .duel-ligne:first-of-type{border-top:0;}
  .eng-eq .duel-ligne .tx{flex:1; min-width:0;}
  .eng-eq .duel-ligne .tx span{display:block; font-size:12px; color:var(--muted);}
  .eng-eq .msg{font-size:13px; margin:8px 0 0;} .eng-eq .msg.err{color:var(--danger);} .eng-eq .msg.ok{color:#7be0a4;}

  @keyframes engVoile{from{opacity:0;} to{opacity:1;}}
  @keyframes engMonte{from{opacity:0; transform:translateY(24px);} to{opacity:1; transform:none;}}
  @keyframes engTourne{to{transform:rotate(360deg);}}
  @keyframes engPulse{0%,100%{opacity:.75; filter:blur(0);} 50%{opacity:1; filter:blur(1.5px);}}
  @media (prefers-reduced-motion:reduce){
    .eng-voile, .eng-feuille, .eng-av.cadre::before{animation:none !important;}
    .eng-barre i, .eng-puce, .eng-cote{transition:none;}
  }
  @media (max-width:420px){
    .eng-bande{grid-template-columns:1fr; }
    .eng-tuiles{grid-template-columns:repeat(2, 1fr);}
  }`;

  function poserFeuille(){
    if(document.getElementById('eng-feuille')) return;
    const s = document.createElement('style');
    s.id = 'eng-feuille';
    s.textContent = FEUILLE;
    document.head.appendChild(s);
  }

  // ---------------------------------------------------------------------
  // Des morceaux réutilisés
  // ---------------------------------------------------------------------

  function teinte(texte){
    let h = 0;
    const t = String(texte || '?');
    for(let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) % 360;
    return h;
  }

  // Un avatar (photo ou initiale) avec, si on en donne un, un cadre.
  function avatarApercu(pseudo, photo, cadre, taille){

    const c = cadre && typeof cadre === 'object' ? cadre : null;
    const anim = c && (c.anim === 'tourne' || c.anim === 'pulse') ? ' ' + c.anim : '';
    const vars = c
      ? `--ca:${hexa(c.a, '#ffffff')};--cb:${hexa(c.b, '#ffffff')};--cc:${hexa(c.c || c.a, '#ffffff')};`
      : '';
    const p = safeUrl(photo);

    return `<span class="eng-av${c ? ' cadre' + anim : ''}" style="--t:${taille || 44}px;--h:${teinte(pseudo)};${vars}">${
      p ? `<img src="${esc(p)}" alt="" loading="lazy">` : `<b>${esc(String(pseudo || '?').trim().charAt(0).toUpperCase())}</b>`
    }</span>`;
  }

  function nomApercu(pseudo, couleur){
    if(couleur && typeof couleur === 'object'){
      return `<span class="eng-nom-couleur" style="--na:${hexa(couleur.a, '#ffffff')};--nb:${hexa(couleur.b, '#ffffff')}">${esc(pseudo)}</span>`;
    }
    return esc(pseudo);
  }

  // Ce que montre un cosmétique dans la garde-robe, selon son type.
  function objetApercu(o){
    if(o.type === 'cadre') return avatarApercu(currentUser ? currentUser.pseudo : '?', currentUser ? currentUser.avatar : '', o.style, 40);
    if(o.type === 'couleur') return `<span class="eng-nom-couleur" style="--na:${hexa(o.style.a, '#fff')};--nb:${hexa(o.style.b, '#fff')}">${esc(currentUser ? currentUser.pseudo : 'Pseudo')}</span>`;
    return `<span class="eng-titre-pastille">${esc(o.nom)}</span>`;
  }

  function reste(fin){
    const ms = new Date(fin).getTime() - Date.now();
    if(ms <= 0) return 'Terminé';
    const m = Math.floor(ms / 60000);
    if(m < 60) return 'Fin dans ' + Math.max(m, 1) + ' min';
    const h = Math.floor(m / 60);
    if(h < 48) return 'Fin dans ' + h + ' h';
    return 'Fin dans ' + Math.floor(h / 24) + ' j';
  }

  function erreurTexte(e){
    return (e && e.message) ? e.message : 'Une erreur est survenue. Réessaie dans un instant.';
  }

  // ---------------------------------------------------------------------
  // La feuille : une fenêtre qui monte du bas (centrée sur grand écran)
  // ---------------------------------------------------------------------

  let feuilleOuverte = null;

  function ouvrirFeuille(titre){

    poserFeuille();
    if(feuilleOuverte) feuilleOuverte.fermer();

    const voile = document.createElement('div');
    voile.className = 'eng-voile';
    voile.innerHTML = `
      <div class="eng-feuille" role="dialog" aria-modal="true" aria-label="${esc(titre)}">
        <div class="eng-feuille-tete"><h2>${esc(titre)}</h2><button type="button" class="eng-fermer" aria-label="Fermer">×</button></div>
        <div class="eng-corps"></div>
      </div>`;

    const precedent = document.activeElement;
    const avant = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    document.body.appendChild(voile);

    const corps = voile.querySelector('.eng-corps');
    const bouton = voile.querySelector('.eng-fermer');

    function fermer(){
      if(!voile.parentNode) return;
      voile.remove();
      document.documentElement.style.overflow = avant;
      document.removeEventListener('keydown', touche);
      if(feuilleOuverte && feuilleOuverte.voile === voile) feuilleOuverte = null;
      if(precedent && precedent.focus) try{ precedent.focus(); }catch(e){}
    }

    function touche(ev){ if(ev.key === 'Escape') fermer(); }

    bouton.addEventListener('click', fermer);
    voile.addEventListener('click', (ev) => { if(ev.target === voile) fermer(); });
    document.addEventListener('keydown', touche);
    bouton.focus();

    feuilleOuverte = { voile, corps, fermer };
    return feuilleOuverte;
  }

  // ---------------------------------------------------------------------
  // Le duel
  // ---------------------------------------------------------------------

  function coteHtml(duel, cote){

    const s = duel[cote];
    const votes = duel.votes;
    const total = votes ? (votes.a + votes.b) : 0;
    const pc = votes && total ? Math.round(votes[cote] / total * 100) : 0;
    const choisi = duel.mon_vote === cote;
    const aVote = !!duel.mon_vote;
    const fini = !duel.actif;

    return `
      <button type="button" class="eng-cote${choisi ? ' choisi' : ''}" data-choix="${cote}" ${aVote || fini ? 'disabled' : ''}
        aria-label="Voter pour ${esc(s.titre)} de ${esc(s.artiste)}">
        <span class="eng-pochette">
          <img src="${esc(safeUrl(s.cover))}" alt="" loading="lazy">
          <span class="eng-pourcent">${votes ? pc + ' %' : ''}</span>
        </span>
        <b>${esc(s.titre)}</b>
        <small>${esc(s.artiste)}</small>
      </button>`;
  }

  function duelHtml(duel){

    const aVote = !!duel.mon_vote;
    const total = duel.total || 0;

    return `
      <section class="eng-duel${aVote ? ' vote' : ''}${duel.actif ? '' : ' fini'}" data-duel="${esc(duel.id)}">
        <div class="eng-duel-tete">
          <span class="eng-eyebrow">${esc(duel.titre || 'Duel de sorties')}</span>
          <span class="eng-reste">${esc(reste(duel.fin))}</span>
        </div>
        <div class="eng-duel-grille">
          ${coteHtml(duel, 'a')}
          <span class="eng-vs" aria-hidden="true">VS</span>
          ${coteHtml(duel, 'b')}
        </div>
        <div class="eng-duel-pied">
          <span>${aVote || !duel.actif
            ? nf(total) + ' vote' + (total > 1 ? 's' : '')
            : (total ? nf(total) + ' vote' + (total > 1 ? 's' : '') + ' · ' : '') + 'Vote pour ta préférée'}</span>
          <span><a data-fiche="${esc(duel.a.numero)}">Fiche A</a> · <a data-fiche="${esc(duel.b.numero)}">Fiche B</a></span>
        </div>
        <p class="eng-erreur" data-erreur hidden></p>
      </section>`;
  }

  // Branche un duel déjà dessiné : le vote, les fiches.
  function brancherDuel(hote, duel, apres){

    const racine = hote.querySelector('[data-duel="' + duel.id + '"]');
    if(!racine) return;

    racine.addEventListener('click', async (ev) => {

      const fiche = ev.target.closest('[data-fiche]');
      if(fiche){
        if(feuilleOuverte) feuilleOuverte.fermer();
        if(typeof ouvrirSortieParNumero === 'function') ouvrirSortieParNumero(fiche.dataset.fiche);
        return;
      }

      const cote = ev.target.closest('[data-choix]');
      if(!cote || cote.disabled) return;

      racine.querySelectorAll('[data-choix]').forEach(b => { b.disabled = true; });
      const msg = racine.querySelector('[data-erreur]');
      msg.hidden = true;

      const { data, error } = await BD.duelVoter(duel.id, cote.dataset.choix);

      if(error || !data){
        msg.textContent = erreurTexte(error);
        msg.hidden = false;
        racine.querySelectorAll('[data-choix]').forEach(b => { b.disabled = false; });
        return;
      }

      Object.assign(duel, data);
      racine.outerHTML = duelHtml(duel);
      brancherDuel(hote, duel, apres);

      if(window.Xp && window.Xp.apres) window.Xp.apres(500);
      if(apres) apres(duel);
    });
  }

  // ---------------------------------------------------------------------
  // L'accueil de la communauté : le duel et la bande
  // ---------------------------------------------------------------------

  async function accueil(hote){

    if(!hote || !currentUser) return;
    poserFeuille();

    let duels = [];
    let saison = null;

    try{
      const [d, s] = await Promise.all([BD.duelsListe(), BD.saisonEtat()]);
      duels = d && Array.isArray(d.data) ? d.data : [];
      saison = s && !s.error ? s.data : null;
    }catch(e){
      hote.innerHTML = '';
      return;
    }

    const actif = duels.find(d => d.actif);
    let html = '';

    if(actif) html += duelHtml(actif);

    let puceSaison = '';
    if(saison && !saison.a_venir){
      const prochain = saison.prochain;
      const total = (saison.paliers && saison.paliers.length) ? saison.paliers[saison.paliers.length - 1].points : 1;
      const pct = Math.min(100, Math.round((saison.points || 0) / total * 100));
      const c = saison.couleurs || [];
      puceSaison = `
        <button type="button" class="eng-puce" data-eng="saison" style="--s1:${hexa(c[0], '#4FB4FF')};--s2:${hexa(c[1], '#ffc46b')}">
          <b>${esc(saison.nom)}</b>
          <small>${saison.terminee ? 'Terminée · palier ' + saison.palier + '/8' : 'Palier ' + saison.palier + '/8' + (prochain ? ' · ' + nf(prochain.points - saison.points) + ' pts' : '')}</small>
          <span class="eng-fil"><i style="width:${pct}%"></i></span>
        </button>`;
    }else{
      puceSaison = `<button type="button" class="eng-puce" data-eng="saison"><b>Saison</b><small>${saison && saison.a_venir ? 'Début le ' + esc(jourCourt(saison.debut)) : 'Bientôt'}</small></button>`;
    }

    html += `
      <div class="eng-bande">
        <button type="button" class="eng-puce" data-eng="semaine"><b>Ma semaine</b><small>Ton résumé du lundi au dimanche</small></button>
        ${puceSaison}
        <button type="button" class="eng-puce" data-eng="garderobe"><b>Garde-robe</b><small>Cadres, titres, couleurs</small></button>
      </div>`;

    hote.innerHTML = html;

    if(actif) brancherDuel(hote, actif);

    hote.querySelectorAll('[data-eng]').forEach((b) => {
      b.addEventListener('click', () => ouvrir(b.dataset.eng));
    });
  }

  function ouvrir(quoi, option){
    if(quoi === 'semaine') return semaine(option === undefined ? 1 : option);
    if(quoi === 'saison') return saison();
    if(quoi === 'garderobe') return garderobe();
    if(quoi === 'duel') return duel(option);
  }

  // Un duel dans sa propre fenêtre (depuis une notification).
  async function duel(id){

    const f = ouvrirFeuille('Duel de sorties');
    f.corps.innerHTML = '<div class="eng-vide">Chargement…</div>';

    const { data, error } = await BD.duelsListe();
    if(error){ f.corps.innerHTML = `<div class="eng-vide">${esc(erreurTexte(error))}</div>`; return; }

    const liste = Array.isArray(data) ? data : [];
    const d = liste.find(x => x.id === id) || liste[0];

    if(!d){ f.corps.innerHTML = '<div class="eng-vide">Aucun duel pour le moment.</div>'; return; }

    f.corps.innerHTML = duelHtml(d) + (d.actif ? '' : '<p class="eng-note">Ce duel est terminé.</p>');
    brancherDuel(f.corps, d);
  }

  // ---------------------------------------------------------------------
  // Ma semaine
  // ---------------------------------------------------------------------

  function profilSemaine(r){

    const n = (r.notes && r.notes.nombre) || 0;
    const score = {
      'Semaine d\'exploration': (r.decouvertes || 0) + (r.ecoutes || 0),
      'Semaine de critique': n + (r.avis || 0) * 2,
      'Semaine de communauté': (r.posts || 0) * 2 + (r.commentaires || 0) + (r.reactions_recues || 0),
      'Semaine d\'assiduité': (r.jours_actifs || 0) * 2,
      'Semaine dans l\'arène': (r.duels || 0) * 2
    };

    let meilleur = 'Semaine tranquille';
    let max = 0;
    Object.keys(score).forEach((k) => { if(score[k] > max){ max = score[k]; meilleur = k; } });
    return meilleur;
  }

  function semaineHtml(r){

    if(!r || !r.actif){
      return `<div class="eng-vide">Rien à raconter ${r && r.en_cours ? 'pour l\'instant' : 'cette semaine-là'}.<br>Note une sortie, vote à un duel ou écoute un nouveau projet : ta semaine se remplit toute seule.</div>`;
    }

    const notes = r.notes || {};
    const delta = r.xp_avant > 0 ? Math.round((r.xp - r.xp_avant) / r.xp_avant * 100) : null;
    const ecart = notes.ecart_communaute;

    const tuiles = [
      [notes.nombre || 0, 'Notes'], [r.ecoutes || 0, 'Écoutes'], [r.avis || 0, 'Avis'],
      [r.decouvertes || 0, 'Découvertes'], [r.duels || 0, 'Duels votés'], [(r.jours_actifs || 0) + '/7', 'Jours actifs']
    ].map(t => `<div class="eng-tuile"><b>${esc(t[0])}</b><span>${esc(t[1])}</span></div>`).join('');

    let top = '';
    if(notes.top){
      top = `
        <div class="eng-titre-bloc">Ta meilleure note</div>
        <div class="eng-ligne-sortie">
          <img src="${esc(safeUrl(notes.top.cover))}" alt="">
          <div class="tx"><b>${esc(notes.top.titre)}</b><span>${esc(notes.top.artiste)}</span></div>
          <span class="note">${esc(etoiles(notes.top.note))} ★</span>
        </div>`;
    }

    const faits = [];
    if(r.artiste && r.artiste.nom) faits.push(`Ton artiste de la semaine : <b>${esc(r.artiste.nom)}</b>`);
    if(notes.moyenne) faits.push(`Moyenne de tes notes : <b>${esc(etoiles(notes.moyenne))} ★</b>`);
    if(ecart !== null && ecart !== undefined){
      const e = Math.abs(ecart) / 2;
      faits.push(Math.abs(ecart) < 0.8 ? 'Tes notes collent à celles de la communauté.'
        : `Tu notes en moyenne <b>${esc(String(e.toFixed(1)).replace('.', ','))} ★</b> ${ecart > 0 ? 'au-dessus' : 'en dessous'} de la communauté.`);
    }
    if(r.reactions_recues) faits.push(`<b>${nf(r.reactions_recues)}</b> réaction${r.reactions_recues > 1 ? 's' : ''} reçue${r.reactions_recues > 1 ? 's' : ''}.`);
    if(r.pepites) faits.push(`<b>${nf(r.pepites)}</b> pépite${r.pepites > 1 ? 's' : ''} repérée${r.pepites > 1 ? 's' : ''} avant tout le monde.`);
    if(r.serie > 1) faits.push(`Série en cours : <b>${nf(r.serie)}</b> jours de suite.`);

    const succes = (r.succes || []).length
      ? `<div class="eng-titre-bloc">Succès de la semaine</div><div class="eng-succes">${r.succes.map(s => `<span>${esc(s.icone)} ${esc(s.nom)}</span>`).join('')}</div>`
      : '';

    return `
      <div class="eng-semaine-haut">
        <div class="dates">${esc(jourCourt(r.debut))} – ${esc(jourCourt(r.fin))}${r.en_cours ? ' · en cours' : ''}</div>
        <p class="profil">${esc(profilSemaine(r))}</p>
        <p class="eng-gros">+${nf(r.xp)}<small>XP</small></p>
        ${delta === null ? '' : `<p class="eng-delta">${delta >= 0 ? '↑' : '↓'} ${Math.abs(delta)} % par rapport à la semaine précédente</p>`}
      </div>
      <div class="eng-tuiles">${tuiles}</div>
      ${faits.length ? `<ul class="eng-note" style="padding-left:18px;margin:0 0 12px">${faits.map(f => `<li>${f}</li>`).join('')}</ul>` : ''}
      ${top}${succes}
      <div class="eng-partage"><button type="button" class="eng-btn" data-partager>Partager mon résumé</button></div>
      <p class="eng-note" data-partage-msg hidden></p>`;
  }

  // L'image à partager : 1080 × 1350, les chiffres de la semaine.
  async function imageSemaine(r, avecPochette){

    const L = 1080, H = 1350;
    const toile = document.createElement('canvas');
    toile.width = L; toile.height = H;
    const g = toile.getContext('2d');

    const fond = g.createLinearGradient(0, 0, L, H);
    fond.addColorStop(0, '#0b1a2b'); fond.addColorStop(0.55, '#0b0f15'); fond.addColorStop(1, '#2a1a0e');
    g.fillStyle = fond; g.fillRect(0, 0, L, H);

    const halo = g.createRadialGradient(200, 160, 20, 200, 160, 620);
    halo.addColorStop(0, 'rgba(79,180,255,.40)'); halo.addColorStop(1, 'rgba(79,180,255,0)');
    g.fillStyle = halo; g.fillRect(0, 0, L, H);

    const police = '"Inter","Helvetica Neue",Arial,sans-serif';
    g.textBaseline = 'alphabetic';

    g.fillStyle = 'rgba(255,255,255,.62)'; g.font = `600 30px ${police}`;
    g.fillText('LA WAVE · MA SEMAINE', 80, 120);
    g.font = `400 30px ${police}`;
    g.fillText(`${jourCourt(r.debut)} – ${jourCourt(r.fin)}`, 80, 166);

    g.fillStyle = '#fff'; g.font = `700 150px ${police}`;
    g.fillText('+' + nf(r.xp), 80, 360);
    g.fillStyle = 'rgba(255,255,255,.62)'; g.font = `500 44px ${police}`;
    g.fillText('XP gagnés', 80, 424);

    g.fillStyle = '#fff'; g.font = `600 44px ${police}`;
    g.fillText(profilSemaine(r), 80, 520);

    const notes = r.notes || {};
    const cases = [
      [notes.nombre || 0, 'notes'], [r.ecoutes || 0, 'écoutes'], [r.duels || 0, 'duels'],
      [r.decouvertes || 0, 'découvertes'], [r.avis || 0, 'avis'], [(r.jours_actifs || 0) + '/7', 'jours actifs']
    ];
    cases.forEach((c, i) => {
      const x = 80 + (i % 3) * 300;
      const y = 600 + Math.floor(i / 3) * 170;
      g.fillStyle = 'rgba(255,255,255,.07)';
      g.beginPath(); g.roundRect ? g.roundRect(x, y, 276, 142, 26) : g.rect(x, y, 276, 142); g.fill();
      g.fillStyle = '#fff'; g.font = `700 64px ${police}`; g.fillText(String(c[0]), x + 26, y + 80);
      g.fillStyle = 'rgba(255,255,255,.6)'; g.font = `400 28px ${police}`; g.fillText(c[1], x + 26, y + 120);
    });

    if(notes.top){
      g.fillStyle = 'rgba(255,255,255,.6)'; g.font = `600 26px ${police}`;
      g.fillText('MA MEILLEURE NOTE', 80, 990);

      if(avecPochette && notes.top.cover){
        try{
          const img = await new Promise((ok, ko) => {
            const i = new Image();
            i.crossOrigin = 'anonymous';
            i.onload = () => ok(i); i.onerror = ko;
            i.src = notes.top.cover;
          });
          g.save(); g.beginPath(); g.roundRect ? g.roundRect(80, 1020, 190, 190, 22) : g.rect(80, 1020, 190, 190); g.clip();
          g.drawImage(img, 80, 1020, 190, 190); g.restore();
        }catch(e){
          throw e;
        }
      }

      const x = avecPochette && notes.top.cover ? 300 : 80;
      g.fillStyle = '#fff'; g.font = `700 46px ${police}`;
      g.fillText(String(notes.top.titre).slice(0, 26), x, 1090);
      g.fillStyle = 'rgba(255,255,255,.62)'; g.font = `400 34px ${police}`;
      g.fillText(String(notes.top.artiste).slice(0, 30), x, 1142);
      g.fillStyle = '#ffc46b'; g.font = `700 44px ${police}`;
      g.fillText(etoiles(notes.top.note) + ' ★', x, 1200);
    }

    g.fillStyle = 'rgba(255,255,255,.45)'; g.font = `400 28px ${police}`;
    g.fillText('lawave.fr', 80, 1290);

    return new Promise((ok, ko) => {
      try{ toile.toBlob((b) => (b ? ok(b) : ko(new Error('image'))), 'image/png'); }catch(e){ ko(e); }
    });
  }

  async function partager(r, msg){

    msg.hidden = false;
    msg.textContent = 'Préparation de l\'image…';

    let blob;
    try{
      blob = await imageSemaine(r, true);
    }catch(e){
      try{ blob = await imageSemaine(r, false); }catch(e2){ msg.textContent = 'Impossible de créer l\'image sur cet appareil.'; return; }
    }

    const fichier = new File([blob], 'ma-semaine-la-wave.png', { type: 'image/png' });

    try{
      if(navigator.canShare && navigator.canShare({ files: [fichier] })){
        await navigator.share({ files: [fichier], title: 'Ma semaine sur La Wave' });
        msg.textContent = 'Partagé.';
        return;
      }
    }catch(e){
      if(e && e.name === 'AbortError'){ msg.hidden = true; return; }
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'ma-semaine-la-wave.png';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    msg.textContent = 'Image enregistrée : tu peux la publier où tu veux.';
  }

  async function semaine(decalage){

    const f = ouvrirFeuille('Ma semaine');
    let courant = decalage === 0 ? 0 : 1;

    f.corps.innerHTML = `
      <div class="eng-onglets" role="tablist">
        <button type="button" class="eng-onglet" role="tab" data-dec="1">Semaine dernière</button>
        <button type="button" class="eng-onglet" role="tab" data-dec="0">Cette semaine</button>
      </div>
      <div data-contenu></div>`;

    const contenu = f.corps.querySelector('[data-contenu]');
    const onglets = f.corps.querySelectorAll('[data-dec]');

    async function charger(dec){

      courant = dec;
      onglets.forEach(o => o.setAttribute('aria-selected', String(Number(o.dataset.dec) === dec)));
      contenu.innerHTML = '<div class="eng-vide">Chargement…</div>';

      const { data, error } = await BD.resumeSemaine(dec);

      if(error){ contenu.innerHTML = `<div class="eng-vide">${esc(erreurTexte(error))}</div>`; return; }

      contenu.innerHTML = semaineHtml(data);

      const bouton = contenu.querySelector('[data-partager]');
      if(bouton) bouton.addEventListener('click', () => partager(data, contenu.querySelector('[data-partage-msg]')));
    }

    onglets.forEach(o => o.addEventListener('click', () => charger(Number(o.dataset.dec))));
    charger(courant);
  }

  // ---------------------------------------------------------------------
  // La saison
  // ---------------------------------------------------------------------

  function recompenseHtml(c){
    if(c.type === 'cadre') return avatarApercu(currentUser ? currentUser.pseudo : '?', currentUser ? currentUser.avatar : '', c.style, 30);
    if(c.type === 'couleur') return `<span class="eng-nom-couleur" style="--na:${hexa(c.style.a, '#fff')};--nb:${hexa(c.style.b, '#fff')};font-weight:600">Pseudo</span>`;
    return `<span class="eng-titre-pastille">${esc(c.nom)}</span>`;
  }

  async function saison(){

    const f = ouvrirFeuille('Saison');
    f.corps.innerHTML = '<div class="eng-vide">Chargement…</div>';

    const { data: s, error } = await BD.saisonEtat();

    if(error){ f.corps.innerHTML = `<div class="eng-vide">${esc(erreurTexte(error))}</div>`; return; }

    if(!s || s.a_venir){
      f.corps.innerHTML = `<div class="eng-vide">${s && s.a_venir
        ? `La ${esc(s.nom)} (${esc(s.theme)}) commence le ${esc(jourCourt(s.debut))}.<br>De nouveaux cadres, titres et couleurs t'y attendent.`
        : 'Pas de saison pour le moment. La prochaine arrive bientôt.'}</div>`;
      return;
    }

    const c = s.couleurs || [];
    const total = s.paliers.length ? s.paliers[s.paliers.length - 1].points : 1;
    const pct = Math.min(100, Math.round(s.points / total * 100));
    const prochainPalier = s.prochain ? s.prochain.palier : null;

    f.corps.innerHTML = `
      <div style="--s1:${hexa(c[0], '#4FB4FF')};--s2:${hexa(c[1], '#ffc46b')};--s3:${hexa(c[2], '#7b5cff')}">
        <div class="eng-saison-haut">
          <div class="theme">${esc(s.theme)}</div>
          <h3>${esc(s.nom)}</h3>
          <p class="reste">${s.terminee ? 'Saison terminée' : (s.jours_restants === 0 ? 'Dernier jour' : s.jours_restants + ' jour' + (s.jours_restants > 1 ? 's' : '') + ' restant' + (s.jours_restants > 1 ? 's' : ''))}
            · du ${esc(jourCourt(s.debut))} au ${esc(jourCourt(s.fin))}</p>
          <div class="eng-barre"><i style="width:${pct}%"></i></div>
          <div class="eng-saison-pts"><span>${nf(s.points)} points</span><span>${s.prochain ? 'Prochain palier : ' + nf(s.prochain.points) : 'Tous les paliers atteints'}</span></div>
        </div>

        <div class="eng-titre-bloc">Récompenses</div>
        ${s.paliers.map(p => `
          <div class="eng-palier${p.atteint ? ' atteint' : ''}${p.palier === prochainPalier ? ' prochain' : ''}">
            <span class="num">${p.atteint ? '✓' : p.palier}</span>
            <div class="tx"><b>${esc(p.cosmetique.nom)}</b><small>${nf(p.points)} points · ${esc(({ cadre: 'Cadre', titre: 'Titre', couleur: 'Couleur de pseudo' })[p.cosmetique.type] || '')}</small></div>
            ${recompenseHtml(p.cosmetique)}
          </div>`).join('')}

        <div class="eng-titre-bloc">Défis de la saison</div>
        ${s.defis.map(d => `
          <div class="eng-defi${d.fait ? ' fait' : ''}">
            <div class="l"><b style="font-weight:500">${d.fait ? '✓ ' : ''}${esc(d.libelle)}</b><span>${d.fait ? '+' + d.points + ' pts' : d.progres + '/' + d.objectif + ' · +' + d.points + ' pts'}</span></div>
            <div class="eng-barre"><i style="width:${Math.round(d.progres / d.objectif * 100)}%"></i></div>
          </div>`).join('')}

        <p class="eng-note">Tes points = l'XP gagné pendant la saison + les défis accomplis. Les récompenses de saison ne se gagnent qu'à ce moment-là : après, elles restent un souvenir de ceux qui y étaient. Aucun avantage, seulement du style.</p>
      </div>`;
  }

  // ---------------------------------------------------------------------
  // La garde-robe (et le statut de découvreur)
  // ---------------------------------------------------------------------

  async function garderobe(){

    const f = ouvrirFeuille('Garde-robe');
    f.corps.innerHTML = '<div class="eng-vide">Chargement…</div>';

    const [r, d] = await Promise.all([BD.cosmetiquesMoi(), BD.decouvreurFiche(null)]);

    if(r.error || !r.data){ f.corps.innerHTML = `<div class="eng-vide">${esc(erreurTexte(r.error))}</div>`; return; }

    const catalogue = r.data.catalogue || [];
    const equipe = r.data.equipe || {};
    const fiche = d && !d.error ? d.data : null;
    let message = '';

    function dessiner(){

      const parId = {};
      catalogue.forEach(o => { parId[o.id] = o; });

      const cadre = parId[equipe.cadre];
      const titre = parId[equipe.titre];
      const couleur = parId[equipe.couleur];
      const pseudo = currentUser ? currentUser.pseudo : 'Toi';
      const nbObtenus = catalogue.filter(o => o.obtenu).length;

      let html = `
        <div class="eng-ap">
          ${avatarApercu(pseudo, currentUser ? currentUser.avatar : '', cadre ? cadre.style : null, 56)}
          <div>
            <div class="nom">${nomApercu(pseudo, couleur ? couleur.style : null)}</div>
            ${titre ? `<span class="eng-titre-pastille">${esc(titre.nom)}</span>` : ''}
          </div>
        </div>`;

      if(fiche){
        const prochain = fiche.prochain;
        html += `
          <div class="eng-decouvreur">
            <div class="rang"><b>${fiche.rang ? '💎 ' + esc(fiche.rang) : 'Découvreur'}</b><span>${nf(fiche.nombre)} pépite${fiche.nombre > 1 ? 's' : ''}</span></div>
            <p class="eng-note" style="margin-top:6px">${prochain
              ? `Encore ${nf(prochain - fiche.nombre)} pépite${prochain - fiche.nombre > 1 ? 's' : ''} pour devenir « ${esc(RANGS[prochain])} ».`
              : 'Tu as atteint le plus haut rang.'}
              Une pépite : une sortie que tu as bien notée parmi les premiers, et que la communauté a ensuite confirmée.</p>
            ${fiche.liste && fiche.liste.length ? `<div class="eng-pepites">${fiche.liste.map(s => `<button type="button" data-fiche="${esc(s.numero)}" title="${esc(s.titre)} · ${esc(s.artiste)}"><img src="${esc(safeUrl(s.cover))}" alt="${esc(s.titre)}"></button>`).join('')}</div>` : ''}
          </div>`;
      }

      ['cadre', 'titre', 'couleur'].forEach((type) => {
        const objets = catalogue.filter(o => o.type === type);
        if(!objets.length) return;
        html += `<div class="eng-titre-bloc">${esc(TYPES[type])}</div><div class="eng-grille">${objets.map(o => `
          <button type="button" class="eng-objet eng-rar-${esc(o.rarete)}${equipe[type] === o.id ? ' equipe' : ''}${o.obtenu ? '' : ' verrouille'}"
            data-objet="${esc(o.id)}" aria-pressed="${equipe[type] === o.id}">
            <span class="apercu">${objetApercu(o)}</span>
            <b>${esc(o.nom)}</b>
            <small>${o.obtenu ? (equipe[type] === o.id ? 'Équipé · toucher pour retirer' : esc(RARETES[o.rarete] || '') + ' · toucher pour équiper') : '🔒 ' + esc(o.condition)}</small>
          </button>`).join('')}</div>`;
      });

      html += `<p class="eng-note" aria-live="polite" data-msg>${esc(message) || `${nbObtenus} sur ${catalogue.length} débloqués. Aucun cosmétique ne donne d'avantage : c'est ta marque, rien d'autre.`}</p>`;

      f.corps.innerHTML = html;

      f.corps.querySelectorAll('[data-fiche]').forEach((b) => b.addEventListener('click', () => {
        f.fermer();
        if(typeof ouvrirSortieParNumero === 'function') ouvrirSortieParNumero(b.dataset.fiche);
      }));

      f.corps.querySelectorAll('[data-objet]').forEach((b) => b.addEventListener('click', async () => {

        const o = parId[b.dataset.objet];

        if(!o.obtenu){
          message = 'Verrouillé : ' + o.condition + '.';
          dessiner();
          return;
        }

        const cible = equipe[o.type] === o.id ? null : o.id;
        const { error } = await BD.cosmetiqueEquiper(o.type, cible);

        if(error){ message = erreurTexte(error); dessiner(); return; }

        equipe[o.type] = cible;
        message = cible ? o.nom + ' équipé. Les autres le verront en rechargeant la page.' : o.nom + ' retiré.';
        dessiner();
      }));
    }

    dessiner();
  }

  // ---------------------------------------------------------------------
  // Une notification du système qu'on ouvre
  // ---------------------------------------------------------------------

  function ouvrirNotif(n){

    const d = n.donnees || {};

    if(n.type === 'resume_semaine') return semaine(1);
    if(n.type === 'duel') return duel(d.duel);
    if(n.type === 'saison') return saison();
    if(n.type === 'cosmetique') return garderobe();

    const numero = d.numero || (d.sortie && d.sortie.numero);
    if(numero && typeof ouvrirSortieParNumero === 'function') ouvrirSortieParNumero(numero);
  }

  // ---------------------------------------------------------------------
  // L'accès équipe : duels et saisons
  // ---------------------------------------------------------------------

  const EQ = { el: null, a: null, b: null, resultats: [], duels: [], saisons: [], edition: null, minuteur: null };

  function eqMsg(texte, ok){
    const m = EQ.el && EQ.el.querySelector('[data-eq-msg]');
    if(!m) return;
    m.className = 'msg ' + (ok ? 'ok' : 'err');
    m.textContent = texte || '';
  }

  function eqChoix(cote){
    const s = EQ[cote];
    return s ? `${esc(s.track_title)} — ${esc(s.artist_name)}` : '<span style="color:var(--muted)">à choisir</span>';
  }

  function eqDessiner(){

    if(!EQ.el) return;

    const ed = EQ.edition;
    const hoy = new Date();
    const iso = (d) => d.toISOString().slice(0, 10);
    const dans = (j) => iso(new Date(hoy.getTime() + j * 86400000));

    EQ.el.innerHTML = `
      <div class="eng-eq">
        <section>
          <h4>Duels de sorties</h4>
          <p class="eng-note" style="margin:0 0 10px">Un duel tourne en permanence : s'il n'y en a plus, le site en tire un au hasard parmi les sorties récentes avec pochette. Crée le tien pour choisir les deux sorties.</p>
          <div class="carte">
            <div class="ligne"><b>A</b> <span data-eq-a>${eqChoix('a')}</span></div>
            <div class="ligne"><b>B</b> <span data-eq-b>${eqChoix('b')}</span></div>
            <div class="ligne"><input type="text" data-eq-recherche placeholder="Chercher une sortie ou un artiste…" style="flex:1"></div>
            <div data-eq-resultats></div>
            <div class="ligne">
              <input type="text" data-eq-titre placeholder="Titre (facultatif)" style="flex:1">
              <select data-eq-jours aria-label="Durée du duel">
                <option value="1">1 jour</option><option value="2">2 jours</option><option value="3" selected>3 jours</option>
                <option value="5">5 jours</option><option value="7">7 jours</option><option value="14">14 jours</option>
              </select>
            </div>
            <div class="ligne">
              <button type="button" class="eng-btn" data-eq-creer>Lancer le duel</button>
              <button type="button" class="eng-btn discret" data-eq-hasard>Tirer au sort</button>
            </div>
            <p class="msg" data-eq-msg></p>
          </div>
          <div class="carte" style="margin-top:10px">
            ${EQ.duels.length ? EQ.duels.map(d => `
              <div class="duel-ligne">
                <div class="tx"><b>${esc(d.a.titre)}</b> contre <b>${esc(d.b.titre)}</b>
                  <span>${d.actif ? 'En cours · ' + esc(reste(d.fin)) : 'Terminé'} · ${nf(d.votes ? d.votes.a : 0)} contre ${nf(d.votes ? d.votes.b : 0)}${d.auto ? ' · tiré au sort' : ''}</span></div>
                <button type="button" class="eng-btn discret" data-eq-suppr="${esc(d.id)}">Retirer</button>
              </div>`).join('') : '<p class="eng-note" style="margin:0">Aucun duel pour le moment.</p>'}
          </div>
        </section>

        <section>
          <h4>Saisons</h4>
          <p class="eng-note" style="margin:0 0 10px">Une saison dure 4 à 6 semaines. Ses 8 récompenses (cadres, titres, couleurs de pseudo) se créent toutes seules aux couleurs choisies, et ne se gagnent que pendant la saison.</p>
          <div class="carte">
            ${EQ.saisons.length ? EQ.saisons.map(s => `
              <div class="duel-ligne">
                <span style="display:flex;gap:3px">${(s.couleurs || []).map(c => `<i style="width:14px;height:14px;border-radius:50%;background:${hexa(c, '#888')};display:inline-block"></i>`).join('')}</span>
                <div class="tx"><b>${esc(s.nom)}</b> · ${esc(s.theme)}<span>${esc(jourCourt(s.debut))} → ${esc(jourCourt(s.fin))} · ${nf(s.participants)} participant${s.participants > 1 ? 's' : ''}</span></div>
                <button type="button" class="eng-btn discret" data-eq-edit="${esc(s.id)}">Modifier</button>
              </div>`).join('') : '<p class="eng-note" style="margin:0">Aucune saison.</p>'}
          </div>
          <form class="carte" style="margin-top:10px" data-eq-saison>
            <div class="ligne"><b>${ed ? 'Modifier ' + esc(ed.nom) : 'Nouvelle saison'}</b></div>
            <div class="ligne"><input type="text" name="nom" placeholder="Nom (Saison 2)" value="${esc(ed ? ed.nom : '')}" required>
              <input type="text" name="theme" placeholder="Thème (L'Hiver)" value="${esc(ed ? ed.theme : '')}" required></div>
            <div class="ligne"><label>Début <input type="date" name="debut" value="${esc(ed ? ed.debut : dans(1))}" required></label>
              <label>Fin <input type="date" name="fin" value="${esc(ed ? ed.fin : dans(35))}" required></label></div>
            <div class="ligne"><label>Couleurs
              <input type="color" name="a" value="${hexa(ed && ed.couleurs[0], '#3b82f6')}">
              <input type="color" name="b" value="${hexa(ed && ed.couleurs[1], '#a5f3fc')}">
              <input type="color" name="c" value="${hexa(ed && ed.couleurs[2], '#c4b5fd')}"></label></div>
            <div class="ligne">
              <button type="submit" class="eng-btn">${ed ? 'Enregistrer' : 'Créer la saison'}</button>
              ${ed ? '<button type="button" class="eng-btn discret" data-eq-annuler>Annuler</button>' : ''}
            </div>
            <p class="msg" data-eq-msg2></p>
          </form>
        </section>
      </div>`;

    eqResultats();
  }

  function eqResultats(){

    const zone = EQ.el && EQ.el.querySelector('[data-eq-resultats]');
    if(!zone) return;

    zone.innerHTML = EQ.resultats.map((s, i) => `
      <div class="resultat">
        <img src="${esc(safeUrl(s.cover_url))}" alt="" loading="lazy">
        <div class="tx"><b>${esc(s.track_title)}</b><span>${esc(s.artist_name)}${s.release_date ? ' · ' + esc(String(s.release_date).slice(0, 4)) : ''}</span></div>
        <button type="button" class="eng-btn discret" data-eq-prendre="a" data-i="${i}">A</button>
        <button type="button" class="eng-btn discret" data-eq-prendre="b" data-i="${i}">B</button>
      </div>`).join('');
  }

  async function eqCharger(){

    const [d, s] = await Promise.all([BD.duelEquipeListe(), BD.saisonEquipeListe()]);

    if(d.error || s.error){
      EQ.el.innerHTML = `<div class="empty-state">${esc(erreurTexte(d.error || s.error))}</div>`;
      return;
    }

    EQ.duels = d.data || [];
    EQ.saisons = s.data || [];
    eqDessiner();
  }

  function eqBrancher(){

    if(EQ.el.dataset.engBranche) return;
    EQ.el.dataset.engBranche = '1';

    EQ.el.addEventListener('input', (ev) => {
      if(!ev.target.matches('[data-eq-recherche]')) return;
      clearTimeout(EQ.minuteur);
      const q = ev.target.value.trim();
      EQ.minuteur = setTimeout(async () => {
        if(q.length < 2){ EQ.resultats = []; eqResultats(); return; }
        const { data, error } = await BD.catalogueChercher(q, 8, 0);
        EQ.resultats = error ? [] : (data || []);
        eqResultats();
      }, 250);
    });

    EQ.el.addEventListener('click', async (ev) => {

      const prendre = ev.target.closest('[data-eq-prendre]');
      if(prendre){
        EQ[prendre.dataset.eqPrendre] = EQ.resultats[Number(prendre.dataset.i)];
        const cote = prendre.dataset.eqPrendre;
        EQ.el.querySelector('[data-eq-' + cote + ']').innerHTML = eqChoix(cote);
        return;
      }

      if(ev.target.closest('[data-eq-creer]')){
        if(!EQ.a || !EQ.b){ eqMsg('Choisis une sortie A et une sortie B.', false); return; }
        const jours = Number(EQ.el.querySelector('[data-eq-jours]').value);
        const fin = new Date(Date.now() + jours * 86400000).toISOString();
        const { error } = await BD.duelEquipeSauver(EQ.a.id, EQ.b.id, fin, EQ.el.querySelector('[data-eq-titre]').value);
        if(error){ eqMsg(erreurTexte(error), false); return; }
        EQ.a = EQ.b = null; EQ.resultats = [];
        await eqCharger();
        eqMsg('Duel lancé. Les membres sont prévenus.', true);
        return;
      }

      if(ev.target.closest('[data-eq-hasard]')){
        const jours = Number(EQ.el.querySelector('[data-eq-jours]').value);
        const { error } = await BD.duelEquipeHasard(jours);
        if(error){ eqMsg(erreurTexte(error), false); return; }
        await eqCharger();
        eqMsg('Duel tiré au sort et lancé.', true);
        return;
      }

      const suppr = ev.target.closest('[data-eq-suppr]');
      if(suppr){
        if(!window.confirm('Retirer ce duel et ses votes ?')) return;
        const { error } = await BD.duelEquipeSupprimer(suppr.dataset.eqSuppr);
        if(error){ eqMsg(erreurTexte(error), false); return; }
        await eqCharger();
        return;
      }

      const edit = ev.target.closest('[data-eq-edit]');
      if(edit){
        EQ.edition = EQ.saisons.find(s => s.id === edit.dataset.eqEdit) || null;
        eqDessiner();
        return;
      }

      if(ev.target.closest('[data-eq-annuler]')){
        EQ.edition = null;
        eqDessiner();
      }
    });

    EQ.el.addEventListener('submit', async (ev) => {

      const form = ev.target.closest('[data-eq-saison]');
      if(!form) return;
      ev.preventDefault();

      const v = (n) => form.elements[n].value;
      const msg = form.querySelector('[data-eq-msg2]');
      msg.className = 'msg'; msg.textContent = '';

      const { error } = await BD.saisonEquipeSauver({
        p_id: EQ.edition ? EQ.edition.id : null, p_nom: v('nom'), p_theme: v('theme'),
        p_debut: v('debut'), p_fin: v('fin'), p_a: v('a'), p_b: v('b'), p_c: v('c')
      });

      if(error){ msg.className = 'msg err'; msg.textContent = erreurTexte(error); return; }

      EQ.edition = null;
      await eqCharger();
      const m2 = EQ.el.querySelector('[data-eq-msg2]');
      if(m2){ m2.className = 'msg ok'; m2.textContent = 'Saison enregistrée.'; }
    });
  }

  async function equipe(emplacement){

    poserFeuille();
    EQ.el = emplacement;
    eqBrancher();

    if(!EQ.duels.length && !EQ.saisons.length) emplacement.innerHTML = '<div class="empty-state">Chargement…</div>';

    await eqCharger();
  }

  window.Engagement = { accueil, ouvrir, ouvrirNotif, equipe, semaine, saison, garderobe, duel };

})();
