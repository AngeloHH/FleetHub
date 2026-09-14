import { describe, expect, test, vi } from 'vitest'
import { decodeVin } from './vin-decoder.mjs'

const VIN = '3MVDMBBM2PM512094'

describe('decodificador VIN del servidor', () => {
  test('normaliza la respuesta de NHTSA sin conservarla completa', async () => {
    const fetcher = vi.fn(async () => ({
      ok: true,
      json: async () => ({ Results: [{
        ModelYear: '2023', Make: 'MAZDA', Model: 'CX-30', Trim: 'SELECT',
        BodyClass: 'Sport Utility Vehicle', DisplacementL: '2.5',
        EngineConfiguration: 'In-Line', EngineCylinders: '4', ignored: 'raw',
      }] }),
    }))
    await expect(decodeVin(VIN, { fetcher })).resolves.toEqual({
      ok: true,
      decoder: 'nhtsa-vpic',
      details: {
        year: '2023', make: 'MAZDA', model: 'CX-30', trim: 'SELECT',
        body: 'Sport Utility Vehicle', engine: '2.5L In-Line 4 CIL.',
      },
    })
    expect(fetcher).toHaveBeenCalledOnce()
  })

  test('una respuesta incompleta solicita captura manual', async () => {
    const fetcher = async () => ({ ok: true, json: async () => ({ Results: [{ Make: 'MAZDA' }] }) })
    await expect(decodeVin(VIN, { fetcher })).resolves.toEqual({
      ok: false, error: 'INCOMPLETE_DECODE',
    })
  })

  test('un fallo del proveedor no se propaga como error del servidor', async () => {
    const fetcher = async () => { throw new Error('offline') }
    await expect(decodeVin(VIN, { fetcher })).resolves.toEqual({
      ok: false, error: 'DECODER_UNAVAILABLE',
    })
  })
})
