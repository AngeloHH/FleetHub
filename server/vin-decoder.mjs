const clean = (value) => String(value ?? '').trim()

/**
 * Adaptador del proveedor externo. El resto del servidor nunca conoce la
 * respuesta completa de vPIC: recibe únicamente los campos que FleetHub usa.
 */
export async function decodeVin(vin, { fetcher = fetch, timeout = 6_000 } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    const url = `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${encodeURIComponent(vin)}?format=json`
    const response = await fetcher(url, { signal: controller.signal })
    if (!response.ok) return { ok: false, error: 'DECODER_UNAVAILABLE' }

    const body = await response.json()
    const row = Array.isArray(body?.Results) ? body.Results[0] : null
    const details = row ? {
      year: clean(row.ModelYear),
      make: clean(row.Make),
      model: clean(row.Model),
      trim: clean(row.Trim),
      body: clean(row.BodyClass),
      engine: [
        clean(row.DisplacementL) ? `${clean(row.DisplacementL)}L` : '',
        clean(row.EngineConfiguration),
        clean(row.EngineCylinders) ? `${clean(row.EngineCylinders)} CIL.` : '',
      ].filter(Boolean).join(' '),
    } : null

    if (!details?.year || !details.make || !details.model)
      return { ok: false, error: 'INCOMPLETE_DECODE' }
    return { ok: true, decoder: 'nhtsa-vpic', details }
  } catch {
    return { ok: false, error: 'DECODER_UNAVAILABLE' }
  } finally {
    clearTimeout(timer)
  }
}
