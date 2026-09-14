import { describe, expect, test } from 'vitest'
import { createFleetHubApi, emptyState, normalizeState, STORE_VERSION } from './app.mjs'

function fixture(options = {}, initial = emptyState()) {
  let state = initial
  const savedPhotos = new Map()
  const api = createFleetHubApi({
    loadState: async () => structuredClone(state),
    saveState: async (next) => { state = structuredClone(next) },
    savePhoto: async (name, bytes) => { savedPhotos.set(name, Buffer.from(bytes)) },
    loadPhoto: async (name) => savedPhotos.get(name) ?? null,
    suggestAddresses: async () => ({ ok: true, suggestions: [] }),
    ...options,
  })
  return { api, state: () => state, savedPhotos }
}

describe('API compartida por local y Netlify', () => {
  test('publica las reglas de contraseña sin depender del transporte HTTP de Node', async () => {
    const { api } = fixture()
    const response = await api(new Request('https://fleethub.test/api/users/password'))

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      ok: true,
      rules: { 'min-length': '/.{8,}/su' },
      reject: ['only-digits'],
    })
  })

  test('persiste una compañía y su invitación inicial en el almacén proporcionado', async () => {
    const { api, state } = fixture()
    const response = await api(new Request('https://fleethub.test/api/companies', { method: 'POST' }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.code).toMatch(/^[0-9A-F]{6}$/)
    expect(state().rows.companies).toHaveLength(1)
    expect(state().tokens).toHaveLength(1)
    expect(state().tokens[0].companyId).toBe(state().rows.companies[0].id)
  })

  test('responde CORS antes de tocar el almacén', async () => {
    const { api } = fixture()
    const response = await api(new Request('https://fleethub.test/api/vehicles', { method: 'OPTIONS' }))

    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-methods')).toContain('POST')
  })

  test('en producción entrega el OTP fuera de la respuesta', async () => {
    const delivered = []
    const { api } = fixture({
      exposeAuthCodes: false,
      deliverCode: async (message) => { delivered.push(message); return { ok: true } },
    })
    const response = await api(new Request('https://fleethub.test/api/tokens', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-nf-client-connection-ip': '203.0.113.2' },
      body: JSON.stringify({ purpose: 'REGISTER', addressee: 'persona@example.com' }),
    }))
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body).not.toHaveProperty('code')
    expect(delivered).toHaveLength(1)
    expect(delivered[0]).toMatchObject({ addressee: 'persona@example.com', purpose: 'REGISTER' })
  })

  test('rechaza OTP de producción cuando no hay entrega configurada', async () => {
    const { api } = fixture({ exposeAuthCodes: false })
    const response = await api(new Request('https://fleethub.test/api/tokens', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-nf-client-connection-ip': '203.0.113.3' },
      body: JSON.stringify({ purpose: 'REGISTER', addressee: 'persona@example.com' }),
    }))
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ error: 'CODE_DELIVERY_NOT_CONFIGURED' })
  })

  test('migra el estado 13 sin borrar recursos y les asigna compañía', () => {
    const old = emptyState()
    old.version = 13
    old.rows.companies.push({ id: 'company-1', createdAt: '2026-08-20T00:00:00.000Z' })
    old.rows.locations.push({ id: 'location-1', name: 'Patio' })
    old.rows.vehicles.push({ vin: '1HGCM82633A004352' })
    const migrated = normalizeState(old)
    expect(migrated.version).toBe(STORE_VERSION)
    expect(migrated.rows.locations[0]).toMatchObject({ id: 'location-1', companyId: 'company-1' })
    expect(migrated.rows.vehicles[0]).toMatchObject({ vin: '1HGCM82633A004352', companyId: 'company-1' })
  })

  test('migra el estado 14: el rol pasa a ser el nivel y sin quedar texto', () => {
    // Es el almacén que hay hoy en producción: quien administra lo tiene
    // escrito con letras. Si esto no corriera, entraría como visitante.
    const old = emptyState()
    old.version = 14
    old.rows.companies.push({ id: 'company-1', createdAt: '2026-08-20T00:00:00.000Z' })
    old.rows.users.push(
      { id: 'user-1', companyId: 'company-1', role: 'ADMINISTRADOR', title: 'Jefe de patio' },
      { id: 'user-2', companyId: 'company-1', role: 'OPERADOR' },
      { id: 'user-3', companyId: 'company-1' },
    )
    old.rows.vehicles.push({ vin: '1HGCM82633A004352', companyId: 'company-1', createdBy: 'user-1' })
    old.maintenance = { sweptOn: '2026-08-20' }

    const migrated = normalizeState(old)

    expect(migrated.version).toBe(STORE_VERSION)
    expect(migrated.rows.users.map((row) => row.role)).toEqual([2, 1, 0])
    expect(migrated.rows.users[0]).not.toHaveProperty('title')
    expect(migrated.rows.vehicles[0]).not.toHaveProperty('createdBy')
    expect(migrated).not.toHaveProperty('maintenance')
  })

  test('una v13 llega hasta la última pasando por todas, no de un salto', () => {
    const old = emptyState()
    old.version = 13
    old.rows.companies.push({ id: 'company-1', createdAt: '2026-08-20T00:00:00.000Z' })
    old.rows.users.push({ id: 'user-1', companyId: 'company-1', role: 'ADMINISTRADOR' })

    // Saltarse la 14 dejaría el rol en texto y a esa cuenta sin administrar.
    expect(normalizeState(old).rows.users[0].role).toBe(2)
  })

  test('cerrar sesión invalida el bearer token en el servidor', async () => {
    const initial = emptyState()
    initial.rows.users.push({ id: 'user-1', companyId: 'company-1' })
    initial.sessions.secret = { userId: 'user-1', until: '2099-01-01T00:00:00.000Z' }
    const { api, state } = fixture({}, initial)
    const response = await api(new Request('https://fleethub.test/api/sessions/current', {
      method: 'DELETE', headers: { authorization: 'Bearer secret' },
    }))
    expect(response.status).toBe(200)
    expect(state().sessions).not.toHaveProperty('secret')
  })

  test('limita la emisión repetida de códigos por origen y destinatario', async () => {
    const { api } = fixture({ exposeAuthCodes: true })
    let response
    for (let attempt = 0; attempt < 6; attempt += 1) {
      response = await api(new Request('https://fleethub.test/api/tokens', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-nf-client-connection-ip': '203.0.113.9' },
        body: JSON.stringify({ purpose: 'REGISTER', addressee: 'limit@example.com' }),
      }))
    }
    expect(response.status).toBe(429)
    expect(await response.json()).toMatchObject({ error: 'RATE_LIMITED' })
  })

  test('sube una foto al VIN correcto y conserva compañía y operador', async () => {
    const initial = emptyState()
    initial.rows.users.push({
      id: 'operator-1', companyId: 'company-1', role: 'OPERADOR', suspension: null,
    })
    initial.rows.vehicles.push({ vin: '1HGCM82633A004352', companyId: 'company-1' })
    initial.sessions.secret = { userId: 'operator-1', until: '2099-01-01T00:00:00.000Z' }
    const { api, state, savedPhotos } = fixture({}, initial)
    const onePixelPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+H9Z8WQAAAABJRU5ErkJggg==',
      'base64',
    )
    const response = await api(new Request('https://fleethub.test/api/vehicles/1HGCM82633A004352/photos', {
      method: 'POST',
      headers: { authorization: 'Bearer secret', 'content-type': 'image/png' },
      body: onePixelPng,
    }))
    expect(response.status).toBe(200)
    expect(state().rows.photos[0]).toMatchObject({
      companyId: 'company-1', vin: '1HGCM82633A004352', uploadedBy: 'operator-1',
    })
    expect(savedPhotos.size).toBe(1)
  })
})
