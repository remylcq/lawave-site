/* ======================================================================
   L'ESPACE DES WAVEURS
   ----------------------------------------------------------------------
   Une salle de machines à sous en vue subjective, dans le navigateur.
   Les machines rapportent de l'XP, jamais d'argent.

   Ce fichier est chargé à la demande par index.html, quand quelqu'un
   entre dans la salle : le reste du site n'en paie pas le poids. Il
   embarque tout ce qu'il lui faut — modèles, textures, sons, interface —
   et ne dépend que de Three.js, chargé depuis un CDN.

   Rien n'est téléchargé pour les modèles : les machines, la salle et
   l'aquarium sont construits ici, en code. C'est ce qui permet de les
   habiller aux couleurs de La Wave, et ce qui les garde assez légers pour
   un téléphone.

   Le tirage n'a pas lieu ici. index.html demande le résultat à la base
   (fonction waveurs_tourner) ; les rouleaux ne font que l'illustrer.

   Contrat avec index.html — window.Waveurs.demarrer(options) :

     options.connecte()          vrai si un compte est connecté
     options.utilisateur()       { pseudo, xp } ou null
     options.etat()              Promise<{ tours_restants, tours_par_jour,
                                           gagne_aujourdhui }> ou null
     options.gains()             Promise<[{ nom, motif, symbole, xp }]>
     options.tourner(machineId)  Promise<résultat de waveurs_tourner>
     options.apresTirage(res)    appelé une fois les rouleaux arrêtés
     options.ouvrirConnexion()   ouvre la fenêtre de connexion
     options.surQuitter()        appelé quand on quitte la salle
     options.logo                adresse (ou data:) du logo
   ====================================================================== */
