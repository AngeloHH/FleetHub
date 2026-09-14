// The one place that knows where the data comes from.
//
// Every screen reads and writes through here, so the day it stops being an
// object in memory and starts being Postgres behind an API, this file changes
// and nothing else does. That is the whole point of it existing this early.
//
// Everything is asynchronous, even though today nothing waits. With a queue on
// the phone and a server at the other end, no read is instant — and a seam
// written synchronously now would have to be written again.

import {
  blankRoute,
  can,
  type CodeKind,
  dayLabel,
  DAY,
  eventDetail,
  eventTitle,
  groupByState,
  fleetAlerts,
  isToday,
  topByToday,
  CODE_LENGTH,
  grantIsLive,
  joinMember,
  statusOf,
  VEHICLE_STATES,
  type CodeStatus,
  type InviteCode,
  type EventKind,
  type Member,
  type Membership,
  seal,
  type Route,
  type SupportGrant,
  type Tone,
  type User,
  type Vehicle,
  type VehicleEvent,
  type FleetAlert,
  operatorCode,
  locationCode,
  vehicleCode,
  type RoutePoint,
  estimatedRoutePosition,
} from '../domain'
import { heldToken, keepSession, keepToken, offlineMode, read, reset, setOfflineMode, write } from './store'
import {
  pullRows,
  serverConfirmarCodigo,
  serverEntrar,
  serverPedirCodigo,
  serverRegistro,
  serverCrearCompania,
  serverFoto,
  serverCerrarSesion,
  serverCrearEvento,
  serverDescartarAlerta,
  serverComprobarInvitacion,
  serverCrearInvitacion,
  serverAbrirAcceso,
  serverCerrarAcceso,
  serverGuardarUsuario,
  serverListarInvitaciones,
  serverRevocarInvitacion,
  serverCambiarPassword,
  serverSuspenderUsuario,
  serverCrearVehiculo,
  serverGuardarDetallesVehiculo,
  serverGuardarEstadoVehiculo,
  serverGuardarInicioRutaVehiculo,
  serverObtenerDetallesVehiculo,
  serverListarUbicacionesVehiculo,
  serverAsignarUbicacionVehiculo,
  serverObtenerPosicionVehiculo,
  serverReportarPosicionVehiculo,
  serverSugerirDirecciones,
  serverEstimarRuta,
  serverListarUbicaciones,
  serverCrearUbicacion,
  serverActualizarUbicacion,
  serverEliminarUbicacion,
  serverRemoverUnidad,
  syncOnSignIn,
} from './sync'

export { subscribe, reset } from './store'

/** Stands in for the round trip there will be. */
const done = <T>(value: T) => Promise.resolve(value)

// ── Quién pide, y si puede ──────────────────────────────────────────────────

/**
 * What a write answers: it happened, or it was refused and why.
 *
 * Every write takes who is asking, because a server will: it gets a session,
 * looks up what that session may do, and decides. Doing it here does not make
 * it *secure* — this runs in the same program as its caller, so anyone can
 * call around it — but it does make it *correct*: a screen that offers a
 * button it should not, or a guard written wrong, cannot quietly change
 * anything. The day this is a fetch, the refusal below is an HTTP 403 and no
 * call site changes.
 */
export type Result<T = null> = { ok: true; value: T } | { ok: false; reason: string }

const REFUSED = 'NO TIENES PERMISO PARA ESTO'

const granted = <T>(value: T) => done<Result<T>>({ ok: true, value })
const refused = (reason = REFUSED) => done<Result<never>>({ ok: false, reason })

/** The person behind a badge, as the seam sees them. */
function whois(badge: string | null) {
  return badge ? (everyone().find((m) => m.id === badge) ?? null) : null
}

// ── En qué empresa estamos ──────────────────────────────────────────────────

/**
 * The company whose rows this session may read, or null when nobody is in.
 *
 * Every read below goes through `mine()` rather than the raw table, because
 * "everything stored" and "everything this session may see" are two different
 * questions and only one of them belongs to a screen. A server answers it from
 * the token; here it is answered from the session, which is the same shape.
 */
function scope(): string | null {
  const rows = read()
  const badge = rows.session
  if (!badge) return null
  // Lo que dijo el servidor manda: durante un acceso de soporte la sesión
  // trabaja dentro de la empresa que abrió la ventana, y la fila de la cuenta
  // seguiría diciendo la suya.
  return rows.companyId
    ?? rows.memberships.find((m) => m.operatorId === badge)?.companyId
    ?? rows.users.find((user) => user.id === badge)?.companyId
    ?? null
}

/** The rows this session may see. Nothing at all when nobody is signed in. */
function mine() {
  const rows = read()
  const of = scope()
  const belongs = <T extends { companyId: string }>(list: T[]) =>
    of ? list.filter((r) => r.companyId === of) : []
  return {
    ...rows,
    memberships: belongs(rows.memberships),
    vehicles: belongs(rows.vehicles),
    events: belongs(rows.events),
    routes: belongs(rows.routes),
    grants: belongs(rows.grants),
  }
}

/**
 * Starts the session, and remembers it: this tab is still whoever this is
 * after a reload.
 */
export function startSession(badge: string | null) {
  write(() => ({ session: badge }))
  keepSession(badge)
  // Con token, entrar es sincronizarse: baja lo de la empresa, sube lo local.
  if (badge) void syncOnSignIn()
  return done(null)
}

/**
 * Volver a una pestaña que ya tenía sesión.
 *
 * Recargar no vuelve a pasar por `startSession`, así que sin esto la
 * aplicación se quedaba trabajando indefinidamente sobre la balda local: lo
 * que otra persona hubiera cambiado desde otro aparato no aparecía hasta el
 * siguiente inicio de sesión. Lo guardado es un recuerdo; el servidor es lo
 * que hay.
 */
export async function resumeSession() {
  if (!read().session || !heldToken()) return false
  return pullRows()
}

export async function endSession() {
  await serverCerrarSesion()
  keepToken(null)
  keepSession(null)
  reset()
  return null
}

/** Whoever is signed in right now, as the screens want them. */
export function whoami() {
  return done(whois(read().session))
}

// ── Personas ────────────────────────────────────────────────────────────────

/**
 * Everyone there is, across companies. Only the way in uses it: signing in
 * happens before there is a session to scope by, and a badge has to resolve to
 * a person before anything can ask what that person may see.
 */
function everyone(): Member[] {
  const { users, memberships, events, grants } = read()
  const joined = join(memberships, users, events, grants)
  const represented = new Set(joined.map((member) => member.userId))
  return [
    ...joined,
    ...users.filter((user) => !represented.has(user.id)).map((user) => directMember(user, events, grants)),
  ]
}

/** The people this session may see, which is its own company's. */
function members(): Member[] {
  return everyone()
}

/** Adaptador temporal para las pantallas que todavía consumen `Member`. */
function directMember(user: User, events: VehicleEvent[], grants: SupportGrant[]): Member {
  return joinMember(user, {
    id: user.id,
    userId: user.id,
    companyId: user.companyId ?? '',
    operatorId: user.id,
    role: user.role ?? 'VISITANTE',
    zone: '',
    routes: [],
    suspension: user.suspension,
    counters: { unsynced: '0', unsyncedAt: '' },
    lastSeen: user.lastSeen ?? '',
  }, events, grants)
}

