// What the screens ask the domain for.
//
// The entities are normalised — a user, a membership, a vehicle, an event —
// and no screen wants to join those by hand. So the joins live here, and what
// comes out is the shape a screen renders: a member with their permission
// already worked out, a log row with its sentence already written.
//
// Nothing here has any colour in it. Tone is a word ("warn"); which orange
// that is belongs to the view.

import type {
  Company,
  InviteCode,
  Membership,
  Photo,
  Route,
  SupportGrant,
  User,
  Vehicle,
  VehicleEvent,
} from './types'
import { dayLabel, isToday } from './clock'
import { grantIsLive } from './codes'
import { operatorCode } from './identity'
import { permissionOf, stateTone, VEHICLE_STATES, type Tone } from './vocabulary'

export * from './types'
export { matches, newSalt, ROUNDS, seal } from './secret'
export * from './clock'
export * from './alerts'
export * from './vin'
export * from './identity'
export * from './route-position'
export * from './codes'
export * from './vocabulary'

// Sin datos de demostración. Estas colecciones permanecen vacías hasta que
// las pantallas terminen de consumir los recursos reales de la API.
export const COMPANIES: Company[] = []
export const COMPANY: Company | null = null
export const EVENTS: VehicleEvent[] = []
export const INVITE_CODES: InviteCode[] = []
export const MEMBERSHIPS: Membership[] = []
export const PHOTOS: Photo[] = []
export const ROUTES: Route[] = []
export const SUPPORT_GRANTS: SupportGrant[] = []
export const USERS: User[] = []
export const VEHICLES: Vehicle[] = []

// ── Personas ────────────────────────────────────────────────────────────────

/**
 * A user seen through one membership — which is what every screen that says
 * "person" actually means. Keyed by the operator id, because that is what the
 * app writes on badges and what an event points at.
 */
export type Member = {
  /** UUID real del usuario. */
  id: string
  membershipId: string
  /** The account behind the badge. What follows a person between companies. */
  userId: string
  /** "R. Salgado", the way the user list writes it. */
  listName: string
  /** "Ricardo Salgado", the way the profile header writes it. */
  name: string
  fullName: string
  email: string
  phone: string
  country: string
  passwordChangedAt?: string
  role: string
  zone: string
  routes: string[]
  lastSeen: string
  suspension?: 'self' | 'admin'
  /** FleetHub's own account, rather than one of the company's people. */
  staff: boolean
  /** Whether a support window is open right now, and when it closes. */
  support: boolean
  supportUntil?: string
  /** The chip on 05, worked out from the role, the hold and the window. */
  permission: string
  permissionTone: Tone
  scansToday: string
  unitsInCharge: string
  unsynced: string
  unsyncedAt: string
  scanHistory: string
}

/**
 * "Ricardo Salgado Ibarra" is one name, one surname and the mother's — which
 * the app shortens two ways and never stores twice.
 */
function shorten(fullName: string) {
  const [first, surname = ''] = fullName.split(' ')
  return { name: [first, surname].filter(Boolean).join(' '), listName: `${first[0]}. ${surname}` }
}

/**
 * Whoever scanned a unit before anyone else has it a su cargo. Not an
 * assignment somebody typed — the first person to stand in front of a unit is
 * the one the company has to ask about it, and the log already says who that
 * was. Units only the system ever touched are nobody's.
 */
export function inChargeOf(events: VehicleEvent[]) {
  const first: Record<string, VehicleEvent> = {}
  for (const e of events) {
    if (!e.membershipId) continue
    const held = first[e.vehicleId]
    if (!held || e.at < held.at) first[e.vehicleId] = e
  }
  return Object.values(first)
}

/**
 * What a person has done, counted from the log rather than stored beside them.
 *
 * A stored count is a second copy of something the events already say, and two
 * copies of a number are two chances to disagree. What is left stored on a
 * membership is what the log cannot answer: what has not been uploaded yet.
 */
export function tally(events: VehicleEvent[], membershipId: string) {
  const mine = events.filter((e) => e.membershipId === membershipId)
  return {
    scansToday: String(mine.filter((e) => isToday(e.at)).length),
    scanHistory: `${mine.length} REGISTROS`,
    unitsInCharge: String(inChargeOf(events).filter((e) => e.membershipId === membershipId).length),
  }
}

/** A user and one of their memberships, seen as the screens want them. */
export function joinMember(
  user: User,
  membership: Membership,
  events: VehicleEvent[] = EVENTS,
  grants: SupportGrant[] = SUPPORT_GRANTS,
): Member {
  const { name, listName } = shorten(user.fullName)
  const open = grants.find(
    (g) => g.userId === user.id && g.companyId === membership.companyId && grantIsLive(g),
  )
  const permission = permissionOf(membership.role, membership.suspension, Boolean(open))
  return {
    id: membership.operatorId,
    membershipId: membership.id,
    userId: user.id,
    listName,
    name,
    fullName: user.fullName,
    email: user.email,
    phone: user.phone,
    country: user.country,
    passwordChangedAt: user.passwordChangedAt ?? user.createdAt,
    role: membership.role,
    zone: membership.zone,
    routes: membership.routes,
    lastSeen: membership.lastSeen,
    suspension: membership.suspension,
    staff: Boolean(user.staff),
    support: Boolean(open),
    supportUntil: open?.expiresAt,
    permission: permission.label,
    permissionTone: permission.tone,
    ...membership.counters,
    ...tally(events, membership.id),
  }
}

// ── Cómo está la flota ──────────────────────────────────────────────────────

