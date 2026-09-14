// Cómo sale un código de aquí hacia el teléfono de alguien.
//
// Dos proveedores y una decisión: correo por Resend, SMS por Twilio, y el
// canal lo dice el destinatario. Nada más. Lo que decide *si* se manda, qué
// pasa si falla y quién puede pedirlo está en tokens.mjs; esto sólo sabe
// hablar con quien entrega.
//
// Un envío que falla no se reintenta aquí. Quien llama revoca el código y
// contesta que no se pudo, que es mejor que dejar viva una llave que nadie
// recibió y peor que nada sería fingir que salió.
//
// Los textos son cortos a propósito. Un SMS se corta a los 160 caracteres y
// un correo de código que hay que leer entero es un correo que se lee mal.

const clean = (value) => String(value ?? '').trim()

/** Lo que dice cada código, por propósito y por idioma. */
const SAYS = {
  es: {
    SIGN_IN: { asunto: 'Tu código para entrar', hace: 'entrar en FleetHub' },
    REGISTER: { asunto: 'Confirma tu correo', hace: 'confirmar tu correo' },
    PASSWORD_RESET: { asunto: 'Tu código para recuperar la cuenta', hace: 'volver a poner tu contraseña' },
    para: 'para',
    caduca: 'Caduca en 10 minutos. Si no lo pediste, ignora este mensaje.',
    nadie: 'FleetHub nunca te va a pedir este código por teléfono ni por mensaje.',
  },
  en: {
    SIGN_IN: { asunto: 'Your sign-in code', hace: 'sign in to FleetHub' },
    REGISTER: { asunto: 'Confirm your email', hace: 'confirm your email' },
    PASSWORD_RESET: { asunto: 'Your account recovery code', hace: 'set a new password' },
    para: 'to',
    caduca: 'It expires in 10 minutes. If you did not ask for it, ignore this message.',
    nadie: 'FleetHub will never ask you for this code by phone or message.',
  },
}

const wording = (language) => SAYS[clean(language).toLowerCase()] ?? SAYS.es

/** El texto del SMS. Cabe en un mensaje y nombra al remitente, que lo exigen las operadoras. */
export function smsBody({ code, purpose, language }) {
  const says = wording(language)
  const what = says[purpose] ?? says.SIGN_IN
  return `FleetHub: ${code} ${says.para} ${what.hace}. ${says.caduca}`
}

/** El correo, en texto y en HTML. El código en grande y poco más alrededor. */
export function emailBody({ code, purpose, language, name }) {
  const says = wording(language)
  const what = says[purpose] ?? says.SIGN_IN
  const hola = name ? `${clean(name)}, ` : ''
  const text = [
    `${hola}tu código ${says.para} ${what.hace} es:`,
    '',
    code,
    '',
    says.caduca,
    says.nadie,
  ].join('\n')
  const html = [
    '<div style="font-family:system-ui,-apple-system,sans-serif;font-size:15px;color:#1c1e1a">',
    `<p>${hola}tu código ${says.para} ${what.hace} es:</p>`,
    `<p style="font-family:ui-monospace,Menlo,monospace;font-size:34px;letter-spacing:8px;margin:24px 0">${code}</p>`,
    `<p style="color:#7e8478">${says.caduca}</p>`,
    `<p style="color:#7e8478">${says.nadie}</p>`,
    '</div>',
  ].join('')
  return { subject: what.asunto, text, html }
}

// ── Resend ───────────────────────────────────────────────────────────────────

/**
 * Correo por Resend.
 *
 * `from` sale de la configuración porque es lo único que cambia al pasar del
 * remitente de pruebas al dominio propio: `onboarding@resend.dev` mientras se
 * monta —y sólo llega a la cuenta que registró la clave— y el dominio
 * verificado después, sin tocar una línea de esto.
 */
export function resendMailer({
  apiKey = process.env.RESEND_API_KEY,
  from = process.env.RESEND_FROM,
  fetcher = globalThis.fetch,
  timeout = 10_000,
} = {}) {
  const key = clean(apiKey)
  if (!key) return null
  // Dentro y no en el valor por defecto del parámetro: una variable de entorno
  // definida y vacía no es `undefined`, así que el valor por defecto no salta y
  // el correo saldría sin remitente.
  const sender = clean(from) || 'FleetHub <onboarding@resend.dev>'
  return async function send({ to, code, purpose, language, name }) {
    const { subject, text, html } = emailBody({ code, purpose, language, name })
    try {
      const response = await fetcher('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from: sender, to: [to], subject, text, html }),
        signal: AbortSignal.timeout(timeout),
      })
      if (!response.ok) return { ok: false, error: `RESEND_${response.status}` }
      return { ok: true }
    } catch (error) {
      return { ok: false, error: String(error?.message ?? error) }
    }
  }
}

