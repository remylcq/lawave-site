/* ======================================================================
   MOUVEMENT : la couche d'animation du site (Anime.js, lib/animejs/).
   ----------------------------------------------------------------------
   - chaque page arrive en fondu, légèrement remontée ;
   - les cartes (catalogue, studios, fil, membres) entrent en cascade quand
     elles se dessinent à l'écran ;
   - les boutons s'enfoncent au toucher, puis reviennent avec du ressort.
   Seuls opacity et transform bougent. Rien ne s'active si la personne a
   demandé moins d'animation, ou si Anime.js n'a pas pu se charger : le site
   reste alors exactement comme avant.
   ====================================================================== */
(function(){

  'use strict';

  if(!window.anime || !window.anime.animate) return;
  if(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const { animate, stagger } = window.anime;

  // Les cartes qui entrent en cascade quand elles apparaissent. Les cartes des studios, qui ont déjà leur propre entrée
  // (classe « entree »), et leurs squelettes de chargement sont laissés tranquilles.
  const CARTES = [
    '.cat-tile', '.com-post', '.com-ruban-carte', '.com-carte', '.st-card:not(.st-squelette)',
    '.release-card', '.aide-carte', '.aud-carte'
  ].join(',');

  // Les boutons qui s'enfoncent au toucher.
  const BOUTONS = '.btn, .com-btn, .navlink';

  const vues = new WeakSet();

  function nettoyer(els){
    (els.length === undefined ? [els] : Array.prototype.slice.call(els)).forEach(el => {
      el.style.removeProperty('opacity');
      el.style.removeProperty('transform');
      el.style.removeProperty('will-change');
    });
  }

  // Fait entrer des éléments : fondu, légère montée, cascade. Les styles posés disparaissent à la fin, pour rendre la
  // main aux survols de la feuille de style.
  function entrer(els, options){

    const liste = Array.prototype.slice.call(els);

    if(!liste.length) return;

    const o = options || {};

    liste.forEach(el => { el.style.willChange = 'opacity, transform'; });

    animate(liste, {
      opacity: [0, 1],
      translateY: [o.decalage == null ? 18 : o.decalage, 0],
      duration: o.duree || 650,
      delay: stagger(o.pas || 45),
      ease: 'outExpo',
      onComplete: () => nettoyer(liste)
    });

    // Filet de sécurité : quoi qu'il arrive à l'animation (onglet en arrière-plan, élément redessiné), rien ne reste
    // masqué ou décalé au-delà de ce délai.
    setTimeout(() => nettoyer(liste), (o.duree || 650) + liste.length * (o.pas || 45) + 600);
  }

  // ----- Les pages -----

  let demarre = false;

  function surPage(page){

    if(!demarre || document.hidden) return;

    // Communauté et Carte portent des éléments en position fixe (barres, calques) : seul le fondu y est animé, car une
    // transformation sur le parent les décalerait pendant l'animation.
    const fixe = page.id === 'page-community' || page.id === 'page-carte';

    page.style.willChange = 'opacity' + (fixe ? '' : ', transform');

    animate(page, Object.assign({
      opacity: [0, 1],
      duration: 520,
      ease: 'outCubic',
      onComplete: () => nettoyer(page)
    }, fixe ? {} : { translateY: [14, 0] }));

    setTimeout(() => nettoyer(page), 1400);
  }

  const observePages = new MutationObserver((mutations) => {

    mutations.forEach(m => {

      const page = m.target;

      if(!page.classList || !page.classList.contains('active')) return;
      if(m.oldValue && /(^|\s)active(\s|$)/.test(m.oldValue)) return;

      surPage(page);
    });
  });

  document.querySelectorAll('.page').forEach(p => {
    observePages.observe(p, { attributes: true, attributeFilter: ['class'], attributeOldValue: true });
  });

  // La page d'arrivée a déjà son entrée (logo, blocs) : les suivantes seulement.
  setTimeout(() => { demarre = true; }, 2500);

  // ----- Les cartes -----

  let file = [];
  let programme = false;

  function viderFile(){

    programme = false;

    const lot = file.filter(el => el.isConnected && !vues.has(el) && el.offsetParent !== null).slice(0, 30);

    file = [];

    // Seules les cartes déjà visibles à l'écran entrent en cascade ; celles du dessous sont posées normalement.
    const visibles = lot.filter(el => {
      const r = el.getBoundingClientRect();
      return r.bottom > 0 && r.top < window.innerHeight * 1.05;
    });

    lot.forEach(el => vues.add(el));

    // Au chargement du site (et onglet en arrière-plan), les cartes se posent sans animation : rien ne doit tarder à apparaître.
    if(visibles.length && demarre && !document.hidden) entrer(visibles, { pas: 40 });
  }

  function empiler(noeud){

    if(noeud.nodeType !== 1) return;

    if(noeud.matches(CARTES)) file.push(noeud);

    noeud.querySelectorAll(CARTES).forEach(el => file.push(el));

    if(file.length && !programme){
      programme = true;
      requestAnimationFrame(viderFile);
    }
  }

  new MutationObserver((mutations) => {
    mutations.forEach(m => m.addedNodes.forEach(empiler));
  }).observe(document.body, { childList: true, subtree: true });

  // ----- Les boutons -----

  const enfonces = new WeakMap();

  document.addEventListener('pointerdown', (e) => {

    const b = e.target.closest && e.target.closest(BOUTONS);

    if(!b || b.disabled) return;

    const ancien = enfonces.get(b);
    if(ancien) ancien.cancel();

    enfonces.set(b, animate(b, { scale: .955, duration: 110, ease: 'outQuad' }));
  }, { passive: true });

  function relacher(e){

    const b = e.target.closest && e.target.closest(BOUTONS);

    if(!b || !enfonces.has(b)) return;

    enfonces.get(b).cancel();
    enfonces.delete(b);

    animate(b, { scale: [.955, 1], duration: 520, ease: 'outElastic(1, .6)', onComplete: () => nettoyer(b) });
  }

  document.addEventListener('pointerup', relacher, { passive: true });
  document.addEventListener('pointercancel', relacher, { passive: true });

  window.Mouvement = { entrer };

})();
