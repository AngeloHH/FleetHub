import { describe, expect, test } from 'vitest'
import { resource } from './resources.mjs'
import { Users } from './users.mjs'
import { Vehicles } from './vehicles.mjs'

const CENTER = '11111111-1111-4111-8111-111111111111'
const NORTH = '22222222-2222-4222-8222-222222222222'
const VEHICLE = '3MVDMBBM2PM512094'
const COMPANY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

const makeUser = (rows, suffix, role = 'OPERADOR') => new Users(rows.users).create({
  fullName: `Persona ${suffix}`, email: `${suffix}@example.com`, phoneCode: '+52',
  phone: `55123456${suffix.padStart(2, '0')}`, language: 'es',
  password: 'Clave-Segura1', role,
  companyId: COMPANY,
}).user

function fixture() {
  const rows = {
    users: [], locations: [], userLocations: [], vehicleLocations: [],
    vehicles: [], vehiclePositions: [], events: [], photos: [], grants: [], dismissals: [],
  }
  const admin = makeUser(rows, '01', 'ADMINISTRADOR')
  const operator = makeUser(rows, '02')
  const at = new Date().toISOString()
  rows.locations.push({ id: CENTER, companyId: COMPANY, name: 'CENTRO', points: [{ id: 'P-1', address: 'A', reference: '' }], active: true, createdAt: at, updatedAt: at })
  rows.locations.push({ id: NORTH, companyId: COMPANY, name: 'NORTE', points: [{ id: 'P-2', address: 'B', reference: '' }], active: true, createdAt: at, updatedAt: at })
  rows.userLocations.push({ id: `${admin.id}:${CENTER}`, companyId: COMPANY, userId: admin.id, locationId: CENTER })
  rows.userLocations.push({ id: `${operator.id}:${NORTH}`, companyId: COMPANY, userId: operator.id, locationId: NORTH })
  new Vehicles(rows, { companyId: COMPANY }).create(VEHICLE)
  rows.vehicleLocations.push({ id: `${VEHICLE}:${NORTH}`, companyId: COMPANY, vin: VEHICLE, locationId: NORTH })
  return { rows, admin, operator }
}

const call = (rows, at, path, method, body, context = {}) =>
  resource(path, method, at, rows, async () => body, () => {}, context)

describe('usuarios sin membresías', () => {
  test('la lista devuelve usuarios públicos, sin password', async () => {
    const { rows, admin } = fixture()
    const answer = await call(rows, { userId: admin.id }, '/api/users', 'GET')
    expect(answer.status).toBe(200)
    expect(answer.body.users).toHaveLength(2)
    expect(answer.body.users[0]).not.toHaveProperty('password')
    expect(answer.body).not.toHaveProperty('memberships')
  })

  test('el administrador edita directamente al usuario', async () => {
    const { rows, admin, operator } = fixture()
    const answer = await call(rows, { userId: admin.id }, `/api/users/${operator.id}`, 'POST', {
      fullName: 'Nombre Nuevo', role: 'VISITANTE',
    })
    expect(answer.body.user).toMatchObject({ fullName: 'Nombre Nuevo', role: 'VISITANTE' })
    expect(answer.body).not.toHaveProperty('membership')
  })

  test('una compañía no puede listar ni modificar usuarios de otra', async () => {
    const { rows, admin } = fixture()
    const otherCompany = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    const outsider = new Users(rows.users).create({
      fullName: 'Persona externa', email: 'externa@example.com', phoneCode: '+1',
      phone: '3055550199', language: 'es', password: 'Clave-Segura1',
      role: 'OPERADOR', companyId: otherCompany,
    }).user
    const listed = await call(rows, { userId: admin.id }, '/api/users', 'GET')
    expect(listed.body.users.map((user) => user.id)).not.toContain(outsider.id)
    const edited = await call(rows, { userId: admin.id }, `/api/users/${outsider.id}`, 'POST', {
      fullName: 'No debe cambiar',
    })
    expect(edited).toMatchObject({ status: 404, body: { error: 'USER_NOT_FOUND' } })
    expect(rows.users.find((user) => user.id === outsider.id).fullName).toBe('Persona externa')
  })

  test('la recuperación omite la contraseña actual una sola vez', async () => {
    const { rows, admin } = fixture()
    const session = { userId: admin.id, passwordReset: true }
    const changed = await call(rows, session, `/api/users/${admin.id}/password`, 'POST', { password: 'Clave-Nueva2' })
    expect(changed.status).toBe(200)
    expect(session.passwordReset).toBe(false)
    const reused = await call(rows, session, `/api/users/${admin.id}/password`, 'POST', { password: 'Otra-Clave3' })
    expect(reused).toMatchObject({ status: 401, body: { error: 'INVALID_CREDENTIALS' } })
  })
})