(function(){
'use strict';

if(window.Waveurs) return;

const VERSION = 1;

const SOURCES_THREE = [
  'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js',
  'https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.min.js'
];

// Rempli quand la bibliothèque est chargée.
let THREE = null;


/* ----------------------------------------------------------------------
   Petits outils
   ---------------------------------------------------------------------- */

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const sortieCubique = t => 1 - Math.pow(1 - t, 3);
const entreeSortie = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const hasard = (a, b) => a + Math.random() * (b - a);
const attendre = ms => new Promise(ok => setTimeout(ok, ms));

// Plus court chemin d'un angle à un autre, entre -π et π.
function ecartAngle(de, vers){
  let d = (vers - de) % TAU;
  if(d > Math.PI) d -= TAU;
  if(d < -Math.PI) d += TAU;
  return d;
}

function hexVersRgb(hex){
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbVersHex(r, g, b){
  return '#' + [r, g, b]
    .map(v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0'))
    .join('');
}

function melange(a, b, t){
  const A = hexVersRgb(a), B = hexVersRgb(b);
  return rgbVersHex(lerp(A[0], B[0], t), lerp(A[1], B[1], t), lerp(A[2], B[2], t));
}

const eclaircir = (hex, t) => melange(hex, '#ffffff', t);


/* ----------------------------------------------------------------------
   Ce qu'il y a dans la salle
   ---------------------------------------------------------------------- */

// Demi-largeur, demi-profondeur et hauteur de la salle, en mètres.
const SALLE = { l: 7, p: 12, h: 4.6 };

const JOUEUR = {
  rayon: 0.3,
  yeux: 1.62,
  marche: 3.0,
  course: 5.0,
  souris: 0.0022,
  tactile: 0.0052,
  tourne: 1.9          // rad/s aux flèches gauche et droite
};

// À quelle distance d'une machine on peut la viser.
const PORTEE = 2.9;

const SYMBOLES = ['vague', 'poisson', 'coquillage', 'ancre', 'bulle', 'perle', 'logo'];

const NOMS_SYMBOLES = {
  vague: 'vague', poisson: 'poisson', coquillage: 'coquillage', ancre: 'ancre',
  bulle: 'bulle', perle: 'perle', logo: 'logo La Wave'
};

// Chaque rouleau porte les sept symboles, dans un ordre qui lui est propre :
// trois rouleaux identiques donneraient l'air d'un seul, copié.
const N_TUILES = 7;

const BANDES = [
  ['logo', 'vague', 'poisson', 'coquillage', 'perle', 'ancre', 'bulle'],
  ['bulle', 'ancre', 'perle', 'vague', 'logo', 'poisson', 'coquillage'],
  ['perle', 'poisson', 'bulle', 'logo', 'coquillage', 'vague', 'ancre']
];

// Douze machines, six par côté. L'identifiant est celui que la base
// enregistre avec chaque tour.
const MACHINES = [
  { id: 'vague',   nom: 'LA VAGUE', couleur: '#4FB4FF', sombre: '#0a2b4d' },
  { id: 'corail',  nom: 'CORAIL',   couleur: '#ff6b81', sombre: '#4a1220' },
  { id: 'abysses', nom: 'ABYSSES',  couleur: '#8b6bff', sombre: '#1d1350' },
  { id: 'perle',   nom: 'PERLE',    couleur: '#f2dfb0', sombre: '#40361f' },
  { id: 'maree',   nom: 'MARÉE',    couleur: '#22d3b6', sombre: '#0a3d38' },
  { id: 'ecume',   nom: 'ÉCUME',    couleur: '#a5e3ff', sombre: '#12384d' },
  { id: 'recif',   nom: 'RÉCIF',    couleur: '#ff9f43', sombre: '#4a2a08' },
  { id: 'tempete', nom: 'TEMPÊTE',  couleur: '#5b8cff', sombre: '#0f1f55' },
  { id: 'lagon',   nom: 'LAGON',    couleur: '#2de2e6', sombre: '#093e45' },
  { id: 'meduse',  nom: 'MÉDUSE',   couleur: '#e879f9', sombre: '#3d1249' },
  { id: 'baleine', nom: 'BALEINE',  couleur: '#60a5fa', sombre: '#10254d' },
  { id: 'murene',  nom: 'MURÈNE',   couleur: '#a3e635', sombre: '#26370c' }
];

const RANGEES_Z = [-9, -7.2, -5.4, -3.6, -1.8, 0];


/* ----------------------------------------------------------------------
   Dessin des textures
   ----------------------------------------------------------------------
   Tout est dessiné ici, sur des canvas 2D, puis posé sur des surfaces 3D.
   Ces fonctions ne touchent pas à Three.js : elles renvoient des canvas.
   ---------------------------------------------------------------------- */

// Dimensions d'une tuile de rouleau, en pixels : TL le long de l'axe du
// rouleau, TA le long de sa circonférence.
const TL = 176;
const TA = 160;

function creerCanvas(l, h){
  const c = document.createElement('canvas');
  c.width = l;
  c.height = h;
  return { c, x: c.getContext('2d') };
}

// Le logo occupe le centre d'un carré presque vide : on le recadre au plus
// près, sinon il resterait minuscule partout où on le pose.
function logoRogne(img){

  if(!img || !img.naturalWidth) return null;

  try{

    const { c, x } = creerCanvas(img.naturalWidth, img.naturalHeight);
    x.drawImage(img, 0, 0);

    const d = x.getImageData(0, 0, c.width, c.height).data;

    let x0 = c.width, x1 = 0, y0 = c.height, y1 = 0;

    for(let py = 0; py < c.height; py++){
      for(let px = 0; px < c.width; px++){
        if(d[(py * c.width + px) * 4 + 3] > 24){
          if(px < x0) x0 = px;
          if(px > x1) x1 = px;
          if(py < y0) y0 = py;
          if(py > y1) y1 = py;
        }
      }
    }

    if(x1 <= x0 || y1 <= y0) return c;

    x0 = Math.max(0, x0 - 4);
    y0 = Math.max(0, y0 - 4);
    x1 = Math.min(c.width - 1, x1 + 4);
    y1 = Math.min(c.height - 1, y1 + 4);

    const l = x1 - x0 + 1;
    const h = y1 - y0 + 1;
    const res = creerCanvas(l, h);
    res.x.drawImage(c, x0, y0, l, h, 0, 0, l, h);

    return res.c;

  }catch(e){
    // Image d'une autre origine : le canvas est marqué, on ne peut pas le lire.
    return null;
  }
}

function logoTeinte(logo, couleur){
  const { c, x } = creerCanvas(logo.width, logo.height);
  x.drawImage(logo, 0, 0);
  x.globalCompositeOperation = 'source-in';
  x.fillStyle = couleur;
  x.fillRect(0, 0, c.width, c.height);
  return c;
}

// Pose une image dans un cadre, sans la déformer.
function ajuster(g, img, cx, cy, maxL, maxH){
  const k = Math.min(maxL / img.width, maxH / img.height);
  const l = img.width * k;
  const h = img.height * k;
  g.drawImage(img, cx - l / 2, cy - h / 2, l, h);
}

// Du texte lettre par lettre : letterSpacing n'existe pas partout.
function texteEspace(g, texte, cx, cy, espace){
  const car = Array.from(texte);
  const largeurs = car.map(ch => g.measureText(ch).width);
  const total = largeurs.reduce((a, b) => a + b, 0) + espace * (car.length - 1);
  let x = cx - total / 2;
  g.textAlign = 'left';
  car.forEach((ch, i) => {
    g.fillText(ch, x, cy);
    x += largeurs[i] + espace;
  });
}

function largeurEspacee(g, texte, espace){
  const car = Array.from(texte);
  return car.reduce((somme, ch) => somme + g.measureText(ch).width, 0) + espace * (car.length - 1);
}

const POLICE = '"Public Sans", system-ui, -apple-system, "Segoe UI", sans-serif';


/* ---- Les symboles des rouleaux ----
   Chaque icône se dessine autour de (0, 0), dans une tuile de 176 × 160,
   à l'endroit. La tuile est ensuite tournée d'un quart de tour pour se
   poser sur le cylindre du rouleau. */

// Les deux symboles rares, le logo et la perle, ont un fond sombre : ils
// se remarquent d'un coup d'œil, et la perle, blanche, ne se perd pas sur
// un fond clair.
function fondTuile(g, sombre, teinte){

  const grad = g.createLinearGradient(0, -80, 0, 80);

  if(sombre){
    if(teinte === 'violet'){
      grad.addColorStop(0, '#2a1a5e');
      grad.addColorStop(1, '#0d0826');
    } else {
      grad.addColorStop(0, '#0d2846');
      grad.addColorStop(1, '#050d18');
    }
  } else {
    grad.addColorStop(0, '#dff4ff');
    grad.addColorStop(0.5, '#ffffff');
    grad.addColorStop(1, '#cde8f5');
  }

  g.fillStyle = grad;
  g.fillRect(-88, -80, 176, 160);

  g.strokeStyle = sombre
    ? (teinte === 'violet' ? 'rgba(190,160,255,.65)' : 'rgba(79,180,255,.6)')
    : 'rgba(20,80,120,.3)';
  g.lineWidth = 3;
  g.strokeRect(-86.5, -78.5, 173, 157);
}

const ICONES = {

  vague(g){
    const couleurs = ['#8fdcff', '#3aa8f2', '#1b6fd0'];
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for(let k = 0; k < 3; k++){
      g.beginPath();
      for(let i = 0; i <= 48; i++){
        const t = i / 48;
        const x = -62 + t * 124;
        const y = -34 + k * 30 + Math.sin(t * TAU * 1.5 + k * 0.9) * 11;
        if(i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.lineWidth = 16;
      g.strokeStyle = couleurs[k];
      g.stroke();
    }
    g.fillStyle = 'rgba(255,255,255,.95)';
    [[-44, -50, 4], [4, -54, 3], [50, -42, 5], [30, -60, 2.5]].forEach(([x, y, r]) => {
      g.beginPath();
      g.arc(x, y, r, 0, TAU);
      g.fill();
    });
  },

  poisson(g){
    // Queue
    g.fillStyle = '#ff7a2f';
    g.beginPath();
    g.moveTo(-30, 0);
    g.lineTo(-68, -32);
    g.quadraticCurveTo(-54, 0, -68, 32);
    g.closePath();
    g.fill();
    // Nageoire dorsale
    g.beginPath();
    g.moveTo(-8, -24);
    g.quadraticCurveTo(12, -56, 36, -22);
    g.closePath();
    g.fill();
    // Corps
    const dg = g.createLinearGradient(0, -30, 0, 30);
    dg.addColorStop(0, '#ffc15e');
    dg.addColorStop(1, '#ff6a1a');
    g.fillStyle = dg;
    g.beginPath();
    g.ellipse(6, 0, 46, 29, 0, 0, TAU);
    g.fill();
    // Rayures
    g.strokeStyle = 'rgba(255,255,255,.8)';
    g.lineWidth = 8;
    g.lineCap = 'round';
    [-14, 6, 24].forEach(x => {
      g.beginPath();
      g.moveTo(x, -20);
      g.quadraticCurveTo(x + 6, 0, x, 20);
      g.stroke();
    });
    // Œil
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.arc(36, -7, 8, 0, TAU);
    g.fill();
    g.fillStyle = '#0c2233';
    g.beginPath();
    g.arc(38, -7, 4, 0, TAU);
    g.fill();
  },

  coquillage(g){
    const cx = 0, cy = 38, r = 78, n = 7;
    const dg = g.createLinearGradient(0, -40, 0, 40);
    dg.addColorStop(0, '#ffc0d4');
    dg.addColorStop(1, '#ff5f93');
    g.fillStyle = dg;
    g.beginPath();
    g.moveTo(cx, cy);
    for(let i = 0; i <= n; i++){
      const a0 = Math.PI * (1.1 + 0.8 * i / n);
      const a1 = Math.PI * (1.1 + 0.8 * (i + 1) / n);
      const p0 = [cx + r * Math.cos(a0), cy + r * Math.sin(a0)];
      if(i === 0) g.lineTo(p0[0], p0[1]);
      if(i < n){
        const am = (a0 + a1) / 2;
        const p1 = [cx + r * Math.cos(a1), cy + r * Math.sin(a1)];
        g.quadraticCurveTo(cx + r * 1.13 * Math.cos(am), cy + r * 1.13 * Math.sin(am), p1[0], p1[1]);
      }
    }
    g.closePath();
    g.fill();
    // Nervures
    g.strokeStyle = '#d63b74';
    g.lineWidth = 4;
    g.lineCap = 'round';
    for(let i = 0; i <= n; i++){
      const a = Math.PI * (1.1 + 0.8 * i / n);
      g.beginPath();
      g.moveTo(cx, cy);
      g.lineTo(cx + r * 0.94 * Math.cos(a), cy + r * 0.94 * Math.sin(a));
      g.stroke();
    }
    // Charnière
    g.fillStyle = '#ff5f93';
    g.beginPath();
    g.moveTo(-20, cy + 2);
    g.lineTo(20, cy + 2);
    g.lineTo(13, cy + 20);
    g.lineTo(-13, cy + 20);
    g.closePath();
    g.fill();
    g.strokeStyle = '#d63b74';
    g.lineWidth = 3;
    g.stroke();
  },

  ancre(g){
    g.strokeStyle = '#2b4863';
    g.fillStyle = '#2b4863';
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.lineWidth = 11;
    // Anneau
    g.beginPath();
    g.arc(0, -52, 11, 0, TAU);
    g.stroke();
    // Fût
    g.beginPath();
    g.moveTo(0, -40);
    g.lineTo(0, 62);
    g.stroke();
    // Jas
    g.beginPath();
    g.moveTo(-26, -26);
    g.lineTo(26, -26);
    g.stroke();
    // Bras
    g.beginPath();
    g.arc(0, 18, 46, 0.1 * Math.PI, 0.9 * Math.PI);
    g.stroke();
    // Pattes
    [-1, 1].forEach(s => {
      g.beginPath();
      g.moveTo(s * 44, 32);
      g.lineTo(s * 62, 24);
      g.lineTo(s * 46, 12);
      g.closePath();
      g.fill();
    });
    // Reflet
    g.strokeStyle = 'rgba(160,210,255,.7)';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(-4, -34);
    g.lineTo(-4, 50);
    g.stroke();
  },

  bulle(g){
    [[-16, 12, 38], [30, -30, 22], [32, 36, 14]].forEach(([x, y, r]) => {
      const rg = g.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
      rg.addColorStop(0, 'rgba(255,255,255,.95)');
      rg.addColorStop(0.4, 'rgba(150,215,255,.6)');
      rg.addColorStop(1, 'rgba(40,140,220,.7)');
      g.fillStyle = rg;
      g.beginPath();
      g.arc(x, y, r, 0, TAU);
      g.fill();
      g.strokeStyle = 'rgba(30,120,200,.85)';
      g.lineWidth = 4;
      g.stroke();
      g.strokeStyle = 'rgba(255,255,255,.95)';
      g.lineWidth = 4;
      g.lineCap = 'round';
      g.beginPath();
      g.arc(x, y, r * 0.7, Math.PI * 1.1, Math.PI * 1.45);
      g.stroke();
    });
  },

  perle(g){
    // Demi-coquille
    g.fillStyle = '#e9c46a';
    g.beginPath();
    g.ellipse(0, 26, 58, 30, 0, 0, Math.PI);
    g.fill();
    g.strokeStyle = '#b8862b';
    g.lineWidth = 4;
    g.lineCap = 'round';
    for(let i = -3; i <= 3; i++){
      g.beginPath();
      g.moveTo(i * 4, 26);
      g.lineTo(i * 17, 54);
      g.stroke();
    }
    // Perle
    const rg = g.createRadialGradient(-13, -24, 4, 0, -10, 40);
    rg.addColorStop(0, '#ffffff');
    rg.addColorStop(0.55, '#f4edff');
    rg.addColorStop(1, '#b9addb');
    g.fillStyle = rg;
    g.beginPath();
    g.arc(0, -8, 37, 0, TAU);
    g.fill();
    g.strokeStyle = 'rgba(120,100,170,.55)';
    g.lineWidth = 3;
    g.stroke();
    g.fillStyle = 'rgba(255,255,255,.95)';
    g.beginPath();
    g.ellipse(-14, -22, 9, 6, -0.6, 0, TAU);
    g.fill();
  },

  logo(g, logo){
    if(logo){
      ajuster(g, logo, 0, 0, 152, 112);
    } else {
      g.fillStyle = '#ffffff';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = '700 38px ' + POLICE;
      g.fillText('LA WAVE', 0, 0);
    }
  }
};

// Une tuile, à l'endroit. Sert aussi à l'icône des combinaisons dans
// l'interface.
function tuileDroite(id, logo){
  const { c, x: g } = creerCanvas(TL, TA);
  g.translate(TL / 2, TA / 2);
  fondTuile(g, id === 'logo' || id === 'perle', id === 'perle' ? 'violet' : 'bleu');
  ICONES[id](g, logo);
  return c;
}

// La bande d'un rouleau : les tuiles à la suite, tournées d'un quart de
// tour pour s'enrouler autour du cylindre. Le sens a été calculé à partir
// de la géométrie d'un cylindre Three.js posé sur son côté : l'axe de
// l'image devient l'axe du rouleau, et le haut de chaque symbole pointe
// vers les u croissants.
function creerBande(ordre, tuiles){
  const { c, x: g } = creerCanvas(N_TUILES * TA, TL);
  ordre.forEach((id, k) => {
    g.save();
    g.translate((k + 0.5) * TA, TL / 2);
    g.rotate(Math.PI / 2);
    g.drawImage(tuiles[id], -TL / 2, -TA / 2);
    g.restore();
  });
  return c;
}


/* ---- Le fronton, l'écran et la vitre d'une machine ---- */

function creerFronton(def, logo){

  const { c, x: g } = creerCanvas(800, 240);

  const fond = g.createLinearGradient(0, 0, 800, 0);
  fond.addColorStop(0, def.sombre);
  fond.addColorStop(0.5, melange(def.sombre, def.couleur, 0.34));
  fond.addColorStop(1, def.sombre);
  g.fillStyle = fond;
  g.fillRect(0, 0, 800, 240);

  // Des vagues lumineuses en filigrane.
  g.lineWidth = 3;
  for(let k = 0; k < 5; k++){
    g.strokeStyle = 'rgba(255,255,255,' + (0.06 + k * 0.014) + ')';
    g.beginPath();
    for(let x = 0; x <= 800; x += 8){
      const y = 34 + k * 42 + Math.sin(x / 68 + k * 1.3) * 12;
      if(x === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.stroke();
  }

  if(logo){
    ajuster(g, logoTeinte(logo, '#ffffff'), 200, 120, 330, 132);
  } else {
    g.fillStyle = '#ffffff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '700 60px ' + POLICE;
    g.fillText('LA WAVE', 200, 120);
  }

  g.fillStyle = def.couleur;
  g.fillRect(394, 48, 4, 144);

  // Le nom occupe la moitié droite, entre le filet et le cadre : on réduit
  // la taille des noms trop longs plutôt que de les laisser déborder.
  g.textBaseline = 'middle';
  let taille = 76;
  g.font = '700 ' + taille + 'px ' + POLICE;
  while(taille > 40 && largeurEspacee(g, def.nom, 6) > 340){
    taille -= 2;
    g.font = '700 ' + taille + 'px ' + POLICE;
  }
  g.shadowColor = def.couleur;
  g.shadowBlur = 28;
  g.fillStyle = '#ffffff';
  texteEspace(g, def.nom, 592, 106, 6);
  g.shadowBlur = 0;

  g.font = '600 23px ' + POLICE;
  g.fillStyle = eclaircir(def.couleur, 0.35);
  texteEspace(g, 'ESPACE DES WAVEURS', 592, 178, 4);

  g.strokeStyle = def.couleur;
  g.lineWidth = 10;
  g.strokeRect(5, 5, 790, 230);
  g.strokeStyle = 'rgba(255,255,255,.55)';
  g.lineWidth = 2;
  g.strokeRect(15, 15, 770, 210);

  return c;
}

// L'écran change à chaque tour : on le redessine sur son propre canvas.
function dessinerEcran(g, principal, secondaire, couleur){

  const l = 560, h = 120;

  const fond = g.createLinearGradient(0, 0, 0, h);
  fond.addColorStop(0, '#04101d');
  fond.addColorStop(1, '#020812');
  g.fillStyle = fond;
  g.fillRect(0, 0, l, h);

  g.strokeStyle = 'rgba(255,255,255,.05)';
  g.lineWidth = 1;
  for(let y = 0; y < h; y += 4){
    g.beginPath();
    g.moveTo(0, y + 0.5);
    g.lineTo(l, y + 0.5);
    g.stroke();
  }

  g.textAlign = 'center';
  g.textBaseline = 'middle';

  g.font = '700 46px ' + POLICE;
  g.shadowColor = couleur;
  g.shadowBlur = 18;
  g.fillStyle = couleur;
  g.fillText(principal, l / 2, secondaire ? 46 : 60);
  g.shadowBlur = 0;

  if(secondaire){
    g.font = '500 22px ' + POLICE;
    g.fillStyle = 'rgba(255,255,255,.72)';
    g.fillText(secondaire, l / 2, 92);
  }

  g.strokeStyle = 'rgba(255,255,255,.22)';
  g.lineWidth = 3;
  g.strokeRect(1.5, 1.5, l - 3, h - 3);
}

// Une vitre : un reflet en diagonale. Celle des machines porte en plus la
// ligne de gain, au milieu ; celle de l'aquarium n'en a pas.
function creerVitre(avecLigne){

  const { c, x: g } = creerCanvas(256, 172);

  const reflet = g.createLinearGradient(0, 0, 256, 172);
  reflet.addColorStop(0.18, 'rgba(255,255,255,0)');
  reflet.addColorStop(0.3, 'rgba(255,255,255,.16)');
  reflet.addColorStop(0.42, 'rgba(255,255,255,0)');
  reflet.addColorStop(0.55, 'rgba(255,255,255,.08)');
  reflet.addColorStop(0.62, 'rgba(255,255,255,0)');
  g.fillStyle = reflet;
  g.fillRect(0, 0, 256, 172);

  if(!avecLigne) return c;

  g.fillStyle = 'rgba(233,196,106,.95)';
  g.fillRect(0, 84, 256, 4);
  g.fillStyle = 'rgba(255,240,190,.9)';
  g.fillRect(0, 85, 256, 2);

  [0, 252].forEach(x => {
    g.fillStyle = 'rgba(233,196,106,.95)';
    g.beginPath();
    g.moveTo(x, 74);
    g.lineTo(x === 0 ? 14 : 242, 86);
    g.lineTo(x, 98);
    g.closePath();
    g.fill();
  });

  return c;
}


/* ---- Textures de la salle ---- */

function creerMoquette(){

  const { c, x: g } = creerCanvas(512, 512);

  g.fillStyle = '#0a1c30';
  g.fillRect(0, 0, 512, 512);

  // Des écailles : rangées d'arcs concentriques, décalées une ligne sur deux.
  // 512 est un multiple de leur période, le motif se raccorde.
  g.lineWidth = 3;
  const r = 32;
  for(let row = -1; row <= 17; row++){
    for(let col = -1; col <= 8; col++){
      const cx = col * r * 2 + (row % 2 ? r : 0);
      const cy = row * r;
      [1, 0.66, 0.33].forEach((k, i) => {
        g.strokeStyle = 'rgba(70,150,205,' + (0.24 - i * 0.05) + ')';
        g.beginPath();
        g.arc(cx, cy, r * k, 0, Math.PI);
        g.stroke();
      });
    }
  }

  // Un peu de grain, pour que le tapis ne paraisse pas plastifié.
  const img = g.getImageData(0, 0, 512, 512);
  for(let i = 0; i < img.data.length; i += 4){
    const v = (Math.random() - 0.5) * 10;
    img.data[i] += v;
    img.data[i + 1] += v;
    img.data[i + 2] += v;
  }
  g.putImageData(img, 0, 0);

  return c;
}

function creerTapis(logo){

  const L = 512, H = 1408;
  const { c, x: g } = creerCanvas(L, H);

  const fond = g.createLinearGradient(0, 0, 0, H);
  fond.addColorStop(0, '#0d4a66');
  fond.addColorStop(0.5, '#0a3550');
  fond.addColorStop(1, '#0d4a66');
  g.fillStyle = fond;
  g.fillRect(0, 0, L, H);

  // Vagues qui traversent le tapis.
  g.lineWidth = 3;
  for(let y = 40; y < H; y += 46){
    g.strokeStyle = 'rgba(120,210,245,' + (0.10 + 0.05 * Math.sin(y / 90)) + ')';
    g.beginPath();
    for(let x = 0; x <= L; x += 8){
      const yy = y + Math.sin(x / 46 + y / 60) * 9;
      if(x === 0) g.moveTo(x, yy); else g.lineTo(x, yy);
    }
    g.stroke();
  }

  // Médaillons : un anneau doré, et le logo au centre.
  [0.16, 0.5, 0.84].forEach((t, i) => {
    const cy = H * t;
    g.strokeStyle = 'rgba(233,196,106,.85)';
    g.lineWidth = 6;
    g.beginPath();
    g.arc(L / 2, cy, 150, 0, TAU);
    g.stroke();
    g.strokeStyle = 'rgba(120,210,245,.6)';
    g.lineWidth = 3;
    g.beginPath();
    g.arc(L / 2, cy, 132, 0, TAU);
    g.stroke();
    g.fillStyle = 'rgba(4,20,36,.55)';
    g.beginPath();
    g.arc(L / 2, cy, 126, 0, TAU);
    g.fill();
    if(i === 1 && logo){
      ajuster(g, logoTeinte(logo, '#ffffff'), L / 2, cy, 210, 110);
    }
  });

  // Deux filets dorés le long des bords.
  g.strokeStyle = 'rgba(233,196,106,.9)';
  g.lineWidth = 8;
  g.strokeRect(14, 14, L - 28, H - 28);
  g.strokeStyle = 'rgba(120,210,245,.7)';
  g.lineWidth = 3;
  g.strokeRect(32, 32, L - 64, H - 64);

  return c;
}

function creerMur(){

  const { c, x: g } = creerCanvas(256, 590);

  const fond = g.createLinearGradient(0, 0, 0, 590);
  fond.addColorStop(0, '#04101c');
  fond.addColorStop(1, '#0a2238');
  g.fillStyle = fond;
  g.fillRect(0, 0, 256, 590);

  // Cannelures verticales.
  for(let x = 0; x < 256; x += 32){
    g.fillStyle = 'rgba(80,160,210,.06)';
    g.fillRect(x, 0, 14, 590);
    g.fillStyle = 'rgba(0,0,0,.25)';
    g.fillRect(x + 14, 0, 3, 590);
  }

  // Le soubassement, plus sombre, et sa lisse dorée.
  g.fillStyle = 'rgba(0,8,16,.5)';
  g.fillRect(0, 430, 256, 160);
  g.fillStyle = 'rgba(233,196,106,.85)';
  g.fillRect(0, 428, 256, 4);

  return c;
}

// Un trait de néon en vague, pour souligner le haut des murs.
function creerNeonVague(couleur){

  const { c, x: g } = creerCanvas(1024, 96);

  g.lineCap = 'round';

  const trace = () => {
    g.beginPath();
    for(let x = 0; x <= 1024; x += 6){
      const y = 48 + Math.sin(x / 1024 * TAU * 4) * 18;
      if(x === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
  };

  g.shadowColor = couleur;
  g.shadowBlur = 26;
  g.strokeStyle = couleur;
  g.lineWidth = 9;
  trace();
  g.stroke();

  g.shadowBlur = 0;
  g.strokeStyle = '#ffffff';
  g.lineWidth = 3;
  trace();
  g.stroke();

  return c;
}

function creerEnseigne(texte, couleur, largeur, hauteur, taille){

  const { c, x: g } = creerCanvas(largeur, hauteur);

  g.textBaseline = 'middle';
  g.font = '700 ' + taille + 'px ' + POLICE;

  g.shadowColor = couleur;
  g.shadowBlur = 36;
  g.fillStyle = couleur;
  texteEspace(g, texte, largeur / 2, hauteur / 2, taille * 0.12);
  texteEspace(g, texte, largeur / 2, hauteur / 2, taille * 0.12);

  g.shadowBlur = 0;
  g.fillStyle = '#ffffff';
  texteEspace(g, texte, largeur / 2, hauteur / 2, taille * 0.12);

  return c;
}

function creerAquarium(){

  const { c, x: g } = creerCanvas(1024, 512);

  const fond = g.createLinearGradient(0, 0, 0, 512);
  fond.addColorStop(0, '#0d6a94');
  fond.addColorStop(0.55, '#0a466f');
  fond.addColorStop(1, '#06223d');
  g.fillStyle = fond;
  g.fillRect(0, 0, 1024, 512);

  // Des rais de lumière qui descendent de la surface.
  for(let i = 0; i < 9; i++){
    const x = 50 + i * 118 + hasard(-18, 18);
    const rg = g.createLinearGradient(x, 0, x + 120, 512);
    rg.addColorStop(0, 'rgba(170,235,255,.26)');
    rg.addColorStop(1, 'rgba(170,235,255,0)');
    g.fillStyle = rg;
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x + 48, 0);
    g.lineTo(x + 168, 512);
    g.lineTo(x + 120, 512);
    g.closePath();
    g.fill();
  }

  // Le sable.
  const sable = g.createLinearGradient(0, 452, 0, 512);
  sable.addColorStop(0, 'rgba(201,185,138,0)');
  sable.addColorStop(1, 'rgba(201,185,138,.95)');
  g.fillStyle = sable;
  g.fillRect(0, 452, 1024, 60);

  // Des algues.
  for(let i = 0; i < 26; i++){
    const x = hasard(0, 1024);
    const h = hasard(90, 230);
    g.strokeStyle = 'rgba(' + Math.round(hasard(20, 60)) + ',' + Math.round(hasard(120, 190)) + ',' +
                    Math.round(hasard(90, 130)) + ',.8)';
    g.lineWidth = hasard(5, 10);
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(x, 500);
    for(let y = 0; y <= h; y += 10){
      g.lineTo(x + Math.sin(y / 26 + i) * 14, 500 - y);
    }
    g.stroke();
  }

  // Quelques coraux au pied.
  ['#ff6b81', '#ff9f43', '#e879f9', '#ff8a5c'].forEach((couleur, i) => {
    for(let k = 0; k < 4; k++){
      const x = 80 + i * 250 + hasard(-70, 70);
      g.fillStyle = couleur;
      g.globalAlpha = 0.85;
      g.beginPath();
      g.arc(x, 500, hasard(16, 30), Math.PI, TAU);
      g.fill();
    }
  });
  g.globalAlpha = 1;

  return c;
}

function creerPoissonTex(){

  const { c, x: g } = creerCanvas(128, 64);

  g.fillStyle = '#ffffff';
  g.beginPath();
  g.moveTo(20, 32);
  g.lineTo(2, 10);
  g.quadraticCurveTo(12, 32, 2, 54);
  g.closePath();
  g.fill();

  g.beginPath();
  g.ellipse(64, 32, 44, 23, 0, 0, TAU);
  g.fill();

  g.beginPath();
  g.moveTo(48, 12);
  g.quadraticCurveTo(66, -6, 86, 14);
  g.closePath();
  g.fill();

  g.fillStyle = 'rgba(0,0,0,.2)';
  g.beginPath();
  g.ellipse(64, 43, 36, 10, 0, 0, TAU);
  g.fill();

  g.fillStyle = '#04121f';
  g.beginPath();
  g.arc(92, 26, 4.5, 0, TAU);
  g.fill();

  return c;
}

function creerHalo(){
  const { c, x: g } = creerCanvas(64, 64);
  const rg = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  rg.addColorStop(0, 'rgba(255,255,255,1)');
  rg.addColorStop(0.25, 'rgba(255,255,255,.65)');
  rg.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = rg;
  g.fillRect(0, 0, 64, 64);
  return c;
}

function creerBulleTex(){
  const { c, x: g } = creerCanvas(64, 64);
  const rg = g.createRadialGradient(32, 32, 8, 32, 32, 30);
  rg.addColorStop(0, 'rgba(180,235,255,.04)');
  rg.addColorStop(0.78, 'rgba(180,235,255,.22)');
  rg.addColorStop(0.92, 'rgba(230,250,255,.9)');
  rg.addColorStop(1, 'rgba(230,250,255,0)');
  g.fillStyle = rg;
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = 'rgba(255,255,255,.9)';
  g.beginPath();
  g.ellipse(22, 20, 6, 3.5, -0.7, 0, TAU);
  g.fill();
  return c;
}

function creerPieceTex(){
  const { c, x: g } = creerCanvas(64, 64);
  const rg = g.createRadialGradient(26, 24, 2, 32, 32, 28);
  rg.addColorStop(0, '#fff4c2');
  rg.addColorStop(0.6, '#ffd24d');
  rg.addColorStop(1, '#b8860b');
  g.fillStyle = rg;
  g.beginPath();
  g.arc(32, 32, 27, 0, TAU);
  g.fill();
  g.strokeStyle = 'rgba(120,80,0,.8)';
  g.lineWidth = 3;
  g.stroke();
  g.beginPath();
  g.arc(32, 32, 17, 0, TAU);
  g.stroke();
  return c;
}

function creerOmbre(){
  const { c, x: g } = creerCanvas(128, 128);
  const rg = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  rg.addColorStop(0, 'rgba(0,0,0,.75)');
  rg.addColorStop(0.6, 'rgba(0,0,0,.35)');
  rg.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = rg;
  g.fillRect(0, 0, 128, 128);
  return c;
}

// La lumière qui danse au fond d'une piscine : les arêtes d'un diagramme
// de Voronoï, raccordé sur ses bords pour pouvoir se répéter.
function creerCaustiques(n){

  const { c, x: g } = creerCanvas(n, n);
  const img = g.createImageData(n, n);

  const cases = 8;
  const germes = [];
  for(let j = 0; j < cases; j++){
    for(let i = 0; i < cases; i++){
      germes.push([(i + Math.random()) / cases, (j + Math.random()) / cases]);
    }
  }

  for(let py = 0; py < n; py++){
    for(let px = 0; px < n; px++){

      const u = px / n, v = py / n;
      const ci = Math.floor(u * cases), cj = Math.floor(v * cases);

      let f1 = 9, f2 = 9;

      for(let dj = -1; dj <= 1; dj++){
        for(let di = -1; di <= 1; di++){
          const gi = (ci + di + cases) % cases;
          const gj = (cj + dj + cases) % cases;
          const s = germes[gj * cases + gi];
          const sx = s[0] + (ci + di < 0 ? -1 : (ci + di >= cases ? 1 : 0));
          const sy = s[1] + (cj + dj < 0 ? -1 : (cj + dj >= cases ? 1 : 0));
          const d = Math.hypot(u - sx, v - sy);
          if(d < f1){ f2 = f1; f1 = d; } else if(d < f2){ f2 = d; }
        }
      }

      // Proche d'une arête, les deux germes les plus proches sont à égale
      // distance : l'écart tend vers zéro.
      const e = (f2 - f1) * cases;
      const val = Math.pow(clamp(1 - e * 3.4, 0, 1), 2.2);

      const o = (py * n + px) * 4;
      img.data[o] = 150 + val * 105;
      img.data[o + 1] = 225 + val * 30;
      img.data[o + 2] = 255;
      img.data[o + 3] = val * 255;
    }
  }

  g.putImageData(img, 0, 0);

  return c;
}


/* ----------------------------------------------------------------------
   Géométries
   ---------------------------------------------------------------------- */

function colorer(g, hex){
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  const c = new THREE.Color(hex);
  for(let i = 0; i < n; i++){
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

// Colle plusieurs géométries en une : un seul appel de dessin au lieu de
// dizaines. Tout est mis à plat (sans index) pour que les formes puissent
// se mélanger.
function fusionner(liste){

  const plates = liste.map(g => g.index ? g.toNonIndexed() : g);

  let n = 0;
  plates.forEach(g => { n += g.attributes.position.count; });

  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  const uv = new Float32Array(n * 2);
  const col = new Float32Array(n * 3).fill(1);

  let o = 0;

  plates.forEach(g => {
    const k = g.attributes.position.count;
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    if(g.attributes.uv) uv.set(g.attributes.uv.array, o * 2);
    if(g.attributes.color) col.set(g.attributes.color.array, o * 3);
    o += k;
  });

  const res = new THREE.BufferGeometry();
  res.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  res.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  res.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  res.setAttribute('color', new THREE.BufferAttribute(col, 3));

  return res;
}

function boite(l, h, p, x, y, z, couleur, rx){
  const g = new THREE.BoxGeometry(l, h, p);
  if(rx) g.rotateX(rx);
  g.translate(x, y, z);
  if(couleur) colorer(g, couleur);
  return g;
}

// Les lampes d'une machine : des points alignés le long des cadres.
function positionsLampes(){

  const p = [];

  const ligne = (x0, y0, z0, x1, y1, z1, pas) => {
    const L = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
    const n = Math.max(1, Math.round(L / pas));
    for(let i = 0; i <= n; i++){
      const t = i / n;
      p.push(lerp(x0, x1, t), lerp(y0, y1, t), lerp(z0, z1, t));
    }
  };

  // Fronton
  ligne(-0.55, 2.20, 0.425,  0.55, 2.20, 0.425, 0.07);
  ligne(-0.55, 1.79, 0.425,  0.55, 1.79, 0.425, 0.07);
  ligne(-0.575, 1.83, 0.425, -0.575, 2.16, 0.425, 0.07);
  ligne( 0.575, 1.83, 0.425,  0.575, 2.16, 0.425, 0.07);
  // Fenêtre des rouleaux
  ligne(-0.4, 1.605, 0.475,  0.4, 1.605, 0.475, 0.09);
  ligne(-0.4, 1.075, 0.475,  0.4, 1.075, 0.475, 0.09);
  ligne(-0.4, 1.11, 0.475, -0.4, 1.57, 0.475, 0.09);
  ligne( 0.4, 1.11, 0.475,  0.4, 1.57, 0.475, 0.09);
  // Arêtes du bas de caisse
  ligne(-0.505, 0.16, 0.47, -0.505, 0.84, 0.47, 0.09);
  ligne( 0.505, 0.16, 0.47,  0.505, 0.84, 0.47, 0.09);

  return new Float32Array(p);
}

// Tout ce qui est commun aux douze machines : leurs formes, construites
// une fois, et les matériaux qui n'ont pas de couleur propre.
function construireModeleMachine(){

  const W = 1.0, D = 0.9;
  const cab = '#14314f', cab2 = '#0d2136', noir = '#04080f';
  const acier = '#a9bccd', corail = '#ff6b81';

  const corps = [
    boite(W + 0.05, 0.10, D + 0.05, 0, 0.05, 0, cab2),            // socle
    boite(W, 0.76, D, 0, 0.48, 0, cab),                           // caisse
    boite(0.17, 0.56, D, -0.415, 1.34, 0, cab),                   // joue gauche
    boite(0.17, 0.56, D, 0.415, 1.34, 0, cab),                    // joue droite
    boite(W, 0.06, D, 0, 1.59, 0, cab),                           // linteau
    boite(W, 0.06, D, 0, 1.09, 0, cab),                           // appui
    boite(0.68, 0.46, 0.04, 0, 1.34, -0.10, noir),                // fond du puits
    boite(W - 0.08, 0.20, D - 0.10, 0, 1.72, 0, cab2),            // boîtier de l'écran
    boite(W + 0.04, 0.34, 0.55, 0, 1.99, 0.12, cab2),             // boîtier du fronton
    boite(W - 0.04, 0.09, 0.42, 0, 0.96, 0.27, cab2, 0.28),       // pupitre incliné
    boite(0.56, 0.13, 0.12, 0, 0.36, 0.435, noir)                 // bac à pièces
  ];

  const accent = [
    // Cadre de la fenêtre des rouleaux
    boite(0.76, 0.045, 0.05, 0, 1.575, 0.445),
    boite(0.76, 0.045, 0.05, 0, 1.105, 0.445),
    boite(0.045, 0.53, 0.05, -0.36, 1.34, 0.445),
    boite(0.045, 0.53, 0.05, 0.36, 1.34, 0.445),
    // Liseré du bas de caisse
    boite(W + 0.01, 0.05, 0.02, 0, 0.62, 0.455),
    // Cadre du fronton
    boite(W + 0.09, 0.035, 0.05, 0, 2.17, 0.385),
    boite(W + 0.09, 0.035, 0.05, 0, 1.815, 0.385),
    boite(0.035, 0.36, 0.05, -0.545, 1.995, 0.385),
    boite(0.035, 0.36, 0.05, 0.545, 1.995, 0.385),
    // Plaque du levier
    boite(0.05, 0.18, 0.18, 0.525, 1.02, 0.06)
  ];

  // Deux ailerons en forme de crête de vague, de part et d'autre du
  // fronton : c'est ce qui donne aux machines leur silhouette de la mer.
  const s = new THREE.Shape();
  s.moveTo(-0.45, 0.10);
  s.lineTo(-0.45, 2.05);
  s.bezierCurveTo(-0.45, 2.38, -0.12, 2.48, 0.10, 2.32);
  s.bezierCurveTo(0.26, 2.20, 0.22, 2.05, 0.12, 2.02);
  s.bezierCurveTo(0.03, 2.0, -0.04, 2.10, 0.0, 2.16);
  s.bezierCurveTo(-0.12, 2.24, -0.29, 2.12, -0.29, 1.9);
  s.lineTo(-0.29, 0.10);
  s.closePath();

  const aileron = new THREE.ExtrudeGeometry(s, { depth: 0.03, bevelEnabled: false, curveSegments: 10 });
  aileron.rotateY(-Math.PI / 2);

  const aG = aileron.clone();
  aG.translate(-0.50, 0, 0);
  const aD = aileron.clone();
  aD.translate(0.53, 0, 0);
  accent.push(aG, aD);

  // Les quatre petits boutons du pupitre.
  const a = 0.28, ph = 0.96, pz = 0.27;

  const surPupitre = (x, zl, ep) => [
    x,
    ph + (0.045 + ep) * Math.cos(a) - zl * Math.sin(a),
    pz + (0.045 + ep) * Math.sin(a) + zl * Math.cos(a)
  ];

  const boutons = [-0.34, -0.2, 0.2, 0.34].map(x => {
    const g = new THREE.CylinderGeometry(0.035, 0.035, 0.02, 20);
    g.rotateX(a);
    const p = surPupitre(x, 0.02, 0.01);
    g.translate(p[0], p[1], p[2]);
    return g;
  });

  // Le gros bouton du milieu, qui s'enfonce : c'est un objet à part.
  const bouton = surPupitre(0, 0.02, 0.015);

  // Le levier : un axe d'acier, une bille de corail.
  const bras = new THREE.CylinderGeometry(0.014, 0.014, 0.38, 12);
  bras.translate(0, 0.19, 0);
  colorer(bras, acier);
  const bille = new THREE.SphereGeometry(0.045, 18, 14);
  bille.translate(0, 0.40, 0);
  colorer(bille, corail);
  const pivot = new THREE.SphereGeometry(0.03, 12, 10);
  colorer(pivot, acier);

  return {
    corps: fusionner(corps),
    accent: fusionner(accent),
    boutons: fusionner(boutons),
    levier: fusionner([bras, bille, pivot]),
    tirer: new THREE.CylinderGeometry(0.058, 0.058, 0.03, 28),
    positionTirer: bouton,
    inclinaison: a,
    rouleau: (() => {
      const g = new THREE.CylinderGeometry(0.17, 0.17, 0.17, 32, 1, true);
      g.rotateZ(Math.PI / 2);
      return g;
    })(),
    vitre: new THREE.PlaneGeometry(0.66, 0.44),
    fronton: new THREE.PlaneGeometry(1.0, 0.30),
    ecran: new THREE.PlaneGeometry(0.70, 0.15),
    lampes: positionsLampes()
  };
}


/* ----------------------------------------------------------------------
   Une machine à sous
   ---------------------------------------------------------------------- */

class Machine {

  constructor(def, x, z, rotY, R){

    this.def = def;
    this.R = R;
    this.tourne = false;
    this.eclat = null;      // { fin, jackpot } pendant un gain
    this.levierCible = -0.15;
    this.levierAngle = -0.15;
    this.appui = 0;
    this.phase = hasard(0, TAU);
    this.dernierPas = -1;

    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = rotY;
    this.groupe = g;

    const M = R.modele;

    g.add(new THREE.Mesh(M.corps, R.matCorps));

    this.matAccent = new THREE.MeshPhongMaterial({
      color: def.couleur, shininess: 80, specular: 0x666666
    });
    g.add(new THREE.Mesh(M.accent, this.matAccent));

    // Les boutons brillent de la couleur de la machine.
    const clair = eclaircir(def.couleur, 0.35);
    this.matBoutons = new THREE.MeshBasicMaterial({ color: clair });
    g.add(new THREE.Mesh(M.boutons, this.matBoutons));

    this.matTirer = new THREE.MeshBasicMaterial({ color: 0xffd24d });
    this.tirer = new THREE.Mesh(M.tirer, this.matTirer);
    this.tirer.position.set(M.positionTirer[0], M.positionTirer[1], M.positionTirer[2]);
    this.tirer.rotation.x = M.inclinaison;
    g.add(this.tirer);

    // Les trois rouleaux.
    this.rouleaux = [-0.2, 0, 0.2].map((rx, i) => {
      const mesh = new THREE.Mesh(M.rouleau, R.matRouleaux[i]);
      mesh.position.set(rx, 1.34, 0.12);
      g.add(mesh);
      const angle = (Math.floor(Math.random() * N_TUILES) + 0.5) / N_TUILES * TAU;
      mesh.rotation.x = angle;
      return {
        mesh, ordre: BANDES[i], angle,
        etat: 'repos', vitesse: 0, omega: 15 + i * 1.6,
        a0: 0, delta: 0, t: 0, duree: 1, cible: angle
      };
    });

    const vitre = new THREE.Mesh(M.vitre, R.matVitre);
    vitre.position.set(0, 1.34, 0.452);
    vitre.renderOrder = 3;
    g.add(vitre);

    // Fronton lumineux.
    this.matFronton = new THREE.MeshBasicMaterial({
      map: R.texture(creerFronton(def, R.logo))
    });
    const fronton = new THREE.Mesh(M.fronton, this.matFronton);
    fronton.position.set(0, 1.99, 0.396);
    g.add(fronton);

    // Écran.
    const ec = creerCanvas(560, 120);
    this.ecranCanvas = ec;
    this.ecranTex = R.texture(ec.c);
    const ecran = new THREE.Mesh(M.ecran, new THREE.MeshBasicMaterial({ map: this.ecranTex }));
    ecran.position.set(0, 1.72, 0.401);
    g.add(ecran);
    this.ecrire('TENTE TA CHANCE', 'tire le levier', def.couleur);

    // Levier.
    this.levier = new THREE.Group();
    this.levier.position.set(0.555, 1.02, 0.06);
    this.levier.add(new THREE.Mesh(M.levier, R.matLevier));
    g.add(this.levier);

    // Lampes en chenille.
    const geoL = new THREE.BufferGeometry();
    geoL.setAttribute('position', new THREE.BufferAttribute(M.lampes, 3));
    this.nLampes = M.lampes.length / 3;
    this.couleursLampes = new Float32Array(this.nLampes * 3);
    geoL.setAttribute('color', new THREE.BufferAttribute(this.couleursLampes, 3));
    const lampes = new THREE.Points(geoL, R.matLampes);
    lampes.frustumCulled = false;
    lampes.renderOrder = 4;
    this.lampes = lampes;
    g.add(lampes);
    this.cLampeOn = new THREE.Color(def.couleur);
    this.cLampeMi = new THREE.Color(def.couleur).multiplyScalar(0.38);
    this.cLampeOff = new THREE.Color(def.sombre).multiplyScalar(0.7);
    this.dernierPasLampes = -1;

    // Repères pour viser la machine et pour la caméra.
    this.centre = { x, z };
    this.normale = { x: Math.sin(rotY), z: Math.cos(rotY) };
    this.rotY = rotY;

    const hx = 0.58, hz = 0.47;
    const c = Math.abs(Math.cos(rotY)), s = Math.abs(Math.sin(rotY));
    const ex = c * hx + s * hz, ez = s * hx + c * hz;
    this.collision = { x0: x - ex, x1: x + ex, z0: z - ez, z1: z + ez };
  }

  // Position de la caméra quand on est assis devant. Elle dépend de la
  // forme de l'écran : sur un téléphone tenu droit, il faut reculer pour
  // voir toute la machine.
  vue(aspect){

    const fov = 56;
    const demiLarge = 0.7;
    const dFace = clamp(demiLarge / (Math.tan(fov * Math.PI / 360) * aspect), 0.85, 3);
    const d = 0.45 + dFace;

    return {
      x: this.centre.x + this.normale.x * d,
      y: 1.44,
      z: this.centre.z + this.normale.z * d,
      yaw: this.rotY,
      pitch: -0.045,
      fov
    };
  }

  ecrire(principal, secondaire, couleur){
    dessinerEcran(this.ecranCanvas.x, principal, secondaire, couleur);
    this.ecranTex.needsUpdate = true;
  }

  lancer(){
    this.tourne = true;
    this.levierCible = 1.05;
    this.appui = 1;
    setTimeout(() => { this.levierCible = -0.15; }, 260);
    this.rouleaux.forEach(r => {
      r.etat = 'tourne';
      r.vitesse = Math.max(r.vitesse, 3);
    });
  }

  // Arrête un rouleau sur un symbole.
  //
  // Le freinage suit une courbe qui démarre exactement à la vitesse du
  // rouleau : un freinage qui commencerait plus vite ou plus lentement
  // se verrait comme un à-coup. Cette courbe a une durée fixe et parcourt
  // une distance qui en découle (vitesse × durée ÷ 3). Pour qu'elle
  // s'achève pile sur la bonne tuile, le rouleau continue donc de tourner
  // à vitesse constante jusqu'au point où le freinage doit commencer — au
  // plus un tour, soit moins d'une demi-seconde.
  arreter(i, symbole){

    const r = this.rouleaux[i];

    if(r.etat !== 'tourne') return;

    const k = Math.max(0, r.ordre.indexOf(symbole));
    const cible = (k + 0.5) / N_TUILES * TAU;

    // Chaque rouleau freine un peu plus longtemps que le précédent : ils
    // s'arrêtent dans l'ordre, de gauche à droite.
    const duree = [0.95, 1.05, 1.2][i];
    const distance = r.vitesse * duree / 3;

    const debut = cible - distance;

    let avant = (debut - r.angle) % TAU;
    if(avant < 0) avant += TAU;

    r.cibleFinale = cible;
    r.reste = avant;
    r.duree = duree;
    r.distance = distance;
    r.etat = 'approche';
  }

  // Un tirage qui échoue : les rouleaux s'arrêtent où ils peuvent.
  abandonner(){
    this.rouleaux.forEach((r, i) => {
      if(r.etat === 'tourne') this.arreter(i, choisirSymbole());
    });
  }

  gagner(jackpot){
    this.eclat = { fin: performance.now() + (jackpot ? 4200 : 2400), jackpot };
  }

  maj(dt, t, reduit){

    let toutArrete = true;

    this.rouleaux.forEach((r, i) => {

      if(r.etat === 'tourne'){

        toutArrete = false;
        r.vitesse += (r.omega - r.vitesse) * Math.min(1, dt * 6);
        r.angle += r.vitesse * dt;

      } else if(r.etat === 'approche'){

        // Vitesse constante jusqu'au point de freinage.
        toutArrete = false;

        const pas = r.vitesse * dt;

        if(pas >= r.reste){
          r.angle += r.reste;
          r.a0 = r.angle;
          r.delta = r.distance;
          r.t = 0;
          r.etat = 'freine';
        } else {
          r.angle += pas;
          r.reste -= pas;
        }

      } else if(r.etat === 'freine'){

        toutArrete = false;

        r.t += dt;
        const u = Math.min(1, r.t / r.duree);

        r.angle = r.a0 + r.delta * sortieCubique(u);

        if(u >= 1){
          r.etat = 'repos';
          r.vitesse = 0;
          // On se cale exactement sur la tuile : les flottants ont pu
          // s'écarter de quelques millièmes de radian en chemin.
          r.angle = r.cibleFinale;
          if(this.surArret) this.surArret(i);
        }
      }

      r.mesh.rotation.x = r.angle;
    });

    if(this.tourne && toutArrete) this.tourne = false;

    // Levier : un ressort amorti.
    this.levierAngle += (this.levierCible - this.levierAngle) * Math.min(1, dt * 16);
    this.levier.rotation.x = this.levierAngle;

    // Gros bouton : il respire au repos, s'enfonce au tirage.
    this.appui = Math.max(0, this.appui - dt * 3.2);
    const respire = reduit ? 1 : 1 + 0.06 * Math.sin(t * 3 + this.phase);
    this.tirer.scale.y = respire * (1 - 0.6 * this.appui);

    // Fronton : une très légère pulsation.
    const eclat = this.eclat && performance.now() < this.eclat.fin;
    if(this.eclat && !eclat) this.eclat = null;

    const pulse = reduit ? 0.95 : 0.9 + 0.1 * Math.sin(t * 2 + this.phase);
    const v = eclat ? 1.15 : pulse;
    this.matFronton.color.setRGB(v, v, v);

    this.majLampes(t, eclat, reduit);
  }

  majLampes(t, eclat, reduit){

    // Les lampes changent de pas trois fois par seconde : assez pour
    // donner l'impression de courir, assez lentement pour ne pas fatiguer
    // l'œil. Pendant un gain, elles clignotent deux fois par seconde.
    const pas = eclat
      ? Math.floor(t * 4)
      : Math.floor(t * (reduit ? 1 : 3.3));

    if(pas === this.dernierPasLampes) return;
    this.dernierPasLampes = pas;

    const c = this.couleursLampes;

    for(let i = 0; i < this.nLampes; i++){

      let col;

      if(eclat){
        // Toutes les lampes à l'unisson, de l'or à la couleur de la
        // machine.
        col = pas % 2 === 0 ? R_OR : this.cLampeOn;
      } else {
        const p = (i + pas) % 3;
        col = p === 0 ? this.cLampeOn : (p === 1 ? this.cLampeMi : this.cLampeOff);
      }

      c[i * 3] = col.r;
      c[i * 3 + 1] = col.g;
      c[i * 3 + 2] = col.b;
    }

    this.lampes.geometry.attributes.color.needsUpdate = true;
  }
}

// Couleur des lampes pendant un gain : chargée après Three.js.
let R_OR = null;

function choisirSymbole(){
  return SYMBOLES[Math.floor(Math.random() * SYMBOLES.length)];
}


/* ----------------------------------------------------------------------
   Le son
   ----------------------------------------------------------------------
   Rien n'est téléchargé : tout est synthétisé. Le navigateur n'autorise
   le son qu'après un geste de la personne, d'où l'initialisation au
   moment d'entrer dans la salle.
   ---------------------------------------------------------------------- */

const Son = (function(){

  let ctx = null, maitre = null, actif = true, ambiance = null, minuteur = 0;

  try{
    actif = localStorage.getItem('lawave:waveurs:son') !== 'off';
  }catch(e){ /* stockage indisponible */ }

  function init(){

    if(ctx) return;

    const AC = window.AudioContext || window.webkitAudioContext;
    if(!AC) return;

    try{ ctx = new AC(); }catch(e){ return; }

    maitre = ctx.createGain();
    maitre.gain.value = actif ? 0.6 : 0;
    maitre.connect(ctx.destination);

    demarrerAmbiance();
  }

  function reprendre(){
    if(ctx && ctx.state === 'suspended') ctx.resume();
    // Les bulles s'étaient tues avec la suspension.
    if(ctx && !minuteur) bulle();
  }

  function suspendre(){
    clearTimeout(minuteur);
    minuteur = 0;
    if(ctx && ctx.state === 'running') ctx.suspend();
  }

  function ton(freq, t0, duree, opt){
    if(!ctx || !actif) return;
    const o = opt || {};
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    if(o.glisse) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq * o.glisse), t0 + duree);
    const vol = o.vol || 0.2;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + duree);
    osc.connect(g);
    g.connect(maitre);
    osc.start(t0);
    osc.stop(t0 + duree + 0.03);
  }

  function bruit(t0, duree, opt){
    if(!ctx || !actif) return;
    const o = opt || {};
    const n = Math.max(1, Math.floor(ctx.sampleRate * duree));
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for(let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = o.type || 'bandpass';
    f.frequency.value = o.freq || 1200;
    f.Q.value = o.q || 1;
    const g = ctx.createGain();
    g.gain.value = o.vol || 0.15;
    src.connect(f);
    f.connect(g);
    g.connect(maitre);
    src.start(t0);
  }

  // Le fond sonore : un grondement sourd de bassin, et de temps à autre
  // une bulle qui remonte.
  function demarrerAmbiance(){

    const n = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let prec = 0;
    for(let i = 0; i < n; i++){
      prec = prec * 0.985 + (Math.random() * 2 - 1) * 0.06;
      d[i] = prec;
    }

    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;

    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 260;

    const g = ctx.createGain();
    g.gain.value = 0.5;

    src.connect(f);
    f.connect(g);
    g.connect(maitre);
    src.start();

    ambiance = src;
    bulle();
  }

  function bulle(){
    clearTimeout(minuteur);
    minuteur = setTimeout(() => {
      if(ctx && ctx.state === 'running' && actif){
        ton(hasard(380, 900), ctx.currentTime, 0.14, { glisse: 1.9, vol: 0.04 });
      }
      bulle();
    }, hasard(2500, 7000));
  }

  return {
    init, reprendre, suspendre,

    estActif(){ return actif; },

    regler(valeur){
      actif = valeur;
      try{ localStorage.setItem('lawave:waveurs:son', valeur ? 'on' : 'off'); }catch(e){ /* sans effet */ }
      if(maitre) maitre.gain.setTargetAtTime(valeur ? 0.6 : 0, ctx.currentTime, 0.05);
    },

    clic(){
      if(!ctx) return;
      ton(700, ctx.currentTime, 0.05, { type: 'triangle', vol: 0.08 });
    },

    levier(){
      if(!ctx) return;
      const t = ctx.currentTime;
      bruit(t, 0.22, { freq: 420, vol: 0.14 });
      ton(190, t, 0.22, { type: 'triangle', glisse: 0.55, vol: 0.14 });
    },

    tic(){
      if(!ctx) return;
      ton(hasard(820, 980), ctx.currentTime, 0.03, { type: 'square', vol: 0.03 });
    },

    arret(){
      if(!ctx) return;
      const t = ctx.currentTime;
      ton(150, t, 0.14, { type: 'triangle', glisse: 0.5, vol: 0.26 });
      bruit(t, 0.07, { freq: 2600, vol: 0.09 });
    },

    // Une petite gamme ascendante, d'autant plus longue que le gain est gros.
    gain(niveau){
      if(!ctx) return;
      const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5, 1567.98];
      const t = ctx.currentTime + 0.05;
      const n = clamp(2 + niveau, 2, notes.length);
      for(let i = 0; i < n; i++){
        ton(notes[i], t + i * 0.09, 0.35, { type: 'triangle', vol: 0.16 });
        ton(notes[i] * 2, t + i * 0.09, 0.18, { type: 'sine', vol: 0.05 });
      }
    },

    jackpot(){
      if(!ctx) return;
      const t = ctx.currentTime + 0.05;
      const air = [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5, 1318.5, 1567.98];
      air.forEach((f, i) => {
        ton(f, t + i * 0.12, 0.42, { type: 'triangle', vol: 0.18 });
        ton(f / 2, t + i * 0.12, 0.42, { type: 'sine', vol: 0.1 });
      });
      for(let i = 0; i < 14; i++){
        ton(hasard(1800, 3200), t + 0.5 + i * 0.07, 0.09, { type: 'sine', vol: 0.05 });
      }
    },

    rate(){
      if(!ctx) return;
      const t = ctx.currentTime;
      ton(230, t, 0.2, { type: 'triangle', glisse: 0.75, vol: 0.09 });
    },

    erreur(){
      if(!ctx) return;
      const t = ctx.currentTime;
      ton(220, t, 0.16, { type: 'square', vol: 0.06 });
      ton(165, t + 0.16, 0.26, { type: 'square', vol: 0.06 });
    },

    pas(){
      if(!ctx) return;
      bruit(ctx.currentTime, 0.09, { type: 'lowpass', freq: 240, vol: 0.09 });
    }
  };
})();


/* ----------------------------------------------------------------------
   Interface
   ---------------------------------------------------------------------- */

const ICONES_UI = {
  son: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>',
  muet: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="m22 9-6 6"/><path d="m16 9 6 6"/></svg>',
  plein: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>',
  quitter: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>'
};

const CSS = `
.wv-jeu{position:fixed;inset:0;z-index:150;background:#02060c;color:#e8eaed;font-family:'Public Sans',system-ui,-apple-system,'Segoe UI',sans-serif;overflow:hidden;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;touch-action:none}
.wv-jeu[hidden]{display:none}
.wv-jeu *{box-sizing:border-box}
.wv-canvas{position:absolute;inset:0;width:100%;height:100%;display:block;outline:none}
.wv-hud{position:absolute;inset:0;pointer-events:none}
.wv-carte{background:rgba(6,14,26,.68);border:1px solid rgba(255,255,255,.14);border-radius:14px;padding:10px 14px;-webkit-backdrop-filter:blur(14px) saturate(160%);backdrop-filter:blur(14px) saturate(160%)}
.wv-haut-gauche{position:absolute;top:calc(14px + env(safe-area-inset-top,0px));left:calc(14px + env(safe-area-inset-left,0px));display:flex;flex-direction:column;gap:8px;width:min(236px,46vw)}
.wv-ligne{display:flex;justify-content:space-between;align-items:baseline;gap:10px}
.wv-etiquette{font-size:11px;font-weight:500;letter-spacing:.16em;text-transform:uppercase;color:#9fb0c2}
.wv-valeur{font-size:13px;font-weight:600;color:#fff;font-variant-numeric:tabular-nums;white-space:nowrap}
.wv-barre{height:5px;border-radius:99px;background:rgba(255,255,255,.12);margin-top:8px;overflow:hidden}
.wv-barre span{display:block;height:100%;width:0;border-radius:99px;background:linear-gradient(90deg,#1489de,#4FB4FF);transition:width .7s cubic-bezier(.2,.7,.2,1)}
.wv-pastilles{display:flex;gap:5px;margin-top:9px;flex-wrap:wrap}
.wv-pastilles i{width:11px;height:11px;border-radius:50%;background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.2)}
.wv-pastilles i.on{background:#4FB4FF;border-color:#4FB4FF;box-shadow:0 0 8px rgba(79,180,255,.75)}
.wv-gagne{margin-top:8px;font-size:12px;color:#e9c46a;font-weight:600}
.wv-gagne[hidden]{display:none}
.wv-haut-droite{position:absolute;top:calc(14px + env(safe-area-inset-top,0px));right:calc(14px + env(safe-area-inset-right,0px));display:flex;gap:8px;pointer-events:auto}
.wv-bouton{width:42px;height:42px;border-radius:50%;border:1px solid rgba(255,255,255,.2);background:rgba(6,14,26,.68);color:#dfe7ef;display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0;-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);transition:background .2s,color .2s,border-color .2s}
.wv-bouton:hover{background:rgba(20,44,72,.85);color:#fff;border-color:rgba(255,255,255,.4)}
.wv-bouton:focus-visible,.wv-cta:focus-visible{outline:2px solid #4FB4FF;outline-offset:2px}
.wv-viseur{position:absolute;left:50%;top:50%;width:6px;height:6px;margin:-3px 0 0 -3px;border-radius:50%;background:rgba(255,255,255,.8);box-shadow:0 0 0 2px rgba(0,0,0,.35);transition:transform .2s,background .2s}
.wv-viseur.actif{transform:scale(2.6);background:#4FB4FF}
.wv-viseur.cache{opacity:0}
.wv-invite{position:absolute;left:50%;bottom:calc(64px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);display:flex;align-items:center;gap:10px;padding:10px 18px;border-radius:999px;background:rgba(6,14,26,.8);border:1px solid rgba(79,180,255,.5);font-size:14px;font-weight:500;color:#fff;white-space:nowrap;box-shadow:0 10px 34px rgba(0,0,0,.45);max-width:94vw}
.wv-invite[hidden]{display:none}
.wv-invite small{color:#9fb0c2;font-size:12px;font-weight:400}
.wv-touche{display:inline-flex;align-items:center;justify-content:center;min-width:26px;height:26px;padding:0 7px;border-radius:7px;border:1px solid rgba(255,255,255,.4);background:rgba(255,255,255,.12);font-size:12px;font-weight:700;color:#fff}
.wv-gain{position:absolute;left:50%;top:11%;transform:translate(-50%,0);font-size:clamp(36px,7vw,76px);font-weight:700;letter-spacing:-.02em;color:#ffe08a;text-shadow:0 0 34px rgba(255,200,80,.65),0 4px 24px rgba(0,0,0,.65);opacity:0;pointer-events:none;white-space:nowrap;text-align:center;line-height:1.05}
.wv-gain small{display:block;font-size:.26em;letter-spacing:.22em;text-transform:uppercase;color:#fff;font-weight:500;margin-top:6px}
.wv-gain.anim{animation:wvGain 2.8s cubic-bezier(.2,.7,.2,1) forwards}
.wv-plus{position:absolute;top:calc(168px + env(safe-area-inset-top,0px));left:calc(16px + env(safe-area-inset-left,0px));font-size:22px;font-weight:700;color:#ffe08a;text-shadow:0 0 18px rgba(255,200,80,.6),0 2px 10px rgba(0,0,0,.7);opacity:0;pointer-events:none;white-space:nowrap}
.wv-plus.anim{animation:wvPlus 2.2s cubic-bezier(.2,.7,.2,1) forwards}
@keyframes wvPlus{0%{opacity:0;transform:translateY(10px)}14%{opacity:1;transform:translateY(0)}72%{opacity:1}100%{opacity:0;transform:translateY(-22px)}}
@keyframes wvGain{0%{opacity:0;transform:translate(-50%,26px) scale(.7)}12%{opacity:1;transform:translate(-50%,0) scale(1.08)}22%{transform:translate(-50%,0) scale(1)}78%{opacity:1}100%{opacity:0;transform:translate(-50%,-44px) scale(1)}}
.wv-gains{position:absolute;right:14px;top:50%;transform:translateY(-50%);width:246px;padding:14px 16px}
.wv-gains[hidden]{display:none}
.wv-gains h3{margin:0 0 10px;font-size:11px;font-weight:500;letter-spacing:.18em;text-transform:uppercase;color:#9fb0c2}
.wv-gains ul{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.wv-gains li{display:flex;justify-content:space-between;gap:10px;font-size:13px;color:#dfe7ef;font-weight:400}
.wv-gains li b{font-weight:700;color:#ffe08a;font-variant-numeric:tabular-nums;white-space:nowrap}
.wv-message{position:absolute;left:50%;top:20%;transform:translateX(-50%);padding:12px 18px;border-radius:14px;background:rgba(6,14,26,.88);border:1px solid rgba(255,255,255,.22);font-size:14px;max-width:min(440px,88vw);text-align:center;line-height:1.5;color:#fff}
.wv-message[hidden]{display:none}
.wv-ecran{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:20px;background:radial-gradient(120% 90% at 50% 40%,rgba(6,20,36,.7),rgba(2,6,12,.95));-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);z-index:5}
.wv-ecran[hidden]{display:none}
.wv-panneau{width:min(520px,100%);max-height:100%;overflow:auto;padding:28px 28px 24px;border-radius:20px;background:rgba(8,16,28,.84);border:1px solid rgba(255,255,255,.16);box-shadow:0 30px 80px rgba(0,0,0,.55);text-align:left}
.wv-sur{font-size:11px;font-weight:500;letter-spacing:.2em;text-transform:uppercase;color:#7fb8e8}
.wv-panneau h2{margin:8px 0 10px;font-size:26px;font-weight:700;letter-spacing:-.02em;line-height:1.15;color:#fff}
.wv-panneau p{margin:0 0 16px;font-size:14px;line-height:1.6;color:#c4ccd6;font-weight:300}
.wv-aide{list-style:none;margin:0 0 20px;padding:0;display:grid;gap:10px}
.wv-aide li{display:flex;align-items:center;gap:6px;font-size:13px;color:#c4ccd6;font-weight:300}
.wv-aide li span:last-child{margin-left:6px}
.wv-aide li.wv-texte{display:block;line-height:1.5}
.wv-aide b{color:#fff;font-weight:600}
.wv-actions{display:flex;gap:10px;flex-wrap:wrap}
.wv-cta{padding:12px 22px;border-radius:999px;border:1px solid transparent;background:#1489de;color:#fff;font:600 14px 'Public Sans',system-ui,sans-serif;cursor:pointer;transition:background .2s}
.wv-cta:hover{background:#2597ee}
.wv-cta.discret{background:transparent;border-color:rgba(255,255,255,.3);color:#dfe7ef}
.wv-cta.discret:hover{background:rgba(255,255,255,.08)}
.wv-charge{display:flex;align-items:center;gap:14px;color:#c4ccd6;font-size:14px}
.wv-charge i{width:22px;height:22px;border-radius:50%;border:3px solid rgba(255,255,255,.18);border-top-color:#4FB4FF;animation:wvTourne .9s linear infinite}
@keyframes wvTourne{to{transform:rotate(360deg)}}
.wv-tactile{position:absolute;inset:0;pointer-events:none}
.wv-tactile[hidden]{display:none}
.wv-joy{position:absolute;width:124px;height:124px;margin:-62px 0 0 -62px;border-radius:50%;border:2px solid rgba(255,255,255,.3);background:rgba(255,255,255,.07)}
.wv-joy[hidden]{display:none}
.wv-joy span{position:absolute;left:50%;top:50%;width:54px;height:54px;margin:-27px 0 0 -27px;border-radius:50%;background:rgba(255,255,255,.3);border:1px solid rgba(255,255,255,.5)}
.wv-action,.wv-reculer{position:absolute;pointer-events:auto;border:1px solid rgba(255,255,255,.35);color:#fff;font:700 15px 'Public Sans',system-ui,sans-serif;cursor:pointer;-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px)}
.wv-action{right:calc(24px + env(safe-area-inset-right,0px));bottom:calc(30px + env(safe-area-inset-bottom,0px));width:96px;height:96px;border-radius:50%;background:rgba(20,137,222,.85);box-shadow:0 8px 30px rgba(0,0,0,.45)}
.wv-reculer{right:calc(134px + env(safe-area-inset-right,0px));bottom:calc(46px + env(safe-area-inset-bottom,0px));height:52px;padding:0 18px;border-radius:999px;background:rgba(6,14,26,.75);font-size:13px;font-weight:600}
.wv-action[hidden],.wv-reculer[hidden]{display:none}
@media (max-width:760px){
  .wv-gains{display:none}
  .wv-carte{padding:9px 12px}
  .wv-long{display:none}
  .wv-etiquette{letter-spacing:.12em}
  .wv-pastilles{gap:4px;flex-wrap:nowrap}
  .wv-pastilles i{width:9px;height:9px}
  .wv-gagne{font-size:11px;white-space:nowrap}
  .wv-gain{top:21%}
  /* Les notifications du site ne doivent pas couvrir TIRER et Reculer :
     en jeu, elles se rangent sous les cartes du haut. */
  body.wv-en-jeu .notif-zone{top:calc(172px + env(safe-area-inset-top,0px));bottom:auto}
  .wv-panneau{padding:22px 20px 20px}
  .wv-panneau h2{font-size:22px}
}
@media (max-height:520px){
  .wv-haut-gauche .wv-carte:nth-child(2){display:none}
  body.wv-en-jeu .notif-zone{top:14px;bottom:auto;left:264px;right:170px;max-width:none}
}
@media (prefers-reduced-motion:reduce){
  .wv-gain.anim,.wv-plus.anim{animation:wvGainDoux 2.6s linear forwards}
  .wv-barre span{transition:none}
}
@keyframes wvGainDoux{0%{opacity:0}15%{opacity:1}80%{opacity:1}100%{opacity:0}}
`;

const HTML_JEU = `
<canvas class="wv-canvas" id="wvCanvas" tabindex="-1"></canvas>
<div class="wv-hud" id="wvHud">
  <div class="wv-haut-gauche">
    <div class="wv-carte">
      <div class="wv-ligne"><span class="wv-etiquette" id="wvNiveau">Niveau 1</span><span class="wv-valeur" id="wvXp">0 XP</span></div>
      <div class="wv-barre"><span id="wvBarre"></span></div>
    </div>
    <div class="wv-carte">
      <div class="wv-ligne"><span class="wv-etiquette">Tours<span class="wv-long"> du jour</span></span><span class="wv-valeur" id="wvTours">—</span></div>
      <div class="wv-pastilles" id="wvPastilles"></div>
      <div class="wv-gagne" id="wvGagne" hidden></div>
    </div>
  </div>
  <div class="wv-haut-droite">
    <button type="button" class="wv-bouton" id="wvSon" aria-label="Couper le son" title="Son (M)"></button>
    <button type="button" class="wv-bouton" id="wvPlein" aria-label="Plein écran" title="Plein écran (F)">${ICONES_UI.plein}</button>
    <button type="button" class="wv-bouton" id="wvQuitter" aria-label="Quitter la salle" title="Quitter la salle">${ICONES_UI.quitter}</button>
  </div>
  <div class="wv-viseur" id="wvViseur"></div>
  <div class="wv-invite" id="wvInvite" hidden></div>
  <div class="wv-gain" id="wvGain" aria-live="polite"></div>
  <div class="wv-plus" id="wvPlus"></div>
  <aside class="wv-gains wv-carte" id="wvGains" hidden></aside>
  <div class="wv-message" id="wvMessage" role="status" hidden></div>
</div>
<div class="wv-tactile" id="wvTactile" hidden>
  <div class="wv-joy" id="wvJoy" hidden><span id="wvPouce"></span></div>
  <button type="button" class="wv-action" id="wvAction" hidden>JOUER</button>
  <button type="button" class="wv-reculer" id="wvReculer" hidden>Reculer</button>
</div>
<div class="wv-ecran" id="wvEcran" hidden></div>
`;


/* ----------------------------------------------------------------------
   État du jeu
   ---------------------------------------------------------------------- */

let options = {};
let overlay = null;
let H = {};                       // éléments de l'interface

let renderer = null, scene = null, camera = null;
let pret = false;                 // la salle est construite
let actif = false;                // la salle est ouverte
let raf = 0, dernier = 0, temps = 0;
let ratioMax = 1.75, ratioActuel = 1, lentes = 0;

const R = {};                     // ressources partagées
const machines = [];
const colliders = [];
const animes = { poissons: [], bulles: null, bullesTubes: null, pieces: null, caustiques: [] };

const joueur = { x: 0, z: 10, yaw: 0, pitch: 0, phase: 0, vitesse: 0 };

const focus = { machine: null, cible: 0, t: 0 };

const etat = {
  ecran: null,                    // 'chargement' | 'depart' | 'pause' | 'connexion' | 'erreur'
  sansVerrou: false,              // le navigateur refuse le verrouillage du pointeur
  tactile: false,
  reduit: false,
  enTirage: false,
  cible: null,                    // ce que le joueur vise
  tours: null,                    // { restants, parJour, gagne }
  gains: null,
  glisse: false,
  attente: null                   // résultat reçu, pas encore annoncé
};

const touches = new Set();
const joy = { id: null, x0: 0, y0: 0, x: 0, y: 0 };
const regard = { id: null, x: 0, y: 0 };

const TOUCHES_JEU = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Space', 'ShiftLeft', 'ShiftRight', 'KeyE', 'KeyM', 'KeyF', 'Enter'
]);

const TOUCHES_MOUVEMENT = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown']);


/* ----------------------------------------------------------------------
   Chargement
   ---------------------------------------------------------------------- */

function webglDispo(){
  try{
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  }catch(e){
    return false;
  }
}

function chargerScript(url){
  return new Promise((ok, ko) => {
    const s = document.createElement('script');
    s.src = url;
    s.async = true;
    s.onload = ok;
    s.onerror = () => ko(new Error('chargement'));
    document.head.appendChild(s);
  });
}

async function assurerThree(){

  if(window.THREE){
    THREE = window.THREE;
    return;
  }

  for(const url of SOURCES_THREE){
    try{
      await chargerScript(url);
      if(window.THREE){
        THREE = window.THREE;
        return;
      }
    }catch(e){ /* on essaie la source suivante */ }
  }

  throw new Error("La bibliothèque 3D n'a pas pu être chargée. Vérifie ta connexion et réessaie.");
}

function chargerImage(src){
  return new Promise(ok => {
    if(!src) return ok(null);
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => ok(null);
    img.src = src;
  });
}

function injecterStyle(){
  if(document.getElementById('wv-style')) return;
  const s = document.createElement('style');
  s.id = 'wv-style';
  s.textContent = CSS;
  document.head.appendChild(s);
}

function construireOverlay(){

  if(overlay) return;

  overlay = document.createElement('div');
  overlay.className = 'wv-jeu';
  overlay.id = 'wvJeu';
  overlay.setAttribute('role', 'application');
  overlay.setAttribute('aria-label', "L'espace des waveurs");
  overlay.innerHTML = HTML_JEU;
  document.body.appendChild(overlay);

  const q = id => overlay.querySelector('#' + id);

  H = {
    canvas: q('wvCanvas'), niveau: q('wvNiveau'), xp: q('wvXp'), barre: q('wvBarre'),
    tours: q('wvTours'), pastilles: q('wvPastilles'), gagne: q('wvGagne'),
    son: q('wvSon'), plein: q('wvPlein'), quitter: q('wvQuitter'),
    viseur: q('wvViseur'), invite: q('wvInvite'), gain: q('wvGain'), plus: q('wvPlus'),
    gains: q('wvGains'), message: q('wvMessage'), ecran: q('wvEcran'),
    tactile: q('wvTactile'), joy: q('wvJoy'), pouce: q('wvPouce'),
    action: q('wvAction'), reculer: q('wvReculer')
  };

  H.son.addEventListener('click', basculerSon);
  H.plein.addEventListener('click', basculerPleinEcran);
  H.quitter.addEventListener('click', quitter);
  H.action.addEventListener('click', actionPrincipale);
  H.reculer.addEventListener('click', sortirFocus);

  majBoutonSon();
}


/* ----------------------------------------------------------------------
   Construction de la salle
   ---------------------------------------------------------------------- */

async function construireMonde(){

  const logoBrut = await chargerImage(options.logo);

  // Les textures écrivent avec la police du site : elle doit être là.
  try{
    if(document.fonts && document.fonts.load){
      await Promise.all([
        document.fonts.load('700 48px "Public Sans"'),
        document.fonts.load('600 24px "Public Sans"'),
        document.fonts.load('500 22px "Public Sans"')
      ]);
    }
  }catch(e){ /* la police de secours fera l'affaire */ }

  R.logo = logoRogne(logoBrut);

  renderer = new THREE.WebGLRenderer({
    canvas: H.canvas,
    antialias: true,
    powerPreference: 'high-performance'
  });

  ratioMax = Math.min(window.devicePixelRatio || 1, etat.tactile ? 1.5 : 1.75);
  ratioActuel = ratioMax;
  renderer.setPixelRatio(ratioActuel);

  H.canvas.addEventListener('webglcontextlost', e => {
    e.preventDefault();
    montrerEcran('erreur', "Le rendu 3D a été interrompu par ton navigateur. Quitte la salle et rentre à nouveau.");
  });

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x041220);
  scene.fog = new THREE.FogExp2(0x061a2c, 0.021);

  camera = new THREE.PerspectiveCamera(70, 1, 0.1, 70);
  camera.rotation.order = 'YXZ';

  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  R.texture = (canvas, opt) => {
    const o = opt || {};
    const t = new THREE.CanvasTexture(canvas);
    t.anisotropy = aniso;
    if(o.repete){
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(o.rx || 1, o.ry || 1);
    }
    return t;
  };

  R_OR = new THREE.Color(0xffd24d);

  // Matériaux et textures communs.
  const tuiles = {};
  SYMBOLES.forEach(id => { tuiles[id] = tuileDroite(id, R.logo); });
  R.tuiles = tuiles;

  R.matRouleaux = BANDES.map(ordre => {
    const t = R.texture(creerBande(ordre, tuiles));
    t.wrapS = THREE.RepeatWrapping;
    return new THREE.MeshStandardMaterial({
      map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 0.62,
      roughness: 0.4, metalness: 0
    });
  });

  R.matCorps = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.25 });

  R.matVitre = new THREE.MeshBasicMaterial({
    map: R.texture(creerVitre(true)), transparent: true, depthWrite: false
  });

  R.matLevier = new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 90, specular: 0x888888 });

  const halo = R.texture(creerHalo());
  R.matLampes = new THREE.PointsMaterial({
    size: 0.06, map: halo, vertexColors: true, transparent: true,
    depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true
  });

  R.modele = construireModeleMachine();
  R.halo = halo;

  construireSalle();
  construireMachines();
  construireAmbiance();

  pret = true;
  redimensionner();
}

function construireSalle(){

  const L = SALLE.l, P = SALLE.p, Ht = SALLE.h;

  // ---- Lumières ----
  scene.add(new THREE.HemisphereLight(0x8fd8ff, 0x0a1e33, 0.78));

  [[-3.4, 4.0, -7.5, 0x4FB4FF], [3.4, 4.0, -7.5, 0x4FB4FF],
   [-3.4, 4.0, -0.5, 0x3fd0ff], [3.4, 4.0, -0.5, 0x3fd0ff],
   [0, 3.6, 8.5, 0x7fd6ff]].forEach(([x, y, z, c]) => {
    const l = new THREE.PointLight(c, 0.85, 15, 1.4);
    l.position.set(x, y, z);
    scene.add(l);
  });

  // ---- Sol ----
  const sol = new THREE.Mesh(
    new THREE.PlaneGeometry(L * 2, P * 2),
    new THREE.MeshStandardMaterial({
      map: R.texture(creerMoquette(), { repete: true, rx: L * 2 / 2, ry: P * 2 / 2 }),
      roughness: 0.92, metalness: 0
    })
  );
  sol.rotation.x = -Math.PI / 2;
  scene.add(sol);

  const tapis = new THREE.Mesh(
    new THREE.PlaneGeometry(4.6, 13),
    new THREE.MeshStandardMaterial({
      map: R.texture(creerTapis(R.logo)), roughness: 0.85, metalness: 0
    })
  );
  tapis.rotation.x = -Math.PI / 2;
  tapis.position.set(0, 0.006, -4);
  scene.add(tapis);

  // ---- Plafond ----
  const plafond = new THREE.Mesh(
    new THREE.PlaneGeometry(L * 2, P * 2),
    new THREE.MeshBasicMaterial({ color: 0x030c16 })
  );
  plafond.rotation.x = Math.PI / 2;
  plafond.position.y = Ht;
  scene.add(plafond);

  // ---- Murs ----
  const texMur = (largeur) => R.texture(creerMur(), { repete: true, rx: largeur / 2, ry: 1 });

  const mur = (l, x, y, z, rotY) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(l, Ht),
      new THREE.MeshLambertMaterial({ map: texMur(l) })
    );
    m.position.set(x, y, z);
    m.rotation.y = rotY;
    scene.add(m);
  };

  mur(L * 2, 0, Ht / 2, -P, 0);
  mur(L * 2, 0, Ht / 2, P, Math.PI);
  mur(P * 2, -L, Ht / 2, 0, Math.PI / 2);
  mur(P * 2, L, Ht / 2, 0, -Math.PI / 2);

  // ---- Néons : plafonniers, corniche, plinthe ----
  const lumieres = [];
  [-3.2, 0, 3.2].forEach(x => lumieres.push(boite(0.26, 0.05, 21, x, Ht - 0.03, 0, '#8fe6ff')));
  [-1, 1].forEach(s => {
    lumieres.push(boite(0.05, 0.06, P * 2 - 0.4, s * (L - 0.05), 4.25, 0, '#3fb8ff'));
    lumieres.push(boite(0.04, 0.05, P * 2 - 0.4, s * (L - 0.04), 0.09, 0, '#2de2e6'));
  });
  lumieres.push(boite(L * 2 - 0.4, 0.06, 0.05, 0, 4.25, -P + 0.05, '#3fb8ff'));

  scene.add(new THREE.Mesh(
    fusionner(lumieres),
    new THREE.MeshBasicMaterial({ vertexColors: true })
  ));

  // Une vague de néon au-dessus des machines.
  const texNeon = creerNeonVague('#4FB4FF');
  [-1, 1].forEach(s => {
    const t = R.texture(texNeon, { repete: true, rx: 3.6, ry: 1 });
    const p = new THREE.Mesh(
      new THREE.PlaneGeometry(P * 2 - 1, 0.55),
      new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false })
    );
    p.position.set(s * (L - 0.02), 3.05, 0);
    p.rotation.y = s * -Math.PI / 2;
    scene.add(p);
  });

  // ---- Le fond de la salle : aquarium, enseigne et logo ----
  construireFond();

  // ---- La porte de sortie ----
  construirePorte();

  // ---- Les tubes à bulles ----
  construireTubes();

  // ---- Les murs sont des obstacles ----
  // (les bords de la salle sont gérés à part, dans libre())
}

