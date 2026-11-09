<?php
/* =====================================================================
   La Wave — le flux RSS des sorties

   Les 40 dernières sorties publiées, au format RSS 2.0 : de quoi suivre La Wave dans un lecteur de flux, ou alimenter une
   newsletter automatique (Mailchimp, Substack, Buttondown… savent lire un flux RSS). Données publiques seulement
   (fonction catalogue_liste), avec la clé publique du site.

     feed.php            -> toutes les sorties récentes
     feed.php?type=Projet (ou Single) -> seulement les projets, ou les singles
   ===================================================================== */

const LW_SUPABASE = 'https://bqataeghgjyiqrnnesqq.supabase.co';
const LW_CLE = 'sb_publishable_yPAFW5xjK6gEgLZqQYyojA_D00vMayy';
const LW_SITE = 'https://lawave.fr';

function lw_x($t){ return htmlspecialchars((string)$t, ENT_XML1 | ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'); }

$corps = ['p_limite' => 40, 'p_tri' => 'recent'];
if(isset($_GET['type']) && in_array($_GET['type'], ['Single', 'Projet'], true)) $corps['p_type'] = $_GET['type'];

$ch = curl_init(LW_SUPABASE . '/rest/v1/rpc/catalogue_liste');
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_TIMEOUT, 8);
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($corps));
curl_setopt($ch, CURLOPT_HTTPHEADER, ['apikey: ' . LW_CLE, 'Authorization: Bearer ' . LW_CLE, 'Content-Type: application/json', 'Accept: application/json']);
$rep = curl_exec($ch);
$code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

$lignes = [];
if($rep !== false && $code >= 200 && $code < 300){
  $data = json_decode($rep, true);
  if(is_array($data) && isset($data['lignes']) && is_array($data['lignes'])) $lignes = $data['lignes'];
}

header('Content-Type: application/rss+xml; charset=utf-8');
header('Cache-Control: public, max-age=900');

echo '<?xml version="1.0" encoding="UTF-8"?>' . "\n";
?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/">
<channel>
  <title>La Wave — les sorties</title>
  <link><?= LW_SITE ?>/</link>
  <description>Les dernières sorties repérées par La Wave, média musical.</description>
  <language>fr</language>
  <atom:link href="<?= LW_SITE ?>/feed.php" rel="self" type="application/rss+xml"/>
<?php foreach($lignes as $s):
  $num = (int)($s['catalog_number'] ?? 0);
  if(!$num) continue;
  $lien = LW_SITE . '/partage.php?s=' . $num;
  $date = !empty($s['release_date']) ? strtotime($s['release_date'] . ' 12:00:00 UTC') : time();
  $cover = (isset($s['cover_url']) && preg_match('#^https://#i', $s['cover_url'])) ? $s['cover_url'] : '';
  $desc = ($s['release_type'] ?? 'Sortie') . ' de ' . ($s['artist_name'] ?? '');
?>
  <item>
    <title><?= lw_x(($s['track_title'] ?? '') . ' — ' . ($s['artist_name'] ?? '')) ?></title>
    <link><?= lw_x($lien) ?></link>
    <guid isPermaLink="false">lawave-sortie-<?= $num ?></guid>
    <pubDate><?= gmdate('D, d M Y H:i:s', $date) ?> GMT</pubDate>
    <description><?= lw_x($desc) ?></description>
<?php if($cover): ?>
    <media:thumbnail url="<?= lw_x($cover) ?>"/>
    <enclosure url="<?= lw_x($cover) ?>" type="image/jpeg" length="0"/>
<?php endif; ?>
  </item>
<?php endforeach; ?>
</channel>
</rss>
