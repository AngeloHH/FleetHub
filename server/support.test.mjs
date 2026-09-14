// El acceso de soporte, de punta a punta y contra la API real.
//
// Lo que se comprueba aquí no es que la clase Grants sepa sumar horas —eso
// está en grants.test.mjs— sino que la ventana la abra el servidor, que con
// ella una cuenta de FleetHub vea lo de esa empresa y sólo esa, y que cerrarla
// devuelva las cosas a su sitio.

import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { createFleetHubApi, emptyState } from './app.mjs'

const SOPORTE = 'soporte@fleethub.test'

function fixture() {
  let state = emptyState()
  const photos = new Map()
  const api = createFleetHubApi({
    loadState: async () => structuredClone(state),
    saveState: async (next) => { state = structuredClone(next) },
    savePhoto: async (name, bytes) => { photos.set(name, Buffer.from(bytes)) },
    loadPhoto: async (name) => photos.get(name) ?? null,
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
  return { call, state: () => state }
}

/** Funda una empresa y da de alta a su primer administrador. */
async function company(call, email, phone) {
  const founded = await call('/api/companies', { method: 'POST', body: {} })
  const asked = await call('/api/tokens', {
    method: 'POST',
    body: { purpose: 'REGISTER', addressee: email, email },
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
  expect(registered.status).toBe(200)
  return { token: registered.body.token, user: registered.body.user }
}

/** Da de alta a alguien más dentro de una empresa ya fundada. */
async function join(call, adminToken, { email, phone, role }) {
  const invited = await call('/api/tokens', {
    method: 'POST',
    body: { purpose: 'INVITE', role },
    token: adminToken,
  })
  const asked = await call('/api/tokens', {
    method: 'POST',
    body: { purpose: 'REGISTER', addressee: email, email },
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
  expect(registered.status).toBe(200)
  return { token: registered.body.token, user: registered.body.user }
}

const supportKey = (call, adminToken) =>
  call('/api/tokens', { method: 'POST', body: { purpose: 'INVITE', tier: 3 }, token: adminToken })

let previousStaff

beforeEach(() => {
  previousStaff = process.env.FLEETHUB_STAFF_EMAILS
  process.env.FLEETHUB_STAFF_EMAILS = SOPORTE
})

afterEach(() => {
  if (previousStaff === undefined) delete process.env.FLEETHUB_STAFF_EMAILS
  else process.env.FLEETHUB_STAFF_EMAILS = previousStaff
})

describe('acceso de soporte', () => {
  test('sólo una cuenta de FleetHub puede gastar una llave de soporte', async () => {
    const { call } = fixture()
    const admin = await company(call, 'admin-a@example.com', '5512340001')
    const operator = await join(call, admin.token, {
      email: 'operador-a@example.com', phone: '5512340002', role: 'OPERADOR',
    })
    const key = await supportKey(call, admin.token)

    const refused = await call('/api/grants', {
      method: 'POST', body: { code: key.body.code }, token: operator.token,
    })
    expect(refused).toMatchObject({ status: 403, body: { error: 'NOT_STAFF' } })
  })

  test('la ventana la abre el servidor y aparece en la lista de la empresa', async () => {
    const { call } = fixture()
    const admin = await company(call, 'admin-a@example.com', '5512340001')
    const other = await company(call, 'admin-b@example.com', '5512340003')
    const staff = await join(call, other.token, {
      email: SOPORTE, phone: '5512340004', role: 'OPERADOR',
    })
    const key = await supportKey(call, admin.token)

    const opened = await call('/api/grants', {
      method: 'POST', body: { code: key.body.code }, token: staff.token,
    })
    expect(opened.status).toBe(200)
    expect(opened.body.grant).toMatchObject({
      userId: staff.user.id,
      companyId: admin.user.companyId,
      live: true,
    })

    const seenByCompany = await call('/api/grants', { token: admin.token })
    expect(seenByCompany.body.grants).toHaveLength(1)
    expect(seenByCompany.body.grants[0].id).toBe(opened.body.grant.id)
    expect(seenByCompany.body.open).toBeNull()
  })

  test('con la ventana abierta se ve la empresa visitada, no la propia', async () => {
    const { call } = fixture()
    const admin = await company(call, 'admin-a@example.com', '5512340001')
    const other = await company(call, 'admin-b@example.com', '5512340003')
    const staff = await join(call, other.token, {
      email: SOPORTE, phone: '5512340004', role: 'OPERADOR',
    })

    const before = await call('/api/users', { token: staff.token })
    expect(before.body.users.map((user) => user.email).sort())
      .toEqual(['admin-b@example.com', SOPORTE])

    const key = await supportKey(call, admin.token)
    await call('/api/grants', { method: 'POST', body: { code: key.body.code }, token: staff.token })

    const during = await call('/api/users', { token: staff.token })
    expect(during.body.users.map((user) => user.email).sort())
      .toEqual(['admin-a@example.com', SOPORTE])
    // Con la ventana puesta puede lo que puede administración de esa empresa.
    const invited = await call('/api/tokens', {
      method: 'POST', body: { purpose: 'INVITE', role: 'OPERADOR' }, token: staff.token,
    })
    expect(invited.status).toBe(200)
    expect(invited.body.token.companyId).toBe(admin.user.companyId)
  })

  test('cerrarla devuelve la sesión a su propia empresa y conserva la fila', async () => {
    const { call } = fixture()
    const admin = await company(call, 'admin-a@example.com', '5512340001')
    const other = await company(call, 'admin-b@example.com', '5512340003')
    const staff = await join(call, other.token, {
      email: SOPORTE, phone: '5512340004', role: 'OPERADOR',
    })
    const key = await supportKey(call, admin.token)
    const opened = await call('/api/grants', {
      method: 'POST', body: { code: key.body.code }, token: staff.token,
    })

    const closed = await call(`/api/grants/${opened.body.grant.id}`, {
      method: 'DELETE', token: staff.token,
    })
    expect(closed.status).toBe(200)
    expect(closed.body.grant.live).toBe(false)

    const after = await call('/api/users', { token: staff.token })
    expect(after.body.users.map((user) => user.email).sort())
      .toEqual(['admin-b@example.com', SOPORTE])
    const audit = await call('/api/grants', { token: admin.token })
    expect(audit.body.grants).toHaveLength(1)
  })

  test('administración de la empresa visitada puede cerrarla', async () => {
    const { call } = fixture()
    const admin = await company(call, 'admin-a@example.com', '5512340001')
    const other = await company(call, 'admin-b@example.com', '5512340003')
    const staff = await join(call, other.token, {
      email: SOPORTE, phone: '5512340004', role: 'OPERADOR',
    })
    const key = await supportKey(call, admin.token)
    const opened = await call('/api/grants', {
      method: 'POST', body: { code: key.body.code }, token: staff.token,
    })

    const closed = await call(`/api/grants/${opened.body.grant.id}`, {
      method: 'DELETE', token: admin.token,
    })
    expect(closed.status).toBe(200)

    // La de otra empresa no: la ventana no es suya y no puede ni verla.
    const secondKey = await supportKey(call, admin.token)
    const reopened = await call('/api/grants', {
      method: 'POST', body: { code: secondKey.body.code }, token: staff.token,
    })
    const foreign = await call(`/api/grants/${reopened.body.grant.id}`, {
      method: 'DELETE', token: other.token,
    })
    expect(foreign.status).toBe(403)
  })

  test('la llave de soporte sólo sirve una vez', async () => {
    const { call } = fixture()
    const admin = await company(call, 'admin-a@example.com', '5512340001')
    const other = await company(call, 'admin-b@example.com', '5512340003')
    const staff = await join(call, other.token, {
      email: SOPORTE, phone: '5512340004', role: 'OPERADOR',
    })
    const key = await supportKey(call, admin.token)
    const opened = await call('/api/grants', {
      method: 'POST', body: { code: key.body.code }, token: staff.token,
    })
    await call(`/api/grants/${opened.body.grant.id}`, { method: 'DELETE', token: staff.token })

    const again = await call('/api/grants', {
      method: 'POST', body: { code: key.body.code }, token: staff.token,
    })
    expect(again.status).toBe(409)
    expect(again.body.error).toBe('USED')
  })

  test('una llave de alta no abre una ventana de soporte', async () => {
    const { call } = fixture()
    const admin = await company(call, 'admin-a@example.com', '5512340001')
    const other = await company(call, 'admin-b@example.com', '5512340003')
    const staff = await join(call, other.token, {
      email: SOPORTE, phone: '5512340004', role: 'OPERADOR',
    })
    const invite = await call('/api/tokens', {
      method: 'POST', body: { purpose: 'INVITE', role: 'OPERADOR' }, token: admin.token,
    })

    const refused = await call('/api/grants', {
      method: 'POST', body: { code: invite.body.code }, token: staff.token,
    })
    expect(refused).toMatchObject({ status: 400, body: { error: 'NOT_A_SUPPORT_KEY' } })
  })

  test('nadie puede declararse soporte al registrarse', async () => {
    const { call, state } = fixture()
    const founded = await call('/api/companies', { method: 'POST', body: {} })
    const email = 'listo@example.com'
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
        fullName: 'Persona Lista', email, phoneCode: '+52', phone: '5512349999',
        language: 'es', password: 'Clave-Segura1', code: founded.body.code,
        registrationToken: confirmed.body.registrationToken,
        // Los campos internos del alta pública no se aceptan ni se guardan.
        staff: true, role: 'ADMINISTRADOR', companyId: 'otra', suspension: null,
      },
    })

    expect(registered.body.user.staff).toBe(false)
    expect(state().rows.users[0]).not.toHaveProperty('staff')
    expect(state().rows.users[0].companyId).not.toBe('otra')
  })
})
