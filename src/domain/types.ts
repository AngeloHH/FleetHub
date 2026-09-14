// The entities FleetHub is about.
//
// Two decisions are written into these shapes, both taken before there was a
// database to make them expensive:
//
//  · The account is separate from the company. A person signs in once and can
//    belong to more than one — a driver moving cars for two dealerships, an
//    outside auditor. What they are *in a company* is the membership.
//
//  · A vehicle is never edited, only added to. Every change is an event with
//    the time it happened, so two operators recording the same car with no
//    signal produce two true facts to be ordered, not a conflict to resolve.
//
// Everything an operator can write offline carries the four marks that make
// that possible: an id minted on the device, when it happened by the device's
// clock, when the server received it, and how far the upload got.

import type { CodeKind, EventKind, Tone } from './vocabulary'

// ── Quién ───────────────────────────────────────────────────────────────────

/** The tenant. Every row below belongs to exactly one. */
export type Company = {
  id: string
  createdAt: string
}

/**
 * A key to join a company: what screen 07b issues and screen B redeems.
 *
 * It is a row and not a constant because everything interesting about it is
 * a fact with a date on it — when it was issued, by whom, when it stops
 * working, and who spent it. A company being audited will want to read
 * exactly that.
 */
export type InviteCode = {
  /** Six hex digits, as the design draws them. */
  code: string
  companyId: string
  /**
   * What spending it does. A key of alta makes somebody a member; one of
   * soporte opens a window for FleetHub to come in and look, and makes them
   * nothing at all — see SupportGrant.
   */
  kind: CodeKind
  /** What the person who redeems it becomes. Empty on a support key. */
  role: string
  /** The badge that issued it. Null for the ones the company started with. */
  issuedBy: string | null
  issuedAt: string
  /** When it stops working, whether or not anyone used it. */
  expiresAt: string
  /** The badge that redeemed it. Set once, because it is a single use. */
  usedBy?: string
  usedAt?: string
  /** Withdrawn before anyone got to it. */
  revokedAt?: string
}

/** The account, which is the person's and not the company's. */
export type User = {
  id: string
  /** Compañía a la que pertenece la cuenta. */
  companyId?: string
  fullName: string
  email: string
  phone: string
  /**
   * FleetHub's own people. Not a rank and not a role: an account either
   * belongs to the company using the app or to the company that makes it, and
   * that is true wherever it goes. It is what lets an account ask for support
   * access; on its own it grants nothing at all.
   */
  staff?: true
  /** ISO code of the country the phone belongs to — MX and US are both ten
   *  digits, so without it a Mexican number groups as an American one. */
  country: string
  /** Prefijo telefónico E.164 que la API valida junto al número nacional. */
  phoneCode?: string
  /** Preferencia de idioma compartida con la API. */
  language?: string
  /** Rol directo: ya no existe una membresía separada. */
  role?: string
  /** Suspensión aplicada a la cuenta. */
  suspension?: 'self' | 'admin'
  createdAt?: string
  updatedAt?: string
  /** Se modifica únicamente cuando cambia la contraseña. */
  passwordChangedAt?: string
  /** Derivación autocontenida en formato PHC; nunca la contraseña tecleada. */
  password?: string
  /** Nivel numérico expuesto por el contrato nuevo; el rol efectivo sigue en la membresía. */
  tier?: number
  /** Marca de actividad de la cuenta; la membresía conserva la presentación para la empresa. */
  lastSeen?: string
}

/**
 * Time-boxed access a FleetHub account has to one company.
 *
 * Deliberately not a role and not a membership. Support is not staff of the
 * company and never becomes it — what they have is a window, granted by a key
 * the company handed out, with the end already written on it. Nobody has to
 * remember to take it away.
 */
export type SupportGrant = {
  id: string
  userId: string
  companyId: string
  /** The key that was spent for it. */
  code: string
  grantedAt: string
  expiresAt: string
  /** Closed early, by either side. */
  endedAt?: string
}

/**
 * Una alerta dada por atendida. La alerta misma no se guarda — es una regla
 * sobre telemetría (domain/alerts) —, pero descartarla es un hecho: alguien
 * la vio, a una hora, y RESUELTAS HOY es la lista de esos hechos.
 */
export type AlertDismissal = {
  id: string
  companyId: string
  /** La condición descartada, por su id estable (unidad·tipo). */
  alertId: string
  /** Lo que la tarjeta decía, para repetirlo tal cual en RESUELTAS. */
  title: string
  at: string
  membershipId: string | null
}

