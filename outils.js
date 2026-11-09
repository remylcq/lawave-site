/* =====================================================================
   La Wave — les outils des artistes et des photographes

   Chargé à la demande par index.html (chargerOutils). Quatre pages et deux petits outils :
     · #mes-sorties       : le suivi de ses soumissions (en attente / publiée / refusée) et les chiffres de ses sorties ;
     · #lancement/<n°>    : la page de lancement d'une sortie, à partager : compte à rebours, « Me prévenir le jour J »
                            (la sortie passe en « À écouter », et la base prévient le jour de la sortie), calendrier ;
     · #visite/<pseudo>   : la carte de visite numérique d'un artiste : tous ses liens sur une seule page ;
     · l'affiche d'une sortie, générée dans le navigateur (carré, post, story) et téléchargée en PNG ;
     · les photos livrées après un événement accrédité (dépôt par le photographe, consultation par l'équipe).

   Voir sql/lot-outils.sql.
   ===================================================================== */

window.Outils = (function(){

  'use strict';

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const url = (u) => (typeof safeUrl === 'function' ? safeUrl(u) : (/^https:\/\//i.test(u || '') ? u : ''));
  const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

  const dateLongue = (iso) => {
    const [a, m, j] = String(iso).slice(0, 10).split('-').map(Number);
    return j + (j === 1 ? 'er ' : ' ') + MOIS[m - 1] + ' ' + a;
  };

  const parametre = () => {
    const brut = location.hash.replace(/^#/, '').split('/')[1] || '';
    try{ return decodeURIComponent(brut); }catch(e){ return brut; }
  };

  const lienLancement = (num) => location.origin + location.pathname + '#lancement/' + num;
  const lienVisite = (handle) => location.origin + location.pathname + '#visite/' + encodeURIComponent(handle);

  // Les liens à partager passent par partage.php : ils s'affichent avec la pochette et le titre dans les messageries et les réseaux.
  const partageLancement = (num) => location.origin + '/partage.php?s=' + num + '&p=lancement';
  const partageVisite = (handle) => location.origin + '/partage.php?v=' + encodeURIComponent(handle);

  function annoncer(titre, detail){
    if(typeof notifier === 'function') notifier(titre, { detail: detail || '' });
  }

  async function copier(texte, message){
    try{
      await navigator.clipboard.writeText(texte);
      annoncer(message || 'Lien copié');
    }catch(e){
      window.prompt('Copie ce lien :', texte);
    }
  }

  async function partager(titre, texte, lien){
    if(navigator.share){
      try{ await navigator.share({ title: titre, text: texte, url: lien }); return; }catch(e){ if(e && e.name === 'AbortError') return; }
    }
    copier(lien);
  }

  function zone(id){ return document.getElementById(id); }

  // ------------------------------------------------------------------
  // La page de lancement
  // ------------------------------------------------------------------

  let minuteurLancement = 0;

  async function lancement(){

    const corps = zone('lancementCorps');
    if(!corps) return;

    clearInterval(minuteurLancement);

    const num = Number(parametre());

    if(!num){
      corps.innerHTML = '<div class="empty-state">Cette page de lancement n\'existe pas.</div>';
      return;
    }

    corps.innerHTML = '<div class="empty-state chargement">Chargement…</div>';

    let s = null;

    try{
      const rep = await supabaseClient.rpc('lancement_page', { p_num: num });
      if(rep.error) throw rep.error;
      s = rep.data;
    }catch(e){
      corps.innerHTML = '<div class="empty-state">Impossible de charger cette page pour le moment.</div>';
      return;
    }

    if(!s){
      corps.innerHTML = '<div class="empty-state">Cette sortie n\'existe pas (ou plus).</div>';
      return;
    }

    document.title = s.titre + ' — ' + s.artiste + ' · La Wave';

    const cible = s.date ? new Date(s.date + 'T00:00:00') : null;
    const aVenir = !!(cible && cible.getTime() > Date.now());
    const liens = s.liens || {};
    const feats = (s.featuring || []).map(f => f && (f.nom || f.handle)).filter(Boolean);

    const plateformes = [['spotify', 'Spotify'], ['deezer', 'Deezer'], ['apple', 'Apple Music'], ['youtube', 'YouTube'], ['ecoute', 'Écouter']]
      .filter(([cle]) => url(liens[cle]))
      .map(([cle, lib]) => `<a class="lanc-plateforme" href="${esc(url(liens[cle]))}" target="_blank" rel="noopener noreferrer">${esc(lib)}</a>`).join('');

    corps.innerHTML = `
      <article class="lanc" style="--c:url('${esc(url(s.cover))}')">
        <div class="lanc-fond" aria-hidden="true"></div>
        <div class="lanc-carte">
          <img class="lanc-cover" src="${esc(url(s.cover))}" alt="Pochette de ${esc(s.titre)}">
          <div class="lanc-texte">
            <span class="lanc-type">${esc(s.type || 'Sortie')}${s.date ? ' · ' + (aVenir ? 'le ' : 'sortie le ') + esc(dateLongue(s.date)) : ''}</span>
            <h2>${esc(s.titre)}</h2>
            <p class="lanc-artiste">${esc(s.artiste)}${feats.length ? ' <small>feat. ' + esc(feats.join(', ')) + '</small>' : ''}</p>

            ${aVenir ? `
              <div class="lanc-compte" role="timer" aria-label="Temps avant la sortie">
                ${['jours', 'heures', 'minutes', 'secondes'].map(u => `<div><b data-u="${u}">0</b><span>${u}</span></div>`).join('')}
              </div>` : `
              <p class="lanc-dispo">Disponible maintenant</p>
              <div class="lanc-plateformes">${plateformes}
                <button type="button" class="lanc-plateforme" data-l="fiche">Voir la fiche</button></div>`}

            <div class="lanc-actions">
              ${aVenir ? `<button type="button" class="btn btn-primary" data-l="prevenir" aria-pressed="${s.prevenu ? 'true' : 'false'}">${s.prevenu ? '✓ Je serai prévenu' : 'Me prévenir le jour J'}</button>` : ''}
              ${s.handle ? '<button type="button" class="btn btn-ghost" data-l="suivre">Suivre l\'artiste</button>' : ''}
              <button type="button" class="btn btn-ghost" data-l="partager">Partager</button>
              ${aVenir ? '<button type="button" class="btn btn-ghost" data-l="agenda">Ajouter à mon agenda</button>' : ''}
            </div>
            <p class="lanc-prevenus">${s.nb_prevenus ? s.nb_prevenus + (s.nb_prevenus > 1 ? ' personnes ont mis cette sortie de côté.' : ' personne a mis cette sortie de côté.') : ''}</p>
          </div>
        </div>
      </article>`;

    // Le compte à rebours : jours, heures, minutes, secondes, jusqu'à minuit le jour de la sortie.
    if(aVenir){

      const maj = () => {
        const page = zone('page-lancement');
        if(!page || !page.classList.contains('active')){ clearInterval(minuteurLancement); return; }
        const reste = Math.max(0, Math.floor((cible.getTime() - Date.now()) / 1000));
        const v = { jours: Math.floor(reste / 86400), heures: Math.floor(reste % 86400 / 3600), minutes: Math.floor(reste % 3600 / 60), secondes: reste % 60 };
        Object.keys(v).forEach(k => { const b = corps.querySelector('[data-u="' + k + '"]'); if(b) b.textContent = String(v[k]).padStart(k === 'jours' ? 1 : 2, '0'); });
        if(reste === 0){ clearInterval(minuteurLancement); lancement(); }
      };

      maj();
      minuteurLancement = setInterval(maj, 1000);
    }

    corps.onclick = async (e) => {

      const b = e.target.closest('[data-l]');
      if(!b) return;

      const act = b.dataset.l;

      if(act === 'partager'){
        partager(s.titre + ' — ' + s.artiste, aVenir ? 'Bientôt sur La Wave : ' + s.titre : s.titre + ' sur La Wave', partageLancement(s.num));
      } else if(act === 'fiche'){
        if(typeof ouvrirSortieParNumero === 'function') ouvrirSortieParNumero(String(s.num), false);
      } else if(act === 'agenda'){
        telechargerAgenda(s);
      } else if(act === 'suivre'){
        if(!currentUser){ openAuthModal('login'); return; }
        try{
          const rep = await supabaseClient.rpc('artiste_suivre', { p_handle: s.handle, p_suivre: true });
          if(rep.error) throw rep.error;
          annoncer('Tu suis ' + s.artiste, 'Tu seras prévenu de ses prochaines sorties.');
        }catch(err){ annoncer('Action impossible', err && err.message); }
      } else if(act === 'prevenir'){
        if(!currentUser){ annoncer('Connecte-toi pour être prévenu'); openAuthModal('login'); return; }
        const veut = b.getAttribute('aria-pressed') !== 'true';
        b.disabled = true;
        try{
          // Même geste que « À écouter » dans la fiche : la base prévient le jour de la sortie.
          if(typeof chargerNotes === 'function') await chargerNotes();
          await enregistrerMaNote(s.id, { a_ecouter: veut });
          b.setAttribute('aria-pressed', String(veut));
          b.textContent = veut ? '✓ Je serai prévenu' : 'Me prévenir le jour J';
          if(veut) annoncer('C\'est noté', 'Tu seras prévenu le jour de la sortie, dans tes alertes.');
        }catch(err){
          annoncer('Action impossible', err && err.message);
        }
        b.disabled = false;
      }
    };
  }

  // Le jour de la sortie dans l'agenda (un événement sur la journée), à ouvrir avec n'importe quelle application de calendrier.
  function telechargerAgenda(s){

    const d = String(s.date).slice(0, 10).replace(/-/g, '');
    const suivant = new Date(s.date + 'T00:00:00'); suivant.setDate(suivant.getDate() + 1);
    const f = suivant.getFullYear() + String(suivant.getMonth() + 1).padStart(2, '0') + String(suivant.getDate()).padStart(2, '0');
    const echap = (t) => String(t).replace(/[\\;,]/g, m => '\\' + m).replace(/\n/g, '\\n');

    const ics = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//La Wave//Sorties//FR', 'BEGIN:VEVENT',
      'UID:sortie-' + s.num + '@lawave.fr', 'DTSTAMP:' + new Date().toISOString().replace(/[-:]|\.\d+/g, ''),
      'DTSTART;VALUE=DATE:' + d, 'DTEND;VALUE=DATE:' + f,
      'SUMMARY:' + echap('Sortie : ' + s.titre + ' — ' + s.artiste),
      'DESCRIPTION:' + echap('À retrouver sur La Wave : ' + lienLancement(s.num)),
      'URL:' + lienLancement(s.num), 'END:VEVENT', 'END:VCALENDAR'
    ].join('\r\n');

    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
    a.download = 'sortie-' + s.num + '.ics';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  // ------------------------------------------------------------------
  // La carte de visite numérique
  // ------------------------------------------------------------------

  async function visite(){

    const corps = zone('visiteCorps');
    if(!corps) return;

    const handle = parametre();

    if(!handle){
      corps.innerHTML = '<div class="empty-state">Cette carte de visite n\'existe pas.</div>';
      return;
    }

    corps.innerHTML = '<div class="empty-state chargement">Chargement…</div>';

    try{
      if(typeof loadArtists === 'function') await loadArtists();
      if(typeof assurerSortiesArtiste === 'function') await assurerSortiesArtiste(handle);
    }catch(e){}

    const p = (typeof artistsByHandle !== 'undefined' && artistsByHandle[handle]) || null;
    const sorties = (typeof catalogueData !== 'undefined' ? catalogueData : [])
      .filter(s => (s.artistHandle || (typeof instagramHandle === 'function' ? instagramHandle(s.instagram) : '')) === handle)
      .sort((a, b) => String(b.releaseDate || '').localeCompare(String(a.releaseDate || '')))
      .slice(0, 4);

    if(!p && !sorties.length){
      corps.innerHTML = '<div class="empty-state">Cet artiste est introuvable.</div>';
      return;
    }

    const nom = (p && p.display_name) || (sorties[0] && sorties[0].artist) || handle;
    const photo = url(p && p.photo_url);

    document.title = nom + ' — carte de visite · La Wave';

    let concert = null;

    try{
      const rep = await supabaseClient.rpc('artiste_concerts', { p_handle: handle });
      if(!rep.error && rep.data && rep.data.concerts && rep.data.concerts.length) concert = rep.data.concerts[0];
    }catch(e){}

    const reseaux = [];
    const insta = url(p && p.instagram_url);
    if(insta) reseaux.push(['Instagram', insta]);
    [['tiktok_url', 'TikTok'], ['twitter_url', 'X'], ['youtube_url', 'YouTube'], ['spotify_url', 'Spotify'], ['deezer_url', 'Deezer'], ['apple_music_url', 'Apple Music']]
      .forEach(([col, lib]) => { const u = url(p && p[col]); if(u) reseaux.push([lib, u]); });

    corps.innerHTML = `
      <article class="vis">
        <div class="vis-photo">${photo ? `<img src="${esc(photo)}" alt="">` : esc((nom || '?').charAt(0).toUpperCase())}</div>
        <h2>${esc(nom)}</h2>
        ${p && p.ville ? `<p class="vis-ville">${esc(p.ville)}</p>` : ''}
        ${p && p.bio ? `<p class="vis-bio">${esc(p.bio)}</p>` : ''}

        ${concert ? `
          <div class="vis-concert">
            <span>Prochain concert</span>
            <b>${esc(dateLongue(concert.date))}</b>
            <small>${esc(concert.ville)}${concert.salle ? ' · ' + esc(concert.salle) : ''}</small>
            ${url(concert.lien) ? `<a href="${esc(url(concert.lien))}" target="_blank" rel="noopener noreferrer">Billets</a>` : ''}
          </div>` : ''}

        ${reseaux.length ? `<div class="vis-liens">${reseaux.map(([lib, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(lib)}</a>`).join('')}</div>` : ''}

        ${sorties.length ? `
          <p class="vis-titre">Dernières sorties</p>
          <div class="vis-sorties">${sorties.map(s => `
            <button type="button" onclick="openCatalogueModal('${esc(s.id)}')" title="${esc(s.title)}">
              <img src="${esc(url(s.cover))}" alt="${esc(s.title)}" loading="lazy">
              <span>${esc(s.title)}</span>
            </button>`).join('')}</div>` : ''}

        <div class="vis-actions">
          <button type="button" class="btn btn-primary" onclick="ouvrirPageArtiste('${esc(handle)}')">Voir tout sur La Wave</button>
          <button type="button" class="btn btn-ghost" id="visPartager">Partager cette carte</button>
        </div>
      </article>`;

    const b = corps.querySelector('#visPartager');
    if(b) b.onclick = () => partager(nom + ' sur La Wave', 'Tous les liens de ' + nom, partageVisite(handle));
  }

  // ------------------------------------------------------------------
  // Mes sorties : le suivi des soumissions, les chiffres, les outils
  // ------------------------------------------------------------------

  const STATUTS = {
    pending: ['En attente de validation', 'attente'],
    approved: ['Publiée', 'ok'],
    rejected: ['Refusée', 'refus']
  };

  async function mesSorties(){

    const corps = zone('mesSortiesCorps');
    if(!corps) return;

    if(!currentUser){
      corps.innerHTML = `
        <div class="empty-state">
          Connecte-toi pour suivre tes soumissions et voir les chiffres de tes sorties.
          <button type="button" class="btn btn-primary" style="margin-top:14px;" onclick="openAuthModal('login')">Se connecter</button>
        </div>`;
      return;
    }

    corps.innerHTML = '<div class="empty-state chargement">Chargement…</div>';

    let soumissions = [], sorties = [];

    try{
      const [a, b] = await Promise.all([supabaseClient.rpc('mes_soumissions'), supabaseClient.rpc('mes_sorties_stats')]);
      if(a.error) throw a.error;
      if(b.error) throw b.error;
      soumissions = a.data || [];
      sorties = b.data || [];
    }catch(e){
      corps.innerHTML = '<div class="empty-state">Impossible de charger tes sorties pour le moment.</div>';
      return;
    }

    window.__mesSorties = sorties;

    const handles = [...new Set(sorties.map(s => s.handle).filter(Boolean))];
    const attente = soumissions.filter(s => s.statut === 'pending').length;

    corps.innerHTML = `
      <section class="ms-bloc">
        <div class="ms-tete">
          <h3>Mes soumissions</h3>
          <button type="button" class="btn btn-ghost" onclick="goTo('submit')">Soumettre une sortie</button>
        </div>
        ${soumissions.length ? `
          ${attente ? `<p class="ms-note">${attente} sortie${attente > 1 ? 's attendent' : ' attend'} la validation de l'équipe.</p>` : ''}
          <ul class="ms-liste">
            ${soumissions.map(s => {
              const [lib, cls] = STATUTS[s.statut] || [s.statut, 'attente'];
              return `
                <li class="ms-sou">
                  <img src="${esc(url(s.cover))}" alt="" loading="lazy">
                  <span class="ms-sou-texte">
                    <strong>${esc(s.titre)}</strong>
                    <small>${esc(s.artiste)}${s.type ? ' · ' + esc(s.type) : ''} · déposée le ${esc(dateLongue(s.depose_le))}</small>
                    ${s.statut === 'rejected' && s.raison ? `<em>Raison : ${esc(s.raison)}</em>` : ''}
                  </span>
                  <span class="ms-statut ${cls}">${esc(lib)}</span>
                  ${s.num ? `<button type="button" class="ms-lien" onclick="goTo('lancement', { parametre: '${esc(s.num)}' })">Page de lancement</button>` : ''}
                </li>`;
            }).join('')}
          </ul>` : '<p class="ms-vide">Tu n\'as encore déposé aucune sortie depuis ce compte.</p>'}
      </section>

      <section class="ms-bloc">
        <div class="ms-tete"><h3>Mes sorties publiées</h3>
          ${handles.length ? `<button type="button" class="btn btn-ghost" onclick="goTo('visite', { parametre: '${esc(handles[0])}' })">Ma carte de visite</button>` : ''}
        </div>
        ${sorties.length ? `
          <div class="ms-grille">
            ${sorties.map((s, i) => `
              <article class="ms-sortie">
                <img src="${esc(url(s.cover))}" alt="" loading="lazy">
                <div class="ms-sortie-corps">
                  <strong>${esc(s.titre)}</strong>
                  <small>${esc(s.artiste)}${s.date ? ' · ' + esc(dateLongue(s.date)) : ''}</small>
                  <div class="ms-chiffres">
                    <span><b>${s.en_collection}</b> en collection</span>
                    <span><b>${s.a_ecouter}</b> à écouter</span>
                    <span><b>${s.note != null ? String(s.note).replace('.', ',') : '—'}</b>/5${s.nb_notes ? ' (' + s.nb_notes + ')' : ''}</span>
                    <span><b>${s.nb_avis}</b> avis</span>
                  </div>
                  <div class="ms-boutons">
                    <button type="button" onclick="goTo('lancement', { parametre: '${esc(s.num)}' })">Page de lancement</button>
                    <button type="button" onclick="Outils.copierLancement(${esc(s.num)})">Copier le lien</button>
                    <button type="button" onclick="Outils.affiche(${i})">Affiche</button>
                  </div>
                </div>
              </article>`).join('')}
          </div>` : '<p class="ms-vide">Tes sorties publiées apparaîtront ici, avec leurs chiffres : collections, notes, avis.</p>'}
      </section>`;
  }

  // ------------------------------------------------------------------
  // L'affiche d'une sortie
  // ------------------------------------------------------------------

  const FORMATS = { carre: [1080, 1080, 'Carré'], post: [1080, 1350, 'Post 4:5'], story: [1080, 1920, 'Story'] };

  function chargerImage(src){
    return new Promise((ok, ko) => {
      const i = new Image();
      i.crossOrigin = 'anonymous';
      i.onload = () => ok(i);
      i.onerror = ko;
      i.src = src;
    });
  }

  // La couleur moyenne de la pochette : la teinte de l'affiche.
  function teinte(img){
    const c = document.createElement('canvas'); c.width = c.height = 8;
    const x = c.getContext('2d');
    x.drawImage(img, 0, 0, 8, 8);
    let r = 0, g = 0, b = 0;
    const d = x.getImageData(0, 0, 8, 8).data;
    for(let i = 0; i < d.length; i += 4){ r += d[i]; g += d[i + 1]; b += d[i + 2]; }
    const n = d.length / 4;
    return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
  }

  function lignes(ctx, texte, largeur, max){
    const mots = String(texte).split(/\s+/);
    const out = [];
    let ligne = '';
    mots.forEach(m => {
      const essai = ligne ? ligne + ' ' + m : m;
      if(ctx.measureText(essai).width > largeur && ligne){ out.push(ligne); ligne = m; } else ligne = essai;
    });
    if(ligne) out.push(ligne);
    if(out.length > max){ out.length = max; out[max - 1] = out[max - 1].replace(/\s*\S*$/, '') + '…'; }
    return out;
  }

  function rect(ctx, x, y, w, h, r){
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  function dessinerAffiche(canvas, img, s, opt){

    const [W, H] = FORMATS[opt.format];
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    const [r, g, b] = teinte(img);
    const police = '"Public Sans", system-ui, -apple-system, "Segoe UI", sans-serif';

    // Fond : la pochette en grand et floue, une teinte, un dégradé sombre vers le bas.
    ctx.fillStyle = 'rgb(' + Math.round(r * .35) + ',' + Math.round(g * .35) + ',' + Math.round(b * .35) + ')';
    ctx.fillRect(0, 0, W, H);

    const echelle = Math.max(W / img.width, H / img.height);
    try{ ctx.filter = 'blur(48px) saturate(1.3)'; }catch(e){}
    ctx.drawImage(img, (W - img.width * echelle) / 2, (H - img.height * echelle) / 2, img.width * echelle, img.height * echelle);
    ctx.filter = 'none';

    const degrade = ctx.createLinearGradient(0, 0, 0, H);
    degrade.addColorStop(0, 'rgba(0,0,0,.08)'); degrade.addColorStop(.55, 'rgba(0,0,0,.3)'); degrade.addColorStop(1, 'rgba(0,0,0,.72)');
    ctx.fillStyle = degrade;
    ctx.fillRect(0, 0, W, H);

    // La pochette, carrée, ombrée.
    const taille = Math.round(W * (opt.format === 'story' ? .78 : opt.format === 'carre' ? .5 : .66));
    const x0 = Math.round((W - taille) / 2);
    const y0 = opt.format === 'carre' ? Math.round(H * .09) : opt.format === 'story' ? Math.round(H * .13) : Math.round(H * .08);

    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 70; ctx.shadowOffsetY = 28;
    rect(ctx, x0, y0, taille, taille, 28);
    ctx.fillStyle = '#000'; ctx.fill();
    ctx.restore();

    ctx.save();
    rect(ctx, x0, y0, taille, taille, 28);
    ctx.clip();
    ctx.drawImage(img, x0, y0, taille, taille);
    ctx.restore();

    // Les textes, centrés sous la pochette.
    const cx = W / 2;
    let y = y0 + taille + (opt.format === 'carre' ? 70 : 100);
    ctx.textAlign = 'center';

    ctx.font = '700 34px ' + police;
    try{ ctx.letterSpacing = '8px'; }catch(e){}
    ctx.fillStyle = 'rgba(255,255,255,.78)';
    ctx.fillText(String(s.artiste || '').toUpperCase().slice(0, 40), cx, y);
    try{ ctx.letterSpacing = '0px'; }catch(e){}

    y += opt.format === 'carre' ? 78 : 104;
    ctx.fillStyle = '#fff';
    const corps = opt.format === 'carre' ? 74 : 92;
    ctx.font = '800 ' + corps + 'px ' + police;
    lignes(ctx, s.titre, W - 160, 2).forEach(l => { ctx.fillText(l, cx, y); y += corps * 1.08; });

    if(opt.date){
      y += 18;
      const futur = s.date && new Date(s.date + 'T00:00:00').getTime() > Date.now();
      const texte = s.date ? (futur ? 'DISPONIBLE LE ' + dateLongue(s.date).toUpperCase() : 'DISPONIBLE MAINTENANT') : '';
      if(texte){
        ctx.font = '700 36px ' + police;
        const lar = ctx.measureText(texte).width + 72;
        rect(ctx, cx - lar / 2, y - 44, lar, 68, 34);
        ctx.fillStyle = 'rgb(' + Math.min(255, r + 70) + ',' + Math.min(255, g + 70) + ',' + Math.min(255, b + 70) + ')';
        ctx.fill();
        ctx.fillStyle = '#05070a';
        ctx.fillText(texte, cx, y + 4);
      }
    }

    ctx.fillStyle = 'rgba(255,255,255,.7)';
    ctx.font = '600 32px ' + police;
    ctx.fillText('lawave.fr', cx, H - 64);
  }

  async function affiche(i){

    const s = (window.__mesSorties || [])[i];

    if(!s) return;

    const voile = document.createElement('div');
    voile.className = 'aff-voile';
    voile.setAttribute('role', 'dialog');
    voile.setAttribute('aria-modal', 'true');
    voile.setAttribute('aria-label', 'Affiche de ' + s.titre);
    voile.innerHTML = `
      <div class="aff-boite">
        <button type="button" class="aff-fermer" aria-label="Fermer">✕</button>
        <h3>Affiche de « ${esc(s.titre)} »</h3>
        <div class="aff-corps">
          <div class="aff-apercu"><canvas></canvas></div>
          <div class="aff-reglages">
            <label>Format
              <select data-a="format">${Object.entries(FORMATS).map(([k, v]) => `<option value="${k}"${k === 'post' ? ' selected' : ''}>${esc(v[2])} (${v[0]}×${v[1]})</option>`).join('')}</select>
            </label>
            <label class="aff-case"><input type="checkbox" data-a="date" checked> Afficher la date de sortie</label>
            <button type="button" class="btn btn-primary" data-a="telecharger">Télécharger l'image</button>
            <p class="aff-aide">Une image PNG, prête à publier sur Instagram, TikTok ou X.</p>
            <p class="aff-erreur" hidden></p>
          </div>
        </div>
      </div>`;
    document.body.appendChild(voile);

    const canvas = voile.querySelector('canvas');
    const erreur = voile.querySelector('.aff-erreur');
    let img = null;

    const fermer = () => { voile.remove(); document.removeEventListener('keydown', touche); };
    const touche = (e) => { if(e.key === 'Escape') fermer(); };
    document.addEventListener('keydown', touche);

    voile.addEventListener('click', (e) => {
      if(e.target === voile || e.target.closest('.aff-fermer')) fermer();
    });

    const opt = () => ({ format: voile.querySelector('[data-a="format"]').value, date: voile.querySelector('[data-a="date"]').checked });
    const dessiner = () => { if(img) dessinerAffiche(canvas, img, s, opt()); };

    voile.querySelector('[data-a="format"]').addEventListener('change', dessiner);
    voile.querySelector('[data-a="date"]').addEventListener('change', dessiner);

    voile.querySelector('[data-a="telecharger"]').addEventListener('click', () => {
      try{
        canvas.toBlob(blob => {
          if(!blob){ erreur.textContent = "L'image n'a pas pu être créée."; erreur.hidden = false; return; }
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = 'affiche-' + String(s.titre).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '.png';
          document.body.appendChild(a); a.click();
          setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
        }, 'image/png');
      }catch(e){
        erreur.textContent = "Cette pochette ne peut pas être exportée depuis ton navigateur : fais une capture de l'aperçu.";
        erreur.hidden = false;
      }
    });

    try{
      img = await chargerImage(url(s.cover));
      dessiner();
    }catch(e){
      erreur.textContent = "La pochette n'a pas pu être chargée.";
      erreur.hidden = false;
    }
  }

  // ------------------------------------------------------------------
  // Les photos livrées après un événement
  // ------------------------------------------------------------------

  // Une photo allégée : 2 400 px au plus, JPEG à 85 % (un concert, c'est des dizaines de photos : le stockage compte).
  async function reduire(fichier){

    const bitmap = await createImageBitmap(fichier);
    const e = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bitmap.width * e); c.height = Math.round(bitmap.height * e);
    c.getContext('2d').drawImage(bitmap, 0, 0, c.width, c.height);
    if(bitmap.close) bitmap.close();

    return await new Promise((ok, ko) => c.toBlob(b => b ? ok(b) : ko(new Error('Image illisible.')), 'image/jpeg', 0.85));
  }

  async function listerPhotosAccred(){

    const zones = document.querySelectorAll('[data-accred-photos]');

    for(const z of zones){

      const evt = z.dataset.accredPhotos;
      const liste = z.querySelector('.accred-photos-liste');

      try{
        const rep = await supabaseClient.rpc('accreditation_fichiers', { p_evenement: evt });
        if(rep.error) throw rep.error;
        const f = rep.data || [];
        liste.innerHTML = f.length
          ? `<p class="accred-aide" style="margin:8px 0 4px;">${f.length} photo${f.length > 1 ? 's' : ''} déposée${f.length > 1 ? 's' : ''} :</p>
             <ul class="accred-photos-ul">${f.map(x => `
               <li><span>${esc(x.nom || 'photo')}</span><button type="button" onclick="Outils.retirerPhoto('${esc(x.id)}')" aria-label="Retirer cette photo">✕</button></li>`).join('')}</ul>`
          : '';
      }catch(e){ liste.innerHTML = ''; }
    }
  }

  async function deposerPhotos(evt){

    const entree = document.getElementById('accred-fichiers-' + evt);
    const msg = document.getElementById('accred-photos-msg-' + evt);
    const bouton = document.getElementById('accred-photos-bouton-' + evt);

    if(!entree || !entree.files.length) return;

    const fichiers = [...entree.files].filter(f => /^image\//.test(f.type)).slice(0, 40);
    let ok = 0;

    bouton.disabled = true;

    for(let i = 0; i < fichiers.length; i++){

      msg.textContent = 'Envoi de la photo ' + (i + 1) + ' sur ' + fichiers.length + '…';

      try{
        const blob = await reduire(fichiers[i]);
        const chemin = currentUser.id + '/' + evt + '/' + Date.now() + '-' + i + '.jpg';
        const envoi = await supabaseClient.storage.from('livraisons').upload(chemin, blob, { contentType: 'image/jpeg', upsert: false });
        if(envoi.error) throw envoi.error;
        const rep = await supabaseClient.rpc('accreditation_fichier_ajouter', { p_evenement: evt, p_chemin: chemin, p_nom: fichiers[i].name, p_taille: blob.size });
        if(rep.error) throw rep.error;
        ok++;
      }catch(e){
        msg.textContent = 'Envoi interrompu : ' + ((e && e.message) || 'réessaie.');
        break;
      }
    }

    bouton.disabled = false;
    entree.value = '';

    if(ok === fichiers.length) msg.textContent = ok + ' photo' + (ok > 1 ? 's déposées' : ' déposée') + '. L\'équipe les voit dans son espace.';

    listerPhotosAccred();
  }

  async function retirerPhoto(id){

    if(!confirm('Retirer cette photo ?')) return;

    try{
      const rep = await supabaseClient.rpc('accreditation_fichier_supprimer', { p_id: id });
      if(rep.error) throw rep.error;
      listerPhotosAccred();
    }catch(e){
      annoncer('Photo non retirée', e && e.message);
    }
  }

  // Côté équipe : les photos déposées pour un événement (par un photographe, ou par tous), avec un lien pour chacune.
  async function voirPhotosEquipe(evt, user){

    let liste = [];

    try{
      const rep = await supabaseClient.rpc('accreditation_fichiers', { p_evenement: evt });
      if(rep.error) throw rep.error;
      liste = (rep.data || []).filter(f => !user || f.user_id === user);
    }catch(e){
      annoncer('Photos indisponibles', e && e.message);
      return;
    }

    const voile = document.createElement('div');
    voile.className = 'aff-voile';
    voile.setAttribute('role', 'dialog');
    voile.setAttribute('aria-modal', 'true');
    voile.innerHTML = `
      <div class="aff-boite aff-large">
        <button type="button" class="aff-fermer" aria-label="Fermer">✕</button>
        <h3>Photos déposées ${liste.length ? '(' + liste.length + ')' : ''}</h3>
        ${liste.length ? '<div class="aff-photos"></div>' : '<p class="aff-aide">Aucune photo déposée pour le moment.</p>'}
      </div>`;
    document.body.appendChild(voile);

    const fermer = () => { voile.remove(); document.removeEventListener('keydown', touche); };
    const touche = (e) => { if(e.key === 'Escape') fermer(); };
    document.addEventListener('keydown', touche);
    voile.addEventListener('click', (e) => { if(e.target === voile || e.target.closest('.aff-fermer')) fermer(); });

    if(!liste.length) return;

    try{
      const rep = await supabaseClient.storage.from('livraisons').createSignedUrls(liste.map(f => f.chemin), 3600);
      const urls = new Map((rep.data || []).map(x => [x.path, x.signedUrl]));
      voile.querySelector('.aff-photos').innerHTML = liste.map(f => {
        const u = urls.get(f.chemin);
        return u ? `
          <figure>
            <a href="${esc(u)}" target="_blank" rel="noopener noreferrer"><img src="${esc(u)}" alt="" loading="lazy"></a>
            <figcaption>${esc(f.photographe || '')}</figcaption>
          </figure>` : '';
      }).join('');
    }catch(e){
      voile.querySelector('.aff-photos').textContent = 'Les photos ne se chargent pas.';
    }
  }

  // ------------------------------------------------------------------

  function rendre(pageId){
    if(pageId === 'lancement') return lancement();
    if(pageId === 'visite') return visite();
    if(pageId === 'mes-sorties') return mesSorties();
  }

  return {
    rendre, affiche, copierLancement: (n) => copier(partageLancement(n), 'Lien de la page de lancement copié'),
    listerPhotosAccred, deposerPhotos, retirerPhoto, voirPhotosEquipe
  };

})();
