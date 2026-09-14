// Where the rows actually live while the app is running.
//
// One object, mutated only through src/data, and a list of listeners so that
// anything reading it hears about a change. It starts empty: only the API may
// provide real business rows.
//
// It survives a reload now. The rows go to localStorage and the session to
// sessionStorage — deliberately not the same shelf: the rows are what the
// company knows and outlive any one visit, while a session belongs to the tab
// somebody is working in and has no business being handed to the next one.
//
// It is still not the offline queue. A queue has to remember what has been
// told to the server and what has not, and nothing here has a server to tell.
// What this fixes is narrower and was its own bug: a reload threw away
// everything anyone had done.

import {
  newestFirst,
  type AlertDismissal,
  type Company,
  type Membership,
  type Photo,
  type Route,
  type SupportGrant,
  type User,
  type Vehicle,
  type VehicleEvent,
} from '../domain'

export type Rows = {
  companies: Company[]
  users: User[]
  memberships: Membership[]
  vehicles: Vehicle[]
  events: VehicleEvent[]
  routes: Route[]
  photos: Photo[]
  grants: SupportGrant[]
  /** Alertas dadas por atendidas — ver AlertDismissal. */
  dismissals: AlertDismissal[]
  /**
   * La compañía dentro de la que trabaja esta sesión, según el servidor.
   *
   * Casi siempre es la de la cuenta. Durante un acceso de soporte no lo es —
   * la cuenta es de FleetHub y lo que ve es de la empresa que abrió la
   * ventana —, y por eso se guarda lo que contesta el servidor en lugar de
   * deducirlo de la fila del usuario, que diría la otra.
   */
  companyId: string | null
  /**
   * Whose session this is: the badge of whoever signed in, or null. It lives
   * with the rows and not beside them because everything read from here is
   * read *as* somebody — what a company can see is not the same question as
   * what is stored.
   */
  session: string | null
}

/** Un almacén nuevo no inventa ninguna fila. */
function emptyRows(): Rows {
  return {
    companies: [], users: [], memberships: [], vehicles: [],
    events: [], routes: [], photos: [], grants: [], dismissals: [],
    companyId: null, session: null,
  }
}

/**
 * What the stored rows were written by.
 *
 * Bumped whenever the stored shape changes. Rows written by an older build can
 * be missing a table an newer one reads, and the failure that causes is a blank
 * screen somewhere far from here — cheaper to notice the stamp and start clean.
 */
// 13: rutas con geometría vial e inicio temporal para posiciones estimadas.
// 14: la compañía de la sesión la dice el servidor, no la fila del usuario.
const VERSION = 14
const ROWS_KEY = 'fleethub.rows'
const SESSION_KEY = 'fleethub.session'

/** Storage can be absent or refuse to write — private windows, a full disk, a
 *  browser with it turned off. None of that is worth failing over: what is
 *  lost is the surviving, not the running. */
function shelf(kind: 'local' | 'session'): Storage | null {
  try {
    const store = kind === 'local' ? localStorage : sessionStorage
    store.getItem(ROWS_KEY)
    return store
  } catch {
    return null
  }
}

const disk = shelf('local')
const tab = shelf('session')

/** How long a session is good for: a shift. Long enough that nobody is asked
 *  again mid-round, short enough that a phone left on a seat stops being one. */
const SESSION_HOURS = 12

function stored(): Rows {
  const fresh = emptyRows()
  try {
    const raw = disk?.getItem(ROWS_KEY)
    const held = raw ? (JSON.parse(raw) as { version: number; rows: Rows }) : null
    // Every table has to be there. A stamp that matches but a shape that does
    // not is the case this is really guarding against.
    if (!held || held.version !== VERSION) return fresh
    const rows = { ...fresh, ...held.rows, session: null }
    // La versión anterior firmaba los eventos sólo con la membresía. Se
    // completa el UUID del usuario al leerlos para que los registros ya
    // existentes también muestren su OP-xxxx sin borrar el trabajo local.
    rows.events = rows.events.map((event) => {
      if (event.userId !== undefined) return event
      const member = rows.memberships.find((row) => row.id === event.membershipId)
      return { ...event, userId: member?.userId ?? event.membershipId ?? null }
    })
    return Object.keys(fresh).every((k) => k in rows) ? rows : fresh
  } catch {
    return fresh
  }
}

/** Whoever this tab had signed in, and until when — or nobody. */
function heldSession(): { who: string; until: string } | null {
  try {
    const raw = tab?.getItem(SESSION_KEY)
    if (!raw) return null
    const held = JSON.parse(raw) as { who: string; until: string }
    return held.until > new Date().toISOString() ? held : null
  } catch {
    return null
  }
}

const listeners = new Set<() => void>()

/**
 * When the session runs out — kept here so that running out is something the
 * tab notices, not just something a reload would discover. Null is signed out.
 */
let deadline: string | null = null

