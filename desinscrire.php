<?php
/* =====================================================================
   La Wave — le lien « Se désinscrire » du résumé hebdomadaire

   desinscrire.php?j=<jeton> : le jeton, propre à chaque abonné, suffit (pas de connexion). Il appelle la fonction
   email_resume_stop de la base, puis dit que c'est fait. Voir sql/email-resume.sql.
   ===================================================================== */

const LW_SUPABASE = 'https://bqataeghgjyiqrnnesqq.supabase.co';
const LW_CLE = 'sb_publishable_yPAFW5xjK6gEgLZqQYyojA_D00vMayy';

$jeton = $_GET['j'] ?? '';
$fait = false;

if(preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i', $jeton)){
  $ch = curl_init(LW_SUPABASE . '/rest/v1/rpc/email_resume_stop');
  curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
  curl_setopt($ch, CURLOPT_TIMEOUT, 6);
  curl_setopt($ch, CURLOPT_POST, true);
  curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode(['p_jeton' => $jeton]));
  curl_setopt($ch, CURLOPT_HTTPHEADER, ['apikey: ' . LW_CLE, 'Authorization: Bearer ' . LW_CLE, 'Content-Type: application/json']);
  $rep = curl_exec($ch);
  $fait = ($rep !== false && curl_getinfo($ch, CURLINFO_HTTP_CODE) === 200 && trim($rep) === 'true');
  curl_close($ch);
}

header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-store');
?><!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Résumé hebdomadaire — La Wave</title>
</head>
<body style="font:16px system-ui;background:#05070a;color:#f4f5f6;display:grid;place-items:center;min-height:100vh;margin:0;text-align:center;padding:24px">
<div>
<?php if($fait): ?>
  <h1 style="font-size:22px">C'est fait.</h1>
  <p>Tu ne recevras plus le résumé hebdomadaire de La Wave.<br>Tu peux le réactiver à tout moment dans tes réglages.</p>
<?php else: ?>
  <h1 style="font-size:22px">Ce lien n'est pas valable.</h1>
  <p>Pour te désinscrire, ouvre tes réglages sur La Wave.</p>
<?php endif; ?>
  <p><a style="color:#4fb4ff" href="https://lawave.fr/">Retour à La Wave</a></p>
</div>
</body>
</html>