/**
 * The fleet grouped by where each unit stands, which is its newest state
 * event. Units nobody has reported on are not in any group — the donut's grey
 * ring is what is left of the circle, and that is them.
 *
 * Ordered by the vocabulary, with anything else after it: a unit whose last
 * recorded state uses a word the company has since renamed is still in that
 * state, and saying so beats quietly filing it somewhere it is not.
 */
export function groupByState(vehicles: Vehicle[], states: Record<string, string>) {
  const counted = new Map<string, number>()
  for (const v of vehicles) {
    const state = states[v.id]
    if (state) counted.set(state, (counted.get(state) ?? 0) + 1)
  }
  const known = VEHICLE_STATES.map((s) => s.name as string)
  return [...counted.entries()]
    .sort((a, b) => {
      const ia = known.indexOf(a[0])
      const ib = known.indexOf(b[0])
      return (ia < 0 ? known.length : ia) - (ib < 0 ? known.length : ib)
    })
    .map(([name, count]) => ({ name, count, tone: stateTone(name) }))
}

/** Who recorded the most today, most first. What 06's little ranking is. */
export function topByToday(members: Member[], limit = 3) {
  return members
    .map((m) => ({ id: operatorCode(m.userId), name: m.listName, count: Number(m.scansToday) || 0 }))
    .filter((m) => m.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
}

/** Everyone in the company, in the order 07 lists them. */
export const MEMBERS: Member[] = MEMBERSHIPS.map((m) => {
  const user = USERS.find((u) => u.id === m.userId)
  if (!user) throw new Error(`membership ${m.id} points at no user`)
  return joinMember(user, m, EVENTS, SUPPORT_GRANTS)
})

export function memberById(operatorId: string | null) {
  return MEMBERS.find((m) => m.id === operatorId) ?? null
}

/** The list row's second line: id, zone and when they were last seen. */
export function describeMember(member: Member) {
  return [operatorCode(member.userId), member.zone, member.lastSeen].filter(Boolean).join(' · ')
}

// ── Vehículos ───────────────────────────────────────────────────────────────

export function vehicleById(id: string | null) {
  return VEHICLES.find((v) => v.id === id) ?? null
}

/** Only the ones reporting a position can be drawn on the map. */
export const PLOTTED: Vehicle[] = VEHICLES.filter((v) => v.coords)

/** Where a vehicle stands: whatever its newest state event says. */
export function stateOf(vehicleId: string, events: VehicleEvent[] = EVENTS): string | null {
  return newestFirst(events).find((e) => e.vehicleId === vehicleId && e.kind === 'estado')?.state ?? null
}

// ── El registro ─────────────────────────────────────────────────────────────

/**
 * The headline the log prints. Derived, so that renaming a state or adding a
 * kind does not mean editing a hundred strings.
 */
export function eventTitle(event: VehicleEvent) {
  if (event.kind === 'estado') return `${event.vehicleId} · estado → ${event.state}`
  if (event.kind === 'ruta') return `${event.vehicleId} · ruta → ${event.route}`
  const n = event.photos.length
  if (n && event.note) return `${event.vehicleId} · ${n} fotos y nota`
  if (n) return `${event.vehicleId} · ${n} ${n === 1 ? 'foto' : 'fotos'}`
  return `${event.vehicleId} · nota`
}

/** The line under it: the immutable operator code and what they wrote. */
export function eventDetail(event: VehicleEvent) {
  // `membershipId` is only the fallback for events written by the immediately
  // previous development build, before userId became part of the row.
  const author = event.userId ?? event.membershipId
  const who = author ? operatorCode(author) : 'SISTEMA'
  return [who, event.note].filter(Boolean).join(' · ')
}

/**
 * The log in the order it is read: newest first. The store keeps its own table
 * that way, but nothing here can assume that of a list handed to it.
 */
export function newestFirst(events: VehicleEvent[]) {
  return [...events].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
}

/** The days the log groups by, newest first. */
export function eventDays(events: VehicleEvent[] = EVENTS) {
  return [...new Set(newestFirst(events).map((e) => dayLabel(e.at)))]
}

/** One row per vehicle: the newest thing that happened to it. */
export function latestPerVehicle(events: VehicleEvent[] = EVENTS) {
  const seen = new Set<string>()
  return newestFirst(events).filter((e) => !seen.has(e.vehicleId) && seen.add(e.vehicleId))
}

/** The photographs of one event, in the order they were taken. */
export function photosOf(event: VehicleEvent): Photo[] {
  return event.photos.map((id) => PHOTOS.find((p) => p.id === id)!).filter(Boolean)
}

// ── Rutas ───────────────────────────────────────────────────────────────────

/**
 * The record 06c opens on "+ NUEVO". A route that does not exist yet has no
 * name and nothing measured — the em dashes are what the editor
 * shows until there is a backend to work them out from the two points.
 *
 * The code is the next free one among the routes that exist right now, so the
 * caller passes the list it actually received.
 */
export function blankRoute(existing: Route[] = ROUTES): Route {
  const next = Math.max(0, ...existing.map((r) => Number(r.code.slice(2)))) + 1
  const code = `R-${String(next).padStart(2, '0')}`
  return {
    id: `RT-${String(next).padStart(2, '0')}`,
    companyId: COMPANY?.id ?? '',
    code,
    name: '',
    // Empty on purpose: a route is wherever it goes, and nobody has said yet.
    // Until it has a point there is nothing to save, and 06c says so.
    points: [],
    created: 'HOY',
    active: true,
    trafficMarginPercent: 15,
    distanceMeters: null,
    durationSeconds: null,
    geometry: [],
    routeStartedAt: null,
    assignedVehicleCount: 0,
    actual: '',
    actualTone: 'muted',
    note: '',
  }
}