function join(
  memberships: Membership[],
  users: User[],
  events: VehicleEvent[],
  grants: SupportGrant[],
): Member[] {
  return memberships.map((m) => {
    const user = users.find((u) => u.id === m.userId)
    if (!user) throw new Error(`membership ${m.id} points at no user`)
    // The events, so that what a person has done is counted and not stored;
    // the grants, so that an open support window is part of who they are.
    return joinMember(user, m, events, grants)
  })
}

export function listMembers() {
  return done(members())
}

export function getMember(operatorId: string | null) {
  return done(members().find((m) => m.id === operatorId) ?? null)
}

/**
 * How the fleet stands: the total, and one entry per state anything is in.
 *
 * 06 draws this as a ring, so what is not in any group is the ring's own grey
 * — the units nobody has reported on yet.
 */
export function fleetStanding() {
  const { vehicles, events } = mine()
  const latest = stateLookup(vehicles, events)
  return done({ total: vehicles.length, byState: groupByState(vehicles, latest) })
}

/** How far back 06's ranking looks. */
export type ScanWindow = 'hoy' | 'semana' | 'mes'

/**
 * Who recorded the most, most first.
 *
 * The values are derived from events with a person, inside the requested
 * window. What the system wrote by itself is not somebody recording.
 */
export function topScanners(limit = 3, window: ScanWindow = 'hoy', now = new Date()) {
  if (window === 'hoy') return done(topByToday(members(), limit))
  const since = now.getTime() - (window === 'semana' ? 7 : 30) * DAY
  const counts: Record<string, number> = {}
  for (const e of mine().events) {
    if (e.membershipId && new Date(e.at).getTime() >= since)
      counts[e.membershipId] = (counts[e.membershipId] ?? 0) + 1
  }
  return done(
    members()
      .map((m) => ({ id: operatorCode(m.userId), name: m.listName, count: counts[m.membershipId] ?? 0 }))
      .filter((m) => m.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, limit),
  )
}

/**
 * Which units are current and which are owed a look.
 *
 * A unit is validated by being scanned: someone stood in front of it and
 * recorded what they saw. A unit nobody has scanned in a day is one the
 * company only knows about second-hand, and that is what "por validar" means.
 *
 * What the system writes by itself does not count. A route reassigned because
 * a unit stopped answering is news about the unit, but it is not a look at it
 * — if anything it is the reason to go and have one.
 */
export function fleetValidation(now = new Date()) {
  const { vehicles, events } = mine()
  const scanned: Record<string, string> = {}
  for (const e of events) {
    if (e.membershipId && !(e.vehicleId in scanned)) scanned[e.vehicleId] = e.at
  }
  const seen = vehicles.map((v) => scanned[v.id])
  return done({
    total: vehicles.length,
    today: seen.filter((at) => at && isToday(at, now)).length,
    stale: seen.filter((at) => !at || now.getTime() - new Date(at).getTime() >= DAY).length,
  })
}

// ── Las alertas ─────────────────────────────────────────────────────────────

/**
 * Las alertas activas de esta empresa: la regla de domain/alerts leída sobre
 * las unidades, menos las condiciones que alguien ya dio por atendidas.
 */
export async function listAlerts(now = new Date()) {
  const { vehicles, events, dismissals } = mine()
  const latest = stateLookup(vehicles, events)
  const unassigned = new Set(vehicles.filter((vehicle) => vehicle.pendingLocation).map((vehicle) => vehicle.id))
  const seen = new Set(dismissals.filter((d) => d.companyId === scope()).map((d) => d.alertId))
  return fleetAlerts(vehicles, latest, now, unassigned).filter((a) => !seen.has(a.id))
}

/** Darla por atendida: quién, cuándo, y qué decía — eso es lo que se guarda. */
export async function dismissAlert(by: string | null, alert: FleetAlert) {
  const author = whois(by)
  const of = scope()
  if (!author || !of) return refused()
  const vehicle = read().vehicles.find((row) => row.id === alert.unit && row.companyId === of)
  if (!vehicle) return refused()
  const answer = await serverDescartarAlerta({ vin: vehicle.vin, alertId: alert.id, title: alert.title })
  if (answer.kind === 'refused') return refused(answer.reason)
  if (answer.kind !== 'ok') return refused('SIN SERVIDOR AL ALCANCE · LA ALERTA NO SE DESCARTÓ')
  await pullRows()
  const row = read().dismissals.find((dismissal) => dismissal.alertId === alert.id)
  return row ? granted(row) : refused()
}

/** Lo descartado hoy, lo más reciente primero: la lista de RESUELTAS HOY. */
export function resolvedToday(now = new Date()) {
  const of = scope()
  return done(
    read()
      .dismissals.filter((d) => d.companyId === of && isToday(d.at, now))
      .sort((a, b) => b.at.localeCompare(a.at)),
  )
}

/**
 * When the log was last added to, whoever added it. What the strip reads as
 * "how long since this device and the company last agreed".
 */
export function lastSync() {
  const events = mine().events
  const newest = events.reduce<string | null>((a, e) => (!a || e.at > a ? e.at : a), null)
  return done(newest)
}

// ── Las llaves de la empresa ────────────────────────────────────────────────

/**
 * What a code is worth. Asked by screen B as soon as six digits are typed.
 *
 * A question for the server like signing in is: the answer says the company
 * and the role, and nobody outside should be able to read the list to work
 * that out for themselves — or to find out which codes exist by trying.
 */
type TokenRecord = {
  code: string
  companyId: string
  tier: number
  zone?: string
  createdBy?: string | null
  createdAt: string
  expiresAt: string
  usedBy?: { at: string; by: string | null }[]
  revokedAt?: string | null
}

const ROLE_BY_TIER = ['VISITANTE', 'OPERADOR', 'ADMINISTRADOR']

/** Adapta la respuesta genérica de tokens a lo que dibuja la pantalla 07b. */
function inviteOf(token: TokenRecord): InviteCode {
  const use = token.usedBy?.at(-1)
  return {
    code: token.code,
    companyId: token.companyId,
    kind: token.tier === 3 ? 'soporte' : 'alta',
    role: ROLE_BY_TIER[token.tier] ?? '',
    issuedBy: token.createdBy ?? null,
    issuedAt: token.createdAt,
    expiresAt: token.expiresAt,
    ...(use ? { usedBy: use.by ?? undefined, usedAt: use.at } : {}),
    ...(token.revokedAt ? { revokedAt: token.revokedAt } : {}),
  }
}

export async function checkCode(code: string): Promise<CodeStatus> {
  if (code.length < CODE_LENGTH) return { kind: 'incomplete' }
  const answer = await serverComprobarInvitacion(code)
  if (answer.kind === 'ok') {
    const found = inviteOf(answer.out.token as TokenRecord)
    return statusOf(code, found)
  }
  if (answer.kind !== 'refused') return { kind: 'unknown' }
  if (answer.error === 'EXPIRED') return { kind: 'expired' }
  if (answer.error === 'USED') return { kind: 'spent' }
  if (answer.error === 'REVOKED') return { kind: 'revoked' }
  if (answer.error === 'WRONG_PURPOSE') return { kind: 'wrongKind' }
  return { kind: 'unknown' }
}

