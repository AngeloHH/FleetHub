import { createServer } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { extname, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { createFleetHubApi, emptyState } from '../../server/app.mjs'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2',
  '.wasm': 'application/wasm', '.gz': 'application/gzip',
}

export default async function setup() {
  const previousLogLevel = process.env.FLEETHUB_LOG_LEVEL
  process.env.FLEETHUB_LOG_LEVEL = 'error'
  let state = emptyState()
  const photos = new Map<string, Buffer>()
  const api = createFleetHubApi({
    loadState: async () => structuredClone(state),
    saveState: async (next) => { state = structuredClone(next) },
    savePhoto: async (name, bytes) => { photos.set(name, Buffer.from(bytes)) },
    loadPhoto: async (name) => photos.get(name) ?? null,
    suggestAddresses: async () => ({ ok: true, suggestions: [] }),
    decodeVehicleVin: async () => ({
      ok: true,
      decoder: 'e2e-fixture',
      details: {
        year: '2026', make: 'FleetHub', model: 'Unidad E2E',
        trim: 'Prueba', body: 'Truck', engine: '',
      },
    }),
    exposeAuthCodes: true,
    // Los límites por IP protegen de quien prueba contraseñas en tandas; una
    // suite que monta una compañía por caso viene toda de 127.0.0.1 y sería
    // exactamente esa tanda. Se suben aquí, no se apagan: que sigan existiendo
    // es parte de lo que se está probando.
    rateLimits: {
      'company-create': { limit: 500, windowMs: 60 * 60_000 },
      'password-session': { limit: 500, windowMs: 10 * 60_000 },
      'token-create': { limit: 500, windowMs: 10 * 60_000 },
      'token-check': { limit: 500, windowMs: 10 * 60_000 },
    },
  })
  const dist = resolve(process.cwd(), 'dist')
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1:8799')
    if (url.pathname.startsWith('/api/')) {
      const init: RequestInit & { duplex?: 'half' } = { method: req.method, headers: req.headers as HeadersInit }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        init.body = Readable.toWeb(req) as ReadableStream
        init.duplex = 'half'
      }
      const answer = await api(new Request(url, init))
      res.writeHead(answer.status, Object.fromEntries(answer.headers))
      res.end(Buffer.from(await answer.arrayBuffer()))
      return
    }
    const requested = resolve(dist, url.pathname.replace(/^\/+/, '') || 'index.html')
    const file = requested.startsWith(dist) && existsSync(requested) ? requested : resolve(dist, 'index.html')
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' })
    res.end(readFileSync(file))
  })
  await new Promise<void>((resolveReady, reject) => {
    server.once('error', reject)
    server.listen(8799, '127.0.0.1', resolveReady)
  })
  return async () => {
    server.closeAllConnections?.()
    await new Promise<void>((resolveClosed) => server.close(() => resolveClosed()))
    if (previousLogLevel === undefined) delete process.env.FLEETHUB_LOG_LEVEL
    else process.env.FLEETHUB_LOG_LEVEL = previousLogLevel
  }
}
