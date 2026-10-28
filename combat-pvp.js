/* =====================================================================
   La Wave — Wave Cards : l'Arène classée 2v2 et la Saison mensuelle

   Un mode du hub de combat (voir l'en-tête de combat.js), chargé avec lui (« combat-pvp » dans WAVE_MODULES, index.html).
   Les règles vivent dans la base (sql/combat-pvp-arene.sql) : tickets, points Elo, rangs, récompense hebdomadaire du dimanche,
   saison mensuelle et ses tranches de récompenses. Ce fichier demande et dessine ; aucun calcul de points ici.

     Combattre   mes tickets d'attaque, ma défense (jouée par l'ordinateur quand on m'attaque), les adversaires proches de mon rang
     Rang        l'écran de rang (Débutant → Bronze → Argent → Or → Platine → Diamant → Légende), la récompense du dimanche, le classement
     Saison      compte à rebours, podium, ma place et ma tranche, récompenses de fin de saison, classement de la saison
     Journal     mes attaques et mes défenses
     Équipe      WaveCombat.equipeVues : réglages (tickets, K, rangs, récompenses) et saisons (dates, tranches) — console équipe

   Classements de l'Accueil : ajoute « Arène classée » et « Saison » à window.WaveClassements (format décrit en tête d'accueil.js).
   ===================================================================== */