/** The keys still worth handing out, newest first. What 07b lists. */
export async function listCodes(by: string | null) {
  if (!can(whois(by), 'usuario.editar')) return []
  const answer = await serverListarInvitaciones()
  if (answer.kind !== 'ok' || !Array.isArray(answer.out.tokens)) return []
  return (answer.out.tokens as TokenRecord[])
    .map(inviteOf)
    .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt))
}

export async function mintCode(
  by: string | null,
  what: { kind?: CodeKind; role: string },
) {
  if (!scope() || !can(whois(by), 'usuario.editar')) return refused()
  const answer = await serverCrearInvitacion({
    role: what.role,
    support: what.kind === 'soporte',
  })
  if (answer.kind !== 'ok') return refused(answer.kind === 'refused' ? answer.reason : REFUSED)
  return granted(inviteOf(answer.out.token as TokenRecord))
}

/**
 * Withdraws a key before anyone spends it. The row stays: a company being
 * audited wants to read that it existed and was pulled, not to find a gap.
 */
export async function revokeCode(by: string | null, code: string) {
  if (!can(whois(by), 'usuario.editar')) return refused()
  const answer = await serverRevocarInvitacion(code)
  return answer.kind === 'ok'
    ? granted(null)
    : refused(answer.kind === 'refused' ? answer.reason : REFUSED)
}

// ── El acceso de soporte ────────────────────────────────────────────────────

/**
 * The window this account has into this company, open or not.
 *
 * Support is not a rank the company hands out. It is a key the company hands
 * out, and what the key leaves behind is a window with an end on it — so what
 * there is to read is the window, and reading it is how everything else knows
 * whether it is open.
 */
export function supportAccess(by: string | null) {
  const who = whois(by)
  if (!who?.staff) return done<SupportGrant | null>(null)
  const now = new Date()
  // Sin comparar con la empresa de la sesión: la ventana abierta *es* la
  // empresa de la sesión mientras dura, así que preguntarlo sería circular.
  return done(
    read().grants.find((g) => g.userId === who.userId && grantIsLive(g, now)) ?? null,
  )
}

const NOT_STAFF = 'ESTE ACCESO ES SOLO PARA CUENTAS DE FLEETHUB'
const SUPPORT_OFFLINE = 'SIN SERVIDOR AL ALCANCE · EL ACCESO NO CAMBIÓ'

/**
 * Spends a support key and opens the window.
 *
 * Only FleetHub's own accounts can: a key that fell into the wrong hands opens
 * nothing, because what it grants is defined against who is asking. The key is
 * marked spent in the same breath, for the same reason an invite is.
 */
export async function requestSupport(by: string | null, code: string) {
  const who = whois(by)
  if (!who) return refused()
  if (!who.staff) return refused(NOT_STAFF)
  const answer = await serverAbrirAcceso(code)
  if (answer.kind === 'refused') return refused(answer.reason)
  if (answer.kind !== 'ok') return refused(SUPPORT_OFFLINE)
  // La ventana la abre el servidor y la lee el servidor. Lo que se guarda
  // aquí es la copia que acaba de bajarse, no una fila inventada al vuelo.
  await pullRows()
  const opened = answer.out.grant as { id?: string } | undefined
  const grant = read().grants.find((row) => row.id === opened?.id)
  return grant ? granted(grant) : refused(SUPPORT_OFFLINE)
}

/**
 * Closes the window before its time, from either side: the person who has it,
 * or an administrator of the company that gave it. The row stays — the company
 * wants to read that someone was in and until when, not to find a gap.
 */
export async function endSupport(by: string | null, userId?: string): Promise<Result> {
  const who = whois(by)
  if (!who) return refused()
  const own = !userId || userId === who.userId
  if (!own && !can(who, 'usuario.editar')) return refused()
  const target = userId ?? who.userId
  const now = new Date()
  const open = read().grants.filter((g) => g.userId === target && grantIsLive(g, now))
  for (const grant of open) {
    const answer = await serverCerrarAcceso(grant.id)
    if (answer.kind === 'refused') return refused(answer.reason)
    if (answer.kind !== 'ok') return refused(SUPPORT_OFFLINE)
  }
  await pullRows()
  return granted(null)
}

// ── La sesión ───────────────────────────────────────────────────────────────

/** How someone says who they are at the way in. */
export type Identity = { kind: 'email'; email: string } | { kind: 'phone'; phone: string }

/** Either the person the identity belongs to, or why they were turned away. */
export type SignIn = { ok: true; member: Member } | { ok: false; reason: string }

const NO_ACCOUNT = 'NO ENCONTRAMOS ESA CUENTA'
const HELD = 'ESTA CUENTA ESTÁ SUSPENDIDA · CONTACTA A ADMINISTRACIÓN'

const digits = (value: string) => value.replace(/\D/g, '')

function is(member: Member, id: Identity) {
  return id.kind === 'email'
    ? member.email.toLowerCase() === id.email.trim().toLowerCase()
    : digits(member.phone) === digits(id.phone)
}

/**
 * Who an identity belongs to, and whether they may come in.
 *
 * A question for the server, which is why it is a function here rather than a
 * filter in the login screen: nobody who has not signed in should be handed
 * the list of accounts to look through.
 */
export function signIn(id: Identity): Promise<SignIn> {
  // Everyone, and not just this company's: signing in is what decides which
  // company it is going to be, so it cannot be asked from inside one.
  const member = everyone().find((m) => is(m, id))
  if (!member) return done<SignIn>({ ok: false, reason: NO_ACCOUNT })
  // A hold you put on yourself keeps you to your profile; one administration
  // put on you keeps you out altogether.
  if (member.suspension === 'admin') return done<SignIn>({ ok: false, reason: HELD })
  return done<SignIn>({ ok: true, member })
}

// ── La contraseña ───────────────────────────────────────────────────────────

/**
 * One answer for "no such account" and for "wrong password", on purpose.
 *
 * Two different answers make the way in a place to ask which addresses have
 * accounts, one guess at a time, without ever getting one right. The message
 * has to be the same for both — which means it cannot name either.
 */
/**
 * Signing in with what only they should know.
 *
 * The password is never compared to a stored password, because none is stored:
 * it is derived again with the salt kept beside the account and the two
 * derivations are compared. What the rows hold cannot be read back into what
 * somebody typed, so a copy of the rows is not a list of passwords.
 */
/**
 * Entrar pregunta primero al servidor, que es quien custodia las cuentas
 * cuando lo hay. Sin red, la balda local decide — offline-first no es un
 * eslogan, es que el patio sin cobertura sigue trabajando. Y si el servidor
 * está disponible. El frontend nunca siembra datos en el servidor.
 */
export async function signInWithPassword(id: Identity, password: string): Promise<SignIn> {
  const answer = await serverEntrar(id, password)
  if (answer.kind === 'refused') return { ok: false, reason: answer.reason }
  if (answer.kind === 'ok') {
    keepToken(String(answer.out.token))
    await pullRows()
    const member = everyone().find((m) => is(m, id))
    if (member) return { ok: true, member }
  }
  return { ok: false, reason: 'NECESITAS CONEXIÓN PARA INICIAR SESIÓN' }
}

// ── El código de un solo uso ────────────────────────────────────────────────

