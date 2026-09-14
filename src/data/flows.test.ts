import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  listAlerts, listLatestPerVehicle, listMembers, listPlotted, listRoutes, listVehicles, prepareVehicle, reset,
  confirmCode, createCompany, registerAccount, saveScan, saveVehicleDetails, sendCode,
  endSession, signInWithPassword, startSession, whoami, type Identity,
} from './index'

const ANA: Identity = { kind: 'email', email: 'ana.torres@empresa.mx' }

beforeEach(() => reset())
afterEach(() => {
  reset()
  vi.unstubAllGlobals()
})

describe('almacén sin datos ficticios', () => {
  test('usuarios, vehículos, ubicaciones y alertas comienzan vacíos', async () => {
    expect(await listMembers()).toEqual([])
    expect(await listVehicles()).toEqual([])
    expect(await listRoutes()).toEqual([])
    expect(await listAlerts()).toEqual([])
  })
})

describe('flota autorizada por la sesión', () => {
  test('al cambiar de operador reemplaza la flota local y nunca dibuja las unidades pendientes', async () => {
    const companyId = '22222222-2222-4222-8222-222222222222'
    const anaId = '11111111-1111-4111-8111-111111111111'
    const beaId = '33333333-3333-4333-8333-333333333333'
    const ana = {
      id: anaId, companyId, fullName: 'Ana Torres', email: 'ana@example.com',
      phoneCode: '+1', phone: '3055550101', language: 'es',
      role: 'OPERADOR', title: '', suspension: null,
    }
    const bea = {
      id: beaId, companyId, fullName: 'Bea Ruiz', email: 'bea@example.com',
      phoneCode: '+1', phone: '3055550102', language: 'es',
      role: 'OPERADOR', title: '', suspension: null,
    }
    let signed = 'ana'
    const startedAt = new Date(Date.now() - 300_000).toISOString()
    const vehicle = (vin: string, tracking = false) => ({
      vin, state: null, make: 'MAZDA', model: 'CX-30', trim: 'SELECT', body: 'SUV', year: 2023,
      createdAt: '2026-08-20T11:00:00.000Z', updatedAt: '2026-08-20T12:00:00.000Z',
      position: { latitude: 25.76, longitude: -80.19, accuracy: 8, createdAt: '2026-08-20T12:00:00.000Z' },
      routeTracking: tracking ? {
        locationId: '44444444-4444-4444-8444-444444444444',
        routeStartedAt: startedAt,
        etaSeconds: 600,
        geometry: [[-80.2, 25.7], [-80.1, 25.7], [-80.0, 25.7]],
      } : null,
    })
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input)
      if (path === '/api/tokens') {
        const sent = JSON.parse(String(init?.body)) as { email?: string }
        signed = sent.email?.startsWith('bea') ? 'bea' : 'ana'
        const userId = signed === 'ana' ? anaId : beaId
        return new Response(JSON.stringify({ ok: true, code: `token-${signed}`, token: { userId } }), { status: 200 })
      }
      if (path === '/api/users')
        return new Response(JSON.stringify({ ok: true, users: [ana, bea] }), { status: 200 })
      if (path === '/api/vehicles') {
        const body = signed === 'ana'
          ? { ok: true, companyId, vehicles: [vehicle('3MVDMBBM2PM512094', true)], pendingVehicles: [vehicle('1HGCM82633A004352')] }
          : { ok: true, companyId, vehicles: [vehicle('1FTFW1E06NFA00001')], pendingVehicles: [vehicle('1HGCM82633A004352')] }
        return new Response(JSON.stringify(body), { status: 200 })
      }
      return new Response(JSON.stringify({ ok: false, error: 'NOT_FOUND', message: 'NO EXISTE' }), { status: 404 })
    })
    vi.stubGlobal('fetch', fetcher)

    const anaSession = await signInWithPassword({ kind: 'email', email: ana.email }, 'Clave-Segura1')
    expect(anaSession.ok).toBe(true)
    await startSession(anaId)
    expect((await listVehicles()).map((unit) => unit.vin)).toEqual([
      '3MVDMBBM2PM512094',
      '1HGCM82633A004352',
    ])
    expect((await listPlotted()).map((unit) => unit.vin)).toEqual(['3MVDMBBM2PM512094'])
    expect(await listLatestPerVehicle()).toHaveLength(2)
    expect(await listLatestPerVehicle()).toContainEqual(expect.objectContaining({
      vin: '1HGCM82633A004352',
      kind: null,
      detail: expect.stringContaining('SIN RUTA/PUNTO ASIGNADO'),
    }))
    expect((await listPlotted())[0].coords?.[0]).toBeCloseTo(-80.1, 1)
    expect((await listPlotted())[0].position).toBe('POSICIÓN ESTIMADA EN RUTA')
    expect(await listAlerts()).toContainEqual(expect.objectContaining({
      unit: expect.stringMatching(/^VH-/), severity: 'MEDIA · SIN RUTA/PUNTO',
    }))

    await endSession()
    const beaSession = await signInWithPassword({ kind: 'email', email: bea.email }, 'Clave-Segura1')
    expect(beaSession.ok).toBe(true)
    await startSession(beaId)
    expect((await listVehicles()).map((unit) => unit.vin)).toEqual([
      '1FTFW1E06NFA00001',
      '1HGCM82633A004352',
    ])
    expect((await listPlotted()).map((unit) => unit.vin)).toEqual(['1FTFW1E06NFA00001'])
    expect(await listAlerts()).toContainEqual(expect.objectContaining({ severity: 'MEDIA · SIN RUTA/PUNTO' }))
  })
})

