// FleetHub's transport-independent API. The local Node server and Netlify
// Functions both hand it a standard Request; only persistence differs.

import { createHash, randomBytes } from 'node:crypto'
import { Codes, PURPOSE, TIER } from './codes.mjs'
import { Companies } from './companies.mjs'
import { isResource, resource, can, canUseVehicle, identityFor } from './resources.mjs'
import { isTokens, ROLE_OF, tokens } from './tokens.mjs'
import { Users, matches as matchesUser, tierOf } from './users.mjs'
import { decodeVin } from './vin-decoder.mjs'
import { AddressAutocomplete } from './geocoder.mjs'
import { acceptPhoto, MAX_PHOTO_BYTES } from './photos.mjs'
import { environmentName, log, releaseName, Reporter } from './observability.mjs'
import { Quotas } from './quota.mjs'
import { purgeCompany } from './deletion.mjs'
import { sameCompany } from './company.mjs'

export const STORE_VERSION = 15

const freshRows = () => ({
  companies: [], users: [], locations: [], userLocations: [], vehicleLocations: [],
  vehicles: [], vehiclePositions: [], events: [], photos: [], grants: [], dismissals: [],
})

export const emptyState = () => ({
  version: STORE_VERSION,
  /**
   * Cuántas veces se ha escrito este estado.
   *
   * Es lo que convierte «guardar» en «guardar si nadie ha escrito entre
   * medias». No es una transacción —para eso está la base de datos que viene—
   * pero sí impide lo peor de no tenerla: que dos peticiones simultáneas se
   * pisen y una de las dos desaparezca sin que nadie se entere.
   */
  revision: 0,
  rows: freshRows(),
  sessions: {},
  tokens: [],
  rateLimits: {},
  // Lo gastado hoy en proveedores de fuera. Vive con el estado porque una
  // función sin servidor no conserva nada entre peticiones.
  quotas: {},
})

function migrateVersion13(read) {
  const state = structuredClone(read)
  const rows = state.rows ?? {}
  const companies = rows.companies ?? []
  const fallback = companies.length === 1 ? companies[0].id : null
  const users = new Map((rows.users ?? []).map((row) => [row.id, row]))
  const locations = new Map((rows.locations ?? []).map((row) => [row.id, row]))

  for (const location of rows.locations ?? []) {
    if (location.companyId) continue
    const owners = new Set((rows.userLocations ?? [])
      .filter((assignment) => assignment.locationId === location.id)
      .map((assignment) => users.get(assignment.userId)?.companyId)
      .filter(Boolean))
    location.companyId = owners.size === 1 ? [...owners][0] : fallback
  }
  for (const assignment of rows.userLocations ?? [])
    assignment.companyId ??= users.get(assignment.userId)?.companyId ?? locations.get(assignment.locationId)?.companyId ?? fallback

  const vehicles = new Map()
  for (const vehicle of rows.vehicles ?? []) {
    if (!vehicle.companyId) {
      // `createdBy` sólo existe en almacenes v13: se dejó de escribir, pero
      // aquí se lee para repartir los que quedaron sin empresa.
      const byCreator = users.get(vehicle.createdBy)?.companyId
      const assigned = (rows.vehicleLocations ?? []).find((row) => row.vin === vehicle.vin)
      vehicle.companyId = byCreator ?? locations.get(assigned?.locationId)?.companyId ?? fallback
    }
    vehicles.set(vehicle.vin, vehicle)
  }
  for (const assignment of rows.vehicleLocations ?? [])
    assignment.companyId ??= vehicles.get(assignment.vin)?.companyId ?? locations.get(assignment.locationId)?.companyId ?? fallback
  for (const table of ['vehiclePositions', 'events', 'photos', 'dismissals'])
    for (const row of rows[table] ?? []) row.companyId ??= vehicles.get(row.vin)?.companyId ?? fallback

  state.version = 14
  return state
}

/**
 * De la 14 a la 15: el rol pasa a ser el nivel.
 *
 * Guardado deja de ser 'ADMINISTRADOR' y pasa a ser 2. La lectura tolera las
 * dos formas —`tierOf` acepta nombre y número— pero esto lo escribe una vez
 * para que no quede texto en la tabla. De paso se van dos campos que ya nadie
 * escribe: el puesto de la persona y quién dio de alta el vehículo.
 */
