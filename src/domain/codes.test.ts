// La llave de alta: qué vale un código, y en qué orden se dicen sus males.

import { describe, expect, test } from 'vitest'
import { countdown, describeCode, isLive, remaining, statusOf } from './codes'
import type { InviteCode } from './types'

const NOW = new Date('2026-08-13T12:00:00Z')
const IN = (h: number) => new Date(NOW.getTime() + h * 3600_000).toISOString()

function key(over: Partial<InviteCode> = {}): InviteCode {
  return {
    code: 'B4E19D',
    companyId: 'C-01',
    kind: 'alta',
    role: 'OPERADOR',
    issuedBy: '11111111-1111-4111-8111-111111111111',
    issuedAt: IN(-1),
    expiresAt: IN(4),
    ...over,
  } as InviteCode
}

describe('statusOf', () => {
  test('con menos de seis dígitos no hay nada que buscar', () => {
    expect(statusOf('B4E1', key(), NOW).kind).toBe('incomplete')
  })

  test('un código que no existe es unknown', () => {
    expect(statusOf('FFFFFF', undefined, NOW).kind).toBe('unknown')
  })

  test('una llave viva abre y dice el rol', () => {
    const status = statusOf('B4E19D', key(), NOW)
    expect(status).toEqual({ kind: 'valid', role: 'OPERADOR' })
  })

  test('gastada, retirada y caducada se dicen por su nombre', () => {
    expect(statusOf('B4E19D', key({ usedAt: IN(-0.5) }), NOW).kind).toBe('spent')
    expect(statusOf('B4E19D', key({ revokedAt: IN(-0.5) }), NOW).kind).toBe('revoked')
    expect(statusOf('B4E19D', key({ expiresAt: IN(-1) }), NOW).kind).toBe('expired')
  })

  test('gastada Y caducada lee gastada: pedir otra no es la respuesta', () => {
    const both = key({ usedAt: IN(-2), expiresAt: IN(-1) })
    expect(statusOf('B4E19D', both, NOW).kind).toBe('spent')
  })

  test('una llave de soporte no da de alta a nadie', () => {
    expect(statusOf('B4E19D', key({ kind: 'soporte' }), NOW).kind).toBe('wrongKind')
  })

  test('caducada pesa más que ser del tipo equivocado', () => {
    const stale = key({ kind: 'soporte', expiresAt: IN(-1) })
    expect(statusOf('B4E19D', stale, NOW).kind).toBe('expired')
  })
})

describe('isLive y los plazos', () => {
  test('viva es no gastada, no retirada, no caducada', () => {
    expect(isLive(key(), NOW)).toBe(true)
    expect(isLive(key({ usedAt: IN(-1) }), NOW)).toBe(false)
    expect(isLive(key({ expiresAt: IN(-1) }), NOW)).toBe(false)
  })

  test('lo que queda se escribe como 07b lo escribe', () => {
    expect(remaining(key({ expiresAt: IN(4) }), NOW)).toBe('4 H')
    expect(remaining(key({ expiresAt: IN(0.5) }), NOW)).toBe('30 M')
    expect(remaining(key({ expiresAt: IN(-1) }), NOW)).toBe('CADUCADO')
    expect(countdown(key({ expiresAt: IN(23.97) }), NOW)).toBe('23 H 58 M')
  })

  test('la lista describe el rol real sin inventar una zona', () => {
    expect(describeCode(key())).toBe('OPERADOR')
  })
})
