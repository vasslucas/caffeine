importScripts('./scramjet/scramjet.all.js')
const { ScramjetServiceWorker } = self.$scramjetLoadWorker()
const scramjet = new ScramjetServiceWorker()
let blocker = true
const blockedDomains = ['doubleclick.net', 'googlesyndication.com', 'googleadservices.com', 'adnxs.com', 'adsrvr.org', 'scorecardresearch.com', 'connect.facebook.net', 'analytics.google.com', 'google-analytics.com', 'taboola.com', 'outbrain.com']
const preferenceUrl = new URL('./blocker-preference', self.location.href).href
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()))
self.addEventListener('message', event => {
  if (event.data?.type !== 'blocker') return
  blocker = !!event.data.enabled
  event.waitUntil(caches.open('caffeine-preferences').then(cache => cache.put(preferenceUrl, new Response(String(blocker)))))
})
self.addEventListener('fetch', event => {
  const prefix = new URL('./service/', self.location.href).pathname
  if (!new URL(event.request.url).pathname.startsWith(prefix)) return
  event.respondWith((async () => {
    await scramjet.loadConfig()
    const cache = await caches.open('caffeine-preferences')
    const stored = await cache.match(preferenceUrl)
    if (stored) blocker = (await stored.text()) === 'true'
    if (blocker) {
      try {
        const encoded = new URL(event.request.url).pathname.slice(prefix.length)
        const hostname = new URL(decodeURIComponent(encoded)).hostname
        if (blockedDomains.some(domain => hostname === domain || hostname.endsWith(`.${domain}`))) return new Response('', { status: 204 })
      } catch {}
    }
    return scramjet.fetch(event)
  })())
})
