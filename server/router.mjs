const clean = (value) => String(value ?? '').trim()

/**
 * Calcula el recorrido por carretera entre los puntos de una location.
 * FleetHub conserva distancia, duración y la línea mínima necesaria para
 * estimar una posición. El resto de la respuesta del proveedor se descarta.
 */
export class RouteEstimator {
  constructor({ apiKey = process.env.GEOAPIFY_API_KEY, fetcher = globalThis.fetch, ttl = 10 * 60_000 } = {}) {
    this.apiKey = clean(apiKey)
    this.fetcher = fetcher
    this.ttl = ttl
    this.cache = new Map()
  }

  async estimate(points = []) {
    if (!Array.isArray(points) || points.length < 2)
      return { ok: false, error: 'ROUTE_NEEDS_TWO_POINTS' }
    if (!this.apiKey) return { ok: false, error: 'ROUTING_NOT_CONFIGURED' }

    const coordinates = points.map((point) => ({
      latitude: Number(point?.latitude),
      longitude: Number(point?.longitude),
    }))
    if (coordinates.some(({ latitude, longitude }) =>
      !Number.isFinite(latitude) || latitude < -90 || latitude > 90
      || !Number.isFinite(longitude) || longitude < -180 || longitude > 180))
      return { ok: false, error: 'INVALID_POINT_POSITION' }

    const cacheKey = coordinates.map(({ latitude, longitude }) => `${latitude},${longitude}`).join('|')
    const cached = this.cache.get(cacheKey)
    if (cached && cached.until > Date.now()) return { ok: true, ...cached.estimate }

    const url = new URL('https://api.geoapify.com/v1/routing')
    url.searchParams.set('waypoints', cacheKey)
    url.searchParams.set('mode', 'drive')
    url.searchParams.set('traffic', 'approximated')
    url.searchParams.set('intermediate_waypoint_mode', 'stopover')
    url.searchParams.set('format', 'geojson')
    url.searchParams.set('apiKey', this.apiKey)

    try {
      const response = await this.fetcher(url, {
        headers: { accept: 'application/json', 'user-agent': 'FleetHub/1.0' },
        signal: AbortSignal.timeout(10_000),
      })
      if (!response.ok) return { ok: false, error: 'ROUTING_UNAVAILABLE' }
      const payload = await response.json()
      const feature = Array.isArray(payload?.features) ? payload.features[0] : undefined
      const route = feature?.properties
      const distanceMeters = Math.round(Number(route?.distance))
      const durationSeconds = Math.round(Number(route?.time))
      if (!Number.isFinite(distanceMeters) || distanceMeters < 0
        || !Number.isFinite(durationSeconds) || durationSeconds < 0)
        return { ok: false, error: 'ROUTING_UNAVAILABLE' }

      const legs = feature?.geometry?.type === 'MultiLineString'
        ? feature.geometry.coordinates
        : feature?.geometry?.type === 'LineString'
          ? [feature.geometry.coordinates]
          : []
      const geometry = []
      for (const leg of legs) {
        if (!Array.isArray(leg)) continue
        for (const coordinate of leg) {
          if (!Array.isArray(coordinate) || coordinate.length < 2) continue
          const longitude = Number(coordinate[0])
          const latitude = Number(coordinate[1])
          if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180
            || !Number.isFinite(latitude) || latitude < -90 || latitude > 90) continue
          const previous = geometry.at(-1)
          if (!previous || previous[0] !== longitude || previous[1] !== latitude)
            geometry.push([longitude, latitude])
        }
      }
      if (geometry.length < 2) return { ok: false, error: 'ROUTING_UNAVAILABLE' }

      const estimate = {
        distanceMeters,
        durationSeconds,
        geometry,
        routingProvider: 'geoapify',
        routingTraffic: 'approximated',
        routingCalculatedAt: new Date().toISOString(),
      }
      this.cache.set(cacheKey, { until: Date.now() + this.ttl, estimate })
      if (this.cache.size > 200) this.cache.delete(this.cache.keys().next().value)
      return { ok: true, ...estimate }
    } catch {
      return { ok: false, error: 'ROUTING_UNAVAILABLE' }
    }
  }
}
