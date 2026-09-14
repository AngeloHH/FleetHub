// Local development host. The API itself lives in app.mjs and is shared with
// Netlify; this file only connects it to Node's HTTP server and local disk.

import { createServer } from 'node:http'
import { Readable } from 'node:stream'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createFleetHubApi, emptyState } from './app.mjs'
import { AddressAutocomplete } from './geocoder.mjs'
import { RouteEstimator } from './router.mjs'
import { createDeliverCode } from './delivery.mjs'
import { twilioVerifier } from './verify.mjs'
import { log } from './observability.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const DIST = join(ROOT, 'dist')
const STORE = process.env.FLEETHUB_STORE_FILE
  ? resolve(ROOT, process.env.FLEETHUB_STORE_FILE)
  : join(ROOT, 'server', 'almacen.json')
const PHOTO_DIR = process.env.FLEETHUB_PHOTO_DIR
  ? resolve(ROOT, process.env.FLEETHUB_PHOTO_DIR)
  : join(ROOT, 'server', 'fotos')
const PORT = Number(process.env.PORT) || 8787

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.heic': 'image/heic', '.heif': 'image/heif',
  '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.gz': 'application/gzip', '.json': 'application/json',
}

const addressAutocomplete = new AddressAutocomplete()
const routeEstimator = new RouteEstimator()
/** El estado en disco, o uno vacío si todavía no hay archivo. */
const readStore = () => {
  try {
    return existsSync(STORE) ? JSON.parse(readFileSync(STORE, 'utf8')) : emptyState()
  } catch {
    return emptyState()
  }
}

const api = createFleetHubApi({
  loadState: async () => {
    const state = readStore()
    return { state, revision: Number.isInteger(state.revision) ? state.revision : 0 }
  },
  /**
   * Guarda sólo si nadie escribió entre la lectura y ahora.
   *
   * Node atiende una petición cada vez, pero no una cada vez *entera*: entre
   * leer el estado y guardarlo hay esperas —decodificar un VIN, pedir una
   * ruta— durante las que otra petición entra, lee lo mismo y guarda primero.
   * Sin esta comprobación, la segunda en guardar borraba a la primera.
   */
  saveState: async (state, { revision } = {}) => {
    if (revision !== undefined && (readStore().revision ?? 0) !== revision) return { ok: false }
    writeFileSync(STORE, JSON.stringify(state, null, 1))
    return { ok: true }
  },
  savePhoto: async (filename, data) => {
    mkdirSync(PHOTO_DIR, { recursive: true })
    writeFileSync(join(PHOTO_DIR, filename), data)
  },
  loadPhoto: async (filename) => {
    const file = join(PHOTO_DIR, filename)
    return existsSync(file) ? readFileSync(file) : null
  },
  // Lo que la retención o un borrado dejan sin fila deja también de ocupar
  // disco. `force` porque que ya no esté es exactamente el resultado buscado.
  removePhoto: async (filename) => rmSync(join(PHOTO_DIR, filename), { force: true }),
  suggestAddresses: (query, options) => addressAutocomplete.suggest(query, options),
  estimateRoute: (points) => routeEstimator.estimate(points),
  // Los mismos proveedores que en producción, leídos del entorno. Sin
  // credenciales queda `undefined` y manda ALLOW_INSECURE_AUTH_CODES, que es
  // como se ha trabajado hasta ahora en local.
  deliverCode: createDeliverCode({ log }),
  verifier: twilioVerifier(),
})

function webRequest(req) {
  const init = { method: req.method, headers: req.headers }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = Readable.toWeb(req)
    init.duplex = 'half'
  }
  return new Request(`http://localhost:${PORT}${req.url ?? '/'}`, init)
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`)
  if (url.pathname.startsWith('/api/')) {
    const answer = await api(webRequest(req))
    res.writeHead(answer.status, Object.fromEntries(answer.headers))
    return res.end(Buffer.from(await answer.arrayBuffer()))
  }

  const safe = normalize(url.pathname).replace(/^(\.\.[/\\])+/, '')
  const file = join(DIST, safe === '/' || safe === '\\' ? 'index.html' : safe)
  if (existsSync(file) && !file.endsWith('/')) {
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' })
    return res.end(readFileSync(file))
  }
  res.writeHead(200, { 'content-type': MIME['.html'] })
  return res.end(readFileSync(join(DIST, 'index.html')))
})

server.listen(PORT, () => console.log(`FleetHub sirviendo app y API en http://localhost:${PORT}`))

const shutdown = () => {
  server.close(() => process.exit(0))
  server.closeAllConnections?.()
  setTimeout(() => process.exit(0), 1_000)
}
process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
