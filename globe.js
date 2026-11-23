/* ======================================================================
   L'INTRODUCTION DE LA CARTE
   ----------------------------------------------------------------------
   À l'ouverture de la carte des artistes : un globe en pointillés blancs
   émerge du noir, tourne vite puis ralentit longuement et se pose sur la
   France, qui s'allume. La caméra plonge alors sur la France, puis passe
   trois artistes tirés au hasard : chacun est localisé sur la carte
   pendant qu'un extrait de l'un de ses morceaux joue 4 à 5 secondes.
   Enfin le globe s'ouvre sur la page.

   Anime.js (lib/animejs/) conduit les mouvements. Les terres viennent de
   lib/globe/land-50m.json (Natural Earth, domaine public). Les artistes
   sont choisis par introArtistes() (index.html). Rien ne se joue si la
   personne a demandé moins d'animation, ou si un élément manque : la
   carte s'ouvre alors normalement. Un toucher ou une touche passe tout.
   ====================================================================== */
(function(){

  'use strict';

  if(!window.anime || !window.anime.animate) return;
  if(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const { animate } = window.anime;

  const TERRES = 'lib/globe/land-50m.json';
  const FRANCE = { lon: 2.6, lat: 46.4 };
  const RAD = Math.PI / 180;

  // Près de la France, un masque plus fin des terres (25 pixels par degré) sert à poser les points en zoom ; ailleurs, le masque du monde.
  const ZONE = { lon0: -25, lon1: 35, lat0: 28, lat1: 66 };
  const FINESSE = 0.125;     // la grille la plus fine, en degrés ; les autres en sont des multiples (1, 2, 4, 8)
  const ECART = 10;          // l'écart voulu entre deux points à l'écran, en pixels

  // Un contour approximatif de la France (métropole et Corse) pour la teinter.
  const CONTOURS_FRANCE = [
    [[-4.8, 48.4], [-1.6, 48.7], [-1.3, 49.7], [0.2, 49.7], [1.6, 50.9], [2.6, 51.05], [3.3, 50.5], [4.2, 50], [4.85, 49.95], [5.5, 49.5], [6.35, 49.45],
     [8.2, 48.97], [7.6, 48], [7.55, 47.6], [7, 47.45], [6.9, 47], [6, 46.3], [6.8, 45.9], [7.1, 45.3], [6.9, 44.4], [7.5, 43.8], [6, 43.1], [4, 43.4],
     [3.2, 42.5], [1.7, 42.5], [0.7, 42.8], [-1.7, 43.35], [-1.2, 44.7], [-1.2, 46], [-2.3, 47], [-4.8, 47.8]],
    [[8.5, 41.4], [9.6, 41.4], [9.5, 43], [8.6, 42.6]]
  ];

  let mondes = null;       // les points du globe entier (vue éloignée)
  let terre = null;        // (lon, lat) en degrés -> terre ou mer, pour la vue rapprochée
  const teinte = new Map();
  let chargement = null;
  let enCours = false;

  function dansFrance(lon, lat){
    return CONTOURS_FRANCE.some(poly => {
      let dedans = false;
      for(let i = 0, j = poly.length - 1; i < poly.length; j = i++){
        const a = poly[i], b = poly[j];
        if((a[1] > lat) !== (b[1] > lat) && lon < (b[0] - a[0]) * (lat - a[1]) / (b[1] - a[1]) + a[0]) dedans = !dedans;
      }
      return dedans;
    });
  }

  // Lit le fichier des terres (TopoJSON) et en tire deux grilles de points : le monde, et la France en détail.
  function charger(){

    if(chargement) return chargement;

    chargement = fetch(TERRES).then(r => r.json()).then(topo => {

      const k = topo.transform ? topo.transform.scale : [1, 1];
      const t = topo.transform ? topo.transform.translate : [0, 0];

      // Les arcs sont codés en écarts successifs.
      const arcs = topo.arcs.map(arc => {
        let x = 0, y = 0;
        return arc.map(p => { x += p[0]; y += p[1]; return [x * k[0] + t[0], y * k[1] + t[1]]; });
      });

      const anneau = (indices) => {
        const pts = [];
        indices.forEach(i => {
          const a = i < 0 ? arcs[~i].slice().reverse() : arcs[i];
          a.forEach((p, j) => { if(j || !pts.length) pts.push(p); });
        });
        return pts;
      };

      const polygones = [];

      Object.keys(topo.objects).forEach(nom => {
        const obj = topo.objects[nom];
        (obj.geometries || [obj]).forEach(geo => {
          if(geo.type === 'Polygon') polygones.push(geo.arcs.map(anneau));
          else if(geo.type === 'MultiPolygon') geo.arcs.forEach(p => polygones.push(p.map(anneau)));
        });
      });

      // Dessine les terres sur un canvas (en pixels par degré) pour en lire la couverture.
      const masque = (lon0, lat0, lon1, lat1, ppd) => {

        const w = Math.ceil((lon1 - lon0) * ppd), h = Math.ceil((lat1 - lat0) * ppd);
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const g = c.getContext('2d', { willReadFrequently: true });
        g.fillStyle = '#fff';

        polygones.forEach(rings => {
          g.beginPath();
          rings.forEach(ring => {
            ring.forEach((p, i) => {
              const x = (p[0] - lon0) * ppd, y = (lat1 - p[1]) * ppd;
              if(i) g.lineTo(x, y); else g.moveTo(x, y);
            });
            g.closePath();
          });
          g.fill('evenodd');
        });

        const d = g.getImageData(0, 0, w, h).data;

        return (lon, lat) => {
          const x = Math.floor((lon - lon0) * ppd), y = Math.floor((lat1 - lat) * ppd);
          return x >= 0 && y >= 0 && x < w && y < h && d[(y * w + x) * 4 + 3] > 128;
        };
      };

      const monde = masque(-180, -90, 180, 90, 4);
      const fin = masque(ZONE.lon0, ZONE.lat0, ZONE.lon1, ZONE.lat1, 25);

      terre = (lon, lat) => lon > ZONE.lon0 && lon < ZONE.lon1 && lat > ZONE.lat0 && lat < ZONE.lat1 ? fin(lon, lat) : monde(lon, lat);

      // Le globe entier : une grille de 1,5°, dont l'écart en longitude grandit vers les pôles (densité égale).
      const m = [];
      let rang = 0;

      for(let lat = -84; lat <= 84; lat += 1.5, rang++){
        const n = Math.max(1, Math.round(240 * Math.cos(lat * RAD)));
        for(let i = 0; i < n; i++){
          const lon = -180 + (i + (rang % 2) * .5) * (360 / n);
          if(monde(lon, lat)) m.push({ lon: lon * RAD, lat: lat * RAD, fr: dansFrance(lon, lat) });
        }
      }

      mondes = m;
    });

    return chargement;
  }

  const N = 8;   // les points se dessinent par paquets de même transparence : un seul remplissage par paquet

  // Dessine le globe vu depuis (e.lon, e.inclinaison), en projection orthographique.
  function dessiner(ctx, w, h, e){

    const R = Math.min(w, h) / 2 * .86 * e.echelle;
    const cx = w / 2, cy = h / 2;
    const lon0 = e.lon * RAD, lat0 = e.inclinaison * RAD;
    const sinL = Math.sin(lat0), cosL = Math.cos(lat0);

    ctx.clearRect(0, 0, w, h);

    // La sphère : un halo discret et un bord fin, qui s'effacent quand on s'approche.
    const bord = Math.max(0, Math.min(1, 1 - (e.echelle - 1.1) / 1.2));

    if(bord > 0){
      const halo = ctx.createRadialGradient(cx, cy, R * .55, cx, cy, R * 1.22);
      halo.addColorStop(0, 'rgba(32,116,187,0)');
      halo.addColorStop(.82, 'rgba(32,116,187,' + (.16 * bord * e.apparition).toFixed(3) + ')');
      halo.addColorStop(1, 'rgba(32,116,187,0)');
      ctx.fillStyle = halo;
      ctx.beginPath(); ctx.arc(cx, cy, R * 1.22, 0, 6.2832); ctx.fill();

      ctx.strokeStyle = 'rgba(255,255,255,' + (.14 * bord * e.apparition).toFixed(3) + ')';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, 6.2832); ctx.stroke();
    }

    const blancs = [], bleus = [];
    for(let i = 0; i < N; i++){ blancs.push(new Path2D()); bleus.push(new Path2D()); }

    const poser = (chemin, x, y, r) => {
      if(r < 1.5) chemin.rect(x - r, y - r, r * 2, r * 2);
      else { chemin.moveTo(x + r, y); chemin.arc(x, y, r, 0, 6.2832); }
    };

    // Le globe entier, vu de loin : il s'efface quand la caméra s'approche.
    const rMonde = R * .0042;
    const fondu = Math.max(0, Math.min(1, (2.6 - e.echelle) / 1.0));
    const grossi = 1 + .45 * e.france * Math.max(0, 1 - (e.echelle - 1) / 4);

    if(fondu > 0){
      for(let i = 0; i < mondes.length; i++){

        const p = mondes[i];
        const dl = p.lon - lon0;
        const cosLat = Math.cos(p.lat);
        const z = sinL * Math.sin(p.lat) + cosL * cosLat * Math.cos(dl);

        if(z <= 0.02) continue;

        const x = cx + R * cosLat * Math.sin(dl);
        const y = cy - R * (cosL * Math.sin(p.lat) - sinL * cosLat * Math.cos(dl));

        if(x < -8 || x > w + 8 || y < -8 || y > h + 8) continue;

        const a = e.apparition * fondu * (.12 + z * .78);
        const b = Math.min(N - 1, Math.floor(a * N));
        const r = Math.min(2.4, Math.max(.8, rMonde * (.55 + z * .6)));

        if(p.fr && e.france > 0) poser(bleus[b], x, y, r * grossi);
        else poser(blancs[b], x, y, r);
      }
    }

    // La vue rapprochée : une grille posée à la volée sur ce que l'écran montre (aucun bord carré), dont l'écart reste
    // d'environ ECART pixels à tous les zooms. Les points d'une grille plus grossière sont aussi ceux de la plus fine : en
    // zoomant, les nouveaux apparaissent en fondu.
    const proche = Math.max(0, Math.min(1, (e.echelle - 1.9) / 1.0));

    if(proche > 0 && terre){

      const voulu = ECART / (R * RAD * FINESSE);        // multiple de FINESSE visé (peut être fractionnaire)
      let pas = 1;
      while(pas * 2 <= Math.min(8, voulu * .8)) pas *= 2;

      const ext = Math.min(Math.PI, Math.max(w, h) * .62 / R);         // demi-étendue visible, en radians
      const extLat = ext / RAD;
      const extLon = Math.min(180, extLat / Math.max(.2, Math.cos(e.inclinaison * RAD)));

      const i0 = Math.ceil((e.lon - extLon) / FINESSE / pas) * pas, i1 = Math.floor((e.lon + extLon) / FINESSE);
      const j0 = Math.ceil(Math.max(-85, e.inclinaison - extLat) / FINESSE / pas) * pas, j1 = Math.floor(Math.min(85, e.inclinaison + extLat) / FINESSE);

      const rProche = Math.min(3.4, Math.max(.8, R * RAD * FINESSE * Math.min(voulu, 8) * .2));

      for(let j = j0; j <= j1; j += pas){

        const lat = j * FINESSE;
        const la = lat * RAD, sinLa = Math.sin(la), cosLa = Math.cos(la);

        for(let i = i0; i <= i1; i += pas){

          const lon = i * FINESSE;

          let lonU = lon;
          while(lonU > 180) lonU -= 360;
          while(lonU < -180) lonU += 360;

          const dl = (lon - e.lon) * RAD;
          const z = sinL * sinLa + cosL * cosLa * Math.cos(dl);

          if(z <= 0.02) continue;

          const x = cx + R * cosLa * Math.sin(dl);
          const y = cy - R * (cosL * sinLa - sinL * cosLa * Math.cos(dl));

          if(x < -8 || x > w + 8 || y < -8 || y > h + 8) continue;

          if(!terre(lonU, lat)) continue;

          // Un point d'une grille plus grossière que celle voulue s'affiche pleinement ; les plus fins arrivent en fondu.
          let m = 1;
          while(m < 8 && (Math.abs(i) % (m * 2) === 0) && (Math.abs(j) % (m * 2) === 0)) m *= 2;
          const niveau = Math.max(0, Math.min(1, (m / Math.max(1, voulu) - .55) / .4));

          if(niveau <= 0) continue;

          const a = e.apparition * proche * niveau * (.16 + z * .8);
          const b = Math.min(N - 1, Math.floor(a * N));

          let fr = false;

          if(e.france > 0){
            const cle = i * 20011 + j;
            fr = teinte.get(cle);
            if(fr === undefined){ fr = dansFrance(lonU, lat); teinte.set(cle, fr); }
          }

          if(fr) poser(bleus[b], x, y, rProche * (.6 + z * .5) * (1 + .3 * e.france));
          else poser(blancs[b], x, y, rProche * (.6 + z * .5));
        }
      }
    }

    const f = e.france;
    const r = Math.round(255 - 176 * f), g = Math.round(255 - 75 * f);

    for(let i = 0; i < N; i++){
      const alpha = ((i + .6) / N).toFixed(2);
      ctx.fillStyle = 'rgba(255,255,255,' + alpha + ')';
      ctx.fill(blancs[i]);
      if(f > 0){
        ctx.fillStyle = 'rgba(' + r + ',' + g + ',255,' + Math.min(1, (i + 1.4) / N).toFixed(2) + ')';
        ctx.fill(bleus[i]);
      }
    }

    // L'emplacement de l'artiste : un point et des cercles qui rayonnent.
    if(e.marq > 0 && e.cible){

      const dl = e.cible.lon * RAD - lon0;
      const la = e.cible.lat * RAD;
      const cosLat = Math.cos(la);

      if(sinL * Math.sin(la) + cosL * cosLat * Math.cos(dl) > 0){

        const x = cx + R * cosLat * Math.sin(dl);
        const y = cy - R * (cosL * Math.sin(la) - sinL * cosLat * Math.cos(dl));
        const t = (performance.now() % 1700) / 1700;

        for(let i = 0; i < 2; i++){
          const u = (t + i * .5) % 1;
          ctx.strokeStyle = 'rgba(120,200,255,' + ((1 - u) * .8 * e.marq).toFixed(3) + ')';
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(x, y, 8 + u * 46, 0, 6.2832); ctx.stroke();
        }

        ctx.fillStyle = 'rgba(79,180,255,' + (.35 * e.marq).toFixed(3) + ')';
        ctx.beginPath(); ctx.arc(x, y, 15 * e.marq, 0, 6.2832); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,' + e.marq.toFixed(3) + ')';
        ctx.beginPath(); ctx.arc(x, y, 5.5 * e.marq, 0, 6.2832); ctx.fill();
      }
    }
  }

  const echappe = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function jouer(choix, premier){

    const dpr0 = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(window.innerWidth), h = Math.round(window.innerHeight);
    const dpr = w * h * dpr0 * dpr0 > 4.2e6 ? Math.max(1, Math.sqrt(4.2e6 / (w * h))) : dpr0;

    const fond = document.createElement('div');
    fond.className = 'intro-globe';
    fond.setAttribute('aria-hidden', 'true');
    fond.innerHTML = '<canvas></canvas><h2 class="intro-globe-titre">La carte des artistes</h2><p class="intro-globe-passer">Toucher pour passer</p>';

    const canvas = fond.querySelector('canvas');
    const titre = fond.querySelector('.intro-globe-titre');
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    // Plusieurs tours rapides, qui ralentissent jusqu'à la France.
    const e = { lon: FRANCE.lon + 1260 + 70, inclinaison: 12, echelle: .6, france: 0, apparition: 0, marq: 0, cible: null };

    fond.style.opacity = '0';
    document.body.appendChild(fond);
    document.body.classList.add('intro-globe-actif');

    let libere;
    const pret = new Promise(r => { libere = r; });
    let fini = false;
    let ouvert = false;
    let son = null;
    const vivantes = [];

    const anim = (cible, props, opts) => new Promise(resolve => {
      const a = animate(cible, Object.assign({}, props, opts, { onComplete: resolve }));
      vivantes.push(a);
    });

    const pause = (ms) => new Promise(r => setTimeout(r, ms));

    // La boucle de dessin : une image par image écran, tant que l'introduction vit.
    let image = 0;
    const boucle = () => {
      if(fini) return;
      dessiner(ctx, w, h, e);
      image = requestAnimationFrame(boucle);
    };
    boucle();

    const silence = (rapide) => {
      const a = son;
      son = null;
      if(!a) return;
      const volume = { v: a.volume };
      animate(volume, { v: 0, duration: rapide ? 120 : 450, ease: 'linear', onUpdate: () => { try{ a.volume = Math.max(0, volume.v); }catch(x){} }, onComplete: () => { try{ a.pause(); a.src = ''; }catch(x){} } });
    };

    const rendre = () => {
      document.body.classList.remove('intro-globe-actif');
      enCours = false;
      window.IntroGlobe.enCours = false;
      libere();
    };

    // Le globe s'ouvre sur la page, qui se met en place derrière.
    const ouvrir = (rapide) => {

      if(ouvert) return;
      ouvert = true;

      silence(true);
      document.removeEventListener('keydown', passer, true);
      observeur.disconnect();

      fond.querySelectorAll('.intro-globe-carte').forEach(c => { c.style.opacity = '0'; });
      animate(e, { marq: 0, duration: 300 });
      animate(canvas, { scale: [1, rapide ? 1.05 : 1.35], duration: rapide ? 500 : 1100, ease: 'inCubic' });

      setTimeout(rendre, rapide ? 80 : 450);

      animate(fond, {
        opacity: [1, 0],
        duration: rapide ? 500 : 900,
        delay: rapide ? 0 : 250,
        ease: 'inOutQuad',
        onComplete: () => { fini = true; cancelAnimationFrame(image); fond.remove(); }
      });
    };

    function passer(ev){
      if(ouvert) return;
      if(ev && ev.type === 'keydown' && (ev.key === 'Tab' || ev.key === 'Shift')) return;
      vivantes.forEach(a => { try{ a.cancel(); }catch(x){} });
      fini2 = true;
      ouvrir(true);
    }

    let fini2 = false;

    fond.addEventListener('pointerdown', passer, { once: true });
    document.addEventListener('keydown', passer, true);

    // Quitter la page pendant l'introduction l'arrête net.
    const page = document.getElementById('page-carte');
    const observeur = new MutationObserver(() => {
      if(page && !page.classList.contains('active')){
        vivantes.forEach(a => { try{ a.cancel(); }catch(x){} });
        fini2 = true;
        silence(true);
        observeur.disconnect();
        document.removeEventListener('keydown', passer, true);
        document.body.classList.remove('intro-globe-actif');
        fini = true;
        cancelAnimationFrame(image);
        fond.remove();
        enCours = false;
        window.IntroGlobe.enCours = false;
        libere();
      }
    });
    if(page) observeur.observe(page, { attributes: true, attributeFilter: ['class'] });

    // Filet de sécurité : l'introduction ne retient jamais le site plus d'une minute.
    setTimeout(() => { if(!ouvert && !fini) passer(); }, 60000);

    // L'extrait : un fondu à l'entrée (le son se coupe en fondu avec silence()). Sans accord du navigateur, la carte reste muette.
    const jouerSon = (a, entree) => {
      try{
        const audio = new Audio(a.apercu);
        audio.volume = 0;
        son = audio;
        const lecture = audio.play();
        if(lecture && lecture.catch) lecture.catch(() => {});
        const volume = { v: 0 };
        animate(volume, { v: .85, duration: entree || 600, ease: 'linear', onUpdate: () => { try{ audio.volume = Math.min(1, volume.v); }catch(x){} } });
      }catch(x){}
    };

    // Le premier artiste se fait entendre dès l'ouverture, avant même qu'on le voie.
    premier.then(a => { if(a && !fini2 && !ouvert && !son) jouerSon(a, 2200); });

    // Une carte d'artiste : photo, nom, ville, titre joué, barre de lecture.
    const carteArtiste = (a, duree) => {

      const c = document.createElement('div');
      c.className = 'intro-globe-carte';
      c.innerHTML =
        (a.photo ? '<img src="' + echappe(a.photo) + '" alt="">' : '<span class="intro-globe-initiale">' + echappe(String(a.nom || '?').charAt(0).toUpperCase()) + '</span>') +
        '<div class="intro-globe-texte"><b>' + echappe(a.nom) + '</b>' +
        '<span>' + echappe(a.ville) + '</span>' +
        '<em>' + echappe(a.titre) + '</em>' +
        '<i class="intro-globe-barre"><i></i></i></div>';
      fond.appendChild(c);

      animate(c, { opacity: [0, 1], translateY: [14, 0], scale: [.96, 1], duration: 650, ease: 'outExpo' });
      animate(c.querySelector('.intro-globe-barre i'), { scaleX: [0, 1], duration: duree, ease: 'linear' });

      return c;
    };

    // Le déroulé.
    (async () => {

      // Le globe émerge du noir.
      animate(fond, { opacity: [0, 1], duration: 900, ease: 'outQuad' });
      anim(e, { apparition: 1 }, { duration: 1800, ease: 'outQuad' });
      anim(e, { echelle: .84 }, { duration: 2400, ease: 'outCubic' });
      anim(titre, { opacity: [0, 1], translateY: [14, 0] }, { duration: 1300, delay: 500, ease: 'outExpo' });

      // Quelques tours rapides, de plus en plus lents, jusqu'à la France.
      anim(e, { lon: FRANCE.lon, inclinaison: FRANCE.lat }, { duration: 7600, ease: 'outQuart' });

      await pause(5200);
      if(fini2) return;

      anim(titre, { opacity: 0, translateY: -10 }, { duration: 700, ease: 'inQuad' });
      anim(e, { france: 1 }, { duration: 1100, ease: 'inOutQuad' });

      await pause(1700);
      if(fini2) return;

      // La caméra plonge sur la France.
      await anim(e, { echelle: 9.6 }, { duration: 3200, ease: 'inOutCubic' });
      if(fini2) return;

      const artistes = await Promise.race([choix, pause(3000).then(() => [])]).catch(() => []);
      if(fini2) return;

      const DUREE_EXTRAIT = 4600;

      for(let i = 0; i < artistes.length; i++){

        const a = artistes[i];

        e.cible = { lon: a.lon, lat: a.lat };

        // En vol : un petit recul, puis on plonge sur l'emplacement.
        if(i > 0){
          anim(e, { echelle: 7 }, { duration: 650, ease: 'outQuad' });
          anim(e, { echelle: 13 }, { duration: 750, delay: 650, ease: 'inQuad' });
        } else {
          anim(e, { echelle: 13 }, { duration: 1500, ease: 'inOutCubic' });
        }

        await anim(e, { lon: a.lon, inclinaison: a.lat }, { duration: 1450, ease: 'inOutCubic' });
        if(fini2) return;

        anim(e, { marq: 1 }, { duration: 500, ease: 'outBack' });

        const c = carteArtiste(a, DUREE_EXTRAIT);

        // Le premier extrait joue déjà depuis l'ouverture ; les autres démarrent ici.
        if(!son) jouerSon(a, 500);

        await pause(DUREE_EXTRAIT - 450);
        if(fini2) return;

        silence(false);
        animate(c, { opacity: 0, translateY: -10, duration: 450, ease: 'inQuad', onComplete: () => c.remove() });
        anim(e, { marq: 0 }, { duration: 450, ease: 'inQuad' });

        await pause(450);
        if(fini2) return;
      }

      // Retour sur la France, puis le globe s'ouvre sur la page.
      if(artistes.length){
        await anim(e, { lon: FRANCE.lon, inclinaison: FRANCE.lat, echelle: 9.6 }, { duration: 1500, ease: 'inOutCubic' });
        if(fini2) return;
      }

      ouvrir(false);

    })();

    return pret;
  }

  window.IntroGlobe = {

    enCours: false,
    pret: Promise.resolve(),

    // Appelée par goTo en arrivant sur la carte ; « avant » est la page quittée.
    // Revenir d'une fiche d'artiste, ou rester sur la carte, la retrouve telle quelle.
    lancer(avant){

      if(enCours || avant === 'page-artiste' || avant === 'page-carte') return;
      if(!mondes) return;

      enCours = true;
      this.enCours = true;

      let donnerPremier;
      const premier = new Promise(r => { donnerPremier = r; });

      const choix = typeof window.introArtistes === 'function'
        ? window.introArtistes(donnerPremier).catch(() => [])
        : Promise.resolve([]);

      this.pret = jouer(choix, premier);
    }
  };

  // Les terres se chargent dès que le site est prêt : au moment d'ouvrir la carte, elles sont là.
  charger().catch(() => { chargement = null; });

})();