function migrateVersion14(read) {
  const state = structuredClone(read)
  const rows = state.rows ?? {}
  for (const user of rows.users ?? []) {
    user.role = tierOf(user.role) ?? 0
    delete user.title
  }
  for (const vehicle of rows.vehicles ?? []) delete vehicle.createdBy
  // La marca del barrido diario: ya no hay barrido que la lea.
  delete state.maintenance
  state.version = 15
  return state
}

export function normalizeState(read) {
  const fresh = emptyState()
  if (read?.version === 13) read = migrateVersion13(read)
  if (read?.version === 14) read = migrateVersion14(read)
  if (!read || read.version !== STORE_VERSION) return fresh
  return { ...fresh, ...read, rows: { ...fresh.rows, ...read.rows } }
}

const USER_ERRORS = {
  MISSING_NAME: [400, 'FALTA EL NOMBRE'], INVALID_EMAIL: [400, 'CORREO NO VÁLIDO'],
  EMAIL_TAKEN: [409, 'ESE CORREO YA TIENE CUENTA'], INVALID_PHONE_CODE: [400, 'PREFIJO TELEFÓNICO NO VÁLIDO'],
  INVALID_PHONE: [400, 'TELÉFONO NO VÁLIDO'], PHONE_TAKEN: [409, 'ESE TELÉFONO YA TIENE CUENTA'],
  INVALID_LANGUAGE: [400, 'IDIOMA NO VÁLIDO'], INVALID_ROLE: [400, 'ROL NO VÁLIDO'],
  INVALID_ID: [400, 'IDENTIDAD NO VÁLIDA'], ID_TAKEN: [409, 'ESA IDENTIDAD YA EXISTE'],
  WEAK_PASSWORD: [400, 'LA CONTRASEÑA NO CUMPLE LAS REGLAS'],
}

const PHOTO_ERRORS = {
  UNSUPPORTED_PHOTO: [415, 'FORMATO DE FOTO NO ADMITIDO'],
  INVALID_PHOTO: [400, 'FOTO NO RECONOCIDA'],
  PHOTO_TOO_LARGE: [413, 'LA FOTO ES DEMASIADO GRANDE'],
}

const baseHeaders = {
  'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
  'access-control-allow-headers': 'content-type, authorization',
  'cache-control': 'no-store',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  'permissions-policy': 'camera=(), geolocation=(), microphone=()',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
}

const configuredOrigins = (value) => new Set(String(value ?? '').split(',').map((origin) => origin.trim()).filter(Boolean))

