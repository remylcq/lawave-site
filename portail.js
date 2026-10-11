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

  const FEUILLE = `
#portail{
  --p-bg:#05070a; --p-ink:#F4F5F6; --p-soft:#C4C9D0; --p-muted:#838A92;
  --p-blue:#1489DE; --p-bright:#4FB4FF; --p-danger:#E5695C;
  --p-ease:cubic-bezier(.16,1,.3,1);
  position:fixed; inset:0; z-index:2147483000; overflow:auto; display:flex;
  padding:24px 16px; background:var(--p-bg); color:var(--p-ink);
  font-family:'Public Sans', system-ui, sans-serif; font-weight:300; line-height:1.5;
  -webkit-font-smoothing:antialiased;
  transition:opacity .6s var(--p-ease), transform .6s var(--p-ease);
}
#portail, #portail *{box-sizing:border-box;}
#portail.p-sortie{opacity:0; pointer-events:none; transform:scale(1.03);}
#portail [hidden]{display:none !important;}

#portail .p-fond{position:fixed; inset:0; overflow:hidden; pointer-events:none;}
#portail .p-halo{position:absolute; border-radius:50%; filter:blur(60px); animation:p-derive 17s ease-in-out infinite alternate;}
#portail .p-halo-1{width:64vmax; height:64vmax; left:-22vmax; top:-34vmax; opacity:.55;
  background:radial-gradient(circle, rgba(20,137,222,.6), transparent 65%);}
#portail .p-halo-2{width:52vmax; height:52vmax; right:-20vmax; bottom:-30vmax; opacity:.45;
  background:radial-gradient(circle, rgba(79,180,255,.34), transparent 65%);
  animation-duration:23s; animation-direction:alternate-reverse;}
@keyframes p-derive{from{transform:translate3d(0,0,0) scale(1);} to{transform:translate3d(6vmax,4vmax,0) scale(1.14);}}

#portail .p-carte{
  position:relative; width:100%; max-width:424px; margin:auto; padding:38px 32px 26px;
  border-radius:30px; text-align:center;
  background:linear-gradient(180deg, rgba(255,255,255,.085), rgba(255,255,255,.035));
  border:1px solid rgba(255,255,255,.12);
  box-shadow:0 2px 6px rgba(0,0,0,.36), 0 30px 80px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.14);
  -webkit-backdrop-filter:blur(28px) saturate(160%); backdrop-filter:blur(28px) saturate(160%);
  animation:p-entree .85s var(--p-ease) both;
}
@keyframes p-entree{from{opacity:0; transform:translateY(22px) scale(.975);} to{opacity:1; transform:none;}}
#portail .p-carte > *{animation:p-monte .8s var(--p-ease) both; animation-delay:calc(var(--i, 0) * 70ms + 120ms);}
@keyframes p-monte{from{opacity:0; transform:translateY(14px);} to{opacity:1; transform:none;}}

#portail .p-logo{display:flex; justify-content:center; align-items:center; height:88px; margin:0 0 14px;}
#portail .p-logo img{display:block; height:88px; width:88px; object-fit:contain; filter:drop-shadow(0 8px 26px rgba(20,137,222,.42));}
#portail .p-logo b{font-size:26px; font-weight:700; letter-spacing:-.02em;}
#portail .p-pastille{
  display:inline-flex; align-items:center; gap:8px; margin:0 0 16px; padding:6px 13px;
  border-radius:999px; font-size:12px; font-weight:500; letter-spacing:.06em; text-transform:uppercase;
  color:var(--p-bright); background:rgba(79,180,255,.10); border:1px solid rgba(79,180,255,.22);
}
#portail .p-point{width:7px; height:7px; border-radius:50%; background:var(--p-bright); box-shadow:0 0 0 0 rgba(79,180,255,.6); animation:p-pouls 2.2s ease-out infinite;}
@keyframes p-pouls{0%{box-shadow:0 0 0 0 rgba(79,180,255,.55);} 70%,100%{box-shadow:0 0 0 9px rgba(79,180,255,0);}}
#portail .p-titre{margin:0 0 10px; font-size:30px; font-weight:700; letter-spacing:-.02em; line-height:1.12; color:var(--p-ink);}
#portail .p-intro{margin:0 0 26px; font-size:15px; color:var(--p-soft);}

#portail .p-champ{display:block; margin:0 0 14px; text-align:left;}
#portail .p-champ > span{display:block; margin:0 0 7px 4px; font-size:12px; font-weight:500; letter-spacing:.05em; text-transform:uppercase; color:var(--p-muted);}
#portail .p-saisie{position:relative;}
#portail .p-saisie input{
  display:block; width:100%; height:54px; padding:0 16px; margin:0;
  border-radius:16px; border:1px solid rgba(255,255,255,.14); background:rgba(0,0,0,.30);
  color:var(--p-ink); font:inherit; font-size:16px; font-weight:400; outline:none;
  transition:border-color .25s var(--p-ease), box-shadow .25s var(--p-ease), background .25s var(--p-ease);
}
#portail .p-saisie input::placeholder{color:rgba(196,201,208,.38);}
#portail .p-saisie input:hover{border-color:rgba(255,255,255,.24);}
#portail .p-saisie input:focus{border-color:var(--p-bright); background:rgba(0,0,0,.42); box-shadow:0 0 0 4px rgba(79,180,255,.16);}
#portail .p-saisie input:-webkit-autofill{-webkit-text-fill-color:var(--p-ink); -webkit-box-shadow:0 0 0 100px #0b1119 inset; caret-color:var(--p-ink);}
#portail .p-mdp input{padding-right:54px;}
#portail .p-oeil{
  position:absolute; right:6px; top:6px; width:42px; height:42px; padding:0; border:0; border-radius:12px;
  display:flex; align-items:center; justify-content:center; background:none; color:var(--p-muted); cursor:pointer;
  transition:color .2s var(--p-ease), background .2s var(--p-ease);
}
#portail .p-oeil:hover{color:var(--p-ink); background:rgba(255,255,255,.07);}
#portail .p-oeil svg{width:20px; height:20px; display:block;}
#portail .p-oeil .p-barre{opacity:0; transition:opacity .2s;}
#portail .p-oeil[aria-pressed="true"] .p-barre{opacity:1;}

#portail .p-erreur{min-height:22px; margin:0 4px 12px; font-size:14px; font-weight:400; text-align:left; color:var(--p-danger);}
#portail .p-erreur.p-vu{animation:p-apparait .35s var(--p-ease) both;}
@keyframes p-apparait{from{opacity:0; transform:translateY(-5px);} to{opacity:1; transform:none;}}
#portail .p-secoue{animation:p-secoue .45s cubic-bezier(.36,.07,.19,.97) both;}
@keyframes p-secoue{10%,90%{transform:translateX(-2px);} 20%,80%{transform:translateX(4px);} 30%,50%,70%{transform:translateX(-7px);} 40%,60%{transform:translateX(7px);}}

#portail .p-entrer{
  position:relative; display:flex; align-items:center; justify-content:center; gap:10px;
  width:100%; height:56px; padding:0 18px; margin:0; border:0; border-radius:16px; overflow:hidden;
  font:inherit; font-size:16px; font-weight:600; color:#fff; cursor:pointer;
  background:linear-gradient(180deg, #2ea0f2, #1489DE 55%, #0f74c0);
  box-shadow:0 10px 26px rgba(20,137,222,.38), inset 0 1px 0 rgba(255,255,255,.28);
  transition:transform .3s var(--p-ease), box-shadow .3s var(--p-ease), filter .3s var(--p-ease);
}
#portail .p-entrer:hover{transform:translateY(-1px); filter:brightness(1.07); box-shadow:0 14px 32px rgba(20,137,222,.46), inset 0 1px 0 rgba(255,255,255,.3);}
#portail .p-entrer:active{transform:scale(.985);}
#portail .p-entrer:focus-visible{outline:2px solid #fff; outline-offset:3px;}
#portail .p-entrer:disabled{cursor:default; transform:none; filter:saturate(.75) brightness(.95);}
#portail .p-entrer.p-reussi{background:linear-gradient(180deg, #3ec28a, #26a874 55%, #1d8f62); box-shadow:0 10px 26px rgba(38,168,116,.4), inset 0 1px 0 rgba(255,255,255,.28);}
#portail .p-rond{width:20px; height:20px; border-radius:50%; border:2.5px solid rgba(255,255,255,.35); border-top-color:#fff; animation:p-tour .7s linear infinite;}
@keyframes p-tour{to{transform:rotate(360deg);}}
#portail .p-coche{width:22px; height:22px; animation:p-pop .45s cubic-bezier(.34,1.56,.64,1) both;}
@keyframes p-pop{from{opacity:0; transform:scale(.4);} to{opacity:1; transform:none;}}

#portail .p-pied{margin:20px 0 0; font-size:13px; color:var(--p-muted);}
#portail .p-attente{display:flex; flex-direction:column; align-items:center; gap:16px; padding:10px 0 8px;}
#portail .p-attente .p-rond{width:30px; height:30px; border-width:3px;}
#portail .p-attente p{margin:0; font-size:15px; color:var(--p-soft);}
#portail .p-reseau-msg{margin:0 0 20px; font-size:15px; color:var(--p-soft);}
#portail .p-reessayer{
  width:100%; height:52px; border-radius:16px; border:1px solid rgba(255,255,255,.18); background:rgba(255,255,255,.07);
  color:var(--p-ink); font:inherit; font-size:15px; font-weight:500; cursor:pointer;
  transition:background .25s var(--p-ease), transform .25s var(--p-ease);
}
#portail .p-reessayer:hover{background:rgba(255,255,255,.12);}
#portail .p-reessayer:active{transform:scale(.985);}

@media (max-width:480px){
  #portail{padding:16px;}
  #portail .p-carte{padding:30px 20px 22px; border-radius:26px;}
  #portail .p-titre{font-size:26px;}
}
@media (prefers-reduced-motion:reduce){
  #portail, #portail *{animation-duration:.01ms !important; animation-delay:0s !important; animation-iteration-count:1 !important; transition-duration:.01ms !important;}
}
`;

  const GABARIT = `
<div class="p-fond" aria-hidden="true"><div class="p-halo p-halo-1"></div><div class="p-halo p-halo-2"></div></div>
<div class="p-carte">
  <div class="p-logo" style="--i:0"></div>
  <div style="--i:1"><span class="p-pastille"><span class="p-point"></span>Test privé</span></div>
  <h1 class="p-titre" id="portail-titre" style="--i:2">Accès réservé</h1>
  <p class="p-intro" style="--i:3">Le site est en phase de test, sur invitation. Entre l'adresse e-mail et le mot de passe que tu as reçus.</p>

  <div class="p-vue" data-v="verif" hidden>
    <div class="p-attente"><div class="p-rond"></div><p>Vérification de ton accès…</p></div>
  </div>

  <div class="p-vue" data-v="reseau" hidden>
    <p class="p-reseau-msg" role="alert"></p>
    <button type="button" class="p-reessayer">Réessayer</button>
  </div>

  <form class="p-vue" data-v="form" novalidate style="--i:4">
    <label class="p-champ"><span>Adresse e-mail</span>
      <div class="p-saisie"><input type="email" name="email" autocomplete="username" inputmode="email" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="toi@exemple.fr" required></div>
    </label>
    <label class="p-champ"><span>Mot de passe</span>
      <div class="p-saisie p-mdp"><input type="password" name="mot-de-passe" autocomplete="current-password" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="XXXX-XXXX-XXXX" required>
        <button type="button" class="p-oeil" aria-label="Afficher le mot de passe" aria-pressed="false">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/><path class="p-barre" d="M4 4l16 16"/></svg>
        </button>
      </div>
    </label>
    <p class="p-erreur" role="alert" aria-live="polite"></p>
    <button type="submit" class="p-entrer"><span class="p-lib">Entrer</span></button>
  </form>

  <p class="p-pied" style="--i:5">Tes identifiants sont personnels : merci de ne pas les partager.</p>
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
    p.classList.remove('p-vu');
    if(texte){
      void p.offsetWidth;
      p.classList.add('p-vu');
    }
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
      setTimeout(() => r.remove(), 700);
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
        d.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;padding:24px;background:#05070a;color:#F4F5F6;font:16px sans-serif;text-align:center';
        d.textContent = 'Accès momentanément indisponible. Recharge la page dans un instant.';
        document.body.appendChild(d);
      }
    }
  }

  if(document.body) demarrer();
  else document.addEventListener('DOMContentLoaded', demarrer);
})();
