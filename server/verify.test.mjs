// El SMS por Twilio Verify: que le hablemos como espera, y que convivir con
// nuestro propio sistema de códigos no rompa ninguno de los dos.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { twilioVerifier } from './verify.mjs'
import { createFleetHubApi, emptyState } from './app.mjs'

const respuesta = (status, body = {}) => ({
  ok: status >= 200 && status < 300, status, json: async () => body,
})

const credenciales = {
  accountSid: 'AC123', keySid: 'SK123', keySecret: 'secreto', serviceSid: 'VA123',
}

describe('el puente con Verify', () => {
  test('pedir un código va al servicio, por SMS y con el idioma de la cuenta', async () => {
    const fetcher = vi.fn(async () => respuesta(201, { sid: 'VE1', status: 'pending' }))
    const v = twilioVerifier({ ...credenciales, fetcher })

    await expect(v.start({ to: '+13055550111', language: 'en' }))
      .resolves.toMatchObject({ ok: true, sid: 'VE1' })

    const [url, options] = fetcher.mock.calls[0]
    expect(url).toBe('https://verify.twilio.com/v2/Services/VA123/Verifications')
    const form = new URLSearchParams(options.body)
    expect(form.get('To')).toBe('+13055550111')
    expect(form.get('Channel')).toBe('sms')
    expect(form.get('Locale')).toBe('en')
  })

  test('un idioma que Verify no conoce se omite en vez de mandarse mal', async () => {
    const fetcher = vi.fn(async () => respuesta(201, {}))
    await twilioVerifier({ ...credenciales, fetcher }).start({ to: '+1305', language: 'fr' })
    expect(new URLSearchParams(fetcher.mock.calls[0][1].body).get('Locale')).toBeNull()
  })

  test('comprobar devuelve aprobado cuando Twilio lo aprueba', async () => {
    const fetcher = vi.fn(async () => respuesta(200, { status: 'approved' }))
    const v = twilioVerifier({ ...credenciales, fetcher })

    await expect(v.check({ to: '+13055550111', code: '481516' })).resolves.toEqual({ ok: true })
    expect(fetcher.mock.calls[0][0]).toContain('/VerificationCheck')
  })

  test('un código equivocado queda pendiente, no perdido', async () => {
    const fetcher = vi.fn(async () => respuesta(200, { status: 'pending' }))
    await expect(twilioVerifier({ ...credenciales, fetcher }).check({ to: '+1', code: '000000' }))
      .resolves.toMatchObject({ ok: false, pending: true, error: 'INVALID_CODE' })
  })

  test('sin verificación viva contesta que esto no va con él', async () => {
    // Es la respuesta que permite seguir preguntando a nuestra tabla: el
    // código pudo haber salido por correo.
    const fetcher = vi.fn(async () => respuesta(404, {}))
    await expect(twilioVerifier({ ...credenciales, fetcher }).check({ to: '+1', code: '1' }))
      .resolves.toMatchObject({ ok: false, pending: false, error: 'NOT_FOUND' })
  })

  test('sin configurar no hay puente, y eso no es lo mismo que uno que falla', () => {
    expect(twilioVerifier({ ...credenciales, serviceSid: '', fetcher: vi.fn() })).toBeNull()
    expect(twilioVerifier({ ...credenciales, keySecret: '', fetcher: vi.fn() })).toBeNull()
  })

  test('una red caída no se propaga', async () => {
    const fetcher = vi.fn(async () => { throw new Error('sin red') })
    await expect(twilioVerifier({ ...credenciales, fetcher }).start({ to: '+1' }))
      .resolves.toMatchObject({ ok: false })
  })
})

// ── conviviendo con nuestro sistema ──────────────────────────────────────────

