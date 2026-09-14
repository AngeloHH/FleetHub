// El almacen sobre PostgreSQL: que lo que entra sea lo que sale, que solo se
// escriba lo que cambio, y que dos peticiones a la vez no se pisen.
//
// Estas pruebas necesitan una base de verdad. Si no la hay se saltan enteras
// en vez de fallar, porque no todo el mundo que clone esto va a tener Docker
// levantado -- pero cuando la hay, se ejecutan sin excusas.
//
//   docker run -d --name fleethub-pg -e POSTGRES_PASSWORD=fleethub \
//     -e POSTGRES_USER=fleethub -e POSTGRES_DB=fleethub -p 55433:5432 postgres:18-alpine

import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import pg from 'pg'
import { createPostgresStore } from './store-postgres.mjs'

const URL = process.env.FLEETHUB_TEST_DATABASE_URL
  ?? 'postgresql://fleethub:fleethub@127.0.0.1:55433/fleethub'

/** Si no hay base, no hay pruebas: se dice y se sigue. */
async function hayBase() {
  const cliente = new pg.Client({ connectionString: URL, connectionTimeoutMillis: 2_000 })
  try {
    await cliente.connect()
    await cliente.end()
    return true
  } catch {
    return false
  }
}

const disponible = await hayBase()
const cuando = disponible ? describe : describe.skip

const EMPRESA = '11111111-1111-4111-8111-111111111111'
const OTRA = '22222222-2222-4222-8222-222222222222'
const VIN = '1HGCM82633A004352'
const AHORA = '2026-08-21T00:00:00.000Z'

