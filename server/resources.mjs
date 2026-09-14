// Recursos autenticados. El rol decide qué acción puede realizar una persona;
// las ubicaciones que comparte con un vehículo deciden sobre cuáles.

import { Users, roleOf, tierOf } from './users.mjs'
import { sameCompany } from './company.mjs'
import { Locations } from './locations.mjs'
import { Vehicles, VEHICLE_STATES } from './vehicles.mjs'
import { Grants } from './grants.mjs'
import { isStaff } from './staff.mjs'
import { TIER } from './codes.mjs'

/** El nivel de una llave de soporte, dicho una vez y leído de codes.mjs. */
const SUPPORT_TIER = TIER.SUPPORT
/** Lo que presta una ventana de soporte, en el mismo formato que la fila. */
const ADMIN_TIER = TIER.ADMIN

const GRANT_ERRORS = {
  ALREADY_OPEN: [409, 'YA TIENES UN ACCESO ABIERTO'],
  ALREADY_ENDED: [409, 'ESE ACCESO YA ESTABA CERRADO'],
  UNKNOWN: [404, 'ESE ACCESO NO EXISTE'],
}

const GRANTS = {
  ADMINISTRADOR: ['ver', 'escanear', 'unidad.modificar', 'unidad.remover', 'ubicacion.editar', 'usuario.editar', 'usuario.suspender'],
  OPERADOR: ['ver', 'escanear', 'unidad.modificar'],
  VISITANTE: ['ver'],
}

export const RESOURCES = [
  /^\/api\/vehicles$/,
  /^\/api\/vehicles\/location-status$/,
  /^\/api\/vehicles\/states$/,
  /^\/api\/vehicles\/[\w-]+$/,
  /^\/api\/vehicles\/[\w-]+\/details$/,
  /^\/api\/vehicles\/[\w-]+\/state$/,
  /^\/api\/vehicles\/[\w-]+\/route-start$/,
  /^\/api\/vehicles\/[\w-]+\/positions$/,
  /^\/api\/vehicles\/[\w-]+\/events$/,
  /^\/api\/vehicles\/[\w-]+\/locations(?:\/[\w-]+)?$/,
  /^\/api\/events$/,
  /^\/api\/users$/,
  /^\/api\/users\/[\w-]+$/,
  /^\/api\/users\/[\w-]+\/password$/,
  /^\/api\/users\/[\w-]+\/suspension$/,
  /^\/api\/users\/[\w-]+\/locations(?:\/[\w-]+)?$/,
  /^\/api\/geocoding\/suggestions$/,
  /^\/api\/locations(?:\/[\w-]+)?$/,
  /^\/api\/locations\/[\w-]+\/points(?:\/[\w-]+)?$/,
  /^\/api\/dismissals$/,
  /^\/api\/grants(?:\/[\w-]+)?$/,
]

export const isResource = (path) => RESOURCES.some((re) => re.test(path))

/**
 * Quién es la sesión durante esta petición.
 *
 * Casi siempre, su propia cuenta. Cuando es una cuenta de FleetHub con una
 * ventana de soporte abierta, es esa cuenta *dentro* de la empresa que se la
 * concedió y con lo que puede administración: eso es lo que la llave promete,
 * y hasta ahora sólo existía en el navegador, que es tanto como no existir.
 *
 * La identidad devuelta es una copia. El `id` sigue siendo el suyo — lo que
 * firme queda a su nombre — y lo prestado es únicamente la empresa y el rol.
 */
export function identityFor(rows, at) {
  const row = (rows?.users ?? []).find((user) => user.id === at?.userId)
  if (!row || !isStaff(row)) return row
  const open = new Grants(rows.grants ?? []).openFor(row.id)
  if (!open) return row
  return { ...row, companyId: open.companyId, role: ADMIN_TIER, supportGrantId: open.id }
}

export function can(user, action) {
  if (!user || user.suspension) return false
  // La fila guardada trae el rol como nivel; lo que sale por `view` lo trae
  // como nombre. Esto se llama con las dos, así que se normaliza aquí.
  return (GRANTS[roleOf(tierOf(user.role))] ?? []).includes(action)
}

const stamp = (prefix, at = new Date()) => `${prefix}-${at.getTime().toString(36).toUpperCase()}`
const ok = (value = {}) => ({ status: 200, body: { ok: true, ...value } })
const no = (status, error, message) => ({ status, body: { ok: false, error, message } })
const forbidden = () => no(403, 'FORBIDDEN', 'NO TIENES PERMISO PARA ESTO')

const USER_ERRORS = {
  MISSING_NAME: [400, 'FALTA EL NOMBRE'], INVALID_EMAIL: [400, 'CORREO NO VÁLIDO'],
  EMAIL_TAKEN: [409, 'ESE CORREO YA TIENE CUENTA'], INVALID_PHONE_CODE: [400, 'PREFIJO TELEFÓNICO NO VÁLIDO'],
  INVALID_PHONE: [400, 'TELÉFONO NO VÁLIDO'], PHONE_TAKEN: [409, 'ESE TELÉFONO YA TIENE CUENTA'],
  INVALID_LANGUAGE: [400, 'IDIOMA NO VÁLIDO'], INVALID_ROLE: [400, 'ROL NO VÁLIDO'],
  INVALID_SUSPENSION: [400, 'SUSPENSIÓN NO VÁLIDA'], WEAK_PASSWORD: [400, 'LA CONTRASEÑA NO CUMPLE LAS REGLAS'],
  INVALID_CREDENTIALS: [401, 'CONTRASEÑA ACTUAL INCORRECTA'], SAME_PASSWORD: [409, 'LA NUEVA CONTRASEÑA ES IGUAL A LA ACTUAL'],
  UNKNOWN: [404, 'ESE USUARIO NO EXISTE'],
}

