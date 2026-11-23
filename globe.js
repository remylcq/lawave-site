/* ======================================================================
   L'INTRODUCTION DE LA CARTE
   ----------------------------------------------------------------------
   À l'ouverture de la carte des artistes : un globe en pointillés blancs,
   plein écran, tourne vite sur lui-même puis ralentit et se pose sur la
   France, qui s'allume. Il s'ouvre ensuite sur la page, qui apparaît avec
   tous ses détails.

   Anime.js (lib/animejs/) conduit le mouvement ; les terres viennent de
   lib/globe/land-110m.json (Natural Earth, domaine public). Rien ne se joue
   si la personne a demandé moins d'animation, ou si un élément manque : la
   carte s'ouvre alors normalement. Un toucher ou une touche passe l'intro.
   ====================================================================== */
(function(){

  'use strict';

  if(!window.anime || !window.anime.animate) return;
  if(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const { animate } = window.anime;

  const TERRES = 'lib/globe/land-110m.json';
  const FRANCE = { lon: 2.6, lat: 46.4 };
  const DUREE = 3800;

  let points = null;       // les points du globe : { lon, lat, fr } (radians)
  let chargement = null;
  let enCours = false;

  // Lit le fichier des terres (TopoJSON), les dessine sur un canvas et en tire une grille de points régulière.
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

      const c = document.createElement('canvas');
      c.width = 720; c.height = 360;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.fillStyle = '#fff';

      const polygone = (anneaux) => {
        g.beginPath();
        anneaux.forEach(ring => {
          anneau(ring).forEach((p, i) => {
            const x = (p[0] + 180) * 2, y = (90 - p[1]) * 2;
            if(i) g.lineTo(x, y); else g.moveTo(x, y);
          });
          g.closePath();
        });
        g.fill('evenodd');
      };

      Object.keys(topo.objects).forEach(nom => {
        const obj = topo.objects[nom];
        (obj.geometries || [obj]).forEach(geo => {
          if(geo.type === 'Polygon') polygone(geo.arcs);
          else if(geo.type === 'MultiPolygon') geo.arcs.forEach(polygone);
        });
      });

      const pixels = g.getImageData(0, 0, 720, 360).data;

      const terre = (lon, lat) => {
        const x = Math.min(719, Math.max(0, Math.floor((lon + 180) * 2)));
        const y = Math.min(359, Math.max(0, Math.floor((90 - lat) * 2)));
        return pixels[(y * 720 + x) * 4 + 3] > 128;
      };

      // Une grille régulière : l'écart en longitude grandit vers les pôles, pour une densité égale partout.
      const liste = [];
      const pas = 2.1;
      let rang = 0;

      for(let lat = -84; lat <= 84; lat += pas, rang++){
        const n = Math.max(1, Math.round(360 * Math.cos(lat * Math.PI / 180) / pas));
        for(let i = 0; i < n; i++){
          const lon = -180 + (i + (rang % 2) * .5) * (360 / n);
          if(!terre(lon, lat)) continue;
          liste.push({
            lon: lon * Math.PI / 180,
            lat: lat * Math.PI / 180,
            fr: lon > -5.2 && lon < 9.7 && lat > 41.2 && lat < 51.2
          });
        }
      }

      points = liste;
    });

    return chargement;
  }

  // Dessine le globe vu depuis (etat.lon, etat.inclinaison), en projection orthographique.
  function dessiner(ctx, w, h, etat){

    const R = Math.min(w, h) / 2 * .86 * etat.echelle;
    const cx = w / 2, cy = h / 2;
    const lon0 = etat.lon * Math.PI / 180, lat0 = etat.inclinaison * Math.PI / 180;
    const sinL = Math.sin(lat0), cosL = Math.cos(lat0);

    ctx.clearRect(0, 0, w, h);

    // La sphère : un halo discret et un bord fin.
    const halo = ctx.createRadialGradient(cx, cy, R * .55, cx, cy, R * 1.22);
    halo.addColorStop(0, 'rgba(32,116,187,0)');
    halo.addColorStop(.82, 'rgba(32,116,187,.16)');
    halo.addColorStop(1, 'rgba(32,116,187,0)');
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(cx, cy, R * 1.22, 0, 6.2832); ctx.fill();

    ctx.strokeStyle = 'rgba(255,255,255,.14)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, 6.2832); ctx.stroke();

    const rayon = Math.max(1.1, R / 180);

    for(let i = 0; i < points.length; i++){

      const p = points[i];
      const dl = p.lon - lon0;
      const cosLat = Math.cos(p.lat);
      const z = sinL * Math.sin(p.lat) + cosL * cosLat * Math.cos(dl);

      // Face cachée du globe.
      if(z <= 0.02) continue;

      const x = cx + R * cosLat * Math.sin(dl);
      const y = cy - R * (cosL * Math.sin(p.lat) - sinL * cosLat * Math.cos(dl));

      const france = p.fr && etat.france > 0;

      ctx.fillStyle = france
        ? 'rgba(' + Math.round(255 - 176 * etat.france) + ',' + Math.round(255 - 75 * etat.france) + ',255,' + (.6 + z * .4).toFixed(2) + ')'
        : 'rgba(255,255,255,' + (.12 + z * .78).toFixed(2) + ')';

      ctx.beginPath();
      ctx.arc(x, y, rayon * (.55 + z * .6) * (france ? 1 + .55 * etat.france : 1), 0, 6.2832);
      ctx.fill();
    }
  }

  function jouer(){

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(Math.min(window.innerWidth, 900));
    const h = Math.round(Math.min(window.innerHeight, 900));

    const fond = document.createElement('div');
    fond.className = 'intro-globe';
    fond.setAttribute('aria-hidden', 'true');
    fond.innerHTML = '<canvas></canvas><p>Toucher pour passer</p>';

    const canvas = fond.firstChild;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    // Plusieurs tours rapides, qui ralentissent jusqu'à la France.
    const etat = { lon: FRANCE.lon + 1080 + 70, inclinaison: 14, echelle: .8, france: 0 };

    dessiner(ctx, w, h, etat);

    document.body.appendChild(fond);
    document.body.classList.add('intro-globe-actif');

    let libere;
    const pret = new Promise(r => { libere = r; });
    let ouvert = false;
    let rotation = null;

    const rendre = () => {
      document.body.classList.remove('intro-globe-actif');
      enCours = false;
      window.IntroGlobe.enCours = false;
      libere();
    };

    const retirer = () => {
      fond.remove();
      rendre();
    };

    // La France s'allume, puis le globe s'ouvre sur la page, qui se met en place derrière.
    const ouvrir = () => {

      if(ouvert) return;
      ouvert = true;

      document.removeEventListener('keydown', passer, true);

      animate(etat, { france: [0, 1], duration: 450, ease: 'outQuad', onUpdate: () => dessiner(ctx, w, h, etat) });
      animate(canvas, { scale: [1, 1.6], duration: 900, delay: 450, ease: 'inCubic' });

      // La page se lance (pastilles, panneau) dès que le globe commence à s'effacer.
      setTimeout(rendre, 650);

      animate(fond, { opacity: [1, 0], duration: 700, delay: 650, ease: 'inOutQuad', onComplete: () => fond.remove() });
    };

    function passer(e){
      if(ouvert) return;
      if(e && e.type === 'keydown' && e.key === 'Tab') return;
      if(rotation && rotation.cancel) rotation.cancel();
      etat.lon = FRANCE.lon;
      etat.inclinaison = FRANCE.lat;
      etat.echelle = 1;
      dessiner(ctx, w, h, etat);
      ouvrir();
    }

    fond.addEventListener('pointerdown', passer, { once: true });
    document.addEventListener('keydown', passer, true);

    rotation = animate(etat, {
      lon: FRANCE.lon,
      inclinaison: FRANCE.lat,
      echelle: 1,
      duration: DUREE,
      ease: 'outQuart',
      onUpdate: () => dessiner(ctx, w, h, etat),
      onComplete: ouvrir
    });

    // Filet de sécurité : l'introduction ne retient jamais le site plus de 9 secondes.
    setTimeout(() => { if(fond.isConnected) retirer(); }, 9000);

    return pret;
  }

  window.IntroGlobe = {

    enCours: false,
    pret: Promise.resolve(),

    // Appelée par goTo en arrivant sur la carte ; « avant » est la page quittée.
    // Revenir d'une fiche d'artiste, ou rester sur la carte, la retrouve telle quelle.
    lancer(avant){

      if(enCours || avant === 'page-artiste' || avant === 'page-carte') return;
      if(!points) return;

      enCours = true;
      this.enCours = true;
      this.pret = jouer();
    }
  };

  // Les terres se chargent dès que le site est prêt : au moment d'ouvrir la carte, elles sont là.
  charger().catch(() => { chargement = null; });

})();
