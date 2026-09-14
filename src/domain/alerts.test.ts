// La regla de las alertas: qué telemetría es una alerta y cuál es rutina.

import { describe, expect, test } from 'vitest'
import { fleetAlerts, SILENT_AFTER, STOPPED_AFTER } from './alerts'
import type { Vehicle } from './types'

const NOW = new Date('2026-08-13T12:47:00Z')
const BASE = '11111111-1111-4111-8111-111111111111'
const STOPPED = '22222222-2222-4222-8222-222222222222'
const SILENT = '33333333-3333-4333-8333-333333333333'
const LOST = '44444444-4444-4444-8444-444444444444'

function unit(over: Partial<Vehicle>): Vehicle {
  return {
    id: BASE,
    companyId: 'C-01',
    vin: 'JT2BF22K1W0127K2310',
    model: 'Toyota Hilux',
    spec: 'PICKUP · 2021',
    position: 'Av. Central 100, CDMX',
    coords: [-99.1, 19.4],
    signalMin: 2,
    speedKmh: 40,
    ...over,
  }
}

describe('fleetAlerts', () => {
  test('una flota que reporta y se mueve no alerta', () => {
    expect(fleetAlerts([unit({})], {}, NOW)).toEqual([])
  })

  test('parada con señal viva más allá del umbral es detención crítica', () => {
    const stopped = unit({ id: STOPPED, speedKmh: 0, signalMin: STOPPED_AFTER + 15 })
    const alerts = fleetAlerts([stopped], {}, NOW)
    expect(alerts).toHaveLength(1)
    expect(alerts[0]).toMatchObject({ id: `${STOPPED}·detenida`, tone: 'danger' })
    expect(alerts[0].title).toContain('45 min detenida')
  })

  test('parada en taller o vendida es lo esperado, no una alerta', () => {
    const parked = unit({ speedKmh: 0, signalMin: STOPPED_AFTER + 15 })
    expect(fleetAlerts([parked], { [BASE]: 'EN SERVICIO' }, NOW)).toEqual([])
    expect(fleetAlerts([parked], { [BASE]: 'VENDIDO' }, NOW)).toEqual([])
  })

  test('el silencio largo pesa más que la velocidad: sin señal es su propia alerta', () => {
    const silent = unit({ id: SILENT, signalMin: SILENT_AFTER, speedKmh: 0 })
    const alerts = fleetAlerts([silent], {}, NOW)
    expect(alerts).toHaveLength(1)
    expect(alerts[0]).toMatchObject({ id: `${SILENT}·señal`, tone: 'warn' })
    expect(alerts[0].title).toContain('2 h')
  })

  test('NO ENCONTRADO es crítica aunque el GPS diga lo que diga', () => {
    const lost = unit({ id: LOST })
    const alerts = fleetAlerts([lost], { [LOST]: 'NO ENCONTRADO' }, NOW)
    expect(alerts).toHaveLength(1)
    expect(alerts[0]).toMatchObject({ id: `${LOST}·perdida`, tone: 'danger' })
  })

  test('lo crítico va antes que lo medio', () => {
    const fleet = [
      unit({ id: SILENT, signalMin: SILENT_AFTER }),
      unit({ id: STOPPED, speedKmh: 0, signalMin: STOPPED_AFTER + 15 }),
    ]
    expect(fleetAlerts(fleet, {}, NOW).map((a) => a.tone)).toEqual(['danger', 'warn'])
  })

  test('una unidad sin location aparece como warning', () => {
    const vehicle = unit({})
    const alerts = fleetAlerts([vehicle], {}, NOW, new Set([vehicle.id]))
    expect(alerts).toContainEqual(expect.objectContaining({
      id: `${vehicle.id}·sin-location`,
      tone: 'warn',
      severity: 'MEDIA · SIN RUTA/PUNTO',
      primary: 'VER UNIDAD',
    }))
  })
})
