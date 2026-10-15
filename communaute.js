/* ======================================================================
   LA COMMUNAUTÉ
   ----------------------------------------------------------------------
   Un réseau social pour les gens de la musique : un fil où l'on partage et
   où l'on discute, des annonces pour trouver avec qui collaborer (un artiste
   qui cherche un beatmaker...), l'annuaire, des messages privés, des
   notifications, des profils.

   Ce fichier est chargé à la demande par index.html, quand quelqu'un ouvre
   la page Communauté : le reste du site n'en paie pas le poids. Il embarque
   tout ce qu'il lui faut — feuille de style, gabarits, logique — et ne parle
   à la base que par les fonctions com_* de sql/communaute.sql (supabase.rpc) :
   il ne lit ni n'écrit jamais une table.

   Il s'appuie sur ce que index.html met déjà à disposition de tous les
   scripts : supabaseClient, currentUser, escapeHtml, escapeAttribute, safeUrl,
   artistInitial, roleInfo, notifier, openAuthModal, awardXP, Fichiers,
   uploadCoverDataUrl, dataUrlToBlob, idYouTube, badgeForXP, levelForXP,
   goTo, ouvrirPageArtiste.

   Point d'entrée : window.Com.ouvrir() — dessine la page selon l'adresse
   (#community, #community/explorer, #community/messages/<id>...).
   ====================================================================== */

(function(){

'use strict';

if(window.Com) return;


// ---------------------------------------------------------------------
// Petits outils
// ---------------------------------------------------------------------

const $ = (selecteur, racine) => (racine || document).querySelector(selecteur);
const $$ = (selecteur, racine) => Array.from((racine || document).querySelectorAll(selecteur));

const esc = (t) => escapeHtml(t == null ? '' : t);
// escapeHtml va plus loin que escapeAttribute (& et chevrons aussi) : une
// valeur d'attribut n'a aucune raison de garder du balisage.
const attr = (t) => escapeHtml(t == null ? '' : t);

function moi(){
  return typeof currentUser !== 'undefined' ? currentUser : null;
}

function mouvementReduit(){
  return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

function attendre(ms){
  return new Promise(resolve => setTimeout(resolve, ms));
}

function debounce(fn, ms){
  let minuteur = null;
  return function(){
    const args = arguments;
    clearTimeout(minuteur);
    minuteur = setTimeout(() => fn.apply(null, args), ms);
  };
}

function pluriel(n, un, plusieurs){
  return n + ' ' + (n > 1 ? (plusieurs || un + 's') : un);
}

// 1 240 → « 1,2 k » : les compteurs restent courts.
function compact(n){
  n = Number(n) || 0;
  if(n < 1000) return String(n);
  if(n < 10000) return (n / 1000).toFixed(1).replace('.', ',').replace(',0', '') + ' k';
  return Math.round(n / 1000) + ' k';
}

// « il y a 5 min », en plus court : à l'instant, 5 min, 2 h, hier, 3 j,
// 12 oct., 12 oct. 2025.
function depuis(iso){

  const d = new Date(iso);
  const s = (Date.now() - d.getTime()) / 1000;

  if(!isFinite(s)) return '';
  if(s < 45) return "à l'instant";
  if(s < 3600) return Math.max(1, Math.round(s / 60)) + ' min';
  if(s < 86400) return Math.round(s / 3600) + ' h';
  if(s < 172800) return 'hier';
  if(s < 604800) return Math.floor(s / 86400) + ' j';

  const memeAnnee = d.getFullYear() === new Date().getFullYear();

  return d.toLocaleDateString('fr-FR', memeAnnee
    ? { day: 'numeric', month: 'short' }
    : { day: 'numeric', month: 'short', year: 'numeric' });
}

function dateLongue(iso){
  const d = new Date(iso);
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) +
         ' à ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function heure(iso){
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

// Un libellé de jour pour séparer les messages d'une conversation.
function jourLibelle(iso){

  const d = new Date(iso);
  const auj = new Date();
  const hier = new Date(Date.now() - 86400000);

  if(d.toDateString() === auj.toDateString()) return "Aujourd'hui";
  if(d.toDateString() === hier.toDateString()) return 'Hier';

  return d.toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long',
    year: d.getFullYear() === auj.getFullYear() ? undefined : 'numeric'
  });
}

// Un nombre de minutes en « il y a », pour les infobulles : la date exacte
// reste lisible au survol.
function tempsHtml(iso){
  return `<time datetime="${attr(iso)}" title="${attr(dateLongue(iso))}" data-depuis="${attr(iso)}">${esc(depuis(iso))}</time>`;
}


// ---------------------------------------------------------------------
// Icônes
//
// Un seul jeu de traits de 1,8 px, hérité de la couleur du texte : les
// boutons n'ont pas à les recolorer.
// ---------------------------------------------------------------------

function icone(nom, taille){
  const dessin = ICONES[nom] || '';
  const t = taille || 20;
  return `<svg class="com-ic" viewBox="0 0 24 24" width="${t}" height="${t}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${dessin}</svg>`;
}

const ICONES = {
  accueil:   '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  explorer:  '<circle cx="12" cy="12" r="9"/><path d="m15.6 8.4-2.1 5.1-5.1 2.1 2.1-5.1z"/>',
  collabs:   '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c.6-3.4 3-5.2 6-5.2s5.4 1.8 6 5.2"/><circle cx="17.5" cy="9" r="2.4"/><path d="M17 14.2c2.4.3 3.9 1.9 4.3 4.3"/>',
  messages:  '<path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8z"/>',
  cloche:    '<path d="M6 9a6 6 0 1 1 12 0c0 5 2 6.5 2 6.5H4S6 14 6 9z"/><path d="M10 19a2.2 2.2 0 0 0 4 0"/>',
  profil:    '<circle cx="12" cy="8.5" r="3.6"/><path d="M4.5 20c1.4-3.8 4.2-5.6 7.5-5.6s6.1 1.8 7.5 5.6"/>',
  plus:      '<path d="M12 5v14M5 12h14"/>',
  coeur:     '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21.2l7.8-7.7 1-1.1a5.5 5.5 0 0 0 0-7.8z"/>',
  bulle:     '<path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8z"/>',
  signet:    '<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>',
  partager:  '<path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v13"/>',
  plus3:     '<circle cx="5" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="19" cy="12" r="1.5" fill="currentColor"/>',
  image:     '<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="1.8"/><path d="m21 16-5-5-8 8"/>',
  casque:    '<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="14" width="4.5" height="6.5" rx="1.6"/><rect x="16.5" y="14" width="4.5" height="6.5" rx="1.6"/>',
  lien:      '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/>',
  envoyer:   '<path d="M22 2 11 13M22 2l-7 20-4-9-9-4z"/>',
  loupe:     '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  croix:     '<path d="M6 6l12 12M18 6 6 18"/>',
  coche:     '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  chevronBas:'<path d="m6 9 6 6 6-6"/>',
  chevronDroite:'<path d="m9 6 6 6-6 6"/>',
  retour:    '<path d="m15 18-6-6 6-6"/>',
  tendance:  '<path d="m3 17 6-6 4 4 8-8M15 7h6v6"/>',
  epingle:   '<path d="M12 17v5M8 3h8l-1 7 3 3v2H6v-2l3-3z"/>',
  poubelle:  '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  drapeau:   '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  interdit:  '<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>',
  crayon:    '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  lieu:      '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
  flecheHaut:'<path d="M12 19V5M5 12l7-7 7 7"/>',
  sortie:    '<path d="M7 17 17 7M8 7h9v9"/>',
  etincelle: '<path d="M12 3l1.8 4.7 4.7 1.8-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M19 15l.7 1.8 1.8.7-1.8.7L19 20l-.7-1.8-1.8-.7 1.8-.7z"/>',
  question:  '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.4a2.5 2.5 0 1 1 3.4 2.3c-.7.3-1 .8-1 1.6M12 17h.01"/>',
  micro:     '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  lecture:   '<path d="M8 5.2v13.6a1 1 0 0 0 1.5.86l11-6.8a1 1 0 0 0 0-1.72l-11-6.8A1 1 0 0 0 8 5.2z" fill="currentColor" stroke="none"/>',
  utilisateurPlus: '<circle cx="9.5" cy="8" r="3.4"/><path d="M3 20c.7-3.6 3.2-5.4 6.5-5.4S15.3 16.4 16 20M19 8v6M16 11h6"/>',
  arobase:   '<circle cx="12" cy="12" r="3.5"/><path d="M15.5 8.5v5a2.5 2.5 0 0 0 5 0V12a8.5 8.5 0 1 0-3.4 6.8"/>',
  verrou:    '<rect x="5" y="11" width="14" height="9" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  bouclier:  '<path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z"/><path d="m9 12 2.2 2.2L15.5 10"/>',
  rouage:    '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  jeu:       '<rect x="3" y="7" width="18" height="12" rx="3"/><path d="M8 11v4M6 13h4M16 12h.01M18 14h.01"/>',
  smiley:    '<circle cx="11" cy="12" r="8.5"/><path d="M7.4 14.2a4.2 4.2 0 0 0 7.2 0M8.6 9.8h.01M13.4 9.8h.01"/><path d="M19.5 3.5v5M17 6h5"/>',
  ondes:     '<path d="M3 12h1.5M7.5 8v8M11.5 4.5v15M15.5 8.5v7M19.5 10.5v3"/>',
  pastille:  '<circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/>'
};


// ---------------------------------------------------------------------
// Ce que la communauté sait des métiers, des réactions, des sujets
// ---------------------------------------------------------------------

// Les clés vivent en base ; le dessin vit ici.
const REACTIONS = [
  { cle: 'coeur', emoji: '❤️', libelle: "J'aime" },
  { cle: 'feu',   emoji: '🔥', libelle: 'Feu' },
  { cle: 'rire',  emoji: '😂', libelle: 'Haha' },
  { cle: 'bravo', emoji: '👏', libelle: 'Bravo' },
  { cle: 'cent',  emoji: '💯', libelle: 'Cent pour cent' }
];

function reaction(cle){
  return REACTIONS.find(r => r.cle === cle) || null;
}

// Le rôle d'un profil, en métier (ce que l'on cherche, ce que l'on propose).
const ROLE_VERS_METIER = {
  'Artiste': 'artiste', 'Beatmaker': 'beatmaker', 'DJ': 'dj',
  'Photographe': 'photographe', 'Manager': 'manager',
  "Membre d'un label": 'label', 'Relation presse': 'media',
  'Média / Presse': 'media', 'Autre': 'autre',
  'Musicien / Musicienne': 'musicien', 'Ingénieur son': 'ingenieur',
  'Danseur / Danseuse': 'danse', 'Graphiste': 'da'
};

function metierDuRole(role){
  return ROLE_VERS_METIER[role] || null;
}

const TYPES_POST = {
  message:  { libelle: 'Message',        icone: 'bulle' },
  question: { libelle: 'Question',       icone: 'question' },
  son:      { libelle: 'Partage de son', icone: 'casque' },
  collab:   { libelle: 'Collab',         icone: 'collabs' }
};

const REMUNERATIONS = {
  gratuit:    { libelle: 'Gratuit',          court: 'Gratuit' },
  partage:    { libelle: 'Partage des gains', court: 'Partage' },
  paye:       { libelle: 'Rémunéré',          court: 'Rémunéré' },
  a_discuter: { libelle: 'À discuter',        court: 'À discuter' }
};

const GENRES_SUGGERES = [
  'Trap', 'Drill', 'Boom bap', 'Cloud', 'Afro', 'Pop rap', 'Jersey',
  'R&B', 'Rap conscient', 'Old school', 'Plug', 'UK drill'
];

// Les sujets par défaut, pour que l'interface se dessine même si le
// référentiel de la base ne répond pas.
const REFERENTIEL_SECOURS = {
  sujets: [
    { cle: 'general', libelle: 'Général', icone: '💬', description: '', reserve_equipe: false }
  ],
  metiers: [
    { cle: 'artiste', libelle: 'Artiste', icone: '🎤' },
    { cle: 'beatmaker', libelle: 'Beatmaker', icone: '🎹' },
    { cle: 'autre', libelle: 'Autre', icone: '✨' }
  ]
};


// ---------------------------------------------------------------------
// Avatars
//
// La photo quand il y en a une ; sinon l'initiale sur un dégradé tiré du
// pseudo : chacun garde la même couleur partout, et le fil ne se lit pas
// comme une colonne de ronds gris.
// ---------------------------------------------------------------------

function teinte(texte){
  let h = 0;
  const t = String(texte || '?');
  for(let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) % 360;
  return h;
}

function avatarHtml(u, taille){

  const pseudo = (u && u.pseudo) || '?';
  const photo = safeUrl(u && u.avatar_url);
  const t = taille || 'm';
  const h = teinte(pseudo);

  if(photo){
    return `<span class="com-av com-av-${t}"><img src="${attr(photo)}" alt="" loading="lazy" decoding="async"></span>`;
  }

  return `<span class="com-av com-av-${t}" style="--h:${h}" aria-hidden="true"><b>${esc(artistInitial(pseudo))}</b></span>`;
}

function roleHtml(role, petit){

  const r = roleInfo(role || 'Auditeur');

  return `<span class="com-role${petit ? ' com-role-petit' : ''}" style="--c:${attr(r.color)}">${esc(r.icon)} ${esc(r.name)}</span>`;
}

// Le nom d'un membre, avec ce qui le distingue : l'équipe, un artiste
// vérifié.
function nomHtml(u, options){

  const o = options || {};
  const pseudo = (u && u.pseudo) || 'Compte supprimé';

  const equipe = u && u.equipe
    ? `<span class="com-badge-equipe" title="Équipe La Wave">${icone('bouclier', 14)}</span>`
    : '';

  // Un profil dont l'équipe a vérifié le métier (une capture, validée dans l'espace équipe) : la coche pleine du
  // site, la même que « Profil vérifié » sur la page Profil. Distincte de la petite coche d'une page artiste.
  const verifie = u && u.verifie && !o.sansVerifie && typeof cocheVerifieHtml === 'function'
    ? cocheVerifieHtml('Profil vérifié' + (u.verifie_role || u.verifieRole ? ' · ' + (u.verifie_role || u.verifieRole) : ''))
    : '';

  const artiste = u && u.artiste && !o.sansArtiste
    ? `<span class="com-badge-artiste" title="Page artiste vérifiée">${icone('coche', 11)}</span>`
    : '';

  const lien = u && u.id && !o.sansLien
    ? ` data-act="membre" data-cle="${attr(u.pseudo)}"`
    : '';

  // Le nom et ses badges sur une même ligne, alignés au centre : l'écusson de l'équipe et la coche bleue tombent pile sur le pseudo.
  return `<span class="com-nom-ligne"><span class="com-nom"${lien}>${esc(pseudo)}</span>${equipe}${verifie}${artiste}</span>`;
}


// ---------------------------------------------------------------------
// Les liens : mots-clics, citations, adresses
// ---------------------------------------------------------------------

function raccourcirUrl(url){
  try{
    const u = new URL(url);
    const chemin = (u.pathname + u.search).replace(/\/$/, '');
    const court = u.hostname.replace(/^www\./, '') + (chemin.length > 1 ? chemin : '');
    return court.length > 38 ? court.slice(0, 37) + '…' : court;
  }catch(e){
    return String(url).slice(0, 38);
  }
}

// Un message, prêt à afficher : échappé d'abord, puis les adresses, les
// citations de membres qui existent et les mots-clics deviennent des liens.
// On travaille sur le texte brut, découpé en morceaux, pour que rien de ce
// que l'on échappe ne soit relu comme du balisage.
//
// Les citations et les mots-clics se lisent comme le fait la base (voir
// com_extraire_mentions et com_extraire_tags) : la ponctuation de fin n'est pas
// un bout de pseudo, et un mot-clic commence par une lettre. Avec
// options.liensSeuls (messages privés), seules les adresses deviennent des liens.
function enrichir(texte, mentions, options){

  const t = String(texte || '');
  const connus = (mentions || []).map(p => String(p).toLowerCase());
  const liensSeuls = !!(options && options.liensSeuls);

  const re = liensSeuls
    ? /(https?:\/\/[^\s<>"']+)/gu
    : /(https?:\/\/[^\s<>"']+)|(^|[\s(])@([\p{L}\p{N}_.-]{2,40})|(^|[\s(])#(\p{L}[\p{L}\p{N}_]{1,29})/gu;

  const morceaux = [];
  let dernier = 0;

  for(const m of t.matchAll(re)){

    if(m[1]){

      let url = m[1];
      let reste = '';
      const fin = /[).,;:!?»]+$/.exec(url);

      if(fin){
        reste = fin[0];
        url = url.slice(0, url.length - reste.length);
      }

      const sure = safeUrl(url);

      morceaux.push(esc(t.slice(dernier, m.index)));
      morceaux.push(sure
        ? `<a class="com-lien-ext" href="${attr(sure)}" target="_blank" rel="noopener noreferrer nofollow ugc">${esc(raccourcirUrl(url))}</a>`
        : esc(url));
      morceaux.push(esc(reste));

      dernier = m.index + m[0].length;

    } else if(m[3]){

      const brut = m[3];
      const pseudo = brut.replace(/[._-]+$/, '');
      const fin = brut.slice(pseudo.length);

      morceaux.push(esc(t.slice(dernier, m.index + m[2].length)));
      morceaux.push(connus.includes(pseudo.toLowerCase())
        ? `<a class="com-mention" href="#community/membre/${attr(encodeURIComponent(pseudo))}" data-act="membre" data-cle="${attr(pseudo)}">@${esc(pseudo)}</a>${esc(fin)}`
        : esc('@' + brut));

      dernier = m.index + m[0].length;

    } else if(m[5]){

      const tag = m[5];

      morceaux.push(esc(t.slice(dernier, m.index + m[4].length)));
      morceaux.push(`<a class="com-tag" href="#community/tag/${attr(encodeURIComponent(tag.toLowerCase()))}" data-act="tag" data-tag="${attr(tag.toLowerCase())}">#${esc(tag)}</a>`);

      dernier = m.index + m[0].length;
    }
  }

  morceaux.push(esc(t.slice(dernier)));

  return morceaux.join('');
}


// Ce qu'on sait d'une adresse : de quoi montrer un lecteur ou une carte.
function infoLien(url){

  let u;

  try{ u = new URL(url); }catch(e){ return { type: 'autre', domaine: '', url }; }

  const hote = u.hostname.replace(/^www\./, '');
  const chemin = u.pathname;

  const yt = typeof idYouTube === 'function' ? idYouTube(url) : null;

  if(yt){
    return { type: 'youtube', id: yt, domaine: hote, url };
  }

  let m = /open\.spotify\.com\/(?:intl-[a-z]+\/)?(track|album|playlist|artist|episode|show)\/([A-Za-z0-9]+)/.exec(u.href);

  if(m){
    return { type: 'spotify', genre: m[1], id: m[2], domaine: hote, url };
  }

  m = /deezer\.com\/(?:[a-z]{2}\/)?(track|album|playlist|artist)\/(\d+)/.exec(u.href);

  if(m){
    return { type: 'deezer', genre: m[1], id: m[2], domaine: hote, url };
  }

  if(/(^|\.)soundcloud\.com$/.test(hote) && chemin.length > 1){
    return { type: 'soundcloud', domaine: hote, url };
  }

  if(hote === 'music.apple.com'){
    return { type: 'apple', domaine: hote, url };
  }

  return { type: 'autre', domaine: hote, url };
}

const FOURNISSEURS = {
  youtube:    { nom: 'YouTube',     couleur: '#ff4e45' },
  spotify:    { nom: 'Spotify',     couleur: '#1ed760' },
  deezer:     { nom: 'Deezer',      couleur: '#a238ff' },
  soundcloud: { nom: 'SoundCloud',  couleur: '#ff7a1a' },
  apple:      { nom: 'Apple Music', couleur: '#fa4565' },
  autre:      { nom: '',            couleur: '#8a9199' }
};


// ---------------------------------------------------------------------
// La base : les fonctions com_*
//
// Une seule porte. Une erreur de la base est traduite en phrase que l'on
// peut montrer ; le refus voulu (« Doucement : ... ») arrive déjà écrit en
// français depuis le SQL.
// ---------------------------------------------------------------------

function traduireErreur(erreur){

  const m = String((erreur && erreur.message) || '');
  const e = new Error(m || 'Une erreur est survenue.');

  e.code = erreur && erreur.code;

  if(erreur && (erreur.code === 'PGRST202' || /Could not find the function|schema cache/i.test(m))){
    e.installation = true;
    e.message = "La communauté n'est pas encore activée : le fichier communaute.sql n'a pas été passé dans Supabase.";
  } else if(/Failed to fetch|NetworkError|Load failed/i.test(m)){
    e.reseau = true;
    e.message = 'Impossible de joindre le serveur. Vérifie ta connexion.';
  } else if(/JWT|not authenticated/i.test(m)){
    e.session = true;
    e.message = 'Ta session a expiré : reconnecte-toi.';
  } else if(/permission denied/i.test(m)){
    e.session = true;
    e.message = 'Connecte-toi pour faire ça.';
  } else if(/invalid input syntax|^22P02$/i.test(m) || (erreur && erreur.code === '22P02')){
    // Une adresse mal copiée (identifiant tronqué) : rien de ce nom n'existe.
    e.introuvable = true;
    e.message = "Cette page n'existe pas (ou plus).";
  }

  return e;
}

async function rpc(nom, args){

  const { data, error } = await supabaseClient.rpc(nom, args || {});

  if(error) throw traduireErreur(error);

  return data;
}

const BD = {

  referentiel: ()    => rpc('com_referentiel'),
  fil:         (a)   => rpc('com_fil', a),
  post:        (id)  => rpc('com_post', { p_id: id }),
  profil:      (cle) => rpc('com_profil', { p_cle: String(cle) }),
  membres:     (a)   => rpc('com_membres', a),
  suggestions: (n)   => rpc('com_suggestions', { p_limite: n || 5 }),
  tendances:   ()    => rpc('com_tendances'),
  chercher:    (q)   => rpc('com_chercher', { p_q: q }),
  compteurs:   ()    => rpc('com_compteurs'),
  nbPosts:     (id)  => rpc('com_nb_posts', { p_auteur: id }),

  notifications:   (avant)  => rpc('com_notifications', { p_avant: avant || null, p_limite: 30 }),
  notificationsLues: (jusqua) => rpc('com_notifications_lues', { p_jusqua: jusqua || null }),
  conversations:   ()       => rpc('com_conversations'),
  messages:        (id, avant) => rpc('com_messages', { p_conversation: id, p_avant: avant || null, p_limite: 40 }),
  ouvrirConversation: (id)  => rpc('com_ouvrir_conversation', { p_avec: id }),
  envoyer:         (id, texte) => rpc('com_envoyer', { p_conversation: id, p_contenu: texte }),
  lire:            (id)     => rpc('com_lire', { p_conversation: id }),

  publier:     (a)   => rpc('com_publier', a),
  modifierPost: (id, texte) => rpc('com_modifier_post', { p_id: id, p_contenu: texte }),
  supprimerPost: (id) => rpc('com_supprimer_post', { p_id: id }),
  epingler:    (id, actif) => rpc('com_epingler', { p_id: id, p_actif: actif }),
  commenter:   (post, texte, parent) => rpc('com_commenter', { p_post: post, p_contenu: texte, p_parent: parent || null }),
  supprimerCommentaire: (id) => rpc('com_supprimer_commentaire', { p_id: id }),
  reagir:      (type, id, emoji) => rpc('com_reagir', { p_type: type, p_id: id, p_emoji: emoji || null }),
  favori:      (id, actif) => rpc('com_favori', { p_post: id, p_actif: actif }),
  suivre:      (id, actif) => rpc('com_suivre', { p_id: id, p_actif: actif }),
  bloquer:     (id, actif) => rpc('com_bloquer', { p_id: id, p_actif: actif }),
  signaler:    (type, id, motif, details) => rpc('com_signaler', { p_type: type, p_id: id, p_motif: motif, p_details: details || null }),
  majProfil:   (a)   => rpc('com_maj_profil', a)
};



// ---------------------------------------------------------------------
// L'état commun
// ---------------------------------------------------------------------

const S = {
  racine: null,
  ref: REFERENTIEL_SECOURS,
  refCharge: false,
  userId: null,
  vues: new Map(),       // clé de route → vue gardée en vie
  courante: null,
  route: null,
  scrolls: {},           // clé de route → défilement quand on l'a quittée
  compteurs: { notifications: 0, messages: 0 },
  suggestions: null,
  suggestionsLe: 0,
  tendances: null,
  tendancesLe: 0,
  installation: false,   // vrai si communaute.sql n'a pas été passé
  minuteurs: {}
};

const DUREE = 220;       // la durée d'un mouvement courant, en ms
const FRAGILE = 'Quelque chose a coincé. Réessaie dans un instant.';

function sujetInfo(cle){
  return S.ref.sujets.find(s => s.cle === cle) || { cle, libelle: cle, icone: '💬' };
}

function metierInfo(cle){
  return S.ref.metiers.find(m => m.cle === cle) || { cle, libelle: cle, icone: '✨' };
}

// « un beatmaker », « une artiste » : on s'en tient au masculin pour les
// métiers, que le français accepte comme neutre.
function libelleMetier(cle){
  const m = metierInfo(cle);
  return m.libelle;
}

function message(erreur){
  const m = (erreur && erreur.message) || '';
  return m || FRAGILE;
}


// ---------------------------------------------------------------------
// Messages à l'écran
// ---------------------------------------------------------------------

function toast(titre, options){

  const o = options || {};

  if(typeof notifier !== 'function') return;

  notifier(titre, {
    type: o.type || 'succes',
    icone: o.icone || (o.type === 'erreur' ? '⚠️' : '✓'),
    detail: o.detail,
    duree: o.duree || 3200
  });
}

function toastErreur(erreur){
  if(erreur && erreur.installation){
    S.installation = true;
    toast("Communauté pas encore activée", { type: 'erreur', detail: erreur.message, duree: 6000 });
    return;
  }
  toast(message(erreur), { type: 'erreur', duree: 5200 });
}


// ---------------------------------------------------------------------
// Fenêtres et menus
//
// Une seule couche pour tout ce qui se pose par-dessus la page : le menu
// d'un message (en bulle sur grand écran, en feuille en bas sur
// téléphone), les confirmations, le signalement, la visionneuse.
// ---------------------------------------------------------------------

let calqueCourant = null;   // { fermer }

function fermerCalque(){
  if(calqueCourant){
    const c = calqueCourant;
    calqueCourant = null;
    c.fermer();
  }
}

function petitEcran(){
  return window.matchMedia && window.matchMedia('(max-width: 760px)').matches;
}

// Un menu d'actions ancré sur un bouton.
//   items : [{ libelle, icone, action(), danger, separe }]
function ouvrirMenu(ancre, items){

  fermerCalque();

  const feuille = petitEcran();
  const fond = document.createElement('div');
  fond.className = 'com-calque' + (feuille ? ' com-calque-feuille' : ' com-calque-leger');

  const boite = document.createElement('div');
  boite.className = feuille ? 'com-feuille' : 'com-menu';
  boite.setAttribute('role', 'menu');

  boite.innerHTML = items.filter(Boolean).map((it, i) => `
    ${it.separe ? '<div class="com-menu-sep" role="separator"></div>' : ''}
    <button type="button" role="menuitem" class="com-menu-item${it.danger ? ' danger' : ''}${it.actif ? ' actif' : ''}" data-i="${i}">
      ${it.point ? `<i class="com-pt" style="--sj:${attr(it.point)}" aria-hidden="true"></i>` : it.emoji ? `<span class="com-menu-emoji" aria-hidden="true">${esc(it.emoji)}</span>` : it.icone ? icone(it.icone, 18) : ''}<span>${esc(it.libelle)}</span>
      ${it.actif ? `<span class="com-menu-coche" aria-hidden="true">${icone('coche', 16)}</span>` : ''}
    </button>`).join('');

  fond.appendChild(boite);
  document.body.appendChild(fond);

  const actifs = items.filter(Boolean);

  if(!feuille && ancre){

    const r = ancre.getBoundingClientRect();
    const b = boite.getBoundingClientRect();
    const gauche = Math.max(8, Math.min(window.innerWidth - b.width - 8, r.right - b.width));
    let haut = r.bottom + 6;

    if(haut + b.height > window.innerHeight - 8){
      haut = Math.max(8, r.top - b.height - 6);
      boite.style.transformOrigin = 'bottom right';
    }

    boite.style.left = gauche + 'px';
    boite.style.top = haut + 'px';
  }

  requestAnimationFrame(() => fond.classList.add('ouvert'));

  const fermer = () => {
    fond.classList.remove('ouvert');
    document.removeEventListener('keydown', surTouche, true);
    setTimeout(() => fond.remove(), mouvementReduit() ? 0 : 180);
    if(ancre && ancre.isConnected) ancre.focus({ preventScroll: true });
  };

  const surTouche = (e) => {

    if(e.key === 'Escape'){
      e.preventDefault();
      e.stopPropagation();
      fermerCalque();
      return;
    }

    if(e.key === 'ArrowDown' || e.key === 'ArrowUp'){
      e.preventDefault();
      const boutons = $$('.com-menu-item', boite);
      const i = boutons.indexOf(document.activeElement);
      const suivant = e.key === 'ArrowDown'
        ? boutons[(i + 1) % boutons.length]
        : boutons[(i - 1 + boutons.length) % boutons.length];
      suivant.focus();
    }
  };

  document.addEventListener('keydown', surTouche, true);

  fond.addEventListener('click', (e) => {

    const bouton = e.target.closest('.com-menu-item');

    if(bouton){
      const it = actifs[Number(bouton.dataset.i)];
      fermerCalque();
      if(it && it.action) setTimeout(it.action, 0);
      return;
    }

    if(e.target === fond) fermerCalque();
  });

  calqueCourant = { fermer };

  const premier = $('.com-menu-item', boite);
  if(premier && !feuille) premier.focus({ preventScroll: true });
}

// Une fenêtre : titre, contenu libre, boutons. Rend une promesse qui se
// résout avec la valeur du bouton choisi (ou null si on ferme).
function ouvrirDialogue(o){

  fermerCalque();

  // Le focus revient là où il était (le bouton ⋯, par exemple) à la fermeture.
  const avantFocus = document.activeElement;

  return new Promise(resolve => {

    const fond = document.createElement('div');
    fond.className = 'com-calque com-calque-dialogue';

    const boite = document.createElement('div');
    boite.className = 'com-dialogue';
    boite.setAttribute('role', 'dialog');
    boite.setAttribute('aria-modal', 'true');
    boite.setAttribute('aria-label', o.titre || '');

    boite.innerHTML = `
      <div class="com-dialogue-tete">
        <h3>${esc(o.titre || '')}</h3>
        <button type="button" class="com-icone-btn" data-fermer aria-label="Fermer">${icone('croix', 18)}</button>
      </div>
      <div class="com-dialogue-corps">${o.corps || ''}</div>
      <div class="com-dialogue-pied">
        ${(o.boutons || []).map(b => `
          <button type="button" class="com-btn ${b.primaire ? 'com-btn-plein' : 'com-btn-fantome'}${b.danger ? ' danger' : ''}"
                  data-valeur="${attr(b.valeur)}">${esc(b.libelle)}</button>`).join('')}
      </div>`;

    fond.appendChild(boite);
    document.body.appendChild(fond);
    document.documentElement.classList.add('com-fige');

    let fini = false;

    const fin = (valeur) => {

      if(fini) return;
      fini = true;

      fond.classList.remove('ouvert');
      document.removeEventListener('keydown', surTouche, true);
      document.documentElement.classList.remove('com-fige');
      setTimeout(() => fond.remove(), mouvementReduit() ? 0 : 200);
      calqueCourant = null;
      if(avantFocus && avantFocus.isConnected && avantFocus.focus) avantFocus.focus({ preventScroll: true });
      resolve(valeur);
    };

    const surTouche = (e) => {

      if(e.key === 'Escape'){
        e.preventDefault();
        e.stopPropagation();
        fin(null);
        return;
      }

      // Garde le focus dans la fenêtre.
      if(e.key === 'Tab'){
        const focalisables = $$('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])', boite)
          .filter(x => !x.disabled && x.offsetParent !== null);
        if(!focalisables.length) return;
        const premier = focalisables[0];
        const dernier = focalisables[focalisables.length - 1];
        if(e.shiftKey && document.activeElement === premier){ e.preventDefault(); dernier.focus(); }
        else if(!e.shiftKey && document.activeElement === dernier){ e.preventDefault(); premier.focus(); }
      }
    };

    document.addEventListener('keydown', surTouche, true);

    fond.addEventListener('click', (e) => {

      if(e.target === fond || e.target.closest('[data-fermer]')){
        fin(null);
        return;
      }

      const b = e.target.closest('[data-valeur]');

      if(b){
        const valeur = b.dataset.valeur;
        // Le formulaire éventuel est lu avant la fermeture.
        const lecture = o.lire ? o.lire(boite, valeur) : valeur;
        if(lecture === false) return;
        fin(lecture === undefined ? valeur : lecture);
      }
    });

    calqueCourant = { fermer: () => fin(null) };

    requestAnimationFrame(() => fond.classList.add('ouvert'));

    const premier = $(o.focus || 'textarea, input, select, [data-valeur]', boite);
    if(premier) setTimeout(() => premier.focus({ preventScroll: true }), 60);

    if(o.surOuverture) o.surOuverture(boite);
  });
}

async function confirmer(titre, texte, libelleOk, danger){

  const r = await ouvrirDialogue({
    titre,
    corps: `<p class="com-dialogue-texte">${esc(texte)}</p>`,
    boutons: [
      { libelle: 'Annuler', valeur: 'non' },
      { libelle: libelleOk || 'Confirmer', valeur: 'oui', primaire: true, danger: !!danger }
    ],
    focus: '[data-valeur="non"]'
  });

  return r === 'oui';
}


// ---------------------------------------------------------------------
// La visionneuse d'images
//
// L'image part de sa vignette et grandit jusqu'à sa place (la même
// courbe que partout) ; elle y retourne à la fermeture.
// ---------------------------------------------------------------------

let visionneuse = null;

function ouvrirVisionneuse(urls, indice, vignette){

  fermerCalque();

  let i = Math.max(0, Math.min(urls.length - 1, indice || 0));

  const fond = document.createElement('div');
  fond.className = 'com-vision';
  fond.setAttribute('role', 'dialog');
  fond.setAttribute('aria-modal', 'true');
  fond.setAttribute('aria-label', 'Image en grand');

  fond.innerHTML = `
    <button type="button" class="com-vision-fermer com-icone-btn" aria-label="Fermer">${icone('croix', 22)}</button>
    ${urls.length > 1 ? `
      <button type="button" class="com-vision-nav prec" aria-label="Image précédente">${icone('retour', 26)}</button>
      <button type="button" class="com-vision-nav suiv" aria-label="Image suivante"><span style="display:inline-flex;transform:scaleX(-1)">${icone('retour', 26)}</span></button>
      <span class="com-vision-compte" aria-live="polite"></span>` : ''}
    <img class="com-vision-img" alt="">`;

  document.body.appendChild(fond);
  document.documentElement.classList.add('com-fige');

  const img = $('.com-vision-img', fond);
  const compte = $('.com-vision-compte', fond);

  const montrer = (n, sens) => {

    i = (n + urls.length) % urls.length;
    img.src = safeUrl(urls[i]);
    if(compte) compte.textContent = (i + 1) + ' / ' + urls.length;

    if(sens && !mouvementReduit() && img.animate){
      img.animate([
        { opacity: 0, transform: 'translateX(' + (sens * 40) + 'px) scale(.98)' },
        { opacity: 1, transform: 'none' }
      ], { duration: 280, easing: 'cubic-bezier(.16,1,.3,1)' });
    }
  };

  montrer(i, 0);

  // Ouverture : de la vignette à la place.
  requestAnimationFrame(() => {
    fond.classList.add('ouvert');

    if(vignette && !mouvementReduit() && img.animate){

      const de = vignette.getBoundingClientRect();
      const run = () => {
        const vers = img.getBoundingClientRect();
        if(!vers.width || !de.width) return;
        const dx = de.left + de.width / 2 - (vers.left + vers.width / 2);
        const dy = de.top + de.height / 2 - (vers.top + vers.height / 2);
        const k = Math.max(de.width / vers.width, de.height / vers.height);
        img.animate([
          { transform: `translate(${dx}px, ${dy}px) scale(${k})`, borderRadius: '14px' },
          { transform: 'none', borderRadius: '0px' }
        ], { duration: 380, easing: 'cubic-bezier(.16,1,.3,1)' });
      };

      if(img.complete) run(); else img.addEventListener('load', run, { once: true });
    }
  });

  let fini = false;

  const fermer = () => {

    if(fini) return;
    fini = true;

    document.removeEventListener('keydown', surTouche, true);
    document.documentElement.classList.remove('com-fige');
    fond.classList.remove('ouvert');
    visionneuse = null;
    calqueCourant = null;

    if(vignette && vignette.isConnected && !mouvementReduit() && img.animate){

      const vers = vignette.getBoundingClientRect();
      const de = img.getBoundingClientRect();
      const dx = vers.left + vers.width / 2 - (de.left + de.width / 2);
      const dy = vers.top + vers.height / 2 - (de.top + de.height / 2);
      const k = Math.max(vers.width / de.width, vers.height / de.height);

      img.animate([
        { transform: 'none' },
        { transform: `translate(${dx}px, ${dy}px) scale(${k})` }
      ], { duration: 280, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'forwards' });
    }

    setTimeout(() => fond.remove(), mouvementReduit() ? 0 : 300);
  };

  const surTouche = (e) => {
    if(e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); fermer(); }
    else if(e.key === 'ArrowLeft' && urls.length > 1) montrer(i - 1, -1);
    else if(e.key === 'ArrowRight' && urls.length > 1) montrer(i + 1, 1);
  };

  document.addEventListener('keydown', surTouche, true);

  fond.addEventListener('click', (e) => {
    if(e.target.closest('.prec')) return montrer(i - 1, -1);
    if(e.target.closest('.suiv')) return montrer(i + 1, 1);
    if(e.target === img) return;
    fermer();
  });

  // Glisser pour passer d'une image à l'autre, ou tirer vers le bas pour fermer.
  let depart = null;
  fond.addEventListener('pointerdown', (e) => { if(e.target === img) depart = { x: e.clientX, y: e.clientY }; });
  fond.addEventListener('pointerup', (e) => {

    if(!depart) return;

    const dx = e.clientX - depart.x;
    const dy = e.clientY - depart.y;
    depart = null;

    if(Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) && urls.length > 1){
      montrer(i + (dx < 0 ? 1 : -1), dx < 0 ? 1 : -1);
    } else if(dy > 90 && Math.abs(dy) > Math.abs(dx)){
      fermer();
    }
  });

  visionneuse = { fermer };
  calqueCourant = { fermer };

  $('.com-vision-fermer', fond).focus({ preventScroll: true });
}


// ---------------------------------------------------------------------
// Petits composants d'affichage
// ---------------------------------------------------------------------

function squelettePost(n){
  let html = '';
  for(let k = 0; k < (n || 3); k++){
    html += `
      <div class="com-carte com-squelette-post" aria-hidden="true">
        <div class="com-sq-ligne">
          <span class="com-sq com-sq-rond"></span>
          <span class="com-sq-col"><span class="com-sq" style="width:38%"></span><span class="com-sq" style="width:22%"></span></span>
        </div>
        <span class="com-sq" style="width:96%"></span>
        <span class="com-sq" style="width:82%"></span>
        <span class="com-sq" style="width:54%"></span>
      </div>`;
  }
  return html;
}

function squeletteMembre(n){
  let html = '';
  for(let k = 0; k < (n || 4); k++){
    html += `
      <div class="com-carte com-squelette-post" aria-hidden="true">
        <div class="com-sq-ligne">
          <span class="com-sq com-sq-rond" style="width:52px;height:52px"></span>
          <span class="com-sq-col"><span class="com-sq" style="width:34%"></span><span class="com-sq" style="width:60%"></span></span>
        </div>
      </div>`;
  }
  return html;
}

function etatVide(o){
  return `
    <div class="com-vide">
      <span class="com-vide-icone">${icone(o.icone || 'etincelle', 30)}</span>
      <h3>${esc(o.titre)}</h3>
      ${o.texte ? `<p>${esc(o.texte)}</p>` : ''}
      ${o.bouton ? `<button type="button" class="com-btn com-btn-plein" ${o.bouton.attrs || ''}>${esc(o.bouton.libelle)}</button>` : ''}
    </div>`;
}

function etatErreur(erreur, nouvelEssai){

  if(erreur && erreur.installation){
    return `
      <div class="com-vide com-vide-install">
        <span class="com-vide-icone">${icone('rouage', 30)}</span>
        <h3>La communauté arrive</h3>
        <p>Le nouveau réseau n'est pas encore activé sur ce site : le fichier <b>communaute.sql</b> doit d'abord être passé dans Supabase.</p>
      </div>`;
  }

  return `
    <div class="com-vide">
      <span class="com-vide-icone">${icone('interdit', 30)}</span>
      <h3>Impossible de charger</h3>
      <p>${esc(message(erreur))}</p>
      ${nouvelEssai ? `<button type="button" class="com-btn com-btn-fantome" data-act="reessayer">Réessayer</button>` : ''}
    </div>`;
}

// Un bouton « Suivre » : le même partout, mis à jour partout.
function boutonSuivre(u, suit){
  if(!u || !u.id) return '';
  const moiId = S.userId;
  if(moiId && moiId === u.id) return '';
  return `<button type="button" class="com-btn ${suit ? 'com-btn-fantome' : 'com-btn-plein'} com-btn-petit com-suivre${suit ? ' actif' : ''}"
            data-act="suivre" data-id="${attr(u.id)}" aria-pressed="${suit ? 'true' : 'false'}">
            <span class="lib-non">Suivre</span><span class="lib-oui">Suivi</span><span class="lib-quitter">Ne plus suivre</span>
          </button>`;
}

function pastilles(cles, prefixe, vide){
  if(!cles || !cles.length) return vide || '';
  return cles.map(c => {
    const m = metierInfo(c);
    return `<span class="com-pastille">${esc(m.icone)} ${esc(m.libelle)}</span>`;
  }).join('');
}

function ongletsHtml(items, actif, attrs){
  return `
    <div class="com-onglets" role="tablist" ${attrs || ''}>
      ${items.map(it => `
        <button type="button" role="tab" class="com-onglet${it.cle === actif ? ' actif' : ''}"
                aria-selected="${it.cle === actif ? 'true' : 'false'}" data-onglet="${attr(it.cle)}">${esc(it.libelle)}</button>`).join('')}
      <span class="com-onglet-barre" aria-hidden="true"></span>
    </div>`;
}

// La barre sous l'onglet actif glisse d'un onglet à l'autre.
function placerBarreOnglets(conteneur, animer, selecteurActif){

  const barre = $('.com-onglet-barre', conteneur);
  const actif = $(selecteurActif || '.com-onglet.actif', conteneur);

  if(!barre) return;

  // Aucune page active (un profil, un message...) : le trait s'efface.
  barre.style.opacity = actif ? '' : '0';

  if(!actif) return;

  const x = actif.offsetLeft;
  const l = actif.offsetWidth;

  if(!animer || mouvementReduit()) barre.style.transition = 'none';
  barre.style.transform = `translateX(${x}px)`;
  barre.style.width = l + 'px';
  if(!animer || mouvementReduit()){
    void barre.offsetWidth;
    barre.style.transition = '';
  }
}

// Six onglets sur un écran étroit : la barre défile, et l'onglet actif se remet au centre.
function centrerOngletActif(conteneur){

  const actif = $('.com-onglet.actif', conteneur);

  if(!actif || conteneur.scrollWidth <= conteneur.clientWidth) return;

  conteneur.scrollTo({
    left: Math.max(0, actif.offsetLeft - (conteneur.clientWidth - actif.offsetWidth) / 2),
    behavior: mouvementReduit() ? 'auto' : 'smooth'
  });
}

// Fait entrer des éléments les uns après les autres.
function entrerEnCascade(elements, pas){

  if(mouvementReduit()) return;

  const liste = Array.from(elements || []).slice(0, 14);

  liste.forEach((el, i) => {
    el.style.animationDelay = (i * (pas || 40)) + 'ms';
    el.classList.add('com-entre');
    el.addEventListener('animationend', () => {
      el.classList.remove('com-entre');
      el.style.animationDelay = '';
    }, { once: true });
  });
}

// Fait varier un élément en hauteur de sa taille actuelle à sa nouvelle taille.
function animerHauteur(el, changer){

  if(!el) { changer(); return; }

  if(mouvementReduit() || !el.animate){ changer(); return; }

  const avant = el.getBoundingClientRect().height;
  changer();
  const apres = el.getBoundingClientRect().height;

  if(Math.abs(avant - apres) < 2) return;

  el.style.overflow = 'hidden';

  const a = el.animate([{ height: avant + 'px' }, { height: apres + 'px' }],
    { duration: 300, easing: 'cubic-bezier(.16,1,.3,1)' });

  a.onfinish = a.oncancel = () => { el.style.overflow = ''; };
}

// Texte qui s'agrandit avec ce qu'on y écrit.
function ajusterTexte(zone){
  zone.style.height = 'auto';
  zone.style.height = Math.min(zone.scrollHeight, 420) + 'px';
}

// Rafraîchit les « il y a 5 min » visibles, sans tout redessiner.
function rafraichirTemps(){
  $$('time[data-depuis]', S.racine).forEach(t => {
    const v = depuis(t.dataset.depuis);
    if(t.textContent !== v) t.textContent = v;
  });
}



// ---------------------------------------------------------------------
// Les messages : un seul exemplaire de chaque, partagé par toutes les
// vues. Réagir à un message dans le fil le met à jour dans le fil de
// l'artiste, dans sa page, dans les favoris...
// ---------------------------------------------------------------------

const REG_POSTS = new Map();
const REG_COMS = new Map();

function regPost(p){
  if(!p || !p.id) return p;
  const connu = REG_POSTS.get(p.id);
  if(connu){
    Object.assign(connu, p);
    return connu;
  }
  REG_POSTS.set(p.id, p);
  return p;
}

function regCom(c){
  if(!c || !c.id) return c;
  const connu = REG_COMS.get(c.id);
  if(connu){
    Object.assign(connu, c);
    return connu;
  }
  REG_COMS.set(c.id, c);
  return c;
}

function adresseAbsolue(fragment){
  return location.origin + location.pathname + location.search + fragment;
}

function lienPost(id){ return adresseAbsolue('#community/post/' + encodeURIComponent(id)); }
function lienMembre(pseudo){ return adresseAbsolue('#community/membre/' + encodeURIComponent(pseudo)); }

async function copier(texte){

  try{
    await navigator.clipboard.writeText(texte);
    return true;
  }catch(e){
    // Sans l'API moderne (page non sécurisée, vieux navigateur) : la vieille méthode.
    try{
      const t = document.createElement('textarea');
      t.value = texte;
      t.setAttribute('readonly', '');
      t.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
      document.body.appendChild(t);
      t.select();
      const ok = document.execCommand('copy');
      t.remove();
      return ok;
    }catch(e2){
      return false;
    }
  }
}


// ---------------------------------------------------------------------
// Les médias d'un message
// ---------------------------------------------------------------------

function imagesHtml(images){

  const liste = (images || []).map(safeUrl).filter(Boolean).slice(0, 4);

  if(!liste.length) return '';

  return `
    <div class="com-images n${liste.length}" data-urls="${attr(JSON.stringify(liste))}">
      ${liste.map((u, i) => `
        <button type="button" class="com-image" data-act="image" data-i="${i}" aria-label="Voir l'image ${i + 1} en grand">
          <img src="${attr(u)}" alt="" loading="lazy" decoding="async">
        </button>`).join('')}
    </div>`;
}

// Une adresse devient un lecteur (au clic : rien n'est chargé tant que
// personne ne veut écouter) ou une carte.
function lienHtml(url){

  const sure = safeUrl(url);

  if(!sure) return '';

  const info = infoLien(sure);
  const f = FOURNISSEURS[info.type] || FOURNISSEURS.autre;

  if(info.type === 'youtube'){
    return `
      <div class="com-embed com-embed-video" style="--c:${f.couleur}">
        <button type="button" class="com-embed-lire" data-act="lire-embed" data-type="youtube" data-id="${attr(info.id)}" aria-label="Lire la vidéo">
          <img src="https://i.ytimg.com/vi/${attr(info.id)}/hqdefault.jpg" alt="" loading="lazy" decoding="async">
          <span class="com-play">${icone('lecture', 26)}</span>
        </button>
        <a class="com-embed-pied" href="${attr(sure)}" target="_blank" rel="noopener noreferrer nofollow ugc">
          <span>${esc(f.nom)}</span><span class="com-embed-url">${esc(raccourcirUrl(sure))}</span>${icone('sortie', 15)}
        </a>
      </div>`;
  }

  if(info.type === 'spotify' || info.type === 'deezer' || info.type === 'soundcloud'){
    return `
      <div class="com-embed com-embed-son" style="--c:${f.couleur}">
        <div class="com-embed-cadre">
          <button type="button" class="com-embed-lire-son" data-act="lire-embed" data-type="${attr(info.type)}"
                  data-id="${attr(info.id || '')}" data-genre="${attr(info.genre || '')}" data-url="${attr(sure)}">
            <span class="com-play petit">${icone('lecture', 18)}</span>
            <span class="com-embed-texte"><b>Écouter sur ${esc(f.nom)}</b><small>${esc(raccourcirUrl(sure))}</small></span>
          </button>
        </div>
        <a class="com-embed-ext" href="${attr(sure)}" target="_blank" rel="noopener noreferrer nofollow ugc" aria-label="Ouvrir sur ${attr(f.nom)}">${icone('sortie', 16)}</a>
      </div>`;
  }

  return `
    <a class="com-carte-lien" href="${attr(sure)}" target="_blank" rel="noopener noreferrer nofollow ugc">
      <span class="com-carte-lien-ic">${icone('lien', 18)}</span>
      <span class="com-embed-texte"><b>${esc(info.domaine || 'Lien')}</b><small>${esc(raccourcirUrl(sure))}</small></span>
      ${icone('sortie', 16)}
    </a>`;
}

function lancerEmbed(bouton){

  const type = bouton.dataset.type;
  const cadre = bouton.closest('.com-embed');
  let src = '';
  let haut = 0;

  if(type === 'youtube'){
    src = 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(bouton.dataset.id) + '?autoplay=1&rel=0&modestbranding=1';
  } else if(type === 'spotify'){
    src = 'https://open.spotify.com/embed/' + encodeURIComponent(bouton.dataset.genre) + '/' + encodeURIComponent(bouton.dataset.id) + '?theme=0';
    haut = /^(track|episode)$/.test(bouton.dataset.genre) ? 152 : 352;
  } else if(type === 'deezer'){
    src = 'https://widget.deezer.com/widget/dark/' + encodeURIComponent(bouton.dataset.genre) + '/' + encodeURIComponent(bouton.dataset.id);
    haut = bouton.dataset.genre === 'track' ? 130 : 300;
  } else if(type === 'soundcloud'){
    src = 'https://w.soundcloud.com/player/?url=' + encodeURIComponent(bouton.dataset.url) +
          '&color=%231489de&auto_play=true&hide_related=true&show_comments=false&show_teaser=false';
    haut = 166;
  }

  if(!src || !cadre) return;

  const zone = type === 'youtube' ? bouton : bouton.closest('.com-embed-cadre');
  const iframe = document.createElement('iframe');

  iframe.src = src;
  iframe.title = 'Lecteur';
  iframe.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture; fullscreen');
  iframe.setAttribute('allowfullscreen', '');
  iframe.setAttribute('loading', 'lazy');
  iframe.referrerPolicy = 'strict-origin-when-cross-origin';
  iframe.className = 'com-iframe';

  if(haut) iframe.style.height = haut + 'px';

  zone.replaceWith(iframe);
  cadre.classList.add('lance');
}


// ---------------------------------------------------------------------
// Un message
// ---------------------------------------------------------------------

// Une couleur par sujet : le fil se lit d'un coup d'œil, et rien n'y est gris.
const COULEURS_SUJETS = {
  general: '#4fb4ff', feedback: '#a78bfa', prod: '#ff9f43', sorties: '#ff6fa8',
  concerts: '#2ec4b6', matos: '#7bd88f', off: '#9aa4b2', annonces: '#f5c04a'
};

function couleurSujet(cle){
  return COULEURS_SUJETS[cle] || 'hsl(' + teinte(cle) + ' 70% 62%)';
}

// L'annonce d'une collaboration : un bandeau qui se lit avant tout le reste —
// qui cherche, qui propose, quel métier, à quelles conditions.
function collabHtml(c){

  if(!c || !c.role) return '';

  const m = metierInfo(c.role);
  const cherche = c.mode === 'cherche';
  const remu = REMUNERATIONS[c.remuneration] || null;
  const styles = (c.styles || []).slice(0, 5);

  const details = [
    ...styles.map(esc),
    c.lieu ? `${icone('lieu', 12)} ${esc(c.lieu)}` : '',
    remu ? esc(remu.court) : ''
  ].filter(Boolean);

  return `
    <div class="com-collab" data-mode="${attr(c.mode)}">
      <div class="com-collab-ligne">
        <span class="com-collab-mode">${cherche ? 'Cherche' : 'Propose'}</span>
        <b class="com-collab-metier"><span aria-hidden="true">${esc(m.icone)}</span> ${esc(m.libelle)}</b>
      </div>
      ${details.length ? `<div class="com-collab-details">${details.map(d => `<span>${d}</span>`).join('<i aria-hidden="true">·</i>')}</div>` : ''}
    </div>`;
}

// Le bas d'un message : les réactions déjà posées, visibles et cliquables
// (un clic en pose une ou la retire), le bouton pour en ajouter, puis les
// commentaires, l'enregistrement et le partage.
function actionsHtml(p, o){

  const mienne = p.moi && p.moi.reaction ? reaction(p.moi.reaction) : null;
  const favori = !!(p.moi && p.moi.favori);
  const nbc = p.nb_commentaires || 0;

  const vibes = (p.reactions || []).map(r => {

    const d = reaction(r.emoji);

    if(!d) return '';

    const mien = !!(mienne && mienne.cle === r.emoji);

    return `
      <button type="button" class="com-vibe${mien ? ' mien' : ''}" data-act="reagir-choix" data-emoji="${r.emoji}"
              aria-pressed="${mien ? 'true' : 'false'}" aria-label="${attr(d.libelle)} : ${r.n}${mien ? ' (la tienne, toucher pour la retirer)' : ''}">
        <span class="com-vibe-e">${d.emoji}</span><b>${compact(r.n)}</b>
      </button>`;
  }).join('');

  return `
    <div class="com-post-pied">
      <div class="com-vibes">
        ${vibes}
        <div class="com-reag-zone">
          <button type="button" class="com-vibe ajout${vibes ? '' : ' vide'}" data-act="palette" aria-haspopup="true" aria-label="Réagir" title="Réagir">
            ${icone('smiley', 19)}${vibes ? '' : '<span>Réagir</span>'}
          </button>
          <div class="com-palette" role="group" aria-label="Choisir une réaction">
            ${REACTIONS.map(r => `
              <button type="button" class="com-palette-btn${mienne && mienne.cle === r.cle ? ' choisi' : ''}"
                      data-act="reagir-choix" data-emoji="${r.cle}" aria-label="${attr(r.libelle)}" title="${attr(r.libelle)}">${r.emoji}</button>`).join('')}
          </div>
        </div>
      </div>
      <div class="com-post-outils">
        <button type="button" class="com-outil" data-act="${o && o.detail ? 'repondre-focus' : 'ouvrir-post-reponse'}" aria-label="Commentaires (${nbc})">
          ${icone('bulle', 18)}<span class="com-outil-n">${nbc ? compact(nbc) : ''}</span><span class="com-outil-lib">${nbc ? (nbc > 1 ? 'commentaires' : 'commentaire') : 'Commenter'}</span>
        </button>
        <button type="button" class="com-outil icone${favori ? ' actif favori' : ''}" data-act="favori" aria-pressed="${favori ? 'true' : 'false'}"
                aria-label="${favori ? 'Retirer des favoris' : 'Enregistrer'}">${icone('signet', 18)}</button>
        <button type="button" class="com-outil icone" data-act="partager" aria-label="Partager">${icone('partager', 18)}</button>
      </div>
    </div>`;
}

function postHtml(p, o){

  const opt = o || {};
  const a = p.auteur || {};
  const long = !opt.detail && ((p.contenu || '').length > 380 || (p.contenu || '').split('\n').length > 7);
  const sujet = sujetInfo(p.sujet);
  const couleurRole = roleInfo(a.role || 'Auditeur').color;

  const badgeType = p.type === 'question'
    ? `<span class="com-type-badge question">${icone('question', 13)} Question</span>`
    : p.type === 'son'
      ? `<span class="com-type-badge son">${icone('casque', 13)} Son</span>`
      : '';

  return `
    <article class="com-carte com-post${p.epingle ? ' epingle' : ''}${opt.detail ? ' detail' : ''}" data-post="${attr(p.id)}" data-type="${attr(p.type)}"
             style="--sj:${attr(couleurSujet(p.sujet))};--rc:${attr(couleurRole)}"
             ${opt.detail ? '' : 'data-act="ouvrir-post" tabindex="0"'} aria-label="Message de ${attr(a.pseudo || '')}">
      ${collabHtml(p.collab)}
      ${p.epingle ? `<div class="com-epingle">${icone('epingle', 14)} Épinglé par l'équipe</div>` : ''}
      <header class="com-post-tete">
        <a class="com-av-lien" href="#community/membre/${attr(encodeURIComponent(a.pseudo || ''))}" data-act="membre" data-cle="${attr(a.pseudo)}" aria-label="Profil de ${attr(a.pseudo)}">${avatarHtml(a, 'm')}</a>
        <div class="com-post-qui">
          <div class="com-post-nom">${nomHtml(a)}${roleHtml(a.role, true)}</div>
          <div class="com-post-meta">
            ${tempsHtml(p.cree_le)}${p.modifie_le ? ' <span class="com-modifie" title="Modifié">· modifié</span>' : ''}
            <span class="com-sep">·</span>
            <a class="com-sujet-lien" href="#community/sujet/${attr(encodeURIComponent(p.sujet))}" data-act="sujet" data-cle="${attr(p.sujet)}"><i class="com-pt" aria-hidden="true"></i>${esc(sujet.libelle)}</a>
            ${badgeType}
          </div>
        </div>
        <button type="button" class="com-icone-btn" data-act="menu-post" aria-label="Plus d'options" aria-haspopup="menu">${icone('plus3', 20)}</button>
      </header>
      ${p.contenu ? `
        <div class="com-post-corps${long ? ' coupe' : ''}" data-corps>
          <div class="com-texte">${enrichir(p.contenu, p.mentions)}</div>
          ${long ? `<button type="button" class="com-voir-plus" data-act="deplier">Voir plus</button>` : ''}
        </div>` : ''}
      ${imagesHtml(p.images)}
      ${lienHtml(p.lien)}
      ${opt.cta && p.type === 'collab' ? ctaCollabHtml(p) : ''}
      ${actionsHtml(p, opt)}
    </article>`;
}

// Remplacer un bloc d'actions ne doit pas faire perdre le focus au clavier :
// l'élément qui l'avait (repéré par son data-act et son emoji) le retrouve.
function remplacerEnGardantLeFocus(ancien, neuf){

  const actif = document.activeElement;
  let repere = null;

  if(actif && ancien.contains(actif) && actif.dataset && actif.dataset.act){
    repere = '[data-act="' + actif.dataset.act + '"]' + (actif.dataset.emoji ? '[data-emoji="' + actif.dataset.emoji + '"]' : '');
  }

  ancien.replaceWith(neuf);

  if(repere){
    const cible = $(repere, neuf);
    if(cible) cible.focus({ preventScroll: true });
  }
}

// Met à jour la rangée d'actions d'un message partout où il est affiché.
function majPost(id, options){

  const p = REG_POSTS.get(id);

  if(!p) return;

  $$('.com-post[data-post="' + CSS.escape(id) + '"]', S.racine).forEach(carte => {

    const ancien = $('.com-post-pied', carte);

    if(!ancien) return;

    const detail = carte.classList.contains('detail');
    const vide = document.createElement('div');
    vide.innerHTML = actionsHtml(p, { detail }).trim();
    const neuf = vide.firstElementChild;

    remplacerEnGardantLeFocus(ancien, neuf);

    if(options && options.impulsion && !mouvementReduit()){
      const ic = $(options.impulsion, neuf) || $('.com-vibe.mien .com-vibe-e', neuf);
      if(ic && ic.animate){
        ic.animate([
          { transform: 'scale(.6)' }, { transform: 'scale(1.35)', offset: .5 }, { transform: 'scale(1)' }
        ], { duration: 420, easing: 'cubic-bezier(.34,1.56,.64,1)' });
      }
    }
  });
}

function majPostComplet(id){

  const p = REG_POSTS.get(id);

  if(!p) return;

  $$('.com-post[data-post="' + CSS.escape(id) + '"]', S.racine).forEach(carte => {
    const detail = carte.classList.contains('detail');
    const vide = document.createElement('div');
    vide.innerHTML = postHtml(p, { detail }).trim();
    carte.replaceWith(vide.firstElementChild);
  });
}

function retirerPostDuDom(id){

  $$('.com-post[data-post="' + CSS.escape(id) + '"]', S.racine).forEach(carte => {

    if(mouvementReduit() || !carte.animate){ carte.remove(); return; }

    const h = carte.getBoundingClientRect().height;
    carte.style.overflow = 'hidden';

    const a = carte.animate([
      { opacity: 1, height: h + 'px', marginBottom: '14px', transform: 'none' },
      { opacity: 0, height: '0px', marginBottom: '0px', paddingTop: '0px', paddingBottom: '0px', transform: 'scale(.97)' }
    ], { duration: 320, easing: 'cubic-bezier(.16,1,.3,1)' });

    // Une page en arrière-plan ne joue pas ses animations : la carte part quand même.
    a.onfinish = () => carte.remove();
    setTimeout(() => carte.remove(), 600);
  });

  REG_POSTS.delete(id);
}


// ---------------------------------------------------------------------
// Les commentaires
// ---------------------------------------------------------------------

function commentaireHtml(c, o){

  const opt = o || {};
  const a = c.auteur || {};
  const mienne = c.moi && c.moi.reaction ? reaction(c.moi.reaction) : null;
  const nb = c.nb_reactions || 0;
  const reponse = !!c.parent_id;

  return `
    <div class="com-com${reponse ? ' reponse' : ''}" data-com="${attr(c.id)}" data-pid="${attr(c.post_id)}" data-parent="${attr(c.parent_id || '')}">
      <a class="com-av-lien" href="#community/membre/${attr(encodeURIComponent(a.pseudo || ''))}" data-act="membre" data-cle="${attr(a.pseudo)}" aria-label="Profil de ${attr(a.pseudo)}">${avatarHtml(a, reponse ? 's' : 'm')}</a>
      <div class="com-com-corps">
        <div class="com-com-bulle">
          <div class="com-com-tete">
            ${nomHtml(a)}
            ${a.id && opt.auteurPostId && a.id === opt.auteurPostId ? '<span class="com-auteur-badge">Auteur</span>' : ''}
            <span class="com-sep">·</span>${tempsHtml(c.cree_le)}
          </div>
          <div class="com-com-texte com-texte">${enrichir(c.contenu, c.mentions)}</div>
        </div>
        <div class="com-com-actions">
          <div class="com-reag-zone">
            <button type="button" class="com-act mini com-act-reag${mienne ? ' actif' : ''}" data-act="reagir-com"
                    aria-pressed="${mienne ? 'true' : 'false'}" aria-label="${mienne ? 'Retirer ta réaction' : 'Réagir'}">
              <span class="com-act-ic">${mienne ? `<span class="com-emoji">${mienne.emoji}</span>` : icone('coeur', 15)}</span>
              <span class="com-act-n">${nb ? compact(nb) : ''}</span>
            </button>
            <div class="com-palette" role="group" aria-label="Choisir une réaction">
              ${REACTIONS.map(r => `
                <button type="button" class="com-palette-btn${mienne && mienne.cle === r.cle ? ' choisi' : ''}"
                        data-act="reagir-com-choix" data-emoji="${r.cle}" aria-label="${attr(r.libelle)}" title="${attr(r.libelle)}">${r.emoji}</button>`).join('')}
            </div>
          </div>
          <button type="button" class="com-act mini texte" data-act="repondre-com">Répondre</button>
          <button type="button" class="com-act mini" data-act="menu-com" aria-label="Plus d'options" aria-haspopup="menu">${icone('plus3', 16)}</button>
        </div>
        <div class="com-reponse-zone"></div>
      </div>
    </div>`;
}

function majCommentaire(id){

  const c = REG_COMS.get(id);

  if(!c) return;

  $$('[data-com="' + CSS.escape(id) + '"]', S.racine).forEach(noeud => {

    const ancien = $('.com-com-actions', noeud);
    if(!ancien) return;

    const vide = document.createElement('div');
    vide.innerHTML = commentaireHtml(c, {}).trim();
    const neuf = $('.com-com-actions', vide);

    // Le champ de réponse éventuellement ouvert ne doit pas bouger.
    remplacerEnGardantLeFocus(ancien, neuf);
  });
}

// Les commentaires d'un message : une racine et, dessous, ses réponses.
function arbreCommentairesHtml(liste, auteurPostId){

  const racines = liste.filter(c => !c.parent_id);
  const enfants = {};

  liste.filter(c => c.parent_id).forEach(c => {
    (enfants[c.parent_id] = enfants[c.parent_id] || []).push(c);
  });

  return racines.map(r => {

    const reps = enfants[r.id] || [];
    const cache = reps.length > 2;
    const vues = cache ? reps.slice(-1) : reps;

    return `
      <div class="com-fil-com" data-racine="${attr(r.id)}">
        ${commentaireHtml(r, { auteurPostId })}
        ${reps.length ? `
          <div class="com-reponses">
            ${cache ? `<button type="button" class="com-voir-reps" data-act="voir-reponses">${icone('retour', 14)} Voir ${reps.length - 1} autre${reps.length - 1 > 1 ? 's' : ''} réponse${reps.length - 1 > 1 ? 's' : ''}</button>` : ''}
            <div class="com-reponses-liste">
              ${cache ? reps.slice(0, -1).map(c => `<div hidden data-masque>${commentaireHtml(c, { auteurPostId })}</div>`).join('') : ''}
              ${vues.map(c => commentaireHtml(c, { auteurPostId })).join('')}
            </div>
          </div>` : ''}
      </div>`;
  }).join('');
}



// ---------------------------------------------------------------------
// Citer un membre en tapant @
//
// En écrivant « @ca », une liste propose les membres dont le pseudo
// commence ainsi. Elle sert au message, au commentaire et aux messages
// privés : un seul code.
// ---------------------------------------------------------------------

function brancherMentions(zone){

  if(zone.__mentions) return;

  const enveloppe = zone.parentElement;
  const liste = document.createElement('div');

  liste.className = 'com-mentions';
  liste.setAttribute('role', 'listbox');
  liste.hidden = true;
  enveloppe.appendChild(liste);

  let resultats = [];
  let choix = 0;
  let jeton = null;
  let requete = 0;

  const fermer = () => { liste.hidden = true; resultats = []; jeton = null; };

  const lireJeton = () => {
    const avant = zone.value.slice(0, zone.selectionStart);
    const m = /(^|[\s(])@([\p{L}\p{N}_.-]{1,40})$/u.exec(avant);
    return m ? { debut: avant.length - m[2].length - 1, texte: m[2] } : null;
  };

  const afficher = () => {

    if(!resultats.length){ fermer(); return; }

    liste.innerHTML = resultats.map((u, i) => `
      <button type="button" role="option" class="com-mention-item${i === choix ? ' actif' : ''}" data-i="${i}" aria-selected="${i === choix}">
        ${avatarHtml(u, 's')}<span class="com-mention-pseudo">${esc(u.pseudo)}</span>
        <span class="com-mention-role">${esc(roleInfo(u.role).icon)} ${esc(roleInfo(u.role).name)}</span>
      </button>`).join('');

    liste.hidden = false;
  };

  const choisir = (i) => {

    const u = resultats[i];

    if(!u || !jeton) return;

    const avant = zone.value.slice(0, jeton.debut);
    const apres = zone.value.slice(zone.selectionStart);

    zone.value = avant + '@' + u.pseudo + ' ' + apres;

    const pos = (avant + '@' + u.pseudo + ' ').length;
    zone.setSelectionRange(pos, pos);
    fermer();
    zone.dispatchEvent(new Event('input', { bubbles: true }));
    zone.focus();
  };

  const chercher = debounce(async () => {

    const j = lireJeton();

    if(!j){ fermer(); return; }

    jeton = j;
    const moi_ = ++requete;

    try{
      const r = await BD.chercher(j.texte);
      if(moi_ !== requete) return;
      resultats = (r && r.membres) || [];
      choix = 0;
      afficher();
    }catch(e){
      fermer();
    }
  }, 180);

  zone.addEventListener('input', () => {
    if(lireJeton()) chercher(); else fermer();
  });

  zone.addEventListener('keydown', (e) => {

    if(liste.hidden) return;

    if(e.key === 'ArrowDown' || e.key === 'ArrowUp'){
      e.preventDefault();
      choix = (choix + (e.key === 'ArrowDown' ? 1 : -1) + resultats.length) % resultats.length;
      afficher();
    } else if(e.key === 'Enter' || e.key === 'Tab'){
      e.preventDefault();
      e.stopPropagation();
      choisir(choix);
    } else if(e.key === 'Escape'){
      e.preventDefault();
      e.stopPropagation();
      fermer();
    }
  }, true);

  zone.addEventListener('blur', () => setTimeout(fermer, 160));

  liste.addEventListener('mousedown', (e) => {
    // mousedown plutôt que click : le champ ne doit pas perdre le focus avant.
    e.preventDefault();
    const b = e.target.closest('.com-mention-item');
    if(b) choisir(Number(b.dataset.i));
  });

  zone.__mentions = true;
}


// ---------------------------------------------------------------------
// Les images d'un message
//
// Réduites dans le navigateur (1 600 px, JPEG) avant d'être envoyées : on
// ne stocke pas des photos de téléphone de 8 Mo.
// ---------------------------------------------------------------------

const IMAGES_MAX = 4;

function chargerImageFichier(fichier){
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(fichier);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Cette image n'a pas pu être lue.")); };
    img.src = url;
  });
}

async function preparerImage(fichier){

  if(!/^image\/(jpeg|png|webp)$/.test(fichier.type)){
    throw new Error('Seules les images JPG, PNG ou WEBP sont acceptées.');
  }

  if(fichier.size > 20 * 1024 * 1024){
    throw new Error('Cette image est trop lourde (20 Mo au plus).');
  }

  let source;

  try{
    source = window.createImageBitmap ? await createImageBitmap(fichier) : await chargerImageFichier(fichier);
  }catch(e){
    source = await chargerImageFichier(fichier);
  }

  const w = source.width;
  const h = source.height;
  const k = Math.min(1, 1600 / Math.max(w, h));

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * k));
  canvas.height = Math.max(1, Math.round(h * k));

  const ctx = canvas.getContext('2d');
  // Un PNG transparent devient noir en JPEG : on peint d'abord le fond du site.
  ctx.fillStyle = '#05070a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);

  if(source.close) source.close();

  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.86));

  if(!blob) throw new Error("Cette image n'a pas pu être préparée.");

  return blob;
}


// ---------------------------------------------------------------------
// Le compositeur : écrire et publier
//
// Une seule carte qui s'ouvre. Fermée, c'est une ligne (« Quoi de neuf ? ») ;
// ouverte, elle montre le type de message, les images, le lien, et pour
// une annonce de collaboration ce que l'on cherche ou propose.
// ---------------------------------------------------------------------

const BROUILLON = 'lw-com-brouillon-';

// Un brouillon appartient à un compte : un autre membre qui se connecte sur le
// même navigateur ne le retrouve pas.
function cleBrouillon(nom){
  return BROUILLON + (moi() ? moi().id : 'visiteur') + '-' + nom;
}

function lireBrouillon(nom){
  try{
    const b = JSON.parse(localStorage.getItem(cleBrouillon(nom)) || 'null');
    return b && typeof b === 'object' ? b : null;
  }catch(e){
    return null;
  }
}

function ecrireBrouillon(nom, inst){
  try{
    const vide = !inst.texte.trim() && !inst.lien && inst.type !== 'collab';
    if(vide){ localStorage.removeItem(cleBrouillon(nom)); return; }
    localStorage.setItem(cleBrouillon(nom), JSON.stringify({
      texte: inst.texte, type: inst.type, sujet: inst.sujet, lien: inst.lien, collab: inst.collab
    }));
  }catch(e){}
}

function collabParDefaut(){
  return { mode: 'cherche', role: 'beatmaker', styles: [], lieu: '', remuneration: 'a_discuter' };
}

function sujetsPourMoi(){
  const equipe = !!(moi() && moi().isAdmin);
  return S.ref.sujets.filter(s => !s.reserve_equipe || equipe);
}

function composerFermeHtml(){

  const u = moi();

  return `
    <div class="com-comp-ferme">
      <div class="com-comp-haut">
        ${avatarHtml({ pseudo: u.pseudo, avatar_url: u.avatar }, 'm')}
        <button type="button" class="com-comp-invite" data-act="c-ouvrir">Quoi de neuf, ${esc(u.pseudo)} ?</button>
      </div>
      <div class="com-types-rapides">
        <button type="button" class="com-type-rapide t-message" data-act="c-ouvrir" data-type="message">${icone('crayon', 17)}<span>Écrire</span></button>
        <button type="button" class="com-type-rapide t-son" data-act="c-ouvrir" data-type="son">${icone('casque', 17)}<span>Partager un son</span></button>
        <button type="button" class="com-type-rapide t-question" data-act="c-ouvrir" data-type="question">${icone('question', 17)}<span>Poser une question</span></button>
        <button type="button" class="com-type-rapide t-collab" data-act="c-ouvrir" data-type="collab">${icone('collabs', 17)}<span>Chercher ou proposer</span></button>
      </div>
    </div>`;
}

function composerOuvertHtml(inst){

  const u = moi();

  return `
    <div class="com-comp-ouvert">
      <div class="com-comp-ligne">
        ${avatarHtml({ pseudo: u.pseudo, avatar_url: u.avatar }, 'm')}
        <div class="com-comp-zone">
          <div class="com-comp-types" role="radiogroup" aria-label="Type de message">
            ${Object.keys(TYPES_POST).map(k => `
              <button type="button" role="radio" class="com-chip t-${k}${inst.type === k ? ' actif' : ''}" data-act="c-type" data-type="${k}" aria-checked="${inst.type === k}">
                ${icone(TYPES_POST[k].icone, 15)}<span>${esc(TYPES_POST[k].libelle)}</span>
              </button>`).join('')}
          </div>
          <div class="com-comp-champ">
            <textarea class="com-comp-texte" rows="2" maxlength="2000" data-c="texte" aria-label="Ton message"
                      placeholder="${attr(placeholderComposer(inst.type))}"></textarea>
          </div>
        </div>
      </div>

      <div class="com-comp-collab" data-c="collab" hidden>
        <div class="com-seg" role="radiogroup" aria-label="Chercher ou proposer">
          <button type="button" role="radio" class="com-seg-btn" data-act="c-mode" data-mode="cherche">Je cherche</button>
          <button type="button" role="radio" class="com-seg-btn" data-act="c-mode" data-mode="propose">Je propose mes services</button>
        </div>
        <div class="com-grille-champs">
          <label class="com-champ">
            <span>Métier</span>
            <select data-c="role">${S.ref.metiers.map(m => `<option value="${attr(m.cle)}">${esc(m.icone)} ${esc(m.libelle)}</option>`).join('')}</select>
          </label>
          <label class="com-champ">
            <span>Ville ou région <i>(facultatif)</i></span>
            <input type="text" data-c="lieu" maxlength="60" placeholder="Paris, Lyon, à distance…" autocomplete="off">
          </label>
        </div>
        <div class="com-champ">
          <span>Styles <i>(5 au plus)</i></span>
          <div class="com-styles" data-c="styles">
            <span class="com-styles-liste"></span>
            <input type="text" data-c="style-saisie" maxlength="24" placeholder="Trap, drill, boom bap…" autocomplete="off" aria-label="Ajouter un style">
          </div>
        </div>
        <div class="com-champ">
          <span>Rémunération</span>
          <div class="com-seg com-seg-rem" role="radiogroup" aria-label="Rémunération">
            ${Object.keys(REMUNERATIONS).map(k => `
              <button type="button" role="radio" class="com-seg-btn" data-act="c-remu" data-remu="${k}">${esc(REMUNERATIONS[k].libelle)}</button>`).join('')}
          </div>
        </div>
      </div>

      <div class="com-comp-lien" data-c="bloc-lien" hidden>
        <span class="com-comp-lien-ic">${icone('lien', 17)}</span>
        <input type="url" data-c="lien" maxlength="500" placeholder="Lien YouTube, Spotify, SoundCloud, Deezer…" autocomplete="off" aria-label="Lien">
      </div>

      <div class="com-comp-images" data-c="images"></div>

      <div class="com-comp-pied">
        <div class="com-comp-outils">
          <button type="button" class="com-icone-btn" data-act="c-image" aria-label="Ajouter une image" title="Ajouter une image">${icone('image', 20)}</button>
          <button type="button" class="com-icone-btn" data-act="c-lien" aria-label="Ajouter un lien" title="Ajouter un lien">${icone('lien', 20)}</button>
          <label class="com-select-sujet" data-c="bloc-sujet">
            <span class="sr-only">Sujet</span>
            <select data-c="sujet">${sujetsPourMoi().map(s => `<option value="${attr(s.cle)}">${esc(s.icone)} ${esc(s.libelle)}</option>`).join('')}</select>
          </label>
          <input type="file" data-c="fichiers" accept="image/jpeg,image/png,image/webp" multiple hidden>
        </div>
        <div class="com-comp-envoi">
          <span class="com-compteur" data-c="compteur" aria-live="off"></span>
          <button type="button" class="com-btn com-btn-fantome com-btn-petit" data-act="c-annuler">Fermer</button>
          <button type="button" class="com-btn com-btn-plein" data-act="c-publier" data-c="publier" disabled>Publier</button>
        </div>
      </div>
    </div>`;
}

function placeholderComposer(type){
  return {
    message:  'Partage une idée, une actu, une question…',
    question: 'Pose ta question à la communauté…',
    son:      'Dis-en quelques mots : ce que tu as fait, ce que tu veux comme retour…',
    collab:   'Présente ton projet, ce que tu attends de la collaboration…'
  }[type] || 'Écris ton message…';
}

// Monte un compositeur dans un conteneur. opts.apres(post) est appelé avec
// le message publié.
function monterComposer(conteneur, opts){

  const o = opts || {};
  const u = moi();

  conteneur.classList.add('com-composer-hote');

  // Visiteur : une invitation plutôt qu'un champ qu'il ne pourrait pas utiliser.
  if(!u){
    conteneur.innerHTML = `
      <div class="com-carte com-invitation">
        <div class="com-invitation-texte">
          <b>Rejoins la conversation</b>
          <span>Connecte-toi pour publier, commenter, suivre des artistes et écrire aux membres.</span>
        </div>
        <div class="com-invitation-actions">
          <button type="button" class="com-btn com-btn-plein" data-act="connexion" data-mode="signup">Créer un compte</button>
          <button type="button" class="com-btn com-btn-fantome" data-act="connexion" data-mode="login">Se connecter</button>
        </div>
      </div>`;
    return null;
  }

  const brouillon = lireBrouillon(o.nom || 'accueil');

  const inst = {
    nom: o.nom || 'accueil',
    apres: o.apres,
    type: o.typeInitial || (brouillon && TYPES_POST[brouillon.type] ? brouillon.type : 'message'),
    sujet: (brouillon && brouillon.sujet) || 'general',
    texte: (brouillon && brouillon.texte) || '',
    lien: (brouillon && brouillon.lien) || '',
    lienOuvert: !!(brouillon && brouillon.lien),
    collab: Object.assign(collabParDefaut(), (brouillon && brouillon.collab) || {}),
    images: [],
    ouvert: false,
    envoi: false,
    racine: conteneur
  };

  if(o.typeInitial && o.typeInitial !== 'message') inst.lienOuvert = o.typeInitial === 'son' || inst.lienOuvert;
  if(!sujetsPourMoi().some(s => s.cle === inst.sujet)) inst.sujet = 'general';

  conteneur.innerHTML = `<div class="com-carte com-composer" data-ouvert="false">${composerFermeHtml()}</div>`;
  conteneur.firstElementChild.__inst = inst;
  inst.carte = conteneur.firstElementChild;

  // Un brouillon enregistré se retrouve : la carte s'ouvre sur lui.
  if(brouillon && (brouillon.texte || brouillon.lien) && !o.typeInitial){
    ouvrirComposer(inst, { sansFocus: true, sansAnimation: true });
  } else if(o.ouvert){
    ouvrirComposer(inst, { sansFocus: !o.focus, sansAnimation: true });
  }

  return inst;
}

function champ(inst, nom){
  return $('[data-c="' + nom + '"]', inst.carte);
}

function ouvrirComposer(inst, o){

  const opt = o || {};

  if(!inst.ouvert){

    inst.ouvert = true;
    if(S.coque) S.coque.dataset.comp = '1';

    const appliquer = () => {
      inst.carte.dataset.ouvert = 'true';
      inst.carte.innerHTML = composerOuvertHtml(inst);
      initialiserChampsComposer(inst);
    };

    if(opt.sansAnimation) appliquer(); else animerHauteur(inst.carte, appliquer);
  }

  if(opt.type) definirTypeComposer(inst, opt.type, true);

  if(opt.image){
    const f = champ(inst, 'fichiers');
    if(f) f.click();
  }

  if(!opt.sansFocus){
    const t = champ(inst, 'texte');
    if(t) t.focus({ preventScroll: false });
  }
}

function initialiserChampsComposer(inst){

  const t = champ(inst, 'texte');
  t.value = inst.texte;
  ajusterTexte(t);
  brancherMentions(t);

  champ(inst, 'sujet').value = inst.sujet;
  champ(inst, 'role').value = inst.collab.role;
  champ(inst, 'lieu').value = inst.collab.lieu || '';
  champ(inst, 'lien').value = inst.lien;

  majComposerType(inst);
  majComposerCollab(inst);
  majComposerImages(inst);
  majComposerBouton(inst);
}

function definirTypeComposer(inst, type, focaliser){

  if(!TYPES_POST[type]) return;

  inst.type = type;

  if(type === 'son') inst.lienOuvert = true;

  majComposerType(inst);
  majComposerBouton(inst);
  ecrireBrouillon(inst.nom, inst);

  if(focaliser){
    const cible = type === 'son' ? champ(inst, 'lien') : champ(inst, 'texte');
    if(cible) cible.focus({ preventScroll: true });
  }
}

function majComposerType(inst){

  $$('.com-comp-types .com-chip', inst.carte).forEach(b => {
    const actif = b.dataset.type === inst.type;
    b.classList.toggle('actif', actif);
    b.setAttribute('aria-checked', actif ? 'true' : 'false');
  });

  const t = champ(inst, 'texte');
  if(t) t.placeholder = placeholderComposer(inst.type);

  const collab = champ(inst, 'collab');
  const voulu = inst.type === 'collab';

  if(collab && collab.hidden === voulu){
    collab.hidden = !voulu;
    if(voulu && collab.animate && !mouvementReduit()){
      collab.animate([{ opacity: 0, transform: 'translateY(-6px)' }, { opacity: 1, transform: 'none' }],
        { duration: 280, easing: 'cubic-bezier(.16,1,.3,1)' });
    }
  }

  const blocLien = champ(inst, 'bloc-lien');
  const lienVisible = inst.lienOuvert || inst.type === 'son';

  if(blocLien && blocLien.hidden === lienVisible){
    blocLien.hidden = !lienVisible;
    if(lienVisible && blocLien.animate && !mouvementReduit()){
      blocLien.animate([{ opacity: 0, transform: 'translateY(-6px)' }, { opacity: 1, transform: 'none' }],
        { duration: 260, easing: 'cubic-bezier(.16,1,.3,1)' });
    }
  }

  // Une annonce n'a pas de sujet : elle vit dans l'onglet Collabs.
  const sujet = champ(inst, 'bloc-sujet');
  if(sujet) sujet.hidden = inst.type === 'collab';
}

function majComposerCollab(inst){

  const c = inst.collab;

  $$('.com-seg-btn[data-mode]', inst.carte).forEach(b => {
    const actif = b.dataset.mode === c.mode;
    b.classList.toggle('actif', actif);
    b.setAttribute('aria-checked', actif ? 'true' : 'false');
  });

  $$('.com-seg-btn[data-remu]', inst.carte).forEach(b => {
    const actif = b.dataset.remu === c.remuneration;
    b.classList.toggle('actif', actif);
    b.setAttribute('aria-checked', actif ? 'true' : 'false');
  });

  const liste = $('.com-styles-liste', inst.carte);

  if(liste){
    liste.innerHTML = c.styles.map((s, i) => `
      <span class="com-puce retirable">${esc(s)}
        <button type="button" data-act="c-style-retirer" data-i="${i}" aria-label="Retirer ${attr(s)}">${icone('croix', 11)}</button>
      </span>`).join('');
  }

  const saisie = champ(inst, 'style-saisie');
  if(saisie) saisie.hidden = c.styles.length >= 5;
}

function ajouterStyle(inst, valeur){

  const s = String(valeur || '').replace(/^#/, '').replace(/[,;]+/g, ' ').trim().slice(0, 24);

  if(s.length < 2) return false;

  const c = inst.collab;

  if(c.styles.length >= 5) return false;
  if(c.styles.some(x => x.toLowerCase() === s.toLowerCase())) return true;

  c.styles.push(s);
  majComposerCollab(inst);
  ecrireBrouillon(inst.nom, inst);
  return true;
}

function majComposerImages(inst){

  const zone = champ(inst, 'images');

  if(!zone) return;

  zone.hidden = !inst.images.length;

  zone.innerHTML = inst.images.map((im, i) => `
    <div class="com-vignette${im.etat === 'envoi' ? ' envoi' : ''}${im.etat === 'erreur' ? ' erreur' : ''}">
      <img src="${attr(im.local)}" alt="Image ${i + 1}">
      ${im.etat === 'envoi' ? '<span class="com-vignette-etat"><i class="com-rond"></i></span>' : ''}
      ${im.etat === 'erreur' ? `<span class="com-vignette-etat err" title="${attr(im.erreur || '')}">!</span>` : ''}
      <button type="button" class="com-vignette-x" data-act="c-image-retirer" data-i="${i}" aria-label="Retirer l'image">${icone('croix', 13)}</button>
    </div>`).join('');
}

function composerPret(inst){

  const texte = inst.texte.trim();
  const lien = inst.lien.trim();
  const envoyees = inst.images.filter(i => i.etat === 'ok');
  const enCours = inst.images.some(i => i.etat === 'envoi');

  if(inst.envoi || enCours) return false;
  if(texte.length > 2000) return false;
  if(!texte && !envoyees.length && !lien) return false;
  if(inst.type === 'son' && !lien && !envoyees.length) return false;
  if(inst.type === 'collab' && (!inst.collab.role || !inst.collab.mode)) return false;
  if(lien && !/^https?:\/\/\S+$/i.test(lien)) return false;

  return true;
}

function majComposerBouton(inst){

  const b = champ(inst, 'publier');
  const compteur = champ(inst, 'compteur');

  if(!b) return;

  const reste = 2000 - inst.texte.length;
  const enCours = inst.images.some(i => i.etat === 'envoi');

  b.disabled = !composerPret(inst);
  b.textContent = inst.envoi ? 'Publication…' : enCours ? 'Envoi des images…' : 'Publier';

  if(compteur){
    compteur.textContent = reste < 300 ? String(reste) : '';
    compteur.classList.toggle('rouge', reste < 0);
    compteur.classList.toggle('orange', reste >= 0 && reste < 100);
  }
}

async function ajouterImages(inst, fichiers){

  const liste = Array.from(fichiers || []);

  if(!liste.length) return;

  const places = IMAGES_MAX - inst.images.length;

  if(places <= 0){
    toast('Quatre images au plus par message.', { type: 'erreur', icone: '🖼️' });
    return;
  }

  if(liste.length > places) toast('Seules les ' + places + ' premières images sont gardées.', { type: 'info', icone: '🖼️' });

  await Promise.all(liste.slice(0, places).map(async (f) => {

    const im = { local: URL.createObjectURL(f), etat: 'envoi', url: null };
    inst.images.push(im);
    majComposerImages(inst);
    majComposerBouton(inst);

    try{
      const blob = await preparerImage(f);
      // Le nom porte l'identifiant de l'auteur : la base ne publie que les
      // images qui se présentent ainsi, et ne retire que les siennes.
      const nom = 'com-' + moi().id + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7) + '.jpg';
      im.url = await Fichiers.envoyer(blob, nom, 'image/jpeg');
      im.etat = 'ok';
      URL.revokeObjectURL(im.local);
      im.local = URL.createObjectURL(blob);
    }catch(e){
      im.etat = 'erreur';
      im.erreur = message(e);
      toast(message(e), { type: 'erreur', icone: '🖼️' });
      // Une image qui n'est pas partie ne reste pas dans la liste.
      setTimeout(() => {
        const i = inst.images.indexOf(im);
        if(i >= 0){ inst.images.splice(i, 1); majComposerImages(inst); majComposerBouton(inst); }
      }, 1400);
    }

    majComposerImages(inst);
    majComposerBouton(inst);
  }));
}

function retirerImage(inst, i){

  const im = inst.images[i];

  if(!im) return;

  inst.images.splice(i, 1);

  // Déjà envoyée mais jamais publiée : on la retire du stockage.
  if(im.url) Fichiers.supprimerParUrl(im.url);

  majComposerImages(inst);
  majComposerBouton(inst);
}

function fermerComposer(inst, effacer){

  const refermer = () => {

    inst.ouvert = false;
    if(S.coque) S.coque.dataset.comp = '0';

    if(effacer){
      inst.texte = '';
      inst.lien = '';
      inst.lienOuvert = false;
      inst.type = 'message';
      inst.collab = collabParDefaut();
      inst.images = [];
      ecrireBrouillon(inst.nom, inst);
    }

    inst.carte.dataset.ouvert = 'false';
    inst.carte.innerHTML = composerFermeHtml();
  };

  animerHauteur(inst.carte, refermer);
}

async function publierComposer(inst){

  if(!composerPret(inst)) return;

  inst.envoi = true;
  majComposerBouton(inst);

  const images = inst.images.filter(i => i.etat === 'ok').map(i => i.url);

  const args = {
    p_contenu: inst.texte.trim(),
    p_type: inst.type,
    p_sujet: inst.type === 'collab' ? 'general' : inst.sujet,
    p_images: images,
    p_lien: inst.lien.trim() || null,
    p_collab: inst.type === 'collab'
      ? { mode: inst.collab.mode, role: inst.collab.role, styles: inst.collab.styles,
          lieu: inst.collab.lieu.trim() || null, remuneration: inst.collab.remuneration }
      : null
  };

  try{

    const post = regPost(await BD.publier(args));

    inst.envoi = false;
    // Les images sont désormais dans un message : on ne les supprimera plus.
    inst.images = [];
    fermerComposer(inst, true);

    if(inst.apres) inst.apres(post);

    toast(inst.type === 'collab' ? 'Annonce publiée' : 'Message publié', { icone: '✨' });

    try{ if(typeof awardXP === 'function') awardXP('postForum', 10); }catch(e){}

  }catch(e){
    inst.envoi = false;
    majComposerBouton(inst);
    toastErreur(e);
  }
}

// Les clics et saisies du compositeur. Retourne vrai si l'événement le concernait.
function agirComposer(act, cible, e){

  const carte = cible.closest('.com-composer');

  if(!carte || !carte.__inst) return false;

  const inst = carte.__inst;

  switch(act){

    case 'c-ouvrir':
      e.stopPropagation();
      ouvrirComposer(inst, {
        type: cible.dataset.type || null
      });
      return true;

    case 'c-annuler':
      fermerComposer(inst, false);
      return true;

    case 'c-type':
      definirTypeComposer(inst, cible.dataset.type, true);
      return true;

    case 'c-mode':
      inst.collab.mode = cible.dataset.mode;
      majComposerCollab(inst);
      majComposerBouton(inst);
      ecrireBrouillon(inst.nom, inst);
      return true;

    case 'c-remu':
      inst.collab.remuneration = cible.dataset.remu;
      majComposerCollab(inst);
      ecrireBrouillon(inst.nom, inst);
      return true;

    case 'c-style-retirer':
      inst.collab.styles.splice(Number(cible.dataset.i), 1);
      majComposerCollab(inst);
      ecrireBrouillon(inst.nom, inst);
      return true;

    case 'c-image':
      champ(inst, 'fichiers').click();
      return true;

    case 'c-image-retirer':
      retirerImage(inst, Number(cible.dataset.i));
      return true;

    case 'c-lien':
      inst.lienOuvert = !inst.lienOuvert;
      majComposerType(inst);
      if(inst.lienOuvert) champ(inst, 'lien').focus();
      return true;

    case 'c-publier':
      publierComposer(inst);
      return true;
  }

  return false;
}

// Saisies : texte, lien, ville, styles, sujet, métier, fichiers.
function saisirComposer(cible, e){

  const carte = cible.closest('.com-composer');

  if(!carte || !carte.__inst) return false;

  const inst = carte.__inst;
  const nom = cible.dataset.c;

  if(!nom) return false;

  if(e.type === 'input'){

    if(nom === 'texte'){
      inst.texte = cible.value;
      ajusterTexte(cible);
      majComposerBouton(inst);
      ecrireBrouillon(inst.nom, inst);
      return true;
    }

    if(nom === 'lien'){
      inst.lien = cible.value;
      majComposerBouton(inst);
      ecrireBrouillon(inst.nom, inst);
      return true;
    }

    if(nom === 'lieu'){
      inst.collab.lieu = cible.value;
      ecrireBrouillon(inst.nom, inst);
      return true;
    }

    if(nom === 'style-saisie'){
      // Une virgule valide le style en cours de frappe.
      if(/[,;]/.test(cible.value)){
        if(ajouterStyle(inst, cible.value)) cible.value = '';
        else cible.value = cible.value.replace(/[,;]/g, '');
      }
      return true;
    }
  }

  if(e.type === 'change'){

    if(nom === 'sujet'){ inst.sujet = cible.value; ecrireBrouillon(inst.nom, inst); return true; }

    if(nom === 'role'){ inst.collab.role = cible.value; majComposerBouton(inst); ecrireBrouillon(inst.nom, inst); return true; }

    if(nom === 'fichiers'){
      const fichiers = Array.from(cible.files || []);
      cible.value = '';
      ajouterImages(inst, fichiers);
      return true;
    }
  }

  return false;
}

function clavierComposer(cible, e){

  const carte = cible.closest('.com-composer');

  if(!carte || !carte.__inst) return false;

  const inst = carte.__inst;

  if(cible.classList.contains('com-comp-texte') && e.key === 'Enter' && (e.ctrlKey || e.metaKey)){
    e.preventDefault();
    publierComposer(inst);
    return true;
  }

  if(cible.dataset.c === 'style-saisie'){
    if(e.key === 'Enter'){
      e.preventDefault();
      if(ajouterStyle(inst, cible.value)) cible.value = '';
      return true;
    }
    if(e.key === 'Backspace' && !cible.value && inst.collab.styles.length){
      inst.collab.styles.pop();
      majComposerCollab(inst);
      return true;
    }
  }

  if(e.key === 'Escape' && inst.ouvert && !inst.texte.trim() && !inst.lien && !inst.images.length && !calqueCourant){
    fermerComposer(inst, true);
    return true;
  }

  return false;
}

// Coller une image, ou en déposer une sur la carte.
function imagesDuPresse(e){
  const dt = e.clipboardData || e.dataTransfer;
  return dt && dt.files ? Array.from(dt.files).filter(f => f.type.startsWith('image/')) : [];
}



// ---------------------------------------------------------------------
// Une liste de messages qui se charge au fil du défilement
//
// Utilisée par le fil, les sujets, les mots-clics, les favoris, les
// profils et les annonces : elle charge la première page, la suite quand
// on approche du bas, et prévient quand de nouveaux messages sont arrivés.
// ---------------------------------------------------------------------

const TOUTES_LES_LISTES = new Set();

function creerListe(el, o){

  const L = {
    el, o,
    posts: [],
    fin: false,
    enCours: false,
    gen: 0,
    charge: false,
    chargeLe: 0,
    erreur: null,
    pilule: null,
    nouveaux: 0,
    minuteur: null,
    observateur: null,
    chaine: 0
  };

  L.visibles = () => o.filtre ? L.posts.filter(o.filtre) : L.posts;

  L.bas = () => {

    let bas = $(':scope > .com-bas', el);

    if(!bas){
      bas = document.createElement('div');
      bas.className = 'com-bas';
      bas.innerHTML = '<div class="com-sentinelle"></div><div class="com-bas-etat"></div>';
      el.appendChild(bas);
    }

    return bas;
  };

  L.majBas = () => {

    const etat = $('.com-bas-etat', L.bas());

    if(L.erreur && !L.enCours){
      etat.innerHTML = `<button type="button" class="com-btn com-btn-fantome com-btn-petit" data-act="liste-plus">Réessayer</button>`;
    } else if(L.enCours && L.posts.length){
      etat.innerHTML = '<span class="com-rond grand" role="status" aria-label="Chargement"></span>';
    } else if(L.fin && L.visibles().length > 6){
      etat.innerHTML = `<span class="com-fin">${icone('coche', 14)} Tu as tout vu</span>`;
    } else {
      etat.innerHTML = '';
    }
  };

  L.observer = () => {

    if(L.observateur || !('IntersectionObserver' in window)) return;

    L.observateur = new IntersectionObserver((entrees) => {
      if(entrees.some(x => x.isIntersecting)) L.plus();
    }, { rootMargin: '700px 0px' });

    L.observateur.observe($('.com-sentinelle', L.bas()));
  };

  L.recharger = async (options) => {

    const opt = options || {};
    const id = ++L.gen;

    L.enCours = true;
    L.erreur = null;
    L.fin = false;
    L.nouveaux = 0;
    L.chaine = 0;
    L.majPilule();

    // Un changement de filtre repart de zéro : des squelettes, puis les messages.
    if(!opt.silencieux){
      L.posts = [];
      el.innerHTML = o.squelette || squelettePost(3);
    }

    try{

      const r = await BD.fil(Object.assign({ p_limite: 15 }, o.args()));

      if(id !== L.gen) return;

      const liste = (r.posts || []).map(regPost);

      L.posts = liste;
      L.fin = !!r.fin;
      L.charge = true;
      L.chargeLe = Date.now();
      L.enCours = false;

      L.dessiner(!opt.silencieux);
      L.observer();

      if(o.surCharge) o.surCharge(L);

    }catch(e){

      if(id !== L.gen) return;

      L.enCours = false;

      // Une relecture discrète qui échoue ne remplace pas ce qui est affiché.
      if(opt.silencieux && L.charge) return;

      L.erreur = e;
      el.innerHTML = etatErreur(e, true);
      if(e && e.installation) S.installation = true;
    }
  };

  // Redessine toute la liste visible.
  L.dessiner = (anime) => {

    const visibles = L.visibles();

    if(!visibles.length){
      el.innerHTML = L.fin ? (o.vide ? o.vide() : etatVide({ titre: 'Rien pour le moment' })) : '';
      if(!L.fin){ L.bas(); L.majBas(); }
      else { /* rien */ }
      L.observateurPerdu();
      return;
    }

    const cartes = visibles.map(p => o.rendu ? o.rendu(p) : postHtml(p));
    const inter = o.intercalaire ? o.intercalaire() : null;

    if(inter && cartes.length > inter.apres) cartes.splice(inter.apres, 0, inter.html);

    el.innerHTML = cartes.join('');
    L.bas();
    L.majBas();
    L.observateurPerdu();

    if(anime) entrerEnCascade($$(':scope > .com-carte', el), 45);

    L.continuerSiPeu();
  };

  // Le conteneur a été vidé : l'observateur ne voit plus son repère.
  L.observateurPerdu = () => {
    if(L.observateur){ L.observateur.disconnect(); L.observateur = null; }
    if($('.com-sentinelle', el)) L.observer();
  };

  // Avec un filtre côté navigateur, la première page peut presque rien
  // contenir : on va chercher la suite sans attendre le défilement.
  L.continuerSiPeu = () => {
    if(o.filtre && !L.fin && !L.enCours && L.visibles().length < 5 && L.chaine < 6){
      L.chaine++;
      L.plus();
    }
  };

  L.plus = async () => {

    if(L.enCours || L.fin || !L.charge) return;

    const id = L.gen;
    L.enCours = true;
    L.erreur = null;
    L.majBas();

    const args = Object.assign({ p_limite: 15 }, o.args());

    if(o.mode === 'decalage') args.p_decalage = L.posts.length;
    else if(L.posts.length) args.p_avant = L.posts[L.posts.length - 1].cree_le;

    try{

      const r = await BD.fil(args);

      if(id !== L.gen) return;

      const connus = new Set(L.posts.map(p => p.id));
      const neufs = (r.posts || []).map(regPost).filter(p => !connus.has(p.id));

      L.posts = L.posts.concat(neufs);
      L.fin = !!r.fin;
      L.enCours = false;

      const visibles = o.filtre ? neufs.filter(o.filtre) : neufs;
      const bas = L.bas();

      if(visibles.length){
        const vide = document.createElement('div');
        vide.innerHTML = visibles.map(p => o.rendu ? o.rendu(p) : postHtml(p)).join('');
        const cartes = Array.from(vide.children);
        cartes.forEach(c => el.insertBefore(c, bas));
        entrerEnCascade(cartes, 35);
      }

      L.majBas();
      L.continuerSiPeu();

    }catch(e){

      if(id !== L.gen) return;

      L.enCours = false;
      L.erreur = e;
      L.majBas();
    }
  };

  // Un message à peine publié par le lecteur : en tête, avec une entrée.
  L.inserer = (post) => {

    if(L.posts.some(p => p.id === post.id)) return;

    L.posts.unshift(post);

    if(o.filtre && !o.filtre(post)) return;

    // Les messages épinglés restent tout en haut.
    const premier = $(':scope > .com-carte:not(.epingle)', el);

    // Dans une liste vide, l'état « rien ici » laisse la place.
    const vide = $(':scope > .com-vide', el);
    if(vide) vide.remove();

    const tmp = document.createElement('div');
    tmp.innerHTML = (o.rendu ? o.rendu(post) : postHtml(post)).trim();
    const carte = tmp.firstElementChild;

    if(premier) el.insertBefore(carte, premier);
    else el.insertBefore(carte, L.bas());

    L.bas();
    entrerEnCascade([carte]);
  };

  L.retirer = (id) => {
    const i = L.posts.findIndex(p => p.id === id);
    if(i >= 0) L.posts.splice(i, 1);
  };

  // --- Nouveaux messages arrivés pendant la lecture ---

  L.majPilule = () => {

    if(!o.pilule) return;

    if(!L.pilule){
      L.pilule = document.createElement('button');
      L.pilule.type = 'button';
      L.pilule.className = 'com-pilule';
      L.pilule.dataset.act = 'liste-nouveaux';
      L.pilule.hidden = true;
      el.parentNode.insertBefore(L.pilule, el);
    }

    if(L.nouveaux > 0){
      L.pilule.innerHTML = `${icone('flecheHaut', 15)} ${L.nouveaux >= 15 ? '15+' : L.nouveaux} nouveau${L.nouveaux > 1 ? 'x' : ''} message${L.nouveaux > 1 ? 's' : ''}`;
      if(L.pilule.hidden){
        L.pilule.hidden = false;
        if(L.pilule.animate && !mouvementReduit()){
          L.pilule.animate([{ opacity: 0, transform: 'translateY(-12px) scale(.9)' }, { opacity: 1, transform: 'none' }],
            { duration: 320, easing: 'cubic-bezier(.34,1.56,.64,1)' });
        }
      }
    } else {
      L.pilule.hidden = true;
    }
  };

  L.verifierNouveaux = async () => {

    // Les tendances ne se rangent pas par date : « nouveaux messages » n'y a pas de sens.
    if(!o.pilule || o.mode === 'decalage' || !L.charge || L.enCours || inactif()) return;

    const ref = L.posts.find(p => !p.epingle);

    if(!ref) return;

    const g = L.gen;

    try{
      const r = await BD.fil(Object.assign({ p_limite: 15 }, o.args(), { p_apres: ref.cree_le }));

      // Le filtre a changé pendant l'attente : cette réponse ne le concerne plus.
      if(g !== L.gen) return;

      const connus = new Set(L.posts.map(p => p.id));
      L.nouveaux = (r.posts || []).filter(p => !connus.has(p.id)).length;
      L.majPilule();
    }catch(e){}
  };

  L.afficherNouveaux = async () => {

    // Plus de quinze nouveaux messages : un trou se creuserait entre eux et ce
    // qui est affiché. On repart d'une liste fraîche.
    if(L.nouveaux >= 15){
      L.nouveaux = 0;
      L.majPilule();
      await L.recharger();
      window.scrollTo({ top: Math.max(0, el.getBoundingClientRect().top + window.scrollY - 160), behavior: mouvementReduit() ? 'auto' : 'smooth' });
      return;
    }

    const ref = L.posts.find(p => !p.epingle);

    try{
      const r = await BD.fil(Object.assign({ p_limite: 15 }, o.args(), ref ? { p_apres: ref.cree_le } : {}));
      const connus = new Set(L.posts.map(p => p.id));
      const neufs = (r.posts || []).map(regPost).filter(p => !connus.has(p.id));

      neufs.reverse().forEach(p => L.inserer(p));
    }catch(e){
      toastErreur(e);
    }

    L.nouveaux = 0;
    L.majPilule();
    window.scrollTo({ top: Math.max(0, el.getBoundingClientRect().top + window.scrollY - 160), behavior: mouvementReduit() ? 'auto' : 'smooth' });
  };

  L.demarrer = () => {
    L.arreter();
    if(o.pilule) L.minuteur = setInterval(L.verifierNouveaux, 45000);
  };

  L.arreter = () => {
    if(L.minuteur){ clearInterval(L.minuteur); L.minuteur = null; }
  };

  L.detruire = () => {
    L.arreter();
    if(L.observateur) L.observateur.disconnect();
    TOUTES_LES_LISTES.delete(L);
  };

  TOUTES_LES_LISTES.add(L);

  return L;
}

function listeDe(element){

  for(const L of TOUTES_LES_LISTES){
    if(L.el.contains(element) || L.el === element) return L;
  }

  return null;
}


// ---------------------------------------------------------------------
// Les vues
//
// Chaque vue sait se construire (creer), se montrer à chaque visite
// (montrer) et se mettre en pause quand on la quitte (pause). Elles
// restent en vie dans la page : revenir sur le fil le retrouve là où on
// l'avait laissé.
// ---------------------------------------------------------------------

const VUES = {};

// Le sujet du fil se choisit dans un petit menu, à droite des onglets : un bouton qui dit le sujet courant.
function rangSujets(actif){

  const sujet = actif ? S.ref.sujets.find(x => x.cle === actif) : null;

  return `
    <button type="button" class="com-sujet-bouton${sujet ? ' filtre' : ''}" data-act="sujet-menu" aria-haspopup="menu"
            aria-label="Filtrer par sujet : ${attr(sujet ? sujet.libelle : 'tous les sujets')}">
      ${sujet ? `<i class="com-pt" style="--sj:${attr(couleurSujet(sujet.cle))}" aria-hidden="true"></i>` : ''}
      <span>${esc(sujet ? sujet.libelle : 'Tous les sujets')}</span>
      ${icone('chevronBas', 15)}
    </button>`;
}

function menuSujets(ancre, V){

  const actif = V.etat.sujet;

  ouvrirMenu(ancre, [
    { libelle: 'Tous les sujets', actif: !actif, action: () => VUES.accueil.changerSujet(V, null) },
    ...S.ref.sujets.map(s => ({
      libelle: s.libelle, point: couleurSujet(s.cle), actif: actif === s.cle,
      action: () => VUES.accueil.changerSujet(V, s.cle)
    }))
  ]);
}

// --- Accueil : le fil -------------------------------------------------

const ONGLETS_FIL = [
  { cle: 'recent', libelle: 'Récents' },
  { cle: 'abonnements', libelle: 'Abonnements' },
  { cle: 'tendances', libelle: 'Tendances' }
];

// Une collab, en petit : ce qu'on cherche ou propose, et qui.
function collabMiniHtml(p){

  const c = p.collab || {};
  const m = metierInfo(c.role);
  const a = p.auteur || {};
  const cherche = c.mode === 'cherche';

  return `
    <a class="com-collab-mini" data-mode="${attr(c.mode)}" href="#community/post/${attr(encodeURIComponent(p.id))}"
       data-act="aller" data-vers="post/${attr(encodeURIComponent(p.id))}">
      <span class="com-collab-mini-haut">
        <span class="com-collab-mini-ic">${esc(m.icone)}</span>
        <span class="com-collab-mini-titre"><small>${cherche ? 'Cherche' : 'Propose'}</small><b>${esc(m.libelle)}</b></span>
      </span>
      <span class="com-collab-mini-meta">${c.lieu ? icone('lieu', 12) + ' ' + esc(c.lieu) : '&nbsp;'}</span>
      <span class="com-collab-mini-qui">${avatarHtml(a, 's')}<span>${esc(a.pseudo || '')}</span></span>
    </a>`;
}

function personneMiniHtml(m){
  return `
    <div class="com-carte com-ruban-carte" data-membre="${attr(m.id)}">
      <a class="com-ruban-lien" href="#community/membre/${attr(encodeURIComponent(m.pseudo))}" data-act="membre" data-cle="${attr(m.pseudo)}">
        ${avatarHtml(m, 'l')}
        <b>${esc(m.pseudo)}</b>
        <span>${esc(roleInfo(m.role).icon)} ${esc(roleInfo(m.role).name)}</span>
        ${m.raisons && m.raisons.length ? `<em>${esc(RAISONS[m.raisons[0]] || '')}</em>` : '<em>&nbsp;</em>'}
      </a>
      ${boutonSuivre(m, !!(m.moi && m.moi.suit))}
    </div>`;
}

// Les collabs ouvertes, gardées une minute.
async function collabsDuMoment(){

  if(S.collabsRecentes && Date.now() - S.collabsLe < 60000) return S.collabsRecentes;

  const r = await BD.fil({ p_vue: 'recent', p_type: 'collab', p_limite: 6 });

  S.collabsRecentes = (r.posts || []).map(regPost);
  S.collabsLe = Date.now();

  return S.collabsRecentes;
}

VUES.accueil = {

  titre: () => 'Communauté',

  creer(V){

    V.etat = { onglet: 'recent', sujet: null };

    V.el.innerHTML = `
      <div data-hote="onboarding"></div>
      <div data-hote="composer" class="com-hote-composer"></div>
      <div class="com-filtres">
        <div class="com-filtres-ligne">
          <div data-hote="onglets"></div>
          <div data-hote="sujets" class="com-sujets-hote"></div>
        </div>
        <div data-hote="tendances" class="com-tendances-ligne" hidden></div>
      </div>
      <div class="com-liste" data-liste></div>
      <p class="com-regles">Reste bienveillant : pas de spam, pas d'insultes. Un message qui dérape se signale depuis son menu ⋯</p>`;

    V.hotes = {
      onboarding: $('[data-hote="onboarding"]', V.el),
      composer: $('[data-hote="composer"]', V.el),
      sujets: $('[data-hote="sujets"]', V.el),
      onglets: $('[data-hote="onglets"]', V.el),
      tendances: $('[data-hote="tendances"]', V.el)
    };

    V.composer = monterComposer(V.hotes.composer, {
      nom: 'accueil',
      apres: (post) => VUES.accueil.apresPublication(V, post)
    });

    V.hotes.sujets.innerHTML = rangSujets(null);
    V.hotes.onglets.innerHTML = ongletsHtml(ONGLETS_FIL, 'recent');

    V.liste = creerListe($('[data-liste]', V.el), {
      pilule: true,
      args: () => {
        const e = V.etat;
        return { p_vue: e.onglet, p_sujet: e.sujet };
      },
      mode: 'cursor',
      squelette: squelettePost(3),
      vide: () => VUES.accueil.vide(V),
      // Au bout de trois messages, un bloc pour découvrir collabs et personnes.
      intercalaire: () => V.interHtml ? { apres: 3, html: V.interHtml } : null
    });
  },

  vide(V){

    const e = V.etat;

    if(e.onglet === 'abonnements'){

      if(!moi()){
        return etatVide({
          icone: 'utilisateurPlus', titre: 'Les gens que tu suis',
          texte: 'Connecte-toi pour suivre des artistes et voir leurs messages ici.',
          bouton: { libelle: 'Se connecter', attrs: 'data-act="connexion" data-mode="login"' }
        });
      }

      return etatVide({
        icone: 'utilisateurPlus', titre: 'Tu ne suis encore personne',
        texte: "Suis des artistes, des beatmakers ou des DJ : leurs messages arrivent ici.",
        bouton: { libelle: 'Trouver des gens', attrs: 'data-act="aller" data-vers="explorer"' }
      });
    }

    if(e.sujet){
      return etatVide({
        icone: 'bulle', titre: 'Personne n\'a encore écrit ici',
        texte: 'Lance la conversation sur ' + sujetInfo(e.sujet).libelle + '.'
      });
    }

    return etatVide({
      icone: 'bulle', titre: 'Le fil est tout neuf',
      texte: 'Sois le premier à écrire : présente-toi, partage un son, pose une question.'
    });
  },

  montrer(V){
    if(!V.liste.charge && !V.liste.enCours) V.liste.recharger();
    V.liste.demarrer();
    VUES.accueil.onboarding(V);
    VUES.accueil.decouvrir(V);
    VUES.accueil.tendances(V);
    // La barre sous l'onglet actif se cale quand la vue est à l'écran : cachée,
    // elle n'a pas de largeur à mesurer.
    placerBarreOnglets(V.hotes.onglets, false);
  },

  // Les mots-clics du moment, sous les sujets.
  async tendances(V){

    try{

      const t = await tendances(false);
      const tags = ((t && t.tags) || []).slice(0, 6);

      V.hotes.tendances.hidden = !tags.length;

      if(tags.length){
        V.hotes.tendances.innerHTML = `
          <span class="com-tendances-lib">${icone('tendance', 15)} En ce moment</span>
          ${tags.map(x => `<a class="com-tag-lien" href="#community/tag/${attr(encodeURIComponent(x.tag))}" data-act="tag" data-tag="${attr(x.tag)}">#${esc(x.tag)}<small>${x.n}</small></a>`).join('')}`;
      }

    }catch(e){}
  },

  // Le bloc « À découvrir » : les collabs ouvertes et des gens à suivre. Il se
  // glisse dans le fil après le troisième message.
  async decouvrir(V){

    if(V.decouvertLe && Date.now() - V.decouvertLe < 60000) return;

    try{

      const [collabs, personnes] = await Promise.all([collabsDuMoment().catch(() => []), suggestions(false).catch(() => [])]);

      V.decouvertLe = Date.now();

      if(!collabs.length && !personnes.length){ V.interHtml = null; return; }

      V.interHtml = `
        <section class="com-inter" aria-label="À découvrir">
          ${collabs.length ? `
            <div class="com-inter-bloc">
              <div class="com-inter-tete"><b>${icone('collabs', 17)} Collabs ouvertes</b><a href="#community/collabs" data-act="aller" data-vers="collabs">Tout voir</a></div>
              <div class="com-defile">${collabs.map(collabMiniHtml).join('')}</div>
            </div>` : ''}
          ${personnes.length ? `
            <div class="com-inter-bloc">
              <div class="com-inter-tete"><b>${icone('utilisateurPlus', 17)} ${moi() ? 'Gens à suivre' : 'À découvrir'}</b><a href="#community/explorer" data-act="aller" data-vers="explorer">Explorer</a></div>
              <div class="com-defile">${personnes.slice(0, 8).map(personneMiniHtml).join('')}</div>
            </div>` : ''}
        </section>`;

      // Le fil est déjà dessiné : le bloc y entre sans le redessiner.
      const liste = V.liste.el;
      const ancien = $(':scope > .com-inter', liste);

      if(ancien) ancien.remove();

      const cartes = $$(':scope > .com-carte', liste);

      if(cartes.length > 3){
        const tmp = document.createElement('div');
        tmp.innerHTML = V.interHtml.trim();
        const bloc = tmp.firstElementChild;
        cartes[2].after(bloc);
        entrerEnCascade([bloc]);
      }

    }catch(e){}
  },

  // « Pour bien démarrer » : les quatre premières étapes d'un compte. L'encart
  // disparaît quand elles sont toutes faites ; l'XP est donnée par le site
  // (checkOnboarding) dès qu'une étape est remplie.
  onboarding(V){

    const hote = V.hotes.onboarding;
    const u = moi();

    if(!u || typeof ONBOARDING_CHALLENGES === 'undefined'){ hote.innerHTML = ''; return; }

    const etat = u.onboarding || {};
    const etapes = ONBOARDING_CHALLENGES;
    const faites = etapes.filter(c => etat[c.key]).length;

    if(faites >= etapes.length){ hote.innerHTML = ''; return; }

    const actions = { avatarSet: 'onb-avatar', bioAdded: 'onb-reglages', socialsAdded: 'onb-reglages', firstPost: 'onb-post' };

    hote.innerHTML = `
      <section class="com-carte com-onb" aria-label="Pour bien démarrer">
        <div class="com-onb-tete">
          <div><b>Pour bien démarrer</b><span>${faites}/${etapes.length} · gagne de l'XP à chaque étape</span></div>
          <span class="com-onb-barre" aria-hidden="true">${etapes.map(c => `<i class="${etat[c.key] ? 'fait' : ''}"></i>`).join('')}</span>
        </div>
        <div class="com-onb-liste">
          ${etapes.filter(c => !etat[c.key]).map(c => `
            <button type="button" class="com-onb-etape" data-act="${actions[c.key] || 'onb-reglages'}">
              <span class="com-onb-coche"></span><span>${esc(c.label)}</span><em>+${c.xp} XP</em>
            </button>`).join('')}
        </div>
        <input type="file" data-c-avatar accept="image/jpeg,image/png,image/webp" hidden>
      </section>`;
  },

  pause(V){ V.liste.arreter(); },

  // Un message à peine publié : on l'affiche en tête, quel que soit le filtre
  // en cours (s'il le cachait, on revient au fil complet).
  apresPublication(V, post){

    const e = V.etat;
    const masque = e.onglet !== 'recent' || (e.sujet && e.sujet !== post.sujet);

    if(masque){
      e.onglet = 'recent';
      e.sujet = null;
      V.hotes.onglets.innerHTML = ongletsHtml(ONGLETS_FIL, 'recent');
      V.hotes.sujets.innerHTML = rangSujets(null);
      placerBarreOnglets(V.hotes.onglets, false);
      V.liste.recharger();
      return;
    }

    V.liste.inserer(post);
  },

  changerOnglet(V, onglet){

    if(V.etat.onglet === onglet) return;

    V.etat.onglet = onglet;
    $$('.com-onglet', V.hotes.onglets).forEach(b => {
      const actif = b.dataset.onglet === onglet;
      b.classList.toggle('actif', actif);
      b.setAttribute('aria-selected', actif ? 'true' : 'false');
    });
    placerBarreOnglets(V.hotes.onglets, true);

    V.liste.o.mode = onglet === 'tendances' ? 'decalage' : 'cursor';
    V.liste.recharger();
  },

  changerSujet(V, cle){

    const sujet = cle || null;

    if(V.etat.sujet === sujet) return;

    V.etat.sujet = sujet;
    V.hotes.sujets.innerHTML = rangSujets(sujet);
    V.liste.recharger();
  }
};

// --- Sujet, mot-clic, favoris -------------------------------------------

function enteteBandeau(o){
  return `
    <div class="com-carte com-bandeau">
      <span class="com-bandeau-ic">${o.icone}</span>
      <div class="com-bandeau-texte">
        <h2>${esc(o.titre)}</h2>
        ${o.texte ? `<p>${esc(o.texte)}</p>` : ''}
      </div>
    </div>`;
}

VUES.sujet = {

  titre: (V, route) => sujetInfo(route.param).libelle,
  retour: true,

  creer(V, route){

    const s = sujetInfo(route.param);

    V.el.innerHTML = `
      ${enteteBandeau({ icone: esc(s.icone), titre: s.libelle, texte: s.description })}
      <div class="com-liste" data-liste></div>`;

    V.liste = creerListe($('[data-liste]', V.el), {
      pilule: true,
      args: () => ({ p_vue: 'recent', p_sujet: route.param }),
      squelette: squelettePost(3),
      vide: () => etatVide({ icone: 'bulle', titre: "Personne n'a encore écrit ici", texte: 'Lance la conversation sur ' + s.libelle + '.' })
    });
  },

  montrer(V){
    if(!V.liste.charge && !V.liste.enCours) V.liste.recharger();
    V.liste.demarrer();
  },

  pause(V){ V.liste.arreter(); }
};

VUES.tag = {

  titre: (V, route) => '#' + route.param,
  retour: true,

  creer(V, route){

    V.el.innerHTML = `
      ${enteteBandeau({ icone: '#', titre: '#' + route.param, texte: 'Tous les messages qui portent ce mot-clic.' })}
      <div class="com-liste" data-liste></div>`;

    V.liste = creerListe($('[data-liste]', V.el), {
      pilule: true,
      args: () => ({ p_vue: 'recent', p_tag: route.param }),
      squelette: squelettePost(3),
      vide: () => etatVide({ icone: 'loupe', titre: 'Aucun message', texte: 'Personne n\'a encore utilisé #' + route.param + '.' })
    });
  },

  montrer(V){
    if(!V.liste.charge && !V.liste.enCours) V.liste.recharger();
    V.liste.demarrer();
  },

  pause(V){ V.liste.arreter(); }
};

VUES.favoris = {

  titre: () => 'Enregistrés',

  creer(V){

    V.el.innerHTML = `
      ${enteteBandeau({ icone: icone('signet', 26), titre: 'Messages enregistrés', texte: 'Les messages que tu as gardés pour plus tard. Toi seul les vois.' })}
      <div class="com-liste" data-liste></div>`;

    V.liste = creerListe($('[data-liste]', V.el), {
      args: () => ({ p_vue: 'recent', p_favoris: true }),
      squelette: squelettePost(3),
      vide: () => moi()
        ? etatVide({ icone: 'signet', titre: 'Rien d\'enregistré', texte: 'Touche le signet d\'un message pour le retrouver ici.' })
        : etatVide({ icone: 'signet', titre: 'Connecte-toi', texte: 'Pour enregistrer des messages, il faut un compte.',
                     bouton: { libelle: 'Se connecter', attrs: 'data-act="connexion" data-mode="login"' } })
    });
  },

  montrer(V){
    // Les favoris changent : on relit à chaque visite, sans effacer l'écran.
    if(!V.liste.charge && !V.liste.enCours) V.liste.recharger();
    else if(Date.now() - V.liste.chargeLe > 20000) V.liste.recharger({ silencieux: true });
  },

  pause(){}
};



// ---------------------------------------------------------------------
// Ce que l'on fait d'un message
// ---------------------------------------------------------------------

// Toute action qui écrit demande un compte : sans, on propose d'en ouvrir un.
function exigerConnexion(raison){

  if(moi()) return true;

  toast(raison || 'Connecte-toi pour faire ça.', { type: 'info', icone: '🔒' });

  if(typeof openAuthModal === 'function') openAuthModal('login');

  return false;
}

function copieProfonde(x){
  return x == null ? x : JSON.parse(JSON.stringify(x));
}

// Applique une réaction à l'objet (message ou commentaire), sans attendre la
// base : le geste doit se voir tout de suite.
function appliquerReaction(cible, emoji){

  const avant = cible.moi && cible.moi.reaction;

  cible.moi = cible.moi || {};
  cible.reactions = cible.reactions || [];

  if(avant){
    const r = cible.reactions.find(x => x.emoji === avant);
    if(r){ r.n--; if(r.n <= 0) cible.reactions.splice(cible.reactions.indexOf(r), 1); }
    cible.nb_reactions = Math.max(0, (cible.nb_reactions || 0) - 1);
  }

  if(emoji){
    const r = cible.reactions.find(x => x.emoji === emoji);
    if(r) r.n++; else cible.reactions.push({ emoji, n: 1 });
    cible.nb_reactions = (cible.nb_reactions || 0) + 1;
  }

  cible.reactions.sort((a, b) => b.n - a.n);
  cible.moi.reaction = emoji || null;
}

async function reagirPost(id, choix){

  const p = REG_POSTS.get(id);

  if(!p || !exigerConnexion('Connecte-toi pour réagir.')) return;

  const actuelle = p.moi && p.moi.reaction;
  const emoji = choix === 'toggle' ? (actuelle ? null : 'coeur') : (choix === actuelle ? null : choix);
  const avant = copieProfonde({ moi: p.moi, nb: p.nb_reactions, reactions: p.reactions });

  appliquerReaction(p, emoji);
  majPost(id, emoji ? { impulsion: '.com-vibe.mien .com-vibe-e' } : null);

  try{

    const r = await BD.reagir('post', id, emoji);

    p.nb_reactions = r.nb_reactions;
    p.reactions = r.reactions;
    p.moi.reaction = r.reaction;
    majPost(id);

    if(emoji){ try{ awardXP('reagirForum', 5); }catch(e){} }

  }catch(e){
    p.moi = avant.moi;
    p.nb_reactions = avant.nb;
    p.reactions = avant.reactions;
    majPost(id);
    toastErreur(e);
  }
}

async function reagirCommentaire(id, choix){

  const c = REG_COMS.get(id);

  if(!c || !exigerConnexion('Connecte-toi pour réagir.')) return;

  const actuelle = c.moi && c.moi.reaction;
  const emoji = choix === 'toggle' ? (actuelle ? null : 'coeur') : (choix === actuelle ? null : choix);
  const avant = copieProfonde({ moi: c.moi, nb: c.nb_reactions, reactions: c.reactions });

  appliquerReaction(c, emoji);
  majCommentaire(id);

  try{
    const r = await BD.reagir('commentaire', id, emoji);
    c.nb_reactions = r.nb_reactions;
    c.moi.reaction = r.reaction;
    majCommentaire(id);
  }catch(e){
    c.moi = avant.moi;
    c.nb_reactions = avant.nb;
    c.reactions = avant.reactions;
    majCommentaire(id);
    toastErreur(e);
  }
}

async function basculerFavori(id){

  const p = REG_POSTS.get(id);

  if(!p || !exigerConnexion('Connecte-toi pour enregistrer ce message.')) return;

  p.moi = p.moi || {};

  const voulu = !p.moi.favori;

  p.moi.favori = voulu;
  majPost(id, { impulsion: '.com-outil.favori svg' });

  try{
    await BD.favori(id, voulu);
    if(voulu) toast('Message enregistré', { icone: '🔖', duree: 2200 });
  }catch(e){
    p.moi.favori = !voulu;
    majPost(id);
    toastErreur(e);
    return;
  }

  // La liste des enregistrés n'est plus à jour : elle se relira à la prochaine visite.
  const vf = S.vues.get('favoris');
  if(vf && vf.liste) vf.liste.chargeLe = 0;

  // Dans la liste des enregistrés, un message retiré s'en va.
  if(!voulu && S.route && S.route.nom === 'favoris'){
    const v = S.vues.get('favoris');
    if(v){
      $$('.com-post[data-post="' + CSS.escape(id) + '"]', v.el).forEach(retirerCarteAnimee);
      v.liste.retirer(id);
    }
  }
}

async function partagerPost(id){

  const url = lienPost(id);

  if(navigator.share && petitEcran()){
    try{
      await navigator.share({ title: 'La Wave — Communauté', url });
      return;
    }catch(e){
      if(e && e.name === 'AbortError') return;
    }
  }

  if(await copier(url)) toast('Lien copié', { icone: '🔗', duree: 2200 });
  else toast('Copie impossible', { type: 'erreur' });
}

function retirerCarteAnimee(carte){

  if(mouvementReduit() || !carte.animate){ carte.remove(); return; }

  const h = carte.getBoundingClientRect().height;
  carte.style.overflow = 'hidden';

  const a = carte.animate([
    { opacity: 1, height: h + 'px', transform: 'none' },
    { opacity: 0, height: '0px', marginBottom: '0px', paddingTop: '0px', paddingBottom: '0px', transform: 'scale(.97)' }
  ], { duration: 320, easing: 'cubic-bezier(.16,1,.3,1)' });

  a.onfinish = () => carte.remove();
  setTimeout(() => carte.remove(), 600);
}

async function supprimerPost(id){

  const p = REG_POSTS.get(id);

  if(!p) return;

  const ok = await confirmer('Supprimer ce message ?', 'Il disparaîtra pour tout le monde, avec ses commentaires. Cette action est définitive.', 'Supprimer', true);

  if(!ok) return;

  try{

    const r = await BD.supprimerPost(id);

    if(r && r.images && r.images.length) Fichiers.supprimerParUrl.apply(Fichiers, r.images);

    TOUTES_LES_LISTES.forEach(L => L.retirer(id));
    retirerPostDuDom(id);
    toast('Message supprimé', { icone: '🗑️', duree: 2200 });

    // La page de ce message ne doit pas rester gardée en vie : on la vide, ou
    // on la retire si on est ailleurs.
    const pageMessage = S.vues.get('post:' + id);

    if(pageMessage){
      if(pageMessage === S.courante){
        pageMessage.charge = false;
        VUES.post.pause(pageMessage);
        VUES.post.afficherEtat(pageMessage, etatVide({ icone: 'interdit', titre: "Ce message n'est plus là", texte: "Il vient d'être supprimé." }));
      } else {
        detruireVue(pageMessage);
      }
    }

    // On quitte la page d'un message qui n'existe plus.
    if(S.route && S.route.nom === 'post' && S.route.param === id) retourArriere();

  }catch(e){
    toastErreur(e);
  }
}

async function epinglerPost(id){

  const p = REG_POSTS.get(id);

  if(!p) return;

  const voulu = !p.epingle;

  try{
    await BD.epingler(id, voulu);
    p.epingle = voulu;
    toast(voulu ? 'Message épinglé' : 'Message désépinglé', { icone: '📌', duree: 2200 });
    majPostComplet(id);
    const v = S.vues.get('accueil');
    if(v && v.liste) v.liste.recharger({ silencieux: true });
  }catch(e){
    toastErreur(e);
  }
}

// Corriger son message, pendant le temps que la base l'autorise.
function editerPost(id){

  const p = REG_POSTS.get(id);

  if(!p) return;

  $$('.com-post[data-post="' + CSS.escape(id) + '"]', S.racine).forEach(carte => {

    if($('.com-edition', carte)) return;

    const corps = $('[data-corps]', carte);
    const zone = document.createElement('div');

    zone.className = 'com-edition';
    zone.innerHTML = `
      <div class="com-comp-champ"><textarea class="com-comp-texte" rows="3" maxlength="2000" aria-label="Modifier le message"></textarea></div>
      <div class="com-edition-pied">
        <button type="button" class="com-btn com-btn-fantome com-btn-petit" data-act="edition-annuler">Annuler</button>
        <button type="button" class="com-btn com-btn-plein com-btn-petit" data-act="edition-valider">Enregistrer</button>
      </div>`;

    if(corps){
      corps.hidden = true;
      corps.after(zone);
    } else {
      $('.com-post-tete', carte).after(zone);
    }

    const t = $('textarea', zone);
    t.value = p.contenu || '';
    brancherMentions(t);
    ajusterTexte(t);
    t.addEventListener('input', () => ajusterTexte(t));
    t.focus();
    t.setSelectionRange(t.value.length, t.value.length);
  });
}

async function validerEdition(carte){

  const id = carte.dataset.post;
  const p = REG_POSTS.get(id);
  const t = $('.com-edition textarea', carte);

  if(!p || !t) return;

  const bouton = $('[data-act="edition-valider"]', carte);
  bouton.disabled = true;

  try{
    regPost(await BD.modifierPost(id, t.value));
    majPostComplet(id);
    toast('Message modifié', { duree: 2000 });
  }catch(e){
    bouton.disabled = false;
    toastErreur(e);
  }
}

function annulerEdition(carte){
  const zone = $('.com-edition', carte);
  const corps = $('[data-corps]', carte);
  if(zone) zone.remove();
  if(corps) corps.hidden = false;
}

const MOTIFS = [
  { cle: 'spam', libelle: 'Spam ou publicité' },
  { cle: 'harcelement', libelle: 'Harcèlement' },
  { cle: 'haine', libelle: 'Propos haineux' },
  { cle: 'faux', libelle: 'Faux profil ou arnaque' },
  { cle: 'autre', libelle: 'Autre' }
];

async function signalerContenu(type, id){

  if(!exigerConnexion('Connecte-toi pour signaler un contenu.')) return;

  const r = await ouvrirDialogue({
    titre: type === 'membre' ? 'Signaler ce membre' : 'Signaler ce contenu',
    corps: `
      <p class="com-dialogue-texte">Pourquoi le signales-tu ? L'équipe de La Wave regardera. Ton signalement reste anonyme.</p>
      <div class="com-radios" role="radiogroup" aria-label="Motif">
        ${MOTIFS.map(m => `
          <label class="com-radio"><input type="radio" name="com-motif" value="${m.cle}"><span>${esc(m.libelle)}</span></label>`).join('')}
      </div>
      <label class="com-champ" style="margin-top:12px">
        <span>Un détail à ajouter <i>(facultatif)</i></span>
        <textarea data-d="details" rows="2" maxlength="500"></textarea>
      </label>
      <p class="com-dialogue-erreur" data-d="erreur" hidden>Choisis un motif.</p>`,
    boutons: [
      { libelle: 'Annuler', valeur: 'non' },
      { libelle: 'Signaler', valeur: 'ok', primaire: true }
    ],
    focus: 'input[type="radio"]',
    lire: (boite, valeur) => {
      if(valeur !== 'ok') return null;
      const choisi = $('input[name="com-motif"]:checked', boite);
      if(!choisi){ $('[data-d="erreur"]', boite).hidden = false; return false; }
      return { motif: choisi.value, details: $('[data-d="details"]', boite).value };
    }
  });

  if(!r || !r.motif) return;

  try{
    await BD.signaler(type, id, r.motif, r.details);
    toast('Merci, c\'est signalé', { detail: "L'équipe va regarder ça.", icone: '🛡️' });
  }catch(e){
    toastErreur(e);
  }
}

async function bloquerMembre(id, pseudo, actif){

  if(!exigerConnexion('Connecte-toi pour bloquer un membre.')) return false;

  if(actif){
    const ok = await confirmer('Bloquer @' + pseudo + ' ?',
      "Vous ne verrez plus vos messages respectifs et vous ne pourrez plus vous écrire. Vous cessez aussi de vous suivre.", 'Bloquer', true);
    if(!ok) return false;
  }

  try{

    await BD.bloquer(id, actif);

    if(actif){
      // Ses messages disparaissent des listes ouvertes.
      Array.from(REG_POSTS.values()).filter(p => p.auteur && p.auteur.id === id).forEach(p => {
        TOUTES_LES_LISTES.forEach(L => L.retirer(p.id));
        retirerPostDuDom(p.id);
      });
    }

    toast(actif ? '@' + pseudo + ' est bloqué' : '@' + pseudo + ' est débloqué', { icone: actif ? '🚫' : '✓' });
    return true;

  }catch(e){
    toastErreur(e);
    return false;
  }
}

// Le menu « ⋯ » d'un message.
function menuPost(ancre, id){

  const p = REG_POSTS.get(id);

  if(!p) return;

  const u = moi();
  const a = p.auteur || {};
  const mien = !!(u && a.id === u.id);
  const equipe = !!(u && u.isAdmin);
  const minutes = (Date.now() - new Date(p.cree_le).getTime()) / 60000;

  ouvrirMenu(ancre, [
    { libelle: 'Copier le lien', icone: 'lien', action: async () => {
        if(await copier(lienPost(id))) toast('Lien copié', { icone: '🔗', duree: 2000 });
      } },
    !mien && u && a.id ? { libelle: 'Écrire à @' + a.pseudo, icone: 'messages', action: () => ecrireA(a.id) } : null,
    mien && minutes < 60 ? { libelle: 'Modifier', icone: 'crayon', action: () => editerPost(id) } : null,
    equipe ? { libelle: p.epingle ? 'Désépingler' : 'Épingler', icone: 'epingle', action: () => epinglerPost(id) } : null,
    !mien && u ? { libelle: 'Signaler', icone: 'drapeau', separe: true, action: () => signalerContenu('post', id) } : null,
    !mien && u && a.id ? { libelle: 'Bloquer @' + a.pseudo, icone: 'interdit', danger: true, action: () => bloquerMembre(a.id, a.pseudo, true) } : null,
    (mien || equipe) ? { libelle: 'Supprimer', icone: 'poubelle', danger: true, separe: true, action: () => supprimerPost(id) } : null
  ]);
}

function menuCommentaire(ancre, id){

  const c = REG_COMS.get(id);

  if(!c) return;

  const u = moi();
  const a = c.auteur || {};
  const p = REG_POSTS.get(c.post_id);
  const mien = !!(u && a.id === u.id);
  const auteurDuPost = !!(u && p && p.auteur && p.auteur.id === u.id);
  const equipe = !!(u && u.isAdmin);

  ouvrirMenu(ancre, [
    { libelle: 'Copier le texte', icone: 'lien', action: async () => {
        if(await copier(c.contenu)) toast('Texte copié', { icone: '📋', duree: 1800 });
      } },
    !mien && u ? { libelle: 'Signaler', icone: 'drapeau', separe: true, action: () => signalerContenu('commentaire', id) } : null,
    !mien && u && a.id ? { libelle: 'Bloquer @' + a.pseudo, icone: 'interdit', danger: true, action: () => bloquerMembre(a.id, a.pseudo, true) } : null,
    (mien || auteurDuPost || equipe) ? { libelle: 'Supprimer', icone: 'poubelle', danger: true, separe: true, action: () => supprimerCommentaire(id) } : null
  ]);
}

async function supprimerCommentaire(id){

  const c = REG_COMS.get(id);

  if(!c) return;

  const ok = await confirmer('Supprimer ce commentaire ?', 'Les réponses qu\'il a reçues seront supprimées avec lui.', 'Supprimer', true);

  if(!ok) return;

  try{

    const r = await BD.supprimerCommentaire(id);

    const noeuds = $$('[data-com="' + CSS.escape(id) + '"]', S.racine);

    noeuds.forEach(n => {
      const racine = n.closest('.com-fil-com');
      const cible = (!c.parent_id && racine) ? racine : n;
      retirerCarteAnimee(cible);
    });

    const p = REG_POSTS.get(c.post_id);

    if(p && r && typeof r.nb_commentaires === 'number'){
      p.nb_commentaires = r.nb_commentaires;
      majPost(p.id);
      const titre = $('.com-coms-titre');
      if(titre) titre.textContent = pluriel(p.nb_commentaires, 'commentaire');
    }

    const v = S.vues.get('post:' + c.post_id);
    if(v && v.coms) v.coms = v.coms.filter(x => x.id !== id && x.parent_id !== id);

    REG_COMS.delete(id);

  }catch(e){
    toastErreur(e);
  }
}


// ---------------------------------------------------------------------
// Un message en détail : le message, les commentaires, la réponse
// ---------------------------------------------------------------------

function champReponseHtml(o){

  const u = moi();

  if(!u){
    return `
      <div class="com-carte com-invitation compact">
        <div class="com-invitation-texte"><b>Participe à la discussion</b><span>Connecte-toi pour répondre.</span></div>
        <div class="com-invitation-actions">
          <button type="button" class="com-btn com-btn-plein com-btn-petit" data-act="connexion" data-mode="login">Se connecter</button>
        </div>
      </div>`;
  }

  return `
    <div class="com-repondre${o && o.inline ? ' inline' : ' carte com-carte'}">
      ${o && o.inline ? '' : avatarHtml({ pseudo: u.pseudo, avatar_url: u.avatar }, 'm')}
      <div class="com-repondre-champ">
        <div class="com-comp-champ">
          <textarea class="com-comp-texte" rows="1" maxlength="1000" data-rep aria-label="Ta réponse"
                    placeholder="${attr((o && o.placeholder) || 'Écris ta réponse…')}"></textarea>
        </div>
        <div class="com-repondre-pied">
          ${o && o.inline ? '<button type="button" class="com-btn com-btn-fantome com-btn-petit" data-act="rep-annuler">Annuler</button>' : ''}
          <button type="button" class="com-btn com-btn-plein com-btn-petit" data-act="rep-envoyer" disabled>Répondre</button>
        </div>
      </div>
    </div>`;
}

function brancherChampReponse(racine){

  const t = $('textarea[data-rep]', racine);
  const b = $('[data-act="rep-envoyer"]', racine);

  if(!t || t.__brancheRep) return;

  t.__brancheRep = true;
  brancherMentions(t);

  t.addEventListener('input', () => {
    ajusterTexte(t);
    b.disabled = !t.value.trim() || t.value.length > 1000;
  });

  // Le pied (bouton « Répondre ») s'ouvre sur .com-repondre : sur la page d'un message, `racine` n'est que
  // l'emplacement qui l'entoure, et l'y poser laissait le bouton caché.
  t.addEventListener('focus', () => (t.closest('.com-repondre') || racine).classList.add('actif'));

  t.addEventListener('keydown', (e) => {
    if(e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !b.disabled){
      e.preventDefault();
      b.click();
    }
  });
}

// Envoie un commentaire (racine si parent est nul) et l'insère dans la page.
async function envoyerCommentaire(postId, zone, parentId){

  const t = $('textarea[data-rep]', zone);
  const b = $('[data-act="rep-envoyer"]', zone);

  if(!t || !t.value.trim()) return;

  if(!exigerConnexion('Connecte-toi pour répondre.')) return;

  b.disabled = true;
  b.textContent = 'Envoi…';

  try{

    const c = regCom(await BD.commenter(postId, t.value, parentId));
    const p = REG_POSTS.get(postId);

    if(p){
      p.nb_commentaires = (p.nb_commentaires || 0) + 1;
      majPost(postId);
    }

    const v = S.vues.get('post:' + postId);

    if(v){
      v.coms = v.coms || [];
      v.coms.push(c);
      insererCommentaire(v, c);
    }

    t.value = '';
    ajusterTexte(t);

    if(parentId){
      // Le champ de réponse d'un commentaire se referme une fois envoyé.
      zone.remove();
    } else {
      b.disabled = true;
      zone.classList.remove('actif');
    }

    try{ awardXP('commentForum', 5); }catch(e){}

  }catch(e){
    toastErreur(e);
    b.disabled = false;
  }

  b.textContent = 'Répondre';
}

function insererCommentaire(V, c){

  const liste = $('.com-commentaires', V.el);

  if(!liste || $('[data-com="' + CSS.escape(c.id) + '"]', V.el)) return;

  const vide = $('.com-coms-vide', liste);
  if(vide) vide.remove();

  const auteurPostId = V.post && V.post.auteur && V.post.auteur.id;
  const tmp = document.createElement('div');

  if(!c.parent_id){

    tmp.innerHTML = arbreCommentairesHtml([c], auteurPostId).trim();
    const noeud = tmp.firstElementChild;
    liste.appendChild(noeud);
    entrerEnCascade([noeud]);
    majTitreCommentaires(V);

    return;
  }

  const racine = $('.com-fil-com[data-racine="' + CSS.escape(c.parent_id) + '"]', liste);

  if(!racine) return;

  let reps = $('.com-reponses-liste', racine);

  if(!reps){
    const bloc = document.createElement('div');
    bloc.className = 'com-reponses';
    bloc.innerHTML = '<div class="com-reponses-liste"></div>';
    racine.appendChild(bloc);
    reps = $('.com-reponses-liste', bloc);
  }

  tmp.innerHTML = commentaireHtml(c, { auteurPostId }).trim();
  const noeud = tmp.firstElementChild;
  reps.appendChild(noeud);
  entrerEnCascade([noeud]);
  majTitreCommentaires(V);
}

function majTitreCommentaires(V){
  const titre = $('.com-coms-titre', V.el);
  if(titre && V.post) titre.textContent = pluriel(V.post.nb_commentaires || 0, 'commentaire');
}

function basculerReponseInline(noeudCom){

  const zone = $('.com-reponse-zone', noeudCom);

  if(!zone) return;

  if(zone.firstElementChild){
    zone.innerHTML = '';
    return;
  }

  if(!exigerConnexion('Connecte-toi pour répondre.')) return;

  const c = REG_COMS.get(noeudCom.dataset.com);
  const pseudo = c && c.auteur && c.auteur.pseudo;

  zone.innerHTML = champReponseHtml({ inline: true, placeholder: 'Répondre à ' + (pseudo || '') + '…' });

  const bloc = zone.firstElementChild;
  brancherChampReponse(bloc);

  const t = $('textarea', bloc);

  if(pseudo && c.auteur.id !== (moi() && moi().id)){
    t.value = '@' + pseudo + ' ';
    $('[data-act="rep-envoyer"]', bloc).disabled = false;
  }

  ajusterTexte(t);
  t.focus();
  t.setSelectionRange(t.value.length, t.value.length);

  if(bloc.animate && !mouvementReduit()){
    bloc.animate([{ opacity: 0, transform: 'translateY(-6px)' }, { opacity: 1, transform: 'none' }],
      { duration: 240, easing: 'cubic-bezier(.16,1,.3,1)' });
  }
}

VUES.post = {

  titre: () => 'Message',
  retour: true,

  creer(V, route){

    V.id = route.param;

    V.el.innerHTML = `
      <div data-hote="post">${squelettePost(1)}</div>
      <div data-hote="repondre"></div>
      <div class="com-commentaires" data-coms></div>`;
  },

  // Un état (erreur, introuvable) s'affiche à la place du message en gardant
  // la structure de la page : « Réessayer » doit pouvoir la redessiner.
  afficherEtat(V, html){
    $('[data-hote="post"]', V.el).innerHTML = html;
    $('[data-hote="repondre"]', V.el).innerHTML = '';
    $('.com-commentaires', V.el).innerHTML = '';
  },

  async montrer(V){

    if(V.charge){
      VUES.post.demarrer(V);
      // Revenir sur un message déjà ouvert : la discussion a pu avancer.
      if(Date.now() - (V.chargeLe || 0) > 15000) VUES.post.rafraichir(V);
      return;
    }

    if(V.enCours) return;

    V.enCours = true;

    try{

      const r = await BD.post(V.id);

      if(!r){
        VUES.post.afficherEtat(V, etatVide({
          icone: 'interdit', titre: "Ce message n'est plus là",
          texte: "Il a été supprimé, ou son auteur ne te le montre pas.",
          bouton: { libelle: 'Retour au fil', attrs: 'data-act="aller" data-vers=""' }
        }));
        V.enCours = false;
        return;
      }

      V.post = regPost(r.post);
      V.coms = (r.commentaires || []).map(regCom);
      V.charge = true;
      V.chargeLe = Date.now();

      VUES.post.dessiner(V);
      VUES.post.demarrer(V);

    }catch(e){
      VUES.post.afficherEtat(V, e && e.introuvable
        ? etatVide({ icone: 'interdit', titre: "Ce message n'est plus là", texte: "Cette adresse ne correspond à aucun message.",
                     bouton: { libelle: 'Retour au fil', attrs: 'data-act="aller" data-vers=""' } })
        : etatErreur(e, true));
    }

    V.enCours = false;
  },

  dessiner(V){

    const hotePost = $('[data-hote="post"]', V.el);
    const hoteRep = $('[data-hote="repondre"]', V.el);
    const liste = $('.com-commentaires', V.el);
    const auteurPostId = V.post.auteur && V.post.auteur.id;

    hotePost.innerHTML = postHtml(V.post, { detail: true });
    hoteRep.innerHTML = champReponseHtml({});
    brancherChampReponse(hoteRep);

    liste.innerHTML = `
      <h3 class="com-coms-titre">${esc(pluriel(V.post.nb_commentaires || 0, 'commentaire'))}</h3>
      ${V.coms.length
        ? arbreCommentairesHtml(V.coms, auteurPostId)
        : `<div class="com-coms-vide">${icone('bulle', 22)}<span>Aucun commentaire pour l'instant. Lance la discussion.</span></div>`}`;

    entrerEnCascade($$('.com-fil-com', liste), 30);

    if(S.focusReponse){
      S.focusReponse = false;
      const t = $('textarea[data-rep]', hoteRep);
      if(t) setTimeout(() => t.focus(), 250);
    }
  },

  // Tant que le message est ouvert, la discussion se met à jour seule.
  demarrer(V){

    VUES.post.pause(V);

    V.minuteur = setInterval(() => {
      if(!inactif() && V.charge) VUES.post.rafraichir(V);
    }, 25000);

    if(S.focusReponse && V.charge){
      S.focusReponse = false;
      const t = $('textarea[data-rep]', V.el);
      if(t) setTimeout(() => t.focus(), 250);
    }
  },

  // Relit le message : commentaires arrivés, compteurs, réactions. Rien n'est
  // redessiné s'il n'y a rien de neuf (le focus au clavier ne doit pas sauter).
  async rafraichir(V){

    if(V.rafraichit) return;
    V.rafraichit = true;

    try{

      const r = await BD.post(V.id);

      if(!r || !V.charge) return;

      V.chargeLe = Date.now();

      const avant = JSON.stringify([V.post.nb_reactions, V.post.nb_commentaires, V.post.reactions, V.post.contenu]);

      regPost(r.post);

      const connus = new Set(V.coms.map(c => c.id));
      const neufs = (r.commentaires || []).map(regCom).filter(c => !connus.has(c.id));

      neufs.forEach(c => { V.coms.push(c); insererCommentaire(V, c); });

      const apres = JSON.stringify([V.post.nb_reactions, V.post.nb_commentaires, V.post.reactions, V.post.contenu]);

      if(avant !== apres) majPost(V.id);
      if(neufs.length || avant !== apres) majTitreCommentaires(V);

    }catch(e){}finally{
      V.rafraichit = false;
    }
  },

  pause(V){
    if(V.minuteur){ clearInterval(V.minuteur); V.minuteur = null; }
  }
};



// ---------------------------------------------------------------------
// Les membres : cartes, suggestions, abonnements
// ---------------------------------------------------------------------

const REGISTRE_MEMBRES = new Map();

function regMembre(m){
  if(!m || !m.id) return m;
  const connu = REGISTRE_MEMBRES.get(m.id);
  if(connu){ Object.assign(connu, m); return connu; }
  REGISTRE_MEMBRES.set(m.id, m);
  return m;
}

const RAISONS = {
  tu_cherches: 'Correspond à ce que tu cherches',
  te_cherche:  'Cherche quelqu\'un comme toi',
  meme_ville:  'Dans ta ville',
  meme_style:  'Tes styles'
};

function membreHtml(m){

  const suit = !!(m.moi && m.moi.suit);
  const r = roleInfo(m.role);

  return `
    <article class="com-pf" data-membre="${attr(m.id)}" data-act="membre" data-cle="${attr(m.pseudo)}" tabindex="0" aria-label="Profil de ${attr(m.pseudo)}">
      <span class="com-pf-photo">${avatarHtml(m, 'xl')}</span>
      <b class="com-pf-nom">${nomHtml(m, { sansLien: true })}</b>
      <span class="com-pf-sous">${esc(r.icon)} ${esc(r.name)}${m.ville ? ' · ' + esc(m.ville) : ''}</span>
      <span class="com-pf-suivre">${boutonSuivre(m, suit)}</span>
    </article>`;
}

// Trois visages vides pendant le chargement.
function squeletteProfils(){
  return `<div class="com-trio-page">${[0, 1, 2].map(() => `
    <div class="com-pf" aria-hidden="true">
      <span class="com-sq com-sq-rond" style="width:112px;height:112px"></span>
      <span class="com-sq" style="width:60%;margin-top:6px"></span>
      <span class="com-sq" style="width:80%"></span>
    </div>`).join('')}</div>`;
}

// Les suggestions sont gardées une minute : le fil, l'explorateur et la
// colonne de droite les partagent.
async function suggestions(forcer){

  if(!forcer && S.suggestions && Date.now() - S.suggestionsLe < 60000) return S.suggestions;

  const liste = await BD.suggestions(8);

  S.suggestions = (liste || []).map(regMembre);
  S.suggestionsLe = Date.now();

  return S.suggestions;
}

async function tendances(forcer){

  if(!forcer && S.tendances && Date.now() - S.tendancesLe < 120000) return S.tendances;

  S.tendances = await BD.tendances();
  S.tendancesLe = Date.now();

  return S.tendances;
}

// Met à jour tous les boutons « Suivre » d'un membre, partout à l'écran.
function majBoutonsSuivre(id, suit){

  $$('.com-suivre[data-id="' + CSS.escape(id) + '"]', S.racine).forEach(b => {
    b.classList.toggle('actif', suit);
    b.classList.toggle('com-btn-plein', !suit);
    b.classList.toggle('com-btn-fantome', suit);
    b.setAttribute('aria-pressed', suit ? 'true' : 'false');
  });

  const m = REGISTRE_MEMBRES.get(id);
  if(m){ m.moi = m.moi || {}; m.moi.suit = suit; }
}

async function basculerSuivi(id, bouton){

  if(!exigerConnexion('Connecte-toi pour suivre des membres.')) return;

  const suit = !(bouton && bouton.classList.contains('actif'));

  majBoutonsSuivre(id, suit);

  if(bouton && bouton.animate && !mouvementReduit() && suit){
    bouton.animate([{ transform: 'scale(.92)' }, { transform: 'scale(1.06)', offset: .55 }, { transform: 'scale(1)' }],
      { duration: 380, easing: 'cubic-bezier(.34,1.56,.64,1)' });
  }

  try{

    const r = await BD.suivre(id, suit);

    // Profil ouvert : le compteur d'abonnés suit.
    const v = $$('[data-abonnes][data-pour="' + CSS.escape(id) + '"]', S.racine);
    v.forEach(n => { n.textContent = compact(r.abonnes); });

    // Les listes qui dépendaient de ce suivi sont à relire.
    S.suggestionsLe = 0;
    const accueil = S.vues.get('accueil');
    if(accueil && accueil.liste && accueil.etat.onglet === 'abonnements') accueil.liste.charge = false;

  }catch(e){
    majBoutonsSuivre(id, !suit);
    toastErreur(e);
  }
}

async function ecrireA(id){

  if(!exigerConnexion('Connecte-toi pour écrire à un membre.')) return;

  try{
    const r = await BD.ouvrirConversation(id);
    aller('messages/' + encodeURIComponent(r.id));
  }catch(e){
    toastErreur(e);
  }
}


// ---------------------------------------------------------------------
// Explorer : trouver des gens
//
// Le cœur de « trouver avec qui travailler » : on dit qui l'on cherche
// (un beatmaker, un vidéaste...), on affine, on contacte.
// ---------------------------------------------------------------------

// Explorer rassemble les deux pages : les membres, et les annonces de collaboration.
function selecteurExplorer(actif){

  return `
    <div class="com-seg com-seg-texte" role="tablist" aria-label="Explorer">
      <button type="button" role="tab" class="com-seg-btn${actif === 'membres' ? ' actif' : ''}" data-act="aller" data-vers="explorer" aria-selected="${actif === 'membres'}">Membres</button>
      <button type="button" role="tab" class="com-seg-btn${actif === 'annonces' ? ' actif' : ''}" data-act="aller" data-vers="collabs" aria-selected="${actif === 'annonces'}">Annonces</button>
    </div>`;
}

// Le bouton qui dit le métier choisi (ou « Tous les métiers »), et le menu qu'il ouvre.
function boutonMetier(cle, act, libelleTous){

  const m = cle ? S.ref.metiers.find(x => x.cle === cle) : null;

  return `
    <button type="button" class="com-sujet-bouton${m ? ' filtre' : ''}" data-act="${act}" aria-haspopup="menu"
            aria-label="Filtrer par métier : ${attr(m ? m.libelle : libelleTous.toLowerCase())}">
      ${m ? `<span aria-hidden="true">${esc(m.icone)}</span>` : ''}
      <span>${esc(m ? m.libelle : libelleTous)}</span>
      ${icone('chevronBas', 15)}
    </button>`;
}

function menuMetiers(ancre, actif, libelleTous, choisir){

  ouvrirMenu(ancre, [
    { libelle: libelleTous, actif: !actif, action: () => choisir(null) },
    ...S.ref.metiers.map(m => ({ libelle: m.libelle, emoji: m.icone, actif: actif === m.cle, action: () => choisir(m.cle) }))
  ]);
}

// Les profils d'Explorer défilent d'eux-mêmes, trois par trois.
const TRIO = { taille: 3, periode: 3000 };

const TRIS = [
  { cle: 'actifs', libelle: 'Les plus actifs' },
  { cle: 'recents', libelle: 'Les plus récents' },
  { cle: 'populaires', libelle: 'Les plus suivis' }
];

VUES.explorer = {

  titre: () => 'Explorer',

  creer(V){

    V.etat = { role: null, cherche: null, propose: null, ville: '', recherche: '', tri: 'actifs', affiner: false };
    V.membres = [];
    V.total = 0;
    V.fin = false;
    V.gen = 0;

    V.el.innerHTML = `
      <div class="com-explorer-tete">
        ${selecteurExplorer('membres')}
        <div class="com-ex-barre">
          <label class="com-recherche-champ">
            ${icone('loupe', 18)}
            <input type="search" data-ex="recherche" placeholder="Chercher un membre" autocomplete="off" aria-label="Chercher un membre">
          </label>
          <span data-ex-roles></span>
          <button type="button" class="com-sujet-bouton" data-act="ex-affiner" aria-expanded="false" aria-label="Affiner la recherche">${icone('rouage', 15)}<span>Filtres</span></button>
        </div>
        <div class="com-affiner-zone" data-ex-affiner hidden>
          <div class="com-grille-champs">
            <label class="com-champ"><span>Il ou elle cherche</span>
              <select data-ex="cherche"><option value="">Peu importe</option>${S.ref.metiers.map(m => `<option value="${attr(m.cle)}">${esc(m.icone)} ${esc(m.libelle)}</option>`).join('')}</select></label>
            <label class="com-champ"><span>Il ou elle propose</span>
              <select data-ex="propose"><option value="">Peu importe</option>${S.ref.metiers.map(m => `<option value="${attr(m.cle)}">${esc(m.icone)} ${esc(m.libelle)}</option>`).join('')}</select></label>
            <label class="com-champ"><span>Ville</span>
              <input type="text" data-ex="ville" maxlength="60" placeholder="Paris, Lyon…" autocomplete="off"></label>
            <label class="com-champ"><span>Trier par</span>
              <select data-ex="tri">${TRIS.map(t => `<option value="${t.cle}">${esc(t.libelle)}</option>`).join('')}</select></label>
          </div>
        </div>
        <div class="com-filtres-actifs" data-ex-actifs></div>
      </div>
      <div class="com-explorer-resultats">
        <div class="com-resultats-tete" data-ex-compte></div>
        <div class="com-trio-zone" data-ex-defile>
          <button type="button" class="com-fleche gauche" data-act="ex-defiler" data-sens="-1" aria-label="Profils précédents">${icone('retour', 20)}</button>
          <div class="com-trio" data-ex-liste aria-live="off"></div>
          <button type="button" class="com-fleche droite" data-act="ex-defiler" data-sens="1" aria-label="Profils suivants">${icone('chevronDroite', 20)}</button>
        </div>
        <span class="com-trio-barre" data-ex-barre aria-hidden="true"></span>
        <div class="com-bas-etat" data-ex-bas></div>
      </div>`;

    V.hotes = {
      roles: $('[data-ex-roles]', V.el),
      affiner: $('[data-ex-affiner]', V.el),
      actifs: $('[data-ex-actifs]', V.el),
      compte: $('[data-ex-compte]', V.el),
      defile: $('[data-ex-defile]', V.el),
      barre: $('[data-ex-barre]', V.el),
      liste: $('[data-ex-liste]', V.el),
      bas: $('[data-ex-bas]', V.el),
      sentinelle: $('[data-ex-sentinelle]', V.el)
    };

    VUES.explorer.dessinerRoles(V);

    V.page = 0;
    V.minuteur = null;
    V.reste = TRIO.periode;
    V.debut = 0;
    V.fige = false;

    // Le défilé s'arrête au survol et au focus : on ne vise pas un visage qui s'en va.
    V.hotes.defile.addEventListener('pointerenter', () => VUES.explorer.figer(V));
    V.hotes.defile.addEventListener('pointerleave', () => VUES.explorer.reprendre(V));
    V.hotes.defile.addEventListener('focusin', () => VUES.explorer.figer(V));
    V.hotes.defile.addEventListener('focusout', () => VUES.explorer.reprendre(V));
  },

  nbPages(V){
    return Math.max(1, Math.ceil(V.membres.length / TRIO.taille));
  },

  // Affiche la page i (trois profils) ; l'ancienne s'efface pendant que la nouvelle arrive.
  dessinerPage(V, i){

    const trio = V.hotes.liste;
    const page = document.createElement('div');

    page.className = 'com-trio-page';
    page.innerHTML = V.membres.slice(i * TRIO.taille, (i + 1) * TRIO.taille).map(m => membreHtml(m)).join('');

    const anciennes = $$('.com-trio-page', trio);

    if(mouvementReduit() || !anciennes.length){
      trio.replaceChildren(page);
    } else {
      anciennes.forEach(a => { a.classList.add('sortante'); setTimeout(() => a.remove(), 480); });
      page.classList.add('entrante');
      trio.appendChild(page);
    }

    V.page = i;
    V.hotes.defile.classList.toggle('seule', VUES.explorer.nbPages(V) < 2);
  },

  changerPage(V, sens){

    const n = VUES.explorer.nbPages(V);

    if(n < 2) return;

    const i = (V.page + sens + n) % n;

    // On approche de la fin : la suite se charge pendant qu'on regarde.
    if(sens > 0 && i >= n - 2) VUES.explorer.plus(V);

    VUES.explorer.dessinerPage(V, i);
    VUES.explorer.relancerBarre(V);
    VUES.explorer.planifier(V, TRIO.periode);
  },

  // La barre fine dit combien de temps il reste à ces trois-là ; elle repart de zéro à chaque page.
  relancerBarre(V){

    const trait = document.createElement('i');

    trait.style.animationDuration = TRIO.periode + 'ms';
    V.hotes.barre.classList.remove('en-pause');
    V.hotes.barre.replaceChildren(trait);
  },

  planifier(V, ms){

    clearTimeout(V.minuteur);

    if(mouvementReduit() || VUES.explorer.nbPages(V) < 2) return;

    V.debut = Date.now();
    V.reste = ms;

    V.minuteur = setTimeout(() => {

      // Page cachée ou onglet en arrière-plan : on attend sans tourner.
      if(V.el.hidden || inactif()){
        VUES.explorer.planifier(V, 1500);
        return;
      }

      VUES.explorer.changerPage(V, 1);

    }, ms);
  },

  figer(V){

    if(V.fige) return;

    V.fige = true;
    clearTimeout(V.minuteur);
    V.reste = Math.max(0, V.reste - (Date.now() - V.debut));
    V.hotes.barre.classList.add('en-pause');
  },

  reprendre(V){

    if(!V.fige) return;

    V.fige = false;
    V.hotes.barre.classList.remove('en-pause');
    VUES.explorer.planifier(V, Math.max(250, V.reste));
  },

  // La vue est (re)montrée : le défilé repart.
  demarrer(V){

    VUES.explorer.relancerBarre(V);
    VUES.explorer.planifier(V, TRIO.periode);
  },

  // Le métier cherché se choisit dans un petit menu, comme le sujet du fil.
  dessinerRoles(V){
    V.hotes.roles.innerHTML = boutonMetier(V.etat.role, 'ex-role-menu', 'Tous les métiers');
  },

  dessinerFiltresActifs(V){

    const e = V.etat;
    const items = [];

    if(e.cherche) items.push({ cle: 'cherche', texte: 'Cherche · ' + libelleMetier(e.cherche) });
    if(e.propose) items.push({ cle: 'propose', texte: 'Propose · ' + libelleMetier(e.propose) });
    if(e.ville) items.push({ cle: 'ville', texte: 'Ville · ' + e.ville });

    V.hotes.actifs.innerHTML = items.map(it => `
      <button type="button" class="com-puce retirable bouton" data-act="ex-retirer" data-cle="${it.cle}" aria-label="Retirer le filtre ${attr(it.texte)}">${esc(it.texte)} ${icone('croix', 11)}</button>`).join('');
  },

  aDesFiltres(V){
    const e = V.etat;
    return !!(e.role || e.cherche || e.propose || e.ville || e.recherche);
  },

  async montrer(V){

    if(!V.charge){
      V.charge = true;
      VUES.explorer.charger(V, true);
      return;
    }

    if(V.membres.length) VUES.explorer.demarrer(V);
  },

  pause(V){
    clearTimeout(V.minuteur);
  },

  args(V, decalage){
    const e = V.etat;
    return {
      p_role: e.role,
      p_cherche: e.cherche,
      p_propose: e.propose,
      p_ville: e.ville || null,
      p_recherche: e.recherche || null,
      p_tri: e.tri,
      p_limite: 20,
      p_decalage: decalage || 0
    };
  },

  async charger(V, premiere){

    const id = ++V.gen;

    V.enCours = true;

    if(premiere){
      V.membres = [];
      V.fin = false;
      clearTimeout(V.minuteur);
      V.hotes.liste.innerHTML = squeletteProfils();
      V.hotes.defile.classList.add('seule');
      V.hotes.compte.textContent = '';
    }

    try{

      const r = await BD.membres(VUES.explorer.args(V, premiere ? 0 : V.membres.length));

      if(id !== V.gen) return;

      const liste = (r.membres || []).map(regMembre);
      const connus = new Set(V.membres.map(m => m.id));
      const neufs = liste.filter(m => !connus.has(m.id));

      V.membres = V.membres.concat(neufs);
      V.total = r.total || 0;
      V.fin = !!r.fin;
      V.enCours = false;

      if(premiere){
        if(neufs.length){
          V.hotes.liste.replaceChildren();
          VUES.explorer.dessinerPage(V, 0);
          VUES.explorer.demarrer(V);
        } else {
          V.hotes.liste.innerHTML = VUES.explorer.vide(V);
          V.hotes.defile.classList.add('seule');
        }
      } else {
        // Des profils de plus : les pages suivantes existent, le défilé n'est pas dérangé.
        V.hotes.defile.classList.toggle('seule', VUES.explorer.nbPages(V) < 2);
      }

      V.hotes.compte.textContent = V.total
        ? pluriel(V.total, 'membre') + (VUES.explorer.aDesFiltres(V) ? (V.total > 1 ? ' correspondent' : ' correspond') : '')
        : '';

      V.hotes.bas.innerHTML = '';

    }catch(e){

      if(id !== V.gen) return;

      V.enCours = false;

      if(premiere){
        V.hotes.liste.innerHTML = etatErreur(e, true);
        V.hotes.defile.classList.add('seule');
      }
      else V.hotes.bas.innerHTML = `<button type="button" class="com-btn com-btn-fantome com-btn-petit" data-act="ex-plus">Réessayer</button>`;
    }
  },

  plus(V){
    if(V.enCours || V.fin || !V.charge || !V.membres.length) return;
    V.hotes.bas.innerHTML = '<span class="com-rond grand" role="status" aria-label="Chargement"></span>';
    VUES.explorer.charger(V, false);
  },

  vide(V){

    if(VUES.explorer.aDesFiltres(V)){
      return etatVide({
        icone: 'loupe', titre: 'Personne ne correspond',
        texte: 'Essaie avec moins de filtres, ou une autre ville.',
        bouton: { libelle: 'Effacer les filtres', attrs: 'data-act="ex-reset"' }
      });
    }

    return etatVide({ icone: 'utilisateurPlus', titre: 'Pas encore de membres', texte: 'Les premiers arrivent bientôt.' });
  },

  // Un filtre a changé : on repart de la première page.
  rechercher(V){
    VUES.explorer.dessinerRoles(V);
    VUES.explorer.dessinerFiltresActifs(V);
    VUES.explorer.charger(V, true);
  },

  definirRole(V, cle){
    V.etat.role = cle || null;
    VUES.explorer.rechercher(V);
  },

  retirerFiltre(V, cle){
    V.etat[cle] = cle === 'ville' ? '' : null;
    const champ = $('[data-ex="' + cle + '"]', V.el);
    if(champ) champ.value = '';
    VUES.explorer.rechercher(V);
  },

  reset(V){
    V.etat = { role: null, cherche: null, propose: null, ville: '', recherche: '', tri: 'actifs', affiner: V.etat.affiner };
    $$('[data-ex]', V.el).forEach(c => { c.value = c.dataset.ex === 'tri' ? 'actifs' : ''; });
    VUES.explorer.rechercher(V);
  },

  basculerAffiner(V, bouton){
    const zone = V.hotes.affiner;
    const ouvre = zone.hidden;
    animerHauteur(zone.parentElement, () => { zone.hidden = !ouvre; });
    bouton.setAttribute('aria-expanded', ouvre ? 'true' : 'false');
    bouton.classList.toggle('actif', ouvre);
  },

  saisir(V, champ){

    const nom = champ.dataset.ex;

    if(nom === 'recherche' || nom === 'ville'){
      V.etat[nom] = champ.value.trim();
      clearTimeout(V.attente);
      V.attente = setTimeout(() => VUES.explorer.rechercher(V), 280);
      return;
    }

    V.etat[nom] = champ.value || null;
    if(nom === 'tri') V.etat.tri = champ.value || 'actifs';
    VUES.explorer.rechercher(V);
  }
};


// ---------------------------------------------------------------------
// Annonces : qui cherche quoi
//
// Les messages de type « collab », seuls : ceux qui cherchent un beatmaker,
// ceux qui proposent leurs services. Filtrables par sens et par métier.
// ---------------------------------------------------------------------

function ctaCollabHtml(p){

  const u = moi();
  const mien = !!(u && p.auteur && p.auteur.id === u.id);

  if(mien) return '';

  return `
    <div class="com-collab-cta">
      <button type="button" class="com-btn com-btn-plein com-btn-petit" data-act="collab-ecrire" data-id="${attr(p.auteur && p.auteur.id)}">${icone('messages', 15)} Écrire en privé</button>
      <button type="button" class="com-btn com-btn-fantome com-btn-petit" data-act="ouvrir-post-reponse">Répondre</button>
    </div>`;
}

VUES.collabs = {

  titre: () => 'Explorer',

  creer(V){

    V.etat = { mode: '', role: '' };

    V.el.innerHTML = `
      <div class="com-collabs-barre">
        ${selecteurExplorer('annonces')}
        <button type="button" class="com-sujet-bouton" data-act="collab-publier">${icone('plus', 15)}<span>Annonce</span></button>
      </div>
      <div class="com-collabs-barre">
        <div class="com-seg com-seg-texte" role="radiogroup" aria-label="Sens de l'annonce">
          <button type="button" role="radio" class="com-seg-btn actif" data-act="collab-mode" data-mode="" aria-checked="true">Toutes</button>
          <button type="button" role="radio" class="com-seg-btn" data-act="collab-mode" data-mode="cherche" aria-checked="false">Demandes</button>
          <button type="button" role="radio" class="com-seg-btn" data-act="collab-mode" data-mode="propose" aria-checked="false">Offres</button>
        </div>
        <div class="com-collabs-droite">
          <span data-collab-roles></span>
        </div>
      </div>
      <div data-hote="composer" class="com-hote-composer" hidden></div>
      <div class="com-liste" data-liste></div>`;

    V.hotes = { composer: $('[data-hote="composer"]', V.el), roles: $('[data-collab-roles]', V.el) };

    VUES.collabs.dessinerRoles(V);

    V.liste = creerListe($('[data-liste]', V.el), {
      pilule: true,
      args: () => ({ p_vue: 'recent', p_type: 'collab' }),
      filtre: (p) => {
        const c = p.collab || {};
        return (!V.etat.mode || c.mode === V.etat.mode) && (!V.etat.role || c.role === V.etat.role);
      },
      rendu: (p) => postHtml(p, { cta: true }),
      squelette: squelettePost(3),
      vide: () => etatVide({
        icone: 'collabs',
        titre: V.etat.mode || V.etat.role ? 'Aucune annonce ne correspond' : "Pas encore d'annonce",
        texte: V.etat.mode || V.etat.role ? 'Essaie un autre filtre.' : 'Sois le premier à chercher (ou proposer) une collaboration.',
        bouton: V.etat.mode || V.etat.role ? null : { libelle: 'Publier une annonce', attrs: 'data-act="collab-publier"' }
      })
    });
  },

  dessinerRoles(V){
    V.hotes.roles.innerHTML = boutonMetier(V.etat.role, 'collab-role-menu', 'Tous les métiers');
  },

  montrer(V){
    if(!V.liste.charge && !V.liste.enCours) V.liste.recharger();
    else if(Date.now() - V.liste.chargeLe > 30000) V.liste.recharger({ silencieux: true });
    V.liste.demarrer();
  },

  pause(V){ V.liste.arreter(); },

  // Les filtres s'appliquent à ce qui est déjà chargé ; si c'est trop
  // maigre, la liste va chercher la suite d'elle-même.
  filtrer(V){
    V.liste.chaine = 0;
    V.liste.dessiner(true);
  },

  publier(V){

    const hote = V.hotes.composer;

    if(!moi()){
      exigerConnexion('Connecte-toi pour publier une annonce.');
      return;
    }

    hote.hidden = false;

    if(!V.composer){
      V.composer = monterComposer(hote, {
        nom: 'collabs',
        typeInitial: 'collab',
        ouvert: true,
        focus: true,
        apres: (post) => V.liste.inserer(post)
      });
    } else if(!V.composer.ouvert){
      ouvrirComposer(V.composer, { type: 'collab' });
    }

    hote.scrollIntoView({ behavior: mouvementReduit() ? 'auto' : 'smooth', block: 'center' });
  }
};



// ---------------------------------------------------------------------
// Le profil d'un membre
//
// Qui il est, ce qu'il cherche et ce qu'il propose, ce qu'il écrit. Pour
// soi-même : modifier ces informations, changer de photo.
// ---------------------------------------------------------------------

const RESEAUX = [
  ['portfolio', 'Portfolio'], ['instagram', 'Instagram'], ['twitter', 'X'], ['tiktok', 'TikTok'],
  ['spotify', 'Spotify'], ['appleMusic', 'Apple Music'], ['deezer', 'Deezer']
];

function moisAnnee(iso){
  return new Date(iso).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
}

// Le logo d'un média vérifié, à côté de son pseudo (posé par l'équipe, voir sql/logo-media.sql).
function logoNomHtml(p){

  const url = safeUrl(p.logo_url);

  return url && p.verifie ? `<img class="com-logo-nom" src="${attr(url)}" alt="Logo de ${attr(p.pseudo)}" loading="lazy">` : '';
}

function profilEnteteHtml(V){

  const p = V.profil;
  const s = V.stats;
  const rel = V.rel || {};
  const soi = !!rel.soi;
  const r = roleInfo(p.role);
  const bloque = !!rel.bloque;
  const h = teinte(p.pseudo);

  const badge = typeof badgeForXP === 'function' ? badgeForXP(p.xp) : null;
  const niveau = typeof levelForXP === 'function' ? levelForXP(p.xp) : null;

  const liens = RESEAUX
    .map(([cle, libelle]) => [safeUrl((p.socials || {})[cle]), libelle])
    .filter(([url]) => url)
    .map(([url, libelle]) => `<a class="com-reseau" href="${attr(url)}" target="_blank" rel="noopener noreferrer nofollow">${esc(libelle)}${icone('sortie', 12)}</a>`)
    .join('');

  const banniere = safeUrl(p.banniere_url);

  const actions = soi
    ? `<button type="button" class="com-btn com-btn-fantome com-pleine" data-act="profil-modifier">${icone('crayon', 15)} Modifier mes recherches</button>`
    : bloque
      ? `<button type="button" class="com-btn com-btn-fantome com-pleine" data-act="debloquer" data-id="${attr(p.id)}">Débloquer</button>`
      : `${boutonSuivre(p, !!rel.suit)}
         <button type="button" class="com-btn com-btn-fantome" data-act="ecrire" data-id="${attr(p.id)}">${icone('messages', 15)} Écrire</button>
         <button type="button" class="com-icone-btn bordure" data-act="menu-membre" aria-label="Plus d'options" aria-haspopup="menu">${icone('plus3', 20)}</button>`;

  const aDuContenu = (p.cherche && p.cherche.length) || (p.propose && p.propose.length);

  return `
    <div class="com-carte com-profil" data-membre="${attr(p.id)}" style="--rc:${attr(r.color)}">
      <div class="com-profil-banniere${banniere ? ' avec-image' : ''}" style="--h:${h}">
        ${banniere
          ? `<img src="${attr(banniere)}" alt="">`
          : `<span class="com-profil-ondes" aria-hidden="true">${icone('ondes', 120)}</span>`}
        ${soi ? `
          <button type="button" class="com-profil-engrenage" data-act="reglages" aria-label="Paramètres du profil" title="Paramètres">${icone('rouage', 20)}</button>
          <button type="button" class="com-ban-btn" data-act="banniere-modifier" aria-label="Changer ma bannière" title="Changer ma bannière">${icone('image', 17)}</button>
          ${banniere ? `<button type="button" class="com-ban-btn retirer" data-act="banniere-retirer" aria-label="Retirer ma bannière" title="Retirer ma bannière">${icone('croix', 14)}</button>` : ''}
          <input type="file" data-c-banniere accept="image/jpeg,image/png,image/webp" hidden>` : ''}
      </div>
      <div class="com-profil-corps">
        <div class="com-profil-avatar">
          ${avatarHtml(p, 'xl')}
          ${soi ? `<button type="button" class="com-avatar-modif" data-act="avatar-modifier" aria-label="Changer ma photo">${icone('image', 16)}</button>
                   <input type="file" data-c-avatar accept="image/jpeg,image/png,image/webp" hidden>` : ''}
        </div>

        <h2 class="com-profil-nom">${nomHtml(p, { sansLien: true })}${logoNomHtml(p)}</h2>
        <div class="com-profil-meta">
          ${roleHtml(p.role)}${(p.roles_supp || []).map(x => roleHtml(x, true)).join('')}
          ${p.ville ? `<span class="com-ville">${icone('lieu', 14)} ${esc(p.ville)}</span>` : ''}
        </div>
        <div class="com-profil-sous">
          <span>Membre depuis ${esc(moisAnnee(p.cree_le))}</span>
          ${badge
            ? (soi
                ? `<button type="button" class="com-niveau" data-act="onglet-profil" data-onglet="succes" title="Voir mes succès">${esc(badge.icon)} ${esc(badge.name)} · niveau ${niveau}</button>`
                : `<span>${esc(badge.icon)} ${esc(badge.name)} · niveau ${niveau}</span>`)
            : ''}
        </div>

        <div class="com-profil-actions">${actions}</div>

        ${bloque ? `<p class="com-profil-note">${icone('interdit', 16)} Tu as bloqué ce membre. Vous ne vous voyez plus.</p>` : ''}
        ${p.bio && !bloque ? `<p class="com-profil-bio">${esc(p.bio)}</p>` : ''}

        ${!bloque && aDuContenu ? `
          <div class="com-profil-duo">
            <div class="com-profil-bloc cherche">
              <span class="com-profil-bloc-titre">${icone('loupe', 15)} Cherche</span>
              <div class="com-profil-bloc-chips">${p.cherche && p.cherche.length ? pastilles(p.cherche) : '<em>Rien pour le moment</em>'}</div>
            </div>
            <div class="com-profil-bloc propose">
              <span class="com-profil-bloc-titre">${icone('etincelle', 15)} Propose</span>
              <div class="com-profil-bloc-chips">${p.propose && p.propose.length ? pastilles(p.propose) : '<em>Rien pour le moment</em>'}</div>
            </div>
          </div>` : ''}

        ${!bloque && p.genres && p.genres.length ? `<div class="com-profil-styles">${p.genres.map(g => `<span class="com-puce">${esc(g)}</span>`).join('')}</div>` : ''}

        ${soi && !aDuContenu ? `
          <button type="button" class="com-invite-profil" data-act="profil-modifier">
            ${icone('etincelle', 18)}
            <span><b>Dis ce que tu cherches</b><small>Un beatmaker, un vidéaste, un mix… ça aide les autres à te trouver.</small></span>
          </button>` : ''}

        ${liens && !bloque ? `<div class="com-reseaux">${liens}</div>` : ''}

        <div class="com-profil-stats">
          <div><b>${compact(s.posts)}</b><span>message${s.posts > 1 ? 's' : ''}</span></div>
          <div><b data-ecoutees>${compact(nbEcoutees(p.id))}</b><span>écoutée${nbEcoutees(p.id) > 1 ? 's' : ''}</span></div>
          <div><b data-abonnes data-pour="${attr(p.id)}">${compact(s.abonnes)}</b><span>abonné${s.abonnes > 1 ? 's' : ''}</span></div>
          <div><b>${compact(s.abonnements)}</b><span>abonnement${s.abonnements > 1 ? 's' : ''}</span></div>
        </div>

        ${p.artiste ? `
          <button type="button" class="com-lien-artiste" data-act="page-artiste" data-handle="${attr(p.artiste)}">
            ${icone('casque', 16)} Voir sa page artiste <span>${esc(p.artiste_nom || p.artiste)}</span> ${icone('sortie', 14)}
          </button>` : ''}
      </div>
    </div>
    ${soi ? '<div id="profilVerification"></div>' : ''}`;
}

// Les sorties que ce membre a écoutées : lues dans la mémoire du site (le catalogue et ses notes se chargent avec lui).
function nbEcoutees(userId){

  if(typeof toutesLesNotes === 'undefined') return 0;

  return toutesLesNotes.filter(n => n.user_id === userId && n.saved).length;
}

// Le catalogue et les notes, indispensables à la collection ; chargés d'abord si la communauté est ouverte la première.
async function preparerCollection(userId){

  if(typeof catalogueData !== 'undefined' && !catalogueData.length && typeof renderCatalogue === 'function') await renderCatalogue();

  // Sa collection peut contenir des sorties plus anciennes que celles lues à l'ouverture du catalogue.
  if(userId && typeof assurerSortiesDesNotes === 'function') await assurerSortiesDesNotes(userId);

  if(typeof chargerProfil === 'function') await chargerProfil();
}

VUES.membre = {

  titre: (V, route) => V.profil ? V.profil.pseudo : (route.param || 'Profil'),
  retour: true,

  creer(V, route){

    V.cle = route.param;
    V.etat = { onglet: 'messages' };


    // Deux colonnes sur grand écran : la carte du membre reste en vue pendant
    // qu'on parcourt ses messages.
    V.el.innerHTML = `
      <div class="com-profil-grille">
        <div class="com-profil-gauche" data-hote="entete">
          <div class="com-carte com-profil"><div class="com-profil-banniere"></div><div class="com-profil-corps">
            <div class="com-sq com-sq-rond" style="width:92px;height:92px;margin-top:-46px"></div>
            <span class="com-sq" style="width:40%;margin-top:14px"></span><span class="com-sq" style="width:64%;margin-top:10px"></span>
          </div></div>
        </div>
        <div class="com-profil-droite">
          <div data-hote="onglets"></div>
          <div class="com-liste" data-liste></div>
          <div data-hote="collection" hidden></div>
        </div>
      </div>`;

    V.hotes = {
      entete: $('[data-hote="entete"]', V.el),
      onglets: $('[data-hote="onglets"]', V.el),
      collection: $('[data-hote="collection"]', V.el)
    };

    V.liste = creerListe($('[data-liste]', V.el), {
      args: () => {
        const a = { p_vue: 'recent', p_auteur: V.profil && V.profil.id };
        if(V.etat.onglet === 'annonces') a.p_type = 'collab';
        return a;
      },
      squelette: squelettePost(2),
      vide: () => etatVide({
        icone: 'bulle',
        titre: V.etat.onglet === 'annonces' ? "Pas d'annonce" : 'Aucun message',
        texte: V.rel && V.rel.soi
          ? 'Tes messages apparaîtront ici.'
          : "Ce membre n'a encore rien écrit."
      })
    });
  },

  async montrer(V){

    if(V.charge){
      placerBarreOnglets(V.hotes.onglets, false);
      // Revenir sur un profil déjà vu : l'en-tête et les messages se rafraîchissent en douce.
      if(Date.now() - V.chargeLe > 30000){
        VUES.membre.charger(V, true);
        if(V.liste.charge && V.etat.onglet !== 'collection') V.liste.recharger({ silencieux: true });
      }
      return;
    }

    VUES.membre.charger(V, false);
  },

  pause(){},

  async charger(V, silencieux){

    if(V.enCours) return;
    V.enCours = true;

    try{

      const r = await BD.profil(V.cle);

      if(!r){
        V.el.innerHTML = etatVide({
          icone: 'profil', titre: 'Membre introuvable',
          texte: "Ce pseudo n'existe pas, ou le compte a été supprimé.",
          bouton: { libelle: 'Chercher un membre', attrs: 'data-act="aller" data-vers="explorer"' }
        });
        V.enCours = false;
        return;
      }

      V.profil = r.profil;
      V.stats = r.stats;
      V.rel = r.moi || {};
      V.charge = true;
      V.chargeLe = Date.now();

      regMembre(Object.assign({}, r.profil, { moi: { suit: !!V.rel.suit } }));

      // Regarder le profil de quelqu'un d'autre est un petit geste de découverte (une quête du jour le demande).
      if(!silencieux && moi() && r.profil.id !== moi().id){
        try{ if(typeof xpAction === 'function') xpAction('visite_profil', r.profil.id); }catch(e){}
      }

      V.hotes.entete.innerHTML = profilEnteteHtml(V);

      if(!silencieux){

        const onglets = [{ cle: 'messages', libelle: 'Messages' }, { cle: 'annonces', libelle: 'Annonces' }];

        // La collection est dans un fichier à part : on la charge avant de dessiner les onglets.
        try{
          await preparerCollection(V.profil.id);
          window.Profil.poserFeuille();
          onglets.push(...window.Profil.onglets(!!V.rel.soi));
        }catch(erreur){
          console.warn('⚠️ Collection indisponible :', erreur);
        }

        // Chez soi, on arrive sur sa collection : c'est elle que « Mon profil » montrait.
        if(V.rel.soi && !V.dejaOuvert && V.etat.onglet === 'messages') V.etat.onglet = 'collection';
        V.dejaOuvert = true;

        // Un onglet réservé à soi n'existe pas chez les autres.
        if(!onglets.some(o => o.cle === V.etat.onglet)) V.etat.onglet = 'messages';

        V.hotes.onglets.innerHTML = ongletsHtml(onglets, V.etat.onglet);
        placerBarreOnglets(V.hotes.onglets, false);
        centrerOngletActif(V.hotes.onglets);
        entrerEnCascade($$('.com-carte', V.hotes.entete), 0);

        // La liste se montre ou se cache selon le blocage (et se relit si besoin).
        const zoneListe = $('[data-liste]', V.el);
        const surCollection = !!window.Profil && window.Profil.estUnOnglet(V.etat.onglet);
        zoneListe.hidden = !!V.rel.bloque || surCollection;
        V.hotes.collection.hidden = !surCollection || !!V.rel.bloque;
        if(surCollection && !V.rel.bloque){
          V.hotes.collection.innerHTML = window.Profil.panneau(V.etat.onglet, V.profil.id, !!V.rel.soi);
          window.Profil.apres();
        }
        if(!V.rel.bloque && !surCollection) V.liste.recharger();

        if(V.rel.soi && typeof rendreCarteVerification === 'function') rendreCarteVerification();

        majTitreCourant();
      }

    }catch(e){
      if(!silencieux) V.hotes.entete.innerHTML = etatErreur(e, true);
    }

    V.enCours = false;
  },

  changerOnglet(V, onglet){

    if(V.etat.onglet === onglet) return;

    V.etat.onglet = onglet;

    $$('.com-onglet', V.hotes.onglets).forEach(b => {
      const actif = b.dataset.onglet === onglet;
      b.classList.toggle('actif', actif);
      b.setAttribute('aria-selected', actif ? 'true' : 'false');
    });
    placerBarreOnglets(V.hotes.onglets, true);
    centrerOngletActif(V.hotes.onglets);

    const liste = $('[data-liste]', V.el);

    if(window.Profil && window.Profil.estUnOnglet(onglet)){
      liste.hidden = true;
      V.hotes.collection.hidden = false;
      V.hotes.collection.innerHTML = window.Profil.panneau(onglet, V.profil.id, !!V.rel.soi);
      window.Profil.apres();
      return;
    }

    V.hotes.collection.hidden = true;
    liste.hidden = false;
    V.liste.recharger();
  }
};

// Changer sa photo : le recadrage du site fait le reste.
function choisirAvatar(champ){

  const f = champ.files && champ.files[0];

  champ.value = '';

  if(!f) return;

  if(!/^image\/(jpeg|png|webp)$/.test(f.type)){
    toast('Seules les images JPG, PNG ou WEBP sont acceptées.', { type: 'erreur', icone: '🖼️' });
    return;
  }

  const lecteur = new FileReader();

  lecteur.onload = (e) => {
    if(typeof openCropModal === 'function') openCropModal(e.target.result, 'com-avatar');
  };

  lecteur.readAsDataURL(f);
}

// Les paramètres du compte (pseudo, bio, rôle, réseaux) : un tiroir, posé par profil.js, sur le profil de la personne.
async function ouvrirReglagesProfil(){

  try{

    const u = moi();

    // Hors de son profil, on y revient : le tiroir s'ouvre par-dessus sa propre page.
    if(u && !location.hash.toLowerCase().startsWith('#community/membre/' + encodeURIComponent(u.pseudo).toLowerCase())){
      await window.Com.profil(u.id);
    }

    await chargerProfil();
    window.Profil.ouvrirReglages();

  }catch(e){
    toastErreur(e);
  }
}

// Changer sa bannière : le recadrage du site (en bandeau) fait le reste.
function choisirBanniere(champ){

  const f = champ.files && champ.files[0];

  champ.value = '';

  if(!f) return;

  if(!/^image\/(jpeg|png|webp)$/.test(f.type)){
    toast('Seules les images JPG, PNG ou WEBP sont acceptées.', { type: 'erreur', icone: '🖼️' });
    return;
  }

  const lecteur = new FileReader();

  lecteur.onload = (e) => {
    if(typeof openCropModal === 'function') openCropModal(e.target.result, 'com-banniere');
  };

  lecteur.readAsDataURL(f);
}

// Enregistre l'adresse de la bannière (ou la retire : null) et redessine le profil.
async function poserBanniere(url){

  const u = moi();

  await saveCurrentProfile({ banniere_url: url });

  u.banniere = url || '';

  const v = S.vues.get('membre:' + u.pseudo.toLowerCase());
  if(v){
    if(v.profil) v.profil.banniere_url = url;
    if(v.hotes && v.profil) v.hotes.entete.innerHTML = profilEnteteHtml(v);
    if(v.hotes && typeof rendreCarteVerification === 'function') rendreCarteVerification();
  }
}

// Appelé par le recadrage du site quand la bannière est validée.
async function banniereRecadree(dataUrl){

  const u = moi();

  if(!u) return;

  try{

    toast('Envoi de la bannière…', { type: 'info', icone: '🖼️', duree: 1800 });

    const url = await uploadCoverDataUrl(dataUrl, 'banniere', u.pseudo);

    await poserBanniere(url);

    toast('Bannière mise à jour', { icone: '🖼️' });

  }catch(e){
    toastErreur(e);
  }
}

async function retirerBanniere(){

  try{

    await poserBanniere(null);

    toast('Bannière retirée', { icone: '🖼️', duree: 2000 });

  }catch(e){
    toastErreur(e);
  }
}

// Appelé par le recadrage du site quand la photo est validée.
async function avatarRecadre(dataUrl){

  const u = moi();

  if(!u) return;

  try{

    toast('Envoi de la photo…', { type: 'info', icone: '📷', duree: 1800 });

    const url = await uploadCoverDataUrl(dataUrl, 'avatar', u.pseudo);

    await saveCurrentProfile({ avatar_url: url });

    // L'ancienne photo reste dans le stockage : le profil est modifiable par
    // son propriétaire, rien ne prouve que l'adresse qu'il y avait mise est
    // bien un fichier à lui — on ne supprime jamais sur cette foi.
    u.avatar = url;

    if(typeof refreshAccountUI === 'function') refreshAccountUI();

    // Le profil affiché et l'avatar de la barre se mettent à jour.
    const v = S.vues.get('membre:' + u.pseudo.toLowerCase());
    if(v){ v.charge = false; if(S.courante === v) VUES.membre.charger(v, false); }
    majPuceMoi();

    toast('Photo mise à jour', { icone: '📷' });

  }catch(e){
    toastErreur(e);
  }
}

function chipsMetiersHtml(selection, nom){
  return S.ref.metiers.map(m => `
    <button type="button" class="com-chip${selection.includes(m.cle) ? ' actif' : ''}" data-metier="${attr(m.cle)}" data-liste="${nom}" aria-pressed="${selection.includes(m.cle)}">
      <span class="com-chip-ic">${esc(m.icone)}</span>${esc(m.libelle)}
    </button>`).join('');
}

async function modifierMonProfil(V){

  const p = V.profil;

  const etat = {
    cherche: (p.cherche || []).slice(),
    propose: (p.propose || []).slice(),
    genres: (p.genres || []).slice()
  };

  const r = await ouvrirDialogue({
    titre: 'Mon profil',
    corps: `
      <p class="com-dialogue-texte">Dis aux autres qui tu es et ce que tu cherches : c'est ce qui te fait trouver. Ta photo se change sur ton profil ; ton pseudo, ta bio et tes réseaux dans <a href="#profile" data-act="reglages">les réglages du compte</a>.</p>
      <label class="com-champ"><span>Ville ou région</span>
        <input type="text" data-d="ville" maxlength="60" placeholder="Paris, Lyon, Bruxelles…" autocomplete="off"></label>
      <div class="com-champ"><span>Je cherche <i>(8 au plus)</i></span>
        <div class="com-chips-bloc" data-d="cherche">${chipsMetiersHtml(etat.cherche, 'cherche')}</div></div>
      <div class="com-champ"><span>Je propose <i>(8 au plus)</i></span>
        <div class="com-chips-bloc" data-d="propose">${chipsMetiersHtml(etat.propose, 'propose')}</div></div>
      <div class="com-champ"><span>Mes styles <i>(6 au plus)</i></span>
        <div class="com-styles" data-d="genres"><span class="com-styles-liste"></span>
          <input type="text" data-d="genre-saisie" maxlength="24" placeholder="Trap, boom bap…" autocomplete="off" aria-label="Ajouter un style"></div>
        <div class="com-suggestions-styles">${GENRES_SUGGERES.map(g => `<button type="button" class="com-puce bouton" data-genre="${attr(g)}">+ ${esc(g)}</button>`).join('')}</div>
      </div>`,
    boutons: [
      { libelle: 'Annuler', valeur: 'non' },
      { libelle: 'Enregistrer', valeur: 'ok', primaire: true }
    ],
    focus: 'input[data-d="ville"]',
    surOuverture: (boite) => {

      $('[data-d="ville"]', boite).value = p.ville || '';

      const dessinerGenres = () => {
        $('[data-d="genres"] .com-styles-liste', boite).innerHTML = etat.genres.map((g, i) => `
          <span class="com-puce retirable">${esc(g)}<button type="button" data-retirer-genre="${i}" aria-label="Retirer ${attr(g)}">${icone('croix', 11)}</button></span>`).join('');
        $('[data-d="genre-saisie"]', boite).hidden = etat.genres.length >= 6;
      };

      const ajouterGenre = (v) => {
        const g = String(v || '').replace(/[,;]+/g, ' ').trim().slice(0, 24);
        if(g.length < 2 || etat.genres.length >= 6) return false;
        if(!etat.genres.some(x => x.toLowerCase() === g.toLowerCase())) etat.genres.push(g);
        dessinerGenres();
        return true;
      };

      dessinerGenres();

      boite.addEventListener('click', (e) => {

        const chip = e.target.closest('[data-metier]');

        if(chip){
          const liste = etat[chip.dataset.liste];
          const cle = chip.dataset.metier;
          const i = liste.indexOf(cle);
          if(i >= 0) liste.splice(i, 1);
          else if(liste.length < 8) liste.push(cle);
          chip.classList.toggle('actif', liste.includes(cle));
          chip.setAttribute('aria-pressed', liste.includes(cle) ? 'true' : 'false');
          return;
        }

        const retirer = e.target.closest('[data-retirer-genre]');
        if(retirer){ etat.genres.splice(Number(retirer.dataset.retirerGenre), 1); dessinerGenres(); return; }

        const sug = e.target.closest('[data-genre]');
        if(sug){ ajouterGenre(sug.dataset.genre); return; }

        const lien = e.target.closest('[data-act="reglages"]');
        if(lien){ e.preventDefault(); fermerCalque(); ouvrirReglagesProfil(); }
      });

      const saisie = $('[data-d="genre-saisie"]', boite);
      saisie.addEventListener('keydown', (e) => {
        if(e.key === 'Enter' || e.key === ','){
          e.preventDefault();
          if(ajouterGenre(saisie.value)) saisie.value = '';
        } else if(e.key === 'Backspace' && !saisie.value && etat.genres.length){
          etat.genres.pop();
          dessinerGenres();
        }
      });
    },
    lire: (boite, valeur) => {
      if(valeur !== 'ok') return null;
      const saisie = $('[data-d="genre-saisie"]', boite);
      if(saisie.value.trim() && etat.genres.length < 6) etat.genres.push(saisie.value.trim().slice(0, 24));
      return { ville: $('[data-d="ville"]', boite).value.trim(), cherche: etat.cherche, propose: etat.propose, genres: etat.genres };
    }
  });

  if(!r || !r.cherche) return;

  try{

    const res = await BD.majProfil({ p_ville: r.ville || null, p_cherche: r.cherche, p_propose: r.propose, p_genres: r.genres });

    Object.assign(V.profil, { ville: res.ville, cherche: res.cherche, propose: res.propose, genres: res.genres });
    V.hotes.entete.innerHTML = profilEnteteHtml(V);
    S.suggestionsLe = 0;

    toast('Profil enregistré', { icone: '✨' });

  }catch(e){
    toastErreur(e);
  }
}

function menuMembre(ancre, V){

  const p = V.profil;

  ouvrirMenu(ancre, [
    { libelle: 'Copier le lien du profil', icone: 'lien', action: async () => {
        if(await copier(lienMembre(p.pseudo))) toast('Lien copié', { icone: '🔗', duree: 2000 });
      } },
    { libelle: 'Signaler ce membre', icone: 'drapeau', separe: true, action: () => signalerContenu('membre', p.id) },
    { libelle: 'Bloquer @' + p.pseudo, icone: 'interdit', danger: true, action: async () => {
        if(await bloquerMembre(p.id, p.pseudo, true)){ V.charge = false; VUES.membre.charger(V, false); }
      } }
  ]);
}



// ---------------------------------------------------------------------
// Les messages privés
//
// À gauche les conversations, à droite la discussion ; sur téléphone, l'un
// puis l'autre. Les messages s'affichent à l'instant de l'envoi (la base
// confirme ensuite), la discussion ouverte se met à jour toutes les
// quelques secondes, et « Vu » apparaît sous le dernier message lu.
// ---------------------------------------------------------------------

function tactile(){
  return !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
}

function apercuConversation(c, moiId){

  const d = c.dernier || {};
  const texte = d.contenu || '';

  return (d.auteur_id === moiId ? 'Toi : ' : '') + texte;
}

function conversationHtml(c, actif){

  const a = c.autre || {};
  const moiId = moi() && moi().id;
  const nonLus = c.non_lus || 0;

  return `
    <button type="button" class="com-conv${actif ? ' actif' : ''}${nonLus ? ' non-lu' : ''}" data-act="ouvrir-conv" data-id="${attr(c.id)}" data-conv="${attr(c.id)}">
      ${avatarHtml(a, 'l')}
      <span class="com-conv-texte">
        <span class="com-conv-ligne">
          <b class="com-conv-nom">${esc(a.pseudo || 'Compte supprimé')}</b>
          <time class="com-conv-heure">${esc(c.dernier && c.dernier.cree_le ? depuis(c.dernier.cree_le) : '')}</time>
        </span>
        <span class="com-conv-apercu">${esc(apercuConversation(c, moiId))}</span>
      </span>
      ${nonLus ? `<span class="com-pastille-nb" aria-label="${nonLus} non lu${nonLus > 1 ? 's' : ''}">${nonLus > 9 ? '9+' : nonLus}</span>` : ''}
    </button>`;
}

function bulleHtml(m, o){

  const moiId = moi() && moi().id;
  const mien = m.auteur_id === moiId;
  const classes = ['com-bulle', mien ? 'mienne' : 'autre'];

  if(m.etat === 'envoi') classes.push('envoi');
  if(m.etat === 'erreur') classes.push('erreur');
  if(o && o.debutGroupe) classes.push('debut');
  if(o && o.finGroupe) classes.push('fin');

  return `
    <div class="${classes.join(' ')}" data-msg="${attr(m.id)}">
      <div class="com-bulle-texte">${enrichirDm(m.contenu)}</div>
      ${o && o.finGroupe ? `<time class="com-bulle-heure" title="${attr(dateLongue(m.cree_le))}">${esc(heure(m.cree_le))}</time>` : ''}
      ${m.etat === 'erreur' ? `<button type="button" class="com-bulle-retry" data-act="msg-retry" data-id="${attr(m.id)}">Non envoyé · Réessayer</button>` : ''}
    </div>`;
}

// Dans un message privé, les adresses sont cliquables, rien d'autre.
function enrichirDm(texte){
  return enrichir(texte, [], { liensSeuls: true });
}

// Le fil d'une discussion : jours, groupes de messages d'une même personne.
function fenetreMessagesHtml(V){

  const c = V.conv;
  const moiId = moi() && moi().id;
  let html = '';
  let jourPrec = null;

  // Un message ne s'affiche qu'une fois, même s'il est arrivé par deux voies
  // (la réponse à l'envoi et la relecture de la discussion).
  const vus = new Set();
  const liste = c.messages.filter(m => m.etat || (!vus.has(m.id) && vus.add(m.id)));

  for(let i = 0; i < liste.length; i++){

    const m = liste[i];
    const prec = liste[i - 1];
    const suiv = liste[i + 1];
    const jour = new Date(m.cree_le).toDateString();

    if(jour !== jourPrec){
      html += `<div class="com-jour"><span>${esc(jourLibelle(m.cree_le))}</span></div>`;
      jourPrec = jour;
    }

    const proche = (a, b) => a && b && a.auteur_id === b.auteur_id &&
      new Date(b.cree_le) - new Date(a.cree_le) < 5 * 60000 &&
      new Date(a.cree_le).toDateString() === new Date(b.cree_le).toDateString();

    html += bulleHtml(m, { debutGroupe: !proche(prec, m), finGroupe: !proche(m, suiv) });
  }

  // « Vu » sous le dernier message de la discussion, quand c'est le nôtre et
  // que l'autre l'a lu.
  const dernierMien = liste.length ? liste[liste.length - 1] : null;

  if(dernierMien && dernierMien.auteur_id === moiId && dernierMien.etat !== 'envoi' && dernierMien.etat !== 'erreur'
     && c.luAutre && new Date(c.luAutre) >= new Date(dernierMien.cree_le)){
    html += `<div class="com-vu" data-vu>${icone('coche', 12)} Vu</div>`;
  }

  return html;
}

VUES.messages = {

  titre: (V) => V.conv && V.conv.autre ? V.conv.autre.pseudo : 'Messages',
  retour: false,
  large: true,

  creer(V){

    V.convs = [];
    V.conv = null;
    V.id = null;
    V.etat = {};

    V.el.innerHTML = `
      <div class="com-messages" data-mode="liste">
        <section class="com-conv-pane" aria-label="Conversations">
          <div class="com-conv-tete">
            <h2>Messages</h2>
            <button type="button" class="com-icone-btn bordure" data-act="nouvelle-conv" aria-label="Nouveau message">${icone('crayon', 18)}</button>
          </div>
          <div class="com-conv-liste" data-conv-liste>${squeletteMembre(4)}</div>
        </section>
        <section class="com-fil-pane" aria-label="Discussion">
          <div class="com-fil-vide" data-fil-vide>
            <span class="com-vide-icone">${icone('messages', 30)}</span>
            <h3>Tes messages</h3>
            <p>Choisis une conversation, ou écris à quelqu'un.</p>
            <button type="button" class="com-btn com-btn-plein" data-act="nouvelle-conv">Nouveau message</button>
          </div>
          <div class="com-fil-conv" data-fil-conv hidden>
            <header class="com-fil-tete">
              <button type="button" class="com-icone-btn com-fil-retour" data-act="conv-retour" aria-label="Retour aux conversations">${icone('retour', 22)}</button>
              <a class="com-fil-qui" data-act="conv-profil" href="#">
                <span data-fil-avatar></span>
                <span class="com-fil-nom" data-fil-nom></span>
              </a>
              <button type="button" class="com-icone-btn" data-act="menu-conv" aria-label="Plus d'options" aria-haspopup="menu">${icone('plus3', 20)}</button>
            </header>
            <div class="com-msgs" data-msgs tabindex="0" aria-live="polite"></div>
            <div class="com-msg-saisie" data-saisie>
              <div class="com-msg-champ">
                <textarea rows="1" maxlength="2000" data-msg-texte placeholder="Écris un message…" aria-label="Ton message"></textarea>
              </div>
              <button type="button" class="com-envoyer" data-act="msg-envoyer" aria-label="Envoyer" disabled>${icone('envoyer', 20)}</button>
            </div>
            <p class="com-msg-bloque" data-msg-bloque hidden>Vous ne pouvez plus vous écrire.</p>
          </div>
        </section>
      </div>`;

    V.hotes = {
      racine: $('.com-messages', V.el),
      liste: $('[data-conv-liste]', V.el),
      vide: $('[data-fil-vide]', V.el),
      conv: $('[data-fil-conv]', V.el),
      msgs: $('[data-msgs]', V.el),
      saisie: $('[data-msg-texte]', V.el),
      envoyer: $('[data-act="msg-envoyer"]', V.el)
    };

    const t = V.hotes.saisie;

    t.addEventListener('input', () => {
      ajusterTexte(t);
      V.hotes.envoyer.disabled = !t.value.trim();
    });

    t.addEventListener('keydown', (e) => {
      if(e.key === 'Enter' && !e.shiftKey && !tactile() && !e.isComposing){
        e.preventDefault();
        VUES.messages.envoyer(V);
      }
    });

    // Remonter dans l'historique : le haut du fil charge les messages plus anciens.
    V.hotes.msgs.addEventListener('scroll', () => {
      if(V.hotes.msgs.scrollTop < 60) VUES.messages.plusAnciens(V);
    }, { passive: true });
  },

  async montrer(V, route){

    if(!moi()){
      V.el.innerHTML = etatVide({
        icone: 'messages', titre: 'Tes messages privés',
        texte: 'Connecte-toi pour écrire aux artistes, beatmakers et DJ de la communauté.',
        bouton: { libelle: 'Se connecter', attrs: 'data-act="connexion" data-mode="login"' }
      });
      V.creerEchoue = true;
      return;
    }

    if(V.creerEchoue){ V.creerEchoue = false; VUES.messages.creer(V); }

    VUES.messages.demarrer(V);

    await VUES.messages.chargerListe(V, !V.listeChargee);

    VUES.messages.route(V, route);
  },

  pause(V){
    if(V.minuteurListe){ clearInterval(V.minuteurListe); V.minuteurListe = null; }
    if(V.minuteurFil){ clearInterval(V.minuteurFil); V.minuteurFil = null; }
  },

  demarrer(V){

    VUES.messages.pause(V);

    V.minuteurListe = setInterval(() => {
      if(!inactif()) VUES.messages.chargerListe(V, false);
    }, 15000);

    if(V.id){
      V.minuteurFil = setInterval(() => {
        if(!inactif()) VUES.messages.rafraichirFil(V);
      }, 5000);
    }
  },

  // L'adresse dit quelle discussion est ouverte (ou aucune).
  route(V, route){

    const id = route && route.param ? route.param : null;

    V.hotes.racine.dataset.mode = id ? 'fil' : 'liste';

    if(!id){
      V.id = null;
      V.conv = null;
      V.hotes.conv.hidden = true;
      V.hotes.vide.hidden = false;
      if(V.minuteurFil){ clearInterval(V.minuteurFil); V.minuteurFil = null; }
      VUES.messages.marquerActive(V);
      majTitreCourant();
      return;
    }

    if(V.id === id && V.conv) {
      VUES.messages.marquerActive(V);
      majTitreCourant();
      VUES.messages.demarrer(V);
      return;
    }

    VUES.messages.ouvrir(V, id);
  },

  marquerActive(V){
    $$('.com-conv', V.hotes.liste).forEach(b => b.classList.toggle('actif', b.dataset.conv === V.id));
  },

  async chargerListe(V, premiere){

    try{

      const liste = await BD.conversations();

      V.convs = liste || [];
      V.listeChargee = true;
      majCompteursLocal({ messages: V.convs.filter(c => c.non_lus > 0).length });

      // Rien de changé : on ne redessine pas (le focus au clavier resterait en place).
      const signature = JSON.stringify(V.convs.map(c => [c.id, c.dernier && c.dernier.cree_le, c.non_lus]));
      const actif = V.id;

      if(!premiere && signature === V.signatureListe && actif === V.signatureActif) return;

      V.signatureListe = signature;
      V.signatureActif = actif;

      V.hotes.liste.innerHTML = V.convs.length
        ? V.convs.map(c => conversationHtml(c, c.id === V.id)).join('')
        : `<div class="com-vide petit"><span class="com-vide-icone">${icone('messages', 26)}</span><h3>Aucune conversation</h3><p>Écris à un membre depuis son profil, ou avec le bouton ci-dessus.</p></div>`;

      if(premiere) entrerEnCascade($$('.com-conv', V.hotes.liste), 35);

    }catch(e){
      if(premiere) V.hotes.liste.innerHTML = etatErreur(e, true);
    }
  },

  async ouvrir(V, id){

    V.id = id;
    V.conv = null;
    V.hotes.vide.hidden = true;
    V.hotes.conv.hidden = false;
    V.hotes.msgs.innerHTML = '<div class="com-chargement-centre"><span class="com-rond grand" role="status" aria-label="Chargement"></span></div>';
    $('[data-fil-nom]', V.el).textContent = '';
    $('[data-fil-avatar]', V.el).innerHTML = '';
    VUES.messages.marquerActive(V);

    try{

      const r = await BD.messages(id);

      if(V.id !== id) return;

      V.conv = { id, messages: r.messages || [], fin: !!r.fin, autre: r.autre, luAutre: r.lu_autre, bloque: !!r.bloque };

      $('[data-fil-nom]', V.el).textContent = r.autre ? r.autre.pseudo : 'Compte supprimé';
      $('[data-fil-avatar]', V.el).innerHTML = avatarHtml(r.autre, 'm');
      $('[data-act="conv-profil"]', V.el).href = r.autre ? '#community/membre/' + encodeURIComponent(r.autre.pseudo) : '#';

      VUES.messages.dessinerFil(V, true);
      VUES.messages.majSaisie(V);
      majTitreCourant();

      VUES.messages.lire(V);
      VUES.messages.demarrer(V);

      if(!tactile()) V.hotes.saisie.focus({ preventScroll: true });

    }catch(e){
      if(V.id !== id) return;
      V.hotes.msgs.innerHTML = e && (e.introuvable || /n'existe pas/.test(e.message || ''))
        ? etatVide({ icone: 'messages', titre: 'Conversation introuvable', texte: "Cette discussion n'existe pas, ou elle ne t'est pas accessible.",
                     bouton: { libelle: 'Mes messages', attrs: 'data-act="aller" data-vers="messages"' } })
        : etatErreur(e, false);
      V.hotes.racine.dataset.mode = 'fil';
    }
  },

  majSaisie(V){

    const bloque = !!(V.conv && V.conv.bloque);

    $('[data-saisie]', V.el).hidden = bloque;
    $('[data-msg-bloque]', V.el).hidden = !bloque;
  },

  dessinerFil(V, enBas){

    const zone = V.hotes.msgs;

    const entete = V.conv.fin
      ? (V.conv.messages.length
          ? `<div class="com-fil-debut">Début de la conversation avec <b>${esc(V.conv.autre ? V.conv.autre.pseudo : '')}</b></div>`
          : `<div class="com-fil-debut">${V.conv.autre ? `Dis bonjour à <b>${esc(V.conv.autre.pseudo)}</b> 👋` : ''}</div>`)
      : `<button type="button" class="com-btn com-btn-fantome com-btn-petit com-anciens" data-act="msg-anciens">Messages plus anciens</button>`;

    zone.innerHTML = entete + fenetreMessagesHtml(V);

    if(enBas) VUES.messages.defilerEnBas(V, false);
  },

  // Les derniers messages arrivés entrent en glissant, côté de leur auteur.
  animerDernieres(V, n){

    if(mouvementReduit()) return;

    const bulles = $$('.com-bulle', V.hotes.msgs).slice(-Math.max(1, n));

    bulles.forEach(b => {
      if(!b.animate) return;
      const mien = b.classList.contains('mienne');
      b.animate([
        { opacity: 0, transform: 'translateY(12px) scale(.94)', transformOrigin: mien ? 'bottom right' : 'bottom left' },
        { opacity: 1, transform: 'none', transformOrigin: mien ? 'bottom right' : 'bottom left' }
      ], { duration: 360, easing: 'cubic-bezier(.34,1.3,.64,1)' });
    });
  },

  defilerEnBas(V, doux){
    const z = V.hotes.msgs;
    z.scrollTo({ top: z.scrollHeight, behavior: doux && !mouvementReduit() ? 'smooth' : 'auto' });
  },

  procheDuBas(V){
    const z = V.hotes.msgs;
    return z.scrollHeight - z.scrollTop - z.clientHeight < 120;
  },

  async lire(V){

    if(!V.id) return;

    try{
      await BD.lire(V.id);
      const c = V.convs.find(x => x.id === V.id);
      if(c && c.non_lus){
        c.non_lus = 0;
        const b = $('.com-conv[data-conv="' + CSS.escape(V.id) + '"]', V.hotes.liste);
        if(b){ b.classList.remove('non-lu'); const p = $('.com-pastille-nb', b); if(p) p.remove(); }
      }
      majCompteursLocal({ messages: V.convs.filter(x => x.non_lus > 0).length });
    }catch(e){}
  },

  // Toutes les 5 secondes : les messages arrivés, et si l'autre a lu.
  async rafraichirFil(V){

    if(!V.id || !V.conv || V.enRafraichissement) return;

    V.enRafraichissement = true;
    const id = V.id;

    try{

      const r = await BD.messages(id);

      if(V.id !== id || !V.conv) return;

      const connus = new Set(V.conv.messages.map(m => m.id));
      const neufs = (r.messages || []).filter(m => !connus.has(m.id));
      const luAvant = V.conv.luAutre;

      V.conv.luAutre = r.lu_autre;
      V.conv.bloque = !!r.bloque;
      VUES.messages.majSaisie(V);

      if(!neufs.length && luAvant === r.lu_autre) return;

      // Les messages en cours d'envoi restent en bas de la discussion.
      const attente = V.conv.messages.filter(m => m.etat);
      const confirmes = V.conv.messages.filter(m => !m.etat);

      const doitDescendre = VUES.messages.procheDuBas(V);

      V.conv.messages = confirmes.concat(neufs).sort((a, b) => new Date(a.cree_le) - new Date(b.cree_le)).concat(attente);
      VUES.messages.dessinerFil(V, false);
      if(neufs.length) VUES.messages.animerDernieres(V, neufs.length);

      if(neufs.some(m => m.auteur_id !== (moi() && moi().id))){
        VUES.messages.lire(V);
        if(doitDescendre) VUES.messages.defilerEnBas(V, true);
      }

    }catch(e){}finally{
      V.enRafraichissement = false;
    }
  },

  async plusAnciens(V){

    if(!V.conv || V.conv.fin || V.conv.chargeAnciens) return;

    const premier = V.conv.messages.find(m => !m.etat);

    if(!premier) return;

    V.conv.chargeAnciens = true;

    const zone = V.hotes.msgs;
    const hAvant = zone.scrollHeight;
    const id = V.id;

    try{

      const r = await BD.messages(id, premier.cree_le);

      if(V.id !== id) return;

      const connus = new Set(V.conv.messages.map(m => m.id));
      const anciens = (r.messages || []).filter(m => !connus.has(m.id));

      V.conv.messages = anciens.concat(V.conv.messages);
      V.conv.fin = !!r.fin;
      VUES.messages.dessinerFil(V, false);

      // On reste sur le message qu'on lisait.
      zone.scrollTop = zone.scrollHeight - hAvant;

    }catch(e){
      toastErreur(e);
    }

    if(V.conv) V.conv.chargeAnciens = false;
  },

  async envoyer(V, reprise){

    if(!V.conv || !V.id) return;

    const t = V.hotes.saisie;
    let texte = reprise ? reprise.contenu : t.value.trim();

    if(!texte) return;

    if(!reprise && texte.length > 2000){
      toast('Ton message est trop long (2 000 caractères au plus).', { type: 'erreur' });
      return;
    }

    // Affiché tout de suite, confirmé ensuite.
    const provisoire = reprise || {
      id: 'tmp-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      auteur_id: moi().id,
      contenu: texte,
      cree_le: new Date().toISOString(),
      etat: 'envoi'
    };

    provisoire.etat = 'envoi';

    if(!reprise){
      V.conv.messages.push(provisoire);
      t.value = '';
      ajusterTexte(t);
      V.hotes.envoyer.disabled = true;
    }

    VUES.messages.dessinerFil(V, false);
    VUES.messages.defilerEnBas(V, true);
    if(!reprise) VUES.messages.animerDernieres(V, 1);

    const id = V.id;

    try{

      const reel = await BD.envoyer(id, texte);

      if(V.conv && V.id === id){
        // Le sondage a pu déjà rapporter ce message : on garde un seul exemplaire.
        V.conv.messages = V.conv.messages.filter(m => m === provisoire || m.id !== reel.id);
        const i = V.conv.messages.indexOf(provisoire);
        if(i >= 0) V.conv.messages[i] = reel;
        VUES.messages.dessinerFil(V, false);
        VUES.messages.defilerEnBas(V, false);
      }

      VUES.messages.chargerListe(V, false);

    }catch(e){

      provisoire.etat = 'erreur';
      if(V.conv && V.id === id) VUES.messages.dessinerFil(V, false);
      toastErreur(e);
    }
  },

  retenter(V, idMsg){
    const m = V.conv && V.conv.messages.find(x => x.id === idMsg);
    if(m) VUES.messages.envoyer(V, m);
  }
};

// Nouveau message : on cherche la personne, on ouvre la discussion.
async function nouvelleConversation(){

  if(!exigerConnexion('Connecte-toi pour écrire à un membre.')) return;

  let jeton = 0;

  await ouvrirDialogue({
    titre: 'Nouveau message',
    corps: `
      <label class="com-recherche-champ">${icone('loupe', 18)}
        <input type="search" data-d="q" placeholder="Chercher un membre…" autocomplete="off" aria-label="Chercher un membre">
      </label>
      <div class="com-dialogue-resultats" data-d="res"><p class="com-dialogue-texte petit">Tape un pseudo.</p></div>`,
    boutons: [{ libelle: 'Fermer', valeur: 'non' }],
    focus: 'input[data-d="q"]',
    surOuverture: (boite) => {

      const q = $('[data-d="q"]', boite);
      const res = $('[data-d="res"]', boite);

      const chercher = debounce(async () => {

        const texte = q.value.trim();

        if(texte.length < 2){
          res.innerHTML = '<p class="com-dialogue-texte petit">Tape au moins deux lettres.</p>';
          return;
        }

        const mon = ++jeton;

        try{
          const r = await BD.chercher(texte);
          if(mon !== jeton) return;
          const membres = (r.membres || []).filter(m => m.id !== (moi() && moi().id));
          res.innerHTML = membres.length ? membres.map(m => `
            <button type="button" class="com-conv" data-ecrire="${attr(m.id)}">
              ${avatarHtml(m, 'm')}
              <span class="com-conv-texte"><span class="com-conv-ligne"><b class="com-conv-nom">${esc(m.pseudo)}</b></span>
              <span class="com-conv-apercu">${esc(roleInfo(m.role).icon)} ${esc(roleInfo(m.role).name)}${m.ville ? ' · ' + esc(m.ville) : ''}</span></span>
            </button>`).join('') : '<p class="com-dialogue-texte petit">Personne ne porte ce pseudo.</p>';
        }catch(e){
          res.innerHTML = '<p class="com-dialogue-texte petit">Recherche impossible pour le moment.</p>';
        }
      }, 250);

      q.addEventListener('input', chercher);

      res.addEventListener('click', (e) => {
        const b = e.target.closest('[data-ecrire]');
        if(b){ const id = b.dataset.ecrire; fermerCalque(); ecrireA(id); }
      });
    }
  });
}

function menuConversation(ancre, V){

  const a = V.conv && V.conv.autre;

  if(!a || !a.id) return;

  ouvrirMenu(ancre, [
    { libelle: 'Voir le profil', icone: 'profil', action: () => aller('membre/' + encodeURIComponent(a.pseudo)) },
    { libelle: 'Signaler', icone: 'drapeau', separe: true, action: () => signalerContenu('membre', a.id) },
    V.conv.bloque
      ? { libelle: 'Débloquer @' + a.pseudo, icone: 'interdit', action: async () => {
          if(await bloquerMembre(a.id, a.pseudo, false)){ V.conv.bloque = false; VUES.messages.majSaisie(V); }
        } }
      : { libelle: 'Bloquer @' + a.pseudo, icone: 'interdit', danger: true, action: async () => {
          if(await bloquerMembre(a.id, a.pseudo, true)){ V.conv.bloque = true; VUES.messages.majSaisie(V); }
        } }
  ]);
}



// ---------------------------------------------------------------------
// Les notifications
// ---------------------------------------------------------------------

function notificationTexte(n){

  const a = n.acteur || {};
  const reag = n.reaction ? reaction(n.reaction) : null;
  const surCommentaire = !!n.commentaire && n.type === 'reaction';

  switch(n.type){
    case 'reaction':
      return { avant: '', fort: a.pseudo, apres: ` a réagi ${reag ? reag.emoji + ' ' : ''}à ${surCommentaire ? 'ton commentaire' : 'ton message'}` };
    case 'commentaire':
      return { fort: a.pseudo, apres: ' a commenté ton message' };
    case 'reponse':
      return { fort: a.pseudo, apres: " t'a répondu" };
    case 'suivi':
      return { fort: a.pseudo, apres: " s'est abonné à ton profil" };
    case 'mention':
      return { fort: a.pseudo, apres: " t'a mentionné" };
  }

  return { fort: a.pseudo, apres: '' };
}

function notificationHtml(n){

  const t = notificationTexte(n);
  const a = n.acteur || {};
  const extrait = (n.commentaire && n.commentaire.extrait) || (n.post && n.post.extrait) || '';
  const icones = { reaction: 'coeur', commentaire: 'bulle', reponse: 'bulle', suivi: 'utilisateurPlus', mention: 'arobase' };

  return `
    <button type="button" class="com-notif${n.lu ? '' : ' non-lue'}" data-act="ouvrir-notif" data-id="${attr(n.id)}">
      <span class="com-notif-av">${avatarHtml(a, 'm')}<span class="com-notif-type t-${attr(n.type)}">${icone(icones[n.type] || 'cloche', 12)}</span></span>
      <span class="com-notif-corps">
        <span class="com-notif-texte"><b>${esc(t.fort)}</b>${esc(t.apres)}</span>
        ${extrait ? `<span class="com-notif-extrait">${esc(extrait)}</span>` : ''}
        <time class="com-notif-heure">${esc(depuis(n.cree_le))}</time>
      </span>
      ${n.post && n.post.image ? `<img class="com-notif-image" src="${attr(safeUrl(n.post.image))}" alt="" loading="lazy">` : ''}
      ${n.lu ? '' : '<span class="com-notif-point" aria-label="Non lue"></span>'}
    </button>`;
}

VUES.notifications = {

  titre: () => 'Notifications',

  creer(V){

    V.liste = [];
    V.fin = false;

    V.el.innerHTML = `
      <div class="com-carte com-notifs-boite">
        <div class="com-notifs-tete">
          <h2>Notifications</h2>
          <button type="button" class="com-btn com-btn-fantome com-btn-petit" data-act="notifs-lues">Tout marquer comme lu</button>
        </div>
        <div data-notifs-liste>${squeletteMembre(4)}</div>
        <div class="com-bas"><div class="com-sentinelle" data-notifs-sentinelle></div><div class="com-bas-etat" data-notifs-bas></div></div>
      </div>`;

    V.hotes = {
      liste: $('[data-notifs-liste]', V.el),
      bas: $('[data-notifs-bas]', V.el),
      sentinelle: $('[data-notifs-sentinelle]', V.el)
    };

    if('IntersectionObserver' in window){
      V.observateur = new IntersectionObserver((es) => {
        if(es.some(x => x.isIntersecting)) VUES.notifications.plus(V);
      }, { rootMargin: '500px 0px' });
      V.observateur.observe(V.hotes.sentinelle);
    }
  },

  async montrer(V){

    if(!moi()){
      V.el.innerHTML = etatVide({
        icone: 'cloche', titre: 'Tes notifications',
        texte: 'Connecte-toi pour savoir qui réagit à tes messages et te répond.',
        bouton: { libelle: 'Se connecter', attrs: 'data-act="connexion" data-mode="login"' }
      });
      V.creerEchoue = true;
      return;
    }

    if(V.creerEchoue){ V.creerEchoue = false; VUES.notifications.creer(V); }

    await VUES.notifications.charger(V);

    VUES.notifications.demarrer(V);
  },

  pause(V){
    if(V.minuteur){ clearInterval(V.minuteur); V.minuteur = null; }
    clearTimeout(V.attenteLecture);
  },

  demarrer(V){
    if(V.minuteur) clearInterval(V.minuteur);
    V.minuteur = setInterval(() => { if(!inactif()) VUES.notifications.charger(V, true); }, 30000);
  },

  async charger(V, silencieux){

    if(V.enCours) return;
    V.enCours = true;

    try{

      const r = await BD.notifications();
      const recues = r.notifications || [];

      if(silencieux && V.liste.length){

        // Sondage : on ajoute ce qui est arrivé, sans toucher à la suite déjà
        // chargée en défilant, et sans rien redessiner s'il n'y a rien de neuf.
        const connues = new Set(V.liste.map(n => n.id));
        const neuves = recues.filter(n => !connues.has(n.id));

        if(!neuves.length){ V.enCours = false; return; }

        V.liste = neuves.concat(V.liste);
        VUES.notifications.dessiner(V, false);

      } else {

        const anciennes = new Set(V.liste.filter(n => !n.lu).map(n => n.id));

        V.liste = recues;
        V.fin = !!r.fin;

        // Ce qui était « nouveau » à l'arrivée le reste à l'écran jusqu'à la
        // prochaine visite, même une fois marqué comme lu en base.
        V.liste.forEach(n => { if(anciennes.has(n.id)) n.lu = false; });

        VUES.notifications.dessiner(V, !silencieux);
      }

      // Ouvrir la page vaut lecture : après un instant, tout est marqué lu.
      clearTimeout(V.attenteLecture);
      if(V.liste.some(n => !n.lu) && S.courante === V){
        V.attenteLecture = setTimeout(() => VUES.notifications.marquerLues(V), 1800);
      }

    }catch(e){
      if(!silencieux) V.hotes.liste.innerHTML = etatErreur(e, true);
    }

    V.enCours = false;
  },

  dessiner(V, anime){

    if(!V.liste.length){
      V.hotes.liste.innerHTML = etatVide({
        icone: 'cloche', titre: 'Rien pour le moment',
        texte: "Quand quelqu'un réagit à tes messages, te répond ou te suit, tu le vois ici."
      });
      return;
    }

    const nouvelles = V.liste.filter(n => !n.lu);
    const autres = V.liste.filter(n => n.lu);

    V.hotes.liste.innerHTML =
      (nouvelles.length ? `<h3 class="com-groupe-titre">Nouvelles</h3>${nouvelles.map(notificationHtml).join('')}` : '') +
      (autres.length ? `<h3 class="com-groupe-titre">${nouvelles.length ? 'Plus tôt' : 'Récentes'}</h3>${autres.map(notificationHtml).join('')}` : '');

    if(anime) entrerEnCascade($$('.com-notif', V.hotes.liste), 28);
  },

  async plus(V){

    if(V.enCours || V.fin || !V.liste.length) return;

    V.enCours = true;
    V.hotes.bas.innerHTML = '<span class="com-rond grand" role="status" aria-label="Chargement"></span>';

    try{

      const dernier = V.liste[V.liste.length - 1];
      const r = await BD.notifications(dernier.cree_le);
      const connus = new Set(V.liste.map(n => n.id));

      V.liste = V.liste.concat((r.notifications || []).filter(n => !connus.has(n.id)));
      V.fin = !!r.fin;
      VUES.notifications.dessiner(V, false);
      V.hotes.bas.innerHTML = '';

    }catch(e){
      V.hotes.bas.innerHTML = `<button type="button" class="com-btn com-btn-fantome com-btn-petit" data-act="notifs-plus">Réessayer</button>`;
    }

    V.enCours = false;
  },

  async marquerLues(V){

    if(!V.liste.some(n => !n.lu)) return;

    await VUES.notifications.envoyerLecture(V);
  },

  // Marque comme lu tout ce qui est affiché, pas davantage : une notification
  // arrivée entre-temps reste non lue.
  async envoyerLecture(V){

    if(!V.liste.length) return;

    const recente = V.liste.reduce((m, n) => (n.cree_le > m ? n.cree_le : m), V.liste[0].cree_le);

    try{
      await BD.notificationsLues(recente);
      majCompteurs();
    }catch(e){}
  },

  ouvrirNotif(V, id){

    const n = V.liste.find(x => x.id === id);

    if(!n) return;

    if(n.type === 'suivi' && n.acteur && n.acteur.pseudo){
      aller('membre/' + encodeURIComponent(n.acteur.pseudo));
      return;
    }

    const postId = (n.commentaire && n.commentaire.post_id) || (n.post && n.post.id);

    if(postId) aller('post/' + encodeURIComponent(postId));
  }
};


// ---------------------------------------------------------------------
// La recherche
//
// Des membres, des mots-clics, des messages. La colonne de droite propose
// une recherche rapide ; cette page montre tout.
// ---------------------------------------------------------------------

function membreRechercheHtml(m){
  return `
    <a class="com-mini-lien res" href="#community/membre/${attr(encodeURIComponent(m.pseudo))}" data-act="membre" data-cle="${attr(m.pseudo)}">
      ${avatarHtml(m, 'm')}
      <span class="com-mini-texte">
        <span class="com-mini-nom">${esc(m.pseudo)}</span>
        <span class="com-mini-role">${esc(roleInfo(m.role).icon)} ${esc(roleInfo(m.role).name)}${m.ville ? ' · ' + esc(m.ville) : ''}</span>
      </span>
    </a>`;
}

VUES.recherche = {

  titre: () => 'Recherche',
  retour: true,

  creer(V){

    V.q = '';

    V.el.innerHTML = `
      <div class="com-carte com-recherche-tete">
        <label class="com-recherche-champ grand">
          ${icone('loupe', 20)}
          <input type="search" data-rech="q" placeholder="Un membre, un #mot-clic, un message…" autocomplete="off" aria-label="Rechercher">
        </label>
      </div>
      <div data-rech-rapide></div>
      <div class="com-liste" data-liste hidden></div>`;

    V.hotes = { rapide: $('[data-rech-rapide]', V.el), champ: $('[data-rech="q"]', V.el) };

    V.liste = creerListe($('[data-liste]', V.el), {
      args: () => ({ p_vue: 'recent', p_recherche: V.q }),
      squelette: squelettePost(2),
      vide: () => etatVide({ icone: 'loupe', titre: 'Aucun message', texte: 'Rien ne contient « ' + V.q + ' ».' })
    });
  },

  montrer(V, route){

    const q = (route.param || '').trim();

    if(V.charge && q === V.q) return;

    V.hotes.champ.value = q;
    VUES.recherche.chercher(V, q, true);

    if(!q) setTimeout(() => V.hotes.champ.focus({ preventScroll: true }), 120);
  },

  pause(){},

  async chercher(V, q, depuisRoute){

    V.q = q;
    V.charge = true;
    const mon = V.jeton = (V.jeton || 0) + 1;

    if(q.length < 2){
      V.hotes.rapide.innerHTML = `
        <div class="com-vide petit"><span class="com-vide-icone">${icone('loupe', 26)}</span>
          <h3>Que cherches-tu ?</h3><p>Tape au moins deux lettres.</p></div>`;
      $('[data-liste]', V.el).hidden = true;
      return;
    }

    V.hotes.rapide.innerHTML = '<div class="com-chargement-centre"><span class="com-rond grand" role="status" aria-label="Chargement"></span></div>';

    try{

      const r = await BD.chercher(q);

      if(mon !== V.jeton) return;

      const membres = r.membres || [];
      const tags = r.tags || [];

      V.hotes.rapide.innerHTML =
        (membres.length ? `<section class="com-carte com-res-bloc"><h3 class="com-groupe-titre">Membres</h3>${membres.map(membreRechercheHtml).join('')}</section>` : '') +
        (tags.length ? `<section class="com-carte com-res-bloc"><h3 class="com-groupe-titre">Mots-clics</h3><div class="com-res-tags">${tags.map(t => `
            <a class="com-tag-bloc" href="#community/tag/${attr(encodeURIComponent(t.tag))}" data-act="tag" data-tag="${attr(t.tag)}"><b>#${esc(t.tag)}</b><span>${pluriel(t.n, 'message')}</span></a>`).join('')}</div></section>` : '') +
        `<h3 class="com-groupe-titre sans-carte">Messages</h3>`;

      const liste = $('[data-liste]', V.el);
      liste.hidden = false;
      V.liste.recharger();

      if(!depuisRoute){
        history.replaceState(history.state, '', '#community/recherche/' + encodeURIComponent(q));
      }

    }catch(e){
      if(mon !== V.jeton) return;
      V.hotes.rapide.innerHTML = etatErreur(e, false);
    }
  },

  saisir(V, champ){
    clearTimeout(V.attente);
    V.attente = setTimeout(() => VUES.recherche.chercher(V, champ.value.trim(), false), 320);
  }
};



// ---------------------------------------------------------------------
// L'adresse, les vues, la structure de la page
// ---------------------------------------------------------------------

const ROUTES_AVEC_PARAMETRE = ['post', 'membre', 'tag', 'sujet'];
const ROUTES_SIMPLES = ['explorer', 'collabs', 'messages', 'notifications', 'favoris', 'recherche'];

function pageActive(){
  const p = document.getElementById('page-community');
  return !!p && p.classList.contains('active');
}

function inactif(){
  return document.hidden || !pageActive();
}

function lireRoute(){

  const brut = location.hash.replace(/^#/, '');
  const morceaux = brut.split('/').map(m => decoderAdresse(m));
  const nom = morceaux[1] || '';
  const param = morceaux.slice(2).join('/');

  if(ROUTES_AVEC_PARAMETRE.includes(nom) && param){
    const cle = nom === 'membre' ? 'membre:' + param.toLowerCase() : nom + ':' + param;
    return { nom, param, cle };
  }

  if(ROUTES_SIMPLES.includes(nom)){
    return { nom, param: param || null, cle: nom };
  }

  return { nom: 'accueil', param: null, cle: 'accueil' };
}

const VUES_PERMANENTES = ['accueil', 'explorer', 'collabs', 'messages', 'notifications', 'favoris', 'recherche'];
const VUES_DETAIL_MAX = 6;

function profondeur(){
  return (history.state && history.state.com) || 0;
}

// Va à une page de la communauté ; l'historique du navigateur suit.
function aller(adresse){

  const h = '#community' + (adresse ? '/' + adresse : '');

  S.versLeHaut = true;

  if(location.hash !== h){
    history.pushState({ com: profondeur() + 1 }, '', h);
  }

  afficher();
}

function retourArriere(){
  if(profondeur() > 0) history.back();
  else aller('');
}

function creerVue(route){

  const def = VUES[route.nom];

  const el = document.createElement('section');
  el.className = 'com-vue';
  el.dataset.cle = route.cle;
  el.dataset.vue = route.nom;
  el.hidden = true;

  $('#com-vues', S.racine).appendChild(el);

  const V = { cle: route.cle, nom: route.nom, el, route, vueLe: Date.now() };

  S.vues.set(route.cle, V);

  def.creer(V, route);

  return V;
}

function detruireVue(V){

  const def = VUES[V.nom];

  if(def && def.pause) def.pause(V);
  if(V.liste && V.liste.detruire) V.liste.detruire();
  if(V.observateur) V.observateur.disconnect();

  V.el.remove();
  S.vues.delete(V.cle);
  delete S.scrolls[V.cle];
}

// Les vues de détail (messages ouverts, profils vus...) ne s'accumulent pas.
function elaguerVues(garde){

  const details = Array.from(S.vues.values())
    .filter(v => !VUES_PERMANENTES.includes(v.nom) && v !== garde)
    .sort((a, b) => a.vueLe - b.vueLe);

  while(details.length >= VUES_DETAIL_MAX){
    detruireVue(details.shift());
  }
}

function afficher(){

  if(!S.racine || !S.coque) return;

  const route = lireRoute();
  const prec = S.courante;

  // Même vue, autre paramètre (une autre discussion, une autre recherche).
  if(prec && prec.cle === route.cle){

    S.route = route;
    S.versLeHaut = false;
    const def = VUES[route.nom];

    if(def.surMemeCle) def.surMemeCle(prec, route);

    majCoque();
    return;
  }

  if(prec){
    S.scrolls[prec.cle] = window.scrollY;
    const defPrec = VUES[prec.nom];
    if(defPrec && defPrec.pause) defPrec.pause(prec);
    prec.el.hidden = true;
  }

  fermerCalque();

  let V = S.vues.get(route.cle);

  if(!V){
    elaguerVues(null);
    V = creerVue(route);
  }

  V.vueLe = Date.now();
  V.route = route;
  S.route = route;
  S.courante = V;

  V.el.hidden = false;

  if(!mouvementReduit() && V.el.animate){
    V.el.animate([{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }],
      { duration: 280, easing: 'cubic-bezier(.16,1,.3,1)' });
  }

  majCoque();

  const def = VUES[route.nom];

  Promise.resolve(def.montrer(V, route)).catch(e => console.warn('Communauté :', e));

  // Navigation vers l'avant : on repart du haut ; Précédent retrouve sa place.
  const haut = S.versLeHaut || !(route.cle in S.scrolls);
  S.versLeHaut = false;

  const cible = haut ? 0 : S.scrolls[route.cle];
  window.scrollTo({ top: cible, behavior: 'instant' });

  // Une vue déjà construite peut être plus courte qu'avant : on réessaie une fois.
  if(!haut) requestAnimationFrame(() => window.scrollTo({ top: cible, behavior: 'instant' }));

  if(S.ouvrirComposerApres && V.composer){
    S.ouvrirComposerApres = false;
    ouvrirComposer(V.composer, {});
  }

}

// Titre de la page affichée, qui peut dépendre de ce que la vue a chargé
// (le pseudo d'un profil, la personne d'une discussion).
function majTitreCourant(){

  const V = S.courante;

  if(!V || !S.coque) return;

  const def = VUES[V.nom];
  const titre = def.titre ? def.titre(V, V.route) : '';

  const h1 = $('.com-entete-titre', S.coque);
  if(h1) h1.textContent = titre;
}

// Ce qui change d'une page à l'autre dans la structure : navigation active,
// bouton retour, largeur de la page.
function majCoque(){

  const V = S.courante;
  const route = S.route;

  if(!V || !route) return;

  const def = VUES[route.nom];
  const u = moi();

  S.coque.dataset.vue = route.nom;

  const actif = {
    accueil: 'accueil', sujet: 'accueil', tag: 'accueil', post: 'accueil',
    explorer: 'explorer', recherche: 'explorer',
    collabs: 'explorer', messages: 'messages', notifications: 'notifications', favoris: 'favoris'
  }[route.nom] || null;

  const monProfil = route.nom === 'membre' && u && route.param.toLowerCase() === u.pseudo.toLowerCase();

  $$('[data-nav]', S.coque).forEach(a => {
    const est = a.dataset.nav === actif;
    a.classList.toggle('actif', est);
    if(est) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });

  // Le trait qui glisse sous la page active du dock.
  const dock = $('.com-dock', S.coque);
  if(dock) placerBarreOnglets(dock, !!S.dockPlace, '.com-dock-item.actif');
  S.dockPlace = true;

  const retour = $('.com-entete-retour', S.coque);
  const avecRetour = !!def.retour && !monProfil;
  retour.hidden = !avecRetour;
  $('.com-entete', S.coque).classList.toggle('avec-retour', avecRetour);

  $('.com-fab', S.coque).hidden = !(route.nom === 'accueil' || route.nom === 'collabs');

  majTitreCourant();
}

function enteteHtml(){

  return `
    <header class="com-entete">
      <button type="button" class="com-icone-btn com-entete-retour" data-act="retour" aria-label="Retour" hidden>${icone('retour', 22)}</button>
      <h1 class="com-entete-titre">Communauté</h1>
      <div class="com-entete-actions">
        <button type="button" class="com-icone-btn" data-act="aller" data-vers="recherche" aria-label="Rechercher">${icone('loupe', 21)}</button>
        <button type="button" class="com-icone-btn com-entete-moi" data-act="menu-moi" aria-label="Mon compte" aria-haspopup="menu" data-puce-mobile></button>
      </div>
    </header>`;
}

function navItemHtml(cle, ic, libelle, badge, vers, classe){
  return `
    <a class="${classe || 'com-nav-item'}" href="#community${vers ? '/' + vers : ''}" title="${attr(libelle)}" data-act="aller" data-vers="${attr(vers || '')}" data-nav="${cle}">
      <span class="com-nav-ic">${icone(ic, 21)}${badge ? `<span class="com-badge-nb" data-badge="${badge}" hidden></span>` : ''}</span>
      <span class="com-nav-lib">${esc(libelle)}</span>
    </a>`;
}

const ELEMENTS_NAV = [
  ['accueil', 'accueil', 'Accueil', null, ''],
  ['explorer', 'explorer', 'Explorer', null, 'explorer'],
  ['messages', 'messages', 'Messages', 'messages', 'messages'],
  ['notifications', 'cloche', 'Alertes', 'notifications', 'notifications'],
  ['favoris', 'signet', 'Enregistrés', null, 'favoris']
];

function coqueHtml(){

  return `
    <div class="com" data-vue="accueil">

      <div class="com-haut">
        <nav class="com-dock" aria-label="Navigation de la communauté">
          ${ELEMENTS_NAV.map(i => navItemHtml(i[0], i[1], i[2], i[3], i[4], 'com-dock-item')).join('')}
          <span class="com-onglet-barre" aria-hidden="true"></span>
        </nav>
        <div class="com-haut-droite">
          <div class="com-rapide">
            <label class="com-recherche-champ">
              ${icone('loupe', 17)}
              <input type="search" data-rapide placeholder="Rechercher" autocomplete="off" aria-label="Rechercher dans la communauté">
            </label>
            <div class="com-rapide-res" data-rapide-res hidden></div>
          </div>
          <div data-puce-moi class="com-puce-hote"></div>
        </div>
      </div>

      <div class="com-centre">
        ${enteteHtml()}
        <div class="com-vues" id="com-vues"></div>
      </div>

      <nav class="com-barre" aria-label="Navigation de la communauté">
        ${ELEMENTS_NAV.slice(0, 5).map(i => navItemHtml(i[0], i[1], i[0] === 'notifications' ? 'Alertes' : i[2], i[3], i[4])).join('')}
      </nav>

      <button type="button" class="com-fab" data-act="publier" aria-label="Publier" hidden>${icone('plus', 26)}</button>
    </div>`;
}

function puceMoiHtml(){

  const u = moi();

  if(!u){
    return `<button type="button" class="com-btn com-btn-fantome com-btn-petit" data-act="connexion" data-mode="login">Se connecter</button>`;
  }

  // Connecté : le profil s'ouvre par le menu du compte, en haut de la page ; le dock reste épuré.
  return '';
}

function majPuceMoi(){

  if(!S.coque) return;

  const hote = $('[data-puce-moi]', S.coque);
  if(hote) hote.innerHTML = puceMoiHtml();

  const u = moi();
  const mobile = $('[data-puce-mobile]', S.coque);

  if(mobile){
    mobile.innerHTML = u ? avatarHtml({ pseudo: u.pseudo, avatar_url: u.avatar }, 's') : icone('profil', 22);
  }
}

function menuMoi(ancre){

  const u = moi();

  if(!u){
    ouvrirMenu(ancre, [
      { libelle: 'Se connecter', icone: 'profil', action: () => openAuthModal('login') },
      { libelle: 'Créer un compte', icone: 'utilisateurPlus', action: () => openAuthModal('signup') },
      { libelle: "L'espace des waveurs", icone: 'jeu', separe: true, action: () => goTo('waveurs') }
    ]);
    return;
  }

  ouvrirMenu(ancre, [
    { libelle: 'Mon profil', icone: 'profil', action: () => aller('membre/' + encodeURIComponent(u.pseudo)) },
    { libelle: 'Enregistrés', icone: 'signet', action: () => aller('favoris') },
    { libelle: "L'espace des waveurs", icone: 'jeu', action: () => goTo('waveurs') },
    { libelle: 'Réglages du compte', icone: 'rouage', separe: true, action: () => ouvrirReglagesProfil() }
  ]);
}


// ---------------------------------------------------------------------
// Les compteurs : messages et notifications non lus
// ---------------------------------------------------------------------

function majBadges(){

  if(!S.coque) return;

  ['messages', 'notifications'].forEach(cle => {
    const n = S.compteurs[cle] || 0;
    $$('[data-badge="' + cle + '"]', S.coque).forEach(b => {
      b.hidden = !n;
      b.textContent = n > 9 ? '9+' : String(n);
    });
  });

  if(typeof window.majBadgeCommunaute === 'function'){
    window.majBadgeCommunaute((S.compteurs.messages || 0) + (S.compteurs.notifications || 0));
  }
}

function majCompteursLocal(partiel){
  Object.assign(S.compteurs, partiel);
  majBadges();
}

async function majCompteurs(){

  if(!moi() || inactif()) return;

  try{
    const r = await BD.compteurs();
    majCompteursLocal({ notifications: r.notifications || 0, messages: r.messages || 0 });
  }catch(e){}
}


// ---------------------------------------------------------------------
// La recherche rapide du dock
// ---------------------------------------------------------------------

// La recherche rapide : quelques résultats sous le champ, la page complète
// d'un Entrée.
function brancherRecherche(){

  const champ = $('[data-rapide]', S.coque);
  const res = $('[data-rapide-res]', S.coque);

  if(!champ) return;

  let jeton = 0;

  const fermer = () => { res.hidden = true; };

  const lancer = debounce(async () => {

    const q = champ.value.trim();

    if(q.length < 2){ fermer(); return; }

    const mon = ++jeton;

    try{

      const r = await BD.chercher(q);

      if(mon !== jeton) return;

      const membres = (r.membres || []).slice(0, 4);
      const tags = (r.tags || []).slice(0, 3);

      res.innerHTML =
        membres.map(membreRechercheHtml).join('') +
        tags.map(t => `<a class="com-tendance" href="#community/tag/${attr(encodeURIComponent(t.tag))}" data-act="tag" data-tag="${attr(t.tag)}"><b>#${esc(t.tag)}</b><small>${esc(pluriel(t.n, 'message'))}</small></a>`).join('') +
        `<a class="com-cote-lien" href="#community/recherche/${attr(encodeURIComponent(q))}" data-act="aller" data-vers="recherche/${attr(encodeURIComponent(q))}">Tous les résultats pour « ${esc(q)} »</a>`;

      res.hidden = false;

    }catch(e){ fermer(); }

  }, 250);

  champ.addEventListener('input', lancer);

  champ.addEventListener('keydown', (e) => {
    if(e.key === 'Enter'){
      const q = champ.value.trim();
      if(q.length >= 2){ fermer(); champ.blur(); aller('recherche/' + encodeURIComponent(q)); }
    } else if(e.key === 'Escape'){
      fermer();
      champ.blur();
    }
  });

  champ.addEventListener('focus', () => { if(res.innerHTML && champ.value.trim().length >= 2) res.hidden = false; });

  // Un seul écouteur sur la page, même si la structure est reconstruite.
  if(!S.docRapide){
    S.docRapide = true;
    document.addEventListener('click', (e) => {
      if(!e.target.closest('.com-rapide')){
        const r = $('[data-rapide-res]', S.coque || document);
        if(r) r.hidden = true;
      }
    });
  }

  res.addEventListener('click', () => { fermer(); champ.value = ''; });
}



// ---------------------------------------------------------------------
// Les gestes
//
// Une seule écoute par type d'événement, sur la page entière : chaque
// élément dit ce qu'il fait par son attribut data-act. Les vues se
// créent et se détruisent sans avoir à brancher quoi que ce soit.
// ---------------------------------------------------------------------

VUES.messages.surMemeCle = (V, route) => VUES.messages.route(V, route);
VUES.recherche.surMemeCle = (V, route) => VUES.recherche.montrer(V, route);

function vueDe(element){
  const el = element.closest('.com-vue');
  return el ? S.vues.get(el.dataset.cle) : null;
}

function idPostDe(element){
  const carte = element.closest('[data-post]');
  return carte ? carte.dataset.post : null;
}

function fermerPalettes(sauf){
  $$('.com-reag-zone.ouverte', S.racine).forEach(z => { if(z !== sauf) z.classList.remove('ouverte'); });
}

function agir(act, cible, e){

  const V = vueDe(cible);
  const lien = cible.tagName === 'A';

  switch(act){

    // --- Navigation ---

    case 'aller':
      if(lien) e.preventDefault();
      aller(cible.dataset.vers || '');
      return;

    case 'retour':
      retourArriere();
      return;

    case 'membre':
      if(lien) e.preventDefault();
      if(cible.dataset.cle) aller('membre/' + encodeURIComponent(cible.dataset.cle));
      return;

    case 'tag':
      if(lien) e.preventDefault();
      aller('tag/' + encodeURIComponent(cible.dataset.tag));
      return;

    case 'sujet':
      if(lien) e.preventDefault();
      aller('sujet/' + encodeURIComponent(cible.dataset.cle));
      return;

    case 'waveurs':
      goTo('waveurs');
      return;

    // L'engrenage du profil, et tout lien « réglages » : les paramètres du compte s'ouvrent dans un tiroir.
    case 'reglages':
      ouvrirReglagesProfil();
      return;

    case 'page-artiste':
      if(typeof ouvrirPageArtiste === 'function') ouvrirPageArtiste(cible.dataset.handle);
      return;

    case 'connexion':
      if(typeof openAuthModal === 'function') openAuthModal(cible.dataset.mode || 'login');
      return;

    case 'reessayer':
      if(V){
        if(V.liste && V.liste.recharger) V.liste.recharger();
        else if(V.nom === 'explorer') VUES.explorer.charger(V, true);
        else if(V.nom === 'notifications') VUES.notifications.charger(V);
        else if(V.nom === 'membre'){ V.charge = false; VUES.membre.charger(V, false); }
        else if(V.nom === 'post'){ V.charge = false; VUES.post.montrer(V); }
        else if(V.nom === 'messages') VUES.messages.chargerListe(V, true);
      }
      return;

    case 'publier':
      if(!exigerConnexion('Connecte-toi pour publier.')) return;
      if(S.route && S.route.nom === 'collabs'){ VUES.collabs.publier(S.courante); return; }
      if(S.route && S.route.nom === 'accueil' && S.courante.composer){
        ouvrirComposer(S.courante.composer, {});
        window.scrollTo({ top: 0, behavior: mouvementReduit() ? 'auto' : 'smooth' });
        return;
      }
      S.ouvrirComposerApres = true;
      aller('');
      return;

    case 'menu-moi':
      menuMoi(cible);
      return;

    // --- Pour bien démarrer ---

    case 'onb-avatar': {
      const champ = $('input[data-c-avatar]', cible.closest('.com-onb'));
      if(champ) champ.click();
      return;
    }

    case 'onb-reglages':
      ouvrirReglagesProfil();
      return;

    case 'onb-post':
      if(S.courante && S.courante.composer){
        ouvrirComposer(S.courante.composer, {});
        window.scrollTo({ top: 0, behavior: mouvementReduit() ? 'auto' : 'smooth' });
      }
      return;

    // --- Messages publics ---

    case 'ouvrir-post': {
      // Un clic sur un lien, un bouton ou une image à l'intérieur du message
      // fait autre chose que l'ouvrir.
      const interne = e.target.closest('a, button, input, textarea, select, iframe, label, .com-embed, .com-images');
      if(interne && interne !== cible && cible.contains(interne)) return;
      if(window.getSelection && String(window.getSelection())) return;
      const id = idPostDe(cible);
      if(id) aller('post/' + encodeURIComponent(id));
      return;
    }

    case 'ouvrir-post-reponse': {
      const id = idPostDe(cible);
      if(!id) return;
      S.focusReponse = true;
      aller('post/' + encodeURIComponent(id));
      return;
    }

    case 'repondre-focus': {
      const t = $('textarea[data-rep]', V ? V.el : S.racine);
      if(t){ t.scrollIntoView({ block: 'center', behavior: mouvementReduit() ? 'auto' : 'smooth' }); t.focus({ preventScroll: true }); }
      return;
    }

    case 'reagir': {
      const zone = cible.closest('.com-reag-zone');
      // Après un appui long, le doigt qui se lève ne vaut pas clic.
      if(S.palettePosee && Date.now() - S.palettePosee < 700) return;
      if(zone) zone.classList.remove('ouverte');
      reagirPost(idPostDe(cible), 'toggle');
      return;
    }

    case 'reagir-choix': {
      const zone = cible.closest('.com-reag-zone');
      if(zone) zone.classList.remove('ouverte');
      reagirPost(idPostDe(cible), cible.dataset.emoji);
      return;
    }

    case 'reagir-com': {
      if(S.palettePosee && Date.now() - S.palettePosee < 700) return;
      const zone = cible.closest('.com-reag-zone');
      if(zone) zone.classList.remove('ouverte');
      reagirCommentaire(cible.closest('[data-com]').dataset.com, 'toggle');
      return;
    }

    case 'reagir-com-choix': {
      const zone = cible.closest('.com-reag-zone');
      if(zone) zone.classList.remove('ouverte');
      reagirCommentaire(cible.closest('[data-com]').dataset.com, cible.dataset.emoji);
      return;
    }

    case 'palette': {
      const zone = cible.closest('.com-reag-zone');
      fermerPalettes(zone);
      zone.classList.toggle('ouverte');

      const palette = $('.com-palette', zone);
      palette.style.left = '';

      if(zone.classList.contains('ouverte')){
        S.palettePosee = Date.now();
        // Sur un écran étroit, la palette se décale pour rester entière à l'écran.
        const depasse = palette.getBoundingClientRect().right - (window.innerWidth - 12);
        if(depasse > 0) palette.style.left = (-4 - depasse) + 'px';
      }
      return;
    }

    case 'favori':
      basculerFavori(idPostDe(cible));
      return;

    case 'partager':
      partagerPost(idPostDe(cible));
      return;

    case 'menu-post':
      menuPost(cible, idPostDe(cible));
      return;

    case 'menu-com':
      menuCommentaire(cible, cible.closest('[data-com]').dataset.com);
      return;

    case 'deplier': {
      const corps = cible.closest('[data-corps]');
      animerHauteur(corps, () => {
        corps.classList.toggle('coupe');
        cible.textContent = corps.classList.contains('coupe') ? 'Voir plus' : 'Voir moins';
      });
      return;
    }

    case 'image': {
      const groupe = cible.closest('.com-images');
      let urls = [];
      try{ urls = JSON.parse(groupe.dataset.urls || '[]'); }catch(x){}
      ouvrirVisionneuse(urls, Number(cible.dataset.i), $('img', cible));
      return;
    }

    case 'lire-embed':
      lancerEmbed(cible);
      return;

    case 'edition-annuler':
      annulerEdition(cible.closest('[data-post]'));
      return;

    case 'edition-valider':
      validerEdition(cible.closest('[data-post]'));
      return;

    // --- Commentaires ---

    case 'repondre-com':
      basculerReponseInline(cible.closest('[data-com]'));
      return;

    case 'rep-envoyer': {
      const zone = cible.closest('.com-repondre');
      const inline = zone.classList.contains('inline');
      const noeud = cible.closest('[data-com]');
      const postId = noeud ? noeud.dataset.pid : (V && V.id);
      envoyerCommentaire(postId, zone, inline && noeud ? noeud.dataset.com : null);
      return;
    }

    case 'rep-annuler': {
      const zone = cible.closest('.com-reponse-zone');
      if(zone) zone.innerHTML = '';
      return;
    }

    case 'voir-reponses': {
      const bloc = cible.closest('.com-reponses');
      $$('[data-masque]', bloc).forEach((m, i) => {
        m.hidden = false;
        if(m.animate && !mouvementReduit()){
          m.animate([{ opacity: 0, transform: 'translateY(-6px)' }, { opacity: 1, transform: 'none' }],
            { duration: 260, delay: i * 30, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'backwards' });
        }
      });
      cible.remove();
      return;
    }

    // --- Listes ---

    case 'liste-plus': {
      const L = listeDe(cible);
      if(L) L.plus();
      return;
    }

    case 'liste-nouveaux': {
      const L = listeDe(cible.nextElementSibling || cible);
      const vue = vueDe(cible);
      const liste = vue && vue.liste;
      if(liste) liste.afficherNouveaux();
      else if(L) L.afficherNouveaux();
      return;
    }

    case 'sujet-menu':
      if(V && V.nom === 'accueil') menuSujets(cible, V);
      return;

    // --- Membres ---

    case 'suivre':
      basculerSuivi(cible.dataset.id, cible);
      return;

    case 'ecrire':
    case 'collab-ecrire':
      ecrireA(cible.dataset.id);
      return;

    case 'debloquer':
      (async () => {
        const p = V && V.profil;
        if(p && await bloquerMembre(p.id, p.pseudo, false)){ V.charge = false; VUES.membre.charger(V, false); }
      })();
      return;

    case 'menu-membre':
      menuMembre(cible, V);
      return;

    case 'profil-modifier':
      if(V && V.profil) modifierMonProfil(V);
      return;

    case 'avatar-modifier': {
      const champ = $('input[data-c-avatar]', cible.parentElement);
      if(champ) champ.click();
      return;
    }

    case 'banniere-modifier': {
      const champ = $('input[data-c-banniere]', cible.parentElement);
      if(champ) champ.click();
      return;
    }

    case 'banniere-retirer':
      retirerBanniere();
      return;

    case 'onglet-profil':
      if(V && V.nom === 'membre') VUES.membre.changerOnglet(V, cible.dataset.onglet);
      return;

    // --- Explorer ---

    case 'ex-role-menu':
      menuMetiers(cible, V.etat.role, 'Tous les métiers', (cle) => {
        VUES.explorer.definirRole(V, cle);
        VUES.explorer.dessinerRoles(V);
      });
      return;

    case 'ex-affiner':
      VUES.explorer.basculerAffiner(V, cible);
      return;

    case 'ex-retirer':
      VUES.explorer.retirerFiltre(V, cible.dataset.cle);
      return;

    case 'ex-reset':
      VUES.explorer.reset(V);
      return;

    case 'ex-defiler':
      VUES.explorer.changerPage(V, Number(cible.dataset.sens));
      return;

    case 'ex-plus':
      VUES.explorer.plus(V);
      return;

    // --- Annonces ---

    case 'collab-publier':
      VUES.collabs.publier(V);
      return;

    case 'collab-mode':
      V.etat.mode = cible.dataset.mode;
      $$('.com-seg-btn', cible.parentElement).forEach(b => {
        const actif = b === cible;
        b.classList.toggle('actif', actif);
        b.setAttribute('aria-checked', actif ? 'true' : 'false');
      });
      VUES.collabs.filtrer(V);
      return;

    case 'collab-role-menu':
      menuMetiers(cible, V.etat.role || null, 'Tous les métiers', (cle) => {
        V.etat.role = cle || '';
        VUES.collabs.dessinerRoles(V);
        VUES.collabs.filtrer(V);
      });
      return;

    // --- Messages privés ---

    case 'ouvrir-conv':
      aller('messages/' + encodeURIComponent(cible.dataset.id));
      return;

    case 'conv-retour':
      aller('messages');
      return;

    case 'conv-profil':
      if(V && V.conv && V.conv.autre){ e.preventDefault(); aller('membre/' + encodeURIComponent(V.conv.autre.pseudo)); }
      return;

    case 'menu-conv':
      menuConversation(cible, V);
      return;

    case 'nouvelle-conv':
      nouvelleConversation();
      return;

    case 'msg-envoyer':
      VUES.messages.envoyer(V);
      return;

    case 'msg-retry':
      VUES.messages.retenter(V, cible.dataset.id);
      return;

    case 'msg-anciens':
      VUES.messages.plusAnciens(V);
      return;

    // --- Notifications ---

    case 'ouvrir-notif':
      VUES.notifications.ouvrirNotif(V, cible.dataset.id);
      return;

    case 'notifs-lues':
      V.liste.forEach(n => { n.lu = true; });
      VUES.notifications.dessiner(V, false);
      VUES.notifications.envoyerLecture(V);
      return;

    case 'notifs-plus':
      VUES.notifications.plus(V);
      return;
  }
}

function brancherEvenements(){

  const racine = S.racine;

  racine.addEventListener('click', (e) => {

    const zone = e.target.closest('.com-reag-zone');
    fermerPalettes(zone);

    // Onglets (fil, profil).
    const onglet = e.target.closest('.com-onglet');

    if(onglet){
      const V = vueDe(onglet);
      if(V && V.nom === 'accueil') VUES.accueil.changerOnglet(V, onglet.dataset.onglet);
      else if(V && V.nom === 'membre') VUES.membre.changerOnglet(V, onglet.dataset.onglet);
      return;
    }

    const cible = e.target.closest('[data-act]');

    if(!cible || !racine.contains(cible)) return;

    // Un lien ouvert dans un nouvel onglet suit sa route normale.
    if(cible.tagName === 'A' && (e.ctrlKey || e.metaKey || e.shiftKey || e.button === 1)) return;

    const act = cible.dataset.act;

    if(agirComposer(act, cible, e)){
      if(cible.tagName === 'A') e.preventDefault();
      return;
    }

    agir(act, cible, e);
  });

  racine.addEventListener('input', (e) => {

    const c = e.target;

    if(saisirComposer(c, e)) return;

    const V = vueDe(c);

    if(c.matches && c.matches('[data-ex]') && V) { VUES.explorer.saisir(V, c); return; }
    if(c.matches && c.matches('[data-rech="q"]') && V) { VUES.recherche.saisir(V, c); return; }
  });

  racine.addEventListener('change', (e) => {

    const c = e.target;

    if(saisirComposer(c, e)) return;

    const V = vueDe(c);

    if(c.matches && c.matches('select[data-ex]') && V) { VUES.explorer.saisir(V, c); return; }
    if(c.matches && c.matches('input[data-c-avatar]')) { choisirAvatar(c); return; }
    if(c.matches && c.matches('input[data-c-banniere]')) { choisirBanniere(c); return; }
  });

  racine.addEventListener('keydown', (e) => {

    if(clavierComposer(e.target, e)) return;

    // Échap annule une correction de message ou une réponse en cours.
    if(e.key === 'Escape' && !calqueCourant){

      const edition = e.target.closest && e.target.closest('.com-edition');

      if(edition){ e.preventDefault(); annulerEdition(edition.closest('.com-post')); return; }

      const reponse = e.target.closest && e.target.closest('.com-reponse-zone');

      if(reponse){ e.preventDefault(); reponse.innerHTML = ''; return; }
    }

    // Entrée ou Espace sur une carte focalisable : elle s'ouvre.
    if((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('article[data-act]')){
      e.preventDefault();
      e.target.click();
    }
  });

  // Coller ou déposer une image dans le compositeur.
  racine.addEventListener('paste', (e) => {
    const carte = e.target.closest && e.target.closest('.com-composer');
    if(!carte || !carte.__inst) return;
    const fichiers = imagesDuPresse(e);
    if(fichiers.length){ e.preventDefault(); ajouterImages(carte.__inst, fichiers); }
  });

  racine.addEventListener('dragover', (e) => {
    const carte = e.target.closest && e.target.closest('.com-composer');
    if(carte && carte.__inst && carte.__inst.ouvert){ e.preventDefault(); carte.classList.add('depot'); }
  });

  racine.addEventListener('dragleave', (e) => {
    const carte = e.target.closest && e.target.closest('.com-composer');
    if(carte) carte.classList.remove('depot');
  });

  racine.addEventListener('drop', (e) => {
    const carte = e.target.closest && e.target.closest('.com-composer');
    if(!carte || !carte.__inst) return;
    carte.classList.remove('depot');
    const fichiers = imagesDuPresse(e);
    if(fichiers.length){ e.preventDefault(); ajouterImages(carte.__inst, fichiers); }
  });

  // Un appui hors de la page (barre du site...) referme aussi la palette ouverte.
  if(!S.docPalette){
    S.docPalette = true;
    document.addEventListener('click', (e) => {
      if(!e.target.closest('.com-reag-zone')) fermerPalettes(null);
    });
  }

  // La barre qui glisse sous les onglets suit la largeur de la page.
  window.addEventListener('resize', debounce(() => {
    $$('.com-onglets', racine).forEach(o => { if(o.offsetParent) placerBarreOnglets(o, false); });
    const dock = $('.com-dock', racine);
    if(dock && dock.offsetParent) placerBarreOnglets(dock, false, '.com-dock-item.actif');
  }, 150));

  // Appui long sur un doigt : la palette de réactions s'ouvre.
  racine.addEventListener('pointerdown', (e) => {

    const b = e.target.closest('.com-act-reag');

    if(!b || e.pointerType === 'mouse') return;

    clearTimeout(S.appui);
    S.appui = setTimeout(() => {
      const zone = b.closest('.com-reag-zone');
      if(!zone) return;
      fermerPalettes(zone);
      zone.classList.add('ouverte');
      S.palettePosee = Date.now();
      if(navigator.vibrate) navigator.vibrate(8);
    }, 420);
  });

  ['pointerup', 'pointercancel', 'pointermove'].forEach(t => {
    racine.addEventListener(t, (e) => {
      if(t === 'pointermove' && e.pointerType === 'mouse') return;
      clearTimeout(S.appui);
    }, { passive: true });
  });

  racine.addEventListener('contextmenu', (e) => {
    // Sur téléphone, l'appui long ouvre aussi le menu du navigateur : sur le
    // bouton de réaction, c'est la palette qui doit gagner.
    if(e.target.closest('.com-act-reag') && S.palettePosee && Date.now() - S.palettePosee < 1500) e.preventDefault();
  });
}


// ---------------------------------------------------------------------
// Le point d'entrée
// ---------------------------------------------------------------------

let styleInjecte = false;

function injecterStyle(){

  if(styleInjecte) return;

  const style = document.createElement('style');
  style.id = 'com-style';
  style.textContent = FEUILLE;
  document.head.appendChild(style);

  styleInjecte = true;
}

async function chargerReferentiel(){

  if(S.refCharge) return;

  try{

    const r = await BD.referentiel();

    if(r && r.sujets && r.metiers){
      S.ref = { sujets: r.sujets, metiers: r.metiers };
      S.refCharge = true;
      S.installation = false;
    }

  }catch(e){

    if(e && e.installation){
      S.installation = true;
      throw e;
    }

    // Réseau capricieux : on dessine avec le minimum, on réessaiera.
  }
}

// Efface tout ce qui appartenait à la session précédente.
function reinitialiser(){

  Array.from(S.vues.values()).forEach(detruireVue);

  S.vues.clear();
  S.courante = null;
  S.route = null;
  S.scrolls = {};
  S.suggestions = null;
  S.tendances = null;
  S.compteurs = { notifications: 0, messages: 0 };

  REG_POSTS.clear();
  REG_COMS.clear();
  REGISTRE_MEMBRES.clear();

  fermerCalque();

  S.coque = null;
}

function demarrerMinuteurs(){

  if(S.minuteurs.compteurs) return;

  S.minuteurs.compteurs = setInterval(majCompteurs, 20000);
  S.minuteurs.temps = setInterval(() => { if(!inactif()) rafraichirTemps(); }, 60000);

  document.addEventListener('visibilitychange', () => {
    if(!document.hidden && pageActive()){
      majCompteurs();
      rafraichirTemps();
    }
  });

  // La barre d'icônes reste en haut quand on remonte, et s'efface quand on descend : elle ne gêne pas la lecture.
  let y0 = window.scrollY;
  let cumul = 0;

  window.addEventListener('scroll', () => {

    const haut = S.coque && $('.com-haut', S.coque);

    const y = window.scrollY;
    const d = y - y0;

    y0 = y;

    if(!haut || inactif()) return;

    // Tout en haut de la page : la barre est toujours là.
    if(y < 80){
      cumul = 0;
      haut.classList.remove('cache');
      return;
    }

    // Un changement de sens repart de zéro ; un petit geste ne suffit pas à la faire bouger.
    if(Math.sign(d) !== Math.sign(cumul)) cumul = 0;
    cumul += d;

    if(cumul > 28) haut.classList.add('cache');
    else if(cumul < -28) haut.classList.remove('cache');

  }, { passive: true });
}

// Les ouvertures se font l'une après l'autre : le menu, la reprise de session
// et l'adresse peuvent toutes demander la page au même instant.
let fileOuverture = Promise.resolve();

function ouvrir(){
  fileOuverture = fileOuverture.then(ouvrirReel).catch(e => console.warn('Communauté :', e));
  return fileOuverture;
}

async function ouvrirReel(){

  injecterStyle();

  const racine = document.getElementById('com-racine');

  if(!racine) return;

  const u = moi();
  const id = u ? u.id : null;

  // Un autre compte (ou plus de compte) : on repart d'une page neuve.
  if(S.racine && (S.userId !== id || S.racine !== racine)){
    reinitialiser();
  }

  const premiere = !S.coque;

  S.racine = racine;
  S.userId = id;

  if(premiere){

    racine.innerHTML = `<div class="com-demarrage" role="status" aria-label="Chargement de la communauté"><span class="com-rond grand"></span></div>`;

    try{
      await chargerReferentiel();
    }catch(e){
      racine.innerHTML = `<div class="com-installation">${etatErreur(e, false)}</div>
        <p style="text-align:center"><button type="button" class="com-btn com-btn-fantome" onclick="goTo('waveurs')">Aller à l'espace des waveurs</button></p>`;
      return;
    }

    // Pendant l'attente, la page a pu changer de compte : on s'arrête là,
    // l'appel suivant s'en charge.
    if(S.racine !== racine || S.userId !== (moi() ? moi().id : null)) return;

    racine.innerHTML = coqueHtml();
    S.coque = $('.com', racine);

    if(!racine.__comBranche){
      brancherEvenements();
      racine.__comBranche = true;
    }

    brancherRecherche();
    majPuceMoi();
    majBadges();
    demarrerMinuteurs();
  } else if(!S.refCharge){
    chargerReferentiel().catch(() => {});
  }

  afficher();
  majCompteurs();
}

window.Com = {
  ouvrir,
  reglages: ouvrirReglagesProfil,
  avatarRecadre,
  banniereRecadree,
  majCompteurs,
  // Appelé quand la page Communauté est quittée : tout se met en pause.
  quitter(){ fermerCalque(); },

  // Le profil de la personne connectée vient de changer (paramètres enregistrés) : ses pages se relisent, et
  // l'adresse suit son pseudo s'il a changé.
  profilMisAJour(){

    const u = moi();

    if(!u) return;

    S.vues.forEach((v) => {
      if(v.nom === 'membre' && v.profil && v.profil.id === u.id) v.charge = false;
    });

    const v = S.courante;

    if(!v || v.nom !== 'membre' || !v.profil || v.profil.id !== u.id) return;

    if(v.cle.toLowerCase() !== u.pseudo.toLowerCase()){
      history.replaceState({ com: 1 }, '', '#community/membre/' + encodeURIComponent(u.pseudo));
      goTo('community', { sansAdresse: true });
      return;
    }

    VUES.membre.charger(v, false);
  },

  // L'encart « Pour bien démarrer » se redessine quand une étape se coche.
  majOnboarding(){
    const v = S.vues.get('accueil');
    if(v && v.hotes) VUES.accueil.onboarding(v);
  },

  // Son propre profil, ouvert sur un onglet précis (le panneau d'XP envoie sur les succès). Attend que la page
  // du profil soit dessinée avant de changer d'onglet.
  async profilSurOnglet(onglet){

    const u = moi();

    if(!u || !await this.profil(u.id)) return false;

    for(let i = 0; i < 50; i++){

      const v = S.courante;

      if(v && v.nom === 'membre' && v.profil && v.profil.id === u.id && v.hotes && v.hotes.onglets){
        VUES.membre.changerOnglet(v, onglet);
        return true;
      }

      await new Promise(r => setTimeout(r, 100));
    }

    return true;
  },

  // Ouvre le profil d'un membre, par pseudo ou par identifiant, et renvoie vrai
  // si la communauté a pu l'afficher (faux : elle n'est pas activée ou le
  // membre n'existe pas — l'appelant peut alors se rabattre sur autre chose).
  async profil(cle, options){

    if(!cle) return false;

    try{

      let pseudo = String(cle);

      if(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(pseudo)){
        const r = await BD.profil(pseudo);
        if(!r) return false;
        pseudo = r.profil.pseudo;
      }

      const adresse = '#community/membre/' + encodeURIComponent(pseudo);

      // « Mon profil » prend la place de #profile dans l'historique au lieu de s'y ajouter.
      if(options && options.remplacer) history.replaceState({ com: 1 }, '', adresse);
      else history.pushState({ com: 1 }, '', adresse);

      goTo('community', { sansAdresse: true });

      return true;

    }catch(e){
      return false;
    }
  }
};



// ---------------------------------------------------------------------
// La feuille de style
// ---------------------------------------------------------------------

const FEUILLE = String.raw`
/* =====================================================================
   La communauté — feuille de style
   Tout ce qui suit vit sous .com (la page) ou sous un nom en com-
   (ce qui se pose par-dessus : menus, fenêtres, visionneuse).
   ===================================================================== */

:root{
  --com-carte: rgba(13,17,24,0.66);
  --com-carte-haut: rgba(20,26,36,0.78);
  --com-bord: rgba(255,255,255,0.09);
  --com-coeur: #ff5d73;
  --com-vert: #3ecf8e;
  --com-orange: #f5a524;
}

/* Les règles générales du site (section{padding:64px 0}...) ne doivent pas
   déformer les blocs d'ici. :where() garde la spécificité au plus bas. */
:where(.com) section, :where(.com) article, :where(.com) header, :where(.com) nav, :where(.com) aside{padding:0;}
:where(.com) h1, :where(.com) h2, :where(.com) h3{margin:0;}
:where(.com) button{font-family:inherit; -webkit-tap-highlight-color:transparent;}
:where(.com) a{color:inherit;}
.com *, .com *::before, .com *::after{box-sizing:border-box;}
.com [hidden]{display:none !important;}
.com-demarrage, .com-installation{display:flex; justify-content:center; padding:80px 0;}

/* La page est déjà une <section> ; celle qui l'enveloppe n'a pas à ajouter
   ses 64 px de marge haute au-dessus d'une page qui commence par son titre. */
#page-community > section{padding:4px 0 0;}

.com-ic{flex:none; display:block;}

/* ---------- BARRE DU BAS (TÉLÉPHONE) ---------- */

.com-barre{display:none;}
.com-fab{display:none;}

/* ---------- AVATARS, RÔLES, NOMS ---------- */

.com-av{
  position:relative; flex:none; display:inline-flex; align-items:center; justify-content:center;
  border-radius:50%; overflow:hidden; color:#fff; font-weight:700;
  background:linear-gradient(145deg, hsl(var(--h,210) 58% 40%), hsl(calc(var(--h,210) + 46) 62% 26%));
  box-shadow:inset 0 0 0 1px rgba(255,255,255,0.14);
}
.com-av img{width:100%; height:100%; object-fit:cover;}
.com-av-s{width:30px; height:30px; font-size:13px;}
.com-av-m{width:42px; height:42px; font-size:17px;}
.com-av-l{width:54px; height:54px; font-size:21px;}
.com-av-xl{width:96px; height:96px; font-size:38px; box-shadow:0 0 0 4px #090c11, inset 0 0 0 1px rgba(255,255,255,0.14);}
.com-av-lien{display:inline-flex; border-radius:50%; text-decoration:none; transition:transform .3s var(--ease);}
.com-av-lien:hover{transform:scale(1.06);}

.com-role{
  display:inline-flex; align-items:center; gap:4px; flex:none;
  padding:3px 10px; border-radius:var(--radius-pill); font-size:12px; font-weight:500;
  color:var(--c, var(--ink-soft)); background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.12);
}
@supports (color: color-mix(in srgb, red, blue)){
  .com-role{
    background:color-mix(in srgb, var(--c) 14%, transparent);
    border-color:color-mix(in srgb, var(--c) 38%, transparent);
  }
}
.com-role-petit{padding:1px 8px; font-size:11px;}
.com-nom{font-weight:600; color:var(--ink);}
.com-nom[data-act]{cursor:pointer;}
.com-nom[data-act]:hover{text-decoration:underline;}
.com-profil-nom{display:flex; align-items:center; flex-wrap:wrap; gap:6px 12px;}
.com-logo-nom{height:30px; width:auto; max-width:140px; object-fit:contain; flex:none; opacity:.95;}
.com-nom-ligne{display:inline-flex; align-items:center; gap:5px; max-width:100%; vertical-align:middle;}
.com-nom-ligne > *{flex:none;}
.com-nom-ligne > .com-nom{flex:0 1 auto; min-width:0; overflow-wrap:anywhere;}
.com-badge-equipe{display:inline-flex; align-items:center; color:var(--blue-bright);}
.com-nom-ligne .com-badge-equipe svg, .com-nom-ligne .coche-verifie svg{width:16px; height:16px; display:block;}
.com-nom-ligne .coche-verifie{margin:0; vertical-align:baseline; display:inline-flex; align-items:center;}
.com-badge-artiste{
  display:inline-flex; align-items:center; justify-content:center; margin-left:4px;
  width:15px; height:15px; border-radius:50%; background:var(--blue); color:#fff; vertical-align:1px;
}
.com-auteur-badge{
  font-size:10px; font-weight:600; letter-spacing:0.04em; text-transform:uppercase;
  padding:1px 7px; border-radius:99px; background:rgba(20,137,222,0.2); color:var(--blue-bright);
}
.com-sep{color:var(--muted); margin:0 4px;}
.com-ville{display:inline-flex; align-items:center; gap:4px; color:var(--ink-soft); font-size:13px; font-weight:300;}
.com-role-simple{color:var(--ink-soft); font-size:13px; font-weight:300;}
.com-meta-discret{color:var(--muted); font-size:13px; font-weight:300;}

/* ---------- CARTES, BOUTONS, PUCES ---------- */

.com-carte{
  position:relative; border-radius:var(--radius);
  background:var(--com-carte); border:1px solid var(--com-bord);
  box-shadow:var(--ombre-1), var(--reflet-int);
}

.com-btn{
  display:inline-flex; align-items:center; justify-content:center; gap:8px;
  padding:11px 20px; border-radius:var(--radius-pill);
  font-size:14px; font-weight:600; line-height:1; white-space:nowrap;
  border:1px solid var(--line-strong); cursor:pointer; color:var(--ink);
  transition:background .25s var(--ease), border-color .25s var(--ease), transform .25s var(--ease), box-shadow .25s var(--ease), opacity .25s var(--ease);
}
.com-btn:active{transform:translateY(1px) scale(.985);}
.com-btn[disabled]{opacity:.45; cursor:not-allowed;}
.com-btn-plein{background:var(--blue); border-color:transparent; color:#fff; box-shadow:var(--ombre-1), var(--reflet-int);}
.com-btn-plein:hover:not([disabled]){background:#1a97ee; box-shadow:var(--ombre-2), var(--reflet-int);}
.com-btn-plein.danger{background:var(--danger);}
.com-btn-fantome{background:rgba(255,255,255,0.06); box-shadow:var(--reflet-int);}
.com-btn-fantome:hover:not([disabled]){background:rgba(255,255,255,0.12); border-color:rgba(255,255,255,0.3);}
.com-btn-petit{padding:8px 15px; font-size:13px;}

.com-icone-btn{
  display:inline-flex; align-items:center; justify-content:center; flex:none;
  width:40px; height:40px; border-radius:50%; border:0; background:transparent; color:var(--ink-soft); cursor:pointer;
  transition:background .25s var(--ease), color .25s var(--ease), transform .25s var(--ease);
}
.com-icone-btn:hover{background:rgba(255,255,255,0.09); color:var(--ink);}
.com-icone-btn:active{transform:scale(.92);}
.com-icone-btn.bordure{border:1px solid var(--line-strong);}

/* Suivre / Suivi / Ne plus suivre : le libellé change au survol. */
.com-suivre .lib-oui, .com-suivre .lib-quitter{display:none;}
.com-suivre.actif .lib-non{display:none;}
.com-suivre.actif .lib-oui{display:inline;}
.com-suivre.actif:hover .lib-oui{display:none;}
.com-suivre.actif:hover .lib-quitter{display:inline; color:var(--danger);}
.com-suivre.actif:hover{border-color:rgba(229,105,92,0.55); background:rgba(229,105,92,0.1);}

.com-chip{
  flex:none; display:inline-flex; align-items:center; gap:6px;
  padding:8px 15px; border-radius:var(--radius-pill); border:1px solid var(--com-bord);
  background:rgba(255,255,255,0.045); color:var(--ink-soft); font-size:13px; font-weight:500; cursor:pointer; text-decoration:none;
  transition:background .25s var(--ease), border-color .25s var(--ease), color .25s var(--ease), transform .25s var(--ease);
}
.com-chip:hover{background:rgba(255,255,255,0.1); color:var(--ink);}
.com-chip:active{transform:scale(.96);}
.com-chip.actif{background:var(--blue); border-color:transparent; color:#fff;}
.com-chip-ic{font-size:14px; line-height:1; display:inline-flex;}

.com-puce, .com-pastille{
  display:inline-flex; align-items:center; gap:5px;
  padding:3px 10px; border-radius:var(--radius-pill); font-size:12px; font-weight:500; line-height:1.5;
  background:rgba(255,255,255,0.07); border:1px solid rgba(255,255,255,0.1); color:var(--ink-soft);
}
.com-puce.lieu{color:var(--ink-soft);}
.com-puce.remu[data-r="paye"]{color:var(--com-vert); border-color:rgba(62,207,142,0.35); background:rgba(62,207,142,0.1);}
.com-puce.remu[data-r="partage"]{color:var(--com-orange); border-color:rgba(245,165,36,0.35); background:rgba(245,165,36,0.1);}
.com-puce.retirable{padding-right:4px;}
.com-puce.retirable button{
  display:inline-flex; align-items:center; justify-content:center; width:18px; height:18px; padding:0;
  border:0; border-radius:50%; background:rgba(255,255,255,0.1); color:var(--ink); cursor:pointer;
}
.com-puce.retirable button:hover{background:rgba(255,255,255,0.22);}
.com-puce.bouton{cursor:pointer; padding-right:10px; transition:background .2s var(--ease);}
.com-puce.bouton:hover{background:rgba(255,255,255,0.14);}

.com-seg{
  display:inline-flex; padding:4px; border-radius:var(--radius-pill);
  background:rgba(255,255,255,0.06); border:1px solid var(--com-bord); gap:2px; flex-wrap:wrap;
}
.com-seg-btn{
  padding:8px 16px; border-radius:var(--radius-pill); border:0; background:transparent;
  color:var(--ink-soft); font-size:13px; font-weight:600; cursor:pointer;
  transition:background .3s var(--ease), color .3s var(--ease);
}
.com-seg-btn:hover{color:var(--ink);}
.com-seg-btn.actif{background:var(--blue); color:#fff; box-shadow:var(--ombre-1);}
.com-seg-large{display:flex;}
.com-seg-large .com-seg-btn{flex:1;}

/* ---------- ONGLETS ---------- */

.com-onglets{
  position:relative; display:flex; margin:2px 0 16px;
  border-bottom:1px solid var(--com-bord);
}
.com-onglet{
  flex:1; padding:14px 8px; border:0; background:transparent; cursor:pointer;
  font-size:14px; font-weight:600; color:var(--muted);
  transition:color .3s var(--ease), background .3s var(--ease);
}
.com-onglet:hover{color:var(--ink); background:rgba(255,255,255,0.04);}
.com-onglet.actif{color:var(--ink);}
.com-onglet-barre{
  position:absolute; left:0; bottom:-1px; height:3px; width:0; border-radius:3px 3px 0 0;
  background:var(--blue-bright);
  transition:transform .45s var(--ease), width .45s var(--ease);
}

.com-defile{
  display:flex; gap:8px; overflow-x:auto; padding:2px; margin:0 -2px; scrollbar-width:none; -webkit-overflow-scrolling:touch;
}
.com-defile::-webkit-scrollbar{display:none;}

/* ---------- MOUVEMENTS COMMUNS ---------- */

@keyframes comEntre{from{opacity:0; transform:translateY(14px);} to{opacity:1; transform:none;}}
@keyframes comPop{from{transform:scale(.3); opacity:0;} to{transform:scale(1); opacity:1;}}
@keyframes comMenu{from{opacity:0; transform:translateY(-6px) scale(.97);} to{opacity:1; transform:none;}}
@keyframes comTourne{to{transform:rotate(360deg);}}
@keyframes comBrille{from{background-position:200% 0;} to{background-position:-200% 0;}}

.com-entre{animation:comEntre .55s var(--ease) both;}

.com-rond{
  display:inline-block; width:16px; height:16px; border-radius:50%;
  border:2px solid rgba(255,255,255,0.2); border-top-color:var(--blue-bright);
  animation:comTourne .7s linear infinite;
}
.com-rond.grand{width:28px; height:28px; border-width:3px;}

.com-sq{
  display:block; height:12px; border-radius:7px; margin-top:10px; max-width:100%;
  background:linear-gradient(90deg, rgba(255,255,255,0.05) 25%, rgba(255,255,255,0.12) 50%, rgba(255,255,255,0.05) 75%);
  background-size:200% 100%; animation:comBrille 1.6s linear infinite;
}
.com-sq-rond{width:42px; height:42px; border-radius:50%; margin-top:0;}
.com-sq-ligne{display:flex; gap:12px; align-items:center; margin-bottom:6px;}
.com-sq-col{flex:1; display:flex; flex-direction:column;}
.com-sq-col .com-sq:first-child{margin-top:0;}
.com-squelette-post{padding:18px 20px 20px;}

.com-vide{
  display:flex; flex-direction:column; align-items:center; text-align:center; gap:10px;
  padding:54px 28px; border-radius:var(--radius); border:1px dashed var(--line);
  background:rgba(255,255,255,0.02);
}
.com-vide.petit{padding:30px 20px;}
.com-vide h3{font-size:18px; font-weight:700;}
.com-vide p{margin:0; color:var(--muted); font-size:14px; font-weight:300; max-width:360px; line-height:1.55;}
.com-vide .com-btn{margin-top:8px;}
.com-vide-icone{
  display:inline-flex; align-items:center; justify-content:center; width:62px; height:62px; border-radius:50%;
  background:rgba(20,137,222,0.12); color:var(--blue-bright); border:1px solid rgba(79,180,255,0.22);
}
.com-chargement-centre{display:flex; justify-content:center; padding:36px 0;}

.com-bas{min-height:1px; display:flex; flex-direction:column; align-items:center;}
.com-sentinelle{height:1px; width:100%;}
.com-bas-etat{display:flex; justify-content:center; padding:10px 0 4px; min-height:8px;}
.com-fin{display:inline-flex; align-items:center; gap:6px; color:var(--muted); font-size:13px; font-weight:300; padding:14px 0;}

.com-liste{display:flex; flex-direction:column; gap:14px;}

/* « N nouveaux messages » : une pastille qui flotte sous la barre de navigation. */
.com-pilule{
  position:sticky; top:100px; z-index:30; display:flex; align-items:center; gap:7px;
  width:max-content; margin:0 auto -46px;
  padding:10px 18px; border-radius:var(--radius-pill); border:0; cursor:pointer;
  background:var(--blue); color:#fff; font-size:13px; font-weight:600;
  box-shadow:0 10px 30px rgba(20,137,222,0.45), var(--reflet-int);
}
.com-pilule[hidden]{display:none;}
.com-pilule:hover{background:#1a97ee;}

.com-sous-titre{font-size:17px; font-weight:700; margin:6px 2px 12px;}

.com-champ{display:flex; flex-direction:column; gap:7px; font-size:13px; color:var(--ink-soft); font-weight:500;}
.com-champ > span{font-weight:600; color:var(--ink);}
.com-champ i{font-style:normal; font-weight:300; color:var(--muted);}
.com-champ input, .com-champ select, .com-champ textarea,
.com-select-sujet select, .com-recherche-champ input{
  width:100%; padding:12px 14px; border-radius:14px; border:1px solid var(--line-strong);
  background:rgba(255,255,255,0.05); color:var(--ink); font:inherit; font-size:15px; font-weight:400;
  transition:border-color .25s var(--ease), background .25s var(--ease), box-shadow .25s var(--ease);
}
.com-champ select, .com-select-sujet select{appearance:none; -webkit-appearance:none; cursor:pointer;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1.5l5 5 5-5' fill='none' stroke='%23838A92' stroke-width='1.8' stroke-linecap='round'/%3E%3C/svg%3E");
  background-repeat:no-repeat; background-position:right 14px center; padding-right:36px;}
.com-champ select option, .com-select-sujet select option{background:#10141b; color:var(--ink);}
.com-champ input:focus, .com-champ select:focus, .com-champ textarea:focus,
.com-select-sujet select:focus, .com-recherche-champ input:focus{
  outline:none; border-color:var(--blue-bright); background:rgba(255,255,255,0.08);
  box-shadow:0 0 0 3px rgba(79,180,255,0.18);
}
.com-grille-champs{display:grid; grid-template-columns:1fr 1fr; gap:14px;}

.com-recherche-champ{
  position:relative; display:flex; align-items:center;
}
.com-recherche-champ > .com-ic{position:absolute; left:16px; color:var(--muted); pointer-events:none;}
.com-recherche-champ input{padding-left:46px; border-radius:var(--radius-pill);}
.com-recherche-champ.grand input{padding:16px 20px 16px 52px; font-size:16px;}
.com-recherche-champ.grand > .com-ic{left:20px;}
.com-recherche-champ input::-webkit-search-cancel-button{filter:invert(.6);}


/* ---------- LE COMPOSITEUR ---------- */

.com-composer{padding:14px 16px; transition:border-color .3s var(--ease), box-shadow .3s var(--ease);}
.com-composer[data-ouvert="true"]{border-color:rgba(79,180,255,0.35); box-shadow:var(--ombre-2), 0 0 0 3px rgba(79,180,255,0.07);}
.com-composer.depot{border-style:dashed; border-color:var(--blue-bright); background:rgba(20,137,222,0.1);}
.com-hote-composer{margin-bottom:14px;}

.com-comp-ferme{display:flex; align-items:center; gap:12px; cursor:text; border-radius:var(--radius-pill);}
.com-comp-invite{
  flex:1; min-width:0; padding:12px 16px; border-radius:var(--radius-pill); border:0; text-align:left; cursor:text;
  background:rgba(255,255,255,0.05); color:var(--muted); font:inherit; font-size:15px; font-weight:300;
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
  transition:background .25s var(--ease);
}
.com-comp-invite:focus-visible{outline:2px solid var(--blue-bright); outline-offset:2px;}
.com-comp-ferme:hover .com-comp-invite{background:rgba(255,255,255,0.09);}
.com-comp-raccourcis{display:flex; gap:2px; color:var(--blue-bright);}
.com-comp-raccourcis .com-icone-btn{color:var(--blue-bright);}

.com-comp-ligne{display:flex; gap:12px; align-items:flex-start;}
.com-comp-zone{flex:1; min-width:0;}
.com-comp-types{display:flex; gap:6px; flex-wrap:wrap; margin-bottom:8px;}
.com-comp-types .com-chip{padding:6px 12px; font-size:12.5px;}
.com-comp-champ{position:relative;}
.com-comp-texte{
  display:block; width:100%; resize:none; border:0; outline:0; background:transparent;
  color:var(--ink); font:inherit; font-size:17px; font-weight:400; line-height:1.5;
  padding:6px 0; min-height:56px; max-height:420px;
  /* Pas de flèches de défilement : le champ grandit avec le texte (ajusterTexte). */
  scrollbar-width:none;
}
.com-comp-texte::-webkit-scrollbar{display:none;}
.com-comp-texte::placeholder{color:var(--muted); font-weight:300;}

.com-comp-collab{
  margin:10px 0 4px; padding:14px; border-radius:18px;
  background:rgba(20,137,222,0.07); border:1px solid rgba(79,180,255,0.2);
  display:flex; flex-direction:column; gap:14px;
}
.com-seg-rem .com-seg-btn{padding:7px 13px;}
.com-styles{
  display:flex; flex-wrap:wrap; align-items:center; gap:6px; padding:8px 10px; min-height:46px;
  border-radius:14px; border:1px solid var(--line-strong); background:rgba(255,255,255,0.05);
}
.com-styles:focus-within{border-color:var(--blue-bright); box-shadow:0 0 0 3px rgba(79,180,255,0.18);}
.com-styles-liste{display:contents;}
.com-styles input{flex:1; min-width:120px; border:0; outline:0; background:transparent; color:var(--ink); font:inherit; font-size:14px; padding:4px;}
.com-suggestions-styles{display:flex; flex-wrap:wrap; gap:6px; margin-top:4px;}

.com-comp-lien{
  position:relative; display:flex; align-items:center; margin:10px 0 2px;
}
.com-comp-lien-ic{position:absolute; left:14px; color:var(--muted); display:flex;}
.com-comp-lien input{
  width:100%; padding:11px 14px 11px 42px; border-radius:var(--radius-pill);
  border:1px solid var(--line-strong); background:rgba(255,255,255,0.05); color:var(--ink); font:inherit; font-size:14px; outline:0;
}
.com-comp-lien input:focus{border-color:var(--blue-bright); box-shadow:0 0 0 3px rgba(79,180,255,0.18);}

.com-comp-images{display:grid; grid-template-columns:repeat(4, 1fr); gap:8px; margin:12px 0 2px;}
.com-vignette{position:relative; aspect-ratio:1/1; border-radius:14px; overflow:hidden; background:#0a0d12; animation:comPop .4s cubic-bezier(.34,1.56,.64,1);}
.com-vignette img{width:100%; height:100%; object-fit:cover; transition:opacity .3s var(--ease);}
.com-vignette.envoi img{opacity:.45;}
.com-vignette-etat{position:absolute; inset:0; display:flex; align-items:center; justify-content:center;}
.com-vignette-etat.err{background:rgba(229,105,92,0.5); font-size:28px; font-weight:700; color:#fff;}
.com-vignette-x{
  position:absolute; top:6px; right:6px; width:26px; height:26px; border-radius:50%; border:0; padding:0;
  display:flex; align-items:center; justify-content:center;
  background:rgba(5,7,10,0.78); color:#fff; cursor:pointer; backdrop-filter:blur(6px);
  transition:background .2s var(--ease), transform .2s var(--ease);
}
.com-vignette-x:hover{background:var(--danger); transform:scale(1.1);}

.com-comp-pied{
  display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap;
  margin-top:8px; padding-top:10px; border-top:1px solid var(--com-bord);
}
.com-comp-outils{display:flex; align-items:center; gap:2px; color:var(--blue-bright);}
.com-comp-outils .com-icone-btn{color:var(--blue-bright);}
.com-select-sujet{margin-left:6px;}
.com-select-sujet select{padding:8px 32px 8px 12px; font-size:13px; border-radius:var(--radius-pill); width:auto; font-weight:500;}
.com-comp-envoi{display:flex; align-items:center; gap:10px;}
.com-compteur{font-size:12px; color:var(--muted); font-variant-numeric:tabular-nums;}
.com-compteur.orange{color:var(--com-orange);}
.com-compteur.rouge{color:var(--danger); font-weight:700;}

.com-invitation{
  display:flex; align-items:center; justify-content:space-between; gap:16px; flex-wrap:wrap; padding:18px 20px;
  background:linear-gradient(135deg, rgba(20,137,222,0.16), rgba(13,17,24,0.66) 60%);
}
.com-invitation-texte{display:flex; flex-direction:column; gap:3px; min-width:200px; flex:1;}
.com-invitation-texte b{font-size:16px; font-weight:700;}
.com-invitation-texte span{font-size:14px; color:var(--ink-soft); font-weight:300;}
.com-invitation-actions{display:flex; gap:8px; flex-wrap:wrap;}
.com-invitation.compact{padding:14px 16px;}

/* ---------- UN MESSAGE ---------- */

.com-post{padding:16px 18px 8px; transition:border-color .3s var(--ease), background .3s var(--ease), transform .4s var(--ease);}
.com-post[data-act]{cursor:pointer;}
.com-post[data-act]:hover{border-color:rgba(255,255,255,0.16); background:var(--com-carte-haut);}
.com-post:focus-visible{outline:2px solid var(--blue-bright); outline-offset:2px;}
.com-post.epingle{border-color:rgba(79,180,255,0.3);}
.com-epingle{
  display:flex; align-items:center; gap:7px; margin:-4px 0 10px 54px;
  font-size:12px; font-weight:600; color:var(--blue-bright); letter-spacing:0.01em;
}

.com-post-tete{display:flex; align-items:flex-start; gap:12px;}
.com-post-qui{flex:1; min-width:0;}
.com-post-nom{display:flex; align-items:center; gap:8px; flex-wrap:wrap; font-size:15px; line-height:1.3;}
.com-post-meta{display:flex; align-items:center; flex-wrap:wrap; gap:0; font-size:13px; color:var(--muted); font-weight:300; margin-top:2px;}
.com-post-meta time{color:var(--muted);}
.com-sujet-lien{color:var(--muted); text-decoration:none; transition:color .2s var(--ease);}
.com-sujet-lien:hover{color:var(--blue-bright);}
.com-modifie{margin-left:4px;}
.com-type-badge{
  display:inline-flex; align-items:center; gap:4px; margin-left:8px;
  padding:1px 8px; border-radius:99px; font-size:11px; font-weight:600;
}
.com-type-badge.question{background:rgba(245,165,36,0.14); color:var(--com-orange);}
.com-type-badge.son{background:rgba(62,207,142,0.14); color:var(--com-vert);}

.com-post-corps{margin:10px 0 2px 54px; position:relative;}
.com-texte{font-size:15.5px; line-height:1.55; font-weight:400; color:var(--ink); overflow-wrap:anywhere; white-space:pre-wrap;}
.com-post-corps.coupe .com-texte{
  display:-webkit-box; -webkit-line-clamp:7; -webkit-box-orient:vertical; overflow:hidden;
}
.com-voir-plus{
  margin-top:4px; padding:4px 0; border:0; background:none; color:var(--blue-bright);
  font-size:14px; font-weight:600; cursor:pointer;
}
.com-voir-plus:hover{text-decoration:underline;}
.com-lien-ext{color:var(--blue-bright); text-decoration:none; word-break:break-all;}
.com-lien-ext:hover{text-decoration:underline;}
.com-mention, .com-tag{color:var(--blue-bright); text-decoration:none; font-weight:500;}
.com-mention:hover, .com-tag:hover{text-decoration:underline;}

.com-post > .com-images, .com-post > .com-embed, .com-post > .com-carte-lien,
.com-post > .com-collab-cta, .com-post > .com-edition{margin-left:54px; margin-top:10px;}
.com-post.detail .com-post-corps .com-texte{font-size:17px;}

.com-edition{display:flex; flex-direction:column; gap:8px;}
.com-edition .com-comp-champ{
  padding:10px 14px; border-radius:16px; border:1px solid var(--blue-bright); background:rgba(255,255,255,0.05);
}
.com-edition .com-comp-texte{font-size:15px; min-height:70px;}
.com-edition-pied{display:flex; justify-content:flex-end; gap:8px;}

/* Annonce de collaboration : une ligne et ses détails, sans bandeau. */
.com-collab{--c:var(--blue-bright); display:flex; flex-direction:column; gap:4px; padding:0; border:0; background:none;}
.com-collab[data-mode="propose"]{--c:var(--com-vert);}
.com-collab-ligne{display:flex; align-items:baseline; gap:10px; flex-wrap:wrap;}
.com-collab-mode{display:inline-flex; align-items:center; gap:7px; font-size:11px; font-weight:700; letter-spacing:0.12em; text-transform:uppercase; color:var(--c);}
.com-collab-mode::before{content:''; width:6px; height:6px; border-radius:50%; background:var(--c);}
.com-collab-metier{font-size:16px; font-weight:600; letter-spacing:-0.01em;}
.com-collab-details{display:flex; align-items:center; flex-wrap:wrap; gap:0 8px; font-size:13px; color:var(--muted); font-weight:400;}
.com-collab-details span{display:inline-flex; align-items:center; gap:4px;}
.com-collab-details i{font-style:normal; opacity:.5;}
.com-collab-cta{display:flex; gap:8px; flex-wrap:wrap;}

/* Images */
.com-images{
  display:grid; gap:3px; border-radius:18px; overflow:hidden; border:1px solid var(--com-bord); max-width:560px;
}
.com-images.n1{grid-template-columns:1fr;}
.com-images.n1 .com-image{aspect-ratio:16/10; max-height:460px;}
.com-images.n2{grid-template-columns:1fr 1fr;}
.com-images.n2 .com-image{aspect-ratio:4/5;}
.com-images.n3{grid-template-columns:1.4fr 1fr; grid-template-rows:1fr 1fr; aspect-ratio:16/10;}
.com-images.n3 .com-image:first-child{grid-row:1 / 3;}
.com-images.n4{grid-template-columns:1fr 1fr; grid-template-rows:1fr 1fr; aspect-ratio:16/10;}
.com-image{position:relative; padding:0; border:0; background:#0a0d12; cursor:zoom-in; overflow:hidden; min-height:0;}
.com-image img{width:100%; height:100%; object-fit:cover; transition:transform .7s var(--ease);}
.com-image:hover img{transform:scale(1.045);}

/* Lecteurs et liens */
.com-embed{border-radius:18px; overflow:hidden; border:1px solid var(--com-bord); background:rgba(0,0,0,0.3); max-width:560px;}
.com-embed-video .com-embed-lire{
  position:relative; display:block; width:100%; aspect-ratio:16/9; padding:0; border:0; background:#000; cursor:pointer; overflow:hidden;
}
.com-embed-video img{width:100%; height:100%; object-fit:cover; opacity:.85; transition:transform .7s var(--ease), opacity .3s var(--ease);}
.com-embed-video .com-embed-lire:hover img{transform:scale(1.04); opacity:1;}
.com-play{
  position:absolute; left:50%; top:50%; transform:translate(-50%,-50%);
  width:64px; height:64px; border-radius:50%; display:flex; align-items:center; justify-content:center;
  background:rgba(5,7,10,0.65); color:#fff; border:1px solid rgba(255,255,255,0.3);
  backdrop-filter:blur(8px); transition:transform .4s var(--ease), background .3s var(--ease);
}
.com-play .com-ic{margin-left:3px;}
.com-embed-lire:hover .com-play{background:var(--c, var(--blue)); transform:translate(-50%,-50%) scale(1.1);}
.com-play.petit{position:static; transform:none; width:42px; height:42px; flex:none; background:var(--c); border:0;}
.com-embed-pied{
  display:flex; align-items:center; gap:10px; padding:10px 14px; font-size:13px; text-decoration:none; color:var(--ink-soft);
}
.com-embed-pied span:first-child{font-weight:700; color:var(--c, var(--ink));}
.com-embed-url{flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--muted); font-weight:300;}
.com-iframe{display:block; width:100%; aspect-ratio:16/9; border:0; background:#000;}
.com-embed-son{display:flex; align-items:stretch;}
.com-embed-cadre{flex:1; min-width:0;}
.com-embed-lire-son{
  display:flex; align-items:center; gap:14px; width:100%; padding:12px 14px; border:0; background:transparent;
  color:var(--ink); text-align:left; cursor:pointer;
  transition:background .25s var(--ease);
}
.com-embed-lire-son:hover{background:rgba(255,255,255,0.06);}
.com-embed-texte{display:flex; flex-direction:column; min-width:0; line-height:1.35;}
.com-embed-texte b{font-size:14px; font-weight:600;}
.com-embed-texte small{font-size:12px; color:var(--muted); font-weight:300; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
.com-embed-ext{display:flex; align-items:center; padding:0 16px; color:var(--muted); border-left:1px solid var(--com-bord); text-decoration:none;}
.com-embed-ext:hover{color:var(--ink); background:rgba(255,255,255,0.06);}
.com-embed.lance .com-embed-pied, .com-embed.lance .com-embed-ext{display:none;}
.com-carte-lien{
  display:flex; align-items:center; gap:12px; padding:12px 14px; border-radius:16px; max-width:560px;
  border:1px solid var(--com-bord); background:rgba(255,255,255,0.04); text-decoration:none; color:var(--muted);
  transition:background .25s var(--ease), border-color .25s var(--ease);
}
.com-carte-lien:hover{background:rgba(255,255,255,0.08); border-color:rgba(255,255,255,0.2);}
.com-carte-lien-ic{width:38px; height:38px; border-radius:12px; display:flex; align-items:center; justify-content:center; background:rgba(255,255,255,0.08); color:var(--ink-soft); flex:none;}
.com-carte-lien .com-embed-texte{flex:1;}

/* Boutons (commentaires) */
.com-act{
  display:inline-flex; align-items:center; gap:6px; padding:8px 11px; border:0; border-radius:var(--radius-pill);
  background:transparent; color:var(--muted); font-size:13px; font-weight:500; cursor:pointer; font-variant-numeric:tabular-nums;
  transition:background .25s var(--ease), color .25s var(--ease), transform .25s var(--ease);
}
.com-act:hover{background:rgba(255,255,255,0.08); color:var(--ink);}
.com-act:active{transform:scale(.92);}
.com-act-ic{display:inline-flex; align-items:center; justify-content:center; width:22px; height:22px; transform-origin:center;}
.com-act-n{min-width:8px;}
.com-act.favori.actif{color:var(--gold-favori);}
.com-act.favori.actif .com-ic{fill:var(--gold-favori);}
.com-act.mini{padding:5px 8px; font-size:12px;}
.com-act.texte{font-weight:600;}

.com-reag-zone{position:relative; display:inline-flex;}
.com-palette{
  position:absolute; left:-4px; bottom:calc(100% + 6px); z-index:25; display:flex; gap:2px; padding:6px;
  border-radius:var(--radius-pill); background:rgba(11,15,21,0.97); border:1px solid var(--line-strong); box-shadow:var(--ombre-3);
  opacity:0; transform:translateY(10px) scale(.92); transform-origin:bottom left; pointer-events:none;
  transition:opacity .2s var(--ease), transform .35s var(--ease);
}
.com-palette::after{content:''; position:absolute; left:0; right:0; top:100%; height:14px;}
.com-reag-zone.ouverte .com-palette{opacity:1; transform:none; pointer-events:auto;}
.com-act-reag:focus-visible + .com-palette{opacity:1; transform:none; pointer-events:auto;}
@media (hover:hover){
  .com-reag-zone:hover .com-palette{opacity:1; transform:none; pointer-events:auto; transition-delay:.35s, .35s;}
}
.com-palette-btn{
  width:40px; height:40px; border:0; border-radius:50%; background:transparent; font-size:23px; line-height:1; cursor:pointer;
  transition:transform .3s cubic-bezier(.34,1.56,.64,1), background .2s var(--ease);
}
.com-palette-btn:hover{transform:translateY(-6px) scale(1.35); background:rgba(255,255,255,0.08);}
.com-palette-btn.choisi{background:rgba(79,180,255,0.2);}

/* ---------- COMMENTAIRES ---------- */

.com-repondre.carte{display:flex; gap:12px; align-items:flex-start; padding:14px 16px; margin:14px 0;}
.com-repondre-champ{flex:1; min-width:0;}
.com-repondre .com-comp-champ{
  padding:6px 14px; border-radius:20px; border:1px solid var(--line-strong); background:rgba(255,255,255,0.05);
  transition:border-color .25s var(--ease), box-shadow .25s var(--ease);
}
.com-repondre .com-comp-champ:focus-within{border-color:var(--blue-bright); box-shadow:0 0 0 3px rgba(79,180,255,0.15);}
.com-repondre .com-comp-texte{font-size:15px; min-height:34px; padding:6px 0;}
.com-repondre-pied{display:flex; justify-content:flex-end; gap:8px; margin-top:8px; max-height:0; opacity:0; overflow:hidden; transition:max-height .4s var(--ease), opacity .3s var(--ease);}
.com-repondre.actif .com-repondre-pied, .com-repondre.inline .com-repondre-pied{max-height:60px; opacity:1;}
.com-repondre.inline{margin-top:8px;}

.com-commentaires{display:flex; flex-direction:column; gap:2px;}
.com-coms-titre{font-size:16px; font-weight:700; margin:6px 4px 12px;}
.com-coms-vide{
  display:flex; flex-direction:column; align-items:center; gap:8px; padding:36px 20px; text-align:center;
  color:var(--muted); font-size:14px; font-weight:300; border:1px dashed var(--line); border-radius:var(--radius);
}
.com-fil-com{padding:10px 4px; border-bottom:1px solid var(--com-bord);}
.com-fil-com:last-child{border-bottom:0;}
.com-com{display:flex; gap:10px; align-items:flex-start;}
.com-com + .com-com, .com-reponses-liste > .com-com{margin-top:10px;}
.com-com-corps{flex:1; min-width:0;}
.com-com-bulle{
  display:inline-block; max-width:100%; padding:9px 14px; border-radius:6px 20px 20px 20px;
  background:rgba(255,255,255,0.07);
}
.com-com-tete{display:flex; align-items:center; gap:6px; flex-wrap:wrap; font-size:13px; color:var(--muted); font-weight:300; margin-bottom:2px;}
.com-com-tete .com-nom{font-size:14px;}
.com-com-texte{font-size:14.5px; line-height:1.5;}
.com-com-actions{display:flex; align-items:center; gap:0; margin:3px 0 0 4px;}
.com-reponses{margin:6px 0 0 52px;}
.com-voir-reps{
  display:inline-flex; align-items:center; gap:6px; padding:6px 4px; border:0; background:none; cursor:pointer;
  font-size:13px; font-weight:600; color:var(--blue-bright);
}
.com-voir-reps .com-ic{transform:rotate(-90deg);}
.com-voir-reps:hover{text-decoration:underline;}
.com-reponse-zone{margin-top:4px;}


/* ---------- EXPLORER ET MEMBRES ---------- */

.com-explorer-tete{margin-bottom:6px; display:flex; flex-direction:column; gap:12px;}
.com-ex-barre{display:flex; align-items:center; gap:6px; flex-wrap:wrap;}
.com-ex-barre .com-recherche-champ{flex:1; min-width:200px;}
.com-ex-barre .com-recherche-champ input{background:rgba(255,255,255,0.04); border-color:transparent;}
.com-ex-barre .com-recherche-champ input:focus{background:rgba(255,255,255,0.07);}
.com-affiner{
  align-self:flex-start; display:inline-flex; align-items:center; gap:7px; padding:6px 2px; border:0; background:none;
  color:var(--blue-bright); font-size:13.5px; font-weight:600; cursor:pointer;
}
.com-affiner:hover{text-decoration:underline;}
.com-affiner.actif .com-ic{transform:rotate(60deg);}
.com-affiner .com-ic{transition:transform .5s var(--ease);}
.com-affiner-zone{padding:4px 0 2px;}
.com-filtres-actifs{display:flex; flex-wrap:wrap; gap:6px;}
.com-filtres-actifs:empty{display:none;}
.com-puce.bouton.retirable{padding:4px 10px; cursor:pointer; background:rgba(20,137,222,0.16); border-color:rgba(79,180,255,0.35); color:var(--ink);}

.com-resultats-tete{font-size:13px; color:var(--muted); font-weight:300; margin:2px 4px 10px; min-height:18px;}
/* Trois profils à la fois, comme la carte : un visage, un nom, une ligne. */
.com-trio-zone{position:relative; padding:8px 0 0;}
.com-trio{display:grid;}
.com-trio-page{grid-area:1 / 1; display:flex; justify-content:center; gap:10px;}
.com-trio-page.entrante{animation:comTrioEntre .6s var(--ease) both;}
.com-trio-page.sortante{pointer-events:none; animation:comTrioSort .45s var(--ease) both;}
@keyframes comTrioEntre{from{opacity:0; transform:translateY(12px) scale(.98);} to{opacity:1; transform:none;}}
@keyframes comTrioSort{to{opacity:0; transform:translateY(-8px) scale(.98);}}
.com-trio .com-vide{flex:1;}
.com-pf{
  flex:1 1 0; max-width:230px; min-width:0; display:flex; flex-direction:column; align-items:center; gap:5px;
  padding:20px 8px 16px; text-align:center; cursor:pointer; border-radius:26px; transition:background .3s var(--ease);
}
.com-pf:hover{background:rgba(255,255,255,0.04);}
.com-pf:focus-visible{outline:2px solid var(--blue-bright); outline-offset:2px;}
.com-pf-photo{position:relative; display:flex; margin-bottom:8px; transition:transform .5s var(--ease);}
.com-pf-photo .com-av-xl{width:112px; height:112px; font-size:40px; box-shadow:var(--ombre-2);}
/* Un anneau de lumière autour du visage, qui s'éveille au survol. */
.com-pf-photo::before{
  content:''; position:absolute; inset:-6px; border-radius:50%; pointer-events:none;
  background:conic-gradient(from 0deg, var(--blue-bright), transparent 30%, var(--blue) 58%, transparent 82%, var(--blue-bright));
  -webkit-mask:radial-gradient(farthest-side, transparent calc(100% - 2px), #000 calc(100% - 1.5px));
  mask:radial-gradient(farthest-side, transparent calc(100% - 2px), #000 calc(100% - 1.5px));
  opacity:.4; animation:comAnneau 10s linear infinite; transition:opacity .4s var(--ease);
}
@keyframes comAnneau{to{transform:rotate(360deg);}}
.com-pf:hover .com-pf-photo{transform:scale(1.045);}
.com-pf:hover .com-pf-photo::before{opacity:1;}
.com-pf-nom{max-width:100%; font-size:17px; font-weight:600; display:flex; align-items:center; justify-content:center; flex-wrap:wrap;}
.com-pf-sous{max-width:100%; font-size:12.5px; color:var(--muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
.com-pf-suivre{margin-top:6px; opacity:0; transform:translateY(5px); transition:opacity .35s var(--ease), transform .35s var(--ease);}
.com-pf:hover .com-pf-suivre, .com-pf:focus-within .com-pf-suivre{opacity:1; transform:none;}
.com-pf-suivre .com-btn{padding:6px 16px; font-size:12.5px;}
@media (hover:none){ .com-pf-suivre{opacity:.9; transform:none;} }
.com-trio-barre{display:block; width:120px; height:2px; margin:12px auto 0; border-radius:2px; background:rgba(255,255,255,0.08); overflow:hidden;}
.com-trio-barre i{
  display:block; width:100%; height:100%; transform-origin:left center;
  background:linear-gradient(90deg, var(--blue), var(--blue-bright)); animation:comTrioBarre 3000ms linear both;
}
.com-trio-barre.en-pause i{animation-play-state:paused;}
@keyframes comTrioBarre{from{transform:scaleX(0);} to{transform:scaleX(1);}}
.com-trio-zone.seule .com-fleche{display:none;}
.com-trio-zone.seule + .com-trio-barre{visibility:hidden;}
@media (max-width:520px){
  .com-trio-zone{overflow-x:clip;}
  .com-trio-page{gap:4px;}
  .com-pf{padding:14px 2px 10px;}
  .com-pf-photo .com-av-xl{width:72px; height:72px; font-size:26px;}
  .com-pf-nom{font-size:14px;}
  .com-pf-sous{font-size:11px;}
}
.com-fleche{
  position:absolute; top:calc(50% - 22px); z-index:3; width:44px; height:44px; padding:0; border-radius:50%;
  display:flex; align-items:center; justify-content:center; color:#fff; cursor:pointer;
  background:rgba(8,11,16,0.8); border:1px solid var(--line-strong);
  -webkit-backdrop-filter:blur(8px); backdrop-filter:blur(8px);
  transition:transform .3s var(--ease), background .25s var(--ease);
}
.com-fleche:hover{background:rgba(20,26,36,0.95); transform:scale(1.06);}
.com-fleche.gauche{left:-14px;}
.com-fleche.droite{right:-14px;}
@media (hover:none){ .com-fleche{display:none;} }

.com-ruban{margin:0 0 18px;}
.com-ruban-liste{display:flex; gap:10px; overflow-x:auto; scrollbar-width:none; padding:2px 2px 6px;}
.com-ruban-liste::-webkit-scrollbar{display:none;}
.com-ruban-carte{
  flex:none; width:164px; padding:16px 12px 14px; display:flex; flex-direction:column; align-items:center; gap:12px; text-align:center;
}
.com-ruban-lien{display:flex; flex-direction:column; align-items:center; gap:4px; text-decoration:none; width:100%; min-width:0;}
.com-ruban-lien b{font-size:14px; font-weight:600; max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
.com-ruban-lien span{font-size:12px; color:var(--muted); font-weight:300;}
.com-ruban-lien em{font-style:normal; font-size:11px; color:var(--blue-bright); min-height:15px; line-height:1.3;}

/* ---------- PROFIL ---------- */

.com-bandeau{display:flex; align-items:center; gap:16px; padding:18px 20px; margin-bottom:16px;}
.com-bandeau-ic{
  flex:none; width:54px; height:54px; border-radius:16px; font-size:26px; font-weight:700;
  display:flex; align-items:center; justify-content:center; color:var(--blue-bright);
  background:rgba(20,137,222,0.14); border:1px solid rgba(79,180,255,0.25);
}
.com-bandeau-texte h2{font-size:21px; font-weight:700; letter-spacing:-0.01em;}
.com-bandeau-texte p{margin:3px 0 0; font-size:14px; color:var(--ink-soft); font-weight:300;}

.com-lien-artiste{
  display:flex; align-items:center; gap:10px; width:100%; margin-top:16px; padding:12px 14px; border-radius:16px; cursor:pointer;
  background:rgba(20,137,222,0.1); border:1px solid rgba(79,180,255,0.28); color:var(--ink); font-size:14px; font-weight:500; text-align:left;
  transition:background .25s var(--ease), border-color .25s var(--ease);
}
.com-lien-artiste:hover{background:rgba(20,137,222,0.18); border-color:rgba(79,180,255,0.55);}
.com-lien-artiste span{margin-left:auto; color:var(--blue-bright); font-weight:600;}
.com-invite-profil{
  display:flex; align-items:center; gap:14px; width:100%; margin-top:16px; padding:14px 16px; border-radius:16px; cursor:pointer; text-align:left;
  border:1px dashed rgba(79,180,255,0.4); background:rgba(20,137,222,0.07); color:var(--blue-bright);
  transition:background .25s var(--ease);
}
.com-invite-profil:hover{background:rgba(20,137,222,0.14);}
.com-invite-profil span{display:flex; flex-direction:column; gap:2px;}
.com-invite-profil b{color:var(--ink); font-size:15px; font-weight:600;}
.com-invite-profil small{color:var(--ink-soft); font-size:13px; font-weight:300;}

.com-chips-bloc{display:flex; flex-wrap:wrap; gap:7px;}
.com-chips-bloc .com-chip{padding:7px 12px;}

/* ---------- MESSAGES PRIVÉS ---------- */

.com-messages{
  display:grid; grid-template-columns:320px minmax(0,1fr);
  height:calc(100vh - 236px); min-height:500px; max-height:780px;
  border-radius:var(--radius); overflow:hidden;
  background:var(--com-carte); border:1px solid var(--com-bord); box-shadow:var(--ombre-2), var(--reflet-int);
}
.com-conv-pane{display:flex; flex-direction:column; min-height:0; border-right:1px solid var(--com-bord);}
.com-conv-tete{display:flex; align-items:center; justify-content:space-between; padding:16px 16px 12px 20px;}
.com-conv-tete h2{font-size:20px; font-weight:700;}
.com-conv-liste{flex:1; overflow-y:auto; padding:4px 8px 10px; display:flex; flex-direction:column; gap:2px; scrollbar-width:thin;}
.com-conv{
  display:flex; align-items:center; gap:12px; width:100%; padding:11px 12px; border:0; border-radius:16px; text-align:left;
  background:transparent; cursor:pointer; color:var(--ink);
  transition:background .25s var(--ease);
}
.com-conv:hover{background:rgba(255,255,255,0.06);}
.com-conv.actif{background:rgba(20,137,222,0.16);}
.com-conv-texte{flex:1; min-width:0; display:flex; flex-direction:column; gap:2px;}
.com-conv-ligne{display:flex; align-items:baseline; justify-content:space-between; gap:8px;}
.com-conv-nom{font-size:15px; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
.com-conv-heure{font-size:12px; color:var(--muted); flex:none; font-weight:300;}
.com-conv-apercu{font-size:13.5px; color:var(--muted); font-weight:300; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
.com-conv.non-lu .com-conv-nom, .com-conv.non-lu .com-conv-apercu{color:var(--ink); font-weight:600;}
.com-pastille-nb{
  flex:none; min-width:22px; height:22px; padding:0 6px; border-radius:11px; background:var(--blue); color:#fff;
  font-size:12px; font-weight:700; line-height:22px; text-align:center;
}

.com-fil-pane{display:flex; flex-direction:column; min-height:0; min-width:0; position:relative;}
.com-fil-vide{flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:10px; text-align:center; padding:30px;}
.com-fil-vide h3{font-size:20px; font-weight:700;}
.com-fil-vide p{margin:0; color:var(--muted); font-size:14px; font-weight:300;}
.com-fil-vide .com-btn{margin-top:8px;}
.com-fil-conv{flex:1; display:flex; flex-direction:column; min-height:0;}
.com-fil-conv[hidden]{display:none;}
.com-fil-tete{display:flex; align-items:center; gap:10px; padding:12px 14px; border-bottom:1px solid var(--com-bord);}
.com-fil-retour{display:none;}
.com-fil-qui{flex:1; min-width:0; display:flex; align-items:center; gap:12px; text-decoration:none;}
.com-fil-nom{font-size:16px; font-weight:700; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
.com-msgs{flex:1; overflow-y:auto; padding:14px 18px 8px; display:flex; flex-direction:column; scrollbar-width:thin; outline:0;}
.com-fil-debut{align-self:center; margin:6px 0 14px; font-size:13px; color:var(--muted); font-weight:300; text-align:center;}
.com-anciens{align-self:center; margin:4px 0 14px;}
.com-jour{display:flex; justify-content:center; margin:16px 0 8px;}
.com-jour span{font-size:12px; color:var(--muted); padding:3px 12px; border-radius:99px; background:rgba(255,255,255,0.05); text-transform:capitalize;}

.com-bulle{display:flex; flex-direction:column; max-width:78%; margin-top:2px;}
.com-bulle.debut{margin-top:10px;}
.com-bulle.mienne{align-self:flex-end; align-items:flex-end;}
.com-bulle.autre{align-self:flex-start; align-items:flex-start;}
.com-bulle-texte{
  padding:9px 14px; font-size:15px; line-height:1.45; font-weight:400; white-space:pre-wrap; overflow-wrap:anywhere;
  border-radius:20px;
}
.com-bulle.mienne .com-bulle-texte{background:linear-gradient(160deg, #1a97ee, var(--blue)); color:#fff; border-bottom-right-radius:6px;}
.com-bulle.autre .com-bulle-texte{background:rgba(255,255,255,0.1); border-bottom-left-radius:6px;}
.com-bulle.mienne:not(.debut) .com-bulle-texte{border-top-right-radius:6px;}
.com-bulle.autre:not(.debut) .com-bulle-texte{border-top-left-radius:6px;}
.com-bulle.mienne .com-lien-ext{color:#fff; text-decoration:underline;}
.com-bulle.envoi .com-bulle-texte{opacity:.6;}
.com-bulle.erreur .com-bulle-texte{background:rgba(229,105,92,0.28);}
.com-bulle-heure{font-size:11px; color:var(--muted); margin:3px 6px 0; font-weight:300;}
.com-bulle-retry{border:0; background:none; color:var(--danger); font-size:12px; font-weight:600; cursor:pointer; padding:3px 6px;}
.com-vu{align-self:flex-end; display:flex; align-items:center; gap:4px; margin:3px 6px 0; font-size:11px; color:var(--blue-bright); animation:comEntre .4s var(--ease);}

.com-msg-saisie{display:flex; align-items:flex-end; gap:10px; padding:10px 14px 14px; border-top:1px solid var(--com-bord);}
.com-msg-champ{flex:1; padding:6px 16px; border-radius:22px; background:rgba(255,255,255,0.07); border:1px solid transparent; transition:border-color .25s var(--ease), background .25s var(--ease);}
.com-msg-champ:focus-within{border-color:var(--blue-bright); background:rgba(255,255,255,0.1);}
.com-msg-champ textarea{
  display:block; width:100%; resize:none; border:0; outline:0; background:transparent; color:var(--ink);
  font:inherit; font-size:15px; line-height:1.45; padding:6px 0; max-height:160px;
}
.com-envoyer{
  flex:none; width:44px; height:44px; border-radius:50%; border:0; background:var(--blue); color:#fff; cursor:pointer;
  display:flex; align-items:center; justify-content:center;
  transition:transform .3s var(--ease), background .3s var(--ease), opacity .3s var(--ease);
}
.com-envoyer:hover:not([disabled]){background:#1a97ee; transform:scale(1.07);}
.com-envoyer:active:not([disabled]){transform:scale(.92);}
.com-envoyer[disabled]{opacity:.35; cursor:default;}
.com-msg-bloque{margin:0; padding:16px; text-align:center; color:var(--muted); font-size:14px; border-top:1px solid var(--com-bord);}

/* ---------- NOTIFICATIONS ---------- */

.com-notifs-boite{padding:6px 8px 12px;}
.com-notifs-tete{display:flex; align-items:center; justify-content:space-between; padding:14px 12px 8px;}
.com-notifs-tete h2{font-size:19px; font-weight:700;}
.com-groupe-titre{font-size:12px; font-weight:700; letter-spacing:0.12em; text-transform:uppercase; color:var(--muted); margin:14px 12px 6px;}
.com-groupe-titre.sans-carte{margin:6px 6px 12px;}
.com-notif{
  position:relative; display:flex; align-items:center; gap:14px; width:100%; padding:12px; border:0; border-radius:16px; text-align:left;
  background:transparent; color:var(--ink); cursor:pointer; transition:background .25s var(--ease);
}
.com-notif:hover{background:rgba(255,255,255,0.06);}
.com-notif.non-lue{background:rgba(20,137,222,0.1);}
.com-notif.non-lue:hover{background:rgba(20,137,222,0.17);}
.com-notif-av{position:relative; flex:none;}
.com-notif-type{
  position:absolute; right:-4px; bottom:-4px; width:22px; height:22px; border-radius:50%; border:2px solid #0b0f15;
  display:flex; align-items:center; justify-content:center; color:#fff; background:var(--blue);
}
.com-notif-type.t-reaction{background:var(--com-coeur);}
.com-notif-type.t-suivi{background:var(--com-vert);}
.com-notif-type.t-mention{background:var(--com-orange);}
.com-notif-corps{flex:1; min-width:0; display:flex; flex-direction:column; gap:3px;}
.com-notif-texte{font-size:14.5px; line-height:1.4; font-weight:300;}
.com-notif-texte b{font-weight:700;}
.com-notif-extrait{font-size:13.5px; color:var(--muted); font-weight:300; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;}
.com-notif-heure{font-size:12px; color:var(--muted); font-weight:300;}
.com-notif-image{flex:none; width:48px; height:48px; border-radius:10px; object-fit:cover;}
.com-notif-point{flex:none; width:9px; height:9px; border-radius:50%; background:var(--blue-bright); box-shadow:0 0 0 4px rgba(79,180,255,0.18);}

/* ---------- RECHERCHE ---------- */

.com-recherche-tete{padding:14px; margin-bottom:16px;}
.com-res-bloc{padding:6px 8px 10px; margin-bottom:14px;}
.com-res-tags{display:flex; flex-wrap:wrap; gap:8px; padding:0 8px 4px;}
.com-tag-bloc{display:flex; flex-direction:column; padding:10px 16px; border-radius:16px; background:rgba(255,255,255,0.05); border:1px solid var(--com-bord); text-decoration:none; transition:background .25s var(--ease);}
.com-tag-bloc:hover{background:rgba(255,255,255,0.1);}
.com-tag-bloc b{font-size:15px; font-weight:600; color:var(--blue-bright);}
.com-tag-bloc span{font-size:12px; color:var(--muted); font-weight:300;}


/* ---------- POUR BIEN DÉMARRER ---------- */

.com-onb{padding:16px 18px 12px; margin-bottom:14px; background:linear-gradient(135deg, rgba(20,137,222,0.14), rgba(13,17,24,0.66) 62%);}
.com-onb-tete{display:flex; align-items:center; justify-content:space-between; gap:14px; margin-bottom:10px;}
.com-onb-tete > div{display:flex; flex-direction:column; gap:2px;}
.com-onb-tete b{font-size:16px; font-weight:700;}
.com-onb-tete span{font-size:13px; color:var(--ink-soft); font-weight:300;}
.com-onb-barre{display:flex; gap:4px; flex:none;}
.com-onb-barre i{width:26px; height:6px; border-radius:3px; background:rgba(255,255,255,0.14); transition:background .5s var(--ease);}
.com-onb-barre i.fait{background:var(--blue-bright);}
.com-onb-liste{display:flex; flex-direction:column;}
.com-onb-etape{
  display:flex; align-items:center; gap:12px; width:100%; padding:10px 6px; border:0; border-radius:12px; background:transparent;
  color:var(--ink); font-size:14.5px; text-align:left; cursor:pointer; transition:background .25s var(--ease);
}
button.com-onb-etape:hover{background:rgba(255,255,255,0.07);}
.com-onb-etape em{margin-left:auto; font-style:normal; font-size:12px; font-weight:700; color:var(--blue-bright);}
.com-onb-etape.fait{color:var(--muted); cursor:default;}
.com-onb-etape.fait span:last-child{text-decoration:line-through;}
.com-onb-coche{
  flex:none; width:22px; height:22px; border-radius:50%; border:2px solid rgba(255,255,255,0.28);
  display:flex; align-items:center; justify-content:center; color:#fff;
}
.com-onb-etape.fait .com-onb-coche{background:var(--com-vert); border-color:transparent;}

/* ---------- MENTIONS ---------- */

.com-mentions{
  position:absolute; left:0; right:0; top:calc(100% + 6px); z-index:60; padding:6px; border-radius:16px;
  background:rgba(11,15,21,0.98); border:1px solid var(--line-strong); box-shadow:var(--ombre-3);
  animation:comMenu .25s var(--ease);
}
.com-mention-item{
  display:flex; align-items:center; gap:10px; width:100%; padding:8px 10px; border:0; border-radius:12px;
  background:transparent; color:var(--ink); text-align:left; cursor:pointer; font-size:14px;
}
.com-mention-item.actif, .com-mention-item:hover{background:rgba(20,137,222,0.2);}
.com-mention-pseudo{font-weight:600;}
.com-mention-role{margin-left:auto; font-size:12px; color:var(--muted); font-weight:300;}

/* ---------- MENUS, FEUILLES, FENÊTRES ---------- */

html.com-fige, html.com-fige body{overflow:hidden !important;}

.com-calque{position:fixed; inset:0; z-index:380;}
.com-calque-leger{background:transparent;}
.com-menu{
  position:fixed; min-width:230px; max-width:min(320px, calc(100vw - 16px)); padding:6px; border-radius:18px;
  background:rgba(11,15,21,0.98); border:1px solid var(--line-strong); box-shadow:var(--ombre-3);
  opacity:0; transform:translateY(-6px) scale(.96); transform-origin:top right;
  transition:opacity .2s var(--ease), transform .3s var(--ease);
}
.com-calque.ouvert .com-menu{opacity:1; transform:none;}
.com-menu-item{
  display:flex; align-items:center; gap:12px; width:100%; padding:11px 14px; border:0; border-radius:12px;
  background:transparent; color:var(--ink); font-size:14.5px; font-weight:500; text-align:left; cursor:pointer;
  transition:background .2s var(--ease);
}
.com-menu-item:hover, .com-menu-item:focus-visible{background:rgba(255,255,255,0.09); outline:0;}
.com-menu-item.danger{color:#ff7a6c;}
.com-menu-item.danger:hover{background:rgba(229,105,92,0.16);}
.com-menu-sep{height:1px; margin:5px 8px; background:var(--com-bord);}

.com-calque-feuille{background:rgba(4,6,9,0.55); backdrop-filter:blur(4px); opacity:0; transition:opacity .25s var(--ease);}
.com-calque-feuille.ouvert{opacity:1;}
.com-feuille{
  position:absolute; left:0; right:0; bottom:0; padding:10px 10px calc(14px + env(safe-area-inset-bottom));
  border-radius:26px 26px 0 0; background:rgba(14,18,25,0.99); border:1px solid var(--line-strong); border-bottom:0;
  transform:translateY(100%); transition:transform .45s var(--ease);
}
.com-feuille::before{content:''; display:block; width:40px; height:4px; border-radius:2px; background:rgba(255,255,255,0.22); margin:2px auto 10px;}
.com-calque-feuille.ouvert .com-feuille{transform:none;}
.com-feuille .com-menu-item{padding:15px 14px; font-size:16px;}

.com-calque-dialogue{
  display:flex; align-items:center; justify-content:center; padding:16px;
  background:rgba(4,6,9,0.62); backdrop-filter:blur(8px); -webkit-backdrop-filter:blur(8px);
  opacity:0; transition:opacity .25s var(--ease);
}
.com-calque-dialogue.ouvert{opacity:1;}
.com-dialogue{
  display:flex; flex-direction:column; width:min(520px, 100%); max-height:min(88vh, 740px);
  border-radius:26px; background:rgba(14,18,25,0.99); border:1px solid var(--line-strong); box-shadow:var(--ombre-3);
  transform:translateY(18px) scale(.97); opacity:0;
  transition:transform .5s var(--ease), opacity .3s var(--ease);
}
.com-calque-dialogue.ouvert .com-dialogue{transform:none; opacity:1;}
.com-dialogue-tete{display:flex; align-items:center; justify-content:space-between; padding:18px 18px 8px 24px;}
.com-dialogue-tete h3{font-size:19px; font-weight:700;}
.com-dialogue-corps{padding:6px 24px 8px; overflow-y:auto; display:flex; flex-direction:column; gap:14px; color:var(--ink);}
.com-dialogue-texte{margin:0; font-size:14.5px; line-height:1.55; color:var(--ink-soft); font-weight:300;}
.com-dialogue-texte.petit{font-size:13.5px; text-align:center; color:var(--muted); padding:14px 0;}
.com-dialogue-texte a{color:var(--blue-bright);}
.com-dialogue-erreur{margin:0; color:var(--danger); font-size:13px;}
.com-dialogue-pied{display:flex; justify-content:flex-end; gap:10px; padding:14px 22px 20px;}
.com-dialogue-resultats{display:flex; flex-direction:column; gap:2px; min-height:120px; max-height:340px; overflow-y:auto;}
.com-radios{display:flex; flex-direction:column; gap:4px;}
.com-radio{display:flex; align-items:center; gap:12px; padding:11px 14px; border-radius:14px; cursor:pointer; font-size:14.5px; transition:background .2s var(--ease);}
.com-radio:hover{background:rgba(255,255,255,0.06);}
.com-radio input{accent-color:var(--blue-bright); width:18px; height:18px; margin:0;}
.com-dialogue .com-btn.danger{background:var(--danger);}

/* ---------- VISIONNEUSE D'IMAGES ---------- */

.com-vision{
  position:fixed; inset:0; z-index:390; display:flex; align-items:center; justify-content:center;
  background:rgba(2,3,5,0.92); backdrop-filter:blur(14px); -webkit-backdrop-filter:blur(14px);
  opacity:0; transition:opacity .3s var(--ease); touch-action:pan-y;
}
.com-vision.ouvert{opacity:1;}
.com-vision-img{max-width:min(94vw, 1400px); max-height:88vh; object-fit:contain; border-radius:6px; user-select:none; -webkit-user-drag:none; box-shadow:0 30px 100px rgba(0,0,0,0.6);}
.com-vision-fermer{position:absolute; top:16px; right:16px; width:46px; height:46px; background:rgba(255,255,255,0.1); color:#fff; z-index:2;}
.com-vision-nav{
  position:absolute; top:50%; transform:translateY(-50%); width:52px; height:52px; border-radius:50%; border:0; z-index:2;
  display:flex; align-items:center; justify-content:center; background:rgba(255,255,255,0.1); color:#fff; cursor:pointer;
  transition:background .25s var(--ease), transform .25s var(--ease);
}
.com-vision-nav:hover{background:rgba(255,255,255,0.22); transform:translateY(-50%) scale(1.08);}
.com-vision-nav.prec{left:18px;}
.com-vision-nav.suiv{right:18px;}
.com-vision-compte{position:absolute; bottom:22px; left:50%; transform:translateX(-50%); font-size:13px; color:rgba(255,255,255,0.7); padding:5px 14px; border-radius:99px; background:rgba(255,255,255,0.1);}

/* Pas de mouvement pour qui n'en veut pas. */
@media (prefers-reduced-motion: reduce){
  .com *, .com-calque *, .com-vision, .com-vision *{animation-duration:0.001ms !important; animation-iteration-count:1 !important; transition-duration:0.001ms !important; transition-delay:0ms !important;}
  .com-sq{animation:none;}
  .com-rond{animation-duration:1.6s !important; animation-iteration-count:infinite !important;}
}

/* Au clavier : la palette reste visible tant que le focus est dans la zone,
   y compris sur l'un de ses boutons. */
.com-reag-zone:focus-within .com-palette{opacity:1; transform:none; pointer-events:auto;}
.com-msgs:focus-visible{outline:2px solid var(--blue-bright); outline-offset:-2px;}
.com-conv-pane{min-width:0;}

/* =====================================================================
   Deuxième passe : l'identité propre de la communauté.

   Pas de colonne de navigation à gauche ni de colonne de suggestions à
   droite : un bandeau de navigation (le « dock ») au-dessus d'une page
   pensée pour chaque usage — un fil large, des grilles pour les membres
   et les collabs, une carte de membre qui reste en vue. Chaque sujet a sa
   couleur, chaque rôle son anneau, chaque annonce son bandeau, et les
   réactions sont posées à la vue de tous au pied du message.
   ===================================================================== */

.com{display:block; padding-bottom:96px;}
.com-centre{min-width:0;}
.com-vue{max-width:760px; margin-left:auto; margin-right:auto;}
.com[data-vue="explorer"] .com-vue, .com[data-vue="collabs"] .com-vue,
.com[data-vue="messages"] .com-vue, .com[data-vue="membre"] .com-vue{max-width:none;}

.com-entete{display:none; align-items:center; gap:10px; max-width:760px; min-height:46px; margin:0 auto 14px;}
.com-entete.avec-retour{display:flex;}
.com-entete-titre{
  font-size:22px; font-weight:700; letter-spacing:-0.02em; line-height:1.2; flex:1; min-width:0;
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
}
.com-entete-actions{display:none; gap:4px; align-items:center;}
.com[data-vue="membre"] .com-entete{max-width:none;}

/* ---------- LE DOCK ---------- */

.com-haut{
  position:sticky; top:94px; z-index:70;
  display:flex; align-items:center; justify-content:center;
  margin:0 0 22px; padding:4px 0;
  transition:transform .4s var(--ease), opacity .3s var(--ease);
}
/* On descend dans la page : la barre s'efface vers le haut ; on remonte, elle revient. */
.com-haut.cache{transform:translateY(-130%); opacity:0; pointer-events:none;}
.com-haut.cache:focus-within{transform:none; opacity:1; pointer-events:auto;}
@media (prefers-reduced-motion:reduce){ .com-haut{transition:none;} }
.com-dock{position:relative; display:flex; gap:2px; flex:none;}
.com-dock .com-onglet-barre{
  top:0; bottom:0; left:0; height:auto; width:0; border-radius:var(--radius-pill);
  background:linear-gradient(180deg, rgba(255,255,255,0.15), rgba(255,255,255,0.07));
  border:1px solid rgba(255,255,255,0.14); box-shadow:var(--reflet-int), 0 2px 12px rgba(0,0,0,0.3);
}
.com-dock-item{
  position:relative; z-index:1; display:flex; align-items:center; gap:9px;
  padding:10px 16px; border-radius:var(--radius-pill);
  color:var(--ink-soft); font-size:14px; font-weight:600; text-decoration:none; white-space:nowrap;
  transition:color .3s var(--ease), transform .25s var(--ease);
}
.com-dock-item{padding:11px 16px;}
.com-dock-item:hover{color:var(--ink);}
/* Le titre se dévoile sous l'icône, de gauche à droite, sans pousser les autres. */
.com-dock-item .com-nav-lib{
  position:absolute; left:50%; top:calc(100% + 10px); z-index:5; pointer-events:none;
  padding:6px 13px; border-radius:var(--radius-pill); font-size:12.5px; font-weight:600; color:#fff;
  background:rgba(9,12,17,0.97); border:1px solid var(--line-strong); box-shadow:var(--ombre-2);
  clip-path:inset(0 100% 0 0 round 99px); opacity:0; transform:translate(-50%, -4px);
  transition:clip-path .22s var(--ease), opacity .15s var(--ease), transform .22s var(--ease);
}
.com-dock-item:hover .com-nav-lib, .com-dock-item:focus-visible .com-nav-lib{
  clip-path:inset(0 0 0 0 round 99px); opacity:1; transform:translate(-50%, 0);
  transition-duration:.42s, .25s, .42s; transition-delay:.12s;
}
.com-dock-item:active{transform:scale(.96);}
.com-dock-item.actif{color:#fff;}
.com-dock-item.actif .com-ic{color:var(--blue-bright);}
.com-dock-item .com-badge-nb{top:-7px; right:-9px;}

.com-haut-droite{position:absolute; right:0; top:50%; transform:translateY(-50%); display:flex; align-items:center; gap:10px;}
.com-rapide{position:relative; width:44px; height:44px; flex:none;}
/* Le champ grandit par-dessus le dock sans le pousser. */
.com-rapide .com-recherche-champ{position:absolute; right:0; top:0; width:44px; height:44px; z-index:2; transition:width .4s var(--ease);}
.com-rapide .com-recherche-champ input{width:100%; min-width:0; box-sizing:border-box; height:44px; padding:0; font-size:14px; cursor:pointer; background:transparent; border-color:transparent;}
.com-rapide .com-recherche-champ > .com-ic{left:14px; color:var(--ink-soft);}
.com-rapide:focus-within .com-recherche-champ{width:280px;}
.com-rapide .com-recherche-champ input::placeholder{color:transparent; transition:color .3s var(--ease);}
.com-rapide:focus-within .com-recherche-champ input::placeholder{color:var(--muted);}
.com-rapide:focus-within .com-recherche-champ input{padding:0 14px 0 44px;}
.com-rapide:focus-within .com-recherche-champ input{cursor:text; background:rgba(15,20,28,0.99); border-color:var(--blue-bright);}
.com-puce-hote{display:flex; align-items:center;}

.com-rapide-res{
  position:absolute; right:0; top:calc(100% + 10px); z-index:80; width:330px; padding:8px;
  border-radius:var(--radius); background:rgba(11,15,21,0.98); border:1px solid var(--line-strong);
  box-shadow:var(--ombre-3); animation:comMenu .28s var(--ease);
}

/* ---------- FILTRES DU FIL ---------- */

.com-filtres{margin-bottom:16px;}
.com-onglets{
  position:relative; display:inline-flex; margin:0 0 14px; padding:4px;
  border-radius:var(--radius-pill); background:rgba(255,255,255,0.06); border:1px solid var(--line);
}
.com-onglet{
  position:relative; z-index:1; flex:none; padding:9px 20px; border-radius:var(--radius-pill);
  font-size:13.5px; font-weight:600; color:var(--ink-soft); background:none;
}
.com-onglet:hover{color:var(--ink); background:none;}
.com-onglet.actif{color:#fff;}
.com-onglets .com-onglet-barre{
  top:4px; bottom:4px; left:0; height:auto; width:0; border-radius:var(--radius-pill);
  background:var(--blue); box-shadow:var(--ombre-1), var(--reflet-int);
}

.com-pt{display:inline-block; width:6px; height:6px; border-radius:50%; background:var(--sj, var(--blue-bright)); flex:none; opacity:.85;}
.com-filtres-ligne{display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px 14px; margin-bottom:14px;}
.com-filtres-ligne .com-onglets{margin:0;}
.com-sujet-bouton{
  display:inline-flex; align-items:center; gap:8px; padding:9px 12px 9px 15px; border-radius:var(--radius-pill);
  border:1px solid transparent; background:none; color:var(--muted); font-size:13.5px; font-weight:500; cursor:pointer;
  transition:background .25s var(--ease), color .25s var(--ease), border-color .25s var(--ease);
}
.com-sujet-bouton svg{opacity:.7; transition:transform .3s var(--ease);}
.com-sujet-bouton:hover{background:rgba(255,255,255,0.06); color:var(--ink);}
.com-sujet-bouton:hover svg{transform:translateY(1px);}
.com-sujet-bouton.filtre{color:#fff; background:rgba(255,255,255,0.08);}
.com-menu-item .com-pt{width:8px; height:8px; margin:0 5px; opacity:1;}
.com-menu-item.actif{color:#fff;}
.com-menu-coche{margin-left:auto; display:inline-flex; color:var(--blue-bright);}

.com-tendances-ligne{display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-top:2px;}
.com-tendances-lib{display:inline-flex; align-items:center; gap:6px; font-size:12px; font-weight:700; letter-spacing:0.1em; text-transform:uppercase; color:var(--muted);}
.com-tag-lien{
  display:inline-flex; align-items:center; padding:4px 11px; border-radius:99px; font-size:13px; font-weight:600;
  background:rgba(79,180,255,0.1); color:var(--blue-bright); text-decoration:none; transition:background .25s var(--ease);
}
.com-tag-lien:hover{background:rgba(79,180,255,0.2);}
.com-tag-lien small{margin-left:6px; color:var(--muted); font-weight:400; font-size:12px;}
.com-regles{margin:18px 6px 0; text-align:center; font-size:12.5px; color:var(--muted); font-weight:300; line-height:1.5;}

/* ---------- LE COMPOSITEUR ---------- */

.com-comp-ferme{display:flex; flex-direction:column; align-items:stretch; gap:12px; cursor:default;}
.com-comp-haut{display:flex; align-items:center; gap:12px;}
.com-comp-invite{flex:1;}
.com-types-rapides{display:grid; grid-template-columns:repeat(4, minmax(0, 1fr)); gap:8px;}
.com-type-rapide span{overflow:hidden; text-overflow:ellipsis;}
.com-type-rapide{
  display:flex; align-items:center; justify-content:center; gap:8px; height:44px; padding:0 10px;
  border-radius:14px; border:1px solid transparent; background:none;
  color:var(--ink-soft); font-size:13.5px; font-weight:500; cursor:pointer; white-space:nowrap;
  transition:background .3s var(--ease), border-color .3s var(--ease), transform .25s var(--ease);
}
.com-type-rapide svg{color:var(--tc); flex:none; opacity:.7; transition:opacity .25s var(--ease);}
.com-type-rapide:hover{background:rgba(255,255,255,0.06); color:#fff;}
.com-type-rapide:hover svg{opacity:1;}
.com-type-rapide:active{transform:scale(.97);}
.t-message{--tc:#4fb4ff;} .t-son{--tc:#3ecf8e;} .t-question{--tc:#f5a524;} .t-collab{--tc:#b79cff;}
.com-comp-types .com-chip{border-color:transparent; background:none; color:var(--muted);}
.com-comp-types .com-chip svg{color:var(--tc); opacity:.7; transition:opacity .25s var(--ease);}
.com-comp-types .com-chip:hover{background:rgba(255,255,255,0.06); color:var(--ink);}
.com-comp-types .com-chip:hover svg{opacity:1;}
.com-comp-types .com-chip.actif{background:color-mix(in srgb, var(--tc) 14%, transparent); border-color:transparent; color:#fff;}
.com-comp-types .com-chip.actif svg{opacity:1;}

/* ---------- UN MESSAGE ---------- */

.com-post{padding:18px 20px 0; border-radius:20px; overflow:hidden;}
.com-post::before{
  content:''; position:absolute; left:0; top:22px; bottom:60px; width:3px; border-radius:0 3px 3px 0;
  background:var(--sj, var(--blue-bright)); opacity:.9;
}
.com-post[data-type="collab"]::before{display:none;}
.com-post-tete .com-av{box-shadow:0 0 0 2px #0a0d12, 0 0 0 4px var(--rc, rgba(255,255,255,0.2));}
.com-post-nom{font-size:15.5px;}
.com-post-meta{margin-top:4px; gap:2px;}
.com-sujet-lien{
  display:inline-flex; align-items:center; padding:1px 9px; border-radius:99px; font-size:12px; font-weight:500;
  background:color-mix(in srgb, var(--sj, #4fb4ff) 14%, transparent); color:var(--ink-soft);
}
.com-sujet-lien:hover{background:color-mix(in srgb, var(--sj, #4fb4ff) 26%, transparent); color:var(--ink);}
.com-sujet-lien .com-pt{margin-right:6px; width:7px; height:7px;}
.com-post-corps{margin:14px 0 4px 0;}
.com-texte{font-size:16px; line-height:1.62;}
.com-epingle{margin:-4px 0 12px 0;}

.com-post > .com-images, .com-post > .com-embed, .com-post > .com-carte-lien,
.com-post > .com-collab-cta, .com-post > .com-edition{margin-left:0; margin-top:12px; max-width:none;}
.com-post > .com-images{max-width:none;}

/* Le bandeau d'une annonce de collaboration : il passe avant l'auteur. */
.com-post > .com-collab{margin:0 0 12px; padding:0 0 12px; border-bottom:1px solid var(--line);}

/* Le bas : réactions visibles, puis commentaires, enregistrer, partager. */
.com-post-pied{
  display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap;
  margin:16px -20px 0; padding:10px 14px 10px 20px;
  border-top:1px solid var(--com-bord); background:rgba(255,255,255,0.025);
}
.com-vibes{display:flex; align-items:center; gap:6px; flex-wrap:wrap; min-width:0;}
.com-vibe{
  display:inline-flex; align-items:center; gap:6px; height:34px; padding:0 12px;
  border-radius:99px; border:1px solid var(--line); background:rgba(255,255,255,0.05);
  color:var(--ink-soft); font-size:13px; font-weight:500; cursor:pointer;
  transition:background .25s var(--ease), border-color .25s var(--ease), transform .25s var(--ease);
}
.com-vibe b{font-weight:700; font-variant-numeric:tabular-nums;}
.com-vibe-e{font-size:16px; line-height:1; display:inline-block;}
.com-vibe:hover{background:rgba(255,255,255,0.11);}
.com-vibe:active{transform:scale(.94);}
.com-vibe.mien{background:rgba(79,180,255,0.2); border-color:rgba(79,180,255,0.6); color:#fff;}
.com-vibe.ajout{padding:0 10px; color:var(--muted);}
.com-vibe.ajout.vide{padding:0 14px 0 10px;}
.com-vibe.ajout:hover{color:var(--ink);}
.com-post-outils{display:flex; align-items:center; gap:2px; flex:none;}
.com-outil{
  display:inline-flex; align-items:center; gap:6px; height:34px; padding:0 11px; border:0; border-radius:99px;
  background:none; color:var(--muted); font-size:13px; font-weight:500; cursor:pointer; font-variant-numeric:tabular-nums;
  transition:background .25s var(--ease), color .25s var(--ease), transform .25s var(--ease);
}
.com-outil:hover{background:rgba(255,255,255,0.08); color:var(--ink);}
.com-outil:active{transform:scale(.93);}
.com-outil.icone{padding:0 9px;}
.com-outil.favori.actif{color:var(--gold-favori);}
.com-outil.favori.actif svg{fill:var(--gold-favori);}

.com-post.detail .com-texte{font-size:17px;}

/* Zone d'une réaction : la palette s'ouvre au-dessus du bouton « + ». */
.com-reag-zone{position:relative; display:inline-flex;}
.com-reag-zone.ouverte .com-palette{opacity:1; transform:none; pointer-events:auto;}
.com-reag-zone:has(:focus-visible) .com-palette{opacity:1; transform:none; pointer-events:auto;}

/* ---------- À DÉCOUVRIR, DANS LE FIL ---------- */

.com-inter{display:flex; flex-direction:column; gap:18px; padding:6px 0 8px;}
.com-inter-tete{display:flex; align-items:center; justify-content:space-between; margin:0 4px 10px;}
.com-inter-tete b{display:inline-flex; align-items:center; gap:8px; font-size:15px; font-weight:700;}
.com-inter-tete b .com-ic{color:var(--blue-bright);}
.com-inter-tete a{font-size:13px; font-weight:600; color:var(--blue-bright); text-decoration:none;}
.com-inter-tete a:hover{text-decoration:underline;}
.com-inter .com-defile{padding:2px 2px 8px;}

.com-collab-mini{
  --c:var(--blue-bright);
  flex:none; width:236px; display:flex; flex-direction:column; gap:9px; padding:14px 15px; border-radius:16px;
  text-decoration:none; color:var(--ink); border:1px solid rgba(79,180,255,0.3);
  background:linear-gradient(135deg, rgba(20,137,222,0.2), rgba(20,137,222,0.04));
  transition:transform .35s var(--ease), border-color .3s var(--ease);
}
.com-collab-mini[data-mode="propose"]{
  --c:var(--com-vert); border-color:rgba(62,207,142,0.32);
  background:linear-gradient(135deg, rgba(62,207,142,0.18), rgba(62,207,142,0.03));
}
.com-collab-mini:hover{transform:translateY(-3px); border-color:var(--c);}
.com-collab-mini-haut{display:flex; align-items:center; gap:11px;}
.com-collab-mini-ic{width:40px; height:40px; border-radius:12px; font-size:21px; display:flex; align-items:center; justify-content:center; background:rgba(255,255,255,0.09);}
.com-collab-mini-titre{display:flex; flex-direction:column; min-width:0; line-height:1.25;}
.com-collab-mini-titre small{font-size:10.5px; font-weight:700; letter-spacing:0.14em; text-transform:uppercase; color:var(--c);}
.com-collab-mini-titre b{font-size:15.5px; font-weight:700; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
.com-collab-mini-meta{display:flex; align-items:center; gap:5px; font-size:12.5px; color:var(--ink-soft); font-weight:300; min-height:18px;}
.com-collab-mini-qui{display:flex; align-items:center; gap:8px; padding-top:9px; border-top:1px dashed rgba(255,255,255,0.18); font-size:13px; font-weight:500;}
.com-collab-mini-qui .com-av-s{width:24px; height:24px; font-size:11px;}
.com-collab-mini-qui span:last-child{overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}

/* ---------- LES PAGES LARGES : EXPLORER ET COLLABS ---------- */

.com-explorer-tete{max-width:none;}
/* Les annonces : une liste à lignes fines, sans cartes ni bandeau de pied. */
.com-vue[data-vue="collabs"] .com-liste{display:flex; flex-direction:column; gap:0;}
.com-vue[data-vue="collabs"] .com-post{
  padding:20px 4px 6px; border:0; border-bottom:1px solid var(--line); border-radius:0; background:none; box-shadow:none;
  -webkit-backdrop-filter:none; backdrop-filter:none; overflow:visible;
}
.com-vue[data-vue="collabs"] .com-post[data-act]:hover{background:rgba(255,255,255,0.02);}
.com-vue[data-vue="collabs"] .com-post-pied{margin:12px 0 0; padding:6px 0; border:0; background:none;}

/* ---------- LE PROFIL : UNE CARTE QUI RESTE EN VUE ---------- */

.com-profil-grille{display:grid; grid-template-columns:350px minmax(0, 1fr); gap:24px; align-items:start;}
.com-profil-gauche{position:sticky; top:170px;}
.com-profil-droite{min-width:0;}
/* Les onglets du profil sont six : sur un écran étroit, la barre défile au lieu de déborder de la page. */
.com-profil-droite [data-hote="onglets"]{max-width:100%; overflow-x:auto; scrollbar-width:none;}
.com-profil-droite [data-hote="onglets"]::-webkit-scrollbar{display:none;}
.com-profil{overflow:hidden; margin-bottom:0;}
.com-profil-banniere{
  position:relative; overflow:hidden; aspect-ratio:3 / 1;
  background:
    radial-gradient(120% 140% at 85% 0%, hsl(calc(var(--h,210) + 50) 70% 38% / .55), transparent 60%),
    linear-gradient(135deg, hsl(var(--h,210) 60% 30%), hsl(calc(var(--h,210) + 46) 62% 16%));
}
.com-profil-banniere > img{position:absolute; inset:0; width:100%; height:100%; object-fit:cover; display:block;}
.com-profil-banniere.avec-image{background:#0b0f15;}
.com-profil-banniere.avec-image::after{
  content:''; position:absolute; inset:0; pointer-events:none;
  background:linear-gradient(to bottom, rgba(5,7,10,0.28), transparent 38%, transparent 62%, rgba(5,7,10,0.34));
}
.com-profil-engrenage, .com-ban-btn{
  position:absolute; z-index:2; width:40px; height:40px; padding:0; border-radius:50%;
  display:flex; align-items:center; justify-content:center; color:#fff; cursor:pointer;
  background:rgba(8,11,16,0.55); border:1px solid rgba(255,255,255,0.22);
  -webkit-backdrop-filter:blur(8px); backdrop-filter:blur(8px);
  transition:transform .5s var(--ease), background .25s var(--ease), border-color .25s var(--ease);
}
.com-profil-engrenage{top:10px; right:10px;}
.com-profil-engrenage:hover{transform:rotate(70deg); background:rgba(8,11,16,0.78); border-color:rgba(255,255,255,0.4);}
.com-profil-engrenage svg{width:20px; height:20px;}
.com-ban-btn{bottom:10px; right:10px; width:34px; height:34px;}
.com-ban-btn.retirer{right:52px;}
.com-ban-btn:hover{background:rgba(8,11,16,0.78); border-color:rgba(255,255,255,0.4);}
.com-niveau{
  padding:0; border:0; background:none; font:inherit; color:var(--blue-bright); cursor:pointer;
}
.com-niveau:hover{text-decoration:underline;}
.com-profil-ondes{position:absolute; right:-6px; bottom:-14px; color:#fff; opacity:0.2; display:flex;}
.com-profil-corps{padding:0 22px 22px;}
.com-profil-avatar{position:relative; width:max-content; margin-top:-50px;}
.com-profil-avatar .com-av-xl{box-shadow:0 0 0 4px #0b0f15, 0 0 0 7px var(--rc, rgba(255,255,255,0.2));}
.com-profil-nom{font-size:24px; margin-top:14px;}
.com-profil-meta{display:flex; align-items:center; flex-wrap:wrap; gap:8px 12px; margin-top:8px;}
.com-profil-sous{display:flex; flex-wrap:wrap; gap:4px 14px; margin-top:8px; font-size:13px; color:var(--muted); font-weight:300;}
.com-profil-actions{display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin:16px 0 0;}
.com-profil-actions .com-pleine{width:100%;}
.com-profil-bio{margin:16px 0 0; font-size:15.5px; line-height:1.6;}
.com-profil-duo{display:grid; gap:10px; margin-top:18px;}
.com-profil-bloc{padding:12px 14px; border-radius:16px; background:rgba(255,255,255,0.04); border:1px solid var(--line); border-left-width:3px;}
.com-profil-bloc.cherche{border-left-color:var(--blue-bright);}
.com-profil-bloc.propose{border-left-color:var(--com-vert);}
.com-profil-bloc-titre{display:flex; align-items:center; gap:7px; margin-bottom:9px; font-size:11.5px; font-weight:700; letter-spacing:0.12em; text-transform:uppercase; color:var(--muted);}
.com-profil-bloc-chips{display:flex; flex-wrap:wrap; gap:6px;}
.com-profil-bloc-chips em{font-style:normal; font-size:13px; color:var(--muted); font-weight:300;}
.com-profil-styles{display:flex; flex-wrap:wrap; gap:6px; margin-top:12px;}
.com-profil-stats{display:grid; grid-template-columns:repeat(4, 1fr); gap:6px; margin-top:18px;}
.com-profil-stats > div{text-align:center; padding:11px 6px; border-radius:14px; background:rgba(255,255,255,0.04);}
.com-profil-stats b{display:block; font-size:19px; font-weight:700; color:var(--ink); margin:0;}
.com-profil-stats span{font-size:11.5px; color:var(--muted);}

.com-messages{height:calc(100vh - 236px);}

.com-seg-large{display:inline-flex; width:auto;}
.com-seg-large .com-seg-btn{flex:none; padding:9px 20px;}
.com-collabs-barre{display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px 14px; margin-bottom:16px;}
.com-collabs-droite{display:flex; align-items:center; gap:2px;}
.com-seg-texte{display:inline-flex; gap:2px; padding:0; background:none; border:0; box-shadow:none;}
.com-seg-texte .com-seg-btn{
  flex:none; padding:9px 14px; border:0; border-radius:var(--radius-pill); background:none; box-shadow:none;
  color:var(--muted); font-size:13.5px; font-weight:500; cursor:pointer;
  transition:background .25s var(--ease), color .25s var(--ease);
}
.com-seg-texte .com-seg-btn:hover{background:rgba(255,255,255,0.06); color:var(--ink);}
.com-seg-texte .com-seg-btn.actif{background:rgba(255,255,255,0.1); color:#fff;}
.com-menu-emoji{width:18px; text-align:center; font-size:15px; line-height:1;}

/* « N nouveaux messages » : sous le dock, pas sous la barre du site. */
.com-pilule{top:168px;}

/* Le focus au clavier se voit partout dans la communauté. */
.com a:focus-visible, .com button:focus-visible, .com select:focus-visible, .com input:focus-visible{
  outline:2px solid var(--blue-bright); outline-offset:2px;
}
.com .com-comp-texte:focus-visible, .com .com-msg-champ textarea:focus-visible, .com .com-styles input:focus-visible,
.com .com-comp-lien input:focus-visible{outline:0;}

/* ---------- PIÈCES REPRISES DE LA PREMIÈRE VERSION ---------- */

.com-pleine{width:100%;}

.com-nav-item{
  position:relative; display:flex; align-items:center; gap:16px;
  padding:12px 16px; border-radius:var(--radius-pill);
  color:var(--ink-soft); font-size:16px; font-weight:500; text-decoration:none;
  transition:background .25s var(--ease), color .25s var(--ease), transform .25s var(--ease);
}
.com-nav-item:active{transform:scale(.97);}
.com-nav-item.actif{color:#fff; font-weight:700;}
.com-nav-item.actif .com-ic{color:var(--blue-bright);}
.com-nav-ic{position:relative; display:inline-flex;}
.com-badge-nb{
  position:absolute; top:-6px; right:-8px; min-width:18px; height:18px; padding:0 5px;
  border-radius:9px; background:var(--com-coeur); color:#fff;
  font-size:11px; font-weight:700; line-height:18px; text-align:center;
  box-shadow:0 0 0 2px #090c11;
  animation:comPop .4s cubic-bezier(.34,1.56,.64,1);
}

.com-tendance{
  display:flex; flex-direction:column; padding:9px 6px; border-radius:12px; text-decoration:none;
  transition:background .2s var(--ease);
}
.com-tendance:hover{background:rgba(255,255,255,0.06);}
.com-tendance b{font-size:14px; font-weight:600;}
.com-tendance small{font-size:12px; color:var(--muted); font-weight:300;}
.com-cote-lien{display:block; padding:10px 4px 6px; font-size:13px; color:var(--blue-bright); text-decoration:none;}
.com-cote-lien:hover{text-decoration:underline;}

.com-mini-lien{display:flex; align-items:center; gap:10px; min-width:0; text-decoration:none; flex:1;}
.com-mini-lien.res{padding:8px; border-radius:12px; flex:none; width:100%;}
.com-mini-lien.res:hover{background:rgba(255,255,255,0.06);}
.com-mini-texte{display:flex; flex-direction:column; min-width:0; line-height:1.3;}
.com-mini-nom{font-size:14px; font-weight:600; display:flex; align-items:center; gap:4px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
.com-mini-role{font-size:12px; color:var(--muted); font-weight:300; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}

.com-avatar-modif{
  position:absolute; right:-2px; bottom:2px; width:34px; height:34px; border-radius:50%; border:2px solid #0b0f15;
  display:flex; align-items:center; justify-content:center; padding:0; cursor:pointer;
  background:var(--blue); color:#fff; transition:transform .3s var(--ease), background .3s var(--ease);
}
.com-avatar-modif:hover{background:#1a97ee; transform:scale(1.12);}
.com-profil-note{display:flex; align-items:center; gap:8px; margin:14px 0 0; color:var(--com-orange); font-size:14px;}
.com-reseaux{display:flex; flex-wrap:wrap; gap:8px; margin-top:16px;}
.com-reseau{
  display:inline-flex; align-items:center; gap:6px; padding:7px 13px; border-radius:99px; font-size:13px; font-weight:500;
  border:1px solid var(--line-strong); color:var(--ink-soft); text-decoration:none; transition:all .25s var(--ease);
}
.com-reseau:hover{border-color:var(--blue-bright); color:var(--blue-bright);}

/* ---------- LARGEURS D'ÉCRAN ---------- */

/* Portable étroit : le dock ne garde que ses icônes. */
@media (max-width:1060px){
  .com-profil-grille{grid-template-columns:320px minmax(0, 1fr); gap:18px;}
}

/* Dock au centre, recherche à droite : quand la page se resserre, le champ ouvert reste court pour ne pas couvrir les icônes. */
@media (max-width:1100px){
  .com-rapide:focus-within .com-recherche-champ{width:200px;}
}

@media (max-width:900px){
  .com-vue[data-vue="collabs"] .com-liste{grid-template-columns:1fr;}
  .com-profil-grille{grid-template-columns:1fr;}
  .com-profil-gauche{position:static;}
}

/* Téléphone : la barre du bas remplace le dock. */
@media (max-width:760px){

  .com{padding-bottom:130px;}
  .com-haut{display:none;}
  .com-vue, .com-entete{max-width:none;}

  .com-entete{display:flex; position:relative; margin-bottom:10px; min-height:44px;}
  .com-entete-titre{font-size:21px;}
  .com-entete-actions{display:flex;}
  .com-entete-moi{padding:0;}
  .com-entete-moi .com-av{width:32px; height:32px; font-size:14px;}

  .com-barre{
    position:fixed; left:0; right:0; bottom:0; z-index:95; display:grid; grid-template-columns:repeat(5, 1fr);
    padding:6px 6px calc(6px + env(safe-area-inset-bottom));
    background:rgba(8,11,16,0.9); backdrop-filter:blur(24px) saturate(180%); -webkit-backdrop-filter:blur(24px) saturate(180%);
    border-top:1px solid var(--line);
  }
  .com-barre .com-nav-item{flex-direction:column; gap:3px; padding:8px 0 6px; border-radius:14px; font-size:11px; background:none;}
  .com-barre .com-nav-item .com-nav-lib{display:block; font-weight:500;}
  .com-barre .com-nav-item.actif{color:var(--blue-bright); background:none;}
  .com-barre .com-nav-item:hover{background:none;}
  .com-barre .com-badge-nb{top:-5px; right:-10px;}

  .com-fab{
    position:fixed; right:16px; bottom:calc(150px + env(safe-area-inset-bottom)); z-index:96;
    display:flex; align-items:center; justify-content:center; width:56px; height:56px; border-radius:50%; border:0;
    background:var(--blue); color:#fff; cursor:pointer;
    box-shadow:0 12px 30px rgba(20,137,222,0.5), var(--reflet-int);
    transition:transform .3s var(--ease), background .3s var(--ease);
  }
  .com-fab[hidden]{display:none;}
  .com-fab:active{transform:scale(.9);}
  .com[data-comp="1"] .com-fab{display:none;}

  .com-post{padding:16px 16px 0; border-radius:18px;}
  .com-post > .com-collab{margin:0 0 12px; padding:0 0 12px;}
  .com-post-pied{margin:14px -16px 0; padding:8px 10px 8px 14px;}
  .com-outil-lib{display:none;}
  .com-texte{font-size:15.5px;}
  .com-types-rapides{grid-template-columns:repeat(2, minmax(0, 1fr));}

  .com-grille-champs{grid-template-columns:1fr;}
  .com-comp-images{grid-template-columns:repeat(4, 1fr); gap:6px;}
  .com-comp-pied{gap:6px;}

  .com-explorer-tete{padding:18px 16px 14px;}
  .com-profil-corps{padding:0 16px 18px;}
  .com-profil-nom{font-size:22px;}

  /* Messages : la liste, ou la discussion, jamais les deux. */
  .com-messages{
    grid-template-columns:minmax(0,1fr); border-radius:var(--radius);
    height:calc(100dvh - 232px); min-height:420px; max-height:none;
  }
  .com-messages[data-mode="liste"] .com-fil-pane{display:none;}
  .com-messages[data-mode="fil"] .com-conv-pane{display:none;}
  .com-conv-pane{border-right:0;}
  .com-conv-tete h2{display:none;}
  .com-fil-retour{display:inline-flex;}
  .com-bulle{max-width:86%;}

  .com-calque-dialogue{align-items:flex-end; padding:0;}
  .com-dialogue{width:100%; max-height:92vh; border-radius:26px 26px 0 0; border-bottom:0; transform:translateY(100%);}
  .com-dialogue-pied{padding-bottom:calc(20px + env(safe-area-inset-bottom));}

  .com-vision-nav{width:44px; height:44px;}
  .com-vision-nav.prec{left:8px;}
  .com-vision-nav.suiv{right:8px;}
  .com-pilule{top:78px;}

  /* Le bouton flottant des défis, propre au site, passe au-dessus de la barre. */
  body.com-actif .defis-flottant{bottom:84px;}
  body.com-actif .defis-panneau{bottom:140px;}
}

@media (max-width:420px){
  .com-profil-actions .com-btn{padding:9px 13px; font-size:13px;}
  .com-ruban-carte{width:148px;}
  .com-collab-mini{width:210px;}
  .com-types-rapides .com-type-rapide span{font-size:13px;}
}

`;

})();
