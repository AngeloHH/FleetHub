import { describe, expect, test, vi } from 'vitest'
import { Vehicles, VEHICLE_STATES } from './vehicles.mjs'

const VIN = '3MVDMBBM2PM512094'
const USER = '11111111-1111-4111-8111-111111111111'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

function fixture(options = {}) {
  const rows = {
    vehicles: [], vehiclePositions: [], vehicleLocations: [],
    events: [], dismissals: [], photos: [],
  }
  return { rows, vehicles: new Vehicles(rows, options) }
}

describe('identidad y decodificación', () => {
  test('nace solamente desde el VIN y con decodificación pendiente', () => {
    const { vehicles } = fixture({ now: () => new Date('2026-08-18T12:00:00.000Z') })
    expect(vehicles.create(`  ${VIN.toLowerCase()}  `, { createdBy: USER })).toEqual({
      ok: true,
      created: true,
      vehicle: {
        vin: VIN, state: null, decodeStatus: null, decodedAt: null, decoder: null,
        year: null, make: null, model: null, trim: null, body: null, engine: null,
        position: null, createdAt: '2026-08-18T12:00:00.000Z', updatedAt: '2026-08-18T12:00:00.000Z',
      },
    })
  })

  test('el mismo VIN no crea dos vehículos', () => {
    const { rows, vehicles } = fixture()
    expect(vehicles.create(VIN).created).toBe(true)
    expect(vehicles.create(VIN).created).toBe(false)
    expect(rows.vehicles).toHaveLength(1)
  })

  test('rechaza VIN inválido', () => {
    const { rows, vehicles } = fixture()
    expect(vehicles.create('NO-ES-VIN')).toMatchObject({ error: 'INVALID_VIN' })
    expect(vehicles.create('3MVDMBBMIPM512094')).toMatchObject({ error: 'INVALID_VIN' })
    expect(rows.vehicles).toEqual([])
  })

  test('guarda solamente los detalles normalizados que usa FleetHub', () => {
    const { vehicles } = fixture({ now: () => new Date('2026-08-18T13:00:00.000Z') })
    vehicles.create(VIN)
    const result = vehicles.setDecoded(VIN, {
      year: '2023', make: ' MAZDA ', model: 'CX-30', trim: 'SELECT',
      body: 'SUV', engine: '2.5L', rawResponse: { ignored: true },
    }, { decoder: 'Proveedor' })
    expect(result.vehicle).toMatchObject({
      year: 2023, make: 'MAZDA', model: 'CX-30', trim: 'SELECT', body: 'SUV', engine: '2.5L',
      decodeStatus: 'decoded', decodedAt: '2026-08-18T13:00:00.000Z', decoder: 'Proveedor',
    })
    expect(result.vehicle).not.toHaveProperty('rawResponse')
  })

  test('un operador puede corregir una ficha ya decodificada', () => {
    const { vehicles } = fixture()
    vehicles.create(VIN)
    vehicles.setDecoded(VIN, { year: 2023, make: 'MAZDA', model: 'CX-30', trim: 'SELECT' })
    const changed = vehicles.updateDetails(VIN, {
      year: 2024, make: ' Mazda ', model: ' CX-30 ', trim: ' Premium ', body: 'SUV', engine: '2.5L',
    })
    expect(changed.vehicle).toMatchObject({
      year: 2024, make: 'Mazda', model: 'CX-30', trim: 'Premium', decodeStatus: 'manual', decoder: null,
    })
  })

  test('pide captura manual cuando el proveedor falla y la guarda sin fingir una decodificación', () => {
    const { vehicles } = fixture({ now: () => new Date('2026-08-18T13:00:00.000Z') })
    vehicles.create(VIN)
    expect(vehicles.requireManualDetails(VIN).vehicle).toMatchObject({
      decodeStatus: 'manual-required', decodedAt: null, decoder: null,
    })
    const result = vehicles.setManualDetails(VIN, {
      year: 2023, make: 'MAZDA', model: 'CX-30', trim: 'SELECT', body: 'SUV', engine: '2.5L',
    })
    expect(result.vehicle).toMatchObject({
      year: 2023, make: 'MAZDA', model: 'CX-30', decodeStatus: 'manual', decodedAt: null, decoder: null,
    })
  })

  test('la captura manual exige año, marca y modelo', () => {
    const { vehicles } = fixture()
    vehicles.create(VIN)
    vehicles.requireManualDetails(VIN)
    expect(vehicles.setManualDetails(VIN, { year: 2023, make: 'MAZDA' }))
      .toMatchObject({ error: 'MISSING_VEHICLE_DETAILS' })
  })
})

