// El almacen, cuando vive en PostgreSQL.
//
// Cumple el mismo contrato que el de Netlify Blobs --`loadState` devuelve el
// estado con su revision, `saveState` lo escribe o dice que llego tarde-- para
// que `createFleetHubApi` no se entere de que ha cambiado nada debajo.
//
// Por que este corte y no reescribir cada operacion en SQL:
//
// Las clases de negocio (Users, Vehicles, Codes...) trabajan sobre arrays en
// memoria y avisan con `save()` cuando tocan algo. Reescribir sus cien accesos
// como consultas sueltas obliga a declarar a mano la frontera de cada
// transaccion --veintiuna solo en resources.mjs-- y una frontera mal escrita
// no da error: hace media escritura y contesta que todo salio bien. Aqui la
// transaccion es una sola y envuelve la peticion entera, asi que la atomicidad
// que antes venia de regalo con el volcado unico se conserva de regalo.
//
// Lo que se escribe es la diferencia, no el estado. Se guarda una copia de lo
// leido y al final se compara fila a fila: lo que nacio se inserta, lo que
// cambio se actualiza, lo que desaparecio se borra. Nada mas.
//
// La revision es un contador con su propia fila. Antes de escribir se toma
// bloqueada, y si no es la que se leyo, alguien escribio en medio y esto
// devuelve `{ ok: false }` --el mismo 409 de siempre, que el cliente ya sabe
// reintentar.

import pg from 'pg'

/** Lo que se guarda en la fila del contador. Una sola, y siempre esta. */
const REVISION_ID = 1

// -- Conversiones ------------------------------------------------------------

const texto = (valor) => (valor === null || valor === undefined ? null : String(valor))

const entero = (valor) => {
  if (valor === null || valor === undefined || valor === '') return null
  const n = Number(valor)
  return Number.isFinite(n) ? Math.trunc(n) : null
}

const numero = (valor) => {
  if (valor === null || valor === undefined || valor === '') return null
  const n = Number(valor)
  return Number.isFinite(n) ? n : null
}

/** Una fecha como la guarda el JSON: ISO o nada. Nunca `Invalid Date`. */
const cuando = (valor) => {
  if (!valor) return null
  const fecha = new Date(valor)
  return Number.isNaN(fecha.getTime()) ? null : fecha.toISOString()
}

/** Lo que vuelve de una columna `timestamptz`, en el ISO que espera el codigo. */
const desdeFecha = (valor) => (valor ? new Date(valor).toISOString() : null)

const uuid = (valor) => (valor ? String(valor) : null)

// -- El mapa ------------------------------------------------------------------
//
// Cada entrada dice donde vive la tabla dentro del estado, como se llama en la
// base, que la identifica, y como se traduce una fila en cada direccion. Es el
// unico sitio donde estan los dos idiomas, para que no puedan separarse.