describe('búsqueda de direcciones', () => {
  test('el administrador recibe sólo nuestro contrato de sugerencias', async () => {
    const { rows, admin } = fixture()
    const suggestAddresses = async (query, options) => ({
      ok: true,
      suggestions: [{ address: `${query}, FL`, latitude: 25.76, longitude: -80.19 }],
      options,
    })
    const answer = await call(
      rows,
      { userId: admin.id },
      '/api/geocoding/suggestions',
      'GET',
      undefined,
      { query: new URLSearchParams({ q: 'Brickell', language: 'es' }), suggestAddresses },
    )
    expect(answer).toMatchObject({
      status: 200,
      body: { suggestions: [{ address: 'Brickell, FL', latitude: 25.76, longitude: -80.19 }] },
    })
  })

  test('un operador no puede usar el buscador administrativo', async () => {
    const { rows, operator } = fixture()
    const answer = await call(rows, { userId: operator.id }, '/api/geocoding/suggestions', 'GET')
    expect(answer).toMatchObject({ status: 403, body: { error: 'FORBIDDEN' } })
  })
})

describe('visibilidad por ubicaciones', () => {
  test('no muestra locations ni vehículos de otra compañía', async () => {
    const { rows, operator } = fixture()
    const otherCompany = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    const otherLocation = '44444444-4444-4444-8444-444444444444'
    const otherVin = '1HGCM82633A004352'
    rows.locations.push({
      id: otherLocation, companyId: otherCompany, name: 'OTRA EMPRESA', points: [], active: true,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    })
    new Vehicles(rows, { companyId: otherCompany }).create(otherVin)
    const locations = await call(rows, { userId: operator.id }, '/api/locations', 'GET')
    expect(locations.body.locations.map((location) => location.id)).not.toContain(otherLocation)
    const fleet = await call(rows, { userId: operator.id }, '/api/vehicles', 'GET')
    expect(fleet.body.pendingVehicles.map((vehicle) => vehicle.vin)).not.toContain(otherVin)
    const details = await call(rows, { userId: operator.id }, `/api/vehicles/${otherVin}/details`, 'GET')
    expect(details).toMatchObject({ status: 404, body: { error: 'VEHICLE_NOT_FOUND' } })
  })

  test('ni el administrador ve un vehículo sin ubicación compartida', async () => {
    const { rows, admin } = fixture()
    const answer = await call(rows, { userId: admin.id }, '/api/vehicles', 'GET')
    expect(answer.body.vehicles).toEqual([])
    expect(answer.body.pendingVehicles).toEqual([])
  })

  test('el creador recibe su unidad sin location como pendiente, pero no como flota visible', async () => {
    const { rows, operator } = fixture()
    const unassigned = '1HGCM82633A004352'
    new Vehicles(rows, { companyId: COMPANY }).create(unassigned, { createdBy: operator.id })
    const answer = await call(rows, { userId: operator.id }, '/api/vehicles', 'GET')
    expect(answer.body.vehicles.map((vehicle) => vehicle.vin)).toEqual([VEHICLE])
    expect(answer.body.pendingVehicles.map((vehicle) => vehicle.vin)).toEqual([unassigned])
  })

  test('otro operador recibe una unidad pendiente y puede asignarla', async () => {
    const { rows, operator } = fixture()
    const other = makeUser(rows, '03')
    const unassigned = '1HGCM82633A004352'
    new Vehicles(rows, { companyId: COMPANY }).create(unassigned, { createdBy: operator.id })
    const before = await call(rows, { userId: other.id }, '/api/vehicles', 'GET')
    expect(before.body.vehicles).toEqual([])
    expect(before.body.pendingVehicles.map((vehicle) => vehicle.vin)).toEqual([unassigned])

    const assigned = await call(rows, { userId: other.id }, `/api/vehicles/${unassigned}/locations`, 'POST', {
      locationId: CENTER,
      replace: true,
    })
    expect(assigned).toMatchObject({ status: 200, body: { assignment: { vin: unassigned, locationId: CENTER } } })
    expect(rows.vehicleLocations).toContainEqual(expect.objectContaining({
      vin: unassigned,
      locationId: CENTER,
      assignedBy: other.id,
    }))
  })

  test('un visitante no recibe ni puede asignar las unidades pendientes', async () => {
    const { rows, operator } = fixture()
    const visitor = makeUser(rows, '03', 'VISITANTE')
    const unassigned = '1HGCM82633A004352'
    new Vehicles(rows, { companyId: COMPANY }).create(unassigned, { createdBy: operator.id })
    const before = await call(rows, { userId: visitor.id }, '/api/vehicles', 'GET')
    expect(before.body.pendingVehicles).toEqual([])
    const assigned = await call(rows, { userId: visitor.id }, `/api/vehicles/${unassigned}/locations`, 'POST', {
      locationId: CENTER,
      replace: true,
    })
    expect(assigned).toMatchObject({ status: 404, body: { error: 'VEHICLE_NOT_FOUND' } })
  })

  test('el operador puede elegir cualquier location activa de la empresa', async () => {
    const { rows, operator } = fixture()
    rows.locations.push({
      id: '33333333-3333-4333-8333-333333333333',
      companyId: COMPANY,
      name: 'INACTIVA',
      points: [],
      active: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    const answer = await call(rows, { userId: operator.id }, '/api/locations', 'GET')
    expect(answer.body.locations.map((location) => location.id)).toEqual([CENTER, NORTH])
  })

  test('el administrador recibe todas las unidades pendientes', async () => {
    const { rows, admin, operator } = fixture()
    const unassigned = '1HGCM82633A004352'
    new Vehicles(rows, { companyId: COMPANY }).create(unassigned, { createdBy: operator.id })
    const answer = await call(rows, { userId: admin.id }, '/api/vehicles', 'GET')
    expect(answer.body.pendingVehicles.map((vehicle) => vehicle.vin)).toEqual([unassigned])
    const details = await call(rows, { userId: admin.id }, `/api/vehicles/${unassigned}/details`, 'GET')
    expect(details).toMatchObject({ status: 200, body: { vehicle: { vin: unassigned } } })
  })

  test('el tab de alertas puede distinguir unidades sin location', async () => {
    const { rows, admin } = fixture()
    const unassigned = '1HGCM82633A004352'
    new Vehicles(rows, { companyId: COMPANY }).create(unassigned, { createdBy: admin.id })
    const answer = await call(rows, { userId: admin.id }, '/api/vehicles/location-status', 'GET')
    expect(answer.body.vehicles).toEqual(expect.arrayContaining([
      { vin: VEHICLE, assigned: true },
      { vin: unassigned, assigned: false },
    ]))
  })

  test('el operador sí ve el vehículo con ubicación compartida', async () => {
    const { rows, operator } = fixture()
    const answer = await call(rows, { userId: operator.id }, '/api/vehicles', 'GET')
    expect(answer.body.vehicles.map((vehicle) => vehicle.vin)).toEqual([VEHICLE])
  })

  test('guarda el inicio y comparte los datos mínimos para estimar la posición en ruta', async () => {
    const { rows, operator } = fixture()
    const north = rows.locations.find((location) => location.id === NORTH)
    north.points.push({ id: 'P-3', address: 'C', reference: '', latitude: 25.79, longitude: -80.13 })
    north.points[0].latitude = 25.76
    north.points[0].longitude = -80.19
    north.durationSeconds = 600
    north.trafficMarginPercent = 20
    north.geometry = [[-80.19, 25.76], [-80.16, 25.775], [-80.13, 25.79]]
    const started = await call(rows, { userId: operator.id }, `/api/vehicles/${VEHICLE}/route-start`, 'POST', {
      routeStartedAt: '2026-08-20T12:00:00-04:00',
    })
    expect(started.body).toMatchObject({
      routeTracking: {
        locationId: NORTH,
        routeStartedAt: '2026-08-20T16:00:00.000Z',
        etaSeconds: 720,
        geometry: north.geometry,
      },
    })
    const fleet = await call(rows, { userId: operator.id }, '/api/vehicles', 'GET')
    expect(fleet.body.vehicles[0].routeTracking).toMatchObject({
      locationId: NORTH,
      routeStartedAt: '2026-08-20T16:00:00.000Z',
      etaSeconds: 720,
    })
  })

  test('crear una ubicación asigna automáticamente al administrador creador', async () => {
    const { rows, admin } = fixture()
    const answer = await call(rows, { userId: admin.id }, '/api/locations', 'POST', {
      name: 'RUTA SUR',
    })
    expect(answer.body.location).toMatchObject({ name: 'RUTA SUR', points: [], isRoute: false, active: true })
    expect(answer.body.location.id).toMatch(UUID)
    expect(rows.userLocations).toContainEqual(expect.objectContaining({
      userId: admin.id, locationId: answer.body.location.id,
    }))
  })

  test('previsualiza distancia y ETA con el margen solicitado', async () => {
    const { rows, admin } = fixture()
    const estimateRoute = async () => ({
      ok: true, distanceMeters: 8_000, durationSeconds: 600,
      routingProvider: 'geoapify', routingTraffic: 'approximated',
      routingCalculatedAt: '2026-08-19T12:00:00.000Z',
    })
    const answer = await call(rows, { userId: admin.id }, '/api/locations/route-estimate', 'POST', {
      points: [
        { latitude: 25.76, longitude: -80.19 },
        { latitude: 25.77, longitude: -80.20 },
      ],
      trafficMarginPercent: 25,
    }, { estimateRoute })
    expect(answer).toMatchObject({
      status: 200,
      body: { estimate: { distanceMeters: 8_000, durationSeconds: 600, etaSeconds: 750 } },
    })
  })

  test('dos puntos convierten la ubicación en ruta sin guardar un tipo separado', async () => {
    const { rows, admin } = fixture()
    const created = await call(rows, { userId: admin.id }, '/api/locations', 'POST', { name: 'RUTA SUR' })
    const id = created.body.location.id
    await call(rows, { userId: admin.id }, `/api/locations/${id}/points`, 'POST', {
      address: 'Primera', latitude: 25.76, longitude: -80.19,
    })
    const second = await call(rows, { userId: admin.id }, `/api/locations/${id}/points`, 'POST', {
      address: 'Segunda', latitude: 25.77, longitude: -80.2,
    })
    expect(second.body.location).toMatchObject({ isRoute: true })
    expect(second.body.location.points).toHaveLength(2)
    expect(rows.locations.find((location) => location.id === id)).not.toHaveProperty('isRoute')
  })

  test('una ubicación desactivada deja de otorgar visibilidad sin perder asignaciones', async () => {
    const { rows, operator } = fixture()
    expect((await call(rows, { userId: operator.id }, '/api/vehicles', 'GET')).body.vehicles).toHaveLength(1)
    rows.locations.find((location) => location.id === NORTH).active = false
    expect((await call(rows, { userId: operator.id }, '/api/vehicles', 'GET')).body.vehicles).toEqual([])
    expect(rows.userLocations.some((row) => row.userId === operator.id && row.locationId === NORTH)).toBe(true)
    expect(rows.vehicleLocations.some((row) => row.vin === VEHICLE && row.locationId === NORTH)).toBe(true)
  })

  test('los vehículos nuevos usan el VIN como única identidad', async () => {
    const { rows, admin } = fixture()
    const answer = await call(rows, { userId: admin.id }, '/api/vehicles', 'POST', {
      vin: '1HGCM82633A004352',
    })
    expect(answer.status).toBe(200)
    expect(answer.body).toMatchObject({ created: true, vehicle: {
      vin: '1HGCM82633A004352', state: null, decodeStatus: null, decodedAt: null,
    } })
    expect(answer.body.vehicle).not.toHaveProperty('id')
  })

  test('la creación devuelve los datos decodificados por el backend', async () => {
    const { rows, admin } = fixture()
    const answer = await call(rows, { userId: admin.id }, '/api/vehicles', 'POST', {
      vin: '1HGCM82633A004352',
    }, { decodeVin: async () => ({
      ok: true, decoder: 'test-provider',
      details: { year: 2003, make: 'HONDA', model: 'ACCORD', trim: 'EX' },
    }) })
    expect(answer.body).toMatchObject({
      manualRequired: false,
      vehicle: { decodeStatus: 'decoded', decodedAt: expect.any(String), decoder: 'test-provider' },
    })
  })

  test('si el proveedor falla, pide datos manuales y permite guardarlos', async () => {
    const { rows, operator } = fixture()
    const vin = '1HGCM82633A004352'
    const created = await call(rows, { userId: operator.id }, '/api/vehicles', 'POST', { vin }, {
      decodeVin: async () => ({ ok: false, error: 'DECODER_UNAVAILABLE' }),
    })
    expect(created.body).toMatchObject({
      manualRequired: true,
      decodeError: 'DECODER_UNAVAILABLE',
      vehicle: { decodeStatus: 'manual-required', decodedAt: null },
    })
    const manual = await call(rows, { userId: operator.id }, `/api/vehicles/${vin}/details`, 'POST', {
      year: 2003, make: 'HONDA', model: 'ACCORD', trim: 'EX', body: 'SEDAN', engine: '3.0L',
    })
    expect(manual.body.vehicle).toMatchObject({
      decodeStatus: 'manual', decodedAt: null, year: 2003, make: 'HONDA', model: 'ACCORD',
    })
  })

  test('lee y corrige la información de una unidad existente', async () => {
    const { rows, operator } = fixture()
    new Vehicles(rows, { companyId: COMPANY }).updateDetails(VEHICLE, {
      year: 2023, make: 'MAZDA', model: 'CX-30', trim: 'SELECT', body: 'SUV', engine: '2.5L',
    })
    const read = await call(rows, { userId: operator.id }, `/api/vehicles/${VEHICLE}/details`, 'GET')
    expect(read.body.vehicle).toMatchObject({ vin: VEHICLE, model: 'CX-30', trim: 'SELECT' })
    const changed = await call(rows, { userId: operator.id }, `/api/vehicles/${VEHICLE}/details`, 'POST', {
      year: 2024, make: 'MAZDA', model: 'CX-30', trim: 'PREMIUM', body: 'SUV', engine: '2.5L',
    })
    expect(changed.body.vehicle).toMatchObject({ year: 2024, trim: 'PREMIUM', decodeStatus: 'manual' })
  })

  test('el creador establece estado, GPS y location después del VIN', async () => {
    const { rows, operator } = fixture()
    const vin = '1HGCM82633A004352'
    await call(rows, { userId: operator.id }, '/api/vehicles', 'POST', { vin })
    const state = await call(rows, { userId: operator.id }, `/api/vehicles/${vin}/state`, 'POST', { state: 0 })
    expect(state.body.vehicle.state).toBe(0)
    const position = await call(rows, { userId: operator.id }, `/api/vehicles/${vin}/positions`, 'POST', {
      latitude: 25.7617, longitude: -80.1918, accuracy: 8,
    })
    expect(position.body.position).toMatchObject({ vin, reportedBy: operator.id })
    const latest = await call(rows, { userId: operator.id }, `/api/vehicles/${vin}/positions`, 'GET')
    expect(latest.body.position).toMatchObject({
      vin, latitude: 25.7617, longitude: -80.1918, accuracy: 8, reportedBy: operator.id,
    })
    const assigned = await call(rows, { userId: operator.id }, `/api/vehicles/${vin}/locations`, 'POST', {
      locationId: NORTH,
    })
    expect(assigned.body.assignment).toMatchObject({ vin, locationId: NORTH })
    expect((await call(rows, { userId: operator.id }, '/api/vehicles', 'GET')).body.vehicles)
      .toContainEqual(expect.objectContaining({ vin, state: 0 }))
  })

  test('el historial conserva userId aunque se elimine la cuenta', async () => {
    const { rows, admin, operator } = fixture()
    rows.events.push({ id: 'EV-1', companyId: COMPANY, vin: VEHICLE, userId: operator.id, kind: 'state', state: 1, createdAt: new Date().toISOString() })
    const answer = await call(rows, { userId: admin.id }, `/api/users/${operator.id}`, 'DELETE')
    expect(answer.status).toBe(200)
    expect(rows.users.some((user) => user.id === operator.id)).toBe(false)
    expect(rows.events[0].userId).toBe(operator.id)
  })
})

describe('la frontera de empresa se cierra ante la duda', () => {
  // Filas sin empresa las produce la migración de la versión 13 cuando hay más
  // de una compañía y una fila no se puede atribuir. Antes se tomaban por
  // compañeras entre sí, porque `null === null` es cierto: una cuenta huérfana
  // administraba a otra cuenta huérfana.
  function huerfanas() {
    const { rows } = fixture()
    const admin = rows.users.find((row) => row.role === 2)
    const otra = rows.users.find((row) => row.id !== admin.id)
    for (const row of rows.users) row.companyId = null
    rows.vehicles.push({ vin: '1HGCM82633A004352', companyId: null, state: 'DISPONIBLE' })
    return { rows, admin, otra }
  }

  test('sin empresa no se administra a quien tampoco la tiene', async () => {
    const { rows, admin, otra } = huerfanas()

    const borrado = await call(rows, { userId: admin.id }, `/api/users/${otra.id}`, 'DELETE')

    expect(borrado).toMatchObject({ status: 404, body: { error: 'USER_NOT_FOUND' } })
    expect(rows.users.some((row) => row.id === otra.id)).toBe(true)
  })

  test('sin empresa tampoco se le cambia el nombre ni se le suspende', async () => {
    const { rows, admin, otra } = huerfanas()

    const editado = await call(rows, { userId: admin.id }, `/api/users/${otra.id}`, 'POST', {
      fullName: 'No debe cambiar', suspension: 'admin',
    })

    expect(editado).toMatchObject({ status: 404, body: { error: 'USER_NOT_FOUND' } })
    expect(rows.users.find((row) => row.id === otra.id).suspension).toBeNull()
  })

  test('sin empresa sólo se ve uno mismo', async () => {
    const { rows, admin, otra } = huerfanas()

    const listado = await call(rows, { userId: admin.id }, '/api/users', 'GET')

    expect(listado.body.users.map((row) => row.id)).toEqual([admin.id])
    expect(listado.body.users.map((row) => row.id)).not.toContain(otra.id)
  })

  test('una unidad sin empresa no la alcanza nadie', async () => {
    // `null` como alcance significaba «todas las empresas» para `belongs`, así
    // que la unidad huérfana entraba en el listado de cualquier huérfano.
    const { rows, admin } = huerfanas()

    const listadas = await call(rows, { userId: admin.id }, '/api/vehicles', 'GET')
    const estados = await call(rows, { userId: admin.id }, '/api/vehicles/states', 'GET')

    expect(listadas.body.vehicles).toEqual([])
    expect(listadas.body.pendingVehicles).toEqual([])
    expect(JSON.stringify(estados.body)).not.toContain('1HGCM82633A004352')
  })

  test('una fila que llegue con `company_id` tampoco cuela', async () => {
    // El día que las filas vengan de SQL, el nombre de la columna cambia. Una
    // fila así no tiene `companyId`, y comparar dos ausencias volvería a abrir
    // la guarda si la regla no exigiera que la empresa esté declarada.
    const { rows, admin } = fixture()
    rows.users.push({
      id: 'de-sql', company_id: rows.users[0].companyId, role: 1,
      email: 'sql@example.com', fullName: 'Vino de SQL',
    })

    const listado = await call(rows, { userId: admin.id }, '/api/users', 'GET')
    const editado = await call(rows, { userId: admin.id }, '/api/users/de-sql', 'POST', {
      fullName: 'No debe cambiar',
    })

    expect(listado.body.users.map((row) => row.id)).not.toContain('de-sql')
    expect(editado).toMatchObject({ status: 404, body: { error: 'USER_NOT_FOUND' } })
  })

  test('y la de siempre sigue en pie: una empresa no alcanza a otra', async () => {
    const { rows, admin } = fixture()
    rows.vehicles.push({ vin: '1HGCM82633A004352', companyId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' })

    const listadas = await call(rows, { userId: admin.id }, '/api/vehicles', 'GET')

    expect(listadas.body.vehicles.map((row) => row.vin)).not.toContain('1HGCM82633A004352')
    expect(listadas.body.pendingVehicles.map((row) => row?.vin)).not.toContain('1HGCM82633A004352')
  })
})

describe('remover una unidad de la flota', () => {
  const OTRA = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

  test('el administrador se la lleva con todo su rastro', async () => {
    const { rows, admin } = fixture()
    rows.events.push({ id: 'EV-1', companyId: COMPANY, vin: VEHICLE, userId: admin.id, kind: 'state', note: '', photos: [], createdAt: new Date().toISOString() })
    rows.vehiclePositions.push({ id: 'POS-1', companyId: COMPANY, vin: VEHICLE, latitude: 25.6, longitude: -80.3, createdAt: new Date().toISOString() })
    rows.dismissals.push({ id: 'DIS-1', companyId: COMPANY, vin: VEHICLE, alertId: 'a', title: 't', createdAt: new Date().toISOString() })

    const gone = await call(rows, { userId: admin.id }, `/api/vehicles/${VEHICLE}`, 'DELETE')

    expect(gone).toMatchObject({ status: 200, body: { ok: true, vin: VEHICLE } })
    expect(rows.vehicles.some((row) => row.vin === VEHICLE)).toBe(false)
    expect(rows.events).toHaveLength(0)
    expect(rows.vehiclePositions).toHaveLength(0)
    expect(rows.dismissals).toHaveLength(0)
    expect(rows.vehicleLocations.some((row) => row.vin === VEHICLE)).toBe(false)
  })

  test('el operador no puede, aunque pueda cambiarle el estado', async () => {
    // Es la razon de que tenga permiso propio: cambiar el estado es el trabajo
    // del dia; retirarla y llevarse el historial es otra cosa.
    const { rows, operator } = fixture()

    const gone = await call(rows, { userId: operator.id }, `/api/vehicles/${VEHICLE}`, 'DELETE')

    expect(gone.status).toBe(403)
    expect(rows.vehicles.some((row) => row.vin === VEHICLE)).toBe(true)
  })

  test('las fotos se marcan para borrar del almacenamiento, no solo sus filas', async () => {
    const { rows, admin } = fixture()
    rows.photos.push(
      { id: 'F-1', companyId: COMPANY, vin: VEHICLE, filename: 'F-1.jpg', contentType: 'image/jpeg', width: 1, height: 1, bytes: 1, createdAt: new Date().toISOString() },
      { id: 'F-2', companyId: COMPANY, vin: VEHICLE, filename: 'F-2.jpg', contentType: 'image/jpeg', width: 1, height: 1, bytes: 1, createdAt: new Date().toISOString() },
    )
    const borradas = []

    await call(rows, { userId: admin.id }, `/api/vehicles/${VEHICLE}`, 'DELETE', undefined, {
      dropPhotos: (nombres) => borradas.push(...nombres),
    })

    expect(rows.photos).toHaveLength(0)
    // Sin esto, las imagenes se quedarian ocupando sitio para siempre.
    expect(borradas.sort()).toEqual(['F-1.jpg', 'F-2.jpg'])
  })

  test('no borra el vehiculo para otra compañia: la clave es (compañia, VIN)', async () => {
    const { rows, admin } = fixture()
    // La misma unidad, en la flota de otra empresa.
    new Vehicles(rows, { companyId: OTRA }).create(VEHICLE)
    expect(rows.vehicles.filter((row) => row.vin === VEHICLE)).toHaveLength(2)

    await call(rows, { userId: admin.id }, `/api/vehicles/${VEHICLE}`, 'DELETE')

    const quedan = rows.vehicles.filter((row) => row.vin === VEHICLE)
    expect(quedan).toHaveLength(1)
    expect(quedan[0].companyId).toBe(OTRA)
  })

  test('y el mismo VIN se puede volver a escanear despues, como nuevo', async () => {
    const { rows, admin } = fixture()
    await call(rows, { userId: admin.id }, `/api/vehicles/${VEHICLE}`, 'DELETE')

    const otra = await call(rows, { userId: admin.id }, '/api/vehicles', 'POST', { vin: VEHICLE })

    expect(otra.status).toBe(200)
    expect(otra.body.created).toBe(true)
    expect(rows.vehicles.some((row) => row.vin === VEHICLE && row.companyId === COMPANY)).toBe(true)
  })

  test('una unidad que no existe contesta lo mismo que una ajena', async () => {
    const { rows, admin } = fixture()

    const nada = await call(rows, { userId: admin.id }, '/api/vehicles/1HGCM82633A004352', 'DELETE')

    expect(nada).toMatchObject({ status: 404, body: { error: 'VEHICLE_NOT_FOUND' } })
  })
})
