import { describe, expect, test, vi } from 'vitest'
import { Locations } from './locations.mjs'

const at = (iso) => () => new Date(iso)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const USER = '11111111-1111-4111-8111-111111111111'
const ADMIN = '22222222-2222-4222-8222-222222222222'
const VEHICLE = '3MVDMBBM2PM512094'

function fixture(options = {}) {
  const rows = {
    users: [{ id: USER }, { id: ADMIN }],
    vehicles: [{ vin: VEHICLE }],
    locations: [], userLocations: [], vehicleLocations: [],
  }
  return { rows, locations: new Locations(rows, options) }
}

describe('crear y editar ubicaciones', () => {
  test('nace solamente con nombre, activa y sin puntos', () => {
    const { rows, locations } = fixture({ now: at('2026-08-18T12:00:00.000Z') })
    const result = locations.create({ name: '  Patio norte  ' })
    expect(result).toMatchObject({
      ok: true,
      location: {
        name: 'Patio norte', points: [], isRoute: false, active: true,
        trafficMarginPercent: 15, distanceMeters: null, durationSeconds: null, etaSeconds: null,
        assignedVehicleCount: 0,
        createdAt: '2026-08-18T12:00:00.000Z', updatedAt: '2026-08-18T12:00:00.000Z',
      },
    })
    expect(result.location.id).toMatch(UUID)
    expect(rows.locations[0]).not.toHaveProperty('isRoute')
  })

  test('valida nombre y booleano antes de escribir', () => {
    const { rows, locations } = fixture()
    expect(locations.create({ name: ' ' })).toMatchObject({ ok: false, error: 'MISSING_LOCATION_NAME' })
    expect(locations.create({ name: 'Patio', active: 'true' })).toMatchObject({ ok: false, error: 'INVALID_ACTIVE' })
    expect(rows.locations).toEqual([])
  })

  test('permite renombrar y activar o desactivar', () => {
    let current = '2026-08-18T12:00:00.000Z'
    const { locations } = fixture({ now: () => new Date(current) })
    const created = locations.create({ name: 'Patio' }).location
    current = '2026-08-18T13:00:00.000Z'
    const changed = locations.update(created.id, { name: 'Ruta central', active: false })
    expect(changed.location).toMatchObject({ name: 'Ruta central', active: false, updatedAt: current })
    expect(changed.location.createdAt).toBe(created.createdAt)
  })

  test('guarda el margen y deriva el ETA de una medición', () => {
    const { locations } = fixture()
    const created = locations.create({ name: 'Ruta', trafficMarginPercent: 20, points: [
      { address: 'A', latitude: 25.76, longitude: -80.19 },
      { address: 'B', latitude: 25.77, longitude: -80.20 },
    ] }).location
    const measured = locations.setRouteEstimate(created.id, {
      distanceMeters: 10_500, durationSeconds: 1_000, routingProvider: 'geoapify',
    })
    expect(measured.location).toMatchObject({
      trafficMarginPercent: 20, distanceMeters: 10_500, durationSeconds: 1_000, etaSeconds: 1_200,
      geometry: [[-80.19, 25.76], [-80.2, 25.77]],
    })
    expect(locations.update(created.id, { trafficMarginPercent: 101 }))
      .toMatchObject({ error: 'INVALID_TRAFFIC_MARGIN' })
  })
})

describe('puntos', () => {
  test('uno es ubicación y dos forman una ruta automáticamente', () => {
    const { locations } = fixture()
    const id = locations.create({ name: 'Centro' }).location.id
    const first = locations.addPoint(id, {
      address: ' Avenida 1 ', reference: ' Portón ', latitude: 25.7617, longitude: -80.1918,
    })
    expect(first.location).toMatchObject({ isRoute: false })
    expect(first.point).toMatchObject({ address: 'Avenida 1', reference: 'Portón' })
    const second = locations.addPoint(id, { address: 'Avenida 2', latitude: 25.77, longitude: -80.2 })
    expect(second.location.isRoute).toBe(true)
    expect(second.location.points).toHaveLength(2)
  })

  test('permite modificar y quitar un punto', () => {
    const { locations } = fixture()
    const id = locations.create({ name: 'Centro' }).location.id
    const point = locations.addPoint(id, { address: 'Anterior', latitude: 25.76, longitude: -80.19 }).point
    expect(locations.updatePoint(id, point.id, {
      address: 'Nueva', reference: 'Puerta 3', latitude: 25.77, longitude: -80.2,
    }).point).toMatchObject({
      address: 'Nueva', reference: 'Puerta 3', latitude: 25.77, longitude: -80.2,
    })
    expect(locations.removePoint(id, point.id).location.points).toEqual([])
  })

  test('rechaza direcciones vacías y puntos ajenos', () => {
    const { locations } = fixture()
    const id = locations.create({ name: 'Centro' }).location.id
    expect(locations.addPoint(id, { address: ' ' })).toMatchObject({ error: 'MISSING_POINT_ADDRESS' })
    expect(locations.addPoint(id, { address: 'A', latitude: 200, longitude: 3 }))
      .toMatchObject({ error: 'INVALID_POINT_POSITION' })
    expect(locations.updatePoint(id, 'UNKNOWN', { address: 'A' })).toMatchObject({ error: 'POINT_NOT_FOUND' })
    expect(locations.removePoint('UNKNOWN', 'P-1')).toMatchObject({ error: 'LOCATION_NOT_FOUND' })
  })

  test('reemplaza puntos en orden y conserva ids conocidos', () => {
    const { locations } = fixture()
    const id = locations.create({ name: 'Ruta' }).location.id
    const first = locations.addPoint(id, {
      address: 'Primera', latitude: 25.76, longitude: -80.19,
    }).point
    const changed = locations.update(id, { points: [
      { ...first, address: 'Primera corregida' },
      { address: 'Segunda', reference: 'Portón', latitude: 25.77, longitude: -80.2 },
    ] })
    expect(changed.location.points[0]).toMatchObject({ id: first.id, address: 'Primera corregida' })
    expect(changed.location.points[1].id).toMatch(UUID)
    expect(changed.location.isRoute).toBe(true)
  })
})

