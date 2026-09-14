import { describe, expect, test } from 'vitest'
import { eventDetail, operatorCode, type VehicleEvent } from '.'

const USER_ID = '0c9d7a55-1e34-42f8-9b7a-8ef2c6d04b19'

function event(userId: string | null): VehicleEvent {
  return {
    id: 'EV-1',
    companyId: 'company-1',
    vehicleId: 'VH-0001',
    userId,
    membershipId: userId,
    kind: 'adjuntos',
    at: '2026-08-19T00:00:00.000Z',
    note: 'VIN VERIFICADO EN CAMPO',
    photos: [],
  }
}

describe('autor del registro de un vehículo', () => {
  test('muestra el código corto calculado desde el UUID del operador', () => {
    expect(eventDetail(event(USER_ID))).toBe(
      `${operatorCode(USER_ID)} · VIN VERIFICADO EN CAMPO`,
    )
  })

  test('reserva SISTEMA para un evento que realmente no tiene autor', () => {
    expect(eventDetail(event(null))).toBe('SISTEMA · VIN VERIFICADO EN CAMPO')
  })

  test('reconoce los registros locales creados por la versión anterior', () => {
    const previous = { ...event(USER_ID), userId: undefined } as unknown as VehicleEvent
    expect(eventDetail(previous)).toContain(operatorCode(USER_ID))
  })
})