function construireFond(){

  const P = SALLE.p;

  // L'aquarium : un fond peint, des poissons, une vitre.
  const zA = -P + 0.08;

  const eau = new THREE.Mesh(
    new THREE.PlaneGeometry(8.4, 2.0),
    new THREE.MeshBasicMaterial({ map: R.texture(creerAquarium()) })
  );
  eau.position.set(0, 1.4, zA);
  scene.add(eau);

  const poissonTex = R.texture(creerPoissonTex());
  const couleurs = [0xff9f43, 0x22d3ee, 0xfacc15, 0xff6b81, 0xffffff, 0x8b6bff, 0x7dd3fc, 0xff8a5c];

  for(let i = 0; i < 14; i++){

    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: poissonTex, color: couleurs[i % couleurs.length], transparent: true,
      depthWrite: false, fog: false
    }));

    const echelle = hasard(0.3, 0.62);
    const dir = Math.random() < 0.5 ? -1 : 1;

    s.position.set(hasard(-3.9, 3.9), hasard(0.65, 2.2), zA + 0.03 + Math.random() * 0.12);
    s.scale.set(echelle * 2 * dir, echelle, 1);

    scene.add(s);

    animes.poissons.push({
      s, dir, echelle,
      vitesse: hasard(0.18, 0.55),
      y0: s.position.y,
      phase: hasard(0, TAU)
    });
  }

  // La vitre et son cadre.
  const vitre = new THREE.Mesh(
    new THREE.PlaneGeometry(8.4, 2.0),
    new THREE.MeshBasicMaterial({
      map: R.texture(creerVitre(false)), transparent: true, opacity: 0.55, depthWrite: false
    })
  );
  vitre.position.set(0, 1.4, zA + 0.16);
  vitre.renderOrder = 2;
  scene.add(vitre);

  const cadre = fusionner([
    boite(8.7, 0.16, 0.3, 0, 0.32, zA + 0.05, '#0d2036'),
    boite(8.7, 0.16, 0.3, 0, 2.48, zA + 0.05, '#0d2036'),
    boite(0.16, 2.3, 0.3, -4.28, 1.4, zA + 0.05, '#0d2036'),
    boite(0.16, 2.3, 0.3, 4.28, 1.4, zA + 0.05, '#0d2036'),
    boite(8.4, 0.05, 0.08, 0, 0.25, zA + 0.16, '#4FB4FF'),
    boite(8.4, 0.05, 0.08, 0, 2.55, zA + 0.16, '#4FB4FF')
  ]);
  scene.add(new THREE.Mesh(cadre, new THREE.MeshBasicMaterial({ vertexColors: true })));

  // Enseigne et logo, au-dessus.
  const enseigne = new THREE.Mesh(
    new THREE.PlaneGeometry(7.4, 0.9),
    new THREE.MeshBasicMaterial({
      map: R.texture(creerEnseigne("L'ESPACE DES WAVEURS", '#4FB4FF', 1600, 194, 112)),
      transparent: true, depthWrite: false
    })
  );
  enseigne.position.set(0, 2.98, -P + 0.04);
  scene.add(enseigne);

  if(R.logo){

    const ratio = R.logo.width / R.logo.height;
    const h = 1.15, l = h * ratio;

    const lumiere = new THREE.Mesh(
      new THREE.PlaneGeometry(l * 2.1, h * 2.6),
      new THREE.MeshBasicMaterial({
        map: R.halo, color: 0x2a8fd8, transparent: true, opacity: 0.55,
        depthWrite: false, blending: THREE.AdditiveBlending
      })
    );
    lumiere.position.set(0, 3.9, -P + 0.03);
    scene.add(lumiere);

    const logo = new THREE.Mesh(
      new THREE.PlaneGeometry(l, h),
      new THREE.MeshBasicMaterial({
        map: R.texture(R.logo), transparent: true, depthWrite: false
      })
    );
    logo.position.set(0, 3.9, -P + 0.04);
    scene.add(logo);
  }
}

