// Una URL para generar y obtener tokens. Todos los tokens.
//
// Cada credencial comparte esta puerta. El propósito decide su plazo, forma y
// permisos sin repartir generadores y verificadores por varias rutas.
//
// Aquí hay una dirección: /api/tokens. POST genera, GET obtiene. Lo que
// cambia de un token a otro es su propósito, y el propósito es un dato del
// cuerpo, no un trozo de la ruta.
//
// El código nunca viaja en la URL. Es material de autenticación y las rutas
// acaban en los registros del servidor, en la cabecera Referer y en el
// historial del navegador; el cuerpo de un POST no acaba en ninguno de los
// tres. Por eso canjear y revocar son POST aunque «parezcan» otra cosa.
//
// La clase Codes no sabe de HTTP y así se queda: aquí está lo que es de HTTP
// — quién puede pedir qué, qué status corresponde a cada negativa y qué lee
// el operador en su idioma. La regla de los códigos sigue en codes.mjs.

import { Codes, PURPOSE, TIER } from './codes.mjs'
import { can, identityFor } from './resources.mjs'
import { tierOf } from './users.mjs'
import { sameCompany } from './company.mjs'
import { isStaff } from './staff.mjs'

export const isTokens = (path) => path === '/api/tokens'

/** El propósito que además es una sesión: no lo emite Codes, lo emite el login. */
const SESSION = 'SESSION'

/**
 * Quién puede pedir cada propósito.
 *
 * Esto es lo que la ruta dejaba de decir al fundirse en una sola: cuando cada
 * cosa tenía su dirección, el permiso podía leerse en el path. Ahora se lee
 * aquí, que es el único sitio donde puede estar sin repetirse.
 *
 * `null` es abierto de verdad, y lo es por definición: quien pide un código
 * para entrar todavía no tiene con qué demostrar quién es.
 */
const WHO = {
  [SESSION]: null,
  [PURPOSE.SIGN_IN]: null,
  [PURPOSE.REGISTER]: null,
  [PURPOSE.PASSWORD_RESET]: null,
  [PURPOSE.INVITE]: 'usuario.editar',
}

/** Con las rondas de un secreto real, para que fallar cueste lo mismo exista o no la cuenta. */
const NOBODY = '$pbkdf2-sha256$i=100000$c2luLWN1ZW50YQ$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'

/** Los propósitos dirigidos a una persona: piden destinatario y se guardan hasheados. */
const ADDRESSED = new Set([PURPOSE.SIGN_IN, PURPOSE.REGISTER, PURPOSE.PASSWORD_RESET])

/** El nivel y el rol son el mismo hecho contado dos veces. Aquí se traducen. */
const ROLE_OF = { [TIER.NONE]: 'VISITANTE', [TIER.OPERATOR]: 'OPERADOR', [TIER.ADMIN]: 'ADMINISTRADOR' }
/**
 * El token que describe una sesión.
 *
 * La fila guarda el rol como nivel, que es lo que viaja en `tier`; `role` sale
 * con el nombre porque es lo que lee el frontend desde el primer día. Se dice
 * una vez porque hay dos salidas —código y contraseña— y separadas se
 * desincronizan.
 */
const sessionToken = (who) => {
  const tier = tierOf(who.role) ?? TIER.NONE
  return { purpose: SESSION, userId: who.id, tier, role: ROLE_OF[tier] }
}
const TIER_OF = { VISITANTE: TIER.NONE, OPERADOR: TIER.OPERATOR, ADMINISTRADOR: TIER.ADMIN }

