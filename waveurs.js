/* ======================================================================
   L'ESPACE DES WAVEURS
   ----------------------------------------------------------------------
   Un bar de casino en vue subjective, dans le navigateur, avec une grande
   machine à sous au milieu. Elle rapporte de l'XP, jamais d'argent.

   Ce fichier est chargé à la demande par index.html, quand quelqu'un
   entre dans la salle : le reste du site n'en paie pas le poids. Il
   embarque tout ce qu'il lui faut — modèles, textures, sons, interface —
   et ne dépend que de Three.js, chargé depuis un CDN.

   Rien n'est téléchargé pour les modèles : la machine, le bar et le
   mobilier sont construits ici, en code. C'est ce qui permet de les
   habiller aux couleurs de La Wave, et ce qui les garde assez légers pour
   un téléphone.

   Le tirage n'a pas lieu ici. index.html demande le résultat à la base
   (fonction waveurs_tourner) ; les rouleaux ne font que l'illustrer.

   Contrat avec index.html — window.Waveurs.demarrer(options) :

     options.connecte()          vrai si un compte est connecté
     options.utilisateur()       { pseudo, xp } ou null
     options.etat()              Promise<{ tours_restants, tours_par_jour,
                                           gagne_aujourdhui, pieces_aujourdhui,
                                           pieces, boosters, prix_booster }>
     options.gains()             Promise<[{ nom, motif, symbole, xp, pieces }]>
     options.tourner(machineId)  Promise<résultat de waveurs_tourner>
     options.acheter(quantite)   Promise<{ quantite, prix_unitaire,
                                           pieces_total, boosters_total }>
                                 (chez le croupier ; lève une Error dont le
                                 message est montré tel quel)
     options.apresTirage(res)    appelé une fois les rouleaux arrêtés
     options.ouvrirConnexion()   ouvre la fenêtre de connexion
     options.surQuitter()        appelé quand on quitte la salle
     options.logo                adresse (ou data:) du logo
     options.musique             (facultatif) liste de pistes à jouer au lieu
                                 de celles de musique/liste.json
   ====================================================================== */
(function(){
'use strict';

if(window.Waveurs) return;

const VERSION = 2;

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
const SALLE = { l: 7.5, p: 10, h: 5 };

// Où l'on se tient en entrant : devant la porte, face à la machine.
const DEPART = { x: 0, z: SALLE.p - 1.8 };

const JOUEUR = {
  rayon: 0.3,
  yeux: 1.62,
  marche: 3.0,
  course: 5.0,
  souris: 0.0022,
  tactile: 0.0052,
  tourne: 1.9          // rad/s aux flèches gauche et droite
};

// À quelle distance de la machine on peut la viser.
const PORTEE = 3.2;

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

// La machine, seule au milieu de la salle. Son identifiant est celui que la
// base enregistre avec chaque tour.
const MACHINE = { id: 'vague', nom: 'LA VAGUE', couleur: '#4FB4FF', sombre: '#0a2b4d' };

// Le modèle est dessiné 2,2 m de haut, ailerons compris (2,5 m). À cette
// échelle, le fronton arrive à la tête des personnages (1,75 m) et les
// rouleaux à hauteur de poitrine : une vraie machine de salle, pas un
// monument.
const ECHELLE_MACHINE = 0.8;

// Les habitants de la salle : leur taille, en mètres.
const TAILLE_HUMAIN = 1.75;

// Le podium de la machine.
const RAYON_PODIUM = 1.7;


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


/* ---- Textures de la salle : marbre, bois, tapis, bar ---- */

// Un motif qui se répète doit se raccorder sur ses bords : ce qui déborde
// d'un côté est redessiné de l'autre, en jouant sur les neuf décalages.
const DECALAGES = [-1, 0, 1];

// Un marbre veiné : des nuages, puis des veines qui serpentent. Sombre pour
// les murs, clair pour le comptoir du bar.
function creerMarbre(fond, veine, doree, nombre){

  const T = 512;
  const { c, x: g } = creerCanvas(T, T);

  g.fillStyle = fond;
  g.fillRect(0, 0, T, T);

  const nuages = Array.from({ length: 22 }, () => ({
    x: hasard(0, T), y: hasard(0, T), r: hasard(60, 170), a: hasard(0.03, 0.08)
  }));

  const veines = Array.from({ length: nombre }, () => {
    let x = hasard(0, T), y = hasard(0, T), a = hasard(0, TAU);
    const pts = [[x, y]];
    const n = Math.round(hasard(22, 40));
    for(let i = 0; i < n; i++){
      a += hasard(-0.7, 0.7);
      x += Math.cos(a) * hasard(10, 22);
      y += Math.sin(a) * hasard(10, 22);
      pts.push([x, y]);
    }
    return { pts, or: Math.random() < 0.3, e: hasard(0.8, 2.2) };
  });

  DECALAGES.forEach(i => DECALAGES.forEach(j => {

    g.save();
    g.translate(i * T, j * T);

    nuages.forEach(n => {
      const rg = g.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.r);
      rg.addColorStop(0, 'rgba(255,255,255,' + n.a + ')');
      rg.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = rg;
      g.fillRect(n.x - n.r, n.y - n.r, n.r * 2, n.r * 2);
    });

    g.lineCap = 'round';
    g.lineJoin = 'round';

    veines.forEach(v => {
      g.beginPath();
      v.pts.forEach((p, k) => {
        if(k === 0) g.moveTo(p[0], p[1]); else g.lineTo(p[0], p[1]);
      });
      g.strokeStyle = v.or ? doree : veine;
      g.globalAlpha = 0.16;
      g.lineWidth = v.e * 5;
      g.stroke();
      g.globalAlpha = 0.5;
      g.lineWidth = v.e;
      g.stroke();
    });

    g.globalAlpha = 1;
    g.restore();
  }));

  return c;
}

// Un parquet de noyer : des lames de tons différents, au fil du bois
// dessiné, avec un reflet le long de chacune.
function creerParquet(){

  const T = 512;
  const { c, x: g } = creerCanvas(T, T);

  // On dessine des lames horizontales, puis on tourne le tout : elles
  // courent ainsi dans la longueur de la salle.
  g.translate(T, 0);
  g.rotate(Math.PI / 2);

  g.fillStyle = '#1a0f08';
  g.fillRect(0, 0, T, T);

  const lames = 8, h = T / lames;

  for(let r = 0; r < lames; r++){

    const decalage = Math.floor(hasard(0, 4)) * 64;

    [0, 1].forEach(s => {

      const x0 = decalage + s * 256;
      const base = melange('#3f2515', '#6b4327', hasard(0.1, 0.9));

      [-T, 0].forEach(dx => {

        const x = x0 + dx;
        const y = r * h;

        g.fillStyle = base;
        g.fillRect(x + 1, y + 1, 254, h - 2);

        for(let k = 0; k < 9; k++){
          const yy = y + 4 + k * (h - 8) / 9 + hasard(-1.5, 1.5);
          g.strokeStyle = 'rgba(' + (k % 2 ? '0,0,0,' : '255,210,160,') + hasard(0.05, 0.12) + ')';
          g.lineWidth = hasard(0.6, 1.6);
          g.beginPath();
          g.moveTo(x, yy);
          g.bezierCurveTo(x + 80, yy + hasard(-3, 3), x + 170, yy + hasard(-3, 3), x + 256, yy);
          g.stroke();
        }

        g.fillStyle = 'rgba(255,225,190,.07)';
        g.fillRect(x + 1, y + 1, 254, 3);
      });
    });
  }

  return c;
}

// Des lattes de bois verticales, pour le soubassement des murs et la
// façade du comptoir.
function creerLattes(){

  const { c, x: g } = creerCanvas(256, 256);
  const n = 10, l = 256 / n;

  for(let i = 0; i < n; i++){

    g.fillStyle = melange('#33200f', '#563520', hasard(0.1, 0.9));
    g.fillRect(i * l, 0, l, 256);

    for(let k = 0; k < 4; k++){
      const x = i * l + hasard(3, l - 3);
      g.strokeStyle = 'rgba(0,0,0,' + hasard(0.06, 0.14) + ')';
      g.lineWidth = hasard(0.6, 1.4);
      g.beginPath();
      g.moveTo(x, 0);
      g.bezierCurveTo(x + hasard(-3, 3), 90, x + hasard(-3, 3), 170, x, 256);
      g.stroke();
    }

    g.fillStyle = 'rgba(255,220,180,.09)';
    g.fillRect(i * l, 0, 2, 256);
    g.fillStyle = 'rgba(0,0,0,.55)';
    g.fillRect(i * l + l - 2, 0, 2, 256);
  }

  return c;
}

// Un plafond à caissons : du noyer sombre, cerclé de cuivre.
function creerPlafond(){

  const { c, x: g } = creerCanvas(256, 256);

  g.fillStyle = '#21140b';
  g.fillRect(0, 0, 256, 256);

  const fond = g.createLinearGradient(0, 0, 0, 256);
  fond.addColorStop(0, '#47301c');
  fond.addColorStop(1, '#33200f');
  g.fillStyle = fond;
  g.fillRect(14, 14, 228, 228);

  g.strokeStyle = 'rgba(196,122,58,.8)';
  g.lineWidth = 3;
  g.strokeRect(14, 14, 228, 228);

  g.strokeStyle = 'rgba(255,220,180,.10)';
  g.lineWidth = 1;
  g.strokeRect(24, 24, 208, 208);

  return c;
}

// Le tapis de la salle : lie-de-vin, un treillis de losanges à fleurs
// dorées, une frise d'écailles sur le pourtour. Autour de la machine, des
// ondes dorées et bleues s'éloignent, comme sur l'eau ; devant, le logo de
// La Wave, en or. Il mesure 11 m sur 13,75 m, et la machine se tient à 6,4 m
// de son bord le plus éloigné.
function creerTapis(logo){

  const L = 1024, H = 1280;
  const { c, x: g } = creerCanvas(L, H);

  g.fillStyle = '#3f0c18';
  g.fillRect(0, 0, L, H);

  // Le treillis.
  const pas = 64;
  g.lineWidth = 2.5;
  g.strokeStyle = 'rgba(150,40,62,.55)';
  for(let k = -H; k < L + H; k += pas){
    g.beginPath(); g.moveTo(k, 0); g.lineTo(k + H, H); g.stroke();
    g.beginPath(); g.moveTo(k, 0); g.lineTo(k - H, H); g.stroke();
  }

  // Une petite fleur dorée à chaque croisement.
  g.fillStyle = 'rgba(214,170,84,.42)';
  for(let iy = 0; iy * 32 <= H; iy++){
    for(let ix = 0; ix * 32 <= L; ix++){
      if((ix + iy) % 2) continue;
      const x = ix * 32, y = iy * 32;
      [[5, 0], [-5, 0], [0, 5], [0, -5]].forEach(([dx, dy]) => {
        g.beginPath();
        g.arc(x + dx, y + dy, 3.2, 0, TAU);
        g.fill();
      });
    }
  }

  // Les ondes autour de la machine.
  const cx = L / 2, cy = H * 0.4636;
  [[268, 0.9, 5, '214,170,84'], [292, 0.55, 2.5, '79,180,255'],
   [318, 0.34, 2, '214,170,84'], [346, 0.2, 2, '79,180,255']].forEach(([r, a, e, col]) => {
    g.strokeStyle = 'rgba(' + col + ',' + a + ')';
    g.lineWidth = e;
    g.beginPath();
    g.arc(cx, cy, r, 0, TAU);
    g.stroke();
  });

  // Le logo, devant la machine, du côté de la porte.
  if(logo){
    g.globalAlpha = 0.9;
    ajuster(g, logoTeinte(logo, '#d6aa54'), cx, 1010, 340, 150);
    g.globalAlpha = 1;
  }

  // Le pourtour : deux filets et une frise d'écailles.
  g.strokeStyle = 'rgba(214,170,84,.95)';
  g.lineWidth = 9;
  g.strokeRect(22, 22, L - 44, H - 44);
  g.lineWidth = 3;
  g.strokeRect(40, 40, L - 80, H - 80);

  g.strokeStyle = 'rgba(214,170,84,.6)';
  g.lineWidth = 3;

  const r = 20;
  const frise = (x0, y0, dx, dy, n, a0) => {
    for(let i = 0; i < n; i++){
      const x = x0 + dx * (i + 0.5) * 2 * r;
      const y = y0 + dy * (i + 0.5) * 2 * r;
      g.beginPath();
      g.arc(x, y, r, a0, a0 + Math.PI);
      g.stroke();
    }
  };

  const nx = Math.floor((L - 120) / (2 * r)), ny = Math.floor((H - 120) / (2 * r));
  frise(60, 58, 1, 0, nx, 0);
  frise(60, H - 58, 1, 0, nx, Math.PI);
  frise(58, 60, 0, 1, ny, -Math.PI / 2);
  frise(L - 58, 60, 0, 1, ny, Math.PI / 2);

  g.strokeStyle = 'rgba(79,180,255,.5)';
  g.lineWidth = 2;
  g.strokeRect(100, 100, L - 200, H - 200);

  // Un peu de grain, pour que le tapis ne paraisse pas plastifié.
  const img = g.getImageData(0, 0, L, H);
  for(let i = 0; i < img.data.length; i += 4){
    const v = (Math.random() - 0.5) * 9;
    img.data[i] += v;
    img.data[i + 1] += v;
    img.data[i + 2] += v;
  }
  g.putImageData(img, 0, 0);

  return c;
}

// Le dessus de l'estrade : des ondes qui partent du centre.
function creerEstrade(){

  const T = 512;
  const { c, x: g } = creerCanvas(T, T);

  const fond = g.createRadialGradient(T / 2, T / 2, 20, T / 2, T / 2, T / 2);
  fond.addColorStop(0, '#4d1020');
  fond.addColorStop(1, '#2a0812');
  g.fillStyle = fond;
  g.fillRect(0, 0, T, T);

  for(let i = 1; i <= 6; i++){
    const bleu = i % 3 === 0;
    g.strokeStyle = 'rgba(' + (bleu ? '79,180,255' : '214,170,84') + ',' + (0.6 - i * 0.07) + ')';
    g.lineWidth = bleu ? 2 : 3;
    g.beginPath();
    g.arc(T / 2, T / 2, 36 + i * 32, 0, TAU);
    g.stroke();
  }

  return c;
}


/* ---- Le bar : étagères, néons, disques d'or ---- */

// Le mur de bouteilles derrière le comptoir, éclairé par l'arrière.
// 7,2 m sur 2,7 m.
function creerEtageres(){

  const L = 1024, H = 384;
  const { c, x: g } = creerCanvas(L, H);

  g.fillStyle = '#120a06';
  g.fillRect(0, 0, L, H);

  const rangs = 5, hr = H / rangs;
  const couleurs = ['#2f6b41', '#8a531f', '#1f5b6b', '#d8d0bc', '#6a2432', '#c9973a', '#3b3f52'];

  for(let r = 0; r < rangs; r++){

    const yb = (r + 1) * hr - 6;

    // Le fond, éclairé par derrière.
    const lum = g.createLinearGradient(0, yb - hr, 0, yb);
    lum.addColorStop(0, 'rgba(255,170,80,.10)');
    lum.addColorStop(1, 'rgba(255,190,110,.55)');
    g.fillStyle = lum;
    g.fillRect(0, yb - hr + 6, L, hr - 6);

    // Les bouteilles, serrées, avec des trous.
    let x = 14;
    while(x < L - 30){

      const l = hasard(20, 30);

      if(Math.random() < 0.12){
        x += l + hasard(6, 16);
        continue;
      }

      const h = hasard(40, 60);
      const corps = h * 0.62;

      g.fillStyle = couleurs[Math.floor(Math.random() * couleurs.length)];
      g.globalAlpha = 0.92;
      g.fillRect(x, yb - corps, l, corps);
      g.fillRect(x + l * 0.31, yb - h, l * 0.38, h - corps + 1);
      g.globalAlpha = 1;

      g.fillStyle = 'rgba(201,151,58,.9)';
      g.fillRect(x + l * 0.29, yb - h - 2, l * 0.42, 4);

      g.fillStyle = 'rgba(255,255,255,.3)';
      g.fillRect(x + l * 0.16, yb - corps + 4, 2.5, corps - 8);

      g.fillStyle = 'rgba(240,225,190,.7)';
      g.fillRect(x + 2, yb - corps * 0.66, l - 4, corps * 0.3);

      x += l + hasard(3, 9);
    }

    // La planche, avec un filet de laiton.
    g.fillStyle = '#3a2412';
    g.fillRect(0, yb, L, 6);
    g.fillStyle = 'rgba(214,170,84,.9)';
    g.fillRect(0, yb, L, 2);
  }

  // Les montants.
  [0, L / 3 - 8, 2 * L / 3 - 8, L - 16].forEach(x => {
    g.fillStyle = '#24150b';
    g.fillRect(x, 0, 16, H);
    g.fillStyle = 'rgba(214,170,84,.8)';
    g.fillRect(x + 7, 0, 2, H);
  });

  return c;
}

// Un signe de carte en néon : le contour brille de sa couleur, le cœur du
// tube est presque blanc.
function creerNeonSigne(type, couleur){

  const T = 256;
  const { c, x: g } = creerCanvas(T, T);

  g.translate(T / 2, T / 2 + 4);

  const p = new Path2D();

  if(type === 'coeur'){
    p.moveTo(0, 62);
    p.bezierCurveTo(-96, -6, -62, -78, 0, -34);
    p.bezierCurveTo(62, -78, 96, -6, 0, 62);
  } else if(type === 'pique'){
    p.moveTo(0, -66);
    p.bezierCurveTo(-96, 6, -60, 62, 0, 26);
    p.bezierCurveTo(60, 62, 96, 6, 0, -66);
    p.moveTo(-3, 22);
    p.lineTo(-18, 66);
    p.lineTo(18, 66);
    p.lineTo(3, 22);
  } else if(type === 'trefle'){
    [[0, -34], [-30, 12], [30, 12]].forEach(([x, y]) => {
      p.moveTo(x + 26, y);
      p.arc(x, y, 26, 0, TAU);
    });
    p.moveTo(-4, 12);
    p.lineTo(-20, 66);
    p.lineTo(20, 66);
    p.lineTo(4, 12);
  } else {
    p.moveTo(0, -70);
    p.lineTo(52, 0);
    p.lineTo(0, 70);
    p.lineTo(-52, 0);
    p.closePath();
  }

  g.lineJoin = 'round';
  g.lineCap = 'round';

  g.shadowColor = couleur;
  g.shadowBlur = 34;
  g.strokeStyle = couleur;
  g.lineWidth = 10;
  g.stroke(p);
  g.stroke(p);

  g.shadowBlur = 0;
  g.strokeStyle = '#ffffff';
  g.lineWidth = 3.5;
  g.stroke(p);

  return c;
}

// Le logo de La Wave en néon, au milieu du mur de bouteilles.
function creerNeonLogo(logo){

  const { c, x: g } = creerCanvas(768, 384);

  if(logo){
    const clair = logoTeinte(logo, '#d8f2ff');
    g.shadowColor = '#4FB4FF';
    g.shadowBlur = 46;
    ajuster(g, clair, 384, 192, 640, 300);
    ajuster(g, clair, 384, 192, 640, 300);
    g.shadowBlur = 0;
    ajuster(g, logoTeinte(logo, '#ffffff'), 384, 192, 640, 300);
  } else {
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '700 150px ' + POLICE;
    g.shadowColor = '#4FB4FF';
    g.shadowBlur = 46;
    g.fillStyle = '#d8f2ff';
    g.fillText('LA WAVE', 384, 192);
    g.shadowBlur = 0;
    g.fillStyle = '#ffffff';
    g.fillText('LA WAVE', 384, 192);
  }

  return c;
}

// Un disque d'or encadré : une petite nature morte de label, le long des
// murs. Le logo de La Wave tient lieu d'étiquette.
function creerDisqueOr(logo){

  const T = 256;
  const { c, x: g } = creerCanvas(T, T);

  g.fillStyle = '#1a0f08';
  g.fillRect(0, 0, T, T);
  g.strokeStyle = 'rgba(214,170,84,.9)';
  g.lineWidth = 5;
  g.strokeRect(6, 6, T - 12, T - 12);
  g.fillStyle = '#0a0705';
  g.fillRect(16, 16, T - 32, T - 32);

  const cx = T / 2, cy = T / 2;

  const rg = g.createRadialGradient(cx - 30, cy - 34, 6, cx, cy, 104);
  rg.addColorStop(0, '#fff0b0');
  rg.addColorStop(0.55, '#e0b447');
  rg.addColorStop(1, '#8a6218');
  g.fillStyle = rg;
  g.beginPath();
  g.arc(cx, cy, 102, 0, TAU);
  g.fill();

  g.lineWidth = 1;
  for(let r = 50; r < 100; r += 4){
    g.strokeStyle = 'rgba(90,60,10,.22)';
    g.beginPath();
    g.arc(cx, cy, r, 0, TAU);
    g.stroke();
  }

  g.fillStyle = 'rgba(255,255,255,.18)';
  [[-0.9, -0.35], [Math.PI - 0.9, Math.PI - 0.35]].forEach(([a, b]) => {
    g.beginPath();
    g.moveTo(cx, cy);
    g.arc(cx, cy, 102, a, b);
    g.closePath();
    g.fill();
  });

  g.fillStyle = '#0d3550';
  g.beginPath();
  g.arc(cx, cy, 36, 0, TAU);
  g.fill();

  if(logo) ajuster(g, logoTeinte(logo, '#ffffff'), cx, cy, 52, 26);

  g.fillStyle = '#0a0705';
  g.beginPath();
  g.arc(cx, cy, 4, 0, TAU);
  g.fill();

  return c;
}

// Le faisceau de lumière qui tombe sur la machine : un dégradé vertical.
// Le faisceau du lustre est un shader (voir construireLumieres) : une lumière
// plus dense en haut, qui s'adoucit sur les bords et que des nappes de
// poussière traversent.
function creerMateriauFaisceau(){

  return new THREE.ShaderMaterial({
    uniforms: { uT: { value: 0 }, uOpacite: { value: 1 }, uCouleur: { value: new THREE.Color(0xffdcae) } },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vN;
      varying vec3 vV;
      void main(){
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vV = -mv.xyz;
        vN = normalMatrix * normal;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform float uT;
      uniform float uOpacite;
      uniform vec3 uCouleur;
      varying vec2 vUv;
      varying vec3 vN;
      varying vec3 vV;

      float hasard(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }

      float bruit(vec2 p){
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hasard(i), hasard(i + vec2(1.0, 0.0)), f.x),
                   mix(hasard(i + vec2(0.0, 1.0)), hasard(i + vec2(1.0, 1.0)), f.x), f.y);
      }

      void main(){
        // Le long du cône : dense en haut, il s'efface vers le sol.
        float haut = pow(clamp(vUv.y, 0.0, 1.0), 1.4);

        // Sur la largeur : le bord s'adoucit, comme un volume qu'on traverse.
        float ang = abs(dot(normalize(vN), normalize(vV)));
        float bord = pow(clamp(ang, 0.0, 1.0), 1.35);

        // La poussière : des nappes qui montent lentement.
        float n1 = bruit(vec2(vUv.x * 10.0 + uT * 0.05, vUv.y * 3.5 - uT * 0.11));
        float n2 = bruit(vec2(vUv.x * 23.0 - uT * 0.03, vUv.y * 7.0 - uT * 0.20));
        float nappe = 0.62 + 0.38 * (n1 * 0.6 + n2 * 0.4);

        float a = (0.05 + 0.24 * haut) * bord * nappe * uOpacite;
        gl_FragColor = vec4(uCouleur, a);
      }`,
    transparent: true, side: THREE.DoubleSide, depthWrite: false,
    blending: THREE.AdditiveBlending, fog: false
  });
}

// Une flaque de lumière le long d'un mur, sous une lampe de tableau : dense
// en haut, près de la lampe, qui s'éteint en descendant.
function creerLueurMur(){

  const { c, x: g } = creerCanvas(64, 128);

  const v = g.createLinearGradient(0, 0, 0, 128);
  v.addColorStop(0, 'rgba(255,255,255,.95)');
  v.addColorStop(0.35, 'rgba(255,255,255,.4)');
  v.addColorStop(1, 'rgba(255,255,255,0)');

  g.fillStyle = v;
  g.fillRect(0, 0, 64, 128);

  // Un adoucissement latéral : on multiplie par un dégradé horizontal.
  g.globalCompositeOperation = 'destination-in';
  const h = g.createLinearGradient(0, 0, 64, 0);
  h.addColorStop(0, 'rgba(0,0,0,0)');
  h.addColorStop(0.5, 'rgba(0,0,0,1)');
  h.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = h;
  g.fillRect(0, 0, 64, 128);

  return c;
}


/* ---- Les tables de jeu ---- */

function creerFeutreRoulette(){

  const { c, x: g } = creerCanvas(256, 560);

  g.fillStyle = '#0d5a38';
  g.fillRect(0, 0, 256, 560);

  const rouges = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
  const x0 = 41, y0 = 226, l = 58, h = 27;

  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = '700 15px ' + POLICE;
  g.lineWidth = 1.5;

  for(let r = 0; r < 12; r++){
    for(let k = 0; k < 3; k++){
      const n = r * 3 + k + 1;
      g.fillStyle = rouges.has(n) ? '#a3182b' : '#0b0b0b';
      g.fillRect(x0 + k * l, y0 + r * h, l, h);
      g.strokeStyle = 'rgba(255,255,255,.75)';
      g.strokeRect(x0 + k * l, y0 + r * h, l, h);
      g.fillStyle = '#ffffff';
      g.fillText(String(n), x0 + k * l + l / 2, y0 + r * h + h / 2 + 1);
    }
  }

  g.fillStyle = '#1a7a48';
  g.fillRect(x0, y0 - 32, 3 * l, 32);
  g.strokeStyle = 'rgba(255,255,255,.75)';
  g.strokeRect(x0, y0 - 32, 3 * l, 32);
  g.fillStyle = '#ffffff';
  g.fillText('0', x0 + 1.5 * l, y0 - 15);

  g.strokeStyle = 'rgba(214,170,84,.9)';
  g.lineWidth = 4;
  g.strokeRect(6, 6, 244, 548);

  return c;
}

// Le dessus de la roue : trente-sept alvéoles, rouges et noires, un zéro
// vert, un anneau doré.
function creerRoue(){

  const T = 256;
  const { c, x: g } = creerCanvas(T, T);

  const cx = T / 2, cy = T / 2;

  g.fillStyle = '#c9973a';
  g.beginPath();
  g.arc(cx, cy, 126, 0, TAU);
  g.fill();

  g.fillStyle = '#1d110a';
  g.beginPath();
  g.arc(cx, cy, 108, 0, TAU);
  g.fill();

  const n = 37;
  for(let i = 0; i < n; i++){
    const a0 = i / n * TAU, a1 = (i + 1) / n * TAU;
    g.fillStyle = i === 0 ? '#1a7a48' : (i % 2 ? '#a3182b' : '#0b0b0b');
    g.beginPath();
    g.arc(cx, cy, 102, a0, a1);
    g.arc(cx, cy, 64, a1, a0, true);
    g.closePath();
    g.fill();
  }

  g.fillStyle = '#2b170c';
  g.beginPath();
  g.arc(cx, cy, 62, 0, TAU);
  g.fill();
  g.strokeStyle = 'rgba(214,170,84,.9)';
  g.lineWidth = 4;
  g.beginPath();
  g.arc(cx, cy, 44, 0, TAU);
  g.stroke();

  return c;
}

// Le tapis d'une table de blackjack, en demi-cercle : le bord droit est du
// côté du croupier (le bas de l'image). On y lit LA WAVE en arc.
function creerFeutreBlackjack(){

  const { c, x: g } = creerCanvas(512, 256);

  const fond = g.createRadialGradient(256, 256, 20, 256, 256, 256);
  fond.addColorStop(0, '#0c6473');
  fond.addColorStop(1, '#083e49');
  g.fillStyle = fond;
  g.fillRect(0, 0, 512, 256);

  g.strokeStyle = 'rgba(214,170,84,.85)';
  g.lineWidth = 3;

  [90, 160].forEach(r => {
    g.beginPath();
    g.arc(256, 256, r, Math.PI, TAU);
    g.stroke();
  });

  for(let i = 0; i < 5; i++){
    const a = Math.PI + 0.42 + i * (Math.PI - 0.84) / 4;
    g.beginPath();
    g.arc(256 + 205 * Math.cos(a), 256 + 205 * Math.sin(a), 22, 0, TAU);
    g.stroke();
  }

  g.fillStyle = 'rgba(214,170,84,.95)';
  g.font = '700 26px ' + POLICE;
  g.textAlign = 'center';
  g.textBaseline = 'middle';

  const mot = 'LA WAVE';
  mot.split('').forEach((ch, i) => {
    const a = -Math.PI / 2 - 0.62 + (i + 0.5) * 1.24 / mot.length;
    g.save();
    g.translate(256 + 124 * Math.cos(a), 256 + 124 * Math.sin(a));
    g.rotate(a + Math.PI / 2);
    g.fillText(ch, 0, 0);
    g.restore();
  });

  return c;
}

function creerFeutrePoker(logo){

  const T = 512;
  const { c, x: g } = creerCanvas(T, T);

  const fond = g.createRadialGradient(T / 2, T / 2, 10, T / 2, T / 2, T / 2);
  fond.addColorStop(0, '#5a1224');
  fond.addColorStop(1, '#3a0b18');
  g.fillStyle = fond;
  g.fillRect(0, 0, T, T);

  g.strokeStyle = 'rgba(214,170,84,.85)';
  g.lineWidth = 4;
  [232, 214].forEach(r => {
    g.beginPath();
    g.arc(T / 2, T / 2, r, 0, TAU);
    g.stroke();
  });

  if(logo) ajuster(g, logoTeinte(logo, '#d6aa54'), T / 2, T / 2, 240, 120);

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

/* ---- Le booster La Wave TCG ----
   Presque rien : un papier d'aluminium bleu nuit, le logo en blanc, TCG en
   capitales espacées, un filet. C'est ce qui fait le luxe, et ce qui garde
   le logo lisible de loin. */

const BOOSTER_L = 512, BOOSTER_H = 768;

// Le fond commun aux deux faces : un dégradé bleu nuit, des reflets verticaux
// de feuille métallique, et les deux soudures, striées.
function fondBooster(g){

  const L = BOOSTER_L, H = BOOSTER_H;

  const fond = g.createLinearGradient(0, 0, 0, H);
  fond.addColorStop(0, '#040a1a');
  fond.addColorStop(0.5, '#0b2645');
  fond.addColorStop(1, '#050c1d');
  g.fillStyle = fond;
  g.fillRect(0, 0, L, H);

  // Les reflets d'une feuille froissée à peine : des bandes très douces.
  for(let x = 0; x < L; x += 32){
    g.fillStyle = 'rgba(255,255,255,' + (0.016 + 0.018 * Math.sin(x * 0.11)) + ')';
    g.fillRect(x, 0, 16, H);
  }

  const lueur = g.createLinearGradient(0, 0, L, H);
  lueur.addColorStop(0.3, 'rgba(120,190,255,0)');
  lueur.addColorStop(0.5, 'rgba(140,205,255,.11)');
  lueur.addColorStop(0.7, 'rgba(120,190,255,0)');
  g.fillStyle = lueur;
  g.fillRect(0, 0, L, H);

  // Les soudures.
  [[0, 46], [H - 46, 46]].forEach(([y, h]) => {
    g.fillStyle = 'rgba(14,33,56,.9)';
    g.fillRect(0, y, L, h);
    for(let k = 0; k < h; k += 4){
      g.fillStyle = k % 8 ? 'rgba(0,0,0,.34)' : 'rgba(255,255,255,.10)';
      g.fillRect(0, y + k, L, 2);
    }
  });

  g.fillStyle = 'rgba(255,255,255,.14)';
  g.fillRect(0, 46, L, 1.5);
  g.fillRect(0, H - 47.5, L, 1.5);
}

// La face avant. Avec decoupe, les bords haut et bas prennent la dentelure
// des soudures et le reste est transparent : c'est l'image de la boutique.
function creerBoosterFace(logo, decoupe){

  const L = BOOSTER_L, H = BOOSTER_H;
  const { c, x: g } = creerCanvas(L, H);

  if(decoupe){
    const dent = 8, n = Math.ceil(L / dent);
    g.beginPath();
    g.moveTo(0, 8);
    for(let i = 0; i <= n; i++) g.lineTo(Math.min(L, i * dent), i % 2 ? 0 : 8);
    g.lineTo(L, H - 8);
    for(let i = n; i >= 0; i--) g.lineTo(Math.min(L, i * dent), H - (i % 2 ? 0 : 8));
    g.closePath();
    g.clip();
  }

  fondBooster(g);

  // Un cadre fin.
  g.strokeStyle = 'rgba(255,255,255,.17)';
  g.lineWidth = 2;
  g.strokeRect(34, 84, L - 68, H - 168);

  // Le logo, en blanc, avec une lueur bleue à peine perceptible.
  if(logo){
    const blanc = logoTeinte(logo, '#ffffff');
    g.shadowColor = '#4FB4FF';
    g.shadowBlur = 16;
    ajuster(g, blanc, L / 2, 290, 330, 190);
    g.shadowBlur = 0;
    ajuster(g, blanc, L / 2, 290, 330, 190);
  } else {
    g.fillStyle = '#ffffff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '700 88px ' + POLICE;
    g.fillText('LA WAVE', L / 2, 290);
  }

  // Un filet bleu, puis TCG.
  const filet = g.createLinearGradient(170, 0, 342, 0);
  filet.addColorStop(0, 'rgba(79,180,255,0)');
  filet.addColorStop(0.5, 'rgba(79,180,255,.95)');
  filet.addColorStop(1, 'rgba(79,180,255,0)');
  g.fillStyle = filet;
  g.fillRect(170, 446, 172, 2);

  g.textBaseline = 'middle';
  g.font = '700 96px ' + POLICE;
  g.fillStyle = '#ffffff';
  g.shadowColor = 'rgba(79,180,255,.55)';
  g.shadowBlur = 16;
  texteEspace(g, 'TCG', L / 2, 528, 22);
  g.shadowBlur = 0;

  g.font = '500 24px ' + POLICE;
  g.fillStyle = '#8fb8d8';
  texteEspace(g, 'BOOSTER', L / 2, 610, 12);

  // Une seule vague, en bas.
  g.strokeStyle = 'rgba(79,180,255,.32)';
  g.lineWidth = 2;
  g.beginPath();
  for(let x = 60; x <= L - 60; x += 4){
    const y = 676 + Math.sin((x - 60) / (L - 120) * TAU * 2) * 8;
    if(x === 60) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.stroke();

  return c;
}

// Le dos : le même fond, un petit logo et la vague.
function creerBoosterDos(logo){

  const L = BOOSTER_L, H = BOOSTER_H;
  const { c, x: g } = creerCanvas(L, H);

  fondBooster(g);

  if(logo){
    g.globalAlpha = 0.5;
    ajuster(g, logoTeinte(logo, '#ffffff'), L / 2, H / 2, 180, 100);
    g.globalAlpha = 1;
  }

  g.strokeStyle = 'rgba(79,180,255,.28)';
  g.lineWidth = 2;
  g.beginPath();
  for(let x = 60; x <= L - 60; x += 4){
    const y = H / 2 + 90 + Math.sin((x - 60) / (L - 120) * TAU * 2) * 8;
    if(x === 60) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.stroke();

  return c;
}

// Le reflet arc-en-ciel du foil : des bandes de couleur, en diagonale, qui
// glissent sur le sachet.
function creerRefletFoil(){

  const { c, x: g } = creerCanvas(256, 256);

  // Deux cycles de couleurs sur la diagonale : un décalage d'une demi-
  // diagonale (256 px de côté) retombe sur la même teinte, donc la texture se
  // raccorde sur ses bords quand elle se répète et que son offset glisse.
  const d = g.createLinearGradient(0, 0, 256, 256);
  const couleurs = ['255,90,160', '255,205,90', '90,255,195', '95,165,255', '205,95,255'];
  const n = couleurs.length;
  for(let cycle = 0; cycle < 2; cycle++){
    couleurs.forEach((col, i) => {
      d.addColorStop((cycle + i / n) / 2, 'rgba(' + col + ',0.85)');
    });
  }
  d.addColorStop(1, 'rgba(' + couleurs[0] + ',0.85)');
  g.fillStyle = d;
  g.fillRect(0, 0, 256, 256);

  return c;
}


/* ----------------------------------------------------------------------
   Géométries
   ---------------------------------------------------------------------- */

// Un sachet de foil : plat aux deux soudures, gonflé entre elles, pincé sur
// les côtés. Le devant fait face à +z.
function geoBooster(largeur, hauteur, epaisseur){

  const g = new THREE.PlaneGeometry(largeur, hauteur, 8, 36);
  const pos = g.attributes.position;

  for(let i = 0; i < pos.count; i++){

    const x = pos.getX(i), y = pos.getY(i);
    const u = 2 * x / largeur;
    const v = y / hauteur + 0.5;

    // Distance à la soudure la plus proche : le sachet ne gonfle qu'au-delà.
    const bord = Math.min(v, 1 - v);
    const t = clamp((bord - 0.07) / 0.10, 0, 1);
    const gonfle = t * t * (3 - 2 * t);

    const corps = Math.pow(Math.max(0, 1 - u * u), 0.7);
    const strie = bord < 0.07 ? Math.sin(x / largeur * 90) * 0.0007 : 0;

    pos.setZ(i, epaisseur / 2 * gonfle * corps + 0.0006 + strie);
  }

  g.computeVertexNormals();

  return g;
}

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
    boite(0.56, 0.13, 0.12, 0, 0.36, 0.435, noir),                // bac à pièces
    // Le dos : la machine se tient au milieu de la salle, on en fait le
    // tour. Sans cette plaque, le puits des rouleaux serait ouvert derrière.
    boite(W + 0.05, 1.78, 0.03, 0, 0.99, -0.465, cab2),
    boite(0.5, 0.02, 0.02, 0, 0.3, -0.485, noir),                 // grille d'aération
    boite(0.5, 0.02, 0.02, 0, 0.35, -0.485, noir),
    boite(0.5, 0.02, 0.02, 0, 0.4, -0.485, noir)
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
    boite(0.05, 0.18, 0.18, 0.525, 1.02, 0.06),
    // Liserés du dos
    boite(W + 0.01, 0.05, 0.02, 0, 0.62, -0.485),
    boite(W + 0.01, 0.04, 0.02, 0, 1.55, -0.485),
    boite(0.035, 1.3, 0.02, -0.44, 0.9, -0.485),
    boite(0.035, 1.3, 0.02, 0.44, 0.9, -0.485)
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

  constructor(def, x, z, rotY, R, echelle){

    this.def = def;
    this.R = R;
    this.echelle = echelle || 1;
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
    g.scale.setScalar(this.echelle);
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

    // Le levier dépasse un peu du côté droit : le socle est compté large.
    const hx = 0.62 * this.echelle, hz = 0.5 * this.echelle;
    const c = Math.abs(Math.cos(rotY)), s = Math.abs(Math.sin(rotY));
    const ex = c * hx + s * hz, ez = s * hx + c * hz;
    this.collision = { x0: x - ex, x1: x + ex, z0: z - ez, z1: z + ez };
  }

  // Position de la caméra quand on est assis devant. Elle dépend de la
  // forme de l'écran : sur un téléphone tenu droit, il faut reculer pour
  // voir toute la machine.
  vue(aspect){

    // Tout est proportionnel à la taille de la machine : le cadrage reste
    // celui d'une machine de bar, vue de près.
    const k = this.echelle;
    const fov = 56;
    const demiLarge = 0.7 * k;
    const dFace = clamp(demiLarge / (Math.tan(fov * Math.PI / 360) * aspect), 0.85 * k, 3 * k);
    const d = 0.45 * k + dFace;

    return {
      x: this.centre.x + this.normale.x * d,
      y: this.groupe.position.y + 1.44 * k,
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
        // machine. Pour qui préfère moins de mouvement : de l'or fixe.
        col = (reduit || pas % 2 === 0) ? R_OR : this.cLampeOn;
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

  let ctx = null, maitre = null, actif = true, ambiance = null;

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
  }

  function suspendre(){
    if(ctx && ctx.state === 'running') ctx.suspend();
  }

  // Un contexte suspendu (onglet caché, salle quittée) garde son horloge
  // figée : ce qu'on y planifierait s'empilerait pour éclater à la reprise.
  const enMarche = () => !!ctx && actif && ctx.state === 'running';

  function ton(freq, t0, duree, opt){
    if(!enMarche()) return;
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
    if(!enMarche()) return;
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

  // Le fond sonore : le souffle sourd d'une grande salle climatisée, très
  // bas. La musique, elle, est un autre étage (voir Musique).
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
    f.frequency.value = 220;

    const g = ctx.createGain();
    g.gain.value = 0.3;

    src.connect(f);
    f.connect(g);
    g.connect(maitre);
    src.start();

    ambiance = src;
  }

  return {
    init, reprendre, suspendre,

    estActif(){ return actif; },

    // Ce dont un autre étage sonore a besoin pour se brancher.
    contexte(){ return ctx ? { ctx, sortie: maitre } : null; },

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

    // Une pluie de pièces : de petits tintements aigus, plus nombreux quand
    // le gain est gros.
    pieces(n){
      if(!ctx) return;
      const t = ctx.currentTime + 0.05;
      const k = clamp(Math.round(n / 4) + 3, 3, 14);
      for(let i = 0; i < k; i++){
        const f = hasard(1900, 3100);
        const d = t + i * 0.065 + hasard(0, 0.02);
        ton(f, d, 0.18, { type: 'sine', vol: 0.05 });
        ton(f * 1.51, d, 0.1, { type: 'sine', vol: 0.02 });
      }
    },

    // La caisse : le tiroir, puis deux notes de clochette.
    achat(){
      if(!ctx) return;
      const t = ctx.currentTime;
      bruit(t, 0.08, { freq: 900, vol: 0.1 });
      ton(1568, t + 0.09, 0.5, { type: 'triangle', vol: 0.12 });
      ton(2093, t + 0.2, 0.7, { type: 'triangle', vol: 0.10 });
      ton(3136, t + 0.2, 0.4, { type: 'sine', vol: 0.03 });
    },

    pas(){
      if(!ctx) return;
      bruit(ctx.currentTime, 0.09, { type: 'lowpass', freq: 240, vol: 0.09 });
    },

    // Le papier d'aluminium qui cède : un long froissement, puis le claquement
    // de la soudure. `fin` : le moment où la bande part.
    dechire(fin){
      if(!ctx) return;
      const t = ctx.currentTime;
      if(!fin){
        bruit(t, 0.55, { type: 'highpass', freq: 2400, q: 0.7, vol: 0.12 });
        ton(180, t, 0.4, { type: 'sawtooth', glisse: 2.6, vol: 0.05 });
        return;
      }
      bruit(t, 0.35, { type: 'bandpass', freq: 4200, q: 0.6, vol: 0.2 });
      bruit(t, 0.18, { type: 'lowpass', freq: 600, vol: 0.14 });
      ton(1400, t, 0.3, { type: 'sine', glisse: 0.5, vol: 0.06 });
    },

    // Une carte qui tourne : un souffle bref.
    flip(){
      if(!ctx) return;
      const t = ctx.currentTime;
      bruit(t, 0.14, { type: 'bandpass', freq: 2100, q: 0.9, vol: 0.12 });
      ton(520, t, 0.12, { type: 'triangle', glisse: 1.6, vol: 0.05 });
    },

    // La carte apparaît : d'autant plus de notes qu'elle est rare.
    carte(rar, nouvelle){
      if(!ctx) return;
      const t = ctx.currentTime + 0.03;
      const gammes = {
        commune: [523.25],
        rare: [659.25, 987.77],
        epique: [523.25, 659.25, 783.99, 1046.5],
        legendaire: [392, 523.25, 659.25, 783.99, 1046.5, 1318.5, 1567.98]
      };
      const notes = gammes[rar] || gammes.commune;
      const pas = rar === 'legendaire' ? 0.1 : 0.085;
      notes.forEach((f, i) => {
        ton(f, t + i * pas, 0.5, { type: 'triangle', vol: 0.12 });
        if(rar !== 'commune') ton(f * 2, t + i * pas, 0.3, { type: 'sine', vol: 0.04 });
      });
      if(rar === 'epique' || rar === 'legendaire'){
        const n = rar === 'legendaire' ? 16 : 8;
        for(let i = 0; i < n; i++) ton(hasard(2200, 3800), t + 0.25 + i * 0.06, 0.1, { type: 'sine', vol: 0.04 });
      }
      // Une carte qu'on n'avait pas : une petite note de plus.
      if(nouvelle) ton(1760, t + notes.length * pas + 0.05, 0.25, { type: 'sine', vol: 0.05 });
    }
  };
})();


/* ----------------------------------------------------------------------
   La musique des voisins
   ----------------------------------------------------------------------
   Une playlist qui tourne au hasard, filtrée pour qu'on l'entende comme à
   travers une cloison : la basse et le rythme passent, pas les paroles. Les
   pistes ne sont pas dans ce fichier : elles se déposent dans le dossier
   musique/, à côté de index.html, avec un fichier liste.json qui les
   nomme, par exemple  ["une.mp3", "autre.mp3"]  ou  { "pistes": [...] }.
   Sans ce fichier, la salle reste silencieuse : rien n'échoue.
   ---------------------------------------------------------------------- */

const Musique = (function(){

  const DOSSIER = 'musique/';

  let liste = null, ordre = [], rang = -1, dernier = '';
  let lecteur = null, gain = null, marche = false, echecs = 0;

  // Les adresses absolues restent telles quelles ; les noms simples se
  // cherchent dans le dossier musique/.
  const adresse = u => /^(https?:|blob:|data:|\/)/.test(u) ? u : DOSSIER + u;

  async function chercher(imposee){

    if(liste) return liste;

    let pistes = Array.isArray(imposee) && imposee.length ? imposee : null;

    if(!pistes){
      try{
        const r = await fetch(DOSSIER + 'liste.json', { cache: 'no-cache' });
        if(!r.ok) throw new Error('absente');
        const j = await r.json();
        pistes = Array.isArray(j) ? j : (j.pistes || []);
      }catch(e){
        pistes = [];
      }
    }

    liste = pistes
      .map(p => typeof p === 'string' ? p : (p && p.url))
      .filter(Boolean)
      .map(adresse);

    return liste;
  }

  function melanger(a){
    for(let i = a.length - 1; i > 0; i--){
      const j = Math.floor(Math.random() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  // La chaîne de filtres : deux passe-bas en cascade, pour une pente
  // raide, et un peu de graves en plus, que les murs laissent passer.
  function preparer(){

    if(lecteur) return true;

    const dispo = Son.contexte();
    if(!dispo) return false;

    const { ctx, sortie } = dispo;

    lecteur = new Audio();
    lecteur.preload = 'auto';
    lecteur.crossOrigin = 'anonymous';

    const source = ctx.createMediaElementSource(lecteur);

    const f1 = ctx.createBiquadFilter();
    f1.type = 'lowpass';
    f1.frequency.value = 520;
    f1.Q.value = 0.7;

    const f2 = ctx.createBiquadFilter();
    f2.type = 'lowpass';
    f2.frequency.value = 780;
    f2.Q.value = 0.5;

    const graves = ctx.createBiquadFilter();
    graves.type = 'lowshelf';
    graves.frequency.value = 160;
    graves.gain.value = 4;

    gain = ctx.createGain();
    gain.gain.value = 0;

    source.connect(f1);
    f1.connect(f2);
    f2.connect(graves);
    graves.connect(gain);
    gain.connect(sortie);

    lecteur.addEventListener('ended', suivante);
    lecteur.addEventListener('error', () => {
      // Une piste illisible est sautée ; quatre de suite, on renonce.
      echecs++;
      if(echecs < 4) suivante();
    });
    lecteur.addEventListener('playing', () => { echecs = 0; });

    return true;
  }

  function suivante(){

    if(!liste || !liste.length || !lecteur) return;

    rang++;

    if(rang >= ordre.length){
      ordre = melanger(liste.slice());
      // La même piste deux fois de suite, à la jonction, se remarquerait.
      if(ordre.length > 1 && ordre[0] === dernier){
        const t = ordre[0]; ordre[0] = ordre[1]; ordre[1] = t;
      }
      rang = 0;
    }

    dernier = ordre[rang];
    lecteur.src = dernier;

    if(marche){
      const p = lecteur.play();
      if(p && p.catch) p.catch(() => {});
    }
  }

  return {

    async demarrer(imposee){

      if(marche) return;

      // Son coupé : rien à télécharger ni à décoder. Rallumer le son
      // (basculerSon) relance la musique.
      if(!Son.estActif()) return;

      marche = true;

      await chercher(imposee);

      if(!marche || !liste.length || !preparer()) return;

      ordre = [];
      rang = -1;
      suivante();

      // Elle monte doucement, à chaque entrée : les voisins n'allument pas
      // tout d'un coup. Le gain repart de zéro, sinon une entrée sur deux
      // démarrerait à plein volume.
      const dispo = Son.contexte();
      if(dispo && gain){
        const t = dispo.ctx.currentTime;
        gain.gain.cancelScheduledValues(t);
        gain.gain.setValueAtTime(0, t);
        gain.gain.setTargetAtTime(0.32, t, 1.6);
      }
    },

    pause(){
      if(lecteur && !lecteur.paused) lecteur.pause();
    },

    reprendre(){
      if(marche && lecteur && lecteur.src && lecteur.paused){
        const p = lecteur.play();
        if(p && p.catch) p.catch(() => {});
      }
    },

    arreter(){
      marche = false;
      if(lecteur) lecteur.pause();
    },

    // Pour les essais : où en est le lecteur.
    etat(){
      return {
        marche, pistes: liste ? liste.length : null, rang,
        enPause: lecteur ? lecteur.paused : null,
        temps: lecteur ? lecteur.currentTime : null,
        gain: gain ? gain.gain.value : null
      };
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
  quitter: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
  piece: '<svg class="wv-ico" aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="16" height="16"><circle cx="12" cy="12" r="10" fill="#e9b949"/><circle cx="12" cy="12" r="10" fill="none" stroke="#a87817" stroke-width="1.5"/><circle cx="12" cy="12" r="6.4" fill="none" stroke="#a87817" stroke-width="1.2"/><path d="M8.6 9.4 10.2 15l1.8-4.2L13.8 15l1.6-5.6" fill="none" stroke="#7a5510" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'
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
.wv-haut-droite{position:absolute;top:calc(14px + env(safe-area-inset-top,0px));right:calc(14px + env(safe-area-inset-right,0px));display:flex;gap:8px;pointer-events:auto;z-index:4}
.wv-bouton[hidden]{display:none}
.wv-bouton{width:42px;height:42px;border-radius:50%;border:1px solid rgba(255,255,255,.2);background:rgba(6,14,26,.68);color:#dfe7ef;display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0;-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);transition:background .2s,color .2s,border-color .2s}
.wv-bouton:hover{background:rgba(20,44,72,.85);color:#fff;border-color:rgba(255,255,255,.4)}
.wv-bouton:focus-visible,.wv-cta:focus-visible{outline:2px solid #4FB4FF;outline-offset:2px}
.wv-viseur{position:absolute;left:50%;top:50%;width:6px;height:6px;margin:-3px 0 0 -3px;border-radius:50%;background:rgba(255,255,255,.8);box-shadow:0 0 0 2px rgba(0,0,0,.35);transition:transform .2s,background .2s,opacity .7s}
.wv-haut-gauche,.wv-gains{transition:opacity .8s ease}
.wv-viseur.actif{transform:scale(2.6);background:#4FB4FF}
.wv-viseur.cache{opacity:0}
.wv-invite{position:absolute;left:50%;bottom:calc(64px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);display:flex;align-items:center;gap:10px;padding:10px 18px;border-radius:999px;background:rgba(6,14,26,.8);border:1px solid rgba(79,180,255,.5);font-size:14px;font-weight:500;color:#fff;white-space:nowrap;box-shadow:0 10px 34px rgba(0,0,0,.45);max-width:94vw}
.wv-invite[hidden]{display:none}
.wv-invite small{color:#9fb0c2;font-size:12px;font-weight:400}
.wv-touche{display:inline-flex;align-items:center;justify-content:center;min-width:26px;height:26px;padding:0 7px;border-radius:7px;border:1px solid rgba(255,255,255,.4);background:rgba(255,255,255,.12);font-size:12px;font-weight:700;color:#fff}
.wv-gain{position:absolute;left:50%;top:11%;transform:translate(-50%,0);font-size:clamp(36px,7vw,76px);font-weight:700;letter-spacing:-.02em;color:#ffe08a;text-shadow:0 0 34px rgba(255,200,80,.65),0 4px 24px rgba(0,0,0,.65);opacity:0;pointer-events:none;white-space:nowrap;text-align:center;line-height:1.05}
.wv-gain small{display:block;font-size:.26em;letter-spacing:.22em;text-transform:uppercase;color:#fff;font-weight:500;margin-top:6px}
.wv-gain.anim{animation:wvGain 2.8s cubic-bezier(.2,.7,.2,1) forwards}
.wv-plus{position:absolute;top:calc(196px + env(safe-area-inset-top,0px));left:calc(16px + env(safe-area-inset-left,0px));font-size:22px;font-weight:700;color:#ffe08a;text-shadow:0 0 18px rgba(255,200,80,.6),0 2px 10px rgba(0,0,0,.7);opacity:0;pointer-events:none;white-space:nowrap}
.wv-plus.anim{animation:wvPlus 2.2s cubic-bezier(.2,.7,.2,1) forwards}
@keyframes wvPlus{0%{opacity:0;transform:translateY(10px)}14%{opacity:1;transform:translateY(0)}72%{opacity:1}100%{opacity:0;transform:translateY(-22px)}}
@keyframes wvGain{0%{opacity:0;transform:translate(-50%,26px) scale(.7)}12%{opacity:1;transform:translate(-50%,0) scale(1.08)}22%{transform:translate(-50%,0) scale(1)}78%{opacity:1}100%{opacity:0;transform:translate(-50%,-44px) scale(1)}}
.wv-gains{position:absolute;right:14px;top:50%;transform:translateY(-50%);width:288px;padding:14px 16px}
.wv-gains[hidden]{display:none}
.wv-gains h3{margin:0 0 10px;font-size:11px;font-weight:500;letter-spacing:.18em;text-transform:uppercase;color:#9fb0c2}
.wv-gains ul{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.wv-gains li{display:flex;justify-content:space-between;gap:10px;font-size:13px;color:#dfe7ef;font-weight:400}
.wv-gains li b{font-weight:700;color:#ffe08a;font-variant-numeric:tabular-nums;white-space:nowrap}
.wv-message{position:absolute;left:50%;top:max(20%,200px);transform:translateX(-50%);padding:12px 18px;border-radius:14px;background:rgba(6,14,26,.88);border:1px solid rgba(255,255,255,.22);font-size:14px;max-width:min(440px,88vw);text-align:center;line-height:1.5;color:#fff}
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
.wv-bourse{margin-top:9px;align-items:center}
.wv-bourse[hidden]{display:none}
.wv-piece{display:inline-flex;align-items:center;gap:7px;font-size:13px;font-weight:600;color:#ffe08a}
.wv-piece b{font-weight:700;font-variant-numeric:tabular-nums}
.wv-ico{flex:none;display:block}
.wv-boosters{font-size:11px;font-weight:500;letter-spacing:.06em;color:#9fb0c2;white-space:nowrap}
.wv-panneau.wv-boutique{width:min(760px,100%);padding:26px 28px 22px}
.wv-vitrine{display:grid;grid-template-columns:minmax(150px,240px) 1fr;gap:28px;align-items:center}
.wv-pack{display:flex;justify-content:center;perspective:900px}
.wv-pack img{width:100%;max-width:220px;height:auto;display:block;filter:drop-shadow(0 18px 26px rgba(0,0,0,.6)) drop-shadow(0 0 22px rgba(79,180,255,.22));transform:rotateY(-16deg) rotateX(4deg);animation:wvPack 6s ease-in-out infinite}
@keyframes wvPack{0%,100%{transform:rotateY(-16deg) rotateX(4deg) translateY(0)}50%{transform:rotateY(16deg) rotateX(2deg) translateY(-6px)}}
.wv-panneau .wv-parole{margin:0 0 14px;padding-left:12px;border-left:2px solid #4FB4FF;font-size:14px;line-height:1.55;color:#dfe7ef;font-style:italic;font-weight:300}
.wv-panneau:focus{outline:none}
.wv-prix{display:flex;align-items:baseline;gap:9px;margin:0 0 12px}
.wv-prix b{font-size:30px;font-weight:700;color:#ffe08a;font-variant-numeric:tabular-nums}
.wv-prix span{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#9fb0c2}
.wv-portefeuille{display:flex;gap:6px 18px;flex-wrap:wrap;margin:0 0 16px;font-size:13px;color:#c4ccd6}
.wv-portefeuille b{color:#fff;font-weight:600;font-variant-numeric:tabular-nums}
.wv-achat{display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin-bottom:12px}
.wv-quantite{display:inline-flex;align-items:center;border:1px solid rgba(255,255,255,.22);border-radius:999px;overflow:hidden}
.wv-quantite button{width:40px;height:42px;background:transparent;border:0;color:#fff;font:600 20px 'Public Sans',system-ui,sans-serif;cursor:pointer}
.wv-quantite button:hover:not(:disabled){background:rgba(255,255,255,.1)}
.wv-quantite button:focus-visible{outline:2px solid #4FB4FF;outline-offset:-3px}
.wv-quantite button:disabled{opacity:.35;cursor:default}
.wv-quantite span{min-width:36px;text-align:center;font-weight:700;font-variant-numeric:tabular-nums}
.wv-cta:disabled{opacity:.45;cursor:default}
.wv-panneau .wv-alerte{margin:0 0 12px;padding:10px 14px;border-radius:12px;background:rgba(229,105,92,.14);border:1px solid rgba(229,105,92,.45);font-size:13px;line-height:1.5;color:#ffc8c0;font-weight:400}
.wv-panneau .wv-reussite{margin:0 0 12px;padding:10px 14px;border-radius:12px;background:rgba(80,200,140,.13);border:1px solid rgba(80,200,140,.4);font-size:13px;line-height:1.5;color:#c6f1d9;font-weight:400}
.wv-panneau .wv-note{margin:10px 0 0;font-size:12px;line-height:1.5;color:#8a9bb0}
@media (min-width:761px){
  .wv-ecran.wv-ecran-boutique{justify-content:flex-end;padding-right:4vw;background:linear-gradient(90deg,rgba(2,6,12,0) 12%,rgba(2,6,12,.6) 52%,rgba(2,6,12,.88) 100%);-webkit-backdrop-filter:none;backdrop-filter:none}
  .wv-panneau.wv-boutique{width:min(620px,60vw)}
  .wv-boutique .wv-vitrine{grid-template-columns:minmax(120px,190px) 1fr;gap:22px}
}
.wv-cine{position:absolute;inset:0;pointer-events:none;z-index:2}
.wv-cine::before,.wv-cine::after{content:'';position:absolute;left:0;right:0;height:0;background:#000;transition:height .9s cubic-bezier(.2,.7,.2,1)}
.wv-cine::before{top:0}
.wv-cine::after{bottom:0}
.wv-intro .wv-cine::before,.wv-intro .wv-cine::after{height:11vh}
.wv-titre{position:absolute;left:0;right:0;bottom:17vh;padding:0 20px;text-align:center;opacity:0;color:#fff;text-shadow:0 2px 24px rgba(0,0,0,.75)}
.wv-titre span{display:block;margin-bottom:8px;font-size:clamp(11px,1.5vw,14px);font-weight:500;letter-spacing:.32em;text-transform:uppercase;color:#f0d9a8}
.wv-titre b{font-size:clamp(26px,4.6vw,52px);font-weight:700;letter-spacing:-.01em;line-height:1.1}
.wv-intro .wv-titre{animation:wvTitre 4.2s ease .9s both}
@keyframes wvTitre{0%{opacity:0;transform:translateY(14px)}18%{opacity:1;transform:none}78%{opacity:1}100%{opacity:0}}
.wv-fondu{position:absolute;inset:0;background:#000;opacity:0;pointer-events:none;z-index:3}
.wv-intro .wv-fondu{animation:wvFondu 1.3s ease-out both}
@keyframes wvFondu{0%{opacity:1}100%{opacity:0}}
.wv-passer{position:absolute;right:calc(18px + env(safe-area-inset-right,0px));bottom:calc(2.4vh + env(safe-area-inset-bottom,0px));z-index:4;display:none;padding:7px 16px;border-radius:999px;border:1px solid rgba(255,255,255,.35);background:rgba(0,0,0,.35);color:#e8eaed;font:500 12px 'Public Sans',system-ui,sans-serif;letter-spacing:.14em;text-transform:uppercase;cursor:pointer}
.wv-passer:hover{background:rgba(255,255,255,.14)}
.wv-intro .wv-passer{display:block}
.wv-intro .wv-haut-gauche,.wv-intro .wv-gains,.wv-intro .wv-viseur,.wv-intro .wv-invite{opacity:0}
.wv-intro .wv-tactile{opacity:0;pointer-events:none}
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
  .wv-gain{top:26%}
  .wv-message{top:30%}
  .wv-vitrine{grid-template-columns:1fr;gap:14px}
  .wv-pack img{max-width:120px}
  .wv-panneau.wv-boutique{padding:18px 18px 16px}
  /* Les notifications du site ne doivent pas couvrir TIRER et Reculer :
     en jeu, elles se rangent sous les cartes du haut. */
  body.wv-en-jeu .notif-zone{top:calc(310px + env(safe-area-inset-top,0px));bottom:auto}
  .wv-panneau{padding:22px 20px 20px}
  .wv-panneau h2{font-size:22px}
}
@media (max-height:520px){
  .wv-message{top:110px}
  .wv-boutique .wv-pack{display:none}
  .wv-panneau.wv-boutique{padding:14px 16px}
  .wv-boutique h2{font-size:18px;margin:4px 0 8px}
  .wv-boutique .wv-parole{margin-bottom:8px}
  .wv-boutique .wv-prix{margin-bottom:8px}
  .wv-boutique .wv-prix b{font-size:22px}
  .wv-boutique .wv-portefeuille{margin-bottom:10px}
  .wv-panneau .wv-note{display:none}
  .wv-haut-gauche .wv-carte:nth-child(2){display:none}
  body.wv-en-jeu .notif-zone{top:14px;bottom:auto;left:264px;right:170px;max-width:none}
}
.wv-cartes-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
.wv-cartes-actions .wv-cta{padding:9px 16px;font-size:13px}

.wv-en-ouverture .wv-haut-gauche,.wv-en-ouverture .wv-viseur,.wv-en-ouverture .wv-invite,.wv-en-ouverture .wv-gains{display:none}
.wv-ouv{position:absolute;inset:0;z-index:4;pointer-events:none;display:flex;flex-direction:column;justify-content:space-between;align-items:center;padding:calc(16px + env(safe-area-inset-top,0px)) 16px calc(22px + env(safe-area-inset-bottom,0px))}
.wv-ouv[hidden]{display:none}
.wv-ouv-haut{text-align:center;max-width:calc(100% - 200px);min-height:28px}
.wv-ouv-haut h2{margin:0;font-size:clamp(20px,3.4vw,32px);font-weight:700;letter-spacing:.01em;color:#fff;text-shadow:0 2px 14px rgba(0,0,0,.6)}
.wv-ouv-haut p{margin:6px 0 0;font-size:15px;line-height:1.4;color:#b4cde4;text-shadow:0 1px 8px rgba(0,0,0,.6)}
.wv-ouv-bas{display:flex;flex-direction:column;align-items:center;gap:12px;width:100%}
.wv-ouv-indice{margin:0;font-size:15px;letter-spacing:.02em;color:#d3e3f3;text-shadow:0 1px 10px rgba(0,0,0,.75)}
.wv-ouv-indice[hidden]{display:none}
.wv-ouv-actions{display:flex;flex-wrap:wrap;justify-content:center;gap:10px;pointer-events:auto}
.wv-ouv-actions[hidden]{display:none}
.wv-ouv-actions .wv-cta[hidden]{display:none}
.wv-ouv-flash{position:absolute;inset:0;pointer-events:none;opacity:0;mix-blend-mode:screen}
.wv-ouv-flash.on{animation:wvOuvEclair .75s ease-out}
@keyframes wvOuvEclair{0%{opacity:var(--wv-force,.5)}100%{opacity:0}}
.wv-ouv-etiq-zone{position:absolute;inset:0;pointer-events:none;overflow:hidden}
.wv-ouv-etiq{position:absolute;transform:translate(-50%,0);padding:3px 10px;border-radius:99px;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;white-space:nowrap;background:rgba(6,14,26,.8);border:1px solid rgba(255,255,255,.22);color:#cfe0f0}
.wv-ouv-etiq.nouvelle{background:linear-gradient(135deg,#ffd36b,#ff9f43);color:#2a1800;border-color:transparent}

.wv-ecran.wv-ecran-collection{padding:14px}
.wv-panneau.wv-collection{position:relative;width:min(1000px,100%);max-height:100%;padding:22px 24px 20px;display:flex;flex-direction:column;gap:12px;overflow:hidden}
.wv-coll-tete{display:flex;align-items:flex-end;justify-content:space-between;gap:12px}
.wv-coll-tete h2{margin:4px 0 0}
.wv-panneau .wv-coll-compte{margin:0;font-size:22px;font-weight:700;letter-spacing:-.01em;color:#ffd36b;font-variant-numeric:tabular-nums}
.wv-coll-filtres{display:flex;flex-wrap:wrap;gap:6px}
.wv-coll-filtres button{padding:7px 14px;border-radius:99px;border:1px solid rgba(255,255,255,.2);background:transparent;color:#cfd8e3;font:600 12.5px 'Public Sans',system-ui,sans-serif;cursor:pointer}
.wv-coll-filtres button[aria-pressed="true"]{background:#1489de;border-color:#1489de;color:#fff}
.wv-coll-filtres button:focus-visible{outline:2px solid #4FB4FF;outline-offset:2px}
.wv-coll-grille{display:grid;grid-template-columns:repeat(auto-fill,minmax(112px,1fr));gap:12px;align-items:start;align-content:start;overflow:auto;min-height:120px;padding:4px 2px 8px;flex:1 1 auto}
.wv-panneau .wv-coll-charge{grid-column:1/-1;margin:20px 0;text-align:center;color:#8a9bb0}
.wv-coll-grille .wv-alerte{grid-column:1/-1}
.wv-tuile{position:relative;display:block;width:100%;height:0;padding:0 0 139.84%;border:0;background:none;border-radius:6.6%/4.75%;cursor:pointer;color:inherit;font:inherit;overflow:hidden;transition:transform .18s}
.wv-tuile canvas{position:absolute;left:0;top:0;display:block;width:100%;height:100%}
.wv-tuile:hover{transform:translateY(-3px) scale(1.03)}
.wv-tuile:focus-visible{outline:2px solid #4FB4FF;outline-offset:3px}
.wv-tuile.vide{cursor:default;background:rgba(255,255,255,.04);box-shadow:inset 0 0 0 1px rgba(255,255,255,.14)}
.wv-tuile-fond{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px}
.wv-tuile.vide:hover{transform:none}
.wv-tuile-pt{font-size:30px;font-weight:700;color:rgba(255,255,255,.22)}
.wv-tuile-num{font-size:12px;letter-spacing:.14em;color:rgba(255,255,255,.32);font-weight:600}
.wv-tuile-qte{position:absolute;right:6px;top:6px;padding:2px 7px;border-radius:99px;background:rgba(6,14,26,.86);border:1px solid rgba(255,255,255,.25);font-size:11px;font-weight:700;color:#fff}
.wv-coll-grille[data-filtre="commune"] .wv-tuile:not(.rar-commune),
.wv-coll-grille[data-filtre="rare"] .wv-tuile:not(.rar-rare),
.wv-coll-grille[data-filtre="epique"] .wv-tuile:not(.rar-epique),
.wv-coll-grille[data-filtre="legendaire"] .wv-tuile:not(.rar-legendaire){display:none}
.wv-coll-zoom{position:absolute;inset:0;z-index:2;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:16px;border-radius:20px;background:rgba(3,8,16,.95)}
.wv-coll-zoom[hidden]{display:none}
.wv-zoom-scene{position:relative;height:min(62vh,560px);aspect-ratio:512/716;perspective:900px;transform:rotateX(var(--rx,0deg)) rotateY(var(--ry,0deg));transition:transform .12s ease-out;border-radius:6.6%/4.75%;box-shadow:0 20px 60px rgba(0,0,0,.6);overflow:hidden;--mx:50%;--my:50%}
.wv-zoom-carte{display:block;width:100%;height:100%}
.wv-zoom-reflet{position:absolute;inset:0;border-radius:inherit;pointer-events:none;opacity:0;mix-blend-mode:color-dodge}
.wv-zoom-scene.rar-rare .wv-zoom-reflet,.wv-zoom-scene.rar-epique .wv-zoom-reflet,.wv-zoom-scene.rar-legendaire .wv-zoom-reflet{opacity:.26;background:radial-gradient(circle at var(--mx) var(--my),rgba(255,255,255,.9),rgba(255,255,255,0) 40%),linear-gradient(115deg,rgba(255,0,128,.55),rgba(255,210,80,.55),rgba(60,255,190,.55),rgba(80,150,255,.55),rgba(200,90,255,.55))}
.wv-zoom-scene.rar-epique .wv-zoom-reflet{opacity:.34}
.wv-zoom-scene.rar-legendaire .wv-zoom-reflet{opacity:.42}
.wv-panneau .wv-zoom-legende{margin:0;font-size:14px;color:#cfe0f0;text-align:center}
@media (max-width:760px){
  .wv-panneau.wv-collection{padding:16px 14px 14px}
  .wv-coll-grille{grid-template-columns:repeat(auto-fill,minmax(92px,1fr));gap:9px}
  .wv-ouv-haut{padding-top:54px}
}
@media (max-height:520px){
  .wv-panneau.wv-collection{padding:12px 14px}
  .wv-coll-tete h2{font-size:18px}
  .wv-zoom-scene{height:min(70vh,560px)}
  .wv-ouv-bas{gap:8px}
}
@media (prefers-reduced-motion:reduce){
  .wv-gain.anim,.wv-plus.anim{animation:wvGainDoux 2.6s linear forwards}
  .wv-barre span{transition:none}
  .wv-pack img{animation:none;transform:rotateY(-8deg) rotateX(4deg)}
  .wv-ouv-flash.on{animation-duration:.01s}
  .wv-tuile,.wv-zoom-scene{transition:none}
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
      <div class="wv-ligne wv-bourse" id="wvBourse" hidden>
        <span class="wv-piece">${ICONES_UI.piece}<b id="wvPieces">—</b></span>
        <span class="wv-boosters" id="wvBoosters"></span>
      </div>
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
<div class="wv-cine" aria-hidden="true">
  <div class="wv-titre"><span>Bienvenue dans</span><b>L’espace des waveurs</b></div>
</div>
<div class="wv-fondu" aria-hidden="true"></div>
<button type="button" class="wv-passer" id="wvPasser">Passer</button>
<div class="wv-ouv" id="wvOuv" hidden>
  <div class="wv-ouv-etiq-zone" id="wvOuvEtiq"></div>
  <div class="wv-ouv-flash" id="wvOuvFlash" aria-hidden="true"></div>
  <div class="wv-ouv-haut">
    <h2 id="wvOuvTitre"></h2>
    <p id="wvOuvResume" hidden></p>
  </div>
  <div class="wv-ouv-bas">
    <p class="wv-ouv-indice" id="wvOuvIndice" role="status" aria-live="polite"></p>
    <div class="wv-ouv-actions">
      <button type="button" class="wv-cta" id="wvOuvAction">Ouvrir le booster</button>
      <button type="button" class="wv-cta discret" id="wvOuvPasser" hidden>Tout révéler</button>
    </div>
    <div class="wv-ouv-actions" id="wvOuvBilan" hidden>
      <button type="button" class="wv-cta" id="wvOuvAutre">Ouvrir un autre booster</button>
      <button type="button" class="wv-cta discret" id="wvOuvAlbum">Ma collection</button>
      <button type="button" class="wv-cta discret" id="wvOuvFin">Terminer</button>
    </div>
  </div>
</div>
<div class="wv-ecran" id="wvEcran" hidden></div>
`;


/* ----------------------------------------------------------------------
   État du jeu
   ---------------------------------------------------------------------- */

let options = {};
let overlay = null;
let H = {};                       // éléments de l'interface

let sessionJeu = 0;               // change à chaque entrée et sortie de la salle
let renderer = null, scene = null, camera = null;
let pret = false;                 // la salle est construite
let actif = false;                // la salle est ouverte
let raf = 0, dernier = 0, temps = 0;
let ratioMax = 1.75, ratioActuel = 1, lentes = 0;

const R = {};                     // ressources partagées
const machines = [];
let croupier = null;
const colliders = [];
const animes = { neons: [], poussiere: null, pieces: null };

const joueur = { x: DEPART.x, z: DEPART.z, yaw: 0, pitch: 0, phase: 0, vitesse: 0 };

const focus = { machine: null, cible: 0, t: 0 };

// L'aide du téléphone ne s'affiche qu'une fois par visite du site.
let aideTactileVue = false;

const etat = {
  intro: false,                   // le travelling d'ouverture est en cours
  introT: 0,                      // son avancement, en secondes
  introRapide: false,             // on l'a passé : il se termine en accéléré
  ecran: null,                    // 'chargement' | 'pause' | 'connexion' | 'erreur'
  sansVerrou: false,              // le navigateur refuse le verrouillage du pointeur
  tactile: false,
  reduit: false,
  enTirage: false,
  cible: null,                    // ce que le joueur vise
  tours: null,                    // { restants, parJour, gagne }
  bourse: null,                   // { pieces, boosters, prix } : le portefeuille
  qte: 1,                         // combien de boosters à l'achat
  achat: false,                   // un achat est en cours
  alerte: null,                   // ce que la boutique a à dire de travers
  remarque: null,                 // ce que dit le croupier
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
    bourse: q('wvBourse'), pieces: q('wvPieces'), boosters: q('wvBoosters'),
    son: q('wvSon'), plein: q('wvPlein'), quitter: q('wvQuitter'),
    viseur: q('wvViseur'), invite: q('wvInvite'), gain: q('wvGain'), plus: q('wvPlus'),
    gains: q('wvGains'), message: q('wvMessage'), ecran: q('wvEcran'),
    tactile: q('wvTactile'), joy: q('wvJoy'), pouce: q('wvPouce'),
    action: q('wvAction'), reculer: q('wvReculer'), passer: q('wvPasser'),
    ouv: q('wvOuv'), ouvEtiq: q('wvOuvEtiq'), ouvFlash: q('wvOuvFlash'), ouvTitre: q('wvOuvTitre'),
    ouvResume: q('wvOuvResume'), ouvIndice: q('wvOuvIndice'), ouvAction: q('wvOuvAction'),
    ouvPasser: q('wvOuvPasser'), ouvBilan: q('wvOuvBilan'), ouvAutre: q('wvOuvAutre'),
    ouvAlbum: q('wvOuvAlbum'), ouvFin: q('wvOuvFin')
  };

  // Safari sur iPhone n'offre pas le plein écran pour un élément : le
  // bouton ne ferait rien, on ne l'affiche pas.
  if(!overlay.requestFullscreen && !overlay.webkitRequestFullscreen) H.plein.hidden = true;

  H.son.addEventListener('click', basculerSon);
  H.plein.addEventListener('click', basculerPleinEcran);
  H.quitter.addEventListener('click', quitter);
  H.action.addEventListener('click', actionPrincipale);
  H.reculer.addEventListener('click', sortirFocus);
  H.passer.addEventListener('click', passerIntro);

  H.ouvAction.addEventListener('click', avancerOuverture);
  H.ouvPasser.addEventListener('click', toutRevelerOuverture);
  H.ouvAutre.addEventListener('click', ouvrirUnAutre);
  H.ouvAlbum.addEventListener('click', () => { fermerOuverture(true); ouvrirCollection(); });
  H.ouvFin.addEventListener('click', () => fermerOuverture(true));

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

  // Les effets de rendu (halo, étalonnage, reflets du sol). Les reflets sont
  // réservés aux ordinateurs : sur un téléphone, un second rendu de la salle
  // coûterait trop.
  creerPost();
  if(!etat.tactile) creerReflet();

  H.canvas.addEventListener('webglcontextlost', e => {
    e.preventDefault();
    montrerEcran('erreur', "Le rendu 3D a été interrompu par ton navigateur. Quitte la salle et rentre à nouveau.");
  });

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0706);
  scene.fog = new THREE.FogExp2(0x0d0806, 0.017);

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
    size: 0.06 * ECHELLE_MACHINE, map: halo, vertexColors: true, transparent: true,
    depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true
  });

  // Les matériaux de la salle. Le laiton et le cuivre n'ont rien à refléter
  // (pas d'environnement) : leur éclat vient des reflets des lampes.
  R.matLaiton = new THREE.MeshPhongMaterial({
    vertexColors: true, specular: 0xb8a070, shininess: 45, side: THREE.DoubleSide
  });
  R.matLaitonUni = new THREE.MeshPhongMaterial({ color: OR, specular: 0xb8a070, shininess: 45 });
  R.matBois = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.05 });
  R.matTissu = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 });
  R.matLed = new THREE.MeshBasicMaterial({ vertexColors: true });
  R.matHumain = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.68, metalness: 0 });

  // Un liseré chaud sur le contour des personnages : c'est ce qui les détache
  // d'un mur sombre, et donne à la peau un peu de la lumière de la salle.
  R.matHumain.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <dithering_fragment>', `
      float lisere = pow(1.0 - clamp(dot(normalize(vNormal), normalize(vViewPosition)), 0.0, 1.0), 2.6);
      gl_FragColor.rgb += lisere * vec3(0.30, 0.22, 0.15) * 0.36;
      #include <dithering_fragment>`);
  };

  R.modele = construireModeleMachine();
  R.halo = halo;

  HALOS.pos = [];
  HALOS.col = [];

  construireSalle();
  construireBar();
  construireMobilier();
  construireMachine();
  construireBoutique();
  construireHabitues();
  construireJetons();
  construireLumieres();
  construireAmbiance();

  pret = true;
  redimensionner();
}

// Les halos de toutes les lampes de la salle : un seul nuage de points.
const HALOS = { pos: [], col: [] };

function poserHalo(x, y, z, couleur){
  const c = new THREE.Color(couleur);
  HALOS.pos.push(x, y, z);
  HALOS.col.push(c.r, c.g, c.b);
}

// Colle une liste de formes en un seul objet, pour un seul appel de dessin.
function fusion(liste, materiau){
  if(!liste.length) return null;
  const m = new THREE.Mesh(fusionner(liste), materiau);
  scene.add(m);
  return m;
}

// Pose des formes construites autour de l'origine, tournées puis déplacées.
function poser(cible, source, x, z, rot){
  ['tissu', 'laiton', 'bois'].forEach(k => {
    (source[k] || []).forEach(g => {
      if(rot) g.rotateY(rot);
      g.translate(x, 0, z);
      cible[k].push(g);
    });
  });
}

function construireSalle(){

  const L = SALLE.l, P = SALLE.p, Ht = SALLE.h;

  // ---- Lumières : chaudes, comme dans un bar, avec un fil bleu La Wave ----
  //
  // Un fond d'hémisphère assez fort pour que rien ne soit noir, puis une
  // lampe par « quartier » de la salle : chacune éclaire ce qui s'y passe
  // (les habitués du bar, les tables de jeu, la banquette), plutôt que de
  // tout baigner d'une seule lumière. Le nombre est compté : chaque lampe se
  // paie à chaque image, sur chaque surface.
  scene.add(new THREE.HemisphereLight(0xffe9d2, 0x5e3d2a, 1.05));

  [
    [0, 4.2, 0.6, 0xffe2bc, 1.35, 14],          // le lustre, sur la machine et le podium
    [-2.4, 2.7, -5.2, 0xffbd75, 1.1, 8.5],      // le bar, côté gauche
    [2.4, 2.7, -5.2, 0xffbd75, 1.1, 8.5],       // le bar, côté droit
    [-5.4, 3.1, 2.6, 0xffcf9a, 1.0, 8.5],       // le blackjack et son croupier
    [5.4, 3.2, 4.4, 0xffd7a8, 1.0, 8.5],        // le poker
    [5.6, 3.0, -2.4, 0xffc58e, 0.95, 8],        // la banquette
    [0, 3.4, 7.2, 0xffe9d2, 0.85, 11],          // l'entrée
    [0, 2.2, -2.0, 0x39b8ff, 0.5, 7]            // le fil bleu La Wave
  ].forEach(([x, y, z, c, i, d]) => {
    const l = new THREE.PointLight(c, i, d, 1.2);
    l.position.set(x, y, z);
    scene.add(l);
  });

  // ---- Sol : parquet, tapis, estrade de la machine ----
  // Le parquet et le podium reflètent ce qui est au-dessus d'eux (voir
  // refleter) ; le tapis, velours mat, n'en garde qu'un voile aux angles
  // rasants.
  const sol = new THREE.Mesh(
    new THREE.PlaneGeometry(L * 2, P * 2),
    refleter(new THREE.MeshPhongMaterial({
      map: R.texture(creerParquet(), { repete: true, rx: L, ry: P }),
      specular: 0x6a5238, shininess: 46
    }), 0.34, 0.010)
  );
  sol.rotation.x = -Math.PI / 2;
  scene.add(sol);

  const tapis = new THREE.Mesh(
    new THREE.PlaneGeometry(11, 13.75),
    refleter(new THREE.MeshPhongMaterial({
      map: R.texture(creerTapis(R.logo)), color: 0xbca8aa, specular: 0x1a0a0c, shininess: 6
    }), 0.05, 0.02)
  );
  tapis.rotation.x = -Math.PI / 2;
  tapis.position.set(0, 0.008, 0.5);
  scene.add(tapis);

  const estrade = new THREE.Mesh(
    new THREE.CylinderGeometry(RAYON_PODIUM, RAYON_PODIUM + 0.07, 0.14, 56),
    new THREE.MeshPhongMaterial({ color: 0x3a0f1a, specular: 0x554444, shininess: 26 })
  );
  estrade.position.y = 0.07;
  scene.add(estrade);

  const dessus = new THREE.Mesh(
    new THREE.CircleGeometry(RAYON_PODIUM, 56),
    refleter(new THREE.MeshPhongMaterial({
      map: R.texture(creerEstrade()), specular: 0x7a6650, shininess: 70
    }), 0.78, 0.004, 0.42)
  );
  dessus.rotation.x = -Math.PI / 2;
  dessus.position.y = 0.142;
  scene.add(dessus);

  if(REFLET.actif) REFLET.surfaces.push(sol, tapis, dessus);

  const bord = new THREE.Mesh(new THREE.TorusGeometry(RAYON_PODIUM + 0.03, 0.028, 8, 72), R.matLaitonUni);
  bord.rotation.x = Math.PI / 2;
  bord.position.y = 0.14;
  scene.add(bord);

  // ---- Plafond à caissons ----
  const plafond = new THREE.Mesh(
    new THREE.PlaneGeometry(L * 2, P * 2),
    new THREE.MeshLambertMaterial({
      map: R.texture(creerPlafond(), { repete: true, rx: L * 2 / 2.5, ry: P * 2 / 2.5 })
    })
  );
  plafond.rotation.x = Math.PI / 2;
  plafond.position.y = Ht;
  scene.add(plafond);

  // ---- Murs : marbre sombre, soubassement de lattes, garnitures ----
  const marbre = creerMarbre('#2e2d35', '#9d9aa8', '#d6b06a', 16);
  const lattes = creerLattes();

  const bois = [], laiton = [], led = [];

  [
    { l: L * 2, x: 0, z: -P, r: 0 },
    { l: L * 2, x: 0, z: P, r: Math.PI },
    { l: P * 2, x: -L, z: 0, r: Math.PI / 2 },
    { l: P * 2, x: L, z: 0, r: -Math.PI / 2 }
  ].forEach(m => {

    // Le mur regarde vers l'intérieur : (nx, nz) est sa normale.
    const nx = Math.sin(m.r), nz = Math.cos(m.r);

    const placer = (mesh, y, ecart) => {
      mesh.position.set(m.x + nx * ecart, y, m.z + nz * ecart);
      mesh.rotation.y = m.r;
      scene.add(mesh);
    };

    placer(new THREE.Mesh(
      new THREE.PlaneGeometry(m.l, Ht),
      new THREE.MeshLambertMaterial({ map: R.texture(marbre, { repete: true, rx: m.l / 1.8, ry: Ht / 1.8 }) })
    ), Ht / 2, 0);

    placer(new THREE.Mesh(
      new THREE.PlaneGeometry(m.l, 1.0),
      new THREE.MeshLambertMaterial({ map: R.texture(lattes, { repete: true, rx: m.l / 0.8, ry: 1 }) })
    ), 0.5, 0.02);

    // Les garnitures sont dessinées à plat contre le mur (x le long du mur,
    // z vers la pièce), puis tournées à sa place.
    const loc = (liste, ...formes) => formes.forEach(g => {
      g.rotateY(m.r);
      g.translate(m.x, 0, m.z);
      liste.push(g);
    });

    loc(laiton,
      boite(m.l, 0.05, 0.05, 0, 1.03, 0.04, LAITON),
      boite(m.l, 0.04, 0.16, 0, Ht - 0.34, 0.09, LAITON));
    loc(bois,
      boite(m.l, 0.12, 0.05, 0, 0.06, 0.035, '#160d07'),
      boite(m.l, 0.3, 0.16, 0, Ht - 0.15, 0.08, '#1a100a'));
    loc(led, boite(m.l - 0.3, 0.03, 0.03, 0, Ht - 0.4, 0.07, '#ffb35e'));

    // Des montants de laiton, tous les 2,5 m environ.
    const n = Math.round(m.l / 2.5);
    const hauteur = Ht - 1.4;
    for(let i = 1; i < n; i++){
      const x = -m.l / 2 + i * m.l / n;
      // Celui du milieu de la façade d'entrée passerait devant la porte, et
      // un montant du mur de gauche couperait l'enseigne du croupier (le
      // long de ce mur, la position x du mur est l'opposée du z du monde).
      if(m.r === Math.PI && Math.abs(x) < 1.6) continue;
      if(m.r === Math.PI / 2 && Math.abs(-x - CROUPIER.z) < 0.9) continue;
      loc(laiton, boite(0.05, hauteur, 0.03, x, 1.06 + hauteur / 2, 0.03, LAITON));
    }
  });

  fusion(laiton, R.matLaiton);
  fusion(bois, R.matBois);
  fusion(led, R.matLed);

  // ---- Une vague de néon discrète, sur les murs de côté ----
  const texNeon = creerNeonVague('#39b8ff');
  [-1, 1].forEach(s => {
    const t = R.texture(texNeon, { repete: true, rx: (P * 2 - 1) / 5, ry: 1 });
    const p = new THREE.Mesh(
      new THREE.PlaneGeometry(P * 2 - 1, 0.42),
      new THREE.MeshBasicMaterial({ map: t, transparent: true, opacity: 0.45, depthWrite: false })
    );
    p.position.set(s * (L - 0.02), 3.55, 0);
    p.rotation.y = -s * Math.PI / 2;
    scene.add(p);
  });

  // ---- Des disques d'or, le long des murs de côté, sous une lampe ----
  R.matLueurMur = new THREE.MeshBasicMaterial({
    map: R.texture(creerLueurMur()), color: 0xffc887, transparent: true, opacity: 0.5,
    depthWrite: false, blending: THREE.AdditiveBlending
  });

  const disque = R.texture(creerDisqueOr(R.logo));
  const petits = [];

  [-1, 1].forEach(s => {
    [-6.4, -0.4, 5.6].forEach(z => {

      const cadre = new THREE.Mesh(
        new THREE.PlaneGeometry(0.9, 0.9),
        new THREE.MeshBasicMaterial({ map: disque, color: 0xd8d0c4 })
      );
      cadre.position.set(s * (L - 0.03), 2.25, z);
      cadre.rotation.y = -s * Math.PI / 2;
      scene.add(cadre);

      // La flaque de lumière de la lampe, sur le mur.
      const flaque = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 3.0), R.matLueurMur);
      flaque.position.set(s * (L - 0.028), 1.75, z);
      flaque.rotation.y = -s * Math.PI / 2;
      flaque.renderOrder = 1;
      scene.add(flaque);

      // La lampe de tableau : un bras de laiton et un peu de lumière.
      petits.push(boite(0.05, 0.05, 0.4, s * (L - 0.2), 2.85, z, LAITON));
      poserHalo(s * (L - 0.36), 2.8, z, '#ffcf8a');
    });
  });

  fusion(petits, R.matLaiton);

  // ---- La porte de sortie ----
  construirePorte();
}

function construirePorte(){

  const P = SALLE.p;
  const z = P - 0.05;

  const porte = fusionner([
    boite(1.2, 2.5, 0.08, -0.63, 1.25, z, '#2a170c'),
    boite(1.2, 2.5, 0.08, 0.63, 1.25, z, '#2a170c'),
    boite(2.7, 0.14, 0.14, 0, 2.6, z, '#8a6420'),
    boite(0.14, 2.6, 0.14, -1.28, 1.3, z, '#8a6420'),
    boite(0.14, 2.6, 0.14, 1.28, 1.3, z, '#8a6420'),
    boite(0.9, 1.9, 0.02, -0.63, 1.3, z - 0.05, '#3a2211'),
    boite(0.9, 1.9, 0.02, 0.63, 1.3, z - 0.05, '#3a2211'),
    boite(0.05, 0.9, 0.06, -0.12, 1.1, z - 0.06, LAITON),
    boite(0.05, 0.9, 0.06, 0.12, 1.1, z - 0.06, LAITON)
  ]);

  scene.add(new THREE.Mesh(porte, new THREE.MeshPhongMaterial({
    vertexColors: true, specular: 0x554422, shininess: 40
  })));

  const panneau = new THREE.Mesh(
    new THREE.PlaneGeometry(1.7, 0.42),
    new THREE.MeshBasicMaterial({
      map: R.texture(creerEnseigne('SORTIE', '#3ef0b0', 512, 128, 72)),
      transparent: true, depthWrite: false
    })
  );
  panneau.position.set(0, 3.05, z - 0.02);
  panneau.rotation.y = Math.PI;
  scene.add(panneau);

  R.porte = { x: 0, z: P - 0.6 };
}


/* ---- Le bar : comptoir, étagères, néons, tabourets ---- */

function construireBar(){

  const P = SALLE.p;
  const BOIS = '#22140b', CLAIR = '#d9d3c8';

  const bois = [], laiton = [], led = [], tissu = [];

  // Le comptoir : un U, dos au mur. La façade regarde la salle.
  bois.push(
    boite(9.0, 1.02, 0.78, 0, 0.51, -7.1, BOIS),
    boite(0.86, 1.02, 2.5, -4.07, 0.51, -8.75, BOIS),
    boite(0.86, 1.02, 2.5, 4.07, 0.51, -8.75, BOIS)
  );

  const lattes = R.texture(creerLattes(), { repete: true, rx: 9 / 0.8, ry: 1 });
  const facade = new THREE.Mesh(
    new THREE.PlaneGeometry(9.0, 0.96),
    new THREE.MeshLambertMaterial({ map: lattes })
  );
  facade.position.set(0, 0.52, -6.705);
  scene.add(facade);

  [-1, 1].forEach(s => {
    const flanc = new THREE.Mesh(
      new THREE.PlaneGeometry(2.5, 0.96),
      new THREE.MeshLambertMaterial({ map: R.texture(creerLattes(), { repete: true, rx: 2.5 / 0.8, ry: 1 }) })
    );
    flanc.position.set(s * 4.505, 0.52, -8.75);
    flanc.rotation.y = s * Math.PI / 2;
    scene.add(flanc);
  });

  // Le dessus : une dalle de marbre clair, qui déborde côté salle.
  const dalle = (l, p, x, z) => {
    bois.push(boite(l, 0.06, p, x, 1.05, z, CLAIR));
    const t = new THREE.Mesh(
      new THREE.PlaneGeometry(l, p),
      new THREE.MeshPhongMaterial({
        map: R.texture(R.marbreClair, { repete: true, rx: l / 1.8, ry: p / 1.8 }),
        specular: 0x888888, shininess: 70
      })
    );
    t.rotation.x = -Math.PI / 2;
    t.position.set(x, 1.081, z);
    scene.add(t);
  };

  R.marbreClair = creerMarbre('#e6e1d8', '#7c7468', '#b58f3f', 14);

  dalle(9.36, 1.16, 0, -7.08);
  dalle(1.02, 2.34, -4.11, -8.83);
  dalle(1.02, 2.34, 4.11, -8.83);

  // Filets de laiton, repose-pieds, lumière sous le débord.
  laiton.push(
    boite(9.0, 0.03, 0.03, 0, 0.98, -6.7, LAITON),
    boite(9.0, 0.03, 0.03, 0, 0.09, -6.7, LAITON)
  );

  const rail = new THREE.CylinderGeometry(0.028, 0.028, 8.8, 14);
  rail.rotateZ(Math.PI / 2);
  rail.translate(0, 0.2, -6.32);
  colorer(rail, LAITON);
  laiton.push(rail);

  for(let x = -3.6; x <= 3.7; x += 1.8){
    laiton.push(boite(0.03, 0.03, 0.4, x, 0.2, -6.5, LAITON));
  }

  led.push(
    boite(8.8, 0.02, 0.02, 0, 1.012, -6.62, '#ffb35e'),
    boite(8.8, 0.03, 0.03, 0, 0.13, -6.69, '#39d5ff')
  );

  // Le meuble arrière et ses étagères éclairées.
  bois.push(
    boite(7.2, 0.9, 0.55, 0, 0.45, -P + 0.275, BOIS),
    boite(7.3, 0.05, 0.6, 0, 0.925, -P + 0.3, CLAIR),
    boite(0.14, 2.75, 0.12, -3.67, 2.3, -P + 0.07, '#24150b'),
    boite(0.14, 2.75, 0.12, 3.67, 2.3, -P + 0.07, '#24150b'),
    boite(7.5, 0.14, 0.14, 0, 3.62, -P + 0.08, '#24150b')
  );
  laiton.push(boite(7.5, 0.03, 0.03, 0, 3.53, -P + 0.14, LAITON));

  const etageres = new THREE.Mesh(
    new THREE.PlaneGeometry(7.2, 2.6),
    new THREE.MeshBasicMaterial({ map: R.texture(creerEtageres()), color: 0xdddddd })
  );
  // Un peu en avant des montants de laiton des murs, qu'elle recouvre.
  etageres.position.set(0, 2.25, -P + 0.06);
  scene.add(etageres);

  // Les néons : quatre signes de carte, et le logo de La Wave au milieu.
  animes.neons = [];

  const neon = (map, l, h, x, y, fond) => {
    bois.push(boite(l + 0.06, h + 0.06, 0.05, x, y, -P + 0.12, fond || '#07090c'));
    const mat = new THREE.MeshBasicMaterial({
      map, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false
    });
    const p = new THREE.Mesh(new THREE.PlaneGeometry(l, h), mat);
    p.position.set(x, y, -P + 0.155);
    scene.add(p);
    animes.neons.push({ mat, phase: hasard(0, TAU) });
    poserHalo(x, y, -P + 0.4, '#8fbfd8');
  };

  [['coeur', '#ff4d6d', -3.05], ['pique', '#3fd8ff', -1.85], ['trefle', '#3dff9e', 1.85], ['carreau', '#e35bff', 3.05]]
    .forEach(([type, couleur, x]) => neon(R.texture(creerNeonSigne(type, couleur)), 0.9, 0.9, x, 2.25));

  neon(R.texture(creerNeonLogo(R.logo)), 2.2, 1.1, 0, 2.25);

  // L'enseigne, au-dessus de l'auvent.
  const enseigne = new THREE.Mesh(
    new THREE.PlaneGeometry(6.4, 0.78),
    new THREE.MeshBasicMaterial({
      map: R.texture(creerEnseigne("L'ESPACE DES WAVEURS", '#f2d9a8', 1600, 194, 112)),
      transparent: true, depthWrite: false
    })
  );
  enseigne.position.set(0, 4.25, -P + 0.04);
  scene.add(enseigne);

  // L'auvent de bois qui coiffe le bar, un liseré de cuivre, des spots.
  bois.push(boite(10.6, 0.16, 4.3, 0, 3.4, -7.85, '#2a190d'));
  laiton.push(
    boite(10.6, 0.05, 0.05, 0, 3.33, -5.7, CUIVRE),
    boite(0.05, 0.05, 4.3, -5.3, 3.33, -7.85, CUIVRE),
    boite(0.05, 0.05, 4.3, 5.3, 3.33, -7.85, CUIVRE)
  );
  led.push(boite(10.2, 0.02, 0.02, 0, 3.315, -5.85, '#ffb35e'));

  for(let x = -3.6; x <= 3.7; x += 1.2){
    led.push(cylindre(0.06, 0.07, 0.06, x, 3.29, -6.0, '#fff1d6', 12));
  }

  // Cinq suspensions au-dessus du comptoir.
  [-3.6, -1.8, 0, 1.8, 3.6].forEach(x => {
    laiton.push(cylindre(0.006, 0.006, 0.7, x, 2.97, -6.95, CUIVRE, 6));
    const abat = new THREE.CylinderGeometry(0.05, 0.2, 0.26, 24, 1, true);
    abat.translate(x, 2.5, -6.95);
    colorer(abat, CUIVRE);
    laiton.push(abat);
    led.push(sphere(0.065, x, 2.42, -6.95, '#fff3d2'));
    poserHalo(x, 2.32, -6.95, '#ffcf8a');
  });

  // Huit tabourets, en cuir lie-de-vin, laiton et rondeur.
  for(let i = 0; i < 8; i++){
    const x = -3.15 + i * 0.9;
    poser({ tissu, laiton, bois }, geoTabouret('#6b1a2b', 0.74), x, -6.0, 0);
    colliders.push({ x0: x - 0.26, x1: x + 0.26, z0: -6.26, z1: -5.74 });
    // On s'y assoit face au comptoir, les pieds sur le repose-pieds de laiton.
    SIEGES.push({
      id: 'bar' + i, genre: 'tabouret', x, z: -6.0, yaw: Math.PI, haut: 0.74,
      pieds: { y: 0.31, z: 0.30, ecart: 0.11, ouverture: 0.10 }
    });
  }

  // Quelques bouteilles et un seau à glace sur le comptoir.
  [[-3.6, '#2f6b41', 0.24], [-2.7, '#8a531f', 0.2], [-1.2, '#d8d0bc', 0.26], [0.6, '#1f5b6b', 0.22],
   [1.9, '#6a2432', 0.24], [3.3, '#c9973a', 0.2]].forEach(([x, couleur, h]) => {
    bois.push(
      cylindre(0.038, 0.038, h, x, 1.08 + h / 2, -7.15, couleur, 12),
      cylindre(0.014, 0.018, 0.11, x, 1.08 + h + 0.05, -7.15, couleur, 8)
    );
  });
  laiton.push(cylindre(0.1, 0.08, 0.17, 2.6, 1.165, -7.05, LAITON, 16));

  fusion(bois, R.matBois);
  fusion(laiton, R.matLaiton);
  fusion(led, R.matLed);
  fusion(tissu, R.matTissu);

  // Le comptoir est un obstacle, retours compris.
  colliders.push(
    { x0: -4.75, x1: 4.75, z0: -7.7, z1: -6.35 },
    { x0: -4.75, x1: -3.4, z0: -P, z1: -7.5 },
    { x0: 3.4, x1: 4.75, z0: -P, z1: -7.5 }
  );
}


/* ---- Le mobilier : tables de jeu, salons ---- */

const OR = '#c9973a';
const LAITON = '#c9973a';
const CUIVRE = '#b87333';

function cylindre(rh, rb, h, x, y, z, couleur, seg){
  const g = new THREE.CylinderGeometry(rh, rb, h, seg || 20);
  g.translate(x, y, z);
  if(couleur) colorer(g, couleur);
  return g;
}

function sphere(r, x, y, z, couleur){
  const g = new THREE.SphereGeometry(r, 12, 9);
  g.translate(x, y, z);
  if(couleur) colorer(g, couleur);
  return g;
}

function geoTabouret(couleur, hauteur){

  const h = hauteur;

  const anneau = new THREE.TorusGeometry(0.15, 0.012, 6, 22);
  anneau.rotateX(Math.PI / 2);
  anneau.translate(0, h * 0.42, 0);
  colorer(anneau, LAITON);

  return {
    tissu: [cylindre(0.2, 0.19, 0.1, 0, h, 0, couleur, 24)],
    laiton: [
      cylindre(0.026, 0.026, h - 0.05, 0, (h - 0.05) / 2 + 0.03, 0, LAITON, 10),
      cylindre(0.22, 0.24, 0.03, 0, 0.015, 0, LAITON, 24),
      anneau
    ]
  };
}

// Un fauteuil de salon, tourné vers +z.
function geoFauteuil(couleur){

  const pieds = [[-0.26, -0.24], [0.26, -0.24], [-0.26, 0.24], [0.26, 0.24]]
    .map(([x, z]) => cylindre(0.018, 0.014, 0.2, x, 0.1, z, LAITON, 8));

  return {
    tissu: [
      boite(0.66, 0.16, 0.62, 0, 0.3, 0, couleur),
      boite(0.66, 0.5, 0.12, 0, 0.62, -0.25, couleur),
      boite(0.1, 0.22, 0.56, -0.38, 0.47, 0, couleur),
      boite(0.1, 0.22, 0.56, 0.38, 0.47, 0, couleur)
    ],
    laiton: pieds
  };
}

// Une banquette : le dossier au fond (-z), l'assise devant.
function geoBanquette(longueur, couleur){

  const tissu = [
    boite(longueur, 0.24, 0.72, 0, 0.32, 0, couleur),
    boite(longueur, 0.56, 0.16, 0, 0.7, -0.28, couleur)
  ];

  const n = Math.floor(longueur / 0.9);
  for(let i = 1; i < n; i++){
    tissu.push(boite(0.02, 0.5, 0.02, -longueur / 2 + i * longueur / n, 0.7, -0.19, '#0a2d33'));
  }

  return { tissu, bois: [boite(longueur, 0.2, 0.7, 0, 0.1, 0, '#150c07')] };
}

// Une petite table ronde : plateau sombre, fût et pied de laiton.
function geoTableRonde(r, h){
  return {
    bois: [cylindre(r, r, 0.04, 0, h, 0, '#1a100a', 28)],
    laiton: [
      cylindre(0.03, 0.03, h - 0.04, 0, (h - 0.04) / 2, 0, LAITON, 10),
      cylindre(r * 0.55, r * 0.6, 0.03, 0, 0.015, 0, LAITON, 24)
    ]
  };
}

// Un demi-disque à plat, pour le tapis d'une table de blackjack : la
// courbe est du côté -z, le bord droit sur l'axe x.
function demiDisque(r, n){

  const pos = [0, 0, 0], nor = [0, 1, 0], uv = [0.5, 0], idx = [];

  for(let i = 0; i <= n; i++){
    const a = Math.PI / 2 + Math.PI * i / n;
    const x = r * Math.sin(a), z = r * Math.cos(a);
    pos.push(x, 0, z);
    nor.push(0, 1, 0);
    uv.push(0.5 + x / (2 * r), -z / r);
    if(i < n) idx.push(0, i + 1, i + 2);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);

  return g;
}

function construireMobilier(){

  const liste = { tissu: [], laiton: [], bois: [] };
  const CUIR = '#4a1120', VELOURS = '#0f5560', VELOURS2 = '#6b1a2b';

  const boiteCollision = (x0, x1, z0, z1) => colliders.push({ x0, x1, z0, z1 });

  // ---- Roulette, contre le mur de gauche ----
  {
    const x = -5.7, z = -3.4;

    liste.bois.push(boite(1.2, 0.86, 2.7, x, 0.43, z, '#1d110a'));
    liste.tissu.push(boite(1.42, 0.09, 2.92, x, 0.905, z, CUIR));
    liste.laiton.push(boite(1.24, 0.03, 2.74, x, 0.875, z, LAITON));

    const feutre = new THREE.Mesh(
      new THREE.PlaneGeometry(1.24, 2.74),
      new THREE.MeshLambertMaterial({ map: R.texture(creerFeutreRoulette()) })
    );
    feutre.rotation.x = -Math.PI / 2;
    feutre.position.set(x, 0.954, z);
    scene.add(feutre);

    // La roue, à l'extrémité nord.
    const zr = z - 1.37 + 0.55;
    liste.bois.push(cylindre(0.46, 0.48, 0.09, x, 0.995, zr, '#2b170c', 32));

    const roue = new THREE.Mesh(
      new THREE.CircleGeometry(0.42, 40),
      new THREE.MeshLambertMaterial({ map: R.texture(creerRoue()) })
    );
    roue.rotation.x = -Math.PI / 2;
    roue.position.set(x, 1.042, zr);
    scene.add(roue);

    liste.laiton.push(cylindre(0.035, 0.06, 0.07, x, 1.075, zr, LAITON, 12));

    boiteCollision(x - 0.75, x + 0.75, z - 1.5, z + 1.5);
  }

  // ---- Blackjack : une demi-lune, le croupier côté mur ----
  {
    const cx = -6.55, cz = 2.4, rot = -Math.PI / 2;

    const corps = new THREE.CylinderGeometry(1.2, 1.2, 0.86, 40, 1, false, Math.PI / 2, Math.PI);
    corps.translate(0, 0.43, 0);
    colorer(corps, '#1d110a');

    const rebord = new THREE.CylinderGeometry(1.34, 1.34, 0.09, 40, 1, false, Math.PI / 2, Math.PI);
    rebord.translate(0, 0.905, 0);
    colorer(rebord, CUIR);

    // La table est dessinée autour de l'origine, puis tournée à sa place.
    poser(liste, {
      bois: [corps, boite(2.68, 0.95, 0.03, 0, 0.475, 0, '#1d110a')],
      tissu: [rebord]
    }, cx, cz, rot);

    const geoFeutre = demiDisque(1.26, 32);
    geoFeutre.rotateY(rot);
    geoFeutre.translate(cx, 0.954, cz);
    scene.add(new THREE.Mesh(geoFeutre, new THREE.MeshLambertMaterial({ map: R.texture(creerFeutreBlackjack()) })));

    // Les tabourets, sur la courbe.
    for(let i = 0; i < 4; i++){
      const a = Math.PI / 2 + Math.PI * (i + 0.5) / 4;
      const lx = 1.85 * Math.sin(a), lz = 1.85 * Math.cos(a);
      // Rotation de la table : (lx, lz) → monde.
      const wx = cx + lx * Math.cos(rot) + lz * Math.sin(rot);
      const wz = cz - lx * Math.sin(rot) + lz * Math.cos(rot);
      poser(liste, geoTabouret(VELOURS2, 0.68), wx, wz, 0);
      boiteCollision(wx - 0.26, wx + 0.26, wz - 0.26, wz + 0.26);
      SIEGES.push({
        id: 'bj' + i, genre: 'tabouret', x: wx, z: wz, yaw: Math.atan2(cx - wx, cz - wz), haut: 0.68,
        pieds: { y: 0.085, z: 0.30, ecart: 0.12, ouverture: 0.14 }
      });
    }

    boiteCollision(-SALLE.l, cx + 1.4, cz - 1.4, cz + 1.4);
  }

  // ---- Un coin de salon près de la porte, à gauche ----
  poser(liste, geoTableRonde(0.45, 0.7), -6.4, 6.6, 0);
  poser(liste, geoFauteuil(VELOURS), -6.4, 5.75, 0);
  poser(liste, geoFauteuil(VELOURS), -6.4, 7.45, Math.PI);
  boiteCollision(-6.9, -5.9, 5.4, 7.8);

  // ---- À droite : la banquette de velours et ses deux tables ----
  poser(liste, geoBanquette(4.4, VELOURS), 7.08, -2.5, -Math.PI / 2);
  boiteCollision(6.6, SALLE.l, -4.75, -0.25);

  // Sur la banquette, face à la salle, assis au bord de l'assise, près de la
  // table qui est devant.
  [-3.6, -1.4].forEach((z, i) => {
    SIEGES.push({
      id: 'banq' + i, genre: 'banquette', x: 6.88, z, yaw: -Math.PI / 2, haut: 0.39,
      pieds: { y: 0.085, z: 0.42, ecart: 0.12, ouverture: 0.16 }
    });
  });

  [-3.6, -1.4].forEach(z => {
    poser(liste, geoTableRonde(0.42, 0.68), 5.9, z, 0);
    poser(liste, geoFauteuil(VELOURS2), 5.05, z, Math.PI / 2);
    boiteCollision(4.7, 6.35, z - 0.5, z + 0.5);
  });

  // ---- La table de poker, ronde, entourée de cinq fauteuils ----
  {
    const cx = 5.6, cz = 4.6;

    liste.bois.push(cylindre(1.2, 1.2, 0.09, cx, 0.905, cz, '#2b170c', 40));
    liste.tissu.push(cylindre(1.24, 1.24, 0.07, cx, 0.875, cz, CUIR, 40));
    liste.laiton.push(
      cylindre(0.3, 0.34, 0.8, cx, 0.4, cz, LAITON, 16),
      cylindre(0.65, 0.7, 0.04, cx, 0.02, cz, LAITON, 30)
    );

    const feutre = new THREE.Mesh(
      new THREE.CircleGeometry(1.12, 48),
      new THREE.MeshLambertMaterial({ map: R.texture(creerFeutrePoker(R.logo)) })
    );
    feutre.rotation.x = -Math.PI / 2;
    feutre.position.set(cx, 0.954, cz);
    scene.add(feutre);

    for(let i = 0; i < 5; i++){
      // Départ à 0,94 rad : avec moins, deux fauteuils passeraient dans le
      // mur de droite.
      const a = 0.94 + i * TAU / 5;
      const x = cx + Math.sin(a) * 1.85, z = cz + Math.cos(a) * 1.85;
      poser(liste, geoFauteuil(VELOURS2), x, z, a + Math.PI);
      boiteCollision(x - 0.36, x + 0.36, z - 0.36, z + 0.36);
      SIEGES.push({
        id: 'pok' + i, genre: 'fauteuil', x, z, yaw: a + Math.PI,
        pieds: { y: 0.085, z: 0.40, ecart: 0.13, ouverture: 0.20 }
      });
    }

    boiteCollision(cx - 1.3, cx + 1.3, cz - 1.3, cz + 1.3);
  }

  fusion(liste.bois, R.matBois);
  fusion(liste.tissu, R.matTissu);
  fusion(liste.laiton, R.matLaiton);
}


/* ---- La grande machine, ses lumières, l'air de la salle ---- */

function construireMachine(){

  const m = new Machine(MACHINE, 0, 0, 0, R, ECHELLE_MACHINE);
  m.groupe.position.y = 0.14;

  scene.add(m.groupe);
  machines.push(m);
  colliders.push(m.collision);
  animes.machines = machines;

  m.surArret = () => Son.arret();

  // Son ombre, posée sur l'estrade.
  const ombre = new THREE.Mesh(
    new THREE.PlaneGeometry(1.75, 1.5),
    new THREE.MeshBasicMaterial({ map: R.texture(creerOmbre()), transparent: true, depthWrite: false })
  );
  ombre.rotation.x = -Math.PI / 2;
  ombre.position.set(0, 0.146, -0.03);
  scene.add(ombre);
}

/* ---- Le croupier et son étal de boosters ---- */

// Où se tient le croupier : derrière la table de blackjack, le dos au mur de
// gauche, face à la salle. Sa table lui sert de comptoir.
const CROUPIER = { x: -6.95, z: 2.4, rot: Math.PI / 2 };

// Un booster : un sachet de foil de largeur l, hauteur h et épaisseur e,
// avec son reflet arc-en-ciel en surimpression. Le devant fait face à +z.
function fabriquerBooster(l, h, e){

  const groupe = new THREE.Group();

  const devant = geoBooster(l, h, e);
  const dos = geoBooster(l, h, e);
  dos.rotateY(Math.PI);

  groupe.add(new THREE.Mesh(devant, R.matBoosterFace));
  groupe.add(new THREE.Mesh(dos, R.matBoosterDos));

  const reflet = new THREE.Mesh(devant, R.matFoil);
  reflet.position.z = 0.0008;
  reflet.renderOrder = 3;
  groupe.add(reflet);

  return groupe;
}

/* ----------------------------------------------------------------------
   Les personnages
   ----------------------------------------------------------------------
   Un corps, c'est une dizaine de pièces articulées, toutes dessinées par le
   code : un torse et une tête qui bougent, deux bras (épaule, coude) et
   deux jambes (hanche, genou, cheville). Les bras et les jambes se placent
   par cinématique inverse : on dit où doit arriver la main ou le pied, et
   le reste suit. C'est ce qui permet d'asseoir quelqu'un sur un tabouret,
   les pieds sur le repose-pieds et le coude sur le comptoir, sans dessiner
   chaque pose à la main.

   Repère d'un personnage : l'origine est au sol, entre les pieds ; il
   regarde vers +z, sa gauche est du côté de +x, sa tête à 1,75 m.
   ---------------------------------------------------------------------- */

const HUMAIN = {
  cuisse: 0.43,
  tibia: 0.40,
  bras: 0.29,
  avantBras: 0.26,
  hanche: 0.093,        // écart de chaque hanche à l'axe
  epaule: 0.205,        // idem, pour les épaules
  pivot: 0.04,          // le pivot de la taille, au-dessus du centre du bassin
  hEpaule: 0.47,        // les épaules, au-dessus du pivot
  hCou: 0.54,           // la base du cou, au-dessus du pivot
  hTete: 0.15,          // le centre de la tête, au-dessus de la base du cou
  bassinDebout: 0.93    // le centre du bassin, debout
};

// Une surface de révolution elliptique : des anneaux superposés, du bas vers
// le haut. Chaque anneau a sa hauteur y, ses demi-axes (rx, rz) et, s'il le
// faut, un centre (cx, cz). `couleur` est une couleur ou une fonction
// (angle, y, x, z) qui en rend une : l'angle vaut 0 devant (+z).
function lofter(sections, couleur, segments){

  const n = segments || 20;
  const m = sections.length;
  const pos = [], col = [], idx = [];
  const c = new THREE.Color();

  const teinte = (a, y, x, z) => typeof couleur === 'function' ? couleur(a, y, x, z) : couleur;

  sections.forEach(s => {
    for(let j = 0; j < n; j++){
      const a = j / n * TAU;
      const x = (s.cx || 0) + Math.sin(a) * s.rx;
      const z = (s.cz || 0) + Math.cos(a) * s.rz;
      pos.push(x, s.y, z);
      c.set(teinte(a, s.y, x, z));
      col.push(c.r, c.g, c.b);
    }
  });

  for(let i = 0; i < m - 1; i++){
    for(let j = 0; j < n; j++){
      const a = i * n + j, b = i * n + (j + 1) % n;
      const e = (i + 1) * n + j, f = (i + 1) * n + (j + 1) % n;
      idx.push(a, b, e, b, f, e);
    }
  }

  // Les deux fonds : un point au centre de chaque extrémité.
  [[0, false], [m - 1, true]].forEach(([i, haut]) => {
    const s = sections[i];
    const k = pos.length / 3;
    pos.push(s.cx || 0, s.y, s.cz || 0);
    c.set(teinte(0, s.y, s.cx || 0, s.cz || 0));
    col.push(c.r, c.g, c.b);
    for(let j = 0; j < n; j++){
      const a = i * n + j, b = i * n + (j + 1) % n;
      if(haut) idx.push(k, a, b); else idx.push(k, b, a);
    }
  });

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();

  return g;
}

// Un membre : de y = 0 (l'articulation) à y = -L, renflé au milieu, les deux
// bouts arrondis. La couleur est donnée selon la hauteur (un manche qui
// s'arrête, une peau qui commence).
function membre(L, r0, r1, couleur, bombe){

  const b = bombe || 1.06;
  const rond = (r, sens) => [90, 60, 30].map(deg => {
    const p = deg * Math.PI / 180;
    return { sin: Math.sin(p), cos: Math.max(0.0008, Math.cos(p)), r, sens };
  });

  const s = [];

  rond(r1).forEach(k => s.push({ y: -L - r1 * k.sin, rx: r1 * k.cos, rz: r1 * k.cos }));
  s.push({ y: -L, rx: r1, rz: r1 });
  const rm = lerp(r1, r0, 0.55) * b;
  s.push({ y: -L * 0.45, rx: rm, rz: rm });
  s.push({ y: 0, rx: r0, rz: r0 });
  rond(r0).reverse().forEach(k => s.push({ y: r0 * k.sin, rx: r0 * k.cos, rz: r0 * k.cos }));

  return lofter(s, (a, y) => typeof couleur === 'function' ? couleur(y) : couleur, 14);
}

// Une ellipsoïde posée : de quoi faire une main, un nez, un chignon.
function ellipsoide(rx, ry, rz, x, y, z, hex, seg){
  const g = new THREE.SphereGeometry(1, seg || 12, Math.max(6, (seg || 12) - 4));
  g.scale(rx, ry, rz);
  g.translate(x, y, z);
  return colorer(g, hex);
}

// La surface du visage : où se trouve le devant de la tête à la hauteur y,
// à x du milieu. Sert à poser les yeux et le nez sur la peau, au lieu de
// les faire flotter ou s'enfoncer.
function surfaceVisage(x, y, menton){

  const uy = y / 0.108;
  const bas = Math.max(0, -uy);
  const haut = Math.max(0, uy);
  const sx = 0.078 * (1 - 0.30 * Math.pow(bas, 1.6) * (menton || 1));
  const ux = x / sx;
  const t = 1 - ux * ux - uy * uy;

  if(t <= 0) return 0;

  const sz = 0.092 * (1 - 0.10 * Math.pow(bas, 1.3)) * (1 - 0.05 * haut);
  return Math.sqrt(t) * sz;
}

// Un point de la sphère unité, amené sur la forme de la tête : un menton
// plus étroit, un front un peu plus plat. `marge` la gonfle (cheveux, barbe).
function pointCrane(ux, uy, uz, marge, menton){

  const bas = Math.max(0, -uy);
  const haut = Math.max(0, uy);
  const sx = (0.078 + marge) * (1 - 0.30 * Math.pow(bas, 1.6) * (menton || 1));
  const sy = 0.108 + marge;
  let sz = (0.092 + marge) * (1 - 0.10 * Math.pow(bas, 1.3));

  if(uz > 0) sz *= 1 - 0.05 * haut;

  return { x: ux * sx, y: uy * sy, z: uz * sz, sx, sy, sz };
}

// Une calotte de cheveux : une demi-sphère dont le bord suit la ligne des
// cheveux — haut sur le front (`front`), à la hauteur des oreilles sur les
// côtés (`cote`), descendant sur la nuque (`dos`). Les trois valeurs sont des
// angles depuis le sommet, en demi-tours (0,5 = l'équateur).
function calotte(rx, ry, rz, front, cote, dos, teinte, dy, dz){

  const g = new THREE.SphereGeometry(1, 30, 20, 0, TAU, 0, Math.PI * 0.85);
  const p = g.attributes.position, nr = g.attributes.normal;
  const col = new Float32Array(p.count * 3);
  const c = new THREE.Color();
  const lisse = t => t * t * (3 - 2 * t);

  for(let i = 0; i < p.count; i++){

    const x0 = p.getX(i), y0 = p.getY(i), z0 = p.getZ(i);
    const th = Math.acos(clamp(y0, -1, 1));
    const ph = Math.atan2(x0, z0);
    const cs = Math.cos(ph);

    const lim = cs >= 0 ? lerp(cote, front, lisse(cs)) : lerp(cote, dos, lisse(-cs));
    const t2 = Math.min(th, lim * Math.PI);
    const s = Math.sin(t2);

    const x = Math.sin(ph) * s, y = Math.cos(t2), z = Math.cos(ph) * s;

    p.setXYZ(i, x * rx, y * ry + (dy || 0), z * rz + (dz || 0));

    const nx = x / rx, ny = y / ry, nz = z / rz;
    const l = Math.hypot(nx, ny, nz) || 1;
    nr.setXYZ(i, nx / l, ny / l, nz / l);

    c.set(teinte(y * ry + (dy || 0)));
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }

  g.setAttribute('color', new THREE.BufferAttribute(col, 3));

  return g;
}

// Les cheveux, la barbe et les accessoires de la tête, dans le repère du
// centre de la tête.
function geoCoiffure(d){

  const liste = [];
  const base = d.cheveux;
  const sombre = melange(base, '#000000', 0.38);
  const clair = melange(base, '#ffffff', 0.14);
  const teinte = y => melange(sombre, clair, clamp((y + 0.03) / 0.16, 0, 1));

  switch(d.coiffure){

    case 'rejete': {
      liste.push(calotte(0.086, 0.114, 0.100, 0.305, 0.50, 0.72, teinte, 0, -0.003));
      const houppe = new THREE.SphereGeometry(1, 16, 10);
      houppe.scale(0.070, 0.030, 0.088);
      houppe.rotateX(-0.22);
      houppe.translate(0, 0.104, 0.018);
      liste.push(colorer(houppe, clair));
      [-1, 1].forEach(s => liste.push(boite(0.010, 0.05, 0.034, s * 0.0815, 0.004, 0.012, sombre)));
      break;
    }

    case 'court':
      liste.push(calotte(0.085, 0.112, 0.098, 0.34, 0.52, 0.68, teinte, 0, -0.002));
      [-1, 1].forEach(s => liste.push(boite(0.009, 0.04, 0.03, s * 0.0805, 0.002, 0.012, sombre)));
      break;

    case 'long': {
      liste.push(calotte(0.087, 0.114, 0.100, 0.32, 0.52, 0.80, teinte, 0, -0.003));

      // La nappe : ce qui retombe dans le dos, jusque sur les omoplates.
      const nappe = lofter([
        { y: -0.40, rx: 0.060, rz: 0.020, cz: -0.085 },
        { y: -0.30, rx: 0.095, rz: 0.040, cz: -0.088 },
        { y: -0.14, rx: 0.100, rz: 0.048, cz: -0.082 },
        { y: 0.00, rx: 0.095, rz: 0.050, cz: -0.070 },
        { y: 0.05, rx: 0.088, rz: 0.040, cz: -0.050 }
      ], y => melange(sombre, clair, clamp((y + 0.4) / 0.6, 0, 1) * 0.6), 16);
      liste.push(nappe);

      // Deux mèches le long du visage.
      [-1, 1].forEach(s => {
        liste.push(lofter([
          { y: -0.16, rx: 0.011, rz: 0.020, cx: s * 0.086, cz: -0.004 },
          { y: -0.05, rx: 0.014, rz: 0.028, cx: s * 0.086, cz: 0.006 },
          { y: 0.04, rx: 0.014, rz: 0.030, cx: s * 0.084, cz: 0.012 }
        ], sombre, 10));
      });
      break;
    }

    case 'chignon': {
      liste.push(calotte(0.087, 0.114, 0.100, 0.31, 0.52, 0.64, teinte, 0, -0.003));
      liste.push(ellipsoide(0.040, 0.036, 0.040, 0, 0.098, -0.078, base, 14));
      liste.push(ellipsoide(0.046, 0.007, 0.046, 0, 0.082, -0.078, sombre, 12));
      break;
    }

    case 'casquette': {
      liste.push(calotte(0.085, 0.112, 0.098, 0.40, 0.52, 0.70, teinte, 0, -0.002));
      const cap = calotte(0.092, 0.118, 0.105, 0.365, 0.44, 0.47, y => melange(d.casquette, '#000000', 0.25 * clamp((0.06 - y) / 0.16, 0, 1)), 0.004, -0.002);
      liste.push(cap);
      const bec = new THREE.CylinderGeometry(0.098, 0.098, 0.005, 26, 1, false, -Math.PI / 2, Math.PI);
      bec.scale(1, 1, 1.75);
      bec.rotateX(0.14);
      bec.translate(0, 0.036, 0.022);
      liste.push(colorer(bec, melange(d.casquette, '#000000', 0.15)));
      break;
    }

    default:
      break;
  }

  // La barbe : une coque sur le bas du visage, de la pommette au menton.
  // Elle ne fait pas le tour complet de la tête : aucune couture à cacher.
  if(d.barbe === 2){
    const g = new THREE.SphereGeometry(1, 26, 14, Math.PI / 2 - 1.7, 3.4, Math.PI * 0.57, Math.PI * 0.36);
    const p = g.attributes.position;
    for(let i = 0; i < p.count; i++){
      const q = pointCrane(p.getX(i), p.getY(i), p.getZ(i), 0.005, d.menton);
      p.setXYZ(i, q.x, q.y, q.z);
    }
    g.computeVertexNormals();
    liste.push(colorer(g, d.barbeCouleur || base));
  }

  // Les lunettes.
  if(d.lunettes){
    [-1, 1].forEach(s => {
      const z = surfaceVisage(s * 0.034, 0.014, d.menton) + 0.004;
      const cercle = new THREE.TorusGeometry(0.0225, 0.0024, 6, 22);
      cercle.translate(s * 0.034, 0.014, z);
      liste.push(colorer(cercle, '#1a1a1c'));
      // La branche, de la monture à l'oreille.
      liste.push(boite(0.003, 0.003, 0.075, s * 0.0765, 0.018, 0.040, '#1a1a1c'));
    });
    liste.push(boite(0.022, 0.0028, 0.0028, 0, 0.018, surfaceVisage(0, 0.018, d.menton) + 0.004, '#1a1a1c'));
  }

  return liste;
}

// La tête : le crâne aux joues légèrement colorées, le nez, les yeux, les
// sourcils, les lèvres, les oreilles, le cou, puis les cheveux. Tout dans une
// seule forme, centrée sur la tête.
function geoTete(d){

  const g = new THREE.SphereGeometry(1, 32, 24);
  const p = g.attributes.position, nr = g.attributes.normal;
  const col = new Float32Array(p.count * 3);

  const peau = new THREE.Color(d.peau);
  const joue = new THREE.Color(melange(d.peau, d.femme ? '#e06a70' : '#d8604e', 0.30));
  const barbe = new THREE.Color(melange(d.peau, d.cheveux, 0.30));
  const tmp = new THREE.Color();

  for(let i = 0; i < p.count; i++){

    const ux = p.getX(i), uy = p.getY(i), uz = p.getZ(i);
    const q = pointCrane(ux, uy, uz, 0, d.menton);

    p.setXYZ(i, q.x, q.y, q.z);

    const nx = ux / q.sx, ny = uy / q.sy, nz = uz / q.sz;
    const l = Math.hypot(nx, ny, nz) || 1;
    nr.setXYZ(i, nx / l, ny / l, nz / l);

    tmp.copy(peau);
    if(uz > 0.2 && Math.abs(ux) > 0.22 && uy > -0.5 && uy < 0.12) tmp.lerp(joue, 0.6);
    if(d.barbe === 1 && uy < -0.15 && uz > -0.2) tmp.lerp(barbe, 0.85);

    col[i * 3] = tmp.r;
    col[i * 3 + 1] = tmp.g;
    col[i * 3 + 2] = tmp.b;
  }

  g.setAttribute('color', new THREE.BufferAttribute(col, 3));

  const liste = [g];
  const ombrePeau = melange(d.peau, '#2a1a12', 0.42);
  const sourcil = melange(d.cheveux, '#000000', 0.15);

  [-1, 1].forEach(s => {

    const x = s * 0.032;
    const z = surfaceVisage(x, 0.014, d.menton);

    liste.push(ellipsoide(0.0128, 0.0102, 0.0056, x, 0.014, z - 0.0005, '#f6f3ec', 12));
    liste.push(ellipsoide(0.0072, 0.0072, 0.0036, x, 0.013, z + 0.0040, d.yeux, 12));
    liste.push(ellipsoide(0.0036, 0.0036, 0.0024, x, 0.013, z + 0.0068, '#0b0908', 8));
    liste.push(boite(0.030, 0.0040, 0.0045, x, 0.0280, z + 0.0012, ombrePeau));
    liste.push(boite(0.026, 0.0030, 0.0040, x, 0.0002, z - 0.0005, melange(d.peau, '#2a1a12', 0.22)));

    const zb = surfaceVisage(s * 0.034, 0.043, d.menton);
    liste.push(boite(0.033, d.femme ? 0.0045 : 0.0068, 0.0075, s * 0.034, 0.043, zb + 0.0012, sourcil));

    // L'oreille.
    liste.push(ellipsoide(0.0115, 0.0205, 0.0145, s * 0.0795, -0.006, -0.004, d.peau, 10));
  });

  // Le nez : un arrondi au bout, une arête fine.
  const zn = surfaceVisage(0, -0.016, d.menton);
  liste.push(ellipsoide(0.0115, 0.0145, 0.0135, 0, -0.016, zn + 0.0035, melange(d.peau, '#e08070', 0.10), 12));
  liste.push(boite(0.0115, 0.040, 0.0085, 0, 0.004, surfaceVisage(0, 0.004, d.menton) + 0.0008, d.peau));

  // La bouche.
  const couleurLevres = d.femme ? '#b23a4a' : melange(d.peau, '#8a3a36', 0.55);
  const zl = surfaceVisage(0, -0.052, d.menton);
  liste.push(boite(0.033, 0.0042, 0.0055, 0, -0.0515, zl + 0.0012, couleurLevres));
  liste.push(boite(0.023, 0.0040, 0.0055, 0, -0.0575, surfaceVisage(0, -0.0575, d.menton) + 0.0012, melange(couleurLevres, '#ffffff', 0.12)));

  // Le cou : il s'enfonce dans le col.
  liste.push(membre(0.10, 0.048, 0.050, d.peau, 1).translate(0, -0.06, 0));

  liste.push(...geoCoiffure(d));

  const tete = fusionner(liste);

  // Une tête un peu plus grande que le calcul brut : c'est ce qui rend
  // les proportions naturelles, vues d'un mètre.
  tete.scale(1.07, 1.07, 1.07);
  tete.translate(0, HUMAIN.hTete, 0);

  return tete;
}

// Une couleur en un point d'une liste d'anneaux.
function interpAnneau(S, y, cle){
  for(let i = 0; i < S.length - 1; i++){
    if(y <= S[i + 1].y){
      const t = clamp((y - S[i].y) / (S[i + 1].y - S[i].y), 0, 1);
      return lerp(S[i][cle], S[i + 1][cle], t);
    }
  }
  return S[S.length - 1][cle];
}

// Le torse, avec ce qui le recouvre : chemise, gilet, veste, robe ou sweat,
// le col, le nœud papillon ou la cravate, les boutons. Dans le repère du
// pivot de la taille.
function geoTorse(d){

  const f = !!d.femme;
  const k = d.corps || 1;
  const v = d.ventre || 1;
  const ll = f ? 0.93 : 1;

  // Quelques anneaux de contrôle, puis on les multiplie pour que les
  // changements de couleur (un gilet ouvert en V) restent nets.
  const C = [
    { y: -0.13, rx: 0.150 * k, rz: 0.105 * k },
    { y: -0.06, rx: (f ? 0.182 : 0.170) * k, rz: 0.115 * k },
    { y: 0.08, rx: (f ? 0.135 : 0.152) * k, rz: 0.098 * k * v },
    { y: 0.24, rx: (f ? 0.150 : 0.175) * k, rz: (f ? 0.108 : 0.112) * k * Math.sqrt(v) },
    { y: 0.38, rx: f ? 0.162 : 0.192, rz: f ? 0.128 : 0.122 },
    { y: 0.46, rx: 0.200 * ll, rz: 0.104 },
    { y: 0.52, rx: 0.135 * ll, rz: 0.082 },
    { y: 0.56, rx: 0.064, rz: 0.062 }
  ];

  const S = [];
  for(let y = -0.13; y < 0.55; y += 0.017){
    S.push({ y, rx: interpAnneau(C, y, 'rx'), rz: interpAnneau(C, y, 'rz') });
  }
  S.push(C[C.length - 1]);

  const rzA = y => interpAnneau(C, y, 'rz');

  let couleur;

  if(d.tenue === 'gilet'){

    // Chemise blanche, gilet noir ouvert en V très haut, échancré aux
    // emmanchures : les épaules et les côtés restent en chemise.
    couleur = (a, y, x, z) => {
      if(y < -0.02) return d.pantalon;
      if(y > 0.50) return d.chemise;
      if(z >= 0){
        const ouv = y > 0.30 ? 0.088 * Math.min(1, (y - 0.30) / 0.17) : 0;
        const gilet = Math.abs(x) >= ouv && (y < 0.30 || Math.abs(x) < 0.150);
        return gilet ? d.veste : d.chemise;
      }
      return (y < 0.44 || Math.abs(x) < 0.12) ? d.veste : d.chemise;
    };

  } else if(d.tenue === 'veste'){

    // Veste ouverte sur la chemise, plus ou moins largement.
    const haut = d.ouverture || 0.10;
    const bas = d.fermeture || 0.14;
    couleur = (a, y, x, z) => {
      if(y < -0.02) return d.pantalon;
      if(z >= 0 && y > bas){
        const ouv = haut * Math.min(1, (y - bas) / (0.48 - bas));
        if(Math.abs(x) < ouv) return d.chemise;
      }
      return d.veste;
    };

  } else if(d.tenue === 'robe'){

    // Une robe à bretelles : le décolleté et le dos sont en peau.
    couleur = (a, y, x, z) => {
      if(y < 0.42) return d.veste;
      if(z > 0 && Math.abs(x) < 0.05 && y < 0.54) return d.veste;
      if(z > 0 && y < 0.47 && Math.abs(x) < 0.10) return d.veste;
      return d.peau;
    };

  } else {

    couleur = (a, y) => y < -0.02 ? d.pantalon : d.veste;
  }

  const liste = [lofter(S, couleur, 48)];

  // Le col de chemise.
  if(d.tenue === 'gilet' || d.tenue === 'veste'){
    liste.push(lofter([
      { y: 0.505, rx: 0.074, rz: 0.070 },
      { y: 0.545, rx: 0.068, rz: 0.064 },
      { y: 0.580, rx: 0.062, rz: 0.058 }
    ], d.chemise, 16));
    [-1, 1].forEach(s => liste.push(boite(0.030, 0.026, 0.006, s * 0.028, 0.538, 0.070, d.chemise)));
  }

  // Le nœud papillon.
  if(d.noeud){
    const z = 0.078;
    liste.push(
      boite(0.028, 0.030, 0.026, 0, 0.515, z, d.noeud),
      boite(0.052, 0.046, 0.016, -0.042, 0.515, z - 0.004, d.noeud),
      boite(0.052, 0.046, 0.016, 0.042, 0.515, z - 0.004, d.noeud)
    );
  }

  // La cravate.
  if(d.cravate){
    liste.push(
      boite(0.030, 0.030, 0.014, 0, 0.495, rzA(0.495) + 0.006, d.cravate),
      boite(0.030, 0.23, 0.010, 0, 0.365, rzA(0.365) + 0.004, d.cravate)
    );
  }

  // Les boutons du gilet ou de la veste.
  if(d.boutons){
    const y0 = d.tenue === 'gilet' ? 0.05 : (d.fermeture || 0.14);
    const n = d.tenue === 'gilet' ? 5 : 3;
    for(let i = 0; i < n; i++){
      const y = y0 + i * (d.tenue === 'gilet' ? 0.062 : 0.07);
      liste.push(ellipsoide(0.0075, 0.0075, 0.0045, 0, y, rzA(y) + 0.0012, d.boutonsCouleur || '#2b2d33', 8));
    }
  }

  // La poche du sweat, et sa capuche.
  if(d.tenue === 'sweat'){
    liste.push(boite(0.27, 0.10, 0.016, 0, 0.04, rzA(0.04) + 0.004, melange(d.veste, '#000000', 0.14)));
    liste.push(lofter([
      { y: 0.46, rx: 0.120, rz: 0.090, cz: -0.050 },
      { y: 0.53, rx: 0.100, rz: 0.085, cz: -0.050 },
      { y: 0.60, rx: 0.084, rz: 0.070, cz: -0.040 }
    ], melange(d.veste, '#000000', 0.08), 16));
  }

  // Un collier.
  if(d.collier){
    const t = new THREE.TorusGeometry(0.058, 0.0028, 6, 22);
    t.rotateX(Math.PI / 2 - 0.25);
    t.translate(0, 0.5, 0.012);
    liste.push(colorer(t, d.collier));
  }

  // Une ceinture, sous le gilet ou la veste.
  if(d.tenue === 'gilet' || d.tenue === 'veste' || d.tenue === 'sweat'){
    liste.push(lofter([
      { y: -0.035, rx: 0.1545 * k, rz: 0.1035 * k * v },
      { y: -0.012, rx: 0.1545 * k, rz: 0.1035 * k * v }
    ].map(s => ({ y: s.y, rx: interpAnneau(C, s.y, 'rx') * 1.01, rz: interpAnneau(C, s.y, 'rz') * 1.01 })), '#0c0c0d', 24));
  }

  return fusionner(liste);
}

// Le haut du bras : l'épaule arrondie, la manche, et le brassard s'il y en a.
function geoBrasHaut(d){

  const L = HUMAIN.bras;
  const c = d.manches || d.peau;
  const liste = [membre(L, 0.048, 0.040, c, 1.05)];

  if(d.brassard){
    liste.push(lofter([
      { y: -0.100, rx: 0.053, rz: 0.053 },
      { y: -0.138, rx: 0.053, rz: 0.053 }
    ], d.brassard, 16));
  }

  return fusionner(liste);
}

// L'avant-bras et la main. La manche s'arrête au poignet, ou a été retroussée
// à mi-avant-bras.
function geoAvantBras(d, cote){

  const L = HUMAIN.avantBras;
  const manche = d.manches || null;
  const coupe = manche ? (d.rouleaux ? 0.42 : 1.0) : 0;

  const liste = [membre(L, 0.038, 0.030, y => (manche && -y <= coupe * L + 0.0001) ? manche : d.peau, 1.05)];

  if(manche && !d.rouleaux){
    liste.push(lofter([
      { y: -L + 0.032, rx: 0.038, rz: 0.038 },
      { y: -L + 0.002, rx: 0.038, rz: 0.038 }
    ], d.poignets || manche, 14));
  }

  if(manche && d.rouleaux){
    liste.push(lofter([
      { y: -coupe * L + 0.02, rx: 0.047, rz: 0.047 },
      { y: -coupe * L - 0.01, rx: 0.047, rz: 0.047 }
    ], melange(manche, '#000000', 0.06), 14));
  }

  // La main : une paume, des doigts, un pouce vers l'avant.
  const dedans = -cote;

  liste.push(
    ellipsoide(0.019, 0.050, 0.040, 0, -L - 0.050, 0.003, d.peau, 10),
    ellipsoide(0.016, 0.034, 0.037, 0, -L - 0.108, 0.007, d.peau, 10),
    ellipsoide(0.012, 0.028, 0.013, dedans * 0.014, -L - 0.060, 0.034, d.peau, 8)
  );

  return fusionner(liste);
}

// Un pied chaussé : la forme, une semelle plus sombre.
function geoPied(d, cote){
  return fusionner([
    ellipsoide(0.050, 0.040, 0.118, 0, -0.045, 0.040, d.chaussures, 12),
    boite(0.090, 0.012, 0.225, 0, -0.078, 0.042, melange(d.chaussures, '#000000', 0.5))
  ]);
}

// Les vecteurs de travail de la cinématique inverse, créés au premier usage :
// Three.js n'est chargé qu'à l'entrée dans la salle.
let OUTILS = null;

function outils(){
  if(!OUTILS){
    OUTILS = {
      point: new THREE.Vector3(),
      axe: new THREE.Vector3(),
      bas: new THREE.Vector3(0, -1, 0),
      xw: new THREE.Vector3(),
      qa: new THREE.Quaternion(),
      qt: new THREE.Quaternion()
    };
  }
  return OUTILS;
}

// Cinématique inverse à deux segments (un bras, une jambe). `haut` est
// l'articulation de la racine (épaule, hanche), `milieu` celle du coude ou du
// genou. S et T sont la racine du membre et la cible, dans le repère du
// parent de `haut`. `pole` est la direction vers laquelle plie l'articulation
// du milieu (le genou vers l'avant, le coude vers le bas). Si la cible est
// trop loin, le membre se tend vers elle sans la quitter des yeux.
function ik2(haut, milieu, S, T, L1, L2, pole, torsion){

  const { axe: _axe, bas: _bas, xw: _xw, qa: _qa, qt: _qt, point: _point } = outils();

  const u = new THREE.Vector3().subVectors(T, S);
  let d = u.length();

  d = clamp(d, Math.abs(L1 - L2) * 1.001 + 0.002, (L1 + L2) * 0.9995);
  u.normalize();

  const cosA = clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1);
  const A = Math.acos(cosA);

  const n = pole.clone().addScaledVector(u, -pole.dot(u));
  if(n.lengthSq() < 1e-6) n.set(1, 0, 0).addScaledVector(u, -u.x);
  n.normalize();

  // La direction du segment du haut, puis celle du segment du bas.
  const a = u.clone().multiplyScalar(Math.cos(A)).addScaledVector(n, Math.sin(A));
  const E = S.clone().addScaledVector(a, L1);
  const W = S.clone().addScaledVector(u, d);
  const f = W.sub(E).normalize();

  _axe.crossVectors(a, f);
  let theta = 0;

  if(_axe.lengthSq() < 1e-9){
    _axe.set(1, 0, 0).addScaledVector(a, -a.x).normalize();
  } else {
    theta = Math.acos(clamp(a.dot(f), -1, 1));
    _axe.normalize();
  }

  // Le segment du haut se tourne vers `a`, puis pivote sur lui-même pour que
  // la charnière du milieu (son axe x) plie dans le bon plan.
  _qa.setFromUnitVectors(_bas, a);
  _xw.set(1, 0, 0).applyQuaternion(_qa);

  const phi = Math.atan2(a.dot(_point.crossVectors(_xw, _axe)), _xw.dot(_axe));
  _qt.setFromAxisAngle(a, phi);

  haut.quaternion.copy(_qt.multiply(_qa));
  milieu.rotation.set(theta, torsion || 0, 0);
}

// Les tenues et les visages.
const APPARENCES = {

  croupier: {
    peau: '#dba883', cheveux: '#4b3523', coiffure: 'rejete', yeux: '#4a3a2a', barbe: 1,
    tenue: 'gilet', chemise: '#e8e5dd', veste: '#15171d', pantalon: '#101116', chaussures: '#060606',
    noeud: '#0d0e12', manches: '#e8e5dd', poignets: '#e8e5dd', brassard: '#7a1526',
    boutons: true, boutonsCouleur: '#2d3038'
  },

  // Au bar, de dos : un costume bleu nuit, la cravate dénouée.
  costume: {
    peau: '#c98f6b', cheveux: '#1d1410', coiffure: 'court', yeux: '#3a2a1c', barbe: 1,
    tenue: 'veste', chemise: '#e9ecf1', veste: '#222e4d', pantalon: '#1b2139', chaussures: '#0b0a09',
    manches: '#222e4d', poignets: '#e9ecf1', ouverture: 0.10, fermeture: 0.22
  },

  // Au bar, à côté : une robe rouge, les cheveux longs.
  robe: {
    femme: true, peau: '#e6b899', cheveux: '#17100d', coiffure: 'long', yeux: '#3c2a1a', menton: 1.15,
    tenue: 'robe', veste: '#a3142b', pantalon: '#a3142b', chaussures: '#5a0f1c', jambes: 'nues',
    manches: null, collier: '#d8b25a', corps: 0.97
  },

  // Au blackjack : un sweat gris, une casquette bleue.
  sweat: {
    peau: '#8c5a3c', cheveux: '#0f0b09', coiffure: 'casquette', casquette: '#2b5d8a', yeux: '#241710', barbe: 0,
    tenue: 'sweat', veste: '#4d525b', pantalon: '#27354d', chaussures: '#e6e6e6', manches: '#4d525b', rouleaux: 0
  },

  // Au poker : un blazer vert, les cheveux relevés.
  blazer: {
    femme: true, peau: '#f0c7a8', cheveux: '#6d3b1f', coiffure: 'chignon', yeux: '#3a6a8a', menton: 1.15,
    tenue: 'veste', chemise: '#f3efe6', veste: '#1f5a45', pantalon: '#1c1c22', chaussures: '#1b1513',
    manches: '#1f5a45', poignets: '#f3efe6', ouverture: 0.12, fermeture: 0.18, collier: '#d8b25a', corps: 0.97
  },

  // Au salon : un gilet de laine brun, une barbe grise, des lunettes.
  cardigan: {
    peau: '#e2b48f', cheveux: '#b9b6b0', coiffure: 'court', yeux: '#4a5a6a', barbe: 2, barbeCouleur: '#c7c4be',
    lunettes: true, tenue: 'veste', chemise: '#4d6b8c', veste: '#6b4a35', pantalon: '#3a3b3f', chaussures: '#2a1d14',
    manches: '#6b4a35', poignets: '#6b4a35', ouverture: 0.09, fermeture: 0.10, boutons: true,
    boutonsCouleur: '#2a1a10', corps: 1.10, ventre: 1.12
  }
};

// Un personnage. On le crée, puis on l'installe (où, assis ou debout) ; il
// s'occupe ensuite de respirer, de regarder et de faire ce qu'on lui a
// dit de faire.
class Humain {

  constructor(d){

    this.d = d;
    this.phase = hasard(0, TAU);
    this.penche = 0;
    this.cou = { yaw: 0, pitch: 0 };
    this.attention = 0;              // 1 quand il regarde la personne dans la salle
    this.cible = [new THREE.Vector3(), new THREE.Vector3()];   // droite, gauche
    this.pose = [false, false];
    this.pronation = [0, 0];
    this.pole = [new THREE.Vector3(-0.35, -0.5, -0.6), new THREE.Vector3(0.35, -0.5, -0.6)];

    const mat = R.matHumain;
    const mesh = g => new THREE.Mesh(g, mat);

    const racine = this.groupe = new THREE.Group();
    const bassin = this.bassin = new THREE.Group();
    bassin.position.y = HUMAIN.bassinDebout;
    racine.add(bassin);

    const taille = this.taille = new THREE.Group();
    taille.position.y = HUMAIN.pivot;
    bassin.add(taille);

    taille.add(mesh(geoTorse(d)));

    const cou = this.tete = new THREE.Group();
    cou.rotation.order = 'YXZ';
    cou.position.y = HUMAIN.hCou;
    cou.add(mesh(geoTete(d)));
    taille.add(cou);

    // Les bras : à droite du personnage (x < 0), puis à gauche.
    this.bras = [-1, 1].map(s => {
      const epaule = new THREE.Group();
      epaule.position.set(s * HUMAIN.epaule, HUMAIN.hEpaule, 0);
      epaule.add(mesh(geoBrasHaut(d)));
      const coude = new THREE.Group();
      coude.position.y = -HUMAIN.bras;
      coude.add(mesh(geoAvantBras(d, s)));
      epaule.add(coude);
      taille.add(epaule);
      return { epaule, coude, s };
    });

    // Une ombre au sol.
    const ombre = new THREE.Mesh(
      new THREE.PlaneGeometry(0.95, 0.95),
      new THREE.MeshBasicMaterial({ map: R.texture(creerOmbre()), transparent: true, depthWrite: false })
    );
    ombre.rotation.x = -Math.PI / 2;
    ombre.position.y = 0.012;
    racine.add(ombre);
    this.ombre = ombre;
  }

  // Où il se trouve et comment. `p` : x, z, yaw, sol (hauteur du sol),
  // hanche [y, z] (le centre du bassin, dans son repère), penche (radians,
  // vers l'avant), pieds { y, z, ecart, ouverture } (où posent les
  // chevilles).
  installer(p){

    const d = this.d;
    const racine = this.groupe;

    racine.position.set(p.x, p.sol || 0, p.z);
    racine.rotation.y = p.yaw;
    this.centre = { x: p.x, z: p.z };
    this.rotY = p.yaw;
    this.normale = { x: Math.sin(p.yaw), z: Math.cos(p.yaw) };

    this.bassin.position.set(0, p.hanche[0], p.hanche[1]);
    this.penche = p.penche || 0;
    this.taille.rotation.x = this.penche;

    // Les jambes : posées une fois pour toutes, puis collées en une seule
    // forme (elles ne bougeront plus).
    const cuisse = membre(HUMAIN.cuisse, 0.090, 0.064, d.jambes === 'nues' ? d.veste : d.pantalon, 1.04);
    const tibia = membre(HUMAIN.tibia, 0.060, 0.042, d.jambes === 'nues' ? d.peau : d.pantalon, 1.05);

    const morceaux = [];

    [-1, 1].forEach(s => {

      const hanche = new THREE.Group();
      hanche.position.set(s * HUMAIN.hanche, -0.03, 0);
      const genou = new THREE.Group();
      genou.position.y = -HUMAIN.cuisse;
      const cheville = new THREE.Group();
      cheville.position.y = -HUMAIN.tibia;
      hanche.add(genou);
      genou.add(cheville);

      const cible = new THREE.Vector3(
        s * (p.pieds.ecart || 0.10), p.pieds.y, p.pieds.z
      ).sub(this.bassin.position);

      ik2(hanche, genou, hanche.position, cible, HUMAIN.cuisse, HUMAIN.tibia,
        new THREE.Vector3(s * 0.12, 0, 1), 0);

      // Le pied à plat, tourné un peu vers l'extérieur.
      const total = hanche.quaternion.clone().multiply(genou.quaternion);
      cheville.quaternion.copy(total).invert()
        .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), s * (p.pieds.ouverture || 0.14)));

      hanche.updateMatrixWorld(true);

      const pose = (g, o) => { const c = g.clone(); c.applyMatrix4(o.matrixWorld); return c; };

      morceaux.push(pose(cuisse, hanche), pose(tibia, genou), pose(geoPied(d, s), cheville));
    });

    this.bassin.add(new THREE.Mesh(fusionner(morceaux), R.matHumain));

    this.majBras(true);
  }

  // Un bras vers une cible donnée dans le repère de la racine.
  viserBras(i, cible, pronation){
    this.cible[i].copy(cible);
    this.pose[i] = true;
    if(pronation !== undefined) this.pronation[i] = pronation;
    this.sale = true;
  }

  // Le point de la bouche, dans le repère de la racine.
  bouche(sortie){
    this.bassin.updateMatrix();
    this.taille.updateMatrix();
    this.tete.updateMatrix();
    return sortie.set(0, HUMAIN.hTete - 0.052, 0.094)
      .applyMatrix4(this.tete.matrix)
      .applyMatrix4(this.taille.matrix)
      .applyMatrix4(this.bassin.matrix);
  }

  majBras(force){

    if(!this.sale && !force) return;
    this.sale = false;

    this.bassin.updateMatrix();
    this.taille.updateMatrix();

    const m = new THREE.Matrix4().multiplyMatrices(this.bassin.matrix, this.taille.matrix).invert();

    this.bras.forEach((b, i) => {

      if(!this.pose[i]){
        // Au repos : le bras pend, à peine écarté.
        b.epaule.quaternion.setFromEuler(new THREE.Euler(-0.05, 0, -b.s * -0.10));
        b.coude.rotation.set(-0.12, 0, 0);
        return;
      }

      const T = this.cible[i].clone().applyMatrix4(m);
      ik2(b.epaule, b.coude, b.epaule.position, T, HUMAIN.bras, HUMAIN.avantBras, this.pole[i], this.pronation[i]);
    });
  }

  // La tête suit `cible` ({x, z} dans le monde) si elle est assez proche et
  // assez devant, sinon elle reste où l'activité la met (`defaut`, en radians).
  regarder(dt, t, reduit, cible, defaut, portee, secteur){

    let yaw = defaut || 0;
    let pitch = 0;
    let suit = 0;

    if(!reduit) yaw += Math.sin(t * 0.37 + this.phase) * 0.10;

    if(cible){

      const dx = cible.x - this.centre.x, dz = cible.z - this.centre.z;
      const dist = Math.hypot(dx, dz);

      if(dist < (portee || 7)){

        const c = Math.cos(this.rotY), s = Math.sin(this.rotY);
        const lx = dx * c - dz * s, lz = dx * s + dz * c;
        const vers = Math.atan2(lx, lz);

        if(Math.abs(vers) < (secteur || 1.25)){
          suit = 1;
          yaw = clamp(vers, -1.05, 1.05);
          // Les yeux de la personne sont à 1,62 m ; les siens, à peu près à
          // la hauteur de sa tête.
          const tete = this.groupe.position.y + this.bassin.position.y + 0.70;
          pitch = clamp(Math.atan2(tete - 1.62, Math.max(0.5, dist)), -0.3, 0.3);
        }
      }
    }

    const k = 1 - Math.exp(-dt * 4);
    this.cou.yaw += (yaw - this.cou.yaw) * k;
    this.cou.pitch += (pitch - this.cou.pitch) * k;
    this.attention += (suit - this.attention) * k;
  }

  maj(dt, t, reduit, cible){

    // Il respire, à peine.
    this.taille.position.y = HUMAIN.pivot + (reduit ? 0 : Math.sin(t * 1.7 + this.phase) * 0.0035);

    this.regarder(dt, t, reduit, cible);
    this.tete.rotation.set(this.cou.pitch, this.cou.yaw, 0);

    this.majBras();
  }
}


/* ---- Le croupier ---- */

// Le croupier : gilet noir, chemise blanche, nœud papillon, des brassards
// bordeaux. Il regarde la personne qui s'approche, bat les cartes au repos,
// tend un booster quand on lui parle, et le pousse d'un geste quand on
// achète.
class Croupier extends Humain {

  constructor(x, z, rotY){

    super(APPARENCES.croupier);

    this.type = 'croupier';
    this.def = { nom: 'LE CROUPIER', couleur: '#f2d9a8', sombre: '#2a190d' };

    this.accueil = 0;           // 0 au repos, 1 quand il tend un booster
    this.accueilCible = 0;
    this.remerciement = 0;      // une impulsion, après un achat

    this.installer({
      x, z, yaw: rotY,
      hanche: [HUMAIN.bassinDebout, 0],
      penche: 0.05,
      pieds: { y: 0.085, z: 0.03, ecart: 0.105, ouverture: 0.18 }
    });

    // Le booster qu'il tend : dans la main droite, à plat vers la personne.
    this.paquet = fabriquerBooster(0.13, 0.195, 0.014);
    this.paquet.position.set(0, -HUMAIN.avantBras - 0.075, 0.03);
    this.paquet.rotation.set(Math.PI / 2, 0, 0);
    this.paquet.visible = false;
    this.bras[0].coude.add(this.paquet);

    this.reposDroit = new THREE.Vector3();
    this.offre = new THREE.Vector3(-0.13, 1.13, 0.70);
  }

  // Ce que voit la caméra quand on lui parle : lui, de face, à deux mètres et
  // demi, un peu plus loin sur un écran en hauteur.
  vue(aspect){

    const d = clamp(1.05 / Math.max(0.5, aspect), 2.3, 3.4);

    // Sur un écran large, la boutique s'affiche à droite : la caméra se
    // décale de ce côté (à droite de sa propre direction) pour que le
    // croupier apparaisse à gauche, visible, au lieu de passer derrière la
    // fenêtre.
    const lateral = aspect > 1.15 ? 0.85 : 0;
    const droiteX = Math.cos(this.rotY), droiteZ = -Math.sin(this.rotY);

    return {
      x: this.centre.x + this.normale.x * d + droiteX * lateral,
      y: 1.56,
      z: this.centre.z + this.normale.z * d + droiteZ * lateral,
      yaw: this.rotY,
      pitch: -0.03,
      fov: 50
    };
  }

  accueillir(oui){
    this.accueilCible = oui ? 1 : 0;
  }

  remercier(){
    this.remerciement = 1;
  }

  maj(dt, t, reduit, cible){

    const k = 1 - Math.exp(-dt * 6);

    this.accueil += (this.accueilCible - this.accueil) * k;
    this.remerciement = Math.max(0, this.remerciement - dt * 1.4);

    const r = this.accueil;

    // Il se penche vers la personne quand il lui tend un booster.
    this.penche = 0.05 + 0.20 * r + this.remerciement * 0.10;
    this.taille.rotation.x = this.penche;
    this.taille.position.y = HUMAIN.pivot + (reduit ? 0 : Math.sin(t * 1.7 + this.phase) * 0.0035);

    // La tête suit la personne quand elle est proche ; sinon son regard
    // balaie lentement la salle.
    let defaut = 0;
    if(!reduit) defaut = Math.sin(t * 0.4 + this.phase) * 0.25;

    this.regarder(dt, t, reduit, cible, defaut, 9, 3.2);

    this.tete.rotation.set(
      this.cou.pitch + (reduit ? 0 : Math.sin(t * 0.9 + this.phase) * 0.02) + this.remerciement * 0.22,
      this.cou.yaw,
      0
    );

    // Le bras libre reste posé sur le bord de la table ; l'autre bat les
    // cartes au repos, puis tend le booster à l'accueil et le pousse à
    // l'achat.
    const frotte = reduit ? 0 : (1 - r);

    this.reposDroit.set(
      -0.17 + Math.sin(t * 3.4 + this.phase) * 0.030 * frotte,
      0.985,
      0.45 + Math.cos(t * 2.3 + this.phase) * 0.020 * frotte
    );

    const cibleDroite = this.reposDroit.clone().lerp(this.offre, r);
    cibleDroite.z += this.remerciement * 0.06;

    this.viserBras(0, cibleDroite, lerp(-1.25, -0.25, r));
    this.viserBras(1, new THREE.Vector3(0.17, 0.985, 0.43), 1.25);

    this.paquet.visible = r > 0.06;

    this.majBras();
  }
}


/* ---- Les habitués ---- */

// Les sièges de la salle, remplis à mesure que le mobilier est posé : de
// quoi y asseoir quelqu'un à la bonne hauteur, dans la bonne direction.
// x et z sont l'endroit où se pose le bassin ; `pieds` dit où vont les
// chevilles (y : hauteur, z : en avant du bassin).
const SIEGES = [];

const habitues = [];

// Qui est où, et ce qu'il fait. Les mains sont données dans le repère du
// siège (x : vers la gauche de la personne, y : hauteur au sol, z : en
// avant), la pronation dit si la paume regarde le côté (0) ou le dessous (±1,3).
const HABITUES = [

  // Au bar, deux voisins qui bavardent, verre en main.
  { look: 'costume', siege: 'bar4', activite: 'discute', verre: 'whisky', mainVerre: 0,
    penche: 0.30, regard: -0.6,
    mains: [[-0.17, 1.13, 0.56], [0.15, 1.12, 0.50]], pron: [0.9, -1.2] },

  { look: 'robe', siege: 'bar5', activite: 'discute', verre: 'vin', mainVerre: 0,
    penche: 0.25, regard: 0.6,
    mains: [[-0.16, 1.13, 0.54], [0.18, 1.12, 0.50]], pron: [0.9, -1.2] },

  // À la table de blackjack, face au croupier.
  { look: 'sweat', siege: 'bj0', activite: 'cartes',
    penche: 0.28, regard: 0, portee: 3.5,
    mains: [[-0.16, 0.985, 0.56], [0.16, 0.985, 0.56]], pron: [-1.25, 1.25] },

  // À la table de poker.
  { look: 'blazer', siege: 'pok3', activite: 'cartes',
    penche: 0.22, regard: 0, portee: 3.5,
    mains: [[-0.13, 0.985, 0.52], [0.13, 0.985, 0.52]], pron: [-1.25, 1.25] },

  // Sur la banquette de velours, devant un verre.
  { look: 'cardigan', siege: 'banq1', activite: 'verre', verre: 'biere', mainVerre: 0,
    penche: 0.12, regard: 0.15,
    mains: [[-0.17, 0.75, 0.46], [0.20, 0.56, 0.28]], pron: [0.8, 0.2] }
];

// Un verre : un gobelet de verre à peine visible et ce qu'il contient.
function creerVerre(type){

  const g = new THREE.Group();

  const verre = new THREE.MeshStandardMaterial({
    color: 0xd6ebf5, transparent: true, opacity: 0.30, roughness: 0.08, metalness: 0, depthWrite: false
  });

  const couleurs = { whisky: 0xc4791f, vin: 0x6e1224, biere: 0xd9932b };
  const liquide = new THREE.MeshStandardMaterial({ color: couleurs[type] || 0xc4791f, roughness: 0.25 });

  const coque = [], contenu = [];

  if(type === 'vin'){

    const coupe = new THREE.CylinderGeometry(0.038, 0.012, 0.085, 18, 1, true);
    coupe.translate(0, 0.045, 0);
    coque.push(coupe);

    const vin = new THREE.CylinderGeometry(0.030, 0.011, 0.042, 18);
    vin.translate(0, 0.028, 0);
    contenu.push(vin);

    const pied = new THREE.CylinderGeometry(0.004, 0.004, 0.075, 8);
    pied.translate(0, -0.02, 0);
    coque.push(pied);

    const base = new THREE.CylinderGeometry(0.030, 0.030, 0.004, 18);
    base.translate(0, -0.058, 0);
    coque.push(base);

  } else if(type === 'biere'){

    const pinte = new THREE.CylinderGeometry(0.037, 0.030, 0.150, 18, 1, true);
    pinte.translate(0, 0.0, 0);
    coque.push(pinte);

    const biere = new THREE.CylinderGeometry(0.0355, 0.0295, 0.118, 18);
    biere.translate(0, -0.013, 0);
    contenu.push(biere);

    const mousse = new THREE.CylinderGeometry(0.0365, 0.0355, 0.026, 18);
    mousse.translate(0, 0.060, 0);
    colorer(mousse, '#f3ecd8');
    contenu.push(mousse);

  } else {

    const gobelet = new THREE.CylinderGeometry(0.034, 0.029, 0.090, 18, 1, true);
    coque.push(gobelet);

    const alcool = new THREE.CylinderGeometry(0.0315, 0.0275, 0.046, 18);
    alcool.translate(0, -0.020, 0);
    contenu.push(alcool);

    // Deux glaçons.
    [[-0.008, 0.012], [0.011, 0.006]].forEach(([x, z]) => {
      const gl = new THREE.BoxGeometry(0.016, 0.016, 0.016);
      gl.rotateY(0.6);
      gl.translate(x, 0.008, z);
      colorer(gl, '#dff2f8');
      contenu.push(gl);
    });
  }

  contenu.forEach(c => { if(!c.attributes.color) colorer(c, '#ffffff'); });
  coque.forEach(c => { if(!c.attributes.color) colorer(c, '#ffffff'); });

  const mLiquide = new THREE.Mesh(fusionner(contenu), new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.3, color: couleurs[type] || 0xc4791f
  }));
  const mVerre = new THREE.Mesh(fusionner(coque), verre);
  mVerre.renderOrder = 2;

  g.add(mLiquide, mVerre);

  return g;
}

// Les habitués, installés sur leurs sièges.
function construireHabitues(){

  HABITUES.forEach(def => {

    const siege = SIEGES.find(s => s.id === def.siege);
    if(!siege) return;

    const h = new Habitue(def, siege);

    scene.add(h.groupe);
    habitues.push(h);
  });
}

class Habitue extends Humain {

  constructor(def, siege){

    super(APPARENCES[def.look]);

    this.def = def;
    this.siege = siege;
    this.type = 'habitue';
    this.pointBouche = new THREE.Vector3();
    this.repos = def.mains.map(m => new THREE.Vector3(m[0], m[1], m[2]));
    this.qTravail = new THREE.Quaternion();
    this.bumpAvant = 0;

    const fauteuil = siege.genre === 'fauteuil';

    this.installer({
      x: siege.x, z: siege.z, yaw: siege.yaw,
      hanche: fauteuil ? [0.38 + 0.095, -0.09] : [siege.haut + 0.05 + 0.095, 0],
      penche: def.penche || 0,
      pieds: siege.pieds
    });

    this.viserBras(0, this.repos[0], def.pron[0]);
    this.viserBras(1, this.repos[1], def.pron[1]);

    // Le verre est dans la main ; il reste droit, quoi que fasse le bras.
    if(def.verre){
      this.verre = creerVerre(def.verre);
      this.verre.position.set(0, -HUMAIN.avantBras - 0.045, 0.028);
      this.bras[def.mainVerre || 0].coude.add(this.verre);
    }

    this.majBras(true);
  }

  maj(dt, t, reduit, cible){

    const def = this.def;

    this.taille.position.y = HUMAIN.pivot + (reduit ? 0 : Math.sin(t * 1.6 + this.phase) * 0.0035);

    let defaut = def.regard || 0;
    let baisse = 0;
    let bump = 0;

    if(def.activite === 'discute' && !reduit){
      // Il regarde tantôt son voisin, tantôt devant lui.
      defaut = def.regard * (0.45 + 0.55 * Math.sin(t * 0.55 + this.phase));
    }

    if(def.activite === 'cartes'){
      // Les yeux sur ses cartes, avec un coup d'œil de temps en temps.
      const cycle = (t * 0.11 + this.phase) % 1;
      baisse = 0.32 * (cycle > 0.85 && !reduit ? 0.1 : 1);
    }

    this.regarder(dt, t, reduit, cible, defaut, def.portee || 5, 1.15);

    // Une gorgée toutes les dix à quinze secondes.
    if(this.verre && !reduit){
      const periode = 10 + (this.phase % 5);
      const u = ((t + this.phase * 2) % periode) / 3.6;
      if(u < 1){
        bump = Math.sin(u * Math.PI);
        bump = bump * bump * (3 - 2 * bump);
      }
    }

    this.tete.rotation.set(
      this.cou.pitch + (baisse - bump * 0.20) * (1 - this.attention),
      this.cou.yaw,
      0
    );

    // Les mains : posées, sauf celle du verre qui monte à la bouche, et une
    // qui pousse un jeton ou une carte de temps en temps.
    if(bump > 0.001 || this.bumpAvant > 0.001){

      const i = def.mainVerre || 0;
      this.bouche(this.pointBouche);
      this.pointBouche.y -= 0.03;
      this.pointBouche.z += 0.085;
      this.pointBouche.x += (i === 0 ? -0.02 : 0.02);

      this.viserBras(i, this.repos[i].clone().lerp(this.pointBouche, bump), def.pron[i] * (1 - bump * 0.6));
    }

    this.bumpAvant = bump;

    if(def.activite === 'cartes' && !reduit){
      const p = (t * 0.13 + this.phase) % 1;
      if(p < 0.08){
        const i = this.phase > 3 ? 0 : 1;
        const s = Math.sin(p / 0.08 * Math.PI);
        this.viserBras(i, this.repos[i].clone().add(new THREE.Vector3(0.05 * s * (i ? -1 : 1), 0.0, -0.06 * s)));
      } else if(p < 0.1){
        this.viserBras(0, this.repos[0]);
        this.viserBras(1, this.repos[1]);
      }
    }

    // Le verre reste droit, quelle que soit la position du bras.
    if(this.verre){
      const b = this.bras[this.def.mainVerre || 0];
      const q = this.qTravail.copy(this.groupe.quaternion)
        .multiply(this.bassin.quaternion).multiply(this.taille.quaternion)
        .multiply(b.epaule.quaternion).multiply(b.coude.quaternion);
      this.verre.quaternion.copy(q).invert();
      this.verre.rotateX(-0.9 * bump);
    }

    this.majBras();
  }
}

// Des jetons et des cartes sur les tables de jeu : une seule forme pour les
// jetons, une pour les cartes.
function construireJetons(){

  const jetons = [], cartes = [];
  const couleurs = ['#b3202f', '#1f4fa8', '#14161b', '#e7e1d2', '#1f8a52'];

  const pile = (x, y, z, n, c) => {
    for(let i = 0; i < n; i++){
      jetons.push(cylindre(0.0195, 0.0195, 0.0036, x, y + 0.0018 + i * 0.0038, z, c, 14));
      jetons.push(cylindre(0.0198, 0.0198, 0.0008, x, y + 0.0018 + i * 0.0038, z, melange(c, '#ffffff', 0.55), 14));
    }
  };

  const carte = (x, y, z, rot, face) => {
    const g = boite(0.058, 0.0012, 0.084, 0, 0, 0, face ? '#f3eee2' : '#1c3a6e');
    g.rotateY(rot);
    g.translate(x, y + 0.0007, z);
    cartes.push(g);
  };

  // Blackjack : une pile et une paire de cartes devant chaque tabouret, le
  // sabot du croupier.
  {
    const cx = -6.55, cz = 2.4, y = 0.956;

    SIEGES.filter(s => /^bj/.test(s.id)).forEach((s, i) => {
      const ux = (s.x - cx) / 1.85, uz = (s.z - cz) / 1.85;
      const px = cx + ux * 1.02, pz = cz + uz * 1.02;
      const rot = Math.atan2(ux, uz);
      pile(px + uz * 0.12, y, pz - ux * 0.12, 3 + (i % 3), couleurs[i % 5]);
      pile(px + uz * 0.17, y, pz - ux * 0.17, 2, couleurs[(i + 2) % 5]);
      carte(px - uz * 0.05, y, pz + ux * 0.05, rot + 0.15, true);
      carte(px - uz * 0.09, y + 0.0012, pz + ux * 0.09, rot - 0.12, i % 2 === 0);
    });

    jetons.push(boite(0.11, 0.05, 0.16, -6.36, y + 0.025, cz + 0.45, '#14161b'));
    carte(-6.36, y + 0.05, cz + 0.45, 0.1, false);
  }

  // Poker : le pot au milieu, des cartes devant chaque joueur.
  {
    const cx = 5.6, cz = 4.6, y = 0.956;

    pile(cx - 0.05, y, cz, 6, couleurs[0]);
    pile(cx + 0.03, y, cz + 0.04, 4, couleurs[1]);
    pile(cx + 0.02, y, cz - 0.05, 5, couleurs[4]);
    pile(cx - 0.08, y, cz + 0.06, 3, couleurs[2]);

    SIEGES.filter(s => /^pok/.test(s.id)).forEach((s, i) => {
      const ux = (s.x - cx) / 1.85, uz = (s.z - cz) / 1.85;
      const px = cx + ux * 0.98, pz = cz + uz * 0.98;
      const rot = Math.atan2(ux, uz);
      carte(px - uz * 0.04, y, pz + ux * 0.04, rot + 0.2, false);
      carte(px + uz * 0.03, y + 0.0012, pz - ux * 0.03, rot - 0.15, false);
      pile(px + uz * 0.16, y, pz - ux * 0.16, 2 + i % 4, couleurs[(i + 1) % 5]);
    });
  }

  if(jetons.length){
    const m = new THREE.Mesh(fusionner(jetons), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4 }));
    scene.add(m);
  }

  if(cartes.length){
    scene.add(new THREE.Mesh(fusionner(cartes), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 })));
  }
}

// Le croupier, son étal de boosters sur la table, l'enseigne au mur et un
// booster qui flotte au-dessus, pour qu'on le repère de loin.
function construireBoutique(){

  R.matBoosterFace = new THREE.MeshPhongMaterial({
    map: R.texture(creerBoosterFace(R.logo, false)), specular: 0x9cc8ff, shininess: 120
  });

  R.matBoosterDos = new THREE.MeshPhongMaterial({
    map: R.texture(creerBoosterDos(R.logo)), specular: 0x9cc8ff, shininess: 120
  });

  R.reflet = R.texture(creerRefletFoil(), { repete: true });

  R.matFoil = new THREE.MeshBasicMaterial({
    map: R.reflet, transparent: true, opacity: 0.2, depthWrite: false,
    blending: THREE.AdditiveBlending
  });

  croupier = new Croupier(CROUPIER.x, CROUPIER.z, CROUPIER.rot);
  scene.add(croupier.groupe);

  // Trois boosters posés contre un rail de laiton, sur le feutre.
  const tx = -6.28, tz = CROUPIER.z;

  [-0.24, 0, 0.24].forEach(dz => {
    const socle = new THREE.Group();
    socle.position.set(tx, 0.954, tz + dz);
    socle.rotation.y = Math.PI / 2;

    const p = fabriquerBooster(0.13, 0.195, 0.014);
    p.position.set(0, 0.098, -0.012);
    p.rotation.x = -0.22;

    socle.add(p);
    scene.add(socle);
  });

  const rail = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.035, 0.76), R.matLaitonUni);
  rail.position.set(tx + 0.07, 0.972, tz);
  scene.add(rail);

  // L'enseigne au mur, derrière lui.
  const enseigne = new THREE.Mesh(
    new THREE.PlaneGeometry(2.3, 0.42),
    new THREE.MeshBasicMaterial({
      map: R.texture(creerEnseigne('LA WAVE TCG', '#4FB4FF', 1200, 220, 116)),
      transparent: true, depthWrite: false
    })
  );
  enseigne.position.set(-SALLE.l + 0.04, 3.0, CROUPIER.z);
  enseigne.rotation.y = Math.PI / 2;
  scene.add(enseigne);

  // Un booster qui flotte et tourne au-dessus de la table, avec sa lueur.
  const flotte = fabriquerBooster(0.26, 0.39, 0.026);
  flotte.position.set(-5.95, 2.25, CROUPIER.z);
  scene.add(flotte);

  poserHalo(-5.95, 2.25, CROUPIER.z, '#6fb8ff');

  animes.boutique = { flotte, y0: 2.25 };
}

function construireLumieres(){

  const laiton = [], led = [];

  // Le lustre en anneau, au-dessus de la machine : seize ampoules.
  const yAnneau = SALLE.h - 0.42;

  const rAnneau = RAYON_PODIUM - 0.1;

  const anneau = new THREE.TorusGeometry(rAnneau, 0.035, 8, 72);
  anneau.rotateX(Math.PI / 2);
  anneau.translate(0, yAnneau, 0);
  colorer(anneau, LAITON);
  laiton.push(anneau);

  for(let i = 0; i < 3; i++){
    const a = i * TAU / 3 + 0.5;
    laiton.push(cylindre(0.008, 0.008, 0.42, Math.sin(a) * rAnneau, yAnneau + 0.21, Math.cos(a) * rAnneau, LAITON, 6));
  }

  for(let i = 0; i < 16; i++){
    const a = i * TAU / 16;
    const x = Math.sin(a) * rAnneau, z = Math.cos(a) * rAnneau;
    led.push(sphere(0.06, x, yAnneau - 0.07, z, '#fff1d6'));
    poserHalo(x, yAnneau - 0.13, z, '#ffd9a0');
  }

  fusion(laiton, R.matLaiton);
  fusion(led, R.matLed);

  // Le faisceau qui tombe du lustre sur l'estrade.
  const hCone = yAnneau - 0.1;

  const cone = new THREE.Mesh(
    new THREE.CylinderGeometry(0.3, rAnneau, hCone, 48, 1, true),
    creerMateriauFaisceau()
  );
  cone.position.y = 0.1 + hCone / 2;
  cone.renderOrder = 2;
  scene.add(cone);

  // Il s'efface quand on s'assoit devant la machine : on regarderait les
  // rouleaux à travers un voile de lumière.
  R.faisceau = cone;

  // Tous les halos, en un seul nuage de points.
  if(HALOS.pos.length){

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(HALOS.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(HALOS.col, 3));

    const pts = new THREE.Points(g, new THREE.PointsMaterial({
      size: 0.75, map: R.halo, vertexColors: true, transparent: true, opacity: 0.55,
      depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true
    }));
    pts.frustumCulled = false;
    pts.renderOrder = 4;
    scene.add(pts);
  }
}

function construireAmbiance(){

  // De la poussière dorée dans le faisceau : à peine visible, mais l'air
  // paraît épais de lumière.
  const n = 90;
  const pos = new Float32Array(n * 3);
  const grains = [];

  for(let i = 0; i < n; i++){
    const a = Math.random() * TAU, r = Math.sqrt(Math.random()) * (RAYON_PODIUM - 0.2);
    grains.push({ a, r, y: hasard(0.3, 4.4), v: hasard(0.02, 0.07), w: hasard(0.03, 0.1) });
    pos[i * 3] = Math.sin(a) * r;
    pos[i * 3 + 1] = grains[i].y;
    pos[i * 3 + 2] = Math.cos(a) * r;
  }

  const gp = new THREE.BufferGeometry();
  gp.setAttribute('position', new THREE.BufferAttribute(pos, 3));

  const poussiere = new THREE.Points(gp, new THREE.PointsMaterial({
    size: 0.035, map: R.halo, color: 0xffe2b0, transparent: true, opacity: 0.55,
    depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true
  }));
  poussiere.frustumCulled = false;
  poussiere.renderOrder = 3;
  scene.add(poussiere);

  animes.poussiere = { pos, grains, points: poussiere };

  // Les pièces qui jaillissent de la machine quand elle gagne.
  const nP = 90;
  const posP = new Float32Array(nP * 3).fill(-10);

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(posP, 3));

  const pts = new THREE.Points(g, new THREE.PointsMaterial({
    size: 0.1, map: R.texture(creerPieceTex()), transparent: true, depthWrite: false,
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
   Le rendu : lumière, reflets, étalonnage
   ----------------------------------------------------------------------
   La salle n'est plus dessinée directement à l'écran. Elle l'est d'abord dans
   une image intermédiaire, que quelques passes de shader transforment :
     - un halo autour de ce qui brille (néons, lampes, foil des cartes) ;
     - un étalonnage : une courbe douce, des ombres chaudes, un peu plus de
       couleur ; une vignette sur les bords ; un grain très léger ;
   et, dans la salle, le sol reflète ce qui se trouve au-dessus de lui : un
   second rendu, pris par une caméra placée sous le sol, que le parquet et le
   podium relisent.
   Tout cela se coupe de lui-même si la machine peine, dans cet ordre : le
   halo, les reflets, puis le tout.
   ---------------------------------------------------------------------- */

const POST = {
  actif: false, bloom: true, rt: null, flouA: null, flouB: null,
  cam: null, scene: null, quad: null, mat: {}, essais: 0
};

const REFLET = {
  actif: false, plan: 0.142, rt: null, cam: null, matrice: null, surfaces: [], prets: false
};

const VS_ECRAN = `
varying vec2 vUv;
void main(){
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

// Ne garde de l'image que ce qui est clair : le reste devient noir.
const FS_SEUIL = `
uniform sampler2D tScene;
uniform float uSeuil;
varying vec2 vUv;
void main(){
  vec3 c = texture2D(tScene, vUv).rgb;
  float l = max(c.r, max(c.g, c.b));
  float k = smoothstep(uSeuil, uSeuil + 0.22, l);
  gl_FragColor = vec4(c * k, 1.0);
}`;

// Un flou gaussien, dans une direction à la fois.
const FS_FLOU = `
uniform sampler2D tSource;
uniform vec2 uDir;
varying vec2 vUv;
void main(){
  vec3 s = texture2D(tSource, vUv).rgb * 0.2270270270;
  s += texture2D(tSource, vUv + uDir * 1.3846153846).rgb * 0.3162162162;
  s += texture2D(tSource, vUv - uDir * 1.3846153846).rgb * 0.3162162162;
  s += texture2D(tSource, vUv + uDir * 3.2307692308).rgb * 0.0702702703;
  s += texture2D(tSource, vUv - uDir * 3.2307692308).rgb * 0.0702702703;
  gl_FragColor = vec4(s, 1.0);
}`;

// L'image finale : l'image, son halo, l'étalonnage, la vignette, le grain.
const FS_FINAL = `
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform float uBloom;
uniform float uT;
uniform vec2 uRes;
uniform float uVignette;
uniform float uGrain;
varying vec2 vUv;

vec3 etalonner(vec3 c){
  // Une courbe douce : les hautes lumières s'écrasent un peu, les ombres
  // remontent, et l'ensemble gagne en contraste.
  c = c * 1.06;
  c = c / (1.0 + 0.16 * c);
  c = mix(c, c * c * (3.0 - 2.0 * c), 0.20);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, 1.05);
  // Des ombres un peu chaudes, des lumières un peu plus neutres.
  c *= mix(vec3(1.04, 1.0, 0.94), vec3(1.0, 1.0, 1.0), smoothstep(0.0, 0.6, l));
  return c;
}

void main(){
  vec2 d = vUv - 0.5;
  float r2 = dot(d, d);

  // Une très légère dispersion des couleurs vers les bords, comme une vraie
  // optique.
  vec2 off = d * r2 * 0.010;

  vec3 col;
  col.r = texture2D(tScene, vUv + off).r;
  col.g = texture2D(tScene, vUv).g;
  col.b = texture2D(tScene, vUv - off).b;

  col += texture2D(tBloom, vUv).rgb * uBloom;

  col = etalonner(col);

  col *= 1.0 - uVignette * smoothstep(0.18, 0.62, r2);

  float g = fract(sin(dot(vUv * uRes + fract(uT) * 91.7, vec2(12.9898, 78.233))) * 43758.5453);
  col += (g - 0.5) * uGrain;

  gl_FragColor = vec4(col, 1.0);
}`;

function creerPost(){

  try{

    const t = new THREE.Vector2();
    renderer.getDrawingBufferSize(t);

    const opt = {
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat, depthBuffer: true, stencilBuffer: false
    };

    POST.rt = new THREE.WebGLRenderTarget(Math.max(2, t.x), Math.max(2, t.y), opt);

    // L'anticrénelage du rendu direct ne vaut pas pour une image
    // intermédiaire : WebGL 2 sait la multi-échantillonner. Sur téléphone, le
    // surcoût ne vaut pas le gain.
    if(renderer.capabilities.isWebGL2 && !etat.tactile) POST.rt.samples = 4;

    const petit = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat, depthBuffer: false };
    POST.flouA = new THREE.WebGLRenderTarget(2, 2, petit);
    POST.flouB = new THREE.WebGLRenderTarget(2, 2, petit);

    POST.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    POST.scene = new THREE.Scene();

    POST.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null);
    POST.quad.frustumCulled = false;
    POST.scene.add(POST.quad);

    const mat = (vs, fs, uniforms) => new THREE.ShaderMaterial({
      uniforms, vertexShader: vs, fragmentShader: fs, depthTest: false, depthWrite: false
    });

    POST.mat.seuil = mat(VS_ECRAN, FS_SEUIL, { tScene: { value: POST.rt.texture }, uSeuil: { value: 0.84 } });
    POST.mat.flou = mat(VS_ECRAN, FS_FLOU, { tSource: { value: null }, uDir: { value: new THREE.Vector2() } });
    POST.mat.final = mat(VS_ECRAN, FS_FINAL, {
      tScene: { value: POST.rt.texture }, tBloom: { value: POST.flouA.texture },
      uBloom: { value: 0.75 }, uT: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) },
      uVignette: { value: 0.36 }, uGrain: { value: 0.02 }
    });

    POST.actif = true;
    POST.bloom = true;

    redimensionnerPost();

  }catch(e){
    POST.actif = false;
  }
}

// Les images intermédiaires suivent la taille de l'écran ; le halo se calcule
// en quart de résolution.
function redimensionnerPost(){

  if(!POST.actif && !REFLET.actif) return;

  const t = new THREE.Vector2();
  renderer.getDrawingBufferSize(t);

  const l = Math.max(2, Math.floor(t.x)), h = Math.max(2, Math.floor(t.y));

  if(POST.actif){
    POST.rt.setSize(l, h);
    const pl = Math.max(2, Math.floor(l / 4)), ph = Math.max(2, Math.floor(h / 4));
    POST.flouA.setSize(pl, ph);
    POST.flouB.setSize(pl, ph);
    POST.mat.final.uniforms.uRes.value.set(l, h);
  }

  if(REFLET.actif){
    REFLET.rt.setSize(Math.max(2, Math.floor(l / 2)), Math.max(2, Math.floor(h / 2)));
  }
}

function passe(materiau, cible){
  POST.quad.material = materiau;
  renderer.setRenderTarget(cible);
  renderer.render(POST.scene, POST.cam);
}

// Dessine `sc` vue par `cam`, avec ou sans les effets.
function rendre(sc, cam){

  if(!POST.actif){
    renderer.setRenderTarget(null);
    renderer.render(sc, cam);
    return;
  }

  renderer.setRenderTarget(POST.rt);
  renderer.render(sc, cam);

  if(POST.bloom){

    const pl = POST.flouA.width, ph = POST.flouA.height;

    passe(POST.mat.seuil, POST.flouA);

    // Deux allers-retours : un halo large, doux.
    for(let i = 0; i < 2; i++){
      POST.mat.flou.uniforms.tSource.value = POST.flouA.texture;
      POST.mat.flou.uniforms.uDir.value.set(1 / pl, 0);
      passe(POST.mat.flou, POST.flouB);

      POST.mat.flou.uniforms.tSource.value = POST.flouB.texture;
      POST.mat.flou.uniforms.uDir.value.set(0, 1 / ph);
      passe(POST.mat.flou, POST.flouA);
    }
  }

  POST.mat.final.uniforms.uBloom.value = POST.bloom ? 0.75 : 0;
  POST.mat.final.uniforms.uT.value = temps;

  passe(POST.mat.final, null);
}

// La salle, telle que la voit une caméra placée sous le sol : c'est ce que le
// parquet et le podium reflètent. Même méthode que le miroir d'un jeu 3D :
// on reflète la position de la caméra et sa cible par rapport au plan.
function creerReflet(){

  try{

    REFLET.rt = new THREE.WebGLRenderTarget(2, 2, {
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat
    });
    REFLET.cam = new THREE.PerspectiveCamera();
    REFLET.matrice = new THREE.Matrix4();
    REFLET.actif = true;

    redimensionnerPost();

  }catch(e){
    REFLET.actif = false;
  }
}

function majReflet(sc, cam){

  if(!REFLET.actif || !REFLET.surfaces.length) return;

  // Une caméra sous le plan ne voit aucun reflet.
  if(cam.position.y <= REFLET.plan + 0.02) return;

  const c = REFLET.cam;
  const y0 = REFLET.plan;

  const dir = new THREE.Vector3();
  cam.getWorldDirection(dir);

  const pos = cam.position.clone();
  const cible = pos.clone().add(dir);

  c.position.set(pos.x, 2 * y0 - pos.y, pos.z);
  cible.y = 2 * y0 - cible.y;

  c.up.set(0, -1, 0);
  c.lookAt(cible);
  c.up.set(0, 1, 0);

  c.fov = cam.fov;
  c.aspect = cam.aspect;
  c.near = cam.near;
  c.far = cam.far;
  c.updateProjectionMatrix();
  c.updateMatrixWorld();

  REFLET.matrice.set(
    0.5, 0, 0, 0.5,
    0, 0.5, 0, 0.5,
    0, 0, 0.5, 0.5,
    0, 0, 0, 1
  );
  REFLET.matrice.multiply(c.projectionMatrix);
  REFLET.matrice.multiply(c.matrixWorldInverse);

  REFLET.surfaces.forEach(s => { s.visible = false; });

  const hl = R.faisceau ? R.faisceau.visible : false;

  renderer.setRenderTarget(REFLET.rt);
  renderer.render(sc, c);
  renderer.setRenderTarget(null);

  REFLET.surfaces.forEach(s => { s.visible = true; });
  if(R.faisceau) R.faisceau.visible = hl;
}

// Un matériau Phong (ou Standard) qui relit le reflet du sol : à la couleur
// de la surface s'ajoute ce que la caméra sous le sol a vu, d'autant plus
// fort que l'on regarde la surface de biais (Fresnel), et d'autant plus flou
// que la surface est rugueuse.
function refleter(materiau, force, brillance, base){

  // Sans reflets (téléphone, ou création impossible) : le matériau reste tel
  // quel.
  if(!REFLET.actif) return materiau;

  materiau.onBeforeCompile = (shader) => {

    shader.uniforms.tReflet = { value: REFLET.rt ? REFLET.rt.texture : null };
    shader.uniforms.uMatReflet = { value: REFLET.matrice };
    shader.uniforms.uForceReflet = { value: force };
    shader.uniforms.uFlouReflet = { value: brillance === undefined ? 0.006 : brillance };
    shader.uniforms.uBaseReflet = { value: base === undefined ? 0.12 : base };

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform mat4 uMatReflet;\nvarying vec4 vReflet;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvReflet = uMatReflet * modelMatrix * vec4(position, 1.0);');

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D tReflet;\nuniform float uForceReflet;\nuniform float uFlouReflet;\nuniform float uBaseReflet;\nvarying vec4 vReflet;')
      .replace('#include <dithering_fragment>', `
        {
          vec2 ruv = vReflet.xy / max(vReflet.w, 0.0001);
          float f = uFlouReflet;
          vec3 rc = texture2D(tReflet, ruv).rgb * 0.4;
          rc += texture2D(tReflet, ruv + vec2(f, 0.0)).rgb * 0.15;
          rc += texture2D(tReflet, ruv - vec2(f, 0.0)).rgb * 0.15;
          rc += texture2D(tReflet, ruv + vec2(0.0, f)).rgb * 0.15;
          rc += texture2D(tReflet, ruv - vec2(0.0, f)).rgb * 0.15;
          float fres = pow(1.0 - clamp(dot(normalize(vNormal), normalize(vViewPosition)), 0.0, 1.0), 2.2);
          gl_FragColor.rgb += rc * uForceReflet * (uBaseReflet + (1.0 - uBaseReflet) * fres);
        }
        #include <dithering_fragment>`);

    materiau.userData.shader = shader;
  };

  materiau.needsUpdate = true;
  return materiau;
}


/* ----------------------------------------------------------------------
   Les cartes La Wave TCG
   ----------------------------------------------------------------------
   Une carte, c'est un nom, une illustration, une phrase. L'illustration est
   un glyphe blanc sur un fond nuit, dans l'esprit du booster : presque rien,
   et c'est ce qui la rend lisible de loin. Tout est dessiné ici, sur un
   canvas 2D. Les cartes elles-mêmes (nom, rareté, dessin) viennent de la
   base : ce fichier sait seulement les dessiner.
   ---------------------------------------------------------------------- */

const CARTE_L = 512, CARTE_H = 716;

const RARETES = {
  commune:    { nom: 'Commune',    couleur: '#8ea4ba', sombre: '#0f1e2e', pastilles: 1, foil: 0.0, rang: 0 },
  rare:       { nom: 'Rare',       couleur: '#4FB4FF', sombre: '#0a2b4d', pastilles: 2, foil: 0.40, rang: 1 },
  epique:     { nom: 'Épique',     couleur: '#b98aff', sombre: '#2a1250', pastilles: 3, foil: 0.80, rang: 2 },
  legendaire: { nom: 'Légendaire', couleur: '#ffd36b', sombre: '#46300a', pastilles: 4, foil: 1.0, rang: 3 }
};

const rarete = id => RARETES[id] || RARETES.commune;

function rectArrondi(g, x, y, l, h, r){
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + l, y, x + l, y + h, r);
  g.arcTo(x + l, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + l, y, r);
  g.closePath();
}

// Les outils des glyphes : on trace un chemin, puis on le remplit (blanc,
// légèrement teinté vers le bas) ou on le creuse (trait de l'encre du fond).
const ENCRE = '#0a1630';

function remplir(g, c, evenodd){
  const d = g.createLinearGradient(0, -100, 0, 100);
  d.addColorStop(0, '#ffffff');
  d.addColorStop(1, melange('#ffffff', c, 0.6));
  g.fillStyle = d;
  if(evenodd) g.fill('evenodd'); else g.fill();
}

function creux(g, l, col){
  g.lineWidth = l || 5;
  g.strokeStyle = col || ENCRE;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.stroke();
}

function trait(g, x0, y0, x1, y1){
  g.beginPath();
  g.moveTo(x0, y0);
  g.lineTo(x1, y1);
}

function rond(g, x, y, r){
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
}

function ovale(g, x, y, rx, ry, rot){
  g.beginPath();
  g.ellipse(x, y, rx, ry, rot || 0, 0, TAU);
}

function poly(g, pts){
  g.beginPath();
  pts.forEach((p, i) => { if(i) g.lineTo(p[0], p[1]); else g.moveTo(p[0], p[1]); });
  g.closePath();
}

const VOILE = 'rgba(10,22,48,.5)';

// Les dessins : chacun se trace autour de (0, 0), dans ± 120 en x et ± 105 en
// y, avec la couleur de rareté `c` pour les accents.
const MOTIFS = {

  guitare(g, c){
    g.save();
    g.rotate(-0.72);
    ovale(g, 0, 58, 44, 38); remplir(g, c);
    ovale(g, 0, 14, 31, 27); remplir(g, c);
    rectArrondi(g, -8, -92, 16, 120, 4); remplir(g, c);
    rectArrondi(g, -14, -118, 28, 32, 8); remplir(g, c);
    rond(g, 0, 60, 11); creux(g, 5);
    trait(g, -24, 34, 24, 34); creux(g, 6);
    trait(g, -26, 48, 26, 48); creux(g, 6);
    trait(g, -14, 84, 14, 84); creux(g, 7, c);
    trait(g, -3, -96, -3, 82); creux(g, 1.6, VOILE);
    trait(g, 3, -96, 3, 82); creux(g, 1.6, VOILE);
    [-1, 1].forEach(s => { rond(g, s * 14, -106, 3.6); g.fillStyle = c; g.fill(); });
    g.restore();
  },

  micro(g, c){
    g.save();
    rectArrondi(g, -30, -98, 60, 104, 30); remplir(g, c);
    rectArrondi(g, -30, -98, 60, 104, 30); g.clip();
    [-78, -62, -46, -30, -14].forEach(y => { trait(g, -32, y, 32, y); creux(g, 4, VOILE); });
    [-16, 0, 16].forEach(x => { trait(g, x, -100, x, 6); creux(g, 3, VOILE); });
    g.restore();
    g.beginPath(); g.moveTo(-46, -34); g.quadraticCurveTo(-46, 34, 0, 34); g.quadraticCurveTo(46, 34, 46, -34);
    creux(g, 9, '#ffffff');
    rectArrondi(g, -6, 34, 12, 44, 3); remplir(g, c);
    rectArrondi(g, -36, 76, 72, 13, 6); remplir(g, c);
  },

  batterie(g, c){
    rectArrondi(g, -76, -8, 152, 70, 6); remplir(g, c);
    ovale(g, 0, 62, 76, 24); remplir(g, c);
    ovale(g, 0, -8, 76, 24); remplir(g, c);
    ovale(g, 0, -8, 62, 17); creux(g, 4, VOILE);
    [-54, -27, 0, 27, 54].forEach(x => { trait(g, x, 12, x, 62); creux(g, 5); });
    trait(g, -78, -104, 6, -24); creux(g, 13, '#ffffff');
    trait(g, 78, -104, -6, -24); creux(g, 13, '#ffffff');
    [-78, 78].forEach(x => { rond(g, x, -104, 9); g.fillStyle = c; g.fill(); });
  },

  piano(g, c){
    rectArrondi(g, -100, -92, 200, 34, 9); remplir(g, c);
    rectArrondi(g, -100, -46, 200, 104, 9); remplir(g, '#ffffff');
    for(let i = 1; i < 7; i++){ trait(g, -100 + i * 200 / 7, -46, -100 + i * 200 / 7, 58); creux(g, 3, VOILE); }
    [1, 2, 4, 5, 6].forEach(i => {
      rectArrondi(g, -100 + i * 200 / 7 - 10, -46, 20, 62, 4);
      g.fillStyle = ENCRE; g.fill();
    });
    trait(g, -60, -75, 60, -75); creux(g, 4, ENCRE);
  },

  casque(g, c){
    g.beginPath(); g.arc(0, 12, 74, Math.PI * 1.02, Math.PI * 1.98); creux(g, 14, '#ffffff');
    rectArrondi(g, -96, 0, 36, 70, 15); remplir(g, c);
    rectArrondi(g, 60, 0, 36, 70, 15); remplir(g, c);
    rectArrondi(g, -90, 10, 14, 50, 7); g.fillStyle = 'rgba(10,22,48,.35)'; g.fill();
    rectArrondi(g, 76, 10, 14, 50, 7); g.fillStyle = 'rgba(10,22,48,.35)'; g.fill();
    rond(g, -78, 35, 6); g.fillStyle = c; g.fill();
    rond(g, 78, 35, 6); g.fillStyle = c; g.fill();
  },

  enceinte(g, c){
    rectArrondi(g, -60, -100, 120, 200, 16); remplir(g, c);
    rond(g, 0, 40, 42); creux(g, 8);
    rond(g, 0, 40, 27); g.fillStyle = 'rgba(10,22,48,.45)'; g.fill();
    rond(g, 0, 40, 10); remplir(g, c);
    rond(g, 0, -52, 17); creux(g, 6);
    rond(g, 0, -52, 6); g.fillStyle = c; g.fill();
    rond(g, 0, -86, 3.5); g.fillStyle = VOILE; g.fill();
  },

  cassette(g, c){
    rectArrondi(g, -104, -66, 208, 132, 14); remplir(g, c);
    rectArrondi(g, -84, -50, 168, 52, 8); g.fillStyle = 'rgba(10,22,48,.16)'; g.fill();
    trait(g, -70, -34, 70, -34); creux(g, 3, VOILE);
    trait(g, -70, -20, 40, -20); creux(g, 3, VOILE);
    rond(g, -44, -14, 21); g.fillStyle = ENCRE; g.fill();
    rond(g, 44, -14, 21); g.fillStyle = ENCRE; g.fill();
    [-44, 44].forEach(x => { rond(g, x, -14, 10); g.fillStyle = '#ffffff'; g.fill(); });
    poly(g, [[-58, 66], [-46, 26], [46, 26], [58, 66]]); g.fillStyle = 'rgba(10,22,48,.3)'; g.fill();
    [[-92, -54], [92, -54], [-92, 54], [92, 54]].forEach(([x, y]) => { rond(g, x, y, 4); g.fillStyle = VOILE; g.fill(); });
  },

  note(g, c){
    ovale(g, -46, 56, 25, 18, -0.4); remplir(g, c);
    ovale(g, 44, 38, 25, 18, -0.4); remplir(g, c);
    rectArrondi(g, -30, -72, 10, 126, 3); remplir(g, c);
    rectArrondi(g, 60, -90, 10, 126, 3); remplir(g, c);
    poly(g, [[-30, -74], [70, -96], [70, -62], [-30, -40]]); remplir(g, c);
  },

  vague(g, c){
    for(let k = 0; k < 3; k++){
      g.beginPath();
      for(let i = 0; i <= 44; i++){
        const t = i / 44;
        const x = -96 + t * 192, y = -46 + k * 46 + Math.sin(t * TAU * 1.5 + k * 0.9) * 15;
        if(i) g.lineTo(x, y); else g.moveTo(x, y);
      }
      creux(g, 15, k === 1 ? c : '#ffffff');
    }
    [[-62, -84, 5], [-6, -92, 4], [56, -82, 6], [34, -100, 3]].forEach(([x, y, r]) => { rond(g, x, y, r); g.fillStyle = '#ffffff'; g.fill(); });
  },

  coquillage(g, c){
    g.save();
    g.beginPath();
    g.moveTo(0, 86);
    for(let i = 0; i <= 7; i++){
      const a = Math.PI * (1.13 + 0.74 * i / 7);
      const a2 = Math.PI * (1.13 + 0.74 * (i + 0.5) / 7);
      g.lineTo(Math.cos(a) * 104, 86 + Math.sin(a) * 160);
      if(i < 7) g.quadraticCurveTo(Math.cos(a2) * 122, 86 + Math.sin(a2) * 186, Math.cos(Math.PI * (1.13 + 0.74 * (i + 1) / 7)) * 104, 86 + Math.sin(Math.PI * (1.13 + 0.74 * (i + 1) / 7)) * 160);
    }
    g.closePath();
    remplir(g, c);
    for(let i = 0; i <= 7; i++){
      const a = Math.PI * (1.13 + 0.74 * i / 7);
      trait(g, 0, 84, Math.cos(a) * 100, 86 + Math.sin(a) * 152); creux(g, 4, VOILE);
    }
    rectArrondi(g, -20, 80, 40, 14, 6); remplir(g, c);
    g.restore();
  },

  poisson(g, c){
    poly(g, [[-58, 0], [-104, -40], [-96, 0], [-104, 40]]); remplir(g, c);
    g.beginPath(); g.moveTo(-14, -38); g.quadraticCurveTo(14, -80, 46, -34); g.closePath(); remplir(g, c);
    g.beginPath(); g.moveTo(-6, 36); g.quadraticCurveTo(10, 62, 34, 34); g.closePath(); remplir(g, c);
    ovale(g, -6, 0, 68, 40); remplir(g, c);
    g.beginPath(); g.arc(34, 0, 26, Math.PI * 0.62, Math.PI * 1.38); creux(g, 4, VOILE);
    [-28, -8, 12].forEach(x => { g.beginPath(); g.arc(x, 0, 16, -0.95, 0.95); creux(g, 3, VOILE); });
    rond(g, 40, -9, 8); g.fillStyle = ENCRE; g.fill();
    rond(g, 42, -11, 2.6); g.fillStyle = '#ffffff'; g.fill();
  },

  ancre(g, c){
    rond(g, 0, -80, 15); creux(g, 10, '#ffffff');
    rectArrondi(g, -6, -66, 12, 140, 4); remplir(g, c);
    rectArrondi(g, -36, -50, 72, 12, 5); remplir(g, c);
    g.beginPath(); g.moveTo(-72, 4); g.quadraticCurveTo(-66, 82, 0, 84); g.quadraticCurveTo(66, 82, 72, 4);
    creux(g, 13, '#ffffff');
    poly(g, [[-88, 16], [-56, 16], [-72, -10]]); remplir(g, c);
    poly(g, [[88, 16], [56, 16], [72, -10]]); remplir(g, c);
  },

  bulle(g, c){
    [[-28, 28, 54], [46, -34, 34], [54, 56, 22]].forEach(([x, y, r]) => {
      rond(g, x, y, r); g.fillStyle = 'rgba(255,255,255,.12)'; g.fill(); creux(g, 8, '#ffffff');
      g.beginPath(); g.arc(x, y, r * 0.66, Math.PI * 1.1, Math.PI * 1.55); creux(g, 6, c);
    });
  },

  projecteur(g, c){
    poly(g, [[-28, 30], [28, 30], [84, 106], [-84, 106]]); g.fillStyle = 'rgba(255,255,255,.22)'; g.fill();
    rectArrondi(g, -36, -62, 72, 92, 14); remplir(g, c);
    ovale(g, 0, 30, 36, 11); g.fillStyle = c; g.fill();
    g.beginPath(); g.moveTo(-58, -6); g.lineTo(-58, 44); g.quadraticCurveTo(-58, 60, -40, 60);
    creux(g, 7, '#ffffff');
    g.beginPath(); g.moveTo(58, -6); g.lineTo(58, 44); g.quadraticCurveTo(58, 60, 40, 60);
    creux(g, 7, '#ffffff');
    trait(g, -36, -30, 36, -30); creux(g, 4, VOILE);
    trait(g, -36, -14, 36, -14); creux(g, 4, VOILE);
    trait(g, 0, -62, 0, -98); creux(g, 9, '#ffffff');
  },

  mouette(g, c){
    [-1, 1].forEach(s => {
      g.save();
      g.scale(s, 1);
      g.beginPath();
      g.moveTo(0, 16);
      g.bezierCurveTo(-18, -48, -66, -66, -108, -36);
      g.bezierCurveTo(-72, -46, -38, -24, -6, 40);
      g.closePath();
      remplir(g, c);
      g.restore();
    });
    ovale(g, 0, 26, 14, 22); remplir(g, c);
    rond(g, 0, 2, 11); remplir(g, c);
    poly(g, [[6, -2], [22, 3], [6, 8]]); g.fillStyle = c; g.fill();
    rond(g, 2, 0, 2.6); g.fillStyle = ENCRE; g.fill();
    for(let k = 0; k < 2; k++){
      g.beginPath();
      for(let i = 0; i <= 30; i++){ const t = i / 30; const x = -90 + t * 180, y = 82 + k * 20 + Math.sin(t * TAU * 1.5 + k) * 6; if(i) g.lineTo(x, y); else g.moveTo(x, y); }
      creux(g, 7, k ? c : '#ffffff');
    }
  },

  bouee(g, c){
    g.save();
    g.beginPath(); g.arc(0, 0, 90, 0, TAU); g.arc(0, 0, 42, 0, TAU, true); g.clip();
    g.fillStyle = '#ffffff'; g.fillRect(-100, -100, 200, 200);
    g.fillStyle = c;
    for(let k = 0; k < 4; k++){
      g.save(); g.rotate(k * Math.PI / 2 + 0.4);
      g.fillRect(-100, -19, 200, 38);   // bandes opposées deux à deux
      g.restore();
    }
    g.restore();
    g.beginPath(); g.arc(0, 0, 90, 0, TAU); creux(g, 4, VOILE);
    g.beginPath(); g.arc(0, 0, 42, 0, TAU); creux(g, 4, VOILE);
    g.beginPath(); g.arc(0, 0, 66, Math.PI * 1.05, Math.PI * 1.35); creux(g, 3, 'rgba(255,255,255,.7)');
  },

  saxo(g, c){
    g.beginPath();
    g.moveTo(-78, -84); g.quadraticCurveTo(-36, -102, -24, -64); g.lineTo(-24, 40);
    g.quadraticCurveTo(-24, 88, 26, 86); g.quadraticCurveTo(62, 84, 58, 34);
    creux(g, 24, '#ffffff');
    ovale(g, 62, 26, 24, 13, -0.55); remplir(g, c);
    ovale(g, 62, 24, 15, 7, -0.55); g.fillStyle = ENCRE; g.fill();
    [-44, -16, 12, 40].forEach((y, i) => { rond(g, -24, y, 7); g.fillStyle = i % 2 ? c : ENCRE; g.fill(); });
    trait(g, -96, -80, -66, -92); creux(g, 10, '#ffffff');
  },

  violon(g, c){
    ovale(g, 0, 40, 46, 38); remplir(g, c);
    ovale(g, 0, -4, 33, 29); remplir(g, c);
    rectArrondi(g, -6, -100, 12, 76, 3); remplir(g, c);
    rond(g, 0, -108, 10); remplir(g, c);
    [-1, 1].forEach(s => { g.beginPath(); g.moveTo(s * 14, 18); g.quadraticCurveTo(s * 20, 34, s * 13, 56); creux(g, 4.5, ENCRE); });
    trait(g, -16, 46, 16, 46); creux(g, 5, ENCRE);
    trait(g, -2, -88, -2, 70); creux(g, 1.4, VOILE);
    trait(g, 2, -88, 2, 70); creux(g, 1.4, VOILE);
    trait(g, -100, 84, 98, -24); creux(g, 7, '#ffffff');
    trait(g, -100, 84, -86, 79); creux(g, 10, c);
  },

  platines(g, c){
    rectArrondi(g, -104, -72, 208, 144, 14); remplir(g, c);
    rond(g, -16, 0, 56); g.fillStyle = ENCRE; g.fill();
    [46, 36, 26].forEach(r => { rond(g, -16, 0, r); creux(g, 2, 'rgba(255,255,255,.25)'); });
    rond(g, -16, 0, 17); g.fillStyle = c; g.fill();
    rond(g, -16, 0, 3.4); g.fillStyle = '#ffffff'; g.fill();
    rond(g, 74, -48, 10); g.fillStyle = ENCRE; g.fill();
    trait(g, 74, -48, 30, 16); creux(g, 7, ENCRE);
    rectArrondi(g, 20, 10, 18, 12, 3); g.fillStyle = c; g.fill();
    [[78, 26], [78, 44]].forEach(([x, y]) => { rond(g, x, y, 5); g.fillStyle = VOILE; g.fill(); });
  },

  synthe(g, c){
    rectArrondi(g, -106, -56, 212, 112, 10); remplir(g, c);
    rectArrondi(g, -96, -48, 192, 34, 5); g.fillStyle = 'rgba(10,22,48,.26)'; g.fill();
    [-70, -42, -14, 14, 42, 70].forEach((x, i) => { rond(g, x, -31, 8); g.fillStyle = i % 2 ? c : ENCRE; g.fill(); });
    for(let i = 0; i < 9; i++){ rectArrondi(g, -96 + i * 192 / 9, 0, 192 / 9 - 2, 48, 3); g.fillStyle = '#ffffff'; g.fill(); creux(g, 2, VOILE); }
    [0, 1, 3, 4, 5, 7].forEach(i => { rectArrondi(g, -96 + (i + 1) * 192 / 9 - 7, 0, 14, 28, 3); g.fillStyle = ENCRE; g.fill(); });
  },

  trompette(g, c){
    trait(g, -98, -8, 38, -8); creux(g, 14, '#ffffff');
    poly(g, [[40, -22], [106, -56], [106, 36], [40, 8]]); remplir(g, c);
    rectArrondi(g, -54, 0, 96, 54, 27); creux(g, 11, '#ffffff');
    [-30, -8, 14].forEach(x => { trait(g, x, -32, x, -8); creux(g, 10, '#ffffff'); rond(g, x, -38, 7); g.fillStyle = c; g.fill(); });
    rectArrondi(g, -106, -16, 14, 16, 4); remplir(g, c);
  },

  vinyle(g, c){
    rond(g, 0, 0, 94); g.fillStyle = '#0b1222'; g.fill(); creux(g, 6, '#ffffff');
    [78, 64, 50].forEach(r => { rond(g, 0, 0, r); creux(g, 2, 'rgba(255,255,255,.22)'); });
    g.beginPath(); g.arc(0, 0, 84, Math.PI * 1.08, Math.PI * 1.4); creux(g, 8, 'rgba(255,255,255,.45)');
    g.beginPath(); g.arc(0, 0, 84, Math.PI * 0.08, Math.PI * 0.4); creux(g, 8, 'rgba(255,255,255,.28)');
    rond(g, 0, 0, 34); g.fillStyle = c; g.fill();
    rond(g, 0, 0, 34); creux(g, 3, 'rgba(10,22,48,.35)');
    rond(g, 0, 0, 5); g.fillStyle = '#0b1222'; g.fill();
    trait(g, -18, -10, 18, -10); creux(g, 3, 'rgba(10,22,48,.45)');
    trait(g, -14, 12, 14, 12); creux(g, 3, 'rgba(10,22,48,.45)');
  },

  phare(g, c){
    poly(g, [[-16, -38], [-110, -62], [-110, -16]]); g.fillStyle = 'rgba(255,255,255,.22)'; g.fill();
    poly(g, [[16, -38], [110, -62], [110, -16]]); g.fillStyle = 'rgba(255,255,255,.22)'; g.fill();
    poly(g, [[-30, 88], [30, 88], [18, -32], [-18, -32]]); remplir(g, c);
    g.save();
    poly(g, [[-30, 88], [30, 88], [18, -32], [-18, -32]]); g.clip();
    g.fillStyle = c;
    g.fillRect(-40, 8, 80, 22); g.fillRect(-40, 52, 80, 22);
    g.restore();
    rectArrondi(g, -22, -58, 44, 26, 4); g.fillStyle = c; g.fill(); creux(g, 4, '#ffffff');
    rond(g, 0, -45, 7); g.fillStyle = '#ffffff'; g.fill();
    poly(g, [[-28, -58], [28, -58], [0, -88]]); remplir(g, c);
    rectArrondi(g, -44, 86, 88, 12, 4); remplir(g, c);
  },

  voilier(g, c){
    poly(g, [[-76, 50], [76, 50], [52, 82], [-52, 82]]); remplir(g, c);
    rectArrondi(g, -3, -96, 6, 146, 3); remplir(g, c);
    poly(g, [[9, -90], [9, 42], [76, 42]]); remplir(g, c);
    poly(g, [[-9, -70], [-9, 42], [-64, 42]]); g.fillStyle = 'rgba(255,255,255,.72)'; g.fill();
    for(let k = 0; k < 2; k++){
      g.beginPath();
      for(let i = 0; i <= 30; i++){ const t = i / 30; const x = -96 + t * 192, y = 96 + k * 16 + Math.sin(t * TAU * 1.5 + k) * 5; if(i) g.lineTo(x, y); else g.moveTo(x, y); }
      creux(g, 7, k ? c : '#ffffff');
    }
  },

  meduse(g, c){
    g.beginPath(); g.arc(0, -8, 66, Math.PI, TAU);
    g.quadraticCurveTo(44, 8, 22, 6); g.quadraticCurveTo(0, 14, -22, 6); g.quadraticCurveTo(-44, 8, -66, -8);
    g.closePath(); remplir(g, c);
    [[-26, -42, 7], [16, -50, 5], [34, -28, 6]].forEach(([x, y, r]) => { rond(g, x, y, r); g.fillStyle = 'rgba(10,22,48,.25)'; g.fill(); });
    [-44, -22, 0, 22, 44].forEach((x, i) => {
      g.beginPath();
      for(let j = 0; j <= 20; j++){ const t = j / 20; const xx = x + Math.sin(t * TAU * 1.4 + i) * 9, yy = 10 + t * 84; if(j) g.lineTo(xx, yy); else g.moveTo(xx, yy); }
      creux(g, 7, i % 2 ? c : '#ffffff');
    });
  },

  scene(g, c){
    poly(g, [[-100, 92], [100, 92], [80, 56], [-80, 56]]); remplir(g, c);
    [[-70, -8], [0, -10], [70, -8]].forEach(([x, dx]) => {
      poly(g, [[x - 8, -84], [x + 8, -84], [x * 0.35 + 34, 56], [x * 0.35 - 34, 56]]); g.fillStyle = 'rgba(255,255,255,.17)'; g.fill();
      rectArrondi(g, x - 14, -100, 28, 20, 5); remplir(g, c);
    });
    trait(g, 0, 56, 0, -14); creux(g, 6, '#ffffff');
    rectArrondi(g, -9, -42, 18, 30, 9); remplir(g, c);
    trait(g, -24, 92, -24, 100); creux(g, 3, VOILE);
  },

  eclair(g, c){
    poly(g, [[26, -104], [-50, 12], [-6, 12], [-28, 104], [54, -22], [8, -22]]); remplir(g, c);
    poly(g, [[26, -104], [-50, 12], [-6, 12], [-28, 104], [54, -22], [8, -22]]); creux(g, 3, VOILE);
  },

  perle(g, c){
    ovale(g, 0, 58, 98, 38); remplir(g, c);
    g.beginPath(); g.ellipse(0, 52, 92, 22, 0, Math.PI, TAU); creux(g, 4, VOILE);
    const rg = g.createRadialGradient(-18, -4, 4, 0, 10, 62);
    rg.addColorStop(0, '#ffffff'); rg.addColorStop(0.55, '#e8efff'); rg.addColorStop(1, melange('#ffffff', c, 0.75));
    rond(g, 0, 8, 58); g.fillStyle = rg; g.fill();
    rond(g, 0, 8, 58); creux(g, 3, 'rgba(10,22,48,.25)');
    ovale(g, -20, -16, 20, 11, -0.6); g.fillStyle = 'rgba(255,255,255,.9)'; g.fill();
  },

  hippocampe(g, c){
    // Un corps en courbe : une chaîne de disques, de plus en plus petits.
    const pts = [];
    for(let i = 0; i <= 46; i++){
      const t = i / 46;
      pts.push([ -8 + 26 * Math.sin(t * 3.3 - 0.4) * (1 - 0.4 * t) , -62 + t * 120, 25 - 17 * Math.pow(t, 0.8) ]);
    }
    // La queue s'enroule.
    for(let i = 1; i <= 16; i++){
      const t = i / 16;
      const a = Math.PI * 0.2 + t * Math.PI * 1.5;
      pts.push([ -24 + Math.cos(a) * 30 * (1 - 0.45 * t), 62 + Math.sin(a) * 30 * (1 - 0.45 * t), 8 - 5 * t ]);
    }
    pts.forEach(([x, y, r]) => { rond(g, x, y, r); remplir(g, c); });
    // La tête et le museau.
    rond(g, -10, -68, 25); remplir(g, c);
    ovale(g, -48, -62, 26, 8, 0.1); remplir(g, c);
    g.beginPath(); g.moveTo(24, -24); g.quadraticCurveTo(64, -18, 50, 26); g.quadraticCurveTo(38, 4, 26, 12); g.closePath(); remplir(g, c);
    [-40, -14, 12, 36].forEach((y, i) => { trait(g, -10 + 20 * Math.sin((y + 62) / 120 * 3.3 - 0.4), y, 18 + 20 * Math.sin((y + 62) / 120 * 3.3 - 0.4), y + 4); creux(g, 3, VOILE); });
    rond(g, -4, -74, 5); g.fillStyle = ENCRE; g.fill();
    // La couronne d'épines sur la tête.
    [[-16, -90], [-4, -95], [8, -91]].forEach(([x, y]) => { poly(g, [[x - 5, y + 6], [x, y - 7], [x + 5, y + 6]]); g.fillStyle = c; g.fill(); });
  },

  baleine(g, c){
    g.beginPath();
    g.moveTo(-104, 12);
    g.bezierCurveTo(-104, -40, -40, -52, 20, -30);
    g.bezierCurveTo(54, -18, 72, -26, 84, -58);
    g.bezierCurveTo(86, -72, 100, -76, 108, -68);
    g.bezierCurveTo(112, -44, 98, -16, 76, 6);
    g.bezierCurveTo(56, 26, 30, 50, -20, 54);
    g.bezierCurveTo(-74, 56, -104, 40, -104, 12);
    g.closePath(); remplir(g, c);
    g.beginPath(); g.moveTo(-96, 24); g.bezierCurveTo(-60, 40, -20, 42, 30, 30); creux(g, 4, VOILE);
    [-44, -28, -12, 4].forEach(x => { trait(g, x, 34, x + 4, 44); creux(g, 3, VOILE); });
    rond(g, -72, 2, 6); g.fillStyle = ENCRE; g.fill();
    [-1, 1].forEach(s => {
      g.beginPath(); g.moveTo(-36, -48); g.quadraticCurveTo(-36 + s * 18, -68, -36 + s * 34, -62); creux(g, 7, '#ffffff');
    });
    trait(g, -36, -48, -36, -84); creux(g, 7, '#ffffff');
  },

  lune(g, c){
    g.beginPath();
    g.arc(0, 0, 80, -1.37, 0.50, true);
    g.arc(30, -14, 66, 0.915, 4.49, false);
    g.closePath(); remplir(g, c);
    [[64, -58, 13], [84, 10, 8], [40, 66, 10]].forEach(([x, y, r]) => {
      poly(g, [[x, y - r], [x + r * 0.26, y - r * 0.26], [x + r, y], [x + r * 0.26, y + r * 0.26], [x, y + r], [x - r * 0.26, y + r * 0.26], [x - r, y], [x - r * 0.26, y - r * 0.26]]);
      g.fillStyle = '#ffffff'; g.fill();
    });
    g.beginPath();
    for(let i = 0; i <= 30; i++){ const t = i / 30; const x = -96 + t * 192, y = 98 + Math.sin(t * TAU * 1.5) * 5; if(i) g.lineTo(x, y); else g.moveTo(x, y); }
    creux(g, 6, c);
  },

  flamme(g, c){
    g.beginPath();
    g.moveTo(0, -106);
    g.bezierCurveTo(32, -64, 74, -34, 66, 20);
    g.bezierCurveTo(62, 62, 32, 96, 0, 98);
    g.bezierCurveTo(-32, 96, -64, 64, -62, 26);
    g.bezierCurveTo(-60, -4, -34, -18, -28, -52);
    g.bezierCurveTo(-14, -38, -4, -62, 0, -106);
    g.closePath(); remplir(g, c);
    g.beginPath();
    g.moveTo(2, -36); g.bezierCurveTo(22, -8, 44, 10, 38, 44); g.bezierCurveTo(34, 70, 14, 80, 0, 80);
    g.bezierCurveTo(-18, 80, -36, 62, -34, 40); g.bezierCurveTo(-32, 20, -14, 12, -8, -8);
    g.bezierCurveTo(-2, 4, 2, -16, 2, -36); g.closePath();
    g.fillStyle = c; g.fill();
    g.beginPath();
    g.moveTo(0, 18); g.bezierCurveTo(14, 36, 20, 48, 14, 62); g.bezierCurveTo(10, 72, -10, 72, -14, 62);
    g.bezierCurveTo(-18, 48, -8, 36, 0, 18); g.closePath();
    g.fillStyle = '#ffffff'; g.fill();
  },

  soleil(g, c){
    g.save();
    g.beginPath(); g.rect(-130, -110, 260, 140); g.clip();
    g.beginPath(); g.arc(0, 30, 54, Math.PI, TAU); remplir(g, c);
    for(let i = 0; i < 9; i++){
      const a = Math.PI * (1.08 + 0.84 * i / 8);
      trait(g, Math.cos(a) * 70, 30 + Math.sin(a) * 70, Math.cos(a) * 100, 30 + Math.sin(a) * 100); creux(g, 9, i % 2 ? '#ffffff' : c);
    }
    g.restore();
    trait(g, -110, 30, 110, 30); creux(g, 5, '#ffffff');
    for(let k = 0; k < 3; k++){
      g.beginPath();
      for(let i = 0; i <= 30; i++){ const t = i / 30; const x = -90 + t * 180 + k * 10, y = 52 + k * 20 + Math.sin(t * TAU * 1.5 + k) * 5; if(i) g.lineTo(x, y); else g.moveTo(x, y); }
      creux(g, 7, k === 1 ? c : '#ffffff');
    }
  },

  couronne(g, c){
    poly(g, [[-92, 62], [-92, -34], [-48, 10], [0, -66], [48, 10], [92, -34], [92, 62]]); remplir(g, c);
    trait(g, -92, 36, 92, 36); creux(g, 5, VOILE);
    [[-92, -46, 11], [0, -78, 13], [92, -46, 11]].forEach(([x, y, r]) => { rond(g, x, y, r); remplir(g, c); });
    [-52, 0, 52].forEach((x, i) => { rond(g, x, 50, i === 1 ? 10 : 7); g.fillStyle = i === 1 ? c : ENCRE; g.fill(); });
    poly(g, [[-20, 16], [0, -8], [20, 16], [0, 28]]); g.fillStyle = c; g.fill();
  },

  etoile(g, c){
    const pts = [];
    for(let i = 0; i < 10; i++){
      const a = -Math.PI / 2 + i * Math.PI / 5;
      const r = i % 2 ? 44 : 100;
      pts.push([Math.cos(a) * r, Math.sin(a) * r + 4]);
    }
    poly(g, pts); remplir(g, c);
  },

  logo(g, c, logo){
    if(!logo){ MOTIFS.etoile(g, c); return; }
    const blanc = logoTeinte(logo, '#ffffff');
    g.shadowColor = c;
    g.shadowBlur = 24;
    ajuster(g, blanc, 0, 0, 230, 130);
    g.shadowBlur = 0;
    ajuster(g, blanc, 0, 0, 230, 130);
  }
};

// Le fond de l'illustration : quelques ondes qui partent du centre, comme sur
// l'estrade de la machine, à peine visibles.
function ondesDeFond(g, cx, cy, c, n){
  g.save();
  for(let i = 1; i <= n; i++){
    g.beginPath();
    g.arc(cx, cy, 34 + i * 34, 0, TAU);
    g.lineWidth = 2;
    g.strokeStyle = 'rgba(' + hexVersRgb(c).join(',') + ',' + (0.17 - i * 0.022) + ')';
    g.stroke();
  }
  g.restore();
}

// Le texte sur plusieurs lignes, centré.
function paragrapheCentre(g, texte, cx, y, largeur, interligne, maxLignes){

  const mots = String(texte || '').split(/\s+/).filter(Boolean);
  const lignes = [];
  let cur = '';

  mots.forEach(m => {
    const essai = cur ? cur + ' ' + m : m;
    if(g.measureText(essai).width > largeur && cur){
      lignes.push(cur);
      cur = m;
    } else {
      cur = essai;
    }
  });
  if(cur) lignes.push(cur);

  lignes.slice(0, maxLignes || 3).forEach((l, i) => g.fillText(l, cx, y + i * interligne));

  return Math.min(lignes.length, maxLignes || 3);
}

// Le recto d'une carte. `echelle` réduit le dessin (l'album, en petit).
function creerFaceCarte(carte, logo, echelle){

  const k = echelle || 1;
  const L = Math.round(CARTE_L * k), H = Math.round(CARTE_H * k);
  const { c, x: g } = creerCanvas(L, H);

  g.scale(k, k);

  const R0 = rarete(carte.rarete);
  const col = R0.couleur;

  // Le fond : un dégradé nuit, teinté par la rareté au centre.
  rectArrondi(g, 0, 0, CARTE_L, CARTE_H, 34);
  g.save();
  g.clip();

  const fond = g.createLinearGradient(0, 0, 0, CARTE_H);
  fond.addColorStop(0, '#0b1830');
  fond.addColorStop(0.5, '#07111f');
  fond.addColorStop(1, '#040a14');
  g.fillStyle = fond;
  g.fillRect(0, 0, CARTE_L, CARTE_H);

  const lueur = g.createRadialGradient(256, 300, 10, 256, 300, 340);
  lueur.addColorStop(0, 'rgba(' + hexVersRgb(col).join(',') + ',.30)');
  lueur.addColorStop(1, 'rgba(' + hexVersRgb(col).join(',') + ',0)');
  g.fillStyle = lueur;
  g.fillRect(0, 0, CARTE_L, CARTE_H);

  g.restore();

  // Le cadre : un liseré de la couleur de la rareté, puis un filet.
  rectArrondi(g, 7, 7, CARTE_L - 14, CARTE_H - 14, 28);
  g.lineWidth = 4;
  g.strokeStyle = col;
  g.globalAlpha = 0.95;
  g.stroke();
  g.globalAlpha = 1;

  rectArrondi(g, 18, 18, CARTE_L - 36, CARTE_H - 36, 20);
  g.lineWidth = 1.5;
  g.strokeStyle = 'rgba(255,255,255,.16)';
  g.stroke();

  // Le nom, réduit s'il est trop long.
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#ffffff';

  let taille = 37;
  g.font = '700 ' + taille + 'px ' + POLICE;
  while(g.measureText(carte.nom).width > CARTE_L - 96 && taille > 22){
    taille -= 1;
    g.font = '700 ' + taille + 'px ' + POLICE;
  }
  g.fillText(carte.nom, 256, 62);

  g.font = '600 17px ' + POLICE;
  g.fillStyle = col;
  texteEspace(g, String(carte.categorie || '').toUpperCase(), 256, 100, 5);

  // La fenêtre de l'illustration.
  const fx = 56, fy = 128, fl = 400, fh = 340;
  rectArrondi(g, fx, fy, fl, fh, 22);
  const fen = g.createLinearGradient(0, fy, 0, fy + fh);
  fen.addColorStop(0, R0.sombre);
  fen.addColorStop(1, '#050b16');
  g.fillStyle = fen;
  g.fill();

  g.save();
  rectArrondi(g, fx, fy, fl, fh, 22);
  g.clip();
  ondesDeFond(g, 256, 298, col, 6);

  // Le dessin.
  g.translate(256, 298);
  g.scale(1.38, 1.38);
  g.shadowColor = col;
  g.shadowBlur = 20;
  (MOTIFS[carte.motif] || MOTIFS.etoile)(g, col, logo);
  g.restore();

  rectArrondi(g, fx, fy, fl, fh, 22);
  g.lineWidth = 2;
  g.strokeStyle = 'rgba(' + hexVersRgb(col).join(',') + ',.6)';
  g.stroke();

  // La rareté : son nom, et autant de losanges que de crans.
  g.textBaseline = 'middle';
  g.font = '700 19px ' + POLICE;
  g.fillStyle = col;
  texteEspace(g, R0.nom.toUpperCase(), 256, 504, 6);

  for(let i = 0; i < 4; i++){
    const x = 256 + (i - 1.5) * 26, y = 536;
    g.beginPath();
    g.moveTo(x, y - 7); g.lineTo(x + 7, y); g.lineTo(x, y + 7); g.lineTo(x - 7, y);
    g.closePath();
    if(i < R0.pastilles){ g.fillStyle = col; g.fill(); }
    else { g.lineWidth = 1.5; g.strokeStyle = 'rgba(255,255,255,.25)'; g.stroke(); }
  }

  // La phrase.
  g.font = 'italic 500 23px ' + POLICE;
  g.fillStyle = '#b4c6da';
  g.textBaseline = 'alphabetic';
  g.textAlign = 'center';
  paragrapheCentre(g, '« ' + (carte.legende || '') + ' »', 256, 588, 388, 30, 3);

  // Le pied : la série à gauche, le numéro à droite, un filet.
  g.strokeStyle = 'rgba(255,255,255,.14)';
  g.lineWidth = 1.5;
  trait(g, 44, 664, CARTE_L - 44, 664);
  g.stroke();

  g.textBaseline = 'middle';
  g.textAlign = 'left';
  g.font = '700 14px ' + POLICE;
  g.fillStyle = '#7fa3c4';
  g.save();
  g.translate(46, 686);
  texteEspace(g, 'LA WAVE TCG', 50, 0, 4);
  g.restore();

  g.textAlign = 'right';
  g.font = '700 15px ' + POLICE;
  g.fillStyle = '#9fb8d0';
  g.fillText(String(carte.id).padStart(2, '0') + ' / ' + (carte.total || 36), CARTE_L - 46, 686);

  return c;
}

// Le masque du foil : là où le reflet arc-en-ciel a le droit de passer (le
// dessin et le cadre, pas le texte).
function creerMasqueCarte(carte){

  const { c, x: g } = creerCanvas(CARTE_L, CARTE_H);

  g.fillStyle = '#000000';
  g.fillRect(0, 0, CARTE_L, CARTE_H);

  g.fillStyle = '#ffffff';
  rectArrondi(g, 56, 128, 400, 340, 22);
  g.fill();

  rectArrondi(g, 7, 7, CARTE_L - 14, CARTE_H - 14, 28);
  g.lineWidth = 16;
  g.strokeStyle = '#ffffff';
  g.stroke();

  // Les cartes épiques et légendaires brillent aussi sur leur titre.
  if(rarete(carte.rarete).rang >= 2){
    g.fillStyle = 'rgba(255,255,255,.55)';
    g.fillRect(30, 36, CARTE_L - 60, 84);
  }

  return c;
}

// Le dos d'une carte : le même fond que le booster, le logo au milieu.
function creerDosCarte(logo){

  const { c, x: g } = creerCanvas(CARTE_L, CARTE_H);

  rectArrondi(g, 0, 0, CARTE_L, CARTE_H, 34);
  g.save();
  g.clip();

  const fond = g.createLinearGradient(0, 0, CARTE_L, CARTE_H);
  fond.addColorStop(0, '#040a1a');
  fond.addColorStop(0.5, '#0b2645');
  fond.addColorStop(1, '#050c1d');
  g.fillStyle = fond;
  g.fillRect(0, 0, CARTE_L, CARTE_H);

  for(let x = 0; x < CARTE_L; x += 32){
    g.fillStyle = 'rgba(255,255,255,' + (0.016 + 0.018 * Math.sin(x * 0.11)) + ')';
    g.fillRect(x, 0, 16, CARTE_H);
  }

  g.restore();

  rectArrondi(g, 7, 7, CARTE_L - 14, CARTE_H - 14, 28);
  g.lineWidth = 3;
  g.strokeStyle = 'rgba(79,180,255,.75)';
  g.stroke();

  rectArrondi(g, 24, 24, CARTE_L - 48, CARTE_H - 48, 18);
  g.lineWidth = 1.5;
  g.strokeStyle = 'rgba(255,255,255,.16)';
  g.stroke();

  if(logo){
    const blanc = logoTeinte(logo, '#ffffff');
    g.shadowColor = '#4FB4FF';
    g.shadowBlur = 18;
    ajuster(g, blanc, CARTE_L / 2, 330, 300, 170);
    g.shadowBlur = 0;
    ajuster(g, blanc, CARTE_L / 2, 330, 300, 170);
  }

  g.textBaseline = 'middle';
  g.fillStyle = '#ffffff';
  g.font = '700 54px ' + POLICE;
  g.shadowColor = 'rgba(79,180,255,.5)';
  g.shadowBlur = 14;
  texteEspace(g, 'TCG', CARTE_L / 2, 500, 16);
  g.shadowBlur = 0;

  g.strokeStyle = 'rgba(79,180,255,.35)';
  g.lineWidth = 2;
  g.beginPath();
  for(let x = 90; x <= CARTE_L - 90; x += 4){
    const y = 590 + Math.sin((x - 90) / (CARTE_L - 180) * TAU * 2) * 8;
    if(x === 90) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.stroke();

  return c;
}



/* ----------------------------------------------------------------------
   L'ouverture d'un booster
   ----------------------------------------------------------------------
   Une seconde scène, vide et sombre, où le booster flotte au centre. On le
   déchire d'un geste, les cinq cartes en sortent en pile, face cachée ; on
   les retourne une à une, la dernière étant toujours une rare ou mieux. Les
   cartes sont déjà tirées et enregistrées par la base quand l'animation
   commence : ce qu'on voit est ce qu'on possède.
   ---------------------------------------------------------------------- */

const VS_CARTE = `
varying vec2 vUv;
void main(){
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

// Le devant d'une carte : la texture, et par-dessus un reflet arc-en-ciel qui
// glisse quand la carte s'incline, limité par un masque au dessin et au cadre.
// Les épiques et les légendaires ont en plus des éclats, et les légendaires
// tirent vers l'or.
const FS_CARTE = `
uniform sampler2D uFace;
uniform sampler2D uMasque;
uniform float uT;
uniform float uFoil;
uniform float uRang;
uniform float uLueur;
uniform vec2 uTilt;
varying vec2 vUv;

vec3 spectre(float x){
  return 0.5 + 0.5 * cos(6.28318 * (x + vec3(0.0, 0.33, 0.67)));
}

float hasard(vec2 p){
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main(){
  vec4 c = texture2D(uFace, vUv);
  if(c.a < 0.5) discard;

  float m = texture2D(uMasque, vUv).r;

  float ang = vUv.x * 1.4 + vUv.y * 1.0 + uTilt.x * 1.6 - uTilt.y * 1.2 + uT * 0.05;
  vec3 h = spectre(ang);
  float bande = smoothstep(0.0, 0.2, 0.2 - abs(fract(ang * 0.75) - 0.5));

  float etin = 0.0;
  if(uRang > 1.5){
    vec2 cell = floor(vUv * vec2(64.0, 90.0));
    float r = hasard(cell + floor(uT * 5.0));
    etin = step(0.988, r) * (0.55 + 0.45 * sin(uT * 10.0 + r * 40.0));
  }

  vec3 col = c.rgb;
  col += m * uFoil * (h * 0.50 + bande * 0.30 + etin);
  if(uRang > 2.5) col = mix(col, col * vec3(1.15, 1.04, 0.78), m * 0.45);
  col *= 1.0 + uLueur * 0.3;

  gl_FragColor = vec4(col, 1.0);
}`;

const CAM_OUV = { fov: 36, distance: 3.4 };
const ECHELLE_PILE = 1.22, ECHELLE_GRANDE = 1.36;

let ouv = null;           // l'ouverture en cours

// Le fond : un halo bleu nuit, plus clair au centre.
function creerFondOuverture(){
  const { c, x: g } = creerCanvas(512, 512);
  const rg = g.createRadialGradient(256, 256, 10, 256, 256, 380);
  rg.addColorStop(0, '#10305a');
  rg.addColorStop(0.45, '#071428');
  rg.addColorStop(1, '#02050b');
  g.fillStyle = rg;
  g.fillRect(0, 0, 512, 512);
  return c;
}

// Des rayons qui partent du centre, pour le moment où la carte apparaît.
function creerRayons(){
  const { c, x: g } = creerCanvas(512, 512);
  g.translate(256, 256);
  const n = 22;
  for(let i = 0; i < n; i++){
    g.save();
    g.rotate(i / n * TAU + (i % 2) * 0.05);
    const lg = g.createLinearGradient(0, 0, 250, 0);
    lg.addColorStop(0, 'rgba(255,255,255,.9)');
    lg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = lg;
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(250, -6 - (i % 3) * 5);
    g.lineTo(250, 6 + (i % 3) * 5);
    g.closePath();
    g.fill();
    g.restore();
  }
  const halo = g.createRadialGradient(0, 0, 0, 0, 0, 120);
  halo.addColorStop(0, 'rgba(255,255,255,.8)');
  halo.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = halo;
  g.fillRect(-256, -256, 512, 512);
  return c;
}

// La scène d'ouverture, construite au premier booster.
function construireScenePaquet(){

  if(R.paq) return R.paq;

  const sc = new THREE.Scene();
  sc.background = new THREE.Color(0x02050b);

  const cam = new THREE.PerspectiveCamera(CAM_OUV.fov, 1, 0.1, 30);
  cam.position.set(0, 0, CAM_OUV.distance);

  const fond = new THREE.Mesh(
    new THREE.PlaneGeometry(16, 10),
    new THREE.MeshBasicMaterial({ map: R.texture(creerFondOuverture()), depthWrite: false })
  );
  fond.position.z = -2.4;
  sc.add(fond);

  const rayons = new THREE.Mesh(
    new THREE.PlaneGeometry(8, 8),
    new THREE.MeshBasicMaterial({
      map: R.texture(creerRayons()), transparent: true, opacity: 0, depthWrite: false,
      blending: THREE.AdditiveBlending, color: 0x6fb8ff
    })
  );
  rayons.position.z = -1.1;
  sc.add(rayons);

  // De quoi éclairer le booster (les cartes, elles, se passent de lumière).
  sc.add(new THREE.AmbientLight(0xffffff, 0.62));
  const clef = new THREE.DirectionalLight(0xffffff, 0.55);
  clef.position.set(1.5, 2, 3);
  sc.add(clef);
  const lueur = new THREE.PointLight(0x6fb8ff, 0.7, 9);
  lueur.position.set(-1.6, 1.0, 2.2);
  sc.add(lueur);

  // Les étincelles.
  const N = 260;
  const pos = new Float32Array(N * 3).fill(-50);
  const col = new Float32Array(N * 3);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));

  const points = new THREE.Points(g, new THREE.PointsMaterial({
    size: 0.09, map: R.halo, vertexColors: true, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, sizeAttenuation: true
  }));
  points.frustumCulled = false;
  points.renderOrder = 10;
  sc.add(points);

  R.paq = {
    scene: sc, cam, fond, rayons, lueur,
    etincelles: { n: N, pos, col, vel: new Float32Array(N * 3), vie: new Float32Array(N), points, suite: 0 },
    dos: R.texture(creerDosCarte(R.logo))
  };

  // Le dos de carte n'a pas besoin de mipmaps : il est grand et frontal.
  R.paq.dos.minFilter = THREE.LinearFilter;
  R.paq.dos.generateMipmaps = false;

  return R.paq;
}

// Une gerbe d'étincelles de la couleur de la rareté.
function etincelles(x, y, z, couleur, n, vitesse){

  const E = R.paq.etincelles;
  const c = new THREE.Color(couleur);

  for(let k = 0; k < n; k++){
    const i = E.suite;
    E.suite = (E.suite + 1) % E.n;

    const a = Math.random() * TAU;
    const b = (Math.random() - 0.3) * Math.PI;
    const v = (0.3 + Math.random() * 0.9) * vitesse;

    E.pos[i * 3] = x; E.pos[i * 3 + 1] = y; E.pos[i * 3 + 2] = z;
    E.vel[i * 3] = Math.cos(a) * Math.cos(b) * v;
    E.vel[i * 3 + 1] = Math.sin(b) * v + 0.4;
    E.vel[i * 3 + 2] = Math.sin(a) * Math.cos(b) * v * 0.5 + 0.3;
    E.vie[i] = 0.7 + Math.random() * 0.9;

    const t = Math.random();
    E.col[i * 3] = lerp(c.r, 1, t * 0.5);
    E.col[i * 3 + 1] = lerp(c.g, 1, t * 0.5);
    E.col[i * 3 + 2] = lerp(c.b, 1, t * 0.5);
  }
}

// Le booster en deux parties : le corps, et la bande du haut, qu'on arrache.
// La déchirure est irrégulière.
function geoBoosterDeux(l, h, e){

  const g = geoBooster(l, h, e);
  const pos = g.attributes.position;

  const gx = 8, rangs = 4;

  for(let ix = 0; ix <= gx; ix++){
    const i = rangs * (gx + 1) + ix;
    pos.setY(i, pos.getY(i) + (ix % 2 ? 0.012 : -0.010) * h / 0.72);
  }

  g.computeVertexNormals();

  const idx = g.index.array;
  const haut = [], bas = [];

  for(let t = 0; t < idx.length / 3; t++){
    const rang = Math.floor(Math.floor(t / 2) / gx);
    (rang < rangs ? haut : bas).push(idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]);
  }

  const mk = liste => { const c = g.clone(); c.setIndex(liste); return c; };

  return { haut: mk(haut), bas: mk(bas) };
}

// Le booster de l'ouverture : quatre formes (devant et dos, haut et bas),
// dont les matériaux peuvent s'effacer.
function creerPaquetOuverture(){

  const L = 0.50, H = 0.75;
  const { haut, bas } = geoBoosterDeux(L, H, 0.05);

  const groupe = new THREE.Group();

  const faceMat = () => new THREE.MeshPhongMaterial({
    map: R.matBoosterFace.map, specular: 0x4a6a8a, shininess: 70, transparent: true
  });
  const dosMat = () => new THREE.MeshPhongMaterial({
    map: R.matBoosterDos.map, specular: 0x4a6a8a, shininess: 70, transparent: true
  });

  const partie = (geo) => {
    const g = new THREE.Group();
    const mF = faceMat(), mD = dosMat();
    const dos = geo.clone();
    dos.rotateY(Math.PI);
    const f = new THREE.Mesh(geo, mF), d = new THREE.Mesh(dos, mD);
    const mR = new THREE.MeshBasicMaterial({
      map: R.reflet, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending
    });
    const r = new THREE.Mesh(geo, mR);
    r.position.z = 0.0008;
    g.add(f, d, r);
    return { groupe: g, mats: [mF, mD, mR], base: [1, 1, 0.22] };
  };

  const corps = partie(bas), bande = partie(haut);
  groupe.add(corps.groupe, bande.groupe);

  return { groupe, corps, bande, hauteur: H };
}

// Les règles d'une rareté dans l'ouverture : quelle gerbe, quelle secousse.
function effetRarete(r){
  return [
    { etin: 0, vit: 0, flash: 0, secousse: 0 },
    { etin: 26, vit: 1.4, flash: 0.25, secousse: 0 },
    { etin: 70, vit: 2.0, flash: 0.5, secousse: 0.008 },
    { etin: 150, vit: 2.8, flash: 0.9, secousse: 0.018 }
  ][r];
}

// Une carte : son devant (shader holographique) et son dos.
function creerCarte3D(carte){

  const L = 0.63, H = 0.88;

  const face = R.texture(creerFaceCarte(carte, R.logo, 1));
  const masque = R.texture(creerMasqueCarte(carte));

  [face, masque].forEach(t => { t.minFilter = THREE.LinearFilter; t.generateMipmaps = false; });

  const cfg = rarete(carte.rarete);

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uFace: { value: face }, uMasque: { value: masque }, uT: { value: 0 },
      uFoil: { value: cfg.foil }, uRang: { value: cfg.rang }, uLueur: { value: 0 },
      uTilt: { value: new THREE.Vector2() }
    },
    vertexShader: VS_CARTE,
    fragmentShader: FS_CARTE
  });

  const matDos = new THREE.MeshBasicMaterial({ map: R.paq.dos, alphaTest: 0.5 });

  const groupe = new THREE.Group();

  const devant = new THREE.Mesh(new THREE.PlaneGeometry(L, H), mat);
  devant.position.z = 0.002;

  const dos = new THREE.Mesh(new THREE.PlaneGeometry(L, H), matDos);
  dos.rotation.y = Math.PI;
  dos.position.z = -0.002;

  groupe.add(devant, dos);

  return {
    carte, groupe, mat, matDos, textures: [face, masque],
    etat: { x: 0, y: -0.25, z: -0.06, s: 0.9, rx: 0, ry: Math.PI, rz: 0 },
    tw: null, revelee: false, phase: hasard(0, TAU), etiq: null, jalons: null, flotte: 0
  };
}

function libererCarte3D(c){
  c.groupe.traverse(o => { if(o.geometry) o.geometry.dispose(); });
  c.textures.forEach(t => t.dispose());
  c.mat.dispose();
  c.matDos.dispose();
  if(c.etiq) c.etiq.remove();
}

// Un mouvement de la carte vers un état, avec retard et, si on veut, une
// élévation en cours de route.
function deplacerCarte(c, vers, duree, delai, arc, fin){
  c.tw = {
    de: Object.assign({}, c.etat), vers: Object.assign({}, c.etat, vers),
    t: -(delai || 0), duree, arc: arc || 0, fin: fin || null
  };
  c.jalons = null;
}

// La largeur et la hauteur que voit la caméra, à la profondeur des cartes.
function champOuverture(){
  const hv = 2 * (R.paq.distance || CAM_OUV.distance) * Math.tan(CAM_OUV.fov * Math.PI / 360);
  return { h: hv, l: hv * R.paq.cam.aspect };
}

// La place dont disposent les cartes à l'écran : ce qui reste quand on ôte, en
// pixels, le haut de l'écran (le titre, les boutons de la salle) et le bas (la
// phrase, les boutons de l'ouverture). Rend la hauteur du centre de cette
// zone, dans les unités de la scène, et la plus grande échelle de carte qui y
// tient.
function zoneCartes(haut, bas){

  const { h } = champOuverture();
  const hPx = Math.max(240, overlay.clientHeight);
  const libre = Math.max(80, hPx - haut - bas);

  return {
    y: h * (bas - haut) / (2 * hPx),
    hauteur: h * libre / hPx,
    l: champOuverture().l
  };
}

// La carte qu'on retourne, ou la pile : grandes, dans la zone libre.
function cadreCarte(){

  const z = zoneCartes(54, 138);

  return {
    y: z.y,
    grand: Math.min(ECHELLE_GRANDE, z.hauteur / 0.88, z.l * 0.86 / 0.63),
    pile: Math.min(ECHELLE_PILE, z.hauteur / 0.88 * 0.93, z.l * 0.8 / 0.63)
  };
}

// Les places des cartes au bilan : une rangée sur un écran large, deux
// rangées sur un écran en hauteur.
function placesBilan(n){

  const { l, h } = champOuverture();
  const z = zoneCartes(132, 118);

  const colonnes = l / h > 1.45 ? n : Math.ceil(n / 2);
  const rangees = Math.ceil(n / colonnes);

  // Entre deux rangées, de la place pour l'étiquette (« nouvelle », « déjà ×2 »).
  const interligne = rangees > 1 ? 1.34 : 1.06;

  const s = Math.min((l * 0.94 / colonnes) / 0.63 / 1.06, (z.hauteur / rangees) / 0.88 / interligne, 1.05);

  const places = [];

  for(let i = 0; i < n; i++){
    const r = Math.floor(i / colonnes);
    const dansRangee = Math.min(colonnes, n - r * colonnes);
    const k = i - r * colonnes;
    places.push({
      x: (k - (dansRangee - 1) / 2) * 0.63 * s * 1.06,
      y: ((rangees - 1) / 2 - r) * 0.88 * s * interligne + z.y,
      s
    });
  }

  return places;
}

// Les cartes déjà vues se rangent en attendant les autres : en colonne, sur le
// côté gauche d'un écran large ; en rangée, en haut d'un écran en hauteur.
function placeRangee(k, n){

  const { l, h } = champOuverture();

  if(l / h > 1.3){
    const s = 0.34;
    const pas = 0.88 * s * 1.12;
    return { x: -l * 0.41, y: ((n - 1) / 2 - k) * pas, s };
  }

  const pas = Math.min(l * 0.19, 0.3);
  const s = pas * 0.9 / 0.63;
  return { x: (k - (n - 1) / 2) * pas, y: h * 0.355, s };
}

function placePile(j){

  const c = cadreCarte();

  return {
    x: j * 0.012, y: c.y - j * 0.006, z: -j * 0.014, s: c.pile,
    rx: 0, ry: Math.PI, rz: (j % 2 ? 1 : -1) * 0.018 * Math.min(j, 3)
  };
}

function redimensionnerOuverture(){
  if(!R.paq) return;

  const l = overlay.clientWidth, h = overlay.clientHeight;
  if(!l || !h) return;

  const cam = R.paq.cam;
  cam.aspect = l / h;

  // Sur un écran en hauteur, on recule pour garder la carte entière et la
  // largeur utile.
  const hv = 2 * CAM_OUV.distance * Math.tan(CAM_OUV.fov * Math.PI / 360);
  const minL = 1.25;
  const d = cam.aspect < minL / hv ? minL / cam.aspect / (2 * Math.tan(CAM_OUV.fov * Math.PI / 360)) : CAM_OUV.distance;

  cam.position.z = d;
  R.paq.distance = d;
  cam.updateProjectionMatrix();
}

// Le texte et les boutons de l'ouverture.
function majInterfaceOuverture(){

  if(!ouv || !H.ouv) return;

  const n = ouv.cartes.length;
  let indice = '', action = '', passer = false;

  if(ouv.phase === 'attente'){
    indice = etat.tactile ? 'Touche le booster pour l’ouvrir.' : 'Clique ou appuie sur Entrée pour ouvrir.';
    action = 'Ouvrir le booster';
  } else if(ouv.phase === 'pile'){
    indice = 'Carte ' + (ouv.i + 1) + ' sur ' + n;
    action = 'Retourner la carte';
    passer = true;
  } else if(ouv.phase === 'carte'){
    // La carte dit tout : sa rareté, et l'étiquette « nouvelle » ou « déjà ×2 ».
    action = ouv.i + 1 < n ? 'Carte suivante' : 'Voir le tirage';
    passer = ouv.i + 1 < n;
  }

  H.ouvIndice.textContent = indice;
  H.ouvAction.textContent = action;
  H.ouvAction.hidden = !action;
  H.ouvAction.disabled = ouv.phase === 'dechire' || ouv.phase === 'retourne';
  H.ouvPasser.hidden = !passer;
  H.ouvBilan.hidden = ouv.phase !== 'bilan';
  H.ouvIndice.hidden = !indice;

  if(ouv.phase === 'bilan'){
    const nouvelles = ouv.cartes.filter(c => c.carte.nouvelle).length;
    H.ouvTitre.textContent = 'Ton tirage';
    H.ouvResume.textContent = nouvelles
      ? nouvelles + ' nouvelle' + (nouvelles > 1 ? 's' : '') + ' · ' + (n - nouvelles) + ' déjà possédée' + (n - nouvelles > 1 ? 's' : '')
      : 'Que des cartes déjà possédées : la prochaine sera la bonne.';
    const restants = etat.bourse ? etat.bourse.boosters : 0;
    H.ouvAutre.hidden = restants < 1;
    H.ouvAutre.textContent = 'Ouvrir un autre booster (' + restants + ')';
    H.ouvResume.hidden = false;
  } else {
    H.ouvTitre.textContent = '';
    H.ouvResume.hidden = true;
  }

  // L'action principale porte le focus : Entrée ou Espace la déclenchent.
  if(!H.ouvAction.hidden && !H.ouvAction.disabled && document.activeElement !== H.ouvAction){
    H.ouvAction.focus({ preventScroll: true });
  }
}

function flasher(couleur, force){
  if(!H.ouvFlash) return;
  H.ouvFlash.style.background = couleur;
  H.ouvFlash.style.setProperty('--wv-force', String(force));
  H.ouvFlash.classList.remove('on');
  void H.ouvFlash.offsetWidth;
  H.ouvFlash.classList.add('on');
}

// L'étiquette d'une carte (« nouvelle », « ×2 »), collée à la carte.
function poserEtiquette(c){

  if(c.etiq) return;

  const q = Number(c.carte.quantite) || 1;
  const el = document.createElement('span');
  el.className = 'wv-ouv-etiq ' + (c.carte.nouvelle ? 'nouvelle' : 'doublon');
  el.textContent = c.carte.nouvelle ? 'Nouvelle' : 'Déjà ×' + q;
  H.ouvEtiq.appendChild(el);
  c.etiq = el;
}

function placerEtiquettes(){

  if(!ouv) return;

  const cam = R.paq.cam;
  const l = overlay.clientWidth, h = overlay.clientHeight;

  ouv.cartes.forEach(c => {
    if(!c.etiq) return;
    const visible = c.revelee && c.etat.s > 0.45;
    c.etiq.style.display = visible ? '' : 'none';
    if(!visible) return;

    const v = new THREE.Vector3(c.groupe.position.x, c.groupe.position.y - 0.44 * c.etat.s - 0.03, c.groupe.position.z + 0.02);
    v.project(cam);
    c.etiq.style.left = ((v.x + 1) / 2 * l) + 'px';
    c.etiq.style.top = ((1 - v.y) / 2 * h) + 'px';
  });
}

// On entre dans l'ouverture.
function lancerOuverture(res){

  // Une ouverture déjà en cours (deux réponses qui se croisent) est d'abord
  // rangée.
  if(ouv) fermerOuverture(false);

  let P = null, paquet = null;
  const cartes3D = [];

  try{

    P = construireScenePaquet();

    const donnees = res.cartes.map(c => Object.assign({}, c, { total: res.cartes_total }));
    const meilleur = donnees.reduce((m, c) => Math.max(m, rarete(c.rarete).rang), 0);

    paquet = creerPaquetOuverture();
    paquet.groupe.position.set(0, 0, 0);
    paquet.groupe.scale.setScalar(1.55);
    P.scene.add(paquet.groupe);

    donnees.forEach(c => {
      const c3 = creerCarte3D(c);
      c3.groupe.visible = false;
      P.scene.add(c3.groupe);
      cartes3D.push(c3);
    });

    ouv = {
      phase: 'attente', t: 0, i: 0, data: donnees, meilleur, res,
      paquet, cartes: cartes3D, vite: false,
      pointeur: { x: 0, y: 0 }, secousse: 0, peutSuivre: false, flags: {},
      bande: { x: 0, y: 0, z: 0, rz: 0, vx: 0, vy: 0, vrz: 0 }
    };

    P.rayons.material.opacity = 0;
    P.rayons.material.color.set(rarete(['commune', 'rare', 'epique', 'legendaire'][meilleur]).couleur);
    P.lueur.intensity = 0.7;
    P.cam.position.x = 0;
    P.cam.position.y = 0;

    redimensionnerOuverture();

    H.ouvEtiq.innerHTML = '';
    H.ouv.hidden = false;
    overlay.classList.add('wv-en-ouverture');

    montrerEcran('ouverture');
    majInterfaceOuverture();
    Son.clic();

  }catch(e){

    // Le booster est déjà ouvert côté base : les cartes sont dans la
    // collection. Ce qui a échoué, c'est la mise en scène ; on range ce qui
    // a été posé et on revient à la boutique, avec de quoi aller voir l'album.
    if(P){
      if(paquet) rangerPaquet(P, paquet);
      cartes3D.forEach(c => { P.scene.remove(c.groupe); libererCarte3D(c); });
    }

    ouv = null;

    if(H.ouv) H.ouv.hidden = true;
    if(H.ouvEtiq) H.ouvEtiq.innerHTML = '';
    overlay.classList.remove('wv-en-ouverture');

    etat.alerte = 'Tes cartes sont dans ta collection, mais leur présentation a échoué : ouvre ton album pour les voir.';
    Son.erreur();

    montrerEcran('boutique');
    majBoutique();
  }
}

// Retire le booster de la scène et libère ce qu'il a coûté.
function rangerPaquet(P, paquet){
  P.scene.remove(paquet.groupe);
  paquet.groupe.traverse(o => {
    if(o.geometry) o.geometry.dispose();
    if(o.material) o.material.dispose();
  });
}

function dechirer(){

  if(!ouv || ouv.phase !== 'attente') return;

  ouv.phase = 'dechire';
  ouv.t = 0;
  majInterfaceOuverture();
  Son.dechire();
}

function retourner(){

  if(!ouv || ouv.phase !== 'pile') return;

  const c = ouv.cartes[ouv.i];
  ouv.phase = 'retourne';
  ouv.peutSuivre = false;

  const cadre = cadreCarte();

  deplacerCarte(c, { x: 0, y: cadre.y, z: 0.5, s: cadre.grand, rx: 0, ry: 0, rz: 0 }, 0.95, 0, 0.3, () => {
    revelerCarte(c);
    ouv.phase = 'carte';
    ouv.peutSuivre = true;
    majInterfaceOuverture();
    if(ouv.vite) toutRevelerOuverture();
  });

  // Le bruit du retournement : quand la carte passe de chant.
  c.jalons = [{ u: 0.42, f: () => Son.flip() }];

  majInterfaceOuverture();
}

// La carte est face visible : gerbe, éclair, étiquette, et le son de sa rareté.
function revelerCarte(c, discret){

  c.revelee = true;

  const rang = rarete(c.carte.rarete).rang;
  const fx = effetRarete(rang);
  const couleur = rarete(c.carte.rarete).couleur;

  poserEtiquette(c);

  if(!discret){
    if(fx.etin) etincelles(c.groupe.position.x, c.groupe.position.y, c.groupe.position.z + 0.1, couleur, fx.etin, fx.vit);
    if(fx.flash) flasher(couleur, fx.flash);
    ouv.secousse = Math.max(ouv.secousse, fx.secousse);
    if(rang >= 1){
      R.paq.rayons.material.color.set(couleur);
      ouv.rayons = 1;
    }
    Son.carte(c.carte.rarete, c.carte.nouvelle);
  }
}

function suivante(){

  if(!ouv || ouv.phase !== 'carte' || !ouv.peutSuivre) return;

  const n = ouv.cartes.length;
  const c = ouv.cartes[ouv.i];

  ouv.peutSuivre = false;

  // La carte vue se range en bas ; la pile se resserre.
  const fait = ouv.i;
  ouv.i++;

  if(ouv.i >= n){
    versBilan(false);
    return;
  }

  const p = placeRangee(fait, n);
  deplacerCarte(c, { x: p.x, y: p.y, z: 0.05, s: p.s, rx: 0, ry: 0, rz: 0 }, 0.55, 0, 0.1);
  Son.clic();

  for(let k = ouv.i; k < n; k++){
    deplacerCarte(ouv.cartes[k], placePile(k - ouv.i), 0.5, 0.05 * (k - ouv.i));
  }

  // Les cartes déjà rangées se décalent pour laisser la place à la suivante.
  for(let k = 0; k < fait; k++){
    const q = placeRangee(k, n);
    deplacerCarte(ouv.cartes[k], { x: q.x, y: q.y, s: q.s }, 0.5, 0);
  }

  ouv.phase = 'pile';
  majInterfaceOuverture();
}

// Toutes les cartes à leur place, face visible.
function versBilan(tout){

  const n = ouv.cartes.length;
  const places = placesBilan(n);

  ouv.phase = 'bilan';
  ouv.peutSuivre = false;

  ouv.cartes.forEach((c, k) => {
    const p = places[k];
    if(!c.revelee) revelerCarte(c, true);
    deplacerCarte(c, { x: p.x, y: p.y, z: 0, s: p.s, rx: 0, ry: 0, rz: 0 }, 0.75, 0.07 * k, 0.25);
  });

  if(tout){
    const rang = ouv.meilleur;
    const fx = effetRarete(rang);
    const couleur = rarete(['commune', 'rare', 'epique', 'legendaire'][rang]).couleur;
    if(fx.etin) etincelles(0, 0, 0.3, couleur, fx.etin, fx.vit);
    if(fx.flash) flasher(couleur, fx.flash);
    Son.carte(['commune', 'rare', 'epique', 'legendaire'][rang], false);
  }

  majInterfaceOuverture();
}

function toutRevelerOuverture(){

  if(!ouv) return;

  // Pendant que le booster s'ouvre ou qu'une carte se retourne, on note le
  // souhait : le tirage s'ouvre en grand dès que la scène est prête. Le
  // booster est déjà consommé, personne ne doit rester coincé devant.
  if(ouv.phase === 'attente'){
    ouv.vite = true;
    dechirer();
    return;
  }

  if(ouv.phase === 'dechire' || ouv.phase === 'retourne'){
    ouv.vite = true;
    return;
  }

  if(ouv.phase !== 'pile' && ouv.phase !== 'carte') return;

  ouv.vite = false;

  // Une carte en train d'être retournée finit sa course, sans gerbe.
  const c = ouv.cartes[ouv.i];
  if(ouv.phase === 'carte'){
    ouv.i++;
  }

  versBilan(true);
}

// Un geste de la personne : clic, touche, bouton.
function avancerOuverture(){

  if(!ouv) return;

  if(ouv.phase === 'attente') dechirer();
  else if(ouv.phase === 'pile') retourner();
  else if(ouv.phase === 'carte') suivante();
}

function fermerOuverture(versBoutique){

  if(!ouv) return;

  const P = R.paq;

  rangerPaquet(P, ouv.paquet);

  ouv.cartes.forEach(c => { P.scene.remove(c.groupe); libererCarte3D(c); });

  const E = P.etincelles;
  E.pos.fill(-50);
  E.vie.fill(0);
  E.points.geometry.attributes.position.needsUpdate = true;

  ouv = null;

  H.ouv.hidden = true;
  H.ouvEtiq.innerHTML = '';
  overlay.classList.remove('wv-en-ouverture');

  if(versBoutique){
    etat.fermeeA = performance.now();
    if(croupier) croupier.accueillir(true);
    etat.remarque = choisir(PAROLES_CROUPIER);
    montrerEcran('boutique');
    majBoutique();
  }
}

// Un autre booster, tout de suite.
async function ouvrirUnAutre(){
  fermerOuverture(true);
  await ouvrirBooster();
}

// Le mouvement de la scène, à chaque image.
function majOuverture(dt){

  if(!ouv) return;

  const P = R.paq;
  const t = temps;

  ouv.t += dt;

  // Le fond respire ; les rayons tournent.
  P.rayons.rotation.z += dt * (etat.reduit ? 0.02 : 0.12);

  const cibleRayons = ouv.phase === 'attente' ? 0.06 : (ouv.rayons ? 0.8 : 0.16);
  P.rayons.material.opacity += (cibleRayons - P.rayons.material.opacity) * Math.min(1, dt * 4);
  if(ouv.rayons) ouv.rayons = Math.max(0, ouv.rayons - dt * 0.9);

  // La secousse de la caméra, qui retombe.
  ouv.secousse = Math.max(0, ouv.secousse - dt * 0.05);
  const tremble = etat.reduit ? 0 : ouv.secousse;
  P.cam.position.x = (Math.random() - 0.5) * tremble * 2;
  P.cam.position.y = (Math.random() - 0.5) * tremble * 2;

  const pa = ouv.paquet;

  if(ouv.phase === 'attente'){

    const b = etat.reduit ? 0 : Math.sin(t * 1.3) * 0.03;
    pa.groupe.position.set(0, b, 0);
    pa.groupe.rotation.set(etat.reduit ? 0 : Math.sin(t * 0.7) * 0.04, etat.reduit ? 0 : Math.sin(t * 0.9) * 0.3, 0);

  } else if(ouv.phase === 'dechire'){

    const u = ouv.t;

    // 0 → 0,45 : le paquet tremble et s'illumine.
    const t1 = clamp(u / 0.45, 0, 1);
    pa.groupe.rotation.z = etat.reduit ? 0 : Math.sin(u * 70) * 0.05 * t1;
    pa.groupe.rotation.y *= 0.92;
    pa.groupe.position.x = etat.reduit ? 0 : Math.sin(u * 83) * 0.012 * t1;
    P.lueur.intensity = 0.7 + 2.2 * t1;

    // À 0,45 : la bande part, une gerbe d'étincelles, un éclair.
    if(u >= 0.45 && !ouv.flags.dechire){
      ouv.flags.dechire = true;
      const couleur = rarete(['commune', 'rare', 'epique', 'legendaire'][ouv.meilleur]).couleur;
      etincelles(0, pa.hauteur * 0.6, 0.2, '#9fd4ff', 70, 2.4);
      flasher('#cfe8ff', 0.55);
      ouv.secousse = 0.012;
      ouv.rayons = 1;
      P.rayons.material.color.set(couleur);

      const b = ouv.bande;
      b.vx = 1.5; b.vy = 1.7; b.vrz = -3.2;
      Son.dechire(true);
    }

    if(ouv.flags.dechire){
      const b = ouv.bande;
      const dtb = dt;
      b.vy -= 2.2 * dtb;
      b.x += b.vx * dtb;
      b.y += b.vy * dtb;
      b.rz += b.vrz * dtb;
      pa.bande.groupe.position.set(b.x, b.y, 0.25);
      pa.bande.groupe.rotation.z = b.rz;
      const a = clamp(1 - (u - 0.45) / 0.7, 0, 1);
      pa.bande.mats.forEach((m, k) => { m.opacity = pa.bande.base[k] * a; });
    }

    // Les cartes montent, puis le corps du paquet descend en s'effaçant.
    if(u >= 0.7 && !ouv.flags.cartes){
      ouv.flags.cartes = true;
      ouv.cartes.forEach((c, k) => {
        c.groupe.visible = true;
        deplacerCarte(c, placePile(k), 0.8, 0.07 * k, 0.12);
      });
    }

    if(u >= 0.7){
      const v = clamp((u - 0.7) / 0.7, 0, 1);
      pa.corps.groupe.position.y = -v * 0.9;
      pa.corps.mats.forEach((m, k) => { m.opacity = pa.corps.base[k] * (1 - v); });
      P.lueur.intensity = lerp(2.9, 0.7, v);
    }

    if(u >= 1.7){
      pa.groupe.visible = false;
      ouv.phase = 'pile';
      majInterfaceOuverture();
      if(ouv.vite) toutRevelerOuverture();
    }
  }

  // Les cartes : mouvements en cours, flottement, inclinaison vers la souris.
  ouv.cartes.forEach((c, k) => {

    if(c.tw){

      const w = c.tw;
      w.t += dt;

      const u = clamp(w.t / w.duree, 0, 1);

      if(w.t >= 0){
        const e = entreeSortie(u);
        ['x', 'y', 'z', 's', 'rx', 'ry', 'rz'].forEach(cle => {
          c.etat[cle] = lerp(w.de[cle], w.vers[cle], e);
        });
        c.etat.z += Math.sin(u * Math.PI) * w.arc;

        if(c.jalons){
          c.jalons = c.jalons.filter(j => {
            if(u >= j.u){ j.f(); return false; }
            return true;
          });
        }

        if(u >= 1){
          const fin = w.fin;
          c.tw = null;
          if(fin) fin();
        }
      }
    }

    // La carte du dessus et les cartes du bilan flottent doucement.
    const dessus = (ouv.phase === 'pile' && k === ouv.i) || (ouv.phase === 'carte' && k === ouv.i);
    const enBilan = ouv.phase === 'bilan' && !c.tw;
    const cible = (dessus || enBilan) && !etat.reduit ? 1 : 0;
    c.flotte += (cible - c.flotte) * Math.min(1, dt * 3);

    const ph = t * 0.9 + c.phase;
    let incX = 0, incY = 0;

    if(dessus && !c.tw){
      incX = -ouv.pointeur.y * 0.35;
      incY = ouv.pointeur.x * 0.45;
    }

    const e = c.etat;

    c.groupe.position.set(e.x, e.y + Math.sin(ph) * 0.012 * c.flotte, e.z);
    c.groupe.scale.setScalar(e.s);
    c.groupe.rotation.set(
      e.rx + incX + Math.sin(ph * 0.8) * 0.05 * c.flotte,
      e.ry + incY + Math.cos(ph * 0.7) * 0.09 * c.flotte,
      e.rz
    );

    const u = c.mat.uniforms;
    u.uT.value = t;
    u.uTilt.value.set(c.groupe.rotation.y - e.ry + Math.sin(t * 0.6 + c.phase) * 0.3, c.groupe.rotation.x);
    u.uLueur.value = c.revelee && c.tw ? 0.6 : 0;
  });

  // Les étincelles.
  const E = P.etincelles;
  let vivant = false;

  for(let i = 0; i < E.n; i++){
    if(E.vie[i] <= 0) continue;
    vivant = true;
    E.vel[i * 3 + 1] -= 1.4 * dt;
    E.pos[i * 3] += E.vel[i * 3] * dt;
    E.pos[i * 3 + 1] += E.vel[i * 3 + 1] * dt;
    E.pos[i * 3 + 2] += E.vel[i * 3 + 2] * dt;
    E.vie[i] -= dt;
    if(E.vie[i] <= 0){ E.pos[i * 3] = E.pos[i * 3 + 1] = E.pos[i * 3 + 2] = -50; }
  }

  if(vivant || E.dernier){
    E.points.geometry.attributes.position.needsUpdate = true;
    E.points.geometry.attributes.color.needsUpdate = true;
  }
  E.dernier = vivant;

  placerEtiquettes();
}


/* ----------------------------------------------------------------------
   L'album : la collection
   ---------------------------------------------------------------------- */

// Le catalogue et ce qu'on en possède, chargés à la demande.
const album = { catalogue: null, collection: new Map(), miniatures: new Map(), filtre: 'toutes' };

async function chargerAlbum(){

  if(!options.cartes || !options.collection) throw new Error('L’album n’est pas disponible : recharge la page.');

  const [catalogue, collection] = await Promise.all([options.cartes(), options.collection()]);

  album.catalogue = catalogue;
  album.collection = new Map(collection.map(l => [Number(l.carte_id), Number(l.quantite) || 1]));
}

// La vignette d'une carte possédée, dessinée une fois.
function miniature(carte){

  const cle = carte.id + ':' + carte.nom + ':' + carte.motif;

  if(!album.miniatures.has(cle)){
    const c = creerFaceCarte(Object.assign({}, carte, { total: album.catalogue.length }), R.logo, 0.5);
    album.miniatures.set(cle, c);
  }

  const src = album.miniatures.get(cle);
  const copie = creerCanvas(src.width, src.height);
  copie.x.drawImage(src, 0, 0);

  return copie.c;
}

function ouvrirCollection(){

  if(etat.ecran !== 'boutique' || etat.achat || etat.ouverture) return;

  montrerEcran('collection');
}

function fermerCollection(){

  if(etat.ecran !== 'collection') return;

  montrerEcran('boutique');
  majBoutique();
}

function dessinerAlbum(){

  const grille = H.ecran.querySelector('#wvCollGrille');
  const compte = H.ecran.querySelector('#wvCollCompte');
  if(!grille || !album.catalogue) return;

  grille.innerHTML = '';
  grille.dataset.filtre = album.filtre;

  const total = album.catalogue.length;
  const possedees = album.catalogue.filter(c => album.collection.has(c.id)).length;

  compte.textContent = possedees + ' / ' + total;

  album.catalogue.forEach(carte => {

    const q = album.collection.get(carte.id) || 0;
    const cfg = rarete(carte.rarete);

    const el = document.createElement(q ? 'button' : 'div');
    el.className = 'wv-tuile rar-' + carte.rarete + (q ? '' : ' vide');

    if(q){

      el.type = 'button';
      el.dataset.id = carte.id;
      el.setAttribute('aria-label', carte.nom + ', ' + cfg.nom.toLowerCase() + (q > 1 ? ', ' + q + ' exemplaires' : ''));

      el.appendChild(miniature(carte));

      if(q > 1){
        const b = document.createElement('span');
        b.className = 'wv-tuile-qte';
        b.textContent = '×' + q;
        el.appendChild(b);
      }

    } else {

      el.setAttribute('aria-label', 'Carte ' + carte.id + ', pas encore trouvée');

      const n = document.createElement('span');
      n.className = 'wv-tuile-num';
      n.textContent = String(carte.id).padStart(2, '0');

      const pt = document.createElement('span');
      pt.className = 'wv-tuile-pt';
      pt.textContent = '?';

      const fond = document.createElement('div');
      fond.className = 'wv-tuile-fond';
      fond.append(pt, n);
      el.appendChild(fond);
    }

    grille.appendChild(el);
  });
}

// Une carte en grand, avec un reflet qui suit le pointeur.
function voirCarte(id){

  const carte = album.catalogue && album.catalogue.find(c => c.id === id);
  const zoom = H.ecran.querySelector('#wvZoom');
  if(!carte || !zoom) return;

  const cfg = rarete(carte.rarete);
  const q = album.collection.get(id) || 1;

  const toile = creerFaceCarte(Object.assign({}, carte, { total: album.catalogue.length }), R.logo, 1);
  toile.className = 'wv-zoom-carte';

  const scene = zoom.querySelector('.wv-zoom-scene');
  scene.innerHTML = '';
  scene.className = 'wv-zoom-scene rar-' + carte.rarete;
  scene.appendChild(toile);

  const reflet = document.createElement('i');
  reflet.className = 'wv-zoom-reflet';
  scene.appendChild(reflet);

  zoom.querySelector('.wv-zoom-legende').textContent =
    cfg.nom + ' · ' + carte.categorie + (q > 1 ? ' · ' + q + ' exemplaires' : '');

  zoom.hidden = false;

  const bouger = e => {
    const r = scene.getBoundingClientRect();
    const x = clamp((e.clientX - r.left) / r.width, 0, 1), y = clamp((e.clientY - r.top) / r.height, 0, 1);
    scene.style.setProperty('--rx', ((0.5 - y) * 16).toFixed(1) + 'deg');
    scene.style.setProperty('--ry', ((x - 0.5) * 22).toFixed(1) + 'deg');
    scene.style.setProperty('--mx', (x * 100).toFixed(1) + '%');
    scene.style.setProperty('--my', (y * 100).toFixed(1) + '%');
  };

  scene.onpointermove = bouger;
  scene.onpointerleave = () => {
    ['--rx', '--ry'].forEach(p => scene.style.setProperty(p, '0deg'));
  };

  zoom.querySelector('.wv-zoom-fermer').focus({ preventScroll: true });
}

function fermerZoom(){
  const zoom = H.ecran.querySelector('#wvZoom');
  if(!zoom || zoom.hidden) return false;
  zoom.hidden = true;
  const ouvert = H.ecran.querySelector('.wv-tuile:focus') || null;
  const panneau = H.ecran.querySelector('.wv-collection');
  if(panneau) panneau.focus({ preventScroll: true });
  return true;
}

async function brancherCollection(){

  const panneau = H.ecran.querySelector('.wv-collection');
  if(!panneau) return;

  const dans = sel => H.ecran.querySelector(sel);

  dans('#wvCollRetour').addEventListener('click', fermerCollection);
  dans('#wvZoomFermer').addEventListener('click', fermerZoom);

  dans('#wvCollFiltres').addEventListener('click', e => {
    const b = e.target.closest('button[data-f]');
    if(!b) return;
    album.filtre = b.dataset.f;
    dans('#wvCollFiltres').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
    dans('#wvCollGrille').dataset.filtre = album.filtre;
  });

  dans('#wvCollGrille').addEventListener('click', e => {
    const t = e.target.closest('.wv-tuile');
    if(t && t.dataset.id) voirCarte(Number(t.dataset.id));
  });

  dans('#wvCollFiltres').querySelectorAll('button').forEach(x => {
    x.setAttribute('aria-pressed', x.dataset.f === album.filtre ? 'true' : 'false');
  });

  panneau.focus({ preventScroll: true });

  try{

    await chargerAlbum();

    // On a pu fermer l'album pendant le chargement.
    if(etat.ecran !== 'collection') return;

    dessinerAlbum();

  }catch(e){

    if(etat.ecran !== 'collection') return;

    const grille = dans('#wvCollGrille');
    grille.innerHTML = '';
    const p = document.createElement('p');
    p.className = 'wv-alerte';
    p.setAttribute('role', 'alert');
    p.textContent = e && e.message ? e.message : 'L’album n’a pas pu se charger : réessaie.';
    grille.appendChild(p);
  }
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

  // Le croupier, de face : il faut être de son côté de la table et le
  // regarder.
  if(croupier){
    const dx = croupier.centre.x - joueur.x, dz = croupier.centre.z - joueur.z;
    const d = Math.hypot(dx, dz);
    const devant = -dx * croupier.normale.x - dz * croupier.normale.z;

    if(d < 4.6 && d > 0.05 && devant > 0.6 && (dx * fx + dz * fz) / d > 0.72){
      return { type: 'croupier', machine: croupier };
    }
  }

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
  // La table des combinaisons est celle de la machine, pas du croupier.
  afficherGains(machine.type !== 'croupier');
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

  // Juste après avoir fermé la boutique, un second clic ne vaut pas action.
  if(performance.now() - (etat.fermeeA || -1e9) < 600) return;

  // En cours de transition, on attend d'être arrivé.
  if(focus.cible === 1 && focus.t > 0.9){
    if(focus.machine.type === 'croupier') ouvrirBoutique();
    else tirer(focus.machine);
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

  // Le tirage est engagé dès maintenant : la requête du compteur, plus bas,
  // laisserait sinon passer un second appel (deux frappes de E) qui
  // consommerait un second tour.
  etat.enTirage = true;

  // Le compteur est chargé à l'ouverture ; s'il manque, on va le chercher.
  if(!etat.tours) await chargerEtat();

  if(etat.tours && etat.tours.restants <= 0){
    etat.enTirage = false;
    Son.erreur();
    afficherMessage("Tu as joué tous tes tours d'aujourd'hui. Reviens demain !", 3400);
    machine.ecrire('À DEMAIN', 'plus de tours aujourd\'hui', '#9fb0c2');
    return;
  }

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
    poserMachine(machine, res);
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

  // Quitter la salle pendant l'arrêt : arreter() a déjà transmis le résultat
  // (voir etat.attente), le redonner ferait fêter deux fois le même niveau.
  if(!actif){
    etat.enTirage = false;
    poserMachine(machine, res);
    return;
  }

  await attendre(260);

  annoncerResultat(machine, res);

  etat.tours = {
    restants: res.tours_restants,
    parJour: res.tours_par_jour,
    gagne: ((etat.tours && etat.tours.gagne) || 0) + (res.gain || 0),
    pieces: ((etat.tours && etat.tours.pieces) || 0) + (res.pieces || 0)
  };

  // Le solde de pièces renvoyé par la base fait foi.
  if(res.pieces_total !== undefined){
    etat.bourse = {
      pieces: res.pieces_total,
      boosters: (etat.bourse && etat.bourse.boosters) || 0,
      prix: (etat.bourse && etat.bourse.prix) || null
    };
  }

  etat.attente = null;
  etat.enTirage = false;

  if(options.apresTirage) options.apresTirage(res);

  majHud();
}

// La salle a été quittée avec les rouleaux en route : ils se posent sur le
// résultat reçu (la boucle les finira à la prochaine entrée) et l'écran de
// la machine retrouve son message d'accueil, au lieu de « les rouleaux
// tournent ».
function poserMachine(machine, res){
  machine.rouleaux.forEach((r, i) => {
    if(r.etat === 'tourne') machine.arreter(i, res.symboles[i]);
  });
  machine.ecrire('TENTE TA CHANCE', 'tire le levier', machine.def.couleur);
}

// Le bruit des rouleaux : un tic-tic qui s'accélère et se calme avec eux.
function ticsRouleaux(machine){
  const boucle = () => {
    if(!machine.tourne || !actif || document.hidden) return;
    Son.tic();
    setTimeout(boucle, 75);
  };
  boucle();
}

function annoncerResultat(machine, res){

  const xp = res.gain || 0;
  const pieces = res.pieces || 0;
  const jackpot = res.motif === 'trio' && res.symbole === 'logo';

  if(xp > 0 || pieces > 0){

    machine.gagner(jackpot);

    const mot = pluriel(pieces, 'pièce');

    const detail = (xp > 0 ? '+' + xp + ' XP' : '') + (xp > 0 && pieces > 0 ? ' · ' : '') +
                   (pieces > 0 ? '+' + pieces + ' ' + mot : '');

    machine.ecrire(
      jackpot ? 'JACKPOT !' : (xp > 0 ? '+' + xp + ' XP' : '+' + pieces + ' ' + mot),
      jackpot ? detail : (xp > 0 && pieces > 0 ? '+' + pieces + ' ' + mot : res.nom),
      jackpot ? '#ffe08a' : '#7dffb2'
    );

    afficherGain(xp, jackpot ? 'jackpot' : res.nom, pieces);

    if(jackpot) Son.jackpot();
    else Son.gain(Math.min(4, Math.floor(xp / 5)));

    if(pieces > 0) Son.pieces(pieces);

    // La gerbe de pièces est un mouvement de trop pour qui a demandé d'en
    // avoir moins. Elle est à la mesure de ce qui est gagné.
    if(!etat.reduit) jaillir(machine, jackpot ? 70 : Math.min(30, 6 + Math.round(pieces / 2)));

  } else {
    machine.ecrire('PAS CETTE FOIS', 'retente ta chance', '#9fb0c2');
    Son.rate();
  }
}

// Des pièces qui sortent du bac de la machine.
function jaillir(machine, nombre){

  const P = animes.pieces;
  if(!P) return;

  const origine = new THREE.Vector3(0, 0.42, 0.5);
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

// Numéro de la dernière demande d'état : une réponse qui arrive après une
// plus récente (ou après un achat) ne doit pas repasser par-dessus.
let seqEtat = 0;

async function chargerEtat(){

  if(!options.connecte || !options.connecte() || !options.etat){
    seqEtat++;
    etat.tours = null;
    etat.bourse = null;
    majHud();
    return;
  }

  const numero = ++seqEtat;

  try{

    const e = await options.etat();

    if(numero !== seqEtat) return;

    if(e){
      etat.tours = {
        restants: e.tours_restants,
        parJour: e.tours_par_jour,
        gagne: e.gagne_aujourdhui || 0,
        pieces: e.pieces_aujourdhui || 0
      };

      // Une base pas encore mise à jour ne connaît pas les pièces : on ne
      // fabrique pas un portefeuille vide, on n'en montre pas.
      etat.bourse = e.pieces === undefined ? null : {
        pieces: e.pieces || 0,
        boosters: e.boosters || 0,
        prix: e.prix_booster || null,
        // Absentes tant que le SQL des cartes n'est pas passé.
        cartes: e.cartes_possedees || 0,
        cartesTotal: e.cartes_total || 0
      };
    }

  }catch(err){
    // Sans réponse, on garde ce qu'on savait (rien, à la première fois : le
    // compteur manque alors, et on laisse quand même essayer — c'est la base
    // qui décide, l'affichage n'est qu'un confort).
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

  // Coupé, la musique ne doit pas continuer à se télécharger et à défiler
  // sans qu'on l'entende.
  if(Son.estActif()){
    Musique.demarrer(options.musique).catch(() => {});
    Musique.reprendre();
  } else {
    Musique.pause();
  }
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

  // Le portefeuille : les pièces, et les boosters en attente. Un visiteur
  // n'en a pas.
  const b = etat.bourse;

  H.bourse.hidden = !u || !b;
  H.pieces.textContent = b ? b.pieces : '—';
  H.boosters.textContent = b && b.boosters
    ? b.boosters + ' ' + pluriel(b.boosters, 'booster')
    : '';

  if(b){
    H.bourse.setAttribute('aria-label',
      b.pieces + ' ' + pluriel(b.pieces, 'pièce') +
      (b.boosters ? ', ' + b.boosters + ' ' + pluriel(b.boosters, 'booster') : ''));
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
function afficherGain(xp, legende, pieces){

  const el = legende === 'jackpot' ? H.gain : H.plus;

  const mot = pluriel(pieces, 'pièce');

  const gagne = (xp > 0 ? '+' + xp + ' XP' : '') + (xp > 0 && pieces > 0 ? ' · ' : '') +
                (pieces > 0 ? '+' + pieces + ' ' + mot : '');

  if(legende === 'jackpot'){
    el.innerHTML = '';
    el.appendChild(document.createTextNode(xp > 0 ? '+' + xp + ' XP' : '+' + pieces + ' ' + mot));
    const s = document.createElement('small');
    s.textContent = xp > 0 && pieces > 0 ? 'jackpot · +' + pieces + ' ' + mot : 'jackpot';
    el.appendChild(s);
  } else {
    el.textContent = gagne;
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

  const payantes = etat.gains
    .filter(g => g.motif !== 'rien' && (g.xp > 0 || g.pieces > 0))
    .sort((a, b) => (b.xp - a.xp) || ((b.pieces || 0) - (a.pieces || 0)));

  if(!payantes.length) return;

  H.gains.innerHTML = '<h3>Combinaisons</h3><ul></ul>';

  const ul = H.gains.querySelector('ul');

  payantes.forEach(g => {
    const li = document.createElement('li');
    const nom = document.createElement('span');
    nom.textContent = libelleCombinaison(g);
    const val = document.createElement('b');
    val.textContent = '+' + g.xp + ' XP' + (g.pieces > 0 ? ' · ' + g.pieces + ' ' + pluriel(g.pieces, 'pièce') : '');
    li.appendChild(nom);
    li.appendChild(val);
    ul.appendChild(li);
  });

  H.gains.hidden = false;
}

function majInvite(){

  const c = etat.cible;

  let texte = '';

  if(etat.ecran || etat.intro){
    texte = '';
  } else if(focus.cible === 1){

    // Face au croupier, la boutique s'ouvre d'elle-même : rien à indiquer.
    const auCroupier = focus.machine && focus.machine.type === 'croupier';

    if(focus.t > 0.9 && !etat.enTirage && !auCroupier){
      texte = etat.tactile
        ? ''
        : '<span class="wv-touche">E</span> ou clic <small>tirer le levier</small> &nbsp;·&nbsp; <span class="wv-touche">S</span> <small>reculer</small>';
    }

  } else if(c){

    if(c.type === 'porte'){
      texte = etat.tactile ? '' : '<span class="wv-touche">E</span> Quitter la salle';
    } else if(c.type === 'croupier'){
      texte = etat.tactile ? '' : '<span class="wv-touche">E</span> Parler au croupier';
    } else {
      const nom = c.machine.def.nom;
      texte = etat.tactile ? '' : '<span class="wv-touche">E</span> Jouer sur ' + nom;
    }

  } else if(!etat.tactile && document.pointerLockElement !== H.canvas){

    // Le navigateur n'a pas donné la souris (le verrou se demande sur un
    // clic) : une petite invite, seulement dans ce cas. Si le verrou est
    // indisponible, on dit comment regarder autour de soi.
    texte = etat.sansVerrou
      ? '<small>Maintiens le clic et glisse pour regarder</small>'
      : '<span class="wv-touche">Clic</span> <small>pour prendre les commandes</small>';
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
        : (c && c.type === 'porte' ? 'SORTIR' : (c && c.type === 'croupier' ? 'PARLER' : 'JOUER'));
    }
  }
}


/* ----------------------------------------------------------------------
   Écrans : chargement, pause, connexion, erreur
   ---------------------------------------------------------------------- */

function montrerEcran(type, texte){

  etat.ecran = type;

  // La boutique se range à droite sur un grand écran, pour laisser voir le
  // croupier ; les autres écrans restent centrés.
  H.ecran.classList.toggle('wv-ecran-boutique', type === 'boutique');
  H.ecran.classList.toggle('wv-ecran-collection', type === 'collection');

  // L'ouverture d'un booster a ses propres commandes (voir H.ouv) : aucun
  // panneau, mais le jeu est tout de même « occupé ».
  if(!type || type === 'ouverture'){
    H.ecran.hidden = true;
    H.ecran.innerHTML = '';
    if(type && document.pointerLockElement) document.exitPointerLock();
    return;
  }

  const enTete = '<span class="wv-sur">L’espace des waveurs</span>';

  let html = '';

  if(type === 'chargement'){

    html = '<div class="wv-panneau"><div class="wv-charge"><i></i><span>Chargement de la salle…</span></div></div>';

  } else if(type === 'pause'){

    // Les commandes ne sont rappelées qu'ici, à la demande : la salle
    // s'ouvre sans mode d'emploi.
    const aide = etat.tactile
      ? '<li class="wv-texte">Glisse le pouce à gauche pour avancer, à droite pour regarder.</li>' +
        '<li class="wv-texte">Approche-toi de la machine, touche <b>JOUER</b>, puis <b>TIRER</b>.</li>'
      : '<li><span class="wv-touche">Z</span><span class="wv-touche">Q</span><span class="wv-touche">S</span><span class="wv-touche">D</span><span>ou les flèches : se déplacer</span></li>' +
        '<li><span class="wv-touche">Souris</span><span>regarder autour de soi</span></li>' +
        '<li><span class="wv-touche">E</span><span>ou clic : jouer, tirer le levier</span></li>' +
        '<li><span class="wv-touche">Maj</span><span>courir &nbsp;·&nbsp;</span><span class="wv-touche">M</span><span>son</span></li>';

    html = '<div class="wv-panneau">' + enTete +
      '<h2>Pause</h2>' +
      '<p>La salle t’attend. Tes tours et ton XP sont enregistrés à chaque tirage.</p>' +
      '<ul class="wv-aide">' + aide + '</ul>' +
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

  } else if(type === 'boutique'){

    const connecte = !!(options.connecte && options.connecte());

    // Le squelette n'est posé qu'une fois ; ensuite majBoutique() en change
    // les valeurs sur place. Reconstruire la fenêtre à chaque clic détruisait
    // le bouton qui avait le focus (le clavier sautait sur « Acheter ») et
    // relançait l'animation du booster.
    let corps;

    if(!connecte){

      corps = '<p class="wv-parole" id="wvParole"></p>' +
        '<p>Un booster de cartes La Wave TCG, payé avec les pièces gagnées à la machine. Il faut un compte pour jouer et pour acheter : c’est gratuit.</p>' +
        '<div class="wv-actions">' +
        '<button type="button" class="wv-cta" id="wvConnexion">Se connecter</button>' +
        '<button type="button" class="wv-cta discret" id="wvFermer">Plus tard</button>' +
        '</div>';

    } else {

      corps = '<p class="wv-parole" id="wvParole"></p>' +
        '<div class="wv-prix"><b id="wvPrix">—</b><span id="wvPrixMot">pièces le booster</span></div>' +
        '<div class="wv-portefeuille">' +
          '<span>Tes pièces : <b id="wvMesPieces">—</b></span>' +
          '<span>Tes boosters : <b id="wvMesBoosters">—</b></span>' +
        '</div>' +
        '<div id="wvMessages"></div>' +
        '<div class="wv-achat">' +
          '<div class="wv-quantite">' +
            '<button type="button" id="wvMoins" aria-label="Un booster de moins">−</button>' +
            '<span id="wvQte" aria-live="polite">1</span>' +
            '<button type="button" id="wvPlusUn" aria-label="Un booster de plus">+</button>' +
          '</div>' +
          '<button type="button" class="wv-cta" id="wvAcheter">Acheter</button>' +
          '<button type="button" class="wv-cta discret" id="wvFermer">Fermer</button>' +
        '</div>' +
        '<div class="wv-cartes-actions">' +
          '<button type="button" class="wv-cta discret" id="wvOuvrir">Ouvrir un booster</button>' +
          '<button type="button" class="wv-cta discret" id="wvCollection">Ma collection</button>' +
        '</div>' +
        '<p class="wv-note">Un booster contient cinq cartes. Les pièces se gagnent à la machine : ni elles, ni les cartes ne s’achètent avec de l’argent, ni ne se revendent.</p>';
    }

    html = '<div class="wv-panneau wv-boutique" role="dialog" aria-label="Boutique du croupier" tabindex="-1">' +
      '<span class="wv-sur">Le croupier</span>' +
      '<h2>Booster La Wave TCG</h2>' +
      '<div class="wv-vitrine">' +
        '<div class="wv-pack"><img alt="Un booster La Wave TCG" src="' + imageBooster() + '"></div>' +
        '<div>' + corps + '</div>' +
      '</div></div>';

  } else if(type === 'collection'){

    html = '<div class="wv-panneau wv-collection" role="dialog" aria-label="Ma collection de cartes" tabindex="-1">' +
      '<div class="wv-coll-tete">' +
        '<div><span class="wv-sur">La Wave TCG</span><h2>Ma collection</h2></div>' +
        '<b class="wv-coll-compte" id="wvCollCompte" aria-label="Cartes possédées">— / —</b>' +
      '</div>' +
      '<div class="wv-coll-filtres" id="wvCollFiltres" role="group" aria-label="Filtrer par rareté">' +
        '<button type="button" data-f="toutes">Toutes</button>' +
        '<button type="button" data-f="commune">Communes</button>' +
        '<button type="button" data-f="rare">Rares</button>' +
        '<button type="button" data-f="epique">Épiques</button>' +
        '<button type="button" data-f="legendaire">Légendaires</button>' +
      '</div>' +
      '<div class="wv-coll-grille" id="wvCollGrille" data-filtre="toutes"><p class="wv-coll-charge">Chargement de ton album…</p></div>' +
      '<div class="wv-actions"><button type="button" class="wv-cta" id="wvCollRetour">Retour au croupier</button></div>' +
      '<div class="wv-coll-zoom" id="wvZoom" hidden role="dialog" aria-label="Carte en grand">' +
        '<div class="wv-zoom-scene"></div>' +
        '<p class="wv-zoom-legende"></p>' +
        '<button type="button" class="wv-cta discret wv-zoom-fermer" id="wvZoomFermer">Fermer</button>' +
      '</div>' +
      '</div>';

  } else if(type === 'erreur'){

    html = '<div class="wv-panneau">' + enTete +
      '<h2>La salle n’a pas pu s’ouvrir</h2>' +
      '<p id="wvErreurTexte"></p>' +
      '<div class="wv-actions"><button type="button" class="wv-cta" id="wvSortir">Retour au site</button></div></div>';
  }

  H.ecran.innerHTML = html;
  H.ecran.hidden = false;

  // Un pointeur verrouillé ne peut pas cliquer : les écrans à boutons le
  // libèrent.
  if((type === 'erreur' || type === 'pause' || type === 'connexion' || type === 'boutique' || type === 'collection') && document.pointerLockElement){
    document.exitPointerLock();
  }

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

  if(type === 'boutique') brancherBoutique();
  if(type === 'collection') brancherCollection();
}


/* ----------------------------------------------------------------------
   La boutique du croupier
   ---------------------------------------------------------------------- */

const PAROLES_CROUPIER = [
  'Bonsoir, waveur. Un booster pour ce soir ?',
  'Ici, les pièces de la machine trouvent enfin leur usage.',
  'La maison offre les tours ; les cartes, elles, se méritent.',
  'Prends ton temps : les meilleurs tirages se font à tête froide.'
];

const REMERCIEMENTS_CROUPIER = [
  'Excellent choix. Il t’attend dans ton stock.',
  'Voilà, waveur. Que la chance t’accompagne.',
  'Bien joué. Reviens quand la machine aura été généreuse.'
];

const choisir = liste => liste[Math.floor(Math.random() * liste.length)];

// « 1 pièce », « 60 pièces » : le mot s'accorde avec le nombre.
const pluriel = (n, mot) => mot + (Math.abs(Number(n)) > 1 ? 's' : '');

// L'image du booster pour la boutique : la face, avec ses soudures
// dentelées, transparente autour. Dessinée une fois.
function imageBooster(){
  if(!R.imageBooster) R.imageBooster = creerBoosterFace(R.logo, true).toDataURL('image/png');
  return R.imageBooster;
}

function ouvrirBoutique(){

  if(etat.ecran || !croupier) return;

  etat.alerte = null;
  etat.reussite = null;
  etat.remarque = choisir(PAROLES_CROUPIER);

  croupier.accueillir(true);
  montrerEcran('boutique');
  Son.clic();

  // Le solde à jour, sans attendre : la fenêtre s'ouvre avec ce qu'on sait
  // déjà, et se corrige si la base répond autre chose.
  chargerEtat().then(() => {
    if(!etat.achat) majBoutique();
  });
}

function fermerBoutique(){

  // On ne ferme pas pendant un achat : sa réponse ne se lirait nulle part.
  if(etat.ecran !== 'boutique' || etat.achat || etat.ouverture) return;

  croupier.accueillir(false);
  montrerEcran(null);
  sortirFocus();

  // Un double-clic sur « Fermer » ne doit pas rouvrir la boutique : son
  // second clic, sur le canvas devenu actif, vaudrait un E devant le croupier.
  etat.fermeeA = performance.now();

  // Le clic sur « Fermer » est le geste qu'il faut pour reprendre la souris.
  if(!etat.tactile && !etat.sansVerrou) demanderVerrou();
}

// Appelée par le site quand quelque chose a changé hors du jeu (on vient de
// se connecter depuis la fenêtre du croupier, par exemple) : le solde se
// recharge et la fenêtre se redessine.
function actualiser(){
  if(!actif) return;
  chargerEtat().then(() => { if(etat.ecran === 'boutique') majBoutique(); });
}

function changerQuantite(delta){
  etat.qte = clamp(etat.qte + delta, 1, 5);
  etat.alerte = null;
  etat.reussite = null;
  majBoutique();
}

async function acheterBooster(){

  if(etat.achat || etat.ouverture) return;

  // Une version mêlée du site (index.html pas encore à jour) n'offre pas
  // l'achat : on le dit, plutôt que de ne rien faire.
  if(!options.acheter){
    etat.alerte = 'La boutique n’est pas disponible : recharge la page.';
    Son.erreur();
    majBoutique();
    return;
  }

  etat.achat = true;
  etat.alerte = null;
  etat.reussite = null;
  majBoutique();

  try{

    const res = await options.acheter(etat.qte);

    // Les réponses plus anciennes d'un chargerEtat encore en route ne
    // doivent pas repasser par-dessus ce solde.
    seqEtat++;

    etat.bourse = Object.assign({}, etat.bourse, {
      pieces: res.pieces_total,
      boosters: res.boosters_total,
      prix: res.prix_unitaire || (etat.bourse && etat.bourse.prix) || null
    });

    etat.reussite = res.quantite > 1
      ? res.quantite + ' boosters ajoutés à ton stock.'
      : 'Un booster ajouté à ton stock.';
    etat.remarque = choisir(REMERCIEMENTS_CROUPIER);

    Son.achat();
    if(croupier) croupier.remercier();
    majHud();

  }catch(e){

    // La base a refusé (pas assez de pièces, caisse fermée...) ou n'a pas
    // répondu. En cas de refus, rien n'est débité ; après une erreur de
    // réseau, on ne sait pas : le rechargement du solde, juste après, dit ce
    // qu'il en est.
    etat.alerte = e && e.message ? e.message : 'L’achat a échoué : réessaie.';
    etat.remarque = /^Pas assez de pièces/.test(etat.alerte)
      ? 'Reviens quand la machine aura été généreuse, waveur.'
      : 'Un contretemps, waveur. Réessaie dans un instant.';
    Son.erreur();
    await chargerEtat();
  }

  etat.achat = false;

  majBoutique();
}

// Ouvrir un booster du stock : la base retire le booster et tire les cartes ;
// quand elle a répondu, la scène d'ouverture s'anime. Un refus (plus de
// booster, cartes pas encore imprimées) revient à la boutique, avec son
// message.
async function ouvrirBooster(){

  if(etat.ouverture || etat.achat || !actif) return;

  const b = etat.bourse;

  if(!options.ouvrir){
    etat.alerte = 'L’ouverture n’est pas disponible : recharge la page.';
    Son.erreur();
    if(etat.ecran !== 'boutique') montrerEcran('boutique');
    majBoutique();
    return;
  }

  if(!b || b.boosters < 1){
    etat.alerte = 'Tu n’as aucun booster à ouvrir : achète-en un au croupier.';
    Son.erreur();
    majBoutique();
    return;
  }

  etat.ouverture = true;
  etat.alerte = null;
  etat.reussite = null;
  majBoutique();

  // Une visite de la salle, de l'entrée à la sortie : si l'on est sorti puis
  // rentré pendant l'attente, cette réponse ne regarde plus la visite en cours.
  const visite = sessionJeu;

  let res;

  try{

    res = await options.ouvrir();

    if(!res || !Array.isArray(res.cartes) || !res.cartes.length) throw new Error('Le booster est vide : réessaie.');

  }catch(e){

    // On a pu quitter la salle pendant l'attente.
    if(visite !== sessionJeu) return;

    etat.ouverture = false;
    etat.alerte = e && e.message ? e.message : 'L’ouverture a échoué : réessaie.';
    etat.remarque = 'Un contretemps, waveur. Réessaie dans un instant.';
    Son.erreur();

    if(etat.ecran !== 'boutique') montrerEcran('boutique');
    await chargerEtat();
    majBoutique();
    return;
  }

  // Les cartes sont enregistrées par la base : même si l'on est parti, elles
  // sont dans la collection. La scène, elle, n'a plus de raison de s'ouvrir.
  if(visite !== sessionJeu){
    album.catalogue = null;
    return;
  }

  etat.ouverture = false;

  // Ce que la base renvoie est ramené à des nombres avant de servir : un
  // champ absent ne doit pas afficher « undefined » ni ouvrir une porte.
  const nombre = (x, defaut) => Number.isFinite(Number(x)) && x !== null && x !== '' ? Number(x) : defaut;

  res.cartes = res.cartes.map(c => Object.assign({}, c, { id: nombre(c.id, 0), quantite: nombre(c.quantite, 1) }));

  const avant = etat.bourse || {};

  // Le solde que la base vient de donner, sans relire : les réponses plus
  // anciennes d'un chargerEtat en route ne doivent pas repasser par-dessus.
  seqEtat++;

  etat.bourse = Object.assign({}, avant, {
    boosters: Math.max(0, nombre(res.boosters_total, Math.max(0, (Number(avant.boosters) || 0) - 1))),
    cartes: nombre(res.cartes_possedees, avant.cartes || 0),
    cartesTotal: nombre(res.cartes_total, avant.cartesTotal || 0)
  });

  res.boosters_total = etat.bourse.boosters;
  res.cartes_total = etat.bourse.cartesTotal || res.cartes_total;

  // L'album garde en mémoire ce qui vient d'y entrer.
  res.cartes.forEach(c => { album.collection.set(c.id, c.quantite); });
  album.miniatures.clear();
  album.catalogue = null;

  majHud();

  if(!actif) return;

  lancerOuverture(res);
}

// Ce que la boutique affiche du portefeuille et du prix. Le bouton d'achat
// n'est qu'un confort : c'est la base qui décide de ce qui est vendu.
function valeursBoutique(){

  const b = etat.bourse;
  const prix = b && b.prix ? Number(b.prix) : null;
  const cout = prix ? prix * etat.qte : null;

  // Sans prix, la base n'a pas répondu (ou n'est pas à jour) : pas d'achat.
  const disponible = !!options.acheter && prix !== null;
  const assez = !disponible || (b && Number(b.pieces) >= cout);

  let libelle;

  if(etat.achat) libelle = 'Un instant…';
  else if(!disponible) libelle = 'Boutique pas encore ouverte';
  else if(!assez) libelle = 'Pas assez de pièces';
  else libelle = 'Acheter · ' + cout + ' ' + pluriel(cout, 'pièce');

  return { b, prix, cout, disponible, assez, libelle };
}

// Met la fenêtre de la boutique à jour sur place : les boutons gardent leur
// focus, le booster son animation, la quantité sa région vocale.
function majBoutique(){

  if(etat.ecran !== 'boutique') return;

  const connecte = !!(options.connecte && options.connecte());
  const racine = H.ecran.querySelector('.wv-boutique');

  // Pas encore dessinée, ou l'état de connexion a changé (on vient de se
  // connecter depuis la boutique) : on la redessine.
  if(!racine || connecte !== !!H.ecran.querySelector('#wvAcheter')){
    montrerEcran('boutique');
    return;
  }

  const dire = (id, texte) => {
    const el = H.ecran.querySelector('#' + id);
    if(el) el.textContent = texte;
  };

  dire('wvParole', '« ' + (etat.remarque || PAROLES_CROUPIER[0]) + ' »');

  if(!connecte) return;

  const v = valeursBoutique();

  // Les nombres viennent de la base : on les ramène à des nombres avant de
  // les écrire dans la page.
  const nb = x => Number.isFinite(Number(x)) ? Number(x) : '—';

  dire('wvPrix', v.prix !== null ? String(nb(v.prix)) : '—');
  dire('wvPrixMot', pluriel(v.prix, 'pièce') + ' le booster');
  dire('wvMesPieces', v.b ? String(nb(v.b.pieces)) : '—');
  dire('wvMesBoosters', v.b ? String(nb(v.b.boosters)) : '—');
  dire('wvQte', String(etat.qte));

  // L'alerte et la confirmation : posées s'il y en a une, retirées sinon.
  const zone = H.ecran.querySelector('#wvMessages');

  const poser = (id, classe, role, texte) => {
    let el = zone.querySelector('#' + id);
    if(!texte){
      if(el) el.remove();
      return;
    }
    if(!el){
      el = document.createElement('p');
      el.id = id;
      el.className = classe;
      el.setAttribute('role', role);
      zone.appendChild(el);
    }
    el.textContent = texte;
  };

  poser('wvAlerte', 'wv-alerte', 'alert', etat.alerte);
  poser('wvReussite', 'wv-reussite', 'status', etat.reussite);

  const moins = H.ecran.querySelector('#wvMoins');
  const plus = H.ecran.querySelector('#wvPlusUn');
  const acheter = H.ecran.querySelector('#wvAcheter');
  const fermer = H.ecran.querySelector('#wvFermer');

  const occupe = etat.achat || etat.ouverture;

  moins.disabled = etat.qte <= 1 || occupe;
  plus.disabled = etat.qte >= 5 || occupe;
  acheter.disabled = occupe || !v.disponible || !v.assez;
  acheter.textContent = v.libelle;
  fermer.disabled = occupe;

  // Les cartes : les boosters en stock, et où en est la collection.
  const ouvrir = H.ecran.querySelector('#wvOuvrir');
  const boutonAlbum = H.ecran.querySelector('#wvCollection');

  if(ouvrir && boutonAlbum){
    const stock = v.b ? Number(v.b.boosters) || 0 : 0;
    ouvrir.textContent = etat.ouverture ? 'Un instant…' : 'Ouvrir un booster' + (stock ? ' (' + stock + ')' : '');
    ouvrir.disabled = occupe || stock < 1 || !options.ouvrir;
    boutonAlbum.textContent = 'Ma collection' + (v.b && v.b.cartesTotal ? ' (' + v.b.cartes + '/' + v.b.cartesTotal + ')' : '');
    boutonAlbum.disabled = occupe || !options.collection;
  }

  // Un bouton qui vient d'être désactivé rend son focus : à la fenêtre, pas
  // à un autre bouton, dont une frappe aurait un effet.
  const actif = document.activeElement;
  if(actif && actif !== document.body && H.ecran.contains(actif) && actif.disabled) racine.focus({ preventScroll: true });
}

// Les boutons de la fenêtre. Les textes qui viennent du serveur sont posés
// avec textContent : rien de ce que la base renvoie n'est lu comme du HTML.
function brancherBoutique(){

  const par = (id, fn) => {
    const el = H.ecran.querySelector('#' + id);
    if(el) el.addEventListener('click', fn);
  };

  par('wvMoins', () => changerQuantite(-1));
  par('wvPlusUn', () => changerQuantite(1));
  par('wvAcheter', acheterBooster);
  par('wvFermer', fermerBoutique);
  par('wvOuvrir', ouvrirBooster);
  par('wvCollection', ouvrirCollection);

  majBoutique();

  // Le focus va à la fenêtre, pas à « Acheter » : une frappe d'Entrée encore
  // enfoncée depuis le dialogue avec le croupier, ou un clic posé trop vite,
  // ne doit pas dépenser de pièces.
  const racine = H.ecran.querySelector('.wv-boutique');
  if(racine) racine.focus({ preventScroll: true });
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
  Musique.reprendre();

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

  if(!actif || etat.tactile || etat.intro) return;

  const verrouille = document.pointerLockElement === H.canvas;

  if(verrouille){
    etat.sansVerrou = false;
    etat.echecsVerrou = 0;

    // Un verrou accordé alors que la boutique s'est ouverte entre-temps
    // (on reprenait la pause pendant le trajet vers le croupier) la
    // rendrait inutilisable à la souris : on le relâche.
    if(etat.ecran === 'boutique') document.exitPointerLock();

    return;
  }

  // Le verrou a sauté (Échap) : la salle se met en pause, sauf si un autre
  // écran est déjà là ou si on a quitté.
  etat.verrouPerduA = performance.now();

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

  // Un refus dans les deux secondes qui suivent la perte du verrou est celui
  // de Chrome, temporaire : il ne compte pas.
  if(performance.now() - (etat.verrouPerduA || -1e9) < 2000) return;

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

  // Échap ferme la boutique du croupier.
  if(etat.ecran === 'boutique'){
    if(e.code === 'Escape'){
      e.preventDefault();
      fermerBoutique();
    }
    return;
  }

  // L'album : Échap ferme la carte en grand, puis l'album.
  if(etat.ecran === 'collection'){
    if(e.code === 'Escape'){
      e.preventDefault();
      if(!fermerZoom()) fermerCollection();
    }
    return;
  }

  // L'ouverture d'un booster : Entrée, Espace ou E font avancer, à moins
  // qu'un bouton n'ait le focus (il s'active alors de lui-même). Échap
  // révèle le reste, puis ferme.
  if(etat.ecran === 'ouverture'){

    if(e.code === 'Escape'){
      e.preventDefault();
      if(ouv && ouv.phase === 'bilan') fermerOuverture(true);
      else toutRevelerOuverture();
      return;
    }

    if((e.code === 'Enter' || e.code === 'Space' || e.code === 'KeyE') && !e.repeat &&
       !(e.target instanceof Element && e.target.closest('button'))){
      e.preventDefault();
      avancerOuverture();
    }

    return;
  }

  // Un écran est affiché (pause, connexion...) : ses boutons doivent rester
  // activables au clavier, avec Entrée ou Espace. Le jeu se tait.
  if(etat.ecran) return;

  const code = e.code;

  // Entrée et Espace, sur un bouton de l'interface du jeu qui a le focus
  // (Son, Plein écran, Quitter, Passer), activent ce bouton : le jeu ne les
  // prend pas. Un bouton de la page, derrière la salle, ne compte pas : il
  // ne doit rien pouvoir déclencher d'ici (le bouton d'entrée, encore
  // focalisé après le clic, relançait la salle au point de départ).
  if((code === 'Enter' || code === 'Space') && e.target instanceof Element && overlay && overlay.contains(e.target) && e.target.closest('button')) return;

  // Pendant le travelling, une touche du jeu le passe.
  if(etat.intro){
    if(TOUCHES_JEU.has(code)){
      e.preventDefault();
      passerIntro();
    }
    return;
  }

  if(TOUCHES_JEU.has(code)) e.preventDefault();

  touches.add(code);

  if(e.repeat) return;

  if(code === 'KeyE' || code === 'Enter' || code === 'Space'){
    actionPrincipale();
  } else if(e.key && e.key.toLowerCase() === 'm'){
    // La lettre, pas la position : sur un clavier AZERTY, la touche M porte
    // le code Semicolon, et KeyM est la virgule.
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

  // Pendant l'ouverture d'un booster, la carte du dessus s'incline vers la
  // souris.
  if(ouv && overlay){
    ouv.pointeur.x = clamp(e.clientX / Math.max(1, overlay.clientWidth) * 2 - 1, -1, 1);
    ouv.pointeur.y = clamp(e.clientY / Math.max(1, overlay.clientHeight) * 2 - 1, -1, 1);
    return;
  }

  if(!actif || etat.ecran || etat.intro || focus.cible === 1) return;

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

  if(!actif || e.button !== 0) return;

  // Un clic sur la scène d'ouverture fait avancer. Sur un écran tactile, c'est
  // le doigt qui s'en charge (surDoigtBas) : le clic qui le suit est ignoré.
  if(etat.ecran === 'ouverture'){
    if(!etat.tactile) avancerOuverture();
    return;
  }

  if(etat.ecran) return;

  // Si le navigateur a refusé la musique au démarrage, ce geste le lui fait
  // accepter.
  Son.reprendre();
  Musique.reprendre();

  // Ce clic passe le travelling ; c'est aussi le geste qu'il faut pour
  // verrouiller le pointeur si le premier essai n'a pas abouti.
  if(etat.intro){
    passerIntro();
    return;
  }

  if(document.pointerLockElement === H.canvas){
    actionPrincipale();
    return;
  }

  if(etat.tactile) return;

  // Pas de verrou : ce clic sert à en redemander un. En attendant, faire
  // glisser la souris permet déjà de regarder autour de soi.
  etat.glisse = true;

  if(etat.sansVerrou){
    // Le verrou est indisponible : on note où et quand le bouton est
    // enfoncé, pour que le relâcher sans avoir glissé vaille un E.
    etat.clic = { x: e.clientX, y: e.clientY, t: performance.now() };
  } else {
    demanderVerrou();
  }
}

function surRelacheSouris(e){

  etat.glisse = false;

  const c = etat.clic;
  etat.clic = null;

  if(!c || !e || !actif || etat.ecran || etat.intro || !etat.sansVerrou) return;

  // Sans verrou, un clic bref, sans glisser, fait ce que fait E : jouer,
  // tirer le levier.
  if(Math.hypot(e.clientX - c.x, e.clientY - c.y) < 6 && performance.now() - c.t < 450){
    actionPrincipale();
  }
}

// Tactile : le pouce gauche conduit (le joystick apparaît où il se pose),
// le droit regarde.
function surDoigtBas(e){

  if(!actif || !etat.tactile || e.pointerType === 'mouse') return;

  if(etat.ecran === 'ouverture'){
    if(!e.target.closest('button')) avancerOuverture();
    return;
  }

  if(etat.ecran || e.target.closest('button')) return;

  Son.reprendre();
  Musique.reprendre();

  if(etat.intro){
    passerIntro();
    return;
  }

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
    Musique.pause();
    Son.suspendre();
  } else if(!raf){
    dernier = 0;
    raf = requestAnimationFrame(boucle);
    Son.reprendre();
    Musique.reprendre();
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

  redimensionnerPost();
  redimensionnerOuverture();
}

// Sur une machine modeste, la salle perd en finesse plutôt qu'en fluidité :
// si les images tardent, on renonce d'abord au halo, puis aux reflets du sol,
// puis la résolution baisse d'un cran à la fois, et en dernier recours les
// effets de rendu s'arrêtent.
function surveillerPerformance(dt){

  if(dt > 1 / 28) lentes++; else lentes = Math.max(0, lentes - 1);

  if(lentes <= 70) return;

  lentes = 0;

  if(POST.actif && POST.bloom){
    POST.bloom = false;
  } else if(REFLET.actif){
    REFLET.actif = false;
    desactiverReflets();
  } else if(ratioActuel > 0.7){
    ratioActuel = Math.max(0.7, ratioActuel * 0.85);
    renderer.setPixelRatio(ratioActuel);
    redimensionner();
  } else if(POST.actif){
    POST.actif = false;
    renderer.setRenderTarget(null);
  }
}

// Les surfaces qui relisaient le reflet n'ont plus rien à lire : leur force
// tombe à zéro.
function desactiverReflets(){
  REFLET.surfaces.forEach(s => {
    const sh = s.material.userData.shader;
    if(sh) sh.uniforms.uForceReflet.value = 0;
  });
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

  // Pendant l'ouverture d'un booster, la salle est à l'arrêt : on ne montre
  // que la scène des cartes.
  if(ouv){

    majOuverture(dt);
    rendre(R.paq.scene, R.paq.cam);

    surveillerPerformance(dt);
    return;
  }

  majJoueur(dt);
  majCamera(dt);
  majMonde(dt);

  // Arrivé face au croupier, on ouvre sa boutique sans rien demander de plus.
  if(focus.cible === 1 && focus.t > 0.92 && focus.machine && focus.machine.type === 'croupier' &&
     !etat.ecran && !etat.intro){
    ouvrirBoutique();
  }

  etat.cible = (focus.cible === 0 && !etat.ecran && !etat.intro) ? viser() : null;
  majInvite();

  majReflet(scene, camera);
  rendre(scene, camera);

  surveillerPerformance(dt);
}

function majJoueur(dt){

  if(etat.ecran || etat.intro || focus.cible === 1 || focus.t > 0.001) {
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

/* ----------------------------------------------------------------------
   Le travelling d'ouverture
   ----------------------------------------------------------------------
   La caméra part de derrière la machine, côté bar, en hauteur, en fait le
   tour par la gauche en descendant, et se pose au point de départ, à hauteur
   d'yeux, le regard droit devant. Un clic ou une touche le passe : il finit
   alors en accéléré, sans saut de caméra.
   ---------------------------------------------------------------------- */

const DUREE_INTRO = 5.4;

function positionIntro(u){

  const e = entreeSortie(clamp(u, 0, 1));

  // Sur un écran en hauteur, le champ est étroit : on part plus loin.
  const portrait = camera.aspect < 1;

  const th = lerp(-2.1, 0, e);
  // Le rayon reste sous ~7 m tant que la caméra est sur le côté : au-delà,
  // elle sortirait de la salle (les murs sont invisibles vus de dehors).
  const r = lerp(portrait ? 6.4 : 6.0, DEPART.z, e);

  const x = Math.sin(th) * r, z = Math.cos(th) * r;
  const y = lerp(portrait ? 3.9 : 3.3, JOUEUR.yeux, e);

  // On regarde la machine ; à l'arrivée, droit devant.
  const tx = 0, ty = lerp(2.4, JOUEUR.yeux, e), tz = -6 * e * e;

  const dx = tx - x, dz = tz - z;

  return {
    x, y, z,
    yaw: Math.atan2(-dx, -dz),
    pitch: Math.atan2(ty - y, Math.hypot(dx, dz)),
    fov: lerp(portrait ? 66 : 52, portrait ? 78 : 70, e)
  };
}

function lancerIntro(){

  joueur.x = DEPART.x;
  joueur.z = DEPART.z;
  joueur.yaw = 0;
  joueur.pitch = 0;

  // À chaque entrée dans la salle, sauf pour qui préfère moins de mouvement.
  if(etat.reduit){
    etat.intro = false;
    return;
  }

  etat.intro = true;
  etat.introT = 0;
  etat.introRapide = false;

  // Retirer puis remettre la classe relance les animations CSS.
  overlay.classList.remove('wv-intro');
  void overlay.offsetWidth;
  overlay.classList.add('wv-intro');
}

function finirIntro(){

  if(!etat.intro) return;

  etat.intro = false;
  etat.introRapide = false;
  overlay.classList.remove('wv-intro');

  // La caméra reprend la main droit devant, exactement où le travelling
  // s'est posé : une souris qui aurait bougé pendant l'ouverture ne doit pas
  // la faire pivoter d'un coup.
  joueur.yaw = 0;
  joueur.pitch = 0;

  // Sur téléphone, rien n'a dit comment jouer : une seule ligne, une seule
  // fois, qui s'efface d'elle-même.
  if(etat.tactile && !aideTactileVue){
    aideTactileVue = true;
    afficherMessage('Pouce gauche : avancer · pouce droit : regarder. Approche-toi de la machine.', 5200);
  }
}

// Un geste de la personne : le travelling se termine en accéléré, et c'est
// l'occasion de demander le verrou du pointeur, qu'un geste seul permet.
function passerIntro(){

  if(!etat.intro) return;

  etat.introRapide = true;

  if(!etat.tactile && !etat.sansVerrou && document.pointerLockElement !== H.canvas){
    demanderVerrou();
  }
}

function majCamera(dt){

  if(etat.intro){

    etat.introT += dt * (etat.introRapide ? 7 : 1);

    const u = etat.introT / DUREE_INTRO;

    if(u >= 1){
      finirIntro();
    } else {
      const v = positionIntro(u);
      camera.position.set(v.x, v.y, v.z);
      camera.rotation.set(v.pitch, v.yaw, 0);
      if(Math.abs(camera.fov - v.fov) > 0.01){
        camera.fov = v.fov;
        camera.updateProjectionMatrix();
      }
      return;
    }
  }

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

  if(R.faisceau){
    const op = 1 - clamp(focus.t * 1.5, 0, 1);
    R.faisceau.material.uniforms.uOpacite.value = op;
    R.faisceau.material.uniforms.uT.value = t;
    R.faisceau.visible = op > 0.01;
  }

  // Le croupier suit du regard qui s'approche ; pas pendant le travelling.
  if(croupier){

    // Il regarde la personne : là où elle est, et pas à sa place sur la carte
    // quand la caméra est allée se mettre en face de lui.
    const faceAuCroupier = focus.cible === 1 && focus.machine === croupier;
    const regard = faceAuCroupier
      ? { x: camera.position.x, z: camera.position.z }
      : { x: joueur.x, z: joueur.z };

    croupier.maj(dt, t, etat.reduit, etat.intro ? null : regard);
  }

  // Les habitués, eux, regardent l'œil de la caméra.
  if(habitues.length){
    const oeil = etat.intro ? null : { x: camera.position.x, z: camera.position.z };
    habitues.forEach(h => h.maj(dt, t, etat.reduit, oeil));
  }

  // Le booster qui flotte : il tourne lentement et se balance. Le reflet du
  // foil glisse sur tous les boosters à la fois.
  const B = animes.boutique;
  if(B){
    B.flotte.rotation.y = etat.reduit ? Math.PI / 2 : t * 0.55;
    B.flotte.position.y = B.y0 + (etat.reduit ? 0 : Math.sin(t * 1.1) * 0.05);
  }
  if(R.reflet && !etat.reduit){
    R.reflet.offset.x = (t * 0.045) % 1;
    R.reflet.offset.y = (t * 0.02) % 1;
  }

  // Les néons du bar respirent à peine ; jamais deux au même rythme.
  animes.neons.forEach(n => {
    n.mat.opacity = etat.reduit ? 0.95 : 0.88 + 0.12 * Math.sin(t * 1.6 + n.phase);
  });

  // La poussière dorée du faisceau dérive lentement.
  const D = animes.poussiere;
  if(D){
    const lent = etat.reduit ? 0.3 : 1;
    for(let i = 0; i < D.grains.length; i++){
      const g = D.grains[i];
      g.a += g.w * dt * lent;
      g.y += g.v * dt * lent;
      if(g.y > 4.5) g.y = 0.3;
      D.pos[i * 3] = Math.sin(g.a) * g.r;
      D.pos[i * 3 + 1] = g.y;
      D.pos[i * 3 + 2] = Math.cos(g.a) * g.r;
    }
    D.points.geometry.attributes.position.needsUpdate = true;
  }

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

// Ce qui traîne de la visite précédente : un pouce resté sur le joystick
// (le relâcher n'a jamais été vu, les écouteurs étaient retirés), un gain
// à moitié affiché, le panneau des combinaisons.
function reinitialiserSession(){

  sessionJeu++;

  touches.clear();

  joy.id = null;
  joy.x = 0;
  joy.y = 0;
  regard.id = null;
  etat.glisse = false;
  etat.clic = null;
  etat.alerte = null;
  etat.reussite = null;

  if(croupier) croupier.accueillir(false);

  // Une ouverture de booster restée en plan : ses cartes sont déjà dans la
  // collection, la base les a enregistrées.
  if(ouv) fermerOuverture(false);

  etat.ouverture = false;

  if(H.joy) H.joy.hidden = true;
  if(H.gains) H.gains.hidden = true;
  if(H.message) H.message.hidden = true;
  if(H.gain) effacerGain();
}

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

  reinitialiserSession();

  // Le clic qui a ouvert la salle laisse le focus sur son bouton, derrière
  // le jeu : Entrée ou Espace le réactiveraient. On le rend.
  const focalise = document.activeElement;
  if(focalise && focalise !== document.body && !overlay.contains(focalise) && focalise.blur) focalise.blur();

  actif = true;

  // Le clic qui a ouvert la salle est le geste dont le navigateur a besoin
  // pour le son et pour verrouiller le pointeur : on s'en sert tout de
  // suite, avant le chargement, qui peut durer plus que ce que le navigateur
  // veut bien attendre. Si le verrou est refusé, un clic dans la salle le
  // redemandera.
  etat.sansVerrou = false;
  etat.echecsVerrou = 0;

  Son.init();
  Son.reprendre();
  // Sans pistes déposées, ou si le navigateur refuse la lecture, la salle
  // reste simplement silencieuse.
  Musique.demarrer(options.musique).catch(() => {});

  if(!etat.tactile) demanderVerrou();

  montrerEcran('chargement');

  try{

    if(!webglDispo()){
      throw new Error("Ton navigateur ne sait pas afficher la 3D (WebGL). Essaie avec un navigateur à jour.");
    }

    await assurerThree();

    if(!pret) await construireMonde();

  }catch(e){
    // Rien à écouter sur un écran d'erreur.
    Musique.arreter();
    Son.suspendre();
    if(actif) montrerEcran('erreur', e.message);
    return;
  }

  // On a pu quitter pendant le chargement.
  if(!actif) return;

  brancherEvenements();
  redimensionner();

  // Toujours au point de départ : devant la porte, face à la machine.
  joueur.x = DEPART.x;
  joueur.z = DEPART.z;
  joueur.yaw = 0;
  joueur.pitch = 0;
  focus.cible = 0;
  focus.t = 0;
  focus.machine = null;

  etat.enTirage = false;
  majInvite.dernier = null;

  // Plus d'écran d'accueil : on entre directement, par un travelling. Le
  // compteur de tours se charge pendant qu'il tourne.
  montrerEcran(null);
  lancerIntro();

  dernier = 0;
  if(!raf) raf = requestAnimationFrame(boucle);

  chargerEtat();
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

  reinitialiserSession();
  etat.enTirage = false;

  debrancherEvenements();
  Musique.arreter();
  Son.suspendre();

  // Quitter en plein travelling ne doit pas laisser l'interface masquée.
  etat.intro = false;
  etat.introRapide = false;
  overlay.classList.remove('wv-intro');

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
  actualiser,
  ouverte: () => actif,

  // Petit accès réservé aux essais : il ne sert qu'à vérifier le jeu sans
  // manette, et n'ouvre rien que le jeu ne fasse déjà.
  _essai: {
    etat: () => ({ joueur, focus, etat, actif, pret, ratioActuel }),
    machines: () => machines,
    croupier: () => croupier,
    ouvrirBoutique,
    musique: () => Musique.etat(),
    majBoutique,
    creerCarte: (c, echelle) => creerFaceCarte(c, R.logo, echelle || 1),
    ouvrirBooster,
    ouverture: () => ouv,
    paquet: () => R.paq,
    post: () => POST,
    reflet: () => REFLET,
    rendre: () => { majReflet(scene, camera); rendre(scene, camera); },
    ouvrirCollection,
    album: () => album,
    avancerOuverture,
    toutReveler: toutRevelerOuverture,
    habitues: () => habitues,
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
