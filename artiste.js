/* =====================================================================
   La Wave — les outils de la page artiste

   Chargé à la demande par index.html (chargerArtisteOutils), à l'ouverture d'une page artiste :
     · l'onglet « Concerts » : concerts à venir, avec lien de billetterie ; l'artiste dont la page est à son compte et
       l'équipe en ajoutent et en retirent (RPC artiste_concerts / artiste_concert_ajouter / artiste_concert_supprimer) ;
     · l'onglet « Statistiques » : privé (l'artiste et l'équipe) — vues de la page, abonnés, collections, note (artiste_stats) ;
     · la frise chronologique de la discographie.

   Voir sql/lot-artiste.sql.
   ===================================================================== */

window.ArtisteOutils = (function(){

  'use strict';

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  const MOIS_LONGS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

  const url = (u) => (typeof safeUrl === 'function' ? safeUrl(u) : (/^https:\/\//i.test(u || '') ? u : ''));

  const partie = (iso) => { const [a, m, j] = String(iso).slice(0, 10).split('-').map(Number); return { a, m, j }; };

  // ------------------------------------------------------------------
  // Concerts
  // ------------------------------------------------------------------

  async function chargerConcerts(a){

    let data = null;

    try{
      const rep = await supabaseClient.rpc('artiste_concerts', { p_handle: a.handle });
      if(rep.error) throw rep.error;
      data = rep.data;
    }catch(e){
      return;
    }

    if(!artisteCourant || artisteCourant.handle !== a.handle || !data) return;

    a.concerts = data;
    dessinerConcerts(a);
  }

  function concertHtml(c){

    const d = partie(c.date);
    const lien = url(c.lien);

    return `
      <li class="art-concert">
        <span class="art-concert-date" aria-hidden="true"><b>${d.j}</b><small>${MOIS[d.m - 1]}</small></span>
        <span class="art-concert-texte">
          <strong>${esc(c.ville)}</strong>
          <small>${esc(c.salle || '')}${c.salle ? ' · ' : ''}<time datetime="${esc(c.date)}">${d.j} ${MOIS_LONGS[d.m - 1]} ${d.a}</time></small>
        </span>
        ${lien ? `<a class="art-concert-billets" href="${esc(lien)}" target="_blank" rel="noopener noreferrer">Billets</a>` : ''}
        ${c.peut_supprimer ? `<button type="button" class="art-concert-suppr" onclick="ArtisteOutils.retirerConcert('${esc(c.id)}')" aria-label="Retirer ce concert">✕</button>` : ''}
      </li>`;
  }

  function dessinerConcerts(a){

    const g = a.concerts;
    const onglet = document.getElementById('artOngletConcerts');
    const panneau = document.getElementById('artPanneauConcerts');

    if(!g || !onglet || !panneau) return;

    const liste = g.concerts || [];
    const aujourdhui = new Date().toISOString().slice(0, 10);

    onglet.hidden = !liste.length && !g.peut_gerer;
    const nb = document.getElementById('artNbConcerts');
    if(nb) nb.textContent = liste.length ? String(liste.length) : '';

    if(onglet.hidden && !panneau.hidden && typeof artisteOnglet === 'function') artisteOnglet('disco');

    panneau.innerHTML = `
      ${g.peut_gerer ? `
        <form class="art-ajout" onsubmit="ArtisteOutils.ajouterConcert(event)">
          <p class="art-ajout-titre">Ajouter un concert</p>
          <div class="art-ajout-champs art-concert-champs">
            <input type="date" id="artConcertDate" min="${aujourdhui}" required aria-label="Date du concert">
            <input type="text" id="artConcertVille" maxlength="80" placeholder="Ville" required aria-label="Ville">
            <input type="text" id="artConcertSalle" maxlength="120" placeholder="Salle ou festival (facultatif)" aria-label="Salle ou festival">
            <input type="url" id="artConcertLien" maxlength="400" placeholder="Lien de billetterie https://… (facultatif)" aria-label="Lien de billetterie">
            <button type="submit" class="btn btn-primary" id="artConcertEnvoi">Ajouter</button>
          </div>
        </form>` : ''}
      ${liste.length
        ? `<ul class="art-concerts">${liste.map(concertHtml).join('')}</ul>`
        : '<p class="art-vide">Aucun concert annoncé pour l\'instant.</p>'}`;
  }

  async function ajouterConcert(ev){

    ev.preventDefault();

    const a = artisteCourant;
    const bouton = document.getElementById('artConcertEnvoi');

    if(!a) return;

    bouton.disabled = true;

    try{
      const { error } = await supabaseClient.rpc('artiste_concert_ajouter', {
        p_handle: a.handle,
        p_date: document.getElementById('artConcertDate').value,
        p_ville: document.getElementById('artConcertVille').value,
        p_salle: document.getElementById('artConcertSalle').value || null,
        p_lien: document.getElementById('artConcertLien').value || null
      });
      if(error) throw error;
      notifier('Concert ajouté', { detail: 'Il apparaît dans l\'onglet Concerts.' });
      await chargerConcerts(a);
    }catch(e){
      notifier('Concert non ajouté', { detail: (e && e.message) || 'Réessaie dans un instant.', type: 'erreur' });
      bouton.disabled = false;
    }
  }

  async function retirerConcert(id){

    if(!confirm('Retirer ce concert ?')) return;

    try{
      const { error } = await supabaseClient.rpc('artiste_concert_supprimer', { p_id: id });
      if(error) throw error;
      await chargerConcerts(artisteCourant);
    }catch(e){
      notifier('Concert non retiré', { detail: (e && e.message) || 'Réessaie dans un instant.', type: 'erreur' });
    }
  }

  // ------------------------------------------------------------------
  // Statistiques (privées)
  // ------------------------------------------------------------------

  function courbeVues(vues){

    const max = Math.max(1, ...vues.map(v => v.nb));
    const L = 600, H = 120, pas = L / vues.length;

    const barres = vues.map((v, i) => {
      const h = Math.max(v.nb ? 3 : 1, Math.round((v.nb / max) * (H - 18)));
      return `<rect x="${(i * pas + pas * 0.15).toFixed(1)}" y="${H - h}" width="${(pas * 0.7).toFixed(1)}" height="${h}" rx="2"
                    class="${v.nb ? 'on' : ''}"><title>${esc(v.jour)} : ${v.nb} vue${v.nb > 1 ? 's' : ''}</title></rect>`;
    }).join('');

    return `<svg class="art-courbe" viewBox="0 0 ${L} ${H}" preserveAspectRatio="none" role="img" aria-label="Vues par jour">${barres}</svg>`;
  }

  async function chargerStats(a){

    const panneau = document.getElementById('artPanneauStats');
    const onglet = document.getElementById('artOngletStats');

    if(!panneau || !onglet || !a.concerts) return;

    // Seuls l'artiste et l'équipe ont l'onglet (la base refuse les autres de toute façon).
    if(!a.concerts.peut_gerer){ onglet.hidden = true; return; }

    onglet.hidden = false;
    panneau.innerHTML = '<p class="art-vide">Chargement des statistiques…</p>';

    let s = null;

    try{
      const rep = await supabaseClient.rpc('artiste_stats', { p_handle: a.handle, p_jours: 30 });
      if(rep.error) throw rep.error;
      s = rep.data;
    }catch(e){
      panneau.innerHTML = '<p class="art-vide">Les statistiques ne sont pas disponibles pour le moment.</p>';
      return;
    }

    if(!artisteCourant || artisteCourant.handle !== a.handle || !s) return;

    const carte = (valeur, libelle, detail) => `
      <div class="art-stat"><b>${esc(valeur)}</b><span>${esc(libelle)}</span>${detail ? `<small>${esc(detail)}</small>` : ''}</div>`;

    panneau.innerHTML = `
      <p class="art-stats-note">Visible par toi et par l'équipe uniquement · ${s.jours} derniers jours</p>
      <div class="art-stats-cartes">
        ${carte(s.vues_total, 'vues de ta page', '')}
        ${carte(s.abonnes, 'abonnés', s.abonnes_nouveaux ? '+' + s.abonnes_nouveaux + ' sur la période' : '')}
        ${carte(s.en_collection, 'en collection', 'membres qui ont gardé une de tes sorties')}
        ${carte(s.note_moyenne != null ? s.note_moyenne + ' / 5' : '—', 'note moyenne', s.nb_notes ? s.nb_notes + ' note' + (s.nb_notes > 1 ? 's' : '') : 'pas encore de note')}
      </div>
      <p class="art-stats-titre">Vues par jour</p>
      ${courbeVues(s.vues || [])}
      ${(s.top_sorties || []).length ? `
        <p class="art-stats-titre">Tes sorties les plus gardées</p>
        <ol class="art-stats-top">
          ${s.top_sorties.map(t => `
            <li><img src="${esc(url(t.cover))}" alt="" loading="lazy"><span>${esc(t.titre)}</span><b>${t.nb}</b></li>`).join('')}
        </ol>` : ''}`;
  }

  // ------------------------------------------------------------------
  // Frise chronologique
  // ------------------------------------------------------------------

  function friseHtml(sorties, handle){

    const triees = sorties.slice().sort((x, y) => String(y.releaseDate || '').localeCompare(String(x.releaseDate || '')));
    const parAnnee = new Map();

    triees.forEach(s => {
      const an = s.releaseDate ? String(s.releaseDate).slice(0, 4) : 'Date inconnue';
      if(!parAnnee.has(an)) parAnnee.set(an, []);
      parAnnee.get(an).push(s);
    });

    return `
      <ol class="art-frise">
        ${[...parAnnee.entries()].map(([an, liste]) => `
          <li class="art-frise-annee">
            <h4>${esc(an)}</h4>
            <ul>
              ${liste.map(s => {
                const d = s.releaseDate ? partie(s.releaseDate) : null;
                const siennes = (s.artistHandle || (typeof instagramHandle === 'function' ? instagramHandle(s.instagram) : '')) === handle;
                return `
                  <li>
                    <button type="button" class="art-frise-sortie" onclick="openCatalogueModal('${esc(s.id)}')">
                      <img src="${esc(url(s.cover))}" alt="" loading="lazy">
                      <span>
                        <strong>${esc(s.title)}</strong>
                        <small>${esc(s.releaseType || '')}${d ? ' · ' + d.j + ' ' + MOIS_LONGS[d.m - 1] : ''}${siennes ? '' : ' · en featuring'}</small>
                      </span>
                    </button>
                  </li>`;
              }).join('')}
            </ul>
          </li>`).join('')}
      </ol>`;
  }

  // ------------------------------------------------------------------

  async function monter(a){

    if(!a) return;

    await chargerConcerts(a);
    await chargerStats(a);
  }

  return { monter, friseHtml, ajouterConcert, retirerConcert };

})();