/** Cada negativa de Codes, con el status que le toca y lo que se lee en pantalla. */
const SAYS = {
  UNKNOWN: [404, 'ESE CÓDIGO NO EXISTE'],
  UNKNOWN_PURPOSE: [400, 'ESE PROPÓSITO NO EXISTE'],
  WRONG_PURPOSE: [400, 'ESE CÓDIGO NO ES PARA ESTO'],
  INVALID_CODE: [401, 'CÓDIGO INCORRECTO'],
  INVALID_TIER: [400, 'ESE NIVEL NO EXISTE'],
  INVALID_FORMAT: [400, 'ESA FORMA NO EXISTE'],
  INVALID_REQUESTED_CODE: [400, 'ESE CÓDIGO NO TIENE LA FORMA CORRECTA'],
  CODE_TAKEN: [409, 'ESE CÓDIGO YA EXISTE'],
  ADDRESSEE_REQUIRED: [400, 'FALTA A QUIÉN VA'],
  EXPIRED: [410, 'ESE CÓDIGO YA NO VALE · PIDE OTRO'],
  BURNED: [410, 'ESE CÓDIGO YA NO VALE · PIDE OTRO'],
  USED: [409, 'ESA LLAVE YA SE GASTÓ'],
  REVOKED: [409, 'ESA LLAVE ESTÁ RETIRADA'],
  CLAIMED: [409, 'ESE REGISTRO YA SE COMPLETÓ'],
}

const ok = (value) => ({ status: 200, body: { ok: true, ...value } })
const no = (status, error, message) => ({ status, body: { ok: false, error, message } })
const from = (error) => {
  const [status, message] = SAYS[error] ?? [400, 'NO SE PUDO']
  return no(status, error, message)
}

/**
 * Responde /api/tokens.
 *
 * `at` es la sesión ya verificada, o null: a diferencia de los recursos, aquí
 * no tenerla es lo normal — pedir un código para entrar es lo que hace quien
 * todavía no ha entrado.
 *
 * `deps` trae lo que es del servidor y no de este módulo: el almacén, cómo se
 * comprueba una contraseña, cómo se concede una sesión y cómo se guarda.
 */
export async function tokens(method, query, at, deps) {
  const {
    rows, table, readBody, save, memberOf, matches, grantSession,
    deliverCode, verifier, exposeAuthCodes = true,
  } = deps
  const codes = new Codes(table, { save })
  // La misma identidad efectiva que los recursos: con una ventana de
  // soporte abierta, la sesión emite llaves de la empresa que visita.
  const me = at ? identityFor(rows, at) : null

  if (method === 'GET') return obtain(codes, query, at, me)
  if (method === 'POST') return generate(codes, await readBody(), at, me, {
    rows, memberOf, matches, grantSession, deliverCode, verifier, exposeAuthCodes,
  })
  return null
}

// ── Obtener ───────────────────────────────────────────────────────────────────

/**
 * Lo emitido. Sólo lo de tu empresa, y sólo si administras personas: una lista
 * de llaves vivas es una lista de puertas abiertas.
 *
 * Los dirigidos a una persona salen con `code: null`. No es una omisión: se
 * guardan hasheados y su texto plano existió una vez, en la respuesta que los
 * creó. Enseñarlos aquí sería regalar la llave a quien ya está dentro.
 */
function obtain(codes, query, at, me) {
  if (!at) return no(401, 'UNAUTHORIZED', 'SESIÓN NO VÁLIDA')
  if (!can(me, 'usuario.editar')) return no(403, 'FORBIDDEN', 'NO TIENES PERMISO PARA ESTO')

  const one = query.get('code')
  if (one) {
    const row = codes.get(one)
    if (!row || !sameCompany(row.companyId, me.companyId)) return from('UNKNOWN')
    return ok({ token: row })
  }

  const purpose = query.get('purpose') ?? undefined
  if (purpose && !(purpose in WHO)) return from('UNKNOWN_PURPOSE')
  const live = query.has('live') ? query.get('live') !== 'false' : undefined
  return ok({
    tokens: codes.list({ purpose, live }).filter((row) => sameCompany(row.companyId, me.companyId)),
  })
}

// ── Generar ───────────────────────────────────────────────────────────────────

/**
 * Emite uno. `purpose` dice cuál, y con él vienen el plazo, la forma y el tope
 * de usos — todo eso es de RULES, en codes.mjs, y aquí no se repite.
 *
 * Cuatro acciones más comparten la puerta porque comparten el objeto: canjear
 * un código, retirarlo y mirarlo sin gastarlo son cosas que se le hacen a un
 * token, no cosas que merezcan una dirección propia.
 */
