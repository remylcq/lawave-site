/* =====================================================================
   La Wave — le service worker

   Ce qu'il fait, et rien de plus :
     · le site peut s'installer comme une application (avec site.webmanifest) ;
     · une page ouverte reste lisible hors ligne : la dernière version vue de l'accueil, ses scripts et ses images ;
     · les pages se demandent d'abord au réseau (jamais de page périmée tant qu'on est en ligne) ;
     · les fichiers qui portent une empreinte (?v=…) et les images se gardent : ils ne changent pas sans changer d'adresse.

   Il ne touche à rien d'autre : les appels à la base (Supabase), à Deezer ou à YouTube passent tels quels, et
   version.txt (qui dit qu'une mise à jour est disponible) n'est jamais gardé.
   ===================================================================== */

const VERSION = 'lw-v2';
const FICHIERS = 'lw-fichiers-' + VERSION;
const PAGES = 'lw-pages-' + VERSION;

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const noms = await caches.keys();
    await Promise.all(noms.filter(n => n !== FICHIERS && n !== PAGES).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

// Une alerte du site, reçue même quand La Wave n'est pas ouverte (envoyée par la fonction « envoyer-push », voir sql/push.sql).
self.addEventListener('push', (event) => {

  let m = {};

  try{ m = event.data ? event.data.json() : {}; }catch(e){ m = { corps: event.data ? event.data.text() : '' }; }

  event.waitUntil(self.registration.showNotification(m.titre || 'La Wave', {
    body: m.corps || '',
    icon: '/img/icon-192.png',
    badge: '/img/icon-192.png',
    tag: m.url || 'lawave',
    data: { url: m.url || '/' }
  }));
});

// Un toucher sur l'alerte : on revient sur l'onglet de La Wave s'il est ouvert, sinon on l'ouvre.
self.addEventListener('notificationclick', (event) => {

  event.notification.close();

  const cible = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href;

  event.waitUntil((async () => {
    const fenetres = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for(const f of fenetres){
      if(f.url.startsWith(self.location.origin) && 'focus' in f){
        await f.focus();
        if('navigate' in f) await f.navigate(cible).catch(() => {});
        return;
      }
    }
    await self.clients.openWindow(cible);
  })());
});

self.addEventListener('fetch', (event) => {

  const requete = event.request;

  if(requete.method !== 'GET') return;

  const adresse = new URL(requete.url);

  // Uniquement ce site : le reste (base de données, lecteurs, polices) ne nous regarde pas.
  if(adresse.origin !== self.location.origin) return;
  if(/version\.txt$/.test(adresse.pathname) || adresse.pathname.endsWith('/sw.js')) return;

  // Une page : le réseau d'abord, la dernière copie vue si le réseau manque.
  if(requete.mode === 'navigate'){
    event.respondWith((async () => {
      try{
        const reponse = await fetch(requete);
        if(reponse && reponse.ok){
          const copie = reponse.clone();
          caches.open(PAGES).then(c => c.put('/', copie)).catch(() => {});
        }
        return reponse;
      }catch(e){
        const gardee = await caches.match('/', { cacheName: PAGES });
        return gardee || new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Hors ligne</title><body style="font:16px system-ui;background:#05070a;color:#f4f5f6;display:grid;place-items:center;min-height:100vh;margin:0;text-align:center"><p>Tu es hors ligne.<br>Reconnecte-toi pour retrouver La Wave.</p>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      }
    })());
    return;
  }

  // Un script, une feuille de style, une image du site : la copie gardée d'abord, rafraîchie en arrière-plan.
  if(/\.(js|css|png|jpe?g|webp|svg|ico|woff2?|glb|json|webmanifest)$/i.test(adresse.pathname)){
    event.respondWith((async () => {
      const cache = await caches.open(FICHIERS);
      const gardee = await cache.match(requete);
      const frais = fetch(requete).then(reponse => {
        if(reponse && reponse.ok && reponse.type === 'basic') cache.put(requete, reponse.clone()).catch(() => {});
        return reponse;
      }).catch(() => null);
      return gardee || (await frais) || Response.error();
    })());
  }
});
