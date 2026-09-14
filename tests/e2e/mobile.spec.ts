// Lo que sólo pasa en un teléfono.
//
// Cámara, GPS y archivos de imagen: las tres cosas que en un escritorio
// funcionan siempre y en la calle no. Estas pruebas corren en el perfil móvil
// de Playwright —pantalla, agente de usuario y eventos táctiles de un Pixel—
// con la geolocalización simulada y los permisos concedidos, que es lo más
// cerca de un teléfono real a lo que se llega sin uno.
//
// Lo que sigue necesitando un aparato de verdad no se finge aquí: el sensor de
// la cámara, la precisión del GPS al aire libre y el decodificador HEIC de
// Safari. Queda como comprobación manual en OPERATIONS.md. Lo que sí se
// comprueba es que la aplicación lea los permisos, use la posición que le den,
// convierta la foto a JPEG antes de subirla y no se quede callada ante un
// archivo que no sabe abrir.

import { expect, test, type APIRequestContext, type Page } from 'playwright/test'
import { vehicleCode } from '../../src/domain/identity'

const MIAMI = { latitude: 25.7617, longitude: -80.1918 }
const VIN = '3MVDMBBM2PM512094'
const PASSWORD = 'Clave-Segura1'

const identity = () => {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1_000_000)}`
  return {
    email: `movil-${stamp}@example.com`,
    phone: stamp.slice(-10).padStart(10, '7'),
  }
}

/** Un JPEG diminuto pero real: cabecera, marco de 1×1 y barrido. */
const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
  'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA' +
  'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
  'base64',
)

/**
 * Una compañía con administración dentro, una location y una unidad asignada.
 *
 * Se monta por API a propósito: lo que estas pruebas miran es el teléfono, y
 * llegar hasta la ficha de una unidad rellenando seis formularios convertiría
 * cualquier fallo de la cámara en un fallo del registro.
 */
async function outfit(request: APIRequestContext) {
  const who = identity()
  const company = await request.post('/api/companies', { data: {} })
  expect(company.ok()).toBe(true)
  const invite = (await company.json()).code

  const issued = await request.post('/api/tokens', {
    data: { purpose: 'REGISTER', addressee: who.email, email: who.email },
  })
  expect(issued.ok()).toBe(true)
  const confirmed = await request.post('/api/tokens', {
    data: {
      action: 'spend', purpose: 'REGISTER', addressee: who.email,
      code: (await issued.json()).code,
    },
  })
  expect(confirmed.ok()).toBe(true)
  const registration = await request.post('/api/registrations', {
    data: {
      fullName: 'Operadora Móvil', email: who.email, phoneCode: '+1', phone: who.phone,
      language: 'es', password: PASSWORD, code: invite,
      registrationToken: (await confirmed.json()).registrationToken,
    },
  })
  expect(registration.ok()).toBe(true)
  const account = await registration.json()
  const auth = { authorization: `Bearer ${account.token}` }

  const location = await request.post('/api/locations', {
    headers: auth,
    data: { name: 'PATIO MÓVIL', points: [{ address: '100 Test Avenue, Miami, FL', ...MIAMI }] },
  })
  expect(location.ok()).toBe(true)

  const vehicle = await request.post('/api/vehicles', { headers: auth, data: { vin: VIN } })
  expect(vehicle.ok()).toBe(true)
  const assigned = await request.post(`/api/vehicles/${VIN}/locations`, {
    headers: auth,
    data: { locationId: (await location.json()).location.id, replace: true },
  })
  expect(assigned.ok()).toBe(true)

  return { ...who, ...account, auth }
}

/**
 * Entra por la pantalla de acceso, con contraseña, como se entra en la calle.
 *
 * Las direcciones llevan almohadilla porque el enrutador vive en el hash: la
 * copia de revisión de esta aplicación es un único HTML que se abre desde
 * disco, y `pushState` no funciona sobre `file://`.
 */
