/* =====================================================================
   La Wave — Wave Cards : les Rivaux et le Prestige

   Chargé par combat.js (tout module « combat-… » déclaré dans WAVE_MODULES, index.html, est chargé à l'ouverture de l'onglet Combat).
   Il enregistre deux tuiles dans le hub (WaveCombat.modes.enregistrer) et un onglet « Rivaux & Prestige » dans la console de l'équipe
   (WaveCombat.equipeVues.enregistrer). Le moteur et tous les calculs vivent dans la base (sql/combat-rivaux-*.sql) : ce fichier demande,
   affiche et lance les combats (api.lancerCombat avec rpc: 'combat_rivaux_duel' / 'combat_prestige_duel').

   LES RIVAUX
     Six rivaux nommés, chacun avec une courte histoire. Trois niveaux (Normal, Difficile, Légendaire) ; un niveau est une SÉRIE de
     3 duels (manches) de plus en plus durs. La rivalité grandit à chaque série terminée (Adversaire, Rival, Némésis) et débloque un
     chapitre de l'histoire. Récompense à chaque manche gagnée pour la première fois, à la fin de chaque série, et un petit gain par
     rival et par jour. Une défaite ne coûte rien : on retente la même manche.

   LE PRESTIGE
     Les huit champions de style reviennent, 15 niveaux chacun, armés de MALÉDICTIONS (stats ou passifs en plus sur leurs cartes) ;
     elles s'ajoutent tous les 4 niveaux. Une fois les 15 niveaux vaincus : titre, puis RENAISSANCE : la progression de ce champion
     repart de zéro (remise à zéro douce), le joueur garde ses titres et gagne une étoile ; les niveaux deviennent plus durs
     (stats et malédiction en plus) mais plus généreux. Un champion se débloque en le battant dans « Les champions ».
   ===================================================================== */

