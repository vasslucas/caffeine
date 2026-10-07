// caffeine's own web proxy — no Scramjet, no Epoxy, no bare-mux.
// Rewrites HTML/CSS on the fly so pages, stylesheets and images load through /p/.
const enc = url => '/p/' + btoa(unescape(encodeURIComponent(url))).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
const dec = path => { try { return decodeURIComponent(escape(atob(path.replace(/^\/p\//, '').replace(/-/g, '+').replace(/_/g, '/')))) } catch { return '' } }

async function readBody(request) {
  if (['GET', 'HEAD'].includes(request.method)) return undefined
  const type = request.headers.get('content-type') || ''
  if (type.startsWith('application/x-www-form-urlencoded') || type.startsWith('text/')) return await request.text()
  if (type.startsWith('multipart/') || type.startsWith('application/')) return await request.arrayBuffer()
  return undefined
}

async function proxiedFetch(url, request, body) {
  const headers = new Headers()
  for (const [key, value] of request.headers.entries()) {
    if (!['cookie', 'host', 'origin', 'referer', 'content-length', 'connection', 'upgrade-insecure-requests', 'sec-fetch-mode', 'sec-fetch-site', 'sec-fetch-dest', 'accept-encoding'].includes(key)) headers.set(key, value)
  }
  const init = { method: request.method, headers, redirect: 'follow', credentials: 'omit' }
  if (body !== undefined && !['GET', 'HEAD'].includes(request.method)) init.body = body
  const response = await fetch(url, init)
  // If the upstream stripped CORS or refused a cross-origin POST-style body, retry as a plain GET navigation.
  if ((request.method === 'POST' || request.mode === 'cors') && response.status >= 400 && ['GET', 'HEAD'].includes(request.method === 'POST' ? 'GET' : request.method)) {
    try { await response.arrayBuffer() } catch {}
    return fetch(url, { method: 'GET', headers, redirect: 'follow', credentials: 'omit' })
  }
  return response
}

function rewriteHtml(source, base) {
  const resolve = value => { try { return new URL(value, base).href } catch { return value } }
  let html = source
  html = html.replace(/<base\b[^>]*>/i, '')
  html = html.replace(/(\s)(src|srcset|href|data-src|data-srcset|poster)=(["'])([^"']+)\3/gi, (all, space, attribute, quote, value) => {
    const trimmed = value.trim()
    if (/^(data:|blob:|javascript:|#|about:)/i.test(trimmed)) return all
    if (attribute === 'srcset') {
      const rewritten = value.split(',').map(part => {
        const pieces = part.trim().split(/\s+/)
        if (!pieces[0]) return part
        pieces[0] = resolve(pieces[0])
        return pieces.join(' ')
      }).join(', ')
      return `${space}${attribute}=${quote}${rewritten}${quote}`
    }
    return `${space}${attribute}=${quote}${resolve(value)}${quote}`
  })
  html = html.replace(/(<link\b[^>]*?)(rel=(["'])stylesheet\3[^>]*>)/i, (all, before, after) => `${before}crossorigin="anonymous" ${after}`)
  const rewritten = enc(base)
  const injected = `<script>window.__CAFFEINE_BASE__=${JSON.stringify(base)};window.__caffeineResolve=u=>{try{return new URL(u,window.__CAFFEINE_BASE__).href}catch{return u}};window.__caffeineProxied=u=>'/p/'+btoa(unescape(encodeURIComponent(window.__caffeineResolve(u)))).replace(/=+$/,'').replace(/\\+/g,'-').replace(/\\//g,'_');<\/script>`
  if (/<head(\s[^>]*)?>/i.test(html)) html = html.replace(/<head(\s[^>]*)?>/i, all => all + injected)
  else if (/<html(\s[^>]*)?>/i.test(html)) html = html.replace(/<html(\s[^>]*)?>/i, all => all + '<head>' + injected + '</head>')
  else html = injected + html
  return `<!doctype html><html><head><meta charset="utf-8"><base href="${rewritten}"><style>html,body{margin:0;height:100%;background:#fff}</style></head><body style="height:100vh"><iframe id="__caffeine_frame" srcdoc="${html.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}" style="width:100%;height:100%;border:0;color-scheme:light dark" sandbox="allow-scripts allow-forms allow-popups allow-modals allow-downloads allow-same-origin"></iframe></body></html>`
}

function rewriteCss(source, base) {
  const resolve = value => { try { return new URL(value, base).href } catch { return value } }
  return source
    .replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi, (all, quote, value) => {
      if (/^(data:|blob:)/i.test(value)) return all
      return `url("${enc(resolve(value))}")`
    })
    .replace(/@import\s+(["'])([^"']+)\1/gi, (all, quote, value) => `@import "${enc(resolve(value))}"`)
}

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()))

self.addEventListener('fetch', event => {
  const request = event.request
  const url = new URL(request.url)
  if (request.method === 'POST' && url.pathname.endsWith('/__submit')) {
    event.respondWith((async () => {
      const form = await request.json()
      let target = String(form.action || '')
      try { target = new URL(target, String(form.base || location.href)).href } catch { target = String(form.base || location.href) }
      const entries = Object.entries(form.values || {}).filter(([, value]) => value != null)
      if (String(form.method || 'get').toLowerCase() === 'get') {
        const parsed = new URL(target)
        for (const [key, value] of entries) parsed.searchParams.append(key, String(value))
        target = parsed.href
      }
      return Response.redirect(enc(target), 302)
    })().catch(() => new Response('', { status: 500 })))
    return
  }
  if (!url.pathname.startsWith('/p/')) return
  const raw = dec(request.url)
  if (!/^https?:\/\//i.test(raw)) return
  event.respondWith((async () => {
    const blockedDomains = ['doubleclick.net', 'googlesyndication.com', 'googleadservices.com', 'adnxs.com', 'adsrvr.org', 'scorecardresearch.com', 'analytics.google.com', 'google-analytics.com', 'taboola.com', 'outbrain.com']
    try {
      const cache = await caches.open('caffeine-preferences')
      const stored = await cache.match(new URL('./blocker-preference', self.location.href).href)
      if (stored && (await stored.text()) === 'true' && blockedDomains.some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`))) return new Response('', { status: 204 })
    } catch {}
    const body = await readBody(request)
    const response = await proxiedFetch(raw, request, body)
    const contentType = response.headers.get('content-type') || ''
    if (contentType.includes('text/html')) {
      const text = await response.text()
      return new Response(rewriteHtml(text, response.url || raw), { status: response.status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } })
    }
    if (contentType.includes('text/css')) {
      const text = await response.text()
      return new Response(rewriteCss(text, response.url || raw), { status: response.status, headers: { 'Content-Type': 'text/css; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=300' } })
    }
    const headers = new Headers(response.headers)
    headers.delete('content-security-policy')
    headers.delete('content-security-policy-report-only')
    headers.delete('x-frame-options')
    headers.delete('content-encoding')
    headers.delete('content-length')
    headers.delete('transfer-encoding')
    headers.set('Access-Control-Allow-Origin', '*')
    return new Response(response.body, { status: response.status, headers })
  })().catch(error => new Response(`<!-- caffeine proxy could not reach ${raw}: ${error.message} -->`, { status: 502, headers: { 'Content-Type': 'text/html; charset=utf-8' } })))
})