/** What the way in gets back: where the code went, and how long it is good
 *  for. The code itself comes with it only because nothing here can send an
 *  SMS — a server would put it in the message and never in the reply. */
export type CodeSent = { to: string; code?: string; expiresAt: string; name?: string }

const addressOf = (id: Identity) =>
  (id.kind === 'email' ? id.email.trim().toLowerCase() : digits(id.phone))

const CODE_OFFLINE = 'NECESITAS CONEXIÓN PARA RECIBIR Y COMPROBAR EL CÓDIGO'

/** Crea la compañía y recibe su llave de administrador. */
export async function createCompany(): Promise<Result<string>> {
  const answer = await serverCrearCompania()
  if (answer.kind === 'ok' && typeof answer.out.code === 'string')
    return granted(answer.out.code)
  if (answer.kind === 'refused') return refused(answer.reason)
  return refused(CODE_OFFLINE)
}

/** El servidor es la única autoridad sobre intentos, caducidad y consumo. */
export async function sendCode(
  id: Identity,
  flow: 'register' | 'signin' | 'reset',
): Promise<Result<CodeSent>> {
  const value = (out: Record<string, unknown>): CodeSent => ({
    to: addressOf(id),
    ...(typeof out.code === 'string' ? { code: out.code } : {}),
    expiresAt: String((out.token as Record<string, unknown> | undefined)?.expiresAt),
    ...(typeof out.name === 'string' ? { name: out.name } : {}),
  })
  const answer = await serverPedirCodigo(id, flow)
  if (answer.kind === 'ok') return { ok: true, value: value(answer.out) }
  if (answer.kind === 'refused') return { ok: false, reason: answer.reason }
  return { ok: false, reason: CODE_OFFLINE }
}

export type CodeConfirmation = {
  member: Member | null
  registrationToken: string | null
}

export async function confirmCode(
  id: Identity,
  code: string,
  flow: 'register' | 'signin' | 'reset',
): Promise<Result<CodeConfirmation>> {
  const answer = await serverConfirmarCodigo(id, code, flow)
  if (answer.kind === 'ok') {
    if (answer.out.code && flow !== 'register') keepToken(String(answer.out.code))
    await pullRows()
    const token = answer.out.token as Record<string, unknown> | undefined
    const badge = token?.userId ? String(token.userId) : null
    return {
      ok: true,
      value: {
        member: badge ? (everyone().find((m) => m.id === badge) ?? null) : null,
        registrationToken:
          typeof answer.out.registrationToken === 'string' ? answer.out.registrationToken : null,
      },
    }
  }
  if (answer.kind === 'refused') return { ok: false, reason: answer.reason }
  return { ok: false, reason: CODE_OFFLINE }
}

/** What registration hands over to become a person in the company. */
export type NewMember = {
  fullName: string
  email: string
  phone: string
  phoneCode: string
  language: 'es' | 'en'
  /** The key being redeemed. It is what says the company and the role. */
  code: string
  /** Credencial emitida al confirmar el código REGISTER. */
  registrationToken: string
  /** What they chose to prove it is them. Sealed here; never stored as typed. */
  password: string
}

/**
 * Takes someone in by spending a key.
 *
 * The role is the code's, never the registering person's word for it, and the
 * code is marked spent in the same breath — a key opens the door once, and
 * "check then use" with a gap in the middle is how it opens twice.
 */
export async function registerAccount(draft: NewMember): Promise<Result<string>> {
  const answer = await serverRegistro({ ...draft })
  if (answer.kind === 'ok') {
    keepToken(String(answer.out.token))
    const user = answer.out.user as User | undefined
    if (user?.id) {
      write((rows) => ({ users: [...rows.users.filter((row) => row.id !== user.id), user] }))
      return granted(user.id)
    }
    return refused('EL SERVIDOR NO DEVOLVIÓ EL USUARIO CREADO')
  }
  if (answer.kind === 'refused') return refused(answer.reason)
  return refused(CODE_OFFLINE)
}

/**
 * Changes the password of whoever is asking.
 *
 * Their own and nobody else's: an administrator can suspend an account, which
 * is a thing the company decides, but taking one over is not — and a screen
 * that could set another person's password is a screen that can become them.
 */
export async function setPassword(
  by: string | null,
  password: string,
  current?: string,
): Promise<Result> {
  const who = whois(by)
  if (!who) return { ok: false, reason: REFUSED }
  const answer = await serverCambiarPassword(who.id, password, current)
  if (answer.kind !== 'ok')
    return refused(answer.kind === 'refused' ? answer.reason : CODE_OFFLINE)
  const stored = await seal(password)
  const serverUser = answer.out.user as User | undefined
  write((rows) => ({
    users: rows.users.map((u) => (u.id === who.userId ? { ...u, ...serverUser, password: stored } : u)),
  }))
  return { ok: true, value: null }
}

/** The details a person edits about themselves, plus what an admin assigns. */
export type MemberEdit = {
  fullName: string
  email: string
  phone: string
  country: string
  role: string
}

function applyPeople(out: Record<string, unknown>) {
  const user = out.user as User | undefined
  const membership = out.membership as Membership | undefined
  write((rows) => ({
    ...(user
      ? { users: rows.users.map((row) => row.id === user.id ? { ...row, ...user } : row) }
      : {}),
    ...(membership
      ? { memberships: rows.memberships.map((row) => row.id === membership.id ? membership : row) }
      : {}),
  }))
}

/** Your own details are yours; anyone else's belong to administration. */
export async function saveMember(by: string | null, operatorId: string, edit: MemberEdit) {
  if (by !== operatorId && !can(whois(by), 'usuario.editar')) return refused()
  const answer = await serverGuardarUsuario(operatorId, edit)
  if (answer.kind !== 'ok')
    return refused(answer.kind === 'refused' ? answer.reason : CODE_OFFLINE)
  applyPeople(answer.out)
  return granted(null)
}

/**
 * Puts an account on hold, or lifts it. Null lifts.
 *
 * Yours is yours to put on and to take off — but only the one you put on: a
 * hold administration placed is not yours to lift, which is the whole of what
 * makes it a hold. Anyone else's needs the permission.
 */
export async function setSuspension(
  by: string | null,
  operatorId: string,
  hold: 'self' | 'admin' | null,
) {
  const own = by === operatorId
  if (!own && !can(whois(by), 'usuario.suspender')) return refused()
  // A hold you place on yourself is your own, whichever screen you did it
  // from. An administrator who reached their own account through the console
  // has still only suspended themselves, and can still undo it.
  const kind = own && hold ? 'self' : hold
  if (own && hold === null && whois(by)?.suspension === 'admin') {
    return refused('ESTA SUSPENSIÓN SOLO LA LEVANTA ADMINISTRACIÓN')
  }
  const answer = await serverSuspenderUsuario(operatorId, kind)
  if (answer.kind !== 'ok')
    return refused(answer.kind === 'refused' ? answer.reason : CODE_OFFLINE)
  applyPeople(answer.out)
  return granted(null)
}

/** The routes a person works, which is what 06b ticks on their zone. */
export async function setMemberRoutes(by: string | null, operatorId: string, codes: string[]) {
  if (!can(whois(by), 'usuario.editar')) return refused()
  const answer = await serverGuardarUsuario(operatorId, { routes: codes })
  if (answer.kind !== 'ok')
    return refused(answer.kind === 'refused' ? answer.reason : CODE_OFFLINE)
  applyPeople(answer.out)
  return granted(null)
}

