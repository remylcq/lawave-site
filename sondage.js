/* =====================================================================
 * SONDAGE DES TESTEURS (TEMPORAIRE)
 *
 * Pendant la phase de test privée, les testeurs donnent leur avis sur tout
 * le site : une page #sondage (questionnaire en sections, réponses
 * enregistrées au fil de l'eau), un petit bouton flottant pour y accéder
 * depuis n'importe quelle page, et, dans l'espace équipe, l'onglet « Sondage »
 * qui rassemble les réponses (synthèse, réponses libres, détail par testeur,
 * export CSV).
 *
 * Les réponses sont rattachées à l'adresse e-mail de l'accès au portail
 * (jeton de portail.js), à défaut à celle du compte connecté. Elles vivent
 * dans la table sondage_reponses (sql/sondage.sql).
 *
 * Pour changer une question : modifier SECTIONS plus bas. Les réponses déjà
 * reçues gardent le libellé qu'elles avaient ; ajouter plutôt que renommer.
 *
 * RETRAIT : supprimer ce fichier, la section #page-sondage, le bloc
 * « SONDAGE (TEMPORAIRE) » d'index.html (onglet équipe, titre de page, appel
 * dans goTo / switchAdminTab), puis le retrait SQL en tête de sql/sondage.sql.
 * ===================================================================== */
