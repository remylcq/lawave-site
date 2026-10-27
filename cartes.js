/* =====================================================================
   La Wave — le jeu de cartes d'artistes, côté navigateur

   Le moteur vit dans la base (sql/cartes.sql, sql/cartes-artistes.sql) : tirages, collection, cadeaux, roue,
   missions, succès. Ce fichier demande et dessine.

     Packs        ouvrir 1, 5 ou 10 packs ; le pack se déchire, les cartes se retournent une à une
     Collection   toutes les cartes d'artistes, obtenues ou non ; fiche, recyclage, atelier
     Missions     3 par jour, 3 par semaine, et leur bonus
     Bonus        cadeau de connexion, roue du jour, coffre
     Succès       des paliers à récupérer

   Chargé à la demande (renderCartes dans index.html).
   ===================================================================== */

(function(){

  'use strict';

  const esc = (t) => escapeHtml(t);
  const nf = (n) => Number(n || 0).toLocaleString('fr-FR');
  const court = (n) => {
    n = Number(n || 0);
    if(n >= 1e6) return (Math.round(n / 1e5) / 10).toLocaleString('fr-FR') + ' M';
    if(n >= 1e3) return Math.round(n / 1e3) + ' k';
    return String(n);
  };
  const pluriel = (n, mot, pl) => nf(n) + ' ' + (n > 1 ? (pl || mot + 's') : mot);
  const el = (tag, classe, html) => { const e = document.createElement(tag); if(classe) e.className = classe; if(html !== undefined) e.innerHTML = html; return e; };
  const attendre = (ms) => new Promise(r => setTimeout(r, ms));
  const calme = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const numero = (n) => '#' + String(n || 0).padStart(3, '0');

  const RAR = [null,
    { nom: 'Commun', c: '#B4BDC8' },
    { nom: 'Rare', c: '#4FB4FF' },
    { nom: 'Épique', c: '#A879FF' },
    { nom: 'Légendaire', c: '#F2C14E' },
    { nom: 'Mythique', c: '#FF5C8A' }
  ];
  const rar = (r) => RAR[Math.min(Math.max(Number(r) || 1, 1), 5)];

  const VUES = [['packs', 'Packs'], ['collection', 'Collection'], ['missions', 'Missions'], ['bonus', 'Bonus'], ['succes', 'Succès']];

  // ---------------------------------------------------------------------
  // Les icônes (un trait, la couleur du texte)
  // ---------------------------------------------------------------------

  const ICONES = {
    eclair: '<path d="M13 2 4.5 13.5H11L10 22l8.5-11.5H12L13 2z"/>',
    vinyle: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.6"/><path d="M12 5.5a6.5 6.5 0 0 1 6.5 6.5"/>',
    cadeau: '<rect x="3.5" y="8.5" width="17" height="12" rx="2"/><path d="M12 8.5v12M3.5 13h17M12 8.5c-2-4.2-6.5-3.6-6.5-1.2S9.7 8.5 12 8.5zM12 8.5c2-4.2 6.5-3.6 6.5-1.2S14.3 8.5 12 8.5z"/>',
    roue: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2"/><path d="M12 3v7M12 14v7M3 12h7M14 12h7"/>',
    coffre: '<path d="M4 10h16v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19z"/><path d="M4 10V8a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v2"/><path d="M10.5 13h3v3h-3z"/>',
    cible: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2"/>',
    trophee: '<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H4.5a3.5 3.5 0 0 0 3.6 4.4M16 6h3.5a3.5 3.5 0 0 1-3.6 4.4M12 13v4M8.5 20.5h7M9.5 17h5"/>',
    cartes: '<rect x="3.5" y="6" width="11" height="15" rx="2"/><path d="M9 3.2l9.3 1.9a2 2 0 0 1 1.6 2.3l-2.4 11.8"/>',
    pack: '<path d="M6 3h12l-1 2.5 1 2.5H6l1-2.5z"/><path d="M6 8h12v11.5A1.5 1.5 0 0 1 16.5 21h-9A1.5 1.5 0 0 1 6 19.5z"/><circle cx="12" cy="14" r="3"/>',
    son: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
    muet: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="m16 9.5 5 5M21 9.5l-5 5"/>',
    cadenas: '<rect x="5" y="10.5" width="14" height="10" rx="2.2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
    recycler: '<path d="M7.5 7.8 10 3.5a2.3 2.3 0 0 1 4 0l1.3 2.2M19.6 10.5l2 3.5a2.3 2.3 0 0 1-2 3.4h-4.4M8.6 17.4H4.4a2.3 2.3 0 0 1-2-3.4l1.4-2.4"/><path d="m14.4 3.8 1 1.9-2.1.3M16.8 19.5l-1.6-2.1 1.6-1.6M3 9.7l2.3-.3.6 2.1"/>',
    marteau: '<path d="m14 6 4 4M12.5 7.5l-8.3 8.3a1.9 1.9 0 0 0 2.7 2.7l8.3-8.3"/><path d="m13 4 3.2-1.5 5.3 5.3L20 11"/>',
    fleche: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    croix: '<path d="M6 6l12 12M18 6 6 18"/>',
    loupe: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
    etoile: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
    coche: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    horloge: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>'
  };
  const ico = (n, t, extra) => `<svg class="ct-ico${extra ? ' ' + extra : ''}" width="${t || 18}" height="${t || 18}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONES[n] || ''}</svg>`;

  // L'emblème de la marque, en traits : une onde dans un disque.
  const EMBLEME = `<svg class="ct-embleme" viewBox="0 0 100 100" aria-hidden="true">
    <circle cx="50" cy="50" r="46" fill="none" stroke="currentColor" stroke-width="2" opacity=".55"/>
    <circle cx="50" cy="50" r="36" fill="none" stroke="currentColor" stroke-width="1" opacity=".3"/>
    <path d="M14 54c8 0 8-14 16-14s8 22 16 22 8-30 16-30 8 22 16 22 6-8 10-8" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;


  // ---------------------------------------------------------------------
  // Les illustrations : tout est dessiné en SVG, rien à charger.
  //   - les boosters (un décor par thème : onde, couronne, aube, garanti) ;
  //   - les cartes (un fond et un cadre ornemental par rareté).
  // ---------------------------------------------------------------------

  const alea = (graine) => { let s = graine; return () => (s = (s * 16807) % 2147483647) / 2147483647; };
  const svgUri = (svg) => 'url("data:image/svg+xml,' + encodeURIComponent(svg.replace(/\s*\n\s*/g, '')).replace(/'/g, '%27') + '")';
  const polaire = (cx, cy, r, deg) => [cx + r * Math.cos(deg * Math.PI / 180), cy + r * Math.sin(deg * Math.PI / 180)];
  const arr = (x) => Math.round(x * 10) / 10;
  const etincelle = (x, y, r, c, o) => `<path d="M${x} ${y - r}Q${x} ${y} ${x + r} ${y}Q${x} ${y} ${x} ${y + r}Q${x} ${y} ${x - r} ${y}Q${x} ${y} ${x} ${y - r}Z" fill="${c}" opacity="${o}"/>`;

  // Un flocon : six branches ornées de barbules.
  function flocon(cx, cy, r, w, couleur){
    let s = '';
    for(let k = 0; k < 6; k++){
      const a = k * 60, [x2, y2] = polaire(cx, cy, r, a);
      s += `<path d="M${cx} ${cy}L${arr(x2)} ${arr(y2)}"/>`;
      [.42, .68].forEach((t) => {
        const [bx, by] = polaire(cx, cy, r * t, a);
        [a - 50, a + 50].forEach((d) => { const [ex, ey] = polaire(bx, by, r * .24 * (1.25 - t * .45), d); s += `<path d="M${arr(bx)} ${arr(by)}L${arr(ex)} ${arr(ey)}"/>`; });
      });
    }
    return `<g fill="none" stroke="${couleur || '#dff3ff'}" stroke-width="${w}" stroke-linecap="round" opacity=".38">${s}</g>`;
  }

  // Le décor d'un pack : 210 × 318, étiré sur le haut et le corps du pack (qui se déchire).
  function artPack(theme){

    const tete = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 210 318" preserveAspectRatio="none">';
    const rnd = alea(theme === 'onde' ? 11 : theme === 'couronne' ? 23 : theme === 'aube' ? 37 : 53);

    if(theme === 'couronne'){
      let rayons = '';
      for(let k = 0; k < 22; k++){
        const [x1, y1] = polaire(105, 134, 420, k * 360 / 22), [x2, y2] = polaire(105, 134, 420, k * 360 / 22 + 8);
        rayons += `<path d="M105 134L${arr(x1)} ${arr(y1)}L${arr(x2)} ${arr(y2)}Z"/>`;
      }
      let feuilles = '';
      [[1, 1], [-1, 1]].forEach(([sens]) => {
        for(let k = 0; k < 7; k++){
          const t = k / 6;
          const x = 105 + sens * (66 - 26 * t + 0), y = 292 - 118 * t;
          feuilles += `<ellipse cx="${arr(x + sens * 6)}" cy="${arr(y)}" rx="9" ry="3.6" transform="rotate(${sens * (-40 - 8 * k)} ${arr(x + sens * 6)} ${arr(y)})" fill="url(#o)" opacity="${arr(.95 - t * .35)}"/>`;
          feuilles += `<ellipse cx="${arr(x - sens * 2)}" cy="${arr(y - 6)}" rx="7" ry="2.8" transform="rotate(${sens * (-110 - 6 * k)} ${arr(x - sens * 2)} ${arr(y - 6)})" fill="url(#o)" opacity="${arr(.8 - t * .3)}"/>`;
        }
      });
      let etoiles = '';
      for(let k = 0; k < 16; k++) etoiles += etincelle(arr(10 + rnd() * 190), arr(10 + rnd() * 298), arr(1.4 + rnd() * 2.6), '#fff1bd', arr(.35 + rnd() * .5));
      return tete + `<defs>
        <linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#46300a"/><stop offset=".5" stop-color="#160f03"/><stop offset="1" stop-color="#2b1b05"/></linearGradient>
        <radialGradient id="h" cx=".5" cy=".42" r=".62"><stop offset="0" stop-color="#ffd25a" stop-opacity=".7"/><stop offset="1" stop-color="#ffd25a" stop-opacity="0"/></radialGradient>
        <linearGradient id="o" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff0b8"/><stop offset=".5" stop-color="#e9ae3c"/><stop offset="1" stop-color="#a86a0c"/></linearGradient>
        <linearGradient id="v" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".6"/></linearGradient>
      </defs>
      <rect width="210" height="318" fill="url(#g)"/><rect width="210" height="318" fill="url(#h)"/>
      <g fill="#ffd36b" opacity=".11">${rayons}</g>
      <g fill="none" stroke="url(#o)" stroke-width="1.6" stroke-linecap="round" opacity=".85"><path d="M39 292C28 250 40 205 72 172"/><path d="M171 292C182 250 170 205 138 172"/></g>
      ${feuilles}${etoiles}
      <rect y="228" width="210" height="90" fill="url(#v)"/>
      <rect x="6" y="6" width="198" height="306" rx="9" fill="none" stroke="url(#o)" stroke-width="1.2" opacity=".55"/>
      </svg>`;
    }

    if(theme === 'aube'){
      let etoiles = '', grille = '';
      for(let k = 0; k < 22; k++) etoiles += `<circle cx="${arr(rnd() * 210)}" cy="${arr(rnd() * 120)}" r="${arr(.5 + rnd() * 1.1)}" fill="#fff" opacity="${arr(.35 + rnd() * .5)}"/>`;
      [226, 238, 252, 268, 288, 312].forEach((y) => { grille += `<path d="M0 ${y}H210"/>`; });
      for(let k = -6; k <= 6; k++) grille += `<path d="M105 214L${105 + k * 44} 318"/>`;
      let fentes = '';
      [[160, 3], [172, 4], [184, 5], [196, 6], [207, 7]].forEach(([y, h]) => { fentes += `<rect x="30" y="${y}" width="150" height="${h}" fill="#000"/>`; });
      return tete + `<defs>
        <linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#220a48"/><stop offset=".34" stop-color="#6b1773"/><stop offset=".6" stop-color="#e03a7e"/><stop offset=".69" stop-color="#ff9a52"/><stop offset=".694" stop-color="#1a0836"/><stop offset="1" stop-color="#0c0420"/></linearGradient>
        <linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe56b"/><stop offset=".55" stop-color="#ff8f5a"/><stop offset="1" stop-color="#ff3d94"/></linearGradient>
        <radialGradient id="h" cx=".5" cy=".47" r=".6"><stop offset="0" stop-color="#ff6fa8" stop-opacity=".65"/><stop offset="1" stop-color="#ff6fa8" stop-opacity="0"/></radialGradient>
        <mask id="m"><rect width="210" height="318" fill="#fff"/>${fentes}</mask>
      </defs>
      <rect width="210" height="318" fill="url(#g)"/><rect width="210" height="318" fill="url(#h)"/>
      ${etoiles}
      <circle cx="105" cy="146" r="70" fill="url(#s)" mask="url(#m)"/>
      <g fill="none" stroke="#ff6fa8" stroke-opacity=".38" stroke-width="1">${grille}</g>
      <path d="M0 214H210" stroke="#ffd0a0" stroke-opacity=".7" stroke-width="1.4"/>
      <path d="M0 258C30 246 55 270 100 256S178 246 210 258" fill="none" stroke="#ff9fcb" stroke-opacity=".5" stroke-width="1.3"/>
      <path d="M0 284C34 272 64 296 108 282S184 274 210 284" fill="none" stroke="#c58bff" stroke-opacity=".45" stroke-width="1.3"/>
      </svg>`;
    }

    if(theme === 'glace'){
      let neige = '', eclats = '';
      for(let k = 0; k < 38; k++) neige += `<circle cx="${arr(rnd() * 210)}" cy="${arr(rnd() * 318)}" r="${arr(.6 + rnd() * 1.8)}" fill="#fff" opacity="${arr(.3 + rnd() * .6)}"/>`;
      [[0, 318, 28, 238, 56, 318], [40, 318, 70, 214, 104, 318], [92, 318, 124, 232, 150, 318], [140, 318, 170, 222, 196, 318], [176, 318, 200, 258, 214, 318]].forEach(([x1, y1, x2, y2, x3, y3]) => {
        eclats += `<path d="M${x1} ${y1}L${x2} ${y2}L${x3} ${y3}Z" fill="url(#c)"/><path d="M${x2} ${y2}L${x2 + 6} ${y3}" stroke="#fff" stroke-opacity=".5" stroke-width="1"/>`;
      });
      return tete + `<defs>
        <linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0b2d52"/><stop offset=".5" stop-color="#0f5c92"/><stop offset="1" stop-color="#06182e"/></linearGradient>
        <radialGradient id="h" cx=".5" cy=".42" r=".6"><stop offset="0" stop-color="#d4f0ff" stop-opacity=".65"/><stop offset="1" stop-color="#d4f0ff" stop-opacity="0"/></radialGradient>
        <linearGradient id="a" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#5cffd0" stop-opacity="0"/><stop offset=".5" stop-color="#7cf0ff" stop-opacity=".5"/><stop offset="1" stop-color="#9f8cff" stop-opacity="0"/></linearGradient>
        <linearGradient id="c" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#eaf8ff" stop-opacity=".95"/><stop offset=".6" stop-color="#7cc6ef" stop-opacity=".8"/><stop offset="1" stop-color="#2c78b0" stop-opacity=".9"/></linearGradient>
      </defs>
      <rect width="210" height="318" fill="url(#g)"/><rect width="210" height="318" fill="url(#h)"/>
      <path d="M0 40C50 10 100 70 150 34S200 20 210 30V70C170 96 120 40 70 78S20 70 0 80Z" fill="url(#a)"/>
      <path d="M0 78C60 48 110 108 160 70S200 62 210 70V96C170 124 120 76 70 110S20 104 0 112Z" fill="url(#a)" opacity=".6"/>
      ${flocon(105, 150, 92, 1.4)}
      ${neige}
      <path d="M0 262C36 250 64 274 104 262S176 250 210 264V318H0Z" fill="#cfeaff" opacity=".28"/>
      ${eclats}
      <rect x="6" y="6" width="198" height="306" rx="9" fill="none" stroke="#e8f6ff" stroke-width="1.2" opacity=".5"/>
      </svg>`;
    }

    if(theme === 'deferlante'){
      let gouttes = '', etoiles = '';
      for(let k = 0; k < 34; k++) gouttes += `<circle cx="${arr(92 + rnd() * 118)}" cy="${arr(50 + rnd() * 150)}" r="${arr(.6 + rnd() * 2)}" fill="#e8fbff" opacity="${arr(.3 + rnd() * .6)}"/>`;
      for(let k = 0; k < 18; k++) etoiles += `<circle cx="${arr(rnd() * 210)}" cy="${arr(rnd() * 120)}" r="${arr(.4 + rnd() * 1)}" fill="#cfeeff" opacity="${arr(.3 + rnd() * .5)}"/>`;
      return tete + `<defs>
        <linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#020f24"/><stop offset=".5" stop-color="#05395f"/><stop offset="1" stop-color="#021c33"/></linearGradient>
        <radialGradient id="h" cx=".75" cy=".14" r=".5"><stop offset="0" stop-color="#7fe8ff" stop-opacity=".75"/><stop offset="1" stop-color="#7fe8ff" stop-opacity="0"/></radialGradient>
        <linearGradient id="w" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0a6e9a"/><stop offset=".55" stop-color="#1fb5d8"/><stop offset="1" stop-color="#7ff0ff"/></linearGradient>
        <linearGradient id="w2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#074a72"/><stop offset="1" stop-color="#021b33"/></linearGradient>
      </defs>
      <rect width="210" height="318" fill="url(#g)"/><rect width="210" height="318" fill="url(#h)"/>
      ${etoiles}
      <circle cx="160" cy="48" r="17" fill="#e9fdff" opacity=".9"/>
      <path d="M-4 250C8 170 70 90 150 92C196 94 214 128 208 168C196 146 172 138 152 148C162 174 156 206 128 224C96 244 60 250 32 318H-4Z" fill="url(#w)"/>
      <path d="M-4 250C8 170 70 90 150 92C196 94 214 128 208 168C196 146 172 138 152 148" fill="none" stroke="#f2feff" stroke-width="3" stroke-linecap="round" opacity=".9"/>
      <path d="M40 232C56 176 100 128 150 122C176 120 192 132 194 150" fill="none" stroke="#dffaff" stroke-width="1.4" opacity=".45"/>
      <path d="M14 270C34 226 74 196 118 198" fill="none" stroke="#dffaff" stroke-width="1.2" opacity=".35"/>
      ${gouttes}
      <path d="M0 278C40 262 80 292 122 274S190 262 210 278V318H0Z" fill="url(#w2)" opacity=".95"/>
      <path d="M0 278C40 262 80 292 122 274S190 262 210 278" fill="none" stroke="#9ff3ff" stroke-width="1.6" opacity=".7"/>
      <rect x="6" y="6" width="198" height="306" rx="9" fill="none" stroke="#9ff3ff" stroke-width="1" opacity=".35"/>
      </svg>`;
    }

    if(theme === 'garanti'){
      let etoiles = '';
      for(let k = 0; k < 14; k++) etoiles += etincelle(arr(10 + rnd() * 190), arr(10 + rnd() * 298), arr(1.6 + rnd() * 2.4), '#ffe9a8', arr(.35 + rnd() * .5));
      return tete + `<defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5b2a8a"/><stop offset=".5" stop-color="#2a1250"/><stop offset="1" stop-color="#3a1636"/></linearGradient>
        <radialGradient id="h" cx=".25" cy=".18" r=".7"><stop offset="0" stop-color="#ffd778" stop-opacity=".85"/><stop offset="1" stop-color="#ffd778" stop-opacity="0"/></radialGradient>
        <radialGradient id="i" cx=".85" cy=".85" r=".65"><stop offset="0" stop-color="#c85aff" stop-opacity=".8"/><stop offset="1" stop-color="#c85aff" stop-opacity="0"/></radialGradient>
      </defs>
      <rect width="210" height="318" fill="url(#g)"/><rect width="210" height="318" fill="url(#h)"/><rect width="210" height="318" fill="url(#i)"/>
      <g fill="none" stroke="#ffe0a0" stroke-opacity=".3"><circle cx="105" cy="150" r="52"/><circle cx="105" cy="150" r="78" stroke-opacity=".18"/><circle cx="105" cy="150" r="104" stroke-opacity=".1"/></g>
      ${etoiles}</svg>`;
    }

    // onde : la scène, ses projecteurs, ses ondes sonores et la mer de vagues
    let etoiles = '';
    for(let k = 0; k < 26; k++) etoiles += `<circle cx="${arr(rnd() * 210)}" cy="${arr(rnd() * 318)}" r="${arr(.4 + rnd() * 1.1)}" fill="#cfeeff" opacity="${arr(.25 + rnd() * .55)}"/>`;
    return tete + `<defs>
      <linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0f4a86"/><stop offset=".5" stop-color="#0a2347"/><stop offset="1" stop-color="#150f3a"/></linearGradient>
      <radialGradient id="h" cx=".3" cy=".16" r=".7"><stop offset="0" stop-color="#6fd0ff" stop-opacity=".9"/><stop offset="1" stop-color="#6fd0ff" stop-opacity="0"/></radialGradient>
      <radialGradient id="i" cx=".85" cy=".9" r=".6"><stop offset="0" stop-color="#8a5bff" stop-opacity=".8"/><stop offset="1" stop-color="#8a5bff" stop-opacity="0"/></radialGradient>
      <linearGradient id="b" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#4fb4ff"/><stop offset="1" stop-color="#b48cff"/></linearGradient>
      <linearGradient id="f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".3"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
    </defs>
    <rect width="210" height="318" fill="url(#g)"/><rect width="210" height="318" fill="url(#h)"/><rect width="210" height="318" fill="url(#i)"/>
    ${etoiles}
    <path d="M30 0L-14 214H92Z" fill="url(#f)"/><path d="M184 0L116 222H232Z" fill="url(#f)" opacity=".65"/>
    <g fill="none" stroke="#9fe0ff"><circle cx="105" cy="150" r="48" stroke-opacity=".38"/><circle cx="105" cy="150" r="68" stroke-opacity=".24"/><circle cx="105" cy="150" r="90" stroke-opacity=".13"/></g>
    <path d="M0 232C30 214 60 250 105 232S180 214 210 232V318H0Z" fill="url(#b)" opacity=".5"/>
    <path d="M0 252C40 236 70 268 112 250S185 238 210 252V318H0Z" fill="#0b1e44" opacity=".88"/>
    <path d="M0 252C40 236 70 268 112 250S185 238 210 252" fill="none" stroke="#9fe0ff" stroke-opacity=".65" stroke-width="1.4"/>
    <path d="M0 278C45 264 80 290 120 276S190 266 210 278V318H0Z" fill="#070f26" opacity=".92"/>
    <path d="M0 278C45 264 80 290 120 276S190 266 210 278" fill="none" stroke="#b48cff" stroke-opacity=".5" stroke-width="1.2"/>
    </svg>`;
  }

  // L'emblème de chaque thème (le même trait que l'emblème de la marque).
  const EMBLEMES = {
    onde: EMBLEME,
    couronne: `<svg class="ct-embleme" viewBox="0 0 100 100" aria-hidden="true">
      <circle cx="50" cy="50" r="46" fill="none" stroke="currentColor" stroke-width="2" opacity=".55"/>
      <circle cx="50" cy="50" r="36" fill="none" stroke="currentColor" stroke-width="1" opacity=".3"/>
      <path d="M25 66 21 36l15 12 14-20 14 20 15-12-4 30z" fill="none" stroke="currentColor" stroke-width="3.6" stroke-linejoin="round"/>
      <path d="M27 74h46" stroke="currentColor" stroke-width="3.6" stroke-linecap="round"/>
      <circle cx="21" cy="34" r="3" fill="currentColor"/><circle cx="50" cy="26" r="3" fill="currentColor"/><circle cx="79" cy="34" r="3" fill="currentColor"/>
    </svg>`,
    aube: `<svg class="ct-embleme" viewBox="0 0 100 100" aria-hidden="true">
      <circle cx="50" cy="50" r="46" fill="none" stroke="currentColor" stroke-width="2" opacity=".55"/>
      <circle cx="50" cy="50" r="36" fill="none" stroke="currentColor" stroke-width="1" opacity=".3"/>
      <path d="M26 58a24 24 0 0 1 48 0" fill="none" stroke="currentColor" stroke-width="3.6" stroke-linecap="round"/>
      <path d="M50 22v8M26 32l6 6M74 32l-6 6M16 48h8M76 48h8" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
      <path d="M18 66c8 0 8-6 16-6s8 6 16 6 8-6 16-6 8 6 16 6M26 76c6 0 6-4 12-4s6 4 12 4 6-4 12-4 6 4 12 4" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
    </svg>`
  };
  EMBLEMES.garanti = EMBLEMES.couronne;
  EMBLEMES.glace = `<svg class="ct-embleme" viewBox="0 0 100 100" aria-hidden="true">
      <circle cx="50" cy="50" r="46" fill="none" stroke="currentColor" stroke-width="2" opacity=".55"/>
      <circle cx="50" cy="50" r="36" fill="none" stroke="currentColor" stroke-width="1" opacity=".3"/>
      <g fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round">${[0, 60, 120, 180, 240, 300].map((a) => {
        const p = (r, d) => polaire(50, 50, r, d).map(arr).join(' ');
        return `<path d="M50 50L${p(27, a)}M${p(15, a)}L${p(23, a - 50)}M${p(15, a)}L${p(23, a + 50)}"/>`;
      }).join('')}</g>
    </svg>`;
  EMBLEMES.deferlante = `<svg class="ct-embleme" viewBox="0 0 100 100" aria-hidden="true">
      <circle cx="50" cy="50" r="46" fill="none" stroke="currentColor" stroke-width="2" opacity=".55"/>
      <circle cx="50" cy="50" r="36" fill="none" stroke="currentColor" stroke-width="1" opacity=".3"/>
      <path d="M22 66C26 38 52 26 70 36C80 42 78 58 66 58C56 58 55 46 63 44" fill="none" stroke="currentColor" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M20 72c8 0 8-5 15-5s8 5 15 5 8-5 15-5 8 5 15 5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
    </svg>`;

  const THEMES = ['onde', 'couronne', 'aube', 'garanti', 'glace', 'deferlante'];
  const theme = (t) => THEMES.indexOf(t) >= 0 ? t : 'onde';
  const couleurOk = (c) => /^#[0-9a-f]{3,8}$/i.test(String(c || '')) ? c : '#4FB4FF';

  const PACKS_CSS = THEMES.map((t) => `.ct-pack.t-${t}{--pk-fond:${svgUri(artPack(t))};}`).join('\n  ');

  // Le fond d'une carte (250 × 350) : un décor par rareté, visible autour de la fenêtre et sous la plaque.
  function fondCarte(r){
    const tete = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 250 350" preserveAspectRatio="none">';
    const rnd = alea(100 + r);
    if(r === 1 || r === 2){
      const c = r === 1 ? '#ffffff' : '#7cc8ff';
      let v = '';
      for(let k = 0; k < 11; k++){ const y = 214 + k * 13; v += `<path d="M-6 ${y}q31 -13 62 0t62 0t62 0t62 0t62 0" opacity="${arr(.06 + k * .006)}"/>`; }
      let p = '';
      if(r === 2) for(let k = 0; k < 14; k++) p += `<circle cx="${arr(rnd() * 250)}" cy="${arr(rnd() * 350)}" r="${arr(.8 + rnd() * 1.6)}" fill="${c}" opacity="${arr(.18 + rnd() * .3)}"/>`;
      return tete + `<g fill="none" stroke="${c}" stroke-width="1.6">${v}</g>${p}</svg>`;
    }
    if(r === 3){
      let e = '';
      for(let k = 0; k < 46; k++) e += `<circle cx="${arr(rnd() * 250)}" cy="${arr(rnd() * 350)}" r="${arr(.5 + rnd() * 1.4)}" fill="#e6d4ff" opacity="${arr(.2 + rnd() * .6)}"/>`;
      for(let k = 0; k < 5; k++) e += etincelle(arr(15 + rnd() * 220), arr(15 + rnd() * 320), arr(3 + rnd() * 4), '#f0e4ff', .8);
      return tete + `<defs><radialGradient id="n" cx=".5" cy=".4" r=".7"><stop offset="0" stop-color="#8a5bff" stop-opacity=".45"/><stop offset="1" stop-color="#8a5bff" stop-opacity="0"/></radialGradient></defs><rect width="250" height="350" fill="url(#n)"/>${e}</svg>`;
    }
    if(r === 4){
      let rayons = '';
      for(let k = 0; k < 20; k++){
        const [x1, y1] = polaire(125, 130, 420, k * 18), [x2, y2] = polaire(125, 130, 420, k * 18 + 7);
        rayons += `<path d="M125 130L${arr(x1)} ${arr(y1)}L${arr(x2)} ${arr(y2)}Z"/>`;
      }
      let e = '';
      for(let k = 0; k < 7; k++) e += etincelle(arr(12 + rnd() * 226), arr(12 + rnd() * 326), arr(2.5 + rnd() * 3.5), '#fff1bd', arr(.5 + rnd() * .4));
      return tete + `<defs><radialGradient id="n" cx=".5" cy=".37" r=".65"><stop offset="0" stop-color="#ffcf5a" stop-opacity=".55"/><stop offset="1" stop-color="#ffcf5a" stop-opacity="0"/></radialGradient></defs><rect width="250" height="350" fill="url(#n)"/><g fill="#ffd36b" opacity=".13">${rayons}</g>${e}</svg>`;
    }
    let e = '';
    for(let k = 0; k < 9; k++) e += etincelle(arr(12 + rnd() * 226), arr(12 + rnd() * 326), arr(2.5 + rnd() * 4), '#ffffff', arr(.5 + rnd() * .45));
    return tete + `<defs>
      <filter id="f" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="22"/></filter>
    </defs>
    <g filter="url(#f)" opacity=".7"><ellipse cx="40" cy="60" rx="80" ry="60" fill="#ff5c8a"/><ellipse cx="220" cy="120" rx="70" ry="70" fill="#5cb8ff"/><ellipse cx="60" cy="250" rx="80" ry="60" fill="#5cffc8"/><ellipse cx="210" cy="300" rx="80" ry="60" fill="#b36bff"/><ellipse cx="125" cy="170" rx="70" ry="50" fill="#ffd25c"/></g>${e}</svg>`;
  }

  // Les cadres : des ornements aux quatre coins de la fenêtre (x 11–239, y 30–230), plus ou moins riches selon la rareté.
  const coins = (d) =>
    `<path d="${d}"/><path d="${d}" transform="translate(250 0) scale(-1 1)"/><path d="${d}" transform="translate(0 260) scale(1 -1)"/><path d="${d}" transform="translate(250 260) scale(-1 -1)"/>`;
  const losange = (x, y, r) => `<path d="M${x} ${y - r}l${r} ${r}-${r} ${r}-${r}-${r}z"/>`;

  const SPRITE = `<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs>
    <linearGradient id="ct-or" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="250" y2="350"><stop offset="0" stop-color="#fff3c4"/><stop offset=".5" stop-color="#eab645"/><stop offset="1" stop-color="#b9780f"/></linearGradient>
    <linearGradient id="ct-arc" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="250" y2="350"><stop offset="0" stop-color="#ff5c8a"/><stop offset=".25" stop-color="#ffd25c"/><stop offset=".5" stop-color="#5cffc8"/><stop offset=".75" stop-color="#5cb8ff"/><stop offset="1" stop-color="#b36bff"/></linearGradient>
    <symbol id="ct-orn-1" viewBox="0 0 250 350" preserveAspectRatio="none">
      <rect x="11" y="30" width="228" height="200" rx="6" fill="none" stroke="currentColor" stroke-width="1.4" opacity=".85"/>
      <path d="M11 240H239" stroke="currentColor" stroke-width="1" opacity=".35"/>
      <g fill="none" stroke="currentColor" stroke-width="1.4" opacity=".6" stroke-linecap="round">${coins('M6 40V31a5 5 0 0 1 5-5H20')}</g>
    </symbol>
    <symbol id="ct-orn-2" viewBox="0 0 250 350" preserveAspectRatio="none">
      <rect x="11" y="30" width="228" height="200" rx="6" fill="none" stroke="currentColor" stroke-width="1.4" opacity=".9"/>
      <rect x="7" y="26" width="236" height="208" rx="9" fill="none" stroke="currentColor" stroke-width=".8" opacity=".45"/>
      <path d="M11 240H239" stroke="currentColor" stroke-width="1" opacity=".4"/>
      <g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">${coins('M4 46V30a6 6 0 0 1 6-6H27')}</g>
      <g fill="currentColor">${losange(125, 240, 3)}</g>
    </symbol>
    <symbol id="ct-orn-3" viewBox="0 0 250 350" preserveAspectRatio="none">
      <rect x="11" y="30" width="228" height="200" rx="6" fill="none" stroke="currentColor" stroke-width="1.6"/>
      <rect x="7" y="26" width="236" height="208" rx="9" fill="none" stroke="currentColor" stroke-width=".8" opacity=".5"/>
      <path d="M11 240H110M140 240H239" stroke="currentColor" stroke-width="1.2" opacity=".5"/>
      <g fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">${coins('M3 52V30a7 7 0 0 1 7-7H32M12 44V36a3 3 0 0 1 3-3H24')}</g>
      <g fill="currentColor">${losange(125, 30, 6)}${losange(125, 240, 5)}${losange(11, 130, 4)}${losange(239, 130, 4)}${coins('M10 26l4 4-4 4-4-4z')}</g>
    </symbol>
    <symbol id="ct-orn-4" viewBox="0 0 250 350" preserveAspectRatio="none">
      <rect x="11" y="30" width="228" height="200" rx="6" fill="none" stroke="url(#ct-or)" stroke-width="2"/>
      <rect x="7" y="26" width="236" height="208" rx="9" fill="none" stroke="url(#ct-or)" stroke-width=".9" opacity=".6"/>
      <path d="M11 240H104M146 240H239" stroke="url(#ct-or)" stroke-width="1.4" opacity=".7"/>
      <g fill="none" stroke="url(#ct-or)" stroke-width="2.4" stroke-linecap="round">${coins('M3 58C3 38 12 24 36 22M11 50C11 40 17 32 31 31')}</g>
      <g fill="url(#ct-or)">${coins('M8 28l5 5-5 5-5-5z')}${losange(125, 240, 6)}${losange(11, 130, 5)}${losange(239, 130, 5)}
        <path d="M95 30 101 14l11 10 13-16 13 16 11-10 6 16z" stroke="url(#ct-or)" stroke-width="1.4" stroke-linejoin="round"/></g>
    </symbol>
    <symbol id="ct-orn-5" viewBox="0 0 250 350" preserveAspectRatio="none">
      <rect x="11" y="30" width="228" height="200" rx="6" fill="none" stroke="url(#ct-arc)" stroke-width="2.4"/>
      <rect x="7" y="26" width="236" height="208" rx="9" fill="none" stroke="url(#ct-arc)" stroke-width="1" opacity=".7"/>
      <path d="M11 240H104M146 240H239" stroke="url(#ct-arc)" stroke-width="1.6" opacity=".8"/>
      <g fill="none" stroke="url(#ct-arc)" stroke-width="2.6" stroke-linecap="round">${coins('M3 58C3 38 12 24 36 22M11 50C11 40 17 32 31 31')}</g>
      <g fill="url(#ct-arc)">${coins('M8 28l5 5-5 5-5-5z')}${losange(125, 240, 6)}${losange(11, 130, 5)}${losange(239, 130, 5)}
        <path d="M95 30 101 12l11 10 13-18 13 18 11-10 6 18z" stroke="url(#ct-arc)" stroke-width="1.4" stroke-linejoin="round"/></g>
      <g fill="#fff">${etincelle(34, 12, 6, '#fff', 1)}${etincelle(216, 12, 6, '#fff', 1)}${etincelle(125, 338, 5, '#fff', .9)}</g>
    </symbol>
  </defs></svg>`;

  const MOTIFS_CSS = [1, 2, 3, 4, 5].map((r) => `.ct-carte.r${r}{--ct-motif:${svgUri(fondCarte(r))};}`).join('\n  ');

  // Les classeurs de collection : un fond et un cadre à eux (les Légendaires et Mythiques gardent leurs rayons et leur aurore).
  const NOM_CLASSEUR = { glaciale: 'VAGUE GLACIALE', deferlante: 'VAGUE DÉFERLANTE' };

  function fondClasseur(id){
    const tete = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 250 350" preserveAspectRatio="none">';
    const rnd = alea(id === 'glaciale' ? 7 : 9);
    if(id === 'glaciale'){
      let n = '';
      for(let k = 0; k < 50; k++) n += `<circle cx="${arr(rnd() * 250)}" cy="${arr(rnd() * 350)}" r="${arr(.6 + rnd() * 1.6)}" fill="#fff" opacity="${arr(.25 + rnd() * .55)}"/>`;
      return tete + `<defs><linearGradient id="n" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7cc6ef" stop-opacity=".18"/><stop offset="1" stop-color="#e6f6ff" stop-opacity=".3"/></linearGradient></defs>
        <rect width="250" height="350" fill="url(#n)"/>${flocon(125, 130, 150, 1.6)}${flocon(40, 300, 46, 1.4)}${flocon(214, 292, 38, 1.4)}${n}</svg>`;
    }
    let v = '';
    for(let k = 0; k < 11; k++){ const y = 200 + k * 14; v += `<path d="M-6 ${y}q31 -16 62 0t62 0t62 0t62 0t62 0" opacity="${arr(.1 + k * .012)}"/>`; }
    let e = '';
    for(let k = 0; k < 30; k++) e += `<circle cx="${arr(rnd() * 250)}" cy="${arr(rnd() * 350)}" r="${arr(.6 + rnd() * 1.5)}" fill="#e8fbff" opacity="${arr(.2 + rnd() * .45)}"/>`;
    return tete + `<defs><linearGradient id="n" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1fb5d8" stop-opacity=".06"/><stop offset="1" stop-color="#1fb5d8" stop-opacity=".3"/></linearGradient></defs>
      <rect width="250" height="350" fill="url(#n)"/><g fill="none" stroke="#9ff3ff" stroke-width="1.8">${v}</g>${e}</svg>`;
  }

  const CLASSEURS_CSS = `
  .ct-carte.cl-glaciale:is(.r1, .r2, .r3){--ct-motif:${svgUri(fondClasseur('glaciale'))};}
  .ct-carte.cl-glaciale:is(.r1, .r2, .r3, .r4){--ct-cadre:linear-gradient(155deg, #ffffff, #bfe6ff 35%, #6fb7e8 70%, #eaf8ff);}
  .ct-carte.cl-glaciale{--rf:#0a1b30;}
  .ct-carte.cl-glaciale .ct-c-in::before{content:''; position:absolute; inset:0; z-index:1; pointer-events:none; mix-blend-mode:screen;
    background:radial-gradient(60% 38% at 0% 0%, rgba(255,255,255,.4), transparent 70%), radial-gradient(60% 38% at 100% 100%, rgba(190,230,255,.34), transparent 70%);}
  .ct-carte.cl-deferlante:is(.r1, .r2, .r3){--ct-motif:${svgUri(fondClasseur('deferlante'))};}
  .ct-carte.cl-deferlante:is(.r1, .r2, .r3, .r4){--ct-cadre:linear-gradient(155deg, #b6f7ff, #1fb5d8 38%, #07507c 74%, #7fe6f7);}
  .ct-carte.cl-deferlante{--rf:#04182c;}`;

  // ---------------------------------------------------------------------
  // La feuille de style
  // ---------------------------------------------------------------------

  const STYLE = `
  @property --ct-a{syntax:'<angle>'; inherits:false; initial-value:0deg;}

  .ct, .ct-scene, .ct-voile{
    --r1:#B4BDC8; --r2:#4FB4FF; --r3:#A879FF; --r4:#F2C14E; --r5:#FF5C8A;
    --ct-surface:rgba(255,255,255,.04); --ct-surface-2:rgba(255,255,255,.07);
    --ct-trait:rgba(255,255,255,.08); --ct-trait-fort:rgba(255,255,255,.15);
    --ct-accent:#4FB4FF; --ct-accent-fonce:#1489DE; --ct-ok:#5BE0A6;
  }
  .ct *, .ct-scene *, .ct-voile *{box-sizing:border-box;}
  .ct button, .ct-scene button, .ct-voile button{font:inherit;}
  .ct{max-width:1120px; margin:0 auto; padding:0 16px 72px; color:var(--ink);}
  .ct-ico{flex:none; display:block;}

  /* ---------- boutons ---------- */
  .ct-btn{all:unset; box-sizing:border-box; cursor:pointer; display:inline-flex; align-items:center; justify-content:center; gap:8px; min-height:42px; padding:0 18px; border-radius:12px; font-size:14px; font-weight:600; color:var(--ink); background:var(--ct-surface-2); border:1px solid var(--ct-trait-fort); transition:background .15s, border-color .15s, transform .15s, opacity .15s; white-space:nowrap;}
  .ct-btn:hover{background:rgba(255,255,255,.11);}
  .ct-btn:active{transform:scale(.98);}
  .ct-btn:focus-visible{outline:2px solid var(--ct-accent); outline-offset:2px;}
  .ct-btn.principal{color:#fff; background:linear-gradient(180deg, #2C9BEF, #1478C9); border-color:rgba(255,255,255,.18); box-shadow:0 8px 24px -10px rgba(20,137,222,.9), inset 0 1px 0 rgba(255,255,255,.25);}
  .ct-btn.principal:hover{background:linear-gradient(180deg, #3AA6F5, #1A83D6);}
  .ct-btn.blanc{color:#05070a; background:#F4F5F6; border-color:#F4F5F6;}
  .ct-btn.blanc:hover{background:#fff;}
  .ct-btn.petit{min-height:34px; padding:0 13px; font-size:13px; border-radius:10px;}
  .ct-btn.grand{min-height:50px; padding:0 24px; font-size:15px; border-radius:14px;}
  .ct-btn[disabled]{opacity:.4; cursor:default; transform:none; box-shadow:none;}
  .ct-btn .cout{display:inline-flex; align-items:center; gap:3px; margin-left:2px; padding:3px 7px 3px 5px; border-radius:7px; font-size:12px; background:rgba(0,0,0,.22);}
  .ct-btn-ico{all:unset; box-sizing:border-box; cursor:pointer; width:38px; height:38px; display:grid; place-items:center; border-radius:11px; color:var(--ink-soft); border:1px solid var(--ct-trait); background:var(--ct-surface);}
  .ct-btn-ico:hover{color:var(--ink); background:var(--ct-surface-2);}
  .ct-btn-ico:focus-visible{outline:2px solid var(--ct-accent); outline-offset:2px;}

  /* ---------- panneaux ---------- */
  .ct-panneau{position:relative; border-radius:20px; border:1px solid var(--ct-trait); background:linear-gradient(180deg, rgba(255,255,255,.045), rgba(255,255,255,.02)); padding:20px;}
  .ct-panneau h3{margin:0; font-size:15px; font-weight:700; letter-spacing:-.005em;}
  .ct-panneau .sous{margin:4px 0 0; font-size:13px; color:var(--muted); line-height:1.5;}
  .ct-entete-panneau{display:flex; align-items:flex-start; justify-content:space-between; gap:12px; margin-bottom:16px;}
  .ct-puce-temps{display:inline-flex; align-items:center; gap:6px; padding:5px 10px; border-radius:99px; font-size:12px; color:var(--ink-soft); background:var(--ct-surface-2); white-space:nowrap; font-variant-numeric:tabular-nums;}
  .ct-vide{padding:48px 16px; text-align:center; color:var(--muted); font-size:14px; line-height:1.6;}
  .ct-vide b{display:block; margin-bottom:6px; font-size:17px; color:var(--ink);}
  .ct-titre-sec{display:flex; align-items:baseline; justify-content:space-between; gap:12px; margin:28px 0 12px;}
  .ct-titre-sec h3{margin:0; font-size:13px; font-weight:600; letter-spacing:.1em; text-transform:uppercase; color:var(--muted);}
  .ct-lien{all:unset; cursor:pointer; font-size:13px; color:var(--ct-accent); display:inline-flex; align-items:center; gap:4px;}
  .ct-lien:hover{text-decoration:underline;}
  .ct-barre{position:relative; display:block; height:6px; border-radius:99px; background:rgba(255,255,255,.08); overflow:hidden;}
  .ct-barre i{position:absolute; inset:0 auto 0 0; border-radius:99px; background:linear-gradient(90deg, var(--ct-accent-fonce), var(--ct-accent)); transition:width .6s cubic-bezier(.2,.8,.2,1);}
  .ct-barre.or i{background:linear-gradient(90deg, #d79a2b, #F2C14E);}

  /* ---------- en-tête du joueur ---------- */
  .ct-tete{display:flex; align-items:center; gap:14px; padding:12px 12px 12px 14px; border-radius:20px; border:1px solid var(--ct-trait); background:rgba(255,255,255,.035); backdrop-filter:blur(18px); -webkit-backdrop-filter:blur(18px);}
  .ct-niv{position:relative; width:46px; height:46px; flex:none;}
  .ct-niv svg{width:100%; height:100%; transform:rotate(-90deg);}
  .ct-niv b{position:absolute; inset:0; display:grid; place-items:center; font-size:16px; font-weight:800;}
  .ct-qui{min-width:0; flex:1;}
  .ct-qui b{display:block; font-size:14px;}
  .ct-qui small{display:block; margin-top:2px; font-size:12px; color:var(--muted); font-variant-numeric:tabular-nums;}
  .ct-ress{display:flex; align-items:center; gap:8px; flex-wrap:wrap; justify-content:flex-end;}
  .ct-res{display:flex; align-items:center; gap:8px; height:38px; padding:0 12px; border-radius:11px; border:1px solid var(--ct-trait); background:var(--ct-surface); font-size:14px; font-weight:700; font-variant-numeric:tabular-nums; white-space:nowrap;}
  .ct-res .ct-ico{color:var(--ct-accent);}
  .ct-res.vinyles .ct-ico{color:#F2C14E;}
  .ct-res.garanti{cursor:pointer; color:inherit; font:inherit; font-weight:700; border-color:rgba(168,121,255,.45); background:rgba(168,121,255,.1);}
  .ct-res.garanti .ct-ico{color:var(--r3);}
  .ct-res small{font-size:11.5px; font-weight:500; color:var(--muted);}

  .ct-onglets{display:flex; gap:4px; margin:14px 0 22px; padding:4px; border-radius:14px; border:1px solid var(--ct-trait); background:rgba(255,255,255,.025); overflow-x:auto; scrollbar-width:none;}
  .ct-onglets::-webkit-scrollbar{display:none;}
  .ct-onglet{all:unset; box-sizing:border-box; cursor:pointer; flex:1 0 auto; display:inline-flex; align-items:center; justify-content:center; gap:8px; height:40px; padding:0 16px; border-radius:10px; font-size:14px; font-weight:600; color:var(--muted); transition:color .15s, background .15s;}
  .ct-onglet:hover{color:var(--ink);}
  .ct-onglet.actif{color:#05070a; background:#F4F5F6;}
  .ct-onglet:focus-visible{outline:2px solid var(--ct-accent); outline-offset:-2px;}
  .ct-pastille{min-width:18px; height:18px; padding:0 5px; border-radius:99px; display:inline-grid; place-items:center; font-size:11px; font-weight:700; color:#fff; background:var(--ct-accent-fonce);}

  /* ---------- la carte d'artiste ---------- */
  .ct-carte{position:relative; container-type:inline-size; aspect-ratio:5 / 7; border-radius:13px; padding:3px; color:#fff; text-align:left;
    background:var(--ct-cadre); box-shadow:0 14px 30px -14px rgba(0,0,0,.8); isolation:isolate; --rc:var(--r1); --rf:#10151d;}
  .ct-carte.r1{--rc:var(--r1); --rf:#10151d; --ct-cadre:linear-gradient(155deg, #eef1f5, #98a3b0 40%, #4b5563 78%, #b4bdc8);}
  .ct-carte.r2{--rc:var(--r2); --rf:#0a1a2e; --ct-cadre:linear-gradient(155deg, #c9ebff, #45a6f4 42%, #12549a 78%, #7fc6ff);}
  .ct-carte.r3{--rc:var(--r3); --rf:#150c2e; --ct-cadre:linear-gradient(155deg, #ecdcff, #9466f7 42%, #4b2399 78%, #c4a3ff);}
  .ct-carte.r4{--rc:var(--r4); --rf:#1d1507; --ct-cadre:linear-gradient(155deg, #fff6c9, #eab645 38%, #95600f 70%, #f9dc7e);}
  .ct-carte.r5{--rc:var(--r5); --rf:#190b1b; --ct-cadre:conic-gradient(from var(--ct-a), #ff5c8a, #ffb547, #fff27a, #5cffc8, #5cb8ff, #b36bff, #ff5c8a);}
  ${MOTIFS_CSS}
  ${CLASSEURS_CSS}
  .ct-c-in{position:relative; width:100%; height:100%; border-radius:10px; overflow:hidden; background:linear-gradient(180deg, color-mix(in srgb, var(--rc) 20%, var(--rf)) 0%, var(--rf) 58%);}
  .ct-c-fond{position:absolute; inset:0; background:var(--ct-motif) center / 100% 100% no-repeat;}
  .ct-c-art{position:absolute; left:4.4%; top:8.6%; width:91.2%; height:57.1%; border-radius:2.4cqw; overflow:hidden; background:#05070a;
    box-shadow:0 0 0 .5cqw color-mix(in srgb, var(--rc) 75%, #000), 0 0 0 1cqw rgba(0,0,0,.5), 0 2cqw 5cqw -1cqw rgba(0,0,0,.6);}
  .ct-c-photo{position:absolute; inset:0; width:100%; height:100%; max-width:none; object-fit:cover; object-position:50% 22%; display:block; transition:transform .5s cubic-bezier(.2,.8,.2,1);}
  .ct-c-teinte{position:absolute; inset:0; pointer-events:none; mix-blend-mode:soft-light; background:linear-gradient(180deg, transparent 30%, color-mix(in srgb, var(--rc) 70%, transparent) 100%);}
  .ct-c-motif{position:absolute; inset:0; pointer-events:none; mix-blend-mode:overlay; opacity:0;}
  .ct-carte.r3 .ct-c-motif{opacity:.5; background:radial-gradient(circle at 18% 24%, #fff 0 1px, transparent 1.6px), radial-gradient(circle at 76% 62%, #fff 0 1px, transparent 1.6px), radial-gradient(circle at 44% 84%, #fff 0 1px, transparent 1.6px), radial-gradient(120% 80% at 50% 110%, color-mix(in srgb, var(--rc) 80%, transparent), transparent 70%); background-size:26px 26px, 34px 34px, 19px 19px, 100% 100%;}
  .ct-carte.r4 .ct-c-motif{opacity:.6; background:repeating-conic-gradient(from 0deg at 50% 118%, rgba(255,226,140,.55) 0deg 5deg, transparent 5deg 15deg);}
  .ct-carte.r5 .ct-c-motif{opacity:.55; background:conic-gradient(from var(--ct-a) at 50% 50%, #ff5c8a, #ffd25c, #5cffc8, #5cb8ff, #b36bff, #ff5c8a); mix-blend-mode:color;}
  .ct-c-art::after{content:''; position:absolute; inset:0; pointer-events:none; background:radial-gradient(120% 100% at 50% 38%, transparent 52%, rgba(0,0,0,.5)), linear-gradient(180deg, transparent 68%, rgba(0,0,0,.6));}
  .ct-c-orn{position:absolute; inset:0; width:100%; height:100%; pointer-events:none; color:var(--rc); overflow:visible; filter:drop-shadow(0 0 1.4cqw color-mix(in srgb, var(--rc) 55%, transparent));}
  .ct-carte.r1 .ct-c-orn{filter:none;}
  .ct-c-num{position:absolute; top:1.9cqw; left:5cqw; height:6.4cqw; padding:0 2.6cqw; border-radius:99px; display:flex; align-items:center; font-size:max(7px, 4.8cqw); font-weight:800; letter-spacing:.04em; font-variant-numeric:tabular-nums; color:#fff; background:rgba(5,7,10,.55); border:1px solid color-mix(in srgb, var(--rc) 55%, transparent);}
  .ct-c-gemme{position:absolute; top:3.4cqw; right:7cqw; width:4.8cqw; height:4.8cqw; min-width:5px; min-height:5px; transform:rotate(45deg); border-radius:.9cqw; background:var(--rc); box-shadow:0 0 0 1px rgba(255,255,255,.75) inset, 0 0 10px var(--rc);}
  .ct-c-marque{position:absolute; top:2.2cqw; left:0; right:0; text-align:center; font-size:max(5px, 3.6cqw); font-weight:800; letter-spacing:.34em; text-indent:.34em; color:rgba(255,255,255,.5); pointer-events:none;}
  .ct-carte.r4 .ct-c-marque, .ct-carte.r5 .ct-c-marque{display:none;}
  .ct-c-plaque{position:absolute; left:4.4%; right:4.4%; top:69.4%; bottom:3.2%; display:flex; flex-direction:column; justify-content:space-between; gap:1.2cqw;}
  .ct-c-nom{font-size:calc(var(--nf, 1) * 11.4cqw); font-weight:800; line-height:1.1; letter-spacing:-.015em; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; text-shadow:0 2px 12px rgba(0,0,0,.6); padding-top:1.2cqw;}
  .ct-c-sous{margin-top:-.6cqw; font-size:max(6.5px, 4.9cqw); font-weight:600; letter-spacing:.03em; color:rgba(255,255,255,.62); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
  .ct-c-stats{display:grid; grid-template-columns:1fr 1fr 1.25fr; gap:1.8cqw;}
  .ct-c-stat{min-width:0; padding:1.9cqw .8cqw 1.7cqw; border-radius:2.2cqw; text-align:center; line-height:1.15; background:rgba(255,255,255,.07); border:1px solid rgba(255,255,255,.09);}
  .ct-c-stat b{display:block; font-size:max(7.5px, 6cqw); font-weight:800; font-variant-numeric:tabular-nums; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
  .ct-c-stat span{display:block; margin-top:.3cqw; font-size:max(5px, 3.4cqw); font-weight:700; letter-spacing:.14em; text-transform:uppercase; color:rgba(255,255,255,.48);}
  .ct-c-stat.rar{background:color-mix(in srgb, var(--rc) 20%, transparent); border-color:color-mix(in srgb, var(--rc) 55%, transparent);}
  .ct-c-stat.rar b{color:var(--rc); filter:brightness(1.2); font-size:max(7px, 5cqw);}
  .ct-c-reflet{position:absolute; inset:0; pointer-events:none; opacity:0; transition:opacity .3s;}
  .ct-carte.r4 .ct-c-reflet, .ct-carte.r5 .ct-c-reflet{opacity:1; background:linear-gradient(115deg, transparent 38%, rgba(255,255,255,.22) 48%, transparent 58%); background-size:300% 100%; background-position:var(--ct-lum, 120%) 0;}
  .ct-carte.holo .ct-c-reflet{opacity:.55; mix-blend-mode:color-dodge;
    background:linear-gradient(115deg, transparent 15%, rgba(255,60,190,.65) 30%, rgba(60,255,255,.6) 42%, rgba(255,255,90,.6) 54%, rgba(120,90,255,.6) 66%, transparent 80%);
    background-size:260% 260%; background-position:var(--hx, 50%) var(--hy, 50%);}
  .ct-carte.holo .ct-c-in::after{content:''; position:absolute; inset:0; pointer-events:none; opacity:.35; mix-blend-mode:overlay;
    background-image:radial-gradient(circle at 20% 30%, #fff 0 1px, transparent 1.5px), radial-gradient(circle at 70% 60%, #fff 0 1px, transparent 1.5px), radial-gradient(circle at 40% 80%, #fff 0 1px, transparent 1.5px);
    background-size:23px 23px, 31px 31px, 17px 17px;}
  .ct-c-holo{position:absolute; top:2.1cqw; left:50%; transform:translateX(-50%); padding:0 3.4cqw; height:6cqw; display:flex; align-items:center; border-radius:99px; font-size:max(6px, 4.2cqw); font-weight:800; letter-spacing:.14em; color:#05070a; background:linear-gradient(90deg, #ff9ad5, #9af7ff, #fff59a);}
  .ct-carte.vivante.r4, .ct-carte.r4:hover{box-shadow:0 0 0 1px rgba(242,193,78,.35), 0 0 34px -6px rgba(242,193,78,.55), 0 14px 30px -14px rgba(0,0,0,.8);}
  .ct-carte.vivante.r5, .ct-carte.r5:hover{box-shadow:0 0 40px -6px rgba(255,92,138,.55), 0 14px 30px -14px rgba(0,0,0,.8);}
  .ct-carte.vivante.r5{animation:ctBord 5s linear infinite;}
  .ct-carte.vivante.r4 .ct-c-reflet, .ct-carte.vivante.r5 .ct-c-reflet{animation:ctLum 3.6s ease-in-out infinite;}
  @media (hover:hover){
    .ct-carte.r5:hover{animation:ctBord 5s linear infinite;}
    .ct-carte.r4:hover .ct-c-reflet, .ct-carte.r5:hover .ct-c-reflet{animation:ctLum 2.4s ease-in-out infinite;}
    .ct-case:hover .ct-c-photo{transform:scale(1.05);}
  }
  .ct-carte.verrou{--ct-cadre:linear-gradient(155deg, #2c333d, #161b22 60%, #252c35); --rc:#6b7684; box-shadow:none;}
  .ct-carte.verrou .ct-c-photo{filter:grayscale(1) brightness(.26) contrast(1.15);}
  .ct-carte.verrou .ct-c-teinte, .ct-carte.verrou .ct-c-motif, .ct-carte.verrou .ct-c-fond{opacity:.25;}
  .ct-carte.verrou .ct-c-gemme{opacity:.45; box-shadow:none;}
  .ct-carte.verrou .ct-c-nom{color:rgba(255,255,255,.55); text-shadow:none;}
  .ct-carte.verrou .ct-c-stat{opacity:.5;}
  @container (max-width:125px){
    .ct-c-stats, .ct-c-holo, .ct-c-marque{display:none;}
    .ct-c-nom{font-size:calc(var(--nf, 1) * 12.5cqw); white-space:normal; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical;}
    .ct-c-sous{display:none;}
    .ct-c-plaque{justify-content:center;}
  }
  .ct-c-cadenas{position:absolute; left:50%; top:36%; transform:translate(-50%, -50%); width:16cqw; height:16cqw; color:rgba(255,255,255,.5); z-index:2;}
  .ct-c-cadenas svg{width:100%; height:100%;}
  .ct-c-badge{position:absolute; z-index:3; top:-7px; right:-7px; min-width:26px; height:24px; padding:0 7px; border-radius:99px; display:grid; place-items:center; font-size:12px; font-weight:800; color:#05070a; background:#F4F5F6; box-shadow:0 4px 12px rgba(0,0,0,.45); font-variant-numeric:tabular-nums;}
  .ct-c-nouveau{position:absolute; z-index:3; left:50%; top:-9px; transform:translateX(-50%); height:22px; padding:0 10px; border-radius:99px; display:grid; place-items:center; font-size:10.5px; font-weight:800; letter-spacing:.1em; text-transform:uppercase; color:#04131f; background:var(--ct-accent); box-shadow:0 4px 14px rgba(79,180,255,.5); white-space:nowrap;}

  .ct-case{all:unset; box-sizing:border-box; display:block; cursor:pointer; border-radius:13px; transition:transform .2s cubic-bezier(.2,.8,.2,1);}
  .ct-case:hover{transform:translateY(-4px);}
  .ct-case:focus-visible{outline:2px solid var(--ct-accent); outline-offset:3px;}
  .ct-grille{display:grid; grid-template-columns:repeat(auto-fill, minmax(150px, 1fr)); gap:18px 14px;}
  .ct-ruban{display:grid; grid-auto-flow:column; grid-auto-columns:minmax(130px, 150px); gap:14px; overflow-x:auto; padding:10px 2px 6px; scrollbar-width:none;}
  .ct-ruban::-webkit-scrollbar{display:none;}

  /* ---------- Packs : la vitrine à boosters ---------- */
  .ct-vitrine{position:relative; overflow:hidden; padding:22px 20px 22px; text-align:center; --acc:#4FB4FF;
    background:radial-gradient(62% 62% at 50% 34%, color-mix(in srgb, var(--acc) 26%, transparent), transparent 72%), radial-gradient(50% 60% at 50% 110%, color-mix(in srgb, var(--acc) 14%, transparent), transparent 70%), linear-gradient(180deg, rgba(255,255,255,.04), rgba(255,255,255,.012));
    border-color:color-mix(in srgb, var(--acc) 22%, rgba(255,255,255,.08));}
  .ct-vit-tete{display:flex; align-items:center; justify-content:space-between; gap:12px; text-align:left;}
  .ct-surtitre{display:inline-flex; align-items:center; gap:7px; font-size:12px; font-weight:700; letter-spacing:.12em; text-transform:uppercase; color:var(--ct-accent);}
  .ct-compte{font-size:12.5px; font-weight:600; color:var(--muted); font-variant-numeric:tabular-nums;}

  .ct-car{position:relative; height:376px; margin:2px -20px 0; perspective:1200px; touch-action:pan-y; user-select:none; -webkit-user-select:none; outline:none;}
  .ct-car:focus-visible{outline:2px solid var(--ct-accent); outline-offset:-4px; border-radius:16px;}
  .ct-car-piste{position:absolute; inset:0; display:grid; place-items:center; transform-style:preserve-3d;}
  .ct-car-item{grid-area:1 / 1; --pas:min(236px, 30vw); --o:0; --abs:0; position:relative; cursor:pointer; transform-style:preserve-3d;
    transform:translateX(calc(var(--o) * var(--pas))) rotateY(calc(var(--o) * -24deg)) scale(calc(1 - var(--abs) * .22));
    opacity:calc(1 - var(--abs) * .48); filter:brightness(calc(1 - var(--abs) * .42)); z-index:calc(10 - var(--abs));
    transition:transform .6s cubic-bezier(.2,.8,.2,1), opacity .45s, filter .45s;}
  .ct-car-item[data-loin]{opacity:0; pointer-events:none;}
  .ct-car-item.centre .ct-pack{animation:ctFlotte2 5.5s ease-in-out infinite;}
  .ct-car-item:not(.centre) .ct-pack{pointer-events:none;}
  .ct-car-fl{all:unset; box-sizing:border-box; position:absolute; z-index:20; top:50%; margin-top:-22px; width:44px; height:44px; display:grid; place-items:center; border-radius:50%; cursor:pointer; color:var(--ink); background:rgba(8,12,18,.62); border:1px solid var(--ct-trait-fort); backdrop-filter:blur(8px); -webkit-backdrop-filter:blur(8px); transition:background .15s, transform .15s;}
  .ct-car-fl:hover{background:rgba(255,255,255,.16);}
  .ct-car-fl:active{transform:scale(.94);}
  .ct-car-fl:focus-visible{outline:2px solid var(--ct-accent); outline-offset:2px;}
  .ct-car-fl.g{left:26px;} .ct-car-fl.d{right:26px;}
  .ct-car-fl.g .ct-ico{transform:scaleX(-1);}
  .ct-points{display:flex; justify-content:center; gap:8px; margin:2px 0 4px;}
  .ct-points button{all:unset; box-sizing:border-box; cursor:pointer; width:8px; height:8px; border-radius:99px; background:rgba(255,255,255,.22); transition:width .3s, background .3s;}
  .ct-points button.actif{width:26px; background:var(--acc);}
  .ct-points button:focus-visible{outline:2px solid var(--ct-accent); outline-offset:3px;}

  .ct-vit-info{max-width:620px; margin:14px auto 0; min-height:210px;}
  .ct-vit-info-in{animation:ctFondu .35s ease both;}
  .ct-serie-tag{display:inline-block; padding:4px 11px; border-radius:99px; font-size:11px; font-weight:700; letter-spacing:.14em; text-transform:uppercase; color:var(--acc); background:color-mix(in srgb, var(--acc) 14%, transparent); border:1px solid color-mix(in srgb, var(--acc) 35%, transparent);}
  .ct-vit-info h2{margin:10px 0 0; font-size:clamp(26px, 3.6vw, 36px); line-height:1.05; letter-spacing:-.025em;}
  .ct-vit-info p{margin:10px auto 0; max-width:48ch; font-size:14.5px; line-height:1.55; color:var(--ink-soft);}
  .ct-vit-taux{max-width:460px; margin:18px auto 0;}
  .ct-taux{display:flex; height:8px; border-radius:99px; overflow:hidden; gap:2px; margin:0 0 10px;}
  .ct-taux i{display:block; height:100%; min-width:4px;}
  .ct-legende{display:flex; flex-wrap:wrap; justify-content:center; gap:6px 18px;}
  .ct-legende div{font-size:12px; color:var(--muted); display:flex; align-items:center; gap:6px;}
  .ct-legende b{font-size:13px; color:var(--ink); font-variant-numeric:tabular-nums;}
  .ct-legende div::before{content:''; width:8px; height:8px; border-radius:2px; transform:rotate(45deg); background:var(--rc);}
  .ct-evts{display:flex; flex-wrap:wrap; justify-content:center; gap:8px; margin-top:14px;}
  .ct-evt{display:inline-flex; align-items:center; gap:7px; padding:7px 12px; border-radius:10px; font-size:13px; color:var(--ink); background:rgba(242,193,78,.1); border:1px solid rgba(242,193,78,.3);}
  .ct-evt-lien{all:unset; box-sizing:border-box; cursor:pointer; display:inline-flex; align-items:center; gap:7px; padding:7px 12px; border-radius:10px; font-size:13px; color:var(--ink); background:color-mix(in srgb, var(--acc) 14%, transparent); border:1px solid color-mix(in srgb, var(--acc) 40%, transparent);}
  .ct-evt-lien:hover{background:color-mix(in srgb, var(--acc) 22%, transparent);}
  .ct-evt-lien:focus-visible{outline:2px solid var(--ct-accent); outline-offset:2px;}
  .ct-eq-ligne{padding:10px 12px; gap:12px;}
  .ct-eq-num{width:44px; flex:none; font-size:12.5px; font-weight:700; color:var(--muted); font-variant-numeric:tabular-nums;}
  .ct-eq-photo{width:40px; height:40px; flex:none; border-radius:10px; object-fit:cover; max-width:none; background:#0b0f15;}
  .ct-eq-res{display:grid; gap:8px; margin-top:12px;}
  .ct-eq .ct-select{height:36px;}
  .ct-classeurs{display:flex; gap:8px; margin:0 0 14px; overflow-x:auto; scrollbar-width:none; padding:2px;}
  .ct-classeurs::-webkit-scrollbar{display:none;}
  .ct-classeur{all:unset; box-sizing:border-box; cursor:pointer; flex:0 0 auto; display:flex; flex-direction:column; gap:2px; min-width:150px; padding:11px 16px; border-radius:14px; border:1px solid var(--ct-trait); background:var(--ct-surface); transition:background .15s, border-color .15s;}
  .ct-classeur b{font-size:14px;}
  .ct-classeur small{font-size:12px; color:var(--muted); font-variant-numeric:tabular-nums;}
  .ct-classeur:hover{background:var(--ct-surface-2);}
  .ct-classeur.actif{border-color:var(--acc); background:color-mix(in srgb, var(--acc) 14%, transparent);}
  .ct-classeur:focus-visible{outline:2px solid var(--ct-accent); outline-offset:2px;}
  .ct-ouvrir{display:flex; flex-wrap:wrap; justify-content:center; gap:10px; margin-top:22px;}
  .ct-ouvrir .ct-btn.principal{box-shadow:0 8px 24px -10px color-mix(in srgb, var(--acc) 90%, #000), inset 0 1px 0 rgba(255,255,255,.25);}
  .ct-hero-note{display:flex; align-items:center; justify-content:center; gap:7px; margin-top:14px; font-size:13px; color:var(--muted);}
  .ct-attente{display:flex; align-items:center; gap:14px; margin-top:16px; padding:14px 16px; border-radius:16px; border:1px solid rgba(79,180,255,.3); background:rgba(20,137,222,.08); cursor:pointer; width:100%; color:inherit; font:inherit; text-align:left;}
  .ct-attente:hover{background:rgba(20,137,222,.13);}
  .ct-attente .ct-ico{color:var(--ct-accent);}
  .ct-attente b{font-size:14px;}
  .ct-attente span{display:block; font-size:13px; color:var(--muted);}
  .ct-attente .ct-ico:last-child{margin-left:auto;}

  /* ---------- le pack (booster) ---------- */
  .ct-pack{--pk-w:210px; position:relative; width:var(--pk-w); aspect-ratio:.66; transform-style:preserve-3d; user-select:none; -webkit-user-select:none; touch-action:none; --teinte:#4FB4FF;
    filter:drop-shadow(0 28px 36px rgba(0,0,0,.55)) drop-shadow(0 0 38px color-mix(in srgb, var(--teinte) 30%, transparent));}
  ${PACKS_CSS}
  .ct-pk-haut, .ct-pk-corps{position:absolute; left:0; right:0; overflow:hidden; background:var(--pk-fond);}
  .ct-pk-haut{top:0; height:14%; border-radius:12px 12px 3px 3px; background-size:100% 714.3%; background-position:50% 0;}
  .ct-pk-corps{bottom:0; height:86%; border-radius:3px 3px 12px 12px; background-size:100% 116.3%; background-position:50% 100%; box-shadow:inset 0 0 0 1px rgba(255,255,255,.14);}
  .ct-pk-haut::before, .ct-pk-corps::after{content:''; position:absolute; left:0; right:0; height:9px; background:repeating-linear-gradient(90deg, rgba(255,255,255,.3) 0 2px, rgba(255,255,255,.06) 2px 5px);}
  .ct-pk-haut::before{top:0;}
  .ct-pk-corps::after{bottom:0;}
  .ct-pk-haut::after, .ct-pk-corps::before{content:''; position:absolute; inset:0; pointer-events:none; background:linear-gradient(115deg, transparent 35%, rgba(255,255,255,.32) 47%, transparent 58%); background-size:280% 100%; animation:ctLum 4s ease-in-out infinite;}
  .ct-pk-contenu{position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:5%; padding:14% 9% 16%; color:#fff; text-align:center;}
  .ct-pk-contenu .ct-embleme{width:54%; color:#fff; filter:drop-shadow(0 0 14px rgba(255,255,255,.4));}
  .ct-pk-marque{font-size:calc(var(--pk-w) * .09); font-weight:800; letter-spacing:.32em; margin-right:-.32em; text-shadow:0 2px 12px rgba(0,0,0,.5);}
  .ct-pk-nom{max-width:100%; padding:calc(var(--pk-w) * .02) calc(var(--pk-w) * .05); border-radius:99px; font-size:calc(var(--pk-w) * .052); font-weight:800; letter-spacing:.14em; text-transform:uppercase; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; color:#071018; background:linear-gradient(180deg, #fff, color-mix(in srgb, var(--teinte) 55%, #fff)); box-shadow:0 4px 16px -4px color-mix(in srgb, var(--teinte) 80%, transparent);}
  .ct-pk-pied{position:absolute; left:0; right:0; bottom:9%; text-align:center; font-size:calc(var(--pk-w) * .042); font-weight:700; letter-spacing:.16em; text-transform:uppercase; opacity:.7; text-shadow:0 1px 6px rgba(0,0,0,.6);}
  .ct-pk-ligne{position:absolute; left:0; top:14%; height:2px; width:calc(var(--dech, 0) * 100%); margin-top:-1px; background:#fff; box-shadow:0 0 10px #fff, 0 0 22px var(--teinte, #4FB4FF); border-radius:2px; z-index:3;}
  .ct-pk-lumiere{position:absolute; left:50%; top:14%; width:160%; aspect-ratio:1; transform:translate(-50%, -50%) scale(0); border-radius:50%; pointer-events:none; z-index:4;
    background:radial-gradient(circle, #fff 0%, var(--teinte, #4FB4FF) 22%, transparent 62%); opacity:0;}
  .ct-pk-pile{position:absolute; inset:0; border-radius:12px; background:linear-gradient(160deg, #0b2f55, #0a1730); border:1px solid rgba(255,255,255,.12);}
  .ct-pk-nombre{position:absolute; z-index:5; right:-12px; top:-12px; min-width:40px; height:40px; padding:0 10px; border-radius:99px; display:grid; place-items:center; font-size:15px; font-weight:800; color:#05070a; background:#fff; box-shadow:0 8px 20px rgba(0,0,0,.4);}
  .ct-pk-indice{position:absolute; z-index:6; left:8%; top:14%; width:30px; height:30px; margin-top:-15px; border-radius:50%; background:rgba(255,255,255,.9); box-shadow:0 0 0 6px rgba(255,255,255,.18), 0 0 24px rgba(255,255,255,.6); animation:ctIndice 1.8s cubic-bezier(.5,0,.2,1) infinite; pointer-events:none;}

  /* ---------- la scène d'ouverture ---------- */
  .ct-scene{position:fixed; inset:0; z-index:500; display:flex; flex-direction:column; color:#fff; overflow:hidden; touch-action:manipulation; animation:ctFondu .3s ease both;}
  .ct-scene-fond{position:absolute; inset:0; background:radial-gradient(60% 55% at 50% 45%, color-mix(in srgb, var(--teinte, #1489DE) 22%, #070a10) 0%, #030407 72%); transition:background .8s ease;}
  .ct-scene-fond::after{content:''; position:absolute; inset:0; background:radial-gradient(120% 90% at 50% 50%, transparent 55%, rgba(0,0,0,.7) 100%);}
  .ct-scene canvas{position:absolute; inset:0; width:100%; height:100%; pointer-events:none; z-index:6;}
  .ct-scene-x{all:unset; position:absolute; z-index:8; top:max(14px, env(safe-area-inset-top)); right:14px; width:42px; height:42px; display:grid; place-items:center; border-radius:12px; cursor:pointer; color:rgba(255,255,255,.8); background:rgba(255,255,255,.08); border:1px solid rgba(255,255,255,.12);}
  .ct-scene-x:hover{background:rgba(255,255,255,.14);}
  .ct-scene-x:focus-visible{outline:2px solid #fff;}
  .ct-scene-centre{position:relative; z-index:3; flex:1; min-height:0; display:grid; place-items:center; padding:64px 16px 8px; perspective:1200px;}
  .ct-scene-pied{position:relative; z-index:7; min-height:96px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:12px; padding:8px 16px max(22px, env(safe-area-inset-bottom)); text-align:center;}
  .ct-scene-pied p{margin:0; font-size:14px; color:rgba(255,255,255,.72);}
  .ct-scene-pied .boutons{display:flex; gap:10px; flex-wrap:wrap; justify-content:center;}
  .ct-scene .ct-btn{border-color:rgba(255,255,255,.16);}
  .ct-flash{position:absolute; inset:0; z-index:5; pointer-events:none; opacity:0; background:radial-gradient(circle at 50% 45%, #fff, var(--teinte, #fff) 40%, transparent 75%);}
  .ct-flash.on{animation:ctFlash .8s ease-out;}
  .ct-rayons{position:absolute; left:50%; top:45%; width:170vmax; height:170vmax; transform:translate(-50%, -50%); pointer-events:none; z-index:1; opacity:0; transition:opacity .6s;
    background:repeating-conic-gradient(from 0deg, color-mix(in srgb, var(--teinte) 45%, transparent) 0deg 4deg, transparent 4deg 15deg);
    -webkit-mask-image:radial-gradient(circle, #000 0%, transparent 42%); mask-image:radial-gradient(circle, #000 0%, transparent 42%); animation:ctTourne 40s linear infinite;}
  .ct-rayons.on{opacity:.7;}
  .ct-scene.secousse .ct-scene-centre{animation:ctSecousse .55s cubic-bezier(.36,.07,.19,.97);}
  .ct-scene-pack{position:relative; transition:transform .6s cubic-bezier(.2,.8,.2,1), opacity .5s;}
  .ct-scene-pack .ct-pack{--pk-w:min(240px, 56vw); animation:ctArrivee .7s cubic-bezier(.2,1.3,.4,1) both;}
  .ct-scene-pack.tremble .ct-pack{animation:ctTremble .12s linear infinite;}
  .ct-pk-haut.part{transition:transform .65s cubic-bezier(.3,.6,.2,1), opacity .65s; transform:translate(-18%, -230%) rotate(-28deg); opacity:0;}
  .ct-pk-lumiere.on{animation:ctLumiere .9s ease-out forwards;}
  .ct-scene-pack.parti{transform:translateY(55vh) scale(.8) rotate(6deg); opacity:0;}

  .ct-donne{display:grid; gap:40px 14px; width:min(1000px, 100%); grid-template-columns:repeat(var(--cols, 5), minmax(0, 1fr)); justify-items:center; align-content:center;}
  .ct-place{position:relative; width:100%; max-width:var(--lc, 180px); perspective:1000px;}
  .ct-donne.seule .ct-place{--lc:min(300px, 66vw, 40vh);}
  .ct-volte{position:relative; width:100%; aspect-ratio:5 / 7; cursor:pointer; transform-style:preserve-3d; transition:transform .75s cubic-bezier(.2,.75,.25,1);}
  .ct-volte:focus-visible{outline:2px solid #fff; outline-offset:4px; border-radius:14px;}
  .ct-place.retournee .ct-volte{transform:rotateY(180deg);}
  .ct-place.donne{animation:ctDonne .6s cubic-bezier(.2,.9,.25,1) both;}
  .ct-dos, .ct-face{position:absolute; inset:0; backface-visibility:hidden; -webkit-backface-visibility:hidden; border-radius:13px;}
  .ct-face{transform:rotateY(180deg);}
  .ct-face .ct-carte{width:100%; height:100%;}
  .ct-dos{display:grid; place-items:center; padding:3px; background:linear-gradient(155deg, #3c4757, #1a212b 50%, #2d3644); box-shadow:0 18px 40px -16px rgba(0,0,0,.9);}
  .ct-dos-in{width:100%; height:100%; border-radius:10px; display:grid; place-items:center; color:rgba(255,255,255,.85);
    background:radial-gradient(80% 60% at 50% 40%, color-mix(in srgb, var(--accb, #4FB4FF) 34%, transparent), transparent 70%), repeating-linear-gradient(45deg, rgba(255,255,255,.035) 0 6px, transparent 6px 12px), linear-gradient(160deg, #0d2b4c, #08121f);}
  .ct-dos-in .ct-embleme{width:52%;}
  .ct-dos[data-r="2"]{box-shadow:0 0 0 1px rgba(79,180,255,.5), 0 0 26px -2px rgba(79,180,255,.55), 0 18px 40px -16px rgba(0,0,0,.9);}
  .ct-dos[data-r="3"]{box-shadow:0 0 0 1px rgba(168,121,255,.6), 0 0 34px 0 rgba(168,121,255,.6), 0 18px 40px -16px rgba(0,0,0,.9); animation:ctPouls 1.6s ease-in-out infinite; --pc:rgba(168,121,255,.75);}
  .ct-dos[data-r="4"]{box-shadow:0 0 0 1px rgba(242,193,78,.7), 0 0 42px 2px rgba(242,193,78,.65), 0 18px 40px -16px rgba(0,0,0,.9); animation:ctPouls 1.1s ease-in-out infinite; --pc:rgba(242,193,78,.85);}
  .ct-dos[data-r="5"]{box-shadow:0 0 0 1px rgba(255,92,138,.8), 0 0 50px 4px rgba(255,92,138,.7), 0 18px 40px -16px rgba(0,0,0,.9); animation:ctPouls .8s ease-in-out infinite; --pc:rgba(255,120,180,.95);}
  .ct-place.charge .ct-volte{animation:ctCharge .09s linear infinite;}
  .ct-place.charge .ct-dos{filter:brightness(1.35);}
  .ct-etiq{position:absolute; left:50%; top:calc(100% + 12px); transform:translateX(-50%); z-index:4; white-space:nowrap; pointer-events:none;
    padding:6px 14px; border-radius:99px; font-size:12px; font-weight:800; letter-spacing:.14em; text-transform:uppercase; color:#05070a; background:var(--rc); box-shadow:0 6px 18px rgba(0,0,0,.35); animation:ctEtiq .5s cubic-bezier(.2,1.4,.4,1) both;}
  .ct-etiq.nouveau{background:var(--ct-accent);}
  .ct-etiq.double{background:rgba(255,255,255,.9);}
  .ct-donne:not(.seule) .ct-etiq{top:calc(100% + 8px); font-size:10px; padding:4px 9px; letter-spacing:.1em;}
  .ct-titre-rar{position:absolute; left:0; right:0; top:12%; z-index:4; text-align:center; pointer-events:none; font-size:clamp(28px, 7vw, 64px); font-weight:900; letter-spacing:.18em; text-transform:uppercase;
    color:#fff; text-shadow:0 0 30px var(--teinte), 0 0 60px var(--teinte); animation:ctTitre 1.6s cubic-bezier(.2,.8,.2,1) both;}
  .ct-bilan{display:flex; flex-wrap:wrap; justify-content:center; gap:8px;}
  .ct-bilan span{display:inline-flex; align-items:center; gap:6px; padding:6px 12px; border-radius:99px; font-size:13px; font-weight:600; background:rgba(255,255,255,.08); border:1px solid rgba(255,255,255,.1);}
  .ct-bilan span i{width:8px; height:8px; border-radius:2px; transform:rotate(45deg); background:var(--rc);}

  /* ---------- fenêtres ---------- */
  .ct-voile{position:fixed; inset:0; z-index:520; display:flex; align-items:center; justify-content:center; padding:16px; background:rgba(3,5,8,.72); backdrop-filter:blur(14px); -webkit-backdrop-filter:blur(14px); animation:ctFondu .2s ease both;}
  .ct-fen{position:relative; width:min(520px, 100%); max-height:min(92vh, 860px); overflow-y:auto; scrollbar-width:thin; padding:24px; border-radius:22px; border:1px solid var(--ct-trait-fort); background:linear-gradient(180deg, #10151d, #0a0e14); color:var(--ink); box-shadow:0 40px 80px -20px rgba(0,0,0,.8); animation:ctMonte .35s cubic-bezier(.2,.8,.2,1) both;}
  .ct-fen.large{width:min(880px, 100%);}
  .ct-fen h2{margin:0; font-size:20px; letter-spacing:-.01em; padding-right:40px;}
  .ct-fen .sous{margin:6px 0 0; font-size:14px; color:var(--muted); line-height:1.5;}
  .ct-fermer{all:unset; position:absolute; top:14px; right:14px; z-index:2; width:36px; height:36px; display:grid; place-items:center; border-radius:10px; cursor:pointer; color:var(--ink-soft); background:rgba(255,255,255,.06);}
  .ct-fermer:hover{background:rgba(255,255,255,.12); color:var(--ink);}
  .ct-fermer:focus-visible{outline:2px solid var(--ct-accent);}

  .ct-fiche{display:grid; grid-template-columns:minmax(0, 280px) minmax(0, 1fr); gap:28px; align-items:start;}
  .ct-fiche-carte{perspective:900px;}
  .ct-fiche-carte .ct-carte{transition:transform .2s ease-out;}
  .ct-fiche-num{display:inline-block; padding:4px 9px; border-radius:99px; font-size:12px; font-weight:700; background:var(--ct-surface-2); font-variant-numeric:tabular-nums;}
  .ct-fiche h2{margin-top:10px; font-size:28px; letter-spacing:-.02em;}
  .ct-fiche-rar{display:inline-flex; align-items:center; gap:8px; margin-top:8px; font-size:13px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; color:var(--rc);}
  .ct-fiche-rar::before{content:''; width:9px; height:9px; border-radius:2px; transform:rotate(45deg); background:var(--rc);}
  .ct-stats{display:grid; grid-template-columns:repeat(3, minmax(0, 1fr)); gap:8px; margin:18px 0 0;}
  .ct-stat{padding:12px; border-radius:14px; background:var(--ct-surface); border:1px solid var(--ct-trait);}
  .ct-stat b{display:block; font-size:17px; font-variant-numeric:tabular-nums;}
  .ct-stat span{display:block; margin-top:2px; font-size:12px; color:var(--muted);}
  .ct-pochettes{display:grid; grid-template-columns:repeat(6, minmax(0, 1fr)); gap:8px;}
  .ct-pochette{all:unset; cursor:pointer; display:block; aspect-ratio:1; border-radius:8px; overflow:hidden; background:#0b0f15; box-shadow:0 0 0 1px var(--ct-trait);}
  .ct-pochette img{width:100%; height:100%; object-fit:cover; max-width:none; display:block; transition:transform .3s;}
  .ct-pochette:hover img{transform:scale(1.06);}
  .ct-pochette:focus-visible{outline:2px solid var(--ct-accent);}
  .ct-actions{display:flex; flex-wrap:wrap; gap:8px; margin-top:18px;}
  .ct-ligne-act{display:flex; align-items:center; gap:10px; flex-wrap:wrap; padding:14px; margin-top:12px; border-radius:14px; background:var(--ct-surface); border:1px solid var(--ct-trait);}
  .ct-ligne-act .tx{flex:1; min-width:150px; font-size:13px; color:var(--ink-soft); line-height:1.4;}
  .ct-ligne-act .tx b{display:block; color:var(--ink); font-size:14px;}
  .ct-ligne-act select{height:34px; padding:0 8px; border-radius:9px; border:1px solid var(--ct-trait-fort); background:rgba(255,255,255,.05); color:var(--ink); font:inherit; font-size:13px;}

  /* ---------- Collection ---------- */
  .ct-prog{display:grid; grid-template-columns:auto minmax(0, 1fr); gap:10px 22px; align-items:center;}
  .ct-prog-chiffre{font-size:34px; font-weight:800; letter-spacing:-.02em; font-variant-numeric:tabular-nums; line-height:1;}
  .ct-prog-chiffre small{font-size:15px; font-weight:500; color:var(--muted); letter-spacing:0;}
  .ct-prog-droite{min-width:0;}
  .ct-prog-droite .lib{display:flex; align-items:center; justify-content:space-between; gap:10px; font-size:13px; color:var(--muted); margin-bottom:8px;}
  .ct-raretes{grid-column:1 / -1; display:grid; grid-template-columns:repeat(5, minmax(0, 1fr)); gap:8px; margin-top:6px;}
  .ct-rar-btn{all:unset; box-sizing:border-box; cursor:pointer; padding:10px 12px; border-radius:12px; border:1px solid var(--ct-trait); background:var(--ct-surface); transition:border-color .15s, background .15s;}
  .ct-rar-btn:hover{background:var(--ct-surface-2);}
  .ct-rar-btn.actif{border-color:var(--rc); background:color-mix(in srgb, var(--rc) 12%, transparent);}
  .ct-rar-btn:focus-visible{outline:2px solid var(--ct-accent);}
  .ct-rar-btn .nom{display:flex; align-items:center; gap:6px; font-size:12px; font-weight:700; color:var(--rc);}
  .ct-rar-btn .nom::before{content:''; width:7px; height:7px; border-radius:2px; transform:rotate(45deg); background:var(--rc);}
  .ct-rar-btn .nb{display:block; margin:4px 0 8px; font-size:13px; color:var(--ink-soft); font-variant-numeric:tabular-nums;}
  .ct-rar-btn .ct-barre{height:4px;}
  .ct-rar-btn .ct-barre i{background:var(--rc);}
  .ct-outils{display:flex; flex-wrap:wrap; gap:10px; align-items:center; margin:16px 0 18px;}
  .ct-recherche{position:relative; flex:1 1 220px; min-width:0;}
  .ct-recherche .ct-ico{position:absolute; left:12px; top:50%; transform:translateY(-50%); color:var(--muted); pointer-events:none;}
  .ct-recherche input{width:100%; height:40px; padding:0 12px 0 38px; border-radius:11px; border:1px solid var(--ct-trait-fort); background:rgba(255,255,255,.04); color:var(--ink); font:inherit; font-size:14px;}
  .ct-recherche input:focus{outline:none; border-color:var(--ct-accent);}
  .ct-segment{display:inline-flex; padding:3px; border-radius:11px; border:1px solid var(--ct-trait); background:rgba(255,255,255,.025); overflow-x:auto; scrollbar-width:none; max-width:100%;}
  .ct-segment button{all:unset; box-sizing:border-box; cursor:pointer; height:32px; padding:0 12px; border-radius:8px; font-size:13px; font-weight:600; color:var(--muted); white-space:nowrap;}
  .ct-segment button:hover{color:var(--ink);}
  .ct-segment button.actif{color:var(--ink); background:rgba(255,255,255,.1);}
  .ct-segment button:focus-visible{outline:2px solid var(--ct-accent); outline-offset:-2px;}
  .ct-select{height:40px; padding:0 10px; border-radius:11px; border:1px solid var(--ct-trait-fort); background:rgba(255,255,255,.04); color:var(--ink); font:inherit; font-size:13.5px;}
  .ct-pages{display:flex; align-items:center; justify-content:center; gap:14px; margin-top:28px; font-size:13px; color:var(--muted); font-variant-numeric:tabular-nums;}

  /* ---------- Missions, Bonus, Succès ---------- */
  .ct-deux{display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:16px; align-items:start;}
  .ct-liste{display:grid; gap:8px;}
  .ct-ligne{display:flex; align-items:center; gap:14px; padding:14px; border-radius:16px; border:1px solid var(--ct-trait); background:var(--ct-surface);}
  .ct-ligne.pret{border-color:rgba(79,180,255,.45); background:rgba(20,137,222,.08);}
  .ct-ligne.fait{opacity:.55;}
  .ct-pastille-ico{width:40px; height:40px; flex:none; border-radius:12px; display:grid; place-items:center; color:var(--ct-accent); background:rgba(79,180,255,.1);}
  .ct-ligne.fait .ct-pastille-ico{color:var(--ct-ok); background:rgba(91,224,166,.1);}
  .ct-ligne .tx{flex:1; min-width:0;}
  .ct-ligne .tx b{display:block; font-size:14px; font-weight:600;}
  .ct-ligne .tx .bas{display:flex; align-items:center; gap:10px; margin-top:8px;}
  .ct-ligne .tx .bas .ct-barre{flex:1;}
  .ct-ligne .tx .bas small{font-size:12px; color:var(--muted); font-variant-numeric:tabular-nums; white-space:nowrap;}
  .ct-gains{display:flex; gap:6px; flex-wrap:wrap; margin-top:8px;}
  .ct-gain{display:inline-flex; align-items:center; gap:4px; height:24px; padding:0 8px; border-radius:7px; font-size:12px; font-weight:700; color:var(--ink-soft); background:rgba(255,255,255,.06); font-variant-numeric:tabular-nums;}
  .ct-gain .ct-ico{color:var(--ct-accent);}
  .ct-gain.v .ct-ico{color:#F2C14E;}
  .ct-gain.g .ct-ico{color:var(--r3);}

  .ct-bonus{display:grid; grid-template-columns:minmax(0, 1fr) minmax(0, 1fr); gap:16px; align-items:start;}
  .ct-bonus .ct-panneau.roue{grid-row:span 2;}
  .ct-serie{display:grid; grid-template-columns:repeat(7, minmax(0, 1fr)); gap:6px; margin-bottom:16px;}
  .ct-jour{position:relative; display:flex; flex-direction:column; align-items:center; gap:5px; padding:10px 2px 9px; border-radius:12px; border:1px solid var(--ct-trait); background:var(--ct-surface); font-size:11px; color:var(--muted); text-align:center;}
  .ct-jour .ct-ico{color:var(--ink-soft);}
  .ct-jour b{font-size:12px; color:var(--ink); font-variant-numeric:tabular-nums; line-height:1.25;}
  .ct-jour.fait{opacity:.45;}
  .ct-jour.fait .ct-ico{color:var(--ct-ok);}
  .ct-jour.aujourdhui{border-color:var(--ct-accent); background:rgba(20,137,222,.12);}
  .ct-jour.aujourdhui .ct-ico{color:var(--ct-accent);}
  .ct-jour.sept{border-color:rgba(168,121,255,.45);}
  .ct-creneaux{display:grid; grid-template-columns:repeat(4, minmax(0, 1fr)); gap:8px;}
  .ct-creneau{display:flex; flex-direction:column; align-items:center; gap:6px; padding:14px 6px 12px; border-radius:14px; border:1px solid var(--ct-trait); background:var(--ct-surface); text-align:center;}
  .ct-creneau .h{font-size:20px; font-weight:800; font-variant-numeric:tabular-nums;}
  .ct-creneau small{font-size:11.5px; color:var(--muted); min-height:1.3em;}
  .ct-creneau.pret{border-color:var(--ct-accent); background:rgba(20,137,222,.12);}
  .ct-creneau.prise .h, .ct-creneau.expire .h{color:var(--muted);}
  .ct-roue-zone{display:flex; flex-direction:column; align-items:center; gap:18px;}
  .ct-roue{position:relative; width:min(100%, 360px); aspect-ratio:1;}
  .ct-roue > svg:last-child{width:100%; height:100%; display:block; overflow:visible;}
  .ct-roue-disque{transform-origin:0 0; transition:transform 5.4s cubic-bezier(.12,.68,.06,1);}
  .ct-roue-pointe{position:absolute; left:50%; top:-8px; z-index:2; width:26px; height:32px; transform:translateX(-50%); filter:drop-shadow(0 4px 8px rgba(0,0,0,.5));}
  .ct-roue-res{min-height:22px; font-size:14px; color:var(--ink-soft); text-align:center;}
  .ct-roue-res b{color:var(--ink);}

  .ct-medaille{width:44px; height:44px; flex:none; border-radius:14px; display:grid; place-items:center; color:var(--muted); background:var(--ct-surface-2);}
  .ct-ligne.pret .ct-medaille{color:#2a1a00; background:linear-gradient(135deg, #ffe08a, #e7a933);}
  .ct-paliers{display:flex; gap:3px;}
  .ct-paliers i{width:6px; height:6px; border-radius:50%; background:rgba(255,255,255,.15);}
  .ct-paliers i.on{background:#F2C14E;}

  /* ---------- messages ---------- */
  .ct-toasts{position:fixed; left:50%; bottom:max(22px, env(safe-area-inset-bottom)); transform:translateX(-50%); z-index:700; display:grid; gap:8px; justify-items:center; pointer-events:none; width:max-content; max-width:calc(100vw - 32px);}
  .ct-toast{display:flex; align-items:center; gap:8px; padding:11px 16px; border-radius:14px; font-size:14px; font-weight:600; color:var(--ink); background:rgba(16,21,29,.92); border:1px solid rgba(255,255,255,.14); box-shadow:0 14px 34px rgba(0,0,0,.45); backdrop-filter:blur(12px); -webkit-backdrop-filter:blur(12px); animation:ctToast .35s cubic-bezier(.2,1.2,.4,1) both;}
  .ct-toast .ct-ico{color:#4FB4FF;}
  .ct-toast.err{border-color:rgba(229,105,92,.5);}
  .ct-toast.err .ct-ico{color:#E5695C;}

  /* ---------- animations ---------- */
  @keyframes ctBord{to{--ct-a:360deg;}}
  @keyframes ctLum{0%{background-position:130% 0;} 55%,100%{background-position:-30% 0;}}
  @keyframes ctFlotte2{0%,100%{transform:translateY(0) rotateZ(-1.4deg);} 50%{transform:translateY(-11px) rotateZ(1.2deg);}}
  @keyframes ctFondu{from{opacity:0;} to{opacity:1;}}
  @keyframes ctMonte{from{opacity:0; transform:translateY(18px) scale(.98);} to{opacity:1; transform:none;}}
  @keyframes ctToast{from{opacity:0; transform:translateY(12px) scale(.96);} to{opacity:1; transform:none;}}
  @keyframes ctArrivee{from{opacity:0; transform:translateY(-60px) scale(.7) rotate(-8deg);} to{opacity:1; transform:none;}}
  @keyframes ctTremble{0%{transform:translate(0,0) rotate(0);} 25%{transform:translate(-2px,1px) rotate(-1deg);} 50%{transform:translate(2px,-1px) rotate(1deg);} 75%{transform:translate(-1px,-1px) rotate(-.5deg);} 100%{transform:translate(0,0) rotate(0);}}
  @keyframes ctLumiere{0%{opacity:0; transform:translate(-50%, -50%) scale(0);} 25%{opacity:1;} 100%{opacity:0; transform:translate(-50%, -50%) scale(3.2);}}
  @keyframes ctFlash{0%{opacity:.95;} 100%{opacity:0;}}
  @keyframes ctTourne{to{transform:translate(-50%, -50%) rotate(360deg);}}
  @keyframes ctSecousse{10%,90%{transform:translate(-2px, 1px);} 20%,80%{transform:translate(4px, -2px);} 30%,50%,70%{transform:translate(-7px, 3px);} 40%,60%{transform:translate(7px, -3px);}}
  @keyframes ctDonne{from{opacity:0; transform:translate(var(--dx, 0), var(--dy, 0)) scale(.35) rotate(var(--rot, 0deg));} 60%{opacity:1;} to{opacity:1; transform:none;}}
  @keyframes ctPouls{0%,100%{filter:brightness(1);} 50%{filter:brightness(1.25) drop-shadow(0 0 14px var(--pc));}}
  @keyframes ctCharge{0%{transform:translate(0,0) rotate(0);} 25%{transform:translate(-2px,1px) rotate(-1.2deg);} 50%{transform:translate(2px,-1px) rotate(1.2deg);} 75%{transform:translate(-1px,-2px) rotate(-.6deg);} 100%{transform:translate(0,0) rotate(0);}}
  @keyframes ctEtiq{from{opacity:0; transform:translate(-50%, 8px) scale(.7);} to{opacity:1; transform:translate(-50%, 0) scale(1);}}
  @keyframes ctTitre{0%{opacity:0; letter-spacing:.6em; transform:scale(1.2);} 25%{opacity:1; letter-spacing:.18em; transform:scale(1);} 75%{opacity:1;} 100%{opacity:0; transform:translateY(-14px);}}
  @keyframes ctIndice{0%{left:8%; opacity:0;} 15%{opacity:1;} 70%{left:88%; opacity:1;} 100%{left:88%; opacity:0;}}

  @media (max-width:820px){
    .ct-vitrine{padding:18px 14px 20px;}
    .ct-car{margin:2px -14px 0;}
    .ct-deux, .ct-bonus{grid-template-columns:1fr;}
    .ct-bonus .ct-panneau.roue{grid-row:auto;}
    .ct-fiche{grid-template-columns:1fr;}
    .ct-fiche-carte{width:min(260px, 72%); margin:0 auto;}
  }
  @media (max-width:640px){
    .ct{padding:0 12px 90px;}
    .ct-tete{flex-wrap:wrap; gap:10px 12px;}
    .ct-ress{width:100%; flex-wrap:nowrap; justify-content:flex-start; gap:6px;}
    .ct-res{flex:1 1 auto; justify-content:center; gap:6px; padding:0 9px; min-width:0;}
    .ct-res small:not([data-recharge]){display:none;}
    .ct-res small[data-recharge]{white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
    .ct-res:has(small[data-recharge]){flex:2.4 1 auto;}
    .ct-btn-ico{flex:none;}
    .ct-car{height:296px;}
    .ct-car .ct-pack{--pk-w:156px;}
    .ct-car-item{--pas:min(150px, 38vw);}
    .ct-car-fl{width:38px; height:38px; margin-top:-19px;}
    .ct-car-fl.g{left:10px;} .ct-car-fl.d{right:10px;}
    .ct-vit-info h2{font-size:25px;}
    .ct-vit-info p{font-size:14px;}
    .ct-ouvrir .ct-btn.grand{flex:1 1 auto; min-height:46px; padding:0 14px;}
    .ct-ouvrir .ct-btn.principal{flex:1 1 100%;}
    .ct-onglet{padding:0 12px; font-size:13px;}
    .ct-onglet .ct-ico{display:none;}
    .ct-grille{grid-template-columns:repeat(3, minmax(0, 1fr)); gap:12px 9px;}
    .ct-raretes{grid-template-columns:repeat(6, minmax(0, 1fr)); gap:6px;}
    .ct-rar-btn{grid-column:span 2; padding:9px 10px;}
    .ct-rar-btn:nth-child(n+4){grid-column:span 3;}
    .ct-prog-droite .lib span:last-child{white-space:nowrap;}
    .ct-legende b{font-size:12.5px;} .ct-legende div{font-size:10.5px;}
    .ct-donne{gap:34px 10px;}
    .ct-serie{gap:4px;}
    .ct-jour{padding:8px 1px; font-size:9.5px;} .ct-jour b{font-size:10.5px;}
    .ct-creneaux{grid-template-columns:repeat(2, minmax(0, 1fr));}
    .ct-pochettes{grid-template-columns:repeat(3, minmax(0, 1fr));}
    .ct-fen{padding:20px 16px;}
  }
  @media (prefers-reduced-motion:reduce){
    .ct-carte, .ct-c-reflet, .ct-pack, .ct-car-item.centre .ct-pack, .ct-vit-info-in, .ct-pk-haut::after, .ct-pk-corps::before, .ct-dos, .ct-rayons, .ct-pk-indice{animation:none !important;}
    .ct-volte, .ct-roue-disque{transition-duration:.01s !important;}
  }`;

  function poserStyle(){
    if(document.getElementById('ct-style')) return;
    const s = document.createElement('style');
    s.id = 'ct-style';
    s.textContent = STYLE;
    document.head.appendChild(s);
    // Les ornements des cartes, dessinés une fois et réutilisés par chaque carte (<use>).
    if(!document.getElementById('ct-sprite')) document.body.insertAdjacentHTML('beforeend', SPRITE.replace('<svg ', '<svg id="ct-sprite" '));
  }

  // ---------------------------------------------------------------------
  // Petits outils
  // ---------------------------------------------------------------------

  async function appel(nom, args){
    const { data, error } = await BD.jeuAppel(nom, args || {});
    if(error) throw new Error(error.message || 'Une erreur est survenue. Réessaie dans un instant.');
    if(data === null || data === undefined) throw new Error('Connecte-toi pour jouer.');
    return data;
  }

  function toast(texte, genre){
    let boite = document.querySelector('.ct-toasts');
    if(!boite){ boite = el('div', 'ct-toasts'); boite.setAttribute('role', 'status'); document.body.appendChild(boite); }
    const t = el('div', 'ct-toast' + (genre === 'err' ? ' err' : ''), ico(genre === 'err' ? 'croix' : 'coche', 16) + '<span></span>');
    t.querySelector('span').textContent = texte;
    boite.appendChild(t);
    setTimeout(() => { t.style.transition = 'opacity .3s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, genre === 'err' ? 4200 : 2800);
  }

  const vibre = (m) => { try{ if(navigator.vibrate) navigator.vibrate(m); }catch(e){} };

  // ---------------------------------------------------------------------
  // Le son : tout est synthétisé (rien à charger), coupable d'un clic
  // ---------------------------------------------------------------------

  const Son = {
    ctx: null,
    actif(){ try{ return localStorage.getItem('lw-cartes-son') !== '0'; }catch(e){ return true; } },
    basculer(){ const v = !this.actif(); try{ localStorage.setItem('lw-cartes-son', v ? '1' : '0'); }catch(e){} return v; },
    pret(){
      if(!this.actif()) return null;
      try{
        if(!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        if(this.ctx.state === 'suspended') this.ctx.resume();
      }catch(e){ return null; }
      return this.ctx;
    },
    bruit(debut, duree, f0, f1, vol, q){
      const a = this.ctx, n = Math.floor(a.sampleRate * duree), buf = a.createBuffer(1, n, a.sampleRate), d = buf.getChannelData(0);
      for(let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      const src = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain(), t = a.currentTime + debut;
      src.buffer = buf; f.type = 'bandpass'; f.Q.value = q || 1.2;
      f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + duree);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + duree * .15); g.gain.exponentialRampToValueAtTime(0.0001, t + duree);
      src.connect(f); f.connect(g); g.connect(a.destination); src.start(t); src.stop(t + duree + .02);
    },
    cloche(f, debut, duree, vol){
      const a = this.ctx, t = a.currentTime + debut;
      [[1, 1], [2.76, .35], [5.4, .12]].forEach(([m, v]) => {
        const o = a.createOscillator(), g = a.createGain();
        o.type = 'sine'; o.frequency.setValueAtTime(f * m, t);
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol * v, t + .01); g.gain.exponentialRampToValueAtTime(0.0001, t + duree / m);
        o.connect(g); g.connect(a.destination); o.start(t); o.stop(t + duree + .05);
      });
    },
    ton(f0, f1, debut, duree, vol, type){
      const a = this.ctx, t = a.currentTime + debut, o = a.createOscillator(), g = a.createGain();
      o.type = type || 'sine'; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + duree);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + duree * .3); g.gain.exponentialRampToValueAtTime(0.0001, t + duree);
      o.connect(g); g.connect(a.destination); o.start(t); o.stop(t + duree + .05);
    },
    jouer(quoi){
      if(!this.pret()) return;
      try{
        if(quoi === 'dechire'){ this.bruit(0, .38, 900, 3800, .35, .8); this.bruit(.04, .2, 2400, 5200, .18, 2); }
        else if(quoi === 'donne'){ this.bruit(0, .12, 500, 1600, .07, 1.5); }
        else if(quoi === 'volte'){ this.bruit(0, .1, 1800, 700, .1, 1.4); }
        else if(quoi === 'charge'){ this.ton(160, 620, 0, .8, .07, 'sawtooth'); this.ton(320, 1240, 0, .8, .03); }
        else if(quoi === 'r1'){ this.cloche(784, 0, .5, .05); }
        else if(quoi === 'r2'){ this.cloche(880, 0, .7, .07); this.cloche(1175, .08, .7, .05); }
        else if(quoi === 'r3'){ [784, 988, 1319].forEach((f, k) => this.cloche(f, k * .08, 1, .07)); }
        else if(quoi === 'r4'){ [523, 659, 784, 1047, 1319].forEach((f, k) => this.cloche(f, k * .07, 1.4, .07)); this.ton(65, 55, 0, 1.2, .14); }
        else if(quoi === 'r5'){ [392, 523, 659, 784, 1047, 1319, 1568, 2093].forEach((f, k) => this.cloche(f, k * .06, 1.8, .07)); this.ton(55, 41, 0, 1.6, .18); this.bruit(0, 1, 4000, 9000, .04, .6); }
        else if(quoi === 'holo'){ [1568, 2093, 2637, 3136].forEach((f, k) => this.cloche(f, .1 + k * .05, .7, .03)); }
        else if(quoi === 'gain'){ this.cloche(1047, 0, .4, .06); this.cloche(1568, .07, .5, .05); }
        else if(quoi === 'niveau'){ [523, 659, 784, 1047].forEach((f, k) => this.cloche(f, k * .11, 1, .08)); }
        else if(quoi === 'tic'){ this.bruit(0, .03, 3000, 2000, .05, 3); }
      }catch(e){ /* un navigateur sans audio : on joue en silence */ }
    }
  };

  // ---------------------------------------------------------------------
  // Les particules : un seul canevas, qui ne tourne que tant qu'il a de quoi dessiner
  // ---------------------------------------------------------------------

  function Effets(canvas){
    const g = canvas.getContext('2d');
    let parts = [], boucle = 0, l = 0, h = 0;
    function taille(){
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      l = canvas.clientWidth; h = canvas.clientHeight;
      canvas.width = l * dpr; canvas.height = h * dpr;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    taille();
    window.addEventListener('resize', taille);
    function image(){
      g.clearRect(0, 0, l, h);
      parts = parts.filter(p => p.vie > 0);
      for(const p of parts){
        p.vie -= 1; p.vx *= p.frein; p.vy = p.vy * p.frein + p.grav; p.x += p.vx; p.y += p.vy; p.rot += p.vr;
        if(p.vers){ p.x += (p.vers.x - p.x) * .08; p.y += (p.vers.y - p.y) * .08; }
        const a = Math.min(1, p.vie / p.vie0 * 1.6);
        g.globalAlpha = a;
        if(p.forme === 'confetti'){
          g.save(); g.translate(p.x, p.y); g.rotate(p.rot); g.fillStyle = p.c; g.fillRect(-p.t / 2, -p.t * .35, p.t, p.t * .7); g.restore();
        }else{
          g.globalCompositeOperation = 'lighter';
          const r = p.t * (.6 + a * .4);
          const grd = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 3);
          grd.addColorStop(0, p.c); grd.addColorStop(.25, p.c); grd.addColorStop(1, 'rgba(0,0,0,0)');
          g.fillStyle = grd; g.beginPath(); g.arc(p.x, p.y, r * 3, 0, Math.PI * 2); g.fill();
          g.globalCompositeOperation = 'source-over';
        }
      }
      g.globalAlpha = 1;
      boucle = parts.length ? requestAnimationFrame(image) : 0;
    }
    function lancer(){ if(!boucle) boucle = requestAnimationFrame(image); }
    return {
      gerbe(x, y, couleurs, n, o){
        if(calme()) return;
        o = o || {};
        for(let i = 0; i < n; i++){
          const a = Math.random() * Math.PI * 2, v = (o.vitesse || 7) * (.35 + Math.random() * .9);
          const vie = (o.vie || 60) * (.6 + Math.random() * .6);
          parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - (o.monte || 0), grav: o.grav === undefined ? .12 : o.grav, frein: o.frein || .95,
            t: (o.taille || 3) * (.6 + Math.random() * .8), c: couleurs[i % couleurs.length], vie, vie0: vie, rot: Math.random() * 6, vr: (Math.random() - .5) * .3, forme: 'etincelle' });
        }
        lancer();
      },
      aspire(x, y, couleur, n){
        if(calme()) return;
        for(let i = 0; i < n; i++){
          const a = Math.random() * Math.PI * 2, d = 140 + Math.random() * 160;
          parts.push({ x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, vx: 0, vy: 0, grav: 0, frein: 1, t: 2 + Math.random() * 2, c: couleur, vie: 34, vie0: 34, rot: 0, vr: 0, forme: 'etincelle', vers: { x, y } });
        }
        lancer();
      },
      pluie(couleurs, n){
        if(calme()) return;
        for(let i = 0; i < n; i++){
          const vie = 140 + Math.random() * 80;
          parts.push({ x: Math.random() * l, y: -20 - Math.random() * h * .4, vx: (Math.random() - .5) * 2, vy: 2 + Math.random() * 3, grav: .05, frein: .995,
            t: 7 + Math.random() * 6, c: couleurs[i % couleurs.length], vie, vie0: vie, rot: Math.random() * 6, vr: (Math.random() - .5) * .25, forme: 'confetti' });
        }
        lancer();
      },
      fin(){ cancelAnimationFrame(boucle); boucle = 0; parts = []; window.removeEventListener('resize', taille); }
    };
  }

  // ---------------------------------------------------------------------
  // Les fenêtres
  // ---------------------------------------------------------------------

  function fenetre(html, large, onFermer){
    const voile = el('div', 'ct-voile');
    voile.innerHTML = `<div class="ct-fen${large ? ' large' : ''}" role="dialog" aria-modal="true"><button type="button" class="ct-fermer" aria-label="Fermer">${ico('croix', 18)}</button><div class="ct-fen-corps">${html}</div></div>`;
    const avant = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    document.body.appendChild(voile);
    let ferme = false;
    function fermer(){
      if(ferme) return;
      ferme = true;
      voile.remove();
      if(!document.querySelector('.ct-voile, .ct-scene')) document.documentElement.style.overflow = avant;
      document.removeEventListener('keydown', touche);
      if(onFermer) onFermer();
    }
    function touche(ev){
      if(ev.key !== 'Escape') return;
      const tous = document.querySelectorAll('.ct-voile');
      if(tous[tous.length - 1] === voile) fermer();
    }
    voile.querySelector('.ct-fermer').addEventListener('click', fermer);
    voile.addEventListener('click', (ev) => { if(ev.target === voile) fermer(); });
    document.addEventListener('keydown', touche);
    setTimeout(() => { const f = voile.querySelector('.ct-fermer'); if(f) f.focus({ preventScroll: true }); }, 30);
    return { fermer, corps: voile.querySelector('.ct-fen-corps'), voile };
  }

  // ---------------------------------------------------------------------
  // La carte d'artiste
  // ---------------------------------------------------------------------

  function carteHtml(c, o){
    o = o || {};
    const r = Math.min(Math.max(Number(c.rarete) || 1, 1), 5);
    const verrou = !!o.verrou;
    const holo = !!c.holo && !verrou;
    const lg = String(c.nom || '').length;
    const taille = lg <= 10 ? 1 : (lg <= 13 ? .86 : (lg <= 16 ? .72 : .6));
    const sous = [c.ville, c.sorties ? pluriel(c.sorties, 'sortie') : ''].filter(Boolean).join(' · ') || 'Scène francophone';
    return `
      <div class="ct-carte r${r}${holo ? ' holo' : ''}${verrou ? ' verrou' : ''}${o.vivante ? ' vivante' : ''}${/^[a-z-]+$/.test(c.classeur || '') ? ' cl-' + c.classeur : ''}" style="--nf:${taille}">
        <div class="ct-c-in">
          <div class="ct-c-fond"></div>
          <div class="ct-c-art">
            <img class="ct-c-photo" src="${esc(safeUrl(c.photo))}" alt="" loading="${o.eager ? 'eager' : 'lazy'}" decoding="async">
            <div class="ct-c-teinte"></div>
            <div class="ct-c-motif"></div>
          </div>
          <svg class="ct-c-orn" aria-hidden="true"><use href="#ct-orn-${r}" width="100%" height="100%"/></svg>
          <span class="ct-c-num">${numero(c.numero)}</span>
          ${holo ? '<span class="ct-c-holo">HOLO</span>' : `<span class="ct-c-marque">${NOM_CLASSEUR[c.classeur] || 'LA WAVE'}</span>`}
          <span class="ct-c-gemme" aria-hidden="true"></span>
          ${verrou ? `<span class="ct-c-cadenas">${ico('cadenas', 24)}</span>` : ''}
          <div class="ct-c-plaque">
            <div>
              <div class="ct-c-nom">${esc(c.nom)}</div>
              <div class="ct-c-sous">${esc(sous)}</div>
            </div>
            <div class="ct-c-stats">
              <div class="ct-c-stat"><b>${c.fans ? esc(court(c.fans)) : '—'}</b><span>Fans</span></div>
              <div class="ct-c-stat"><b>${c.sorties ? esc(nf(c.sorties)) : '—'}</b><span>Sorties</span></div>
              <div class="ct-c-stat rar"><b>${esc(rar(r).nom)}</b><span>Rareté</span></div>
            </div>
          </div>
          <div class="ct-c-reflet"></div>
        </div>
        ${o.quantite && c.quantite > 1 ? `<span class="ct-c-badge">×${c.quantite}</span>` : ''}
        ${o.nouveau ? '<span class="ct-c-nouveau">Nouveau</span>' : ''}
      </div>`;
  }
  // Une carte qui suit le pointeur : elle penche, et son reflet holographique glisse.
  function inclinable(zone, cible){
    if(!zone || calme()) return;
    const carte = () => cible || zone.querySelector('.ct-carte');
    zone.addEventListener('pointermove', (ev) => {
      const c = carte(); if(!c || ev.pointerType === 'touch') return;
      const b = c.getBoundingClientRect();
      const x = (ev.clientX - b.left) / b.width, y = (ev.clientY - b.top) / b.height;
      c.style.transform = `rotateY(${((x - .5) * 16).toFixed(1)}deg) rotateX(${((.5 - y) * 14).toFixed(1)}deg)`;
      c.style.setProperty('--hx', (x * 100).toFixed(0) + '%');
      c.style.setProperty('--hy', (y * 100).toFixed(0) + '%');
      c.style.setProperty('--ct-lum', (130 - x * 160).toFixed(0) + '%');
    });
    zone.addEventListener('pointerleave', () => { const c = carte(); if(c) c.style.transform = ''; });
  }

  // ---------------------------------------------------------------------
  // L'état du joueur, l'en-tête, les onglets
  // ---------------------------------------------------------------------

  const S = {
    hote: null, etat: null, vue: 'packs', occupe: false, minuteur: null, corps: null,
    col: { page: 1, vue: 'toutes', rarete: null, q: '', tri: 'numero', classeur: null }
  };

  function duree(s){
    s = Math.max(0, Math.floor(s));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    if(h >= 24) return Math.ceil(s / 86400) + ' j';
    return h ? h + ' h ' + String(m).padStart(2, '0') : m + ':' + String(x).padStart(2, '0');
  }

  function enteteHtml(){
    const e = S.etat;
    const part = Math.max(0, Math.min(1, (e.xp - e.xp_depart) / Math.max(1, e.xp_fin - e.xp_depart)));
    const circ = 2 * Math.PI * 20;
    return `
      <div class="ct-niv" title="Niveau ${e.niveau}">
        <svg viewBox="0 0 46 46"><circle cx="23" cy="23" r="20" fill="none" stroke="rgba(255,255,255,.1)" stroke-width="3.5"/>
          <circle cx="23" cy="23" r="20" fill="none" stroke="#4FB4FF" stroke-width="3.5" stroke-linecap="round" stroke-dasharray="${circ.toFixed(1)}" stroke-dashoffset="${(circ * (1 - part)).toFixed(1)}"/></svg>
        <b>${e.niveau}</b>
      </div>
      <div class="ct-qui"><b>Niveau ${e.niveau}</b><small>${nf(e.xp - e.xp_depart)} / ${nf(e.xp_fin - e.xp_depart)} XP · ${nf(e.uniques)} / ${nf(e.total_cartes)} artistes</small></div>
      <div class="ct-ress">
        <div class="ct-res" title="Un tirage = un pack. +3 toutes les 10 minutes, jusqu'à ${e.plafond}.">${ico('eclair', 17)}${nf(e.tirages)}<small>/ ${e.plafond}</small><small data-recharge></small></div>
        <div class="ct-res vinyles" title="Vinyles : gagnés en recyclant tes doublons, dépensés à l'atelier.">${ico('vinyle', 17)}${nf(e.vinyles)}</div>
        ${e.garantis > 0 ? `<button type="button" class="ct-res garanti" data-garanti title="Ouvrir un pack Épique garanti">${ico('pack', 17)}${e.garantis}<small>Épique garanti</small></button>` : ''}
        <button type="button" class="ct-btn-ico" data-son aria-label="${Son.actif() ? 'Couper le son' : 'Remettre le son'}">${ico(Son.actif() ? 'son' : 'muet', 18)}</button>
      </div>`;
  }

  function aRecuperer(e){
    return (e.cadeau_pret ? 1 : 0) + (e.roue_prete ? 1 : 0) + (e.coffres_prets || 0);
  }

  function ongletsHtml(){
    const e = S.etat;
    const pastilles = { missions: e.missions_pretes || 0, bonus: aRecuperer(e) };
    const icones = { packs: 'pack', collection: 'cartes', missions: 'cible', bonus: 'cadeau', succes: 'trophee' };
    return VUES.map(([id, nom]) => `
      <button type="button" class="ct-onglet${S.vue === id ? ' actif' : ''}" data-vue="${id}" role="tab" aria-selected="${S.vue === id}">
        ${ico(icones[id], 17)}${esc(nom)}${pastilles[id] ? `<span class="ct-pastille">${pastilles[id]}</span>` : ''}
      </button>`).join('');
  }

  function majEntete(){
    if(!S.hote || !S.etat) return;
    const t = S.hote.querySelector('.ct-tete');
    if(t) t.innerHTML = enteteHtml();
    const n = S.hote.querySelector('.ct-onglets');
    if(n) n.innerHTML = ongletsHtml();
    if(typeof majPastilleCartes === 'function') majPastilleCartes(S.etat);
    tic();
  }

  function tic(){
    const e = S.etat;
    const z = S.hote && S.hote.querySelector('[data-recharge]');
    if(!e || !z) return;
    if(e.tirages >= e.plafond || e.prochain_dans === null || e.prochain_dans === undefined){ z.textContent = ''; return; }
    const restant = e.prochain_dans - Math.floor((Date.now() - (e._le || Date.now())) / 1000);
    if(restant <= 0){
      z.textContent = '· …';
      if(!S.occupe) rafraichirEtat();
      return;
    }
    z.textContent = '· +3 dans ' + duree(restant);
  }

  async function rafraichirEtat(){
    if(S.rafraichit) return;
    S.rafraichit = true;
    try{ poserEtat(await appel('jeu_etat')); majEntete(); }catch(e){ /* le prochain tour réessaie */ }
    S.rafraichit = false;
  }

  function poserEtat(etat){
    if(!etat) return;
    S.etat = etat;
    S.etat._le = Date.now();
  }

  // ---------------------------------------------------------------------
  // Monter la page
  // ---------------------------------------------------------------------

  function invite(hote, titre, texte){
    hote.innerHTML = `<div class="ct"><div class="ct-panneau ct-vide"><b>${esc(titre)}</b>${texte}${currentUser ? '' : '<div style="margin-top:18px"><button type="button" class="ct-btn principal" data-connexion>Se connecter</button></div>'}</div></div>`;
    const b = hote.querySelector('[data-connexion]');
    if(b) b.addEventListener('click', () => { if(typeof openAuthModal === 'function') openAuthModal('login'); });
  }

  async function monter(hote){

    poserStyle();
    S.hote = hote;

    if(!currentUser){
      invite(hote, 'Ta collection t\'attend', 'Connecte-toi pour jouer à Wave Cards : ouvre des boosters et collectionne les artistes de la scène francophone.');
      return;
    }

    if(!hote.querySelector('.ct')) hote.innerHTML = '<div class="ct"><div class="ct-vide">Chargement…</div></div>';

    try{
      poserEtat(await appel('jeu_etat'));
    }catch(e){
      invite(hote, 'Le jeu n\'a pas pu s\'ouvrir', esc(e.message));
      return;
    }

    const demande = (location.hash.split('/')[2] || '').toLowerCase();
    S.vue = VUES.some(v => v[0] === demande) ? demande : (VUES.some(v => v[0] === S.vue) ? S.vue : 'packs');

    hote.innerHTML = `
      <div class="ct">
        <div class="ct-tete"></div>
        <nav class="ct-onglets" role="tablist" aria-label="Wave Cards"></nav>
        <div class="ct-corps"></div>
      </div>`;

    S.corps = hote.querySelector('.ct-corps');
    majEntete();

    if(!hote.dataset.ctBranche){
      hote.dataset.ctBranche = '1';
      hote.addEventListener('click', (ev) => {
        const v = ev.target.closest('[data-vue]');
        if(v && hote.contains(v)){ changerVue(v.dataset.vue); return; }
        if(ev.target.closest('.ct-tete [data-garanti]')){ ouvrir(1, true); return; }
        if(ev.target.closest('.ct-tete [data-son]')){ Son.basculer(); if(Son.actif()) Son.jouer('tic'); majEntete(); }
      });
    }

    clearInterval(S.minuteur);
    S.minuteur = setInterval(() => { if(S.hote && S.hote.isConnected) tic(); else clearInterval(S.minuteur); }, 1000);

    await afficherVue(S.vue);

    // Le cadeau du jour s'offre de lui-même, une fois par visite.
    if(S.etat.cadeau_pret && !S.cadeauPropose){
      S.cadeauPropose = true;
      setTimeout(() => { if(S.hote && S.hote.isConnected && !document.querySelector('.ct-voile, .ct-scene')) fenetreCadeau(); }, 700);
    }
  }

  function quitter(){
    clearInterval(S.minuteur);
  }

  function changerVue(v){
    if(S.vue === v && S.corps && S.corps.children.length) return;
    S.vue = v;
    try{ history.replaceState(history.state, '', '#community/cartes/' + v); }catch(e){}
    majEntete();
    afficherVue(v);
  }

  async function afficherVue(v){
    if(!S.corps.querySelector('.ct-panneau')) S.corps.innerHTML = '<div class="ct-vide">Chargement…</div>';
    try{
      if(v === 'packs') await vuePacks();
      else if(v === 'collection') await vueCollection();
      else if(v === 'missions') await vueMissions();
      else if(v === 'bonus') await vueBonus();
      else if(v === 'succes') await vueSucces();
    }catch(e){
      S.corps.innerHTML = `<div class="ct-panneau ct-vide">${esc(e.message)}</div>`;
    }
  }

  const gainsHtml = (g) => [
    g.tirages ? `<span class="ct-gain">${ico('eclair', 13)}+${g.tirages}</span>` : '',
    g.vinyles ? `<span class="ct-gain v">${ico('vinyle', 13)}+${g.vinyles}</span>` : '',
    g.garantis ? `<span class="ct-gain g">${ico('pack', 13)}Épique</span>` : ''
  ].join('');
  const gainsTexte = (g) => [g.tirages ? '+' + g.tirages + ' tirages' : '', g.vinyles ? '+' + g.vinyles + ' vinyles' : '', g.garantis ? 'un pack Épique garanti' : ''].filter(Boolean).join(', ');

  // ---------------------------------------------------------------------
  // Packs
  // ---------------------------------------------------------------------

  // Les boosters viennent de la base (jeu_boosters) ; sans eux, le booster de base.
  const REPLI = [{ id: 'scene', nom: 'Scène francophone', serie: 'Série de lancement', description: 'Le pack de référence : un artiste de la scène francophone, tiré parmi tous. Plus il est écouté, plus sa carte est rare.',
    cout: 1, taux: [62, 24, 9.5, 3.8, 0.7], holo_x: 1, theme: 'onde', accent: '#4FB4FF' }];
  const BOOSTER_GARANTI = { id: 'garanti', nom: 'Pack Épique', serie: 'Épique ou mieux', theme: 'garanti', accent: '#A879FF', cout: 0 };

  function packHtml(o){
    o = o || {};
    const b = o.booster || REPLI[0];
    const t = theme(b.theme);
    return `
      <div class="ct-pack t-${t}" style="--teinte:${couleurOk(b.accent)}"${o.attrs || ''}>
        ${o.pile ? Array.from({ length: o.pile }, (_, k) => `<div class="ct-pk-pile" style="transform:translate(${(k + 1) * 7}px, ${(k + 1) * -5}px) rotate(${(k + 1) * 2.5}deg); z-index:-${k + 1}"></div>`).join('') : ''}
        <div class="ct-pk-corps">
          <div class="ct-pk-contenu">
            ${EMBLEMES[t]}
            <div class="ct-pk-marque">LA WAVE</div>
            <div class="ct-pk-nom">${esc(b.nom)}</div>
          </div>
          <div class="ct-pk-pied">${esc(b.serie || '')}</div>
        </div>
        <div class="ct-pk-haut"></div>
        <div class="ct-pk-ligne"></div>
        <div class="ct-pk-lumiere"></div>
        ${o.nombre > 1 ? `<div class="ct-pk-nombre">×${o.nombre}</div>` : ''}
      </div>`;
  }

  async function vuePacks(){

    const e = S.etat;
    const ev = e.evenement || {};
    const fmt = (x) => { const n = Number(x); return (n < 10 ? String(Math.round(n * 10) / 10).replace('.', ',') : String(Math.round(n))) + ' %'; };

    let boosters = [];
    try{ boosters = await appel('jeu_boosters'); }catch(err){ boosters = []; }
    if(!Array.isArray(boosters) || !boosters.length) boosters = REPLI;
    S.boosters = boosters;
    let cur = Math.max(0, boosters.findIndex(b => b.id === S.booster));
    S.booster = boosters[cur].id;

    let recentes = [];
    try{ recentes = (await appel('jeu_collection_lire', { p_page: 1, p_vue: 'possedees', p_tri: 'recent' })).cartes.slice(0, 10); }catch(err){ /* pas grave */ }

    const attente = aRecuperer(e) + (e.missions_pretes || 0);
    const plusieurs = boosters.length > 1;

    S.corps.innerHTML = `
      <section class="ct-panneau ct-vitrine">
        <div class="ct-vit-tete"><span class="ct-surtitre">${ico('pack', 15)}Wave Cards</span><span class="ct-compte" data-compte></span></div>
        <div class="ct-car" tabindex="0" role="group" aria-roledescription="carrousel" aria-label="Choisis un booster">
          <div class="ct-car-piste">
            ${boosters.map((b, i) => `<div class="ct-car-item" data-i="${i}" role="group" aria-label="${esc(b.nom)}">${packHtml({ booster: b })}</div>`).join('')}
          </div>
          ${plusieurs ? `<button type="button" class="ct-car-fl g" data-dir="-1" aria-label="Booster précédent">${ico('fleche', 20)}</button><button type="button" class="ct-car-fl d" data-dir="1" aria-label="Booster suivant">${ico('fleche', 20)}</button>` : ''}
        </div>
        ${plusieurs ? `<div class="ct-points">${boosters.map((b, i) => `<button type="button" data-i="${i}" aria-label="${esc(b.nom)}"></button>`).join('')}</div>` : ''}
        <div class="ct-vit-info" data-info></div>
        <div class="ct-ouvrir" data-zone-ouvrir></div>
        <div class="ct-hero-note">${ico('horloge', 15)}${e.tirages >= e.plafond ? 'Tes tirages sont au maximum.' : '+3 tirages toutes les 10 minutes, jusqu\'à ' + e.plafond + '.'}</div>
      </section>

      ${attente ? `<button type="button" class="ct-attente" data-aller="${aRecuperer(e) ? 'bonus' : 'missions'}">${ico('cadeau', 22)}<div><b>${pluriel(attente, 'récompense')} à récupérer</b><span>${[e.cadeau_pret ? 'cadeau du jour' : '', e.roue_prete ? 'roue' : '', e.coffres_prets ? 'coffre' : '', e.missions_pretes ? 'missions' : ''].filter(Boolean).join(' · ')}</span></div>${ico('fleche', 18)}</button>` : ''}

      <div class="ct-titre-sec"><h3>Dernières cartes obtenues</h3>${recentes.length ? '<button type="button" class="ct-lien" data-aller="collection">Toute la collection' + ico('fleche', 14) + '</button>' : ''}</div>
      ${recentes.length
        ? `<div class="ct-ruban">${recentes.map((c, i) => `<button type="button" class="ct-case" data-i="${i}" aria-label="${esc(c.nom)}">${carteHtml(c, { quantite: true })}</button>`).join('')}</div>`
        : '<div class="ct-panneau ct-vide"><b>Ta collection est vide</b>Ouvre ton premier pack pour découvrir ta première carte.</div>'}`;

    const vit = S.corps.querySelector('.ct-vitrine');
    const car = vit.querySelector('.ct-car');
    const items = [...vit.querySelectorAll('.ct-car-item')];
    const points = [...vit.querySelectorAll('.ct-points button')];
    const zoneInfo = vit.querySelector('[data-info]');
    const zoneOuvrir = vit.querySelector('[data-zone-ouvrir]');

    // Les cartes de la fiche d'un booster : ses chances, ses événements, ses boutons d'ouverture.
    function majInfo(){
      const b = boosters[cur];
      const taux = (b.taux || []).map(Number);
      const lignes = [1, 2, 3, 4, 5].filter(k => taux[k - 1] > 0);
      const holoP = Number(ev.holo || 0.005) * Number(b.holo_x || 1);
      zoneInfo.innerHTML = `
        <div class="ct-vit-info-in">
          <span class="ct-serie-tag">${esc(b.serie || 'Booster')}</span>
          <h2>${esc(b.nom)}</h2>
          <p>${esc(b.description || '')}</p>
          <div class="ct-vit-taux">
            <div class="ct-taux">${lignes.map(k => `<i style="flex:${Math.max(taux[k - 1], 1.2)}; background:${RAR[k].c}"></i>`).join('')}</div>
            <div class="ct-legende">${lignes.map(k => `<div style="--rc:${RAR[k].c}"><b>${fmt(taux[k - 1])}</b>${esc(RAR[k].nom)}</div>`).join('')}</div>
          </div>
          <div class="ct-evts">
            ${b.classeur ? `<button type="button" class="ct-evt ct-evt-lien" data-classeur="${esc(b.id)}">${ico('cartes', 15)}Classeur exclusif · ${nf(b.nb_cartes || 0)} cartes${b.fin ? ' · jusqu\'au ' + esc(new Date(b.fin + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })) : ''}${ico('fleche', 14)}</button>` : ''}
            <span class="ct-evt">${ico('etoile', 15)}Holo : 1 chance sur ${Math.round(1 / holoP)}</span>
            ${b.id === 'scene' && ev.lundi ? `<span class="ct-evt">${ico('etoile', 15)}Lundi des légendes : Épique et mieux ×2</span>` : ''}
            ${ev.heure_holo ? `<span class="ct-evt">${ico('etoile', 15)}Heure holo jusqu'à 22 h</span>` : ''}
          </div>
        </div>`;
      const cout = Number(b.cout || 1);
      zoneOuvrir.innerHTML = [1, 5, 10].map(n => `<button type="button" class="ct-btn ${n === 1 ? 'principal ' : ''}grand" data-ouvrir="${n}" ${e.tirages < n * cout ? 'disabled' : ''}>${n > 1 ? n + ' packs' : 'Ouvrir un pack'}<span class="cout">${ico('eclair', 12)}${n * cout}</span></button>`).join('');
    }

    function poser(){
      const n = boosters.length;
      items.forEach((it, i) => {
        let o = i - cur;
        if(n >= 3){ if(o > n / 2) o -= n; if(o < -n / 2) o += n; }
        it.style.setProperty('--o', o);
        it.style.setProperty('--abs', Math.min(Math.abs(o), 3));
        it.classList.toggle('centre', o === 0);
        if(Math.abs(o) > 2) it.setAttribute('data-loin', ''); else it.removeAttribute('data-loin');
        it.setAttribute('aria-hidden', o === 0 ? 'false' : 'true');
      });
      points.forEach((p, i) => { p.classList.toggle('actif', i === cur); });
      const cp = vit.querySelector('[data-compte]');
      if(cp) cp.textContent = plusieurs ? (cur + 1) + ' / ' + n : '';
      vit.style.setProperty('--acc', couleurOk(boosters[cur].accent));
      S.booster = boosters[cur].id;
    }

    function aller(i){
      const n = boosters.length;
      const suivant = ((i % n) + n) % n;
      if(suivant === cur) return;
      cur = suivant;
      poser();
      majInfo();
      Son.pret(); Son.jouer('tic');
    }

    poser();
    majInfo();

    vit.addEventListener('click', (ev) => {
      const o = ev.target.closest('[data-ouvrir]');
      if(o){ ouvrir(Number(o.dataset.ouvrir), false, boosters[cur]); return; }
      const f = ev.target.closest('.ct-car-fl');
      if(f){ aller(cur + Number(f.dataset.dir)); return; }
      const k = ev.target.closest('[data-classeur]');
      if(k){ S.col.classeur = k.dataset.classeur; S.col.page = 1; S.col.vue = 'toutes'; S.col.rarete = null; S.col.q = ''; changerVue('collection'); return; }
      const p = ev.target.closest('.ct-points button');
      if(p) aller(Number(p.dataset.i));
    });

    // Glisser le carrousel d'un geste ; toucher un booster de côté le ramène au centre, toucher celui du centre l'ouvre.
    let depart = null;
    car.addEventListener('pointerdown', (ev) => {
      if(ev.target.closest('.ct-car-fl')) return;
      depart = { x: ev.clientX, it: ev.target.closest('.ct-car-item') };
    });
    car.addEventListener('pointerup', (ev) => {
      if(!depart) return;
      const dx = ev.clientX - depart.x, it = depart.it;
      depart = null;
      if(Math.abs(dx) > 40){ aller(cur + (dx < 0 ? 1 : -1)); return; }
      if(!it) return;
      const i = Number(it.dataset.i);
      if(i === cur) ouvrir(1, false, boosters[cur]); else aller(i);
    });
    car.addEventListener('pointercancel', () => { depart = null; });
    car.addEventListener('keydown', (ev) => {
      if(ev.key === 'ArrowLeft'){ ev.preventDefault(); aller(cur - 1); }
      else if(ev.key === 'ArrowRight'){ ev.preventDefault(); aller(cur + 1); }
      else if(ev.key === 'Enter' || ev.key === ' '){ ev.preventDefault(); ouvrir(1, false, boosters[cur]); }
    });

    S.corps.querySelectorAll('[data-aller]').forEach((b) => b.addEventListener('click', () => changerVue(b.dataset.aller)));
    S.corps.querySelectorAll('.ct-ruban [data-i]').forEach((b) => b.addEventListener('click', () => fiche(recentes[Number(b.dataset.i)].id)));
  }

  async function ouvrir(n, garanti, booster){

    if(S.occupe) return;
    const b = booster || (S.boosters || REPLI).find(x => x.id === S.booster) || REPLI[0];
    const cout = garanti ? 0 : Number(b.cout || 1);
    if(!garanti && S.etat && S.etat.tirages < n * cout){ toast('Pas assez de tirages pour l\'instant.', 'err'); return; }
    S.occupe = true;
    Son.pret();

    // Le booster de base s'ouvre comme avant, sans rien demander de plus à la base.
    const args = { p_n: n, p_garanti: !!garanti };
    if(!garanti && b.id !== 'scene') args.p_booster = b.id;

    let r;
    try{
      r = await appel('jeu_ouvrir', args);
    }catch(e){
      toast(e.message, 'err');
      S.occupe = false;
      return;
    }

    poserEtat(r.etat);
    majEntete();

    let encore = false;
    try{ encore = await scene(r.cartes, garanti, b); }
    finally{ S.occupe = false; }

    for(const nv of (r.niveaux || [])) await niveauAtteint(nv);

    if(encore){ ouvrir(n, false, b); return; }
    if(S.vue === 'packs' || S.vue === 'collection') afficherVue(S.vue);
  }
  function niveauAtteint(nv){
    return new Promise((fin) => {
      Son.jouer('niveau');
      vibre([30, 50, 30]);
      const f = fenetre(`
        <div style="text-align:center; padding:6px 0 2px">
          <span class="ct-surtitre" style="justify-content:center">${ico('etoile', 15)}Niveau supérieur</span>
          <div style="font-size:72px; font-weight:900; line-height:1.05; margin:10px 0 6px; letter-spacing:-.03em; background:linear-gradient(180deg, #fff, #8fcfff); -webkit-background-clip:text; background-clip:text; color:transparent">${nv.niveau}</div>
          <div class="ct-gains" style="justify-content:center">${gainsHtml(nv)}</div>
          <p class="sous" style="margin-top:12px">Ton plafond de tirages grandit avec ton niveau.</p>
          <div style="margin-top:20px"><button type="button" class="ct-btn principal" data-ok>Continuer</button></div>
        </div>`, false, fin);
      f.corps.querySelector('[data-ok]').addEventListener('click', f.fermer);
    });
  }

  // ---------------------------------------------------------------------
  // La scène d'ouverture
  //   1. le pack arrive ; on le déchire d'un geste (ou d'un toucher) ;
  //   2. les cartes sortent face cachée, leur lueur annonce leur rareté ;
  //   3. on les retourne une à une (ou toutes) ; les grandes cartes ont leur moment ;
  //   4. le bilan, rouvrir ou terminer.
  // Renvoie vrai si le joueur veut rouvrir le même nombre de packs.
  // ---------------------------------------------------------------------

  function scene(cartes, garanti, booster){

    return new Promise((fin) => {

      booster = garanti ? BOOSTER_GARANTI : (booster || REPLI[0]);
      const cout = garanti ? 0 : Number(booster.cout || 1);

      const n = cartes.length;
      const meilleure = cartes.reduce((m, c) => Math.max(m, Number(c.rarete) || 1), 1);
      const teinteMeilleure = meilleure >= 3 ? RAR[meilleure].c : '#4FB4FF';

      const ov = el('div', 'ct-scene');
      ov.setAttribute('role', 'dialog');
      ov.setAttribute('aria-modal', 'true');
      ov.setAttribute('aria-label', 'Ouverture de pack');
      ov.innerHTML = `
        <div class="ct-scene-fond"></div>
        <div class="ct-rayons"></div>
        <div class="ct-flash"></div>
        <canvas></canvas>
        <button type="button" class="ct-scene-x" aria-label="Fermer">${ico('croix', 20)}</button>
        <div class="ct-scene-centre"></div>
        <div class="ct-scene-pied"></div>`;
      const avant = document.documentElement.style.overflow;
      document.documentElement.style.overflow = 'hidden';
      document.body.appendChild(ov);

      const centre = ov.querySelector('.ct-scene-centre');
      const pied = ov.querySelector('.ct-scene-pied');
      const flash = ov.querySelector('.ct-flash');
      const rayons = ov.querySelector('.ct-rayons');
      const fx = Effets(ov.querySelector('canvas'));
      let fini = false, phase = 'pack', occupe = false;
      const retournees = new Set();

      const teinte = (c) => ov.style.setProperty('--teinte', c);
      const eclair = () => { flash.classList.remove('on'); void flash.offsetWidth; flash.classList.add('on'); };
      teinte('#1489DE');

      function fermer(rouvrir){
        if(fini) return;
        fini = true;
        fx.fin();
        document.removeEventListener('keydown', touche);
        ov.style.transition = 'opacity .25s';
        ov.style.opacity = '0';
        setTimeout(() => {
          ov.remove();
          if(!document.querySelector('.ct-voile, .ct-scene')) document.documentElement.style.overflow = avant;
          fin(!!rouvrir);
        }, 250);
      }

      function touche(ev){
        if(document.querySelector('.ct-voile')) return;
        if(ev.key === 'Escape'){ fermer(false); return; }
        if(ev.key !== ' ' && ev.key !== 'Enter') return;
        if(ev.target && ev.target.closest && ev.target.closest('button')) return;
        ev.preventDefault();
        if(phase === 'pack') dechirer();
        else if(phase === 'cartes') suivante();
      }
      document.addEventListener('keydown', touche);
      ov.querySelector('.ct-scene-x').addEventListener('click', () => fermer(false));

      const centreDe = (elm) => { const b = elm.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; };

      // ---- 1. le pack
      const zonePack = el('div', 'ct-scene-pack', packHtml({ booster, nombre: n, pile: n > 1 ? Math.min(n - 1, 3) : 0 }));
      centre.appendChild(zonePack);
      const pack = zonePack.querySelector('.ct-pack');
      pack.style.setProperty('--teinte', teinteMeilleure);
      pack.insertAdjacentHTML('beforeend', '<div class="ct-pk-indice"></div>');
      pied.innerHTML = `<p>${'ontouchstart' in window ? 'Glisse ton doigt sur le pack pour le déchirer' : 'Glisse sur le pack pour le déchirer, ou clique dessus'}</p>`;

      // Le geste : on suit le doigt d'un bord à l'autre ; au-delà de 60 %, le pack se déchire.
      let geste = null;
      pack.addEventListener('pointerdown', (ev) => {
        if(phase !== 'pack') return;
        geste = { x: ev.clientX, l: pack.getBoundingClientRect().width, max: 0 };
        try{ pack.setPointerCapture(ev.pointerId); }catch(e){}
        const ind = pack.querySelector('.ct-pk-indice'); if(ind) ind.remove();
      });
      pack.addEventListener('pointermove', (ev) => {
        if(!geste || phase !== 'pack') return;
        const p = Math.min(1, Math.abs(ev.clientX - geste.x) / (geste.l * .9));
        geste.max = Math.max(geste.max, p);
        pack.style.setProperty('--dech', geste.max.toFixed(3));
        if(geste.max > .12) zonePack.classList.add('tremble');
        if(geste.max >= .6){ geste = null; dechirer(); }
      });
      pack.addEventListener('pointerup', () => {
        if(!geste || phase !== 'pack') return;
        const p = geste.max; geste = null;
        if(p < .05) dechirer();
        else{ zonePack.classList.remove('tremble'); pack.style.setProperty('--dech', '0'); }
      });
      pack.addEventListener('pointercancel', () => { geste = null; pack.style.setProperty('--dech', '0'); zonePack.classList.remove('tremble'); });

      async function dechirer(){
        if(phase !== 'pack') return;
        phase = 'dechire';
        const ind = pack.querySelector('.ct-pk-indice'); if(ind) ind.remove();
        pied.innerHTML = '';
        zonePack.classList.add('tremble');

        // La ligne court jusqu'au bout, puis le haut s'envole.
        const debut = parseFloat(pack.style.getPropertyValue('--dech')) || 0;
        const t0 = performance.now();
        await new Promise((ok) => {
          const pas = (t) => {
            const k = Math.min(1, (t - t0) / 220);
            pack.style.setProperty('--dech', (debut + (1 - debut) * k).toFixed(3));
            if(k < 1) requestAnimationFrame(pas); else ok();
          };
          requestAnimationFrame(pas);
        });
        if(fini) return;

        Son.jouer('dechire');
        vibre(meilleure >= 4 ? [20, 30, 60] : 25);
        zonePack.classList.remove('tremble');
        pack.querySelector('.ct-pk-haut').classList.add('part');
        pack.querySelector('.ct-pk-lumiere').classList.add('on');
        teinte(teinteMeilleure);
        const h = pack.querySelector('.ct-pk-ligne').getBoundingClientRect();
        fx.gerbe(h.left + h.width / 2, h.top, ['#ffffff', teinteMeilleure, teinteMeilleure], meilleure >= 4 ? 70 : 40, { vitesse: 9, monte: 3, vie: 55 });
        if(meilleure >= 4) eclair();

        await attendre(calme() ? 50 : 520);
        if(!fini) distribuer();
      }

      // ---- 2. les cartes sortent du pack
      let places = [];
      function distribuer(){
        phase = 'cartes';
        const donne = el('div', 'ct-donne' + (n === 1 ? ' seule' : ''));
        const etroit = window.innerWidth < 640;
        const cols = n === 1 ? 1 : (etroit ? (n === 5 ? 3 : 4) : 5);
        donne.style.setProperty('--cols', cols);
        if(n > 1){
          // Assez petites pour tenir à l'écran sans défiler.
          const lignes = Math.ceil(n / cols);
          const hDispo = window.innerHeight - 64 - 130 - (lignes - 1) * 40 - 30;
          const lc = Math.max(70, Math.min(180, (hDispo / lignes) * 5 / 7, (Math.min(window.innerWidth, 1000) - 32 - (cols - 1) * 14) / cols));
          donne.style.setProperty('--lc', Math.floor(lc) + 'px');
        }
        donne.innerHTML = cartes.map((c, i) => `
          <div class="ct-place" data-i="${i}" style="--rc:${rar(c.rarete).c}">
            <div class="ct-volte" role="button" tabindex="0" aria-label="Retourner la carte ${i + 1}">
              <div class="ct-dos" data-r="${c.rarete}"><div class="ct-dos-in">${EMBLEME}</div></div>
              <div class="ct-face">${carteHtml(c, { vivante: true, eager: true })}</div>
            </div>
          </div>`).join('');

        const depart = centreDe(pack);
        zonePack.classList.add('parti');
        zonePack.style.position = 'absolute';
        centre.appendChild(donne);

        places = [...donne.querySelectorAll('.ct-place')];
        places.forEach((p, i) => {
          const c = centreDe(p);
          p.style.setProperty('--dx', (depart.x - c.x).toFixed(0) + 'px');
          p.style.setProperty('--dy', (depart.y - c.y).toFixed(0) + 'px');
          p.style.setProperty('--rot', ((i % 2 ? 1 : -1) * (6 + i * 2)) + 'deg');
          p.style.animationDelay = (i * 70) + 'ms';
          p.classList.add('donne');
          setTimeout(() => { if(!fini) Son.jouer('donne'); }, i * 70);
          const v = p.querySelector('.ct-volte');
          v.addEventListener('click', () => { if(phase === 'bilan') fiche(cartes[i].id, cartes[i].classeur || null); else retourner(i); });
          v.addEventListener('keydown', (ev) => { if(ev.key === 'Enter' || ev.key === ' '){ ev.preventDefault(); ev.stopPropagation(); v.click(); } });
        });
        setTimeout(() => zonePack.remove(), 700);

        pied.innerHTML = `<p>${n === 1 ? 'Touche la carte pour la retourner' : 'Touche une carte pour la retourner'}</p>${n > 1 ? '<div class="boutons"><button type="button" class="ct-btn blanc" data-tout>Tout retourner</button></div>' : ''}`;
        const bt = pied.querySelector('[data-tout]');
        if(bt) bt.addEventListener('click', toutRetourner);
      }

      function suivante(){
        const i = cartes.findIndex((c, k) => !retournees.has(k));
        if(i >= 0) retourner(i);
      }

      // ---- 3. retourner une carte
      async function retourner(i){
        if(fini || retournees.has(i) || occupe) return;
        occupe = true;
        retournees.add(i);
        const c = cartes[i], r = Number(c.rarete) || 1, p = places[i];
        const pos = centreDe(p);

        if(r >= 3 && !calme()){
          // L'attente : la carte vibre, la lumière se rassemble.
          p.classList.add('charge');
          Son.jouer('charge');
          vibre(r >= 4 ? [15, 40, 15, 40, 15] : 20);
          fx.aspire(pos.x, pos.y, RAR[r].c, r >= 5 ? 60 : (r >= 4 ? 42 : 24));
          await attendre(r >= 5 ? 1150 : (r >= 4 ? 850 : 520));
          p.classList.remove('charge');
        }
        if(fini){ occupe = false; return; }

        p.classList.add('retournee');
        Son.jouer('volte');
        setTimeout(() => {
          if(fini) return;
          Son.jouer('r' + r);
          if(c.holo) Son.jouer('holo');
        }, 180);

        setTimeout(() => {
          if(fini) return;
          // L'étiquette : la rareté pour une grande carte seule, sinon nouvelle carte ou doublon.
          let classe = 'double', texte = 'Doublon ×' + c.quantite;
          if(c.nouvelle){ classe = 'nouveau'; texte = 'Nouveau'; }
          else if(c.nouveau_holo){ classe = 'nouveau'; texte = 'Nouveau holo'; }
          if(n === 1 && r >= 3){ classe = ''; texte = RAR[r].nom + (c.nouvelle ? ' · Nouveau' : ''); }
          p.insertAdjacentHTML('beforeend', `<div class="ct-etiq ${classe}">${esc(texte)}</div>`);

          if(r >= 2) fx.gerbe(pos.x, pos.y, [RAR[r].c, '#ffffff'], r >= 5 ? 110 : (r >= 4 ? 80 : (r >= 3 ? 48 : 18)), { vitesse: r >= 4 ? 11 : 7, vie: r >= 4 ? 70 : 45 });
          if(c.holo) fx.gerbe(pos.x, pos.y, ['#ff9ad5', '#9af7ff', '#fff59a', '#c4a3ff'], 50, { vitesse: 8, vie: 60 });
          if(r >= 4){
            teinte(RAR[r].c);
            rayons.classList.add('on');
            eclair();
            ov.classList.remove('secousse'); void ov.offsetWidth; ov.classList.add('secousse');
            fx.pluie(r >= 5 ? ['#ff5c8a', '#ffb547', '#fff27a', '#5cffc8', '#5cb8ff', '#b36bff'] : ['#F2C14E', '#fff3c4', '#ffffff', '#e9a73a'], r >= 5 ? 160 : 90);
            const titre = el('div', 'ct-titre-rar', esc(RAR[r].nom));
            ov.appendChild(titre);
            setTimeout(() => titre.remove(), 1700);
            if(n > 1) setTimeout(() => rayons.classList.remove('on'), 1800);
          }else if(r === 3){
            teinte(RAR[3].c);
          }
        }, 330);

        await attendre(calme() ? 120 : (r >= 4 ? 900 : (r >= 3 ? 520 : 260)));
        occupe = false;
        if(retournees.size === n && !fini) bilan();
      }

      async function toutRetourner(){
        const bt = pied.querySelector('[data-tout]');
        if(bt) bt.disabled = true;
        for(let i = 0; i < n && !fini; i++){
          if(retournees.has(i)) continue;
          while(occupe && !fini) await attendre(60);
          await retourner(i);
          await attendre(Number(cartes[i].rarete) >= 3 ? 250 : 90);
        }
      }

      // ---- 4. le bilan
      function bilan(){
        phase = 'bilan';
        const nouvelles = cartes.filter(c => c.nouvelle).length;
        const holos = cartes.filter(c => c.holo).length;
        const par = [5, 4, 3].map(r => [r, cartes.filter(c => Number(c.rarete) === r).length]).filter(x => x[1]);
        const peutRouvrir = !garanti && S.etat && S.etat.tirages >= n * cout;
        pied.innerHTML = `
          <div class="ct-bilan">
            <span>${nouvelles ? pluriel(nouvelles, 'nouvel artiste', 'nouveaux artistes') : 'Aucun nouvel artiste'}</span>
            ${par.map(([r, k]) => `<span style="--rc:${RAR[r].c}"><i></i>${k} ${esc(RAR[r].nom)}</span>`).join('')}
            ${holos ? `<span>${pluriel(holos, 'holo')}</span>` : ''}
          </div>
          <div class="boutons">
            ${peutRouvrir ? `<button type="button" class="ct-btn principal" data-encore>${n > 1 ? 'Rouvrir ' + n + ' packs' : 'Rouvrir un pack'}<span class="cout">${ico('eclair', 12)}${n * cout}</span></button>` : ''}
            <button type="button" class="ct-btn ${peutRouvrir ? '' : 'blanc'}" data-fin>Terminer</button>
          </div>`;
        pied.querySelector('[data-fin]').addEventListener('click', () => fermer(false));
        const e = pied.querySelector('[data-encore]');
        if(e) e.addEventListener('click', () => fermer(true));
      }
    });
  }

  // ---------------------------------------------------------------------
  // La fiche d'une carte
  // ---------------------------------------------------------------------

  async function fiche(id, classeur){

    let c;
    try{ c = classeur ? await appel('jeu_classeur_carte', { p_booster: classeur, p_id: id }) : await appel('jeu_carte', { p_id: id }); }catch(e){ toast(e.message, 'err'); return; }

    const r = Number(c.rarete);
    const possede = c.quantite > 0;
    const date = (iso) => iso ? new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' }) : '';

    // Les cartes d'un classeur ne se recyclent ni ne se fabriquent (pas encore) : elles se gagnent dans leur booster.
    const doublons = classeur ? [] : [
      c.normales > 1 ? { holo: false, n: c.normales - 1, v: c.valeur } : null,
      c.holos > 1 ? { holo: true, n: c.holos - 1, v: c.valeur * 3 } : null
    ].filter(Boolean);

    const f = fenetre(`
      <div class="ct-fiche" style="--rc:${rar(r).c}">
        <div class="ct-fiche-carte">${carteHtml(c, { verrou: !possede, vivante: possede, eager: true })}</div>
        <div>
          <span class="ct-fiche-num">${numero(c.numero)}</span>
          <h2>${esc(c.nom)}</h2>
          <div class="ct-fiche-rar">${esc(rar(r).nom)}${c.holos > 0 ? ' · Holo obtenue' : ''}</div>
          <div class="ct-stats">
            <div class="ct-stat"><b>${c.fans ? esc(court(c.fans)) : '—'}</b><span>fans Deezer</span></div>
            <div class="ct-stat"><b>${nf(c.sorties)}</b><span>${c.sorties > 1 ? 'sorties' : 'sortie'} sur La Wave</span></div>
            <div class="ct-stat"><b>${possede ? '×' + c.quantite : '—'}</b><span>${possede ? 'en ta possession' : 'pas encore obtenue'}</span></div>
          </div>
          ${c.ville ? `<p class="sous" style="margin-top:12px">${esc(c.ville)}</p>` : ''}
          ${(c.sorties_liste || []).length ? `
            <div class="ct-titre-sec" style="margin:22px 0 10px"><h3>Dernières sorties</h3></div>
            <div class="ct-pochettes">${c.sorties_liste.map((s, i) => `<button type="button" class="ct-pochette" data-s="${i}" title="${esc(s.titre)} · ${esc(date(s.date))}"><img src="${esc(safeUrl(s.cover))}" alt="${esc(s.titre)}" loading="lazy"></button>`).join('')}</div>` : ''}
          ${c.handle && typeof ouvrirPageArtiste === 'function' ? `<div class="ct-actions"><button type="button" class="ct-btn petit" data-artiste>Voir la page de l'artiste${ico('fleche', 14)}</button></div>` : ''}
          ${!possede && classeur ? `<p class="sous" style="margin-top:14px">Cette carte ne sort que du booster « ${esc((S.boosters || []).find(b => b.id === classeur)?.nom || 'de la collection')} ».</p>` : ''}
          ${!possede && !classeur ? `
            <div class="ct-ligne-act">
              <span class="ct-pastille-ico">${ico('marteau', 18)}</span>
              <div class="tx"><b>Fabriquer à l'atelier</b>${nf(c.cout)} vinyles · tu en as ${nf(S.etat.vinyles)}</div>
              <button type="button" class="ct-btn principal petit" data-atelier ${S.etat.vinyles < c.cout ? 'disabled' : ''}>${S.etat.vinyles < c.cout ? 'Il en manque ' + nf(c.cout - S.etat.vinyles) : 'Fabriquer'}</button>
            </div>` : ''}
          ${doublons.map((d, k) => `
            <div class="ct-ligne-act">
              <span class="ct-pastille-ico">${ico('recycler', 18)}</span>
              <div class="tx"><b>${pluriel(d.n, d.holo ? 'doublon holo' : 'doublon', d.holo ? 'doublons holo' : 'doublons')}</b>${nf(d.v)} vinyles chacun</div>
              <select data-qte="${k}" aria-label="Quantité">${Array.from({ length: d.n }, (_, j) => `<option value="${j + 1}"${j + 1 === d.n ? ' selected' : ''}>${j + 1}</option>`).join('')}</select>
              <button type="button" class="ct-btn petit" data-recycler="${k}">Recycler</button>
            </div>`).join('')}
        </div>
      </div>`, true);

    inclinable(f.corps.querySelector('.ct-fiche-carte'));

    f.corps.querySelectorAll('[data-s]').forEach((b) => b.addEventListener('click', () => {
      const s = c.sorties_liste[Number(b.dataset.s)];
      if(s && s.numero && typeof ouvrirSortieParNumero === 'function'){ fermerTout(); ouvrirSortieParNumero(s.numero); }
    }));
    const ar = f.corps.querySelector('[data-artiste]');
    if(ar) ar.addEventListener('click', () => { fermerTout(); ouvrirPageArtiste(c.handle); });

    const at = f.corps.querySelector('[data-atelier]');
    if(at) at.addEventListener('click', async () => {
      at.disabled = true;
      try{
        const x = await appel('jeu_atelier', { p_artist: c.id });
        poserEtat(x.etat); majEntete(); Son.jouer('r' + r); vibre(25);
        toast(c.nom + ' rejoint ta collection');
        f.fermer();
        if(S.vue === 'collection') vueCollection();
        fiche(c.id);
      }catch(e){ toast(e.message, 'err'); at.disabled = false; }
    });

    f.corps.querySelectorAll('[data-recycler]').forEach((b) => b.addEventListener('click', async () => {
      const d = doublons[Number(b.dataset.recycler)];
      const q = Number(f.corps.querySelector(`[data-qte="${b.dataset.recycler}"]`).value);
      b.disabled = true;
      try{
        const x = await appel('jeu_recycler', { p_artist: c.id, p_holo: d.holo, p_quantite: q });
        poserEtat(x.etat); majEntete(); Son.jouer('gain');
        toast('+' + nf(x.vinyles) + ' vinyles');
        f.fermer();
        if(S.vue === 'collection') vueCollection();
      }catch(e){ toast(e.message, 'err'); b.disabled = false; }
    }));
  }

  // Quitter le jeu pour une autre page : les fenêtres et la scène se ferment.
  function fermerTout(){
    document.querySelectorAll('.ct-voile').forEach((v) => { const b = v.querySelector('.ct-fermer'); if(b) b.click(); });
    const x = document.querySelector('.ct-scene .ct-scene-x');
    if(x) x.click();
  }

  // ---------------------------------------------------------------------
  // Collection
  // ---------------------------------------------------------------------

  async function vueCollection(){

    const o = S.col;

    // Les classeurs des collections (un par booster à classeur) ; sans eux, la collection de base seule.
    let classeurs = [];
    try{ classeurs = await appel('jeu_classeurs'); }catch(err){ classeurs = []; }
    if(!Array.isArray(classeurs)) classeurs = [];
    if(o.classeur && !classeurs.some(c => c.id === o.classeur)) o.classeur = null;
    const cl = o.classeur ? classeurs.find(c => c.id === o.classeur) : null;

    const r = cl
      ? await appel('jeu_classeur_lire', { p_booster: cl.id, p_page: o.page, p_vue: o.vue, p_rarete: o.rarete, p_q: o.q || null, p_tri: o.tri })
      : await appel('jeu_collection_lire', { p_page: o.page, p_vue: o.vue, p_rarete: o.rarete, p_q: o.q || null, p_tri: o.tri });
    const e = S.etat;
    const raretes = r.raretes || [];
    const possedees = cl ? raretes.reduce((s, x) => s + Number(x.possedees || 0), 0) : e.uniques;
    const total = cl ? raretes.reduce((s, x) => s + Number(x.total || 0), 0) : e.total_cartes;
    const pct = total ? Math.round(possedees / total * 1000) / 10 : 0;
    const finTxt = cl && cl.fin ? new Date(cl.fin + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '';

    S.corps.innerHTML = `
      ${classeurs.length ? `<div class="ct-classeurs" role="group" aria-label="Classeur">
        ${[{ id: null, nom: 'Série de lancement', theme: 'onde', accent: '#4FB4FF', possedees: e.uniques, total: e.total_cartes }].concat(classeurs).map(c => `<button type="button" class="ct-classeur${(c.id || null) === (o.classeur || null) ? ' actif' : ''}" data-classeur="${esc(c.id || '')}" style="--acc:${couleurOk(c.accent)}" aria-pressed="${(c.id || null) === (o.classeur || null)}"><b>${esc(c.nom)}</b><small>${nf(c.possedees)} / ${nf(c.total)}</small></button>`).join('')}
      </div>` : ''}
      <section class="ct-panneau ct-prog"${cl ? ` style="--acc:${couleurOk(cl.accent)}"` : ''}>
        <div class="ct-prog-chiffre">${nf(possedees)}<small> / ${nf(total)}</small></div>
        <div class="ct-prog-droite">
          <div class="lib"><span>${cl ? esc(cl.nom) + (finTxt ? ' · jusqu\'au ' + esc(finTxt) : '') : 'artistes dans ta collection'}</span><span>${String(pct).replace('.', ',')} %</span></div>
          <div class="ct-barre"><i style="width:${Math.max(pct, possedees ? .6 : 0)}%"></i></div>
        </div>
        <div class="ct-raretes">${raretes.map(x => `
          <button type="button" class="ct-rar-btn${o.rarete === x.rarete ? ' actif' : ''}" data-rar="${x.rarete}" style="--rc:${rar(x.rarete).c}" aria-pressed="${o.rarete === x.rarete}">
            <span class="nom">${esc(rar(x.rarete).nom)}</span>
            <span class="nb">${nf(x.possedees)} / ${nf(x.total)}</span>
            <span class="ct-barre"><i style="width:${x.total ? x.possedees / x.total * 100 : 0}%"></i></span>
          </button>`).join('')}</div>
      </section>

      <div class="ct-outils">
        <label class="ct-recherche">${ico('loupe', 17)}<input type="search" placeholder="Chercher un artiste" value="${esc(o.q)}" data-q aria-label="Chercher un artiste"></label>
        <div class="ct-segment" role="group" aria-label="Afficher">
          ${[['toutes', 'Toutes'], ['possedees', 'Obtenues'], ['manquantes', 'Manquantes'], ['doublons', 'Doublons'], ['holos', 'Holos']].map(([v, l]) => `<button type="button" data-v="${v}" class="${o.vue === v ? 'actif' : ''}" aria-pressed="${o.vue === v}">${l}</button>`).join('')}
        </div>
        <select class="ct-select" data-tri aria-label="Trier">
          ${[['numero', 'Numéro'], ['rarete', 'Rareté'], ['fans', 'Fans'], ['nom', 'Nom (A–Z)'], ['recent', 'Dernières obtenues']].map(([v, l]) => `<option value="${v}"${o.tri === v ? ' selected' : ''}>${l}</option>`).join('')}
        </select>
        ${r.doublons > 0 ? `<button type="button" class="ct-btn" data-recycler-tout>${ico('recycler', 16)}Recycler les doublons<span class="cout" style="background:rgba(242,193,78,.15)">+${nf(r.valeur_doublons)}</span></button>` : ''}
      </div>

      ${r.cartes.length
        ? `<div class="ct-grille">${r.cartes.map((c, i) => `<button type="button" class="ct-case" data-i="${i}" aria-label="${esc(c.nom)}${c.quantite ? '' : ', pas encore obtenue'}">${carteHtml(c, { quantite: true, verrou: !c.quantite })}</button>`).join('')}</div>`
        : `<div class="ct-panneau ct-vide">${o.q || o.rarete || o.vue !== 'toutes' ? '<b>Aucune carte</b>Rien ne correspond à ces filtres.' : '<b>Aucune carte pour l\'instant</b>Les cartes arrivent dès que les artistes sont prêts.'}</div>`}
      ${r.pages > 1 ? `<div class="ct-pages"><button type="button" class="ct-btn petit" data-page="-1" ${o.page <= 1 ? 'disabled' : ''}>Précédente</button><span>Page ${r.page} sur ${r.pages}</span><button type="button" class="ct-btn petit" data-page="1" ${o.page >= r.pages ? 'disabled' : ''}>Suivante</button></div>` : ''}`;

    let minuteur = null;
    const champ = S.corps.querySelector('[data-q]');
    champ.addEventListener('input', () => {
      clearTimeout(minuteur);
      minuteur = setTimeout(() => { o.q = champ.value.trim(); o.page = 1; vueCollection().catch(() => {}); }, 320);
    });
    S.corps.querySelectorAll('[data-rar]').forEach((b) => b.addEventListener('click', () => { const v = Number(b.dataset.rar); o.rarete = o.rarete === v ? null : v; o.page = 1; vueCollection(); }));
    S.corps.querySelectorAll('[data-v]').forEach((b) => b.addEventListener('click', () => { o.vue = b.dataset.v; o.page = 1; vueCollection(); }));
    S.corps.querySelector('[data-tri]').addEventListener('change', (ev) => { o.tri = ev.target.value; o.page = 1; vueCollection(); });
    S.corps.querySelectorAll('[data-page]').forEach((b) => b.addEventListener('click', () => {
      o.page = Math.max(1, o.page + Number(b.dataset.page));
      vueCollection().then(() => { const t = S.hote.querySelector('.ct-onglets'); if(t) t.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    }));
    S.corps.querySelectorAll('.ct-grille [data-i]').forEach((b) => b.addEventListener('click', () => fiche(r.cartes[Number(b.dataset.i)].id, cl ? cl.id : null)));
    S.corps.querySelectorAll('[data-classeur]').forEach((b) => b.addEventListener('click', () => {
      o.classeur = b.dataset.classeur || null; o.page = 1; o.vue = 'toutes'; o.rarete = null; o.q = '';
      vueCollection();
    }));
    const rt = S.corps.querySelector('[data-recycler-tout]');
    if(rt) rt.addEventListener('click', () => recyclerTout(r.doublons, r.valeur_doublons));
    if(o.q){ champ.focus(); champ.setSelectionRange(champ.value.length, champ.value.length); }
  }

  function recyclerTout(nb, valeur){
    const f = fenetre(`
      <h2>Recycler tes doublons</h2>
      <p class="sous">Tu gardes un exemplaire de chaque carte (et de chaque holo). Les ${pluriel(nb, 'doublon')} deviennent des vinyles, à dépenser à l'atelier pour fabriquer les cartes qui te manquent.</p>
      <div class="ct-ligne-act" style="margin-top:18px"><span class="ct-pastille-ico" style="color:#F2C14E; background:rgba(242,193,78,.12)">${ico('vinyle', 20)}</span><div class="tx"><b>+${nf(valeur)} vinyles</b>pour ${pluriel(nb, 'carte')}</div></div>
      <div class="ct-actions" style="justify-content:flex-end"><button type="button" class="ct-btn" data-non>Annuler</button><button type="button" class="ct-btn principal" data-oui>Recycler</button></div>`);
    f.corps.querySelector('[data-non]').addEventListener('click', f.fermer);
    const b = f.corps.querySelector('[data-oui]');
    b.addEventListener('click', async () => {
      b.disabled = true;
      try{
        const x = await appel('jeu_recycler_tout');
        poserEtat(x.etat); majEntete(); Son.jouer('gain'); vibre(25);
        toast('+' + nf(x.vinyles) + ' vinyles');
        f.fermer();
        vueCollection();
      }catch(e){ toast(e.message, 'err'); b.disabled = false; }
    });
  }

  // ---------------------------------------------------------------------
  // Missions
  // ---------------------------------------------------------------------

  async function vueMissions(){

    const m = await appel('jeu_missions');

    const ligne = (q) => {
      const fait = q.progres >= q.objectif;
      return `
        <div class="ct-ligne${q.prise ? ' fait' : (fait ? ' pret' : '')}">
          <span class="ct-pastille-ico">${ico(q.prise ? 'coche' : 'cible', 19)}</span>
          <div class="tx">
            <b>${esc(q.libelle)}</b>
            <div class="bas"><span class="ct-barre"><i style="width:${Math.round(q.progres / q.objectif * 100)}%"></i></span><small>${nf(q.progres)} / ${nf(q.objectif)}</small></div>
            <div class="ct-gains">${gainsHtml(q)}</div>
          </div>
          ${q.prise ? '' : `<button type="button" class="ct-btn ${fait ? 'principal' : ''} petit" data-prendre="${esc(q.cle)}" ${fait ? '' : 'disabled'}>Récupérer</button>`}
        </div>`;
    };

    const bonus = (b, titre, texte) => `
      <div class="ct-ligne${b.pris ? ' fait' : (b.pret ? ' pret' : '')}" style="margin-top:4px">
        <span class="ct-pastille-ico" style="color:var(--r3); background:rgba(168,121,255,.12)">${ico(b.pris ? 'coche' : 'cadeau', 19)}</span>
        <div class="tx"><b>${esc(titre)}</b><div class="ct-gains">${gainsHtml(b)}</div><small style="display:block; margin-top:6px; font-size:12px; color:var(--muted)">${esc(texte)}</small></div>
        ${b.pris ? '' : `<button type="button" class="ct-btn ${b.pret ? 'principal' : ''} petit" data-prendre="${esc(b.cle)}" ${b.pret ? '' : 'disabled'}>Récupérer</button>`}
      </div>`;

    S.corps.innerHTML = `
      <div class="ct-deux">
        <section class="ct-panneau">
          <div class="ct-entete-panneau"><div><h3>Aujourd'hui</h3><p class="sous">Trois missions, renouvelées chaque jour.</p></div><span class="ct-puce-temps">${ico('horloge', 14)}${duree(m.fin_jour)}</span></div>
          <div class="ct-liste">${m.jour.map(ligne).join('')}${bonus(m.bonus_jour, 'Bonus du jour', 'Termine les trois missions.')}</div>
        </section>
        <section class="ct-panneau">
          <div class="ct-entete-panneau"><div><h3>Cette semaine</h3><p class="sous">Trois défis, du lundi au dimanche.</p></div><span class="ct-puce-temps">${ico('horloge', 14)}${duree(m.fin_semaine)}</span></div>
          <div class="ct-liste">${m.semaine.map(ligne).join('')}${bonus(m.bonus_semaine, 'Bonus de la semaine', 'Termine les trois défis.')}</div>
        </section>
      </div>
      <p style="margin:14px 2px 0; font-size:13px; color:var(--muted)">Noter, écouter, commenter ou donner ton avis sur une sortie compte pour les missions du site.</p>`;

    S.corps.querySelectorAll('[data-prendre]').forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true;
      try{
        const r = await appel('jeu_mission_prendre', { p_cle: b.dataset.prendre });
        poserEtat(r.etat); majEntete(); Son.jouer('gain'); vibre(20);
        toast('Récupéré : ' + gainsTexte(r.gain));
        vueMissions();
      }catch(e){ toast(e.message, 'err'); b.disabled = false; }
    }));
  }

  // ---------------------------------------------------------------------
  // Bonus : cadeau de connexion, roue, coffre
  // ---------------------------------------------------------------------

  function serieHtml(c){
    return `<div class="ct-serie">${c.cadeaux.map((g) => {
      const fait = g.jour < c.jour || (!c.pret && g.jour === c.jour);
      return `
      <div class="ct-jour${fait ? ' fait' : ''}${c.pret && g.jour === c.jour ? ' aujourdhui' : ''}${g.jour === 7 ? ' sept' : ''}">
        <span>J${g.jour}</span>${ico(fait ? 'coche' : (g.garantis ? 'pack' : (g.vinyles ? 'vinyle' : 'eclair')), 17)}
        <b>${g.tirages ? '+' + g.tirages : ''}${g.vinyles ? (g.tirages ? '<br>' : '') + '+' + g.vinyles + 'v' : ''}</b>
      </div>`;
    }).join('')}</div>`;
  }

  async function prendreCadeau(bouton, apres){
    bouton.disabled = true;
    try{
      const r = await appel('jeu_cadeau_prendre');
      poserEtat(r.etat); majEntete(); Son.jouer('gain'); vibre(25);
      toast('Cadeau du jour : ' + gainsTexte(r.gain));
      if(apres) apres();
    }catch(e){ toast(e.message, 'err'); bouton.disabled = false; }
  }

  async function fenetreCadeau(){
    let c;
    try{ c = await appel('jeu_cadeau'); }catch(e){ return; }
    if(!c.pret) return;
    const f = fenetre(`
      <span class="ct-surtitre">${ico('cadeau', 15)}Cadeau de connexion</span>
      <h2 style="margin-top:8px">Jour ${c.jour} de ta série</h2>
      <p class="sous">${c.serie > 0 ? pluriel(c.serie, 'jour') + ' d\'affilée. Reviens demain pour ne pas casser ta série : le 7ᵉ jour est le plus gros.' : 'Reviens chaque jour : les cadeaux grossissent jusqu\'au 7ᵉ jour.'}</p>
      <div style="margin-top:18px">${serieHtml(c)}</div>
      <button type="button" class="ct-btn principal grand" style="width:100%" data-prendre>Récupérer : ${esc(gainsTexte(c.cadeaux[c.jour - 1]))}</button>`);
    const b = f.corps.querySelector('[data-prendre]');
    b.addEventListener('click', () => prendreCadeau(b, () => { f.fermer(); if(S.vue === 'bonus' || S.vue === 'packs') afficherVue(S.vue); }));
  }

  async function vueBonus(){

    const [c, roue, coffre] = await Promise.all([appel('jeu_cadeau'), appel('jeu_roue'), appel('jeu_coffre')]);
    const heure = (iso) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });

    // La roue : des parts sombres aux bleus de la marque, une seule dorée pour le gros lot.
    const sect = roue.secteurs, ang = 360 / sect.length, R = 150;
    const jackpot = (l) => /JACKPOT/i.test(l);
    const couleurs = ['#0f2c4d', '#14406e', '#0c2440', '#185089'];
    const svgRoue = sect.map((s, k) => {
      const a0 = (k - .5) * ang - 90, a1 = (k + .5) * ang - 90;
      const pt = (a) => [R * Math.cos(a * Math.PI / 180), R * Math.sin(a * Math.PI / 180)];
      const [x0, y0] = pt(a0), [x1, y1] = pt(a1);
      const lib = s.libelle.replace(/JACKPOT\s*·\s*/i, '').replace(/\s*💿/, ' vinyles');
      const mots = lib.split(' ');
      const or = jackpot(s.libelle);
      return `<path d="M0 0 L${x0.toFixed(2)} ${y0.toFixed(2)} A${R} ${R} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)} Z" fill="${or ? 'url(#ctOr)' : couleurs[k % couleurs.length]}" stroke="rgba(255,255,255,.14)" stroke-width="1"/>
        <g transform="rotate(${k * ang})"><text x="0" y="${-R + 40}" text-anchor="middle" fill="${or ? '#2a1a00' : '#fff'}" font-weight="800" font-size="17">${esc(mots[0])}</text>
        <text x="0" y="${-R + 57}" text-anchor="middle" fill="${or ? '#3d2700' : 'rgba(255,255,255,.62)'}" font-weight="700" font-size="9.5" letter-spacing="1">${esc(mots.slice(1).join(' ').toUpperCase())}</text></g>`;
    }).join('');

    S.corps.innerHTML = `
      <div class="ct-bonus">
        <section class="ct-panneau roue">
          <div class="ct-entete-panneau"><div><h3>Roue du jour</h3><p class="sous">Un tour gratuit chaque jour.</p></div>${roue.prete ? '' : `<span class="ct-puce-temps">${ico('horloge', 14)}demain</span>`}</div>
          <div class="ct-roue-zone">
            <div class="ct-roue">
              <svg class="ct-roue-pointe" viewBox="0 0 26 32" aria-hidden="true"><path d="M13 31 1.5 6.5A11.5 11.5 0 1 1 24.5 6.5z" fill="#F4F5F6"/><circle cx="13" cy="11" r="4" fill="#1489DE"/></svg>
              <svg viewBox="-160 -160 320 320" role="img" aria-label="Roue du jour">
                <defs><linearGradient id="ctOr" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff1b0"/><stop offset=".5" stop-color="#f2c14e"/><stop offset="1" stop-color="#c88a1e"/></linearGradient></defs>
                <circle r="157" fill="#08111d" stroke="rgba(255,255,255,.14)" stroke-width="2"/>
                <g class="ct-roue-disque" data-disque>${svgRoue}</g>
                <circle r="30" fill="#0b0f15" stroke="rgba(255,255,255,.25)" stroke-width="2"/>
                <g transform="translate(-19 -19) scale(.38)" style="color:#4FB4FF">${EMBLEME.replace('class="ct-embleme"', 'width="100" height="100"')}</g>
              </svg>
            </div>
            <div class="ct-roue-res" data-res>${roue.dernier ? 'Aujourd\'hui : <b>' + esc(roue.dernier.libelle) + '</b>' : 'Des tirages, des vinyles, un pack Épique… et un gros lot.'}</div>
            <button type="button" class="ct-btn principal grand" data-tourner ${roue.prete ? '' : 'disabled'}>${roue.prete ? 'Tourner la roue' : 'Déjà tournée aujourd\'hui'}</button>
          </div>
        </section>

        <section class="ct-panneau">
          <div class="ct-entete-panneau"><div><h3>Cadeau de connexion</h3><p class="sous">${c.serie > 0 ? 'Série de ' + pluriel(c.serie, 'jour') + '. ' : ''}Le 7ᵉ jour est le plus gros.</p></div></div>
          ${serieHtml(c)}
          <button type="button" class="ct-btn ${c.pret ? 'principal' : ''}" style="width:100%" data-cadeau ${c.pret ? '' : 'disabled'}>${c.pret ? 'Récupérer : ' + esc(gainsTexte(c.cadeaux[c.jour - 1])) : 'Récupéré, reviens demain'}</button>
        </section>

        <section class="ct-panneau">
          <div class="ct-entete-panneau"><div><h3>Coffre</h3><p class="sous">8 tirages à 9 h, 13 h, 18 h et 22 h, à prendre dans les 8 heures.</p></div></div>
          <div class="ct-creneaux">${coffre.cadeaux.map((x) => `
            <div class="ct-creneau ${x.etat}">
              <span class="h">${String(x.heure).padStart(2, '0')} h</span>
              <small>${x.etat === 'pret' ? 'jusqu\'à ' + heure(x.fin) : (x.etat === 'a_venir' ? 'à venir' : (x.etat === 'prise' ? 'récupéré' : 'expiré'))}</small>
              <button type="button" class="ct-btn ${x.etat === 'pret' ? 'principal' : ''} petit" data-coffre="${esc(x.cle)}" ${x.etat === 'pret' ? '' : 'disabled'} aria-label="Récupérer ${x.tirages} tirages">${x.etat === 'prise' ? ico('coche', 15) : ico('eclair', 14) + '+' + x.tirages}</button>
            </div>`).join('')}</div>
        </section>
      </div>`;

    const disque = S.corps.querySelector('[data-disque]');
    if(roue.dernier){ disque.style.transition = 'none'; disque.style.transform = `rotate(${-(roue.dernier.n - 1) * ang}deg)`; }

    const t = S.corps.querySelector('[data-tourner]');
    t.addEventListener('click', async () => {
      t.disabled = true;
      let x;
      try{ x = await appel('jeu_roue_tourner'); }catch(e){ toast(e.message, 'err'); t.disabled = false; return; }
      Son.pret();
      disque.getBoundingClientRect();
      disque.style.transition = '';
      disque.style.transform = `rotate(${-(x.n - 1) * ang - 360 * 7}deg)`;
      // Le cliquetis ralentit avec la roue.
      let d = 55, total = 0;
      const clic = () => { if(total > 5000 || !disque.isConnected) return; Son.jouer('tic'); total += d; d *= 1.09; setTimeout(clic, d); };
      clic();
      await attendre(calme() ? 100 : 5500);
      poserEtat(x.etat); majEntete();
      Son.jouer(jackpot(x.libelle) ? 'r5' : 'gain'); vibre([25, 40, 25]);
      const res = S.corps.querySelector('[data-res]');
      if(res) res.innerHTML = 'Gagné : <b>' + esc(x.libelle) + '</b>';
      t.textContent = 'Déjà tournée aujourd\'hui';
      toast('Roue du jour : ' + x.libelle);
    });

    const cb = S.corps.querySelector('[data-cadeau]');
    if(cb) cb.addEventListener('click', () => prendreCadeau(cb, () => vueBonus()));

    S.corps.querySelectorAll('[data-coffre]').forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true;
      try{
        const x = await appel('jeu_coffre_prendre', { p_cle: b.dataset.coffre });
        poserEtat(x.etat); majEntete(); Son.jouer('gain'); vibre(20);
        toast('+' + x.gain.tirages + ' tirages');
        vueBonus();
      }catch(e){ toast(e.message, 'err'); b.disabled = false; }
    }));
  }

  // ---------------------------------------------------------------------
  // Succès
  // ---------------------------------------------------------------------

  const FAMILLES = {
    ouvertures: 'pack', uniques: 'cartes', holos: 'etoile', rares: 'etoile', epiques: 'etoile', legendaires: 'trophee',
    mythiques: 'trophee', niveau: 'eclair', recycles: 'recycler', ateliers: 'marteau', roues: 'roue', serie: 'horloge', missions: 'cible'
  };

  async function vueSucces(){

    const r = await appel('jeu_succes');
    const liste = r.succes || [];
    const familles = {};
    liste.forEach((s) => { (familles[s.famille] = familles[s.famille] || []).push(s); });

    const pris = liste.filter(s => s.pris).length;
    const prets = liste.filter(s => s.atteint && !s.pris);
    const lignes = Object.keys(familles).map((k) => {
      const l = familles[k];
      return { k, s: l.find(x => !x.pris) || l[l.length - 1], l };
    }).sort((a, b) => (Number(b.s.atteint && !b.s.pris) - Number(a.s.atteint && !a.s.pris)) || (Number(a.s.pris) - Number(b.s.pris)) || (b.s.progres / b.s.seuil - a.s.progres / a.s.seuil));

    S.corps.innerHTML = `
      <section class="ct-panneau ct-prog" style="margin-bottom:16px">
        <div class="ct-prog-chiffre">${pris}<small> / ${liste.length}</small></div>
        <div class="ct-prog-droite">
          <div class="lib"><span>succès récupérés</span>${prets.length ? `<button type="button" class="ct-btn principal petit" data-tout>Tout récupérer (${prets.length})</button>` : ''}</div>
          <div class="ct-barre or"><i style="width:${liste.length ? pris / liste.length * 100 : 0}%"></i></div>
        </div>
      </section>
      <div class="ct-liste">${lignes.map(({ k, s, l }) => {
        const pret = s.atteint && !s.pris;
        return `
          <div class="ct-ligne${pret ? ' pret' : (s.pris ? ' fait' : '')}">
            <span class="ct-medaille">${ico(FAMILLES[k] || 'trophee', 20)}</span>
            <div class="tx">
              <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap"><b>${esc(s.nom)}</b><span class="ct-paliers" aria-label="${l.filter(x => x.pris).length} paliers sur ${l.length}">${l.map(x => `<i class="${x.pris ? 'on' : ''}"></i>`).join('')}</span></div>
              <div style="font-size:12.5px; color:var(--muted); margin-top:2px">${esc(s.description)}</div>
              <div class="bas"><span class="ct-barre or"><i style="width:${Math.round(s.progres / s.seuil * 100)}%"></i></span><small>${nf(s.progres)} / ${nf(s.seuil)}</small></div>
              ${s.pris ? '' : `<div class="ct-gains">${gainsHtml(s)}</div>`}
            </div>
            ${s.pris ? '' : `<button type="button" class="ct-btn ${pret ? 'principal' : ''} petit" data-prendre="${esc(s.id)}" ${pret ? '' : 'disabled'}>Récupérer</button>`}
          </div>`;
      }).join('')}</div>`;

    const prendre = async (id) => { const x = await appel('jeu_succes_prendre', { p_id: id }); poserEtat(x.etat); return x; };

    S.corps.querySelectorAll('[data-prendre]').forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true;
      try{ const x = await prendre(b.dataset.prendre); majEntete(); Son.jouer('gain'); vibre(20); toast('Succès : ' + gainsTexte(x.gain)); vueSucces(); }
      catch(e){ toast(e.message, 'err'); b.disabled = false; }
    }));

    const tout = S.corps.querySelector('[data-tout]');
    if(tout) tout.addEventListener('click', async () => {
      tout.disabled = true;
      let t = 0, v = 0;
      for(const s of prets){
        try{ const x = await prendre(s.id); t += x.gain.tirages || 0; v += x.gain.vinyles || 0; }catch(e){ /* déjà pris : on passe */ }
      }
      majEntete(); Son.jouer('gain');
      toast('Récupéré : ' + gainsTexte({ tirages: t, vinyles: v }));
      vueSucces();
    });
  }

  // ---------------------------------------------------------------------
  // L'espace équipe : les artistes d'un classeur et la rareté de leur carte
  // ---------------------------------------------------------------------

  const EQ = { id: null, classeurs: [], cartes: [], q: '', res: [], minuteur: null };

  async function equipe(hote){
    if(!hote) return;
    poserStyle();
    if(!hote.dataset.ctEq){
      hote.dataset.ctEq = '1';
      hote.addEventListener('click', equipeClic);
      hote.addEventListener('change', equipeChange);
      hote.addEventListener('input', (ev) => {
        if(!ev.target.matches('[data-eq-q]')) return;
        EQ.q = ev.target.value;
        clearTimeout(EQ.minuteur);
        EQ.minuteur = setTimeout(() => equipeChercher(hote), 250);
      });
    }
    hote.innerHTML = '<div class="ct ct-eq"><div class="ct-vide">Chargement…</div></div>';
    try{ await equipeCharger(hote, EQ.id); }
    catch(e){ hote.innerHTML = `<div class="ct ct-eq"><div class="ct-panneau ct-vide">${esc(e.message)}</div></div>`; }
  }

  async function equipeCharger(hote, id){
    const r = await appel('jeu_classeur_equipe_lire', { p_booster: id || '' });
    EQ.classeurs = r.classeurs || [];
    if(!EQ.classeurs.length){
      hote.innerHTML = '<div class="ct ct-eq"><div class="ct-panneau ct-vide"><b>Aucune collection</b>Les classeurs ne sont pas encore en place dans la base.</div></div>';
      return;
    }
    if(!EQ.classeurs.some(c => c.id === id)){ EQ.id = EQ.classeurs[0].id; return equipeCharger(hote, EQ.id); }
    EQ.id = id;
    EQ.cartes = r.cartes || [];
    equipeDessiner(hote);
  }

  function equipeDessiner(hote){
    const par = [5, 4, 3, 2, 1].map(k => [k, EQ.cartes.filter(c => Number(c.rarete) === k).length]);
    const options = (sel) => [5, 4, 3, 2, 1].map(k => `<option value="${k}"${Number(sel) === k ? ' selected' : ''}>${esc(RAR[k].nom)}</option>`).join('');
    hote.innerHTML = `
      <div class="ct ct-eq">
        <div class="ct-classeurs">${EQ.classeurs.map(c => `<button type="button" class="ct-classeur${c.id === EQ.id ? ' actif' : ''}" data-eq-cl="${esc(c.id)}" style="--acc:#4FB4FF"><b>${esc(c.nom)}</b><small>${pluriel(c.nb, 'carte')}</small></button>`).join('')}</div>
        <section class="ct-panneau">
          <div class="ct-entete-panneau"><div><h3>Ajouter un artiste</h3><p class="sous">Cherche un artiste du jeu, choisis la rareté de sa carte, ajoute-le à ce classeur.</p></div></div>
          <label class="ct-recherche">${ico('loupe', 17)}<input type="search" data-eq-q value="${esc(EQ.q)}" placeholder="Chercher un artiste" aria-label="Chercher un artiste"></label>
          <div class="ct-eq-res" data-eq-res></div>
        </section>
        <div class="ct-titre-sec"><h3>${pluriel(EQ.cartes.length, 'carte')} · ${par.filter(x => x[1]).map(([k, n]) => n + ' ' + esc(RAR[k].nom)).join(' · ')}</h3></div>
        <div class="ct-liste">${EQ.cartes.map(c => `
          <div class="ct-ligne ct-eq-ligne" style="--rc:${rar(c.rarete).c}">
            <span class="ct-eq-num">${numero(c.numero)}</span>
            <img class="ct-eq-photo" src="${esc(safeUrl(c.photo))}" alt="" loading="lazy">
            <div class="tx"><b>${esc(c.nom || 'Artiste')}</b><small style="color:var(--muted)">${c.fans ? esc(court(c.fans)) + ' fans' : ''}</small></div>
            <select class="ct-select" data-eq-rar="${esc(c.artist_id)}" aria-label="Rareté de ${esc(c.nom || 'la carte')}">${options(c.rarete)}</select>
            <button type="button" class="ct-btn petit" data-eq-retirer="${esc(c.artist_id)}">Retirer</button>
          </div>`).join('')}</div>
      </div>`;
    equipeResultats(hote, options);
  }

  function equipeResultats(hote, options){
    const zone = hote.querySelector('[data-eq-res]');
    if(!zone) return;
    options = options || ((sel) => [5, 4, 3, 2, 1].map(k => `<option value="${k}"${Number(sel) === k ? ' selected' : ''}>${esc(RAR[k].nom)}</option>`).join(''));
    const deja = new Set(EQ.cartes.map(c => c.artist_id));
    zone.innerHTML = EQ.res.map(a => `
      <div class="ct-ligne ct-eq-ligne">
        <img class="ct-eq-photo" src="${esc(safeUrl(a.photo))}" alt="" loading="lazy">
        <div class="tx"><b>${esc(a.nom)}</b><small style="color:var(--muted)">${a.fans ? esc(court(a.fans)) + ' fans' : ''}</small></div>
        ${deja.has(a.artist_id)
          ? '<span class="ct-puce-temps">Déjà dans le classeur</span>'
          : `<select class="ct-select" data-eq-new="${esc(a.artist_id)}" aria-label="Rareté">${options(1)}</select><button type="button" class="ct-btn principal petit" data-eq-ajouter="${esc(a.artist_id)}">Ajouter</button>`}
      </div>`).join('');
  }

  async function equipeChercher(hote){
    const q = EQ.q.trim();
    if(q.length < 2){ EQ.res = []; equipeResultats(hote); return; }
    try{ EQ.res = await appel('jeu_classeur_equipe_chercher', { p_q: q }); equipeResultats(hote); }
    catch(e){ toast(e.message, 'err'); }
  }

  async function equipeRegler(hote, artiste, rarete){
    try{
      const r = await appel('jeu_classeur_equipe_regler', { p_booster: EQ.id, p_artist: artiste, p_rarete: rarete });
      EQ.classeurs = r.classeurs || EQ.classeurs;
      EQ.cartes = r.cartes || [];
      equipeDessiner(hote);
      toast(rarete === null ? 'Carte retirée' : 'Classeur mis à jour');
    }catch(e){ toast(e.message, 'err'); }
  }

  function equipeClic(ev){
    const hote = ev.currentTarget;
    const cl = ev.target.closest('[data-eq-cl]');
    if(cl){ EQ.id = cl.dataset.eqCl; EQ.q = ''; EQ.res = []; equipeCharger(hote, EQ.id).catch((e) => toast(e.message, 'err')); return; }
    const aj = ev.target.closest('[data-eq-ajouter]');
    if(aj){
      const sel = hote.querySelector(`[data-eq-new="${aj.dataset.eqAjouter}"]`);
      equipeRegler(hote, aj.dataset.eqAjouter, sel ? Number(sel.value) : 1);
      return;
    }
    const re = ev.target.closest('[data-eq-retirer]');
    if(re) equipeRegler(hote, re.dataset.eqRetirer, null);
  }

  function equipeChange(ev){
    const s = ev.target.closest('[data-eq-rar]');
    if(s) equipeRegler(ev.currentTarget, s.dataset.eqRar, Number(s.value));
  }

  window.Cartes = { monter, quitter, equipe };

})();
