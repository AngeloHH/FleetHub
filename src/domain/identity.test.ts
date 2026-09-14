import { describe, expect, test } from 'vitest'
import { displayCode, locationCode, operatorCode, vehicleCode } from './identity'

describe('operatorCode', () => {
  const uuid = '550e8400-e29b-41d4-a716-446655440000'

  test('produce una etiqueta de cuatro dígitos estable', () => {
    expect(operatorCode(uuid)).toMatch(/^OP-\d{4}$/)
    expect(operatorCode(uuid)).toBe(operatorCode(uuid))
  })

  test('no necesita que el usuario siga existiendo', () => {
    expect(operatorCode('0c9d7a55-1e34-42f8-9b7a-8ef2c6d04b19')).toMatch(/^OP-\d{4}$/)
  })

  test('la misma función sirve para ubicaciones y vehículos', () => {
    expect(locationCode(uuid)).toMatch(/^LOC-\d{4}$/)
    expect(vehicleCode('3MVDMBBM2PM512094')).toMatch(/^VH-\d{4}$/)
    expect(locationCode(uuid)).toBe(displayCode('LOC', uuid))
    expect(vehicleCode('3mvdmbbm2pm512094')).toBe(vehicleCode('3MVDMBBM2PM512094'))
  })

  test('cambiar el prefijo no cambia los cuatro dígitos', () => {
    expect(operatorCode(uuid).slice(-4)).toBe(locationCode(uuid).slice(-4))
    expect(locationCode(uuid).slice(-4)).toBe(displayCode('VH', uuid).slice(-4))
  })
})
