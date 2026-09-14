// El hilo entre este aparato y el servidor.
//
// FleetHub es explícitamente online: el servidor manda y la balda local es su
// copia para no repintar la pantalla en blanco entre peticiones, no una cola
// de trabajo pendiente. Al entrar —y al volver a una pestaña que ya tenía
// sesión— se baja lo de la empresa y se funde con lo que hay. El token dice
// quién pregunta; sin token no viaja nada.
//
// La fusión es la misma regla que aplica el servidor: las tablas que sólo
// crecen se unen por id y nada se pierde; las de estado, la fila que llega
// sustituye a la suya. Dos verdades a la vez no existen — existe la última.
//
// Las escrituras que chocan con otra se reintentan aquí, y sólo ésas: el
// servidor comprueba que nadie haya escrito entre que leyó el estado y lo
// guarda, y contesta 409 en vez de pisar el trabajo del otro. Que dos
// personas cambien dos unidades distintas a la vez no es un error de nadie y
// no tiene por qué llegar a la pantalla.

import { locationCode, VEHICLE_STATES, vehicleCode, type Vehicle } from '../domain'
import { write, keepToken, heldToken, offlineMode, type Rows } from './store'

const API = import.meta.env.VITE_API_URL ?? ''

type Answer =
  | { kind: 'ok'; out: Record<string, unknown> }
  | { kind: 'refused'; error: string; reason: string; status: number }
  | { kind: 'empty' }
  | { kind: 'offline' }

/**
 * Cuántas veces se vuelve a intentar una escritura que chocó con otra.
 *
 * El servidor guarda el estado entero de la empresa y comprueba que nadie haya
 * escrito entre que lo leyó y lo guarda; cuando alguien lo hizo contesta 409 en
 * lugar de pisar su trabajo. Reintentar aquí convierte eso en algo que el
 * operador no llega a ver, que es lo que tiene que ser: dos personas cambiando
 * dos unidades distintas a la vez no es un error de nadie.
 */
const CONFLICT_TRIES = 3
const CONFLICT_WAIT = 120

const conflicted = (answer: Answer) => answer.kind === 'refused' && answer.error === 'WRITE_CONFLICT'

const pause = (ms: number) => new Promise((resume) => setTimeout(resume, ms))

/** Reintenta lo que chocó, y nada más: un 403 no mejora por repetirlo. */
async function retrying(attempt: () => Promise<Answer>): Promise<Answer> {
  let answer = await attempt()
  for (let tried = 1; tried < CONFLICT_TRIES && conflicted(answer); tried += 1) {
    await pause(CONFLICT_WAIT * tried)
    answer = await attempt()
  }
  return answer
}

/** Una llamada a la API, con el token si lo hay. Sin red no revienta: dice. */
function call(path: string, body?: unknown, method?: 'GET' | 'POST' | 'DELETE'): Promise<Answer> {
  return retrying(() => once(path, body, method))
}

