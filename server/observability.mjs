// Lo que el servicio cuenta de sí mismo mientras funciona.
//
// Dos cosas distintas que suelen confundirse. Una es el registro: una línea
// JSON por hecho, a la salida estándar, que la plataforma recoge sola y que
// sirve para leer qué pasó. La otra es el aviso: una petición saliente a quien
// tenga que enterarse ahora — un error que nadie ha visto todavía, una cuota a
// punto de agotarse.
//
// Ninguna de las dos puede tumbar una petición. Un destino caído, una llave
// mal escrita o una red lenta no son motivo para devolverle un 500 a quien
// estaba guardando una foto: los avisos se mandan sin esperarlos y sus fallos
// se registran, no se propagan.
//
// Lo que sale de aquí no lleva secretos. Ni tokens de sesión, ni contraseñas,
// ni códigos de un solo uso, ni el correo entero de nadie: un registro es un
// sitio del que se copia y se pega, y lo que no está escrito no se filtra.

const clean = (value) => String(value ?? '').trim()

/** Los campos que jamás salen, se llamen como se llamen en el objeto. */
const SECRET = /^(authorization|password|token|code|secret|registrationtoken|apikey|api_key)$/i

/** Un correo se reduce a su dominio: identifica el caso sin identificar a nadie. */
const domainOf = (email) => {
  const at = clean(email).lastIndexOf('@')
  return at > 0 ? clean(email).slice(at) : ''
}

/**
 * Deja el objeto en algo que se puede escribir en un registro.
 *
 * No es una lista negra de nombres «sospechosos»: es que ninguno de esos
 * valores tiene nada que hacer aquí, así que se sustituyen por su marca en
 * lugar de omitirse — saber que había un token y no cuál es información útil.
 */
export function safeFields(fields = {}) {
  const out = {}
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue
    if (SECRET.test(key)) { out[key] = '[oculto]'; continue }
    if (key === 'email' || key === 'addressee') { out.addresseeDomain = domainOf(value); continue }
    if (value && typeof value === 'object' && !Array.isArray(value)) { out[key] = safeFields(value); continue }
    out[key] = value
  }
  return out
}

const STREAM = { error: 'error', warn: 'warn', info: 'log', debug: 'log' }
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 }

/**
 * A partir de qué nivel se escribe.
 *
 * En producción, todo desde `info`: el registro de peticiones es la mitad de
 * lo que sirve para entender un incidente. Durante las pruebas, sólo errores —
 * una suite que escupe mil líneas de JSON no es una suite que alguien lea.
 */
const threshold = () => {
  const configured = LEVELS[clean(process.env.FLEETHUB_LOG_LEVEL).toLowerCase()]
  if (configured) return configured
  return process.env.NODE_ENV === 'test' ? LEVELS.error : LEVELS.info
}

/**
 * Una línea, un hecho.
 *
 * JSON y no texto porque quien lo lee es una consulta y no una persona: en
 * cuanto hay dos instancias, «grep» deja de ser una forma de leer registros.
 */
export function log(level, event, fields = {}) {
  const line = {
    level,
    event,
    at: new Date().toISOString(),
    service: clean(process.env.FLEETHUB_SERVICE) || 'fleethub-api',
    environment: environmentName(),
    release: releaseName(),
    ...safeFields(fields),
  }
  // La línea se construye siempre aunque no se escriba: quien avisa la
  // necesita entera, y el umbral decide qué se imprime, no qué se sabe.
  if ((LEVELS[level] ?? LEVELS.info) >= threshold())
    console[STREAM[level] ?? 'log'](JSON.stringify(line))
  return line
}

export const environmentName = () =>
  clean(process.env.FLEETHUB_ENVIRONMENT) || clean(process.env.CONTEXT) || 'development'

export const releaseName = () =>
  clean(process.env.FLEETHUB_RELEASE) || clean(process.env.COMMIT_REF) || 'dev'

// ── Avisos ───────────────────────────────────────────────────────────────────

/**
 * Un DSN de Sentry, partido en lo que hace falta para hablarle.
 *
 * Se acepta el DSN entero porque es lo que el servicio entrega y lo que la
 * gente pega; partirlo aquí evita pedir cuatro variables para un solo dato.
 */
