import { describe, expect, test, vi } from 'vitest'
import { AddressAutocomplete } from './geocoder.mjs'

describe('autocompletado de direcciones', () => {
  test('normaliza la respuesta externa y nunca expone datos adicionales', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ results: [{
      formatted: '1600 Pennsylvania Ave NW, Washington, DC 20500, United States',
      lat: 38.89768,
      lon: -77.03653,
      provider_secret: 'no debe salir',
    }] }), { status: 200 }))
    const geocoder = new AddressAutocomplete({ apiKey: 'secret', fetcher })

    await expect(geocoder.suggest('1600 pennsylvania', { language: 'es' })).resolves.toEqual({
      ok: true,
      suggestions: [{
        address: '1600 Pennsylvania Ave NW, Washington, DC 20500, United States',
        latitude: 38.89768,
        longitude: -77.03653,
      }],
    })
    const requested = new URL(String(fetcher.mock.calls[0][0]))
    expect(requested.searchParams.get('lang')).toBe('es')
    expect(requested.searchParams.get('limit')).toBe('5')
  })

  test('responde de forma explícita cuando falta configuración', async () => {
    const geocoder = new AddressAutocomplete({ apiKey: '', fetcher: vi.fn() })
    await expect(geocoder.suggest('Miami Beach')).resolves.toEqual({
      ok: false,
      error: 'GEOCODING_NOT_CONFIGURED',
    })
  })

  test('no consulta por menos de tres caracteres y reutiliza búsquedas recientes', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ results: [] }), { status: 200 }))
    const geocoder = new AddressAutocomplete({ apiKey: 'secret', fetcher })
    await expect(geocoder.suggest('Mi')).resolves.toEqual({ ok: true, suggestions: [] })
    await geocoder.suggest('Miami')
    await geocoder.suggest('  MIAMI  ')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
