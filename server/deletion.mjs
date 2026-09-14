// Borrar una compañía entera, cuando lo pide quien la administra.
//
// Todo es todo: sus cuentas, sus unidades, su historial, sus fotos, sus llaves
// y las sesiones abiertas de su gente. Lo que queda después no es una compañía
// vacía — es que esa compañía no está.
//
// Este módulo no sabe de HTTP ni habla español: devuelve cuánto quitó.

const clean = (value) => String(value ?? '').trim()

/** Las tablas de negocio que pertenecen a una compañía. */
const COMPANY_TABLES = [
  'users', 'locations', 'userLocations', 'vehicleLocations', 'vehicles',
  'vehiclePositions', 'events', 'photos', 'grants', 'dismissals',
]

/**
 * Borra todo lo de una compañía.
 *
 * Todo es todo: sus cuentas, sus unidades, su historial, sus fotos, sus llaves
 * y las sesiones abiertas de su gente. Lo que queda después no es una compañía
 * vacía — es que esa compañía no está.
 *
 * Devuelve los archivos de foto que hay que borrar aparte: aquí no se toca
 * disco. Sabe qué sobra; quien llama sabe dónde vive.
 */
export function purgeCompany(state, companyId) {
  const id = clean(companyId)
  if (!id) return { ok: false, error: 'UNKNOWN_COMPANY' }
  const rows = state?.rows ?? {}
  if (!(rows.companies ?? []).some((row) => row.id === id))
    return { ok: false, error: 'UNKNOWN_COMPANY' }

  const people = new Set((rows.users ?? []).filter((row) => row.companyId === id).map((row) => row.id))
  const orphanedPhotos = (rows.photos ?? [])
    .filter((row) => row.companyId === id && row.filename)
    .map((row) => row.filename)

  const removed = {}
  for (const table of COMPANY_TABLES) {
    if (!Array.isArray(rows[table])) continue
    const before = rows[table].length
    rows[table] = rows[table].filter((row) => row.companyId !== id)
    if (rows[table].length !== before) removed[table] = before - rows[table].length
  }
  const companiesBefore = (rows.companies ?? []).length
  rows.companies = (rows.companies ?? []).filter((row) => row.id !== id)
  removed.companies = companiesBefore - rows.companies.length

  // Las llaves de una compañía se van con ella; las dirigidas a una persona no
  // llevan compañía, así que se van con la cuenta que las pidió.
  const tokensBefore = (state.tokens ?? []).length
  state.tokens = (state.tokens ?? []).filter(
    (row) => row.companyId !== id && !(row.createdBy && people.has(row.createdBy)),
  )
  if (state.tokens.length !== tokensBefore) removed.tokens = tokensBefore - state.tokens.length

  let sessions = 0
  for (const [token, session] of Object.entries(state.sessions ?? {})) {
    if (people.has(session?.userId)) { delete state.sessions[token]; sessions += 1 }
  }
  if (sessions) removed.sessions = sessions

  return { ok: true, removed, orphanedPhotos }
}
