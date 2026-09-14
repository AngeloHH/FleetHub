import { describe, expect, test } from 'vitest'
import { estimatedRoutePosition } from './route-position'

const GEOMETRY: [number, number][] = [[-80.2, 25.7], [-80.1, 25.7], [-80.0, 25.7]]

describe('posición estimada en ruta', () => {
  test('avanza por la geometría según el tiempo transcurrido', () => {
    const position = estimatedRoutePosition(
      GEOMETRY,
      '2026-08-20T12:00:00.000Z',
      600,
      new Date('2026-08-20T12:05:00.000Z'),
    )
    expect(position?.progress).toBeCloseTo(0.5)
    expect(position?.coordinates[0]).toBeCloseTo(-80.1, 3)
    expect(position?.completed).toBe(false)
  })

  test('antes de iniciar queda al principio y al terminar queda al final', () => {
    expect(estimatedRoutePosition(GEOMETRY, '2026-08-20T12:00:00.000Z', 600,
      new Date('2026-08-20T11:00:00.000Z'))?.coordinates).toEqual(GEOMETRY[0])
    expect(estimatedRoutePosition(GEOMETRY, '2026-08-20T12:00:00.000Z', 600,
      new Date('2026-08-20T13:00:00.000Z'))).toMatchObject({
      coordinates: GEOMETRY.at(-1), completed: true,
    })
  })

  test('sin fecha o duración no inventa una posición', () => {
    expect(estimatedRoutePosition(GEOMETRY, null, 600)).toBeNull()
    expect(estimatedRoutePosition(GEOMETRY, '2026-08-20T12:00:00.000Z', null)).toBeNull()
  })
})