export function parseSentryDsn(dsn) {
  const value = clean(dsn)
  if (!value) return null
  try {
    const url = new URL(value)
    const project = url.pathname.replace(/^\//, '')
    if (!url.username || !project) return null
    return {
      key: url.username,
      endpoint: `${url.protocol}//${url.host}/api/${project}/envelope/`,
    }
  } catch {
    return null
  }
}

const hex = (bytes) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')

/**
 * A dónde se avisa y cómo.
 *
 * Dos destinos posibles y ninguno obligatorio: Sentry, que es donde acaban los
 * errores, y un webhook cualquiera, que es donde acaba todo lo demás — Slack,
 * una guardia, o el propio Sentry a través de un relé. Sin ninguno configurado
 * esto sigue funcionando: los hechos se registran igual y nadie recibe un
 * mensaje, que es exactamente lo que se ha pedido.
 */
export class Reporter {
  constructor({
    dsn = process.env.SENTRY_DSN,
    webhook = process.env.ALERT_WEBHOOK_URL,
    webhookToken = process.env.ALERT_WEBHOOK_TOKEN,
    fetcher = globalThis.fetch,
    timeout = 4_000,
    randomId = () => hex(crypto.getRandomValues(new Uint8Array(16))),
  } = {}) {
    this.sentry = parseSentryDsn(dsn)
    this.webhook = clean(webhook)
    this.webhookToken = clean(webhookToken)
    this.fetcher = fetcher
    this.timeout = timeout
    this.randomId = randomId
  }

  get configured() {
    return Boolean(this.sentry || this.webhook)
  }

  /** Un error que nadie ha visto todavía. Se registra siempre y se manda si hay a dónde. */
  capture(error, fields = {}) {
    const line = log('error', fields.event ?? 'unhandled_error', {
      ...fields,
      message: String(error?.message ?? error),
    })
    return this.deliver({
      ...line,
      stack: clean(error?.stack).split('\n').slice(0, 20).join('\n'),
      kind: error?.name ?? 'Error',
    })
  }

  /** Algo que conviene mirar aunque no sea un fallo: una cuota, un proveedor caído. */
  notify(event, fields = {}, level = 'warn') {
    return this.deliver(log(level, event, fields))
  }

  /**
   * Manda el aviso sin esperarlo.
   *
   * Devuelve la promesa para que las pruebas puedan esperarla, pero quien
   * atiende una petición no la espera: avisar es un efecto, no un paso.
   */
  deliver(line) {
    const sending = []
    if (this.webhook) sending.push(this.post(this.webhook, line, this.webhookToken))
    if (this.sentry && line.level === 'error') sending.push(this.postSentry(line))
    return Promise.allSettled(sending)
  }

  async post(url, body, token) {
    try {
      await this.fetcher(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeout),
      })
    } catch (error) {
      // Se registra y se queda ahí: un aviso que no sale no puede además
      // romper lo que estaba avisando.
      console.warn(JSON.stringify({
        level: 'warn', event: 'alert_delivery_failed', at: new Date().toISOString(),
        message: String(error?.message ?? error),
      }))
    }
  }

  async postSentry(line) {
    const eventId = this.randomId()
    const event = {
      event_id: eventId,
      timestamp: line.at,
      platform: 'node',
      level: 'error',
      logger: line.event,
      environment: line.environment,
      release: line.release,
      server_name: line.service,
      message: { formatted: `${line.event}: ${line.message}` },
      exception: {
        values: [{
          type: line.kind ?? 'Error',
          value: String(line.message ?? ''),
          ...(line.stack ? { stacktrace: { frames: [], raw: line.stack } } : {}),
        }],
      },
      tags: { event: line.event, ...(line.path ? { path: line.path } : {}) },
      extra: safeFields({ ...line, stack: undefined }),
    }
    const envelope = [
      JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString() }),
      JSON.stringify({ type: 'event' }),
      JSON.stringify(event),
    ].join('\n')
    try {
      await this.fetcher(this.sentry.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-sentry-envelope',
          'x-sentry-auth': `Sentry sentry_version=7, sentry_client=fleethub/1.0, sentry_key=${this.sentry.key}`,
        },
        body: envelope,
        signal: AbortSignal.timeout(this.timeout),
      })
    } catch (error) {
      console.warn(JSON.stringify({
        level: 'warn', event: 'sentry_delivery_failed', at: new Date().toISOString(),
        message: String(error?.message ?? error),
      }))
    }
  }
}