async function signIn(page: Page, email: string) {
  await page.goto('/#/login')
  await page.getByRole('button', { name: 'ENTRAR CON CONTRASEÑA' }).click()
  await page.getByLabel('CORREO DE TRABAJO').fill(email)
  await page.getByLabel('CONTRASEÑA', { exact: true }).fill(PASSWORD)
  await page.getByRole('button', { name: 'ENTRAR', exact: true }).click()
  await expect(page).toHaveURL(/\/profile$/)
}

test.describe('en un teléfono', () => {
  test.use({
    geolocation: MIAMI,
    permissions: ['geolocation'],
    locale: 'es-MX',
    timezoneId: 'America/New_York',
  })

  test('el interruptor de cámara y GPS dice el estado real, no uno de adorno', async ({ page, request, context }) => {
    const account = await outfit(request)
    await signIn(page, account.email)
    const camara = page.getByRole('switch', { name: 'Cámara y GPS' })

    // Con la geolocalización concedida y la cámara no, está apagado. Sale de
    // navigator.permissions y no de una constante: concediendo las dos, cambia.
    await expect(camara).toHaveAttribute('aria-checked', 'false')
    await expect(camara).toHaveAttribute('aria-disabled', 'true')

    await context.grantPermissions(['geolocation', 'camera'])
    await page.reload()
    await expect(camara).toHaveAttribute('aria-checked', 'true')
  })

  test('los interruptores fuera de servicio no se dejan cambiar', async ({ page, request }) => {
    const account = await outfit(request)
    await signIn(page, account.email)
    const sinConexion = page.getByRole('switch', { name: 'Modo sin conexión' })

    // Está, se anuncia como interruptor y dice que no hay modo sin conexión.
    await expect(sinConexion).toHaveAttribute('aria-checked', 'false')
    // Y está fuera de servicio de verdad: Playwright se niega a pulsarlo, que
    // es exactamente lo que hará un lector de pantalla y lo que dice el ARIA.
    await expect(sinConexion).toBeDisabled()

    // Ni forzando el clic cambia: no hay controlador detrás que pueda obedecer.
    await sinConexion.click({ force: true })
    await expect(sinConexion).toHaveAttribute('aria-checked', 'false')
    // Tampoco entra en el recorrido del teclado.
    await expect(sinConexion).not.toBeFocused()
  })

  test('la ficha de una unidad abre entera y sin errores en consola', async ({ page, request }) => {
    const account = await outfit(request)
    const crashes: string[] = []
    await signIn(page, account.email)
    page.on('pageerror', (error) => crashes.push(error.message))

    await page.goto(`/#/vehicles/${vehicleCode(VIN)}`)

    await expect(page.getByRole('button', { name: 'GUARDAR CAMBIOS' })).toBeVisible()
    await expect(page.getByText('FOTOS DEL VEHÍCULO')).toBeVisible()
    expect(crashes).toEqual([])
  })

  test('sin WebGL el mapa lo dice y el resto de la pantalla sigue', async ({ page, request }) => {
    const account = await outfit(request)
    // Un WebView con la GPU desactivada, una política de empresa, un teléfono
    // viejo. MapLibre no puede construirse y antes eso tumbaba la pantalla
    // entera: la lista, la ficha y las pestañas se iban con el mapa.
    await page.addInitScript(() => {
      const real = HTMLCanvasElement.prototype.getContext
      HTMLCanvasElement.prototype.getContext = function getContext(
        this: HTMLCanvasElement,
        kind: string,
        ...rest: unknown[]
      ) {
        if (kind === 'webgl' || kind === 'webgl2' || kind === 'experimental-webgl') return null
        return (real as (...args: unknown[]) => unknown).call(this, kind, ...rest)
      } as typeof HTMLCanvasElement.prototype.getContext
    })
    const crashes: string[] = []
    page.on('pageerror', (error) => crashes.push(error.message))
    await signIn(page, account.email)

    await page.goto('/#/map')

    await expect(page.getByRole('status')).toContainText('NO PUEDE DIBUJAR EL MAPA')
    // Y las pestañas siguen ahí: la pantalla no se cayó con el mapa.
    await expect(page.getByRole('button', { name: 'PERFIL' })).toBeVisible()
    expect(crashes).toEqual([])
  })

  test('una foto elegida se encoge, se sube y queda en el historial', async ({ page, request }) => {
    const account = await outfit(request)
    await signIn(page, account.email)
    await page.goto(`/#/vehicles/${vehicleCode(VIN)}`)

    await page.getByLabel('Añadir foto').setInputFiles({
      name: 'unidad.jpg', mimeType: 'image/jpeg', buffer: JPEG,
    })
    // La miniatura aparece: el archivo pasó por el lienzo y salió JPEG.
    await expect(page.getByRole('button', { name: 'Seleccionar foto 1' })).toBeVisible()

    await page.getByRole('button', { name: 'GUARDAR CAMBIOS' }).click()

    // Y llegó al servidor, atada al evento que la explica.
    await expect.poll(async () => {
      const events = await request.get('/api/events', { headers: account.auth })
      if (!events.ok()) return 0
      const rows: { photos?: string[] }[] = (await events.json()).events ?? []
      return rows.flatMap((row) => row.photos ?? []).length
    }, { timeout: 20_000 }).toBeGreaterThan(0)
  })

  test('un archivo que el navegador no sabe abrir se dice, no se traga', async ({ page, request }) => {
    const account = await outfit(request)
    await signIn(page, account.email)
    const crashes: string[] = []
    page.on('pageerror', (error) => crashes.push(error.message))
    await page.goto(`/#/vehicles/${vehicleCode(VIN)}`)

    // Un HEIC de mentira: la cabecera correcta y nada detrás. Chromium no
    // decodifica HEIC, así que se comporta igual que un Android real.
    await page.getByLabel('Añadir foto').setInputFiles({
      name: 'unidad.heic',
      mimeType: 'image/heic',
      buffer: Buffer.concat([
        Buffer.from([0, 0, 0, 24]), Buffer.from('ftypheic', 'latin1'), Buffer.alloc(12),
      ]),
    })

    await expect(page.getByRole('alert')).toContainText('NO SE PUDO LEER ESA IMAGEN')
    await expect(page.getByRole('button', { name: 'Seleccionar foto 1' })).toHaveCount(0)
    // Y la promesa rota no acaba en la consola como error suelto.
    expect(crashes).toEqual([])
  })

  test('el alta manual guarda la unidad donde dice el GPS del teléfono', async ({ page, request }) => {
    const account = await outfit(request)
    await signIn(page, account.email)

    const nuevo = '1HGCM82633A004352'
    await page.goto('/#/scan/manual')
    await page.getByLabel('NÚMERO DE IDENTIFICACIÓN').fill(nuevo)
    // El VIN completo avanza solo a la confirmación: no hay botón que pulsar.
    await expect(page).toHaveURL(/\/scan\/vin$/)
    await page.getByRole('button', { name: /GUARDAR UNIDAD/ }).click()

    const position = await new Promise<{ latitude: number; longitude: number } | null>(
      (resolve) => {
        const deadline = Date.now() + 20_000
        const look = async () => {
          const answer = await request.get(`/api/vehicles/${nuevo}/positions`, { headers: account.auth })
          const held = answer.ok() ? (await answer.json()).position : null
          if (held || Date.now() > deadline) return resolve(held)
          setTimeout(look, 400)
        }
        void look()
      },
    )

    expect(position).not.toBeNull()
    expect(Math.abs(position!.latitude - MIAMI.latitude)).toBeLessThan(0.001)
    expect(Math.abs(position!.longitude - MIAMI.longitude)).toBeLessThan(0.001)
  })
})
