import http from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { resolve, extname, sep } from 'node:path'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { server as wisp } from '@mercuryworkshop/wisp-js/server'

const root = resolve('dist')
const host = process.env.HOST || process.env.HOSTNAME || '127.0.0.1'
const port = Number(process.env.PORT || 8080)
const password = process.env.PROXY_PASSWORD || ''
const publicHost = process.env.NODE_ENV === 'production' || !['127.0.0.1', 'localhost', '::1'].includes(host)
if (publicHost && password && password.length < 12) {
  console.error('[caffeine] WARNING: PROXY_PASSWORD is shorter than 12 characters while this server is exposed publicly. Set PROXY_PASSWORD (>=12 chars) in your Railway service variables and redeploy.')
}
const sessionSecret = randomBytes(32)
const signature = value => createHmac('sha256', sessionSecret).update(value).digest('base64url')
const equal = (first, second) => { const left = Buffer.from(first); const right = Buffer.from(second); return left.length === right.length && timingSafeEqual(left, right) }
function authorized(request) {
  if (!password && !publicHost) return true
  const cookie = request.headers.cookie?.split(';').map(value => value.trim()).find(value => value.startsWith('caffeine-access='))?.slice(16) || ''
  const [expiry, mac] = cookie.split('.')
  return !!expiry && !!mac && Number(expiry) > Date.now() && equal(signature(expiry), mac)
}
const sendJson = (response, status, data) => { response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); response.end(JSON.stringify(data)) }
const imageHosts = new Set(['images.unsplash.com', 'www.google.com', 'cdn-icons-png.flaticon.com', 't0.gstatic.com', 't1.gstatic.com', 't2.gstatic.com', 't3.gstatic.com', 'www.gstatic.com'])
const imageCache = new Map()
const loginAttempts = new Map()
wisp.options.allow_private_ips = false
wisp.options.allow_loopback_ips = false
wisp.options.allow_direct_ip = false
wisp.options.allow_udp_streams = false
wisp.options.port_whitelist = [80, 443]
wisp.options.stream_limit_total = 128

async function fetchImage(input) {
  let url = new URL(input)
  for (let redirect = 0; redirect < 5; redirect++) {
    if (url.protocol !== 'https:' || !imageHosts.has(url.hostname) || (url.port && url.port !== '443') || url.username || url.password) throw new Error('Image host is not allowed.')
    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15000) })
    if (response.status >= 300 && response.status < 400 && response.headers.get('location')) { url = new URL(response.headers.get('location'), url); await response.body?.cancel(); continue }
    const type = response.headers.get('content-type') || ''
    if (!response.ok || !type.startsWith('image/') || type.includes('svg')) { await response.body?.cancel(); throw new Error('Image is unavailable.') }
    const reader = response.body.getReader()
    const chunks = []
    let size = 0
    while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 8 * 1024 * 1024) { await reader.cancel(); throw new Error('Image is too large.') }; chunks.push(Buffer.from(part.value)) }
    return { body: Buffer.concat(chunks), type }
  }
  throw new Error('Too many redirects.')
}
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.webm': 'video/webm', '.ico': 'image/x-icon' }
const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || '/', 'http://localhost')
    response.setHeader('Referrer-Policy', 'no-referrer')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    if (url.pathname === '/api/runtime') return sendJson(response, 200, { bundledWisp: true, authenticationRequired: !!password, authenticated: authorized(request) })
    if (url.pathname === '/api/session' && request.method === 'POST') {
      if (request.headers.origin && new URL(request.headers.origin).host !== request.headers.host) return sendJson(response, 403, { error: 'Origin is not allowed.' })
      const ip = request.socket.remoteAddress || 'unknown'
      const attempt = loginAttempts.get(ip) || { count: 0, start: Date.now() }
      if (Date.now() - attempt.start > 60000) { attempt.count = 0; attempt.start = Date.now() }
      if (++attempt.count > 10) return sendJson(response, 429, { error: 'Try again in a minute.' })
      if (loginAttempts.size > 1000) loginAttempts.clear()
      loginAttempts.set(ip, attempt)
      let body = ''; for await (const chunk of request) { body += chunk; if (body.length > 2048) return sendJson(response, 413, { error: 'Request too large.' }) }
      if (!equal(String(JSON.parse(body || '{}').password || ''), password)) return sendJson(response, 401, { error: 'Wrong server password.' })
      const expiry = String(Date.now() + 8 * 60 * 60 * 1000)
      const secure = publicHost || request.headers['x-forwarded-proto'] === 'https'
      response.setHeader('Set-Cookie', `caffeine-access=${expiry}.${signature(expiry)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${secure ? '; Secure' : ''}`)
      return sendJson(response, 200, { ok: true })
    }
    if (url.pathname === '/api/image') {
      const source = url.searchParams.get('url') || ''
      if (source.length > 2048) return sendJson(response, 400, { error: 'Invalid image URL.' })
      let image = imageCache.get(source)
      if (!image) { image = await fetchImage(source); if (imageCache.size >= 16) imageCache.delete(imageCache.keys().next().value); imageCache.set(source, image) }
      response.writeHead(200, { 'Content-Type': image.type, 'Cache-Control': 'public, max-age=86400' }); return response.end(image.body)
    }
    if (!['GET', 'HEAD'].includes(request.method)) return sendJson(response, 405, { error: 'Method not allowed.' })
    let file = resolve(root, `.${decodeURIComponent(url.pathname)}`)
    if (file !== root && !file.startsWith(root + sep)) return sendJson(response, 403, { error: 'Forbidden.' })
    let information
    try { information = await stat(file); if (information.isDirectory()) file = resolve(file, 'index.html') } catch { if (extname(file) || url.pathname.startsWith('/api/')) return sendJson(response, 404, { error: 'Not found.' }); file = resolve(root, 'index.html') }
    const body = await readFile(file)
    response.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Cache-Control': extname(file) === '.html' || file.endsWith('proxy-sw.js') ? 'no-cache' : 'public, max-age=3600' })
    response.end(request.method === 'HEAD' ? undefined : body)
  } catch { if (!response.headersSent) sendJson(response, 502, { error: 'Resource unavailable.' }); else response.end() }
})
const connections = new Map()
server.on('upgrade', (request, socket, head) => {
  const reject = status => { socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`); socket.destroy() }
  const url = new URL(request.url || '/', 'http://localhost')
  if (url.pathname !== '/wisp/') return reject('404 Not Found')
  if (request.headers.origin && new URL(request.headers.origin).host !== request.headers.host) return reject('403 Forbidden')
  if (!authorized(request)) return reject('401 Unauthorized')
  const ip = request.socket.remoteAddress || 'unknown'
  if ((connections.get(ip) || 0) >= 32) return reject('429 Too Many Requests')
  connections.set(ip, (connections.get(ip) || 0) + 1)
  socket.on('close', () => { const count = (connections.get(ip) || 1) - 1; if (count) connections.set(ip, count); else connections.delete(ip) })
  try { wisp.routeRequest(request, socket, head) } catch { socket.destroy() }
})
server.listen(port, host, () => console.log(`caffeine + Wisp listening at http://${host}:${port}`))
