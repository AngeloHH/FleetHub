// Borrar una compañía: quién puede y con qué ceremonia por la API, y qué se
// lleva por delante la función que lo hace.

import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { createFleetHubApi, emptyState } from './app.mjs'
import { purgeCompany } from './deletion.mjs'

const SOPORTE = 'soporte@fleethub.test'

function fixture() {
  let state = emptyState()
  const photos = new Map()
  const removed = []
  const api = createFleetHubApi({
    loadState: async () => structuredClone(state),
    saveState: async (next) => { state = structuredClone(next) },
    savePhoto: async (name, bytes) => { photos.set(name, Buffer.from(bytes)) },
    loadPhoto: async (name) => photos.get(name) ?? null,
    removePhoto: async (name) => { removed.push(name); photos.delete(name) },
    suggestAddresses: async () => ({ ok: true, suggestions: [] }),
  })
  const call = async (path, { method = 'GET', body, token } = {}) => {
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
  /** Escribe directamente en el almacén, para llegar a un estado sin recorrer
   *  toda la aplicación cuando lo que se prueba está al otro lado. */
  const seed = (change) => { change(state) }
  return { call, state: () => state, seed, removedPhotos: () => removed }
}

async function company(call, email, phone) {
  const founded = await call('/api/companies', { method: 'POST', body: {} })
  const asked = await call('/api/tokens', {
    method: 'POST', body: { purpose: 'REGISTER', addressee: email, email },
  })
  const confirmed = await call('/api/tokens', {
    method: 'POST',
    body: { action: 'spend', purpose: 'REGISTER', addressee: email, code: asked.body.code },
  })
  const registered = await call('/api/registrations', {
    method: 'POST',
    body: {
      fullName: 'Administradora', email, phoneCode: '+52', phone, language: 'es',
      password: 'Clave-Segura1', code: founded.body.code,
      registrationToken: confirmed.body.registrationToken,
    },
  })
  return { token: registered.body.token, user: registered.body.user }
}

async function join(call, adminToken, { email, phone, role }) {
  const invited = await call('/api/tokens', {
    method: 'POST', body: { purpose: 'INVITE', role }, token: adminToken,
  })
  const asked = await call('/api/tokens', {
    method: 'POST', body: { purpose: 'REGISTER', addressee: email, email },
  })
  const confirmed = await call('/api/tokens', {
    method: 'POST',
    body: { action: 'spend', purpose: 'REGISTER', addressee: email, code: asked.body.code },
  })
  const registered = await call('/api/registrations', {
    method: 'POST',
    body: {
      fullName: 'Persona', email, phoneCode: '+52', phone, language: 'es',
      password: 'Clave-Segura1', code: invited.body.code,
      registrationToken: confirmed.body.registrationToken,
    },
  })
  return { token: registered.body.token, user: registered.body.user }
}

let previousStaff

beforeEach(() => {
  previousStaff = process.env.FLEETHUB_STAFF_EMAILS
  process.env.FLEETHUB_STAFF_EMAILS = SOPORTE
})

afterEach(() => {
  if (previousStaff === undefined) delete process.env.FLEETHUB_STAFF_EMAILS
  else process.env.FLEETHUB_STAFF_EMAILS = previousStaff
})

describe('eliminar la compañía', () => {
  test('hace falta confirmar con el identificador de la compañía', async () => {
    const { call, state } = fixture()
    const admin = await company(call, 'admin-a@example.com', '5512340001')

    const sinConfirmar = await call('/api/companies/current', { method: 'DELETE', token: admin.token })
    expect(sinConfirmar).toMatchObject({ status: 400, body: { error: 'CONFIRMATION_REQUIRED' } })

    const conOtro = await call('/api/companies/current?confirm=otra-cosa', {
      method: 'DELETE', token: admin.token,
    })
    expect(conOtro.status).toBe(400)
    expect(state().rows.companies).toHaveLength(1)
  })

  test('un operador no puede eliminar la compañía en la que trabaja', async () => {
    const { call, state } = fixture()
    const admin = await company(call, 'admin-a@example.com', '5512340001')
    const operator = await join(call, admin.token, {
      email: 'operador@example.com', phone: '5512340002', role: 'OPERADOR',
    })

    const refused = await call(`/api/companies/current?confirm=${admin.user.companyId}`, {
      method: 'DELETE', token: operator.token,
    })
    expect(refused).toMatchObject({ status: 403, body: { error: 'FORBIDDEN' } })
    expect(state().rows.companies).toHaveLength(1)
  })

  test('sin sesión tampoco', async () => {
    const { call } = fixture()
    const admin = await company(call, 'admin-a@example.com', '5512340001')
    const refused = await call(`/api/companies/current?confirm=${admin.user.companyId}`, { method: 'DELETE' })
    expect(refused).toMatchObject({ status: 401, body: { error: 'UNAUTHORIZED' } })
  })

  test('una ventana de soporte presta lo de administración, no esta decisión', async () => {
    const { call, state } = fixture()
    const visited = await company(call, 'admin-a@example.com', '5512340001')
    const own = await company(call, 'admin-b@example.com', '5512340003')
    const staff = await join(call, own.token, {
      email: SOPORTE, phone: '5512340004', role: 'OPERADOR',
    })
    const key = await call('/api/tokens', {
      method: 'POST', body: { purpose: 'INVITE', tier: 3 }, token: visited.token,
    })
    await call('/api/grants', { method: 'POST', body: { code: key.body.code }, token: staff.token })

    const refused = await call(`/api/companies/current?confirm=${visited.user.companyId}`, {
      method: 'DELETE', token: staff.token,
    })
    expect(refused.status).toBe(403)
    expect(state().rows.companies).toHaveLength(2)
  })

  test('confirmada, no queda nada suyo y lo de la otra compañía sigue', async () => {
    const { call, state } = fixture()
    const admin = await company(call, 'admin-a@example.com', '5512340001')
    const other = await company(call, 'admin-b@example.com', '5512340003')
    await join(call, admin.token, {
      email: 'operador@example.com', phone: '5512340002', role: 'OPERADOR',
    })

    const gone = await call(`/api/companies/current?confirm=${admin.user.companyId}`, {
      method: 'DELETE', token: admin.token,
    })
    expect(gone.status).toBe(200)
    expect(gone.body.removed).toMatchObject({ companies: 1, users: 2 })

    expect(state().rows.companies.map((row) => row.id)).toEqual([other.user.companyId])
    expect(state().rows.users.map((row) => row.email)).toEqual(['admin-b@example.com'])
    // Y la sesión con la que se borró ya no vale para nada.
    const after = await call('/api/users', { token: admin.token })
    expect(after.status).toBe(401)
    // La de la otra compañía sí.
    expect((await call('/api/users', { token: other.token })).status).toBe(200)
  })

  test('las fotos de la compañía se borran también del almacenamiento', async () => {
    const { call, seed, state, removedPhotos } = fixture()
    const admin = await company(call, 'admin-a@example.com', '5512340001')
    seed((held) => {
      held.rows.vehicles.push({ vin: '3MVDMBBM2PM512094', companyId: admin.user.companyId })
      held.rows.photos.push({
        id: 'F-1', companyId: admin.user.companyId, vin: '3MVDMBBM2PM512094',
        createdAt: new Date().toISOString(), filename: 'F-1.jpg', contentType: 'image/jpeg',
      })
    })

    await call(`/api/companies/current?confirm=${admin.user.companyId}`, {
      method: 'DELETE', token: admin.token,
    })

    expect(state().rows.photos).toEqual([])
    expect(removedPhotos()).toEqual(['F-1.jpg'])
  })
})

// ── La función, sin pasar por HTTP ──────────────────────────────────────────

const NOW = new Date('2026-06-01T12:00:00.000Z')
const daysAgo = (n) => new Date(NOW.getTime() - n * 86_400_000).toISOString()
const inDays = (n) => new Date(NOW.getTime() + n * 86_400_000).toISOString()

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'

function state() {
  return {
    version: 14,
    rows: {
      companies: [{ id: A }, { id: B }],
      users: [
        { id: 'u-a', companyId: A, email: 'a@example.com' },
        { id: 'u-b', companyId: B, email: 'b@example.com' },
      ],
      locations: [{ id: 'l-a', companyId: A }, { id: 'l-b', companyId: B }],
      userLocations: [{ id: 'ul-a', companyId: A }, { id: 'ul-b', companyId: B }],
      vehicleLocations: [{ id: 'vl-a', companyId: A }],
      vehicles: [{ vin: 'V-A', companyId: A }, { vin: 'V-B', companyId: B }],
      vehiclePositions: [
        { id: 'p-vieja', companyId: A, createdAt: daysAgo(120) },
        { id: 'p-nueva', companyId: A, createdAt: daysAgo(2) },
        { id: 'p-sin-fecha', companyId: A },
      ],
      events: [
        { id: 'e-vieja', companyId: A, createdAt: daysAgo(900) },
        { id: 'e-nueva', companyId: B, createdAt: daysAgo(5) },
      ],
      photos: [
        { id: 'f-vieja', companyId: A, createdAt: daysAgo(900), filename: 'f-vieja.jpg' },
        { id: 'f-nueva', companyId: A, createdAt: daysAgo(5), filename: 'f-nueva.jpg' },
      ],
      dismissals: [
        { id: 'd-vieja', companyId: A, createdAt: daysAgo(400) },
        { id: 'd-nueva', companyId: A, createdAt: daysAgo(1) },
      ],
      grants: [
        { id: 'g-vieja', companyId: A, userId: 'u-b', grantedAt: daysAgo(900) },
        { id: 'g-nueva', companyId: A, userId: 'u-b', grantedAt: daysAgo(1) },
      ],
    },
    sessions: {
      viva: { userId: 'u-a', until: inDays(1) },
      caducada: { userId: 'u-a', until: daysAgo(1) },
      'de-b': { userId: 'u-b', until: inDays(1) },
    },
    tokens: [
      { code: 'VIVA01', companyId: A, expiresAt: inDays(1), usedBy: [] },
      { code: 'GASTADA', companyId: A, expiresAt: daysAgo(90), usedBy: [{ at: daysAgo(90), by: 'u-a' }] },
      { code: 'CADUCADA', companyId: B, expiresAt: daysAgo(90), usedBy: [] },
      { code: 'RECIENTE', companyId: A, expiresAt: daysAgo(2), usedBy: [] },
      { owner: 'derivado', createdBy: 'u-a', expiresAt: daysAgo(90), usedBy: [] },
    ],
    rateLimits: {
      vencido: { count: 3, resetAt: NOW.getTime() - 1_000 },
      vigente: { count: 1, resetAt: NOW.getTime() + 60_000 },
    },
  }
}

describe('lo que borra purgeCompany', () => {
  test('se lleva todo lo suyo y no toca lo de la otra', () => {
    const held = state()
    const purged = purgeCompany(held, A)

    expect(purged.ok).toBe(true)
    expect(held.rows.companies.map((row) => row.id)).toEqual([B])
    expect(held.rows.users.map((row) => row.id)).toEqual(['u-b'])
    expect(held.rows.locations.map((row) => row.id)).toEqual(['l-b'])
    expect(held.rows.userLocations.map((row) => row.id)).toEqual(['ul-b'])
    expect(held.rows.vehicleLocations).toEqual([])
    expect(held.rows.vehicles.map((row) => row.vin)).toEqual(['V-B'])
    expect(held.rows.vehiclePositions).toEqual([])
    expect(held.rows.events.map((row) => row.id)).toEqual(['e-nueva'])
    expect(held.rows.photos).toEqual([])
    expect(held.rows.dismissals).toEqual([])
    expect(held.rows.grants).toEqual([])
  })

  test('se lleva sus llaves, incluidas las dirigidas que pidió su gente', () => {
    const held = state()
    purgeCompany(held, A)
    expect(held.tokens.map((row) => row.code ?? row.owner)).toEqual(['CADUCADA'])
  })

  test('cierra las sesiones de su gente y deja abiertas las demás', () => {
    const held = state()
    purgeCompany(held, A)
    expect(Object.keys(held.sessions)).toEqual(['de-b'])
  })

  test('dice qué fotos hay que borrar del almacenamiento', () => {
    expect(purgeCompany(state(), A).orphanedPhotos).toEqual(['f-vieja.jpg', 'f-nueva.jpg'])
  })

  test('una compañía que no existe no borra nada', () => {
    const held = state()
    expect(purgeCompany(held, 'no-existe')).toMatchObject({ ok: false, error: 'UNKNOWN_COMPANY' })
    expect(purgeCompany(held, '')).toMatchObject({ ok: false, error: 'UNKNOWN_COMPANY' })
    expect(held.rows.users).toHaveLength(2)
  })
})
