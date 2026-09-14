// Los dos proveedores, sin gastar un envío.
//
// Lo que se comprueba no es que Resend y Twilio funcionen —eso lo saben ellos—
// sino que les hablamos como esperan, que el canal se elige por el destinatario
// y que un código nunca acaba escrito en un registro.

import { describe, expect, test, vi } from 'vitest'
import {
  createDeliverCode, emailBody, resendMailer, smsBody, twilioTexter, webhookDelivery,
} from './delivery.mjs'

const respuesta = (ok = true, status = 200) => ({ ok, status, json: async () => ({}) })

const mensaje = {
  channel: 'email',
  to: 'ana@example.com',
  addressee: 'ana@example.com',
  purpose: 'SIGN_IN',
  code: '481516',
  expiresAt: '2026-08-20T12:00:00.000Z',
  language: 'es',
  name: 'Ana Torres',
}

describe('los textos', () => {
  test('el SMS cabe en un mensaje y nombra al remitente', () => {
    const body = smsBody({ code: '481516', purpose: 'SIGN_IN', language: 'es' })
    expect(body).toContain('FleetHub')
    expect(body).toContain('481516')
    expect(body.length).toBeLessThanOrEqual(160)
  })

  test('cada propósito dice a qué sirve el código', () => {
    expect(smsBody({ code: '1', purpose: 'PASSWORD_RESET', language: 'es' })).toContain('contraseña')
    expect(smsBody({ code: '1', purpose: 'REGISTER', language: 'es' })).toContain('correo')
    expect(smsBody({ code: '1', purpose: 'SIGN_IN', language: 'en' })).toContain('sign in')
    // Y en inglés no se cuela una palabra en castellano por el camino.
    expect(smsBody({ code: '1', purpose: 'SIGN_IN', language: 'en' })).not.toContain('para')
    expect(emailBody({ code: '1', purpose: 'SIGN_IN', language: 'en' }).text).not.toContain('para')
  })

  test('un idioma que no hablamos cae al castellano en vez de romperse', () => {
    expect(smsBody({ code: '1', purpose: 'SIGN_IN', language: 'fr' })).toContain('entrar')
    expect(smsBody({ code: '1', purpose: 'SIGN_IN' })).toContain('entrar')
  })

  test('el correo lleva asunto, texto y HTML con el código dentro', () => {
    const { subject, text, html } = emailBody({
      code: '481516', purpose: 'SIGN_IN', language: 'es', name: 'Ana Torres',
    })
    expect(subject).toBe('Tu código para entrar')
    expect(text).toContain('481516')
    expect(html).toContain('481516')
    expect(text).toContain('Ana Torres')
    // Y avisa de lo que FleetHub nunca va a pedir, que es media defensa.
    expect(text).toContain('nunca')
  })
})

describe('Resend', () => {
  test('manda lo que Resend espera, con la clave en la cabecera', async () => {
    const fetcher = vi.fn(async () => respuesta())
    const send = resendMailer({ apiKey: 're_prueba', from: 'FleetHub <hola@fleethub.test>', fetcher })

    await expect(send(mensaje)).resolves.toEqual({ ok: true })

    const [url, options] = fetcher.mock.calls[0]
    expect(url).toBe('https://api.resend.com/emails')
    expect(options.headers.authorization).toBe('Bearer re_prueba')
    const cuerpo = JSON.parse(options.body)
    expect(cuerpo).toMatchObject({ from: 'FleetHub <hola@fleethub.test>', to: ['ana@example.com'] })
    expect(cuerpo.text).toContain('481516')
  })

  test('sin clave no hay proveedor, y eso no es lo mismo que uno que falla', () => {
    expect(resendMailer({ apiKey: '', fetcher: vi.fn() })).toBeNull()
  })

  test('el remitente por defecto es el de pruebas de Resend', async () => {
    const fetcher = vi.fn(async () => respuesta())
    await resendMailer({ apiKey: 're_prueba', from: '', fetcher })(mensaje)
    expect(JSON.parse(fetcher.mock.calls[0][1].body).from).toContain('onboarding@resend.dev')
  })

  test('un rechazo del proveedor se cuenta como fallo, con su status', async () => {
    const fetcher = vi.fn(async () => respuesta(false, 422))
    await expect(resendMailer({ apiKey: 're_x', fetcher })(mensaje))
      .resolves.toEqual({ ok: false, error: 'RESEND_422' })
  })

  test('una red caída no se propaga: se cuenta como fallo', async () => {
    const fetcher = vi.fn(async () => { throw new Error('sin red') })
    await expect(resendMailer({ apiKey: 're_x', fetcher })(mensaje))
      .resolves.toMatchObject({ ok: false })
  })
})

