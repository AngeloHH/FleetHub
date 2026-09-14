// Dos peticiones a la vez, y dos compañías a la vez.
//
// Son las dos formas de que el estado de una empresa acabe siendo mentira: que
// dos escrituras simultáneas se pisen, y que una compañía lea o toque lo de
// otra. La primera se comprueba lanzando peticiones en paralelo contra un
// almacén que tarda en escribir; la segunda, montando dos compañías completas
// y pidiéndole a cada una lo de la contraria.

import { describe, expect, test } from 'vitest'
import { createFleetHubApi, emptyState } from './app.mjs'

/**
 * Un almacén que se comporta como el de verdad: lee, tarda, y sólo escribe si
 * nadie escribió entre medias. La tardanza es la que abre la ventana en la que
 * dos peticiones pueden pisarse.
 */
function store({ delay = 0 } = {}) {
  let held = emptyState()
  const writes = { attempted: 0, refused: 0 }
  return {
    writes,
    state: () => held,
    loadState: async () => ({ state: structuredClone(held), revision: held.revision ?? 0 }),
    saveState: async (next, { revision } = {}) => {
      writes.attempted += 1
      if (delay) await new Promise((resume) => setTimeout(resume, delay))
      if (revision !== undefined && (held.revision ?? 0) !== revision) {
        writes.refused += 1
        return { ok: false }
      }
      held = structuredClone(next)
      return { ok: true }
    },
  }
}

