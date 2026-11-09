<?php
/* =====================================================================
   La Wave — les liens de partage avec aperçu

   Le site est une seule page : une adresse comme lawave.fr/#sortie/124071 n'a, pour Instagram, WhatsApp, X ou iMessage,
   ni titre ni image. Ce petit fichier répond à leur place avec les balises d'aperçu (titre, description, pochette), puis
   renvoie tout de suite le visiteur vers la vraie page du site.

     partage.php?s=<numéro de sortie>               -> la fiche d'une sortie
     partage.php?s=<numéro>&p=lancement             -> sa page de lancement
     partage.php?a=<pseudo Instagram de l'artiste>  -> la page d'un artiste
     partage.php?v=<pseudo>                         -> sa carte de visite

   Il ne lit que des données publiques (fonction lancement_page et table artists), avec la clé publique du site.
   ===================================================================== */

const LW_SUPABASE = 'https://bqataeghgjyiqrnnesqq.supabase.co';
const LW_CLE = 'sb_publishable_yPAFW5xjK6gEgLZqQYyojA_D00vMayy';
const LW_SITE = 'https://lawave.fr';

function lw_appel($chemin, $corps = null){
  $ch = curl_init(LW_SUPABASE . $chemin);
  $entetes = ['apikey: ' . LW_CLE, 'Authorization: Bearer ' . LW_CLE, 'Accept: application/json'];
  curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
  curl_setopt($ch, CURLOPT_TIMEOUT, 6);
  if($corps !== null){
    $entetes[] = 'Content-Type: application/json';
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($corps));
  }
  curl_setopt($ch, CURLOPT_HTTPHEADER, $entetes);
  $rep = curl_exec($ch);
  $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
  curl_close($ch);
  return ($rep !== false && $code >= 200 && $code < 300) ? json_decode($rep, true) : null;
}

function lw_h($t){ return htmlspecialchars((string)$t, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'); }

function lw_https($u){ return (is_string($u) && preg_match('#^https://#i', $u)) ? $u : ''; }

$mois = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

function lw_date($iso){
  global $mois;
  if(!preg_match('/^(\d{4})-(\d{2})-(\d{2})/', (string)$iso, $m)) return '';
  return (int)$m[3] . ((int)$m[3] === 1 ? 'er ' : ' ') . $mois[(int)$m[2] - 1] . ' ' . $m[1];
}

$titre = 'La Wave — média musical';
$description = 'Les sorties repérées par La Wave, archivées et mises en avant.';
$image = LW_SITE . '/img/og-image.jpg';
$cible = '/';
$url = LW_SITE . '/';

if(isset($_GET['s']) && preg_match('/^\d{1,9}$/', $_GET['s'])){

  $num = (int)$_GET['s'];
  $lancement = (isset($_GET['p']) && $_GET['p'] === 'lancement');
  $s = lw_appel('/rest/v1/rpc/lancement_page', ['p_num' => $num]);

  if(is_array($s) && !empty($s['titre'])){
    $titre = $s['titre'] . ' — ' . $s['artiste'];
    $futur = !empty($s['date']) && strtotime($s['date']) > time();
    $description = ($s['type'] ?: 'Sortie') . ($futur ? ' à venir le ' : ' parue le ') . lw_date($s['date'] ?? '') . ' · à retrouver sur La Wave.';
    if(empty($s['date'])) $description = 'À retrouver sur La Wave.';
    if(lw_https($s['cover'] ?? '')) $image = $s['cover'];
  }

  $cible = $lancement ? '/#lancement/' . $num : '/#sortie/' . $num;
  $url = LW_SITE . '/partage.php?s=' . $num . ($lancement ? '&p=lancement' : '');

} elseif((isset($_GET['a']) || isset($_GET['v'])) && preg_match('/^[A-Za-z0-9._-]{1,80}$/', $_GET['a'] ?? $_GET['v'])){

  $handle = $_GET['a'] ?? $_GET['v'];
  $carte = isset($_GET['v']);
  $a = lw_appel('/rest/v1/artists?select=display_name,photo_url,ville,bio&instagram_handle=eq.' . rawurlencode($handle) . '&limit=1');

  if(is_array($a) && isset($a[0])){
    $nom = $a[0]['display_name'] ?: $handle;
    $titre = $nom . ($carte ? ' — carte de visite' : '') . ' · La Wave';
    $description = $a[0]['bio'] ?: ('Les sorties et les liens de ' . $nom . ($a[0]['ville'] ? ', ' . $a[0]['ville'] : '') . ', sur La Wave.');
    if(function_exists('mb_substr')) $description = mb_substr($description, 0, 200);
    if(lw_https($a[0]['photo_url'] ?? '')) $image = $a[0]['photo_url'];
  }

  $cible = ($carte ? '/#visite/' : '/#artiste/') . rawurlencode($handle);
  $url = LW_SITE . '/partage.php?' . ($carte ? 'v=' : 'a=') . rawurlencode($handle);
}

header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: public, max-age=600');
?><!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title><?= lw_h($titre) ?></title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="<?= lw_h($description) ?>">
<meta property="og:site_name" content="La Wave">
<meta property="og:type" content="website">
<meta property="og:title" content="<?= lw_h($titre) ?>">
<meta property="og:description" content="<?= lw_h($description) ?>">
<meta property="og:image" content="<?= lw_h($image) ?>">
<meta property="og:url" content="<?= lw_h($url) ?>">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="<?= lw_h($titre) ?>">
<meta name="twitter:description" content="<?= lw_h($description) ?>">
<meta name="twitter:image" content="<?= lw_h($image) ?>">
<meta http-equiv="refresh" content="0;url=<?= lw_h($cible) ?>">
<script>location.replace(<?= json_encode($cible) ?>);</script>
</head>
<body style="font:16px system-ui;background:#05070a;color:#f4f5f6;display:grid;place-items:center;min-height:100vh;margin:0;text-align:center">
<p>Redirection vers La Wave…<br><a style="color:#4fb4ff" href="<?= lw_h($cible) ?>"><?= lw_h($titre) ?></a></p>
</body>
</html>