describe('Twilio', () => {
  const sms = { ...mensaje, channel: 'sms', to: '+13055550111' }

  test('manda el formulario que Twilio espera, con el Messaging Service', async () => {
    const fetcher = vi.fn(async () => respuesta())
    const send = twilioTexter({
      accountSid: 'AC123', keySid: 'SK123', keySecret: 'secreto',
      messagingServiceSid: 'MG123', fetcher,
    })

    await expect(send(sms)).resolves.toEqual({ ok: true })

    const [url, options] = fetcher.mock.calls[0]
    expect(url).toBe('https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json')
    expect(options.headers.authorization)
      .toBe(`Basic ${Buffer.from('SK123:secreto').toString('base64')}`)
    const form = new URLSearchParams(options.body)
    expect(form.get('To')).toBe('+13055550111')
    expect(form.get('MessagingServiceSid')).toBe('MG123')
    expect(form.get('From')).toBeNull()
    expect(form.get('Body')).toContain('481516')
  })

  test('con número suelto manda From en vez del servicio', async () => {
    const fetcher = vi.fn(async () => respuesta())
    await twilioTexter({
      accountSid: 'AC123', keySid: 'SK1', keySecret: 's', from: '+13050000000', fetcher,
    })(sms)
    const form = new URLSearchParams(fetcher.mock.calls[0][1].body)
    expect(form.get('From')).toBe('+13050000000')
    expect(form.get('MessagingServiceSid')).toBeNull()
  })

  test('sin remitente no hay proveedor, aunque haya credenciales', () => {
    expect(twilioTexter({ accountSid: 'AC1', keySid: 'SK1', keySecret: 's', fetcher: vi.fn() }))
      .toBeNull()
  })
})

describe('la puerta', () => {
  test('el canal sale del destinatario cuando nadie lo dice', async () => {
    const mailer = vi.fn(async () => ({ ok: true }))
    const texter = vi.fn(async () => ({ ok: true }))
    const deliver = createDeliverCode({ mailer, texter, webhook: null })

    await deliver({ ...mensaje, channel: undefined })
    await deliver({ ...mensaje, channel: undefined, to: '+13055550111' })

    expect(mailer).toHaveBeenCalledTimes(1)
    expect(texter).toHaveBeenCalledTimes(1)
  })

  test('sin ningún proveedor devuelve undefined, no una función que no entrega', () => {
    expect(createDeliverCode({ mailer: null, texter: null, webhook: null })).toBeUndefined()
  })

  test('el webhook recoge el canal que no tenga proveedor propio', async () => {
    const webhook = vi.fn(async () => ({ ok: true }))
    const deliver = createDeliverCode({ mailer: null, texter: null, webhook })

    await deliver({ ...mensaje, channel: 'sms', to: '+13055550111' })
    expect(webhook).toHaveBeenCalledTimes(1)
  })

  test('sin destino no se llama a nadie', async () => {
    const mailer = vi.fn(async () => ({ ok: true }))
    const deliver = createDeliverCode({ mailer, texter: null, webhook: null })

    await expect(deliver({ ...mensaje, to: '' })).resolves.toMatchObject({ ok: false })
    expect(mailer).not.toHaveBeenCalled()
  })

  test('el registro dice que salió, y jamás el código', async () => {
    const log = vi.fn()
    const deliver = createDeliverCode({
      mailer: async () => ({ ok: true }), texter: null, webhook: null, log,
    })

    await deliver(mensaje)

    const [nivel, evento, campos] = log.mock.calls[0]
    expect(nivel).toBe('info')
    expect(evento).toBe('code_delivery')
    expect(campos).toMatchObject({ channel: 'email', purpose: 'SIGN_IN', ok: true })
    expect(JSON.stringify(campos)).not.toContain('481516')
    expect(JSON.stringify(campos)).not.toContain('ana@example.com')
  })
})

describe('el webhook de antes', () => {
  test('sigue funcionando y manda el mensaje entero', async () => {
    const fetcher = vi.fn(async () => respuesta())
    const send = webhookDelivery({ url: 'https://envios.test/hook', token: 'llave', fetcher })

    await expect(send(mensaje)).resolves.toEqual({ ok: true })
    const [url, options] = fetcher.mock.calls[0]
    expect(url).toBe('https://envios.test/hook')
    expect(options.headers.authorization).toBe('Bearer llave')
    expect(JSON.parse(options.body)).toMatchObject({ purpose: 'SIGN_IN', code: '481516' })
  })

  test('sin URL no hay webhook', () => {
    expect(webhookDelivery({ url: '', fetcher: vi.fn() })).toBeNull()
  })
})