function construirePorte(){

  const P = SALLE.p;
  const z = P - 0.05;

  const porte = fusionner([
    boite(1.2, 2.5, 0.08, -0.63, 1.25, z, '#0d3550'),
    boite(1.2, 2.5, 0.08, 0.63, 1.25, z, '#0d3550'),
    boite(2.7, 0.14, 0.14, 0, 2.6, z, '#1a4a6e'),
    boite(0.14, 2.6, 0.14, -1.28, 1.3, z, '#1a4a6e'),
    boite(0.14, 2.6, 0.14, 1.28, 1.3, z, '#1a4a6e'),
    boite(0.05, 0.9, 0.06, -0.12, 1.1, z - 0.06, '#c9d6e2'),
    boite(0.05, 0.9, 0.06, 0.12, 1.1, z - 0.06, '#c9d6e2')
  ]);

  scene.add(new THREE.Mesh(porte, new THREE.MeshLambertMaterial({ vertexColors: true })));

  const panneau = new THREE.Mesh(
    new THREE.PlaneGeometry(1.7, 0.42),
    new THREE.MeshBasicMaterial({
      map: R.texture(creerEnseigne('SORTIE', '#3ef0b0', 512, 128, 72)),
      transparent: true, depthWrite: false
    })
  );
  panneau.position.set(0, 3.0, z - 0.02);
  panneau.rotation.y = Math.PI;
  scene.add(panneau);

  R.porte = { x: 0, z: P - 0.6 };
}

