// Del blob a PostgreSQL: el estado entero, una vez, sin dejarse nada.
//
// El almacén de FleetHub es hoy un único JSON. Esto lo lee —del blob de
// Netlify o de un fichero de copia— y lo escribe en las dieciséis tablas.
// No transforma nada más allá de los nombres: lo que estaba en el JSON entra
// tal cual, con los tipos que la columna espera.
//
// Dos garantías, y son las dos que importan al migrar:
//
//   - Todo o nada. Una sola transacción; si falla la última fila, no queda
//     ninguna de las primeras. Se puede arreglar el problema y volver.
//   - Se puede repetir. Cada inserción lleva ON CONFLICT DO NOTHING, así que
//     una segunda pasada no duplica: cuenta cero y termina.
//
// Uso:
//
//   DATABASE_URL=postgres://… node scripts/import-postgres.mjs
//   DATABASE_URL=…  node scripts/import-postgres.mjs --file=backups/fleethub-data-v13-2026-08-20.json
//
// Sin --file lee el blob del entorno que diga FLEETHUB_ENVIRONMENT, igual que
// hace la Function. Con --file lee ese JSON y no toca la red.

import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { normalizeState } from '../server/app.mjs'

// ── Argumentos ──────────────────────────────────────────────────────────────

const argument = (name) => {
  const found = process.argv.slice(2).find((value) => value.startsWith(`--${name}=`))
  return found ? found.slice(name.length + 3) : undefined
}

const file = argument('file')
const databaseUrl = argument('database-url') ?? process.env.DATABASE_URL

if (!databaseUrl) {
  console.error('Falta DATABASE_URL (o --database-url=…).')
  process.exit(1)
}

// ── Lectura del estado ──────────────────────────────────────────────────────

/**
 * El JSON de partida.
 *
 * `normalizeState` es el mismo que usa la API: rellena lo que falte y, si la
 * copia es de la versión 13, le pone la compañía a las filas que nacieron sin
 * ella. Importar sin pasar por ahí metería filas huérfanas.
 */
async function readState() {
  if (file) return normalizeState(JSON.parse(await readFile(file, 'utf8')))
  // El blob sólo se pide si hace falta, para que el script no dependa de
  // Netlify cuando se le da un fichero.
  const { getStore } = await import('@netlify/blobs')
  const context = process.env.FLEETHUB_ENVIRONMENT ?? process.env.CONTEXT ?? 'development'
  const suffix = context === 'production' ? '' : `-${context}`
  const store = getStore({ name: `fleethub-data${suffix}`, consistency: 'strong' })
  return normalizeState(await store.get('state', { type: 'json', consistency: 'strong' }))
}

// ── Conversiones ────────────────────────────────────────────────────────────

/** Una fecha ISO tal como está, o nada. La columna es timestamptz y la casta. */
const at = (value) => {
  const text = typeof value === 'string' ? value.trim() : ''
  return text ? text : null
}

/** Un entero, o nada. Vale para smallint y para integer. */
const int = (value) => (Number.isFinite(Number(value)) && value !== null && value !== '' ? Math.trunc(Number(value)) : null)

/** Un número con decimales, o nada. */
const num = (value) => (Number.isFinite(Number(value)) && value !== null && value !== '' ? Number(value) : null)

/** Texto, o nada. */
const text = (value) => (value === null || value === undefined ? null : String(value))

/**
 * Un objeto o una lista para una columna jsonb.
 *
 * Va serializado a mano a propósito: el driver convierte una lista de
 * JavaScript en literal de array de PostgreSQL, que es justo lo que no
 * queremos donde la columna es jsonb.
 */
const jsonb = (value) => (value === null || value === undefined ? null : JSON.stringify(value))

/** El rol se guarda por nombre en el JSON y por nivel en la base. */
const TIER_OF = { VISITANTE: 0, OPERADOR: 1, ADMINISTRADOR: 2, SOPORTE: 3 }
const role = (value) => (typeof value === 'number' ? Math.trunc(value) : TIER_OF[String(value ?? '')] ?? null)

/**
 * El identificador de una llave, que en el JSON no existe.
 *
 * Las filas de `tokens` nunca tuvieron `id`: se buscaban por su código. Aquí
 * hace falta uno y tiene que ser el mismo en cada pasada, o repetir la
 * importación duplicaría la tabla. Se deriva de lo que identifica a la fila
 * —propósito, hora de creación, código o destinatario— con la forma de un
 * UUID de versión 5, que es exactamente para esto.
 */
