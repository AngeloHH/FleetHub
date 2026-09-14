import { describe, expect, test, vi } from 'vitest'
import { RouteEstimator } from './router.mjs'

const POINTS = [
  { latitude: 25.7617, longitude: -80.1918 },
  { latitude: 25.7907, longitude: -80.1300 },
]

describe('cálculo de recorridos', () => {
  test('conserva distancia, duración y la geometría vial mínima de Geoapify', async () => {
    const fetcher = vi.fn(async () => ({
      ok: true,
      json: async () => ({ features: [{
        properties: { distance: 8421.4, time: 913.2, legs: [{ ignored: true }] },
        geometry: { type: 'MultiLineString', coordinates: [
          [[-80.1918, 25.7617], [-80.17, 25.77]],
          [[-80.17, 25.77], [-80.13, 25.7907]],
        ] },
      }] }),
    }))
    const router = new RouteEstimator({ apiKey: 'test-key', fetcher })
    const result = await router.estimate(POINTS)
    expect(result).toMatchObject({
      ok: true,
      distanceMeters: 8421,
      durationSeconds: 913,
      geometry: [[-80.1918, 25.7617], [-80.17, 25.77], [-80.13, 25.7907]],
      routingProvider: 'geoapify',
      routingTraffic: 'approximated',
    })
    const url = fetcher.mock.calls[0][0]
    expect(url.searchParams.get('waypoints')).toBe('25.7617,-80.1918|25.7907,-80.13')
    expect(url.searchParams.get('traffic')).toBe('approximated')
    expect(url.searchParams.get('format')).toBe('geojson')
    expect(result).not.toHaveProperty('legs')
  })

  test('necesita configuración y dos puntos', async () => {
    expect(await new RouteEstimator({ apiKey: '' }).estimate(POINTS))
      .toMatchObject({ error: 'ROUTING_NOT_CONFIGURED' })
    expect(await new RouteEstimator({ apiKey: 'x' }).estimate(POINTS.slice(0, 1)))
      .toMatchObject({ error: 'ROUTE_NEEDS_TWO_POINTS' })
  })
})