function construireTubes(){

  const positions = [[-2.6, 3.4], [2.6, 3.4], [-2.6, -6.6], [2.6, -6.6]];

  const verre = new THREE.MeshBasicMaterial({
    color: 0x6fd8ff, transparent: true, opacity: 0.14, side: THREE.DoubleSide, depthWrite: false
  });

  const metal = new THREE.MeshStandardMaterial({ color: 0x1a3a58, roughness: 0.45, metalness: 0.4 });

  positions.forEach(([x, z]) => {

    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 4.2, 28, 1, true), verre);
    tube.position.set(x, 2.3, z);
    tube.renderOrder = 2;
    scene.add(tube);

    const socle = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.56, 0.2, 28), metal);
    socle.position.set(x, 0.1, z);
    scene.add(socle);

    const chapeau = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.46, 0.2, 28), metal);
    chapeau.position.set(x, 4.4, z);
    scene.add(chapeau);

    colliders.push({ x0: x - 0.5, x1: x + 0.5, z0: z - 0.5, z1: z + 0.5 });
  });

  // Les bulles des tubes : un seul nuage pour les quatre.
  const n = 200;
  const pos = new Float32Array(n * 3);
  const donnees = [];

  for(let i = 0; i < n; i++){
    const t = positions[i % positions.length];
    const a = Math.random() * TAU;
    const r = Math.random() * 0.3;
    donnees.push({ cx: t[0], cz: t[1], a, r, v: hasard(0.35, 0.9), y: hasard(0.3, 4.3) });
    pos[i * 3] = t[0] + Math.cos(a) * r;
    pos[i * 3 + 1] = donnees[i].y;
    pos[i * 3 + 2] = t[1] + Math.sin(a) * r;
  }

  animes.bullesTubes = { pos, donnees, points: nuageBulles(pos, 0.11) };
}