async function generate(codes, sent, at, me, ctx) {
  const action = String(sent?.action ?? 'create')
  if (action === 'verify') return look(codes, sent)
  if (action === 'spend') return spend(codes, sent, at, me)
  if (action === 'revoke') return revoke(codes, sent, at, me)
  if (action !== 'create') return no(400, 'UNKNOWN_ACTION', 'ESA ACCIÓN NO EXISTE')

  const purpose = String(sent?.purpose ?? '')
  if (!(purpose in WHO)) return from('UNKNOWN_PURPOSE')

  // El permiso, antes que nada: lo que no puedes pedir no llega a fabricarse.
  const needs = WHO[purpose]
  if (needs) {
    if (!at) return no(401, 'UNAUTHORIZED', 'SESIÓN NO VÁLIDA')
    if (!can(me, needs)) return no(403, 'FORBIDDEN', 'NO TIENES PERMISO PARA ESTO')
  }

  if (purpose === SESSION) return await session(sent, codes, ctx)

  const addressedUser =
    (purpose === PURPOSE.SIGN_IN || purpose === PURPOSE.PASSWORD_RESET) && (sent.email || sent.phone)
      ? ctx.memberOf(sent.email ? { email: sent.email } : { phone: sent.phone })
      : null

  const made = codes.create({
    purpose,
    tier: sent.tier ?? (sent.role ? TIER_OF[sent.role] : undefined),
    createdBy: at?.userId ?? null,
    companyId: purpose === PURPOSE.INVITE ? me?.companyId : undefined,
    addressee: sent.addressee,
    code: sent.code,
  })

  // Un destinatario sin cuenta recibe la misma respuesta que uno con ella. La
  // alternativa —"no encontramos esa cuenta"— convierte esta puerta en un
  // detector de correos registrados para quien quiera probarlos en tandas.
  if (!made.ok && made.error === 'ADDRESSEE_REQUIRED') return from(made.error)
  if (!made.ok) return from(made.error)

  if (ADDRESSED.has(purpose)) {
    const addressee = sent.addressee
    const retire = () => codes.revoke(made.code, { addressee })
    if (!ctx.deliverCode && !ctx.exposeAuthCodes) {
      retire()
      return no(503, 'CODE_DELIVERY_NOT_CONFIGURED', 'EL ENVÍO DE CÓDIGOS NO ESTÁ CONFIGURADO')
    }
    // Se intenta por donde pidió y se cae al correo si eso no sale.
    //
    // Quien se identifica por teléfono espera un SMS, pero mientras no haya
    // canal de SMS lo útil es que el código llegue igual: la cuenta ya tiene
    // correo, y un código que llega por otra puerta sirve más que uno que no
    // llega. El día que el SMS exista, el primer intento deja de fallar y
    // esto no cambia.
    //
    // El teléfono llega como número nacional a secas y con eso no se puede
    // marcar; el prefijo está en la fila de la cuenta y no en la petición.
    const wanted = sent.phone && !sent.email ? 'sms' : 'email'
    const dialable = addressedUser?.phoneCode && addressedUser?.phone
      ? `${addressedUser.phoneCode}${addressedUser.phone}`
      : ''

    // El SMS lo entrega Twilio Verify, que además genera su propio código. El
    // nuestro deja de abrir nada, pero la fila se queda: es lo que hace que un
    // acceso por SMS deje el mismo rastro que uno por correo. Se le quita el
    // derivado para que no queden dos llaves vivas, y se marca de quién es.
    if (wanted === 'sms' && ctx.verifier && dialable) {
      const started = await ctx.verifier.start({ to: dialable, language: addressedUser?.language })
      if (started.ok) {
        codes.delegate(made.code, { addressee, to: 'twilio-verify' })
        return ok({
          token: made.row,
          addressed: true,
          ...(addressedUser?.fullName ? { name: addressedUser.fullName } : {}),
        })
      }
    }

    const attempts = []
    if (wanted === 'sms' && !ctx.verifier && dialable)
      attempts.push({ channel: 'sms', to: dialable })
    // El correo puede venir de tres sitios: el que se tecleó, el destinatario
    // cuando es una dirección —el alta llega así, sin cuenta todavía— o la
    // fila de la cuenta cuando quien pide se identificó por teléfono.
    const typed = String(sent.email ?? '').trim()
    const asAddress = String(addressee ?? '').includes('@') ? String(addressee).trim() : ''
    const mailbox = typed || asAddress || String(addressedUser?.email ?? '').trim()
    if (mailbox) attempts.push({ channel: 'email', to: mailbox })

    if (ctx.deliverCode && attempts.length) {
      let delivered = null
      for (const attempt of attempts) {
        delivered = await ctx.deliverCode({
          ...attempt,
          addressee,
          purpose,
          code: made.code,
          expiresAt: made.row.expiresAt,
          language: addressedUser?.language,
          name: addressedUser?.fullName,
        })
        if (delivered?.ok) break
      }
      if (!delivered?.ok) {
        retire()
        return no(502, 'CODE_DELIVERY_FAILED', 'NO SE PUDO ENVIAR EL CÓDIGO')
      }
    } else if (ctx.deliverCode) {
      // Un destinatario sin cuenta detrás: no hay a dónde mandarlo. Se retira
      // el código y se contesta que sí, porque «no encontramos esa cuenta»
      // convierte esta puerta en un detector de correos y teléfonos dados de
      // alta. Por lo mismo, la respuesta no dice por dónde salió.
      retire()
    }
  }

  return ok({
    // El texto plano existe aquí y no vuelve a existir. Los dirigidos ya no
    // saldrán por GET; los demás sí, porque alguien tiene que releerlos.
    ...(!ADDRESSED.has(purpose) || ctx.exposeAuthCodes ? { code: made.code } : {}),
    token: made.row,
    ...(ADDRESSED.has(purpose) ? { addressed: true } : {}),
    ...(addressedUser?.fullName ? { name: addressedUser.fullName } : {}),
  })
}