const countFrom = (value, fallback) => {
  const text = String(value ?? '').trim()
  if (!text) return fallback
  const parsed = Number(text)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

/**
 * Cuántos intentos se admiten de cada cosa, y en cuánto tiempo.
 *
 * Configurable porque el número correcto depende de quién esté al otro lado.
 * Tres compañías por hora y por IP sobra para una oficina y estorba a una
 * suite de pruebas que monta una empresa por caso; diez contraseñas cada diez
 * minutos protege a una cuenta y no basta para una demo con público.
 */
export const rateLimitsFrom = (env = process.env) => ({
  'company-create': { limit: countFrom(env.RATE_COMPANIES_PER_HOUR, 3), windowMs: 60 * 60_000 },
  'password-session': { limit: countFrom(env.RATE_PASSWORDS_PER_10MIN, 10), windowMs: 10 * 60_000 },
  'token-create': { limit: countFrom(env.RATE_CODES_PER_10MIN, 5), windowMs: 10 * 60_000 },
  'token-check': { limit: countFrom(env.RATE_CODE_CHECKS_PER_10MIN, 20), windowMs: 10 * 60_000 },
})

export function createFleetHubApi({
  loadState,
  saveState,
  savePhoto,
  loadPhoto,
  removePhoto,
  suggestAddresses,
  estimateRoute,
  decodeVehicleVin = decodeVin,
  allowedOrigins = process.env.ALLOWED_ORIGINS,
  deliverCode,
  verifier,
  exposeAuthCodes = process.env.NODE_ENV !== 'production',
  reporter = new Reporter(),
  quotaLimits,
  rateLimits = rateLimitsFrom(),
} = {}) {
  if (!loadState || !saveState || !savePhoto || !loadPhoto)
    throw new Error('FLEETHUB_STORAGE_NOT_CONFIGURED')

  return async function handle(request) {
    const startedAt = Date.now()
    const allowed = configuredOrigins(allowedOrigins)
    const origin = request.headers.get('origin')
    const cors = {
      ...baseHeaders,
      ...(origin && allowed.has(origin) ? { 'access-control-allow-origin': origin, vary: 'Origin' } : {}),
    }
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
    const url = new URL(request.url)
    const path = url.pathname

    // El almacén se lee antes que nada, así que su fallo es el primero que hay
    // que saber contestar: sin estado no hay API, y un 500 sin explicación no
    // le dice eso ni al monitor ni a quien lo esté mirando.
    let held
    let revision
    try {
      // El adaptador puede devolver el estado a secas o acompañado de su
      // revisión. Lo segundo es lo que permite escribir sólo si nadie ha
      // escrito antes; lo primero se sigue aceptando para los almacenes que
      // no saben hacerlo, y entonces la escritura es la de siempre.
      const loaded = await loadState()
      const carried = loaded && typeof loaded === 'object' && 'state' in loaded && !('rows' in loaded)
        ? loaded
        : { state: loaded }
      held = normalizeState(carried.state)
      revision = carried.revision ?? held.revision
    } catch (error) {
      void reporter.capture(error, { event: 'store_unavailable', method: request.method, path })
      return Response.json(
        { ok: false, error: 'STORE_UNAVAILABLE', message: 'EL SERVICIO NO ESTÁ DISPONIBLE' },
        { status: 503, headers: cors },
      )
    }
    /*
     * Lo que mira el monitor de disponibilidad.
     *
     * Antes que nada de lo que escribe, y sin pasar por `finish`: un monitor
     * no tiene sesión, no debe tocar el almacén y no puede recibir el 409 de
     * una escritura ajena — un rojo por eso sería un rojo falso, y un rojo
     * falso enseña a ignorar los rojos. Que conteste ya prueba lo que importa:
     * el proceso vive y el estado se pudo leer, que es el paso anterior.
     */
    if (path === '/api/health' && (request.method === 'GET' || request.method === 'HEAD')) {
      return Response.json({
        ok: true,
        service: 'fleethub-api',
        environment: environmentName(),
        release: releaseName(),
        storeVersion: held.version,
        at: new Date().toISOString(),
      }, { status: 200, headers: cors })
    }

    let dirty = false
    const photosToRemove = new Set()
    const mark = () => { dirty = true }
    const finish = async (response) => {
      if (dirty) {
        held.revision = (Number.isInteger(held.revision) ? held.revision : 0) + 1
        const written = await saveState(held, { revision })
        if (written && written.ok === false) {
          log('warn', 'write_conflict', { method: request.method, path })
          // Una lectura escribe por su cuenta —una sesión caducada que se
          // retira— y eso es limpieza, no la respuesta. Si no
          // llegó a guardarse, lo que se iba a contestar sigue siendo cierto y
          // la limpieza la hará la siguiente petición.
          if (request.method === 'GET' || request.method === 'HEAD') return response
          // Una escritura es otra cosa. Perderla en silencio sería lo peor que
          // puede pasar aquí: quien guardó una foto o cambió un estado se iría
          // convencido de que quedó hecho. Un 409 es incómodo y es la verdad,
          // y el cliente reintenta con lo que hay ahora.
          return Response.json(
            { ok: false, error: 'WRITE_CONFLICT', message: 'ALGUIEN GUARDÓ ANTES · VUELVE A INTENTARLO' },
            { status: 409, headers: cors },
          )
        }
      }
      // Primero se guarda que la fila dejó de existir y sólo entonces se borra
      // su objeto. Así un fallo al guardar nunca deja una fila apuntando a una
      // fotografía que ya desapareció.
      if (removePhoto && photosToRemove.size) {
        const results = await Promise.allSettled([...photosToRemove].map((name) => removePhoto(name)))
        const failed = results.filter((result) => result.status === 'rejected').length
        if (failed) log('warn', 'photo_delete_failed', { failed, of: photosToRemove.size })
      }
      // Una línea por respuesta, con lo que sirve para entender un incidente y
      // nada que identifique a nadie: qué se pidió, qué se contestó y cuánto
      // tardó. Ni cuerpo, ni cabeceras, ni quién.
      log(response.status >= 500 ? 'error' : 'info', 'api_request', {
        method: request.method,
        path,
        status: response.status,
        ms: Date.now() - startedAt,
      })
      return response
    }
    const json = (status, value) => finish(Response.json(value, { status, headers: cors }))
    const readBuffer = async (limit = 20 * 1024 * 1024) => {
      const data = Buffer.from(await request.arrayBuffer())
      if (data.length > limit) throw new Error('PAYLOAD_TOO_LARGE')
      return data
    }
    let parsedBody
    let bodyWasRead = false
    const readJson = async () => {
      if (!bodyWasRead) {
        parsedBody = JSON.parse((await readBuffer(2 * 1024 * 1024)).toString('utf8'))
        bodyWasRead = true
      }
      return parsedBody
    }
    const fingerprint = (value) => createHash('sha256').update(String(value ?? '')).digest('hex').slice(0, 24)
    const clientIp = request.headers.get('x-nf-client-connection-ip')
      ?? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      ?? 'local'
    const rate = (bucket, subject) => {
      const { limit, windowMs } = rateLimits[bucket] ?? { limit: 0, windowMs: 60_000 }
      if (!limit) return true
      const now = Date.now()
      held.rateLimits ??= {}
      for (const [key, row] of Object.entries(held.rateLimits))
        if (!row || row.resetAt <= now) delete held.rateLimits[key]
      const key = `${bucket}:${fingerprint(`${clientIp}:${subject}`)}`
      const row = held.rateLimits[key]
      if (!row || row.resetAt <= now) held.rateLimits[key] = { count: 1, resetAt: now + windowMs }
      else row.count += 1
      mark()
      return held.rateLimits[key].count <= limit
    }

    // Lo que se gasta fuera se cuenta aquí. `notify` es el aviso al cruzar el
    // umbral: quien paga la factura quiere enterarse antes de que se acabe.
    held.quotas ??= {}
    const quotas = new Quotas(held.quotas, {
      save: mark,
      limits: quotaLimits,
      notify: (event, fields, level) => void reporter.notify(event, fields, level),
    })

    /**
     * Borra del almacenamiento de objetos lo que ya no tiene fila.
     *
     * Se encolan para que `finish` guarde primero las filas y borre después.
     * Una foto que no se pueda borrar se registra, pero no cambia la respuesta.
     */
    const dropPhotos = (filenames) => {
      if (!removePhoto || !filenames?.length) return
      for (const filename of filenames) photosToRemove.add(filename)
    }

    const userOf = (identity) => {
      const users = new Users(held.rows.users, { save: mark })
      return identity.email ? users.byEmail(identity.email) : users.byPhone(identity.phone)
    }
    const sessionTokenOf = () => String(request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
    const sessionOf = () => {
      const token = sessionTokenOf()
      const session = held.sessions[token]
      if (!session) return null
      if (session.until <= new Date().toISOString()) {
        delete held.sessions[token]
        mark()
        return null
      }
      if (!held.rows.users.some((user) => user.id === session.userId)) return null
      return session
    }
    const grantSession = (user, options = {}) => {
      const token = randomBytes(24).toString('hex')
      held.sessions[token] = {
        userId: user.id,
        until: new Date(Date.now() + 12 * 3_600_000).toISOString(),
        passwordReset: Boolean(options.passwordReset),
      }
      mark()
      return token
    }
    const removeSessions = (userId) => {
      for (const [token, session] of Object.entries(held.sessions)) {
        if (session.userId === userId) delete held.sessions[token]
      }
      mark()
    }
    const removeOtherSessions = (userId, keep) => {
      for (const [token, session] of Object.entries(held.sessions)) {
        if (session.userId === userId && session !== keep) delete held.sessions[token]
      }
      mark()
    }

    try {
      if (path === '/api/sessions/current' && request.method === 'DELETE') {
        const token = sessionTokenOf()
        if (token && held.sessions[token]) {
          delete held.sessions[token]
          mark()
        }
        return json(200, { ok: true })
      }

      if (path === '/api/companies' && request.method === 'POST') {
        if (!rate('company-create', ''))
          return json(429, { ok: false, error: 'RATE_LIMITED', message: 'ESPERA ANTES DE INTENTARLO DE NUEVO' })
        const company = new Companies(held.rows.companies, { save: mark }).create()
        const made = new Codes(held.tokens, { save: mark }).create({
          purpose: PURPOSE.INVITE,
          tier: TIER.ADMIN,
          createdBy: null,
          companyId: company.id,
        })
        if (!made.ok)
          return json(500, { ok: false, error: made.error, message: 'NO SE PUDO CREAR LA LLAVE' })
        return json(200, { ok: true, code: made.code, token: made.row })
      }

      // Borrar la compañía: lo que hace real el derecho a que te borren.
      //
      // Sólo quien administra la compañía y desde su propia cuenta — una
      // ventana de soporte presta lo que puede administración, no la decisión
      // de que la empresa deje de existir. El `confirm` con el UUID delante
      // está para que nadie lo haga con un clic de más.
      if (path === '/api/companies/current' && request.method === 'DELETE') {
        const at = sessionOf()
        if (!at) return json(401, { ok: false, error: 'UNAUTHORIZED', message: 'SESIÓN NO VÁLIDA' })
        const account = new Users(held.rows.users).find(at.userId)
        if (!can(account, 'usuario.editar'))
          return json(403, { ok: false, error: 'FORBIDDEN', message: 'NO TIENES PERMISO PARA ESTO' })
        if (url.searchParams.get('confirm') !== account.companyId)
          return json(400, {
            ok: false, error: 'CONFIRMATION_REQUIRED',
            message: 'CONFIRMA LA COMPAÑÍA QUE QUIERES ELIMINAR',
          })
        const purged = purgeCompany(held, account.companyId)
        if (!purged.ok)
          return json(404, { ok: false, error: purged.error, message: 'ESA COMPAÑÍA NO EXISTE' })
        mark()
        log('warn', 'company_purged', { companyId: account.companyId, ...purged.removed })
        dropPhotos(purged.orphanedPhotos)
        return json(200, { ok: true, removed: purged.removed })
      }

      if (path === '/api/users/password') {
        const users = new Users(held.rows.users, { save: mark })
        if (request.method === 'GET') return json(200, { ok: true, ...users.passwordRules() })
        if (request.method === 'POST')
          return json(200, { ok: true, ...users.checkPassword((await readJson()).password) })
        return json(405, { ok: false, error: 'METHOD_NOT_ALLOWED', message: 'MÉTODO NO PERMITIDO' })
      }

      if (path === '/api/registrations' && request.method === 'POST') {
        const sent = await readJson()
        const codes = new Codes(held.tokens, { save: mark })
        const registration = codes.registration(sent.registrationToken, { addressee: sent.email })
        if (!registration.ok)
          return json(400, { ok: false, error: 'REGISTRATION_NOT_VALID', message: 'CONFIRMA DE NUEVO TU CORREO' })
        const checked = codes.verify(sent.code, { purpose: PURPOSE.INVITE })
        const invitation = checked.ok ? checked.row : null
        const role = invitation ? ROLE_OF[invitation.tier] : undefined
        if (!invitation || !invitation.companyId || !role || invitation.tier === TIER.SUPPORT)
          return json(400, { ok: false, error: 'INVITE_NOT_VALID', message: 'ESA LLAVE YA NO ABRE' })
        const made = new Users(held.rows.users, { save: mark }).create({
          id: registration.userId,
          fullName: sent.fullName,
          email: sent.email,
          phoneCode: sent.phoneCode,
          phone: sent.phone,
          language: sent.language,
          password: sent.password,
          role,
          companyId: invitation.companyId,
        })
        if (!made.ok) {
          const [status, message] = USER_ERRORS[made.error] ?? [400, 'NO SE PUDO CREAR LA CUENTA']
          return json(status, { ok: false, error: made.error, message, ...(made.failed ? { failed: made.failed } : {}) })
        }
        const spent = codes.spend(sent.code, { purpose: PURPOSE.INVITE, by: made.user.id })
        if (!spent.ok) return json(409, { ok: false, error: spent.error, message: 'ESA LLAVE YA NO ABRE' })
        const claimed = codes.claimRegistration(sent.registrationToken, { addressee: sent.email })
        if (!claimed.ok)
          return json(409, { ok: false, error: 'REGISTRATION_NOT_VALID', message: 'CONFIRMA DE NUEVO TU CORREO' })
        return json(200, { ok: true, token: grantSession(made.user), userId: made.user.id, user: made.user })
      }

      if (isTokens(path)) {
        if (request.method === 'POST') {
          const sent = await readJson()
          const purpose = String(sent?.purpose ?? '')
          const subject = sent?.email ?? sent?.phone ?? sent?.addressee ?? ''
          const action = String(sent?.action ?? 'create')
          const allowed = purpose === 'SESSION'
            ? rate('password-session', subject)
            : action === 'create'
              ? rate('token-create', `${purpose}:${subject}`)
              : rate('token-check', `${purpose}:${subject}`)
          if (!allowed)
            return json(429, { ok: false, error: 'RATE_LIMITED', message: 'ESPERA ANTES DE INTENTARLO DE NUEVO' })
        }
        const answer = await tokens(request.method, url.searchParams, sessionOf(), {
          rows: held.rows, table: held.tokens, readBody: readJson, save: mark,
          memberOf: userOf, matches: matchesUser, grantSession,
          deliverCode, verifier, exposeAuthCodes,
        })
        if (!answer)
          return json(405, { ok: false, error: 'METHOD_NOT_ALLOWED', message: 'MÉTODO NO PERMITIDO' })
        return json(answer.status, answer.body)
      }

      const upload = path.match(/^\/api\/vehicles\/([A-HJ-NPR-Z0-9]{17})\/photos$/i)
      if (upload && request.method === 'POST') {
        const at = sessionOf()
        if (!at) return json(401, { ok: false, error: 'UNAUTHORIZED', message: 'SESIÓN NO VÁLIDA' })
        const me = identityFor(held.rows, at)
        if (!can(me, 'unidad.modificar')) return json(403, { ok: false, error: 'FORBIDDEN', message: 'NO TIENES PERMISO PARA ESTO' })
        const vin = upload[1].toUpperCase()
        const vehicle = held.rows.vehicles.find((row) => sameCompany(row.companyId, me.companyId) && row.vin === vin)
        if (!vehicle || !canUseVehicle(held.rows, me, vin))
          return json(404, { ok: false, error: 'VEHICLE_NOT_FOUND', message: 'ESA UNIDAD NO EXISTE' })
        const contentType = String(request.headers.get('content-type') ?? '').split(';')[0].toLowerCase()
        // El tope propio de una foto, más bajo que el del cuerpo en general:
        // lo que sube una cámara cabe de sobra y lo que no cabe no es una foto.
        const sent = await readBuffer(MAX_PHOTO_BYTES)
        const accepted = acceptPhoto(contentType, sent)
        if (!accepted.ok) {
          const [status, message] = PHOTO_ERRORS[accepted.error] ?? [400, 'FOTO NO RECONOCIDA']
          return json(status, { ok: false, error: accepted.error, message })
        }
        const id = `F-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString('hex')}`
        const filename = `${id}.${accepted.ext}`
        // Lo guardado es la copia limpia: sin EXIF, sin XMP y sin comentarios.
        await savePhoto(filename, accepted.data, { contentType })
        const row = {
          id, companyId: me.companyId, vin, uploadedBy: at.userId,
          createdAt: new Date().toISOString(), contentType, filename,
          width: accepted.width, height: accepted.height, bytes: accepted.data.length,
        }
        held.rows.photos.push(row)
        mark()
        const { contentType: _, filename: __, ...photo } = row
        return json(200, { ok: true, photo })
      }

      const photoPath = path.match(/^\/api\/photos\/([\w-]+)$/)
      if (photoPath && request.method === 'GET') {
        const at = sessionOf()
        if (!at) return json(401, { ok: false, error: 'UNAUTHORIZED', message: 'SESIÓN NO VÁLIDA' })
        const me = identityFor(held.rows, at)
        if (!can(me, 'ver')) return json(403, { ok: false, error: 'FORBIDDEN', message: 'NO TIENES PERMISO PARA ESTO' })
        const photo = held.rows.photos.find((row) => sameCompany(row.companyId, me.companyId) && row.id === photoPath[1])
        const vehicle = photo ? held.rows.vehicles.find((row) => sameCompany(row.companyId, me.companyId) && row.vin === photo.vin) : null
        if (!photo || !vehicle || !canUseVehicle(held.rows, me, vehicle.vin))
          return json(404, { ok: false, error: 'NOT_FOUND', message: 'NO EXISTE' })
        const data = await loadPhoto(photo.filename)
        if (!data) return json(404, { ok: false, error: 'NOT_FOUND', message: 'NO EXISTE' })
        return finish(new Response(data, {
          status: 200,
          headers: { ...cors, 'content-type': photo.contentType },
        }))
      }

      if (isResource(path)) {
        const at = sessionOf()
        if (!at) return json(401, { ok: false, error: 'UNAUTHORIZED', message: 'SESIÓN NO VÁLIDA' })
        const addressAutocomplete = new AddressAutocomplete()
        const answer = await resource(path, request.method, at, held.rows, readJson, mark, {
          query: url.searchParams,
          onUserDeleted: removeSessions,
          // Los objetos de las fotos viven fuera del estado; quien los borra es
          // esta capa, y solo despues de que la escritura haya cuajado.
          dropPhotos,
          onPasswordChanged: removeOtherSessions,
          // Los tres proveedores de fuera pasan por su contador. Agotada la
          // cuota, la llamada no se hace: la negativa es nuestra y se explica.
          decodeVin: quotas.guard('vin-decoder', decodeVehicleVin, {
            onExceeded: () => ({ ok: false, error: 'QUOTA_EXCEEDED' }),
          }),
          suggestAddresses: quotas.guard(
            'geoapify',
            suggestAddresses ?? ((query, options) => addressAutocomplete.suggest(query, options)),
          ),
          estimateRoute: quotas.guard('geoapify', estimateRoute),
          // Las llaves viven fuera de las filas de negocio; el acceso de
          // soporte necesita gastar una, así que la tabla viaja en el contexto.
          codes: new Codes(held.tokens, { save: mark }),
        })
        if (!answer)
          return json(405, { ok: false, error: 'METHOD_NOT_ALLOWED', message: 'MÉTODO NO PERMITIDO' })
        return json(answer.status, answer.body)
      }

      return json(404, { ok: false, error: 'NOT_FOUND', message: 'NO EXISTE' })
    } catch (error) {
      const tooLarge = error?.message === 'PAYLOAD_TOO_LARGE'
      const badJson = error instanceof SyntaxError
      // Un cuerpo mal formado o demasiado grande es culpa de quien llama y no
      // hay nada que investigar; lo demás sí, y va a donde se investiga.
      if (!tooLarge && !badJson)
        void reporter.capture(error, { event: 'api_error', method: request.method, path })
      const [status, code, message] = tooLarge
        ? [413, 'PAYLOAD_TOO_LARGE', 'EL ARCHIVO ES DEMASIADO GRANDE']
        : badJson
          ? [400, 'INVALID_BODY', 'LA PETICIÓN NO ESTÁ BIEN FORMADA']
          : [500, 'SERVER_ERROR', 'OCURRIÓ UN ERROR EN EL SERVIDOR']
      return json(status, { ok: false, error: code, message })
    }
  }
}