// ── Vehículos ───────────────────────────────────────────────────────────────

export function listVehicles() {
  return done(mine().vehicles
    .map((vehicle) => displayedVehicle(vehicle)))
}

/** Only the ones reporting a position can be drawn on the map. */
export function listPlotted(now = new Date()) {
  return done(mine().vehicles
    .filter((vehicle) => !vehicle.pendingLocation)
    .map((vehicle) => displayedVehicle(vehicle, now))
    .filter((vehicle) => vehicle.coords))
}

export function getVehicle(id: string | null) {
  const vehicle = mine().vehicles.find((candidate) => candidate.id === id)
  return done(vehicle ? displayedVehicle(vehicle) : null)
}

function displayedVehicle(vehicle: Vehicle, now = new Date()): Vehicle {
  const tracking = vehicle.routeTracking
  if (!tracking) return vehicle
  const estimated = estimatedRoutePosition(
    tracking.geometry,
    tracking.routeStartedAt,
    tracking.etaSeconds,
    now,
  )
  return {
    ...vehicle,
    coords: estimated?.coordinates,
    position: estimated
      ? estimated.completed ? 'RUTA FINALIZADA · POSICIÓN ESTIMADA' : 'POSICIÓN ESTIMADA EN RUTA'
      : tracking.routeStartedAt ? 'RUTA SIN ETA DISPONIBLE' : 'RUTA NO INICIADA',
    positionAt: tracking.routeStartedAt ?? undefined,
    positionAccuracy: undefined,
    signalMin: estimated ? 0 : undefined,
    speedKmh: estimated && !estimated.completed ? vehicle.speedKmh : 0,
  }
}

export function findByVin(vin: string) {
  return done(mine().vehicles.find((v) => v.vin === vin) ?? null)
}

/**
 * La subida de lo pendiente — de verdad. El servidor guarda el estado de la
 * empresa temporalmente (memoria y un JSON, no una base de datos, y no lo
 * finge); si contesta, los contadores de «sin subir» quedan en cero, porque
 * eso es lo único que «subido» significa. Si no hay servidor al alcance, la
 * respuesta es esa — y lo guardado sigue aquí, que para eso está la balda.
 */
export async function flushUnsynced(by: string | null): Promise<Result<number>> {
  const author = whois(by)
  const of = scope()
  if (!author || !of) return refused()
  return refused('LA SINCRONIZACIÓN SIN CONEXIÓN SE IMPLEMENTARÁ EN UNA ETAPA POSTERIOR')
}

/**
 * Sube una foto de reporte y devuelve su id. La foto vive en el servidor —
 * pesa demasiado para la balda del navegador — así que sin red o sin sesión
 * del servidor no hay dónde ponerla, y decirlo es el único trato honesto.
 */
export async function uploadPhoto(vin: string, dataUrl: string): Promise<Result<string>> {
  const answer = await serverFoto(vin, dataUrl)
  if (answer.kind === 'ok') {
    const photo = answer.out.photo as Record<string, unknown> | undefined
    return granted(String(photo?.id ?? ''))
  }
  if (answer.kind === 'refused') return refused(answer.reason)
  return refused('SIN SERVIDOR AL ALCANCE · LA FOTO NO SE ADJUNTÓ')
}

/** El modo sin conexión de este aparato, y cómo cambiarlo. */
export { offlineMode, setOfflineMode }

export type VehicleDetails = {
  vin: string
  decodeStatus: null | 'decoded' | 'manual-required' | 'manual'
  decodedAt: string | null
  decoder: string | null
  year: number | null
  make: string | null
  model: string | null
  trim: string | null
  body: string | null
  engine: string | null
}

export type VehiclePosition = {
  latitude: number
  longitude: number
  accuracy: number | null
  createdAt: string
}

/** Última posición aceptada por el servidor; null significa que nunca llegó una. */
export async function latestVehiclePosition(vin: string): Promise<VehiclePosition | null> {
  const answer = await serverObtenerPosicionVehiculo(vin)
  if (answer.kind !== 'ok' || !answer.out.position || typeof answer.out.position !== 'object') return null
  const row = answer.out.position as Record<string, unknown>
  const latitude = Number(row.latitude)
  const longitude = Number(row.longitude)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || typeof row.createdAt !== 'string') return null
  return {
    latitude,
    longitude,
    accuracy: row.accuracy === null || row.accuracy === undefined ? null : Number(row.accuracy),
    createdAt: row.createdAt,
  }
}

const vehicleDetailsFrom = (value: unknown): VehicleDetails | null => {
  if (!value || typeof value !== 'object') return null
  const row = value as Partial<VehicleDetails>
  if (typeof row.vin !== 'string') return null
  return {
    vin: row.vin,
    decodeStatus: row.decodeStatus ?? null,
    decodedAt: row.decodedAt ?? null,
    decoder: row.decoder ?? null,
    year: typeof row.year === 'number' ? row.year : null,
    make: typeof row.make === 'string' ? row.make : null,
    model: typeof row.model === 'string' ? row.model : null,
    trim: typeof row.trim === 'string' ? row.trim : null,
    body: typeof row.body === 'string' ? row.body : null,
    engine: typeof row.engine === 'string' ? row.engine : null,
  }
}

/** Crea por VIN y deja que el servidor decida si NHTSA fue suficiente. */
export async function prepareVehicle(vin: string): Promise<Result<{
  vehicle: VehicleDetails
  manualRequired: boolean
  decodeError: string | null
}>> {
  const answer = await serverCrearVehiculo(vin)
  if (answer.kind === 'refused') return refused(answer.reason)
  if (answer.kind !== 'ok') return refused('SIN SERVIDOR AL ALCANCE · NO SE PUDO DECODIFICAR EL VIN')
  const vehicle = vehicleDetailsFrom(answer.out.vehicle)
  if (!vehicle) return refused('EL SERVIDOR DEVOLVIÓ UNA UNIDAD NO VÁLIDA')
  return granted({
    vehicle,
    manualRequired: answer.out.manualRequired === true || vehicle.decodeStatus === 'manual-required',
    decodeError: typeof answer.out.decodeError === 'string' ? answer.out.decodeError : null,
  })
}

/** Completa o corrige la ficha visible del vehículo. */
export async function saveVehicleDetails(
  vin: string,
  details: { year: number; make: string; model: string; trim?: string; body?: string; engine?: string },
): Promise<Result<VehicleDetails>> {
  const answer = await serverGuardarDetallesVehiculo(vin, details)
  if (answer.kind === 'refused') return refused(answer.reason)
  if (answer.kind !== 'ok') return refused('SIN SERVIDOR AL ALCANCE · NO SE GUARDARON LOS DATOS')
  const vehicle = vehicleDetailsFrom(answer.out.vehicle)
  if (!vehicle) return refused('EL SERVIDOR DEVOLVIÓ UNA UNIDAD NO VÁLIDA')
  write((rows) => ({
    vehicles: rows.vehicles.map((unit) => unit.vin === vehicle.vin ? {
      ...unit,
      model: [vehicle.make, vehicle.model].filter(Boolean).join(' ') || 'SIN DECODIFICAR',
      spec: [vehicle.trim, vehicle.body, vehicle.year].filter(Boolean).join(' · ') || '—',
    } : unit),
  }))
  return granted(vehicle)
}

