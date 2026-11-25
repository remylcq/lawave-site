/* =====================================================================
   La Wave — sécurité : anti-robot à la connexion, double authentification, onglet « Sécurité » de l'équipe

   Chargé à la demande par index.html (chargerSecurite) :
     · jetonCaptcha()  : le jeton Turnstile (Cloudflare) joint à une inscription ou une connexion, si une clé de site est
                         renseignée dans index.html (TURNSTILE_SITE_KEY) ; sinon rien n'est demandé ;
     · demanderCode()  : la fenêtre « code de vérification » quand le compte a la double authentification (TOTP) ;
     · rendre(zone)    : l'onglet « Sécurité » de l'espace équipe : double authentification, alertes, journal d'audit.

   Voir sql/durcissement.sql.
   ===================================================================== */

window.Securite = (function(){

  'use strict';

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const quand = (iso) => {
    const d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  };

  // ------------------------------------------------------------------
  // Anti-robot (Cloudflare Turnstile)
  // ------------------------------------------------------------------

  let promesseTurnstile = null;

  function chargerTurnstile(){

    if(window.turnstile) return Promise.resolve();
    if(promesseTurnstile) return promesseTurnstile;

    promesseTurnstile = new Promise((ok, ko) => {
      const s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      s.async = true;
      s.onload = () => ok();
      s.onerror = () => { promesseTurnstile = null; ko(new Error("La vérification anti-robot ne se charge pas : vérifie ta connexion, puis réessaie.")); };
      document.head.appendChild(s);
    });

    return promesseTurnstile;
  }

  // Un jeton neuf à chaque inscription ou connexion (il ne sert qu'une fois). Le défi n'apparaît que si Cloudflare
  // doute : dans le cas courant, la personne ne voit rien.
  async function jetonCaptcha(){

    const cle = typeof TURNSTILE_SITE_KEY === 'string' ? TURNSTILE_SITE_KEY : '';
    if(!cle) return undefined;

    await chargerTurnstile();

    return new Promise((ok, ko) => {

      const boite = document.createElement('div');
      boite.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:100000;';
      document.body.appendChild(boite);

      let id = null;
      let minuteur = null;
      let fini = false;

      const fin = (suite, valeur) => {
        if(fini) return;
        fini = true;
        clearTimeout(minuteur);
        try{ if(id !== null) window.turnstile.remove(id); }catch(e){}
        boite.remove();
        suite(valeur);
      };

      minuteur = setTimeout(() => fin(ko, new Error('La vérification anti-robot est trop longue : réessaie.')), 45000);

      try{
        id = window.turnstile.render(boite, {
          sitekey: cle,
          appearance: 'interaction-only',
          callback: (jeton) => fin(ok, jeton),
          'error-callback': () => fin(ko, new Error('Vérification anti-robot échouée : recharge la page, puis réessaie.')),
          'timeout-callback': () => fin(ko, new Error('Vérification anti-robot expirée : réessaie.'))
        });
      }catch(e){
        fin(ko, new Error('Vérification anti-robot impossible : recharge la page.'));
      }
    });
  }

  // ------------------------------------------------------------------
  // Styles (injectés une fois)
  // ------------------------------------------------------------------

  function injecterStyle(){

    if(document.getElementById('sec-style')) return;

    const s = document.createElement('style');
    s.id = 'sec-style';
    s.textContent = `
      .sec-voile{position:fixed; inset:0; z-index:100001; display:flex; align-items:center; justify-content:center; padding:16px; background:rgba(0,0,0,0.62); backdrop-filter:blur(4px);}
      .sec-fenetre{width:100%; max-width:380px; padding:24px; border:1px solid var(--line-strong, rgba(255,255,255,0.18)); border-radius:var(--radius, 16px); background:var(--bg-alt, #14171c); color:var(--ink, #fff);}
      .sec-fenetre h3{margin:0 0 6px; font-size:18px;}
      .sec-fenetre p{margin:0 0 16px; font-size:13px; line-height:1.55; color:var(--muted, #9aa3ad);}
      .sec-code{width:100%; height:52px; padding:0 14px; border-radius:var(--radius-sm, 10px); border:1px solid var(--line-strong, rgba(255,255,255,0.18)); background:rgba(0,0,0,0.34); color:#fff; font-size:24px; font-weight:600; letter-spacing:.35em; text-align:center; font-variant-numeric:tabular-nums;}
      .sec-actions{display:flex; gap:10px; justify-content:flex-end; margin-top:16px;}
      .sec-boite{padding:20px; border:1px solid var(--line, rgba(255,255,255,0.1)); border-radius:14px; background:var(--bg-alt, #14171c); margin-top:16px;}
      .sec-boite h4{margin:0 0 6px; font-size:15px; font-weight:600; color:var(--ink, #fff);}
      .sec-boite > p{margin:0 0 14px; font-size:13px; line-height:1.55; color:var(--muted, #9aa3ad);}
      .sec-ligne{display:flex; gap:10px; align-items:center; flex-wrap:wrap;}
      .sec-puce{display:inline-block; padding:2px 9px; border-radius:99px; font-size:11px; font-weight:600; letter-spacing:.03em;}
      .sec-puce.on{color:#8fe3ab; background:rgba(46,160,90,0.14); border:1px solid rgba(46,160,90,0.35);}
      .sec-puce.off{color:var(--danger, #e5695c); background:rgba(229,105,92,0.12); border:1px solid rgba(229,105,92,0.35);}
      .sec-puce.neutre{color:var(--muted, #9aa3ad); background:rgba(255,255,255,0.06); border:1px solid var(--line, rgba(255,255,255,0.1));}
      .sec-qr{display:block; width:190px; height:190px; margin:12px 0; padding:8px; border-radius:12px; background:#fff;}
      .sec-secret{display:block; margin:6px 0 14px; font-family:ui-monospace, monospace; font-size:13px; word-break:break-all; color:var(--ink-soft, #cfd6dd);}
      .sec-equipe{list-style:none; margin:0 0 14px; padding:0; display:grid; gap:6px;}
      .sec-equipe li{display:flex; justify-content:space-between; gap:10px; padding:8px 12px; border-radius:10px; background:rgba(255,255,255,0.04); font-size:13px;}
      .sec-liste{list-style:none; margin:0; padding:0; display:grid; gap:8px;}
      .sec-liste li{display:grid; grid-template-columns:auto 1fr; gap:4px 12px; padding:10px 12px; border-radius:10px; background:rgba(255,255,255,0.04); font-size:13px; line-height:1.5;}
      .sec-liste time{font-size:12px; color:var(--muted, #9aa3ad); white-space:nowrap;}
      .sec-liste li.non-lue{border-left:3px solid #e5a25c;}
      .sec-liste li.critique{border-left-color:var(--danger, #e5695c);}
      .sec-journal li{grid-template-columns:auto 1fr auto;}
      .sec-journal .qui{color:var(--muted, #9aa3ad);}
      .sec-saisie{height:46px; width:150px; padding:0 12px; border-radius:var(--radius-sm, 10px); border:1px solid var(--line-strong, rgba(255,255,255,0.18)); background:rgba(0,0,0,0.34); color:#fff; font-size:18px; letter-spacing:.25em; text-align:center; font-variant-numeric:tabular-nums;}
    `;
    document.head.appendChild(s);
  }

  // ------------------------------------------------------------------
  // Double authentification : la fenêtre de saisie du code (connexion)
  // ------------------------------------------------------------------

  function messageCode(erreur){
    const m = String((erreur && erreur.message) || '').toLowerCase();
    if(m.includes('invalid') || m.includes('incorrect')) return 'Code incorrect, réessaie avec le code actuel de ton application.';
    if(m.includes('rate') || m.includes('too many')) return 'Trop d\'essais : attends une minute.';
    return 'Vérification impossible : ' + ((erreur && erreur.message) || 'erreur inconnue') + '.';
  }

  async function facteurVerifie(){
    const { data } = await supabaseClient.auth.mfa.listFactors();
    return (data && data.totp && data.totp[0]) || null;
  }

  // Résout true quand le code est bon, false si la personne renonce.
  function demanderCode(){

    injecterStyle();

    return new Promise(resolve => {

      const voile = document.createElement('div');
      voile.className = 'sec-voile';
      voile.innerHTML = `
        <div class="sec-fenetre" role="dialog" aria-modal="true" aria-labelledby="secTitre">
          <h3 id="secTitre">Code de vérification</h3>
          <p>Ouvre ton application d'authentification (Google Authenticator, Authy, 1Password…) et saisis le code à 6 chiffres de La Wave.</p>
          <input class="sec-code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]*" aria-label="Code à 6 chiffres">
          <div class="form-msg" role="alert"></div>
          <div class="sec-actions">
            <button type="button" class="btn btn-ghost" data-act="annuler">Annuler</button>
            <button type="button" class="btn" data-act="valider">Valider</button>
          </div>
        </div>`;

      document.body.appendChild(voile);

      const champ = voile.querySelector('.sec-code');
      const msg = voile.querySelector('.form-msg');
      const valider = voile.querySelector('[data-act="valider"]');
      let occupe = false;

      const fermer = (valeur) => { voile.remove(); resolve(valeur); };

      const envoyer = async () => {

        if(occupe) return;

        const code = champ.value.replace(/\D/g, '');
        if(code.length !== 6){ msg.textContent = 'Saisis les 6 chiffres.'; msg.className = 'form-msg err'; return; }

        occupe = true;
        valider.disabled = true;

        try{
          const f = await facteurVerifie();
          if(!f) throw new Error('Aucune double authentification trouvée sur ce compte.');
          const { error } = await supabaseClient.auth.mfa.challengeAndVerify({ factorId: f.id, code });
          if(error) throw error;
          fermer(true);
        }catch(e){
          msg.textContent = messageCode(e);
          msg.className = 'form-msg err';
          champ.select();
          occupe = false;
          valider.disabled = false;
        }
      };

      valider.addEventListener('click', envoyer);
      voile.querySelector('[data-act="annuler"]').addEventListener('click', () => fermer(false));
      champ.addEventListener('keydown', e => { if(e.key === 'Enter') envoyer(); if(e.key === 'Escape') fermer(false); });
      champ.addEventListener('input', () => { if(champ.value.replace(/\D/g, '').length === 6) envoyer(); });
      champ.focus();
    });
  }

  // ------------------------------------------------------------------
  // L'onglet « Sécurité » de l'espace équipe
  // ------------------------------------------------------------------

  let zoneCourante = null;
  let inscription = null;   // la double authentification en cours d'activation (facteur non confirmé)

  async function lireMfa(){

    const [aal, liste] = await Promise.all([
      supabaseClient.auth.mfa.getAuthenticatorAssuranceLevel(),
      supabaseClient.auth.mfa.listFactors()
    ]);

    const a = aal.data || {};
    const l = liste.data || {};

    return {
      facteur: (l.totp && l.totp[0]) || null,
      nonConfirmes: ((l.all || []).filter(f => f.status === 'unverified')),
      session: a.currentLevel || 'aal1'
    };
  }

  async function lireEtat(){
    const { data, error } = await supabaseClient.rpc('securite_etat');
    return { etat: data || null, erreur: error || null };
  }

  function htmlMfa(mfa){

    if(inscription){
      return `
        <div class="sec-boite" id="secMfa">
          <h4>Activer la double authentification</h4>
          <p>1. Scanne ce code avec ton application d'authentification (ou saisis la clé à la main).<br>2. Saisis le code à 6 chiffres qu'elle affiche.</p>
          <img class="sec-qr" alt="Code à scanner" src="${esc(inscription.qr)}">
          <span class="sec-secret">${esc(inscription.secret)}</span>
          <div class="sec-ligne">
            <input class="sec-saisie" id="secCodeActiver" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" aria-label="Code à 6 chiffres">
            <button type="button" class="btn" data-act="mfa-confirmer">Confirmer</button>
            <button type="button" class="btn btn-ghost" data-act="mfa-annuler">Annuler</button>
          </div>
          <div class="form-msg" id="secMfaMsg" role="alert"></div>
        </div>`;
    }

    if(!mfa.facteur){
      return `
        <div class="sec-boite" id="secMfa">
          <h4>Double authentification <span class="sec-puce off">Pas activée</span></h4>
          <p>Un mot de passe volé ne suffit alors plus à entrer dans l'espace équipe : il faut aussi le code de ton téléphone. Compte une minute.</p>
          <button type="button" class="btn" data-act="mfa-activer">Activer sur mon compte</button>
          <div class="form-msg" id="secMfaMsg" role="alert"></div>
        </div>`;
    }

    if(mfa.session !== 'aal2'){
      return `
        <div class="sec-boite" id="secMfa">
          <h4>Double authentification <span class="sec-puce on">Activée</span> <span class="sec-puce neutre">Session à valider</span></h4>
          <p>Tu t'es connecté sans le code. Saisis-le pour valider cette session (obligatoire dès que l'équipe est protégée).</p>
          <div class="sec-ligne">
            <input class="sec-saisie" id="secCodeSession" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" aria-label="Code à 6 chiffres">
            <button type="button" class="btn" data-act="mfa-valider">Valider la session</button>
          </div>
          <div class="form-msg" id="secMfaMsg" role="alert"></div>
        </div>`;
    }

    return `
      <div class="sec-boite" id="secMfa">
        <h4>Double authentification <span class="sec-puce on">Activée</span> <span class="sec-puce on">Session validée</span></h4>
        <p>Ton compte demande le code de ton application à chaque connexion.</p>
        <button type="button" class="btn btn-ghost" data-act="mfa-retirer">Désactiver</button>
        <div class="form-msg" id="secMfaMsg" role="alert"></div>
      </div>`;
  }

  function htmlReglages(etat){

    const r = etat.reglages || {};
    const proprio = !!etat.proprietaire;
    const exigee = r.mfa_equipe_exigee === true;
    const debit = r.debit_actif !== false;

    const equipe = (etat.equipe || []).map(m =>
      `<li><span>${esc(m.pseudo || 'Sans pseudo')}</span><span class="sec-puce ${m.mfa ? 'on' : 'off'}">${m.mfa ? '2FA activée' : 'pas de 2FA'}</span></li>`
    ).join('');

    return `
      <div class="sec-boite">
        <h4>Protéger toute l'équipe <span class="sec-puce ${exigee ? 'on' : 'neutre'}">${exigee ? 'Exigée' : 'Pas exigée'}</span></h4>
        <p>Quand c'est exigé, un compte de l'équipe qui n'a pas validé son code perd l'accès à l'espace équipe. Active-le seulement quand tous les comptes ci-dessous ont leur 2FA.</p>
        <ul class="sec-equipe">${equipe || '<li>Aucun compte</li>'}</ul>
        ${proprio
          ? `<button type="button" class="btn ${exigee ? 'btn-ghost' : ''}" data-act="regler" data-cle="mfa_equipe_exigee" data-valeur="${exigee ? 'false' : 'true'}">${exigee ? 'Ne plus l\'exiger' : 'Exiger pour toute l\'équipe'}</button>`
          : '<p style="margin:0">Seul le propriétaire du site peut changer ce réglage.</p>'}
        <div class="form-msg" id="secReglageMsg" role="alert"></div>
      </div>

      <div class="sec-boite">
        <h4>Limite de débit <span class="sec-puce ${debit ? 'on' : 'off'}">${debit ? 'Active' : 'Coupée'}</span></h4>
        <p>Au-delà d'un nombre très large de requêtes par minute (par compte, ou par adresse IP pour un visiteur), le serveur répond « trop de requêtes ». Elle protège les actions qui écrivent (publier, voter, s'inscrire…). Les attaques massives sont à bloquer chez Cloudflare.</p>
        ${proprio
          ? `<button type="button" class="btn btn-ghost" data-act="regler" data-cle="debit_actif" data-valeur="${debit ? 'false' : 'true'}">${debit ? 'Couper la limite' : 'Réactiver la limite'}</button>`
          : ''}
      </div>`;
  }

  function htmlAlertes(etat){

    const alertes = etat.alertes || [];
    const nonLues = alertes.filter(a => !a.lue_le).length;

    const lignes = alertes.map(a => `
      <li class="${a.lue_le ? '' : 'non-lue'} ${a.niveau === 'critique' ? 'critique' : ''}">
        <time datetime="${esc(a.le)}">${esc(quand(a.le))}</time>
        <span>${esc(a.message)}</span>
      </li>`).join('');

    return `
      <div class="sec-boite">
        <h4>Alertes ${nonLues ? `<span class="sec-puce off">${nonLues} non lue${nonLues > 1 ? 's' : ''}</span>` : ''}</h4>
        <p>Nouvel accès équipe, pic d'inscriptions, trafic bloqué, rafale d'actions. Une notification arrive aussi sur les appareils où tu as activé les alertes.</p>
        ${lignes ? `<ul class="sec-liste">${lignes}</ul>` : '<div class="empty-state">Aucune alerte. Tout est calme.</div>'}
        ${nonLues ? '<div class="sec-ligne" style="margin-top:12px"><button type="button" class="btn btn-ghost" data-act="alertes-lues">Tout marquer comme lu</button></div>' : ''}
      </div>`;
  }

  function htmlJournal(etat){

    const journal = etat.journal || [];

    const lignes = journal.map(j => `
      <li>
        <time datetime="${esc(j.le)}">${esc(quand(j.le))}</time>
        <span>${esc(j.action)}${j.cible ? ' — ' + esc(j.cible) : ''}</span>
        <span class="qui">${esc(j.acteur_pseudo || 'système')}</span>
      </li>`).join('');

    return `
      <div class="sec-boite">
        <h4>Journal d'audit</h4>
        <p>Les 100 dernières actions sensibles : accès équipe donnés ou retirés, comptes supprimés, profils vérifiés, artistes bannis ou supprimés, accès testeurs.</p>
        ${lignes ? `<ul class="sec-liste sec-journal">${lignes}</ul>` : '<div class="empty-state">Rien d\'enregistré pour l\'instant.</div>'}
      </div>`;
  }

  async function rendre(zone){

    injecterStyle();
    zoneCourante = zone || zoneCourante;
    if(!zoneCourante) return;

    zoneCourante.innerHTML = '<div class="empty-state chargement">Chargement…</div>';

    let mfa;
    try{ mfa = await lireMfa(); }catch(e){ mfa = { facteur: null, nonConfirmes: [], session: 'aal1' }; }

    const { etat, erreur } = await lireEtat();

    let reste = '';

    if(erreur){
      reste = /Could not find the function|schema cache/i.test(erreur.message)
        ? '<div class="empty-state">L\'onglet n\'est pas encore activé : le fichier durcissement.sql n\'a pas été passé dans Supabase.</div>'
        : `<div class="sec-boite"><div class="form-msg err">${esc(erreur.message)}</div>${
            mfa.facteur && mfa.session !== 'aal2' ? '<p style="margin-top:10px">Valide d\'abord ta double authentification ci-dessus.</p>' : ''}</div>`;
    }else{
      reste = htmlReglages(etat) + htmlAlertes(etat) + htmlJournal(etat);
      if(typeof setAdminTabCount === 'function') setAdminTabCount('securite', (etat.alertes || []).filter(a => !a.lue_le).length);
    }

    zoneCourante.innerHTML = htmlMfa(mfa) + reste;
  }

  // Le nombre d'alertes non lues, pour la pastille de l'onglet (à l'ouverture de l'espace équipe).
  async function compter(){
    try{
      const { etat } = await lireEtat();
      if(etat && typeof setAdminTabCount === 'function') setAdminTabCount('securite', (etat.alertes || []).filter(a => !a.lue_le).length);
    }catch(e){}
  }

  function message(texte, type){
    const m = document.getElementById('secMfaMsg') || document.getElementById('secReglageMsg');
    if(m){ m.textContent = texte; m.className = 'form-msg ' + (type || 'err'); }
  }

  async function agir(bouton){

    const act = bouton.dataset.act;
    bouton.disabled = true;

    try{

      if(act === 'mfa-activer'){

        // Un essai abandonné laisse un facteur non confirmé : on le retire avant d'en créer un nouveau.
        const mfa = await lireMfa();
        for(const f of mfa.nonConfirmes) await supabaseClient.auth.mfa.unenroll({ factorId: f.id });

        const { data, error } = await supabaseClient.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'La Wave ' + Date.now() });
        if(error) throw error;

        inscription = { id: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
        await rendre();
        const champ = document.getElementById('secCodeActiver');
        if(champ) champ.focus();
        return;
      }

      if(act === 'mfa-annuler'){
        if(inscription) await supabaseClient.auth.mfa.unenroll({ factorId: inscription.id });
        inscription = null;
        await rendre();
        return;
      }

      if(act === 'mfa-confirmer'){

        const code = (document.getElementById('secCodeActiver').value || '').replace(/\D/g, '');
        if(code.length !== 6){ message('Saisis les 6 chiffres.'); return; }

        const { error } = await supabaseClient.auth.mfa.challengeAndVerify({ factorId: inscription.id, code });
        if(error) throw error;

        inscription = null;
        await rendre();
        message('Double authentification activée. Garde ton application : il faudra le code à chaque connexion.', 'ok');
        return;
      }

      if(act === 'mfa-valider'){

        const code = (document.getElementById('secCodeSession').value || '').replace(/\D/g, '');
        if(code.length !== 6){ message('Saisis les 6 chiffres.'); return; }

        const f = await facteurVerifie();
        const { error } = await supabaseClient.auth.mfa.challengeAndVerify({ factorId: f.id, code });
        if(error) throw error;

        await rendre();
        message('Session validée.', 'ok');
        return;
      }

      if(act === 'mfa-retirer'){

        if(bouton.dataset.confirme !== '1'){
          bouton.dataset.confirme = '1';
          bouton.textContent = 'Confirmer la désactivation';
          bouton.disabled = false;
          return;
        }

        const f = await facteurVerifie();
        const { error } = await supabaseClient.auth.mfa.unenroll({ factorId: f.id });
        if(error) throw error;

        await rendre();
        message('Double authentification désactivée.', 'ok');
        return;
      }

      if(act === 'regler'){

        const { error } = await supabaseClient.rpc('securite_regler', {
          p_cle: bouton.dataset.cle,
          p_actif: bouton.dataset.valeur === 'true'
        });
        if(error) throw error;

        await rendre();
        return;
      }

      if(act === 'alertes-lues'){

        const { error } = await supabaseClient.rpc('securite_alertes_lues');
        if(error) throw error;

        await rendre();
        return;
      }

    }catch(e){
      message(act.startsWith('mfa') ? messageCode(e) : ((e && e.message) || 'Action impossible.'));
      bouton.disabled = false;
    }
  }

  document.addEventListener('click', e => {
    const bouton = e.target.closest && e.target.closest('#securiteZone [data-act]');
    if(bouton) agir(bouton);
  });

  return { jetonCaptcha, demanderCode, rendre, compter };

})();
