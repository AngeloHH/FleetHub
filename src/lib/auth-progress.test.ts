import { describe, expect, test } from 'vitest'
import { clearAuthProgress, EMPTY_AUTH_PROGRESS, readAuthProgress, writeAuthProgress } from './auth-progress'

const memory = () => {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  }
}

describe('progreso de acceso', () => {
  test('una recarga conserva el correo real, el código y la reserva', () => {
    const storage = memory()
    const progress = {
      draft: {
        name: 'Ana Torres', email: 'ana@empresa.mx', country: 'MX', phone: '5512345678',
        companyCode: 'A1B2C3', isAdmin: true,
      },
      sent: {
        to: { kind: 'email' as const, email: 'ana@empresa.mx' },
        code: '123456', expiresAt: '2026-08-19T00:00:00.000Z', flow: 'register' as const,
      },
      resetFor: null,
      registrationToken: 'reserva-temporal',
    }

    writeAuthProgress(progress, storage)
    expect(readAuthProgress(storage)).toEqual(progress)
    clearAuthProgress(storage)
    expect(readAuthProgress(storage)).toEqual(EMPTY_AUTH_PROGRESS)
  })

  test('datos desconocidos no inventan un destinatario', () => {
    const storage = memory()
    storage.setItem('fleethub.auth-progress', '{"sent":{"to":"incorrecto"}}')
    expect(readAuthProgress(storage)).toEqual(EMPTY_AUTH_PROGRESS)
  })
})