(function(){

  'use strict';

  const S = { api: null, hote: null, d: null, vue: 'combattre', t0: 0, minuteur: null, adv: null, cl: {}, rec: null, histo: null };

  const VUES = [['combattre', 'Combattre'], ['rang', 'Mon rang'], ['saison', 'Saison'], ['journal', 'Journal']];

  const CSS = `
  .pv{display:grid; gap:16px;}
  .pv *{box-sizing:border-box;}
  .pv-tete{display:grid; grid-template-columns:auto 1fr; gap:16px; align-items:center;}
  .pv-ecu{display:block; width:72px; height:80px; flex:none;}
  .pv-ecu.grand{width:132px; height:148px;}
  .pv-tete h3{margin:0; font-size:19px; letter-spacing:-.01em;}
  .pv-tete p{margin:4px 0 0; font-size:13px; line-height:1.5; color:var(--muted);}
  .pv-pts{font-variant-numeric:tabular-nums; font-weight:900;}
  .pv-chiffres{display:flex; flex-wrap:wrap; gap:8px; margin-top:12px;}
  .pv-chiffres span{padding:6px 10px; border-radius:10px; font-size:12.5px; color:var(--ink-soft); background:var(--ct-surface-2); font-variant-numeric:tabular-nums;}
  .pv-chiffres b{color:var(--ink);}
  .pv-tickets{display:flex; flex-wrap:wrap; align-items:center; gap:14px 18px;}
  .pv-pips{display:flex; gap:7px; flex-wrap:wrap;}
  .pv-pip{width:26px; height:34px; border-radius:7px; border:2px solid var(--ct-trait-fort); background:transparent; transform:skewX(-8deg); transition:background .3s, border-color .3s, box-shadow .3s;}
  .pv-pip.plein{background:linear-gradient(180deg, #8fd0ff, #4FB4FF); border-color:#4FB4FF; box-shadow:0 0 12px rgba(79,180,255,.45);}
  .pv-compte{font-variant-numeric:tabular-nums; font-weight:800; color:var(--ink);}
  .pv-section-t{display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:8px; margin:0 0 10px;}
  .pv-section-t h3{margin:0; font-size:12px; font-weight:800; letter-spacing:.12em; text-transform:uppercase; color:var(--muted);}
  .pv-adv{display:grid; grid-template-columns:auto 1fr; gap:10px 14px; align-items:center; padding:14px; border-radius:16px; border:1px solid var(--ct-trait); background:var(--ct-surface);}
  .pv-adv .pv-act{grid-column:1 / -1; display:flex; flex-wrap:wrap; align-items:center; gap:8px 10px;}
  .pv-adv .pv-act .ct-btn{margin-left:auto;}
  .pv-avatar{width:44px; height:44px; border-radius:50%; object-fit:cover; background:#0a1018; border:2px solid var(--rc, #2a3340); display:block;}
  .pv-adv h4{margin:0; font-size:15px; display:flex; flex-wrap:wrap; align-items:center; gap:6px 8px;}
  .pv-adv p{margin:3px 0 0; font-size:12.5px; line-height:1.45; color:var(--muted);}
  .pv-rang-tag{display:inline-flex; align-items:center; gap:5px; height:22px; padding:0 9px; border-radius:99px; font-size:11px; font-weight:800; letter-spacing:.05em; text-transform:uppercase; color:#06090e; background:var(--rc, #8A94A3);}
  .pv-gain{font-weight:800; font-variant-numeric:tabular-nums;}
  .pv-gain.p{color:#5BE0A6;} .pv-gain.m{color:#FF7A85;}
  .pv-barre{display:grid; gap:6px;}
  .pv-barre .ct-barre{height:10px;}
  .pv-barre .ct-barre i{background:linear-gradient(90deg, var(--rc, #4FB4FF), color-mix(in srgb, var(--rc, #4FB4FF) 60%, #fff));}
  .pv-barre small{font-size:12.5px; color:var(--muted);}
  .pv-echelle{display:grid; gap:8px;}
  .pv-echelle .cb-ligne{grid-template-columns:auto 1fr auto;}
  .pv-echelle .cb-ligne.moi{border-color:var(--rc, #4FB4FF); background:color-mix(in srgb, var(--rc, #4FB4FF) 10%, transparent);}
  .pv-echelle .pv-ecu{width:38px; height:42px;}
  .pv-recompense{display:flex; flex-wrap:wrap; gap:6px; justify-content:flex-end;}
  .pv-nouveau{display:flex; flex-wrap:wrap; align-items:center; gap:10px; padding:12px 14px; border-radius:14px; border:1px solid rgba(242,193,78,.45); background:rgba(242,193,78,.1); font-size:14px; line-height:1.45;}
  .pv-compte-saison{display:flex; flex-wrap:wrap; gap:10px;}
  .pv-bloc{display:grid; place-items:center; min-width:72px; padding:10px 12px; border-radius:14px; background:var(--ct-surface-2);}
  .pv-bloc b{font-size:26px; line-height:1; font-variant-numeric:tabular-nums; letter-spacing:-.02em;}
  .pv-bloc span{margin-top:5px; font-size:11px; font-weight:700; letter-spacing:.1em; text-transform:uppercase; color:var(--muted);}
  .pv-podium{display:grid; grid-template-columns:repeat(3, minmax(0, 1fr)); gap:10px; align-items:end; margin-top:6px;}
  .pv-marche{display:grid; justify-items:center; gap:6px; text-align:center; min-width:0;}
  .pv-marche .pv-avatar{width:54px; height:54px;}
  .pv-marche.p1 .pv-avatar{width:66px; height:66px; border-color:#F2C14E; box-shadow:0 0 18px rgba(242,193,78,.45);}
  .pv-marche b{max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:13.5px;}
  .pv-marche small{font-size:12px; color:var(--muted); font-variant-numeric:tabular-nums;}
  .pv-socle{display:grid; place-items:center; width:100%; border-radius:12px 12px 0 0; font-size:20px; font-weight:900; color:#06090e; background:linear-gradient(180deg, var(--cm, #8A94A3), color-mix(in srgb, var(--cm, #8A94A3) 55%, #000));}
  .pv-marche.p1 .pv-socle{height:84px; --cm:#F2C14E;} .pv-marche.p2 .pv-socle{height:62px; --cm:#C0C8D4;} .pv-marche.p3 .pv-socle{height:46px; --cm:#CD7F32;}
  .pv-marche.p2{order:-1;}
  .pv-tranches .cb-ligne.moi{border-color:rgba(242,193,78,.6); background:rgba(242,193,78,.08);}
  .pv-vide{padding:22px 16px; text-align:center; color:var(--muted); font-size:14px; line-height:1.5;}
  .pv-fiche-eq{display:grid; gap:14px;}
  .pv-champs{display:grid; grid-template-columns:repeat(auto-fit, minmax(150px, 1fr)); gap:12px;}
  .pv-champs label{display:grid; gap:5px; font-size:12px; font-weight:700; color:var(--ink-soft);}
  .pv-champs input{width:100%; min-width:0;}
  .pv-champs small{font-weight:500; color:var(--muted); line-height:1.4;}
  .pv-table{width:100%; border-collapse:collapse; font-size:13px;}
  .pv-table th, .pv-table td{padding:6px 6px; text-align:left; border-bottom:1px solid var(--ct-trait);}
  .pv-table input{width:100%; min-width:64px;}
  .pv-tr-ed{display:grid; grid-template-columns:minmax(0, 1.4fr) repeat(3, minmax(0, 1fr)) auto; gap:6px; align-items:center; margin-bottom:6px;}
  @media (max-width:560px){
    .pv-tete{grid-template-columns:auto 1fr; gap:12px;}
    .pv-ecu.grand{width:104px; height:116px;}
    .pv-tr-ed{grid-template-columns:1fr 1fr; }
    .pv-bloc{min-width:62px; padding:9px 8px;} .pv-bloc b{font-size:22px;}
    .pv-echelle .cb-ligne{grid-template-columns:auto 1fr; } .pv-echelle .pv-recompense{grid-column:1 / -1; justify-content:flex-start;}
  }
  @media (prefers-reduced-motion: reduce){ .pv-pip{transition:none;} }
  `;

  // ---------------------------------------------------------------------
  // Petits outils
  // ---------------------------------------------------------------------

  const A = () => S.api || (window.Cartes && window.Cartes.api);
  const esc = (t) => A().esc(t);
  const nf = (n) => A().nf(n);
  const hex = (c) => (/^#[0-9a-fA-F]{6}$/.test(String(c || '')) ? c : '#8A94A3');
  const signe = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n);
  const fmtDate = (iso, opts) => (iso ? new Date(String(iso).length <= 10 ? iso + 'T12:00:00' : iso).toLocaleDateString('fr-FR', opts || { day: 'numeric', month: 'short' }) : '');
  const pluriel = (n, un, plusieurs) => (n > 1 ? plusieurs : un);

  function css(){
    if(document.getElementById('pv-style')) return;
    const s = document.createElement('style');
    s.id = 'pv-style';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  // L'écusson d'un rang : un bouclier teinté, le numéro du rang au centre.
  function ecu(rang, grand){
    const c = hex(rang && rang.couleur), id = 'pvg' + Math.random().toString(36).slice(2, 8);
    return `<svg class="pv-ecu${grand ? ' grand' : ''}" viewBox="0 0 64 72" role="img" aria-label="Rang ${esc((rang && rang.nom) || '')}">
      <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c}"/><stop offset="1" stop-color="${c}" stop-opacity=".45"/></linearGradient></defs>
      <path d="M32 3 59 13v23c0 17-12 28-27 33C17 64 5 53 5 36V13z" fill="url(#${id})" stroke="${c}" stroke-width="2"/>
      <path d="M32 11 52 18.500v17.500c0 12.500-9 21-20 25-11-4-20-12.500-20-25V18.500z" fill="rgba(5,8,14,.62)"/>
      <text x="32" y="44" text-anchor="middle" font-size="26" font-weight="900" fill="${c}" font-family="Arial, sans-serif">${(rang && rang.ordre) || ''}</text></svg>`;
  }

  const tagRang = (rang) => (rang ? `<span class="pv-rang-tag" style="--rc:${hex(rang.couleur)}">${esc(rang.nom)}</span>` : '');

  const puceRec = (vinyles, wc) => [
    vinyles ? `<span class="cb-puce or">${A().ico('vinyle', 13)}+${vinyles} vinyle${vinyles > 1 ? 's' : ''}</span>` : '',
    wc ? `<span class="cb-puce">${A().ico('piece', 13)}+${nf(wc)} Wave Coins</span>` : ''
  ].join('') || '<span class="cb-puce">Aucune</span>';

  const avatarHtml = (url, couleur) => `<img class="pv-avatar" style="--rc:${hex(couleur)}" src="${esc(A().safeUrl(url || ''))}" alt="" loading="lazy">`;

  function dureeCourte(s){
    s = Math.max(0, Math.floor(s));
    const m = Math.floor(s / 60), r = s % 60;
    return (m >= 60 ? Math.floor(m / 60) + ' h ' + String(m % 60).padStart(2, '0') + ' min' : m + ':' + String(r).padStart(2, '0'));
  }

  const dureeLongue = (min) => (min < 60 ? min + ' min' : Math.floor(min / 60) + ' h' + (min % 60 ? ' ' + String(min % 60).padStart(2, '0') : ''));

  // ---------------------------------------------------------------------
  // Chargement et squelette
  // ---------------------------------------------------------------------

  async function charger(){
    S.d = await A().appel('pvp_accueil');
    S.t0 = Date.now();
    S.adv = null; S.rec = null; S.histo = null; S.cl = {};
  }

  async function ouvrir(hote, api){
    S.api = api;
    S.hote = hote;
    css();
    hote.innerHTML = '<div class="ct-vide">Chargement…</div>';
    await charger();
    dessiner();
  }

  function dessiner(){
    const d = S.d, m = d.moi;
    S.hote.innerHTML = `
      <div class="pv">
        <div class="ct-titre-sec" style="margin-top:0"><h3>Arène classée</h3></div>
        <p class="sous" style="margin:-6px 0 0; font-size:13px; color:var(--muted); line-height:1.5">Attaque la défense d'autres joueurs avec ton duo : chaque victoire te fait gagner des points d'arène et grimper de rang. Des tickets se rechargent avec le temps, et une saison mensuelle récompense les meilleurs.</p>
        <section class="ct-panneau pv-tete">
          ${ecu(m.rang, true)}
          <div><h3>${esc(m.rang.nom)} · <span class="pv-pts">${nf(m.points)}</span> points</h3>
            <p>${m.place ? 'N° ' + m.place + ' du classement général' : 'Pas encore classé : lance ta première attaque'} · ${esc(d.saison.nom)}</p>
            <div class="pv-chiffres"><span><b>${m.victoires}</b> victoire${m.victoires > 1 ? 's' : ''}</span><span><b>${m.defaites}</b> défaite${m.defaites > 1 ? 's' : ''}</span>
              <span>Défenses tenues <b>${m.defenses_tenues}</b></span></div></div>
        </section>
        <nav class="cb-seg" aria-label="Arène classée">${VUES.map(([id, nom]) => `<button type="button" data-pv="${id}" aria-pressed="${S.vue === id}">${nom}${id === 'rang' && d.nouvelles_recompenses ? ' ●' : ''}</button>`).join('')}</nav>
        <div data-pv-corps></div>
      </div>`;
    S.hote.querySelectorAll('[data-pv]').forEach((b) => b.addEventListener('click', () => { S.vue = b.dataset.pv; dessiner(); }));
    const c = S.hote.querySelector('[data-pv-corps]');
    if(S.vue === 'rang') vueRang(c);
    else if(S.vue === 'saison') vueSaison(c);
    else if(S.vue === 'journal') vueJournal(c);
    else vueCombattre(c);
    demarrerHorloge();
  }

  // Les compteurs (prochain ticket, fin de saison) avancent seconde par seconde ; ils s'arrêtent quand l'écran disparaît.
  function demarrerHorloge(){
    clearInterval(S.minuteur);
    const maj = () => {
      if(!S.hote || !S.hote.isConnected){ clearInterval(S.minuteur); return; }
      const ecoule = (Date.now() - S.t0) / 1000;
      S.hote.querySelectorAll('[data-ticket]').forEach((e) => {
        const reste = (S.d.moi.prochain_ticket_s || 0) - ecoule;
        e.textContent = reste > 0 ? dureeCourte(reste) : 'prêt';
        if(reste <= 0 && !S.rafraichi){ S.rafraichi = true; recharger(); }
      });
      const r = (S.d.saison.secondes_restantes || 0) - ecoule;
      const j = Math.floor(r / 86400), h = Math.floor(r % 86400 / 3600), mi = Math.floor(r % 3600 / 60), s = Math.floor(r % 60);
      const v = { j, h, m: mi, s };
      S.hote.querySelectorAll('[data-saison-t]').forEach((e) => { e.textContent = String(Math.max(0, v[e.dataset.saisonT])).padStart(2, '0'); });
    };
    S.rafraichi = false;
    maj();
    S.minuteur = setInterval(maj, 1000);
  }

  async function recharger(){
    try{ await charger(); if(S.hote && S.hote.isConnected) dessiner(); }catch(e){ /* l'écran reste tel quel */ }
  }

  // ---------------------------------------------------------------------
  // Combattre
  // ---------------------------------------------------------------------

  const slotDef = (c) => `<div class="cb-slot" style="--tc:${A().couleurOk(c.couleur || '#9aa4b2')}">
      ${A().carteHtml({ nom: c.nom, photo: c.photo, rarete: c.rarete, holo: c.holo, numero: c.numero || 0 }, {})}
      <div class="cb-slot-i"><b>${esc(c.nom)}</b><div class="cb-mini-stats"><span>PV <b>${nf(c.pv)}</b></span><span>PUI <b>${nf(c.pui)}</b></span><span>DÉF <b>${nf(c.def)}</b></span><span>VIT <b>${nf(c.vit)}</b></span></div></div></div>`;

  function vueCombattre(c){
    const d = S.d, m = d.moi, def = d.defense;
    const pips = Array.from({ length: m.tickets_max }, (_, i) => `<span class="pv-pip${i < m.tickets ? ' plein' : ''}"></span>`).join('');
    c.innerHTML = `
      <section class="ct-panneau">
        <div class="pv-tickets"><div class="pv-pips" role="img" aria-label="${m.tickets} ticket${m.tickets > 1 ? 's' : ''} sur ${m.tickets_max}">${pips}</div>
          <div><b>${m.tickets} / ${m.tickets_max}</b> ticket${m.tickets > 1 ? 's' : ''} d'attaque
            <div style="font-size:12.5px; color:var(--muted); margin-top:3px">${m.tickets < m.tickets_max ? `Prochain ticket dans <span class="pv-compte" data-ticket>${dureeCourte(m.prochain_ticket_s || 0)}</span> · ` : 'Au maximum · '}1 ticket toutes les ${dureeLongue(m.recharge_minutes)}</div></div></div>
      </section>
      <section class="ct-panneau">
        <div class="ct-entete-panneau"><div><h3>Ma défense</h3><p class="sous">Quand un joueur t'attaque, ce duo se bat à ta place, piloté par l'ordinateur. Chaque défense tenue te rapporte des points.</p></div></div>
        <div class="cb-bloc-duo"><div class="cb-duo">${def.valide ? def.duo.map(slotDef).join('') : '<div class="cb-slot"><div class="vide">Carte à choisir</div></div><div class="cb-slot"><div class="vide">Carte à choisir</div></div>'}</div>
          <div class="cb-actions"><button type="button" class="ct-btn ${def.valide ? '' : 'principal'}" data-defense>${def.valide ? 'Changer ma défense' : 'Régler ma défense'}</button>
            ${def.valide ? '' : '<p>Il faut une défense valide pour attaquer et pour être attaqué.</p>'}</div></div>
      </section>
      <section>
        <div class="pv-section-t"><h3>Adversaires proches de ton rang</h3><span class="cb-puce">Gain estimé selon l'écart de points</span></div>
        <div class="cb-liste" data-adv><div class="ct-vide" style="padding:20px">Chargement…</div></div>
      </section>`;
    c.querySelector('[data-defense]').addEventListener('click', async () => {
      const r = await A().equipeModal({ titre: 'Ma défense (Arène classée)', sansOptions: true, confirmer: 'Valider ma défense', duo: def.valide ? def.duo : undefined });
      if(!r) return;
      try{
        await A().appel('pvp_defense_sauver', { p_duo: r.duo });
        A().toast('Défense enregistrée.');
        await recharger();
      }catch(e){ A().toast(e.message, 'err'); }
    });
    listeAdversaires(c.querySelector('[data-adv]'));
  }

  async function listeAdversaires(zone){
    try{
      if(!S.adv) S.adv = await A().appel('pvp_adversaires');
    }catch(e){
      zone.innerHTML = `<div class="ct-panneau pv-vide">${esc(e.message)}</div>`;
      return;
    }
    if(!zone.isConnected) return;
    const m = S.d.moi, max = S.d.regles.max_par_adversaire, pret = S.d.defense.valide && m.tickets > 0;
    if(!S.adv.length){
      zone.innerHTML = '<div class="ct-panneau pv-vide"><b style="display:block; color:var(--ink); margin-bottom:4px">Aucun adversaire pour le moment</b>Les adversaires sont les autres joueurs qui ont réglé leur défense. Invite des amis, ils apparaîtront ici.</div>';
      return;
    }
    zone.innerHTML = S.adv.map((a, i) => {
      const atteint = a.attaques_aujourdhui >= max;
      return `<div class="pv-adv" style="--rc:${hex(a.rang.couleur)}">
        ${avatarHtml(a.avatar, a.rang.couleur)}
        <div><h4>${esc(a.pseudo)} ${tagRang(a.rang)}</h4>
          <p>${nf(a.points)} points · défense : ${a.duo.map((c) => esc(c.nom)).join(' &amp; ')}</p></div>
        <div class="pv-act">
          <span class="cb-portraits">${a.duo.map((c) => `<img style="--tc:${A().couleurOk(c.couleur)}" src="${esc(A().safeUrl(c.photo))}" alt="${esc(c.nom)}" title="${esc(c.nom)} · ${esc(c.type_nom || '')}" loading="lazy">`).join('')}</span>
          <span class="pv-gain p" title="Points si tu gagnes">${signe(a.gain)}</span><span class="pv-gain m" title="Points si tu perds">${signe(a.perte)}</span>
          <span class="cb-puce">${a.attaques_aujourdhui} / ${max} aujourd'hui</span>
          <button type="button" class="ct-btn petit principal" data-att="${i}" ${pret && !atteint ? '' : 'disabled'}>${!S.d.defense.valide ? 'Règle ta défense' : m.tickets < 1 ? 'Plus de ticket' : atteint ? 'Déjà attaqué' : 'Attaquer'}</button></div>
      </div>`;
    }).join('');
    zone.querySelectorAll('[data-att]').forEach((b) => b.addEventListener('click', async () => {
      const a = S.adv[Number(b.dataset.att)];
      b.disabled = true;
      try{
        await A().lancerCombat({ rpc: 'pvp_attaquer', params: { p_cible: a.user_id }, titre: 'Arène classée · ' + a.pseudo, adversaires: a.duo, confirmer: 'Attaquer' });
      }finally{ if(b.isConnected) b.disabled = false; }
    }));
  }

  // ---------------------------------------------------------------------
  // Mon rang
  // ---------------------------------------------------------------------

  async function vueRang(c){
    const d = S.d, m = d.moi, r = m.rang, suiv = m.suivant, h = d.hebdo;
    const de = r.minimum, vers = suiv ? suiv.minimum : null;
    const p = vers ? Math.max(0, Math.min(100, (m.points - de) / (vers - de) * 100)) : 100;
    c.innerHTML = `
      ${d.nouvelles_recompenses ? `<div class="pv-nouveau"><span>${A().ico('cadeau', 18)}</span><div><b>${d.nouvelles_recompenses} récompense${d.nouvelles_recompenses > 1 ? 's' : ''} versée${d.nouvelles_recompenses > 1 ? 's' : ''}</b> — elles sont déjà dans ton solde. Détail en bas de cette page.</div></div>` : ''}
      <section class="ct-panneau" style="--rc:${hex(r.couleur)}">
        <div class="pv-tete">${ecu(r, true)}
          <div><h3>Rang ${esc(r.nom)}</h3>
            <p>${suiv ? `Encore <b>${nf(vers - m.points)}</b> points pour atteindre ${esc(suiv.nom)}.` : 'Tu es au sommet : rang Légende.'}</p>
            <div class="pv-barre" style="margin-top:10px"><span class="ct-barre"><i style="width:${p}%"></i></span>
              <small>${nf(de)} <span aria-hidden="true">→</span> ${vers ? nf(vers) : '∞'} · record ${nf(m.meilleurs_points)}</small></div></div></div>
      </section>
      <section class="ct-panneau">
        <div class="ct-entete-panneau"><div><h3>Récompense du dimanche</h3>
          <p class="sous">Chaque dimanche, ton rang d'arène te rapporte une récompense, à condition d'avoir attaqué au moins une fois pendant la semaine qui se termine.</p></div></div>
        <div class="cb-chiffres" style="margin-top:0"><span>Prochain versement : <b>dimanche ${esc(fmtDate(h.prochain, { day: 'numeric', month: 'long' }))}</b></span>
          <span class="pv-recompense" style="display:inline-flex">${puceRec(h.vinyles, h.wc)}</span>
          <span class="${h.eligible ? 'cb-puce ok' : 'cb-puce or'}">${h.eligible ? 'Éligible : ' + h.attaques + ' attaque' + (h.attaques > 1 ? 's' : '') + ' cette semaine' : 'Attaque au moins une fois cette semaine'}</span></div>
      </section>
      <section>
        <div class="pv-section-t"><h3>Les sept rangs</h3></div>
        <div class="pv-echelle">${d.rangs.map((x) => `<div class="cb-ligne${x.id === r.id ? ' moi' : ''}" style="--rc:${hex(x.couleur)}">${ecu(x, false)}
          <div><h4>${esc(x.nom)}</h4><p>${nf(x.minimum)} points et plus${x.id === r.id ? ' · ton rang actuel' : ''}</p></div>
          <div class="pv-recompense">${puceRec(x.vinyles, x.wc)}</div></div>`).join('')}</div>
      </section>
      <section>
        <div class="pv-section-t"><h3>Classement général</h3></div>
        <div class="cb-liste" data-cl><div class="ct-vide" style="padding:20px">Chargement…</div></div>
      </section>
      <section>
        <div class="pv-section-t"><h3>Récompenses reçues</h3></div>
        <div class="cb-liste" data-rec><div class="ct-vide" style="padding:20px">Chargement…</div></div>
      </section>`;
    classement(c.querySelector('[data-cl]'), 'points', 10);
    try{
      if(!S.rec){ S.rec = await A().appel('pvp_recompenses_voir'); if(S.d.nouvelles_recompenses) S.d.nouvelles_recompenses = 0; }
    }catch(e){ S.rec = []; }
    const z = c.querySelector('[data-rec]');
    if(!z) return;
    z.innerHTML = S.rec.length ? S.rec.map((x) => `<div class="cb-ligne${x.vu ? '' : ' moi'}"><span class="cb-n">${A().ico(x.type === 'saison' ? 'trophee' : 'cadeau', 18)}</span>
        <div><h4>${esc(x.libelle)}</h4><p>${esc(fmtDate(x.date))}${x.detail && x.detail.rang && x.type === 'saison' ? ` · n° ${x.detail.rang} sur ${x.detail.total}` : ''}</p></div>
        <div class="pv-recompense">${puceRec(x.vinyles, x.wc)}</div></div>`).join('')
      : '<div class="ct-panneau pv-vide">Aucune récompense pour l\'instant. La première arrive dimanche si tu attaques cette semaine.</div>';
  }

  async function classement(zone, type, limite){
    try{
      if(!S.cl[type]) S.cl[type] = await A().appel('pvp_classement', { p_type: type });
    }catch(e){
      zone.innerHTML = `<div class="ct-panneau pv-vide">${esc(e.message)}</div>`;
      return;
    }
    if(!zone.isConnected) return;
    const cl = S.cl[type], l = cl.lignes.slice(0, limite);
    zone.innerHTML = l.length ? l.map((x) => `<div class="cb-ligne${x.moi ? ' moi' : ''}"><div class="cb-n">${x.rang}</div>
        <div style="display:flex; align-items:center; gap:10px; min-width:0">${avatarHtml(x.avatar)}<div style="min-width:0"><h4 style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${esc(x.pseudo)}</h4><p>${esc(x.rang_nom || '')}</p></div></div>
        <b class="pv-pts">${nf(x.valeur)}</b></div>`).join('') + (cl.moi && cl.moi.rang > limite ? `<div class="cb-ligne moi"><div class="cb-n">${cl.moi.rang}</div><div><h4>Toi</h4></div><b class="pv-pts">${nf(cl.moi.valeur)}</b></div>` : '')
      : '<div class="ct-panneau pv-vide">Personne n\'est encore classé. Sois le premier !</div>';
  }

  // ---------------------------------------------------------------------
  // La saison
  // ---------------------------------------------------------------------

  function vueSaison(c){
    const d = S.d, sa = d.saison, m = d.moi;
    const tranches = (sa.recompenses || []).slice().sort((a, b) => a.top_pct - b.top_pct);
    const maTranche = sa.ma_place ? tranches.find((t) => sa.ma_place <= Math.max(1, Math.ceil(sa.participants * t.top_pct / 100))) : null;
    const pod = sa.podium || [];
    const marche = (x, n) => (x ? `<div class="pv-marche p${n}">${avatarHtml(x.avatar)}<b title="${esc(x.pseudo)}">${esc(x.pseudo)}</b><small>${nf(x.valeur)} pts</small><div class="pv-socle">${n}</div></div>` : `<div class="pv-marche p${n}"><div class="pv-socle" style="opacity:.35">${n}</div></div>`);
    c.innerHTML = `
      <section class="ct-panneau">
        <div class="ct-entete-panneau"><div><h3>${esc(sa.nom)}</h3><p class="sous">Du ${esc(fmtDate(sa.debut, { day: 'numeric', month: 'long' }))} au ${esc(fmtDate(sa.fin, { day: 'numeric', month: 'long' }))}. Les points de saison se gagnent par les victoires en attaque et les défenses tenues (+${d.regles.points_defense}).</p></div></div>
        <div class="pv-compte-saison" role="timer" aria-label="Temps restant avant la fin de la saison">
          <div class="pv-bloc"><b data-saison-t="j">00</b><span>jours</span></div><div class="pv-bloc"><b data-saison-t="h">00</b><span>heures</span></div>
          <div class="pv-bloc"><b data-saison-t="m">00</b><span>min</span></div><div class="pv-bloc"><b data-saison-t="s">00</b><span>sec</span></div></div>
      </section>
      <section class="ct-panneau">
        <div class="ct-entete-panneau"><div><h3>Podium</h3></div><span class="cb-puce">${sa.participants} participant${sa.participants > 1 ? 's' : ''}</span></div>
        ${pod.length ? `<div class="pv-podium">${marche(pod[1], 2)}${marche(pod[0], 1)}${marche(pod[2], 3)}</div>` : '<div class="pv-vide">Personne n\'a encore marqué de points cette saison. Le podium est à prendre.</div>'}
        <div class="cb-chiffres"><span>Tes points de saison : <b>${nf(m.points_saison)}</b></span>
          <span>${sa.ma_place ? 'Ta place : <b>n° ' + sa.ma_place + '</b> sur ' + sa.participants : 'Pas encore classé : gagne une attaque'}</span>
          ${maTranche ? `<span class="cb-puce or">Tranche actuelle : ${esc(maTranche.nom)}</span>` : ''}</div>
      </section>
      <section class="pv-tranches">
        <div class="pv-section-t"><h3>Récompenses de fin de saison</h3></div>
        <div class="cb-liste">${tranches.map((t) => `<div class="cb-ligne${maTranche && maTranche.top_pct === t.top_pct ? ' moi' : ''}"><span class="cb-n">${A().ico('trophee', 18)}</span>
          <div><h4>${esc(t.nom)}</h4><p>${t.top_pct >= 100 ? 'Tous les participants' : 'Les ' + t.top_pct + ' % meilleurs'}</p></div><div class="pv-recompense">${puceRec(t.vinyles, t.wc)}</div></div>`).join('')}</div>
        <p class="sous" style="font-size:12.5px; color:var(--muted); line-height:1.5; margin:10px 0 0">À la fin de la saison, les récompenses sont versées automatiquement et le classement de saison repart de zéro. Tes points d'arène, eux, ne gardent que ${d.regles.conserve_pct} % de l'écart avec 1 000 : tu repars à mi-chemin de tes points de départ.</p>
      </section>
      <section>
        <div class="pv-section-t"><h3>Classement de la saison</h3></div>
        <div class="cb-liste" data-cl><div class="ct-vide" style="padding:20px">Chargement…</div></div>
      </section>`;
    classement(c.querySelector('[data-cl]'), 'saison', 15);
  }

  // ---------------------------------------------------------------------
  // Le journal
  // ---------------------------------------------------------------------

  async function vueJournal(c){
    c.innerHTML = '<div class="ct-vide">Chargement…</div>';
    try{
      if(!S.histo) S.histo = await A().appel('pvp_historique');
    }catch(e){
      c.innerHTML = `<div class="ct-panneau pv-vide">${esc(e.message)}</div>`;
      return;
    }
    if(!c.isConnected) return;
    c.innerHTML = S.histo.length ? `<div class="cb-liste">${S.histo.map((h) => `
      <div class="cb-ligne"><span class="cb-res ${h.victoire ? 'victoire' : 'defaite'}">${h.victoire ? 'Victoire' : 'Défaite'}</span>
        <div><h4>${h.sens === 'attaque' ? 'Attaque contre' : 'Défense contre'} ${esc(h.adversaire)}</h4>
          <p>${esc((h.moi || []).join(' & '))} contre ${esc((h.face || []).join(' & '))} · ${esc(fmtDate(h.date))}</p></div>
        <span class="cb-delta ${h.delta >= 0 ? 'p' : 'm'}">${signe(h.delta || 0)}</span></div>`).join('')}</div>`
      : '<div class="ct-panneau pv-vide"><b style="display:block; color:var(--ink); margin-bottom:4px">Aucun combat classé pour l\'instant</b>Lance une attaque depuis l\'onglet Combattre.</div>';
  }

  // ---------------------------------------------------------------------
  // La console de l'équipe : réglages, rangs, saisons
  // ---------------------------------------------------------------------

  const LIB_REGLAGES = [
    ['tickets_max', 'Tickets au maximum', 'Plafond de tickets d\'attaque stockés (1 à 20).'],
    ['recharge_minutes', 'Recharge d\'un ticket (min)', 'Minutes pour regagner 1 ticket (10 à 1 440).'],
    ['facteur_k', 'Facteur K (Elo)', 'Amplitude des points gagnés ou perdus par combat (4 à 100).'],
    ['points_depart', 'Points de départ', 'Points d\'un nouveau joueur et centre du retour à mi-chemin.'],
    ['conserve_pct', 'Conservé à la saison suivante (%)', '100 = rien ne bouge, 0 = tout le monde repart au départ.'],
    ['max_par_adversaire', 'Attaques par adversaire et par jour', 'Évite d\'enchaîner la même victime (1 à 20).'],
    ['points_defense', 'Points de saison par défense tenue', 'Récompense la défense (0 à 50).']
  ];

  async function eqPvp(corps, api){
    S.api = api;
    css();
    corps.innerHTML = '<div class="ct-vide">Chargement…</div>';
    let e;
    try{ e = await api.appel('pvp_equipe_lire'); }catch(err){ corps.innerHTML = `<div class="ct-panneau ct-vide">${api.esc(err.message)}</div>`; return; }
    const re = () => eqPvp(corps, api);
    corps.innerHTML = `
      <div class="pv-fiche-eq">
        <section class="ct-panneau"><div class="ct-entete-panneau"><div><h3>Réglages de l'Arène classée</h3><p class="sous">Tickets, calcul des points et retour à la saison suivante. Le changement s'applique tout de suite.</p></div></div>
          <div class="pv-champs">${LIB_REGLAGES.map(([k, nom, aide]) => `<label>${nom}<input class="cb-champ-eq" type="number" min="0" data-reg="${k}" value="${e.reglages[k]}"><small>${aide}</small></label>`).join('')}</div>
          <div class="ct-actions" style="margin-top:14px"><button type="button" class="ct-btn principal" data-sauver-reg>Enregistrer les réglages</button></div></section>

        <section class="ct-panneau"><div class="ct-entete-panneau"><div><h3>Rangs et récompenses du dimanche</h3><p class="sous">Seuils de points (strictement croissants, le premier à 0) et récompense hebdomadaire de chaque rang.</p></div></div>
          <div style="overflow-x:auto"><table class="pv-table"><thead><tr><th>Rang</th><th>Nom</th><th>Points dès</th><th>Vinyles</th><th>Wave Coins</th></tr></thead><tbody>
            ${e.rangs.map((r) => `<tr data-rang="${esc(r.id)}"><td style="color:${hex(r.couleur)}; font-weight:800">${r.ordre}</td>
              <td><input class="cb-champ-eq" data-k="nom" value="${esc(r.nom)}" maxlength="20"></td>
              <td><input class="cb-champ-eq" type="number" min="0" data-k="minimum" value="${r.minimum}"></td>
              <td><input class="cb-champ-eq" type="number" min="0" max="100" data-k="vinyles" value="${r.vinyles}"></td>
              <td><input class="cb-champ-eq" type="number" min="0" max="10000" data-k="wc" value="${r.wc}"></td></tr>`).join('')}</tbody></table></div>
          <div class="ct-actions" style="margin-top:14px"><button type="button" class="ct-btn principal" data-sauver-rangs>Enregistrer les rangs</button></div></section>

        <section class="ct-panneau"><div class="ct-entete-panneau"><div><h3>Saisons</h3><p class="sous">Une saison est créée automatiquement chaque mois. Tu peux régler ses dates et ses récompenses par tranche, en créer une, ou la terminer maintenant (les récompenses sont alors versées tout de suite). Aujourd'hui : ${esc(fmtDate(e.aujourdhui, { day: 'numeric', month: 'long', year: 'numeric' }))}.</p></div>
          <button type="button" class="ct-btn petit" data-nouvelle>Nouvelle saison</button></div>
          <div class="cb-liste">${e.saisons.map((s, i) => `<div class="cb-ligne"><span class="cb-n">${A().ico('trophee', 18)}</span>
            <div><h4>${esc(s.nom)} ${s.courante ? '<span class="cb-puce ok">En cours</span>' : s.clos ? '<span class="cb-puce">Terminée</span>' : '<span class="cb-puce or">À venir</span>'}</h4>
              <p>Du ${esc(fmtDate(s.debut, { day: 'numeric', month: 'short', year: 'numeric' }))} au ${esc(fmtDate(s.fin, { day: 'numeric', month: 'short', year: 'numeric' }))} · ${s.participants} participant${s.participants > 1 ? 's' : ''} · ${s.recompenses.length} tranche${s.recompenses.length > 1 ? 's' : ''}</p></div>
            <div style="display:flex; gap:6px; flex-wrap:wrap; justify-content:flex-end">${s.clos ? '' : `<button type="button" class="ct-btn petit" data-edit="${i}">Régler</button><button type="button" class="ct-btn petit" data-fin="${i}">Terminer</button>`}</div></div>`).join('')}</div></section>
      </div>`;

    const lire = (zone) => { const o = {}; zone.forEach((i) => { o[i.dataset.reg] = Number(i.value); }); return o; };
    corps.querySelector('[data-sauver-reg]').addEventListener('click', async () => {
      try{ await api.appel('pvp_equipe_regler', { p: { reglages: lire(corps.querySelectorAll('[data-reg]')) } }); api.toast('Réglages enregistrés.'); re(); }catch(err){ api.toast(err.message, 'err'); }
    });
    corps.querySelector('[data-sauver-rangs]').addEventListener('click', async () => {
      const rangs = Array.from(corps.querySelectorAll('[data-rang]')).map((tr) => {
        const g = (k) => tr.querySelector(`[data-k="${k}"]`).value;
        return { id: tr.dataset.rang, nom: g('nom'), minimum: Number(g('minimum')), vinyles: Number(g('vinyles')), wc: Number(g('wc')) };
      });
      try{ await api.appel('pvp_equipe_regler', { p: { rangs } }); api.toast('Rangs enregistrés.'); re(); }catch(err){ api.toast(err.message, 'err'); }
    });
    corps.querySelector('[data-nouvelle]').addEventListener('click', () => {
      const j = new Date(e.aujourdhui + 'T12:00:00');
      const fin = new Date(j.getFullYear(), j.getMonth() + 2, 0, 12);
      const iso = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
      const debut = new Date(j.getFullYear(), j.getMonth() + 1, 1, 12);
      formSaison(api, { nom: '', debut: iso(debut), fin: iso(fin), recompenses: [{ nom: 'Top 10 %', top_pct: 10, vinyles: 4, wc: 400 }, { nom: 'Participation', top_pct: 100, vinyles: 1, wc: 50 }] }, re);
    });
    corps.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => formSaison(api, e.saisons[Number(b.dataset.edit)], re)));
    corps.querySelectorAll('[data-fin]').forEach((b) => b.addEventListener('click', () => {
      const s = e.saisons[Number(b.dataset.fin)];
      const f = api.fenetre(`<h2>Terminer « ${api.esc(s.nom)} » maintenant ?</h2>
        <p class="sous">La saison s'arrête hier soir : les ${s.participants} participant${s.participants > 1 ? 's' : ''} reçoivent immédiatement leur récompense de tranche, puis une nouvelle saison démarre. Impossible à annuler.</p>
        <div class="ct-actions" style="justify-content:flex-end; margin-top:18px"><button type="button" class="ct-btn" data-non>Annuler</button><button type="button" class="ct-btn principal" data-oui>Terminer la saison</button></div>`);
      f.corps.querySelector('[data-non]').addEventListener('click', f.fermer);
      f.corps.querySelector('[data-oui]').addEventListener('click', async (ev) => {
        ev.currentTarget.disabled = true;
        try{ await api.appel('pvp_equipe_saison_cloturer', { p_id: s.id }); f.fermer(); api.toast('Saison terminée, récompenses versées.'); re(); }catch(err){ api.toast(err.message, 'err'); ev.currentTarget.disabled = false; }
      });
    }));
  }

  function formSaison(api, s, apres){
    const trLigne = (t) => `<div class="pv-tr-ed" data-tr>
        <input class="cb-champ-eq" data-t="nom" placeholder="Nom" value="${api.esc(t.nom)}" maxlength="30" aria-label="Nom de la tranche">
        <input class="cb-champ-eq" type="number" min="1" max="100" data-t="top_pct" value="${t.top_pct}" aria-label="Meilleurs, en %" title="Les meilleurs X %">
        <input class="cb-champ-eq" type="number" min="0" max="100" data-t="vinyles" value="${t.vinyles}" aria-label="Vinyles" title="Vinyles">
        <input class="cb-champ-eq" type="number" min="0" max="10000" data-t="wc" value="${t.wc}" aria-label="Wave Coins" title="Wave Coins">
        <button type="button" class="ct-btn petit" data-retirer aria-label="Retirer la tranche">×</button></div>`;
    const f = api.fenetre(`
      <h2>${s.id ? 'Régler la saison' : 'Nouvelle saison'}</h2>
      <div class="pv-champs" style="margin-top:12px">
        <label style="grid-column:1 / -1">Nom<input class="cb-champ-eq" data-s="nom" value="${api.esc(s.nom)}" maxlength="60"></label>
        <label>Début<input class="cb-champ-eq" type="date" data-s="debut" value="${api.esc(s.debut)}"></label>
        <label>Fin (incluse)<input class="cb-champ-eq" type="date" data-s="fin" value="${api.esc(s.fin)}"></label></div>
      <h3 style="margin:18px 0 6px; font-size:14px">Récompenses par tranche</h3>
      <p class="sous" style="font-size:12.5px; margin:0 0 8px">Nom · meilleurs X % · vinyles · Wave Coins. Chaque joueur reçoit la meilleure tranche à laquelle il appartient ; 100 % = tous les participants.</p>
      <div data-trs>${(s.recompenses || []).map(trLigne).join('')}</div>
      <button type="button" class="ct-btn petit" data-ajout style="margin-top:4px">Ajouter une tranche</button>
      <div class="ct-actions" style="justify-content:flex-end; margin-top:18px"><button type="button" class="ct-btn" data-non>Annuler</button><button type="button" class="ct-btn principal" data-ok>Enregistrer</button></div>`, true);
    const zone = f.corps.querySelector('[data-trs]');
    const brancher = () => zone.querySelectorAll('[data-retirer]').forEach((b) => { b.onclick = () => { b.closest('[data-tr]').remove(); }; });
    brancher();
    f.corps.querySelector('[data-ajout]').addEventListener('click', () => {
      zone.insertAdjacentHTML('beforeend', trLigne({ nom: '', top_pct: 100, vinyles: 0, wc: 0 }));
      brancher();
    });
    f.corps.querySelector('[data-non]').addEventListener('click', f.fermer);
    f.corps.querySelector('[data-ok]').addEventListener('click', async (ev) => {
      const g = (k) => f.corps.querySelector(`[data-s="${k}"]`).value;
      const recompenses = Array.from(zone.querySelectorAll('[data-tr]')).map((tr) => {
        const v = (k) => tr.querySelector(`[data-t="${k}"]`).value;
        return { nom: v('nom'), top_pct: Number(v('top_pct')), vinyles: Number(v('vinyles')), wc: Number(v('wc')) };
      });
      ev.currentTarget.disabled = true;
      try{
        await api.appel('pvp_equipe_saison_sauver', { p: { id: s.id || null, nom: g('nom'), debut: g('debut'), fin: g('fin'), recompenses } });
        f.fermer();
        api.toast('Saison enregistrée.');
        apres();
      }catch(err){ api.toast(err.message, 'err'); ev.currentTarget.disabled = false; }
    });
  }

  // ---------------------------------------------------------------------
  // Branchements : le hub, la console de l'équipe, les classements de l'Accueil
  // ---------------------------------------------------------------------

  function brancher(){
    const C = window.WaveCombat;
    if(!C) throw new Error('combat.js doit être chargé avant combat-pvp.js.');
    C.modes.enregistrer({ id: 'arene_classee', titre: 'Arène classée', groupe: 'dresseurs', icone: 'trophee',
      resume: async () => {
        const d = await A().appel('pvp_accueil');
        return `${d.moi.rang.nom} · ${nf(d.moi.points)} pts · ${d.moi.tickets}/${d.moi.tickets_max} ticket${d.moi.tickets > 1 ? 's' : ''}`;
      },
      ouvrir });
    if(C.equipeVues) C.equipeVues.enregistrer({ id: 'arene-classee', nom: 'Arène classée', ouvrir: eqPvp });

    // Les classements de l'Accueil (accueil.js les lit à l'affichage ; format décrit en tête de ce fichier).
    const liste = (window.WaveClassements = window.WaveClassements || []);
    [['arene-classee', 'Arène classée', 'points', 'points'], ['arene-saison', 'Saison de l\'Arène', 'points de saison', 'saison']].forEach(([id, libelle, unite, type]) => {
      if(liste.some((x) => x && x.id === id)) return;
      liste.push({ id, libelle, unite, charger: async (api) => api.appel('pvp_classement', { p_type: type }) });
    });
  }

  brancher();

  window.WaveCombatPvp = { ouvrir, equipe: eqPvp };

})();
