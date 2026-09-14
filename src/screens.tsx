// Every place you can be, and what is true of it.
//
// One table, read by two things: the running app, which draws the screen at
// the current address, and the gallery, which draws them all side by side.
// Before this, "which bar does 03 have" was answered twice and differently
// depending on who was asking.
//
// What lives here is what a *place* knows about itself — its caption, whether
// it carries a tab bar, and where its back chevron goes. What it does with the
// session belongs to App.

import type { Action } from './domain'

/** The tab bar a place carries, if any. */
export type Bar = 'operator' | 'admin'

export type Place = {
  /** Pattern for the address, `:name` capturing a segment. */
  path: string
  /**
   * What a person must be allowed before this place will draw. Absent means
   * anyone signed in may be here — their own profile, the operator's screens.
   */
  needs?: Action
  /** The design's own number for it. */
  code: string
  title: string
  bar?: Bar
  /**
   * Where the chevron in the strip goes. A function when it depends on what
   * the address captured. Absent means the screen draws no chevron.
   */
  back?: string | ((params: Record<string, string>) => string)
}

/**
 * Order matters: the first fit wins, so a fixed segment has to come before the
 * pattern that would swallow it — /admin/users/new before /:id.
 */
export const PLACES: Place[] = [
  { path: '/login', code: 'A', title: 'INICIO DE SESIÓN' },
  { path: '/register', code: 'B', title: 'REGISTRO' },
  { path: '/verify-code', code: 'C', title: 'CONFIRMAR CÓDIGO' },
  { path: '/password', code: 'D', title: 'CREAR CONTRASEÑA' },

  { path: '/map', code: '00', title: 'DASHBOARD', bar: 'operator' },
  // The same screen with a unit picked out. An address of its own so that
  // arriving from an alert, reloading, or sharing all land on the same thing.
  { path: '/map/:id', code: '00', title: 'DASHBOARD', bar: 'operator' },
  { path: '/vehicles/:id', code: '00b', title: 'MODIFICAR UNIDAD', needs: 'unidad.modificar' },
  {
    path: '/vehicles/:id/details', code: '00c', title: 'INFORMACIÓN DEL VEHÍCULO',
    back: (p) => `/vehicles/${p.id}`, needs: 'unidad.modificar',
  },

  { path: '/scan', code: '01', title: 'ESCANEO VIN', needs: 'escanear' },
  { path: '/scan/manual', code: '01b', title: 'CAPTURA MANUAL', needs: 'escanear' },
  { path: '/scan/vin', code: '02', title: 'CONFIRMACIÓN', needs: 'escanear' },

  { path: '/reports', code: '03', title: 'HISTORIAL', bar: 'operator' },
  { path: '/alerts', code: '04', title: 'ALERTAS', bar: 'operator' },

  { path: '/profile', code: '05', title: 'PERFIL', bar: 'operator' },
  { path: '/profile/personal-data', code: '05b', title: 'DATOS PERSONALES', back: '/profile' },
  { path: '/profile/locations', code: '06b', title: 'ZONA ASIGNADA', bar: 'operator', back: '/profile' },
  { path: '/profile/history', code: '03', title: 'HISTORIAL', bar: 'operator', back: '/profile' },
  { path: '/profile/support', code: '05c', title: 'ACCESO DE SOPORTE', back: '/profile' },

  { path: '/admin', code: '06', title: 'ADMINISTRACIÓN', bar: 'admin', back: '/profile', needs: 'consola' },
  {
    path: '/admin/locations',
    code: '06b',
    title: 'ADMIN · RUTAS',
    bar: 'admin',
    back: '/profile',
    needs: 'consola',
  },
  { path: '/admin/locations/:code', code: '06c', title: 'ADMIN · EDITAR RUTA', needs: 'ruta.editar' },
  {
    path: '/admin/reports',
    code: '03',
    title: 'HISTORIAL',
    bar: 'admin',
    back: '/profile',
    needs: 'consola',
  },
  {
    path: '/admin/reports/vehicles/:id',
    code: '00',
    title: 'ADMIN · UNIDAD',
    bar: 'admin',
    back: '/admin/reports',
    needs: 'consola',
  },
  {
    path: '/admin/users',
    code: '07',
    title: 'ADMIN · USUARIOS',
    bar: 'admin',
    back: '/profile',
    needs: 'consola',
  },
  {
    path: '/admin/users/new',
    code: '07b',
    title: 'ADMIN · CÓDIGO DE ALTA',
    needs: 'usuario.editar',
  },
  {
    path: '/admin/users/:id',
    code: '05',
    title: 'ADMIN · PERFIL',
    bar: 'admin',
    back: '/admin/users',
    needs: 'consola',
  },
  {
    path: '/admin/users/:id/personal-data',
    code: '05b',
    title: 'ADMIN · DATOS PERSONALES',
    back: (p) => `/admin/users/${p.id}`,
    needs: 'usuario.editar',
  },
  {
    path: '/admin/users/:id/locations',
    code: '06b',
    title: 'ADMIN · ZONA ASIGNADA',
    bar: 'admin',
    back: (p) => `/admin/users/${p.id}`,
    needs: 'usuario.editar',
  },
  {
    path: '/admin/users/:id/history',
    code: '03',
    title: 'ADMIN · HISTORIAL',
    bar: 'admin',
    back: (p) => `/admin/users/${p.id}`,
    needs: 'consola',
  },
]

/** Where each tab of each bar goes. */
export const OPERATOR_TABS = {
  mapa: '/map',
  flota: '/reports',
  escanear: '/scan',
  alertas: '/alerts',
  perfil: '/profile',
} as const

export const ADMIN_TABS = {
  resumen: '/admin',
  unidades: '/admin/locations',
  usuarios: '/admin/users',
  reportes: '/admin/reports',
} as const

/** Whether `path` is `at` or something inside it. */
function under(path: string, at: string) {
  return path === at || path.startsWith(at + '/')
}

/**
 * Which tab of its bar a place lights up: the longest tab it sits under, so
 * /admin/reports lights REPORTES rather than RESUMEN, which it also starts
 * with.
 */
export function activeTab(path: string) {
  const deepest = (tabs: Record<string, string>) =>
    Object.entries(tabs)
      .filter(([, at]) => under(path, at))
      .sort((a, b) => b[1].length - a[1].length)[0]?.[0]
  // /admin/... sits under nothing of the operator's, and /profile/locations is the
  // operator's profile rather than a place of its own.
  if (path.startsWith('/admin')) return deepest(ADMIN_TABS) ?? 'resumen'
  return deepest(OPERATOR_TABS) ?? 'perfil'
}
