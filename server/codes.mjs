// Los códigos: uno solo, para todo.
//
// Hasta ahora había tres generadores en tres sitios distintos — el del
// navegador para fundar una empresa, el de las invitaciones y el de los
// códigos de un solo uso — con tres formas de fila y dos almacenes que no se
// conocían entre sí. Aquí hay una clase, una tabla y una regla.
//
// Lo que cambia de un propósito a otro no es la lógica: es el plazo, la forma
// (números o hexadecimal) y quién tiene derecho a pedirlo. Eso vive en RULES,
// que es una tabla de datos, no de código.
//
// Esta clase no sabe de HTTP y no habla español: devuelve razones de máquina
// (`UNKNOWN`, `EXPIRED`, `BURNED`…) y quien la llama decide qué status y qué
// texto lee el operador. Tampoco escribe en disco: muta la tabla que le dan y
// avisa por `save`.

import { createHash, pbkdf2Sync, randomBytes, randomUUID } from 'node:crypto'

/** Para qué sirve un código. Cinco, y no más. */
export const PURPOSE = {
  /** Crear una cuenta cuando ya existe el primer administrador. */
  INVITE: 'INVITE',
  /** Confirmar que una dirección es de quien dice, al registrarse. */
  REGISTER: 'REGISTER',
  /** Entrar sin contraseña. */
  SIGN_IN: 'SIGN_IN',
  /** Volver a poner contraseña habiéndola perdido. */
  PASSWORD_RESET: 'PASSWORD_RESET',
}

/**
 * Lo que se puede hacer, por niveles. El 0 no es un rol degradado: es una
 * cuenta que existe y no ve nada — lo que hoy son las suspensiones y los
 * invitados a los que aún no han dado el alta.
 *
 * El 3 no es un miembro de la empresa y nunca lo será: es soporte de FleetHub
 * entrando por una ventana con la hora de cierre ya escrita.
 */
export const TIER = { NONE: 0, OPERATOR: 1, ADMIN: 2, SUPPORT: 3 }

const TIERS = Object.values(TIER)

/** Un código dura lo que tiene sentido que dure, y no lo que dure otro. */
const HOUR = 3_600
const RULES = {
  // Nace para una sola cuenta. Si se necesita otra persona, se emite otra
  // invitación y cada alta conserva exactamente qué llave utilizó.
  INVITE: { format: 'hex', ttl: 24 * HOUR, tier: null, addressed: false, uses: 1 },
  // Los tres de un solo uso: el "CADUCA EN 9:41" que dibuja el diseño.
  REGISTER: { format: 'numeric', ttl: 581, tier: null, addressed: true, uses: 1 },
  SIGN_IN: { format: 'numeric', ttl: 581, tier: null, addressed: true, uses: 1 },
  PASSWORD_RESET: { format: 'numeric', ttl: 581, tier: null, addressed: true, uses: 1 },
}

/** Intentos antes de morir. Cinco: un dedo gordo no cuesta nada, adivinar sí. */
const TRIES = 5
const LENGTH = 6
const ROUNDS = 1_000

/** Los campos que salen de aquí. `secret` y `owner` no están, y esa es la gracia. */
const PUBLIC = [
  'code', 'purpose', 'tier',
  'createdAt', 'createdBy', 'expiresAt',
  'triesLeft', 'usedBy', 'revokedAt', 'revokedBy',
  'delegatedTo',
]

const derive = (input, salt) => pbkdf2Sync(input, salt, ROUNDS, 32, 'sha256').toString('hex')

/**
 * A quién iba, sin decir a quién iba.
 *
 * Hace falta poder dar con la fila de una persona para cobrarle el intento
 * fallido — si no, seis dígitos se adivinan tecleando —, y hace falta no
 * tener escrito su correo al lado del código. Esto es lo segundo con lo
 * primero: se puede preguntar "¿es esta la fila de esta dirección?" y no se
 * puede leer la dirección de vuelta.
 */
const addressOf = (addressee) => String(addressee).trim().toLowerCase()
const ownerOf = (addressee) => derive(addressOf(addressee), 'fleethub.owner')
const receiptOf = (receipt) => createHash('sha256').update(String(receipt ?? '')).digest('hex')

/**
 * Seis dígitos, repartidos parejo.
 *
 * 2^32 no es múltiplo de diez, así que quedarse con el resto sin descartar la
 * cola haría los dígitos bajos un pelo más probables. Cuesta nada evitarlo.
 */
