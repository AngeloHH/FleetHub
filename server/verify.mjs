// El SMS, cuando lo entrega Twilio Verify.
//
// Es el único sitio del producto donde el código no es nuestro. Twilio lo
// genera, lo manda y lo comprueba; aquí sólo se le pregunta. Es el precio de
// no pasar por el registro 10DLC: la responsabilidad ante las operadoras la
// pone Twilio con sus propios números, y con ella se lleva el control del
// código.
//
// Lo que se pierde respecto al nuestro está dicho para que no sorprenda: los
// intentos, la caducidad y la comprobación pasan a ser suyos. Lo que no se
// pierde es el rastro: la fila del código se queda, marcada como delegada y
// sin derivado que valga, y se le apunta el uso cuando Twilio aprueba. Así un
// acceso por SMS se audita igual que uno por correo — ver `delegate` y
// `spendDelegated` en codes.mjs. El correo sigue siendo nuestro de principio
// a fin.
//
// Este módulo no sabe de HTTP ni habla español: devuelve razones de máquina.

const clean = (value) => String(value ?? '').trim()

/** Los idiomas que Verify entiende, con el nuestro traducido a los suyos. */
const LOCALE = { es: 'es', en: 'en' }

/**
 * El puente con Verify, o `null` si no está configurado.
 *
 * `null` importa: significa que no hay canal de SMS, y quien llama entonces
 * entrega por correo en lugar de fingir que lo intentó.
 */
export function twilioVerifier({
  accountSid = process.env.TWILIO_ACCOUNT_SID,
  keySid = process.env.TWILIO_API_KEY_SID || process.env.TWILIO_ACCOUNT_SID,
  keySecret = process.env.TWILIO_API_KEY_SECRET || process.env.TWILIO_AUTH_TOKEN,
  serviceSid = process.env.TWILIO_VERIFY_SERVICE_SID,
  fetcher = globalThis.fetch,
  timeout = 12_000,
} = {}) {
  const user = clean(keySid)
  const secret = clean(keySecret)
  const service = clean(serviceSid)
  if (!clean(accountSid) || !user || !secret || !service) return null

  const authorization = `Basic ${Buffer.from(`${user}:${secret}`).toString('base64')}`
  const at = (path) => `https://verify.twilio.com/v2/Services/${encodeURIComponent(service)}/${path}`

  const post = async (path, form) => {
    try {
      const response = await fetcher(at(path), {
        method: 'POST',
        headers: { authorization, 'content-type': 'application/x-www-form-urlencoded' },
        body: form,
        signal: AbortSignal.timeout(timeout),
      })
      const body = await response.json().catch(() => ({}))
      return { status: response.status, ok: response.ok, body }
    } catch (error) {
      return { status: 0, ok: false, body: {}, thrown: String(error?.message ?? error) }
    }
  }

  return {
    /** Pide a Twilio que genere y mande un código. `to` va en E.164. */
    async start({ to, language } = {}) {
      const destination = clean(to)
      if (!destination) return { ok: false, error: 'NO_DESTINATION' }
      const form = new URLSearchParams({ To: destination, Channel: 'sms' })
      const locale = LOCALE[clean(language).toLowerCase()]
      if (locale) form.set('Locale', locale)
      const sent = await post('Verifications', form)
      if (!sent.ok) return { ok: false, error: `VERIFY_${sent.status || 'UNREACHABLE'}` }
      return { ok: true, sid: sent.body.sid, status: sent.body.status }
    },

    /**
     * Comprueba lo que tecleó la persona.
     *
     * Tres respuestas y no dos: aprobado, rechazado, o «aquí no hay ninguna
     * verificación pendiente para este número». La tercera es la que permite
     * que quien llama siga preguntando a nuestro propio sistema — el código
     * pudo haber salido por correo.
     */
    async check({ to, code } = {}) {
      const destination = clean(to)
      const typed = clean(code)
      if (!destination || !typed) return { ok: false, pending: false, error: 'INCOMPLETE' }
      const seen = await post('VerificationCheck', new URLSearchParams({ To: destination, Code: typed }))
      // Twilio contesta 404 cuando no hay verificación viva para ese número:
      // no es un fallo, es que esto no va con él.
      if (seen.status === 404) return { ok: false, pending: false, error: 'NOT_FOUND' }
      if (!seen.ok) return { ok: false, pending: false, error: `VERIFY_${seen.status || 'UNREACHABLE'}` }
      if (seen.body.status === 'approved') return { ok: true }
      return { ok: false, pending: true, error: 'INVALID_CODE' }
    },
  }
}
