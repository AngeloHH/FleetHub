import { describe, expect, test } from 'vitest'
import { ADMIN_TABS, OPERATOR_TABS, PLACES } from './screens'

describe('rutas del frontend', () => {
  test('usa nombres en inglés en todas las pantallas y barras de navegación', () => {
    const paths = [
      ...PLACES.map((place) => place.path),
      ...Object.values(OPERATOR_TABS),
      ...Object.values(ADMIN_TABS),
    ]
    const spanishSegments =
      /\/(?:entrar|registro|codigo|contrasena|mapa|unidades|escanear|reportes|alertas|perfil|galeria|rutas|usuarios)(?:\/|$)/

    for (const path of paths) expect(path).not.toMatch(spanishSegments)
  })

  test('conserva el contrato de rutas públicas y administrativas', () => {
    expect(PLACES.map((place) => place.path)).toEqual([
      '/login',
      '/register',
      '/verify-code',
      '/password',
      '/map',
      '/map/:id',
      '/vehicles/:id',
      '/vehicles/:id/details',
      '/scan',
      '/scan/manual',
      '/scan/vin',
      '/reports',
      '/alerts',
      '/profile',
      '/profile/personal-data',
      '/profile/locations',
      '/profile/history',
      '/profile/support',
      '/admin',
      '/admin/locations',
      '/admin/locations/:code',
      '/admin/reports',
      '/admin/reports/vehicles/:id',
      '/admin/users',
      '/admin/users/new',
      '/admin/users/:id',
      '/admin/users/:id/personal-data',
      '/admin/users/:id/locations',
      '/admin/users/:id/history',
    ])
  })
})