function numeric() {
  const top = 2 ** 32 - (2 ** 32 % 10)
  let out = ''
  while (out.length < LENGTH) {
    const n = randomBytes(4).readUInt32BE(0)
    if (n < top) out += n % 10
  }
  return out
}

const hex = () => randomBytes(LENGTH / 2).toString('hex').toUpperCase()

export class Codes {
  /**
   * @param table  la tabla de códigos; se muta en sitio
   * @param save   se llama después de cada escritura (opcional)
   * @param now    de dónde sale la hora, para poder probar el paso del tiempo
   */
  constructor(table, { save, now } = {}) {
    this.table = Array.isArray(table) ? table : []
    this.save = save ?? (() => {})
    this.now = now ?? (() => new Date())
  }

  // ── Obtener ───────────────────────────────────────────────────────────────

  /**
   * Los códigos de una empresa, sin el derivado y con su estado calculado.
   *
   * Los de un solo uso salen con `code: null`: van dirigidos a una persona,
   * se guardan hasheados y el texto plano existió una vez, en la respuesta
   * que los creó. Enseñarlos en una lista sería regalar la llave.
   */
  list({ purpose, live } = {}) {
    return this.table
      .filter((row) => (purpose === undefined || row.purpose === purpose))
      .filter((row) => (live === undefined || (this.statusOf(row) === 'live') === live))
      .map((row) => this.view(row))
  }

  /** Uno, por su código. Sólo encuentra los que se guardan en claro. */
  get(code) {
    const row = this.find(code)
    return row ? this.view(row) : undefined
  }

  /** En qué está: es lo que se calcula, nunca lo que se guarda. */
  statusOf(row) {
    if (!row) return 'unknown'
    if (row.revokedAt) return 'revoked'
    const cap = RULES[row.purpose]?.uses ?? 1
    if ((row.usedBy?.length ?? 0) >= cap) return 'used'
    if (new Date(row.expiresAt) <= this.now()) return 'expired'
    if (row.triesLeft <= 0) return 'burned'
    return 'live'
  }

  // ── Crear ─────────────────────────────────────────────────────────────────

  /**
   * Emite uno. Devuelve la fila pública y, aparte, el código en claro: es la
   * única vez que existe si va dirigido a alguien.
   *
   * `addressee` es el correo o el teléfono al que se manda. No se guarda —
   * se hashea junto al código, de modo que el código sin su destinatario no
   * abre nada y aquí no queda escrito a quién se le mandó.
   */
  create({ purpose, tier, createdBy, companyId, addressee, format, code: requested } = {}) {
    const rule = RULES[purpose]
    if (!rule) return { ok: false, error: 'UNKNOWN_PURPOSE' }
    if (rule.addressed && !addressee) return { ok: false, error: 'ADDRESSEE_REQUIRED' }

    const level = rule.tier ?? tier ?? null
    if (purpose === PURPOSE.INVITE && !TIERS.includes(level))
      return { ok: false, error: 'INVALID_TIER' }

    const shape = format ?? rule.format
    if (shape !== 'hex' && shape !== 'numeric') return { ok: false, error: 'INVALID_FORMAT' }

    const at = this.now()
    const address = rule.addressed ? addressOf(addressee) : null

    // Una dirección sólo puede tener una prueba pendiente. Reenviar retira la
    // anterior para que nunca haya dos códigos válidos para la misma persona.
    if (address) {
      const owner = ownerOf(address)
      for (const previous of this.table) {
        if (previous.owner === owner && this.statusOf(previous) === 'live') {
          previous.revokedAt = at.toISOString()
          previous.revokedBy = createdBy ?? null
        }
      }
    }
    const wanted = String(requested ?? '').toUpperCase()
    const validWanted = shape === 'numeric' ? /^\d{6}$/.test(wanted) : /^[0-9A-F]{6}$/.test(wanted)
    if (requested !== undefined && (!validWanted || rule.addressed))
      return { ok: false, error: 'INVALID_REQUESTED_CODE' }
    if (wanted && this.table.some((row) => row.code === wanted))
      return { ok: false, error: 'CODE_TAKEN' }

    let code = wanted
    if (!code) {
      do {
        code = shape === 'numeric' ? numeric() : hex()
      } while (this.table.some((row) => row.code === code))
    }

    const row = {
      // La llave no tenía nombre propio: se buscaba por su código. Una tabla
      // necesita uno, y darlo aquí es lo que permite que sus usos sean filas
      // que apuntan a ella. No sale por `view` — no está en PUBLIC.
      id: randomUUID(),
      // En claro sólo los que alguien tiene que volver a leer; los dirigidos
      // a una persona viajan una vez y aquí queda su derivado.
      code: rule.addressed ? null : code,
      purpose,
      tier: level,
      createdAt: at.toISOString(),
      createdBy: createdBy ?? null,
      expiresAt: new Date(at.getTime() + rule.ttl * 1_000).toISOString(),
      triesLeft: TRIES,
      // Una lista, no una marca, porque la auditoría conserva cuándo se usó y
      // quién lo hizo aunque el propósito permita un solo uso.
      usedBy: [],
      revokedAt: null,
      revokedBy: null,
    }
    // Las invitaciones pertenecen a la compañía que recibirá al usuario. No
    // aplica a los códigos dirigidos de acceso, registro o recuperación.
    if (purpose === PURPOSE.INVITE) row.companyId = companyId ?? null
    if (rule.addressed) {
      const salt = randomUUID()
      row.owner = ownerOf(address)
      row.secret = { salt, hash: derive(`${address}:${code}`, salt) }
    }

    this.table.push(row)
    this.save()
    return { ok: true, code, row: this.view(row) }
  }

