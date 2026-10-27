/* =====================================================================
   La Wave — Wave Cards : l'accueil et le quotidien

   Chargé à la demande par cartes.js (onglet « Accueil », chargerWaveModule('accueil') dans index.html).
   Les règles vivent dans la base (sql/quotidien-donnees.sql et sql/quotidien-jeu.sql) : progression des étapes, médailles
   d'événement, expéditions, classements, profil. Ce fichier demande et dessine.

     Aujourd'hui     salutation, série, « à récupérer » (+ Tout récupérer), l'avancement de la journée, les mises en avant
     Événements      le programme du jour (artiste, style, heure du holo) et les événements à durée limitée (médailles)
     Parcours        30 étapes en 6 chapitres, un diplôme à la fin
     Quêtes          expéditions (cartes en tournée) et défis de la semaine
     Classements     collection, holos, packs, série, niveau, marché (+ ceux que d'autres modules ajoutent)
     Nouveautés      le journal des mises à jour
     Profil          vitrine de 3 cartes, titres, cadres, fiche consultable par les autres joueurs
     Équipe          WaveAccueil.equipe : événements (missions + boutique de médailles) et nouveautés

   Contrat avec cartes.js :
     window.WaveAccueil = { monter(hote, api), quitter(), equipe(hote, api), ajouterClassement(def) }
   `api` est window.Cartes.api (cartes.js).

   Point d'extension des classements : un autre module (le combat, par exemple) peut ajouter le sien, qu'accueil.js soit chargé ou non :
     (window.WaveClassements = window.WaveClassements || []).push({
       id: 'combat', libelle: 'Combat', unite: 'trophées',
       charger: async (api) => ({ lignes: [{ rang, user_id, pseudo, avatar, valeur, moi }], moi: { rang, valeur } | null, total })
     });
   ===================================================================== */