const LOCATION_ERRORS = {
  MISSING_LOCATION_NAME: [400, 'FALTA EL NOMBRE'], INVALID_ACTIVE: [400, 'ESTADO NO VÁLIDO'],
  INVALID_TRAFFIC_MARGIN: [400, 'MARGEN DE TRÁFICO NO VÁLIDO'],
  MISSING_POINT_ADDRESS: [400, 'FALTA LA DIRECCIÓN DEL PUNTO'],
  INVALID_POINT_POSITION: [400, 'COORDENADAS DEL PUNTO NO VÁLIDAS'], INVALID_POINTS: [400, 'PUNTOS NO VÁLIDOS'],
  LOCATION_NOT_FOUND: [404, 'ESA UBICACIÓN NO EXISTE'], POINT_NOT_FOUND: [404, 'ESE PUNTO NO EXISTE'],
  USER_NOT_FOUND: [404, 'ESE USUARIO NO EXISTE'], VEHICLE_NOT_FOUND: [404, 'ESA UNIDAD NO EXISTE'],
  VEHICLE_LOCATION_NOT_FOUND: [409, 'LA UNIDAD NO TIENE LOCATION ASIGNADA'],
  ROUTE_START_NOT_APPLICABLE: [409, 'LA LOCATION ASIGNADA ES UN PUNTO'],
  INVALID_ROUTE_STARTED_AT: [400, 'FECHA DE INICIO NO VÁLIDA'],
}

const routingBody = (estimate, trafficMarginPercent) => ({
  distanceMeters: estimate.distanceMeters,
  durationSeconds: estimate.durationSeconds,
  geometry: estimate.geometry,
  etaSeconds: Math.round(estimate.durationSeconds * (1 + trafficMarginPercent / 100)),
  trafficMarginPercent,
  routingProvider: estimate.routingProvider,
  routingTraffic: estimate.routingTraffic,
  routingCalculatedAt: estimate.routingCalculatedAt,
})

async function refreshRouteEstimate(locations, locationId, estimateRoute) {
  const location = locations.get(locationId)
  if (!location || location.points.length < 2) {
    locations.setRouteEstimate(locationId, null)
    return { location: locations.get(locationId) }
  }
  // Nunca conservamos la duración de unos puntos anteriores.
  locations.setRouteEstimate(locationId, null)
  if (!estimateRoute) return { location: locations.get(locationId), routingError: 'ROUTING_NOT_CONFIGURED' }
  const estimate = await estimateRoute(location.points)
  if (!estimate.ok) return { location: locations.get(locationId), routingError: estimate.error }
  return { location: locations.setRouteEstimate(locationId, estimate).location }
}

const locationFailure = (result) => {
  const [status, message] = LOCATION_ERRORS[result.error] ?? [400, 'NO SE PUDO MODIFICAR LA UBICACIÓN']
  return no(status, result.error, message)
}

const companyOf = (rows, userId) => (rows.users ?? []).find((row) => row.id === userId)?.companyId ?? null

/**
 * La compañía desde la que se mira.
 *
 * Va como parámetro y no se deduce siempre de la fila del usuario porque
 * durante un acceso de soporte no coinciden: la cuenta es de una empresa y lo
 * que la sesión puede ver es de otra. Sin este hilo, una ventana de soporte
 * mezclaría las ubicaciones de la empresa del visitante con las de la visitada.
 */
const locationIdsFor = (rows, userId, companyId = companyOf(rows, userId)) =>
  companyId ? new Locations(rows, { companyId }).activeIdsForUser(userId) : new Set()

export function canSeeVehicle(rows, userId, vin, companyId = companyOf(rows, userId)) {
  if (!(rows.vehicles ?? []).some((row) => row.vin === vin && sameCompany(row.companyId, companyId))) return false
  const mine = locationIdsFor(rows, userId, companyId)
  return mine.size > 0 && (rows.vehicleLocations ?? []).some(
    (row) => sameCompany(row.companyId, companyId) && row.vin === vin && mine.has(row.locationId),
  )
}

const visibleVehicles = (rows, userId, companyId = companyOf(rows, userId)) =>
  companyId
    ? new Vehicles(rows, { companyId }).list()
      .filter((vehicle) => canSeeVehicle(rows, userId, vehicle.vin, companyId))
    : []