async function once(path: string, body?: unknown, method?: 'GET' | 'POST' | 'DELETE'): Promise<Answer> {
  try {
    const token = heldToken()
    const verb = method ?? (body === undefined ? 'GET' : 'POST')
    const answer = await fetch(`${API}${path}`, {
      method: verb,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const out = (await answer.json().catch(() => null)) as Record<string, unknown> | null
    // Sólo cuenta lo que habla nuestra API: un host estático contesta a
    // /api/... con su HTML o su 404, y eso no es un rechazo — es que aquí no
    // hay servidor, y la balda local tiene que seguir mandando como siempre.
    if (out === null || typeof out.ok !== 'boolean') return { kind: 'offline' }
    if (answer.ok && out.ok === true) return { kind: 'ok', out }
    // El servidor manda dos cosas cuando refusa: `error`, que es el código de
    // máquina y no cambia nunca, y `message`, que es lo que el operador lee.
    // La pantalla enseña el segundo; las decisiones se toman con el primero.
    if (out.error === 'EMPTY') return { kind: 'empty' }
    if (typeof out.message === 'string')
      return { kind: 'refused', error: String(out.error ?? 'REFUSED'), reason: out.message, status: answer.status }
    return { kind: 'offline' }
  } catch {
    return { kind: 'offline' }
  }
}

function callBinary(path: string, body: Blob): Promise<Answer> {
  return retrying(() => onceBinary(path, body))
}

async function onceBinary(path: string, body: Blob): Promise<Answer> {
  try {
    const token = heldToken()
    const answer = await fetch(`${API}${path}`, {
      method: 'POST',
      headers: {
        'content-type': body.type || 'application/octet-stream',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body,
    })
    const out = (await answer.json().catch(() => null)) as Record<string, unknown> | null
    if (out === null || typeof out.ok !== 'boolean') return { kind: 'offline' }
    if (answer.ok && out.ok === true) return { kind: 'ok', out }
    if (typeof out.message === 'string')
      return { kind: 'refused', error: String(out.error ?? 'REFUSED'), reason: out.message, status: answer.status }
    return { kind: 'offline' }
  } catch {
    return { kind: 'offline' }
  }
}

const identityOf = (id: { kind: 'email'; email: string } | { kind: 'phone'; phone: string }) =>
  id.kind === 'email' ? { email: id.email } : { phone: id.phone }

const addresseeOf = (id: Parameters<typeof identityOf>[0]) =>
  id.kind === 'email' ? id.email.trim().toLowerCase() : id.phone.replace(/\D/g, '')

const PURPOSE = {
  register: 'REGISTER',
  signin: 'SIGN_IN',
  reset: 'PASSWORD_RESET',
} as const

export const serverEntrar = async (id: Parameters<typeof identityOf>[0], password: string) => {
  const answer = await call('/api/tokens', { purpose: 'SESSION', ...identityOf(id), password })
  if (answer.kind !== 'ok') return answer
  const session = answer.out.token as Record<string, unknown> | undefined
  return {
    ...answer,
    out: { ...answer.out, token: answer.out.code, badge: session?.userId },
  } as Answer
}

export const serverPedirCodigo = (id: Parameters<typeof identityOf>[0], flow: string) =>
  call('/api/tokens', {
    purpose: PURPOSE[flow as keyof typeof PURPOSE],
    addressee: addresseeOf(id),
    ...identityOf(id),
  })

export const serverConfirmarCodigo = (
  id: Parameters<typeof identityOf>[0],
  code: string,
  flow: keyof typeof PURPOSE,
) => flow === 'register'
  ? call('/api/tokens', {
      action: 'spend',
      purpose: PURPOSE.register,
      addressee: addresseeOf(id),
      code,
    })
  : call('/api/tokens', {
      purpose: 'SESSION',
      codePurpose: PURPOSE[flow],
      code,
      ...identityOf(id),
    })

export const serverListarInvitaciones = () =>
  call('/api/tokens?purpose=INVITE&live=true')

export const serverComprobarInvitacion = (code: string) =>
  call('/api/tokens', { action: 'verify', purpose: 'INVITE', code })

export const serverCrearInvitacion = (what: { role: string; support?: boolean }) =>
  call('/api/tokens', {
    purpose: 'INVITE',
    ...(what.support ? { tier: 3 } : { role: what.role }),
  })

export const serverRevocarInvitacion = (code: string) =>
  call('/api/tokens', { action: 'revoke', code })

export const serverRegistro = (draft: Record<string, unknown>) => call('/api/registrations', draft)

export const serverCrearCompania = () => call('/api/companies', {})

export const serverFoto = async (vin: string, dataUrl: string) => {
  const photo = await fetch(dataUrl).then((response) => response.blob())
  return callBinary(`/api/vehicles/${encodeURIComponent(vin)}/photos`, photo)
}

export const serverCerrarSesion = () => call('/api/sessions/current', undefined, 'DELETE')

export const serverListarEventos = () => call('/api/events')
export const serverCrearEvento = (
  vin: string,
  event: { kind: 'location' | 'attachments'; locationId?: string; note?: string; photos?: string[] },
) => call(`/api/vehicles/${encodeURIComponent(vin)}/events`, event)
export const serverListarDescartes = () => call('/api/dismissals')
export const serverDescartarAlerta = (dismissal: { vin: string; alertId: string; title: string }) =>
  call('/api/dismissals', dismissal)

export const serverListarUsuarios = () => call('/api/users')

export const serverListarAccesos = () => call('/api/grants')

export const serverAbrirAcceso = (code: string) => call('/api/grants', { code })

export const serverCerrarAcceso = (id: string) =>
  call(`/api/grants/${encodeURIComponent(id)}`, undefined, 'DELETE')

export const serverGuardarUsuario = (operatorId: string, edit: Record<string, unknown>) =>
  call(`/api/users/${operatorId}`, edit)

export const serverCambiarPassword = (operatorId: string, password: string, current?: string) =>
  call(`/api/users/${operatorId}/password`, { password, current })

export const serverSuspenderUsuario = (
  operatorId: string,
  hold: 'self' | 'admin' | null,
) => call(`/api/users/${operatorId}/suspension`, { hold })

export const serverCrearVehiculo = (vin: string) =>
  call('/api/vehicles', { vin })

export const serverListarVehiculos = () => call('/api/vehicles')

export const serverGuardarEstadoVehiculo = (vin: string, state: number | null) =>
  call(`/api/vehicles/${encodeURIComponent(vin)}/state`, { state })

export const serverGuardarInicioRutaVehiculo = (vin: string, routeStartedAt: string | null) =>
  call(`/api/vehicles/${encodeURIComponent(vin)}/route-start`, { routeStartedAt })

export const serverGuardarDetallesVehiculo = (
  vin: string,
  details: { year: number; make: string; model: string; trim?: string; body?: string; engine?: string },
) => call(`/api/vehicles/${encodeURIComponent(vin)}/details`, details)

export const serverObtenerDetallesVehiculo = (vin: string) =>
  call(`/api/vehicles/${encodeURIComponent(vin)}/details`)

export const serverListarUbicacionesVehiculo = (vin: string) =>
  call(`/api/vehicles/${encodeURIComponent(vin)}/locations?limit=100`)

export const serverAsignarUbicacionVehiculo = (vin: string, locationId: string) =>
  call(`/api/vehicles/${encodeURIComponent(vin)}/locations`, { locationId, replace: true })

export const serverEstadoUbicacionesVehiculos = () =>
  call('/api/vehicles/location-status')

export const serverReportarPosicionVehiculo = (
  vin: string,
  position: { latitude: number; longitude: number; accuracy?: number | null },
) => call(`/api/vehicles/${encodeURIComponent(vin)}/positions`, position)

export const serverObtenerPosicionVehiculo = (vin: string) =>
  call(`/api/vehicles/${encodeURIComponent(vin)}/positions`)

export const serverSugerirDirecciones = (query: string, language: string) =>
  call(`/api/geocoding/suggestions?q=${encodeURIComponent(query)}&language=${encodeURIComponent(language)}`)

export const serverEstimarRuta = (
  points: Array<{ latitude: number; longitude: number }>,
  trafficMarginPercent: number,
) => call('/api/locations/route-estimate', { points, trafficMarginPercent })

export const serverListarUbicaciones = (cursor?: string) =>
  call(`/api/locations?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)

export const serverCrearUbicacion = (location: Record<string, unknown>) =>
  call('/api/locations', location)

export const serverActualizarUbicacion = (locationId: string, location: Record<string, unknown>) =>
  call(`/api/locations/${encodeURIComponent(locationId)}`, location)

export const serverEliminarUbicacion = (locationId: string) =>
  call(`/api/locations/${encodeURIComponent(locationId)}`, undefined, 'DELETE')

/**
 * Saca la unidad de la flota de esta compañía.
 *
 * No borra el vehículo: la clave es (compañía, VIN), así que otra compañía que
 * lo tenga lo conserva entero. Lo que se va es lo que esta compañía hizo con
 * él, y el mismo VIN se puede volver a escanear después como nuevo.
 */
export const serverRemoverUnidad = (vin: string) =>
  call(`/api/vehicles/${encodeURIComponent(vin)}`, undefined, 'DELETE')

/** Las tablas que viajan, en el orden en que se funden. */
const GROW = ['events', 'photos', 'dismissals'] as const
const STATE = ['companies', 'users', 'memberships', 'vehicles', 'routes', 'grants'] as const

const fleetVehicle = (
  value: unknown,
  companyId: string,
  pendingLocation: boolean,
): Vehicle | null => {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  if (typeof row.vin !== 'string') return null
  const position = row.position && typeof row.position === 'object'
    ? row.position as Record<string, unknown>
    : null
  const latitude = Number(position?.latitude)
  const longitude = Number(position?.longitude)
  const hasPosition = Number.isFinite(latitude) && Number.isFinite(longitude)
  const make = typeof row.make === 'string' ? row.make : ''
  const model = typeof row.model === 'string' ? row.model : ''
  const trim = typeof row.trim === 'string' ? row.trim : ''
  const body = typeof row.body === 'string' ? row.body : ''
  const year = typeof row.year === 'number' ? row.year : null
  const state = VEHICLE_STATES.find((candidate) => candidate.id === row.state)?.name ?? null
  const tracking = row.routeTracking && typeof row.routeTracking === 'object'
    ? row.routeTracking as Record<string, unknown>
    : null
  const geometry = (Array.isArray(tracking?.geometry) ? tracking.geometry : [])
    .filter((coordinate): coordinate is unknown[] => Array.isArray(coordinate) && coordinate.length >= 2)
    .map((coordinate) => [Number(coordinate[0]), Number(coordinate[1])] as [number, number])
    .filter(([longitude, latitude]) => Number.isFinite(longitude) && Number.isFinite(latitude))
  const routeTracking = tracking && typeof tracking.locationId === 'string'
    ? {
        locationId: tracking.locationId,
        routeStartedAt: typeof tracking.routeStartedAt === 'string' ? tracking.routeStartedAt : null,
        etaSeconds: tracking.etaSeconds === null || tracking.etaSeconds === undefined
          ? null
          : Number(tracking.etaSeconds),
        geometry,
      }
    : null
  return {
    id: vehicleCode(row.vin),
    companyId,
    vin: row.vin,
    ...(typeof row.createdAt === 'string' ? { createdAt: row.createdAt } : {}),
    ...(typeof row.updatedAt === 'string' ? { updatedAt: row.updatedAt } : {}),
    pendingLocation,
    state,
    routeTracking,
    model: [make, model].filter(Boolean).join(' ') || 'SIN DECODIFICAR',
    spec: [trim, body, year].filter(Boolean).join(' · ') || '—',
    ...(hasPosition ? { coords: [longitude, latitude] as [number, number] } : {}),
    position: hasPosition ? 'VERIFICADA EN CAMPO' : 'SIN POSICIÓN REGISTRADA',
    ...(typeof position?.createdAt === 'string' ? { positionAt: position.createdAt } : {}),
    positionAccuracy: position?.accuracy === null || position?.accuracy === undefined
      ? null
      : Number(position.accuracy),
    ...(hasPosition ? { signalMin: 0, speedKmh: 0 } : {}),
  }
}

/** Baja los usuarios y la flota autorizada para la sesión actual. */
export async function pullRows(): Promise<boolean> {
  if (offlineMode() || !heldToken()) return false
  const [people, fleet, history, dismissals, access] = await Promise.all([
    serverListarUsuarios(), serverListarVehiculos(), serverListarEventos(), serverListarDescartes(),
    serverListarAccesos(),
  ])
  const got: Partial<Rows> = {}
  let fleetCompanyId: string | null = null
  if (people.kind === 'ok') {
    if (Array.isArray(people.out.users)) got.users = people.out.users as Rows['users']
    if (Array.isArray(people.out.memberships))
      got.memberships = people.out.memberships as Rows['memberships']
  }
  if (fleet.kind === 'ok' && typeof fleet.out.companyId === 'string') {
    fleetCompanyId = fleet.out.companyId
    // La compañía de la sesión la dice el servidor: durante un acceso de
    // soporte no es la de la cuenta, y deducirla de la fila diría la otra.
    got.companyId = fleetCompanyId
    const visible = Array.isArray(fleet.out.vehicles) ? fleet.out.vehicles : []
    const pending = Array.isArray(fleet.out.pendingVehicles) ? fleet.out.pendingVehicles : []
    got.vehicles = [
      ...visible.map((value) => fleetVehicle(value, fleetCompanyId!, false)),
      ...pending.map((value) => fleetVehicle(value, fleetCompanyId!, true)),
    ].filter((vehicle): vehicle is Vehicle => vehicle !== null)
  }
  if (fleetCompanyId && history.kind === 'ok' && Array.isArray(history.out.events)) {
    got.events = history.out.events.flatMap((value) => {
      if (!value || typeof value !== 'object') return []
      const row = value as Record<string, unknown>
      if (typeof row.id !== 'string' || typeof row.vin !== 'string' || typeof row.createdAt !== 'string') return []
      const kind = row.kind === 'state' ? 'estado' : row.kind === 'location' ? 'ruta' : row.kind === 'attachments' ? 'adjuntos' : null
      if (!kind) return []
      return [{
        id: row.id,
        companyId: fleetCompanyId,
        vehicleId: vehicleCode(row.vin),
        userId: typeof row.userId === 'string' ? row.userId : null,
        membershipId: typeof row.userId === 'string' ? row.userId : null,
        kind,
        at: row.createdAt,
        ...(kind === 'estado' ? {
          state: row.state === null || row.state === undefined
            ? 'DISPONIBLE'
            : VEHICLE_STATES.find((candidate) => candidate.id === row.state)?.name ?? 'DISPONIBLE',
        } : {}),
        ...(typeof row.locationId === 'string' ? { route: locationCode(row.locationId) } : {}),
        note: typeof row.note === 'string' ? row.note : '',
        tone: 'ok',
        photos: Array.isArray(row.photos) ? row.photos.map(String) : [],
      } as Rows['events'][number]]
    })
  }
  if (fleetCompanyId && dismissals.kind === 'ok' && Array.isArray(dismissals.out.dismissals)) {
    got.dismissals = dismissals.out.dismissals.flatMap((value) => {
      if (!value || typeof value !== 'object') return []
      const row = value as Record<string, unknown>
      if (typeof row.id !== 'string' || typeof row.alertId !== 'string' || typeof row.createdAt !== 'string') return []
      return [{
        id: row.id,
        companyId: fleetCompanyId,
        alertId: row.alertId,
        title: typeof row.title === 'string' ? row.title : '',
        at: row.createdAt,
        membershipId: typeof row.userId === 'string' ? row.userId : null,
      } as Rows['dismissals'][number]]
    })
  }
  if (access.kind === 'ok' && Array.isArray(access.out.grants)) {
    got.grants = access.out.grants.flatMap((value) => {
      if (!value || typeof value !== 'object') return []
      const row = value as Record<string, unknown>
      if (typeof row.id !== 'string' || typeof row.userId !== 'string'
        || typeof row.companyId !== 'string' || typeof row.grantedAt !== 'string'
        || typeof row.expiresAt !== 'string') return []
      return [{
        id: row.id,
        userId: row.userId,
        companyId: row.companyId,
        code: typeof row.code === 'string' ? row.code : '',
        grantedAt: row.grantedAt,
        expiresAt: row.expiresAt,
        ...(typeof row.endedAt === 'string' ? { endedAt: row.endedAt } : {}),
      } as Rows['grants'][number]]
    })
  }
  if (Object.keys(got).length === 0) return false
  write((rows) => {
    const touched: Partial<Rows> = {}
    if (got.companyId !== undefined) touched.companyId = got.companyId
    for (const table of [...GROW, ...STATE]) {
      if (table === 'vehicles' && fleetCompanyId) {
        touched.vehicles = [
          ...rows.vehicles.filter((vehicle) => vehicle.companyId !== fleetCompanyId),
          ...(got.vehicles ?? []),
        ]
        continue
      }
      const have = (rows[table] ?? []) as { id?: string; code?: string }[]
      const incoming = (got[table] ?? []) as { id?: string; code?: string }[]
      if (!incoming.length) continue
      const byId = new Map(have.map((row) => [row.id ?? row.code, row]))
      for (const row of incoming) {
        const key = row.id ?? row.code
        byId.set(key, table === 'users' ? { ...byId.get(key), ...row } : row)
      }
      touched[table] = [...byId.values()] as never
    }
    return touched
  })
  return true
}

/** Al entrar se refrescan los recursos que ya tienen endpoint específico. */
export async function syncOnSignIn() {
  await pullRows()
}

export { keepToken, heldToken }
