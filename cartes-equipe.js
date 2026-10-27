/* =====================================================================
   La Wave — Wave Cards : la console de l'équipe (squelette)

   Chargé à la demande par Cartes.equipe(hote) (cartes.js), appelé par l'onglet « Wave Cards » de l'espace équipe
   (index.html, switchAdminTab). Tant que `pret` est faux, cartes.js garde l'éditeur de classeurs d'origine.
   Contrat :
     window.WaveEquipe = {
       pret                vrai quand la console complète remplace l'éditeur d'origine
       monter(hote, api)   remplit l'élément `hote` ; `api` est window.Cartes.api (voir cartes.js)
     }
   ===================================================================== */

(function(){

  'use strict';

  window.WaveEquipe = {
    pret: false,
    monter(hote){
      hote.innerHTML = '<div class="ct-panneau ct-vide"><b>Console en préparation</b></div>';
    }
  };

})();
