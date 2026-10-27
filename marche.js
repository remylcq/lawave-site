/* =====================================================================
   La Wave — Wave Cards : le marché (squelette)

   Chargé à la demande par cartes.js (onglet « Marché », chargerWaveModule('marche') dans index.html).
   Contrat :
     window.WaveMarche = {
       monter(hote, api)   remplit l'élément `hote` (l'onglet) ; `api` est window.Cartes.api (voir cartes.js)
       quitter()           coupe minuteurs et écouteurs quand on quitte le jeu
       equipe(hote, api)   panneau de modération pour la console de l'équipe (annonces, prix, historique)
       vendre(carte, api)  ouvre la mise en vente d'une carte (appelé depuis la fiche d'une carte)
     }
   ===================================================================== */

(function(){

  'use strict';

  window.WaveMarche = {
    monter(hote){
      hote.innerHTML = '<div class="ct-panneau ct-vide"><b>Le marché arrive bientôt</b>Tu pourras vendre et acheter des cartes entre joueurs.</div>';
    },
    quitter(){},
    equipe(hote){
      hote.innerHTML = '<div class="ct-panneau ct-vide"><b>Rien à modérer pour l\'instant</b>Le marché arrive.</div>';
    },
    vendre(){}
  };

})();