/** What a user is inside one company. */
export type Membership = {
  id: string
  userId: string
  companyId: string
  /** UUID real del usuario; OP-xxxx se deriva solamente al mostrarlo. */
  operatorId: string
  /** One of ROLES. */
  role: string
  /** Empty until administration assigns one. */
  zone: string
  /** Codes of the routes they work. */
  routes: string[]
  /**
   * Who put the account on hold. Suspending yourself is reversible by you; an
   * administrator's is not, and that account cannot sign in at all.
   */
  suspension?: 'self' | 'admin'
  /**
   * What 05 shows that the log cannot answer. Everything the events do say —
   * how many scans today, how many units are theirs, how long the history is —
   * is counted from them instead; see domain/index.
   */
  counters: {
    /** Scans taken but not yet uploaded, and when they were taken. */
    unsynced: string
    unsyncedAt: string
  }
  /** Free text 07 shows: "ACTIVO AHORA", "HACE 6 MIN". */
  lastSeen: string
}

// ── Qué ─────────────────────────────────────────────────────────────────────

export type Vehicle = {
  id: string
  companyId: string
  vin: string
  /** Momento en que el servidor aceptó por primera vez este VIN. */
  createdAt?: string
  /** Última modificación conocida de la ficha en el servidor. */
  updatedAt?: string
  /** Sólo el creador o un administrador puede resolverla; nunca se dibuja. */
  pendingLocation?: boolean
  /** Estado operativo del servidor; null es la ausencia de una condición. */
  state?: string | null
  /** Datos de una ruta asignada; la posición GPS real permanece separada. */
  routeTracking?: {
    locationId: string
    routeStartedAt: string | null
    etaSeconds: number | null
    geometry: [number, number][]
  } | null
  /** Make and model, shown uppercased. */
  model: string
  /** Body, year and colour — the line under the model. */
  spec: string
  /** Absent for the units without a live GPS fix, which the map cannot plot. */
  coords?: [number, number]
  /** Last known whereabouts in words. */
  position: string
  /** Momento y precisión de la última posición confirmada por el servidor. */
  positionAt?: string
  positionAccuracy?: number | null
  /**
   * El grupo al que la unidad pertenece — la zona de la empresa. Opcional
   * porque una unidad puede no estar asignada a ninguno, y entonces la ficha
   * dice SIN GRUPO en vez de inventarse uno.
   */
  zone?: string
  /** Minutes since the last fix; absent along with the coordinates. */
  signalMin?: number
  speedKmh?: number
  fuelPct?: number
}

/**
 * Something that happened to a vehicle. Never updated, never overwritten — the
 * vehicle's current state is whatever its newest event says.
 */
export type VehicleEvent = {
  id: string
  companyId: string
  vehicleId: string
  /** UUID del usuario que lo hizo. Se conserva aunque después se elimine. */
  userId: string | null
  /** Su vínculo con la empresa en ese momento; null para eventos automáticos. */
  membershipId: string | null
  kind: EventKind
  /**
   * The instant the device recorded, ISO. The one thing stored about when:
   * the day the log groups under, the clock it prints and how long ago it was
   * are all that instant read against whoever is looking — see domain/clock.
   */
  at: string
  /** Set when kind is "estado". */
  state?: string
  /** Route code, set when kind is "ruta". */
  route?: string
  /** What the operator wrote, or what the system had to say. */
  note: string
  /**
   * How the log should read this. A judgement about the event rather than
   * something its kind implies — a photo of a scratch and a photo of a wrecked
   * bumper are the same kind and not the same news. Absent on the days already
   * closed, which the log draws dimmed.
   */
  tone?: Tone
  /** Ids of the photos attached; they may still be on the phone. */
  photos: string[]
}

/**
 * A photograph attached to an event. It hangs off the event and not off the
 * VIN so that it is still known which inspection it came from — "every photo
 * of this vehicle" remains one query through its events.
 */
export type Photo = {
  id: string
  companyId: string
  eventId: string
  /** How far it got. Taken offline, it waits on the phone until there is signal. */
  upload: 'en el teléfono' | 'subiendo' | 'subida'
}

// ── Dónde ───────────────────────────────────────────────────────────────────

/** A point of a route: its canonical address, coordinates and driver note. */
export type RoutePoint = {
  /** Present after the server has persisted the point. */
  id?: string
  address: string
  reference: string
  latitude: number
  longitude: number
}

export type Route = {
  id: string
  companyId: string
  /** Código visual antiguo; las locations reales se identifican por UUID. */
  code: string
  name: string
  /** Where it leaves from and arrives, in order. One point means a garage. */
  points: RoutePoint[]
  created: string
  /** Nothing is scheduled on an inactive route. */
  active: boolean
  trafficMarginPercent: number
  distanceMeters: number | null
  durationSeconds: number | null
  geometry: [number, number][]
  routeStartedAt: string | null
  assignedVehicleCount: number
  actual: string
  actualTone: 'ok' | 'warn' | 'muted'
  note: string
  noteTone?: 'warn'
}