function fixture(options) {
  const disk = store(options)
  const photos = new Map()
  const api = createFleetHubApi({
    loadState: disk.loadState,
    saveState: disk.saveState,
    savePhoto: async (name, bytes) => { photos.set(name, Buffer.from(bytes)) },
    loadPhoto: async (name) => photos.get(name) ?? null,
    suggestAddresses: async () => ({ ok: true, suggestions: [] }),
  })
  const call = (path, { method = 'GET', body, token } = {}) =>
    api(new Request(`https://fleethub.test${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })).then(async (response) => ({ status: response.status, body: await response.json() }))
  return { call, disk }
}

async function company(call, { email, phone }) {
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
  expect(registered.status).toBe(200)
  return { token: registered.body.token, user: registered.body.user }
}

/** Una compañía con una location, un vehículo asignado y su administradora dentro. */
async function outfit(call, { email, phone, name, vin }) {
  const admin = await company(call, { email, phone })
  const location = await call('/api/locations', {
    method: 'POST', token: admin.token,
    body: { name, points: [{ address: `${name} 1`, latitude: 25.76, longitude: -80.19 }] },
  })
  expect(location.status).toBe(200)
  const vehicle = await call('/api/vehicles', { method: 'POST', token: admin.token, body: { vin } })
  expect(vehicle.status).toBe(200)
  const assigned = await call(`/api/vehicles/${vin}/locations`, {
    method: 'POST', token: admin.token, body: { locationId: location.body.location.id },
  })
  expect(assigned.status).toBe(200)
  return { ...admin, locationId: location.body.location.id, vin }
}

describe('escrituras simultáneas', () => {
  test('la que llega tarde recibe 409 en lugar de borrar a la primera', async () => {
    const { call, disk } = fixture({ delay: 15 })
    const admin = await outfit(call, {
      email: 'a@example.com', phone: '5512340001', name: 'CENTRO', vin: '3MVDMBBM2PM512094',
    })

    // Dos cambios de estado a la vez sobre la misma unidad.
    const [first, second] = await Promise.all([
      call(`/api/vehicles/${admin.vin}/state`, { method: 'POST', token: admin.token, body: { state: 1 } }),
      call(`/api/vehicles/${admin.vin}/state`, { method: 'POST', token: admin.token, body: { state: 3 } }),
    ])

    const answers = [first.status, second.status].sort()
    expect(answers).toEqual([200, 409])
    expect(disk.writes.refused).toBe(1)
    // Y lo guardado es exactamente lo de la que ganó: un solo evento nuevo.
    const kept = disk.state().rows.events.filter((event) => event.kind === 'state')
    expect(kept).toHaveLength(1)
  })

  test('nada de lo que perdió el conflicto queda a medias', async () => {
    const { call, disk } = fixture({ delay: 15 })
    const admin = await outfit(call, {
      email: 'a@example.com', phone: '5512340001', name: 'CENTRO', vin: '3MVDMBBM2PM512094',
    })

    const [first, second] = await Promise.all([
      call('/api/locations', {
        method: 'POST', token: admin.token,
        body: { name: 'NORTE', points: [{ address: 'N 1', latitude: 25.8, longitude: -80.2 }] },
      }),
      call('/api/locations', {
        method: 'POST', token: admin.token,
        body: { name: 'SUR', points: [{ address: 'S 1', latitude: 25.7, longitude: -80.1 }] },
      }),
    ])

    expect([first.status, second.status].sort()).toEqual([200, 409])
    const names = disk.state().rows.locations.map((row) => row.name).sort()
    // La location de la petición que perdió no está a medias: no está.
    expect(names).toEqual(['CENTRO', first.status === 200 ? 'NORTE' : 'SUR'])
  })

  test('el reintento después del conflicto sí entra', async () => {
    const { call } = fixture({ delay: 15 })
    const admin = await outfit(call, {
      email: 'a@example.com', phone: '5512340001', name: 'CENTRO', vin: '3MVDMBBM2PM512094',
    })

    const [first, second] = await Promise.all([
      call(`/api/vehicles/${admin.vin}/state`, { method: 'POST', token: admin.token, body: { state: 1 } }),
      call(`/api/vehicles/${admin.vin}/state`, { method: 'POST', token: admin.token, body: { state: 3 } }),
    ])
    const lost = first.status === 409 ? { state: 1 } : { state: 3 }
    expect([first.status, second.status]).toContain(409)

    const again = await call(`/api/vehicles/${admin.vin}/state`, {
      method: 'POST', token: admin.token, body: lost,
    })
    expect(again.status).toBe(200)
    expect(again.body.vehicle.state).toBe(lost.state)
  })

  test('una lectura no falla porque su limpieza chocara', async () => {
    // El almacén rechaza todo. Una escritura recibe 409; una lectura que sólo
    // escribía por limpieza —una sesión caducada— contesta lo que iba a
    // contestar, porque sigue siendo cierto.
    const held = emptyState()
    const api = createFleetHubApi({
      loadState: async () => ({ state: structuredClone(held), revision: 'vieja' }),
      saveState: async () => ({ ok: false }),
      savePhoto: async () => {},
      loadPhoto: async () => null,
      suggestAddresses: async () => ({ ok: true, suggestions: [] }),
    })
    const sinSesion = await api(new Request('https://fleethub.test/api/vehicles'))
    expect(sinSesion.status).toBe(401)
    await expect(sinSesion.json()).resolves.toMatchObject({ error: 'UNAUTHORIZED' })
  })

  test('las lecturas simultáneas no chocan entre ellas', async () => {
    const { call, disk } = fixture({ delay: 5 })
    const admin = await outfit(call, {
      email: 'a@example.com', phone: '5512340001', name: 'CENTRO', vin: '3MVDMBBM2PM512094',
    })
    const before = disk.writes.attempted

    const answers = await Promise.all(
      Array.from({ length: 6 }, () => call('/api/vehicles', { token: admin.token })),
    )
    expect(answers.every((answer) => answer.status === 200)).toBe(true)
    // Leer no escribe: el contador de escrituras no se ha movido.
    expect(disk.writes.attempted).toBe(before)
  })
})

describe('dos compañías a la vez', () => {
  const build = async (call) => ({
    una: await outfit(call, {
      email: 'una@example.com', phone: '5512340001', name: 'CENTRO', vin: '3MVDMBBM2PM512094',
    }),
    otra: await outfit(call, {
      email: 'otra@example.com', phone: '5512340002', name: 'NORTE', vin: '1HGCM82633A004352',
    }),
  })

  test('cada una ve su flota y sólo la suya', async () => {
    const { call } = fixture()
    const { una, otra } = await build(call)

    const mine = await call('/api/vehicles', { token: una.token })
    const theirs = await call('/api/vehicles', { token: otra.token })

    expect(mine.body.vehicles.map((row) => row.vin)).toEqual([una.vin])
    expect(theirs.body.vehicles.map((row) => row.vin)).toEqual([otra.vin])
    expect(mine.body.companyId).not.toBe(theirs.body.companyId)
  })

  test('cada una ve a su gente y sólo a la suya', async () => {
    const { call } = fixture()
    const { una, otra } = await build(call)

    expect((await call('/api/users', { token: una.token })).body.users.map((row) => row.email))
      .toEqual(['una@example.com'])
    expect((await call('/api/users', { token: otra.token })).body.users.map((row) => row.email))
      .toEqual(['otra@example.com'])
  })

  test('cada una ve sus locations y sólo las suyas', async () => {
    const { call } = fixture()
    const { una, otra } = await build(call)

    expect((await call('/api/locations', { token: una.token })).body.locations.map((row) => row.name))
      .toEqual(['CENTRO'])
    expect((await call('/api/locations', { token: otra.token })).body.locations.map((row) => row.name))
      .toEqual(['NORTE'])
  })

  test('la unidad de la otra no existe: ni se lee, ni se cambia, ni se borra', async () => {
    const { call } = fixture()
    const { una, otra } = await build(call)

    for (const [path, options] of [
      [`/api/vehicles/${otra.vin}/details`, {}],
      [`/api/vehicles/${otra.vin}/positions`, {}],
      [`/api/vehicles/${otra.vin}/state`, { method: 'POST', body: { state: 1 } }],
      [`/api/vehicles/${otra.vin}/details`, { method: 'POST', body: { year: 2020, make: 'X', model: 'Y' } }],
      [`/api/vehicles/${otra.vin}/positions`, { method: 'POST', body: { latitude: 25.7, longitude: -80.1 } }],
      [`/api/vehicles/${otra.vin}/events`, { method: 'POST', body: { kind: 'attachments', note: 'hola' } }],
      [`/api/vehicles/${otra.vin}/locations`, { method: 'POST', body: { locationId: otra.locationId } }],
    ]) {
      const answer = await call(path, { ...options, token: una.token })
      expect({ path, method: options.method ?? 'GET', status: answer.status })
        .toMatchObject({ status: 404 })
    }
  })

  test('la persona de la otra no existe: ni se edita, ni se suspende, ni se borra', async () => {
    const { call } = fixture()
    const { una, otra } = await build(call)

    expect((await call(`/api/users/${otra.user.id}`, {
      method: 'POST', token: una.token, body: { fullName: 'Cambiada' },
    })).status).toBe(404)
    expect((await call(`/api/users/${otra.user.id}/suspension`, {
      method: 'POST', token: una.token, body: { suspension: 'admin' },
    })).status).toBe(404)
    expect((await call(`/api/users/${otra.user.id}`, {
      method: 'DELETE', token: una.token,
    })).status).toBe(404)
    expect((await call(`/api/users/${otra.user.id}/locations`, { token: una.token })).status).toBe(404)
  })

  test('la location de la otra no existe: ni se edita, ni se borra, ni se le asigna nada', async () => {
    const { call } = fixture()
    const { una, otra } = await build(call)

    expect((await call(`/api/locations/${otra.locationId}`, {
      method: 'POST', token: una.token, body: { name: 'ROBADA' },
    })).status).toBe(404)
    expect((await call(`/api/locations/${otra.locationId}`, {
      method: 'DELETE', token: una.token,
    })).status).toBe(404)
    expect((await call(`/api/locations/${otra.locationId}/points`, {
      method: 'POST', token: una.token, body: { address: 'A', latitude: 1, longitude: 1 },
    })).status).toBe(404)
  })

  test('no se puede cruzar una unidad propia con la location de la otra', async () => {
    const { call } = fixture()
    const { una, otra } = await build(call)

    const crossed = await call(`/api/vehicles/${una.vin}/locations`, {
      method: 'POST', token: una.token, body: { locationId: otra.locationId },
    })
    expect(crossed).toMatchObject({ status: 404, body: { error: 'LOCATION_NOT_FOUND' } })
  })

  test('no se puede asignar a alguien de la otra compañía a una location propia', async () => {
    const { call } = fixture()
    const { una, otra } = await build(call)

    const crossed = await call(`/api/users/${otra.user.id}/locations`, {
      method: 'POST', token: una.token, body: { locationId: una.locationId },
    })
    expect(crossed).toMatchObject({ status: 404, body: { error: 'USER_NOT_FOUND' } })
  })

  test('las llaves de una no valen ni se ven desde la otra', async () => {
    const { call } = fixture()
    const { una, otra } = await build(call)
    const invited = await call('/api/tokens', {
      method: 'POST', token: una.token, body: { purpose: 'INVITE', role: 'OPERADOR' },
    })

    const listed = await call('/api/tokens?purpose=INVITE&live=true', { token: otra.token })
    expect(listed.body.tokens.map((row) => row.code)).not.toContain(invited.body.code)
    expect((await call(`/api/tokens?code=${invited.body.code}`, { token: otra.token })).status).toBe(404)
    expect((await call('/api/tokens', {
      method: 'POST', token: otra.token, body: { action: 'revoke', code: invited.body.code },
    })).status).toBe(404)
  })

  test('los eventos, descartes y fotos de una no aparecen en la otra', async () => {
    const { call } = fixture()
    const { una, otra } = await build(call)
    await call(`/api/vehicles/${una.vin}/state`, {
      method: 'POST', token: una.token, body: { state: 1 },
    })
    await call('/api/dismissals', {
      method: 'POST', token: una.token, body: { vin: una.vin, alertId: `${una.vin}·sin-posicion`, title: 'X' },
    })

    const events = await call('/api/events', { token: otra.token })
    const dismissals = await call('/api/dismissals', { token: otra.token })
    expect(events.body.events).toEqual([])
    expect(dismissals.body.dismissals).toEqual([])

    const ours = await call('/api/events', { token: una.token })
    expect(ours.body.events.map((row) => row.vin)).toEqual([una.vin])
  })

  test('trabajar a la vez no mezcla nada', async () => {
    const { call } = fixture({ delay: 5 })
    const { una, otra } = await build(call)

    // Las dos compañías escribiendo a la vez. Alguna chocará; ninguna verá lo
    // de la otra, que es lo que aquí se comprueba.
    await Promise.all([
      call(`/api/vehicles/${una.vin}/state`, { method: 'POST', token: una.token, body: { state: 1 } }),
      call(`/api/vehicles/${otra.vin}/state`, { method: 'POST', token: otra.token, body: { state: 3 } }),
    ])

    const mine = await call('/api/vehicles', { token: una.token })
    const theirs = await call('/api/vehicles', { token: otra.token })
    expect(mine.body.vehicles.map((row) => row.vin)).toEqual([una.vin])
    expect(theirs.body.vehicles.map((row) => row.vin)).toEqual([otra.vin])
  })
})