// Un nuage de points en forme de bulles.
function nuageBulles(pos, taille){

  if(!R.matBulles){
    R.matBulles = new THREE.PointsMaterial({
      size: taille, map: R.texture(creerBulleTex()), transparent: true, opacity: 0.85,
      depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true
    });
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));

  const mat = R.matBulles.clone();
  mat.size = taille;

  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 3;
  scene.add(pts);

  return pts;
}

function construireMachines(){

  const ombres = [];

  const ajouterOmbre = (x, z, l, p) => {
    const g = new THREE.PlaneGeometry(l, p);
    g.rotateX(-Math.PI / 2);
    g.translate(x, 0.011, z);
    ombres.push(g);
  };

  let i = 0;

  [-1, 1].forEach(cote => {

    RANGEES_Z.forEach(z => {

      const def = MACHINES[i++];

      // Le dos contre le mur, la face vers l'allée : la machine de gauche
      // regarde vers +x, celle de droite vers -x.
      const x = cote * (SALLE.l - 0.1 - 0.45);
      const rotY = cote === -1 ? Math.PI / 2 : -Math.PI / 2;

      const m = new Machine(def, x, z, rotY, R);

      scene.add(m.groupe);
      machines.push(m);
      colliders.push(m.collision);

      ajouterOmbre(x - cote * 0.05, z, 1.9, 1.7);

      m.surArret = () => Son.arret();
    });
  });

  animes.machines = machines;

  // Ombres au sol de toutes les machines et des tubes, en un seul objet.
  [[-2.6, 3.4], [2.6, 3.4], [-2.6, -6.6], [2.6, -6.6]].forEach(([x, z]) => ajouterOmbre(x, z, 1.7, 1.7));

  const g = fusionner(ombres);

  scene.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({
    map: R.texture(creerOmbre()), transparent: true, depthWrite: false
  })));
}

function construireAmbiance(){

  // Des bulles dans toute la salle : discrètes, mais elles rendent l'air
  // liquide.
  const n = 220;
  const pos = new Float32Array(n * 3);
  const v = new Float32Array(n);

  for(let i = 0; i < n; i++){
    pos[i * 3] = hasard(-SALLE.l + 0.6, SALLE.l - 0.6);
    pos[i * 3 + 1] = hasard(0, SALLE.h);
    pos[i * 3 + 2] = hasard(-SALLE.p + 0.6, SALLE.p - 0.6);
    v[i] = hasard(0.1, 0.32);
  }

  animes.bulles = { pos, v, points: nuageBulles(pos, 0.07) };

  // Les reflets de l'eau sur le sol : deux couches qui glissent en sens
  // contraires.
  const caust = creerCaustiques(256);

  [[3.4, 5.6, 0.018, 0.012], [2.2, 3.8, -0.014, 0.02]].forEach(([rx, ry, vx, vy], k) => {

    const t = R.texture(caust, { repete: true, rx, ry });

    const p = new THREE.Mesh(
      new THREE.PlaneGeometry(SALLE.l * 2, SALLE.p * 2),
      new THREE.MeshBasicMaterial({
        map: t, color: 0x5fd6ff, transparent: true, opacity: 0.2 - k * 0.04,
        blending: THREE.AdditiveBlending, depthWrite: false
      })
    );

    p.rotation.x = -Math.PI / 2;
    p.position.y = 0.016 + k * 0.002;
    p.renderOrder = 1;
    scene.add(p);

    animes.caustiques.push({ t, vx, vy });
  });

  // Les pièces qui jaillissent d'une machine gagnante.
  const nP = 90;
  const posP = new Float32Array(nP * 3).fill(-10);

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(posP, 3));

  const pts = new THREE.Points(g, new THREE.PointsMaterial({
    size: 0.08, map: R.texture(creerPieceTex()), transparent: true, depthWrite: false,
    sizeAttenuation: true
  }));
  pts.frustumCulled = false;
  pts.renderOrder = 5;
  scene.add(pts);

  animes.pieces = {
    n: nP, pos: posP, vel: new Float32Array(nP * 3), vie: new Float32Array(nP), points: pts
  };
}


/* ----------------------------------------------------------------------
   Déplacement et collisions
   ---------------------------------------------------------------------- */

function libre(x, z){

  const r = JOUEUR.rayon;

  if(x < -SALLE.l + r || x > SALLE.l - r || z < -SALLE.p + r || z > SALLE.p - r) return false;

  for(let i = 0; i < colliders.length; i++){
    const b = colliders[i];
    if(x > b.x0 - r && x < b.x1 + r && z > b.z0 - r && z < b.z1 + r) return false;
  }

  return true;
}

// Chaque axe est essayé à part : contre un mur, on glisse au lieu de
// s'arrêter net.
function deplacer(dx, dz){
  if(libre(joueur.x + dx, joueur.z)) joueur.x += dx;
  if(libre(joueur.x, joueur.z + dz)) joueur.z += dz;
}

function regarder(dyaw, dpitch){
  joueur.yaw += dyaw;
  joueur.pitch = clamp(joueur.pitch + dpitch, -1.25, 1.25);
}


/* ----------------------------------------------------------------------
   Ce que le joueur vise
   ---------------------------------------------------------------------- */

function viser(){

  const fx = -Math.sin(joueur.yaw), fz = -Math.cos(joueur.yaw);

  let meilleure = null;
  let score = -Infinity;

  machines.forEach(m => {

    const dx = m.centre.x - joueur.x, dz = m.centre.z - joueur.z;
    const d = Math.hypot(dx, dz);

    if(d > PORTEE + 0.5 || d < 0.05) return;

    // Il faut être du côté du clavier, pas derrière la machine.
    const cote = (joueur.x - m.centre.x) * m.normale.x + (joueur.z - m.centre.z) * m.normale.z;
    if(cote < 0.3) return;

    const c = (dx * fx + dz * fz) / d;
    if(c < 0.72) return;

    const s = c - d * 0.08;
    if(s > score){ score = s; meilleure = m; }
  });

  if(meilleure) return { type: 'machine', machine: meilleure };

  // La porte, derrière le point de départ.
  if(R.porte){
    const dx = R.porte.x - joueur.x, dz = R.porte.z + 0.6 - joueur.z;
    const d = Math.hypot(dx, dz);
    if(d < 3.2 && d > 0.05 && (dx * fx + dz * fz) / d > 0.6){
      return { type: 'porte' };
    }
  }

  return null;
}


/* ----------------------------------------------------------------------
   Mode « assis devant la machine »
   ---------------------------------------------------------------------- */

function entrerFocus(machine){
  if(focus.cible === 1) return;
  focus.machine = machine;
  focus.cible = 1;
  Son.clic();
  afficherGains(true);
}

function sortirFocus(){
  if(focus.cible === 0 || etat.enTirage) return;
  focus.cible = 0;
  afficherGains(false);
}


/* ----------------------------------------------------------------------
   Tirer le levier
   ---------------------------------------------------------------------- */

function actionPrincipale(){

  if(!actif || etat.ecran) return;

  // En cours de transition, on attend d'être arrivé.
  if(focus.cible === 1 && focus.t > 0.9){
    tirer(focus.machine);
    return;
  }

  if(focus.cible === 1) return;

  const cible = etat.cible || viser();

  if(!cible) return;

  if(cible.type === 'porte'){
    quitter();
    return;
  }

  entrerFocus(cible.machine);
}

