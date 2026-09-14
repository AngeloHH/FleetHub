// La comprobación de salud, que es la que mira el monitor.
//
// Tiene prueba propia por un motivo que ya pasó una vez: es la única ruta que
// nadie de la aplicación usa, así que puede desaparecer sin que ninguna
// pantalla se rompa y sin que nadie se entere hasta que el monitor lleva una
// semana diciendo que todo va bien porque nunca preguntó nada.

import { describe, expect, test, vi } from 'vitest'
import { createFleetHubApi, emptyState, STORE_VERSION } from './app.mjs'

function fixture({ loadState } = {}) {
  let held = emptyState()
  const photos = new Map()
  const api = createFleetHubApi({
    loadState: loadState ?? (async () => structuredClone(held)),
    saveState: async (next) => { held = structuredClone(next) },
    savePhoto: async (name, bytes) => { photos.set(name, Buffer.from(bytes)) },
    loadPhoto: async (name) => photos.get(name) ?? null,
    reporter: { capture: vi.fn(), notify: vi.fn() },
  })
  return { api }
}

/** El mismo montaje, con el almacén y sus escrituras a la vista. */
function watched() {
  let held = emptyState()
  const saveState = vi.fn(async (next) => { held = structuredClone(next) })
  const api = createFleetHubApi({
    loadState: async () => ({ state: structuredClone(held), revision: held.revision ?? 0 }),
    saveState,
    savePhoto: async () => {},
    loadPhoto: async () => null,
    reporter: { capture: vi.fn(), notify: vi.fn() },
  })
  return { api, saveState, state: () => held }
}

const ask = (api, { method = 'GET' } = {}) =>
  api(new Request('https://fleethub.test/api/health', { method }))

const health = (api) => ask(api)

describe('/api/health', () => {
  test('contesta sin sesión y dice qué servicio es', async () => {
    const { api } = fixture()
    const response = await ask(api)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/json')
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      service: 'fleethub-api',
      storeVersion: STORE_VERSION,
    })
  })

  test('no cuenta nada de dentro', async () => {
    const { api } = fixture()
    const body = await (await ask(api)).json()

    for (const forbidden of ['rows', 'sessions', 'tokens', 'users', 'companies', 'quotas'])
      expect(body).not.toHaveProperty(forbidden)
  })

  test('un HEAD vale igual, que es lo que manda media herramienta', async () => {
    const { api } = fixture()
    expect((await ask(api, { method: 'HEAD' })).status).toBe(200)
  })

  test('con el almacén caído no finge que todo va bien', async () => {
    const { api } = fixture({ loadState: async () => { throw new Error('sin almacén') } })
    const response = await ask(api)

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({ ok: false, error: 'STORE_UNAVAILABLE' })
  })

  test('lleva las mismas cabeceras de seguridad que el resto', async () => {
    const { api } = fixture()
    const response = await ask(api)

    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('x-frame-options')).toBe('DENY')
    expect(response.headers.get('cache-control')).toBe('no-store')
  })
})

describe('la comprobación de salud no toca nada', () => {
  test('no escribe en el almacén, ni siquiera la primera vez del día', async () => {
    const { api, saveState, state } = watched()

    await health(api)
    await health(api)

    expect(saveState).not.toHaveBeenCalled()
    expect(state().revision).toBe(0)
  })

  test('no puede recibir el 409 de una escritura ajena', async () => {
    // Un almacén que rechaza absolutamente todas las escrituras: cualquier
    // ruta que escribiera contestaría 409.
    const held = emptyState()
    const api = createFleetHubApi({
      loadState: async () => ({ state: structuredClone(held), revision: 'vieja' }),
      saveState: async () => ({ ok: false }),
      savePhoto: async () => {},
      loadPhoto: async () => null,
      reporter: { capture: vi.fn(), notify: vi.fn() },
    })

    const response = await health(api)
    expect(response.status).toBe(200)

    // Y para que la prueba diga algo: otra ruta cualquiera sí choca.
    const conflicted = await api(new Request('https://fleethub.test/api/companies', { method: 'POST' }))
    expect(conflicted.status).toBe(409)
    await expect(conflicted.json()).resolves.toMatchObject({ error: 'WRITE_CONFLICT' })
    expect(held.rows.companies).toEqual([])
  })
})