export async function getVehicleDetails(vin: string): Promise<VehicleDetails | null> {
  const answer = await serverObtenerDetallesVehiculo(vin)
  if (answer.kind !== 'ok') return null
  return vehicleDetailsFrom(answer.out.vehicle)
}

/** Las zonas que la empresa ya usa en membresías, con GLOBAL ('') primero. */
export function listZones() {
  const { memberships } = mine()
  const named = new Set<string>()
  for (const m of memberships) if (m.zone) named.add(m.zone)
  return done(['', ...[...named].sort()])
}

/** Lo que 02 entrega al guardar: el código leído y, si la dejaron, la posición. */
export type ScanDraft = {
  vin: string
  /** El grupo al que se asigna. Vacío es sin grupo, que es un estado legítimo. */
  zone?: string
  /** Lo que la decodificación dijo, para la ficha de una unidad nueva. */
  model?: string
  spec?: string
  coords?: [number, number]
  accuracy?: number | null
}

/**
 * El final de escanear: la unidad queda en las filas, y el escaneo también.
 *
 * Un VIN que ya es de una unidad la actualiza — la posición pasa a ser donde
 * alguien estuvo delante de ella, que es mejor fix que cualquier señal vieja.
 * Uno nuevo la da de alta con la siguiente matrícula libre. En ambos casos se
 * escribe el evento con la persona encima: escanear ES la mirada que
 * fleetValidation cuenta, así que guardar deja a la unidad validada hoy.
 */
export async function saveScan(by: string | null, draft: ScanDraft) {
  const author = whois(by)
  const of = scope()
  if (!of || !can(author, 'escanear')) return { ok: false as const, reason: REFUSED }
  let serverPosition: VehiclePosition | null = null
  if (draft.coords) {
    const [longitude, latitude] = draft.coords
    const answer = await serverReportarPosicionVehiculo(draft.vin, {
      latitude,
      longitude,
      accuracy: draft.accuracy,
    })
    if (answer.kind === 'refused') return { ok: false as const, reason: answer.reason }
    if (answer.kind !== 'ok')
      return { ok: false as const, reason: 'SIN SERVIDOR AL ALCANCE · NO SE GUARDÓ LA UBICACIÓN' }
    const row = answer.out.position as Record<string, unknown> | undefined
    if (row && typeof row.createdAt === 'string') {
      serverPosition = {
        latitude: Number(row.latitude),
        longitude: Number(row.longitude),
        accuracy: row.accuracy === null || row.accuracy === undefined ? null : Number(row.accuracy),
        createdAt: row.createdAt,
      }
    }
  }
  const at = new Date()
  const known = mine().vehicles.find((v) => v.vin === draft.vin)
  const unit: Vehicle = known
    ? {
        ...known,
        zone: draft.zone ?? known.zone,
        coords: draft.coords ?? known.coords,
        position: draft.coords ? 'VERIFICADA EN CAMPO' : known.position,
        positionAt: serverPosition?.createdAt ?? (draft.coords ? at.toISOString() : known.positionAt),
        positionAccuracy: serverPosition?.accuracy ?? (draft.coords ? draft.accuracy : known.positionAccuracy),
        signalMin: 0,
        speedKmh: 0,
      }
    : {
        id: vehicleCode(draft.vin),
        companyId: of,
        vin: draft.vin,
        createdAt: at.toISOString(),
        updatedAt: at.toISOString(),
        pendingLocation: true,
        state: null,
        model: draft.model || 'SIN DECODIFICAR',
        spec: draft.spec || '—',
        zone: draft.zone,
        coords: draft.coords,
        position: draft.coords ? 'ALTA EN CAMPO' : 'SIN POSICIÓN · ALTA MANUAL',
        positionAt: serverPosition?.createdAt ?? (draft.coords ? at.toISOString() : undefined),
        positionAccuracy: serverPosition?.accuracy ?? draft.accuracy,
        signalMin: 0,
        speedKmh: 0,
      }
  const event: VehicleEvent = {
    id: `EV-${at.getTime().toString(36).toUpperCase()}`,
    companyId: of,
    vehicleId: unit.id,
    userId: author?.userId ?? null,
    membershipId: author?.membershipId ?? null,
    kind: 'adjuntos',
    at: at.toISOString(),
    note: known ? 'VIN VERIFICADO EN CAMPO' : 'UNIDAD DADA DE ALTA POR ESCANEO',
    tone: 'ok',
    photos: [],
  }
  write((rows) => ({
    vehicles: known
      ? rows.vehicles.map((v) => (v.id === unit.id ? unit : v))
      : [...rows.vehicles, unit],
    events: [event, ...rows.events],
  }))
  return { ok: true as const, value: unit }
}

/**
 * Where every vehicle stands, in one lookup — a screen drawing a list of them
 * should not ask once per row.
 */
export function vehicleStates() {
  const { vehicles, events } = mine()
  return done(stateLookup(vehicles, events))
}

function stateLookup(vehicles: Vehicle[], events: VehicleEvent[]) {
  const states: Record<string, string> = {}
  const authoritative = new Set<string>()
  for (const vehicle of vehicles) {
    if (!Object.hasOwn(vehicle, 'state')) continue
    authoritative.add(vehicle.id)
    if (vehicle.state) states[vehicle.id] = vehicle.state
  }
  for (const event of events) {
    if (authoritative.has(event.vehicleId)) continue
    if (event.kind === 'estado' && event.state && !(event.vehicleId in states))
      states[event.vehicleId] = event.state
  }
  return states
}

/** Fija una condición o la retira; null es disponible sin crear otro estado. */
export async function setVehicleState(
  by: string | null,
  vin: string,
  vehicleId: string,
  state: string | null,
): Promise<Result<null>> {
  const author = whois(by)
  const of = scope()
  if (!of || !can(author, 'unidad.modificar')) return refused()
  const selected = state === null ? null : VEHICLE_STATES.find((candidate) => candidate.name === state)
  if (state !== null && !selected) return refused('ESTADO NO VÁLIDO')
  const answer = await serverGuardarEstadoVehiculo(vin, selected?.id ?? null)
  if (answer.kind === 'refused') return refused(answer.reason)
  if (answer.kind !== 'ok') return refused('SIN SERVIDOR AL ALCANCE · NO SE CAMBIÓ EL ESTADO')
  const at = new Date()
  const event: VehicleEvent = {
    id: `EV-${at.getTime().toString(36).toUpperCase()}`,
    companyId: of,
    vehicleId,
    userId: author?.userId ?? null,
    membershipId: author?.membershipId ?? null,
    kind: 'estado',
    at: at.toISOString(),
    state: state ?? undefined,
    note: state ? '' : 'ESTADO RETIRADO',
    tone: 'ok',
    photos: [],
  }
  write((rows) => ({
    vehicles: rows.vehicles.map((vehicle) => vehicle.vin === vin ? { ...vehicle, state } : vehicle),
    events: [event, ...rows.events],
  }))
  return granted(null)
}

