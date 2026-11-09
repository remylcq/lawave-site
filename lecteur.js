/* =====================================================================
   La Wave — le lecteur d'extraits et sa file d'écoute

   Un petit lecteur posé en bas de l'écran, qui reste pendant qu'on navigue : on y met des sorties (« Ajouter à la file »
   dans une fiche) ou tous les titres d'un projet (« Tout écouter »), et il enchaîne les extraits de 30 secondes.

   Les adresses d'extrait de Deezer expirent au bout d'un quart d'heure : une entrée de la file garde le numéro de sa sortie
   et, si son adresse a plus de 8 minutes au moment de la lecture, va la relire (RPC catalogue_pistes).

   Appelé depuis index.html (chargé à la demande, voir chargerLecteur) :
     Lecteur.ajouterSortie({ id, title, artist, cover })
     Lecteur.lireListe(pistes, { id, title, artist, cover })   pistes = [{ n, titre, artiste, apercu }]
     Lecteur.pause()                                           coupe le son (une fiche lance son propre extrait)
   ===================================================================== */

window.Lecteur = (function(){

  'use strict';

  const FRAICHEUR_MS = 8 * 60 * 1000;
  const E = { file: [], i: -1, audio: null, joue: false, ouvert: false, bar: null, essais: 0 };

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const ICONES = {
    prec: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h2v14H6zM20 5.5v13a1 1 0 0 1-1.6.8L9.5 12.8a1 1 0 0 1 0-1.6l8.9-6.5a1 1 0 0 1 1.6.8z"/></svg>',
    suiv: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 5h2v14h-2zM4 5.5v13a1 1 0 0 0 1.6.8l8.9-6.5a1 1 0 0 0 0-1.6L5.6 4.7A1 1 0 0 0 4 5.5z"/></svg>',
    jouer: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.2v13.6a1 1 0 0 0 1.5.86l11-6.8a1 1 0 0 0 0-1.72l-11-6.8A1 1 0 0 0 8 5.2z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4.2" height="14" rx="1"/><rect x="13.8" y="5" width="4.2" height="14" rx="1"/></svg>',
    file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 6h12M4 12h12M4 18h7M18 14v6l4-3z" fill="currentColor"/></svg>',
    croix: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>'
  };

  const CSS = `
  .lecteur{
    position:fixed; left:50%; bottom:18px; transform:translateX(-50%); z-index:250; width:min(540px, calc(100vw - 32px));
    display:grid; grid-template-columns:auto minmax(0,1fr) auto; align-items:center; gap:12px; padding:10px 12px 12px;
    background:linear-gradient(152deg, rgba(255,255,255,0.09), rgba(255,255,255,0) 46%), rgba(11,14,20,0.94);
    border:1px solid rgba(255,255,255,0.16); border-radius:20px; color:var(--ink,#f4f5f6);
    box-shadow:0 24px 60px -18px rgba(0,0,0,.85); -webkit-backdrop-filter:blur(14px); backdrop-filter:blur(14px);
    animation:lecteurEntre .45s var(--ease, cubic-bezier(.16,1,.3,1)) both;
  }
  .lecteur[hidden]{display:none;}
  @keyframes lecteurEntre{from{opacity:0; transform:translate(-50%, 18px);} to{opacity:1; transform:translate(-50%, 0);}}
  .lecteur-cover{width:46px; height:46px; border-radius:10px; object-fit:cover; background:rgba(255,255,255,.08); display:block;}
  .lecteur-texte{min-width:0; display:flex; flex-direction:column; gap:2px;}
  .lecteur-titre{font-size:14px; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
  .lecteur-artiste{font-size:12px; color:var(--muted,#9aa3ad); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
  .lecteur-boutons{display:flex; align-items:center; gap:2px;}
  .lecteur-b{
    position:relative; width:36px; height:36px; padding:0; border:0; border-radius:50%; background:none; color:inherit; cursor:pointer;
    display:inline-flex; align-items:center; justify-content:center; transition:background .2s;
  }
  .lecteur-b:hover{background:rgba(255,255,255,.1);}
  .lecteur-b:focus-visible{outline:2px solid var(--blue-bright,#4fb4ff); outline-offset:1px;}
  .lecteur-b svg{width:16px; height:16px; fill:currentColor;}
  .lecteur-b.jouer{width:40px; height:40px; background:var(--blue-bright,#4fb4ff); color:#04121f;}
  .lecteur-b.jouer:hover{background:#fff;}
  .lecteur-b.jouer svg{width:17px; height:17px;}
  /* Les deux icônes du bouton de lecture s'échangent par la classe « joue ». */
  .lecteur-b.jouer span{display:inline-flex;}
  .lecteur-b.jouer .i-pause, .lecteur.joue .lecteur-b.jouer .i-jouer{display:none;}
  .lecteur.joue .lecteur-b.jouer .i-pause{display:inline-flex;}
  .lecteur-nb{position:absolute; top:-1px; right:-2px; min-width:16px; height:16px; padding:0 4px; border-radius:99px; font-size:10px; font-weight:700; line-height:16px; text-align:center; background:var(--blue,#1489de); color:#fff;}
  .lecteur-progres{grid-column:1 / -1; height:3px; border-radius:3px; background:rgba(255,255,255,.1); overflow:hidden; margin-top:-2px;}
  .lecteur-progres i{display:block; height:100%; width:0; background:var(--blue-bright,#4fb4ff);}
  .lecteur-liste{grid-column:1 / -1; max-height:min(280px, 40vh); overflow-y:auto; scrollbar-width:none; margin:2px -4px -2px; padding:4px 4px 0; border-top:1px solid rgba(255,255,255,.1);}
  .lecteur-liste::-webkit-scrollbar{display:none;}
  .lecteur-liste[hidden]{display:none;}
  .lecteur-ligne{display:flex; align-items:center; gap:10px; width:100%; padding:7px 8px; border:0; border-radius:10px; background:none; color:inherit; font:inherit; text-align:left; cursor:pointer;}
  .lecteur-ligne:hover{background:rgba(255,255,255,.07);}
  .lecteur-ligne.actif{background:rgba(79,180,255,.14);}
  .lecteur-ligne img{width:30px; height:30px; border-radius:6px; object-fit:cover; flex:none; background:rgba(255,255,255,.08);}
  .lecteur-ligne span{min-width:0; flex:1; display:flex; flex-direction:column; font-size:13px; line-height:1.25;}
  .lecteur-ligne span b{font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
  .lecteur-ligne span small{font-size:11.5px; color:var(--muted,#9aa3ad); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
  .lecteur-vide{margin:6px 8px 8px; font-size:13px; color:var(--muted,#9aa3ad);}
  @media (max-width:760px){ .lecteur{bottom:76px;} }
  @media (prefers-reduced-motion:reduce){ .lecteur{animation:none;} }
  `;

  function monter(){

    if(E.bar) return;

    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    const bar = document.createElement('div');
    bar.className = 'lecteur';
    bar.id = 'lecteur';
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', "Lecteur d'extraits");
    bar.hidden = true;
    bar.innerHTML = `
      <img class="lecteur-cover" alt="">
      <div class="lecteur-texte"><span class="lecteur-titre"></span><span class="lecteur-artiste"></span></div>
      <div class="lecteur-boutons">
        <button type="button" class="lecteur-b" data-l="prec" aria-label="Titre précédent">${ICONES.prec}</button>
        <button type="button" class="lecteur-b jouer" data-l="jouer" aria-label="Lecture / pause"><span class="i-jouer">${ICONES.jouer}</span><span class="i-pause">${ICONES.pause}</span></button>
        <button type="button" class="lecteur-b" data-l="suiv" aria-label="Titre suivant">${ICONES.suiv}</button>
        <button type="button" class="lecteur-b" data-l="file" aria-label="Voir la file d'écoute" aria-expanded="false">${ICONES.file}<span class="lecteur-nb"></span></button>
        <button type="button" class="lecteur-b" data-l="fermer" aria-label="Fermer le lecteur">${ICONES.croix}</button>
      </div>
      <div class="lecteur-progres" aria-hidden="true"><i></i></div>
      <div class="lecteur-liste" hidden></div>`;

    bar.addEventListener('click', (e) => {

      const b = e.target.closest('[data-l]');

      if(b){
        const act = b.dataset.l;
        if(act === 'jouer') basculer();
        else if(act === 'prec') aller(E.i - 1);
        else if(act === 'suiv') aller(E.i + 1);
        else if(act === 'file') basculerListe();
        else if(act === 'fermer') fermer();
        return;
      }

      const ligne = e.target.closest('[data-i]');
      if(ligne) aller(Number(ligne.dataset.i));
    });

    document.body.appendChild(bar);
    E.bar = bar;

    // Le lecteur reste en place quand on change de page : seul Échap dans la liste la referme.
    bar.addEventListener('keydown', (e) => {
      if(e.key === 'Escape' && !bar.querySelector('.lecteur-liste').hidden){ basculerListe(false); e.stopPropagation(); }
    });
  }

  function arreterFiche(){
    try{ if(typeof arreterExtrait === 'function') arreterExtrait(); }catch(e){}
  }

  function majBarre(){

    if(!E.bar) return;

    const it = E.file[E.i];

    E.bar.hidden = !E.file.length;
    E.bar.classList.toggle('joue', E.joue);

    if(it){
      const cover = E.bar.querySelector('.lecteur-cover');
      if(cover.getAttribute('src') !== (it.cover || '')) cover.src = it.cover || '';
      E.bar.querySelector('.lecteur-titre').textContent = it.titre || '';
      E.bar.querySelector('.lecteur-artiste').textContent = it.artiste || '';
    }

    const nb = E.bar.querySelector('.lecteur-nb');
    nb.textContent = E.file.length > 1 ? String(E.file.length) : '';
    nb.hidden = E.file.length < 2;

    E.bar.querySelector('[data-l="prec"]').disabled = E.i <= 0;
    E.bar.querySelector('[data-l="suiv"]').disabled = E.i >= E.file.length - 1;

    if(!E.bar.querySelector('.lecteur-liste').hidden) dessinerListe();

    if('mediaSession' in navigator && it){
      try{
        navigator.mediaSession.metadata = new MediaMetadata({
          title: it.titre || '', artist: it.artiste || '', album: 'La Wave',
          artwork: it.cover ? [{ src: it.cover, sizes: '256x256' }] : []
        });
        navigator.mediaSession.setActionHandler('previoustrack', () => aller(E.i - 1));
        navigator.mediaSession.setActionHandler('nexttrack', () => aller(E.i + 1));
        navigator.mediaSession.setActionHandler('play', () => basculer(true));
        navigator.mediaSession.setActionHandler('pause', () => basculer(false));
      }catch(e){}
    }
  }

  function dessinerListe(){

    const zone = E.bar.querySelector('.lecteur-liste');

    zone.innerHTML = E.file.length
      ? E.file.map((it, i) => `
          <button type="button" class="lecteur-ligne${i === E.i ? ' actif' : ''}" data-i="${i}">
            <img src="${esc(it.cover || '')}" alt="" loading="lazy">
            <span><b>${esc(it.titre)}</b><small>${esc(it.artiste)}</small></span>
          </button>`).join('')
      : '<p class="lecteur-vide">La file est vide.</p>';
  }

  function basculerListe(force){

    const zone = E.bar.querySelector('.lecteur-liste');
    const ouvre = typeof force === 'boolean' ? force : zone.hidden;

    zone.hidden = !ouvre;
    E.bar.querySelector('[data-l="file"]').setAttribute('aria-expanded', String(ouvre));

    if(ouvre){
      dessinerListe();
      const actif = zone.querySelector('.actif');
      if(actif) actif.scrollIntoView({ block: 'nearest' });
    }
  }

  function couper(){
    if(E.audio){ try{ E.audio.pause(); }catch(e){} E.audio.src = ''; E.audio = null; }
    E.joue = false;
  }

  // L'adresse de l'extrait de cette entrée : celle qu'elle porte si elle est fraîche, sinon relue chez Deezer par la base.
  async function adresse(it){

    if(it.url && Date.now() - (it.at || 0) < FRAICHEUR_MS) return it.url;

    if(!it.releaseId || typeof supabaseClient === 'undefined' || !supabaseClient) return null;

    const { data, error } = await supabaseClient.rpc('catalogue_pistes', { p_release: it.releaseId });

    if(error || !Array.isArray(data)) return null;

    const piste = (it.n && data.find(p => p.n === it.n && p.apercu)) || data.find(p => p.apercu);

    if(!piste) return null;

    it.url = piste.apercu;
    it.at = Date.now();

    // Pour une sortie ajoutée en entier, on affiche le titre du premier extrait.
    if(!it.n){ it.n = piste.n; if(data.length > 1 && piste.titre) it.titre = piste.titre; }

    return it.url;
  }

  async function aller(i, essai){

    if(i < 0 || i >= E.file.length){
      if(i >= E.file.length){ couper(); majBarre(); }
      return;
    }

    arreterFiche();
    couper();

    E.i = i;
    E.joue = false;
    majBarre();

    const it = E.file[i];
    const url = await adresse(it).catch(() => null);

    // Une autre demande est arrivée pendant la lecture de l'adresse.
    if(E.i !== i) return;

    if(!url){
      // Pas d'extrait pour celle-ci : on passe à la suivante.
      if(i < E.file.length - 1) return aller(i + 1);
      majBarre();
      return;
    }

    const audio = new Audio(url);
    audio.volume = 0.9;
    E.audio = audio;

    audio.addEventListener('timeupdate', () => {
      if(E.audio !== audio || !audio.duration) return;
      E.bar.querySelector('.lecteur-progres i').style.width = (audio.currentTime / audio.duration * 100).toFixed(1) + '%';
    });
    audio.addEventListener('ended', () => { if(E.audio === audio) aller(E.i + 1); });
    audio.addEventListener('error', () => {
      if(E.audio !== audio) return;
      // Adresse expirée : une relecture, puis la suivante.
      if(!essai){ it.url = null; aller(i, true); } else aller(i + 1);
    });

    try{
      await audio.play();
      if(E.audio === audio){ E.joue = true; majBarre(); }
    }catch(e){
      if(E.audio === audio){ E.joue = false; majBarre(); }
    }
  }

  function basculer(force){

    if(!E.audio){
      if(E.file.length) aller(E.i >= 0 ? E.i : 0);
      return;
    }

    const veut = typeof force === 'boolean' ? force : E.audio.paused;

    if(veut){ arreterFiche(); E.audio.play().then(() => { E.joue = true; majBarre(); }).catch(() => {}); }
    else { E.audio.pause(); E.joue = false; majBarre(); }
  }

  function fermer(){
    couper();
    E.file = [];
    E.i = -1;
    if(E.bar) E.bar.hidden = true;
    E.bar.querySelector('.lecteur-progres i').style.width = '0';
    basculerListe(false);
  }

  function annoncer(texte){
    if(typeof notifier === 'function') notifier(texte, { type: 'info' });
  }

  // Une sortie entière : son premier extrait joue quand vient son tour.
  function ajouterSortie(s){

    if(!s || !s.id) return;

    monter();

    if(E.file.some(x => x.releaseId === s.id && !x.n)){
      annoncer('Déjà dans ta file d\'écoute');
      return;
    }

    E.file.push({ releaseId: s.id, titre: s.title, artiste: s.artist, cover: s.cover });

    if(E.file.length === 1 || !E.joue && !E.audio){
      aller(E.file.length - 1);
    } else {
      majBarre();
      annoncer('Ajouté à ta file d\'écoute');
    }
  }

  // Tous les titres d'un projet : la file est remplacée et la lecture démarre au premier.
  function lireListe(pistes, meta){

    const liste = (pistes || []).filter(p => p && p.apercu);

    if(!liste.length) return;

    monter();

    E.file = liste.map(p => ({
      releaseId: meta && meta.id, n: p.n, titre: p.titre, artiste: p.artiste || (meta && meta.artist) || '',
      cover: meta && meta.cover, url: p.apercu, at: Date.now()
    }));

    aller(0);
  }

  function pause(){
    if(E.audio && !E.audio.paused){ E.audio.pause(); E.joue = false; majBarre(); }
  }

  return { ajouterSortie, lireListe, pause, etat: () => ({ longueur: E.file.length, i: E.i, joue: E.joue }) };

})();