const TABLAS = [
  {
    nombre: 'companies',
    en: ['rows', 'companies'],
    clave: ['id'],
    columnas: ['id', 'created_at'],
    aFila: (r) => [uuid(r.id), cuando(r.createdAt)],
    aJs: (f) => ({ id: f.id, createdAt: desdeFecha(f.created_at) }),
  },
  {
    nombre: 'users',
    en: ['rows', 'users'],
    clave: ['id'],
    columnas: [
      'id', 'company_id', 'full_name', 'email', 'phone_code', 'phone', 'language',
      'role', 'suspension', 'password', 'created_at', 'updated_at', 'password_changed_at',
    ],
    aFila: (r) => [
      uuid(r.id), uuid(r.companyId), texto(r.fullName), texto(r.email), texto(r.phoneCode),
      texto(r.phone), texto(r.language), entero(r.role) ?? 0, texto(r.suspension) || null,
      texto(r.password), cuando(r.createdAt), cuando(r.updatedAt),
      // Las cuentas anteriores a la columna no lo tienen; su alta es la verdad.
      cuando(r.passwordChangedAt ?? r.createdAt),
    ],
    aJs: (f) => ({
      id: f.id, companyId: f.company_id, fullName: f.full_name, email: f.email,
      phoneCode: f.phone_code, phone: f.phone, language: f.language, role: f.role,
      suspension: f.suspension ?? null, password: f.password,
      createdAt: desdeFecha(f.created_at), updatedAt: desdeFecha(f.updated_at),
      passwordChangedAt: desdeFecha(f.password_changed_at),
    }),
  },
  {
    nombre: 'locations',
    en: ['rows', 'locations'],
    clave: ['id'],
    columnas: [
      'id', 'company_id', 'name', 'points', 'active', 'traffic_margin_percent',
      'distance_meters', 'duration_seconds', 'geometry', 'routing_provider',
      'routing_traffic', 'routing_calculated_at', 'created_at', 'updated_at',
    ],
    aFila: (r) => [
      uuid(r.id), uuid(r.companyId), texto(r.name), JSON.stringify(r.points ?? []),
      Boolean(r.active), entero(r.trafficMarginPercent) ?? 0, entero(r.distanceMeters),
      entero(r.durationSeconds), r.geometry ? JSON.stringify(r.geometry) : null,
      texto(r.routingProvider), texto(r.routingTraffic), cuando(r.routingCalculatedAt),
      cuando(r.createdAt), cuando(r.updatedAt),
    ],
    aJs: (f) => ({
      id: f.id, companyId: f.company_id, name: f.name, points: f.points ?? [],
      active: f.active, trafficMarginPercent: f.traffic_margin_percent,
      distanceMeters: f.distance_meters, durationSeconds: f.duration_seconds,
      geometry: f.geometry ?? null, routingProvider: f.routing_provider,
      routingTraffic: f.routing_traffic, routingCalculatedAt: desdeFecha(f.routing_calculated_at),
      createdAt: desdeFecha(f.created_at), updatedAt: desdeFecha(f.updated_at),
    }),
  },
  {
    // En el codigo son `year` y `trim`; en la base, `model_year` y `trim_level`.
    nombre: 'vehicles',
    en: ['rows', 'vehicles'],
    clave: ['company_id', 'vin'],
    columnas: [
      'vin', 'company_id', 'state', 'decode_status', 'decoded_at', 'decoder',
      'model_year', 'make', 'model', 'trim_level', 'body', 'engine', 'created_at', 'updated_at',
    ],
    aFila: (r) => [
      texto(r.vin), uuid(r.companyId), entero(r.state), texto(r.decodeStatus),
      cuando(r.decodedAt), texto(r.decoder), entero(r.year), texto(r.make), texto(r.model),
      texto(r.trim), texto(r.body), texto(r.engine), cuando(r.createdAt), cuando(r.updatedAt),
    ],
    aJs: (f) => ({
      vin: f.vin, companyId: f.company_id, state: f.state, decodeStatus: f.decode_status,
      decodedAt: desdeFecha(f.decoded_at), decoder: f.decoder, year: f.model_year,
      make: f.make, model: f.model, trim: f.trim_level, body: f.body, engine: f.engine,
      createdAt: desdeFecha(f.created_at), updatedAt: desdeFecha(f.updated_at),
    }),
  },
  {
    nombre: 'vehicle_locations',
    en: ['rows', 'vehicleLocations'],
    clave: ['id'],
    columnas: [
      'id', 'company_id', 'vin', 'location_id', 'assigned_at', 'assigned_by',
      'route_started_at', 'route_started_by', 'updated_at',
    ],
    aFila: (r) => [
      texto(r.id), uuid(r.companyId), texto(r.vin), uuid(r.locationId), cuando(r.assignedAt),
      uuid(r.assignedBy), cuando(r.routeStartedAt), uuid(r.routeStartedBy), cuando(r.updatedAt),
    ],
    aJs: (f) => ({
      id: f.id, companyId: f.company_id, vin: f.vin, locationId: f.location_id,
      assignedAt: desdeFecha(f.assigned_at), assignedBy: f.assigned_by,
      routeStartedAt: desdeFecha(f.route_started_at), routeStartedBy: f.route_started_by,
      updatedAt: desdeFecha(f.updated_at),
    }),
  },
  {
    nombre: 'user_locations',
    en: ['rows', 'userLocations'],
    clave: ['id'],
    columnas: ['id', 'company_id', 'user_id', 'location_id', 'assigned_at', 'assigned_by'],
    aFila: (r) => [
      texto(r.id), uuid(r.companyId), uuid(r.userId), uuid(r.locationId),
      cuando(r.assignedAt), uuid(r.assignedBy),
    ],
    aJs: (f) => ({
      id: f.id, companyId: f.company_id, userId: f.user_id, locationId: f.location_id,
      assignedAt: desdeFecha(f.assigned_at), assignedBy: f.assigned_by,
    }),
  },
  {
    // `seq` la pone la base y da el orden verdadero; no viaja al codigo, pero
    // es por lo que se ordena al leer.
    nombre: 'events',
    en: ['rows', 'events'],
    clave: ['id'],
    orden: 'created_at DESC, seq DESC',
    columnas: [
      'id', 'company_id', 'vin', 'user_id', 'kind', 'note', 'previous_state',
      'state', 'location_id', 'photos', 'created_at',
    ],
    aFila: (r) => [
      texto(r.id), uuid(r.companyId), texto(r.vin), uuid(r.userId), texto(r.kind),
      texto(r.note) ?? '', entero(r.previousState), entero(r.state), uuid(r.locationId),
      Array.isArray(r.photos) ? r.photos.map(String) : [], cuando(r.createdAt),
    ],
    aJs: (f) => ({
      id: f.id, companyId: f.company_id, vin: f.vin, userId: f.user_id, kind: f.kind,
      note: f.note, previousState: f.previous_state, state: f.state,
      locationId: f.location_id, photos: f.photos ?? [], createdAt: desdeFecha(f.created_at),
    }),
  },
  {
    nombre: 'vehicle_positions',
    en: ['rows', 'vehiclePositions'],
    clave: ['id'],
    orden: 'created_at DESC',
    columnas: ['id', 'company_id', 'vin', 'latitude', 'longitude', 'accuracy', 'reported_by', 'created_at'],
    aFila: (r) => [
      uuid(r.id), uuid(r.companyId), texto(r.vin), numero(r.latitude), numero(r.longitude),
      numero(r.accuracy), uuid(r.reportedBy), cuando(r.createdAt),
    ],
    aJs: (f) => ({
      id: f.id, companyId: f.company_id, vin: f.vin, latitude: f.latitude,
      longitude: f.longitude, accuracy: f.accuracy, reportedBy: f.reported_by,
      createdAt: desdeFecha(f.created_at),
    }),
  },
  {
    nombre: 'photos',
    en: ['rows', 'photos'],
    clave: ['id'],
    columnas: ['id', 'company_id', 'vin', 'uploaded_by', 'content_type', 'filename', 'width', 'height', 'bytes', 'created_at'],
    aFila: (r) => [
      texto(r.id), uuid(r.companyId), texto(r.vin), uuid(r.uploadedBy), texto(r.contentType),
      texto(r.filename), entero(r.width) ?? 0, entero(r.height) ?? 0, entero(r.bytes) ?? 0,
      cuando(r.createdAt),
    ],
    aJs: (f) => ({
      id: f.id, companyId: f.company_id, vin: f.vin, uploadedBy: f.uploaded_by,
      contentType: f.content_type, filename: f.filename, width: f.width, height: f.height,
      bytes: f.bytes, createdAt: desdeFecha(f.created_at),
    }),
  },
  {
    nombre: 'dismissals',
    en: ['rows', 'dismissals'],
    clave: ['id'],
    columnas: ['id', 'company_id', 'vin', 'alert_id', 'title', 'user_id', 'created_at'],
    aFila: (r) => [
      texto(r.id), uuid(r.companyId), texto(r.vin), texto(r.alertId) ?? '',
      texto(r.title) ?? '', uuid(r.userId), cuando(r.createdAt),
    ],
    aJs: (f) => ({
      id: f.id, companyId: f.company_id, vin: f.vin, alertId: f.alert_id,
      title: f.title, userId: f.user_id, createdAt: desdeFecha(f.created_at),
    }),
  },
  {
    nombre: 'grants',
    en: ['rows', 'grants'],
    clave: ['id'],
    orden: 'granted_at DESC',
    columnas: ['id', 'user_id', 'company_id', 'code', 'granted_at', 'expires_at', 'ended_at', 'ended_by'],
    aFila: (r) => [
      uuid(r.id), uuid(r.userId), uuid(r.companyId), texto(r.code), cuando(r.grantedAt),
      cuando(r.expiresAt), cuando(r.endedAt), uuid(r.endedBy),
    ],
    aJs: (f) => ({
      id: f.id, userId: f.user_id, companyId: f.company_id, code: f.code,
      grantedAt: desdeFecha(f.granted_at), expiresAt: desdeFecha(f.expires_at),
      endedAt: desdeFecha(f.ended_at), endedBy: f.ended_by,
    }),
  },
]