const NAMESPACE = 'fleethub.tokens'
const derivado = (key) => {
  const hash = createHash('sha1').update(key).digest()
  hash[6] = (hash[6] & 0x0f) | 0x50
  hash[8] = (hash[8] & 0x3f) | 0x80
  const hex = hash.subarray(0, 16).toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

const tokenId = (row) =>
  derivado([NAMESPACE, row.purpose, row.createdAt, row.code ?? '', row.owner ?? ''].join('|'))

/**
 * El identificador de un uso.
 *
 * Los usos eran una lista dentro de la llave y no tenian nombre propio. La
 * tabla les da uno porque la clave que traia el borrador --(llave, instante)--
 * hace que dos usos del mismo milisegundo sean la misma fila. Se deriva de lo
 * que lo identifica para que repetir la importacion no duplique.
 */
const useId = (llave, use, indice) =>
  derivado([NAMESPACE, 'use', llave, use.at ?? '', use.by ?? '', indice].join('|'))

// ── El plan: qué tabla, qué columnas, de dónde salen las filas ──────────────

/**
 * Las dieciséis, en el orden en que se pueden insertar.
 *
 * El orden no es estético: dentro de una transacción las claves ajenas se
 * comprueban fila a fila, así que la compañía va antes que sus usuarios y el
 * vehículo antes que sus eventos.
 */
const plan = (state) => {
  const rows = state.rows
  const tokens = state.tokens ?? []
  // Los identificadores derivados se calculan una vez: los usan la tabla de
  // llaves y la de sus usos.
  const withId = tokens.map((row) => ({ id: tokenId(row), row }))

  return [
    {
      table: 'companies',
      columns: ['id', 'created_at'],
      conflict: '(id)',
      values: rows.companies.map((row) => [row.id, at(row.createdAt)]),
    },
    {
      table: 'users',
      columns: [
        'id', 'company_id', 'full_name', 'email', 'phone_code', 'phone', 'language',
        'role', 'suspension', 'password', 'created_at', 'updated_at', 'password_changed_at',
      ],
      conflict: '(id)',
      values: rows.users.map((row) => [
        row.id, row.companyId, text(row.fullName), text(row.email), text(row.phoneCode),
        text(row.phone), text(row.language), role(row.role), text(row.suspension),
        text(row.password), at(row.createdAt), at(row.updatedAt),
        // Las cuentas mas viejas no lo tienen: nacieron antes de que existiera
        // la columna. La fecha de alta es la verdad --nunca han cambiado la
        // clave-- y es el mismo respaldo que ya usa el frontend.
        at(row.passwordChangedAt ?? row.createdAt),
      ]),
    },
    {
      table: 'locations',
      columns: [
        'id', 'company_id', 'name', 'points', 'active', 'traffic_margin_percent',
        'distance_meters', 'duration_seconds', 'geometry', 'routing_provider',
        'routing_traffic', 'routing_calculated_at', 'created_at', 'updated_at',
      ],
      conflict: '(id)',
      values: rows.locations.map((row) => [
        row.id, row.companyId, text(row.name), jsonb(row.points ?? []), Boolean(row.active),
        int(row.trafficMarginPercent), int(row.distanceMeters), int(row.durationSeconds),
        jsonb(row.geometry ?? null), text(row.routingProvider), text(row.routingTraffic),
        at(row.routingCalculatedAt), at(row.createdAt), at(row.updatedAt),
      ]),
    },
    {
      // En el JSON son `year` y `trim`; aquí, `model_year` y `trim_level`.
      table: 'vehicles',
      columns: [
        'vin', 'company_id', 'state', 'decode_status', 'decoded_at', 'decoder',
        'model_year', 'make', 'model', 'trim_level', 'body', 'engine', 'created_at', 'updated_at',
      ],
      conflict: '(company_id, vin)',
      values: rows.vehicles.map((row) => [
        text(row.vin), row.companyId, int(row.state), text(row.decodeStatus), at(row.decodedAt),
        text(row.decoder), int(row.year), text(row.make), text(row.model), text(row.trim),
        text(row.body), text(row.engine), at(row.createdAt), at(row.updatedAt),
      ]),
    },
    {
      table: 'vehicle_locations',
      columns: [
        'id', 'company_id', 'vin', 'location_id', 'assigned_at', 'assigned_by',
        'route_started_at', 'route_started_by', 'updated_at',
      ],
      conflict: '(id)',
      values: rows.vehicleLocations.map((row) => [
        text(row.id), row.companyId, text(row.vin), row.locationId, at(row.assignedAt),
        row.assignedBy ?? null, at(row.routeStartedAt), row.routeStartedBy ?? null, at(row.updatedAt),
      ]),
    },
    {
      table: 'user_locations',
      columns: ['id', 'company_id', 'user_id', 'location_id', 'assigned_at', 'assigned_by'],
      conflict: '(id)',
      values: rows.userLocations.map((row) => [
        text(row.id), row.companyId, row.userId, row.locationId, at(row.assignedAt), row.assignedBy ?? null,
      ]),
    },
    {
      table: 'events',
      columns: [
        'id', 'company_id', 'vin', 'user_id', 'kind', 'note', 'previous_state',
        'state', 'location_id', 'photos', 'created_at',
      ],
      conflict: '(id)',
      values: rows.events.map((row) => [
        text(row.id), row.companyId, text(row.vin), row.userId ?? null, text(row.kind),
        text(row.note ?? ''), int(row.previousState), int(row.state), row.locationId ?? null,
        // text[]: aquí sí queremos el array del driver, no JSON.
        (row.photos ?? []).map(String), at(row.createdAt),
      ]),
    },
    {
      table: 'vehicle_positions',
      columns: ['id', 'company_id', 'vin', 'latitude', 'longitude', 'accuracy', 'reported_by', 'created_at'],
      conflict: '(id)',
      values: rows.vehiclePositions.map((row) => [
        row.id, row.companyId, text(row.vin), num(row.latitude), num(row.longitude),
        num(row.accuracy), row.reportedBy ?? null, at(row.createdAt),
      ]),
    },
    {
      table: 'photos',
      columns: ['id', 'company_id', 'vin', 'uploaded_by', 'content_type', 'filename', 'width', 'height', 'bytes', 'created_at'],
      conflict: '(id)',
      values: rows.photos.map((row) => [
        text(row.id), row.companyId, text(row.vin), row.uploadedBy ?? null, text(row.contentType),
        text(row.filename), int(row.width), int(row.height), int(row.bytes), at(row.createdAt),
      ]),
    },
    {
      table: 'dismissals',
      columns: ['id', 'company_id', 'vin', 'alert_id', 'title', 'user_id', 'created_at'],
      conflict: '(id)',
      values: rows.dismissals.map((row) => [
        text(row.id), row.companyId, text(row.vin), text(row.alertId), text(row.title ?? ''),
        row.userId ?? null, at(row.createdAt),
      ]),
    },
    {
      table: 'grants',
      columns: ['id', 'user_id', 'company_id', 'code', 'granted_at', 'expires_at', 'ended_at', 'ended_by'],
      conflict: '(id)',
      values: rows.grants.map((row) => [
        row.id, row.userId, row.companyId, text(row.code), at(row.grantedAt),
        at(row.expiresAt), at(row.endedAt), row.endedBy ?? null,
      ]),
    },
    {
      // `secret` se abre en dos columnas y `registration` en tres.
      table: 'tokens',
      columns: [
        'id', 'purpose', 'code', 'tier', 'company_id', 'owner', 'secret_salt', 'secret_hash',
        'tries_left', 'delegated_to', 'expires_at', 'revoked_at', 'revoked_by', 'created_by',
        'created_at', 'registration_user_id', 'registration_receipt', 'registration_claimed_at',
      ],
      conflict: '(id)',
      values: withId.map(({ id, row }) => [
        id, text(row.purpose), text(row.code), int(row.tier), row.companyId ?? null,
        text(row.owner), text(row.secret?.salt), text(row.secret?.hash), int(row.triesLeft),
        text(row.delegatedTo), at(row.expiresAt), at(row.revokedAt), row.revokedBy ?? null,
        row.createdBy ?? null, at(row.createdAt), row.registration?.userId ?? null,
        text(row.registration?.receiptHash), at(row.registration?.claimedAt),
      ]),
    },
    {
      // `usedBy` era una lista dentro de la llave; aquí es una fila por uso.
      table: 'token_uses',
      columns: ['id', 'token_id', 'used_at', 'used_by'],
      conflict: '(id)',
      values: withId.flatMap(({ id, row }) => (row.usedBy ?? [])
        .map((use, indice) => [useId(id, use, indice), id, at(use.at), use.by ?? null])),
    },
    {
      table: 'sessions',
      columns: ['token', 'user_id', 'password_reset', 'until'],
      conflict: '(token)',
      values: Object.entries(state.sessions ?? {}).map(([token, session]) => [
        token, session.userId, Boolean(session.passwordReset), at(session.until),
      ]),
    },
    {
      table: 'rate_limits',
      columns: ['key', 'count', 'reset_at'],
      conflict: '(key)',
      values: Object.entries(state.rateLimits ?? {}).map(([key, row]) => [
        key, int(row?.count) ?? 0, at(new Date(row?.resetAt ?? 0).toISOString()),
      ]),
    },
    {
      // El JSON guarda un contador por proveedor; la tabla, uno por día.
      table: 'quotas',
      columns: ['provider', 'day', 'count', 'warned'],
      conflict: '(provider, day)',
      values: Object.entries(state.quotas ?? {}).map(([provider, row]) => [
        provider, text(row?.day), int(row?.count) ?? 0, Boolean(row?.warned),
      ]),
    },
  ]
}

// ── Escritura ───────────────────────────────────────────────────────────────

/** El tope de parámetros de un enunciado; se trocea para no acercarse. */
const MAX_PARAMETERS = 30_000

/**
 * Mete las filas de una tabla y devuelve cuántas entraron de verdad.
 *
 * `ON CONFLICT DO NOTHING` es lo que hace que repetir la importación no
 * duplique: lo que ya estaba no se toca y tampoco se cuenta.
 */
async function insert(client, { table, columns, conflict, values }) {
  if (!values.length) return 0
  const perChunk = Math.max(1, Math.floor(MAX_PARAMETERS / columns.length))
  let written = 0
  for (let start = 0; start < values.length; start += perChunk) {
    const chunk = values.slice(start, start + perChunk)
    let parameter = 0
    const tuples = chunk.map(
      (row) => `(${row.map(() => `$${++parameter}`).join(', ')})`,
    )
    const statement =
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${tuples.join(', ')} ` +
      `ON CONFLICT ${conflict} DO NOTHING`
    const result = await client.query(statement, chunk.flat())
    written += result.rowCount
  }
  return written
}

async function main() {
  const state = await readState()
  const tables = plan(state)

  const { default: pg } = await import('pg')
  const client = new pg.Client({ connectionString: databaseUrl })
  await client.connect()

  const written = new Map()
  try {
    // Una transacción para las dieciséis tablas: o entra todo o no entra nada.
    await client.query('BEGIN')
    for (const table of tables) written.set(table.table, await insert(client, table))
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    await client.end().catch(() => {})
    console.error(`\nNo se importó nada. La transacción se deshizo entera.\n${error.message}`)
    process.exit(1)
  }

  // La comprobacion que decide si esto sirvio: lo que hay dentro contra lo que
  // se leyo. Sin ella, una tabla que entra a cero se lee igual que una tabla
  // que no tenia nada, y la importacion diria que todo fue bien.
  const dentro = new Map()
  for (const { table } of tables) {
    const { rows } = await client.query(`select count(*)::int n from ${table}`)
    dentro.set(table, rows[0].n)
  }
  await client.end()

  const cortas = tables
    .map(({ table, values }) => ({ table, leidas: values.length, hay: dentro.get(table) ?? 0 }))
    .filter(({ leidas, hay }) => hay < leidas)

  if (cortas.length) {
    console.error(`\nLa importación no cuadra:\n`)
    for (const { table, leidas, hay } of cortas)
      console.error(`  ${table}: se leyeron ${leidas} y hay ${hay}`)
    console.error(`\nNo te fíes de esta base.\n`)
    process.exit(1)
  }

  // El recuento: filas nuevas por tabla. Una segunda pasada las deja a cero,
  // que es la señal de que el estado ya estaba dentro.
  const width = Math.max(...tables.map((table) => table.table.length))
  let total = 0
  console.log(`\nDe ${file ?? 'el blob'} a PostgreSQL:\n`)
  for (const { table, values } of tables) {
    const rows = written.get(table) ?? 0
    total += rows
    const leidas = values.length
    const repetidas = leidas - rows
    console.log(
      `  ${table.padEnd(width)}  ${String(rows).padStart(6)} nuevas` +
      (repetidas > 0 ? `  (${repetidas} ya estaban)` : ''),
    )
  }
  console.log(`\n  ${'TOTAL'.padEnd(width)}  ${String(total).padStart(6)} filas\n`)
}

await main()