async function tirer(machine){

  if(etat.enTirage || !machine) return;

  if(!options.connecte || !options.connecte()){
    demanderConnexion();
    return;
  }

  // Le compteur est chargé à l'ouverture ; s'il manque, on va le chercher.
  if(!etat.tours) await chargerEtat();

  if(etat.tours && etat.tours.restants <= 0){
    Son.erreur();
    afficherMessage("Tu as joué tous tes tours d'aujourd'hui. Reviens demain !", 3400);
    machine.ecrire('À DEMAIN', 'plus de tours aujourd\'hui', '#9fb0c2');
    return;
  }

  etat.enTirage = true;
  effacerGain();

  machine.ecrire('...', 'les rouleaux tournent', machine.def.couleur);
  machine.lancer();
  Son.levier();
  ticsRouleaux(machine);

  const debut = performance.now();

  let res;

  try{
    res = await options.tourner(machine.def.id);
  }catch(e){
    // La base a refusé ou n'a pas répondu : aucun tour n'a été compté.
    machine.abandonner();
    await attendre(1100);
    etat.enTirage = false;
    Son.erreur();
    machine.ecrire('OUPS', 'réessaie', '#ff8a8a');
    afficherMessage(e && e.message ? e.message : 'Le tirage a échoué.', 3600);
    await chargerEtat();
    return;
  }

  // Les rouleaux tournent au moins une seconde et demie : un résultat
  // instantané gâcherait le suspense.
  await attendre(Math.max(0, 1500 - (performance.now() - debut)));

  if(!actif){
    // La salle a été quittée pendant le tirage : le gain est déjà en base.
    if(options.apresTirage) options.apresTirage(res);
    etat.enTirage = false;
    return;
  }

  etat.attente = res;

  // Les rouleaux s'arrêtent l'un après l'autre.
  for(let i = 0; i < 3; i++){
    machine.arreter(i, res.symboles[i]);
    await attendre(i < 2 ? 620 : 0);
  }

  // Attendre que le dernier soit immobile.
  while(machine.rouleaux.some(r => r.etat !== 'repos') && actif){
    await attendre(60);
  }

  await attendre(260);

  annoncerResultat(machine, res);

  etat.tours = {
    restants: res.tours_restants,
    parJour: res.tours_par_jour,
    gagne: ((etat.tours && etat.tours.gagne) || 0) + (res.gain || 0)
  };

  etat.attente = null;
  etat.enTirage = false;

  if(options.apresTirage) options.apresTirage(res);

  majHud();
}

// Le bruit des rouleaux : un tic-tic qui s'accélère et se calme avec eux.
function ticsRouleaux(machine){
  const boucle = () => {
    if(!machine.tourne || !actif) return;
    Son.tic();
    setTimeout(boucle, 75);
  };
  boucle();
}

function annoncerResultat(machine, res){

  const xp = res.gain || 0;
  const jackpot = res.motif === 'trio' && res.symbole === 'logo';

  if(xp > 0){

    machine.gagner(jackpot);

    machine.ecrire(
      jackpot ? 'JACKPOT !' : '+' + xp + ' XP',
      jackpot ? '+' + xp + ' XP' : res.nom,
      jackpot ? '#ffe08a' : '#7dffb2'
    );

    afficherGain(xp, jackpot ? 'jackpot' : res.nom);

    if(jackpot) Son.jackpot();
    else Son.gain(Math.min(4, Math.floor(xp / 5)));

    jaillir(machine, jackpot ? 60 : Math.min(28, 8 + xp));

  } else {
    machine.ecrire('PAS CETTE FOIS', 'retente ta chance', '#9fb0c2');
    Son.rate();
  }
}

// Des pièces qui sortent du bac de la machine.
function jaillir(machine, nombre){

  const P = animes.pieces;
  if(!P) return;

  const origine = new THREE.Vector3(0, 0.5, 0.55);
  machine.groupe.localToWorld(origine);

  const nx = machine.normale.x, nz = machine.normale.z;

  let restant = nombre;

  for(let i = 0; i < P.n && restant > 0; i++){

    if(P.vie[i] > 0) continue;

    // Elles retombent devant la machine : lancées plus fort, elles
    // passaient à quelques centimètres de la caméra et devenaient énormes.
    const a = hasard(-0.9, 0.9);
    const v = hasard(0.4, 1.4);

    P.pos[i * 3] = origine.x;
    P.pos[i * 3 + 1] = origine.y;
    P.pos[i * 3 + 2] = origine.z;

    P.vel[i * 3] = (nx * Math.cos(a) - nz * Math.sin(a)) * v;
    P.vel[i * 3 + 1] = hasard(2.4, 4.6);
    P.vel[i * 3 + 2] = (nz * Math.cos(a) + nx * Math.sin(a)) * v;

    P.vie[i] = hasard(1.2, 2.0);
    restant--;
  }
}


/* ----------------------------------------------------------------------
   Données : tours, XP, gains
   ---------------------------------------------------------------------- */

async function chargerEtat(){

  if(!options.connecte || !options.connecte() || !options.etat){
    etat.tours = null;
    majHud();
    return;
  }

  try{
    const e = await options.etat();
    if(e){
      etat.tours = {
        restants: e.tours_restants,
        parJour: e.tours_par_jour,
        gagne: e.gagne_aujourdhui || 0
      };
    }
  }catch(err){
    // Sans le compteur, on laisse quand même essayer : c'est la base qui
    // décide, l'affichage n'est qu'un confort.
    etat.tours = null;
  }

  majHud();
}

async function chargerGains(){

  if(etat.gains || !options.gains) return;

  try{
    etat.gains = await options.gains();
  }catch(e){
    etat.gains = null;
  }
}


/* ----------------------------------------------------------------------
   Interface : mise à jour
   ---------------------------------------------------------------------- */

function majBoutonSon(){
  if(!H.son) return;
  const on = Son.estActif();
  H.son.innerHTML = on ? ICONES_UI.son : ICONES_UI.muet;
  H.son.setAttribute('aria-label', on ? 'Couper le son' : 'Remettre le son');
}

function basculerSon(){
  Son.init();
  Son.reprendre();
  Son.regler(!Son.estActif());
  majBoutonSon();
}

function basculerPleinEcran(){

  const el = overlay;
  if(!el) return;

  if(document.fullscreenElement || document.webkitFullscreenElement){
    (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    return;
  }

  const demande = el.requestFullscreen || el.webkitRequestFullscreen;
  if(demande){
    try{
      const p = demande.call(el);
      if(p && p.catch) p.catch(() => {});
    }catch(e){ /* refusé */ }
  }
}

function majHud(){

  if(!H.niveau) return;

  const u = options.utilisateur ? options.utilisateur() : null;

  if(u){
    const niveau = Math.floor((u.xp || 0) / 100) + 1;
    H.niveau.textContent = 'Niveau ' + niveau;
    H.xp.textContent = (u.xp || 0) + ' XP';
    H.barre.style.width = ((u.xp || 0) % 100) + '%';
  } else {
    H.niveau.textContent = 'Visiteur';
    H.xp.textContent = 'non connecté';
    H.barre.style.width = '0%';
  }

  const t = etat.tours;

  H.pastilles.innerHTML = '';

  if(t){
    const total = t.parJour;
    const restants = clamp(t.restants, 0, total);
    H.tours.textContent = restants + ' / ' + total;
    for(let i = 0; i < total; i++){
      const p = document.createElement('i');
      if(i < restants) p.className = 'on';
      H.pastilles.appendChild(p);
    }
    H.gagne.hidden = !(t.gagne > 0);
    H.gagne.textContent = 'Aujourd’hui : +' + t.gagne + ' XP';
  } else {
    H.tours.textContent = u ? '—' : 'connecte-toi';
    H.gagne.hidden = true;
  }
}

function afficherMessage(texte, duree){

  H.message.textContent = texte;
  H.message.hidden = false;

  clearTimeout(afficherMessage.minuteur);
  afficherMessage.minuteur = setTimeout(() => { H.message.hidden = true; }, duree || 2800);
}

// Un gain ordinaire s'affiche en petit, près de la jauge d'XP : l'écran de
// la machine, juste devant les yeux, dit déjà tout, et un grand « +5 XP »
// posé par-dessus se superposait à son propre texte. Le grand affichage
// est gardé pour le jackpot, qui mérite qu'on l'entende de loin.
function afficherGain(xp, legende){

  const el = legende === 'jackpot' ? H.gain : H.plus;

  if(legende === 'jackpot'){
    el.innerHTML = '';
    el.appendChild(document.createTextNode('+' + xp + ' XP'));
    const s = document.createElement('small');
    s.textContent = 'jackpot';
    el.appendChild(s);
  } else {
    el.textContent = '+' + xp + ' XP';
  }

  el.classList.remove('anim');
  void el.offsetWidth;    // relance l'animation
  el.classList.add('anim');
}

function effacerGain(){
  H.gain.classList.remove('anim');
  H.plus.classList.remove('anim');
}

function libelleCombinaison(g){
  const nom = g.symbole ? NOMS_SYMBOLES[g.symbole] : null;
  if(g.motif === 'trio') return nom ? '3 × ' + nom : '3 symboles identiques';
  if(g.motif === 'paire') return nom ? '2 × ' + nom : '2 symboles identiques';
  return g.nom;
}

async function afficherGains(voir){

  if(!voir){
    H.gains.hidden = true;
    return;
  }

  await chargerGains();

  if(!etat.gains || focus.cible !== 1) return;

  const lignes = etat.gains
    .filter(g => g.motif !== 'rien' && g.xp > 0)
    .sort((a, b) => b.xp - a.xp)
    .map(g => '<li><span></span><b>+' + g.xp + ' XP</b></li>');

  if(!lignes.length) return;

  H.gains.innerHTML = '<h3>Combinaisons</h3><ul></ul>';

  const ul = H.gains.querySelector('ul');

  etat.gains
    .filter(g => g.motif !== 'rien' && g.xp > 0)
    .sort((a, b) => b.xp - a.xp)
    .forEach(g => {
      const li = document.createElement('li');
      const nom = document.createElement('span');
      nom.textContent = libelleCombinaison(g);
      const val = document.createElement('b');
      val.textContent = '+' + g.xp + ' XP';
      li.appendChild(nom);
      li.appendChild(val);
      ul.appendChild(li);
    });

  H.gains.hidden = false;
}

function majInvite(){

  const c = etat.cible;

  let texte = '';

  if(etat.ecran){
    texte = '';
  } else if(focus.cible === 1){

    if(focus.t > 0.9 && !etat.enTirage){
      texte = etat.tactile
        ? ''
        : '<span class="wv-touche">E</span> ou clic <small>tirer le levier</small> &nbsp;·&nbsp; <span class="wv-touche">S</span> <small>reculer</small>';
    }

  } else if(c){

    if(c.type === 'porte'){
      texte = etat.tactile ? '' : '<span class="wv-touche">E</span> Quitter la salle';
    } else {
      const nom = c.machine.def.nom;
      texte = etat.tactile ? '' : '<span class="wv-touche">E</span> Jouer sur ' + nom;
    }
  }

  if(texte !== majInvite.dernier){
    majInvite.dernier = texte;
    H.invite.innerHTML = texte;
    H.invite.hidden = !texte;
  }

  H.viseur.classList.toggle('actif', !!c && focus.cible === 0);
  H.viseur.classList.toggle('cache', focus.cible === 1);

  if(etat.tactile){

    const enFocus = focus.cible === 1 && focus.t > 0.9;

    H.action.hidden = etat.ecran || !(c || enFocus);
    H.reculer.hidden = etat.ecran || !enFocus || etat.enTirage;

    if(!H.action.hidden){
      H.action.textContent = enFocus
        ? 'TIRER'
        : (c && c.type === 'porte' ? 'SORTIR' : 'JOUER');
    }
  }
}


/* ----------------------------------------------------------------------
   Écrans : chargement, départ, pause, connexion, erreur
   ---------------------------------------------------------------------- */

function montrerEcran(type, texte){

  etat.ecran = type;

  if(!type){
    H.ecran.hidden = true;
    H.ecran.innerHTML = '';
    return;
  }

  const enTete = '<span class="wv-sur">L’espace des waveurs</span>';

  let html = '';

  if(type === 'chargement'){

    html = '<div class="wv-panneau"><div class="wv-charge"><i></i><span>Chargement de la salle…</span></div></div>';

  } else if(type === 'depart'){

    const parJour = etat.tours ? etat.tours.parJour : 10;

    const aide = etat.tactile
      ? '<li class="wv-texte">Glisse le pouce à gauche pour avancer, à droite pour regarder.</li>' +
        '<li class="wv-texte">Approche-toi d’une machine, touche <b>JOUER</b>, puis <b>TIRER</b>.</li>'
      : '<li><span class="wv-touche">Z</span><span class="wv-touche">Q</span><span class="wv-touche">S</span><span class="wv-touche">D</span><span>ou les flèches : se déplacer</span></li>' +
        '<li><span class="wv-touche">Souris</span><span>regarder autour de soi</span></li>' +
        '<li><span class="wv-touche">E</span><span>ou clic : jouer, tirer le levier</span></li>' +
        '<li><span class="wv-touche">Maj</span><span>courir &nbsp;·&nbsp;</span><span class="wv-touche">Échap</span><span>pause</span></li>';

    html = '<div class="wv-panneau">' + enTete +
      '<h2>Bienvenue dans la salle</h2>' +
      '<p>Chaque jour, tu as ' + parJour + ' tours offerts. Une machine peut te rapporter de l’XP ; ' +
      'un alignement de logos La Wave, beaucoup plus. Rien ne s’achète, tout se gagne en jouant.</p>' +
      '<ul class="wv-aide">' + aide + '</ul>' +
      '<div class="wv-actions">' +
      '<button type="button" class="wv-cta" id="wvEntrer">' + (etat.tactile ? 'Toucher pour entrer' : 'Cliquer pour entrer') + '</button>' +
      '<button type="button" class="wv-cta discret" id="wvSortir">Retour au site</button>' +
      '</div></div>';

  } else if(type === 'pause'){

    html = '<div class="wv-panneau">' + enTete +
      '<h2>Pause</h2>' +
      '<p>La salle t’attend. Tes tours et ton XP sont enregistrés à chaque tirage.</p>' +
      '<div class="wv-actions">' +
      '<button type="button" class="wv-cta" id="wvEntrer">Reprendre</button>' +
      '<button type="button" class="wv-cta discret" id="wvSortir">Quitter la salle</button>' +
      '</div></div>';

  } else if(type === 'connexion'){

    html = '<div class="wv-panneau">' + enTete +
      '<h2>Connecte-toi pour jouer</h2>' +
      '<p>Tu peux te promener dans la salle sans compte. Pour tirer le levier et gagner de l’XP, il faut un compte La Wave : ' +
      'c’est gratuit, et tes tours du jour t’attendent.</p>' +
      '<div class="wv-actions">' +
      '<button type="button" class="wv-cta" id="wvConnexion">Se connecter</button>' +
      '<button type="button" class="wv-cta discret" id="wvEntrer">Continuer la visite</button>' +
      '</div></div>';

  } else if(type === 'erreur'){

    html = '<div class="wv-panneau">' + enTete +
      '<h2>La salle n’a pas pu s’ouvrir</h2>' +
      '<p id="wvErreurTexte"></p>' +
      '<div class="wv-actions"><button type="button" class="wv-cta" id="wvSortir">Retour au site</button></div></div>';
  }

  H.ecran.innerHTML = html;
  H.ecran.hidden = false;

  const t = H.ecran.querySelector('#wvErreurTexte');
  if(t) t.textContent = texte || '';

  const entrer = H.ecran.querySelector('#wvEntrer');
  const sortir = H.ecran.querySelector('#wvSortir');
  const connexion = H.ecran.querySelector('#wvConnexion');

  if(entrer) entrer.addEventListener('click', reprendre);
  if(sortir) sortir.addEventListener('click', quitter);
  if(connexion) connexion.addEventListener('click', () => {
    if(options.ouvrirConnexion) options.ouvrirConnexion();
  });

  if(entrer) entrer.focus({ preventScroll: true });
}

function demanderConnexion(){

  Son.erreur();

  if(document.pointerLockElement) document.exitPointerLock();

  montrerEcran('connexion');
}

// Reprend le jeu : le pointeur se verrouille, l'écran disparaît. Ce clic
// est aussi le geste dont le navigateur a besoin pour le son.
async function reprendre(){

  Son.init();
  Son.reprendre();

  const etaitConnexion = etat.ecran === 'connexion';

  montrerEcran(null);

  if(etaitConnexion || etat.tours === null) chargerEtat();

  if(etat.tactile) return;

  demanderVerrou();
}

function demanderVerrou(){

  if(!H.canvas.requestPointerLock){
    etat.sansVerrou = true;
    return;
  }

  try{
    // Un refus est signalé par l'événement pointerlockerror, et par la
    // promesse dans les navigateurs récents : on ne compte que l'événement,
    // sinon chaque échec compterait double.
    const p = H.canvas.requestPointerLock();
    if(p && p.catch) p.catch(() => {});
  }catch(e){
    surErreurVerrou();
  }
}

function surChangementVerrou(){

  if(!actif || etat.tactile) return;

  const verrouille = document.pointerLockElement === H.canvas;

  if(verrouille){
    etat.sansVerrou = false;
    etat.echecsVerrou = 0;
    return;
  }

  // Le verrou a sauté (Échap) : la salle se met en pause, sauf si un autre
  // écran est déjà là ou si on a quitté.
  if(!etat.ecran && !etat.sansVerrou){
    touches.clear();
    montrerEcran('pause');
  }
}

// Chrome refuse un nouveau verrou dans la seconde et demie qui suit un
// Échap : ce n'est pas un refus définitif, un second clic passera. Trois
// échecs de suite, en revanche, veulent dire que le verrou est
// indisponible ici — on joue alors en faisant glisser la souris.
function surErreurVerrou(){
  etat.echecsVerrou = (etat.echecsVerrou || 0) + 1;
  if(etat.echecsVerrou >= 3) etat.sansVerrou = true;
}


/* ----------------------------------------------------------------------
   Entrées : clavier, souris, tactile
   ---------------------------------------------------------------------- */

function champActif(){
  const a = document.activeElement;
  if(a && a.closest && a.closest('.wv-jeu')) return false;
  return !!(a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable));
}