function fixture({ verifier, deliverCode } = {}) {
  let held = emptyState()
  const api = createFleetHubApi({
    loadState: async () => structuredClone(held),
    saveState: async (next) => { held = structuredClone(next) },
    savePhoto: async () => {},
    loadPhoto: async () => null,
    deliverCode,
    verifier,
    exposeAuthCodes: true,
    reporter: { capture: vi.fn(), notify: vi.fn() },
  })
  const call = async (path, body) => {
    const r = await api(new Request(`https://fleethub.test${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }))
    return { status: r.status, body: await r.json() }
  }
  return { call, state: () => held }
}

async function cuenta(call) {
  const founded = await call('/api/companies', {})
  const email = 'ana@example.com'
  const asked = await call('/api/tokens', { purpose: 'REGISTER', addressee: email, email })
  const confirmed = await call('/api/tokens', {
    action: 'spend', purpose: 'REGISTER', addressee: email, code: asked.body.code })
  const registered = await call('/api/registrations', {
    fullName: 'Ana Torres', email, phoneCode: '+1', phone: '3055550111', language: 'es',
    password: 'Clave-Segura1', code: founded.body.code,
    registrationToken: confirmed.body.registrationToken,
  })
  expect(registered.status).toBe(200)
  return registered.body.user
}

let antes

beforeEach(() => {
  antes = process.env.RATE_CODES_PER_10MIN
  process.env.RATE_CODES_PER_10MIN = '500'
})

afterEach(() => {
  if (antes === undefined) delete process.env.RATE_CODES_PER_10MIN
  else process.env.RATE_CODES_PER_10MIN = antes
})

describe('entrar por SMS con Verify', () => {
  const puente = (overrides = {}) => ({
    start: vi.fn(async () => ({ ok: true, sid: 'VE1' })),
    check: vi.fn(async () => ({ ok: true })),
    ...overrides,
  })

  test('pedir por teléfono usa Verify y no manda correo', async () => {
    const verifier = puente()
    const deliverCode = vi.fn(async () => ({ ok: true }))
    const { call } = fixture({ verifier, deliverCode })
    await cuenta(call)
    deliverCode.mockClear()

    const asked = await call('/api/tokens', {
      purpose: 'SIGN_IN', addressee: '3055550111', phone: '3055550111' })

    expect(asked.status).toBe(200)
    expect(verifier.start).toHaveBeenCalledWith(
      expect.objectContaining({ to: '+13055550111', language: 'es' }))
    expect(deliverCode).not.toHaveBeenCalled()
  })

  test('la fila se queda, delegada, y sin derivado que valga', async () => {
    const verifier = puente()
    const { call, state } = fixture({ verifier, deliverCode: vi.fn(async () => ({ ok: true })) })
    await cuenta(call)

    await call('/api/tokens', { purpose: 'SIGN_IN', addressee: '3055550111', phone: '3055550111' })

    const [fila] = state().tokens.filter((t) => t.purpose === 'SIGN_IN')
    // No se retira: es lo que deja rastro de que hubo una petición por SMS.
    expect(fila.revokedAt).toBeNull()
    expect(fila.delegatedTo).toBe('twilio-verify')
    // Pero deja de poder abrir nada por nuestro lado: sin derivado y sin
    // código en claro, no hay forma de que `find` la reconozca.
    expect(fila.secret).toBeUndefined()
    expect(fila.code).toBeNull()
  })

  test('el acceso por SMS deja el mismo rastro que uno por correo', async () => {
    const verifier = puente()
    const { call, state } = fixture({ verifier, deliverCode: vi.fn(async () => ({ ok: true })) })
    const user = await cuenta(call)
    await call('/api/tokens', { purpose: 'SIGN_IN', addressee: '3055550111', phone: '3055550111' })

    const entrada = await call('/api/tokens', {
      purpose: 'SESSION', codePurpose: 'SIGN_IN', phone: '3055550111', code: '481516' })
    expect(entrada.status).toBe(200)

    const [fila] = state().tokens.filter((t) => t.purpose === 'SIGN_IN')
    expect(fila.usedBy).toHaveLength(1)
    expect(fila.usedBy[0]).toMatchObject({ by: user.id })
    expect(fila.usedBy[0].at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  test('el código de Twilio abre sesión', async () => {
    const verifier = puente()
    const { call } = fixture({ verifier, deliverCode: vi.fn(async () => ({ ok: true })) })
    const user = await cuenta(call)
    await call('/api/tokens', { purpose: 'SIGN_IN', addressee: '3055550111', phone: '3055550111' })

    const entrada = await call('/api/tokens', {
      purpose: 'SESSION', codePurpose: 'SIGN_IN', phone: '3055550111', code: '481516' })

    expect(entrada.status).toBe(200)
    expect(entrada.body.token).toMatchObject({ userId: user.id, role: 'ADMINISTRADOR' })
    expect(verifier.check).toHaveBeenCalledWith({ to: '+13055550111', code: '481516' })
  })

  test('un código equivocado no abre nada', async () => {
    const verifier = puente({ check: vi.fn(async () => ({ ok: false, pending: true, error: 'INVALID_CODE' })) })
    const { call } = fixture({ verifier, deliverCode: vi.fn(async () => ({ ok: true })) })
    await cuenta(call)
    await call('/api/tokens', { purpose: 'SIGN_IN', addressee: '3055550111', phone: '3055550111' })

    const entrada = await call('/api/tokens', {
      purpose: 'SESSION', codePurpose: 'SIGN_IN', phone: '3055550111', code: '000000' })

    expect(entrada.status).toBe(401)
    expect(entrada.body.error).toBe('INVALID_CODE')
  })

  test('si Verify no puede mandar, el código sale por correo y sigue siendo nuestro', async () => {
    const verifier = puente({ start: vi.fn(async () => ({ ok: false, error: 'VERIFY_429' })) })
    const deliverCode = vi.fn(async () => ({ ok: true }))
    const { call, state } = fixture({ verifier, deliverCode })
    await cuenta(call)
    deliverCode.mockClear()

    const asked = await call('/api/tokens', {
      purpose: 'SIGN_IN', addressee: '3055550111', phone: '3055550111' })

    expect(asked.status).toBe(200)
    expect(deliverCode.mock.calls[0][0]).toMatchObject({ channel: 'email', to: 'ana@example.com' })
    const nuestro = state().tokens.filter((t) => t.purpose === 'SIGN_IN')
    expect(nuestro[0].revokedAt).toBeNull()
  })

  test('el correo sigue sin pasar por Verify', async () => {
    const verifier = puente()
    const deliverCode = vi.fn(async () => ({ ok: true }))
    const { call } = fixture({ verifier, deliverCode })
    await cuenta(call)
    deliverCode.mockClear()
    verifier.start.mockClear()

    await call('/api/tokens', {
      purpose: 'SIGN_IN', addressee: 'ana@example.com', email: 'ana@example.com' })

    expect(verifier.start).not.toHaveBeenCalled()
    expect(deliverCode.mock.calls[0][0]).toMatchObject({ channel: 'email' })
  })

  test('cuando Verify no sabe del número, decide nuestra tabla', async () => {
    // El caso del respaldo: salió por correo, así que el código es nuestro.
    const verifier = puente({
      start: vi.fn(async () => ({ ok: false })),
      check: vi.fn(async () => ({ ok: false, pending: false, error: 'NOT_FOUND' })),
    })
    const { call } = fixture({ verifier, deliverCode: vi.fn(async () => ({ ok: true })) })
    const user = await cuenta(call)
    const asked = await call('/api/tokens', {
      purpose: 'SIGN_IN', addressee: '3055550111', phone: '3055550111' })

    const entrada = await call('/api/tokens', {
      purpose: 'SESSION', codePurpose: 'SIGN_IN', phone: '3055550111', code: asked.body.code })

    expect(entrada.status).toBe(200)
    expect(entrada.body.token.userId).toBe(user.id)
  })
})
