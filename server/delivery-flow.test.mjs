// El código, desde que se pide hasta que sale por el canal.
//
// Lo que se comprueba aquí no es el proveedor —eso está en delivery.test.mjs—
// sino lo que sólo sabe el servidor: que el teléfono salga marcable, que un
// fallo de entrega no deje viva la llave, y que pedir un código para una
// cuenta que no existe conteste igual que para una que sí.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createFleetHubApi, emptyState } from './app.mjs'

function fixture({ deliverCode, exposeAuthCodes = false } = {}) {
  let held = emptyState()
  const api = createFleetHubApi({
    loadState: async () => structuredClone(held),
    saveState: async (next) => { held = structuredClone(next) },
    savePhoto: async () => {},
    loadPhoto: async () => null,
    deliverCode,
    exposeAuthCodes,
    reporter: { capture: vi.fn(), notify: vi.fn() },
  })
  const call = async (path, { method = 'POST', body, token } = {}) => {
    const response = await api(new Request(`https://fleethub.test${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }))
    return { status: response.status, body: await response.json() }
  }
  return { call, state: () => held }
}

/** Funda una empresa y da de alta a alguien con teléfono conocido. */
async function cuenta(call, { email, phoneCode, phone }) {
  const founded = await call('/api/companies', { body: {} })
  const asked = await call('/api/tokens', { body: { purpose: 'REGISTER', addressee: email, email } })
  const confirmed = await call('/api/tokens', {
    body: { action: 'spend', purpose: 'REGISTER', addressee: email, code: asked.body.code },
  })
  const registered = await call('/api/registrations', {
    body: {
      fullName: 'Ana Torres', email, phoneCode, phone, language: 'en',
      password: 'Clave-Segura1', code: founded.body.code,
      registrationToken: confirmed.body.registrationToken,
    },
  })
  expect(registered.status).toBe(200)
  return registered.body.user
}

let insecure

beforeEach(() => {
  insecure = process.env.RATE_CODES_PER_10MIN
  process.env.RATE_CODES_PER_10MIN = '500'
})

afterEach(() => {
  if (insecure === undefined) delete process.env.RATE_CODES_PER_10MIN
  else process.env.RATE_CODES_PER_10MIN = insecure
})

describe('el código sale por su canal', () => {
  test('por teléfono llega marcable, con prefijo y todo', async () => {
    const deliverCode = vi.fn(async () => ({ ok: true }))
    // El alta necesita ver el código; la entrega se comprueba después.
    const abierto = fixture({ deliverCode, exposeAuthCodes: true })
    const user = await cuenta(abierto.call, {
      email: 'ana@example.com', phoneCode: '+1', phone: '3055550111',
    })
    deliverCode.mockClear()

    const asked = await abierto.call('/api/tokens', {
      body: { purpose: 'SIGN_IN', addressee: '3055550111', phone: '3055550111' },
    })

    expect(asked.status).toBe(200)
    expect(deliverCode).toHaveBeenCalledTimes(1)
    const mensaje = deliverCode.mock.calls[0][0]
    expect(mensaje).toMatchObject({
      channel: 'sms',
      to: '+13055550111',          // lo que el frontend manda es «3055550111»
      purpose: 'SIGN_IN',
      language: 'en',              // el idioma de la cuenta, no el del servidor
      name: 'Ana Torres',
    })
    expect(mensaje.code).toMatch(/^\d{6}$/)
    expect(user.phone).toBe('3055550111')
  })

  test('por correo el destino es la dirección', async () => {
    const deliverCode = vi.fn(async () => ({ ok: true }))
    const { call } = fixture({ deliverCode, exposeAuthCodes: true })
    await cuenta(call, { email: 'ana@example.com', phoneCode: '+1', phone: '3055550111' })
    deliverCode.mockClear()

    await call('/api/tokens', {
      body: { purpose: 'SIGN_IN', addressee: 'ana@example.com', email: 'ana@example.com' },
    })

    expect(deliverCode.mock.calls[0][0]).toMatchObject({
      channel: 'email', to: 'ana@example.com',
    })
  })
})

describe('cuando no hay SMS', () => {
  test('pedido por teléfono, el código sale por el correo de la cuenta', async () => {
    // Sólo hay correo configurado, que es la situación de hoy.
    const deliverCode = vi.fn(async ({ channel }) =>
      channel === 'sms' ? { ok: false, error: 'CHANNEL_NOT_CONFIGURED' } : { ok: true })
    const { call } = fixture({ deliverCode, exposeAuthCodes: true })
    await cuenta(call, { email: 'ana@example.com', phoneCode: '+1', phone: '3055550111' })
    deliverCode.mockClear()

    const asked = await call('/api/tokens', {
      body: { purpose: 'SIGN_IN', addressee: '3055550111', phone: '3055550111' },
    })

    expect(asked.status).toBe(200)
    // Se intentó el SMS primero y después el correo, con el mismo código.
    expect(deliverCode.mock.calls.map(([m]) => m.channel)).toEqual(['sms', 'email'])
    const [sms, correo] = deliverCode.mock.calls.map(([m]) => m)
    expect(sms.to).toBe('+13055550111')
    expect(correo.to).toBe('ana@example.com')
    expect(correo.code).toBe(sms.code)
  })

  test('con SMS disponible no se manda además el correo', async () => {
    const deliverCode = vi.fn(async () => ({ ok: true }))
    const { call } = fixture({ deliverCode, exposeAuthCodes: true })
    await cuenta(call, { email: 'ana@example.com', phoneCode: '+1', phone: '3055550111' })
    deliverCode.mockClear()

    await call('/api/tokens', {
      body: { purpose: 'SIGN_IN', addressee: '3055550111', phone: '3055550111' },
    })

    expect(deliverCode.mock.calls.map(([m]) => m.channel)).toEqual(['sms'])
  })

  test('la respuesta no dice por dónde salió', async () => {
    const deliverCode = vi.fn(async ({ channel }) =>
      channel === 'sms' ? { ok: false } : { ok: true })
    // El alta necesita ver su código; lo que se mira aquí es otra cosa.
    const { call } = fixture({ deliverCode, exposeAuthCodes: true })
    await cuenta(call, { email: 'ana@example.com', phoneCode: '+1', phone: '3055550111' })

    const asked = await call('/api/tokens', {
      body: { purpose: 'SIGN_IN', addressee: '3055550111', phone: '3055550111' },
    })

    // Decirlo delataría qué teléfonos tienen cuenta detrás.
    expect(asked.body).not.toHaveProperty('channel')
    expect(asked.body).not.toHaveProperty('deliveredBy')
    expect(JSON.stringify(asked.body)).not.toContain('ana@example.com')
  })
})

describe('cuando algo va mal', () => {
  test('si la entrega falla, la llave no se queda viva', async () => {
    const deliverCode = vi.fn(async () => ({ ok: false, error: 'RESEND_422' }))
    const { call, state } = fixture({ deliverCode })

    const asked = await call('/api/tokens', {
      body: { purpose: 'SIGN_IN', addressee: 'nadie@example.com', email: 'nadie@example.com' },
    })

    expect(asked).toMatchObject({ status: 502, body: { error: 'CODE_DELIVERY_FAILED' } })
    // Y sobre todo: revocada. Antes se intentaba y no encontraba la fila.
    const codigos = state().tokens.filter((row) => row.purpose === 'SIGN_IN')
    expect(codigos).toHaveLength(1)
    expect(codigos[0].revokedAt).not.toBeNull()
  })

  test('un teléfono sin cuenta detrás contesta igual que uno con ella', async () => {
    const deliverCode = vi.fn(async () => ({ ok: true }))
    const { call, state } = fixture({ deliverCode })

    const asked = await call('/api/tokens', {
      body: { purpose: 'SIGN_IN', addressee: '3055559999', phone: '3055559999' },
    })

    // Doscientos, como si hubiera salido: decir «esa cuenta no existe» aquí
    // convierte la puerta en un detector de teléfonos registrados.
    expect(asked.status).toBe(200)
    expect(asked.body.code).toBeUndefined()
    // No se llamó a nadie: sin cuenta no hay ni número ni correo al que ir.
    expect(deliverCode).not.toHaveBeenCalled()
    // …y la llave que nadie recibió queda retirada.
    expect(state().tokens.at(-1).revokedAt).not.toBeNull()
  })

  test('sin canal y sin modo inseguro se rechaza en vez de fingir', async () => {
    const { call } = fixture({ deliverCode: undefined, exposeAuthCodes: false })

    const asked = await call('/api/tokens', {
      body: { purpose: 'SIGN_IN', addressee: 'ana@example.com', email: 'ana@example.com' },
    })

    expect(asked).toMatchObject({
      status: 503, body: { error: 'CODE_DELIVERY_NOT_CONFIGURED' },
    })
  })

  test('con canal, el código no vuelve en la respuesta', async () => {
    const deliverCode = vi.fn(async () => ({ ok: true }))
    const { call } = fixture({ deliverCode, exposeAuthCodes: false })

    const asked = await call('/api/tokens', {
      body: { purpose: 'SIGN_IN', addressee: 'ana@example.com', email: 'ana@example.com' },
    })

    expect(asked.status).toBe(200)
    expect(asked.body.code).toBeUndefined()
    // Existió una vez, y fue en el mensaje que salió.
    expect(deliverCode.mock.calls[0][0].code).toMatch(/^\d{6}$/)
  })
})