function modaleOuverte(){
  return !!document.querySelector('.modal-overlay.open');
}

function surToucheBas(e){

  if(!actif || champActif() || modaleOuverte()) return;

  // Un écran est affiché (départ, pause...) : ses boutons doivent rester
  // activables au clavier, avec Entrée ou Espace. Le jeu se tait.
  if(etat.ecran) return;

  const code = e.code;

  if(TOUCHES_JEU.has(code)) e.preventDefault();

  touches.add(code);

  if(e.repeat) return;

  if(code === 'KeyE' || code === 'Enter' || code === 'Space'){
    actionPrincipale();
  } else if(code === 'KeyM'){
    basculerSon();
  } else if(code === 'KeyF'){
    basculerPleinEcran();
  }

  // Un pas en arrière (ou n'importe quelle direction) se lève de la machine.
  if(focus.cible === 1 && !etat.enTirage && TOUCHES_MOUVEMENT.has(code)){
    sortirFocus();
  }
}

function surToucheHaut(e){
  touches.delete(e.code);
}

function surSouris(e){

  if(!actif || etat.ecran || focus.cible === 1) return;

  if(document.pointerLockElement === H.canvas){
    regarder(-e.movementX * JOUEUR.souris, -e.movementY * JOUEUR.souris);
    return;
  }

  // Sans verrou : on regarde en faisant glisser.
  if(etat.glisse && e.buttons & 1){
    regarder(-e.movementX * JOUEUR.souris * 1.3, -e.movementY * JOUEUR.souris * 1.3);
  }
}

function surClic(e){

  if(!actif || etat.ecran || e.button !== 0) return;

  if(document.pointerLockElement === H.canvas){
    actionPrincipale();
    return;
  }

  if(etat.tactile) return;

  // Pas de verrou : ce clic sert à en redemander un. En attendant, faire
  // glisser la souris permet déjà de regarder autour de soi.
  etat.glisse = true;

  if(!etat.sansVerrou) demanderVerrou();
}

function surRelacheSouris(){
  etat.glisse = false;
}

// Tactile : le pouce gauche conduit (le joystick apparaît où il se pose),
// le droit regarde.
function surDoigtBas(e){

  if(!actif || !etat.tactile || e.pointerType === 'mouse') return;
  if(etat.ecran || e.target.closest('button')) return;

  if(e.clientX < overlay.clientWidth * 0.45 && joy.id === null){

    joy.id = e.pointerId;
    joy.x0 = e.clientX;
    joy.y0 = e.clientY;
    joy.x = 0;
    joy.y = 0;

    H.joy.style.left = e.clientX + 'px';
    H.joy.style.top = e.clientY + 'px';
    H.pouce.style.transform = 'translate(0,0)';
    H.joy.hidden = false;

  } else if(regard.id === null){

    regard.id = e.pointerId;
    regard.x = e.clientX;
    regard.y = e.clientY;
  }
}

function surDoigtBouge(e){

  if(e.pointerId === joy.id){

    const dx = e.clientX - joy.x0, dy = e.clientY - joy.y0;
    const rayon = 56;
    const d = Math.hypot(dx, dy) || 1;
    const k = Math.min(1, d / rayon);

    joy.x = dx / d * k;
    joy.y = dy / d * k;

    H.pouce.style.transform = 'translate(' + (joy.x * rayon) + 'px,' + (joy.y * rayon) + 'px)';

  } else if(e.pointerId === regard.id){

    if(focus.cible === 0){
      regarder(-(e.clientX - regard.x) * JOUEUR.tactile, -(e.clientY - regard.y) * JOUEUR.tactile);
    }

    regard.x = e.clientX;
    regard.y = e.clientY;
  }
}

function surDoigtHaut(e){

  if(e.pointerId === joy.id){
    joy.id = null;
    joy.x = 0;
    joy.y = 0;
    H.joy.hidden = true;
  }

  if(e.pointerId === regard.id) regard.id = null;
}

let ecouteurs = [];

function ecouter(cible, type, fn, opt){
  cible.addEventListener(type, fn, opt);
  ecouteurs.push([cible, type, fn, opt]);
}

function brancherEvenements(){

  if(ecouteurs.length) return;

  ecouter(window, 'keydown', surToucheBas);
  ecouter(window, 'keyup', surToucheHaut);
  ecouter(window, 'blur', () => touches.clear());
  ecouter(window, 'resize', redimensionner);
  ecouter(document, 'mousemove', surSouris);
  ecouter(document, 'mouseup', surRelacheSouris);
  ecouter(document, 'pointerlockchange', surChangementVerrou);
  ecouter(document, 'pointerlockerror', surErreurVerrou);
  ecouter(document, 'visibilitychange', surVisibilite);
  ecouter(document, 'fullscreenchange', redimensionner);
  ecouter(H.canvas, 'mousedown', surClic);
  ecouter(overlay, 'pointerdown', surDoigtBas);
  ecouter(overlay, 'pointermove', surDoigtBouge);
  ecouter(overlay, 'pointerup', surDoigtHaut);
  ecouter(overlay, 'pointercancel', surDoigtHaut);
}

function debrancherEvenements(){
  ecouteurs.forEach(([c, t, f, o]) => c.removeEventListener(t, f, o));
  ecouteurs = [];
}

function surVisibilite(){

  if(!actif) return;

  if(document.hidden){
    cancelAnimationFrame(raf);
    raf = 0;
    Son.suspendre();
  } else if(!raf){
    dernier = 0;
    raf = requestAnimationFrame(boucle);
    Son.reprendre();
  }
}


/* ----------------------------------------------------------------------
   Taille et qualité
   ---------------------------------------------------------------------- */

function redimensionner(){

  if(!renderer || !overlay) return;

  const l = overlay.clientWidth, h = overlay.clientHeight;
  if(!l || !h) return;

  renderer.setSize(l, h, false);
  camera.aspect = l / h;
  camera.updateProjectionMatrix();
}

// Sur une machine modeste, la salle perd en finesse plutôt qu'en fluidité :
// si les images tardent, la résolution baisse d'un cran.
function surveillerPerformance(dt){

  if(dt > 1 / 28) lentes++; else lentes = Math.max(0, lentes - 1);

  if(lentes > 70 && ratioActuel > 0.7){
    ratioActuel = Math.max(0.7, ratioActuel * 0.85);
    renderer.setPixelRatio(ratioActuel);
    redimensionner();
    lentes = 0;
  }
}


/* ----------------------------------------------------------------------
   Boucle
   ---------------------------------------------------------------------- */

function boucle(t){

  if(!actif) return;

  raf = requestAnimationFrame(boucle);

  const dt = dernier ? Math.min(0.05, (t - dernier) / 1000) : 0.016;
  dernier = t;
  temps += dt;

  majJoueur(dt);
  majCamera(dt);
  majMonde(dt);

  etat.cible = (focus.cible === 0 && !etat.ecran) ? viser() : null;
  majInvite();

  renderer.render(scene, camera);

  surveillerPerformance(dt);
}

function majJoueur(dt){

  if(etat.ecran || focus.cible === 1 || focus.t > 0.001) {
    joueur.vitesse = 0;
    return;
  }

  // Flèches gauche et droite : on tourne.
  let tourne = 0;
  if(touches.has('ArrowLeft')) tourne += 1;
  if(touches.has('ArrowRight')) tourne -= 1;
  if(tourne) joueur.yaw += tourne * JOUEUR.tourne * dt;

  let avance = 0, cote = 0;

  if(touches.has('KeyW') || touches.has('ArrowUp')) avance += 1;
  if(touches.has('KeyS') || touches.has('ArrowDown')) avance -= 1;
  if(touches.has('KeyD')) cote += 1;
  if(touches.has('KeyA')) cote -= 1;

  // Le joystick tactile s'ajoute au clavier.
  avance -= joy.y;
  cote += joy.x;

  const norme = Math.hypot(avance, cote);

  if(norme > 1){ avance /= norme; cote /= norme; }

  const courir = touches.has('ShiftLeft') || touches.has('ShiftRight') || Math.hypot(joy.x, joy.y) > 0.92;
  const v = (courir ? JOUEUR.course : JOUEUR.marche) * dt;

  const fx = -Math.sin(joueur.yaw), fz = -Math.cos(joueur.yaw);
  const rx = Math.cos(joueur.yaw), rz = -Math.sin(joueur.yaw);

  const dx = (fx * avance + rx * cote) * v;
  const dz = (fz * avance + rz * cote) * v;

  if(dx || dz) deplacer(dx, dz);

  const vitesse = Math.hypot(dx, dz) / Math.max(dt, 0.0001);
  joueur.vitesse = vitesse;

  // Balancement de la tête, et un pas à chaque demi-cycle.
  if(vitesse > 0.2){
    const avant = Math.floor(joueur.phase / Math.PI);
    joueur.phase += dt * vitesse * 2.6;
    if(Math.floor(joueur.phase / Math.PI) !== avant) Son.pas();
  }
}

function majCamera(dt){

  // Transition vers ou depuis la machine.
  const cap = focus.cible === 1 ? 1 : 0;
  const vitesse = etat.reduit ? 100 : 1.5;

  if(focus.t < cap) focus.t = Math.min(cap, focus.t + dt * vitesse);
  else if(focus.t > cap) focus.t = Math.max(cap, focus.t - dt * vitesse);

  if(focus.t === 0 && focus.cible === 0) focus.machine = null;

  const e = entreeSortie(focus.t);

  const bob = (etat.reduit || !joueur.vitesse) ? 0 : Math.sin(joueur.phase * 2) * 0.022;

  let x = joueur.x, y = JOUEUR.yeux + bob, z = joueur.z;
  let yaw = joueur.yaw, pitch = joueur.pitch;
  let fov = camera.aspect < 1 ? 78 : 70;

  if(focus.machine && focus.t > 0){

    const v = focus.machine.vue(camera.aspect);

    x = lerp(x, v.x, e);
    y = lerp(y, v.y, e);
    z = lerp(z, v.z, e);
    yaw = yaw + ecartAngle(yaw, v.yaw) * e;
    pitch = lerp(pitch, v.pitch, e);
    fov = lerp(fov, v.fov, e);
  }

  camera.position.set(x, y, z);
  camera.rotation.set(pitch, yaw, 0);

  if(Math.abs(camera.fov - fov) > 0.01){
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }
}

function majMonde(dt){

  const t = temps;

  machines.forEach(m => m.maj(dt, t, etat.reduit));

  // Poissons de l'aquarium.
  animes.poissons.forEach(p => {
    p.s.position.x += p.dir * p.vitesse * dt;
    p.s.position.y = p.y0 + Math.sin(t * 0.9 + p.phase) * 0.08;
    if(p.s.position.x > 4.3){ p.dir = -1; p.s.scale.x = -Math.abs(p.s.scale.x); p.y0 = hasard(0.65, 2.2); }
    else if(p.s.position.x < -4.3){ p.dir = 1; p.s.scale.x = Math.abs(p.s.scale.x); p.y0 = hasard(0.65, 2.2); }
  });

  // Bulles de la salle.
  const B = animes.bulles;
  if(B){
    for(let i = 0; i < B.v.length; i++){
      B.pos[i * 3 + 1] += B.v[i] * dt;
      B.pos[i * 3] += Math.sin(t * 0.6 + i) * 0.03 * dt;
      if(B.pos[i * 3 + 1] > SALLE.h){
        B.pos[i * 3 + 1] = 0;
        B.pos[i * 3] = hasard(-SALLE.l + 0.6, SALLE.l - 0.6);
        B.pos[i * 3 + 2] = hasard(-SALLE.p + 0.6, SALLE.p - 0.6);
      }
    }
    B.points.geometry.attributes.position.needsUpdate = true;
  }

  // Bulles des tubes.
  const T = animes.bullesTubes;
  if(T){
    for(let i = 0; i < T.donnees.length; i++){
      const d = T.donnees[i];
      d.y += d.v * dt;
      if(d.y > 4.3) d.y = 0.3;
      T.pos[i * 3 + 1] = d.y;
      T.pos[i * 3] = d.cx + Math.cos(d.a + d.y * 1.4) * d.r;
      T.pos[i * 3 + 2] = d.cz + Math.sin(d.a + d.y * 1.4) * d.r;
    }
    T.points.geometry.attributes.position.needsUpdate = true;
  }

  // Reflets sur le sol.
  const lent = etat.reduit ? 0.3 : 1;
  animes.caustiques.forEach(c => {
    c.t.offset.x += c.vx * dt * lent;
    c.t.offset.y += c.vy * dt * lent;
  });

  // Pièces.
  const P = animes.pieces;
  if(P){
    let vivant = false;
    for(let i = 0; i < P.n; i++){
      if(P.vie[i] <= 0) continue;
      vivant = true;
      P.vel[i * 3 + 1] -= 9.8 * dt;
      P.pos[i * 3] += P.vel[i * 3] * dt;
      P.pos[i * 3 + 1] += P.vel[i * 3 + 1] * dt;
      P.pos[i * 3 + 2] += P.vel[i * 3 + 2] * dt;
      if(P.pos[i * 3 + 1] < 0.03){
        P.pos[i * 3 + 1] = 0.03;
        P.vel[i * 3 + 1] *= -0.35;
        P.vel[i * 3] *= 0.6;
        P.vel[i * 3 + 2] *= 0.6;
      }
      P.vie[i] -= dt;
      if(P.vie[i] <= 0) P.pos[i * 3 + 1] = -10;
    }
    if(vivant) P.points.geometry.attributes.position.needsUpdate = true;
  }
}


/* ----------------------------------------------------------------------
   Ouvrir et fermer la salle
   ---------------------------------------------------------------------- */

async function demarrer(opts){

  options = opts || {};

  injecterStyle();
  construireOverlay();

  etat.tactile = options.tactile !== undefined
    ? !!options.tactile
    : !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);

  etat.reduit = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  overlay.hidden = false;
  H.tactile.hidden = !etat.tactile;
  document.documentElement.style.overflow = 'hidden';
  document.body.classList.add('wv-en-jeu');

  actif = true;

  montrerEcran('chargement');

  try{

    if(!webglDispo()){
      throw new Error("Ton navigateur ne sait pas afficher la 3D (WebGL). Essaie avec un navigateur à jour.");
    }

    await assurerThree();

    if(!pret) await construireMonde();

  }catch(e){
    if(actif) montrerEcran('erreur', e.message);
    return;
  }

  // On a pu quitter pendant le chargement.
  if(!actif) return;

  brancherEvenements();
  redimensionner();

  // Toujours au point de départ : devant la porte, face à l'aquarium.
  joueur.x = 0;
  joueur.z = 10;
  joueur.yaw = 0;
  joueur.pitch = 0;
  focus.cible = 0;
  focus.t = 0;
  focus.machine = null;

  etat.enTirage = false;
  majInvite.dernier = null;

  dernier = 0;
  if(!raf) raf = requestAnimationFrame(boucle);

  await chargerEtat();

  if(!actif) return;

  majHud();
  montrerEcran('depart');
}

function quitter(){
  arreter();
  if(options.surQuitter) options.surQuitter();
}

function arreter(){

  if(!overlay) return;

  // Un gain reçu mais pas encore annoncé doit quand même être pris en
  // compte : la base l'a déjà enregistré.
  if(etat.attente && options.apresTirage){
    options.apresTirage(etat.attente);
    etat.attente = null;
  }

  actif = false;
  cancelAnimationFrame(raf);
  raf = 0;

  if(document.pointerLockElement) document.exitPointerLock();
  if(document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});

  touches.clear();
  joy.id = null;
  regard.id = null;
  etat.glisse = false;
  etat.enTirage = false;

  debrancherEvenements();
  Son.suspendre();

  overlay.hidden = true;
  document.documentElement.style.overflow = '';
  document.body.classList.remove('wv-en-jeu');
}


/* ----------------------------------------------------------------------
   Ce que le reste du site peut appeler
   ---------------------------------------------------------------------- */

window.Waveurs = {
  version: VERSION,
  demarrer,
  arreter,
  ouverte: () => actif,

  // Petit accès réservé aux essais : il ne sert qu'à vérifier le jeu sans
  // manette, et n'ouvre rien que le jeu ne fasse déjà.
  _essai: {
    etat: () => ({ joueur, focus, etat, actif, pret, ratioActuel }),
    machines: () => machines,
    placer(x, z, yaw, pitch){
      joueur.x = x; joueur.z = z;
      joueur.yaw = yaw || 0;
      joueur.pitch = pitch || 0;
    },
    touche(code, bas){
      if(bas) touches.add(code); else touches.delete(code);
    },
    creerTuile: (id) => tuileDroite(id, R.logo),
    creerBande: (i) => creerBande(BANDES[i], R.tuiles),
    libre,
    viser,
    scene: () => scene,
    camera: () => camera,
    renderer: () => renderer,
    reprendre: () => { montrerEcran(null); },
    tirer,
    entrerFocus,
    sortirFocus
  }
};

})();
