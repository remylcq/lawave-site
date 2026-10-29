/* =====================================================================
   La Wave — Wave Cards : les modes de quête du combat (Faille, Trésor)

   Chargé par combat.js (tout module « combat-… » déclaré dans WAVE_MODULES, index.html, est chargé à l'ouverture de l'onglet Combat).
   Il enregistre deux tuiles dans le hub (WaveCombat.modes.enregistrer) et un onglet « Faille & Trésor » dans la console de l'équipe
   (WaveCombat.equipeVues.enregistrer). Le moteur et tous les calculs vivent dans la base (sql/combat-quete-*.sql) : ce fichier demande,
   affiche et lance les combats (api.lancerCombat avec rpc: 'combat_quete_…').

   LES DEUX MODES (calqués sur BallDex)
     La Faille   un boss légendaire par jour de la semaine, aux PV démesurés. Un combat par essai, 3 essais gratuits par jour (on peut en
                 acheter en Wave Coins) ; la NOTE (C → Ω) dépend des dégâts infligés et donne le butin à chaque essai. Un essai acheté
                 rapporte la moitié des Wave Coins, sans vinyles ni pack garanti.
     Le Trésor   10 paliers de gardiens par jour, de plus en plus durs (calés sur la rareté de ton duo) ; chaque palier vaincu rapporte
                 sa récompense (Wave Coins, puis vinyles et pack garanti). Autant d'essais que tu veux, avec un plafond par heure.
                 Le trésor se remplit de nouveau chaque jour à minuit (heure de Paris).
   ===================================================================== */