describe('los códigos requieren la API', () => {
  test('si /api contesta HTML ajeno, no fabrica otra autoridad local', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<!doctype html><html>…', { status: 200 })))
    const sent = await sendCode(ANA, 'register')
    expect(sent.ok).toBe(false)
    if (!sent.ok) expect(sent.reason).toContain('CONEXIÓN')
  })
})

describe('decodificación de vehículos solamente mediante FleetHub', () => {
  test('interpreta la señal de captura manual y guarda el formulario en /details', async () => {
    const vin = '3MVDMBBM2PM512094'
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
      ok: true,
      manualRequired: true,
      decodeError: 'DECODER_UNAVAILABLE',
        vehicle: {
          vin, decodeStatus: 'manual-required', decodedAt: null, decoder: null,
          year: null, make: null, model: null, trim: null, body: null, engine: null,
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ok: true,
        vehicle: {
          vin, decodeStatus: 'manual', decodedAt: null, decoder: null,
          year: 2023, make: 'MAZDA', model: 'CX-30', trim: 'SELECT', body: 'SUV', engine: '2.5L',
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetcher)

    await expect(prepareVehicle(vin)).resolves.toMatchObject({
      ok: true,
      value: {
        manualRequired: true,
        decodeError: 'DECODER_UNAVAILABLE',
        vehicle: { decodeStatus: 'manual-required' },
      },
    })
    await expect(saveVehicleDetails(vin, {
      year: 2023, make: 'MAZDA', model: 'CX-30', trim: 'SELECT', body: 'SUV', engine: '2.5L',
    })).resolves.toMatchObject({
      ok: true,
      value: { decodeStatus: 'manual', year: 2023, make: 'MAZDA', model: 'CX-30' },
    })

    expect(fetcher.mock.calls[0][0]).toBe('/api/vehicles')
    expect(fetcher.mock.calls[1][0]).toBe(`/api/vehicles/${vin}/details`)
  })

  test('el guardado envía la posición al servidor y usa VH derivado del VIN', async () => {
    const userId = '11111111-1111-4111-8111-111111111111'
    const companyId = '22222222-2222-4222-8222-222222222222'
    const vin = '3MVDMBBM2PM512094'
    const user = {
      id: userId, companyId, fullName: 'Ana Torres', email: 'ana@example.com',
      phoneCode: '+52', phone: '5512345678', language: 'es',
      role: 'ADMINISTRADOR', title: '', suspension: null,
    }
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input)
      if (path === '/api/registrations')
        return new Response(JSON.stringify({ ok: true, token: 'session-token', userId, user }), { status: 200 })
      if (path === '/api/users')
        return new Response(JSON.stringify({ ok: true, users: [user] }), { status: 200 })
      if (path === `/api/vehicles/${vin}/positions`)
        return new Response(JSON.stringify({ ok: true, position: {
          vin, latitude: 25.7617, longitude: -80.1918, accuracy: 8,
        } }), { status: 200 })
      return new Response(JSON.stringify({ ok: false, error: 'NOT_FOUND', message: 'NO EXISTE' }), { status: 404 })
    })
    vi.stubGlobal('fetch', fetcher)

    await registerAccount({
      fullName: 'Ana Torres', email: 'ana@example.com', phoneCode: '+52', phone: '5512345678',
      language: 'es', code: 'A1B2C3', registrationToken: 'registro-temporal',
      password: 'Clave-Segura1',
    })
    await startSession(userId)
    await expect(saveScan(userId, {
      vin, model: 'MAZDA CX-30', spec: 'SELECT · SUV · 2023',
      coords: [-80.1918, 25.7617], accuracy: 8,
    })).resolves.toMatchObject({ ok: true, value: { id: expect.stringMatching(/^VH-\d{4}$/), vin } })
    expect(fetcher.mock.calls.some(([path]) => String(path) === `/api/vehicles/${vin}/positions`)).toBe(true)
  })
})

