/* =====================================================================
   La Wave — Wave Cards : les modes de combat contre le jeu (Tour, Champions, Ligue)

   Chargé par combat.js (tout module « combat-… » déclaré dans WAVE_MODULES, index.html, est chargé à l'ouverture de l'onglet Combat).
   Il enregistre trois tuiles dans le hub (WaveCombat.modes.enregistrer) et un onglet « Contre le jeu » dans la console de l'équipe
   (WaveCombat.equipeVues.enregistrer). Le moteur et tous les calculs vivent dans la base (sql/combat-pve-*.sql) : ce fichier demande,
   affiche et lance les combats (api.lancerCombat avec rpc: 'combat_pve_…').

   LES TROIS MODES
     La Tour        étages à gravir en 4 difficultés (Classique, Difficile, HELL, Abysse) ; un gardien tous les 10 étages ;
                    récompenses à la première victoire de chaque étage ; progression par joueur et par difficulté ; reprise à l'étage atteint.
     Les Champions  un champion par style de carte + un champion du jour ; récompense unique à la première victoire,
                    puis une revanche quotidienne réduite (plafonnée par jour).
     La Ligue       le Conseil des 4 puis le Maître, enchaînés ; une tentative par jour (quelques défaites permises) ;
                    récompense à la victoire complète, bonus si aucune défaite.
   ===================================================================== */