cuando('el almacen sobre PostgreSQL', () => {
  let admin
  let almacen

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: URL })
    await admin.connect()
  })

  afterAll(async () => {
    await almacen?.close()
    await admin?.end()
  })

  beforeEach(async () => {
    await admin.query('drop schema public cascade; create schema public;')
    await admin.query(readFileSync('db/schema.sql', 'utf8'))
    await almacen?.close()
    almacen = createPostgresStore({ url: URL })
  })

  /** Un estado minimo pero completo, con lo justo para que se sostenga solo. */
  const sembrado = async () => {
    const { state, revision } = await almacen.loadState()
    state.rows.companies.push({ id: EMPRESA, createdAt: AHORA }, { id: OTRA, createdAt: AHORA })
    state.rows.users.push({
      id: randomUUID(), companyId: EMPRESA, fullName: 'Ana Torres', email: 'ana@example.com',
      phoneCode: '+1', phone: '3055550111', language: 'es', role: 2, suspension: null,
      password: 'phc$loquesea', createdAt: AHORA, updatedAt: AHORA, passwordChangedAt: AHORA,
    })
    state.rows.vehicles.push({
      vin: VIN, companyId: EMPRESA, state: 1, createdAt: AHORA, updatedAt: AHORA,
    })
    await almacen.saveState(state, { revision })
    return almacen.loadState()
  }

  test('lo que se guarda es lo que se lee', async () => {
    const { state } = await sembrado()

    expect(state.rows.companies.map((c) => c.id).sort()).toEqual([EMPRESA, OTRA].sort())
    expect(state.rows.users[0]).toMatchObject({
      companyId: EMPRESA, email: 'ana@example.com', role: 2, phoneCode: '+1',
    })
    expect(state.rows.vehicles[0]).toMatchObject({ vin: VIN, companyId: EMPRESA, state: 1 })
  })

  test('solo se escribe lo que cambio', async () => {
    const { state, revision } = await sembrado()
    state.rows.vehicles[0].state = 3

    await almacen.saveState(state, { revision })

    // Si la comparacion escribiera de mas, la unidad tendria otra fecha de
    // alta o la empresa habria pasado por un UPDATE. Ni una cosa ni la otra.
    const { rows } = await admin.query('select state, created_at from vehicles where vin = $1', [VIN])
    expect(rows[0].state).toBe(3)
    expect(rows[0].created_at.toISOString()).toBe(AHORA)
    const { rows: cuantas } = await admin.query('select count(*)::int n from companies')
    expect(cuantas[0].n).toBe(2)
  })

  test('una fila que desaparece del estado se borra de la tabla', async () => {
    const { state, revision } = await sembrado()
    state.rows.vehicles.length = 0

    await almacen.saveState(state, { revision })

    const { rows } = await admin.query('select count(*)::int n from vehicles')
    expect(rows[0].n).toBe(0)
  })

  test('los puntos de una ubicacion sobreviven al viaje de ida y vuelta', async () => {
    // `points` es jsonb, y es lo unico que lleva forma propia dentro de una
    // columna. El orden del array es la ruta: si se pierde, se pierde la ruta.
    const { state, revision } = await sembrado()
    const puntos = [
      { id: 'P-1', address: 'Primero', reference: '', latitude: 25.6, longitude: -80.3 },
      { id: 'P-2', address: 'Segundo', reference: 'con nota', latitude: 37.0, longitude: -86.3 },
    ]
    state.rows.locations.push({
      id: randomUUID(), companyId: EMPRESA, name: 'CENTRO', points: puntos, active: true,
      trafficMarginPercent: 15, createdAt: AHORA, updatedAt: AHORA,
    })
    await almacen.saveState(state, { revision })

    const { state: leido } = await almacen.loadState()

    expect(leido.rows.locations[0].points.map((p) => p.id)).toEqual(['P-1', 'P-2'])
    expect(leido.rows.locations[0].points[1]).toMatchObject({ address: 'Segundo', reference: 'con nota' })
  })

  test('el limite por IP vuelve con su hora en milisegundos, no en fecha', async () => {
    // El codigo compara `resetAt` con `Date.now()`. Si volviera como texto o
    // como Date, el limite dejaria de vencer y nadie lo notaria hasta que
    // alguien se quedara fuera.
    const { state, revision } = await sembrado()
    const vence = Date.now() + 60_000
    state.rateLimits['codes:203.0.113.7'] = { count: 3, resetAt: vence }
    await almacen.saveState(state, { revision })

    const { state: leido } = await almacen.loadState()

    expect(typeof leido.rateLimits['codes:203.0.113.7'].resetAt).toBe('number')
    expect(leido.rateLimits['codes:203.0.113.7']).toEqual({ count: 3, resetAt: vence })
  })

  test('los usos de una llave solo crecen, y en su orden', async () => {
    const { state, revision } = await sembrado()
    const llave = {
      id: randomUUID(), purpose: 'SIGN_IN', code: 'ABC123', tier: null, companyId: EMPRESA,
      owner: null, triesLeft: 3, delegatedTo: null, expiresAt: '2099-01-01T00:00:00.000Z',
      revokedAt: null, revokedBy: null, createdBy: null, createdAt: AHORA, usedBy: [],
    }
    state.tokens.push(llave)
    await almacen.saveState(state, { revision })

    const segunda = await almacen.loadState()
    segunda.state.tokens[0].usedBy.push({ at: '2026-08-21T01:00:00.000Z' })
    await almacen.saveState(segunda.state, { revision: segunda.revision })

    const tercera = await almacen.loadState()
    tercera.state.tokens[0].usedBy.push({ at: '2026-08-21T02:00:00.000Z' })
    await almacen.saveState(tercera.state, { revision: tercera.revision })

    const { state: final } = await almacen.loadState()
    expect(final.tokens[0].usedBy.map((u) => u.at)).toEqual([
      '2026-08-21T01:00:00.000Z', '2026-08-21T02:00:00.000Z',
    ])
  })

  test('una llave dirigida conserva su derivado y no gana un codigo', async () => {
    const { state, revision } = await sembrado()
    state.tokens.push({
      id: randomUUID(), purpose: 'SIGN_IN', code: null, tier: null, companyId: null,
      owner: 'huella-de-ana', secret: { salt: 'sal', hash: 'derivado' }, triesLeft: 3,
      delegatedTo: null, expiresAt: '2099-01-01T00:00:00.000Z', revokedAt: null,
      revokedBy: null, createdBy: null, createdAt: AHORA, usedBy: [],
    })
    await almacen.saveState(state, { revision })

    const { state: leido } = await almacen.loadState()

    expect(leido.tokens[0].code).toBeNull()
    expect(leido.tokens[0].secret).toEqual({ salt: 'sal', hash: 'derivado' })
  })

  test('una llave delegada vuelve sin `secret`, que no es lo mismo que vacio', async () => {
    // `codes.mjs` distingue "no tiene derivado" de "tiene uno vacio": con el
    // segundo, `find` intentaria comprobarlo. Tiene que volver ausente.
    const { state, revision } = await sembrado()
    state.tokens.push({
      id: randomUUID(), purpose: 'SIGN_IN', code: null, tier: null, companyId: null,
      owner: 'huella-de-ana', triesLeft: 3, delegatedTo: 'twilio-verify',
      expiresAt: '2099-01-01T00:00:00.000Z', revokedAt: null, revokedBy: null,
      createdBy: null, createdAt: AHORA, usedBy: [],
    })
    await almacen.saveState(state, { revision })

    const { state: leido } = await almacen.loadState()

    expect(leido.tokens[0]).not.toHaveProperty('secret')
    expect(leido.tokens[0].delegatedTo).toBe('twilio-verify')
  })

  test('quien llega segundo no pisa al primero', async () => {
    await sembrado()
    const otro = createPostgresStore({ url: URL })
    try {
      const uno = await almacen.loadState()
      const dos = await otro.loadState()
      expect(uno.revision.numero).toBe(dos.revision.numero)

      uno.state.rows.vehicles[0].state = 3
      dos.state.rows.vehicles[0].state = 4

      await expect(almacen.saveState(uno.state, { revision: uno.revision })).resolves.toEqual({ ok: true })
      await expect(otro.saveState(dos.state, { revision: dos.revision })).resolves.toEqual({ ok: false })

      // Y lo que queda es lo del primero, no una mezcla de los dos.
      const { rows } = await admin.query('select state from vehicles where vin = $1', [VIN])
      expect(rows[0].state).toBe(3)
    } finally {
      await otro.close()
    }
  })

  test('si algo falla a mitad, no queda media escritura', async () => {
    const { state, revision } = await sembrado()
    // Una unidad de una empresa que no existe: la clave ajena la rechaza. Lo
    // que importa es que la unidad valida que va con ella tampoco entre.
    state.rows.vehicles.push(
      { vin: '1HGCM82633A004353', companyId: EMPRESA, state: 1, createdAt: AHORA, updatedAt: AHORA },
      { vin: '1HGCM82633A004354', companyId: '99999999-9999-4999-8999-999999999999', state: 1, createdAt: AHORA, updatedAt: AHORA },
    )

    await expect(almacen.saveState(state, { revision })).rejects.toThrow()

    const { rows } = await admin.query('select count(*)::int n from vehicles')
    expect(rows[0].n).toBe(1)
    // Y la revision no avanza: nadie llego tarde, es que no paso nada.
    const { rows: cuenta } = await admin.query('select revision from store_revision')
    expect(Number(cuenta[0].revision)).toBe(revision.numero)
  })
})

if (!disponible) {
  // Que se vea en la salida: una prueba saltada en silencio es una prueba que
  // nadie echa de menos el dia que deja de correr para siempre.
  console.warn(`\n  (store-postgres.test.mjs: sin base en ${URL}, pruebas saltadas)\n`)
}
