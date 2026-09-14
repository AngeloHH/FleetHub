import { describe, expect, test, vi } from 'vitest'
import { dailyLimits, dayOf, Quotas, WARN_AT } from './quota.mjs'

const at = (iso) => () => new Date(iso)
const limits = { geoapify: 10, 'vin-decoder': 4 }

describe('cuotas diarias de proveedores', () => {
  test('cuenta lo gastado y lo que queda', () => {
    const table = {}
    const quotas = new Quotas(table, { limits, now: at('2026-03-01T10:00:00.000Z') })

    expect(quotas.state('geoapify')).toEqual({ provider: 'geoapify', used: 0, limit: 10, remaining: 10 })
    expect(quotas.spend('geoapify')).toMatchObject({ ok: true, used: 1, remaining: 9 })
    expect(quotas.spend('geoapify')).toMatchObject({ ok: true, used: 2, remaining: 8 })
    expect(table.geoapify).toMatchObject({ day: '2026-03-01', count: 2 })
  })

  test('un día nuevo empieza de cero', () => {
    const table = {}
    new Quotas(table, { limits, now: at('2026-03-01T23:59:00.000Z') }).spend('geoapify')
    const tomorrow = new Quotas(table, { limits, now: at('2026-03-02T00:01:00.000Z') })

    expect(tomorrow.used('geoapify')).toBe(0)
    expect(tomorrow.spend('geoapify')).toMatchObject({ ok: true, used: 1 })
  })

  test('agotada, la petición que sobra no se cuenta ni se hace', () => {
    const quotas = new Quotas({}, { limits: { 'vin-decoder': 2 } })
    expect(quotas.spend('vin-decoder').ok).toBe(true)
    expect(quotas.spend('vin-decoder').ok).toBe(true)

    const refused = quotas.spend('vin-decoder')
    expect(refused).toMatchObject({ ok: false, error: 'QUOTA_EXCEEDED', used: 2, remaining: 0 })
    // El contador se queda quieto: insistir no lo sube.
    expect(quotas.used('vin-decoder')).toBe(2)
  })

  test('avisa una sola vez al cruzar el umbral', () => {
    const notify = vi.fn()
    const quotas = new Quotas({}, { limits: { geoapify: 10 }, notify })

    for (let n = 0; n < Math.floor(10 * WARN_AT) - 1; n += 1) quotas.spend('geoapify')
    expect(notify).not.toHaveBeenCalled()

    quotas.spend('geoapify')
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify.mock.calls[0][0]).toBe('provider_quota_warning')
    expect(notify.mock.calls[0][1]).toMatchObject({ provider: 'geoapify', limit: 10, used: 8 })

    quotas.spend('geoapify')
    quotas.spend('geoapify')
    expect(notify).toHaveBeenCalledTimes(1)
  })

  test('un tope de cero es no tener tope', () => {
    const quotas = new Quotas({}, { limits: { geoapify: 0 } })
    for (let n = 0; n < 50; n += 1) expect(quotas.spend('geoapify').ok).toBe(true)
  })

  test('guarda después de cada apunte', () => {
    const save = vi.fn()
    new Quotas({}, { limits, save }).spend('geoapify')
    expect(save).toHaveBeenCalled()
  })
})

describe('proveedores envueltos por su contador', () => {
  test('deja pasar mientras quede cuota', async () => {
    const call = vi.fn(async () => ({ ok: true, suggestions: [] }))
    const guarded = new Quotas({}, { limits }).guard('geoapify', call)

    await expect(guarded('Brickell', { language: 'es' })).resolves.toEqual({ ok: true, suggestions: [] })
    expect(call).toHaveBeenCalledWith('Brickell', { language: 'es' })
  })

  test('agotada, no llama al proveedor y avisa', async () => {
    const notify = vi.fn()
    const call = vi.fn(async () => ({ ok: true }))
    const quotas = new Quotas({}, { limits: { geoapify: 1 }, notify })
    const guarded = quotas.guard('geoapify', call)

    await guarded()
    await expect(guarded()).resolves.toEqual({ ok: false, error: 'QUOTA_EXCEEDED' })
    expect(call).toHaveBeenCalledTimes(1)
    expect(notify.mock.calls.map(([event]) => event)).toContain('provider_quota_exceeded')
  })

  test('sin proveedor configurado no se inventa uno', () => {
    expect(new Quotas({}, { limits }).guard('geoapify', undefined)).toBeUndefined()
  })
})

describe('configuración', () => {
  test('los topes salen del entorno y tienen valores por defecto', () => {
    expect(dailyLimits({})).toEqual({ geoapify: 2_500, 'vin-decoder': 5_000 })
    expect(dailyLimits({ GEOAPIFY_DAILY_LIMIT: '100', VIN_DECODER_DAILY_LIMIT: '7' }))
      .toEqual({ geoapify: 100, 'vin-decoder': 7 })
    // Un valor absurdo no apaga el tope por accidente: se ignora.
    expect(dailyLimits({ GEOAPIFY_DAILY_LIMIT: 'muchas' }).geoapify).toBe(2_500)
  })

  test('el día se imputa en UTC', () => {
    expect(dayOf(new Date('2026-03-01T23:30:00.000Z'))).toBe('2026-03-01')
    expect(dayOf(new Date('2026-03-02T00:30:00.000Z'))).toBe('2026-03-02')
  })
})