/**
 * Las llaves, que no caben en el molde de arriba.
 *
 * Dos motivos: no viven bajo `rows` sino sueltas en el estado, y `secret` y
 * `registration` son objetos que se abren en columnas. Sus usos son ademas una
 * tabla aparte --`usedBy` era una lista dentro de la llave-- y se reconstruyen
 * al leer.
 */
const LLAVES = {
  nombre: 'tokens',
  en: ['tokens'],
  clave: ['id'],
  orden: 'created_at',
  columnas: [
    'id', 'purpose', 'code', 'tier', 'company_id', 'owner', 'secret_salt', 'secret_hash',
    'tries_left', 'delegated_to', 'expires_at', 'revoked_at', 'revoked_by', 'created_by',
    'created_at', 'registration_user_id', 'registration_receipt', 'registration_claimed_at',
  ],
  aFila: (r) => [
    uuid(r.id), texto(r.purpose), texto(r.code), entero(r.tier), uuid(r.companyId),
    texto(r.owner), texto(r.secret?.salt), texto(r.secret?.hash), entero(r.triesLeft) ?? 0,
    texto(r.delegatedTo), cuando(r.expiresAt), cuando(r.revokedAt), uuid(r.revokedBy),
    uuid(r.createdBy), cuando(r.createdAt), uuid(r.registration?.userId),
    texto(r.registration?.receiptHash), cuando(r.registration?.claimedAt),
  ],
  aJs: (f) => {
    const fila = {
      id: f.id, purpose: f.purpose, code: f.code, tier: f.tier, companyId: f.company_id,
      owner: f.owner, triesLeft: f.tries_left, delegatedTo: f.delegated_to,
      expiresAt: desdeFecha(f.expires_at), revokedAt: desdeFecha(f.revoked_at),
      revokedBy: f.revoked_by, createdBy: f.created_by, createdAt: desdeFecha(f.created_at),
      usedBy: [],
    }
    // `secret` solo existe si lo hay: una llave delegada lo pierde a proposito
    // y el codigo distingue ausencia de vacio.
    if (f.secret_hash) fila.secret = { salt: f.secret_salt, hash: f.secret_hash }
    if (f.registration_user_id || f.registration_receipt) {
      fila.registration = {
        userId: f.registration_user_id,
        receiptHash: f.registration_receipt,
        claimedAt: desdeFecha(f.registration_claimed_at),
      }
    }
    return fila
  },
}