(function(){

  'use strict';

  let A = null;      // l'interface de cartes.js
  let H = null;      // l'élément de l'onglet, tant qu'il est affiché

  const ST = { vue: 'accueil', n: 0, t: null, d: null, clas: 'collection', cible: null, ed: null };

  const SOUS = [['accueil', 'Aujourd\'hui'], ['evenements', 'Événements'], ['parcours', 'Parcours'], ['quetes', 'Quêtes'], ['classements', 'Classements'], ['nouveautes', 'Nouveautés'], ['profil', 'Profil']];

  const CHAPITRES = ['Premiers pas', 'La collection', 'Le quotidien', 'Le marché', 'Le combat', 'Maîtrise'];

  const CLASSEMENTS = [['collection', 'Collection'], ['holos', 'Cartes holo'], ['packs', 'Packs ouverts'], ['serie', 'Série'], ['niveau', 'Niveau'], ['marche', 'Marché']];

  const CADRES = { aucun: 'Aucun', argent: 'Argent', or: 'Or', azur: 'Azur', aurore: 'Aurore' };

  const METRIQUES = {
    ouvertures: 'Packs ouverts', holos: 'Cartes holo obtenues', rares: 'Cartes Rares ou mieux', epiques: 'Cartes Épiques ou mieux',
    combats: 'Combats livrés', victoires: 'Combats gagnés', ventes: 'Ventes sur le marché', achats: 'Achats sur le marché',
    annonces: 'Annonces posées', echanges: 'Échanges Wave Coins en vinyles'
  };

  const DUREES = [[2, '2 heures'], [6, '6 heures'], [12, '12 heures']];

  // ---------------------------------------------------------------------
  // Petits outils
  // ---------------------------------------------------------------------

  const hex = (c) => (/^#[0-9a-fA-F]{6}$/.test(String(c || '')) ? c : '#4FB4FF');
  const date = (iso) => (iso ? new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) : '');
  const pct = (a, b) => (b > 0 ? Math.min(100, Math.round(a / b * 100)) : 0);
  const gainExpe = (duree, rarete) => ({ 2: 1, 6: 2, 12: 3 }[duree] || 1) + (rarete >= 5 ? 2 : (rarete >= 3 ? 1 : 0));

  const puce = (n) => (n > 0 ? `<i class="ac-pt" aria-label="${n} à voir">${n > 9 ? '9+' : n}</i>` : '');

  const barre = (a, b, or) => `<span class="ct-barre${or ? ' or' : ''}"><i style="width:${pct(a, b)}%"></i></span>`;

  function gainPuces(g){
    return `<div class="ct-gains">${A.gainsHtml(g)}</div>`;
  }

  function erreur(e){
    A.toast((e && e.message) || 'Une erreur est survenue.', 'err');
  }

  function apres(etat){
    if(etat){ A.poserEtat(etat); A.majEntete(); }
  }

  // ---------------------------------------------------------------------
  // La feuille de style
  // ---------------------------------------------------------------------

  const CSS = `
  .ac{padding-bottom:12px;}
  .ac-barre{margin-bottom:18px;}
  .ac-barre .ct-segment button{display:inline-flex; align-items:center; gap:7px;}
  .ac-pt{display:inline-grid; place-items:center; min-width:17px; height:17px; padding:0 5px; border-radius:99px; background:var(--ct-accent); color:#04101c; font-size:10.5px; font-weight:800; font-style:normal;}
  .ac-hero{display:flex; align-items:center; justify-content:space-between; gap:18px; flex-wrap:wrap; padding:22px 24px; margin-bottom:16px; border-radius:20px; border:1px solid var(--ct-trait); background:linear-gradient(135deg, rgba(79,180,255,.14), rgba(168,121,255,.08) 55%, rgba(255,255,255,.03));}
  .ac-hero h2{margin:0; font-size:clamp(21px, 3.2vw, 28px); letter-spacing:-.01em;}
  .ac-hero p{margin:4px 0 0; font-size:13.5px; color:var(--muted);}
  .ac-chips{display:flex; gap:8px; flex-wrap:wrap;}
  .ac-chip{display:inline-flex; align-items:center; gap:7px; height:34px; padding:0 13px; border-radius:99px; background:rgba(255,255,255,.07); border:1px solid var(--ct-trait); font-size:13px; font-weight:700; color:var(--ink); font-variant-numeric:tabular-nums; white-space:nowrap;}
  .ac-chip svg{color:var(--ct-accent);}
  .ac-deux{display:grid; grid-template-columns:minmax(0, 1.1fr) minmax(0, 1fr); gap:16px; align-items:start;}
  @media (max-width:860px){ .ac-deux{grid-template-columns:minmax(0, 1fr);} }
  .ac-rec{display:grid; gap:8px; margin:12px 0 14px;}
  .ac-rec button, .ac-act{all:unset; box-sizing:border-box; cursor:pointer; display:flex; align-items:center; gap:12px; width:100%; padding:12px 14px; border-radius:14px; border:1px solid var(--ct-trait); background:var(--ct-surface); color:var(--ink); transition:border-color .15s, background .15s;}
  .ac-rec button:hover, .ac-act:hover{border-color:var(--ct-trait-fort); background:var(--ct-surface-2);}
  .ac-rec button:focus-visible, .ac-act:focus-visible{outline:2px solid var(--ct-accent); outline-offset:2px;}
  .ac-rec button.pret{border-color:rgba(91,224,166,.4); background:rgba(91,224,166,.07);}
  .ac-ico{flex:none; display:grid; place-items:center; width:36px; height:36px; border-radius:11px; background:rgba(79,180,255,.12); color:var(--ct-accent);}
  .ac-rec .pret .ac-ico, .ac-act.fait .ac-ico{background:rgba(91,224,166,.14); color:var(--ct-ok);}
  .ac-tx{flex:1; min-width:0; display:grid; gap:2px;}
  .ac-tx b{font-size:14px;}
  .ac-tx small{font-size:12.5px; color:var(--muted);}
  .ac-tx .ct-barre{margin-top:5px; max-width:240px;}
  .ac-fl{flex:none; color:var(--muted);}
  .ac-nb{flex:none; font-size:12.5px; font-weight:800; color:var(--ct-ok); font-variant-numeric:tabular-nums;}
  .ac-vide-ok{display:flex; align-items:center; gap:10px; padding:14px; margin:12px 0 4px; border-radius:14px; background:rgba(91,224,166,.07); border:1px solid rgba(91,224,166,.25); color:var(--ink-soft); font-size:13.5px;}
  .ac-liste{display:grid; gap:8px; margin-top:12px;}
  .ac-une{display:grid; grid-template-columns:116px minmax(0, 1fr); gap:18px; align-items:center;}
  .ac-une .ct-carte{width:116px;}
  @media (max-width:460px){ .ac-une{grid-template-columns:90px minmax(0, 1fr); gap:14px;} .ac-une .ct-carte{width:90px;} }
  .ac-une h4{margin:0 0 4px; font-size:16px;}
  .ac-une p{margin:0 0 10px; font-size:13px; color:var(--muted); line-height:1.45;}
  .ac-mini{display:flex; flex-wrap:wrap; gap:8px; margin-top:14px;}
  .ac-mini > span{display:inline-flex; align-items:center; gap:7px; padding:7px 11px; border-radius:11px; background:var(--ct-surface-2); font-size:12.5px; color:var(--ink-soft);}
  .ac-mini b{color:var(--ink);}
  .ac-style{border-left:3px solid var(--st, var(--ct-accent));}
  .ac-ev{--ev:#4FB4FF; position:relative; overflow:hidden; margin-bottom:16px; padding:0; border-color:color-mix(in srgb, var(--ev) 38%, transparent);}
  .ac-ev-tete{display:flex; align-items:center; justify-content:space-between; gap:14px; flex-wrap:wrap; padding:20px 22px; background:linear-gradient(120deg, color-mix(in srgb, var(--ev) 26%, transparent), transparent 70%);}
  .ac-ev-tete h3{margin:0; font-size:20px;}
  .ac-ev-tete p{margin:3px 0 0; font-size:13px; color:var(--ink-soft);}
  .ac-med{display:inline-flex; align-items:center; gap:8px; padding:7px 13px; border-radius:99px; background:color-mix(in srgb, var(--ev) 20%, transparent); border:1px solid color-mix(in srgb, var(--ev) 50%, transparent); font-weight:800; font-size:13.5px; font-variant-numeric:tabular-nums;}
  .ac-ev-corps{display:grid; grid-template-columns:minmax(0, 1.2fr) minmax(0, 1fr); gap:18px; padding:0 22px 22px;}
  @media (max-width:820px){ .ac-ev-corps{grid-template-columns:minmax(0, 1fr);} .ac-ev-tete{padding:18px;} .ac-ev-corps{padding:0 18px 18px;} }
  .ac-ev-corps h4{margin:0 0 8px; font-size:12px; letter-spacing:.09em; text-transform:uppercase; color:var(--muted);}
  .ac-ev-desc{margin:0; padding:0 22px 14px; font-size:13.5px; color:var(--ink-soft); line-height:1.5;}
  .ac-ligne{display:flex; align-items:center; gap:12px; padding:11px 12px; border-radius:13px; border:1px solid var(--ct-trait); background:var(--ct-surface);}
  .ac-ligne.pret{border-color:rgba(91,224,166,.4); background:rgba(91,224,166,.07);}
  .ac-ligne.fait{opacity:.6;}
  .ac-ligne + .ac-ligne{margin-top:8px;}
  .ac-ligne .ac-tx b{font-size:13.5px;}
  .ac-ch{margin-bottom:18px;}
  .ac-ch-tete{display:flex; align-items:center; justify-content:space-between; gap:12px; margin:0 2px 10px;}
  .ac-ch-tete h3{margin:0; font-size:16px;}
  .ac-ch-tete small{color:var(--muted); font-size:12.5px; font-variant-numeric:tabular-nums;}
  .ac-diplome{text-align:center; padding:26px 20px;}
  .ac-diplome.ok{border-color:rgba(242,193,78,.5); background:linear-gradient(160deg, rgba(242,193,78,.14), rgba(255,255,255,.03));}
  .ac-diplome h3{margin:8px 0 4px;}
  .ac-slots{display:grid; grid-template-columns:repeat(3, minmax(0, 1fr)); gap:12px; margin-top:12px;}
  .ac-slot{display:grid; gap:8px; align-content:start; padding:12px; border-radius:16px; border:1px solid var(--ct-trait); background:var(--ct-surface); text-align:center;}
  .ac-slot .ct-carte{width:100%; max-width:130px; margin:0 auto;}
  .ac-slot b{font-size:13px;}
  .ac-slot small{font-size:12px; color:var(--muted); font-variant-numeric:tabular-nums;}
  .ac-slot .vide{display:grid; place-items:center; aspect-ratio:3 / 4.2; max-width:130px; margin:0 auto; width:100%; border-radius:12px; border:1.5px dashed var(--ct-trait-fort); color:var(--muted);}
  @media (max-width:460px){ .ac-slots{gap:8px;} .ac-slot{padding:8px;} }
  .ac-cl{display:flex; align-items:center; gap:12px; width:100%; padding:10px 12px; border-radius:13px; border:1px solid var(--ct-trait); background:var(--ct-surface); color:var(--ink); font:inherit; text-align:left;}
  button.ac-cl{all:unset; box-sizing:border-box; cursor:pointer; display:flex; align-items:center; gap:12px; width:100%; padding:10px 12px; border-radius:13px; border:1px solid var(--ct-trait); background:var(--ct-surface); color:var(--ink);}
  button.ac-cl:hover{border-color:var(--ct-trait-fort);}
  button.ac-cl:focus-visible{outline:2px solid var(--ct-accent); outline-offset:2px;}
  .ac-cl.moi{border-color:var(--ct-accent); background:rgba(79,180,255,.1);}
  .ac-cl + .ac-cl, .ac-cl + button.ac-cl, button.ac-cl + button.ac-cl{margin-top:6px;}
  .ac-rg{flex:none; width:34px; text-align:center; font-weight:800; font-size:15px; color:var(--muted); font-variant-numeric:tabular-nums;}
  .ac-rg.p1{color:#F2C14E;} .ac-rg.p2{color:#C9D3DE;} .ac-rg.p3{color:#D58B4D;}
  .ac-av{flex:none; width:38px; height:38px; border-radius:50%; background:var(--ct-surface-2) center / cover no-repeat; border:2px solid transparent;}
  .ac-av.g{width:84px; height:84px; border-width:4px;}
  .ac-av.c-argent{border-color:#C9D3DE;} .ac-av.c-or{border-color:#F2C14E; box-shadow:0 0 14px rgba(242,193,78,.45);}
  .ac-av.c-azur{border-color:#4FB4FF; box-shadow:0 0 14px rgba(79,180,255,.45);}
  .ac-av.c-aurore{border-color:transparent; background-clip:padding-box; box-shadow:0 0 0 3px #ff5c8a, 0 0 0 6px #5cb8ff, 0 0 16px rgba(179,107,255,.5);}
  .ac-val{margin-left:auto; flex:none; font-weight:800; font-variant-numeric:tabular-nums;}
  .ac-val small{font-weight:600; color:var(--muted); margin-left:4px;}
  .ac-moi{display:flex; align-items:baseline; gap:12px; flex-wrap:wrap; margin-bottom:14px;}
  .ac-moi b{font-size:30px; letter-spacing:-.02em;}
  .ac-nv{padding:16px 18px; border-radius:16px; border:1px solid var(--ct-trait); background:var(--ct-surface);}
  .ac-nv + .ac-nv{margin-top:10px;}
  .ac-nv.nouveau{border-color:rgba(79,180,255,.5); background:rgba(79,180,255,.07);}
  .ac-nv h4{margin:0 0 6px; font-size:15.5px; display:flex; align-items:center; gap:10px; flex-wrap:wrap;}
  .ac-nv p{margin:0; font-size:13.5px; color:var(--ink-soft); line-height:1.5;}
  .ac-nv time{display:block; margin-top:8px; font-size:12px; color:var(--muted);}
  .ac-tag{display:inline-block; padding:2px 9px; border-radius:99px; font-size:11px; font-weight:800; letter-spacing:.05em; text-transform:uppercase; background:var(--ct-surface-2); color:var(--ink-soft);}
  .ac-tag.n{background:var(--ct-accent); color:#04101c;}
  .ac-pf{display:flex; align-items:center; gap:18px; flex-wrap:wrap; margin-bottom:16px; padding:20px 22px;}
  .ac-pf h2{margin:0; font-size:24px;}
  .ac-pf .ti{margin-top:4px; font-size:13.5px; color:var(--ct-accent); font-weight:700;}
  .ac-stats{display:grid; grid-template-columns:repeat(auto-fill, minmax(120px, 1fr)); gap:10px;}
  .ac-stat{padding:12px 14px; border-radius:14px; background:var(--ct-surface); border:1px solid var(--ct-trait);}
  .ac-stat b{display:block; font-size:21px; font-variant-numeric:tabular-nums;}
  .ac-stat span{font-size:12px; color:var(--muted);}
  .ac-titres{display:flex; flex-wrap:wrap; gap:8px; margin-top:12px;}
  .ac-titres span{padding:6px 12px; border-radius:99px; background:var(--ct-surface-2); border:1px solid var(--ct-trait); font-size:12.5px; font-weight:600;}
  .ac-titres span.sel{border-color:var(--ct-accent); color:var(--ct-accent);}
  .ac-champs{display:grid; grid-template-columns:repeat(auto-fill, minmax(200px, 1fr)); gap:12px; margin-top:14px;}
  .ac-champ{display:grid; gap:5px; font-size:12.5px; color:var(--muted); font-weight:600;}
  .ac-champ select, .ac-champ input, .ac-champ textarea{height:40px; padding:0 11px; border-radius:11px; border:1px solid var(--ct-trait-fort); background:rgba(255,255,255,.05); color:var(--ink); font:inherit; font-size:14px; min-width:0;}
  .ac-champ textarea{height:84px; padding:9px 11px; resize:vertical;}
  .ac-champ select:focus, .ac-champ input:focus, .ac-champ textarea:focus{outline:none; border-color:var(--ct-accent);}
  .ac-expe{display:grid; grid-template-columns:repeat(3, minmax(0, 1fr)); gap:12px; margin-top:12px;}
  @media (max-width:640px){ .ac-expe{grid-template-columns:minmax(0, 1fr);} }
  .ac-emp{display:grid; gap:8px; justify-items:center; align-content:start; padding:14px; border-radius:16px; border:1px solid var(--ct-trait); background:var(--ct-surface); text-align:center;}
  .ac-emp.pret{border-color:rgba(91,224,166,.45); background:rgba(91,224,166,.07);}
  .ac-emp .ct-carte{width:96px;}
  .ac-emp .vide{display:grid; place-items:center; width:96px; aspect-ratio:3 / 4.2; border-radius:12px; border:1.5px dashed var(--ct-trait-fort); color:var(--muted);}
  .ac-emp b{font-size:13.5px;}
  .ac-emp small{display:inline-flex; align-items:center; gap:5px; font-size:12.5px; color:var(--muted); font-variant-numeric:tabular-nums;}
  .ac-choix{display:grid; grid-template-columns:repeat(auto-fill, minmax(104px, 1fr)); gap:10px; margin-top:14px;}
  .ac-choix button{all:unset; box-sizing:border-box; cursor:pointer; position:relative; border-radius:12px;}
  .ac-choix button:focus-visible{outline:2px solid var(--ct-accent); outline-offset:3px;}
  .ac-choix button:hover .ct-carte{transform:translateY(-3px);}
  .ac-choix .ct-carte{transition:transform .15s;}
  .ac-durees{display:grid; gap:8px; margin:16px 0;}
  .ac-durees button{all:unset; box-sizing:border-box; cursor:pointer; display:flex; align-items:center; justify-content:space-between; gap:12px; padding:13px 15px; border-radius:13px; border:1px solid var(--ct-trait-fort); background:var(--ct-surface); color:var(--ink); font-weight:700;}
  .ac-durees button:hover{border-color:var(--ct-accent);}
  .ac-durees button:focus-visible{outline:2px solid var(--ct-accent); outline-offset:2px;}
  .ac-q{margin:0 2px 12px; font-size:13px; color:var(--muted);}
  .ac-eq-liste{display:grid; gap:8px; margin:14px 0;}
  .ac-eq-lig{display:flex; align-items:center; gap:12px; padding:12px 14px; border-radius:13px; border:1px solid var(--ct-trait); background:var(--ct-surface);}
  .ac-eq-lig .ac-tx{flex:1;}
  .ac-eq-lig .puce{width:10px; height:10px; border-radius:50%; background:var(--ct-ok); flex:none;}
  .ac-eq-lig .puce.off{background:var(--muted);}
  .ac-sous{margin:18px 0 8px; font-size:12px; letter-spacing:.09em; text-transform:uppercase; color:var(--muted);}
  .ac-rang{display:grid; grid-template-columns:minmax(0, 2fr) 190px 80px 90px 40px; gap:8px; align-items:end; margin-bottom:8px;}
  .ac-rang.r{grid-template-columns:minmax(0, 2fr) 110px 90px 100px 40px;}
  @media (max-width:640px){ .ac-rang, .ac-rang.r{grid-template-columns:minmax(0, 1fr) 1fr; padding-bottom:10px; border-bottom:1px solid var(--ct-trait);} .ac-rang > :first-child{grid-column:1 / -1;} }
  .ac-rang .ac-champ select, .ac-rang .ac-champ input{height:38px;}
  .ac-sup{all:unset; cursor:pointer; box-sizing:border-box; display:grid; place-items:center; width:38px; height:38px; border-radius:10px; color:var(--muted); border:1px solid var(--ct-trait);}
  .ac-sup:hover{color:#ff7a7a; border-color:#ff7a7a;}
  .ac-sup:focus-visible{outline:2px solid var(--ct-accent); outline-offset:2px;}
  .ac-actions{display:flex; gap:10px; flex-wrap:wrap; margin-top:16px;}
  `;

  function poserCss(){
    if(document.getElementById('ac-style')) return;
    const s = document.createElement('style');
    s.id = 'ac-style';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  // ---------------------------------------------------------------------
  // La coquille et la navigation
  // ---------------------------------------------------------------------

  function badges(){
    const d = ST.d;
    if(!d) return {};
    const p = d.pretes || {};
    return {
      accueil: (p.succes || 0) + (p.artiste || 0),
      evenements: p.evenements || 0,
      parcours: p.parcours || 0,
      quetes: (p.defis || 0) + (p.expeditions || 0),
      nouveautes: d.nouveautes || 0
    };
  }

  function dessinerBarre(){
    if(!H) return;
    const b = badges();
    H.querySelectorAll('[data-ac-vue]').forEach((x) => {
      const v = x.dataset.acVue, on = v === ST.vue;
      x.classList.toggle('actif', on);
      x.setAttribute('aria-selected', on);
      const lib = SOUS.find((s) => s[0] === v)[1];
      x.innerHTML = A.esc(lib) + (on ? '' : puce(b[v] || 0));
    });
  }

  async function monter(hote, api){
    A = api;
    H = hote;
    poserCss();

    hote.innerHTML = `
      <div class="ac">
        <div class="ac-barre"><div class="ct-segment" role="tablist" aria-label="Accueil">
          ${SOUS.map(([v, l]) => `<button type="button" data-ac-vue="${v}" role="tab">${A.esc(l)}</button>`).join('')}
        </div></div>
        <div class="ac-corps"></div>
      </div>`;

    hote.querySelectorAll('[data-ac-vue]').forEach((b) => b.addEventListener('click', () => { ST.cible = null; ST.ed = null; afficher(b.dataset.acVue); }));
    dessinerBarre();
    await afficher(ST.vue);
  }

  async function afficher(vue){
    if(!H) return;
    clearInterval(ST.t);
    ST.vue = vue;
    const n = ++ST.n;
    const vivant = () => !!H && n === ST.n;
    dessinerBarre();
    const corps = H.querySelector('.ac-corps');
    if(!corps) return;
    if(!corps.querySelector('.ct-panneau, .ac-hero')) corps.innerHTML = '<div class="ct-vide">Chargement…</div>';
    try{
      if(!ST.d || vue === 'accueil') await actualiserResume();
      if(!vivant()) return;
      dessinerBarre();
      if(vue === 'accueil') await vueAccueil(corps, vivant);
      else if(vue === 'evenements') await vueEvenements(corps, vivant);
      else if(vue === 'parcours') await vueParcours(corps, vivant);
      else if(vue === 'quetes') await vueQuetes(corps, vivant);
      else if(vue === 'classements') await vueClassements(corps, vivant);
      else if(vue === 'nouveautes') await vueNouveautes(corps, vivant);
      else await vueProfil(corps, vivant);
    }catch(e){
      if(vivant()) corps.innerHTML = `<div class="ct-panneau ct-vide"><b>Cette page ne répond pas</b>${A.esc(e.message)}</div>`;
    }
  }

  async function actualiserResume(){
    ST.d = await A.appel('quotidien_accueil');
  }

  // Aller vers un onglet de cartes.js ou vers une de nos pages
  function aller(cible){
    if(SOUS.some((s) => s[0] === cible)){ ST.cible = null; afficher(cible); return; }
    A.changerVue(cible);
  }

  // ---------------------------------------------------------------------
  // Aujourd'hui
  // ---------------------------------------------------------------------

  const salut = () => {
    const h = Number(new Date().toLocaleString('fr-FR', { hour: '2-digit', hour12: false, timeZone: 'Europe/Paris' }));
    return h >= 5 && h < 18 ? 'Bonjour' : 'Bonsoir';
  };

  async function vueAccueil(corps, vivant){

    const d = ST.d;
    const [cad, coffre, mis, roue] = await Promise.all([A.appel('jeu_cadeau'), A.appel('jeu_coffre'), A.appel('jeu_missions'), A.appel('jeu_roue')]);
    if(!vivant()) return;

    const quetes = [].concat(mis.jour || [], mis.semaine || []);
    const missionsPretes = quetes.filter((q) => q.progres >= q.objectif && !q.prise).length
      + [mis.bonus_jour, mis.bonus_semaine].filter((b) => b && b.pret && !b.pris).length;
    const coffrePrets = (coffre.cadeaux || []).filter((x) => x.etat === 'pret').length;
    const p = d.pretes || {};

    const aRecup = [
      cad.pret ? { ic: 'cadeau', t: 'Cadeau de connexion', s: 'Jour ' + cad.jour + ' de ta série : ' + A.gainsTexte(cad.cadeaux[cad.jour - 1]), v: 'bonus' } : null,
      coffrePrets ? { ic: 'coffre', t: 'Coffre', s: A.pluriel(coffrePrets, 'créneau', 'créneaux') + ' à prendre', v: 'bonus' } : null,
      missionsPretes ? { ic: 'cible', t: 'Missions', s: A.pluriel(missionsPretes, 'récompense prête', 'récompenses prêtes'), v: 'missions' } : null,
      p.succes ? { ic: 'trophee', t: 'Succès', s: A.pluriel(p.succes, 'succès atteint', 'succès atteints'), v: 'succes' } : null,
      p.parcours ? { ic: 'drapeau', t: 'Parcours du collectionneur', s: A.pluriel(p.parcours, 'étape accomplie', 'étapes accomplies'), v: 'parcours' } : null,
      p.evenements ? { ic: 'calendrier', t: 'Événement', s: A.pluriel(p.evenements, 'mission accomplie', 'missions accomplies') + ' : des médailles à prendre', v: 'evenements' } : null,
      p.defis ? { ic: 'cible', t: 'Défis de la semaine', s: A.pluriel(p.defis, 'défi relevé', 'défis relevés'), v: 'quetes' } : null,
      p.expeditions ? { ic: 'boussole', t: 'Expéditions', s: A.pluriel(p.expeditions, 'carte rentrée', 'cartes rentrées'), v: 'quetes' } : null,
      p.artiste ? { ic: 'etoile', t: 'Artiste du jour', s: 'Tu as sa carte : un bonus t\'attend', v: 'evenements' } : null
    ].filter(Boolean);

    const jourFaits = (mis.jour || []).filter((q) => q.progres >= q.objectif).length;
    const jourTotal = (mis.jour || []).length;
    const prog = d.programme || {};
    const art = prog.artiste;
    const ev = (d.evenements || [])[0];
    const c = d.combat;

    const act = (ic, titre, detail, a, b, v, fait) => `
      <button type="button" class="ac-act${fait ? ' fait' : ''}" data-aller="${v}">
        <span class="ac-ico">${A.ico(fait ? 'coche' : ic, 19)}</span>
        <span class="ac-tx"><b>${A.esc(titre)}</b><small>${detail}</small>${b ? barre(a, b, fait) : ''}</span>
        <span class="ac-fl">${A.ico('fleche', 16)}</span>
      </button>`;

    corps.innerHTML = `
      <section class="ac-hero">
        <div><h2>${salut()}, ${A.esc(d.pseudo)}</h2><p>${d.serie > 0 ? 'Série de ' + A.pluriel(d.serie, 'jour') + '. ' : ''}Voilà ce qui t'attend aujourd'hui.</p></div>
        <div class="ac-chips">
          <span class="ac-chip">${A.ico('eclair', 15)}Niveau ${A.nf(d.niveau)}</span>
          <span class="ac-chip">${A.ico('horloge', 15)}${d.serie > 0 ? A.pluriel(d.serie, 'jour') : 'Pas de série'}</span>
          <button type="button" class="ac-chip" data-aller="parcours" style="cursor:pointer; font-family:inherit; font-size:13px; font-weight:700; color:inherit">${A.ico('drapeau', 15)}Parcours ${d.parcours.pris} / ${d.parcours.total}</button>
        </div>
      </section>

      <div class="ac-deux">
        <section class="ct-panneau">
          <div class="ct-entete-panneau"><div><h3>À récupérer</h3><p class="sous">${aRecup.length ? 'Tout ce qui est prêt maintenant.' : 'Reviens plus tard.'}</p></div>
            ${aRecup.length ? `<button type="button" class="ct-btn principal petit" data-tout>Tout récupérer</button>` : ''}</div>
          ${aRecup.length
            ? `<div class="ac-rec">${aRecup.map((r) => `
                <button type="button" class="pret" data-aller="${r.v}"><span class="ac-ico">${A.ico(r.ic, 19)}</span><span class="ac-tx"><b>${A.esc(r.t)}</b><small>${A.esc(r.s)}</small></span><span class="ac-fl">${A.ico('fleche', 16)}</span></button>`).join('')}</div>`
            : `<div class="ac-vide-ok">${A.ico('coche', 19)}<span>Tout est récupéré. Les prochaines récompenses arrivent avec les missions, le coffre et demain.</span></div>`}
        </section>

        <section class="ct-panneau">
          <div class="ct-entete-panneau"><div><h3>Aujourd'hui</h3><p class="sous">Où tu en es, et où aller.</p></div><span class="ct-puce-temps">${A.ico('horloge', 14)}${A.duree(prog.fin_jour || 0)}</span></div>
          <div class="ac-liste">
            ${act('cible', 'Missions du jour', A.nf(jourFaits) + ' / ' + A.nf(jourTotal) + (jourFaits >= jourTotal && jourTotal ? ' : terminées' : ''), jourFaits, jourTotal, 'missions', jourTotal && jourFaits >= jourTotal)}
            ${act('roue', 'Roue du jour', roue.prete ? 'Un tour gratuit t\'attend' : 'Déjà tournée, reviens demain', 0, 0, 'bonus', !roue.prete)}
            ${c ? act('combat', 'Combat', (c.defi_fait ? 'Défi du jour réussi' : 'Défi du jour à relever') + ' · ' + A.pluriel(c.pvp_restants, 'duel') + ' restant' + (c.pvp_restants > 1 ? 's' : ''), 0, 0, 'combat', c.defi_fait) : ''}
            ${act('marche', 'Marché', d.marche.annonces ? A.pluriel(d.marche.annonces, 'annonce en cours', 'annonces en cours') : 'Aucune annonce en cours', 0, 0, 'marche', false)}
            ${ev ? act('calendrier', ev.nom, 'Encore ' + A.pluriel(ev.jours_restants, 'jour'), 0, 0, 'evenements', false) : ''}
            ${act('boussole', 'Expéditions', A.nf(d.expeditions.en_cours) + ' / 3 cartes en tournée', d.expeditions.en_cours, 3, 'quetes', false)}
          </div>
        </section>
      </div>

      ${art ? `
      <section class="ct-panneau" style="margin-top:16px">
        <div class="ct-entete-panneau"><div><h3>Mises en avant du jour</h3><p class="sous">Le programme change chaque jour à minuit.</p></div><button type="button" class="ct-btn petit" data-aller="evenements">Voir le programme</button></div>
        <div class="ac-une">
          <div>${A.carteHtml({ nom: art.nom, photo: art.photo, rarete: art.rarete, numero: art.numero, holo: art.holo }, { verrou: !art.possede })}</div>
          <div>
            <h4>Artiste du jour : ${A.esc(art.nom)}</h4>
            <p>${art.possede ? (art.pris ? 'Bonus du jour récupéré.' : 'Tu as sa carte : +' + art.bonus + ' vinyle' + (art.bonus > 1 ? 's' : '') + ' à prendre.') : 'Obtiens sa carte pour toucher le bonus du jour.'}</p>
            ${art.possede && !art.pris ? `<button type="button" class="ct-btn principal petit" data-artiste>Récupérer +${art.bonus}</button>` : ''}
            <div class="ac-mini">
              ${prog.style ? `<span>${A.ico('son', 14)}Style du jour : <b style="color:${hex(prog.style.couleur)}">${A.esc(prog.style.nom)}</b></span>` : ''}
              <span>${A.ico('etoile', 14)}${prog.heure_holo ? '<b>Heure du holo</b> : les cartes holo sont deux fois plus fréquentes' : 'Heure du holo dans <b>' + A.duree(prog.holo_dans || 0) + '</b>'}</span>
              ${prog.lundi ? `<span>${A.ico('eclair', 14)}<b>Lundi</b> : les raretés sont doublées</span>` : ''}
            </div>
          </div>
        </div>
      </section>` : ''}`;

    corps.querySelectorAll('[data-aller]').forEach((b) => b.addEventListener('click', () => aller(b.dataset.aller)));

    const ba = corps.querySelector('[data-artiste]');
    if(ba) ba.addEventListener('click', async () => {
      ba.disabled = true;
      try{
        const r = await A.appel('quotidien_artiste_prendre');
        apres(r.etat); A.Son.jouer('gain'); A.vibre(20);
        A.toast('Artiste du jour : +' + A.nf(r.gain) + ' vinyle' + (r.gain > 1 ? 's' : ''));
        afficher('accueil');
      }catch(e){ erreur(e); ba.disabled = false; }
    });

    const tout = corps.querySelector('[data-tout]');
    if(tout) tout.addEventListener('click', () => toutRecuperer(tout, { cad, coffre }));
  }

  // « Tout récupérer » enchaîne les fonctions déjà là (cadeau, coffre, missions, succès) puis celle du quotidien.
  async function toutRecuperer(bouton, { cad, coffre }){
    bouton.disabled = true;
    let vinyles = 0, garantis = 0, prises = 0, echecs = 0;
    const ajoute = (g) => { if(g){ vinyles += A.vin(g); garantis += Number(g.garantis) || 0; } prises++; };
    const essaie = async (nom, args) => {
      try{ const r = await A.appel(nom, args); apres(r.etat); return r; }catch(e){ echecs++; return null; }
    };

    if(cad && cad.pret){ const r = await essaie('jeu_cadeau_prendre'); if(r) ajoute(r.gain); }
    for(const x of ((coffre && coffre.cadeaux) || []).filter((y) => y.etat === 'pret')){
      const r = await essaie('jeu_coffre_prendre', { p_cle: x.cle }); if(r) ajoute(r.gain);
    }
    let mis = null;
    try{ mis = await A.appel('jeu_missions'); }catch(e){ mis = null; }
    if(mis){
      for(const q of [].concat(mis.jour || [], mis.semaine || [])){
        if(q.progres >= q.objectif && !q.prise){ const r = await essaie('jeu_mission_prendre', { p_cle: q.cle }); if(r) ajoute(r.gain); }
      }
      try{ mis = await A.appel('jeu_missions'); }catch(e){ mis = null; }
      for(const b of mis ? [mis.bonus_jour, mis.bonus_semaine] : []){
        if(b && b.pret && !b.pris){ const r = await essaie('jeu_mission_prendre', { p_cle: b.cle }); if(r) ajoute(r.gain); }
      }
    }
    if(ST.d && ST.d.pretes && ST.d.pretes.succes){
      let liste = [];
      try{ liste = (await A.appel('jeu_succes')).succes || []; }catch(e){ liste = []; }
      for(const s of liste.filter((y) => y.atteint && !y.pris)){ const r = await essaie('jeu_succes_prendre', { p_id: s.id }); if(r) ajoute(r.gain); }
    }
    const q = await essaie('quotidien_tout_prendre');
    if(q){ vinyles += Number(q.gain) || 0; prises += Number(q.prises) || 0; }

    A.majEntete();
    if(prises > 0){
      A.Son.jouer('gain'); A.vibre([20, 30, 20]);
      A.toast('Récupéré : ' + (vinyles ? '+' + A.nf(vinyles) + ' vinyles' : A.pluriel(prises, 'récompense')) + (garantis ? ' et un pack Épique garanti' : '') + (echecs ? ' (' + echecs + ' à refaire)' : ''));
    }else{
      A.toast(echecs ? 'Certaines récompenses n\'ont pas pu être prises.' : 'Rien à récupérer pour l\'instant.', echecs ? 'err' : undefined);
    }
    afficher('accueil');
  }

  // ---------------------------------------------------------------------
  // Événements et programme du jour
  // ---------------------------------------------------------------------

  async function vueEvenements(corps, vivant){

    const [prog, evs] = await Promise.all([A.appel('quotidien_programme'), A.appel('quotidien_evenements')]);
    if(!vivant()) return;
    const art = prog.artiste;

    const carteEv = (e) => {
      const fait = e.missions.filter((m) => m.prise).length;
      return `
      <section class="ct-panneau ac-ev" style="--ev:${hex(e.accent)}">
        <div class="ac-ev-tete">
          <div><h3>${A.esc(e.nom)}</h3><p>${A.esc(e.sous_titre)}${e.sous_titre ? ' · ' : ''}${A.esc(date(e.debut))} au ${A.esc(date(e.fin))}</p></div>
          ${e.en_cours
            ? `<div style="display:flex; gap:8px; flex-wrap:wrap"><span class="ct-puce-temps">${A.ico('horloge', 14)}${e.jours_restants > 1 ? e.jours_restants + ' jours' : 'dernier jour'}</span><span class="ac-med" title="${A.esc(e.medaille)}">${A.ico('etoile', 15)}${A.nf(e.medailles)} ${A.esc(e.medaille.toLowerCase())}</span></div>`
            : `<span class="ct-puce-temps">${A.ico('calendrier', 14)}dans ${A.pluriel(e.dans_jours, 'jour')}</span>`}
        </div>
        ${e.description ? `<p class="ac-ev-desc">${A.esc(e.description)}</p>` : ''}
        <div class="ac-ev-corps">
          <div>
            <h4>Missions · ${fait} / ${e.missions.length}</h4>
            ${e.missions.map((m) => {
              const pret = m.progres >= m.objectif;
              return `
              <div class="ac-ligne${m.prise ? ' fait' : (pret ? ' pret' : '')}">
                <span class="ac-ico">${A.ico(m.prise ? 'coche' : 'cible', 18)}</span>
                <div class="ac-tx"><b>${A.esc(m.libelle)}</b>${barre(Math.min(m.progres, m.objectif), m.objectif)}<small>${A.nf(Math.min(m.progres, m.objectif))} / ${A.nf(m.objectif)} · +${m.medailles} ${A.esc(e.medaille.toLowerCase())}</small></div>
                ${m.prise || !e.en_cours ? '' : `<button type="button" class="ct-btn ${pret ? 'principal' : ''} petit" data-mission="${m.id}" ${pret ? '' : 'disabled'}>Récupérer</button>`}
              </div>`;
            }).join('') || '<div class="ct-vide">Pas de mission.</div>'}
          </div>
          <div>
            <h4>Boutique de médailles</h4>
            ${e.recompenses.map((r) => `
              <div class="ac-ligne${r.prise ? ' fait' : ''}">
                <span class="ac-ico">${A.ico(r.garantis ? 'pack' : 'vinyle', 18)}</span>
                <div class="ac-tx"><b>${A.esc(r.libelle)}</b><small>${A.nf(r.cout)} ${A.esc(e.medaille.toLowerCase())}</small></div>
                ${r.prise ? '' : `<button type="button" class="ct-btn ${e.medailles >= r.cout ? 'principal' : ''} petit" data-recompense="${r.id}" ${e.en_cours && e.medailles >= r.cout ? '' : 'disabled'}>Échanger</button>`}
              </div>`).join('') || '<div class="ct-vide">Pas de récompense.</div>'}
          </div>
        </div>
      </section>`;
    };

    corps.innerHTML = `
      <section class="ct-panneau" style="margin-bottom:16px">
        <div class="ct-entete-panneau"><div><h3>Programme du jour</h3><p class="sous">Il change chaque jour à minuit.</p></div><span class="ct-puce-temps">${A.ico('horloge', 14)}${A.duree(prog.fin_jour)}</span></div>
        ${art ? `
        <div class="ac-une">
          <div>${A.carteHtml({ nom: art.nom, photo: art.photo, rarete: art.rarete, numero: art.numero, holo: art.holo }, { verrou: !art.possede })}</div>
          <div>
            <h4>Artiste du jour : ${A.esc(art.nom)}</h4>
            <p>${art.possede ? (art.pris ? 'Bonus du jour récupéré, reviens demain.' : 'Tu as sa carte : +' + art.bonus + ' vinyle' + (art.bonus > 1 ? 's' : '') + ' à prendre' + (art.holo ? ' (holo comprise).' : '. En holo, le bonus double.')) : 'Obtiens sa carte, de sa collection, pour toucher +1 vinyle (+2 en holo).'}</p>
            ${art.possede && !art.pris ? `<button type="button" class="ct-btn principal petit" data-artiste>Récupérer +${art.bonus}</button>` : ''}
          </div>
        </div>` : '<div class="ct-vide">Pas d\'artiste à l\'honneur pour l\'instant.</div>'}
        <div class="ac-mini">
          ${prog.style ? `<span class="ac-style" style="--st:${hex(prog.style.couleur)}">${A.ico('son', 14)}Style du jour : <b style="color:${hex(prog.style.couleur)}">${A.esc(prog.style.nom)}</b> · ${A.esc(prog.style.citation || '')}</span>` : ''}
          <span>${A.ico('etoile', 14)}${prog.heure_holo ? '<b>Heure du holo</b> : les cartes holo sont deux fois plus fréquentes jusqu\'à 22 h' : 'Prochaine heure du holo (21 h) dans <b>' + A.duree(prog.holo_dans) + '</b>'}</span>
          ${prog.lundi ? `<span>${A.ico('eclair', 14)}<b>Lundi</b> : les raretés sont doublées toute la journée</span>` : ''}
        </div>
      </section>

      ${evs.length ? evs.map(carteEv).join('') : `<section class="ct-panneau ct-vide"><b>Pas d'événement en ce moment</b>Les prochains arrivent ici, avec leurs missions et leurs récompenses.</section>`}`;

    const ba = corps.querySelector('[data-artiste]');
    if(ba) ba.addEventListener('click', async () => {
      ba.disabled = true;
      try{
        const r = await A.appel('quotidien_artiste_prendre');
        apres(r.etat); A.Son.jouer('gain'); A.vibre(20);
        A.toast('Artiste du jour : +' + A.nf(r.gain) + ' vinyle' + (r.gain > 1 ? 's' : ''));
        ST.d = null; afficher('evenements');
      }catch(e){ erreur(e); ba.disabled = false; }
    });

    corps.querySelectorAll('[data-mission]').forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true;
      try{
        const r = await A.appel('quotidien_ev_mission_prendre', { p_id: Number(b.dataset.mission) });
        A.Son.jouer('gain'); A.vibre(15);
        A.toast('+' + A.nf(r.medailles) + ' médaille' + (r.medailles > 1 ? 's' : ''));
        ST.d = null; afficher('evenements');
      }catch(e){ erreur(e); b.disabled = false; }
    }));

    corps.querySelectorAll('[data-recompense]').forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true;
      try{
        const r = await A.appel('quotidien_ev_recompense_prendre', { p_id: Number(b.dataset.recompense) });
        apres(r.etat); A.Son.jouer('gain'); A.vibre(20);
        A.toast('Échangé : ' + A.gainsTexte(r.gain));
        ST.d = null; afficher('evenements');
      }catch(e){ erreur(e); b.disabled = false; }
    }));
  }

  // ---------------------------------------------------------------------
  // Le parcours du collectionneur
  // ---------------------------------------------------------------------

  async function vueParcours(corps, vivant){

    const p = await A.appel('quotidien_parcours');
    if(!vivant()) return;
    const etapes = p.etapes || [];
    const prets = etapes.filter((e) => e.atteint && !e.pris);

    const chap = (n) => {
      const l = etapes.filter((e) => e.chapitre === n);
      return `
      <section class="ac-ch">
        <div class="ac-ch-tete"><h3>${n}. ${A.esc(CHAPITRES[n - 1] || 'Chapitre ' + n)}</h3><small>${l.filter((e) => e.pris).length} / ${l.length}</small></div>
        <div class="ct-liste">${l.map((e) => `
          <div class="ct-ligne${e.pris ? ' fait' : (e.atteint ? ' pret' : '')}">
            <span class="ct-pastille-ico">${A.ico(e.pris ? 'coche' : 'drapeau', 19)}</span>
            <div class="tx">
              <b>${A.esc(e.nom)}</b>
              <div style="font-size:12.5px; color:var(--muted); margin-top:2px">${A.esc(e.description)}</div>
              ${e.seuil > 1 ? `<div class="bas">${barre(Math.min(e.progres, e.seuil), e.seuil)}<small>${A.nf(Math.min(e.progres, e.seuil))} / ${A.nf(e.seuil)}</small></div>` : ''}
              ${e.pris ? '' : gainPuces({ vinyles: e.vinyles * 50 })}
            </div>
            ${e.pris ? '' : `<button type="button" class="ct-btn ${e.atteint ? 'principal' : ''} petit" data-etape="${A.esc(e.id)}" ${e.atteint ? '' : 'disabled'}>Récupérer</button>`}
          </div>`).join('')}</div>
      </section>`;
    };

    const dip = p.diplome;
    corps.innerHTML = `
      <section class="ct-panneau ct-prog" style="margin-bottom:18px">
        <div class="ct-prog-chiffre">${p.pris}<small> / ${p.total}</small></div>
        <div class="ct-prog-droite">
          <div class="lib"><span>étapes accomplies</span>${prets.length ? `<button type="button" class="ct-btn principal petit" data-tout>Tout récupérer (${prets.length})</button>` : ''}</div>
          <div class="ct-barre or"><i style="width:${pct(p.pris, p.total)}%"></i></div>
        </div>
      </section>
      ${[1, 2, 3, 4, 5, 6].map(chap).join('')}
      <section class="ct-panneau ac-diplome${dip.pret ? ' ok' : ''}">
        ${A.ico('trophee', 34)}
        <h3>Diplôme du collectionneur</h3>
        <p class="sous" style="margin:0 0 14px">${dip.pris ? 'Tu as terminé le parcours. Bravo, le titre « Diplômé du parcours » est à toi.' : (dip.pret ? 'Les 30 étapes sont faites : récupère ton diplôme.' : 'Termine les 30 étapes pour le décrocher.')}</p>
        ${dip.pris ? '' : `<button type="button" class="ct-btn ${dip.pret ? 'principal' : ''}" data-diplome ${dip.pret ? '' : 'disabled'}>Récupérer : +${dip.vinyles} vinyles</button>`}
      </section>`;

    const prendre = async (id) => { const r = await A.appel('quotidien_parcours_prendre', { p_id: id }); apres(r.etat); return r; };

    corps.querySelectorAll('[data-etape]').forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true;
      try{ const r = await prendre(b.dataset.etape); A.Son.jouer('gain'); A.vibre(20); A.toast('Étape validée : +' + A.nf(r.gain) + ' vinyle' + (r.gain > 1 ? 's' : '')); ST.d = null; afficher('parcours'); }
      catch(e){ erreur(e); b.disabled = false; }
    }));

    const bd = corps.querySelector('[data-diplome]');
    if(bd) bd.addEventListener('click', async () => {
      bd.disabled = true;
      try{ const r = await prendre('diplome'); A.Son.jouer('r5'); A.vibre([25, 40, 25]); A.toast('Diplôme obtenu : +' + A.nf(r.gain) + ' vinyles'); ST.d = null; afficher('parcours'); }
      catch(e){ erreur(e); bd.disabled = false; }
    });

    const tout = corps.querySelector('[data-tout]');
    if(tout) tout.addEventListener('click', async () => {
      tout.disabled = true;
      let v = 0;
      for(const e of prets){ try{ const r = await prendre(e.id); v += r.gain; }catch(err){ /* déjà pris : on passe */ } }
      A.Son.jouer('gain'); A.toast('Récupéré : +' + A.nf(v) + ' vinyles');
      ST.d = null; afficher('parcours');
    });
  }

  // ---------------------------------------------------------------------
  // Quêtes : expéditions et défis de la semaine
  // ---------------------------------------------------------------------

  // Le choix d'une carte dans la collection du joueur (même geste que la mise en vente)
  async function choisirCarte(titre, texte, apresChoix){
    const f = A.fenetre(`<h2>${A.esc(titre)}</h2><p class="sous">${A.esc(texte)}</p><div data-zone><div class="ct-vide">Chargement…</div></div>`, true);
    const zone = f.corps.querySelector('[data-zone]');
    let cls = [];
    try{ cls = await A.appel('jeu_classeurs'); }catch(e){ cls = []; }
    if(!cls.length){ zone.innerHTML = '<div class="ct-vide"><b>Aucune collection</b>Ouvre des packs pour avoir des cartes.</div>'; return; }
    let id = (cls.find((c) => Number(c.possedees) > 0) || cls[0]).id;
    const cache = {};

    async function cartesDe(b){
      if(cache[b]) return cache[b];
      let toutes = [];
      for(let page = 1; page <= 5; page++){
        const r = await A.appel('jeu_classeur_lire', { p_booster: b, p_page: page, p_vue: 'possedees', p_tri: 'nom' });
        toutes = toutes.concat(r.cartes || []);
        if(page >= (r.pages || 1)) break;
      }
      return (cache[b] = toutes);
    }

    async function dessiner(){
      let cartes = [];
      try{ cartes = await cartesDe(id); }catch(e){ zone.innerHTML = `<div class="ct-vide">${A.esc(e.message)}</div>`; return; }
      zone.innerHTML = `
        <div class="ct-segment" role="group" aria-label="Collection">${cls.map((c) => `<button type="button" data-cl="${A.esc(c.id)}" class="${c.id === id ? 'actif' : ''}" aria-pressed="${c.id === id}">${A.esc(c.nom)}</button>`).join('')}</div>
        ${cartes.length
          ? `<div class="ac-choix">${cartes.map((c, i) => `<button type="button" data-i="${i}" aria-label="${A.esc(c.nom)}">${A.carteHtml(c, {})}</button>`).join('')}</div>`
          : '<div class="ct-vide"><b>Aucune carte ici</b>Ouvre des packs de cette collection.</div>'}`;
      zone.querySelectorAll('[data-cl]').forEach((b) => b.addEventListener('click', () => { id = b.dataset.cl; dessiner(); }));
      zone.querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', () => apresChoix(f, cartes[Number(b.dataset.i)])));
    }
    await dessiner();
  }

  async function vueQuetes(corps, vivant){

    const [ex, df] = await Promise.all([A.appel('quotidien_expeditions'), A.appel('quotidien_defis')]);
    if(!vivant()) return;

    const slots = [];
    for(let i = 0; i < ex.emplacements; i++) slots.push(ex.en_cours[i] || null);

    corps.innerHTML = `
      <section class="ct-panneau" style="margin-bottom:16px">
        <div class="ct-entete-panneau"><div><h3>Expéditions</h3><p class="sous">Envoie jusqu'à 3 cartes en tournée : elles reviennent avec des vinyles, plus si elles sont rares.</p></div>
          <span class="ct-puce-temps" title="Vinyles rapportés aujourd'hui, plafond ${ex.plafond_jour}">${A.ico('vinyle', 14)}${ex.gagne_jour} / ${ex.plafond_jour} aujourd'hui</span></div>
        <div class="ac-expe">${slots.map((x) => x
          ? `<div class="ac-emp${x.prete ? ' pret' : ''}">
              ${A.carteHtml({ nom: x.nom, photo: x.photo, rarete: x.rarete, numero: x.numero, holo: x.holo }, {})}
              ${x.prete
                ? `<small>De retour : +${x.gain} vinyle${x.gain > 1 ? 's' : ''}</small><button type="button" class="ct-btn principal petit" data-rentrer="${x.id}">Récupérer</button>`
                : `<small data-fin="${Date.now() + x.restant * 1000}">${A.ico('horloge', 12)} ${A.duree(x.restant)}</small>`}
            </div>`
          : `<div class="ac-emp"><span class="vide">${A.ico('boussole', 26)}</span><b>Emplacement libre</b><button type="button" class="ct-btn petit" data-envoyer>Envoyer une carte</button></div>`).join('')}
        </div>
      </section>

      <section class="ct-panneau">
        <div class="ct-entete-panneau"><div><h3>Défis de la semaine</h3><p class="sous">Trois défis tirés chaque lundi.</p></div><span class="ct-puce-temps">${A.ico('horloge', 14)}${A.duree(df.fin_semaine)}</span></div>
        <div class="ct-liste" style="margin-top:12px">${df.defis.map((d) => {
          const pret = d.progres >= d.objectif;
          return `
          <div class="ct-ligne${d.prise ? ' fait' : (pret ? ' pret' : '')}">
            <span class="ct-pastille-ico">${A.ico(d.prise ? 'coche' : 'cible', 19)}</span>
            <div class="tx">
              <b>${A.esc(d.libelle)}</b>
              <div class="bas">${barre(Math.min(d.progres, d.objectif), d.objectif)}<small>${A.nf(Math.min(d.progres, d.objectif))} / ${A.nf(d.objectif)}</small></div>
              ${d.prise ? '' : gainPuces({ tirages: d.vinyles })}
            </div>
            ${d.prise ? '' : `<button type="button" class="ct-btn ${pret ? 'principal' : ''} petit" data-defi="${A.esc(d.id)}" ${pret ? '' : 'disabled'}>Récupérer</button>`}
          </div>`;
        }).join('')}</div>
      </section>`;

    // Les comptes à rebours : à zéro, on recharge la page
    ST.t = setInterval(() => {
      if(!H || !H.isConnected){ clearInterval(ST.t); return; }
      let fini = false;
      H.querySelectorAll('[data-fin]').forEach((e) => {
        const s = Math.floor((Number(e.dataset.fin) - Date.now()) / 1000);
        if(s <= 0) fini = true;
        else e.innerHTML = A.ico('horloge', 12) + ' ' + A.duree(s);
      });
      if(fini){ clearInterval(ST.t); ST.d = null; afficher('quetes'); }
    }, 1000);

    corps.querySelectorAll('[data-rentrer]').forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true;
      try{
        const r = await A.appel('quotidien_expedition_prendre', { p_id: Number(b.dataset.rentrer) });
        apres(r.etat); A.Son.jouer('gain'); A.vibre(20);
        A.toast(r.gain > 0 ? 'Expédition : +' + A.nf(r.gain) + ' vinyle' + (r.gain > 1 ? 's' : '') + (r.plafonne ? ' (plafond du jour atteint)' : '') : 'Plafond du jour atteint : rien de plus aujourd\'hui.');
        ST.d = null; afficher('quetes');
      }catch(e){ erreur(e); b.disabled = false; }
    }));

    corps.querySelectorAll('[data-defi]').forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true;
      try{
        const r = await A.appel('quotidien_defi_prendre', { p_id: b.dataset.defi });
        apres(r.etat); A.Son.jouer('gain'); A.vibre(20);
        A.toast('Défi relevé : +' + A.nf(r.gain) + ' vinyles');
        ST.d = null; afficher('quetes');
      }catch(e){ erreur(e); b.disabled = false; }
    }));

    corps.querySelectorAll('[data-envoyer]').forEach((b) => b.addEventListener('click', () => {
      choisirCarte('Envoyer en expédition', 'Choisis la carte qui part en tournée. Plus elle est rare, plus elle rapporte.', (f, c) => etapeDuree(f, c));
    }));
  }

  function etapeDuree(f, c){
    const holo = Number(c.normales || 0) > 0 ? false : Number(c.holos || 0) > 0;
    f.corps.innerHTML = `
      <h2>${A.esc(c.nom)} part en tournée</h2>
      <p class="sous">Combien de temps ? Plus c'est long, plus elle rapporte. Un plafond de 8 vinyles par jour s'applique.</p>
      <div class="ac-durees">${DUREES.map(([h, l]) => `<button type="button" data-h="${h}"><span>${l}</span><span class="ct-gain v">${A.ico('vinyle', 13)}+${gainExpe(h, Number(c.rarete) || 1)}</span></button>`).join('')}</div>`;
    f.corps.querySelectorAll('[data-h]').forEach((b) => b.addEventListener('click', async () => {
      f.corps.querySelectorAll('[data-h]').forEach((x) => { x.disabled = true; });
      try{
        await A.appel('quotidien_expedition_envoyer', { p_booster: c.classeur, p_artist: c.id, p_holo: holo, p_duree: Number(b.dataset.h) });
        f.fermer(); A.Son.jouer('gain'); A.toast(c.nom + ' est en route.');
        ST.d = null; afficher('quetes');
      }catch(e){ erreur(e); f.corps.querySelectorAll('[data-h]').forEach((x) => { x.disabled = false; }); }
    }));
  }

  // ---------------------------------------------------------------------
  // Classements
  // ---------------------------------------------------------------------

  function classementsExtra(){
    return (window.WaveClassements || []).filter((c) => c && c.id && typeof c.charger === 'function');
  }

  const UNITES = { cartes: 'cartes', holos: 'holos', packs: 'packs', jours: 'jours', niveau: '', ventes: 'ventes' };

  async function vueClassements(corps, vivant){

    const extra = classementsExtra();
    const tous = CLASSEMENTS.concat(extra.map((c) => [c.id, c.libelle]));
    if(!tous.some((t) => t[0] === ST.clas)) ST.clas = 'collection';

    let r;
    const ext = extra.find((c) => c.id === ST.clas);
    if(ext){
      r = await ext.charger(A);
      r.libelle = ext.libelle; r.unite = ext.unite || '';
    }else{
      r = await A.appel('quotidien_classement', { p_type: ST.clas, p_limite: 30 });
    }
    if(!vivant()) return;

    const unite = r.unite in UNITES ? UNITES[r.unite] : r.unite;
    const ligne = (l) => `
      <button type="button" class="ac-cl${l.moi ? ' moi' : ''}" data-profil="${A.esc(l.user_id)}">
        <span class="ac-rg${l.rang <= 3 ? ' p' + l.rang : ''}">${l.rang}</span>
        <span class="ac-av" style="background-image:url('${A.esc(A.safeUrl(l.avatar))}')"></span>
        <b>${A.esc(l.pseudo || 'Collectionneur')}</b>
        <span class="ac-val">${A.nf(l.valeur)}<small>${A.esc(unite)}</small></span>
      </button>`;

    corps.innerHTML = `
      <div class="ct-segment" role="group" aria-label="Classement" style="margin-bottom:16px">${tous.map(([id, l]) => `<button type="button" data-clas="${A.esc(id)}" class="${id === ST.clas ? 'actif' : ''}" aria-pressed="${id === ST.clas}">${A.esc(l)}</button>`).join('')}</div>
      <section class="ct-panneau">
        <div class="ct-entete-panneau"><div><h3>${A.esc(r.libelle)}</h3><p class="sous">${A.pluriel(r.total || 0, 'joueur classé', 'joueurs classés')}.</p></div></div>
        ${r.moi ? `<div class="ac-moi"><b>n° ${r.moi.rang}</b><span style="color:var(--muted)">avec ${A.nf(r.moi.valeur)} ${A.esc(unite)}</span></div>` : '<p class="ac-q">Tu n\'es pas encore classé ici.</p>'}
        ${(r.lignes || []).length ? (r.lignes || []).map(ligne).join('') : '<div class="ct-vide"><b>Personne pour l\'instant</b>Joue pour apparaître ici.</div>'}
      </section>`;

    corps.querySelectorAll('[data-clas]').forEach((b) => b.addEventListener('click', () => { ST.clas = b.dataset.clas; afficher('classements'); }));
    corps.querySelectorAll('[data-profil]').forEach((b) => b.addEventListener('click', () => { ST.cible = b.dataset.profil; afficher('profil'); }));
  }

  // ---------------------------------------------------------------------
  // Nouveautés
  // ---------------------------------------------------------------------

  async function vueNouveautes(corps, vivant){

    const r = await A.appel('quotidien_nouveautes');
    if(!vivant()) return;
    const liste = r.liste || [];

    corps.innerHTML = `
      <section class="ct-panneau">
        <div class="ct-entete-panneau"><div><h3>Nouveautés</h3><p class="sous">Ce qui change dans Wave Cards.</p></div></div>
        <div style="margin-top:12px">${liste.length ? liste.map((n) => `
          <article class="ac-nv${n.nouveau ? ' nouveau' : ''}">
            <h4>${A.esc(n.titre)} <span class="ac-tag${n.nouveau ? ' n' : ''}">${A.esc(n.nouveau ? 'Nouveau' : n.etiquette)}</span>${n.nouveau && n.etiquette ? `<span class="ac-tag">${A.esc(n.etiquette)}</span>` : ''}</h4>
            ${n.texte ? `<p>${A.esc(n.texte)}</p>` : ''}
            <time datetime="${A.esc(n.publie)}">${A.esc(new Date(n.publie + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }))}</time>
          </article>`).join('') : '<div class="ct-vide"><b>Rien pour l\'instant</b>Les mises à jour du jeu s\'affichent ici.</div>'}</div>
      </section>`;

    // Tout est lu une fois la page vue : la pastille s'éteint à la prochaine visite d'un autre onglet
    if(r.non_lues > 0){
      try{ await A.appel('quotidien_nouveautes_vu'); }catch(e){ /* sans gravité */ }
      if(ST.d) ST.d.nouveautes = 0;
    }
  }

  // ---------------------------------------------------------------------
  // Profil de collectionneur
  // ---------------------------------------------------------------------

  async function vueProfil(corps, vivant){

    const p = await A.appel('quotidien_profil', { p_user: ST.cible || null });
    if(!vivant()) return;
    const moi = !!p.moi;

    if(moi && !ST.ed) ST.ed = { vitrine: (p.vitrine || []).map((c) => ({ booster_id: c.booster_id, artist_id: c.artist_id, holo: !!c.holo, nom: c.nom, photo: c.photo, rarete: c.rarete, numero: c.numero })), titre: p.titre ? p.titre.id : '', cadre: p.cadre || 'aucun' };

    const cadres = ['aucun'].concat(Array.from(new Set((p.titres || []).map((t) => t.cadre).filter((c) => c && c !== 'aucun'))));
    const cadre = moi ? ST.ed.cadre : p.cadre;
    const vitrine = moi ? ST.ed.vitrine : (p.vitrine || []);
    const titre = moi ? ((p.titres || []).find((t) => t.id === ST.ed.titre) || null) : p.titre;

    const slot = (c, i) => c
      ? `<div class="ac-slot">${A.carteHtml(c, {})}<b>${A.esc(c.nom)}</b>${moi ? `<button type="button" class="ct-btn petit" data-retirer="${i}">Retirer</button>` : ''}</div>`
      : (moi ? `<div class="ac-slot"><button type="button" class="vide" data-poser="${i}" aria-label="Poser une carte" style="all:unset; box-sizing:border-box; cursor:pointer; display:grid; place-items:center; aspect-ratio:3 / 4.2; max-width:130px; margin:0 auto; width:100%; border-radius:12px; border:1.5px dashed var(--ct-trait-fort); color:var(--muted)">${A.ico('cartes', 26)}</button><small>Emplacement libre</small></div>`
              : `<div class="ac-slot"><span class="vide">${A.ico('cartes', 26)}</span></div>`);

    const slots = [0, 1, 2].map((i) => slot(vitrine[i], i)).join('');

    corps.innerHTML = `
      ${moi ? '' : `<button type="button" class="ct-retour" data-retour style="all:unset; cursor:pointer; display:inline-flex; align-items:center; gap:8px; margin-bottom:12px; color:var(--ink-soft); font-weight:600">${A.ico('fleche', 15)}<span style="margin-left:2px">Retour</span></button>`}
      <section class="ct-panneau ac-pf">
        <span class="ac-av g c-${A.esc(cadre)}" style="background-image:url('${A.esc(A.safeUrl(p.avatar))}')"></span>
        <div style="flex:1; min-width:180px">
          <h2>${A.esc(p.pseudo)}</h2>
          ${titre ? `<div class="ti">${A.esc(titre.nom)}</div>` : '<div class="ti" style="color:var(--muted); font-weight:600">Collectionneur</div>'}
          <div class="ac-chips" style="margin-top:10px"><span class="ac-chip">${A.ico('eclair', 15)}Niveau ${A.nf(p.niveau)}</span>${p.rang_collection ? `<span class="ac-chip">${A.ico('trophee', 15)}n° ${p.rang_collection} en collection</span>` : ''}</div>
        </div>
      </section>

      <section class="ct-panneau" style="margin-bottom:16px">
        <div class="ct-entete-panneau"><div><h3>Vitrine</h3><p class="sous">${moi ? 'Trois cartes à montrer aux autres joueurs.' : 'Les cartes préférées de ' + A.esc(p.pseudo) + '.'}</p></div></div>
        <div class="ac-slots">${slots}</div>
      </section>

      <section class="ct-panneau" style="margin-bottom:16px">
        <div class="ct-entete-panneau"><div><h3>Statistiques</h3></div></div>
        <div class="ac-stats" style="margin-top:12px">
          ${[['Cartes différentes', p.uniques + ' / ' + p.total_cartes], ['Cartes holo', p.holos], ['Packs ouverts', p.ouvertures], ['Meilleure série', p.serie_max + ' j'], ['Combats gagnés', p.victoires], ['Ventes', p.ventes], ['Étapes du parcours', p.parcours + ' / 30']]
            .map(([l, v]) => `<div class="ac-stat"><b>${A.esc(String(typeof v === 'number' ? A.nf(v) : v))}</b><span>${A.esc(l)}</span></div>`).join('')}
        </div>
      </section>

      ${moi ? `
      <section class="ct-panneau">
        <div class="ct-entete-panneau"><div><h3>Titre et cadre</h3><p class="sous">Ils se débloquent avec tes succès. Choisis ce que les autres voient.</p></div></div>
        <div class="ac-champs">
          <label class="ac-champ">Titre<select data-titre><option value="">Aucun</option>${(p.titres || []).map((t) => `<option value="${A.esc(t.id)}"${ST.ed.titre === t.id ? ' selected' : ''}>${A.esc(t.nom)}</option>`).join('')}</select></label>
          <label class="ac-champ">Cadre de l'avatar<select data-cadre>${cadres.map((c) => `<option value="${A.esc(c)}"${ST.ed.cadre === c ? ' selected' : ''}>${A.esc(CADRES[c] || c)}</option>`).join('')}</select></label>
        </div>
        <div class="ac-titres">${(p.titres || []).map((t) => `<span class="${ST.ed.titre === t.id ? 'sel' : ''}" title="${A.esc(t.description)}">${A.esc(t.nom)}</span>`).join('') || '<span>Pas encore de titre : joue pour en débloquer.</span>'}</div>
        <div class="ac-actions"><button type="button" class="ct-btn principal" data-enregistrer>Enregistrer mon profil</button></div>
      </section>` : ''}`;

    const retour = corps.querySelector('[data-retour]');
    if(retour) retour.addEventListener('click', () => { ST.cible = null; afficher('classements'); });
    if(!moi) return;

    corps.querySelector('[data-titre]').addEventListener('change', (ev) => { ST.ed.titre = ev.target.value; });
    corps.querySelector('[data-cadre]').addEventListener('change', (ev) => { ST.ed.cadre = ev.target.value; vueProfil(corps, vivant); });
    corps.querySelectorAll('[data-retirer]').forEach((b) => b.addEventListener('click', () => { ST.ed.vitrine.splice(Number(b.dataset.retirer), 1); vueProfil(corps, vivant); }));
    corps.querySelectorAll('[data-poser]').forEach((b) => b.addEventListener('click', () => {
      choisirCarte('Poser dans la vitrine', 'Choisis une carte de ta collection.', (f, c) => {
        if(ST.ed.vitrine.some((v) => v.booster_id === c.classeur && v.artist_id === c.id)){ A.toast('Cette carte est déjà dans ta vitrine.', 'err'); return; }
        ST.ed.vitrine.push({ booster_id: c.classeur, artist_id: c.id, holo: Number(c.holos || 0) > 0, nom: c.nom, photo: c.photo, rarete: c.rarete, numero: c.numero });
        f.fermer(); vueProfil(corps, vivant);
      });
    }));

    corps.querySelector('[data-enregistrer]').addEventListener('click', async (ev) => {
      const b = ev.currentTarget;
      b.disabled = true;
      try{
        await A.appel('quotidien_profil_regler', {
          p_vitrine: ST.ed.vitrine.map((c) => ({ booster_id: c.booster_id, artist_id: c.artist_id, holo: !!c.holo })),
          p_titre: ST.ed.titre || null, p_cadre: ST.ed.cadre || 'aucun'
        });
        ST.ed = null; A.Son.jouer('gain'); A.toast('Profil enregistré.');
        afficher('profil');
      }catch(e){ erreur(e); b.disabled = false; }
    });
  }

  // ---------------------------------------------------------------------
  // L'équipe : événements et nouveautés
  // ---------------------------------------------------------------------

  const EQ = { zone: null, api: null, evs: [], nvs: [], cur: null, nv: null };

  const champ = (lib, nom, val, type, extra) => `<label class="ac-champ">${A.esc(lib)}<input type="${type || 'text'}" data-f="${nom}" value="${A.esc(val === null || val === undefined ? '' : val)}" ${extra || ''}></label>`;

  function evVide(){
    const j = new Date();
    const iso = (d) => d.toISOString().slice(0, 10);
    const fin = new Date(j.getTime() + 6 * 86400000);
    return { id: '', nom: '', sous_titre: '', description: '', accent: '#4FB4FF', debut: iso(j), fin: iso(fin), medaille: 'Médailles', actif: true, missions: [], recompenses: [] };
  }

  async function equipe(hote, api){
    A = api;
    poserCss();
    EQ.zone = hote;
    EQ.cur = null; EQ.nv = null;
    hote.innerHTML = '<div class="ct-vide">Chargement…</div>';
    [EQ.evs, EQ.nvs] = await Promise.all([A.appel('quotidien_equipe_evenements'), A.appel('quotidien_equipe_nouveautes')]);
    eqRendre();
  }

  function eqRendre(){
    const z = EQ.zone;
    if(!z) return;
    z.innerHTML = `<div class="ac">${EQ.cur ? eqFormEvenement() : (EQ.nv ? eqFormNouveaute() : eqListes())}</div>`;
    z.querySelector('.ac').addEventListener('click', eqClic);
    z.querySelector('.ac').addEventListener('input', eqSaisie);
    z.querySelector('.ac').addEventListener('change', eqSaisie);
  }

  function eqListes(){
    const aujourdhui = new Date().toISOString().slice(0, 10);
    const etat = (e) => (!e.actif ? 'off' : (e.fin < aujourdhui ? 'off' : 'on'));
    const lib = (e) => (!e.actif ? 'désactivé' : (e.fin < aujourdhui ? 'terminé' : (e.debut > aujourdhui ? 'à venir' : 'en cours')));
    return `
      <div class="ct-entete-panneau"><div><h3>Événements</h3><p class="sous">Des missions à durée limitée, des médailles, une boutique.</p></div><button type="button" class="ct-btn principal petit" data-eq="ev-nouveau">Nouvel événement</button></div>
      <div class="ac-eq-liste">${EQ.evs.map((e) => `
        <div class="ac-eq-lig"><span class="puce ${etat(e)}"></span>
          <div class="ac-tx"><b>${A.esc(e.nom)}</b><small>${A.esc(date(e.debut))} au ${A.esc(date(e.fin))} · ${lib(e)} · ${A.pluriel(e.missions.length, 'mission')} · ${A.pluriel(e.participants, 'joueur')}</small></div>
          <button type="button" class="ct-btn petit" data-eq="ev-editer" data-id="${A.esc(e.id)}">Modifier</button>
          <button type="button" class="ct-btn petit" data-eq="ev-supprimer" data-id="${A.esc(e.id)}">Supprimer</button>
        </div>`).join('') || '<div class="ct-vide">Aucun événement.</div>'}</div>

      <div class="ct-entete-panneau" style="margin-top:26px"><div><h3>Nouveautés</h3><p class="sous">Le journal des mises à jour que voient les joueurs.</p></div><button type="button" class="ct-btn principal petit" data-eq="nv-nouveau">Nouvelle nouveauté</button></div>
      <div class="ac-eq-liste">${EQ.nvs.map((n) => `
        <div class="ac-eq-lig"><span class="puce ${n.actif ? 'on' : 'off'}"></span>
          <div class="ac-tx"><b>${A.esc(n.titre)}</b><small>${A.esc(n.etiquette)} · ${A.esc(date(n.publie))}${n.actif ? '' : ' · masquée'}</small></div>
          <button type="button" class="ct-btn petit" data-eq="nv-editer" data-id="${n.id}">Modifier</button>
          <button type="button" class="ct-btn petit" data-eq="nv-supprimer" data-id="${n.id}">Supprimer</button>
        </div>`).join('') || '<div class="ct-vide">Aucune nouveauté.</div>'}</div>`;
  }

  function eqFormEvenement(){
    const e = EQ.cur, nouveau = !e.existe;
    return `
      <div class="ct-entete-panneau"><div><h3>${nouveau ? 'Nouvel événement' : 'Modifier « ' + A.esc(e.nom) + ' »'}</h3><p class="sous">Les récompenses sont des vinyles : reste modeste, 1 vinyle = 1 pack.</p></div></div>
      <div class="ac-champs">
        ${champ('Identifiant (lettres, chiffres, tirets)', 'id', e.id, 'text', nouveau ? 'maxlength="40"' : 'maxlength="40" readonly')}
        ${champ('Nom', 'nom', e.nom, 'text', 'maxlength="60"')}
        ${champ('Sous-titre', 'sous_titre', e.sous_titre, 'text', 'maxlength="90"')}
        ${champ('Nom des médailles', 'medaille', e.medaille, 'text', 'maxlength="24"')}
        ${champ('Début', 'debut', e.debut, 'date')}
        ${champ('Fin (incluse)', 'fin', e.fin, 'date')}
        ${champ('Couleur', 'accent', e.accent, 'color', 'style="padding:3px; height:40px"')}
        <label class="ac-champ">Visible<select data-f="actif"><option value="1"${e.actif ? ' selected' : ''}>Oui</option><option value="0"${e.actif ? '' : ' selected'}>Non (brouillon)</option></select></label>
      </div>
      <label class="ac-champ" style="margin-top:12px">Description<textarea data-f="description" maxlength="400">${A.esc(e.description)}</textarea></label>

      <h4 class="ac-sous">Missions</h4>
      ${e.missions.map((m, i) => `
        <div class="ac-rang">
          <label class="ac-champ">Libellé<input type="text" data-m="${i}.libelle" value="${A.esc(m.libelle)}" maxlength="90"></label>
          <label class="ac-champ">Compte<select data-m="${i}.metrique">${Object.keys(METRIQUES).map((k) => `<option value="${k}"${m.metrique === k ? ' selected' : ''}>${A.esc(METRIQUES[k])}</option>`).join('')}</select></label>
          <label class="ac-champ">Objectif<input type="number" min="1" data-m="${i}.objectif" value="${A.esc(m.objectif)}"></label>
          <label class="ac-champ">Médailles<input type="number" min="1" max="100" data-m="${i}.medailles" value="${A.esc(m.medailles)}"></label>
          <button type="button" class="ac-sup" data-eq="m-sup" data-i="${i}" aria-label="Retirer la mission">${A.ico('croix', 16)}</button>
        </div>`).join('') || '<p class="ac-q">Aucune mission.</p>'}
      <button type="button" class="ct-btn petit" data-eq="m-ajout">Ajouter une mission</button>

      <h4 class="ac-sous">Boutique de médailles</h4>
      ${e.recompenses.map((r, i) => `
        <div class="ac-rang r">
          <label class="ac-champ">Libellé<input type="text" data-r="${i}.libelle" value="${A.esc(r.libelle)}" maxlength="60"></label>
          <label class="ac-champ">Coût (médailles)<input type="number" min="1" data-r="${i}.cout" value="${A.esc(r.cout)}"></label>
          <label class="ac-champ">Vinyles<input type="number" min="0" max="50" data-r="${i}.vinyles" value="${A.esc(r.vinyles)}"></label>
          <label class="ac-champ">Packs Épique<input type="number" min="0" max="5" data-r="${i}.garantis" value="${A.esc(r.garantis)}"></label>
          <button type="button" class="ac-sup" data-eq="r-sup" data-i="${i}" aria-label="Retirer la récompense">${A.ico('croix', 16)}</button>
        </div>`).join('') || '<p class="ac-q">Aucune récompense.</p>'}
      <button type="button" class="ct-btn petit" data-eq="r-ajout">Ajouter une récompense</button>

      <div class="ac-actions"><button type="button" class="ct-btn principal" data-eq="ev-sauver">Enregistrer</button><button type="button" class="ct-btn" data-eq="retour">Annuler</button></div>`;
  }

  function eqFormNouveaute(){
    const n = EQ.nv;
    return `
      <div class="ct-entete-panneau"><div><h3>${n.id ? 'Modifier la nouveauté' : 'Nouvelle nouveauté'}</h3><p class="sous">Les joueurs voient une pastille « nouveau » jusqu'à leur prochaine visite de la page.</p></div></div>
      <div class="ac-champs">
        ${champ('Titre', 'titre', n.titre, 'text', 'maxlength="90"')}
        ${champ('Étiquette', 'etiquette', n.etiquette, 'text', 'maxlength="20"')}
        ${champ('Date de publication', 'publie', n.publie, 'date')}
        <label class="ac-champ">Visible<select data-n="actif"><option value="1"${n.actif ? ' selected' : ''}>Oui</option><option value="0"${n.actif ? '' : ' selected'}>Non</option></select></label>
      </div>
      <label class="ac-champ" style="margin-top:12px">Texte<textarea data-n="texte" maxlength="600">${A.esc(n.texte)}</textarea></label>
      <div class="ac-actions"><button type="button" class="ct-btn principal" data-eq="nv-sauver">Enregistrer</button><button type="button" class="ct-btn" data-eq="retour">Annuler</button></div>`;
  }

  function eqSaisie(ev){
    const t = ev.target;
    if(EQ.cur){
      if(t.dataset.f){
        EQ.cur[t.dataset.f] = t.dataset.f === 'actif' ? t.value === '1' : t.value;
      }else if(t.dataset.m || t.dataset.r){
        const [i, k] = (t.dataset.m || t.dataset.r).split('.');
        const l = t.dataset.m ? EQ.cur.missions : EQ.cur.recompenses;
        l[Number(i)][k] = t.type === 'number' ? (t.value === '' ? '' : Number(t.value)) : t.value;
      }
    }else if(EQ.nv && t.dataset.f){
      EQ.nv[t.dataset.f] = t.value;
    }else if(EQ.nv && t.dataset.n){
      EQ.nv[t.dataset.n] = t.dataset.n === 'actif' ? t.value === '1' : t.value;
    }
  }

  async function eqClic(ev){
    const b = ev.target.closest('[data-eq]');
    if(!b) return;
    const a = b.dataset.eq, id = b.dataset.id;
    try{
      if(a === 'ev-nouveau'){ EQ.cur = evVide(); eqRendre(); }
      else if(a === 'ev-editer'){ EQ.cur = Object.assign(JSON.parse(JSON.stringify(EQ.evs.find((e) => e.id === id))), { existe: true }); eqRendre(); }
      else if(a === 'ev-supprimer'){
        if(!window.confirm('Supprimer cet événement, ses missions et sa boutique ?')) return;
        EQ.evs = await A.appel('quotidien_equipe_evenement_supprimer', { p_id: id }); A.toast('Événement supprimé.'); eqRendre();
      }
      else if(a === 'ev-sauver'){
        b.disabled = true;
        const e = EQ.cur;
        EQ.evs = await A.appel('quotidien_equipe_evenement_sauver', { p: {
          id: e.id, nom: e.nom, sous_titre: e.sous_titre, description: e.description, accent: e.accent, debut: e.debut, fin: e.fin, medaille: e.medaille, actif: e.actif,
          missions: e.missions.map((m) => ({ id: m.id || null, libelle: m.libelle, metrique: m.metrique, objectif: Number(m.objectif), medailles: Number(m.medailles) })),
          recompenses: e.recompenses.map((r) => ({ id: r.id || null, libelle: r.libelle, cout: Number(r.cout), vinyles: Number(r.vinyles) || 0, garantis: Number(r.garantis) || 0 }))
        } });
        EQ.cur = null; A.toast('Événement enregistré.'); eqRendre();
      }
      else if(a === 'm-ajout'){ EQ.cur.missions.push({ libelle: '', metrique: 'ouvertures', objectif: 5, medailles: 2 }); eqRendre(); }
      else if(a === 'm-sup'){ EQ.cur.missions.splice(Number(b.dataset.i), 1); eqRendre(); }
      else if(a === 'r-ajout'){ EQ.cur.recompenses.push({ libelle: '', cout: 5, vinyles: 1, garantis: 0 }); eqRendre(); }
      else if(a === 'r-sup'){ EQ.cur.recompenses.splice(Number(b.dataset.i), 1); eqRendre(); }
      else if(a === 'nv-nouveau'){ EQ.nv = { id: null, titre: '', texte: '', etiquette: 'Nouveau', publie: new Date().toISOString().slice(0, 10), actif: true }; eqRendre(); }
      else if(a === 'nv-editer'){ EQ.nv = Object.assign({}, EQ.nvs.find((n) => String(n.id) === id)); eqRendre(); }
      else if(a === 'nv-supprimer'){
        if(!window.confirm('Supprimer cette nouveauté ?')) return;
        EQ.nvs = await A.appel('quotidien_equipe_nouveaute_supprimer', { p_id: Number(id) }); A.toast('Nouveauté supprimée.'); eqRendre();
      }
      else if(a === 'nv-sauver'){
        b.disabled = true;
        const n = EQ.nv;
        EQ.nvs = await A.appel('quotidien_equipe_nouveaute_sauver', { p: { id: n.id, titre: n.titre, texte: n.texte, etiquette: n.etiquette, publie: n.publie, actif: n.actif } });
        EQ.nv = null; A.toast('Nouveauté enregistrée.'); eqRendre();
      }
      else if(a === 'retour'){ EQ.cur = null; EQ.nv = null; eqRendre(); }
    }catch(e){
      erreur(e);
      b.disabled = false;
    }
  }

  // ---------------------------------------------------------------------
  // Ce que le module offre à cartes.js
  // ---------------------------------------------------------------------

  window.WaveAccueil = {
    monter,
    quitter(){ clearInterval(ST.t); ST.n++; H = null; },
    equipe,
    ajouterClassement(def){ (window.WaveClassements = window.WaveClassements || []).push(def); }
  };

})();