(function(){
  'use strict';

  const SUPABASE_URL = 'https://bqataeghgjyiqrnnesqq.supabase.co';
  const CLE_PUBLIQUE = 'sb_publishable_yPAFW5xjK6gEgLZqQYyojA_D00vMayy';
  const CLE_JETON = 'lw-portail-jeton';
  const CLE_BROUILLON = 'lw-sondage-brouillon';
  const CLE_FINI = 'lw-sondage-fini';
  const TEXTE_MAX = 1500;

  // ===================================================================
  // LE QUESTIONNAIRE
  // t : note (1 à 5, ou « pas testé »), choix (une réponse), multi (plusieurs), texte, nps (0 à 10)
  // ===================================================================

  const note = (id, q) => ({ id, q, t: 'note' });
  const choix = (id, q, o) => ({ id, q, t: 'choix', o: o.split('|') });
  const multi = (id, q, o, aide) => ({ id, q, t: 'multi', o: o.split('|'), aide });
  const texte = (id, q, ph) => ({ id, q, t: 'texte', ph: ph || 'Écris ce que tu veux, même une phrase.' });

  const SECTIONS = [

    { id: 'toi', titre: 'Toi et ton test', court: 'Toi',
      intro: 'Pour comprendre tes réponses : sur quoi, et comment, tu as testé le site.',
      q: [
        multi('appareil', 'Sur quel(s) appareil(s) as-tu testé ?', 'Téléphone|Tablette|Ordinateur'),
        choix('navigateur', 'Quel navigateur utilises-tu le plus ?', 'Chrome|Safari|Firefox|Edge|Samsung Internet|Autre'),
        choix('profil', 'Quel est ton profil ?', "Auditeur / Auditrice|Artiste|Beatmaker|DJ|Photographe|Manager|Membre d'un label|Média / Presse|Autre"),
        choix('decouverte', 'À quelle fréquence cherches-tu de nouveaux artistes ou de nouvelles sorties ?', 'Tous les jours|Plusieurs fois par semaine|Une fois par semaine|Rarement|Jamais'),
        multi('plateformes', "Où écoutes-tu ta musique d'habitude ?", 'Spotify|Deezer|Apple Music|YouTube Music|SoundCloud|Instagram|TikTok|Autre'),
        choix('duree', 'Combien de temps as-tu passé sur le site, en tout ?', "Moins de 10 minutes|10 à 30 minutes|30 à 60 minutes|Plus d'une heure"),
        multi('pages', 'Quelles parties du site as-tu parcourues ?', 'Accueil|Catalogue|Fiches artistes|Carte|Soumettre une sortie|Accréditations|Contenu|Communauté|Profil et collection|Inscription / connexion|Aide et FAQ')
      ] },

    { id: 'impression', titre: 'Première impression', court: 'Impression',
      intro: "Ce que tu as pensé, juste en arrivant, avant d'avoir cliqué partout.",
      q: [
        note('globale', 'Ta première impression, en général'),
        choix('compris', "En arrivant, as-tu compris ce qu'est La Wave ?", 'Oui, tout de suite|Oui, après quelques instants|Pas vraiment|Pas du tout'),
        multi('mots', 'Quels mots décrivent le mieux le site ?', 'Moderne|Clair|Chargé|Original|Professionnel|Confus|Lent|Chaleureux|Froid|Sobre|Communautaire|Utile|Ennuyeux|Fluide', "Choisis-en autant que tu veux."),
        note('portail', "L'écran d'accès (adresse e-mail + mot de passe) : était-il simple ?"),
        texte('phrase', 'Comment décrirais-tu La Wave à un ami, en une phrase ?')
      ] },

    { id: 'design', titre: 'Design et navigation', court: 'Design',
      intro: "L'aspect du site et la facilité à s'y repérer.",
      q: [
        note('design', "L'apparence générale (couleurs, style, cohérence)"),
        note('lisible', 'La lisibilité des textes, des boutons et des icônes'),
        note('navigation', 'La facilité à trouver ce que tu cherches'),
        choix('menu', 'Le menu en haut de page', "Très clair|Plutôt clair|Un peu confus|Je ne l'ai pas compris"),
        choix('ambiance', "L'ambiance sombre du site", "Parfaite|Trop sombre|Trop claire|Je n'ai pas d'avis"),
        choix('animations', 'Les animations et les effets', "Trop nombreux|Juste ce qu'il faut|Pas assez|Je ne les ai pas remarqués"),
        note('confort', 'Le confort sur ton appareil (téléphone, tablette ou ordinateur)'),
        texte('design_texte', "Qu'est-ce qui t'a perdu, gêné ou plu dans le design ?")
      ] },

    { id: 'accueil', titre: "Page d'accueil", court: 'Accueil',
      intro: 'La première page, avec « Nos sorties du moment ».',
      q: [
        note('accueil', "La page d'accueil dans son ensemble"),
        note('selection', 'La sélection « Nos sorties du moment » (pertinence, défilement)'),
        choix('envie', "L'accueil donne-t-il envie d'explorer le reste du site ?", 'Oui, beaucoup|Plutôt oui|Plutôt non|Non'),
        texte('accueil_texte', "Qu'est-ce qui manque ou qui est de trop sur l'accueil ?")
      ] },

    { id: 'catalogue', titre: 'Catalogue des sorties', court: 'Catalogue',
      intro: 'La liste des sorties, les filtres, la recherche et les fiches de sortie.',
      q: [
        note('catalogue', 'Le catalogue dans son ensemble'),
        note('recherche', 'La recherche (par titre, artiste…)'),
        note('filtres', 'Les filtres (style, date, type, tri…)'),
        choix('pages', 'Les pages numérotées', "Je préfère|Je préférerais un défilement continu|Sans avis|Je ne les ai pas utilisées"),
        note('fiche', "La fiche d'une sortie (pochette, infos, liens d'écoute)"),
        choix('liens', "Les liens d'écoute (Spotify, Deezer, YouTube…)", "Tous fonctionnent|Certains sont cassés|Je ne les ai pas testés"),
        choix('quantite', 'Le nombre de sorties proposées', 'Trop|Juste bien|Pas assez'),
        choix('pertinence', 'Les sorties proposées sont-elles intéressantes pour toi ?', 'Oui, presque toutes|Oui, plusieurs|Rarement|Presque jamais'),
        note('collection', "L'ajout d'une sortie à ta collection / « À écouter » depuis le catalogue"),
        texte('catalogue_texte', "Qu'est-ce qui manque ou t'a gêné dans le catalogue ?")
      ] },

    { id: 'artistes', titre: 'Pages artistes', court: 'Artistes',
      intro: "La page d'un artiste : photo, sorties, réseaux, note et avis.",
      q: [
        note('artiste', "La page d'un artiste dans son ensemble"),
        multi('manque', 'Que voudrais-tu y trouver en plus ?', "Une biographie|Des photos|Les concerts à venir|Les réseaux sociaux|Les titres les plus écoutés|Les prochaines sorties|Des interviews|Les artistes similaires|Rien de plus"),
        note('avis', "La note et l'avis sur un artiste"),
        choix('suivre', "Suivre des artistes pour ne rien rater de leurs sorties t'intéresserait ?", 'Oui, beaucoup|Un peu|Pas vraiment|Non'),
        texte('artiste_texte', 'Autre chose sur les pages artistes ?')
      ] },

    { id: 'carte', titre: 'La carte des artistes', court: 'Carte',
      intro: 'La carte interactive, avec sa recherche par artiste ou par ville et son onglet Outre-mer.',
      q: [
        note('carte', 'La carte dans son ensemble'),
        choix('fluide', 'La carte est-elle fluide ?', "Oui, très|Ça va|Ça rame un peu|Elle plante ou ne s'affiche pas|Je ne l'ai pas testée"),
        note('carte_recherche', 'La recherche sur la carte (artiste, ville)'),
        note('panneau', "Le panneau d'infos quand on choisit une ville ou un artiste"),
        choix('outremer', "L'onglet Outre-mer", "Utile|Je ne l'ai pas vu|Pas utile"),
        choix('carte_usage', 'La carte te servirait à…', "Découvrir des artistes près de chez moi|Voir où se trouvent les artistes que j'aime|Repérer des artistes pour collaborer|Rien de particulier"),
        texte('carte_texte', 'Ce que tu changerais sur la carte')
      ] },

    { id: 'soumettre', titre: 'Soumettre une sortie', court: 'Soumettre',
      intro: "Le formulaire pour proposer une sortie. Réponds seulement si tu l'as ouvert, même sans l'envoyer.",
      q: [
        choix('concerne', 'Où en es-tu avec ce formulaire ?', "J'ai soumis une sortie|J'ai rempli le formulaire sans l'envoyer|Je l'ai seulement ouvert|Je ne l'ai pas ouvert"),
        note('soumettre', 'Le formulaire dans son ensemble'),
        note('etapes', 'La clarté des étapes'),
        note('recadrage', "L'outil pour recadrer la pochette"),
        choix('champs', 'Les informations demandées', 'Trop nombreuses|Justes|Pas assez'),
        choix('type', 'Le choix du type de sortie (single, projet…)', "Clair|Pas très clair|Je ne l'ai pas vu"),
        choix('attente', "Savoir que l'équipe valide avant publication", "Normal, ça me rassure|Un peu frustrant|Il faut un délai précis|Sans avis"),
        texte('soumettre_texte', "Ce qui t'a bloqué ou manqué dans ce formulaire")
      ] },

    { id: 'accreditations', titre: 'Accréditations photographes', court: 'Accréditations',
      intro: "Les demandes d'accréditation pour des concerts. Réponds seulement si tu as regardé cette page.",
      q: [
        choix('concerne', 'Cette page te concerne-t-elle ?', "Oui, je suis photographe|Non, je l'ai simplement regardée|Je ne l'ai pas ouverte"),
        note('accred', 'La page dans son ensemble'),
        note('comprehension', 'Le fonctionnement (comptes à rebours, inscription, tirage) est-il compréhensible ?'),
        note('villes', 'Le choix par ville'),
        choix('souhait', "Proposer un concert qui n'est pas dans la liste", "Utile|Je ne l'ai pas vu|Pas utile"),
        choix('portfolio', 'Le portfolio et le préremplissage depuis ton profil', "Pratique|Sans avis|Je ne l'ai pas vu"),
        texte('accred_texte', 'Ce que tu changerais pour les photographes')
      ] },

    { id: 'contenu', titre: 'Page Contenu', court: 'Contenu',
      intro: 'La vidéo à la une, les vidéos et les publications Instagram.',
      q: [
        note('contenu', 'La page Contenu dans son ensemble'),
        note('video', 'La vidéo à la une et la bande de vidéos'),
        note('instagram', 'Les publications Instagram'),
        multi('envies', 'Quels contenus aimerais-tu voir ?', "Interviews|Clips|Lives et concerts|Playlists|Actualités du rap français|Portraits d'artistes|Tutoriels|Concours|Coulisses"),
        texte('contenu_texte', 'Autre idée de contenu ?')
      ] },

    { id: 'compte', titre: 'Inscription, connexion et profil vérifié', court: 'Compte',
      intro: "La création du compte et la connexion. Réponds selon ce que tu as essayé.",
      q: [
        multi('methode', "Comment t'es-tu inscrit ou connecté ?", "Adresse e-mail|Google|Spotify|Je n'ai pas créé de compte"),
        note('inscription', "L'inscription en étapes"),
        choix('longueur', "Le nombre d'étapes", 'Trop long|Juste bien|Trop court'),
        note('roles', 'Le choix du rôle (et des rôles supplémentaires)'),
        choix('badge', "Le badge « Profil vérifié » (preuve par capture d'écran)", "Compris et pratique|Compris mais lourd|Pas compris|Je ne l'ai pas vu"),
        choix('bloque', "As-tu été bloqué pendant l'inscription ou la connexion ?", "Non, aucun souci|Un petit souci, résolu|Oui, j'ai abandonné"),
        texte('compte_texte', 'Ce qui était confus ou ce que tu changerais')
      ] },

    { id: 'communaute', titre: 'Communauté', court: 'Communauté',
      intro: 'Le réseau des membres : fil, publications, messages privés, profils des membres.',
      q: [
        note('com', 'La communauté dans son ensemble'),
        note('fil', "Le fil d'actualité"),
        note('publier', 'Publier un message ou une annonce'),
        multi('types', 'Quels types de publication as-tu utilisés ?', 'Message|Question|Partage de son|Collaboration|Aucun'),
        note('messagerie', 'Les messages privés'),
        note('membres', 'Les profils des autres membres et la recherche de membres'),
        choix('cherche', 'Les annonces « Je cherche / Je propose »', "Très utiles|Utiles|Pas utiles|Je ne les ai pas vues"),
        note('mentions', 'Les @mentions, les #tags et les liens (vidéos, sons)'),
        note('notifs', 'Les notifications'),
        choix('securite', "Te sens-tu à l'aise pour échanger avec les autres membres ?", 'Oui|Plutôt oui|Plutôt non|Non'),
        choix('moderation', 'Signaler ou bloquer un membre', "Simple|Je ne l'ai pas trouvé|Je ne l'ai pas testé"),
        texte('com_texte', "Ce qui te ferait revenir dans la communauté, ou t'en éloigne")
      ] },

    { id: 'profil', titre: 'Profil, collection et progression', court: 'Profil',
      intro: 'Ton profil, ta collection de sorties, et la progression : XP, niveaux, succès, séries, quêtes.',
      q: [
        note('profil', 'Ton profil (photo, bannière, bio, liens)'),
        note('collection', "La collection (notes à la demi-étoile, « J'ai écouté », « À écouter », podium)"),
        note('ajout', "L'ajout rapide d'une sortie à ta collection"),
        note('xp', "Le système d'XP et de niveaux"),
        choix('motivant', "L'XP, les succès et les séries te donnent-ils envie de revenir ?", 'Oui, beaucoup|Un peu|Pas vraiment|Non, je préférerais sans'),
        note('succes', 'Les succès'),
        note('quetes', 'Les quêtes du jour et de la semaine, le coffre'),
        note('classement', 'Le classement'),
        choix('parametres', 'Les réglages du profil (engrenage)', "Faciles à trouver|Cachés|Je ne les ai pas utilisés"),
        texte('profil_texte', 'Ce que tu aimerais voir sur ton profil ou dans ta progression')
      ] },

    { id: 'fiabilite', titre: 'Vitesse, fiabilité et mobile', court: 'Technique',
      intro: 'Le côté technique : rapidité, bugs, confort sur téléphone.',
      q: [
        note('vitesse', 'La rapidité générale du site'),
        choix('chargement', 'Les temps de chargement', 'Toujours rapides|Plutôt rapides|Parfois longs|Souvent trop longs'),
        choix('bugs', 'As-tu rencontré des bugs ?', 'Aucun|Quelques-uns mineurs|Des bugs gênants|Des bugs bloquants'),
        texte('bugs_detail', "Décris les bugs (page, ce que tu faisais, ce qui s'est passé)", "Plus c'est précis, mieux c'est : page, action, message affiché…"),
        note('mobile', "Le site sur téléphone (si tu l'as testé)"),
        choix('toucher', 'Les boutons et zones à toucher sur téléphone', "Faciles à toucher|Parfois trop petits|Je n'ai pas testé sur téléphone"),
        choix('plusieurs', 'Le site fonctionne-t-il pareil sur tes différents appareils ?', "Oui|Non|J'en ai utilisé un seul")
      ] },

    { id: 'aide', titre: 'Aide, FAQ et confiance', court: 'Aide',
      intro: "L'aide disponible, les pages légales, et la confiance que tu accordes au site.",
      q: [
        note('faq', 'La FAQ et la page Aide'),
        choix('signaler', 'Saurais-tu comment signaler un problème sur le site ?', 'Oui|Non'),
        choix('legal', 'As-tu lu les mentions légales, la confidentialité ou les conditions ?', 'Oui, en entier|Je les ai parcourues|Non'),
        note('confiance', 'La confiance que tu as dans le site pour tes données personnelles'),
        texte('aide_texte', "Une question que tu t'es posée et dont tu n'as pas trouvé la réponse ?")
      ] },

    { id: 'global', titre: 'Ton avis global', court: 'Global',
      intro: "Pour finir : ton avis d'ensemble, et ce qui compte le plus pour la suite.",
      q: [
        { id: 'nps', q: 'Sur une échelle de 0 à 10, quelle probabilité de recommander La Wave à un proche ?', t: 'nps' },
        note('note_globale', 'Ta note globale pour le site'),
        choix('retour', 'Reviendrais-tu régulièrement sur La Wave ?', 'Tous les jours|Chaque semaine|Chaque mois|Rarement|Non'),
        multi('usages', 'Pour quoi viendrais-tu sur La Wave ?', "Découvrir de nouveaux artistes|Suivre les sorties|Proposer ma musique|M'accréditer pour des concerts|Discuter avec la communauté|Tenir ma collection et noter|Gagner de l'XP et des succès|Lire du contenu|Voir la carte des artistes"),
        multi('priorites', 'Que faut-il améliorer en priorité ?', "Le design|La navigation|Le catalogue|Les fiches artistes|La carte|La communauté|Les messages|La progression (XP, succès)|La vitesse|Le mobile|L'inscription|Le contenu proposé", 'Choisis-en trois au maximum.'),
        texte('aime', "Ce que tu as le plus aimé"),
        texte('naime_pas', "Ce que tu as le moins aimé"),
        texte('manque', "Ce qui manque au site pour qu'il devienne une référence"),
        texte('alternatives', "Que fais-tu aujourd'hui à la place de La Wave ? (sites, applis, comptes…)"),
        choix('recontact', 'Pouvons-nous te recontacter pour en discuter de vive voix ?', 'Oui|Non'),
        texte('autre', 'Autre chose à nous dire ?')
      ] }
  ];

  const ID_TOTAL = SECTIONS.reduce((n, s) => n + s.q.length, 0);
  const cle = (s, q) => s.id + '_' + q.id;

  // ===================================================================
  // OUTILS
  // ===================================================================

  const esc = (t) => String(t == null ? '' : t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');

  const ETOILE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2 6.3 20.3l1.2-6.4L2.8 9.5l6.4-.8z"/></svg>';

  function jeton(){
    try{ return localStorage.getItem(CLE_JETON) || ''; }catch(e){ return ''; }
  }

  function appareil(){
    const w = window.innerWidth;
    return w < 700 ? 'mobile' : (w < 1100 ? 'tablette' : 'ordinateur');
  }

  function repondu(v){
    if(v === undefined || v === null || v === '') return false;
    if(Array.isArray(v)) return v.length > 0;
    return true;
  }

  function heure(iso){
    try{
      return new Date(iso).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    }catch(e){ return ''; }
  }

  // supabaseClient (index.html) envoie le compte connecté ; à défaut, un appel direct suffit pour les testeurs du portail.
  function appeler(nom, args){

    if(typeof supabaseClient !== 'undefined' && supabaseClient && supabaseClient.rpc){
      return supabaseClient.rpc(nom, args || {}).then(({ data, error }) => {
        if(error){
          const e = new Error(error.message || 'Erreur');
          e.code = error.code;
          throw e;
        }
        return data;
      });
    }

    return fetch(SUPABASE_URL + '/rest/v1/rpc/' + nom, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': CLE_PUBLIQUE },
      body: JSON.stringify(args || {})
    }).then(rep => rep.json().catch(() => null).then(corps => {
      if(!rep.ok){
        const e = new Error((corps && corps.message) || ('HTTP ' + rep.status));
        e.code = corps && corps.code;
        throw e;
      }
      return corps;
    }));
  }

  function absent(e){
    return e && (e.code === 'PGRST202' || /Could not find the function/i.test(e.message || ''));
  }

  // ===================================================================
  // LA PAGE DU SONDAGE (testeurs)
  // ===================================================================

  const etat = {
    reponses: {},
    section: 0,
    termine: false,
    montrerMerci: false,
    charge: false,
    enregistre: '',
    envoi: false,
    erreur: ''
  };

  let racine = null;
  let minuteur = null;
  let aEnvoyer = false;

  function lireBrouillon(){
    try{
      const brut = localStorage.getItem(CLE_BROUILLON);
      const objet = brut ? JSON.parse(brut) : {};
      return objet && typeof objet === 'object' && !Array.isArray(objet) ? objet : {};
    }catch(e){ return {}; }
  }

  function ecrireBrouillon(){
    try{ localStorage.setItem(CLE_BROUILLON, JSON.stringify(etat.reponses)); }catch(e){}
  }

  function compte(){
    let n = 0;
    SECTIONS.forEach(s => s.q.forEach(q => { if(repondu(etat.reponses[cle(s, q)])) n++; }));
    return n;
  }

  function pourcent(){
    return Math.round(compte() / ID_TOTAL * 100);
  }

  function noterFini(){
    try{ localStorage.setItem(CLE_FINI, etat.termine ? '1' : ''); }catch(e){}
    const b = document.getElementById('sondageFlottant');
    if(b) b.classList.toggle('sdg-fini', etat.termine);
  }

  function majEtatEnregistrement(texte){
    etat.enregistre = texte;
    const el = racine && racine.querySelector('.sdg-etat');
    if(el) el.textContent = texte;
  }

  // Enregistrement : tout de suite dans le navigateur, puis, un instant après le dernier geste, sur le serveur.
  function programmer(){
    ecrireBrouillon();
    aEnvoyer = true;
    clearTimeout(minuteur);
    minuteur = setTimeout(() => { enregistrer(false); }, 1500);
    majEtatEnregistrement('Modifications en cours…');
  }

  function enregistrer(final){

    clearTimeout(minuteur);

    if(!aEnvoyer && !final) return Promise.resolve();

    aEnvoyer = false;

    return appeler('sondage_enregistrer', {
      p_jeton: jeton(),
      p_reponses: etat.reponses,
      p_termine: !!final,
      p_progression: pourcent(),
      p_appareil: appareil()
    }).then(() => {
      if(final){ etat.termine = true; noterFini(); }
      majEtatEnregistrement('Enregistré à ' + new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }));
    }).catch(e => {
      aEnvoyer = true;
      majEtatEnregistrement(absent(e)
        ? "Le sondage n'est pas encore activé sur le serveur."
        : "Pas enregistré sur le serveur pour l'instant : tes réponses restent sur cet appareil, nous réessaierons.");
      if(final) throw e;
    });
  }

  function chargerMesReponses(){

    const brouillon = lireBrouillon();

    return appeler('sondage_mien', { p_jeton: jeton() }).then(rep => {

      const serveur = (rep && rep.reponses) || {};

      // Le brouillon de cet appareil gagne s'il est plus complet : il peut contenir des réponses pas encore envoyées.
      const nb = (o) => Object.keys(o).filter(k => repondu(o[k])).length;

      etat.reponses = nb(brouillon) >= nb(serveur) ? brouillon : serveur;
      etat.termine = !!(rep && rep.termine);
      if(rep && rep.maj_le) etat.enregistre = 'Dernier enregistrement : ' + heure(rep.maj_le);
      etat.erreur = '';

    }).catch(e => {
      etat.reponses = brouillon;
      etat.erreur = absent(e) ? "Le sondage n'est pas encore activé sur le serveur. Reviens dans un instant." : '';
    }).then(() => {
      etat.charge = true;
      noterFini();
    });
  }

  function questionHtml(s, q){

    const id = cle(s, q);
    const v = etat.reponses[id];
    let corps = '';

    if(q.t === 'note'){
      const n = typeof v === 'number' ? v : 0;
      corps = '<div class="sdg-etoiles" role="radiogroup" aria-label="' + esc(q.q) + '">' +
        [1, 2, 3, 4, 5].map(i =>
          '<button type="button" class="sdg-etoile' + (n >= i ? ' on' : '') + '" data-note="' + i + '" role="radio" aria-checked="' + (n === i) + '" aria-label="' + i + ' sur 5">' + ETOILE + '</button>'
        ).join('') +
        '<button type="button" class="sdg-na' + (v === 'na' ? ' on' : '') + '" data-note="na">Pas testé</button>' +
        '<span class="sdg-valeur">' + (n ? n + '/5' : '') + '</span></div>';
    }

    else if(q.t === 'choix'){
      corps = '<div class="sdg-puces" role="radiogroup" aria-label="' + esc(q.q) + '">' +
        q.o.map(o => '<button type="button" class="sdg-puce' + (v === o ? ' on' : '') + '" role="radio" aria-checked="' + (v === o) + '" data-choix="' + esc(o) + '">' + esc(o) + '</button>').join('') +
        '</div>';
    }

    else if(q.t === 'multi'){
      const liste = Array.isArray(v) ? v : [];
      corps = '<div class="sdg-puces" role="group" aria-label="' + esc(q.q) + '">' +
        q.o.map(o => '<button type="button" class="sdg-puce' + (liste.includes(o) ? ' on' : '') + '" aria-pressed="' + liste.includes(o) + '" data-multi="' + esc(o) + '">' + esc(o) + '</button>').join('') +
        '</div>';
    }

    else if(q.t === 'nps'){
      corps = '<div class="sdg-nps" role="radiogroup" aria-label="' + esc(q.q) + '">' +
        Array.from({ length: 11 }, (_, i) =>
          '<button type="button" class="sdg-n' + (v === i ? ' on' : '') + '" role="radio" aria-checked="' + (v === i) + '" data-nps="' + i + '">' + i + '</button>'
        ).join('') +
        '</div><div class="sdg-legende"><span>Pas du tout</span><span>Absolument</span></div>';
    }

    else{
      corps = '<textarea class="sdg-texte" rows="3" maxlength="' + TEXTE_MAX + '" placeholder="' + esc(q.ph) + '" aria-label="' + esc(q.q) + '">' + esc(v || '') + '</textarea>';
    }

    return '<div class="sdg-q' + (repondu(v) ? ' fait' : '') + '" data-id="' + id + '">' +
      '<p class="sdg-q-titre">' + esc(q.q) + (q.aide ? ' <small>' + esc(q.aide) + '</small>' : '') + '</p>' + corps + '</div>';
  }

  function navHtml(){
    return '<nav class="sdg-nav" aria-label="Sections du sondage">' + SECTIONS.map((s, i) => {
      const faites = s.q.filter(q => repondu(etat.reponses[cle(s, q)])).length;
      const etatS = faites === s.q.length ? ' complet' : (faites ? ' partiel' : '');
      return '<button type="button" class="sdg-chip' + (i === etat.section ? ' actif' : '') + etatS + '" data-aller="' + i + '">' +
        '<span class="sdg-chip-n">' + (faites === s.q.length ? '✓' : (i + 1)) + '</span>' + esc(s.court) + '</button>';
    }).join('') + '</nav>';
  }

  function libelleProgression(){
    const n = compte();
    return n + ' réponse' + (n > 1 ? 's' : '') + ' sur ' + ID_TOTAL + ' · ' + pourcent() + ' %';
  }

  function majProgression(){
    if(!racine) return;
    const barre = racine.querySelector('.sdg-barre i');
    const lib = racine.querySelector('.sdg-progression-texte');
    if(barre) barre.style.width = pourcent() + '%';
    if(lib) lib.textContent = libelleProgression();
    const nav = racine.querySelector('.sdg-nav');
    if(nav){
      const defil = nav.scrollLeft;
      nav.outerHTML = navHtml();
      const neuf = racine.querySelector('.sdg-nav');
      if(neuf) neuf.scrollLeft = defil;
    }
  }

  function remerciementHtml(){
    return '<div class="sdg-merci">' +
      '<div class="sdg-merci-ic" aria-hidden="true">' + ETOILE + '</div>' +
      '<h2>Merci, vraiment.</h2>' +
      "<p>Tes réponses sont bien arrivées chez l'équipe La Wave. Elles vont directement servir à décider ce qu'on améliore en premier.</p>" +
      '<p>Tu as pensé à autre chose ? Tu peux revenir compléter ou modifier tes réponses à tout moment : le bouton flottant « Ton avis » te ramène ici.</p>' +
      '<div class="sdg-actions"><button type="button" class="btn btn-ghost" data-modifier>Modifier mes réponses</button> ' +
      '<button type="button" class="btn btn-primary" data-accueil>Retour au site</button></div></div>';
  }

  function rendre(){

    if(!racine) return;

    if(!etat.charge){
      racine.innerHTML = '<div class="empty-state chargement">Chargement du sondage…</div>';
      return;
    }

    const s = SECTIONS[etat.section];
    const premiere = etat.section === 0;
    const derniere = etat.section === SECTIONS.length - 1;

    racine.innerHTML =
      '<span class="eyebrow mono">Phase de test</span>' +
      '<h1>Ton avis sur La Wave</h1>' +
      "<p class=\"sdg-intro\">Merci de tester le site. Ce sondage couvre toutes ses pages : compte 15 à 25 minutes, et <b>tu peux t'arrêter et reprendre quand tu veux</b> : tout est enregistré au fur et à mesure. Aucune question n'est obligatoire. Les notes vont de <b>1 (très mauvais)</b> à <b>5 (excellent)</b> ; « Pas testé » si tu n'as pas essayé. Tes réponses sont lues par l'équipe La Wave uniquement, avec ton adresse d'accès.</p>" +
      (etat.erreur ? '<div class="form-msg err" style="display:block">' + esc(etat.erreur) + '</div>' : '') +
      '<div class="sdg-progression"><div class="sdg-barre"><i style="width:' + pourcent() + '%"></i></div>' +
      '<span class="sdg-progression-texte">' + libelleProgression() + '</span></div>' +
      navHtml() +
      (etat.termine && etat.montrerMerci ? remerciementHtml() :
        '<section class="sdg-section" aria-labelledby="sdgTitre">' +
        '<p class="sdg-etape mono">Section ' + (etat.section + 1) + ' sur ' + SECTIONS.length + '</p>' +
        '<h2 id="sdgTitre">' + esc(s.titre) + '</h2>' +
        '<p class="sdg-section-intro">' + esc(s.intro) + '</p>' +
        s.q.map(q => questionHtml(s, q)).join('') +
        '<div class="sdg-pied">' +
        '<button type="button" class="btn btn-ghost" data-prec' + (premiere ? ' disabled' : '') + '>← Précédent</button>' +
        '<span class="sdg-etat" aria-live="polite">' + esc(etat.enregistre) + '</span>' +
        (derniere
          ? '<button type="button" class="btn btn-primary" data-envoyer' + (etat.envoi ? ' disabled' : '') + '>' + (etat.termine ? 'Mettre à jour mes réponses' : 'Envoyer mes réponses') + '</button>'
          : '<button type="button" class="btn btn-primary" data-suiv>Suivant →</button>') +
        '</div></section>');

    // La puce de la section active reste visible dans la barre défilante.
    const actif = racine.querySelector('.sdg-chip.actif');
    if(actif){
      const nav = actif.parentElement;
      const a = actif.getBoundingClientRect();
      const n = nav.getBoundingClientRect();
      nav.scrollLeft += (a.left + a.width / 2) - (n.left + n.width / 2);
    }
  }

  function changerSection(i){
    if(i < 0 || i >= SECTIONS.length) return;
    enregistrer(false);
    etat.section = i;
    etat.montrerMerci = false;
    rendre();
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  function remplacerQuestion(id){
    const bloc = racine.querySelector('.sdg-q[data-id="' + id + '"]');
    if(!bloc) return;
    const s = SECTIONS[etat.section];
    const q = s.q.find(x => cle(s, x) === id);
    if(!q) return;
    const tmp = document.createElement('div');
    tmp.innerHTML = questionHtml(s, q);
    bloc.replaceWith(tmp.firstElementChild);
  }

  function reponse(id, valeur){
    if(repondu(valeur)) etat.reponses[id] = valeur;
    else delete etat.reponses[id];
    programmer();
    majProgression();
  }

  function surClic(e){

    const cible = e.target.closest('button');
    if(!cible || !racine.contains(cible)) return;

    const bloc = cible.closest('.sdg-q');
    const id = bloc && bloc.dataset.id;

    if(cible.dataset.note !== undefined && id){
      const v = cible.dataset.note === 'na' ? 'na' : Number(cible.dataset.note);
      reponse(id, etat.reponses[id] === v ? undefined : v);
      remplacerQuestion(id);
    }

    else if(cible.dataset.choix !== undefined && id){
      const v = cible.dataset.choix;
      reponse(id, etat.reponses[id] === v ? undefined : v);
      remplacerQuestion(id);
    }

    else if(cible.dataset.multi !== undefined && id){
      const v = cible.dataset.multi;
      const liste = Array.isArray(etat.reponses[id]) ? etat.reponses[id].slice() : [];
      const pos = liste.indexOf(v);
      if(pos >= 0) liste.splice(pos, 1);
      else{
        liste.push(v);
        // « Que faut-il améliorer en priorité ? » : trois au plus, le plus ancien choix cède la place.
        if(id === 'global_priorites' && liste.length > 3) liste.shift();
      }
      reponse(id, liste);
      remplacerQuestion(id);
    }

    else if(cible.dataset.nps !== undefined && id){
      const v = Number(cible.dataset.nps);
      reponse(id, etat.reponses[id] === v ? undefined : v);
      remplacerQuestion(id);
    }

    else if(cible.dataset.aller !== undefined) changerSection(Number(cible.dataset.aller));
    else if(cible.hasAttribute('data-prec')) changerSection(etat.section - 1);
    else if(cible.hasAttribute('data-suiv')) changerSection(etat.section + 1);
    else if(cible.hasAttribute('data-envoyer')) envoyer();
    else if(cible.hasAttribute('data-modifier')){
      etat.montrerMerci = false;
      etat.section = 0;
      rendre();
      window.scrollTo({ top: 0, behavior: 'instant' });
    }
    else if(cible.hasAttribute('data-accueil')){
      if(typeof goTo === 'function') goTo('home');
    }
  }

  function surSaisie(e){
    const zone = e.target.closest('textarea.sdg-texte');
    if(!zone) return;
    const bloc = zone.closest('.sdg-q');
    reponse(bloc.dataset.id, zone.value.trim() ? zone.value : undefined);
    bloc.classList.toggle('fait', !!zone.value.trim());
  }

  function envoyer(){

    if(etat.envoi) return;

    if(compte() === 0){
      etat.erreur = "Tu n'as encore répondu à aucune question : réponds à au moins une question avant d'envoyer.";
      rendre();
      return;
    }

    etat.envoi = true;
    etat.erreur = '';
    rendre();

    enregistrer(true).then(() => {
      etat.envoi = false;
      etat.montrerMerci = true;
      rendre();
      window.scrollTo({ top: 0, behavior: 'instant' });
    }).catch(() => {
      etat.envoi = false;
      etat.erreur = "L'envoi a échoué. Vérifie ta connexion : tes réponses sont gardées sur cet appareil, réessaie dans un instant.";
      rendre();
    });
  }

  function ouvrir(){

    racine = document.getElementById('sondageRacine');
    if(!racine) return;

    if(!racine.dataset.pret){
      racine.dataset.pret = '1';
      racine.addEventListener('click', surClic);
      racine.addEventListener('input', surSaisie);
    }

    etat.charge = false;
    etat.montrerMerci = false;
    rendre();
    chargerMesReponses().then(rendre);
  }

  // ===================================================================
  // LE BOUTON FLOTTANT
  // ===================================================================

  function monterBouton(){

    if(document.getElementById('sondageFlottant')) return;

    const a = document.createElement('a');
    a.id = 'sondageFlottant';
    a.className = 'sdg-flottant';
    a.href = '#sondage';
    a.setAttribute('aria-label', 'Donner mon avis : sondage des testeurs');
    a.title = 'Donner mon avis sur le site';
    a.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.7 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/><path d="M9 10.5h6M9 13.5h3.5"/></svg>' +
      '<span class="sdg-flottant-texte">Ton avis</span><i class="sdg-point" aria-hidden="true"></i>';

    a.addEventListener('click', (e) => {
      e.preventDefault();
      if(typeof goTo === 'function') goTo('sondage');
      else location.hash = '#sondage';
    });

    document.body.appendChild(a);

    try{ if(localStorage.getItem(CLE_FINI) === '1') a.classList.add('sdg-fini'); }catch(e){}
  }

  // ===================================================================
  // L'ONGLET « SONDAGE » DE L'ESPACE ÉQUIPE
  // ===================================================================

  const equipe = { lignes: [], vue: 'synthese', filtre: 'toutes' };

  function moyenne(valeurs){
    return valeurs.length ? valeurs.reduce((a, b) => a + b, 0) / valeurs.length : 0;
  }

  function nomTesteur(l){
    return l.nom && l.nom.trim() ? l.nom.trim() : l.email;
  }

  function barre(libelle, n, total){
    const p = total ? Math.round(n / total * 100) : 0;
    return '<li style="--p:' + p + '%"><span>' + esc(libelle) + '</span><b>' + n + ' <small>' + p + ' %</small></b></li>';
  }

  function synthese(lignes){

    return SECTIONS.map(s => {

      const items = s.q.map(q => {

        const id = cle(s, q);
        const vals = lignes.map(l => l.reponses[id]).filter(repondu);
        const n = vals.length;
        let corps = '';

        if(q.t === 'note'){
          const notes = vals.filter(v => typeof v === 'number');
          const pas = vals.filter(v => v === 'na').length;
          corps = '<div class="sdg-agg-note"><b>' + (notes.length ? moyenne(notes).toFixed(1).replace('.', ',') : '–') + '</b><span>/ 5 · ' + notes.length + ' note' + (notes.length > 1 ? 's' : '') + (pas ? ' · ' + pas + ' « pas testé »' : '') + '</span></div>' +
            '<ul class="sdg-agg-liste">' + [5, 4, 3, 2, 1].map(i => barre(i + ' ★', notes.filter(v => v === i).length, notes.length)).join('') + '</ul>';
        }

        else if(q.t === 'choix'){
          corps = '<ul class="sdg-agg-liste">' + q.o.map(o => barre(o, vals.filter(v => v === o).length, n)).join('') + '</ul>';
        }

        else if(q.t === 'multi'){
          corps = '<ul class="sdg-agg-liste">' + q.o.map(o => barre(o, vals.filter(v => Array.isArray(v) && v.includes(o)).length, n)).join('') + '</ul>';
        }

        else if(q.t === 'nps'){
          const notes = vals.filter(v => typeof v === 'number');
          const pro = notes.filter(v => v >= 9).length;
          const det = notes.filter(v => v <= 6).length;
          const score = notes.length ? Math.round((pro - det) / notes.length * 100) : null;
          corps = '<div class="sdg-agg-note"><b>' + (score === null ? '–' : (score > 0 ? '+' : '') + score) + '</b><span>NPS · ' + pro + ' promoteur(s), ' + det + ' détracteur(s), ' + (notes.length - pro - det) + ' passif(s)</span></div>' +
            '<ul class="sdg-agg-liste">' + Array.from({ length: 11 }, (_, i) => barre(String(i), notes.filter(v => v === i).length, notes.length)).join('') + '</ul>';
        }

        else{
          corps = '<p class="sdg-agg-texte">' + n + ' réponse' + (n > 1 ? 's' : '') + ' écrite' + (n > 1 ? 's' : '') + ' : voir « Réponses libres ».</p>';
        }

        return '<div class="sdg-agg"><h5>' + esc(q.q) + ' <small>' + n + ' réponse' + (n > 1 ? 's' : '') + '</small></h5>' + corps + '</div>';
      }).join('');

      return '<details class="sdg-bloc" open><summary>' + esc(s.titre) + '</summary><div class="sdg-agg-grille">' + items + '</div></details>';
    }).join('');
  }

  function reponsesLibres(lignes){

    const html = SECTIONS.filter(s => equipe.filtre === 'toutes' || s.id === equipe.filtre).map(s => {

      const blocs = s.q.filter(q => q.t === 'texte').map(q => {

        const id = cle(s, q);
        const liste = lignes
          .map(l => ({ l, v: l.reponses[id] }))
          .filter(x => typeof x.v === 'string' && x.v.trim());

        if(!liste.length) return '';

        return '<div class="sdg-libre"><h5>' + esc(q.q) + ' <small>' + liste.length + ' réponse' + (liste.length > 1 ? 's' : '') + '</small></h5>' +
          liste.map(x => '<blockquote><p>' + esc(x.v).replace(/\n/g, '<br>') + '</p><cite>' + esc(nomTesteur(x.l)) + '</cite></blockquote>').join('') +
          '</div>';
      }).join('');

      return blocs ? '<h4 class="sdg-sous-titre">' + esc(s.titre) + '</h4>' + blocs : '';
    }).join('');

    return html || '<div class="empty-state">Aucune réponse écrite pour l\'instant.</div>';
  }

  function valeurLisible(q, v){
    if(Array.isArray(v)) return v.join(', ');
    if(v === 'na') return 'Pas testé';
    if(q.t === 'note') return v + ' / 5';
    return String(v);
  }

  function parTesteur(lignes){

    return lignes.map(l => {

      const detail = SECTIONS.map(s => {
        const rep = s.q.filter(q => repondu(l.reponses[cle(s, q)]));
        if(!rep.length) return '';
        return '<h5>' + esc(s.titre) + '</h5><dl>' + rep.map(q =>
          '<dt>' + esc(q.q) + '</dt><dd>' + esc(valeurLisible(q, l.reponses[cle(s, q)])).replace(/\n/g, '<br>') + '</dd>').join('') + '</dl>';
      }).join('');

      return '<details class="sdg-testeur"><summary>' +
        '<span class="sdg-testeur-nom">' + esc(nomTesteur(l)) + (l.nom ? ' <small>' + esc(l.email) + '</small>' : '') + '</span>' +
        '<span class="sdg-testeur-meta">' + (l.termine ? '<em class="ok">Envoyé</em>' : '<em>En cours</em>') + ' · ' + l.progression + ' % · ' + esc(l.appareil || '?') + ' · ' + esc(heure(l.maj_le)) + '</span></summary>' +
        '<div class="sdg-testeur-corps">' + (detail || '<p>Aucune réponse.</p>') +
        '<button type="button" class="btn btn-ghost sdg-suppr" data-suppr="' + esc(l.email) + '">Supprimer cette réponse</button></div></details>';
    }).join('');
  }

  function exporterCsv(){

    const colonnes = [];
    SECTIONS.forEach(s => s.q.forEach(q => colonnes.push({ s, q })));

    const celle = (t) => '"' + String(t == null ? '' : t).replace(/"/g, '""') + '"';

    const entete = ['Adresse e-mail', 'Nom', 'Envoyé', 'Progression (%)', 'Appareil', 'Dernière modification']
      .concat(colonnes.map(c => c.s.titre + ' — ' + c.q.q));

    const lignes = equipe.lignes.map(l => [
      l.email, l.nom || '', l.termine ? 'oui' : 'non', l.progression, l.appareil || '', l.maj_le
    ].concat(colonnes.map(c => {
      const v = l.reponses[cle(c.s, c.q)];
      return repondu(v) ? valeurLisible(c.q, v) : '';
    })));

    const csv = '﻿' + [entete].concat(lignes).map(r => r.map(celle).join(';')).join('\r\n');
    const lien = document.createElement('a');
    lien.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    lien.download = 'sondage-la-wave-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(lien);
    lien.click();
    setTimeout(() => { URL.revokeObjectURL(lien.href); lien.remove(); }, 500);
  }

  function rendreEquipe(){

    const zone = document.getElementById('sondageEquipe');
    if(!zone) return;

    const lignes = equipe.lignes;
    const envoyes = lignes.filter(l => l.termine).length;
    const prog = Math.round(moyenne(lignes.map(l => l.progression)));
    const notesG = lignes.map(l => l.reponses.global_note_globale).filter(v => typeof v === 'number');
    const nps = lignes.map(l => l.reponses.global_nps).filter(v => typeof v === 'number');
    const score = nps.length ? Math.round((nps.filter(v => v >= 9).length - nps.filter(v => v <= 6).length) / nps.length * 100) : null;

    const vues = [['synthese', 'Synthèse'], ['libres', 'Réponses libres'], ['testeurs', 'Par testeur']];

    zone.innerHTML =
      '<div class="sdg-eq-tete">' +
      '<div class="sdg-cartes">' +
      '<div class="sdg-carte"><b>' + lignes.length + '</b><span>testeur' + (lignes.length > 1 ? 's' : '') + ' ont répondu</span></div>' +
      '<div class="sdg-carte"><b>' + envoyes + '</b><span>sondage' + (envoyes > 1 ? 's' : '') + ' envoyé' + (envoyes > 1 ? 's' : '') + '</span></div>' +
      '<div class="sdg-carte"><b>' + (lignes.length ? prog + ' %' : '–') + '</b><span>de progression moyenne</span></div>' +
      '<div class="sdg-carte"><b>' + (notesG.length ? moyenne(notesG).toFixed(1).replace('.', ',') + '/5' : '–') + '</b><span>note globale</span></div>' +
      '<div class="sdg-carte"><b>' + (score === null ? '–' : (score > 0 ? '+' : '') + score) + '</b><span>NPS (recommandation)</span></div>' +
      '</div>' +
      '<div class="sdg-eq-actions"><button type="button" class="btn btn-ghost" data-recharger>Actualiser</button> ' +
      '<button type="button" class="btn btn-ghost" data-csv' + (lignes.length ? '' : ' disabled') + '>Exporter en CSV</button></div></div>' +
      '<div class="sdg-vues" role="tablist">' + vues.map(v => '<button type="button" role="tab" class="' + (equipe.vue === v[0] ? 'on' : '') + '" data-vue="' + v[0] + '">' + v[1] + '</button>').join('') + '</div>' +
      (equipe.vue === 'libres'
        ? '<label class="sdg-filtre">Section <select data-filtre><option value="toutes">Toutes</option>' + SECTIONS.map(s => '<option value="' + s.id + '"' + (equipe.filtre === s.id ? ' selected' : '') + '>' + esc(s.titre) + '</option>').join('') + '</select></label>'
        : '') +
      (!lignes.length
        ? '<div class="empty-state">Aucune réponse pour l\'instant. Elles apparaîtront ici dès que les testeurs commenceront le sondage.</div>'
        : equipe.vue === 'synthese' ? synthese(lignes) : equipe.vue === 'libres' ? reponsesLibres(lignes) : parTesteur(lignes));
  }

  function chargerEquipe(){

    const zone = document.getElementById('sondageEquipe');
    if(!zone) return Promise.resolve();

    if(!zone.dataset.pret){
      zone.dataset.pret = '1';

      zone.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if(!b) return;
        if(b.dataset.vue){ equipe.vue = b.dataset.vue; rendreEquipe(); }
        else if(b.hasAttribute('data-recharger')) chargerEquipe();
        else if(b.hasAttribute('data-csv')) exporterCsv();
        else if(b.dataset.suppr){
          if(b.dataset.confirme === b.dataset.suppr){
            appeler('sondage_equipe_supprimer', { p_email: b.dataset.suppr }).then(chargerEquipe)
              .catch(() => { b.textContent = 'Échec de la suppression'; });
          }else{
            b.dataset.confirme = b.dataset.suppr;
            b.textContent = 'Confirmer la suppression ?';
          }
        }
      });

      zone.addEventListener('change', (e) => {
        if(e.target.matches('[data-filtre]')){ equipe.filtre = e.target.value; rendreEquipe(); }
      });
    }

    zone.innerHTML = '<div class="empty-state chargement">Chargement…</div>';

    return appeler('sondage_equipe_lire').then(data => {
      equipe.lignes = Array.isArray(data) ? data : [];
      rendreEquipe();
    }).catch(e => {
      zone.innerHTML = '<div class="form-msg err" style="display:block">' + esc(absent(e)
        ? "Le sondage n'est pas encore activé : passe sql/sondage.sql dans Supabase."
        : 'Impossible de charger les réponses : ' + (e.message || 'erreur')) + '</div>';
    });
  }

  // ===================================================================
  // LA FEUILLE DE STYLE
  // ===================================================================

  const FEUILLE = `
.sdg-flottant{
  position:fixed; left:18px; bottom:20px; z-index:85; display:flex; align-items:center; gap:8px;
  padding:11px 15px 11px 13px; border-radius:999px; text-decoration:none; color:#fff;
  background:linear-gradient(135deg,#0f78c4,#1489DE); border:1px solid rgba(255,255,255,0.22);
  box-shadow:0 8px 24px rgba(10,60,110,0.45); font-size:13px; font-weight:600; line-height:1;
  transition:transform .2s ease, box-shadow .2s ease;
  animation:sdg-flotte 4.5s ease-in-out infinite;
}
.sdg-flottant svg{width:20px; height:20px; flex:none;}
.sdg-flottant:hover{transform:translateY(-3px); box-shadow:0 12px 30px rgba(10,60,110,0.55); animation-play-state:paused;}
.sdg-flottant:focus-visible{outline:2px solid #fff; outline-offset:3px;}
.sdg-flottant .sdg-point{position:absolute; top:-2px; right:-2px; width:12px; height:12px; border-radius:50%; background:#E5695C; border:2px solid var(--bg,#05070a);}
.sdg-flottant.sdg-fini .sdg-point{display:none;}
@keyframes sdg-flotte{0%,100%{transform:translateY(0);} 50%{transform:translateY(-5px);}}
@media (prefers-reduced-motion:reduce){ .sdg-flottant{animation:none;} }
@media (max-width:700px){
  .sdg-flottant{left:14px; bottom:14px; padding:12px; gap:0;}
  .sdg-flottant-texte{position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0);}
}
body.com-actif .sdg-flottant{bottom:84px;}
html.portail-actif .sdg-flottant,
body:has(#page-sondage.active) .sdg-flottant,
body:has(#page-admin.active) .sdg-flottant{display:none;}

#page-sondage .doc{max-width:820px;}
.sdg-intro{margin:0 0 18px;}
.sdg-progression{display:flex; align-items:center; gap:14px; margin:0 0 14px;}
.sdg-barre{flex:1; height:8px; border-radius:999px; background:var(--bg-alt); overflow:hidden;}
.sdg-barre i{display:block; height:100%; width:0; border-radius:999px; background:linear-gradient(90deg,#0f78c4,var(--blue-bright)); transition:width .35s ease;}
.sdg-progression-texte{font-size:13px; color:var(--muted); white-space:nowrap; font-variant-numeric:tabular-nums;}
.sdg-nav{display:flex; gap:8px; overflow-x:auto; padding:2px 0 12px; margin:0 0 6px; scrollbar-width:thin;}
.sdg-chip{flex:none; display:inline-flex; align-items:center; gap:7px; padding:8px 13px 8px 8px; border:1px solid var(--line); border-radius:999px; background:var(--bg-alt); color:var(--ink-soft); font:inherit; font-size:13px; cursor:pointer; transition:border-color .2s, background .2s, color .2s;}
.sdg-chip:hover{border-color:rgba(255,255,255,0.28); color:var(--ink);}
.sdg-chip-n{display:inline-grid; place-items:center; width:22px; height:22px; border-radius:50%; background:rgba(255,255,255,0.08); font-size:11px; font-weight:700;}
.sdg-chip.partiel .sdg-chip-n{background:rgba(79,180,255,0.22); color:var(--blue-bright);}
.sdg-chip.complet .sdg-chip-n{background:rgba(94,201,140,0.25); color:#7be0a8;}
.sdg-chip.actif{border-color:var(--blue-bright); background:rgba(79,180,255,0.12); color:var(--ink);}
.sdg-section{padding:6px 0 10px;}
.sdg-section h2{margin:4px 0 6px;}
.sdg-etape{margin:12px 0 0; font-size:12px; color:var(--muted); letter-spacing:.04em; text-transform:uppercase;}
.sdg-section-intro{margin:0 0 18px;}
.sdg-q{padding:16px 18px; margin:0 0 12px; border:1px solid var(--line); border-radius:14px; background:var(--bg-alt); transition:border-color .25s;}
.sdg-q.fait{border-color:rgba(79,180,255,0.35);}
.sdg-q-titre{margin:0 0 12px; color:var(--ink); font-size:15px; font-weight:600; line-height:1.45;}
.sdg-q-titre small{display:block; margin-top:2px; font-weight:400; color:var(--muted); font-size:12px;}
.sdg-etoiles{display:flex; align-items:center; flex-wrap:wrap; gap:6px;}
.sdg-etoile{width:42px; height:42px; padding:0; border:0; border-radius:10px; background:transparent; color:rgba(255,255,255,0.22); cursor:pointer; transition:transform .15s, color .15s;}
.sdg-etoile svg{width:30px; height:30px; fill:currentColor; display:block; margin:auto;}
.sdg-etoile:hover{transform:scale(1.12); color:rgba(255,200,80,0.7);}
.sdg-etoile.on{color:#ffc850;}
.sdg-na{margin-left:6px; padding:8px 12px; border:1px dashed var(--line); border-radius:999px; background:transparent; color:var(--muted); font:inherit; font-size:12px; cursor:pointer;}
.sdg-na.on{border-style:solid; border-color:var(--blue-bright); color:var(--ink); background:rgba(79,180,255,0.12);}
.sdg-valeur{margin-left:8px; font-size:13px; color:var(--muted); font-variant-numeric:tabular-nums;}
.sdg-puces{display:flex; flex-wrap:wrap; gap:8px;}
.sdg-puce{padding:9px 14px; border:1px solid var(--line); border-radius:999px; background:transparent; color:var(--ink-soft); font:inherit; font-size:13.5px; line-height:1.25; text-align:left; cursor:pointer; transition:border-color .15s, background .15s, color .15s;}
.sdg-puce:hover{border-color:rgba(255,255,255,0.3); color:var(--ink);}
.sdg-puce.on{border-color:var(--blue-bright); background:rgba(79,180,255,0.16); color:var(--ink);}
.sdg-nps{display:grid; grid-template-columns:repeat(11, minmax(0,1fr)); gap:5px;}
.sdg-n{padding:11px 0; border:1px solid var(--line); border-radius:9px; background:transparent; color:var(--ink-soft); font:inherit; font-size:14px; cursor:pointer; font-variant-numeric:tabular-nums;}
.sdg-n:hover{border-color:rgba(255,255,255,0.3);}
.sdg-n.on{border-color:var(--blue-bright); background:rgba(79,180,255,0.2); color:var(--ink); font-weight:700;}
.sdg-legende{display:flex; justify-content:space-between; margin-top:6px; font-size:12px; color:var(--muted);}
.sdg-texte{width:100%; min-height:84px; padding:12px 14px; border:1px solid var(--line); border-radius:10px; background:rgba(0,0,0,0.25); color:var(--ink); font:inherit; font-size:14.5px; line-height:1.55; resize:vertical;}
.sdg-texte:focus{outline:none; border-color:var(--blue-bright);}
.sdg-pied{display:flex; align-items:center; justify-content:space-between; gap:12px; margin-top:20px; flex-wrap:wrap;}
.sdg-etat{flex:1; text-align:center; font-size:12px; color:var(--muted); min-width:120px;}
.sdg-merci{padding:34px 22px; text-align:center; border:1px solid var(--line); border-radius:16px; background:var(--bg-alt);}
.sdg-merci-ic{display:inline-grid; place-items:center; width:58px; height:58px; margin-bottom:12px; border-radius:50%; background:rgba(255,200,80,0.15); color:#ffc850;}
.sdg-merci-ic svg{width:30px; height:30px; fill:currentColor;}
.sdg-actions{display:flex; gap:10px; justify-content:center; flex-wrap:wrap; margin-top:16px;}
@media (max-width:700px){
  .sdg-q{padding:14px;}
  .sdg-nps{grid-template-columns:repeat(6, minmax(0,1fr));}
  .sdg-etape{margin-top:6px;}
  .sdg-progression{flex-direction:column; align-items:stretch; gap:6px;}
  .sdg-progression-texte{white-space:normal;}
  .sdg-pied .btn{flex:1;}
  .sdg-etat{order:3; flex-basis:100%;}
}

/* Espace équipe */
#sondageEquipe .sdg-eq-tete{display:flex; align-items:flex-start; justify-content:space-between; gap:16px; flex-wrap:wrap; margin-bottom:18px;}
#sondageEquipe .sdg-cartes{display:grid; grid-template-columns:repeat(5, minmax(110px,1fr)); gap:10px; flex:1; min-width:280px;}
#sondageEquipe .sdg-carte{padding:14px 16px; border:1px solid var(--line); border-radius:12px; background:var(--bg-alt);}
#sondageEquipe .sdg-carte b{display:block; font-size:26px; line-height:1.1; color:var(--ink); font-variant-numeric:tabular-nums;}
#sondageEquipe .sdg-carte span{display:block; margin-top:5px; font-size:12px; color:var(--muted);}
#sondageEquipe .sdg-eq-actions{display:flex; gap:8px; flex-wrap:wrap;}
#sondageEquipe .sdg-vues{display:inline-flex; gap:4px; padding:4px; border:1px solid var(--line); border-radius:999px; background:var(--bg-alt); margin-bottom:16px;}
#sondageEquipe .sdg-vues button{padding:8px 16px; border:0; border-radius:999px; background:transparent; color:var(--muted); font:inherit; font-size:13px; font-weight:600; cursor:pointer;}
#sondageEquipe .sdg-vues button.on{background:rgba(255,255,255,0.12); color:var(--ink);}
#sondageEquipe .sdg-filtre{display:flex; align-items:center; gap:10px; margin:0 0 14px; font-size:13px; color:var(--muted);}
#sondageEquipe .sdg-filtre select{padding:8px 12px; border:1px solid var(--line); border-radius:10px; background:var(--bg-alt); color:var(--ink); font:inherit;}
#sondageEquipe .sdg-bloc{margin:0 0 12px; border:1px solid var(--line); border-radius:14px; background:var(--bg-alt);}
#sondageEquipe .sdg-bloc > summary{padding:14px 18px; font-weight:600; color:var(--ink); cursor:pointer; list-style:none;}
#sondageEquipe .sdg-bloc > summary::-webkit-details-marker{display:none;}
#sondageEquipe .sdg-agg-grille{display:grid; grid-template-columns:repeat(2, minmax(0,1fr)); gap:12px; padding:0 14px 14px;}
#sondageEquipe .sdg-agg{padding:14px; border:1px solid var(--line); border-radius:12px; background:rgba(0,0,0,0.18);}
#sondageEquipe .sdg-agg h5{margin:0 0 10px; font-size:13.5px; line-height:1.4; color:var(--ink); font-weight:600;}
#sondageEquipe .sdg-agg h5 small, #sondageEquipe .sdg-libre h5 small{display:block; margin-top:2px; color:var(--muted); font-weight:400; font-size:11.5px;}
#sondageEquipe .sdg-agg-note{display:flex; align-items:baseline; gap:8px; margin-bottom:8px;}
#sondageEquipe .sdg-agg-note b{font-size:28px; color:var(--ink); font-variant-numeric:tabular-nums;}
#sondageEquipe .sdg-agg-note span{font-size:12px; color:var(--muted);}
#sondageEquipe .sdg-agg-liste{list-style:none; margin:0; padding:0; display:grid; gap:5px;}
#sondageEquipe .sdg-agg-liste li{position:relative; display:flex; justify-content:space-between; gap:10px; padding:6px 10px; border-radius:8px; font-size:12.5px; color:var(--ink-soft);}
#sondageEquipe .sdg-agg-liste li::before{content:''; position:absolute; inset:0; width:var(--p); background:rgba(79,180,255,0.16); border-radius:8px;}
#sondageEquipe .sdg-agg-liste li > *{position:relative;}
#sondageEquipe .sdg-agg-liste b{color:var(--ink); font-variant-numeric:tabular-nums; white-space:nowrap;}
#sondageEquipe .sdg-agg-liste small{color:var(--muted); font-weight:400;}
#sondageEquipe .sdg-agg-texte{margin:0; font-size:12.5px; color:var(--muted);}
#sondageEquipe .sdg-sous-titre{margin:22px 0 10px; font-size:15px; color:var(--ink);}
#sondageEquipe .sdg-libre{margin:0 0 16px;}
#sondageEquipe .sdg-libre h5{margin:0 0 8px; font-size:13.5px; color:var(--ink-soft);}
#sondageEquipe blockquote{margin:0 0 8px; padding:11px 14px; border-left:3px solid var(--blue-bright); border-radius:0 10px 10px 0; background:var(--bg-alt);}
#sondageEquipe blockquote p{margin:0 0 4px; color:var(--ink); font-size:14px; line-height:1.55;}
#sondageEquipe blockquote cite{font-size:12px; color:var(--muted); font-style:normal;}
#sondageEquipe .sdg-testeur{margin:0 0 8px; border:1px solid var(--line); border-radius:12px; background:var(--bg-alt);}
#sondageEquipe .sdg-testeur > summary{display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; padding:12px 16px; cursor:pointer; list-style:none;}
#sondageEquipe .sdg-testeur > summary::-webkit-details-marker{display:none;}
#sondageEquipe .sdg-testeur-nom{font-weight:600; color:var(--ink);}
#sondageEquipe .sdg-testeur-nom small{margin-left:6px; font-weight:400; color:var(--muted);}
#sondageEquipe .sdg-testeur-meta{font-size:12.5px; color:var(--muted);}
#sondageEquipe .sdg-testeur-meta em{font-style:normal; color:var(--ink-soft);}
#sondageEquipe .sdg-testeur-meta em.ok{color:#7be0a8;}
#sondageEquipe .sdg-testeur-corps{padding:4px 18px 16px; border-top:1px solid var(--line);}
#sondageEquipe .sdg-testeur-corps h5{margin:16px 0 6px; font-size:13px; color:var(--blue-bright);}
#sondageEquipe .sdg-testeur-corps dl{margin:0;}
#sondageEquipe .sdg-testeur-corps dt{margin-top:8px; font-size:12.5px; color:var(--muted);}
#sondageEquipe .sdg-testeur-corps dd{margin:2px 0 0; font-size:14px; color:var(--ink); line-height:1.5;}
#sondageEquipe .sdg-suppr{margin-top:16px; color:var(--danger); border-color:var(--danger);}
@media (max-width:900px){
  #sondageEquipe .sdg-cartes{grid-template-columns:repeat(2, minmax(0,1fr));}
  #sondageEquipe .sdg-agg-grille{grid-template-columns:1fr;}
}
`;

  function demarrer(){

    const style = document.createElement('style');
    style.id = 'sondageStyle';
    style.textContent = FEUILLE;
    document.head.appendChild(style);

    monterBouton();

    // Ouverte par une adresse directe (#sondage) : goTo a tourné avant ce fichier.
    const page = document.getElementById('page-sondage');
    if(page && page.classList.contains('active')) ouvrir();

    document.addEventListener('visibilitychange', () => {
      if(document.hidden && aEnvoyer) enregistrer(false);
    });
    window.addEventListener('pagehide', () => { if(aEnvoyer) enregistrer(false); });
  }

  window.Sondage = { ouvrir, chargerEquipe, SECTIONS };

  if(document.body) demarrer();
  else document.addEventListener('DOMContentLoaded', demarrer);
})();