/** El orden de insercion: los padres antes que los hijos. */
const ORDEN = [...TABLAS.map((t) => t.nombre), 'tokens', 'token_uses', 'sessions', 'rate_limits', 'quotas']

// -- Utilidades ---------------------------------------------------------------

const en = (estado, camino) => camino.reduce((nodo, paso) => nodo?.[paso], estado)

const claveDe = (mapa, fila) => {
  const valores = mapa.aFila(fila)
  // Con separador: la clave de `vehicles` son dos columnas, y pegarlas sin
  // nada las haria ambiguas el dia que una cambie de longitud.
  return mapa.clave.map((col) => String(valores[mapa.columnas.indexOf(col)])).join('|')
}

/** Dos filas son la misma si todas sus columnas lo son. */
const iguales = (a, b) => a.length === b.length && a.every((v, i) => {
  const otro = b[i]
  if (Array.isArray(v) && Array.isArray(otro)) return JSON.stringify(v) === JSON.stringify(otro)
  return String(v) === String(otro)
})

/**
 * Las tres que no son listas sino diccionarios.
 *
 * En el estado son objetos con clave --el token de sesion, la clave del limite,
 * el nombre del proveedor-- y en la base son filas normales. Se traducen
 * aparte porque comparar un diccionario no es comparar una lista.
 */
