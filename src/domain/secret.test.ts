// La regla del archivo: lo que prueba una cuenta nunca se guarda tal como se
// teclea. Aquí se comprueba que la derivación cumple lo que ese trato promete.

import { describe, expect, test } from 'vitest'
import { matches, newSalt, seal, ROUNDS } from './secret'

const LOW_ROUNDS = 1_000

describe('seal y matches', () => {
  test('lo guardado no es lo tecleado, y volver a derivar lo reconoce', async () => {
    const secret = await seal('Correcta1', LOW_ROUNDS)
    expect(secret).not.toContain('Correcta1')
    expect(secret).toContain(`$i=${LOW_ROUNDS}$`)
    await expect(matches('Correcta1', secret)).resolves.toBe(true)
    await expect(matches('Incorrecta1', secret)).resolves.toBe(false)
  })

  test('dos personas con la misma contraseña no guardan el mismo secreto', async () => {
    const one = await seal('Repetida9', LOW_ROUNDS)
    const two = await seal('Repetida9', LOW_ROUNDS)
    expect(one).not.toBe(two)
  })

  test('las vueltas viajan con el secreto: subirlas no rompe lo viejo', async () => {
    const old = await seal('Antigua8', LOW_ROUNDS)
    // Un secreto sellado con menos vueltas se sigue reconociendo por las
    // suyas, no por las de hoy — eso es lo que guarda `rounds` en la fila.
    expect(old).toContain(`$i=${LOW_ROUNDS}$`)
    expect(LOW_ROUNDS).toBeLessThan(ROUNDS)
    await expect(matches('Antigua8', old)).resolves.toBe(true)
  })

  test('sin secreto no hay acierto posible', async () => {
    await expect(matches('Loquesea1', undefined)).resolves.toBe(false)
  })

  test('comprueba el formato PHC emitido por la API', async () => {
    const phc = '$pbkdf2-sha256$i=1000$NGrgwlri0yOr+hhDvt00fA$hw2hlYJ2Pm28XCTdys+TVetutpr1fh2XClHP7gABS60'
    await expect(matches('Compartida1', phc)).resolves.toBe(true)
    await expect(matches('Distinta1', phc)).resolves.toBe(false)
  })
})

describe('newSalt', () => {
  test('dieciséis bytes en hex, distintos cada vez', () => {
    const salt = newSalt()
    expect(salt).toMatch(/^[0-9a-f]{32}$/)
    expect(newSalt()).not.toBe(salt)
  })
})