/**
 * Un token de sesión: lo que se cambia por una contraseña o por un código.
 *
 * Es el único propósito que no fabrica Codes, porque una sesión no es una
 * llave que alguien teclea — es lo que se recibe por haber tecleado una.
 */
async function session(sent, codes, { rows, memberOf, matches, grantSession, verifier }) {
  if (!rows) return no(409, 'EMPTY', 'SIN DATOS EN EL SERVIDOR')
  const identity = sent.email ? { email: sent.email } : { phone: sent.phone }
  const addressee = sent.email ?? sent.phone
  const who = memberOf(identity)

  if (sent.code !== undefined) {
    // Quien confirma conoce el flujo que inició. Probar dos propósitos ante un
    // fallo cobraría dos intentos si ambos estuvieran pendientes.
    const source = sent.codePurpose ?? PURPOSE.SIGN_IN
    if (source !== PURPOSE.SIGN_IN && source !== PURPOSE.PASSWORD_RESET)
      return from('UNKNOWN_PURPOSE')

    // Si se identificó por teléfono, el código puede ser de Twilio. Se le
    // pregunta primero; su «aquí no hay nada pendiente» deja seguir hacia
    // nuestra tabla, porque el código pudo haber salido por correo.
    const dialable = sent.phone && who?.phoneCode && who?.phone
      ? `${who.phoneCode}${who.phone}`
      : ''
    if (verifier && dialable) {
      const seen = await verifier.check({ to: dialable, code: sent.code })
      if (seen.ok) {
        if (who.suspension === 'admin') return no(403, 'ACCOUNT_SUSPENDED', 'CUENTA SUSPENDIDA')
        // Twilio ya dijo que sí; aquí sólo queda dejarlo escrito, en la misma
        // fila y con la misma forma que un acceso por correo.
        codes.spendDelegated({ addressee, purpose: source, by: who.id })
        return ok({
          code: grantSession(who, { passwordReset: source === PURPOSE.PASSWORD_RESET }),
          token: sessionToken(who),
        })
      }
      if (seen.pending) return from('INVALID_CODE')
    }
    const spent = codes.spend(sent.code, {
      purpose: source,
      addressee,
      by: who?.id,
    })
    if (!spent.ok) return from(spent.error)
    if (!who) return no(404, 'ACCOUNT_NOT_FOUND', 'NO ENCONTRAMOS ESA CUENTA')
  } else {
    // Derivar aunque no haya nadie: «no existe» no debe contestar antes que
    // «contraseña incorrecta», o el tiempo de respuesta delata las cuentas.
    // El secreto de mentira lleva las rondas de uno de verdad — con `null`,
    // `matches` cortocircuita y no derivaría nada, que es justo lo que se
    // quiere evitar.
    const good = who
      ? matches(String(sent.password ?? ''), who.password)
      : (matches(String(sent.password ?? ''), NOBODY), false)
    if (!who || !good) return no(401, 'INVALID_CREDENTIALS', 'CORREO O CONTRASEÑA INCORRECTOS')
  }

  if (who.suspension === 'admin') return no(403, 'ACCOUNT_SUSPENDED', 'CUENTA SUSPENDIDA')

  const token = grantSession(who, {
    passwordReset: sent.code !== undefined && sent.codePurpose === PURPOSE.PASSWORD_RESET,
  })
  return ok({
    code: token,
    token: sessionToken(who),
  })
}

