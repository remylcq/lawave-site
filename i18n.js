/* =====================================================================
   La Wave — la version anglaise

   Le site est écrit en français. Quand la langue choisie est l'anglais (pied de page : FR / EN), ce fichier est chargé et
   traduit ce qui s'affiche : les textes de l'interface, d'après le dictionnaire ci-dessous, ceux de la page au départ puis
   tout ce que le site ajoute ensuite (un MutationObserver surveille la page).

   Ce qui est traduit : la navigation, l'accueil, le catalogue et ses fiches, la carte, la communauté (menus et boutons),
   la connexion, les outils (mes sorties, lancement, idées), le pied de page.
   Ce qui reste en français : les textes que les membres écrivent, les noms d'artistes et de titres, les pages juridiques
   et l'aide (longs textes à faire traduire et relire par une personne).

   Pour ajouter une phrase : une ligne « 'texte français': 'English text' » dans DICO (le texte doit être identique
   à celui qui s'affiche, sans les espaces autour).
   ===================================================================== */

(function(){

  'use strict';

  const DICO = {
    // Navigation
    'Accueil': 'Home', 'Catalogue': 'Catalogue', 'Soumettre une sortie': 'Submit a release', 'Contenu': 'Content', 'Carte': 'Map',
    'Communauté': 'Community', 'Accréditations': 'Accreditations', 'Compte': 'Account', 'Connexion': 'Log in',
    'Créer un compte': 'Create an account', "L'espace des waveurs": 'The waveurs room', 'Mon profil': 'My profile',
    'Se déconnecter': 'Log out', 'Aller au contenu': 'Skip to content', 'Se connecter': 'Log in',

    // Accueil
    'La Wave, le média musical qui repère les sons et les artistes avant tout le monde': 'La Wave, the music media that spots sounds and artists before everyone else',
    'Dernière actu': 'Latest news', 'La playlist de La Wave, à écouter sur Spotify et sur Deezer.': "La Wave's playlist, to listen to on Spotify and Deezer.",
    'La sélection': 'The selection', 'Sélection': 'Selection', 'Nos sorties du moment': 'Our releases of the moment',
    'Les dernières sorties': 'Latest releases', 'Tout voir': 'See all', 'Sortie précédente': 'Previous release', 'Sortie suivante': 'Next release',
    'Écouter sur Spotify': 'Listen on Spotify', 'Écouter sur Deezer': 'Listen on Deezer', 'X (Twitter)': 'X (Twitter)',

    // Catalogue
    'Pages du catalogue': 'Catalogue pages', 'Rechercher': 'Search', 'Rechercher un titre ou un artiste': 'Search for a title or an artist',
    'Tout': 'All', 'Singles': 'Singles', 'Projets': 'Projects', 'Single': 'Single', 'Projet': 'Project', 'Cette semaine': 'This week',
    'Surprends-moi': 'Surprise me', 'Toutes les années': 'All years', 'Tous les mois': 'All months', 'Plus récentes': 'Newest',
    'Plus anciennes': 'Oldest', 'Titre A → Z': 'Title A → Z', 'Réinitialiser': 'Reset', 'Réessayer': 'Try again',
    'Aucune sortie ne correspond à ces filtres.': 'No release matches these filters.', 'Aucune sortie ne correspond à cette recherche.': 'No release matches this search.',
    'Le catalogue ne répond pas pour le moment.': 'The catalogue is not responding right now.',
    'Année de sortie': 'Release year', 'Mois de sortie': 'Release month', 'Ordre': 'Order', 'Type de sortie': 'Release type',
    'janvier': 'January', 'février': 'February', 'mars': 'March', 'avril': 'April', 'mai': 'May', 'juin': 'June', 'juillet': 'July',
    'août': 'August', 'septembre': 'September', 'octobre': 'October', 'novembre': 'November', 'décembre': 'December',
    'Agrandir la pochette': 'Enlarge the cover', "Ajouter à ma file d'écoute": 'Add to my listening queue', "Instagram de l'artiste": "Artist's Instagram",
    'Partager cette sortie': 'Share this release', 'Titres du projet': 'Project tracklist', 'Écouter un extrait': 'Listen to a preview',
    "Arrêter l'extrait": 'Stop the preview', 'Autres versions': 'Other versions', 'Tout écouter': 'Play all', 'Ajouter à ma collection': 'Add to my collection',
    'Pas encore de note : sois le premier.': 'No rating yet: be the first.', 'Chargement…': 'Loading…', 'Chargement...': 'Loading...',
    'Bouge la souris pour incliner la pochette': 'Move the mouse to tilt the cover', 'Fermer': 'Close', 'Voir la fiche': 'See the page',

    // Carte
    'La carte des artistes': 'The artists map', "D'où viennent les artistes repérés par La Wave. Clique sur une ville, ou cherche un artiste.": 'Where the artists spotted by La Wave come from. Click a city, or search for an artist.',
    'Artiste ou ville': 'Artist or city', 'Artistes de la ville choisie': 'Artists of the chosen city', 'Autour de moi': 'Near me', 'Belgique': 'Belgium',
    'Concerts ce mois-ci': 'Concerts this month', 'Dézoomer': 'Zoom out', 'Zoomer': 'Zoom in', 'Effacer la recherche': 'Clear the search',
    'Filtres de la carte': 'Map filters', 'France': 'France', 'Outre-mer': 'Overseas', 'Pays': 'Country', 'Suisse': 'Switzerland',
    'Rechercher un artiste ou une ville sur la carte': 'Search for an artist or a city on the map', "Revenir à la vue d'ensemble": 'Back to the overview',
    'Résultats': 'Results', "Vue d'ensemble": 'Overview', 'Molette pour zoomer · glisser pour déplacer': 'Scroll to zoom · drag to move',
    'Pincer pour zoomer · glisser': 'Pinch to zoom · drag', 'Tous les artistes': 'All artists',

    // Page artiste
    'Discographie': 'Discography', 'Concerts': 'Concerts', 'Galerie': 'Gallery', 'Statistiques': 'Statistics', 'Grille': 'Grid', 'Frise': 'Timeline',
    'Carte de visite': 'Business card', 'Partager': 'Share', 'Suivre': 'Follow', 'Suivi': 'Following', 'Dans la même veine': 'In the same vein',
    'Signaler cet artiste': 'Report this artist', 'Un problème avec cette fiche ?': 'A problem with this page?',
    'Tu es cet artiste ?': 'Are you this artist?', 'Revendiquer cette page': 'Claim this page', 'Modifier ma page': 'Edit my page',
    "← Retour au catalogue": '← Back to the catalogue', "← Retour à la carte": '← Back to the map', 'Billets': 'Tickets',
    'Ajouter un concert': 'Add a concert', 'Aucun concert annoncé pour l\'instant.': 'No concert announced yet.',

    // Soumission
    'Quelques infos, une cover, et ta sortie file directement vers l\'équipe La Wave.': 'A few details, a cover, and your release goes straight to the La Wave team.',
    'Suivre mes soumissions': 'Follow my submissions', 'Titre single / projet': 'Single / project title', 'Artiste': 'Artist', 'Date de sortie': 'Release date',
    'Liens d\'écoute': 'Listening links', 'Email de contact': 'Contact email', 'Envoyer à La Wave': 'Send to La Wave', 'Annuler': 'Cancel',
    'Choisir la cover': 'Choose the cover', 'Cover (image en bonne qualité)': 'Cover (good quality image)', 'Ajouter': 'Add', 'Clip': 'Video clip',
    '— facultatif': '— optional', 'Un seul titre.': 'One track only.', 'EP, album ou mixtape.': 'EP, album or mixtape.', 'Nom de l\'artiste': "Artist's name", 'Ta ville': 'Your city',
    '＋ Nouvel artiste': '+ New artist', "Tape un nom d'artiste": 'Type an artist name', 'Lien YouTube du clip': 'YouTube link of the clip',
    'Réservé aux artistes et à leur entourage': 'Reserved for artists and their team', 'Réservé aux photographes': 'Reserved for photographers', 'Accès réservé': 'Restricted access',

    // Contenu, à propos
    'Les dernières vidéos et publications de La Wave.': "La Wave's latest videos and posts.", 'Dernières vidéos': 'Latest videos', 'Derniers posts Instagram': 'Latest Instagram posts',
    'À propos de La Wave': 'About La Wave', 'La ligne éditoriale': 'Editorial line', 'En chiffres': 'In numbers',
    'La Wave est né sur les réseaux sociaux avec une idée simple : repérer les sons et les artistes qui comptent avant qu\'ils soient partout, sans se limiter à un seul genre.': 'La Wave was born on social media with a simple idea: spot the sounds and artists that matter before they are everywhere, without limiting ourselves to a single genre.',

    // Accréditations
    'Accès photographe': 'Photographer access', 'Mes accréditations': 'My accreditations', 'Mon suivi': 'My tracking', 'Proposer un concert': 'Suggest a concert', 'Tes envies': 'Your wishes',
    'Inscris-toi au tirage au sort, si tu es tiré, on te contacte avec les démarches.': "Sign up for the draw; if you're picked, we'll contact you with the steps.",

    // Connexion
    'Email': 'Email', 'Mot de passe': 'Password', 'Pseudo': 'Username', 'Créer mon compte': 'Create my account', 'Tu es plutôt…': 'You are rather…',
    "Ton mot de passe est chiffré : l'équipe ne le voit jamais.": 'Your password is encrypted: the team never sees it.', 'ou': 'or',

    // Communauté
    'Ton avis': 'Your feedback', 'Wave Cards': 'Wave Cards', 'Messages': 'Messages', 'Alertes': 'Alerts', 'Annonces': 'Classifieds', 'Studios': 'Studios', 'Explorer': 'Explore',
    'Récents': 'Recent', 'Abonnements': 'Following', 'Tendances': 'Trending', 'Tous les sujets': 'All topics', 'Écrire': 'Write',
    'Partager un son': 'Share a track', 'Poser une question': 'Ask a question', 'Commenter': 'Comment', 'Publier': 'Post', 'Envoyer': 'Send',
    'Rejoins la conversation': 'Join the conversation', 'Défi de la semaine': 'Challenge of the week', 'Participer': 'Join in',
    'Pour bien démarrer': 'Getting started', 'Trouver des membres': 'Find members', 'Chercher un membre': 'Search for a member', 'Filtres': 'Filters',
    'Tous les métiers': 'All trades', 'Mes signalements': 'My reports', 'Mes sorties': 'My releases', 'Enregistrés': 'Saved', 'Publications': 'Posts',
    'Signaler': 'Report', 'Bloquer': 'Block', 'Écrire en privé': 'Message privately', 'Répondre': 'Reply', 'Modifier': 'Edit', 'Supprimer': 'Delete',
    'Annuaire des studios': 'Studio directory', 'Proposer un studio': 'Suggest a studio', 'Nouveau message': 'New message', 'Tes messages': 'Your messages',
    'Rejoindre la communauté': 'Join the community', 'Aucune annonce ne correspond': 'No classified matches', 'Toutes': 'All', 'Demandes': 'Requests', 'Offres': 'Offers',

    // Outils
    'Mes soumissions': 'My submissions', 'Mes sorties publiées': 'My published releases', 'En attente de validation': 'Awaiting validation', 'Publiée': 'Published',
    'Refusée': 'Rejected', 'Page de lancement': 'Launch page', 'Copier le lien': 'Copy the link', 'Affiche': 'Poster', 'Ma carte de visite': 'My business card',
    'Me prévenir le jour J': 'Notify me on release day', '✓ Je serai prévenu': "✓ I'll be notified", "Suivre l'artiste": 'Follow the artist', 'Ajouter à mon agenda': 'Add to my calendar',
    'Disponible maintenant': 'Available now', 'jours': 'days', 'heures': 'hours', 'minutes': 'minutes', 'secondes': 'seconds', 'Voir tout sur La Wave': 'See everything on La Wave',
    'Partager cette carte': 'Share this card', 'Dernières sorties': 'Latest releases', 'Prochain concert': 'Next concert', 'Télécharger l\'image': 'Download the image',
    'Afficher la date de sortie': 'Show the release date', 'Format': 'Format',
    'Où en sont tes soumissions, les chiffres de tes sorties, et de quoi les lancer : page de lancement, affiche, carte de visite.': 'Where your submissions stand, your releases\' figures, and what you need to launch them: launch page, poster, business card.',
    'Les idées de la communauté': "The community's ideas", 'Une idée pour La Wave ? Propose-la, et vote pour celles des autres : les plus soutenues passent en premier.': 'An idea for La Wave? Suggest it, and vote for the others: the most supported come first.',
    'Les plus votées': 'Most voted', 'Les plus récentes': 'Most recent', 'Proposer une idée': 'Suggest an idea', "Aucune idée pour l'instant : propose la première.": 'No idea yet: suggest the first one.',
    'Nouveautés du site': "What's new on the site", "Ce qui vient d'arriver sur La Wave, du plus récent au plus ancien.": "What's just arrived on La Wave, from newest to oldest.",
    'Nouveautés': "What's new", 'Envoyer l\'idée': 'Send the idea', 'Retirer mon idée': 'Remove my idea',

    // Pied de page
    'Mentions légales': 'Legal notice', 'Confidentialité': 'Privacy', 'Aide et informations': 'Help and information', 'Espace privilégié': 'Privileged area',
    'Espace photographe': 'Photographer area', 'Espace équipe': 'Team area', 'Informations légales et aide': 'Legal information and help', "Installer l'application": 'Install the app',
    'Média musical · © 2026': 'Music media · © 2026', 'Texte': 'Text', 'Taille du texte': 'Text size', 'Agrandir le texte': 'Enlarge the text', 'Réduire le texte': 'Reduce the text',
    'Taille normale': 'Normal size', 'Le flux RSS des sorties': 'The releases RSS feed', 'Progression et quêtes du jour': 'Progress and daily quests',
    'Compte, sorties, XP : les réponses rapides.': 'Account, releases, XP: quick answers.', 'Questions fréquentes': 'Frequently asked questions', "Conditions d'utilisation": 'Terms of use',
    'Signaler un problème': 'Report a problem', 'À propos': 'About', 'Tout sur La Wave': 'Everything about La Wave',

    // Titres de l'onglet
    'La Wave — média musical': 'La Wave — music media', 'Catalogue des sorties': 'Release catalogue', 'Communauté — La Wave': 'Community — La Wave',
    'La carte des artistes — La Wave': 'The artists map — La Wave', 'Soumettre une sortie — La Wave': 'Submit a release — La Wave', 'Mes sorties — La Wave': 'My releases — La Wave',
    'Les idées de la communauté — La Wave': "The community's ideas — La Wave", 'Nouveautés du site — La Wave': "What's new — La Wave"
  };

  // Les phrases qui changent de nombre ou de date.
  const MOTIFS = [
    [/^(\d[\d\s  ]*) sorties$/, '$1 releases'], [/^(\d+) sortie$/, '$1 release'],
    [/^(\d+) titres$/, '$1 tracks'], [/^(\d+) artistes$/, '$1 artists'], [/^(\d+) artiste$/, '$1 artist'],
    [/^Sortie le (.+)$/, 'Released on $1'], [/^Page (\d+)$/, 'Page $1'],
    [/^Quoi de neuf, (.+) \?$/, "What's new, $1?"], [/^(\d+) membres?$/, '$1 member(s)'],
    [/^encore (\d+) jours?$/, '$1 day(s) left'], [/^(\d+) participations? · voir$/, '$1 participation(s) · see'],
    [/^Avis de (.+)$/, 'Review by $1']
  ];

  const ATTRIBUTS = ['placeholder', 'aria-label', 'title'];
  const IGNORES = 'script, style, textarea, input, code, pre, [data-i18n-skip], .com-texte, .com-com-texte, .cat-info, #modalTitle, #modalArtist, .artiste-nom, .lanc h2, .vis h2';

  const normaliser = (t) => String(t).replace(/\s+/g, ' ').trim();

  function traduire(texte){

    const t = normaliser(texte);

    if(!t || t.length > 400) return null;

    if(Object.prototype.hasOwnProperty.call(DICO, t)) return DICO[t];

    for(const [re, rem] of MOTIFS){
      if(re.test(t)) return t.replace(re, rem);
    }

    return null;
  }

  function noeudTexte(n){

    if(!n.parentElement || n.parentElement.closest(IGNORES)) return;

    const en = traduire(n.nodeValue);

    if(en === null) return;

    // On garde les espaces autour : le texte traduit prend la place du texte français seulement.
    // (Un texte déjà identique n'est pas réécrit : l'observateur ne doit pas se réveiller pour rien.)
    const brut = n.nodeValue;

    if(normaliser(brut) === en) return;

    n.nodeValue = brut.match(/^\s*/)[0] + en + brut.match(/\s*$/)[0];
  }

  function attributs(el){

    if(el.closest && el.closest(IGNORES) && !/^(INPUT|TEXTAREA)$/.test(el.tagName)) return;

    ATTRIBUTS.forEach(a => {
      const v = el.getAttribute && el.getAttribute(a);
      if(!v) return;
      const en = traduire(v);
      if(en !== null && en !== v) el.setAttribute(a, en);
    });
  }

  function parcourir(racine){

    if(!racine) return;

    if(racine.nodeType === 3){ noeudTexte(racine); return; }
    if(racine.nodeType !== 1) return;

    attributs(racine);

    const marcheur = document.createTreeWalker(racine, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, null);
    let n = marcheur.nextNode();

    while(n){
      if(n.nodeType === 3) noeudTexte(n); else attributs(n);
      n = marcheur.nextNode();
    }
  }

  function titreOnglet(){
    const en = traduire(document.title);
    if(en !== null && en !== document.title) document.title = en;
    else {
      // « Titre — La Wave » : le début se traduit, la fin reste.
      const m = document.title.match(/^(.+?)( — La Wave| · La Wave)$/);
      if(m){ const d = traduire(m[1]); if(d) document.title = d + m[2]; }
    }
  }

  function demarrer(){

    document.documentElement.lang = 'en';
    parcourir(document.body);
    titreOnglet();

    let attente = [];
    let prevu = false;

    const vider = () => {
      prevu = false;
      const lot = attente;
      attente = [];
      lot.forEach(parcourir);
      titreOnglet();
    };

    new MutationObserver((mutations) => {
      mutations.forEach(m => {
        if(m.type === 'characterData') attente.push(m.target);
        else if(m.type === 'attributes') attente.push(m.target);
        else m.addedNodes.forEach(n => attente.push(n));
      });
      // Un petit délai plutôt que requestAnimationFrame : une page en arrière-plan n'y passerait pas.
      if(!prevu){ prevu = true; setTimeout(vider, 20); }
    }).observe(document.documentElement, {
      childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRIBUTS
    });
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', demarrer); else demarrer();

  window.Langue = { traduire };

})();