  // ── Editar ────────────────────────────────────────────────────────────────

  /**
   * Comprueba un código sin gastarlo, y cobra el intento si estaba mal.
   *
   * Mirar y gastar son dos cosas distintas a propósito: esto es lo que llama
   * el formulario mientras se teclean las seis casillas, y marcar la llave
   * como usada ahí dejaría códigos muertos cada vez que el registro que viene
   * detrás falla por cualquier otro motivo.
   */
  verify(code, { purpose, addressee } = {}) {
    const row = this.find(code, addressee)
    if (!row) {
      // Un código dirigido que no cuadra puede ser el de esta persona mal
      // tecleado: si lo es, el intento se cobra sobre el suyo.
      const mine = addressee ? this.pending(purpose, addressee) : undefined
      if (mine && this.statusOf(mine) === 'live') {
        mine.triesLeft -= 1
        this.save()
        return { ok: false, error: mine.triesLeft <= 0 ? 'BURNED' : 'INVALID_CODE' }
      }
      return { ok: false, error: 'UNKNOWN' }
    }
    const status = this.statusOf(row)
    if (status !== 'live') return { ok: false, error: status.toUpperCase() }
    if (purpose && row.purpose !== purpose) return { ok: false, error: 'WRONG_PURPOSE' }
    return { ok: true, row: this.view(row) }
  }

  /**
   * Lo gasta: apunta un uso más al final de la lista.
   *
   * Nada se sobrescribe. Un código de invitación puede dar entrada a varios
   * y de cada uno queda la hora y el UUID; los que tienen tope — fundar una
   * empresa, los de un solo uso — mueren al llegar a él, y eso lo dice
   * `statusOf`, no un campo aparte.
   */
  spend(code, { by, purpose, addressee } = {}) {
    const seen = this.verify(code, { purpose, addressee })
    if (!seen.ok) return seen
    const row = this.find(code, addressee)
    row.usedBy = [...(row.usedBy ?? []), { at: this.now().toISOString(), by: by ?? null }]
    this.save()
    return { ok: true, row: this.view(row) }
  }

  /**
   * Consume una confirmación de registro reservando la identidad que nacerá
   * después. La credencial se devuelve una sola vez y aquí sólo queda su hash.
   */
  reserveRegistration(code, { addressee } = {}) {
    const seen = this.verify(code, { purpose: PURPOSE.REGISTER, addressee })
    if (!seen.ok) return seen
    const row = this.find(code, addressee)
    const userId = randomUUID()
    const receipt = randomBytes(32).toString('base64url')
    const at = this.now().toISOString()
    row.usedBy = [...(row.usedBy ?? []), { at, by: userId }]
    row.registration = {
      userId,
      receiptHash: receiptOf(receipt),
      claimedAt: null,
    }
    this.save()
    return { ok: true, receipt, userId, row: this.view(row) }
  }

  /** La reserva que corresponde a una credencial y a su destinatario. */
  registration(receipt, { addressee } = {}) {
    const hash = receiptOf(receipt)
    const owner = ownerOf(addressee)
    const row = this.table.find(
      (candidate) =>
        candidate.purpose === PURPOSE.REGISTER &&
        candidate.owner === owner &&
        candidate.registration?.receiptHash === hash,
    )
    if (!row || !receipt) return { ok: false, error: 'UNKNOWN' }
    if (row.registration.claimedAt) return { ok: false, error: 'CLAIMED' }
    return { ok: true, userId: row.registration.userId }
  }