/** Mirar sin gastar: lo que llama el formulario mientras se teclean las seis casillas. */
function look(codes, sent) {
  const seen = codes.verify(sent.code, { purpose: sent.purpose || undefined, addressee: sent.addressee })
  return seen.ok ? ok({ token: seen.row }) : from(seen.error)
}

/** Gastarlo. Quien lo gasta queda apuntado, y de eso vive el historial de altas. */
function spend(codes, sent, at, me) {
  if (sent.purpose === PURPOSE.INVITE && !at)
    return no(401, 'UNAUTHORIZED', 'SESIÓN NO VÁLIDA')
  if (sent.tier === TIER.SUPPORT) {
    if (!isStaff(me)) return no(403, 'FORBIDDEN', 'ESTE ACCESO ES SOLO PARA CUENTAS DE FLEETHUB')
  }
  if (sent.purpose === PURPOSE.REGISTER) {
    const reserved = codes.reserveRegistration(sent.code, { addressee: sent.addressee })
    return reserved.ok
      ? ok({ registrationToken: reserved.receipt, token: reserved.row })
      : from(reserved.error)
  }
  const seen = codes.verify(sent.code, {
    purpose: sent.purpose || undefined,
    addressee: sent.addressee,
  })
  if (!seen.ok) return from(seen.error)
  if (sent.tier !== undefined && seen.row.tier !== sent.tier) return from('INVALID_TIER')
  const spent = codes.spend(sent.code, {
    purpose: sent.purpose || undefined,
    addressee: sent.addressee,
    by: sent.by ?? at?.userId ?? null,
  })
  return spent.ok ? ok({ token: spent.row }) : from(spent.error)
}

/** Retirarlo antes de que nadie llegue a él. Sólo el que administra personas. */
function revoke(codes, sent, at, me) {
  if (!at) return no(401, 'UNAUTHORIZED', 'SESIÓN NO VÁLIDA')
  if (!can(me, 'usuario.editar')) return no(403, 'FORBIDDEN', 'NO TIENES PERMISO PARA ESTO')
  const row = codes.get(sent.code)
  if (!row) return from('UNKNOWN')
  if (!sameCompany(row.companyId, me.companyId)) return from('UNKNOWN')
  const gone = codes.revoke(sent.code, { by: at.userId })
  return gone.ok ? ok({ token: gone.row }) : from(gone.error)
}

export { PURPOSE, TIER, ROLE_OF, WHO }
