/* =====================================================================
   La Wave — Wave Cards : le combat (squelette)

   Chargé à la demande par cartes.js (onglet « Combat », chargerWaveModule('combat') dans index.html).
   Contrat :
     window.WaveCombat = {
       monter(hote, api)   remplit l'élément `hote` (l'onglet) ; `api` est window.Cartes.api (voir cartes.js)
       quitter()           coupe minuteurs et écouteurs quand on quitte le jeu
       equipe(hote, api)   panneau de réglage pour la console de l'équipe (types, statistiques, attaques)
     }
   ===================================================================== */

(function(){

  'use strict';

  window.WaveCombat = {
    monter(hote){
      hote.innerHTML = '<div class="ct-panneau ct-vide"><b>Le combat arrive bientôt</b>Tes cartes vont s\'affronter en duos.</div>';
    },
    quitter(){},
    equipe(hote){
      hote.innerHTML = '<div class="ct-panneau ct-vide"><b>Pas encore de réglages</b>Le combat arrive.</div>';
    }
  };

})();