const DICCIONARIOS = [
  {
    nombre: 'sessions',
    en: ['sessions'],
    clave: 'token',
    columnas: ['token', 'user_id', 'password_reset', 'until'],
    aFila: (token, s) => [texto(token), uuid(s.userId), Boolean(s.passwordReset), cuando(s.until)],
    aJs: (f) => [f.token, {
      userId: f.user_id,
      until: desdeFecha(f.until),
      ...(f.password_reset ? { passwordReset: true } : {}),
    }],
  },
  {
    // `resetAt` es un numero de milisegundos en el codigo y una hora en la
    // base. Se convierte en los dos sentidos o el limite deja de vencer.
    nombre: 'rate_limits',
    en: ['rateLimits'],
    clave: 'key',
    columnas: ['key', 'count', 'reset_at'],
    aFila: (clave, r) => [texto(clave), entero(r?.count) ?? 0, cuando(new Date(r?.resetAt ?? 0).toISOString())],
    aJs: (f) => [f.key, { count: f.count, resetAt: new Date(f.reset_at).getTime() }],
  },
  {
    nombre: 'quotas',
    en: ['quotas'],
    clave: 'provider',
    columnas: ['provider', 'day', 'count', 'warned'],
    aFila: (proveedor, q) => [texto(proveedor), texto(q?.day), entero(q?.count) ?? 0, Boolean(q?.warned)],
    aJs: (f) => [f.provider, {
      day: typeof f.day === 'string' ? f.day : new Date(f.day).toISOString().slice(0, 10),
      count: f.count,
      warned: f.warned,
    }],
  },
]

// -- Diferencias --------------------------------------------------------------

/** Lo que hay que hacerle a una tabla para que se parezca a lo que se quiere. */
function diferencia(mapa, antes, ahora) {
  const previas = new Map((antes ?? []).map((fila) => [claveDe(mapa, fila), mapa.aFila(fila)]))
  const nuevas = new Map((ahora ?? []).map((fila) => [claveDe(mapa, fila), mapa.aFila(fila)]))

  const insertar = []
  const actualizar = []
  for (const [clave, valores] of nuevas) {
    const antigua = previas.get(clave)
    if (!antigua) insertar.push(valores)
    else if (!iguales(antigua, valores)) actualizar.push(valores)
  }
  const borrar = [...previas.keys()].filter((clave) => !nuevas.has(clave))
    .map((clave) => previas.get(clave))
  return { insertar, actualizar, borrar }
}

/** Lo mismo para un diccionario, donde la clave la pone quien lo guarda. */
function diferenciaDiccionario(mapa, antes, ahora) {
  const previas = new Map(Object.entries(antes ?? {}).map(([k, v]) => [k, mapa.aFila(k, v)]))
  const nuevas = new Map(Object.entries(ahora ?? {}).map(([k, v]) => [k, mapa.aFila(k, v)]))
  const insertar = []
  const actualizar = []
  for (const [clave, valores] of nuevas) {
    const antigua = previas.get(clave)
    if (!antigua) insertar.push(valores)
    else if (!iguales(antigua, valores)) actualizar.push(valores)
  }
  const borrar = [...previas.keys()].filter((clave) => !nuevas.has(clave)).map((clave) => [clave])
  return { insertar, actualizar, borrar }
}

