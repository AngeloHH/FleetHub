// The words FleetHub uses, in one place.
//
// These were scattered as literals: the five states lived in 00b, the roles in
// the people list, the event kinds only in the titles the log printed. Naming
// them here is what lets a screen render a state without knowing which states
// exist, and what a database schema will enumerate later.

/** How severely a fact reads. The view layer maps these to colour. */
export type Tone = 'ok' | 'warn' | 'danger' | 'muted'

// ── Lo que le pasa a un vehículo ────────────────────────────────────────────

/**
 * Where a vehicle stands. Exactly the five 00b offers — a vehicle cannot be in
 * a state the operator has no way to put it in.
 */
export const VEHICLE_STATES = [
  { id: 1, name: 'EN RUTA', note: 'EN CAMINO', tone: 'ok' },
  { id: 2, name: 'CON DEPÓSITO', note: 'CON ANTICIPO', tone: 'warn' },
  { id: 3, name: 'EN SERVICIO', note: 'TALLER', tone: 'warn' },
  { id: 0, name: 'NO ENCONTRADO', note: 'SIN LOCALIZAR', tone: 'danger' },
  { id: 4, name: 'VENDIDO', note: 'CIERRA EL EXPEDIENTE', tone: 'muted' },
] as const satisfies readonly { id: number; name: string; note: string; tone: Tone }[]

export type VehicleState = (typeof VEHICLE_STATES)[number]['name']
export type VehicleStateId = (typeof VEHICLE_STATES)[number]['id']

export function stateTone(name: string): Tone {
  return VEHICLE_STATES.find((s) => s.name === name)?.tone ?? 'muted'
}

/**
 * The three things an operator records. They are 03's own filter segments,
 * which is the app telling us its own vocabulary.
 */
export type EventKind = 'estado' | 'ruta' | 'adjuntos'

// ── Lo que puede una persona ────────────────────────────────────────────────

/**
 * What spending a key does.
 *
 *  · alta    — makes somebody a member, with the role the key names.
 *  · soporte — opens a window for FleetHub to come in and look. It makes
 *              nobody a member of anything: what it leaves behind is a grant
 *              with an end already on it.
 */
export type CodeKind = 'alta' | 'soporte'

/** How long the window a support key opens stays open, once it is spent. */
export const SUPPORT_HOURS = 8

/** What the company grants an account, and what it means. Named by 07b. */
export const ROLES: { name: string; description: string }[] = [
  { name: 'OPERADOR', description: 'Todos los permisos en campo' },
  { name: 'ADMINISTRADOR', description: 'Permisos de toda la compañía' },
  { name: 'VISITANTE', description: 'Solo lectura, no puede modificar' },
]

/**
 * What 07b can issue a key for: the three roles, and the one thing a key can
 * do that is not a role at all — let FleetHub in for a few hours.
 */
export const SUPPORT_USE = {
  name: 'SOPORTE FLEETHUB',
  description: `Acceso temporal de ${SUPPORT_HOURS} h · no crea usuario`,
}
export const KEY_USES = [...ROLES, SUPPORT_USE]

/**
 * The chip 05 shows. Derived rather than stored: it restates the real role,
 * except while the account is suspended or using a temporary support window.
 */
export function permissionOf(
  role: string,
  suspension?: 'self' | 'admin',
  support?: boolean,
): { label: string; tone: Tone } {
  if (suspension) return { label: 'SUSPENDIDO', tone: 'danger' }
  // Ahead of the role on purpose: while the window is open it is what the
  // account is doing here, and it is the thing that ends.
  if (support) return { label: 'SOPORTE FLEETHUB', tone: 'warn' }
  if (role === 'ADMINISTRADOR') return { label: 'ADMINISTRADOR', tone: 'ok' }
  if (role === 'VISITANTE') return { label: 'VISITANTE', tone: 'muted' }
  return { label: 'OPERADOR', tone: 'ok' }
}

// ── Lo que cada quien puede hacer ───────────────────────────────────────────

/**
 * Something a person can attempt. Named after what it is in the world and not
 * after the screen that offers it: the same thing is reachable from a button,
 * from a typed address and, one day, from an API call, and all three have to
 * be answered the same way.
 */
export type Action =
  /** Read the map, the fleet, the alerts — the operator's own screens. */
  | 'ver'
  /** Scan a VIN and enter a unit. */
  | 'escanear'
  /** Change a unit's state, route or note. */
  | 'unidad.modificar'
  /**
   * Take a unit out of this company's fleet.
   *
   * Separate from `unidad.modificar` because an operator has that one: changing
   * a unit's state is the day's work, and this takes its whole history with it.
   */
  | 'unidad.remover'
  /** Reach the administration console at all. */
  | 'consola'
  | 'ruta.editar'
  | 'usuario.editar'
  | 'usuario.suspender'

/** What each role is allowed. Everything not listed is refused. */
const GRANTS: Record<string, Action[]> = {
  ADMINISTRADOR: [
    'ver',
    'escanear',
    'unidad.modificar',
    'unidad.remover',
    'consola',
    'ruta.editar',
    'usuario.editar',
    'usuario.suspender',
  ],
  OPERADOR: ['ver', 'escanear', 'unidad.modificar'],
  VISITANTE: ['ver'],
}

/**
 * Whether this person may do that.
 *
 * A hold answers no to everything: what a suspended account may still do —
 * read its own profile, lift its own hold — belongs to nobody's role, it is
 * true of the account itself, and the address guard is what says so.
 */
export function can(
  who: { role: string; suspension?: 'self' | 'admin'; support?: boolean } | null,
  action: Action,
) {
  if (!who || who.suspension) return false
  // Support is an axis and not a rank: it does not raise the role, it answers
  // instead of it while the window is open. So the company's own word about
  // this account — visitor, operator — is what it goes back to when it closes.
  if (who.support) return GRANTS.ADMINISTRADOR.includes(action)
  return (GRANTS[who.role] ?? []).includes(action)
}
