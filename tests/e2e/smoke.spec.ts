import { expect, test, type APIRequestContext } from 'playwright/test'

const identity = () => {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1_000_000)}`
  return {
    email: `e2e-${stamp}@example.com`,
    phone: stamp.slice(-10).padStart(10, '7'),
  }
}

async function register(request: APIRequestContext, options: {
  email: string
  phone: string
  invite: string
  name: string
  password?: string
}) {
  const issued = await request.post('/api/tokens', {
    data: { purpose: 'REGISTER', addressee: options.email, email: options.email },
  })
  expect(issued.ok()).toBe(true)
  const issuedBody = await issued.json()

  const confirmed = await request.post('/api/tokens', {
    data: {
      action: 'spend', purpose: 'REGISTER', addressee: options.email,
      code: issuedBody.code,
    },
  })
  expect(confirmed.ok()).toBe(true)
  const confirmedBody = await confirmed.json()

  const registration = await request.post('/api/registrations', {
    data: {
      fullName: options.name, email: options.email, phoneCode: '+1', phone: options.phone,
      language: 'es', password: options.password ?? 'Clave-Segura1',
      code: options.invite,
      registrationToken: confirmedBody.registrationToken,
    },
  })
  expect(registration.ok()).toBe(true)
  return registration.json()
}

async function firstAdministrator(request: APIRequestContext) {
  const who = identity()
  const company = await request.post('/api/companies', { data: {} })
  expect(company.ok()).toBe(true)
  const companyBody = await company.json()
  const account = await register(request, {
    ...who, invite: companyBody.code, name: 'Administrador E2E',
  })
  return { ...who, ...account }
}

test('la aplicación abre directamente en una URL pública válida', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/login')
  await expect(page.getByRole('button', { name: 'ENVIAR CÓDIGO' })).toBeVisible()
  await expect(page).toHaveURL(/\/login$/)
  expect(errors).toEqual([])
})

test('el frontend desplegado comparte el mismo origen con la API', async ({ request }) => {
  const response = await request.get('/api/users/password')
  expect(response.ok()).toBe(true)
  await expect(response.json()).resolves.toMatchObject({
    ok: true,
    rules: { 'min-length': '/.{8,}/su' },
  })
})

test('crea compañía, confirma correo, registra al administrador y abre sesión', async ({ request }) => {
  const registered = await firstAdministrator(request)
  expect(registered.user).toMatchObject({ email: registered.email, role: 'ADMINISTRADOR' })

  const users = await request.get('/api/users', {
    headers: { authorization: `Bearer ${registered.token}` },
  })
  expect(users.ok()).toBe(true)
  await expect(users.json()).resolves.toMatchObject({
    users: [{ email: registered.email, role: 'ADMINISTRADOR' }],
  })
})

test('login, invitación, recuperación y cambio de contraseña funcionan juntos', async ({ request }) => {
  const admin = await firstAdministrator(request)

  const login = await request.post('/api/tokens', {
    data: { purpose: 'SESSION', email: admin.email, password: 'Clave-Segura1' },
  })
  expect(login.ok()).toBe(true)
  const loginBody = await login.json()
  expect(loginBody.code).toMatch(/^[a-f0-9]{48}$/)

  const changed = await request.post(`/api/users/${admin.user.id}/password`, {
    headers: { authorization: `Bearer ${loginBody.code}` },
    data: { current: 'Clave-Segura1', password: 'Clave-Nueva2' },
  })
  expect(changed.ok()).toBe(true)

  const oldPassword = await request.post('/api/tokens', {
    data: { purpose: 'SESSION', email: admin.email, password: 'Clave-Segura1' },
  })
  expect(oldPassword.status()).toBe(401)
  const newPassword = await request.post('/api/tokens', {
    data: { purpose: 'SESSION', email: admin.email, password: 'Clave-Nueva2' },
  })
  expect(newPassword.ok()).toBe(true)
  const newSession = await newPassword.json()

  const invited = await request.post('/api/tokens', {
    headers: { authorization: `Bearer ${newSession.code}` },
    data: { purpose: 'INVITE', role: 'OPERADOR' },
  })
  expect(invited.ok()).toBe(true)
  const invite = await invited.json()
  const operatorIdentity = identity()
  const operator = await register(request, {
    ...operatorIdentity, invite: invite.code, name: 'Operador E2E',
  })
  expect(operator.user).toMatchObject({
    email: operatorIdentity.email,
    role: 'OPERADOR',
    companyId: admin.user.companyId,
  })

  const resetIssued = await request.post('/api/tokens', {
    data: { purpose: 'PASSWORD_RESET', email: admin.email, addressee: admin.email },
  })
  expect(resetIssued.ok()).toBe(true)
  const resetCode = await resetIssued.json()
  const resetSession = await request.post('/api/tokens', {
    data: {
      purpose: 'SESSION', email: admin.email, code: resetCode.code,
      codePurpose: 'PASSWORD_RESET',
    },
  })
  expect(resetSession.ok()).toBe(true)
  const resetBody = await resetSession.json()

  const reset = await request.post(`/api/users/${admin.user.id}/password`, {
    headers: { authorization: `Bearer ${resetBody.code}` },
    data: { password: 'Clave-Recuperada3' },
  })
  expect(reset.ok()).toBe(true)
})

test('crea una ubicación y una unidad, la asigna y registra su trabajo', async ({ request }) => {
  const admin = await firstAdministrator(request)

  const invited = await request.post('/api/tokens', {
    headers: { authorization: `Bearer ${admin.token}` },
    data: { purpose: 'INVITE', role: 'OPERADOR' },
  })
  expect(invited.ok()).toBe(true)
  const invitation = await invited.json()
  const who = identity()
  const operator = await register(request, {
    ...who, invite: invitation.code, name: 'Operador de flota E2E',
  })

  const locationResponse = await request.post('/api/locations', {
    headers: { authorization: `Bearer ${admin.token}` },
    data: {
      name: 'Patio E2E', active: true,
      points: [{ address: '100 Test Avenue, Miami, FL', latitude: 25.7617, longitude: -80.1918 }],
    },
  })
  expect(locationResponse.ok()).toBe(true)
  const location = (await locationResponse.json()).location

  const userAssignment = await request.post(`/api/users/${operator.user.id}/locations`, {
    headers: { authorization: `Bearer ${admin.token}` },
    data: { locationId: location.id },
  })
  expect(userAssignment.ok()).toBe(true)

  const vin = '1HGCM82633A004352'
  const vehicleResponse = await request.post('/api/vehicles', {
    headers: { authorization: `Bearer ${operator.token}` },
    data: { vin },
  })
  expect(vehicleResponse.ok()).toBe(true)
  await expect(vehicleResponse.json()).resolves.toMatchObject({
    created: true,
    manualRequired: false,
    vehicle: { vin, make: 'FleetHub', model: 'Unidad E2E' },
  })

  const vehicleAssignment = await request.post(`/api/vehicles/${vin}/locations`, {
    headers: { authorization: `Bearer ${operator.token}` },
    data: { locationId: location.id, replace: true },
  })
  expect(vehicleAssignment.ok()).toBe(true)

  const state = await request.post(`/api/vehicles/${vin}/state`, {
    headers: { authorization: `Bearer ${operator.token}` },
    data: { state: 1 },
  })
  expect(state.ok()).toBe(true)

  const position = await request.post(`/api/vehicles/${vin}/positions`, {
    headers: { authorization: `Bearer ${operator.token}` },
    data: { latitude: 25.7618, longitude: -80.1919, accuracy: 12 },
  })
  expect(position.ok()).toBe(true)

  const onePixelPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+H9Z8WQAAAABJRU5ErkJggg==',
    'base64',
  )
  const photoResponse = await request.post(`/api/vehicles/${vin}/photos`, {
    headers: { authorization: `Bearer ${operator.token}`, 'content-type': 'image/png' },
    data: onePixelPng,
  })
  expect(photoResponse.ok()).toBe(true)
  const photo = (await photoResponse.json()).photo

  const eventResponse = await request.post(`/api/vehicles/${vin}/events`, {
    headers: { authorization: `Bearer ${operator.token}` },
    data: { kind: 'attachments', note: 'Inspección E2E', photos: [photo.id] },
  })
  expect(eventResponse.ok()).toBe(true)

  const dismissalResponse = await request.post('/api/dismissals', {
    headers: { authorization: `Bearer ${operator.token}` },
    data: { vin, alertId: `${vin}·prueba`, title: 'Alerta E2E' },
  })
  expect(dismissalResponse.ok()).toBe(true)

  const fleet = await request.get('/api/vehicles', {
    headers: { authorization: `Bearer ${operator.token}` },
  })
  expect(fleet.ok()).toBe(true)
  await expect(fleet.json()).resolves.toMatchObject({
    vehicles: [{ vin, state: 1 }],
  })
  const events = await request.get('/api/events', {
    headers: { authorization: `Bearer ${operator.token}` },
  })
  expect(events.ok()).toBe(true)
  const eventRows = (await events.json()).events
  expect(eventRows).toEqual(expect.arrayContaining([
    expect.objectContaining({ vin, userId: operator.user.id, photos: [photo.id] }),
  ]))

  // Remover de la flota: se lleva el estado, el rastro, las alertas
  // descartadas, las fotos y los reportes. Un operador no puede hacerlo aunque
  // sí pueda cambiarle el estado a la misma unidad.
  const negado = await request.delete(`/api/vehicles/${vin}`, {
    headers: { authorization: `Bearer ${operator.token}` },
  })
  expect(negado.status()).toBe(403)

  const removed = await request.delete(`/api/vehicles/${vin}`, {
    headers: { authorization: `Bearer ${admin.token}` },
  })
  expect(removed.ok()).toBe(true)
  await expect(removed.json()).resolves.toMatchObject({ ok: true, vin })

  const sinUnidad = await request.get('/api/vehicles', {
    headers: { authorization: `Bearer ${admin.token}` },
  })
  await expect(sinUnidad.json()).resolves.toMatchObject({ vehicles: [], pendingVehicles: [] })

  const sinHistorial = await request.get('/api/events', {
    headers: { authorization: `Bearer ${admin.token}` },
  })
  expect((await sinHistorial.json()).events).toEqual([])

  // Y el mismo VIN vuelve a entrar como nuevo: no se prohibió, se soltó.
  const otraVez = await request.post('/api/vehicles', {
    headers: { authorization: `Bearer ${admin.token}` },
    data: { vin },
  })
  expect(otraVez.ok()).toBe(true)
  await expect(otraVez.json()).resolves.toMatchObject({ created: true })

  const purged = await request.delete(
    `/api/companies/current?confirm=${encodeURIComponent(admin.user.companyId)}`,
    { headers: { authorization: `Bearer ${admin.token}` } },
  )
  expect(purged.ok()).toBe(true)
  const formerSession = await request.get('/api/users', {
    headers: { authorization: `Bearer ${operator.token}` },
  })
  expect(formerSession.status()).toBe(401)
})
