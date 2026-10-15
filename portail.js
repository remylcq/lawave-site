/* =====================================================================
 * ACCÈS TESTEURS (TEMPORAIRE) — portail d'entrée du site
 *
 * Pendant la phase de test privée, le site reste caché derrière cet
 * écran tant que le visiteur n'a pas saisi l'adresse e-mail et le mot de
 * passe que l'équipe lui a envoyés (créés dans l'espace équipe, onglet
 * « Accès »).
 *
 * Fonctionnement : le jeton reçu à la connexion est gardé dans le
 * navigateur (localStorage) et revérifié auprès de Supabase à chaque
 * chargement, puis toutes les quelques minutes. Si l'accès est révoqué
 * ou expire, l'écran revient.
 *
 * LIMITE À CONNAÎTRE : c'est une barrière côté navigateur. Elle écarte le
 * grand public, pas une personne qui sait lire le code de la page. Pour
 * une vraie protection, ajouter un mot de passe au niveau du serveur
 * (.htaccess chez OVH).
 *
 * RETRAIT : supprimer ce fichier (FTP), le bloc « ACCÈS TESTEURS » du
 * <head> d'index.html, l'onglet « Accès » de l'espace équipe, puis passer
 * sql/acces-testeurs-retrait.sql dans Supabase.
 * ===================================================================== */
