// Las cuentas: una clase, una tabla, una forma de nacer.
//
// Un usuario se creaba en tres sitios que no se conocían — el alta con llave,
// la fundación de una empresa y la semilla — y cada uno armaba la fila a mano,
// con su propio derivado de contraseña y sus propios ids. Tres formas de nacer
// son tres formas de nacer mal.
//
// Aquí sólo hay una. Lo que entra se valida antes de existir; lo que sale no
// lleva contraseña nunca, porque `view` es el único camino de salida.
//
// La contraseña se guarda en formato PHC — `$pbkdf2-sha256$i=…$sal$hash` —,
// que es una cadena y no un objeto: el algoritmo, el coste y la sal viajan
// dentro del propio valor. Eso es lo que permite subir el coste sin migrar
// nada, porque cada fila dice con qué se derivó la suya.
//
// Esta clase no sabe de HTTP y no habla español: devuelve razones de máquina
// (`EMAIL_TAKEN`, `INVALID_PHONE`…) y quien la llama decide qué status y qué
// texto lee el operador.

import { pbkdf2Sync, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { isStaff } from './staff.mjs'

/**
 * Los roles, en orden de privilegio. La posición **es** el nivel.
 *
 * Guardado se escribe el número —0, 1, 2— porque una columna de enteros es lo
 * que pidió la base de datos y porque el orden es un hecho del dominio: quien
 * administra puede lo que puede quien opera. Lo que sale por la API sigue
 * siendo el nombre, que es lo que leen las pantallas y lo que viaja en el
 * contrato desde el primer día.
 *
 * El nivel 3 de `TIER` no está aquí a propósito: soporte no es un rol que se
 * conceda a una cuenta, es una ventana temporal — ver grants.mjs.
 */
export const ROLES = ['VISITANTE', 'OPERADOR', 'ADMINISTRADOR']

/** El nivel de un rol, venga como nombre o como número. `null` si no es ninguno. */
export function tierOf(role) {
  if (typeof role === 'number') return ROLES[role] === undefined ? null : role
  const named = ROLES.indexOf(clean(role).toUpperCase())
  return named < 0 ? null : named
}

/** El nombre de un nivel, que es lo único que sale de aquí hacia fuera. */
export const roleOf = (tier) => ROLES[tier] ?? ROLES[0]

const ALGO = 'pbkdf2-sha256'
const ROUNDS = 100_000
const KEYLEN = 32
/** Ocho es el suelo, no la recomendación: por debajo no se guarda. */
const MIN_PASSWORD = 8
/** Un PHC válido que obliga a derivar aunque la cuenta no exista. */
const NOBODY = '$pbkdf2-sha256$i=100000$c2luLWN1ZW50YQ$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'

/**
 * Lo que hace aceptable una contraseña, una regla por línea.
 *
 * Es una tabla de expresiones regulares y nada más, porque las cuatro son
 * preguntas sobre la forma del texto y eso es exactamente lo que una regex
 * responde. La lista se recorre entera aunque la primera falle: quien la
 * teclea quiere ver de una vez todo lo que le falta, no descubrirlo de uno
 * en uno.
 *
 * Los nombres son de máquina. Lo que se lee en pantalla lo pone quien llama,
 * en el idioma de quien mira — esta clase no habla español.
 *
 * Sobre las banderas:
 *
 *  · `u` hace que `.` cuente un punto de código y no media pareja sustituta,
 *    así que un emoji cuenta como uno. Sin ella, «🔑» valdría por dos.
 *  · `s` hace que `.` acepte también el salto de línea, que en una contraseña
 *    pegada desde un gestor es un carácter como cualquier otro.
 *  · `\p{Lu}` es cualquier mayúscula del mundo, no sólo `A-Z`: con `[A-Z]`,
 *    «Ñandú» y «Ópera» no tendrían mayúscula.
 *  · `\p{Nd}` es cualquier dígito decimal. Con anclas y `+`, la regla
 *    `only-digits` reconoce una contraseña formada exclusivamente por ellos;
 *    como está en `reject`, que coincida es precisamente lo que la invalida.
 */
export const PASSWORD_RULES = {
  'min-length': new RegExp(`.{${MIN_PASSWORD},}`, 'su'),
  uppercase: /\p{Lu}/u,
  digit: /\p{Nd}/u,
  'only-digits': /^\p{Nd}+$/u,
}

/** Reglas cuya coincidencia invalida la contraseña, en vez de validarla. */
const REJECT = new Set(['only-digits'])

/**
 * Comprueba una contraseña y devuelve solamente los nombres de las reglas que
 * fallan. Las reglas de `REJECT` fallan cuando coinciden; las demás, cuando no.
 */
export function checkPassword(password) {
  const typed = String(password ?? '')
  const failed = []
  for (const [rule, re] of Object.entries(PASSWORD_RULES)) {
    const matched = re.test(typed)
    if (REJECT.has(rule) ? matched : !matched) failed.push(rule)
  }
  return { failed }
}

/**
 * El contrato de validación que comparte la API con el frontend.
 *
 * Las expresiones viajan como `/patrón/banderas`, porque reconstruirlas sin
 * sus banderas cambiaría su significado. `reject` nombra las expresiones cuya
 * coincidencia debe rechazarse; todas las demás tienen que coincidir.
 */
export function passwordRules() {
  const rules = {}
  for (const [rule, re] of Object.entries(PASSWORD_RULES)) rules[rule] = String(re)
  return { rules, reject: [...REJECT] }
}

/** Entra cuando no falla ninguna. */
const accepted = ({ failed }) => failed.length === 0

// ── La contraseña, tal como se deja guardar ─────────────────────────────────

const b64 = (buf) => buf.toString('base64').replace(/=+$/, '')

/**
 * Deriva y empaqueta en una sola cadena.
 *
 * La sal es nueva en cada llamada: dos personas con la misma contraseña no
 * pueden tener el mismo valor guardado, o una tabla robada se resuelve una vez
 * y sirve para todas.
 */
export function seal(password, rounds = ROUNDS) {
  const salt = randomBytes(16)
  const hash = pbkdf2Sync(password, salt, rounds, KEYLEN, 'sha256')
  return `$${ALGO}$i=${rounds}$${b64(salt)}$${b64(hash)}`
}

/**
 * Comprueba una contraseña contra lo guardado.
 *
 * Las rondas salen de la propia cadena, no de la constante de arriba: una fila
 * escrita cuando el coste era menor sigue verificando con el suyo.
 *
 * La comparación es en tiempo constante. Con `===`, el tiempo que tarda en
 * decir que no depende de cuántos bytes acertó, y eso se puede medir.
 */
export function matches(password, stored) {
  const parts = String(stored ?? '').split('$')
  if (parts.length !== 5 || parts[1] !== ALGO) return false
  const rounds = Number(parts[2].replace(/^i=/, ''))
  if (!Number.isInteger(rounds) || rounds < 1) return false
  const salt = Buffer.from(parts[3], 'base64')
  const hash = Buffer.from(parts[4], 'base64')
  if (!hash.length) return false
  const got = pbkdf2Sync(String(password ?? ''), salt, rounds, hash.length, 'sha256')
  return timingSafeEqual(got, hash)
}

// ── Lo que se acepta ────────────────────────────────────────────────────────

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/**
 * El prefijo del país, aparte del número.
 *
 * Van en dos llaves y no en una porque son dos hechos distintos: la pantalla
 * los pide por separado — un selector y un campo — y agrupar el número para
 * leerlo depende del prefijo, no del número. Pegados en un E.164 habría que
 * volver a separarlos para pintarlos, y separarlos bien no es cortar por una
 * posición fija: hay prefijos de uno, dos y tres dígitos, y +1 lo comparten
 * veinte países. Lo que llega separado no hay que adivinarlo.
 */
const PHONE_CODE = /^\+[1-9]\d{0,3}$/
/** El número nacional, sólo dígitos: el prefijo ya está en su propia llave. */
const PHONE = /^\d{4,14}$/
/** E.164 no admite más de quince dígitos contando el prefijo. */
const E164_DIGITS = 15
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
/**
 * Los idiomas que la app habla, en ISO 639-1.
 *
 * Es una lista y no una forma — `/^[a-z]{2}$/` — porque con la forma sola
 * «MX» pasa: en minúsculas es «mx», que tiene pinta de idioma y es un país.
 * Ese es exactamente el error que este campo viene a corregir, así que dejarlo
 * entrar por la puerta de atrás no valdría de nada.
 *
 * Añadir uno aquí es añadir una traducción; si no está traducido, no está.
 */
export const LANGUAGES = ['es', 'en']

const clean = (s) => String(s ?? '').trim()
const lowEmail = (s) => clean(s).toLowerCase()
const digits = (s) => clean(s).replace(/\D/g, '')

/**
 * Comprueba el par prefijo/número y lo devuelve limpio.
 *
 * Los dos a la vez, y no cada uno por su lado, porque el tope de quince
 * dígitos de E.164 es de la suma: ni el prefijo ni el número lo pasan solos.
 */
function checkPhone(phoneCode, phone) {
  const code = clean(phoneCode)
  if (!PHONE_CODE.test(code)) return { ok: false, error: 'INVALID_PHONE_CODE' }
  const number = clean(phone)
  if (!PHONE.test(number)) return { ok: false, error: 'INVALID_PHONE' }
  if (code.length - 1 + number.length > E164_DIGITS) return { ok: false, error: 'INVALID_PHONE' }
  return { ok: true, code, number }
}

export class Users {
  /**
   * @param table  la tabla de cuentas; se muta en sitio
   * @param save   se llama después de cada escritura (opcional)
   * @param now    de dónde sale la hora, para poder probar el paso del tiempo
   */
  constructor(table, { save, now } = {}) {
    this.table = Array.isArray(table) ? table : []
    this.save = save ?? (() => {})
    this.now = now ?? (() => new Date())
  }

  // ── Crear ─────────────────────────────────────────────────────────────────

  /**
   * Da de alta una cuenta.
   *
   * Valida todo antes de escribir nada: una fila a medio hacer es peor que
   * ninguna. El orden de las comprobaciones es el de la pantalla que las pide,
   * para que el primer error que se ve sea el del primer campo que se llenó.
   *
   * Devuelve la fila pública — sin contraseña, como todo lo que sale de aquí.
   */
  create({ id, fullName, email, phoneCode, phone, language, password, role, companyId } = {}) {
    const name = clean(fullName)
    if (!name) return { ok: false, error: 'MISSING_NAME' }

    const mail = lowEmail(email)
    if (!EMAIL.test(mail)) return { ok: false, error: 'INVALID_EMAIL' }
    if (this.byEmail(mail)) return { ok: false, error: 'EMAIL_TAKEN' }

    const line = checkPhone(phoneCode, phone)
    if (!line.ok) return line
    if (this.byPhone(line.number)) return { ok: false, error: 'PHONE_TAKEN' }

    // Sin idioma no se falla: se asume el de la app. Es una preferencia, y una
    // preferencia que falta tiene respuesta, a diferencia de un correo.
    const lang = language === undefined ? 'es' : clean(language).toLowerCase()
    if (!LANGUAGES.includes(lang)) return { ok: false, error: 'INVALID_LANGUAGE' }

    const assignedTier = role === undefined ? 0 : tierOf(role)
    if (assignedTier === null) return { ok: false, error: 'INVALID_ROLE' }

    const assignedId = id === undefined ? randomUUID() : clean(id)
    if (!UUID.test(assignedId)) return { ok: false, error: 'INVALID_ID' }
    if (this.find(assignedId)) return { ok: false, error: 'ID_TAKEN' }

    const typed = String(password ?? '')
    // La negativa viaja con las cuatro reglas dentro: decir «no vale» sin
    // decir por qué obliga a adivinar, y adivinar contraseñas es el juego que
    // esto viene a evitar.
    const strength = checkPassword(typed)
    if (!accepted(strength)) return { ok: false, error: 'WEAK_PASSWORD', ...strength }

    const at = this.now().toISOString()
    const row = {
      id: assignedId,
      companyId: clean(companyId) || null,
      fullName: name,
      email: mail,
      phoneCode: line.code,
      phone: line.number,
      language: lang,
      role: assignedTier,
      suspension: null,
      createdAt: at,
      updatedAt: at,
      passwordChangedAt: at,
      password: seal(typed),
    }

    this.table.push(row)
    this.save()
    return { ok: true, user: this.view(row) }
  }

  // ── Obtener ───────────────────────────────────────────────────────────────

  /** Una cuenta por su id. Sin contraseña, como todo lo que sale. */
  get(id) {
    const row = this.find(id)
    return row ? this.view(row) : undefined
  }

  /** Todas, sin contraseña. */
  list() {
    return this.table.map((row) => this.view(row))
  }

  /**
   * Quién entra, comprobando la contraseña.
   *
   * Deriva aunque no exista la cuenta: si «no existe» contestara antes que
   * «contraseña incorrecta», el tiempo de respuesta diría cuáles de una lista
   * de correos están registrados.
   */
  verify(email, password) {
    const identity = email && typeof email === 'object' ? email : { email }
    const row = identity.email ? this.byEmail(identity.email) : this.byPhone(identity.phone)
    const good = matches(password, row?.password ?? NOBODY)
    if (!row || !good) return { ok: false, error: 'INVALID_CREDENTIALS' }
    return { ok: true, user: this.view(row) }
  }

  // ── Editar ────────────────────────────────────────────────────────────────

  /** Cambia lo que la persona puede cambiar de sí misma. */
  update(id, { fullName, email, phoneCode, phone, language, role, suspension } = {}) {
    const row = this.find(id)
    if (!row) return { ok: false, error: 'UNKNOWN' }

    // Se valida una copia completa. Un error tardío no puede dejar aplicados
    // los campos anteriores de una petición que finalmente fue rechazada.
    const next = { ...row }

    if (fullName !== undefined) {
      const name = clean(fullName)
      if (!name) return { ok: false, error: 'MISSING_NAME' }
      next.fullName = name
    }
    if (email !== undefined) {
      const mail = lowEmail(email)
      if (!EMAIL.test(mail)) return { ok: false, error: 'INVALID_EMAIL' }
      const other = this.byEmail(mail)
      if (other && other.id !== row.id) return { ok: false, error: 'EMAIL_TAKEN' }
      next.email = mail
    }
    // El prefijo y el número se comprueban juntos aunque sólo cambie uno: el
    // tope de E.164 es de la suma, y cambiar el prefijo por uno más largo
    // puede pasarse con un número que hasta ahora cabía.
    if (phoneCode !== undefined || phone !== undefined) {
      const line = checkPhone(phoneCode ?? row.phoneCode, phone ?? row.phone)
      if (!line.ok) return line
      const other = this.byPhone(line.number)
      if (other && other.id !== row.id) return { ok: false, error: 'PHONE_TAKEN' }
      next.phoneCode = line.code
      next.phone = line.number
    }
    if (language !== undefined) {
      const lang = clean(language).toLowerCase()
      if (!LANGUAGES.includes(lang)) return { ok: false, error: 'INVALID_LANGUAGE' }
      next.language = lang
    }
    if (role !== undefined) {
      const assignedTier = tierOf(role)
      if (assignedTier === null) return { ok: false, error: 'INVALID_ROLE' }
      next.role = assignedTier
    }
    if (suspension !== undefined) {
      if (suspension !== null && suspension !== 'self' && suspension !== 'admin')
        return { ok: false, error: 'INVALID_SUSPENSION' }
      next.suspension = suspension
    }

    next.updatedAt = this.now().toISOString()

    Object.assign(row, next)
    this.save()
    return { ok: true, user: this.view(row) }
  }

  /**
   * Cambia la contraseña.
   *
   * La vieja se exige siempre, salvo que se diga `reset: true` — que es lo que
   * pasa cuando se llega con un código de recuperación, la otra forma de
   * probar que la cuenta es tuya.
   *
   * Se exige por defecto y hay que pedir lo contrario a propósito: al revés,
   * olvidarse de pasar la vieja no daría error, daría una puerta abierta. Un
   * descuido tiene que costar un fallo, nunca un permiso.
   */
  setPassword(id, next, { current, reset = false } = {}) {
    const row = this.find(id)
    if (!row) return { ok: false, error: 'UNKNOWN' }
    const stored = row.password
    if (!reset && !matches(current, stored))
      return { ok: false, error: 'INVALID_CREDENTIALS' }
    const strength = checkPassword(next)
    if (!accepted(strength)) return { ok: false, error: 'WEAK_PASSWORD', ...strength }
    // La nueva igual a la vieja es no haber cambiado nada, y quien la cambia
    // suele estar cambiándola porque la anterior dejó de ser suya.
    if (matches(next, stored)) return { ok: false, error: 'SAME_PASSWORD' }
    row.password = seal(String(next))
    const changedAt = this.now().toISOString()
    row.updatedAt = changedAt
    row.passwordChangedAt = changedAt
    this.save()
    return { ok: true, user: this.view(row) }
  }

  /** Elimina la cuenta; sus ids históricos viven en los hechos que firmó. */
  remove(id) {
    const index = this.table.findIndex((row) => row.id === id)
    if (index < 0) return { ok: false, error: 'UNKNOWN' }
    this.table.splice(index, 1)
    this.save()
    return { ok: true }
  }

  // ── Lo de dentro ──────────────────────────────────────────────────────────

  /**
   * La fila tal como sale de aquí.
   *
   * Se construye nombrando lo que sí sale, no borrando lo que no. Con un
   * `delete row.password` sobre una copia, el día que se añada un campo
   * privado nuevo saldría solo; así hay que escribirlo para que salga.
   */
  view(row) {
    return {
      id: row.id,
      companyId: row.companyId ?? null,
      fullName: row.fullName,
      email: row.email,
      phoneCode: row.phoneCode,
      phone: row.phone,
      language: row.language ?? 'es',
      // No es un campo del alta: sale de la lista que opera quien despliega,
      // así que nadie puede declararse soporte al registrarse.
      staff: isStaff(row),
      // Hacia fuera, el nombre. Guardado, el número.
      role: roleOf(row.role),
      suspension: row.suspension ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      passwordChangedAt: row.passwordChangedAt ?? row.createdAt,
    }
  }

  /** Las cuatro reglas contra una contraseña, sin tocar ninguna cuenta. */
  checkPassword(password) {
    return checkPassword(password)
  }

  /** Las cuatro reglas solas, sin contraseña que comprobar. */
  passwordRules() {
    return passwordRules()
  }

  /** La fila entera, con contraseña. Interna a propósito. */
  find(id) {
    return this.table.find((row) => row.id === id)
  }

  byEmail(email) {
    const mail = lowEmail(email)
    return mail ? this.table.find((row) => row.email === mail) : undefined
  }

  byPhone(phone) {
    const number = digits(phone)
    return number ? this.table.find((row) => digits(row.phone) === number) : undefined
  }
}