// ── Twilio ───────────────────────────────────────────────────────────────────

/**
 * SMS por Twilio.
 *
 * Con Messaging Service en vez de un número suelto: lleva asociada la campaña
 * 10DLC que las operadoras estadounidenses exigen, reparte entre los números
 * que tenga y reintenta por su cuenta. Un número suelto también vale y va por
 * `TWILIO_FROM_NUMBER`.
 *
 * Autentica con una clave de API —`SK…`— y no con el Auth Token de la cuenta,
 * porque una clave se revoca sola sin tirar todo lo demás.
 */
export function twilioTexter({
  accountSid = process.env.TWILIO_ACCOUNT_SID,
  keySid = process.env.TWILIO_API_KEY_SID || process.env.TWILIO_ACCOUNT_SID,
  keySecret = process.env.TWILIO_API_KEY_SECRET || process.env.TWILIO_AUTH_TOKEN,
  messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID,
  from = process.env.TWILIO_FROM_NUMBER,
  fetcher = globalThis.fetch,
  timeout = 10_000,
} = {}) {
  const account = clean(accountSid)
  const user = clean(keySid)
  const secret = clean(keySecret)
  const service = clean(messagingServiceSid)
  const number = clean(from)
  if (!account || !user || !secret || (!service && !number)) return null

  const authorization = `Basic ${Buffer.from(`${user}:${secret}`).toString('base64')}`
  const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(account)}/Messages.json`

  return async function send({ to, code, purpose, language }) {
    const form = new URLSearchParams({ To: to, Body: smsBody({ code, purpose, language }) })
    if (service) form.set('MessagingServiceSid', service)
    else form.set('From', number)
    try {
      const response = await fetcher(endpoint, {
        method: 'POST',
        headers: { authorization, 'content-type': 'application/x-www-form-urlencoded' },
        body: form,
        signal: AbortSignal.timeout(timeout),
      })
      if (!response.ok) return { ok: false, error: `TWILIO_${response.status}` }
      return { ok: true }
    } catch (error) {
      return { ok: false, error: String(error?.message ?? error) }
    }
  }
}

// ── El webhook de antes ──────────────────────────────────────────────────────

/** Un destino propio, por si se prefiere resolver la entrega fuera. */
export function webhookDelivery({
  url = process.env.AUTH_DELIVERY_WEBHOOK_URL,
  token = process.env.AUTH_DELIVERY_TOKEN,
  fetcher = globalThis.fetch,
  timeout = 8_000,
} = {}) {
  const where = clean(url)
  if (!where) return null
  return async function send(message) {
    try {
      const response = await fetcher(where, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(clean(token) ? { authorization: `Bearer ${clean(token)}` } : {}),
        },
        body: JSON.stringify(message),
        signal: AbortSignal.timeout(timeout),
      })
      return { ok: response.ok }
    } catch (error) {
      return { ok: false, error: String(error?.message ?? error) }
    }
  }
}

// ── La puerta ────────────────────────────────────────────────────────────────

/**
 * El `deliverCode` que espera la API, o `undefined` si no hay nada configurado.
 *
 * `undefined` importa: con él y sin el modo inseguro, el servidor rechaza la
 * petición en lugar de fingir que mandó algo. Devolver una función que no
 * entrega sería justo lo contrario.
 *
 * El destino llega ya resuelto —correo o número en E.164— porque quien sabe
 * el prefijo telefónico es el servidor, no este módulo.
 */
export function createDeliverCode({ mailer, texter, webhook, log } = {}) {
  const email = mailer === undefined ? resendMailer() : mailer
  const sms = texter === undefined ? twilioTexter() : texter
  const fallback = webhook === undefined ? webhookDelivery() : webhook
  if (!email && !sms && !fallback) return undefined

  return async function deliverCode(message) {
    const channel = message.channel ?? (String(message.to ?? '').includes('@') ? 'email' : 'sms')
    const send = channel === 'email' ? (email ?? fallback) : (sms ?? fallback)
    if (!send) return { ok: false, error: 'CHANNEL_NOT_CONFIGURED' }
    if (!clean(message.to)) return { ok: false, error: 'NO_DESTINATION' }

    const sent = await send({ ...message, channel })
    // El código nunca entra en el registro: lo que se apunta es que salió.
    log?.(sent.ok ? 'info' : 'warn', 'code_delivery', {
      channel, purpose: message.purpose, ok: sent.ok, ...(sent.error ? { reason: sent.error } : {}),
    })
    return sent
  }
}