/** Which route a vehicle was last put on, if any. */
export async function vehicleRoute(vin: string): Promise<Route | null> {
  const answer = await serverListarUbicacionesVehiculo(vin)
  if (answer.kind !== 'ok') return null
  const locations = Array.isArray(answer.out.locations) ? answer.out.locations : []
  return locations.map(routeFromLocation).find((route): route is Route => route !== null) ?? null
}

export async function assignVehicleRoute(vin: string, locationId: string): Promise<Result<null>> {
  const answer = await serverAsignarUbicacionVehiculo(vin, locationId)
  if (answer.kind === 'refused') return refused(answer.reason)
  if (answer.kind !== 'ok') return refused('SIN SERVIDOR AL ALCANCE · NO SE ASIGNÓ LA LOCATION')
  write((rows) => ({
    vehicles: rows.vehicles.map((vehicle) =>
      vehicle.vin === vin ? { ...vehicle, pendingLocation: false } : vehicle),
  }))
  return granted(null)
}

export async function setVehicleRouteStartedAt(
  vin: string,
  routeStartedAt: string | null,
): Promise<Result<null>> {
  const answer = await serverGuardarInicioRutaVehiculo(vin, routeStartedAt)
  if (answer.kind === 'refused') return refused(answer.reason)
  if (answer.kind !== 'ok') return refused('SIN SERVIDOR AL ALCANCE · NO SE GUARDÓ EL INICIO DE RUTA')
  await pullRows()
  return granted(null)
}

// ── El registro ─────────────────────────────────────────────────────────────

/**
 * Everything that happened, newest first.
 *
 * `by` narrows it to one person's own doing, which is what a profile's scan
 * history asks for. Administration asks without one and gets everyone.
 * Events the system recorded rather than a person belong to nobody, so a
 * filtered log never shows them.
 */
export function listEvents(by?: string | null) {
  const events = mine().events
  return done(by ? events.filter((e) => e.membershipId === by) : events)
}

export type FleetEntry = {
  id: string
  vehicleId: string
  vin: string
  kind: EventKind | null
  at: string | null
  title: string
  detail: string
  tone?: Tone
}

/**
 * Una fila por cada vehículo autorizado. El evento más reciente enriquece la
 * fila, pero no decide si la unidad existe en FLOTA: una unidad recién creada
 * también tiene que aparecer aunque todavía no tenga ningún reporte.
 */
export function listLatestPerVehicle() {
  const { vehicles, events } = mine()
  const latest = new Map<string, VehicleEvent>()
  for (const event of events) {
    const known = latest.get(event.vehicleId)
    if (!known || event.at > known.at) latest.set(event.vehicleId, event)
  }
  const rows: FleetEntry[] = vehicles.map((vehicle) => {
    const event = latest.get(vehicle.id)
    if (event) return {
      id: event.id,
      vehicleId: vehicle.id,
      vin: vehicle.vin,
      kind: event.kind,
      at: event.at,
      title: eventTitle(event),
      detail: eventDetail(event),
      tone: event.tone,
    }
    return {
      id: `FLEET-${vehicle.id}`,
      vehicleId: vehicle.id,
      vin: vehicle.vin,
      kind: null,
      at: vehicle.createdAt ?? vehicle.positionAt ?? null,
      title: `${vehicle.id} · sin reportes`,
      detail: [vehicle.model, vehicle.pendingLocation ? 'SIN RUTA/PUNTO ASIGNADO' : '', vehicle.vin]
        .filter(Boolean)
        .join(' · '),
      tone: vehicle.pendingLocation ? 'warn' : 'muted',
    }
  })
  return done(rows.sort((a, b) => (b.at ?? '').localeCompare(a.at ?? '')))
}

/** The days the log has anything to show, in the order it shows them. */
export function listDays(by?: string | null) {
  const events = mine().events
  const theirs = by ? events.filter((e) => e.membershipId === by) : events
  return done([...new Set(theirs.map((e) => dayLabel(e.at)))])
}

export type EventDraft = {
  vehicleId: string
  kind: EventKind
  state?: string
  route?: string
  note?: string
  tone?: Tone
  photos?: string[]
}

/**
 * Add something that happened. Newest first, so it goes on the front — which
 * is also what makes it the vehicle's current state from the next read on.
 *
 * The id is minted here, on the device, because an operator with no signal
 * cannot wait for a server to name their scan. The time is the device's for
 * the same reason; a server would stamp its own on arrival and keep both.
 */
export async function recordEvent(by: string | null, draft: EventDraft) {
  const author = whois(by)
  const of = scope()
  if (!of || !can(author, 'unidad.modificar')) return refused()
  const vehicle = read().vehicles.find((row) => row.id === draft.vehicleId && row.companyId === of)
  if (!vehicle) return refused()
  if (draft.kind === 'estado') return refused('EL ESTADO SE GUARDA DESDE SU CONTROL ESPECÍFICO')
  const location = draft.kind === 'ruta'
    ? read().routes.find((row) => row.companyId === of && (row.code === draft.route || row.id === draft.route))
    : null
  const answer = await serverCrearEvento(vehicle.vin, draft.kind === 'ruta'
    ? { kind: 'location', locationId: location?.id ?? draft.route, note: draft.note }
    : { kind: 'attachments', note: draft.note, photos: draft.photos })
  if (answer.kind === 'refused') return refused(answer.reason)
  if (answer.kind !== 'ok') return refused('SIN SERVIDOR AL ALCANCE · EL REGISTRO NO SE GUARDÓ')
  await pullRows()
  const id = (answer.out.event as Record<string, unknown> | undefined)?.id
  const event = read().events.find((row) => row.id === id)
  return event ? granted(event) : refused()
}

// ── Rutas ───────────────────────────────────────────────────────────────────

export type AddressSuggestion = {
  address: string
  latitude: number
  longitude: number
}

export type RouteEstimate = {
  distanceMeters: number
  durationSeconds: number
  etaSeconds: number
  trafficMarginPercent: number
}

export async function suggestAddresses(query: string): Promise<Result<AddressSuggestion[]>> {
  const language = typeof navigator === 'undefined' ? 'en' : navigator.language.slice(0, 2)
  const answer = await serverSugerirDirecciones(query, language)
  if (answer.kind !== 'ok')
    return { ok: false, reason: answer.kind === 'refused' ? answer.reason : CODE_OFFLINE }
  const suggestions = (Array.isArray(answer.out.suggestions) ? answer.out.suggestions : [])
    .map((item) => item as Record<string, unknown>)
    .map((item) => ({
      address: String(item.address ?? '').trim(),
      latitude: Number(item.latitude),
      longitude: Number(item.longitude),
    }))
    .filter((item) => item.address
      && Number.isFinite(item.latitude) && item.latitude >= -90 && item.latitude <= 90
      && Number.isFinite(item.longitude) && item.longitude >= -180 && item.longitude <= 180)
  return { ok: true, value: suggestions }
}

