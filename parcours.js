/* =====================================================================
   La Wave — le parcours d'inscription

   Créer un compte n'est plus un formulaire : c'est un parcours plein écran, une
   question à la fois. Le pseudo (vérifié en direct), le rôle, l'e-mail et le mot de
   passe, la photo, la bio, l'univers (styles, ce que l'on cherche et propose), quelques
   sorties du catalogue à enregistrer, puis, pour les métiers de la musique et de
   l'image, la preuve qui vaudra le badge « Profil vérifié » (verification.js).

   Chargé à la demande (voir ouvrirParcours dans index.html). Une seule entrée, Parcours.ouvrir(), qui
   regarde la session :

     sans compte       une inscription, de la bienvenue à la fin
     avec un compte    une reprise, pour un membre qui n'a pas fini : compte créé par Google ou
                       Spotify, ou parcours quitté en route (elle repart de la photo si le pseudo et
                       le rôle ont déjà été choisis)

   Le compte naît à l'étape « compte » ; ce qui la précède est gardé en mémoire, ce qui la
   suit est enregistré au fil des étapes, sur le profil. Quitter en route ne perd donc rien :
   le profil dit « parcours quitté » (onboarding.parcours) et la page Profil propose de
   le reprendre.
   ===================================================================== */

(function(){

  'use strict';

  // ---------------------------------------------------------------------
  // Petites aides
  // ---------------------------------------------------------------------

  const esc = (t) => escapeHtml(t);
  const attr = (t) => escapeAttribute(t);

  const pause = (ms) => new Promise(r => setTimeout(r, ms));

  const sansMouvement = () =>
    !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  const trait = (chemin, epaisseur) =>
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + (epaisseur || 2) + '" stroke-linecap="round" ' +
    'stroke-linejoin="round" aria-hidden="true">' + chemin + '</svg>';

  const SVG = {
    fermer:   trait('<path d="M6 6l12 12M18 6 6 18"/>'),
    retour:   trait('<path d="m15 5-7 7 7 7"/>'),
    oeil:     trait('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
    oeilBarre:trait('<path d="M3 3l18 18"/><path d="M10.6 5.2A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.2 6.7A17 17 0 0 0 2 12s3.6 7 10 7a10 10 0 0 0 4-.8"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>'),
    loupe:    trait('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/>'),
    plus:     trait('<path d="M12 5v14M5 12h14"/>'),
    coche:    trait('<path d="m5 12.5 4.5 4.5L19 7.5"/>', 2.6),
    camera:   trait('<path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.6"/>'),
    cadenas:  trait('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
    enveloppe:trait('<rect x="3" y="5" width="18" height="14" rx="2.4"/><path d="m3.5 7 8.5 6 8.5-6"/>')
  };

  // ---------------------------------------------------------------------
  // Ce que chaque rôle dit de lui, et ce qu'on lui suggère d'écrire
  // ---------------------------------------------------------------------

  const ROLES_PHRASES = {
    'Auditeur / Auditrice': "Je découvre, j'écoute et je note.",
    'Artiste':              'Je fais de la musique.',
    'Beatmaker':            'Je produis des instrus.',
    'DJ':                   'Je mixe et je fais danser.',
    "Membre d'un label":    'Je travaille pour un label.',
    'Manager':              "J'accompagne des artistes.",
    'Relation presse':      'Je fais rayonner des projets.',
    'Média / Presse':       "J'écris et je raconte la scène.",
    'Photographe':          'Je capture la scène en images.',
    'Autre':                'Autre chose, tout simplement.'
  };

  const BIOS = {
    'Auditeur / Auditrice': ["Toujours à la recherche de nouveaux sons.", "Fan de rap depuis toujours.", "J'écoute tout, je note tout."],
    'Artiste':              ["Artiste indépendant, un projet arrive bientôt.", "Je fais du rap depuis des années.", "J'écris, je pose, je recommence."],
    'Beatmaker':            ["Je produis des instrus pour la scène rap.", "Beatmaker, toujours en studio.", "Des prods qui claquent, à la demande."],
    'DJ':                   ["DJ, du rap au club.", "Je mixe ce que j'aime.", "Résident, toujours derrière les platines."],
    "Membre d'un label":    ["Je travaille pour un label indépendant.", "Développement d'artistes et direction artistique.", "Je défends les projets qui m'emballent."],
    'Manager':              ["Je manage des artistes indépendants.", "Booking et développement de carrière.", "Je bosse dans l'ombre de la scène."],
    'Relation presse':      ["Relations presse musique.", "J'aide les artistes à se faire entendre.", "Dossiers de presse, sorties, interviews."],
    'Média / Presse':       ["Journaliste musique.", "Je suis la scène de près et je la raconte.", "Chroniques, interviews et reportages."],
    'Photographe':          ["Photographe de concerts.", "Je couvre la scène rap en live.", "Portrait et reportage musical."],
    'Autre':                ["Passionné de musique.", "Curieux de toute la scène.", "Ici pour découvrir et partager."]
  };

  const GENRES = [
    'Trap', 'Drill', 'Boom bap', 'Cloud', 'Afro', 'Pop rap', 'Jersey',
    'R&B', 'Rap conscient', 'Old school', 'Plug', 'UK drill'
  ];

  const MAX_GENRES = 6;
  const MAX_METIERS = 8;

  // ---------------------------------------------------------------------
  // Le pseudo : ce qu'il peut être
  // ---------------------------------------------------------------------
  //
  // Lettres, chiffres, point, tiret et tiret bas, 3 à 24 caractères, sans commencer ni
  // finir par une ponctuation : c'est ce que la communauté sait citer (@pseudo).

  const PSEUDO_MIN = 3;
  const PSEUDO_MAX = 24;
  const MOTIF_PSEUDO = /^[\p{L}\p{N}](?:[\p{L}\p{N}._-]*[\p{L}\p{N}])?$/u;

  function erreurPseudo(pseudo){

    if(pseudo.length < PSEUDO_MIN) return PSEUDO_MIN + ' caractères au minimum.';
    if(pseudo.length > PSEUDO_MAX) return PSEUDO_MAX + ' caractères au maximum.';

    if(!MOTIF_PSEUDO.test(pseudo)){
      return /^[._-]|[._-]$/.test(pseudo)
        ? 'Un pseudo commence et finit par une lettre ou un chiffre.'
        : 'Des lettres, des chiffres, un point, un tiret ou un tiret bas, sans espace.';
    }

    // Les noms de l'équipe ne se prennent pas : un faux « La Wave » tromperait.
    const nu = texteNu(pseudo).replace(/[._-]+/g, '');

    if(/^(lawave|admin|equipe|moderat|support|staff)/.test(nu) || ['system', 'systeme', 'root', 'null', 'undefined'].includes(nu)){
      return 'Ce pseudo est réservé.';
    }

    return '';
  }

  // Un mot de passe : jauge de 1 à 4, et s'il passe ou non. Le serveur a ses propres règles ;
  // celles-ci évitent surtout les mots de passe que n'importe qui essaierait.
  const MOTS_DE_PASSE_COURANTS = [
    '12345678', '123456789', '1234567890', 'password', 'password1', 'motdepasse', 'azertyui', 'azerty123',
    'qwertyui', 'qwerty123', 'iloveyou', '00000000', '11111111'
  ];

  function forceMdp(m){

    if(!m) return { n: 0, texte: '8 caractères au minimum.', erreur: 'Choisis un mot de passe pour continuer.', insuffisant: true };

    if(m.length < 8){
      const reste = 8 - m.length;
      return {
        n: 1, texte: 'Encore ' + reste + ' caractère' + (reste > 1 ? 's' : '') + '.',
        erreur: 'Ton mot de passe est trop court : 8 caractères au minimum.', insuffisant: true
      };
    }

    if(MOTS_DE_PASSE_COURANTS.includes(m.toLowerCase())){
      return {
        n: 1, texte: 'Trop courant : choisis-en un autre.',
        erreur: 'Ce mot de passe est trop courant : choisis-en un autre.', insuffisant: true
      };
    }

    let n = 2;
    if(m.length >= 12) n++;
    if((/[a-z]/.test(m) && /[A-Z]/.test(m) && /\d/.test(m)) || (/[^A-Za-z0-9]/.test(m) && m.length >= 10)) n++;

    return { n: Math.min(4, n), texte: ['', '', 'Correct', 'Bien', 'Solide'][Math.min(4, n)] };
  }

  // Un identifiant Instagram se tape comme on le dit : « @lea.photo », « lea.photo », ou le lien entier. Le
  // profil public en fait un lien : il lui faut une adresse complète.
  function normaliserInstagram(valeur){

    const brut = String(valeur || '').trim();

    if(!brut) return '';

    if(/^https?:\/\//i.test(brut)) return brut;
    if(/^(www\.)?instagram\.com\//i.test(brut)) return 'https://' + brut.replace(/^www\./i, '');

    const identifiant = brut.replace(/^@+/, '');

    return /^[A-Za-z0-9._]{1,30}$/.test(identifiant) ? 'https://instagram.com/' + identifiant : brut;
  }

  function instagramVersSaisie(lien){

    const m = /instagram\.com\/([^/?#]+)/i.exec(String(lien || ''));

    return m ? '@' + m[1] : String(lien || '');
  }

  // ---------------------------------------------------------------------
  // La feuille de style, posée une fois
  // ---------------------------------------------------------------------

  const FEUILLE = `
  html.pc-ouvert, body.pc-ouvert{overflow:hidden;}

  .pc-fond{
    position:fixed; inset:0; z-index:190; display:flex; flex-direction:column; overflow:hidden;
    background:#05070a; color:var(--ink); font-weight:400;
    opacity:0; transition:opacity .5s var(--ease);
  }
  .pc-fond.ouvert{opacity:1;}
  .pc-fond *{box-sizing:border-box;}

  .pc-lueur{position:absolute; border-radius:50%; pointer-events:none; will-change:transform;}
  .pc-lueur.a{
    width:70vmax; height:70vmax; top:-40vmax; left:-28vmax;
    background:radial-gradient(closest-side, rgba(20,137,222,.30), transparent);
    animation:pcDerive 30s ease-in-out infinite alternate;
  }
  .pc-lueur.b{
    width:62vmax; height:62vmax; bottom:-36vmax; right:-26vmax;
    background:radial-gradient(closest-side, rgba(79,180,255,.17), transparent);
    animation:pcDerive 38s ease-in-out infinite alternate-reverse;
  }

  /* ----- le haut : retour, progression, fermer ----- */
  .pc-haut{
    position:relative; z-index:3; flex-shrink:0; width:min(760px,100%); margin:0 auto;
    padding:16px 20px 0; display:grid; grid-template-columns:42px 1fr 42px; align-items:center; gap:14px;
  }
  .pc-rond{
    width:42px; height:42px; padding:0; border-radius:50%;
    display:flex; align-items:center; justify-content:center;
    color:var(--ink-soft); background:rgba(255,255,255,.05); border:1px solid var(--line);
    transition:background .25s var(--ease), color .25s var(--ease), opacity .3s var(--ease), transform .25s var(--ease);
  }
  .pc-rond:hover{background:rgba(255,255,255,.11); color:#fff;}
  .pc-rond:active{transform:scale(.94);}
  .pc-rond svg{width:18px; height:18px;}
  .pc-rond.cache{opacity:0; pointer-events:none;}
  .pc-progres{display:flex; flex-direction:column; align-items:center; gap:8px; min-width:0;}
  .pc-progres-texte{min-height:16px; font-size:12px; letter-spacing:.06em; color:var(--muted); font-variant-numeric:tabular-nums;}
  .pc-barre{width:min(340px,100%); height:4px; border-radius:4px; background:rgba(255,255,255,.1); overflow:hidden;}
  .pc-barre i{
    display:block; height:100%; width:0; border-radius:inherit;
    background:linear-gradient(90deg,var(--blue),var(--blue-bright));
    box-shadow:0 0 14px rgba(79,180,255,.65); transition:width .8s var(--ease);
  }

  /* ----- la scène : une étape à la fois ----- */
  .pc-scene{
    position:relative; z-index:2; flex:1; min-height:0; overflow-y:auto; overflow-x:hidden;
    display:flex; flex-direction:column; align-items:center; padding:0 22px;
    overscroll-behavior:contain; scrollbar-width:thin; scrollbar-color:rgba(255,255,255,.2) transparent;
  }
  .pc-etape{
    width:min(620px,100%); margin:auto 0; padding:30px 0 44px; display:flex; flex-direction:column;
    animation:fondu .3s ease-out both;
  }
  .pc-etape.large{width:min(780px,100%);}
  .pc-etape.sort{animation:pcSort .2s cubic-bezier(.5,0,.75,0) forwards;}
  /* Une étape qui arrive doit se lire tout de suite : le texte reste dans une couche animée (donc un peu pâle et
     flou) tant qu'une animation tourne. Le conteneur ne fait que se fondre, chaque bloc monte de 10 px, et la
     cascade s'arrête au sixième : tout est posé en moins d'une seconde, plus de deux avant. */
  .pc-etape > *{animation:pcMonte .4s var(--ease) both; animation-delay:calc(min(var(--i,0), 6) * 40ms);}

  .pc-surtitre{margin:0 0 12px; font-size:12px; font-weight:600; letter-spacing:.14em; text-transform:uppercase; color:var(--blue-bright);}
  .pc-titre{margin:0 0 12px; font-size:clamp(28px,5.4vw,42px); line-height:1.08; letter-spacing:-.025em; outline:none;}
  .pc-sous{margin:0 0 28px; max-width:50ch; font-size:16px; line-height:1.55; color:var(--ink-soft);}
  .pc-astuce{margin:14px 0 0; font-size:12.5px; color:var(--muted); text-align:center;}

  .pc-fond .pc-etape .field{margin-bottom:20px;}
  .pc-fond .pc-etape .field input, .pc-fond .pc-etape .field textarea{font-size:16px; padding:16px 18px; border-radius:16px;}
  .pc-fond .pc-etape .field textarea{min-height:120px; line-height:1.5;}
  .pc-fond .pc-etape .field label{margin-bottom:9px;}
  .pc-fond .pc-etape .field label small{text-transform:none; letter-spacing:0; font-weight:400; color:var(--muted); margin-left:6px;}
  .pc-fond .pc-etape .field [aria-invalid="true"]{border-color:var(--danger); box-shadow:0 0 0 4px rgba(229,105,92,.14);}
  .pc-secoue{animation:secousse .5s var(--ease);}

  /* Le bouton d'étape reste en vue, collé au bas de la scène, quand l'étape est plus haute que l'écran. */
  .pc-actions{
    position:sticky; bottom:0; z-index:4; display:flex; flex-wrap:wrap; align-items:center; gap:12px;
    margin-top:22px; padding:14px 0 calc(12px + env(safe-area-inset-bottom, 0px));
  }
  /* Une étape plus haute que l'écran : le bouton colle au bas, sur un fond qui efface ce qui défile dessous. */
  .pc-scene.deborde .pc-actions{background:linear-gradient(to top,#05070a 70%,rgba(5,7,10,0));}
  .pc-confirme-carte .pc-actions{position:static; margin:0; padding:0; background:none;}
  .pc-actions .btn{padding:15px 30px; font-size:15px; justify-content:center;}
  .pc-actions .btn[disabled]{opacity:.55; pointer-events:none;}
  .pc-actions .btn.charge{pointer-events:none;}
  .pc-actions .btn.charge::after{
    content:""; width:16px; height:16px; border-radius:50%;
    border:2px solid rgba(255,255,255,.35); border-top-color:#fff; animation:pcTourne .7s linear infinite;
  }
  .pc-actions .btn.succes{background:#1f9d62; pointer-events:none;}
  .pc-lien{
    padding:8px 4px; background:none; border:0; font-size:14px; color:var(--ink-soft);
    text-decoration:underline; text-underline-offset:3px;
  }
  .pc-lien:hover{color:#fff;}
  .pc-fond :focus-visible{outline:2px solid var(--blue-bright); outline-offset:3px;}

  /* ----- bienvenue ----- */
  .pc-logo{height:46px; width:auto; margin:0 0 22px; align-self:flex-start; opacity:.95;}
  .pc-promesses{list-style:none; margin:0 0 6px; padding:0; display:flex; flex-direction:column; gap:10px;}
  .pc-promesses li{
    display:flex; gap:14px; align-items:center; padding:13px 16px; border-radius:var(--radius-sm);
    background:rgba(255,255,255,.04); border:1px solid var(--line);
  }
  .pc-promesses li > span{
    width:38px; height:38px; flex-shrink:0; border-radius:50%; font-size:18px;
    display:flex; align-items:center; justify-content:center; background:rgba(79,180,255,.12);
  }
  .pc-promesses b{display:block; font-size:14.5px; font-weight:600;}
  .pc-promesses small{display:block; font-size:13px; color:var(--ink-soft);}
  .pc-ou{display:flex; align-items:center; gap:12px; margin:24px 0 14px; font-size:12px; color:var(--muted);}
  .pc-ou::before, .pc-ou::after{content:""; flex:1; height:1px; background:var(--line);}
  .pc-fournisseurs{display:flex; gap:10px; flex-wrap:wrap;}
  .pc-fournisseurs .fournisseur{flex:1 1 200px; width:auto;}
  .pc-connexion{margin:22px 0 0; font-size:14px; color:var(--ink-soft);}
  .pc-connexion .pc-lien{color:var(--blue-bright); padding:4px;}

  /* ----- pseudo ----- */
  .pc-pseudo{position:relative;}
  .pc-pseudo .arobase{position:absolute; left:18px; top:50%; transform:translateY(-50%); font-size:16px; color:var(--muted); pointer-events:none;}
  .pc-fond .pc-etape .field .pc-pseudo input{padding-left:40px;}
  .pc-statut{display:flex; align-items:center; gap:8px; min-height:24px; margin:12px 2px 0; font-size:13.5px; color:var(--muted);}
  .pc-statut .pastille{
    width:18px; height:18px; flex-shrink:0; border-radius:50%; display:none;
    align-items:center; justify-content:center; font-size:11px; font-weight:700; color:#06121f;
  }
  .pc-statut .pastille svg{width:12px; height:12px;}
  .pc-statut.ok{color:#8fe3ab;}
  .pc-statut.non{color:var(--danger);}
  .pc-statut.ok .pastille, .pc-statut.non .pastille{display:flex; animation:pcPop .4s var(--ease) both;}
  .pc-statut.ok .pastille{background:#6fdc9a;}
  .pc-statut.non .pastille{background:var(--danger);}
  .pc-statut.attente .pastille{
    display:block; border:2px solid rgba(255,255,255,.2); border-top-color:var(--blue-bright);
    animation:pcTourne .7s linear infinite;
  }
  .pc-regles{margin:14px 2px 0; font-size:12.5px; color:var(--muted);}

  /* ----- rôle ----- */
  .pc-roles{display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px;}
  .pc-role{
    position:relative; display:flex; flex-direction:column; align-items:flex-start; gap:6px;
    padding:15px 15px 14px; text-align:left; border-radius:var(--radius-sm);
    background:rgba(255,255,255,.04); border:1px solid var(--line); color:var(--ink);
    transition:transform .35s var(--ease), border-color .25s var(--ease), background .25s var(--ease), box-shadow .35s var(--ease);
  }
  .pc-role:hover{transform:translateY(-2px); border-color:var(--line-strong); background:rgba(255,255,255,.07);}
  .pc-role[aria-pressed="true"]{
    border-color:var(--teinte); background:rgba(255,255,255,.09);
    background:color-mix(in srgb, var(--teinte) 15%, rgba(255,255,255,.03));
    box-shadow:0 0 0 1px var(--teinte), 0 12px 34px -14px var(--teinte);
  }
  .pc-role .ic{
    width:40px; height:40px; border-radius:50%; font-size:20px; display:flex; align-items:center; justify-content:center;
    background:rgba(255,255,255,.06); transition:transform .4s var(--ease), background .3s var(--ease);
  }
  .pc-role[aria-pressed="true"] .ic{transform:scale(1.08); background:color-mix(in srgb, var(--teinte) 28%, transparent);}
  .pc-role b{font-size:15px; font-weight:600; line-height:1.2;}
  .pc-role span.phrase{font-size:12.5px; color:var(--ink-soft); line-height:1.35;}
  .pc-role .coche{
    position:absolute; top:11px; right:11px; width:22px; height:22px; border-radius:50%;
    display:flex; align-items:center; justify-content:center; background:var(--teinte); color:#06121f;
    transform:scale(0); transition:transform .45s var(--ease);
  }
  .pc-role .coche svg{width:13px; height:13px;}
  .pc-role[aria-pressed="true"] .coche{transform:scale(1);}
  .pc-note{
    display:flex; gap:12px; align-items:flex-start; margin-top:18px; padding:14px 16px; min-height:68px;
    font-size:13.5px; line-height:1.5; color:var(--ink-soft); border-radius:var(--radius-sm);
    background:rgba(79,180,255,.07); border:1px solid rgba(79,180,255,.2);
  }
  .pc-note.joue{animation:pcMonte .45s var(--ease) both;}
  .pc-note .ic{flex-shrink:0; width:22px; height:22px; color:var(--blue-bright);}
  .pc-note .ic svg{width:100%; height:100%;}
  .pc-note.vide{visibility:hidden;}

  /* ----- compte ----- */
  .pc-mdp{position:relative;}
  .pc-fond .pc-etape .field .pc-mdp input{padding-right:54px;}
  .pc-oeil{
    position:absolute; right:6px; top:50%; transform:translateY(-50%); width:42px; height:42px; padding:0;
    display:flex; align-items:center; justify-content:center; background:none; border:0; border-radius:50%;
    color:var(--muted); transition:color .2s var(--ease);
  }
  .pc-oeil:hover{color:#fff;}
  .pc-oeil svg{width:20px; height:20px;}
  .pc-force{display:grid; grid-template-columns:repeat(4,1fr); gap:6px; margin:12px 2px 0;}
  .pc-force i{height:4px; border-radius:4px; background:rgba(255,255,255,.1); transition:background .35s var(--ease);}
  .pc-force[data-n="1"] i:nth-child(-n+1){background:var(--danger);}
  .pc-force[data-n="2"] i:nth-child(-n+2){background:#e9a23b;}
  .pc-force[data-n="3"] i:nth-child(-n+3){background:var(--blue-bright);}
  .pc-force[data-n="4"] i{background:#6fdc9a;}
  .pc-force-texte{min-height:20px; margin:8px 2px 0; font-size:12.5px; color:var(--muted);}
  .pc-rassure{
    display:flex; gap:10px; align-items:flex-start; margin:6px 0 0; font-size:12.5px; line-height:1.5; color:var(--ink-soft);
  }
  .pc-rassure svg{flex-shrink:0; width:16px; height:16px; margin-top:2px; color:var(--blue-bright);}

  /* ----- photo ----- */
  .pc-photo{
    position:relative; width:190px; height:190px; margin:4px auto 6px; padding:0; border-radius:50%;
    display:flex; align-items:center; justify-content:center; background:rgba(255,255,255,.04); border:0;
    transition:transform .4s var(--ease);
  }
  .pc-photo::before{
    content:""; position:absolute; inset:-9px; border-radius:50%;
    border:1.5px dashed rgba(255,255,255,.26); animation:pcTourne 50s linear infinite;
    transition:border-color .3s var(--ease);
  }
  .pc-photo:hover, .pc-photo.survol{transform:scale(1.03);}
  .pc-photo:hover::before, .pc-photo.survol::before{border-color:var(--blue-bright);}
  .pc-photo.pleine::before{border-style:solid; border-color:rgba(79,180,255,.5); animation:none;}
  .pc-photo img{
    width:100%; height:100%; border-radius:50%; object-fit:cover;
    box-shadow:0 0 0 3px rgba(79,180,255,.45), 0 18px 44px rgba(0,0,0,.5); animation:pcPop .5s var(--ease) both;
  }
  .pc-photo .initiale{font-size:68px; font-weight:700; color:var(--blue-bright); text-transform:uppercase;}
  .pc-photo .plus{
    position:absolute; right:6px; bottom:8px; width:46px; height:46px; border-radius:50%; color:#fff;
    display:flex; align-items:center; justify-content:center; background:var(--blue);
    box-shadow:0 8px 22px rgba(20,137,222,.5), 0 0 0 4px #05070a;
  }
  .pc-photo .plus svg{width:22px; height:22px;}

  /* ----- profil et univers ----- */
  .pc-compteur-bio{margin:8px 2px 0; text-align:right; font-size:12px; color:var(--muted); font-variant-numeric:tabular-nums;}
  .pc-puces{display:flex; flex-wrap:wrap; gap:8px;}
  .pc-puce{
    display:inline-flex; align-items:center; gap:7px; padding:9px 15px; border-radius:var(--radius-pill);
    font-size:14px; color:var(--ink-soft); background:rgba(255,255,255,.04); border:1px solid var(--line);
    transition:background .25s var(--ease), border-color .25s var(--ease), color .25s var(--ease), transform .3s var(--ease);
  }
  .pc-puce:hover{border-color:var(--line-strong); color:#fff;}
  .pc-puce:active{transform:scale(.95);}
  .pc-puce[aria-pressed="true"]{color:#fff; border-color:var(--blue); background:rgba(20,137,222,.22); animation:pcPop .35s var(--ease);}
  .pc-puce[aria-disabled="true"]{opacity:.4;}
  .pc-puce .ic{font-size:15px; line-height:1;}
  .pc-bloc{border:0; padding:0; margin:0 0 28px; min-width:0;}
  .pc-bloc > legend{padding:0; margin:0 0 12px; font-size:14px; font-weight:600; color:var(--ink);}
  .pc-bloc > legend small{margin-left:6px; font-size:12.5px; font-weight:400; color:var(--muted);}
  .pc-bloc .field{margin:12px 0 0;}
  .pc-fond .pc-bloc .field input{padding:12px 16px; border-radius:14px;}

  /* ----- sorties ----- */
  .pc-fond .pc-etape .field.pc-recherche{position:relative; margin-bottom:14px;}
  .pc-recherche svg{position:absolute; left:16px; top:50%; transform:translateY(-50%); width:19px; height:19px; color:var(--muted); pointer-events:none;}
  .pc-fond .pc-etape .field.pc-recherche input{padding-left:46px;}
  .pc-sorties-tete{display:flex; align-items:center; justify-content:space-between; gap:12px; margin:0 2px 14px; font-size:13px; color:var(--muted);}
  .pc-compteur{
    display:inline-flex; align-items:center; gap:8px; padding:6px 13px; border-radius:var(--radius-pill);
    font-size:13px; color:var(--ink-soft); background:rgba(255,255,255,.05); border:1px solid var(--line);
    transition:color .3s var(--ease), border-color .3s var(--ease), background .3s var(--ease);
  }
  .pc-compteur.plein{color:#fff; border-color:rgba(79,180,255,.5); background:rgba(20,137,222,.18);}
  .pc-compteur.saute{animation:pcPop .35s var(--ease);}
  .pc-grille{display:grid; grid-template-columns:repeat(auto-fill,minmax(112px,1fr)); gap:16px 14px;}
  @media (max-width:640px){ .pc-grille{grid-template-columns:repeat(auto-fill,minmax(96px,1fr)); gap:14px 10px;} }
  .pc-sortie{
    display:block; padding:0; background:none; border:0; text-align:left; color:inherit;
    animation:pcMonte .5s var(--ease) both; animation-delay:calc(var(--k,0) * 28ms);
  }
  .pc-pochette{
    position:relative; display:block; aspect-ratio:1; overflow:hidden; border-radius:var(--radius-sm);
    background:#10151c; border:1px solid var(--line);
    transition:transform .4s var(--ease), box-shadow .4s var(--ease), border-color .3s var(--ease);
  }
  .pc-pochette img{width:100%; height:100%; object-fit:cover; display:block;}
  .pc-sortie:hover .pc-pochette{transform:translateY(-3px); box-shadow:var(--ombre-2);}
  .pc-ajout{
    position:absolute; right:8px; bottom:8px; width:32px; height:32px; border-radius:50%; color:#fff;
    display:flex; align-items:center; justify-content:center; background:rgba(5,7,10,.66);
    -webkit-backdrop-filter:blur(8px); backdrop-filter:blur(8px); border:1px solid rgba(255,255,255,.28);
    transition:background .25s var(--ease), border-color .25s var(--ease);
  }
  .pc-ajout svg{width:17px; height:17px;}
  .pc-ajout svg + svg{display:none;}
  .pc-sortie[aria-pressed="true"] .pc-pochette{border-color:var(--blue-bright); box-shadow:0 0 0 2px var(--blue-bright), 0 12px 30px -10px rgba(79,180,255,.65);}
  .pc-sortie[aria-pressed="true"] .pc-ajout{background:var(--blue); border-color:var(--blue-bright); animation:pcPop .45s var(--ease);}
  .pc-sortie[aria-pressed="true"] .pc-ajout svg:first-child{display:none;}
  .pc-sortie[aria-pressed="true"] .pc-ajout svg + svg{display:block;}
  .pc-sortie .nom{display:block; margin-top:9px; font-size:13px; font-weight:600; line-height:1.25; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
  .pc-sortie .artiste{display:block; font-size:12px; color:var(--muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
  .pc-vide{grid-column:1/-1; padding:30px 10px; text-align:center; font-size:14px; color:var(--muted);}
  .pc-plus-sorties{display:flex; justify-content:center; margin-top:20px;}

  /* ----- vérification ----- */
  .pc-verif .vd-corps{padding:0;}

  /* ----- fin ----- */
  .pc-etape.fin{align-items:center; text-align:center;}
  .pc-etape.fin .pc-sous{margin-left:auto; margin-right:auto;}
  .pc-anneau{position:relative; width:128px; height:128px; margin:0 auto 26px;}
  .pc-anneau .halo{
    position:absolute; inset:-34px; border-radius:50%; pointer-events:none;
    background:radial-gradient(closest-side, rgba(79,180,255,.38), transparent); animation:pcPulse 3.2s ease-in-out infinite;
  }
  .pc-anneau svg{position:relative; width:100%; height:100%; color:var(--blue-bright);}
  .pc-anneau circle{stroke-dasharray:314; stroke-dashoffset:314; animation:pcTrace 1s .15s var(--ease) forwards;}
  .pc-anneau path{stroke-dasharray:60; stroke-dashoffset:60; animation:pcTrace .6s .85s var(--ease) forwards;}
  .pc-eclat{
    position:absolute; left:50%; top:50%; width:7px; height:7px; margin:-3.5px; border-radius:50%;
    background:var(--c,#4fb4ff); opacity:0; animation:pcEclat 1.3s var(--d,.9s) var(--ease) forwards;
  }
  .pc-recap{list-style:none; width:min(460px,100%); margin:0 auto; padding:0; display:flex; flex-direction:column; gap:9px; text-align:left;}
  .pc-recap li{
    display:flex; gap:13px; align-items:center; padding:12px 16px; font-size:14px; color:var(--ink);
    border-radius:var(--radius-sm); background:rgba(255,255,255,.04); border:1px solid var(--line);
    animation:pcMonte .5s var(--ease) both; animation-delay:calc(1.05s + var(--k,0) * 110ms);
  }
  .pc-recap li .pastille{
    width:24px; height:24px; flex-shrink:0; border-radius:50%; display:flex; align-items:center; justify-content:center;
    font-size:13px; background:#6fdc9a; color:#06121f;
  }
  .pc-recap li .pastille svg{width:14px; height:14px;}
  .pc-recap li.attente .pastille{background:var(--gold-favori);}
  .pc-recap li small{display:block; font-size:12.5px; color:var(--ink-soft);}
  .pc-reste-a-faire{
    margin:16px auto 0; max-width:44ch; font-size:13px; line-height:1.5; color:var(--muted);
    animation:pcMonte .5s var(--ease) both; animation-delay:1.5s;
  }
  .pc-etape.fin .pc-actions{justify-content:center; margin-top:30px;}

  /* ----- quitter ? ----- */
  .pc-confirme{
    position:absolute; inset:0; z-index:6; display:flex; align-items:center; justify-content:center; padding:20px;
    background:rgba(3,5,8,.74); -webkit-backdrop-filter:blur(10px); backdrop-filter:blur(10px);
    animation:fondu .25s var(--ease) both;
  }
  .pc-confirme-carte{
    width:min(420px,100%); padding:26px 24px 22px; border-radius:var(--radius-lg);
    background:rgba(13,17,22,.96); border:1px solid var(--line-strong); box-shadow:var(--ombre-3), var(--reflet-int);
    animation:pcPop .4s var(--ease) both;
  }
  .pc-confirme-carte h3{margin:0 0 8px; font-size:19px;}
  .pc-confirme-carte p{margin:0 0 20px; font-size:14px; color:var(--ink-soft);}
  .pc-confirme-carte .pc-actions{margin:0;}
  .pc-confirme-carte .pc-actions .btn{padding:12px 22px; font-size:14px;}

  @keyframes pcDerive{from{transform:translate3d(0,0,0) scale(1);} to{transform:translate3d(7vmax,5vmax,0) scale(1.14);}}
  @keyframes pcSort{to{opacity:0; transform:translateX(var(--dx-sortie,-24px));}}
  @keyframes pcMonte{from{opacity:0; transform:translateY(10px);} to{opacity:1; transform:none;}}
  @keyframes pcPop{0%{opacity:0; transform:scale(.8);} 60%{transform:scale(1.07);} 100%{opacity:1; transform:none;}}
  @keyframes pcTourne{to{transform:rotate(360deg);}}
  @keyframes pcTrace{to{stroke-dashoffset:0;}}
  @keyframes pcPulse{0%,100%{opacity:.7; transform:scale(.96);} 50%{opacity:1; transform:scale(1.06);}}
  @keyframes pcEclat{
    0%{opacity:0; transform:translate(0,0) scale(.4);}
    15%{opacity:1;}
    100%{opacity:0; transform:translate(var(--x,0), var(--y,0)) scale(1);}
  }

  @media (min-width:700px){
    .pc-roles{grid-template-columns:repeat(3,minmax(0,1fr));}
  }
  @media (max-width:640px){
    .pc-haut{padding:12px 14px 0;}
    .pc-scene{padding:0 18px;}
    .pc-etape{padding:20px 0 28px;}
    .pc-sous{margin-bottom:22px; font-size:15px;}
    .pc-photo{width:168px; height:168px;}
    .pc-actions .btn-primary{flex:1;}
    .pc-etape.fin .pc-actions{justify-content:stretch;}
    .pc-fournisseurs .fournisseur{flex-basis:100%;}
  }
  @media (prefers-reduced-motion:reduce){
    .pc-fond, .pc-barre i, .pc-role, .pc-puce, .pc-pochette{transition:none;}
    .pc-lueur, .pc-etape, .pc-etape > *, .pc-photo::before, .pc-sortie, .pc-recap li, .pc-note.joue,
    .pc-anneau .halo, .pc-eclat, .pc-confirme, .pc-confirme-carte, .pc-photo img, .pc-reste-a-faire{animation:none;}
    .pc-anneau circle, .pc-anneau path{animation:none; stroke-dashoffset:0;}
    .pc-eclat{display:none;}
  }
  `;

  function poserFeuille(){

    if(document.getElementById('pc-feuille')) return;

    const style = document.createElement('style');
    style.id = 'pc-feuille';
    style.textContent = FEUILLE;
    document.head.appendChild(style);
  }

  // ---------------------------------------------------------------------
  // L'état du parcours à l'écran
  // ---------------------------------------------------------------------

  let ouvert = null;    // { fond, scene, retour, barre, texte, confirmation, focusAvant }
  let etat = null;

  const FOCALISABLES = 'button:not([disabled]), a[href], input:not([disabled]):not([type="hidden"]), ' +
                       'textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

  // Les étapes, dans l'ordre. « compte » n'existe que pour un visiteur ; « verification » que pour un rôle
  // qui peut recevoir le badge. Une reprise dont le pseudo et le rôle ont déjà été choisis part de la photo.
  function calculerSuite(){

    const s = [];
    const identiteFaite = etat.reprise && etat.identiteFaite;

    if(!identiteFaite) s.push('bienvenue', 'pseudo', 'role');
    if(!etat.reprise) s.push('compte');

    s.push('photo', 'profil', 'univers', 'sorties');

    // L'étape de vérification n'existe que si la vérification est active (elle peut être en pause : voir
    // verificationExigee dans index.html) et que le rôle peut recevoir le badge.
    if(etat.role && roleAVerifier(etat.role) && verificationExigee) s.push('verification');

    s.push('fin');

    return s;
  }

  function indexPlancher(){
    return etat.plancher ? Math.max(0, etat.suite.indexOf(etat.plancher)) : 0;
  }

  // ---------------------------------------------------------------------
  // Les étapes
  // ---------------------------------------------------------------------

  const ETAPES = {};

  // ----- Bienvenue -----------------------------------------------------

  const GOOGLE = `<svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M23 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.2a5.3 5.3 0 0 1-2.3 3.5v2.9h3.7c2.2-2 3.4-5 3.4-8.6z"/>
      <path fill="#34A853" d="M12 24c3.1 0 5.7-1 7.6-2.8l-3.7-2.9a7 7 0 0 1-10.4-3.7H1.7v3A12 12 0 0 0 12 24z"/>
      <path fill="#FBBC05" d="M5.5 14.6a7.2 7.2 0 0 1 0-4.6v-3H1.7a12 12 0 0 0 0 10.6l3.8-3z"/>
      <path fill="#EA4335" d="M12 4.8c1.7 0 3.2.6 4.4 1.7l3.3-3.3A11.6 11.6 0 0 0 12 0 12 12 0 0 0 1.7 6l3.8 3A7.1 7.1 0 0 1 12 4.8z"/></svg>`;

  const SPOTIFY = `<svg viewBox="0 0 24 24" fill="#1DB954" aria-hidden="true">
      <path d="M12 2a10 10 0 100 20 10 10 0 000-20zm4.6 14.4a.8.8 0 01-1.1.3c-3-1.8-6.7-2.2-11.1-1.2a.8.8 0 11-.3-1.5c4.8-1.1 8.9-.6 12.2 1.4.4.2.5.7.3 1zm1.2-2.9a1 1 0 01-1.3.3c-3.4-2.1-8.6-2.7-12.6-1.5a1 1 0 11-.6-1.9c4.6-1.4 10.3-.7 14.2 1.7.5.3.6.9.3 1.4zm.1-3C13.9 8.1 7.2 7.9 3.3 9.1a1.2 1.2 0 11-.7-2.3C7 5.4 14.4 5.6 19 8.4a1.2 1.2 0 01-1.1 2.1z"/></svg>`;

  function logoHtml(){

    const img = document.querySelector('.nav-logo img');

    return img && img.src ? `<img class="pc-logo" src="${attr(img.src)}" alt="La Wave">` : '';
  }

  ETAPES.bienvenue = {

    entree: true,

    html(){

      const reprise = etat.reprise;

      return `
        ${logoHtml()}
        <p class="pc-surtitre">${reprise ? 'Ton compte est prêt' : 'Bienvenue'}</p>
        <h2 class="pc-titre" tabindex="-1">${reprise ? 'Finissons ton profil' : 'Rejoins La Wave'}</h2>
        <p class="pc-sous">${reprise
          ? "Il reste à choisir ton pseudo, ton rôle et à ajouter une photo. Quelques étapes, et le site est à toi."
          : "Quelques étapes pour créer ton profil, retrouver les sorties que tu aimes et rejoindre la communauté. Compte deux minutes."}</p>
        <ul class="pc-promesses">
          <li><span aria-hidden="true">🎧</span><div><b>Note les sorties</b><small>Garde celles que tu aimes dans ta collection.</small></div></li>
          <li><span aria-hidden="true">🤝</span><div><b>Rencontre la scène</b><small>Artistes, photographes, médias : tout le monde y est.</small></div></li>
          ${verificationExigee
            ? `<li><span aria-hidden="true">✓</span><div><b>Fais vérifier ton profil</b><small>Un badge pour montrer que tu es bien celui que tu dis.</small></div></li>`
            : `<li><span aria-hidden="true">⚡</span><div><b>Gagne de l'XP</b><small>Chaque action te rapproche du niveau suivant.</small></div></li>`}
        </ul>
        <div class="pc-actions">
          <button type="button" class="btn btn-primary" data-act="suivant" data-focus>${reprise ? 'Continuer' : "C'est parti"}</button>
        </div>
        ${reprise ? '' : `
          <div class="pc-ou">ou continue avec</div>
          <div class="pc-fournisseurs">
            <button type="button" class="fournisseur" data-act="fournisseur" data-f="google">${GOOGLE} Google</button>
            <button type="button" class="fournisseur" data-act="fournisseur" data-f="spotify">${SPOTIFY} Spotify</button>
          </div>
          <div class="form-msg" id="pc-msg" role="alert"></div>
          <p class="pc-connexion">Déjà inscrit ? <button type="button" class="pc-lien" data-act="connexion">Se connecter</button></p>`}`;
    }
  };

  // ----- Pseudo --------------------------------------------------------

  function afficherStatut(classe, texte){

    const zone = etat.racine && etat.racine.querySelector('.pc-statut');

    if(!zone) return;

    zone.className = 'pc-statut' + (classe ? ' ' + classe : '');
    zone.querySelector('.texte').textContent = texte || '';
    zone.querySelector('.pastille').innerHTML = classe === 'ok' ? SVG.coche : classe === 'non' ? '!' : '';
  }

  // Vérifie le pseudo tapé : les règles d'abord (sans réseau), puis la base. `tout de suite` saute l'attente
  // de frappe : c'est ce qu'on fait en validant l'étape.
  async function verifierPseudo(toutDeSuite){

    const champ = etat.racine && etat.racine.querySelector('#pc-pseudo');

    if(!champ) return etat.pseudoEtat;

    const valeur = champ.value.trim();
    const requete = ++etat.pseudoRequete;

    etat.pseudo = valeur;
    clearTimeout(etat.pseudoMinuteur);
    champ.removeAttribute('aria-invalid');

    if(!valeur){
      etat.pseudoEtat = 'vide';
      afficherStatut('', '');
      return etat.pseudoEtat;
    }

    const regle = erreurPseudo(valeur);

    if(regle){
      etat.pseudoEtat = 'invalide';
      afficherStatut('non', regle);
      return etat.pseudoEtat;
    }

    // Son propre pseudo, tel qu'il est déjà : rien à vérifier.
    if(currentUser && etat.reprise && valeur === currentUser.pseudo){
      etat.pseudoEtat = 'libre';
      afficherStatut('ok', "C'est ton pseudo actuel");
      return etat.pseudoEtat;
    }

    etat.pseudoEtat = 'attente';
    afficherStatut('attente', 'Vérification…');

    const interroger = async () => {

      let reponse;

      try{
        reponse = await BD.pseudoPris(valeur, etat.userId || (currentUser && currentUser.id) || null);
      }catch(erreur){
        reponse = { data: null, error: erreur };
      }

      // Une frappe plus récente a pris le relais : cette réponse n'est plus la bonne.
      if(!etat || requete !== etat.pseudoRequete) return etat && etat.pseudoEtat;

      if(reponse.error){
        etat.pseudoEtat = 'inconnu';
        afficherStatut('', "Impossible de vérifier pour l'instant : on revérifiera à la création du compte.");
      } else if(reponse.data){
        etat.pseudoEtat = 'pris';
        afficherStatut('non', 'Ce pseudo est déjà pris.');
      } else {
        etat.pseudoEtat = 'libre';
        afficherStatut('ok', 'Disponible');
      }

      return etat.pseudoEtat;
    };

    if(toutDeSuite) return interroger();

    etat.pseudoMinuteur = setTimeout(interroger, 380);

    return etat.pseudoEtat;
  }

  ETAPES.pseudo = {

    html(){
      return `
        <p class="pc-surtitre">Ton identité</p>
        <h2 class="pc-titre" tabindex="-1">Comment veux-tu t'appeler ?</h2>
        <p class="pc-sous">Ton pseudo est public : c'est ce que les autres voient sur tes avis et tes messages.</p>
        <div class="field">
          <label for="pc-pseudo">Pseudo</label>
          <div class="pc-pseudo">
            <span class="arobase" aria-hidden="true">@</span>
            <input type="text" id="pc-pseudo" maxlength="${PSEUDO_MAX + 6}" value="${attr(etat.pseudo)}" placeholder="ton.pseudo"
                   autocomplete="off" autocapitalize="off" spellcheck="false" aria-describedby="pc-statut" data-focus>
          </div>
          <div class="pc-statut" id="pc-statut" aria-live="polite"><span class="pastille"></span><span class="texte"></span></div>
          <p class="pc-regles">${PSEUDO_MIN} à ${PSEUDO_MAX} caractères : lettres, chiffres, point, tiret ou tiret bas.</p>
        </div>
        <div class="pc-actions">
          <button type="button" class="btn btn-primary" data-act="suivant">Continuer</button>
        </div>`;
    },

    monter(el){

      const champ = el.querySelector('#pc-pseudo');

      champ.addEventListener('input', () => verifierPseudo(false));

      if(etat.pseudo) verifierPseudo(false);
    },

    async valider(){

      const champ = etat.racine.querySelector('#pc-pseudo');

      const refuser = (texte) => {
        champ.setAttribute('aria-invalid', 'true');
        champ.focus();
        secouer(champ.closest('.field'));
        if(texte) afficherStatut('non', texte);
        return false;
      };

      const valeur = champ.value.trim();

      if(!valeur) return refuser('Choisis un pseudo pour continuer.');

      let resultat = await verifierPseudo(true);

      if(resultat === 'invalide') return refuser();
      if(resultat === 'pris') return refuser();

      // Un compte déjà créé (reprise) : le pseudo change tout de suite, sur le profil.
      if(etat.reprise && valeur !== currentUser.pseudo){

        try{
          await saveCurrentProfile({ pseudo: valeur });
          currentUser.pseudo = valeur;
        }catch(erreur){
          return refuser(/duplicate|unique/i.test(String(erreur.message)) ? 'Ce pseudo est déjà pris.' : 'Enregistrement impossible : ' + erreur.message);
        }

        refreshAccountUI();
      }

      etat.pseudo = valeur;

      return true;
    }
  };

  // ----- Rôle ----------------------------------------------------------

  function noteRole(role){

    // Vérification en pause : on n'en parle pas.
    if(!role || !verificationExigee) return { icone: '', texte: '' };

    if(!roleAVerifier(role)){
      return { icone: SVG.coche, texte: "Pas de vérification à faire : tu pourras tout utiliser dès la fin du parcours." };
    }

    return {
      icone: iconeVerifie(),
      texte: role === 'Photographe'
        ? "À la fin, tu pourras faire vérifier ton profil avec une capture de ton travail : c'est ce qui donne le badge « Profil vérifié », et l'accès aux accréditations photo."
        : "À la fin, tu pourras faire vérifier ton profil avec une capture : l'équipe la valide, et ton profil reçoit le badge « Profil vérifié »."
    };
  }

  function majNoteRole(){

    const zone = etat.racine && etat.racine.querySelector('.pc-note');

    if(!zone) return;

    const note = noteRole(etat.role);

    zone.classList.toggle('vide', !note.texte);
    zone.innerHTML = note.texte ? `<span class="ic">${note.icone}</span><span>${esc(note.texte)}</span>` : '';

    zone.classList.remove('joue');
    void zone.offsetWidth;
    if(note.texte) zone.classList.add('joue');
  }

  ETAPES.role = {

    large: true,

    html(){

      const cartes = MEMBER_ROLES.map(r => `
        <button type="button" class="pc-role" data-role="${attr(r.name)}" style="--teinte:${attr(r.color)}"
                aria-pressed="${etat.role === r.name}">
          <span class="ic" aria-hidden="true">${esc(r.icon)}</span>
          <b>${esc(r.name)}</b>
          <span class="phrase">${esc(ROLES_PHRASES[r.name] || '')}</span>
          <span class="coche" aria-hidden="true">${SVG.coche}</span>
        </button>`).join('');

      return `
        <p class="pc-surtitre">Ton rôle</p>
        <h2 class="pc-titre" tabindex="-1">Qu'est-ce qui te décrit le mieux ?</h2>
        <p class="pc-sous">Ton rôle s'affiche sur ton profil, à côté de ton pseudo. Tu pourras le changer plus tard.</p>
        <div class="pc-roles" role="group" aria-label="Ton rôle">${cartes}</div>
        <div class="pc-note vide" aria-live="polite"></div>
        <div class="form-msg" id="pc-msg" role="alert"></div>
        <div class="pc-actions">
          <button type="button" class="btn btn-primary" data-act="suivant">Continuer</button>
        </div>`;
    },

    monter(el){

      el.querySelector('.pc-roles').addEventListener('click', (ev) => {

        const carte = ev.target.closest('[data-role]');

        if(!carte) return;

        etat.role = carte.dataset.role;

        el.querySelectorAll('.pc-role').forEach(c => c.setAttribute('aria-pressed', String(c === carte)));

        // Le parcours s'allonge d'une étape pour les rôles qui peuvent être vérifiés.
        etat.suite = calculerSuite();
        majEntete(etat.nom);
        majNoteRole();
        dire('');
      });

      if(etat.role) majNoteRole();
    },

    async valider(){

      if(!etat.role){
        dire('Choisis le rôle qui te correspond pour continuer.');
        secouer(etat.racine.querySelector('.pc-roles'));
        return false;
      }

      // Un compte déjà créé (reprise) : le rôle change tout de suite, sur le profil.
      if(etat.reprise && roleNom(currentUser.role) !== etat.role){

        try{
          await saveCurrentProfile({ role: etat.role });
          currentUser.role = etat.role;
        }catch(erreur){
          dire('Enregistrement impossible : ' + erreur.message);
          return false;
        }

        refreshAccountUI();
      }

      return true;
    }
  };

  // ----- Compte --------------------------------------------------------

  function majForce(el){

    const f = forceMdp(el.querySelector('#pc-mdp').value);

    el.querySelector('.pc-force').dataset.n = String(f.n);
    el.querySelector('.pc-force-texte').textContent = f.texte;
  }

  ETAPES.compte = {

    html(){

      // Le compte existe déjà (le pseudo était pris au dernier moment) : il ne reste que le profil à écrire.
      if(etat.userId){
        return `
          <p class="pc-surtitre">Ton compte</p>
          <h2 class="pc-titre" tabindex="-1">Presque fini</h2>
          <p class="pc-sous">Ton adresse est déjà enregistrée. Il ne reste qu'à créer ton profil.</p>
          <div class="form-msg" id="pc-msg" role="alert"></div>
          <div class="pc-actions">
            <button type="button" class="btn btn-primary" data-act="suivant" data-focus>Créer mon profil</button>
          </div>`;
      }

      return `
        <p class="pc-surtitre">Ton compte</p>
        <h2 class="pc-titre" tabindex="-1">Crée ton compte</h2>
        <p class="pc-sous">Ton e-mail te sert à te connecter et à recevoir les réponses de l'équipe. Il n'est jamais public.</p>
        <form class="pc-form" novalidate autocomplete="on">
          <div class="field">
            <label for="pc-email">Adresse e-mail</label>
            <input type="email" id="pc-email" name="email" autocomplete="email" inputmode="email" maxlength="120"
                   autocapitalize="off" spellcheck="false" placeholder="toi@exemple.fr" data-focus>
          </div>
          <div class="field">
            <label for="pc-mdp">Mot de passe</label>
            <div class="pc-mdp">
              <input type="password" id="pc-mdp" name="new-password" autocomplete="new-password" maxlength="72" placeholder="8 caractères au minimum">
              <button type="button" class="pc-oeil" aria-label="Afficher le mot de passe" aria-pressed="false">${SVG.oeil}</button>
            </div>
            <div class="pc-force" data-n="0" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
            <p class="pc-force-texte" aria-live="polite">8 caractères au minimum.</p>
          </div>
          <p class="pc-rassure">${SVG.cadenas}<span>Ton mot de passe est chiffré : même l'équipe La Wave ne peut pas le lire.</span></p>
          <div class="form-msg" id="pc-msg" role="alert"></div>
          <div class="pc-actions">
            <button type="submit" class="btn btn-primary" data-act="suivant">Créer mon compte</button>
          </div>
        </form>`;
    },

    monter(el){

      if(etat.userId) return;

      const mail = el.querySelector('#pc-email');
      const mdp = el.querySelector('#pc-mdp');
      const oeil = el.querySelector('.pc-oeil');

      mail.value = etat.email;
      mdp.value = etat.mdp;
      majForce(el);

      mail.addEventListener('input', () => { etat.email = mail.value; mail.removeAttribute('aria-invalid'); dire(''); });

      mdp.addEventListener('input', () => { etat.mdp = mdp.value; mdp.removeAttribute('aria-invalid'); majForce(el); dire(''); });

      oeil.addEventListener('click', () => {
        const visible = mdp.type === 'password';
        mdp.type = visible ? 'text' : 'password';
        oeil.innerHTML = visible ? SVG.oeilBarre : SVG.oeil;
        oeil.setAttribute('aria-pressed', String(visible));
        oeil.setAttribute('aria-label', visible ? 'Masquer le mot de passe' : 'Afficher le mot de passe');
      });

      // Un navigateur remplit les champs sans qu'aucun événement ne parte : on relit tout à la validation.
      el.querySelector('.pc-form').addEventListener('submit', (ev) => { ev.preventDefault(); suivant(); });
    },

    async valider(){

      if(!etat.userId){

        const mail = etat.racine.querySelector('#pc-email');
        const mdp = etat.racine.querySelector('#pc-mdp');

        const email = mail.value.trim().toLowerCase();

        if(!email) return erreurChamp(mail, 'Renseigne ton adresse e-mail pour continuer.');

        if(!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)){
          return erreurChamp(mail, "Cette adresse e-mail n'a pas l'air valide.");
        }

        const force = forceMdp(mdp.value);

        if(force.insuffisant) return erreurChamp(mdp, force.erreur);

        etat.email = email;
        etat.mdp = mdp.value;
      }

      return creerCompte();
    }
  };

  function erreurChamp(champ, texte){

    champ.setAttribute('aria-invalid', 'true');
    champ.focus();
    secouer(champ.closest('.field'));
    dire(texte);

    return false;
  }

  // Ce que la base répond à un échec de création, dit en clair.
  function messageInscription(erreur){

    const texte = String(erreur && erreur.message || '').toLowerCase();
    const code = String(erreur && erreur.code || '').toLowerCase();

    if(code === 'user_already_exists' || texte.includes('already registered') || texte.includes('already been registered')){
      return { texte: 'Un compte existe déjà avec cet e-mail.', connexion: true, champ: '#pc-email' };
    }

    if(code === 'weak_password' || texte.includes('weak') || texte.includes('at least')){
      return { texte: 'Ce mot de passe est trop faible : allonge-le, ou mélange lettres, chiffres et symboles.', champ: '#pc-mdp' };
    }

    if(texte.includes('invalid') && texte.includes('email')){
      return { texte: "Cette adresse e-mail n'a pas l'air valide.", champ: '#pc-email' };
    }

    if(code.includes('rate_limit') || texte.includes('rate limit') || erreur.status === 429){
      return { texte: 'Trop de tentatives : patiente une minute, puis réessaie.' };
    }

    if(code === 'signup_disabled' || texte.includes('signups not allowed')){
      return { texte: "Les inscriptions sont fermées pour l'instant." };
    }

    if(texte.includes('failed to fetch') || texte.includes('network')){
      return { texte: 'Connexion impossible : vérifie ta connexion internet, puis réessaie.' };
    }

    return { texte: 'Création impossible : ' + (erreur.message || 'erreur inconnue') + '.' };
  }

  // Le compte, puis le profil, puis ce que le site doit savoir de la nouvelle connexion.
  async function creerCompte(){

    // 1. Le compte lui-même (mot de passe haché par Supabase), s'il n'existe pas encore.
    if(!etat.userId){

      let reponse;

      try{
        reponse = await Auth.inscrire(etat.email, etat.mdp, { pseudo: etat.pseudo, role: etat.role });
      }catch(erreur){
        reponse = { data: null, error: erreur };
      }

      if(reponse.error){

        const m = messageInscription(reponse.error);
        const champ = m.champ && etat.racine.querySelector(m.champ);

        if(champ) champ.setAttribute('aria-invalid', 'true');
        dire(m.texte);

        if(m.connexion){
          const msg = etat.racine.querySelector('#pc-msg');
          msg.insertAdjacentHTML('beforeend', ' <button type="button" class="pc-lien" data-act="connexion">Se connecter</button>');
        }

        return false;
      }

      const donnees = reponse.data || {};

      // Une adresse déjà inscrite, quand la confirmation par e-mail est exigée : le compte n'est pas recréé, et
      // la réponse n'a aucune identité. Sans cela, la personne attendrait un e-mail qui ne viendra pas.
      if(donnees.user && Array.isArray(donnees.user.identities) && donnees.user.identities.length === 0){
        dire('Un compte existe déjà avec cet e-mail.');
        etat.racine.querySelector('#pc-msg').insertAdjacentHTML('beforeend', ' <button type="button" class="pc-lien" data-act="connexion">Se connecter</button>');
        return false;
      }

      // La confirmation par e-mail est exigée : pas encore de session, donc pas de profil. Il naîtra à la première
      // connexion (ensureProfileExists reprend le pseudo et le rôle d'ici), et ce parcours reprendra alors.
      if(!donnees.session){
        etat.mdp = '';
        await montrerConfirmation();
        return false;
      }

      etat.userId = donnees.user.id;
    }

    // 2. Le profil public associé.
    let profil = null;

    try{
      profil = await fetchProfile(etat.userId);
    }catch(erreur){ /* la ligne n'existe pas encore */ }

    if(!profil){

      const { error } = await BD.creerProfil({
        id: etat.userId,
        pseudo: etat.pseudo,
        role: etat.role,
        socials: { instagram: '', twitter: '', tiktok: '', spotify: '', appleMusic: '', deezer: '' },
        xp: 0,
        challenges: { date: todayStr(), postForum: false, commentForum: false, instaComment: false },
        onboarding: { parcours: 'en_cours' }
      });

      if(error){

        const detail = String(error.message || '') + ' ' + String(error.details || '');
        const doublon = error.code === '23505' || /duplicate|unique/i.test(detail);

        // Le pseudo vient d'être pris par quelqu'un d'autre : on retourne le choisir, le compte reste.
        if(doublon && /pseudo/i.test(detail)){
          etat.pseudoEtat = 'pris';
          await afficher('pseudo', -1);
          afficherStatut('non', "Ce pseudo vient d'être pris : choisis-en un autre.");
          return false;
        }

        if(!doublon){
          dire("Ton compte est créé, mais ton profil n'a pas pu l'être : " + error.message + ' Réessaie.');
          return false;
        }
      }

      profil = await fetchProfile(etat.userId);
    }

    if(!profil){
      dire("Ton compte est créé, mais ton profil est introuvable : réessaie dans un instant.");
      return false;
    }

    // 3. Le site sait maintenant qui est là.
    ensureDailyChallenges(profil);
    currentUser = profil;
    emailDuCompte = etat.email;
    etat.mdp = '';
    etat.compteExiste = true;
    etat.plancher = 'photo';

    refreshAccountUI();
    preremplirContacts();

    // La bienvenue des visiteurs n'a plus lieu d'être.
    document.querySelectorAll('#notifZone .notif.invitation').forEach(n => n.remove());
    if(typeof fermerBienvenue === 'function') fermerBienvenue();

    // Le catalogue se prépare pendant que la photo se choisit.
    preparerCatalogue().catch(() => {});

    // Un instant de satisfaction, puis la suite.
    const bouton = etat.racine.querySelector('.pc-actions .btn');

    if(bouton && !sansMouvement()){
      bouton.classList.remove('charge');
      bouton.classList.add('succes');
      bouton.innerHTML = SVG.coche.replace('<svg ', '<svg width="18" height="18" ') + ' Compte créé';
      await pause(650);
    }

    return true;
  }

  // Compte créé, e-mail à confirmer.
  const confirmation = {

    classe: 'fin',

    html(){
      return `
        <div class="pc-anneau"><span class="halo"></span>
          <svg viewBox="0 0 128 128" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true">
            <circle cx="64" cy="64" r="50"/>
            <g transform="translate(40 40) scale(2)" stroke-width="1.6">${SVG.enveloppe.replace(/<svg[^>]*>|<\/svg>/g, '')}</g>
          </svg>
        </div>
        <h2 class="pc-titre" tabindex="-1">Vérifie tes e-mails</h2>
        <p class="pc-sous">On a envoyé un lien à <b>${esc(etat.email)}</b>. Clique dessus, puis connecte-toi : ton parcours reprendra
          là où tu l'as laissé, avec ton pseudo et ton rôle déjà choisis.</p>
        <div class="pc-actions">
          <button type="button" class="btn btn-primary" data-act="connexion" data-focus>Se connecter</button>
          <button type="button" class="btn btn-ghost" data-act="fermer-net">Fermer</button>
        </div>`;
    }
  };

  async function montrerConfirmation(){
    ETAPES.confirmation = confirmation;
    await afficher('confirmation', 1);
  }

  // ----- Photo ---------------------------------------------------------

  function photoInterieur(apercu){

    const initiale = esc(artistInitial(etat.pseudo || (currentUser && currentUser.pseudo) || '?'));

    return (apercu
      ? `<img src="${attr(apercu)}" alt="Ta photo de profil">`
      : `<span class="initiale" aria-hidden="true">${initiale}</span>`) +
      `<span class="plus" aria-hidden="true">${SVG.camera}</span>`;
  }

  function majPhoto(){

    const bouton = etat.racine && etat.racine.querySelector('#pc-photo');

    if(!bouton) return;

    const apercu = etat.apercu || etat.avatarUrl;

    bouton.classList.toggle('pleine', !!apercu);
    bouton.innerHTML = photoInterieur(apercu);

    const suite = etat.racine.querySelector('#pc-suite');

    suite.classList.toggle('btn-primary', !!apercu);
    suite.classList.toggle('btn-ghost', !apercu);
    suite.textContent = apercu ? 'Continuer' : "Passer pour l'instant";
  }

  function choisirPhoto(fichier){

    if(!fichier) return;

    if(!Fichiers.TYPES_ACCEPTES.includes(fichier.type)){
      dire("Une image JPG, PNG ou WEBP, s'il te plaît (pas de GIF ni de vidéo).");
      return;
    }

    if(fichier.size > 60 * 1024 * 1024){
      dire('Cette image est trop lourde (60 Mo au plus).');
      return;
    }

    dire('');

    const lecteur = new FileReader();

    lecteur.onload = () => openCropModal(lecteur.result, 'parcours-avatar');
    lecteur.onerror = () => dire("Cette image n'a pas pu être lue : essaie-en une autre.");

    lecteur.readAsDataURL(fichier);
  }

  // Appelé par le recadrage du site (cible « parcours-avatar ») quand la photo est validée.
  function avatarRecadre(dataUrl){

    if(!etat) return;

    etat.avatarDataUrl = dataUrl;
    etat.apercu = dataUrl;

    if(etat.nom === 'photo') majPhoto();
  }

  ETAPES.photo = {

    html(){

      const apercu = etat.apercu || etat.avatarUrl;

      return `
        <p class="pc-surtitre">${etat.compteExiste && !etat.reprise ? 'Compte créé ✓' : 'Ta photo'}</p>
        <h2 class="pc-titre" tabindex="-1">Ajoute une photo</h2>
        <p class="pc-sous">Un visage, un logo, une pochette : ce qui te rend reconnaissable. Tu pourras la changer à tout moment.</p>
        <button type="button" class="pc-photo${apercu ? ' pleine' : ''}" id="pc-photo" aria-label="Choisir une photo de profil">
          ${photoInterieur(apercu)}
        </button>
        <input type="file" id="pc-fichier" accept="image/png,image/jpeg,image/webp" hidden>
        <p class="pc-astuce">JPG, PNG ou WEBP · touche le cercle, ou glisse une image dessus</p>
        <div class="form-msg" id="pc-msg" role="alert"></div>
        <div class="pc-actions">
          <button type="button" class="btn ${apercu ? 'btn-primary' : 'btn-ghost'}" id="pc-suite" data-act="suivant" data-focus>${apercu ? 'Continuer' : "Passer pour l'instant"}</button>
        </div>`;
    },

    monter(el){

      const rond = el.querySelector('#pc-photo');
      const entree = el.querySelector('#pc-fichier');

      rond.addEventListener('click', () => entree.click());
      entree.addEventListener('change', () => { choisirPhoto(entree.files[0]); entree.value = ''; });

      rond.addEventListener('dragover', (ev) => { ev.preventDefault(); rond.classList.add('survol'); });
      rond.addEventListener('dragleave', () => rond.classList.remove('survol'));
      rond.addEventListener('drop', (ev) => {
        ev.preventDefault();
        rond.classList.remove('survol');
        choisirPhoto(ev.dataTransfer && ev.dataTransfer.files[0]);
      });
    },

    async valider(){

      if(!etat.avatarDataUrl) return true;

      try{
        const url = await uploadCoverDataUrl(etat.avatarDataUrl, 'avatar', etat.pseudo);

        await saveCurrentProfile({ avatar_url: url });

        currentUser.avatar = url;
        etat.avatarUrl = url;
        etat.avatarDataUrl = null;

        refreshAccountUI();

      }catch(erreur){
        dire(erreur.message || "L'envoi de la photo a échoué : réessaie, ou passe cette étape.");
        return false;
      }

      return true;
    }
  };

  // ----- Profil : bio, ville, réseaux ----------------------------------

  ETAPES.profil = {

    html(){

      const phrases = BIOS[etat.role] || BIOS['Autre'];
      const photographe = etat.role === 'Photographe';

      return `
        <p class="pc-surtitre">Ta présentation</p>
        <h2 class="pc-titre" tabindex="-1">Parle-nous de toi</h2>
        <p class="pc-sous">Une ou deux phrases suffisent : c'est ce que l'on lit en premier sur ton profil.</p>
        <div class="field">
          <label for="pc-bio">Ta bio <small>facultatif</small></label>
          <textarea id="pc-bio" rows="3" maxlength="280" placeholder="${attr(phrases[0])}" data-focus>${esc(etat.bio)}</textarea>
          <div class="pc-compteur-bio" id="pc-bio-compte" aria-hidden="true">0 / 280</div>
          <div class="pc-puces" style="margin-top:10px">
            ${phrases.map(p => `<button type="button" class="pc-puce" data-bio="${attr(p)}">${esc(p)}</button>`).join('')}
          </div>
        </div>
        <div class="field">
          <label for="pc-ville">Ta ville ou ta région <small>facultatif</small></label>
          <input type="text" id="pc-ville" maxlength="60" value="${attr(etat.ville)}" placeholder="Paris, Lyon, Bruxelles…" autocomplete="off">
        </div>
        <div class="field">
          <label for="pc-insta">Ton Instagram <small>facultatif</small></label>
          <input type="text" id="pc-insta" maxlength="120" value="${attr(etat.instagram)}" placeholder="@ton.instagram" autocomplete="off" autocapitalize="off" spellcheck="false">
        </div>
        ${photographe ? `
        <div class="field">
          <label for="pc-portfolio">Ton portfolio <small>facultatif</small></label>
          <input type="text" id="pc-portfolio" maxlength="160" value="${attr(etat.portfolio)}" placeholder="ton-site.fr" autocomplete="off" autocapitalize="off" spellcheck="false">
        </div>` : ''}
        <div class="form-msg" id="pc-msg" role="alert"></div>
        <div class="pc-actions">
          <button type="button" class="btn btn-primary" data-act="suivant">Continuer</button>
          <button type="button" class="pc-lien" data-act="passer">Passer</button>
        </div>`;
    },

    monter(el){

      const bio = el.querySelector('#pc-bio');
      const compte = el.querySelector('#pc-bio-compte');

      const majCompte = () => { compte.textContent = bio.value.length + ' / 280'; };

      bio.addEventListener('input', () => { etat.bio = bio.value; majCompte(); });
      majCompte();

      el.querySelectorAll('[data-bio]').forEach(puce => puce.addEventListener('click', () => {
        bio.value = bio.value.trim() ? bio.value.trim() + ' ' + puce.dataset.bio : puce.dataset.bio;
        bio.value = bio.value.slice(0, 280);
        etat.bio = bio.value;
        majCompte();
        bio.focus();
      }));

      el.querySelector('#pc-ville').addEventListener('input', (ev) => { etat.ville = ev.target.value; });
      el.querySelector('#pc-insta').addEventListener('input', (ev) => { etat.instagram = ev.target.value; });

      const portfolio = el.querySelector('#pc-portfolio');
      if(portfolio) portfolio.addEventListener('input', () => { etat.portfolio = portfolio.value; });
    },

    async valider(){

      const bio = etat.bio.trim();
      const socials = Object.assign({}, currentUser.socials || {});

      socials.instagram = normaliserInstagram(etat.instagram);

      if(etat.role === 'Photographe') socials.portfolio = normaliserPortfolio(etat.portfolio);

      try{
        await saveCurrentProfile({ bio, socials });
        currentUser.bio = bio;
        currentUser.socials = socials;
      }catch(erreur){
        dire('Enregistrement impossible : ' + erreur.message);
        return false;
      }

      await enregistrerUnivers();

      return true;
    }
  };

  // La ville, ce que l'on cherche et propose, les styles : une seule écriture, la même fonction que la
  // communauté. Absente (communaute.sql pas passé) ou en échec : le parcours continue, ce n'est pas vital.
  async function enregistrerUnivers(){

    if(!etat.ville.trim() && !etat.cherche.length && !etat.propose.length && !etat.genres.length) return;

    try{
      const { error } = await supabaseClient.rpc('com_maj_profil', {
        p_ville: etat.ville.trim() || null,
        p_cherche: etat.cherche,
        p_propose: etat.propose,
        p_genres: etat.genres
      });

      if(error) console.warn("⚠️ L'univers du profil n'a pas été enregistré :", error.message);

    }catch(erreur){
      console.warn("⚠️ L'univers du profil n'a pas été enregistré :", erreur.message);
    }
  }

  // ----- Univers : styles, je cherche, je propose ----------------------

  function puceHtml(texte, actif, data, icone, desactivee){
    return `<button type="button" class="pc-puce" ${data} aria-pressed="${actif}"${desactivee ? ' aria-disabled="true"' : ''}>` +
           (icone ? `<span class="ic" aria-hidden="true">${esc(icone)}</span>` : '') + esc(texte) + `</button>`;
  }

  function dessinerGenres(){

    const zone = etat.racine && etat.racine.querySelector('[data-zone="genres"]');

    if(!zone) return;

    const tous = GENRES.concat(etat.genres.filter(g => !GENRES.some(x => x.toLowerCase() === g.toLowerCase())));
    const plein = etat.genres.length >= MAX_GENRES;

    zone.innerHTML = tous.map(g => {
      const actif = etat.genres.some(x => x.toLowerCase() === g.toLowerCase());
      return puceHtml(g, actif, `data-genre="${attr(g)}"`, '', plein && !actif);
    }).join('');
  }

  function ajouterGenre(valeur){

    const g = String(valeur || '').replace(/[,;]+/g, ' ').trim().slice(0, 24);

    if(g.length < 2) return false;

    if(etat.genres.some(x => x.toLowerCase() === g.toLowerCase())) return true;

    if(etat.genres.length >= MAX_GENRES) return false;

    etat.genres.push(g);
    dessinerGenres();

    return true;
  }

  function dessinerMetiers(){

    const racine = etat.racine;

    if(!racine) return;

    const bloc = racine.querySelector('[data-zone="metiers"]');

    if(!bloc) return;

    if(!etat.referentiel || !etat.referentiel.length){
      bloc.hidden = true;
      return;
    }

    bloc.hidden = false;

    ['cherche', 'propose'].forEach(liste => {

      const zone = racine.querySelector(`[data-zone="${liste}"]`);

      if(!zone) return;

      zone.innerHTML = etat.referentiel.map(m => {
        const actif = etat[liste].includes(m.cle);
        return puceHtml(m.libelle, actif, `data-metier="${attr(m.cle)}" data-liste="${liste}"`, m.icone, etat[liste].length >= MAX_METIERS && !actif);
      }).join('');
    });
  }

  async function chargerReferentiel(){

    if(etat.referentielPromesse) return etat.referentielPromesse;

    etat.referentielPromesse = (async () => {

      try{
        const { data, error } = await supabaseClient.rpc('com_referentiel');

        if(!error && data && Array.isArray(data.metiers)) etat.referentiel = data.metiers;
        else etat.referentiel = [];

      }catch(erreur){
        etat.referentiel = [];
      }
    })();

    return etat.referentielPromesse;
  }

  ETAPES.univers = {

    entree: false,

    html(){
      return `
        <p class="pc-surtitre">Ton univers</p>
        <h2 class="pc-titre" tabindex="-1">Qu'est-ce que tu écoutes ?</h2>
        <p class="pc-sous">Ces choix aident la communauté à te trouver, et te suggèrent des gens proches de toi. Tout est facultatif.</p>
        <fieldset class="pc-bloc">
          <legend>Tes styles <small>${MAX_GENRES} au plus</small></legend>
          <div class="pc-puces" data-zone="genres"></div>
          <div class="field">
            <input type="text" id="pc-genre" maxlength="24" placeholder="Un autre style ? Tape-le, puis Entrée" autocomplete="off" aria-label="Ajouter un style">
          </div>
        </fieldset>
        <div data-zone="metiers" hidden>
          <fieldset class="pc-bloc">
            <legend>Je cherche <small>${MAX_METIERS} au plus</small></legend>
            <div class="pc-puces" data-zone="cherche"></div>
          </fieldset>
          <fieldset class="pc-bloc">
            <legend>Je propose <small>${MAX_METIERS} au plus</small></legend>
            <div class="pc-puces" data-zone="propose"></div>
          </fieldset>
        </div>
        <div class="form-msg" id="pc-msg" role="alert"></div>
        <div class="pc-actions">
          <button type="button" class="btn btn-primary" data-act="suivant">Continuer</button>
          <button type="button" class="pc-lien" data-act="passer">Passer</button>
        </div>`;
    },

    monter(el){

      dessinerGenres();

      chargerReferentiel().then(() => { if(etat && etat.racine === el) dessinerMetiers(); });

      const champ = el.querySelector('#pc-genre');

      champ.addEventListener('keydown', (ev) => {

        if(ev.key !== 'Enter' && ev.key !== ',') return;

        ev.preventDefault();

        if(ajouterGenre(champ.value)) champ.value = '';
        else if(etat.genres.length >= MAX_GENRES) dire(MAX_GENRES + ' styles au maximum : retire-en un pour en ajouter un autre.');
      });

      el.addEventListener('click', (ev) => {

        const genre = ev.target.closest('[data-genre]');

        if(genre){

          const nom = genre.dataset.genre;
          const i = etat.genres.findIndex(x => x.toLowerCase() === nom.toLowerCase());

          if(i >= 0) etat.genres.splice(i, 1);
          else if(etat.genres.length < MAX_GENRES) etat.genres.push(nom);
          else { dire(MAX_GENRES + ' styles au maximum : retire-en un pour en ajouter un autre.'); return; }

          dire('');
          dessinerGenres();
          return;
        }

        const metier = ev.target.closest('[data-metier]');

        if(metier){

          const liste = etat[metier.dataset.liste];
          const cle = metier.dataset.metier;
          const i = liste.indexOf(cle);

          if(i >= 0) liste.splice(i, 1);
          else if(liste.length < MAX_METIERS) liste.push(cle);
          else return;

          dessinerMetiers();
        }
      });
    },

    async valider(){

      // Un style tapé mais pas validé par Entrée compte quand même.
      const champ = etat.racine.querySelector('#pc-genre');
      if(champ && champ.value.trim()) ajouterGenre(champ.value);

      await enregistrerUnivers();

      return true;
    }
  };

  // ----- Sorties : le catalogue, à enregistrer -------------------------

  async function preparerCatalogue(){

    if(etat) etat.catalogue = 'attente';

    try{
      // Le catalogue (avec les photos d'artistes et les notes) si l'accueil ne l'a pas déjà chargé, sinon seulement
      // les notes : celles de ce membre sont ce qui dit quelles sorties il a déjà enregistrées.
      if(!catalogueData.length) await renderCatalogue();
      else await chargerNotes();

      if(!catalogueData.length) throw new Error('Catalogue vide');

      if(etat) etat.catalogue = 'ok';

    }catch(erreur){
      if(etat) etat.catalogue = 'erreur';
      throw erreur;
    }
  }

  function estEnregistree(id){

    const note = maNoteSur(id);

    return !!(note && note.saved);
  }

  function nombreEnregistrees(){

    if(!currentUser) return 0;

    return toutesLesNotes.filter(n => n.user_id === currentUser.id && n.saved).length;
  }

  function tuileHtml(sortie, k){

    const enregistree = estEnregistree(sortie.id);
    const cover = safeUrl(sortie.cover);

    return `
      <button type="button" class="pc-sortie" style="--k:${k % 14}" data-id="${attr(sortie.id)}" aria-pressed="${enregistree}"
              aria-label="${attr(sortie.title + ' — ' + sortie.artist)}">
        <span class="pc-pochette">
          ${cover ? `<img src="${attr(cover)}" alt="" loading="lazy" decoding="async">` : ''}
          <span class="pc-ajout" aria-hidden="true">${SVG.plus}${SVG.coche}</span>
        </span>
        <span class="nom">${esc(sortie.title)}</span>
        <span class="artiste">${esc(sortie.artist)}</span>
      </button>`;
  }

  function sortiesTrouvees(){

    const q = texteNu(etat.recherche.trim());

    if(!q) return catalogueTrie;

    return catalogueTrie.filter(s =>
      texteNu(s.title).includes(q) ||
      texteNu(s.artist).includes(q) ||
      (s.featuring || []).some(f => texteNu(f.nom).includes(q))
    );
  }

  function majCompteurSorties(saute){

    const zone = etat.racine && etat.racine.querySelector('#pc-compteur');

    if(!zone) return;

    const n = nombreEnregistrees();

    zone.textContent = n === 0 ? 'Aucune sortie pour l’instant' : n + (n > 1 ? ' sorties' : ' sortie') + ' dans ta collection';
    zone.classList.toggle('plein', n > 0);

    if(saute){
      zone.classList.remove('saute');
      void zone.offsetWidth;
      zone.classList.add('saute');
    }

    const bouton = etat.racine.querySelector('#pc-suite');

    if(bouton){
      bouton.textContent = n ? 'Continuer' : 'Passer cette étape';
      bouton.classList.toggle('btn-primary', n > 0);
      bouton.classList.toggle('btn-ghost', n === 0);
    }
  }

  function dessinerSorties(){

    const racine = etat.racine;

    if(!racine) return;

    const grille = racine.querySelector('#pc-grille');
    const titre = racine.querySelector('#pc-sorties-titre');
    const reste = racine.querySelector('#pc-reste');

    if(etat.catalogue === 'attente'){
      grille.innerHTML = '<p class="pc-vide">Chargement du catalogue…</p>';
      reste.innerHTML = '';
      return;
    }

    if(etat.catalogue === 'erreur'){
      grille.innerHTML = '<p class="pc-vide">Le catalogue ne s\'est pas chargé. <button type="button" class="pc-lien" data-act="recharger-catalogue">Réessayer</button></p>';
      reste.innerHTML = '';
      return;
    }

    const trouvees = sortiesTrouvees();
    const visibles = trouvees.slice(0, etat.sortiesVisibles);
    const recherche = !!etat.recherche.trim();

    titre.textContent = recherche
      ? trouvees.length + (trouvees.length > 1 ? ' résultats' : ' résultat')
      : 'Les dernières sorties du catalogue';

    grille.innerHTML = visibles.length
      ? visibles.map(tuileHtml).join('')
      : `<p class="pc-vide">Aucune sortie ne correspond à « ${esc(etat.recherche.trim())} ». Essaie avec un titre ou un artiste.</p>`;

    reste.innerHTML = trouvees.length > visibles.length
      ? `<button type="button" class="btn btn-ghost" data-act="plus-sorties">Voir plus de sorties</button>`
      : '';
  }

  // Un clic sur une pochette : enregistrée ou retirée, aussitôt à l'écran, puis confirmée par la base.
  async function basculerSortie(bouton){

    const id = bouton.dataset.id;

    if(bouton.dataset.occupe) return;

    const avant = estEnregistree(id);
    const voulu = !avant;

    // Une sortie déjà notée ou commentée ne se retire pas d'un clic de pochette : sa note et son avis partiraient avec.
    if(avant){
      const e = etatSortie(id);
      if(e.note || e.avis || e.favori){
        notifier('Cette sortie a une note ou un avis', { detail: 'Retire-la depuis sa fiche.' });
        return;
      }
    }

    bouton.dataset.occupe = '1';
    bouton.setAttribute('aria-pressed', String(voulu));

    try{
      await enregistrerMaNote(id, { saved: voulu });

      // enregistrerMaNote avale ses erreurs : l'état réel est ce que la base a gardé.
      if(estEnregistree(id) !== voulu) throw new Error('refusé');

      if(voulu && typeof awardXP === 'function') awardXP('enregistrerSortie', 5);

    }catch(erreur){
      bouton.setAttribute('aria-pressed', String(estEnregistree(id)));
      notifier("Impossible d'enregistrer cette sortie", { type: 'erreur', detail: 'Réessaie dans un instant.' });
    }finally{
      delete bouton.dataset.occupe;
    }

    if(etat) majCompteurSorties(true);
  }

  ETAPES.sorties = {

    large: true,
    entree: false,

    html(){
      return `
        <p class="pc-surtitre">Ta collection</p>
        <h2 class="pc-titre" tabindex="-1">Qu'est-ce que tu as écouté ?</h2>
        <p class="pc-sous">Touche les pochettes des sorties que tu connais ou que tu aimes : elles rejoignent ta collection. Cherche-en d'autres si tu ne les vois pas.</p>
        <div class="field pc-recherche">
          ${SVG.loupe}
          <input type="text" id="pc-recherche" placeholder="Un titre, un artiste…" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Chercher une sortie" data-focus>
        </div>
        <div class="pc-sorties-tete">
          <span id="pc-sorties-titre">Les dernières sorties du catalogue</span>
          <span class="pc-compteur" id="pc-compteur" aria-live="polite"></span>
        </div>
        <div class="pc-grille" id="pc-grille"></div>
        <div class="pc-plus-sorties" id="pc-reste"></div>
        <div class="form-msg" id="pc-msg" role="alert"></div>
        <div class="pc-actions">
          <button type="button" class="btn btn-ghost" id="pc-suite" data-act="suivant">Passer cette étape</button>
        </div>`;
    },

    monter(el){

      etat.recherche = '';
      etat.sortiesVisibles = 24;

      // Le catalogue n'est pas encore là (compte créé à l'instant, ou reprise) : on l'attend.
      if(etat.catalogue !== 'ok'){
        preparerCatalogue().then(() => {}, () => {}).then(() => {
          if(etat && etat.racine === el){ majCompteurSorties(false); dessinerSorties(); }
        });
      }

      majCompteurSorties(false);
      dessinerSorties();

      const champ = el.querySelector('#pc-recherche');
      let minuteur = null;

      champ.addEventListener('input', () => {
        clearTimeout(minuteur);
        minuteur = setTimeout(() => {
          etat.recherche = champ.value;
          etat.sortiesVisibles = 24;
          dessinerSorties();
        }, 140);
      });

      el.querySelector('#pc-grille').addEventListener('click', (ev) => {
        const tuile = ev.target.closest('.pc-sortie');
        if(tuile) basculerSortie(tuile);
      });
    }
  };

  // ----- Vérification --------------------------------------------------

  ETAPES.verification = {

    entree: false,

    html(){

      const role = etat.role;

      return `
        <p class="pc-surtitre">Profil vérifié</p>
        <h2 class="pc-titre" tabindex="-1">Prouve que tu es ${esc(role)}</h2>
        <p class="pc-sous">Une capture, validée par l'équipe : ton profil reçoit le badge « Profil vérifié ».
          ${role === 'Photographe' ? " Il est nécessaire pour t'inscrire aux accréditations photo." : ''}
          Tu peux aussi le faire plus tard, depuis ton profil.</p>
        <div class="pc-verif" id="pc-verif"></div>`;
    },

    async monter(el){

      const zone = el.querySelector('#pc-verif');

      try{
        await chargerVerification();
      }catch(erreur){
        zone.innerHTML = `<div class="form-msg err">${esc(erreur.message)}</div>
          <div class="pc-actions"><button type="button" class="btn btn-ghost" data-act="passer">Continuer sans</button></div>`;
        return;
      }

      if(!etat || etat.racine !== el) return;

      const suivante = () => { if(etat && etat.nom === 'verification') aller(etat.suite[etat.index + 1], 1); };

      etat.verifControleur = await window.Verification.monter(zone, {
        compact: true,
        surEnvoye: () => { etat.verifEnvoyee = true; suivante(); },
        surPlusTard: suivante,
        surFermer: suivante
      });
    },

    quitter(){

      if(etat && etat.verifControleur){
        etat.verifControleur.nettoyer();
        etat.verifControleur = null;
      }
    }
  };

  // ----- Fin -----------------------------------------------------------

  ETAPES.fin = {

    classe: 'fin',
    entree: false,

    html(){

      const n = nombreEnregistrees();
      const photo = !!(etat.avatarUrl || (currentUser && currentUser.avatar));
      const bio = !!(currentUser && currentUser.bio && currentUser.bio.trim());
      const verifiable = roleAVerifier(etat.role) && verificationExigee;

      // Ce qui est fait se montre ; ce qui reste tient en une ligne discrète, sans rien reprocher.
      const lignes = [
        { ok: true, texte: 'Compte créé', detail: '@' + (currentUser ? currentUser.pseudo : etat.pseudo) + ' · ' + etat.role }
      ];

      const restant = [];

      if(photo) lignes.push({ ok: true, texte: 'Photo ajoutée' });
      else restant.push('une photo');

      if(bio) lignes.push({ ok: true, texte: 'Bio ajoutée' });
      else restant.push('ta bio');

      if(n > 0) lignes.push({ ok: true, texte: n + (n > 1 ? ' sorties' : ' sortie') + ' dans ta collection' });
      else restant.push('tes premières sorties');

      if(verifiable){
        if(etat.verifEnvoyee) lignes.push({ ok: true, attente: true, texte: 'Vérification envoyée', detail: "L'équipe regarde ta capture : tu seras prévenu." });
        else restant.push('la vérification de ton profil');
      }

      const suite = restant.length
        ? `<p class="pc-reste-a-faire">Plus tard, depuis ton profil : ${esc(restant.join(', ').replace(/, ([^,]*)$/, ' et $1'))}.</p>`
        : '';

      return `
        <div class="pc-anneau"><span class="halo"></span>
          <svg viewBox="0 0 128 128" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="64" cy="64" r="50" transform="rotate(-90 64 64)"/>
            <path d="m42 65 16 16 28-31" stroke-width="4.6"/>
          </svg>
        </div>
        <h2 class="pc-titre" tabindex="-1">Bienvenue, ${esc(currentUser ? currentUser.pseudo : etat.pseudo)} !</h2>
        <p class="pc-sous">Ton profil est prêt. Voilà où tu en es.</p>
        <ul class="pc-recap">
          ${lignes.map((l, k) => `
            <li class="${l.attente ? 'attente' : ''}" style="--k:${k}">
              <span class="pastille">${l.attente ? '⏳' : SVG.coche}</span>
              <span>${esc(l.texte)}${l.detail ? `<small>${esc(l.detail)}</small>` : ''}</span>
            </li>`).join('')}
        </ul>
        ${suite}
        <div class="pc-actions">
          <button type="button" class="btn btn-primary" data-act="communaute" data-focus>Découvrir la communauté</button>
          <button type="button" class="btn btn-ghost" data-act="profil">Voir mon profil</button>
        </div>`;
    },

    async monter(el){

      // Quelques éclats autour du rond, une fois : le moment mérite un peu de lumière.
      if(!sansMouvement()){

        const anneau = el.querySelector('.pc-anneau');
        const couleurs = ['#4fb4ff', '#1489de', '#8fe3ab', '#e9c46a', '#ffffff'];

        for(let i = 0; i < 16; i++){
          const angle = (i / 16) * Math.PI * 2 + (i % 2 ? 0.2 : 0);
          const distance = 78 + (i % 3) * 18;
          const eclat = document.createElement('span');
          eclat.className = 'pc-eclat';
          eclat.style.setProperty('--x', Math.round(Math.cos(angle) * distance) + 'px');
          eclat.style.setProperty('--y', Math.round(Math.sin(angle) * distance) + 'px');
          eclat.style.setProperty('--c', couleurs[i % couleurs.length]);
          eclat.style.setProperty('--d', (0.85 + (i % 4) * 0.06) + 's');
          anneau.appendChild(eclat);
        }
      }

      // Le parcours est fini : le profil le dit, et les premiers gains d'XP (photo, bio, réseaux) sont comptés.
      if(currentUser){

        currentUser.onboarding = Object.assign({}, currentUser.onboarding, { parcours: 'fait' });

        try{
          await checkOnboarding();
          await saveCurrentProfile({ onboarding: currentUser.onboarding });
        }catch(erreur){
          console.warn("⚠️ Fin du parcours non enregistrée :", erreur.message);
        }

        refreshAccountUI();
        if(typeof majCarteXpProfil === 'function') majCarteXpProfil();
        if(typeof rendreCarteVerification === 'function') rendreCarteVerification();
      }
    }
  };

  // ---------------------------------------------------------------------
  // Le moteur : afficher, avancer, reculer
  // ---------------------------------------------------------------------

  function dire(texte, ok){

    const zone = etat && etat.racine && etat.racine.querySelector('#pc-msg');

    if(!zone) return;

    zone.textContent = texte || '';
    zone.className = texte ? 'form-msg ' + (ok ? 'ok' : 'err') : 'form-msg';
  }

  function secouer(element){

    if(!element) return;

    element.classList.remove('pc-secoue');
    void element.offsetWidth;
    element.classList.add('pc-secoue');
  }

  function majEntete(nom){

    const comptees = etat.suite.filter(n => n !== 'bienvenue' && n !== 'fin');
    const position = comptees.indexOf(nom) + 1;

    let part = 0;

    if(nom === 'fin') part = 1;
    else if(nom === 'confirmation') part = comptees.indexOf('compte') >= 0 ? (comptees.indexOf('compte') + 1) / (comptees.length + 1) : 0;
    else if(position > 0) part = position / (comptees.length + 1);

    ouvert.barre.style.width = Math.round(part * 100) + '%';
    ouvert.texte.textContent = position > 0 ? 'Étape ' + position + ' sur ' + comptees.length : (nom === 'confirmation' ? 'Presque fini' : '');

    const peutReculer = nom === 'confirmation' || (etat.index > indexPlancher() && nom !== 'fin');

    ouvert.retour.classList.toggle('cache', !peutReculer);
  }

  function monterEtape(nom, sens){

    const def = ETAPES[nom];
    const el = document.createElement('div');

    el.className = 'pc-etape' + (def.large ? ' large' : '') + (def.classe ? ' ' + def.classe : '');
    el.dataset.etape = nom;
    el.innerHTML = def.html();

    Array.from(el.children).forEach((enfant, i) => enfant.style.setProperty('--i', i));

    ouvert.scene.replaceChildren(el);
    ouvert.scene.scrollTop = 0;

    // L'étape change de hauteur quand son contenu change : on regarde ce qu'elle occupe.
    if(ouvert.observeur){
      ouvert.observeur.disconnect();
      ouvert.observeur.observe(ouvert.scene);
      ouvert.observeur.observe(el);
    }

    etat.racine = el;

    if(def.monter) def.monter(el);

    const premier = el.querySelector('[data-focus]') || el.querySelector('.pc-titre');

    if(premier) setTimeout(() => { if(etat && etat.racine === el) premier.focus({ preventScroll: true }); }, 140);
  }

  async function afficher(nom, sens){

    const courant = etat;

    if(!nom || !ETAPES[nom]) return;

    const ancienne = courant.racine;

    if(ancienne){

      const def = ETAPES[courant.nom];

      if(def && def.quitter) def.quitter();

      if(!sansMouvement()){
        ancienne.style.setProperty('--dx-sortie', (-26 * sens) + 'px');
        ancienne.classList.add('sort');
        await pause(190);
        if(etat !== courant) return;
      }
    }

    courant.nom = nom;
    courant.index = courant.suite.indexOf(nom);

    majEntete(nom);
    monterEtape(nom, sens);
  }

  async function suivant(){

    if(!etat || etat.occupe) return;

    const nom = etat.nom;
    const def = ETAPES[nom];
    const bouton = etat.racine.querySelector('.pc-actions .btn-primary, .pc-actions .btn[data-act="suivant"]');

    etat.occupe = true;
    if(bouton) bouton.classList.add('charge');

    const courant = etat;

    try{

      const reste = def.valider ? await def.valider() : true;

      if(etat !== courant) return;

      if(reste !== false){
        await afficher(etat.suite[etat.index + 1], 1);
      }

    }catch(erreur){

      console.warn('⚠️ Parcours :', erreur);
      dire(erreur && erreur.message ? erreur.message : 'Une erreur est survenue : réessaie.');

    }finally{

      if(etat === courant){
        courant.occupe = false;
        const b = courant.racine && courant.racine.querySelector('.btn.charge');
        if(b) b.classList.remove('charge');
      }
    }
  }

  // Changer d'étape sans rien valider : pendant le changement, un second clic n'a pas d'effet.
  async function aller(nom, sens){

    if(!etat || etat.occupe) return;

    const courant = etat;

    courant.occupe = true;

    try{
      await afficher(nom, sens);
    }finally{
      if(etat === courant) courant.occupe = false;
    }
  }

  function passer(){

    if(!etat) return;

    aller(etat.suite[etat.index + 1], 1);
  }

  function reculer(){

    if(!etat) return;

    if(etat.nom === 'confirmation'){
      aller('compte', -1);
      return;
    }

    if(etat.index <= indexPlancher()) return;

    aller(etat.suite[etat.index - 1], -1);
  }

  // ---------------------------------------------------------------------
  // Quitter
  // ---------------------------------------------------------------------

  function fermerConfirmation(){

    if(!ouvert || !ouvert.confirmation) return;

    ouvert.confirmation.remove();
    ouvert.confirmation = null;
  }

  function demanderFermer(){

    if(!ouvert || !etat || ouvert.confirmation) return;

    // Rien n'a été saisi, aucun compte : on part sans rien demander.
    if(etat.nom === 'fin' || etat.nom === 'confirmation' || (!etat.userId && !etat.pseudo && !etat.role && !etat.email)){
      fermer({});
      return;
    }

    const compte = !!etat.userId;

    const boite = document.createElement('div');

    boite.className = 'pc-confirme';
    boite.innerHTML = `
      <div class="pc-confirme-carte" role="alertdialog" aria-labelledby="pc-q-titre">
        <h3 id="pc-q-titre">Quitter ${compte ? 'pour l\'instant' : 'l\'inscription'} ?</h3>
        <p>${compte
          ? "Ton compte est créé. Tu pourras terminer ton profil quand tu veux, depuis la page Profil."
          : "Tes réponses ne sont pas gardées : il faudra tout reprendre au début."}</p>
        <div class="pc-actions">
          <button type="button" class="btn btn-primary" data-conf="rester">Continuer</button>
          <button type="button" class="btn btn-ghost" data-conf="quitter">Quitter</button>
        </div>
      </div>`;

    boite.addEventListener('click', (ev) => {
      const choix = ev.target.closest('[data-conf]');
      if(choix){
        if(choix.dataset.conf === 'quitter') fermer({ abandon: true });
        else fermerConfirmation();
      } else if(ev.target === boite){
        fermerConfirmation();
      }
    });

    ouvert.fond.appendChild(boite);
    ouvert.confirmation = boite;

    const premier = boite.querySelector('[data-conf="rester"]');
    if(premier) premier.focus();
  }

  async function fermer(options){

    if(!ouvert) return;

    const opt = options || {};
    const o = ouvert;
    const e = etat;

    // Les écouteurs et les composants d'abord.
    document.removeEventListener('keydown', surEchap);

    const def = e && ETAPES[e.nom];
    if(def && def.quitter) def.quitter();

    ouvert = null;
    etat = null;

    if(o.observeur) o.observeur.disconnect();

    o.fond.classList.remove('ouvert');
    document.documentElement.classList.remove('pc-ouvert');
    document.body.classList.remove('pc-ouvert');

    setTimeout(() => o.fond.remove(), 520);

    if(o.focusAvant && document.contains(o.focusAvant)){
      try{ o.focusAvant.focus({ preventScroll: true }); }catch(erreur){ /* le focus n'a pas d'importance ici */ }
    }

    // Un compte créé dont le parcours n'est pas fini : le profil s'en souvient, et la page Profil le proposera.
    if(e && e.userId && currentUser && (currentUser.onboarding || {}).parcours !== 'fait' && opt.abandon){

      currentUser.onboarding = Object.assign({}, currentUser.onboarding, { parcours: 'ignore' });

      saveCurrentProfile({ onboarding: currentUser.onboarding }).catch(() => {});

      notifier('Ton compte est créé', {
        type: 'succes',
        icone: '✓',
        detail: 'Tu pourras terminer ton profil depuis la page Profil.'
      });
    }

    if(typeof rendreCarteVerification === 'function') rendreCarteVerification();
  }

  // ---------------------------------------------------------------------
  // Les clics et les touches
  // ---------------------------------------------------------------------

  async function surClic(ev){

    const cible = ev.target.closest('[data-act]');

    if(!cible || !ouvert || !ouvert.fond.contains(cible)) return;

    switch(cible.dataset.act){

      case 'suivant':
        // Un bouton de type « submit » est géré par le formulaire.
        if(cible.type === 'submit') return;
        suivant();
        break;

      case 'passer': passer(); break;
      case 'retour': reculer(); break;
      case 'fermer': demanderFermer(); break;
      case 'fermer-net': fermer({}); break;

      case 'connexion':
        fermer({});
        openAuthModal('login');
        break;

      case 'fournisseur': {

        const f = cible.dataset.f;

        dire('Redirection…', true);

        const { error } = await Auth.connecterAvec(f);

        if(error){
          const detail = String(error.message || '').toLowerCase();
          dire(detail.includes('not enabled') || detail.includes('unsupported')
            ? "Ce mode de connexion n'est pas encore activé."
            : 'Connexion impossible : ' + error.message);
        }

        break;
      }

      case 'plus-sorties':
        etat.sortiesVisibles += 24;
        dessinerSorties();
        break;

      case 'recharger-catalogue':
        preparerCatalogue().then(() => {}, () => {}).then(() => { if(etat && etat.nom === 'sorties'){ majCompteurSorties(false); dessinerSorties(); } });
        dessinerSorties();
        break;

      case 'communaute':
        fermer({});
        goTo('community');
        break;

      case 'profil':
        fermer({});
        goTo('profile');
        break;
    }
  }

  function surEchap(ev){

    if(ev.key !== 'Escape' || !ouvert) return;

    // Le recadrage de la photo gère sa propre touche Échap.
    const recadrage = document.getElementById('cropModal');
    if(recadrage && recadrage.classList.contains('open')) return;

    ev.preventDefault();

    if(ouvert.confirmation) fermerConfirmation();
    else demanderFermer();
  }

  function surTouche(ev){

    if(!ouvert) return;

    if(ev.key === 'Tab'){

      const racine = ouvert.confirmation || ouvert.fond;
      const liste = Array.from(racine.querySelectorAll(FOCALISABLES))
        .filter(el => el.offsetParent !== null && !el.classList.contains('cache'));

      if(!liste.length) return;

      const premier = liste[0];
      const dernier = liste[liste.length - 1];
      const dedans = racine.contains(document.activeElement);

      if(ev.shiftKey && (document.activeElement === premier || !dedans)){
        ev.preventDefault();
        dernier.focus();
      } else if(!ev.shiftKey && (document.activeElement === dernier || !dedans)){
        ev.preventDefault();
        premier.focus();
      }

      return;
    }

    // Entrée dans un champ : étape suivante, sauf là où Entrée a un autre sens (ajouter un style, chercher…).
    if(ev.key === 'Enter' && !ev.isComposing && ev.target.tagName === 'INPUT' && !ouvert.confirmation){

      const def = ETAPES[etat.nom];

      if(!def || def.entree === false) return;

      // Le formulaire du compte écoute sa propre soumission.
      if(ev.target.closest('form')) return;

      if(ev.target.type === 'checkbox' || ev.target.type === 'file') return;

      ev.preventDefault();
      suivant();
    }
  }

  // ---------------------------------------------------------------------
  // L'ouverture
  // ---------------------------------------------------------------------

  async function ouvrir(){

    if(ouvert) return;

    ouvert = { fond: null };   // réservé tout de suite : un second appel pendant la lecture du profil n'ouvre rien

    try{
      await construire();
    }catch(erreur){
      // Rien d'utilisable à l'écran : on défait tout, et l'appelant retombe sur l'ancien formulaire
      // (voir ouvrirParcours dans index.html).
      document.removeEventListener('keydown', surEchap);
      if(ouvert && ouvert.observeur) ouvert.observeur.disconnect();
      if(ouvert && ouvert.fond) ouvert.fond.remove();
      document.documentElement.classList.remove('pc-ouvert');
      document.body.classList.remove('pc-ouvert');
      ouvert = null;
      etat = null;
      throw erreur;
    }
  }

  async function construire(){

    poserFeuille();

    // Un membre déjà connecté ne « crée » pas de compte : il termine son profil.
    const reprise = !!currentUser;
    const drapeaux = (currentUser && currentUser.onboarding) || {};
    const socials = (currentUser && currentUser.socials) || {};

    // Pseudo et rôle déjà choisis : par le parcours lui-même, ou parce que le compte a plus d'un jour (même délai que
    // parcoursARouvrir dans index.html). La reprise, lancée depuis la page Profil, repart alors de la photo.
    const age = reprise ? Date.now() - new Date(currentUser.createdAt || 0).getTime() : 0;
    const identite = reprise && (!!drapeaux.parcours || age >= 24 * 3600 * 1000);

    // Ce que le profil dit déjà de la ville, des styles et de ce que le membre cherche ou propose : un parcours repris
    // ne l'efface pas.
    let ligne = null;

    if(reprise){
      try{
        const { data } = await BD.profil(currentUser.id);
        ligne = data || null;
      }catch(erreur){ /* le parcours se passe très bien de cette lecture */ }
    }

    etat = {
      reprise,
      identiteFaite: identite,
      compteExiste: reprise,
      userId: reprise ? currentUser.id : null,
      pseudo: reprise ? currentUser.pseudo : '',
      role: identite ? roleNom(currentUser.role) : '',
      email: '',
      mdp: '',
      avatarUrl: reprise ? (currentUser.avatar || '') : '',
      avatarDataUrl: null,
      apercu: null,
      bio: reprise ? (currentUser.bio || '') : '',
      ville: (ligne && ligne.ville) || '',
      instagram: instagramVersSaisie(socials.instagram),
      portfolio: socials.portfolio || '',
      genres: Array.isArray(ligne && ligne.genres) ? ligne.genres.slice() : [],
      cherche: Array.isArray(ligne && ligne.cherche) ? ligne.cherche.slice() : [],
      propose: Array.isArray(ligne && ligne.propose) ? ligne.propose.slice() : [],
      referentiel: null,
      referentielPromesse: null,
      catalogue: catalogueData.length ? 'ok' : '',
      recherche: '',
      sortiesVisibles: 24,
      verifEnvoyee: false,
      verifControleur: null,
      nom: '',
      index: 0,
      suite: [],
      plancher: '',
      racine: null,
      occupe: false,
      pseudoEtat: '',
      pseudoRequete: 0,
      pseudoMinuteur: null
    };

    etat.suite = calculerSuite();

    // Une reprise dont l'identité est faite repart de la photo.
    if(etat.reprise && etat.identiteFaite) etat.plancher = 'photo';

    const fond = document.createElement('div');

    fond.className = 'pc-fond';
    fond.setAttribute('role', 'dialog');
    fond.setAttribute('aria-modal', 'true');
    fond.setAttribute('aria-label', reprise ? 'Terminer ton profil' : 'Créer ton compte');

    fond.innerHTML = `
      <div class="pc-lueur a" aria-hidden="true"></div>
      <div class="pc-lueur b" aria-hidden="true"></div>
      <div class="pc-haut">
        <button type="button" class="pc-rond cache" data-act="retour" aria-label="Étape précédente">${SVG.retour}</button>
        <div class="pc-progres"><span class="pc-progres-texte" aria-live="polite"></span><div class="pc-barre"><i></i></div></div>
        <button type="button" class="pc-rond" data-act="fermer" aria-label="Fermer">${SVG.fermer}</button>
      </div>
      <div class="pc-scene"></div>`;

    ouvert = {
      fond,
      scene: fond.querySelector('.pc-scene'),
      retour: fond.querySelector('[data-act="retour"]'),
      barre: fond.querySelector('.pc-barre i'),
      texte: fond.querySelector('.pc-progres-texte'),
      confirmation: null,
      observeur: null,
      focusAvant: document.activeElement
    };

    if(window.ResizeObserver){
      const scene = ouvert.scene;
      ouvert.observeur = new ResizeObserver(() => scene.classList.toggle('deborde', scene.scrollHeight > scene.clientHeight + 2));
    }

    document.body.appendChild(fond);
    document.documentElement.classList.add('pc-ouvert');
    document.body.classList.add('pc-ouvert');

    fond.addEventListener('click', surClic);
    fond.addEventListener('keydown', surTouche);
    document.addEventListener('keydown', surEchap);

    requestAnimationFrame(() => requestAnimationFrame(() => fond.classList.add('ouvert')));

    // La bienvenue des visiteurs a fait son office.
    document.querySelectorAll('#notifZone .notif.invitation').forEach(n => n.remove());
    if(typeof fermerBienvenue === 'function') fermerBienvenue();

    // Ce qui servira plus loin se prépare déjà.
    if(reprise) preparerCatalogue().catch(() => {});

    const premiere = etat.suite[0];

    etat.nom = premiere === 'photo' || etat.plancher ? 'photo' : premiere;
    etat.index = etat.suite.indexOf(etat.nom);

    majEntete(etat.nom);
    monterEtape(etat.nom, 1);
  }

  window.Parcours = { ouvrir, avatarRecadre, fermer: () => fermer({}) };

})();