  /** Marca la reserva como convertida en usuario. */
  claimRegistration(receipt, { addressee } = {}) {
    const seen = this.registration(receipt, { addressee })
    if (!seen.ok) return seen
    const hash = receiptOf(receipt)
    const row = this.table.find((candidate) => candidate.registration?.receiptHash === hash)
    row.registration.claimedAt = this.now().toISOString()
    this.save()
    return { ok: true, userId: seen.userId }
  }

  /**
   * Cede el código a un proveedor externo, conservando la fila.
   *
   * Twilio Verify genera el suyo y no nos lo enseña, así que el nuestro deja
   * de servir para abrir nada — pero la fila sí sirve, y mucho: es lo que hace
   * que un acceso por SMS deje el mismo rastro que uno por correo. Cuándo se
   * pidió, a quién iba, cuándo caducaba y, después, quién lo gastó.
   *
   * El derivado se borra a propósito. Sin él, `find` no reconoce ningún código
   * contra esta fila, y así no quedan dos llaves vivas para la misma persona:
   * la de Twilio y una nuestra que nadie recibió.
   */
  delegate(code, { addressee, to } = {}) {
    const row = this.find(code, addressee)
    if (!row) return { ok: false, error: 'UNKNOWN' }
    delete row.secret
    row.code = null
    row.delegatedTo = to ?? 'external'
    this.save()
    return { ok: true, row: this.view(row) }
  }

  /**
   * Apunta el uso de un código que comprobó otro.
   *
   * No pasa por `verify` porque no hay nada que verificar de nuestro lado: el
   * proveedor ya dijo que sí. Lo que se hace aquí es dejarlo escrito.
   */
  spendDelegated({ addressee, purpose, by } = {}) {
    const owner = ownerOf(addressee)
    const row = [...this.table].reverse().find(
      (candidate) =>
        candidate.owner === owner &&
        candidate.delegatedTo &&
        (purpose === undefined || candidate.purpose === purpose) &&
        this.statusOf(candidate) === 'live',
    )
    if (!row) return { ok: false, error: 'UNKNOWN' }
    row.usedBy = [...(row.usedBy ?? []), { at: this.now().toISOString(), by: by ?? null }]
    this.save()
    return { ok: true, row: this.view(row) }
  }

  /**
   * Lo retira antes de que nadie llegue a él.
   *
   * `addressee` hace falta para los dirigidos: se guardan con `code: null` y
   * su derivado al lado, así que sin saber a quién iban no hay forma de dar
   * con la fila — y retirar uno que no se encuentra es no retirar nada.
   */
  revoke(code, { by, addressee } = {}) {
    const row = this.find(code, addressee)
    if (!row) return { ok: false, error: 'UNKNOWN' }
    const status = this.statusOf(row)
    if (status === 'used') return { ok: false, error: 'USED' }
    if (status === 'revoked') return { ok: false, error: 'REVOKED' }
    row.revokedAt = this.now().toISOString()
    row.revokedBy = by ?? null
    this.save()
    return { ok: true, row: this.view(row) }
  }

  // ── Lo de dentro ──────────────────────────────────────────────────────────

  /** La fila tal como sale de aquí: sin derivado y con su estado. */
  view(row) {
    const out = {}
    for (const key of PUBLIC) out[key] = row[key] ?? null
    if (Object.hasOwn(row, 'companyId')) out.companyId = row.companyId
    out.status = this.statusOf(row)
    return out
  }

  /**
   * La fila de un código. Los que se guardan en claro se buscan por el código;
   * los dirigidos, comparando el derivado de dirección y código — que es lo
   * que permite no tener escrito a quién iban.
   */
  find(code, addressee) {
    const typed = String(code ?? '').toUpperCase()
    if (!typed) return undefined
    const clear = this.table.find((row) => row.code === typed)
    if (clear) return clear
    if (!addressee) return undefined
    const address = addressOf(addressee)
    const owner = ownerOf(address)
    return this.table.find(
      (row) =>
        row.owner === owner &&
        row.secret &&
        derive(`${address}:${typed}`, row.secret.salt) === row.secret.hash,
    )
  }

  /** El último código vivo que se le mandó a alguien, para cobrarle el fallo. */
  pending(purpose, addressee) {
    const owner = ownerOf(addressee)
    return [...this.table]
      .reverse()
      .find(
        (row) =>
          row.owner === owner &&
          (purpose === undefined || row.purpose === purpose) &&
          this.statusOf(row) === 'live',
      )
  }
}