const marcadores = (n, desde = 1) => Array.from({ length: n }, (_, i) => `$${desde + i}`).join(', ')

async function aplicar(cliente, { nombre, columnas, clave }, cambios) {
  const claves = Array.isArray(clave) ? clave : [clave]
  for (const valores of cambios.insertar) {
    await cliente.query(
      `INSERT INTO ${nombre} (${columnas.join(', ')}) VALUES (${marcadores(columnas.length)})`,
      valores,
    )
  }
  for (const valores of cambios.actualizar) {
    const sueltas = columnas.filter((col) => !claves.includes(col))
    const set = sueltas.map((col, i) => `${col} = $${i + 1}`).join(', ')
    const donde = claves.map((col, i) => `${col} = $${sueltas.length + i + 1}`).join(' AND ')
    await cliente.query(
      `UPDATE ${nombre} SET ${set} WHERE ${donde}`,
      [...sueltas.map((col) => valores[columnas.indexOf(col)]),
        ...claves.map((col) => valores[columnas.indexOf(col)])],
    )
  }
  for (const valores of cambios.borrar) {
    const donde = claves.map((col, i) => `${col} = $${i + 1}`).join(' AND ')
    const indices = claves.map((col) => {
      const posicion = columnas.indexOf(col)
      return posicion < 0 ? 0 : posicion
    })
    await cliente.query(`DELETE FROM ${nombre} WHERE ${donde}`, indices.map((i) => valores[i]))
  }
}

// -- El almacen ---------------------------------------------------------------

/**
 * El almacen sobre PostgreSQL.
 *
 * `loadState` lee el conjunto entero y se queda una copia; `saveState` compara
 * contra esa copia y escribe solo lo que cambio, dentro de una transaccion. La
 * copia viaja en `revision`, que para quien llama es opaca --lo unico que hace
 * la API con ella es devolverla-- y para aqui es la memoria de lo que habia.
 */