describe('asignaciones', () => {
  test('agrega usuarios y vehículos de forma idempotente', () => {
    const saved = vi.fn()
    const { rows, locations } = fixture({ save: saved, now: at('2026-08-18T12:00:00.000Z') })
    const id = locations.create({ name: 'Centro' }).location.id
    const user = locations.assignUser(id, USER, ADMIN)
    const repeated = locations.assignUser(id, USER, ADMIN)
    const vehicle = locations.assignVehicle(id, VEHICLE, ADMIN)
    expect(user.assignment).toMatchObject({ id: `${USER}:${id}`, assignedBy: ADMIN })
    expect(repeated.assignment).toEqual(user.assignment)
    expect(vehicle.assignment).toMatchObject({ id: `${VEHICLE}:${id}`, vin: VEHICLE, assignedBy: ADMIN })
    expect(rows.userLocations).toHaveLength(1)
    expect(rows.vehicleLocations).toHaveLength(1)
    expect(locations.get(id).assignedVehicleCount).toBe(1)
    expect(saved).toHaveBeenCalledTimes(3)
  })

  test('comprueba que los dos lados de una asignación existan', () => {
    const { locations } = fixture()
    const id = locations.create({ name: 'Centro' }).location.id
    expect(locations.assignUser(id, 'UNKNOWN', ADMIN)).toMatchObject({ error: 'USER_NOT_FOUND' })
    expect(locations.assignVehicle(id, 'UNKNOWN', ADMIN)).toMatchObject({ error: 'VEHICLE_NOT_FOUND' })
    expect(locations.assignUser('UNKNOWN', USER, ADMIN)).toMatchObject({ error: 'LOCATION_NOT_FOUND' })
  })

  test('la selección explícita reemplaza la location anterior del vehículo', () => {
    const { rows, locations } = fixture()
    const first = locations.create({ name: 'Primera' }).location.id
    const second = locations.create({ name: 'Segunda' }).location.id
    locations.assignVehicle(first, VEHICLE, ADMIN)
    locations.replaceVehicleLocation(second, VEHICLE, ADMIN)
    expect(rows.vehicleLocations).toEqual([
      expect.objectContaining({ vin: VEHICLE, locationId: second }),
    ])
  })

  test('el inicio sólo pertenece a una ruta asignada y se normaliza a UTC', () => {
    const { locations } = fixture({ now: at('2026-08-20T17:00:00.000Z') })
    const point = locations.create({ name: 'Punto', points: [
      { address: 'A', latitude: 25.76, longitude: -80.19 },
    ] }).location.id
    locations.assignVehicle(point, VEHICLE, ADMIN)
    expect(locations.setVehicleRouteStartedAt(VEHICLE, '2026-08-20T12:00:00-04:00', USER))
      .toMatchObject({ error: 'ROUTE_START_NOT_APPLICABLE' })

    const route = locations.create({ name: 'Ruta', points: [
      { address: 'A', latitude: 25.76, longitude: -80.19 },
      { address: 'B', latitude: 25.77, longitude: -80.20 },
    ] }).location.id
    locations.replaceVehicleLocation(route, VEHICLE, ADMIN)
    expect(locations.setVehicleRouteStartedAt(VEHICLE, '2026-08-20T12:00:00-04:00', USER))
      .toMatchObject({
        assignment: { routeStartedAt: '2026-08-20T16:00:00.000Z', routeStartedBy: USER },
      })
    expect(locations.forVehicle(VEHICLE)[0].routeStartedAt).toBe('2026-08-20T16:00:00.000Z')
    expect(locations.setVehicleRouteStartedAt(VEHICLE, null, USER).assignment.routeStartedAt).toBeNull()
  })

  test('desactivar conserva relaciones pero las excluye de la visibilidad', () => {
    const { rows, locations } = fixture()
    const id = locations.create({ name: 'Centro' }).location.id
    locations.assignUser(id, USER, ADMIN)
    locations.assignVehicle(id, VEHICLE, ADMIN)
    locations.update(id, { active: false })
    expect(locations.forUser(USER)).toHaveLength(1)
    expect(locations.forUser(USER, { activeOnly: true })).toEqual([])
    expect(locations.activeIdsForUser(USER).size).toBe(0)
    expect(rows.userLocations).toHaveLength(1)
    expect(rows.vehicleLocations).toHaveLength(1)
  })

  test('eliminar una ubicación limpia sus asignaciones', () => {
    const { rows, locations } = fixture()
    const id = locations.create({ name: 'Centro' }).location.id
    locations.assignUser(id, USER, ADMIN)
    locations.assignVehicle(id, VEHICLE, ADMIN)
    expect(locations.remove(id)).toEqual({ ok: true, locationId: id })
    expect(rows.locations).toEqual([])
    expect(rows.userLocations).toEqual([])
    expect(rows.vehicleLocations).toEqual([])
  })
})
