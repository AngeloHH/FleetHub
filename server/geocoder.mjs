const clean = (value) => String(value ?? '').trim()

/**
 * Adaptador pequeño sobre Geoapify. El resto del servidor sólo conoce nuestro
 * contrato estable: una dirección lista para mostrar y sus coordenadas.
 */
export class AddressAutocomplete {
  constructor({ apiKey = process.env.GEOAPIFY_API_KEY, fetcher = globalThis.fetch, ttl = 5 * 60_000 } = {}) {
    this.apiKey = clean(apiKey)
    this.fetcher = fetcher
    this.ttl = ttl
    this.cache = new Map()
  }

  async suggest(text, { language = 'en', limit = 5 } = {}) {
    const query = clean(text)
    if (query.length < 3) return { ok: true, suggestions: [] }
    if (!this.apiKey) return { ok: false, error: 'GEOCODING_NOT_CONFIGURED' }

    const lang = /^[a-z]{2}$/i.test(language) ? language.toLowerCase() : 'en'
    const size = Math.min(5, Math.max(1, Number(limit) || 5))
    const cacheKey = `${lang}:${query.toLocaleLowerCase()}`
    const cached = this.cache.get(cacheKey)
    if (cached && cached.until > Date.now()) return { ok: true, suggestions: cached.suggestions }

    const url = new URL('https://api.geoapify.com/v1/geocode/autocomplete')
    url.searchParams.set('text', query)
    url.searchParams.set('format', 'json')
    url.searchParams.set('lang', lang)
    url.searchParams.set('limit', String(size))
    url.searchParams.set('apiKey', this.apiKey)

    try {
      const response = await this.fetcher(url, {
        headers: { accept: 'application/json', 'user-agent': 'FleetHub/1.0' },
        signal: AbortSignal.timeout(8_000),
      })
      if (!response.ok) return { ok: false, error: 'GEOCODING_UNAVAILABLE' }
      const payload = await response.json()
      const suggestions = (Array.isArray(payload?.results) ? payload.results : [])
        .map((result) => ({
          address: clean(result.formatted),
          latitude: Number(result.lat),
          longitude: Number(result.lon),
        }))
        .filter((result) => result.address
          && Number.isFinite(result.latitude) && result.latitude >= -90 && result.latitude <= 90
          && Number.isFinite(result.longitude) && result.longitude >= -180 && result.longitude <= 180)
        .slice(0, size)

      this.cache.set(cacheKey, { until: Date.now() + this.ttl, suggestions })
      if (this.cache.size > 200) this.cache.delete(this.cache.keys().next().value)
      return { ok: true, suggestions }
    } catch {
      return { ok: false, error: 'GEOCODING_UNAVAILABLE' }
    }
  }
}