(function(){

  'use strict';

  const WC = window.WaveCombat;
  if(!WC || !WC.modes) return;

  let A = null;   // l'interface partagée du jeu (window.Cartes.api), reçue à l'ouverture d'un mode
  const R = { promesse: null, cle: undefined, sel: null, niv: null, pcle: undefined, ppromesse: null, eq: 'reglages', eqDonnees: null };

  const api0 = () => A || (window.Cartes && window.Cartes.api);
  const esc = (t) => api0().esc(t);
  const nf = (n) => api0().nf(n);
  const couleur = (c) => api0().couleurOk(c || '#9aa4b2');
  const pl = (n, mot) => n + ' ' + mot + (n > 1 ? 's' : '');
  const chip = (nom, c) => nom ? `<span class="cb-type" style="--tc:${couleur(c)}">${esc(nom)}</span>` : '<span class="cb-type neutre">Neutre</span>';
  const RANGS = ['Nouveau défi', 'Adversaire', 'Rival', 'Némésis'];
  const etoiles = (n) => n > 0 ? '★'.repeat(Math.min(n, 10)) : '';

  const CSS = `
  .rv-cartes{display:grid; grid-template-columns:repeat(auto-fill, minmax(260px, 1fr)); gap:12px;}
  .rv-carte{display:grid; gap:10px; align-content:start; padding:14px; border-radius:18px; border:1px solid color-mix(in srgb, var(--tc, #4FB4FF) 45%, transparent); background:linear-gradient(160deg, color-mix(in srgb, var(--tc, #4FB4FF) 14%, transparent), rgba(255,255,255,.02));}
  .rv-carte.fini{border-color:rgba(242,193,78,.6);}
  .rv-carte.verrou{opacity:.6;}
  .rv-t{display:flex; align-items:center; gap:12px;}
  .rv-carte h4{margin:0; font-size:16px; line-height:1.25;}
  .rv-carte p{margin:0; font-size:12.5px; line-height:1.5; color:var(--muted);}
  .rv-citation{font-style:italic;}
  .rv-pied{display:flex; flex-wrap:wrap; gap:6px;}
  .rv-barre{height:8px; border-radius:99px; background:rgba(255,255,255,.08); overflow:hidden;}
  .rv-barre i{display:block; height:100%; border-radius:99px; background:var(--tc, var(--ct-accent, #4FB4FF)); transition:width .5s ease;}
  .rv-fiche{display:grid; gap:16px;}
  .rv-haut{display:flex; flex-wrap:wrap; align-items:center; gap:14px;}
  .rv-haut h3{margin:0; font-size:20px; letter-spacing:-.01em;}
  .rv-haut small{display:block; margin-top:2px; font-size:13px; color:var(--muted);}
  .rv-histoire{display:grid; gap:10px; padding:0; margin:0; list-style:none;}
  .rv-histoire li{position:relative; padding:12px 14px 12px 44px; border-radius:14px; background:var(--ct-surface-2); font-size:13.5px; line-height:1.55; color:var(--ink-soft);}
  .rv-histoire li::before{content:attr(data-n); position:absolute; left:12px; top:11px; width:24px; height:24px; border-radius:50%; display:grid; place-items:center; font-size:12px; font-weight:800; color:#05070a; background:var(--tc, #F2C14E);}
  .rv-histoire li.cache{opacity:.55; font-style:italic;}
  .rv-histoire li.cache::before{background:rgba(255,255,255,.2); color:var(--ink-soft);}
  .rv-manches{display:flex; align-items:center; gap:8px; flex-wrap:wrap;}
  .rv-manches i{display:grid; place-items:center; width:34px; height:34px; border-radius:50%; font-style:normal; font-weight:800; font-size:13px; border:2px solid var(--ct-trait-fort); color:var(--ink-soft);}
  .rv-manches i.fait{background:#5BE0A6; border-color:#5BE0A6; color:#05140d;}
  .rv-manches i.actuel{border-color:var(--ct-accent, #4FB4FF); color:var(--ink);}
  .rv-malediction{display:grid; gap:2px; padding:9px 12px; border-radius:12px; border:1px solid rgba(255,122,133,.35); background:rgba(255,122,133,.07); font-size:12.5px; line-height:1.4; color:var(--ink-soft);}
  .rv-malediction b{font-size:13px; color:#FF9AA3;}
  .rv-maledictions{display:grid; grid-template-columns:repeat(auto-fit, minmax(210px, 1fr)); gap:8px;}
  .rv-rej{display:flex; flex-wrap:wrap; align-items:center; gap:8px 10px; font-size:13px; color:var(--ink-soft);}
  .rv-rej input{width:84px; height:36px; padding:0 10px; border-radius:10px; border:1px solid var(--ct-trait); background:var(--ct-surface); color:var(--ink); font:inherit; font-size:14px;}
  .rv-reg{display:grid; grid-template-columns:repeat(auto-fit, minmax(240px, 1fr)); gap:10px;}
  .rv-reg label{display:grid; gap:5px; font-size:12px; font-weight:700; color:var(--ink-soft); padding:10px 12px; border-radius:12px; background:var(--ct-surface); border:1px solid var(--ct-trait);}
  .rv-pick{display:grid; gap:6px; grid-column:1 / -1; padding:10px; border-radius:12px; background:var(--ct-surface-2);}
  .rv-sel{display:grid; grid-template-columns:repeat(auto-fit, minmax(150px, 1fr)); gap:6px;}
  @media (max-width: 520px){
    .rv-cartes{grid-template-columns:1fr;}
    .rv-maledictions{grid-template-columns:1fr;}
    .rv-histoire li{padding-left:40px;}
  }
  `;

  function css(){
    if(document.getElementById('rivaux-style')) return;
    const s = document.createElement('style');
    s.id = 'rivaux-style';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  // Une lecture par accueil du combat (l'objet S.acc change après chaque combat) ; le hub utilise le résumé, le mode la relit.
  function charger(acc, force){
    if(force || !R.promesse || R.cle !== acc){
      R.cle = acc;
      R.promesse = api0().appel('combat_rivaux_accueil');
      R.promesse.catch(() => { R.promesse = null; });
    }
    return R.promesse;
  }
  function chargerPrestige(acc, force){
    if(force || !R.ppromesse || R.pcle !== acc){
      R.pcle = acc;
      R.ppromesse = api0().appel('combat_prestige_accueil');
      R.ppromesse.catch(() => { R.ppromesse = null; });
    }
    return R.ppromesse;
  }

  const entete = (titre, sous) => `<div class="ct-titre-sec" style="margin-top:0"><h3>${esc(titre)}</h3></div>${sous ? `<p class="sous" style="margin:-6px 0 14px; font-size:13px; color:var(--muted); line-height:1.5">${sous}</p>` : ''}`;
  const portraits = (crew) => `<div class="cb-portraits">${(crew || []).map((c) => `<img style="--tc:${couleur(c.couleur)}" src="${esc(api0().safeUrl(c.photo))}" alt="${esc(c.nom)}" title="${esc(c.nom)} · ${esc(c.type_nom || '')} · ${esc(c.role_nom || '')}" loading="lazy">`).join('')}</div>`;
  const recompense = (wc, vin) => `${vin ? `<span class="cb-puce or">+${pl(vin, 'vinyle')}</span>` : ''}${wc ? `<span class="cb-puce or">+${nf(wc)} WC</span>` : ''}`;

  // ---------------------------------------------------------------------
  // Les Rivaux
  // ---------------------------------------------------------------------

  function vueRivaux(hote, api, D){
    if(R.sel && D.rivaux.some((x) => x.id === R.sel)) return ficheRival(hote, api, D, D.rivaux.find((x) => x.id === R.sel));
    R.sel = null;
    hote.innerHTML = `${entete('Les rivaux', 'Six rivaux, chacun avec son histoire. Bats-les en série de 3 duels, du Normal au Légendaire : leur rivalité grandit et leur histoire se dévoile. Une défaite ne coûte rien.')}
      <div class="cb-chiffres" style="margin:0 0 14px"><span>Rivaux Légendaires <b>${D.legendaires} / ${D.total}</b></span>
        <span>Gain du jour <b>+${nf(D.jour_wc)} WC</b> par rival</span>${D.titre_maitre ? '<span>Titre <b>Roi des rivalités</b></span>' : ''}</div>
      <div class="rv-cartes">${D.rivaux.map((r) => {
        const fini = r.rivalite >= 3;
        const niv = r.niveaux.find((n) => n.debloque && !n.serie_faite) || r.niveaux[r.niveaux.length - 1];
        return `<article class="rv-carte${fini ? ' fini' : ''}" style="--tc:${couleur(r.crew[0] && r.crew[0].couleur)}">
          <div class="rv-t">${portraits(r.crew)}<div><h4>${esc(r.nom)}</h4><span class="cb-puce ${fini ? 'or' : ''}">${esc(r.surnom)}</span></div></div>
          <p class="rv-citation">« ${esc(r.replique)} »</p>
          <div class="rv-barre" role="progressbar" aria-label="Rivalité" aria-valuemin="0" aria-valuemax="3" aria-valuenow="${r.rivalite}"><i style="width:${r.rivalite / 3 * 100}%"></i></div>
          <div class="rv-pied"><span class="cb-puce ${r.rivalite ? 'ok' : ''}">${esc(RANGS[r.rivalite])}</span>
            ${fini ? '<span class="cb-puce or">Série Légendaire faite</span>' : `<span class="cb-puce">${esc(niv.nom)} · manche ${Math.min(niv.manche, 3)}/3</span>`}
            ${r.jour_fait ? '<span class="cb-puce ok">Gain du jour pris</span>' : '<span class="cb-puce or">Gain du jour</span>'}</div>
          <button type="button" class="ct-btn ${fini ? '' : 'principal'}" data-rival="${esc(r.id)}">${r.rivalite || niv.manches ? 'Reprendre' : 'Rencontrer'} ${esc(r.nom.split(' ')[0])}</button>
        </article>`;
      }).join('')}</div>`;
    hote.querySelectorAll('[data-rival]').forEach((b) => b.addEventListener('click', () => { R.sel = b.dataset.rival; R.niv = null; vueRivaux(hote, api, D); hote.scrollIntoView({ block: 'start' }); }));
  }

  function ficheRival(hote, api, D, r){
    if(!r.niveaux.some((n) => n.niveau === R.niv)) R.niv = (r.niveaux.find((n) => n.debloque && !n.serie_faite) || r.niveaux[r.niveaux.length - 1]).niveau;
    const n = r.niveaux.find((x) => x.niveau === R.niv);
    const rev = n.serie_faite;
    const histoire = Array.from({ length: r.chapitres }, (_, i) => i < r.histoire.length
      ? `<li data-n="${i + 1}">${esc(r.histoire[i])}</li>`
      : `<li class="cache" data-n="${i + 1}">${i === r.chapitres - 1 ? 'Le dernier chapitre se révèle quand les trois séries sont gagnées.' : 'Chapitre à découvrir en terminant une série de plus.'}</li>`).join('');
    const manches = [1, 2, 3].map((m) => `<i class="${m <= n.manches ? 'fait' : (m === n.manche && !rev ? 'actuel' : '')}" aria-label="Manche ${m}${m <= n.manches ? ' gagnée' : ''}">${m <= n.manches ? api.ico('coche', 14) : m}</i>`).join('');
    const corps = !n.debloque
      ? `<div class="ct-vide" style="padding:20px">${api.ico('cadenas', 22)}<b style="display:block; margin-top:8px">Niveau verrouillé</b>Termine d'abord la série ${esc(r.niveaux[n.niveau - 2].nom)} contre ${esc(r.nom.split(' ')[0])}.</div>`
      : `<div class="rv-manches">${manches}<span class="cb-puce">${rev ? 'Série terminée' : `Prochain duel : manche ${n.manche}/3`}</span></div>
         <div class="rv-pied" style="margin-top:12px"><span class="cb-puce">Stats +${n.bonus} %</span><span class="cb-puce">Rareté ${esc(api.rar(n.rarete).nom)}</span>
           ${rev ? '<span class="cb-puce">Revanche : gain du jour seulement</span>' : `${recompense(n.recompense_manche, 0)}<span class="cb-puce or">Fin de série</span>${recompense(n.recompense_serie.wc, n.recompense_serie.vinyles)}`}
           ${r.jour_fait ? '<span class="cb-puce ok">Gain du jour pris</span>' : `<span class="cb-puce or">Gain du jour +${nf(D.jour_wc)} WC</span>`}</div>
         <div style="margin-top:14px"><button type="button" class="ct-btn principal" data-duel>${rev ? 'Revanche contre ' : 'Défier '}${esc(r.nom.split(' ')[0])}</button></div>`;
    hote.innerHTML = `<div class="rv-fiche" style="--tc:${couleur(r.crew[0] && r.crew[0].couleur)}">
      <div><button type="button" class="ct-btn petit" data-retour>‹ Tous les rivaux</button></div>
      <div class="rv-haut">${portraits(r.crew)}<div><h3>${esc(r.nom)}</h3><small>${esc(r.surnom)} · ${esc(RANGS[r.rivalite])}${r.titre_obtenu ? ' · titre « ' + esc(r.titre) + ' »' : ''}</small></div>
        <span class="rv-pied">${r.crew.map((c) => chip(c.type_nom, c.couleur)).join('')}</span></div>
      <ol class="rv-histoire">${histoire}</ol>
      <nav class="cb-seg mini" aria-label="Niveau">${r.niveaux.map((x) => `<button type="button" data-n="${x.niveau}" aria-pressed="${x.niveau === n.niveau}">${x.debloque ? '' : api.ico('cadenas', 13) + '&nbsp;'}${esc(x.nom)}${x.serie_faite ? ' ✓' : ''}</button>`).join('')}</nav>
      <section class="ct-panneau">${corps}</section>
    </div>`;
    hote.querySelector('[data-retour]').addEventListener('click', () => { R.sel = null; vueRivaux(hote, api, D); });
    hote.querySelectorAll('[data-n]').forEach((b) => b.addEventListener('click', () => { R.niv = Number(b.dataset.n); ficheRival(hote, api, D, r); }));
    const d = hote.querySelector('[data-duel]');
    if(d) d.addEventListener('click', () => api.lancerCombat({ rpc: 'combat_rivaux_duel', params: { p_rival: r.id, p_niveau: n.niveau },
      titre: r.nom + ' · ' + n.nom + ' · Manche ' + n.manche + '/3', decor: r.decor, adversaires: r.crew }));
  }

  // ---------------------------------------------------------------------
  // Le Prestige
  // ---------------------------------------------------------------------

  function vuePrestige(hote, api, D){
    const total = D.champions.length * D.niveaux;
    const etoilesTot = D.champions.reduce((s, c) => s + c.renaissances, 0);
    hote.innerHTML = `${entete('Champions de prestige', `Les champions reviennent avec ${D.niveaux} niveaux chacun et des malédictions (une de plus tous les 4 niveaux). Bats-en un dans « Les champions » pour ouvrir son prestige. Au bout des ${D.niveaux} niveaux, tu peux renaître : sa progression repart de zéro, tu gardes tes titres et gagnes une étoile, mais tout devient plus dur (+${D.regles.bonus_renaiss} % de stats, une malédiction en plus) et plus généreux (+${D.regles.gain_renaiss} % de gains). Une défaite ne coûte rien.`)}
      <div class="cb-chiffres" style="margin:0 0 14px"><span>Niveaux franchis <b>${D.champions.reduce((s, c) => s + c.niveau_max, 0)} / ${total}</b></span><span>Étoiles de renaissance <b>${etoilesTot}</b></span></div>
      <div class="rv-cartes">${D.champions.map((c) => carteChampion(c, D, api)).join('')}</div>`;
    hote.querySelectorAll('[data-pres]').forEach((b) => b.addEventListener('click', () => {
      const c = D.champions.find((x) => x.id === b.dataset.pres);
      api.lancerCombat({ rpc: 'combat_prestige_duel', params: { p_champion: c.id, p_niveau: null }, titre: c.prochain.nom, decor: c.prochain.decor, adversaires: c.crew });
    }));
    hote.querySelectorAll('[data-rej]').forEach((b) => b.addEventListener('click', () => {
      const c = D.champions.find((x) => x.id === b.dataset.rej);
      const n = Math.floor(Number(hote.querySelector('[data-rejn="' + c.id + '"]').value));
      if(!(n >= 1 && n <= c.niveau_max)){ api.toast('Choisis un niveau entre 1 et ' + c.niveau_max + '.', 'err'); return; }
      api.lancerCombat({ rpc: 'combat_prestige_duel', params: { p_champion: c.id, p_niveau: n }, titre: 'Prestige ' + n + ' · ' + c.nom, adversaires: c.crew });
    }));
    hote.querySelectorAll('[data-renaitre]').forEach((b) => b.addEventListener('click', () => confirmerRenaissance(hote, api, D, D.champions.find((x) => x.id === b.dataset.renaitre))));
  }

  function carteChampion(c, D, api){
    const p = c.prochain;
    let corps;
    if(!c.debloque){
      corps = `<div class="cb-puce">${api.ico('cadenas', 13)}&nbsp;Bats d'abord ${esc(c.nom)} dans « Les champions »</div>`;
    }else if(p){
      corps = `<div class="rv-pied"><span class="cb-puce">Niveau ${p.niveau} / ${D.niveaux}</span><span class="cb-puce">Stats +${p.bonus} %</span>${recompense(p.recompense.wc, p.recompense.vinyles)}</div>
        <div class="rv-maledictions">${p.maledictions.map((m) => `<div class="rv-malediction"><b>${esc(m.nom)}</b>${esc(m.description)}</div>`).join('')}</div>
        <button type="button" class="ct-btn principal" data-pres="${esc(c.id)}">${c.niveau_max ? 'Niveau ' + p.niveau : 'Commencer le prestige'}</button>`;
    }else{
      corps = `<div class="rv-pied"><span class="cb-puce or">${D.niveaux} niveaux vaincus</span>${c.titre_obtenu ? `<span class="cb-puce or">Titre « ${esc(c.titre)} »</span>` : ''}</div>
        ${c.pret_renaitre ? `<button type="button" class="ct-btn principal" data-renaitre="${esc(c.id)}">Renaître (étoile ${c.renaissances + 1})</button>`
          : '<p>Renaissances au maximum : ce champion n\'a plus rien à t\'apprendre.</p>'}`;
    }
    const rej = c.debloque && c.niveau_max > 0
      ? `<div class="rv-rej"><label for="rv-rej-${esc(c.id)}">Rejouer un niveau (sans gain)</label><input id="rv-rej-${esc(c.id)}" data-rejn="${esc(c.id)}" type="number" min="1" max="${c.niveau_max}" value="${c.niveau_max}" inputmode="numeric">
          <button type="button" class="ct-btn petit" data-rej="${esc(c.id)}">Rejouer</button></div>` : '';
    return `<article class="rv-carte${c.titre_obtenu ? ' fini' : ''}${c.debloque ? '' : ' verrou'}" style="--tc:${couleur(c.couleur)}">
      <div class="rv-t">${portraits(c.crew)}<div><h4>${esc(c.nom)} ${etoiles(c.renaissances) ? `<span class="cb-puce or" title="Renaissances">${etoiles(c.renaissances)}</span>` : ''}</h4>${chip(c.type_nom, c.couleur)}</div></div>
      <div class="rv-barre" role="progressbar" aria-label="Niveaux de prestige" aria-valuemin="0" aria-valuemax="${D.niveaux}" aria-valuenow="${c.niveau_max}"><i style="width:${c.niveau_max / D.niveaux * 100}%"></i></div>
      ${corps}${rej}</article>`;
  }

  function confirmerRenaissance(hote, api, D, c){
    const f = api.fenetre(`<h2>Renaître : ${esc(c.nom)}</h2>
      <p style="margin:0 0 10px; font-size:14px; line-height:1.55; color:var(--ink-soft)">Sa progression de prestige repart du niveau 1. Tu gardes tes titres et tout ce que tu as déjà gagné, et tu reçois une étoile (${c.renaissances + 1}) avec sa récompense.</p>
      <p style="margin:0; font-size:14px; line-height:1.55; color:var(--ink-soft)">En échange : +${D.regles.bonus_renaiss} % de stats pour ses cartes, une malédiction de plus, et des gains +${D.regles.gain_renaiss} % plus généreux sur chaque niveau.</p>
      <div class="ct-actions" style="justify-content:flex-end; margin-top:18px"><button type="button" class="ct-btn" data-non>Annuler</button><button type="button" class="ct-btn principal" data-ok>Renaître</button></div>`, false);
    f.corps.querySelector('[data-non]').addEventListener('click', f.fermer);
    const ok = f.corps.querySelector('[data-ok]');
    ok.addEventListener('click', async () => {
      ok.disabled = true;
      try{
        const r = await api.appel('combat_prestige_renaitre', { p_champion: c.id });
        f.fermer();
        const l = (r.gains && r.gains.lignes) || [];
        api.toast('Renaissance ' + r.renaissances + ' !' + (r.gains && r.gains.WC ? ' +' + nf(r.gains.WC) + ' WC' : '') + (l.length > 1 ? ' · ' + l[l.length - 1] : ''));
        const acc = api.acc();
        const nv = await chargerPrestige(acc, true);
        vuePrestige(hote, api, nv);
      }catch(e){ api.toast(e.message, 'err'); ok.disabled = false; }
    });
  }

  // ---------------------------------------------------------------------
  // Le hub : les deux tuiles
  // ---------------------------------------------------------------------

  const ouvrir = (vue, charge) => async (hote, api) => {
    A = api;
    css();
    hote.innerHTML = '<div class="ct-vide">Chargement…</div>';
    const D = await charge(api.acc(), true);
    vue(hote, api, D);
  };

  WC.modes.enregistrer({ id: 'rivaux', titre: 'Rivaux', groupe: 'dresseurs', icone: 'cible',
    resume: async (acc) => {
      const D = await charger(acc);
      const aff = D.rivaux.filter((r) => r.rivalite > 0).length;
      return aff ? `${D.legendaires} / ${D.total} Légendaires · ${aff} rivalité${aff > 1 ? 's' : ''} en cours` : `${D.total} rivaux à rencontrer`;
    },
    ouvrir: ouvrir(vueRivaux, charger) });

  WC.modes.enregistrer({ id: 'prestige', titre: 'Prestige', groupe: 'dresseurs', icone: 'etoile',
    resume: async (acc) => {
      const D = await chargerPrestige(acc);
      const n = D.champions.reduce((s, c) => s + c.niveau_max, 0);
      return `${n} / ${D.champions.length * D.niveaux} niveaux · ${D.champions.reduce((s, c) => s + c.renaissances, 0)} ★`;
    },
    ouvrir: ouvrir(vuePrestige, chargerPrestige) });

  // ---------------------------------------------------------------------
  // La console de l'équipe : l'onglet « Rivaux & Prestige »
  // ---------------------------------------------------------------------

  const OPT = (valeur, texte, sel) => `<option value="${esc(valeur)}"${String(sel) === String(valeur) ? ' selected' : ''}>${esc(texte)}</option>`;
  const DECORS = [['concert', 'Concert (arène)'], ['studio', 'Club (briques et néon)'], ['plateau', 'Plateau télé'], ['ruelle', 'Concert de rue'], ['toit', 'Toit au coucher du soleil']];

  function pickerHtml(n, id, nom){
    return `<div class="rv-pick" data-pick="${n}"><input type="hidden" data-k="artist${n}" value="${esc(id)}">
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
  const nombre = (k, etiquette, valeur, min, max) => champ(k, etiquette, valeur, `type="number" min="${min}" max="${max}" step="1"`);
  const boutons = '<div class="ct-actions" style="justify-content:flex-end; margin-top:18px"><button type="button" class="ct-btn" data-non>Annuler</button><button type="button" class="ct-btn principal" data-ok>Enregistrer</button></div>';

  function editeur(titre, html, rpc, fixes, convertir, apres){
    const f = A.fenetre(`<h2>${esc(titre)}</h2><div class="cb-form">${html}</div>${boutons}`, true);
    pickerBranche(f.corps);
    f.corps.querySelector('[data-non]').addEventListener('click', f.fermer);
    const ok = f.corps.querySelector('[data-ok]');
    ok.addEventListener('click', async () => {
      const p = Object.assign({}, fixes, lire(f.corps));
      convertir(p, f.corps);
      ok.disabled = true;
      try{ await A.appel(rpc, { p }); A.toast('Enregistré.'); f.fermer(); await apres(); }
      catch(e){ A.toast(e.message, 'err'); ok.disabled = false; }
    });
  }

  async function eqRivaux(corps, api){
    A = api;
    css();
    const vues = [['reglages', 'Réglages'], ['rivaux', 'Rivaux'], ['niveaux', 'Niveaux'], ['prestige', 'Prestige']];
    const recharger = async () => { R.eqDonnees = await A.appel('combat_rivaux_equipe_lire'); dessine(); };
    const dessine = () => {
      const D = R.eqDonnees;
      corps.innerHTML = `<nav class="cb-seg mini" aria-label="Rivaux et Prestige">${vues.map(([id, nom]) => `<button type="button" data-rp="${id}" aria-pressed="${id === R.eq}">${nom}</button>`).join('')}</nav><div data-rp-corps style="margin-top:14px"></div>`;
      corps.querySelectorAll('[data-rp]').forEach((b) => b.addEventListener('click', () => { R.eq = b.dataset.rp; dessine(); }));
      const z = corps.querySelector('[data-rp-corps]');
      if(R.eq === 'reglages') eqReglages(z, D);
      else if(R.eq === 'rivaux') eqRivauxListe(z, D, recharger);
      else if(R.eq === 'niveaux') eqNiveaux(z, D, recharger);
      else eqPrestige(z, D, recharger);
    };
    corps.innerHTML = '<div class="ct-vide">Chargement…</div>';
    await recharger();
  }

  const aide = (t) => `<p class="sous" style="margin:0 0 12px; font-size:13px; color:var(--muted); line-height:1.5">${t}</p>`;

  function eqReglages(z, D){
    z.innerHTML = `${aide('Récompenses, niveaux et bonus des deux modes. Chaque valeur s\'enregistre dès que tu la modifies.')}
      <div class="rv-reg">${D.reglages.map((r) => `<label>${esc(r.libelle)}<input class="cb-champ-eq" type="number" min="0" max="5000" data-cle="${esc(r.cle)}" value="${r.valeur}"></label>`).join('')}</div>`;
    z.querySelectorAll('[data-cle]').forEach((i) => i.addEventListener('change', async () => {
      try{ await A.appel('combat_rivaux_equipe_reglage', { p_cle: i.dataset.cle, p_valeur: Math.round(Number(i.value)) }); A.toast('Enregistré.'); }
      catch(e){ A.toast(e.message, 'err'); }
    }));
  }

  function eqRivauxListe(z, D, recharger){
    z.innerHTML = `${aide('Les rivaux sont des personnages ; leurs cartes sont deux artistes du catalogue. L\'histoire se dévoile chapitre par chapitre (le 1er est visible d\'emblée, puis un par série terminée).')}
      <div class="cb-liste">${D.rivaux.map((r) => `<div class="cb-ligne"><span class="cb-n">${r.ordre}</span>
        <div><h4>${esc(r.nom)} <span class="cb-puce">${esc(r.surnom)}</span> ${r.actif ? '' : '<span class="cb-puce">Désactivé</span>'}</h4>
          <p>${esc(r.nom1)} &amp; ${esc(r.nom2)} · ${pl(r.histoire.length, 'chapitre')}</p></div>
        <button type="button" class="ct-btn petit" data-r="${esc(r.id)}">Modifier</button></div>`).join('')}</div>`;
    z.querySelectorAll('[data-r]').forEach((b) => b.addEventListener('click', () => {
      const r = D.rivaux.find((x) => x.id === b.dataset.r);
      editeur(r.nom, `${champ('nom', 'Nom', r.nom)}${champ('surnom', 'Surnom', r.surnom)}${champ('replique', 'Réplique d\'accroche', r.replique)}
        ${r.histoire.map((t, i) => `<label>Chapitre ${i + 1}<textarea class="cb-champ-eq" rows="3" maxlength="600" data-k="ch${i}">${esc(t)}</textarea></label>`).join('')}
        ${pickerHtml(1, r.artist1, r.nom1)}${pickerHtml(2, r.artist2, r.nom2)}
        <label>Décor<select class="cb-champ-eq" data-k="decor">${DECORS.map((d) => OPT(d[0], d[1], r.decor)).join('')}</select></label>
        <label>Actif<select class="cb-champ-eq" data-k="actif">${OPT('true', 'Oui', String(r.actif))}${OPT('false', 'Non', String(r.actif))}</select></label>`,
        'combat_rivaux_equipe_rival', { id: r.id },
        (p) => { p.histoire = r.histoire.map((_, i) => p['ch' + i]); p.actif = p.actif === 'true'; },
        recharger);
    }));
  }

  function eqNiveaux(z, D, recharger){
    z.innerHTML = `${aide('Les trois niveaux, communs aux rivaux. Stats de l\'adversaire = bonus de départ + bonus par manche × (manche − 1) ; la 3e manche gagne une rareté.')}
      <div class="cb-liste">${D.niveaux.map((n) => `<div class="cb-ligne"><span class="cb-n">${n.niveau}</span>
        <div><h4>${esc(n.nom)}</h4><p>Stats +${n.bonus_base} % puis +${n.bonus_manche} % par manche · rareté ${esc(A.rar(n.rarete).nom)} · manche ${nf(n.wc_manche)} WC · série ${nf(n.wc_serie)} WC + ${pl(n.vinyles_serie, 'vinyle')}</p></div>
        <button type="button" class="ct-btn petit" data-n="${n.niveau}">Modifier</button></div>`).join('')}</div>`;
    z.querySelectorAll('[data-n]').forEach((b) => b.addEventListener('click', () => {
      const n = D.niveaux.find((x) => String(x.niveau) === b.dataset.n);
      editeur(n.nom, `${champ('nom', 'Nom', n.nom)}${nombre('bonus_base', 'Stats au départ (%)', n.bonus_base, 0, 300)}${nombre('bonus_manche', 'Stats en plus par manche (%)', n.bonus_manche, 0, 100)}
        <label>Rareté<select class="cb-champ-eq" data-k="rarete">${[1, 2, 3, 4, 5].map((x) => OPT(x, A.rar(x).nom, n.rarete)).join('')}</select></label>
        ${nombre('wc_manche', 'Wave Coins par manche (1re victoire)', n.wc_manche, 0, 5000)}${nombre('wc_serie', 'Wave Coins en fin de série', n.wc_serie, 0, 5000)}${nombre('vinyles_serie', 'Vinyles en fin de série', n.vinyles_serie, 0, 50)}`,
        'combat_rivaux_equipe_niveau', { niveau: n.niveau },
        (p) => { ['bonus_base', 'bonus_manche', 'rarete', 'wc_manche', 'wc_serie', 'vinyles_serie'].forEach((k) => { p[k] = Math.round(Number(p[k])); }); },
        recharger);
    }));
  }

  function eqPrestige(z, D, recharger){
    const lib = D.maledictions, nomMal = (id) => (lib.find((m) => m.id === id) || { nom: id }).nom;
    z.innerHTML = `${aide('Chaque champion a une liste ordonnée de malédictions : la 1re dès le niveau 1, une de plus tous les 4 niveaux et à chaque renaissance. Un bonus de stats vaut pour les deux cartes ; un passif se pose sur une carte à la fois.')}
      <div class="cb-liste">${D.champions.map((c) => `<div class="cb-ligne"><span class="cb-n">${esc(c.type_nom.slice(0, 2))}</span>
        <div><h4>${esc(c.nom)}</h4><p>${c.maledictions.map((id, i) => (i + 1) + '. ' + esc(nomMal(id))).join(' · ')}</p></div>
        <button type="button" class="ct-btn petit" data-c="${esc(c.id)}">Modifier</button></div>`).join('')}</div>
      <div class="ct-titre-sec"><h3>La bibliothèque de malédictions</h3></div>
      <div class="cb-liste">${lib.map((m) => `<div class="cb-ligne"><span class="cb-n">${m.genre === 'stat' ? '%' : '✦'}</span>
        <div><h4>${esc(m.nom)}</h4><p>${esc(m.description)} (valeur ${m.valeur}, ${m.genre === 'stat' ? 'bonus de ' + esc(m.cible) : 'passif ' + esc(m.cible)})</p></div>
        <button type="button" class="ct-btn petit" data-m="${esc(m.id)}">Modifier</button></div>`).join('')}</div>`;
    z.querySelectorAll('[data-c]').forEach((b) => b.addEventListener('click', () => {
      const c = D.champions.find((x) => x.id === b.dataset.c);
      const n = Math.max(6, c.maledictions.length);
      editeur(c.nom, `<p class="sous" style="margin:0; font-size:12.5px; color:var(--muted)">Laisse une ligne vide pour retirer une malédiction de la fin de la liste.</p>
        <div class="rv-sel">${Array.from({ length: n }, (_, i) => `<label>Malédiction ${i + 1}<select class="cb-champ-eq" data-k="m${i}"><option value="">—</option>${lib.map((m) => OPT(m.id, m.nom, c.maledictions[i] || '')).join('')}</select></label>`).join('')}</div>`,
        'combat_prestige_equipe_champion', { champion: c.id },
        (p) => { p.maledictions = Array.from({ length: n }, (_, i) => p['m' + i]).filter(Boolean); },
        recharger);
    }));
    z.querySelectorAll('[data-m]').forEach((b) => b.addEventListener('click', () => {
      const m = lib.find((x) => x.id === b.dataset.m);
      editeur(m.nom, `${champ('nom', 'Nom', m.nom)}${champ('description', 'Description', m.description)}${nombre('valeur', 'Valeur (% ou niveau du passif)', m.valeur, 0, 300)}`,
        'combat_prestige_equipe_malediction', { id: m.id },
        (p) => { p.valeur = Math.round(Number(p.valeur)); },
        recharger);
    }));
  }

  if(WC.equipeVues) WC.equipeVues.enregistrer({ id: 'rivaux', nom: 'Rivaux & Prestige', ouvrir: eqRivaux });

  window.WaveCombatRivaux = { modes: ['rivaux', 'prestige'] };

})();