export async function estimateRoute(
  points: Array<{ latitude: number; longitude: number }>,
  trafficMarginPercent: number,
): Promise<Result<RouteEstimate>> {
  const answer = await serverEstimarRuta(points, trafficMarginPercent)
  if (answer.kind !== 'ok')
    return { ok: false, reason: answer.kind === 'refused' ? answer.reason : CODE_OFFLINE }
  const estimate = answer.out.estimate as Record<string, unknown> | undefined
  const value = {
    distanceMeters: Number(estimate?.distanceMeters),
    durationSeconds: Number(estimate?.durationSeconds),
    etaSeconds: Number(estimate?.etaSeconds),
    trafficMarginPercent: Number(estimate?.trafficMarginPercent),
  }
  if (!Number.isFinite(value.distanceMeters) || !Number.isFinite(value.durationSeconds)
    || !Number.isFinite(value.etaSeconds) || !Number.isFinite(value.trafficMarginPercent))
    return { ok: false, reason: 'EL SERVIDOR DEVOLVIÓ UNA ESTIMACIÓN NO VÁLIDA' }
  return { ok: true, value }
}

function routePointFrom(value: unknown): RoutePoint | null {
  if (!value || typeof value !== 'object') return null
  const point = value as Record<string, unknown>
  const address = String(point.address ?? '').trim()
  const latitude = Number(point.latitude)
  const longitude = Number(point.longitude)
  if (!address || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
  return {
    id: typeof point.id === 'string' ? point.id : undefined,
    address,
    reference: String(point.reference ?? '').trim(),
    latitude,
    longitude,
  }
}

function routeFromLocation(value: unknown): Route | null {
  if (!value || typeof value !== 'object') return null
  const location = value as Record<string, unknown>
  const id = String(location.id ?? '')
  const name = String(location.name ?? '').trim()
  if (!id || !name) return null
  const createdAt = String(location.createdAt ?? '')
  return {
    id,
    companyId: scope() ?? '',
    code: locationCode(id),
    name,
    points: (Array.isArray(location.points) ? location.points : [])
      .map(routePointFrom)
      .filter((point): point is RoutePoint => point !== null),
    created: createdAt ? dayLabel(createdAt) : '—',
    active: location.active === true,
    trafficMarginPercent: Number.isInteger(Number(location.trafficMarginPercent))
      ? Number(location.trafficMarginPercent)
      : 15,
    distanceMeters: location.distanceMeters !== null && location.distanceMeters !== undefined
      && Number.isFinite(Number(location.distanceMeters)) ? Number(location.distanceMeters) : null,
    durationSeconds: location.durationSeconds !== null && location.durationSeconds !== undefined
      && Number.isFinite(Number(location.durationSeconds)) ? Number(location.durationSeconds) : null,
    geometry: (Array.isArray(location.geometry) ? location.geometry : [])
      .filter((coordinate): coordinate is unknown[] => Array.isArray(coordinate) && coordinate.length >= 2)
      .map((coordinate) => [Number(coordinate[0]), Number(coordinate[1])] as [number, number])
      .filter(([longitude, latitude]) => Number.isFinite(longitude) && Number.isFinite(latitude)),
    routeStartedAt: typeof location.routeStartedAt === 'string' ? location.routeStartedAt : null,
    assignedVehicleCount: Number.isInteger(Number(location.assignedVehicleCount))
      ? Number(location.assignedVehicleCount)
      : 0,
    actual: '',
    actualTone: 'muted',
    note: '',
  }
}

export async function listRoutes() {
  const routes: Route[] = []
  let cursor: string | undefined
  do {
    const answer = await serverListarUbicaciones(cursor)
    if (answer.kind !== 'ok') return mine().routes
    routes.push(...(Array.isArray(answer.out.locations) ? answer.out.locations : [])
      .map(routeFromLocation)
      .filter((route): route is Route => route !== null))
    cursor = typeof answer.out.nextCursor === 'string' ? answer.out.nextCursor : undefined
  } while (cursor)
  return routes
}

/** A blank one, numbered past whatever exists right now. */
export async function newRoute() {
  return blankRoute(await listRoutes())
}

/** Creates it if it is still a draft, replaces it by UUID if it already exists. */
export async function saveRoute(by: string | null, route: Route): Promise<Result<Route>> {
  if (!can(whois(by), 'ruta.editar')) return { ok: false, reason: REFUSED }
  const body = {
    name: route.name,
    active: route.active,
    trafficMarginPercent: route.trafficMarginPercent,
    points: route.points.map((point) => ({
      ...(point.id ? { id: point.id } : {}),
      address: point.address,
      reference: point.reference,
      latitude: point.latitude,
      longitude: point.longitude,
    })),
  }
  const persisted = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(route.id)
  const answer = persisted
    ? await serverActualizarUbicacion(route.id, body)
    : await serverCrearUbicacion(body)
  if (answer.kind !== 'ok')
    return { ok: false, reason: answer.kind === 'refused' ? answer.reason : CODE_OFFLINE }
  const saved = routeFromLocation(answer.out.location)
  if (!saved) return { ok: false, reason: 'EL SERVIDOR DEVOLVIÓ UNA LOCATION NO VÁLIDA' }
  write((rows) => {
    const known = rows.routes.some((candidate) => candidate.id === route.id || candidate.code === route.code)
    return {
      routes: known
        ? rows.routes.map((candidate) =>
            candidate.id === route.id || candidate.code === route.code ? saved : candidate)
        : [...rows.routes, saved],
    }
  })
  return { ok: true, value: saved }
}

/**
 * Saca una unidad de la flota de esta compañía.
 *
 * No es borrar el vehículo. La clave de la tabla es la compañía más el VIN, así
 * que otra compañía que tenga esa misma unidad la conserva entera. Lo que
 * desaparece es lo que *esta* compañía hizo con ella — su estado, sus escaneos,
 * su rastro y sus fotografías — y por eso el aviso lo dice con esos nombres
 * antes de hacerlo.
 */
export async function removeVehicle(by: string | null, vin: string): Promise<Result<null>> {
  if (!can(whois(by), 'unidad.remover')) return { ok: false, reason: REFUSED }
  const answer = await serverRemoverUnidad(vin)
  if (answer.kind !== 'ok')
    return { ok: false, reason: answer.kind === 'refused' ? answer.reason : CODE_OFFLINE }
  write((rows) => {
    // Los eventos guardan el id de la unidad, no su VIN: hay que resolverlo
    // antes de tirar la fila, o el historial se queda apuntando a nada.
    const gone = rows.vehicles.filter((unit) => unit.vin === vin).map((unit) => unit.id)
    return {
      vehicles: rows.vehicles.filter((unit) => unit.vin !== vin),
      events: rows.events.filter((event) => !gone.includes(event.vehicleId)),
    }
  })
  return { ok: true, value: null }
}

export async function deleteRoute(by: string | null, code: string): Promise<Result<null>> {
  if (!can(whois(by), 'ruta.editar')) return { ok: false, reason: REFUSED }
  const route = (await listRoutes()).find((candidate) => candidate.code === code)
  if (!route) return { ok: false, reason: 'ESA LOCATION NO EXISTE' }
  const answer = await serverEliminarUbicacion(route.id)
  if (answer.kind !== 'ok')
    return { ok: false, reason: answer.kind === 'refused' ? answer.reason : CODE_OFFLINE }
  write((rows) => ({
    routes: rows.routes.filter((r) => r.code !== code),
    // Nobody works a route that no longer exists.
    memberships: rows.memberships.map((m) =>
      m.routes.includes(code) ? { ...m, routes: m.routes.filter((c) => c !== code) } : m,
    ),
  }))
  return { ok: true, value: null }
}

/** Every vehicle a screen might want, for the pickers. */
export type { Member, Route, Vehicle, VehicleEvent }