(function(){

  'use strict';

  const WC = window.WaveCombat;
  if(!WC || !WC.modes) return;

  let A = null;   // l'interface partagée du jeu (window.Cartes.api), reçue à l'ouverture d'un mode
  const Q = { cle: undefined, promesse: null, eq: 'reglages', eqDonnees: null };

  const api0 = () => A || (window.Cartes && window.Cartes.api);
  const esc = (t) => api0().esc(t);
  const nf = (n) => api0().nf(n);
  const couleur = (c) => api0().couleurOk(c || '#9aa4b2');
  const pl = (n, mot) => n + ' ' + mot + (n > 1 ? 's' : '');
  const chip = (nom, c) => nom ? `<span class="cb-type" style="--tc:${couleur(c)}">${esc(nom)}</span>` : '<span class="cb-type neutre">Neutre</span>';
  const roleChip = (nom) => nom ? `<span class="cb-role">${esc(nom)}</span>` : '';
  const force = (pct) => (pct / 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 });

  const CSS = `
  .qt-barre{height:8px; border-radius:99px; background:rgba(255,255,255,.08); overflow:hidden; margin-top:12px;}
  .qt-barre i{display:block; height:100%; border-radius:99px; background:var(--ct-accent, #4FB4FF); transition:width .5s ease;}
  .qt-boss{display:grid; gap:14px;}
  .qt-boss h3{margin:0; font-size:18px; letter-spacing:-.01em;}
  .qt-boss.faille{border-color:rgba(176,124,255,.5); background:linear-gradient(160deg, rgba(176,124,255,.12), rgba(255,255,255,.02));}
  .qt-ligne-chips{display:flex; flex-wrap:wrap; align-items:center; gap:6px;}
  .qt-boutons{display:flex; flex-wrap:wrap; gap:8px;}
  .qt-notes{display:grid; grid-template-columns:repeat(auto-fill, minmax(150px, 1fr)); gap:8px;}
  .qt-note{display:grid; gap:6px; align-content:start; padding:12px 10px; border-radius:14px; border:1px solid var(--ct-trait); background:var(--ct-surface); text-align:center; font-size:11.5px; line-height:1.4; color:var(--ink-soft);}
  .qt-note > b{font-size:24px; line-height:1; letter-spacing:-.02em; color:var(--ink);}
  .qt-note .seuil{font-variant-numeric:tabular-nums;}
  .qt-note .gains{display:flex; flex-wrap:wrap; justify-content:center; gap:4px;}
  .qt-note.atteinte{border-color:rgba(91,224,166,.5); background:rgba(91,224,166,.08);}
  .qt-note.atteinte > b{color:#5BE0A6;}
  .qt-note.haut{border-color:rgba(242,193,78,.5);}
  .qt-top{display:grid; gap:6px;}
  .qt-top > div{display:grid; grid-template-columns:auto 1fr auto auto; gap:10px; align-items:center; padding:9px 12px; border-radius:12px; border:1px solid var(--ct-trait); background:var(--ct-surface); font-size:13.5px;}
  .qt-top > div.moi{border-color:rgba(79,180,255,.5); background:rgba(79,180,255,.07);}
  .qt-top .n{font-weight:800; color:var(--muted); min-width:18px; text-align:center;}
  .qt-top .d{font-variant-numeric:tabular-nums; color:var(--ink-soft);}
  .qt-paliers{display:grid; grid-template-columns:repeat(auto-fill, minmax(104px, 1fr)); gap:8px;}
  .qt-p{display:grid; gap:3px; padding:10px 8px; border-radius:12px; border:1px solid var(--ct-trait); background:var(--ct-surface); text-align:center; font-size:11.5px; line-height:1.35; color:var(--ink-soft);}
  .qt-p b{font-size:16px; color:var(--ink); font-variant-numeric:tabular-nums;}
  .qt-p.fait{border-color:rgba(91,224,166,.5); background:rgba(91,224,166,.08);}
  .qt-p.fait b{color:#5BE0A6;}
  .qt-p.suivant{border-color:rgba(242,193,78,.6);}
  .qt-pick{display:grid; gap:6px; grid-column:1 / -1; padding:10px; border-radius:12px; background:var(--ct-surface-2);}
  .qt-pick b{color:var(--ink);}
  .qt-reg{display:grid; grid-template-columns:repeat(auto-fit, minmax(240px, 1fr)); gap:10px;}
  .qt-reg label{display:grid; gap:5px; font-size:12px; font-weight:700; color:var(--ink-soft); padding:10px 12px; border-radius:12px; background:var(--ct-surface); border:1px solid var(--ct-trait);}
  @media (max-width: 520px){
    .qt-notes{grid-template-columns:repeat(auto-fill, minmax(124px, 1fr));}
    .qt-paliers{grid-template-columns:repeat(auto-fill, minmax(88px, 1fr));}
    .qt-top > div{grid-template-columns:auto 1fr auto; }
    .qt-top .note{display:none;}
  }
  `;

  function css(){
    if(document.getElementById('quete-style')) return;
    const s = document.createElement('style');
    s.id = 'quete-style';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  // L'état des deux modes : une seule lecture par accueil du combat (l'objet S.acc change après chaque combat).
  function charger(acc, force2){
    if(force2 || !Q.promesse || Q.cle !== acc){
      Q.cle = acc;
      Q.promesse = api0().appel('combat_quete_accueil');
      Q.promesse.catch(() => { Q.promesse = null; });
    }
    return Q.promesse;
  }

  const entete = (titre, sous) => `<div class="ct-titre-sec" style="margin-top:0"><h3>${esc(titre)}</h3></div>${sous ? `<p class="sous" style="margin:-6px 0 14px; font-size:13px; color:var(--muted); line-height:1.5">${sous}</p>` : ''}`;

  const gains = (r) => {
    if(!r) return '';
    const l = [];
    if(r.vinyles) l.push(`<span class="cb-puce or">+${pl(r.vinyles, 'vinyle')}</span>`);
    if(r.wc) l.push(`<span class="cb-puce or">+${nf(r.wc)} WC</span>`);
    if(r.garantis) l.push(`<span class="cb-puce or">+${pl(r.garantis, 'pack garanti')}</span>`);
    return l.join('');
  };

  const slot = (c) => `<div class="cb-slot" style="--tc:${couleur(c.couleur)}">
      ${api0().carteHtml({ nom: c.nom, photo: c.photo, rarete: c.rarete, holo: c.holo, numero: c.numero || 0 }, {})}
      <div class="cb-slot-i"><b>${esc(c.nom)}</b><div class="cb-roles">${chip(c.type_nom, c.couleur)}${roleChip(c.role_nom)}</div>
        <div class="cb-mini-stats" style="margin-top:5px"><span>PV <b>${nf(c.pv)}</b></span><span>PUI <b>${nf(c.pui)}</b></span><span>DÉF <b>${nf(c.def)}</b></span><span>VIT <b>${nf(c.vit)}</b></span></div></div>
    </div>`;

  // ---------------------------------------------------------------------
  // La Faille
  // ---------------------------------------------------------------------

  function vueFaille(hote, api, acc){
    const f = acc.faille, b = f.boss;
    const total = f.essais_base + f.achetes;
    const peut = f.restants > 0;
    let boutons;
    if(peut) boutons = `<button type="button" class="ct-btn principal" data-entrer>Entrer dans la Faille</button>`;
    else if(f.achat_restants > 0) boutons = `<button type="button" class="ct-btn principal" data-acheter ${f.solde >= f.prix ? '' : 'disabled'}>Acheter un essai · ${nf(f.prix)} WC</button>`;
    else boutons = `<button type="button" class="ct-btn" disabled>Reviens demain</button>`;
    const aide = peut
      ? `Un seul combat par essai : ta note vient des dégâts que tu infliges au boss avant d'être battu. ${f.achetes ? 'Les essais achetés rapportent ' + f.pct + ' % des Wave Coins, sans vinyles ni pack.' : ''}`
      : (f.achat_restants > 0
        ? `Tu as utilisé tes ${total} essais du jour. Un essai acheté (${f.achat_restants} possible${f.achat_restants > 1 ? 's' : ''} aujourd'hui) rapporte ${f.pct} % des Wave Coins, sans vinyles ni pack. Ton solde : ${nf(f.solde)} WC.`
        : 'Tous les essais du jour sont utilisés. La Faille s\'ouvre sur un nouveau boss demain.');
    const top = f.top && f.top.length ? `<section style="margin-top:18px"><div class="ct-titre-sec" style="margin-top:0"><h3>Meilleurs coups du jour</h3></div>
        <div class="qt-top">${f.top.map((t, i) => `<div class="${t.moi ? 'moi' : ''}"><span class="n">${i + 1}</span><span>${esc(t.pseudo)}</span><span class="note cb-puce or">${esc(t.note || '')}</span><span class="d">${nf(t.deg)} dégâts</span></div>`).join('')}</div></section>` : '';
    hote.innerHTML = `${entete('La Faille', 'Un boss légendaire par jour, impossible à abattre. Frappe le plus fort possible et vise les notes les plus hautes : le butin suit la note, à chaque essai.')}
      <section class="ct-panneau qt-boss faille">
        <div><h3>${esc(b.nom)}</h3><p class="sous" style="margin:6px 0 0; font-size:13px; color:var(--muted); line-height:1.5">${esc(b.description)}</p></div>
        <div class="cb-duo">${b.crew.map(slot).join('')}</div>
        <div class="qt-ligne-chips"><span class="cb-puce ${f.restants ? 'ok' : ''}">Essais ${f.restants} / ${total}</span>
          <span class="cb-puce">Meilleur coup du jour : ${f.meilleur_deg ? esc(f.meilleure_note || '') + ' · ' + nf(f.meilleur_deg) + ' dégâts' : 'aucun'}</span>
          ${f.record ? `<span class="cb-puce">Record : ${nf(f.record)} dégâts</span>` : ''}</div>
        <div class="qt-boutons">${boutons}</div>
        <p class="sous" style="margin:0; font-size:12.5px; color:var(--muted); line-height:1.5">${aide}</p>
      </section>
      <section style="margin-top:18px"><div class="ct-titre-sec" style="margin-top:0"><h3>Notes et butin</h3></div>
        <div class="qt-notes">${f.notes.map((n, i) => `<div class="qt-note${n.atteinte ? ' atteinte' : ''}${i >= f.notes.length - 3 ? ' haut' : ''}"><b>${esc(n.note)}</b>
          <span class="seuil">${n.seuil ? '≥ ' + nf(n.seuil) + ' dégâts' : 'Dès le 1er coup'}</span><span class="gains">${gains({ wc: n.wc, vinyles: n.vinyles, garantis: n.garantis })}</span></div>`).join('')}</div></section>
      ${top}`;
    const e = hote.querySelector('[data-entrer]');
    if(e) e.addEventListener('click', () => api.lancerCombat({ rpc: 'combat_quete_faille', params: {}, titre: b.nom, adversaires: b.crew }));
    const a = hote.querySelector('[data-acheter]');
    if(a) a.addEventListener('click', async () => {
      a.disabled = true;
      try{
        const nouveau = await api.appel('combat_quete_faille_acheter');
        Q.promesse = Promise.resolve(nouveau);
        Q.cle = api.acc();
        api.toast('Essai acheté.');
        vueFaille(hote, api, nouveau);
      }catch(err){ api.toast(err.message, 'err'); a.disabled = false; }
    });
  }

  // ---------------------------------------------------------------------
  // Le Trésor
  // ---------------------------------------------------------------------

  function vueTresor(hote, api, acc){
    const t = acc.tresor, pr = t.prochain;
    const pc = t.total ? Math.min(100, t.palier / t.total * 100) : 0;
    let corps;
    if(pr){
      const r = t.paliers.find((x) => x.palier === pr.palier) || {};
      corps = `<div class="qt-boss"><div class="qt-ligne-chips"><h3 style="margin:0">Palier ${pr.palier}</h3><span class="cb-puce">Gardiens ×${force(pr.mult_pct)}</span>${gains(r)}</div>
        <div class="cb-bloc-duo"><div class="cb-duo">${pr.crew.map(slot).join('')}</div>
          <div class="cb-actions"><button type="button" class="ct-btn principal" data-affronter>Affronter le palier ${pr.palier}</button>
            <p>Les gardiens prennent la rareté de ton équipe : leurs stats ci-contre sont indicatives. Les paliers s'ouvrent dans l'ordre, sans limite d'essais.</p></div></div></div>`;
    }else{
      corps = `<div class="ct-vide" style="padding:22px">${api.ico('coche', 22)}<b style="display:block; margin-top:8px">Trésor vidé pour aujourd'hui</b>Reviens demain : un nouveau trésor t'attend à minuit.</div>`;
    }
    hote.innerHTML = `${entete('Le Trésor', 'Chaque jour, ' + t.total + ' paliers de gardiens de plus en plus durs, calés sur la rareté de ton équipe. Chaque palier vaincu rapporte sa récompense.')}
      <section class="ct-panneau">
        <div class="cb-chiffres" style="margin:0 0 4px"><span>Palier <b>${t.palier} / ${t.total}</b></span><span>Combats cette heure <b>${t.combats_heure} / ${t.combats_heure_max}</b></span>
          <span><b>${t.jours_complets}</b> trésor${t.jours_complets > 1 ? 's' : ''} vidé${t.jours_complets > 1 ? 's' : ''}</span></div>
        <div class="qt-barre" role="progressbar" aria-valuemin="0" aria-valuemax="${t.total}" aria-valuenow="${t.palier}"><i style="width:${pc}%"></i></div>
        <div style="margin-top:16px">${corps}</div>
      </section>
      <section style="margin-top:18px"><div class="ct-titre-sec" style="margin-top:0"><h3>Les ${t.total} paliers du jour</h3></div>
        <div class="qt-paliers">${t.paliers.map((p) => `<div class="qt-p${p.fait ? ' fait' : ''}${pr && p.palier === pr.palier ? ' suivant' : ''}"><b>${p.fait ? api.ico('coche', 14) + ' ' : ''}${p.palier}</b>
          <span>×${force(p.mult_pct)}</span><span>${p.vinyles ? '+' + pl(p.vinyles, 'vinyle') + '<br>' : ''}+${nf(p.wc)} WC${p.garantis ? '<br>+' + pl(p.garantis, 'pack garanti') : ''}</span></div>`).join('')}</div></section>`;
    const b = hote.querySelector('[data-affronter]');
    if(b) b.addEventListener('click', () => api.lancerCombat({ rpc: 'combat_quete_tresor', params: {}, titre: 'Trésor · palier ' + pr.palier, adversaires: pr.crew }));
  }

  // ---------------------------------------------------------------------
  // Le hub : les deux tuiles
  // ---------------------------------------------------------------------

  const ouvrirMode = (vue) => async (hote, api) => {
    A = api;
    css();
    hote.innerHTML = '<div class="ct-vide">Chargement…</div>';
    try{
      const acc = await charger(api.acc(), true);
      vue(hote, api, acc);
    }catch(e){
      hote.innerHTML = `<div class="ct-panneau ct-vide"><b>Ce mode n'a pas pu s'ouvrir</b>${esc(e.message)}</div>`;
    }
  };

  WC.modes.enregistrer({ id: 'faille', titre: 'La Faille', groupe: 'jeu', icone: 'eclair',
    resume: async (acc) => {
      const f = (await charger(acc)).faille;
      const jour = String(f.boss.nom || '').replace(/^Faille du /, '');
      return f.restants > 0 ? `Boss du ${jour} · ${pl(f.restants, 'essai')}` : (f.meilleur_deg ? `Meilleure note du jour : ${f.meilleure_note}` : `Boss du ${jour} · plus d'essai`);
    },
    ouvrir: ouvrirMode(vueFaille) });

  WC.modes.enregistrer({ id: 'tresor', titre: 'Le Trésor', groupe: 'jeu', icone: 'coffre',
    resume: async (acc) => {
      const t = (await charger(acc)).tresor;
      return t.palier >= t.total ? 'Trésor vidé · reviens demain' : `Palier ${t.palier} / ${t.total} aujourd'hui`;
    },
    ouvrir: ouvrirMode(vueTresor) });

  // ---------------------------------------------------------------------
  // La console de l'équipe : l'onglet « Faille & Trésor »
  // ---------------------------------------------------------------------

  const OPT = (valeur, texte, sel) => `<option value="${esc(valeur)}"${String(sel) === String(valeur) ? ' selected' : ''}>${esc(texte)}</option>`;
  const DECORS = [['concert', 'Concert (arène)'], ['studio', 'Club (briques et néon)'], ['plateau', 'Plateau télé'], ['ruelle', 'Concert de rue'], ['toit', 'Toit au coucher du soleil']];
  const JOURS = ['', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];

  // Un sélecteur d'artiste : recherche (3 lettres), puis choix dans la liste.
  function pickerHtml(n, id, nom){
    return `<div class="qt-pick" data-pick="${n}"><input type="hidden" data-k="artist${n}" value="${esc(id)}">
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

  async function eqQuete(corps, api){
    A = api;
    css();
    const vues = [['reglages', 'Réglages'], ['faille', 'Faille'], ['tresor', 'Trésor']];
    const recharger = async () => { Q.eqDonnees = await A.appel('combat_quete_equipe_lire'); dessine(); };
    const dessine = () => {
      const D = Q.eqDonnees;
      corps.innerHTML = `<nav class="cb-seg mini" aria-label="Faille et Trésor">${vues.map(([id, nom]) => `<button type="button" data-qv="${id}" aria-pressed="${id === Q.eq}">${nom}</button>`).join('')}</nav><div data-qv-corps style="margin-top:14px"></div>`;
      corps.querySelectorAll('[data-qv]').forEach((b) => b.addEventListener('click', () => { Q.eq = b.dataset.qv; dessine(); }));
      const z = corps.querySelector('[data-qv-corps]');
      if(Q.eq === 'reglages') eqReglages(z, D);
      else if(Q.eq === 'faille') eqFaille(z, D, recharger);
      else eqTresor(z, D, recharger);
    };
    corps.innerHTML = '<div class="ct-vide">Chargement…</div>';
    try{ await recharger(); }
    catch(e){ corps.innerHTML = `<div class="ct-panneau ct-vide"><b>Console indisponible</b>${esc(e.message)}</div>`; }
  }

  function eqReglages(z, D){
    z.innerHTML = `<p class="sous" style="margin:0 0 12px; font-size:13px; color:var(--muted)">Essais de la Faille, prix d'un essai acheté et plafond de combats du Trésor. Chaque valeur s'enregistre dès que tu la modifies.</p>
      <div class="qt-reg">${D.reglages.map((r) => `<label>${esc(r.libelle)}<input class="cb-champ-eq" type="number" min="0" max="5000" data-cle="${esc(r.cle)}" value="${r.valeur}"></label>`).join('')}</div>`;
    z.querySelectorAll('[data-cle]').forEach((i) => i.addEventListener('change', async () => {
      try{ await A.appel('combat_quete_equipe_reglage', { p_cle: i.dataset.cle, p_valeur: Math.round(Number(i.value)) }); A.toast('Enregistré.'); }
      catch(e){ A.toast(e.message, 'err'); }
    }));
  }

  function eqFaille(z, D, recharger){
    z.innerHTML = `<p class="sous" style="margin:0 0 12px; font-size:13px; color:var(--muted)">Un boss par jour de la semaine. Ses PV sont multipliés (il ne doit pas pouvoir tomber) ; ses autres stats suivent le bonus en %. La note vient des dégâts infligés : les seuils doivent monter avec les notes.</p>
      <div class="cb-liste">${D.boss.map((b) => `<div class="cb-ligne"><span class="cb-n">${esc(JOURS[b.jour].slice(0, 3))}</span>
        <div><h4>${esc(b.nom)}</h4><p>${esc(b.nom1)} &amp; ${esc(b.nom2)} (${esc(A.rar(b.rarete).nom)}${b.holo ? ', holo' : ''}) · stats ${b.bonus >= 0 ? '+' : ''}${b.bonus} % · PV ×${b.pv_mult}</p></div>
        <button type="button" class="ct-btn petit" data-b="${b.jour}">Modifier</button></div>`).join('')}</div>
      <div class="ct-titre-sec"><h3>Notes et butin</h3></div>
      <div class="cb-liste">${D.notes.map((n) => `<div class="cb-ligne"><span class="cb-n">${esc(n.note)}</span>
        <div><h4>${n.seuil ? '≥ ' + nf(n.seuil) + ' dégâts' : 'Dès le 1er coup'}</h4><p>${nf(n.wc)} WC · ${pl(n.vinyles, 'vinyle')} · ${pl(n.garantis, 'pack garanti')}</p></div>
        <button type="button" class="ct-btn petit" data-n="${esc(n.note)}">Modifier</button></div>`).join('')}</div>`;
    z.querySelectorAll('[data-b]').forEach((bt) => bt.addEventListener('click', () => {
      const b = D.boss.find((x) => String(x.jour) === bt.dataset.b);
      editeur(b.nom, `${champ('nom', 'Nom', b.nom)}${champ('description', 'Description', b.description)}
        ${pickerHtml(1, b.artist1, b.nom1)}${pickerHtml(2, b.artist2, b.nom2)}${rarSel('rarete', b.rarete)}
        <label>Holo<select class="cb-champ-eq" data-k="holo">${OPT('true', 'Oui', String(b.holo))}${OPT('false', 'Non', String(b.holo))}</select></label>
        ${nombre('bonus', 'Stats en plus (%, négatif = plus faible)', b.bonus, -80, 300)}${nombre('pv_mult', 'PV multipliés par', b.pv_mult, 1, 500)}${decorSel(b.decor)}`,
        'combat_quete_equipe_boss', { jour: b.jour },
        (p) => { ['rarete', 'bonus', 'pv_mult'].forEach((k) => { p[k] = Math.round(Number(p[k])); }); p.holo = p.holo === 'true'; },
        recharger);
    }));
    z.querySelectorAll('[data-n]').forEach((bt) => bt.addEventListener('click', () => {
      const n = D.notes.find((x) => x.note === bt.dataset.n);
      editeur('Note ' + n.note, `${nombre('seuil', 'Dégâts à infliger', n.seuil, 0, 100000000)}${nombre('wc', 'Wave Coins', n.wc, 0, 5000)}
        ${nombre('vinyles', 'Vinyles', n.vinyles, 0, 100)}${nombre('garantis', 'Packs Épique garanti', n.garantis, 0, 10)}`,
        'combat_quete_equipe_note', { note: n.note },
        (p) => { ['seuil', 'wc', 'vinyles', 'garantis'].forEach((k) => { p[k] = Math.round(Number(p[k])); }); },
        recharger);
    }));
  }

  function eqTresor(z, D, recharger){
    z.innerHTML = `<p class="sous" style="margin:0 0 12px; font-size:13px; color:var(--muted)">Les paliers du Trésor. La force des gardiens est un % d'une carte normale de la rareté du duo du joueur (84 = 16 % plus faibles, 160 = 60 % plus forts).</p>
      <div class="cb-liste">${D.paliers.map((p) => `<div class="cb-ligne"><span class="cb-n">${p.palier}</span>
        <div><h4>Gardiens ×${force(p.mult_pct)}</h4><p>${nf(p.wc)} WC · ${pl(p.vinyles, 'vinyle')} · ${pl(p.garantis, 'pack garanti')}</p></div>
        <button type="button" class="ct-btn petit" data-p="${p.palier}">Modifier</button></div>`).join('')}</div>`;
    z.querySelectorAll('[data-p]').forEach((bt) => bt.addEventListener('click', () => {
      const p = D.paliers.find((x) => String(x.palier) === bt.dataset.p);
      editeur('Palier ' + p.palier, `${nombre('mult_pct', 'Force des gardiens (%)', p.mult_pct, 20, 600)}${nombre('wc', 'Wave Coins', p.wc, 0, 5000)}
        ${nombre('vinyles', 'Vinyles', p.vinyles, 0, 100)}${nombre('garantis', 'Packs Épique garanti', p.garantis, 0, 10)}`,
        'combat_quete_equipe_palier', { palier: p.palier },
        (v) => { ['mult_pct', 'wc', 'vinyles', 'garantis'].forEach((k) => { v[k] = Math.round(Number(v[k])); }); },
        recharger);
    }));
  }

  if(WC.equipeVues) WC.equipeVues.enregistrer({ id: 'quete', nom: 'Faille & Trésor', ouvrir: eqQuete });

  window.WaveCombatQuete = { modes: ['faille', 'tresor'] };

})();