const routeTrackingFor = (rows, companyId, vin) => {
  const assignment = (rows.vehicleLocations ?? []).find((row) => sameCompany(row.companyId, companyId) && row.vin === vin)
  const location = assignment && (rows.locations ?? []).find((row) => sameCompany(row.companyId, companyId) && row.id === assignment.locationId)
  if (!location || (location.points ?? []).length < 2) return null
  const margin = Number.isInteger(Number(location.trafficMarginPercent))
    ? Number(location.trafficMarginPercent)
    : 15
  const duration = location.durationSeconds === null || location.durationSeconds === undefined
    ? null
    : Number(location.durationSeconds)
  const etaSeconds = duration !== null && Number.isFinite(duration) && duration >= 0
    ? Math.round(duration * (1 + margin / 100))
    : null
  const geometry = Array.isArray(location.geometry) ? location.geometry : []
  return {
    locationId: location.id,
    routeStartedAt: assignment.routeStartedAt ?? null,
    etaSeconds,
    geometry: geometry.map((coordinate) => [...coordinate]),
  }
}

const pendingVehicles = (rows, user) => {
  if (!can(user, 'unidad.modificar')) return []
  const assigned = new Set((rows.vehicleLocations ?? []).filter((row) => sameCompany(row.companyId, user.companyId)).map((row) => row.vin))
  const pending = (rows.vehicles ?? []).filter((vehicle) => sameCompany(vehicle.companyId, user.companyId) && !assigned.has(vehicle.vin))
  const vehicles = new Vehicles(rows, { companyId: user.companyId })
  return pending.map((vehicle) => vehicles.get(vehicle.vin))
}

export const canUseVehicle = (rows, user, vin) => {
  if (!(rows.vehicles ?? []).some((row) => sameCompany(row.companyId, user?.companyId) && row.vin === vin)) return false
  const unassigned = !(rows.vehicleLocations ?? []).some((row) => sameCompany(row.companyId, user.companyId) && row.vin === vin)
  return canSeeVehicle(rows, user.id, vin, user.companyId)
    || (unassigned && can(user, 'unidad.modificar'))
}

const VEHICLE_ERRORS = {
  INVALID_VIN: [400, 'VIN NO VÁLIDO'], INVALID_STATE: [400, 'ESTADO NO VÁLIDO'],
  INVALID_POSITION: [400, 'POSICIÓN NO VÁLIDA'], INVALID_YEAR: [400, 'AÑO NO VÁLIDO'],
  INCOMPLETE_DECODE: [400, 'LA DECODIFICACIÓN ESTÁ INCOMPLETA'],
  MISSING_VEHICLE_DETAILS: [400, 'FALTAN AÑO, MARCA O MODELO'],
  MANUAL_DETAILS_NOT_REQUIRED: [409, 'ESTE VEHÍCULO NO NECESITA CAPTURA MANUAL'],
  VEHICLE_NOT_FOUND: [404, 'ESA UNIDAD NO EXISTE'],
}

const vehicleFailure = (result) => {
  const [status, message] = VEHICLE_ERRORS[result.error] ?? [400, 'NO SE PUDO MODIFICAR LA UNIDAD']
  return no(status, result.error, message)
}

const page = (items, query) => {
  const requested = Number(query?.get?.('limit') ?? 50)
  const limit = Number.isInteger(requested) ? Math.min(100, Math.max(1, requested)) : 50
  const cursor = String(query?.get?.('cursor') ?? '')
  const found = cursor ? items.findIndex((item) => item.id === cursor) : -1
  const start = found < 0 ? 0 : found + 1
  const slice = items.slice(start, start + limit)
  return { items: slice, nextCursor: start + limit < items.length ? slice.at(-1)?.id ?? null : null }
}

