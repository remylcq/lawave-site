/* =====================================================================
   La Wave — confort : idées, nouveautés, export des données, tableau de bord de l'équipe

   Chargé à la demande par index.html (chargerConfort) :
     · #idees       : les idées proposées par les membres, avec vote ; l'équipe les traite (statut, réponse) ;
     · #nouveautes  : le journal des mises à jour du site ;
     · l'export de ses données personnelles (un fichier JSON) ;
     · le tableau de bord de l'équipe (onglet « Tableau de bord » de l'espace équipe).

   Voir sql/lot-confort.sql.
   ===================================================================== */

window.Confort = (function(){

  'use strict';

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  const dateLongue = (iso) => { const [a, m, j] = String(iso).slice(0, 10).split('-').map(Number); return j + (j === 1 ? 'er ' : ' ') + MOIS[m - 1] + ' ' + a; };

  function annoncer(titre, detail, type){
    if(typeof notifier === 'function') notifier(titre, { detail: detail || '', type: type || 'info' });
  }

  // ------------------------------------------------------------------
  // Le journal des mises à jour
  // ------------------------------------------------------------------

  const NOUVEAUTES = [
    { date: '2026-11-09', titre: 'Des outils pour les artistes et les photographes', points: [
      'Mes sorties : le suivi de tes soumissions (en attente, publiée, refusée) et les chiffres de chaque sortie.',
      'Une page de lancement à partager, avec compte à rebours, rappel « Me prévenir le jour J » et ajout à l\'agenda.',
      'Un générateur d\'affiche (carré, post, story) et une carte de visite numérique avec tous tes liens.',
      'Les photographes retenus déposent leurs photos sur le site ; un rappel la veille de l\'événement.'
    ] },
    { date: '2026-11-09', titre: 'La communauté s\'enrichit', points: [
      'Un défi chaque semaine, avec son mot-clic.',
      'Des messages vocaux dans les messages privés.',
      'Un annuaire de studios, avec tarifs, services et avis.',
      'Signaler un contenu en un clic, et suivre ce qu\'il devient dans « Mes signalements ».',
      'Explorer les membres est maintenant à droite du fil, sur l\'accueil de la communauté.'
    ] },
    { date: '2026-11-09', titre: 'Pages artistes et carte', points: [
      'Concerts à venir, statistiques privées pour l\'artiste, frise chronologique de la discographie.',
      'Un artiste vérifié complète sa présentation et sa photo lui-même.',
      'Sur la carte : « Concerts ce mois-ci » et « Autour de moi ».'
    ] },
    { date: '2026-11-09', titre: 'Catalogue et écoute', points: [
      'Cette semaine, Surprends-moi, et les autres versions d\'une sortie (deluxe, réédition…).',
      'Un lecteur d\'extraits avec file d\'attente, et un vinyle qui tourne dans la pochette en grand.'
    ] },
    { date: '2026-11-06', titre: 'Fiches de sorties repensées', points: [
      'La tracklist s\'ouvre dans un encadré collé à la fiche ; un clic sur la pochette l\'agrandit.',
      'Un clic sur un titre joue un extrait de 30 secondes.'
    ] }
  ];

  function nouveautes(){

    const corps = document.getElementById('nouveautesCorps');
    if(!corps) return;

    corps.innerHTML = `
      <ol class="nv-liste">
        ${NOUVEAUTES.map(n => `
          <li class="nv-jour">
            <time datetime="${esc(n.date)}">${esc(dateLongue(n.date))}</time>
            <h3>${esc(n.titre)}</h3>
            <ul>${n.points.map(p => `<li>${esc(p)}</li>`).join('')}</ul>
          </li>`).join('')}
      </ol>
      <p class="nv-fin">Une idée pour la suite ? <a href="#idees" onclick="goTo('idees'); return false;">Propose-la ici</a>.</p>`;
  }

  // ------------------------------------------------------------------
  // Les idées
  // ------------------------------------------------------------------

  const STATUTS = {
    nouvelle: ['Nouvelle', 'nouvelle'], retenue: ['Retenue', 'retenue'], en_cours: ['En cours', 'cours'],
    faite: ['Faite', 'faite'], refusee: ['Refusée', 'refusee']
  };

  let triIdees = 'votes';

  async function idees(){

    const corps = document.getElementById('ideesCorps');
    if(!corps) return;

    let liste = [];

    try{
      const rep = await supabaseClient.rpc('idees_liste', { p_tri: triIdees });
      if(rep.error) throw rep.error;
      liste = rep.data || [];
    }catch(e){
      corps.innerHTML = '<div class="empty-state">Les idées ne se chargent pas pour le moment.</div>';
      return;
    }

    const equipe = !!(currentUser && currentUser.isAdmin);

    corps.innerHTML = `
      <div class="id-barre">
        <div class="id-tri" role="group" aria-label="Ordre">
          <button type="button" class="${triIdees === 'votes' ? 'on' : ''}" onclick="Confort.trier('votes')">Les plus votées</button>
          <button type="button" class="${triIdees === 'recent' ? 'on' : ''}" onclick="Confort.trier('recent')">Les plus récentes</button>
        </div>
        <button type="button" class="btn btn-primary" onclick="Confort.proposer()">Proposer une idée</button>
      </div>
      ${liste.length ? `<ul class="id-liste">${liste.map(i => {
          const [lib, cls] = STATUTS[i.statut] || STATUTS.nouvelle;
          return `
            <li class="id-idee">
              <button type="button" class="id-vote${i.mon_vote ? ' on' : ''}" onclick="Confort.voter('${esc(i.id)}', ${i.mon_vote ? 'false' : 'true'})" aria-pressed="${i.mon_vote ? 'true' : 'false'}" aria-label="Voter pour cette idée">
                <span aria-hidden="true">▲</span><b>${i.votes}</b>
              </button>
              <div class="id-texte">
                <div class="id-haut"><strong>${esc(i.titre)}</strong><span class="id-statut ${cls}">${esc(lib)}</span></div>
                ${i.description ? `<p>${esc(i.description)}</p>` : ''}
                ${i.reponse ? `<p class="id-reponse"><b>Réponse de l'équipe :</b> ${esc(i.reponse)}</p>` : ''}
                <small>${i.auteur ? 'proposée par @' + esc(i.auteur) + ' · ' : ''}${esc(dateLongue(i.cree_le))}</small>
                ${equipe ? `
                  <div class="id-equipe">
                    <select onchange="Confort.traiter('${esc(i.id)}', this.value)" aria-label="Statut">
                      ${Object.entries(STATUTS).map(([k, v]) => `<option value="${k}"${k === i.statut ? ' selected' : ''}>${esc(v[0])}</option>`).join('')}
                    </select>
                    <button type="button" onclick="Confort.supprimer('${esc(i.id)}')">Supprimer</button>
                  </div>` : (i.mienne ? `<div class="id-equipe"><button type="button" onclick="Confort.supprimer('${esc(i.id)}')">Retirer mon idée</button></div>` : '')}
              </div>
            </li>`;
        }).join('')}</ul>`
        : '<div class="empty-state">Aucune idée pour l\'instant : propose la première.</div>'}`;
  }

  function trier(t){ triIdees = t; idees(); }

  async function voter(id, actif){

    if(!currentUser){ annoncer('Connecte-toi pour voter'); openAuthModal('login'); return; }

    try{
      const rep = await supabaseClient.rpc('idee_voter', { p_id: id, p_actif: actif });
      if(rep.error) throw rep.error;
      idees();
    }catch(e){
      annoncer('Vote impossible', e && e.message, 'erreur');
    }
  }

  function proposer(){

    if(!currentUser){ annoncer('Connecte-toi pour proposer une idée'); openAuthModal('login'); return; }

    const voile = document.createElement('div');
    voile.className = 'aff-voile';
    voile.setAttribute('role', 'dialog');
    voile.setAttribute('aria-modal', 'true');
    voile.innerHTML = `
      <div class="aff-boite" style="width:min(520px,100%)">
        <button type="button" class="aff-fermer" aria-label="Fermer">✕</button>
        <h3>Proposer une idée</h3>
        <form class="id-form">
          <label>Ton idée, en une phrase
            <input type="text" id="ideeTitre" maxlength="90" required placeholder="Ex. : un mode hors ligne pour écouter les extraits">
          </label>
          <label>Un peu plus de détails <small>(facultatif)</small>
            <textarea id="ideeDescription" rows="4" maxlength="700" placeholder="À quoi ça servirait, comment tu l'imagines…"></textarea>
          </label>
          <button type="submit" class="btn btn-primary">Envoyer l'idée</button>
          <p class="aff-erreur" hidden></p>
        </form>
      </div>`;
    document.body.appendChild(voile);

    const fermer = () => { voile.remove(); document.removeEventListener('keydown', touche); };
    const touche = (e) => { if(e.key === 'Escape') fermer(); };
    document.addEventListener('keydown', touche);
    voile.addEventListener('click', (e) => { if(e.target === voile || e.target.closest('.aff-fermer')) fermer(); });
    setTimeout(() => { const t = voile.querySelector('#ideeTitre'); if(t) t.focus(); }, 50);

    voile.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const erreur = voile.querySelector('.aff-erreur');
      try{
        const rep = await supabaseClient.rpc('idee_proposer', { p_titre: voile.querySelector('#ideeTitre').value, p_description: voile.querySelector('#ideeDescription').value || null });
        if(rep.error) throw rep.error;
        fermer();
        annoncer('Merci pour ton idée', 'Les autres membres peuvent maintenant voter.');
        idees();
      }catch(err){
        erreur.textContent = (err && err.message) || 'Réessaie dans un instant.';
        erreur.hidden = false;
      }
    });
  }

  async function traiter(id, statut){

    const reponse = window.prompt('Une réponse pour les membres ? (facultatif)', '') || null;

    try{
      const rep = await supabaseClient.rpc('idee_traiter', { p_id: id, p_statut: statut, p_reponse: reponse });
      if(rep.error) throw rep.error;
      idees();
    }catch(e){
      annoncer('Action impossible', e && e.message, 'erreur');
    }
  }

  async function supprimer(id){

    if(!confirm('Supprimer cette idée ?')) return;

    try{
      const rep = await supabaseClient.rpc('idee_supprimer', { p_id: id });
      if(rep.error) throw rep.error;
      idees();
    }catch(e){
      annoncer('Action impossible', e && e.message, 'erreur');
    }
  }

  // ------------------------------------------------------------------
  // L'export de ses données
  // ------------------------------------------------------------------

  async function exporter(){

    if(!currentUser){ annoncer('Connecte-toi pour exporter tes données'); return; }

    try{
      const rep = await supabaseClient.rpc('exporter_mes_donnees');
      if(rep.error) throw rep.error;

      const blob = new Blob([JSON.stringify(rep.data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'mes-donnees-la-wave-' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      annoncer('Export prêt', 'Ton fichier contient ton profil, tes messages, ta collection et tes abonnements.');
    }catch(e){
      annoncer('Export impossible', e && e.message, 'erreur');
    }
  }

  // ------------------------------------------------------------------
  // Les alertes sur l'appareil (notifications push)
  // ------------------------------------------------------------------

  function cleEnOctets(base64url){
    const b = (base64url + '='.repeat((4 - base64url.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/');
    const brut = atob(b);
    return Uint8Array.from(brut, c => c.charCodeAt(0));
  }

  // Active (ou coupe) les alertes de La Wave sur cet appareil : elles arrivent même site fermé.
  async function pushBasculer(){

    if(!currentUser){ annoncer('Connecte-toi pour recevoir des alertes'); openAuthModal('login'); return; }

    if(!('serviceWorker' in navigator) || !('PushManager' in window)){
      annoncer('Alertes indisponibles', "Ce navigateur ne sait pas en recevoir. Sur iPhone, ajoute d'abord La Wave à l'écran d'accueil.");
      return;
    }

    if(!/^(www\.)?lawave\.fr$/.test(location.hostname)){
      annoncer('Alertes indisponibles ici', 'Elles se règlent sur lawave.fr.');
      return;
    }

    try{

      const reg = await navigator.serviceWorker.ready;
      const existant = await reg.pushManager.getSubscription();

      if(existant){
        await supabaseClient.rpc('push_desabonner', { p_endpoint: existant.endpoint });
        await existant.unsubscribe();
        annoncer('Alertes coupées sur cet appareil');
        return;
      }

      const permission = await Notification.requestPermission();

      if(permission !== 'granted'){
        annoncer('Alertes refusées', "Autorise les notifications dans ton navigateur pour les recevoir.");
        return;
      }

      const cle = await supabaseClient.rpc('push_cle_publique');
      if(cle.error || !cle.data) throw cle.error || new Error('Clé introuvable.');

      const abo = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: cleEnOctets(cle.data) });
      const j = abo.toJSON();

      const rep = await supabaseClient.rpc('push_abonner', { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth });
      if(rep.error) throw rep.error;

      annoncer('Alertes activées', 'Tu seras prévenu des réactions, messages, sorties de tes artistes et rappels, même site fermé.');

    }catch(e){
      annoncer('Alertes impossibles', e && e.message, 'erreur');
    }
  }

  // Le résumé hebdomadaire par e-mail : on l'active ou on le coupe depuis les réglages (voir sql/email-resume.sql).
  async function emailResumeBasculer(){

    if(!currentUser){ annoncer('Connecte-toi pour recevoir le résumé'); openAuthModal('login'); return; }

    try{
      const etat = await supabaseClient.rpc('email_resume_etat');
      if(etat.error) throw etat.error;
      const veut = !etat.data;
      const rep = await supabaseClient.rpc('email_resume_regler', { p_actif: veut });
      if(rep.error) throw rep.error;
      annoncer(veut ? 'Résumé hebdomadaire activé' : 'Résumé hebdomadaire coupé',
               veut ? 'Chaque lundi, les sorties de tes artistes suivis, par e-mail.' : 'Tu ne recevras plus d\'e-mail.');
    }catch(e){
      annoncer('Action impossible', e && e.message, 'erreur');
    }
  }

  // ------------------------------------------------------------------
  // Le tableau de bord de l'équipe
  // ------------------------------------------------------------------

  async function tableauBord(){

    const corps = document.getElementById('tableauBordCorps');
    if(!corps) return;

    corps.innerHTML = '<p class="art-vide">Chargement…</p>';

    let d;

    try{
      const rep = await supabaseClient.rpc('equipe_tableau_bord');
      if(rep.error) throw rep.error;
      d = rep.data;
    }catch(e){
      corps.innerHTML = '<p class="art-vide">Le tableau de bord ne se charge pas pour le moment.</p>';
      return;
    }

    const carte = (valeur, libelle, detail) => `<div class="tb-carte"><b>${esc(valeur)}</b><span>${esc(libelle)}</span>${detail ? `<small>${esc(detail)}</small>` : ''}</div>`;

    // Les files à traiter : un pavé par file, qui mène à l'onglet concerné.
    const FILES = [
      ['soumissions', 'Soumissions à valider', 'submissions'], ['imports', 'Imports à valider', 'submissions'],
      ['signalements', 'Signalements ouverts', null], ['verifications', 'Profils à vérifier', 'profils'],
      ['pages_artistes', 'Pages d\'artistes demandées', 'artists'], ['studios', 'Studios à publier', null],
      ['idees', 'Idées nouvelles', null], ['accreditations', 'Inscriptions photo', 'accreditations']
    ];

    const total = FILES.reduce((n, f) => n + (d.a_traiter[f[0]] || 0), 0);

    corps.innerHTML = `
      <p class="tb-titre">Aujourd'hui</p>
      <div class="tb-cartes">
        ${carte(d.inscriptions.aujourdhui, 'nouvelles inscriptions', d.inscriptions.semaine + ' cette semaine · ' + d.inscriptions.total + ' au total')}
        ${carte(d.activite.messages_24h, 'messages (24 h)', d.activite.commentaires_24h + ' commentaires')}
        ${carte(d.audience.vues_aujourdhui, 'pages vues', d.audience.visites_aujourdhui + ' visites')}
        ${carte(d.activite.actifs_7j, 'membres actifs (7 j)', d.activite.messages_7j + ' messages sur la semaine')}
      </div>
      <p class="tb-titre">À traiter ${total ? '<span class="tb-total">' + total + '</span>' : ''}</p>
      <div class="tb-files">
        ${FILES.map(([cle, lib, onglet]) => {
          const n = d.a_traiter[cle] || 0;
          const contenu = `<b>${n}</b><span>${esc(lib)}</span>`;
          return onglet
            ? `<button type="button" class="tb-file${n ? ' plein' : ''}" onclick="switchAdminTab('${onglet}')">${contenu}</button>`
            : `<div class="tb-file${n ? ' plein' : ''}">${contenu}</div>`;
        }).join('')}
      </div>
      <p class="tb-note">Les signalements, studios et idées se traitent dans la communauté (menu ⋯ sur un message, Annonces → Studios) et sur la page Idées.</p>
      <p class="tb-titre">Catalogue</p>
      <div class="tb-cartes">
        ${carte(d.catalogue.publiees_7j, 'sorties parues cette semaine', d.catalogue.total + ' sorties publiées')}
      </div>`;
  }

  // ------------------------------------------------------------------
  // Les défis de la semaine (espace équipe) : chaque défi se publie en message épinglé dans la communauté.
  // ------------------------------------------------------------------

  async function defisEquipe(){

    const corps = document.getElementById('defisCorps');
    if(!corps) return;

    let liste;

    try{
      const rep = await supabaseClient.rpc('com_defis_equipe');
      if(rep.error) throw rep.error;
      liste = rep.data || [];
    }catch(e){
      corps.innerHTML = '<p class="art-vide">Les questions ne se chargent pas pour le moment.</p>';
      return;
    }

    const jour = d => new Date(d + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
    const auj = new Date().toISOString().slice(0, 10);

    corps.innerHTML = `
      <form class="df-form" onsubmit="Confort.defiCreer(event)">
        <p class="tb-titre" style="margin-top:0">Nouvelle question</p>
        <input id="dfTitre" maxlength="80" placeholder="La question (ex. Ton son préféré de 2019)" required>
        <textarea id="dfConsigne" maxlength="300" rows="2" placeholder="Précise la consigne, en une ou deux phrases" required></textarea>
        <div class="df-dates"><label>Du <input type="date" id="dfDebut" required></label><label>au <input type="date" id="dfFin" required></label></div>
        <button type="submit" class="btn btn-primary">Créer et publier</button>
      </form>
      <p class="tb-titre">Toutes les questions</p>
      <div class="df-liste">
        ${liste.map(d => `
          <div class="df-ligne${d.post_id ? ' publie' : ''}">
            <div class="df-texte">
              <b>${esc(d.titre)}</b>
              <small>${esc(jour(d.debut))} → ${esc(jour(d.fin))}${d.debut <= auj && auj <= d.fin ? ' · en cours' : ''}${d.post_id ? ' · ' + d.nb_commentaires + ' réponse' + (d.nb_commentaires > 1 ? 's' : '') + (d.epingle ? '' : '') : ''}</small>
            </div>
            ${d.post_id
              ? `<a class="btn btn-ghost" href="#community/post/${esc(d.post_id)}">Voir</a>
                 <button type="button" class="btn btn-ghost" onclick="Confort.defiRetirer('${esc(d.id)}')">Retirer</button>`
              : `<button type="button" class="btn btn-primary" onclick="Confort.defiPublier('${esc(d.id)}')">Publier</button>`}
          </div>`).join('') || '<p class="art-vide">Aucune question pour le moment.</p>'}
      </div>`;

    const lundi = new Date();
    lundi.setDate(lundi.getDate() + ((8 - lundi.getDay()) % 7 || 7));
    const dim = new Date(lundi); dim.setDate(dim.getDate() + 6);
    const iso = d => d.toISOString().slice(0, 10);
    document.getElementById('dfDebut').value = iso(lundi);
    document.getElementById('dfFin').value = iso(dim);
  }

  async function defiAction(nom, args, ok){
    try{
      const rep = await supabaseClient.rpc(nom, args);
      if(rep.error) throw rep.error;
      notifier(ok, { type: 'succes' });
      defisEquipe();
      return rep.data;
    }catch(e){
      notifier('Action impossible', { detail: e.message, type: 'erreur' });
    }
  }

  function defiPublier(id){ return defiAction('com_defi_publier', { p_defi: id }, 'Question publiée'); }

  function defiRetirer(id){
    if(!confirm('Retirer cette question (et ses réponses) de la communauté ?')) return;
    return defiAction('com_defi_retirer', { p_defi: id }, 'Question retirée');
  }

  async function defiCreer(e){
    e.preventDefault();
    const debut = document.getElementById('dfDebut').value;
    const fin = document.getElementById('dfFin').value;
    if(fin < debut){ notifier('Les dates sont inversées',{ type: 'erreur' }); return; }
    try{
      const rep = await supabaseClient.rpc('com_defi_creer', {
        p_titre: document.getElementById('dfTitre').value, p_consigne: document.getElementById('dfConsigne').value,
        p_tag: 'defi' + debut.replace(/-/g, ''), p_debut: debut, p_fin: fin
      });
      if(rep.error) throw rep.error;
      await defiPublier(rep.data.id);
    }catch(err){
      notifier('Action impossible', { detail: err.message, type: 'erreur' });
    }
  }

  // ------------------------------------------------------------------

  function rendre(pageId){
    if(pageId === 'idees') return idees();
    if(pageId === 'nouveautes') return nouveautes();
  }

  return { rendre, trier, voter, proposer, traiter, supprimer, exporter, tableauBord, defisEquipe, defiPublier, defiRetirer, defiCreer, pushBasculer, emailResumeBasculer };

})();