describe('estados fijos', () => {
  test('la correspondencia numérica es estable e incluye NO ENCONTRADO como cero', () => {
    expect(VEHICLE_STATES.map(({ id, name }) => ({ id, name }))).toEqual([
      { id: 1, name: 'EN RUTA' },
      { id: 2, name: 'CON DEPÓSITO' },
      { id: 3, name: 'EN SERVICIO' },
      { id: 0, name: 'NO ENCONTRADO' },
      { id: 4, name: 'VENDIDO' },
    ])
  })

  test('cero es un estado válido y no se confunde con null', () => {
    const { rows, vehicles } = fixture()
    vehicles.create(VIN)
    const result = vehicles.setState(VIN, 0, { changedBy: USER })
    expect(result).toMatchObject({ ok: true, changed: true, vehicle: { state: 0 } })
    expect(rows.events[0]).toMatchObject({ vin: VIN, userId: USER, previousState: null, state: 0 })
    expect(rows.events[0].id).toMatch(UUID)
  })

  test('tocar otra vez el estado permite volver a null', () => {
    const { rows, vehicles } = fixture()
    vehicles.create(VIN)
    vehicles.setState(VIN, 1, { changedBy: USER })
    const result = vehicles.setState(VIN, null, { changedBy: USER })
    expect(result).toMatchObject({ ok: true, changed: true, vehicle: { state: null } })
    expect(rows.events[0]).toMatchObject({ vin: VIN, userId: USER, previousState: 1, state: null })
  })

  test('sólo acepta los cinco enteros y no duplica un estado idéntico', () => {
    const saved = vi.fn()
    const { rows, vehicles } = fixture({ save: saved })
    vehicles.create(VIN)
    for (const state of [-1, 5, 1.5, '1', undefined])
      expect(vehicles.setState(VIN, state)).toMatchObject({ error: 'INVALID_STATE' })
    vehicles.setState(VIN, 1)
    expect(vehicles.setState(VIN, 1).changed).toBe(false)
    expect(rows.events).toHaveLength(1)
    expect(saved).toHaveBeenCalledTimes(2)
  })
})

describe('posición física', () => {
  test('guarda el GPS aparte y expone el reporte más reciente', () => {
    let time = '2026-08-18T14:00:00.000Z'
    const { rows, vehicles } = fixture({ now: () => new Date(time) })
    vehicles.create(VIN)
    const first = vehicles.reportPosition(VIN, {
      latitude: 25.7617, longitude: -80.1918, accuracy: 8,
    }, { reportedBy: USER })
    expect(first.position).toMatchObject({ vin: VIN, reportedBy: USER, createdAt: time })
    expect(first.position.id).toMatch(UUID)
    time = '2026-08-18T14:05:00.000Z'
    vehicles.reportPosition(VIN, { latitude: 25.77, longitude: -80.2 })
    expect(vehicles.get(VIN).position).toMatchObject({ latitude: 25.77, longitude: -80.2, accuracy: null })
    expect(rows.vehiclePositions).toHaveLength(2)
  })

  test('rechaza coordenadas imposibles sin escribir', () => {
    const { rows, vehicles } = fixture()
    vehicles.create(VIN)
    for (const position of [
      {}, { latitude: 91, longitude: 0 }, { latitude: 0, longitude: -181 },
      { latitude: 0, longitude: 0, accuracy: -1 },
    ]) expect(vehicles.reportPosition(VIN, position)).toMatchObject({ error: 'INVALID_POSITION' })
    expect(rows.vehiclePositions).toEqual([])
  })
})
