// El contrato y el servidor, atados el uno al otro.
//
// `endpoints.json` es la descripción del API que leen el frontend y quien
// venga después. Un documento escrito a mano se separa del código el mismo día
// que alguien añade una ruta con prisa, y a partir de ahí es peor que no
// tenerlo: dice cosas que ya no son ciertas con la misma seguridad con la que
// decía las que sí.
//
// Estas pruebas lo impiden por los dos lados. Toda ruta que el servidor atiende
// tiene que estar descrita, y toda ruta descrita tiene que existir de verdad —
// y «existir» se comprueba llamándola: si el servidor contesta su 404 de «esta
// dirección no es de nadie», la descripción está mintiendo.

import { describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { RESOURCES, isResource } from './resources.mjs'
import { createFleetHubApi, emptyState } from './app.mjs'

const contract = JSON.parse(readFileSync(new URL('../endpoints.json', import.meta.url), 'utf8'))

/**
 * Las rutas que no son recursos y por eso no están en RESOURCES: viven en
 * app.mjs porque se atienden antes de exigir sesión, o porque no devuelven
 * JSON. Aquí se nombran para que también se comprueben.
 */
const STANDALONE = [
  ['GET', '/api/health'],
  ['DELETE', '/api/sessions/current'],
  ['POST', '/api/companies'],
  ['DELETE', '/api/companies/current'],
  ['GET', '/api/users/password'],
  ['POST', '/api/users/password'],
  ['POST', '/api/registrations'],
  ['GET', '/api/tokens'],
  ['POST', '/api/tokens'],
  ['POST', '/api/vehicles/:vin/photos'],
  ['GET', '/api/photos/:id'],
]

/** Un ejemplo concreto de cada parámetro, para poder llamar de verdad. */
const SAMPLES = {
  ':userId': '11111111-1111-4111-8111-111111111111',
  ':locationId': '22222222-2222-4222-8222-222222222222',
  ':pointId': '33333333-3333-4333-8333-333333333333',
  ':vin': '3MVDMBBM2PM512094',
  ':id': 'F-ABC123',
}

const concrete = (url) =>
  url.replace(/:[A-Za-z]+/g, (name) => SAMPLES[name] ?? (() => { throw new Error(`sin ejemplo para ${name}`) })())

const methodsOf = (entry) =>
  String(entry.request?.method ?? 'GET').split('|').map((method) => method.trim()).filter(Boolean)

function fixture() {
  let held = emptyState()
  const photos = new Map()
  const api = createFleetHubApi({
    loadState: async () => structuredClone(held),
    saveState: async (next) => { held = structuredClone(next) },
    savePhoto: async (name, bytes) => { photos.set(name, Buffer.from(bytes)) },
    loadPhoto: async (name) => photos.get(name) ?? null,
    suggestAddresses: async () => ({ ok: true, suggestions: [] }),
  })
  return api
}

describe('endpoints.json describe lo que el servidor atiende', () => {
  test('cada recurso del servidor está descrito', () => {
    const described = contract.map((entry) => concrete(entry.url))
    const missing = RESOURCES.filter((pattern) => !described.some((url) => pattern.test(url)))
    expect(missing.map(String)).toEqual([])
  })

  test('cada ruta que vive fuera de RESOURCES está descrita', () => {
    const described = new Set(contract.flatMap((entry) =>
      methodsOf(entry).map((method) => `${method} ${entry.url}`)))
    const missing = STANDALONE
      .map(([method, url]) => `${method} ${url}`)
      .filter((line) => !described.has(line))
    expect(missing).toEqual([])
  })

  test('lo descrito no se solapa con lo que el servidor no reconoce', () => {
    // Toda dirección descrita es o un recurso autenticado o una de las que se
    // atienden aparte. Una tercera categoría sería una ruta huérfana.
    const standalone = new Set(STANDALONE.map(([, url]) => url))
    const orphans = contract
      .map((entry) => entry.url)
      .filter((url) => !standalone.has(url) && !isResource(concrete(url)))
    expect(orphans).toEqual([])
  })

  test('cada dirección descrita existe: ninguna cae en el 404 general', async () => {
    const api = fixture()
    const unrouted = []
    for (const entry of contract) {
      for (const method of methodsOf(entry)) {
        const response = await api(new Request(`https://fleethub.test${concrete(entry.url)}`, {
          method,
          headers: { 'content-type': 'application/json' },
          ...(method === 'GET' || method === 'HEAD' || method === 'DELETE' ? {} : { body: '{}' }),
        }))
        if (response.status !== 404) continue
        const body = await response.json().catch(() => ({}))
        // 404 con NOT_FOUND a secas es «esta dirección no es de nadie». Un 404
        // con su propio código —VEHICLE_NOT_FOUND, USER_NOT_FOUND— es la ruta
        // contestando sobre datos que no existen, que es lo que se espera.
        if (body.error === 'NOT_FOUND') unrouted.push(`${method} ${entry.url}`)
      }
    }
    expect(unrouted).toEqual([])
  })

  test('cada descripción dice qué contesta y si pide sesión', () => {
    const incomplete = contract.filter((entry) =>
      !entry.request
      || entry.request.authentication === undefined
      || !entry.response
      || !Object.keys(entry.response).length)
    expect(incomplete.map((entry) => entry.url)).toEqual([])
  })

  test('no hay dos descripciones para el mismo método y dirección', () => {
    const seen = contract.flatMap((entry) => methodsOf(entry).map((method) => `${method} ${entry.url}`))
    expect(seen.length).toBe(new Set(seen).size)
  })
})
