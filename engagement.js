/* =====================================================================
   La Wave — l'engagement, côté navigateur

   Le moteur vit dans la base (sql/engagement.sql). Ce fichier lit et dessine :

     le duel de sorties           deux pochettes, un clic, le résultat s'affiche après le vote
     la page Saison              l'onglet de la communauté : la saison (30 paliers, 4 chapitres, événements, citrouille du
                                  jour, défis, classement), le duel du moment, ma semaine et la garde-robe
     « Ma semaine »               le résumé du lundi au dimanche, partageable en image
     le vestiaire                 un écran de jeu pour s'habiller : cadres d'avatar, titres, couleurs de pseudo, emblèmes
                                  (aucun avantage, que du style), collections par rareté, aperçu avant d'équiper
                                  + le statut de découvreur (les pépites repérées avant tout le monde)
     l'accès équipe               créer / retirer des duels, régler les saisons

   Chargé à la demande (chargerEngagement dans index.html). Si le SQL n'est pas passé, tout se tait.
   ===================================================================== */

(function(){

  'use strict';

  const esc = (t) => escapeHtml(t);
  const nf = (n) => Number(n || 0).toLocaleString('fr-FR');
  const hexa = (c, defaut) => (/^#[0-9a-fA-F]{6}$/.test(c || '') ? c : defaut);
  const etoiles = (note) => (Number(note) / 2).toFixed(1).replace('.', ',').replace(',0', '');
  const jourCourt = (iso) => new Date(String(iso).slice(0, 10) + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });

  const RANGS = { 1: 'Découvreur', 3: 'Dénicheur', 10: 'Visionnaire', 25: 'Prophète' };
  const RARETES = { commun: 'Commun', rare: 'Rare', epique: 'Épique', legendaire: 'Légendaire' };
  const TYPES = { cadre: 'Cadres', titre: 'Titres', couleur: 'Couleurs de pseudo', embleme: 'Emblèmes' };
  const TYPE_LIBELLE = { cadre: 'Cadre', titre: 'Titre', couleur: 'Couleur de pseudo', embleme: 'Emblème' };

  // ---------------------------------------------------------------------
  // La feuille de style, posée une fois
  // ---------------------------------------------------------------------

  const FEUILLE = `
  .eng-duel, .eng-bande, .eng-voile{--eng-bord:rgba(255,255,255,.10); --eng-fond:rgba(255,255,255,.045);}

  /* ---- Le duel ---- */
  .eng-duel{margin:0 0 14px; padding:16px; border-radius:20px; border:1px solid var(--eng-bord); background:var(--eng-fond);}
  .eng-duel-tete{display:flex; align-items:baseline; justify-content:space-between; gap:12px; margin-bottom:12px;}
  .eng-eyebrow{font-size:11px; letter-spacing:.14em; text-transform:uppercase; color:var(--muted);}
  .eng-reste{font-size:12px; color:var(--muted); font-variant-numeric:tabular-nums;}
  .eng-duel-grille{display:grid; grid-template-columns:1fr auto 1fr; gap:10px; align-items:center;}
  .eng-vs{font-size:11px; font-weight:700; letter-spacing:.12em; color:var(--muted);}
  .eng-cote{
    all:unset; box-sizing:border-box; display:block; min-width:0; cursor:pointer; text-align:left; border-radius:14px;
    transition:transform .25s var(--ease, ease);
  }
  .eng-cote:focus-visible{outline:2px solid var(--blue-bright); outline-offset:3px;}
  .eng-cote[disabled]{cursor:default;}
  .eng-duel:not(.vote) .eng-cote:hover{transform:translateY(-2px);}
  .eng-pochette{position:relative; display:block; aspect-ratio:1; border-radius:12px; overflow:hidden; background:#10151c;}
  .eng-pochette img{width:100%; height:100%; object-fit:cover; display:block; transition:filter .3s, transform .5s var(--ease, ease);}
  .eng-duel.vote .eng-cote:not(.choisi) img{filter:saturate(.45) brightness(.62);}
  .eng-cote.choisi .eng-pochette{box-shadow:0 0 0 2px var(--blue-bright);}
  .eng-pourcent{
    position:absolute; left:0; right:0; bottom:0; padding:22px 10px 8px; font-size:22px; font-weight:700; color:#fff;
    background:linear-gradient(transparent, rgba(0,0,0,.72)); font-variant-numeric:tabular-nums; opacity:0; transition:opacity .35s;
  }
  .eng-duel.vote .eng-pourcent, .eng-duel.fini .eng-pourcent{opacity:1;}
  .eng-cote b{display:block; margin-top:8px; font-size:13px; color:var(--ink); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
  .eng-cote small{display:block; font-size:12px; color:var(--muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
  .eng-duel-pied{display:flex; justify-content:space-between; gap:10px; margin-top:12px; font-size:12px; color:var(--muted);}
  .eng-duel-pied a{color:var(--ink-soft); text-decoration:underline; text-underline-offset:3px; cursor:pointer;}
  .eng-erreur{margin:10px 0 0; font-size:12px; color:var(--danger);}

  /* ---- La bande : semaine · saison · garde-robe ---- */
  .eng-bande{display:grid; grid-template-columns:repeat(3, 1fr); gap:8px; margin:0 0 14px;}
  .eng-puce{
    all:unset; box-sizing:border-box; cursor:pointer; padding:11px 12px; border-radius:14px; border:1px solid var(--eng-bord);
    background:var(--eng-fond); min-width:0; transition:background .2s, transform .2s var(--ease, ease);
  }
  .eng-puce:hover{background:rgba(255,255,255,.08); transform:translateY(-1px);}
  .eng-puce:focus-visible{outline:2px solid var(--blue-bright); outline-offset:2px;}
  .eng-puce b{display:block; font-size:13px; color:var(--ink); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
  .eng-puce small{display:block; margin-top:2px; font-size:11px; color:var(--muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
  .eng-puce .eng-fil{display:block; height:3px; margin-top:8px; border-radius:99px; background:rgba(255,255,255,.1); overflow:hidden;}
  .eng-puce .eng-fil i{display:block; height:100%; border-radius:99px; background:linear-gradient(90deg, var(--s1, #4FB4FF), var(--s2, #ffc46b));}

  /* ---- La feuille (fenêtre) ---- */
  .eng-voile{
    position:fixed; inset:0; z-index:400; display:flex; align-items:flex-end; justify-content:center;
    background:rgba(3,5,8,.7); backdrop-filter:blur(10px); -webkit-backdrop-filter:blur(10px);
    animation:engVoile .25s ease both;
  }
  @media (min-width:700px){ .eng-voile{align-items:center;} }
  .eng-feuille{
    position:relative; width:min(560px, 100%); max-height:92vh; overflow-y:auto; overflow-x:hidden; scrollbar-width:thin;
    border-radius:24px 24px 0 0; border:1px solid var(--line-strong); background:#0b0f15; color:var(--ink);
    animation:engMonte .35s var(--ease, ease) both;
  }
  @media (min-width:700px){ .eng-feuille{border-radius:24px;} }
  .eng-feuille-tete{
    position:sticky; top:0; z-index:3; display:flex; align-items:center; justify-content:space-between; gap:10px;
    padding:16px 18px 12px; background:linear-gradient(#0b0f15 70%, transparent);
  }
  .eng-feuille-tete h2{margin:0; font-size:17px; font-weight:600;}
  .eng-fermer{
    all:unset; box-sizing:border-box; width:34px; height:34px; display:grid; place-items:center; cursor:pointer;
    border-radius:50%; background:rgba(255,255,255,.08); color:var(--ink); font-size:18px; line-height:1;
  }
  .eng-fermer:hover{background:rgba(255,255,255,.16);}
  .eng-fermer:focus-visible{outline:2px solid var(--blue-bright);}
  .eng-corps{padding:4px 18px 22px;}
  .eng-onglets{display:flex; gap:6px; margin-bottom:14px;}
  .eng-onglet{
    all:unset; box-sizing:border-box; cursor:pointer; padding:7px 13px; border-radius:99px; font-size:13px; color:var(--muted);
    border:1px solid var(--eng-bord);
  }
  .eng-onglet[aria-selected="true"]{color:var(--ink); background:rgba(255,255,255,.1); border-color:var(--line-strong);}
  .eng-vide{padding:30px 10px; text-align:center; color:var(--muted); font-size:14px; line-height:1.5;}
  .eng-note{margin:12px 0 0; font-size:12px; color:var(--muted); line-height:1.5;}
  .eng-btn{
    all:unset; box-sizing:border-box; cursor:pointer; display:inline-flex; align-items:center; justify-content:center; gap:8px;
    padding:11px 18px; border-radius:99px; font-size:14px; font-weight:600; color:#06101a; background:var(--ink);
  }
  .eng-btn:hover{filter:brightness(.92);}
  .eng-btn:focus-visible{outline:2px solid var(--blue-bright); outline-offset:2px;}
  .eng-btn.discret{color:var(--ink); background:rgba(255,255,255,.09);}
  .eng-btn[disabled]{opacity:.5; cursor:default;}

  /* ---- Ma semaine ---- */
  .eng-semaine-haut{
    padding:20px 18px; border-radius:20px; margin-bottom:12px;
    background:radial-gradient(120% 140% at 0% 0%, rgba(79,180,255,.28), transparent 60%), radial-gradient(120% 140% at 100% 100%, rgba(255,196,107,.2), transparent 60%), rgba(255,255,255,.04);
    border:1px solid var(--eng-bord);
  }
  .eng-semaine-haut .dates{font-size:12px; color:var(--muted);}
  .eng-semaine-haut .profil{margin:6px 0 0; font-size:15px; color:var(--ink-soft);}
  .eng-gros{margin:10px 0 0; font-size:44px; font-weight:700; line-height:1; font-variant-numeric:tabular-nums;}
  .eng-gros small{font-size:15px; font-weight:500; color:var(--muted); margin-left:6px;}
  .eng-delta{margin:8px 0 0; font-size:12px; color:var(--ink-soft);}
  .eng-tuiles{display:grid; grid-template-columns:repeat(3, 1fr); gap:8px; margin-bottom:12px;}
  .eng-tuile{padding:12px 10px; border-radius:14px; background:var(--eng-fond); border:1px solid var(--eng-bord); text-align:center;}
  .eng-tuile b{display:block; font-size:22px; font-variant-numeric:tabular-nums;}
  .eng-tuile span{display:block; margin-top:2px; font-size:11px; color:var(--muted);}
  .eng-ligne-sortie{display:flex; align-items:center; gap:12px; padding:10px; border-radius:14px; background:var(--eng-fond); border:1px solid var(--eng-bord); margin-bottom:8px;}
  .eng-ligne-sortie img{width:54px; height:54px; border-radius:9px; object-fit:cover; flex:none;}
  .eng-ligne-sortie .tx{min-width:0; flex:1;}
  .eng-ligne-sortie .tx small{display:block; font-size:11px; color:var(--muted); letter-spacing:.06em; text-transform:uppercase;}
  .eng-ligne-sortie .tx b{display:block; font-size:14px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
  .eng-ligne-sortie .tx span{display:block; font-size:12px; color:var(--muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
  .eng-ligne-sortie .note{font-size:15px; font-weight:600; white-space:nowrap;}
  .eng-succes{display:flex; flex-wrap:wrap; gap:6px; margin:6px 0 0;}
  .eng-succes span{padding:5px 10px; border-radius:99px; font-size:12px; background:rgba(255,255,255,.07); border:1px solid var(--eng-bord);}
  .eng-partage{display:flex; gap:8px; flex-wrap:wrap; margin-top:16px;}

  /* ---- La saison ---- */
  .eng-saison-haut{
    padding:20px 18px; border-radius:20px; margin-bottom:14px; border:1px solid var(--eng-bord);
    background:linear-gradient(135deg, color-mix(in srgb, var(--s1) 30%, transparent), color-mix(in srgb, var(--s3) 22%, transparent)), rgba(255,255,255,.03);
  }
  .eng-saison-haut .theme{font-size:12px; letter-spacing:.14em; text-transform:uppercase; color:var(--ink-soft);}
  .eng-saison-haut h3{margin:4px 0 0; font-size:22px;}
  .eng-saison-haut .reste{margin:4px 0 0; font-size:12px; color:var(--ink-soft);}
  .eng-barre{height:6px; margin-top:14px; border-radius:99px; background:rgba(255,255,255,.14); overflow:hidden;}
  .eng-barre i{display:block; height:100%; border-radius:99px; background:linear-gradient(90deg, var(--s1), var(--s2)); transition:width .8s var(--ease, ease);}
  .eng-saison-pts{display:flex; justify-content:space-between; margin-top:8px; font-size:12px; color:var(--ink-soft); font-variant-numeric:tabular-nums;}
  .eng-titre-bloc{margin:18px 0 8px; font-size:11px; letter-spacing:.14em; text-transform:uppercase; color:var(--muted);}
  .eng-palier{display:flex; align-items:center; gap:12px; padding:10px 12px; border-radius:14px; border:1px solid var(--eng-bord); background:var(--eng-fond); margin-bottom:6px;}
  .eng-palier.atteint{border-color:color-mix(in srgb, var(--s2) 55%, transparent);}
  .eng-palier.prochain{border-color:var(--line-strong); background:rgba(255,255,255,.08);}
  .eng-palier .num{width:26px; height:26px; flex:none; border-radius:50%; display:grid; place-items:center; font-size:12px; font-weight:700; background:rgba(255,255,255,.08);}
  .eng-palier.atteint .num{background:var(--s2); color:#06101a;}
  .eng-palier .tx{flex:1; min-width:0;}
  .eng-palier .tx b{display:block; font-size:13px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
  .eng-palier .tx small{display:block; font-size:11px; color:var(--muted);}
  .eng-defi{padding:10px 12px; border-radius:14px; border:1px solid var(--eng-bord); background:var(--eng-fond); margin-bottom:6px;}
  .eng-defi .l{display:flex; justify-content:space-between; gap:10px; font-size:13px;}
  .eng-defi .l span{color:var(--muted); font-variant-numeric:tabular-nums; white-space:nowrap;}
  .eng-defi.fait .l{color:var(--muted);}
  .eng-defi .eng-barre{height:4px; margin-top:8px; background:rgba(255,255,255,.1);}

  /* ---- Aperçus de cosmétiques ---- */
  .eng-av{
    position:relative; isolation:isolate; flex:none; width:var(--t, 44px); height:var(--t, 44px); border-radius:50%; display:grid; place-items:center;
    font-weight:700; color:#fff; background:linear-gradient(145deg, hsl(var(--h, 210) 58% 40%), hsl(calc(var(--h, 210) + 46) 62% 26%));
    box-shadow:0 0 0 2px #0b0f15;
  }
  .eng-av img{width:100%; height:100%; border-radius:50%; object-fit:cover; display:block;}
  .eng-av b{font-size:calc(var(--t, 44px) * .42);}
  .eng-av.cadre{background:none;}
  .eng-av.cadre::after{content:''; position:absolute; inset:0; border-radius:50%; z-index:-1; background:linear-gradient(145deg, hsl(var(--h, 210) 58% 40%), hsl(calc(var(--h, 210) + 46) 62% 26%));}
  .eng-av.cadre::before{
    content:''; position:absolute; inset:-5px; border-radius:50%; z-index:-1;
    background:linear-gradient(135deg, var(--ca), var(--cb));
  }
  .eng-av.cadre.tourne::before{background:conic-gradient(var(--ca), var(--cb), var(--cc, var(--ca)), var(--ca)); animation:engTourne 6s linear infinite;}
  .eng-av.cadre.pulse::before{animation:engPulse 2.6s ease-in-out infinite;}
  .eng-nom-couleur{background:linear-gradient(90deg, var(--na), var(--nb)); -webkit-background-clip:text; background-clip:text; color:transparent;}
  .eng-titre-pastille{display:inline-block; padding:3px 9px; border-radius:99px; font-size:11px; background:rgba(255,255,255,.09); border:1px solid var(--eng-bord); color:var(--ink-soft);}
  .eng-ap{display:flex; align-items:center; gap:14px; padding:14px; border-radius:18px; border:1px solid var(--eng-bord); background:var(--eng-fond); margin-bottom:12px;}
  .eng-ap .nom{font-size:16px; font-weight:600;}
  .eng-ap .nom + .eng-titre-pastille{margin-top:6px;}

  /* ---- La garde-robe ---- */
  .eng-grille{display:grid; grid-template-columns:repeat(auto-fill, minmax(150px, 1fr)); gap:8px;}
  .eng-objet{
    all:unset; box-sizing:border-box; cursor:pointer; padding:12px; border-radius:14px; border:1px solid var(--eng-bord); background:var(--eng-fond);
    display:flex; flex-direction:column; align-items:flex-start; gap:8px; min-width:0; transition:background .2s;
  }
  .eng-objet:hover{background:rgba(255,255,255,.08);}
  .eng-objet:focus-visible{outline:2px solid var(--blue-bright); outline-offset:2px;}
  .eng-objet.equipe{border-color:var(--blue-bright); background:rgba(79,180,255,.1);}
  .eng-objet.verrouille{opacity:.55;}
  .eng-objet .apercu{height:44px; display:flex; align-items:center; font-size:15px; font-weight:600; max-width:100%;}
  .eng-objet b{font-size:13px; max-width:100%; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
  .eng-objet small{font-size:11px; color:var(--muted); line-height:1.35;}
  .eng-rar-rare b{color:#7cc4ff;} .eng-rar-epique b{color:#c79bff;} .eng-rar-legendaire b{color:#ffc46b;}
  .eng-decouvreur{padding:14px; border-radius:18px; border:1px solid var(--eng-bord); background:var(--eng-fond); margin:14px 0;}
  .eng-decouvreur .rang{display:flex; align-items:baseline; justify-content:space-between; gap:10px;}
  .eng-decouvreur .rang b{font-size:16px;}
  .eng-decouvreur .rang span{font-size:12px; color:var(--muted);}
  .eng-pepites{display:flex; gap:6px; margin-top:10px; overflow-x:auto; scrollbar-width:thin;}
  .eng-pepites button{all:unset; cursor:pointer; flex:none; width:56px; height:56px; border-radius:9px; overflow:hidden; background:#10151c;}
  .eng-pepites img{width:100%; height:100%; object-fit:cover;}

  /* ---- L'accès équipe ---- */
  .eng-eq{display:grid; gap:22px;}
  .eng-eq h4{margin:0 0 8px; font-size:15px;}
  .eng-eq .carte{padding:14px; border-radius:16px; border:1px solid var(--eng-bord); background:var(--eng-fond);}
  .eng-eq .ligne{display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin:6px 0;}
  .eng-eq input[type=text], .eng-eq input[type=date], .eng-eq select{
    box-sizing:border-box; padding:9px 11px; border-radius:10px; border:1px solid var(--line-strong); background:rgba(255,255,255,.06);
    color:var(--ink); font:inherit; font-size:14px; min-width:0;
  }
  .eng-eq input[type=color]{width:38px; height:34px; padding:2px; border-radius:8px; border:1px solid var(--line-strong); background:transparent;}
  .eng-eq .resultat{display:flex; align-items:center; gap:10px; padding:6px 0; border-top:1px solid var(--line);}
  .eng-eq .resultat img{width:38px; height:38px; border-radius:7px; object-fit:cover;}
  .eng-eq .resultat .tx{flex:1; min-width:0; font-size:13px;}
  .eng-eq .resultat .tx span{display:block; font-size:12px; color:var(--muted);}
  .eng-eq .duel-ligne{display:flex; align-items:center; gap:10px; padding:8px 0; border-top:1px solid var(--line); font-size:13px;}
  .eng-eq .duel-ligne:first-of-type{border-top:0;}
  .eng-eq .duel-ligne .tx{flex:1; min-width:0;}
  .eng-eq .duel-ligne .tx span{display:block; font-size:12px; color:var(--muted);}
  .eng-eq .msg{font-size:13px; margin:8px 0 0;} .eng-eq .msg.err{color:var(--danger);} .eng-eq .msg.ok{color:#7be0a4;}


  /* ---- La page Saison ---- */
  .eng-page{--eng-bord:rgba(255,255,255,.10); --eng-fond:rgba(255,255,255,.045); display:grid; gap:20px; padding-bottom:30px;}
  .eng-sec{margin:0; min-width:0;}
  .eng-sec-titre{display:flex; align-items:baseline; justify-content:space-between; margin:0 0 10px; font-size:12px; font-weight:600; letter-spacing:.14em; text-transform:uppercase; color:var(--muted);}
  .eng-sec-titre span{letter-spacing:0; text-transform:none; font-size:12px; font-variant-numeric:tabular-nums;}
  .eng-emoji{font-size:26px; line-height:1;}

  .eng-hero{
    position:relative; overflow:hidden; display:block; border-radius:24px; border:1px solid var(--eng-bord);
    background:linear-gradient(135deg, color-mix(in srgb, var(--s1) 38%, #0b0f15), color-mix(in srgb, var(--s3) 34%, #0b0f15));
  }
  .eng-hero-fond{display:block; width:100%; height:auto; margin-bottom:-1px; aspect-ratio:600 / 240; max-height:260px;}
  .eng-hero-contenu{position:relative; z-index:2; padding:60px 20px 20px; background:linear-gradient(transparent, rgba(8,4,16,.5) 40%);}
  .eng-hero.hw{background:#0b0614;}
  .eng-hero.hw .eng-hero-contenu{margin-top:-14px; padding-top:20px; background:none;}
  .eng-hero-eyebrow{font-size:11px; letter-spacing:.16em; text-transform:uppercase; color:rgba(255,255,255,.78);}
  .eng-hero-titre{margin:2px 0 12px; font-size:36px; line-height:1.05; font-weight:700; color:#fff; text-shadow:0 2px 18px rgba(0,0,0,.5);}
  .eng-hero-palier{display:flex; align-items:baseline; gap:6px; color:#fff;}
  .eng-hero-palier b{font-size:22px;}
  .eng-hero-palier span{color:rgba(255,255,255,.7);}
  .eng-hero-palier em{margin-left:auto; font-style:normal; font-size:13px; color:rgba(255,255,255,.88); font-variant-numeric:tabular-nums;}
  .eng-hero .eng-barre{margin-top:8px; background:rgba(255,255,255,.18);}
  .eng-hero.hw .eng-barre i{background:linear-gradient(90deg, #ff7a1a, #ffd166);}
  .eng-hero-suite{margin:8px 0 0; font-size:12.5px; color:rgba(255,255,255,.85);}
  .eng-puces{display:flex; flex-wrap:wrap; gap:6px; margin-top:12px;}
  .eng-puces span{padding:5px 10px; border-radius:99px; font-size:12px; color:#fff; background:rgba(255,255,255,.14); border:1px solid rgba(255,255,255,.18);}
  .eng-puces span.mult{background:color-mix(in srgb, var(--s2) 38%, transparent); border-color:var(--s2); font-weight:600;}

  .hw-etoile{animation:engScintille 3.2s ease-in-out infinite;}
  .hw-chauve{animation:engVol 17s linear infinite;}
  .hw-chauve .ailes{transform-box:fill-box; transform-origin:center; animation:engBat .45s ease-in-out infinite alternate;}
  .hw-lueur{animation:engLueur 2.4s ease-in-out infinite;}
  .hw-brume{animation:engBrume 24s linear infinite alternate;}
  @keyframes engScintille{0%,100%{opacity:.2;} 50%{opacity:1;}}
  @keyframes engVol{from{transform:translateX(-80px) translateY(0);} 50%{transform:translateX(340px) translateY(-16px);} to{transform:translateX(720px) translateY(8px);}}
  @keyframes engBat{from{transform:scaleY(1);} to{transform:scaleY(.4);}}
  @keyframes engLueur{0%,100%{opacity:.65;} 50%{opacity:1;}}
  @keyframes engBrume{from{transform:translateX(-7%);} to{transform:translateX(7%);}}

  .eng-evts{display:grid; gap:8px;}
  .eng-evt{display:flex; align-items:center; gap:12px; padding:12px 14px; border-radius:16px; border:1px solid var(--eng-bord); background:var(--eng-fond);}
  .eng-evt.actif{border-color:var(--s2); background:color-mix(in srgb, var(--s2) 14%, transparent); box-shadow:0 0 28px color-mix(in srgb, var(--s2) 22%, transparent);}
  .eng-evt .em{font-size:26px; flex:none; line-height:1;}
  .eng-evt .tx{flex:1; min-width:0;}
  .eng-evt .tx b{display:block; font-size:14px;}
  .eng-evt .tx small{display:block; margin-top:2px; font-size:12px; color:var(--muted); line-height:1.35;}
  .eng-evt .dt{text-align:right; flex:none;}
  .eng-evt .dt b{display:block; font-size:15px; color:var(--s2);}
  .eng-evt .dt small{display:block; font-size:11px; color:var(--muted);}

  .eng-citrouille{
    display:flex; align-items:center; gap:16px; padding:16px; border-radius:20px; border:1px solid var(--eng-bord);
    background:radial-gradient(120% 140% at 0% 50%, color-mix(in srgb, var(--s1) 24%, transparent), transparent 62%), var(--eng-fond);
  }
  .eng-citrouille-bouton{
    all:unset; box-sizing:border-box; cursor:pointer; flex:none; width:84px; height:84px; display:grid; place-items:center; font-size:58px; line-height:1;
    border-radius:50%; filter:drop-shadow(0 0 14px color-mix(in srgb, var(--s1) 70%, transparent)); transition:transform .25s var(--ease, ease);
  }
  .eng-citrouille-bouton:hover{transform:scale(1.07) rotate(-4deg);}
  .eng-citrouille-bouton:focus-visible{outline:2px solid var(--blue-bright); outline-offset:4px;}
  .eng-citrouille-bouton[disabled]{cursor:default; filter:grayscale(.5) brightness(.85);}
  .eng-citrouille-bouton[disabled]:hover{transform:none;}
  .eng-citrouille.secoue .eng-citrouille-bouton{animation:engSecoue .7s ease-in-out;}
  .eng-citrouille .tx{min-width:0;}
  .eng-citrouille .tx b{display:block; font-size:15px;}
  .eng-citrouille .tx p{margin:4px 0 0; font-size:13px; color:var(--ink-soft); line-height:1.4;}
  .eng-citrouille .gain{display:inline-flex; align-items:center; gap:8px; margin-top:8px; padding:5px 12px; border-radius:99px; font-size:13px; font-weight:600; background:color-mix(in srgb, var(--s2) 22%, transparent); border:1px solid var(--s2);}
  .eng-citrouille.gagne .gain{animation:engPop .5s var(--ease, ease) both;}
  @keyframes engSecoue{0%,100%{transform:rotate(0);} 15%{transform:rotate(-14deg) scale(1.08);} 35%{transform:rotate(12deg) scale(1.1);} 55%{transform:rotate(-9deg);} 75%{transform:rotate(6deg);}}
  @keyframes engPop{from{opacity:0; transform:scale(.6);} to{opacity:1; transform:none;}}

  .eng-chap{border-radius:16px; border:1px solid var(--eng-bord); background:var(--eng-fond); margin-bottom:8px; overflow:hidden;}
  .eng-chap.en_cours{border-color:color-mix(in srgb, var(--s2) 55%, transparent);}
  .eng-chap.a_venir{opacity:.72;}
  .eng-chap summary{list-style:none; display:flex; align-items:center; gap:12px; padding:12px 14px; cursor:pointer;}
  .eng-chap summary::-webkit-details-marker{display:none;}
  .eng-chap summary:focus-visible{outline:2px solid var(--blue-bright); outline-offset:-2px;}
  .eng-chap summary::after{content:'›'; transform:rotate(90deg); color:var(--muted); font-size:18px; line-height:1; transition:transform .25s;}
  .eng-chap[open] summary::after{transform:rotate(-90deg);}
  .eng-chap .num{width:28px; height:28px; flex:none; border-radius:50%; display:grid; place-items:center; font-size:13px; font-weight:700; background:rgba(255,255,255,.09);}
  .eng-chap.fait .num{background:var(--s2); color:#06101a;}
  .eng-chap .tx{flex:1; min-width:0;}
  .eng-chap .tx b{display:block; font-size:14px;}
  .eng-chap .tx small{display:block; font-size:12px; color:var(--muted);}
  .eng-chap .etat{font-size:12px; color:var(--muted); font-variant-numeric:tabular-nums;}
  .eng-chap-corps{padding:0 14px 14px;}
  .eng-chap-rec{display:flex; align-items:center; gap:12px; margin-top:10px; padding:10px 12px; border-radius:14px; border:1px dashed var(--eng-bord);}
  .eng-chap-rec.obtenu{border-style:solid; border-color:var(--s2);}
  .eng-chap-rec .v{width:44px; display:grid; place-items:center; flex:none;}
  .eng-chap-rec .tx b{display:block; font-size:13px;}
  .eng-chap-rec .tx small{display:block; font-size:11.5px; color:var(--muted);}

  .eng-piste{display:grid; grid-template-columns:repeat(auto-fill, minmax(88px, 1fr)); gap:8px;}
  .eng-tuile-r{
    all:unset; box-sizing:border-box; cursor:pointer; position:relative; display:flex; flex-direction:column; align-items:center; gap:6px;
    padding:22px 6px 8px; min-height:132px; border-radius:14px; border:1px solid var(--eng-bord); background:var(--eng-fond); text-align:center;
    transition:transform .2s var(--ease, ease), background .2s;
  }
  .eng-tuile-r:hover{transform:translateY(-2px); background:rgba(255,255,255,.08);}
  .eng-tuile-r:focus-visible{outline:2px solid var(--blue-bright); outline-offset:2px;}
  .eng-tuile-r .k{position:absolute; top:6px; left:9px; font-size:11px; font-weight:700; color:var(--muted);}
  .eng-tuile-r .visuel{flex:1; display:grid; place-items:center; min-height:42px; font-size:26px;}
  .eng-tuile-r .nom{font-size:10.5px; line-height:1.25; color:var(--ink-soft); display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; min-height:2.5em; max-width:100%;}
  .eng-tuile-r .pts{font-size:10px; color:var(--muted); font-variant-numeric:tabular-nums;}
  .eng-tuile-r:not(.atteint) .visuel{opacity:.55; filter:saturate(.6);}
  .eng-tuile-r.atteint{border-color:color-mix(in srgb, var(--s2) 60%, transparent); background:color-mix(in srgb, var(--s2) 9%, transparent);}
  .eng-tuile-r.atteint .k{color:var(--s2);}
  .eng-tuile-r.prochain{border-color:var(--ink-soft); animation:engPulseTuile 2.4s ease-in-out infinite;}
  .eng-tuile-r.choisi{box-shadow:0 0 0 2px var(--blue-bright);}
  .eng-tuile-r.rar-rare .nom{color:#7cc4ff;}
  .eng-tuile-r.rar-epique .nom{color:#c79bff;}
  .eng-tuile-r.rar-legendaire .nom{color:#ffc46b;}
  .eng-detail{margin-top:10px; padding:12px 14px; border-radius:14px; border:1px solid var(--eng-bord); background:var(--eng-fond); font-size:13px;}
  .eng-detail b{display:block; font-size:14px;}
  .eng-detail span{display:block; margin-top:2px; color:var(--muted);}
  .eng-speciales{display:grid; gap:8px;}
  .eng-spec{display:flex; align-items:center; gap:12px; padding:10px 12px; border-radius:14px; border:1px solid var(--eng-bord); background:var(--eng-fond);}
  .eng-spec.obtenu{border-color:var(--s2);}
  .eng-spec .v{width:44px; display:grid; place-items:center; flex:none;}
  .eng-spec .tx{min-width:0;}
  .eng-spec .tx b{display:block; font-size:13px;}
  .eng-spec .tx small{display:block; font-size:11.5px; color:var(--muted); line-height:1.35;}
  @keyframes engPulseTuile{0%,100%{box-shadow:0 0 0 0 transparent;} 50%{box-shadow:0 0 18px 0 color-mix(in srgb, var(--s2) 45%, transparent);}}

  .eng-rang{display:flex; align-items:center; gap:12px; padding:9px 12px; border-radius:14px; border:1px solid var(--eng-bord); background:var(--eng-fond); margin-bottom:6px;}
  .eng-rang.moi{border-color:var(--s2); background:color-mix(in srgb, var(--s2) 10%, transparent);}
  .eng-rang .n{width:26px; flex:none; text-align:center; font-weight:700; font-size:15px; font-variant-numeric:tabular-nums;}
  .eng-rang .tx{flex:1; min-width:0;}
  .eng-rang .tx b{display:block; font-size:14px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
  .eng-rang .tx small{display:block; font-size:11.5px; color:var(--muted);}
  .eng-rang .pts{font-size:13px; color:var(--ink-soft); font-variant-numeric:tabular-nums; white-space:nowrap;}
  .eng-bande.deux{grid-template-columns:repeat(2, 1fr);}


  /* ---- Le vestiaire ---- */
  .vst-voile{position:fixed; inset:0; z-index:420; display:flex; align-items:center; justify-content:center; background:rgba(3,5,8,.84); backdrop-filter:blur(14px); -webkit-backdrop-filter:blur(14px); animation:engVoile .25s ease both;}
  .vst{
    --eng-bord:rgba(255,255,255,.10); --eng-fond:rgba(255,255,255,.045);
    position:relative; width:min(1140px, 100vw); height:min(800px, 100dvh); display:grid; grid-template-columns:minmax(300px, 390px) minmax(0, 1fr); grid-template-rows:auto minmax(0, 1fr);
    border-radius:28px; overflow:hidden; border:1px solid var(--line-strong); color:var(--ink);
    background:radial-gradient(90% 60% at 0% 0%, rgba(124,92,255,.14), transparent 60%), radial-gradient(80% 60% at 100% 100%, rgba(255,160,64,.1), transparent 60%), #080b11;
    box-shadow:0 40px 140px rgba(0,0,0,.65); animation:engMonte .4s var(--ease, ease) both;
  }
  .vst .eng-barre{background:rgba(255,255,255,.12);}
  .vst .eng-barre i{background:linear-gradient(90deg, #ffb340, #ffd166);}
  .vst-attente{grid-column:1 / -1; grid-row:1 / -1; display:grid; place-content:center; text-align:center; color:var(--muted); font-size:14px;}
  .vst-tete{grid-column:1 / -1; display:flex; align-items:center; gap:14px; padding:16px 20px; border-bottom:1px solid var(--eng-bord);}
  .vst-anneau{width:48px; height:48px; flex:none; border-radius:50%; display:grid; place-items:center; background:conic-gradient(#ffb340 calc(var(--p) * 1%), rgba(255,255,255,.1) 0);}
  .vst-anneau b{width:38px; height:38px; border-radius:50%; display:grid; place-items:center; background:#0a0e15; font-size:13px; font-variant-numeric:tabular-nums;}
  .vst-anneau small{font-size:8px; margin-left:1px; color:var(--muted);}
  .vst-titre-bloc{flex:1; min-width:0;}
  .vst-titre-bloc h2{margin:0; font-size:20px; letter-spacing:.01em;}
  .vst-titre-bloc span{font-size:12px; color:var(--muted);}

  .vst-gauche{display:flex; flex-direction:column; gap:12px; padding:16px; overflow-y:auto; scrollbar-width:thin; border-right:1px solid var(--eng-bord); min-height:0;}
  .vst-droite{display:flex; flex-direction:column; min-width:0; min-height:0;}

  .vst-scene{
    position:relative; flex:none; height:300px; border-radius:22px; overflow:hidden; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:8px;
    border:1px solid color-mix(in srgb, var(--aura) 45%, transparent);
    background:radial-gradient(120% 90% at 50% 0%, color-mix(in srgb, var(--aura) 26%, #0d1220), #06080e 72%);
    box-shadow:inset 0 0 60px color-mix(in srgb, var(--aura) 14%, transparent);
  }
  .vst-lumiere{position:absolute; top:-30%; left:50%; width:150%; height:130%; transform:translateX(-50%); pointer-events:none; filter:blur(12px);
    background:conic-gradient(from 180deg at 50% 0, transparent 158deg, color-mix(in srgb, var(--aura) 26%, transparent) 180deg, transparent 202deg); animation:vstBalaye 7s ease-in-out infinite alternate;}
  .vst-poussieres i{position:absolute; bottom:-6px; left:var(--x); width:var(--z); height:var(--z); border-radius:50%; background:var(--aura); opacity:0; box-shadow:0 0 8px var(--aura); animation:vstMonte var(--d) linear var(--t) infinite;}
  .vst-socle{position:absolute; bottom:18px; left:50%; width:200px; height:44px; transform:translateX(-50%); border-radius:50%; border:1px solid color-mix(in srgb, var(--aura) 55%, transparent);
    background:radial-gradient(closest-side, color-mix(in srgb, var(--aura) 45%, transparent), transparent); box-shadow:0 0 36px color-mix(in srgb, var(--aura) 38%, transparent);}
  .vst-socle::after{content:''; position:absolute; inset:-7px; border-radius:50%; border:1px dashed color-mix(in srgb, var(--aura) 55%, transparent); animation:engTourne 22s linear infinite;}
  .vst-perso{position:relative; z-index:2; display:flex; flex-direction:column; align-items:center; gap:8px; margin-bottom:34px; transform:perspective(700px) rotateX(var(--rx, 0deg)) rotateY(var(--ry, 0deg)); transition:transform .18s ease-out;}
  .vst-avatar{filter:drop-shadow(0 8px 22px color-mix(in srgb, var(--aura) 40%, transparent)); animation:vstFlotte 4.5s ease-in-out infinite;}
  .vst-avatar .eng-av.cadre::before{inset:-9px;}
  .vst-nom{font-size:19px; font-weight:700; text-align:center; max-width:300px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
  .vst-vide{font-size:11px; color:var(--muted); letter-spacing:.06em;}
  .vst-apercu{position:absolute; top:12px; left:12px; z-index:3; padding:4px 10px; border-radius:99px; font-size:11px; font-weight:600; letter-spacing:.06em; text-transform:uppercase; background:rgba(0,0,0,.55); border:1px solid color-mix(in srgb, var(--aura) 60%, transparent); color:#fff;}
  .vst-burst{position:absolute; left:50%; top:46%; z-index:4; pointer-events:none;}
  .vst-burst i{position:absolute; width:7px; height:7px; margin:-3px; border-radius:50%; background:var(--c); box-shadow:0 0 10px var(--c); animation:vstJaillit .85s cubic-bezier(.12,.8,.3,1) both;}

  .vst-slots{display:grid; grid-template-columns:repeat(4, 1fr); gap:8px; flex:none;}
  .vst-slot{all:unset; box-sizing:border-box; cursor:pointer; display:flex; flex-direction:column; align-items:center; gap:2px; min-width:0; padding:8px 4px 7px; border-radius:14px; text-align:center;
    border:1px solid color-mix(in srgb, var(--rc) 55%, transparent); background:linear-gradient(170deg, color-mix(in srgb, var(--rc) 14%, #0c111a), #090d14); transition:transform .15s, box-shadow .15s;}
  .vst-slot:hover{transform:translateY(-2px); box-shadow:0 8px 20px color-mix(in srgb, var(--rc) 25%, transparent);}
  .vst-slot:focus-visible{outline:2px solid var(--blue-bright); outline-offset:2px;}
  .vst-slot.actif{box-shadow:0 0 0 2px var(--rc);}
  .vst-slot .ic{height:32px; display:grid; place-items:center; font-size:20px; opacity:.9;}
  .vst-slot:not(.plein) .ic{opacity:.45;}
  .vst-slot .lb{font-size:9.5px; letter-spacing:.1em; text-transform:uppercase; color:var(--muted);}
  .vst-slot b{max-width:100%; font-size:11px; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}

  .vst-com{flex:none; padding:12px; border-radius:16px; border:1px solid var(--eng-bord); background:var(--eng-fond);}
  .vst-com-tete{margin-bottom:8px; font-size:10.5px; letter-spacing:.14em; text-transform:uppercase; color:var(--muted);}
  .vst-com-msg{display:flex; gap:10px; align-items:flex-start;}
  .vst-com-msg .l{display:flex; align-items:center; flex-wrap:wrap; gap:6px; font-size:13.5px; font-weight:600;}
  .vst-com-msg .l small{font-weight:400; font-size:11px; color:var(--muted);}
  .vst-com-msg p{margin:3px 0 0; font-size:13px; color:var(--ink-soft); line-height:1.4;}
  .vst-rar{display:grid; gap:6px; flex:none;}
  .vst-rar-ligne{display:grid; grid-template-columns:78px 1fr 40px; align-items:center; gap:8px; font-size:11.5px; color:var(--ink-soft);}
  .vst-rar-ligne span{color:var(--rc);}
  .vst-rar-ligne em{font-style:normal; text-align:right; color:var(--muted); font-variant-numeric:tabular-nums;}
  .vst-rar-ligne .eng-barre{height:5px; margin:0;}
  .vst .vst-rar-ligne .eng-barre i{background:var(--rc);}

  .vst-vues{display:flex; gap:6px; padding:12px 16px 4px; flex:none;}
  .vst-vue{all:unset; box-sizing:border-box; cursor:pointer; padding:8px 16px; border-radius:99px; font-size:13px; font-weight:600; color:var(--muted); border:1px solid transparent;}
  .vst-vue:hover{color:var(--ink);}
  .vst-vue.actif{color:#06101a; background:var(--ink);}
  .vst-vue:focus-visible, .vst-type:focus-visible, .vst-puce:focus-visible, .vst-carte:focus-visible, .vst-coll:focus-visible{outline:2px solid var(--blue-bright); outline-offset:2px;}
  .vst-corps{flex:1; min-height:0; display:flex; flex-direction:column; padding:0 16px;}
  .vst-types{display:flex; gap:6px; padding:8px 0 4px; overflow-x:auto; scrollbar-width:none; flex:none;}
  .vst-type{all:unset; box-sizing:border-box; cursor:pointer; flex:none; display:flex; align-items:baseline; gap:6px; padding:7px 12px; border-radius:12px; font-size:13px; color:var(--ink-soft); border:1px solid var(--eng-bord); background:var(--eng-fond);}
  .vst-type em{font-style:normal; font-size:10.5px; color:var(--muted); font-variant-numeric:tabular-nums;}
  .vst-type.actif{color:var(--ink); background:rgba(255,255,255,.12); border-color:var(--line-strong);}
  .vst-filtres{display:flex; flex-wrap:wrap; gap:6px; padding:4px 0 10px; flex:none;}
  .vst-puce{all:unset; box-sizing:border-box; cursor:pointer; padding:5px 11px; border-radius:99px; font-size:12px; color:var(--muted); border:1px solid var(--eng-bord);}
  .vst-puce.actif{color:var(--ink); background:rgba(255,255,255,.1); border-color:var(--line-strong);}
  .vst-grille{flex:1; min-height:0; overflow-y:auto; scrollbar-width:thin; display:grid; grid-template-columns:repeat(auto-fill, minmax(124px, 1fr)); grid-auto-rows:min-content; gap:10px; padding:4px 2px 16px;}

  .vst .rar-commun{--rc:#9aa7b8;} .vst .rar-rare{--rc:#4aa8ff;} .vst .rar-epique{--rc:#b36bff;} .vst .rar-legendaire{--rc:#ffb340;}
  .vst-carte{
    all:unset; box-sizing:border-box; position:relative; cursor:pointer; display:flex; flex-direction:column; align-items:center; gap:5px; padding:16px 8px 10px; min-height:158px; border-radius:16px; text-align:center; overflow:hidden;
    border:1px solid color-mix(in srgb, var(--rc) 50%, transparent); background:linear-gradient(160deg, color-mix(in srgb, var(--rc) 17%, #0c111a), #090d14 72%);
    transition:transform .18s var(--ease, ease), box-shadow .18s;
  }
  .vst-carte:hover{transform:translateY(-3px); box-shadow:0 12px 28px color-mix(in srgb, var(--rc) 26%, transparent);}
  .vst-carte.sel{box-shadow:0 0 0 2px var(--rc), 0 14px 34px color-mix(in srgb, var(--rc) 32%, transparent);}
  .vst-carte.rar-legendaire::before{content:''; position:absolute; inset:0; pointer-events:none; background:linear-gradient(115deg, transparent 38%, rgba(255,255,255,.2) 50%, transparent 62%); background-size:260% 100%; animation:vstBrille 3.6s linear infinite;}
  .vst-carte.rar-epique{animation:vstPulse 3.2s ease-in-out infinite;}
  .vst-visuel{flex:1; display:grid; place-items:center; min-height:56px; max-width:100%;}
  .vst-carte b{font-size:12.5px; line-height:1.25; max-width:100%; overflow:hidden; text-overflow:ellipsis; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical;}
  .vst-carte small{font-size:10.5px; line-height:1.3; color:var(--rc); max-width:100%; overflow:hidden; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical;}
  .vst-carte.equipe{padding-bottom:26px;}
  .vst-carte.verrou small{color:var(--muted);}
  .vst-carte.verrou .vst-visuel{filter:grayscale(1) brightness(.55); opacity:.75;}
  .vst-carte.verrou{border-color:var(--eng-bord); background:#0a0e15;}
  .vst-src{position:absolute; top:6px; right:7px; font-size:12px; opacity:.75;}
  .vst-new{position:absolute; top:7px; left:7px; padding:2px 7px; border-radius:99px; font-size:9px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; color:#06101a; background:#7be0a4; animation:vstPulse 1.8s ease-in-out infinite;}
  .vst-equipe-tag{position:absolute; bottom:0; left:0; right:0; padding:3px 0; font-size:9.5px; font-weight:700; letter-spacing:.1em; text-transform:uppercase; color:#06101a; background:var(--rc);}
  .vst-emoji{line-height:1;}
  .vst-aa{font-weight:700;}
  .vst-titre{max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}

  .vst-detail{flex:none; display:flex; align-items:center; gap:14px; margin:0 16px 16px; padding:12px 14px; border-radius:18px; border:1px solid color-mix(in srgb, var(--rc, #fff) 50%, transparent); background:linear-gradient(135deg, color-mix(in srgb, var(--rc, #fff) 14%, #0c111a), #090d14);}
  .vst-detail.vide{--rc:#ffffff; justify-content:center; color:var(--muted); font-size:13px; border-style:dashed; min-height:84px;}
  .vst-detail.vide span{font-size:22px;}
  .vst-detail.vide p{margin:0;}
  .vst-detail-visuel{width:70px; flex:none; display:grid; place-items:center;}
  .vst-detail .tx{flex:1; min-width:0;}
  .vst-rar-nom{display:block; font-size:10.5px; letter-spacing:.1em; text-transform:uppercase; color:var(--rc);}
  .vst-detail .tx b{display:block; font-size:16px; margin-top:1px;}
  .vst-detail .tx p{margin:3px 0 0; font-size:12.5px; color:var(--ink-soft); line-height:1.4;}
  .vst-detail .tx small{display:block; margin-top:4px; font-size:11.5px; color:var(--muted);}
  .vst-detail .tx .msg{color:#7be0a4;}
  .vst-detail .act{flex:none;}

  .vst-collections{flex:1; min-height:0; overflow-y:auto; scrollbar-width:thin; display:grid; gap:10px; padding:10px 2px 16px; grid-auto-rows:min-content;}
  .vst-coll{all:unset; box-sizing:border-box; cursor:pointer; display:block; padding:14px; border-radius:18px; border:1px solid var(--eng-bord); background:var(--eng-fond); transition:background .18s, transform .18s;}
  .vst-coll:hover{background:rgba(255,255,255,.08); transform:translateY(-2px);}
  .vst-coll.complet{border-color:#ffb340; background:rgba(255,179,64,.07);}
  .vst-coll-tete{display:flex; align-items:center; gap:10px; margin-bottom:8px;}
  .vst-coll-tete span{font-size:20px;}
  .vst-coll-tete b{flex:1; font-size:15px;}
  .vst-coll-tete em{font-style:normal; font-size:12px; color:var(--muted); font-variant-numeric:tabular-nums;}
  .vst-coll-mini{display:flex; flex-wrap:wrap; gap:6px; margin-top:12px;}
  .vst-coll-mini span{width:38px; height:38px; display:grid; place-items:center; border-radius:10px; overflow:hidden; border:1px solid color-mix(in srgb, var(--rc) 55%, transparent); background:color-mix(in srgb, var(--rc) 10%, #0a0e15);}
  .vst-coll-mini span.verrou{filter:grayscale(1) brightness(.5);}
  .vst-coll-mini .eng-av{--t:26px !important;}

  .vst-statut{padding:10px 2px 16px; overflow-y:auto; min-height:0; scrollbar-width:thin;}
  .vst-statut-haut{display:flex; align-items:center; gap:14px; padding:16px; border-radius:20px; border:1px solid rgba(143,216,255,.4); background:linear-gradient(135deg, rgba(143,216,255,.14), rgba(124,92,255,.1));}
  .vst-statut-gem{font-size:34px; filter:drop-shadow(0 0 12px rgba(143,216,255,.7));}
  .vst-statut-haut > div{flex:1;}
  .vst-statut-haut small{display:block; font-size:11px; letter-spacing:.12em; text-transform:uppercase; color:var(--muted);}
  .vst-statut-haut b{font-size:20px;}
  .vst-statut-haut em{font-style:normal; font-size:13px; color:var(--ink-soft);}
  .vst-echelle{display:grid; grid-template-columns:repeat(4, 1fr); gap:8px; margin:14px 0 4px;}
  .vst-marche{display:flex; flex-direction:column; align-items:center; gap:6px; padding:12px 6px; border-radius:14px; border:1px solid var(--eng-bord); background:var(--eng-fond); text-align:center; font-size:11.5px; color:var(--muted);}
  .vst-marche i{width:30px; height:30px; display:grid; place-items:center; border-radius:50%; font-style:normal; font-weight:700; background:rgba(255,255,255,.08);}
  .vst-marche.fait{border-color:#8fd8ff; color:var(--ink);}
  .vst-marche.fait i{background:#8fd8ff; color:#06101a;}

  @keyframes vstBalaye{from{transform:translateX(-56%) rotate(-5deg);} to{transform:translateX(-44%) rotate(5deg);}}
  @keyframes vstMonte{0%{transform:translateY(0); opacity:0;} 12%{opacity:.85;} 100%{transform:translateY(-300px); opacity:0;}}
  @keyframes vstFlotte{0%,100%{transform:translateY(0);} 50%{transform:translateY(-7px);}}
  @keyframes vstBrille{from{background-position:130% 0;} to{background-position:-130% 0;}}
  @keyframes vstPulse{0%,100%{filter:brightness(1);} 50%{filter:brightness(1.18);}}
  @keyframes vstJaillit{from{transform:translate(0, 0) scale(1.2); opacity:1;} to{transform:translate(var(--dx), var(--dy)) scale(.2); opacity:0;}}

  @media (max-width:820px){
    .vst{width:100vw; height:100dvh; border-radius:0; border:0; grid-template-columns:minmax(0, 1fr); grid-template-rows:auto auto minmax(0, 1fr);}
    .vst-gauche{border-right:0; border-bottom:1px solid var(--eng-bord); padding:10px 12px; gap:8px; overflow:visible;}
    .vst-scene{height:200px;}
    .vst-perso{margin-bottom:22px; gap:5px;}
    .vst-avatar .eng-av{--t:84px !important;}
    .vst-nom{font-size:16px;}
    .vst-socle{width:150px; height:32px; bottom:12px;}
    .vst-com, .vst-rar{display:none;}
    .vst-slot .ic{height:26px;}
    .vst-grille{grid-template-columns:repeat(3, minmax(0, 1fr)); gap:8px;}
    .vst-carte{min-height:140px; padding:14px 5px 9px;}
    .vst-detail{margin:0 10px 10px; gap:10px; padding:10px;}
    .vst-detail .tx p{display:none;}
    .vst-detail-visuel{width:50px;}
    .vst-corps{padding:0 10px;}
    .vst-vues{padding:10px 10px 2px;}
  }
  @media (prefers-reduced-motion:reduce){
    .vst-lumiere, .vst-poussieres i, .vst-socle::after, .vst-avatar, .vst-carte.rar-legendaire::before, .vst-carte.rar-epique, .vst-new, .vst-burst i{animation:none !important;}
    .vst-perso{transition:none;}
  }

  @keyframes engVoile{from{opacity:0;} to{opacity:1;}}
  @keyframes engMonte{from{opacity:0; transform:translateY(24px);} to{opacity:1; transform:none;}}
  @keyframes engTourne{to{transform:rotate(360deg);}}
  @keyframes engPulse{0%,100%{opacity:.75; filter:blur(0);} 50%{opacity:1; filter:blur(1.5px);}}
  @media (prefers-reduced-motion:reduce){
    .eng-voile, .eng-feuille, .eng-av.cadre::before{animation:none !important;}
    .hw-etoile, .hw-chauve, .hw-chauve .ailes, .hw-lueur, .hw-brume, .eng-tuile-r.prochain, .eng-citrouille.secoue .eng-citrouille-bouton{animation:none !important;}
    .eng-barre i, .eng-puce, .eng-cote{transition:none;}
  }
  @media (max-width:420px){
    .eng-bande{grid-template-columns:1fr; }
    .eng-tuiles{grid-template-columns:repeat(2, 1fr);}
  }`;

  function poserFeuille(){
    if(document.getElementById('eng-feuille')) return;
    const s = document.createElement('style');
    s.id = 'eng-feuille';
    s.textContent = FEUILLE;
    document.head.appendChild(s);
  }

  // ---------------------------------------------------------------------
  // Des morceaux réutilisés
  // ---------------------------------------------------------------------

  function teinte(texte){
    let h = 0;
    const t = String(texte || '?');
    for(let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) % 360;
    return h;
  }

  // Un avatar (photo ou initiale) avec, si on en donne un, un cadre.
  function avatarApercu(pseudo, photo, cadre, taille){

    const c = cadre && typeof cadre === 'object' ? cadre : null;
    const anim = c && (c.anim === 'tourne' || c.anim === 'pulse') ? ' ' + c.anim : '';
    const vars = c
      ? `--ca:${hexa(c.a, '#ffffff')};--cb:${hexa(c.b, '#ffffff')};--cc:${hexa(c.c || c.a, '#ffffff')};`
      : '';
    const p = safeUrl(photo);

    return `<span class="eng-av${c ? ' cadre' + anim : ''}" style="--t:${taille || 44}px;--h:${teinte(pseudo)};${vars}">${
      p ? `<img src="${esc(p)}" alt="" loading="lazy">` : `<b>${esc(String(pseudo || '?').trim().charAt(0).toUpperCase())}</b>`
    }</span>`;
  }

  function nomApercu(pseudo, couleur, embleme){
    const emb = embleme ? ` <span class="eng-emoji" style="font-size:14px">${esc(embleme)}</span>` : '';
    if(couleur && typeof couleur === 'object'){
      return `<span class="eng-nom-couleur" style="--na:${hexa(couleur.a, '#ffffff')};--nb:${hexa(couleur.b, '#ffffff')}">${esc(pseudo)}</span>${emb}`;
    }
    return esc(pseudo) + emb;
  }

  function reste(fin){
    const ms = new Date(fin).getTime() - Date.now();
    if(ms <= 0) return 'Terminé';
    const m = Math.floor(ms / 60000);
    if(m < 60) return 'Fin dans ' + Math.max(m, 1) + ' min';
    const h = Math.floor(m / 60);
    if(h < 48) return 'Fin dans ' + h + ' h';
    return 'Fin dans ' + Math.floor(h / 24) + ' j';
  }

  function erreurTexte(e){
    return (e && e.message) ? e.message : 'Une erreur est survenue. Réessaie dans un instant.';
  }

  // ---------------------------------------------------------------------
  // La feuille : une fenêtre qui monte du bas (centrée sur grand écran)
  // ---------------------------------------------------------------------

  let feuilleOuverte = null;

  function ouvrirFeuille(titre){

    poserFeuille();
    if(feuilleOuverte) feuilleOuverte.fermer();

    const voile = document.createElement('div');
    voile.className = 'eng-voile';
    voile.innerHTML = `
      <div class="eng-feuille" role="dialog" aria-modal="true" aria-label="${esc(titre)}">
        <div class="eng-feuille-tete"><h2>${esc(titre)}</h2><button type="button" class="eng-fermer" aria-label="Fermer">×</button></div>
        <div class="eng-corps"></div>
      </div>`;

    const precedent = document.activeElement;
    const avant = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    document.body.appendChild(voile);

    const corps = voile.querySelector('.eng-corps');
    const bouton = voile.querySelector('.eng-fermer');

    function fermer(){
      if(!voile.parentNode) return;
      voile.remove();
      document.documentElement.style.overflow = avant;
      document.removeEventListener('keydown', touche);
      if(feuilleOuverte && feuilleOuverte.voile === voile) feuilleOuverte = null;
      if(precedent && precedent.focus) try{ precedent.focus(); }catch(e){}
    }

    function touche(ev){ if(ev.key === 'Escape') fermer(); }

    bouton.addEventListener('click', fermer);
    voile.addEventListener('click', (ev) => { if(ev.target === voile) fermer(); });
    document.addEventListener('keydown', touche);
    bouton.focus();

    feuilleOuverte = { voile, corps, fermer };
    return feuilleOuverte;
  }

  // ---------------------------------------------------------------------
  // Le duel
  // ---------------------------------------------------------------------

  function coteHtml(duel, cote){

    const s = duel[cote];
    const votes = duel.votes;
    const total = votes ? (votes.a + votes.b) : 0;
    const pc = votes && total ? Math.round(votes[cote] / total * 100) : 0;
    const choisi = duel.mon_vote === cote;
    const aVote = !!duel.mon_vote;
    const fini = !duel.actif;

    return `
      <button type="button" class="eng-cote${choisi ? ' choisi' : ''}" data-choix="${cote}" ${aVote || fini ? 'disabled' : ''}
        aria-label="Voter pour ${esc(s.titre)} de ${esc(s.artiste)}">
        <span class="eng-pochette">
          <img src="${esc(safeUrl(s.cover))}" alt="" loading="lazy">
          <span class="eng-pourcent">${votes ? pc + ' %' : ''}</span>
        </span>
        <b>${esc(s.titre)}</b>
        <small>${esc(s.artiste)}</small>
      </button>`;
  }

  function duelHtml(duel){

    const aVote = !!duel.mon_vote;
    const total = duel.total || 0;

    return `
      <section class="eng-duel${aVote ? ' vote' : ''}${duel.actif ? '' : ' fini'}" data-duel="${esc(duel.id)}">
        <div class="eng-duel-tete">
          <span class="eng-eyebrow">${esc(duel.titre || 'Duel de sorties')}</span>
          <span class="eng-reste">${esc(reste(duel.fin))}</span>
        </div>
        <div class="eng-duel-grille">
          ${coteHtml(duel, 'a')}
          <span class="eng-vs" aria-hidden="true">VS</span>
          ${coteHtml(duel, 'b')}
        </div>
        <div class="eng-duel-pied">
          <span>${aVote || !duel.actif
            ? nf(total) + ' vote' + (total > 1 ? 's' : '')
            : (total ? nf(total) + ' vote' + (total > 1 ? 's' : '') + ' · ' : '') + 'Vote pour ta préférée'}</span>
          <span><a data-fiche="${esc(duel.a.numero)}">Fiche A</a> · <a data-fiche="${esc(duel.b.numero)}">Fiche B</a></span>
        </div>
        <p class="eng-erreur" data-erreur hidden></p>
      </section>`;
  }

  // Branche un duel déjà dessiné : le vote, les fiches.
  function brancherDuel(hote, duel, apres){

    const racine = hote.querySelector('[data-duel="' + duel.id + '"]');
    if(!racine) return;

    racine.addEventListener('click', async (ev) => {

      const fiche = ev.target.closest('[data-fiche]');
      if(fiche){
        if(feuilleOuverte) feuilleOuverte.fermer();
        if(typeof ouvrirSortieParNumero === 'function') ouvrirSortieParNumero(fiche.dataset.fiche);
        return;
      }

      const cote = ev.target.closest('[data-choix]');
      if(!cote || cote.disabled) return;

      racine.querySelectorAll('[data-choix]').forEach(b => { b.disabled = true; });
      const msg = racine.querySelector('[data-erreur]');
      msg.hidden = true;

      const { data, error } = await BD.duelVoter(duel.id, cote.dataset.choix);

      if(error || !data){
        msg.textContent = erreurTexte(error);
        msg.hidden = false;
        racine.querySelectorAll('[data-choix]').forEach(b => { b.disabled = false; });
        return;
      }

      Object.assign(duel, data);
      racine.outerHTML = duelHtml(duel);
      brancherDuel(hote, duel, apres);

      if(window.Xp && window.Xp.apres) window.Xp.apres(500);
      if(apres) apres(duel);
    });
  }

  // ---------------------------------------------------------------------
  // Ouvrir un morceau précis (le panneau d'XP, les notifications)
  // ---------------------------------------------------------------------

  function ouvrir(quoi, option){
    if(quoi === 'semaine') return semaine(option === undefined ? 1 : option);
    if(quoi === 'saison') return typeof ouvrirSaison === 'function' ? ouvrirSaison() : undefined;
    if(quoi === 'garderobe') return garderobe();
    if(quoi === 'duel') return duel(option);
  }

  // Un duel dans sa propre fenêtre (depuis une notification).
  async function duel(id){

    const f = ouvrirFeuille('Duel de sorties');
    f.corps.innerHTML = '<div class="eng-vide">Chargement…</div>';

    const { data, error } = await BD.duelsListe();
    if(error){ f.corps.innerHTML = `<div class="eng-vide">${esc(erreurTexte(error))}</div>`; return; }

    const liste = Array.isArray(data) ? data : [];
    const d = liste.find(x => x.id === id) || liste[0];

    if(!d){ f.corps.innerHTML = '<div class="eng-vide">Aucun duel pour le moment.</div>'; return; }

    f.corps.innerHTML = duelHtml(d) + (d.actif ? '' : '<p class="eng-note">Ce duel est terminé.</p>');
    brancherDuel(f.corps, d);
  }

  // ---------------------------------------------------------------------
  // Ma semaine
  // ---------------------------------------------------------------------

  function profilSemaine(r){

    const n = (r.notes && r.notes.nombre) || 0;
    const score = {
      'Semaine d\'exploration': (r.decouvertes || 0) + (r.ecoutes || 0),
      'Semaine de critique': n + (r.avis || 0) * 2,
      'Semaine de communauté': (r.posts || 0) * 2 + (r.commentaires || 0) + (r.reactions_recues || 0),
      'Semaine d\'assiduité': (r.jours_actifs || 0) * 2,
      'Semaine dans l\'arène': (r.duels || 0) * 2
    };

    let meilleur = 'Semaine tranquille';
    let max = 0;
    Object.keys(score).forEach((k) => { if(score[k] > max){ max = score[k]; meilleur = k; } });
    return meilleur;
  }

  function semaineHtml(r){

    if(!r || !r.actif){
      return `<div class="eng-vide">Rien à raconter ${r && r.en_cours ? 'pour l\'instant' : 'cette semaine-là'}.<br>Note une sortie, vote à un duel ou écoute un nouveau projet : ta semaine se remplit toute seule.</div>`;
    }

    const notes = r.notes || {};
    const delta = r.xp_avant > 0 ? Math.round((r.xp - r.xp_avant) / r.xp_avant * 100) : null;
    const ecart = notes.ecart_communaute;

    const tuiles = [
      [notes.nombre || 0, 'Notes'], [r.ecoutes || 0, 'Écoutes'], [r.avis || 0, 'Avis'],
      [r.decouvertes || 0, 'Découvertes'], [r.duels || 0, 'Duels votés'], [(r.jours_actifs || 0) + '/7', 'Jours actifs']
    ].map(t => `<div class="eng-tuile"><b>${esc(t[0])}</b><span>${esc(t[1])}</span></div>`).join('');

    let top = '';
    if(notes.top){
      top = `
        <div class="eng-titre-bloc">Ta meilleure note</div>
        <div class="eng-ligne-sortie">
          <img src="${esc(safeUrl(notes.top.cover))}" alt="">
          <div class="tx"><b>${esc(notes.top.titre)}</b><span>${esc(notes.top.artiste)}</span></div>
          <span class="note">${esc(etoiles(notes.top.note))} ★</span>
        </div>`;
    }

    const faits = [];
    if(r.artiste && r.artiste.nom) faits.push(`Ton artiste de la semaine : <b>${esc(r.artiste.nom)}</b>`);
    if(notes.moyenne) faits.push(`Moyenne de tes notes : <b>${esc(etoiles(notes.moyenne))} ★</b>`);
    if(ecart !== null && ecart !== undefined){
      const e = Math.abs(ecart) / 2;
      faits.push(Math.abs(ecart) < 0.8 ? 'Tes notes collent à celles de la communauté.'
        : `Tu notes en moyenne <b>${esc(String(e.toFixed(1)).replace('.', ','))} ★</b> ${ecart > 0 ? 'au-dessus' : 'en dessous'} de la communauté.`);
    }
    if(r.reactions_recues) faits.push(`<b>${nf(r.reactions_recues)}</b> réaction${r.reactions_recues > 1 ? 's' : ''} reçue${r.reactions_recues > 1 ? 's' : ''}.`);
    if(r.pepites) faits.push(`<b>${nf(r.pepites)}</b> pépite${r.pepites > 1 ? 's' : ''} repérée${r.pepites > 1 ? 's' : ''} avant tout le monde.`);
    if(r.serie > 1) faits.push(`Série en cours : <b>${nf(r.serie)}</b> jours de suite.`);

    const succes = (r.succes || []).length
      ? `<div class="eng-titre-bloc">Succès de la semaine</div><div class="eng-succes">${r.succes.map(s => `<span>${esc(s.icone)} ${esc(s.nom)}</span>`).join('')}</div>`
      : '';

    return `
      <div class="eng-semaine-haut">
        <div class="dates">${esc(jourCourt(r.debut))} – ${esc(jourCourt(r.fin))}${r.en_cours ? ' · en cours' : ''}</div>
        <p class="profil">${esc(profilSemaine(r))}</p>
        <p class="eng-gros">+${nf(r.xp)}<small>XP</small></p>
        ${delta === null ? '' : `<p class="eng-delta">${delta >= 0 ? '↑' : '↓'} ${Math.abs(delta)} % par rapport à la semaine précédente</p>`}
      </div>
      <div class="eng-tuiles">${tuiles}</div>
      ${faits.length ? `<ul class="eng-note" style="padding-left:18px;margin:0 0 12px">${faits.map(f => `<li>${f}</li>`).join('')}</ul>` : ''}
      ${top}${succes}
      <div class="eng-partage"><button type="button" class="eng-btn" data-partager>Partager mon résumé</button></div>
      <p class="eng-note" data-partage-msg hidden></p>`;
  }

  // L'image à partager : 1080 × 1350, les chiffres de la semaine.
  async function imageSemaine(r, avecPochette){

    const L = 1080, H = 1350;
    const toile = document.createElement('canvas');
    toile.width = L; toile.height = H;
    const g = toile.getContext('2d');

    const fond = g.createLinearGradient(0, 0, L, H);
    fond.addColorStop(0, '#0b1a2b'); fond.addColorStop(0.55, '#0b0f15'); fond.addColorStop(1, '#2a1a0e');
    g.fillStyle = fond; g.fillRect(0, 0, L, H);

    const halo = g.createRadialGradient(200, 160, 20, 200, 160, 620);
    halo.addColorStop(0, 'rgba(79,180,255,.40)'); halo.addColorStop(1, 'rgba(79,180,255,0)');
    g.fillStyle = halo; g.fillRect(0, 0, L, H);

    const police = '"Inter","Helvetica Neue",Arial,sans-serif';
    g.textBaseline = 'alphabetic';

    g.fillStyle = 'rgba(255,255,255,.62)'; g.font = `600 30px ${police}`;
    g.fillText('LA WAVE · MA SEMAINE', 80, 120);
    g.font = `400 30px ${police}`;
    g.fillText(`${jourCourt(r.debut)} – ${jourCourt(r.fin)}`, 80, 166);

    g.fillStyle = '#fff'; g.font = `700 150px ${police}`;
    g.fillText('+' + nf(r.xp), 80, 360);
    g.fillStyle = 'rgba(255,255,255,.62)'; g.font = `500 44px ${police}`;
    g.fillText('XP gagnés', 80, 424);

    g.fillStyle = '#fff'; g.font = `600 44px ${police}`;
    g.fillText(profilSemaine(r), 80, 520);

    const notes = r.notes || {};
    const cases = [
      [notes.nombre || 0, 'notes'], [r.ecoutes || 0, 'écoutes'], [r.duels || 0, 'duels'],
      [r.decouvertes || 0, 'découvertes'], [r.avis || 0, 'avis'], [(r.jours_actifs || 0) + '/7', 'jours actifs']
    ];
    cases.forEach((c, i) => {
      const x = 80 + (i % 3) * 300;
      const y = 600 + Math.floor(i / 3) * 170;
      g.fillStyle = 'rgba(255,255,255,.07)';
      g.beginPath(); g.roundRect ? g.roundRect(x, y, 276, 142, 26) : g.rect(x, y, 276, 142); g.fill();
      g.fillStyle = '#fff'; g.font = `700 64px ${police}`; g.fillText(String(c[0]), x + 26, y + 80);
      g.fillStyle = 'rgba(255,255,255,.6)'; g.font = `400 28px ${police}`; g.fillText(c[1], x + 26, y + 120);
    });

    if(notes.top){
      g.fillStyle = 'rgba(255,255,255,.6)'; g.font = `600 26px ${police}`;
      g.fillText('MA MEILLEURE NOTE', 80, 990);

      if(avecPochette && notes.top.cover){
        try{
          const img = await new Promise((ok, ko) => {
            const i = new Image();
            i.crossOrigin = 'anonymous';
            i.onload = () => ok(i); i.onerror = ko;
            i.src = notes.top.cover;
          });
          g.save(); g.beginPath(); g.roundRect ? g.roundRect(80, 1020, 190, 190, 22) : g.rect(80, 1020, 190, 190); g.clip();
          g.drawImage(img, 80, 1020, 190, 190); g.restore();
        }catch(e){
          throw e;
        }
      }

      const x = avecPochette && notes.top.cover ? 300 : 80;
      g.fillStyle = '#fff'; g.font = `700 46px ${police}`;
      g.fillText(String(notes.top.titre).slice(0, 26), x, 1090);
      g.fillStyle = 'rgba(255,255,255,.62)'; g.font = `400 34px ${police}`;
      g.fillText(String(notes.top.artiste).slice(0, 30), x, 1142);
      g.fillStyle = '#ffc46b'; g.font = `700 44px ${police}`;
      g.fillText(etoiles(notes.top.note) + ' ★', x, 1200);
    }

    g.fillStyle = 'rgba(255,255,255,.45)'; g.font = `400 28px ${police}`;
    g.fillText('lawave.fr', 80, 1290);

    return new Promise((ok, ko) => {
      try{ toile.toBlob((b) => (b ? ok(b) : ko(new Error('image'))), 'image/png'); }catch(e){ ko(e); }
    });
  }

  async function partager(r, msg){

    msg.hidden = false;
    msg.textContent = 'Préparation de l\'image…';

    let blob;
    try{
      blob = await imageSemaine(r, true);
    }catch(e){
      try{ blob = await imageSemaine(r, false); }catch(e2){ msg.textContent = 'Impossible de créer l\'image sur cet appareil.'; return; }
    }

    const fichier = new File([blob], 'ma-semaine-la-wave.png', { type: 'image/png' });

    try{
      if(navigator.canShare && navigator.canShare({ files: [fichier] })){
        await navigator.share({ files: [fichier], title: 'Ma semaine sur La Wave' });
        msg.textContent = 'Partagé.';
        return;
      }
    }catch(e){
      if(e && e.name === 'AbortError'){ msg.hidden = true; return; }
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'ma-semaine-la-wave.png';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    msg.textContent = 'Image enregistrée : tu peux la publier où tu veux.';
  }

  async function semaine(decalage){

    const f = ouvrirFeuille('Ma semaine');
    let courant = decalage === 0 ? 0 : 1;

    f.corps.innerHTML = `
      <div class="eng-onglets" role="tablist">
        <button type="button" class="eng-onglet" role="tab" data-dec="1">Semaine dernière</button>
        <button type="button" class="eng-onglet" role="tab" data-dec="0">Cette semaine</button>
      </div>
      <div data-contenu></div>`;

    const contenu = f.corps.querySelector('[data-contenu]');
    const onglets = f.corps.querySelectorAll('[data-dec]');

    async function charger(dec){

      courant = dec;
      onglets.forEach(o => o.setAttribute('aria-selected', String(Number(o.dataset.dec) === dec)));
      contenu.innerHTML = '<div class="eng-vide">Chargement…</div>';

      const { data, error } = await BD.resumeSemaine(dec);

      if(error){ contenu.innerHTML = `<div class="eng-vide">${esc(erreurTexte(error))}</div>`; return; }

      contenu.innerHTML = semaineHtml(data);

      const bouton = contenu.querySelector('[data-partager]');
      if(bouton) bouton.addEventListener('click', () => partager(data, contenu.querySelector('[data-partage-msg]')));
    }

    onglets.forEach(o => o.addEventListener('click', () => charger(Number(o.dataset.dec))));
    charger(courant);
  }

  // ---------------------------------------------------------------------
  // La page Saison : l'onglet de la communauté
  // ---------------------------------------------------------------------

  const CITROUILLE = {
    halloween: {
      titre: 'La citrouille du jour',
      invite: "Touche-la : une surprise t'attend chaque jour, et elle compte pour la saison.",
      lots: { bonbon: ['Une poignée de bonbons', '🍬'], friandise: ['Un sac de friandises', '🍭'], sortilege: ["Un sortilège t'enveloppe", '🔮'], tresor: ['Le trésor de la citrouille hantée', '👑'] }
    },
    defaut: {
      titre: 'La surprise du jour',
      invite: 'Ouvre-la : un bonus de points de saison t\'attend chaque jour.',
      lots: { bonbon: ['Un petit coup de pouce', '✨'], friandise: ['Un joli bonus', '🎁'], sortilege: ['Un gros bonus', '💫'], tresor: ['Le jackpot', '👑'] }
    }
  };

  // Le décor d'Halloween : un ciel, une lune, des chauves-souris, des citrouilles qui brillent. Pur dessin, rien à charger.
  const HERO_HALLOWEEN = `
    <svg class="eng-hero-fond" viewBox="0 30 600 240" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="hwCiel" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#120a26"/><stop offset=".55" stop-color="#2b1250"/><stop offset="1" stop-color="#7a2a3e"/></linearGradient>
        <radialGradient id="hwHalo" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#ffe6a8" stop-opacity=".9"/><stop offset=".5" stop-color="#ffb347" stop-opacity=".25"/><stop offset="1" stop-color="#ffb347" stop-opacity="0"/></radialGradient>
        <symbol id="hwCitrouille" viewBox="-30 -30 60 54">
          <ellipse cx="-11" cy="0" rx="14" ry="18" fill="#c4510a"/><ellipse cx="11" cy="0" rx="14" ry="18" fill="#c4510a"/>
          <ellipse cx="0" cy="0" rx="14" ry="19" fill="#ee6c10"/>
          <path d="M-2 -18 q2 -9 9 -10" stroke="#4d7c2a" stroke-width="3.4" fill="none" stroke-linecap="round"/>
          <g class="hw-lueur" fill="#ffd34d"><path d="M-11 -4 l5 -8 l5 8z M3 -4 l5 -8 l5 8z"/><path d="M-12 5 q12 12 24 0 l-4 -4 l-4 4 l-4 -4 l-4 4 l-4 -4z"/></g>
        </symbol>
      </defs>
      <rect width="600" height="270" fill="url(#hwCiel)"/>
      <g fill="#fff">
        <circle class="hw-etoile" cx="38" cy="34" r="1.5"/><circle class="hw-etoile" style="animation-delay:.7s" cx="112" cy="70" r="1"/>
        <circle class="hw-etoile" style="animation-delay:1.4s" cx="188" cy="28" r="1.3"/><circle class="hw-etoile" style="animation-delay:2.1s" cx="262" cy="84" r="1"/>
        <circle class="hw-etoile" style="animation-delay:.3s" cx="330" cy="40" r="1.4"/><circle class="hw-etoile" style="animation-delay:1.1s" cx="402" cy="112" r="1"/>
        <circle class="hw-etoile" style="animation-delay:1.8s" cx="560" cy="30" r="1.3"/><circle class="hw-etoile" style="animation-delay:2.5s" cx="590" cy="120" r="1"/>
      </g>
      <circle cx="472" cy="78" r="98" fill="url(#hwHalo)"/>
      <circle cx="472" cy="78" r="40" fill="#fff1c9"/>
      <g fill="#e6cd92" opacity=".55"><circle cx="459" cy="67" r="8"/><circle cx="487" cy="91" r="5.5"/><circle cx="473" cy="58" r="3.2"/></g>
      <g class="hw-brume" opacity=".55"><ellipse cx="150" cy="236" rx="210" ry="28" fill="#b9a4ff" opacity=".24"/><ellipse cx="470" cy="246" rx="230" ry="26" fill="#ff9d6b" opacity=".2"/></g>
      <path d="M0 224 Q70 196 150 216 T320 212 T470 218 T600 208 V270 H0z" fill="#0b0614"/>
      <path d="M58 226 L62 156 L50 128 M62 156 L80 132 M60 178 L40 160 M62 146 L74 114 M52 138 L40 120" stroke="#0b0614" stroke-width="6" stroke-linecap="round" fill="none"/>
      <use href="#hwCitrouille" x="96" y="204" width="58" height="52"/>
      <use href="#hwCitrouille" x="146" y="216" width="40" height="36"/>
      <use href="#hwCitrouille" x="520" y="208" width="64" height="58"/>
      <g class="hw-chauve"><g transform="translate(0 52)"><g class="ailes"><path d="M0 0c-3-3-8-3-13 1 3-1 5 0 6 3 2-2 4-2 5 1l2-2 2 2c1-3 3-3 5-1 1-3 3-4 6-3-5-4-10-4-13-1z" fill="#0b0614"/></g></g></g>
      <g class="hw-chauve" style="animation-delay:-6s;animation-duration:21s"><g transform="translate(0 96) scale(1.35)"><g class="ailes"><path d="M0 0c-3-3-8-3-13 1 3-1 5 0 6 3 2-2 4-2 5 1l2-2 2 2c1-3 3-3 5-1 1-3 3-4 6-3-5-4-10-4-13-1z" fill="#0b0614"/></g></g></g>
      <g class="hw-chauve" style="animation-delay:-11s;animation-duration:15s"><g transform="translate(0 30) scale(.8)"><g class="ailes"><path d="M0 0c-3-3-8-3-13 1 3-1 5 0 6 3 2-2 4-2 5 1l2-2 2 2c1-3 3-3 5-1 1-3 3-4 6-3-5-4-10-4-13-1z" fill="#0b0614"/></g></g></g>
    </svg>`;

  const pluriel = (n, mot) => n + ' ' + mot + (n > 1 ? 's' : '');
  const multTxt = (m) => String(Number(m)).replace('.', ',');
  const rangTxt = (n) => (Number(n) === 1 ? '1er' : n + 'e');

  // L'état de la page, gardé pour la redessiner après un geste (citrouille, vote).
  const PG = { hote: null, saison: null, classement: null, duel: null, message: null, ouverts: null, detail: null };

  // compact : un titre devient une petite étiquette (son nom s'écrit à côté, pas dans l'aperçu).
  function recompenseHtml(c, taille, compact){
    const t = taille || 30;
    const st = c.style || {};
    if(c.type === 'cadre') return avatarApercu(currentUser ? currentUser.pseudo : '?', currentUser ? currentUser.avatar : '', st, t);
    if(c.type === 'couleur') return `<span class="eng-nom-couleur" style="--na:${hexa(st.a, '#fff')};--nb:${hexa(st.b, '#fff')};font-weight:700;font-size:${Math.round(t * .62)}px">Aa</span>`;
    if(c.type === 'embleme') return `<span class="eng-emoji" style="font-size:${Math.round(t * .8)}px">${esc(st.emoji || '✨')}</span>`;
    if(compact) return '<span class="eng-emoji">🏷️</span>';
    return `<span class="eng-titre-pastille">${esc(c.nom)}</span>`;
  }

  const labelPalier = (p) => (p.bonus === 'gel' ? 'Gel de série' : (p.cosmetique ? p.cosmetique.nom : '?'));
  const typePalier = (p) => (p.bonus === 'gel' ? 'Bonus' : (TYPE_LIBELLE[p.cosmetique.type] || ''));

  function visuelTuile(p){
    if(p.bonus === 'gel') return '<span class="eng-emoji">❄️</span>';
    return recompenseHtml(p.cosmetique, 36, true);
  }

  function defiHtml(d){
    return `
      <div class="eng-defi${d.fait ? ' fait' : ''}">
        <div class="l"><b style="font-weight:500">${d.fait ? '✓ ' : ''}${esc(d.libelle)}</b><span>${d.fait ? '+' + d.points + ' pts' : d.progres + '/' + d.objectif + ' · +' + d.points + ' pts'}</span></div>
        <div class="eng-barre"><i style="width:${Math.round(d.progres / d.objectif * 100)}%"></i></div>
      </div>`;
  }

  function heroHtml(s){

    const paliers = s.paliers || [];
    const total = s.total_paliers || paliers.length || 30;
    const pts = s.points || 0;
    const precedent = paliers.filter(p => p.points <= pts).reduce((m, p) => Math.max(m, p.points), 0);
    const suivant = s.prochain ? s.prochain.points : null;
    const pct = suivant ? Math.max(2, Math.min(100, Math.round((pts - precedent) / (suivant - precedent) * 100))) : 100;
    const pSuivant = s.prochain ? paliers.find(p => p.palier === s.prochain.palier) : null;
    const jours = s.terminee ? 'Saison terminée'
      : (s.jours_restants === 0 ? 'Dernier jour' : pluriel(s.jours_restants, 'jour') + ' restant' + (s.jours_restants > 1 ? 's' : ''));

    const puces = [
      `<span>⏳ ${esc(jours)}</span>`,
      s.rang ? `<span>🏅 ${esc(rangTxt(s.rang))} sur ${nf(s.participants)}</span>` : '',
      Number(s.multiplicateur) > 1 ? `<span class="mult">⚡ XP ×${esc(multTxt(s.multiplicateur))} aujourd'hui</span>` : ''
    ].join('');

    return `
      <section class="eng-hero${s.decor === 'halloween' ? ' hw' : ''}">
        ${s.decor === 'halloween' ? HERO_HALLOWEEN : ''}
        <div class="eng-hero-contenu">
          <div class="eng-hero-eyebrow">${esc(s.nom)} · du ${esc(jourCourt(s.debut))} au ${esc(jourCourt(s.fin))}</div>
          <h2 class="eng-hero-titre">${esc(s.theme)}</h2>
          <div class="eng-hero-palier"><b>Palier ${nf(s.palier)}</b><span>sur ${nf(total)}</span><em>${nf(pts)} points</em></div>
          <div class="eng-barre"><i style="width:${pct}%"></i></div>
          <p class="eng-hero-suite">${pSuivant
            ? 'Prochain : ' + esc(labelPalier(pSuivant)) + ' · encore ' + nf(suivant - pts) + ' points'
            : 'Tous les paliers sont atteints. Bravo !'}</p>
          <div class="eng-puces">${puces}</div>
        </div>
      </section>`;
  }

  function evenementsHtml(s){

    const evts = s.evenements || [];
    if(!evts.length) return '';

    return `
      <section class="eng-sec">
        <h3 class="eng-sec-titre">Événements</h3>
        <div class="eng-evts">${evts.map(e => `
          <div class="eng-evt${e.actif ? ' actif' : ''}">
            <span class="em">${esc(e.emoji)}</span>
            <div class="tx"><b>${esc(e.nom)}</b><small>${esc(e.description)}</small></div>
            <div class="dt"><b>XP ×${esc(multTxt(e.multiplicateur))}</b><small>${e.actif ? 'En cours' : esc(jourCourt(e.debut)) + (e.fin !== e.debut ? ' → ' + esc(jourCourt(e.fin)) : '')}</small></div>
          </div>`).join('')}</div>
      </section>`;
  }

  function citrouilleHtml(s){

    if(s.terminee) return '';

    const kit = CITROUILLE[s.decor] || CITROUILLE.defaut;
    const c = s.citrouille || {};
    const msg = PG.message;
    const lot = c.ouverte ? (kit.lots[c.tirage] || kit.lots.bonbon) : null;
    const emoji = s.decor === 'halloween' ? '🎃' : '🎁';

    return `
      <section class="eng-citrouille${msg ? ' gagne' : ''}" data-citrouille-bloc>
        <button type="button" class="eng-citrouille-bouton" data-citrouille ${c.ouverte ? 'disabled' : ''} aria-label="${esc(kit.titre)}">${emoji}</button>
        <div class="tx">
          <b>${esc(kit.titre)}</b>
          ${c.ouverte
            ? `<span class="gain">${lot[1]} ${esc(lot[0])} · +${nf(c.points)} pts</span>
               <p>${msg ? 'Ajouté à ta saison. ' : ''}Reviens demain pour une nouvelle surprise${c.total > 1 ? ' · ' + pluriel(c.total, 'ouverture') + ' cette saison' : ''}.</p>`
            : `<p>${esc(kit.invite)}</p>`}
          <p class="eng-erreur" data-erreur hidden></p>
        </div>
      </section>`;
  }

  function chapitresHtml(s){

    const ch = s.chapitres || [];
    if(!ch.length) return '';

    return `
      <section class="eng-sec">
        <h3 class="eng-sec-titre">Chapitres <span>${ch.filter(c => c.fait).length}/${ch.length} terminés</span></h3>
        ${ch.map((c) => {
          const faits = c.defis.filter(d => d.fait).length;
          const statut = c.fait ? 'Terminé' : (c.statut === 'a_venir' ? 'Dès le ' + jourCourt(c.debut) : (c.statut === 'termine' ? 'Clos' : 'En cours'));
          const ouvert = PG.ouverts ? PG.ouverts.has(c.numero) : c.statut === 'en_cours';
          return `
            <details class="eng-chap ${esc(c.statut)}${c.fait ? ' fait' : ''}" data-chap="${c.numero}"${ouvert ? ' open' : ''}>
              <summary>
                <span class="num">${c.fait ? '✓' : c.numero}</span>
                <span class="tx"><b>${esc(c.nom)}</b><small>${esc(jourCourt(c.debut))} → ${esc(jourCourt(c.fin))} · ${esc(statut)}</small></span>
                <span class="etat">${faits}/${c.defis.length}</span>
              </summary>
              <div class="eng-chap-corps">
                <p class="eng-note" style="margin:0 0 10px">${esc(c.description)}</p>
                ${c.defis.map(defiHtml).join('')}
                ${c.recompense ? `
                  <div class="eng-chap-rec${c.recompense.obtenu ? ' obtenu' : ''}">
                    <span class="v">${recompenseHtml(c.recompense, 34, true)}</span>
                    <div class="tx"><small>Récompense du chapitre</small><b>${esc(c.recompense.nom)}</b><small>${c.recompense.obtenu ? '✓ Obtenue' : 'Termine les ' + c.defis.length + ' défis du chapitre'}</small></div>
                  </div>` : ''}
              </div>
            </details>`;
        }).join('')}
      </section>`;
  }

  function detailHtml(s, k){
    const p = (s.paliers || []).find(x => x.palier === k);
    if(!p) return '';
    const rar = p.cosmetique ? ' · ' + (RARETES[p.cosmetique.rarete] || '') : '';
    const etat = p.atteint ? 'Débloqué' : 'Encore ' + nf(Math.max(p.points - s.points, 0)) + ' points';
    return `<b>Palier ${p.palier} · ${esc(labelPalier(p))}</b><span>${esc(typePalier(p))}${esc(rar)} · ${nf(p.points)} points · ${esc(etat)}</span>`;
  }

  function pisteHtml(s){

    const paliers = s.paliers || [];
    if(!paliers.length) return '';

    const prochain = s.prochain ? s.prochain.palier : null;
    const speciales = s.speciales || [];

    return `
      <section class="eng-sec">
        <h3 class="eng-sec-titre">Récompenses <span>${nf(s.palier)}/${paliers.length}</span></h3>
        <div class="eng-piste">${paliers.map(p => `
          <button type="button" class="eng-tuile-r ${p.cosmetique ? 'rar-' + esc(p.cosmetique.rarete) : 'rar-bonus'}${p.atteint ? ' atteint' : ''}${p.palier === prochain ? ' prochain' : ''}${PG.detail === p.palier ? ' choisi' : ''}" data-palier="${p.palier}">
            <span class="k">${p.atteint ? '✓' : p.palier}</span>
            <span class="visuel">${visuelTuile(p)}</span>
            <span class="nom">${esc(labelPalier(p))}</span>
            <span class="pts">${nf(p.points)}</span>
          </button>`).join('')}</div>
        <div class="eng-detail" data-detail aria-live="polite">${detailHtml(s, PG.detail || prochain || paliers[paliers.length - 1].palier)}</div>
        ${speciales.length ? `
          <div class="eng-titre-bloc">Récompenses spéciales</div>
          <div class="eng-speciales">${speciales.map(c => `
            <div class="eng-spec${c.obtenu ? ' obtenu' : ''}">
              <span class="v">${recompenseHtml(c, 34, true)}</span>
              <div class="tx"><b>${esc(c.nom)}</b><small>${c.obtenu ? '✓ Obtenue' : '🔒 ' + esc(c.condition)}</small></div>
            </div>`).join('')}</div>` : ''}
      </section>`;
  }

  function epopeeHtml(s){

    const d = s.defis || [];
    if(!d.length) return '';

    return `
      <section class="eng-sec">
        <h3 class="eng-sec-titre">Défis de la saison <span>${d.filter(x => x.fait).length}/${d.length}</span></h3>
        ${d.map(defiHtml).join('')}
        <p class="eng-note">Ces défis durent toute la saison. Tes points = l'XP gagné pendant la saison + les défis accomplis + la citrouille du jour. Les récompenses de saison ne se gagnent qu'à ce moment-là : après, elles restent un souvenir de ceux qui y étaient.</p>
      </section>`;
  }

  function classementHtml(s){

    const c = PG.classement;
    const medaille = { 1: '🥇', 2: '🥈', 3: '🥉' };
    const top = c && Array.isArray(c.top) ? c.top : [];

    const ligne = (r) => {
      const m = r.membre || {};
      return `
        <div class="eng-rang${r.moi ? ' moi' : ''}">
          <span class="n">${medaille[r.rang] || r.rang}</span>
          ${avatarApercu(m.pseudo, m.avatar_url, m.cadre, 34)}
          <div class="tx"><b>${nomApercu(m.pseudo, m.couleur, m.embleme)}</b><small>Palier ${nf(r.palier)}${m.titre ? ' · ' + esc(m.titre) : ''}</small></div>
          <span class="pts">${nf(r.points)} pts</span>
        </div>`;
    };

    const horsTop = c && c.moi && !top.some(r => r.moi)
      ? ligne({ rang: c.moi.rang, points: c.moi.points, moi: true, palier: s.palier, membre: { pseudo: currentUser ? currentUser.pseudo : 'Toi', avatar_url: currentUser ? currentUser.avatar : '' } })
      : '';

    return `
      <section class="eng-sec">
        <h3 class="eng-sec-titre">Classement <span>${c && c.participants ? nf(c.participants) + ' participant' + (c.participants > 1 ? 's' : '') : ''}</span></h3>
        ${top.length ? top.map(ligne).join('') + horsTop : '<div class="eng-vide">Personne n\'est encore classé. Gagne des points pour ouvrir le bal.</div>'}
        <p class="eng-note">À la fin de la saison, le podium gagne des récompenses exclusives : un cadre pour les trois premiers, un titre pour le premier.</p>
      </section>`;
  }

  function attenteHtml(s){
    return `
      <section class="eng-hero">
        <div class="eng-hero-contenu" style="padding-top:60px">
          <div class="eng-hero-eyebrow">Saison</div>
          <h2 class="eng-hero-titre">${s && s.a_venir ? esc(s.theme) : 'Bientôt'}</h2>
          <p class="eng-hero-suite">${s && s.a_venir
            ? 'La ' + esc(s.nom) + ' commence le ' + esc(jourCourt(s.debut)) + '. De nouveaux cadres, titres, couleurs et emblèmes t\'y attendent.'
            : 'Pas de saison pour le moment. La prochaine arrive bientôt.'}</p>
        </div>
      </section>`;
  }

  function espaceHtml(){
    return `
      <section class="eng-sec">
        <h3 class="eng-sec-titre">Ton espace</h3>
        <div class="eng-bande deux">
          <button type="button" class="eng-puce" data-eng="semaine"><b>Ma semaine</b><small>Ton résumé du lundi au dimanche, à partager</small></button>
          <button type="button" class="eng-puce" data-eng="garderobe"><b>Garde-robe</b><small>Cadres, titres, couleurs, emblèmes</small></button>
        </div>
      </section>`;
  }

  async function charger(){

    const [d, s, c] = await Promise.all([BD.duelsListe(), BD.saisonEtat(), BD.saisonClassement(10)]);

    if(s && s.error) throw s.error;

    PG.duel = d && Array.isArray(d.data) ? (d.data.find(x => x.actif) || null) : null;
    PG.saison = s ? s.data : null;
    PG.classement = c && !c.error ? c.data : null;
  }

  function dessiner(){

    const h = PG.hote;
    if(!h) return;

    const s = PG.saison;
    const vivante = s && !s.a_venir && s.id;
    const c = (s && s.couleurs) || [];

    let html = `<div class="eng-page" style="--s1:${hexa(c[0], '#ff7a1a')};--s2:${hexa(c[1], '#ffd166')};--s3:${hexa(c[2], '#8b5cf6')}">`;

    if(vivante) html += heroHtml(s) + evenementsHtml(s) + citrouilleHtml(s);
    else html += attenteHtml(s);

    if(PG.duel) html += `<section class="eng-sec"><h3 class="eng-sec-titre">Duel du moment</h3>${duelHtml(PG.duel)}</section>`;

    if(vivante) html += chapitresHtml(s) + pisteHtml(s) + epopeeHtml(s) + classementHtml(s);

    html += espaceHtml() + '</div>';

    h.innerHTML = html;
    brancher();
  }

  function brancher(){

    const h = PG.hote;
    const s = PG.saison;

    h.querySelectorAll('[data-eng]').forEach((b) => b.addEventListener('click', () => ouvrir(b.dataset.eng)));

    h.querySelectorAll('details[data-chap]').forEach((d) => d.addEventListener('toggle', () => {
      PG.ouverts = new Set(Array.from(h.querySelectorAll('details[data-chap][open]')).map(x => Number(x.dataset.chap)));
    }));

    h.querySelectorAll('[data-palier]').forEach((b) => b.addEventListener('click', () => {
      PG.detail = Number(b.dataset.palier);
      h.querySelectorAll('[data-palier]').forEach((x) => x.classList.toggle('choisi', x === b));
      const zone = h.querySelector('[data-detail]');
      if(zone) zone.innerHTML = detailHtml(s, PG.detail);
    }));

    if(PG.duel) brancherDuel(h, PG.duel);

    const cit = h.querySelector('[data-citrouille]');

    if(cit) cit.addEventListener('click', async () => {

      if(cit.disabled) return;
      cit.disabled = true;

      const bloc = h.querySelector('[data-citrouille-bloc]');
      const erreur = bloc.querySelector('[data-erreur]');
      erreur.hidden = true;
      bloc.classList.add('secoue');

      const debut = Date.now();
      const { data, error } = await BD.saisonCitrouille();
      await new Promise((r) => setTimeout(r, Math.max(0, 750 - (Date.now() - debut))));

      if(error || !data){
        bloc.classList.remove('secoue');
        cit.disabled = false;
        erreur.textContent = erreurTexte(error);
        erreur.hidden = false;
        return;
      }

      PG.message = { tirage: data.tirage, points: data.points };
      await rafraichir();

      if(window.Xp && window.Xp.apres) window.Xp.apres(600);
    });
  }

  // Relit la saison et le classement, et redessine sans faire sauter la page.
  async function rafraichir(){
    const y = window.scrollY;
    try{ await charger(); }catch(e){ return; }
    dessiner();
    window.scrollTo({ top: y, behavior: 'instant' });
  }

  async function page(hote){

    if(!hote || !currentUser) return;

    poserFeuille();
    PG.hote = hote;
    PG.message = null;

    await charger();

    try{
      dessiner();
    }catch(e){
      console.error('Saison :', e);
      throw new Error('Affichage de la saison impossible (' + (e && e.message ? e.message : e) + ').');
    }
  }

  function pause(){}

  // ---------------------------------------------------------------------
  // Le vestiaire : un écran de jeu pour s'habiller
  //
  // À gauche la scène (ton personnage, ses quatre emplacements, ton rendu dans la communauté), à droite l'inventaire
  // (par type, par collection, avec ton statut de découvreur). Toucher un objet l'essaie sur la scène avant de
  // l'équiper, même verrouillé : on voit ce qu'on vise.
  // ---------------------------------------------------------------------

  const RAR = { commun: ['Commun', '#9aa7b8'], rare: ['Rare', '#4aa8ff'], epique: ['Épique', '#b36bff'], legendaire: ['Légendaire', '#ffb340'] };
  const RANG = { commun: 0, rare: 1, epique: 2, legendaire: 3 };
  const SLOTS = [['cadre', 'Cadre', '⭕'], ['titre', 'Titre', '🏷️'], ['couleur', 'Couleur', '🎨'], ['embleme', 'Emblème', '✨']];
  const SOURCES = { defaut: '🎁', niveau: '⭐', succes: '🏅', saison: '🏆', chapitre: '📖', classement: '👑' };
  const CLE_VUS = 'lw-vestiaire-vus';

  // Les objets déjà vus : ce qui est nouveau depuis la dernière visite porte une pastille. La toute première visite ne
  // marque rien comme nouveau.
  function lireVus(obtenus){
    try{
      const brut = localStorage.getItem(CLE_VUS);
      if(brut === null){
        localStorage.setItem(CLE_VUS, JSON.stringify(obtenus));
        return new Set(obtenus);
      }
      return new Set(JSON.parse(brut));
    }catch(e){
      return new Set(obtenus);
    }
  }

  function noterVus(ids){
    try{ localStorage.setItem(CLE_VUS, JSON.stringify(ids)); }catch(e){}
  }

  // La collection d'un objet : une saison, les niveaux, les succès…
  function ensembleDe(o){
    const m = /^saison-(\d+)-/.exec(o.id);
    if(m){
      const t = /\(([^)]+)\)/.exec(o.description || '');
      return { cle: 'saison-' + m[1], nom: 'Saison ' + m[1] + (t ? ' · ' + t[1] : ''), icone: '🏆' };
    }
    if(o.source === 'niveau') return { cle: 'niveau', nom: 'Niveaux', icone: '⭐' };
    if(o.source === 'succes') return { cle: 'succes', nom: 'Succès', icone: '🏅' };
    return { cle: 'offerts', nom: 'Offerts', icone: '🎁' };
  }

  // L'objet, dessiné à la taille voulue.
  function visuelObjet(o, t, compact){
    const st = o.style || {};
    if(o.type === 'cadre') return avatarApercu(currentUser ? currentUser.pseudo : '?', currentUser ? currentUser.avatar : '', st, t);
    if(o.type === 'couleur') return `<span class="eng-nom-couleur vst-aa" style="--na:${hexa(st.a, '#fff')};--nb:${hexa(st.b, '#fff')};font-size:${Math.round(t * .62)}px">Aa</span>`;
    if(o.type === 'embleme') return `<span class="vst-emoji" style="font-size:${Math.round(t * .8)}px">${esc(st.emoji || '✨')}</span>`;
    if(compact) return '<span class="vst-emoji" style="font-size:' + Math.round(t * .75) + 'px">🏷️</span>';
    return `<span class="eng-titre-pastille vst-titre">${esc(o.nom)}</span>`;
  }

  async function garderobe(){

    poserFeuille();
    if(feuilleOuverte) feuilleOuverte.fermer();

    const voile = document.createElement('div');
    voile.className = 'vst-voile';
    voile.innerHTML = '<div class="vst" role="dialog" aria-modal="true" aria-label="Vestiaire"><div class="vst-attente">Ouverture du vestiaire…</div></div>';

    const racine = voile.firstElementChild;
    const precedent = document.activeElement;
    const avant = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    document.body.appendChild(voile);

    let etat = null;

    function fermer(){
      if(!voile.parentNode) return;
      if(etat) noterVus(etat.catalogue.filter(o => o.obtenu).map(o => o.id));
      voile.remove();
      document.documentElement.style.overflow = avant;
      document.removeEventListener('keydown', touche);
      if(feuilleOuverte && feuilleOuverte.voile === voile) feuilleOuverte = null;
      if(precedent && precedent.focus) try{ precedent.focus(); }catch(e){}
    }

    function touche(ev){ if(ev.key === 'Escape') fermer(); }

    voile.addEventListener('click', (ev) => { if(ev.target === voile) fermer(); });
    document.addEventListener('keydown', touche);
    feuilleOuverte = { voile, corps: racine, fermer };

    const [r, d] = await Promise.all([BD.cosmetiquesMoi(), BD.decouvreurFiche(null)]);

    if(!voile.parentNode) return;

    if(r.error || !r.data){
      racine.innerHTML = `<div class="vst-attente">${esc(erreurTexte(r.error))}<br><button type="button" class="eng-btn discret" data-act="fermer" style="margin-top:14px">Fermer</button></div>`;
      racine.addEventListener('click', (ev) => { if(ev.target.closest('[data-act="fermer"]')) fermer(); });
      return;
    }

    const catalogue = r.data.catalogue || [];
    const vus = lireVus(catalogue.filter(o => o.obtenu).map(o => o.id));

    etat = {
      catalogue,
      parId: {},
      equipe: Object.assign({ cadre: null, titre: null, couleur: null, embleme: null }, r.data.equipe || {}),
      fiche: d && !d.error ? d.data : null,
      vue: 'inventaire', type: 'tout', filtre: 'tous', ensemble: null,
      sel: null, message: '', burst: null,
      nouveaux: new Set(catalogue.filter(o => o.obtenu && !vus.has(o.id)).map(o => o.id))
    };
    catalogue.forEach(o => { etat.parId[o.id] = o; });

    const pseudo = currentUser ? currentUser.pseudo : 'Toi';

    // ---- la scène : le personnage tel qu'il serait habillé
    function sceneHtml(){

      const porte = Object.assign({}, etat.equipe);
      const essai = etat.sel ? etat.parId[etat.sel] : null;
      if(essai) porte[essai.type] = essai.id;

      const cadre = etat.parId[porte.cadre];
      const titre = etat.parId[porte.titre];
      const couleur = etat.parId[porte.couleur];
      const embleme = etat.parId[porte.embleme];

      const aura = Object.keys(porte).map(k => etat.parId[porte[k]]).filter(Boolean)
        .reduce((m, o) => (RANG[o.rarete] > m ? RANG[o.rarete] : m), 0);
      const couleurAura = RAR[['commun', 'rare', 'epique', 'legendaire'][aura]][1];

      const diffEssai = essai && etat.equipe[essai.type] !== essai.id;
      const poussieres = Array.from({ length: 14 }, (_, k) =>
        `<i style="--x:${(k * 37 + 11) % 100}%;--d:${5 + (k * 7) % 6}s;--t:${-((k * 13) % 9)}s;--z:${3 + (k % 4)}px"></i>`).join('');

      return `
        <section class="vst-scene" style="--aura:${couleurAura}" data-aura="${aura}">
          <div class="vst-lumiere"></div>
          <div class="vst-poussieres">${poussieres}</div>
          <div class="vst-perso" data-perso>
            <div class="vst-avatar">${avatarApercu(pseudo, currentUser ? currentUser.avatar : '', cadre ? cadre.style : null, 132)}</div>
            <div class="vst-nom">${nomApercu(pseudo, couleur ? couleur.style : null, embleme && embleme.style ? embleme.style.emoji : null)}</div>
            ${titre ? `<span class="eng-titre-pastille">${esc(titre.nom)}</span>` : '<span class="vst-vide">Aucun titre</span>'}
          </div>
          <div class="vst-socle"></div>
          <div class="vst-burst" data-burst></div>
          ${diffEssai ? `<span class="vst-apercu">Aperçu${essai.obtenu ? '' : ' · verrouillé'}</span>` : ''}
        </section>`;
    }

    // ---- les quatre emplacements
    function slotsHtml(){
      return `<div class="vst-slots">${SLOTS.map(([type, nom, icone]) => {
        const o = etat.parId[etat.equipe[type]];
        const rc = o ? RAR[o.rarete][1] : '#3a4354';
        return `
          <button type="button" class="vst-slot${etat.type === type ? ' actif' : ''}${o ? ' plein' : ''}" style="--rc:${rc}" data-act="slot" data-type="${type}" aria-label="${esc(nom)} : ${o ? esc(o.nom) : 'vide'}">
            <span class="ic">${o ? visuelObjet(o, 30) : icone}</span>
            <span class="lb">${esc(nom)}</span>
            <b>${o ? esc(o.nom) : 'Vide'}</b>
          </button>`;
      }).join('')}</div>`;
    }

    // ---- ce que les autres voient dans la communauté
    function communauteHtml(){

      const porte = Object.assign({}, etat.equipe);
      const essai = etat.sel ? etat.parId[etat.sel] : null;
      if(essai) porte[essai.type] = essai.id;

      const cadre = etat.parId[porte.cadre];
      const titre = etat.parId[porte.titre];
      const couleur = etat.parId[porte.couleur];
      const embleme = etat.parId[porte.embleme];

      return `
        <div class="vst-com" aria-hidden="true">
          <div class="vst-com-tete">Dans la communauté</div>
          <div class="vst-com-msg">
            ${avatarApercu(pseudo, currentUser ? currentUser.avatar : '', cadre ? cadre.style : null, 36)}
            <div>
              <div class="l">${nomApercu(pseudo, couleur ? couleur.style : null, embleme && embleme.style ? embleme.style.emoji : null)}
                ${titre ? `<span class="eng-titre-pastille">${esc(titre.nom)}</span>` : ''}<small>à l'instant</small></div>
              <p>Cette sortie est incroyable, je la mets en boucle 🔥</p>
            </div>
          </div>
        </div>`;
    }

    // ---- la collection en chiffres
    function progressionHtml(){

      const total = catalogue.length;
      const obtenus = catalogue.filter(o => o.obtenu).length;
      const pct = total ? Math.round(obtenus / total * 100) : 0;

      const lignes = ['legendaire', 'epique', 'rare', 'commun'].map((k) => {
        const tous = catalogue.filter(o => o.rarete === k);
        const mes = tous.filter(o => o.obtenu).length;
        return `<div class="vst-rar-ligne" style="--rc:${RAR[k][1]}"><span>${esc(RAR[k][0])}</span><div class="eng-barre"><i style="width:${tous.length ? Math.round(mes / tous.length * 100) : 0}%"></i></div><em>${mes}/${tous.length}</em></div>`;
      }).join('');

      return { pct, obtenus, total, html: `<div class="vst-rar">${lignes}</div>` };
    }

    function listeFiltree(){

      let l = catalogue.slice();

      if(etat.type !== 'tout') l = l.filter(o => o.type === etat.type);
      if(etat.ensemble) l = l.filter(o => ensembleDe(o).cle === etat.ensemble);
      if(etat.filtre === 'debloques') l = l.filter(o => o.obtenu);
      if(etat.filtre === 'verrouilles') l = l.filter(o => !o.obtenu);

      const equipe = (o) => (etat.equipe[o.type] === o.id ? 1 : 0);

      return l.sort((a, b) =>
        (equipe(b) - equipe(a)) || (Number(b.obtenu) - Number(a.obtenu)) ||
        (Number(etat.nouveaux.has(b.id)) - Number(etat.nouveaux.has(a.id))) ||
        (RANG[b.rarete] - RANG[a.rarete]) || String(a.nom).localeCompare(String(b.nom), 'fr'));
    }

    function carteHtml(o){

      const equipe = etat.equipe[o.type] === o.id;
      const infos = o.obtenu ? esc(RAR[o.rarete][0]) : '🔒 ' + esc(o.condition);

      return `
        <button type="button" class="vst-carte rar-${esc(o.rarete)}${o.obtenu ? '' : ' verrou'}${equipe ? ' equipe' : ''}${etat.sel === o.id ? ' sel' : ''}" data-act="carte" data-id="${esc(o.id)}" style="--rc:${RAR[o.rarete][1]}">
          ${etat.nouveaux.has(o.id) ? '<span class="vst-new">Nouveau</span>' : ''}
          <span class="vst-src" title="${esc(o.source)}">${SOURCES[o.source] || '🎁'}</span>
          <span class="vst-visuel">${visuelObjet(o, 46)}</span>
          <b>${esc(o.nom)}</b>
          <small>${infos}</small>
          ${equipe ? '<span class="vst-equipe-tag">Équipé</span>' : ''}
        </button>`;
    }

    function inventaireHtml(){

      const types = [['tout', 'Tout']].concat(SLOTS.map(([t, n]) => [t, n + 's']));
      const compte = (t) => {
        const l = catalogue.filter(o => t === 'tout' || o.type === t);
        return l.filter(o => o.obtenu).length + '/' + l.length;
      };
      const l = listeFiltree();
      const ens = etat.ensemble ? catalogue.map(ensembleDe).find(e => e.cle === etat.ensemble) : null;

      return `
        <div class="vst-types" role="tablist">${types.map(([t, n]) => `
          <button type="button" role="tab" aria-selected="${etat.type === t}" class="vst-type${etat.type === t ? ' actif' : ''}" data-act="type" data-type="${t}">${esc(n)}<em>${compte(t)}</em></button>`).join('')}</div>
        <div class="vst-filtres">
          ${[['tous', 'Tous'], ['debloques', 'Débloqués'], ['verrouilles', 'À débloquer']].map(([f, n]) => `
            <button type="button" class="vst-puce${etat.filtre === f ? ' actif' : ''}" data-act="filtre" data-f="${f}">${n}</button>`).join('')}
          ${ens ? `<button type="button" class="vst-puce actif ens" data-act="ens-vider">${esc(ens.icone)} ${esc(ens.nom)} ✕</button>` : ''}
        </div>
        <div class="vst-grille" data-grille>${l.length ? l.map(carteHtml).join('') : '<div class="eng-vide" style="grid-column:1/-1">Rien ici pour le moment.</div>'}</div>`;
    }

    function collectionsHtml(){

      const groupes = {};
      catalogue.forEach((o) => {
        const e = ensembleDe(o);
        (groupes[e.cle] = groupes[e.cle] || { e, items: [] }).items.push(o);
      });

      const liste = Object.keys(groupes).map(k => groupes[k])
        .sort((a, b) => (Number(b.e.cle.startsWith('saison')) - Number(a.e.cle.startsWith('saison'))) || b.e.cle.localeCompare(a.e.cle, 'fr'));

      return `<div class="vst-collections">${liste.map(({ e, items }) => {
        const mes = items.filter(o => o.obtenu).length;
        const complet = mes === items.length;
        return `
          <button type="button" class="vst-coll${complet ? ' complet' : ''}" data-act="ens" data-cle="${esc(e.cle)}">
            <div class="vst-coll-tete"><span>${esc(e.icone)}</span><b>${esc(e.nom)}</b><em>${mes}/${items.length}${complet ? ' ✓' : ''}</em></div>
            <div class="eng-barre"><i style="width:${Math.round(mes / items.length * 100)}%"></i></div>
            <div class="vst-coll-mini">${items.slice().sort((a, b) => RANG[b.rarete] - RANG[a.rarete]).slice(0, 12).map(o => `
              <span class="rar-${esc(o.rarete)}${o.obtenu ? '' : ' verrou'}" style="--rc:${RAR[o.rarete][1]}">${visuelObjet(o, 26, true)}</span>`).join('')}</div>
          </button>`;
      }).join('')}</div>`;
    }

    function statutHtml(){

      const f = etat.fiche;
      if(!f) return '<div class="eng-vide">Ton statut n\'est pas disponible pour le moment.</div>';

      const paliers = Object.keys(RANGS).map(Number).sort((a, b) => a - b);

      return `
        <div class="vst-statut">
          <div class="vst-statut-haut">
            <span class="vst-statut-gem">💎</span>
            <div><small>Statut de découvreur</small><b>${f.rang ? esc(f.rang) : 'Pas encore de rang'}</b></div>
            <em>${nf(f.nombre)} pépite${f.nombre > 1 ? 's' : ''}</em>
          </div>
          <div class="vst-echelle">${paliers.map((n) => `
            <div class="vst-marche${f.nombre >= n ? ' fait' : ''}"><i>${f.nombre >= n ? '✓' : n}</i><span>${esc(RANGS[n])}</span></div>`).join('')}</div>
          <p class="eng-note">${f.prochain
            ? `Encore ${nf(f.prochain - f.nombre)} pépite${f.prochain - f.nombre > 1 ? 's' : ''} pour devenir « ${esc(RANGS[f.prochain])} ».`
            : 'Tu as atteint le plus haut rang.'}
            Une pépite : une sortie que tu as bien notée parmi les premiers, et que la communauté a ensuite confirmée.</p>
          ${f.liste && f.liste.length ? `<div class="eng-pepites">${f.liste.map(s => `<button type="button" data-act="fiche" data-numero="${esc(s.numero)}" title="${esc(s.titre)} · ${esc(s.artiste)}"><img src="${esc(safeUrl(s.cover))}" alt="${esc(s.titre)}"></button>`).join('')}</div>` : ''}
        </div>`;
    }

    function detailHtml(){

      const o = etat.sel ? etat.parId[etat.sel] : null;

      if(!o){
        return `<div class="vst-detail vide"><span>👆</span><p>${esc(etat.message) || 'Touche un objet pour l\'essayer sur ton personnage, même verrouillé.'}</p></div>`;
      }

      const equipe = etat.equipe[o.type] === o.id;
      const typeNom = (SLOTS.find(x => x[0] === o.type) || [null, o.type])[1];
      const date = o.obtenu_le ? new Date(o.obtenu_le).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' }) : '';

      return `
        <div class="vst-detail rar-${esc(o.rarete)}" style="--rc:${RAR[o.rarete][1]}">
          <span class="vst-detail-visuel">${visuelObjet(o, 54)}</span>
          <div class="tx">
            <span class="vst-rar-nom">${esc(RAR[o.rarete][0])} · ${esc(typeNom)} · ${esc(ensembleDe(o).nom)}</span>
            <b>${esc(o.nom)}</b>
            <p>${esc(o.description || '')}</p>
            <small>${o.obtenu ? '✓ Obtenu' + (date ? ' le ' + esc(date) : '') : '🔒 ' + esc(o.condition)}</small>
            ${etat.message ? `<small class="msg" aria-live="polite">${esc(etat.message)}</small>` : ''}
          </div>
          <div class="act">
            ${o.obtenu
              ? `<button type="button" class="eng-btn${equipe ? ' discret' : ''}" data-act="${equipe ? 'retirer' : 'equiper'}">${equipe ? 'Retirer' : 'Équiper'}</button>`
              : '<button type="button" class="eng-btn discret" disabled>Verrouillé</button>'}
          </div>
        </div>`;
    }

    function dessiner(){

      const scroll = racine.querySelector('[data-grille]');
      const haut = scroll ? scroll.scrollTop : 0;
      const prog = progressionHtml();

      racine.innerHTML = `
        <header class="vst-tete">
          <div class="vst-anneau" style="--p:${prog.pct}"><b>${prog.pct}<small>%</small></b></div>
          <div class="vst-titre-bloc"><h2>Vestiaire</h2><span>${prog.obtenus} objet${prog.obtenus > 1 ? 's' : ''} sur ${prog.total}</span></div>
          <button type="button" class="eng-fermer" data-act="fermer" aria-label="Fermer">×</button>
        </header>
        <div class="vst-gauche">
          ${sceneHtml()}
          ${slotsHtml()}
          ${communauteHtml()}
          ${prog.html}
        </div>
        <div class="vst-droite">
          <nav class="vst-vues" role="tablist">${[['inventaire', 'Inventaire'], ['collections', 'Collections'], ['statut', 'Statut']].map(([v, n]) => `
            <button type="button" role="tab" aria-selected="${etat.vue === v}" class="vst-vue${etat.vue === v ? ' actif' : ''}" data-act="vue" data-v="${v}">${n}</button>`).join('')}</nav>
          <div class="vst-corps">${etat.vue === 'inventaire' ? inventaireHtml() : (etat.vue === 'collections' ? collectionsHtml() : statutHtml())}</div>
          ${etat.vue === 'inventaire' ? detailHtml() : ''}
        </div>`;

      const grille = racine.querySelector('[data-grille]');
      if(grille) grille.scrollTop = haut;

      if(etat.burst !== null){
        const rc = RAR[etat.burst][1];
        const zone = racine.querySelector('[data-burst]');
        if(zone){
          zone.innerHTML = Array.from({ length: 22 }, (_, k) => {
            const a = k / 22 * Math.PI * 2;
            const dist = 70 + (k * 29) % 60;
            return `<i style="--dx:${Math.round(Math.cos(a) * dist)}px;--dy:${Math.round(Math.sin(a) * dist)}px;--c:${rc};animation-delay:${(k % 5) * 25}ms"></i>`;
          }).join('');
        }
        etat.burst = null;
      }
    }

    async function equiper(o, retirer){

      racine.querySelectorAll('.vst-detail .act button').forEach(b => { b.disabled = true; });

      const { error } = await BD.cosmetiqueEquiper(o.type, retirer ? null : o.id);

      if(error){ etat.message = erreurTexte(error); dessiner(); return; }

      etat.equipe[o.type] = retirer ? null : o.id;
      etat.message = retirer ? o.nom + ' retiré.' : o.nom + ' équipé. Les autres le verront en rechargeant la page.';
      etat.burst = retirer ? null : o.rarete;
      etat.sel = o.id;
      etat.nouveaux.delete(o.id);
      dessiner();

      if(navigator.vibrate) try{ navigator.vibrate(retirer ? 8 : [12, 40, 12]); }catch(e){}
    }

    racine.addEventListener('click', (ev) => {

      const b = ev.target.closest('[data-act]');
      if(!b) return;

      const act = b.dataset.act;

      if(act === 'fermer') return fermer();

      if(act === 'carte'){
        etat.sel = etat.sel === b.dataset.id ? null : b.dataset.id;
        etat.message = '';
        if(etat.sel) etat.nouveaux.delete(etat.sel);
        return dessiner();
      }

      if(act === 'equiper' || act === 'retirer'){
        const o = etat.sel ? etat.parId[etat.sel] : null;
        if(o) equiper(o, act === 'retirer');
        return;
      }

      if(act === 'slot'){
        etat.vue = 'inventaire';
        etat.type = etat.type === b.dataset.type ? 'tout' : b.dataset.type;
        etat.sel = null;
        return dessiner();
      }

      if(act === 'type'){ etat.type = b.dataset.type; return dessiner(); }
      if(act === 'filtre'){ etat.filtre = b.dataset.f; return dessiner(); }
      if(act === 'vue'){ etat.vue = b.dataset.v; return dessiner(); }
      if(act === 'ens'){ etat.ensemble = b.dataset.cle; etat.vue = 'inventaire'; etat.type = 'tout'; etat.filtre = 'tous'; return dessiner(); }
      if(act === 'ens-vider'){ etat.ensemble = null; return dessiner(); }

      if(act === 'fiche'){
        fermer();
        if(typeof ouvrirSortieParNumero === 'function') ouvrirSortieParNumero(b.dataset.numero);
      }
    });

    // Le personnage suit le pointeur, à peine.
    if(window.matchMedia && !window.matchMedia('(prefers-reduced-motion: reduce)').matches){
      racine.addEventListener('pointermove', (ev) => {
        const scene = ev.target.closest && ev.target.closest('.vst-scene');
        const perso = scene && scene.querySelector('[data-perso]');
        if(!perso || ev.pointerType === 'touch') return;
        const r = scene.getBoundingClientRect();
        perso.style.setProperty('--ry', (((ev.clientX - r.left) / r.width - .5) * 16).toFixed(1) + 'deg');
        perso.style.setProperty('--rx', ((.5 - (ev.clientY - r.top) / r.height) * 12).toFixed(1) + 'deg');
      });
      racine.addEventListener('pointerleave', () => {
        const perso = racine.querySelector('[data-perso]');
        if(perso){ perso.style.setProperty('--ry', '0deg'); perso.style.setProperty('--rx', '0deg'); }
      });
    }

    dessiner();
    const fermerBtn = racine.querySelector('.eng-fermer');
    if(fermerBtn) fermerBtn.focus();
  }

  // ---------------------------------------------------------------------
  // Une notification du système qu'on ouvre
  // ---------------------------------------------------------------------

  function ouvrirNotif(n){

    const d = n.donnees || {};

    if(n.type === 'resume_semaine') return semaine(1);
    if(n.type === 'duel') return duel(d.duel);
    if(n.type === 'saison') return ouvrir('saison');
    if(n.type === 'cosmetique') return garderobe();

    const numero = d.numero || (d.sortie && d.sortie.numero);
    if(numero && typeof ouvrirSortieParNumero === 'function') ouvrirSortieParNumero(numero);
  }

  // ---------------------------------------------------------------------
  // L'accès équipe : duels et saisons
  // ---------------------------------------------------------------------

  const EQ = { el: null, a: null, b: null, resultats: [], duels: [], saisons: [], edition: null, minuteur: null };

  function eqMsg(texte, ok){
    const m = EQ.el && EQ.el.querySelector('[data-eq-msg]');
    if(!m) return;
    m.className = 'msg ' + (ok ? 'ok' : 'err');
    m.textContent = texte || '';
  }

  function eqChoix(cote){
    const s = EQ[cote];
    return s ? `${esc(s.track_title)} — ${esc(s.artist_name)}` : '<span style="color:var(--muted)">à choisir</span>';
  }

  function eqDessiner(){

    if(!EQ.el) return;

    const ed = EQ.edition;
    const hoy = new Date();
    const iso = (d) => d.toISOString().slice(0, 10);
    const dans = (j) => iso(new Date(hoy.getTime() + j * 86400000));

    EQ.el.innerHTML = `
      <div class="eng-eq">
        <section>
          <h4>Duels de sorties</h4>
          <p class="eng-note" style="margin:0 0 10px">Un duel tourne en permanence : s'il n'y en a plus, le site en tire un au hasard parmi les sorties récentes avec pochette. Crée le tien pour choisir les deux sorties.</p>
          <div class="carte">
            <div class="ligne"><b>A</b> <span data-eq-a>${eqChoix('a')}</span></div>
            <div class="ligne"><b>B</b> <span data-eq-b>${eqChoix('b')}</span></div>
            <div class="ligne"><input type="text" data-eq-recherche placeholder="Chercher une sortie ou un artiste…" style="flex:1"></div>
            <div data-eq-resultats></div>
            <div class="ligne">
              <input type="text" data-eq-titre placeholder="Titre (facultatif)" style="flex:1">
              <select data-eq-jours aria-label="Durée du duel">
                <option value="1">1 jour</option><option value="2">2 jours</option><option value="3" selected>3 jours</option>
                <option value="5">5 jours</option><option value="7">7 jours</option><option value="14">14 jours</option>
              </select>
            </div>
            <div class="ligne">
              <button type="button" class="eng-btn" data-eq-creer>Lancer le duel</button>
              <button type="button" class="eng-btn discret" data-eq-hasard>Tirer au sort</button>
            </div>
            <p class="msg" data-eq-msg></p>
          </div>
          <div class="carte" style="margin-top:10px">
            ${EQ.duels.length ? EQ.duels.map(d => `
              <div class="duel-ligne">
                <div class="tx"><b>${esc(d.a.titre)}</b> contre <b>${esc(d.b.titre)}</b>
                  <span>${d.actif ? 'En cours · ' + esc(reste(d.fin)) : 'Terminé'} · ${nf(d.votes ? d.votes.a : 0)} contre ${nf(d.votes ? d.votes.b : 0)}${d.auto ? ' · tiré au sort' : ''}</span></div>
                <button type="button" class="eng-btn discret" data-eq-suppr="${esc(d.id)}">Retirer</button>
              </div>`).join('') : '<p class="eng-note" style="margin:0">Aucun duel pour le moment.</p>'}
          </div>
        </section>

        <section>
          <h4>Saisons</h4>
          <p class="eng-note" style="margin:0 0 10px">Une saison dure 4 à 6 semaines. Ses 30 paliers de récompenses (cadres, titres, couleurs de pseudo, emblèmes, gels de série), ses 4 chapitres de défis et son événement final se créent tout seuls aux couleurs choisies. Le décor « Halloween » apporte un contenu écrit sur mesure.</p>
          <div class="carte">
            ${EQ.saisons.length ? EQ.saisons.map(s => `
              <div class="duel-ligne">
                <span style="display:flex;gap:3px">${(s.couleurs || []).map(c => `<i style="width:14px;height:14px;border-radius:50%;background:${hexa(c, '#888')};display:inline-block"></i>`).join('')}</span>
                <div class="tx"><b>${esc(s.nom)}</b> · ${esc(s.theme)}<span>${esc(jourCourt(s.debut))} → ${esc(jourCourt(s.fin))} · ${nf(s.participants)} participant${s.participants > 1 ? 's' : ''}</span></div>
                <button type="button" class="eng-btn discret" data-eq-edit="${esc(s.id)}">Modifier</button>
              </div>`).join('') : '<p class="eng-note" style="margin:0">Aucune saison.</p>'}
          </div>
          <form class="carte" style="margin-top:10px" data-eq-saison>
            <div class="ligne"><b>${ed ? 'Modifier ' + esc(ed.nom) : 'Nouvelle saison'}</b></div>
            <div class="ligne"><input type="text" name="nom" placeholder="Nom (Saison 2)" value="${esc(ed ? ed.nom : '')}" required>
              <input type="text" name="theme" placeholder="Thème (L'Hiver)" value="${esc(ed ? ed.theme : '')}" required></div>
            <div class="ligne"><label>Début <input type="date" name="debut" value="${esc(ed ? ed.debut : dans(1))}" required></label>
              <label>Fin <input type="date" name="fin" value="${esc(ed ? ed.fin : dans(35))}" required></label></div>
            <div class="ligne"><label>Décor
              <select name="decor">
                <option value="">Aucun (contenu aux couleurs de la saison)</option>
                <option value="halloween"${ed && ed.decor === 'halloween' ? ' selected' : ''}>Halloween (contenu sur mesure)</option>
              </select></label></div>
            <div class="ligne"><label>Couleurs
              <input type="color" name="a" value="${hexa(ed && ed.couleurs[0], '#3b82f6')}">
              <input type="color" name="b" value="${hexa(ed && ed.couleurs[1], '#a5f3fc')}">
              <input type="color" name="c" value="${hexa(ed && ed.couleurs[2], '#c4b5fd')}"></label></div>
            <div class="ligne">
              <button type="submit" class="eng-btn">${ed ? 'Enregistrer' : 'Créer la saison'}</button>
              ${ed ? '<button type="button" class="eng-btn discret" data-eq-annuler>Annuler</button>' : ''}
            </div>
            <p class="msg" data-eq-msg2></p>
          </form>
        </section>
      </div>`;

    eqResultats();
  }

  function eqResultats(){

    const zone = EQ.el && EQ.el.querySelector('[data-eq-resultats]');
    if(!zone) return;

    zone.innerHTML = EQ.resultats.map((s, i) => `
      <div class="resultat">
        <img src="${esc(safeUrl(s.cover_url))}" alt="" loading="lazy">
        <div class="tx"><b>${esc(s.track_title)}</b><span>${esc(s.artist_name)}${s.release_date ? ' · ' + esc(String(s.release_date).slice(0, 4)) : ''}</span></div>
        <button type="button" class="eng-btn discret" data-eq-prendre="a" data-i="${i}">A</button>
        <button type="button" class="eng-btn discret" data-eq-prendre="b" data-i="${i}">B</button>
      </div>`).join('');
  }

  async function eqCharger(){

    const [d, s] = await Promise.all([BD.duelEquipeListe(), BD.saisonEquipeListe()]);

    if(d.error || s.error){
      EQ.el.innerHTML = `<div class="empty-state">${esc(erreurTexte(d.error || s.error))}</div>`;
      return;
    }

    EQ.duels = d.data || [];
    EQ.saisons = s.data || [];
    eqDessiner();
  }

  function eqBrancher(){

    if(EQ.el.dataset.engBranche) return;
    EQ.el.dataset.engBranche = '1';

    EQ.el.addEventListener('input', (ev) => {
      if(!ev.target.matches('[data-eq-recherche]')) return;
      clearTimeout(EQ.minuteur);
      const q = ev.target.value.trim();
      EQ.minuteur = setTimeout(async () => {
        if(q.length < 2){ EQ.resultats = []; eqResultats(); return; }
        const { data, error } = await BD.catalogueChercher(q, 8, 0);
        EQ.resultats = error ? [] : (data || []);
        eqResultats();
      }, 250);
    });

    EQ.el.addEventListener('click', async (ev) => {

      const prendre = ev.target.closest('[data-eq-prendre]');
      if(prendre){
        EQ[prendre.dataset.eqPrendre] = EQ.resultats[Number(prendre.dataset.i)];
        const cote = prendre.dataset.eqPrendre;
        EQ.el.querySelector('[data-eq-' + cote + ']').innerHTML = eqChoix(cote);
        return;
      }

      if(ev.target.closest('[data-eq-creer]')){
        if(!EQ.a || !EQ.b){ eqMsg('Choisis une sortie A et une sortie B.', false); return; }
        const jours = Number(EQ.el.querySelector('[data-eq-jours]').value);
        const fin = new Date(Date.now() + jours * 86400000).toISOString();
        const { error } = await BD.duelEquipeSauver(EQ.a.id, EQ.b.id, fin, EQ.el.querySelector('[data-eq-titre]').value);
        if(error){ eqMsg(erreurTexte(error), false); return; }
        EQ.a = EQ.b = null; EQ.resultats = [];
        await eqCharger();
        eqMsg('Duel lancé. Les membres sont prévenus.', true);
        return;
      }

      if(ev.target.closest('[data-eq-hasard]')){
        const jours = Number(EQ.el.querySelector('[data-eq-jours]').value);
        const { error } = await BD.duelEquipeHasard(jours);
        if(error){ eqMsg(erreurTexte(error), false); return; }
        await eqCharger();
        eqMsg('Duel tiré au sort et lancé.', true);
        return;
      }

      const suppr = ev.target.closest('[data-eq-suppr]');
      if(suppr){
        if(!window.confirm('Retirer ce duel et ses votes ?')) return;
        const { error } = await BD.duelEquipeSupprimer(suppr.dataset.eqSuppr);
        if(error){ eqMsg(erreurTexte(error), false); return; }
        await eqCharger();
        return;
      }

      const edit = ev.target.closest('[data-eq-edit]');
      if(edit){
        EQ.edition = EQ.saisons.find(s => s.id === edit.dataset.eqEdit) || null;
        eqDessiner();
        return;
      }

      if(ev.target.closest('[data-eq-annuler]')){
        EQ.edition = null;
        eqDessiner();
      }
    });

    EQ.el.addEventListener('submit', async (ev) => {

      const form = ev.target.closest('[data-eq-saison]');
      if(!form) return;
      ev.preventDefault();

      const v = (n) => form.elements[n].value;
      const msg = form.querySelector('[data-eq-msg2]');
      msg.className = 'msg'; msg.textContent = '';

      const { error } = await BD.saisonEquipeSauver({
        p_id: EQ.edition ? EQ.edition.id : null, p_nom: v('nom'), p_theme: v('theme'),
        p_debut: v('debut'), p_fin: v('fin'), p_a: v('a'), p_b: v('b'), p_c: v('c'), p_decor: v('decor') || null
      });

      if(error){ msg.className = 'msg err'; msg.textContent = erreurTexte(error); return; }

      EQ.edition = null;
      await eqCharger();
      const m2 = EQ.el.querySelector('[data-eq-msg2]');
      if(m2){ m2.className = 'msg ok'; m2.textContent = 'Saison enregistrée.'; }
    });
  }

  async function equipe(emplacement){

    poserFeuille();
    EQ.el = emplacement;
    eqBrancher();

    if(!EQ.duels.length && !EQ.saisons.length) emplacement.innerHTML = '<div class="empty-state">Chargement…</div>';

    await eqCharger();
  }

  window.Engagement = { page, pause, ouvrir, ouvrirNotif, equipe, semaine, garderobe, duel };

})();