export async function resource(path, method, at, rows, readBody, save, context = {}) {
  const users = new Users(rows.users)
  const me = identityFor(rows, at)
  // Una cuenta sin empresa no es de ninguna. Pasar `null` significaría «todas»
  // —así lo entiende `belongs`— y era la puerta por la que una cuenta huérfana
  // alcanzaba las filas de cualquiera.
  const scope = me?.companyId || ''
  const locations = new Locations(rows, { companyId: scope })
  const vehicles = new Vehicles(rows, { companyId: scope })

  // ── Direcciones ─────────────────────────────────────────────────────────
  if (path === '/api/geocoding/suggestions' && method === 'GET') {
    if (!can(me, 'ubicacion.editar')) return forbidden()
    if (!context.suggestAddresses)
      return no(503, 'GEOCODING_NOT_CONFIGURED', 'AUTOCOMPLETADO DE DIRECCIONES SIN CONFIGURAR')
    const query = String(context.query?.get?.('q') ?? '').trim()
    const language = String(context.query?.get?.('language') ?? 'en')
    const found = await context.suggestAddresses(query, { language, limit: 5 })
    if (!found.ok) {
      if (found.error === 'GEOCODING_NOT_CONFIGURED')
        return no(503, found.error, 'AUTOCOMPLETADO DE DIRECCIONES SIN CONFIGURAR')
      // La cuota agotada no es un fallo del proveedor: es nuestra decisión de
      // no seguir gastando hoy, y merece decirse con esas palabras.
      if (found.error === 'QUOTA_EXCEEDED')
        return no(429, found.error, 'SE AGOTÓ LA CUOTA DIARIA DE DIRECCIONES')
      return no(502, found.error, 'NO SE PUDIERON BUSCAR DIRECCIONES')
    }
    return ok({ suggestions: found.suggestions })
  }

  // ── Usuarios ────────────────────────────────────────────────────────────
  if (path === '/api/users' && method === 'GET') {
    if (!can(me, 'ver')) return forbidden()
    // La propia cuenta va siempre, aunque no sea de esta compañía: durante un
    // acceso de soporte la sesión mira desde dentro de la empresa, y sin su
    // propia fila el navegador no sabría de quién es la sesión que tiene.
    return ok({
      users: users.list().filter((user) => sameCompany(user.companyId, me.companyId) || user.id === at.userId),
    })
  }

  const onUser = path.match(/^\/api\/users\/([\w-]+)$/)
  if (onUser && method === 'POST') {
    const target = users.find(onUser[1])
    if (!target || !sameCompany(target.companyId, me?.companyId)) return no(404, 'USER_NOT_FOUND', 'ESE USUARIO NO EXISTE')
    const own = target.id === me?.id
    const administer = can(me, 'usuario.editar')
    if (!own && !administer) return forbidden()
    const sent = await readBody()
    const changed = users.update(target.id, {
      fullName: sent.fullName, email: sent.email, phoneCode: sent.phoneCode,
      phone: sent.phone, language: sent.language,
      role: administer ? sent.role : undefined,
    })
    if (!changed.ok) {
      const [status, message] = USER_ERRORS[changed.error] ?? [400, 'NO SE PUDO MODIFICAR LA CUENTA']
      return no(status, changed.error, message)
    }
    save()
    return ok({ user: changed.user })
  }

  if (onUser && method === 'DELETE') {
    if (!can(me, 'usuario.editar') || onUser[1] === me.id) return forbidden()
    const target = users.find(onUser[1])
    if (!target || !sameCompany(target.companyId, me.companyId)) return no(404, 'USER_NOT_FOUND', 'ESE USUARIO NO EXISTE')
    const gone = users.remove(onUser[1])
    if (!gone.ok) return no(404, 'USER_NOT_FOUND', 'ESE USUARIO NO EXISTE')
    rows.userLocations = (rows.userLocations ?? []).filter((row) => row.userId !== onUser[1])
    rows.grants = (rows.grants ?? []).filter((row) => row.userId !== onUser[1])
    context.onUserDeleted?.(onUser[1])
    save()
    return ok({ userId: onUser[1] })
  }

  const onPassword = path.match(/^\/api\/users\/([\w-]+)\/password$/)
  if (onPassword && method === 'POST') {
    if (onPassword[1] !== me?.id) return forbidden()
    const sent = await readBody()
    const changed = users.setPassword(me.id, sent.password, { current: sent.current, reset: at.passwordReset === true })
    if (!changed.ok) {
      const [status, message] = USER_ERRORS[changed.error] ?? [400, 'NO SE PUDO CAMBIAR LA CONTRASEÑA']
      return { status, body: { ok: false, error: changed.error, message, ...(changed.failed ? { failed: changed.failed } : {}) } }
    }
    at.passwordReset = false
    context.onPasswordChanged?.(me.id, at)
    save()
    return ok({ user: changed.user })
  }

  const onSuspension = path.match(/^\/api\/users\/([\w-]+)\/suspension$/)
  if (onSuspension && method === 'POST') {
    const target = users.find(onSuspension[1])
    if (!target || !sameCompany(target.companyId, me?.companyId)) return no(404, 'USER_NOT_FOUND', 'ESE USUARIO NO EXISTE')
    const own = target.id === me?.id
    if (!own && !can(me, 'usuario.suspender')) return forbidden()
    if (own && target.suspension === 'admin') return forbidden()
    const sent = await readBody()
    const requested = sent.suspension ?? sent.hold
    if (requested !== null && requested !== 'self' && requested !== 'admin')
      return no(400, 'INVALID_SUSPENSION', 'SUSPENSIÓN NO VÁLIDA')
    const suspension = requested === null ? null : own ? 'self' : 'admin'
    const changed = users.update(target.id, { suspension })
    if (!changed.ok) return no(400, changed.error, 'SUSPENSIÓN NO VÁLIDA')
    save()
    return ok({ user: changed.user })
  }

  // ── Ubicaciones ─────────────────────────────────────────────────────────
  if (path === '/api/locations' && method === 'GET') {
    if (!can(me, 'ver')) return forbidden()
    const visible = can(me, 'ubicacion.editar')
      ? locations.list()
      : can(me, 'unidad.modificar')
        ? locations.list().filter((location) => location.active)
        : locations.forUser(me.id, { activeOnly: true })
    const found = page(visible, context.query)
    return ok({ locations: found.items, nextCursor: found.nextCursor })
  }

  if (path === '/api/locations' && method === 'POST') {
    if (!can(me, 'ubicacion.editar')) return forbidden()
    const sent = await readBody()
    const created = locations.create({
      name: sent.name,
      active: sent.active,
      points: sent.points,
      trafficMarginPercent: sent.trafficMarginPercent,
    })
    if (!created.ok) return locationFailure(created)
    locations.assignUser(created.location.id, me.id, me.id)
    const measured = await refreshRouteEstimate(locations, created.location.id, context.estimateRoute)
    save()
    return ok(measured)
  }

  if (path === '/api/locations/route-estimate' && method === 'POST') {
    if (!can(me, 'ubicacion.editar')) return forbidden()
    const sent = await readBody()
    const margin = locations.trafficMargin(sent.trafficMarginPercent)
    if (!margin.ok) return locationFailure(margin)
    if (!context.estimateRoute)
      return no(503, 'ROUTING_NOT_CONFIGURED', 'CÁLCULO DE RUTA SIN CONFIGURAR')
    const estimate = await context.estimateRoute(sent.points)
    if (!estimate.ok) {
      if (estimate.error === 'QUOTA_EXCEEDED')
        return no(429, estimate.error, 'SE AGOTÓ LA CUOTA DIARIA DE CÁLCULO DE RUTAS')
      const needsPoints = estimate.error === 'ROUTE_NEEDS_TWO_POINTS' || estimate.error === 'INVALID_POINT_POSITION'
      return no(needsPoints ? 400 : 503, estimate.error,
        needsPoints ? 'LA RUTA NECESITA DOS PUNTOS VÁLIDOS' : 'NO SE PUDO CALCULAR LA RUTA')
    }
    return ok({ estimate: routingBody(estimate, margin.margin) })
  }

  const onPoint = path.match(/^\/api\/locations\/([\w-]+)\/points(?:\/([\w-]+))?$/)
  if (onPoint) {
    if (!can(me, 'ubicacion.editar')) return forbidden()
    let changed
    if (method === 'POST' && !onPoint[2]) changed = locations.addPoint(onPoint[1], await readBody())
    if (method === 'POST' && onPoint[2]) changed = locations.updatePoint(onPoint[1], onPoint[2], await readBody())
    if (method === 'DELETE' && onPoint[2]) changed = locations.removePoint(onPoint[1], onPoint[2])
    if (changed) {
      if (!changed.ok) return locationFailure(changed)
      const measured = await refreshRouteEstimate(locations, onPoint[1], context.estimateRoute)
      save()
      return ok({ ...(changed.point ? { point: changed.point } : {}), ...measured })
    }
  }

  const onLocation = path.match(/^\/api\/locations\/([\w-]+)$/)
  if (onLocation && method === 'POST') {
    if (!can(me, 'ubicacion.editar')) return forbidden()
    const sent = await readBody()
    const changed = locations.update(onLocation[1], {
      name: sent.name,
      active: sent.active,
      points: sent.points,
      trafficMarginPercent: sent.trafficMarginPercent,
    })
    if (!changed.ok) return locationFailure(changed)
    const measured = await refreshRouteEstimate(locations, onLocation[1], context.estimateRoute)
    save()
    return ok(measured)
  }

  if (onLocation && method === 'DELETE') {
    if (!can(me, 'ubicacion.editar')) return forbidden()
    const removed = locations.remove(onLocation[1])
    if (!removed.ok) return locationFailure(removed)
    save()
    return ok({ locationId: onLocation[1] })
  }

  const userLocations = path.match(/^\/api\/users\/([\w-]+)\/locations(?:\/([\w-]+))?$/)
  if (userLocations) {
    const target = users.find(userLocations[1])
    if (!target || !sameCompany(target.companyId, me?.companyId)) return no(404, 'USER_NOT_FOUND', 'ESE USUARIO NO EXISTE')
    if (method === 'GET') {
      if (target.id !== me?.id && !can(me, 'usuario.editar')) return forbidden()
      const found = page(locations.forUser(target.id), context.query)
      return ok({ locations: found.items, nextCursor: found.nextCursor })
    }
    if (!can(me, 'usuario.editar')) return forbidden()
    if (method === 'POST' && !userLocations[2]) {
      const sent = await readBody()
      const assigned = locations.assignUser(String(sent.locationId ?? ''), target.id, me.id)
      if (!assigned.ok) return locationFailure(assigned)
      save()
      return ok({ assignment: assigned.assignment })
    }
    if (method === 'DELETE' && userLocations[2]) {
      locations.unassignUser(userLocations[2], target.id)
      save()
      return ok({ userId: target.id, locationId: userLocations[2] })
    }
  }

  // ── Vehículos ───────────────────────────────────────────────────────────
  if (path === '/api/vehicles/states' && method === 'GET') {
    if (!can(me, 'ver')) return forbidden()
    return ok({ states: VEHICLE_STATES })
  }

  if (path === '/api/vehicles/location-status' && method === 'GET') {
    if (!can(me, 'ver')) return forbidden()
    const canAssign = can(me, 'unidad.modificar')
    const administer = can(me, 'ubicacion.editar')
    const visible = (rows.vehicles ?? []).filter((vehicle) => sameCompany(vehicle.companyId, me.companyId) && (
      administer
      || canSeeVehicle(rows, me.id, vehicle.vin, me.companyId)
      || (canAssign && !(rows.vehicleLocations ?? []).some((assignment) =>
        sameCompany(assignment.companyId, me.companyId) && assignment.vin === vehicle.vin))))
    return ok({
      vehicles: visible.map((vehicle) => ({
        vin: vehicle.vin,
        assigned: (rows.vehicleLocations ?? []).some((assignment) =>
          sameCompany(assignment.companyId, me.companyId) && assignment.vin === vehicle.vin),
      })),
    })
  }

  if (path === '/api/vehicles' && method === 'GET') {
    if (!can(me, 'ver')) return forbidden()
    return ok({
      companyId: me.companyId ?? null,
      vehicles: visibleVehicles(rows, me.id, me.companyId).map((vehicle) => ({
        ...vehicle,
        routeTracking: routeTrackingFor(rows, me.companyId, vehicle.vin),
      })),
      pendingVehicles: pendingVehicles(rows, me),
    })
  }

  if (path === '/api/vehicles' && method === 'POST') {
    if (!can(me, 'escanear')) return forbidden()
    const sent = await readBody()
    const made = vehicles.create(sent.vin, { companyId: me.companyId })
    if (!made.ok) return vehicleFailure(made)
    if (!made.created && !canUseVehicle(rows, me, made.vehicle.vin))
      return no(404, 'VEHICLE_NOT_FOUND', 'ESA UNIDAD NO EXISTE')
    let vehicle = made.vehicle
    let decodeError = null
    if ((made.created || made.vehicle.decodeStatus === null) && context.decodeVin) {
      let decoded
      try {
        decoded = await context.decodeVin(made.vehicle.vin)
      } catch {
        decoded = { ok: false, error: 'DECODER_UNAVAILABLE' }
      }
      const completed = decoded?.ok
        ? vehicles.setDecoded(made.vehicle.vin, decoded.details, { decoder: decoded.decoder })
        : decoded
      if (!completed?.ok) decodeError = completed?.error ?? 'DECODER_UNAVAILABLE'
      vehicle = completed?.ok
        ? completed.vehicle
        : vehicles.requireManualDetails(made.vehicle.vin).vehicle
    }
    save()
    return ok({
      created: made.created,
      manualRequired: vehicle.decodeStatus === 'manual-required',
      decodeError,
      vehicle,
    })
  }

  /*
   * Quitar una unidad de la flota.
   *
   * No es borrar el vehiculo: la clave de `vehicles` es la empresa mas el VIN,
   * asi que se va la fila de quien lo pide y la de cualquier otra empresa se
   * queda entera. Lo que si desaparece es todo lo que esta empresa hizo con
   * ella -- escaneos, estado, GPS, alertas descartadas y fotografias.
   *
   * Permiso propio y no `unidad.modificar`, que tambien lo tiene el operador.
   * Cambiar el estado de una unidad es el trabajo del dia; retirarla y llevarse
   * su historial por delante es otra cosa.
   */
  const onVehicle = path.match(/^\/api\/vehicles\/([\w-]+)$/)
  if (onVehicle && method === 'DELETE') {
    if (!can(me, 'unidad.remover')) return forbidden()
    const vin = onVehicle[1].toUpperCase()
    if (!vehicles.find(vin)) return no(404, 'VEHICLE_NOT_FOUND', 'ESA UNIDAD NO EXISTE')
    const gone = vehicles.remove(vin)
    if (!gone.ok) return vehicleFailure(gone)
    // Las filas de las fotos se van con la unidad; sus archivos viven fuera y
    // los borra quien sabe donde estan, despues de guardar.
    context.dropPhotos?.(gone.orphanedPhotos ?? [])
    save()
    return ok({ vin: gone.vin })
  }

  const onDetails = path.match(/^\/api\/vehicles\/([\w-]+)\/details$/)
  if (onDetails && (method === 'GET' || method === 'POST')) {
    const vin = onDetails[1].toUpperCase()
    if (!vehicles.find(vin) || !canUseVehicle(rows, me, vin))
      return no(404, 'VEHICLE_NOT_FOUND', 'ESA UNIDAD NO EXISTE')
    if (method === 'GET') {
      if (!can(me, 'ver')) return forbidden()
      return ok({ vehicle: vehicles.get(vin) })
    }
    if (!can(me, 'unidad.modificar')) return forbidden()
    const changed = vehicles.updateDetails(vin, await readBody())
    if (!changed.ok) return vehicleFailure(changed)
    save()
    return ok({ vehicle: changed.vehicle })
  }

  const onState = path.match(/^\/api\/vehicles\/([\w-]+)\/state$/)
  if (onState && method === 'POST') {
    if (!can(me, 'unidad.modificar')) return forbidden()
    const vin = onState[1].toUpperCase()
    if (!vehicles.find(vin) || !canUseVehicle(rows, me, vin))
      return no(404, 'VEHICLE_NOT_FOUND', 'ESA UNIDAD NO EXISTE')
    const changed = vehicles.setState(vin, (await readBody()).state, { changedBy: me.id })
    if (!changed.ok) return vehicleFailure(changed)
    save()
    return ok({ changed: changed.changed, vehicle: changed.vehicle })
  }

  const onRouteStart = path.match(/^\/api\/vehicles\/([\w-]+)\/route-start$/)
  if (onRouteStart && method === 'POST') {
    if (!can(me, 'unidad.modificar')) return forbidden()
    const vin = onRouteStart[1].toUpperCase()
    if (!vehicles.find(vin) || !canUseVehicle(rows, me, vin))
      return no(404, 'VEHICLE_NOT_FOUND', 'ESA UNIDAD NO EXISTE')
    const sent = await readBody()
    const changed = locations.setVehicleRouteStartedAt(vin, sent.routeStartedAt, me.id)
    if (!changed.ok) return locationFailure(changed)
    let routingError = null
    if ((changed.location.geometry ?? []).length < 2) {
      if (!context.estimateRoute) {
        routingError = 'ROUTING_NOT_CONFIGURED'
      } else {
        const estimate = await context.estimateRoute(changed.location.points)
        if (estimate.ok) locations.setRouteEstimate(changed.location.id, estimate)
        else routingError = estimate.error
      }
    }
    save()
    return ok({
      assignment: changed.assignment,
      routeTracking: routeTrackingFor(rows, me.companyId, vin),
      routingError,
    })
  }

  const onPosition = path.match(/^\/api\/vehicles\/([\w-]+)\/positions$/)
  if (onPosition) {
    const vin = onPosition[1].toUpperCase()
    if (!vehicles.find(vin) || !canUseVehicle(rows, me, vin))
      return no(404, 'VEHICLE_NOT_FOUND', 'ESA UNIDAD NO EXISTE')
    if (method === 'GET') {
      if (!can(me, 'ver')) return forbidden()
      return ok({ position: vehicles.latestPosition(vin) })
    }
    if (method !== 'POST') return null
    if (!can(me, 'unidad.modificar')) return forbidden()
    const reported = vehicles.reportPosition(vin, await readBody(), { reportedBy: me.id })
    if (!reported.ok) return vehicleFailure(reported)
    save()
    return ok({ position: reported.position, vehicle: reported.vehicle })
  }

  const vehicleLocations = path.match(/^\/api\/vehicles\/([\w-]+)\/locations(?:\/([\w-]+))?$/)
  if (vehicleLocations) {
    const vin = vehicleLocations[1].toUpperCase()
    const vehicle = vehicles.find(vin)
    if (!vehicle || !canUseVehicle(rows, me, vin)) return no(404, 'VEHICLE_NOT_FOUND', 'ESA UNIDAD NO EXISTE')
    if (method === 'GET') {
      const found = page(locations.forVehicle(vin), context.query)
      return ok({ locations: found.items, nextCursor: found.nextCursor })
    }
    if (method === 'POST' && !vehicleLocations[2]) {
      if (!can(me, 'unidad.modificar')) return forbidden()
      const sent = await readBody()
      const locationId = String(sent.locationId ?? '')
      const target = locations.find(locationId)
      if (!target || target.active !== true)
        return no(404, 'LOCATION_NOT_FOUND', 'ESA UBICACIÓN NO EXISTE')
      const assigned = sent.replace === true
        ? locations.replaceVehicleLocation(locationId, vin, me.id)
        : locations.assignVehicle(locationId, vin, me.id)
      if (!assigned.ok) return locationFailure(assigned)
      save()
      return ok({ assignment: assigned.assignment })
    }
    if (method === 'DELETE' && vehicleLocations[2]) {
      if (!can(me, 'ubicacion.editar')) return forbidden()
      locations.unassignVehicle(vehicleLocations[2], vin)
      save()
      return ok({ vin, locationId: vehicleLocations[2] })
    }
  }

  const onEvent = path.match(/^\/api\/vehicles\/([\w-]+)\/events$/)
  if (onEvent && method === 'POST') {
    if (!can(me, 'unidad.modificar')) return forbidden()
    const vin = onEvent[1].toUpperCase()
    if (!vehicles.find(vin) || !canUseVehicle(rows, me, vin))
      return no(404, 'VEHICLE_NOT_FOUND', 'ESA UNIDAD NO EXISTE')
    const sent = await readBody()
    const kind = String(sent.kind ?? '')
    if (!['location', 'attachments'].includes(kind))
      return no(400, 'INVALID_EVENT_KIND', 'TIPO DE EVENTO NO VÁLIDO')
    if (kind === 'location' && !locations.find(String(sent.locationId ?? '')))
      return no(404, 'LOCATION_NOT_FOUND', 'ESA UBICACIÓN NO EXISTE')
    const photos = Array.isArray(sent.photos) ? sent.photos.map(String) : []
    if (kind === 'attachments' && photos.some((id) => !(rows.photos ?? []).some(
      (photo) => photo.id === id && sameCompany(photo.companyId, me.companyId) && photo.vin === vin)))
      return no(400, 'INVALID_PHOTO_REFERENCE', 'UNA FOTO NO PERTENECE A ESTA UNIDAD')
    const event = {
      id: stamp('EV'), companyId: me.companyId, vin, userId: me.id, kind, createdAt: new Date().toISOString(),
      locationId: kind === 'location' ? String(sent.locationId) : undefined,
      note: String(sent.note ?? ''), photos,
    }
    ;(rows.events ??= []).unshift(event)
    save()
    return ok({ event })
  }

  if (path === '/api/events' && method === 'GET') {
    if (!can(me, 'ver')) return forbidden()
    const visible = new Set([
      ...visibleVehicles(rows, me.id, me.companyId).map((vehicle) => vehicle.vin),
      ...pendingVehicles(rows, me).map((vehicle) => vehicle.vin),
    ])
    return ok({ events: (rows.events ?? []).filter((event) => sameCompany(event.companyId, me.companyId) && visible.has(event.vin)) })
  }

  // ── Alertas ─────────────────────────────────────────────────────────────
  if (path === '/api/dismissals' && method === 'GET') {
    if (!can(me, 'ver')) return forbidden()
    const visible = new Set([
      ...visibleVehicles(rows, me.id, me.companyId).map((vehicle) => vehicle.vin),
      ...pendingVehicles(rows, me).map((vehicle) => vehicle.vin),
    ])
    return ok({ dismissals: (rows.dismissals ?? []).filter((row) => sameCompany(row.companyId, me.companyId) && visible.has(row.vin)) })
  }

  if (path === '/api/dismissals' && method === 'POST') {
    if (!can(me, 'ver')) return forbidden()
    const sent = await readBody()
    const vin = String(sent.vin ?? String(sent.alertId ?? '').split('·')[0]).toUpperCase()
    if (!canUseVehicle(rows, me, vin)) return no(404, 'VEHICLE_NOT_FOUND', 'ESA UNIDAD NO EXISTE')
    if (!sent.alertId) return no(400, 'MISSING_ALERT', 'FALTA LA ALERTA')
    const dismissal = { id: stamp('DIS'), companyId: me.companyId, vin, alertId: String(sent.alertId), title: String(sent.title ?? ''), createdAt: new Date().toISOString(), userId: me.id }
    ;(rows.dismissals ??= []).unshift(dismissal)
    save()
    return ok({ dismissal })
  }

  // ── Acceso de soporte ───────────────────────────────────────────────────
  //
  // La ventana la abre el servidor y sólo el servidor. Antes la fabricaba el
  // navegador después de gastar la llave, así que un aparato podía inventarse
  // una autorización que aquí no constaba — y lo que aquí no consta no manda.
  const onGrant = path.match(/^\/api\/grants(?:\/([\w-]+))?$/)
  if (onGrant) {
    rows.grants ??= []
    const grants = new Grants(rows.grants, { save })
    // La cuenta real, no la prestada: quién puede pedir una ventana no
    // depende de la que ya tenga abierta.
    const account = users.find(at.userId)
    const staff = isStaff(account)

    if (method === 'GET' && !onGrant[1]) {
      const own = staff ? grants.list({ userId: at.userId }) : []
      const given = can(me, 'usuario.editar') && me.companyId
        ? grants.list({ companyId: me.companyId })
        : []
      const byId = new Map([...own, ...given].map((grant) => [grant.id, grant]))
      return ok({
        grants: [...byId.values()],
        open: staff ? grants.openFor(at.userId) ?? null : null,
      })
    }

    if (method === 'POST' && !onGrant[1]) {
      if (!staff) return no(403, 'NOT_STAFF', 'ESTE ACCESO ES SOLO PARA CUENTAS DE FLEETHUB')
      if (!context.codes) return no(503, 'TOKENS_NOT_AVAILABLE', 'NO SE PUDO COMPROBAR LA LLAVE')
      const sent = await readBody()
      const code = String(sent.code ?? '')
      const seen = context.codes.verify(code, { purpose: 'INVITE' })
      if (!seen.ok) return no(seen.error === 'UNKNOWN' ? 404 : 409, seen.error, 'ESA LLAVE YA NO ABRE')
      if (seen.row.tier !== SUPPORT_TIER || !seen.row.companyId)
        return no(400, 'NOT_A_SUPPORT_KEY', 'ESA LLAVE NO ES DE SOPORTE')
      const opened = grants.open({ userId: at.userId, companyId: seen.row.companyId, code })
      if (!opened.ok) {
        const [status, message] = GRANT_ERRORS[opened.error] ?? [400, 'NO SE PUDO ABRIR EL ACCESO']
        return no(status, opened.error, message)
      }
      // La llave se gasta después de abrir la ventana: al revés, una ventana
      // que no llegara a abrirse dejaría la llave quemada por nada.
      const spent = context.codes.spend(code, { purpose: 'INVITE', by: at.userId })
      if (!spent.ok) {
        grants.end(opened.grant.id, { by: at.userId })
        return no(409, spent.error, 'ESA LLAVE YA NO ABRE')
      }
      save()
      return ok({ grant: opened.grant })
    }

    if (method === 'DELETE' && onGrant[1]) {
      const row = grants.find(onGrant[1])
      if (!row) return no(404, 'GRANT_NOT_FOUND', 'ESE ACCESO NO EXISTE')
      const own = row.userId === at.userId
      // El que la tiene, o quien administra la empresa que la concedió.
      const administers = can(me, 'usuario.editar') && sameCompany(row.companyId, me.companyId)
      if (!own && !administers) return forbidden()
      const ended = grants.end(row.id, { by: at.userId })
      if (!ended.ok) {
        const [status, message] = GRANT_ERRORS[ended.error] ?? [400, 'NO SE PUDO CERRAR EL ACCESO']
        return no(status, ended.error, message)
      }
      save()
      return ok({ grant: ended.grant })
    }
  }

  return null
}