(function(){
  'use strict';

  const SUPABASE_URL = 'https://bqataeghgjyiqrnnesqq.supabase.co';
  const CLE_PUBLIQUE = 'sb_publishable_yPAFW5xjK6gEgLZqQYyojA_D00vMayy';
  const STOCKAGE = 'lw-portail-jeton';
  const CLASSE = 'portail-actif';
  const CONTROLE_MS = 5 * 60 * 1000;

  let jeton = '';
  let racine = null;
  let inertes = [];
  let dernierControle = 0;
  let minuteur = null;

  // Un fond uni, une colonne étroite, des champs à plat : rien qui brille, rien qui flotte.
  const FEUILLE = `
#portail{
  --p-bg:#0a0c10; --p-ink:#F4F5F6; --p-soft:#B4BAC2; --p-muted:#7B828B; --p-line:#272c34;
  --p-blue:#4FB4FF; --p-danger:#E5695C;
  position:fixed; inset:0; z-index:2147483000; overflow:auto; display:flex;
  padding:24px 20px; background:var(--p-bg); color:var(--p-ink);
  font-family:'Public Sans', system-ui, sans-serif; font-weight:400; line-height:1.5;
  -webkit-font-smoothing:antialiased;
  transition:opacity .4s ease;
}
#portail, #portail *{box-sizing:border-box;}
#portail.p-sortie{opacity:0; pointer-events:none;}
#portail [hidden]{display:none !important;}

#portail .p-carte{
  width:100%; max-width:320px; margin:auto; text-align:center;
  animation:p-entree .5s ease both;
}
@keyframes p-entree{from{opacity:0; transform:translateY(8px);} to{opacity:1; transform:none;}}

#portail .p-logo{display:flex; justify-content:center; align-items:center; height:56px; margin:0 0 36px;}
#portail .p-logo img{display:block; height:56px; width:56px; object-fit:contain;}
#portail .p-logo b{font-size:20px; font-weight:700;}
#portail .p-titre{margin:0 0 6px; font-size:20px; font-weight:600; line-height:1.2; color:var(--p-ink);}
#portail .p-intro{margin:0 0 32px; font-size:14px; color:var(--p-muted);}

#portail .p-champ{display:block; margin:0 0 16px; text-align:left;}
#portail .p-champ > span{display:block; margin:0 0 6px; font-size:13px; color:var(--p-soft);}
#portail .p-saisie{position:relative;}
#portail .p-saisie input{
  display:block; width:100%; height:48px; padding:0 14px; margin:0;
  border-radius:10px; border:1px solid var(--p-line); background:transparent;
  color:var(--p-ink); font:inherit; font-size:16px; outline:none;
  transition:border-color .2s ease;
}
#portail .p-saisie input::placeholder{color:#4b525b;}
#portail .p-saisie input:hover{border-color:#3a414b;}
#portail .p-saisie input:focus{border-color:var(--p-blue);}
#portail .p-saisie input:-webkit-autofill{-webkit-text-fill-color:var(--p-ink); -webkit-box-shadow:0 0 0 100px #0a0c10 inset; caret-color:var(--p-ink);}
#portail .p-mdp input{padding-right:48px;}
#portail .p-oeil{
  position:absolute; right:4px; top:4px; width:40px; height:40px; padding:0; border:0; border-radius:8px;
  display:flex; align-items:center; justify-content:center; background:none; color:var(--p-muted); cursor:pointer;
  transition:color .2s ease;
}
#portail .p-oeil:hover{color:var(--p-ink);}
#portail .p-oeil svg{width:20px; height:20px; display:block;}
#portail .p-oeil .p-barre{opacity:0;}
#portail .p-oeil[aria-pressed="true"] .p-barre{opacity:1;}

#portail .p-erreur{min-height:22px; margin:0 0 12px; font-size:14px; text-align:left; color:var(--p-danger);}
#portail .p-secoue{animation:p-secoue .4s ease both;}
@keyframes p-secoue{20%,60%{transform:translateX(-5px);} 40%,80%{transform:translateX(5px);}}

#portail .p-entrer{
  display:flex; align-items:center; justify-content:center; gap:10px;
  width:100%; height:48px; padding:0 18px; margin:0; border:0; border-radius:10px;
  font:inherit; font-size:15px; font-weight:600; color:var(--p-bg); cursor:pointer;
  background:var(--p-ink);
  transition:background .2s ease;
}
#portail .p-entrer:hover{background:#fff;}
#portail .p-entrer:focus-visible{outline:2px solid var(--p-blue); outline-offset:3px;}
#portail .p-entrer:disabled{cursor:default; background:#9aa0a8;}
#portail .p-entrer.p-reussi{background:#3ec28a; color:#06150e;}
#portail .p-rond{width:18px; height:18px; border-radius:50%; border:2px solid rgba(10,12,16,.25); border-top-color:var(--p-bg); animation:p-tour .7s linear infinite;}
@keyframes p-tour{to{transform:rotate(360deg);}}
#portail .p-coche{width:20px; height:20px;}

#portail .p-pied{margin:24px 0 0; font-size:12px; color:var(--p-muted);}
#portail .p-attente{display:flex; flex-direction:column; align-items:center; gap:14px; padding:8px 0;}
#portail .p-attente .p-rond{width:24px; height:24px; border-color:rgba(255,255,255,.2); border-top-color:var(--p-ink);}
#portail .p-attente p{margin:0; font-size:14px; color:var(--p-soft);}
#portail .p-reseau-msg{margin:0 0 20px; font-size:14px; color:var(--p-soft);}
#portail .p-reessayer{
  width:100%; height:48px; border-radius:10px; border:1px solid var(--p-line); background:transparent;
  color:var(--p-ink); font:inherit; font-size:15px; font-weight:500; cursor:pointer;
  transition:border-color .2s ease;
}
#portail .p-reessayer:hover{border-color:#3a414b;}

@media (prefers-reduced-motion:reduce){
  #portail, #portail *{animation-duration:.01ms !important; animation-delay:0s !important; animation-iteration-count:1 !important; transition-duration:.01ms !important;}
}
`;

  const GABARIT = `
<div class="p-carte">
  <div class="p-logo"></div>
  <h1 class="p-titre" id="portail-titre">Accès sur invitation</h1>
  <p class="p-intro">Le site est en phase de test.</p>

  <div class="p-vue" data-v="verif" hidden>
    <div class="p-attente"><div class="p-rond"></div><p>Vérification de ton accès…</p></div>
  </div>

  <div class="p-vue" data-v="reseau" hidden>
    <p class="p-reseau-msg" role="alert"></p>
    <button type="button" class="p-reessayer">Réessayer</button>
  </div>

  <form class="p-vue" data-v="form" novalidate>
    <label class="p-champ"><span>E-mail</span>
      <div class="p-saisie"><input type="email" name="email" autocomplete="username" inputmode="email" autocapitalize="none" autocorrect="off" spellcheck="false" required></div>
    </label>
    <label class="p-champ"><span>Mot de passe</span>
      <div class="p-saisie p-mdp"><input type="password" name="mot-de-passe" autocomplete="current-password" autocapitalize="none" autocorrect="off" spellcheck="false" required>
        <button type="button" class="p-oeil" aria-label="Afficher le mot de passe" aria-pressed="false">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/><path class="p-barre" d="M4 4l16 16"/></svg>
        </button>
      </div>
    </label>
    <p class="p-erreur" role="alert" aria-live="polite"></p>
    <button type="submit" class="p-entrer"><span class="p-lib">Entrer</span></button>
  </form>

  <p class="p-pied">Tes identifiants sont personnels.</p>
</div>`;

  // ---------------- Échanges avec Supabase ----------------

  function lireJeton(){
    try{ return localStorage.getItem(STOCKAGE) || ''; }catch(e){ return ''; }
  }

  function garderJeton(valeur){
    jeton = valeur || '';
    try{
      if(jeton) localStorage.setItem(STOCKAGE, jeton);
      else localStorage.removeItem(STOCKAGE);
    }catch(e){}
  }

  function appeler(nom, args){
    return fetch(SUPABASE_URL + '/rest/v1/rpc/' + nom, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': CLE_PUBLIQUE },
      body: JSON.stringify(args)
    }).then(rep => rep.json().catch(() => null).then(corps => {
      if(!rep.ok){
        const e = new Error((corps && corps.message) || ('HTTP ' + rep.status));
        e.code = corps && corps.code;
        e.status = rep.status;
        throw e;
      }
      return corps;
    }));
  }

  function texteErreur(e){
    if(e && (e.code === 'PGRST202' || e.status === 404)){
      return "Le portail d'accès n'est pas encore activé sur le serveur. Préviens l'équipe La Wave.";
    }
    return 'Connexion impossible pour le moment. Vérifie ta connexion, puis réessaie.';
  }

  // ---------------- Écran ----------------

  function verrouiller(oui){
    document.documentElement.classList.toggle(CLASSE, oui);
    if(oui){
      inertes = [];
      Array.prototype.forEach.call(document.body.children, el => {
        if(el !== racine && !el.hasAttribute('inert')){
          el.setAttribute('inert', '');
          inertes.push(el);
        }
      });
    }else{
      inertes.forEach(el => el.removeAttribute('inert'));
      inertes = [];
    }
  }

  function monter(){
    if(racine) return racine;

    if(!document.getElementById('portail-feuille')){
      const st = document.createElement('style');
      st.id = 'portail-feuille';
      st.textContent = FEUILLE;
      document.head.appendChild(st);
    }

    racine = document.createElement('div');
    racine.id = 'portail';
    racine.setAttribute('role', 'dialog');
    racine.setAttribute('aria-modal', 'true');
    racine.setAttribute('aria-labelledby', 'portail-titre');
    racine.innerHTML = GABARIT;

    const logo = racine.querySelector('.p-logo');
    const source = document.querySelector('.nav-logo img');
    if(source && source.src){
      const img = document.createElement('img');
      img.src = source.src;
      img.alt = 'La Wave';
      logo.appendChild(img);
    }else{
      logo.innerHTML = '<b>La Wave</b>';
    }

    document.body.appendChild(racine);
    brancher();
    return racine;
  }

  function voir(vue, message){
    if(!racine) return;
    racine.querySelectorAll('.p-vue').forEach(v => { v.hidden = v.dataset.v !== vue; });

    if(vue === 'form'){
      poserErreur(message || '');
      occuper(false);
      const champ = racine.querySelector('input[name="email"]');
      const mdp = racine.querySelector('input[name="mot-de-passe"]');
      const cible = (champ && !champ.value) ? champ : mdp;
      if(cible) setTimeout(() => { try{ cible.focus({ preventScroll: true }); }catch(e){} }, 80);
    }
    if(vue === 'reseau'){
      racine.querySelector('.p-reseau-msg').textContent = message || '';
    }
  }

  function poserErreur(texte){
    const p = racine && racine.querySelector('.p-erreur');
    if(!p) return;
    p.textContent = texte;
  }

  function secouer(){
    const carte = racine && racine.querySelector('.p-carte');
    if(!carte) return;
    carte.classList.remove('p-secoue');
    void carte.offsetWidth;
    carte.classList.add('p-secoue');
  }

  function occuper(oui){
    if(!racine) return;
    const bouton = racine.querySelector('.p-entrer');
    const lib = bouton.querySelector('.p-lib');
    bouton.disabled = !!oui;
    bouton.classList.remove('p-reussi');
    if(oui){
      lib.textContent = 'Vérification…';
      if(!bouton.querySelector('.p-rond')){
        const r = document.createElement('span');
        r.className = 'p-rond';
        bouton.insertBefore(r, lib);
      }
    }else{
      lib.textContent = 'Entrer';
      const r = bouton.querySelector('.p-rond');
      if(r) r.remove();
      const c = bouton.querySelector('.p-coche');
      if(c) c.remove();
    }
  }

  function reussi(){
    const bouton = racine.querySelector('.p-entrer');
    const r = bouton.querySelector('.p-rond');
    if(r) r.remove();
    bouton.classList.add('p-reussi');
    bouton.querySelector('.p-lib').textContent = 'Bienvenue';
    bouton.insertAdjacentHTML('afterbegin',
      '<svg class="p-coche" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>');
  }

  function brancher(){
    const form = racine.querySelector('form');
    const email = form.querySelector('input[name="email"]');
    const mdp = form.querySelector('input[name="mot-de-passe"]');
    const oeil = form.querySelector('.p-oeil');

    oeil.addEventListener('click', () => {
      const montre = mdp.type === 'password';
      mdp.type = montre ? 'text' : 'password';
      oeil.setAttribute('aria-pressed', montre ? 'true' : 'false');
      oeil.setAttribute('aria-label', montre ? 'Masquer le mot de passe' : 'Afficher le mot de passe');
      mdp.focus();
    });

    form.addEventListener('submit', ev => {
      ev.preventDefault();
      const adresse = email.value.trim();
      const secret = mdp.value.trim();

      if(!adresse || !secret){
        poserErreur("Renseigne ton adresse e-mail et ton mot de passe.");
        secouer();
        (adresse ? mdp : email).focus();
        return;
      }

      poserErreur('');
      occuper(true);

      appeler('acces_connecter', { p_email: adresse, p_mot_de_passe: secret }).then(rep => {
        if(rep && rep.ok && rep.jeton){
          garderJeton(rep.jeton);
          reussi();
          setTimeout(() => lever(), 650);
          return;
        }
        occuper(false);
        poserErreur((rep && rep.erreur) || 'Adresse e-mail ou mot de passe incorrect.');
        secouer();
        mdp.focus();
        mdp.select();
      }).catch(e => {
        occuper(false);
        poserErreur(texteErreur(e));
        secouer();
      });
    });

    racine.querySelector('.p-reessayer').addEventListener('click', () => {
      if(jeton) verifierAuDemarrage();
      else voir('form');
    });
  }

  // ---------------- Cycle de vie ----------------

  function lever(){
    verrouiller(false);
    dernierControle = Date.now();

    const r = racine;
    racine = null;
    if(r){
      r.classList.add('p-sortie');
      setTimeout(() => r.remove(), 500);
    }

    document.dispatchEvent(new CustomEvent('portail:leve'));
    surveiller();
  }

  function reverrouiller(message){
    garderJeton('');
    monter();
    verrouiller(true);
    voir('form', message);
  }

  function verifierAuDemarrage(){
    voir('verif');
    appeler('acces_verifier', { p_jeton: jeton }).then(rep => {
      if(rep && rep.ok){
        lever();
      }else{
        garderJeton('');
        voir('form', 'Ta session a expiré. Connecte-toi de nouveau.');
      }
    }).catch(e => voir('reseau', texteErreur(e)));
  }

  // Une fois le site ouvert, l'accès est revérifié de temps en temps : un
  // accès révoqué ou expiré ramène l'écran sans attendre un rechargement.
  function controler(){
    if(racine || !jeton || document.hidden) return;
    if(Date.now() - dernierControle < 60 * 1000) return;
    dernierControle = Date.now();

    appeler('acces_verifier', { p_jeton: jeton }).then(rep => {
      if(rep && rep.ok === false) reverrouiller("Ton accès n'est plus actif. Connecte-toi de nouveau.");
    }).catch(() => {});
  }

  function surveiller(){
    if(minuteur) return;
    minuteur = setInterval(controler, CONTROLE_MS);
    document.addEventListener('visibilitychange', () => { if(!document.hidden) controler(); });
  }

  function demarrer(){
    try{
      monter();
      verrouiller(true);
      jeton = lireJeton();
      if(jeton) verifierAuDemarrage();
      else voir('form');
    }catch(e){
      // Dans le doute le site reste fermé : mieux vaut un message qu'une porte ouverte.
      console.error('Portail : échec', e);
      if(!document.getElementById('portail')){
        const d = document.createElement('div');
        d.id = 'portail';
        d.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;padding:24px;background:#0a0c10;color:#F4F5F6;font:16px sans-serif;text-align:center';
        d.textContent = 'Accès momentanément indisponible. Recharge la page dans un instant.';
        document.body.appendChild(d);
      }
    }
  }

  if(document.body) demarrer();
  else document.addEventListener('DOMContentLoaded', demarrer);
})();