const opening = heldSession()
deadline = opening?.until ?? null
let rows = { ...stored(), session: opening?.who ?? null }

/**
 * Signs out on the spot if the deadline has passed.
 *
 * Checked when the deadline's own timer fires, and again whenever the tab
 * comes back into view — a phone in a pocket throttles timers, and twelve
 * hours later "the clock got around to it" must not mean still signed in.
 */
function expireIfDue() {
  if (!rows.session || !deadline || deadline > new Date().toISOString()) return
  deadline = null
  rows = { ...rows, session: null }
  try {
    tab?.removeItem(SESSION_KEY)
  } catch {
    // Nothing to remove if there was nowhere to write.
  }
  for (const listener of listeners) listener()
}

let expiry: ReturnType<typeof setTimeout> | undefined

/** Arms the timer that ends the session when its deadline arrives. */
function watchDeadline() {
  clearTimeout(expiry)
  if (!deadline) return
  const left = new Date(deadline).getTime() - Date.now()
  expiry = setTimeout(expireIfDue, Math.max(0, left))
}

if (typeof window !== 'undefined') {
  watchDeadline()
  // Waking up is the moment a throttled timer would have lied the longest.
  window.addEventListener('focus', expireIfDue)
  document.addEventListener('visibilitychange', expireIfDue)
  // Another tab wrote the rows. Its localStorage write is this event; what it
  // cannot touch is this tab's session, which stays as it is. Without this,
  // two tabs each worked on their own copy and the last to write won.
  window.addEventListener('storage', (e) => {
    if (e.key !== ROWS_KEY) return
    rows = { ...stored(), session: rows.session }
    for (const listener of listeners) listener()
  })
}

function keep() {
  try {
    // The session is left out on purpose: it goes on the other shelf, and
    // writing it here would hand it to every tab.
    const { session: _, ...saved } = rows
    disk?.setItem(ROWS_KEY, JSON.stringify({ version: VERSION, rows: saved }))
  } catch {
    // A full or refused disk costs the surviving, not the running.
  }
}

const OFFLINE_KEY = 'fleethub.offline'

// El modo sin conexión queda deliberadamente apagado hasta que exista una
// cola real de sincronización. También se limpia una selección de builds
// anteriores para que ningún aparato quede bloqueado sin poder volver online.
try {
  disk?.removeItem(OFFLINE_KEY)
} catch {
  // Sin balda ya está, de hecho, apagado.
}

export function offlineMode() {
  return false
}

export function setOfflineMode(_next: boolean) {
  try {
    disk?.removeItem(OFFLINE_KEY)
  } catch {
    // No hay nada que limpiar.
  }
}

const TOKEN_KEY = 'fleethub.token'

/** Espejo en memoria de la balda: la verdad inmediata, la balda el recuerdo. */
let token: string | null = (() => {
  try {
    return tab?.getItem(TOKEN_KEY) ?? null
  } catch {
    return null
  }
})()

/** El token del servidor, en la balda de la pestaña: es de esta sesión. */
export function keepToken(next: string | null) {
  token = next
  try {
    if (!next) tab?.removeItem(TOKEN_KEY)
    else tab?.setItem(TOKEN_KEY, next)
  } catch {
    // Sin balda, el token vive lo que viva la página.
  }
}

export function heldToken(): string | null {
  return token
}

/** Remembers who this tab is, and until when. */
export function keepSession(who: string | null) {
  deadline = who ? new Date(Date.now() + SESSION_HOURS * 3600_000).toISOString() : null
  watchDeadline()
  try {
    if (!who) tab?.removeItem(SESSION_KEY)
    else tab?.setItem(SESSION_KEY, JSON.stringify({ who, until: deadline }))
  } catch {
    // Same trade as above.
  }
}

/** Read the rows. Callers must not mutate what they get back. */
export function read(): Rows {
  return rows
}

/**
 * Change the rows and tell everyone. The updater returns only the tables it
 * touched, so a write says what it changed and nothing else.
 *
 * The log comes back newest first however it went in. Everything that reads it
 * leans on that order — where a unit stands is its newest state, the row 03
 * shows for a day is the newest of that day — and an event does not turn up in
 * the order it happened: one taken with no signal arrives whenever the phone
 * next finds a network. So the order is the table's rule, not the caller's.
 */
export function write(change: (rows: Rows) => Partial<Rows>) {
  const touched = change(rows)
  if (touched.events) touched.events = newestFirst(touched.events)
  rows = { ...rows, ...touched }
  keep()
  for (const listener of listeners) listener()
}

export function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Back to the factory setting. For tests, and for signing out one day. */
export function reset() {
  rows = emptyRows()
  try {
    disk?.removeItem(ROWS_KEY)
    tab?.removeItem(SESSION_KEY)
  } catch {
    // Nothing to undo if there was nowhere to write.
  }
  for (const listener of listeners) listener()
}