export function createPostgresStore({ url, version = 15, max = 1 } = {}) {
  if (!url) throw new Error('FLEETHUB_DATABASE_NOT_CONFIGURED')
  // Una conexion por invocacion. Un grupo grande en una funcion sin servidor
  // es la forma clasica de agotar el agrupador: el contenedor se congela con
  // las conexiones abiertas y el servidor no se entera hasta que expiran.
  const pool = new pg.Pool({ connectionString: url, max, idleTimeoutMillis: 10_000 })

  async function loadState() {
    const cliente = await pool.connect()
    try {
      const estado = {
        version,
        revision: 0,
        rows: {},
        sessions: {},
        tokens: [],
        rateLimits: {},
        quotas: {},
      }

      for (const mapa of TABLAS) {
        const { rows } = await cliente.query(
          `SELECT * FROM ${mapa.nombre}${mapa.orden ? ` ORDER BY ${mapa.orden}` : ''}`,
        )
        estado.rows[mapa.en[1]] = rows.map(mapa.aJs)
      }

      const { rows: llaves } = await cliente.query(`SELECT * FROM tokens ORDER BY ${LLAVES.orden}`)
      const porId = new Map()
      estado.tokens = llaves.map((fila) => {
        const llave = LLAVES.aJs(fila)
        porId.set(fila.id, llave)
        return llave
      })
      // Los usos vuelven a ser la lista que eran, en el orden que da `seq`.
      const { rows: usos } = await cliente.query('SELECT * FROM token_uses ORDER BY seq')
      for (const uso of usos) {
        porId.get(uso.token_id)?.usedBy.push({
          at: desdeFecha(uso.used_at),
          ...(uso.used_by ? { by: uso.used_by } : {}),
        })
      }

      for (const mapa of DICCIONARIOS) {
        // De las cuotas solo interesa el ultimo dia de cada proveedor: el
        // estado guardaba uno por proveedor, no un historial.
        const consulta = mapa.nombre === 'quotas'
          ? 'SELECT DISTINCT ON (provider) * FROM quotas ORDER BY provider, day DESC'
          : `SELECT * FROM ${mapa.nombre}`
        const { rows } = await cliente.query(consulta)
        estado[mapa.en[0]] = Object.fromEntries(rows.map(mapa.aJs))
      }

      const { rows: cuenta } = await cliente.query(
        'SELECT revision FROM store_revision WHERE id = $1', [REVISION_ID],
      )
      const numero = Number(cuenta[0]?.revision ?? 0)
      estado.revision = numero

      return { state: estado, revision: { numero, antes: structuredClone(estado) } }
    } finally {
      cliente.release()
    }
  }

  async function saveState(siguiente, { revision } = {}) {
    const antes = revision?.antes
    if (!antes) throw new Error('FLEETHUB_STORE_SNAPSHOT_MISSING')
    const cliente = await pool.connect()
    try {
      await cliente.query('BEGIN')

      // Tomarla bloqueada es lo que serializa a los que escriben. Si el numero
      // no es el que se leyo, alguien escribio en medio.
      const { rows } = await cliente.query(
        'SELECT revision FROM store_revision WHERE id = $1 FOR UPDATE', [REVISION_ID],
      )
      if (Number(rows[0]?.revision ?? 0) !== revision.numero) {
        await cliente.query('ROLLBACK')
        return { ok: false }
      }

      // Insertar y actualizar de padres a hijos; borrar al reves, o una clave
      // ajena protesta a mitad de camino.
      const trabajos = []
      for (const mapa of TABLAS) {
        trabajos.push([mapa, diferencia(mapa, en(antes, mapa.en), en(siguiente, mapa.en))])
      }
      trabajos.push([LLAVES, diferencia(LLAVES, antes.tokens, siguiente.tokens)])
      for (const mapa of DICCIONARIOS) {
        trabajos.push([mapa, diferenciaDiccionario(mapa, antes[mapa.en[0]], siguiente[mapa.en[0]])])
      }

      for (const [mapa, cambios] of [...trabajos].reverse()) {
        if (cambios.borrar.length) await aplicar(cliente, mapa, { insertar: [], actualizar: [], borrar: cambios.borrar })
      }
      await usosDeLlaves(cliente, antes.tokens, siguiente.tokens)
      for (const [mapa, cambios] of trabajos) {
        if (cambios.insertar.length || cambios.actualizar.length) {
          await aplicar(cliente, mapa, { ...cambios, borrar: [] })
        }
      }

      await cliente.query(
        'UPDATE store_revision SET revision = revision + 1 WHERE id = $1', [REVISION_ID],
      )
      await cliente.query('COMMIT')
      return { ok: true }
    } catch (error) {
      await cliente.query('ROLLBACK').catch(() => {})
      throw error
    } finally {
      cliente.release()
    }
  }

  return { loadState, saveState, close: () => pool.end() }
}

/**
 * Los usos de las llaves.
 *
 * Solo se anaden: un uso no se edita ni se retira, y la lista solo crece. Se
 * comparan por su sitio en la lista porque no tienen nombre propio en el
 * codigo; el identificador se lo pone la base.
 */
async function usosDeLlaves(cliente, antes, ahora) {
  const previos = new Map((antes ?? []).map((t) => [t.id, (t.usedBy ?? []).length]))
  for (const llave of ahora ?? []) {
    const tenia = previos.get(llave.id) ?? 0
    const usos = llave.usedBy ?? []
    for (const uso of usos.slice(tenia)) {
      await cliente.query(
        'INSERT INTO token_uses (id, token_id, used_at, used_by) VALUES (gen_random_uuid(), $1, $2, $3)',
        [llave.id, cuando(uso.at), uuid(uso.by)],
      )
    }
  }
}

export { TABLAS, LLAVES, DICCIONARIOS, ORDEN }