describe('creación de compañía y registro', () => {
  test('crea la compañía en /api/companies y recibe su token sin fabricarlo localmente', async () => {
    const fetcher = vi.fn(async (..._args: Parameters<typeof fetch>) => new Response(JSON.stringify({
      ok: true,
      code: 'A1B2C3',
      token: { code: 'A1B2C3', purpose: 'INVITE', tier: 2 },
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetcher)

    await expect(createCompany()).resolves.toEqual({ ok: true, value: 'A1B2C3' })
    expect(fetcher).toHaveBeenCalledOnce()
    expect(fetcher.mock.calls[0][0]).toBe('/api/companies')
    expect(fetcher.mock.calls[0][1]).toMatchObject({ method: 'POST', body: '{}' })
  })

  test('conserva la credencial que reserva el UUID al confirmar REGISTER', async () => {
    const fetcher = vi.fn(async (..._args: Parameters<typeof fetch>) => new Response(JSON.stringify({
      ok: true,
      registrationToken: 'registro-temporal',
      token: {
        purpose: 'REGISTER',
        usedBy: [{ at: '2026-08-18T23:44:04.989Z', by: '11111111-1111-4111-8111-111111111111' }],
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetcher)

    await expect(confirmCode(ANA, '123456', 'register')).resolves.toEqual({
      ok: true,
      value: { member: null, registrationToken: 'registro-temporal' },
    })
    const sent = JSON.parse(String(fetcher.mock.calls[0][1]?.body))
    expect(sent).toMatchObject({ action: 'spend', purpose: 'REGISTER', code: '123456' })
  })

  test('crea la cuenta en /api/registrations y abre la sesión con userId', async () => {
    const userId = '11111111-1111-4111-8111-111111111111'
    const fetcher = vi.fn(async (..._args: Parameters<typeof fetch>) => new Response(JSON.stringify({
      ok: true,
      token: 'session-token',
      userId,
      user: {
        id: userId, fullName: 'Ana Torres', email: 'ana@example.com',
        phoneCode: '+52', phone: '5512345678', language: 'es',
        role: 'ADMINISTRADOR', title: '', suspension: null,
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetcher)

    const registered = await registerAccount({
      fullName: 'Ana Torres', email: 'ana@example.com', phoneCode: '+52',
      phone: '5512345678', language: 'es', code: 'A1B2C3', registrationToken: 'registro-temporal',
      password: 'Clave-Segura1',
    })
    expect(registered).toEqual({ ok: true, value: userId })
    await startSession(userId)
    await expect(whoami()).resolves.toMatchObject({ id: userId, role: 'ADMINISTRADOR' })

    expect(fetcher.mock.calls[0][0]).toBe('/api/registrations')
    const sent = JSON.parse(String(fetcher.mock.calls[0][1]?.body))
    expect(sent).toMatchObject({
      phoneCode: '+52', language: 'es', code: 'A1B2C3', registrationToken: 'registro-temporal',
    })
    expect(sent).not.toHaveProperty('country')
  })
})