(function(){

  'use strict';

  const WC = window.WaveCombat;
  if(!WC || !WC.modes) return;

  let A = null;   // l'interface partagée du jeu (window.Cartes.api), reçue à l'ouverture d'un mode
  const P = { cle: undefined, promesse: null, diff: null, eq: 'reglages', eqDonnees: null };

  const api0 = () => A || (window.Cartes && window.Cartes.api);
  const esc = (t) => api0().esc(t);
  const nf = (n) => api0().nf(n);
  const couleur = (c) => api0().couleurOk(c || '#9aa4b2');
  const pl = (n, mot) => n + ' ' + mot + (n > 1 ? 's' : '');
  const chip = (nom, c) => nom ? `<span class="cb-type" style="--tc:${couleur(c)}">${esc(nom)}</span>` : '<span class="cb-type neutre">Neutre</span>';
  const roleChip = (nom) => nom ? `<span class="cb-role">${esc(nom)}</span>` : '';

  const CSS = `
  .pv-barre{height:8px; border-radius:99px; background:rgba(255,255,255,.08); overflow:hidden; margin-top:12px;}
  .pv-barre i{display:block; height:100%; border-radius:99px; background:var(--ct-accent, #4FB4FF); transition:width .5s ease;}
  .pv-etage{display:grid; gap:14px;}
  .pv-etage-t{display:flex; flex-wrap:wrap; align-items:center; gap:8px 12px;}
  .pv-etage-t h3{margin:0; font-size:18px; letter-spacing:-.01em;}
  .pv-etage.gardien{border-color:rgba(242,193,78,.55);}
  .pv-gardiens{display:grid; grid-template-columns:repeat(auto-fill, minmax(104px, 1fr)); gap:8px;}
  .pv-g{display:grid; gap:3px; padding:10px 8px; border-radius:12px; border:1px solid var(--ct-trait); background:var(--ct-surface); text-align:center; font-size:11.5px; line-height:1.35; color:var(--ink-soft);}
  .pv-g b{font-size:16px; color:var(--ink); font-variant-numeric:tabular-nums;}
  .pv-g.fait{border-color:rgba(91,224,166,.5); background:rgba(91,224,166,.08);}
  .pv-g.fait b{color:#5BE0A6;}
  .pv-rej{display:flex; flex-wrap:wrap; align-items:center; gap:8px 10px; font-size:13px; color:var(--ink-soft);}
  .pv-rej input{width:84px; height:36px; padding:0 10px; border-radius:10px; border:1px solid var(--ct-trait); background:var(--ct-surface); color:var(--ink); font:inherit; font-size:14px;}
  .pv-champs{display:grid; grid-template-columns:repeat(auto-fill, minmax(250px, 1fr)); gap:12px;}
  .pv-champ{display:grid; gap:10px; align-content:start; padding:14px; border-radius:18px; border:1px solid color-mix(in srgb, var(--tc, #4FB4FF) 45%, transparent); background:linear-gradient(160deg, color-mix(in srgb, var(--tc, #4FB4FF) 14%, transparent), rgba(255,255,255,.02));}
  .pv-champ.jour{border-color:rgba(242,193,78,.6);}
  .pv-champ-t{display:flex; align-items:center; gap:12px;}
  .pv-champ h4{margin:0; font-size:16px; line-height:1.25;}
  .pv-champ p{margin:0; font-size:12.5px; line-height:1.45; color:var(--muted);}
  .pv-champ .pied{display:flex; flex-wrap:wrap; gap:6px;}
  .pv-vies{display:inline-flex; align-items:center; gap:5px;}
  .pv-vies i{width:12px; height:12px; border-radius:50%; background:#FF7A85;}
  .pv-vies i.perdu{background:rgba(255,255,255,.16);}
  .pv-jour{margin-bottom:18px;}
  .pv-pick{display:grid; gap:6px; grid-column:1 / -1; padding:10px; border-radius:12px; background:var(--ct-surface-2);}
  .pv-pick b{color:var(--ink);}
  .pv-reg{display:grid; grid-template-columns:repeat(auto-fit, minmax(240px, 1fr)); gap:10px;}
  .pv-reg label{display:grid; gap:5px; font-size:12px; font-weight:700; color:var(--ink-soft); padding:10px 12px; border-radius:12px; background:var(--ct-surface); border:1px solid var(--ct-trait);}
  @media (max-width: 520px){
    .pv-champs{grid-template-columns:1fr;}
    .pv-gardiens{grid-template-columns:repeat(auto-fill, minmax(88px, 1fr));}
  }
  `;

  function css(){
    if(document.getElementById('pve-style')) return;
    const s = document.createElement('style');
    s.id = 'pve-style';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  // L'état des trois modes : une seule lecture par accueil du combat (l'objet S.acc change après chaque combat).
  function charger(acc, force){
    if(force || !P.promesse || P.cle !== acc){
      P.cle = acc;
      P.promesse = api0().appel('combat_pve_accueil');
      P.promesse.catch(() => { P.promesse = null; });
    }
    return P.promesse;
  }

  const entete = (titre, sous) => `<div class="ct-titre-sec" style="margin-top:0"><h3>${esc(titre)}</h3></div>${sous ? `<p class="sous" style="margin:-6px 0 14px; font-size:13px; color:var(--muted); line-height:1.5">${sous}</p>` : ''}`;

  const recompense = (r) => {
    if(!r) return '';
    const l = [];
    if(r.vinyles) l.push(`<span class="cb-puce or">+${pl(r.vinyles, 'vinyle')}</span>`);
    if(r.wc) l.push(`<span class="cb-puce or">+${nf(r.wc)} WC</span>`);
    return l.join('');
  };

  const portraits = (crew) => `<div class="cb-portraits">${(crew || []).map((c) => `<img style="--tc:${couleur(c.couleur)}" src="${esc(api0().safeUrl(c.photo))}" alt="${esc(c.nom)}" title="${esc(c.nom)} · ${esc(c.type_nom || '')} · ${esc(c.role_nom || '')}" loading="lazy">`).join('')}</div>`;

  const slot = (c) => `<div class="cb-slot" style="--tc:${couleur(c.couleur)}">
      ${api0().carteHtml({ nom: c.nom, photo: c.photo, rarete: c.rarete, holo: c.holo, numero: c.numero || 0 }, {})}
      <div class="cb-slot-i"><b>${esc(c.nom)}</b><div class="cb-roles">${chip(c.type_nom, c.couleur)}${roleChip(c.role_nom)}</div>
        <div class="cb-mini-stats" style="margin-top:5px"><span>PV <b>${nf(c.pv)}</b></span><span>PUI <b>${nf(c.pui)}</b></span><span>DÉF <b>${nf(c.def)}</b></span><span>VIT <b>${nf(c.vit)}</b></span></div></div>
    </div>`;

  // ---------------------------------------------------------------------
  // La Tour
  // ---------------------------------------------------------------------

  function vueTour(hote, api, acc){
    const D = acc.tour;
    if(!D.length){ hote.innerHTML = '<div class="ct-panneau ct-vide"><b>La Tour est fermée</b>Reviens bientôt.</div>'; return; }
    if(!D.some((x) => x.id === P.diff)) P.diff = (D.filter((x) => x.debloque && x.etage_max > 0 && x.etage_max < x.etages).pop() || D.find((x) => x.debloque && x.etage_max < x.etages) || D[0]).id;
    const d = D.find((x) => x.id === P.diff);
    const pc = Math.min(100, d.etages ? d.etage_max / d.etages * 100 : 0);
    const pr = d.prochain;

    let corps;
    if(!d.debloque){
      corps = `<div class="ct-vide" style="padding:22px">${api.ico('cadenas', 22)}<b style="display:block; margin-top:8px">Difficulté verrouillée</b>Atteins l'étage ${d.deblocage_etage} en ${esc(d.precedente || 'difficulté précédente')} pour l'ouvrir.</div>`;
    }else if(pr){
      corps = `<div class="pv-etage ${pr.gardien ? 'gardien' : ''}">
        <div class="pv-etage-t"><h3>${pr.gardien ? 'Gardien du palier ' + pr.etage : 'Étage ' + pr.etage}</h3>
          ${pr.gardien ? '<span class="cb-puce or">Gardien</span>' : ''}<span class="cb-puce">Stats ${pr.bonus >= 0 ? '+' : '−'}${Math.abs(pr.bonus)} %</span>${recompense(pr.recompense)}</div>
        <div class="cb-bloc-duo"><div class="cb-duo">${pr.crew.map(slot).join('')}</div>
          <div class="cb-actions"><button type="button" class="ct-btn principal" data-monter>${d.etage_max ? 'Monter à l\'étage ' + pr.etage : 'Commencer l\'ascension'}</button>
            <p>Première victoire sur un étage : récompense. Tu reprends toujours à l'étage atteint.</p></div></div>
      </div>`;
    }else{
      corps = `<div class="ct-vide" style="padding:22px"><b>Tour gravie !</b>Tu as terminé les ${d.etages} étages en ${esc(d.nom)}. Rejoue l'étage de ton choix ci-dessous, ou tente une autre difficulté.</div>`;
    }

    hote.innerHTML = `${entete('La Tour', 'Gravis les étages un à un. Un gardien t\'attend tous les 10 étages ; plus tu montes, plus tes adversaires sont connus et solides.')}
      <nav class="cb-seg mini" aria-label="Difficulté">${D.map((x) => `<button type="button" data-d="${esc(x.id)}" aria-pressed="${x.id === d.id}">${x.debloque ? '' : api.ico('cadenas', 13) + '&nbsp;'}${esc(x.nom)}</button>`).join('')}</nav>
      <section class="ct-panneau" style="margin-top:14px">
        <p class="sous" style="margin:0 0 10px; font-size:13px; color:var(--muted); line-height:1.5">${esc(d.resume)}</p>
        <div class="cb-chiffres" style="margin:0 0 4px"><span>Étage atteint <b>${d.etage_max} / ${d.etages}</b></span><span><b>${d.victoires}</b> victoire${d.victoires > 1 ? 's' : ''}</span><span><b>${d.defaites}</b> défaite${d.defaites > 1 ? 's' : ''}</span></div>
        <div class="pv-barre" role="progressbar" aria-valuemin="0" aria-valuemax="${d.etages}" aria-valuenow="${d.etage_max}"><i style="width:${pc}%"></i></div>
        <div style="margin-top:16px">${corps}</div>
        ${d.debloque && d.etage_max > 0 ? `<div class="pv-rej" style="margin-top:16px; padding-top:14px; border-top:1px solid var(--ct-trait)">
          <label for="pv-rej-n">Rejouer un étage déjà franchi (sans récompense)</label>
          <input id="pv-rej-n" type="number" min="1" max="${d.etage_max}" value="${d.etage_max}" inputmode="numeric">
          <button type="button" class="ct-btn petit" data-rejouer>Rejouer</button></div>` : ''}
      </section>
      <section style="margin-top:18px">
        <div class="ct-titre-sec" style="margin-top:0"><h3>Les gardiens</h3></div>
        <div class="pv-gardiens">${d.gardiens.map((g) => `<div class="pv-g${g.fait ? ' fait' : ''}"><b>${g.fait ? api.ico('coche', 14) + ' ' : ''}${g.etage}</b>
          <span>${g.recompense.vinyles ? '+' + pl(g.recompense.vinyles, 'vinyle') + '<br>' : ''}+${nf(g.recompense.wc)} WC</span></div>`).join('')}</div>
      </section>`;

    hote.querySelectorAll('[data-d]').forEach((b) => b.addEventListener('click', () => { P.diff = b.dataset.d; vueTour(hote, api, acc); }));
    const m = hote.querySelector('[data-monter]');
    if(m) m.addEventListener('click', () => api.lancerCombat({ rpc: 'combat_pve_tour', params: { p_difficulte: d.id, p_etage: null }, titre: d.nom + ' · ' + pr.nom, adversaires: pr.crew }));
    const rj = hote.querySelector('[data-rejouer]');
    if(rj) rj.addEventListener('click', () => {
      const n = Math.floor(Number(hote.querySelector('#pv-rej-n').value));
      if(!(n >= 1 && n <= d.etage_max)){ api.toast('Choisis un étage entre 1 et ' + d.etage_max + '.', 'err'); return; }
      api.lancerCombat({ rpc: 'combat_pve_tour', params: { p_difficulte: d.id, p_etage: n }, titre: d.nom + ' · Étage ' + n });
    });
  }

  // ---------------------------------------------------------------------
  // Les champions
  // ---------------------------------------------------------------------

  function carteChampion(c, api, jour){
    const vaincu = c.etat === 'vaincu';
    const fait = jour && c.fait;
    let pied;
    if(jour) pied = fait ? '<span class="cb-puce ok">Battu aujourd\'hui</span><span class="cb-puce">Reviens demain</span>' : `<span class="cb-puce or">Une fois par jour</span>${recompense(c.recompense)}`;
    else if(!vaincu) pied = `<span class="cb-puce or">1re victoire</span>${recompense(c.recompense)}`;
    else pied = `<span class="cb-puce ok">Battu ×${c.victoires}</span>${c.revanche_prete ? '<span class="cb-puce or">Revanche récompensée</span>' : '<span class="cb-puce">Revanche sans gain aujourd\'hui</span>'}`;
    const bouton = jour ? (fait ? 'Rejouer pour le plaisir' : 'Défier') : (vaincu ? 'Revanche' : 'Défier');
    return `<article class="pv-champ${jour ? ' jour' : ''}" style="--tc:${couleur(c.couleur)}">
      <div class="pv-champ-t">${portraits(c.crew)}<div><h4>${esc(c.nom)}</h4>${chip(c.type_nom, c.couleur)}</div></div>
      ${c.description ? `<p>${esc(c.description)}</p>` : ''}
      <div class="pied">${c.crew.map((u) => `<span class="cb-puce">${esc(u.nom)}</span>`).join('')}<span class="cb-puce">Stats +${c.bonus} %</span></div>
      <div class="pied">${pied}</div>
      <button type="button" class="ct-btn ${(!vaincu && !jour) || (jour && !fait) ? 'principal' : ''}" data-champion="${esc(jour ? 'jour' : c.id)}">${bouton}</button>
    </article>`;
  }

  function vueChampions(hote, api, acc){
    const L = acc.champions, j = acc.champion_jour;
    const vaincus = L.filter((c) => c.etat === 'vaincu').length;
    hote.innerHTML = `${entete('Les champions', 'Un champion garde chaque style de rap. Bats-le une fois pour sa récompense ; ensuite, tu peux le défier à nouveau pour une récompense réduite (' + pl(acc.revanches_restantes, 'revanche') + ' récompensée' + (acc.revanches_restantes > 1 ? 's' : '') + ' aujourd\'hui).')}
      <div class="pv-jour">${carteChampion(Object.assign({ etat: 'nouveau', victoires: 0, description: 'Un style différent chaque jour, un duo différent chaque jour.' }, j), api, true)}</div>
      <div class="ct-titre-sec" style="margin-top:0"><h3>Les champions de style</h3><span class="cb-puce ${vaincus === L.length && L.length ? 'ok' : ''}">${vaincus} / ${L.length} battus</span></div>
      <div class="pv-champs">${L.map((c) => carteChampion(c, api, false)).join('')}</div>`;
    hote.querySelectorAll('[data-champion]').forEach((b) => b.addEventListener('click', () => {
      const id = b.dataset.champion;
      const c = id === 'jour' ? j : L.find((x) => x.id === id);
      api.lancerCombat({ rpc: 'combat_pve_champion', params: { p_champion: id }, titre: c.nom, adversaires: c.crew });
    }));
  }

  // ---------------------------------------------------------------------
  // La Ligue
  // ---------------------------------------------------------------------

  function vueLigue(hote, api, acc){
    const l = acc.ligue, r = l.recompenses;
    const actif = l.etat === 'libre' || l.etat === 'en_cours';
    const vies = Array.from({ length: l.vies }, (_, i) => `<i class="${i < l.defaites ? 'perdu' : ''}"></i>`).join('');
    const nb = l.membres.length;
    let bandeau = '';
    if(l.etat === 'gagnee') bandeau = `<div class="cb-banniere" style="border-color:rgba(91,224,166,.5); background:rgba(91,224,166,.08)"><div><b>Ligue vaincue aujourd'hui</b>${l.parfait ? 'Sans aucune défaite : bravo !' : 'Reviens demain pour une nouvelle tentative.'}</div></div>`;
    else if(l.etat === 'perdue') bandeau = '<div class="cb-banniere" style="border-color:rgba(255,122,133,.5); background:rgba(255,122,133,.08)"><div><b>Tentative terminée</b>Tu n\'as plus de vie pour aujourd\'hui. Reviens demain pour réessayer !</div></div>';
    hote.innerHTML = `${entete('La Ligue', 'Affronte le Conseil des 4 puis le Maître, dans l\'ordre. Une tentative par jour : tu peux perdre ' + pl(l.vies - 1, 'combat') + ' sans être éliminé, mais pas plus.')}
      ${bandeau}
      <section class="ct-panneau" style="margin:${bandeau ? '14px' : '0'} 0 16px">
        <div class="cb-chiffres" style="margin:0 0 12px"><span>Siège <b>${Math.min(l.etape + (l.etat === 'gagnee' ? 0 : 1), nb)} / ${nb}</b></span>
          <span class="pv-vies" title="Vies restantes" style="padding:6px 10px">Vies&nbsp;<span class="pv-vies">${vies}</span></span><span><b>${l.victoires}</b> victoire${l.victoires > 1 ? 's' : ''} complète${l.victoires > 1 ? 's' : ''}</span></div>
        <div class="pied" style="display:flex; flex-wrap:wrap; gap:6px"><span class="cb-puce or">Victoire complète</span>${recompense({ vinyles: r.vinyles, wc: r.wc })}
          <span class="cb-puce or">Sans défaite</span>${recompense({ vinyles: r.parfait_vinyles, wc: r.parfait_wc })}
          ${l.premiere_faite ? '' : `<span class="cb-puce or">Première fois</span>${recompense({ vinyles: r.premiere_vinyles, wc: r.premiere_wc })}`}</div>
      </section>
      <div class="cb-liste">${l.membres.map((m) => {
        const act = m.etat === 'actuel' && actif;
        return `<div class="cb-ligne${m.etat === 'a_venir' || (!act && m.etat !== 'vaincu') ? ' verrou' : ''}" style="--tc:${couleur(m.crew[0] && m.crew[0].couleur)}">
          <div class="cb-n">${m.rang}</div>
          <div><h4>${esc(m.nom)} ${m.maitre ? '<span class="cb-puce or">Maître</span>' : ''}</h4><p>${esc(m.description)}</p>
            <div style="display:flex; align-items:center; gap:10px; margin-top:8px; flex-wrap:wrap">${portraits(m.crew)}
              <span class="cb-slot-i">${m.crew.map((c) => esc(c.nom)).join(' &amp; ')}</span>${m.crew.map((c) => chip(c.type_nom, c.couleur)).join('')}<span class="cb-puce">Stats +${m.bonus} %</span></div></div>
          ${m.etat === 'vaincu' ? '<span class="cb-puce ok">Vaincu</span>' : `<button type="button" class="ct-btn petit ${act ? 'principal' : ''}" data-siege="${m.rang}" ${act ? '' : 'disabled'}>${act ? 'Combattre' : (m.etat === 'actuel' ? 'Terminé' : 'À venir')}</button>`}
        </div>`;
      }).join('')}</div>`;
    hote.querySelectorAll('[data-siege]').forEach((b) => b.addEventListener('click', () => {
      const m = l.membres.find((x) => String(x.rang) === b.dataset.siege);
      api.lancerCombat({ rpc: 'combat_pve_ligue', params: {}, titre: m.nom, adversaires: m.crew });
    }));
  }

  // ---------------------------------------------------------------------
  // Le hub : les trois tuiles
  // ---------------------------------------------------------------------

  const ouvrirMode = (vue) => async (hote, api) => {
    A = api;
    css();
    hote.innerHTML = '<div class="ct-vide">Chargement…</div>';
    const acc = await charger(api.acc(), true);
    vue(hote, api, acc);
  };

  WC.modes.enregistrer({ id: 'pve_tour', titre: 'La Tour', groupe: 'jeu', icone: 'drapeau',
    resume: async (acc) => {
      const a = await charger(acc);
      const en = a.tour.filter((d) => d.etage_max > 0).pop();
      return en ? `${en.nom} · étage ${en.etage_max} / ${en.etages}` : `${a.tour[0] ? a.tour[0].etages : 100} étages · ${a.tour.length} difficultés`;
    },
    ouvrir: ouvrirMode(vueTour) });

  WC.modes.enregistrer({ id: 'pve_champion', titre: 'Les champions', groupe: 'jeu', icone: 'etoile',
    resume: async (acc) => {
      const a = await charger(acc);
      const v = a.champions.filter((c) => c.etat === 'vaincu').length;
      return `${v} / ${a.champions.length} champions battus${a.champion_jour.fait ? '' : ' · champion du jour'}`;
    },
    ouvrir: ouvrirMode(vueChampions) });

  WC.modes.enregistrer({ id: 'pve_ligue', titre: 'La Ligue', groupe: 'jeu', icone: 'trophee',
    resume: async (acc) => {
      const l = (await charger(acc)).ligue;
      if(l.etat === 'gagnee') return 'Vaincue aujourd\'hui · reviens demain';
      if(l.etat === 'perdue') return 'Tentative terminée · reviens demain';
      if(l.etat === 'en_cours') return `Siège ${l.etape + 1} / ${l.membres.length} en cours`;
      return 'Une tentative par jour';
    },
    ouvrir: ouvrirMode(vueLigue) });

  // ---------------------------------------------------------------------
  // La console de l'équipe : l'onglet « Contre le jeu »
  // ---------------------------------------------------------------------

  const OPT = (valeur, texte, sel) => `<option value="${esc(valeur)}"${String(sel) === String(valeur) ? ' selected' : ''}>${esc(texte)}</option>`;
  const DECORS = [['concert', 'Concert (arène)'], ['studio', 'Club (briques et néon)'], ['plateau', 'Plateau télé'], ['ruelle', 'Concert de rue'], ['toit', 'Toit au coucher du soleil']];

  // Un sélecteur d'artiste : recherche (3 lettres), puis choix dans la liste.
  function pickerHtml(n, id, nom){
    return `<div class="pv-pick" data-pick="${n}"><input type="hidden" data-k="artist${n}" value="${esc(id)}">
      <span>Artiste ${n} : <b data-nom>${esc(nom)}</b></span>
      <input class="cb-champ-eq" type="search" placeholder="Chercher un autre artiste (3 lettres)" data-q aria-label="Chercher l'artiste ${n}">
      <select class="cb-champ-eq" data-res hidden aria-label="Résultats"></select></div>`;
  }

  function pickerBranche(zone){
    zone.querySelectorAll('[data-pick]').forEach((p) => {
      let t = null;
      const sel = p.querySelector('[data-res]');
      p.querySelector('[data-q]').addEventListener('input', (ev) => {
        clearTimeout(t);
        const q = ev.target.value.trim();
        if(q.length < 3){ sel.hidden = true; return; }
        t = setTimeout(async () => {
          try{
            const l = (await A.appel('combat_equipe_cartes', { p_q: q })).slice(0, 12);
            sel.innerHTML = '<option value="">— choisir —</option>' + l.map((c) => OPT(c.artist_id, c.nom, '')).join('');
            sel.hidden = !l.length;
            sel._liste = l;
          }catch(e){ A.toast(e.message, 'err'); }
        }, 350);
      });
      sel.addEventListener('change', () => {
        const c = (sel._liste || []).find((x) => x.artist_id === sel.value);
        if(!c) return;
        p.querySelector('[data-k]').value = c.artist_id;
        p.querySelector('[data-nom]').textContent = c.nom;
        sel.hidden = true;
      });
    });
  }

  const lire = (zone) => { const v = {}; zone.querySelectorAll('[data-k]').forEach((x) => { v[x.dataset.k] = x.type === 'checkbox' ? x.checked : x.value; }); return v; };
  const champ = (k, etiquette, valeur, extra) => `<label>${esc(etiquette)}<input class="cb-champ-eq" data-k="${k}" value="${esc(valeur)}" ${extra || ''}></label>`;
  const nombre = (k, etiquette, valeur, min, max, pas) => champ(k, etiquette, valeur, `type="number" min="${min}" max="${max}" step="${pas || 1}"`);
  const rarSel = (k, v) => `<label>Rareté<select class="cb-champ-eq" data-k="${k}">${[1, 2, 3, 4, 5].map((r) => OPT(r, A.rar(r).nom, v)).join('')}</select></label>`;
  const decorSel = (v) => `<label>Décor<select class="cb-champ-eq" data-k="decor">${DECORS.map((d) => OPT(d[0], d[1], v)).join('')}</select></label>`;
  const boutons = '<div class="ct-actions" style="justify-content:flex-end; margin-top:18px"><button type="button" class="ct-btn" data-non>Annuler</button><button type="button" class="ct-btn principal" data-ok>Enregistrer</button></div>';

  function editeur(titre, html, rpc, fixes, convertir, apres){
    const f = A.fenetre(`<h2>${esc(titre)}</h2><div class="cb-form">${html}</div>${boutons}`, true);
    pickerBranche(f.corps);
    f.corps.querySelector('[data-non]').addEventListener('click', f.fermer);
    const ok = f.corps.querySelector('[data-ok]');
    ok.addEventListener('click', async () => {
      const p = Object.assign({}, fixes, lire(f.corps));
      convertir(p);
      ok.disabled = true;
      try{ await A.appel(rpc, { p }); A.toast('Enregistré.'); f.fermer(); await apres(); }
      catch(e){ A.toast(e.message, 'err'); ok.disabled = false; }
    });
  }

  async function eqPve(corps, api){
    A = api;
    css();
    const vues = [['reglages', 'Réglages'], ['tour', 'Tour'], ['champions', 'Champions'], ['ligue', 'Ligue']];
    const recharger = async () => { P.eqDonnees = await A.appel('combat_pve_equipe_lire'); dessine(); };
    const dessine = () => {
      const D = P.eqDonnees;
      corps.innerHTML = `<nav class="cb-seg mini" aria-label="Contre le jeu">${vues.map(([id, nom]) => `<button type="button" data-pv="${id}" aria-pressed="${id === P.eq}">${nom}</button>`).join('')}</nav><div data-pv-corps style="margin-top:14px"></div>`;
      corps.querySelectorAll('[data-pv]').forEach((b) => b.addEventListener('click', () => { P.eq = b.dataset.pv; dessine(); }));
      const z = corps.querySelector('[data-pv-corps]');
      if(P.eq === 'reglages') eqReglages(z, D);
      else if(P.eq === 'tour') eqTour(z, D, recharger);
      else if(P.eq === 'champions') eqChampions(z, D, recharger);
      else eqLigue(z, D, recharger);
    };
    corps.innerHTML = '<div class="ct-vide">Chargement…</div>';
    await recharger();
  }

  function eqReglages(z, D){
    z.innerHTML = `<p class="sous" style="margin:0 0 12px; font-size:13px; color:var(--muted)">Récompenses et plafonds des champions et de la Ligue. Chaque valeur s'enregistre dès que tu la modifies.</p>
      <div class="pv-reg">${D.reglages.map((r) => `<label>${esc(r.libelle)}<input class="cb-champ-eq" type="number" min="0" max="5000" data-cle="${esc(r.cle)}" value="${r.valeur}"></label>`).join('')}</div>`;
    z.querySelectorAll('[data-cle]').forEach((i) => i.addEventListener('change', async () => {
      try{ await A.appel('combat_pve_equipe_reglage', { p_cle: i.dataset.cle, p_valeur: Math.round(Number(i.value)) }); A.toast('Enregistré.'); }
      catch(e){ A.toast(e.message, 'err'); }
    }));
  }

  function eqTour(z, D, recharger){
    z.innerHTML = `<p class="sous" style="margin:0 0 12px; font-size:13px; color:var(--muted)">Les adversaires d'un étage sont tirés dans le classement des artistes par fans (les moins connus en bas, les plus connus en haut). Stats = bonus de départ + bonus par étage × étage (+ bonus du gardien tous les 10 étages).</p>
      <div class="cb-liste">${D.difficultes.map((d) => `<div class="cb-ligne"><span class="cb-n">${d.ordre}</span>
        <div><h4>${esc(d.nom)} ${d.actif ? '' : '<span class="cb-puce">Désactivée</span>'}</h4>
          <p>${d.etages} étages · stats ${d.bonus_base >= 0 ? '+' : ''}${d.bonus_base} % puis +${String(d.bonus_etage).replace('.', ',')} % par étage · gardien +${d.bonus_gardien} % · rareté +${d.rarete_plus} · Wave Coins ×${String(d.mult_wc).replace('.', ',')} · vinyles ×${String(d.mult_vinyles).replace('.', ',')} · s'ouvre à l'étage ${d.deblocage_etage} de la précédente</p></div>
        <button type="button" class="ct-btn petit" data-d="${esc(d.id)}">Modifier</button></div>`).join('')}</div>`;
    z.querySelectorAll('[data-d]').forEach((b) => b.addEventListener('click', () => {
      const d = D.difficultes.find((x) => x.id === b.dataset.d);
      editeur(d.nom, `${champ('nom', 'Nom', d.nom)}${champ('resume', 'Résumé', d.resume)}
        ${nombre('etages', 'Nombre d\'étages', d.etages, 10, 1000)}${nombre('deblocage_etage', 'Étage à atteindre dans la précédente', d.deblocage_etage, 0, 1000)}
        ${nombre('bonus_base', 'Stats au départ (%)', d.bonus_base, -50, 300)}${nombre('bonus_etage', 'Stats en plus par étage (%)', d.bonus_etage, 0, 10, 0.05)}
        ${nombre('bonus_gardien', 'Stats en plus pour un gardien (%)', d.bonus_gardien, 0, 100)}${nombre('rarete_plus', 'Rareté en plus (0 à 3)', d.rarete_plus, 0, 3)}
        ${nombre('mult_wc', 'Multiplicateur de Wave Coins', d.mult_wc, 0, 10, 0.25)}${nombre('mult_vinyles', 'Multiplicateur de vinyles', d.mult_vinyles, 0, 10, 0.25)}
        <label>Active<select class="cb-champ-eq" data-k="actif">${OPT('true', 'Oui', String(d.actif))}${OPT('false', 'Non', String(d.actif))}</select></label>`,
        'combat_pve_equipe_difficulte', { id: d.id },
        (p) => { ['etages', 'deblocage_etage', 'bonus_base', 'rarete_plus'].forEach((k) => { p[k] = Math.round(Number(p[k])); }); ['bonus_etage', 'mult_wc', 'mult_vinyles', 'bonus_gardien'].forEach((k) => { p[k] = Number(p[k]); }); p.actif = p.actif === 'true'; },
        recharger);
    }));
  }

  function eqChampions(z, D, recharger){
    z.innerHTML = `<p class="sous" style="margin:0 0 12px; font-size:13px; color:var(--muted)">Les 8 champions de style. La récompense est versée une seule fois par joueur, à la première victoire. Le champion du jour se règle dans l'onglet « Réglages ».</p>
      <div class="cb-liste">${D.champions.map((c) => `<div class="cb-ligne"><span class="cb-n">${c.ordre}</span>
        <div><h4>${esc(c.nom)} ${chip(c.type_nom, '')} ${c.actif ? '' : '<span class="cb-puce">Désactivé</span>'}</h4>
          <p>${esc(c.nom1)} (${esc(A.rar(c.rarete1).nom)}) &amp; ${esc(c.nom2)} (${esc(A.rar(c.rarete2).nom)}) · stats +${c.bonus} % · ${pl(c.vinyles, 'vinyle')} + ${nf(c.wc)} WC</p></div>
        <button type="button" class="ct-btn petit" data-c="${esc(c.id)}">Modifier</button></div>`).join('')}</div>`;
    z.querySelectorAll('[data-c]').forEach((b) => b.addEventListener('click', () => {
      const c = D.champions.find((x) => x.id === b.dataset.c);
      editeur(c.nom, `${champ('nom', 'Nom', c.nom)}${champ('description', 'Description', c.description)}
        ${pickerHtml(1, c.artist1, c.nom1)}${rarSel('rarete1', c.rarete1)}${pickerHtml(2, c.artist2, c.nom2)}${rarSel('rarete2', c.rarete2)}
        ${nombre('bonus', 'Stats en plus (%)', c.bonus, 0, 300)}${decorSel(c.decor)}
        ${nombre('vinyles', 'Vinyles (1re victoire)', c.vinyles, 0, 50)}${nombre('wc', 'Wave Coins (1re victoire)', c.wc, 0, 5000)}
        <label>Actif<select class="cb-champ-eq" data-k="actif">${OPT('true', 'Oui', String(c.actif))}${OPT('false', 'Non', String(c.actif))}</select></label>`,
        'combat_pve_equipe_champion', { id: c.id },
        (p) => { ['rarete1', 'rarete2', 'bonus', 'vinyles', 'wc'].forEach((k) => { p[k] = Math.round(Number(p[k])); }); p.actif = p.actif === 'true'; },
        recharger);
    }));
  }

  function eqLigue(z, D, recharger){
    z.innerHTML = `<p class="sous" style="margin:0 0 12px; font-size:13px; color:var(--muted)">Les 5 sièges de la Ligue, dans l'ordre : le Conseil des 4 puis le Maître. Les récompenses se règlent dans l'onglet « Réglages ».</p>
      <div class="cb-liste">${D.ligue.map((m) => `<div class="cb-ligne"><span class="cb-n">${m.rang}</span>
        <div><h4>${esc(m.nom)}</h4><p>${esc(m.nom1)} (${esc(A.rar(m.rarete1).nom)}) &amp; ${esc(m.nom2)} (${esc(A.rar(m.rarete2).nom)}) · stats +${m.bonus} %</p></div>
        <button type="button" class="ct-btn petit" data-r="${m.rang}">Modifier</button></div>`).join('')}</div>`;
    z.querySelectorAll('[data-r]').forEach((b) => b.addEventListener('click', () => {
      const m = D.ligue.find((x) => String(x.rang) === b.dataset.r);
      editeur('Siège ' + m.rang, `${champ('nom', 'Nom', m.nom)}${champ('description', 'Description', m.description)}
        ${pickerHtml(1, m.artist1, m.nom1)}${rarSel('rarete1', m.rarete1)}${pickerHtml(2, m.artist2, m.nom2)}${rarSel('rarete2', m.rarete2)}
        ${nombre('bonus', 'Stats en plus (%)', m.bonus, 0, 300)}${decorSel(m.decor)}`,
        'combat_pve_equipe_ligue', { rang: m.rang },
        (p) => { ['rarete1', 'rarete2', 'bonus'].forEach((k) => { p[k] = Math.round(Number(p[k])); }); },
        recharger);
    }));
  }

  if(WC.equipeVues) WC.equipeVues.enregistrer({ id: 'pve', nom: 'Contre le jeu', ouvrir: eqPve });

  window.WaveCombatPve = { modes: ['pve_tour', 'pve_champion', 'pve_ligue'] };

})();
