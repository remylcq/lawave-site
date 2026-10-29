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
  // 1 vinyle = 1 ouverture de pack. Le serveur crédite toute récompense en vinyles (sql/cartes-un-vinyle.sql) : un ancien
  // « tirage » vaut 1 vinyle, un ancien « vinyle » de récompense 1/50. Ces aides remettent en vinyles ce qu'il nomme encore autrement.
  const vin = (g) => (Number(g.tirages) || 0) + Math.ceil((Number(g.vinyles) || 0) / 50);
  const libVin = (l) => String(l || '').replace(/(\d+)\s*tirages?/i, (_, n) => nf(n) + ' vinyle' + (Number(n) > 1 ? 's' : ''));
  const numero = (n) => '#' + String(n || 0).padStart(3, '0');

  const RAR = [null,
    { nom: 'Commun', c: '#B4BDC8' },
    { nom: 'Rare', c: '#4FB4FF' },
    { nom: 'Épique', c: '#A879FF' },
    { nom: 'Légendaire', c: '#F2C14E' },
    { nom: 'Mythique', c: '#FF5C8A' },
    { nom: 'Spécial', c: '#8FEFFF' }   // propre à Vague Glaciale
  ];
  const rar = (r) => RAR[Math.min(Math.max(Number(r) || 1, 1), 6)];

  const VUES = [['accueil', 'Accueil'], ['packs', 'Packs'], ['collection', 'Collection'], ['combat', 'Combat'], ['marche', 'Marché'], ['missions', 'Missions'], ['bonus', 'Bonus'], ['succes', 'Succès']];

  // ---------------------------------------------------------------------
  // Les icônes (un trait, la couleur du texte)
  // ---------------------------------------------------------------------

  const ICONES = {
    eclair: '<path d="M13 2 4.5 13.5H11L10 22l8.5-11.5H12L13 2z"/>',
    accueil: '<path d="m3 11 9-8 9 8"/><path d="M5 9.5V20h14V9.5"/><path d="M10 20v-5h4v5"/>',
    calendrier: '<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    drapeau: '<path d="M5 21V4"/><path d="M5 5h11l-2 4 2 4H5"/>',
    boussole: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
    utilisateur: '<circle cx="12" cy="8" r="3.8"/><path d="M4.5 20c.8-4 4-6 7.5-6s6.7 2 7.5 6"/>',
    combat: '<path d="M14.5 17.5 3 6V3h3l11.5 11.5"/><path d="M13 19l6-6M16 16l4 4M19 21l2-2"/><path d="m14.5 6.5 3-3H21v3.5l-3 3"/><path d="M5 14l4 4"/>',
    marche: '<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.2"/>',
    piece: '<circle cx="12" cy="12" r="9"/><path d="M7.5 13c1.5-3.2 3-3.2 4.5 0s3 3.2 4.5 0"/>',
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
  // Le visuel d'un booster : une image du dossier img/ ou un fichier du stockage du site (téléversé depuis la console équipe).
  const visuelOk = (v) => /^img\/[\w.-]+$/.test(v || '') || /^https:\/\/bqataeghgjyiqrnnesqq\.supabase\.co\/storage\/v1\/object\/public\/Covers\/[A-Za-z0-9._\/%~-]+$/.test(v || '');


  const PACKS_CSS = THEMES.map((t) => `.ct-pack.t-${t}{--pk-fond:${svgUri(artPack(t))};}`).join('\n  ');

  // ---------------------------------------------------------------------
  // La feuille de style
  // ---------------------------------------------------------------------

  const STYLE = `
  @property --ct-a{syntax:'<angle>'; inherits:false; initial-value:0deg;}

  .ct, .ct-scene, .ct-voile{
    --r1:#B4BDC8; --r2:#4FB4FF; --r3:#A879FF; --r4:#F2C14E; --r5:#FF5C8A; --r6:#8FEFFF;
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
  .ct-res.wc{cursor:pointer; color:inherit; font:inherit; font-weight:700;}
  .ct-res.wc .ct-ico{color:#4FB4FF;}
  .ct-res.wc:hover{border-color:rgba(79,180,255,.5);}
  .ct-echange{display:grid; gap:12px; margin-top:16px;}
  .ct-echange-choix{display:flex; flex-wrap:wrap; gap:8px;}
  .ct-echange-champ{display:flex; align-items:center; gap:10px; font-size:14px; color:var(--ink-soft);}
  .ct-echange-prix{margin-left:6px; color:var(--muted);}
  .ct-echange-champ input{width:120px; height:42px; padding:0 12px; border-radius:12px; border:1px solid var(--ct-trait); background:var(--ct-surface); color:var(--ink); font:inherit; font-weight:700;}
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
  /* Le modèle de carte (fait sur Canva) : un cadre noir arrondi, la photo plein cadre, le numéro en haut à gauche, le logo en haut à droite,
     le nom en grandes capitales (Anton) et la rareté en italique fin dessous. Tout le jeu utilise ce même modèle. */
  @font-face{font-family:'Anton'; font-style:normal; font-weight:400; font-display:swap; src:url(lib/fonts/anton-latin.woff2) format('woff2');}
  .ct-carte{position:relative; container-type:inline-size; aspect-ratio:4 / 5; border-radius:5% / 4%; color:#fff; text-align:left;
    background:#000; box-shadow:0 14px 30px -14px rgba(0,0,0,.8); isolation:isolate; --rc:var(--r1);}
  .ct-carte.r1{--rc:var(--r1);} .ct-carte.r2{--rc:var(--r2);} .ct-carte.r3{--rc:var(--r3);} .ct-carte.r4{--rc:var(--r4);} .ct-carte.r5{--rc:var(--r5);} .ct-carte.r6{--rc:var(--r6);}
  .ct-c-in{position:absolute; inset:.75cqw; border-radius:4.3cqw; overflow:hidden; background:#0b0d12;}
  .ct-c-photo{position:absolute; inset:0; width:100%; height:100%; max-width:none; object-fit:cover; object-position:50% 22%; display:block; transition:transform .5s cubic-bezier(.2,.8,.2,1);}
  .ct-c-voile{position:absolute; inset:0; pointer-events:none; background:linear-gradient(180deg, transparent 50%, rgba(0,0,0,.5) 70%, rgba(0,0,0,.92) 90%, #000 100%);}
  .ct-c-num{position:absolute; top:5.6cqw; left:6.6cqw; font-size:max(7px, 4.3cqw); font-style:italic; font-weight:300; line-height:1; letter-spacing:.02em; font-variant-numeric:tabular-nums; text-shadow:0 1px 8px rgba(0,0,0,.5);}
  .ct-c-logo{position:absolute; top:4.2cqw; right:6cqw; height:8cqw; width:auto; max-width:none; display:block;}
  .ct-c-plaque{position:absolute; left:4cqw; right:4cqw; bottom:6.6cqw; display:flex; flex-direction:column-reverse; align-items:center; gap:0; text-align:center;}
  .ct-c-rar{margin-top:.6cqw; font-size:max(6px, 4.3cqw); font-style:italic; font-weight:400; line-height:1; letter-spacing:.1em; text-transform:uppercase; color:var(--rc); filter:brightness(1.12);}
  .ct-c-nom{max-width:100%; font-family:'Anton', 'Bebas Neue', Impact, 'Arial Narrow', sans-serif; font-size:calc(var(--nf, 1) * 15.5cqw); font-weight:400; text-transform:uppercase; line-height:.98; padding-top:.5cqw; letter-spacing:.01em; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
  .ct-c-reflet{position:absolute; inset:0; pointer-events:none; opacity:0; transition:opacity .3s;}
  .ct-carte.r4 .ct-c-reflet, .ct-carte.r5 .ct-c-reflet, .ct-carte.r6 .ct-c-reflet{opacity:1; background:linear-gradient(115deg, transparent 38%, rgba(255,255,255,.22) 48%, transparent 58%); background-size:300% 100%; background-position:var(--ct-lum, 120%) 0;}
  .ct-carte.holo .ct-c-reflet{opacity:.55; mix-blend-mode:color-dodge;
    background:linear-gradient(115deg, transparent 15%, rgba(255,60,190,.65) 30%, rgba(60,255,255,.6) 42%, rgba(255,255,90,.6) 54%, rgba(120,90,255,.6) 66%, transparent 80%);
    background-size:260% 260%; background-position:var(--hx, 50%) var(--hy, 50%);}
  .ct-carte.holo .ct-c-in::after{content:''; position:absolute; inset:0; pointer-events:none; opacity:.35; mix-blend-mode:overlay;
    background-image:radial-gradient(circle at 20% 30%, #fff 0 1px, transparent 1.5px), radial-gradient(circle at 70% 60%, #fff 0 1px, transparent 1.5px), radial-gradient(circle at 40% 80%, #fff 0 1px, transparent 1.5px);
    background-size:23px 23px, 31px 31px, 17px 17px;}
  .ct-carte.vivante.r4, .ct-carte.r4:hover{box-shadow:0 0 0 1px rgba(242,193,78,.35), 0 0 34px -6px rgba(242,193,78,.55), 0 14px 30px -14px rgba(0,0,0,.8);}
  .ct-carte.vivante.r5, .ct-carte.r5:hover{box-shadow:0 0 40px -6px rgba(255,92,138,.55), 0 14px 30px -14px rgba(0,0,0,.8);}
  .ct-carte.vivante.r6, .ct-carte.r6:hover{box-shadow:0 0 0 1px rgba(200,246,255,.5), 0 0 46px -4px rgba(143,239,255,.7), 0 14px 30px -14px rgba(0,0,0,.8);}
  .ct-carte.vivante.r4 .ct-c-reflet, .ct-carte.vivante.r5 .ct-c-reflet, .ct-carte.vivante.r6 .ct-c-reflet{animation:ctLum 3.6s ease-in-out infinite;}
  @media (hover:hover){
    .ct-carte.r4:hover .ct-c-reflet, .ct-carte.r5:hover .ct-c-reflet, .ct-carte.r6:hover .ct-c-reflet{animation:ctLum 2.4s ease-in-out infinite;}
    .ct-case:hover .ct-c-photo{transform:scale(1.05);}
  }
  .ct-carte.verrou{--rc:#6b7684; box-shadow:none;}
  .ct-carte.verrou .ct-c-photo{filter:grayscale(1) brightness(.26) contrast(1.15);}
  .ct-carte.verrou .ct-c-logo{opacity:.4;}
  .ct-carte.verrou .ct-c-nom{color:rgba(255,255,255,.55); text-shadow:none;}
  @container (max-width:125px){
    .ct-c-rar{display:none;}
    .ct-c-num{font-size:6.6cqw;}
    .ct-c-nom{font-size:calc(var(--nf, 1) * 13cqw); white-space:normal; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical;}
  }
  .ct-c-cadenas{position:absolute; left:50%; top:40%; transform:translate(-50%, -50%); width:16cqw; height:16cqw; color:rgba(255,255,255,.5); z-index:2;}
  .ct-c-cadenas svg{width:100%; height:100%;}
  .ct-c-badge{position:absolute; z-index:3; top:-7px; right:-7px; min-width:26px; height:24px; padding:0 7px; border-radius:99px; display:grid; place-items:center; font-size:12px; font-weight:800; color:#05070a; background:#F4F5F6; box-shadow:0 4px 12px rgba(0,0,0,.45); font-variant-numeric:tabular-nums;}
  .ct-c-nouveau{position:absolute; z-index:3; left:50%; top:-9px; transform:translateX(-50%); height:22px; padding:0 10px; border-radius:99px; display:grid; place-items:center; font-size:10.5px; font-weight:800; letter-spacing:.1em; text-transform:uppercase; color:#04131f; background:var(--ct-accent); box-shadow:0 4px 14px rgba(79,180,255,.5); white-space:nowrap;}

  .ct-case{all:unset; box-sizing:border-box; display:block; cursor:pointer; border-radius:13px; transition:transform .2s cubic-bezier(.2,.8,.2,1);}
  .ct-case:hover{transform:translateY(-4px);}
  .ct-case:focus-visible{outline:2px solid var(--ct-accent); outline-offset:3px;}
  .ct-grille{display:grid; grid-template-columns:repeat(auto-fill, minmax(150px, 1fr)); gap:18px 14px;}

  /* ---------- Packs : la vitrine à boosters ---------- */
  /* ---------- la page d'un booster (tracklist) ---------- */
  .ct-projet{--acc:#4FB4FF; padding:4px 0 8px; animation:ctFondu .35s ease both;}
  .ct-retour{margin-bottom:14px;}
  .ct-retour svg{transform:scaleX(-1);}
  .ct-pj-tete{display:flex; align-items:flex-end; gap:26px; padding:24px; border-radius:20px; border:1px solid var(--ct-trait);
    background:linear-gradient(180deg, color-mix(in srgb, var(--acc) 30%, transparent), rgba(255,255,255,.02) 85%);}
  .ct-pj-cover{flex:none; width:min(230px, 36vw); aspect-ratio:1; border-radius:6px; object-fit:cover; display:block; box-shadow:0 22px 44px -16px rgba(0,0,0,.85);}
  .ct-pj-vide{display:grid; place-items:center; color:#fff; background:linear-gradient(160deg, #0d2b4c, #08121f);}
  .ct-pj-vide .ct-embleme{width:56%;}
  .ct-pj-meta{min-width:0; text-align:left;}
  .ct-pj-type{font-size:12px; font-weight:600; letter-spacing:.1em; text-transform:uppercase; color:var(--ink-soft);}
  .ct-pj-meta h2{margin:8px 0 0; font-size:clamp(30px, 5vw, 54px); line-height:1; letter-spacing:-.03em;}
  .ct-pj-stat{margin:10px 0 0; font-size:14px; color:var(--ink-soft);}
  .ct-pj-meta .ct-ouvrir{justify-content:flex-start; margin-top:18px;}
  .ct-pj-desc{margin:16px 2px 0; max-width:64ch; font-size:14px; line-height:1.55; color:var(--ink-soft);}
  .ct-tracks{margin-top:18px; display:flex; flex-direction:column;}
  .ct-tr-tete, .ct-track{display:grid; grid-template-columns:34px 44px minmax(0, 1fr) 116px 48px; align-items:center; gap:14px; padding:8px 14px;}
  .ct-tr-tete{padding-bottom:10px; margin-bottom:4px; font-size:11.5px; font-weight:600; letter-spacing:.12em; text-transform:uppercase; color:var(--muted); border-bottom:1px solid var(--ct-trait);}
  .ct-tr-tete span:first-child{text-align:right;}
  .ct-track{appearance:none; border:0; background:transparent; font:inherit; color:inherit; text-align:left; cursor:pointer; width:100%; box-sizing:border-box; border-radius:10px; transition:background .15s;}
  .ct-track:hover, .ct-track:focus-visible{background:rgba(255,255,255,.06);}
  .ct-track:focus-visible{outline:2px solid var(--acc); outline-offset:-2px;}
  .ct-track .n{text-align:right; font-variant-numeric:tabular-nums; color:var(--muted); font-size:14px;}
  .ct-track .ph{width:44px; height:44px; border-radius:6px; object-fit:cover; object-position:50% 22%; background:#0a1018; display:block;}
  .ct-track .nom{font-size:15px; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
  .ct-track .rar{display:flex; align-items:center; gap:7px; font-size:12.5px; font-weight:600; color:var(--rc); filter:brightness(1.15);}
  .ct-track .rar::before{content:''; flex:none; width:7px; height:7px; border-radius:50%; background:currentColor;}
  .ct-track .et{display:flex; align-items:center; justify-content:flex-end; gap:5px; font-size:13px; font-weight:700; color:var(--ink-soft);}
  .ct-track .et svg{flex:none;}
  .ct-track.manque .ph{filter:grayscale(1) brightness(.4);}
  .ct-track.manque .nom{color:var(--muted);}
  .ct-track.manque .rar{opacity:.55;}
  .ct-voir{margin-top:12px;}
  .ct-couvs{display:grid; grid-template-columns:repeat(auto-fill, minmax(230px, 1fr)); gap:26px 22px; margin-top:6px;}
  .ct-couv{appearance:none; border:0; background:transparent; font:inherit; color:inherit; text-align:left; cursor:pointer; display:grid; gap:8px; padding:0; transition:transform .25s cubic-bezier(.2,.8,.2,1);}
  .ct-couv .img{display:block; aspect-ratio:1; border-radius:8px; overflow:hidden; box-shadow:0 20px 40px -18px rgba(0,0,0,.85), 0 0 0 1px rgba(255,255,255,.06); background:linear-gradient(160deg, #0d2b4c, #08121f); transition:box-shadow .25s;}
  .ct-couv .img img{width:100%; height:100%; object-fit:cover; display:block;}
  .ct-couv .vide{display:grid; place-items:center; width:100%; height:100%; color:#fff;}
  .ct-couv .vide .ct-embleme{width:52%;}
  .ct-couv b{font-size:17px; letter-spacing:-.01em; margin-top:6px;}
  .ct-couv small{font-size:13px; color:var(--ink-soft);}
  .ct-couv .ct-barre i{background:var(--acc);}
  .ct-couv:hover, .ct-couv:focus-visible{transform:translateY(-4px);}
  .ct-couv:hover .img, .ct-couv:focus-visible .img{box-shadow:0 26px 48px -16px color-mix(in srgb, var(--acc) 55%, #000), 0 0 0 1px color-mix(in srgb, var(--acc) 60%, transparent);}
  .ct-couv:focus-visible{outline:2px solid var(--acc); outline-offset:6px; border-radius:8px;}
  @media (max-width:640px){
    .ct-pj-tete{flex-direction:column; align-items:center; text-align:center; padding:20px 16px;}
    .ct-pj-cover{width:min(240px, 68vw);}
    .ct-pj-meta{text-align:center;}
    .ct-pj-meta .ct-ouvrir{justify-content:center;}
    .ct-tr-tete, .ct-track{grid-template-columns:26px 40px minmax(0, 1fr) 84px 36px; gap:10px; padding:8px 8px;}
    .ct-track .ph{width:40px; height:40px;}
    .ct-track .rar{font-size:11.5px;}
  }
  .ct-vitrine{position:relative; overflow-x:clip; padding:4px 0 8px; text-align:center; --acc:#4FB4FF;
    background:radial-gradient(60% 52% at 50% 36%, color-mix(in srgb, var(--acc) 24%, transparent), transparent 74%);}
  .ct-vit-tete{display:flex; align-items:center; justify-content:space-between; gap:12px; text-align:left;}
  .ct-surtitre{display:inline-flex; align-items:center; gap:7px; font-size:12px; font-weight:700; letter-spacing:.12em; text-transform:uppercase; color:var(--ct-accent);}
  .ct-compte{font-size:12.5px; font-weight:600; color:var(--muted); font-variant-numeric:tabular-nums;}

  .ct-car{position:relative; height:376px; margin:0; perspective:1200px; touch-action:pan-y; user-select:none; -webkit-user-select:none; outline:none;}
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

  .ct-car-item .ct-vinyle{margin-top:-4px;}
  .ct-vit-info{max-width:560px; margin:10px auto 0; min-height:104px;}
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
  /* le vinyle : une image carrée ; --dech (le geste) l'incline */
  .ct-pack.ct-vinyle{aspect-ratio:1; width:calc(var(--pk-w) * 1.18); filter:drop-shadow(0 22px 28px rgba(0,0,0,.5)) drop-shadow(0 0 34px color-mix(in srgb, var(--teinte) 35%, transparent));}
  .ct-vi-img{position:absolute; inset:0; width:100%; height:100%; max-width:none; display:block; border-radius:6px; transform:rotate(calc(var(--dech, 0) * 7deg)) scale(calc(1 + var(--dech, 0) * .07)); user-select:none; -webkit-user-drag:none;}
  .ct-vinyle .ct-pk-haut{display:none;}
  .ct-vinyle .ct-pk-ligne{top:50%; left:50%; width:0 !important; background:none; box-shadow:none;}
  .ct-vinyle .ct-pk-lumiere{top:50%;}
  .ct-vinyle .ct-pk-pile{border-radius:6px; background:linear-gradient(160deg, #20364a, #0b1620);}
  .ct-vinyle .ct-pk-indice{top:50%;}
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
    .ct-scene-pack .ct-pack{--pk-w:min(240px, 56vw); position:relative; z-index:2; animation:ctPose .45s cubic-bezier(.2,.9,.3,1) both; transition:transform .7s cubic-bezier(.5,0,.8,.3), opacity .5s;}
  .ct-scene-pack .ct-vinyle{--pk-w:min(290px, 66vw);}
  /* Le vinyle : il flotte et attend qu'on le touche ; le disque glisse hors de la pochette, vient au centre et tourne de plus en plus vite,
     puis il éclate : les cartes jaillissent en éventail et se rangent en pile. */
  .ct-scene-pack.attend{cursor:pointer; animation:ctFlotte2 5.5s ease-in-out infinite;}
  .ct-scene-pack.attend::after{content:''; position:absolute; z-index:3; inset:-5%; border-radius:12px; border:2px solid var(--teinte); pointer-events:none; animation:ctAttend 1.8s ease-out infinite;}
  .ct-scene-pack.vide .ct-pack{transform:translateY(46%) scale(.92); opacity:0;}
  .ct-disque{position:absolute; z-index:1; left:6%; width:88%; top:6%; aspect-ratio:1; border-radius:50%; pointer-events:none; opacity:0;
    background:#0a0a10; box-shadow:0 0 0 2px #05050a, 0 12px 34px rgba(0,0,0,.6); transform:translateY(0) scale(.94); transition:transform .65s cubic-bezier(.2,.9,.3,1), opacity .2s, box-shadow .5s;}
  .ct-disque-rot{position:absolute; inset:0; border-radius:50%;
    background:conic-gradient(from 0deg, rgba(255,255,255,.24), transparent 18%, rgba(255,255,255,.12) 40%, transparent 58%, rgba(255,255,255,.24) 80%, transparent),
      repeating-radial-gradient(circle at 50% 50%, #0c0c12 0 1.5px, #1c1c26 1.5px 3px);}
  .ct-disque-etq{position:absolute; left:50%; top:50%; width:34%; aspect-ratio:1; transform:translate(-50%, -50%); border-radius:50%; display:grid; place-items:center; background:var(--etq, #4FB4FF); box-shadow:inset 0 0 0 3px rgba(0,0,0,.25), 0 0 0 2px #07070b;}
  .ct-disque-etq img{width:68%; height:auto; display:block; filter:drop-shadow(0 1px 2px rgba(0,0,0,.4));}
  .ct-disque.sort{opacity:1; transform:translateY(-58%) scale(1);}
  .ct-disque.sort .ct-disque-rot{animation:ctGira 2.2s linear infinite;}
  .ct-disque.centre{z-index:3; transform:translateY(0) scale(1.12); box-shadow:0 0 0 2px #05050a, 0 0 70px 12px var(--lueur, #fff);}
  .ct-disque.centre .ct-disque-rot{animation-duration:.5s;}
  .ct-disque.boom{animation:ctBoom .32s ease-out forwards;}
  @keyframes ctGira{to{transform:rotate(360deg);}}
  @keyframes ctAttend{0%{opacity:.7; transform:scale(.96);} 100%{opacity:0; transform:scale(1.14);}}
  @keyframes ctBoom{from{opacity:1; transform:translateY(0) scale(1.12);} to{opacity:0; transform:translateY(0) scale(2.6);}}
  @keyframes ctPose{from{opacity:0; transform:scale(.86);}}
  @keyframes ctJaillit{0%{opacity:0; transform:translate(0, -6vh) scale(.15) rotate(0deg);} 18%{opacity:1;} 52%{opacity:1; transform:translate(var(--fx), var(--fy)) scale(.9) rotate(var(--fr));}}
  @keyframes ctSort{to{opacity:0; transform:translate(-95%, -35%) rotate(-18deg) scale(.7);}}
  @keyframes ctSheen{to{transform:translateX(130%);}}
  /* la pile de cartes : la carte du dessus se soulève, se retourne, part ; la suivante prend sa place */
  .ct-pile{position:relative; width:var(--lc, 240px); aspect-ratio:4 / 5;}
  .ct-pile .ct-place{position:absolute; inset:0; width:auto; max-width:none; cursor:pointer; --k:0; transform:translate(calc(var(--k) * 7px), calc(var(--k) * -5px)) rotate(calc(var(--k) * 1.8deg)); transition:transform .32s cubic-bezier(.2,.8,.2,1);}
  .ct-pile.entre .ct-place{animation:ctJaillit .95s cubic-bezier(.2,.9,.25,1) backwards; animation-delay:calc(var(--ji) * 60ms);}
  .ct-pile .ct-place.retournee{transform:none;}
  .ct-pile .ct-place.leve{transform:translateY(-16px) scale(1.05);}
  .ct-pile .ct-place.sort{animation:ctSort .5s cubic-bezier(.5,0,.8,.4) forwards; pointer-events:none;}
  .ct-pile .ct-place.rapide .ct-volte{transition-duration:.3s;}
  .ct-pile .ct-place.sort.rapide{animation-duration:.22s;}
  .ct-sheen{position:absolute; inset:3px; border-radius:10px; overflow:hidden; pointer-events:none; z-index:5;}
  .ct-sheen::after{content:''; position:absolute; inset:0; background:linear-gradient(105deg, transparent 38%, rgba(255,255,255,.6) 50%, transparent 62%); transform:translateX(-130%);}
  .ct-place.retournee .ct-sheen::after{animation:ctSheen .9s .45s ease-out both;}
  .ct-pk-haut.part{transition:transform .65s cubic-bezier(.3,.6,.2,1), opacity .65s; transform:translate(-18%, -230%) rotate(-28deg); opacity:0;}
  .ct-pk-lumiere.on{animation:ctLumiere .9s ease-out forwards;}
  .ct-scene-pack.parti{transform:translateY(55vh) scale(.8) rotate(6deg); opacity:0;}

  .ct-donne{display:grid; gap:40px 14px; width:min(1000px, 100%); grid-template-columns:repeat(var(--cols, 5), minmax(0, 1fr)); justify-items:center; align-content:center;}
  .ct-place{position:relative; width:100%; max-width:var(--lc, 180px); perspective:1000px;}
  .ct-donne.seule .ct-place{--lc:min(300px, 66vw, 40vh);}
  .ct-volte{position:relative; width:100%; aspect-ratio:4 / 5; cursor:pointer; transform-style:preserve-3d; transition:transform .75s cubic-bezier(.2,.75,.25,1);}
  .ct-volte:focus-visible{outline:2px solid #fff; outline-offset:4px; border-radius:14px;}
  .ct-place.retournee .ct-volte{transform:rotateY(180deg);}
  .ct-place.donne{animation:ctDonne .6s cubic-bezier(.2,.9,.25,1) both;}
  .ct-dos, .ct-face{position:absolute; inset:0; backface-visibility:hidden; -webkit-backface-visibility:hidden; border-radius:5% / 4%;}
  .ct-face{transform:rotateY(180deg);}
  .ct-face .ct-carte{width:100%; height:100%;}
  .ct-dos{display:grid; place-items:center; padding:.75%; background:#000; box-shadow:0 18px 40px -16px rgba(0,0,0,.9);}
  .ct-dos-in{width:100%; height:100%; border-radius:4.3% / 3.4%; background:#06101c url(img/carte-dos.webp) center / cover no-repeat;}
  .ct-dos-logo{display:none;}
  .ct-dos[data-r="2"]{box-shadow:0 0 0 1px rgba(79,180,255,.5), 0 0 26px -2px rgba(79,180,255,.55), 0 18px 40px -16px rgba(0,0,0,.9);}
  .ct-dos[data-r="3"]{box-shadow:0 0 0 1px rgba(168,121,255,.6), 0 0 34px 0 rgba(168,121,255,.6), 0 18px 40px -16px rgba(0,0,0,.9); animation:ctPouls 1.6s ease-in-out infinite; --pc:rgba(168,121,255,.75);}
  .ct-dos[data-r="4"]{box-shadow:0 0 0 1px rgba(242,193,78,.7), 0 0 42px 2px rgba(242,193,78,.65), 0 18px 40px -16px rgba(0,0,0,.9); animation:ctPouls 1.1s ease-in-out infinite; --pc:rgba(242,193,78,.85);}
  .ct-dos[data-r="5"]{box-shadow:0 0 0 1px rgba(255,92,138,.8), 0 0 50px 4px rgba(255,92,138,.7), 0 18px 40px -16px rgba(0,0,0,.9); animation:ctPouls .8s ease-in-out infinite; --pc:rgba(255,120,180,.95);}
  .ct-dos[data-r="6"]{box-shadow:0 0 0 1px rgba(210,248,255,.95), 0 0 60px 6px rgba(143,239,255,.8), 0 18px 40px -16px rgba(0,0,0,.9); animation:ctPouls .65s ease-in-out infinite; --pc:rgba(190,246,255,1);}
  .ct-place.charge .ct-volte{animation:ctCharge .09s linear infinite;}
  .ct-place.charge .ct-dos{filter:brightness(1.35);}
  .ct-etiq{position:absolute; left:50%; top:calc(100% + 12px); transform:translateX(-50%); z-index:4; white-space:nowrap; pointer-events:none;
    padding:6px 14px; border-radius:99px; font-size:12px; font-weight:800; letter-spacing:.14em; text-transform:uppercase; color:#05070a; background:var(--rc); box-shadow:0 6px 18px rgba(0,0,0,.35); animation:ctEtiq .5s cubic-bezier(.2,1.4,.4,1) both;}
  .ct-etiq.nouveau{background:var(--ct-accent);}
  .ct-etiq.double{background:rgba(255,255,255,.9);}
  .ct-donne:not(.seule) .ct-etiq{top:calc(100% + 8px); font-size:10px; padding:4px 9px; letter-spacing:.1em;}
  .ct-titre-rar{position:absolute; left:0; right:0; top:12%; z-index:4; text-align:center; pointer-events:none; font-size:clamp(28px, 7vw, 64px); font-weight:900; letter-spacing:.18em; text-transform:uppercase;
    color:#fff; text-shadow:0 0 30px var(--teinte), 0 0 60px var(--teinte); animation:ctTitre 1.6s cubic-bezier(.2,.8,.2,1) both;}
  /* le pack : il tremble, la lumière de la meilleure carte filtre au travers, puis l'onde de choc */
  .ct-onde{position:absolute; left:50%; top:45%; width:20vmin; height:20vmin; margin:-10vmin 0 0 -10vmin; border-radius:50%; z-index:5; pointer-events:none; opacity:0;
    border:3px solid var(--oc, #fff); box-shadow:0 0 36px var(--oc, #fff), inset 0 0 36px var(--oc, #fff); animation:ctOnde 1.2s cubic-bezier(.1,.7,.3,1) forwards;}
  @keyframes ctOnde{0%{opacity:.95; transform:scale(.1);} 100%{opacity:0; transform:scale(9);}}
  /* la carte Mythique : la salle s'assombrit, un halo irisé tourne derrière elle, la caméra s'approche lentement */
  .ct-scene-fond{transition:background .8s ease, filter 1s ease;}
  .ct-scene.sombre .ct-scene-fond{filter:brightness(.5) saturate(1.3);}
  .ct-halo{position:absolute; left:50%; top:50%; width:200%; aspect-ratio:1; transform:translate(-50%, -50%); z-index:-1; pointer-events:none; opacity:0; border-radius:50%; filter:blur(22px);
    background:conic-gradient(from 0deg, #ff5c8a, #ffb547, #fff27a, #5cffc8, #5cb8ff, #b36bff, #ff5c8a);
    -webkit-mask-image:radial-gradient(circle, #000 0%, transparent 60%); mask-image:radial-gradient(circle, #000 0%, transparent 60%);
    animation:ctHaloIn 1.4s ease forwards, ctTourne 9s linear infinite;}
  @keyframes ctHaloIn{to{opacity:.9;}}
  .ct-clip{position:absolute; inset:0; z-index:0; overflow:hidden; opacity:0; transition:opacity 1.2s ease; pointer-events:none;}
  .ct-clip.on{opacity:.9;}
  /* Le clip couvre tout l'écran, quel que soit son format : 16:9 étiré jusqu'aux quatre bords, puis agrandi de 18 % pour
     perdre les bandes noires et le bandeau de titre de YouTube. */
  .ct-clip iframe{position:absolute; left:50%; top:50%; width:max(100vw, 177.78vh); height:max(100vh, 56.25vw); transform:translate(-50%, -50%) scale(1.18); border:0; pointer-events:none;}
  .ct-clip::after{content:''; position:absolute; inset:0; background:radial-gradient(80% 70% at 50% 46%, rgba(3,4,7,.05), rgba(3,4,7,.5));}
  /* Pendant l'ouverture, on touche les cartes pour avancer : rien ne doit se sélectionner. */
  .ct-scene, .ct-scene *{-webkit-user-select:none; user-select:none; -webkit-touch-callout:none; -webkit-tap-highlight-color:transparent;}
  .ct-pile.mythe{animation:ctPousse 7s ease-out both;}
  @keyframes ctPousse{from{transform:scale(1);} to{transform:scale(1.07);}}
  .ct-titre-rar.mythe{letter-spacing:.16em; animation:ctTitreMythe 2.8s ease both; text-shadow:none; filter:drop-shadow(0 0 22px var(--teinte)) drop-shadow(0 0 48px var(--teinte));}
  .ct-titre-rar.mythe span{display:inline-block; opacity:0; background:linear-gradient(180deg, #fff, #ffd2e1 45%, var(--teinte)); -webkit-background-clip:text; background-clip:text; color:transparent;
    animation:ctLettre .8s cubic-bezier(.2,1.4,.3,1) forwards; animation-delay:calc(var(--i) * 80ms);}
  .ct-halo.special{background:conic-gradient(from 0deg, #ffffff, #8fefff, #b9a8ff, #ffffff, #7fd4ff, #e6f9ff, #ffffff);}
  .ct-titre-rar.special span{background:linear-gradient(180deg, #fff, #d7f6ff 45%, var(--teinte)); -webkit-background-clip:text; background-clip:text;}
  @keyframes ctLettre{from{opacity:0; transform:translateY(40px) scale(2.2) rotateX(70deg);} to{opacity:1; transform:none;}}
  @keyframes ctTitreMythe{0%,82%{opacity:1;} 100%{opacity:0;}}
  @media (prefers-reduced-motion: reduce){ .ct-onde, .ct-halo{display:none;} .ct-pile.mythe{animation:none;} }
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
  .ct-raretes{grid-column:1 / -1; display:grid; grid-template-columns:repeat(var(--nr, 5), minmax(0, 1fr)); gap:8px; margin-top:6px;}
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
    .ct-res small{display:none;}
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
    .ct-raretes.six{grid-template-columns:repeat(3, minmax(0, 1fr));}
    .ct-raretes.six .ct-rar-btn, .ct-raretes.six .ct-rar-btn:nth-child(n+4){grid-column:auto;}
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
    .ct-carte, .ct-c-reflet, .ct-pack, .ct-car-item.centre .ct-pack, .ct-vit-info-in, .ct-pile .ct-place, .ct-pk-haut::after, .ct-pk-corps::before, .ct-dos, .ct-rayons, .ct-pk-indice{animation:none !important;}
    .ct-volte, .ct-roue-disque{transition-duration:.01s !important;}
    .ct-pile .ct-place.sort{opacity:0 !important;}
  }`;

  function poserStyle(){
    if(document.getElementById('ct-style')) return;
    const s = document.createElement('style');
    s.id = 'ct-style';
    s.textContent = STYLE;
    document.head.appendChild(s);
    // Les ornements des cartes, dessinés une fois et réutilisés par chaque carte (<use>).
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
  // Le son : tout est synthétisé (rien à charger), façon cozy / lo-fi : des notes de piano électrique feutré dans le medium,
  // des nappes douces, une basse ronde sans claquement, le grain d'un vinyle, un filtre chaud qui adoucit tout. Rien ne
  // dépasse 0,25 de niveau. L'ouverture d'un pack se joue au carton : on déchire le rabat, puis la pochette du vinyle
  // glisse. Coupable d'un clic.

  const Son = {
    ctx: null,
    base: null,
    sortie: null,
    rev: null,
    vol: 1,
    tamponBruit: null,
    crac1: null,
    crac2: null,
    actif(){ try{ return localStorage.getItem('lw-cartes-son') !== '0'; }catch(e){ return true; } },
    basculer(){ const v = !this.actif(); try{ localStorage.setItem('lw-cartes-son', v ? '1' : '0'); }catch(e){} return v; },
    pret(){
      if(!this.actif()) return null;
      try{
        if(!this.ctx){
          const a = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
          // Sortie : un compresseur léger, un filtre chaud (rien au-dessus de 3 kHz), le volume général.
          const c = a.createDynamicsCompressor();
          c.threshold.value = -20; c.knee.value = 14; c.ratio.value = 3; c.attack.value = .01; c.release.value = .25;
          const f = a.createBiquadFilter();
          f.type = 'lowpass'; f.frequency.value = 3000; f.Q.value = .4;
          const m = a.createGain();
          m.gain.value = .75;
          c.connect(f); f.connect(m); m.connect(a.destination);
          this.base = this.sortie = c;
          // Une salle douce et sombre, synthétique.
          const n = Math.floor(a.sampleRate * 1.7), ir = a.createBuffer(2, n, a.sampleRate);
          for(let ch = 0; ch < 2; ch++){
            const d = ir.getChannelData(ch);
            let prec = 0;
            for(let i = 0; i < n; i++){
              prec += ((Math.random() * 2 - 1) - prec) * .35;           // un peu de passe-bas : la queue est sombre
              d[i] = prec * Math.pow(1 - i / n, 2.6);
            }
          }
          const r = a.createConvolver(), rg = a.createGain();
          r.buffer = ir; rg.gain.value = .6;
          r.connect(rg); rg.connect(c);
          this.rev = r;
        }
        if(this.ctx.state === 'suspended') this.ctx.resume();
      }catch(e){ return null; }
      return this.ctx;
    },

    // ---- les briques --------------------------------------------------------------------------------------
    vers(noeud, envoi){
      noeud.connect(this.sortie);
      if(envoi && this.rev){
        const e = this.ctx.createGain();
        e.gain.value = envoi * this.vol;
        noeud.connect(e); e.connect(this.rev);
      }
    },
    bruitBuf(){
      const a = this.ctx;
      if(!this.tamponBruit){
        const n = a.sampleRate, b = a.createBuffer(1, n, a.sampleRate), d = b.getChannelData(0);
        for(let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
        this.tamponBruit = b;
      }
      return this.tamponBruit;
    },
    // Du crépitement : de petits claquements secs au hasard, comme du carton qu'on plie ou le grain d'un vinyle.
    crepit(dense){
      const cle = dense ? 'crac2' : 'crac1';
      if(this[cle]) return this[cle];
      const a = this.ctx, n = a.sampleRate * 2, b = a.createBuffer(1, n, a.sampleRate), d = b.getChannelData(0), p = dense ? .035 : .011;
      let i = 0;
      while(i < n){
        if(Math.random() < p){
          const amp = Math.pow(Math.random(), 1.5), long = 4 + Math.floor(Math.random() * 20), sg = Math.random() < .5 ? -1 : 1;
          for(let k = 0; k < long && i + k < n; k++) d[i + k] += sg * amp * Math.exp(-k / (long * .35)) * (.7 + Math.random() * .6);
          i += long;
        }else{
          i++;
        }
      }
      return (this[cle] = b);
    },
    crep(debut, duree, f0, f1, courbe, vol, dense){
      const a = this.ctx, src = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain(), t = a.currentTime + debut;
      src.buffer = this.crepit(dense); src.loop = true; src.playbackRate.value = .9 + Math.random() * .2;
      f.type = 'bandpass'; f.Q.value = .8;
      f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + duree);
      g.gain.setValueAtTime(0.0001, t);
      courbe.forEach(([k, v]) => g.gain.linearRampToValueAtTime(Math.max(.0001, v * vol), t + duree * k));
      g.gain.linearRampToValueAtTime(0.0001, t + duree + .03);
      src.connect(f); f.connect(g); this.vers(g);
      src.start(t, Math.random()); src.stop(t + duree + .06);
    },
    // Le grain d'un vinyle qui tourne, très bas, sous les autres sons.
    grain(debut, duree, vol){
      this.crep(debut, duree, 1500, 2100, [[.15, 1], [.85, 1], [1, 0]], vol, false);
    },
    // Du froissement qui sonne vrai : du bruit filtré dont le volume est haché en petites « ruptures » au hasard (un coup, un
    // creux, un coup plus fort), comme le plastique d'un disque neuf ou le carton d'une pochette qu'on plie. `fort` fait
    // monter l'ensemble de l'ouverture à la fin (1) ou le garde égal (0).
    froisser(debut, duree, f0, f1, vol, fort, pas){
      const a = this.ctx, src = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain(), t = a.currentTime + debut;
      src.buffer = this.bruitBuf(); src.loop = true; f.type = 'bandpass'; f.Q.value = .7;
      f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + duree);
      g.gain.setValueAtTime(0.0001, t);
      let x = 0;
      while(x < duree){
        const k = x / duree, niveau = vol * (1 - fort + fort * (.25 + .75 * k)) * Math.pow(Math.random(), 1.4) * (Math.random() < .18 ? 1.6 : 1);
        const long = .006 + Math.random() * .03;
        g.gain.setValueAtTime(.0001, t + x);
        g.gain.linearRampToValueAtTime(Math.max(.0001, niveau), t + x + .002);
        g.gain.exponentialRampToValueAtTime(.0001, t + x + long);
        x += long + Math.random() * (pas || .02);
      }
      src.connect(f); f.connect(g); this.vers(g, .15); src.start(t, Math.random() * .5); src.stop(t + duree + .05);
    },
    souffle(debut, duree, f0, f1, vol, q){
      const a = this.ctx, src = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain(), t = a.currentTime + debut;
      src.buffer = this.bruitBuf(); src.loop = true; f.type = 'bandpass'; f.Q.value = q || 1;
      f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + duree);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + duree * .3); g.gain.exponentialRampToValueAtTime(0.0001, t + duree);
      src.connect(f); f.connect(g); this.vers(g); src.start(t); src.stop(t + duree + .03);
    },
    // Une note douce : sinus ou triangle filtré, attaque arrondie, et un léger vacillement de hauteur comme une vieille bande.
    ton(f, debut, duree, vol, type, filtre, glisse, envoi){
      const a = this.ctx, t = a.currentTime + debut, o = a.createOscillator(), fl = a.createBiquadFilter(), g = a.createGain();
      o.type = type || 'sine'; o.frequency.setValueAtTime(f, t);
      if(glisse) o.frequency.exponentialRampToValueAtTime(glisse, t + duree);
      if(duree > .25){
        const l = a.createOscillator(), lg = a.createGain();
        l.frequency.value = .5 + Math.random() * .5; lg.gain.value = 7;
        l.connect(lg); lg.connect(o.detune); l.start(t); l.stop(t + duree + .05);
      }
      fl.type = 'lowpass'; fl.frequency.value = filtre || 1500; fl.Q.value = .5;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + .014);
      g.gain.exponentialRampToValueAtTime(Math.max(.0002, vol * .5), t + duree * .5); g.gain.exponentialRampToValueAtTime(0.0001, t + duree);
      o.connect(fl); fl.connect(g); this.vers(g, envoi); o.start(t); o.stop(t + duree + .04);
    },
    // Un piano électrique feutré : le son rond de la note, un peu de brillance qui s'éteint tout de suite, dans la salle.
    piano(f, debut, duree, vol, envoi){
      const a = this.ctx, t = a.currentTime + debut, fl = a.createBiquadFilter(), g = a.createGain();
      fl.type = 'lowpass'; fl.frequency.value = 2200; fl.Q.value = .5;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + .01);
      g.gain.exponentialRampToValueAtTime(Math.max(.0002, vol * .35), t + duree * .35); g.gain.exponentialRampToValueAtTime(0.0001, t + duree);
      [[1, 1, 'sine', duree], [2, .26, 'sine', duree * .45], [3, .1, 'sine', duree * .2]].forEach(([m, v, type, d]) => {
        const o = a.createOscillator(), og = a.createGain();
        o.type = type; o.frequency.setValueAtTime(f * m, t); o.detune.value = (Math.random() - .5) * 8;
        og.gain.setValueAtTime(v, t); og.gain.exponentialRampToValueAtTime(.0001, t + d);
        o.connect(og); og.connect(fl); o.start(t); o.stop(t + duree + .05);
      });
      fl.connect(g); this.vers(g, envoi === undefined ? .4 : envoi);
    },
    arpege(notes, debut, pas, duree, vol, envoi){
      notes.forEach((f, k) => this.piano(f, debut + k * pas, duree, vol, envoi));
    },
    // Une basse ronde : un sinus grave, attaque douce (pas de claquement), filtré.
    boom(f, debut, duree, vol, glisse){
      const a = this.ctx, t = a.currentTime + debut, o = a.createOscillator(), fl = a.createBiquadFilter(), g = a.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(f * 1.3, t); o.frequency.exponentialRampToValueAtTime(f, t + .05);
      if(glisse) o.frequency.exponentialRampToValueAtTime(glisse, t + duree * .9);
      fl.type = 'lowpass'; fl.frequency.value = 240; fl.Q.value = .5;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + .02);
      g.gain.setValueAtTime(vol, t + Math.min(.14, duree * .2)); g.gain.exponentialRampToValueAtTime(0.0001, t + duree);
      o.connect(fl); fl.connect(g); this.vers(g); o.start(t); o.stop(t + duree + .05);
    },
    // Une nappe douce qui gonfle : deux triangles très légèrement désaccordés par note, filtre sombre qui s'ouvre un peu.
    nappe(freqs, debut, duree, vol, filtre){
      const a = this.ctx, t = a.currentTime + debut, fl = a.createBiquadFilter(), g = a.createGain();
      fl.type = 'lowpass'; fl.Q.value = .5;
      fl.frequency.setValueAtTime(380, t); fl.frequency.exponentialRampToValueAtTime(filtre || 1000, t + duree * .5);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + duree * .4); g.gain.exponentialRampToValueAtTime(0.0001, t + duree);
      freqs.forEach((f) => [-6, 6].forEach((c) => {
        const o = a.createOscillator();
        o.type = 'triangle'; o.frequency.setValueAtTime(f, t); o.detune.value = c;
        o.connect(fl); o.start(t); o.stop(t + duree + .05);
      }));
      fl.connect(g); this.vers(g, .4);
    },

    // ---- les sons du jeu ----------------------------------------------------------------------------------
    // Le volume (0 à 1) est celui de cet appel seulement : la carte Mythique règle le sien dans la console.
    // Les notes viennent d'un do majeur à septièmes (do, mi, sol, si, ré), le plus doux des accords de lo-fi.
    jouer(quoi, vol){
      if(!this.pret()) return;
      this.vol = vol === undefined ? 1 : vol;
      if(vol !== undefined && vol !== 1){
        const bus = this.ctx.createGain();
        bus.gain.value = vol; bus.connect(this.base); this.sortie = bus;
      }
      try{
        if(quoi === 'tic'){ this.ton(392, 0, .07, .15, 'sine', 1200, 330); }
        else if(quoi === 'donne'){ this.souffle(0, .12, 1000, 450, .3, .6); }
        else if(quoi === 'volte'){ this.boom(100, 0, .16, .18, 72); this.souffle(0, .08, 1400, 600, .08, .8); }
        else if(quoi === 'gain'){ this.piano(392, 0, .4, .14); this.piano(587, .1, .5, .12); }
        // L'ouverture du pack, au disque neuf : le film plastique se froisse pendant l'attente, puis on le déchire, la pochette en
        // carton glisse hors de son étui, la pointe se pose sur le sillon (un « tump » rond, le grain qui s'installe) et un
        // accord doux de piano électrique accueille la musique.
        else if(quoi === 'froisse'){
          this.froisser(0, .95, 1100, 2200, .3, 1, .045);
          this.nappe([131, 196], 0, .95, .045, 700);
        }
        else if(quoi === 'dechire'){
          this.froisser(0, .38, 900, 2400, .55, 1, .012);
          this.froisser(0, .42, 300, 800, .35, 1, .02);
          this.souffle(.4, .5, 1000, 340, .1, .45);
          this.boom(70, .86, .35, .26, 52); this.grain(.88, 1.6, .05);
          this.arpege([262, 330, 392, 494], 1.0, .13, 1, .09, .5);
        }
        else if(quoi === 'charge'){ this.nappe([196, 247, 330], 0, .9, .09, 1100); this.ton(165, 0, .85, .06, 'sine', 900, 262); this.grain(0, .9, .025); }
        // La montée de la Mythique : une nappe qui gonfle, un cœur qui accélère, le vinyle qui grésille de plus en plus (1,9 s).
        else if(quoi === 'montee'){
          this.nappe([131, 196, 262, 330], 0, 1.9, .12, 1200); this.ton(110, 0, 1.9, .05, 'sine', 900, 440);
          this.grain(0, 1.9, .04);
          [0, .45, .85, 1.2, 1.5, 1.72, 1.88].forEach((d, k) => this.boom(62 + k * 4, d, .2, .09 + k * .015, 52));
        }
        else if(quoi === 'r1'){ this.piano(330, 0, .5, .2); }
        else if(quoi === 'r2'){ this.arpege([330, 392], 0, .09, .55, .17); }
        else if(quoi === 'r3'){ this.arpege([262, 330, 392], 0, .09, .7, .13); this.boom(65, .05, .4, .2, 52); }
        else if(quoi === 'r4'){
          this.arpege([262, 330, 392, 494], 0, .09, .9, .13); this.boom(55, 0, .8, .26, 44);
          this.nappe([175, 262, 330, 392], .15, 1, .08, 1100);
        }
        // La fanfare de la Mythique (choix par défaut) : une grande nappe, un arpège qui monte, une basse ronde, une cloche lointaine.
        else if(quoi === 'r5'){
          this.nappe([131, 196, 262, 330, 494], 0, 1.7, .1, 1300); this.boom(48, 0, 1.3, .22, 38);
          this.arpege([262, 330, 392, 494, 587, 659], .1, .11, 1, .13, .5);
          this.ton(1047, 1.0, 1.2, .04, 'sine', 2400, null, .7); this.grain(0, 2, .04);
        }
        // Le Spécial : un givre qui scintille. Une nappe de glace, un arpège cristallin tout en haut du clavier, une basse ronde, une cloche gelée.
        else if(quoi === 'r6'){
          this.nappe([131, 196, 262, 330, 494], 0, 2, .1, 1500); this.boom(46, 0, 1.4, .24, 36);
          this.arpege([392, 494, 587, 784, 988, 1175, 1568], .1, .12, 1, .11, .5);
          this.ton(2093, 1.1, 1.6, .03, 'sine', 3200, null, .7); this.ton(1568, 1.35, 1.6, .028, 'sine', 3200, null, .7); this.grain(0, 2.4, .035);
        }
        else if(quoi === 'impact'){ this.boom(46, 0, 1.5, .4, 34); this.nappe([65, 98], 0, 1.4, .07, 500); }
        else if(quoi === 'cristal'){ this.arpege([523, 659, 784, 988], 0, .12, .9, .09, .55); }
        else if(quoi === 'holo'){ this.ton(659, 0, .35, .06, 'triangle', 1800, 988, .5); this.ton(988, .14, .4, .045, 'sine', 1800, null, .5); }
        else if(quoi === 'niveau'){ this.arpege([262, 330, 392, 494, 659], 0, .1, .8, .12); this.boom(65, 0, .5, .2, 52); }
      }catch(e){ /* un navigateur sans audio : on joue en silence */ }
      this.sortie = this.base;
      this.vol = 1;
    }
  };

  // ---------------------------------------------------------------------
  // Les particules : un seul canevas, qui ne tourne que tant qu'il a de quoi dessiner
  // ---------------------------------------------------------------------

  function Effets(canvas){
    const g = canvas.getContext('2d');
    let parts = [], boucle = 0, l = 0, h = 0, flux = 0, fluxNeige = 0;
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
      // Des braises qui montent doucement pendant `ms` : le décor reste vivant tant qu'une carte Mythique est à l'écran.
      braises(couleurs, ms){
        if(calme()) return;
        clearInterval(flux);
        const fin = performance.now() + (ms || 4000);
        flux = setInterval(() => {
          if(performance.now() > fin){ clearInterval(flux); flux = 0; return; }
          for(let i = 0; i < 3; i++){
            const vie = 150 + Math.random() * 120;
            parts.push({ x: Math.random() * l, y: h + 10, vx: (Math.random() - .5) * .8, vy: -(1.2 + Math.random() * 2.2), grav: 0, frein: .999,
              t: 1.5 + Math.random() * 2.5, c: couleurs[Math.floor(Math.random() * couleurs.length)], vie, vie0: vie, rot: 0, vr: 0, forme: 'etincelle' });
          }
          lancer();
        }, 70);
      },
      // De la neige qui tombe doucement pendant `ms` : le décor de la carte Spécial.
      neige(ms){
        if(calme()) return;
        clearInterval(fluxNeige);
        const fin = performance.now() + (ms || 5000);
        fluxNeige = setInterval(() => {
          if(performance.now() > fin){ clearInterval(fluxNeige); fluxNeige = 0; return; }
          for(let i = 0; i < 2; i++){
            const vie = 260 + Math.random() * 160;
            parts.push({ x: Math.random() * l, y: -10, vx: (Math.random() - .5) * .7, vy: .7 + Math.random() * 1.3, grav: 0, frein: 1,
              t: 1.6 + Math.random() * 2.6, c: Math.random() < .5 ? '#ffffff' : '#bfeaff', vie, vie0: vie, rot: 0, vr: 0, forme: 'etincelle' });
          }
          lancer();
        }, 80);
      },
      // Une poussière lente et claire, en fond : la salle est vivante dès l'arrivée du pack.
      poussiere(couleur, ms){
        if(calme()) return;
        const fin = performance.now() + (ms || 6000);
        const t = setInterval(() => {
          if(performance.now() > fin){ clearInterval(t); return; }
          const vie = 240 + Math.random() * 160;
          parts.push({ x: Math.random() * l, y: h * (.4 + Math.random() * .6), vx: (Math.random() - .5) * .3, vy: -(.15 + Math.random() * .5), grav: 0, frein: 1,
            t: 1 + Math.random() * 1.6, c: couleur, vie, vie0: vie, rot: 0, vr: 0, forme: 'etincelle' });
          lancer();
        }, 140);
      },
      calmer(){ clearInterval(flux); flux = 0; clearInterval(fluxNeige); fluxNeige = 0; },
      fin(){ clearInterval(flux); clearInterval(fluxNeige); cancelAnimationFrame(boucle); boucle = 0; parts = []; window.removeEventListener('resize', taille); }
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
    const r = Math.min(Math.max(Number(c.rarete) || 1, 1), 6);
    const verrou = !!o.verrou;
    const holo = !!c.holo && !verrou;
    const lg = String(c.nom || '').length;
    // Anton est une police étroite : le nom tient sur 80 % de la largeur jusqu'à 12 lettres, puis rétrécit.
    const taille = Math.max(.42, Math.min(1, 12.5 / Math.max(lg, 1)));
    return `
      <div class="ct-carte r${r}${holo ? ' holo' : ''}${verrou ? ' verrou' : ''}${o.vivante ? ' vivante' : ''}" style="--nf:${taille}">
        <div class="ct-c-in">
          <img class="ct-c-photo" src="${esc(safeUrl(c.photo))}" alt="" loading="${o.eager ? 'eager' : 'lazy'}" decoding="async">
          <div class="ct-c-voile"></div>
          
          <span class="ct-c-num">${numero(c.numero)}</span>
          <img class="ct-c-logo" src="img/logo-wave.png" alt="La Wave" width="380" height="204" decoding="async">
          ${verrou ? `<span class="ct-c-cadenas">${ico('cadenas', 24)}</span>` : ''}
          <div class="ct-c-plaque">
            <div class="ct-c-rar">${esc(rar(r).nom)}</div>
            <div class="ct-c-nom">${esc(c.nom)}</div>
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
    hote: null, etat: null, vue: 'accueil', occupe: false, minuteur: null, corps: null,
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
        <div class="ct-res vinyles" title="Vinyles : 1 vinyle = 1 ouverture de pack.">${ico('vinyle', 17)}${nf(e.vinyles)}</div>
        <button type="button" class="ct-res wc" data-echange title="Wave Coins : échange-les contre des vinyles (${e.taux_wc || 50} Wave Coins = 1 vinyle).">${ico('piece', 17)}${nf(e.wc || 0)}<small>Échanger</small></button>
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
    const icones = { accueil: 'accueil', packs: 'pack', collection: 'cartes', combat: 'combat', marche: 'marche', missions: 'cible', bonus: 'cadeau', succes: 'trophee' };
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
    S.vue = VUES.some(v => v[0] === demande) ? demande : (VUES.some(v => v[0] === S.vue) ? S.vue : 'accueil');

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
        if(ev.target.closest('[data-echange]')){ fenetreEchange(); return; }
        if(ev.target.closest('.ct-tete [data-son]')){ Son.basculer(); if(Son.actif()) Son.jouer('tic'); majEntete(); }
      });
    }

    await afficherVue(S.vue);

    // Le cadeau du jour s'offre de lui-même, une fois par visite.
    if(S.etat.cadeau_pret && !S.cadeauPropose){
      S.cadeauPropose = true;
      setTimeout(() => { if(S.hote && S.hote.isConnected && !document.querySelector('.ct-voile, .ct-scene')) fenetreCadeau(); }, 700);
    }
  }

  function quitter(){
    ['WaveAccueil', 'WaveCombat', 'WaveMarche'].forEach((g) => { if(window[g] && typeof window[g].quitter === 'function') window[g].quitter(); });
    clearInterval(S.minuteur);
  }

  function changerVue(v){
    if(S.vue === v && S.corps && S.corps.children.length) return;
    S.vue = v;
    S.projet = null;
    try{ history.replaceState(history.state, '', '#community/cartes/' + v); }catch(e){}
    majEntete();
    afficherVue(v);
  }

  // Les onglets Combat et Marché vivent dans leurs fichiers (combat.js, marche.js), chargés à la demande par index.html
  // (chargerWaveModule) ; chacun reçoit l'élément à remplir et l'interface partagée du jeu (voir « api » plus bas).
  async function vueModule(nom, global){
    S.corps.innerHTML = '<div class="ct-vide">Chargement…</div>';
    await window.chargerWaveModule(nom);
    const m = window[global];
    if(!m || typeof m.monter !== 'function') throw new Error('Ce module ne s\'est pas lancé.');
    S.corps.innerHTML = '';
    await m.monter(S.corps, api);
  }

  async function afficherVue(v){
    if(!S.corps.querySelector('.ct-panneau')) S.corps.innerHTML = '<div class="ct-vide">Chargement…</div>';
    try{
      if(v === 'accueil') await vueModule('accueil', 'WaveAccueil');
      else if(v === 'packs') await vuePacks();
      else if(v === 'collection') await vueCollection();
      else if(v === 'combat') await vueModule('combat', 'WaveCombat');
      else if(v === 'marche') await vueModule('marche', 'WaveMarche');
      else if(v === 'missions') await vueMissions();
      else if(v === 'bonus') await vueBonus();
      else if(v === 'succes') await vueSucces();
    }catch(e){
      S.corps.innerHTML = `<div class="ct-panneau ct-vide">${esc(e.message)}</div>`;
    }
  }

  const gainsHtml = (g) => [
    vin(g) ? `<span class="ct-gain v">${ico('vinyle', 13)}+${nf(vin(g))}</span>` : '',
    g.garantis ? `<span class="ct-gain g">${ico('pack', 13)}Épique</span>` : ''
  ].join('');
  const gainsTexte = (g) => [vin(g) ? '+' + nf(vin(g)) + ' vinyles' : '', g.garantis ? 'un pack Épique garanti' : ''].filter(Boolean).join(', ');

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

    // Un booster à vinyle : un disque carré qui tourne, à la place du paquet (le geste d'ouverture l'incline et l'agrandit).
    if(visuelOk(b.visuel)){
      return `
      <div class="ct-pack ct-vinyle" style="--teinte:${couleurOk(b.accent)}"${o.attrs || ''}>
        ${o.pile ? Array.from({ length: o.pile }, (_, k) => `<div class="ct-pk-pile" style="transform:translate(${(k + 1) * 8}px, ${(k + 1) * -6}px); z-index:-${k + 1}"></div>`).join('') : ''}
        <img class="ct-vi-img" src="${esc(b.visuel)}" alt="${esc(b.nom)}" draggable="false" decoding="async">
        <div class="ct-pk-haut"></div>
        <div class="ct-pk-ligne"></div>
        <div class="ct-pk-lumiere"></div>
        ${o.nombre > 1 ? `<div class="ct-pk-nombre">×${o.nombre}</div>` : ''}
      </div>`;
    }

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

    // Un booster à classeur s'ouvre sur sa page de projet : la liste de ses cartes, comme une tracklist.
    const projet = S.projet && boosters.find(x => x.id === S.projet && x.classeur);
    if(projet){ await vueProjet(projet); return; }
    S.projet = null;

    const attente = aRecuperer(e) + (e.missions_pretes || 0);
    const plusieurs = boosters.length > 1;

    S.corps.innerHTML = `
      <section class="ct-vitrine">
        <div class="ct-car" tabindex="0" role="group" aria-roledescription="carrousel" aria-label="Choisis un booster">
          <div class="ct-car-piste">
            ${boosters.map((b, i) => `<div class="ct-car-item" data-i="${i}" role="group" aria-label="${esc(b.nom)}">${packHtml({ booster: b })}</div>`).join('')}
          </div>
          ${plusieurs ? `<button type="button" class="ct-car-fl g" data-dir="-1" aria-label="Booster précédent">${ico('fleche', 20)}</button><button type="button" class="ct-car-fl d" data-dir="1" aria-label="Booster suivant">${ico('fleche', 20)}</button>` : ''}
        </div>
        ${plusieurs ? `<div class="ct-points">${boosters.map((b, i) => `<button type="button" data-i="${i}" aria-label="${esc(b.nom)}"></button>`).join('')}</div>` : ''}
        <div class="ct-vit-info" data-info></div>
        <div class="ct-ouvrir" data-zone-ouvrir></div>
        <div class="ct-hero-note">${ico('vinyle', 15)}1 vinyle = 1 pack.<button type="button" class="ct-lien" data-echange>Échanger des Wave Coins</button></div>
      </section>

      ${attente ? `<button type="button" class="ct-attente" data-aller="${aRecuperer(e) ? 'bonus' : 'missions'}">${ico('cadeau', 22)}<div><b>${pluriel(attente, 'récompense')} à récupérer</b><span>${[e.cadeau_pret ? 'cadeau du jour' : '', e.roue_prete ? 'roue' : '', e.coffres_prets ? 'coffre' : '', e.missions_pretes ? 'missions' : ''].filter(Boolean).join(' · ')}</span></div>${ico('fleche', 18)}</button>` : ''}
`;

    const vit = S.corps.querySelector('.ct-vitrine');
    const car = vit.querySelector('.ct-car');
    const items = [...vit.querySelectorAll('.ct-car-item')];
    const points = [...vit.querySelectorAll('.ct-points button')];
    const zoneInfo = vit.querySelector('[data-info]');
    const zoneOuvrir = vit.querySelector('[data-zone-ouvrir]');

    // Les cartes de la fiche d'un booster : ses chances, ses événements, ses boutons d'ouverture.
    function majInfo(){
      const b = boosters[cur];
      zoneInfo.innerHTML = `
        <div class="ct-vit-info-in">
          <h2>${esc(b.nom)}</h2>
          <p>${esc(b.description || '')}</p>
          ${b.classeur ? `<button type="button" class="ct-lien ct-voir" data-voir>Voir les ${nf(b.nb_cartes)} cartes${ico('fleche', 14)}</button>` : ''}
        </div>`;
      const cout = Number(b.cout || 1);
      zoneOuvrir.innerHTML = [1, 5, 10].map(n => `<button type="button" class="ct-btn ${n === 1 ? 'principal ' : ''}grand" data-ouvrir="${n}" ${e.vinyles < n * cout ? 'disabled' : ''}>${n > 1 ? n + ' packs' : 'Ouvrir un pack'}<span class="cout">${ico('vinyle', 12)}${n * cout}</span></button>`).join('');
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

    function voir(b){
      if(!b.classeur){ ouvrir(1, false, b); return; }
      S.projet = b.id;
      afficherVue('packs');
    }

    vit.addEventListener('click', (ev) => {
      const o = ev.target.closest('[data-ouvrir]');
      if(o){ ouvrir(Number(o.dataset.ouvrir), false, boosters[cur]); return; }
      if(ev.target.closest('[data-voir]')){ voir(boosters[cur]); return; }
      const f = ev.target.closest('.ct-car-fl');
      if(f){ aller(cur + Number(f.dataset.dir)); return; }
      const k = ev.target.closest('[data-classeur]');
      if(k){ S.col.classeur = k.dataset.classeur; S.col.page = 1; S.col.vue = 'toutes'; S.col.rarete = null; S.col.q = ''; changerVue('collection'); return; }
      const p = ev.target.closest('.ct-points button');
      if(p) aller(Number(p.dataset.i));
    });

    // Glisser le carrousel d'un geste ; toucher un booster de côté le ramène au centre, toucher celui du centre ouvre sa liste de cartes.
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
      if(i === cur) voir(boosters[cur]); else aller(i);
    });
    car.addEventListener('pointercancel', () => { depart = null; });
    car.addEventListener('keydown', (ev) => {
      if(ev.key === 'ArrowLeft'){ ev.preventDefault(); aller(cur - 1); }
      else if(ev.key === 'ArrowRight'){ ev.preventDefault(); aller(cur + 1); }
      else if(ev.key === 'Enter' || ev.key === ' '){ ev.preventDefault(); voir(boosters[cur]); }
    });

    S.corps.querySelectorAll('[data-aller]').forEach((b) => b.addEventListener('click', () => changerVue(b.dataset.aller)));
  }

  // La page d'un booster, comme celle d'un projet musical : la pochette, puis ses cartes en tracklist.
  async function vueProjet(b){
    const r = await appel('jeu_classeur_lire', { p_booster: b.id, p_page: 1, p_tri: 'numero' });
    const cartes = r.cartes || [];
    const obtenues = cartes.filter(c => c.quantite > 0).length;
    const e = S.etat;
    const cout = Number(b.cout || 1);
    const fin = b.fin ? new Date(b.fin + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
    const pochette = visuelOk(b.visuel)
      ? `<img class="ct-pj-cover" src="${esc(b.visuel)}" alt="${esc(b.nom)}" decoding="async">`
      : `<div class="ct-pj-cover ct-pj-vide">${EMBLEMES[theme(b.theme)]}</div>`;

    S.corps.innerHTML = `
      <section class="ct-projet" style="--acc:${couleurOk(b.accent)}">
        <button type="button" class="ct-lien ct-retour" data-retour>${ico('fleche', 14)}Les packs</button>
        <header class="ct-pj-tete">
          ${pochette}
          <div class="ct-pj-meta">
            <span class="ct-pj-type">${fin ? 'Collection · jusqu\'au ' + esc(fin) : 'Collection permanente'}</span>
            <h2>${esc(b.nom)}</h2>
            <p class="ct-pj-stat">La Wave · ${pluriel(cartes.length, 'carte')} · ${nf(obtenues)} obtenue${obtenues > 1 ? 's' : ''}</p>
            <div class="ct-ouvrir">${[1, 5, 10].map(n => `<button type="button" class="ct-btn ${n === 1 ? 'principal ' : ''}grand" data-ouvrir="${n}" ${e.vinyles < n * cout ? 'disabled' : ''}>${n > 1 ? n + ' packs' : 'Ouvrir un pack'}<span class="cout">${ico('vinyle', 12)}${n * cout}</span></button>`).join('')}</div>
          </div>
        </header>
        ${b.description ? `<p class="ct-pj-desc">${esc(b.description)}</p>` : ''}
        <div class="ct-tracks" role="list" aria-label="Cartes du booster">
          <div class="ct-tr-tete" aria-hidden="true"><span>#</span><span></span><span>Artiste</span><span>Rareté</span><span></span></div>
          ${cartes.map((c, i) => `
            <button type="button" class="ct-track${c.quantite ? '' : ' manque'}" role="listitem" data-i="${i}" style="--rc:${rar(c.rarete).c}" aria-label="${esc(c.nom)}, ${esc(rar(c.rarete).nom)}${c.quantite ? '' : ', pas encore obtenue'}">
              <span class="n">${String(c.numero || i + 1).padStart(2, '0')}</span>
              <img class="ph" src="${esc(safeUrl(c.photo))}" alt="" loading="lazy" decoding="async">
              <span class="nom">${esc(c.nom)}</span>
              <span class="rar">${esc(rar(c.rarete).nom)}</span>
              <span class="et">${c.quantite ? (c.holo ? ico('etoile', 14) : '') + (c.quantite > 1 ? '×' + c.quantite : ico('coche', 15)) : ico('cadenas', 14)}</span>
            </button>`).join('')}
        </div>
      </section>`;

    S.corps.querySelector('[data-retour]').addEventListener('click', () => { S.projet = null; afficherVue('packs'); });
    S.corps.querySelectorAll('[data-ouvrir]').forEach((x) => x.addEventListener('click', () => ouvrir(Number(x.dataset.ouvrir), false, b)));
    S.corps.querySelectorAll('.ct-track').forEach((x) => x.addEventListener('click', () => fiche(cartes[Number(x.dataset.i)].id, b.id)));
  }

  // Échanger des Wave Coins contre des vinyles : on choisit un nombre de vinyles (donc de packs), le prix est en Wave Coins.
  function fenetreEchange(){
    const wc = Number(S.etat.wc || 0), taux = Number(S.etat.taux_wc || 50);
    const max = Math.min(1000, Math.floor(wc / taux));
    const choix = [1, 5, 10, 25].filter(n => n < max);
    const f = fenetre(`
      <h2>Échanger des Wave Coins</h2>
      <p class="sous">1 vinyle = 1 ouverture de pack, et coûte ${nf(taux)} Wave Coins. Tu as <b>${nf(wc)} Wave Coins</b> et <b>${nf(S.etat.vinyles)} vinyles</b>.</p>
      ${max >= 1
        ? `<div class="ct-echange">
            <div class="ct-echange-choix">${choix.map(n => `<button type="button" class="ct-btn" data-n="${n}">${n} vinyle${n > 1 ? 's' : ''}</button>`).join('')}<button type="button" class="ct-btn" data-n="${max}">Max (${nf(max)})</button></div>
            <label class="ct-echange-champ"><input type="number" inputmode="numeric" min="1" max="${max}" step="1" value="${Math.min(max, 5)}" data-v aria-label="Vinyles à acheter"> vinyles<span class="ct-echange-prix" data-prix></span></label>
          </div>`
        : `<div class="ct-panneau ct-vide" style="margin-top:14px"><b>Pas encore assez de Wave Coins</b>Il en faut ${nf(taux)} pour un vinyle. Ils se gagnent avec l'XP du site : 1 XP = 1 Wave Coin.</div>`}
      <div class="ct-actions" style="justify-content:flex-end; margin-top:18px"><button type="button" class="ct-btn" data-non>Fermer</button>${max >= 1 ? '<button type="button" class="ct-btn principal" data-oui>Échanger</button>' : ''}</div>`);
    f.corps.querySelector('[data-non]').addEventListener('click', f.fermer);
    const champ = f.corps.querySelector('[data-v]');
    const prix = f.corps.querySelector('[data-prix]');
    const maj = () => { if(prix) prix.textContent = '= ' + nf(Math.max(0, Math.floor(Number(champ.value) || 0)) * taux) + ' Wave Coins'; };
    if(champ){ champ.addEventListener('input', maj); maj(); }
    f.corps.querySelectorAll('[data-n]').forEach((b) => b.addEventListener('click', () => { champ.value = b.dataset.n; maj(); }));
    const ok = f.corps.querySelector('[data-oui]');
    if(ok) ok.addEventListener('click', async () => {
      const n = Math.floor(Number(champ.value));
      if(!(n >= 1 && n <= max)){ toast('Choisis entre 1 et ' + nf(max) + ' vinyles.', 'err'); return; }
      ok.disabled = true;
      try{
        poserEtat(await appel('jeu_vinyles_acheter', { p_vinyles: n }));
        majEntete(); Son.jouer('gain'); vibre(25);
        toast('+' + nf(n) + ' vinyle' + (n > 1 ? 's' : ''));
        f.fermer();
        if(S.vue === 'packs' || S.vue === 'collection') afficherVue(S.vue);
      }catch(e){ toast(e.message, 'err'); ok.disabled = false; }
    });
  }

  async function ouvrir(n, garanti, booster){

    if(S.occupe) return;
    const b = booster || (S.boosters || REPLI).find(x => x.id === S.booster) || REPLI[0];
    const cout = garanti ? 0 : Number(b.cout || 1);
    if(!garanti && S.etat && S.etat.vinyles < n * cout){ toast('Il te manque ' + nf(n * cout - S.etat.vinyles) + ' vinyles : échange des Wave Coins.', 'err'); return; }
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
          <div style="margin-top:20px"><button type="button" class="ct-btn principal" data-ok>Continuer</button></div>
        </div>`, false, fin);
      f.corps.querySelector('[data-ok]').addEventListener('click', f.fermer);
    });
  }

  // ---------------------------------------------------------------------
  // La scène d'ouverture
  //   1. la pochette se pose, puis la caméra plonge dedans : un zoom qui remplit l'écran ;
  //   2. les cartes surgissent en pile, face cachée (la lueur du dos annonce la rareté) ;
  //   3. on touche : la carte du dessus se soulève, se retourne, puis part ; la suivante prend sa place ;
  //   4. le bilan : toutes les cartes à plat, rouvrir ou terminer.
  // Renvoie vrai si le joueur veut rouvrir le même nombre de packs.
  // ---------------------------------------------------------------------

  function scene(cartes, garanti, booster){

    // De la moins rare à la plus rare (à rareté égale, les holos après) : on finit toujours en beauté.
    cartes = cartes.map((c, i) => [c, i]).sort((a, b) =>
      ((Number(a[0].rarete) || 1) - (Number(b[0].rarete) || 1)) || ((a[0].holo ? 1 : 0) - (b[0].holo ? 1 : 0)) || (a[1] - b[1])).map((x) => x[0]);

    return new Promise((fin) => {

      booster = garanti ? BOOSTER_GARANTI : (booster || REPLI[0]);
      const cout = garanti ? 0 : Number(booster.cout || 1);

      const n = cartes.length;
      const meilleure = cartes.reduce((m, c) => Math.max(m, Number(c.rarete) || 1), 1);
      const teinteMeilleure = meilleure >= 3 ? RAR[meilleure].c : '#4FB4FF';
      const teinteBooster = couleurOk(booster.accent);

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
      let fini = false, phase = 'entree', occupe = false, courante = 0, pile = null, places = [];

      const teinte = (c) => ov.style.setProperty('--teinte', c);

      // Le clip YouTube d'une carte Mythique, muet, en fond derrière la carte (réglé par l'équipe, console → Cartes).
      let clipCourant = null;
      function poserClip(perso){
        const id = String(perso.clip || '');
        if(calme() || !/^[A-Za-z0-9_-]{11}$/.test(id)) return null;
        retirerClip(true);
        const f = el('div', 'ct-clip');
        const dep = Math.max(0, Math.min(3599, Number(perso.clip_debut) || 0));
        // cc_load_policy=0 : pas de sous-titres ; enablejsapi : on peut aussi les décharger, et allumer le son, par message.
        f.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${id}?autoplay=1&mute=1&controls=0&loop=1&playlist=${id}&start=${dep}&modestbranding=1&playsinline=1&rel=0&disablekb=1&fs=0&iv_load_policy=3&cc_load_policy=0&hl=fr&enablejsapi=1&origin=${encodeURIComponent(location.origin)}" title="" allow="autoplay; encrypted-media" referrerpolicy="strict-origin-when-cross-origin" tabindex="-1" aria-hidden="true"></iframe>`;
        const ifr = f.firstChild;
        const cmd = (func, args) => { try{ ifr.contentWindow.postMessage(JSON.stringify({ event: 'command', func, args: args || [] }), '*'); }catch(e){} };
        const sansSousTitres = () => { cmd('unloadModule', ['captions']); cmd('unloadModule', ['cc']); };
        ifr.addEventListener('load', () => {
          try{ ifr.contentWindow.postMessage(JSON.stringify({ event: 'listening', id: 1 }), '*'); }catch(e){}
          sansSousTitres();
          setTimeout(sansSousTitres, 1200);
          setTimeout(sansSousTitres, 3000);
        });
        // Le son du clip (le morceau en entier) : on l'allume à l'instant voulu, au volume voulu.
        f.parler = (v) => { cmd('unMute'); cmd('setVolume', [Math.round(Math.max(0, Math.min(1, v)) * 100)]); cmd('playVideo'); };
        ov.insertBefore(f, ov.querySelector('.ct-rayons'));
        return (clipCourant = f);
      }
      function retirerClip(vite){
        const f = clipCourant;
        if(!f) return;
        clipCourant = null;
        f.classList.remove('on');
        if(vite) f.remove(); else setTimeout(() => f.remove(), 900);
      }
      const eclair = () => { flash.classList.remove('on'); void flash.offsetWidth; flash.classList.add('on'); };
      teinte(teinteBooster);

      function fermer(rouvrir){
        if(fini) return;
        fini = true;
        retirerClip(true);
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
        suite();
      }
      document.addEventListener('keydown', touche);
      ov.querySelector('.ct-scene-x').addEventListener('click', () => fermer(false));

      const centreDe = (elm) => { const b = elm.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; };

      // ---- 1. le vinyle : il attend qu'on le touche ; le disque en sort, tourne de plus en plus vite, puis éclate en cartes
      const zonePack = el('div', 'ct-scene-pack attend', packHtml({ booster, nombre: n }));
      zonePack.insertAdjacentHTML('afterbegin', '<div class="ct-disque"><div class="ct-disque-rot"><span class="ct-disque-etq"><img src="img/logo-wave.png" alt="" width="380" height="204"></span></div></div>');
      centre.appendChild(zonePack);
      const pack = zonePack.querySelector('.ct-pack');
      const disque = zonePack.querySelector('.ct-disque');
      pack.style.setProperty('--teinte', teinteBooster);
      zonePack.style.setProperty('--etq', teinteBooster);
      phase = 'attente';
      pied.innerHTML = '<p>Touche le vinyle pour l\'ouvrir</p>';
      zonePack.addEventListener('click', () => { if(phase === 'attente') ouvrirVinyle(); });

      // Des ondes de choc pour les belles cartes.
      const ondes = (couleurs) => {
        if(calme()) return;
        couleurs.forEach((c, k) => {
          const o = el('div', 'ct-onde');
          o.style.setProperty('--oc', c);
          o.style.animationDelay = (k * 150) + 'ms';
          ov.appendChild(o);
          setTimeout(() => o.remove(), 1500 + k * 150);
        });
      };

      async function ouvrirVinyle(){
        if(phase !== 'attente' || fini) return;
        phase = 'ouvre';
        zonePack.classList.remove('attend');
        pied.innerHTML = '';
        Son.jouer('donne');
        // 1. le disque glisse hors de la pochette
        disque.classList.add('sort');
        await attendre(calme() ? 30 : 650);
        if(fini) return;
        // 2. la pochette tombe, le disque vient au centre, brille de la couleur de la meilleure carte et s'emballe
        zonePack.classList.add('vide');
        disque.classList.add('centre');
        zonePack.style.setProperty('--lueur', teinteMeilleure);
        if(!calme()){
          teinte(teinteMeilleure);
          rayons.classList.add('on');
          Son.jouer('froisse');
          vibre(meilleure >= 4 ? [15, 40, 15, 40, 15] : 15);
          const c = centreDe(disque);
          fx.aspire(c.x, c.y, teinteMeilleure, meilleure >= 4 ? 44 : 22);
          await attendre(meilleure >= 5 ? 1500 : (meilleure >= 3 ? 1100 : 800));
        }
        if(fini) return;
        // 3. il éclate
        phase = 'jaillit';
        Son.jouer('dechire');
        vibre(meilleure >= 4 ? [20, 30, 60] : 25);
        disque.classList.add('boom');
        const c = centreDe(disque);
        eclair();
        ondes(meilleure >= 4 ? [teinteMeilleure, '#ffffff'] : [teinteMeilleure]);
        fx.gerbe(c.x, c.y, ['#ffffff', teinteMeilleure], meilleure >= 4 ? 60 : 28, { vitesse: meilleure >= 4 ? 10 : 7, vie: 50 });
        rayons.classList.remove('on');
        await attendre(calme() ? 40 : 260);
        if(fini) return;
        zonePack.remove();
        distribuer();
      }

      // ---- 2. les cartes surgissent en pile
      const indice = (texte) => `<p>${texte}</p>${n > 1 ? '<div class="boutons"><button type="button" class="ct-btn" data-passer>Tout voir</button></div>' : ''}`;

      function distribuer(){
        phase = 'pile';
        const lc = Math.max(150, Math.floor(Math.min(300, window.innerWidth * .66, (window.innerHeight - 250) / 1.25)));
        pile = el('div', 'ct-pile entre');
        pile.style.setProperty('--lc', lc + 'px');
        const mil = (n - 1) / 2, ecart = Math.min(54, (window.innerWidth * .84 - lc) / Math.max(n - 1, 1));
        pile.innerHTML = cartes.map((c, i) => `
          <div class="ct-place" data-i="${i}" style="--rc:${rar(c.rarete).c}; --k:${Math.min(i, 4)}; --ji:${i}; --fx:${((i - mil) * ecart).toFixed(0)}px; --fy:${(Math.pow(Math.abs(i - mil), 2) * 2.2 - 30).toFixed(0)}px; --fr:${((i - mil) * 6).toFixed(1)}deg; z-index:${n - i}">
            <div class="ct-volte">
              <div class="ct-dos" data-r="${c.rarete}"><div class="ct-dos-in"><img class="ct-dos-logo" src="img/logo-wave.png" alt="La Wave" width="380" height="204" decoding="async"></div></div>
              <div class="ct-face">${carteHtml(c, { vivante: true, eager: true })}<span class="ct-sheen"></span></div>
            </div>
          </div>`).join('');
        centre.appendChild(pile);
        places = [...pile.querySelectorAll('.ct-place')];
        pile.addEventListener('click', suite);
        Son.jouer('donne');
        pied.innerHTML = indice(n === 1 ? 'Touche la carte pour la révéler' : 'Touche la carte du dessus pour la révéler');
      }

      pied.addEventListener('click', (ev) => { if(ev.target.closest('[data-passer]')) passer(); });

      // Un toucher donné pendant l'animation d'une commune ou d'une rare n'est pas perdu : il est repris dès que la scène est prête.
      let tapEnAttente = false;
      function suite(){
        if(fini) return;
        if(phase === 'attente') ouvrirVinyle();
        else if(phase === 'pile') reveler();
        else if(phase === 'revelee') avancer();
        else if((phase === 'revele' || phase === 'sort') && courante < n && (Number(cartes[courante].rarete) || 1) <= 2) tapEnAttente = true;
      }
      function reprendreTap(){
        if(!tapEnAttente || fini) return;
        tapEnAttente = false;
        suite();
      }

      // ---- 3. révéler la carte du dessus
      async function reveler(){
        if(phase !== 'pile' || occupe) return;
        phase = 'revele';
        occupe = true;
        const i = courante, c = cartes[i], r = Number(c.rarete) || 1, p = places[i];
        const pos = centreDe(p);
        pied.innerHTML = '';

        // Mythique : le clip YouTube de la carte (console → Cartes) joue derrière elle, avec son son ; sans clip, la fanfare.
        let clip = null;
        if(r >= 5){
          const propre = c.classeur ? appel('jeu_son_carte', { p_booster: c.classeur, p_artiste: c.id }).catch(() => null) : Promise.resolve(null);
          const perso = await Promise.race([propre, attendre(450).then(() => null)]);
          if(perso && perso.clip) clip = poserClip(perso);
          if(fini){ occupe = false; return; }
          // Le retournement a lieu à 2,05 s (1,9 s de montée + 0,15 s de soulèvement) : le son part à cet instant.
          setTimeout(() => {
            if(fini || courante !== i) return;
            if(clip && clip.parler) clip.parler(.85);
            else Son.jouer('r' + r);
          }, calme() ? 10 : 2050);
        }

        if(r >= 5){
          // Mythique et Spécial : la salle s'assombrit et un halo se lève derrière la carte .
          ov.classList.add('sombre');
          p.insertAdjacentHTML('afterbegin', `<div class="ct-halo${r === 6 ? ' special' : ''}"></div>`);
        }

        if(r >= 3 && !calme()){
          // L'attente : la carte vibre, la lumière se rassemble.
          p.classList.add('charge');
          if(r < 5) Son.jouer('charge');
          else Son.jouer('montee');
          vibre(r >= 5 ? [15, 40, 15, 40, 15, 40, 30, 60, 60] : (r >= 4 ? [15, 40, 15, 40, 15] : 20));
          fx.aspire(pos.x, pos.y, RAR[r].c, r >= 5 ? 60 : (r >= 4 ? 42 : 24));
          if(r >= 5){
            // Deux vagues de plus, de plus en plus serrées, pendant que la carte bat plus vite.
            setTimeout(() => { if(!fini) fx.aspire(pos.x, pos.y, '#ffffff', 50); }, 700);
            setTimeout(() => { if(!fini) fx.aspire(pos.x, pos.y, RAR[r].c, 70); }, 1300);
          }
          await attendre(r >= 5 ? 1900 : (r >= 4 ? 850 : 520));
          p.classList.remove('charge');
        }
        if(fini){ occupe = false; return; }

        // Les communes et les rares passent vite : retournement en 0,3 s, pas de soulèvement, pas d'attente.
        const rapide = r <= 2 && !calme();
        if(rapide) p.classList.add('rapide');
        p.classList.add('leve');
        await attendre(calme() ? 10 : (rapide ? 0 : 150));
        if(fini){ occupe = false; return; }
        p.classList.add('retournee');
        if(clip) clip.classList.add('on');
        Son.jouer('volte');
        setTimeout(() => {
          if(fini) return;
          if(r < 5) Son.jouer('r' + r);
          if(c.holo) Son.jouer('holo');
        }, 180);

        setTimeout(() => {
          if(fini) return;
          // L'étiquette : la rareté pour les grandes cartes, sinon nouvelle carte ou doublon.
          let classe = 'double', texte = 'Doublon ×' + c.quantite;
          if(c.nouvelle){ classe = 'nouveau'; texte = 'Nouveau'; }
          else if(c.nouveau_holo){ classe = 'nouveau'; texte = 'Nouveau holo'; }
          if(r >= 3){ classe = ''; texte = RAR[r].nom + (c.nouvelle ? ' · Nouveau' : ''); }
          p.insertAdjacentHTML('beforeend', `<div class="ct-etiq ${classe}">${esc(texte)}</div>`);

          if(r >= 2) fx.gerbe(pos.x, pos.y, [RAR[r].c, '#ffffff'], r >= 5 ? 110 : (r >= 4 ? 80 : (r >= 3 ? 48 : 18)), { vitesse: r >= 4 ? 11 : 7, vie: r >= 4 ? 70 : 45 });
          if(c.holo) fx.gerbe(pos.x, pos.y, ['#ff9ad5', '#9af7ff', '#fff59a', '#c4a3ff'], 50, { vitesse: 8, vie: 60 });
          if(r >= 4){
            teinte(RAR[r].c);
            rayons.classList.add('on');
            eclair();
            ov.classList.remove('secousse'); void ov.offsetWidth; ov.classList.add('secousse');
            fx.pluie(r === 6 ? ['#ffffff', '#8fefff', '#bfeaff', '#b9a8ff', '#e6f9ff'] : (r >= 5 ? ['#ff5c8a', '#ffb547', '#fff27a', '#5cffc8', '#5cb8ff', '#b36bff'] : ['#F2C14E', '#fff3c4', '#ffffff', '#e9a73a']), r >= 5 ? 160 : 90);
            const mythe = r >= 5 && !calme();
            const titre = el('div', 'ct-titre-rar' + (mythe ? ' mythe' : '') + (r === 6 ? ' special' : ''),
              mythe ? [...RAR[r].nom].map((ch, k) => `<span style="--i:${k}">${esc(ch)}</span>`).join('') : esc(RAR[r].nom));
            ov.appendChild(titre);
            setTimeout(() => titre.remove(), mythe ? 2900 : 1700);
            if(mythe){
              // Onde de choc double, braises qui montent, la caméra s'approche doucement.
              ondes(r === 6 ? [RAR[6].c, '#ffffff', '#b9a8ff'] : [RAR[5].c, '#ffffff', '#ffb547']);
              fx.braises(r === 6 ? ['#ffffff', '#8fefff', '#b9a8ff'] : ['#ff5c8a', '#ffb547', '#fff27a', '#b36bff'], 6000);
              if(pile) pile.classList.add('mythe');
            }
          }else if(r === 3){
            teinte(RAR[3].c);
          }
        }, rapide ? 140 : 330);

        await attendre(calme() ? 120 : (rapide ? 110 : (r >= 4 ? 1000 : (r >= 3 ? 620 : 420))));
        occupe = false;
        if(fini) return;
        phase = 'revelee';
        pied.innerHTML = indice(courante < n - 1 ? 'Touche pour passer à la carte suivante' : 'Touche pour voir tes cartes');
        reprendreTap();
      }

      // ---- la carte part, la suivante prend sa place
      function avancer(){
        if(phase !== 'revelee') return;
        phase = 'sort';
        const p = places[courante];
        const et = p.querySelector('.ct-etiq'); if(et) et.remove();
        retirerClip();
        ov.classList.remove('sombre');
        if(pile) pile.classList.remove('mythe');
        fx.calmer();
        rayons.classList.remove('on');
        teinte(teinteBooster);
        const rapideSortie = (Number(cartes[courante].rarete) || 1) <= 2 && !calme();
        if(rapideSortie) p.classList.add('rapide');
        p.classList.add('sort');
        Son.jouer('donne');
        courante++;
        pied.innerHTML = '';
        if(courante >= n){
          setTimeout(() => { if(!fini) bilan(); }, calme() ? 20 : 420);
          return;
        }
        for(let j = courante; j < n; j++) places[j].style.setProperty('--k', Math.min(j - courante, 4));
        setTimeout(() => {
          if(fini) return;
          phase = 'pile';
          pied.innerHTML = indice('Touche la carte pour la révéler');
          reprendreTap();
        }, calme() ? 20 : (rapideSortie ? 130 : 320));
      }

      function passer(){
        if(fini || occupe || (phase !== 'pile' && phase !== 'revelee')) return;
        bilan();
      }

      // ---- 4. le bilan
      function bilan(){
        phase = 'bilan';
        retirerClip();
        ov.classList.remove('sombre');
        fx.calmer();
        rayons.classList.remove('on');
        teinte(teinteBooster);
        if(pile){ pile.remove(); pile = null; }

        const donne = el('div', 'ct-donne' + (n === 1 ? ' seule' : ''));
        const etroit = window.innerWidth < 640;
        const cols = n === 1 ? 1 : (etroit ? (n === 5 ? 3 : 4) : 5);
        donne.style.setProperty('--cols', cols);
        if(n > 1){
          // Assez petites pour tenir à l'écran sans défiler.
          const lignes = Math.ceil(n / cols);
          const hDispo = window.innerHeight - 64 - 130 - (lignes - 1) * 40 - 30;
          const lc = Math.max(70, Math.min(180, (hDispo / lignes) * 4 / 5, (Math.min(window.innerWidth, 1000) - 32 - (cols - 1) * 14) / cols));
          donne.style.setProperty('--lc', Math.floor(lc) + 'px');
        }
        donne.innerHTML = cartes.map((c, i) => {
          let classe = 'double', texte = 'Doublon ×' + c.quantite;
          if(c.nouvelle){ classe = 'nouveau'; texte = 'Nouveau'; }
          else if(c.nouveau_holo){ classe = 'nouveau'; texte = 'Nouveau holo'; }
          if(n === 1 && Number(c.rarete) >= 3){ classe = ''; texte = RAR[Number(c.rarete)].nom + (c.nouvelle ? ' · Nouveau' : ''); }
          return `
          <div class="ct-place retournee donne" data-i="${i}" style="--rc:${rar(c.rarete).c}; --rot:${(i % 2 ? 1 : -1) * 4}deg; animation-delay:${i * 60}ms">
            <div class="ct-volte" role="button" tabindex="0" aria-label="Voir la fiche de ${esc(c.nom)}">
              <div class="ct-dos" data-r="1"><div class="ct-dos-in"><img class="ct-dos-logo" src="img/logo-wave.png" alt="La Wave" width="380" height="204" decoding="async"></div></div>
              <div class="ct-face">${carteHtml(c, { vivante: true, eager: true })}</div>
            </div>
            <div class="ct-etiq ${classe}">${esc(texte)}</div>
          </div>`;
        }).join('');
        centre.appendChild(donne);
        donne.querySelectorAll('.ct-place').forEach((p) => {
          const i = Number(p.dataset.i);
          const v = p.querySelector('.ct-volte');
          v.addEventListener('click', () => fiche(cartes[i].id, cartes[i].classeur || null));
          v.addEventListener('keydown', (ev) => { if(ev.key === 'Enter' || ev.key === ' '){ ev.preventDefault(); ev.stopPropagation(); v.click(); } });
        });
        Son.jouer('gain');

        const nouvelles = cartes.filter(c => c.nouvelle).length;
        const holos = cartes.filter(c => c.holo).length;
        const par = [6, 5, 4, 3].map(r => [r, cartes.filter(c => Number(c.rarete) === r).length]).filter(x => x[1]);
        const peutRouvrir = !garanti && S.etat && S.etat.vinyles >= n * cout;
        pied.innerHTML = `
          <div class="ct-bilan">
            <span>${nouvelles ? pluriel(nouvelles, 'nouvel artiste', 'nouveaux artistes') : 'Aucun nouvel artiste'}</span>
            ${par.map(([r, k]) => `<span style="--rc:${RAR[r].c}"><i></i>${k} ${esc(RAR[r].nom)}</span>`).join('')}
            ${holos ? `<span>${pluriel(holos, 'holo')}</span>` : ''}
          </div>
          <div class="boutons">
            ${peutRouvrir ? `<button type="button" class="ct-btn principal" data-encore>${n > 1 ? 'Rouvrir ' + n + ' packs' : 'Rouvrir un pack'}<span class="cout">${ico('vinyle', 12)}${n * cout}</span></button>` : ''}
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
          ${classeur ? '<div data-combat></div>' : ''}
          ${c.ville ? `<p class="sous" style="margin-top:12px">${esc(c.ville)}</p>` : ''}${classeur && possede ? `<div class="ct-actions" style="margin-top:12px"><button type="button" class="ct-btn petit" data-vendre>${ico('marche', 15)}Vendre sur le marché</button></div>` : ''}
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

    inclinable(f.corps.querySelector('.ct-fiche-carte')); const vd = f.corps.querySelector('[data-vendre]'); if(vd) vd.addEventListener('click', async () => { try{ await window.chargerWaveModule('marche'); await window.WaveMarche.vendre(c, api); }catch(e){ toast(e.message, 'err'); } });

    // La fiche de combat (type, stats, attaques, capacité) vient du module combat.js.
    const zc = f.corps.querySelector('[data-combat]');
    if(zc && typeof window.chargerWaveModule === 'function'){
      window.chargerWaveModule('combat').then(() => window.WaveCombat.fiche(zc, api, { artist: c.id, booster: classeur, holo: c.holos > 0 })).catch(() => {});
    }

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

  // L'entrée de la collection : la pochette de chaque booster, avec ce qu'on y possède ; on touche une pochette pour ouvrir son classeur.
  async function vueCouvertures(classeurs){
    const o = S.col;
    if(!classeurs.length){
      S.corps.innerHTML = '<div class="ct-panneau ct-vide"><b>Aucune collection pour l\'instant</b>Les collections arrivent bientôt.</div>';
      return;
    }
    let bs = S.boosters;
    if(!Array.isArray(bs)){ try{ bs = await appel('jeu_boosters'); S.boosters = bs; }catch(err){ bs = []; } }
    S.corps.innerHTML = `
      <div class="ct-titre-sec" style="margin-top:6px"><h3>Mes collections</h3></div>
      <div class="ct-couvs">${classeurs.map((c) => {
        const b = (bs || []).find(x => x.id === c.id) || {};
        const pct = c.total ? Math.round(c.possedees / c.total * 100) : 0;
        const img = visuelOk(b.visuel)
          ? `<img src="${esc(b.visuel)}" alt="" loading="lazy" decoding="async">`
          : `<span class="vide">${EMBLEMES[theme(c.theme)]}</span>`;
        return `<button type="button" class="ct-couv" data-classeur="${esc(c.id)}" style="--acc:${couleurOk(c.accent)}" aria-label="${esc(c.nom)}, ${nf(c.possedees)} cartes sur ${nf(c.total)}">
          <span class="img">${img}</span>
          <b>${esc(c.nom)}</b>
          <small>${nf(c.possedees)} / ${nf(c.total)} cartes · ${pct} %</small>
          <span class="ct-barre"><i style="width:${Math.max(pct, c.possedees ? 2 : 0)}%"></i></span>
        </button>`;
      }).join('')}</div>`;
    S.corps.querySelectorAll('[data-classeur]').forEach((b) => b.addEventListener('click', () => {
      o.classeur = b.dataset.classeur; o.page = 1; o.vue = 'toutes'; o.rarete = null; o.q = '';
      vueCollection();
    }));
  }

  async function vueCollection(){

    const o = S.col;

    // Les classeurs des collections (un par booster à classeur) : il n'y a plus d'autre collection.
    let classeurs = [];
    try{ classeurs = await appel('jeu_classeurs'); }catch(err){ classeurs = []; }
    if(!Array.isArray(classeurs)) classeurs = [];
    if(o.classeur && !classeurs.some(c => c.id === o.classeur)) o.classeur = null;
    const cl = classeurs.find(c => c.id === o.classeur);
    if(!cl){ await vueCouvertures(classeurs); return; }

    const r = await appel('jeu_classeur_lire', { p_booster: cl.id, p_page: o.page, p_vue: o.vue, p_rarete: o.rarete, p_q: o.q || null, p_tri: o.tri });
    const raretes = r.raretes || [];
    const possedees = raretes.reduce((s, x) => s + Number(x.possedees || 0), 0);
    const total = raretes.reduce((s, x) => s + Number(x.total || 0), 0);
    const pct = total ? Math.round(possedees / total * 1000) / 10 : 0;
    const finTxt = cl.fin ? new Date(cl.fin + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '';

    S.corps.innerHTML = `
      <button type="button" class="ct-lien ct-retour" data-couvs>${ico('fleche', 14)}Mes collections</button>
      <section class="ct-panneau ct-prog" style="--acc:${couleurOk(cl.accent)}">
        <div class="ct-prog-chiffre">${nf(possedees)}<small> / ${nf(total)}</small></div>
        <div class="ct-prog-droite">
          <div class="lib"><span>${esc(cl.nom) + (finTxt ? ' · jusqu\'au ' + esc(finTxt) : '')}</span><span>${String(pct).replace('.', ',')} %</span></div>
          <div class="ct-barre"><i style="width:${Math.max(pct, possedees ? .6 : 0)}%"></i></div>
        </div>
        <div class="ct-raretes${raretes.length > 5 ? ' six' : ''}" style="--nr:${raretes.length}">${raretes.map(x => `
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
    S.corps.querySelectorAll('.ct-grille [data-i]').forEach((b) => b.addEventListener('click', () => fiche(r.cartes[Number(b.dataset.i)].id, cl.id)));
    S.corps.querySelector('[data-couvs]').addEventListener('click', () => { o.classeur = null; vueCollection(); });
    if(o.q){ champ.focus(); champ.setSelectionRange(champ.value.length, champ.value.length); }
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
        <span>J${g.jour}</span>${ico(fait ? 'coche' : (g.garantis ? 'pack' : 'vinyle'), 17)}
        <b>+${nf(vin(g))}</b>
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
      const lib = libVin(s.libelle).replace(/JACKPOT\s*·\s*/i, '').replace(/\s*💿/, ' vinyles');
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
            <div class="ct-roue-res" data-res>${roue.dernier ? 'Aujourd\'hui : <b>' + esc(libVin(roue.dernier.libelle)) + '</b>' : 'Des vinyles, un pack Épique… et un gros lot.'}</div>
            <button type="button" class="ct-btn principal grand" data-tourner ${roue.prete ? '' : 'disabled'}>${roue.prete ? 'Tourner la roue' : 'Déjà tournée aujourd\'hui'}</button>
          </div>
        </section>

        <section class="ct-panneau">
          <div class="ct-entete-panneau"><div><h3>Cadeau de connexion</h3><p class="sous">${c.serie > 0 ? 'Série de ' + pluriel(c.serie, 'jour') + '. ' : ''}Le 7ᵉ jour est le plus gros.</p></div></div>
          ${serieHtml(c)}
          <button type="button" class="ct-btn ${c.pret ? 'principal' : ''}" style="width:100%" data-cadeau ${c.pret ? '' : 'disabled'}>${c.pret ? 'Récupérer : ' + esc(gainsTexte(c.cadeaux[c.jour - 1])) : 'Récupéré, reviens demain'}</button>
        </section>

        <section class="ct-panneau">
          <div class="ct-entete-panneau"><div><h3>Coffre</h3><p class="sous">Des vinyles à 9 h, 13 h, 18 h et 22 h, à prendre dans les 8 heures.</p></div></div>
          <div class="ct-creneaux">${coffre.cadeaux.map((x) => `
            <div class="ct-creneau ${x.etat}">
              <span class="h">${String(x.heure).padStart(2, '0')} h</span>
              <small>${x.etat === 'pret' ? 'jusqu\'à ' + heure(x.fin) : (x.etat === 'a_venir' ? 'à venir' : (x.etat === 'prise' ? 'récupéré' : 'expiré'))}</small>
              <button type="button" class="ct-btn ${x.etat === 'pret' ? 'principal' : ''} petit" data-coffre="${esc(x.cle)}" ${x.etat === 'pret' ? '' : 'disabled'} aria-label="Récupérer ${nf(vin(x))} vinyles">${x.etat === 'prise' ? ico('coche', 15) : ico('vinyle', 14) + '+' + nf(vin(x))}</button>
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
      if(res) res.innerHTML = 'Gagné : <b>' + esc(libVin(x.libelle)) + '</b>';
      t.textContent = 'Déjà tournée aujourd\'hui';
      toast('Roue du jour : ' + libVin(x.libelle));
    });

    const cb = S.corps.querySelector('[data-cadeau]');
    if(cb) cb.addEventListener('click', () => prendreCadeau(cb, () => vueBonus()));

    S.corps.querySelectorAll('[data-coffre]').forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true;
      try{
        const x = await appel('jeu_coffre_prendre', { p_cle: b.dataset.coffre });
        poserEtat(x.etat); majEntete(); Son.jouer('gain'); vibre(20);
        toast('+' + nf(vin(x.gain)) + ' vinyles');
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
  // L'espace équipe : la console a son fichier (cartes-equipe.js), chargé à la demande
  // ---------------------------------------------------------------------

  async function equipe(hote){
    if(!hote) return;
    poserStyle();
    try{
      await window.chargerWaveModule('equipe');
      if(!window.WaveEquipe || typeof window.WaveEquipe.monter !== 'function') throw new Error("La console ne s'est pas lancée.");
      await window.WaveEquipe.monter(hote, api);
    }catch(e){
      hote.innerHTML = `<div class="ct"><div class="ct-panneau ct-vide">${esc(e.message)}</div></div>`;
    }
  }

  // L'interface que le jeu prête à ses modules (combat.js, marche.js, cartes-equipe.js).
  const api = {
    appel, toast, fenetre, vibre, Son, ico, esc, nf, court, pluriel, numero, RAR, rar, couleurOk, safeUrl, theme, EMBLEMES,
    visuelOk, carteHtml, inclinable, fiche, poserEtat, majEntete, rafraichirEtat, duree, vin, gainsHtml, gainsTexte, changerVue, prendreCadeau,
    etat: () => S.etat,
    boosters: () => S.boosters || [],
    actualiser: () => (S.vue ? afficherVue(S.vue) : Promise.resolve())
  };

  window.Cartes = { monter, quitter, equipe, api };

})();
